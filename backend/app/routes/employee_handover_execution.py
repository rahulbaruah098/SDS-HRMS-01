"""Explicit HR-authorized handover of a narrow, canonical project assignment.

Never rewrites historical work, approvals, or private employee data.
"""
from datetime import datetime, timezone
from bson import ObjectId
from flask import Blueprint, jsonify, request, g, current_app
from app.extensions import get_db
from app.routes.employee_handover import _read_only_authenticated, _ALLOWED
from app.services.handover_preview import preview, project_responsibilities

handover_execution_bp = Blueprint('employee_handover_execution', __name__)
ACTIVE = {'active', 'ongoing', 'in_progress', 'open', 'on_hold', 'hold'}


def _err(message, status):
    return jsonify({'message':message}), status


@handover_execution_bp.route('/execute', methods=['POST'])
@_read_only_authenticated
def execute():
    user = g.current_user or {}
    if not set(user.get('roles') or []).intersection(_ALLOWED):
        return _err('HR/Admin role required', 403)
    tenant = user.get('tenant_id')
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get('confirmation') != 'TRANSFER':
        return _err('Explicit TRANSFER confirmation required', 400)
    source, target = data.get('departing_employee_id'), data.get('replacement_employee_id')
    selection = data.get('items')
    if not all(isinstance(x,str) and ObjectId.is_valid(x) for x in (source,target)) or source == target:
        return _err('Valid distinct employee IDs required', 400)
    if not isinstance(selection,list) or not 1 <= len(selection) <= 50:
        return _err('Select between 1 and 50 project responsibilities', 400)
    allowed_kinds = {'primary_assignment', 'assigned_membership', 'collaborator_membership'}
    normalized = []
    for item in selection:
        if not isinstance(item,dict) or item.get('kind') not in allowed_kinds or not isinstance(item.get('record_id'),str) or not ObjectId.is_valid(item['record_id']):
            return _err('Only supported project responsibilities may be transferred', 400)
        pair = (item['record_id'],item['kind'])
        if pair in normalized:
            return _err('Duplicate responsibility selected', 400)
        normalized.append(pair)
    db = get_db()
    projection = {'_id':1,'tenant_id':1,'is_deleted':1,'is_active':1,'active':1,'is_alumni':1,'status':1,'employment_status':1,'employee_status':1,'notice_status':1,'last_working_day':1,'last_working_date':1,'name':1,'employee_name':1,'employee_code':1,'email':1,'phone':1,'department':1,'designation':1,'user_id':1}
    departing = db.employees.find_one({'_id':ObjectId(source),'tenant_id':tenant,'is_deleted':{'$ne':True}},projection)
    replacement = db.employees.find_one({'_id':ObjectId(target),'tenant_id':tenant,'is_deleted':{'$ne':True}},projection)
    if not departing or not replacement:
        return _err('Employee not found in this company',404)
    # Reuse preview eligibility checks at execution time. No preview writes.
    try:
        from app.services.handover_preview import employee_exiting
        from app.services.active_employee_scope import employee_is_active
        if not employee_exiting(departing) or not employee_is_active(replacement):
            return _err('Employee exit/replacement eligibility changed; refresh preview',409)
    except Exception:
        current_app.logger.exception('Handover eligibility verification failed')
        return _err('Unable to validate employee eligibility',500)
    # Canonical string-based project fields are updated with compare-and-set;
    # unknown legacy fields remain review-only.
    results = []
    replacement_name = str(replacement.get('name') or replacement.get('employee_name') or 'Employee')

    def replace_members(members, kind, is_primary=False):
        if not isinstance(members, list) or not all(isinstance(m,dict) and isinstance(m.get('employee_id'),str) for m in members):
            return None
        new_members = []
        seen = set()
        for member in members:
            mid = member['employee_id']
            if mid == source:
                mid = target
                updated = dict(member)
                updated['employee_id'] = target
                for prop, replacement_prop in [('employee_name','name'),('name','name'),('display_name','name'),('employee_code','employee_code'),('email','email'),('phone','phone'),('department','department'),('designation','designation'),('user_id','user_id')]:
                    updated[prop] = replacement_name if replacement_prop == 'name' else replacement.get(replacement_prop, '')
                for prop in ('avatar','profile_photo','profile_picture','photo'):
                    updated[prop] = ''
            else:
                updated = dict(member)
            if mid in seen:
                continue
            seen.add(mid)
            if is_primary:
                updated['is_primary_assignee'] = mid == target if member['employee_id'] == source else bool(member.get('is_primary_assignee'))
                if mid == target:
                    updated['responsibility'] = 'primary'
            new_members.append(updated)
        return new_members

    for project_id,kind in normalized:
        project = db.projects.find_one({'_id':ObjectId(project_id),'tenant_id':tenant,'is_deleted':{'$ne':True}})
        if not project:
            results.append({'record_id':project_id,'kind':kind,'status':'skipped','reason':'Project missing'});continue
        status = str(project.get('status') or '').lower().replace('-','_')
        if status not in ACTIVE or kind not in project_responsibilities(project,source):
            results.append({'record_id':project_id,'kind':kind,'status':'skipped','reason':'Assignment or status changed'});continue
        # Defer complex embedded/member document schemas to their own business workflows.
        ids = project.get('assigned_employee_ids')
        collabs = project.get('collaborator_ids')
        if kind == 'primary_assignment':
            if project.get('assigned_to_id') != source or project.get('primary_assignee_id',source) != source or not isinstance(ids,list) or source not in ids or any(not isinstance(x,str) for x in ids):
                results.append({'record_id':project_id,'kind':kind,'status':'manual_review','reason':'Non-canonical primary/team assignment'});continue
            changed = [target if x==source else x for x in ids]
            changed = list(dict.fromkeys(changed))
            update_fields = {'assigned_to_id':target,'primary_assignee_id':target,'doing_person_id':target,'assigned_employee_ids':changed,
                             'assigned_to_name':replacement_name,'primary_assignee_name':replacement_name,'doing_person_name':replacement_name}
            guards = {'assigned_to_id':source,'assigned_employee_ids':ids}
            if 'assigned_members' in project:
                members = replace_members(project['assigned_members'], 'assigned_member', is_primary=True)
                if members is None or (project['assigned_members'] and not any(str(m.get('employee_id')) == source for m in project['assigned_members'])):
                    results.append({'record_id':project_id,'kind':kind,'status':'manual_review','reason':'Unrecognized embedded members'});continue
                update_fields['assigned_members'] = members
                guards['assigned_members'] = project['assigned_members']
            if 'primary_assignee_id' in project:guards['primary_assignee_id']=source
        elif kind == 'collaborator_membership':
            if not isinstance(collabs,list) or source not in collabs or any(not isinstance(x,str) for x in collabs):
                results.append({'record_id':project_id,'kind':kind,'status':'manual_review','reason':'Embedded/non-canonical collaborator data'});continue
            update_fields = {'collaborator_ids':list(dict.fromkeys(target if x==source else x for x in collabs))}
            guards = {'collaborator_ids':collabs}
            if 'collaborators' in project:
                members = replace_members(project['collaborators'], 'collaborator')
                if members is None or (project['collaborators'] and not any(str(m.get('employee_id')) == source for m in project['collaborators'])):
                    results.append({'record_id':project_id,'kind':kind,'status':'manual_review','reason':'Unrecognized embedded collaborators'});continue
                update_fields['collaborators'] = members
                guards['collaborators'] = project['collaborators']
        else:
            if not isinstance(ids,list) or source not in ids or any(not isinstance(x,str) for x in ids):
                results.append({'record_id':project_id,'kind':kind,'status':'manual_review','reason':'Embedded/non-canonical membership'});continue
            if project.get('assigned_to_id') == source or project.get('primary_assignee_id') == source:
                results.append({'record_id':project_id,'kind':kind,'status':'manual_review','reason':'Primary assignment must be transferred first'});continue
            update_fields={'assigned_employee_ids':list(dict.fromkeys(target if x==source else x for x in ids))}
            guards={'assigned_employee_ids':ids}
            if 'assigned_members' in project:
                members=replace_members(project['assigned_members'],'assigned_member')
                if members is None or (project['assigned_members'] and not any(str(m.get('employee_id')) == source for m in project['assigned_members'])):
                    results.append({'record_id':project_id,'kind':kind,'status':'manual_review','reason':'Unrecognized embedded members'});continue
                update_fields['assigned_members']=members
                guards['assigned_members']=project['assigned_members']
        # Compare-and-set the original state; concurrent HR modifications cause skip.
        filt={'_id':project['_id'],'tenant_id':tenant,'is_deleted':{'$ne':True},'status':project.get('status'),**guards}
        if 'assignment_version' in project:filt['assignment_version']=project['assignment_version']
        else:filt['assignment_version']={'$exists':False}
        next_version=int(project.get('assignment_version') or 0)+1
        operation_id=ObjectId()
        update_fields.update({'assignment_version':next_version,'updated_at':datetime.now(timezone.utc),'updated_by':str(user.get('_id')),'last_handover_operation_id':str(operation_id)})
        try:
            written=db.projects.update_one(filt,{'$set':update_fields})
            if written.modified_count!=1:
                results.append({'record_id':project_id,'kind':kind,'status':'skipped','reason':'Concurrent change; refresh preview'});continue
            # Audit an actual successful assignment change, never an inferred one.
            db.employee_handover_history.insert_one({'_id':operation_id,'tenant_id':tenant,'project_id':project_id,'kind':kind,'departing_employee_id':source,'replacement_employee_id':target,'authorized_by':str(user.get('_id')),'before':{k:project.get(k) for k in guards},'after':{k:update_fields.get(k) for k in guards if k in update_fields},'created_at':datetime.now(timezone.utc)})
            results.append({'record_id':project_id,'kind':kind,'status':'transferred'})
        except Exception:
            current_app.logger.exception('Handover project update/audit failed')
            results.append({'record_id':project_id,'kind':kind,'status':'needs_reconciliation','reason':'Operation status uncertain; inspect audit and project before retrying'})
            break  # do not continue after uncertain persistence
    transferred=sum(r['status']=='transferred' for r in results)
    return jsonify({'status':'completed' if transferred==len(normalized) else 'partial','transferred':transferred,'requested':len(normalized),'results':results,'manual_review_required':True}), (200 if transferred==len(normalized) else 207)


@handover_execution_bp.route('/history', methods=['GET'])
@_read_only_authenticated
def handover_history():
    """Tenant-scoped read-only history of successful transfers made by this module.

    This is intentionally distinct from older project assignment history.
    """
    user = g.current_user or {}
    if not set(user.get('roles') or []).intersection(_ALLOWED):
        return _err('HR/Admin role required', 403)
    tenant = user.get('tenant_id')
    if not tenant:
        return _err('Company context required', 403)
    source = (request.args.get('departing_employee_id') or '').strip()
    if source and not ObjectId.is_valid(source):
        return _err('Invalid departing employee ID', 400)
    query = {'tenant_id': tenant}
    if source:
        query['departing_employee_id'] = source
    try:
        db = get_db()
        projection = {'_id': 1, 'project_id': 1, 'kind': 1,
                      'departing_employee_id': 1, 'replacement_employee_id': 1,
                      'authorized_by': 1, 'created_at': 1, 'subject_employee_id': 1}
        docs = list(db.employee_handover_history.find(query, projection)
                    .sort('created_at', -1).limit(101))
        partial = len(docs) > 100
        docs = docs[:100]
        # Enrich identifiers from tenant-scoped records, without exposing private fields.
        employees = {}
        projects = {}
        for row in docs:
            for employee_id in (row.get('departing_employee_id'), row.get('replacement_employee_id'), row.get('subject_employee_id')):
                if employee_id and str(employee_id) not in employees:
                    name = ''
                    if ObjectId.is_valid(str(employee_id)):
                        employee = db.employees.find_one({'_id': ObjectId(str(employee_id)), 'tenant_id': tenant},
                                                         {'name': 1, 'employee_name': 1, 'full_name': 1, 'employee_code': 1})
                        if employee:
                            name = str(employee.get('name') or employee.get('employee_name') or employee.get('full_name') or employee.get('employee_code') or '')
                    employees[str(employee_id)] = name
            project_id = str(row.get('project_id') or '')
            if project_id and project_id not in projects:
                name = ''
                if ObjectId.is_valid(project_id):
                    project = db.projects.find_one({'_id': ObjectId(project_id), 'tenant_id': tenant},
                                                   {'name': 1, 'title': 1, 'project_name': 1})
                    if project:
                        name = str(project.get('name') or project.get('title') or project.get('project_name') or '')
                projects[project_id] = name
        # Resolve the authorizing account from this tenant only. Audit IDs remain
        # in the response for traceability, but the UI can show a readable name.
        actors = {}
        for row in docs:
            actor_id = str(row.get('authorized_by') or '')
            if actor_id in actors:
                continue
            name = ''
            if actor_id and ObjectId.is_valid(actor_id):
                account = db.users.find_one(
                    {'_id': ObjectId(actor_id), 'tenant_id': tenant},
                    {'full_name': 1, 'name': 1, 'display_name': 1,
                     'first_name': 1, 'last_name': 1, 'employee_id': 1})
                if account:
                    name = str(account.get('full_name') or account.get('name') or
                               account.get('display_name') or '').strip()
                    if not name:
                        name = ' '.join(str(account.get(k) or '').strip()
                                        for k in ('first_name', 'last_name')).strip()
                    # Some user rows store the employee link rather than a name.
                    linked = str(account.get('employee_id') or '')
                    if not name and linked and ObjectId.is_valid(linked):
                        employee = db.employees.find_one(
                            {'_id': ObjectId(linked), 'tenant_id': tenant},
                            {'name': 1, 'employee_name': 1, 'full_name': 1})
                        if employee:
                            name = str(employee.get('name') or
                                       employee.get('employee_name') or
                                       employee.get('full_name') or '').strip()
            actors[actor_id] = name
        items = []
        for row in docs:
            source_id = str(row.get('departing_employee_id') or '')
            target_id = str(row.get('replacement_employee_id') or '')
            project_id = str(row.get('project_id') or '')
            time = row.get('created_at')
            items.append({'id': str(row['_id']), 'project_id': project_id,
                          'project_name': projects.get(project_id) or employees.get(str(row.get('subject_employee_id') or '')) or ('Project reporting responsibility' if project_id else 'Employee reporting relationship'),
                          'kind': str(row.get('kind') or ''),
                          'departing_employee_id': source_id,
                          'departing_employee_name': employees.get(source_id) or '',
                          'replacement_employee_id': target_id,
                          'replacement_employee_name': employees.get(target_id) or '',
                          'performed_by_id': str(row.get('authorized_by') or ''),
                          'performed_by_name': actors.get(str(row.get('authorized_by') or '')) or '',
                          'created_at': time.isoformat() if hasattr(time, 'isoformat') else None,
                          'status': 'transferred'})
        return jsonify({'items': items, 'is_partial': partial,
                        'scope': 'employee_handover_history', 'limit': 100})
    except Exception:
        current_app.logger.exception('Unable to load employee handover history')
        return _err('Unable to load handover history', 500)
