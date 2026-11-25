"""Tenant-scoped operational manager handovers and explicit review tracking.

Role changes use existing HR mapping validators and compare-and-set guards.
"""
from datetime import datetime, timezone
from bson import ObjectId
from flask import Blueprint, jsonify, request, g, current_app
from app.extensions import get_db
from app.routes.employee_handover import _read_only_authenticated, _ALLOWED
from app.services.handover_preview import employee_exiting
from app.services.active_employee_scope import employee_is_active

advanced_handover_bp = Blueprint('advanced_handover', __name__)
KINDS = {'team_leader_id', 'reporting_officer_id', 'project_team_leader', 'project_reporting_officer'}
ACTIVE_STATES = {'active','ongoing','in_progress','open','on_hold','hold'}


def err(message, status):
    return jsonify({'message': message}), status


def _input():
    data = request.get_json(silent=True) if request.method == 'POST' else request.args
    if not data or not isinstance(data, dict) and request.method == 'POST':
        return None, err('Provide employee IDs', 400)
    source, target = data.get('departing_employee_id'), data.get('replacement_employee_id')
    if not all(isinstance(x, str) and ObjectId.is_valid(x) for x in (source, target)) or source == target:
        return None, err('Two different valid employees must be selected', 400)
    user = g.current_user or {}
    if not set(user.get('roles') or []).intersection(_ALLOWED):
        return None, err('HR/Admin role required', 403)
    tenant = user.get('tenant_id')
    if not tenant:
        return None, err('Company context required', 403)
    db = get_db()
    fields = {'_id':1, 'tenant_id':1, 'is_deleted':1, 'status':1, 'is_active':1, 'active':1,
              'employment_status':1, 'employee_status':1, 'is_alumni':1, 'notice_status':1,
              'last_working_day':1, 'name':1, 'employee_name':1, 'is_team_leader':1,
              'is_reporting_officer':1, 'role':1, 'roles':1, 'designation':1,
              'designation_name':1, 'title':1, 'position':1, 'team_leader_id':1, 'reporting_officer_id':1}
    source_doc = db.employees.find_one({'_id':ObjectId(source), 'tenant_id':tenant, 'is_deleted':{'$ne':True}}, fields)
    target_doc = db.employees.find_one({'_id':ObjectId(target), 'tenant_id':tenant, 'is_deleted':{'$ne':True}}, fields)
    if not source_doc or not target_doc:
        return None, err('Employee not found in this company', 404)
    if not employee_exiting(source_doc) or not employee_is_active(target_doc):
        return None, err('Departure or replacement eligibility changed', 409)
    from app.routes.crud import employee_is_team_leader, employee_is_reporting_officer, reporting_officer_designation_allowed
    eligible = {
        'team_leader_id': bool(employee_is_team_leader(target_doc)),
        'reporting_officer_id': bool(employee_is_reporting_officer(target_doc) or reporting_officer_designation_allowed(target_doc))
    }
    return (db, tenant, source, target, source_doc, target_doc, eligible), None


def _discover(ctx):
    db, tenant, source, target, _, target_doc, eligible = ctx
    items=[]
    limits=[]
    def add(category, kind, rec, title, status, reason):
        items.append({'category':category,'kind':kind,'record_id':str(rec),'title':str(title)[:140],
                      'classification':status,'reason':reason})
    source_ids = [source, ObjectId(source)]
    q={'tenant_id':tenant,'is_deleted':{'$ne':True},'status':{'$nin':['resigned','terminated','retired','left']},'$or':[
        {'team_leader_id':{'$in':source_ids}}, {'reporting_officer_id':{'$in':source_ids}}]}
    people=list(db.employees.find(q, {'_id':1,'name':1,'employee_name':1,'team_leader_id':1,'reporting_officer_id':1}).limit(501))
    if len(people)>500:limits.append('employee_reporting')
    for person in people[:500]:
        for field in ('team_leader_id','reporting_officer_id'):
            if str(person.get(field) or '') != source:continue
            is_ok=eligible[field] and str(person['_id'])!=target and isinstance(person.get(field),str) and str(target_doc.get(field) or '') != str(person['_id'])
            add('reporting',field,person['_id'],person.get('name') or person.get('employee_name') or 'Employee',
                'eligible' if is_ok else 'manual_review',
                'Change active reporting relationship after explicit HR approval' if is_ok else 'Replacement lacks required leadership eligibility or would report to themselves')
    pq={'tenant_id':tenant,'is_deleted':{'$ne':True},'$or':[{'team_leader_id':{'$in':source_ids}}, {'reporting_officer_id':{'$in':source_ids}}]}
    projects=list(db.projects.find(pq,{'_id':1,'name':1,'project_name':1,'title':1,'status':1,'team_leader_id':1,'reporting_officer_id':1}).limit(501))
    if len(projects)>500:limits.append('project_roles')
    for project in projects[:500]:
        state=str(project.get('status') or '').lower().replace('-','_')
        for field,kind in (('team_leader_id','project_team_leader'),('reporting_officer_id','project_reporting_officer')):
            if str(project.get(field) or '')!=source:continue
            is_ok=state in ACTIVE_STATES and eligible[field] and isinstance(project.get(field),str)
            add('project_role',kind,project['_id'],project.get('name') or project.get('project_name') or project.get('title') or 'Project',
                'eligible' if is_ok else 'manual_review',
                'Active role can be handed over with HR approval' if is_ok else 'Closed/unknown project or replacement role not eligible')
    items.sort(key=lambda row:(row['category'],row['title'],row['kind'],row['record_id']))
    return {'items':items,'summary':{c:sum(i['classification']==c for i in items) for c in ('eligible','manual_review','excluded')},
            'is_partial':bool(limits),'capped_collections':limits}


@advanced_handover_bp.route('/advanced/preview',methods=['POST'])
@_read_only_authenticated
def advanced_preview():
    ctx,error=_input()
    if error:return error
    try:
        return jsonify({**_discover(ctx),'execution_performed':False}),200
    except Exception:
        current_app.logger.exception('Advanced handover preview failed')
        return err('Unable to load advanced responsibilities',500)


@advanced_handover_bp.route('/advanced/execute',methods=['POST'])
@_read_only_authenticated
def advanced_execute():
    ctx,error=_input()
    if error:return error
    data=request.get_json(silent=True)
    selected=data.get('items')
    if data.get('confirmation')!='TRANSFER' or not isinstance(selected,list) or not 1<=len(selected)<=50:
        return err('Select 1–50 items and type TRANSFER to confirm',400)
    keys=[]
    for item in selected:
        if not isinstance(item,dict) or item.get('kind') not in KINDS or not isinstance(item.get('record_id'),str) or not ObjectId.is_valid(item['record_id']):
            return err('Unsupported responsibility selection',400)
        pair=(item['kind'],item['record_id'])
        if pair in keys:return err('Duplicate responsibility',400)
        keys.append(pair)
    db,tenant,source,target,_,target_doc,eligible=ctx
    if len(_discover(ctx)['items']) > 3000:
        return err('Large handover requires manual review',409)
    from app.services import team_responsibility as responsibility
    succession = db.team_successions.find_one({'tenant_id': tenant, 'source_employee_id': source})
    if succession and any(kind in {'team_leader_id', 'project_team_leader'} for kind, _ in keys):
        return err('Use Team Leader succession to assign this vacant team as one handover.', 409)
    display_name=str(target_doc.get('name') or target_doc.get('employee_name') or 'Employee')
    results=[]
    for kind,rec_id in keys:
        field = {'project_team_leader':'team_leader_id','project_reporting_officer':'reporting_officer_id'}.get(kind,kind)
        if not eligible[field]:
            results.append({'kind':kind,'record_id':rec_id,'status':'skipped','reason':'Replacement does not have required leadership role'});continue
        is_project=kind.startswith('project_')
        collection=db.projects if is_project else db.employees
        filt={'_id':ObjectId(rec_id),'tenant_id':tenant,'is_deleted':{'$ne':True},field:source}
        if not is_project and rec_id==target:
            results.append({'kind':kind,'record_id':rec_id,'status':'skipped','reason':'Cannot assign employee to themselves'});continue
        doc=collection.find_one(filt,{'_id':1,'status':1,field:1,field.replace('_id','_name'):1})
        if not doc:
            results.append({'kind':kind,'record_id':rec_id,'status':'skipped','reason':'Record changed or was removed'});continue
        if is_project:
            if str(doc.get('status') or '').lower().replace('-','_') not in ACTIVE_STATES:
                results.append({'kind':kind,'record_id':rec_id,'status':'skipped','reason':'Project is not active'});continue
            filt['status']=doc.get('status')
        else:
            filt['status']=doc.get('status') if 'status' in doc else {'$exists':False}
        now=datetime.now(timezone.utc)
        audit_id=ObjectId()
        updates={field:target,field.replace('_id','_name'):display_name,'updated_at':now,'updated_by':str(g.current_user['_id']),'last_handover_operation_id':str(audit_id)}
        # CAS: require original relationship and current status. No whole-document replacement.
        try:
            changed=collection.update_one(filt,{'$set':updates})
            if changed.modified_count != 1:
                results.append({'kind':kind,'record_id':rec_id,'status':'skipped','reason':'Concurrent change; refresh preview'});continue
            db.employee_handover_history.insert_one({'_id':audit_id,'tenant_id':tenant,'project_id':rec_id if is_project else None,
                'subject_employee_id':None if is_project else rec_id,'kind':kind,
                'departing_employee_id':source,'replacement_employee_id':target,'authorized_by':str(g.current_user['_id']),
                'before':{field:source},'after':{field:target},'created_at':now})
            results.append({'kind':kind,'record_id':rec_id,'status':'transferred'})
        except Exception:
            current_app.logger.exception('Advanced handover update/audit failed')
            results.append({'kind':kind,'record_id':rec_id,'status':'needs_reconciliation','reason':'Status uncertain; inspect records before retrying'})
            break
    transferred=sum(r['status']=='transferred' for r in results)
    return jsonify({'status':'completed' if transferred==len(keys) else 'partial','transferred':transferred,'requested':len(keys),'results':results}), (200 if transferred==len(keys) else 207)
