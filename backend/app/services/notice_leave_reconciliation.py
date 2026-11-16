"""Pure, fail-closed preview of historic approved leave overlapping a proposed notice.

No database access or writes. Output is a proposal, never a refund authorization.
Only the caller can obtain trusted working_dates from the existing attendance calendar.
"""
from datetime import date
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json

from app.services.notice_leave_allocation import allocate_notice_leave


class ReconciliationReviewRequired(ValueError):
    """No safe automatic reconciliation can be inferred from this record."""


def _day(value):
    try:
        if isinstance(value, date):
            return value.isoformat()[:10]
        return date.fromisoformat(str(value)[:10]).isoformat()
    except (TypeError, ValueError, AttributeError) as exc:
        raise ReconciliationReviewRequired("Invalid leave/notice date") from exc


def _decimal(value, label):
    try:
        x = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ReconciliationReviewRequired("Invalid " + label) from exc
    if not x.is_finite() or x < 0:
        raise ReconciliationReviewRequired("Invalid " + label)
    return x


def _type(value):
    return str(value or "").strip().upper().replace("_", "-")


def preview_historic_leave_reconciliation(
    *, employee, leave, proposed_notice, working_dates,
):
    """Propose a paid-leave reversal with an evidence ledger (never perform it).

    The user-visible effect would be one balance refund and matching LWP
    classification, **if and only if** a later transactional process validates
    the exact same evidence and an idempotent audit key. This function cannot
    grant such authority and NEVER returns a database update instruction.
    """
    tenant = employee.get("tenant_id")
    if not tenant or leave.get("tenant_id") != tenant:
        raise ReconciliationReviewRequired("Tenant mismatch")
    employee_id = str(employee.get("_id") or "")
    leave_id = str(leave.get("_id") or "")
    if not employee_id or not leave_id:
        raise ReconciliationReviewRequired("Missing employee/leave identity")
    if str(leave.get("employee_id")) != employee_id:
        raise ReconciliationReviewRequired("Leave belongs to a different employee")
    if leave.get("is_deleted") is True:
        raise ReconciliationReviewRequired("Deleted leave cannot be reconciled")
    if leave.get("status") != "approved" or leave.get("approval_stage") != "approved":
        raise ReconciliationReviewRequired("Leave is not final-approved")
    if leave.get("balance_deducted") is not True:
        raise ReconciliationReviewRequired("No confirmed paid balance debit")
    if _decimal(leave.get("lwp_days") or 0, "original LWP") != 0:
        raise ReconciliationReviewRequired("Already contains LWP; manual review required")
    if leave.get("notice_lwp_dates") or leave.get("balance_adjustment_events"):
        raise ReconciliationReviewRequired("Prior adjustment/notice ledger detected")

    kind = _type(leave.get("leave_type"))
    deducted_kind = _type(leave.get("deducted_leave_type"))
    if kind not in {"CL", "EL", "HALF-DAY"} or deducted_kind not in {"CL", "EL"}:
        raise ReconciliationReviewRequired("Unsupported or ambiguous deduction type")
    if kind in {"CL", "EL"} and kind != deducted_kind:
        raise ReconciliationReviewRequired("Paid deduction type mismatch")

    # Historic rows lack an explicit paid-days ledger; require exact equality.
    total = _decimal(leave.get("leave_days"), "leave days")
    originally_debited = _decimal(
        leave.get("paid_leave_days_deducted", total), "original paid debit"
    )
    if originally_debited != total:
        raise ReconciliationReviewRequired("Original debit amount is ambiguous")

    first = _day(leave.get("from_date"))
    last = _day(leave.get("to_date"))
    start = _day(proposed_notice.get("notice_start_date"))
    end = _day(proposed_notice.get("last_working_day"))
    if not (first <= last and start <= end):
        raise ReconciliationReviewRequired("Date range invalid")
    if last > end and first <= end and last >= start:
        raise ReconciliationReviewRequired("Leave extends beyond last working day")

    policy = {
        "notice_status": "scheduled",
        "notice_policy": "leave_during_notice_is_lwp",
        "notice_start_date": start,
        "last_working_day": end,
    }
    try:
        allocated = allocate_notice_leave(
            policy, first, last, total, working_dates,
            is_half_day=(kind == "HALF-DAY"),
        )
    except ValueError as exc:
        raise ReconciliationReviewRequired(str(exc)) from exc

    refund = allocated["notice_lwp_days"]
    remaining = allocated["paid_days"]
    if refund > originally_debited or refund + remaining != originally_debited:
        raise ReconciliationReviewRequired("Reclassification would exceed original debit")

    # Fingerprint is a proposed operation identifier, not authorization.
    evidence = {
        "tenant": str(tenant), "employee": employee_id, "leave": leave_id,
        "notice_start": start, "last_working": end,
        "leave_from": first, "leave_to": last, "deducted_type": deducted_kind,
        "original_debit": str(originally_debited),
        "refund": str(refund),
        "lwp_dates": allocated["notice_lwp_dates"],
        "paid_dates": allocated["paid_dates"],
    }
    fingerprint = sha256(json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {
        "action": "review_required" if refund > 0 else "no_change",
        "refund_preview_days": str(refund),
        "remaining_paid_days": str(remaining),
        "notice_lwp_days": str(refund),
        "notice_lwp_dates": allocated["notice_lwp_dates"],
        "remaining_paid_dates": allocated["paid_dates"],
        "paid_leave_type": deducted_kind,
        "proposal_fingerprint": fingerprint,
        "requires_atomic_write_and_audit": bool(refund),
        "writes_performed": False,
    }
