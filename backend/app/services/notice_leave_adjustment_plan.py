"""Batch 12B-R4: pure audited refund-batch planning, intentionally no write API.

All previews must originate from the fail-closed historic leave preview module.
The resulting plan is a review artifact, not permission to adjust balances.
"""
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json

from app.services.notice_leave_reconciliation import (
    preview_historic_leave_reconciliation, ReconciliationReviewRequired,
)


class NoticeAdjustmentPlanRejected(ValueError):
    pass


def _amount(value):
    try:
        d = Decimal(str(value))
    except (TypeError, ValueError, InvalidOperation) as exc:
        raise NoticeAdjustmentPlanRejected("Invalid adjustment amount") from exc
    if not d.is_finite() or d < 0 or d.as_tuple().exponent < -2:
        raise NoticeAdjustmentPlanRejected("Invalid adjustment precision")
    return d


def _stable(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def plan_historic_notice_adjustments(*, employee, proposed_notice, leaves_with_working_dates):
    """Create deterministic all-or-nothing HR review plan for a single employee.

    Accept an iterable of tuples (full approved leave doc, trusted eligible working
    dates). No external dates should be provided by a browser; the caller must
    calculate eligible working dates from the existing attendance/calendar rules.
    Does not read or write MongoDB; does not change the notice schedule.
    """
    if not isinstance(employee, dict) or not isinstance(proposed_notice, dict):
        raise NoticeAdjustmentPlanRejected("Invalid employee or notice")
    tenant = str(employee.get("tenant_id") or "")
    employee_id = str(employee.get("_id") or "")
    if not tenant or not employee_id:
        raise NoticeAdjustmentPlanRejected("Missing tenant or employee")
    if isinstance(leaves_with_working_dates, (str, bytes, dict)):
        raise NoticeAdjustmentPlanRejected("Invalid leave entries")
    try:
        entries = list(leaves_with_working_dates)
    except TypeError as exc:
        raise NoticeAdjustmentPlanRejected("Invalid leave entries") from exc
    if len(entries) > 100:
        raise NoticeAdjustmentPlanRejected("Too many approved leave records")

    seen_ids = set()
    all_dates = set()
    adjustments = []
    totals = {"CL": Decimal("0"), "EL": Decimal("0")}
    count_unchanged = 0
    for entry in entries:
        if not isinstance(entry, (tuple, list)) or len(entry) != 2:
            raise NoticeAdjustmentPlanRejected("Each entry needs leave and working dates")
        leave, dates = entry
        if not isinstance(leave, dict):
            raise NoticeAdjustmentPlanRejected("Invalid leave record")
        leave_id = str(leave.get("_id") or "")
        if not leave_id or leave_id in seen_ids:
            raise NoticeAdjustmentPlanRejected("Missing or repeated leave ID")
        seen_ids.add(leave_id)
        try:
            proposed = preview_historic_leave_reconciliation(
                employee=employee, leave=leave, proposed_notice=proposed_notice,
                working_dates=dates,
            )
        except (ReconciliationReviewRequired, TypeError) as exc:
            raise NoticeAdjustmentPlanRejected("Leave requires manual review: " + str(exc)) from exc
        refund = _amount(proposed["refund_preview_days"])
        paid = _amount(proposed["remaining_paid_days"])
        original = _amount(leave.get("paid_leave_days_deducted", leave.get("leave_days")))
        if refund + paid != original:
            raise NoticeAdjustmentPlanRejected("Paid/refund accounting mismatch")
        if refund == 0:
            count_unchanged += 1
            continue
        if refund != refund.quantize(Decimal("0.5")):
            # All supported records use whole/half days; guard strange fractions.
            raise NoticeAdjustmentPlanRejected("Unsupported refund fraction")
        kind = proposed["paid_leave_type"]
        if kind not in totals:
            raise NoticeAdjustmentPlanRejected("Unsupported balance bucket")
        dates_new = proposed["notice_lwp_dates"]
        if len(set(dates_new)) != len(dates_new):
            raise NoticeAdjustmentPlanRejected("Repeated LWP date")
        if any(d in all_dates for d in dates_new):
            raise NoticeAdjustmentPlanRejected("Overlapping adjustment dates")
        all_dates.update(dates_new)
        totals[kind] += refund
        adjustments.append({
            "leave_id": leave_id,
            "leave_type": kind,
            "refund_days": str(refund),
            "remaining_paid_days": str(paid),
            "lwp_dates": list(dates_new),
            "evidence_fingerprint": proposed["proposal_fingerprint"],
        })
    adjustments.sort(key=lambda item: item["leave_id"])
    evidence = {
        "schema": "notice-leave-refund-review-v1",
        "tenant_id": tenant, "employee_id": employee_id,
        "notice_start_date": str(proposed_notice.get("notice_start_date") or "")[:10],
        "last_working_day": str(proposed_notice.get("last_working_day") or "")[:10],
        "adjustments": adjustments,
        "unchanged_leave_count": count_unchanged,
        "refund_totals": {k: str(v) for k, v in totals.items()},
    }
    digest = sha256(_stable(evidence).encode("utf-8")).hexdigest()
    return {
        **evidence,
        "review_fingerprint": digest,
        "requires_hr_review": bool(adjustments),
        "authorization_granted": False,
        "writes_performed": False,
    }
