"""
Saya Finance + Payroll action plugin.

This module is auto-discovered by app.services.ai_action_service.
It centralises the currently planned Finance/Payroll assistant capabilities in
one file. Saya may understand a request here, but authority always comes from
verified tenant/role context and the existing payroll business services/routes.

High-impact payroll-run transitions deliberately reuse the canonical payroll
route body rather than reimplementing payroll locking/disbursement rules. Saya
collects the request, requires explicit confirmation, and then invokes the same
business workflow used by the normal Payroll screen.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime
import calendar
import inspect
import re
from typing import Any, Iterable, Mapping

from bson import ObjectId
from flask import current_app, g

from app.extensions import get_db
from app.services.ai_action_service import (
    register_saya_action,
    save_pending_action,
    clear_pending_action,
)
from app.services.payroll_attendance_service import (
    PayrollAttendanceError,
    sync_attendance_summaries,
)
from app.services.payroll_bank_service import (
    PayrollBankError,
    list_bank_details,
    verify_bank_details,
)
from app.services.payroll_loan_service import (
    PayrollLoanError,
    approve_loan_advance,
    reject_loan_advance,
    disburse_loan_advance,
    list_loan_advances,
)
from app.services.payroll_reimbursement_service import (
    PayrollReimbursementError,
    complete_hr_review as complete_reimbursement_hr_review,
    approve_reimbursement,
    reject_reimbursement,
    list_reimbursements,
)
from app.services.payroll_reporting_service import (
    PayrollReportingError,
    payroll_summary,
    statutory_summary,
    period_variance,
    payroll_trend,
)
from app.services.payroll_tax_service import (
    PayrollTaxError,
    complete_tax_hr_review,
    approve_tax_declaration,
    reject_tax_declaration,
    lock_tax_declaration,
    list_tax_declarations,
    list_tds_instructions,
    activate_tds_instruction,
    deactivate_tds_instruction,
)


# Keep role boundaries aligned with app.routes.payroll.
HR_ROLES = {"super_admin", "admin", "hr", "hr_admin", "hr_manager"}
FINANCE_ROLES = {"super_admin", "admin", "finance", "accounts_finance"}
PAYROLL_MANAGEMENT_ROLES = HR_ROLES | FINANCE_ROLES
PAYROLL_READ_ROLES = set(PAYROLL_MANAGEMENT_ROLES)
PAYROLL_HR_WORKFLOW_ROLES = {"super_admin", "hr", "hr_admin", "hr_manager"}
PAYROLL_FINANCE_WORKFLOW_ROLES = {"super_admin", "finance", "accounts_finance"}

DISPLAY_LIMIT = 12
READ_LIMIT = 250

MONTHS = {
    name.lower(): index
    for index, name in enumerate(calendar.month_name)
    if name
}
MONTHS.update({
    name.lower(): index
    for index, name in enumerate(calendar.month_abbr)
    if name
})

PAYROLL_STATUS_ORDER = {
    "draft": 10,
    "hr_reviewed": 20,
    "finance_approved": 30,
    "locked": 40,
    "disbursed": 50,
}
PAYROLL_STATUS_LABELS = {
    "draft": "Draft / Pending HR Review",
    "hr_reviewed": "HR Reviewed / Pending Finance Approval",
    "finance_approved": "Finance Approved / Ready to Lock",
    "locked": "Locked / Payslips Released",
    "disbursed": "Disbursed",
}


# ---------------------------------------------------------------------------
# Common helpers
# ---------------------------------------------------------------------------


def _text(value: Any) -> str:
    return str(value or "").strip()


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", _text(value).lower()).strip()


def _role_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", _text(value).lower()).strip("_")


def _roles(user_context=None) -> set[str]:
    context = user_context or {}
    raw = context.get("roles") or []
    if isinstance(raw, str):
        raw = [item.strip() for item in raw.split(",") if item.strip()]
    output = {_role_key(item) for item in raw if _role_key(item)}
    role = _role_key(context.get("role"))
    if role:
        output.add(role)
    return output


def _tenant_id(user_context=None) -> str:
    return _text((user_context or {}).get("tenant_id"))


def _actor_id(user_context=None) -> str:
    context = user_context or {}
    return _text(context.get("user_id") or context.get("_id"))


def _actor_name(user_context=None) -> str:
    context = user_context or {}
    return _text(
        context.get("display_name")
        or context.get("employee_name")
        or context.get("name")
        or context.get("email")
        or "Saya Payroll User"
    )


def _employee_id(user_context=None) -> str:
    context = user_context or {}
    employee = context.get("employee") or {}
    if not isinstance(employee, dict):
        employee = {}
    return _text(
        context.get("employee_id")
        or employee.get("_id")
        or employee.get("employee_id")
    )


def _yes(value: Any) -> bool:
    return _norm(value) in {
        "yes", "y", "confirm", "confirmed", "proceed", "go ahead",
        "do it", "yes proceed", "yes confirm", "continue", "submit",
    }


def _no(value: Any) -> bool:
    return _norm(value) in {
        "no", "n", "cancel", "stop", "do not", "don't", "dont", "abort",
    }


def _skip(value: Any) -> bool:
    return _norm(value) in {
        "skip", "none", "default", "no note", "no notes", "n/a", "na",
    }


def _safe_error(exc: Exception, default: str = "I could not complete that payroll action. Please try again.") -> str:
    for cls in (
        PayrollAttendanceError,
        PayrollBankError,
        PayrollLoanError,
        PayrollReimbursementError,
        PayrollReportingError,
        PayrollTaxError,
    ):
        if isinstance(exc, cls):
            return _text(getattr(exc, "message", "")) or default

    text = _text(exc)
    blocked = (
        "traceback", "mongodb", "pymongo", "objectid", "duplicate key",
        "localhost", "connection refused", "server selection", "stack trace",
    )
    if any(item in text.lower() for item in blocked):
        return default
    return text[:500] or default


def _oid(value: Any):
    try:
        text = _text(value)
        return ObjectId(text) if ObjectId.is_valid(text) else None
    except Exception:
        return None


def _money(value: Any) -> str:
    try:
        amount = float(value or 0)
    except Exception:
        amount = 0.0
    return f"₹{amount:,.2f}"


def _date_text(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y")
    if isinstance(value, date):
        return value.strftime("%d %b %Y")
    return _text(value)


def _management_access(user_context=None):
    if not _tenant_id(user_context):
        return "I cannot verify your organisation context. Please sign in again and retry."
    if not _actor_id(user_context):
        return "I cannot verify your signed-in user identity. Please sign in again and retry."
    if not _roles(user_context).intersection(PAYROLL_MANAGEMENT_ROLES):
        return "This Payroll function is available only to authorised HR, Finance, or company administrators."
    return ""


def _hr_access(user_context=None):
    if not _tenant_id(user_context) or not _actor_id(user_context):
        return "I cannot verify your organisation and user context. Please sign in again and retry."
    if not _roles(user_context).intersection(HR_ROLES):
        return "This payroll action requires an authorised HR role."
    return ""


def _finance_access(user_context=None):
    if not _tenant_id(user_context) or not _actor_id(user_context):
        return "I cannot verify your organisation and user context. Please sign in again and retry."
    if not _roles(user_context).intersection(FINANCE_ROLES):
        return "This payroll action requires an authorised Finance or company administrator role."
    return ""


def _payroll_hr_workflow_access(user_context=None):
    if not _tenant_id(user_context) or not _actor_id(user_context):
        return "I cannot verify your organisation and user context. Please sign in again and retry."
    if not _roles(user_context).intersection(PAYROLL_HR_WORKFLOW_ROLES):
        return "Completing Payroll HR Review requires an authorised HR role."
    return ""


def _payroll_finance_workflow_access(user_context=None):
    if not _tenant_id(user_context) or not _actor_id(user_context):
        return "I cannot verify your organisation and user context. Please sign in again and retry."
    if not _roles(user_context).intersection(PAYROLL_FINANCE_WORKFLOW_ROLES):
        return "This payroll workflow transition requires an authorised Finance role."
    return ""


def _period_from_text(value: Any, *, default_current: bool = False) -> str:
    raw = _norm(value)
    today = date.today()

    if not raw:
        return f"{today.year:04d}-{today.month:02d}" if default_current else ""

    match = re.search(r"\b((?:20|21|22)\d{2})[-/](0?[1-9]|1[0-2])\b", raw)
    if match:
        return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}"

    if "this month" in raw or "current month" in raw:
        return f"{today.year:04d}-{today.month:02d}"

    if "last month" in raw or "previous month" in raw:
        year, month = today.year, today.month - 1
        if month <= 0:
            month = 12
            year -= 1
        return f"{year:04d}-{month:02d}"

    for label, month in sorted(MONTHS.items(), key=lambda item: len(item[0]), reverse=True):
        if re.search(rf"\b{re.escape(label)}\b", raw):
            year_match = re.search(r"\b((?:20|21|22)\d{2})\b", raw)
            year = int(year_match.group(1)) if year_match else today.year
            return f"{year:04d}-{month:02d}"

    return ""


def _financial_year_from_text(value: Any) -> str:
    raw = _norm(value)
    match = re.search(r"\b((?:20|21|22)\d{2})\s*[-/]\s*((?:20|21|22)\d{2})\b", raw)
    if match:
        return f"{match.group(1)}-{match.group(2)}"

    today = date.today()
    start_year = today.year if today.month >= 4 else today.year - 1
    if "current financial year" in raw or "this financial year" in raw or "current fy" in raw:
        return f"{start_year}-{start_year + 1}"
    return ""


def _period_label(period: str) -> str:
    try:
        year, month = [int(item) for item in period.split("-")]
        return f"{calendar.month_name[month]} {year}"
    except Exception:
        return period or "the selected period"


def _canonical_status(value: Any) -> str:
    status = _role_key(value or "draft")
    aliases = {
        "pending_hr_review": "draft",
        "hr_review_pending": "draft",
        "reviewed": "hr_reviewed",
        "pending_finance_approval": "hr_reviewed",
        "finance_approval_pending": "hr_reviewed",
        "approved": "finance_approved",
    }
    return aliases.get(status, status)


def _find_run(db, tenant_id: str, *, period: str = "", run_reference: str = ""):
    query: dict[str, Any] = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }
    if run_reference:
        oid = _oid(run_reference)
        options = [
            {"run_id": run_reference},
            {"run_code": run_reference},
            {"code": run_reference},
        ]
        if oid:
            options.insert(0, {"_id": oid})
        query["$or"] = options
    elif period:
        query["period_key"] = period

    return db.payroll_runs.find_one(
        query,
        sort=[
            ("updated_at", -1),
            ("created_at", -1),
            ("_id", -1),
        ],
    )


def _run_reference(run: Mapping[str, Any] | None) -> str:
    run = run or {}
    return _text(run.get("_id") or run.get("run_id") or run.get("run_code"))


def _run_label(run: Mapping[str, Any] | None) -> str:
    run = run or {}
    period = _text(run.get("period_key"))
    code = _text(run.get("run_code") or run.get("code"))
    if period and code:
        return f"{_period_label(period)} ({code})"
    return _period_label(period) if period else (code or "Payroll run")


def _employee_name(record: Mapping[str, Any] | None) -> str:
    record = record or {}
    return _text(
        record.get("employee_name")
        or record.get("name")
        or record.get("full_name")
        or record.get("display_name")
        or record.get("employee_code")
        or record.get("employee_id")
    )


def _pending_result(answer: str, **extra):
    return {"handled": True, "answer": answer, **extra}


# ---------------------------------------------------------------------------
# Canonical payroll-route adapter
# ---------------------------------------------------------------------------


def _unwrap_view(func):
    target = func
    seen = set()
    while hasattr(target, "__wrapped__") and id(target) not in seen:
        seen.add(id(target))
        target = target.__wrapped__
    return target


def _parse_flask_result(result):
    status_code = 200
    response = result
    if isinstance(result, tuple):
        response = result[0]
        if len(result) > 1 and isinstance(result[1], int):
            status_code = result[1]

    payload = None
    if hasattr(response, "get_json"):
        try:
            payload = response.get_json(silent=True)
        except TypeError:
            payload = response.get_json()
    if payload is None and isinstance(response, dict):
        payload = response
    return payload or {}, status_code


def _call_canonical_payroll_view(view_name: str, path: str, payload: dict[str, Any], user_context=None):
    """Invoke the existing payroll route body with a synthetic request payload.

    We intentionally unwrap only Flask decorators here because this plugin has
    already passed the core Saya module/tenant/role checks. The route body still
    executes all payroll business validation, workflow transitions, snapshots,
    audit entries, rollback protection, and notifications.
    """

    from app.routes import payroll as payroll_routes

    view = getattr(payroll_routes, view_name, None)
    if not callable(view):
        raise RuntimeError("The canonical Payroll workflow is unavailable in this deployment.")

    app = current_app._get_current_object()
    tenant_id = _tenant_id(user_context)

    # g belongs to the active app context. Preserve relevant values because the
    # nested request swaps request data but shares the same Flask application.
    previous = {
        "current_user": getattr(g, "current_user", None),
        "tenant_id": getattr(g, "tenant_id", None),
        "current_tenant": getattr(g, "current_tenant", None),
        "subscription": getattr(g, "subscription", None),
    }

    route_user = dict(previous.get("current_user") or {})
    route_user.setdefault("_id", _actor_id(user_context))
    route_user.setdefault("id", _actor_id(user_context))
    route_user.setdefault("tenant_id", tenant_id)
    route_user.setdefault("name", _actor_name(user_context))
    route_user.setdefault("role", (user_context or {}).get("role"))
    route_user["roles"] = sorted(_roles(user_context))

    body = dict(payload or {})
    body["tenant_id"] = tenant_id

    try:
        with app.test_request_context(path, method="POST", json=body):
            g.current_user = route_user
            g.tenant_id = tenant_id
            if (user_context or {}).get("tenant"):
                g.current_tenant = (user_context or {}).get("tenant")
            if (user_context or {}).get("subscription"):
                g.subscription = (user_context or {}).get("subscription")

            result = _unwrap_view(view)()
            payload_out, status_code = _parse_flask_result(result)
            if status_code >= 400 or payload_out.get("ok") is False or payload_out.get("success") is False:
                raise RuntimeError(
                    _text(payload_out.get("message") or payload_out.get("error"))
                    or "The Payroll workflow rejected this request."
                )
            return payload_out
    finally:
        for key, value in previous.items():
            try:
                setattr(g, key, value)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Finance/Payroll read intelligence
# ---------------------------------------------------------------------------


def _overview_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)

    tenant_id = _tenant_id(user_context)
    period = _period_from_text(question)
    db = get_db()

    run = _find_run(db, tenant_id, period=period) if period else _find_run(db, tenant_id)
    if not run:
        target = f" for {_period_label(period)}" if period else ""
        return _pending_result(f"I could not find an accessible payroll run{target} for this organisation.")

    run_id = _run_reference(run)
    payslips = list(db.payslips.find({
        "tenant_id": tenant_id,
        "run_id": run_id,
        "is_deleted": {"$ne": True},
    }).limit(5000))

    status = _canonical_status(run.get("status") or run.get("workflow_stage"))
    totals = run.get("totals") or {}
    employee_count = int(run.get("employee_count") or len(payslips) or 0)
    payslip_statuses = Counter(_canonical_status(item.get("status") or item.get("workflow_stage")) for item in payslips)

    lines = [
        f"Payroll status for {_run_label(run)}:",
        f"• Workflow stage: {PAYROLL_STATUS_LABELS.get(status, status.replace('_', ' ').title())}",
        f"• Employees in run: {employee_count}",
    ]
    if totals:
        gross = totals.get("payable_gross_salary") or totals.get("gross_salary") or totals.get("gross")
        deductions = totals.get("total_deductions") or totals.get("deductions")
        net = totals.get("net_amount") or totals.get("net_pay") or totals.get("net")
        if gross is not None:
            lines.append(f"• Payable gross: {_money(gross)}")
        if deductions is not None:
            lines.append(f"• Total deductions: {_money(deductions)}")
        if net is not None:
            lines.append(f"• Net payroll: {_money(net)}")
    if payslip_statuses:
        stage_text = ", ".join(
            f"{PAYROLL_STATUS_LABELS.get(key, key.replace('_', ' ').title())}: {count}"
            for key, count in sorted(payslip_statuses.items(), key=lambda item: PAYROLL_STATUS_ORDER.get(item[0], 99))
        )
        lines.append(f"• Payslip stages: {stage_text}")

    if status == "draft":
        lines.append("Next workflow step: HR Review.")
    elif status == "hr_reviewed":
        lines.append("Next workflow step: Finance Approval.")
    elif status == "finance_approved":
        lines.append("Next workflow step: Lock the payroll after bank validation.")
    elif status == "locked":
        lines.append("Next workflow step: mark salary disbursement after the bank transfer is completed and a reference is available.")
    else:
        lines.append("This payroll run is already marked Disbursed.")

    return _pending_result("\n".join(lines))


def _exceptions_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)

    tenant_id = _tenant_id(user_context)
    period = _period_from_text(question, default_current=True)
    db = get_db()
    run = _find_run(db, tenant_id, period=period)

    issues: list[str] = []
    if not run:
        issues.append(f"No payroll run exists for {_period_label(period)}.")
    else:
        run_id = _run_reference(run)
        payslips = list(db.payslips.find({
            "tenant_id": tenant_id,
            "run_id": run_id,
            "is_deleted": {"$ne": True},
        }).limit(5000))
        expected = int(run.get("employee_count") or 0)
        if expected and len(payslips) != expected:
            issues.append(f"Payroll run/payslip count mismatch: run expects {expected}, but {len(payslips)} active payslips were found.")

        run_status = _canonical_status(run.get("status") or run.get("workflow_stage"))
        mismatched = [
            item for item in payslips
            if _canonical_status(item.get("status") or item.get("workflow_stage")) != run_status
        ]
        if mismatched:
            issues.append(f"{len(mismatched)} payslip(s) are at a different workflow stage from the payroll run.")

        if run.get("configuration_missing"):
            issues.append(f"{len(run.get('configuration_missing') or [])} employee configuration issue(s) were recorded during calculation.")

        loan_failures = ((run.get("loan_recovery_summary") or {}).get("failures") or [])
        if loan_failures:
            issues.append(f"{len(loan_failures)} loan/advance recovery failure(s) require review.")

        reimbursement_failures = ((run.get("reimbursement_payment_summary") or {}).get("failures") or [])
        if reimbursement_failures:
            issues.append(f"{len(reimbursement_failures)} reimbursement payment failure(s) require review.")

    # Bank readiness is a separate pre-lock risk.
    bank_rows = list_bank_details(
        db,
        tenant_id=tenant_id,
        verification_statuses=["pending_verification", "rejected"],
        limit=READ_LIMIT,
    )
    if bank_rows:
        pending = sum(1 for row in bank_rows if _role_key(row.get("verification_status")) == "pending_verification")
        rejected = sum(1 for row in bank_rows if _role_key(row.get("verification_status")) == "rejected")
        parts = []
        if pending:
            parts.append(f"{pending} pending bank verification")
        if rejected:
            parts.append(f"{rejected} rejected bank detail")
        issues.append("Bank readiness: " + ", ".join(parts) + ".")

    if not issues:
        return _pending_result(f"I did not find a recorded payroll exception for {_period_label(period)} in the accessible data.")

    return _pending_result(
        f"Payroll exceptions for {_period_label(period)}:\n" +
        "\n".join(f"• {item}" for item in issues[:DISPLAY_LIMIT])
    )


def _missing_bank_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)

    tenant_id = _tenant_id(user_context)
    db = get_db()
    employees = list(db.employees.find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$nin": ["resigned", "terminated", "inactive", "deleted"]},
    }, {
        "employee_name": 1, "name": 1, "full_name": 1,
        "employee_code": 1, "emp_code": 1,
    }).limit(3000))

    bank_rows = list_bank_details(db, tenant_id=tenant_id, include_inactive=False, limit=3000)
    by_employee = {_text(item.get("employee_id")): item for item in bank_rows if _text(item.get("employee_id"))}

    missing = []
    unverified = []
    for employee in employees:
        employee_id = _text(employee.get("_id"))
        bank = by_employee.get(employee_id)
        if not bank:
            missing.append(employee)
        elif _role_key(bank.get("verification_status")) != "verified":
            unverified.append((employee, bank))

    lines = [
        "Payroll bank-readiness check:",
        f"• Active employees checked: {len(employees)}",
        f"• Missing active bank details: {len(missing)}",
        f"• Bank details not verified: {len(unverified)}",
    ]
    for employee in missing[:6]:
        code = _text(employee.get("employee_code") or employee.get("emp_code"))
        lines.append(f"  - Missing: {_employee_name(employee)}" + (f" ({code})" if code else ""))
    for employee, bank in unverified[:6]:
        code = _text(employee.get("employee_code") or employee.get("emp_code"))
        state = _role_key(bank.get("verification_status")).replace("_", " ").title()
        lines.append(f"  - {state}: {_employee_name(employee)}" + (f" ({code})" if code else ""))

    if len(missing) + len(unverified) > 12:
        lines.append(f"• Additional records not shown here: {len(missing) + len(unverified) - 12}")
    return _pending_result("\n".join(lines))


def _reimbursement_queue_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)
    roles = _roles(user_context)
    statuses = ["pending_hr_review"] if roles.intersection(HR_ROLES - {"admin", "super_admin"}) else ["pending_finance_approval"] if roles.intersection(FINANCE_ROLES - {"admin", "super_admin"}) else ["pending_hr_review", "pending_finance_approval"]
    rows = list_reimbursements(get_db(), tenant_id=_tenant_id(user_context), statuses=statuses, limit=READ_LIMIT)
    if not rows:
        return _pending_result("There are no accessible reimbursement requests waiting for review in your current workflow scope.")
    lines = [f"Reimbursement review queue: {len(rows)} request(s)."]
    for row in rows[:DISPLAY_LIMIT]:
        lines.append(
            f"• {_employee_name(row)} — {_text(row.get('label') or row.get('type')).replace('_', ' ').title()} — "
            f"{_money(row.get('claimed_amount') or row.get('amount'))} — {_text(row.get('status')).replace('_', ' ').title()}"
        )
    return _pending_result("\n".join(lines))


def _loan_queue_start(question, user_context=None):
    error = _finance_access(user_context)
    if error:
        return _pending_result(error)
    rows = list_loan_advances(get_db(), tenant_id=_tenant_id(user_context), statuses=["pending_approval", "approved"], limit=READ_LIMIT)
    if not rows:
        return _pending_result("There are no accessible loan/advance requests waiting for Finance action.")
    lines = [f"Loan/advance Finance queue: {len(rows)} request(s)."]
    for row in rows[:DISPLAY_LIMIT]:
        lines.append(
            f"• {_employee_name(row)} — {_text(row.get('label') or row.get('type')).replace('_', ' ').title()} — "
            f"requested {_money(row.get('requested_amount') or row.get('amount'))} — {_text(row.get('status')).replace('_', ' ').title()}"
        )
    return _pending_result("\n".join(lines))


def _tax_queue_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)
    roles = _roles(user_context)
    statuses = ["pending_hr_review", "submitted"] if roles.intersection(HR_ROLES - {"admin", "super_admin"}) else ["pending_finance_approval"] if roles.intersection(FINANCE_ROLES - {"admin", "super_admin"}) else ["submitted", "pending_hr_review", "pending_finance_approval"]
    rows = list_tax_declarations(get_db(), tenant_id=_tenant_id(user_context), statuses=statuses, limit=READ_LIMIT)
    if not rows:
        return _pending_result("There are no accessible employee tax declarations waiting for review.")
    lines = [f"Tax declaration review queue: {len(rows)} declaration(s)."]
    for row in rows[:DISPLAY_LIMIT]:
        lines.append(
            f"• {_employee_name(row)} — FY {_text(row.get('financial_year'))} — "
            f"{_text(row.get('tax_regime')).replace('_', ' ').title()} regime — {_text(row.get('status')).replace('_', ' ').title()}"
        )
    return _pending_result("\n".join(lines))


def _summary_report_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)
    period = _period_from_text(question, default_current=True)
    report = payroll_summary(
        get_db(), tenant_id=_tenant_id(user_context), period_key=period,
        official_only=False, limit=10000,
    )
    rows = report.get("rows") or []
    if not rows:
        return _pending_result(f"No payroll report rows are available for {_period_label(period)}.")
    row = rows[-1]
    return _pending_result(
        f"Payroll summary for {_period_label(period)}:\n"
        f"• Employees: {row.get('employee_count') or 0}\n"
        f"• Payable gross: {_money(row.get('payable_gross_salary'))}\n"
        f"• Deductions: {_money(row.get('total_deductions'))}\n"
        f"• Net pay: {_money(row.get('net_amount'))}\n"
        f"• Cost to company: {_money(row.get('cost_to_company'))}\n"
        f"• Status mix: {', '.join(f'{k.replace('_', ' ').title()} {v}' for k, v in (row.get('status_counts') or {}).items()) or 'No status rows'}"
    )


def _statutory_report_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)
    period = _period_from_text(question, default_current=True)
    report = statutory_summary(
        get_db(), tenant_id=_tenant_id(user_context), period_key=period,
        official_only=False, limit=10000,
    )
    totals = report.get("totals") or {}
    return _pending_result(
        f"Statutory payroll summary for {_period_label(period)}:\n"
        f"• Employee PF: {_money(totals.get('pf_employee'))}\n"
        f"• Employer PF: {_money(totals.get('pf_employer'))}\n"
        f"• Employee ESI: {_money(totals.get('esi_employee'))}\n"
        f"• Employer ESI: {_money(totals.get('esi_employer'))}\n"
        f"• Professional Tax: {_money(totals.get('professional_tax'))}\n"
        f"• TDS: {_money(totals.get('tds'))}"
    )


def _variance_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)
    periods = re.findall(r"\b(?:20|21|22)\d{2}[-/](?:0?[1-9]|1[0-2])\b", _norm(question))
    normalized = [_period_from_text(item) for item in periods]
    normalized = [item for item in normalized if item]
    if len(normalized) < 2:
        return _pending_result("Please provide the two payroll periods to compare, for example: Compare payroll 2026-07 and 2026-08.")
    report = period_variance(
        get_db(), tenant_id=_tenant_id(user_context),
        base_period=normalized[0], comparison_period=normalized[1], official_only=False,
    )
    rows = report.get("rows") or []
    significant = sorted(rows, key=lambda item: abs(float(item.get("net_amount_variance") or 0)), reverse=True)
    lines = [
        f"Payroll variance: {_period_label(normalized[0])} → {_period_label(normalized[1])}",
        f"• Employees compared: {len(rows)}",
    ]
    for row in significant[:8]:
        lines.append(
            f"• {_employee_name(row)}: net variance {_money(row.get('net_amount_variance'))} "
            f"({row.get('net_amount_variance_percent') or 0}%)"
        )
    return _pending_result("\n".join(lines))


def _trend_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)
    periods = re.findall(r"\b(?:20|21|22)\d{2}[-/](?:0?[1-9]|1[0-2])\b", _norm(question))
    normalized = [_period_from_text(item) for item in periods]
    normalized = [item for item in normalized if item]
    if len(normalized) >= 2:
        start_period, end_period = normalized[0], normalized[1]
    else:
        today = date.today()
        end_period = f"{today.year:04d}-{today.month:02d}"
        start_month = today.month - 5
        start_year = today.year
        while start_month <= 0:
            start_month += 12
            start_year -= 1
        start_period = f"{start_year:04d}-{start_month:02d}"
    report = payroll_trend(
        get_db(), tenant_id=_tenant_id(user_context), start_period=start_period,
        end_period=end_period, official_only=False,
    )
    rows = report.get("rows") or []
    if not rows:
        return _pending_result("No payroll trend data is available for that period range.")
    lines = [f"Payroll trend from {_period_label(start_period)} to {_period_label(end_period)}:"]
    for row in rows[-8:]:
        lines.append(
            f"• {_period_label(_text(row.get('period_key')))} — employees {row.get('employee_count') or 0}, "
            f"net {_money(row.get('net_amount'))}, CTC {_money(row.get('cost_to_company'))}"
        )
    return _pending_result("\n".join(lines))


def _tds_queue_start(question, user_context=None):
    error = _finance_access(user_context)
    if error:
        return _pending_result(error)
    fy = _financial_year_from_text(question)
    rows = list_tds_instructions(
        get_db(), tenant_id=_tenant_id(user_context),
        financial_years=[fy] if fy else None,
        statuses=["active", "draft", "inactive"], limit=READ_LIMIT,
    )
    if not rows:
        return _pending_result("No accessible TDS instruction records were found.")
    lines = [f"TDS instructions: {len(rows)} record(s)."]
    for row in rows[:DISPLAY_LIMIT]:
        lines.append(
            f"• {_employee_name(row)} — FY {_text(row.get('financial_year'))} — "
            f"{_text(row.get('mode')).title()} — {_text(row.get('status')).title()} — "
            f"from {_text(row.get('effective_from_period'))}"
        )
    return _pending_result("\n".join(lines))


# ---------------------------------------------------------------------------
# Attendance sync and payroll calculation
# ---------------------------------------------------------------------------


def _sync_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)
    period = _period_from_text(question)
    data = {"period": period}
    if not period:
        save_pending_action(user_context, "payroll_sync_attendance", data, "period")
        return _pending_result("Which payroll month should I synchronize attendance for? For example, August 2026.")
    save_pending_action(user_context, "payroll_sync_attendance", data, "confirm")
    return _pending_result(f"I am ready to synchronize payroll attendance for {_period_label(period)}. This will update payroll attendance summaries. Confirm?", requires_confirmation=True)


def _sync_continue(pending, question, user_context=None):
    data = dict((pending or {}).get("data") or {})
    step = _text((pending or {}).get("current_step"))
    if step == "period":
        period = _period_from_text(question)
        if not period:
            return _pending_result("Please provide a valid payroll month, for example August 2026 or 2026-08.")
        data["period"] = period
        save_pending_action(user_context, "payroll_sync_attendance", data, "confirm")
        return _pending_result(f"Synchronize payroll attendance for {_period_label(period)}?", requires_confirmation=True)
    if step == "confirm":
        if _no(question):
            clear_pending_action(user_context)
            return _pending_result("Payroll attendance synchronization was cancelled.")
        if not _yes(question):
            return _pending_result("Please reply Yes to synchronize attendance, or No to cancel.")
        try:
            result = sync_attendance_summaries(
                get_db(), tenant_id=_tenant_id(user_context), period=data.get("period"),
                actor_id=_actor_id(user_context), actor_name=_actor_name(user_context), persist=True,
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _pending_result(_safe_error(exc, "I could not synchronize payroll attendance."))
        clear_pending_action(user_context)
        totals = result.get("totals") or {}
        return _pending_result(
            f"Payroll attendance for {_period_label(data.get('period'))} was synchronized successfully. "
            f"Employees synced: {totals.get('employees_synced') or 0}; failures: {totals.get('employees_failed') or 0}."
        )
    clear_pending_action(user_context)
    return _pending_result("The incomplete payroll attendance action was cleared safely. Please start again.")


def _calculate_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)
    period = _period_from_text(question)
    data = {"period": period}
    if not period:
        save_pending_action(user_context, "payroll_calculate_run", data, "period")
        return _pending_result("Which payroll month should I calculate? For example, August 2026.")
    save_pending_action(user_context, "payroll_calculate_run", data, "confirm")
    return _pending_result(
        f"I am ready to calculate draft payroll for eligible active employees for {_period_label(period)}. "
        "The canonical payroll engine will validate salary structures, statutory configuration, attendance, loans, reimbursements, and tax context before saving. Confirm?",
        requires_confirmation=True,
    )


def _calculate_continue(pending, question, user_context=None):
    data = dict((pending or {}).get("data") or {})
    step = _text((pending or {}).get("current_step"))
    if step == "period":
        period = _period_from_text(question)
        if not period:
            return _pending_result("Please provide a valid payroll month, such as 2026-08.")
        data["period"] = period
        save_pending_action(user_context, "payroll_calculate_run", data, "confirm")
        return _pending_result(f"Calculate draft payroll for {_period_label(period)} using the canonical payroll engine?", requires_confirmation=True)
    if step == "confirm":
        if _no(question):
            clear_pending_action(user_context)
            return _pending_result("Payroll calculation was cancelled.")
        if not _yes(question):
            return _pending_result("Please reply Yes to calculate payroll, or No to cancel.")
        try:
            response = _call_canonical_payroll_view(
                "calculate_monthly_payroll", "/payroll/calculate",
                {"period": data.get("period")}, user_context=user_context,
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _pending_result(_safe_error(exc, "Payroll calculation could not be completed."))
        clear_pending_action(user_context)
        run = response.get("run") or {}
        count = response.get("calculated_employee_count") or response.get("employee_count") or 0
        skipped = response.get("skipped") or []
        return _pending_result(
            f"Draft payroll for {_period_label(data.get('period'))} was calculated successfully for {count} employee(s). "
            f"Skipped/exception records: {len(skipped)}. Run: {_run_label(run)}."
        )
    clear_pending_action(user_context)
    return _pending_result("The incomplete payroll calculation action was cleared safely. Please start again.")


# ---------------------------------------------------------------------------
# Canonical payroll workflow transitions
# ---------------------------------------------------------------------------


def _workflow_start(action_type: str, action: str, question, user_context=None):
    required_error = _payroll_hr_workflow_access(user_context) if action == "hr_review" else _payroll_finance_workflow_access(user_context)
    if required_error:
        return _pending_result(required_error)
    period = _period_from_text(question)
    data = {"action": action, "period": period}
    if not period:
        save_pending_action(user_context, action_type, data, "period")
        return _pending_result("Which payroll month should I use for this workflow action?")
    db = get_db()
    run = _find_run(db, _tenant_id(user_context), period=period)
    if not run:
        return _pending_result(f"I could not find a payroll run for {_period_label(period)}.")
    data["run_id"] = _run_reference(run)
    data["run_label"] = _run_label(run)
    data["current_status"] = _canonical_status(run.get("status") or run.get("workflow_stage"))

    if action == "disburse":
        save_pending_action(user_context, action_type, data, "transfer_date")
        return _pending_result(f"I found {data['run_label']}. What was the salary transfer date? Use YYYY-MM-DD.")

    save_pending_action(user_context, action_type, data, "note")
    verb = {
        "hr_review": "complete HR Review for",
        "finance_approve": "Finance-approve",
        "lock": "lock",
    }.get(action, action)
    return _pending_result(
        f"I found {data['run_label']} at {PAYROLL_STATUS_LABELS.get(data['current_status'], data['current_status'])}. "
        f"Please provide an optional note for the action, or reply Skip. I will then ask you to confirm before I {verb} this payroll."
    )


def _workflow_continue(action_type: str, pending, question, user_context=None):
    data = dict((pending or {}).get("data") or {})
    step = _text((pending or {}).get("current_step"))
    action = _text(data.get("action"))

    if step == "period":
        period = _period_from_text(question)
        if not period:
            return _pending_result("Please provide a valid payroll month, for example 2026-08.")
        run = _find_run(get_db(), _tenant_id(user_context), period=period)
        if not run:
            return _pending_result(f"I could not find a payroll run for {_period_label(period)}.")
        data.update({
            "period": period,
            "run_id": _run_reference(run),
            "run_label": _run_label(run),
            "current_status": _canonical_status(run.get("status") or run.get("workflow_stage")),
        })
        if action == "disburse":
            save_pending_action(user_context, action_type, data, "transfer_date")
            return _pending_result("What was the salary transfer date? Use YYYY-MM-DD.")
        save_pending_action(user_context, action_type, data, "note")
        return _pending_result("Please provide an optional workflow note, or reply Skip.")

    if step == "transfer_date":
        transfer_date = _text(question)
        try:
            datetime.strptime(transfer_date, "%Y-%m-%d")
        except Exception:
            return _pending_result("Please provide the transfer date in YYYY-MM-DD format.")
        data["transfer_date"] = transfer_date
        save_pending_action(user_context, action_type, data, "transfer_mode")
        return _pending_result("What transfer mode was used? For example NEFT, RTGS, IMPS, or BANK_TRANSFER.")

    if step == "transfer_mode":
        mode = _role_key(question).upper()
        if not mode:
            return _pending_result("Please provide the bank transfer mode.")
        data["transfer_mode"] = mode
        save_pending_action(user_context, action_type, data, "transaction_reference")
        return _pending_result("Provide the UTR / transaction reference / bank batch reference for this salary transfer.")

    if step == "transaction_reference":
        reference = _text(question)
        if len(reference) < 3:
            return _pending_result("A valid bank/transaction reference is required before payroll can be marked Disbursed.")
        data["transaction_reference"] = reference[:180]
        save_pending_action(user_context, action_type, data, "note")
        return _pending_result("Please provide an optional disbursement note, or reply Skip.")

    if step == "note":
        if not _skip(question):
            data["note"] = _text(question)[:1000]
        save_pending_action(user_context, action_type, data, "confirm")
        action_label = {
            "hr_review": "complete HR Review",
            "finance_approve": "Finance-approve",
            "lock": "lock",
            "disburse": "mark Disbursed",
        }.get(action, action)
        extra = ""
        if action == "disburse":
            extra = (
                f"\nTransfer date: {data.get('transfer_date')}\n"
                f"Transfer mode: {data.get('transfer_mode')}\n"
                f"Reference: {data.get('transaction_reference')}"
            )
        return _pending_result(
            f"Review payroll action:\nRun: {data.get('run_label')}\nAction: {action_label}{extra}\n"
            "This is a high-impact payroll workflow change. Reply Yes to confirm or No to cancel.",
            requires_confirmation=True,
        )

    if step == "confirm":
        if _no(question):
            clear_pending_action(user_context)
            return _pending_result("The payroll workflow action was cancelled.")
        if not _yes(question):
            return _pending_result("Please reply Yes to confirm this payroll workflow action, or No to cancel.")

        # Revalidate the run immediately before execution.
        run = _find_run(get_db(), _tenant_id(user_context), run_reference=_text(data.get("run_id")))
        if not run:
            clear_pending_action(user_context)
            return _pending_result("The payroll run could no longer be found. Nothing was changed.")

        payload = {
            "run_id": _run_reference(run),
            "action": action,
            "note": _text(data.get("note")),
        }
        if action == "disburse":
            payload["disbursement"] = {
                "transfer_date": data.get("transfer_date"),
                "transfer_mode": data.get("transfer_mode"),
                "transaction_reference": data.get("transaction_reference"),
            }

        try:
            response = _call_canonical_payroll_view(
                "advance_payroll_run", "/payroll/run/approve", payload,
                user_context=user_context,
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _pending_result(_safe_error(exc, "The payroll workflow action could not be completed."))

        clear_pending_action(user_context)
        updated = response.get("run") or {}
        status = _canonical_status(response.get("status") or updated.get("status") or updated.get("workflow_stage"))
        message = f"{_run_label(updated or run)} moved successfully to {PAYROLL_STATUS_LABELS.get(status, status.replace('_', ' ').title())}."
        if response.get("loan_recovery_requires_retry"):
            message += " Loan/advance recovery reported one or more failures that require an explicit retry/review."
        if response.get("reimbursement_payment_requires_retry"):
            message += " Reimbursement payment processing reported one or more failures that require an explicit retry/review."
        return _pending_result(message)

    clear_pending_action(user_context)
    return _pending_result("The incomplete payroll workflow action was cleared safely. Please start again.")


def _hr_review_start(question, user_context=None):
    return _workflow_start("payroll_hr_review_run", "hr_review", question, user_context)


def _hr_review_continue(pending, question, user_context=None):
    return _workflow_continue("payroll_hr_review_run", pending, question, user_context)


def _finance_approve_start(question, user_context=None):
    return _workflow_start("payroll_finance_approve_run", "finance_approve", question, user_context)


def _finance_approve_continue(pending, question, user_context=None):
    return _workflow_continue("payroll_finance_approve_run", pending, question, user_context)


def _lock_start(question, user_context=None):
    return _workflow_start("payroll_lock_run", "lock", question, user_context)


def _lock_continue(pending, question, user_context=None):
    return _workflow_continue("payroll_lock_run", pending, question, user_context)


def _disburse_start(question, user_context=None):
    return _workflow_start("payroll_disburse_run", "disburse", question, user_context)


def _disburse_continue(pending, question, user_context=None):
    return _workflow_continue("payroll_disburse_run", pending, question, user_context)


# ---------------------------------------------------------------------------
# Bank verification
# ---------------------------------------------------------------------------


def _find_employee_candidates(db, tenant_id: str, text: str):
    clean = _text(text)
    if not clean:
        return []
    regex = re.compile(re.escape(clean), re.I)
    return list(db.employees.find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": [
            {"employee_name": regex}, {"name": regex}, {"full_name": regex},
            {"employee_code": regex}, {"emp_code": regex},
            {"official_email": regex}, {"email": regex},
        ],
    }, {"employee_name": 1, "name": 1, "full_name": 1, "employee_code": 1, "emp_code": 1}).limit(10))


def _select_employee_start(action_type: str, question, user_context=None, *, next_step="decision"):
    data = {}
    # Try extracting text after common prepositions, but do not guess if ambiguous.
    raw = _text(question)
    candidate_text = re.sub(r"(?i)\b(verify|reject|approve|bank|details|account|for|of|employee|the)\b", " ", raw)
    candidate_text = re.sub(r"\s+", " ", candidate_text).strip()
    rows = _find_employee_candidates(get_db(), _tenant_id(user_context), candidate_text) if len(candidate_text) >= 2 else []
    if len(rows) == 1:
        employee = rows[0]
        data["employee_id"] = _text(employee.get("_id"))
        data["employee_name"] = _employee_name(employee)
        save_pending_action(user_context, action_type, data, next_step)
        return data, None
    save_pending_action(user_context, action_type, data, "employee")
    return data, _pending_result("Which employee should I use? Provide the employee name, code, or official email.")


def _resolve_employee_step(action_type: str, data: dict, question, user_context=None, *, next_step="decision"):
    rows = _find_employee_candidates(get_db(), _tenant_id(user_context), question)
    if not rows:
        return None, _pending_result("I could not find that employee in this organisation. Please provide the employee name, code, or official email.")
    if len(rows) > 1:
        lines = ["I found multiple employees. Please reply with the employee code or a more specific name:"]
        for row in rows[:8]:
            code = _text(row.get("employee_code") or row.get("emp_code"))
            lines.append(f"• {_employee_name(row)}" + (f" — {code}" if code else ""))
        return None, _pending_result("\n".join(lines))
    employee = rows[0]
    data["employee_id"] = _text(employee.get("_id"))
    data["employee_name"] = _employee_name(employee)
    save_pending_action(user_context, action_type, data, next_step)
    return employee, None


def _bank_verify_start(question, user_context=None):
    error = _finance_access(user_context)
    if error:
        return _pending_result(error)
    data, response = _select_employee_start("payroll_verify_bank_details", question, user_context, next_step="decision")
    if response:
        return response
    return _pending_result(f"Should I Verify or Reject the active bank details for {data.get('employee_name')}?")


def _bank_verify_continue(pending, question, user_context=None):
    data = dict((pending or {}).get("data") or {})
    step = _text((pending or {}).get("current_step"))
    if step == "employee":
        employee, response = _resolve_employee_step("payroll_verify_bank_details", data, question, user_context, next_step="decision")
        if response:
            return response
        return _pending_result(f"Should I Verify or Reject the active bank details for {data.get('employee_name')}?")
    if step == "decision":
        decision = "verified" if any(word in _norm(question) for word in ("verify", "approve", "verified")) else "rejected" if any(word in _norm(question) for word in ("reject", "rejected")) else ""
        if not decision:
            return _pending_result("Please reply Verify or Reject.")
        data["decision"] = decision
        save_pending_action(user_context, "payroll_verify_bank_details", data, "note")
        return _pending_result("Provide an optional verification note, or reply Skip.")
    if step == "note":
        if not _skip(question):
            data["note"] = _text(question)[:1000]
        save_pending_action(user_context, "payroll_verify_bank_details", data, "confirm")
        return _pending_result(
            f"Review bank verification:\nEmployee: {data.get('employee_name')}\nDecision: {data.get('decision').title()}\n"
            "Reply Yes to confirm or No to cancel.", requires_confirmation=True,
        )
    if step == "confirm":
        if _no(question):
            clear_pending_action(user_context)
            return _pending_result("Bank verification action was cancelled.")
        if not _yes(question):
            return _pending_result("Please reply Yes to confirm, or No to cancel.")
        try:
            record = verify_bank_details(
                get_db(), tenant_id=_tenant_id(user_context), employee_reference=data.get("employee_id"),
                decision=data.get("decision"), actor_id=_actor_id(user_context), actor_name=_actor_name(user_context),
                note=_text(data.get("note")), enforce_segregation_of_duties=True,
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _pending_result(_safe_error(exc, "I could not update the employee bank-verification status."))
        clear_pending_action(user_context)
        return _pending_result(
            f"Bank details for {data.get('employee_name')} were {_text(record.get('verification_status') or data.get('decision')).replace('_', ' ')} successfully."
        )
    clear_pending_action(user_context)
    return _pending_result("The incomplete bank-verification action was cleared safely.")


# ---------------------------------------------------------------------------
# Reimbursement decisions
# ---------------------------------------------------------------------------


def _reimbursement_candidates(user_context=None):
    roles = _roles(user_context)
    if roles.intersection(HR_ROLES - {"admin", "super_admin"}):
        statuses = ["pending_hr_review"]
    elif roles.intersection(FINANCE_ROLES - {"admin", "super_admin"}):
        statuses = ["pending_finance_approval"]
    else:
        statuses = ["pending_hr_review", "pending_finance_approval"]
    return list_reimbursements(get_db(), tenant_id=_tenant_id(user_context), statuses=statuses, limit=READ_LIMIT)


def _find_row_by_reference(rows, question):
    raw = _norm(question)
    exact_ids = {_text(row.get("_id")): row for row in rows}
    for key, row in exact_ids.items():
        if key and key.lower() in raw:
            return row
    matches = []
    for row in rows:
        name = _norm(_employee_name(row))
        code = _norm(row.get("employee_code"))
        label = _norm(row.get("label") or row.get("type"))
        if (name and name in raw) or (code and code in raw):
            matches.append(row)
        elif label and len(label) > 3 and label in raw:
            matches.append(row)
    return matches[0] if len(matches) == 1 else None


def _reimbursement_review_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)
    rows = _reimbursement_candidates(user_context)
    if not rows:
        return _pending_result("There are no reimbursement requests waiting in your accessible review stage.")
    selected = _find_row_by_reference(rows, question)
    data = {}
    if selected:
        data = {"id": _text(selected.get("_id")), "employee_name": _employee_name(selected), "status": _role_key(selected.get("status")), "amount": selected.get("claimed_amount") or selected.get("amount")}
        save_pending_action(user_context, "payroll_review_reimbursement", data, "decision")
        return _pending_result(f"I found the reimbursement for {data['employee_name']} ({_money(data['amount'])}), status {data['status'].replace('_', ' ')}. Should I Approve/Complete Review or Reject it?")
    lines = ["Which reimbursement should I review? Reply with the request number/ID or employee name:"]
    for row in rows[:DISPLAY_LIMIT]:
        lines.append(f"• {_text(row.get('_id'))} — {_employee_name(row)} — {_money(row.get('claimed_amount') or row.get('amount'))} — {_text(row.get('status')).replace('_', ' ')}")
    save_pending_action(user_context, "payroll_review_reimbursement", {}, "request")
    return _pending_result("\n".join(lines))


def _reimbursement_review_continue(pending, question, user_context=None):
    data = dict((pending or {}).get("data") or {})
    step = _text((pending or {}).get("current_step"))
    if step == "request":
        rows = _reimbursement_candidates(user_context)
        selected = _find_row_by_reference(rows, question)
        if not selected:
            return _pending_result("I could not uniquely identify that reimbursement. Please provide its ID or a specific employee name from the queue.")
        data.update({"id": _text(selected.get("_id")), "employee_name": _employee_name(selected), "status": _role_key(selected.get("status")), "amount": selected.get("claimed_amount") or selected.get("amount")})
        save_pending_action(user_context, "payroll_review_reimbursement", data, "decision")
        return _pending_result("Should I Approve/Complete Review or Reject this reimbursement?")
    if step == "decision":
        raw = _norm(question)
        if "reject" in raw:
            data["decision"] = "reject"
            save_pending_action(user_context, "payroll_review_reimbursement", data, "reason")
            return _pending_result("Please provide the rejection reason.")
        if any(word in raw for word in ("approve", "review", "complete")):
            data["decision"] = "approve"
            if data.get("status") == "pending_finance_approval":
                save_pending_action(user_context, "payroll_review_reimbursement", data, "approved_amount")
                return _pending_result(f"What amount should Finance approve? The claimed amount is {_money(data.get('amount'))}. Reply Same to approve the claimed amount.")
            save_pending_action(user_context, "payroll_review_reimbursement", data, "note")
            return _pending_result("Provide an optional HR review note, or reply Skip.")
        return _pending_result("Please reply Approve/Complete Review or Reject.")
    if step == "approved_amount":
        if _norm(question) == "same":
            data["approved_amount"] = data.get("amount")
        else:
            try:
                data["approved_amount"] = float(re.sub(r"[^0-9.]", "", _text(question)))
            except Exception:
                return _pending_result("Please provide a valid approved amount, or reply Same.")
        save_pending_action(user_context, "payroll_review_reimbursement", data, "tax_treatment")
        return _pending_result("Tax treatment: Taxable or Non-taxable?")
    if step == "tax_treatment":
        raw = _norm(question).replace("-", "_").replace(" ", "_")
        if raw not in {"taxable", "non_taxable", "nontaxable"}:
            return _pending_result("Please reply Taxable or Non-taxable.")
        data["tax_treatment"] = "non_taxable" if raw in {"non_taxable", "nontaxable"} else "taxable"
        save_pending_action(user_context, "payroll_review_reimbursement", data, "payment_mode")
        return _pending_result("Payment mode: Payroll or Manual?")
    if step == "payment_mode":
        mode = _role_key(question)
        if mode not in {"payroll", "manual"}:
            return _pending_result("Please reply Payroll or Manual.")
        data["payment_mode"] = mode
        if mode == "payroll":
            save_pending_action(user_context, "payroll_review_reimbursement", data, "payroll_period")
            return _pending_result("Which payroll month should this reimbursement be paid in?")
        save_pending_action(user_context, "payroll_review_reimbursement", data, "note")
        return _pending_result("Provide an optional Finance note, or reply Skip.")
    if step == "payroll_period":
        period = _period_from_text(question)
        if not period:
            return _pending_result("Please provide a valid payroll month, for example 2026-08.")
        data["payroll_period"] = period
        save_pending_action(user_context, "payroll_review_reimbursement", data, "note")
        return _pending_result("Provide an optional Finance note, or reply Skip.")
    if step == "reason":
        reason = _text(question)
        if len(reason) < 3:
            return _pending_result("Please provide a clear rejection reason.")
        data["reason"] = reason[:1000]
        save_pending_action(user_context, "payroll_review_reimbursement", data, "confirm")
        return _pending_result(f"Reject the reimbursement for {data.get('employee_name')}? Reason: {data.get('reason')}\nReply Yes to confirm or No to cancel.", requires_confirmation=True)
    if step == "note":
        if not _skip(question):
            data["note"] = _text(question)[:1000]
        save_pending_action(user_context, "payroll_review_reimbursement", data, "confirm")
        return _pending_result(f"Confirm reimbursement action for {data.get('employee_name')} ({_money(data.get('approved_amount') or data.get('amount'))})? Reply Yes or No.", requires_confirmation=True)
    if step == "confirm":
        if _no(question):
            clear_pending_action(user_context)
            return _pending_result("Reimbursement review was cancelled.")
        if not _yes(question):
            return _pending_result("Please reply Yes to confirm, or No to cancel.")
        try:
            if data.get("decision") == "reject":
                record = reject_reimbursement(
                    get_db(), tenant_id=_tenant_id(user_context), reimbursement_id=data.get("id"), reason=data.get("reason"),
                    actor_id=_actor_id(user_context), actor_name=_actor_name(user_context),
                )
            elif data.get("status") == "pending_hr_review":
                if _hr_access(user_context):
                    raise PayrollReimbursementError("Only authorised HR can complete the HR reimbursement review.", status_code=403)
                record = complete_reimbursement_hr_review(
                    get_db(), tenant_id=_tenant_id(user_context), reimbursement_id=data.get("id"),
                    actor_id=_actor_id(user_context), actor_name=_actor_name(user_context), note=_text(data.get("note")),
                )
            else:
                if _finance_access(user_context):
                    raise PayrollReimbursementError("Only authorised Finance can approve this reimbursement.", status_code=403)
                record = approve_reimbursement(
                    get_db(), tenant_id=_tenant_id(user_context), reimbursement_id=data.get("id"),
                    approved_amount=data.get("approved_amount"), tax_treatment=data.get("tax_treatment"),
                    payment_mode=data.get("payment_mode"), payroll_period=data.get("payroll_period") or "",
                    actor_id=_actor_id(user_context), actor_name=_actor_name(user_context), note=_text(data.get("note")),
                )
        except Exception as exc:
            clear_pending_action(user_context)
            return _pending_result(_safe_error(exc, "The reimbursement decision could not be completed."))
        clear_pending_action(user_context)
        return _pending_result(f"The reimbursement for {data.get('employee_name')} was updated successfully to {_text(record.get('status')).replace('_', ' ').title()}.")
    clear_pending_action(user_context)
    return _pending_result("The incomplete reimbursement action was cleared safely.")


# ---------------------------------------------------------------------------
# Loan/advance decisions and disbursement
# ---------------------------------------------------------------------------



def _loan_decision_start(question, user_context=None):
    error = _finance_access(user_context)
    if error:
        return _pending_result(error)
    rows = list_loan_advances(get_db(), tenant_id=_tenant_id(user_context), statuses=["pending_approval"], limit=READ_LIMIT)
    if not rows:
        return _pending_result("There are no loan/advance requests waiting for Finance approval.")
    selected = _find_row_by_reference(rows, question)
    if not selected:
        lines = ["Which loan/advance request should I review? Reply with its ID or employee name:"]
        for row in rows[:DISPLAY_LIMIT]:
            lines.append(f"• {_text(row.get('_id'))} — {_employee_name(row)} — {_money(row.get('requested_amount') or row.get('amount'))} — {_text(row.get('type')).replace('_', ' ')}")
        save_pending_action(user_context, "payroll_decide_loan", {}, "request")
        return _pending_result("\n".join(lines))
    data = {"id": _text(selected.get("_id")), "employee_name": _employee_name(selected), "requested_amount": selected.get("requested_amount") or selected.get("amount")}
    save_pending_action(user_context, "payroll_decide_loan", data, "decision")
    return _pending_result(f"Should I Approve or Reject the loan/advance for {data['employee_name']} ({_money(data['requested_amount'])})?")


def _loan_decision_continue(pending, question, user_context=None):
    data = dict((pending or {}).get("data") or {})
    step = _text((pending or {}).get("current_step"))
    if step == "request":
        rows = list_loan_advances(get_db(), tenant_id=_tenant_id(user_context), statuses=["pending_approval"], limit=READ_LIMIT)
        selected = _find_row_by_reference(rows, question)
        if not selected:
            return _pending_result("I could not uniquely identify that loan/advance request.")
        data.update({"id": _text(selected.get("_id")), "employee_name": _employee_name(selected), "requested_amount": selected.get("requested_amount") or selected.get("amount")})
        save_pending_action(user_context, "payroll_decide_loan", data, "decision")
        return _pending_result("Should I Approve or Reject this request?")
    if step == "decision":
        if "reject" in _norm(question):
            data["decision"] = "reject"
            save_pending_action(user_context, "payroll_decide_loan", data, "reason")
            return _pending_result("Please provide the rejection reason.")
        if "approve" in _norm(question):
            data["decision"] = "approve"
            save_pending_action(user_context, "payroll_decide_loan", data, "approved_amount")
            return _pending_result(f"Approved amount? Requested amount is {_money(data.get('requested_amount'))}. Reply Same to approve the requested amount.")
        return _pending_result("Please reply Approve or Reject.")
    if step == "approved_amount":
        if _norm(question) == "same":
            data["approved_amount"] = data.get("requested_amount")
        else:
            try:
                data["approved_amount"] = float(re.sub(r"[^0-9.]", "", _text(question)))
            except Exception:
                return _pending_result("Please provide a valid approved amount, or reply Same.")
        save_pending_action(user_context, "payroll_decide_loan", data, "emi_amount")
        return _pending_result("What EMI/recovery amount should be deducted per payroll month?")
    if step == "emi_amount":
        try:
            data["emi_amount"] = float(re.sub(r"[^0-9.]", "", _text(question)))
        except Exception:
            return _pending_result("Please provide a valid EMI/recovery amount.")
        save_pending_action(user_context, "payroll_decide_loan", data, "recovery_period")
        return _pending_result("Which payroll month should recovery start? For example 2026-09.")
    if step == "recovery_period":
        period = _period_from_text(question)
        if not period:
            return _pending_result("Please provide a valid recovery start month.")
        data["recovery_start_period"] = period
        save_pending_action(user_context, "payroll_decide_loan", data, "note")
        return _pending_result("Provide an optional approval note, or reply Skip.")
    if step == "reason":
        reason = _text(question)
        if len(reason) < 3:
            return _pending_result("Please provide a clear rejection reason.")
        data["reason"] = reason[:1000]
        save_pending_action(user_context, "payroll_decide_loan", data, "confirm")
        return _pending_result(f"Reject the loan/advance for {data.get('employee_name')}? Reply Yes to confirm or No to cancel.", requires_confirmation=True)
    if step == "note":
        if not _skip(question):
            data["note"] = _text(question)[:1000]
        save_pending_action(user_context, "payroll_decide_loan", data, "confirm")
        return _pending_result(f"Approve {_money(data.get('approved_amount'))} for {data.get('employee_name')} with EMI {_money(data.get('emi_amount'))}, starting {_period_label(data.get('recovery_start_period'))}? Reply Yes or No.", requires_confirmation=True)
    if step == "confirm":
        if _no(question):
            clear_pending_action(user_context)
            return _pending_result("Loan/advance decision was cancelled.")
        if not _yes(question):
            return _pending_result("Please reply Yes to confirm, or No to cancel.")
        try:
            if data.get("decision") == "reject":
                record = reject_loan_advance(
                    get_db(), tenant_id=_tenant_id(user_context), loan_advance_id=data.get("id"), reason=data.get("reason"),
                    actor_id=_actor_id(user_context), actor_name=_actor_name(user_context),
                )
            else:
                record = approve_loan_advance(
                    get_db(), tenant_id=_tenant_id(user_context), loan_advance_id=data.get("id"),
                    approved_amount=data.get("approved_amount"), emi_amount=data.get("emi_amount"),
                    recovery_start_period=data.get("recovery_start_period"),
                    actor_id=_actor_id(user_context), actor_name=_actor_name(user_context), note=_text(data.get("note")),
                )
        except Exception as exc:
            clear_pending_action(user_context)
            return _pending_result(_safe_error(exc, "The loan/advance decision could not be completed."))
        clear_pending_action(user_context)
        return _pending_result(f"The loan/advance for {data.get('employee_name')} was updated successfully to {_text(record.get('status')).replace('_', ' ').title()}.")
    clear_pending_action(user_context)
    return _pending_result("The incomplete loan/advance action was cleared safely.")


def _loan_disburse_start(question, user_context=None):
    error = _finance_access(user_context)
    if error:
        return _pending_result(error)
    rows = list_loan_advances(get_db(), tenant_id=_tenant_id(user_context), statuses=["approved"], limit=READ_LIMIT)
    if not rows:
        return _pending_result("There are no approved loan/advance requests waiting for disbursement.")
    selected = _find_row_by_reference(rows, question)
    if not selected:
        lines = ["Which approved loan/advance should I mark disbursed?"]
        for row in rows[:DISPLAY_LIMIT]:
            lines.append(f"• {_text(row.get('_id'))} — {_employee_name(row)} — {_money(row.get('approved_amount') or row.get('requested_amount'))}")
        save_pending_action(user_context, "payroll_disburse_loan", {}, "request")
        return _pending_result("\n".join(lines))
    data = {"id": _text(selected.get("_id")), "employee_name": _employee_name(selected), "amount": selected.get("approved_amount") or selected.get("requested_amount")}
    save_pending_action(user_context, "payroll_disburse_loan", data, "transfer_date")
    return _pending_result("What was the loan/advance transfer date? Use YYYY-MM-DD.")


def _loan_disburse_continue(pending, question, user_context=None):
    data = dict((pending or {}).get("data") or {})
    step = _text((pending or {}).get("current_step"))
    if step == "request":
        rows = list_loan_advances(get_db(), tenant_id=_tenant_id(user_context), statuses=["approved"], limit=READ_LIMIT)
        selected = _find_row_by_reference(rows, question)
        if not selected:
            return _pending_result("I could not uniquely identify that approved loan/advance.")
        data.update({"id": _text(selected.get("_id")), "employee_name": _employee_name(selected), "amount": selected.get("approved_amount") or selected.get("requested_amount")})
        save_pending_action(user_context, "payroll_disburse_loan", data, "transfer_date")
        return _pending_result("What was the transfer date? Use YYYY-MM-DD.")
    if step == "transfer_date":
        value = _text(question)
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except Exception:
            return _pending_result("Please provide the transfer date in YYYY-MM-DD format.")
        data["transfer_date"] = value
        save_pending_action(user_context, "payroll_disburse_loan", data, "transfer_mode")
        return _pending_result("What transfer mode was used? For example NEFT, RTGS, IMPS, or Bank Transfer.")
    if step == "transfer_mode":
        data["transfer_mode"] = _role_key(question)
        if not data["transfer_mode"]:
            return _pending_result("Please provide a transfer mode.")
        save_pending_action(user_context, "payroll_disburse_loan", data, "reference")
        return _pending_result("Provide the transaction/UTR/bank reference.")
    if step == "reference":
        data["reference"] = _text(question)[:180]
        save_pending_action(user_context, "payroll_disburse_loan", data, "note")
        return _pending_result("Provide an optional disbursement note, or reply Skip.")
    if step == "note":
        if not _skip(question):
            data["note"] = _text(question)[:1000]
        save_pending_action(user_context, "payroll_disburse_loan", data, "confirm")
        return _pending_result(f"Mark the approved loan/advance of {_money(data.get('amount'))} for {data.get('employee_name')} as disbursed? Reply Yes or No.", requires_confirmation=True)
    if step == "confirm":
        if _no(question):
            clear_pending_action(user_context)
            return _pending_result("Loan/advance disbursement was cancelled.")
        if not _yes(question):
            return _pending_result("Please reply Yes to confirm, or No to cancel.")
        try:
            record = disburse_loan_advance(
                get_db(), tenant_id=_tenant_id(user_context), loan_advance_id=data.get("id"),
                transfer_date=data.get("transfer_date"), transfer_mode=data.get("transfer_mode"),
                transaction_reference=data.get("reference"), bank_reference=data.get("reference"),
                actor_id=_actor_id(user_context), actor_name=_actor_name(user_context), note=_text(data.get("note")),
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _pending_result(_safe_error(exc, "The loan/advance disbursement could not be recorded."))
        clear_pending_action(user_context)
        return _pending_result(f"The loan/advance for {data.get('employee_name')} was marked Disbursed successfully. Status: {_text(record.get('status')).replace('_', ' ').title()}.")
    clear_pending_action(user_context)
    return _pending_result("The incomplete loan disbursement action was cleared safely.")


# ---------------------------------------------------------------------------
# Tax declaration and TDS decisions
# ---------------------------------------------------------------------------


def _tax_review_start(question, user_context=None):
    error = _management_access(user_context)
    if error:
        return _pending_result(error)
    fy = _financial_year_from_text(question)
    data = {"financial_year": fy}
    save_pending_action(user_context, "payroll_review_tax_declaration", data, "employee")
    return _pending_result("Which employee's tax declaration should I review? Provide the employee name, code, or official email.")


def _tax_review_continue(pending, question, user_context=None):
    data = dict((pending or {}).get("data") or {})
    step = _text((pending or {}).get("current_step"))
    if step == "employee":
        rows = _find_employee_candidates(get_db(), _tenant_id(user_context), question)
        if len(rows) != 1:
            return _pending_result("Please provide a unique employee name, employee code, or official email.")
        data["employee_id"] = _text(rows[0].get("_id"))
        data["employee_name"] = _employee_name(rows[0])
        if not data.get("financial_year"):
            save_pending_action(user_context, "payroll_review_tax_declaration", data, "financial_year")
            return _pending_result("Which financial year should I use? For example 2026-2027.")
        save_pending_action(user_context, "payroll_review_tax_declaration", data, "decision")
        return _pending_result("Choose the tax workflow action: Complete HR Review, Approve, Reject, or Lock.")
    if step == "financial_year":
        fy = _financial_year_from_text(question)
        if not fy:
            return _pending_result("Please provide a financial year such as 2026-2027.")
        data["financial_year"] = fy
        save_pending_action(user_context, "payroll_review_tax_declaration", data, "decision")
        return _pending_result("Choose the tax workflow action: Complete HR Review, Approve, Reject, or Lock.")
    if step == "decision":
        raw = _norm(question)
        if "reject" in raw:
            data["decision"] = "reject"
            save_pending_action(user_context, "payroll_review_tax_declaration", data, "reason")
            return _pending_result("Please provide the rejection reason.")
        if "lock" in raw:
            data["decision"] = "lock"
        elif "approve" in raw:
            data["decision"] = "approve"
        elif "hr" in raw and "review" in raw or "complete review" in raw:
            data["decision"] = "hr_review"
        else:
            return _pending_result("Please reply Complete HR Review, Approve, Reject, or Lock.")
        save_pending_action(user_context, "payroll_review_tax_declaration", data, "note")
        return _pending_result("Provide an optional workflow note, or reply Skip.")
    if step == "reason":
        if len(_text(question)) < 3:
            return _pending_result("Please provide a clear rejection reason.")
        data["reason"] = _text(question)[:1000]
        save_pending_action(user_context, "payroll_review_tax_declaration", data, "confirm")
        return _pending_result(f"Reject {data.get('employee_name')}'s tax declaration for FY {data.get('financial_year')}? Reply Yes or No.", requires_confirmation=True)
    if step == "note":
        if not _skip(question):
            data["note"] = _text(question)[:1000]
        save_pending_action(user_context, "payroll_review_tax_declaration", data, "confirm")
        return _pending_result(f"Confirm {data.get('decision').replace('_', ' ').title()} for {data.get('employee_name')}'s FY {data.get('financial_year')} tax declaration? Reply Yes or No.", requires_confirmation=True)
    if step == "confirm":
        if _no(question):
            clear_pending_action(user_context)
            return _pending_result("Tax declaration workflow action was cancelled.")
        if not _yes(question):
            return _pending_result("Please reply Yes to confirm, or No to cancel.")
        decision = data.get("decision")
        if decision == "hr_review" and _hr_access(user_context):
            clear_pending_action(user_context)
            return _pending_result("Only authorised HR can complete the tax HR Review stage.")
        if decision in {"approve", "lock"} and _finance_access(user_context):
            clear_pending_action(user_context)
            return _pending_result("Only authorised Finance can approve or lock employee tax declarations.")
        try:
            kwargs = dict(
                db=get_db(), tenant_id=_tenant_id(user_context), employee_reference=data.get("employee_id"),
                financial_year=data.get("financial_year"), actor_id=_actor_id(user_context), actor_name=_actor_name(user_context),
            )
            if decision == "hr_review":
                record = complete_tax_hr_review(**kwargs, note=_text(data.get("note")))
            elif decision == "approve":
                record = approve_tax_declaration(**kwargs, note=_text(data.get("note")))
            elif decision == "lock":
                record = lock_tax_declaration(**kwargs, note=_text(data.get("note")))
            else:
                record = reject_tax_declaration(**kwargs, reason=data.get("reason"))
        except Exception as exc:
            clear_pending_action(user_context)
            return _pending_result(_safe_error(exc, "The tax declaration workflow action could not be completed."))
        clear_pending_action(user_context)
        return _pending_result(f"{data.get('employee_name')}'s tax declaration was updated successfully to {_text(record.get('status')).replace('_', ' ').title()}.")
    clear_pending_action(user_context)
    return _pending_result("The incomplete tax workflow action was cleared safely.")


def _tds_status_start(question, user_context=None):
    error = _finance_access(user_context)
    if error:
        return _pending_result(error)
    rows = list_tds_instructions(get_db(), tenant_id=_tenant_id(user_context), statuses=["draft", "active", "inactive"], limit=READ_LIMIT)
    if not rows:
        return _pending_result("No TDS instruction is available for activation/deactivation.")
    selected = _find_row_by_reference(rows, question)
    if not selected:
        lines = ["Which TDS instruction should I update? Reply with its ID or employee name:"]
        for row in rows[:DISPLAY_LIMIT]:
            lines.append(f"• {_text(row.get('_id'))} — {_employee_name(row)} — FY {_text(row.get('financial_year'))} — {_text(row.get('status')).title()}")
        save_pending_action(user_context, "payroll_change_tds_instruction_status", {}, "request")
        return _pending_result("\n".join(lines))
    data = {"id": _text(selected.get("_id")), "employee_name": _employee_name(selected), "status": _role_key(selected.get("status"))}
    save_pending_action(user_context, "payroll_change_tds_instruction_status", data, "decision")
    return _pending_result("Should I Activate or Deactivate this TDS instruction?")


def _tds_status_continue(pending, question, user_context=None):
    data = dict((pending or {}).get("data") or {})
    step = _text((pending or {}).get("current_step"))
    if step == "request":
        rows = list_tds_instructions(get_db(), tenant_id=_tenant_id(user_context), statuses=["draft", "active", "inactive"], limit=READ_LIMIT)
        selected = _find_row_by_reference(rows, question)
        if not selected:
            return _pending_result("I could not uniquely identify that TDS instruction.")
        data.update({"id": _text(selected.get("_id")), "employee_name": _employee_name(selected), "status": _role_key(selected.get("status"))})
        save_pending_action(user_context, "payroll_change_tds_instruction_status", data, "decision")
        return _pending_result("Should I Activate or Deactivate it?")
    if step == "decision":
        raw = _norm(question)
        if "deactivate" in raw or "disable" in raw:
            data["decision"] = "deactivate"
            save_pending_action(user_context, "payroll_change_tds_instruction_status", data, "reason")
            return _pending_result("Please provide the reason for deactivation.")
        if "activate" in raw or "enable" in raw:
            data["decision"] = "activate"
            save_pending_action(user_context, "payroll_change_tds_instruction_status", data, "confirm")
            return _pending_result(f"Activate the TDS instruction for {data.get('employee_name')}? Reply Yes or No.", requires_confirmation=True)
        return _pending_result("Please reply Activate or Deactivate.")
    if step == "reason":
        if len(_text(question)) < 3:
            return _pending_result("Please provide a clear deactivation reason.")
        data["reason"] = _text(question)[:1000]
        save_pending_action(user_context, "payroll_change_tds_instruction_status", data, "confirm")
        return _pending_result(f"Deactivate the TDS instruction for {data.get('employee_name')}? Reply Yes or No.", requires_confirmation=True)
    if step == "confirm":
        if _no(question):
            clear_pending_action(user_context)
            return _pending_result("TDS instruction status change was cancelled.")
        if not _yes(question):
            return _pending_result("Please reply Yes to confirm, or No to cancel.")
        try:
            if data.get("decision") == "activate":
                record = activate_tds_instruction(
                    get_db(), tenant_id=_tenant_id(user_context), instruction_id=data.get("id"),
                    actor_id=_actor_id(user_context), actor_name=_actor_name(user_context),
                )
            else:
                record = deactivate_tds_instruction(
                    get_db(), tenant_id=_tenant_id(user_context), instruction_id=data.get("id"), reason=data.get("reason"),
                    actor_id=_actor_id(user_context), actor_name=_actor_name(user_context),
                )
        except Exception as exc:
            clear_pending_action(user_context)
            return _pending_result(_safe_error(exc, "The TDS instruction status could not be updated."))
        clear_pending_action(user_context)
        return _pending_result(f"The TDS instruction for {data.get('employee_name')} is now {_text(record.get('status')).title()}.")
    clear_pending_action(user_context)
    return _pending_result("The incomplete TDS action was cleared safely.")


# ---------------------------------------------------------------------------
# Registrations
# ---------------------------------------------------------------------------


def _register_read(action_type, label, handler, phrases, *, access=_management_access):
    register_saya_action(
        action_type,
        {
            "label": label,
            "module": "Payroll",
            "module_key": "payroll",
            "kind": "read",
            "scope": "tenant_payroll",
            "requires_tenant": True,
            "requires_confirmation": False,
            "allowed_roles": sorted(PAYROLL_MANAGEMENT_ROLES),
        },
        start_handler=handler,
        access_handler=access,
        intent_phrases=phrases,
    )


_register_read(
    "payroll_overview", "Payroll Status Overview", _overview_start,
    ["payroll status", "payroll overview", "salary processing status", "payroll run status", "where is payroll"],
)
_register_read(
    "payroll_exceptions", "Payroll Exceptions", _exceptions_start,
    ["payroll exceptions", "payroll errors", "payroll issues", "payroll problems", "reconciliation issues", "payroll mismatch"],
)
_register_read(
    "payroll_missing_bank_details", "Payroll Bank Readiness", _missing_bank_start,
    ["missing bank details", "bank details missing", "unverified bank details", "bank readiness", "employees missing bank"],
)
_register_read(
    "payroll_reimbursement_queue", "Reimbursement Review Queue", _reimbursement_queue_start,
    ["pending reimbursements", "reimbursement queue", "reimbursements waiting", "reimbursement approvals"],
)
_register_read(
    "payroll_loan_queue", "Loan / Advance Finance Queue", _loan_queue_start,
    ["pending loans", "pending advances", "loan approval queue", "advance approval queue", "loans waiting for finance"],
    access=_finance_access,
)
_register_read(
    "payroll_tax_queue", "Tax Declaration Review Queue", _tax_queue_start,
    ["pending tax declarations", "tax declaration queue", "tax declarations waiting", "tax approval queue"],
)
_register_read(
    "payroll_summary_report", "Payroll Summary", _summary_report_start,
    ["payroll summary", "salary summary", "monthly payroll total", "net payroll", "payroll totals"],
)
_register_read(
    "payroll_statutory_summary", "Payroll Statutory Summary", _statutory_report_start,
    ["statutory summary", "payroll pf esi", "pf esi tds summary", "professional tax summary", "payroll statutory"],
)
_register_read(
    "payroll_variance", "Payroll Variance", _variance_start,
    ["payroll variance", "compare payroll", "salary variance", "month on month payroll", "payroll difference"],
)
_register_read(
    "payroll_trend", "Payroll Trend", _trend_start,
    ["payroll trend", "salary trend", "payroll last six months", "payroll history trend"],
)
_register_read(
    "payroll_tds_overview", "TDS Instruction Overview", _tds_queue_start,
    ["tds instructions", "tds overview", "active tds", "tds status"],
    access=_finance_access,
)

register_saya_action(
    "payroll_sync_attendance",
    {
        "label": "Synchronize Payroll Attendance", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_payroll", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(PAYROLL_MANAGEMENT_ROLES),
    },
    start_handler=_sync_start, continue_handler=_sync_continue, access_handler=_management_access,
    intent_phrases=["sync payroll attendance", "synchronize payroll attendance", "refresh payroll attendance", "prepare attendance for payroll"],
)

register_saya_action(
    "payroll_calculate_run",
    {
        "label": "Calculate Draft Payroll", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_payroll", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(PAYROLL_MANAGEMENT_ROLES),
    },
    start_handler=_calculate_start, continue_handler=_calculate_continue, access_handler=_management_access,
    intent_phrases=["calculate payroll", "run payroll calculation", "process draft payroll", "calculate monthly payroll", "prepare payroll run"],
)

register_saya_action(
    "payroll_hr_review_run",
    {
        "label": "Complete Payroll HR Review", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_payroll_sensitive", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(PAYROLL_HR_WORKFLOW_ROLES),
    },
    start_handler=_hr_review_start, continue_handler=_hr_review_continue, access_handler=_payroll_hr_workflow_access,
    intent_phrases=["complete payroll hr review", "hr review payroll", "mark payroll hr reviewed", "send payroll to finance"],
)

register_saya_action(
    "payroll_finance_approve_run",
    {
        "label": "Finance Approve Payroll", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_payroll_sensitive", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(PAYROLL_FINANCE_WORKFLOW_ROLES),
    },
    start_handler=_finance_approve_start, continue_handler=_finance_approve_continue, access_handler=_payroll_finance_workflow_access,
    intent_phrases=["finance approve payroll", "approve payroll by finance", "approve salary payroll", "finance approval payroll"],
)

register_saya_action(
    "payroll_lock_run",
    {
        "label": "Lock Payroll", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_payroll_high_risk", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(PAYROLL_FINANCE_WORKFLOW_ROLES),
    },
    start_handler=_lock_start, continue_handler=_lock_continue, access_handler=_payroll_finance_workflow_access,
    intent_phrases=["lock payroll", "lock salary run", "release payslips", "finalize and lock payroll"],
)

register_saya_action(
    "payroll_disburse_run",
    {
        "label": "Mark Payroll Disbursed", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_payroll_critical", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(PAYROLL_FINANCE_WORKFLOW_ROLES),
    },
    start_handler=_disburse_start, continue_handler=_disburse_continue, access_handler=_payroll_finance_workflow_access,
    intent_phrases=["mark payroll disbursed", "salary disbursed", "complete salary disbursement", "mark salaries paid", "record payroll disbursement"],
)

register_saya_action(
    "payroll_verify_bank_details",
    {
        "label": "Verify / Reject Employee Bank Details", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_employee_bank_sensitive", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(FINANCE_ROLES),
    },
    start_handler=_bank_verify_start, continue_handler=_bank_verify_continue, access_handler=_finance_access,
    intent_phrases=["verify bank details", "approve bank details", "reject bank details", "verify employee bank account"],
)

register_saya_action(
    "payroll_review_reimbursement",
    {
        "label": "Review Reimbursement", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_reimbursement_review", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(PAYROLL_MANAGEMENT_ROLES),
    },
    start_handler=_reimbursement_review_start, continue_handler=_reimbursement_review_continue, access_handler=_management_access,
    intent_phrases=["approve reimbursement", "reject reimbursement", "review reimbursement", "complete reimbursement hr review", "finance approve reimbursement"],
)

register_saya_action(
    "payroll_decide_loan",
    {
        "label": "Approve / Reject Loan or Advance", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_loan_finance", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(FINANCE_ROLES),
    },
    start_handler=_loan_decision_start, continue_handler=_loan_decision_continue, access_handler=_finance_access,
    intent_phrases=["approve loan", "reject loan", "approve salary advance", "reject advance", "review loan request", "review advance request"],
)

register_saya_action(
    "payroll_disburse_loan",
    {
        "label": "Disburse Loan or Advance", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_loan_finance", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(FINANCE_ROLES),
    },
    start_handler=_loan_disburse_start, continue_handler=_loan_disburse_continue, access_handler=_finance_access,
    intent_phrases=["disburse loan", "disburse advance", "mark loan paid", "mark advance disbursed"],
)

register_saya_action(
    "payroll_review_tax_declaration",
    {
        "label": "Review Employee Tax Declaration", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_tax_review", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(PAYROLL_MANAGEMENT_ROLES),
    },
    start_handler=_tax_review_start, continue_handler=_tax_review_continue, access_handler=_management_access,
    intent_phrases=["review tax declaration", "approve tax declaration", "reject tax declaration", "lock tax declaration", "complete tax hr review"],
)

register_saya_action(
    "payroll_change_tds_instruction_status",
    {
        "label": "Activate / Deactivate TDS Instruction", "module": "Payroll", "module_key": "payroll",
        "kind": "write", "scope": "tenant_tds_finance", "requires_tenant": True,
        "requires_confirmation": True, "allowed_roles": sorted(FINANCE_ROLES),
    },
    start_handler=_tds_status_start, continue_handler=_tds_status_continue, access_handler=_finance_access,
    intent_phrases=["activate tds instruction", "deactivate tds instruction", "enable tds instruction", "disable tds instruction"],
)

