"""Effective team responsibilities for the existing employee handover workflow.

Team keys remain the original employee references. Only current authority is
resolved; historical approvals, project authorship and financial values are never
rewritten. The resolver is read-only and works even before reconciliation runs.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from threading import Thread, Event
from uuid import uuid4
from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from flask import current_app, g, has_request_context, request
from app.services.active_employee_scope import employee_is_active

_held_locks = ContextVar('team_responsibility_locks', default=())

HR_ROLES = {'admin', 'hr', 'hr_admin', 'hr_manager'}
CATEGORIES = ['leave', 'local_conveyance', 'expenses', 'projects', 'targets',
              'monthly_planning', 'additional_work', 'attendance_requests',
              'visits', 'performance', 'reports']


def now():
    return datetime.now(timezone.utc)


def identifiers(person):
    return {str(person[k]).strip() for k in ('_id', 'employee_id', 'employee_code',
            'emp_code', 'user_id', 'employee_ref_id') if person and person.get(k)}


def capability(person, kind):
    if not person or not employee_is_active(person):
        return False
    raw = person.get('roles') or []
    roles = set(raw if isinstance(raw, list) else str(raw).split(','))
    roles.add(person.get('role', ''))
    names = ('team_leader', 'tl') if kind == 'tl' else ('reporting_officer', 'ro', 'manager')
    fields = ('is_team_leader', 'team_leader_capability', 'tl_capability') if kind == 'tl' else (
        'is_reporting_officer', 'reporting_officer_capability', 'ro_capability')
    return bool(roles.intersection(names) or any(str(person.get(k, '')).lower() in
        {'true', 'yes', '1', 'on'} for k in fields))


def read_snapshot(db, tenant):
    """One consistent directory snapshot per GET, never used for decisions."""
    if not has_request_context() or request.method not in {'GET', 'HEAD'}:
        return None
    cache = getattr(g, '_team_read_snapshot', None)
    if cache is None:
        cache = g._team_read_snapshot = {}
    cache_key = (id(db), tenant)
    if cache_key not in cache:
        people = list(db.employees.find({'tenant_id': tenant}))
        canonical = {str(p['_id']): p for p in people}
        aliases = {}
        for person in people:
            for value in identifiers(person):
                aliases.setdefault(value, []).append(person)
        records = {r['_id']: r for r in db.team_successions.find({'tenant_id': tenant})}
        cache[cache_key] = {'people': people, 'canonical': canonical, 'aliases': aliases, 'records': records}
    return cache[cache_key]


def resolve(db, tenant, value):
    """Resolve unambiguous IDs in one tenant, including a departed source."""
    if not isinstance(tenant, str) or not tenant.strip() or not value:
        return None
    raw = str(value).strip()
    snapshot = read_snapshot(db, tenant)
    if snapshot is not None:
        if raw in snapshot['canonical']:
            return snapshot['canonical'][raw]
        matches = snapshot['aliases'].get(raw, [])
        return matches[0] if len(matches) == 1 else None
    ors = [{k: raw} for k in ('employee_id', 'employee_code', 'emp_code', 'user_id', 'employee_ref_id')]
    if ObjectId.is_valid(raw):
        # Canonical IDs take precedence over legacy aliases.
        exact = db.employees.find_one({'tenant_id': tenant, '_id': ObjectId(raw)})
        if exact:
            return exact
    rows = list(db.employees.find({'tenant_id': tenant, '$or': ors}).limit(2))
    return rows[0] if len(rows) == 1 else None


def key(tenant, source_id):
    return 'team:' + sha256((tenant + ':' + str(source_id)).encode()).hexdigest()


def effective(db, tenant, source_id, seen=None):
    """Resolve the current leader of an explicitly mapped team."""

    source = resolve(db, tenant, source_id)

    if not source:
        return None, 'reassignment_required', None

    seen = set(seen or ())
    sid = str(source['_id'])

    if sid in seen:
        return None, 'reassignment_required', source

    seen.add(sid)

    snapshot = read_snapshot(db, tenant)

    record = (
        snapshot['records'].get(key(tenant, sid))
        if snapshot is not None
        else db.team_successions.find_one({
            '_id': key(tenant, sid),
            'tenant_id': tenant,
        })
    )

    replacement_id = (record or {}).get(
        'replacement_employee_id'
    )

    if replacement_id:
        target = resolve(db, tenant, replacement_id)

        if capability(target, 'tl'):
            raw_ro = target.get('reporting_officer_id')
            officer = resolve(db, tenant, raw_ro)

            # Preserve an already authorized permanent TL
            # when their RO subsequently separates.
            if not raw_ro or (
                officer and (
                    capability(officer, 'ro')
                    or not employee_is_active(officer)
                )
            ):
                return target, 'replacement_assigned', source

        if target and not employee_is_active(target):
            leader, _, _ = effective(
                db, tenant, target['_id'], seen
            )

            return (
                leader,
                'acting' if leader else 'reassignment_required',
                source,
            )

        return None, 'reassignment_required', source

    if employee_is_active(source):
        if capability(source, 'tl'):
            return source, 'active', source

        # A mapped RO may serve as the TL where a separate
        # Team Leader does not exist.
        if capability(source, 'ro') and team_members(
            db, tenant, source['_id']
        ):
            return source, 'active', source

        return None, 'reassignment_required', source

    officer = resolve(
        db, tenant, source.get('reporting_officer_id')
    )

    if (
        officer
        and officer['_id'] != source['_id']
        and capability(officer, 'ro')
    ):
        return officer, 'acting', source

    return None, 'reassignment_required', source


def sources(db, tenant):
    snapshot = read_snapshot(db, tenant)

    if snapshot is not None and 'sources' in snapshot:
        return snapshot['sources']

    people = hierarchy_people(db, tenant)

    values = {
        str(p.get('team_leader_id'))
        for p in people
        if p.get('team_leader_id')
    }

    values.update(
        str(v) for v in db.projects.distinct(
            'team_leader_id',
            {
                'tenant_id': tenant,
                'is_deleted': {'$ne': True},
            }
        ) if v
    )

    values.update(
        str(r['source_employee_id'])
        for r in db.team_successions.find({
            'tenant_id': tenant
        })
    )

    for person in people:
        if (
            employee_is_active(person)
            and not person.get('team_leader_id')
            and person.get('reporting_officer_id')
            and not capability(person, 'tl')
            and not capability(person, 'ro')
        ):
            values.add(
                str(person['reporting_officer_id'])
            )

    found = {}

    for value in values:
        person = resolve(db, tenant, value)

        if person:
            found[str(person['_id'])] = person

        elif ObjectId.is_valid(value):
            found[value] = {
                '_id': ObjectId(value),
                'tenant_id': tenant,
                'name': 'Missing Team Leader',
                'is_deleted': True,
            }

    result = list(found.values())

    if snapshot is not None:
        snapshot['sources'] = result

    return result


def leader_aliases(db, tenant, actor):
    if not actor or actor.get('tenant_id') != tenant or not employee_is_active(actor):
        return []
    own_leader, _, _ = effective(db, tenant, actor['_id'])
    values = identifiers(actor) if own_leader and own_leader['_id'] == actor['_id'] else set()
    for source in sources(db, tenant):
        leader, _, _ = effective(db, tenant, source['_id'])
        if leader and leader['_id'] == actor['_id']:
            values.update(identifiers(source))
    return sorted(values)


def can_lead(db, tenant, actor, source_id, subject=None):
    if not actor or actor.get('tenant_id') != tenant or not employee_is_active(actor):
        return False
    if subject and str(subject) in identifiers(actor):
        return False
    leader, _, _ = effective(db, tenant, source_id)
    return bool(leader and leader['_id'] == actor['_id'])


def team_members(db, tenant, source_id):
    source = resolve(db, tenant, source_id)

    if not source:
        return []

    refs = identifiers(source)
    output = []

    for person in hierarchy_people(db, tenant):
        if not employee_is_active(person):
            continue

        if same_employee(person, source):
            continue

        tl = str(person.get('team_leader_id') or '')
        ro = str(person.get('reporting_officer_id') or '')

        explicitly_mapped = tl in refs

        no_separate_tl = (
            not tl
            and ro in refs
            and capability(source, 'ro')
            and not capability(person, 'tl')
            and not capability(person, 'ro')
        )

        if explicitly_mapped or no_separate_tl:
            output.append(person)

    return output


def scoped_people(db, tenant, actor, include_self=True):
    if (
        not actor
        or actor.get('tenant_id') != tenant
        or not employee_is_active(actor)
    ):
        return []

    result = []

    for person in hierarchy_people(db, tenant):

        if same_employee(actor, person):
            if include_self:
                result.append(person)

            continue

        hierarchy = hierarchy_for_employee(
            db, tenant, person
        )

        team_authority = (
            same_employee(
                actor,
                hierarchy['team_leader'],
            )
            or same_employee(
                actor,
                hierarchy['reporting_officer'],
            )
        )

        # The superior can still review the leader's own
        # requests without inheriting unrelated teams.
        personal_authority = (
            (
                capability(person, 'tl')
                or capability(person, 'ro')
            )
            and same_employee(
                actor,
                personal_reporting_officer(
                    db, tenant, person
                ),
            )
        )

        if team_authority or personal_authority:
            result.append(person)

    return result


def reviewer(db, tenant, employee):
    stage = initial_manager_stage(db, tenant, employee)

    if stage == 'hr':
        return None

    return stage_manager(db, tenant, employee, stage)


def can_manage_team(db, tenant, actor, source_id):
    if (
        not actor
        or actor.get('tenant_id') != tenant
        or not employee_is_active(actor)
    ):
        return False

    if can_lead(db, tenant, actor, source_id):
        return True

    officer, _ = effective_reporting_officer(
        db, tenant, source_id
    )

    return same_employee(actor, officer)


def pending_scope(db, tenant, actor, field='team_leader_id'):
    return {field: {'$in': leader_aliases(db, tenant, actor)},
            'approval_stage': 'team_leader', 'status': {'$in': ['pending', 'in_review']}}


def collision_next_stage(db, tenant, source_id, officer_id, ordinary_next):
    leader, state, _ = effective(db, tenant, source_id)
    officer = resolve(db, tenant, officer_id)

    # Avoid duplicate approval when both roles resolve to the same
    # active employee, even if different identifier aliases are stored.
    if (
        state == 'active'
        and ordinary_next == 'reporting_officer'
        and leader
        and officer
        and leader['_id'] == officer['_id']
    ):
        return 'final'

    if state != 'active' and ordinary_next == 'reporting_officer' and (
            not officer or not capability(officer, 'ro') or (leader and leader['_id'] == officer['_id'])):
        # Preserve independent review; HR is an existing authorized fallback.
        return 'hr'
    return ordinary_next


class ResponsibilityBusy(ValueError):
    pass


@contextmanager
def mutation_guard(db, tenant):
    """Serialize appointments and approval decisions across workers; no process-local lock."""
    if tenant in _held_locks.get():
        yield
        return
    token, at = uuid4().hex, now()
    lock_id = 'responsibility:' + tenant
    try:
        row = db.responsibility_locks.find_one_and_update(
            {'_id': lock_id, '$or': [{'expires_at': {'$lte': at}}, {'token': {'$exists': False}}]},
            {'$set': {'tenant_id': tenant, 'token': token, 'expires_at': at + timedelta(minutes=10)}},
            upsert=True, return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:
        raise ResponsibilityBusy('Team responsibilities are being updated. Retry this action shortly.')
    if not row or row.get('token') != token:
        raise ResponsibilityBusy('Team responsibilities are being updated. Retry this action shortly.')
    held_token = _held_locks.set((*_held_locks.get(), tenant))
    try:
        yield
    finally:
        try:
            db.responsibility_locks.delete_one({'_id': lock_id, 'token': token})
        finally:
            _held_locks.reset(held_token)


def ensure_indexes(db):
    db.team_successions.create_index([('tenant_id', 1), ('source_employee_id', 1)], unique=True)
    db.team_successions.create_index([('tenant_id', 1), ('replacement_employee_id', 1)])
    db.employee_handover_history.create_index([('tenant_id', 1), ('succession_event_id', 1)],
        unique=True, partialFilterExpression={'succession_event_id': {'$type': 'string'}})
    db.responsibility_locks.create_index('expires_at', expireAfterSeconds=0)


def separation_instant(source):
    from app.services.notice_period_service import parse_day
    from zoneinfo import ZoneInfo
    if source.get('notice_status') in {'scheduled', 'serving', 'due_for_alumni', 'completed'}:
        try:
            day = parse_day(source.get('last_working_day') or source.get('last_working_date')) + timedelta(days=1)
            return datetime.combine(day, datetime.min.time(), tzinfo=ZoneInfo('Asia/Kolkata')).isoformat()
        except (KeyError, TypeError, ValueError):
            pass
    for field in ('separated_at', 'resigned_at', 'notice_completed_at'):
        if source.get(field):
            value = source[field]
            return value.isoformat() if hasattr(value, 'isoformat') else str(value)
    return now().isoformat()


def describe(db, tenant, source):
    from app.services.handover_preview import employee_exiting
    leader, state, _ = effective(db, tenant, source['_id'])
    saved = db.team_successions.find_one({'_id': key(tenant, source['_id']), 'tenant_id': tenant}) or {}
    members = team_members(db, tenant, source['_id'])
    def person(p):
        return {'id': str(p['_id']), 'name': p.get('name') or p.get('employee_name') or 'Employee',
                'employee_code': p.get('employee_code') or p.get('employee_id') or '', 'department': p.get('department', '')} if p else None
    return {'team_id': str(source['_id']), 'previous_leader': person(source), 'effective_leader': person(leader),
        'reporting_officer': person(resolve(db, tenant, source.get('reporting_officer_id'))),
        'status': state, 'version': saved.get('version', 0), 'members': [person(p) for p in members],
        'appointment_available': state in {'acting', 'reassignment_required'} or (state == 'active' and employee_exiting(source)),
        'effective_at': saved.get('effective_at'), 'delegation_started_at': saved.get('delegation_started_at'),
        'delegation_ended_at': saved.get('delegation_ended_at'),
        'unresolved': [] if leader else ['HR/Admin must assign an active Team Leader and valid Reporting Officer.'],
        'history': saved.get('events', [])}


def _reconcile(db, tenant, dry_run=True, actor='system'):
    """Idempotent metadata/outbox reconciliation; NEVER rewrites business records."""
    output = []
    for source in sources(db, tenant):
        view = describe(db, tenant, source)
        if view['status'] == 'active':
            continue
        output.append(view)
        if dry_run:
            continue
        sid = str(source['_id'])
        identifier = key(tenant, sid)
        target = view['effective_leader']['id'] if view['effective_leader'] else ''
        state_key = view['status'] + ':' + target
        existing = db.team_successions.find_one({'_id': identifier, 'tenant_id': tenant})
        if not existing:
            try:
                db.team_successions.insert_one({'_id': identifier, 'tenant_id': tenant,
                    'source_employee_id': sid, 'source_employee_code': view['previous_leader']['employee_code'],
                    'reporting_officer_id': str(source.get('reporting_officer_id') or ''),
                    'version': 0, 'events': [], 'effective_at': separation_instant(source)})
            except DuplicateKeyError:
                pass
            existing = db.team_successions.find_one({'_id': identifier, 'tenant_id': tenant})
        if existing.get('state_key') != state_key:
            version = existing['version'] + 1
            event_id = identifier + ':' + str(version)
            departed = resolve(db, tenant, existing.get('replacement_employee_id')) or source
            transition_at = (existing.get('appointed_at') if view['status'] == 'replacement_assigned' else
                             separation_instant(departed) if not employee_is_active(departed) else now().isoformat())
            delegation_start = existing.get('delegation_started_at')
            delegation_end = existing.get('delegation_ended_at')
            if view['status'] == 'acting' and existing.get('status') != 'acting':
                delegation_start, delegation_end = transition_at, None
            elif view['status'] == 'reassignment_required' and existing.get('status') == 'acting':
                delegation_end = now().isoformat()
            event = {'id': event_id, 'at': now().isoformat(), 'actor_id': actor, 'status': view['status'],
                'effective_leader_id': target, 'previous_team_leader_id': sid,
                'previous_team_leader_code': view['previous_leader']['employee_code'], 'team_id': sid,
                'replacement_employee_id': existing.get('replacement_employee_id'),
                'effective_at': transition_at, 'delegation_started_at': delegation_start,
                'delegation_ended_at': delegation_end,
                'reporting_officer_id': str(source.get('reporting_officer_id') or ''),
                'reason': 'Effective employee separation / explicit replacement assignment',
                'categories': CATEGORIES, 'affected_members': len(view['members']),
                'historical_records_rewritten': 0, 'unresolved': view['unresolved']}
            db.team_successions.update_one({'_id': identifier, 'tenant_id': tenant, 'version': existing['version']},
                {'$set': {'state_key': state_key, 'status': view['status'], 'effective_leader_id': target,
                          'effective_at': transition_at, 'delegation_started_at': delegation_start,
                          'delegation_ended_at': delegation_end},
                 '$inc': {'version': 1}, '$push': {'events': event}})
        dispatch_events(db, tenant, identifier)
    return output


def reconcile(db, tenant, dry_run=True, actor='system'):
    if dry_run:
        return _reconcile(
            db, tenant, dry_run=True, actor=actor
        )

    with mutation_guard(db, tenant):
        result = _reconcile(
            db, tenant, dry_run=False, actor=actor
        )

        reconcile_reporting_officers(db, tenant)
        reconcile_pending_officer_collisions(db, tenant)

        return result


def dispatch_events(db, tenant, identifier):
    from app.utils.notification_service import notify_users
    record = db.team_successions.find_one({'_id': identifier, 'tenant_id': tenant})
    source = resolve(db, tenant, record['source_employee_id'])
    for event in record.get('events', []):
        if event.get('delivered'):
            continue
        eid = event['id']
        # Deterministic IDs make retries safe after partial persistence failure.
        db.audit_logs.update_one({'_id': eid}, {'$setOnInsert': {'tenant_id': tenant, 'action': 'team_succession',
            'entity': 'employees', 'entity_id': record['source_employee_id'], 'actor_id': event['actor_id'],
            'created_at': now(), 'meta': event}}, upsert=True)
        db.employee_handover_history.update_one({'_id': eid}, {'$setOnInsert': {'tenant_id': tenant,
            'succession_event_id': eid, 'kind': 'team_succession', 'departing_employee_id': record['source_employee_id'],
            'replacement_employee_id': event.get('effective_leader_id'), 'authorized_by': event['actor_id'],
            'created_at': now(), 'details': event}}, upsert=True)
        leader = resolve(db, tenant, event.get('effective_leader_id'))
        hr_users = [str(u['_id']) for u in db.users.find({'tenant_id': tenant, 'is_active': True,
                    'roles': {'$in': sorted(HR_ROLES)}})]
        groups = [(hr_users, 'Team Leader succession update',
                   'Team responsibilities updated. Review vacancies and unresolved mappings in Employee handover.')]
        if leader and leader.get('user_id'):
            title = 'Team Responsibilities Assigned' if event['status'] == 'replacement_assigned' else 'Temporary Team Leader Responsibilities Assigned'
            groups.append(([str(leader['user_id'])], title,
                'Applicable pending approvals and team management responsibilities are now available in your account.'))
        members = team_members(db, tenant, record['source_employee_id'])
        groups.append(([str(p['user_id']) for p in members if p.get('user_id')], 'Team Leader Responsibility Update',
            'Your replacement Team Leader now manages applicable approvals.' if event['status'] == 'replacement_assigned' else
            ('Your Reporting Officer temporarily manages applicable approvals until a replacement Team Leader is assigned.'
             if leader else 'Your team requires reassignment. HR/Admin has been notified; existing requests are preserved.')))
        if event['status'] == 'replacement_assigned':
            officer = resolve(db, tenant, record.get('reporting_officer_id'))
            if officer and officer.get('user_id'):
                groups.append(([str(officer['user_id'])], 'Temporary responsibilities ended',
                    'A replacement Team Leader has been assigned. Your normal Reporting Officer responsibilities continue.'))
        for index, (users, title, body) in enumerate(groups):
            users = [str(u['_id']) for u in db.users.find({'tenant_id': tenant, 'is_active': True,
                '_id': {'$in': [ObjectId(uid) for uid in users if ObjectId.is_valid(uid)]}})]
            if users:
                notify_users(db, users, title, body, {'page': 'projects', 'type': 'team_succession',
                    'team_id': record['source_employee_id']}, tenant_id=tenant,
                    event='team.succession', event_key=eid + ':' + str(index))
        db.team_successions.update_one({'_id': identifier, 'tenant_id': tenant, 'events.id': eid},
                                      {'$set': {'events.$.delivered': True}})


def appoint(db, tenant, source_id, target_id, version, actor):
    with mutation_guard(db, tenant):
        source, target = resolve(db, tenant, source_id), resolve(db, tenant, target_id)
        if not source or not target or source['_id'] == target['_id'] or not capability(target, 'tl'):
            raise ValueError('Select a different active Team Leader in this company.')
        from app.services.handover_preview import employee_exiting
        if employee_is_active(source) and not employee_exiting(source):
            raise ValueError('The selected team does not have an effective or scheduled separation.')
        officer = resolve(db, tenant, source.get('reporting_officer_id'))
        if not capability(officer, 'ro') or officer['_id'] == target['_id']:
            raise ValueError('Map a separate active Reporting Officer before appointing the replacement.')
        if str(target.get('reporting_officer_id', '')) not in identifiers(officer):
            raise ValueError("The replacement must be mapped to this team's Reporting Officer.")
        if str(target.get('team_leader_id', '')) in identifiers(source):
            raise ValueError("Remove the replacement's former team-member mapping first to prevent self-supervision.")
        identifier = key(tenant, source['_id'])
        record = db.team_successions.find_one({'_id': identifier, 'tenant_id': tenant})
        if record and record.get('replacement_employee_id') == str(target['_id']):
            # Retry outbox work if a previous request persisted the appointment
            # but stopped before notifications/audit were delivered.
            reconcile(db, tenant, dry_run=False, actor=actor)
            return describe(db, tenant, source)
        if (record or {}).get('version', 0) != version:
            raise ValueError('Team responsibilities changed. Refresh before assigning.')
        previous = resolve(db, tenant, (record or {}).get('replacement_employee_id'))
        if previous and employee_is_active(previous):
            raise ValueError("This team already has an active replacement. Review that leader's lifecycle before another handover.")
        update = {'replacement_employee_id': str(target['_id']), 'appointed_by': actor,
                  'appointed_at': now().isoformat(), 'delegation_ended_at': now().isoformat(),
                  'reporting_officer_id': str(officer['_id'])}
        if record:
            result = db.team_successions.update_one({'_id': identifier, 'tenant_id': tenant, 'version': version},
                {'$set': update, '$inc': {'version': 1}})
            if not result.matched_count:
                raise ValueError('Team responsibilities changed. Refresh before assigning.')
        else:
            db.team_successions.insert_one({'_id': identifier, 'tenant_id': tenant, 'source_employee_id': str(source['_id']),
                'version': 1, 'events': [], 'effective_at': separation_instant(source), **update})
        reconcile(db, tenant, dry_run=False, actor=actor)
    return describe(db, tenant, source)


def start_worker(app):
    """Gunicorn workers share a Mongo lease; authority never waits for this timer."""
    import os
    if app.config.get('TESTING') or os.environ.get('YOURCOMATE_TEST_ISOLATION') == '1' or os.environ.get('PYTEST_CURRENT_TEST') or app.extensions.get('team_responsibility_worker'):
        return
    stop = Event()
    def run():
        while not stop.wait(60):
            with app.app_context():
                try:
                    from app.extensions import get_db
                    db = get_db()
                    ensure_indexes(db)
                    for tenant in db.employees.distinct('tenant_id'):
                        if not isinstance(tenant, str) or not tenant.strip():
                            continue
                        try:
                            with mutation_guard(db, tenant):
                                reconcile(db, tenant, dry_run=False)
                        except ResponsibilityBusy:
                            continue
                except Exception:
                    app.logger.exception('Team succession reconciliation failed; will retry')
    worker = Thread(target=run, name='team-succession', daemon=True)
    app.extensions['team_responsibility_worker'] = (worker, stop)
    worker.start()


def serialized_action(fn):
    from functools import wraps
    @wraps(fn)
    def wrapped(*args, **kwargs):
        from app.extensions import get_db
        tenant = getattr(g, 'tenant_id', None)
        if not tenant:
            raise ValueError('Authenticated company context is required')
        with mutation_guard(get_db(), tenant):
            return fn(*args, **kwargs)
    return wrapped


# ============================================================
# YOURCOMATE_CENTRAL_HIERARCHY_V2
# Scoped reverse succession and effective approval resolution.
# ============================================================

def same_employee(first, second):
    return bool(
        first and second
        and first.get('_id') is not None
        and str(first['_id']) == str(second.get('_id'))
    )


def hierarchy_people(db, tenant):
    if not isinstance(tenant, str) or not tenant.strip():
        return []

    snapshot = read_snapshot(db, tenant)

    if snapshot is not None:
        return snapshot['people']

    return list(db.employees.find({
        'tenant_id': tenant,
        'is_deleted': {'$ne': True},
    }))


def live_employee(db, tenant, employee):
    if not employee or employee.get('tenant_id') != tenant:
        return None

    return resolve(db, tenant, employee.get('_id'))


def effective_reporting_officer(db, tenant, source_id):
    """Resolve RO authority for this team only."""

    leader, leader_state, source = effective(
        db, tenant, source_id
    )

    if not leader or not source:
        return None, 'reassignment_required'

    # Explicitly assigned combined team responsibilities.
    # The leader's personal reporting relationship is separate.
    if capability(leader, 'tl') and capability(leader, 'ro'):
        return leader, 'active'

    if leader_state == 'acting' and capability(leader, 'ro'):
        return leader, 'active'

    if (
        same_employee(leader, source)
        and capability(leader, 'ro')
        and not capability(leader, 'tl')
    ):
        return leader, 'active'

    raw_ro = leader.get('reporting_officer_id')

    if raw_ro:
        officer = resolve(db, tenant, raw_ro)

        if capability(officer, 'ro'):
            return officer, 'active'

        # Reverse succession is allowed only when the mapped
        # RO is a known employee of this tenant who separated.
        if (
            officer
            and not employee_is_active(officer)
            and capability(leader, 'tl')
        ):
            return leader, 'acting'

        return None, 'reassignment_required'

    # A genuine empty RO mapping allows temporary,
    # team-scoped TL responsibility.
    if capability(leader, 'tl'):
        return leader, 'acting'

    if capability(leader, 'ro'):
        return leader, 'active'

    return None, 'reassignment_required'


def hierarchy_for_employee(db, tenant, employee):
    """Resolve current team authority without changing employee roles."""

    result = {
        'source': None,
        'team_leader': None,
        'reporting_officer': None,
        'team_leader_status': 'reassignment_required',
        'reporting_officer_status': 'reassignment_required',
    }

    person = live_employee(db, tenant, employee)

    if not person:
        return result

    source_id = None

    if capability(person, 'tl'):
        source_id = person['_id']

    elif person.get('team_leader_id'):
        source_id = person['team_leader_id']

    if source_id:
        leader, state, source = effective(
            db, tenant, source_id
        )

        officer, officer_state = effective_reporting_officer(
            db, tenant, source_id
        )

        result.update({
            'source': source,
            'team_leader': leader,
            'reporting_officer': officer,
            'team_leader_status': state,
            'reporting_officer_status': officer_state,
        })

        if (
            leader and officer
            and same_employee(leader, officer)
            and capability(leader, 'ro')
            and not capability(leader, 'tl')
        ):
            result['team_leader_status'] = 'acting'

        return result

    raw_ro = person.get('reporting_officer_id')
    officer = resolve(db, tenant, raw_ro)

    if capability(officer, 'ro'):
        result.update({
            'source': officer,
            'reporting_officer': officer,
            'reporting_officer_status': 'active',
        })

        if not capability(person, 'ro'):
            result['team_leader'] = officer
            result['team_leader_status'] = 'acting'

        return result

    if capability(person, 'ro') and not raw_ro:
        result['reporting_officer'] = person
        result['reporting_officer_status'] = 'active'

    return result


def independent_manager(person, candidate):
    return bool(
        person
        and candidate
        and employee_is_active(candidate)
        and person.get('tenant_id') == candidate.get('tenant_id')
        and not same_employee(person, candidate)
    )


def initial_manager_stage(db, tenant, employee):
    person = live_employee(db, tenant, employee)

    if not person or not employee_is_active(person):
        return 'hr'

    if capability(person, 'tl') or capability(person, 'ro'):
        return (
            'reporting_officer'
            if personal_reporting_officer(
                db, tenant, person
            )
            else 'hr'
        )

    hierarchy = hierarchy_for_employee(
        db, tenant, person
    )

    if (
        person.get('team_leader_id')
        and independent_manager(
            person,
            hierarchy['team_leader'],
        )
    ):
        return 'team_leader'

    if independent_manager(
        person,
        hierarchy['reporting_officer'],
    ):
        return 'reporting_officer'

    return 'hr'


def stage_manager(db, tenant, employee, stage):
    person = live_employee(db, tenant, employee)

    if not person or not employee_is_active(person):
        return None

    if stage not in {
        'team_leader',
        'reporting_officer',
    }:
        return None

    # A leader's own request must not be resolved using
    # their authority over subordinate employees.
    if capability(person, 'tl') or capability(person, 'ro'):
        return personal_reporting_officer(
            db, tenant, person
        )

    hierarchy = hierarchy_for_employee(
        db, tenant, person
    )

    candidate = hierarchy.get(stage)

    if independent_manager(person, candidate):
        return candidate

    return None


def request_owner(db, tenant, record, field='employee_id'):
    if not record or record.get('tenant_id') != tenant:
        return None

    return resolve(db, tenant, record.get(field))


def request_manager(db, tenant, record, stage=None,
                    field='employee_id'):

    person = request_owner(db, tenant, record, field)

    if not person:
        return None

    return stage_manager(
        db,
        tenant,
        person,
        stage or record.get('approval_stage'),
    )


def prior_approval(record, actor, user_id=None):
    if not actor and not user_id:
        return False

    values = identifiers(actor)

    if user_id:
        values.add(str(user_id))

    if str(record.get('team_leader_decision_by') or '') in values:
        return True

    for entry in record.get('approval_history') or []:
        action = str(
            entry.get('status') or entry.get('action') or ''
        ).lower()

        decision_by = str(
            entry.get('decided_by')
            or entry.get('actor_id')
            or entry.get('by')
            or ''
        )

        if action == 'approved' and decision_by in values:
            return True

    return False


def can_decide_manager_stage(db, tenant, actor, record,
                             user_id=None):
    if not actor or not employee_is_active(actor):
        return False

    if actor.get('tenant_id') != tenant:
        return False

    person = request_owner(db, tenant, record)

    if not person or same_employee(actor, person):
        return False

    stage = record.get('approval_stage')
    manager = request_manager(db, tenant, record, stage)

    if not same_employee(actor, manager):
        return False

    if (
        stage == 'reporting_officer'
        and prior_approval(record, actor, user_id)
    ):
        return False

    return True


def subject_reference_values(db, tenant, person):
    output = [str(person['_id']), person['_id']]

    for value in identifiers(person):
        if same_employee(resolve(db, tenant, value), person):
            output.append(value)

    return list(dict.fromkeys(output))


def manager_subject_values(db, tenant, actor, stage=None):
    if (
        not actor
        or actor.get('tenant_id') != tenant
        or not employee_is_active(actor)
    ):
        return []

    output = []

    for person in hierarchy_people(db, tenant):
        if not employee_is_active(person):
            continue

        if same_employee(actor, person):
            continue

        target_stage = stage or initial_manager_stage(
            db, tenant, person
        )

        manager = stage_manager(
            db, tenant, person, target_stage
        )

        if same_employee(actor, manager):
            output.extend(
                subject_reference_values(db, tenant, person)
            )

    return list(dict.fromkeys(output))


def manager_stage_scope(db, tenant, actor, stage):
    query = {
        'approval_stage': stage,
        'employee_id': {
            '$in': manager_subject_values(
                db, tenant, actor, stage
            )
        },
        'status': {'$in': ['pending', 'in_review']},
    }

    if stage == 'reporting_officer' and actor:
        query['team_leader_decision_by'] = {
            '$nin': list(identifiers(actor))
        }

    return query


def acting_officer_for_team(db, tenant, actor, source_id):
    officer, state = effective_reporting_officer(
        db, tenant, source_id
    )

    return bool(
        state == 'acting'
        and same_employee(actor, officer)
        and employee_is_active(actor)
        and actor.get('tenant_id') == tenant
    )


def current_manager_user_id(db, tenant, record, stage=None):
    manager = request_manager(db, tenant, record, stage)

    return str(manager.get('user_id') or '') if manager else ''


def reconcile_reporting_officers(db, tenant):
    """Persist team-scoped RO transitions and notify responsible staff.

    Authority is computed live even before this worker executes.
    No completed business record is rewritten.
    """

    from app.utils.notification_service import notify_users

    output = []

    for source in sources(db, tenant):
        leader, _, _ = effective(
            db, tenant, source.get('_id')
        )

        if not leader or not capability(leader, 'tl'):
            continue

        raw_ro = leader.get('reporting_officer_id')
        former = resolve(db, tenant, raw_ro)

        officer, state = effective_reporting_officer(
            db, tenant, source['_id']
        )

        team_id = str(source['_id'])
        record_id = 'officer:' + key(tenant, team_id)

        previous = db.team_officer_successions.find_one({
            '_id': record_id,
            'tenant_id': tenant,
        })

        target = str(officer['_id']) if officer else ''
        fingerprint = state + ':' + target + ':' + str(raw_ro or '')

        known_departure = bool(
            former and not employee_is_active(former)
        )

        if not previous and not known_departure:
            db.team_officer_successions.update_one(
                {'_id': record_id, 'tenant_id': tenant},
                {
                    '$setOnInsert': {
                        'tenant_id': tenant,
                        'team_id': team_id,
                        'state_key': fingerprint,
                        'status': state,
                        'effective_officer_id': target,
                        'version': 0,
                        'events': [],
                    }
                },
                upsert=True,
            )
            continue

        if not previous:
            db.team_officer_successions.update_one(
                {'_id': record_id, 'tenant_id': tenant},
                {
                    '$setOnInsert': {
                        'tenant_id': tenant,
                        'team_id': team_id,
                        'version': 0,
                        'events': [],
                    }
                },
                upsert=True,
            )

            previous = db.team_officer_successions.find_one({
                '_id': record_id,
                'tenant_id': tenant,
            })

        if previous.get('state_key') != fingerprint:
            version = previous.get('version', 0) + 1
            event_id = record_id + ':' + str(version)

            event = {
                'id': event_id,
                'at': now().isoformat(),
                'effective_at': (
                    separation_instant(former)
                    if known_departure else now().isoformat()
                ),
                'status': state,
                'team_id': team_id,
                'effective_officer_id': target,
                'previous_officer_id': previous.get(
                    'effective_officer_id'
                ),
                'acting_team_leader_id': str(leader['_id']),
                'historical_records_rewritten': 0,
                'categories': CATEGORIES,
            }

            db.team_officer_successions.update_one(
                {
                    '_id': record_id,
                    'tenant_id': tenant,
                    'version': previous.get('version', 0),
                },
                {
                    '$set': {
                        'state_key': fingerprint,
                        'status': state,
                        'effective_officer_id': target,
                        'updated_at': now(),
                    },
                    '$inc': {'version': 1},
                    '$push': {'events': event},
                },
            )

            output.append(event)

        current = db.team_officer_successions.find_one({
            '_id': record_id,
            'tenant_id': tenant,
        })

        for event in current.get('events', []):
            if event.get('delivered'):
                continue

            event_id = event['id']

            db.audit_logs.update_one(
                {'_id': event_id},
                {
                    '$setOnInsert': {
                        'tenant_id': tenant,
                        'action': 'reporting_officer_succession',
                        'entity': 'employees',
                        'entity_id': team_id,
                        'actor_id': 'system',
                        'created_at': now(),
                        'meta': event,
                    }
                },
                upsert=True,
            )

            recipients = {
                str(u['_id'])
                for u in db.users.find({
                    'tenant_id': tenant,
                    'is_active': True,
                    'roles': {'$in': sorted(HR_ROLES)},
                })
            }

            for person in (
                leader,
                resolve(
                    db, tenant,
                    event.get('effective_officer_id')
                ),
                resolve(
                    db, tenant,
                    event.get('previous_officer_id')
                ),
            ):
                if (
                    person
                    and employee_is_active(person)
                    and person.get('user_id')
                ):
                    recipients.add(str(person['user_id']))

            active_ids = [
                ObjectId(uid)
                for uid in recipients
                if ObjectId.is_valid(uid)
            ]

            recipients = [
                str(u['_id'])
                for u in db.users.find({
                    'tenant_id': tenant,
                    'is_active': True,
                    '_id': {'$in': active_ids},
                })
            ]

            if recipients:
                notify_users(
                    db,
                    recipients,
                    'Reporting Officer Responsibility Updated',
                    (
                        'Team Leader now has Acting Reporting Officer '
                        'responsibilities for the assigned team.'
                        if event['status'] == 'acting'
                        else 'Reporting Officer responsibilities have '
                             'been reassigned. Review your approval queue.'
                    ),
                    {
                        'type': 'reporting_officer_succession',
                        'team_id': team_id,
                        'page': 'team_approvals',
                    },
                    tenant_id=tenant,
                    event='team.officer_succession',
                    event_key=event_id,
                )

            db.team_officer_successions.update_one(
                {
                    '_id': record_id,
                    'tenant_id': tenant,
                    'events.id': event_id,
                },
                {'$set': {'events.$.delivered': True}},
            )

    return output


def reconcile_pending_officer_collisions(db, tenant):
    """Escalate already-pending duplicate RO approvals for HR review.

    Never silently finalize an existing leave or financial request.
    """

    from app.utils.notification_service import notify_users

    recipients = [
        str(u['_id'])
        for u in db.users.find({
            'tenant_id': tenant,
            'is_active': True,
            'roles': {'$in': sorted(HR_ROLES)},
        })
    ]

    for collection_name in (
        'leave_requests',
        'attendance_mode_requests',
        'holiday_work_requests',
    ):
        collection = db[collection_name]

        query = {
            'tenant_id': tenant,
            'approval_stage': 'reporting_officer',
            'status': {'$in': ['pending', 'in_review']},
            'is_deleted': {'$ne': True},
        }

        for record in collection.find(query):
            owner = request_owner(db, tenant, record)

            if not owner:
                continue

            hierarchy = hierarchy_for_employee(
                db, tenant, owner
            )

            manager = stage_manager(
                db, tenant, owner, 'reporting_officer'
            )

            collision = bool(
                manager and prior_approval(
                    record,
                    manager,
                    manager.get('user_id'),
                )
            )

            owner_is_acting_ro = (
                hierarchy['reporting_officer_status'] == 'acting'
                and same_employee(
                    owner, hierarchy['reporting_officer']
                )
            )

            if not (collision or owner_is_acting_ro):
                continue

            if not recipients:
                continue

            event_id = (
                'hierarchy-escalation:'
                + collection_name
                + ':'
                + str(record['_id'])
            )

            changed = collection.update_one(
                {
                    '_id': record['_id'],
                    'tenant_id': tenant,
                    'status': record['status'],
                    'approval_stage': 'reporting_officer',
                },
                {
                    '$set': {
                        'approval_stage': 'hr',
                        'approval_stage_label': 'HR',
                        'hr_status': 'pending',
                        'hierarchy_escalation_reason':
                            'Independent reviewer required after succession',
                        'updated_at': now(),
                    }
                },
            )

            if not changed.modified_count:
                continue

            db.audit_logs.update_one(
                {'_id': event_id},
                {
                    '$setOnInsert': {
                        'tenant_id': tenant,
                        'action': 'hierarchy_approval_escalated',
                        'entity': collection_name,
                        'entity_id': str(record['_id']),
                        'actor_id': 'system',
                        'created_at': now(),
                    }
                },
                upsert=True,
            )

            notify_users(
                db,
                recipients,
                'Independent Approval Required',
                'A pending request needs HR review after a hierarchy change.',
                {
                    'type': 'hierarchy_approval_escalated',
                    'page': 'team_approvals',
                    'source_id': str(record['_id']),
                },
                tenant_id=tenant,
                event='team.approval_escalation',
                event_key=event_id,
            )


# YOURCOMATE_COMBINED_HIERARCHY_FINAL_V1

def personal_reporting_officer(db, tenant, employee):
    """Resolve a leader's own independent approver."""

    person = live_employee(db, tenant, employee)

    if not person or not employee_is_active(person):
        return None

    officer = resolve(
        db,
        tenant,
        person.get('reporting_officer_id'),
    )

    if (
        capability(officer, 'ro')
        and independent_manager(person, officer)
    ):
        return officer

    return None
