"""Read-only HR notice review using the existing attendance/holiday policy.

Caller MUST be an authenticated, tenant-authorized server route. This module
is not an authorization or write service. Working-day eligibility is never
accepted from the browser; it is derived from the same rule as attendance.
"""
from datetime import date, timedelta

from app.services.notice_leave_adjustment_plan import plan_historic_notice_adjustments, NoticeAdjustmentPlanRejected

MAX_APPROVED_LEAVES = 100
MAX_DAYS_PER_LEAVE = 366
MAX_TOTAL_CALENDAR_DAYS = 4000


def _day(value):
    if isinstance(value, date):
        return date.fromisoformat(value.isoformat()[:10])
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError('Historical leave dates require YYYY-MM-DD')
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError('Invalid historical leave date') from exc


def _approved_overlap(db, employee, dates):
    query = {
        'tenant_id': employee['tenant_id'],
        'employee_id': str(employee['_id']),
        'status': 'approved', 'approval_stage': 'approved',
        'is_deleted': {'$ne': True},
        'from_date': {'$lte': dates['last_working_day']},
        'to_date': {'$gte': dates['notice_start_date']},
    }
    docs = list(db.leave_requests.find(query).limit(MAX_APPROVED_LEAVES + 1))
    if len(docs) > MAX_APPROVED_LEAVES:
        raise ValueError('Too many approved leaves; manual reconciliation required')
    return docs


def build_trusted_notice_review(db, employee, dates):
    """Return a deterministic read-only plan, not a refund authorization.

    The service intentionally fails closed for ambiguous dates, overlapping
    leave requests and excessive history. Holiday detection uses the same
    employee-specific policy as attendance and payroll.
    """
    if not isinstance(employee, dict) or not employee.get('_id') or not employee.get('tenant_id'):
        raise ValueError('Valid tenant employee required')
    if not isinstance(dates, dict):
        raise ValueError('Valid notice dates required')
    from app.services.notice_period_service import validate_schedule
    dates = validate_schedule(dates.get('resignation_date'), dates.get('notice_start_date'), dates.get('last_working_day'))
    from app.routes.attendance import is_working_day_for_employee

    leaves = _approved_overlap(db, employee, dates)
    entries = []
    occupied = set()
    total_days = 0
    for leave in leaves:
        if leave.get('tenant_id') != employee['tenant_id'] or str(leave.get('employee_id')) != str(employee['_id']):
            raise ValueError('Historical leave tenant/employee mismatch')
        start = _day(leave.get('from_date'))
        end = _day(leave.get('to_date'))
        if end < start or (end - start).days + 1 > MAX_DAYS_PER_LEAVE:
            raise ValueError('Unsupported historical leave range')
        total_days += (end - start).days + 1
        if total_days > MAX_TOTAL_CALENDAR_DAYS:
            raise ValueError('Too many historical calendar dates')
        working = []
        current = start
        while current <= end:
            if is_working_day_for_employee(db, employee, current):
                key = current.isoformat()
                if key in occupied:
                    raise ValueError('Overlapping approved working dates require HR review')
                occupied.add(key)
                working.append(key)
            current += timedelta(days=1)
        entries.append((leave, working))
    try:
        plan = plan_historic_notice_adjustments(
            employee=employee, proposed_notice=dates, leaves_with_working_dates=entries,
        )
    except (NoticeAdjustmentPlanRejected, ValueError) as exc:
        raise ValueError('Historical leave requires HR review: ' + str(exc)) from exc
    return {**plan, 'approved_leaves_examined': len(entries),
            'working_day_policy': 'tenant-state HR holidays; Sunday; 2nd/4th Saturday',
            'authorization_granted': False, 'writes_performed': False}
