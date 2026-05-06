
from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime
from werkzeug.security import generate_password_hash
from app.extensions import get_db
from app.utils.auth import current_user_required, audit
from app.utils.serializers import clean_doc

crud_bp=Blueprint('crud',__name__)
COLLECTIONS={
'employees':['name','email','emp_code','department','designation'],
'departments':['name'],
'designations':['title'],
'projects':['name'],
'states':['name'],
'leave_types':['name'],
'leave_requests':['employee_name','leave_type','status'],
'payroll_runs':['month','status'],
'payslips':['employee_name','month'],
'job_openings':['title','department','status'],
'candidates':['name','email','status'],
'trainings':['name','trainer','venue'],
'performance_reviews':['employee_name','cycle','reviewer_name','reviewer_role','status'],
'expenses':['employee_name','type','status'],
'assets':['name','type','serial_no','status'],
'tickets':['title','category','status','priority'],
'notifications':['title','body'],
'policies':['title','category'],
'documents':['title','doc_type'],
'system_settings':['setting_group','setting_key'],
'audit_logs':['action','entity','actor_email']
}

def search(q,fields):
    return {'$or':[{f:{'$regex':q,'$options':'i'}} for f in fields]} if q else {}


def sync_employee_roles(db, employee_doc):
    """
    If HR/Admin changes an employee as Team Leader or Reporting Officer,
    sync that status into the user's roles also.
    """
    user_id = employee_doc.get('user_id')
    if not user_id:
        return

    user = db.users.find_one({'_id': ObjectId(user_id)})
    if not user:
        return

    roles = set(user.get('roles', []))

    is_team_leader = str(employee_doc.get('is_team_leader', '')).lower() in ['true', 'yes', '1']
    is_reporting_officer = str(employee_doc.get('is_reporting_officer', '')).lower() in ['true', 'yes', '1']

    if is_team_leader:
        roles.add('team_leader')
    else:
        roles.discard('team_leader')

    if is_reporting_officer:
        roles.add('reporting_officer')
    else:
        roles.discard('reporting_officer')

    # Every employee user should keep employee role unless it is a platform/company admin account
    if not roles.intersection({'super_admin', 'admin', 'hr_manager', 'hr', 'accounts_finance'}):
        roles.add('employee')

    db.users.update_one(
        {'_id': ObjectId(user_id)},
        {'$set': {'roles': list(roles), 'updated_at': datetime.utcnow()}}
    )

def scoped_query():
    roles=set(g.current_user.get('roles',[]))
    tenant_arg=(request.args.get('tenant_id') or '').strip()
    if 'super_admin' in roles:
        return {'tenant_id':tenant_arg} if tenant_arg else {}
    return {'tenant_id':g.tenant_id}

@crud_bp.get('/<collection>')
@current_user_required
def list_items(collection):
    if collection not in COLLECTIONS: return jsonify({'message':'Unknown module'}),404
    db=get_db(); q=scoped_query(); q.update(search(request.args.get('q','').strip(),COLLECTIONS[collection]))
    roles=set(g.current_user.get('roles',[]))
    if roles=={'employee'}:
        emp=db.employees.find_one({'tenant_id':g.tenant_id,'user_id':str(g.current_user['_id'])}); eid=str(emp['_id']) if emp else '__none__'
        if collection in ['leave_requests','payslips','performance_reviews','expenses']: q['employee_id']=eid
        if collection=='tickets': q['raised_by']=eid
        if collection=='notifications': q['user_id']=str(g.current_user['_id'])
    return jsonify({'items':clean_doc(list(db[collection].find(q).sort('created_at',-1).limit(500)))})

@crud_bp.post('/<collection>')
@current_user_required
def create_item(collection):
    if collection not in COLLECTIONS: return jsonify({'message':'Unknown module'}),404
    db=get_db(); roles=set(g.current_user.get('roles',[])); data=request.get_json(silent=True) or {}; data.pop('_id',None); now=datetime.utcnow()
    tenant_id=data.get('tenant_id') if 'super_admin' in roles and data.get('tenant_id') else g.tenant_id
    if tenant_id=='platform': tenant_id='sds'
    data.update({'tenant_id':tenant_id,'created_at':now,'updated_at':now,'created_by':str(g.current_user['_id'])})
    if 'status' not in data: data['status']='active'
    res = db[collection].insert_one(data)

    if collection == 'employees':
        created_employee = db.employees.find_one({'_id': res.inserted_id})
    if created_employee:
        sync_employee_roles(db, created_employee)

    audit('create', collection, res.inserted_id, data)
    
    
    return jsonify({'message':'Created','item':clean_doc(db[collection].find_one({'_id':res.inserted_id}))}),201

@crud_bp.patch('/<collection>/<item_id>')
@current_user_required
def update_item(collection,item_id):
    if collection not in COLLECTIONS: return jsonify({'message':'Unknown module'}),404
    db=get_db(); roles=set(g.current_user.get('roles',[])); data=request.get_json(silent=True) or {}; data.pop('_id',None); data.update({'updated_at':datetime.utcnow(),'updated_by':str(g.current_user['_id'])})
    q={'_id':ObjectId(item_id)}
    if 'super_admin' not in roles: q['tenant_id']=g.tenant_id
    db[collection].update_one(q, {'$set': data})

    if collection == 'employees':
        updated_employee = db.employees.find_one({'_id': ObjectId(item_id)})
    if updated_employee:
        sync_employee_roles(db, updated_employee)

    audit('update', collection, item_id, data)
    return jsonify({'message':'Updated','item':clean_doc(db[collection].find_one({'_id':ObjectId(item_id)}))})

@crud_bp.delete('/<collection>/<item_id>')
@current_user_required
def delete_item(collection,item_id):
    if collection not in COLLECTIONS: return jsonify({'message':'Unknown module'}),404
    db=get_db(); roles=set(g.current_user.get('roles',[])); q={'_id':ObjectId(item_id)}
    if 'super_admin' not in roles: q['tenant_id']=g.tenant_id
    db[collection].update_one(q,{'$set':{'status':'inactive','is_deleted':True,'updated_at':datetime.utcnow()}}); audit('soft_delete',collection,item_id)
    return jsonify({'message':'Deleted'})
