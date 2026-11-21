"""Local Conveyance approval routing and immutable/validated claim snapshots.

No Flask request context. Manager relationships are resolved exclusively inside the
same tenant, and validation never grants approval merely from a broad role.
"""
from decimal import Decimal
from bson import ObjectId
from app.services.local_conveyance import (MODE_TWO, MODE_FOUR, MODE_PUBLIC,
    MAX_FARE, MAX_KM, _amount, _money, _positive_rate)

MANAGER_ROLES = {'team_leader', 'reporting_officer', 'ro', 'manager'}
ACCOUNT_ROLES = {'finance', 'accounts_finance', 'accounts', 'accountant',
                 'accounts_manager', 'finance_manager'}
PAYMENT_ROLES = {'accounts_manager', 'finance_manager'}
OVERSIGHT_ROLES = {'admin', 'hr', 'hr_admin', 'hr_manager'}


def ids(employee):
    return {str(employee.get(k)).strip() for k in
        ('_id', 'user_id', 'employee_id', 'employee_code', 'emp_code') if employee.get(k)}


def _id_filter(value):
    """Match either a Mongo _id or the HRMS alternate employee references."""
    value = str(value or '').strip()
    matches = [{'employee_id': value}, {'employee_code': value},
               {'emp_code': value}, {'user_id': value}]
    if ObjectId.is_valid(value):
        matches += [{'_id': ObjectId(value)}, {'user_id': ObjectId(value)}]
    return {'$or': matches}


def _manager_key(employee, level):
    fields = ('team_leader_id', 'team_leader', 'team_leader_name') if level == 'team_leader' else (
        'reporting_officer_id', 'reporting_manager_id', 'reporting_officer',
        'reporting_manager', 'reporting_officer_name', 'manager_id', 'manager')
    for field in fields:
        raw = employee.get(field)
        if isinstance(raw, dict):
            raw = next((raw.get(k) for k in ('_id', 'id', 'employee_id', 'employee_code', 'name') if raw.get(k)), '')
        text = str(raw or '').strip()
        if text:
            return field, text
    return None, ''


def resolve_approver(db, tenant, employee):
    """Prioritise a mapped TL; otherwise the directly mapped Reporting Officer.

    Fail closed on missing/ambiguous mappings. Never route a claim to arbitrary
    managers or all users having the TL role.
    """
    for level in ('team_leader', 'reporting_officer'):
        field, value = _manager_key(employee, level)
        if not value:
            continue
        query = {'tenant_id': tenant, 'is_deleted': {'$ne': True}}
        if field.endswith('_name') or field in {'team_leader', 'reporting_officer', 'reporting_manager', 'manager'} and not ObjectId.is_valid(value):
            query['$or'] = [{'name': value}, {'full_name': value}, {'employee_name': value},
                            {'employee_code': value}, {'employee_id': value}]
        else:
            query.update(_id_filter(value))
        matches = list(db.employees.find(query).limit(2))
        if len(matches) != 1:
            raise ValueError(f'{level.replace("_", " ").title()} mapping is missing or ambiguous. Ask HR to correct the employee reporting hierarchy.')
        manager = matches[0]
        if str(manager['_id']) == str(employee['_id']):
            raise ValueError('Self-approval is not allowed. HR must map a separate approver.')
        return {'type': level, 'employee_ref_id': str(manager['_id']),
                'name': manager.get('name') or manager.get('full_name') or manager.get('employee_name') or '',
                'user_id': str(manager.get('user_id') or '')}
    raise ValueError('No Team Leader or Reporting Officer is mapped. Ask HR to update your reporting hierarchy before submission.')


def is_approver(bill, employee, roles):
    assigned = bill.get('approval') or {}
    if not employee or str(employee.get('_id')) != assigned.get('employee_ref_id'):
        return False
    if str(employee.get('_id')) == str(bill.get('employee_ref_id')):
        return False
    kind = assigned.get('type')
    return (kind == 'team_leader' and ('team_leader' in roles or str(employee.get('is_team_leader') or '').lower() in ('true', 'yes', '1'))) or (
        kind == 'reporting_officer' and (bool(roles & {'ro', 'reporting_officer', 'manager'}) or str(employee.get('is_reporting_officer') or '').lower() in ('true', 'yes', '1')))


def can_mark_paid(roles, employee):
    if roles & PAYMENT_ROLES:
        return True
    if not roles & ACCOUNT_ROLES or not employee:
        return False
    designation = str(employee.get('designation') or '').strip().lower().replace('(', '').replace(')', '')
    return designation in {'accounts manager', 'manager accounts', 'finance manager',
                           'manager finance', 'manager of accounts'}


def can_read(bill, employee, roles):
    if employee and str(bill.get('employee_ref_id')) in ids(employee):
        return True
    if roles & (ACCOUNT_ROLES | OVERSIGHT_ROLES):
        return bill.get('status') not in {'draft', 'pending_verification'}
    if employee and is_approver(bill, employee, roles):
        return bill.get('status') not in {'draft', 'pending_verification'}
    return False


def correction_lines(original_lines, edits):
    """Allow only claim-field corrections and recompute totals on server.

    Visit id, date, travel mode, starting KM, rate, and vehicle are immutable;
    a prior original snapshot is retained separately for reviewers.
    """
    if not isinstance(edits, list) or len(edits) != len(original_lines):
        raise ValueError('All original journeys must remain in the corrected bill')
    mapping = {str(item.get('visit_id')): item for item in edits if isinstance(item, dict)}
    if len(mapping) != len(original_lines):
        raise ValueError('Visit ids must be unique and match the original bill')
    result = []
    for line in original_lines:
        incoming = mapping.get(str(line['visit_id']))
        if incoming is None:
            raise ValueError('You cannot remove or add visits while correcting a bill')
        row = dict(line)
        for key, limit in (('from_location', 250), ('to_location', 250), ('purpose', 500),
                           ('project', 250), ('remarks', 500)):
            if key in incoming:
                row[key] = str(incoming[key] or '').strip()[:limit]
        if not row['from_location'] or not row['to_location'] or not row['purpose']:
            raise ValueError('From, To and Purpose must be completed for every journey')
        mode = row['mode']
        if mode in (MODE_TWO, MODE_FOUR):
            initial = _amount(row['start_km'], 'Starting KM', MAX_KM)
            ending = _amount(incoming.get('end_km', row.get('end_km')), 'Ending KM', MAX_KM)
            if ending < initial:
                raise ValueError('Ending KM cannot be lower than Starting KM')
            rate = _positive_rate(row['rate'])
            row.update({'end_km': _money(ending), 'distance_km': _money(ending-initial),
                        'amount': _money((ending-initial)*rate)})
        elif mode == MODE_PUBLIC:
            fare = _amount(incoming.get('fare', row.get('fare')), 'Fare', MAX_FARE)
            row.update({'fare': _money(fare), 'amount': _money(fare)})
        else:
            raise ValueError('Only reimbursable journeys can be corrected')
        result.append(row)
    total = _money(sum((Decimal(str(x['amount'])) for x in result), Decimal('0')))
    return result, total
