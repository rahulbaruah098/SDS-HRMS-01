"""Additive integration at the existing draft calculation boundary. Read-only."""
from copy import deepcopy
from decimal import Decimal, ROUND_FLOOR
from . import attendance_compliance as ac
from .attendance_payroll_engine import ComplianceError, BASES, calculate_components, number, money, month_days
from .payroll_calculation_service import calculate_payroll, PayrollCalculationError


def enhance_calculation(db, tenant, employee, period, calculation, salary_structure, statutory_config, attendance, inputs):
    try:
        return _enhance(db, tenant, employee, period, calculation, salary_structure, statutory_config, attendance, inputs)
    except ComplianceError as exc:
        raise PayrollCalculationError(str(exc), code='attendance_payroll_validation', field='attendance_compliance')


def _enhance(db, tenant, employee, period, calculation, structure, statutory, attendance, inputs):
    p = ac.policy(db, tenant, period + '-01')
    current = ac.policy(db, tenant)
    end_policy = ac.policy(db, tenant, str(month_days(period)[-1]))
    # Byte-for-byte default behavior: no new fields or reads of employee attendance.
    if not p['components'] and not end_policy['connected']:
        return calculation
    result = deepcopy(calculation)
    summary = ac.build_summary(db, tenant, employee, period) if end_policy['connected'] else None
    review = ac.review_for(db, tenant, employee, summary) if summary else None
    components = p['components']
    if components:
        values = {k: 0 for k in BASES}
        values.update({k: v for k, v in calculation['totals'].items() if k in BASES})
        values.update({row['code']: row['amount'] for row in calculation['earnings'] if row['code'] in BASES})
        values.update({k: v or 0 for k, v in calculation['attendance'].items() if k in BASES})
        values['monthly_ctc'] = structure['monthly_ctc']
        if summary:
            values.update({k: summary[k] for k in ('required_minutes', 'accounted_minutes', 'shortage_minutes')})
            values['approved_minutes'] = review['approved_minutes'] if review else 0
            values['minutes'] = summary['accounted_minutes']
            values['hours'] = number(values['minutes']) / 60
        employee_context = {**employee, 'salary_structure_id': str(structure.get('_id', ''))}
        dynamic = calculate_components(components, values, employee_context, period)
        expanded = deepcopy(structure)
        expanded['_dynamic_resolved_components'] = {r['code']: r['amount'] for r in dynamic}
        expanded['components'] = [r for r in expanded['components'] if r['code'] not in expanded['_dynamic_resolved_components']]
        for row in dynamic:
            if row['category'] == 'information':
                continue
            expanded['components'].append({**row, 'calculation_type': 'fixed',
                'display_order': row.get('sequence', 200), 'is_active': True,
                'show_in_earnings': row['category'] in ('earning', 'employer_contribution'),
                'show_in_deductions': row['category'] == 'deduction'})
        # Reuse statutory and LWP handling with the fully resolved earning bases.
        result = calculate_payroll(salary_structure=expanded, statutory_config=statutory, attendance=attendance, inputs=inputs, allow_dynamic_components=True)
        result['dynamic_payroll_snapshot'] = {'policy': p, 'components': dynamic, 'expanded_salary_structure': ac.safe(expanded)}
    if not summary:
        return result
    warnings = []
    approved = review['approved_minutes'] if review else 0
    permitted = all(current[k] and end_policy[k] for k in ('enabled', 'connected', 'enforce'))
    if not review:
        warnings.append('Attendance shortage is not approved against the current source data.')
    elif ac.local_now().isoformat() < review['dispute_until']:
        permitted = False
        warnings.append('Employee dispute window remains open.')
    if db.compliance_disputes.count_documents({'tenant_id': tenant, 'employee_id': str(employee['_id']), 'period': period, 'status': 'pending'}):
        permitted = False
        warnings.append('An employee attendance dispute remains unresolved.')
    # Legacy manual day-only LWP has no interval identity. Do not guess its coverage.
    if number(attendance.get('lwp_days', attendance.get('lwpDays', 0)), 0) > 0:
        dated_lwp_days = sum(bool(r['lwp_excluded_minutes']) for r in summary['days'])
        if number(attendance.get('lwp_days', attendance.get('lwpDays', 0))) > dated_lwp_days:
            permitted = False
            warnings.append('Legacy LWP lacks sufficient date allocations; reconcile LWP before compliance enforcement.')
    if number(inputs.get('salary_proration_days', 0), 0):
        permitted = False
        warnings.append('Salary proration requires a separate interval allocation; compliance deduction is held.')
    wage_rows = {r['code']: r for r in result['earnings']}
    missing = set(end_policy['wage_codes']) - wage_rows.keys()
    if missing:
        permitted = False
        warnings.append('Configured compliance wage components are missing: ' + ', '.join(sorted(missing)))
    wage = sum((number(wage_rows[c]['amount'], 0) for c in end_policy['wage_codes'] if c in wage_rows), Decimal(0))
    amount = Decimal(0)
    if permitted and review and approved and summary['required_minutes']:
        cap = wage * number(end_policy['deduction_cap_percent']) / 100
        quantum = Decimal('.01') if end_policy['rounding'] == 'two_decimals' else Decimal('1')
        cap = cap.quantize(quantum, rounding=ROUND_FLOOR)
        amount = min(money(wage / summary['required_minutes'] * approved, end_policy['rounding']), cap)
        amount = min(amount, number(result['totals']['net_amount'], 0))
    if amount:
        result['deductions'].append({'code': 'attendance_compliance', 'label': 'Attendance Compliance Deduction',
            'amount': float(amount), 'full_amount': float(amount), 'payable_amount': float(amount), 'category': 'deduction',
            'display_order': 190, 'source': 'attendance_compliance', 'metadata': {'review_id': review['_id'],
                'wage_basis': str(wage), 'required_minutes': summary['required_minutes'], 'approved_minutes': approved,
                'allocations': review['allocations']}})
        result['totals']['total_deductions'] = float(money(number(result['totals']['total_deductions']) + amount))
        result['totals']['net_amount'] = float(money(number(result['totals']['net_amount']) - amount))
        result['totals']['attendance_compliance_deduction'] = float(amount)
    result['attendance_compliance_snapshot'] = {'summary': summary, 'review': review, 'policy': end_policy,
        'current_controls': {k: current[k] for k in ('enabled', 'connected', 'enforce')},
        'wage_basis': str(wage), 'approved_minutes': approved, 'deduction': float(amount), 'warnings': warnings}
    result['warnings'].extend(warnings)
    return result


def validate_workflow_snapshots(db, tenant, payslips):
    """Fail closed before review/approval/lock; locked disbursements remain frozen."""
    from .team_responsibility import resolve
    for slip in payslips:
        snapshot = slip.get('attendance_compliance_snapshot') or {}
        if not number(snapshot.get('deduction', 0)):
            continue
        current = ac.policy(db, tenant)
        if not all(current[k] for k in ('enabled', 'connected', 'enforce')):
            raise ComplianceError('Compliance controls changed. Recalculate the draft payroll before approval.', 409)
        employee = resolve(db, tenant, slip['employee_id'])
        if not employee:
            raise ComplianceError('Payroll employee no longer resolves in this tenant.', 409)
        summary = ac.build_summary(db, tenant, employee, slip['period_key'])
        review = ac.review_for(db, tenant, employee, summary)
        if not review or summary['fingerprint'] != snapshot['summary']['fingerprint'] or review['_id'] != (snapshot.get('review') or {}).get('_id'):
            raise ComplianceError('Compliance source or approval changed. Recalculate payroll before approval.', 409)
        if ac.local_now().isoformat() < review['dispute_until'] or db.compliance_disputes.count_documents({'tenant_id': tenant, 'employee_id': slip['employee_id'], 'period': slip['period_key'], 'status': 'pending'}):
            raise ComplianceError('Resolve the attendance dispute window before payroll approval.', 409)
