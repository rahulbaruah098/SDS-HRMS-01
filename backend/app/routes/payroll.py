from __future__ import annotations

import calendar
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable, Mapping

from bson import ObjectId
from pymongo import ReturnDocument
from flask import Blueprint, Response, g, jsonify, request
from jinja2 import Environment

from app.extensions import get_db
from app.middleware.tenant_guard import tenant_module_required
from app.services.payroll_attendance_service import (
    PayrollAttendanceError,
    sync_attendance_summaries,
)
from app.services.payroll_calculation_service import (
    PayrollCalculationError,
    calculate_payroll,
)
from app.services.payroll_config_service import (
    PayrollConfigError,
    activate_salary_structure_revision,
    activate_statutory_config_revision,
    get_effective_salary_structure,
    get_effective_statutory_config,
    list_salary_structure_history,
    list_statutory_config_history,
    normalize_state_code,
    safe_str,
    save_salary_structure_draft,
    save_statutory_config_draft,
)
from app.services.payroll_loan_service import (
    PayrollLoanError,
    apply_payroll_recoveries,
    approve_loan_advance,
    cancel_loan_advance,
    create_loan_advance,
    disburse_loan_advance,
    get_loan_advance,
    list_loan_advances,
    reject_loan_advance,
    resolve_payroll_deductions,
    revise_recovery_terms,
    submit_loan_advance,
    update_loan_advance_draft,
)
from app.services.payroll_reimbursement_service import (
    PayrollReimbursementError,
    apply_payroll_reimbursement_payments,
    approve_reimbursement,
    cancel_reimbursement,
    complete_hr_review,
    create_reimbursement,
    get_reimbursement,
    list_reimbursements,
    mark_manual_reimbursement_paid,
    reject_reimbursement,
    release_payroll_reimbursements,
    reserve_payroll_reimbursements,
    resolve_payroll_reimbursements,
    revise_reimbursement_schedule,
    submit_reimbursement,
    summarize_payroll_reimbursements,
    update_reimbursement_draft,
)
from app.utils.auth import audit, roles_required
from app.utils.serializers import clean_doc


payroll_bp = Blueprint("payroll", __name__)


PAYROLL_CONFIG_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "finance",
    "accounts_finance",
)


def _normalize_key(value: Any) -> str:
    return safe_str(value).lower().replace("-", "_").replace(" ", "_")


def _current_user() -> dict[str, Any]:
    return getattr(g, "current_user", {}) or {}


def _current_user_id() -> str:
    user = _current_user()
    return safe_str(user.get("_id") or user.get("id"))


def _current_tenant_id() -> str:
    user = _current_user()
    return safe_str(getattr(g, "tenant_id", None) or user.get("tenant_id") or "sds")


def _current_roles() -> set[str]:
    user = _current_user()
    raw_roles = user.get("roles") or []

    if isinstance(raw_roles, str):
        raw_roles = raw_roles.split(",")

    roles = {
        _normalize_key(role)
        for role in raw_roles
        if _normalize_key(role)
    }

    role = _normalize_key(user.get("role"))
    if role:
        roles.add(role)

    return roles


def _request_payload() -> dict[str, Any]:
    payload = request.get_json(silent=True) or {}

    if not isinstance(payload, dict):
        raise PayrollConfigError(
            "Request body must be a JSON object.",
            code="invalid_request_body",
        )

    return payload


def _requested_tenant_id(payload: dict[str, Any] | None = None) -> str:
    payload = payload or {}
    current_tenant = _current_tenant_id()
    requested_tenant = safe_str(
        payload.get("tenant_id")
        or request.args.get("tenant_id")
        or current_tenant
    )

    if requested_tenant != current_tenant and "super_admin" not in _current_roles():
        raise PayrollConfigError(
            "You cannot access payroll configuration for another company.",
            status_code=403,
            code="payroll_tenant_scope_forbidden",
        )

    return requested_tenant or current_tenant


def _object_id(value: Any) -> ObjectId | None:
    try:
        return ObjectId(safe_str(value))
    except Exception:
        return None


def _employee_name(employee: dict[str, Any]) -> str:
    return safe_str(
        employee.get("employee_name")
        or employee.get("name")
        or employee.get("full_name")
        or employee.get("display_name")
        or employee.get("official_email")
        or employee.get("email")
    )


def _employee_code(employee: dict[str, Any]) -> str:
    return safe_str(
        employee.get("employee_code")
        or employee.get("emp_code")
        or employee.get("employee_id")
        or employee.get("code")
    )


def _find_employee(db: Any, tenant_id: str, employee_reference: Any) -> dict[str, Any] | None:
    reference = safe_str(employee_reference)

    if not reference:
        return None

    identity_filters: list[dict[str, Any]] = [
        {"employee_id": reference},
        {"employee_code": reference},
        {"emp_code": reference},
        {"code": reference},
        {"user_id": reference},
        {"official_email": reference.lower()},
        {"email": reference.lower()},
    ]

    object_id = _object_id(reference)
    if object_id:
        identity_filters.insert(0, {"_id": object_id})

    return db.employees.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": identity_filters,
    })


def _canonical_employee_id(employee: dict[str, Any]) -> str:
    return safe_str(employee.get("_id"))


def _prepare_salary_structure_payload(
    db: Any,
    tenant_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    prepared = dict(payload)
    employee_reference = safe_str(
        prepared.get("employee_id")
        or prepared.get("employeeId")
        or prepared.get("employee_code")
        or prepared.get("employeeCode")
    )

    # An existing draft may be updated by id without resending employee_id.
    if not employee_reference:
        draft_id = _object_id(prepared.get("id") or prepared.get("_id"))
        if draft_id:
            existing = db.salary_structures.find_one({
                "_id": draft_id,
                "tenant_id": tenant_id,
                "status": "draft",
                "is_deleted": {"$ne": True},
            })
            if existing:
                employee_reference = safe_str(existing.get("employee_id"))

    if not employee_reference:
        raise PayrollConfigError(
            "employee_id is required.",
            code="employee_id_required",
        )

    employee = _find_employee(db, tenant_id, employee_reference)

    if not employee:
        raise PayrollConfigError(
            "Employee not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    prepared["employee_id"] = _canonical_employee_id(employee)
    prepared["employee_code"] = _employee_code(employee)
    prepared["employee_name"] = _employee_name(employee)

    # Use an explicitly stored two-letter employee state code only when the
    # request did not provide one. State names such as "Assam(HO)" are not
    # silently converted because payroll statutory rules must not be guessed.
    if not safe_str(prepared.get("state_code")):
        employee_state_code = safe_str(
            employee.get("state_code")
            or employee.get("work_state_code")
            or employee.get("payroll_state_code")
        ).upper()

        if employee_state_code == "ALL" or len(employee_state_code) == 2:
            prepared["state_code"] = employee_state_code
        else:
            prepared["state_code"] = "ALL"

    return prepared


def _resolve_employee_for_read(
    db: Any,
    tenant_id: str,
    employee_reference: Any,
) -> tuple[dict[str, Any], str]:
    employee = _find_employee(db, tenant_id, employee_reference)

    if not employee:
        raise PayrollConfigError(
            "Employee not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    return employee, _canonical_employee_id(employee)


def _success(message: str, **data: Any):
    payload = {"ok": True, "message": message}
    payload.update({key: clean_doc(value) for key, value in data.items()})
    return jsonify(payload)


@payroll_bp.errorhandler(PayrollConfigError)
def handle_payroll_config_error(error: PayrollConfigError):
    return jsonify({
        "ok": False,
        "message": error.message,
        "code": error.code,
    }), error.status_code


@payroll_bp.errorhandler(PayrollAttendanceError)
def handle_payroll_attendance_error(error: PayrollAttendanceError):
    return jsonify({
        "ok": False,
        "message": error.message,
        "code": error.code,
        "details": clean_doc(error.details),
    }), error.status_code


@payroll_bp.errorhandler(PayrollLoanError)
def handle_payroll_loan_error(error: PayrollLoanError):
    return jsonify({
        "ok": False,
        "message": error.message,
        "code": error.code,
        "details": clean_doc(error.details),
    }), error.status_code


@payroll_bp.errorhandler(PayrollReimbursementError)
def handle_payroll_reimbursement_error(error: PayrollReimbursementError):
    return jsonify({
        "ok": False,
        "message": error.message,
        "code": error.code,
        "details": clean_doc(error.details),
    }), error.status_code


@payroll_bp.post("/salary-structure")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def create_or_update_salary_structure_draft():
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    prepared = _prepare_salary_structure_payload(db, tenant_id, payload)

    structure = save_salary_structure_draft(
        db,
        tenant_id=tenant_id,
        payload=prepared,
        actor_id=_current_user_id(),
    )

    audit(
        "payroll_salary_structure_draft_saved",
        "salary_structures",
        structure.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": structure.get("employee_id"),
            "employee_code": structure.get("employee_code"),
            "version": structure.get("version"),
            "effective_from": structure.get("effective_from"),
        },
    )

    return _success(
        "Salary structure draft saved successfully.",
        salary_structure=structure,
    )


@payroll_bp.get("/salary-structure/<employee_reference>")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def get_salary_structure(employee_reference: str):
    db = get_db()
    tenant_id = _requested_tenant_id()
    employee, employee_id = _resolve_employee_for_read(
        db,
        tenant_id,
        employee_reference,
    )
    on_date = request.args.get("on_date") or request.args.get("effective_date")

    structure = get_effective_salary_structure(
        db,
        tenant_id=tenant_id,
        employee_id=employee_id,
        on_date=on_date,
    )

    if not structure:
        raise PayrollConfigError(
            "No active salary structure exists for this employee on the requested date.",
            status_code=404,
            code="active_salary_structure_not_found",
        )

    response_data: dict[str, Any] = {
        "employee": {
            "id": employee_id,
            "employee_code": _employee_code(employee),
            "employee_name": _employee_name(employee),
        },
        "salary_structure": structure,
    }

    if _normalize_key(request.args.get("include_history")) in {"1", "true", "yes"}:
        response_data["history"] = list_salary_structure_history(
            db,
            tenant_id=tenant_id,
            employee_id=employee_id,
        )

    return _success("Salary structure fetched successfully.", **response_data)


@payroll_bp.get("/salary-structure/<employee_reference>/history")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def get_salary_structure_history(employee_reference: str):
    db = get_db()
    tenant_id = _requested_tenant_id()
    employee, employee_id = _resolve_employee_for_read(
        db,
        tenant_id,
        employee_reference,
    )

    history = list_salary_structure_history(
        db,
        tenant_id=tenant_id,
        employee_id=employee_id,
    )

    return _success(
        "Salary structure history fetched successfully.",
        employee={
            "id": employee_id,
            "employee_code": _employee_code(employee),
            "employee_name": _employee_name(employee),
        },
        history=history,
        count=len(history),
    )


@payroll_bp.post("/salary-structure/<salary_structure_id>/activate")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def activate_salary_structure(salary_structure_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    structure = activate_salary_structure_revision(
        db,
        tenant_id=tenant_id,
        salary_structure_id=salary_structure_id,
        actor_id=_current_user_id(),
    )

    audit(
        "payroll_salary_structure_activated",
        "salary_structures",
        structure.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": structure.get("employee_id"),
            "employee_code": structure.get("employee_code"),
            "version": structure.get("version"),
            "effective_from": structure.get("effective_from"),
        },
    )

    return _success(
        "Salary structure activated successfully.",
        salary_structure=structure,
    )


@payroll_bp.post("/statutory-config")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def create_or_update_statutory_config_draft():
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    config = save_statutory_config_draft(
        db,
        tenant_id=tenant_id,
        payload=payload,
        actor_id=_current_user_id(),
    )

    audit(
        "payroll_statutory_config_draft_saved",
        "statutory_configs",
        config.get("_id"),
        {
            "tenant_id": tenant_id,
            "state_code": config.get("state_code"),
            "version": config.get("version"),
            "effective_from": config.get("effective_from"),
        },
    )

    return _success(
        "Statutory configuration draft saved successfully.",
        statutory_config=config,
    )


@payroll_bp.get("/statutory-config/<state_code>")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def get_statutory_config(state_code: str):
    db = get_db()
    tenant_id = _requested_tenant_id()
    normalized_state_code = normalize_state_code(state_code)
    on_date = request.args.get("on_date") or request.args.get("effective_date")

    config = get_effective_statutory_config(
        db,
        tenant_id=tenant_id,
        state_code=normalized_state_code,
        on_date=on_date,
    )

    if not config:
        raise PayrollConfigError(
            "No active statutory configuration exists for this state on the requested date.",
            status_code=404,
            code="active_statutory_config_not_found",
        )

    response_data: dict[str, Any] = {"statutory_config": config}

    if _normalize_key(request.args.get("include_history")) in {"1", "true", "yes"}:
        response_data["history"] = list_statutory_config_history(
            db,
            tenant_id=tenant_id,
            state_code=normalized_state_code,
        )

    return _success(
        "Statutory configuration fetched successfully.",
        **response_data,
    )


@payroll_bp.get("/statutory-config/<state_code>/history")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def get_statutory_config_history(state_code: str):
    db = get_db()
    tenant_id = _requested_tenant_id()
    normalized_state_code = normalize_state_code(state_code)

    history = list_statutory_config_history(
        db,
        tenant_id=tenant_id,
        state_code=normalized_state_code,
    )

    return _success(
        "Statutory configuration history fetched successfully.",
        state_code=normalized_state_code,
        history=history,
        count=len(history),
    )


@payroll_bp.post("/statutory-config/<statutory_config_id>/activate")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def activate_statutory_config(statutory_config_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    config = activate_statutory_config_revision(
        db,
        tenant_id=tenant_id,
        statutory_config_id=statutory_config_id,
        actor_id=_current_user_id(),
    )

    audit(
        "payroll_statutory_config_activated",
        "statutory_configs",
        config.get("_id"),
        {
            "tenant_id": tenant_id,
            "state_code": config.get("state_code"),
            "version": config.get("version"),
            "effective_from": config.get("effective_from"),
        },
    )

    return _success(
        "Statutory configuration activated successfully.",
        statutory_config=config,
    )

# ---------------------------------------------------------------------------
# Payroll attendance synchronization, calculation, workflow and payslip PDF
# ---------------------------------------------------------------------------

PAYROLL_HR_REVIEW_ROLES = {
    "hr",
    "hr_admin",
    "hr_manager",
}

PAYROLL_FINANCE_ROLES = {
    "finance",
    "accounts_finance",
}

PAYROLL_PRIVILEGED_READ_ROLES = {
    "super_admin",
    "admin",
    "hr",
    "hr_admin",
    "hr_manager",
    "finance",
    "accounts_finance",
}

PAYROLL_WORKFLOW_SEQUENCE = {
    "hr_review": ("draft", "hr_reviewed"),
    "finance_approve": ("hr_reviewed", "finance_approved"),
    "lock": ("finance_approved", "locked"),
    "disburse": ("locked", "disbursed"),
}

FINAL_PAYROLL_STATUSES = {
    "hr_reviewed",
    "finance_approved",
    "locked",
    "disbursed",
}

PAYROLL_LOAN_ACCESS_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "finance",
    "accounts_finance",
    "employee",
    "team_leader",
    "reporting_officer",
    "manager",
    "ro",
)

PAYROLL_LOAN_MANAGEMENT_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "finance",
    "accounts_finance",
}

PAYROLL_LOAN_FINANCE_ACTION_ROLES = (
    "super_admin",
    "admin",
    "finance",
    "accounts_finance",
)


PAYROLL_REIMBURSEMENT_ACCESS_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "finance",
    "accounts_finance",
    "employee",
    "team_leader",
    "reporting_officer",
    "manager",
    "ro",
)

PAYROLL_REIMBURSEMENT_MANAGEMENT_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "finance",
    "accounts_finance",
}

PAYROLL_REIMBURSEMENT_HR_ACTION_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
)

PAYROLL_REIMBURSEMENT_FINANCE_ACTION_ROLES = (
    "super_admin",
    "admin",
    "finance",
    "accounts_finance",
)

PAYROLL_REIMBURSEMENT_REVIEW_ACTION_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "finance",
    "accounts_finance",
)


# ------------------------------- Common helpers ----------------------------


def _current_user_name() -> str:
    user = _current_user()
    return safe_str(
        user.get("name")
        or user.get("full_name")
        or user.get("email")
        or "User"
    )


def _now() -> datetime:
    return datetime.utcnow()


def _truthy(value: Any) -> bool:
    return safe_str(value).lower() in {"1", "true", "yes", "on"}


def _date_only(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    text_value = safe_str(value)
    if not text_value:
        return None

    try:
        return date.fromisoformat(text_value[:10])
    except ValueError:
        return None


def _parse_period(payload: Mapping[str, Any]) -> tuple[str, int, int, date, date]:
    period = safe_str(payload.get("period") or payload.get("period_key"))

    if period:
        try:
            parsed = datetime.strptime(period, "%Y-%m")
            year = parsed.year
            month = parsed.month
        except ValueError as exc:
            raise PayrollConfigError(
                "period must use YYYY-MM format.",
                code="invalid_payroll_period",
            ) from exc
    else:
        try:
            year = int(payload.get("year"))
            month = int(payload.get("month"))
        except (TypeError, ValueError) as exc:
            raise PayrollConfigError(
                "Provide period in YYYY-MM format, or provide month and year.",
                code="payroll_period_required",
            ) from exc

    if year < 2000 or year > 2200:
        raise PayrollConfigError(
            "Payroll year must be between 2000 and 2200.",
            code="invalid_payroll_year",
        )

    if month < 1 or month > 12:
        raise PayrollConfigError(
            "Payroll month must be between 1 and 12.",
            code="invalid_payroll_month",
        )

    last_day = calendar.monthrange(year, month)[1]
    period_key = f"{year:04d}-{month:02d}"
    return period_key, month, year, date(year, month, 1), date(year, month, last_day)


def _snapshot(value: Any) -> Any:
    """Create a Mongo-safe immutable snapshot without retaining live references."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {str(key): _snapshot(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_snapshot(item) for item in value]
    return deepcopy(value)


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value if value not in (None, "") else default)
    except (TypeError, ValueError):
        return default


def _sum_numbers(items: Iterable[Mapping[str, Any]], key: str) -> int | float:
    total = sum(_number(item.get(key), 0) for item in items)
    rounded = round(total, 2)
    return int(rounded) if rounded.is_integer() else rounded


def _employee_state_code(employee: Mapping[str, Any], structure: Mapping[str, Any]) -> str:
    candidate = safe_str(
        structure.get("state_code")
        or employee.get("payroll_state_code")
        or employee.get("work_state_code")
        or employee.get("state_code")
        or "ALL"
    ).upper()

    if candidate == "ALL" or len(candidate) == 2:
        return candidate

    # Statutory state names are deliberately not guessed. The national/default
    # configuration is used until HR stores a valid two-letter state code.
    return "ALL"


def _assert_no_mid_month_revision(
    document: Mapping[str, Any],
    *,
    period_start: date,
    period_end: date,
    label: str,
) -> None:
    effective_from = _date_only(document.get("effective_from"))

    if (
        effective_from
        and period_start < effective_from <= period_end
    ):
        raise PayrollConfigError(
            f"{label} becomes effective on {effective_from.isoformat()}, which is "
            "inside the selected payroll month. Mid-month payroll revisions are "
            "not supported. Use the first day of a payroll month.",
            code="mid_month_payroll_revision_not_supported",
        )


def _employee_identifiers(employee: Mapping[str, Any]) -> set[str]:
    identifiers = {
        safe_str(employee.get("_id")),
        safe_str(employee.get("employee_id")),
        safe_str(employee.get("employee_code")),
        safe_str(employee.get("emp_code")),
        safe_str(employee.get("code")),
        safe_str(employee.get("user_id")),
        safe_str(employee.get("email")).lower(),
        safe_str(employee.get("official_email")).lower(),
    }
    return {identifier for identifier in identifiers if identifier}


def _selected_employees(
    db: Any,
    tenant_id: str,
    references: Any,
) -> list[dict[str, Any]]:
    if references in (None, ""):
        references = []

    if not isinstance(references, list):
        raise PayrollConfigError(
            "employee_ids must be a list.",
            code="invalid_employee_ids",
        )

    if references:
        employees: list[dict[str, Any]] = []
        missing: list[str] = []
        seen: set[str] = set()

        for reference in references:
            employee = _find_employee(db, tenant_id, reference)
            if not employee:
                missing.append(safe_str(reference))
                continue

            canonical_id = _canonical_employee_id(employee)
            if canonical_id in seen:
                continue

            seen.add(canonical_id)
            employees.append(employee)

        if missing:
            raise PayrollConfigError(
                "One or more selected employees were not found in the selected company: "
                + ", ".join(missing),
                status_code=404,
                code="payroll_employees_not_found",
            )

        return employees

    return list(
        db.employees.find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "status": {"$nin": ["Inactive", "inactive", "Alumni", "alumni"]},
        }).sort([
            ("employee_name", 1),
            ("name", 1),
            ("employee_code", 1),
        ])
    )


def _rows_by_employee(rows: Any) -> list[dict[str, Any]]:
    if rows in (None, ""):
        return []

    if isinstance(rows, dict):
        normalized: list[dict[str, Any]] = []
        for key, value in rows.items():
            if isinstance(value, dict):
                item = dict(value)
                item.setdefault("employee_id", key)
                normalized.append(item)
        return normalized

    if not isinstance(rows, list):
        raise PayrollConfigError(
            "attendance must be a list or an employee-keyed object.",
            code="invalid_attendance_payload",
        )

    return [dict(row) for row in rows if isinstance(row, dict)]


def _matching_row(
    rows: Iterable[Mapping[str, Any]],
    employee: Mapping[str, Any],
) -> dict[str, Any] | None:
    identifiers = _employee_identifiers(employee)

    for row in rows:
        reference = safe_str(
            row.get("employee_id")
            or row.get("employeeId")
            or row.get("employee_code")
            or row.get("employeeCode")
            or row.get("email")
        )
        if reference in identifiers or reference.lower() in identifiers:
            return dict(row)

    return None


def _matching_employee_input(
    raw_inputs: Any,
    employee: Mapping[str, Any],
) -> dict[str, Any]:
    if raw_inputs in (None, ""):
        return {}

    if not isinstance(raw_inputs, dict):
        raise PayrollConfigError(
            "employee_inputs must be an employee-keyed object.",
            code="invalid_employee_inputs",
        )

    identifiers = _employee_identifiers(employee)

    for key, value in raw_inputs.items():
        if safe_str(key) in identifiers or safe_str(key).lower() in identifiers:
            if not isinstance(value, dict):
                raise PayrollConfigError(
                    f"employee_inputs[{key}] must be an object.",
                    code="invalid_employee_input",
                )
            return dict(value)

    return {}


def _active_advances(
    db: Any,
    tenant_id: str,
    employee: Mapping[str, Any],
    period_key: str,
) -> list[dict[str, Any]]:
    """Resolve immutable, period-aware payroll deduction snapshots.

    Only Disbursed/Recovering records (plus supported legacy Active records)
    are eligible. Approved-but-not-disbursed requests are never deducted.
    """
    return resolve_payroll_deductions(
        db,
        tenant_id=tenant_id,
        employee_reference=_canonical_employee_id(employee),
        period_key=period_key,
    )


def _approved_payroll_reimbursements(
    db: Any,
    tenant_id: str,
    employee: Mapping[str, Any],
    period_key: str,
    run_id: str = "",
) -> list[dict[str, Any]]:
    """Resolve approved reimbursement snapshots for one payroll period."""
    return resolve_payroll_reimbursements(
        db,
        tenant_id=tenant_id,
        employee_reference=_canonical_employee_id(employee),
        period_key=period_key,
        run_id=run_id,
    )


def _apply_reimbursements_to_calculation(
    calculation: Mapping[str, Any],
    reimbursements: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Add reimbursements without changing PF, ESI, PT, or LWP salary bases.

    Reimbursements increase the employee's amount payable and total payroll
    cost, but contractual gross salary and statutory salary bases remain
    unchanged. Taxable classification is retained for manual/external TDS.
    """
    result = deepcopy(dict(calculation))
    summary = summarize_payroll_reimbursements(reimbursements)
    rows = list(summary.get("items") or [])

    earnings = [deepcopy(dict(item)) for item in (result.get("earnings") or [])]
    highest_order = max(
        (_number(item.get("display_order"), 0) for item in earnings),
        default=0,
    )

    reimbursement_lines: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        amount = round(_number(row.get("amount", row.get("approved_amount")), 0), 2)
        reference_id = safe_str(
            row.get("reference_id") or row.get("id") or row.get("_id")
        )
        line = {
            "code": f"reimbursement_{reference_id or index}",
            "label": safe_str(row.get("label")) or "Approved Reimbursement",
            "amount": int(amount) if float(amount).is_integer() else amount,
            "full_amount": int(amount) if float(amount).is_integer() else amount,
            "payable_amount": int(amount) if float(amount).is_integer() else amount,
            "display_order": int(highest_order) + 100 + index,
            "category": "reimbursement",
            "source": "payroll_reimbursements",
            "metadata": {
                "reference_id": reference_id,
                "type": safe_str(row.get("type")),
                "tax_treatment": safe_str(row.get("tax_treatment")),
                "is_taxable": bool(row.get("is_taxable")),
                "include_in_taxable_income": bool(
                    row.get("include_in_taxable_income")
                ),
                "lwp_proratable": False,
            },
        }
        earnings.append(line)
        reimbursement_lines.append({
            **deepcopy(dict(row)),
            "amount": line["amount"],
            "approved_amount": line["amount"],
            "reference_id": reference_id,
            "payroll_snapshot": deepcopy(line),
        })

    earnings.sort(
        key=lambda item: (
            _number(item.get("display_order"), 0),
            safe_str(item.get("code")),
        )
    )

    totals = deepcopy(dict(result.get("totals") or {}))
    reimbursement_total = round(_number(summary.get("total"), 0), 2)
    taxable_total = round(_number(summary.get("taxable_total"), 0), 2)
    non_taxable_total = round(_number(summary.get("non_taxable_total"), 0), 2)
    net_before = round(_number(totals.get("net_amount"), 0), 2)
    ctc_before = round(_number(totals.get("cost_to_company"), 0), 2)
    payable_gross = round(_number(totals.get("payable_gross_salary"), 0), 2)

    def money_number(value: float) -> int | float:
        rounded = round(value, 2)
        return int(rounded) if float(rounded).is_integer() else rounded

    totals.update({
        "net_amount_before_reimbursements": money_number(net_before),
        "reimbursements": money_number(reimbursement_total),
        "taxable_reimbursements": money_number(taxable_total),
        "non_taxable_reimbursements": money_number(non_taxable_total),
        "gross_payable_with_reimbursements": money_number(
            payable_gross + reimbursement_total
        ),
        "total_payroll_cost": money_number(ctc_before + reimbursement_total),
        "net_amount": money_number(net_before + reimbursement_total),
    })

    warnings = list(result.get("warnings") or [])
    if taxable_total > 0:
        warnings.append(
            "Taxable reimbursements are included in the payroll snapshot, but "
            "TDS remains manual/external and is not automatically recalculated."
        )

    result["earnings"] = earnings
    result["reimbursements"] = reimbursement_lines
    result["reimbursement_details"] = reimbursement_lines
    result["reimbursement_summary"] = {
        "count": int(summary.get("count") or 0),
        "taxable_total": money_number(taxable_total),
        "non_taxable_total": money_number(non_taxable_total),
        "total": money_number(reimbursement_total),
    }
    result["totals"] = totals
    result["warnings"] = list(dict.fromkeys(safe_str(item) for item in warnings if safe_str(item)))
    return result


def _bank_details(db: Any, tenant_id: str, employee: Mapping[str, Any]) -> dict[str, Any]:
    employee_id = _canonical_employee_id(employee)
    record = db.bank_details.find_one({
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "is_deleted": {"$ne": True},
    }) or {}

    return {
        "account_number": safe_str(
            record.get("account_number")
            or record.get("accountNumber")
            or employee.get("account_number")
            or employee.get("bank_account_number")
            or employee.get("account_no")
        ),
        "ifsc_code": safe_str(
            record.get("ifsc_code")
            or record.get("ifscCode")
            or employee.get("ifsc_code")
            or employee.get("ifsc")
        ),
        "bank_name": safe_str(
            record.get("bank_name")
            or record.get("bankName")
            or employee.get("bank_name")
        ),
    }


def _employee_snapshot(db: Any, tenant_id: str, employee: Mapping[str, Any]) -> dict[str, Any]:
    bank = _bank_details(db, tenant_id, employee)
    return {
        "employee_id": _canonical_employee_id(employee),
        "user_id": safe_str(employee.get("user_id")),
        "employee_code": _employee_code(dict(employee)),
        "name": _employee_name(dict(employee)),
        "official_email": safe_str(employee.get("official_email") or employee.get("email")),
        "department": safe_str(employee.get("department") or employee.get("function")),
        "function": safe_str(employee.get("function") or employee.get("department")),
        "designation": safe_str(employee.get("designation")),
        "location": safe_str(
            employee.get("location")
            or employee.get("branch")
            or employee.get("state")
        ),
        "date_of_joining": _snapshot(
            employee.get("date_of_joining")
            or employee.get("joining_date")
            or employee.get("doj")
        ),
        "pan": safe_str(
            employee.get("pan")
            or employee.get("pan_number")
            or employee.get("permanent_account_number")
        ),
        "uan": safe_str(
            employee.get("uan")
            or employee.get("uan_number")
            or employee.get("universal_account_number")
        ),
        "esi_number": safe_str(employee.get("esi_number") or employee.get("esic_number")),
        "pran": safe_str(employee.get("pran") or employee.get("pran_number")),
        **bank,
    }


def _run_totals(calculations: list[Mapping[str, Any]]) -> dict[str, Any]:
    totals = [calculation.get("totals") or {} for calculation in calculations]
    keys = {
        "monthly_ctc_configured",
        "gross_salary",
        "payable_gross_salary",
        "lwp_deduction",
        "employer_contribution_total",
        "cost_to_company",
        "tds",
        "pf_employee",
        "pf_employer",
        "professional_tax",
        "esi_employee",
        "esi_employer",
        "advances",
        "reimbursements",
        "taxable_reimbursements",
        "non_taxable_reimbursements",
        "gross_payable_with_reimbursements",
        "net_amount_before_reimbursements",
        "total_payroll_cost",
        "total_deductions",
        "net_amount",
    }
    return {key: _sum_numbers(totals, key) for key in sorted(keys)}


def _payroll_run_code(tenant_id: str, period_key: str) -> str:
    tenant_code = "".join(character for character in tenant_id.upper() if character.isalnum())
    return f"PAY-{tenant_code[:12] or 'TENANT'}-{period_key.replace('-', '')}"


def _notification_users_for_roles(
    db: Any,
    tenant_id: str,
    roles: Iterable[str],
) -> list[str]:
    normalized_roles = list({_normalize_key(role) for role in roles if _normalize_key(role)})
    if not normalized_roles:
        return []

    rows = db.users.find({
        "tenant_id": tenant_id,
        "is_active": True,
        "$or": [
            {"roles": {"$in": normalized_roles}},
            {"role": {"$in": normalized_roles}},
        ],
    }, {"_id": 1})

    return [safe_str(row.get("_id")) for row in rows if row.get("_id")]


def _insert_notifications(
    db: Any,
    *,
    tenant_id: str,
    user_ids: Iterable[str],
    title: str,
    body: str,
    meta: Mapping[str, Any],
) -> None:
    recipients = list(dict.fromkeys(safe_str(user_id) for user_id in user_ids if safe_str(user_id)))
    if not recipients:
        return

    now = _now()
    target_page = safe_str(meta.get("page")) or "payroll_runs"
    docs = []

    for user_id in recipients:
        docs.append({
            "tenant_id": tenant_id,
            "target_tenant_id": tenant_id,
            "user_id": user_id,
            "user_ids": [user_id],
            "title": title,
            "body": body,
            "message": body,
            "notification_type": "payroll",
            "priority": "high",
            "target": target_page,
            "target_scope": "selected_users",
            "audience": "selected_users",
            "show_popup": True,
            "popup_seen": False,
            "popup_seen_at": "",
            "read": False,
            "status": "unread",
            "meta": _snapshot(dict(meta)),
            "created_at": now,
            "updated_at": now,
            "created_by": _current_user_id(),
            "created_by_name": _current_user_name(),
            "is_deleted": False,
        })

    db.notifications.insert_many(docs)


# ----------------------------- Loans & advances ----------------------------


def _has_loan_management_access() -> bool:
    return bool(_current_roles().intersection(PAYROLL_LOAN_MANAGEMENT_ROLES))


def _current_employee_or_error(db: Any, tenant_id: str) -> dict[str, Any]:
    employee = _current_employee_for_user(db, tenant_id)

    if not employee:
        raise PayrollLoanError(
            "No employee profile is linked to the current user.",
            status_code=404,
            code="current_employee_not_found",
        )

    return employee


def _loan_employee_reference(
    db: Any,
    tenant_id: str,
    payload: Mapping[str, Any],
) -> str:
    requested = safe_str(
        payload.get("employee_id")
        or payload.get("employeeId")
        or payload.get("employee_code")
        or payload.get("employeeCode")
    )

    if _has_loan_management_access() and requested:
        return requested

    current_employee = _current_employee_or_error(db, tenant_id)
    current_employee_id = _canonical_employee_id(current_employee)

    if requested:
        requested_employee = _find_employee(db, tenant_id, requested)
        if not requested_employee or _canonical_employee_id(requested_employee) != current_employee_id:
            raise PayrollLoanError(
                "You can create or access loan requests only for your own employee profile.",
                status_code=403,
                code="payroll_loan_employee_scope_forbidden",
            )

    return current_employee_id


def _assert_loan_record_access(
    db: Any,
    tenant_id: str,
    record: Mapping[str, Any],
) -> None:
    if _has_loan_management_access():
        return

    current_employee = _current_employee_or_error(db, tenant_id)

    if safe_str(record.get("employee_id")) != _canonical_employee_id(current_employee):
        raise PayrollLoanError(
            "You cannot access another employee's loan or advance record.",
            status_code=403,
            code="payroll_loan_record_scope_forbidden",
        )


def _loan_employee_user_ids(
    db: Any,
    tenant_id: str,
    record: Mapping[str, Any],
) -> list[str]:
    employee_id = _object_id(record.get("employee_id"))
    employee = None

    if employee_id:
        employee = db.employees.find_one({
            "_id": employee_id,
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })

    if not employee:
        employee = _find_employee(db, tenant_id, record.get("employee_id"))

    user_id = safe_str((employee or {}).get("user_id") or record.get("user_id"))
    return [user_id] if user_id else []


def _query_values(*names: str) -> list[str]:
    values: list[str] = []

    for name in names:
        for raw_value in request.args.getlist(name):
            values.extend(
                item.strip()
                for item in safe_str(raw_value).split(",")
                if item.strip()
            )

    return list(dict.fromkeys(values))


@payroll_bp.get("/loans")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_ACCESS_ROLES)
def get_payroll_loans():
    db = get_db()
    tenant_id = _requested_tenant_id()
    requested_employee = safe_str(
        request.args.get("employee_id")
        or request.args.get("employeeId")
        or request.args.get("employee_code")
        or request.args.get("employeeCode")
    )

    if _has_loan_management_access():
        employee_reference = requested_employee
    else:
        employee_reference = _canonical_employee_id(
            _current_employee_or_error(db, tenant_id)
        )

    try:
        limit = int(request.args.get("limit") or 200)
    except (TypeError, ValueError) as exc:
        raise PayrollLoanError(
            "limit must be an integer.",
            code="invalid_payroll_loan_limit",
        ) from exc

    rows = list_loan_advances(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        statuses=_query_values("status", "statuses"),
        loan_types=_query_values("type", "types", "loan_type"),
        limit=limit,
    )

    return _success(
        "Loans and advances fetched successfully.",
        items=rows,
        count=len(rows),
    )


@payroll_bp.post("/loans")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_ACCESS_ROLES)
def create_payroll_loan():
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    employee_reference = _loan_employee_reference(db, tenant_id, payload)

    record = create_loan_advance(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        payload=payload,
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
    )

    audit(
        "payroll_loan_created",
        "loans_advances",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "employee_code": record.get("employee_code"),
            "type": record.get("type"),
            "requested_amount": record.get("requested_amount"),
        },
    )

    return _success(
        "Loan or advance draft created successfully.",
        loan_advance=record,
    )


@payroll_bp.get("/loans/<loan_advance_id>")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_ACCESS_ROLES)
def get_payroll_loan(loan_advance_id: str):
    db = get_db()
    tenant_id = _requested_tenant_id()
    record = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )
    _assert_loan_record_access(db, tenant_id, record)

    return _success(
        "Loan or advance fetched successfully.",
        loan_advance=record,
    )


@payroll_bp.patch("/loans/<loan_advance_id>")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_ACCESS_ROLES)
def update_payroll_loan(loan_advance_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    existing = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )
    _assert_loan_record_access(db, tenant_id, existing)

    record = update_loan_advance_draft(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
        payload=payload,
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
    )

    audit(
        "payroll_loan_draft_updated",
        "loans_advances",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "type": record.get("type"),
            "requested_amount": record.get("requested_amount"),
        },
    )

    return _success(
        "Loan or advance draft updated successfully.",
        loan_advance=record,
    )


@payroll_bp.post("/loans/<loan_advance_id>/submit")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_ACCESS_ROLES)
def submit_payroll_loan(loan_advance_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    existing = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )
    _assert_loan_record_access(db, tenant_id, existing)

    record = submit_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
        note=safe_str(payload.get("note")),
    )

    _insert_notifications(
        db,
        tenant_id=tenant_id,
        user_ids=_notification_users_for_roles(
            db,
            tenant_id,
            PAYROLL_FINANCE_ROLES,
        ),
        title="Loan or advance request submitted",
        body=(
            f"{record.get('employee_name') or 'An employee'} submitted "
            f"a {safe_str(record.get('label')).lower() or 'loan/advance'} request."
        ),
        meta={
            "loan_advance_id": safe_str(record.get("_id")),
            "employee_id": record.get("employee_id"),
            "status": record.get("status"),
            "page": "loans_advances",
        },
    )

    audit(
        "payroll_loan_submitted",
        "loans_advances",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "status": record.get("status"),
        },
    )

    return _success(
        "Loan or advance submitted for approval successfully.",
        loan_advance=record,
    )


@payroll_bp.post("/loans/<loan_advance_id>/approve")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_FINANCE_ACTION_ROLES)
def approve_payroll_loan(loan_advance_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    record = approve_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
        approved_amount=payload.get("approved_amount") or payload.get("approvedAmount"),
        interest_amount=payload.get("interest_amount", payload.get("interestAmount", 0)),
        emi_amount=(
            payload.get("emi_amount")
            or payload.get("emiAmount")
            or payload.get("deduction_amount")
        ),
        recovery_start_period=(
            payload.get("recovery_start_period")
            or payload.get("recoveryStartPeriod")
        ),
        recovery_end_period=(
            payload.get("recovery_end_period")
            or payload.get("recoveryEndPeriod")
            or ""
        ),
        custom_installments=payload.get(
            "custom_installments",
            payload.get("customInstallments"),
        ),
        hold_periods=payload.get("hold_periods", payload.get("holdPeriods")),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
        note=safe_str(payload.get("note")),
    )

    _insert_notifications(
        db,
        tenant_id=tenant_id,
        user_ids=_loan_employee_user_ids(db, tenant_id, record),
        title="Loan or advance approved",
        body=f"Your {record.get('label') or 'loan/advance'} request has been approved.",
        meta={
            "loan_advance_id": safe_str(record.get("_id")),
            "status": record.get("status"),
            "page": "loans_advances",
        },
    )

    audit(
        "payroll_loan_approved",
        "loans_advances",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "approved_amount": record.get("approved_amount"),
            "emi_amount": record.get("emi_amount"),
            "recovery_start_period": record.get("recovery_start_period"),
        },
    )

    return _success(
        "Loan or advance approved successfully.",
        loan_advance=record,
    )


@payroll_bp.post("/loans/<loan_advance_id>/reject")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_FINANCE_ACTION_ROLES)
def reject_payroll_loan(loan_advance_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    record = reject_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
        reason=payload.get("reason") or payload.get("rejection_reason"),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
    )

    _insert_notifications(
        db,
        tenant_id=tenant_id,
        user_ids=_loan_employee_user_ids(db, tenant_id, record),
        title="Loan or advance request rejected",
        body=(
            f"Your {record.get('label') or 'loan/advance'} request was rejected. "
            f"Reason: {safe_str((record.get('rejection') or {}).get('reason'))}"
        ),
        meta={
            "loan_advance_id": safe_str(record.get("_id")),
            "status": record.get("status"),
            "page": "loans_advances",
        },
    )

    audit(
        "payroll_loan_rejected",
        "loans_advances",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "reason": (record.get("rejection") or {}).get("reason"),
        },
    )

    return _success(
        "Loan or advance rejected successfully.",
        loan_advance=record,
    )


@payroll_bp.post("/loans/<loan_advance_id>/disburse")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_FINANCE_ACTION_ROLES)
def disburse_payroll_loan(loan_advance_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    disbursement = payload.get("disbursement") or payload

    if not isinstance(disbursement, dict):
        raise PayrollLoanError(
            "disbursement must be an object.",
            code="invalid_loan_disbursement_payload",
        )

    record = disburse_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
        transfer_date=(
            disbursement.get("transfer_date")
            or disbursement.get("transferDate")
        ),
        transfer_mode=(
            disbursement.get("transfer_mode")
            or disbursement.get("transferMode")
        ),
        transaction_reference=(
            disbursement.get("transaction_reference")
            or disbursement.get("transactionReference")
            or ""
        ),
        bank_reference=(
            disbursement.get("bank_reference")
            or disbursement.get("bankReference")
            or ""
        ),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
        note=safe_str(payload.get("note") or disbursement.get("note")),
    )

    _insert_notifications(
        db,
        tenant_id=tenant_id,
        user_ids=_loan_employee_user_ids(db, tenant_id, record),
        title="Loan or advance disbursed",
        body=(
            f"Your {record.get('label') or 'loan/advance'} has been disbursed. "
            f"Payroll recovery begins from {record.get('recovery_start_period')}."
        ),
        meta={
            "loan_advance_id": safe_str(record.get("_id")),
            "status": record.get("status"),
            "page": "loans_advances",
        },
    )

    audit(
        "payroll_loan_disbursed",
        "loans_advances",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "approved_amount": record.get("approved_amount"),
            "recovery_start_period": record.get("recovery_start_period"),
            "transfer_date": (record.get("disbursement") or {}).get("transfer_date"),
        },
    )

    return _success(
        "Loan or advance disbursed successfully.",
        loan_advance=record,
    )


@payroll_bp.post("/loans/<loan_advance_id>/cancel")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_ACCESS_ROLES)
def cancel_payroll_loan(loan_advance_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    existing = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )
    _assert_loan_record_access(db, tenant_id, existing)

    record = cancel_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
        reason=payload.get("reason") or payload.get("cancellation_reason"),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
    )

    audit(
        "payroll_loan_cancelled",
        "loans_advances",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "reason": record.get("cancellation_reason"),
        },
    )

    return _success(
        "Loan or advance cancelled successfully.",
        loan_advance=record,
    )


@payroll_bp.post("/loans/<loan_advance_id>/recovery-terms")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_FINANCE_ACTION_ROLES)
def revise_payroll_loan_recovery_terms(loan_advance_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    record = revise_recovery_terms(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
        effective_from_period=(
            payload.get("effective_from_period")
            or payload.get("effectiveFromPeriod")
        ),
        emi_amount=(
            payload.get("emi_amount")
            or payload.get("emiAmount")
            or payload.get("deduction_amount")
        ),
        recovery_end_period=(
            payload.get("recovery_end_period")
            or payload.get("recoveryEndPeriod")
            or ""
        ),
        custom_installments=payload.get(
            "custom_installments",
            payload.get("customInstallments"),
        ),
        hold_periods=payload.get("hold_periods", payload.get("holdPeriods")),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
        note=safe_str(payload.get("note")),
    )

    audit(
        "payroll_loan_recovery_terms_revised",
        "loans_advances",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "effective_from_period": (
                (record.get("recovery_term_revisions") or [{}])[-1].get(
                    "effective_from_period"
                )
            ),
        },
    )

    return _success(
        "Loan recovery terms revised successfully.",
        loan_advance=record,
    )


@payroll_bp.post("/run/<run_id>/apply-loan-recoveries")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_LOAN_FINANCE_ACTION_ROLES)
def retry_payroll_loan_recoveries(run_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    run_object_id = _object_id(run_id)
    run = db.payroll_runs.find_one({
        "tenant_id": tenant_id,
        "$or": [
            {"_id": run_object_id} if run_object_id else {"_id": None},
            {"_id": run_id},
            {"run_id": run_id},
        ],
        "is_deleted": {"$ne": True},
    })

    if not run:
        raise PayrollLoanError(
            "Payroll run was not found.",
            status_code=404,
            code="payroll_run_not_found",
        )

    canonical_run_id = safe_str(run.get("_id"))
    payslips = list(db.payslips.find({
        "tenant_id": tenant_id,
        "run_id": canonical_run_id,
        "is_deleted": {"$ne": True},
    }))

    recovery = apply_payroll_recoveries(
        db,
        tenant_id=tenant_id,
        run_id=canonical_run_id,
        period_key=run.get("period_key"),
        payslips=payslips,
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
    )

    db.payroll_runs.update_one(
        {"_id": run.get("_id"), "tenant_id": tenant_id},
        {
            "$set": {
                "loan_recovery_summary": _snapshot(recovery),
                "loan_recovery_applied_at": _now(),
                "loan_recovery_applied_by": _current_user_id(),
                "updated_at": _now(),
            }
        },
    )

    audit(
        "payroll_loan_recoveries_applied",
        "payroll_runs",
        run.get("_id"),
        {
            "tenant_id": tenant_id,
            "period_key": run.get("period_key"),
            "totals": recovery.get("totals"),
            "failure_count": len(recovery.get("failures") or []),
        },
    )

    return _success(
        "Payroll loan recoveries processed successfully.",
        recovery=recovery,
    )


# ------------------------------ Reimbursements -----------------------------


def _has_reimbursement_management_access() -> bool:
    return bool(
        _current_roles().intersection(PAYROLL_REIMBURSEMENT_MANAGEMENT_ROLES)
    )


def _current_employee_for_reimbursement_or_error(
    db: Any,
    tenant_id: str,
) -> dict[str, Any]:
    employee = _current_employee_for_user(db, tenant_id)

    if not employee:
        raise PayrollReimbursementError(
            "No employee profile is linked to the current user.",
            status_code=404,
            code="current_employee_not_found",
        )

    return employee


def _reimbursement_employee_reference(
    db: Any,
    tenant_id: str,
    payload: Mapping[str, Any],
) -> str:
    requested = safe_str(
        payload.get("employee_id")
        or payload.get("employeeId")
        or payload.get("employee_code")
        or payload.get("employeeCode")
    )

    if _has_reimbursement_management_access() and requested:
        return requested

    current_employee = _current_employee_for_reimbursement_or_error(
        db,
        tenant_id,
    )
    current_employee_id = _canonical_employee_id(current_employee)

    if requested:
        requested_employee = _find_employee(db, tenant_id, requested)
        if (
            not requested_employee
            or _canonical_employee_id(requested_employee) != current_employee_id
        ):
            raise PayrollReimbursementError(
                "You can create or access reimbursement requests only for your own employee profile.",
                status_code=403,
                code="reimbursement_employee_scope_forbidden",
            )

    return current_employee_id


def _assert_reimbursement_record_access(
    db: Any,
    tenant_id: str,
    record: Mapping[str, Any],
) -> None:
    if _has_reimbursement_management_access():
        return

    current_employee = _current_employee_for_reimbursement_or_error(
        db,
        tenant_id,
    )

    if safe_str(record.get("employee_id")) != _canonical_employee_id(
        current_employee
    ):
        raise PayrollReimbursementError(
            "You cannot access another employee's reimbursement record.",
            status_code=403,
            code="reimbursement_record_scope_forbidden",
        )


def _reimbursement_employee_user_ids(
    db: Any,
    tenant_id: str,
    record: Mapping[str, Any],
) -> list[str]:
    employee_object_id = _object_id(record.get("employee_id"))
    employee = None

    if employee_object_id:
        employee = db.employees.find_one({
            "_id": employee_object_id,
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })

    if not employee:
        employee = _find_employee(db, tenant_id, record.get("employee_id"))

    user_id = safe_str((employee or {}).get("user_id") or record.get("user_id"))
    return [user_id] if user_id else []


def _reserve_run_reimbursements(
    db: Any,
    *,
    tenant_id: str,
    run: Mapping[str, Any],
    payslips: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    run_id = safe_str(run.get("_id"))
    period_key = safe_str(run.get("period_key"))
    reserved: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for payslip in payslips:
        details = list(payslip.get("reimbursement_details") or [])
        if not details:
            continue

        result = reserve_payroll_reimbursements(
            db,
            tenant_id=tenant_id,
            run_id=run_id,
            period_key=period_key,
            employee_id=payslip.get("employee_id"),
            reimbursement_details=details,
            payslip_id=payslip.get("_id"),
            actor_id=_current_user_id(),
            actor_name=_current_user_name(),
        )
        reserved.extend(result.get("reserved") or [])
        skipped.extend(result.get("skipped") or [])
        failures.extend(result.get("failures") or [])

    expected_amounts: dict[str, float] = {}
    for payslip in payslips:
        for detail in payslip.get("reimbursement_details") or []:
            reference_id = safe_str(
                detail.get("reference_id")
                or detail.get("id")
                or detail.get("_id")
            )
            if reference_id:
                expected_amounts[reference_id] = round(
                    _number(
                        detail.get("approved_amount", detail.get("amount")),
                        0,
                    ),
                    2,
                )

    for row in reserved:
        reference_id = safe_str(row.get("reimbursement_id"))
        expected = expected_amounts.get(reference_id)
        actual = round(_number(row.get("approved_amount"), 0), 2)
        if expected is not None and expected != actual:
            failures.append({
                "reimbursement_id": reference_id,
                "message": (
                    "The approved reimbursement amount changed after payroll calculation. "
                    "Recalculate the Draft payroll before HR review."
                ),
                "code": "reimbursement_snapshot_amount_mismatch",
                "details": {
                    "payslip_amount": expected,
                    "current_approved_amount": actual,
                },
            })

    if failures:
        release_payroll_reimbursements(
            db,
            tenant_id=tenant_id,
            run_id=run_id,
            actor_id=_current_user_id(),
            actor_name=_current_user_name(),
            reason="Reimbursement reservation rolled back after validation failure.",
        )
        raise PayrollReimbursementError(
            "One or more reimbursements could not be reserved for this payroll run. Recalculate the Draft payroll and try again.",
            status_code=409,
            code="payroll_reimbursement_reservation_failed",
            details={"failures": failures},
        )

    amount_reserved = round(
        sum(_number(item.get("approved_amount"), 0) for item in reserved),
        2,
    )
    return {
        "run_id": run_id,
        "period_key": period_key,
        "reserved": reserved,
        "skipped": skipped,
        "failures": [],
        "totals": {
            "reserved": len(reserved),
            "skipped": len(skipped),
            "failed": 0,
            "amount_reserved": (
                int(amount_reserved)
                if float(amount_reserved).is_integer()
                else amount_reserved
            ),
        },
    }


def _release_run_reimbursements_after_failed_transition(
    db: Any,
    *,
    tenant_id: str,
    run_id: str,
    reason: str,
) -> None:
    try:
        release_payroll_reimbursements(
            db,
            tenant_id=tenant_id,
            run_id=run_id,
            actor_id=_current_user_id(),
            actor_name=_current_user_name(),
            reason=reason,
        )
    except PayrollReimbursementError:
        # Preserve the primary workflow error. The scheduled records remain
        # traceable by run_id and can be corrected through the dedicated API.
        pass


@payroll_bp.get("/reimbursements")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_ACCESS_ROLES)
def get_payroll_reimbursements():
    db = get_db()
    tenant_id = _requested_tenant_id()
    requested_employee = safe_str(
        request.args.get("employee_id")
        or request.args.get("employeeId")
        or request.args.get("employee_code")
        or request.args.get("employeeCode")
    )

    if _has_reimbursement_management_access():
        employee_reference = requested_employee
    else:
        employee_reference = _canonical_employee_id(
            _current_employee_for_reimbursement_or_error(db, tenant_id)
        )

    try:
        limit = int(request.args.get("limit") or 200)
    except (TypeError, ValueError) as exc:
        raise PayrollReimbursementError(
            "limit must be an integer.",
            code="invalid_reimbursement_limit",
        ) from exc

    rows = list_reimbursements(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        statuses=_query_values("status", "statuses"),
        reimbursement_types=_query_values(
            "type",
            "types",
            "claim_type",
        ),
        payroll_period=(
            request.args.get("payroll_period")
            or request.args.get("period")
            or ""
        ),
        payment_mode=request.args.get("payment_mode") or "",
        limit=limit,
    )

    return _success(
        "Reimbursements fetched successfully.",
        items=rows,
        count=len(rows),
    )


@payroll_bp.post("/reimbursements")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_ACCESS_ROLES)
def create_payroll_reimbursement():
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    employee_reference = _reimbursement_employee_reference(
        db,
        tenant_id,
        payload,
    )

    record = create_reimbursement(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        payload=payload,
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
    )

    audit(
        "payroll_reimbursement_created",
        "payroll_reimbursements",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "type": record.get("type"),
            "claimed_amount": record.get("claimed_amount"),
        },
    )

    return _success(
        "Reimbursement draft created successfully.",
        reimbursement=record,
    )


@payroll_bp.get("/reimbursements/<reimbursement_id>")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_ACCESS_ROLES)
def get_payroll_reimbursement(reimbursement_id: str):
    db = get_db()
    tenant_id = _requested_tenant_id()
    record = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )
    _assert_reimbursement_record_access(db, tenant_id, record)

    return _success(
        "Reimbursement fetched successfully.",
        reimbursement=record,
    )


@payroll_bp.patch("/reimbursements/<reimbursement_id>")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_ACCESS_ROLES)
def update_payroll_reimbursement(reimbursement_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    existing = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )
    _assert_reimbursement_record_access(db, tenant_id, existing)

    record = update_reimbursement_draft(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
        payload=payload,
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
    )

    audit(
        "payroll_reimbursement_draft_updated",
        "payroll_reimbursements",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "claimed_amount": record.get("claimed_amount"),
        },
    )

    return _success(
        "Reimbursement draft updated successfully.",
        reimbursement=record,
    )


@payroll_bp.post("/reimbursements/<reimbursement_id>/submit")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_ACCESS_ROLES)
def submit_payroll_reimbursement(reimbursement_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    existing = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )
    _assert_reimbursement_record_access(db, tenant_id, existing)

    record = submit_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
        note=safe_str(payload.get("note")),
        receipts_required=not (
            "receipts_required" in payload
            and not _truthy(payload.get("receipts_required"))
        ),
    )

    _insert_notifications(
        db,
        tenant_id=tenant_id,
        user_ids=_notification_users_for_roles(
            db,
            tenant_id,
            PAYROLL_REIMBURSEMENT_HR_ACTION_ROLES,
        ),
        title="Reimbursement ready for HR review",
        body=(
            f"{record.get('employee_name') or 'An employee'} submitted "
            f"{record.get('label') or 'a reimbursement'} for "
            f"{record.get('claimed_amount')}."
        ),
        meta={
            "reimbursement_id": safe_str(record.get("_id")),
            "status": record.get("status"),
            "page": "reimbursements",
        },
    )

    audit(
        "payroll_reimbursement_submitted",
        "payroll_reimbursements",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "status": record.get("status"),
        },
    )

    return _success(
        "Reimbursement submitted for HR review successfully.",
        reimbursement=record,
    )


@payroll_bp.post("/reimbursements/<reimbursement_id>/hr-review")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_HR_ACTION_ROLES)
def review_payroll_reimbursement(reimbursement_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    record = complete_hr_review(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
        note=safe_str(payload.get("note")),
    )

    _insert_notifications(
        db,
        tenant_id=tenant_id,
        user_ids=_notification_users_for_roles(
            db,
            tenant_id,
            PAYROLL_REIMBURSEMENT_FINANCE_ACTION_ROLES,
        ),
        title="Reimbursement ready for Finance approval",
        body=(
            f"{record.get('employee_name') or 'An employee'} has a reimbursement "
            "that completed HR review."
        ),
        meta={
            "reimbursement_id": safe_str(record.get("_id")),
            "status": record.get("status"),
            "page": "reimbursements",
        },
    )

    audit(
        "payroll_reimbursement_hr_reviewed",
        "payroll_reimbursements",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "status": record.get("status"),
        },
    )

    return _success(
        "HR review completed successfully.",
        reimbursement=record,
    )


@payroll_bp.post("/reimbursements/<reimbursement_id>/approve")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_FINANCE_ACTION_ROLES)
def approve_payroll_reimbursement(reimbursement_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    record = approve_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
        approved_amount=(
            payload.get("approved_amount")
            or payload.get("approvedAmount")
        ),
        tax_treatment=(
            payload.get("tax_treatment")
            or payload.get("taxTreatment")
        ),
        payment_mode=(
            payload.get("payment_mode")
            or payload.get("paymentMode")
        ),
        payroll_period=(
            payload.get("payroll_period")
            or payload.get("payrollPeriod")
            or ""
        ),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
        note=safe_str(payload.get("note")),
    )

    _insert_notifications(
        db,
        tenant_id=tenant_id,
        user_ids=_reimbursement_employee_user_ids(db, tenant_id, record),
        title="Reimbursement approved",
        body=(
            f"Your {record.get('label') or 'reimbursement'} was approved for "
            f"{record.get('approved_amount')}. Payment mode: "
            f"{record.get('payment_mode')}."
        ),
        meta={
            "reimbursement_id": safe_str(record.get("_id")),
            "status": record.get("status"),
            "page": "reimbursements",
        },
    )

    audit(
        "payroll_reimbursement_approved",
        "payroll_reimbursements",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "approved_amount": record.get("approved_amount"),
            "tax_treatment": record.get("tax_treatment"),
            "payment_mode": record.get("payment_mode"),
            "payroll_period": record.get("payroll_period"),
        },
    )

    return _success(
        "Reimbursement approved successfully.",
        reimbursement=record,
    )


@payroll_bp.post("/reimbursements/<reimbursement_id>/reject")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_REVIEW_ACTION_ROLES)
def reject_payroll_reimbursement(reimbursement_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    record = reject_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
        reason=(
            payload.get("reason")
            or payload.get("rejection_reason")
        ),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
    )

    _insert_notifications(
        db,
        tenant_id=tenant_id,
        user_ids=_reimbursement_employee_user_ids(db, tenant_id, record),
        title="Reimbursement rejected",
        body=(
            f"Your {record.get('label') or 'reimbursement'} was rejected. "
            f"Reason: {safe_str((record.get('rejection') or {}).get('reason'))}"
        ),
        meta={
            "reimbursement_id": safe_str(record.get("_id")),
            "status": record.get("status"),
            "page": "reimbursements",
        },
    )

    audit(
        "payroll_reimbursement_rejected",
        "payroll_reimbursements",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "reason": (record.get("rejection") or {}).get("reason"),
        },
    )

    return _success(
        "Reimbursement rejected successfully.",
        reimbursement=record,
    )


@payroll_bp.post("/reimbursements/<reimbursement_id>/cancel")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_ACCESS_ROLES)
def cancel_payroll_reimbursement(reimbursement_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    existing = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )
    _assert_reimbursement_record_access(db, tenant_id, existing)

    record = cancel_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
        reason=(
            payload.get("reason")
            or payload.get("cancellation_reason")
        ),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
    )

    audit(
        "payroll_reimbursement_cancelled",
        "payroll_reimbursements",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "reason": record.get("cancellation_reason"),
        },
    )

    return _success(
        "Reimbursement cancelled successfully.",
        reimbursement=record,
    )


@payroll_bp.post("/reimbursements/<reimbursement_id>/payment-schedule")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_FINANCE_ACTION_ROLES)
def revise_payroll_reimbursement_payment_schedule(reimbursement_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    record = revise_reimbursement_schedule(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
        payment_mode=(
            payload.get("payment_mode")
            or payload.get("paymentMode")
        ),
        payroll_period=(
            payload.get("payroll_period")
            or payload.get("payrollPeriod")
            or ""
        ),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
        note=safe_str(payload.get("note")),
    )

    audit(
        "payroll_reimbursement_schedule_revised",
        "payroll_reimbursements",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "payment_mode": record.get("payment_mode"),
            "payroll_period": record.get("payroll_period"),
        },
    )

    return _success(
        "Reimbursement payment schedule revised successfully.",
        reimbursement=record,
    )


@payroll_bp.post("/reimbursements/<reimbursement_id>/manual-payment")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_FINANCE_ACTION_ROLES)
def complete_manual_reimbursement_payment(reimbursement_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    record = mark_manual_reimbursement_paid(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
        payment_date=(
            payload.get("payment_date")
            or payload.get("paymentDate")
        ),
        payment_reference=(
            payload.get("payment_reference")
            or payload.get("paymentReference")
        ),
        payment_mode=(
            payload.get("transfer_mode")
            or payload.get("payment_transfer_mode")
            or "bank_transfer"
        ),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
        note=safe_str(payload.get("note")),
    )

    _insert_notifications(
        db,
        tenant_id=tenant_id,
        user_ids=_reimbursement_employee_user_ids(db, tenant_id, record),
        title="Reimbursement paid",
        body=(
            f"Your {record.get('label') or 'reimbursement'} payment of "
            f"{record.get('paid_amount')} has been completed."
        ),
        meta={
            "reimbursement_id": safe_str(record.get("_id")),
            "status": record.get("status"),
            "page": "reimbursements",
        },
    )

    audit(
        "payroll_reimbursement_manual_payment_completed",
        "payroll_reimbursements",
        record.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": record.get("employee_id"),
            "paid_amount": record.get("paid_amount"),
            "payment_reference": (record.get("payment") or {}).get(
                "payment_reference"
            ),
        },
    )

    return _success(
        "Manual reimbursement payment completed successfully.",
        reimbursement=record,
    )


@payroll_bp.post("/run/<run_id>/apply-reimbursement-payments")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_REIMBURSEMENT_FINANCE_ACTION_ROLES)
def retry_payroll_reimbursement_payments(run_id: str):
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    run_object_id = _object_id(run_id)
    run = db.payroll_runs.find_one({
        "tenant_id": tenant_id,
        "$or": [
            {"_id": run_object_id} if run_object_id else {"_id": None},
            {"_id": run_id},
            {"run_id": run_id},
        ],
        "is_deleted": {"$ne": True},
    })

    if not run:
        raise PayrollReimbursementError(
            "Payroll run was not found.",
            status_code=404,
            code="payroll_run_not_found",
        )

    canonical_run_id = safe_str(run.get("_id"))
    payment_result = apply_payroll_reimbursement_payments(
        db,
        tenant_id=tenant_id,
        run_id=canonical_run_id,
        period_key=run.get("period_key"),
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
    )

    db.payroll_runs.update_one(
        {"_id": run.get("_id"), "tenant_id": tenant_id},
        {
            "$set": {
                "reimbursement_payment_summary": _snapshot(payment_result),
                "reimbursement_payment_applied_at": _now(),
                "reimbursement_payment_applied_by": _current_user_id(),
                "updated_at": _now(),
            }
        },
    )

    audit(
        "payroll_reimbursement_payments_applied",
        "payroll_runs",
        run.get("_id"),
        {
            "tenant_id": tenant_id,
            "period_key": run.get("period_key"),
            "totals": payment_result.get("totals"),
            "failure_count": len(payment_result.get("failures") or []),
        },
    )

    return _success(
        "Payroll reimbursement payments processed successfully.",
        reimbursement_payment=payment_result,
    )


# --------------------------- Attendance synchronization ---------------------


@payroll_bp.post("/attendance-sync")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def synchronize_payroll_attendance():
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)

    employee_references = payload.get("employee_ids")
    if employee_references in (None, ""):
        single_reference = payload.get("employee_id") or payload.get("employeeId")
        employee_references = [single_reference] if single_reference else []

    result = sync_attendance_summaries(
        db,
        tenant_id=tenant_id,
        period=payload.get("period") or payload.get("period_key"),
        month=payload.get("month"),
        year=payload.get("year"),
        employee_references=employee_references,
        actor_id=_current_user_id(),
        actor_name=_current_user_name(),
        persist=not (
            payload.get("persist") is False
            or _normalize_key(payload.get("persist")) in {"0", "false", "no"}
        ),
    )

    audit(
        "payroll_attendance_synchronized",
        "attendance_summaries",
        result.get("period_key"),
        {
            "tenant_id": tenant_id,
            "period_key": result.get("period_key"),
            "employees_synced": (result.get("totals") or {}).get("employees_synced"),
            "employees_failed": (result.get("totals") or {}).get("employees_failed"),
            "persisted": result.get("persisted"),
        },
    )

    return _success(
        "Payroll attendance synchronized successfully.",
        attendance_sync=result,
        items=result.get("items") or [],
        failures=result.get("failures") or [],
        totals=result.get("totals") or {},
    )


# ------------------------------- Calculation -------------------------------


@payroll_bp.post("/calculate")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def calculate_monthly_payroll():
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    period_key, month, year, period_start, period_end = _parse_period(payload)

    existing_run = db.payroll_runs.find_one({
        "tenant_id": tenant_id,
        "period_key": period_key,
        "is_deleted": {"$ne": True},
    })

    if existing_run:
        existing_status = _normalize_key(existing_run.get("status") or "draft")
        if existing_status != "draft" or _truthy(existing_run.get("is_locked")):
            raise PayrollConfigError(
                "This payroll run has already entered review, approval, lock, or "
                "disbursement and cannot be recalculated.",
                status_code=409,
                code="payroll_run_not_recalculable",
            )

    employees = _selected_employees(
        db,
        tenant_id,
        payload.get("employee_ids"),
    )

    if not employees:
        raise PayrollConfigError(
            "No active employees were found for payroll calculation.",
            status_code=404,
            code="no_payroll_employees",
        )

    attendance_rows = _rows_by_employee(payload.get("attendance"))
    raw_employee_inputs = payload.get("employee_inputs") or {}
    calculations: list[dict[str, Any]] = []
    prepared_payslips: list[dict[str, Any]] = []
    validation_errors: list[dict[str, Any]] = []

    for employee in employees:
        employee_id = _canonical_employee_id(employee)
        employee_code = _employee_code(employee)
        employee_name = _employee_name(employee)

        try:
            salary_structure = get_effective_salary_structure(
                db,
                tenant_id=tenant_id,
                employee_id=employee_id,
                on_date=period_end.isoformat(),
            )

            if not salary_structure:
                raise PayrollCalculationError(
                    "No active salary structure exists for the selected payroll month.",
                    code="active_salary_structure_not_found",
                    field="salary_structure",
                )

            _assert_no_mid_month_revision(
                salary_structure,
                period_start=period_start,
                period_end=period_end,
                label="The employee salary structure",
            )

            state_code = _employee_state_code(employee, salary_structure)
            statutory_config = get_effective_statutory_config(
                db,
                tenant_id=tenant_id,
                state_code=state_code,
                on_date=period_end.isoformat(),
            )

            if not statutory_config:
                raise PayrollCalculationError(
                    f"No active statutory configuration exists for state code {state_code}.",
                    code="active_statutory_config_not_found",
                    field="statutory_config",
                )

            _assert_no_mid_month_revision(
                statutory_config,
                period_start=period_start,
                period_end=period_end,
                label="The statutory configuration",
            )

            attendance = _matching_row(attendance_rows, employee)
            attendance_source = "request"

            if attendance is None:
                attendance_source = "attendance_summaries"
                attendance = db.attendance_summaries.find_one({
                    "tenant_id": tenant_id,
                    "employee_id": employee_id,
                    "period_key": period_key,
                    "is_deleted": {"$ne": True},
                })

            if not attendance:
                raise PayrollCalculationError(
                    "Attendance summary is missing. Synchronize attendance or provide "
                    "manual attendance before calculating payroll.",
                    code="attendance_summary_not_found",
                    field="attendance",
                )

            if "lwp_days" not in attendance and "lwpDays" not in attendance:
                raise PayrollCalculationError(
                    "lwp_days is required and is never assumed to be zero.",
                    code="lwp_days_required",
                    field="attendance.lwp_days",
                )

            calculation_inputs = _matching_employee_input(
                raw_employee_inputs,
                employee,
            )
            active_advances = _active_advances(
                db,
                tenant_id,
                employee,
                period_key,
            )
            calculation_inputs["advances"] = active_advances

            reimbursements = _approved_payroll_reimbursements(
                db,
                tenant_id,
                employee,
                period_key,
                run_id=(safe_str(existing_run.get("_id")) if existing_run else ""),
            )

            calculation = calculate_payroll(
                salary_structure=salary_structure,
                statutory_config=statutory_config,
                attendance=attendance,
                inputs=calculation_inputs,
            )
            calculation = _apply_reimbursements_to_calculation(
                calculation,
                reimbursements,
            )

            employee_info = _employee_snapshot(db, tenant_id, employee)
            attendance_snapshot = {
                **_snapshot(dict(attendance)),
                **_snapshot(calculation.get("attendance") or {}),
                "source": attendance_source,
                "salary_paid_days": (calculation.get("attendance") or {}).get("payable_days"),
            }

            payslip = {
                "tenant_id": tenant_id,
                "period_key": period_key,
                "month": month,
                "year": year,
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
                "employee_id": employee_id,
                "employee_code": employee_code,
                "employee_name": employee_name,
                "employee_info": employee_info,
                "state_code": state_code,
                "status": "draft",
                "workflow_stage": "draft",
                "is_locked": False,
                "calculation_version": calculation.get("calculation_version") or "1.0",
                "currency": calculation.get("currency") or "INR",
                "rounding_mode": calculation.get("rounding_mode"),
                "attendance": attendance_snapshot,
                "earnings": _snapshot(calculation.get("earnings") or []),
                "employer_contributions": _snapshot(
                    calculation.get("employer_contributions") or []
                ),
                "deductions": _snapshot(calculation.get("deductions") or []),
                "statutory": _snapshot(calculation.get("statutory") or {}),
                "totals": _snapshot(calculation.get("totals") or {}),
                "advance_details": _snapshot(calculation.get("advance_details") or []),
                "reimbursement_details": _snapshot(
                    calculation.get("reimbursement_details") or []
                ),
                "reimbursement_summary": _snapshot(
                    calculation.get("reimbursement_summary") or {}
                ),
                "warnings": _snapshot(calculation.get("warnings") or []),
                "salary_structure_id": safe_str(salary_structure.get("_id")),
                "salary_structure_version": salary_structure.get("version"),
                "salary_structure_snapshot": _snapshot(salary_structure),
                "statutory_config_id": safe_str(statutory_config.get("_id")),
                "statutory_config_version": statutory_config.get("version"),
                "statutory_config_snapshot": _snapshot(statutory_config),
                "calculation_input_snapshot": _snapshot(calculation_inputs),
                "calculated_at": _now(),
                "calculated_by": _current_user_id(),
                "calculated_by_name": _current_user_name(),
                "updated_at": _now(),
                "is_deleted": False,
            }

            calculations.append(calculation)
            prepared_payslips.append(payslip)
        except PayrollCalculationError as exc:
            validation_errors.append({
                "employee_id": employee_id,
                "employee_code": employee_code,
                "employee_name": employee_name,
                **exc.as_dict(),
            })
        except PayrollConfigError as exc:
            validation_errors.append({
                "employee_id": employee_id,
                "employee_code": employee_code,
                "employee_name": employee_name,
                "message": exc.message,
                "code": exc.code,
            })
        except PayrollReimbursementError as exc:
            validation_errors.append({
                "employee_id": employee_id,
                "employee_code": employee_code,
                "employee_name": employee_name,
                "message": exc.message,
                "code": exc.code,
                "details": _snapshot(exc.details),
            })

    if validation_errors:
        return jsonify({
            "ok": False,
            "message": (
                "Payroll validation failed. Nothing was saved because one or more "
                "employees could not be calculated."
            ),
            "code": "payroll_batch_validation_failed",
            "errors": validation_errors,
        }), 422

    now = _now()
    run_id = existing_run.get("_id") if existing_run else ObjectId()
    run_code = safe_str(existing_run.get("run_code")) if existing_run else ""
    run_code = run_code or _payroll_run_code(tenant_id, period_key)
    run_totals = _run_totals(calculations)
    employee_ids = [payslip["employee_id"] for payslip in prepared_payslips]

    run_document = {
        "tenant_id": tenant_id,
        "run_code": run_code,
        "period_key": period_key,
        "month": month,
        "year": year,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "status": "draft",
        "workflow_stage": "draft",
        "workflow_version": 1,
        "source": "dedicated_payroll_service",
        "is_locked": False,
        "employee_count": len(prepared_payslips),
        "employee_ids": employee_ids,
        "totals": run_totals,
        "processed_by": _current_user_id(),
        "processed_by_name": _current_user_name(),
        "processed_at": now,
        "calculated_by": _current_user_id(),
        "calculated_by_name": _current_user_name(),
        "calculated_at": now,
        "updated_at": now,
        "is_deleted": False,
        "workflow_history": [{
            "action": "calculate",
            "from_status": "draft" if existing_run else "not_created",
            "to_status": "draft",
            "note": safe_str(payload.get("note") or "Draft payroll calculated."),
            "actor_id": _current_user_id(),
            "actor_name": _current_user_name(),
            "actor_roles": sorted(_current_roles()),
            "at": now,
        }],
    }

    if existing_run and isinstance(existing_run.get("workflow_history"), list):
        run_document["workflow_history"] = [
            *_snapshot(existing_run.get("workflow_history") or []),
            *run_document["workflow_history"],
        ]

    db.payroll_runs.update_one(
        {"_id": run_id},
        {
            "$set": run_document,
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    saved_payslips: list[dict[str, Any]] = []

    for payslip in prepared_payslips:
        payslip["run_id"] = safe_str(run_id)
        result = db.payslips.find_one_and_update(
            {
                "tenant_id": tenant_id,
                "run_id": safe_str(run_id),
                "employee_id": payslip["employee_id"],
            },
            {
                "$set": payslip,
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        if result:
            saved_payslips.append(result)

    # A recalculated Draft represents the complete selected scope. Older Draft
    # payslips outside that scope are soft-deleted rather than left in the run.
    db.payslips.update_many(
        {
            "tenant_id": tenant_id,
            "run_id": safe_str(run_id),
            "employee_id": {"$nin": employee_ids},
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "is_deleted": True,
                "deleted_at": now,
                "deleted_by": _current_user_id(),
                "updated_at": now,
            }
        },
    )

    saved_run = db.payroll_runs.find_one({"_id": run_id})

    audit(
        "payroll_draft_calculated",
        "payroll_runs",
        run_id,
        {
            "tenant_id": tenant_id,
            "period_key": period_key,
            "employee_count": len(saved_payslips),
            "totals": run_totals,
        },
    )

    return _success(
        "Draft payroll calculated successfully.",
        run=saved_run,
        payslips=saved_payslips,
        employee_count=len(saved_payslips),
        totals=run_totals,
        errors=[],
    )


# ------------------------------- Workflow ----------------------------------


def _required_roles_for_action(action: str) -> set[str]:
    if action == "hr_review":
        return PAYROLL_HR_REVIEW_ROLES
    return PAYROLL_FINANCE_ROLES


def _assert_workflow_role(action: str) -> None:
    roles = _current_roles()
    if "super_admin" in roles:
        return

    required = _required_roles_for_action(action)
    if not roles.intersection(required):
        readable_roles = ", ".join(sorted(required))
        raise PayrollConfigError(
            f"This payroll action requires one of these roles: {readable_roles}.",
            status_code=403,
            code="payroll_workflow_role_forbidden",
        )


def _employee_user_ids_for_run(db: Any, tenant_id: str, run_id: str) -> list[str]:
    rows = db.payslips.find({
        "tenant_id": tenant_id,
        "run_id": run_id,
        "is_deleted": {"$ne": True},
    }, {"employee_id": 1, "employee_info.user_id": 1})

    user_ids: list[str] = []
    unresolved_employee_ids: list[str] = []

    for row in rows:
        user_id = safe_str((row.get("employee_info") or {}).get("user_id"))
        if user_id:
            user_ids.append(user_id)
        else:
            unresolved_employee_ids.append(safe_str(row.get("employee_id")))

    if unresolved_employee_ids:
        employees = db.employees.find({
            "tenant_id": tenant_id,
            "_id": {
                "$in": [
                    object_id
                    for object_id in (_object_id(value) for value in unresolved_employee_ids)
                    if object_id
                ]
            },
        }, {"user_id": 1})
        user_ids.extend(
            safe_str(employee.get("user_id"))
            for employee in employees
            if safe_str(employee.get("user_id"))
        )

    return list(dict.fromkeys(user_ids))


@payroll_bp.post("/run/approve")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_CONFIG_ROLES)
def advance_payroll_run():
    db = get_db()
    payload = _request_payload()
    tenant_id = _requested_tenant_id(payload)
    run_id = _object_id(payload.get("run_id") or payload.get("runId"))
    action = _normalize_key(payload.get("action"))

    if not run_id:
        raise PayrollConfigError(
            "A valid run_id is required.",
            code="invalid_payroll_run_id",
        )

    if action not in PAYROLL_WORKFLOW_SEQUENCE:
        raise PayrollConfigError(
            "action must be hr_review, finance_approve, lock, or disburse.",
            code="invalid_payroll_workflow_action",
        )

    _assert_workflow_role(action)

    run = db.payroll_runs.find_one({
        "_id": run_id,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    })

    if not run:
        raise PayrollConfigError(
            "Payroll run not found.",
            status_code=404,
            code="payroll_run_not_found",
        )

    if run.get("workflow_version") != 1 or run.get("source") != "dedicated_payroll_service":
        raise PayrollConfigError(
            "This is a legacy payroll run and cannot use the new approval workflow. "
            "Recalculate it through POST /payroll/calculate first.",
            status_code=409,
            code="legacy_payroll_run_not_supported",
        )

    expected_status, next_status = PAYROLL_WORKFLOW_SEQUENCE[action]
    current_status = _normalize_key(run.get("status") or "draft")

    if current_status != expected_status:
        raise PayrollConfigError(
            f"Cannot perform {action} while the payroll status is {current_status}. "
            f"The required current status is {expected_status}.",
            status_code=409,
            code="invalid_payroll_workflow_transition",
        )

    run_id_string = safe_str(run_id)
    payslips = list(db.payslips.find({
        "tenant_id": tenant_id,
        "run_id": run_id_string,
        "is_deleted": {"$ne": True},
    }))

    expected_count = int(run.get("employee_count") or 0)
    if not payslips or len(payslips) != expected_count:
        raise PayrollConfigError(
            "Payroll run employee count does not match its active payslips. "
            "Resolve the data mismatch before approving this run.",
            status_code=409,
            code="payroll_payslip_count_mismatch",
        )

    mismatched = [
        safe_str(payslip.get("_id"))
        for payslip in payslips
        if _normalize_key(payslip.get("status") or "draft") != expected_status
    ]
    if mismatched:
        raise PayrollConfigError(
            "One or more payslips are not at the same workflow stage as the run.",
            status_code=409,
            code="payroll_payslip_status_mismatch",
        )

    note = safe_str(payload.get("note"))[:1000]
    now = _now()
    disbursement = payload.get("disbursement") or {}
    reimbursement_reservation: dict[str, Any] | None = None

    if action == "hr_review":
        reimbursement_reservation = _reserve_run_reimbursements(
            db,
            tenant_id=tenant_id,
            run=run,
            payslips=payslips,
        )

    if action == "disburse":
        if not isinstance(disbursement, dict):
            raise PayrollConfigError(
                "disbursement must be an object.",
                code="invalid_disbursement_payload",
            )

        transfer_date = safe_str(
            disbursement.get("transfer_date")
            or disbursement.get("transferDate")
        )
        transfer_mode = safe_str(
            disbursement.get("transfer_mode")
            or disbursement.get("transferMode")
        ).upper()

        if not transfer_date or not _date_only(transfer_date):
            raise PayrollConfigError(
                "A valid transfer_date in YYYY-MM-DD format is required for disbursement.",
                code="transfer_date_required",
            )
        if not transfer_mode:
            raise PayrollConfigError(
                "transfer_mode is required for disbursement.",
                code="transfer_mode_required",
            )

        disbursement = {
            "transfer_date": transfer_date,
            "transfer_mode": transfer_mode,
            "transaction_reference": safe_str(
                disbursement.get("transaction_reference")
                or disbursement.get("transactionReference")
            ),
            "bank_file_reference": safe_str(
                disbursement.get("bank_file_reference")
                or disbursement.get("bankFileReference")
            ),
            "disbursed_at": now,
            "disbursed_by": _current_user_id(),
            "disbursed_by_name": _current_user_name(),
        }

    history_entry = {
        "action": action,
        "from_status": expected_status,
        "to_status": next_status,
        "note": note,
        "actor_id": _current_user_id(),
        "actor_name": _current_user_name(),
        "actor_roles": sorted(_current_roles()),
        "at": now,
    }

    run_set: dict[str, Any] = {
        "status": next_status,
        "workflow_stage": next_status,
        "updated_at": now,
    }
    payslip_set: dict[str, Any] = {
        "status": next_status,
        "workflow_stage": next_status,
        "updated_at": now,
    }

    if action == "hr_review":
        run_set.update({
            "hr_reviewed_at": now,
            "hr_reviewed_by": _current_user_id(),
            "hr_reviewed_by_name": _current_user_name(),
            "reimbursement_reservation_summary": _snapshot(
                reimbursement_reservation or {}
            ),
            "reimbursements_reserved_at": now,
            "reimbursements_reserved_by": _current_user_id(),
        })
        payslip_set.update({
            "hr_reviewed_at": now,
            "hr_reviewed_by": _current_user_id(),
            "hr_reviewed_by_name": _current_user_name(),
        })
    elif action == "finance_approve":
        run_set.update({
            "finance_approved_at": now,
            "finance_approved_by": _current_user_id(),
            "finance_approved_by_name": _current_user_name(),
        })
        payslip_set.update({
            "finance_approved_at": now,
            "finance_approved_by": _current_user_id(),
            "finance_approved_by_name": _current_user_name(),
        })
    elif action == "lock":
        run_set.update({
            "is_locked": True,
            "locked_at": now,
            "locked_by": _current_user_id(),
            "locked_by_name": _current_user_name(),
        })
        payslip_set.update({
            "is_locked": True,
            "locked_at": now,
            "locked_by": _current_user_id(),
            "locked_by_name": _current_user_name(),
        })
    elif action == "disburse":
        run_set["disbursement"] = disbursement
        payslip_set["transfer_details"] = disbursement

    update_result = db.payroll_runs.update_one(
        {
            "_id": run_id,
            "tenant_id": tenant_id,
            "status": expected_status,
            "is_deleted": {"$ne": True},
        },
        {
            "$set": run_set,
            "$push": {"workflow_history": history_entry},
        },
    )

    if update_result.modified_count != 1:
        if action == "hr_review" and reimbursement_reservation:
            _release_run_reimbursements_after_failed_transition(
                db,
                tenant_id=tenant_id,
                run_id=run_id_string,
                reason="Released because the payroll HR-review transition failed.",
            )
        raise PayrollConfigError(
            "The payroll run changed while this action was being processed. Refresh and try again.",
            status_code=409,
            code="payroll_concurrent_workflow_update",
        )

    payslip_result = db.payslips.update_many(
        {
            "tenant_id": tenant_id,
            "run_id": run_id_string,
            "status": expected_status,
            "is_deleted": {"$ne": True},
        },
        {
            "$set": payslip_set,
            "$push": {"workflow_history": history_entry},
        },
    )

    if payslip_result.modified_count != expected_count:
        # Best-effort rollback protects the run and payslips from diverging.
        rollback_set = {
            "status": expected_status,
            "workflow_stage": expected_status,
            "updated_at": _now(),
        }
        if action == "lock":
            rollback_set["is_locked"] = False

        db.payroll_runs.update_one(
            {"_id": run_id, "tenant_id": tenant_id, "status": next_status},
            {
                "$set": rollback_set,
                "$pull": {
                    "workflow_history": {
                        "action": action,
                        "at": now,
                        "actor_id": _current_user_id(),
                    }
                },
                "$unset": {
                    key: ""
                    for key in run_set
                    if key not in {"status", "workflow_stage", "updated_at", "is_locked"}
                },
            },
        )
        db.payslips.update_many(
            {"tenant_id": tenant_id, "run_id": run_id_string, "status": next_status},
            {
                "$set": rollback_set,
                "$pull": {
                    "workflow_history": {
                        "action": action,
                        "at": now,
                        "actor_id": _current_user_id(),
                    }
                },
            },
        )

        if action == "hr_review" and reimbursement_reservation:
            _release_run_reimbursements_after_failed_transition(
                db,
                tenant_id=tenant_id,
                run_id=run_id_string,
                reason="Released because the payroll payslip workflow update was rolled back.",
            )

        raise PayrollConfigError(
            "The payroll workflow update could not be applied to every payslip and was rolled back.",
            status_code=409,
            code="payroll_workflow_update_rolled_back",
        )

    if action == "hr_review":
        recipient_ids = _notification_users_for_roles(
            db,
            tenant_id,
            PAYROLL_FINANCE_ROLES,
        )
        notification_title = "Payroll ready for Finance approval"
        notification_body = f"Payroll for {run.get('period_key')} has completed HR review."
    elif action == "finance_approve":
        recipient_ids = _notification_users_for_roles(
            db,
            tenant_id,
            PAYROLL_FINANCE_ROLES,
        )
        notification_title = "Payroll approved by Finance"
        notification_body = f"Payroll for {run.get('period_key')} is ready to be locked."
    elif action == "lock":
        recipient_ids = _employee_user_ids_for_run(db, tenant_id, run_id_string)
        notification_title = "Payslip available"
        notification_body = f"Your payslip for {run.get('period_key')} is now available."
    else:
        recipient_ids = _employee_user_ids_for_run(db, tenant_id, run_id_string)
        notification_title = "Salary disbursed"
        notification_body = f"Salary for {run.get('period_key')} has been marked as disbursed."

    _insert_notifications(
        db,
        tenant_id=tenant_id,
        user_ids=recipient_ids,
        title=notification_title,
        body=notification_body,
        meta={
            "run_id": run_id_string,
            "period_key": run.get("period_key"),
            "action": action,
            "status": next_status,
            "page": "payroll_runs",
        },
    )

    updated_run = db.payroll_runs.find_one({"_id": run_id})
    updated_payslips = list(db.payslips.find({
        "tenant_id": tenant_id,
        "run_id": run_id_string,
        "is_deleted": {"$ne": True},
    }).sort("employee_name", 1))

    loan_recovery: dict[str, Any] | None = None
    reimbursement_payment: dict[str, Any] | None = None

    if action == "disburse":
        try:
            loan_recovery = apply_payroll_recoveries(
                db,
                tenant_id=tenant_id,
                run_id=run_id_string,
                period_key=run.get("period_key"),
                payslips=updated_payslips,
                actor_id=_current_user_id(),
                actor_name=_current_user_name(),
            )
        except PayrollLoanError as exc:
            # Salary disbursement has already been recorded. Preserve that
            # completed workflow state and surface recovery issues for an
            # explicit retry instead of falsely rolling back a bank transfer.
            loan_recovery = {
                "run_id": run_id_string,
                "period_key": run.get("period_key"),
                "applied": [],
                "skipped": [],
                "failures": [{
                    "message": exc.message,
                    "code": exc.code,
                    "details": exc.details,
                }],
                "totals": {
                    "recoveries_applied": 0,
                    "recoveries_skipped": 0,
                    "recoveries_failed": 1,
                    "amount_recovered": 0,
                },
            }

        try:
            reimbursement_payment = apply_payroll_reimbursement_payments(
                db,
                tenant_id=tenant_id,
                run_id=run_id_string,
                period_key=run.get("period_key"),
                actor_id=_current_user_id(),
                actor_name=_current_user_name(),
            )
        except PayrollReimbursementError as exc:
            # The bank transfer workflow is already complete. Keep the salary
            # run disbursed and expose reimbursement failures for explicit retry.
            reimbursement_payment = {
                "run_id": run_id_string,
                "period_key": run.get("period_key"),
                "paid": [],
                "failures": [{
                    "message": exc.message,
                    "code": exc.code,
                    "details": exc.details,
                }],
                "totals": {
                    "paid": 0,
                    "failed": 1,
                    "amount_paid": 0,
                },
            }

        db.payroll_runs.update_one(
            {"_id": run_id, "tenant_id": tenant_id},
            {
                "$set": {
                    "loan_recovery_summary": _snapshot(loan_recovery),
                    "loan_recovery_applied_at": _now(),
                    "loan_recovery_applied_by": _current_user_id(),
                    "reimbursement_payment_summary": _snapshot(
                        reimbursement_payment
                    ),
                    "reimbursement_payment_applied_at": _now(),
                    "reimbursement_payment_applied_by": _current_user_id(),
                    "updated_at": _now(),
                }
            },
        )
        updated_run = db.payroll_runs.find_one({"_id": run_id})

    audit(
        f"payroll_run_{action}",
        "payroll_runs",
        run_id,
        {
            "tenant_id": tenant_id,
            "period_key": run.get("period_key"),
            "from_status": expected_status,
            "to_status": next_status,
            "employee_count": expected_count,
            "note": note,
        },
    )

    return _success(
        f"Payroll moved from {expected_status} to {next_status} successfully.",
        run=updated_run,
        payslips=updated_payslips,
        status=next_status,
        loan_recovery=loan_recovery,
        loan_recovery_requires_retry=bool(
            loan_recovery and (loan_recovery.get("failures") or [])
        ),
        reimbursement_reservation=reimbursement_reservation,
        reimbursement_payment=reimbursement_payment,
        reimbursement_payment_requires_retry=bool(
            reimbursement_payment
            and (reimbursement_payment.get("failures") or [])
        ),
    )


# ------------------------------- Payslip PDF -------------------------------


def _money(value: Any) -> str:
    amount = _number(value, 0)
    if abs(amount - round(amount)) < 0.000001:
        return f"₹ {int(round(amount)):,}"
    return f"₹ {amount:,.2f}"


def _plain_number(value: Any) -> str:
    amount = _number(value, 0)
    if abs(amount - round(amount)) < 0.000001:
        return f"{int(round(amount)):,}"
    return f"{amount:,.2f}"


def _indian_number_words(value: Any) -> str:
    number = int(round(_number(value, 0)))
    if number == 0:
        return "Zero"
    if number < 0:
        return "Minus " + _indian_number_words(abs(number))

    ones = [
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
        "Seventeen", "Eighteen", "Nineteen",
    ]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def below_thousand(amount: int) -> str:
        parts: list[str] = []
        if amount >= 100:
            parts.append(ones[amount // 100] + " Hundred")
            amount %= 100
        if amount >= 20:
            parts.append(tens[amount // 10])
            amount %= 10
        if amount:
            parts.append(ones[amount])
        return " ".join(parts)

    parts: list[str] = []
    crore, number = divmod(number, 10_000_000)
    lakh, number = divmod(number, 100_000)
    thousand, number = divmod(number, 1_000)

    if crore:
        parts.append(_indian_number_words(crore) + " Crore")
    if lakh:
        parts.append(below_thousand(lakh) + " Lakh")
    if thousand:
        parts.append(below_thousand(thousand) + " Thousand")
    if number:
        parts.append(below_thousand(number))

    return " ".join(parts).strip()


def _line_amount(lines: Any, *codes: str) -> float:
    normalized_codes = {_normalize_key(code) for code in codes}
    for line in lines or []:
        if _normalize_key((line or {}).get("code")) in normalized_codes:
            return _number((line or {}).get("amount"), 0)
    return 0


def _company_initials(name: str) -> str:
    ignored = {"pvt", "private", "limited", "ltd", "company", "services"}
    words = [
        word
        for word in safe_str(name).replace(".", " ").split()
        if word.lower() not in ignored
    ]
    initials = "".join(word[0].upper() for word in words[:4] if word)
    return initials or "YC"


def _format_address(value: Any) -> str:
    if isinstance(value, dict):
        parts = [
            safe_str(value.get(key))
            for key in ("line1", "line2", "city", "district", "state", "postal_code")
            if safe_str(value.get(key))
        ]
        return ", ".join(parts)
    return safe_str(value)


def _tenant_company(db: Any, tenant_id: str) -> dict[str, Any]:
    tenant = db.tenants.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }) or {}

    name = safe_str(
        tenant.get("company_name")
        or tenant.get("name")
        or ("SESTA DEVELOPMENT SERVICES (SDS)" if tenant_id == "sds" else tenant_id.upper())
    )
    address = _format_address(tenant.get("address"))

    if not address and tenant_id == "sds":
        address = "Guwahati, Dist.: Kamrup, Assam"

    logo_data_uri = safe_str(
        tenant.get("logo_data_uri")
        or tenant.get("company_logo_data_uri")
    )
    if not logo_data_uri.startswith("data:image/"):
        logo_data_uri = ""

    return {
        "name": name,
        "address": address,
        "initials": safe_str(tenant.get("tenant_code")) or _company_initials(name),
        "logo_data_uri": logo_data_uri,
    }


def _payslip_pdf_context(db: Any, payslip: Mapping[str, Any]) -> dict[str, Any]:
    employee = dict(payslip.get("employee_info") or {})
    attendance = dict(payslip.get("attendance") or {})
    totals = dict(payslip.get("totals") or {})
    earnings = list(payslip.get("earnings") or [])
    deductions = list(payslip.get("deductions") or [])
    advances = list(payslip.get("advance_details") or [])
    transfer = dict(payslip.get("transfer_details") or {})
    tenant_id = safe_str(payslip.get("tenant_id"))
    company = _tenant_company(db, tenant_id)

    month_number = int(payslip.get("month") or 0)
    year_number = int(payslip.get("year") or 0)
    month_name = calendar.month_name[month_number] if 1 <= month_number <= 12 else ""

    net_amount = totals.get("net_amount", 0)
    pf_employer = totals.get("pf_employer", _line_amount(earnings, "pf_employer"))

    earning_rows = [
        ("Basic", _line_amount(earnings, "basic")),
        ("HRA", _line_amount(earnings, "hra")),
        ("Medical Allowance", _line_amount(earnings, "medical_allowance", "medical")),
        ("Other Allowances", _line_amount(earnings, "other_allowances", "other_allowance")),
        ("Employer's Contribution towards PF", pf_employer),
    ]

    deduction_rows = [
        ("Tax Deducted at Source (TDS)", totals.get("tds", _line_amount(deductions, "tds"))),
        ("PF Contribution- Employee", totals.get("pf_employee", _line_amount(deductions, "pf_employee"))),
        ("PF Contribution- Employer", pf_employer),
        ("Deduction against Leave without pay", totals.get("lwp_deduction", _line_amount(deductions, "lwp_deduction"))),
        ("Professional Tax", totals.get("professional_tax", _line_amount(deductions, "professional_tax"))),
        ("Advances", totals.get("advances", 0)),
    ]

    advance_map = {
        _normalize_key(item.get("code") or item.get("label")): item
        for item in advances
    }

    def advance_row(label: str, *codes: str) -> dict[str, Any]:
        match = None
        for code in codes:
            match = advance_map.get(_normalize_key(code))
            if match:
                break
        match = match or {}
        return {
            "label": label,
            "date": safe_str(match.get("date")),
            "balance": match.get("remaining_balance", ""),
            "amount": match.get("advance_amount", ""),
            "deduction": match.get("deduction_amount", 0),
            "bills_received": safe_str(match.get("bills_received")),
            "pending": match.get(
                "remaining_balance_after_deduction",
                match.get("remaining_balance", ""),
            ),
        }

    return {
        "company": company,
        "month_name": month_name,
        "year": year_number,
        "employee": employee,
        "attendance": attendance,
        "earning_rows": earning_rows,
        "deduction_rows": deduction_rows,
        "totals": totals,
        "advance_rows": [
            advance_row("Work Advance", "work_advance", "work"),
            advance_row("Tour Advance", "tour_advance", "tour"),
            advance_row("Personal Advance", "personal_advance", "personal", "advance"),
        ],
        "transfer": transfer,
        "amount_words": f"Rupees {_indian_number_words(net_amount)} only",
        "net_amount": net_amount,
    }


PAYSLIP_HTML_TEMPLATE = r"""
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @page { size: Letter portrait; margin: 15mm 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #222; font-family: Arial, Helvetica, sans-serif; font-size: 10px; }
  .sheet { width: 100%; }
  .header { display: grid; grid-template-columns: 90px 1fr 90px; align-items: center; margin-bottom: 7px; }
  .logo-box { width: 76px; height: 56px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 20px; color: #1d4f2e; }
  .logo-box img { max-width: 76px; max-height: 56px; object-fit: contain; }
  .company { text-align: center; }
  .company h1 { margin: 0; font-size: 20px; letter-spacing: .2px; }
  .company p { margin: 2px 0 0; font-size: 10px; }
  .title { text-align: center; font-size: 13px; font-weight: 700; margin: 5px 0 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  td, th { border: 1px solid #b9b9b9; padding: 4px 5px; vertical-align: middle; }
  .info td { height: 24px; }
  .label { font-weight: 700; width: 19%; }
  .value { width: 31%; }
  .section-head { background: #fff18c; font-weight: 700; text-align: left; }
  .earnings th { background: #f0f0f0; text-align: left; font-size: 10px; }
  .earnings .amount { text-align: right; width: 14%; }
  .earnings .component { width: 36%; }
  .summary td { font-weight: 700; }
  .summary .number { text-align: right; }
  .net { font-size: 13px; font-weight: 800; text-align: center; background: #f8f8f8; }
  .advance th { background: #f0f0f0; font-size: 9px; }
  .advance td { height: 24px; }
  .right { text-align: right; }
  .center { text-align: center; }
  .muted { color: #666; }
  .transfer td { height: 25px; }
  .footer-note { background: #fff18c; border: 1px solid #b9b9b9; padding: 5px; font-size: 9px; margin-top: 7px; }
  .spacer { height: 5px; }
</style>
</head>
<body>
<div class="sheet">
  <div class="header">
    <div class="logo-box">
      {% if company.logo_data_uri %}<img src="{{ company.logo_data_uri }}" alt="Logo">{% else %}{{ company.initials }}{% endif %}
    </div>
    <div class="company">
      <h1>{{ company.name }}</h1>
      <p>{{ company.address }}</p>
    </div>
    <div></div>
  </div>

  <div class="title">Pay Slip for {{ month_name }} -{{ year }}</div>

  <table class="info">
    <tr><td class="label">Name</td><td class="value">{{ employee.name or '—' }}</td><td class="label">Permanent Account Number (PAN)</td><td class="value">{{ employee.pan or 'NA' }}</td></tr>
    <tr><td class="label">Employee Code</td><td>{{ employee.employee_code or '—' }}</td><td class="label">Universal Account Number (UAN)</td><td>{{ employee.uan or 'NA' }}</td></tr>
    <tr><td class="label">Function</td><td>{{ employee.function or employee.department or '—' }}</td><td class="label">ESI Number</td><td>{{ employee.esi_number or 'NA' }}</td></tr>
    <tr><td class="label">Designation</td><td>{{ employee.designation or '—' }}</td><td class="label">PR Account Number (PRAN)</td><td>{{ employee.pran or 'NA' }}</td></tr>
    <tr><td class="label">Location</td><td>{{ employee.location or '—' }}</td><td class="label">IFS Code</td><td>{{ employee.ifsc_code or '—' }}</td></tr>
    <tr><td class="label">Account No.</td><td>{{ employee.account_number or '—' }}</td><td class="label">Total Sanctioned Leave</td><td>{{ attendance.paid_leave_days or 0 }} Days</td></tr>
    <tr><td class="label">Date of joining</td><td>{{ employee.date_of_joining or '—' }}</td><td class="label">LWP (Leave Without Pay)</td><td>{{ attendance.lwp_days or 0 }} Days</td></tr>
    <tr><td class="label">Leave availed during this Month</td><td>{{ attendance.leave_availed or attendance.paid_leave_days or 0 }} Days</td><td class="label">No. of Days Salary Paid for</td><td>{{ attendance.payable_days or attendance.salary_paid_days or 0 }} Days</td></tr>
    <tr><td class="label">Leave Balance</td><td colspan="3">{{ attendance.leave_balance or 0 }} Days</td></tr>
  </table>

  <div class="spacer"></div>

  <table class="earnings">
    <thead><tr><th class="component">Earnings</th><th class="amount">Gross Salary</th><th class="component">Deductions</th><th class="amount">Amount</th></tr></thead>
    <tbody>
      {% for row_index in range(6) %}
      <tr>
        <td>{{ earning_rows[row_index][0] if row_index < earning_rows|length else '' }}</td>
        <td class="amount">{{ money(earning_rows[row_index][1]) if row_index < earning_rows|length else '' }}</td>
        <td>{{ deduction_rows[row_index][0] if row_index < deduction_rows|length else '' }}</td>
        <td class="amount">{{ money(deduction_rows[row_index][1]) if row_index < deduction_rows|length else '' }}</td>
      </tr>
      {% endfor %}
    </tbody>
    <tfoot>
      <tr class="summary"><td>Cost to Company</td><td class="number">{{ plain(totals.cost_to_company) }}</td><td>Total Deductions</td><td class="number">{{ plain(totals.total_deductions) }}</td></tr>
      <tr><td colspan="2"></td><td class="net">Net Amount</td><td class="net">{{ plain(net_amount) }}</td></tr>
    </tfoot>
  </table>

  <div class="spacer"></div>
  <table class="advance">
    <tr><th class="section-head" colspan="7">Advance Details</th></tr>
    <tr><th>Advance Type</th><th>Date</th><th>Balance Advance Amount</th><th>Deduction Amount</th><th>Bills Received (Yes/No)</th><th>Pending/balance Amount</th><th>Remarks</th></tr>
    {% for row in advance_rows %}
    <tr><td>{{ row.label }}</td><td>{{ row.date }}</td><td class="right">{{ plain(row.balance) if row.balance != '' else '' }}</td><td class="right">{{ plain(row.deduction) }}</td><td class="center">{{ row.bills_received }}</td><td class="right">{{ plain(row.pending) if row.pending != '' else '' }}</td><td></td></tr>
    {% endfor %}
    <tr><td colspan="3"><strong>Total Advance Amount</strong></td><td class="right"><strong>{{ plain(totals.advances) }}</strong></td><td colspan="3"></td></tr>
  </table>

  <div class="spacer"></div>
  <table class="transfer">
    <tr><td class="label">Total Amount Transferred</td><td><strong>{{ money(net_amount) }}</strong></td></tr>
    <tr><td class="label">Amount (in words)</td><td>{{ amount_words }}</td></tr>
    <tr><td class="label">Transfer Date</td><td>{{ transfer.transfer_date or '—' }}{% if transfer.transfer_mode %}&nbsp;&nbsp;&nbsp;{{ transfer.transfer_mode }}{% endif %}</td></tr>
  </table>

  <div class="footer-note">*This is a computer generated slip &amp; does not require any signature</div>
</div>
</body>
</html>
"""


def _render_payslip_html(context: Mapping[str, Any]) -> str:
    environment = Environment(autoescape=True)
    environment.globals["money"] = _money
    environment.globals["plain"] = _plain_number
    return environment.from_string(PAYSLIP_HTML_TEMPLATE).render(**context)


def _current_employee_for_user(db: Any, tenant_id: str) -> dict[str, Any] | None:
    user_id = _current_user_id()
    user_email = safe_str(_current_user().get("email")).lower()

    query_filters: list[dict[str, Any]] = [{"user_id": user_id}]
    if user_email:
        query_filters.extend([
            {"official_email": user_email},
            {"email": user_email},
        ])

    return db.employees.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": query_filters,
    })


@payroll_bp.get("/payslip/<employee_reference>/<int:month>/<int:year>")
@tenant_module_required("payroll")
@roles_required(
    "super_admin",
    "admin",
    "hr",
    "hr_admin",
    "hr_manager",
    "finance",
    "accounts_finance",
    "employee",
    "team_leader",
    "reporting_officer",
)
def generate_or_fetch_payslip_pdf(employee_reference: str, month: int, year: int):
    db = get_db()
    tenant_id = _requested_tenant_id()

    if month < 1 or month > 12 or year < 2000 or year > 2200:
        raise PayrollConfigError(
            "A valid payroll month and year are required.",
            code="invalid_payslip_period",
        )

    employee, employee_id = _resolve_employee_for_read(
        db,
        tenant_id,
        employee_reference,
    )

    roles = _current_roles()
    privileged = bool(roles.intersection(PAYROLL_PRIVILEGED_READ_ROLES))

    if not privileged:
        current_employee = _current_employee_for_user(db, tenant_id)
        if not current_employee or _canonical_employee_id(current_employee) != employee_id:
            raise PayrollConfigError(
                "Employees can download only their own payslip.",
                status_code=403,
                code="employee_payslip_scope_forbidden",
            )

    period_key = f"{year:04d}-{month:02d}"
    payslip = db.payslips.find_one(
        {
            "tenant_id": tenant_id,
            "employee_id": employee_id,
            "period_key": period_key,
            "is_deleted": {"$ne": True},
        },
        sort=[("generated_at", -1), ("created_at", -1)],
    )

    if not payslip:
        raise PayrollConfigError(
            "Payslip not found for the selected employee and payroll month.",
            status_code=404,
            code="payslip_not_found",
        )

    status = _normalize_key(payslip.get("status"))
    if not privileged and status not in {"locked", "disbursed"}:
        raise PayrollConfigError(
            "This payslip is not available to the employee until payroll is locked.",
            status_code=403,
            code="payslip_not_released",
        )

    required_snapshot_fields = {
        "employee_info",
        "attendance",
        "earnings",
        "deductions",
        "totals",
    }
    if not required_snapshot_fields.issubset(payslip):
        raise PayrollConfigError(
            "This legacy payslip does not contain the immutable calculation snapshots "
            "required for PDF generation. Recalculate the Draft payroll first.",
            status_code=409,
            code="legacy_payslip_snapshot_missing",
        )

    context = _payslip_pdf_context(db, payslip)
    html = _render_payslip_html(context)

    try:
        from weasyprint import HTML

        pdf_bytes = HTML(
            string=html,
            base_url=request.host_url,
        ).write_pdf()
    except ImportError as exc:
        raise PayrollConfigError(
            "WeasyPrint is not installed on the backend server.",
            status_code=500,
            code="weasyprint_not_installed",
        ) from exc
    except OSError as exc:
        raise PayrollConfigError(
            "WeasyPrint native rendering libraries are unavailable on the backend server.",
            status_code=500,
            code="weasyprint_native_libraries_unavailable",
        ) from exc
    except Exception as exc:
        raise PayrollConfigError(
            f"Payslip PDF generation failed: {safe_str(exc)}",
            status_code=500,
            code="payslip_pdf_generation_failed",
        ) from exc

    now = _now()
    db.payslips.update_one(
        {"_id": payslip["_id"]},
        {
            "$set": {
                "pdf_generated_at": now,
                "pdf_generated_by": _current_user_id(),
                "pdf_generated_by_name": _current_user_name(),
                "updated_at": now,
            },
            "$inc": {"pdf_generation_count": 1},
        },
    )

    audit(
        "payroll_payslip_pdf_generated",
        "payslips",
        payslip.get("_id"),
        {
            "tenant_id": tenant_id,
            "employee_id": employee_id,
            "employee_code": _employee_code(employee),
            "period_key": period_key,
            "status": status,
        },
    )

    employee_code = _employee_code(employee) or employee_id[-8:]
    safe_code = "".join(
        character if character.isalnum() or character in {"-", "_"} else "_"
        for character in employee_code
    )
    filename = f"payslip_{safe_code}_{period_key}.pdf"
    download = _normalize_key(request.args.get("download")) not in {"0", "false", "no", "preview", "inline"}
    disposition = "attachment" if download else "inline"

    return Response(
        pdf_bytes,
        status=200,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "private, no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
        },
    )
