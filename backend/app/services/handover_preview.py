"""Batch 13-R3: bounded, read-only operational handover preview.

New R3 implementation based on the documented R2 contract, not the original R2 source.
No persistence and no historical reassignment.
"""
from bson import ObjectId
from app.services.active_employee_scope import employee_is_active

EXIT_STATUSES = {'resigned', 'resign', 'left', 'terminated', 'retired', 'alumni', 'ex-employee', 'ex_employee'}
NOTICE_STATUSES = {'scheduled', 'serving', 'due_for_alumni', 'completed'}
PROJECT_FIELDS = ('assigned_to_id', 'assigned_to_employee_id', 'assigned_employee_id', 'primary_assignee_id')
PROJECT_ARRAYS = ('assigned_employee_ids', 'assigned_to_ids', 'collaborator_ids')
MEMBER_ARRAYS = ('assigned_members', 'collaborators')
REPORT_FIELDS = ('team_leader_id', 'team_leader_employee_id', 'reporting_officer_id', 'reporting_officer_employee_id')
PROJECT_REPORT_FIELDS = ('team_leader_id', 'reporting_officer_id')


def employee_exiting(employee):
    if employee.get('is_alumni') is True:
        return True
    if any(str(employee.get(k) or '').strip().lower() in EXIT_STATUSES for k in ('status', 'employment_status', 'employee_status')):
        return True
    return str(employee.get('notice_status') or '').strip().lower() in NOTICE_STATUSES and bool(employee.get('last_working_day'))


def _matches(value, identifier):
    return str(value or '').strip().lower() == str(identifier).strip().lower()


def project_responsibilities(project, departing_id):
    kinds = []
    if any(_matches(project.get(k), departing_id) for k in PROJECT_FIELDS):
        kinds.append('primary_assignment')
    if any(isinstance(project.get(k), list) and any(_matches(x, departing_id) for x in project[k]) for k in PROJECT_ARRAYS if k != 'collaborator_ids'):
        kinds.append('assigned_membership')
    if isinstance(project.get('collaborator_ids'),list) and any(_matches(x,departing_id) for x in project['collaborator_ids']):
        kinds.append('collaborator_membership')
    for field in MEMBER_ARRAYS:
        values = project.get(field)
        if not isinstance(values, list):
            continue
        if any((isinstance(x, dict) and any(_matches(x.get(key), departing_id) for key in ('_id','id','employee_id','employee_ref_id'))) or _matches(x, departing_id) for x in values):
            kinds.append('collaborator_membership' if field == 'collaborators' else 'assigned_membership')
    if any(_matches(project.get(field), departing_id) for field in PROJECT_REPORT_FIELDS):
        kinds.append('project_reporting_role')
    return sorted(set(kinds))


def preview(db, tenant, departing, replacement):
    source_id = str(departing['_id'])
    target_id = str(replacement['_id'])
    if source_id == target_id:
        raise ValueError('Departing and replacement employees must differ')
    if departing.get('tenant_id') != tenant or replacement.get('tenant_id') != tenant:
        raise ValueError('Employees must belong to the current company')
    if not employee_exiting(departing):
        raise ValueError('Departing employee must have a valid exit-related state')
    if not employee_is_active(replacement):
        raise ValueError('Replacement employee must be active')

    items = []
    capped_collections = []
    def add(category, kind, state, identifier, reason, title=None):
        entry = {'category':category,'kind':kind,'classification':state,'record_id':str(identifier),'reason':reason}
        if title:
            entry['title'] = str(title)[:140]
        items.append(entry)

    # All queries are explicitly tenant-scoped. No writes, sessions or audit calls.
    identifier_values = [source_id, departing['_id']]
    project_query = {'tenant_id':tenant, 'is_deleted':{'$ne':True}, '$or':[
        *[{key:{'$in':identifier_values}} for key in PROJECT_FIELDS + PROJECT_ARRAYS + PROJECT_REPORT_FIELDS],
        *[{field:{'$in':identifier_values}} for field in (
            'assigned_members.employee_id','assigned_members._id','assigned_members.id',
            'collaborators.employee_id','collaborators._id','collaborators.id')],
    ]}
    project_projection = {'_id':1,'name':1,'project_name':1,'title':1,'status':1,
        **{k:1 for k in PROJECT_FIELDS + PROJECT_ARRAYS + MEMBER_ARRAYS + PROJECT_REPORT_FIELDS}}
    projects = list(db.projects.find(project_query, project_projection).limit(1001))
    if len(projects) > 1000:
        capped_collections.append('projects')
    for project in projects[:1000]:
        kinds = project_responsibilities(project, source_id)
        if not kinds:
            continue
        state = str(project.get('status') or '').strip().lower().replace('-', '_')
        if state in {'completed','complete','done','closed','inactive','cancelled','canceled'}:
            classification, reason = 'excluded', 'Completed or closed project; historical attribution preserved'
        elif state in {'active','ongoing','in_progress','open','on_hold','hold'}:
            classification, reason = 'eligible', 'Potential operational candidate; no transfer performed'
        else:
            classification, reason = 'manual_review', 'Project status is unknown or missing; review required'
        for kind in kinds:
            item_classification = 'manual_review' if kind == 'project_reporting_role' and classification != 'excluded' else classification
            item_reason = 'Project-level TL/RO authority requires HR review' if kind == 'project_reporting_role' and classification != 'excluded' else reason
            add('project', kind, item_classification, project['_id'], item_reason, project.get('name') or project.get('project_name') or project.get('title'))

    # Reporting hierarchy is always manual; changing employee relations alters active approvals.
    people = list(db.employees.find({'tenant_id':tenant,'is_deleted':{'$ne':True}, '$or':[{f:{'$in':identifier_values}} for f in REPORT_FIELDS]}, {'_id':1,**{f:1 for f in REPORT_FIELDS}}).limit(1001))
    if len(people) > 1000:
        capped_collections.append('reporting_relationships')
    for person in people[:1000]:
        for field in REPORT_FIELDS:
            if _matches(person.get(field), source_id):
                add('reporting_relationship', field, 'manual_review', person['_id'], 'HR must validate replacement authority and reporting structure')

    items.sort(key=lambda x:(x['category'],x['record_id'],x['kind']))
    summary = {kind:sum(x['classification']==kind for x in items) for kind in ('eligible','manual_review','excluded')}
    return {'status':'preview', 'departing_employee':{'employee_id':source_id},
            'replacement_employee':{'employee_id':target_id}, 'summary':summary,
            'items':items,'execution_performed':False,
            'notice_period_activated':False,
            'is_partial':bool(capped_collections),
            'capped_collections':capped_collections,
            'limitations':['Preview only; project/role eligibility must be revalidated before any future execution',
                           'Historical ownership and private records are not transferred',
                           'Results capped at 1000 per collection; large tenants require review']}
