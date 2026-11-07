"""Admin notice-period endpoints. Requires explicit opt-in flag; off by default."""
from datetime import datetime, timezone
from bson import ObjectId
from flask import Blueprint, request, jsonify, g, current_app
from app.extensions import get_db
from app.utils.auth import current_user_required
from app.services.notice_period_service import validate_schedule, status_for_day, local_today, notice_lwp_dates

notice_period_bp = Blueprint('notice_period', __name__)
_ALLOWED = {'admin', 'hr_admin', 'hr_manager', 'hr', 'super_admin'}


def _guard():
    if not current_app.config.get('NOTICE_PERIOD_ENABLED', False):
        return jsonify({'message': 'Notice period feature is not enabled'}), 503
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
    data = request.get_json(silent=True) or {}
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
