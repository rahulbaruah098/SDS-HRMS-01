"""YourComate Sprint Planning REST API (Phase 1, file 2).

Registration in app/__init__.py is a separate next step. Evidence references
are stored as user submissions, NOT independently verified proof or uploaded files.
"""
from datetime import datetime, timezone
from bson import ObjectId
from flask import Blueprint, g, jsonify, request
from pymongo.errors import DuplicateKeyError

from app.extensions import get_db
from app.utils.auth import current_user_required, audit
from app.utils.serializers import clean_doc
from app.routes.projects import get_current_employee, employee_identifier_values
from app.services.sprint_planning_service import (
    PlanningError, new_monthly_plan, new_weekly_plan, validate_daily_update,
    checkout_readiness, utc_now,
)

sprint_planning_bp = Blueprint('sprint_planning', __name__)





def _tenant():
    return str(getattr(g, 'tenant_id', None) or g.current_user.get('tenant_id') or 'sds')


def _actor():
    return str(g.current_user.get('_id') or '')


def _roles():
    raw = g.current_user.get('roles') or [g.current_user.get('role', '')]
    if isinstance(raw, str):
        raw = raw.split(',')
    return {str(r).strip().lower().replace('-', '_').replace(' ', '_') for r in raw}


def _admin():
    return bool(_roles() & {'super_admin', 'admin'})


def _employee(db):
    employee = get_current_employee(db)
    if employee is None or str(employee.get("tenant_id")) != _tenant():
        return None
    return employee


def _oid(value):
    try:
        return ObjectId(str(value))
    except (TypeError, ValueError):
        return None


def _error(message, code=400):
    return jsonify({'message': message}), code


def _payload():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise PlanningError('JSON object body required')
    return body


def _identifiers(employee):
    return {str(x).strip().lower() for x in employee_identifier_values(employee) if str(x).strip()}


def _manager_for(db, target_id, kind):
    """Require an actual employee-reporting relationship; fail closed."""
    actor_emp = _employee(db)
    if actor_emp is None:
        return False
    target = db.employees.find_one({'_id': _oid(target_id), 'tenant_id': _tenant(), 'is_deleted': {'$ne': True}})
    if target is None or str(target['_id']) == str(actor_emp['_id']):
        return False
    aliases = _identifiers(actor_emp)
    fields = (
        ('team_leader_id', 'team_leader_user_id', 'team_leader_employee_id')
        if kind == 'tl' else
        ('reporting_officer_id', 'reporting_officer_user_id', 'reporting_officer_employee_id')
    )
    return any(str(target.get(f) or '').strip().lower() in aliases for f in fields if target.get(f))


def _can_read(db, target_id):
    employee = _employee(db)
    if employee and str(employee['_id']) == str(target_id):
        return True
    return _admin() or _manager_for(db, target_id, 'tl') or _manager_for(db, target_id, 'ro')


def _own_id(db):
    employee = _employee(db)
    if employee is None:
        raise PlanningError('No employee profile linked to signed-in user')
    return str(employee['_id'])


def _document(db, collection, doc_id):
    oid = _oid(doc_id)
    if oid is None:
        return None
    return db[collection].find_one({'_id': oid, 'tenant_id': _tenant(), 'is_deleted': {'$ne': True}})


def _serialize(value):
    return jsonify(clean_doc(value))


def _safe_call(fn):
    try:
        return fn()
    except PlanningError as exc:
        return _error(str(exc))
    except DuplicateKeyError:
        return _error('A plan for this period already exists', 409)



@sprint_planning_bp.before_request
@current_user_required
def _sprint_saas_role_guard():
    """Keep platform and organisation administrators outside Sprint Planning.

    SaaS administration does not confer employee-workflow permissions.
    This guard runs before every Sprint Planning endpoint.
    """
    roles = _roles()

    if roles & {'super_admin'}:
        return _error(
            'Sprint Planning is not available to administrators',
            403
        )

    return None




def _monthly_approval_kind(db, target_id):
    """Determine the correct monthly reviewer without allowing self-approval."""
    target = db.employees.find_one({
        '_id': _oid(target_id),
        'tenant_id': _tenant(),
        'is_deleted': {'$ne': True},
    })

    if target is None:
        raise PlanningError('Employee profile not found')

    roles = set()

    for field in ('role', 'hrms_role', 'designation_role'):
        value = target.get(field)
        if isinstance(value, str):
            roles.add(value.strip().lower().replace('-', '_').replace(' ', '_'))
        elif isinstance(value, (list, tuple)):
            roles.update(
                str(item).strip().lower().replace('-', '_').replace(' ', '_')
                for item in value
            )

    # The signed-in user's authenticated roles are authoritative
    # when resolving their own plan or a team compilation.
    actor_employee = _employee(db)
    if actor_employee is not None and str(actor_employee['_id']) == str(target['_id']):
        roles.update(
            str(role).strip().lower().replace('-', '_').replace(' ', '_')
            for role in _roles()
        )

    # Linked user lookup is supplementary, not a replacement
    # for authenticated identity.
    for key in ('user_id', 'linked_user_id'):
        linked = target.get(key)
        if not linked:
            continue

        try:
            user = db.users.find_one({
                '_id': _oid(str(linked)),
                'tenant_id': _tenant(),
            })
        except (TypeError, ValueError):
            user = None

        if user is None:
            continue

        values = user.get('roles') or []
        if isinstance(values, str):
            values = [values]

        for role in list(values) + [user.get('role')]:
            if role:
                roles.add(
                    str(role).strip().lower().replace('-', '_').replace(' ', '_')
                )

        break

    return 'ro' if roles.intersection({'team_leader', 'tl'}) else 'tl'





def _monthly_team_members_unfiltered(db, leader_id):
    """Find active employees assigned to this signed-in Team Leader."""
    if str(leader_id) != _own_id(db):
        raise PlanningError('Only your own team can be compiled')
    members = []
    cursor = db.employees.find({
        'tenant_id': _tenant(),
        'is_deleted': {'$ne': True},
    })
    for employee in cursor:
        employee_id = str(employee['_id'])
        if employee_id != leader_id and _manager_for(db, employee_id, 'tl'):
            members.append(employee)
    return members


def _monthly_admin_exempt(employee):
    """Explicit Organisation Admin role exempts mandatory monthly plans.

    Never infer Admin privileges from department, designation,
    employee name, or display-only reporting officer metadata.
    """
    if not isinstance(employee, dict):
        return False

    raw_roles = []

    for field in ('role', 'roles', 'user_role', 'user_roles'):
        value = employee.get(field)

        if isinstance(value, str):
            raw_roles.append(value)
        elif isinstance(value, (list, tuple, set)):
            for item in value:
                if isinstance(item, str):
                    raw_roles.append(item)

    normalized = {
        item.strip().lower().replace('-', '_').replace(' ', '_')
        for item in raw_roles
    }

    # The platform Super Admin is not an Organisation Admin.
    # This exemption grants no platform-level privileges.
    return bool(normalized.intersection({
        'admin',
        'organization_admin',
        'organisation_admin',
        'org_admin',
    }))


def _monthly_plan_required(employee):
    """Mandatory for employees, TLs and non-admin ROs."""
    return not _monthly_admin_exempt(employee)


def _monthly_team_members(db, leader_id):
    """Resolve the original team, excluding only explicit admins."""
    members = _monthly_team_members_unfiltered(db, leader_id)

    return [
        employee for employee in members
        if _monthly_plan_required(employee)
    ]





def _monthly_identity_aliases(employee):
    """Identifiers accepted for an explicitly assigned HRMS employee."""
    fields = (
        '_id', 'employee_id', 'employee_code',
        'user_id', 'linked_user_id',
    )
    return {
        str(employee.get(field)).strip().lower()
        for field in fields if employee.get(field)
    }



def _monthly_assigned_tl(db, employee):
    """Resolve the explicit Team Leader through active same-tenant records."""
    refs = {
        str(employee.get(field)).strip().lower()
        for field in (
            'team_leader_id',
            'team_leader_user_id',
            'team_leader_employee_id',
        )
        if employee.get(field)
    }

    if not refs:
        return None

    candidates = db.employees.find({
        'tenant_id': _tenant(),
        'is_deleted': {'$ne': True},
    })

    matches = {
        str(candidate['_id']): candidate
        for candidate in candidates
        if refs.intersection(_monthly_identity_aliases(candidate))
    }

    if len(matches) != 1:
        raise PlanningError(
            'Team Leader assignment is missing, ambiguous, or invalid. '
            'Ask HR to verify the reporting hierarchy.'
        )

    return next(iter(matches.values()))



def _monthly_pinned_individual_approver(db, plan):
    """Resolve the saved approver for an individual monthly plan.

    Modern plans are pinned to an employee ID at submission.
    Historical plans without a pin must be reviewed through their
    legacy workflow until safely migrated.
    """
    employee_id = str(plan.get('employee_id') or '')
    approver_id = str(plan.get('approver_employee_id') or '')

    if not approver_id:
        return None

    if not employee_id or approver_id == employee_id:
        raise PlanningError('A monthly plan cannot be self-approved')

    approver = db.employees.find_one({
        '_id': _oid(approver_id),
        'tenant_id': _tenant(),
        'is_deleted': {'$ne': True},
    })

    if approver is None:
        raise PlanningError(
            'Assigned monthly approver is no longer an active employee'
        )

    return approver


def _monthly_can_review_pinned(db, plan):
    """Allow only the pinned, distinct, same-tenant employee to review."""
    assigned = _monthly_pinned_individual_approver(db, plan)
    if assigned is None:
        return False

    reviewer = _employee(db)
    if reviewer is None:
        return False

    return (
        str(reviewer['_id']) == str(assigned['_id'])
        and str(reviewer['_id']) != str(plan.get('employee_id'))
    )


def _monthly_next_individual_approver(db, employee, is_team_leader=False):
    """Resolve next individual-plan reviewer, never the submitter.

    Employees use their assigned TL first, falling back to their RO
    when no TL is assigned. TLs and ROs use their next-level RO.

    The authenticated route must determine is_team_leader from the
    server-side employee/user role, never from a client payload.
    """
    employee_id = str(employee['_id'])

    if is_team_leader:
        selected = _monthly_assigned_ro(db, employee)
    else:
        selected = _monthly_assigned_tl(db, employee)
        if selected is None:
            selected = _monthly_assigned_ro(db, employee)

    if selected is None:
        raise PlanningError(
            'No authorised monthly plan approver is assigned. '
            'Ask HR to configure the reporting relationship.'
        )

    if str(selected['_id']) == employee_id:
        # A person cannot review their own work. If the TL reference
        # points back to the employee, try their distinct RO instead.
        if not is_team_leader:
            selected = _monthly_assigned_ro(db, employee)

        if selected is None or str(selected['_id']) == employee_id:
            raise PlanningError(
                'Monthly plan cannot be self-approved. '
                'Assign a distinct higher-level Reporting Officer.'
            )

    return selected


def _monthly_assigned_ro(db, employee):
    """Resolve one distinct, active, same-tenant reporting officer.

    Standard HRMS reporting ID fields may reference employee or linked
    user identifiers. Ambiguous references fail closed.
    """
    fields = (
        'reporting_officer_id',
        'reporting_officer_user_id',
        'reporting_officer_employee_id',
    )
    refs = {
        str(employee.get(field)).strip().lower()
        for field in fields if employee.get(field)
    }

    if not refs:
        return None

    candidates = list(db.employees.find({
        'tenant_id': _tenant(),
        'is_deleted': {'$ne': True},
    }))

    matches = [
        candidate for candidate in candidates
        if refs.intersection(_monthly_identity_aliases(candidate))
    ]

    # Ignore duplicate aliases referring to the same employee record.
    unique = {str(item['_id']): item for item in matches}

    if len(unique) > 1:
        raise PlanningError(
            'Ambiguous Reporting Officer assignment. '
            'Ask HR to correct the reporting relationship.'
        )

    if not unique:
        raise PlanningError(
            'Assigned Reporting Officer cannot be resolved '
            'to an active employee.'
        )

    return next(iter(unique.values()))


def _monthly_next_compilation_approver(db, leader):
    """Follow the explicit reporting chain, never approve own work."""
    leader_id = str(leader['_id'])
    visited = {leader_id}
    current = leader

    for _ in range(12):
        next_employee = _monthly_assigned_ro(db, current)
        if next_employee is None:
            raise PlanningError(
                'No distinct Reporting Officer is configured for '
                'the Team Leader.'
            )

        next_id = str(next_employee['_id'])

        if next_id == leader_id:
            # A combined TL/RO may point to themselves; this is not
            # sufficient to identify a higher-level approver.
            raise PlanningError(
                'Team Leader and Reporting Officer resolve to the '
                'same employee. Configure a distinct higher-level '
                'Reporting Officer before submitting a team plan.'
            )

        if next_id in visited:
            raise PlanningError(
                'Circular Reporting Officer assignment detected.'
            )

        return next_employee

    raise PlanningError('Reporting hierarchy is too deep')


def _compilation_access(db, doc):
    owner = _employee(db)
    owner_id = str(owner['_id']) if owner else ''
    is_owner = owner_id == str(doc.get('team_leader_employee_id'))
    assigned_id = str(doc.get('approver_employee_id') or '')
    if assigned_id:
        is_ro = bool(
            owner and owner_id == assigned_id
            and owner_id != str(doc.get('team_leader_employee_id'))
        )
    else:
        # Legacy compilations created before explicit approver routing.
        is_ro = _manager_for(
            db, doc.get('team_leader_employee_id'), 'ro'
        )
    return is_owner, is_ro


def _compilation_view(db, doc):
    result = dict(doc)
    is_owner, is_ro = _compilation_access(db, doc)
    result['can_submit'] = is_owner and doc.get('status') in ('draft', 'rejected')
    result['can_review'] = is_ro and doc.get('status') == 'pending_approval'
    result['can_create_revision'] = (
        is_owner and doc.get('status') == 'approved'
    )
    return clean_doc(result)



def _monthly_compilation_coverage(db, leader, month, selected=None):
    from copy import deepcopy
    """Build a full team snapshot; never treat unapproved work as approved."""
    from app.services.monthly_team_coverage import (
        build_team_coverage, CoverageError
    )

    if not _monthly_plan_required(leader):
        raise PlanningError(
            'Organisation administrators are exempt from mandatory '
            'monthly team planning'
        )

    leader_id = str(leader['_id'])
    members = [leader] + _monthly_team_members(db, leader_id)
    member_ids = [str(member['_id']) for member in members]

    plans = list(db.sprint_monthly_plans.find({
        'tenant_id': _tenant(),
        'employee_id': {'$in': member_ids},
        'month': month,
        'is_deleted': {'$ne': True},
    }))

    try:
        coverage = build_team_coverage(members, plans, selected)
    except CoverageError as exc:
        raise PlanningError(str(exc))

    by_id = {str(plan['employee_id']): plan for plan in plans}
    snapshots = []

    for item in coverage['members']:
        if item['submission_status'] != 'approved':
            continue

        source = by_id[item['employee_id']]
        snapshots.append({
            'employee_id': item['employee_id'],
            'employee_name': item['employee_name'][:200],
            'monthly_plan_id': str(source['_id']),
            'title': str(source.get('title') or ''),
            'goals': item['goals'],
            # STEP 44B.53D.5 - TEMPLATE SNAPSHOT PRESERVATION
            # Keep legacy compiled rows unchanged. For templated plans,
            # use the approved source rows, including validated custom values.
            'sheet_rows': (
                deepcopy(source.get('sheet_rows') or item['sheet_rows'])
                if source.get('sprint_template_snapshot')
                else item['sheet_rows']
            ),
            **(
                {
                    'sprint_template_snapshot':
                        deepcopy(source['sprint_template_snapshot'])
                }
                if source.get('sprint_template_snapshot')
                else {}
            ),
            'source_status': 'approved',
        })

    return coverage, snapshots


def _monthly_compilation_fields(coverage, snapshots):
    """Stored coverage includes ALL members; activity snapshots only approved."""
    return {
        'team_size': coverage['total_members'],
        'source_plans': snapshots,
        'coverage_members': coverage['members'],
        'missing_employee_ids': coverage['missing_employee_ids'],
        'approved_count': coverage['approved_count'],
        'pending_count': coverage['pending_count'],
        'rejected_count': coverage['rejected_count'],
        'not_submitted_count': coverage['not_submitted_count'],
        'activity_count': sum(
            len(p['sheet_rows']) if p['sheet_rows'] else len(p['goals'])
            for p in snapshots
        ),
    }


@sprint_planning_bp.route(
    '/api/v1/sprint-planning/monthly/team-compilations/coverage',
    methods=['GET']
)
@current_user_required
def monthly_team_compilation_coverage():
    """Preview current team submissions without creating a compilation."""
    def action():
        db = get_db()
        leader = _employee(db)
        if leader is None:
            return _error('Employee profile required', 403)

        leader_id = str(leader['_id'])
        if _monthly_approval_kind(db, leader_id) != 'ro':
            return _error('Only a Team Leader may view team coverage', 403)

        month = str(request.args.get('month') or '').strip()
        from datetime import date
        try:
            if date.fromisoformat(month + '-01').strftime('%Y-%m') != month:
                raise ValueError()
        except ValueError:
            return _error('month must be YYYY-MM', 400)

        coverage, _ = _monthly_compilation_coverage(
            db, leader, month, []
        )
        return _serialize(coverage)

    return _safe_call(action)


@sprint_planning_bp.route('/api/v1/sprint-planning/monthly/team-compilations', methods=['GET', 'POST'])
@current_user_required
def monthly_team_compilations():
    def action():
        db = get_db()
        employee = _employee(db)
        if employee is None:
            return _error('Employee profile is required', 403)
        own_id = str(employee['_id'])

        if request.method == 'GET':
            month = str(request.args.get('month') or '').strip()
            query = {
                'tenant_id': _tenant(),
                'is_deleted': {'$ne': True},
            }
            if month:
                from datetime import date
                try:
                    if date.fromisoformat(month + '-01').strftime('%Y-%m') != month:
                        raise ValueError()
                except ValueError:
                    return _error('month must be YYYY-MM', 400)
                query['month'] = month

            found = db.sprint_monthly_team_compilations.find(query).sort('created_at', -1).limit(200)
            visible = []
            for doc in found:
                is_owner, is_ro = _compilation_access(db, doc)
                if is_owner or is_ro:
                    visible.append(_compilation_view(db, doc))

            try:
                can_compile = (
                    _monthly_plan_required(employee)
                    and _monthly_approval_kind(db, own_id) == 'ro'
                )
            except PlanningError:
                can_compile = False

            return _serialize({
                'items': visible,
                'can_compile': can_compile,
            })

        body = _payload()
        month = str(body.get('month') or '').strip()
        from datetime import date
        try:
            if date.fromisoformat(month + '-01').strftime('%Y-%m') != month:
                raise ValueError()
        except ValueError:
            return _error('month must be YYYY-MM', 400)

        if not _monthly_plan_required(employee):
            return _error(
                'Organisation administrators are exempt from mandatory '
                'monthly team planning',
                403,
            )

        if _monthly_approval_kind(db, own_id) != 'ro':
            return _error('Only a Team Leader may compile a team monthly plan', 403)

        try:
            assigned_ro = _monthly_next_compilation_approver(
                db, employee
            )
        except PlanningError as exc:
            return _error(str(exc), 409)

        assigned_ro_id = str(assigned_ro['_id'])

        existing = db.sprint_monthly_team_compilations.find_one({
            'tenant_id': _tenant(),
            'team_leader_employee_id': own_id,
            'month': month,
            'is_deleted': {'$ne': True},
        })
        if existing:
            return _error('A compiled team plan already exists for this month', 409)

        selected = body.get('missing_employee_ids', [])
        if not isinstance(selected, list):
            return _error('missing_employee_ids must be a list', 400)

        try:
            coverage, snapshots = _monthly_compilation_coverage(
                db, employee, month, selected
            )
        except PlanningError as exc:
            return _error(str(exc), 409)

        if not coverage['ready_to_submit']:
            return _error(
                'Confirm the employees who have not submitted: '
                + ', '.join(coverage['unconfirmed_missing_ids'][:20]),
                409,
            )

        now = utc_now()
        document = {
            'tenant_id': _tenant(),
            'team_leader_employee_id': own_id,
            'approver_employee_id': assigned_ro_id,
            'month': month,
            'title': f'Team Monthly Sprint Plan - {month}',
            **_monthly_compilation_fields(coverage, snapshots),
            'status': 'draft',
            'approval_history': [],
            'created_by': _actor(),
            'created_at': now,
            'updated_at': now,
            'is_deleted': False,
        }

        result = db.sprint_monthly_team_compilations.insert_one(document)
        audit('create', 'sprint_monthly_team_compilation', str(result.inserted_id))
        stored = db.sprint_monthly_team_compilations.find_one({
            '_id': result.inserted_id
        })
        return _compilation_view(db, stored), 201

    return _safe_call(action)




@sprint_planning_bp.route(
    '/api/v1/sprint-planning/monthly/team-compilations/'
    '<compilation_id>/new-revision',
    methods=['POST'],
)
@current_user_required
def create_approved_monthly_team_revision(compilation_id):
    """Create a distinct draft; never change an approved parent."""
    def action():
        db = get_db()
        collection = db.sprint_monthly_team_compilations
        original_doc = _document(
            db, 'sprint_monthly_team_compilations', compilation_id
        )

        if original_doc is None:
            return _error('Approved team compilation not found', 404)

        is_owner, _ = _compilation_access(db, original_doc)
        if not is_owner:
            return _error(
                'Only the compiling Team Leader may create a revision',
                403,
            )

        if original_doc.get('status') != 'approved':
            return _error(
                'A new version can only be created from an approved compilation',
                409,
            )

        leader = _employee(db)
        leader_id = str(original_doc['team_leader_employee_id'])
        if leader is None or str(leader['_id']) != leader_id:
            return _error('Team Leader profile mismatch', 403)

        try:
            if _monthly_approval_kind(db, leader_id) != 'ro':
                return _error(
                    'Team Leader compilation permission required', 403
                )
            approver = _monthly_next_compilation_approver(db, leader)
        except PlanningError as exc:
            return _error(str(exc), 409)

        parent_id = str(original_doc['_id'])
        root_id = str(
            original_doc.get('root_compilation_id') or parent_id
        )

        # Do not let the same approved version spawn multiple children.
        # This also prevents bypassing an existing rejected or pending
        # draft by repeatedly creating new revisions.
        existing_child = collection.find_one({
            'tenant_id': _tenant(),
            'supersedes_compilation_id': parent_id,
            'is_deleted': {'$ne': True},
        })
        if existing_child:
            return _error(
                'A revision already exists for this approved version. '
                'Open that revision instead.',
                409,
            )

        body = _payload()
        selected = body.get(
            'missing_employee_ids',
            original_doc.get('missing_employee_ids') or [],
        )
        if not isinstance(selected, list):
            return _error('missing_employee_ids must be a list', 400)

        month = str(original_doc['month'])
        try:
            coverage, snapshots = _monthly_compilation_coverage(
                db, leader, month, selected
            )
        except PlanningError as exc:
            return _error(str(exc), 409)

        if not coverage['ready_to_submit']:
            return _error(
                'Confirm every currently missing employee before '
                'creating the revision',
                409,
            )

        try:
            version = int(original_doc.get('revision_number') or 1) + 1
        except (ValueError, TypeError):
            return _error('Invalid source revision number', 409)

        if version < 2 or version > 1000:
            return _error('Invalid revision number', 409)

        now = utc_now()
        document = {
            'tenant_id': _tenant(),
            'team_leader_employee_id': leader_id,
            'approver_employee_id': str(approver['_id']),
            'month': month,
            'title': str(original_doc.get('title') or
                         f'Team Monthly Sprint Plan - {month}'),
            'root_compilation_id': root_id,
            'supersedes_compilation_id': parent_id,
            'revision_number': version,
            **_monthly_compilation_fields(coverage, snapshots),
            'status': 'draft',
            'approval_history': [{
                'action': 'new_version_created',
                'actor_id': _actor(),
                'from_compilation_id': parent_id,
                'revision_number': version,
                'at': now,
            }],
            'created_by': _actor(),
            'created_at': now,
            'updated_at': now,
            'is_deleted': False,
        }

        # A new document is inserted. The approved parent receives
        # no update, unset, push, or status transition.
        from pymongo.errors import DuplicateKeyError

        try:
            result = collection.insert_one(document)
        except DuplicateKeyError:
            return _error(
                'A revision already exists for this approved version. '
                'Refresh and open the existing revision.',
                409,
            )

        audit(
            'create_revision',
            'sprint_monthly_team_compilation',
            str(result.inserted_id),
            {
                'source_compilation_id': parent_id,
                'revision_number': version,
            },
        )

        stored = collection.find_one({
            '_id': result.inserted_id,
            'tenant_id': _tenant(),
            'is_deleted': {'$ne': True},
        })
        if stored is None:
            return _error('Revision could not be retrieved', 500)

        return _compilation_view(db, stored), 201

    return _safe_call(action)


@sprint_planning_bp.route(
    '/api/v1/sprint-planning/monthly/team-compilations/<compilation_id>/revise',
    methods=['POST']
)
@current_user_required
def revise_monthly_team_compilation(compilation_id):
    def action():
        db = get_db()
        collection = db.sprint_monthly_team_compilations
        doc = _document(db, 'sprint_monthly_team_compilations', compilation_id)

        if doc is None:
            return _error('Compiled team plan not found', 404)

        owner, _ = _compilation_access(db, doc)
        if not owner:
            return _error('Only the assigned Team Leader may revise', 403)

        original_status = doc.get('status')
        if original_status not in ('draft', 'rejected'):
            return _error(
                'Only draft or rejected compilations may be refreshed',
                409
            )

        leader_id = str(doc['team_leader_employee_id'])
        month = doc['month']

        leader = _employee(db)
        if not leader or str(leader['_id']) != leader_id:
            return _error('Team Leader profile mismatch', 403)

        try:
            revised_approver = _monthly_next_compilation_approver(
                db, leader
            )
        except PlanningError as exc:
            return _error(str(exc), 409)

        body = _payload()
        selected = body.get(
            'missing_employee_ids',
            doc.get('missing_employee_ids') or [],
        )
        if not isinstance(selected, list):
            return _error('missing_employee_ids must be a list', 400)

        try:
            coverage, snapshots = _monthly_compilation_coverage(
                db, leader, month, selected
            )
        except PlanningError as exc:
            return _error(str(exc), 409)

        if not coverage['ready_to_submit']:
            return _error(
                'Confirm all currently missing teammates before refreshing',
                409,
            )

        from pymongo import ReturnDocument

        now = utc_now()
        revision_number = int(doc.get('revision_number') or 1) + 1

        # Preserve previous submission as an immutable history snapshot.
        prior = {
            'revision_number': int(doc.get('revision_number') or 1),
            'source_plans': doc.get('source_plans') or [],
            'coverage_members': doc.get('coverage_members') or [],
            'missing_employee_ids': doc.get('missing_employee_ids') or [],
            'approver_employee_id': doc.get('approver_employee_id'),
            'activity_count': doc.get('activity_count') or 0,
            'approval_history': doc.get('approval_history') or [],
            'recorded_at': now,
        }

        changed = collection.find_one_and_update(
            {
                '_id': doc['_id'],
                'tenant_id': _tenant(),
                'team_leader_employee_id': leader_id,
                'status': original_status,
                'is_deleted': {'$ne': True},
            },
            {
                '$set': {
                    **_monthly_compilation_fields(coverage, snapshots),
                    'approver_employee_id': str(revised_approver['_id']),
                    'revision_number': revision_number,
                    'status': 'draft',
                    'updated_at': now,
                },
                '$push': {
                    'previous_revisions': prior,
                    'approval_history': {
                        'action': (
                            'revision_created'
                            if original_status == 'rejected'
                            else 'draft_sources_refreshed'
                        ),
                        'actor_id': _actor(),
                        'revision_number': revision_number,
                        'at': now,
                    },
                },
            },
            return_document=ReturnDocument.AFTER,
        )

        if changed is None:
            return _error('Compilation was changed by another request', 409)

        audit('revise', 'sprint_monthly_team_compilation', compilation_id)
        return _compilation_view(db, changed)

    return _safe_call(action)


@sprint_planning_bp.route(
    '/api/v1/sprint-planning/monthly/team-compilations/<compilation_id>/submit',
    methods=['POST']
)
@current_user_required
def submit_monthly_team_compilation(compilation_id):
    def action():
        db = get_db()
        doc = _document(db, 'sprint_monthly_team_compilations', compilation_id)
        if not doc:
            return _error('Compiled team plan not found', 404)

        is_owner, _ = _compilation_access(db, doc)
        if not is_owner:
            return _error('Only the compiling Team Leader may submit', 403)
        if doc.get('status') not in ('draft', 'rejected'):
            return _error('Only draft or rejected compilations may be submitted', 409)

        # Rejected compilations must be revised before resubmission.
        if doc.get('status') == 'rejected':
            return _error('Revise the rejected team compilation before submitting', 409)

        leader_id = str(doc['team_leader_employee_id'])
        month = str(doc['month'])

        leader = _employee(db)
        if leader is None or str(leader['_id']) != leader_id:
            return _error('Team Leader profile mismatch', 403)

        selected = doc.get('missing_employee_ids') or []
        try:
            coverage, snapshots = _monthly_compilation_coverage(
                db, leader, month, selected
            )
        except PlanningError as exc:
            return _error(str(exc), 409)

        if not coverage['ready_to_submit']:
            return _error(
                'Team submission status changed; refresh and confirm missing employees',
                409,
            )

        if not doc.get('coverage_members'):
            return _error(
                'Legacy team compilation must be refreshed before submission',
                409,
            )

        previous = {
            str(item.get('employee_id')): item
            for item in doc['coverage_members']
        }
        current = {
            str(item['employee_id']): item
            for item in coverage['members']
        }

        if set(previous) != set(current):
            return _error(
                'Team membership changed; refresh the compilation',
                409,
            )

        for employee_id, item in current.items():
            before = previous[employee_id]
            if (
                item['submission_status'] != before.get('submission_status')
                or item['monthly_plan_id'] != before.get('monthly_plan_id')
                or item['missing_confirmed'] != before.get('missing_confirmed')
            ):
                return _error(
                    'Individual plan status changed; refresh the compilation',
                    409,
                )

        if snapshots != (doc.get('source_plans') or []):
            return _error(
                'Approved activity sources changed; refresh the compilation',
                409,
            )

        from app.services.monthly_team_coverage import (
            validate_compilation_submission, CoverageError
        )

        try:
            current_ro = _monthly_next_compilation_approver(
                db, leader
            )
            current_ro_id = str(current_ro['_id'])
            if doc.get('approver_employee_id') and (
                str(doc['approver_employee_id']) != current_ro_id
            ):
                return _error(
                    'Reporting Officer assignment changed. '
                    'Refresh the compilation before submission.',
                    409
                )

            validate_compilation_submission(
                coverage, current_ro_id, leader_id
            )
        except (PlanningError, CoverageError) as exc:
            return _error(str(exc), 409)

        result = db.sprint_monthly_team_compilations.find_one_and_update(
            {
                '_id': doc['_id'],
                'tenant_id': _tenant(),
                'status': 'draft',
                'is_deleted': {'$ne': True},
            },
            {
                '$set': {
                    'status': 'pending_approval',
                    'approver_employee_id': current_ro_id,
                    'updated_at': utc_now(),
                },
                '$push': {
                    'approval_history': {
                        'action': 'submitted',
                        'actor_id': _actor(),
                        'at': utc_now(),
                    }
                },
            },
        )
        if result is None:
            return _error('Compilation changed; refresh and retry', 409)

        audit('submit', 'sprint_monthly_team_compilation', compilation_id)
        return _compilation_view(
            db,
            _document(db, 'sprint_monthly_team_compilations', compilation_id)
        )

    return _safe_call(action)


@sprint_planning_bp.route(
    '/api/v1/sprint-planning/monthly/team-compilations/<compilation_id>/review',
    methods=['POST']
)
@current_user_required
def review_monthly_team_compilation(compilation_id):
    def action():
        db = get_db()
        doc = _document(db, 'sprint_monthly_team_compilations', compilation_id)
        if not doc:
            return _error('Compiled team plan not found', 404)

        _, is_ro = _compilation_access(db, doc)
        if not is_ro:
            return _error('Only the assigned Reporting Officer may review', 403)
        if doc.get('status') != 'pending_approval':
            return _error('Compilation is not awaiting approval', 409)

        body = _payload()
        decision = str(body.get('decision') or '')
        remarks = str(body.get('remarks') or '').strip()

        if decision not in ('approved', 'rejected'):
            return _error('Invalid review decision', 400)
        if decision == 'rejected' and len(remarks) < 5:
            return _error('Rejection requires remarks of at least five characters', 400)

        result = db.sprint_monthly_team_compilations.find_one_and_update(
            {
                '_id': doc['_id'],
                'tenant_id': _tenant(),
                'status': 'pending_approval',
                'is_deleted': {'$ne': True},
            },
            {
                '$set': {
                    'status': decision,
                    'updated_at': utc_now(),
                },
                '$push': {
                    'approval_history': {
                        'action': decision,
                        'actor_id': _actor(),
                        'role': 'reporting_officer',
                        'remarks': remarks[:1000],
                        'at': utc_now(),
                    }
                },
            },
        )
        if result is None:
            return _error('Compilation already reviewed', 409)

        audit('review', 'sprint_monthly_team_compilation', compilation_id, {
            'decision': decision
        })
        return _compilation_view(
            db,
            _document(db, 'sprint_monthly_team_compilations', compilation_id)
        )

    return _safe_call(action)



@sprint_planning_bp.route(
    '/api/v1/sprint-planning/monthly/review-inbox',
    methods=['GET']
)
@current_user_required
def monthly_review_inbox():
    def action():
        db = get_db()
        actor_employee = _employee(db)
        if actor_employee is None:
            return _error('Employee profile required', 403)

        month = str(request.args.get('month') or '').strip()
        if month:
            from datetime import date
            try:
                if date.fromisoformat(month + '-01').strftime('%Y-%m') != month:
                    raise ValueError()
            except ValueError:
                return _error('Invalid planning month', 400)

        query = {
            'tenant_id': _tenant(),
            'status': 'pending_approval',
            'is_deleted': {'$ne': True},
        }
        if month:
            query['month'] = month

        results = []
        # Explicitly bound the queue; never silently imply that it
        # represents all plans when the tenant exceeds this limit.
        limit = 5000
        count = 0

        for plan in db.sprint_monthly_plans.find(query).sort(
            'created_at', -1
        ).limit(limit + 1):
            count += 1
            if count > limit:
                break

            owner_id = str(plan.get('employee_id') or '')
            if not owner_id:
                continue

            try:
                reviewer_kind = _monthly_plan_reviewer_kind(db, plan)
            except (PlanningError, ValueError, TypeError):
                continue

            if plan.get('approver_employee_id'):
                try:
                    authorised = _monthly_can_review_pinned(db, plan)
                except (PlanningError, ValueError, TypeError):
                    authorised = False
            else:
                authorised = _manager_for(
                    db, owner_id, reviewer_kind
                )
            if not authorised:
                continue

            results.append({
                **plan,
                'reviewer_kind': reviewer_kind,
                'reviewer_label': (
                    'Reporting Officer'
                    if reviewer_kind == 'ro'
                    else 'Team Leader'
                ),
            })

        return _serialize({
            'items': results,
            'count': len(results),
            'truncated': count > limit,
        })

    return _safe_call(action)



def _monthly_plan_reviewer_kind(db, plan):
    saved_kind = str(plan.get('approval_kind') or '').strip().lower()
    if saved_kind in ('tl', 'ro'):
        return saved_kind
    return _monthly_approval_kind(db, plan['employee_id'])


def _weekly_plan_reviewer_kind(db, plan):
    """Determine the approver for new and legacy weekly plans.

    New submissions pin approval_kind and approver_employee_id. Older
    pending weekly records did not save either field. Their linked,
    previously approved monthly plan supplies the historical reviewer
    kind where available; otherwise resolve the server-side owner roles.
    Never trust a role or reviewer supplied by the request client.
    """
    saved_kind = str(plan.get('approval_kind') or '').strip().lower()
    if saved_kind in ('tl', 'ro'):
        return saved_kind

    owner_id = str(plan.get('employee_id') or '')
    linked_monthly_id = _oid(plan.get('monthly_plan_id'))
    if linked_monthly_id is not None and owner_id:
        monthly_plan = db.sprint_monthly_plans.find_one({
            '_id': linked_monthly_id,
            'tenant_id': _tenant(),
            'employee_id': owner_id,
            'status': 'approved',
            'is_deleted': {'$ne': True},
        })
        if monthly_plan:
            monthly_kind = str(
                monthly_plan.get('approval_kind') or ''
            ).strip().lower()
            if monthly_kind in ('tl', 'ro'):
                return monthly_kind

    return _monthly_approval_kind(db, owner_id)


@sprint_planning_bp.route('/api/v1/sprint-planning/monthly', methods=['POST'])
@current_user_required
def create_monthly_plan():
    def action():
        db = get_db(); body = _payload(); employee_id = _own_id(db)
        document = new_monthly_plan(tenant_id=_tenant(), employee_id=employee_id,
            month=body.get('month'), title=body.get('title'), goals=body.get('goals'), actor_id=_actor(),
            sheet_rows=body.get('sheet_rows'))
        _sprint_apply_monthly_template(
            db, body, document, employee=_employee(db)
        )
        # STEP 44B.53G.8C.2
        from app.services.sprint_monthly_row_identity import (
            assign_monthly_row_ids,
        )
        assign_monthly_row_ids(document)

        if db.sprint_monthly_plans.find_one({'tenant_id': _tenant(), 'employee_id': employee_id,
                                            'month': document['month'], 'is_deleted': {'$ne': True}}):
            return _error('Monthly plan already exists', 409)
        result = db.sprint_monthly_plans.insert_one(document)
        audit('create', 'sprint_monthly_plan', str(result.inserted_id))
        return _serialize(db.sprint_monthly_plans.find_one({'_id': result.inserted_id})), 201
    return _safe_call(action)



@sprint_planning_bp.route('/api/v1/sprint-planning/monthly/<plan_id>', methods=['PUT'])
@current_user_required
def update_monthly_plan(plan_id):
    def action():
        db = get_db()
        existing = _document(db, 'sprint_monthly_plans', plan_id)
        if not existing:
            return _error('Monthly plan not found', 404)

        employee_id = _own_id(db)
        if str(existing.get('employee_id')) != employee_id:
            return _error('Only the plan owner may edit this sheet', 403)

        if existing.get('status') not in ('draft', 'rejected'):
            return _error('Only draft or rejected monthly plans may be edited', 409)

        body = _payload()
        if body.get('month') != existing.get('month'):
            return _error('The planning month cannot be changed', 409)

        replacement = new_monthly_plan(
            tenant_id=_tenant(),
            employee_id=employee_id,
            month=body.get('month'),
            title=body.get('title'),
            goals=body.get('goals'),
            actor_id=_actor(),
            sheet_rows=body.get('sheet_rows'),
        )
        _sprint_apply_monthly_template(
            db, body, replacement, employee=_employee(db),
            existing=existing,
        )

        # STEP 44B.53G.8C.2
        from app.services.sprint_monthly_row_identity import (
            assign_monthly_row_ids,
        )
        assign_monthly_row_ids(replacement, existing)

        # STEP 44B.53G.8D.2
        # Verify every nonempty monthly file reference before saving.
        from app.services.sprint_attachment_references import (
            validate_file_custom_values,
        )
        from app.services.sprint_attachment_binding import (
            SprintAttachmentBindingError,
        )

        candidate = {
            **replacement,
            '_id': existing['_id'],
        }

        try:
            for row in candidate.get('sheet_rows') or []:
                validate_file_custom_values(
                    attachments=db.sprint_attachments,
                    plan=candidate,
                    tenant_id=_tenant(),
                    employee_id=employee_id,
                    plan_type='monthly',
                    row_id=row.get('row_id'),
                    values=row.get('custom_values') or {},
                )
        except SprintAttachmentBindingError as error:
            return _error(str(error), 400)

        from pymongo import ReturnDocument

        allowed_fields = (
            'title', 'goals', 'sheet_rows',
            'sheet_version', 'updated_at',
            'sprint_template_snapshot',
        )

        values = {
            key: replacement[key]
            for key in allowed_fields
        }

        values['updated_at'] = utc_now()

        result = db.sprint_monthly_plans.find_one_and_update(
            {
                '_id': existing['_id'],
                'tenant_id': _tenant(),
                'employee_id': employee_id,
                'status': existing['status'],
                'is_deleted': {'$ne': True},
            },
            {
                '$set': values,
                '$push': {
                    'approval_history': {
                        'action': 'draft_updated',
                        'actor_id': _actor(),
                        'at': utc_now(),
                    }
                },
            },
            return_document=ReturnDocument.AFTER,
        )

        if result is None:
            return _error('Plan was changed by another request. Refresh and retry.', 409)

        audit('update', 'sprint_monthly_plan', plan_id)
        return _serialize(result)

    return _safe_call(action)


@sprint_planning_bp.route('/api/v1/sprint-planning/weekly', methods=['POST'])
@current_user_required
def create_weekly_plan():
    def action():
        db = get_db(); body = _payload(); employee_id = _own_id(db)
        month_plan = _document(db, 'sprint_monthly_plans', body.get('monthly_plan_id'))
        if not month_plan or month_plan['employee_id'] != employee_id or month_plan['status'] != 'approved':
            return _error('An approved monthly plan owned by you is required', 409)
        document = new_weekly_plan(tenant_id=_tenant(), employee_id=employee_id,
            monthly_plan_id=str(month_plan['_id']), week_start=body.get('week_start'),
            week_end=body.get('week_end'), activities=body.get('activities'), actor_id=_actor())
        _sprint_apply_weekly_template(
            db, body, document, employee=_employee(db)
        )
        if not document['week_start'].startswith(month_plan['month']) and not document['week_end'].startswith(month_plan['month']):
            return _error('Week must overlap the approved monthly plan', 400)
        if db.sprint_weekly_plans.find_one({'tenant_id': _tenant(), 'employee_id': employee_id,
            'week_start': document['week_start'], 'is_deleted': {'$ne': True}}):
            return _error('Weekly plan already exists for this start date', 409)
        result = db.sprint_weekly_plans.insert_one(document)
        audit('create', 'sprint_weekly_plan', str(result.inserted_id))
        return _serialize(db.sprint_weekly_plans.find_one({'_id': result.inserted_id})), 201
    return _safe_call(action)


# STEP 44B.53G.8E.2
@sprint_planning_bp.route(
    '/api/v1/sprint-planning/weekly/<plan_id>/activities/'
    '<activity_id>/custom-fields',
    methods=['PUT'],
)
@current_user_required
def update_weekly_activity_custom_fields(plan_id, activity_id):
    """Update only one saved weekly draft activity's custom values."""
    def action():
        from pymongo import ReturnDocument
        from app.services.sprint_feature_settings import (
            sprint_planning_enabled,
        )
        from app.services.sprint_template_values import (
            validate_template_values,
        )
        from app.services.sprint_template_service import (
            SprintTemplateError,
        )
        from app.services.sprint_attachment_references import (
            validate_file_custom_values,
        )
        from app.services.sprint_attachment_binding import (
            SprintAttachmentBindingError,
        )

        db = get_db()
        tenant = _tenant()
        employee_id = _own_id(db)

        if not sprint_planning_enabled(db, tenant):
            return _error('Sprint Planning is disabled', 403)

        plan = _document(db, 'sprint_weekly_plans', plan_id)
        if not plan:
            return _error('Weekly plan not found', 404)

        if str(plan.get('employee_id')) != employee_id:
            return _error('Only the plan owner may edit fields', 403)

        if plan.get('status') not in ('draft', 'rejected'):
            return _error('Only draft or rejected plans may be edited', 409)

        template = plan.get('sprint_template_snapshot') or {}
        columns = template.get('columns')
        if not isinstance(columns, list) or not columns:
            return _error('Saved weekly template is required', 409)

        activity = next(
            (
                item for item in plan.get('activities', [])
                if isinstance(item, dict)
                and str(item.get('activity_id')) == activity_id
            ),
            None,
        )
        if activity is None:
            return _error('Weekly activity not found', 404)

        body = _payload()
        if not isinstance(body, dict):
            return _error('JSON object required', 400)

        if set(body) != {'custom_values'}:
            return _error('Only custom_values may be changed', 400)

        try:
            validated = validate_template_values(
                columns, body['custom_values'],
                allow_missing_required_files=True,
            )
            validated = validate_file_custom_values(
                attachments=db.sprint_attachments,
                plan=plan,
                tenant_id=tenant,
                employee_id=employee_id,
                plan_type='weekly',
                activity_id=activity_id,
                values=validated,
            )
        except (
            SprintTemplateError,
            SprintAttachmentBindingError,
        ) as error:
            return _error(str(error), 400)

        # Atomic condition protects status and source version.
        # Update just the specified activity's custom values.
        updated = db.sprint_weekly_plans.find_one_and_update(
            {
                '_id': plan['_id'],
                'tenant_id': tenant,
                'employee_id': employee_id,
                'status': plan['status'],
                'is_deleted': {'$ne': True},
                'updated_at': plan['updated_at'],
                'activities.activity_id': activity_id,
            },
            {
                '$set': {
                    'activities.$.custom_values': validated,
                    'updated_at': utc_now(),
                },
                '$push': {
                    'approval_history': {
                        'action': 'draft_custom_fields_updated',
                        'actor_id': _actor(),
                        'activity_id': activity_id,
                        'at': utc_now(),
                    },
                },
            },
            return_document=ReturnDocument.AFTER,
        )

        if updated is None:
            return _error(
                'Plan changed; refresh and retry', 409,
            )

        audit(
            'update_custom_fields',
            'sprint_weekly_activity',
            activity_id,
            {'weekly_plan_id': plan_id},
        )
        return _serialize(updated)

    return _safe_call(action)



@sprint_planning_bp.route('/api/v1/sprint-planning/<kind>/<plan_id>/submit', methods=['POST'])
@current_user_required
def submit_plan(kind, plan_id):
    def action():
        if kind not in ('monthly', 'weekly'):
            return _error('Invalid plan type', 404)
        db = get_db(); collection = f'sprint_{kind}_plans'; doc = _document(db, collection, plan_id)
        if not doc:
            return _error('Plan not found', 404)
        if doc['employee_id'] != _own_id(db):
            return _error('Forbidden', 403)
        if doc['status'] not in ('draft', 'rejected'):
            return _error('Only draft or rejected plans may be submitted', 409)
        # STEP 44B.53G.8F.24
        # Drafts may omit required files, but submission may not.
        if kind == 'monthly':
            from app.services.sprint_template_values import (
                validate_template_values,
            )
            from app.services.sprint_template_service import (
                SprintTemplateError,
            )

            snapshot = doc.get('sprint_template_snapshot')
            if snapshot:
                columns = snapshot.get('columns') or []

                for index, row in enumerate(
                    doc.get('sheet_rows') or [], start=1
                ):
                    try:
                        validate_template_values(
                            columns,
                            row.get('custom_values') or {},
                        )
                    except SprintTemplateError as error:
                        return _error(
                            f'Monthly row {index}: {error}', 409
                        )

        # Reject incomplete weekly file fields before requesting approval.
        # Saved drafts may omit them until the employee uploads each file.
        if kind == 'weekly':
            from app.services.sprint_template_values import validate_template_values
            from app.services.sprint_template_service import SprintTemplateError

            snapshot = doc.get('sprint_template_snapshot')
            if snapshot:
                for index, activity in enumerate(doc.get('activities') or [], start=1):
                    try:
                        validate_template_values(
                            snapshot.get('columns') or [],
                            activity.get('custom_values') or {},
                        )
                    except SprintTemplateError as error:
                        return _error(f'Weekly activity {index}: {error}', 409)

        fields = {'status': 'pending_approval', 'updated_at': utc_now()}
        # Both individual plan types require a distinct, server-resolved
        # reviewer. Previous weekly submissions did not pin an approver,
        # causing Team Leaders' weekly plans to route back to a TL.
        if kind in ('monthly', 'weekly'):
            owner = _employee(db)
            if owner is None or str(owner['_id']) != str(doc['employee_id']):
                return _error(f'{kind.capitalize()} plan owner mismatch', 403)

            roles = {
                str(role).strip().lower().replace('-', '_').replace(' ', '_')
                for role in _roles()
            }
            upward = bool(roles.intersection({
                'team_leader', 'tl', 'reporting_officer', 'ro',
            })) or owner.get('is_reporting_officer') is True

            try:
                approver = _monthly_next_individual_approver(
                    db, owner, is_team_leader=upward
                )
            except PlanningError as exc:
                return _error(str(exc), 409)

            approver_id = str(approver['_id'])
            if approver_id == str(owner['_id']):
                return _error('Self approval is forbidden', 403)

            # Store the actual resolved employee identity, not
            # a client-provided ID or display-name relationship.
            tl_fields = (
                'team_leader_id',
                'team_leader_user_id',
                'team_leader_employee_id',
            )
            fields['approver_employee_id'] = approver_id
            fields['approval_kind'] = (
                'ro' if upward
                or not any(owner.get(f) for f in tl_fields)
                else 'tl'
            )


        update = {
            '$set': fields,
            '$push': {'approval_history': {
                'action': 'submitted',
                'actor_id': _actor(),
                'at': utc_now(),
            }}
        }
        result = db[collection].update_one({
            '_id': doc['_id'],
            'tenant_id': _tenant(),
            'employee_id': doc['employee_id'],
            'status': doc['status'],
            'is_deleted': {'$ne': True},
        }, update)
        if not result.modified_count:
            return _error('Plan changed; refresh and retry', 409)
        audit('submit', f'sprint_{kind}_plan', plan_id)
        return _serialize(_document(db, collection, plan_id))
    return _safe_call(action)


@sprint_planning_bp.route('/api/v1/sprint-planning/<kind>/<plan_id>/review', methods=['POST'])
@current_user_required
def review_plan(kind, plan_id):
    def action():
        if kind not in ('monthly', 'weekly'):
            return _error('Invalid plan type', 404)
        db = get_db(); body = _payload(); collection = f'sprint_{kind}_plans'
        doc = _document(db, collection, plan_id)
        if not doc:
            return _error('Plan not found', 404)
        approval_kind = (
            _monthly_plan_reviewer_kind(db, doc)
            if kind == 'monthly'
            else _weekly_plan_reviewer_kind(db, doc)
        )
        if doc.get('approver_employee_id'):
            # Pinned reviewers are checked against their authenticated,
            # same-tenant employee identity; never permit self-approval.
            try:
                authorised = _monthly_can_review_pinned(db, doc)
            except (PlanningError, ValueError, TypeError):
                authorised = False
        else:
            # Legacy pending weekly plans without a pinned reviewer:
            # resolve the reviewer kind from their approved monthly plan.
            authorised = _manager_for(
                db, doc['employee_id'], approval_kind
            )
        if not authorised:
            return _error('Only the assigned approver may review', 403)
        decision = body.get('decision')
        if decision not in ('approved', 'rejected'):
            return _error('decision must be approved or rejected')
        remarks = str(body.get('remarks') or '').strip()
        if decision == 'rejected' and len(remarks) < 5:
            return _error('Rejection requires remarks of at least five characters')
        result = db[collection].update_one({
            '_id': doc['_id'],
            'tenant_id': _tenant(),
            'employee_id': doc['employee_id'],
            'status': 'pending_approval',
            'is_deleted': {'$ne': True}
        }, {
            '$set': {'status': decision, 'updated_at': utc_now()},
            '$push': {'approval_history': {'action': decision, 'actor_id': _actor(),
                'role': 'reporting_officer' if approval_kind == 'ro' else 'team_leader',
                'remarks': remarks[:1000], 'at': utc_now()}}
        })
        if not result.modified_count:
            return _error('Plan is not awaiting approval', 409)
        audit('review', f'sprint_{kind}_plan', plan_id, {'decision': decision})
        return _serialize(_document(db, collection, plan_id))
    return _safe_call(action)


@sprint_planning_bp.route('/api/v1/sprint-planning/<kind>', methods=['GET'])
@current_user_required
def list_plans(kind):
    def action():
        if kind not in ('monthly', 'weekly'):
            return _error('Invalid plan type', 404)
        db = get_db(); employee_id = request.args.get('employee_id') or _own_id(db)
        if not _can_read(db, employee_id):
            return _error('Forbidden', 403)
        query = {'tenant_id': _tenant(), 'employee_id': employee_id, 'is_deleted': {'$ne': True}}
        documents = list(db[f'sprint_{kind}_plans'].find(query).sort('created_at', -1).limit(100))
        return _serialize({'items': documents, 'count': len(documents)})
    return _safe_call(action)


# STEP 44B.53G.8F.16-R1
# Prepare the immutable daily template before first work reporting.
@sprint_planning_bp.route(
    '/api/v1/sprint-planning/weekly/<plan_id>/activities/'
    '<activity_id>/prepare-daily-template',
    methods=['POST'],
)
@current_user_required
def prepare_daily_activity_template(plan_id, activity_id):
    def action():
        from app.services.sprint_feature_settings import (
            sprint_planning_enabled,
        )
        from app.services.sprint_template_service import (
            SprintTemplateError,
        )
        from app.services.sprint_template_values import (
            snapshot_template,
        )

        db = get_db()
        tenant = _tenant()

        if not sprint_planning_enabled(db, tenant):
            return _error('Sprint Planning is disabled', 403)

        employee = _employee(db)
        if employee is None:
            return _error('Employee profile required', 403)

        doc = _document(db, 'sprint_weekly_plans', plan_id)
        if doc is None:
            return _error('Weekly plan not found', 404)

        if str(doc.get('tenant_id')) != str(tenant):
            return _error('Forbidden', 403)

        if str(doc.get('employee_id')) != str(_own_id(db)):
            return _error('Forbidden', 403)

        if doc.get('status') != 'approved':
            return _error('Weekly plan must be approved', 409)

        activity = next(
            (
                item for item in (doc.get('activities') or [])
                if item.get('activity_id') == activity_id
            ),
            None,
        )
        if activity is None:
            return _error('Activity not found', 404)

        # An existing snapshot must never be overwritten.
        if activity.get('daily_template_snapshot'):
            return _serialize(doc)

        try:
            department = _sprint_employee_department(employee)
            latest = _sprint_latest_department_template(
                db, tenant, department, 'daily',
            )
            if latest is None:
                return _error(
                    'No daily reporting template is assigned', 409,
                )

            frozen = snapshot_template(latest)
            if frozen.get('plan_type') != 'daily':
                return _error('Daily template type mismatch', 409)

            if (
                str(frozen.get('department') or '').casefold()
                != department.casefold()
            ):
                return _error(
                    'Daily template does not match department', 409,
                )
        except SprintTemplateError as error:
            return _error(str(error), 400)

        result = db.sprint_weekly_plans.update_one(
            {
                '_id': doc['_id'],
                'tenant_id': tenant,
                'employee_id': _own_id(db),
                'status': 'approved',
                'is_deleted': {'$ne': True},
                'activities': {
                    '$elemMatch': {
                        'activity_id': activity_id,
                        'daily_template_snapshot': None,
                    },
                },
            },
            {
                '$set': {
                    'activities.$.daily_template_snapshot': frozen,
                    'updated_at': utc_now(),
                },
            },
        )

        updated = _document(
            db, 'sprint_weekly_plans', plan_id,
        )
        if updated is None:
            return _error('Weekly plan not found', 404)

        if not result.matched_count:
            current = next(
                (
                    item for item in (
                        updated.get('activities') or []
                    )
                    if item.get('activity_id') == activity_id
                ),
                None,
            )
            if not current or not current.get(
                'daily_template_snapshot'
            ):
                return _error(
                    'Activity changed; reload and try again', 409,
                )

        return _serialize(updated)

    return _safe_call(action)


@sprint_planning_bp.route('/api/v1/sprint-planning/weekly/<plan_id>/activities/<activity_id>/report', methods=['PATCH'])
@current_user_required
def report_activity(plan_id, activity_id):
    def action():
        db = get_db(); body = _payload(); doc = _document(db, 'sprint_weekly_plans', plan_id)
        if not doc:
            return _error('Weekly plan not found', 404)
        if doc['employee_id'] != _own_id(db):
            return _error('Forbidden', 403)
        if doc['status'] != 'approved':
            return _error('Weekly plan must be approved before work reporting', 409)
        activity = next((a for a in doc['activities'] if a['activity_id'] == activity_id), None)
        if not activity:
            return _error('Activity not found', 404)
        patch = validate_daily_update(status=body.get('status'), evidence=body.get('evidence'),
            incomplete_reason=body.get('incomplete_reason'), remarks=body.get('remarks', ''))
        # Service v1 clears the reason for in-progress work; preserve it here
        # because checkout validation requires an explanation for unfinished work.
        if patch['status'] == 'in_progress':
            patch['incomplete_reason'] = str(body.get('incomplete_reason') or '').strip()
        # Ensure only the selected activity is updated; the client cannot modify other tasks.
        daily_fields = _sprint_validate_daily_template(
            db, body, activity, employee=_employee(db)
        )
        # STEP 44B.53G.8D.4
        # Verify saved daily file references against the current
        # tenant, owner, plan, activity and configured file columns.
        from app.services.sprint_attachment_references import (
            validate_file_custom_values,
        )
        from app.services.sprint_attachment_binding import (
            SprintAttachmentBindingError,
        )

        if 'daily_custom_values' in daily_fields:
            # Daily templates may be frozen for the first time by
            # this report; validate against the resulting snapshot.
            candidate = dict(doc)
            candidate['activities'] = [
                {**item, **daily_fields}
                if item.get('activity_id') == activity_id
                else item
                for item in doc['activities']
            ]

            try:
                validate_file_custom_values(
                    attachments=db.sprint_attachments,
                    plan=candidate,
                    tenant_id=_tenant(),
                    employee_id=_own_id(db),
                    plan_type='daily',
                    activity_id=activity_id,
                    values=daily_fields['daily_custom_values'],
                )
            except SprintAttachmentBindingError as error:
                return _error(str(error), 400)

        changes = {f'activities.$.{key}': value for key, value in patch.items()}
        changes.update({
            f'activities.$.{key}': value
            for key, value in daily_fields.items()
        })
        changes['updated_at'] = utc_now()
        result = db.sprint_weekly_plans.update_one({
            '_id': doc['_id'],
            'tenant_id': _tenant(),
            'employee_id': _own_id(db),
            'status': 'approved',
            'is_deleted': {'$ne': True},
            'activities.activity_id': activity_id,
        }, {'$set': changes})
        if not result.matched_count:
            return _error('Activity was modified; reload and try again', 409)
        audit('daily_report', 'sprint_weekly_activity', activity_id, {'weekly_plan_id': plan_id})
        return _serialize(_document(db, 'sprint_weekly_plans', plan_id))
    return _safe_call(action)


@sprint_planning_bp.route('/api/v1/sprint-planning/checkout-readiness', methods=['GET'])
@current_user_required
def get_checkout_readiness():
    def action():
        db = get_db(); employee_id = _own_id(db)
        work_date = request.args.get('work_date')
        try:
            datetime.strptime(work_date or '', '%Y-%m-%d')
        except ValueError:
            return _error('work_date must be YYYY-MM-DD')
        plans = list(db.sprint_weekly_plans.find({'tenant_id': _tenant(),
            'employee_id': employee_id, 'status': 'approved', 'is_deleted': {'$ne': True},
            'week_start': {'$lte': work_date}, 'week_end': {'$gte': work_date}}))
        activities = [a for plan in plans for a in plan.get('activities', []) if a.get('planned_date') == work_date]
        result = checkout_readiness(activities)
        result.update({'work_date': work_date, 'activity_count': len(activities),
                       'note': (
                           'Attendance checkout requires daily reporting for '
                           'activities in approved weekly plans. Completed '
                           'work requires evidence; unfinished work requires '
                           'a reason. Existing attendance rules also apply.'
                       )})
        return _serialize(result)
    return _safe_call(action)


# ==========================================================
# YOURCOMATE - DAY-WISE PLAN CHANGE REQUESTS
# ==========================================================

@sprint_planning_bp.route(
    '/api/v1/sprint-planning/daily-change-requests',
    methods=['POST']
)
@current_user_required
def create_daily_change_request():

    def action():
        from copy import deepcopy
        from app.services.sprint_planning_service import (
            require_date,
            require_text
        )

        db = get_db()
        body = _payload()
        employee_id = _own_id(db)

        weekly_plan = _document(
            db,
            'sprint_weekly_plans',
            body.get('weekly_plan_id')
        )

        if not weekly_plan:
            return _error('Weekly plan not found', 404)

        if str(weekly_plan.get('employee_id')) != employee_id:
            return _error('Access denied', 403)

        if weekly_plan.get('status') != 'approved':
            return _error(
                'Weekly plan must be approved first',
                409
            )

        change_type = body.get('change_type')

        if change_type not in (
            'add_activity',
            'modify_activity'
        ):
            return _error('Invalid change type', 400)

        planned_date = require_date(
            body.get('planned_date'),
            'planned_date'
        )

        if not (
            weekly_plan['week_start']
            <= planned_date
            <= weekly_plan['week_end']
        ):
            return _error(
                'Date is outside approved week',
                400
            )

        title = require_text(
            body.get('title'),
            'title',
            200
        )

        reason = require_text(
            body.get('reason'),
            'reason',
            1000
        )

        if len(reason) < 10:
            return _error(
                'Reason must contain at least 10 characters',
                400
            )

        activity_id = None
        original_activity = None

        if change_type == 'modify_activity':
            activity_id = require_text(
                body.get('activity_id'),
                'activity_id',
                120
            )

            original_activity = next(
                (
                    activity
                    for activity in weekly_plan.get(
                        'activities', []
                    )
                    if str(activity.get('activity_id'))
                    == activity_id
                ),
                None
            )

            if not original_activity:
                return _error(
                    'Original activity not found',
                    404
                )

            if original_activity.get('status') == 'completed':
                return _error(
                    'Completed activity cannot be modified',
                    409
                )

            pending = db.sprint_change_requests.find_one({
                'tenant_id': _tenant(),
                'weekly_plan_id': str(weekly_plan['_id']),
                'activity_id': activity_id,
                'status': 'pending_approval',
                'is_deleted': {'$ne': True}
            })

            if pending:
                return _error(
                    'This activity already has a pending change',
                    409
                )

        now = utc_now()

        document = {
            'tenant_id': _tenant(),
            'employee_id': employee_id,
            'weekly_plan_id': str(weekly_plan['_id']),
            'activity_id': activity_id,
            'change_type': change_type,
            'planned_date': planned_date,
            'title': title,
            'description': str(
                body.get('description') or ''
            ).strip()[:2000],
            'expected_deliverable': str(
                body.get('expected_deliverable') or ''
            ).strip()[:500],
            'reason': reason,
            'original_activity': deepcopy(original_activity),
            'status': 'pending_approval',
            'tl_approval': 'pending',
            'ro_approval': 'pending',
            'approval_history': [],
            'created_by': _actor(),
            'created_at': now,
            'updated_at': now,
            'is_deleted': False
        }

        result = db.sprint_change_requests.insert_one(
            document
        )

        audit(
            'create',
            'sprint_change_request',
            str(result.inserted_id)
        )

        saved = db.sprint_change_requests.find_one({
            '_id': result.inserted_id,
            'tenant_id': _tenant()
        })

        return _serialize(saved), 201

    return _safe_call(action)


# ==========================================================
# YOURCOMATE - DAILY CHANGE APPROVALS (STEP 6)
# ==========================================================

@sprint_planning_bp.route(
    '/api/v1/sprint-planning/daily-change-requests/<request_id>/review',
    methods=['POST']
)
@current_user_required
def review_daily_change_request(request_id):
    def action():
        db = get_db()
        body = _payload()
        decision = body.get('decision')
        approval_role = body.get('approval_role')
        remarks = str(body.get('remarks') or '').strip()

        if decision not in ('approved', 'rejected'):
            return _error('decision must be approved or rejected')

        if approval_role not in ('tl', 'ro'):
            return _error('approval_role must be tl or ro')

        if decision == 'rejected' and len(remarks) < 5:
            return _error('Rejection requires at least five characters')

        change = _document(
            db, 'sprint_change_requests', request_id
        )

        if change is None:
            return _error('Change request not found', 404)

        if change.get('status') != 'pending_approval':
            return _error('Change request is no longer pending', 409)

        if not _manager_for(
            db, change['employee_id'], approval_role
        ):
            return _error(
                'You are not the assigned reporting approver',
                403
            )

        field = (
            'tl_approval'
            if approval_role == 'tl'
            else 'ro_approval'
        )

        other_field = (
            'ro_approval'
            if approval_role == 'tl'
            else 'tl_approval'
        )

        if change.get(field) != 'pending':
            return _error(
                'This approval has already been decided',
                409
            )

        now = utc_now()

        if decision == 'rejected':
            next_status = 'rejected'
        elif change.get(other_field) == 'approved':
            next_status = 'approved_pending_application'
        else:
            next_status = 'pending_approval'

        query = {
            '_id': change['_id'],
            'tenant_id': _tenant(),
            'status': 'pending_approval',
            field: 'pending',
            'is_deleted': {'$ne': True}
        }

        updated = db.sprint_change_requests.find_one_and_update(
            query,
            {
                '$set': {
                    field: decision,
                    'status': next_status,
                    'updated_at': now
                },
                '$push': {
                    'approval_history': {
                        'action': decision,
                        'approval_role': approval_role,
                        'actor_id': _actor(),
                        'remarks': remarks[:1000],
                        'at': now
                    }
                }
            },
            return_document=True
        )

        if updated is None:
            return _error(
                'Request changed; reload and retry',
                409
            )

        audit(
            'review',
            'sprint_change_request',
            request_id,
            {
                'decision': decision,
                'approval_role': approval_role
            }
        )

        return _serialize(updated)

    return _safe_call(action)


# ==========================================================
# YOURCOMATE - APPLY APPROVED DAY-WISE CHANGES
# STEP 7
# ==========================================================

@sprint_planning_bp.route(
    '/api/v1/sprint-planning/daily-change-requests/<request_id>/apply',
    methods=['POST']
)
@current_user_required
def apply_approved_daily_change(request_id):
    def action():
        db = get_db()

        change = _document(
            db, 'sprint_change_requests', request_id
        )

        if not change:
            return _error('Change request not found', 404)

        if not (
            _manager_for(db, change['employee_id'], 'tl')
            or _manager_for(db, change['employee_id'], 'ro')
        ):
            return _error(
                'Only the assigned reporting authority may apply changes',
                403
            )

        if change.get('status') == 'applied':
            return _serialize(change)

        if change.get('status') != 'approved_pending_application':
            return _error(
                'Both approvals are required before application',
                409
            )

        if (
            change.get('tl_approval') != 'approved'
            or change.get('ro_approval') != 'approved'
        ):
            return _error(
                'Reporting Team Leader and Reporting Officer approvals required',
                409
            )

        plan = _document(
            db, 'sprint_weekly_plans',
            change.get('weekly_plan_id')
        )

        if not plan:
            return _error('Original weekly plan not found', 404)

        if (
            str(plan.get('employee_id')) !=
            str(change.get('employee_id'))
        ):
            return _error('Plan ownership mismatch', 409)

        if plan.get('status') != 'approved':
            return _error('Weekly plan is not approved', 409)

        if not (
            plan['week_start'] <= change['planned_date']
            <= plan['week_end']
        ):
            return _error(
                'Changed activity date is outside the approved week',
                409
            )

        now = utc_now()
        change_id = str(change['_id'])

        base_query = {
            '_id': plan['_id'],
            'tenant_id': _tenant(),
            'employee_id': change['employee_id'],
            'status': 'approved',
            'is_deleted': {'$ne': True},
            'applied_change_request_ids': {'$ne': change_id}
        }

        history = {
            'change_request_id': change_id,
            'change_type': change['change_type'],
            'activity_id': change.get('activity_id'),
            'previous_activity': change.get('original_activity'),
            'approved_by_tl': True,
            'approved_by_ro': True,
            'applied_by': _actor(),
            'applied_at': now
        }

        if change['change_type'] == 'add_activity':
            new_id = 'change_' + change_id

            activity = {
                'activity_id': new_id,
                'planned_date': change['planned_date'],
                'title': change['title'],
                'description': change.get('description', ''),
                'expected_deliverable': change.get(
                    'expected_deliverable', ''
                ),
                'status': 'planned',
                'evidence': [],
                'incomplete_reason': None,
                'employee_remarks': '',
                'updated_at': None,
                'source': 'approved_change_request',
                'change_request_id': change_id
            }

            query = dict(base_query)
            query['activities.activity_id'] = {'$ne': new_id}

            result = db.sprint_weekly_plans.update_one(
                query,
                {
                    '$push': {
                        'activities': activity,
                        'change_application_history': history
                    },
                    '$addToSet': {
                        'applied_change_request_ids': change_id
                    },
                    '$set': {'updated_at': now}
                }
            )

        elif change['change_type'] == 'modify_activity':
            activity_id = change.get('activity_id')

            existing = next(
                (
                    item for item in plan.get('activities', [])
                    if str(item.get('activity_id')) == str(activity_id)
                ),
                None
            )

            if not existing:
                return _error('Original activity no longer exists', 409)

            if existing.get('status') == 'completed':
                return _error(
                    'Completed work cannot be rewritten', 409
                )

            query = dict(base_query)
            query['activities'] = {
                '$elemMatch': {
                    'activity_id': activity_id,
                    'status': {'$ne': 'completed'},
                    'change_request_id': {'$ne': change_id}
                }
            }

            history['previous_activity'] = existing

            result = db.sprint_weekly_plans.update_one(
                query,
                {
                    '$set': {
                        'activities.$.planned_date': change['planned_date'],
                        'activities.$.title': change['title'],
                        'activities.$.description': change.get(
                            'description', ''
                        ),
                        'activities.$.expected_deliverable': change.get(
                            'expected_deliverable', ''
                        ),
                        'activities.$.change_request_id': change_id,
                        'activities.$.source': 'approved_change_request',
                        'updated_at': now
                    },
                    '$push': {
                        'change_application_history': history
                    },
                    '$addToSet': {
                        'applied_change_request_ids': change_id
                    }
                }
            )

        else:
            return _error('Invalid change type', 409)

        if result.modified_count != 1:
            refreshed = _document(
                db, 'sprint_weekly_plans',
                change.get('weekly_plan_id')
            )

            already_applied = (
                refreshed is not None
                and change_id in refreshed.get(
                    'applied_change_request_ids', []
                )
            )

            if not already_applied:
                return _error(
                    'Plan changed or activity is no longer editable',
                    409
                )

        db.sprint_change_requests.update_one(
            {
                '_id': change['_id'],
                'tenant_id': _tenant(),
                'status': 'approved_pending_application',
                'tl_approval': 'approved',
                'ro_approval': 'approved'
            },
            {
                '$set': {
                    'status': 'applied',
                    'applied_at': utc_now(),
                    'updated_at': utc_now()
                },
                '$push': {
                    'approval_history': {
                        'action': 'applied',
                        'actor_id': _actor(),
                        'at': utc_now()
                    }
                }
            }
        )

        audit(
            'apply',
            'sprint_change_request',
            change_id
        )

        updated_change = _document(
            db, 'sprint_change_requests', request_id
        )

        return _serialize(updated_change)

    return _safe_call(action)



# ============================================================
# YOURCOMATE SPRINT PLANNING - STEP 18
# Role-scoped approval inbox
# ============================================================

@sprint_planning_bp.route(
    '/api/v1/sprint-planning/approval-inbox',
    methods=['GET']
)
@current_user_required
def get_sprint_approval_inbox():
    def action():
        db = get_db()
        tenant = _tenant()
        actor_employee = _employee(db)

        if actor_employee is None and not _admin():
            return _error('Employee profile not found', 403)

        roles = _roles()
        can_monitor_all = bool(
            roles & {
                'super_admin', 'admin', 'hr', 'hr_manager'
            }
        )

        try:
            limit = int(request.args.get('limit', '50'))
        except (TypeError, ValueError):
            return _error('limit must be a whole number')

        if limit < 1 or limit > 100:
            return _error('limit must be between 1 and 100')

        # The employee's actual reporting relationships determine
        # whose requests can be approved. Login roles alone are
        # not sufficient to authorise a Team Leader / RO approval.
        direct_ids = set()

        if actor_employee is not None:
            aliases = _identifiers(actor_employee)
            employees = db.employees.find(
                {
                    'tenant_id': tenant,
                    'is_deleted': {'$ne': True}
                },
                {
                    '_id': 1,
                    'team_leader_id': 1,
                    'team_leader_user_id': 1,
                    'team_leader_employee_id': 1,
                    'reporting_officer_id': 1,
                    'reporting_officer_user_id': 1,
                    'reporting_officer_employee_id': 1
                }
            )

            for employee in employees:
                if str(employee['_id']) == str(actor_employee['_id']):
                    continue

                fields = (
                    'team_leader_id',
                    'team_leader_user_id',
                    'team_leader_employee_id',
                    'reporting_officer_id',
                    'reporting_officer_user_id',
                    'reporting_officer_employee_id'
                )

                if any(
                    str(employee.get(field) or '').strip().lower()
                    in aliases
                    for field in fields
                    if employee.get(field)
                ):
                    direct_ids.add(str(employee['_id']))

        if not can_monitor_all and not direct_ids:
            return _serialize({
                'items': [],
                'count': 0,
                'scope': 'assigned_team'
            })

        base_query = {
            'tenant_id': tenant,
            'status': 'pending_approval',
            'is_deleted': {'$ne': True}
        }

        if not can_monitor_all:
            base_query['employee_id'] = {
                '$in': list(direct_ids)
            }

        items = []

        for kind, collection_name in (
            ('monthly', 'sprint_monthly_plans'),
            ('weekly', 'sprint_weekly_plans'),
            ('daily_change', 'sprint_change_requests')
        ):
            kind_query = dict(base_query)

            # Daily changes must remain visible after both
            # reviewers approve them, until they are applied.
            if kind == 'daily_change':
                kind_query['status'] = {
                    '$in': [
                        'pending_approval',
                        'approved_pending_application'
                    ]
                }

            cursor = (
                db[collection_name]
                .find(kind_query)
                .sort('created_at', -1)
                .limit(limit)
            )

            for document in cursor:
                employee_id = str(
                    document.get('employee_id') or ''
                )

                can_tl = _manager_for(
                    db, employee_id, 'tl'
                ) if actor_employee is not None else False

                can_ro = _manager_for(
                    db, employee_id, 'ro'
                ) if actor_employee is not None else False

                if not (
                    can_monitor_all or can_tl or can_ro
                ):
                    continue

                allowed_actions = []

                if (
                    kind == 'daily_change'
                    and document.get('status')
                    == 'approved_pending_application'
                    and (can_tl or can_ro)
                ):
                    # The apply endpoint performs its own
                    # permission and approval checks.
                    allowed_actions.append('apply_change')

                if kind == 'monthly':
                    # Preserve the existing monthly inbox behavior.
                    if can_tl:
                        allowed_actions.append('tl_review')
                elif kind == 'weekly':
                    try:
                        reviewer_kind = _weekly_plan_reviewer_kind(
                            db, document
                        )
                        if document.get('approver_employee_id'):
                            weekly_authorised = _monthly_can_review_pinned(
                                db, document
                            )
                        else:
                            weekly_authorised = _manager_for(
                                db, employee_id, reviewer_kind
                            )
                    except (PlanningError, ValueError, TypeError):
                        weekly_authorised = False
                        reviewer_kind = None

                    if weekly_authorised and document.get('status') == 'pending_approval':
                        allowed_actions.append(
                            'ro_review' if reviewer_kind == 'ro'
                            else 'tl_review'
                        )
                else:
                    if (
                        can_tl
                        and document.get('tl_approval') == 'pending'
                    ):
                        allowed_actions.append('tl_review')

                    if (
                        can_ro
                        and document.get('ro_approval') == 'pending'
                    ):
                        allowed_actions.append('ro_review')

                item = clean_doc(document)
                item['planning_type'] = kind
                item['allowed_actions'] = allowed_actions
                items.append(item)

        items.sort(
            key=lambda item: str(
                item.get('created_at') or ''
            ),
            reverse=True
        )

        items = items[:limit]

        return _serialize({
            'items': items,
            'count': len(items),
            'scope': (
                'organisation'
                if can_monitor_all
                else 'assigned_team'
            )
        })

    return _safe_call(action)



# ============================================================
# YOURCOMATE SPRINT PLANNING - STEP 25
# Read-only employee performance metrics
# ============================================================

@sprint_planning_bp.route(
    '/api/v1/sprint-planning/metrics/employee',
    methods=['GET']
)
@current_user_required
def get_sprint_employee_metrics():
    def action():
        from calendar import monthrange
        from datetime import date

        db = get_db()
        tenant = _tenant()

        month = (
            request.args.get('month')
            or datetime.now(timezone.utc).strftime('%Y-%m')
        )

        try:
            first_day = date.fromisoformat(month + '-01')
            if first_day.strftime('%Y-%m') != month:
                raise ValueError('Invalid month')

            last_day = date(
                first_day.year,
                first_day.month,
                monthrange(first_day.year, first_day.month)[1]
            )
        except (ValueError, TypeError):
            return _error('month must be YYYY-MM')

        employee_id = request.args.get('employee_id')

        if employee_id:
            employee_id = str(employee_id).strip()
            employee = db.employees.find_one({
                '_id': _oid(employee_id),
                'tenant_id': tenant,
                'is_deleted': {'$ne': True}
            })
            if not employee:
                return _error('Employee not found', 404)
        else:
            employee_id = _own_id(db)

        own_employee = _employee(db)
        is_self = (
            own_employee is not None
            and str(own_employee['_id']) == employee_id
        )

        is_reporting_manager = (
            _manager_for(db, employee_id, 'tl')
            or _manager_for(db, employee_id, 'ro')
        )

        can_view_organisation = bool(
            _roles() & {
                'super_admin',
                'admin',
                'hr',
                'hr_manager',
                'hr_admin'
            }
        )

        if not (
            is_self
            or is_reporting_manager
            or can_view_organisation
        ):
            return _error('Forbidden', 403)

        start = first_day.isoformat()
        end = last_day.isoformat()

        # Read only approved weekly plans that overlap
        # the requested month. Activities are then filtered
        # to their actual scheduled dates.
        query = {
            'tenant_id': tenant,
            'employee_id': employee_id,
            'status': 'approved',
            'is_deleted': {'$ne': True},
            'week_start': {'$lte': end},
            'week_end': {'$gte': start}
        }

        counts = {
            'planned': 0,
            'completed': 0,
            'in_progress': 0,
            'not_completed': 0,
            'unreported': 0,
            'completed_with_evidence': 0
        }

        by_date = {}
        weekly_plan_count = 0

        cursor = db.sprint_weekly_plans.find(
            query,
            {
                'week_start': 1,
                'week_end': 1,
                'activities': 1
            }
        )

        for plan in cursor:
            weekly_plan_count += 1

            for activity in plan.get('activities') or []:
                planned_date = str(
                    activity.get('planned_date') or ''
                )

                if not start <= planned_date <= end:
                    continue

                counts['planned'] += 1

                status = activity.get('status', 'planned')
                if status not in (
                    'completed',
                    'in_progress',
                    'not_completed'
                ):
                    status = 'unreported'

                counts[status] += 1

                has_evidence = bool(
                    activity.get('evidence')
                )

                if status == 'completed' and has_evidence:
                    counts['completed_with_evidence'] += 1

                daily = by_date.setdefault(
                    planned_date,
                    {
                        'date': planned_date,
                        'planned': 0,
                        'completed': 0,
                        'in_progress': 0,
                        'not_completed': 0,
                        'unreported': 0
                    }
                )

                daily['planned'] += 1
                daily[status] += 1

        total = counts['planned']
        completed = counts['completed']

        completion_rate = (
            round(completed * 100 / total, 2)
            if total else 0.0
        )

        reporting_rate = (
            round(
                (total - counts['unreported'])
                * 100 / total, 2
            )
            if total else 0.0
        )

        evidence_coverage_rate = (
            round(
                counts['completed_with_evidence']
                * 100 / completed, 2
            )
            if completed else 0.0
        )

        result = {
            'employee_id': employee_id,
            'month': month,
            'period_start': start,
            'period_end': end,
            'weekly_plan_count': weekly_plan_count,
            'counts': counts,
            'completion_rate': completion_rate,
            'reporting_rate': reporting_rate,
            'evidence_coverage_rate': evidence_coverage_rate,
            'daily_trend': [
                by_date[key]
                for key in sorted(by_date)
            ],
            'evidence_note': (
                'Evidence coverage counts submitted references; '
                'independent evidence verification is not yet implemented.'
            ),
            'source_scope': 'approved_weekly_plans'
        }

        return _serialize(result)

    return _safe_call(action)



# ============================================================
# YOURCOMATE SPRINT PLANNING - STEP 31
# Tenant-scoped, reporting-hierarchy team metrics
# ============================================================

@sprint_planning_bp.route(
    '/api/v1/sprint-planning/metrics/team',
    methods=['GET']
)
@current_user_required
def get_sprint_team_metrics():
    def action():
        from calendar import monthrange
        from datetime import date

        db = get_db()
        tenant = _tenant()
        month = (
            request.args.get('month')
            or datetime.now(timezone.utc).strftime('%Y-%m')
        )

        try:
            first = date.fromisoformat(month + '-01')
            if first.strftime('%Y-%m') != month:
                raise ValueError('Invalid month')
            last = date(
                first.year,
                first.month,
                monthrange(first.year, first.month)[1]
            )
        except (ValueError, TypeError):
            return _error('month must be YYYY-MM')

        start = first.isoformat()
        end = last.isoformat()

        roles = _roles()
        can_monitor_all = bool(
            roles & {
                'super_admin',
                'admin',
                'hr',
                'hr_manager',
                'hr_admin'
            }
        )

        actor_employee = _employee(db)

        if not can_monitor_all and actor_employee is None:
            return _error('Employee profile required', 403)

        # Reporting managers must have actual assigned
        # employees. A manager login role is not sufficient.
        employee_query = {
            'tenant_id': tenant,
            'is_deleted': {'$ne': True}
        }

        employee_fields = {
            '_id': 1,
            'first_name': 1,
            'last_name': 1,
            'name': 1,
            'employee_name': 1,
            'employee_code': 1,
            'department': 1,
            'department_name': 1
        }

        employees = []
        scanned = 0
        max_results = 100

        cursor = db.employees.find(employee_query)

        for employee in cursor:
            employee_id = str(employee['_id'])

            if not can_monitor_all:
                is_tl = _manager_for(db, employee_id, 'tl')
                is_ro = _manager_for(db, employee_id, 'ro')

                if not (is_tl or is_ro):
                    continue

            scanned += 1

            if len(employees) >= max_results:
                break

            first_name = str(
                employee.get('first_name') or ''
            ).strip()

            last_name = str(
                employee.get('last_name') or ''
            ).strip()

            full_name = (
                str(
                    employee.get('name')
                    or employee.get('employee_name')
                    or ''
                ).strip()
                or f'{first_name} {last_name}'.strip()
            )

            employees.append({
                'employee_id': employee_id,
                'name': full_name or 'Employee',
                'employee_code': str(
                    employee.get('employee_code') or ''
                ),
                'department': str(
                    employee.get('department_name')
                    or employee.get('department')
                    or ''
                ),
                'planned': 0,
                'completed': 0,
                'in_progress': 0,
                'not_completed': 0,
                'unreported': 0,
                'completed_with_evidence': 0
            })

        identifiers = [
            employee['employee_id']
            for employee in employees
        ]

        lookup = {
            employee['employee_id']: employee
            for employee in employees
        }

        # Weekly trend uses the same approved, tenant-scoped
        # activities as the existing organisation metrics.
        weekly_totals = {}

        if identifiers:
            plan_query = {
                'tenant_id': tenant,
                'employee_id': {'$in': identifiers},
                'status': 'approved',
                'is_deleted': {'$ne': True},
                'week_start': {'$lte': end},
                'week_end': {'$gte': start}
            }

            plans = db.sprint_weekly_plans.find(
                plan_query,
                {
                    'employee_id': 1,
                    'activities': 1
                }
            )

            for plan in plans:
                employee = lookup.get(
                    str(plan.get('employee_id') or '')
                )

                if employee is None:
                    continue

                for activity in plan.get('activities') or []:
                    planned_date = str(
                        activity.get('planned_date') or ''
                    )[:10]

                    if not start <= planned_date <= end:
                        continue

                    employee['planned'] += 1

                    status = activity.get('status')

                    if status not in (
                        'completed',
                        'in_progress',
                        'not_completed'
                    ):
                        status = 'unreported'

                    employee[status] += 1

                    # Group by the Monday of the planned week.
                    # Only genuine calendar dates enter the trend.
                    try:
                        planned_day = date.fromisoformat(planned_date)
                    except ValueError:
                        planned_day = None

                    if planned_day is not None:
                        week_start_day = date.fromordinal(
                            planned_day.toordinal()
                            - planned_day.weekday()
                        )
                        week_key = week_start_day.isoformat()

                        bucket = weekly_totals.setdefault(
                            week_key,
                            {
                                'planned': 0,
                                'completed': 0,
                                'in_progress': 0,
                                'not_completed': 0,
                                'unreported': 0
                            }
                        )

                        bucket['planned'] += 1
                        bucket[status] += 1

                    if (
                        status == 'completed'
                        and activity.get('evidence')
                    ):
                        employee['completed_with_evidence'] += 1

        totals = {
            'planned': 0,
            'completed': 0,
            'in_progress': 0,
            'not_completed': 0,
            'unreported': 0,
            'completed_with_evidence': 0
        }

        for employee in employees:
            total = employee['planned']
            complete = employee['completed']

            employee['completion_rate'] = round(
                complete * 100 / total, 2
            ) if total else 0.0

            employee['reporting_rate'] = round(
                (total - employee['unreported'])
                * 100 / total, 2
            ) if total else 0.0

            employee['evidence_coverage_rate'] = round(
                employee['completed_with_evidence']
                * 100 / complete, 2
            ) if complete else 0.0

            for key in totals:
                totals[key] += employee[key]

        total_planned = totals['planned']
        total_completed = totals['completed']

        summary = {
            **totals,
            'completion_rate': round(
                total_completed * 100 / total_planned, 2
            ) if total_planned else 0.0,
            'reporting_rate': round(
                (total_planned - totals['unreported'])
                * 100 / total_planned, 2
            ) if total_planned else 0.0,
            'evidence_coverage_rate': round(
                totals['completed_with_evidence']
                * 100 / total_completed, 2
            ) if total_completed else 0.0
        }

        weekly_trend = []

        for week_key in sorted(weekly_totals):
            bucket = weekly_totals[week_key]
            week_date = date.fromisoformat(week_key)

            weekly_trend.append({
                'week': week_key,
                'week_label': week_date.strftime('%d %b'),
                **bucket,
                'completion_rate': round(
                    bucket['completed'] * 100
                    / bucket['planned'], 2
                ) if bucket['planned'] else 0.0
            })


        # Planning pipeline is separate from approved-activity
        # completion metrics. Only authorised tenant employees
        # already selected by this handler are included.
        planning_pipeline = {
            'monthly': {},
            'weekly': {},
            'monthly_total': 0,
            'weekly_total': 0,
            'truncated': False
        }

        if identifiers:
            pipeline_limit = 5000

            monthly_query = {
                'tenant_id': tenant,
                'employee_id': {'$in': identifiers},
                'is_deleted': {'$ne': True},
                '$or': [
                    {'month': month},
                    {'month_key': month},
                    {'period_key': month},
                    {'planning_month': month},
                    {'year_month': month}
                ]
            }

            weekly_query = {
                'tenant_id': tenant,
                'employee_id': {'$in': identifiers},
                'is_deleted': {'$ne': True},
                'week_start': {'$lte': end},
                'week_end': {'$gte': start}
            }

            for label, collection, query in (
                ('monthly', db.sprint_monthly_plans, monthly_query),
                ('weekly', db.sprint_weekly_plans, weekly_query)
            ):
                records = collection.find(
                    query,
                    {'status': 1}
                ).limit(pipeline_limit + 1)

                for index, plan in enumerate(records):
                    if index >= pipeline_limit:
                        planning_pipeline['truncated'] = True
                        break

                    raw_status = str(
                        plan.get('status') or 'draft'
                    ).strip().lower()

                    status = {
                        'submitted': 'pending_approval',
                        'pending': 'pending_approval',
                        'pending_review': 'pending_approval',
                        'approved': 'approved',
                        'rejected': 'rejected',
                        'draft': 'draft'
                    }.get(raw_status, 'other')

                    counts = planning_pipeline[label]
                    counts[status] = counts.get(status, 0) + 1
                    planning_pipeline[label + '_total'] += 1

        return _serialize({
            'month': month,
            'scope': (
                'organisation'
                if can_monitor_all
                else 'assigned_team'
            ),
            'employee_count': len(employees),
            'limit': max_results,
            'truncated': scanned > max_results,
            'summary': summary,
            'planning_pipeline': planning_pipeline,
            'weekly_trend': weekly_trend,
            'employees': employees,
            'source_scope': 'approved_weekly_plans',
            'note': (
                'Only approved weekly planning activities '
                'are included. Evidence coverage means '
                'submitted references, not verified quality.'
            )
        })

    return _safe_call(action)


# STEP 44B.52E - SPRINT MODULE SETTINGS
# Controls are tenant-specific. Missing configuration means OFF.

def _sprint_settings_manager_allowed(user):
    """Check authenticated HR/Admin roles, never client-supplied roles."""
    if not isinstance(user, dict):
        return False

    allowed = {
        "super_admin", "admin", "hr_admin", "hr_manager", "hr"
    }

    collected = []

    for key in ("role", "user_role", "roles", "user_roles"):
        value = user.get(key)
        if isinstance(value, str):
            collected.extend(value.replace(",", " ").split())
        elif isinstance(value, (list, tuple, set)):
            collected.extend(str(item) for item in value)

    return bool(
        user.get("is_platform_superadmin") is True
        or any(
            str(role).strip().lower().replace("-", "_") in allowed
            for role in collected
        )
    )


@sprint_planning_bp.route(
    "/api/v1/sprint-planning/settings",
    methods=["GET"],
)
@current_user_required
def get_sprint_module_settings():
    from flask import g, jsonify
    from app.services.sprint_feature_settings import sprint_planning_enabled

    user = getattr(g, "current_user", None) or {}

    if not _sprint_settings_manager_allowed(user):
        return jsonify({"message": "Forbidden"}), 403

    db = get_db()
    tenant = _tenant()

    return jsonify({
        "tenant_id": tenant,
        "enabled": sprint_planning_enabled(db, tenant),
        "default_enabled": False,
        "can_manage": True,
    }), 200


@sprint_planning_bp.route(
    "/api/v1/sprint-planning/settings",
    methods=["PATCH"],
)
@current_user_required
def update_sprint_module_settings():
    from datetime import datetime, timezone
    from flask import g, jsonify, request
    from app.services.sprint_feature_settings import (
        SETTING_GROUP,
        SETTING_KEY,
        sprint_planning_settings_id,
    )

    user = getattr(g, "current_user", None) or {}

    if not _sprint_settings_manager_allowed(user):
        return jsonify({"message": "Forbidden"}), 403

    data = request.get_json(silent=True)

    if not isinstance(data, dict) or type(data.get("enabled")) is not bool:
        return jsonify({
            "message": "enabled must be a boolean: true or false"
        }), 400

    db = get_db()
    tenant = _tenant()

    if not tenant:
        return jsonify({"message": "Organisation context required"}), 403

    enabled = data["enabled"]
    now = datetime.now(timezone.utc)

    actor_id = str(user.get("_id") or user.get("id") or "")
    actor_name = str(user.get("name") or user.get("email") or "")

    settings_id = sprint_planning_settings_id(tenant)

    db.system_settings.update_one(
        {
            "_id": settings_id,
            "tenant_id": tenant,
        },
        {
            "$set": {
                "tenant_id": tenant,
                "setting_group": SETTING_GROUP,
                "setting_key": SETTING_KEY,
                "enabled": enabled,
                "is_deleted": False,
                "updated_at": now,
                "updated_by": actor_id,
                "updated_by_name": actor_name,
            },
            "$setOnInsert": {
                "created_at": now,
                "created_by": actor_id,
                "created_by_name": actor_name,
            },
        },
        upsert=True,
    )

    return jsonify({
        "tenant_id": tenant,
        "enabled": enabled,
        "can_manage": True,
        "message": (
            "Sprint Planning enabled for this organisation."
            if enabled
            else "Sprint Planning disabled for this organisation."
        ),
    }), 200


# STEP 44B.53A.2 - DEPARTMENT TEMPLATE MANAGEMENT
# Versioned templates are append-only. Existing approved plans are untouched.

def _sprint_template_list(db, tenant, department=None, plan_type=None):
    query = {
        "tenant_id": tenant,
        "is_deleted": {"$ne": True},
    }
    if department:
        query["department"] = department
    if plan_type:
        query["plan_type"] = plan_type

    docs = list(db.sprint_sheet_templates.find(query))

    latest = {}
    for doc in docs:
        identity = (doc["department"], doc["plan_type"])
        if (
            identity not in latest
            or doc.get("version", 0) > latest[identity].get("version", 0)
        ):
            latest[identity] = doc

    return sorted(
        latest.values(),
        key=lambda d: (
            d.get("department", "").lower(),
            d.get("plan_type", ""),
        ),
    )


def _sprint_template_view(doc):
    return {
        "id": str(doc["_id"]),
        "tenant_id": doc["tenant_id"],
        "department": doc["department"],
        "plan_type": doc["plan_type"],
        "version": doc["version"],
        "columns": doc["columns"],
        "created_by": doc.get("created_by"),
        "created_at": (
            doc["created_at"].isoformat()
            if hasattr(doc.get("created_at"), "isoformat")
            else doc.get("created_at")
        ),
    }


@sprint_planning_bp.route(
    "/api/v1/sprint-planning/settings/templates",
    methods=["GET"],
)
@current_user_required
def list_sprint_sheet_templates():
    from flask import g, jsonify, request
    from app.services.sprint_template_service import (
        SprintTemplateError,
        normalise_department,
        normalise_plan_type,
    )

    if not _sprint_settings_manager_allowed(
        getattr(g, "current_user", None) or {}
    ):
        return jsonify({"message": "Forbidden"}), 403

    department = request.args.get("department")
    plan_type = request.args.get("plan_type")

    try:
        if department:
            department = normalise_department(department)
        if plan_type:
            plan_type = normalise_plan_type(plan_type)
    except SprintTemplateError as error:
        return jsonify({"message": str(error)}), 400

    db = get_db()
    tenant = _tenant()

    docs = _sprint_template_list(
        db, tenant, department, plan_type
    )

    return jsonify({
        "templates": [
            _sprint_template_view(doc)
            for doc in docs
        ],
        "count": len(docs),
    }), 200


@sprint_planning_bp.route(
    "/api/v1/sprint-planning/settings/templates",
    methods=["POST"],
)
@current_user_required
def save_sprint_sheet_template():
    from datetime import datetime, timezone
    from flask import g, jsonify, request
    from pymongo.errors import DuplicateKeyError
    from app.services.sprint_template_service import (
        SprintTemplateError,
        create_template_version,
        template_identity,
    )

    user = getattr(g, "current_user", None) or {}

    if not _sprint_settings_manager_allowed(user):
        return jsonify({"message": "Forbidden"}), 403

    body = request.get_json(silent=True)

    if not isinstance(body, dict):
        return jsonify({"message": "A JSON object is required"}), 400

    db = get_db()
    tenant = _tenant()

    # Guarantee unique template versions across concurrent HR/Admin saves.
    # No existing template documents are changed by index creation.
    from pymongo import ASCENDING
    from pymongo.errors import PyMongoError

    try:
        db.sprint_sheet_templates.create_index(
            [
                ("tenant_id", ASCENDING),
                ("department", ASCENDING),
                ("plan_type", ASCENDING),
                ("version", ASCENDING),
            ],
            unique=True,
            name="uniq_sprint_sheet_template_version",
        )
    except PyMongoError:
        return jsonify({
            "message": (
                "Template version protection could not be verified. "
                "No template was saved."
            )
        }), 503

    try:
        identity = template_identity(
            tenant,
            body.get("department"),
            body.get("plan_type"),
        )

        existing = list(
            db.sprint_sheet_templates.find({
                **identity,
                "is_deleted": {"$ne": True},
            })
        )

        version = (
            max((doc.get("version", 0) for doc in existing), default=0)
            + 1
        )

        document = create_template_version(
            tenant,
            identity["department"],
            identity["plan_type"],
            body.get("columns"),
            version,
            user.get("_id") or user.get("id"),
        )
    except SprintTemplateError as error:
        return jsonify({"message": str(error)}), 400

    document["created_at"] = datetime.now(timezone.utc)

    try:
        result = db.sprint_sheet_templates.insert_one(document)
    except DuplicateKeyError:
        return jsonify({
            "message": "Template version already exists. Reload and retry."
        }), 409

    document["_id"] = result.inserted_id

    return jsonify({
        "template": _sprint_template_view(document),
        "message": "Planning sheet template saved.",
    }), 201


# STEP 44B.53C.4 - EMPLOYEE TEMPLATE RESOLUTION
# Department is derived from the authenticated HRMS employee.
# No department is accepted from a client-supplied query or payload.

def _sprint_employee_department(employee):
    from app.services.sprint_template_service import (
        SprintTemplateError,
        normalise_department,
    )

    if not isinstance(employee, dict):
        raise SprintTemplateError("Employee profile is required")

    department = employee.get("department")

    if isinstance(department, dict):
        department = (
            department.get("name")
            or department.get("department_name")
        )

    if not isinstance(department, str):
        department = (
            employee.get("department_name")
            or employee.get("dept_name")
        )

    if not isinstance(department, str):
        raise SprintTemplateError(
            "Your employee profile has no valid department"
        )

    return normalise_department(department)


def _sprint_latest_department_template(
    db, tenant, department, plan_type,
):
    """Read the latest template only within the authenticated tenant."""
    from app.services.sprint_template_service import (
        template_identity,
    )

    identity = template_identity(
        tenant, department, plan_type
    )

    records = list(db.sprint_sheet_templates.find({
        **identity,
        "is_deleted": {"$ne": True},
    }))

    if not records:
        return None

    return max(records, key=lambda item: item["version"])


@sprint_planning_bp.route(
    "/api/v1/sprint-planning/my-template",
    methods=["GET"],
)
@current_user_required
def get_my_sprint_template():
    from flask import jsonify, request
    from app.services.sprint_template_service import (
        SprintTemplateError,
        normalise_plan_type,
    )
    from app.services.sprint_feature_settings import (
        sprint_planning_enabled,
    )

    db = get_db()
    employee = _employee(db)

    if employee is None:
        return jsonify({
            "message": "An employee profile is required"
        }), 403

    try:
        department = _sprint_employee_department(employee)
        plan_type = normalise_plan_type(
            request.args.get("plan_type", "monthly")
        )
    except SprintTemplateError as error:
        return jsonify({"message": str(error)}), 400

    tenant = _tenant()

    template = _sprint_latest_department_template(
        db,
        tenant,
        department,
        plan_type,
    )

    return jsonify({
        "department": department,
        "plan_type": plan_type,
        "sprint_enabled": sprint_planning_enabled(db, tenant),
        "template_configured": template is not None,
        "template": (
            _sprint_template_view(template)
            if template is not None
            else None
        ),
        "legacy_sheet_available": template is None,
    }), 200

# STEP 44B.53C.5 - MONTHLY DYNAMIC TEMPLATE PERSISTENCE
# Keep standard monthly sheet validation unchanged. Custom values are
# validated and attached only after the standard model is constructed.

def _sprint_apply_monthly_template(
    db, body, document, *, employee, existing=None
):
    from app.services.sprint_feature_settings import sprint_planning_enabled
    from app.services.sprint_template_service import SprintTemplateError
    from app.services.sprint_template_values import (
        validate_template_values,
        snapshot_template,
    )

    tenant = _tenant()
    existing = existing or {}
    frozen = existing.get("sprint_template_snapshot")

    # Drafts that already reference a template keep their saved definition,
    # even if HR later changes or disables that template.
    if frozen:
        snapshot = frozen
    elif existing:
        # Legacy drafts do not silently migrate to a new template.
        snapshot = None
    elif sprint_planning_enabled(db, tenant):
        try:
            department = _sprint_employee_department(employee)
        except SprintTemplateError as exc:
            raise PlanningError(str(exc)) from exc

        latest = _sprint_latest_department_template(
            db, tenant, department, "monthly"
        )
        try:
            snapshot = snapshot_template(latest) if latest else None
        except SprintTemplateError as exc:
            raise PlanningError(str(exc)) from exc
    else:
        snapshot = None

    submitted_rows = body.get("sheet_rows")
    validated_rows = document.get("sheet_rows") or []

    if not snapshot:
        # Legacy plans are unaffected; no custom fields are accepted
        # without a known template.
        if isinstance(submitted_rows, list) and any(
            isinstance(row, dict) and "custom_values" in row
            for row in submitted_rows
        ):
            raise PlanningError(
                "Custom planning values require an assigned template"
            )
        document["sprint_template_snapshot"] = None
        return document

    try:
        frozen_snapshot = snapshot_template(snapshot)
    except SprintTemplateError as exc:
        raise PlanningError(str(exc)) from exc

    if frozen_snapshot["plan_type"] != "monthly":
        raise PlanningError("Monthly template type mismatch")

    try:
        actual_department = _sprint_employee_department(employee)
    except SprintTemplateError as exc:
        raise PlanningError(str(exc)) from exc

    if actual_department.casefold() != frozen_snapshot["department"].casefold():
        raise PlanningError(
            "The saved planning template does not match your department"
        )

    if not isinstance(submitted_rows, list):
        raise PlanningError(
            "Monthly template requires detailed planning rows"
        )

    if len(submitted_rows) != len(validated_rows):
        raise PlanningError(
            "Monthly template row count mismatch"
        )

    for index, (raw_row, cleaned_row) in enumerate(
        zip(submitted_rows, validated_rows), start=1
    ):
        if not isinstance(raw_row, dict):
            raise PlanningError(f"Invalid planning row {index}")

        try:
            cleaned_row["custom_values"] = validate_template_values(
                frozen_snapshot["columns"],
                raw_row.get("custom_values", {}),
                allow_missing_required_files=True,
            )
        except SprintTemplateError as exc:
            raise PlanningError(
                f"Planning row {index}: {exc}"
            ) from exc

    document["sprint_template_snapshot"] = frozen_snapshot
    return document


# STEP 44B.53E.2 - WEEKLY DYNAMIC TEMPLATE PERSISTENCE
# Preserve existing approved-month checks and weekly activity validation.

def _sprint_apply_weekly_template(
    db, body, document, *, employee
):
    from app.services.sprint_feature_settings import sprint_planning_enabled
    from app.services.sprint_template_service import SprintTemplateError
    from app.services.sprint_template_values import (
        validate_template_values, snapshot_template,
    )

    tenant = _tenant()
    raw_activities = body.get("activities")
    cleaned_activities = document.get("activities") or []

    if not isinstance(raw_activities, list):
        raise PlanningError("Weekly activities must be a list")

    if len(raw_activities) != len(cleaned_activities):
        raise PlanningError("Weekly activity count mismatch")

    if not sprint_planning_enabled(db, tenant):
        if any(
            isinstance(item, dict) and "custom_values" in item
            for item in raw_activities
        ):
            raise PlanningError(
                "Custom weekly fields require Sprint Planning to be enabled"
            )
        return document

    try:
        department = _sprint_employee_department(employee)
        latest = _sprint_latest_department_template(
            db, tenant, department, "weekly"
        )
        snapshot = snapshot_template(latest) if latest else None
    except SprintTemplateError as exc:
        raise PlanningError(str(exc)) from exc

    if snapshot is None:
        if any(
            isinstance(item, dict) and "custom_values" in item
            for item in raw_activities
        ):
            raise PlanningError(
                "Custom weekly fields require an assigned weekly template"
            )
        return document

    if snapshot["plan_type"] != "weekly":
        raise PlanningError("Weekly template type mismatch")

    for index, (raw, cleaned) in enumerate(
        zip(raw_activities, cleaned_activities), start=1
    ):
        if not isinstance(raw, dict) or not isinstance(cleaned, dict):
            raise PlanningError(f"Invalid weekly activity {index}")

        try:
            cleaned["custom_values"] = validate_template_values(
                snapshot["columns"],
                raw.get("custom_values", {}),
                allow_missing_required_files=True,
            )
        except SprintTemplateError as exc:
            raise PlanningError(
                f"Weekly activity {index}: {exc}"
            ) from exc

    document["sprint_template_snapshot"] = snapshot
    return document


# STEP 44B.53E.4 - DAILY TEMPLATE REPORTING
# Preserve existing completion/evidence/reason validation and checkout rules.
def _sprint_validate_daily_template(db, body, activity, *, employee):
    from app.services.sprint_feature_settings import sprint_planning_enabled
    from app.services.sprint_template_service import SprintTemplateError
    from app.services.sprint_template_values import (
        validate_template_values, snapshot_template,
    )

    tenant = _tenant()

    if not sprint_planning_enabled(db, tenant):
        if "daily_custom_values" in body:
            raise PlanningError(
                "Daily custom fields require Sprint Planning to be enabled"
            )
        return {}

    existing = activity.get("daily_template_snapshot")

    if existing:
        template = existing
    else:
        try:
            department = _sprint_employee_department(employee)
            latest = _sprint_latest_department_template(
                db, tenant, department, "daily"
            )
            template = snapshot_template(latest) if latest else None
        except SprintTemplateError as exc:
            raise PlanningError(str(exc)) from exc

    if template is None:
        if "daily_custom_values" in body:
            raise PlanningError(
                "No daily reporting template is assigned"
            )
        return {}

    try:
        frozen = snapshot_template(template)
        department = _sprint_employee_department(employee)
    except SprintTemplateError as exc:
        raise PlanningError(str(exc)) from exc

    if frozen["plan_type"] != "daily":
        raise PlanningError("Daily reporting template type mismatch")

    if frozen["department"].casefold() != department.casefold():
        raise PlanningError(
            "Daily reporting template does not match employee department"
        )

    # Existing reporting values are retained when a client submits
    # only a status/evidence update; required fields are still validated.
    raw = body.get(
        "daily_custom_values",
        activity.get("daily_custom_values", {}),
    )

    try:
        values = validate_template_values(
            frozen["columns"], raw
        )
    except SprintTemplateError as exc:
        raise PlanningError(
            f"Daily reporting custom fields: {exc}"
        ) from exc

    return {
        "daily_custom_values": values,
        "daily_template_snapshot": frozen,
    }


# STEP 44B.53G.6A-R3 - Tenant-scoped Sprint attachment upload
@sprint_planning_bp.route(
    '/api/v1/sprint-planning/attachments/<plan_type>/<plan_id>',
    methods=['POST']
)
@current_user_required
def upload_sprint_attachment(plan_type, plan_id):
    from pathlib import Path
    from flask import current_app, jsonify, request
    from app.services.sprint_attachment_service import (
        SprintAttachmentError,
        MAX_SPRINT_ATTACHMENT_BYTES,
        safe_attachment_filename,
        safe_tenant_segment,
        validate_attachment_content,
    )
    from app.services.sprint_attachment_storage import (
        save_sprint_attachment,
    )
    from app.services.sprint_attachment_field_policy import (
        SprintAttachmentFieldError,
        validate_attachment_field,
    )
    from app.services.sprint_attachment_metadata import (
        PLAN_COLLECTIONS,
        SprintAttachmentOwnershipError,
        validate_upload_ownership,
        build_sprint_attachment_metadata,
    )
    from app.services.sprint_feature_settings import (
        sprint_planning_enabled,
    )

    def action():
        db = get_db()
        tenant = _tenant()

        if not sprint_planning_enabled(db, tenant):
            return jsonify({
                'message': 'Sprint Planning is disabled'
            }), 403

        employee = _employee(db)

        if employee is None:
            return jsonify({
                'message': 'Employee profile is required'
            }), 403

        if plan_type not in PLAN_COLLECTIONS:
            return jsonify({
                'message': 'Unsupported plan type'
            }), 400

        activity_id = str(
            request.form.get('activity_id') or ''
        ).strip()

        field_key = str(
            request.form.get('field_key') or ''
        ).strip()

        # STEP 44B.53G.8C.3
        row_id = str(
            request.form.get('row_id') or ''
        ).strip()

        if plan_type == 'monthly':
            if not row_id or activity_id:
                return jsonify({
                    'message': 'Monthly upload requires row_id only'
                }), 400
        elif row_id or not activity_id:
            return jsonify({
                'message': 'Activity upload requires activity_id only'
            }), 400

        plan = _document(
            db,
            PLAN_COLLECTIONS[plan_type],
            plan_id,
        )

        try:
            validate_upload_ownership(
                plan,
                employee,
                tenant,
                plan_type,
                activity_id=activity_id or None,
            )
        except SprintAttachmentOwnershipError as error:
            return jsonify({
                'message': str(error)
            }), 403

        # STEP 44B.53G.6C - Validate server-saved file field
        try:
            validate_attachment_field(
                plan,
                plan_type,
                field_key,
                activity_id=activity_id or None,
                row_id=row_id or None,
            )
        except SprintAttachmentFieldError as error:
            return jsonify({
                'message': str(error)
            }), 400

        upload = request.files.get('file')

        if not upload or not upload.filename:
            return jsonify({
                'message': 'Attachment file required'
            }), 400

        try:
            filename = safe_attachment_filename(
                upload.filename
            )

            content = upload.stream.read(
                MAX_SPRINT_ATTACHMENT_BYTES + 1
            )

            validate_attachment_content(
                filename, content
            )

        except SprintAttachmentError as error:
            return jsonify({
                'message': str(error)
            }), 400

        storage_root = (
            current_app.config.get(
                'SPRINT_ATTACHMENT_UPLOAD_FOLDER'
            )
            or str(
                Path(current_app.instance_path)
                / 'sprint_attachments'
            )
        )

        root = Path(storage_root)
        storage = None

        try:
            root.mkdir(
                parents=True,
                exist_ok=True,
            )

            storage = save_sprint_attachment(
                root,
                tenant,
                filename,
                content,
            )

            metadata = build_sprint_attachment_metadata(
                tenant_id=tenant,
                employee_id=str(employee['_id']),
                plan_id=str(plan['_id']),
                plan_type=plan_type,
                activity_id=activity_id or None,
                field_key=field_key or None,
                row_id=row_id or None,
                storage_metadata=storage,
            )

            db.sprint_attachments.insert_one(metadata)

        except Exception:
            if storage:
                stored_path = (
                    root
                    / safe_tenant_segment(tenant)
                    / storage['storage_id']
                )
                stored_path.unlink(missing_ok=True)
            raise

        return jsonify({
            'attachment_id': metadata['attachment_id'],
            'plan_id': metadata['plan_id'],
            'plan_type': metadata['plan_type'],
            'activity_id': metadata['activity_id'],
            'row_id': metadata['row_id'],
            'field_key': metadata['field_key'],
            'original_filename': metadata['original_filename'],
            'size_bytes': metadata['size_bytes'],
        }), 201

    return _safe_call(action)


# STEP 44B.53G.7A - Authenticated Sprint attachment download
@sprint_planning_bp.route(
    '/api/v1/sprint-planning/attachments/<attachment_id>/download',
    methods=['GET']
)
@current_user_required
def download_sprint_attachment(attachment_id):
    from pathlib import Path
    from io import BytesIO
    from flask import current_app, jsonify, send_file
    from app.services.sprint_attachment_access import (
        can_access_sprint_attachment,
        validate_sprint_attachment_scope,
    )
    from app.services.sprint_attachment_metadata import (
        PLAN_COLLECTIONS,
    )
    from app.services.sprint_attachment_storage import (
        read_sprint_attachment,
    )
    from app.services.sprint_attachment_service import (
        SprintAttachmentError,
    )

    def action():
        db = get_db()
        tenant = _tenant()

        attachment = db.sprint_attachments.find_one({
            'attachment_id': attachment_id,
            'tenant_id': tenant,
            'is_deleted': {'$ne': True},
        })

        if not attachment:
            return jsonify({
                'message': 'Attachment not found'
            }), 404

        plan_type = attachment.get('plan_type')
        plan_id = attachment.get('plan_id')

        if plan_type not in PLAN_COLLECTIONS:
            return jsonify({
                'message': 'Invalid attachment scope'
            }), 404

        plan = _document(
            db,
            PLAN_COLLECTIONS[plan_type],
            plan_id,
        )

        if not plan:
            return jsonify({
                'message': 'Planning record not found'
            }), 404

        # STEP 44B.53G.7C - Verify the real parent plan
        # belongs to the same tenant and attachment owner.
        if (
            str(plan.get('tenant_id') or '') != str(tenant)
            or str(plan.get('employee_id') or '')
               != str(attachment.get('employee_id') or '')
            or plan.get('is_deleted') is True
        ):
            return jsonify({
                'message': 'Planning record not found'
            }), 404

        if not validate_sprint_attachment_scope(
            attachment,
            tenant,
            plan_type,
            str(plan['_id']),
        ):
            return jsonify({
                'message': 'Attachment scope mismatch'
            }), 403

        employee = _employee(db)

        actor_roles = _roles()

        # STEP 44B.53G.7D.3
        # Resolve the actual attachment owner within this tenant.
        # Never trust supervisor IDs supplied in planning records.
        from app.services.sprint_attachment_hierarchy import (
            attachment_hierarchy_decision,
        )

        owner_oid = _oid(attachment.get('employee_id'))

        if owner_oid is None:
            return jsonify({
                'message': 'Attachment owner not found'
            }), 404

        owner_employee = db.employees.find_one({
            '_id': owner_oid,
            'tenant_id': tenant,
            'is_deleted': {'$ne': True},
        })

        if not owner_employee:
            return jsonify({
                'message': 'Attachment owner not found'
            }), 404

        if str(owner_employee.get('_id')) != str(
            attachment.get('employee_id')
        ):
            return jsonify({
                'message': 'Attachment owner mismatch'
            }), 404

        hierarchy_result = attachment_hierarchy_decision(
            owner_employee,
            employee,
            tenant,
        )

        # Use only relationships verified from HRMS records.
        access_record = dict(attachment)
        access_record.pop(
            'team_leader_employee_id', None
        )
        access_record.pop(
            'reporting_officer_employee_id', None
        )

        if hierarchy_result == 'team_leader':
            access_record['team_leader_employee_id'] = str(
                employee['_id']
            )

        if hierarchy_result == 'reporting_officer':
            access_record['reporting_officer_employee_id'] = str(
                employee['_id']
            )

        if not can_access_sprint_attachment(
            access_record,
            employee,
            tenant,
            roles=actor_roles,
        ):
            return jsonify({
                'message': 'You are not permitted to download this file'
            }), 403

        storage_root = (
            current_app.config.get(
                'SPRINT_ATTACHMENT_UPLOAD_FOLDER'
            )
            or str(
                Path(current_app.instance_path)
                / 'sprint_attachments'
            )
        )

        try:
            contents = read_sprint_attachment(
                storage_root,
                tenant,
                attachment['storage_id'],
            )
        except SprintAttachmentError:
            return jsonify({
                'message': 'Attachment cannot be retrieved'
            }), 404

        from werkzeug.utils import secure_filename

        filename = secure_filename(
            attachment.get('original_filename')
            or 'attachment'
        )

        return send_file(
            BytesIO(contents),
            as_attachment=True,
            download_name=filename,
            mimetype='application/octet-stream',
            max_age=0,
        )

    return _safe_call(action)
