"""Business logic for public account-access support tickets."""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Iterable

from bson import ObjectId
from flask import current_app
from pymongo import ASCENDING, DESCENDING

from app.services.email_service import (
    send_account_access_resolution_email,
    send_account_access_status_email,
    send_account_access_submission_email,
    send_account_access_team_alert_email,
)


class AccountAccessServiceError(RuntimeError):
    def __init__(self, message: str, status_code: int = 400, code: str = "account_access_error"):
        super().__init__(message)
        self.public_message = message
        self.status_code = status_code
        self.code = code


def _text(value: Any) -> str:
    return str(value or "").strip()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _normalise_status(value: Any) -> str:
    return _text(value).lower().replace("-", "_").replace(" ", "_")


def _serialise(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _serialise(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialise(item) for item in value]
    return value


def _first(document: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = _text(document.get(key))
        if value:
            return value
    return ""


class AccountAccessService:
    COLLECTION = "account_access_requests"
    VALID_STATUSES = {"open", "assigned", "in_progress", "resolved", "closed", "rejected", "reopened"}
    RESOLUTION_STATUSES = {"resolved", "closed"}
    ALLOWED_CATEGORIES = {
        "forgot_password",
        "account_locked",
        "cannot_login",
        "incorrect_credentials",
        "email_or_code_issue",
        "otp_or_verification_issue",
        "other",
    }
    MANAGEMENT_ROLES = {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "it_head",
        "it_support_head",
    }

    def __init__(self, db):
        self.db = db
        self.collection = db[self.COLLECTION]
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        try:
            self.collection.create_index([("ticket_id", ASCENDING)], unique=True)
            self.collection.create_index([("tenant_id", ASCENDING), ("created_at", DESCENDING)])
            self.collection.create_index([("employee_id", ASCENDING), ("created_at", DESCENDING)])
            self.collection.create_index([("status", ASCENDING), ("tenant_id", ASCENDING)])
        except Exception:
            # Application startup already has central index handling. Keep request
            # processing resilient if an existing installation has conflicting data.
            pass

    def _tenant_name(self, tenant_id: str) -> str:
        tenant = self.db.tenants.find_one({"tenant_id": tenant_id, "is_deleted": {"$ne": True}}) or {}
        return _first(tenant, "company_name", "name", "tenant_name", "organisation_name") or tenant_id

    def _employee_view(self, employee: Dict[str, Any]) -> Dict[str, Any]:
        tenant_id = _text(employee.get("tenant_id"))
        employee_id = str(employee.get("_id") or employee.get("employee_id") or "")
        employee_code = _first(employee, "employee_code", "emp_code", "employee_id", "code")
        employee_name = _first(employee, "employee_name", "full_name", "name")
        email = _first(employee, "email", "official_email", "work_email")
        return {
            "_id": employee_id,
            "employee_id": employee_id,
            "employee_code": employee_code,
            "employee_name": employee_name,
            "name": employee_name,
            "email": email,
            "department": _first(employee, "department_name", "department"),
            "designation": _first(employee, "designation_name", "designation"),
            "tenant_id": tenant_id,
            "company_name": self._tenant_name(tenant_id),
            "tenant_name": self._tenant_name(tenant_id),
        }

    def lookup_employee(self, identifier: str) -> Dict[str, Any]:
        identifier = _text(identifier)
        if not identifier:
            raise AccountAccessServiceError("Employee code or email is required.", 400)

        exact = re.compile(rf"^{re.escape(identifier)}$", re.IGNORECASE)
        query = {
            "is_deleted": {"$ne": True},
            "$or": [
                {"email": exact},
                {"official_email": exact},
                {"work_email": exact},
                {"employee_code": exact},
                {"emp_code": exact},
                {"employee_id": exact},
            ],
        }
        employee = self.db.employees.find_one(query)
        if not employee:
            raise AccountAccessServiceError(
                "No active employee was found using that employee code or email.",
                404,
                "employee_not_found",
            )

        status = _first(employee, "status", "employment_status").lower()
        if status and status not in {"active", "confirmed", "working", "probation"}:
            raise AccountAccessServiceError("This employee profile is not active.", 403, "employee_inactive")

        return self._employee_view(employee)

    def _find_employee_from_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_id = _text(payload.get("employee_id") or payload.get("employeeId"))
        tenant_id = _text(payload.get("tenant_id") or payload.get("tenantId"))
        employee = None

        if raw_id:
            candidates = [{"employee_id": raw_id}, {"emp_code": raw_id}, {"employee_code": raw_id}]
            if ObjectId.is_valid(raw_id):
                candidates.insert(0, {"_id": ObjectId(raw_id)})
            query: Dict[str, Any] = {"is_deleted": {"$ne": True}, "$or": candidates}
            if tenant_id:
                query["tenant_id"] = tenant_id
            employee = self.db.employees.find_one(query)

        if not employee:
            identifier = _text(payload.get("identifier") or payload.get("employee_code") or payload.get("email"))
            if identifier:
                view = self.lookup_employee(identifier)
                query = {"tenant_id": view["tenant_id"], "is_deleted": {"$ne": True}}
                if ObjectId.is_valid(view["employee_id"]):
                    query["_id"] = ObjectId(view["employee_id"])
                else:
                    query["employee_id"] = view["employee_id"]
                employee = self.db.employees.find_one(query)

        if not employee:
            raise AccountAccessServiceError("Employee verification has expired. Please search again.", 400)
        return employee

    def _ticket_id(self) -> str:
        for _ in range(10):
            ticket_id = f"YCA-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"
            if not self.collection.find_one({"ticket_id": ticket_id}, {"_id": 1}):
                return ticket_id
        raise AccountAccessServiceError("Unable to generate a ticket ID. Please retry.", 500)

    def _tracking_url(self, ticket_id: str) -> str:
        base = _text(current_app.config.get("FRONTEND_URL") or current_app.config.get("APP_URL"))
        if not base:
            origins = current_app.config.get("FRONTEND_ORIGINS") or []
            if isinstance(origins, str):
                origins = [item.strip() for item in origins.split(",") if item.strip()]
            base = _text(origins[0] if origins else "")
        return f"{base.rstrip('/')}/account-access-track?ticket={ticket_id}" if base else ""

    def _management_url(self) -> str:
        base = _text(current_app.config.get("FRONTEND_URL") or current_app.config.get("APP_URL"))
        if not base:
            origins = current_app.config.get("FRONTEND_ORIGINS") or []
            if isinstance(origins, str):
                origins = [item.strip() for item in origins.split(",") if item.strip()]
            base = _text(origins[0] if origins else "")
        return f"{base.rstrip('/')}/it-support" if base else ""

    def _send_creation_emails(self, ticket: Dict[str, Any]) -> None:
        try:
            send_account_access_submission_email(
                current_app.config,
                ticket.get("employee_email"),
                ticket.get("employee_name"),
                ticket.get("ticket_id"),
                ticket.get("company_name"),
                ticket.get("issue_category_label") or ticket.get("issue_category"),
                ticket.get("subject"),
                submitted_at=ticket.get("created_at"),
                tracking_url=self._tracking_url(ticket.get("ticket_id")),
            )
        except Exception:
            current_app.logger.exception("Could not send account-access submission email")

        recipients = self._management_recipients(ticket.get("tenant_id"))
        for recipient in recipients:
            try:
                send_account_access_team_alert_email(
                    current_app.config,
                    recipient.get("email"),
                    recipient.get("name"),
                    ticket.get("ticket_id"),
                    ticket.get("employee_name"),
                    ticket.get("employee_code"),
                    ticket.get("employee_email"),
                    ticket.get("department"),
                    ticket.get("designation"),
                    ticket.get("company_name"),
                    ticket.get("issue_category_label") or ticket.get("issue_category"),
                    ticket.get("subject"),
                    ticket.get("description"),
                    submitted_at=ticket.get("created_at"),
                    management_url=self._management_url(),
                )
            except Exception:
                current_app.logger.exception("Could not send account-access team alert")

    def _management_recipients(self, tenant_id: str) -> list[Dict[str, str]]:
        users = self.db.users.find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "is_active": {"$ne": False},
            "$or": [
                {"role": {"$in": list(self.MANAGEMENT_ROLES)}},
                {"roles": {"$in": list(self.MANAGEMENT_ROLES)}},
                {"is_it_support_head": {"$in": [True, "true", "True", 1]}},
            ],
        })
        output = []
        seen = set()
        for user in users:
            email = _text(user.get("email")).lower()
            if not email or email in seen:
                continue
            seen.add(email)
            output.append({"email": email, "name": _first(user, "name", "full_name") or email})
        return output

    def create_request(self, payload: Dict[str, Any], request_meta: Dict[str, Any] | None = None) -> Dict[str, Any]:
        employee = self._find_employee_from_payload(payload)
        view = self._employee_view(employee)

        category = _normalise_status(payload.get("issue_category") or payload.get("category"))
        if not category:
            raise AccountAccessServiceError("Issue category is required.", 400)
        if category not in self.ALLOWED_CATEGORIES:
            category = "other"

        subject = _text(payload.get("subject"))
        description = _text(payload.get("description") or payload.get("details"))
        if len(subject) < 3:
            raise AccountAccessServiceError("Please enter a clear subject.", 400)
        if len(description) < 10:
            raise AccountAccessServiceError("Please describe the account-access problem in more detail.", 400)

        now = _now()
        ticket_id = self._ticket_id()
        category_label = category.replace("_", " ").title()
        document = {
            "ticket_id": ticket_id,
            "tenant_id": view["tenant_id"],
            "company_name": view["company_name"],
            "employee_id": view["employee_id"],
            "employee_code": view["employee_code"],
            "employee_name": view["employee_name"],
            "employee_email": view["email"],
            "department": view["department"],
            "designation": view["designation"],
            "issue_category": category,
            "issue_category_label": category_label,
            "subject": subject,
            "description": description,
            "status": "open",
            "assigned_to": "",
            "assigned_to_name": "",
            "latest_update": "Your request has been submitted and shared with your organisation's HR and IT team.",
            "resolution_remarks": "",
            "created_at": now,
            "submitted_at": now,
            "updated_at": now,
            "resolved_at": None,
            "closed_at": None,
            "history": [{"status": "open", "message": "Request submitted", "at": now, "by": "employee"}],
            "request_meta": request_meta or {},
            "is_deleted": False,
        }
        result = self.collection.insert_one(document)
        document["_id"] = result.inserted_id
        self._send_creation_emails(document)
        return self._public_ticket(document)

    def _find_ticket(self, ticket_id: str, tenant_id: str | None = None) -> Dict[str, Any]:
        query: Dict[str, Any] = {"ticket_id": re.compile(rf"^{re.escape(_text(ticket_id))}$", re.IGNORECASE), "is_deleted": {"$ne": True}}
        if tenant_id:
            query["tenant_id"] = tenant_id
        ticket = self.collection.find_one(query)
        if not ticket:
            raise AccountAccessServiceError("No account-access ticket was found with that ticket ID.", 404, "ticket_not_found")
        return ticket

    def _public_ticket(self, ticket: Dict[str, Any]) -> Dict[str, Any]:
        return _serialise({
            "ticket_id": ticket.get("ticket_id"),
            "employee_name": ticket.get("employee_name"),
            "employee_code": ticket.get("employee_code"),
            "department": ticket.get("department"),
            "tenant_name": ticket.get("company_name"),
            "company_name": ticket.get("company_name"),
            "issue_category": ticket.get("issue_category"),
            "issue_category_label": ticket.get("issue_category_label"),
            "subject": ticket.get("subject"),
            "status": ticket.get("status"),
            "submitted_at": ticket.get("submitted_at") or ticket.get("created_at"),
            "assigned_to_name": ticket.get("assigned_to_name") or ticket.get("assigned_to"),
            "latest_update": ticket.get("latest_update"),
            "resolution_remarks": ticket.get("resolution_remarks"),
            "resolved_at": ticket.get("resolved_at") or ticket.get("closed_at"),
        })

    def track_ticket(self, ticket_id: str) -> Dict[str, Any]:
        if not _text(ticket_id):
            raise AccountAccessServiceError("Ticket ID is required.", 400)
        return self._public_ticket(self._find_ticket(ticket_id))

    def _assert_tenant_access(self, tenant_id: str, actor_roles: Iterable[str]) -> None:
        roles = {_normalise_status(role) for role in actor_roles}
        if "super_admin" in roles:
            return
        if not tenant_id:
            raise AccountAccessServiceError("Your tenant could not be identified.", 403)
        if not roles.intersection(self.MANAGEMENT_ROLES):
            raise AccountAccessServiceError("You are not authorised to manage these requests.", 403)

    def list_requests(self, tenant_id: str, actor_roles: Iterable[str], filters: Dict[str, Any]) -> Dict[str, Any]:
        self._assert_tenant_access(tenant_id, actor_roles)
        roles = {_normalise_status(role) for role in actor_roles}
        query: Dict[str, Any] = {"is_deleted": {"$ne": True}}
        if "super_admin" not in roles:
            query["tenant_id"] = tenant_id

        status = _normalise_status(filters.get("status"))
        category = _normalise_status(filters.get("issue_category"))
        search = _text(filters.get("search"))
        if status:
            query["status"] = status
        if category:
            query["issue_category"] = category
        if search:
            regex = re.compile(re.escape(search), re.IGNORECASE)
            query["$or"] = [
                {"ticket_id": regex}, {"employee_name": regex}, {"employee_code": regex},
                {"employee_email": regex}, {"subject": regex},
            ]

        try:
            page = max(1, int(filters.get("page") or 1))
            limit = min(100, max(1, int(filters.get("limit") or 25)))
        except (TypeError, ValueError):
            page, limit = 1, 25

        total = self.collection.count_documents(query)
        cursor = self.collection.find(query).sort("created_at", DESCENDING).skip((page - 1) * limit).limit(limit)
        items = [_serialise(item) for item in cursor]
        return {"items": items, "page": page, "limit": limit, "total": total, "pages": (total + limit - 1) // limit}

    def get_request(self, ticket_id: str, tenant_id: str, actor_roles: Iterable[str]) -> Dict[str, Any]:
        self._assert_tenant_access(tenant_id, actor_roles)
        roles = {_normalise_status(role) for role in actor_roles}
        scoped_tenant = None if "super_admin" in roles else tenant_id
        return _serialise(self._find_ticket(ticket_id, scoped_tenant))

    def update_request(self, ticket_id: str, tenant_id: str, payload: Dict[str, Any], actor: Dict[str, Any]) -> Dict[str, Any]:
        roles = actor.get("roles") or []
        self._assert_tenant_access(tenant_id, roles)
        scoped_tenant = None if "super_admin" in {_normalise_status(role) for role in roles} else tenant_id
        ticket = self._find_ticket(ticket_id, scoped_tenant)

        status = _normalise_status(payload.get("status") or ticket.get("status"))
        if status not in self.VALID_STATUSES:
            raise AccountAccessServiceError("Invalid ticket status.", 400)

        resolution = _text(payload.get("resolution_remarks") or payload.get("resolutionRemarks"))
        if status in self.RESOLUTION_STATUSES and not (resolution or _text(ticket.get("resolution_remarks"))):
            raise AccountAccessServiceError("Resolution remarks are required before resolving or closing the ticket.", 400)

        assigned_to = _text(payload.get("assigned_to") or payload.get("assignedTo") or ticket.get("assigned_to"))
        assigned_name = _text(payload.get("assigned_to_name") or payload.get("assignedToName") or assigned_to or ticket.get("assigned_to_name"))
        latest_update = _text(payload.get("latest_update") or payload.get("latestUpdate") or payload.get("update_message"))
        now = _now()
        actor_name = _text(actor.get("name") or actor.get("email"))

        update: Dict[str, Any] = {
            "status": status,
            "assigned_to": assigned_to,
            "assigned_to_name": assigned_name,
            "updated_at": now,
            "updated_by": actor_name,
        }
        if latest_update:
            update["latest_update"] = latest_update
        if resolution:
            update["resolution_remarks"] = resolution
        if status == "resolved":
            update["resolved_at"] = now
            update["resolved_by"] = actor_name
        elif status == "closed":
            update["closed_at"] = now
            update["resolved_at"] = ticket.get("resolved_at") or now
            update["resolved_by"] = ticket.get("resolved_by") or actor_name
        elif status in {"reopened", "open", "assigned", "in_progress"}:
            update["closed_at"] = None
            if status == "reopened":
                update["resolved_at"] = None

        history_entry = {
            "status": status,
            "message": latest_update or resolution or f"Status changed to {status.replace('_', ' ').title()}",
            "at": now,
            "by": actor_name,
            "user_id": _text(actor.get("user_id")),
        }
        self.collection.update_one({"_id": ticket["_id"]}, {"$set": update, "$push": {"history": history_entry}})
        updated = self.collection.find_one({"_id": ticket["_id"]}) or {**ticket, **update}

        employee_email = _text(updated.get("employee_email"))
        if employee_email:
            try:
                if status in self.RESOLUTION_STATUSES:
                    send_account_access_resolution_email(
                        current_app.config,
                        employee_email,
                        updated.get("employee_name"),
                        updated.get("ticket_id"),
                        updated.get("company_name"),
                        status.replace("_", " ").title(),
                        updated.get("resolution_remarks"),
                        resolved_at=updated.get("resolved_at") or updated.get("closed_at"),
                        resolved_by=updated.get("resolved_by") or actor_name,
                        tracking_url=self._tracking_url(updated.get("ticket_id")),
                    )
                elif status != ticket.get("status") or latest_update:
                    send_account_access_status_email(
                        current_app.config,
                        employee_email,
                        updated.get("employee_name"),
                        updated.get("ticket_id"),
                        updated.get("company_name"),
                        status.replace("_", " ").title(),
                        latest_update=updated.get("latest_update"),
                        tracking_url=self._tracking_url(updated.get("ticket_id")),
                    )
            except Exception:
                current_app.logger.exception("Could not send account-access status email")

        return _serialise(updated)