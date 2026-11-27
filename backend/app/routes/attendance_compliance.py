"""Attendance Compliance API; all identity and capability checks are server-side."""
from copy import deepcopy
from functools import wraps
from io import BytesIO
from datetime import timedelta
from flask import Blueprint, current_app, g, jsonify, request, send_file
from app.extensions import get_db
from app.utils.auth import current_user_required, find_employee_for_user, normalize_roles
from app.services import attendance_compliance as ac
from app.services.attendance_payroll_engine import ComplianceError, day, month_days, number
from app.services.team_responsibility import resolve
from app.services.payroll_config_service import PayrollConfigError
from app.services.payroll_attendance_service import PayrollAttendanceError
from app.services.payroll_tax_service import PayrollTaxError
from app.services.payroll_loan_service import PayrollLoanError
from app.services.payroll_reimbursement_service import PayrollReimbursementError

compliance_bp = Blueprint('attendance_compliance', __name__)


def access(kind='read'):
    def decorator(fn):
        @wraps(fn)
        @current_user_required
        def guarded(*args, **kwargs):
            roles = set(normalize_roles(g.current_user.get('roles', [])))
            tenant = g.current_user.get('tenant_id')
            if not tenant or roles & {'super_admin', 'superadmin', 'platform_super_admin'}:
                return jsonify(message='Tenant-scoped access is required.'), 403
            if kind == 'hr' and not roles & ac.HR or kind == 'payroll' and not roles & (ac.HR | ac.FINANCE):
                return jsonify(message='This action is not permitted for your role.'), 403
            g.compliance_tenant, g.compliance_roles = tenant, roles
            try:
                return fn(*args, **kwargs)
            except ComplianceError as exc:
                return jsonify(message=str(exc)), exc.status
            except (PayrollConfigError, PayrollAttendanceError, PayrollTaxError, PayrollLoanError, PayrollReimbursementError) as exc:
                return jsonify(message=str(exc)), getattr(exc, 'status_code', 400)
        return guarded
    return decorator


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or len(request.get_data()) > 200000:
        raise ComplianceError('A JSON object of at most 200 KB is required.')
    return data


def actor():
    return str(g.current_user['_id'])


def person(reference=None):
    db, tenant = get_db(), g.compliance_tenant
    own = find_employee_for_user(db, g.current_user)
    if not reference or reference == 'me':
        result = own
    elif g.compliance_roles & (ac.HR | ac.FINANCE):
        result = resolve(db, tenant, reference)
    else:
        result = own if own and reference == str(own['_id']) else None
    if not result:
        raise ComplianceError('Employee not found or unavailable to this account.', 404)
    return result


def period_arg(data=None):
    period = (data or {}).get('period') or request.args.get('period') or str(ac.local_now().date())[:7]
    month_days(period)
    return period


def public_summary(employee, period, own_statement=False):
    db, tenant = get_db(), g.compliance_tenant
    summary = ac.build_summary(db, tenant, employee, period)
    review = ac.review_for(db, tenant, employee, summary)
    summary['review'] = {k: review[k] for k in ('_id', 'approved_minutes', 'status', 'actor_id', 'reason', 'dispute_until')} if review else None
    summary['disputes'] = list(db.compliance_disputes.find({'tenant_id': tenant, 'employee_id': str(employee['_id']), 'period': period}))
    summary['review_status'] = 'Disputed' if any(r['status'] == 'pending' for r in summary['disputes']) else 'Approved' if review else 'Pending review'
    summary['pending_requests'] = sum(r['status'] == 'pending' for r in summary['disputes'])
    reversed_ids = {e.get('reverses') for e in summary['events']}
    live = [e for e in summary['events'] if e['kind'] == 'violation' and e['id'] not in reversed_ids]
    summary['violation_types'] = sorted({e['rule'] for e in live})
    summary['violation_counts'] = {code: sum(e['rule'] == code for e in live) for code in summary['violation_types']}
    summary['manual_violations'] = sum(not e.get('automatic') for e in live)
    if g.compliance_roles & ac.FINANCE and not g.compliance_roles & ac.HR and not own_statement:
        summary.pop('events', None)
        summary.pop('disputes', None)
    return ac.safe(summary)


@compliance_bp.get('/settings')
@access()
def settings():
    p = ac.policy(get_db(), g.compliance_tenant, request.args.get('on'))
    manage = bool(g.compliance_roles & ac.HR)
    payroll = bool(g.compliance_roles & (ac.HR | ac.FINANCE))
    if not payroll:
        p = {k: p[k] for k in ('enabled', 'connected', 'enforce', 'version', 'revision', 'monthly_points') if k in p}
    return jsonify(policy=p, can_manage=manage, can_payroll=payroll)


@compliance_bp.put('/settings')
@access('payroll')
def settings_save():
    result = ac.save_policy(get_db(), g.compliance_tenant, body(), actor(), payroll_only=not bool(g.compliance_roles & ac.HR))
    if result['enabled']:
        from app.services.attendance_compliance_worker import wake_worker
        wake_worker(current_app._get_current_object())
    return jsonify(policy=result)


@compliance_bp.get('/settings/history')
@access('payroll')
def settings_history():
    row = get_db().attendance_compliance_settings.find_one({'_id': ac.uid(g.compliance_tenant, 'settings'), 'tenant_id': g.compliance_tenant}) or {}
    return jsonify(items=ac.safe(row.get('versions', [])))


@compliance_bp.get('/employees')
@access('payroll')
def employees():
    query = {'tenant_id': g.compliance_tenant, 'is_deleted': {'$ne': True}}
    items = [{'_id': str(e['_id']), **{k: e.get(k, '') for k in ('name', 'employee_name', 'employee_code', 'employee_id', 'department', 'designation', 'state', 'location')}}
             for e in get_db().employees.find(query).sort('employee_name', 1).limit(5000)]
    return jsonify(items=items)


@compliance_bp.get('/projects')
@access('payroll')
def projects():
    items = [{'_id': str(row['_id']), 'name': row.get('name') or row.get('title', 'Project')} for row in get_db().projects.find({'tenant_id': g.compliance_tenant, 'is_deleted': {'$ne': True}}, {'name': 1, 'title': 1}).limit(5000)]
    return jsonify(items=items)


@compliance_bp.get('/summary/<reference>')
@access()
def summary(reference):
    employee = person(reference)
    period = period_arg()
    if reference == 'me':
        ac.ensure_current_allocation(get_db(), g.compliance_tenant, employee, period)
    result = public_summary(employee, period, own_statement=(reference == "me"))
    ac.audit(get_db(), g.compliance_tenant, 'compliance_view', actor(), str(employee['_id']), None, {'period': result['period']}, 'Viewed compliance statement')
    return jsonify(item=result)


@compliance_bp.get('/dashboard')
@access('payroll')
def dashboard():
    period = period_arg()
    try:
        page = max(1, int(request.args.get('page', 1)))
        limit = max(1, min(100, int(request.args.get('limit', 25))))
    except ValueError:
        raise ComplianceError('Page and limit must be integers.')
    query = {'tenant_id': g.compliance_tenant, 'is_deleted': {'$ne': True}}
    for field in ('department', 'designation', 'state', 'location'):
        if request.args.get(field):
            query[field] = request.args[field]
    people = list(get_db().employees.find(query))
    search = request.args.get('search', '').casefold()
    people = [e for e in people if not search or search in ' '.join(str(e.get(k, '')) for k in ('name', 'employee_name', 'employee_code', 'employee_id')).casefold()]
    if request.args.get('employee_id'):
        people = [e for e in people if str(e['_id']) == request.args['employee_id']]
    project_id = request.args.get('project_id')
    if project_id:
        from bson import ObjectId
        project = get_db().projects.find_one({'tenant_id': g.compliance_tenant, '_id': ObjectId(project_id)}) if ObjectId.is_valid(project_id) else None
        members = set(str(x) for x in (project or {}).get('assigned_employee_ids', []))
        members.update(str((project or {}).get(k, '')) for k in ('primary_assignee_id', 'team_leader_id'))
        people = [e for e in people if str(e['_id']) in members]
    items = [public_summary(e, period) for e in people]
    for field in ('review_status', 'status'):
        if request.args.get(field):
            items = [r for r in items if r[field] == request.args[field]]
    if request.args.get('violation_type'):
        code = request.args['violation_type']
        items = [r for r in items if code in r.get('violation_types', [])]
    if request.args.get('payroll_eligible') in ('yes', 'no'):
        items = [r for r in items if bool(r['eligible_minutes']) == (request.args['payroll_eligible'] == 'yes')]
    sort = request.args.get('sort', 'employee_name')
    if sort not in ('employee_name', 'employee_code', 'department', 'state', 'location', 'points', 'violations', 'shortage_minutes', 'eligible_minutes'):
        raise ComplianceError('Unsupported sort field.')
    items.sort(key=lambda r: r.get(sort, 0) if sort in ('points', 'violations', 'shortage_minutes', 'eligible_minutes') else str(r.get(sort, '')).casefold(), reverse=request.args.get('direction') == 'desc')
    stats = {'eligible_employees': len(items), 'allocated': sum(r['allocated'] for r in items),
        'consumed': sum(r['consumed'] for r in items), 'full_points': sum(r['points'] >= r['allocated'] > 0 for r in items),
        'low_points': sum(0 < r['points'] <= 1 for r in items), 'zero_points': sum(r['points'] == 0 for r in items),
        'violations': sum(r['violations'] for r in items), 'late_violations': sum(r['violation_counts'].get('late', 0) for r in items),
        'missing_checkouts': sum(r['violation_counts'].get('missing_checkout', 0) for r in items),
        'manual_violations': sum(r['manual_violations'] for r in items),
        'pending_requests': sum(r['pending_requests'] for r in items),
        'shortage_minutes': sum(r['shortage_minutes'] for r in items), 'requires_review': sum(r['requires_review'] for r in items),
        'eligible_minutes': sum(r['eligible_minutes'] for r in items)}
    return jsonify(items=items[(page - 1) * limit:page * limit], total=len(items), page=page, limit=limit, stats_scope='filtered_employees', stats=stats)



@compliance_bp.get('/export')
@access('payroll')
def export():
    # Bounded export avoids tying a Flask worker to an entire large tenant.
    from openpyxl import Workbook
    period = period_arg()
    selected = request.args.getlist('employee_id')
    if not selected or len(selected) > 100:
        raise ComplianceError('Select 1–100 employees to export.')
    book = Workbook(); sheet = book.active; sheet.title = 'Attendance Compliance'
    keys = ['employee_name', 'employee_code', 'department', 'period', 'allocated', 'consumed', 'points', 'violations',
            'required_minutes', 'accounted_minutes', 'shortage_minutes', 'lwp_excluded_minutes', 'eligible_minutes', 'review_status']
    sheet.append([k.replace('_', ' ').title() for k in keys])
    for reference in selected:
        row = public_summary(person(reference), period)
        values = [row.get(k, '') for k in keys]
        # Prevent spreadsheet formula injection from employee names/codes.
        sheet.append(["'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@')) else v for v in values])
    output = BytesIO(); book.save(output); output.seek(0)
    ac.audit(get_db(), g.compliance_tenant, 'compliance_export', actor(), period, None, {'employees': selected}, 'Exported compliance report')
    return send_file(output, as_attachment=True, download_name='attendance-compliance-' + period + '.xlsx', mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


@compliance_bp.post('/process')
@access('hr')
def process():
    data = body(); period = period_arg(data)
    selected = data.get('employee_ids', [])
    if not isinstance(selected, list) or not 1 <= len(selected) <= 100:
        raise ComplianceError('Select 1–100 employees to process.')
    for reference in selected:
        ac.process_employee(get_db(), g.compliance_tenant, person(reference), period, actor())
    return jsonify(ok=True, processed=len(selected))


@compliance_bp.post('/violations/preview')
@access('hr')
def violation_preview():
    data = body(); employee = person(data.get('employee_id')); on = str(day(data.get('date')))
    p = ac.policy(get_db(), g.compliance_tenant, on)
    rule = next((r for r in p['rules'] if r['code'] == data.get('rule') and r.get('enabled') and r.get('mode') == 'manual' and ac.applies(r, employee, on)), None)
    if not ac.policy(get_db(), g.compliance_tenant)['enabled'] or not p['enabled'] or not rule:
        raise ComplianceError('Compliance or the selected manual rule is not active on this date.')
    if ac.is_nonworking_day(p, employee, on, ac.calendar_holidays(get_db(), g.compliance_tenant, on, on)):
        raise ComplianceError('No attendance violation can be recorded on an applicable non-working day.')
    current = ac.ledger(get_db(), g.compliance_tenant, employee, on, p)
    balance = current['balance']
    if not current['version']:
        previous = get_db().employee_compliance_ledgers.find_one({'tenant_id': g.compliance_tenant, 'employee_id': str(employee['_id']), 'cycle': {'$lt': current['cycle']}}, sort=[('cycle', -1)])
        carry = min(previous['balance'], p['carry_max']) if previous and p['carry_forward'] else 0
        if previous and p['expiry_days'] and (day(on) - day(previous['cycle'])).days >= p['expiry_days']:
            carry = 0
        balance = float(min(number(p['balance_cap']), ac.allocation(p, employee, on) + number(carry)))
    if p['expiry_days'] and (day(on) - day(current['cycle'])).days >= p['expiry_days']:
        balance = 0
    event_id = ac.uid(g.compliance_tenant, str(employee['_id']), on, rule['code'], 'manual')
    charge = rule['points']
    if any(e['id'] == event_id for e in current['events']):
        charge = 0
    for cap, rows in [(rule.get('daily_max'), [e for e in current['events'] if e.get('date') == on]), (rule.get('monthly_max'), current['events'])]:
        if cap:
            charge = min(charge, max(0, cap - sum(e.get('charged', 0) for e in rows if e.get('rule') == rule['code'])))
    return jsonify(before=balance, points=charge, after=max(0, balance - charge), rule=rule)


@compliance_bp.post('/violations')
@access('hr')
def violation():
    data = body(); employee = person(data.get('employee_id')); on = str(day(data.get('date')))
    if day(on) > ac.local_now().date():
        raise ComplianceError('Future violations are not permitted.')
    p = ac.policy(get_db(), g.compliance_tenant, on)
    rule = next((r for r in p['rules'] if r['code'] == data.get('rule') and r.get('enabled') and r.get('mode') == 'manual' and ac.applies(r, employee, on)), None)
    if not ac.policy(get_db(), g.compliance_tenant)['enabled'] or not p['enabled'] or not rule or any(ac.applies(e, employee, on) for e in p['exemptions']):
        raise ComplianceError('No applicable manual compliance rule is active.')
    if ac.is_nonworking_day(p, employee, on, ac.calendar_holidays(get_db(), g.compliance_tenant, on, on)):
        raise ComplianceError('No attendance violation can be recorded on an applicable non-working day.')
    if rule['code'] == 'leave_not_applied' and data.get('leave_not_applied') is not True:
        raise ComplianceError('Confirm the leave application was not submitted.')
    why = ac.reason(data.get('reason'))
    ac.ensure_allocation(get_db(), g.compliance_tenant, employee, on, p)
    row = ac.post_event(get_db(), g.compliance_tenant, employee, on, {'id': ac.uid(g.compliance_tenant, str(employee['_id']), on, rule['code'], 'manual'),
        'kind': 'violation', 'rule': rule['code'], 'rule_snapshot': rule, 'delta': -rule['points'],
        'payroll_review': rule.get('payroll_review', False), 'reason': why, 'actor_id': actor(),
        'evidence_reference': str(data.get('evidence_reference', ''))[:500]}, p)
    ac.dispatch_employee_events(get_db(), g.compliance_tenant, employee)
    return jsonify(item=ac.safe(row)), 201


@compliance_bp.post('/points')
@access('hr')
def points():
    data = body(); employee = person(data.get('employee_id')); on = str(day(data.get('date')))
    if day(on) > ac.local_now().date():
        raise ComplianceError('Future point adjustments are not permitted.')
    why = ac.reason(data.get('reason'))
    if data.get('reverses'):
        row = ac.reverse_event(get_db(), g.compliance_tenant, employee, on, data['reverses'], actor(), why)
    else:
        p = ac.policy(get_db(), g.compliance_tenant, on)
        if not ac.policy(get_db(), g.compliance_tenant)['enabled'] or not p['enabled']:
            raise ComplianceError('Compliance is disabled on the selected date or currently.')
        amount = number(data.get('points'), 0)
        token = str(data.get('request_id', ''))
        if not 8 <= len(token) <= 100:
            raise ComplianceError('A request_id of 8–100 characters is required.')
        ac.ensure_allocation(get_db(), g.compliance_tenant, employee, on, p)
        row = ac.post_event(get_db(), g.compliance_tenant, employee, on, {'id': ac.uid(g.compliance_tenant, str(employee['_id']), token),
            'kind': 'additional', 'delta': float(amount), 'reason': why, 'actor_id': actor()}, p)
    ac.dispatch_employee_events(get_db(), g.compliance_tenant, employee)
    return jsonify(item=ac.safe(row))


@compliance_bp.post('/time-adjustments')
@access('hr')
def time_adjustment():
    data = body(); employee = person(data.get('employee_id'))
    if str(employee.get('user_id')) == actor():
        raise ComplianceError('You cannot verify your own working time.', 403)
    return jsonify(item=ac.safe(ac.add_time_adjustment(get_db(), g.compliance_tenant, employee, data, actor()))), 201


@compliance_bp.post('/reviews')
@access('hr')
def approve():
    data = body()
    return jsonify(item=ac.safe(ac.approve_summary(get_db(), g.compliance_tenant, person(data.get('employee_id')), period_arg(data), data, actor())))


@compliance_bp.post('/disputes')
@access()
def dispute():
    data = body(); employee = person('me'); period = period_arg(data)
    ac.editable(get_db(), g.compliance_tenant, employee, period)
    why = ac.reason(data.get('reason'))
    row = {'_id': ac.uid(g.compliance_tenant, str(employee['_id']), period, why, 'dispute'), 'tenant_id': g.compliance_tenant,
        'employee_id': str(employee['_id']), 'period': period, 'status': 'pending', 'reason': why, 'actor_id': actor(), 'created_at': ac.now().isoformat()}
    get_db().compliance_disputes.update_one({'_id': row['_id'], 'tenant_id': g.compliance_tenant}, {'$setOnInsert': row}, upsert=True)
    ac.audit(get_db(), g.compliance_tenant, 'compliance_dispute', actor(), row['_id'], None, row, why, event_id=ac.uid(row['_id'], 'audit'))
    from app.utils.notification_service import notify_users
    hr_users = [str(u['_id']) for u in get_db().users.find({'tenant_id': g.compliance_tenant, 'is_active': True, 'roles': {'$in': sorted(ac.HR)}})]
    notify_users(get_db(), hr_users, 'Attendance Compliance adjustment requested', 'An employee submitted a working-time dispute for HR review.',
        {'page': 'attendance_compliance', 'source_id': row['_id']}, tenant_id=g.compliance_tenant,
        event='compliance_dispute', event_key=row['_id'], defer_push=True)
    return jsonify(item=row), 201


@compliance_bp.post('/disputes/<reference>/resolve')
@access('hr')
def resolve_dispute(reference):
    data = body(); why = ac.reason(data.get('reason')); status = data.get('status')
    if status not in ('approved', 'rejected'):
        raise ComplianceError('Choose approved or rejected.')
    query = {'_id': reference, 'tenant_id': g.compliance_tenant, 'status': 'pending'}
    row = get_db().compliance_disputes.find_one(query)
    if not row:
        raise ComplianceError('Pending dispute not found.', 404)
    if row['actor_id'] == actor():
        raise ComplianceError('You cannot resolve your own dispute.', 403)
    employee = person(row['employee_id']); ac.editable(get_db(), g.compliance_tenant, employee, row['period'])
    after = {'status': status, 'resolved_by': actor(), 'resolution': why, 'resolved_at': ac.now().isoformat()}
    get_db().compliance_disputes.update_one(query, {'$set': after})
    ac.audit(get_db(), g.compliance_tenant, 'compliance_dispute_resolved', actor(), reference, row, after, why)
    # A resolution invalidates prior approvals; HR must review the corrected statement.
    get_db().compliance_payroll_reviews.update_many({'tenant_id': g.compliance_tenant, 'employee_id': row['employee_id'], 'period': row['period'], 'status': 'approved'}, {'$set': {'status': 'superseded_by_dispute'}})
    from app.utils.notification_service import notify_users
    if employee.get('user_id'):
        notify_users(get_db(), [employee['user_id']], 'Attendance Compliance request ' + status, why,
            {'page': 'attendance_compliance', 'source_id': reference}, tenant_id=g.compliance_tenant,
            event='compliance_dispute_resolved', event_key=ac.uid(reference, 'resolved'), defer_push=True)
    return jsonify(ok=True)


@compliance_bp.post('/simulate')
@access('payroll')
def simulate():
    from app.services.payroll_config_service import get_effective_salary_structure, get_effective_statutory_config
    from app.services.payroll_attendance_service import build_attendance_summary, resolve_payroll_period
    from app.services.payroll_calculation_service import calculate_payroll, PayrollCalculationError
    from app.services.payroll_tax_service import resolve_payroll_tax_context
    from app.services.attendance_payroll_integration import enhance_calculation
    from app.routes.payroll import _active_advances, _employee_state_code, _approved_payroll_reimbursements, _apply_reimbursements_to_calculation
    data = body(); employee = person(data.get('employee_id')); period = period_arg(data); db = get_db(); tenant = g.compliance_tenant
    structure = get_effective_salary_structure(db, tenant_id=tenant, employee_id=str(employee['_id']), on_date=str(month_days(period)[-1]))
    if not structure:
        raise ComplianceError('No effective employee salary structure exists.')
    statutory = get_effective_statutory_config(db, tenant_id=tenant, state_code=_employee_state_code(employee, structure), on_date=str(month_days(period)[-1]))
    if not statutory:
        raise ComplianceError('No effective statutory configuration exists.')
    attendance = db.attendance_summaries.find_one({'tenant_id': tenant, 'employee_id': str(employee['_id']), 'period_key': period, 'is_deleted': {'$ne': True}})
    if not attendance:
        attendance = build_attendance_summary(db, tenant, employee, resolve_payroll_period(period))
    # Simulation overrides are intentionally confined to non-statutory scenario inputs.
    if data.get('monthly_ctc') not in (None, ''):
        structure = {**structure, 'monthly_ctc': float(number(data['monthly_ctc'], 0))}
    tax = resolve_payroll_tax_context(db, tenant_id=tenant, employee_reference=str(employee['_id']), period_key=period)
    instruction = tax.get('tds') or {}
    statutory = {**deepcopy(statutory), 'tds': {**statutory.get('tds', {}), 'mode': instruction.get('mode', 'disabled')}}
    inputs = {'tds_amount': instruction.get('tds_amount', 0), 'advances': _active_advances(db, tenant, employee, period)}
    try:
        result = calculate_payroll(salary_structure=structure, statutory_config=statutory, attendance=attendance, inputs=inputs)
        result = enhance_calculation(db, tenant, employee, period, result, structure, statutory, attendance, inputs)
        result = _apply_reimbursements_to_calculation(result, _approved_payroll_reimbursements(db, tenant, employee, period))
    except PayrollCalculationError as exc:
        raise ComplianceError(str(exc))
    return jsonify(calculation=ac.safe(result), salary_structure=ac.safe(structure), simulation=True)
