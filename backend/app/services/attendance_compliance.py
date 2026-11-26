"""Tenant-scoped policies, immutable monthly ledgers and verified minute summaries.

Each point mutation is a single optimistic Mongo update that appends its event and
changes its balance together. Deterministic event identities survive worker retries.
"""
import calendar
import json
from copy import deepcopy
from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from uuid import uuid4
from bson import ObjectId
from pymongo.errors import DuplicateKeyError
from .attendance_payroll_engine import (ComplianceError, number, day, month_days, clock,
    union, intersect, subtract, length, first_minutes, schedule_intervals, component_order)

HR = {'admin', 'hr', 'hr_admin', 'hr_manager'}
FINANCE = {'finance', 'accounts_finance'}
DEFAULT = {
    'enabled': False, 'connected': False, 'enforce': False, 'monthly_points': 0,
    'reset_day': 1, 'expiry_days': 0, 'carry_forward': False, 'carry_max': 0,
    'balance_cap': 100, 'overrides': [], 'exemptions': [], 'rules': [],
    'weekly_offs': [6], 'saturday_offs': [2, 4], 'shifts': [], 'holidays': [],
    'calendar_source': 'legacy',
    'break_paid': False, 'overtime_offset': 'none', 'offline_grace_minutes': 1440,
    'shortage_model': None, 'final_point_boundary': None, 'wage_codes': [],
    'deduction_cap_percent': 0, 'rounding': 'two_decimals', 'dispute_days': 3,
    'components': [],
}


def now():
    return datetime.now(timezone.utc)


def local_now():
    # Existing attendance timestamps are India-local naive datetimes.
    return datetime.now(timezone(timedelta(hours=5, minutes=30))).replace(tzinfo=None)


def uid(*parts):
    return 'ac:' + sha256(json.dumps(parts, default=str, sort_keys=True).encode()).hexdigest()


def digest(value):
    return sha256(json.dumps(value, default=str, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def safe(value):
    return json.loads(json.dumps(value, default=str))


def reason(value):
    if not isinstance(value, str) or not 3 <= len(value.strip()) <= 1000:
        raise ComplianceError('A reason of 3–1000 characters is required.')
    return value.strip()


def policy(db, tenant, on=None):
    on = str(on or local_now().date())[:10]
    record = db.attendance_compliance_settings.find_one({'_id': uid(tenant, 'settings'), 'tenant_id': tenant}) or {}
    versions = [v for v in record.get('versions', []) if v['effective_from'] <= on]
    chosen = max(versions, key=lambda v: (v['effective_from'], v['version'])) if versions else {}
    return {**deepcopy(DEFAULT), **deepcopy(chosen), 'revision': record.get('revision', 0)}


def validate_policy(data):
    p = {**deepcopy(DEFAULT), **{k: deepcopy(v) for k, v in data.items() if k in DEFAULT}}
    for key in ('enabled', 'connected', 'enforce', 'carry_forward', 'break_paid'):
        if type(p[key]) is not bool:
            raise ComplianceError(key + ' must be boolean.')
    for key in ('monthly_points', 'carry_max', 'balance_cap'):
        p[key] = float(number(p[key], 0, Decimal('10000')))
    for key, low, high in [('reset_day', 1, 28), ('expiry_days', 0, 366), ('dispute_days', 1, 31), ('offline_grace_minutes', 0, 10080)]:
        value = number(p[key], low, Decimal(high))
        if value != int(value):
            raise ComplianceError(key + ' must be an integer.')
        p[key] = int(value)
    if p['shortage_model'] not in (None, 'full_month', 'post_grace') or p['final_point_boundary'] not in (None, 'final_event', 'next_event'):
        raise ComplianceError('Choose a supported shortage model and final-point boundary.')
    if p['overtime_offset'] not in ('none', 'same_day', 'month'):
        raise ComplianceError('Invalid overtime offset policy.')
    if p['rounding'] not in ('two_decimals', 'nearest_rupee', 'floor', 'ceil'):
        raise ComplianceError('Invalid rounding policy.')
    p['deduction_cap_percent'] = float(number(p['deduction_cap_percent'], 0, Decimal('100')))
    if not isinstance(p['wage_codes'], list) or len(p['wage_codes']) > 40 or not all(isinstance(c, str) and 1 <= len(c) <= 60 for c in p['wage_codes']):
        raise ComplianceError('Provide a list of eligible earning component codes.')
    if p['enforce'] and (not p['shortage_model'] or not p['final_point_boundary'] or not p['wage_codes'] or not p['deduction_cap_percent']):
        raise ComplianceError('Before enforcement, explicitly choose the shortage model, final-point boundary, wage basis and deduction cap.')
    for key, permitted in [('weekly_offs', set(range(7))), ('saturday_offs', set(range(1, 6)))]:
        if not isinstance(p[key], list) or any(type(x) is not int or x not in permitted for x in p[key]):
            raise ComplianceError('Invalid ' + key)
    if p['calendar_source'] not in ('legacy', 'organisation'):
        raise ComplianceError('Invalid calendar source.')
    for key in ('rules', 'overrides', 'exemptions', 'shifts', 'holidays', 'components'):
        if not isinstance(p[key], list) or len(p[key]) > 200:
            raise ComplianceError(key + ' must be a list with at most 200 entries.')
    for key in ('rules', 'overrides', 'exemptions', 'shifts', 'holidays', 'components'):
        for row in p[key]:
            if not isinstance(row, dict):
                raise ComplianceError(key + ' entries must be objects.')
            for field in ('employee_ids', 'departments', 'designations', 'states', 'locations', 'attendance_types'):
                if field in row and (not isinstance(row[field], list) or not all(isinstance(v, str) for v in row[field])):
                    raise ComplianceError(field + ' must be a list of strings.')
    codes = set()
    for r in p['rules']:
        if r.get('code') not in {'late', 'missing_checkout', 'early', 'absence', 'leave_not_applied', 'other'} or r['code'] in codes:
            raise ComplianceError('Each violation type may have one rule in a policy version.')
        codes.add(r['code'])
        for key in ('points', 'daily_max', 'monthly_max', 'grace_minutes', 'threshold_minutes'):
            r[key] = float(number(r.get(key, 0), 0, Decimal('100000')))
        if r.get('mode', 'manual') not in ('automatic', 'manual'):
            raise ComplianceError('Rule mode must be automatic or manual.')
        for key in ('enabled', 'payroll_review'):
            if type(r.get(key, False)) is not bool:
                raise ComplianceError('Rule switches must be boolean.')
    for row in p['overrides']:
        if row.get('scope') not in ('state', 'location', 'department', 'designation', 'employee') or not row.get('value'):
            raise ComplianceError('Invalid allocation override scope/value.')
        row['points'] = float(number(row.get('points'), 0, Decimal('10000')))
    for row in p['shifts']:
        if not all(k in row for k in ('start', 'end')) or not isinstance(row.get('breaks', []), list):
            raise ComplianceError('Shifts require start/end and a list of breaks.')
        for b in row.get('breaks', []):
            if not isinstance(b, dict) or not all(k in b for k in ('start', 'end')) or type(b.get('paid', False)) is not bool:
                raise ComplianceError('Breaks require start/end and a paid boolean.')
        schedule_intervals(row)
    for key in ('rules', 'overrides', 'exemptions', 'shifts'):
        for row in p[key]:
            for field in ('effective_from', 'effective_to'):
                if row.get(field):
                    row[field] = day(row[field]).isoformat()
            if row.get('effective_from', '') > row.get('effective_to', '9999'):
                raise ComplianceError('Effective date range is reversed.')
    for row in p['holidays']:
        row['date'] = day(row.get('date')).isoformat()
    component_order(p['components'])
    if len(json.dumps(p)) > 160000:
        raise ComplianceError('Policy size limit exceeded.')
    return p


def save_policy(db, tenant, data, actor, payroll_only=False):
    why = reason(data.get('reason'))
    effective = day(data.get('effective_from'))
    if effective < local_now().date():
        raise ComplianceError('New policy versions cannot be backdated.')
    current = policy(db, tenant, effective)
    incoming = data.get('policy', {})
    if not isinstance(incoming, dict):
        raise ComplianceError('policy must be an object.')
    if payroll_only:
        if set(incoming) - {'components'}:
            raise ComplianceError('Finance may change payroll components only.', 403)
        incoming = {**current, **incoming}
    if not payroll_only:
        # New HR policy versions use the central calendar, not duplicate holiday/shift records.
        incoming = {**incoming, 'calendar_source': 'organisation', 'holidays': [], 'shifts': [],
                    'weekly_offs': [6], 'saturday_offs': [2, 4]}
    p = validate_policy(incoming)
    revision = data.get('revision')
    if type(revision) is not int or revision != current['revision']:
        raise ComplianceError('Settings changed. Refresh before saving.', 409)
    record_id = uid(tenant, 'settings')
    row = {**p, 'version': revision + 1, 'effective_from': str(effective), 'actor_id': actor,
           'reason': why, 'created_at': now().isoformat()}
    if revision == 0:
        try:
            db.attendance_compliance_settings.insert_one({'_id': record_id, 'tenant_id': tenant, 'revision': 1, 'versions': [row]})
        except DuplicateKeyError:
            raise ComplianceError('Settings changed. Refresh before saving.', 409)
    else:
        result = db.attendance_compliance_settings.update_one({'_id': record_id, 'tenant_id': tenant, 'revision': revision},
            {'$inc': {'revision': 1}, '$push': {'versions': row}})
        if not result.modified_count:
            raise ComplianceError('Settings changed. Refresh before saving.', 409)
    audit(db, tenant, 'compliance_policy', actor, record_id, current, row, why)
    return {**row, 'revision': revision + 1}


def audit(db, tenant, action, actor, entity, before, after, why, event_id=None):
    db.audit_logs.update_one({'_id': event_id or uid(tenant, action, uuid4().hex)}, {'$setOnInsert': {
        'tenant_id': tenant, 'action': action, 'entity': 'attendance_compliance', 'entity_id': entity,
        'actor_id': actor, 'created_at': now(), 'meta': {'before': safe(before), 'after': safe(after), 'reason': why}}}, upsert=True)


def applies(row, employee, on):
    if not row.get('effective_from', '2000-01-01') <= on <= row.get('effective_to', '2099-12-31'):
        return False
    for field in ('employee_id', 'department', 'designation', 'state', 'location'):
        options = row.get(field + 's', [])
        value = str(employee['_id']) if field == 'employee_id' else str(employee.get(field, ''))
        if options and value not in options:
            return False
    return True


def allocation(p, employee, on):
    value = p['monthly_points']
    for scope in ('state', 'location', 'department', 'designation', 'employee'):
        for override in p['overrides']:
            target = str(employee['_id']) if scope == 'employee' else str(employee.get(scope, ''))
            if override['scope'] == scope and override['value'] == target and applies(override, employee, on):
                value = override['points']
    return min(number(value, 0), number(p['balance_cap'], 0))


def cycle(on, reset):
    d = day(on)
    if d.day < reset:
        d = d.replace(day=1) - timedelta(days=1)
    return d.replace(day=reset).isoformat()


def ledger(db, tenant, employee, on, p=None):
    p = p or policy(db, tenant, on)
    start = cycle(on, p['reset_day'])
    return db.employee_compliance_ledgers.find_one({'_id': uid(tenant, str(employee['_id']), start), 'tenant_id': tenant}) or {
        '_id': uid(tenant, str(employee['_id']), start), 'tenant_id': tenant, 'employee_id': str(employee['_id']),
        'cycle': start, 'version': 0, 'balance': 0, 'events': [], 'policy_version': p.get('version', 0)}


def post_event(db, tenant, employee, on, event, p=None):
    p = p or policy(db, tenant, on)
    for attempt in range(24):
        old = ledger(db, tenant, employee, on, p)
        if any(e['id'] == event['id'] for e in old['events']):
            return old
        if len(old['events']) >= 3000:
            raise ComplianceError('Monthly ledger event limit reached; contact an administrator.', 409)
        before = number(old['balance'])
        requested = number(event.get('delta', 0))
        if event['kind'] == 'violation':
            used_day = sum(number(e.get('charged', 0)) for e in old['events'] if e.get('rule') == event.get('rule') and e.get('date') == on)
            used_month = sum(number(e.get('charged', 0)) for e in old['events'] if e.get('rule') == event.get('rule'))
            rule = event['rule_snapshot']
            charge = -requested
            if rule.get('daily_max'):
                charge = min(charge, max(Decimal(0), number(rule['daily_max']) - used_day))
            if rule.get('monthly_max'):
                charge = min(charge, max(Decimal(0), number(rule['monthly_max']) - used_month))
            requested = -charge
        after = min(number(p['balance_cap']), max(Decimal(0), before + requested))
        entry = {**safe(event), 'date': on, 'before': float(before), 'after': float(after),
                 'delta': float(after - before), 'charged': float(-requested) if event['kind'] == 'violation' else 0,
                 'created_at': now().isoformat(), 'policy_version': p.get('version', 0)}
        if old['version'] == 0:
            try:
                db.employee_compliance_ledgers.insert_one({**old, 'version': 1, 'balance': float(after), 'events': [entry]})
                return ledger(db, tenant, employee, on, p)
            except DuplicateKeyError:
                continue
        result = db.employee_compliance_ledgers.update_one({'_id': old['_id'], 'tenant_id': tenant, 'version': old['version']},
            {'$inc': {'version': 1}, '$set': {'balance': float(after)}, '$push': {'events': entry}})
        if result.modified_count:
            return ledger(db, tenant, employee, on, p)
    raise ComplianceError('Concurrent ledger update; retry safely.', 409)


def ensure_allocation(db, tenant, employee, on, p):
    current = ledger(db, tenant, employee, on, p)
    if not p['enabled']:
        return current
    if not current['version']:
        previous = db.employee_compliance_ledgers.find_one({'tenant_id': tenant, 'employee_id': str(employee['_id']), 'cycle': {'$lt': current['cycle']}}, sort=[('cycle', -1)])
        carry = min(number(previous['balance']), number(p['carry_max'])) if previous and p['carry_forward'] else Decimal(0)
        if previous and p['expiry_days'] and (day(on) - day(previous['cycle'])).days >= p['expiry_days']:
            carry = Decimal(0)
        current = post_event(db, tenant, employee, on, {'id': uid(current['_id'], 'allocation'), 'kind': 'allocation',
            'delta': float(allocation(p, employee, on) + carry), 'carry': float(carry),
            'reason': 'Monthly allocation', 'actor_id': 'system'}, p)
    if p['expiry_days'] and (day(on) - day(current['cycle'])).days >= p['expiry_days']:
        current = post_event(db, tenant, employee, on, {'id': uid(current['_id'], 'expiry'), 'kind': 'expiry',
            'delta': -current['balance'], 'reason': 'Configured point expiry', 'actor_id': 'system'}, p)
    return current


def reverse_event(db, tenant, employee, on, event_id, actor, why):
    p = policy(db, tenant, on)
    current = ledger(db, tenant, employee, on, p)
    event = next((e for e in current['events'] if e['id'] == event_id and e['kind'] == 'violation'), None)
    if not event:
        raise ComplianceError('Violation not found.', 404)
    return post_event(db, tenant, employee, on, {'id': uid(event_id, 'reversal'), 'kind': 'restoration',
        'delta': -event['delta'], 'reverses': event_id, 'actor_id': actor, 'reason': reason(why)}, p)


def calendar_holidays(db, tenant, start, end):
    # Read live central records, supporting the existing ISO date field and BSON dates.
    return list(db.holiday_calendar.find({'tenant_id': tenant,
        '$or': [{'date': {'$gte': str(start), '$lte': str(end)}},
                {'date': {'$gte': datetime.combine(day(start), datetime.min.time()),
                          '$lt': datetime.combine(day(end) + timedelta(days=1), datetime.min.time())}}],
        'status': {'$ne': 'inactive'}, 'is_deleted': {'$ne': True}}))


def is_nonworking_day(p, employee, on, holidays):
    d = day(on)
    weekly, saturday = ([6], [2, 4]) if p.get('calendar_source') == 'organisation' else (p['weekly_offs'], p['saturday_offs'])
    if d.weekday() in weekly or (d.weekday() == 5 and (d.day - 1) // 7 + 1 in saturday):
        return True
    candidates = holidays if p.get('calendar_source') == 'organisation' else holidays + p['holidays']
    return any(str(h.get('date'))[:10] == str(d) and all(
        not h.get(k) or str(h[k]).strip().casefold() in ('all', 'all states', str(employee.get(k, '')).strip().casefold())
        for k in ('state', 'location', 'organisation_id')) for h in candidates)


def default_schedule(db, tenant):
    from app.routes.attendance import DEFAULT_ATTENDANCE_SCHEDULE, attendance_schedule_settings_id
    row = db.system_settings.find_one({'_id': attendance_schedule_settings_id(tenant), 'tenant_id': tenant}) or {}
    base = {**DEFAULT_ATTENDANCE_SCHEDULE, **row}
    return {'start': base['check_in_time'], 'end': base['check_out_time'],
            'late_cutoff': base.get('late_cutoff_time', base['check_in_time']),
            'breaks': [{'start': base['break_start_time'], 'end': base['break_end_time'], 'paid': False}]}


def employee_schedule(p, employee, on, fallback, logs):
    schedule = deepcopy(fallback)
    for item in schedule.get('breaks', []):
        item['paid'] = p['break_paid']
    # Existing attendance records retain the historical schedule actually used.
    if logs and logs[0].get('office_start') and logs[0].get('office_end'):
        record = logs[0]
        schedule.update(start=record['office_start'], end=record['office_end'])
        if record.get('break_start') and record.get('break_end'):
            schedule['breaks'] = [{'start': record['break_start'], 'end': record['break_end'], 'paid': p['break_paid']}]
    for shift in ([] if p.get('calendar_source') == 'organisation' else p['shifts']):
        if applies(shift, employee, on):
            schedule = deepcopy(shift)
    return schedule


def log_intervals(logs, on):
    result, unresolved, uncertain = [], [], False
    midnight = datetime.combine(day(on), datetime.min.time())
    def stamp(value):
        value = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return value.astimezone(timezone(timedelta(hours=5, minutes=30))).replace(tzinfo=None) if value.tzinfo else value
    for row in logs:
        a, b = row.get('check_in'), row.get('check_out')
        if not a:
            uncertain = True
            continue
        try:
            a = stamp(a)
            start = int((a - midnight).total_seconds() // 60)
            if not b:
                unresolved.append(start)
                continue
            b = stamp(b)
            if b <= a or (b - a).total_seconds() > 48 * 3600:
                raise ValueError()
            result.append([start, int((b - midnight).total_seconds() // 60)])
        except (ValueError, TypeError):
            uncertain = True
    merged = union(result)
    # A stale duplicate open punch does not erase a completed interval covering it.
    uncertain = uncertain or any(not any(a <= start < b for a, b in merged) for start in unresolved)
    return merged, uncertain


def build_summary(db, tenant, employee, period, at=None):
    """Read-only. Ambiguous day-based credits/LWP are conservative review exclusions."""
    from .payroll_attendance_service import _leave_is_lwp, _leave_weight
    at = at or local_now()
    dates = month_days(period)
    eid = str(employee['_id'])
    settings = db.attendance_compliance_settings.find_one({'_id': uid(tenant, 'settings'), 'tenant_id': tenant}) or {}
    def select_policy(on):
        versions = [v for v in settings.get('versions', []) if v['effective_from'] <= str(on)]
        chosen = max(versions, key=lambda v: (v['effective_from'], v['version'])) if versions else {}
        return {**deepcopy(DEFAULT), **deepcopy(chosen), 'revision': settings.get('revision', 0)}
    ledgers = list(db.employee_compliance_ledgers.find({'tenant_id': tenant, 'employee_id': eid, 'cycle': {'$gte': str(dates[0] - timedelta(days=28)), '$lte': str(dates[-1])}}))
    ledgers_by_id = {l['_id']: l for l in ledgers}
    def select_ledger(on, p=None):
        p = p or select_policy(on)
        start = cycle(on, p['reset_day'])
        return ledgers_by_id.get(uid(tenant, eid, start), {'version': 0, 'balance': 0, 'events': []})
    logs = list(db.attendance_logs.find({'tenant_id': tenant, 'employee_id': eid, 'date': {'$gte': str(dates[0]), '$lte': str(dates[-1])}, 'is_deleted': {'$ne': True}}))
    leaves = list(db.leave_requests.find({'tenant_id': tenant, 'employee_id': eid, 'status': 'approved', 'approval_stage': 'approved',
        'from_date': {'$lte': str(dates[-1])}, 'to_date': {'$gte': str(dates[0])}, 'is_deleted': {'$ne': True}}))
    holidays = calendar_holidays(db, tenant, dates[0], dates[-1])
    adjustments = list(db.compliance_time_adjustments.find({'tenant_id': tenant, 'employee_id': eid, 'period': period, 'status': 'approved'}))
    fallback = default_schedule(db, tenant)
    rows, versions, warnings = [], set(), []
    for d in dates:
        on = str(d)
        p = select_policy(on)
        versions.add(p.get('version', 0))
        logs_day = [r for r in logs if str(r.get('date', ''))[:10] == on]
        schedule = employee_schedule(p, employee, on, fallback, logs_day)
        expected = schedule_intervals(schedule)
        employed = on >= str(employee.get('joining_date') or employee.get('date_of_joining') or '2000-01-01')[:10] and on <= str(employee.get('last_working_day') or employee.get('last_working_date') or '2099-12-31')[:10]
        if not employed or is_nonworking_day(p, employee, on, holidays):
            expected = []
        required = length(expected)
        actual, uncertain = log_intervals(logs_day, on)
        actual_in = intersect(actual, expected)
        credits, lwp, other, verified, overtime = [], [], [], False, []
        source_ids, ambiguous = [], False
        for leave in leaves:
            if str(leave['from_date'])[:10] <= on <= str(leave['to_date'])[:10]:
                source_ids.append(str(leave['_id']))
                overlap = sum(str(leave['from_date'])[:10] <= str(x) <= str(leave['to_date'])[:10] for x in dates)
                weight = _leave_weight(leave, overlap)
                # Mixed day-only LWP cannot identify which interval was already paid/deducted.
                if _leave_is_lwp(leave) or number(leave.get('lwp_days', 0), 0) > 0 or on in leave.get('notice_lwp_dates', []):
                    lwp += expected
                    ambiguous = ambiguous or weight != 1 or not _leave_is_lwp(leave)
                elif weight == 1:
                    credits += expected
                else:
                    credits += first_minutes(subtract(expected, actual_in), int(required * weight))
                    ambiguous = True
        for item in adjustments:
            if item['date'] == on:
                source_ids.append(str(item['_id']))
                if item['kind'] == 'verified':
                    verified = True
                elif item['kind'] == 'lwp' or item['kind'] == 'other_deduction':
                    other += item['intervals']
                elif item['kind'] == 'overtime':
                    overtime += intersect(item['intervals'], actual)
                elif item['kind'] in ('paid_leave', 'official_duty', 'adjustment', 'compensatory', 'exemption'):
                    credits += item['intervals']
        accounted = intersect(union(actual_in + credits), expected)
        shortage = subtract(expected, accounted)
        overtime = subtract(overtime, expected)
        if p['overtime_offset'] == 'same_day':
            offset = first_minutes(shortage, length(overtime))
            accounted = union(accounted + offset)
            shortage = subtract(shortage, offset)
        exempt = any(applies(e, employee, on) for e in p['exemptions'])
        completed = datetime.combine(d, datetime.min.time()) + timedelta(minutes=max((x[1] for x in schedule_intervals(schedule)), default=0) + p['offline_grace_minutes']) <= at
        eligible = subtract(shortage, union(lwp + other)) if completed and verified and not ambiguous and not exempt else []
        if required and completed and (uncertain or ambiguous or (shortage and not verified)):
            warnings.append(on + ': working time requires HR verification')
        rows.append({'date': on, 'required_minutes': required, 'actual_minutes': length(actual_in),
            'credited_minutes': length(subtract(accounted, actual_in)), 'accounted_minutes': length(accounted),
            'shortage_minutes': length(shortage), 'lwp_excluded_minutes': length(intersect(shortage, lwp)),
            'other_excluded_minutes': length(intersect(shortage, other)), 'overtime_minutes': length(overtime),
            'eligible_intervals': eligible, 'eligible_minutes': length(eligible), 'verified': verified,
            'uncertain': uncertain or ambiguous, 'completed': completed, 'source_ids': source_ids,
            'schedule': schedule, 'policy_version': p.get('version', 0), 'enabled': p['enabled'],
            'connected': p['connected'], 'enforce': p['enforce'], 'overtime_offset': p['overtime_offset'],
            'shortage_intervals': shortage, 'accounted_intervals': accounted})
    # Approved overtime can offset a month only when the policy on both source and destination permits it.
    extra = sum(r['overtime_minutes'] for r in rows if r['overtime_offset'] == 'month' and r['completed'])
    for row in rows:
        if row['overtime_offset'] == 'month' and extra:
            take = first_minutes(row['shortage_intervals'], extra)
            extra -= length(take)
            row['accounted_minutes'] += length(take)
            row['credited_minutes'] += length(take)
            row['shortage_intervals'] = subtract(row['shortage_intervals'], take)
            row['shortage_minutes'] = length(row['shortage_intervals'])
            row['eligible_intervals'] = subtract(row['eligible_intervals'], take)
            row['eligible_minutes'] = length(row['eligible_intervals'])
    events = [e for l in ledgers for e in l['events'] if str(dates[0]) <= e['date'] <= str(dates[-1])]
    reversed_ids = {e.get('reverses') for l in ledgers for e in l['events']}
    live = [e for e in events if e['kind'] == 'violation' and e['id'] not in reversed_ids]
    nonworking = {r['date'] for r in rows if not r['required_minutes'] and is_nonworking_day(select_policy(r['date']), employee, r['date'], holidays)}
    for event in live:
        if event['date'] in nonworking:
            warnings.append(event['date'] + ': existing violation on a non-working day; HR must review and restore points if appropriate')
    current = select_ledger(str(min(dates[-1], at.date())))
    for row in rows:
        p = select_policy(row['date'])
        period_ledger = select_ledger(row['date'], p)
        active_events = [e for e in period_ledger['events'] if e['kind'] == 'violation' and e['id'] not in reversed_ids and e.get('payroll_review')]
        boundary_events = [e for e in active_events if e['after'] == 0 and (p['final_point_boundary'] == 'final_event' or e['before'] == 0)]
        unexpired_balance = sum(e['delta'] for e in period_ledger['events'] if e['kind'] != 'expiry')
        exhausted = period_ledger['version'] > 0 and period_ledger['balance'] == 0 and unexpired_balance <= 0 and bool(boundary_events)
        if not exhausted or not all(row[k] for k in ('enabled', 'connected', 'enforce')) or (p['shortage_model'] == 'post_grace' and not any(e['date'] == row['date'] for e in boundary_events)):
            row['eligible_intervals'], row['eligible_minutes'] = [], 0
        elif p['shortage_model'] == 'post_grace':
            associated = [interval for e in boundary_events if e['date'] == row['date'] for interval in e.get('shortage_intervals', row['shortage_intervals'])]
            row['eligible_intervals'] = intersect(row['eligible_intervals'], associated)
            row['eligible_minutes'] = length(row['eligible_intervals'])
    totals = {key: sum(r[key] for r in rows) for key in ('required_minutes', 'actual_minutes', 'credited_minutes', 'accounted_minutes', 'shortage_minutes', 'lwp_excluded_minutes', 'other_excluded_minutes', 'overtime_minutes', 'eligible_minutes')}
    result = {'employee_id': eid, 'employee_name': employee.get('employee_name') or employee.get('name', ''),
        'employee_code': employee.get('employee_code') or employee.get('employee_id', ''),
        **{k: employee.get(k, '') for k in ('department', 'designation', 'state', 'location')},
        'period': period, **totals, 'days': rows, 'points': current['balance'],
        'allocated': sum(e['delta'] for e in events if e['kind'] in ('allocation', 'additional')),
        'consumed': max(0, -sum(e['delta'] for e in events if e['kind'] in ('violation', 'restoration'))),
        'violations': len(live), 'events': events, 'policy_versions': sorted(versions),
        'warnings': warnings, 'requires_review': bool(warnings), 'status': 'Points exhausted' if current['balance'] == 0 else 'Low point balance' if current['balance'] <= 1 else 'Sufficient points'}
    result['fingerprint'] = digest(result)
    return result


def process_employee(db, tenant, employee, period, actor='system'):
    """Asynchronous reconciliation; never called from attendance request handlers."""
    summary = build_summary(db, tenant, employee, period)
    allow_new = policy(db, tenant)['enabled']
    for row in summary['days']:
        on = row['date']
        p = policy(db, tenant, on)
        employed = on >= str(employee.get('joining_date') or employee.get('date_of_joining') or '2000-01-01')[:10] and on <= str(employee.get('last_working_day') or employee.get('last_working_date') or '2099-12-31')[:10]
        if not employed or not p['enabled'] or day(on) > local_now().date():
            continue
        current = ensure_allocation(db, tenant, employee, on, p) if allow_new else ledger(db, tenant, employee, on, p)
        if not row['completed'] or not row['required_minutes']:
            continue
        logs = list(db.attendance_logs.find({'tenant_id': tenant, 'employee_id': str(employee['_id']), 'date': on, 'is_deleted': {'$ne': True}}))
        actual, missing = log_intervals(logs, on)
        starts, _ = log_intervals([{**r, 'check_out': r['check_in'] + timedelta(minutes=1)} for r in logs if isinstance(r.get('check_in'), datetime)], on)
        expected = schedule_intervals(row['schedule'])
        for rule in p['rules']:
            if not rule.get('enabled') or rule.get('mode') != 'automatic' or not applies(rule, employee, on):
                continue
            if any(applies(e, employee, on) for e in p['exemptions']):
                continue
            if rule.get('attendance_types') and not any(r.get('mode') in rule['attendance_types'] for r in logs):
                continue
            code = rule['code']
            threshold = number(rule['grace_minutes']) + number(rule['threshold_minutes'])
            triggered = {'missing_checkout': bool(logs and missing),
                'late': bool(starts and starts[0][0] > clock(row['schedule'].get('late_cutoff', row['schedule']['start'])) + threshold),
                'early': bool(actual and not missing and actual[-1][1] < expected[-1][1] - threshold),
                'absence': bool(not logs and row['shortage_minutes'] and row['verified'])}.get(code, False)
            event_id = uid(tenant, str(employee['_id']), on, code, 'automatic')
            if triggered and allow_new:
                violation_intervals = row['shortage_intervals']
                if code == 'late' and starts:
                    violation_intervals = intersect(violation_intervals, [[expected[0][0], starts[0][0]]])
                elif code == 'early' and actual:
                    violation_intervals = intersect(violation_intervals, [[actual[-1][1], expected[-1][1]]])
                current = post_event(db, tenant, employee, on, {'id': event_id, 'kind': 'violation', 'rule': code,
                    'rule_snapshot': rule, 'delta': -rule['points'], 'payroll_review': rule.get('payroll_review', False),
                    'reason': rule.get('name') or code, 'actor_id': actor, 'automatic': True, 'shortage_intervals': violation_intervals}, p)
            elif not triggered and any(e['id'] == event_id for e in current['events']):
                current = reverse_event(db, tenant, employee, on, event_id, actor, 'Attendance record corrected or verified')
    dispatch_employee_events(db, tenant, employee)
    return build_summary(db, tenant, employee, period)


def dispatch_employee_events(db, tenant, employee):
    from app.utils.notification_service import notify_users
    for record in db.employee_compliance_ledgers.find({'tenant_id': tenant, 'employee_id': str(employee['_id'])}):
        delivered = int(record.get('delivery_cursor', 0))
        for event in record['events'][delivered:]:
            audit(db, tenant, 'compliance_' + event['kind'], event['actor_id'], record['_id'],
                  {'balance': event['before']}, event, event['reason'], event_id=event['id'])
            if employee.get('user_id'):
                balance_notice = ' · points exhausted' if event['kind'] == 'violation' and event['after'] == 0 else ' · low points' if event['kind'] == 'violation' and event['after'] <= 1 else ''
                notify_users(db, [employee['user_id']], 'Attendance Compliance: ' + event['kind'].replace('_', ' ') + balance_notice,
                    event['reason'] + '. Remaining points: ' + str(event['after']),
                    {'page': 'attendance_compliance', 'employee_id': str(employee['_id']), 'source_id': event['id']},
                    tenant_id=tenant, event='attendance_compliance', event_key=event['id'], defer_push=True)

        db.employee_compliance_ledgers.update_one({'_id': record['_id'], 'tenant_id': tenant}, {'$max': {'delivery_cursor': len(record['events'])}})


def editable(db, tenant, employee, period):
    from .payroll_attendance_service import assert_payroll_period_is_editable, PayrollAttendanceError
    try:
        assert_payroll_period_is_editable(db, tenant, period, [str(employee['_id'])])
    except PayrollAttendanceError as exc:
        raise ComplianceError(str(exc), 409)


def add_time_adjustment(db, tenant, employee, data, actor):
    on = day(data.get('date')).isoformat()
    if day(on) >= local_now().date():
        raise ComplianceError('Only completed prior working dates may be verified.')
    editable(db, tenant, employee, on[:7])
    why = reason(data.get('reason'))
    kind = data.get('kind')
    if kind not in ('verified', 'paid_leave', 'official_duty', 'adjustment', 'compensatory', 'exemption', 'lwp', 'other_deduction', 'overtime'):
        raise ComplianceError('Invalid time adjustment kind.')
    intervals = data.get('intervals', [])
    if not isinstance(intervals, list) or len(intervals) > 20:
        raise ComplianceError('Provide at most 20 intervals.')
    clean = []
    for item in intervals:
        if not isinstance(item, list) or len(item) != 2:
            raise ComplianceError('Intervals must be [start minute, end minute].')
        a, b = number(item[0], 0, Decimal(2880)), number(item[1], 0, Decimal(2880))
        if a != int(a) or b != int(b) or b <= a:
            raise ComplianceError('Intervals must contain increasing integer minute offsets.')
        clean.append([int(a), int(b)])
    if kind != 'verified' and not clean:
        raise ComplianceError('An explicit time interval is required.')
    event_key = str(data.get('request_id', ''))
    if not 8 <= len(event_key) <= 100:
        raise ComplianceError('A request_id of 8–100 characters is required.')
    row = {'_id': uid(tenant, str(employee['_id']), event_key, 'time'), 'tenant_id': tenant, 'employee_id': str(employee['_id']),
           'date': on, 'period': on[:7], 'kind': kind, 'intervals': union(clean), 'status': 'approved', 'actor_id': actor,
           'reason': why, 'created_at': now().isoformat(), 'source_reference': str(data.get('source_reference', ''))[:200]}
    db.compliance_time_adjustments.update_one({'_id': row['_id'], 'tenant_id': tenant}, {'$setOnInsert': row}, upsert=True)
    stored = db.compliance_time_adjustments.find_one({'_id': row['_id'], 'tenant_id': tenant})
    audit(db, tenant, 'compliance_time_review', actor, row['_id'], None, stored, why, event_id=row['_id'])
    return stored


def notify_review(db, tenant, employee, row):
    from app.utils.notification_service import notify_users
    if employee.get('user_id'):
        notify_users(db, [employee['user_id']], 'Attendance Compliance monthly statement',
            'Review your verified shortage and submit any dispute before payroll approval.',
            {'page': 'attendance_compliance', 'source_id': row['_id']}, tenant_id=tenant,
            event='compliance_review', event_key=row['_id'], defer_push=True)


def approve_summary(db, tenant, employee, period, data, actor):
    editable(db, tenant, employee, period)
    if month_days(period)[-1] >= local_now().date():
        raise ComplianceError('Monthly shortage approval is available after the month closes.')
    why = reason(data.get('reason'))
    if str(employee.get('user_id')) == actor:
        raise ComplianceError('You cannot approve your own payroll shortage.', 403)
    summary = build_summary(db, tenant, employee, period)
    if any('existing violation on a non-working day' in w for w in summary['warnings']):
        raise ComplianceError('Review and restore points for non-working-day violations before approving payroll.', 409)
    if data.get('fingerprint') != summary['fingerprint']:
        raise ComplianceError('Attendance changed. Refresh the summary before approving.', 409)
    pending = db.compliance_disputes.count_documents({'tenant_id': tenant, 'employee_id': str(employee['_id']), 'period': period, 'status': 'pending'})
    if pending:
        raise ComplianceError('Resolve pending employee disputes before approving.', 409)
    p = policy(db, tenant)
    row = {'_id': uid(tenant, str(employee['_id']), period, summary['fingerprint'], 'review'),
        'tenant_id': tenant, 'employee_id': str(employee['_id']), 'period': period, 'fingerprint': summary['fingerprint'],
        'approved_minutes': summary['eligible_minutes'], 'allocations': [{'date': r['date'], 'intervals': r['eligible_intervals'], 'source_ids': r['source_ids']} for r in summary['days'] if r['eligible_minutes']],
        'status': 'approved', 'actor_id': actor, 'reason': why, 'created_at': now().isoformat(),
        'dispute_until': (local_now() + timedelta(days=p['dispute_days'])).isoformat(), 'summary': summary}
    db.compliance_payroll_reviews.update_one({'_id': row['_id'], 'tenant_id': tenant}, {'$setOnInsert': row}, upsert=True)
    stored = db.compliance_payroll_reviews.find_one({'_id': row['_id'], 'tenant_id': tenant})
    notify_review(db, tenant, employee, stored)
    audit(db, tenant, 'compliance_shortage_approved', actor, row['_id'], None, stored, why, event_id=uid(row['_id'], 'audit'))
    return stored


def review_for(db, tenant, employee, summary):
    return db.compliance_payroll_reviews.find_one({'tenant_id': tenant, 'employee_id': str(employee['_id']),
        'period': summary['period'], 'fingerprint': summary['fingerprint'], 'status': 'approved'}, sort=[('created_at', -1)])


def ensure_indexes(db):
    for name, keys in {
        'employee_compliance_ledgers': [('tenant_id', 1), ('employee_id', 1), ('cycle', 1)],
        'compliance_time_adjustments': [('tenant_id', 1), ('employee_id', 1), ('period', 1)],
        'compliance_payroll_reviews': [('tenant_id', 1), ('employee_id', 1), ('period', 1), ('fingerprint', 1)],
        'compliance_disputes': [('tenant_id', 1), ('employee_id', 1), ('period', 1), ('status', 1)],
    }.items():
        db[name].create_index(keys, name='attendance_compliance_scope', unique=name == 'employee_compliance_ledgers')
