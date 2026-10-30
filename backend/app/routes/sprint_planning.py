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


@sprint_planning_bp.route('/api/v1/sprint-planning/monthly', methods=['POST'])
@current_user_required
def create_monthly_plan():
    def action():
        db = get_db(); body = _payload(); employee_id = _own_id(db)
        document = new_monthly_plan(tenant_id=_tenant(), employee_id=employee_id,
            month=body.get('month'), title=body.get('title'), goals=body.get('goals'), actor_id=_actor())
        if db.sprint_monthly_plans.find_one({'tenant_id': _tenant(), 'employee_id': employee_id,
                                            'month': document['month'], 'is_deleted': {'$ne': True}}):
            return _error('Monthly plan already exists', 409)
        result = db.sprint_monthly_plans.insert_one(document)
        audit('create', 'sprint_monthly_plan', str(result.inserted_id))
        return _serialize(db.sprint_monthly_plans.find_one({'_id': result.inserted_id})), 201
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
        if not document['week_start'].startswith(month_plan['month']) and not document['week_end'].startswith(month_plan['month']):
            return _error('Week must overlap the approved monthly plan', 400)
        if db.sprint_weekly_plans.find_one({'tenant_id': _tenant(), 'employee_id': employee_id,
            'week_start': document['week_start'], 'is_deleted': {'$ne': True}}):
            return _error('Weekly plan already exists for this start date', 409)
        result = db.sprint_weekly_plans.insert_one(document)
        audit('create', 'sprint_weekly_plan', str(result.inserted_id))
        return _serialize(db.sprint_weekly_plans.find_one({'_id': result.inserted_id})), 201
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
        update = {'$set': {'status': 'pending_approval', 'updated_at': utc_now()},
                  '$push': {'approval_history': {'action': 'submitted', 'actor_id': _actor(), 'at': utc_now()}}}
        db[collection].update_one({'_id': doc['_id'], 'status': doc['status']}, update)
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
        if not _manager_for(db, doc['employee_id'], 'tl'):
            return _error('Only the assigned Reporting Team Leader may review', 403)
        decision = body.get('decision')
        if decision not in ('approved', 'rejected'):
            return _error('decision must be approved or rejected')
        remarks = str(body.get('remarks') or '').strip()
        if decision == 'rejected' and len(remarks) < 5:
            return _error('Rejection requires remarks of at least five characters')
        result = db[collection].update_one({'_id': doc['_id'], 'status': 'pending_approval'}, {
            '$set': {'status': decision, 'updated_at': utc_now()},
            '$push': {'approval_history': {'action': decision, 'actor_id': _actor(),
                'role': 'team_leader', 'remarks': remarks[:1000], 'at': utc_now()}}
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
        changes = {f'activities.$.{key}': value for key, value in patch.items()}
        changes['updated_at'] = utc_now()
        result = db.sprint_weekly_plans.update_one({'_id': doc['_id'], 'status': 'approved',
            'activities.activity_id': activity_id}, {'$set': changes})
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
                       'note': 'Advisory only. Attendance checkout is not yet connected.'})
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

                if kind in ('monthly', 'weekly'):
                    if can_tl:
                        allowed_actions.append('tl_review')
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
            'employees': employees,
            'source_scope': 'approved_weekly_plans',
            'note': (
                'Only approved weekly planning activities '
                'are included. Evidence coverage means '
                'submitted references, not verified quality.'
            )
        })

    return _safe_call(action)
