
from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime
from werkzeug.security import generate_password_hash
from app.extensions import get_db
from app.utils.auth import roles_required, audit
from app.utils.serializers import clean_doc

superadmin_bp = Blueprint('superadmin', __name__)

DEFAULT_DEPARTMENTS = ['HR & Admin','Finance & Accounts','Research & Development','Operations','MIS','IT']
DEFAULT_DESIGNATIONS = ['Managing Director','Director','General Manager','Manager','Executive','Associate','Assistant']
DEFAULT_STATES = ['Assam','Arunachal Pradesh','Manipur','Mizoram','Tripura']
DEFAULT_PROJECTS = ['SFAC','NCDC','NFDB','NAFED','NABARD','TRLM FISHERY','TRESP','NEDFi CDAP']

def now():
    return datetime.utcnow()

def slugify(value):
    raw = ''.join(ch.lower() if ch.isalnum() else '-' for ch in (value or '').strip())
    raw = '-'.join([p for p in raw.split('-') if p])
    return raw or 'tenant'


def truthy(value):
    return str(value).lower() in ["true", "yes", "1", "on"]


def resolve_employee_name(db, tenant_id, emp_id):
    if not emp_id:
        return ""

    try:
        emp = db.employees.find_one({
            "_id": ObjectId(emp_id),
            "tenant_id": tenant_id,
            "status": {"$ne": "Inactive"},
        })
    except Exception:
        emp = None

    return emp.get("name", "") if emp else ""


def sync_employee_roles(db, employee_doc):
    user_id = employee_doc.get("user_id")

    if not user_id:
        return

    try:
        user = db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        return

    if not user:
        return

    roles = set(user.get("roles", []))

    if truthy(employee_doc.get("is_team_leader")):
        roles.add("team_leader")
    else:
        roles.discard("team_leader")

    if truthy(employee_doc.get("is_reporting_officer")):
        roles.add("reporting_officer")
    else:
        roles.discard("reporting_officer")

    if not roles.intersection({"super_admin", "admin", "hr_manager", "hr", "accounts_finance"}):
        roles.add("employee")

    db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"roles": list(roles), "updated_at": now()}},
    )

def seed_company_masters(db, tenant_id):
    for name in DEFAULT_DEPARTMENTS:
        db.departments.update_one({'tenant_id':tenant_id,'name':name},{'$setOnInsert':{'tenant_id':tenant_id,'name':name,'status':'active','created_at':now()}},upsert=True)
    for title in DEFAULT_DESIGNATIONS:
        db.designations.update_one({'tenant_id':tenant_id,'title':title},{'$setOnInsert':{'tenant_id':tenant_id,'title':title,'status':'active','created_at':now()}},upsert=True)
    for name in DEFAULT_STATES:
        db.states.update_one({'tenant_id':tenant_id,'name':name},{'$setOnInsert':{'tenant_id':tenant_id,'name':name,'status':'active','created_at':now()}},upsert=True)
    for name in DEFAULT_PROJECTS:
        db.projects.update_one({'tenant_id':tenant_id,'name':name},{'$setOnInsert':{'tenant_id':tenant_id,'name':name,'status':'active','created_at':now()}},upsert=True)
    for name,days in [('Casual Leave',12),('Sick Leave',12),('Earned Leave',18),('Comp-Off',0)]:
        db.leave_types.update_one({'tenant_id':tenant_id,'name':name},{'$setOnInsert':{'tenant_id':tenant_id,'name':name,'days_per_year':days,'carry_forward':name=='Earned Leave','status':'active','created_at':now()}},upsert=True)
    db.system_settings.update_one({'tenant_id':tenant_id,'setting_group':'attendance','setting_key':'late_cutoff'},{'$setOnInsert':{'tenant_id':tenant_id,'setting_group':'attendance','setting_key':'late_cutoff','setting_value':'09:45','created_at':now()}},upsert=True)

@superadmin_bp.get('/companies')
@roles_required('super_admin')
def list_companies():
    db=get_db(); q={}
    search=(request.args.get('q') or '').strip()
    if search:
        q={'$or':[{'name':{'$regex':search,'$options':'i'}},{'tenant_id':{'$regex':search,'$options':'i'}},{'domain':{'$regex':search,'$options':'i'}}]}
    rows=list(db.tenants.find(q).sort('created_at',-1).limit(500))
    for row in rows:
        row['employee_count']=db.employees.count_documents({'tenant_id':row.get('tenant_id'),'status':{'$ne':'Inactive'}})
        row['user_count']=db.users.count_documents({'tenant_id':row.get('tenant_id')})
    return jsonify({'items':clean_doc(rows)})

@superadmin_bp.post('/companies')
@roles_required('super_admin')
def create_company():
    db=get_db(); data=request.get_json(silent=True) or {}
    name=(data.get('name') or '').strip()
    if not name: return jsonify({'message':'Company name is required'}),400
    tenant_id=(data.get('tenant_id') or slugify(name)).strip().lower()
    if db.tenants.find_one({'tenant_id':tenant_id}): return jsonify({'message':'Company / tenant_id already exists'}),409
    doc={'tenant_id':tenant_id,'name':name,'domain':(data.get('domain') or '').strip(),'contact_email':(data.get('contact_email') or '').strip().lower(),'contact_phone':(data.get('contact_phone') or '').strip(),'address':data.get('address',''),'status':'active','plan':data.get('plan','Internal / Trial'),'created_at':now(),'created_by':str(g.current_user['_id'])}
    db.tenants.insert_one(doc)
    seed_company_masters(db,tenant_id)
    admin_email=(data.get('admin_email') or '').strip().lower()
    admin_password=data.get('admin_password') or 'Admin@123'
    admin_name=(data.get('admin_name') or f'{name} Admin').strip()
    if admin_email:
        if db.users.find_one({'email':admin_email}): return jsonify({'message':'Company created, but admin email already exists. Use User Control to assign a user.'}),201
        user_res=db.users.insert_one({'tenant_id':tenant_id,'name':admin_name,'email':admin_email,'password_hash':generate_password_hash(admin_password),'roles':['admin','hr_manager'],'is_active':True,'created_at':now(),'created_by':str(g.current_user['_id'])})
        db.employees.insert_one({'tenant_id':tenant_id,'user_id':str(user_res.inserted_id),'emp_code':f'{tenant_id.upper()}-ADMIN','name':admin_name,'email':admin_email,'department':'HR & Admin','designation':'Manager','job_type':'Regular','project':'Administration','state':'Assam','status':'Active','salary':0,'created_at':now()})
    audit('create_company','tenants',tenant_id,doc)
    return jsonify({'message':'Company created','item':clean_doc(db.tenants.find_one({'tenant_id':tenant_id}))}),201

@superadmin_bp.patch('/companies/<tenant_id>')
@roles_required('super_admin')
def update_company(tenant_id):
    db=get_db(); data=request.get_json(silent=True) or {}; data.pop('_id',None); data.pop('tenant_id',None)
    data['updated_at']=now(); data['updated_by']=str(g.current_user['_id'])
    db.tenants.update_one({'tenant_id':tenant_id},{'$set':data})
    audit('update_company','tenants',tenant_id,data)
    return jsonify({'message':'Company updated','item':clean_doc(db.tenants.find_one({'tenant_id':tenant_id}))})

@superadmin_bp.get('/users')
@roles_required('super_admin')
def list_users():
    db=get_db(); q={}
    tenant_id=(request.args.get('tenant_id') or '').strip()
    search=(request.args.get('q') or '').strip()
    if tenant_id: q['tenant_id']=tenant_id
    if search:
        q['$or']=[{'name':{'$regex':search,'$options':'i'}},{'email':{'$regex':search,'$options':'i'}},{'tenant_id':{'$regex':search,'$options':'i'}}]
    rows=list(db.users.find(q).sort('created_at',-1).limit(1000))
    for u in rows:
        emp=db.employees.find_one({'user_id':str(u['_id'])})
        if emp: u['employee_profile']=emp
    return jsonify({'items':clean_doc(rows)})

@superadmin_bp.post('/users')
@roles_required('super_admin')
def create_user():
    db=get_db(); data=request.get_json(silent=True) or {}
    tenant_id=(data.get('tenant_id') or 'sds').strip().lower()
    if not db.tenants.find_one({'tenant_id':tenant_id}): return jsonify({'message':'Invalid tenant_id / company'}),400
    email=(data.get('email') or '').strip().lower(); password=data.get('password') or 'User@123'; name=(data.get('name') or '').strip()
    if not email or not name: return jsonify({'message':'Name and email are required'}),400
    if db.users.find_one({'email':email}): return jsonify({'message':'Email already exists'}),409
    roles=data.get('roles') or ['employee']
    if isinstance(roles,str): roles=[r.strip() for r in roles.split(',') if r.strip()]
    user_res=db.users.insert_one({'tenant_id':tenant_id,'name':name,'email':email,'password_hash':generate_password_hash(password),'roles':roles,'is_active':bool(data.get('is_active',True)),'created_at':now(),'created_by':str(g.current_user['_id'])})
    emp={'tenant_id':tenant_id,'user_id':str(user_res.inserted_id),'emp_code':data.get('emp_code') or '', 'name':name,'email':email,'department':data.get('department',''),'designation':data.get('designation',''),'job_type':data.get('job_type','Regular'),'project':data.get('project',''),'state':data.get('state',''),'status':data.get('employee_status','Active'),'salary':float(data.get('salary') or 0),'created_at':now()}
    if emp['emp_code']:
        db.employees.insert_one(emp)
    audit('create_user','users',user_res.inserted_id,{'email':email,'roles':roles,'tenant_id':tenant_id})
    return jsonify({'message':'User created','item':clean_doc(db.users.find_one({'_id':user_res.inserted_id}))}),201

@superadmin_bp.patch('/users/<user_id>')
@roles_required('super_admin')
def update_user(user_id):
    db=get_db(); data=request.get_json(silent=True) or {}
    user_update={}
    for key in ['name','email','tenant_id','is_active']:
        if key in data: user_update[key]=data[key]
    if 'roles' in data:
        roles=data['roles']; user_update['roles']=[r.strip() for r in roles.split(',') if r.strip()] if isinstance(roles,str) else roles
    if data.get('password'):
        user_update['password_hash']=generate_password_hash(data['password'])
    if user_update:
        user_update['updated_at']=now(); user_update['updated_by']=str(g.current_user['_id'])
        if 'email' in user_update: user_update['email']=user_update['email'].strip().lower()
        db.users.update_one({'_id':ObjectId(user_id)},{'$set':user_update})
    emp_update={}
    for key in [
    'emp_code',
    'department',
    'designation',
    'job_type',
    'project',
    'state',
    'status',
    'salary',
    'name',
    'email',
    'is_team_leader',
    'is_reporting_officer',
    'team_leader_id',
    'team_leader_name',
    'reporting_officer_id',
    'reporting_officer_name',
]:
        if key in data: emp_update[key]=data[key]
    if emp_update:
        emp_update['updated_at']=now(); emp_update['updated_by']=str(g.current_user['_id'])
        tenant_for_lookup = data.get("tenant_id") or g.current_user.get("tenant_id") or "sds"

    if "team_leader_id" in emp_update:
        emp_update["team_leader_name"] = resolve_employee_name(
            db,
            tenant_for_lookup,
            emp_update.get("team_leader_id"),
        )

    if "reporting_officer_id" in emp_update:
        emp_update["reporting_officer_name"] = resolve_employee_name(
            db,
            tenant_for_lookup,
            emp_update.get("reporting_officer_id"),
        )
        existing=db.employees.find_one({'user_id':user_id})
        if existing:
            db.employees.update_one({"user_id": user_id}, {"$set": emp_update})
        updated_emp = db.employees.find_one({"user_id": user_id})
        if updated_emp:
            sync_employee_roles(db, updated_emp)
    else:
        user = db.users.find_one({"_id": ObjectId(user_id)})
        emp_update.update({
            "tenant_id": user.get("tenant_id"),
            "user_id": user_id,
            "created_at": now(),
        })
        res = db.employees.insert_one(emp_update)
        updated_emp = db.employees.find_one({"_id": res.inserted_id})
        if updated_emp:
            sync_employee_roles(db, updated_emp)
        else:
            user=db.users.find_one({'_id':ObjectId(user_id)})
            emp_update.update({'tenant_id':user.get('tenant_id'),'user_id':user_id,'created_at':now()})
            db.employees.insert_one(emp_update)
    audit('update_user','users',user_id,data)
    return jsonify({'message':'User/profile updated','item':clean_doc(db.users.find_one({'_id':ObjectId(user_id)}))})

@superadmin_bp.post('/users/<user_id>/reset-password')
@roles_required('super_admin')
def reset_password(user_id):
    db=get_db(); data=request.get_json(silent=True) or {}; password=data.get('password') or 'User@123'
    db.users.update_one({'_id':ObjectId(user_id)},{'$set':{'password_hash':generate_password_hash(password),'updated_at':now(),'updated_by':str(g.current_user['_id'])}})
    audit('reset_password','users',user_id)
    return jsonify({'message':'Password reset successful'})
