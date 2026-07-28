"""Core, tenant-scoped business service for the YourComate Recruitment module.

The Flask route layer should stay thin and call this service. Recruitment
workflow rules, status transitions, duplicate protection, permissions,
notifications, activity history, reporting, and candidate-to-employee
conversion are kept here as one authoritative implementation.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from copy import deepcopy
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Mapping, Sequence

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError
from werkzeug.security import generate_password_hash

from app.services.resume_match_service import MATCH_VERSION, score_resume_match

HIRING_REQUESTS = "recruitment_hiring_requests"
JOB_OPENINGS = "recruitment_job_openings"
CANDIDATES = "recruitment_candidates"
APPLICATIONS = "recruitment_applications"
INTERVIEWS = "recruitment_interviews"
FEEDBACK = "recruitment_feedback"
OFFERS = "recruitment_offers"
DOCUMENTS = "recruitment_documents"
BACKGROUND_CHECKS = "recruitment_background_checks"
ACTIVITY_LOGS = "recruitment_activity_logs"
SETTINGS = "recruitment_settings"
SEQUENCES = "recruitment_sequences"
ONBOARDING_TASKS = "recruitment_onboarding_tasks"

HR_ROLES = {"super_admin", "admin", "hr_admin", "hr_manager", "hr"}
ADMIN_ROLES = {"super_admin", "admin", "hr_admin", "hr_manager"}
HR_PUBLISH_ROLES = {"hr_admin", "hr_manager", "hr"}
FINAL_APPROVAL_ROLES = {
    "super_admin",
    "admin",
    "managing_director",
    "managing_director_admin",
    "md",
}
FINAL_APPROVAL_CAPABILITIES = {
    "recruitment_final_approval",
    "approve_hiring_request",
    "approve_hiring_requirements",
}
MANAGER_ROLES = {"manager", "team_leader", "reporting_officer", "ro"}
TEAM_LEADER_HIRING_REQUEST_ROLES = {"team_leader"}
FINANCE_ROLES = {"finance", "accounts_finance"}
READER_ROLES = HR_ROLES | MANAGER_ROLES | FINANCE_ROLES | FINAL_APPROVAL_ROLES

HIRING_REQUEST_TRANSITIONS = {
    "draft": {"submitted", "closed"},
    "submitted": {"approved", "rejected", "on_hold", "returned"},
    "returned": {"submitted", "closed"},
    "on_hold": {"submitted", "rejected", "closed"},
    "approved": {"closed"}, "rejected": {"draft", "closed"}, "closed": set(),
}
JOB_OPENING_TRANSITIONS = {
    "draft": {"open", "cancelled"},
    "open": {"paused", "closed", "cancelled"},
    "paused": {"open", "closed", "cancelled"},
    "closed": set(), "cancelled": set(),
}
APPLICATION_TRANSITIONS = {
    "applied": {"under_review", "shortlisted", "rejected", "withdrawn"},
    "under_review": {"shortlisted", "on_hold", "rejected", "withdrawn"},
    "shortlisted": {"interview_scheduled", "selected", "on_hold", "rejected", "withdrawn"},
    "on_hold": {"under_review", "shortlisted", "interview_scheduled", "rejected", "withdrawn"},
    "interview_scheduled": {"interviewed", "on_hold", "rejected", "withdrawn"},
    "interviewed": {"selected", "on_hold", "rejected", "withdrawn"},
    "selected": {"offer_pending", "offer_sent", "documents_pending", "rejected"},
    "offer_pending": {"offer_sent", "rejected", "withdrawn"},
    "offer_sent": {"offer_accepted", "offer_declined", "offer_expired", "withdrawn"},
    "offer_accepted": {"documents_pending", "ready_to_join", "joining_deferred"},
    "offer_expired": {"offer_pending", "offer_sent", "rejected"},
    "documents_pending": {"ready_to_join", "joining_deferred", "rejected"},
    "ready_to_join": {"joined", "did_not_join", "joining_deferred"},
    "joining_deferred": {"documents_pending", "ready_to_join", "did_not_join"},
    "offer_declined": set(), "joined": set(), "did_not_join": set(),
    "rejected": set(), "withdrawn": set(),
}
INTERVIEW_TRANSITIONS = {
    "scheduled": {"rescheduled", "completed", "cancelled", "candidate_absent", "interviewer_absent"},
    "rescheduled": {"rescheduled", "completed", "cancelled", "candidate_absent", "interviewer_absent"},
    "candidate_absent": {"rescheduled", "cancelled"},
    "interviewer_absent": {"rescheduled", "cancelled"},
    "completed": set(), "cancelled": set(),
}
OFFER_TRANSITIONS = {
    "draft": {"approval_pending", "approved", "withdrawn"},
    "approval_pending": {"approved", "rejected", "withdrawn"},
    "approved": {"sent", "withdrawn", "draft"},
    "rejected": {"draft", "withdrawn"},
    "sent": {"accepted", "declined", "expired", "withdrawn"},
    "expired": {"draft", "withdrawn"},
    "accepted": set(), "declined": set(), "withdrawn": set(),
}
DOCUMENT_STATUSES = {"pending", "received", "accepted", "rejected", "needs_correction", "not_required"}
BACKGROUND_CHECK_STATUSES = {"pending", "clear", "clarification_required", "not_clear", "not_required"}
JOINING_STATUSES = {"documents_pending", "ready_to_join", "joining_deferred", "joined", "did_not_join"}
RECOMMENDATIONS = {"strong_hire", "hire", "hold", "reject"}
FINAL_APPLICATION_STATUSES = {"joined", "did_not_join", "rejected", "withdrawn", "offer_declined"}

DEFAULT_RECRUITMENT_SETTINGS = {
    "module_enabled": True,
    "career_page_enabled": True,
    "allow_employee_referrals": True,
    "require_hiring_request_approval": True,
    "require_salary_approval": True,
    "salary_approval_roles": ["finance", "accounts_finance", "admin", "super_admin"],
    "default_currency": "INR",
    "default_application_source": "career_page",
    "candidate_retention_days": 730,
    "resume_max_size_mb": 8,
    "duplicate_match_fields": ["email", "phone"],
    "feedback_rating_min": 1,
    "feedback_rating_max": 5,
    "feedback_required_areas": ["role_knowledge", "relevant_experience", "communication", "problem_solving", "work_approach"],
    "default_interview_rounds": [
        {"key": "hr_screening", "label": "HR Screening", "order": 1},
        {"key": "technical", "label": "Technical Interview", "order": 2},
        {"key": "manager", "label": "Manager Interview", "order": 3},
    ],
    "default_joining_documents": [
        {"key": "identity_proof", "label": "Identity proof", "required": True},
        {"key": "address_proof", "label": "Address proof", "required": True},
        {"key": "education_proof", "label": "Education certificates", "required": True},
        {"key": "experience_proof", "label": "Experience documents", "required": False},
        {"key": "bank_details", "label": "Bank details", "required": True},
        {"key": "photograph", "label": "Photograph", "required": True},
    ],
    "background_check_types": [
        {"key": "identity", "label": "Identity verification", "enabled": True},
        {"key": "employment", "label": "Employment verification", "enabled": False},
        {"key": "education", "label": "Education verification", "enabled": False},
        {"key": "reference", "label": "Reference check", "enabled": False},
    ],
    "email_candidate_on_application": True,
    "email_candidate_on_interview": True,
    "email_candidate_on_offer": True,
    "email_candidate_on_rejection": True,
    "employee_code_prefix": "EMP",
    "public_career_slug": "",
}

class RecruitmentServiceError(RuntimeError):
    def __init__(self, message: str, *, code="recruitment_error", status_code=400, details=None):
        super().__init__(message)
        self.message, self.code, self.status_code = message, code, status_code
        self.details = dict(details or {})
    def to_dict(self):
        data = {"ok": False, "message": self.message, "code": self.code}
        if self.details: data["details"] = self.details
        return data

def utcnow(): return datetime.utcnow()
def safe_str(value): return str(value or "").strip()
def normalize_key(value): return re.sub(r"[^a-z0-9]+", "_", safe_str(value).lower()).strip("_")
def normalize_email(value): return safe_str(value).lower()
def normalize_phone(value):
    raw = safe_str(value); digits = re.sub(r"\D", "", raw)
    return ("+" if raw.startswith("+") and digits else "") + digits
def normalize_roles(value):
    if isinstance(value, Mapping):
        raw = value.get("roles") or []
        if isinstance(raw, str): raw = raw.split(",")
        roles = {normalize_key(v) for v in raw if normalize_key(v)}
        if normalize_key(value.get("role")): roles.add(normalize_key(value.get("role")))
        return roles
    if isinstance(value, str): value = value.split(",")
    return {normalize_key(v) for v in (value or []) if normalize_key(v)}
def normalize_capabilities(value):
    if not isinstance(value, Mapping):
        return set()
    output = set()
    for key in (
        "capabilities",
        "permissions",
        "permission_keys",
        "access_capabilities",
        "module_permissions",
    ):
        raw = value.get(key)
        if isinstance(raw, Mapping):
            for item_key, enabled in raw.items():
                if enabled and normalize_key(item_key):
                    output.add(normalize_key(item_key))
        elif isinstance(raw, str):
            output.update(
                normalize_key(item)
                for item in raw.split(",")
                if normalize_key(item)
            )
        elif isinstance(raw, Sequence) and not isinstance(
            raw, (str, bytes, bytearray)
        ):
            for item in raw:
                if isinstance(item, Mapping):
                    item_key = normalize_key(
                        item.get("key")
                        or item.get("name")
                        or item.get("permission")
                    )
                    if item_key and item.get("enabled", True):
                        output.add(item_key)
                elif normalize_key(item):
                    output.add(normalize_key(item))
    return output
def as_object_id(value, field="id"):
    if isinstance(value, ObjectId): return value
    try: return ObjectId(safe_str(value))
    except Exception as exc: raise RecruitmentServiceError(f"Invalid {field}.", code=f"invalid_{normalize_key(field)}") from exc
def parse_date(value, field, required=False):
    raw = safe_str(value)
    if not raw:
        if required: raise RecruitmentServiceError(f"{field.replace('_',' ').title()} is required.", code=f"{normalize_key(field)}_required")
        return ""
    try: return date.fromisoformat(raw[:10]).isoformat()
    except ValueError as exc: raise RecruitmentServiceError(f"{field.replace('_',' ').title()} must use YYYY-MM-DD format.", code=f"invalid_{normalize_key(field)}") from exc
def parse_datetime(value, field, required=False):
    if isinstance(value, datetime): return value
    raw = safe_str(value)
    if not raw:
        if required: raise RecruitmentServiceError(f"{field.replace('_',' ').title()} is required.", code=f"{normalize_key(field)}_required")
        return None
    try: return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc: raise RecruitmentServiceError(f"Invalid {field.replace('_',' ')}.", code=f"invalid_{normalize_key(field)}") from exc
def as_float(value, field, minimum=None):
    if value in (None, ""): return None
    try: result = float(value)
    except Exception as exc: raise RecruitmentServiceError(f"{field.replace('_',' ').title()} must be a number.", code=f"invalid_{normalize_key(field)}") from exc
    if minimum is not None and result < minimum: raise RecruitmentServiceError(f"{field.replace('_',' ').title()} cannot be below {minimum}.", code=f"invalid_{normalize_key(field)}")
    return result
def unique_strings(values, limit=100):
    out, seen = [], set()
    for value in values or []:
        item = safe_str(value); key = item.lower()
        if item and key not in seen: seen.add(key); out.append(item)
        if len(out) >= limit: break
    return out
def clean_mapping(value): return dict(value) if isinstance(value, Mapping) else {}
def clean_list(value, limit=100):
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)): return []
    return [dict(v) for v in value[:limit] if isinstance(v, Mapping)]
def deep_merge(base, updates):
    result = deepcopy(dict(base))
    for key, value in dict(updates or {}).items():
        result[key] = deep_merge(result[key], value) if isinstance(value, Mapping) and isinstance(result.get(key), Mapping) else deepcopy(value)
    return result
def slugify(value): return re.sub(r"[^a-z0-9]+", "-", safe_str(value).lower()).strip("-")[:90] or "job"
def token_hash(value): return hashlib.sha256(safe_str(value).encode()).hexdigest()

EMPLOYEE_IDENTITY_FIELDS = (
    "employee_id",
    "employee_code",
    "emp_code",
    "code",
)


def employee_identity_alias_keys(payload):
    payload = dict(payload or {})
    return sorted({
        safe_str(payload.get(field_name)).lower()
        for field_name in EMPLOYEE_IDENTITY_FIELDS
        if safe_str(payload.get(field_name))
    })


def ensure_recruitment_indexes(db):
    indexes = [
        (HIRING_REQUESTS, [("tenant_id",1),("reference_no",1)], {"unique":True}),
        (HIRING_REQUESTS, [("tenant_id",1),("status",1),("created_at",-1)], {}),
        (JOB_OPENINGS, [("tenant_id",1),("reference_no",1)], {"unique":True}),
        (JOB_OPENINGS, [("tenant_id",1),("public_slug",1)], {"unique":True,"sparse":True}),
        (CANDIDATES, [("tenant_id",1),("reference_no",1)], {"unique":True}),
        (CANDIDATES, [("tenant_id",1),("normalized_email",1)], {"sparse":True}),
        (CANDIDATES, [("tenant_id",1),("normalized_phone",1)], {"sparse":True}),
        (APPLICATIONS, [("tenant_id",1),("reference_no",1)], {"unique":True}),
        (APPLICATIONS, [("tenant_id",1),("candidate_id",1),("job_opening_id",1)], {"unique":True}),
        (INTERVIEWS, [("tenant_id",1),("reference_no",1)], {"unique":True}),
        (INTERVIEWS, [("tenant_id",1),("application_id",1),("scheduled_at",1)], {}),
        (FEEDBACK, [("tenant_id",1),("interview_id",1),("interviewer_user_id",1)], {"unique":True}),
        (OFFERS, [("tenant_id",1),("reference_no",1)], {"unique":True}),
        (OFFERS, [("tenant_id",1),("application_id",1)], {"unique":True}),
        (DOCUMENTS, [("tenant_id",1),("application_id",1),("document_key",1)], {"unique":True}),
        (BACKGROUND_CHECKS, [("tenant_id",1),("application_id",1),("check_type",1)], {"unique":True}),
        (ACTIVITY_LOGS, [("tenant_id",1),("application_id",1),("created_at",-1)], {}),
        (SETTINGS, [("tenant_id",1)], {"unique":True}),
        (SEQUENCES, [("tenant_id",1),("sequence_key",1),("year",1)], {"unique":True}),
        (ONBOARDING_TASKS, [("tenant_id",1),("employee_id",1),("status",1)], {}),
    ]
    for name, keys, kwargs in indexes:
        try: db[name].create_index(keys, **kwargs)
        except Exception: pass

class RecruitmentService:
    def __init__(self, db, *, tenant_id, actor=None, config=None, allow_public_actions=False):
        self.db, self.tenant_id = db, safe_str(tenant_id)
        self.actor, self.config = dict(actor or {}), config or {}
        self.allow_public_actions = bool(allow_public_actions)
        if not self.tenant_id: raise RecruitmentServiceError("Company/tenant id is required.", code="tenant_id_required")
        self.actor_id = safe_str(self.actor.get("_id") or self.actor.get("id"))
        self.actor_name = safe_str(self.actor.get("name") or self.actor.get("full_name") or self.actor.get("email") or "System")
        self.actor_email = normalize_email(self.actor.get("email"))
        self.actor_roles = normalize_roles(self.actor)
        self.actor_capabilities = normalize_capabilities(self.actor)

    def _c(self, name): return self.db[name]
    def _q(self, extra=None):
        q = {"tenant_id": self.tenant_id, "is_deleted": {"$ne": True}}
        if extra: q.update(dict(extra))
        return q
    def _has(self, roles):
        return bool(self.actor_roles & {normalize_key(r) for r in roles})

    def _has_capability(self, capabilities):
        required = {normalize_key(value) for value in capabilities}
        return bool(self.actor_capabilities & required)

    def _auth(self):
        if not self.actor_id:
            raise RecruitmentServiceError(
                "Authentication is required.",
                code="authentication_required",
                status_code=401,
            )

    def _require_hr(self):
        self._auth()
        if not self._has(HR_ROLES):
            raise RecruitmentServiceError(
                "Only authorised HR or company administrators can perform this action.",
                code="recruitment_hr_permission_required",
                status_code=403,
            )

    def _require_hr_publisher(self):
        self._auth()
        if not self._has(HR_PUBLISH_ROLES):
            raise RecruitmentServiceError(
                "Only authorised HR users can create or publish a job opening after final approval.",
                code="recruitment_hr_publisher_required",
                status_code=403,
            )

    def _require_admin(self):
        self._auth()
        if not self._has(ADMIN_ROLES):
            raise RecruitmentServiceError(
                "Only an HR Manager or company administrator can perform this action.",
                code="recruitment_admin_permission_required",
                status_code=403,
            )

    def _is_final_hiring_approver(self):
        return self._has(FINAL_APPROVAL_ROLES) or self._has_capability(
            FINAL_APPROVAL_CAPABILITIES
        )

    def _require_final_hiring_approver(self):
        self._auth()
        if not self._is_final_hiring_approver():
            raise RecruitmentServiceError(
                "Final hiring approval must be completed by an authorised Admin or Managing Director.",
                code="hiring_request_final_approver_required",
                status_code=403,
            )

    def _require_reader(self):
        self._auth()
        if not self._has(READER_ROLES):
            raise RecruitmentServiceError(
                "You do not have access to recruitment records.",
                code="recruitment_access_denied",
                status_code=403,
            )

    def _is_department_team_leader(self):
        return self._has(TEAM_LEADER_HIRING_REQUEST_ROLES) and not self._has(
            HR_ROLES
        )

    def _require_hiring_request_creator(self):
        self._auth()
        if not (
            self._has(HR_ROLES)
            or self._has(TEAM_LEADER_HIRING_REQUEST_ROLES)
        ):
            raise RecruitmentServiceError(
                "Only authorised HR, company administrators, or Team Leaders can create and submit hiring requests.",
                code="recruitment_hr_permission_required",
                status_code=403,
            )

    def _actor_employee_record(self):
        employee_id = safe_str(self.actor.get("employee_id") or self.actor.get("employee_ref_id"))
        queries = [
            self._q({"user_id": self.actor_id}),
            self._q({"user_id": safe_str(self.actor.get("_id") or self.actor.get("id"))}),
        ]
        try:
            actor_object_id = ObjectId(self.actor_id)
            queries.append(self._q({"user_id": actor_object_id}))
        except Exception:
            pass
        if employee_id:
            try:
                queries.append(self._q({"_id": ObjectId(employee_id)}))
            except Exception:
                queries.append(self._q({"employee_id": employee_id}))
                queries.append(self._q({"emp_code": employee_id}))
        for query in queries:
            employee = self.db.employees.find_one(query)
            if employee:
                return employee
        return {}
    def _actor_department_scope(self, required=False):
        employee = self._actor_employee_record()
        department = safe_str(
            self.actor.get("department")
            or self.actor.get("department_name")
            or employee.get("department")
            or employee.get("department_name")
        )
        department_id = safe_str(
            self.actor.get("department_id")
            or employee.get("department_id")
            or employee.get("department_ref_id")
        )
        if department and not department_id:
            department_doc = self.db.departments.find_one(
                {
                    "tenant_id": self.tenant_id,
                    "is_deleted": {"$ne": True},
                    "$or": [
                        {"name": {"$regex": f"^{re.escape(department)}$", "$options": "i"}},
                        {"department_name": {"$regex": f"^{re.escape(department)}$", "$options": "i"}},
                        {"title": {"$regex": f"^{re.escape(department)}$", "$options": "i"}},
                    ],
                }
            )
            if department_doc:
                department_id = safe_str(department_doc.get("_id"))
                department = safe_str(
                    department_doc.get("name")
                    or department_doc.get("department_name")
                    or department_doc.get("title")
                    or department
                )
        if required and not department:
            raise RecruitmentServiceError(
                "Your employee profile does not have a department. Ask HR or Admin to assign your department before creating a hiring request.",
                code="team_leader_department_required",
                status_code=409,
            )
        return {"department": department, "department_id": department_id}
    def _users_for_final_hiring_approval(self):
        users = list(
            self.db.users.find(
                {
                    "tenant_id": self.tenant_id,
                    "is_active": True,
                    "is_deleted": {"$ne": True},
                }
            )
        )
        return [
            user
            for user in users
            if (normalize_roles(user) & FINAL_APPROVAL_ROLES)
            or (normalize_capabilities(user) & FINAL_APPROVAL_CAPABILITIES)
        ]

    def _users_for_hr_publishing(self):
        return self._users_for_roles(HR_PUBLISH_ROLES)

    def _hiring_request_approvers(self, requested_approver_ids):
        approver_ids = unique_strings(requested_approver_ids or [])
        if self.actor_id in approver_ids:
            raise RecruitmentServiceError(
                "A requester cannot select themselves as the final approver of their own hiring request.",
                code="hiring_request_self_approver_denied",
                status_code=403,
            )

        if not approver_ids:
            approver_ids = unique_strings(
                str(user.get("_id"))
                for user in self._users_for_final_hiring_approval()
                if safe_str(user.get("_id")) != self.actor_id
            )

        active_users = {
            str(user.get("_id")): user
            for user in self._active_users(approver_ids)
        }
        if set(approver_ids) - set(active_users):
            raise RecruitmentServiceError(
                "One or more selected final approvers are not active users of this company.",
                code="invalid_hiring_request_approver",
            )

        invalid_role_ids = [
            user_id
            for user_id, user in active_users.items()
            if not (
                (normalize_roles(user) & FINAL_APPROVAL_ROLES)
                or (
                    normalize_capabilities(user)
                    & FINAL_APPROVAL_CAPABILITIES
                )
            )
        ]
        if invalid_role_ids:
            raise RecruitmentServiceError(
                "Hiring requests require final approval from an authorised Admin or Managing Director.",
                code="hiring_request_final_approver_required",
                status_code=403,
                details={"invalid_approver_user_ids": invalid_role_ids},
            )
        return approver_ids

    def _team_leader_hiring_approvers(self, requested_approver_ids):
        return self._hiring_request_approvers(requested_approver_ids)

    def _get(self, collection, item_id, label):
        doc = self._c(collection).find_one(self._q({"_id": as_object_id(item_id, f"{label} id")}))
        if not doc: raise RecruitmentServiceError(f"{label} was not found in this company.", code=f"{normalize_key(label)}_not_found", status_code=404)
        return doc
    def _next(self, key, prefix):
        year = utcnow().year
        seq = self._c(SEQUENCES).find_one_and_update(
            {"tenant_id":self.tenant_id,"sequence_key":key,"year":year},
            {"$inc":{"value":1},"$set":{"updated_at":utcnow()},"$setOnInsert":{"created_at":utcnow()}},
            upsert=True, return_document=ReturnDocument.AFTER)
        return f"{prefix}-{year}-{int(seq.get('value',1)):04d}"
    def _actor_snapshot(self): return {"actor_id":self.actor_id or "system","actor_name":self.actor_name,"actor_email":self.actor_email,"actor_roles":sorted(self.actor_roles) or ["system"]}
    def _activity(self, action, entity_type, entity_id, *, application_id="", message="", old="", new="", details=None):
        now = utcnow(); doc = {"tenant_id":self.tenant_id,"application_id":safe_str(application_id),"entity_type":normalize_key(entity_type),"entity_id":safe_str(entity_id),"action":normalize_key(action),"message":safe_str(message),"from_status":normalize_key(old),"to_status":normalize_key(new),"details":dict(details or {}),**self._actor_snapshot(),"created_at":now,"is_deleted":False}
        result = self._c(ACTIVITY_LOGS).insert_one(doc); doc["_id"] = result.inserted_id
        try: self.db.audit_logs.insert_one({"tenant_id":self.tenant_id,"actor_id":doc["actor_id"],"actor_email":doc["actor_email"],"actor_name":doc["actor_name"],"actor_roles":doc["actor_roles"],"action":f"recruitment_{doc['action']}","entity":f"recruitment_{doc['entity_type']}","entity_id":doc["entity_id"],"meta":{"application_id":doc["application_id"],**dict(details or {})},"created_at":now})
        except Exception: pass
        return doc
    def _history(self, collection, item_id, old, new, reason=""):
        self._c(collection).update_one({"_id":item_id,"tenant_id":self.tenant_id},{"$push":{"status_history":{"from_status":normalize_key(old),"to_status":normalize_key(new),"reason":safe_str(reason),**self._actor_snapshot(),"changed_at":utcnow()}}})
    def _transition(self, current, target, rules, label):
        old, new = normalize_key(current), normalize_key(target)
        if old == new: return old, new
        allowed = rules.get(old, set())
        if new not in allowed: raise RecruitmentServiceError(f"{label} cannot move from {old.replace('_',' ')} to {new.replace('_',' ')}.", code="invalid_recruitment_status_transition", status_code=409, details={"current_status":old,"requested_status":new,"allowed_statuses":sorted(allowed)})
        return old, new
    def _users_for_roles(self, roles):
        roles = sorted({normalize_key(r) for r in roles})
        return list(self.db.users.find({"tenant_id":self.tenant_id,"is_active":True,"is_deleted":{"$ne":True},"$or":[{"roles":{"$in":roles}},{"role":{"$in":roles}}]}))
    def _active_users(self, ids):
        object_ids=[]
        for value in unique_strings(ids):
            try: object_ids.append(ObjectId(value))
            except Exception: pass
        return list(self.db.users.find({"_id":{"$in":object_ids},"tenant_id":self.tenant_id,"is_active":True,"is_deleted":{"$ne":True}})) if object_ids else []
    def _notify(self, ids, *, title, body, target, entity_type, entity_id, application_id="", priority="normal", popup=False):
        now=utcnow(); docs=[]
        for uid in unique_strings(ids): docs.append({"tenant_id":self.tenant_id,"user_id":uid,"user_ids":[uid],"title":safe_str(title),"body":safe_str(body),"message":safe_str(body),"notification_type":"recruitment","priority":normalize_key(priority),"target":normalize_key(target),"target_scope":"selected_users","audience":"selected_users","show_popup":bool(popup),"popup_seen":False,"read":False,"status":"unread","created_at":now,"updated_at":now,"created_by":self.actor_id or "system","created_by_name":self.actor_name,"created_by_role":sorted(self.actor_roles) or ["system"],"is_deleted":False,"meta":{"page":"recruitment","target":normalize_key(target),"entity_type":normalize_key(entity_type),"entity_id":safe_str(entity_id),"application_id":safe_str(application_id)}})
        if docs: self.db.notifications.insert_many(docs)
        return len(docs)
    def _email(self, function_name, **kwargs):
        try:
            from app.services import email_service
            fn = getattr(email_service, function_name, None)
            return fn(config=self.config, **kwargs) if fn else {"ok":False,"code":"email_function_unavailable"}
        except Exception as exc: return {"ok":False,"code":"recruitment_email_failed","message":safe_str(exc)}
    def _company_name(self):
        tenant=self.db.tenants.find_one({"tenant_id":self.tenant_id}) or {}
        return safe_str(tenant.get("company_name") or tenant.get("name") or tenant.get("tenant_name") or self.tenant_id)
    def _reply_to(self):
        tenant=self.db.tenants.find_one({"tenant_id":self.tenant_id}) or {}
        return normalize_email(tenant.get("recruitment_email") or tenant.get("hr_email") or tenant.get("email") or self.actor_email)
    def _paged(self, collection, query, page=1, page_size=25, sort=None):
        page=max(1,int(page or 1)); page_size=min(100,max(1,int(page_size or 25))); total=self._c(collection).count_documents(query)
        items=list(self._c(collection).find(query).sort(list(sort or [("updated_at",DESCENDING),("created_at",DESCENDING)])).skip((page-1)*page_size).limit(page_size))
        return {"items":items,"pagination":{"page":page,"page_size":page_size,"total":total,"total_pages":(total+page_size-1)//page_size}}

    def _settings(self): return deep_merge(DEFAULT_RECRUITMENT_SETTINGS, self._c(SETTINGS).find_one(self._q()) or {})
    def get_settings(self): self._require_reader(); return self._settings()
    def update_settings(self, updates):
        self._require_admin(); allowed=set(DEFAULT_RECRUITMENT_SETTINGS); payload={k:deepcopy(v) for k,v in dict(updates or {}).items() if k in allowed}
        if not payload: raise RecruitmentServiceError("No supported recruitment setting was provided.", code="recruitment_settings_empty")
        now=utcnow(); payload.update({"tenant_id":self.tenant_id,"updated_at":now,"updated_by":self.actor_id,"updated_by_name":self.actor_name,"is_deleted":False})
        self._c(SETTINGS).update_one({"tenant_id":self.tenant_id},{"$set":payload,"$setOnInsert":{"created_at":now,"created_by":self.actor_id,"created_by_name":self.actor_name}},upsert=True)
        saved=self._c(SETTINGS).find_one({"tenant_id":self.tenant_id}); self._activity("settings_updated","settings",saved.get("_id"),message="Recruitment settings were updated.")
        return self._settings()

    def create_hiring_request(self, payload):
        self._require_hiring_request_creator()
        data = dict(payload or {})
        title = safe_str(data.get("job_title") or data.get("title"))
        requested_department = safe_str(
            data.get("department") or data.get("department_name")
        )
        requested_department_id = safe_str(data.get("department_id"))
        reason = safe_str(data.get("business_reason") or data.get("reason"))
        team_leader_request = self._is_department_team_leader()

        if not title:
            raise RecruitmentServiceError(
                "Job title is required.", code="job_title_required"
            )
        if not reason:
            raise RecruitmentServiceError(
                "Business reason is required.", code="business_reason_required"
            )

        if team_leader_request:
            scope = self._actor_department_scope(required=True)
            department = scope["department"]
            department_id = scope["department_id"]
            if (
                requested_department
                and normalize_key(requested_department)
                != normalize_key(department)
            ):
                raise RecruitmentServiceError(
                    "Team Leaders can create hiring requests only for their own department.",
                    code="team_leader_department_scope_denied",
                    status_code=403,
                    details={"allowed_department": department},
                )
            if (
                requested_department_id
                and department_id
                and requested_department_id != department_id
            ):
                raise RecruitmentServiceError(
                    "Team Leaders cannot change the department assigned to their hiring request.",
                    code="team_leader_department_scope_denied",
                    status_code=403,
                    details={
                        "allowed_department": department,
                        "allowed_department_id": department_id,
                    },
                )
        else:
            department = requested_department
            department_id = requested_department_id
            if not department:
                raise RecruitmentServiceError(
                    "Department is required.", code="department_required"
                )

        salary_min = as_float(data.get("salary_min"), "salary_min", 0)
        salary_max = as_float(data.get("salary_max"), "salary_max", 0)
        if (
            salary_min is not None
            and salary_max is not None
            and salary_max < salary_min
        ):
            raise RecruitmentServiceError(
                "Maximum salary cannot be lower than minimum salary.",
                code="invalid_salary_range",
            )

        approvers = unique_strings(
            data.get("approver_user_ids")
            or (
                [data.get("approver_user_id")]
                if data.get("approver_user_id")
                else []
            )
        )
        approvers = self._hiring_request_approvers(approvers)

        hiring_manager_user_id = safe_str(
            data.get("hiring_manager_user_id")
        )
        hiring_manager_name = safe_str(data.get("hiring_manager_name"))
        if team_leader_request:
            hiring_manager_user_id = self.actor_id
            hiring_manager_name = self.actor_name

        now = utcnow()
        doc = {
            "tenant_id": self.tenant_id,
            "reference_no": self._next("hiring_request", "HR-REQ"),
            "job_title": title,
            "department": department,
            "department_id": department_id,
            "department_locked": team_leader_request,
            "requester_scope": (
                "department_team_leader"
                if team_leader_request
                else "hr_authorised"
            ),
            "requested_by_department": (
                department if team_leader_request else ""
            ),
            "requested_by_department_id": (
                department_id if team_leader_request else ""
            ),
            "vacancies": int(
                as_float(data.get("vacancies", 1), "vacancies", 1) or 1
            ),
            "work_location": safe_str(
                data.get("work_location") or data.get("location")
            ),
            "employment_type": normalize_key(
                data.get("employment_type") or "permanent"
            ),
            "business_reason": reason,
            "replacement_for": safe_str(data.get("replacement_for")),
            "expected_joining_date": parse_date(
                data.get("expected_joining_date"),
                "expected_joining_date",
            ),
            "required_experience": safe_str(
                data.get("required_experience")
            ),
            "required_skills": unique_strings(
                data.get("required_skills") or data.get("skills") or []
            ),
            "qualification": safe_str(data.get("qualification")),
            "salary_min": salary_min,
            "salary_max": salary_max,
            "currency": safe_str(
                data.get("currency")
                or self._settings().get("default_currency")
                or "INR"
            ).upper(),
            "budget_notes": safe_str(data.get("budget_notes")),
            "hiring_manager_user_id": hiring_manager_user_id,
            "hiring_manager_name": hiring_manager_name,
            "approver_user_ids": approvers,
            "final_approval_required": True,
            "final_approval_completed": False,
            "final_approval_status": "draft",
            "final_approved_at": None,
            "final_approved_by": "",
            "final_approved_by_name": "",
            "finance_approval_required": bool(
                data.get("finance_approval_required")
            ),
            "leadership_approval_required": True,
            "status": "draft",
            "status_history": [],
            "requested_by": self.actor_id,
            "requested_by_name": self.actor_name,
            "created_at": now,
            "updated_at": now,
            "created_by": self.actor_id,
            "created_by_name": self.actor_name,
            "updated_by": self.actor_id,
            "updated_by_name": self.actor_name,
            "is_deleted": False,
        }
        result = self._c(HIRING_REQUESTS).insert_one(doc)
        doc["_id"] = result.inserted_id
        self._activity(
            "created",
            "hiring_request",
            doc["_id"],
            message=(
                f"Hiring request {doc['reference_no']} was created."
            ),
            new="draft",
            details={
                "requester_scope": doc["requester_scope"],
                "department": department,
                "final_approval_required": True,
            },
        )
        return doc
    def get_hiring_request(self, request_id):
        self._require_reader()
        doc = self._get(HIRING_REQUESTS, request_id, "Hiring request")
        if not self._has(HR_ROLES) and self.actor_id not in {
            safe_str(doc.get("requested_by")),
            safe_str(doc.get("hiring_manager_user_id")),
            *unique_strings(doc.get("approver_user_ids") or []),
        }:
            raise RecruitmentServiceError(
                "You do not have access to this hiring request.",
                code="hiring_request_access_denied",
                status_code=403,
            )
        return doc

    def list_hiring_requests(self, status="", search="", page=1, page_size=25):
        self._require_reader()
        q = self._q()
        if status:
            q["status"] = normalize_key(status)
        if search:
            expression = re.escape(safe_str(search))
            q["$or"] = [
                {"reference_no": {"$regex": expression, "$options": "i"}},
                {"job_title": {"$regex": expression, "$options": "i"}},
                {"department": {"$regex": expression, "$options": "i"}},
            ]
        if not self._has(HR_ROLES):
            q["$and"] = [
                {
                    "$or": [
                        {"requested_by": self.actor_id},
                        {"hiring_manager_user_id": self.actor_id},
                        {"approver_user_ids": self.actor_id},
                    ]
                }
            ]
        return self._paged(HIRING_REQUESTS, q, page, page_size)

    def submit_hiring_request(self, request_id):
        self._require_hiring_request_creator()
        doc = self._get(HIRING_REQUESTS, request_id, "Hiring request")
        team_leader_submission = self._is_department_team_leader()

        if team_leader_submission:
            if (
                safe_str(doc.get("requested_by")) != self.actor_id
                or normalize_key(doc.get("requester_scope"))
                != "department_team_leader"
            ):
                raise RecruitmentServiceError(
                    "Team Leaders can submit only hiring requests they created for their own department.",
                    code="team_leader_hiring_request_submit_denied",
                    status_code=403,
                )
            scope = self._actor_department_scope(required=True)
            if normalize_key(doc.get("department")) != normalize_key(
                scope["department"]
            ):
                raise RecruitmentServiceError(
                    "This hiring request is not assigned to your current department.",
                    code="team_leader_department_scope_denied",
                    status_code=403,
                    details={"allowed_department": scope["department"]},
                )
        elif (
            not self._has(HR_ROLES)
            or safe_str(doc.get("requested_by")) != self.actor_id
        ):
            raise RecruitmentServiceError(
                "You can submit only a hiring request you created.",
                code="hiring_request_submit_denied",
                status_code=403,
            )

        old, new = self._transition(
            doc.get("status"),
            "submitted",
            HIRING_REQUEST_TRANSITIONS,
            "Hiring request",
        )
        approvers = self._hiring_request_approvers(
            doc.get("approver_user_ids") or []
        )
        if not approvers:
            raise RecruitmentServiceError(
                "No authorised Admin or Managing Director is available to give final approval.",
                code="hiring_request_final_approver_required",
                status_code=409,
            )

        now = utcnow()
        self._c(HIRING_REQUESTS).update_one(
            {"_id": doc["_id"], "tenant_id": self.tenant_id},
            {
                "$set": {
                    "approver_user_ids": approvers,
                    "status": new,
                    "final_approval_status": "pending",
                    "final_approval_completed": False,
                    "submitted_at": now,
                    "submitted_by": self.actor_id,
                    "updated_at": now,
                    "updated_by": self.actor_id,
                    "updated_by_name": self.actor_name,
                }
            },
        )
        self._history(HIRING_REQUESTS, doc["_id"], old, new)
        self._activity(
            "submitted",
            "hiring_request",
            doc["_id"],
            message=(
                f"Hiring request {doc.get('reference_no')} was submitted "
                "for final approval."
            ),
            old=old,
            new=new,
            details={
                "requester_scope": doc.get("requester_scope"),
                "department": doc.get("department"),
                "final_approval_status": "pending",
            },
        )
        self._notify(
            approvers,
            title="Final hiring approval required",
            body=(
                f"{doc.get('job_title')} for {doc.get('department')} "
                "requires final approval."
            ),
            target="recruitment_hiring_requests",
            entity_type="hiring_request",
            entity_id=doc["_id"],
            priority="high",
            popup=True,
        )
        return self._get(HIRING_REQUESTS, doc["_id"], "Hiring request")
    def decide_hiring_request(self, request_id, decision, reason=""):
        self._require_final_hiring_approver()
        doc = self._get(HIRING_REQUESTS, request_id, "Hiring request")
        decision = normalize_key(decision)
        if decision not in {"approved", "rejected", "on_hold", "returned"}:
            raise RecruitmentServiceError(
                "Invalid hiring-request decision.",
                code="invalid_hiring_request_decision",
            )

        if safe_str(doc.get("requested_by")) == self.actor_id:
            raise RecruitmentServiceError(
                "A requester cannot give final approval to their own hiring request.",
                code="hiring_request_self_approval_denied",
                status_code=403,
            )

        approver_ids = unique_strings(doc.get("approver_user_ids") or [])
        if (
            approver_ids
            and self.actor_id not in approver_ids
            and not self._has({"super_admin"})
        ):
            raise RecruitmentServiceError(
                "You are not an assigned final approver for this hiring request.",
                code="hiring_request_decision_access_denied",
                status_code=403,
            )

        reason = safe_str(reason)
        if decision in {"rejected", "on_hold", "returned"} and not reason:
            raise RecruitmentServiceError(
                "A written reason is required.",
                code="hiring_request_decision_reason_required",
            )
        old, new = self._transition(
            doc.get("status"),
            decision,
            HIRING_REQUEST_TRANSITIONS,
            "Hiring request",
        )
        now = utcnow()
        approved = new == "approved"
        update = {
            "status": new,
            "decision_reason": reason,
            "decided_at": now,
            "decided_by": self.actor_id,
            "decided_by_name": self.actor_name,
            "final_approval_status": new,
            "final_approval_completed": approved,
            "updated_at": now,
            "updated_by": self.actor_id,
            "updated_by_name": self.actor_name,
        }
        if approved:
            update.update(
                {
                    "final_approved_at": now,
                    "final_approved_by": self.actor_id,
                    "final_approved_by_name": self.actor_name,
                }
            )
        else:
            update.update(
                {
                    "final_approved_at": None,
                    "final_approved_by": "",
                    "final_approved_by_name": "",
                }
            )

        self._c(HIRING_REQUESTS).update_one(
            {"_id": doc["_id"], "tenant_id": self.tenant_id},
            {
                "$set": update,
                "$push": {
                    "approvals": {
                        "decision": new,
                        "reason": reason,
                        "approval_level": "final_requirement_approval",
                        **self._actor_snapshot(),
                        "decided_at": now,
                    }
                },
            },
        )
        self._history(HIRING_REQUESTS, doc["_id"], old, new, reason)
        self._activity(
            new,
            "hiring_request",
            doc["_id"],
            message=(
                f"Final hiring requirement was {new.replace('_', ' ')}."
            ),
            old=old,
            new=new,
            details={
                "reason": reason,
                "approval_level": "final_requirement_approval",
            },
        )

        recipients = [doc.get("requested_by")]
        if approved:
            recipients.extend(
                str(user.get("_id"))
                for user in self._users_for_hr_publishing()
            )
        self._notify(
            unique_strings(recipients),
            title=(
                "Hiring requirement approved — HR action required"
                if approved
                else f"Hiring request {new.replace('_', ' ')}"
            ),
            body=(
                f"{doc.get('job_title')} for {doc.get('department')} is "
                "finally approved. HR can now create and publish the job opening."
                if approved
                else (
                    f"{doc.get('job_title')} was {new.replace('_', ' ')}."
                )
            ),
            target="recruitment_hiring_requests",
            entity_type="hiring_request",
            entity_id=doc["_id"],
            priority="high",
            popup=True,
        )
        return self._get(HIRING_REQUESTS, doc["_id"], "Hiring request")
    def _unique_slug(self,base):
        value,counter=base,2
        while self._c(JOB_OPENINGS).find_one(self._q({"public_slug":value})): value=f"{base[:80]}-{counter}"; counter+=1
        return value
    def create_job_opening(self,payload):
        self._require_hr_publisher(); data=dict(payload or {}); req=self._get(HIRING_REQUESTS,data.get("hiring_request_id"),"Hiring request")
        if normalize_key(req.get("status"))!="approved" or req.get("final_approval_completed") is not True or normalize_key(req.get("final_approval_status"))!="approved": raise RecruitmentServiceError("A job opening can only be created after final approval by an authorised Admin or Managing Director.",code="hiring_request_final_approval_required",status_code=409)
        if self._c(JOB_OPENINGS).find_one(self._q({"hiring_request_id":str(req["_id"]),"status":{"$in":["draft","open","paused"]}})): raise RecruitmentServiceError("An active job opening already exists for this hiring request.",code="job_opening_already_exists",status_code=409)
        description=safe_str(data.get("description") or data.get("job_description"))
        if not description: raise RecruitmentServiceError("Job description is required.",code="job_description_required")
        closing=parse_date(data.get("closing_date"),"closing_date")
        if closing and closing<date.today().isoformat(): raise RecruitmentServiceError("Closing date cannot be in the past.",code="invalid_job_closing_date")
        ref=self._next("job_opening","JOB"); now=utcnow(); rounds=clean_list(data.get("interview_rounds")) or deepcopy(self._settings().get("default_interview_rounds") or [])
        doc={"tenant_id":self.tenant_id,"reference_no":ref,"hiring_request_id":str(req["_id"]),"hiring_request_reference":req.get("reference_no"),"job_title":safe_str(data.get("job_title") or req.get("job_title")),"department":safe_str(data.get("department") or req.get("department")),"department_id":safe_str(data.get("department_id") or req.get("department_id")),"vacancies":int(data.get("vacancies") or req.get("vacancies") or 1),"filled_vacancies":0,"description":description,"responsibilities":unique_strings(data.get("responsibilities") or []),"qualification":safe_str(data.get("qualification") or req.get("qualification")),"required_skills":unique_strings(data.get("required_skills") or req.get("required_skills") or []),"required_experience":safe_str(data.get("required_experience") or req.get("required_experience")),"employment_type":normalize_key(data.get("employment_type") or req.get("employment_type") or "permanent"),"work_location":safe_str(data.get("work_location") or req.get("work_location")),"work_mode":normalize_key(data.get("work_mode") or "office"),"salary_visible":bool(data.get("salary_visible")),"salary_min":req.get("salary_min"),"salary_max":req.get("salary_max"),"currency":req.get("currency") or "INR","recruiter_user_id":safe_str(data.get("recruiter_user_id") or self.actor_id),"recruiter_name":safe_str(data.get("recruiter_name") or self.actor_name),"hiring_manager_user_id":safe_str(data.get("hiring_manager_user_id") or req.get("hiring_manager_user_id")),"hiring_manager_name":safe_str(data.get("hiring_manager_name") or req.get("hiring_manager_name")),"panel_user_ids":unique_strings(data.get("panel_user_ids") or []),"interview_rounds":rounds,"opening_date":"","closing_date":closing,"public_slug":self._unique_slug(slugify(f"{data.get('job_title') or req.get('job_title')}-{ref}")),"published_channels":[],"application_form_fields":clean_list(data.get("application_form_fields")),"status":"draft","status_history":[],"created_at":now,"updated_at":now,"created_by":self.actor_id,"created_by_name":self.actor_name,"updated_by":self.actor_id,"updated_by_name":self.actor_name,"is_deleted":False}
        result=self._c(JOB_OPENINGS).insert_one(doc); doc["_id"]=result.inserted_id; self._activity("created","job_opening",doc["_id"],message=f"Job opening {ref} was created.",new="draft",details={"hiring_request_id":str(req["_id"])}); return doc
    def _public_job(self,doc):
        keys={"_id","reference_no","job_title","department","vacancies","description","responsibilities","qualification","required_skills","required_experience","employment_type","work_location","work_mode","salary_visible","currency","opening_date","closing_date","public_slug","application_form_fields","status"}; result={k:deepcopy(v) for k,v in doc.items() if k in keys}
        if doc.get("salary_visible"): result.update({"salary_min":doc.get("salary_min"),"salary_max":doc.get("salary_max")})
        return result
    def list_job_openings(self,status="",search="",page=1,page_size=25,public=False):
        q=self._q()
        if public:
            if not self.allow_public_actions: raise RecruitmentServiceError("Public recruitment access is disabled.",code="public_recruitment_access_denied",status_code=403)
            q.update({"status":"open","$or":[{"closing_date":""},{"closing_date":{"$gte":date.today().isoformat()}}]})
        else:
            self._require_reader()
            if status:q["status"]=normalize_key(status)
            if not self._has(HR_ROLES):q["$and"]=[{"$or":[{"recruiter_user_id":self.actor_id},{"hiring_manager_user_id":self.actor_id},{"panel_user_ids":self.actor_id}]}]
        if search:
            x=re.escape(safe_str(search)); q.setdefault("$and",[]).append({"$or":[{"reference_no":{"$regex":x,"$options":"i"}},{"job_title":{"$regex":x,"$options":"i"}},{"department":{"$regex":x,"$options":"i"}},{"required_skills":{"$regex":x,"$options":"i"}}]})
        result=self._paged(JOB_OPENINGS,q,page,page_size)
        if public: result["items"]=[self._public_job(i) for i in result["items"]]
        return result
    def get_public_job_by_slug(self,slug):
        if not self.allow_public_actions: raise RecruitmentServiceError("Public recruitment access is disabled.",code="public_recruitment_access_denied",status_code=403)
        doc=self._c(JOB_OPENINGS).find_one(self._q({"public_slug":safe_str(slug),"status":"open"}))
        if not doc: raise RecruitmentServiceError("This job opening is not available.",code="job_opening_not_found",status_code=404)
        return self._public_job(doc)
    def change_job_status(self,job_id,status,channels=None,reason=""):
        self._require_hr_publisher(); doc=self._get(JOB_OPENINGS,job_id,"Job opening"); old,new=self._transition(doc.get("status"),status,JOB_OPENING_TRANSITIONS,"Job opening"); now=utcnow(); update={"status":new,"status_reason":safe_str(reason),"updated_at":now,"updated_by":self.actor_id,"updated_by_name":self.actor_name}
        if new=="open": update.update({"opening_date":doc.get("opening_date") or date.today().isoformat(),"published_at":now,"published_by":self.actor_id,"published_channels":unique_strings(channels or doc.get("published_channels") or ["career_page"])})
        if new in {"closed","cancelled"}: update.update({"closed_at":now,"closed_by":self.actor_id})
        self._c(JOB_OPENINGS).update_one({"_id":doc["_id"],"tenant_id":self.tenant_id},{"$set":update}); self._history(JOB_OPENINGS,doc["_id"],old,new,reason); self._activity("status_changed","job_opening",doc["_id"],message=f"Job opening moved to {new.replace('_',' ')}.",old=old,new=new); return self._get(JOB_OPENINGS,doc["_id"],"Job opening")

    def _assigned_job_ids(self):
        if self._has(HR_ROLES):
            return []
        return [
            str(item["_id"])
            for item in self._c(JOB_OPENINGS).find(
                self._q(
                    {
                        "$or": [
                            {"recruiter_user_id": self.actor_id},
                            {"hiring_manager_user_id": self.actor_id},
                            {"panel_user_ids": self.actor_id},
                        ]
                    }
                ),
                {"_id": 1},
            )
        ]

    def _assigned_interview_application_ids(self):
        return unique_strings(
            item.get("application_id")
            for item in self._c(INTERVIEWS).find(
                self._q({"interviewer_user_ids": self.actor_id}),
                {"application_id": 1},
            )
            if item.get("application_id")
        )

    def _candidate_access_application_query(self, candidate_id=""):
        clauses = []
        job_ids = self._assigned_job_ids()
        interview_application_ids = self._assigned_interview_application_ids()
        if job_ids:
            clauses.append({"job_opening_id": {"$in": job_ids}})
        if interview_application_ids:
            object_ids = []
            for value in interview_application_ids:
                try:
                    object_ids.append(as_object_id(value, "application id"))
                except RecruitmentServiceError:
                    continue
            if object_ids:
                clauses.append({"_id": {"$in": object_ids}})
        query = self._q()
        if candidate_id:
            query["candidate_id"] = safe_str(candidate_id)
        query["$or"] = clauses or [{"_id": {"$exists": False}}]
        return query

    def _redact_candidate_for_hiring_team(self, candidate):
        result = deepcopy(dict(candidate or {}))
        for key in (
            "address",
            "current_salary",
            "expected_salary",
        ):
            result.pop(key, None)
        consent = clean_mapping(result.get("consent"))
        consent.pop("ip_address", None)
        result["consent"] = consent
        parser = clean_mapping(result.get("resume_parser"))
        parser.pop("raw_text", None)
        result["resume_parser"] = parser
        result["restricted_view"] = True
        return result

    def _parser_result_from_candidate(self, candidate):
        candidate = dict(candidate or {})
        parser = clean_mapping(candidate.get("resume_parser"))
        fields = {
            "full_name": candidate.get("full_name"),
            "email": candidate.get("email"),
            "phone": candidate.get("phone"),
            "location": candidate.get("location"),
            "current_designation": candidate.get("current_designation"),
            "current_employer": candidate.get("current_employer"),
            "total_experience_years": candidate.get("total_experience_years"),
            "skills": candidate.get("skills") or [],
            "education": candidate.get("education") or [],
            "employment_history": candidate.get("employment_history") or [],
            "certifications": candidate.get("certifications") or [],
            "summary": candidate.get("summary"),
        }
        return {
            "parser_version": parser.get("parser_version"),
            "parsed_at": parser.get("parsed_at"),
            "fields": fields,
            "sections": clean_mapping(parser.get("sections")),
            "warnings": unique_strings(parser.get("warnings") or []),
            "requires_manual_review": True,
        }

    def _resume_match_for_application(self, candidate, job):
        parser_result = self._parser_result_from_candidate(candidate)
        result = score_resume_match(parser_result, job)
        result["calculated_at"] = utcnow()
        result["match_version"] = result.get("match_version") or MATCH_VERSION
        return result

    def _public_resume_preview_fields(self, parser_result):
        fields = clean_mapping(clean_mapping(parser_result).get("fields"))
        allowed = {
            "full_name",
            "name",
            "first_name",
            "last_name",
            "email",
            "primary_email",
            "phone",
            "primary_phone",
            "location",
            "current_designation",
            "current_employer",
            "total_experience_years",
            "total_experience",
            "notice_period",
            "expected_salary",
            "linkedin_url",
            "github_url",
            "portfolio_url",
            "summary",
            "professional_summary",
            "skills",
            "education",
            "employment_history",
            "certifications",
            "languages",
        }
        return {
            key: deepcopy(value)
            for key, value in fields.items()
            if key in allowed
        }

    def preview_public_resume_match(self, job_slug, parser_result):
        if not self.allow_public_actions:
            raise RecruitmentServiceError(
                "Public recruitment access is disabled.",
                code="public_recruitment_access_denied",
                status_code=403,
            )
        job = self._c(JOB_OPENINGS).find_one(
            self._q({"public_slug": safe_str(job_slug), "status": "open"})
        )
        if not job:
            raise RecruitmentServiceError(
                "This job opening is not available.",
                code="job_opening_not_found",
                status_code=404,
            )
        parser_result = clean_mapping(parser_result)
        match = score_resume_match(parser_result, job)
        return {
            "ok": True,
            "job": self._public_job(job),
            "fields": self._public_resume_preview_fields(parser_result),
            "confidence": clean_mapping(parser_result.get("confidence")),
            "warnings": unique_strings(parser_result.get("warnings") or []),
            "requires_manual_review": True,
            "resume_match": match,
            "candidate_message": match.get("candidate_message"),
        }

    def find_duplicate_candidates(self,email="",phone="",resume_sha256="",exclude_candidate_id=""):
        conditions=[]
        if normalize_email(email):conditions.append({"normalized_email":normalize_email(email)})
        if normalize_phone(phone):conditions.append({"normalized_phone":normalize_phone(phone)})
        if safe_str(resume_sha256):conditions.append({"resume.sha256":safe_str(resume_sha256).lower()})
        if not conditions:return []
        q=self._q({"$or":conditions})
        if exclude_candidate_id:q["_id"]={"$ne":as_object_id(exclude_candidate_id,"candidate id")}
        return list(self._c(CANDIDATES).find(q).sort("updated_at",DESCENDING).limit(20))
    def create_candidate(self,payload,parser_result=None,resume_metadata=None,allow_existing_candidate_id="",public=False):
        if public:
            if not self.allow_public_actions: raise RecruitmentServiceError("Public recruitment access is disabled.",code="public_recruitment_access_denied",status_code=403)
        else:self._require_hr()
        data=dict(payload or {}); parsed=clean_mapping(parser_result); merged={**clean_mapping(parsed.get("fields")),**{k:v for k,v in data.items() if v not in (None,"")}}; name=safe_str(merged.get("full_name") or merged.get("name")); email=normalize_email(merged.get("email") or merged.get("primary_email")); phone=normalize_phone(merged.get("phone") or merged.get("primary_phone"))
        if not name: raise RecruitmentServiceError("Candidate name is required.",code="candidate_name_required")
        if not email and not phone: raise RecruitmentServiceError("Candidate email or phone is required.",code="candidate_contact_required")
        resume={**clean_mapping(parsed.get("source")),**clean_mapping(resume_metadata)}; duplicates=self.find_duplicate_candidates(email,phone,resume.get("sha256"))
        if duplicates:
            allowed=safe_str(allow_existing_candidate_id); match=next((d for d in duplicates if str(d["_id"])==allowed),None)
            if match:return match
            raise RecruitmentServiceError("A candidate with the same email, phone, or resume already exists in this company.",code="duplicate_candidate",status_code=409,details={"matches":[{"candidate_id":str(d["_id"]),"reference_no":d.get("reference_no"),"full_name":d.get("full_name"),"email":d.get("email"),"phone":d.get("phone")} for d in duplicates]})
        consent=clean_mapping(data.get("consent")); now=utcnow()
        if public and consent.get("accepted") is not True: raise RecruitmentServiceError("Candidate consent is required before storing the application.",code="candidate_consent_required")
        doc={"tenant_id":self.tenant_id,"reference_no":self._next("candidate","CAND"),"full_name":name,"first_name":safe_str(merged.get("first_name")),"last_name":safe_str(merged.get("last_name")),"email":email,"normalized_email":email,"alternate_emails":unique_strings(merged.get("alternate_emails") or []),"phone":phone,"normalized_phone":phone,"alternate_phones":unique_strings(merged.get("alternate_phones") or []),"location":safe_str(merged.get("location")),"address":safe_str(merged.get("address")),"linkedin_url":safe_str(merged.get("linkedin_url")),"github_url":safe_str(merged.get("github_url")),"portfolio_url":safe_str(merged.get("portfolio_url")),"summary":safe_str(merged.get("summary") or merged.get("professional_summary")),"current_designation":safe_str(merged.get("current_designation")),"current_employer":safe_str(merged.get("current_employer")),"total_experience_years":merged.get("total_experience_years"),"notice_period":safe_str(merged.get("notice_period")),"current_salary":safe_str(merged.get("current_salary")),"expected_salary":safe_str(merged.get("expected_salary")),"skills":unique_strings(merged.get("skills") or []),"education":clean_list(merged.get("education")),"employment_history":clean_list(merged.get("employment_history")),"certifications":unique_strings(merged.get("certifications") or []),"languages":unique_strings(merged.get("languages") or []),"resume":resume,"resume_parser":{"parser_version":parsed.get("parser_version"),"parsed_at":parsed.get("parsed_at"),"confidence":clean_mapping(parsed.get("confidence")),"warnings":unique_strings(parsed.get("warnings") or []),"requires_manual_review":bool(parsed.get("requires_manual_review",True)),"reviewed":bool(data.get("parser_reviewed")),"reviewed_by":self.actor_id if data.get("parser_reviewed") else "","reviewed_at":now if data.get("parser_reviewed") else None,"raw_text":safe_str(parsed.get("raw_text"))[:100000],"sections":clean_mapping(parsed.get("sections"))},"source":normalize_key(data.get("source") or self._settings().get("default_application_source") or "manual"),"source_detail":safe_str(data.get("source_detail")),"consent":{"accepted":bool(consent.get("accepted")),"text_version":safe_str(consent.get("text_version")),"accepted_at":now if consent.get("accepted") else None,"ip_address":safe_str(consent.get("ip_address"))},"retention_until":(now+timedelta(days=int(self._settings().get("candidate_retention_days") or 730))).date().isoformat(),"application_count":0,"latest_application_status":"","created_at":now,"updated_at":now,"created_by":self.actor_id or "public_candidate","created_by_name":self.actor_name if self.actor_id else name,"updated_by":self.actor_id or "public_candidate","updated_by_name":self.actor_name if self.actor_id else name,"is_deleted":False}
        result=self._c(CANDIDATES).insert_one(doc); doc["_id"]=result.inserted_id; self._activity("created","candidate",doc["_id"],message=f"Candidate {doc['reference_no']} was created.",details={"source":doc["source"],"public":public}); return doc
    def get_candidate(self, candidate_id):
        self._require_reader()
        candidate = self._get(CANDIDATES, candidate_id, "Candidate")
        if self._has(HR_ROLES):
            return candidate
        accessible = self._c(APPLICATIONS).find_one(
            self._candidate_access_application_query(str(candidate["_id"])),
            {"_id": 1},
        )
        if not accessible:
            raise RecruitmentServiceError(
                "You are not assigned to a job or interview for this candidate.",
                code="candidate_access_denied",
                status_code=403,
            )
        return self._redact_candidate_for_hiring_team(candidate)

    def list_candidates(self, search="", skill="", page=1, page_size=25):
        self._require_reader()
        q = self._q()
        if not self._has(HR_ROLES):
            applications = list(
                self._c(APPLICATIONS).find(
                    self._candidate_access_application_query(),
                    {"candidate_id": 1},
                )
            )
            candidate_ids = []
            for application in applications:
                try:
                    candidate_ids.append(
                        as_object_id(
                            application.get("candidate_id"),
                            "candidate id",
                        )
                    )
                except RecruitmentServiceError:
                    continue
            q["_id"] = {"$in": candidate_ids}
        if search:
            x = re.escape(safe_str(search))
            q["$or"] = [
                {"reference_no": {"$regex": x, "$options": "i"}},
                {"full_name": {"$regex": x, "$options": "i"}},
                {"email": {"$regex": x, "$options": "i"}},
                {"phone": {"$regex": x, "$options": "i"}},
                {
                    "current_designation": {
                        "$regex": x,
                        "$options": "i",
                    }
                },
            ]
        if skill:
            q["skills"] = {
                "$regex": re.escape(safe_str(skill)),
                "$options": "i",
            }
        result = self._paged(CANDIDATES, q, page, page_size)
        if not self._has(HR_ROLES):
            result["items"] = [
                self._redact_candidate_for_hiring_team(item)
                for item in result["items"]
            ]
        return result

    # ------------------------------------------------------------------
    # Applications
    # ------------------------------------------------------------------
    def create_application(self, payload, *, public=False):
        data = dict(payload or {})
        if public:
            if not self.allow_public_actions:
                raise RecruitmentServiceError(
                    "Public recruitment access is disabled.",
                    code="public_recruitment_access_denied",
                    status_code=403,
                )
        else:
            self._require_hr()

        candidate = self._get(CANDIDATES, data.get("candidate_id"), "Candidate")
        job = self._get(JOB_OPENINGS, data.get("job_opening_id"), "Job opening")
        if public and normalize_key(job.get("status")) != "open":
            raise RecruitmentServiceError(
                "This job opening is not accepting applications.",
                code="job_opening_not_open",
                status_code=409,
            )

        existing = self._c(APPLICATIONS).find_one(
            self._q({
                "candidate_id": str(candidate["_id"]),
                "job_opening_id": str(job["_id"]),
            })
        )
        if existing:
            raise RecruitmentServiceError(
                "This candidate has already applied for this job opening.",
                code="duplicate_job_application",
                status_code=409,
                details={"application_id": str(existing["_id"])},
            )

        now = utcnow()
        reference_no = self._next("application", "APP")
        source = normalize_key(
            data.get("source")
            or candidate.get("source")
            or self._settings().get("default_application_source")
            or "manual"
        )
        resume_match = self._resume_match_for_application(candidate, job)
        doc = {
            "tenant_id": self.tenant_id,
            "reference_no": reference_no,
            "candidate_id": str(candidate["_id"]),
            "candidate_reference": candidate.get("reference_no"),
            "candidate_name": candidate.get("full_name"),
            "candidate_email": candidate.get("email"),
            "candidate_phone": candidate.get("phone"),
            "job_opening_id": str(job["_id"]),
            "job_reference": job.get("reference_no"),
            "job_title": job.get("job_title"),
            "department": job.get("department"),
            "department_id": job.get("department_id"),
            "recruiter_user_id": job.get("recruiter_user_id"),
            "recruiter_name": job.get("recruiter_name"),
            "hiring_manager_user_id": job.get("hiring_manager_user_id"),
            "hiring_manager_name": job.get("hiring_manager_name"),
            "source": source,
            "source_detail": safe_str(data.get("source_detail")),
            "employee_referral_user_id": safe_str(data.get("employee_referral_user_id")),
            "cover_letter": safe_str(data.get("cover_letter"))[:20000],
            "screening_answers": clean_list(data.get("screening_answers"), limit=50),
            "screening_notes": "",
            "screening_outcome": "",
            "resume_match": resume_match,
            "resume_match_score": int(resume_match.get("score") or 0),
            "resume_match_band": safe_str(resume_match.get("band")),
            "resume_match_version": safe_str(
                resume_match.get("match_version") or MATCH_VERSION
            ),
            "resume_match_calculated_at": resume_match.get("calculated_at"),
            "resume_match_human_review_required": True,
            "screened_at": None,
            "screened_by": "",
            "status": "applied",
            "stage": "applied",
            "status_reason": "",
            "status_history": [],
            "applied_at": now,
            "selected_at": None,
            "offer_accepted_at": None,
            "ready_to_join_at": None,
            "joining_date": "",
            "actual_joining_date": "",
            "joining_status": "",
            "converted_employee_id": "",
            "converted_user_id": "",
            "converted_at": None,
            "pre_joining_token_hash": "",
            "pre_joining_token_expires_at": None,
            "created_at": now,
            "updated_at": now,
            "created_by": self.actor_id or "public_candidate",
            "created_by_name": self.actor_name if self.actor_id else candidate.get("full_name"),
            "updated_by": self.actor_id or "public_candidate",
            "updated_by_name": self.actor_name if self.actor_id else candidate.get("full_name"),
            "is_deleted": False,
        }
        try:
            result = self._c(APPLICATIONS).insert_one(doc)
        except DuplicateKeyError as exc:
            raise RecruitmentServiceError(
                "This candidate has already applied for this job opening.",
                code="duplicate_job_application",
                status_code=409,
            ) from exc

        doc["_id"] = result.inserted_id
        self._c(CANDIDATES).update_one(
            {"_id": candidate["_id"], "tenant_id": self.tenant_id},
            {
                "$inc": {"application_count": 1},
                "$set": {
                    "latest_application_status": "applied",
                    "updated_at": now,
                    "updated_by": self.actor_id or "public_candidate",
                    "updated_by_name": self.actor_name if self.actor_id else candidate.get("full_name"),
                },
            },
        )
        self._activity(
            "created",
            "application",
            doc["_id"],
            application_id=doc["_id"],
            message=f"Application {reference_no} was created for {job.get('job_title')}.",
            new="applied",
            details={"public": public, "source": source},
        )

        recipients = unique_strings([
            job.get("recruiter_user_id"),
            job.get("hiring_manager_user_id"),
        ])
        self._notify(
            recipients,
            title="New recruitment application",
            body=f"{candidate.get('full_name')} applied for {job.get('job_title')}.",
            target="recruitment_candidates",
            entity_type="application",
            entity_id=doc["_id"],
            application_id=doc["_id"],
            priority="normal",
        )
        if self._settings().get("email_candidate_on_application") and candidate.get("email"):
            self._email(
                "send_recruitment_application_received_email",
                to_email=candidate.get("email"),
                candidate_name=candidate.get("full_name"),
                company_name=self._company_name(),
                job_title=job.get("job_title"),
                application_reference=reference_no,
                reply_to=self._reply_to(),
            )
        return doc

    def get_application(self, application_id):
        self._require_reader()
        application = self._get(APPLICATIONS, application_id, "Application")
        if not self._has(HR_ROLES):
            accessible = self._c(APPLICATIONS).find_one(
                {
                    **self._candidate_access_application_query(),
                    "_id": application["_id"],
                },
                {"_id": 1},
            )
            if not accessible and not self._has(FINANCE_ROLES):
                raise RecruitmentServiceError(
                    "You are not assigned to this recruitment application.",
                    code="application_access_denied",
                    status_code=403,
                )
        return application

    def list_applications(
        self,
        *,
        job_opening_id="",
        status="",
        source="",
        search="",
        page=1,
        page_size=25,
    ):
        self._require_reader()
        query = self._q()
        if job_opening_id:
            query["job_opening_id"] = str(as_object_id(job_opening_id, "job opening id"))
        if status:
            query["status"] = normalize_key(status)
        if source:
            query["source"] = normalize_key(source)
        if search:
            regex = re.escape(safe_str(search))
            query["$or"] = [
                {"reference_no": {"$regex": regex, "$options": "i"}},
                {"candidate_name": {"$regex": regex, "$options": "i"}},
                {"candidate_email": {"$regex": regex, "$options": "i"}},
                {"candidate_phone": {"$regex": regex, "$options": "i"}},
                {"job_title": {"$regex": regex, "$options": "i"}},
            ]

        if not self._has(HR_ROLES):
            access_query = self._candidate_access_application_query()
            access_clause = access_query.pop("$or")
            query.setdefault("$and", []).append({"$or": access_clause})
        return self._paged(APPLICATIONS, query, page, page_size)

    def update_screening(self, application_id, payload):
        self._require_hr()
        application = self._get(APPLICATIONS, application_id, "Application")
        data = dict(payload or {})
        outcome = normalize_key(data.get("outcome") or data.get("screening_outcome"))
        allowed = {"shortlisted", "on_hold", "rejected", "under_review"}
        if outcome not in allowed:
            raise RecruitmentServiceError(
                "Screening outcome must be shortlisted, under review, on hold, or rejected.",
                code="invalid_screening_outcome",
            )
        reason = safe_str(data.get("reason"))
        if outcome in {"on_hold", "rejected"} and not reason:
            raise RecruitmentServiceError(
                "A written reason is required for this screening outcome.",
                code="screening_reason_required",
            )
        self._c(APPLICATIONS).update_one(
            {"_id": application["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "screening_notes": safe_str(data.get("notes"))[:20000],
                "screening_outcome": outcome,
                "screened_at": utcnow(),
                "screened_by": self.actor_id,
                "screened_by_name": self.actor_name,
            }},
        )
        return self.change_application_status(application["_id"], outcome, reason=reason)

    def change_application_status(self, application_id, status, *, reason="", notes=""):
        self._require_hr()
        application = self._get(APPLICATIONS, application_id, "Application")
        old, new = self._transition(
            application.get("status"), status, APPLICATION_TRANSITIONS, "Application"
        )
        reason = safe_str(reason)
        if new in {"rejected", "on_hold", "withdrawn", "did_not_join", "joining_deferred"} and not reason:
            raise RecruitmentServiceError(
                "A written reason is required for this status.",
                code="application_status_reason_required",
            )

        now = utcnow()
        update = {
            "status": new,
            "stage": new,
            "status_reason": reason,
            "stage_notes": safe_str(notes)[:20000],
            "updated_at": now,
            "updated_by": self.actor_id,
            "updated_by_name": self.actor_name,
        }
        if new == "selected":
            update["selected_at"] = now
            update["selected_by"] = self.actor_id
            update["selected_by_name"] = self.actor_name
        if new == "ready_to_join":
            update["ready_to_join_at"] = now
            update["joining_status"] = "ready_to_join"
        if new in JOINING_STATUSES:
            update["joining_status"] = new
        self._c(APPLICATIONS).update_one(
            {"_id": application["_id"], "tenant_id": self.tenant_id},
            {"$set": update},
        )
        self._history(APPLICATIONS, application["_id"], old, new, reason)
        self._activity(
            "status_changed",
            "application",
            application["_id"],
            application_id=application["_id"],
            message=f"Application moved to {new.replace('_', ' ')}.",
            old=old,
            new=new,
            details={"reason": reason, "notes": safe_str(notes)},
        )
        self._c(CANDIDATES).update_one(
            self._q({"_id": as_object_id(application.get("candidate_id"), "candidate id")}),
            {"$set": {"latest_application_status": new, "updated_at": now}},
        )

        if new == "rejected" and self._settings().get("email_candidate_on_rejection"):
            candidate = self._get(CANDIDATES, application.get("candidate_id"), "Candidate")
            if candidate.get("email"):
                self._email(
                    "send_recruitment_rejection_email",
                    to_email=candidate.get("email"),
                    candidate_name=candidate.get("full_name"),
                    company_name=self._company_name(),
                    job_title=application.get("job_title"),
                    message=safe_str(notes) or None,
                    future_opportunities=True,
                    reply_to=self._reply_to(),
                )
        return self._get(APPLICATIONS, application["_id"], "Application")

    # ------------------------------------------------------------------
    # Interviews and interviewer feedback
    # ------------------------------------------------------------------
    def schedule_interview(self, application_id, payload):
        self._require_hr()
        application = self._get(APPLICATIONS, application_id, "Application")
        current = normalize_key(application.get("status"))
        allowed_application_stages = {
            "shortlisted", "on_hold", "interview_scheduled", "interviewed"
        }
        if current not in allowed_application_stages:
            raise RecruitmentServiceError(
                "The candidate must be shortlisted before an interview is scheduled.",
                code="application_not_ready_for_interview",
                status_code=409,
            )

        data = dict(payload or {})
        scheduled_at = parse_datetime(data.get("scheduled_at"), "scheduled_at", required=True)
        if scheduled_at <= utcnow() - timedelta(minutes=5):
            raise RecruitmentServiceError(
                "Interview time must be in the future.",
                code="invalid_interview_time",
            )
        interviewer_ids = unique_strings(data.get("interviewer_user_ids") or [])
        if not interviewer_ids:
            raise RecruitmentServiceError(
                "Select at least one interviewer.",
                code="interviewer_required",
            )
        users = self._active_users(interviewer_ids)
        valid_ids = {str(user["_id"]) for user in users}
        if valid_ids != set(interviewer_ids):
            raise RecruitmentServiceError(
                "One or more selected interviewers are invalid or inactive.",
                code="invalid_interviewer",
            )

        round_key = normalize_key(data.get("round_key") or data.get("interview_round") or "interview")
        round_label = safe_str(data.get("round_label") or data.get("interview_round") or round_key.replace("_", " ").title())
        sequence_no = int(data.get("sequence_no") or self._c(INTERVIEWS).count_documents(
            self._q({"application_id": str(application["_id"])})
        ) + 1)
        duration_minutes = int(data.get("duration_minutes") or 45)
        if duration_minutes < 10 or duration_minutes > 480:
            raise RecruitmentServiceError(
                "Interview duration must be between 10 and 480 minutes.",
                code="invalid_interview_duration",
            )

        now = utcnow()
        doc = {
            "tenant_id": self.tenant_id,
            "reference_no": self._next("interview", "INT"),
            "application_id": str(application["_id"]),
            "application_reference": application.get("reference_no"),
            "candidate_id": application.get("candidate_id"),
            "candidate_name": application.get("candidate_name"),
            "candidate_email": application.get("candidate_email"),
            "job_opening_id": application.get("job_opening_id"),
            "job_title": application.get("job_title"),
            "round_key": round_key,
            "round_label": round_label,
            "sequence_no": sequence_no,
            "scheduled_at": scheduled_at,
            "duration_minutes": duration_minutes,
            "timezone": safe_str(data.get("timezone") or "Asia/Kolkata"),
            "mode": normalize_key(data.get("mode") or "online"),
            "location": safe_str(data.get("location")),
            "meeting_link": safe_str(data.get("meeting_link")),
            "interviewer_user_ids": interviewer_ids,
            "interviewers": [
                {
                    "user_id": str(user["_id"]),
                    "name": safe_str(user.get("name") or user.get("full_name") or user.get("email")),
                    "email": normalize_email(user.get("email")),
                }
                for user in users
            ],
            "candidate_notes": safe_str(data.get("candidate_notes"))[:10000],
            "internal_notes": safe_str(data.get("internal_notes"))[:10000],
            "feedback_due_at": parse_datetime(data.get("feedback_due_at"), "feedback_due_at")
                or scheduled_at + timedelta(hours=24),
            "status": "scheduled",
            "status_history": [],
            "feedback_count": 0,
            "created_at": now,
            "updated_at": now,
            "created_by": self.actor_id,
            "created_by_name": self.actor_name,
            "updated_by": self.actor_id,
            "updated_by_name": self.actor_name,
            "is_deleted": False,
        }
        result = self._c(INTERVIEWS).insert_one(doc)
        doc["_id"] = result.inserted_id

        self._c(APPLICATIONS).update_one(
            {"_id": application["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "status": "interview_scheduled",
                "stage": "interview_scheduled",
                "next_interview_at": scheduled_at,
                "updated_at": now,
                "updated_by": self.actor_id,
                "updated_by_name": self.actor_name,
            }},
        )
        if current != "interview_scheduled":
            self._history(APPLICATIONS, application["_id"], current, "interview_scheduled")
        self._activity(
            "scheduled",
            "interview",
            doc["_id"],
            application_id=application["_id"],
            message=f"{round_label} was scheduled.",
            new="scheduled",
            details={"scheduled_at": scheduled_at.isoformat(), "interviewer_user_ids": interviewer_ids},
        )

        candidate = self._get(CANDIDATES, application.get("candidate_id"), "Candidate")
        interviewer_names = [item["name"] for item in doc["interviewers"]]
        date_text = scheduled_at.strftime("%d %B %Y")
        time_text = scheduled_at.strftime("%I:%M %p")
        location_or_link = doc.get("meeting_link") or doc.get("location")
        if self._settings().get("email_candidate_on_interview") and candidate.get("email"):
            self._email(
                "send_recruitment_interview_invitation_email",
                to_email=candidate.get("email"),
                candidate_name=candidate.get("full_name"),
                company_name=self._company_name(),
                job_title=application.get("job_title"),
                interview_round=round_label,
                interview_date=date_text,
                interview_time=time_text,
                interview_mode=doc.get("mode"),
                location_or_meeting_link=location_or_link,
                interviewer_names=interviewer_names,
                notes=doc.get("candidate_notes"),
                reply_to=self._reply_to(),
            )
        for user in users:
            self._email(
                "send_recruitment_interviewer_assignment_email",
                to_email=user.get("email"),
                interviewer_name=user.get("name") or user.get("full_name") or user.get("email"),
                company_name=self._company_name(),
                candidate_name=candidate.get("full_name"),
                job_title=application.get("job_title"),
                interview_round=round_label,
                interview_date=date_text,
                interview_time=time_text,
                interview_mode=doc.get("mode"),
                location_or_meeting_link=location_or_link,
                feedback_due=doc.get("feedback_due_at").strftime("%d %B %Y, %I:%M %p"),
                reply_to=self._reply_to(),
            )
        self._notify(
            interviewer_ids,
            title="Interview assigned",
            body=f"You are assigned to interview {candidate.get('full_name')} for {application.get('job_title')}.",
            target="recruitment_interviews",
            entity_type="interview",
            entity_id=doc["_id"],
            application_id=application["_id"],
            priority="high",
            popup=True,
        )
        return doc

    def reschedule_interview(self, interview_id, payload):
        self._require_hr()
        interview = self._get(INTERVIEWS, interview_id, "Interview")
        old, new = self._transition(
            interview.get("status"), "rescheduled", INTERVIEW_TRANSITIONS, "Interview"
        )
        data = dict(payload or {})
        scheduled_at = parse_datetime(data.get("scheduled_at"), "scheduled_at", required=True)
        if scheduled_at <= utcnow() - timedelta(minutes=5):
            raise RecruitmentServiceError(
                "Interview time must be in the future.",
                code="invalid_interview_time",
            )
        reason = safe_str(data.get("reason"))
        if not reason:
            raise RecruitmentServiceError(
                "A reason is required when an interview is rescheduled.",
                code="interview_reschedule_reason_required",
            )
        now = utcnow()
        update = {
            "scheduled_at": scheduled_at,
            "duration_minutes": int(data.get("duration_minutes") or interview.get("duration_minutes") or 45),
            "mode": normalize_key(data.get("mode") or interview.get("mode")),
            "location": safe_str(data.get("location") if "location" in data else interview.get("location")),
            "meeting_link": safe_str(data.get("meeting_link") if "meeting_link" in data else interview.get("meeting_link")),
            "candidate_notes": safe_str(data.get("candidate_notes") if "candidate_notes" in data else interview.get("candidate_notes"))[:10000],
            "feedback_due_at": parse_datetime(data.get("feedback_due_at"), "feedback_due_at")
                or scheduled_at + timedelta(hours=24),
            "status": new,
            "status_reason": reason,
            "updated_at": now,
            "updated_by": self.actor_id,
            "updated_by_name": self.actor_name,
        }
        self._c(INTERVIEWS).update_one(
            {"_id": interview["_id"], "tenant_id": self.tenant_id},
            {"$set": update},
        )
        self._history(INTERVIEWS, interview["_id"], old, new, reason)
        self._activity(
            "rescheduled",
            "interview",
            interview["_id"],
            application_id=interview.get("application_id"),
            message=f"{interview.get('round_label')} was rescheduled.",
            old=old,
            new=new,
            details={"reason": reason, "scheduled_at": scheduled_at.isoformat()},
        )
        candidate = self._get(CANDIDATES, interview.get("candidate_id"), "Candidate")
        if candidate.get("email"):
            self._email(
                "send_recruitment_interview_rescheduled_email",
                to_email=candidate.get("email"),
                candidate_name=candidate.get("full_name"),
                company_name=self._company_name(),
                job_title=interview.get("job_title"),
                interview_round=interview.get("round_label"),
                interview_date=scheduled_at.strftime("%d %B %Y"),
                interview_time=scheduled_at.strftime("%I:%M %p"),
                interview_mode=update.get("mode"),
                location_or_meeting_link=update.get("meeting_link") or update.get("location"),
                interviewer_names=[item.get("name") for item in interview.get("interviewers") or []],
                notes=update.get("candidate_notes"),
                reply_to=self._reply_to(),
            )
        self._notify(
            interview.get("interviewer_user_ids") or [],
            title="Interview rescheduled",
            body=f"The interview with {candidate.get('full_name')} has been rescheduled.",
            target="recruitment_interviews",
            entity_type="interview",
            entity_id=interview["_id"],
            application_id=interview.get("application_id"),
            priority="high",
            popup=True,
        )
        return self._get(INTERVIEWS, interview["_id"], "Interview")

    def change_interview_status(self, interview_id, status, *, reason=""):
        self._auth()
        interview = self._get(INTERVIEWS, interview_id, "Interview")
        if not self._has(HR_ROLES) and self.actor_id not in unique_strings(interview.get("interviewer_user_ids") or []):
            raise RecruitmentServiceError(
                "Only HR or an assigned interviewer can update this interview.",
                code="interview_update_access_denied",
                status_code=403,
            )
        old, new = self._transition(interview.get("status"), status, INTERVIEW_TRANSITIONS, "Interview")
        reason = safe_str(reason)
        if new in {"cancelled", "candidate_absent", "interviewer_absent"} and not reason:
            raise RecruitmentServiceError(
                "A written reason is required for this interview status.",
                code="interview_status_reason_required",
            )
        now = utcnow()
        update = {
            "status": new,
            "status_reason": reason,
            "updated_at": now,
            "updated_by": self.actor_id,
            "updated_by_name": self.actor_name,
        }
        if new == "completed":
            update["completed_at"] = now
        self._c(INTERVIEWS).update_one(
            {"_id": interview["_id"], "tenant_id": self.tenant_id},
            {"$set": update},
        )
        self._history(INTERVIEWS, interview["_id"], old, new, reason)
        self._activity(
            "status_changed",
            "interview",
            interview["_id"],
            application_id=interview.get("application_id"),
            message=f"Interview moved to {new.replace('_', ' ')}.",
            old=old,
            new=new,
            details={"reason": reason},
        )
        application = self._get(APPLICATIONS, interview.get("application_id"), "Application")
        if new == "completed" and normalize_key(application.get("status")) == "interview_scheduled":
            self._c(APPLICATIONS).update_one(
                {"_id": application["_id"], "tenant_id": self.tenant_id},
                {"$set": {
                    "status": "interviewed",
                    "stage": "interviewed",
                    "last_interview_at": now,
                    "updated_at": now,
                }},
            )
            self._history(APPLICATIONS, application["_id"], "interview_scheduled", "interviewed")
        if new == "cancelled":
            candidate = self._get(CANDIDATES, interview.get("candidate_id"), "Candidate")
            if candidate.get("email"):
                self._email(
                    "send_recruitment_interview_cancelled_email",
                    to_email=candidate.get("email"),
                    candidate_name=candidate.get("full_name"),
                    company_name=self._company_name(),
                    job_title=interview.get("job_title"),
                    interview_round=interview.get("round_label"),
                    reason=reason,
                    reply_to=self._reply_to(),
                )
        return self._get(INTERVIEWS, interview["_id"], "Interview")

    def submit_interview_feedback(self, interview_id, payload):
        self._auth()
        interview = self._get(INTERVIEWS, interview_id, "Interview")
        assigned = self.actor_id in unique_strings(interview.get("interviewer_user_ids") or [])
        if not assigned and not self._has(HR_ROLES):
            raise RecruitmentServiceError(
                "You are not assigned to submit feedback for this interview.",
                code="interview_feedback_access_denied",
                status_code=403,
            )
        if normalize_key(interview.get("status")) not in {"completed", "scheduled", "rescheduled"}:
            raise RecruitmentServiceError(
                "Feedback cannot be submitted for this interview status.",
                code="interview_feedback_not_allowed",
                status_code=409,
            )

        data = dict(payload or {})
        settings = self._settings()
        rating_min = int(settings.get("feedback_rating_min") or 1)
        rating_max = int(settings.get("feedback_rating_max") or 5)
        required_areas = unique_strings(settings.get("feedback_required_areas") or [])
        ratings = clean_mapping(data.get("ratings"))
        cleaned_ratings = {}
        for area in required_areas:
            value = ratings.get(area)
            if value in (None, ""):
                raise RecruitmentServiceError(
                    f"Rating is required for {area.replace('_', ' ')}.",
                    code="interview_feedback_rating_required",
                    details={"area": area},
                )
            score = as_float(value, area, rating_min)
            if score > rating_max:
                raise RecruitmentServiceError(
                    f"Rating for {area.replace('_', ' ')} cannot exceed {rating_max}.",
                    code="invalid_interview_feedback_rating",
                )
            cleaned_ratings[area] = score
        for area, value in ratings.items():
            key = normalize_key(area)
            if key not in cleaned_ratings and value not in (None, ""):
                score = as_float(value, key, rating_min)
                if score > rating_max:
                    raise RecruitmentServiceError(
                        f"Rating for {key.replace('_', ' ')} cannot exceed {rating_max}.",
                        code="invalid_interview_feedback_rating",
                    )
                cleaned_ratings[key] = score

        recommendation = normalize_key(data.get("recommendation"))
        if recommendation not in RECOMMENDATIONS:
            raise RecruitmentServiceError(
                "Final recommendation must be Strong Hire, Hire, Hold, or Reject.",
                code="invalid_interview_recommendation",
            )
        comments = safe_str(data.get("comments") or data.get("reason"))
        if not comments:
            raise RecruitmentServiceError(
                "Written feedback is required.",
                code="interview_feedback_comments_required",
            )

        now = utcnow()
        query = self._q({
            "interview_id": str(interview["_id"]),
            "interviewer_user_id": self.actor_id,
        })
        existing = self._c(FEEDBACK).find_one(query)
        version = int((existing or {}).get("version") or 0) + 1
        doc = {
            "tenant_id": self.tenant_id,
            "interview_id": str(interview["_id"]),
            "interview_reference": interview.get("reference_no"),
            "application_id": interview.get("application_id"),
            "candidate_id": interview.get("candidate_id"),
            "job_opening_id": interview.get("job_opening_id"),
            "round_key": interview.get("round_key"),
            "round_label": interview.get("round_label"),
            "interviewer_user_id": self.actor_id,
            "interviewer_name": self.actor_name,
            "ratings": cleaned_ratings,
            "overall_rating": round(sum(cleaned_ratings.values()) / max(1, len(cleaned_ratings)), 2),
            "comments": comments[:30000],
            "strengths": unique_strings(data.get("strengths") or [], limit=30),
            "concerns": unique_strings(data.get("concerns") or [], limit=30),
            "recommendation": recommendation,
            "version": version,
            "submitted_at": now,
            "updated_at": now,
            "updated_by": self.actor_id,
            "updated_by_name": self.actor_name,
            "is_deleted": False,
        }
        if existing:
            self._c(FEEDBACK).update_one(
                {"_id": existing["_id"], "tenant_id": self.tenant_id},
                {
                    "$set": doc,
                    "$push": {
                        "revision_history": {
                            "version": existing.get("version", 1),
                            "ratings": existing.get("ratings"),
                            "comments": existing.get("comments"),
                            "strengths": existing.get("strengths"),
                            "concerns": existing.get("concerns"),
                            "recommendation": existing.get("recommendation"),
                            "revised_at": now,
                            "revised_by": self.actor_id,
                            "revised_by_name": self.actor_name,
                        }
                    },
                },
            )
            feedback_id = existing["_id"]
            action = "feedback_revised"
        else:
            doc["created_at"] = now
            doc["created_by"] = self.actor_id
            doc["created_by_name"] = self.actor_name
            result = self._c(FEEDBACK).insert_one(doc)
            feedback_id = result.inserted_id
            action = "feedback_submitted"

        count = self._c(FEEDBACK).count_documents(
            self._q({"interview_id": str(interview["_id"])})
        )
        self._c(INTERVIEWS).update_one(
            {"_id": interview["_id"], "tenant_id": self.tenant_id},
            {"$set": {"feedback_count": count, "updated_at": now}},
        )
        self._activity(
            action,
            "interview_feedback",
            feedback_id,
            application_id=interview.get("application_id"),
            message=f"Feedback was submitted for {interview.get('round_label')}.",
            details={"recommendation": recommendation, "overall_rating": doc["overall_rating"]},
        )
        return self._c(FEEDBACK).find_one({"_id": feedback_id, "tenant_id": self.tenant_id})

    def list_interviews(self, *, application_id="", status="", from_date="", to_date="", page=1, page_size=25):
        self._require_reader()
        query = self._q()
        if application_id:
            query["application_id"] = str(as_object_id(application_id, "application id"))
        if status:
            query["status"] = normalize_key(status)
        date_filter = {}
        if from_date:
            parsed = parse_date(from_date, "from_date", required=True)
            date_filter["$gte"] = datetime.fromisoformat(parsed)
        if to_date:
            parsed = parse_date(to_date, "to_date", required=True)
            date_filter["$lt"] = datetime.fromisoformat(parsed) + timedelta(days=1)
        if date_filter:
            query["scheduled_at"] = date_filter
        if not self._has(HR_ROLES):
            query["interviewer_user_ids"] = self.actor_id
        return self._paged(
            INTERVIEWS,
            query,
            page,
            page_size,
            sort=[("scheduled_at", ASCENDING), ("created_at", DESCENDING)],
        )

    def list_interview_feedback(self, interview_id):
        self._require_reader()
        interview = self._get(INTERVIEWS, interview_id, "Interview")
        if not self._has(HR_ROLES) and self.actor_id not in unique_strings(interview.get("interviewer_user_ids") or []):
            raise RecruitmentServiceError(
                "You are not assigned to this interview.",
                code="interview_feedback_access_denied",
                status_code=403,
            )
        return list(
            self._c(FEEDBACK).find(
                self._q({"interview_id": str(interview["_id"])}),
            ).sort("submitted_at", ASCENDING)
        )

    # ------------------------------------------------------------------
    # Offers
    # ------------------------------------------------------------------
    def create_offer(self, application_id, payload):
        self._require_hr()
        application = self._get(APPLICATIONS, application_id, "Application")
        current = normalize_key(application.get("status"))
        if current not in {"selected", "offer_pending", "offer_expired"}:
            raise RecruitmentServiceError(
                "An offer can only be prepared for a selected candidate.",
                code="application_not_selected",
                status_code=409,
            )
        data = dict(payload or {})
        designation = safe_str(data.get("designation") or application.get("job_title"))
        department = safe_str(data.get("department") or application.get("department"))
        joining_date = parse_date(data.get("joining_date"), "joining_date", required=True)
        response_deadline = parse_date(data.get("response_deadline"), "response_deadline", required=True)
        if response_deadline < date.today().isoformat():
            raise RecruitmentServiceError(
                "Offer response deadline cannot be in the past.",
                code="invalid_offer_response_deadline",
            )
        if joining_date < response_deadline:
            raise RecruitmentServiceError(
                "Joining date cannot be before the offer response deadline.",
                code="invalid_offer_joining_date",
            )
        salary = clean_mapping(data.get("salary"))
        if not salary and not safe_str(data.get("salary_summary")):
            raise RecruitmentServiceError(
                "Approved salary details are required before preparing the offer.",
                code="offer_salary_required",
            )

        existing = self._c(OFFERS).find_one(
            self._q({"application_id": str(application["_id"])})
        )
        now = utcnow()
        terms = {
            "designation": designation,
            "department": department,
            "reporting_manager_user_id": safe_str(data.get("reporting_manager_user_id")),
            "reporting_manager_name": safe_str(data.get("reporting_manager_name")),
            "work_location": safe_str(data.get("work_location")),
            "employment_type": normalize_key(data.get("employment_type") or "permanent"),
            "probation_period": safe_str(data.get("probation_period")),
            "joining_date": joining_date,
            "response_deadline": response_deadline,
            "salary": salary,
            "salary_summary": safe_str(data.get("salary_summary")),
            "currency": safe_str(data.get("currency") or self._settings().get("default_currency") or "INR"),
            "offer_message": safe_str(data.get("offer_message"))[:20000],
            "template_key": normalize_key(data.get("template_key") or "default"),
            "offer_file": clean_mapping(data.get("offer_file")),
        }
        if existing:
            if normalize_key(existing.get("status")) in {"sent", "accepted", "declined"}:
                raise RecruitmentServiceError(
                    "A sent or responded offer cannot be overwritten. Withdraw it before preparing a replacement.",
                    code="offer_locked",
                    status_code=409,
                )
            previous_version = int(existing.get("version") or 1)
            self._c(OFFERS).update_one(
                {"_id": existing["_id"], "tenant_id": self.tenant_id},
                {
                    "$push": {
                        "versions": {
                            "version": previous_version,
                            "terms": existing.get("terms"),
                            "status": existing.get("status"),
                            "saved_at": existing.get("updated_at") or existing.get("created_at"),
                            "saved_by": existing.get("updated_by") or existing.get("created_by"),
                            "saved_by_name": existing.get("updated_by_name") or existing.get("created_by_name"),
                        }
                    },
                    "$set": {
                        "terms": terms,
                        "status": "draft",
                        "version": previous_version + 1,
                        "approval_user_ids": [],
                        "approval_history": [],
                        "response_token_hash": "",
                        "response_token_expires_at": None,
                        "updated_at": now,
                        "updated_by": self.actor_id,
                        "updated_by_name": self.actor_name,
                    },
                },
            )
            offer = self._get(OFFERS, existing["_id"], "Offer")
            action = "revised"
        else:
            doc = {
                "tenant_id": self.tenant_id,
                "reference_no": self._next("offer", "OFF"),
                "application_id": str(application["_id"]),
                "application_reference": application.get("reference_no"),
                "candidate_id": application.get("candidate_id"),
                "candidate_name": application.get("candidate_name"),
                "candidate_email": application.get("candidate_email"),
                "job_opening_id": application.get("job_opening_id"),
                "job_title": application.get("job_title"),
                "terms": terms,
                "version": 1,
                "versions": [],
                "status": "draft",
                "status_history": [],
                "approval_user_ids": [],
                "approval_history": [],
                "response_token_hash": "",
                "response_token_expires_at": None,
                "response_status": "",
                "response_reason": "",
                "sent_at": None,
                "viewed_at": None,
                "responded_at": None,
                "created_at": now,
                "updated_at": now,
                "created_by": self.actor_id,
                "created_by_name": self.actor_name,
                "updated_by": self.actor_id,
                "updated_by_name": self.actor_name,
                "is_deleted": False,
            }
            result = self._c(OFFERS).insert_one(doc)
            doc["_id"] = result.inserted_id
            offer = doc
            action = "created"

        app_update = {"updated_at": now, "updated_by": self.actor_id, "updated_by_name": self.actor_name}
        if current != "offer_pending":
            app_update.update({"status": "offer_pending", "stage": "offer_pending"})
            self._history(APPLICATIONS, application["_id"], current, "offer_pending")
        self._c(APPLICATIONS).update_one(
            {"_id": application["_id"], "tenant_id": self.tenant_id},
            {"$set": app_update},
        )
        self._activity(
            action,
            "offer",
            offer["_id"],
            application_id=application["_id"],
            message=f"Offer {offer.get('reference_no')} was {action}.",
            new="draft",
            details={"version": offer.get("version")},
        )
        return offer

    def submit_offer_for_approval(self, offer_id, approver_user_ids=None):
        self._require_hr()
        offer = self._get(OFFERS, offer_id, "Offer")
        old, new = self._transition(offer.get("status"), "approval_pending", OFFER_TRANSITIONS, "Offer")
        settings = self._settings()
        requested = unique_strings(approver_user_ids or [])
        if requested:
            users = self._active_users(requested)
        else:
            users = self._users_for_roles(settings.get("salary_approval_roles") or [])
        approvers = unique_strings([str(user["_id"]) for user in users])
        if settings.get("require_salary_approval") and not approvers:
            raise RecruitmentServiceError(
                "No active salary or offer approver is configured.",
                code="offer_approver_required",
            )
        now = utcnow()
        self._c(OFFERS).update_one(
            {"_id": offer["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "status": new,
                "approval_user_ids": approvers,
                "approval_requested_at": now,
                "approval_requested_by": self.actor_id,
                "updated_at": now,
                "updated_by": self.actor_id,
                "updated_by_name": self.actor_name,
            }},
        )
        self._history(OFFERS, offer["_id"], old, new)
        self._activity(
            "approval_requested",
            "offer",
            offer["_id"],
            application_id=offer.get("application_id"),
            message=f"Offer {offer.get('reference_no')} was sent for approval.",
            old=old,
            new=new,
        )
        self._notify(
            approvers,
            title="Offer approval required",
            body=f"Review the offer for {offer.get('candidate_name')} - {offer.get('job_title')}.",
            target="recruitment_offers",
            entity_type="offer",
            entity_id=offer["_id"],
            application_id=offer.get("application_id"),
            priority="high",
            popup=True,
        )
        return self._get(OFFERS, offer["_id"], "Offer")

    def decide_offer(self, offer_id, decision, *, reason=""):
        self._auth()
        offer = self._get(OFFERS, offer_id, "Offer")
        decision = normalize_key(decision)
        if decision not in {"approved", "rejected"}:
            raise RecruitmentServiceError(
                "Offer decision must be approved or rejected.",
                code="invalid_offer_decision",
            )
        approvers = unique_strings(offer.get("approval_user_ids") or [])
        if self.actor_id not in approvers and not self._has(ADMIN_ROLES | FINANCE_ROLES):
            raise RecruitmentServiceError(
                "You are not authorised to approve this offer.",
                code="offer_approval_access_denied",
                status_code=403,
            )
        reason = safe_str(reason)
        if decision == "rejected" and not reason:
            raise RecruitmentServiceError(
                "A written reason is required when an offer is rejected.",
                code="offer_rejection_reason_required",
            )
        old, new = self._transition(offer.get("status"), decision, OFFER_TRANSITIONS, "Offer")
        now = utcnow()
        decision_record = {
            "decision": decision,
            "reason": reason,
            **self._actor_snapshot(),
            "decided_at": now,
        }
        self._c(OFFERS).update_one(
            {"_id": offer["_id"], "tenant_id": self.tenant_id},
            {
                "$set": {
                    "status": new,
                    "decision_reason": reason,
                    "decided_at": now,
                    "decided_by": self.actor_id,
                    "decided_by_name": self.actor_name,
                    "updated_at": now,
                    "updated_by": self.actor_id,
                    "updated_by_name": self.actor_name,
                },
                "$push": {"approval_history": decision_record},
            },
        )
        self._history(OFFERS, offer["_id"], old, new, reason)
        self._activity(
            decision,
            "offer",
            offer["_id"],
            application_id=offer.get("application_id"),
            message=f"Offer was {decision}.",
            old=old,
            new=new,
            details={"reason": reason},
        )
        self._notify(
            [offer.get("created_by")],
            title=f"Offer {decision}",
            body=f"The offer for {offer.get('candidate_name')} was {decision}.",
            target="recruitment_offers",
            entity_type="offer",
            entity_id=offer["_id"],
            application_id=offer.get("application_id"),
            priority="high",
            popup=True,
        )
        return self._get(OFFERS, offer["_id"], "Offer")

    def send_offer(self, offer_id, *, offer_url="", offer_attachment=None):
        self._require_hr()
        offer = self._get(OFFERS, offer_id, "Offer")
        status = normalize_key(offer.get("status"))
        settings = self._settings()
        if settings.get("require_salary_approval") and status != "approved":
            raise RecruitmentServiceError(
                "The offer must be approved before it is sent.",
                code="offer_not_approved",
                status_code=409,
            )
        if not settings.get("require_salary_approval") and status == "draft":
            self._c(OFFERS).update_one(
                {"_id": offer["_id"], "tenant_id": self.tenant_id},
                {"$set": {"status": "approved", "updated_at": utcnow()}},
            )
            self._history(OFFERS, offer["_id"], "draft", "approved", "Approval is disabled in company settings.")
            offer = self._get(OFFERS, offer["_id"], "Offer")
            status = "approved"
        old, new = self._transition(status, "sent", OFFER_TRANSITIONS, "Offer")

        raw_token = secrets.token_urlsafe(36)
        response_deadline = parse_date(
            (offer.get("terms") or {}).get("response_deadline"),
            "response_deadline",
            required=True,
        )
        expiry = datetime.fromisoformat(response_deadline) + timedelta(days=1)
        now = utcnow()
        self._c(OFFERS).update_one(
            {"_id": offer["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "status": new,
                "response_token_hash": token_hash(raw_token),
                "response_token_expires_at": expiry,
                "sent_at": now,
                "sent_by": self.actor_id,
                "sent_by_name": self.actor_name,
                "updated_at": now,
                "updated_by": self.actor_id,
                "updated_by_name": self.actor_name,
            }},
        )
        self._history(OFFERS, offer["_id"], old, new)

        application = self._get(APPLICATIONS, offer.get("application_id"), "Application")
        app_old = normalize_key(application.get("status"))
        if app_old != "offer_sent":
            self._c(APPLICATIONS).update_one(
                {"_id": application["_id"], "tenant_id": self.tenant_id},
                {"$set": {
                    "status": "offer_sent",
                    "stage": "offer_sent",
                    "offer_sent_at": now,
                    "updated_at": now,
                    "updated_by": self.actor_id,
                    "updated_by_name": self.actor_name,
                }},
            )
            self._history(APPLICATIONS, application["_id"], app_old, "offer_sent")

        url = safe_str(offer_url)
        if url:
            url = url.replace("{token}", raw_token) if "{token}" in url else f"{url.rstrip('/')}/{raw_token}"
        terms = offer.get("terms") or {}
        email_result = {"ok": False, "code": "candidate_email_missing"}
        if settings.get("email_candidate_on_offer") and offer.get("candidate_email"):
            email_result = self._email(
                "send_recruitment_offer_email",
                to_email=offer.get("candidate_email"),
                candidate_name=offer.get("candidate_name"),
                company_name=self._company_name(),
                job_title=offer.get("job_title"),
                designation=terms.get("designation"),
                department=terms.get("department"),
                work_location=terms.get("work_location"),
                employment_type=terms.get("employment_type"),
                joining_date=terms.get("joining_date"),
                response_deadline=terms.get("response_deadline"),
                offer_url=url or None,
                offer_reference=offer.get("reference_no"),
                salary_summary=terms.get("salary_summary"),
                message=terms.get("offer_message"),
                offer_attachment=offer_attachment or terms.get("offer_file") or None,
                reply_to=self._reply_to(),
            )
        self._activity(
            "sent",
            "offer",
            offer["_id"],
            application_id=application["_id"],
            message=f"Offer {offer.get('reference_no')} was sent to the candidate.",
            old=old,
            new=new,
            details={"email_result": email_result},
        )
        return {
            "offer": self._get(OFFERS, offer["_id"], "Offer"),
            "response_token": raw_token,
            "response_url": url,
            "email_result": email_result,
        }

    def get_public_offer(self, response_token):
        if not self.allow_public_actions:
            raise RecruitmentServiceError(
                "Public recruitment access is disabled.",
                code="public_recruitment_access_denied",
                status_code=403,
            )
        offer = self._c(OFFERS).find_one(
            self._q({"response_token_hash": token_hash(response_token)})
        )
        if not offer:
            raise RecruitmentServiceError(
                "Offer link is invalid or no longer available.",
                code="offer_link_invalid",
                status_code=404,
            )
        expires_at = offer.get("response_token_expires_at")
        if expires_at and expires_at < utcnow() and normalize_key(offer.get("status")) == "sent":
            self._c(OFFERS).update_one(
                {"_id": offer["_id"], "tenant_id": self.tenant_id},
                {"$set": {"status": "expired", "updated_at": utcnow()}},
            )
            offer["status"] = "expired"
        if not offer.get("viewed_at"):
            self._c(OFFERS).update_one(
                {"_id": offer["_id"], "tenant_id": self.tenant_id},
                {"$set": {"viewed_at": utcnow()}},
            )
        allowed = {
            "reference_no", "candidate_name", "job_title", "terms", "status",
            "sent_at", "viewed_at", "responded_at", "response_status", "version"
        }
        return {key: deepcopy(value) for key, value in offer.items() if key in allowed}

    def respond_to_offer(self, response_token, response, *, reason=""):
        if not self.allow_public_actions:
            raise RecruitmentServiceError(
                "Public recruitment access is disabled.",
                code="public_recruitment_access_denied",
                status_code=403,
            )
        offer = self._c(OFFERS).find_one(
            self._q({"response_token_hash": token_hash(response_token)})
        )
        if not offer:
            raise RecruitmentServiceError(
                "Offer link is invalid or no longer available.",
                code="offer_link_invalid",
                status_code=404,
            )
        expires_at = offer.get("response_token_expires_at")
        if expires_at and expires_at < utcnow():
            if normalize_key(offer.get("status")) == "sent":
                self._c(OFFERS).update_one(
                    {"_id": offer["_id"], "tenant_id": self.tenant_id},
                    {"$set": {"status": "expired", "updated_at": utcnow()}},
                )
            raise RecruitmentServiceError(
                "The offer response deadline has passed.",
                code="offer_expired",
                status_code=409,
            )
        response = normalize_key(response)
        if response not in {"accepted", "declined"}:
            raise RecruitmentServiceError(
                "Offer response must be accepted or declined.",
                code="invalid_offer_response",
            )
        old, new = self._transition(offer.get("status"), response, OFFER_TRANSITIONS, "Offer")
        reason = safe_str(reason)
        if response == "declined" and not reason:
            raise RecruitmentServiceError(
                "Please provide a reason for declining the offer.",
                code="offer_decline_reason_required",
            )
        now = utcnow()
        self._c(OFFERS).update_one(
            {"_id": offer["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "status": new,
                "response_status": new,
                "response_reason": reason,
                "responded_at": now,
                "updated_at": now,
                "updated_by": "candidate",
                "updated_by_name": offer.get("candidate_name"),
            }},
        )
        self._history(OFFERS, offer["_id"], old, new, reason)

        application = self._get(APPLICATIONS, offer.get("application_id"), "Application")
        app_old = normalize_key(application.get("status"))
        app_new = "offer_accepted" if response == "accepted" else "offer_declined"
        self._c(APPLICATIONS).update_one(
            {"_id": application["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "status": app_new,
                "stage": app_new,
                "offer_accepted_at": now if response == "accepted" else None,
                "joining_date": (offer.get("terms") or {}).get("joining_date") if response == "accepted" else "",
                "updated_at": now,
                "updated_by": "candidate",
                "updated_by_name": offer.get("candidate_name"),
            }},
        )
        self._history(APPLICATIONS, application["_id"], app_old, app_new, reason)
        self._activity(
            f"offer_{response}",
            "offer",
            offer["_id"],
            application_id=application["_id"],
            message=f"Candidate {response} the offer.",
            old=old,
            new=new,
            details={"reason": reason},
        )

        pre_joining_token = ""
        if response == "accepted":
            self._initialise_joining_requirements(application["_id"])
            pre_joining_token = self._issue_joining_access_token(application["_id"])
            self._recalculate_joining_readiness(application["_id"])
        else:
            self._c(CANDIDATES).update_one(
                self._q({"_id": as_object_id(application.get("candidate_id"), "candidate id")}),
                {"$set": {"latest_application_status": "offer_declined", "updated_at": now}},
            )

        hr_users = self._users_for_roles(HR_ROLES)
        hr_ids = [str(user["_id"]) for user in hr_users]
        self._notify(
            hr_ids,
            title=f"Offer {response}",
            body=f"{offer.get('candidate_name')} {response} the offer for {offer.get('job_title')}.",
            target="recruitment_offers",
            entity_type="offer",
            entity_id=offer["_id"],
            application_id=application["_id"],
            priority="high",
            popup=True,
        )
        for user in hr_users:
            if user.get("email"):
                self._email(
                    "send_recruitment_offer_response_email",
                    to_email=user.get("email"),
                    recipient_name=user.get("name") or user.get("full_name") or user.get("email"),
                    company_name=self._company_name(),
                    candidate_name=offer.get("candidate_name"),
                    job_title=offer.get("job_title"),
                    response_status=response,
                    response_date=now.strftime("%d %B %Y"),
                    reply_to=self._reply_to(),
                )
        return {
            "offer_status": response,
            "application": self._get(APPLICATIONS, application["_id"], "Application"),
            "pre_joining_token": pre_joining_token,
        }

    def list_offers(self, *, status="", search="", page=1, page_size=25):
        self._require_reader()
        query = self._q()
        if status:
            query["status"] = normalize_key(status)
        if search:
            regex = re.escape(safe_str(search))
            query["$or"] = [
                {"reference_no": {"$regex": regex, "$options": "i"}},
                {"candidate_name": {"$regex": regex, "$options": "i"}},
                {"candidate_email": {"$regex": regex, "$options": "i"}},
                {"job_title": {"$regex": regex, "$options": "i"}},
            ]
        if not self._has(HR_ROLES | FINANCE_ROLES):
            query["created_by"] = self.actor_id
        return self._paged(OFFERS, query, page, page_size)

    # ------------------------------------------------------------------
    # Pre-joining documents, verification and employee conversion
    # ------------------------------------------------------------------
    def _initialise_joining_requirements(self, application_id):
        application = self._get(APPLICATIONS, application_id, "Application")
        settings = self._settings()
        now = utcnow()

        for item in settings.get("default_joining_documents") or []:
            document_key = normalize_key(item.get("key") or item.get("label"))
            if not document_key:
                continue
            self._c(DOCUMENTS).update_one(
                self._q({
                    "application_id": str(application["_id"]),
                    "document_key": document_key,
                }),
                {
                    "$setOnInsert": {
                        "tenant_id": self.tenant_id,
                        "application_id": str(application["_id"]),
                        "candidate_id": safe_str(application.get("candidate_id")),
                        "job_opening_id": safe_str(application.get("job_opening_id")),
                        "document_key": document_key,
                        "document_label": safe_str(item.get("label") or document_key.replace("_", " ").title()),
                        "required": bool(item.get("required", True)),
                        "status": "pending" if bool(item.get("required", True)) else "not_required",
                        "file_name": "",
                        "file_path": "",
                        "file_url": "",
                        "mime_type": "",
                        "size_bytes": 0,
                        "sha256": "",
                        "candidate_note": "",
                        "review_note": "",
                        "received_at": None,
                        "reviewed_at": None,
                        "reviewed_by": "",
                        "reviewed_by_name": "",
                        "created_at": now,
                        "created_by": self.actor_id or "system",
                        "created_by_name": self.actor_name,
                        "is_deleted": False,
                    },
                    "$set": {"updated_at": now},
                },
                upsert=True,
            )

        for item in settings.get("background_check_types") or []:
            if not bool(item.get("enabled")):
                continue
            check_type = normalize_key(item.get("key") or item.get("label"))
            if not check_type:
                continue
            self._c(BACKGROUND_CHECKS).update_one(
                self._q({
                    "application_id": str(application["_id"]),
                    "check_type": check_type,
                }),
                {
                    "$setOnInsert": {
                        "tenant_id": self.tenant_id,
                        "application_id": str(application["_id"]),
                        "candidate_id": safe_str(application.get("candidate_id")),
                        "check_type": check_type,
                        "check_label": safe_str(item.get("label") or check_type.replace("_", " ").title()),
                        "required": True,
                        "status": "pending",
                        "consent_received": False,
                        "consent_received_at": None,
                        "provider": "",
                        "reference_no": "",
                        "result_summary": "",
                        "notes": "",
                        "completed_at": None,
                        "completed_by": "",
                        "completed_by_name": "",
                        "created_at": now,
                        "created_by": self.actor_id or "system",
                        "created_by_name": self.actor_name,
                        "is_deleted": False,
                    },
                    "$set": {"updated_at": now},
                },
                upsert=True,
            )

        current = normalize_key(application.get("status"))
        if current in {"offer_accepted", "joining_deferred"}:
            self._c(APPLICATIONS).update_one(
                {"_id": application["_id"], "tenant_id": self.tenant_id},
                {"$set": {
                    "status": "documents_pending",
                    "stage": "documents_pending",
                    "joining_status": "documents_pending",
                    "updated_at": now,
                    "updated_by": self.actor_id or "system",
                    "updated_by_name": self.actor_name,
                }},
            )
            self._history(APPLICATIONS, application["_id"], current, "documents_pending")

        return {
            "documents": list(self._c(DOCUMENTS).find(self._q({"application_id": str(application["_id"])})).sort("document_label", ASCENDING)),
            "background_checks": list(self._c(BACKGROUND_CHECKS).find(self._q({"application_id": str(application["_id"])})).sort("check_label", ASCENDING)),
        }

    def _issue_joining_access_token(self, application_id, *, valid_days=30):
        application = self._get(APPLICATIONS, application_id, "Application")
        raw_token = secrets.token_urlsafe(32)
        expires_at = utcnow() + timedelta(days=max(1, min(90, int(valid_days or 30))))
        self._c(APPLICATIONS).update_one(
            {"_id": application["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "pre_joining_token_hash": token_hash(raw_token),
                "pre_joining_token_expires_at": expires_at,
                "pre_joining_token_issued_at": utcnow(),
                "updated_at": utcnow(),
            }},
        )
        return raw_token

    def _recalculate_joining_readiness(self, application_id):
        application = self._get(APPLICATIONS, application_id, "Application")
        app_id = str(application["_id"])
        documents = list(self._c(DOCUMENTS).find(self._q({"application_id": app_id})))
        checks = list(self._c(BACKGROUND_CHECKS).find(self._q({"application_id": app_id})))

        pending_documents = [
            item for item in documents
            if item.get("required") is True and normalize_key(item.get("status")) not in {"accepted", "not_required"}
        ]
        pending_checks = [
            item for item in checks
            if item.get("required") is True and normalize_key(item.get("status")) not in {"clear", "not_required"}
        ]
        ready = not pending_documents and not pending_checks
        current = normalize_key(application.get("status"))
        target = "ready_to_join" if ready else "documents_pending"

        if current not in {"joined", "did_not_join", "rejected", "withdrawn", "offer_declined"} and current != target:
            now = utcnow()
            update = {
                "status": target,
                "stage": target,
                "joining_status": target,
                "updated_at": now,
                "updated_by": self.actor_id or "system",
                "updated_by_name": self.actor_name,
            }
            if ready:
                update["ready_to_join_at"] = now
            self._c(APPLICATIONS).update_one(
                {"_id": application["_id"], "tenant_id": self.tenant_id},
                {"$set": update},
            )
            self._history(APPLICATIONS, application["_id"], current, target)
            self._activity(
                "joining_readiness_updated",
                "application",
                application["_id"],
                application_id=application["_id"],
                message=f"Joining status updated to {target.replace('_', ' ')}.",
                old=current,
                new=target,
                details={
                    "pending_document_keys": [item.get("document_key") for item in pending_documents],
                    "pending_check_types": [item.get("check_type") for item in pending_checks],
                },
            )

        return {
            "ready_to_join": ready,
            "status": target,
            "pending_documents": [
                {"document_key": item.get("document_key"), "document_label": item.get("document_label"), "status": item.get("status")}
                for item in pending_documents
            ],
            "pending_background_checks": [
                {"check_type": item.get("check_type"), "check_label": item.get("check_label"), "status": item.get("status")}
                for item in pending_checks
            ],
        }

    def _application_by_joining_token(self, access_token):
        if not self.allow_public_actions:
            raise RecruitmentServiceError(
                "Public recruitment access is disabled.",
                code="public_recruitment_access_denied",
                status_code=403,
            )
        application = self._c(APPLICATIONS).find_one(
            self._q({"pre_joining_token_hash": token_hash(access_token)})
        )
        if not application:
            raise RecruitmentServiceError(
                "Joining link is invalid or no longer available.",
                code="joining_link_invalid",
                status_code=404,
            )
        expires_at = application.get("pre_joining_token_expires_at")
        if expires_at and expires_at < utcnow():
            raise RecruitmentServiceError(
                "Joining link has expired. Please contact HR for a new link.",
                code="joining_link_expired",
                status_code=410,
            )
        return application

    def get_public_joining_portal(self, access_token):
        application = self._application_by_joining_token(access_token)
        app_id = str(application["_id"])
        documents = list(self._c(DOCUMENTS).find(
            self._q({"application_id": app_id}),
            {
                "document_key": 1,
                "document_label": 1,
                "required": 1,
                "status": 1,
                "candidate_note": 1,
                "review_note": 1,
                "file_name": 1,
                "received_at": 1,
                "reviewed_at": 1,
            },
        ).sort("document_label", ASCENDING))
        return {
            "application": {
                "reference_no": application.get("reference_no"),
                "candidate_name": application.get("candidate_name"),
                "job_title": application.get("job_title"),
                "department": application.get("department"),
                "joining_date": application.get("joining_date"),
                "joining_status": application.get("joining_status") or application.get("status"),
            },
            "documents": documents,
            "readiness": self._recalculate_joining_readiness(application["_id"]),
        }

    def submit_joining_document(self, access_token, document_key, file_metadata, *, candidate_note=""):
        application = self._application_by_joining_token(access_token)
        key = normalize_key(document_key)
        document = self._c(DOCUMENTS).find_one(
            self._q({"application_id": str(application["_id"]), "document_key": key})
        )
        if not document:
            raise RecruitmentServiceError(
                "This document is not part of the joining checklist.",
                code="joining_document_not_found",
                status_code=404,
            )
        metadata = dict(file_metadata or {})
        file_name = safe_str(metadata.get("file_name") or metadata.get("filename"))
        file_path = safe_str(metadata.get("file_path") or metadata.get("path"))
        if not file_name or not file_path:
            raise RecruitmentServiceError(
                "A valid uploaded document file is required.",
                code="joining_document_file_required",
            )
        now = utcnow()
        self._c(DOCUMENTS).update_one(
            {"_id": document["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "status": "received",
                "file_name": file_name,
                "file_path": file_path,
                "file_url": safe_str(metadata.get("file_url") or metadata.get("url")),
                "mime_type": safe_str(metadata.get("mime_type")),
                "size_bytes": int(metadata.get("size_bytes") or 0),
                "sha256": safe_str(metadata.get("sha256")),
                "candidate_note": safe_str(candidate_note)[:5000],
                "review_note": "",
                "received_at": now,
                "reviewed_at": None,
                "reviewed_by": "",
                "reviewed_by_name": "",
                "updated_at": now,
                "updated_by": "candidate",
                "updated_by_name": application.get("candidate_name"),
            }},
        )
        self._activity(
            "document_submitted",
            "joining_document",
            document["_id"],
            application_id=application["_id"],
            message=f"Candidate submitted {document.get('document_label')}.",
            new="received",
        )
        return {
            "document": self._get(DOCUMENTS, document["_id"], "Joining document"),
            "readiness": self._recalculate_joining_readiness(application["_id"]),
        }

    def list_joining_documents(self, application_id):
        self._require_reader()
        application = self.get_application(application_id)
        return list(self._c(DOCUMENTS).find(
            self._q({"application_id": str(application["_id"])}),
        ).sort("document_label", ASCENDING))

    def review_joining_document(self, document_id, status, *, reason=""):
        self._require_hr()
        document = self._get(DOCUMENTS, document_id, "Joining document")
        new_status = normalize_key(status)
        allowed = {"accepted", "rejected", "needs_correction", "not_required"}
        if new_status not in allowed:
            raise RecruitmentServiceError(
                "Document status must be accepted, rejected, needs correction, or not required.",
                code="invalid_joining_document_status",
            )
        reason = safe_str(reason)
        if new_status in {"rejected", "needs_correction"} and not reason:
            raise RecruitmentServiceError(
                "A reason is required when a document is rejected or needs correction.",
                code="joining_document_reason_required",
            )
        old_status = normalize_key(document.get("status"))
        now = utcnow()
        self._c(DOCUMENTS).update_one(
            {"_id": document["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "status": new_status,
                "review_note": reason[:5000],
                "reviewed_at": now,
                "reviewed_by": self.actor_id,
                "reviewed_by_name": self.actor_name,
                "updated_at": now,
                "updated_by": self.actor_id,
                "updated_by_name": self.actor_name,
            }},
        )
        application = self._get(APPLICATIONS, document.get("application_id"), "Application")
        self._activity(
            "document_reviewed",
            "joining_document",
            document["_id"],
            application_id=application["_id"],
            message=f"{document.get('document_label')} marked {new_status.replace('_', ' ')}.",
            old=old_status,
            new=new_status,
            details={"reason": reason},
        )

        if new_status == "needs_correction" and application.get("candidate_email"):
            token = self._issue_joining_access_token(application["_id"])
            frontend = safe_str(
                self.config.get("FRONTEND_URL")
                or self.config.get("PUBLIC_FRONTEND_URL")
                or self.config.get("APP_URL")
            ).rstrip("/")
            upload_url = f"{frontend}/careers/joining/{token}" if frontend else ""
            self._email(
                "send_recruitment_document_request_email",
                to_email=application.get("candidate_email"),
                candidate_name=application.get("candidate_name"),
                company_name=self._company_name(),
                job_title=application.get("job_title"),
                document_names=[document.get("document_label")],
                upload_url=upload_url,
                instructions=reason,
                correction_required=True,
                reply_to=self._reply_to(),
            )

        return {
            "document": self._get(DOCUMENTS, document["_id"], "Joining document"),
            "readiness": self._recalculate_joining_readiness(application["_id"]),
        }

    def list_background_checks(self, application_id):
        self._require_reader()
        application = self.get_application(application_id)
        return list(self._c(BACKGROUND_CHECKS).find(
            self._q({"application_id": str(application["_id"])}),
        ).sort("check_label", ASCENDING))

    def update_background_check(self, application_id, payload):
        self._require_hr()
        application = self._get(APPLICATIONS, application_id, "Application")
        data = dict(payload or {})
        check_type = normalize_key(data.get("check_type"))
        if not check_type:
            raise RecruitmentServiceError("Check type is required.", code="background_check_type_required")
        status = normalize_key(data.get("status") or "pending")
        if status not in BACKGROUND_CHECK_STATUSES:
            raise RecruitmentServiceError("Invalid background check status.", code="invalid_background_check_status")
        if status in {"clear", "clarification_required", "not_clear"} and data.get("consent_received") is not True:
            existing = self._c(BACKGROUND_CHECKS).find_one(
                self._q({"application_id": str(application["_id"]), "check_type": check_type})
            ) or {}
            if existing.get("consent_received") is not True:
                raise RecruitmentServiceError(
                    "Candidate consent must be recorded before completing this check.",
                    code="background_check_consent_required",
                )
        now = utcnow()
        update = {
            "tenant_id": self.tenant_id,
            "application_id": str(application["_id"]),
            "candidate_id": safe_str(application.get("candidate_id")),
            "check_type": check_type,
            "check_label": safe_str(data.get("check_label") or check_type.replace("_", " ").title()),
            "required": bool(data.get("required", True)),
            "status": status,
            "consent_received": bool(data.get("consent_received")),
            "provider": safe_str(data.get("provider")),
            "reference_no": safe_str(data.get("reference_no")),
            "result_summary": safe_str(data.get("result_summary"))[:10000],
            "notes": safe_str(data.get("notes"))[:10000],
            "updated_at": now,
            "updated_by": self.actor_id,
            "updated_by_name": self.actor_name,
            "is_deleted": False,
        }
        if update["consent_received"]:
            update["consent_received_at"] = now
        if status in {"clear", "clarification_required", "not_clear", "not_required"}:
            update.update({
                "completed_at": now,
                "completed_by": self.actor_id,
                "completed_by_name": self.actor_name,
            })
        result = self._c(BACKGROUND_CHECKS).find_one_and_update(
            self._q({"application_id": str(application["_id"]), "check_type": check_type}),
            {"$set": update, "$setOnInsert": {
                "created_at": now,
                "created_by": self.actor_id,
                "created_by_name": self.actor_name,
            }},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        self._activity(
            "background_check_updated",
            "background_check",
            result["_id"],
            application_id=application["_id"],
            message=f"{result.get('check_label')} marked {status.replace('_', ' ')}.",
            new=status,
        )
        return {
            "background_check": result,
            "readiness": self._recalculate_joining_readiness(application["_id"]),
        }

    def change_joining_status(self, application_id, status, *, reason="", joining_date=""):
        self._require_hr()
        application = self._get(APPLICATIONS, application_id, "Application")
        new_status = normalize_key(status)
        if new_status not in {"documents_pending", "ready_to_join", "joining_deferred", "did_not_join"}:
            raise RecruitmentServiceError("Invalid joining status.", code="invalid_joining_status")
        current = normalize_key(application.get("status"))
        reason = safe_str(reason)
        if new_status in {"joining_deferred", "did_not_join"} and not reason:
            raise RecruitmentServiceError("A written reason is required.", code="joining_status_reason_required")
        if new_status == "ready_to_join":
            readiness = self._recalculate_joining_readiness(application["_id"])
            if not readiness.get("ready_to_join"):
                raise RecruitmentServiceError(
                    "Required documents or verification checks are still pending.",
                    code="joining_requirements_pending",
                    status_code=409,
                    details=readiness,
                )
        now = utcnow()
        update = {
            "status": new_status,
            "stage": new_status,
            "joining_status": new_status,
            "status_reason": reason,
            "updated_at": now,
            "updated_by": self.actor_id,
            "updated_by_name": self.actor_name,
        }
        if joining_date:
            update["joining_date"] = parse_date(joining_date, "joining_date", required=True)
        self._c(APPLICATIONS).update_one(
            {"_id": application["_id"], "tenant_id": self.tenant_id},
            {"$set": update},
        )
        self._history(APPLICATIONS, application["_id"], current, new_status, reason)
        self._activity(
            "joining_status_changed",
            "application",
            application["_id"],
            application_id=application["_id"],
            message=f"Joining status changed to {new_status.replace('_', ' ')}.",
            old=current,
            new=new_status,
            details={"reason": reason},
        )
        return self._get(APPLICATIONS, application["_id"], "Application")

    def convert_candidate_to_employee(self, application_id, payload=None):
        self._require_hr()
        data = dict(payload or {})
        application = self._get(APPLICATIONS, application_id, "Application")
        if normalize_key(application.get("status")) != "ready_to_join":
            raise RecruitmentServiceError(
                "Only a candidate marked Ready to Join can be converted to an employee.",
                code="candidate_not_ready_to_join",
                status_code=409,
            )
        if application.get("converted_employee_id"):
            employee = self.db.employees.find_one({
                "_id": as_object_id(application.get("converted_employee_id"), "employee id"),
                "tenant_id": self.tenant_id,
                "is_deleted": {"$ne": True},
            })
            return {"employee": employee, "already_converted": True, "temporary_password": ""}

        tenant = self.db.tenants.find_one({"tenant_id": self.tenant_id}) or {}
        try:
            from app.services.tenant_service import can_create_employee
            limit_result = can_create_employee(self.db, tenant, config=self.config)
        except Exception:
            limit_result = {"allowed": True}
        if not limit_result.get("allowed", True):
            raise RecruitmentServiceError(
                limit_result.get("message") or "Employee limit has been reached for this company.",
                code="employee_limit_reached",
                status_code=403,
                details={
                    "employee_count": limit_result.get("employee_count"),
                    "employee_limit": limit_result.get("employee_limit"),
                },
            )

        candidate = self._get(CANDIDATES, application.get("candidate_id"), "Candidate")
        offer = self._c(OFFERS).find_one(self._q({"application_id": str(application["_id"])})) or {}
        terms = dict(offer.get("terms") or {})
        name = safe_str(data.get("name") or candidate.get("full_name") or application.get("candidate_name"))
        email = normalize_email(data.get("email") or candidate.get("email") or application.get("candidate_email"))
        if not name or not email:
            raise RecruitmentServiceError("Employee name and email are required.", code="employee_identity_required")
        if self.db.users.find_one({"email": email, "is_deleted": {"$ne": True}}):
            raise RecruitmentServiceError("A user already exists with this email address.", code="employee_email_exists", status_code=409)

        prefix = normalize_key(self._settings().get("employee_code_prefix") or "EMP").upper().replace("_", "-")
        emp_code = safe_str(data.get("emp_code") or self._next("employee", prefix))
        identity_aliases = employee_identity_alias_keys({
            "employee_id": emp_code,
            "employee_code": emp_code,
            "emp_code": emp_code,
        })
        identity_conditions = [
            {"identity_alias_keys": {"$in": identity_aliases}},
        ]
        for identity_alias in identity_aliases:
            exact_alias = f"^{re.escape(identity_alias)}$"
            identity_conditions.extend(
                {
                    field_name: {
                        "$regex": exact_alias,
                        "$options": "i",
                    }
                }
                for field_name in EMPLOYEE_IDENTITY_FIELDS
            )

        if self.db.employees.find_one({
            "tenant_id": self.tenant_id,
            "is_deleted": {"$ne": True},
            "$or": identity_conditions,
        }):
            raise RecruitmentServiceError(
                "Employee ID/code is already assigned to another active employee in this company.",
                code="employee_code_exists",
                status_code=409,
            )

        if self.db.users.find_one({
            "tenant_id": self.tenant_id,
            "is_deleted": {"$ne": True},
            "$or": [
                {
                    "emp_code": {
                        "$regex": f"^{re.escape(emp_code)}$",
                        "$options": "i",
                    }
                },
                {
                    "employee_code": {
                        "$regex": f"^{re.escape(emp_code)}$",
                        "$options": "i",
                    }
                },
            ],
        }):
            raise RecruitmentServiceError(
                "Employee ID/code is already assigned to another active user in this company.",
                code="employee_code_exists",
                status_code=409,
            )

        temporary_password = safe_str(data.get("temporary_password")) or secrets.token_urlsafe(9)
        if len(temporary_password) < 8:
            raise RecruitmentServiceError("Temporary password must contain at least 8 characters.", code="temporary_password_too_short")
        now = utcnow()
        user_doc = {
            "tenant_id": self.tenant_id,
            "name": name,
            "full_name": name,
            "email": email,
            "username": email,
            "password_hash": generate_password_hash(temporary_password),
            "role": "employee",
            "roles": ["employee"],
            "emp_code": emp_code,
            "employee_code": emp_code,
            "is_active": True,
            "status": "active",
            "must_change_password": True,
            "is_deleted": False,
            "created_at": now,
            "updated_at": now,
            "created_by": self.actor_id,
            "source": "recruitment_conversion",
        }
        try:
            user_result = self.db.users.insert_one(user_doc)
        except DuplicateKeyError as exc:
            raise RecruitmentServiceError(
                "A user already exists with this email address or employee code.",
                code="employee_identity_exists",
                status_code=409,
            ) from exc

        employee_doc = {
            "tenant_id": self.tenant_id,
            "user_id": str(user_result.inserted_id),
            "name": name,
            "employee_name": name,
            "email": email,
            "phone": safe_str(data.get("phone") or candidate.get("phone")),
            "employee_id": emp_code,
            "employee_code": emp_code,
            "emp_code": emp_code,
            "department": safe_str(data.get("department") or terms.get("department") or application.get("department")),
            "designation": safe_str(data.get("designation") or terms.get("designation") or application.get("job_title")),
            "date_of_joining": parse_date(data.get("joining_date") or application.get("joining_date") or terms.get("joining_date"), "joining_date", required=True),
            "joining_date": parse_date(data.get("joining_date") or application.get("joining_date") or terms.get("joining_date"), "joining_date", required=True),
            "employment_type": normalize_key(data.get("employment_type") or terms.get("employment_type") or "permanent"),
            "work_location": safe_str(data.get("work_location") or terms.get("work_location")),
            "reporting_officer_id": safe_str(data.get("reporting_manager_user_id") or terms.get("reporting_manager_user_id")),
            "reporting_officer_name": safe_str(data.get("reporting_manager_name") or terms.get("reporting_manager_name")),
            "team_leader_id": safe_str(data.get("team_leader_id")),
            "team_leader_name": safe_str(data.get("team_leader_name")),
            "address": safe_str(data.get("address") or candidate.get("address")),
            "location": safe_str(data.get("location") or candidate.get("location")),
            "skills": unique_strings(candidate.get("skills") or []),
            "education": clean_list(candidate.get("education")),
            "employment_history": clean_list(candidate.get("employment_history")),
            "recruitment_candidate_id": str(candidate["_id"]),
            "recruitment_application_id": str(application["_id"]),
            "recruitment_offer_id": str(offer.get("_id") or ""),
            "salary_setup_pending": True,
            "country": safe_str(data.get("country") or "India"),
            "branch": safe_str(data.get("branch") or data.get("work_location") or terms.get("work_location") or "Assam(HO)"),
            "role": "Employee",
            "shift": safe_str(data.get("shift") or "General"),
            "status": "Active",
            "is_team_leader": "false",
            "is_reporting_officer": "false",
            "is_it_support_head": "false",
            "is_it_support_member": "false",
            "created_at": now,
            "updated_at": now,
            "created_by": self.actor_id,
            "is_deleted": False,
        }
        employee_doc["identity_alias_keys"] = employee_identity_alias_keys(employee_doc)

        try:
            employee_result = self.db.employees.insert_one(employee_doc)
        except DuplicateKeyError as exc:
            self.db.users.delete_one({"_id": user_result.inserted_id})
            raise RecruitmentServiceError(
                "Employee ID/code is already assigned to another active employee in this company.",
                code="employee_code_exists",
                status_code=409,
            ) from exc
        except Exception:
            self.db.users.delete_one({"_id": user_result.inserted_id})
            raise

        employee_doc["_id"] = employee_result.inserted_id
        self.db.users.update_one(
            {"_id": user_result.inserted_id},
            {"$set": {
                "employee_id": str(employee_result.inserted_id),
                "employee_ref_id": str(employee_result.inserted_id),
                "emp_code": emp_code,
                "employee_code": emp_code,
                "department": employee_doc.get("department"),
                "designation": employee_doc.get("designation"),
                "updated_at": now,
            }},
        )

        default_tasks = data.get("onboarding_tasks") or [
            "Complete employee profile",
            "Configure salary structure",
            "Configure attendance and leave",
            "Provide login access",
            "Review asset requirements",
            "Complete induction and policy acknowledgement",
        ]
        onboarding_docs = []
        for order, task in enumerate(default_tasks, 1):
            if isinstance(task, Mapping):
                title = safe_str(task.get("title"))
                owner_user_id = safe_str(task.get("owner_user_id"))
                due_date = parse_date(task.get("due_date"), "due_date") if task.get("due_date") else ""
            else:
                title = safe_str(task)
                owner_user_id = ""
                due_date = ""
            if not title:
                continue
            onboarding_docs.append({
                "tenant_id": self.tenant_id,
                "employee_id": str(employee_result.inserted_id),
                "employee_name": name,
                "application_id": str(application["_id"]),
                "title": title,
                "sequence_no": order,
                "owner_user_id": owner_user_id,
                "due_date": due_date,
                "status": "pending",
                "created_at": now,
                "updated_at": now,
                "created_by": self.actor_id,
                "created_by_name": self.actor_name,
                "is_deleted": False,
            })
        if onboarding_docs:
            self._c(ONBOARDING_TASKS).insert_many(onboarding_docs)

        self._c(APPLICATIONS).update_one(
            {"_id": application["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "status": "joined",
                "stage": "joined",
                "joining_status": "joined",
                "actual_joining_date": employee_doc["joining_date"],
                "converted_employee_id": str(employee_result.inserted_id),
                "converted_user_id": str(user_result.inserted_id),
                "converted_at": now,
                "updated_at": now,
                "updated_by": self.actor_id,
                "updated_by_name": self.actor_name,
            }},
        )
        self._history(APPLICATIONS, application["_id"], "ready_to_join", "joined")
        self._c(CANDIDATES).update_one(
            {"_id": candidate["_id"], "tenant_id": self.tenant_id},
            {"$set": {
                "latest_application_status": "joined",
                "converted_employee_id": str(employee_result.inserted_id),
                "updated_at": now,
            }},
        )
        self._activity(
            "converted_to_employee",
            "application",
            application["_id"],
            application_id=application["_id"],
            message=f"{name} was converted to employee {emp_code}.",
            old="ready_to_join",
            new="joined",
            details={"employee_id": str(employee_result.inserted_id), "user_id": str(user_result.inserted_id)},
        )
        self._email(
            "send_recruitment_joining_confirmation_email",
            to_email=email,
            candidate_name=name,
            company_name=self._company_name(),
            job_title=employee_doc.get("designation"),
            joining_date=employee_doc.get("joining_date"),
            reporting_location=employee_doc.get("work_location") or employee_doc.get("branch"),
            instructions=(
                f"Your employee code is {emp_code}. Your login email is {email}. "
                f"Temporary password: {temporary_password}. Please change it after your first login."
            ),
            reply_to=self._reply_to(),
        )
        return {
            "employee": employee_doc,
            "user_id": str(user_result.inserted_id),
            "temporary_password": temporary_password,
            "onboarding_tasks_created": len(onboarding_docs),
            "already_converted": False,
        }

    # ------------------------------------------------------------------
    # Dashboard, reports and activity history
    # ------------------------------------------------------------------
    def get_dashboard(self):
        self._require_reader()
        today_start = datetime.combine(date.today(), datetime.min.time())
        tomorrow_start = today_start + timedelta(days=1)
        month_start = date.today().replace(day=1).isoformat()
        counts = {
            "open_hiring_requests": self._c(HIRING_REQUESTS).count_documents(self._q({"status": {"$in": ["submitted", "approved", "on_hold", "returned"]}})),
            "open_vacancies": self._c(JOB_OPENINGS).count_documents(self._q({"status": "open"})),
            "new_applications": self._c(APPLICATIONS).count_documents(self._q({"status": "applied"})),
            "pending_screening": self._c(APPLICATIONS).count_documents(self._q({"status": {"$in": ["applied", "under_review"]}})),
            "interviews_today": self._c(INTERVIEWS).count_documents(self._q({"scheduled_at": {"$gte": today_start, "$lt": tomorrow_start}, "status": {"$in": ["scheduled", "rescheduled"]}})),
            "feedback_pending": self._c(INTERVIEWS).count_documents(self._q({"status": "completed", "feedback_complete": {"$ne": True}})),
            "offers_awaiting_reply": self._c(OFFERS).count_documents(self._q({"status": "sent"})),
            "joining_this_month": self._c(APPLICATIONS).count_documents(self._q({"joining_date": {"$gte": month_start}, "status": {"$in": ["documents_pending", "ready_to_join", "joining_deferred"]}})),
            "ready_to_join": self._c(APPLICATIONS).count_documents(self._q({"status": "ready_to_join"})),
        }
        pipeline = list(self._c(APPLICATIONS).aggregate([
            {"$match": self._q()},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]))
        recent = list(self._c(APPLICATIONS).find(self._q()).sort("updated_at", DESCENDING).limit(8))
        upcoming = list(self._c(INTERVIEWS).find(self._q({
            "scheduled_at": {"$gte": utcnow()},
            "status": {"$in": ["scheduled", "rescheduled"]},
        })).sort("scheduled_at", ASCENDING).limit(8))
        return {
            "cards": counts,
            "pipeline": [{"status": item.get("_id") or "unknown", "count": item.get("count", 0)} for item in pipeline],
            "recent_applications": recent,
            "upcoming_interviews": upcoming,
        }

    def get_reports(self, *, date_from="", date_to="", job_opening_id=""):
        self._require_reader()
        match = self._q()
        if job_opening_id:
            match["job_opening_id"] = str(as_object_id(job_opening_id, "job opening id"))
        if date_from or date_to:
            applied_range = {}
            if date_from:
                applied_range["$gte"] = datetime.fromisoformat(parse_date(date_from, "date_from"))
            if date_to:
                applied_range["$lt"] = datetime.fromisoformat(parse_date(date_to, "date_to")) + timedelta(days=1)
            match["applied_at"] = applied_range

        by_status = list(self._c(APPLICATIONS).aggregate([
            {"$match": match},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]))
        by_source = list(self._c(APPLICATIONS).aggregate([
            {"$match": match},
            {"$group": {"_id": "$source", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]))
        by_job = list(self._c(APPLICATIONS).aggregate([
            {"$match": match},
            {"$group": {"_id": {"job_opening_id": "$job_opening_id", "job_title": "$job_title"}, "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 50},
        ]))
        offers = list(self._c(OFFERS).aggregate([
            {"$match": self._q()},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        ]))
        total = self._c(APPLICATIONS).count_documents(match)
        joined = self._c(APPLICATIONS).count_documents({**match, "status": "joined"})
        accepted = self._c(OFFERS).count_documents(self._q({"status": "accepted"}))
        sent = self._c(OFFERS).count_documents(self._q({"status": {"$in": ["sent", "accepted", "declined", "expired"]}}))
        return {
            "summary": {
                "applications": total,
                "joined": joined,
                "join_conversion_percent": round((joined / total) * 100, 2) if total else 0,
                "offers_sent": sent,
                "offers_accepted": accepted,
                "offer_acceptance_percent": round((accepted / sent) * 100, 2) if sent else 0,
            },
            "candidate_stages": [{"status": item.get("_id") or "unknown", "count": item.get("count", 0)} for item in by_status],
            "application_sources": [{"source": item.get("_id") or "unknown", "count": item.get("count", 0)} for item in by_source],
            "jobs": [{"job_opening_id": item.get("_id", {}).get("job_opening_id"), "job_title": item.get("_id", {}).get("job_title"), "count": item.get("count", 0)} for item in by_job],
            "offers": [{"status": item.get("_id") or "unknown", "count": item.get("count", 0)} for item in offers],
        }

    def list_activity(self, *, application_id="", entity_type="", page=1, page_size=50):
        self._require_reader()
        query = self._q()
        if application_id:
            query["application_id"] = str(as_object_id(application_id, "application id"))
        if entity_type:
            query["entity_type"] = normalize_key(entity_type)
        return self._paged(ACTIVITY_LOGS, query, page, page_size, sort=[("created_at", DESCENDING)])