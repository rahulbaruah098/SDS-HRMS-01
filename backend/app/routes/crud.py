from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime
from werkzeug.security import generate_password_hash
from app.extensions import get_db
from app.utils.auth import current_user_required, audit
from app.utils.serializers import clean_doc

crud_bp = Blueprint("crud", __name__)

COLLECTIONS = {
    "employees": ["name", "email", "emp_code", "department", "designation"],
    "departments": ["name"],
    "designations": ["title"],
    "projects": ["name"],
    "states": ["name"],
    "leave_types": ["name"],
    "leave_requests": ["employee_name", "leave_type", "status"],
    "payroll_runs": ["month", "status"],
    "payslips": ["employee_name", "month"],
    "job_openings": ["title", "department", "status"],
    "candidates": ["name", "email", "status"],
    "trainings": ["name", "trainer", "venue"],
    "performance_reviews": ["employee_name", "cycle", "reviewer_name", "reviewer_role", "status"],
    "expenses": ["employee_name", "type", "status"],
    "assets": ["name", "type", "serial_no", "status"],
    "tickets": ["title", "category", "status", "priority"],
    "notifications": ["title", "body"],
    "policies": ["title", "category"],
    "documents": ["title", "doc_type"],
    "system_settings": ["setting_group", "setting_key"],
    "audit_logs": ["action", "entity", "actor_email"],
}


COLLECTION_ROLES = {
    "employees": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},
    "departments": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},
    "designations": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},
    "projects": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},
    "states": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},
    "leave_types": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},

    "leave_requests": {
        "super_admin", "admin", "hr_admin", "hr_manager", "hr",
        "manager", "ro", "team_leader", "reporting_officer", "employee",
    },

    "payroll_runs": {"super_admin", "admin", "finance", "accounts_finance"},

    "payslips": {
        "super_admin", "admin", "finance", "accounts_finance", "employee",
    },

    "job_openings": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},
    "candidates": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},

    "trainings": {
        "super_admin", "admin", "hr_admin", "hr_manager", "hr",
        "manager", "ro", "team_leader", "reporting_officer", "employee",
    },

    "performance_reviews": {
        "super_admin", "admin", "hr_admin", "hr_manager", "hr",
        "manager", "ro", "team_leader", "reporting_officer", "employee",
    },

    "expenses": {
        "super_admin", "admin", "finance", "accounts_finance",
        "manager", "ro", "team_leader", "reporting_officer", "employee",
    },

    "assets": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},

    "tickets": {
        "super_admin", "admin", "hr_admin", "hr_manager", "hr",
        "manager", "ro", "team_leader", "reporting_officer", "employee",
    },

    "notifications": {
        "super_admin", "admin", "hr_admin", "hr_manager", "hr",
        "finance", "accounts_finance", "manager", "ro",
        "team_leader", "reporting_officer", "employee",
    },

    "policies": {
        "super_admin", "admin", "hr_admin", "hr_manager", "hr", "employee",
    },

    "documents": {
        "super_admin", "admin", "hr_admin", "hr_manager", "hr", "employee",
    },

    "system_settings": {"super_admin", "admin"},
    "audit_logs": {"super_admin", "admin"},
}


def can_access_collection(collection):
    roles = set(g.current_user.get("roles", []))

    if "super_admin" in roles:
        return True

    allowed_roles = COLLECTION_ROLES.get(collection, set())
    return bool(roles.intersection(allowed_roles))


def truthy(value):
    return str(value).lower() in ["true", "yes", "1", "on"]


def generate_default_password(name="", email=""):
    base = (name or email.split("@")[0] or "User").strip().replace(" ", "")
    base = base[:8] if base else "User"
    return f"{base}@123"


def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def resolve_employee_name(db, tenant_id, emp_id):
    if not emp_id:
        return ""

    emp_obj_id = safe_object_id(emp_id)

    if not emp_obj_id:
        return ""

    emp = db.employees.find_one({
        "_id": emp_obj_id,
        "tenant_id": tenant_id,
        "status": {"$ne": "Inactive"},
    })

    return emp.get("name", "") if emp else ""


def can_be_reporting_officer(data):
    designation = (data.get("designation") or "").strip().lower()
    return designation in ["managing director", "manager"]


def build_employee_roles(data):
    roles = ["employee"]

    if truthy(data.get("is_team_leader")):
        roles.append("team_leader")

    if truthy(data.get("is_reporting_officer")):
        if can_be_reporting_officer(data):
            roles.append("reporting_officer")

    return roles

def search(q, fields):
    return {
        "$or": [
            {field: {"$regex": q, "$options": "i"}}
            for field in fields
        ]
    } if q else {}


def sync_employee_roles(db, employee_doc):
    user_id = employee_doc.get("user_id")

    if not user_id:
        return

    user_obj_id = safe_object_id(user_id)

    if not user_obj_id:
        return

    user = db.users.find_one({"_id": user_obj_id})

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

    if not roles.intersection({
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "finance",
        "accounts_finance",
    }):
        roles.add("employee")

    db.users.update_one(
        {"_id": user_obj_id},
        {
            "$set": {
                "roles": list(roles),
                "updated_at": datetime.utcnow(),
            }
        },
    )


def scoped_query():
    roles = set(g.current_user.get("roles", []))
    tenant_arg = (request.args.get("tenant_id") or "").strip()

    if "super_admin" in roles:
        return {"tenant_id": tenant_arg} if tenant_arg else {}

    return {"tenant_id": g.tenant_id}


def current_employee_for_user(db, tenant_id):
    return db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": str(g.current_user["_id"]),
    })


def is_self_service_user(roles):
    employee_self_service_roles = {
        "employee",
        "team_leader",
        "reporting_officer",
        "manager",
        "ro",
    }

    admin_roles = {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "finance",
        "accounts_finance",
    }

    return bool(
        roles.intersection(employee_self_service_roles)
        and not roles.intersection(admin_roles)
    )


@crud_bp.get("/<collection>")
@current_user_required
def list_items(collection):
    if collection not in COLLECTIONS:
        return jsonify({"message": "Unknown module"}), 404

    if not can_access_collection(collection):
        return jsonify({"message": "Forbidden"}), 403

    db = get_db()
    roles = set(g.current_user.get("roles", []))

    q = scoped_query()
    q.update(search(request.args.get("q", "").strip(), COLLECTIONS[collection]))

    if is_self_service_user(roles):
        emp = current_employee_for_user(db, g.tenant_id)
        eid = str(emp["_id"]) if emp else "__none__"

        if collection in ["leave_requests", "payslips", "performance_reviews", "expenses"]:
            q["employee_id"] = eid

        if collection == "tickets":
            q["raised_by"] = eid

        if collection == "notifications":
            q["user_id"] = str(g.current_user["_id"])

    items = list(
        db[collection]
        .find(q)
        .sort("created_at", -1)
        .limit(500)
    )

    return jsonify({"items": clean_doc(items)})


@crud_bp.post("/<collection>")
@current_user_required
def create_item(collection):
    if collection not in COLLECTIONS:
        return jsonify({"message": "Unknown module"}), 404

    if not can_access_collection(collection):
        return jsonify({"message": "Forbidden"}), 403

    db = get_db()
    roles = set(g.current_user.get("roles", []))
    data = request.get_json(silent=True) or {}
    data.pop("_id", None)

    now = datetime.utcnow()

    tenant_id = (
        data.get("tenant_id")
        if "super_admin" in roles and data.get("tenant_id")
        else g.tenant_id
    )

    if tenant_id == "platform" and collection not in ["system_settings", "audit_logs"]:
        tenant_id = data.get("tenant_id") or "sds"

    current_employee = current_employee_for_user(db, tenant_id)
    current_employee_id = str(current_employee["_id"]) if current_employee else ""
    current_employee_name = current_employee.get("name", "") if current_employee else ""

    if is_self_service_user(roles):
        if collection in ["leave_requests", "expenses", "performance_reviews", "payslips"]:
            data["employee_id"] = current_employee_id
            data["employee_name"] = current_employee_name

        if collection == "tickets":
            data["raised_by"] = current_employee_id
            data["raised_by_name"] = current_employee_name

        if collection == "notifications":
            data["user_id"] = str(g.current_user["_id"])

    if collection == "employees":
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or generate_default_password(name, email)

        if not name or not email:
            return jsonify({"message": "Employee name and email are required"}), 400
        if truthy(data.get("is_reporting_officer")) and not can_be_reporting_officer(data):
            return jsonify({
                "message": "Only Managing Director or Manager can be Reporting Officer"
            }), 400

        if db.users.find_one({"email": email}):
            return jsonify({"message": "This email already exists as a login user"}), 409

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


@crud_bp.patch("/<collection>/<item_id>")
@current_user_required
def update_item(collection, item_id):
    if collection not in COLLECTIONS:
        return jsonify({"message": "Unknown module"}), 404

    if not can_access_collection(collection):
        return jsonify({"message": "Forbidden"}), 403

    item_obj_id = safe_object_id(item_id)

    if not item_obj_id:
        return jsonify({"message": "Invalid item id"}), 400

    db = get_db()
    roles = set(g.current_user.get("roles", []))
    data = request.get_json(silent=True) or {}
    data.pop("_id", None)
    data.pop("password_hash", None)

    data.update({
        "updated_at": datetime.utcnow(),
        "updated_by": str(g.current_user["_id"]),
    })

    q = {"_id": item_obj_id}

    if "super_admin" not in roles:
        q["tenant_id"] = g.tenant_id

    if collection == "employees":
        existing = db.employees.find_one(q)

        if not existing:
            return jsonify({"message": "Employee not found"}), 404

        tenant_id = existing.get("tenant_id") or g.tenant_id
        merged_for_role_check = {**existing, **data}

        if truthy(merged_for_role_check.get("is_reporting_officer")) and not can_be_reporting_officer(merged_for_role_check):
            return jsonify({
                "message": "Only Managing Director or Manager can be Reporting Officer"
            }), 400
        if "team_leader_id" in data:
            data["team_leader_name"] = resolve_employee_name(
                db,
                tenant_id,
                data.get("team_leader_id"),
            )

        if "reporting_officer_id" in data:
            data["reporting_officer_name"] = resolve_employee_name(
                db,
                tenant_id,
                data.get("reporting_officer_id"),
            )

        if "email" in data:
            email = (data.get("email") or "").strip().lower()

            if not email:
                return jsonify({"message": "Email is required"}), 400

            user_id = existing.get("user_id")
            user_obj_id = safe_object_id(user_id)

            duplicate_query = {"email": email}

            if user_obj_id:
                duplicate_query["_id"] = {"$ne": user_obj_id}

            duplicate = db.users.find_one(duplicate_query)

            if duplicate:
                return jsonify({"message": "Email already exists for another user"}), 409

            data["email"] = email

        db.employees.update_one(q, {"$set": data})

        updated_employee = db.employees.find_one({"_id": item_obj_id})

        if updated_employee:
            sync_employee_roles(db, updated_employee)

            user_update = {}

            if "name" in data:
                user_update["name"] = data["name"]

            if "email" in data:
                user_update["email"] = data["email"]

            if user_update and updated_employee.get("user_id"):
                user_obj_id = safe_object_id(updated_employee.get("user_id"))

                if user_obj_id:
                    user_update["updated_at"] = datetime.utcnow()
                    db.users.update_one(
                        {"_id": user_obj_id},
                        {"$set": user_update},
                    )

        audit("update", collection, item_id, data)

        return jsonify({
            "message": "Employee updated",
            "item": clean_doc(db.employees.find_one({"_id": item_obj_id})),
        })

    db[collection].update_one(q, {"$set": data})

    audit("update", collection, item_id, data)

    return jsonify({
        "message": "Updated",
        "item": clean_doc(db[collection].find_one({"_id": item_obj_id})),
    })


@crud_bp.delete("/<collection>/<item_id>")
@current_user_required
def delete_item(collection, item_id):
    if collection not in COLLECTIONS:
        return jsonify({"message": "Unknown module"}), 404

    if not can_access_collection(collection):
        return jsonify({"message": "Forbidden"}), 403

    item_obj_id = safe_object_id(item_id)

    if not item_obj_id:
        return jsonify({"message": "Invalid item id"}), 400

    db = get_db()
    roles = set(g.current_user.get("roles", []))

    q = {"_id": item_obj_id}

    if "super_admin" not in roles:
        q["tenant_id"] = g.tenant_id

    db[collection].update_one(
        q,
        {
            "$set": {
                "status": "inactive",
                "is_deleted": True,
                "updated_at": datetime.utcnow(),
                "updated_by": str(g.current_user["_id"]),
            }
        },
    )

    audit("soft_delete", collection, item_id)

    return jsonify({"message": "Deleted"})