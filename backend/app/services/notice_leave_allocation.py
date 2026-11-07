"""Pure date-wise allocation for Notice Period leave.

No database access or writes. The calling workflow must provide eligible
working dates and explicitly enforce the Notice Period feature flag.
"""

from datetime import date
from decimal import Decimal, InvalidOperation


def _day(value):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid leave or notice date") from exc


def _amount(value):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("Invalid leave-day amount") from exc
    if not amount.is_finite() or amount <= 0:
        raise ValueError("Leave days must be positive")
    return amount


def allocate_notice_leave(
    employee,
    from_date,
    to_date,
    leave_days,
    working_dates,
    *,
    is_half_day=False,
):
    """Split a leave request into paid-balance and notice-LWP portions.

    working_dates must come from the application's existing calendar and
    attendance rules. A caller must not pass every calendar day blindly.

    The result is a calculation only; it does not approve leave, mutate
    balances, or alter historical records.
    """
    first = _day(from_date)
    last = _day(to_date)
    if last < first:
        raise ValueError("Leave end precedes leave start")

    amount = _amount(leave_days)
    dates = sorted({
        _day(value) for value in working_dates
    })

    if any(day < first or day > last for day in dates):
        raise ValueError("Working date outside requested leave range")

    if is_half_day:
        if first != last or len(dates) != 1 or amount != Decimal("0.5"):
            raise ValueError("Half-day requires one eligible date and 0.5 days")
        weights = {dates[0]: Decimal("0.5")}
    else:
        if amount != Decimal(len(dates)):
            raise ValueError(
                "Leave-day total differs from eligible working days; "
                "manual review is required"
            )
        weights = {day: Decimal("1") for day in dates}

    notice_status = str(
        employee.get("notice_status") or ""
    ).strip().lower()

    notice_policy = str(
        employee.get("notice_policy") or ""
    ).strip().lower()

    applies = (
        notice_status in ("scheduled", "serving", "due_for_alumni")
        and notice_policy == "leave_during_notice_is_lwp"
    )

    if not applies:
        return {
            "paid_days": amount,
            "notice_lwp_days": Decimal("0"),
            "paid_dates": [d.isoformat() for d in dates],
            "notice_lwp_dates": [],
        }

    start = _day(employee.get("notice_start_date"))
    end = _day(employee.get("last_working_day"))

    if end < start:
        raise ValueError("Invalid employee notice period")

    if any(day > end for day in dates):
        raise ValueError(
            "Leave extends beyond the last working day; HR review required"
        )

    paid_dates = [d for d in dates if d < start]
    lwp_dates = [d for d in dates if start <= d <= end]

    paid = sum(
        (weights[d] for d in paid_dates),
        Decimal("0"),
    )
    lwp = sum(
        (weights[d] for d in lwp_dates),
        Decimal("0"),
    )

    if paid + lwp != amount:
        raise ValueError("Leave allocation does not reconcile")

    return {
        "paid_days": paid,
        "notice_lwp_days": lwp,
        "paid_dates": [d.isoformat() for d in paid_dates],
        "notice_lwp_dates": [d.isoformat() for d in lwp_dates],
    }
