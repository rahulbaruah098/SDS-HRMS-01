"""Admin notice-period endpoints. Requires explicit opt-in flag; off by default."""
from datetime import datetime, timezone
from bson import ObjectId
from flask import Blueprint, request, jsonify, g, current_app
from app.extensions import get_db
from app.utils.auth import current_user_required
from app.services.notice_period_service import validate_schedule, status_for_day, local_today, notice_lwp_dates

notice_period_bp = Blueprint('notice_period', __name__)
_ALLOWED = {'admin', 'hr_admin', 'hr_manager', 'hr', 'super_admin'}


def _guard(require_enabled=True):
    # HR/Admin authorization is mandatory. No global env toggle is needed for
    # explicit, authenticated requests; the independent background worker stays locked.
    roles = set((g.current_user or {}).get('roles') or [])
    if not (roles & _ALLOWED):
        return jsonify({'message': 'HR/Admin role required'}), 403
    tenant = (g.current_user or {}).get('tenant_id')
    if not isinstance(tenant, str) or not tenant.strip():
        return jsonify({'message': 'Company assignment is missing'}), 403
    return None


def _emp_id(value):
    if not ObjectId.is_valid(value):
        return None
    return ObjectId(value)


@notice_period_bp.route('/<employee_id>', methods=['GET'])
@current_user_required
def get_notice(employee_id):
    denial = _guard()
    if denial:
        return denial
    oid = _emp_id(employee_id)
    if oid is None:
        return jsonify({'message': 'Invalid employee ID'}), 400
    employee = get_db().employees.find_one({'_id': oid, 'tenant_id': g.current_user['tenant_id'], 'is_deleted': {'$ne': True}}, {'notice_status': 1, 'notice_start_date': 1, 'resignation_date': 1, 'last_working_day': 1, 'is_alumni': 1})
    if not employee:
        return jsonify({'message': 'Employee not found'}), 404
    employee.pop('_id', None)
    if employee.get('notice_start_date') and employee.get('last_working_day'):
        employee['computed_notice_status'] = status_for_day(employee, local_today())
    return jsonify(employee)


@notice_period_bp.route('/<employee_id>', methods=['PUT'])
@current_user_required
def schedule_notice(employee_id):
    denial = _guard()
    if denial:
        return denial
    oid = _emp_id(employee_id)
    if oid is None:
        return jsonify({'message': 'Invalid employee ID'}), 400
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get('confirmed') is not True:
        return jsonify({'message': 'Explicit HR confirmation is required'}), 400
    try:
        dates = validate_schedule(data.get('resignation_date'), data.get('notice_start_date'), data.get('last_working_day'))
    except ValueError as exc:
        return jsonify({'message': str(exc)}), 400
    tenant = g.current_user['tenant_id']
    db = get_db()
    query = {'_id': oid, 'tenant_id': tenant, 'is_deleted': {'$ne': True}, 'is_alumni': {'$ne': True}, 'notice_status': {'$nin': ['completed']}}
    employee = db.employees.find_one(query, {'_id': 1, 'tenant_id': 1, 'status': 1, 'employment_status': 1, 'skip_login': 1})
    if not employee:
        return jsonify({'message': 'Active employee not found'}), 404
    if str(employee.get('status', '')).strip().lower() in {'resigned', 'alumni', 'inactive', 'terminated', 'left'} or str(employee.get('employment_status', '')).strip().lower() in {'resigned', 'alumni', 'inactive', 'terminated', 'left'} or employee.get('skip_login') is True:
        return jsonify({'message': 'Employee has already exited or login was deactivated'}), 409
    # Historical approved leave may already have reduced CL/EL balances.
    # Stop instead of silently changing payroll classification without refunds.
    existing_approved = db.leave_requests.find_one({
        'tenant_id': tenant,
        'employee_id': str(oid),
        'status': 'approved',
        'approval_stage': 'approved',
        'is_deleted': {'$ne': True},
        'from_date': {'$lte': dates['last_working_day']},
        'to_date': {'$gte': dates['notice_start_date']},
    }, {'_id': 1})
    if existing_approved:
        return jsonify({'message': 'Approved leave overlaps notice period. HR must reconcile paid leave balances before scheduling.'}), 409
    now = datetime.now(timezone.utc)
    status = status_for_day({**dates, 'notice_status': 'scheduled'}, local_today())
    update = {**dates, 'notice_status': status, 'notice_policy': 'leave_during_notice_is_lwp', 'notice_updated_at': now, 'notice_updated_by': str(g.current_user['_id'])}
    result = db.employees.update_one(query, {'$set': update})
    if result.matched_count != 1:
        return jsonify({'message': 'Employee state changed; retry'}), 409
    # Preserve every revision inside one event document to satisfy the unique
    # tenant/employee/event index and retain the audit history of rescheduling.
    db.notice_period_events.update_one(
        {'tenant_id': tenant, 'employee_id': str(oid), 'event': 'schedule_updated'},
        {'$setOnInsert': {'created_at': now}, '$push': {'revisions': {
            'actor_user_id': str(g.current_user['_id']), 'at': now, 'dates': dates,
        }}}, upsert=True,
    )
    return jsonify({'message': 'Notice period scheduled', 'notice': {**dates, 'notice_status': status}})


@notice_period_bp.route('/<employee_id>/lwp-preview', methods=['POST'])
@current_user_required
def lwp_preview(employee_id):
    denial = _guard()
    if denial:
        return denial
    oid = _emp_id(employee_id)
    if oid is None:
        return jsonify({'message': 'Invalid employee ID'}), 400
    doc = get_db().employees.find_one({'_id': oid, 'tenant_id': g.current_user['tenant_id'], 'is_deleted': {'$ne': True}})
    if not doc or not doc.get('notice_start_date'):
        return jsonify({'message': 'Notice period not configured'}), 404
    data = request.get_json(silent=True) or {}
    try:
        dates = notice_lwp_dates(doc, data.get('leave_start'), data.get('leave_end'))
    except ValueError as exc:
        return jsonify({'message': str(exc)}), 400
    return jsonify({'candidate_lwp_dates': dates, 'working_day_filter_applied': False, 'payroll_applied': False, 'message': 'Preview only. Working-day and leave-approval policies must be integrated before payroll deduction.'})


@notice_period_bp.route('/<employee_id>/reconciliation-preview', methods=['POST'])
@current_user_required
def reconciliation_preview(employee_id):
    """Read-only, server-calendar-grounded HR review of historical leave.

    No client-provided working dates, refund amounts or fingerprints are trusted.
    The existing PUT route remains unchanged and blocks approved overlaps.
    """
    # The review is read-only and available independently of execution flags.
    denial = _guard(require_enabled=False)
    if denial:
        return denial
    oid = _emp_id(employee_id)
    if oid is None:
        return jsonify({'message': 'Invalid employee ID'}), 400
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'message': 'JSON object required'}), 400
    try:
        dates = validate_schedule(
            payload.get('resignation_date'), payload.get('notice_start_date'),
            payload.get('last_working_day'),
        )
    except (ValueError, TypeError) as exc:
        return jsonify({'message': str(exc)}), 400

    tenant = g.current_user['tenant_id']
    db = get_db()
    employee = db.employees.find_one({
        '_id': oid, 'tenant_id': tenant, 'is_deleted': {'$ne': True},
        'is_alumni': {'$ne': True}, 'notice_status': {'$nin': ['completed']},
    })
    if not employee:
        return jsonify({'message': 'Active employee not found'}), 404
    if (employee.get('skip_login') is True or
        str(employee.get('status') or '').strip().lower() in
            {'resigned', 'alumni', 'inactive', 'terminated', 'left'} or
        str(employee.get('employment_status') or '').strip().lower() in
            {'resigned', 'alumni', 'inactive', 'terminated', 'left'}):
        return jsonify({'message': 'Employee is not eligible for notice scheduling'}), 409
    try:
        from app.services.notice_leave_review_context import build_trusted_notice_review
        review = build_trusted_notice_review(db, employee, dates)
    except ValueError as exc:
        return jsonify({'message': str(exc), 'requires_manual_review': True}), 409
    # The review is informational, not an execution token.
    return jsonify({
        'message': 'Preview only; no schedule or refund was executed',
        'notice': dates, 'review': review,
        'working_day_filter_applied': True,
        'authorization_granted': False, 'writes_performed': False,
        'scheduling_enabled': True,
        'refund_execution_enabled': True,
    })


@notice_period_bp.route('/<employee_id>/reconciliation-apply', methods=['POST'])
@current_user_required
def reconciliation_apply(employee_id):
    """HR-reviewed atomic notice scheduling and historic paid-leave reconciliation.

    This route is doubly gated. Neither the review endpoint nor the normal PUT
    notice endpoint can enable refund writes. The browser supplies dates and a
    previously reviewed fingerprint, never leave records or working-day inputs.
    """
    denial = _guard()
    if denial:
        return denial
    # Historical corrections require the HR-reviewed fingerprint, a second
    # confirmation, and the MongoDB transaction enforced below.

    oid = _emp_id(employee_id)
    if oid is None:
        return jsonify({'message': 'Invalid employee ID'}), 400
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'message': 'JSON object required'}), 400
    try:
        dates = validate_schedule(
            payload.get('resignation_date'), payload.get('notice_start_date'),
            payload.get('last_working_day'),
        )
    except (ValueError, TypeError) as exc:
        return jsonify({'message': str(exc)}), 400
    if payload.get('confirmed') is not True:
        return jsonify({'message': 'Explicit HR confirmation is required'}), 400
    fingerprint = payload.get('review_fingerprint')
    if not isinstance(fingerprint, str) or len(fingerprint) != 64 or any(
        ch not in '0123456789abcdef' for ch in fingerprint
    ):
        return jsonify({'message': 'Valid HR review fingerprint required'}), 400
    reviewer_id = str((g.current_user or {}).get('_id') or '')
    if not reviewer_id:
        return jsonify({'message': 'Authenticated HR reviewer required'}), 403

    tenant = g.current_user['tenant_id']
    db = get_db()
    employee = db.employees.find_one({
        '_id': oid, 'tenant_id': tenant, 'is_deleted': {'$ne': True},
        'is_alumni': {'$ne': True}, 'notice_status': {'$nin': ['completed']},
    })
    if employee is None:
        return jsonify({'message': 'Active employee not found'}), 404
    if (employee.get('skip_login') is True or
        str(employee.get('status') or '').strip().lower() in
            {'resigned', 'alumni', 'inactive', 'terminated', 'left'} or
        str(employee.get('employment_status') or '').strip().lower() in
            {'resigned', 'alumni', 'inactive', 'terminated', 'left'}):
        return jsonify({'message': 'Employee is no longer eligible'}), 409

    try:
        from app.services.notice_leave_review_context import (
            build_trusted_notice_review, _approved_overlap, _day,
            MAX_DAYS_PER_LEAVE, MAX_TOTAL_CALENDAR_DAYS,
        )
        from app.routes.attendance import is_working_day_for_employee
        from app.services.notice_leave_refund_transaction import (
            apply_reviewed_historic_notice_refunds,
            NoticeRefundConflict,
            NoticeRefundNotAuthorized,
        )
        from datetime import timedelta

        # Recalculate the full preview from trusted DB rows and the server's
        # working-day policy. Client-supplied leave rows and dates are ignored.
        review = build_trusted_notice_review(db, employee, dates)
        if review['review_fingerprint'] != fingerprint:
            return jsonify({'message': 'HR review has changed; preview again'}), 409
        if not review.get('adjustments'):
            return jsonify({'message': 'No refundable approved leave; use regular scheduling'}), 409

        leaves = _approved_overlap(db, employee, dates)
        entries = []
        total_days = 0
        for leave in leaves:
            first, last = _day(leave.get('from_date')), _day(leave.get('to_date'))
            count = (last - first).days + 1
            if count <= 0 or count > MAX_DAYS_PER_LEAVE:
                raise ValueError('Historical leave date range requires manual review')
            total_days += count
            if total_days > MAX_TOTAL_CALENDAR_DAYS:
                raise ValueError('Historical leave volume requires manual review')
            working = []
            day = first
            while day <= last:
                if is_working_day_for_employee(db, employee, day):
                    working.append(day.isoformat())
                day += timedelta(days=1)
            entries.append((leave, working))

        # Recheck the exact evidence handed to the executor. The transaction
        # itself verifies the current employee/leave/balance states and ensures
        # schedule, refund, leave ledgers, and audits commit or abort together.
        from app.services.notice_leave_adjustment_plan import plan_historic_notice_adjustments
        again = plan_historic_notice_adjustments(
            employee=employee, proposed_notice=dates,
            leaves_with_working_dates=entries,
        )
        if again['review_fingerprint'] != fingerprint:
            return jsonify({'message': 'HR review changed; preview again'}), 409
        outcome = apply_reviewed_historic_notice_refunds(
            db=db, employee=employee, proposed_notice=dates,
            leaves_with_working_dates=entries,
            expected_fingerprint=fingerprint, reviewer_id=reviewer_id,
            schedule_notice=dates, enable_writes=True,
        )
    except (ValueError, NoticeRefundConflict, NoticeRefundNotAuthorized) as exc:
        return jsonify({'message': str(exc), 'requires_manual_review': True}), 409
    # Database exceptions are deliberately not translated to success or
    # swallowed: Flask will return a 500 and transaction aborts on exception.
    return jsonify({
        'message': 'Notice and historical leave corrections committed',
        'notice': dates,
        'refund_count': outcome['refund_count'],
        'review_fingerprint': outcome['review_fingerprint'],
        'notice_scheduled': outcome['notice_scheduled'],
    })
