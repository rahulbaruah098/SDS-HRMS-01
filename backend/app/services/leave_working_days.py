"""Working-day leave accounting. Pure calculation; no database access.

Company-specific declared holidays are supplied by the caller, which MUST query
only the current tenant and employee state.  Weekly policy is supplied from
Attendance so its weekly-off rules stay authoritative.
"""
from datetime import date, timedelta


def _as_date(value):
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def calculate_chargeable_leave_period(start, end, manual_holidays,
                                      weekly_off_reason, half_day=False):
    start, end = _as_date(start), _as_date(end)
    if end < start:
        raise ValueError("To date cannot be before from date")
    calendar_days = (end - start).days + 1
    if calendar_days > 366:
        raise ValueError("A leave request cannot exceed 366 calendar days")
    if half_day and start != end:
        raise ValueError("Half-day leave must be for one date only")

    # Records from the tenant's state-specific Holiday Calendar. A holiday can
    # use a legacy single `date` or a start_date/end_date range. Avoid double
    # counting overlaps and prioritize declared holidays over weekly offs.
    declared = {}
    for row in manual_holidays:
        raw_start = row.get("start_date") or row.get("date") or row.get("from_date")
        raw_end = row.get("end_date") or row.get("to_date") or raw_start
        if not raw_start:
            continue
        try:
            first, last = _as_date(raw_start), _as_date(raw_end)
        except (ValueError, TypeError):
            continue
        cursor = max(first, start)
        last = min(last, end)
        while cursor <= last:
            declared.setdefault(cursor.isoformat(), str(row.get("title") or "Declared holiday"))
            cursor += timedelta(days=1)

    working_dates, excluded_dates = [], []
    weekly_off_days = declared_holiday_days = 0
    cursor = start
    while cursor <= end:
        key = cursor.isoformat()
        if key in declared:
            declared_holiday_days += 1
            excluded_dates.append({"date": key, "type": "declared_holiday", "reason": declared[key]})
        else:
            weekly = weekly_off_reason(cursor)
            if weekly:
                weekly_off_days += 1
                title = weekly.get("title", "Weekly off") if isinstance(weekly, dict) else "Weekly off"
                excluded_dates.append({"date": key, "type": "weekly_off", "reason": title})
            else:
                working_dates.append(key)
        cursor += timedelta(days=1)

    chargeable = 0.5 if half_day and working_dates else float(len(working_dates))
    return {
        "calendar_days": calendar_days,
        "chargeable_days": chargeable,
        "working_dates": working_dates,
        "excluded_dates": excluded_dates,
        "excluded_days": len(excluded_dates),
        "weekly_off_days": weekly_off_days,
        "declared_holiday_days": declared_holiday_days,
    }
