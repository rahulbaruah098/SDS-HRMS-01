"""Monthly date-wise task validation and tenant-scoped weekly projection.

No destructive migration. Generated weekly plans are compatible with existing
attendance checkout/evidence code. Never overwrite a user-managed weekly plan.
"""
from collections import defaultdict
from datetime import date, timedelta
from uuid import uuid5, NAMESPACE_URL

from app.services.sprint_planning_service import PlanningError, new_weekly_plan, utc_now


def validate_targets(targets, start_date, end_date):
    if targets is None:
        return []
    if not isinstance(targets, list) or len(targets) > 31:
        raise PlanningError('daily_targets must contain at most 31 rows per monthly activity')
    result = []
    for item in targets:
        if not isinstance(item, dict):
            raise PlanningError('Invalid day-wise task')
        day = str(item.get('date') or '').strip()
        try:
            if date.fromisoformat(day).isoformat() != day:
                raise ValueError()
        except ValueError as exc:
            raise PlanningError('Invalid daily target date') from exc
        if not start_date <= day <= end_date:
            raise PlanningError('Daily target must fall within its monthly activity dates')
        title = str(item.get('title') or '').strip()
        target = str(item.get('target') or '').strip()
        if not title or len(title) > 200:
            raise PlanningError('Daily task title must be 1-200 characters')
        if not target or len(target) > 500:
            raise PlanningError('Daily target must be 1-500 characters')
        result.append({'date': day, 'title': title, 'target': target})
    return result


def projected_weeks(monthly):
    """Return deterministic weekly activity batches; no implicit extra days."""
    plan_id = str(monthly['_id'])
    groups = defaultdict(list)
    for row_i, row in enumerate(monthly.get('sheet_rows') or []):
        for day_i, task in enumerate(row.get('daily_targets') or []):
            day = date.fromisoformat(task['date'])
            monday = day - timedelta(days=day.weekday())
            sunday = monday + timedelta(days=6)
            activity_id = uuid5(NAMESPACE_URL, f'{plan_id}/{row_i}/{day_i}/{task["date"]}').hex
            groups[(monday.isoformat(), sunday.isoformat())].append({
                'activity_id': activity_id,
                'planned_date': task['date'],
                'title': task['title'],
                'description': f'Monthly goal: {row.get("objective", "")} | Daily target: {task["target"]}'[:2000],
                'expected_deliverable': task['target'],
            })
    if any(len(tasks) > 200 for tasks in groups.values()):
        raise PlanningError('One generated week exceeds the 200 activity limit')
    return dict(sorted(groups.items()))


def sync_approved_month(db, monthly, actor_id, activate=True):
    """Materialize approved monthly date targets into weekly plans.

    If called after employee TL approval with activate=False, generated plans
    remain drafts until final compilation RO approval. Existing overlapping
    user-created weekly records are never edited or deleted.
    """
    result = {'created': 0, 'activated': 0, 'conflicts': [], 'total_targets': 0}
    if not monthly or monthly.get('status') != 'approved':
        return result
    tenant = str(monthly['tenant_id'])
    employee = str(monthly['employee_id'])
    month_id = str(monthly['_id'])
    for (start, end), activities in projected_weeks(monthly).items():
        result['total_targets'] += len(activities)
        query = {'tenant_id': tenant, 'employee_id': employee,
                 'week_start': start, 'week_end': end, 'is_deleted': {'$ne': True}}
        existing = db.sprint_weekly_plans.find_one(query)
        if existing:
            if existing.get('generated_from_monthly') == month_id:
                if activate and existing.get('status') == 'draft':
                    # No employee reporting can have occurred in a draft plan.
                    updated = db.sprint_weekly_plans.update_one({
                        '_id': existing['_id'], **query, 'status': 'draft'
                    }, {'$set': {'status': 'approved', 'updated_at': utc_now()}})
                    result['activated'] += updated.modified_count
                continue
            result['conflicts'].append({'week_start': start, 'week_end': end,
                                        'reason': 'Existing weekly plan preserved'})
            continue
        weekly = new_weekly_plan(
            tenant_id=tenant, employee_id=employee, monthly_plan_id=month_id,
            week_start=start, week_end=end, activities=activities, actor_id=actor_id,
        )
        weekly['generated_from_monthly'] = month_id
        weekly['status'] = 'approved' if activate else 'draft'
        weekly['automation_version'] = 1
        # No source monthly plan is modified and no attendance entries change.
        db.sprint_weekly_plans.insert_one(weekly)
        result['created'] += 1
    return result
