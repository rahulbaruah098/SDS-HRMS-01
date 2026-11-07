"""Batch 12B-R5: isolated, explicitly gated historical leave refund transaction.

NOT wired to routes or the notice scheduler. Callers must perform HR authorization
and trusted calendar reconstruction before passing records. A future integration
must atomically schedule the notice together with this operation; until then the
entry point is deliberately locked (``enable_writes`` defaults to False).
"""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from hashlib import sha256

from app.services.notice_leave_adjustment_plan import (
    plan_historic_notice_adjustments, NoticeAdjustmentPlanRejected,
)


class NoticeRefundConflict(ValueError):
    """Stale, contradictory or already applied reconciliation evidence."""


class NoticeRefundNotAuthorized(PermissionError):
    """No authenticated HR approval and activation switch was supplied."""


def _days(raw):
    try:
        x = Decimal(str(raw))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise NoticeRefundConflict("Invalid refund amount") from exc
    if not x.is_finite() or x <= 0 or x * 2 != (x * 2).to_integral_value():
        raise NoticeRefundConflict("Refund must be positive whole/half day")
    return float(x)


def _matched(result):
    return getattr(result, "matched_count", None) == 1


def apply_reviewed_historic_notice_refunds(
    *, db, employee, proposed_notice, leaves_with_working_dates, expected_fingerprint,
    reviewer_id, enable_writes=False, now=None,
):
    """All-or-nothing refund + per-leave accounting ledger for one employee.

    An intentionally *unwired* building block: this does NOT schedule notice,
    and MUST NOT be called for actual employees until the future scheduler
    integration atomically combines notice scheduling and this transaction.

    - ``enable_writes`` defaults False and cannot be turned on by HTTP today.
    - Caller supplies employee and full leave documents from a trusted backend.
    - Recalculates preview and compares the HR-reviewed fingerprint.
    - Revalidates matching records inside the Mongo transaction.
    - Uses deterministic audit ``_id`` (Mongo's built-in unique index).
    - A DB exception or optimistic-concurrency mismatch aborts the whole batch.
    """
    if enable_writes is not True:
        raise NoticeRefundNotAuthorized("Refund executor is locked; no route integration")
    if not isinstance(reviewer_id, str) or not reviewer_id.strip():
        raise NoticeRefundNotAuthorized("Authenticated reviewer required")
    if not isinstance(expected_fingerprint, str) or len(expected_fingerprint) != 64:
        raise NoticeRefundConflict("HR-reviewed fingerprint required")
    if not isinstance(employee, dict) or not isinstance(proposed_notice, dict):
        raise NoticeRefundConflict("Invalid employee or notice")
    entries = list(leaves_with_working_dates)
    try:
        preview = plan_historic_notice_adjustments(
            employee=employee, proposed_notice=proposed_notice,
            leaves_with_working_dates=entries,
        )
    except (NoticeAdjustmentPlanRejected, ValueError) as exc:
        raise NoticeRefundConflict(str(exc)) from exc
    if preview["review_fingerprint"] != expected_fingerprint:
        raise NoticeRefundConflict("Review fingerprint changed")
    adjustments = preview["adjustments"]
    if not adjustments:
        raise NoticeRefundConflict("No historical refunds in reviewed plan")
    tenant = str(employee["tenant_id"])
    employee_id = str(employee["_id"])
    source = {str(leave["_id"]): leave for leave, _ in entries}
    clock = now or datetime.now(timezone.utc)
    audit_ids = []

    with db.client.start_session() as session:
        with session.start_transaction():
            actual_employee = db.employees.find_one(
                {"_id": employee["_id"], "tenant_id": tenant,
                 "is_deleted": {"$ne": True}}, session=session,
            )
            if actual_employee is None:
                raise NoticeRefundConflict("Employee changed or missing")
            # Notice dates/status cannot change between HR review and execution.
            # The *future* caller must schedule notice within this transaction.
            for field in ("notice_status", "notice_start_date", "last_working_day",
                          "notice_policy", "notice_updated_at"):
                if actual_employee.get(field) != employee.get(field):
                    raise NoticeRefundConflict("Employee notice changed since review")

            for item in adjustments:
                leave_doc = source[item["leave_id"]]
                leave_id = leave_doc["_id"]
                active = db.leave_requests.find_one(
                    {"_id": leave_id, "tenant_id": tenant,
                     "employee_id": employee_id, "status": "approved",
                     "approval_stage": "approved", "balance_deducted": True,
                     "is_deleted": {"$ne": True}}, session=session,
                )
                if active is None or any(active.get(k) != leave_doc.get(k) for k in (
                    "leave_type", "deducted_leave_type", "leave_days",
                    "paid_leave_days_deducted", "from_date", "to_date",
                    "lwp_days", "balance_adjustment_events", "notice_lwp_dates",
                )):
                    raise NoticeRefundConflict("Approved leave changed since HR review")
                if active.get("balance_adjustment_events") or active.get("notice_lwp_dates"):
                    raise NoticeRefundConflict("Leave was already reconciled")
                refund = _days(item["refund_days"])
                balance = db.leave_balances.find_one(
                    {"tenant_id": tenant, "employee_id": employee_id,
                     "leave_type": item["leave_type"],
                     "is_deleted": {"$ne": True}}, session=session,
                )
                if balance is None:
                    raise NoticeRefundConflict("Paid balance record missing")
                # Existing 14 non-formula balances are not recomputed. Only
                # reverse confirmed prior debit; protect against negative used.
                if float(balance.get("used") or 0) + 1e-8 < refund:
                    raise NoticeRefundConflict("Recorded used leave below proposed refund")
                audit_id = "notice-refund-v1:" + sha256(
                    (tenant + ":" + employee_id + ":" + str(leave_id)).encode()
                ).hexdigest()
                if db.notice_leave_refund_events.find_one({"_id": audit_id}, session=session):
                    raise NoticeRefundConflict("Refund already has an audit entry")
                # A deterministic _id is unique in MongoDB, including when
                # two attempts race. Insert and all subsequent writes share
                # the transaction, so a failure removes the audit too.
                db.notice_leave_refund_events.insert_one({
                    "_id": audit_id, "tenant_id": tenant, "employee_id": employee_id,
                    "leave_id": str(leave_id), "review_fingerprint": expected_fingerprint,
                    "evidence_fingerprint": item["evidence_fingerprint"],
                    "leave_type": item["leave_type"], "refund_days": refund,
                    "notice_lwp_dates": item["lwp_dates"],
                    "reviewer_id": reviewer_id, "created_at": clock,
                    "event_type": "historic_notice_leave_refund",
                }, session=session)
                changed_balance = db.leave_balances.update_one(
                    {"_id": balance["_id"], "tenant_id": tenant,
                     "available": balance.get("available"),
                     "used": balance.get("used")},
                    {"$inc": {"used": -refund, "available": refund},
                     "$set": {"updated_at": clock}}, session=session,
                )
                if not _matched(changed_balance):
                    raise NoticeRefundConflict("Balance was modified concurrently")
                changed_leave = db.leave_requests.update_one(
                    {"_id": leave_id, "tenant_id": tenant,
                     "status": "approved", "approval_stage": "approved",
                     "balance_deducted": True,
                     "balance_adjustment_events": {"$exists": False},
                     "notice_lwp_dates": {"$exists": False}},
                    {"$set": {
                        "paid_leave_days_deducted": float(Decimal(item["remaining_paid_days"])),
                        "lwp_days": refund,
                        "notice_lwp_dates": item["lwp_dates"],
                        "balance_adjustment_events": [audit_id],
                        "updated_at": clock,
                    }}, session=session,
                )
                if not _matched(changed_leave):
                    raise NoticeRefundConflict("Leave modified concurrently")
                audit_ids.append(audit_id)
    return {"refund_count": len(audit_ids), "audit_ids": audit_ids,
            "review_fingerprint": expected_fingerprint}
