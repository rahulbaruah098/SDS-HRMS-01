"""Public and tenant-scoped account-access support routes.

This blueprint supports employees who cannot sign in, while keeping all
management operations protected and limited to the employee's tenant.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Tuple

from bson import ObjectId
from flask import Blueprint, g, jsonify, request

from app.extensions import get_db
from app.services.account_access_service import AccountAccessService
from app.utils.auth import audit, current_user_required


account_access_bp = Blueprint("account_access", __name__)

MANAGEMENT_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "it_head",
    "it_support_head",
}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_role(value: Any) -> str:
    return _text(value).lower().replace("-", "_").replace(" ", "_")


def _current_roles() -> set[str]:
    user = getattr(g, "current_user", {}) or {}
    roles: Iterable[Any] = user.get("roles") or []

    if isinstance(roles, str):
        roles = roles.split(",")

    normalized = {
        _normalize_role(role)
        for role in roles
        if _normalize_role(role)
    }

    primary_role = _normalize_role(user.get("role"))
    if primary_role:
        normalized.add(primary_role)

    return normalized


def _current_tenant_id() -> str:
    user = getattr(g, "current_user", {}) or {}
    return _text(getattr(g, "tenant_id", None) or user.get("tenant_id"))


def _truthy(value: Any) -> bool:
    return _text(value).lower() in {"1", "true", "yes", "on", "1.0"}


def _safe_object_id(value: Any) -> ObjectId | None:
    try:
        return ObjectId(_text(value))
    except Exception:
        return None


def _current_employee() -> Dict[str, Any]:
    """Load the employee profile linked to the authenticated user.

    IT Support Head and IT Support Member are employee capabilities in this
    project, so they may not be present in the user's authentication roles.
    """
    user = getattr(g, "current_user", {}) or {}
    tenant_id = _current_tenant_id()
    db = get_db()

    user_id = _text(user.get("_id") or user.get("id"))
    if user_id:
        employee = db.employees.find_one({
            "tenant_id": tenant_id,
            "user_id": user_id,
            "is_deleted": {"$ne": True},
        })
        if employee:
            return employee

    employee_id = _text(
        user.get("employee_id")
        or user.get("employee_ref_id")
        or user.get("employee_profile_id")
    )
    employee_object_id = _safe_object_id(employee_id)
    if employee_object_id:
        employee = db.employees.find_one({
            "_id": employee_object_id,
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        if employee:
            return employee

    email = _text(user.get("email")).lower()
    if email:
        employee = db.employees.find_one({
            "tenant_id": tenant_id,
            "email": {"$regex": f"^{email}$", "$options": "i"},
            "is_deleted": {"$ne": True},
        })
        if employee:
            return employee

    return {}


def _effective_roles() -> set[str]:
    """Return token roles plus employee capability-derived management roles."""
    roles = set(_current_roles())
    user = getattr(g, "current_user", {}) or {}
    employee = _current_employee()

    if _truthy(user.get("is_it_support_head")) or _truthy(employee.get("is_it_support_head")):
        roles.add("it_support_head")

    if (
        _truthy(user.get("is_it_support_member"))
        or _truthy(employee.get("is_it_support_member"))
        or "it_support_head" in roles
    ):
        roles.add("it_support_member")

    if (
        _truthy(user.get("is_hr"))
        or _truthy(user.get("is_hr_head"))
        or _truthy(employee.get("is_hr"))
        or _truthy(employee.get("is_hr_head"))
    ):
        roles.add("hr")

    return roles


def _has_management_access() -> bool:
    return bool(_effective_roles().intersection(MANAGEMENT_ROLES))


def _current_actor() -> Dict[str, Any]:
    user = getattr(g, "current_user", {}) or {}
    return {
        "user_id": _text(user.get("_id") or user.get("id")),
        "name": _text(user.get("name") or user.get("full_name") or user.get("email")),
        "email": _text(user.get("email")),
        "roles": sorted(_effective_roles()),
        "tenant_id": _current_tenant_id(),
    }


def _management_required() -> Tuple[Any, int] | None:
    if _has_management_access():
        return None

    return jsonify({
        "success": False,
        "message": "You are not authorised to manage account-access requests.",
    }), 403


def _json_body() -> Dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def _service() -> AccountAccessService:
    return AccountAccessService(get_db())


def _success(data: Any = None, message: str | None = None, status: int = 200):
    response: Dict[str, Any] = {"success": True}
    if message:
        response["message"] = message
    if data is not None:
        response["data"] = data
    return jsonify(response), status


def _error(exc: Exception):
    status = int(getattr(exc, "status_code", 500) or 500)
    message = _text(getattr(exc, "public_message", None) or str(exc))

    if status >= 500:
        message = "Unable to process the account-access request right now."

    return jsonify({"success": False, "message": message}), status


@account_access_bp.post("/lookup")
def lookup_employee():
    """Find an active employee by employee code or registered email."""
    payload = _json_body()
    identifier = _text(payload.get("identifier"))

    if not identifier:
        return jsonify({"success": False, "message": "Employee code or email is required."}), 400

    try:
        employee = _service().lookup_employee(identifier)
        return _success(employee)
    except Exception as exc:  # Service owns validation and not-found semantics.
        return _error(exc)


@account_access_bp.post("/requests")
def create_request():
    """Create a public account-access support ticket."""
    payload = _json_body()

    try:
        ticket = _service().create_request(
            payload,
            request_meta={
                "ip_address": _text(request.headers.get("X-Forwarded-For")).split(",")[0].strip()
                or _text(request.remote_addr),
                "user_agent": _text(request.headers.get("User-Agent")),
            },
        )
        return _success(
            ticket,
            "Your account-access request has been submitted.",
            201,
        )
    except Exception as exc:
        return _error(exc)


@account_access_bp.get("/track/<string:ticket_id>")
def track_request(ticket_id: str):
    """Return only the public-safe fields for a ticket."""
    try:
        ticket = _service().track_ticket(_text(ticket_id))
        return _success(ticket)
    except Exception as exc:
        return _error(exc)


@account_access_bp.get("/requests")
@current_user_required
def list_requests():
    """List requests for the signed-in HR/IT user's tenant."""
    denied = _management_required()
    if denied:
        return denied

    try:
        result = _service().list_requests(
            tenant_id=_current_tenant_id(),
            actor_roles=_effective_roles(),
            filters={
                "status": _text(request.args.get("status")),
                "issue_category": _text(request.args.get("issue_category")),
                "search": _text(request.args.get("search")),
                "page": request.args.get("page", 1),
                "limit": request.args.get("limit", 25),
            },
        )
        return _success(result)
    except Exception as exc:
        return _error(exc)


@account_access_bp.get("/requests/<string:ticket_id>")
@current_user_required
def get_request(ticket_id: str):
    """Retrieve one complete tenant-scoped ticket for management."""
    denied = _management_required()
    if denied:
        return denied

    try:
        ticket = _service().get_request(
            ticket_id=_text(ticket_id),
            tenant_id=_current_tenant_id(),
            actor_roles=_effective_roles(),
        )
        return _success(ticket)
    except Exception as exc:
        return _error(exc)


@account_access_bp.patch("/requests/<string:ticket_id>")
@current_user_required
def update_request(ticket_id: str):
    """Assign, progress, resolve, reject, reopen, or close a ticket."""
    denied = _management_required()
    if denied:
        return denied

    payload = _json_body()

    try:
        ticket = _service().update_request(
            ticket_id=_text(ticket_id),
            tenant_id=_current_tenant_id(),
            payload=payload,
            actor=_current_actor(),
        )

        audit(
            "account_access_request_updated",
            {
                "ticket_id": _text(ticket_id),
                "status": _text(ticket.get("status") if isinstance(ticket, dict) else payload.get("status")),
            },
        )

        return _success(ticket, "Account-access request updated successfully.")
    except Exception as exc:
        return _error(exc)