
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


def truthy(value):
    return str(value).lower() in ["true", "yes", "1", "on"]


def generate_default_password(name="", email=""):
    """
    Simple auto password if HR does not manually type one.
    Example: Rahul@123
    """
    base = (name or email.split("@")[0] or "User").strip().replace(" ", "")
    base = base[:8] if base else "User"
    return f"{base}@123"


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


def build_employee_roles(data):
    roles = ["employee"]

    if truthy(data.get("is_team_leader")):
        roles.append("team_leader")

    if truthy(data.get("is_reporting_officer")):
        roles.append("reporting_officer")

    return roles

def search(q,fields):
    return {'$or':[{f:{'$regex':q,'$options':'i'}} for f in fields]} if q else {}


def sync_employee_roles(db, employee_doc):
    """
    Sync employee flags into user roles:
    is_team_leader=true       -> user gets team_leader role
    is_team_leader=false      -> team_leader role removed
    is_reporting_officer=true -> reporting_officer role added
    is_reporting_officer=false-> reporting_officer role removed
    """
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

    is_team_leader = truthy(employee_doc.get("is_team_leader"))
    is_reporting_officer = truthy(employee_doc.get("is_reporting_officer"))

    if is_team_leader:
        roles.add("team_leader")
    else:
        roles.discard("team_leader")

    if is_reporting_officer:
        roles.add("reporting_officer")
    else:
        roles.discard("reporting_officer")

    # Keep base employee role unless user is only platform/company admin type
    if not roles.intersection({"super_admin", "admin", "hr_manager", "hr", "accounts_finance"}):
        roles.add("employee")

    db.users.update_one(
        {"_id": ObjectId(user_id)},
        {
            "$set": {
                "roles": list(roles),
                "updated_at": datetime.utcnow(),
            }
        },
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
    if collection not in COLLECTIONS:
        return jsonify({"message": "Unknown module"}), 404

    db = get_db()
    roles = set(g.current_user.get("roles", []))
    data = request.get_json(silent=True) or {}
    data.pop("_id", None)

    now = datetime.utcnow()
    tenant_id = data.get("tenant_id") if "super_admin" in roles and data.get("tenant_id") else g.tenant_id

    if tenant_id == "platform":
        tenant_id = "sds"

    # SPECIAL CASE: Employee creation must also create login user
    if collection == "employees":
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or generate_default_password(name, email)

        if not name or not email:
            return jsonify({"message": "Employee name and email are required"}), 400

        if db.users.find_one({"email": email}):
            return jsonify({"message": "This email already exists as a login user"}), 409

        # Resolve dropdown IDs into names
        team_leader_id = data.get("team_leader_id") or ""
        reporting_officer_id = data.get("reporting_officer_id") or ""

        data["team_leader_name"] = resolve_employee_name(db, tenant_id, team_leader_id)
        data["reporting_officer_name"] = resolve_employee_name(db, tenant_id, reporting_officer_id)

        employee_roles = build_employee_roles(data)

        user_res = db.users.insert_one({
            "tenant_id": tenant_id,
            "name": name,
            "email": email,
            "password_hash": generate_password_hash(password),
            "roles": employee_roles,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "created_by": str(g.current_user["_id"]),
        })

        data.pop("password", None)

        data.update({
            "tenant_id": tenant_id,
            "user_id": str(user_res.inserted_id),
            "email": email,
            "name": name,
            "created_at": now,
            "updated_at": now,
            "created_by": str(g.current_user["_id"]),
        })

        if "status" not in data:
            data["status"] = "Active"

        res = db.employees.insert_one(data)
        created_employee = db.employees.find_one({"_id": res.inserted_id})

        if created_employee:
            sync_employee_roles(db, created_employee)

        audit("create", "employees", res.inserted_id, data)

        return jsonify({
            "message": f"Employee and login user created. Password: {password}",
            "item": clean_doc(created_employee),
        }), 201

    # NORMAL MODULE CREATE
    data.update({
        "tenant_id": tenant_id,
        "created_at": now,
        "updated_at": now,
        "created_by": str(g.current_user["_id"]),
    })

    if "status" not in data:
        data["status"] = "active"

    res = db[collection].insert_one(data)

    audit("create", collection, res.inserted_id, data)

    return jsonify({
        "message": "Created",
        "item": clean_doc(db[collection].find_one({"_id": res.inserted_id})),
    }), 201

@crud_bp.patch('/<collection>/<item_id>')
@current_user_required
def update_item(collection, item_id):
    if collection not in COLLECTIONS:
        return jsonify({"message": "Unknown module"}), 404

    db = get_db()
    roles = set(g.current_user.get("roles", []))
    data = request.get_json(silent=True) or {}
    data.pop("_id", None)

    data.update({
        "updated_at": datetime.utcnow(),
        "updated_by": str(g.current_user["_id"]),
    })

    q = {"_id": ObjectId(item_id)}

    if "super_admin" not in roles:
        q["tenant_id"] = g.tenant_id

    # SPECIAL CASE: Employee hierarchy update
    if collection == "employees":
        existing = db.employees.find_one(q)

        if not existing:
            return jsonify({"message": "Employee not found"}), 404

        tenant_id = existing.get("tenant_id") or g.tenant_id

        # Resolve dropdown IDs into names
        if "team_leader_id" in data:
            data["team_leader_name"] = resolve_employee_name(db, tenant_id, data.get("team_leader_id"))

        if "reporting_officer_id" in data:
            data["reporting_officer_name"] = resolve_employee_name(db, tenant_id, data.get("reporting_officer_id"))

        db.employees.update_one(q, {"$set": data})

        updated_employee = db.employees.find_one({"_id": ObjectId(item_id)})

        if updated_employee:
            sync_employee_roles(db, updated_employee)

            # Keep linked user name/email in sync if changed
            user_update = {}
            if "name" in data:
                user_update["name"] = data["name"]
            if "email" in data:
                email = (data.get("email") or "").strip().lower()
                duplicate = db.users.find_one({
                    "email": email,
                    "_id": {"$ne": ObjectId(updated_employee["user_id"])},
                })
                if duplicate:
                    return jsonify({"message": "Email already exists for another user"}), 409
                user_update["email"] = email

            if user_update and updated_employee.get("user_id"):
                user_update["updated_at"] = datetime.utcnow()
                db.users.update_one(
                    {"_id": ObjectId(updated_employee["user_id"])},
                    {"$set": user_update},
                )

        audit("update", collection, item_id, data)

        return jsonify({
            "message": "Employee updated",
            "item": clean_doc(db.employees.find_one({"_id": ObjectId(item_id)})),
        })

    # NORMAL MODULE UPDATE
    db[collection].update_one(q, {"$set": data})

    audit("update", collection, item_id, data)

    return jsonify({
        "message": "Updated",
        "item": clean_doc(db[collection].find_one({"_id": ObjectId(item_id)})),
    })

@crud_bp.delete('/<collection>/<item_id>')
@current_user_required
def delete_item(collection,item_id):
    if collection not in COLLECTIONS: return jsonify({'message':'Unknown module'}),404
    db=get_db(); roles=set(g.current_user.get('roles',[])); q={'_id':ObjectId(item_id)}
    if 'super_admin' not in roles: q['tenant_id']=g.tenant_id
    db[collection].update_one(q,{'$set':{'status':'inactive','is_deleted':True,'updated_at':datetime.utcnow()}}); audit('soft_delete',collection,item_id)
    return jsonify({'message':'Deleted'})
