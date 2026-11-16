"""Tenant-scoped notice period calculations. No database writes in this module."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

DEFAULT_TZ = 'Asia/Kolkata'


def parse_day(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        raise ValueError('Date must be YYYY-MM-DD')
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError('Date must be YYYY-MM-DD') from exc


def validate_schedule(resigned_on, starts_on, last_working_day):
    resigned, starts, last = map(parse_day, (resigned_on, starts_on, last_working_day))
    if starts < resigned:
        raise ValueError('Notice start cannot be earlier than resignation date')
    if last < starts:
        raise ValueError('Last working day cannot precede notice start')
    return {'resignation_date': resigned.isoformat(), 'notice_start_date': starts.isoformat(), 'last_working_day': last.isoformat()}


def local_today(timezone=DEFAULT_TZ, now=None):
    if now is None:
        now = datetime.now(ZoneInfo(timezone))
    elif now.tzinfo is None:
        raise ValueError('Timezone-aware datetime required')
    return now.astimezone(ZoneInfo(timezone)).date()


def status_for_day(notice, day):
    day = parse_day(day)
    if notice.get('notice_status') in ('cancelled', 'waived'):
        return notice.get('notice_status')
    if day < parse_day(notice['notice_start_date']):
        return 'scheduled'
    if day <= parse_day(notice['last_working_day']):
        return 'serving'
    return 'due_for_alumni'


def notice_lwp_dates(notice, leave_start, leave_end, working_day_predicate=None):
    """Return dates to classify as LWP; defaults to all dates, not holiday-aware.

    Caller MUST supply its existing attendance/holiday eligibility predicate before
    using these dates for actual salary deductions. Not a payroll engine.
    """
    first, last = parse_day(leave_start), parse_day(leave_end)
    if last < first:
        raise ValueError('Leave end precedes start')
    if (last - first).days > 366:
        raise ValueError('Leave range exceeds 366 days')
    a, b = parse_day(notice['notice_start_date']), parse_day(notice['last_working_day'])
    current = max(first, a)
    stop = min(last, b)
    out = []
    while current <= stop:
        if working_day_predicate is None or working_day_predicate(current):
            out.append(current.isoformat())
        current += timedelta(days=1)
    return out


def terminal_update(now):
    """Employment fields used by the existing Alumni UI and auth protection."""
    return {
        'is_alumni': True,
        'status': 'Resigned',
        'employment_status': 'Resigned',
        'skip_login': True,
        'notice_status': 'completed',
        'notice_completed_at': now,
        'updated_at': now,
    }


def notice_exit_due(employee, today=None):
    """Fail closed for scheduled notice records past their last working day.

    Existing immediate-resignation logic is handled separately.
    This helper does not modify an employee or database.
    """
    if not employee:
        return False

    status = str(employee.get("notice_status") or "").strip().lower()

    if status not in ("scheduled", "serving", "due_for_alumni"):
        return False

    last_day = employee.get("last_working_day")

    if not last_day:
        return True

    try:
        deadline = parse_day(last_day)
    except (ValueError, TypeError):
        return True

    return (today or local_today()) > deadline
