"""Tenant-safe, employee-owned monthly Local Conveyance approval and payment workflow."""
from datetime import datetime
from decimal import Decimal
from io import BytesIO

from flask import Blueprint, current_app, jsonify, request, send_file
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.extensions import get_db
from app.middleware.tenant_guard import tenant_module_required
from app.routes.field_visits import (get_current_employee, current_tenant_id,
    current_user_id, current_user_roles, employee_name, employee_identity_values)
from app.services.local_conveyance import (MODE_TWO, MODE_FOUR, MODE_PUBLIC,
    tenant_rates, validate_rates)
from app.services.local_conveyance_pdf import render_lc_bill_pdf
from app.services.lc_workflow import (ACCOUNT_ROLES, PAYMENT_ROLES, FINANCE_PAYMENT_ROLES, OVERSIGHT_ROLES,
    can_read, can_mark_paid, can_verify_accounts, can_confirm_payment,
    senior_direct_accounts_eligible, is_direct_accounts_bill, correction_lines,
    is_approver, resolve_approver, MANAGER_ROLES)
from app.utils.auth import audit
from app.utils.serializers import clean_doc

lc_bp = Blueprint('local_conveyance', __name__)
BILL_TYPES = {MODE_TWO, MODE_FOUR, MODE_PUBLIC}
REVIEW_STATES = {'pending_manager', 'pending_accounts', 'verified', 'paid', 'rejected'}


def _error(message, status=400, code=None):
    return jsonify({'message': message, **({'code': code} if code else {})}), status


def _valid_period(payload):
    try:
        year, month = int(payload.get('year')), int(payload.get('month'))
        if not 2020 <= year <= 2100 or not 1 <= month <= 12:
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('Please select a valid LC month and year')
    return year, month


def _bill(db, ref):
    return db.local_conveyance_bills.find_one({'tenant_id': current_tenant_id(), 'reference': str(ref)})


def _owner(bill, employee):
    return bool(employee and str(bill.get('employee_ref_id')) in employee_identity_values(employee))


def _optimistic_filter(bill):
    query = {'_id': bill['_id'], 'tenant_id': current_tenant_id(), 'status': bill.get('status')}
    query['revision'] = bill['revision'] if 'revision' in bill else {'$exists': False}
    return query


def _serialize_with_actions(db, bill):
    employee = get_current_employee(db)
    roles = current_user_roles()
    visible = clean_doc(bill)
    visible['capabilities'] = {
        'can_submit': _owner(bill, employee) and bill.get('status') in {'draft', 'rejected', 'pending_verification'},
        'can_correct': _owner(bill, employee) and bill.get('status') == 'rejected',
        'can_manager_validate': is_approver(bill, employee, roles) and bill.get('status') == 'pending_manager',
        'can_accounts_verify': can_verify_accounts(bill, employee, roles, current_user_id()) and bill.get('status') == 'pending_accounts',
        'can_mark_paid': (can_confirm_payment(bill, employee, roles, current_user_id())
                          and bill.get('status') == 'verified'
                          and bool(bill.get('accounts_verification'))),
        'direct_accounts': is_direct_accounts_bill(bill),
    }
    return visible


def _updated(db, ref):
    return jsonify({'message': 'LC bill updated', 'item': _serialize_with_actions(db, _bill(db, ref))})


def _record(db, bill, action, comment='', **meta):
    audit('lc_' + action, 'local_conveyance_bills', bill['_id'],
          {'reference': bill['reference'], 'action': action, 'comment': comment, **meta})


def _notify(db, user_ids, title, body, reference, target='my_local_conveyance'):
    """Best-effort tenant-scoped bell notifications; do not rollback an approved transaction."""
    try:
        now = datetime.utcnow()
        ids = sorted({str(x).strip() for x in user_ids if str(x or '').strip()})
        if ids:
            db.notifications.insert_many([{
                'tenant_id': current_tenant_id(), 'user_id': uid,
                'title': title, 'body': body,
                'meta': {'page': target, 'target': target,
                         'type': 'lc_workflow', 'reference': reference},
                'read': False, 'status': 'unread', 'created_at': now, 'updated_at': now,
            } for uid in ids])
    except Exception:
        current_app.logger.exception('LC notification could not be queued')


def _user_ids_for_roles(db, roles):
    users = db.users.find({'tenant_id': current_tenant_id(), 'is_deleted': {'$ne': True},
                           '$or': [{'role': {'$in': sorted(roles)}},
                                   {'roles': {'$in': sorted(roles)}}]})
    return [str(user['_id']) for user in users]


def _direct_manager_user_ids(db, claimant_user_id):
    """Find active, tenant-scoped Finance reviewers excluding the claimant.

    Finance roles may verify directly routed senior LC claims, whether or not
    the employee's HR designation contains "Manager". Retain established
    Accounts Manager role/designation eligibility as a compatibility path.
    """
    tenant = current_tenant_id()
    active = {'is_deleted': {'$ne': True}, 'is_active': {'$ne': False},
              'status': {'$nin': ['inactive', 'disabled', 'suspended']}}
    query = {'tenant_id': tenant, **active,
             '$or': [{'role': {'$in': sorted(PAYMENT_ROLES | FINANCE_PAYMENT_ROLES)}},
                     {'roles': {'$in': sorted(PAYMENT_ROLES | FINANCE_PAYMENT_ROLES)}}]}
    result = {str(u['_id']) for u in db.users.find(query) if u.get('_id')}
    # Compatibility: include account users authorized through legacy manager
    # designations, without requiring every Finance user to have that title.
    candidates = db.employees.find({'tenant_id': tenant, 'is_deleted': {'$ne': True},
        'designation': {'$regex': r'^(accounts manager|manager accounts|finance manager|manager finance|manager of accounts)$',
                        '$options': 'i'}})
    for candidate in candidates:
        uid = candidate.get('user_id')
        if not uid:
            continue
        user = db.users.find_one({'_id': _oid(uid), 'tenant_id': tenant, **active})
        if not user:
            continue
        raw_roles = user.get('roles') or []
        if isinstance(raw_roles, str):
            raw_roles = [raw_roles]
        roles = {str(role).lower().strip().replace('-', '_').replace(' ', '_')
                 for role in [user.get('role'), *raw_roles] if role}
        if can_mark_paid(roles, candidate):
            result.add(str(user['_id']))
    result.discard(str(claimant_user_id))
    return sorted(result)


def _owner_user(db, bill):
    employee = db.employees.find_one({'_id': _oid(bill['employee_ref_id']),
        'tenant_id': current_tenant_id(), 'is_deleted': {'$ne': True}})
    return str(employee.get('user_id') or '') if employee else ''


def _oid(value):
    from bson import ObjectId
    return ObjectId(value) if ObjectId.is_valid(str(value)) else str(value)


def _lines(visits):
    lines = []
    for v in visits:
        t = v['travel']
        lines.append({
            'visit_id': str(v['_id']), 'date': v.get('scheduled_date') or '',
            'title': v.get('title') or '', 'from_location': t.get('from_location') or '',
            'to_location': t.get('to_location') or '',
            'purpose': t.get('purpose') or v.get('description') or '',
            'project': t.get('project') or '', 'remarks': t.get('remarks') or '',
            'mode': t['mode'], 'vehicle_number': t.get('vehicle_number') or '',
            'start_km': t.get('start_km'), 'end_km': t.get('end_km'),
            'distance_km': t.get('distance_km'), 'rate': t.get('rate'),
            'transport_type': t.get('transport_type'),
            'transport_other': t.get('transport_other') or '',
            'fare': t.get('fare'), 'amount': t['amount'],
        })
    return lines


def _document(db, employee, year, month, visits):
    tenant = current_tenant_id()
    counter = db.local_conveyance_counters.find_one_and_update(
        {'_id': f'lc:{tenant}:{year}:{month:02d}'},
        {'$inc': {'seq': 1}, '$setOnInsert': {'tenant_id': tenant}},
        upsert=True, return_document=ReturnDocument.AFTER)
    code = ''.join(x for x in tenant.upper() if x.isalnum())[:14] or 'TENANT'
    lines = _lines(visits)
    modes = {line['mode'] for line in lines}
    now = datetime.utcnow()
    return {
        'tenant_id': tenant,
        'claim_key': f'{employee["_id"]}:{year}:{month:02d}',
        'reference': f'LC/{code}/{year}/{month:02d}/{int(counter["seq"]):06d}',
        'employee_ref_id': str(employee['_id']),
        'employee_code': str(employee.get('employee_code') or employee.get('emp_code') or ''),
        'employee_name': employee_name(employee), 'designation': str(employee.get('designation') or ''),
        'department': str(employee.get('department') or ''),
        'location': str(employee.get('location') or employee.get('state') or ''),
        'year': year, 'month': month, 'bill_type': next(iter(modes)) if len(modes) == 1 else 'mixed',
        'visit_ids': [line['visit_id'] for line in lines],
        'lines': lines, 'source_lines': [dict(line) for line in lines],
        'total': float(sum((Decimal(str(v['amount'])) for v in lines), Decimal('0'))),
        'currency': 'INR', 'status': 'draft', 'revision': 0,
        'approval': None, 'manager_validation': None, 'accounts_verification': None,
        'verification_history': [], 'created_at': now,
        'created_by': current_user_id(), 'updated_at': now,
        'paid': False, 'paid_at': None,
    }


@lc_bp.get('/settings')
@tenant_module_required('attendance')
def lc_settings():
    rates = tenant_rates(get_db(), current_tenant_id())
    return jsonify({'two_wheeler_rate': float(rates[MODE_TWO]),
                    'four_wheeler_rate': float(rates[MODE_FOUR]),
                    'editable': bool(current_user_roles() & OVERSIGHT_ROLES)})


@lc_bp.put('/settings')
@tenant_module_required('attendance')
def update_lc_settings():
    if not current_user_roles() & OVERSIGHT_ROLES:
        return _error('Only HR/Admin can update local conveyance rates', 403)
    try:
        validated = validate_rates(request.get_json(silent=True) or {})
    except ValueError as exc:
        return _error(str(exc))
    tenant = current_tenant_id()
    get_db().system_settings.update_one(
        {'_id': f'local-conveyance:{tenant}', 'tenant_id': tenant},
        {'$set': {**validated, 'setting_group': 'local_conveyance', 'setting_key': 'rates',
                  'updated_at': datetime.utcnow(), 'updated_by': current_user_id(), 'is_deleted': False},
         '$setOnInsert': {'tenant_id': tenant}}, upsert=True)
    audit('update_lc_rates', 'system_settings', f'local-conveyance:{tenant}', validated)
    return jsonify({'message': 'Rates updated for future visits', **validated})


@lc_bp.get('/bills')
@tenant_module_required('attendance')
def list_bills():
    db, employee, roles = get_db(), get_current_employee(get_db()), current_user_roles()
    query = {'tenant_id': current_tenant_id()}
    if request.args.get('scope') == 'all':
        if roles & (ACCOUNT_ROLES | OVERSIGHT_ROLES):
            query['status'] = {'$in': sorted(REVIEW_STATES | {'hr_verified', 'accounts_verified'})}
        elif employee and (roles & MANAGER_ROLES or
                            str(employee.get('is_team_leader') or '').lower() in ('true','yes','1') or
                            str(employee.get('is_reporting_officer') or '').lower() in ('true','yes','1')):
            query['approval.employee_ref_id'] = str(employee['_id'])
            query['status'] = {'$in': sorted(REVIEW_STATES)}
        else:
            return _error('No review access', 403)
    else:
        if not employee:
            return _error('Employee profile not found', 404)
        query['employee_ref_id'] = {'$in': sorted(employee_identity_values(employee))}
    ref = str(request.args.get('reference') or '').strip()
    if ref:
        query['reference'] = ref
    try:
        if request.args.get('year') or request.args.get('month'):
            year, month = _valid_period(request.args)
            query.update({'year': year, 'month': month})
    except ValueError as exc:
        return _error(str(exc))
    bills = list(db.local_conveyance_bills.find(query).sort('created_at', -1).limit(150))
    bills = [b for b in bills if can_read(b, employee, roles)]
    return jsonify({'items': clean_doc(bills), 'count': len(bills)})


@lc_bp.post('/bills/generate')
@tenant_module_required('attendance')
def generate_bills():
    db, tenant = get_db(), current_tenant_id()
    employee = get_current_employee(db)
    if not employee:
        return _error('Employee profile not found', 404)
    try:
        year, month = _valid_period(request.get_json(silent=True) or {})
    except ValueError as exc:
        return _error(str(exc))
    query = {'tenant_id': tenant,
        'employee_ref_id': {'$in': sorted(employee_identity_values(employee))},
        'scheduled_date': {'$regex': f'^{year}-{month:02d}-'},
        'status': 'completed', 'is_deleted': {'$ne': True},
        'travel.eligible': True, 'travel.mode': {'$in': sorted(BILL_TYPES)}}
    eligible = list(db.field_visits.find(query).sort([('scheduled_date', 1), ('created_at', 1)]))
    existing_query = {'tenant_id': tenant, 'employee_ref_id': str(employee['_id']), 'year': year, 'month': month}
    existing = list(db.local_conveyance_bills.find(existing_query).sort('created_at', -1))
    if existing:
        # A draft can be refreshed to include journeys completed since it was
        # first generated. Once submitted it is immutable until rejection.
        current = existing[0]
        if len(existing) == 1 and current.get('claim_key') and current.get('status') == 'draft' and eligible:
            new_ids = [str(v['_id']) for v in eligible]
            if new_ids != current.get('visit_ids', []):
                lines = _lines(eligible)
                modes = {line['mode'] for line in lines}
                changed_data = {'lines': lines, 'source_lines': [dict(x) for x in lines],
                    'visit_ids': new_ids,
                    'bill_type': next(iter(modes)) if len(modes) == 1 else 'mixed',
                    'total': float(sum((Decimal(str(x['amount'])) for x in lines), Decimal('0'))),
                    'updated_at': datetime.utcnow()}
                try:
                    changed = db.local_conveyance_bills.update_one(_optimistic_filter(current),
                        {'$set': changed_data, '$inc': {'revision': 1}})
                except DuplicateKeyError:
                    return _error('A journey in this month has already been claimed. Refresh the bill.', 409)
                if not changed.matched_count:
                    return _error('Monthly draft changed. Refresh and retry.', 409)
                _record(db, current, 'refresh_draft')
                existing = list(db.local_conveyance_bills.find(existing_query).sort('created_at', -1))
        return jsonify({'message': 'Existing monthly claim returned. Drafts refresh with any newly completed visits; submitted claims remain locked.',
                        'generated_references': [], 'items': clean_doc(existing)})
    if not eligible:
        return _error('No completed eligible visit journeys for the selected month', 404)
    try:
        indexes = db.local_conveyance_bills.index_information()
        protected = any(list(ix.get('key', [])) == [('tenant_id', 1), ('visit_ids', 1)]
                        and ix.get('unique') is True for ix in indexes.values())
        monthly = any(list(ix.get('key', [])) == [('tenant_id', 1), ('claim_key', 1)]
                      and ix.get('unique') is True for ix in indexes.values())
    except Exception:
        protected = monthly = False
    if not protected or not monthly:
        return _error('Updated Local Conveyance index migration is required before monthly bill generation',
                      503, 'LC_INDEXES_REQUIRED')
    doc = _document(db, employee, year, month, eligible)
    try:
        db.local_conveyance_bills.insert_one(doc)
        _record(db, doc, 'generate')
        return jsonify({'message': 'Monthly claim generated as Draft. Review and submit it for validation.',
                        'generated_references': [doc['reference']], 'items': clean_doc([doc])})
    except DuplicateKeyError:
        return _error('One or more journeys are already claimed, or a monthly bill was generated simultaneously. Refresh your bills.',
                      409, 'LC_DUPLICATE_CLAIM')


@lc_bp.get('/bills/<path:reference>')
@tenant_module_required('attendance')
def bill_detail(reference):
    db = get_db()
    bill = _bill(db, reference)
    if not bill:
        return _error('LC bill not found', 404)
    if not can_read(bill, get_current_employee(db), current_user_roles()):
        return _error('Not authorised to view this LC bill', 403)
    return jsonify({'item': _serialize_with_actions(db, bill)})


@lc_bp.get('/bills/<path:reference>/pdf')
@tenant_module_required('attendance')
def download_bill(reference):
    db = get_db()
    bill = _bill(db, reference)
    if not bill:
        return _error('LC bill not found', 404)
    if not can_read(bill, get_current_employee(db), current_user_roles()):
        return _error('Not authorised to view this LC bill', 403)
    try:
        rendered = render_lc_bill_pdf(bill)
    except Exception:
        current_app.logger.exception('LC bill PDF rendering failed')
        return _error('LC PDF renderer unavailable. Check WeasyPrint dependencies.', 503)
    return send_file(BytesIO(rendered), mimetype='application/pdf', as_attachment=True,
                     download_name=bill['reference'].replace('/', '-') + '.pdf')


@lc_bp.patch('/bills/<path:reference>/correction')
@tenant_module_required('attendance')
def correct_bill(reference):
    db = get_db()
    bill = _bill(db, reference)
    if not bill:
        return _error('LC bill not found', 404)
    if not _owner(bill, get_current_employee(db)):
        return _error('Only the employee who owns this bill can correct it', 403)
    if bill.get('status') != 'rejected':
        return _error('Bills can only be edited after rejection', 409)
    try:
        lines, total = correction_lines(bill['lines'], (request.get_json(silent=True) or {}).get('lines'))
    except ValueError as exc:
        return _error(str(exc))
    now = datetime.utcnow()
    event = {'stage': 'corrected', 'by': current_user_id(), 'at': now,
             'remarks': 'Employee corrected rejected bill', 'old_total': bill['total'],
             'new_total': total, 'previous_lines': bill['lines']}
    updated = db.local_conveyance_bills.update_one(_optimistic_filter(bill), {
        '$set': {'lines': lines, 'total': total, 'updated_at': now},
        '$inc': {'revision': 1}, '$push': {'verification_history': event}})
    if not updated.matched_count:
        return _error('Bill changed during editing. Refresh and retry.', 409)
    _record(db, bill, 'correct', old_total=bill['total'], new_total=total)
    return _updated(db, reference)


@lc_bp.post('/bills/<path:reference>/action')
@tenant_module_required('attendance')
def bill_action(reference):
    db, roles = get_db(), current_user_roles()
    bill = _bill(db, reference)
    if not bill:
        return _error('LC bill not found', 404)
    employee = get_current_employee(db)
    data = request.get_json(silent=True) or {}
    action = str(data.get('action') or '').strip().lower()
    remarks = str(data.get('remarks') or '').strip()[:1000]
    state = bill.get('status')
    owner = _owner(bill, employee)
    manager = is_approver(bill, employee, roles)
    accounts = can_verify_accounts(bill, employee, roles, current_user_id())
    payer = can_confirm_payment(bill, employee, roles, current_user_id())
    changes = {'updated_at': datetime.utcnow()}
    if action == 'submit':
        if not owner:
            return _error('Only the claimant can submit this bill', 403)
        if state not in {'draft', 'rejected', 'pending_verification'}:
            return _error('Only draft or rejected bills can be submitted', 409)
        try:
            approver = resolve_approver(db, current_tenant_id(), employee)
        except ValueError as exc:
            if not senior_direct_accounts_eligible(employee):
                return _error(str(exc), 409, 'LC_APPROVER_MAPPING_REQUIRED')
            # Direct senior claims route to active Finance-role reviewers in
            # the same tenant; the claimant cannot review their own claim.
            finance_ids = _direct_manager_user_ids(db, current_user_id())
            if not finance_ids:
                return _error('No separate active Finance reviewer is configured for this company. Ask HR/Admin to assign a Finance user.',
                              409, 'LC_FINANCE_MANAGER_REQUIRED')
            approver = {'type': 'direct_accounts_manager',
                        'name': 'Finance Verification', 'user_id': ''}
            changes.update({'status': 'pending_accounts', 'approval': approver,
                'manager_validation': {'skipped': True,
                    'reason': 'Senior employee without an assigned TL/RO',
                    'at': changes['updated_at'], 'by': 'system'},
                'accounts_verification': None,
                'submitted_at': changes['updated_at'], 'paid': False,
                'rejected_by': None, 'rejection_reason': '', 'rejected_stage': None})
            stage = 'submitted'
            notify = (finance_ids, 'Senior LC bill awaiting Finance verification',
                      f'{bill["employee_name"]} submitted {reference} directly for verification.')
        else:
            changes.update({'status': 'pending_manager', 'approval': approver,
                'manager_validation': None, 'accounts_verification': None,
                'submitted_at': changes['updated_at'], 'paid': False,
                'rejected_by': None, 'rejection_reason': '', 'rejected_stage': None})
            stage = 'submitted'
            notify = ([approver.get('user_id')], 'LC bill awaiting your validation',
                      f'{bill["employee_name"]} submitted {reference} for validation.')
    elif action == 'manager_validate':
        if not manager:
            return _error('This claim is not assigned to you as Team Leader or Reporting Officer', 403)
        if state != 'pending_manager':
            return _error('Bill is not pending manager validation', 409)
        record = {'by': current_user_id(), 'employee_ref_id': str(employee['_id']),
                  'name': employee_name(employee), 'at': changes['updated_at'], 'remarks': remarks,
                  'role': (bill.get('approval') or {}).get('type')}
        changes.update({'status': 'pending_accounts', 'manager_validation': record})
        stage = 'manager_validated'
        notify = (_user_ids_for_roles(db, ACCOUNT_ROLES), 'LC claim awaiting Accounts verification',
                  f'{reference} has been validated and is pending Accounts verification.')
    elif action == 'accounts_verify':
        if not accounts:
            return _error('Only an authorised Finance reviewer may verify this senior claim, or an Accounts reviewer may verify a standard claim', 403)
        if state != 'pending_accounts' or not bill.get('manager_validation'):
            return _error('Manager validation or authorised senior-routing bypass is required before Accounts verification', 409)
        record = {'by': current_user_id(), 'at': changes['updated_at'], 'remarks': remarks,
                  'roles': sorted(roles)}
        changes.update({'status': 'verified', 'accounts_verification': record})
        stage = 'accounts_verified'
        notify = ([_owner_user(db, bill)], 'LC claim verified by Accounts',
                  f'{reference} was verified by Accounts and is awaiting payment.')
    elif action == 'mark_paid':
        if not payer:
            return _error('Only authorised Finance users may confirm payment', 403)
        if state != 'verified' or not bill.get('accounts_verification'):
            return _error('Only an Accounts-verified bill may be marked paid', 409)
        # Payment has been made outside YourComate. Recording it needs no UTR/input.
        # Preserve actor, server timestamp, optimistic revision, history and audit.
        changes.update({'status': 'paid', 'paid': True, 'paid_at': changes['updated_at'],
                        'paid_by': current_user_id()})
        stage = 'paid'
        notify = ([_owner_user(db, bill), (bill.get('approval') or {}).get('user_id')],
                  'Local Conveyance paid', f'{reference} has been marked paid by Accounts.')
    elif action == 'reject':
        if state == 'pending_manager' and not manager:
            return _error('Only the assigned manager can reject at this stage', 403)
        if state == 'pending_accounts' and not accounts:
            return _error('Only authorised Accounts reviewers can reject at this stage', 403)
        if state not in {'pending_manager', 'pending_accounts'}:
            return _error('This claim is not awaiting your review', 409)
        if not remarks:
            return _error('Rejection reason is required')
        changes.update({'status': 'rejected', 'rejected_by': current_user_id(),
                        'rejection_reason': remarks, 'rejected_stage': state})
        stage = 'rejected'
        notify = ([_owner_user(db, bill)], 'LC bill rejected — correction required',
                  f'{reference}: {remarks}')
    else:
        return _error('Invalid LC workflow action')
    record = {'stage': stage, 'by': current_user_id(), 'roles': sorted(roles),
              'at': changes['updated_at'], 'remarks': remarks,
              'from_status': state, 'to_status': changes['status']}
    changed = db.local_conveyance_bills.update_one(_optimistic_filter(bill), {
        '$set': changes, '$inc': {'revision': 1}, '$push': {'verification_history': record}})
    if not changed.matched_count:
        return _error('Bill was changed by another user. Refresh and retry.', 409)
    _record(db, bill, stage, remarks)
    _notify(db, *notify, reference, target='lc_verification' if stage in ('submitted', 'manager_validated') else 'my_local_conveyance')
    if stage == 'accounts_verified':
        # Finance reviewers get a payment-ready queue notification; the employee
        # receives the normal claim-status notification above.
        _notify(db, _user_ids_for_roles(db, PAYMENT_ROLES | FINANCE_PAYMENT_ROLES),
                'LC claim ready for payment',
                f'{reference} is verified and awaits actual disbursement and payment confirmation.',
                reference, target='lc_verification')
    return _updated(db, reference)


@lc_bp.post('/bills/<path:reference>/verify')
@tenant_module_required('attendance')
def legacy_verify_disabled(reference):
    # Never let old HR/Finance clients skip the new reporting hierarchy.
    return _error('Use the new LC submission and validation workflow', 409, 'LC_WORKFLOW_UPDATED')
