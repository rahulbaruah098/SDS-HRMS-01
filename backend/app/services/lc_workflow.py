"""Local Conveyance approval routing and immutable/validated claim snapshots.

No Flask request context. Manager relationships are resolved exclusively inside the
same tenant, and validation never grants approval merely from a broad role.
"""
from decimal import Decimal
from bson import ObjectId
from app.services import team_responsibility as responsibility
from app.services.local_conveyance import (MODE_TWO, MODE_FOUR, MODE_PUBLIC,
    MAX_FARE, MAX_KM, _amount, _money, _positive_rate)

MANAGER_ROLES = {'team_leader', 'reporting_officer', 'ro', 'manager'}
ACCOUNT_ROLES = {'finance', 'accounts_finance', 'accounts', 'accountant',
                 'accounts_manager', 'finance_manager'}
PAYMENT_ROLES = {'accounts_manager', 'finance_manager'}
# Any Finance login can record an already-disbursed LC payment.
# Finance role can verify direct senior LC claims AND mark verified claims paid.
# Existing manager aliases remain supported for backward compatibility.
FINANCE_PAYMENT_ROLES = {'finance', 'accounts_finance'}

# SENIOR_DIRECT_ACCOUNTS_ROUTING_V1: allowed only for HR-managed designation values.
# No TL/RO assignment at all is required: broken/ambiguous assignments fail closed.
SENIOR_DESIGNATIONS = {
    'managing director', 'executive director', 'director',
    'chief executive officer', 'ceo', 'chief operating officer', 'coo',
    'chief financial officer', 'cfo', 'chairperson', 'chairman', 'president',
    'general manager', 'department head', 'head of department',
    'it head', 'head of it', 'hr head', 'head of hr',
    'operations head', 'head of operations', 'finance head', 'head of finance',
}
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


def _legacy_resolve_approver(db, tenant, employee):
    """Prioritise a mapped TL; otherwise the directly mapped Reporting Officer.

    Fail closed on missing/ambiguous mappings. Never route a claim to arbitrary
    managers or all users having the TL role.
    """
    # SENIOR_PLACEHOLDER_MANAGER_V2: HR role-name placeholders aren't real manager
    # references, but only a verified senior with NO actual mapping may bypass TL/RO.
    if senior_direct_accounts_eligible(employee) and _has_manager_placeholder(employee):
        raise ValueError('No assigned TL/RO: eligible senior LC claim requires Accounts Manager verification.')
    # A Team Leader's own claim must go to the Reporting Officer.
    approval_levels = (
        ('reporting_officer',)
        if responsibility.capability(employee, 'tl')
        else ('team_leader', 'reporting_officer')
    )
    for level in approval_levels:
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
        source_team = str(manager['_id']) if level == 'team_leader' else ''
        if level == 'team_leader':
            manager, state, _ = responsibility.effective(db, tenant, manager['_id'])
            if not manager:
                raise ValueError('Team Leader vacancy requires HR/Admin reassignment.')
        elif not responsibility.capability(manager, 'ro'):
            raise ValueError('Reporting Officer is unavailable. Ask HR to correct the mapping.')
        if str(manager['_id']) == str(employee['_id']):
            raise ValueError('Self-approval is not allowed. HR must map a separate approver.')
        return {'type': level, 'source_team_leader_id': source_team, 'employee_ref_id': str(manager['_id']),
                'name': manager.get('name') or manager.get('full_name') or manager.get('employee_name') or '',
                'user_id': str(manager.get('user_id') or '')}
    raise ValueError('No Team Leader or Reporting Officer is mapped. Ask HR to update your reporting hierarchy before submission.')


# Reporting fields must be checked as a WHOLE, not only _manager_key's first
# nonempty value. A later actual manager id must always block direct routing.
_LC_MANAGER_FIELDS = (
    'team_leader_id', 'team_leader', 'team_leader_name',
    'reporting_officer_id', 'reporting_manager_id', 'reporting_officer',
    'reporting_manager', 'reporting_officer_name', 'manager_id', 'manager',
)


def _manager_field_value(raw):
    if isinstance(raw, dict):
        if not raw:
            return ''
        # SENIOR_NESTED_EMPLOYEE_PLACEHOLDER_V3: HR UI sometimes stores a
        # display-only avatar object instead of an actual manager reference.
        # Reject ANY ID key, even blank: malformed mappings must fail closed.
        id_keys = {'_id', 'id', 'employee_id', 'employee_code', 'user_id',
                   'emp_code', 'username', 'manager_id', 'ref_id'}
        if id_keys.intersection(raw):
            return '__UNKNOWN_MANAGER_MAPPING__'
        allowed = {'name', 'title', 'display_name', 'employee_name',
                   'initials', 'photo_url', 'cover_url'}
        if not set(raw).issubset(allowed):
            return '__UNKNOWN_MANAGER_MAPPING__'
        labels = [raw.get(k) for k in ('name', 'title', 'display_name', 'employee_name')]
        # At least one explicit label is required. ALL nonblank labels must
        # be precisely the placeholder 'Employee', not a real manager's name.
        if not any(isinstance(v, str) and v.strip() for v in labels):
            return '__UNKNOWN_MANAGER_MAPPING__'
        if any(v is not None and (
                not isinstance(v, str) or
                (v.strip() and v.strip().casefold() != 'employee')) for v in labels):
            return '__UNKNOWN_MANAGER_MAPPING__'
        initials = raw.get('initials')
        if initials is not None and (
                not isinstance(initials, str) or
                initials.strip().casefold() not in ('', 'em')):
            return '__UNKNOWN_MANAGER_MAPPING__'
        for media in ('photo_url', 'cover_url'):
            if raw.get(media) not in (None, ''):
                return '__UNKNOWN_MANAGER_MAPPING__'
        return 'Employee'
    return str(raw or '').strip()


def _has_manager_placeholder(employee):
    return any(_manager_field_value(employee.get(field)).casefold() == 'employee'
               for field in _LC_MANAGER_FIELDS)


def senior_direct_accounts_eligible(employee):
    """Allow verified senior claims direct to Accounts only with no actual manager.

    Only the exact HR placeholder 'Employee' is treated as unassigned; genuine,
    conflicting or ambiguous manager mappings continue to block the bypass.
    Ordinary employees cannot bypass management even with placeholder values.
    """
    if not employee:
        return False

    if _is_managing_director(employee):
        return True
    designation = employee.get('designation') or ''
    if isinstance(designation, dict):
        designation = designation.get('name') or designation.get('title') or ''
    designation = ' '.join(str(designation).lower().replace('-', ' ').replace('_', ' ').split())
    senior = designation in SENIOR_DESIGNATIONS or employee.get('lc_direct_accounts_approval') is True
    if not senior:
        return False
    return all(_manager_field_value(employee.get(field)).casefold() in ('', 'employee')
               for field in _LC_MANAGER_FIELDS)


def is_direct_accounts_bill(bill):
    return (bill.get('approval') or {}).get('type') == 'direct_accounts_manager'


def direct_claimant(bill, employee, user_id=None):
    """Prevent the claimant from verifying/paying their own direct LC claim."""
    if employee and str(bill.get('employee_ref_id')) in ids(employee):
        return True
    return bool(user_id and str(bill.get('created_by') or '') == str(user_id))


def can_verify_accounts(bill, employee, roles, user_id=None):
    if direct_claimant(bill, employee, user_id):
        return False

    if is_direct_accounts_bill(bill):
        return can_mark_paid(roles, employee)

    return bool(roles & ACCOUNT_ROLES)


def can_confirm_payment(bill, employee, roles, user_id=None):
    return (
        can_mark_paid(roles, employee)
        and not direct_claimant(bill, employee, user_id)
    )


def _legacy_is_approver(bill, employee, roles, db=None):
    assigned = bill.get('approval') or {}
    if db is not None and assigned.get('type') == 'team_leader':
        return responsibility.can_lead(db, bill.get('tenant_id'), employee,
            assigned.get('source_team_leader_id') or assigned.get('employee_ref_id'), bill.get('employee_ref_id'))
    if not employee or str(employee.get('_id')) != assigned.get('employee_ref_id'):
        return False
    if str(employee.get('_id')) == str(bill.get('employee_ref_id')):
        return False
    kind = assigned.get('type')
    return (kind == 'team_leader' and ('team_leader' in roles or str(employee.get('is_team_leader') or '').lower() in ('true', 'yes', '1'))) or (
        kind == 'reporting_officer' and (bool(roles & {'ro', 'reporting_officer', 'manager'}) or str(employee.get('is_reporting_officer') or '').lower() in ('true', 'yes', '1')))


def _has_manager_payment_permission(roles, employee):
    """Retain existing manager aliases for verification and payment."""
    if roles & PAYMENT_ROLES:
        return True
    if not roles & ACCOUNT_ROLES or not employee:
        return False
    designation = str(employee.get('designation') or '').strip().lower().replace('(', '').replace(')', '')
    return designation in {'accounts manager', 'manager accounts', 'finance manager',
                           'manager finance', 'manager of accounts'}


def can_mark_paid(roles, employee):
    """Any authenticated Finance role may confirm payment after Accounts verification.

    This is permission only: bill state, tenant isolation and audit writes are
    enforced by the API. Job titles alone never grant payment access.
    """
    if roles & FINANCE_PAYMENT_ROLES:
        return True
    return _has_manager_payment_permission(roles, employee)


def can_read(bill, employee, roles, db=None):
    if employee and str(bill.get('employee_ref_id')) in ids(employee):
        return True
    if roles & (ACCOUNT_ROLES | OVERSIGHT_ROLES):
        return bill.get('status') not in {'draft', 'pending_verification'}
    if employee and is_approver(bill, employee, roles, db=db):
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


def _is_managing_director(employee):
    if not employee:
        return False

    designation = employee.get('designation') or ''

    if isinstance(designation, dict):
        designation = (
            designation.get('name')
            or designation.get('title')
            or ''
        )

    designation = ' '.join(
        str(designation).lower()
        .replace('_', ' ')
        .replace('-', ' ')
        .split()
    )

    return (
        designation == 'managing director'
        and responsibility.capability(employee, 'ro')
    )


def resolve_approver(db, tenant, employee):
    if employee.get('tenant_id') not in (None, tenant):
        raise ValueError('Invalid employee company mapping.')

    if _is_managing_director(employee):
        raise ValueError(
            'Managing Director claims require direct Finance verification.'
        )

    current = responsibility.resolve(
        db, tenant, employee.get('_id')
    )

    if not current:
        return _legacy_resolve_approver(
            db, tenant, employee
        )

    hierarchy = responsibility.hierarchy_for_employee(
        db, tenant, current
    )

    stage = responsibility.initial_manager_stage(
        db, tenant, current
    )

    manager = responsibility.stage_manager(
        db, tenant, current, stage
    )

    if not manager:
        if (
            not current.get('team_leader_id')
            and not current.get('reporting_officer_id')
            and not responsibility.capability(current, 'tl')
        ):
            return _legacy_resolve_approver(
                db, tenant, current
            )

        raise ValueError(
            'No independent active manager is available. '
            'Ask HR to resolve the reporting hierarchy.'
        )

    source = hierarchy.get('source')

    return {
        'type': stage,
        'source_team_leader_id': (
            str(source['_id']) if source else ''
        ),
        'employee_ref_id': str(manager['_id']),
        'name': (
            manager.get('name')
            or manager.get('full_name')
            or manager.get('employee_name')
            or ''
        ),
        'user_id': str(manager.get('user_id') or ''),
    }


def is_approver(bill, employee, roles, db=None):
    if not employee:
        return False

    if direct_claimant(bill, employee):
        return False

    if db is None:
        return _legacy_is_approver(
            bill, employee, roles, db=None
        )

    tenant = bill.get('tenant_id')

    if employee.get('tenant_id') != tenant:
        return False

    if not responsibility.employee_is_active(employee):
        return False

    if bill.get('status') != 'pending_manager':
        decision = bill.get('manager_validation') or {}

        if str(decision.get('by') or '') in ids(employee):
            return True

        return _legacy_is_approver(
            bill, employee, roles, db=db
        )

    claimant = responsibility.request_owner(
        db, tenant, bill, field='employee_ref_id'
    )

    if not claimant:
        return False

    try:
        assignment = resolve_approver(
            db, tenant, claimant
        )

    except ValueError:
        return False

    return (
        str(employee['_id'])
        == str(assignment.get('employee_ref_id'))
    )
