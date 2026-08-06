from __future__ import annotations

import copy
import re
import unittest
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Any, Iterable

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING

from app.services.recruitment_service import (
    APPLICATIONS,
    BACKGROUND_CHECKS,
    CANDIDATES,
    DOCUMENTS,
    HIRING_REQUESTS,
    INTERVIEWS,
    JOB_OPENINGS,
    OFFERS,
    ONBOARDING_TASKS,
    SETTINGS,
    RecruitmentService,
    RecruitmentServiceError,
)


# ---------------------------------------------------------------------------
# Small in-memory MongoDB substitute
# ---------------------------------------------------------------------------
# The workflow tests intentionally avoid requiring a running MongoDB server or
# an additional test-only package. Only the MongoDB operations used by the
# recruitment service are implemented here.


def _get_path(document: dict[str, Any], path: str) -> Any:
    value: Any = document
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def _set_path(document: dict[str, Any], path: str, value: Any) -> None:
    target = document
    parts = path.split(".")
    for part in parts[:-1]:
        current = target.get(part)
        if not isinstance(current, dict):
            current = {}
            target[part] = current
        target = current
    target[parts[-1]] = copy.deepcopy(value)


def _value_equals(actual: Any, expected: Any) -> bool:
    if isinstance(actual, list) and not isinstance(expected, list):
        return expected in actual
    return actual == expected


def _matches_condition(actual: Any, condition: Any) -> bool:
    if not isinstance(condition, dict) or not any(str(key).startswith("$") for key in condition):
        return _value_equals(actual, condition)

    for operator, expected in condition.items():
        if operator == "$ne":
            if _value_equals(actual, expected):
                return False
        elif operator == "$in":
            candidates = list(expected or [])
            if isinstance(actual, list):
                if not any(item in candidates for item in actual):
                    return False
            elif actual not in candidates:
                return False
        elif operator == "$gte":
            if actual is None or actual < expected:
                return False
        elif operator == "$lt":
            if actual is None or actual >= expected:
                return False
        elif operator == "$regex":
            flags = re.IGNORECASE if "i" in str(condition.get("$options", "")) else 0
            pattern = re.compile(str(expected), flags)
            if isinstance(actual, list):
                if not any(pattern.search(str(item or "")) for item in actual):
                    return False
            elif not pattern.search(str(actual or "")):
                return False
        elif operator == "$options":
            continue
        else:
            raise AssertionError(f"Unsupported in-memory query operator: {operator}")
    return True


def _matches(document: dict[str, Any], query: dict[str, Any] | None) -> bool:
    query = query or {}
    for key, condition in query.items():
        if key == "$or":
            if not any(_matches(document, item) for item in condition):
                return False
            continue
        if key == "$and":
            if not all(_matches(document, item) for item in condition):
                return False
            continue
        if not _matches_condition(_get_path(document, key), condition):
            return False
    return True


def _project(document: dict[str, Any], projection: dict[str, int] | None) -> dict[str, Any]:
    if not projection:
        return copy.deepcopy(document)
    included = {key for key, enabled in projection.items() if enabled}
    if not included:
        return copy.deepcopy(document)
    output: dict[str, Any] = {}
    if "_id" in document and projection.get("_id", 1):
        output["_id"] = document["_id"]
    for path in included:
        if path == "_id":
            continue
        value = _get_path(document, path)
        if value is not None:
            _set_path(output, path, value)
    return output


class MemoryCursor:
    def __init__(self, items: Iterable[dict[str, Any]]):
        self._items = [copy.deepcopy(item) for item in items]

    def sort(self, key_or_list, direction=None):
        if isinstance(key_or_list, list):
            fields = key_or_list
        else:
            fields = [(key_or_list, ASCENDING if direction is None else direction)]

        for field, sort_direction in reversed(fields):
            reverse = sort_direction == DESCENDING

            def sort_key(item):
                value = _get_path(item, field)
                return (value is None, value)

            self._items.sort(key=sort_key, reverse=reverse)
        return self

    def skip(self, count: int):
        self._items = self._items[max(0, int(count or 0)) :]
        return self

    def limit(self, count: int):
        count = int(count or 0)
        if count > 0:
            self._items = self._items[:count]
        return self

    def __iter__(self):
        return iter(self._items)


class MemoryCollection:
    def __init__(self):
        self.documents: list[dict[str, Any]] = []

    def create_index(self, *_args, **_kwargs):
        return "memory_index"

    def insert_one(self, document: dict[str, Any]):
        stored = copy.deepcopy(document)
        stored.setdefault("_id", ObjectId())
        self.documents.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])

    def insert_many(self, documents: Iterable[dict[str, Any]]):
        ids = [self.insert_one(document).inserted_id for document in documents]
        return SimpleNamespace(inserted_ids=ids)

    def find_one(self, query=None, projection=None):
        for document in self.documents:
            if _matches(document, query):
                return _project(document, projection)
        return None

    def find(self, query=None, projection=None):
        return MemoryCursor(
            _project(document, projection)
            for document in self.documents
            if _matches(document, query)
        )

    def count_documents(self, query=None):
        return sum(1 for document in self.documents if _matches(document, query))

    def _apply_update(self, document: dict[str, Any], update: dict[str, Any], *, inserted: bool):
        if inserted:
            for path, value in (update.get("$setOnInsert") or {}).items():
                _set_path(document, path, value)
        for path, value in (update.get("$set") or {}).items():
            _set_path(document, path, value)
        for path, value in (update.get("$inc") or {}).items():
            current = _get_path(document, path) or 0
            _set_path(document, path, current + value)
        for path, value in (update.get("$push") or {}).items():
            current = _get_path(document, path)
            if not isinstance(current, list):
                current = []
                _set_path(document, path, current)
            current.append(copy.deepcopy(value))

    @staticmethod
    def _upsert_seed(query: dict[str, Any]) -> dict[str, Any]:
        seed: dict[str, Any] = {}
        for key, value in (query or {}).items():
            if key.startswith("$"):
                continue
            if isinstance(value, dict) and any(str(item).startswith("$") for item in value):
                continue
            _set_path(seed, key, value)
        return seed

    def update_one(self, query, update, upsert=False):
        for document in self.documents:
            if _matches(document, query):
                self._apply_update(document, update, inserted=False)
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        document = self._upsert_seed(query)
        document.setdefault("_id", ObjectId())
        self._apply_update(document, update, inserted=True)
        self.documents.append(document)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=document["_id"])

    def find_one_and_update(self, query, update, upsert=False, return_document=None):
        before = self.find_one(query)
        if before is None:
            if not upsert:
                return None
            result = self.update_one(query, update, upsert=True)
            return self.find_one({"_id": result.upserted_id})
        self.update_one(query, update, upsert=False)
        if return_document is not None:
            return self.find_one({"_id": before["_id"]})
        return before

    def aggregate(self, _pipeline):
        raise AssertionError("Aggregate is not required by these workflow tests.")


class MemoryDatabase:
    def __init__(self):
        self._collections: dict[str, MemoryCollection] = {}

    def __getitem__(self, name: str) -> MemoryCollection:
        return self._collections.setdefault(name, MemoryCollection())

    def __getattr__(self, name: str) -> MemoryCollection:
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]


class RecruitmentWorkflowTests(unittest.TestCase):
    TENANT_A = "tenant-a"
    TENANT_B = "tenant-b"

    def setUp(self):
        self.db = MemoryDatabase()

        self.hr_id = self._seed_user(self.TENANT_A, "HR Manager", "hr@example.com", ["hr_manager"])
        self.manager_id = self._seed_user(self.TENANT_A, "Department Manager", "manager@example.com", ["manager"])
        self.finance_id = self._seed_user(self.TENANT_A, "Finance Approver", "finance@example.com", ["finance"])
        self.interviewer_id = self._seed_user(self.TENANT_A, "Interviewer", "interviewer@example.com", ["manager"])
        self.employee_id = self._seed_user(self.TENANT_A, "Normal Employee", "employee@example.com", ["employee"])
        self.other_hr_id = self._seed_user(self.TENANT_B, "Other HR", "other.hr@example.com", ["hr_manager"])

        self.db.tenants.insert_one({
            "tenant_id": self.TENANT_A,
            "company_name": "Sayanant Development Services",
            "tenant_code": "SDS",
            "recruitment_email": "careers@example.com",
        })
        self.db.tenants.insert_one({
            "tenant_id": self.TENANT_B,
            "company_name": "Other Company",
            "recruitment_email": "careers@other.example.com",
        })

        self.hr = self._service(self.TENANT_A, self.hr_id)
        self.manager = self._service(self.TENANT_A, self.manager_id)
        self.finance = self._service(self.TENANT_A, self.finance_id)
        self.interviewer = self._service(self.TENANT_A, self.interviewer_id)
        self.employee = self._service(self.TENANT_A, self.employee_id)
        self.other_hr = self._service(self.TENANT_B, self.other_hr_id)
        self.public = self._service(self.TENANT_A, None, public=True)

    def _seed_user(self, tenant_id: str, name: str, email: str, roles: list[str]) -> ObjectId:
        result = self.db.users.insert_one({
            "tenant_id": tenant_id,
            "name": name,
            "full_name": name,
            "email": email,
            "role": roles[0],
            "roles": roles,
            "is_active": True,
            "is_deleted": False,
        })
        return result.inserted_id

    def _service(self, tenant_id: str, user_id: ObjectId | None, *, public=False):
        actor = {}
        if user_id is not None:
            actor = self.db.users.find_one({"_id": user_id}) or {}
        service = RecruitmentService(
            self.db,
            tenant_id=tenant_id,
            actor=actor,
            config={"FRONTEND_URL": "https://hrms.example.com"},
            allow_public_actions=public,
        )
        service._email = lambda *_args, **_kwargs: {"ok": True, "skipped": "unit_test"}
        return service

    def _create_approved_job(self, *, open_job=False):
        request = self.hr.create_hiring_request({
            "job_title": "Accounts Manager",
            "department": "Finance",
            "business_reason": "Approved team expansion",
            "vacancies": 1,
            "salary_min": 500000,
            "salary_max": 700000,
            "approver_user_ids": [str(self.manager_id)],
            "hiring_manager_user_id": str(self.manager_id),
            "hiring_manager_name": "Department Manager",
        })
        self.hr.submit_hiring_request(request["_id"])
        approved = self.manager.decide_hiring_request(request["_id"], "approved")
        self.assertEqual(approved["status"], "approved")

        job = self.hr.create_job_opening({
            "hiring_request_id": str(request["_id"]),
            "description": "Manage accounting, GST, payroll and financial reporting.",
            "required_skills": ["Accounting", "GST", "Excel"],
            "recruiter_user_id": str(self.hr_id),
            "hiring_manager_user_id": str(self.manager_id),
            "panel_user_ids": [str(self.interviewer_id)],
            "closing_date": (date.today() + timedelta(days=30)).isoformat(),
        })
        if open_job:
            job = self.hr.change_job_status(job["_id"], "open", channels=["career_page"])
        return request, job

    def _create_candidate_application(self, job_id: ObjectId):
        candidate = self.hr.create_candidate({
            "full_name": "Ananya Das",
            "email": "ananya.das@example.com",
            "phone": "+91 9876543210",
            "location": "Guwahati, Assam",
            "skills": ["Accounting", "GST", "Excel"],
            "source": "career_page",
        })
        application = self.hr.create_application({
            "candidate_id": str(candidate["_id"]),
            "job_opening_id": str(job_id),
            "source": "career_page",
        })
        return candidate, application

    def _create_selected_application(self):
        _request, job = self._create_approved_job(open_job=True)
        candidate, application = self._create_candidate_application(job["_id"])
        application = self.hr.change_application_status(application["_id"], "shortlisted")
        application = self.hr.change_application_status(application["_id"], "selected")
        return candidate, job, application

    def _create_accepted_offer(self):
        candidate, job, application = self._create_selected_application()
        response_deadline = date.today() + timedelta(days=7)
        joining_date = date.today() + timedelta(days=21)
        offer = self.hr.create_offer(application["_id"], {
            "designation": "Accounts Manager",
            "department": "Finance",
            "joining_date": joining_date.isoformat(),
            "response_deadline": response_deadline.isoformat(),
            "salary": {
                "annual_ctc": 650000,
                "monthly_gross": 54167,
                "currency": "INR",
            },
            "salary_summary": "Annual CTC INR 6,50,000",
            "employment_type": "permanent",
            "work_location": "Guwahati",
            "reporting_manager_user_id": str(self.manager_id),
            "reporting_manager_name": "Department Manager",
        })
        offer = self.hr.submit_offer_for_approval(offer["_id"], [str(self.finance_id)])
        self.assertEqual(offer["status"], "approval_pending")
        offer = self.finance.decide_offer(offer["_id"], "approved")
        self.assertEqual(offer["status"], "approved")
        sent = self.hr.send_offer(
            offer["_id"],
            offer_url="https://hrms.example.com/careers/offers/{token}",
        )
        accepted = self.public.respond_to_offer(sent["response_token"], "accepted")
        return candidate, job, accepted["application"], accepted["pre_joining_token"]

    def _complete_joining_requirements(self):
        candidate, job, application, token = self._create_accepted_offer()
        documents = list(self.db[DOCUMENTS].find({
            "tenant_id": self.TENANT_A,
            "application_id": str(application["_id"]),
        }))
        required_documents = [item for item in documents if item.get("required")]
        self.assertGreater(len(required_documents), 0)

        for item in required_documents:
            self.public.submit_joining_document(
                token,
                item["document_key"],
                {
                    "file_name": f"{item['document_key']}.pdf",
                    "file_path": f"/secure/{item['document_key']}.pdf",
                    "mime_type": "application/pdf",
                    "size_bytes": 1024,
                    "sha256": f"sha-{item['document_key']}",
                },
            )
            self.hr.review_joining_document(item["_id"], "accepted")

        result = self.hr.update_background_check(application["_id"], {
            "check_type": "identity",
            "check_label": "Identity verification",
            "status": "clear",
            "required": True,
            "consent_received": True,
            "provider": "Internal verification",
            "result_summary": "Identity verified successfully.",
        })
        self.assertTrue(result["readiness"]["ready_to_join"])
        ready_application = self.db[APPLICATIONS].find_one({"_id": application["_id"]})
        self.assertEqual(ready_application["status"], "ready_to_join")
        return candidate, job, ready_application

    # ------------------------------------------------------------------
    # Tenant career portal settings
    # ------------------------------------------------------------------
    def test_recruitment_settings_generate_slug_from_tenant_code(self):
        settings = self.hr.get_settings()

        self.assertEqual(settings["public_career_slug"], "sds")
        self.assertIsNone(
            self.db[SETTINGS].find_one({"tenant_id": self.TENANT_A})
        )

    def test_recruitment_settings_normalise_custom_career_slug(self):
        settings = self.hr.update_settings({
            "public_career_slug": "  SDS Careers & Jobs  ",
        })

        self.assertEqual(settings["public_career_slug"], "sds-careers-jobs")
        stored = self.db[SETTINGS].find_one({"tenant_id": self.TENANT_A})
        self.assertEqual(stored["public_career_slug"], "sds-careers-jobs")

    def test_blank_career_slug_falls_back_to_tenant_slug(self):
        settings = self.hr.update_settings({"public_career_slug": "   "})

        self.assertEqual(settings["public_career_slug"], "sds")

    def test_duplicate_career_slug_is_rejected_across_tenants(self):
        other = self.other_hr.update_settings({
            "public_career_slug": "shared-careers",
        })
        self.assertEqual(other["public_career_slug"], "shared-careers")

        with self.assertRaises(RecruitmentServiceError) as context:
            self.hr.update_settings({
                "public_career_slug": "Shared Careers",
            })

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(context.exception.code, "career_slug_already_exists")

    # ------------------------------------------------------------------
    # Permission, tenant and status controls
    # ------------------------------------------------------------------
    def test_employee_without_recruitment_role_cannot_create_hiring_request(self):
        with self.assertRaises(RecruitmentServiceError) as context:
            self.employee.create_hiring_request({
                "job_title": "Developer",
                "department": "IT",
                "business_reason": "Growth",
            })
        self.assertEqual(context.exception.status_code, 403)
        self.assertEqual(context.exception.code, "recruitment_hr_permission_required")

    def test_hiring_request_requires_approval_before_job_creation(self):
        request = self.hr.create_hiring_request({
            "job_title": "Developer",
            "department": "IT",
            "business_reason": "New client project",
            "approver_user_ids": [str(self.manager_id)],
        })
        with self.assertRaises(RecruitmentServiceError) as context:
            self.hr.create_job_opening({
                "hiring_request_id": str(request["_id"]),
                "description": "Build and maintain HRMS applications.",
            })
        self.assertEqual(context.exception.code, "hiring_request_not_approved")

        submitted = self.hr.submit_hiring_request(request["_id"])
        self.assertEqual(submitted["status"], "submitted")
        approved = self.manager.decide_hiring_request(request["_id"], "approved")
        self.assertEqual(approved["status"], "approved")

        job = self.hr.create_job_opening({
            "hiring_request_id": str(request["_id"]),
            "description": "Build and maintain HRMS applications.",
        })
        self.assertEqual(job["status"], "draft")
        self.assertEqual(job["tenant_id"], self.TENANT_A)

    def test_tenant_isolation_blocks_cross_company_candidate_access(self):
        candidate = self.hr.create_candidate({
            "full_name": "Tenant A Candidate",
            "email": "tenant.a.candidate@example.com",
        })
        with self.assertRaises(RecruitmentServiceError) as context:
            self.other_hr.get_candidate(candidate["_id"])
        self.assertEqual(context.exception.status_code, 404)
        self.assertEqual(context.exception.code, "candidate_not_found")

    def test_duplicate_candidate_and_duplicate_application_are_blocked(self):
        _request, job = self._create_approved_job()
        candidate, application = self._create_candidate_application(job["_id"])

        with self.assertRaises(RecruitmentServiceError) as candidate_error:
            self.hr.create_candidate({
                "full_name": "Ananya Duplicate",
                "email": candidate["email"].upper(),
            })
        self.assertEqual(candidate_error.exception.code, "duplicate_candidate")

        with self.assertRaises(RecruitmentServiceError) as application_error:
            self.hr.create_application({
                "candidate_id": str(candidate["_id"]),
                "job_opening_id": str(job["_id"]),
            })
        self.assertEqual(application_error.exception.code, "duplicate_job_application")
        self.assertEqual(application_error.exception.status_code, 409)
        self.assertEqual(application["status"], "applied")

    def test_invalid_application_status_jump_is_blocked(self):
        _request, job = self._create_approved_job()
        _candidate, application = self._create_candidate_application(job["_id"])
        with self.assertRaises(RecruitmentServiceError) as context:
            self.hr.change_application_status(application["_id"], "selected")
        self.assertEqual(context.exception.code, "invalid_recruitment_status_transition")
        self.assertIn("shortlisted", context.exception.details["allowed_statuses"])

    # ------------------------------------------------------------------
    # Interview and offer flow
    # ------------------------------------------------------------------
    def test_only_assigned_interviewer_can_submit_feedback(self):
        _request, job = self._create_approved_job()
        _candidate, application = self._create_candidate_application(job["_id"])
        application = self.hr.change_application_status(application["_id"], "shortlisted")
        interview = self.hr.schedule_interview(application["_id"], {
            "round_key": "technical",
            "round_label": "Technical Interview",
            "scheduled_at": (datetime.utcnow() + timedelta(days=1)).isoformat(),
            "duration_minutes": 45,
            "mode": "online",
            "meeting_link": "https://meet.example.com/interview",
            "interviewer_user_ids": [str(self.interviewer_id)],
        })
        self.assertEqual(interview["status"], "scheduled")
        self.assertEqual(
            self.db[APPLICATIONS].find_one({"_id": application["_id"]})["status"],
            "interview_scheduled",
        )

        with self.assertRaises(RecruitmentServiceError) as context:
            self.manager.submit_interview_feedback(interview["_id"], {
                "ratings": {
                    "role_knowledge": 4,
                    "relevant_experience": 4,
                    "communication": 4,
                    "problem_solving": 4,
                    "work_approach": 4,
                },
                "recommendation": "hire",
                "comments": "Suitable candidate.",
            })
        self.assertEqual(context.exception.code, "interview_feedback_access_denied")

        feedback = self.interviewer.submit_interview_feedback(interview["_id"], {
            "ratings": {
                "role_knowledge": 5,
                "relevant_experience": 4,
                "communication": 4,
                "problem_solving": 5,
                "work_approach": 4,
            },
            "recommendation": "strong_hire",
            "comments": "Strong practical knowledge and relevant experience.",
            "strengths": ["GST", "Financial reporting"],
        })
        self.assertEqual(feedback["recommendation"], "strong_hire")
        self.assertEqual(feedback["overall_rating"], 4.4)
        stored_interview = self.db[INTERVIEWS].find_one({"_id": interview["_id"]})
        self.assertEqual(stored_interview["feedback_count"], 1)

    def test_offer_must_be_approved_before_sending(self):
        _candidate, _job, application = self._create_selected_application()
        offer = self.hr.create_offer(application["_id"], {
            "joining_date": (date.today() + timedelta(days=21)).isoformat(),
            "response_deadline": (date.today() + timedelta(days=7)).isoformat(),
            "salary": {"annual_ctc": 650000},
        })
        with self.assertRaises(RecruitmentServiceError) as context:
            self.hr.send_offer(offer["_id"])
        self.assertEqual(context.exception.code, "offer_not_approved")

    def test_offer_acceptance_creates_joining_checklist_and_secure_token(self):
        _candidate, _job, application, token = self._create_accepted_offer()
        self.assertTrue(token)
        self.assertEqual(application["status"], "documents_pending")
        self.assertEqual(application["joining_status"], "documents_pending")
        self.assertGreater(
            self.db[DOCUMENTS].count_documents({
                "tenant_id": self.TENANT_A,
                "application_id": str(application["_id"]),
            }),
            0,
        )
        self.assertEqual(
            self.db[BACKGROUND_CHECKS].count_documents({
                "tenant_id": self.TENANT_A,
                "application_id": str(application["_id"]),
                "check_type": "identity",
            }),
            1,
        )
        portal = self.public.get_public_joining_portal(token)
        self.assertEqual(portal["application"]["candidate_name"], "Ananya Das")
        self.assertFalse(portal["readiness"]["ready_to_join"])

    # ------------------------------------------------------------------
    # Joining and employee conversion
    # ------------------------------------------------------------------
    def test_required_documents_and_background_check_control_readiness(self):
        _candidate, _job, application, token = self._create_accepted_offer()
        first_required = self.db[DOCUMENTS].find_one({
            "tenant_id": self.TENANT_A,
            "application_id": str(application["_id"]),
            "required": True,
        })
        self.public.submit_joining_document(
            token,
            first_required["document_key"],
            {
                "file_name": "document.pdf",
                "file_path": "/secure/document.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 500,
            },
        )
        result = self.hr.review_joining_document(first_required["_id"], "accepted")
        self.assertFalse(result["readiness"]["ready_to_join"])
        self.assertGreater(len(result["readiness"]["pending_documents"]), 0)
        self.assertGreater(len(result["readiness"]["pending_background_checks"]), 0)

    def test_ready_candidate_converts_to_employee_and_onboarding_tasks(self):
        candidate, _job, application = self._complete_joining_requirements()
        result = self.hr.convert_candidate_to_employee(application["_id"], {
            "temporary_password": "Temporary@123",
            "joining_date": application["joining_date"],
            "branch": "Assam(HO)",
            "shift": "General",
        })

        employee = result["employee"]
        self.assertFalse(result["already_converted"])
        self.assertEqual(result["temporary_password"], "Temporary@123")
        self.assertEqual(employee["tenant_id"], self.TENANT_A)
        self.assertEqual(employee["email"], candidate["email"])
        self.assertEqual(employee["designation"], "Accounts Manager")
        self.assertTrue(employee["salary_setup_pending"])
        self.assertEqual(result["onboarding_tasks_created"], 6)

        user = self.db.users.find_one({"_id": ObjectId(result["user_id"])})
        self.assertIsNotNone(user)
        self.assertEqual(user["role"], "employee")
        self.assertTrue(user["must_change_password"])

        joined_application = self.db[APPLICATIONS].find_one({"_id": application["_id"]})
        self.assertEqual(joined_application["status"], "joined")
        self.assertEqual(joined_application["joining_status"], "joined")
        self.assertEqual(
            self.db[ONBOARDING_TASKS].count_documents({
                "tenant_id": self.TENANT_A,
                "application_id": str(application["_id"]),
            }),
            6,
        )

    def test_public_candidate_creation_requires_explicit_consent(self):
        with self.assertRaises(RecruitmentServiceError) as context:
            self.public.create_candidate({
                "full_name": "Public Applicant",
                "email": "public.applicant@example.com",
            }, public=True)
        self.assertEqual(context.exception.code, "candidate_consent_required")

        candidate = self.public.create_candidate({
            "full_name": "Public Applicant",
            "email": "public.applicant@example.com",
            "consent": {
                "accepted": True,
                "text_version": "recruitment-privacy-v1",
                "ip_address": "127.0.0.1",
            },
        }, public=True)
        self.assertTrue(candidate["consent"]["accepted"])
        self.assertEqual(candidate["created_by"], "public_candidate")


if __name__ == "__main__":
    unittest.main(verbosity=2)