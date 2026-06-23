import re
from difflib import SequenceMatcher
from datetime import date, datetime, timezone, timedelta

from bson import ObjectId

from app.extensions import get_db
from app.routes.workflow import (
    normalize_leave_type,
    leave_type_label,
    parse_date,
    calculate_leave_days,
    build_initial_leave_stage,
    leave_stage_label,
    leave_stage_status_fields,
    has_sufficient_leave_balance,
    resolve_handover_employee,
    resolve_project_handover,
    notify_next_leave_approvers,
    employee_code,
    employee_display_name,
    enrich_leave_request_doc,
)


ACTION_COLLECTION = "ai_pending_actions"

ACTION_STALE_AFTER_MINUTES = 180
ACTION_STALE_ACTION_TYPES = {
    "apply_leave",
    "schedule_management_meeting",
    "create_reminder",
    "attendance_check_in",
    "attendance_check_out",
}

# STRICT_AI_ACTION_SCOPE:
# AI guided action dropdowns must never leak cross-department/cross-team data.
# Project handover must never fall back to all tenant projects.
STRICT_AI_ACTION_SCOPE = True

def _now_utc():
    return datetime.now(timezone.utc)


def _safe_str(value):
    return str(value or "").strip()


def _lower(value):
    return _safe_str(value).lower()


def _as_object_id(value):
    try:
        text = _safe_str(value)
        if text and ObjectId.is_valid(text):
            return ObjectId(text)
    except Exception:
        return None

    return None


def _id_variants(value):
    values = []

    text = _safe_str(value)
    if text:
        values.append(text)

    oid = _as_object_id(text)
    if oid:
        values.append(oid)

    return values


def _user_key(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    return _safe_str(
        user_context.get("user_id")
        or user_context.get("_id")
        or user_context.get("employee_id")
        or user_context.get("email")
    )


def _tenant_id(user_context=None):
    if not isinstance(user_context, dict):
        return None

    return user_context.get("tenant_id")


def _employee_id(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    return _safe_str(
        user_context.get("employee_id")
        or (user_context.get("employee") or {}).get("_id")
        or (user_context.get("employee") or {}).get("id")
        or user_context.get("user_id")
    )


def _roles(user_context=None):
    if not isinstance(user_context, dict):
        return ["employee"]

    roles = user_context.get("roles") or []

    if not roles and user_context.get("role"):
        roles = [user_context.get("role")]

    return [_lower(role) for role in roles if _safe_str(role)] or ["employee"]


def _is_hr_admin_role(user_context=None):
    roles = set(_roles(user_context))

    return bool(
        roles.intersection({
            "super_admin",
            "admin",
            "hr",
            "hr_admin",
            "hr_manager",
        })
    )


def _is_management_role(user_context=None):
    roles = set(_roles(user_context))

    return bool(
        roles.intersection({
            "super_admin",
            "admin",
            "hr",
            "hr_admin",
            "hr_manager",
            "manager",
            "team_leader",
            "reporting_officer",
            "ro",
        })
    )


def _pending_action_query(user_context=None):
    user_key = _user_key(user_context)
    tenant_id = _tenant_id(user_context)

    query = {
        "user_key": user_key,
        "status": "collecting",
    }

    if tenant_id:
        query["tenant_id"] = tenant_id

    return query


def _pending_action_updated_at(action):
    if not action:
        return None

    value = action.get("updated_at") or action.get("created_at")

    if not value:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)

        return value.astimezone(timezone.utc)

    return None


def _pending_action_is_stale(action):
    if not action:
        return False

    action_type = _safe_str(action.get("action_type"))

    if action_type not in ACTION_STALE_ACTION_TYPES:
        return False

    updated_at = _pending_action_updated_at(action)

    if not updated_at:
        return True

    age = _now_utc() - updated_at

    return age > timedelta(minutes=ACTION_STALE_AFTER_MINUTES)


def _cancel_pending_action_by_id(action_id, reason="cancelled"):
    if not action_id:
        return

    db = get_db()

    db[ACTION_COLLECTION].update_one(
        {"_id": action_id},
        {
            "$set": {
                "status": "cancelled",
                "cancel_reason": reason,
                "updated_at": _now_utc(),
            }
        }
    )


def get_pending_action(user_context=None):
    user_key = _user_key(user_context)

    if not user_key:
        return None

    db = get_db()

    action = db[ACTION_COLLECTION].find_one(
        _pending_action_query(user_context),
        sort=[("updated_at", -1), ("_id", -1)]
    )

    if not action:
        return None

    if _pending_action_is_stale(action):
        _cancel_pending_action_by_id(action.get("_id"), "stale_expired")
        return None

    return action


def clear_pending_action(user_context=None):
    user_key = _user_key(user_context)

    if not user_key:
        return

    db = get_db()

    db[ACTION_COLLECTION].update_many(
        _pending_action_query(user_context),
        {
            "$set": {
                "status": "cancelled",
                "cancel_reason": "manual_clear",
                "updated_at": _now_utc(),
            }
        }
    )


def save_pending_action(user_context=None, action_type="", data=None, current_step=""):
    db = get_db()

    user_key = _user_key(user_context)

    if not user_key:
        return None

    tenant_id = _tenant_id(user_context)
    now = _now_utc()

    payload = {
        "tenant_id": tenant_id,
        "user_key": user_key,
        "employee_id": _employee_id(user_context),
        "action_type": action_type,
        "data": data or {},
        "current_step": current_step,
        "status": "collecting",
        "updated_at": now,
    }

    existing = get_pending_action(user_context)

    if existing and existing.get("action_type") != action_type:
        _cancel_pending_action_by_id(existing.get("_id"), "replaced_by_new_action")
        existing = None

    if existing:
        db[ACTION_COLLECTION].update_one(
            {"_id": existing["_id"]},
            {
                "$set": payload,
                "$setOnInsert": {
                    "created_at": now,
                }
            },
            upsert=True
        )

        return db[ACTION_COLLECTION].find_one({"_id": existing["_id"]})

    payload["created_at"] = now

    inserted = db[ACTION_COLLECTION].insert_one(payload)

    return db[ACTION_COLLECTION].find_one({"_id": inserted.inserted_id})

def detect_action_intent(question):
    text = _lower(question)

    # These are information questions, not action-start commands.
    # Example: "How to apply leave?" should explain workflow,
    # not start the leave application form.
    info_question_phrases = [
        "how to apply leave",
        "how do i apply leave",
        "how can i apply leave",
        "process to apply leave",
        "steps to apply leave",
        "how to request leave",
        "how do i request leave",
        "how to check in",
        "how do i check in",
        "how can i check in",
        "how to check out",
        "how do i check out",
        "how can i check out",
        "attendance process",
        "steps to mark attendance",
    ]

    if any(phrase in text for phrase in info_question_phrases):
        return ""

    attendance_intent = _detect_attendance_action_intent(text)

    if attendance_intent:
        return attendance_intent

    if any(word in text for word in [
        "cancel",
        "stop",
        "clear action",
        "forget this",
        "restart action",
        "exit leave",
        "exit meeting",
        "exit reminder",
    ]):
        return "cancel"

    # Start leave guided flow only when user clearly wants to apply/request leave.
    # Do not include phrases like "please submit my leave" here, because that
    # phrase is used later as the final confirmation inside an active leave flow.
    leave_start_phrases = [
        "new leave",
        "fresh leave",
        "start new leave",
        "start again leave",
        "restart leave",
        "apply new leave",
        "create new leave",
        "i want to apply a new leave",
        "i want to apply leave",
        "i need to apply leave",
        "i want leave",
        "i need leave",
        "need casual leave",
        "need earned leave",
        "need half day leave",
        "need half leave",
        "apply leave",
        "apply casual leave",
        "apply earned leave",
        "apply half day leave",
        "apply half leave",
        "apply for leave",
        "request leave",
        "request casual leave",
        "request earned leave",
        "request half day leave",
        "request half leave",
        "request leave now",
        "submit leave request",
        "start leave request",
        "create leave request",
        "leave application",
    ]

    if any(phrase in text for phrase in leave_start_phrases):
        return "apply_leave"

    leave_action_words = ["apply", "request", "create", "start"]

    if "leave" in text and any(word in text for word in leave_action_words):
        return "apply_leave"

    if any(word in text for word in [
        "schedule meeting",
        "setup meeting",
        "set up meeting",
        "create meeting",
        "management group meeting",
        "assign minutes writer",
        "meeting minutes",
    ]):
        return "schedule_management_meeting"

    if any(word in text for word in [
        "remind me",
        "set reminder",
        "create reminder",
        "add reminder",
    ]):
        return "create_reminder"

    return ""


def _tenant_match_filter(user_context=None):
    tenant_id = _tenant_id(user_context)
    values = _id_variants(tenant_id)

    if not values:
        return {}

    return {
        "$or": [
            {"tenant_id": {"$in": values}},
            {"company_id": {"$in": values}},
            {"tenant": {"$in": values}},
        ]
    }


def _department(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    employee = user_context.get("employee") or {}

    return _safe_str(
        employee.get("department")
        or employee.get("department_name")
        or user_context.get("department")
        or user_context.get("department_name")
    )


def _number_value(doc, keys, default=0):
    for key in keys:
        value = doc.get(key)

        if value in [None, ""]:
            continue

        try:
            return float(value)
        except Exception:
            continue

    return default


def _detect_leave_type_from_doc(doc):
    raw = _lower(
        doc.get("leave_type")
        or doc.get("type")
        or doc.get("name")
        or doc.get("title")
        or doc.get("leave_name")
        or doc.get("label")
    )

    if "casual" in raw or raw == "cl":
        return "CL"

    if "earned" in raw or raw == "el":
        return "EL"

    if "lwp" in raw or "without pay" in raw:
        return "LWP"

    if "half" in raw:
        return "HALF_DAY"

    return raw.upper() if raw else ""


def _calculate_leave_available_and_used(doc):
    direct_available = _number_value(
        doc,
        [
            "available",
            "available_balance",
            "balance",
            "remaining",
            "remaining_balance",
            "closing",
            "closing_balance",
            "current_balance",
        ],
        default=None,
    )

    used = _number_value(
        doc,
        [
            "used",
            "used_leave",
            "leave_used",
            "taken",
            "leave_taken",
            "availed",
            "deducted",
        ],
        default=0,
    )

    if direct_available is not None:
        return direct_available, used

    opening = _number_value(
        doc,
        [
            "opening",
            "opening_balance",
            "opening_leave",
            "total",
            "total_leave",
            "allocated",
            "allocated_leave",
        ],
        default=0,
    )

    credited = _number_value(
        doc,
        [
            "credited",
            "credit",
            "credited_leave",
            "added",
            "additional",
        ],
        default=0,
    )

    available = opening + credited - used

    return available, used


def get_leave_type_options(user_context=None):
    db = get_db()

    employee_id = _employee_id(user_context)
    tenant_filter = _tenant_match_filter(user_context)

    cl = 0
    el = 0
    cl_used = 0
    el_used = 0

    if employee_id:
        person_values = _id_variants(employee_id)

        query_parts = []

        if tenant_filter:
            query_parts.append(tenant_filter)

        query_parts.append({
            "$or": [
                {"employee_id": {"$in": person_values}},
                {"user_id": {"$in": person_values}},
                {"employee": {"$in": person_values}},
                {"staff_id": {"$in": person_values}},
            ]
        })

        query = {"$and": query_parts}

        leave_balance_docs = list(db.leave_balances.find(query).limit(50))

        # Format 1: direct CL/EL fields in one doc
        for doc in leave_balance_docs:
            cl_direct = _number_value(
                doc,
                [
                    "cl_balance",
                    "casual_leave_balance",
                    "casual_leave_available",
                    "cl_available",
                    "CL",
                ],
                default=None,
            )

            el_direct = _number_value(
                doc,
                [
                    "el_balance",
                    "earned_leave_balance",
                    "earned_leave_available",
                    "el_available",
                    "EL",
                ],
                default=None,
            )

            if cl_direct is not None:
                cl = cl_direct

            if el_direct is not None:
                el = el_direct

            cl_used_direct = _number_value(
                doc,
                [
                    "cl_used",
                    "casual_leave_used",
                    "used_cl",
                ],
                default=None,
            )

            el_used_direct = _number_value(
                doc,
                [
                    "el_used",
                    "earned_leave_used",
                    "used_el",
                ],
                default=None,
            )

            if cl_used_direct is not None:
                cl_used = cl_used_direct

            if el_used_direct is not None:
                el_used = el_used_direct

        # Format 2: one row per leave type
        for doc in leave_balance_docs:
            leave_type = _detect_leave_type_from_doc(doc)
            available, used = _calculate_leave_available_and_used(doc)

            if leave_type == "CL":
                cl = available
                cl_used = used

            elif leave_type == "EL":
                el = available
                el_used = used

    options = [
        {
            "value": "CL",
            "label": f"Casual Leave (CL) - Available: {cl:g}, Used: {cl_used:g}",
        },
        {
            "value": "EL",
            "label": f"Earned Leave (EL) - Available: {el:g}, Used: {el_used:g}",
        },
        {
            "value": "HALF_DAY",
            "label": (
                "Half-Day Leave - Deducts 0.5 day from CL first, "
                "then EL if CL is insufficient"
            ),
        },
        {
            "value": "LWP",
            "label": "Leave Without Pay (LWP)",
        },
    ]

    return options

def _employee_record_is_active(record):
    record = record or {}

    if record.get("is_deleted") is True:
        return False

    if record.get("is_active") is False:
        return False

    if record.get("active") is False:
        return False

    inactive_values = {
        "inactive",
        "in_active",
        "disabled",
        "resigned",
        "resign",
        "left",
        "terminated",
        "alumni",
        "ex_employee",
        "ex-employee",
        "deleted",
        "blocked",
        "suspended",
    }

    for key in ["status", "employment_status", "employee_status"]:
        value = _lower(record.get(key)).replace(" ", "_")

        if value and value in inactive_values:
            return False

    return True


def _employee_lookup_values_from_context(user_context=None):
    if not isinstance(user_context, dict):
        return []

    employee = user_context.get("employee") or {}

    values = [
        user_context.get("employee_id"),
        user_context.get("user_id"),
        user_context.get("_id"),
        user_context.get("email"),
        employee.get("_id"),
        employee.get("id"),
        employee.get("user_id"),
        employee.get("employee_id"),
        employee.get("employee_ref_id"),
        employee.get("employee_profile_id"),
        employee.get("employee_code"),
        employee.get("emp_code"),
        employee.get("code"),
        employee.get("email"),
        employee.get("official_email"),
        employee.get("work_email"),
    ]

    cleaned = []

    for value in values:
        for candidate in _id_variants(value):
            if candidate and candidate not in cleaned:
                cleaned.append(candidate)

    return cleaned


def _current_employee_for_ai_action(user_context=None):
    db = get_db()
    tenant_filter = _tenant_match_filter(user_context)
    lookup_values = _employee_lookup_values_from_context(user_context)

    if not lookup_values:
        return None

    object_values = [
        value for value in lookup_values
        if isinstance(value, ObjectId)
    ]

    text_values = [
        _safe_str(value)
        for value in lookup_values
        if _safe_str(value)
    ]

    lookup_or = [
        {"_id": {"$in": object_values}},
        {"id": {"$in": text_values}},
        {"user_id": {"$in": text_values}},
        {"employee_user_id": {"$in": text_values}},
        {"login_user_id": {"$in": text_values}},
        {"account_user_id": {"$in": text_values}},
        {"employee_id": {"$in": text_values}},
        {"employee_ref_id": {"$in": text_values}},
        {"employee_profile_id": {"$in": text_values}},
        {"employee_code": {"$in": text_values}},
        {"emp_code": {"$in": text_values}},
        {"code": {"$in": text_values}},
        {"email": {"$in": text_values}},
        {"official_email": {"$in": text_values}},
        {"work_email": {"$in": text_values}},
        {"username": {"$in": text_values}},
    ]

    query_parts = [
        {"is_deleted": {"$ne": True}},
        {"$or": lookup_or},
    ]

    if tenant_filter:
        query_parts.insert(0, tenant_filter)

    employee = db.employees.find_one({"$and": query_parts})

    if employee:
        return employee

    return db.employees.find_one({
        "$and": [
            {"is_deleted": {"$ne": True}},
            {"$or": lookup_or},
        ]
    })


def _active_employee_query_for_handover(user_context=None):
    query_parts = []

    tenant_filter = _tenant_match_filter(user_context)

    if tenant_filter:
        query_parts.append(tenant_filter)

    query_parts.extend([
        {"is_deleted": {"$ne": True}},
        {"is_active": {"$ne": False}},
        {"active": {"$ne": False}},
        {
            "status": {
                "$nin": [
                    "Inactive",
                    "inactive",
                    "INACTIVE",
                    "Resigned",
                    "resigned",
                    "Left",
                    "left",
                    "Terminated",
                    "terminated",
                    "Alumni",
                    "alumni",
                    "Deleted",
                    "deleted",
                    "Blocked",
                    "blocked",
                    "Suspended",
                    "suspended",
                ]
            }
        },
    ])

    return {"$and": query_parts} if query_parts else {}


def _scope_text(value):
    return _safe_str(value).strip().lower()


def _scope_value_set(*values):
    scoped = set()

    for value in values:
        for variant in _id_variants(value):
            text = _scope_text(variant)

            if text:
                scoped.add(text)

    return scoped


def _employee_identity_scope_values(employee=None):
    employee = employee or {}

    return _scope_value_set(
        employee.get("_id"),
        employee.get("id"),
        employee.get("user_id"),
        employee.get("employee_user_id"),
        employee.get("login_user_id"),
        employee.get("account_user_id"),
        employee.get("employee_id"),
        employee.get("employee_ref_id"),
        employee.get("employee_profile_id"),
        employee.get("employee_code"),
        employee.get("emp_code"),
        employee.get("code"),
        employee.get("email"),
        employee.get("official_email"),
        employee.get("work_email"),
        employee.get("username"),
    )


def _employee_tl_scope_values(employee=None):
    employee = employee or {}

    return _scope_value_set(
        employee.get("team_leader_id"),
        employee.get("team_leader_user_id"),
        employee.get("tl_id"),
        employee.get("team_lead_id"),
        employee.get("leader_id"),
    )


def _employee_ro_scope_values(employee=None):
    employee = employee or {}

    return _scope_value_set(
        employee.get("reporting_officer_id"),
        employee.get("reporting_officer_user_id"),
        employee.get("ro_id"),
        employee.get("manager_id"),
        employee.get("reporting_manager_id"),
    )


def _employee_department_scope_value(employee=None):
    employee = employee or {}

    return _scope_text(
        employee.get("department")
        or employee.get("department_name")
        or employee.get("assigned_department")
        or employee.get("assigned_department_name")
    )


def _employee_record_matches_ai_action_scope(current_employee=None, candidate_employee=None):
    """
    STRICT_AI_ACTION_SCOPE:
    Handover employee options are restricted to the logged-in employee's own
    department/team scope. This prevents AI guided leave handover from showing
    employees from unrelated departments.
    """

    if not current_employee or not candidate_employee:
        return False

    current_ids = _employee_identity_scope_values(current_employee)
    candidate_ids = _employee_identity_scope_values(candidate_employee)

    current_department = _employee_department_scope_value(current_employee)
    candidate_department = _employee_department_scope_value(candidate_employee)

    if current_department and candidate_department and current_department == candidate_department:
        return True

    current_tl_values = _employee_tl_scope_values(current_employee)
    current_ro_values = _employee_ro_scope_values(current_employee)
    candidate_tl_values = _employee_tl_scope_values(candidate_employee)
    candidate_ro_values = _employee_ro_scope_values(candidate_employee)

    if candidate_ids.intersection(current_tl_values.union(current_ro_values)):
        return True

    if current_ids.intersection(candidate_tl_values.union(candidate_ro_values)):
        return True

    if current_tl_values and candidate_tl_values and current_tl_values.intersection(candidate_tl_values):
        return True

    if current_ro_values and candidate_ro_values and current_ro_values.intersection(candidate_ro_values):
        return True

    return False


def _project_active_filter_for_ai_action():
    return {
        "$and": [
            {"is_deleted": {"$ne": True}},
            {"deleted": {"$ne": True}},
            {"is_active": {"$ne": False}},
            {"active": {"$ne": False}},
            {
                "status": {
                    "$nin": [
                        "deleted",
                        "Deleted",
                        "DELETED",
                        "cancelled",
                        "Cancelled",
                        "CANCELLED",
                    ]
                }
            },
        ]
    }


def _project_department_scope_parts(department):
    if not _safe_str(department):
        return []

    return [
        {"department": department},
        {"department_name": department},
        {"assigned_department": department},
        {"assigned_department_name": department},
    ]


def _project_handover_scope_query_parts(user_context=None, current_employee=None):
    """
    project_handover_scope:
    Build only the logged-in employee's own project/team scope.
    Never falls back to all tenant projects.
    """

    current_employee = current_employee or {}
    employee_id = _employee_id(user_context)
    user_key = _user_key(user_context)
    department = _department(user_context)

    if not department:
        department = _employee_department_scope_value(current_employee)

    current_person_values = []

    for raw_value in [
        employee_id,
        user_key,
        current_employee.get("_id"),
        current_employee.get("id"),
        current_employee.get("user_id"),
        current_employee.get("employee_user_id"),
        current_employee.get("employee_id"),
        current_employee.get("employee_ref_id"),
        current_employee.get("employee_profile_id"),
        current_employee.get("employee_code"),
        current_employee.get("emp_code"),
        current_employee.get("code"),
        current_employee.get("email"),
        current_employee.get("official_email"),
        current_employee.get("work_email"),
    ]:
        for value in _id_variants(raw_value):
            if value not in current_person_values:
                current_person_values.append(value)

    supervisor_values = []

    for raw_value in [
        current_employee.get("team_leader_id"),
        current_employee.get("team_leader_user_id"),
        current_employee.get("tl_id"),
        current_employee.get("reporting_officer_id"),
        current_employee.get("reporting_officer_user_id"),
        current_employee.get("ro_id"),
        current_employee.get("manager_id"),
    ]:
        for value in _id_variants(raw_value):
            if value not in supervisor_values:
                supervisor_values.append(value)

    scope_or_parts = []

    if current_person_values:
        scope_or_parts.extend([
            {"assigned_to": {"$in": current_person_values}},
            {"assigned_user_id": {"$in": current_person_values}},
            {"assigned_employee_id": {"$in": current_person_values}},
            {"employee_id": {"$in": current_person_values}},
            {"user_id": {"$in": current_person_values}},
            {"created_by": {"$in": current_person_values}},

            {"members": {"$in": current_person_values}},
            {"member_ids": {"$in": current_person_values}},
            {"team_members": {"$in": current_person_values}},
            {"team_member_ids": {"$in": current_person_values}},
            {"collaborators": {"$in": current_person_values}},
            {"collaborator_ids": {"$in": current_person_values}},

            {"team_members.employee_id": {"$in": current_person_values}},
            {"team_members.user_id": {"$in": current_person_values}},
            {"team_members.id": {"$in": current_person_values}},
            {"members.employee_id": {"$in": current_person_values}},
            {"members.user_id": {"$in": current_person_values}},
            {"collaborators.employee_id": {"$in": current_person_values}},
            {"collaborators.user_id": {"$in": current_person_values}},
        ])

    department_parts = _project_department_scope_parts(department)

    if department_parts:
        scope_or_parts.extend(department_parts)

    if supervisor_values:
        supervisor_project_parts = [
            {"team_leader_id": {"$in": supervisor_values}},
            {"team_leader_user_id": {"$in": supervisor_values}},
            {"reporting_officer_id": {"$in": supervisor_values}},
            {"reporting_officer_user_id": {"$in": supervisor_values}},
            {"manager_id": {"$in": supervisor_values}},
        ]

        if department_parts:
            scope_or_parts.append({
                "$and": [
                    {"$or": supervisor_project_parts},
                    {"$or": department_parts},
                ]
            })
        else:
            scope_or_parts.extend(supervisor_project_parts)

    return scope_or_parts


def _format_no_accessible_project_message():
    return "No accessible project/work found for your department/team scope."


def get_handover_employee_options(user_context=None, limit=12):
    db = get_db()

    tenant_id = _tenant_id(user_context)
    employee = _current_employee_for_ai_action(user_context)

    if not employee:
        return []

    query = _active_employee_query_for_handover(user_context)

    docs = list(
        db.employees
        .find(query)
        .sort([("name", 1), ("employee_name", 1)])
        .limit(500)
    )

    options = []
    seen_ids = set()

    for doc in docs:
        if not _employee_record_is_active(doc):
            continue

        if str(doc.get("_id")) == str(employee.get("_id")):
            continue

        if STRICT_AI_ACTION_SCOPE and not _employee_record_matches_ai_action_scope(employee, doc):
            continue

        try:
            resolved = resolve_handover_employee(
                db,
                tenant_id,
                employee,
                str(doc.get("_id")),
            )
        except Exception:
            continue

        handover_id = resolved.get("task_handover_to_id") or str(doc.get("_id"))

        if not handover_id or handover_id in seen_ids:
            continue

        seen_ids.add(handover_id)

        name = (
            resolved.get("task_handover_to_name")
            or doc.get("name")
            or doc.get("employee_name")
            or doc.get("full_name")
            or "Employee"
        )

        designation = (
            doc.get("designation")
            or doc.get("designation_name")
            or ""
        )

        department = (
            doc.get("department")
            or doc.get("department_name")
            or ""
        )

        extra_parts = [
            designation,
            department,
        ]

        extra_text = " - ".join([item for item in extra_parts if item])

        options.append({
            "id": handover_id,
            "label": f"{name}{f' - {extra_text}' if extra_text else ''}",
            "name": name,
            "employee_code": resolved.get("task_handover_employee_id") or employee_code(doc),
            "department": department,
            "designation": designation,
        })

        if len(options) >= limit:
            break

    return options


def get_project_handover_options(user_context=None, limit=12):
    db = get_db()

    tenant_filter = _tenant_match_filter(user_context)

    current_employee = _current_employee_for_ai_action(user_context)

    if not current_employee:
        return []

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    scope_or_parts = _project_handover_scope_query_parts(
        user_context=user_context,
        current_employee=current_employee,
    )

    if not scope_or_parts:
        # No employee/team/department identifiers are available, so do not show
        # any project. No accessible project/work found for this scope.
        return []

    query_parts.append({"$or": scope_or_parts})
    query_parts.append(_project_active_filter_for_ai_action())

    query = {"$and": query_parts}

    docs = list(
        db.projects
        .find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
    )

    # STRICT_AI_ACTION_SCOPE:
    # Never falls back to all tenant projects. If no scoped project is found,
    # the guided leave flow will show "No options found" instead of leaking
    # another department/team project.
    if not docs:
        return []

    options = []

    for doc in docs:
        name = (
            doc.get("name")
            or doc.get("title")
            or doc.get("project_name")
            or doc.get("project_title")
            or "Project"
        )

        status = doc.get("status") or "N/A"

        progress = (
            doc.get("progress")
            or doc.get("progress_percent")
            or doc.get("completion")
            or ""
        )

        extra = f" - {progress}%" if isinstance(progress, (int, float)) else ""

        options.append({
            "id": str(doc.get("_id")),
            "label": f"{name} - {status}{extra}",
            "name": name,
            "status": status,
        })

    return options


def get_management_group_options(user_context=None, limit=10):
    db = get_db()

    tenant_filter = _tenant_match_filter(user_context)
    employee_id = _employee_id(user_context)
    user_key = _user_key(user_context)

    person_values = _id_variants(employee_id) + _id_variants(user_key)

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    if not _is_hr_admin_role(user_context) and person_values:
        query_parts.append({
            "$or": [
                {"members.employee_id": {"$in": person_values}},
                {"members.user_id": {"$in": person_values}},
                {"member_ids": {"$in": person_values}},
                {"created_by": {"$in": person_values}},
            ]
        })

    query = {"$and": query_parts} if query_parts else {}

    docs = list(
        db.management_groups
        .find(query)
        .sort([("name", 1), ("title", 1)])
        .limit(limit)
    )

    options = []

    for doc in docs:
        name = doc.get("name") or doc.get("title") or doc.get("group_name") or "Management Group"

        options.append({
            "id": str(doc.get("_id")),
            "label": name,
            "name": name,
        })

    return options


def get_management_group_member_options(group_id, user_context=None, limit=25):
    db = get_db()

    oid = _as_object_id(group_id)

    if not oid:
        return []

    group = db.management_groups.find_one({"_id": oid})

    if not group:
        return []

    members = group.get("members") or []

    options = []

    for member in members[:limit]:
        if not isinstance(member, dict):
            continue

        name = (
            member.get("name")
            or member.get("employee_name")
            or member.get("full_name")
            or "Member"
        )

        designation = member.get("designation") or member.get("designation_name") or ""

        member_id = (
            member.get("employee_id")
            or member.get("user_id")
            or member.get("_id")
            or member.get("id")
        )

        options.append({
            "id": _safe_str(member_id),
            "label": f"{name}{f' - {designation}' if designation else ''}",
            "name": name,
        })

    return options


def _format_options(options):
    if not options:
        return "No options found."

    lines = []

    for index, item in enumerate(options, start=1):
        label = (
            item.get("label")
            or item.get("name")
            or item.get("value")
            or "Option"
        )

        lines.append(f"{index}. {label}")

    return "\n".join(lines)


def _normalize_option_text(value):
    text = _lower(value)

    typo_fixes = {
        "leaev": "leave",
        "leaeve": "leave",
        "leav": "leave",
        "earened": "earned",
        "erned": "earned",
        "casul": "casual",
        "casula": "casual",
        "tommorow": "tomorrow",
        "tomorow": "tomorrow",
        "tmrw": "tomorrow",
        "handiver": "handover",
        "hand over": "handover",
        "hand-over": "handover",
        "proejct": "project",
        "projct": "project",
        "atlnta": "atlanta",
        "gogoii": "gogoi",
        "unnatfarm": "unnat farm",
        "f p o": "fpo",
        "m i s": "mis",
    }

    for wrong, right in typo_fixes.items():
        text = text.replace(wrong, right)

    text = (
        text.replace("-", " ")
        .replace("_", " ")
        .replace("/", " ")
        .replace("(", " ")
        .replace(")", " ")
        .replace(".", " ")
        .replace(",", " ")
        .replace(":", " ")
        .replace(";", " ")
        .replace("'", " ")
        .replace('"', " ")
    )

    return " ".join(text.split())


def _strip_voice_instruction_suffix(text):
    """
    Frontend voice mode may append an internal speed instruction such as:
    "Reply very briefly in 1-2 short sentences because this is a voice conversation."
    This must never be treated as the user's actual command.
    """
    clean = _safe_str(text)

    if not clean:
        return ""

    clean = re.split(
        r"\n\s*\n\s*reply\s+very\s+briefly\b",
        clean,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    clean = re.split(
        r"\breply\s+very\s+briefly\s+in\s+1\s*[-–]\s*2\s+short\s+sentences\b",
        clean,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    clean = re.split(
        r"\bbecause\s+this\s+is\s+a\s+voice\s+conversation\b",
        clean,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    return " ".join(clean.replace("\n", " ").split())


def _simple_leave_type_label(leave_type):
    normalized = normalize_leave_type(leave_type)

    if normalized == "CL":
        return "Casual Leave"

    if normalized == "EL":
        return "Earned Leave"

    if normalized == "HALF-DAY":
        return "Half-Day Leave"

    if normalized == "COMP-OFF":
        return "Comp-Off"

    if normalized == "LWP":
        return "Leave Without Pay"

    return leave_type_label(normalized) if normalized else "Leave"


def _set_leave_type_data(data, selected=None, detected_leave_type=""):
    raw_type = ""

    if selected:
        raw_type = (
            selected.get("value")
            or selected.get("name")
            or selected.get("label")
            or detected_leave_type
        )
    else:
        raw_type = detected_leave_type

    leave_type = _normalize_ai_leave_type(raw_type)

    if not leave_type:
        return data

    data["leave_type"] = leave_type
    data["leave_type_label"] = _simple_leave_type_label(leave_type)

    if selected and selected.get("label"):
        data["leave_type_balance_label"] = selected.get("label")

    return data


def _extract_leave_reason_from_command(question):
    clean = _strip_voice_instruction_suffix(question)

    if not clean:
        return ""

    patterns = [
        r"\b(?:leave\s+reason|reason)\s+(?:is|as|mention|mentioned|be|for|:)?\s*(.+)$",
        r"\b(?:because|due\s+to|as)\s+(.+)$",
    ]

    for pattern in patterns:
        match = re.search(pattern, clean, flags=re.IGNORECASE)

        if not match:
            continue

        reason = _safe_str(match.group(1))
        reason = re.split(
            r"\b(?:please\s+)?(?:submit|confirm|apply)\b",
            reason,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        reason = re.sub(
            r"^(?:mention|mentioned|is|as|for|my|the)\s+",
            "",
            reason,
            flags=re.IGNORECASE,
        )

        return " ".join(reason.strip(" .,-:;").split())

    return ""


def _extract_handover_command_parts(question):
    clean = _strip_voice_instruction_suffix(question)

    result = {
        "project_text": "",
        "employee_text": "",
        "reason": _extract_leave_reason_from_command(clean),
    }

    if not clean:
        return result

    handover_match = re.search(
        r"\b(?:handover|hand\s+over|hand-over|handiver)\b\s+(.+)$",
        clean,
        flags=re.IGNORECASE,
    )

    if not handover_match:
        return result

    tail = _safe_str(handover_match.group(1))

    tail_without_reason = re.split(
        r"\b(?:and\s+)?(?:leave\s+)?reason\b|\bbecause\b|\bdue\s+to\b",
        tail,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    if re.search(r"\bto\b", tail_without_reason, flags=re.IGNORECASE):
        project_part, employee_part = re.split(
            r"\bto\b",
            tail_without_reason,
            maxsplit=1,
            flags=re.IGNORECASE,
        )
    else:
        project_part = tail_without_reason
        employee_part = ""

    project_part = re.sub(
        r"\b(?:the|my|a|an|project|work|task|active|ongoing|open)\b",
        " ",
        project_part,
        flags=re.IGNORECASE,
    )

    employee_part = re.sub(
        r"\b(?:sir|madam|employee|person|team\s+member)\b",
        " ",
        employee_part,
        flags=re.IGNORECASE,
    )

    result["project_text"] = " ".join(project_part.strip(" .,-:;").split())
    result["employee_text"] = " ".join(employee_part.strip(" .,-:;").split())

    return result


def _looks_like_no_handover_project(text):
    clean = _normalize_option_text(text)

    return clean in {
        "none",
        "no",
        "skip",
        "not required",
        "no project",
        "no handover",
        "nothing",
    }


def _apply_detected_project_and_handover(data, question, user_context=None):
    parts = _extract_handover_command_parts(question)
    project_text = parts.get("project_text")
    employee_text = parts.get("employee_text")
    reason = parts.get("reason")

    if reason and _is_valid_leave_reason(reason):
        data["reason"] = reason

    if project_text:
        if _looks_like_no_handover_project(project_text):
            data["handover_project_id"] = ""
            data["handover_project_name"] = "None"
        else:
            project_options = data.get("project_options") or get_project_handover_options(user_context)
            data["project_options"] = project_options

            selected_project = _extract_selected_option(project_text, project_options)

            if selected_project:
                data["handover_project_id"] = selected_project.get("id")
                data["handover_project_name"] = (
                    selected_project.get("name")
                    or selected_project.get("label")
                    or project_text
                )
            else:
                # Keep the spoken project name. Native resolve_project_handover()
                # will validate/fuzzy-resolve it during final submission.
                data["handover_project_id"] = ""
                data["handover_project_name"] = project_text

    if employee_text:
        handover_options = data.get("handover_options") or get_handover_employee_options(
            user_context,
            limit=50,
        )
        data["handover_options"] = handover_options

        selected_employee = _extract_selected_option(employee_text, handover_options)

        if selected_employee:
            data["handover_to_id"] = selected_employee.get("id")
            data["handover_to_name"] = (
                selected_employee.get("name")
                or selected_employee.get("label")
                or employee_text
            )
        else:
            data["handover_to_search_text"] = employee_text

    return data


def _leave_ready_for_confirmation(data):
    return bool(
        data.get("leave_type")
        and data.get("date_range_text")
        and data.get("handover_project_name")
        and data.get("handover_to_name")
        and _is_valid_leave_reason(data.get("reason"))
    )

def _extract_project_selection_text(text):
    clean = _safe_str(text)

    if not clean:
        return ""

    # If user says: "handover Unnat Farm MIS to Atlanta Gogoi reason is sick leave"
    # then only "Unnat Farm MIS" should be matched against project options.
    handover_match = re.search(
        r"\b(?:handover|hand over|handiver)\b\s+(.+)$",
        clean,
        flags=re.IGNORECASE,
    )

    if handover_match:
        clean = _safe_str(handover_match.group(1))

    clean = re.split(
        r"\b(?:to|reason|because|and reason|for reason)\b",
        clean,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    clean = re.sub(
        r"\b(?:the|a|an|project|work|task|active|ongoing|open|select|option)\b",
        " ",
        clean,
        flags=re.IGNORECASE,
    )

    return " ".join(clean.split()).strip(" .,-")


def _compact_match_text(value):
    clean = _normalize_option_text(value)

    stop_words = {
        "the",
        "a",
        "an",
        "project",
        "work",
        "task",
        "handover",
        "hand",
        "over",
        "to",
        "and",
        "reason",
        "is",
        "for",
        "please",
        "select",
        "option",
        "active",
        "ongoing",
        "open",
        "during",
        "my",
        "leave",
    }

    return " ".join([
        token
        for token in clean.split()
        if token and token not in stop_words
    ])


def _match_score(search_text, candidate_text):
    search = _compact_match_text(search_text)
    candidate = _compact_match_text(candidate_text)

    if not search or not candidate:
        return 0

    if search == candidate:
        return 100

    if search in candidate:
        return 94

    if candidate in search:
        return 90

    search_tokens = set(search.split())
    candidate_tokens = set(candidate.split())

    if not search_tokens or not candidate_tokens:
        return 0

    overlap = search_tokens.intersection(candidate_tokens)
    overlap_score = int((len(overlap) / max(len(search_tokens), 1)) * 88)

    ratio_score = int(SequenceMatcher(None, search, candidate).ratio() * 100)

    return max(overlap_score, ratio_score)


def _extract_selected_option(text, options):
    clean = _normalize_option_text(text)

    if not options:
        return None

    if clean.isdigit():
        index = int(clean) - 1
        if 0 <= index < len(options):
            return options[index]

    aliases = {
        "casual leave": "cl",
        "casual": "cl",
        "cl": "cl",
        "earned leave": "el",
        "earned": "el",
        "el": "el",
        "half day": "half_day",
        "halfday": "half_day",
        "half leave": "half_day",
        "leave without pay": "lwp",
        "loss of pay": "lwp",
    }

    clean_alias = aliases.get(clean, clean)

    best_option = None
    best_score = 0

    for option in options:
        option_value = _normalize_option_text(option.get("value"))
        option_label = _normalize_option_text(option.get("label"))
        option_name = _normalize_option_text(option.get("name"))
        option_id = _normalize_option_text(option.get("id"))

        option_value_alias = aliases.get(option_value, option_value)
        option_label_alias = aliases.get(option_label, option_label)
        option_name_alias = aliases.get(option_name, option_name)

        if option_id and clean == option_id:
            return option

        if option_value_alias and clean_alias == option_value_alias:
            return option

        if option_name_alias and clean_alias == option_name_alias:
            return option

        if option_label_alias and clean_alias == option_label_alias:
            return option

        if option_label_alias and clean_alias in option_label_alias:
            return option

        if option_name_alias and option_name_alias in clean_alias:
            return option

        for candidate in [
            option.get("label"),
            option.get("name"),
            option.get("value"),
            option.get("employee_code"),
            option.get("department"),
            option.get("designation"),
            option.get("status"),
        ]:
            score = _match_score(clean_alias, candidate)

            if score > best_score:
                best_score = score
                best_option = option

    if best_score >= 58:
        return best_option

    return None

def _employee_name(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    employee = user_context.get("employee") or {}

    return _safe_str(
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or user_context.get("name")
    )


def _employee_department(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    employee = user_context.get("employee") or {}

    return _safe_str(
        employee.get("department")
        or employee.get("department_name")
        or user_context.get("department")
        or user_context.get("department_name")
    )


def _employee_designation(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    employee = user_context.get("employee") or {}

    return _safe_str(
        employee.get("designation")
        or employee.get("designation_name")
        or user_context.get("designation")
        or user_context.get("designation_name")
    )


def _parse_leave_dates(date_text):
    """
    Converts AI-entered date text into HRMS-compatible ISO dates.

    Supported:
    - today
    - tomorrow
    - day after tomorrow
    - 2026-06-12
    - 12-06-2026
    - 12/06/2026
    - 2026-06-12 to 2026-06-13

    If the date is not clear, it returns invalid=True.
    """

    text = _safe_str(date_text)
    lowered = _lower(text)

    today = date.today()

    if not text:
        return {
            "invalid": True,
            "message": "Leave date is required.",
        }

    if lowered in ["today"]:
        start = today
        end = today

    elif lowered in ["tomorrow", "tmrw", "tomorow"]:
        start = today + timedelta(days=1)
        end = start

    elif lowered in ["day after tomorrow", "after tomorrow"]:
        start = today + timedelta(days=2)
        end = start

    else:
        normalized = (
            text.replace(" to ", "|")
            .replace(" till ", "|")
            .replace(" until ", "|")
            .replace(" - ", "|")
        )

        parts = [item.strip() for item in normalized.split("|") if item.strip()]

        def parse_any_date(value):
            value = _safe_str(value)

            # Already ISO format
            parsed = parse_date(value)
            if parsed:
                return parsed

            for fmt in ["%d-%m-%Y", "%d/%m/%Y", "%d %B %Y", "%d %b %Y"]:
                try:
                    return datetime.strptime(value, fmt).date()
                except Exception:
                    continue

            return None

        if len(parts) == 1:
            start = parse_any_date(parts[0])
            end = start
        else:
            start = parse_any_date(parts[0])
            end = parse_any_date(parts[-1])

        if not start or not end:
            return {
                "invalid": True,
                "message": (
                    "I could not understand the leave date. "
                    "Please enter date like 2026-06-12 or 12-06-2026."
                ),
            }

    if end < start:
        return {
            "invalid": True,
            "message": "Upto date cannot be before from date.",
        }

    if start < today:
        return {
            "invalid": True,
            "message": "Leave date cannot be in the past.",
        }

    return {
        "invalid": False,
        "start_date": start,
        "end_date": end,
        "from_date": start.isoformat(),
        "to_date": end.isoformat(),
        "upto_date": end.isoformat(),
        "date_text": text,
    }

def _normalize_ai_leave_type(value):
    text = _safe_str(value).replace("_", " ")
    return normalize_leave_type(text)


def _detect_leave_type_from_text(text):
    clean = _normalize_option_text(text)

    if not clean:
        return ""

    if any(phrase in clean for phrase in [
        "half day",
        "halfday",
        "half leave",
        "half",
    ]):
        return "HALF-DAY"

    if any(phrase in clean for phrase in [
        "casual leave",
        "casual",
        "cl",
    ]):
        return "CL"

    if any(phrase in clean for phrase in [
        "earned leave",
        "earned",
        "el",
    ]):
        return "EL"

    if any(phrase in clean for phrase in [
        "comp off",
        "compoff",
        "compensatory",
    ]):
        return "COMP-OFF"

    if any(phrase in clean for phrase in [
        "leave without pay",
        "loss of pay",
        "lwp",
    ]):
        return "LWP"

    return ""


def _leave_option_for_type(leave_type, leave_options):
    target = _normalize_ai_leave_type(leave_type)

    if not target:
        return None

    for option in leave_options or []:
        option_type = _normalize_ai_leave_type(
            option.get("value")
            or option.get("name")
            or option.get("label")
        )

        if option_type == target:
            return option

    selected = _extract_selected_option(leave_type, leave_options or [])

    if selected:
        return selected

    return None


def _extract_leave_date_text_from_command(question):
    text = _safe_str(question)
    lowered = _lower(text)

    if not text:
        return ""

    if "day after tomorrow" in lowered or "after tomorrow" in lowered:
        return "day after tomorrow"

    if "tomorrow" in lowered or "tmrw" in lowered or "tomorow" in lowered:
        return "tomorrow"

    if "today" in lowered:
        return "today"

    month_names = (
        "jan|january|feb|february|mar|march|apr|april|may|jun|june|"
        "jul|july|aug|august|sep|sept|september|oct|october|"
        "nov|november|dec|december"
    )

    iso_date = r"\d{4}-\d{1,2}-\d{1,2}"
    dmy_date = r"\d{1,2}[/-]\d{1,2}[/-]\d{4}"
    named_date = rf"\d{{1,2}}\s+(?:{month_names})\s+\d{{4}}"
    date_token = rf"(?:{iso_date}|{dmy_date}|{named_date})"

    pattern = rf"({date_token})(?:\s*(?:to|till|until)\s*|\s+-\s*)?({date_token})?"
    match = re.search(pattern, text, flags=re.IGNORECASE)

    if not match:
        return ""

    first_date = _safe_str(match.group(1))
    second_date = _safe_str(match.group(2))

    if first_date and second_date:
        return f"{first_date} to {second_date}"

    return first_date


def _is_valid_leave_reason(text):
    reason = _safe_str(text)
    return len(reason) >= 5


def _looks_like_leave_submit_confirmation(text):
    clean = _normalize_option_text(_strip_voice_instruction_suffix(text))

    submit_phrases = {
        "confirm",
        "confirm it",
        "yes",
        "yes confirm",
        "yes please",
        "yes submit",
        "submit",
        "submit it",
        "submit this",
        "please submit",
        "please submit it",
        "submit leave",
        "submit my leave",
        "please submit leave",
        "please submit my leave",
        "submit the leave",
        "please submit the leave",
        "submit leave request",
        "submit the leave request",
        "apply",
        "apply it",
        "apply leave",
        "apply my leave",
        "please apply",
        "please apply leave",
        "please apply my leave",
        "go ahead",
        "yes go ahead",
        "okay",
        "ok",
        "okay submit",
        "ok submit",
        "done",
        "proceed",
        "please proceed",
    }

    if clean in submit_phrases:
        return True

    return bool(
        re.search(
            r"\b(?:please\s+)?(?:confirm|submit|apply|proceed)\b.*\b(?:leave|it|request)?\b",
            clean,
            flags=re.IGNORECASE,
        )
        and not _looks_like_cancel_confirmation(clean)
    )


def _looks_like_cancel_confirmation(text):
    clean = _normalize_option_text(_strip_voice_instruction_suffix(text))

    return clean in {
        "cancel",
        "no",
        "stop",
        "do not submit",
        "dont submit",
        "don t submit",
        "do not apply",
        "dont apply",
        "don t apply",
        "discard",
        "discard it",
        "clear",
        "clear this",
    }


def _leave_review_text(data):
    leave_type = data.get("leave_type")
    leave_type_text = data.get("leave_type_label") or _simple_leave_type_label(leave_type)

    return (
        "Please confirm your leave request:\n\n"
        f"Leave Type: {leave_type_text}\n"
        f"Date/Range: {data.get('date_range_text')}\n"
        f"Handover Work/Project: {data.get('handover_project_name') or 'None'}\n"
        f"Handover To: {data.get('handover_to_name') or 'Not selected'}\n"
        f"Reason: {data.get('reason')}\n\n"
        "Say confirm, submit it, or apply leave to submit. Say cancel to stop."
    )

def _create_ai_audit_log(
    user_context=None,
    action_type="",
    status="success",
    message="",
    metadata=None,
):
    """
    Stores safe AI assistant action audit logs.
    Do not store secrets or private tokens here.
    """

    db = get_db()

    tenant_id = _tenant_id(user_context)
    user_key = _user_key(user_context)

    employee_name = ""
    employee_id = ""

    if isinstance(user_context, dict):
        employee_id = _employee_id(user_context)
        employee = user_context.get("employee") or {}

        employee_name = (
            employee.get("name")
            or employee.get("employee_name")
            or employee.get("full_name")
            or user_context.get("name")
            or ""
        )

    try:
        db.ai_action_logs.insert_one({
            "tenant_id": tenant_id,
            "user_id": user_key,
            "employee_id": employee_id,
            "employee_name": employee_name,
            "action_type": action_type,
            "status": status,
            "message": message,
            "metadata": metadata or {},
            "source": "ai_assistant",
            "created_at": _now_utc(),
        })
    except Exception:
        pass

def _create_notification_safe(
    tenant_id=None,
    user_id=None,
    title="",
    message="",
    notification_type="ai_assistant"
):
    db = get_db()

    if not user_id:
        return

    try:
        db.notifications.insert_one({
            "tenant_id": tenant_id,
            "user_id": user_id,
            "recipient_id": user_id,
            "title": title,
            "message": message,
            "type": notification_type,
            "is_read": False,
            "read": False,
            "created_at": _now_utc(),
            "updated_at": _now_utc(),
        })
    except Exception:
        pass


def _submit_leave_request_from_ai(data, user_context=None):
    """
    Creates leave request using the same structure as normal HRMS Apply Leave.

    This fixes:
    - Team Leader own leave goes to Reporting Officer
    - Employee leave goes Team Leader -> Reporting Officer
    - HR notification compatibility
    - Application Status field compatibility
    - Attendance Excel approved leave compatibility
    """

    db = get_db()

    tenant_id = _tenant_id(user_context)
    employee_id = _employee_id(user_context)
    user_key = _user_key(user_context)

    employee_obj_id = _as_object_id(employee_id)

    if not employee_obj_id:
        raise RuntimeError("Employee profile is not mapped properly for this login.")

    employee = db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    })

    if not employee:
        employee = db.employees.find_one({
            "_id": employee_obj_id,
            "is_deleted": {"$ne": True},
        })

    if not employee:
        raise RuntimeError("Employee profile was not found for this login.")

    leave_type = normalize_leave_type(data.get("leave_type"))

    if leave_type not in ["CL", "EL", "COMP-OFF", "HALF-DAY"]:
        raise RuntimeError(
            "Leave type must be Casual Leave, Earned Leave, Comp-Off, or Half-Day."
        )

    parsed_dates = _parse_leave_dates(data.get("date_range_text"))

    if parsed_dates.get("invalid"):
        raise RuntimeError(parsed_dates.get("message"))

    from_date = parsed_dates.get("start_date")
    to_date = parsed_dates.get("end_date")

    reason = _safe_str(data.get("reason"))

    if not reason:
        raise RuntimeError("Leave reason is required.")

    leave_days = calculate_leave_days({
        "from_date": parsed_dates.get("from_date"),
        "to_date": parsed_dates.get("to_date"),
        "leave_days": data.get("leave_days"),
        "leave_type": leave_type,
        "is_half_day": leave_type == "HALF-DAY",
        "day_type": "half_day" if leave_type == "HALF-DAY" else "full_day",
    })

    # Native HRMS duplicate leave check
    existing_leave = db.leave_requests.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "from_date": {"$lte": to_date.isoformat()},
        "to_date": {"$gte": from_date.isoformat()},
        "status": {"$in": ["pending", "approved", "in_review"]},
        "is_deleted": {"$ne": True},
    })

    if existing_leave:
        raise RuntimeError(
            "A pending or approved leave already exists in this date range."
        )

    # Native HRMS balance check.
    # Half-Day never fails at apply time; final approval deducts CL first, then EL, then LWP.
    sufficient, balance = has_sufficient_leave_balance(
        db,
        employee,
        leave_type,
        leave_days
    )

    if not sufficient:
        available = float(balance.get("available", 0) or 0) if balance else 0
        raise RuntimeError(
            f"Insufficient {leave_type_label(leave_type)} balance. Available: {available:g}"
        )

    try:
        handover_data = resolve_handover_employee(
            db,
            tenant_id,
            employee,
            data.get("handover_to_id"),
        )

        project_data = resolve_project_handover(
            db,
            tenant_id,
            data.get("handover_project_id"),
            data.get("handover_project_name"),
            employee=employee,
        )

    except ValueError as exc:
        raise RuntimeError(str(exc))

    initial_stage = build_initial_leave_stage(employee)
    now = datetime.utcnow()

    leave_doc = {
        "tenant_id": tenant_id,

        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "employee_name": employee_display_name(employee),
        "employee_email": employee.get("email", ""),

        "department": employee.get("department", ""),
        "department_name": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "designation_name": employee.get("designation", ""),

        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),

        "leave_type": leave_type,
        "leave_type_label": leave_type_label(leave_type),
        "requested_leave_type": leave_type,
        "requested_leave_type_label": leave_type_label(leave_type),

        "is_half_day": leave_type == "HALF-DAY" or leave_days == 0.5,
        "day_type": "half_day" if leave_type == "HALF-DAY" or leave_days == 0.5 else "full_day",
        "leave_days": leave_days,
        "days": leave_days,
        "total_days": leave_days,

        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "upto_date": to_date.isoformat(),
        "start_date": from_date.isoformat(),
        "end_date": to_date.isoformat(),
        "date_from": from_date.isoformat(),
        "date_to": to_date.isoformat(),
        "date_range_text": data.get("date_range_text"),

        "reason": reason,
        "leave_reason": reason,

        **handover_data,
        **project_data,

        # Extra aliases for older/newer frontend screens
        "task_handover": handover_data.get("task_handover_to_name", ""),
        "work_handover": handover_data.get("task_handover_to_name", ""),
        "handover_to_id": handover_data.get("task_handover_to_id", ""),
        "handover_to_name": handover_data.get("task_handover_to_name", ""),

        "project_handover": project_data.get("project_handover_name", ""),
        "handover_project_id": project_data.get("project_handover_id", ""),
        "handover_project_name": project_data.get("project_handover_name", ""),

        "status": "pending",
        "approval_status": "pending",
        "request_status": "pending",
        "final_status": "pending",

        "approval_stage": initial_stage,
        "approval_stage_label": leave_stage_label(initial_stage),
        **leave_stage_status_fields(initial_stage),

        "approval_history": [
            {
                "action": "submitted",
                "status": "pending",
                "stage": initial_stage,
                "stage_label": leave_stage_label(initial_stage),
                "by_user_id": user_key,
                "by_name": employee_display_name(employee),
                "at": now,
                "remark": "Submitted through AI Assistant",
            }
        ],

        "balance_deducted": False,
        "source": "ai_assistant",
        "created_by": user_key,
        "created_at": now,
        "updated_at": now,
        "is_deleted": False,
    }

    result = db.leave_requests.insert_one(leave_doc)
    leave_doc["_id"] = result.inserted_id

    # Use native HRMS approver notification logic
    notify_next_leave_approvers(db, employee, leave_doc, initial_stage)

    _create_ai_audit_log(
        user_context=user_context,
        action_type="apply_leave",
        status="success",
        message="Leave request submitted through AI Assistant using native HRMS workflow.",
        metadata={
            "leave_request_id": str(result.inserted_id),
            "approval_stage": initial_stage,
            "leave_type": leave_type,
            "from_date": from_date.isoformat(),
            "to_date": to_date.isoformat(),
            "leave_days": leave_days,
        },
    )

    clear_pending_action(user_context)

    if initial_stage == "team_leader":
        response_message = "Your request has been sent to your Team Leader for approval."
    elif initial_stage == "reporting_officer":
        response_message = "Your request has been sent to your Reporting Officer for approval."
    else:
        response_message = "Your request has been sent to HR for approval."

    return {
        "leave_request_id": str(result.inserted_id),
        "approval_stage": leave_stage_label(initial_stage),
        "approval_stage_key": initial_stage,
        "message": response_message,
        "item": enrich_leave_request_doc(leave_doc),
    }

def _apply_leave_start(user_context=None, question=""):
    question = _strip_voice_instruction_suffix(question)
    leave_options = get_leave_type_options(user_context)
    data = {
        "leave_options": leave_options,
    }

    detected_leave_type = _detect_leave_type_from_text(question)

    if detected_leave_type:
        selected_leave_type = _leave_option_for_type(detected_leave_type, leave_options)
        _set_leave_type_data(data, selected_leave_type, detected_leave_type)

    detected_date_text = _extract_leave_date_text_from_command(question)

    if detected_date_text:
        parsed_dates = _parse_leave_dates(detected_date_text)

        if not parsed_dates.get("invalid"):
            data["date_range_text"] = detected_date_text
        else:
            data["date_error"] = parsed_dates.get("message")

    # One-command support:
    # Example: "apply casual leave tomorrow, handover PG MIS project to Ajanur Rahman, reason personal reason"
    project_options = get_project_handover_options(user_context)
    data["project_options"] = project_options
    _apply_detected_project_and_handover(data, question, user_context=user_context)

    if not data.get("leave_type"):
        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="leave_type"
        )

        return {
            "handled": True,
            "answer": (
                "Sure, I can help you apply for leave.\n\n"
                "Please select the leave type:\n"
                f"{_format_options(leave_options)}\n\n"
                "Reply with the option number or leave type, for example: CL, EL, or Half Day."
            )
        }

    if not data.get("date_range_text"):
        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="date_range"
        )

        date_error = data.get("date_error")
        date_error_text = f"\n\n{date_error}" if date_error else ""

        return {
            "handled": True,
            "answer": (
                f"Selected leave type: {data.get('leave_type_label')}."
                f"{date_error_text}\n\n"
                "Now tell me the leave date or date range.\n"
                "Example: tomorrow, 12 June 2026, or 12-06-2026 to 13-06-2026."
            )
        }

    if data.get("handover_project_name") and not data.get("handover_to_name"):
        handover_options = data.get("handover_options") or get_handover_employee_options(
            user_context,
            limit=50,
        )
        data["handover_options"] = handover_options

        if not handover_options:
            data["handover_to_id"] = ""
            data["handover_to_name"] = "Not selected"

        elif data.get("handover_to_search_text"):
            selected = _extract_selected_option(
                data.get("handover_to_search_text"),
                handover_options,
            )

            if selected:
                data["handover_to_id"] = selected.get("id")
                data["handover_to_name"] = selected.get("name") or selected.get("label")

    if _leave_ready_for_confirmation(data):
        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="confirm"
        )

        return {
            "handled": True,
            "answer": _leave_review_text(data)
        }

    if not data.get("handover_project_name"):
        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="handover_projects"
        )

        return {
            "handled": True,
            "answer": (
                f"Selected leave type: {data.get('leave_type_label')}.\n"
                f"Leave date noted: {data.get('date_range_text')}.\n\n"
                "Which project/work do you want to hand over during your leave?\n"
                f"{_format_options(project_options)}\n\n"
                "Reply with the option number, project name, or type 'none'."
            )
        }

    if not data.get("handover_to_name"):
        handover_options = data.get("handover_options") or get_handover_employee_options(
            user_context,
            limit=50,
        )
        data["handover_options"] = handover_options

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="handover_to"
        )

        return {
            "handled": True,
            "answer": (
                f"Handover project/work selected: {data.get('handover_project_name')}.\n\n"
                "To whom do you want to hand over the task?\n"
                f"{_format_options(handover_options)}\n\n"
                "Reply with the option number or employee name."
            )
        }

    save_pending_action(
        user_context=user_context,
        action_type="apply_leave",
        data=data,
        current_step="reason"
    )

    return {
        "handled": True,
        "answer": (
            f"Task handover selected: {data.get('handover_to_name')}.\n\n"
            "Now please provide a valid reason for your leave."
        )
    }


def _apply_leave_continue(pending, question, user_context=None):
    question = _strip_voice_instruction_suffix(question)
    data = pending.get("data") or {}
    step = pending.get("current_step")

    if step == "leave_type":
        # Always refresh leave balance options from live HRMS data.
        # Do not trust old cached options stored in ai_pending_actions.
        leave_options = get_leave_type_options(user_context)
        data["leave_options"] = leave_options

        detected_leave_type = _detect_leave_type_from_text(question)
        selected = None

        if detected_leave_type:
            selected = _leave_option_for_type(detected_leave_type, leave_options)

        if not selected:
            selected = _extract_selected_option(question, leave_options)

        if not selected:
            return {
                "handled": True,
                "answer": (
                    "Please choose a valid leave type from the list:\n"
                    f"{_format_options(leave_options)}"
                )
            }

        _set_leave_type_data(data, selected, selected.get("value") or selected.get("name"))

        date_text = _extract_leave_date_text_from_command(question)

        if date_text:
            parsed_dates = _parse_leave_dates(date_text)

            if not parsed_dates.get("invalid"):
                data["date_range_text"] = date_text

        if data.get("date_range_text"):
            project_options = get_project_handover_options(user_context)
            data["project_options"] = project_options

            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="handover_projects"
            )

            return {
                "handled": True,
                "answer": (
                    f"Selected leave type: {data['leave_type_label']}.\n"
                    f"Leave date noted: {data.get('date_range_text')}.\n\n"
                    "Which project/work do you want to hand over during your leave?\n"
                    f"{_format_options(project_options)}\n\n"
                    "Reply with the option number, project name, or type 'none'."
                )
            }

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="date_range"
        )

        return {
            "handled": True,
            "answer": (
                f"Selected leave type: {data['leave_type_label']}.\n\n"
                "Now tell me the leave date or date range.\n"
                "Example: tomorrow, 12 June 2026, or 12-06-2026 to 13-06-2026."
            )
        }

    if step == "date_range":
        detected_date_text = _extract_leave_date_text_from_command(question) or _safe_str(question)
        parsed_dates = _parse_leave_dates(detected_date_text)

        if parsed_dates.get("invalid"):
            return {
                "handled": True,
                "answer": (
                    f"{parsed_dates.get('message')}\n\n"
                    "Please enter the leave date again.\n"
                    "Example: tomorrow, 12 June 2026, or 12-06-2026 to 13-06-2026."
                )
            }

        data["date_range_text"] = detected_date_text

        project_options = get_project_handover_options(user_context)
        data["project_options"] = project_options

        _apply_detected_project_and_handover(data, question, user_context=user_context)

        if _leave_ready_for_confirmation(data):
            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="confirm"
            )

            return {
                "handled": True,
                "answer": _leave_review_text(data)
            }

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="handover_projects"
        )

        return {
            "handled": True,
            "answer": (
                f"Leave date noted: {data['date_range_text']}.\n\n"
                "Which project/work do you want to hand over during your leave?\n"
                f"{_format_options(project_options)}\n\n"
                "Reply with the option number, project name, or type 'none'."
            )
        }


    if step == "handover_projects":
        _apply_detected_project_and_handover(data, question, user_context=user_context)

        if not data.get("handover_project_name"):
            if _looks_like_no_handover_project(question):
                data["handover_project_id"] = ""
                data["handover_project_name"] = "None"
            else:
                project_options = data.get("project_options") or get_project_handover_options(user_context)
                data["project_options"] = project_options
                project_selection_text = (
                    _extract_handover_command_parts(question).get("project_text")
                    or _extract_project_selection_text(question)
                    or question
                )
                selected = _extract_selected_option(project_selection_text, project_options)

                if not selected:
                    return {
                        "handled": True,
                        "answer": (
                            "Please choose a valid project/work from the list, or type 'none':\n"
                            f"{_format_options(project_options)}"
                        )
                    }

                data["handover_project_id"] = selected.get("id")
                data["handover_project_name"] = selected.get("name") or selected.get("label")

        handover_options = data.get("handover_options") or get_handover_employee_options(
            user_context,
            limit=50,
        )
        data["handover_options"] = handover_options

        if data.get("handover_to_search_text") and not data.get("handover_to_name"):
            selected_employee = _extract_selected_option(
                data.get("handover_to_search_text"),
                handover_options,
            )

            if selected_employee:
                data["handover_to_id"] = selected_employee.get("id")
                data["handover_to_name"] = selected_employee.get("name") or selected_employee.get("label")

        if not handover_options and not data.get("handover_to_name"):
            data["handover_to_id"] = ""
            data["handover_to_name"] = "Not selected"

        if _leave_ready_for_confirmation(data):
            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="confirm"
            )

            return {
                "handled": True,
                "answer": _leave_review_text(data)
            }

        if not data.get("handover_to_name"):
            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="handover_to"
            )

            return {
                "handled": True,
                "answer": (
                    f"Handover project/work selected: {data.get('handover_project_name')}.\n\n"
                    "To whom do you want to hand over the task?\n"
                    f"{_format_options(handover_options)}\n\n"
                    "Reply with the option number or employee name."
                )
            }

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="reason"
        )

        return {
            "handled": True,
            "answer": (
                f"Task handover selected: {data.get('handover_to_name')}.\n\n"
                "Now please provide a valid reason for your leave."
            )
        }


    if step == "handover_to":
        handover_options = data.get("handover_options") or get_handover_employee_options(
            user_context,
            limit=50,
        )
        data["handover_options"] = handover_options

        parts = _extract_handover_command_parts(question)
        employee_text = parts.get("employee_text") or question
        selected = _extract_selected_option(employee_text, handover_options)

        if not selected:
            return {
                "handled": True,
                "answer": (
                    "Please choose a valid handover employee from the list:\n"
                    f"{_format_options(handover_options)}"
                )
            }

        data["handover_to_id"] = selected.get("id")
        data["handover_to_name"] = selected.get("name") or selected.get("label")

        detected_reason = parts.get("reason") or _extract_leave_reason_from_command(question)

        if detected_reason and _is_valid_leave_reason(detected_reason):
            data["reason"] = detected_reason

            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="confirm"
            )

            return {
                "handled": True,
                "answer": _leave_review_text(data)
            }

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="reason"
        )

        return {
            "handled": True,
            "answer": (
                f"Task handover selected: {data['handover_to_name']}.\n\n"
                "Now please provide a valid reason for your leave."
            )
        }


    if step == "reason":
        reason = _extract_leave_reason_from_command(question) or _safe_str(question)
        reason = re.split(
            r"\b(?:please\s+)?(?:submit|confirm|apply)\b",
            reason,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip(" .,-:;")

        if not _is_valid_leave_reason(reason):
            return {
                "handled": True,
                "answer": "Please provide a valid leave reason with at least 5 characters."
            }

        data["reason"] = reason

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="confirm"
        )

        return {
            "handled": True,
            "answer": _leave_review_text(data)
        }


    if step == "confirm":
        if _looks_like_cancel_confirmation(question):
            clear_pending_action(user_context)

            return {
                "handled": True,
                "answer": "Leave request setup cancelled."
            }

        if _looks_like_leave_submit_confirmation(question):
            try:
                submission = _submit_leave_request_from_ai(
                    data,
                    user_context=user_context
                )

                return {
                    "handled": True,
                    "answer": (
                        "Your leave request has been submitted successfully.\n\n"
                        f"Leave Request ID: {submission.get('leave_request_id')}\n"
                        f"Current Status: Pending\n"
                        f"Approval Stage: {submission.get('approval_stage')}\n"
                        f"{submission.get('message')}\n\n"
                        "You can track this from the Application Status module."
                    )
                }

            except Exception as error:
                clear_pending_action(user_context)

                return {
                    "handled": True,
                    "answer": (
                        "I could not submit your leave request.\n\n"
                        f"Reason: {str(error)}\n\n"
                        "I have cleared this failed leave setup so Eve will not continue the old details.\n"
                        "Please start again by saying: Hey Eve apply casual leave for tomorrow."
                    )
                }

        return {
            "handled": True,
            "answer": _leave_review_text(data)
        }

    return {
        "handled": True,
        "answer": "I am still collecting your leave request details. Please continue with the requested information."
    }


def _get_management_group(group_id):
    db = get_db()

    oid = _as_object_id(group_id)

    if not oid:
        return None

    return db.management_groups.find_one({"_id": oid})


def _create_notifications_for_management_group(
    tenant_id=None,
    group=None,
    title="",
    message="",
):
    if not group:
        return

    members = group.get("members") or []

    for member in members:
        if not isinstance(member, dict):
            continue

        member_user_id = (
            member.get("user_id")
            or member.get("employee_user_id")
            or member.get("login_user_id")
            or member.get("employee_id")
            or member.get("_id")
            or member.get("id")
        )

        _create_notification_safe(
            tenant_id=tenant_id,
            user_id=member_user_id,
            title=title,
            message=message,
            notification_type="management_group_meeting",
        )


def _submit_management_meeting_from_ai(data, user_context=None):
    db = get_db()

    tenant_id = _tenant_id(user_context)
    user_key = _user_key(user_context)

    group_id = data.get("group_id")
    group = _get_management_group(group_id)

    if not group:
        raise RuntimeError("Selected management group was not found.")

    group_name = (
        group.get("name")
        or group.get("title")
        or group.get("group_name")
        or data.get("group_name")
        or "Management Group"
    )

    meeting_doc = {
        "tenant_id": tenant_id,
        "group_id": group_id,
        "management_group_id": group_id,
        "group_name": group_name,

        "title": data.get("agenda") or "Management Group Meeting",
        "agenda": data.get("agenda"),
        "description": data.get("agenda"),

        "meeting_date_time_text": data.get("date_time_text"),
        "date_time_text": data.get("date_time_text"),

        "minutes_writer_id": data.get("minutes_writer_id"),
        "minutes_writer_name": data.get("minutes_writer_name"),
        "assigned_minutes_writer_id": data.get("minutes_writer_id"),
        "assigned_minutes_writer_name": data.get("minutes_writer_name"),

        "status": "Scheduled",
        "meeting_status": "Scheduled",
        "source": "ai_assistant",

        "created_by": user_key,
        "created_at": _now_utc(),
        "updated_at": _now_utc(),

        "members_snapshot": group.get("members") or [],
        "minutes": "",
        "minutes_history": [],
    }

    result = db.management_group_meetings.insert_one(meeting_doc)

    _create_notifications_for_management_group(
        tenant_id=tenant_id,
        group=group,
        title="Management Group Meeting Scheduled",
        message=(
            f"A meeting has been scheduled for {group_name}. "
            f"Agenda: {data.get('agenda')}. "
            f"Date/Time: {data.get('date_time_text')}. "
            f"Minutes Writer: {data.get('minutes_writer_name')}."
        ),
    )

    if data.get("minutes_writer_id"):
        _create_notification_safe(
            tenant_id=tenant_id,
            user_id=data.get("minutes_writer_id"),
            title="You are assigned as Minutes Writer",
            message=(
                f"You have been assigned to write minutes for the meeting: "
                f"{data.get('agenda')}."
            ),
            notification_type="management_group_minutes_writer",
        )

    _create_ai_audit_log(
        user_context=user_context,
        action_type="schedule_management_meeting",
        status="success",
        message="Management group meeting scheduled through AI Assistant.",
        metadata={
            "meeting_id": str(result.inserted_id),
            "group_id": group_id,
            "group_name": group_name,
            "agenda": data.get("agenda"),
            "date_time_text": data.get("date_time_text"),
            "minutes_writer_id": data.get("minutes_writer_id"),
            "minutes_writer_name": data.get("minutes_writer_name"),
        },
    )

    clear_pending_action(user_context)

    return {
        "meeting_id": str(result.inserted_id),
        "group_name": group_name,
        "agenda": data.get("agenda"),
        "date_time": data.get("date_time_text"),
        "minutes_writer": data.get("minutes_writer_name"),
    }

def _meeting_start(user_context=None):
    if not _is_management_role(user_context):
        return {
            "handled": True,
            "answer": (
                "Meeting setup is not available for your current login role. "
                "Please contact HR/Admin if you need access."
            )
        }

    group_options = get_management_group_options(user_context)
    if not group_options:
        return {
            "handled": True,
            "answer": (
                "I could not find any management group available for your login.\n\n"
                "Please check whether you are added as a member/admin of a Management Group, "
                "or contact HR/Admin."
            )
        }
    save_pending_action(
        
        user_context=user_context,
        action_type="schedule_management_meeting",
        data={
            "group_options": group_options,
        },
        current_step="group"
    )

    return {
        "handled": True,
        "answer": (
            "Sure, I can help you schedule a management group meeting.\n\n"
            "Please select the management group:\n"
            f"{_format_options(group_options)}\n\n"
            "Reply with the option number or group name."
        )
    }


def _meeting_continue(pending, question, user_context=None):
    data = pending.get("data") or {}
    step = pending.get("current_step")

    if step == "group":
        group_options = data.get("group_options") or get_management_group_options(user_context)
        selected = _extract_selected_option(question, group_options)

        if not selected:
            return {
                "handled": True,
                "answer": (
                    "Please choose a valid management group:\n"
                    f"{_format_options(group_options)}"
                )
            }

        data["group_id"] = selected.get("id")
        data["group_name"] = selected.get("name") or selected.get("label")

        save_pending_action(
            user_context=user_context,
            action_type="schedule_management_meeting",
            data=data,
            current_step="agenda"
        )

        return {
            "handled": True,
            "answer": (
                f"Selected group: {data['group_name']}.\n\n"
                "What is the topic or agenda of the meeting?"
            )
        }

    if step == "agenda":
        data["agenda"] = _safe_str(question)

        save_pending_action(
            user_context=user_context,
            action_type="schedule_management_meeting",
            data=data,
            current_step="date_time"
        )

        return {
            "handled": True,
            "answer": (
                "Agenda noted.\n\n"
                "Now tell me the meeting date and time.\n"
                "Example: 15 June 2026 at 3:00 PM."
            )
        }

    if step == "date_time":
        data["date_time_text"] = _safe_str(question)

        member_options = get_management_group_member_options(
            data.get("group_id"),
            user_context=user_context
        )
        data["minutes_writer_options"] = member_options
        if not member_options:
            return {
                "handled": True,
                "answer": (
                    "I could not find members inside this management group for assigning a minutes writer.\n\n"
                    "Please update the Management Group members first, then try again."
                )
            }
        save_pending_action(
            user_context=user_context,
            action_type="schedule_management_meeting",
            data=data,
            current_step="minutes_writer"
        )

        return {
            "handled": True,
            "answer": (
                "Meeting date/time noted.\n\n"
                "Who will write the meeting minutes?\n"
                f"{_format_options(member_options)}\n\n"
                "Reply with option number or member name."
            )
        }

    if step == "minutes_writer":
        member_options = (
            data.get("minutes_writer_options")
            or get_management_group_member_options(
                data.get("group_id"),
                user_context=user_context
            )
        )

        selected = _extract_selected_option(question, member_options)

        if not selected:
            return {
                "handled": True,
                "answer": (
                    "Please choose a valid minutes writer:\n"
                    f"{_format_options(member_options)}"
                )
            }

        data["minutes_writer_id"] = selected.get("id")
        data["minutes_writer_name"] = selected.get("name") or selected.get("label")

        save_pending_action(
            user_context=user_context,
            action_type="schedule_management_meeting",
            data=data,
            current_step="confirm"
        )

        return {
            "handled": True,
            "answer": (
                "Please review the meeting setup:\n\n"
                f"Group: {data.get('group_name')}\n"
                f"Agenda: {data.get('agenda')}\n"
                f"Date/Time: {data.get('date_time_text')}\n"
                f"Minutes Writer: {data.get('minutes_writer_name')}\n\n"
                "Reply 'confirm' to create this meeting, or 'cancel' to stop.\n\n"
                "Note: Actual meeting creation API will be connected in the next backend file."
            )
        }

    if step == "confirm":
        if _lower(question) in ["confirm", "yes", "create", "ok", "okay"]:
            try:
                meeting = _submit_management_meeting_from_ai(
                    data,
                    user_context=user_context
                )

                return {
                    "handled": True,
                    "answer": (
                        "Management group meeting has been scheduled successfully.\n\n"
                        f"Meeting ID: {meeting.get('meeting_id')}\n"
                        f"Group: {meeting.get('group_name')}\n"
                        f"Agenda: {meeting.get('agenda')}\n"
                        f"Date/Time: {meeting.get('date_time')}\n"
                        f"Minutes Writer: {meeting.get('minutes_writer')}\n\n"
                        "The group members have been notified."
                    )
                }

            except Exception as error:
                return {
                    "handled": True,
                    "answer": (
                        "I could not create the meeting right now.\n\n"
                        f"Reason: {str(error)}\n\n"
                        "Please check the selected management group and try again."
                    )
                }

        if _lower(question) in ["cancel", "no", "stop"]:
            clear_pending_action(user_context)

            return {
                "handled": True,
                "answer": "Meeting setup cancelled."
            }

    return {
        "handled": True,
        "answer": "I am still collecting your meeting details. Please continue with the requested information."
    }

def _submit_reminder_from_ai(data, user_context=None):
    db = get_db()

    tenant_id = _tenant_id(user_context)
    user_key = _user_key(user_context)
    employee_id = _employee_id(user_context)

    reminder_text = _safe_str(data.get("reminder_text"))
    reminder_time_text = _safe_str(data.get("reminder_time_text"))

    reminder_doc = {
        "tenant_id": tenant_id,
        "user_id": user_key,
        "employee_id": employee_id,
        "title": "AI Assistant Reminder",
        "message": reminder_text,
        "reminder_text": reminder_text,
        "reminder_time_text": reminder_time_text,
        "status": "Pending",
        "source": "ai_assistant",
        "is_completed": False,
        "is_read": False,
        "read": False,
        "created_by": user_key,
        "created_at": _now_utc(),
        "updated_at": _now_utc(),
    }

    result = db.ai_reminders.insert_one(reminder_doc)

    _create_notification_safe(
        tenant_id=tenant_id,
        user_id=user_key,
        title="Reminder Created",
        message=f"Reminder created: {reminder_text}. Time: {reminder_time_text}",
        notification_type="ai_reminder",
    )

    _create_ai_audit_log(
        user_context=user_context,
        action_type="create_reminder",
        status="success",
        message="Reminder created through AI Assistant.",
        metadata={
            "reminder_id": str(result.inserted_id),
            "reminder_text": reminder_text,
            "reminder_time_text": reminder_time_text,
        },
    )

    clear_pending_action(user_context)

    return {
        "reminder_id": str(result.inserted_id),
        "reminder_text": reminder_text,
        "reminder_time_text": reminder_time_text,
    }

def _reminder_start(user_context=None):
    save_pending_action(
        user_context=user_context,
        action_type="create_reminder",
        data={},
        current_step="reminder_text"
    )

    return {
        "handled": True,
        "answer": (
            "Sure, I can help you create a reminder.\n\n"
            "What should I remind you about?"
        )
    }


def _reminder_continue(pending, question, user_context=None):
    data = pending.get("data") or {}
    step = pending.get("current_step")

    if step == "reminder_text":
        data["reminder_text"] = _safe_str(question)

        save_pending_action(
            user_context=user_context,
            action_type="create_reminder",
            data=data,
            current_step="reminder_time"
        )

        return {
            "handled": True,
            "answer": (
                "Reminder note saved.\n\n"
                "When should I remind you?\n"
                "Example: tomorrow at 10 AM, or 15 June 2026 at 4 PM."
            )
        }

    if step == "reminder_time":
        data["reminder_time_text"] = _safe_str(question)

        save_pending_action(
            user_context=user_context,
            action_type="create_reminder",
            data=data,
            current_step="confirm"
        )

        return {
            "handled": True,
            "answer": (
                "Please review your reminder:\n\n"
                f"Reminder: {data.get('reminder_text')}\n"
                f"Time: {data.get('reminder_time_text')}\n\n"
                "Reply 'confirm' to create this reminder, or 'cancel' to stop.\n\n"
                "Note: Actual reminder saving will be connected in the next backend file."
            )
        }

    if step == "confirm":
        if _lower(question) in ["confirm", "yes", "create", "ok", "okay"]:
            try:
                reminder = _submit_reminder_from_ai(
                    data,
                    user_context=user_context
                )

                return {
                    "handled": True,
                    "answer": (
                        "Your reminder has been created successfully.\n\n"
                        f"Reminder ID: {reminder.get('reminder_id')}\n"
                        f"Reminder: {reminder.get('reminder_text')}\n"
                        f"Time: {reminder.get('reminder_time_text')}\n\n"
                        "It has also been added to your notifications."
                    )
                }

            except Exception as error:
                return {
                    "handled": True,
                    "answer": (
                        "I could not create the reminder right now.\n\n"
                        f"Reason: {str(error)}\n\n"
                        "Please try again."
                    )
                }

        if _lower(question) in ["cancel", "no", "stop"]:
            clear_pending_action(user_context)

            return {
                "handled": True,
                "answer": "Reminder setup cancelled."
            }

    return {
        "handled": True,
        "answer": "I am still collecting your reminder details. Please continue with the requested information."
    }



# ---------------------------------------------------------------------------
# AI Attendance Actions: Check-in / Check-out
# ---------------------------------------------------------------------------

def _detect_attendance_action_intent(question):
    """
    Detects Eve attendance commands before the normal AI knowledge fallback.

    Supported examples:
    - Hey Eve check in
    - Please punch in
    - Mark my attendance
    - Check out
    - Punch out
    """

    clean = _normalize_option_text(_strip_voice_instruction_suffix(question))

    if not clean:
        return ""

    check_out_phrases = {
        "check out",
        "checkout",
        "punch out",
        "clock out",
        "mark checkout",
        "mark check out",
        "end attendance",
        "close attendance",
        "office out",
        "i want to check out",
        "please check out",
        "please checkout",
        "please punch out",
    }

    check_in_phrases = {
        "check in",
        "checkin",
        "punch in",
        "clock in",
        "mark attendance",
        "mark my attendance",
        "start attendance",
        "office in",
        "i want to check in",
        "please check in",
        "please checkin",
        "please punch in",
    }

    if any(phrase in clean for phrase in check_out_phrases):
        return "attendance_check_out"

    if any(phrase in clean for phrase in check_in_phrases):
        return "attendance_check_in"

    # Voice STT may hear "checking" / "checkout" differently.
    if "attendance" in clean and any(word in clean for word in ["mark", "start", "begin"]):
        return "attendance_check_in"

    if "attendance" in clean and any(word in clean for word in ["end", "close", "finish"]):
        return "attendance_check_out"

    return ""


def _request_json_payload_safe():
    try:
        from flask import request

        return request.get_json(silent=True) or {}
    except Exception:
        return {}


def _request_current_user_safe():
    try:
        from flask import g

        return getattr(g, "current_user", {}) or {}
    except Exception:
        return {}


def _float_or_none(value):
    if value in [None, ""]:
        return None

    try:
        return float(value)
    except Exception:
        return None


def _attendance_location_from_payload(payload=None, fallback_data=None):
    payload = payload or _request_json_payload_safe()
    fallback_data = fallback_data or {}

    client_context = payload.get("client_context") if isinstance(payload.get("client_context"), dict) else {}

    source = (
        fallback_data.get("location")
        or fallback_data.get("attendance_location")
        or payload.get("attendance_location")
        or client_context.get("attendance_location")
        or payload.get("location")
        or client_context.get("location")
        or {}
    )

    if not isinstance(source, dict):
        source = {}

    latitude = _float_or_none(
        source.get("latitude")
        or source.get("lat")
        or fallback_data.get("latitude")
        or payload.get("latitude")
        or client_context.get("latitude")
    )
    longitude = _float_or_none(
        source.get("longitude")
        or source.get("lng")
        or source.get("lon")
        or fallback_data.get("longitude")
        or payload.get("longitude")
        or client_context.get("longitude")
    )
    accuracy = _float_or_none(
        source.get("accuracy")
        or fallback_data.get("accuracy")
        or payload.get("accuracy")
        or client_context.get("accuracy")
    )

    address = _safe_str(
        source.get("address")
        or source.get("location_address")
        or fallback_data.get("address")
        or payload.get("address")
        or client_context.get("address")
    )

    return {
        "latitude": latitude,
        "longitude": longitude,
        "accuracy": accuracy,
        "address": address,
        "source": source.get("source") or "ai_assistant",
    }


def _attendance_location_available(location):
    return bool(
        isinstance(location, dict)
        and location.get("latitude") is not None
        and location.get("longitude") is not None
    )


def _attendance_mode_from_text(question):
    clean = _normalize_option_text(question)

    if any(phrase in clean for phrase in ["work from home", "wfh", "home attendance"]):
        return "wfh"

    # Field attendance needs field place and photo in the native route.
    # Eve uses office mode by default to avoid bypassing those proofs.
    return "office"


def _attendance_employee(user_context=None):
    employee = _current_employee_for_ai_action(user_context)

    if not employee:
        raise RuntimeError("Employee profile was not found for this login.")

    return employee


def _attendance_tenant_id(employee=None, user_context=None):
    employee = employee or {}

    return (
        employee.get("tenant_id")
        or _tenant_id(user_context)
        or "sds"
    )


def _attendance_employee_org_name(employee):
    employee = employee or {}

    return _safe_str(
        employee.get("organisation")
        or employee.get("organization")
        or employee.get("organisation_name")
        or employee.get("organization_name")
    )


def _attendance_employee_org_code(employee):
    employee = employee or {}

    return _safe_str(
        employee.get("organisation_code")
        or employee.get("organization_code")
    ).upper()


def _attendance_employee_state(employee):
    employee = employee or {}

    state = _safe_str(
        employee.get("state")
        or employee.get("branch")
        or employee.get("work_state")
        or "Assam(HO)"
    )

    lowered = state.lower()

    if lowered in ["assam", "assam ho", "assam(ho)", "ho", "assam/guwahati (ho)"]:
        return "Assam(HO)"

    return state or "Assam(HO)"


def _attendance_employee_name(employee):
    employee = employee or {}

    return (
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or employee.get("email")
        or "Employee"
    )


def _attendance_employee_code(employee):
    employee = employee or {}

    return (
        employee.get("employee_id")
        or employee.get("emp_code")
        or employee.get("code")
        or ""
    )


def _attendance_now_local():
    try:
        from app.routes.attendance import now_local

        return now_local()
    except Exception:
        return datetime.utcnow() + timedelta(minutes=330)


def _attendance_holiday_info(db, employee, attendance_date):
    try:
        from app.routes.attendance import holiday_info_for_employee

        return holiday_info_for_employee(db, employee, attendance_date)
    except Exception:
        return {
            "is_holiday": False,
            "holiday_type": "",
            "state": _attendance_employee_state(employee),
            "title": "",
            "message": "",
        }


def _attendance_approved_holiday_work(db, employee, attendance_date):
    try:
        from app.routes.attendance import approved_holiday_work_request

        return approved_holiday_work_request(db, employee, attendance_date)
    except Exception:
        return None


def _attendance_pending_holiday_work(db, employee, attendance_date):
    try:
        from app.routes.attendance import pending_holiday_work_request

        return pending_holiday_work_request(db, employee, attendance_date)
    except Exception:
        return None


def _attendance_create_compoff_if_needed(db, employee, attendance_doc, holiday_info):
    try:
        from app.routes.attendance import create_compoff_if_needed

        return create_compoff_if_needed(db, employee, attendance_doc, holiday_info)
    except Exception:
        return None


def _attendance_greeting(action_type, employee_name="", is_late=False, is_early=False):
    now = _attendance_now_local()
    hour = now.hour

    if hour < 12:
        greeting = "Good morning"
    elif hour < 17:
        greeting = "Good afternoon"
    else:
        greeting = "Good evening"

    first_name = _safe_str(employee_name).split(" ")[0] if _safe_str(employee_name) else ""

    if action_type == "attendance_check_in":
        if is_late:
            return f"{greeting}{f' {first_name}' if first_name else ''}. Your late check-in is completed."
        return f"{greeting}{f' {first_name}' if first_name else ''}. Your check-in is completed."

    if is_early:
        return f"{greeting}{f' {first_name}' if first_name else ''}. Your early check-out is completed."

    return f"{greeting}{f' {first_name}' if first_name else ''}. Your check-out is completed."


def _attendance_reason_from_text(question):
    clean = _strip_voice_instruction_suffix(question)

    patterns = [
        r"\b(?:reason|because|due\s+to|as)\s+(?:is|was|:)?\s*(.+)$",
    ]

    for pattern in patterns:
        match = re.search(pattern, clean, flags=re.IGNORECASE)

        if match:
            return " ".join(_safe_str(match.group(1)).strip(" .,-:;").split())

    return _safe_str(clean)


def _attendance_late_reason_required(now, holiday_info):
    try:
        from app.routes.attendance import LATE_CUTOFF

        return now.time() >= LATE_CUTOFF and not holiday_info.get("is_holiday")
    except Exception:
        return now.time() >= datetime.strptime("09:50", "%H:%M").time() and not holiday_info.get("is_holiday")


def _attendance_early_checkout_required(now, holiday_info):
    try:
        from app.routes.attendance import OFFICE_END_TIME

        return now.time() < OFFICE_END_TIME and not holiday_info.get("is_holiday")
    except Exception:
        return now.time() < datetime.strptime("18:00", "%H:%M").time() and not holiday_info.get("is_holiday")


def _attendance_location_error_message(location):
    if not _attendance_location_available(location):
        return (
            "GPS location is required for attendance. "
            "Please allow location permission in the browser and try again."
        )

    return ""


def _submit_ai_check_in(data=None, user_context=None):
    data = data or {}
    db = get_db()

    employee = _attendance_employee(user_context)
    tenant_id = _attendance_tenant_id(employee, user_context)

    now = _attendance_now_local()
    today_date = now.date()
    today = today_date.isoformat()

    mode = data.get("mode") or "office"
    mode = _safe_str(mode).lower() or "office"

    if mode not in ["office", "wfh", "field"]:
        mode = "office"

    if mode == "field":
        raise RuntimeError(
            "Field attendance needs visit place and photo proof. Please use the Attendance page for field attendance."
        )

    location = _attendance_location_from_payload(fallback_data=data)
    location_error = _attendance_location_error_message(location)

    if location_error:
        raise RuntimeError(location_error)

    holiday_info = _attendance_holiday_info(db, employee, today_date)
    holiday_work_request = None

    if holiday_info.get("is_holiday"):
        holiday_work_request = _attendance_approved_holiday_work(db, employee, today_date)

        if not holiday_work_request:
            pending_request = _attendance_pending_holiday_work(db, employee, today_date)
            if pending_request:
                raise RuntimeError("Holiday attendance requires approved holiday work request. Your request is still pending.")
            raise RuntimeError("Holiday attendance requires approved holiday work request.")

    is_late = _attendance_late_reason_required(now, holiday_info)
    late_reason = _safe_str(data.get("late_reason") or data.get("reason"))

    if is_late and not late_reason:
        raise RuntimeError("Late reason is required from 09:50 AM onwards.")

    old = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "date": today,
        "is_deleted": {"$ne": True},
    })

    if old and old.get("check_in"):
        return {
            "already_done": True,
            "message": "You are already checked in today.",
            "attendance": old,
            "is_late": bool(old.get("is_late")),
        }

    status = "present"

    if holiday_info.get("is_holiday"):
        status = "holiday_work"
    elif is_late:
        status = "late"

    doc = {
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "employee_code": _attendance_employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "employee_name": _attendance_employee_name(employee),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "organisation": _attendance_employee_org_name(employee),
        "organization": _attendance_employee_org_name(employee),
        "organisation_name": _attendance_employee_org_name(employee),
        "organization_name": _attendance_employee_org_name(employee),
        "organisation_code": _attendance_employee_org_code(employee),
        "organization_code": _attendance_employee_org_code(employee),
        "state": _attendance_employee_state(employee),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),

        "date": today,
        "check_in": now,
        "check_out": None,

        "office_start": "09:30",
        "late_cutoff": "09:50",
        "office_end": "18:00",

        "mode": mode,
        "field_location": "",
        "field_photo": "",
        "field_photo_url": "",
        "late_reason": late_reason,
        "early_checkout_reason": "",

        "check_in_location": location,
        "check_out_location": None,
        "location_accuracy_warning": bool(
            location.get("accuracy")
            and float(location.get("accuracy")) > 60
        ),

        "is_late": is_late,
        "is_early_checkout": False,
        "is_holiday_work": bool(holiday_info.get("is_holiday")),
        "holiday_title": holiday_info.get("title", ""),
        "holiday_type": holiday_info.get("holiday_type", ""),
        "holiday_message": holiday_info.get("message", ""),
        "holiday_work_request_id": str(holiday_work_request.get("_id")) if holiday_work_request else "",
        "status": status,
        "verified_by_ro": False,

        "created_offline": False,
        "check_in_created_offline": False,
        "offline_marked_at": None,
        "check_in_offline_marked_at": None,
        "client_attendance_id": "",
        "client_check_in_id": "",
        "client_attendance_ids": [],
        "synced_at": None,
        "sync_source": "ai_assistant",

        "timeline": [
            {
                "type": "check_in",
                "time": now,
                "note": f"{mode.upper()} check-in through AI Assistant",
                "location": location,
                "field_location": "",
                "created_offline": False,
                "offline_marked_at": None,
                "synced_at": None,
                "client_attendance_id": "",
            }
        ],

        "created_at": now,
        "updated_at": now,
    }

    result = db.attendance_logs.insert_one(doc)
    doc["_id"] = result.inserted_id

    _create_ai_audit_log(
        user_context=user_context,
        action_type="attendance_check_in",
        status="success",
        message="Attendance check-in completed through AI Assistant.",
        metadata={
            "attendance_id": str(result.inserted_id),
            "date": today,
            "is_late": is_late,
            "mode": mode,
        },
    )

    clear_pending_action(user_context)

    return {
        "already_done": False,
        "attendance": doc,
        "is_late": is_late,
        "message": _attendance_greeting(
            "attendance_check_in",
            _attendance_employee_name(employee),
            is_late=is_late,
        ),
    }


def _submit_ai_check_out(data=None, user_context=None):
    data = data or {}
    db = get_db()

    employee = _attendance_employee(user_context)
    tenant_id = _attendance_tenant_id(employee, user_context)

    now = _attendance_now_local()
    today_date = now.date()
    today = today_date.isoformat()

    location = _attendance_location_from_payload(fallback_data=data)
    location_error = _attendance_location_error_message(location)

    if location_error:
        raise RuntimeError(location_error)

    rec = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "date": today,
        "is_deleted": {"$ne": True},
    })

    if not rec:
        raise RuntimeError("Please check in first.")

    if rec.get("check_out"):
        return {
            "already_done": True,
            "message": "You are already checked out today.",
            "attendance": rec,
            "is_early_checkout": bool(rec.get("is_early_checkout")),
        }

    holiday_info = _attendance_holiday_info(db, employee, today_date)
    is_early_checkout = _attendance_early_checkout_required(now, holiday_info)

    early_checkout_reason = _safe_str(
        data.get("early_checkout_reason")
        or data.get("reason")
    )

    if is_early_checkout and not early_checkout_reason:
        raise RuntimeError("Early checkout reason is required before 06:00 PM.")

    update_data = {
        "check_out": now,
        "check_out_location": location,
        "checkout_location_accuracy_warning": bool(
            location.get("accuracy")
            and float(location.get("accuracy")) > 60
        ),
        "is_early_checkout": is_early_checkout,
        "early_checkout_reason": early_checkout_reason,
        "updated_at": now,

        "check_out_created_offline": False,
        "check_out_offline_marked_at": None,
        "client_check_out_id": "",
        "synced_at": rec.get("synced_at"),
        "sync_source": rec.get("sync_source", "ai_assistant"),
    }

    if rec.get("status") == "present" and is_early_checkout:
        update_data["status"] = "early_checkout"

    db.attendance_logs.update_one(
        {"_id": rec["_id"]},
        {
            "$set": update_data,
            "$push": {
                "timeline": {
                    "type": "check_out",
                    "time": now,
                    "note": "Day closed through AI Assistant",
                    "location": location,
                    "created_offline": False,
                    "offline_marked_at": None,
                    "synced_at": None,
                    "client_attendance_id": "",
                }
            },
        },
    )

    updated = db.attendance_logs.find_one({"_id": rec["_id"]})

    if updated and updated.get("is_holiday_work"):
        _attendance_create_compoff_if_needed(db, employee, updated, holiday_info)

    _create_ai_audit_log(
        user_context=user_context,
        action_type="attendance_check_out",
        status="success",
        message="Attendance check-out completed through AI Assistant.",
        metadata={
            "attendance_id": str(rec["_id"]),
            "date": today,
            "is_early_checkout": is_early_checkout,
        },
    )

    clear_pending_action(user_context)

    return {
        "already_done": False,
        "attendance": updated,
        "is_early_checkout": is_early_checkout,
        "message": _attendance_greeting(
            "attendance_check_out",
            _attendance_employee_name(employee),
            is_early=is_early_checkout,
        ),
    }


def _attendance_start(action_type, question="", user_context=None):
    clean_question = _strip_voice_instruction_suffix(question)
    now = _attendance_now_local()
    db = get_db()
    employee = _attendance_employee(user_context)
    holiday_info = _attendance_holiday_info(db, employee, now.date())
    location = _attendance_location_from_payload()

    data = {
        "mode": _attendance_mode_from_text(clean_question),
        "location": location,
        "attendance_location": location,
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "accuracy": location.get("accuracy"),
    }

    reason = _attendance_reason_from_text(clean_question)

    # Avoid treating the command itself as a reason.
    command_like_reasons = {
        "check in",
        "please check in",
        "check out",
        "please check out",
        "punch in",
        "punch out",
        "mark attendance",
        "mark my attendance",
    }

    if _normalize_option_text(reason) in command_like_reasons:
        reason = ""

    if action_type == "attendance_check_in":
        if _attendance_late_reason_required(now, holiday_info) and not reason:
            save_pending_action(
                user_context=user_context,
                action_type="attendance_check_in",
                data=data,
                current_step="late_reason",
            )

            return {
                "handled": True,
                "answer": "You are late today. Please tell me the late check-in reason."
            }

        if reason:
            data["late_reason"] = reason
            data["reason"] = reason

        try:
            result = _submit_ai_check_in(data, user_context=user_context)

            return {
                "handled": True,
                "answer": result.get("message") or "Your check-in is completed."
            }
        except Exception as error:
            return {
                "handled": True,
                "answer": str(error)
            }

    if action_type == "attendance_check_out":
        # The existing attendance route requires check-in first. If check-in is missing,
        # submit function will return that exact error.
        if _attendance_early_checkout_required(now, holiday_info) and not reason:
            save_pending_action(
                user_context=user_context,
                action_type="attendance_check_out",
                data=data,
                current_step="early_checkout_reason",
            )

            return {
                "handled": True,
                "answer": "You are checking out early. Please tell me the early check-out reason."
            }

        if reason:
            data["early_checkout_reason"] = reason
            data["reason"] = reason

        try:
            result = _submit_ai_check_out(data, user_context=user_context)

            return {
                "handled": True,
                "answer": result.get("message") or "Your check-out is completed."
            }
        except Exception as error:
            return {
                "handled": True,
                "answer": str(error)
            }

    return {
        "handled": False,
        "answer": "",
    }


def _attendance_continue(pending, question, user_context=None):
    data = pending.get("data") or {}
    step = pending.get("current_step")
    action_type = pending.get("action_type")

    reason = _attendance_reason_from_text(question)

    if not reason or len(reason) < 3:
        if step == "late_reason":
            return {
                "handled": True,
                "answer": "Please tell me a valid late check-in reason."
            }

        return {
            "handled": True,
            "answer": "Please tell me a valid early check-out reason."
        }

    if action_type == "attendance_check_in":
        data["late_reason"] = reason
        data["reason"] = reason

        try:
            result = _submit_ai_check_in(data, user_context=user_context)

            return {
                "handled": True,
                "answer": result.get("message") or "Your check-in is completed."
            }
        except Exception as error:
            clear_pending_action(user_context)

            return {
                "handled": True,
                "answer": str(error)
            }

    if action_type == "attendance_check_out":
        data["early_checkout_reason"] = reason
        data["reason"] = reason

        try:
            result = _submit_ai_check_out(data, user_context=user_context)

            return {
                "handled": True,
                "answer": result.get("message") or "Your check-out is completed."
            }
        except Exception as error:
            clear_pending_action(user_context)

            return {
                "handled": True,
                "answer": str(error)
            }

    clear_pending_action(user_context)

    return {
        "handled": True,
        "answer": "I cleared the incomplete attendance action. Please try again."
    }


def _looks_like_new_normal_question(question):
    """
    If a guided action is pending, but the user asks a normal HRMS question,
    we should not force that question into the old pending flow.
    """

    text = _lower(question)

    normal_question_keywords = [
        "how to",
        "what is",
        "what are",
        "show",
        "list",
        "any notification",
        "notifications",
        "how many",
        "cl left",
        "el left",
        "leave balance",
        "assets",
        "asset",
        "attendance",
        "performance",
        "project",
        "projects",
        "weather",
        "company",
        "tenant",
        "policy",
        "policies",
        "status",
        "approved",
        "where is",
    ]

    is_question_like = (
        "?" in text
        or text.startswith((
            "how ",
            "what ",
            "when ",
            "where ",
            "why ",
            "show ",
            "list ",
            "tell me ",
        ))
    )

    return is_question_like and any(keyword in text for keyword in normal_question_keywords)


def handle_guided_action(question, user_context=None):
    """
    Handles multi-turn guided actions.
    This function must not trap every normal chatbot question inside an old action.
    It also restarts the guided flow if the user clearly starts the same action again.
    """

    clean_question = _strip_voice_instruction_suffix(question)

    if not clean_question:
        return {
            "handled": False,
            "answer": "",
        }

    intent = detect_action_intent(clean_question)
    pending = get_pending_action(user_context)

    if intent == "cancel":
        clear_pending_action(user_context)

        return {
            "handled": True,
            "answer": "Okay, I have cancelled the current assistant action setup."
        }

    # NEW FIX:
    # If a guided action is already pending and user again says
    # "I want to apply leave" / "schedule meeting" / "remind me",
    # restart that flow from the beginning instead of showing:
    # "I am still collecting your details."
    if pending and intent:
        pending_action_type = pending.get("action_type")
        pending_step = pending.get("current_step")

        # At final leave confirmation, phrases such as
        # "apply leave", "please submit", and "submit it" must submit the
        # prepared request, not restart the leave form.
        if (
            pending_action_type == "apply_leave"
            and pending_step == "confirm"
            and (
                _looks_like_leave_submit_confirmation(clean_question)
                or _looks_like_cancel_confirmation(clean_question)
            )
        ):
            return _apply_leave_continue(pending, clean_question, user_context=user_context)

        clear_pending_action(user_context)

        if intent == "apply_leave":
            return _apply_leave_start(user_context=user_context, question=clean_question)

        if intent == "schedule_management_meeting":
            return _meeting_start(user_context=user_context)

        if intent == "create_reminder":
            return _reminder_start(user_context=user_context)

        if intent in ["attendance_check_in", "attendance_check_out"]:
            return _attendance_start(intent, question=clean_question, user_context=user_context)

    # If a pending guided action exists but the user asks a normal unrelated question,
    # cancel the stale flow and let the normal AI/capability system answer.
    if pending and not intent and _looks_like_new_normal_question(clean_question):
        clear_pending_action(user_context)

        return {
            "handled": False,
            "answer": "",
        }

    if pending:
        action_type = pending.get("action_type")

        if action_type == "apply_leave":
            return _apply_leave_continue(pending, clean_question, user_context=user_context)

        if action_type == "schedule_management_meeting":
            return _meeting_continue(pending, clean_question, user_context=user_context)

        if action_type == "create_reminder":
            return _reminder_continue(pending, clean_question, user_context=user_context)

        if action_type in ["attendance_check_in", "attendance_check_out"]:
            return _attendance_continue(pending, clean_question, user_context=user_context)

        # Safety fallback for corrupted/unknown pending actions.
        clear_pending_action(user_context)

        return {
            "handled": True,
            "answer": (
                "I found an incomplete assistant action and cleared it safely.\n\n"
                "Please start again. For example, say: I want to apply leave."
            )
        }

    if intent == "apply_leave":
            return _apply_leave_start(user_context=user_context, question=clean_question)

    if intent == "schedule_management_meeting":
        return _meeting_start(user_context=user_context)

    if intent == "create_reminder":
        return _reminder_start(user_context=user_context)

    if intent in ["attendance_check_in", "attendance_check_out"]:
        return _attendance_start(intent, question=clean_question, user_context=user_context)

    return {
        "handled": False,
        "answer": "",
    }