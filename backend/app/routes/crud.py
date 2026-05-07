from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime
from werkzeug.security import generate_password_hash

from app.extensions import get_db
from app.utils.auth import current_user_required, audit
from app.utils.serializers import clean_doc


crud_bp = Blueprint("crud", __name__)


ADMIN_HR_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}

MANAGER_SCOPE_ROLES = {
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
}

SELF_SERVICE_COLLECTIONS = {
    "leave_balances",
    "leave_requests",
    "attendance_logs",
    "attendance_mode_requests",
    "compoff_credits",
    "payslips",
    "performance_reviews",
    "expenses",
}

EMPLOYEE_CREATE_ONLY_COLLECTIONS = {
    "leave_requests",
    "attendance_mode_requests",
    "expenses",
    "tickets",
}

HR_ONLY_CREATE_COLLECTIONS = {
    "leave_balances",
    "holiday_calendar",
}

ATTENDANCE_SYSTEM_COLLECTIONS = {
    "attendance_logs",
    "compoff_credits",
}

SUPPORTED_HOLIDAY_STATES = [
    "Assam(HO)",
    "Manipur",
    "Mizoram",
    "Arunachal Pradesh",
]


COLLECTIONS = {
    "employees": [
        "name",
        "email",
        "phone",
        "employee_id",
        "emp_code",
        "department",
        "designation",
        "role",
        "branch",
        "state",
        "employment_status",
        "status",
    ],
    "departments": ["name"],
    "designations": ["title"],
    "projects": ["name"],
    "states": ["name"],
    "leave_types": ["name"],

    "leave_balances": [
        "employee_name",
        "leave_type",
        "department",
        "designation",
    ],

    "leave_requests": [
        "employee_name",
        "leave_type",
        "status",
        "approval_stage",
        "department",
        "designation",
    ],

    "holiday_calendar": [
        "state",
        "date",
        "title",
        "message",
        "status",
    ],

    "attendance_logs": [
        "employee_name",
        "department",
        "designation",
        "state",
        "date",
        "mode",
        "status",
    ],

    "attendance_mode_requests": [
        "employee_name",
        "department",
        "designation",
        "mode",
        "date",
        "status",
    ],

    "compoff_credits": [
        "employee_name",
        "department",
        "designation",
        "earned_date",
        "claimed_date",
        "status",
    ],

    "payroll_runs": ["month", "status"],
    "payslips": ["employee_name", "month"],
    "job_openings": ["title", "department", "status"],
    "candidates": ["name", "email", "status"],
    "trainings": ["name", "trainer", "venue"],
    "performance_reviews": [
        "employee_name",
        "cycle",
        "reviewer_name",
        "reviewer_role",
        "status",
    ],
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

    "leave_balances": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "leave_requests": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "holiday_calendar": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "attendance_logs": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "attendance_mode_requests": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "compoff_credits": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "payroll_runs": {"super_admin", "admin", "finance", "accounts_finance"},

    "payslips": {
        "super_admin",
        "admin",
        "finance",
        "accounts_finance",
        "employee",
    },

    "job_openings": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},
    "candidates": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},

    "trainings": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "performance_reviews": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "expenses": {
        "super_admin",
        "admin",
        "finance",
        "accounts_finance",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "assets": {"super_admin", "admin", "hr_admin", "hr_manager", "hr"},

    "tickets": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "notifications": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "finance",
        "accounts_finance",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
        "employee",
    },

    "policies": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "employee",
    },

    "documents": {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "employee",
    },

    "system_settings": {"super_admin", "admin"},
    "audit_logs": {"super_admin", "admin"},
}


EMPLOYEE_ALLOWED_FIELDS = {
    "name",
    "email",
    "avatar",
    "phone",
    "country",
    "joining_date",
    "date_of_birth",
    "blood_group",
    "gross_salary",
    "branch",
    "aadhar_no",
    "employee_uan_no",
    "employee_type",
    "skill_level",
    "are_parents_senior_citizen",
    "number_of_children",
    "payment_mode",
    "previous_designation",
    "previous_employment_tenure_end_date",
    "password",
    "role",
    "designation",
    "department",
    "shift",
    "gender",
    "address",
    "religion",
    "marital_status",
    "speak_language",
    "pan_no",
    "disability_level",
    "employee_esic_ip",
    "employment_status",
    "father_name",
    "dependent_disability_level",
    "children_in_hostel",
    "previous_employer_name",
    "previous_employment_tenure_from_date",
    "employee_id",
    "emp_code",
    "job_type",
    "project",
    "state",
    "status",
    "salary",
    "is_team_leader",
    "is_reporting_officer",
    "team_leader_id",
    "team_leader_name",
    "reporting_officer_id",
    "reporting_officer_name",
}


ROLE_VALUE_MAP = {
    "admin": "admin",
    "hr": "hr",
    "hr admin": "hr_admin",
    "hr_admin": "hr_admin",
    "hr manager": "hr_manager",
    "hr_manager": "hr_manager",
    "finance": "finance",
    "accounts finance": "accounts_finance",
    "accounts_finance": "accounts_finance",
    "manager": "manager",
    "ro": "ro",
    "team leader": "team_leader",
    "team_leader": "team_leader",
    "reporting officer": "reporting_officer",
    "reporting_officer": "reporting_officer",
    "employee": "employee",
}


def can_access_collection(collection):
    roles = set(g.current_user.get("roles", []))

    if "super_admin" in roles:
        return True

    allowed_roles = COLLECTION_ROLES.get(collection, set())
    return bool(roles.intersection(allowed_roles))


def truthy(value):
    return str(value).lower() in ["true", "yes", "1", "on"]


def normalize_status(value, default="active"):
    return (value or default).strip()


def normalize_text(value):
    return (value or "").strip()


def normalize_email(value):
    return (value or "").strip().lower()


def normalize_role_value(value):
    role_key = str(value or "").strip().lower()
    return ROLE_VALUE_MAP.get(role_key, "employee")


def generate_default_password(name="", email=""):
    base = (name or email.split("@")[0] or "User").strip().replace(" ", "")
    base = base[:8] if base else "User"
    return f"{base}@123"


def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def can_be_reporting_officer(data):
    designation = (data.get("designation") or "").strip().lower()
    return designation in ["managing director", "manager"]


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


def resolve_reporting_officer_name(db, tenant_id, emp_id):
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

    if not emp:
        return ""

    if not can_be_reporting_officer(emp):
        return None

    return emp.get("name", "")


def build_employee_roles(data):
    roles = set()

    selected_role = normalize_role_value(data.get("role"))
    roles.add(selected_role)

    if truthy(data.get("is_team_leader")):
        roles.add("team_leader")

    if truthy(data.get("is_reporting_officer")) and can_be_reporting_officer(data):
        roles.add("reporting_officer")

    if not roles:
        roles.add("employee")

    return list(roles)


def search(q, fields):
    if not q:
        return {}

    return {
        "$or": [
            {field: {"$regex": q, "$options": "i"}}
            for field in fields
        ]
    }


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

    selected_role = normalize_role_value(employee_doc.get("role"))

    protected_roles = {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "finance",
        "accounts_finance",
    }

    previous_dynamic_roles = {
        "employee",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
    }

    if not roles.intersection(protected_roles):
        roles.difference_update(previous_dynamic_roles)
        roles.add(selected_role)

    if truthy(employee_doc.get("is_team_leader")):
        roles.add("team_leader")
    else:
        if selected_role != "team_leader":
            roles.discard("team_leader")

    if truthy(employee_doc.get("is_reporting_officer")) and can_be_reporting_officer(employee_doc):
        roles.add("reporting_officer")
    else:
        if selected_role != "reporting_officer":
            roles.discard("reporting_officer")

    if not roles:
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


def is_admin_hr_user(roles):
    return bool(roles.intersection(ADMIN_HR_ROLES))


def normalize_state(value):
    state = normalize_text(value)

    if not state:
        return "Assam(HO)"

    lowered = state.lower()

    if lowered in ["assam", "assam ho", "assam(ho)", "ho"]:
        return "Assam(HO)"

    for allowed in SUPPORTED_HOLIDAY_STATES:
        if lowered == allowed.lower():
            return allowed

    return state


def current_employee_id_for_user(db, tenant_id):
    employee = current_employee_for_user(db, tenant_id)
    return str(employee["_id"]) if employee else ""


def scoped_employee_ids_for_manager(db, tenant_id):
    roles = set(g.current_user.get("roles", []))

    if is_admin_hr_user(roles):
        return None

    manager_employee = current_employee_for_user(db, tenant_id)

    if not manager_employee:
        return []

    manager_employee_id = str(manager_employee["_id"])
    scope_or = []

    if "team_leader" in roles:
        scope_or.append({"team_leader_id": manager_employee_id})

    if roles.intersection({"manager", "ro", "reporting_officer"}):
        scope_or.append({"reporting_officer_id": manager_employee_id})

    if not scope_or:
        return []

    employees = list(db.employees.find({
        "tenant_id": tenant_id,
        "status": {"$ne": "Inactive"},
        "$or": scope_or,
    }))

    return [str(employee["_id"]) for employee in employees]


def apply_people_scope(db, q, collection, roles, tenant_id):
    if "super_admin" in roles or is_admin_hr_user(roles):
        return q

    current_employee_id = current_employee_id_for_user(db, tenant_id)

    if is_self_service_user(roles):
        if collection in SELF_SERVICE_COLLECTIONS:
            q["employee_id"] = current_employee_id or "__none__"

        if collection == "tickets":
            q["raised_by"] = current_employee_id or "__none__"

        if collection == "notifications":
            q["user_id"] = str(g.current_user["_id"])

        return q

    if roles.intersection(MANAGER_SCOPE_ROLES):
        scoped_employee_ids = scoped_employee_ids_for_manager(db, tenant_id)

        if scoped_employee_ids is not None and collection in SELF_SERVICE_COLLECTIONS:
            q["employee_id"] = {"$in": scoped_employee_ids}

    return q


def sanitize_holiday_payload(data):
    clean = {
        "state": normalize_state(data.get("state")),
        "date": normalize_text(data.get("date")),
        "title": normalize_text(data.get("title")),
        "message": normalize_text(data.get("message")),
        "status": normalize_status(data.get("status"), "active"),
    }

    return clean


def sanitize_leave_balance_payload(data):
    clean = {
        "employee_id": normalize_text(data.get("employee_id")),
        "leave_type": normalize_text(data.get("leave_type")).upper(),
        "opening_balance": data.get("opening_balance", 0),
        "credited": data.get("credited", data.get("opening_balance", 0)),
        "used": data.get("used", 0),
        "available": data.get("available"),
        "status": normalize_status(data.get("status"), "active"),
    }

    for number_key in ["opening_balance", "credited", "used"]:
        try:
            clean[number_key] = float(clean[number_key] or 0)
        except Exception:
            clean[number_key] = 0.0

    if clean["available"] in [None, ""]:
        clean["available"] = max(clean["credited"] - clean["used"], 0)
    else:
        try:
            clean["available"] = float(clean["available"] or 0)
        except Exception:
            clean["available"] = 0.0

    return clean


def attach_employee_snapshot(db, tenant_id, data):
    employee_id = normalize_text(data.get("employee_id"))
    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return data, None

    employee = db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": tenant_id,
    })

    if not employee:
        return data, None

    data.update({
        "employee_name": employee.get("name", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
    })

    return data, employee


def sanitize_employee_payload(data):
    clean = {}

    for key in EMPLOYEE_ALLOWED_FIELDS:
        if key in data:
            clean[key] = data.get(key)

    clean["name"] = normalize_text(clean.get("name"))
    clean["email"] = normalize_email(clean.get("email"))
    clean["phone"] = normalize_text(clean.get("phone"))
    clean["employee_id"] = normalize_text(clean.get("employee_id"))
    clean["emp_code"] = normalize_text(clean.get("emp_code"))
    clean["department"] = normalize_text(clean.get("department"))
    clean["designation"] = normalize_text(clean.get("designation"))
    clean["branch"] = normalize_text(clean.get("branch"))
    clean["state"] = normalize_state(clean.get("state"))
    clean["role"] = clean.get("role") or "Employee"
    clean["status"] = clean.get("status") or "Active"

    clean["is_team_leader"] = str(clean.get("is_team_leader", "false")).lower()
    clean["is_reporting_officer"] = str(clean.get("is_reporting_officer", "false")).lower()

    return clean


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
    tenant_id = q.get("tenant_id") or g.tenant_id

    q.update(search(request.args.get("q", "").strip(), COLLECTIONS[collection]))

    status = normalize_text(request.args.get("status"))
    employee_id = normalize_text(request.args.get("employee_id"))
    department = normalize_text(request.args.get("department"))
    mode = normalize_text(request.args.get("mode"))
    state = normalize_text(request.args.get("state"))
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))

    if status:
        q["status"] = status

    if employee_id:
        q["employee_id"] = employee_id

    if department:
        q["department"] = department

    if mode:
        q["mode"] = mode

    if state:
        q["state"] = normalize_state(state)

    if date_from or date_to:
        date_field = "date"

        if collection == "compoff_credits":
            date_field = "earned_date"

        if collection == "leave_requests":
            date_field = "from_date"

        q[date_field] = {}

        if date_from:
            q[date_field]["$gte"] = date_from

        if date_to:
            q[date_field]["$lte"] = date_to

    q = apply_people_scope(db, q, collection, roles, tenant_id)

    if collection != "audit_logs":
        q["is_deleted"] = {"$ne": True}

    sort_field = "created_at"

    if collection in ["attendance_logs", "attendance_mode_requests", "holiday_calendar"]:
        sort_field = "date"

    if collection == "compoff_credits":
        sort_field = "earned_date"

    items = list(
        db[collection]
        .find(q)
        .sort(sort_field, -1)
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
    data.pop("password_mode", None)

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

    if collection in ATTENDANCE_SYSTEM_COLLECTIONS:
        return jsonify({
            "message": "This module is system generated. Use attendance APIs instead."
        }), 400

    if collection in HR_ONLY_CREATE_COLLECTIONS and not is_admin_hr_user(roles):
        return jsonify({"message": "Only HR/Admin can create this record"}), 403

    if is_self_service_user(roles):
        if collection not in EMPLOYEE_CREATE_ONLY_COLLECTIONS:
            return jsonify({"message": "You cannot create records in this module"}), 403

        if collection in ["leave_requests", "attendance_mode_requests", "expenses"]:
            data["employee_id"] = current_employee_id
            data["employee_name"] = current_employee_name

        if collection == "tickets":
            data["raised_by"] = current_employee_id
            data["raised_by_name"] = current_employee_name

        if collection == "notifications":
            data["user_id"] = str(g.current_user["_id"])

    if collection == "employees":
        data = sanitize_employee_payload(data)

        name = data.get("name", "")
        email = data.get("email", "")
        password = data.get("password") or generate_default_password(name, email)

        if not name or not email:
            return jsonify({"message": "Employee name and email are required"}), 400

        if truthy(data.get("is_reporting_officer")) and not can_be_reporting_officer(data):
            return jsonify({
                "message": "Only Managing Director or Manager can be Reporting Officer"
            }), 400

        if db.users.find_one({"email": email}):
            return jsonify({"message": "This email already exists as a login user"}), 409

        if data.get("employee_id"):
            existing_employee_id = db.employees.find_one({
                "tenant_id": tenant_id,
                "employee_id": data.get("employee_id"),
                "is_deleted": {"$ne": True},
            })

            if existing_employee_id:
                return jsonify({"message": "Employee ID already exists in this tenant"}), 409

        if data.get("emp_code"):
            existing_emp_code = db.employees.find_one({
                "tenant_id": tenant_id,
                "emp_code": data.get("emp_code"),
                "is_deleted": {"$ne": True},
            })

            if existing_emp_code:
                return jsonify({"message": "Employee code already exists in this tenant"}), 409

        team_leader_id = data.get("team_leader_id") or ""
        reporting_officer_id = data.get("reporting_officer_id") or ""

        reporting_officer_name = resolve_reporting_officer_name(
            db,
            tenant_id,
            reporting_officer_id,
        )

        if reporting_officer_id and reporting_officer_name is None:
            return jsonify({
                "message": "Selected Reporting Officer must be Managing Director or Manager"
            }), 400

        data["team_leader_name"] = resolve_employee_name(db, tenant_id, team_leader_id)
        data["reporting_officer_name"] = reporting_officer_name or ""

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

        res = db.employees.insert_one(data)
        created_employee = db.employees.find_one({"_id": res.inserted_id})

        if created_employee:
            sync_employee_roles(db, created_employee)

        audit("create", "employees", res.inserted_id, data)

        return jsonify({
            "message": f"Employee and login user created. Password: {password}",
            "item": clean_doc(created_employee),
        }), 201

    if collection == "holiday_calendar":
        data = sanitize_holiday_payload(data)

        if data["state"] not in SUPPORTED_HOLIDAY_STATES:
            return jsonify({"message": "Invalid holiday state"}), 400

        if not data["date"] or not data["title"]:
            return jsonify({"message": "Holiday date and title are required"}), 400

        duplicate = db.holiday_calendar.find_one({
            "tenant_id": tenant_id,
            "state": data["state"],
            "date": data["date"],
            "is_deleted": {"$ne": True},
            "status": {"$ne": "inactive"},
        })

        if duplicate:
            return jsonify({"message": "Holiday already exists for this state and date"}), 409

    if collection == "leave_balances":
        data = sanitize_leave_balance_payload(data)

        if data["leave_type"] not in ["CL", "EL"]:
            return jsonify({"message": "Leave balance type must be CL or EL"}), 400

        data, employee = attach_employee_snapshot(db, tenant_id, data)

        if not employee:
            return jsonify({"message": "Valid employee_id is required"}), 400

        duplicate = db.leave_balances.find_one({
            "tenant_id": tenant_id,
            "employee_id": data["employee_id"],
            "leave_type": data["leave_type"],
            "is_deleted": {"$ne": True},
        })

        if duplicate:
            return jsonify({
                "message": "Leave balance already exists for this employee and leave type"
            }), 409

    if collection == "leave_requests":
        data, employee = attach_employee_snapshot(db, tenant_id, data)

        if not employee:
            return jsonify({"message": "Valid employee_id is required"}), 400

        data.setdefault("status", "pending")
        data.setdefault(
            "approval_stage",
            "team_leader" if employee.get("team_leader_id") else "reporting_officer",
        )

    if collection == "attendance_mode_requests":
        data, employee = attach_employee_snapshot(db, tenant_id, data)

        if not employee:
            return jsonify({"message": "Valid employee_id is required"}), 400

        mode = normalize_text(data.get("mode")).lower()

        if mode not in ["wfh", "field"]:
            return jsonify({"message": "Mode must be wfh or field"}), 400

        if not normalize_text(data.get("date")):
            return jsonify({"message": "Request date is required"}), 400

        if not normalize_text(data.get("reason")):
            return jsonify({"message": "Reason is required"}), 400

        if mode == "field" and not normalize_text(data.get("field_location")):
            return jsonify({"message": "Field location is required"}), 400

        data["mode"] = mode
        data.setdefault("status", "pending")

    if collection == "expenses":
        data, _ = attach_employee_snapshot(db, tenant_id, data)
        data.setdefault("status", "pending")

    if collection == "tickets":
        data.setdefault("status", "open")

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
    data.pop("password", None)
    data.pop("password_mode", None)

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

        data = sanitize_employee_payload({
            **{key: existing.get(key) for key in EMPLOYEE_ALLOWED_FIELDS},
            **data,
        })
        data.pop("password", None)

        data.update({
            "updated_at": datetime.utcnow(),
            "updated_by": str(g.current_user["_id"]),
        })

        merged_for_role_check = {**existing, **data}

        if truthy(merged_for_role_check.get("is_reporting_officer")) and not can_be_reporting_officer(merged_for_role_check):
            return jsonify({
                "message": "Only Managing Director or Manager can be Reporting Officer"
            }), 400

        if data.get("employee_id"):
            duplicate_employee_id = db.employees.find_one({
                "_id": {"$ne": item_obj_id},
                "tenant_id": tenant_id,
                "employee_id": data.get("employee_id"),
                "is_deleted": {"$ne": True},
            })

            if duplicate_employee_id:
                return jsonify({"message": "Employee ID already exists in this tenant"}), 409

        if data.get("emp_code"):
            duplicate_emp_code = db.employees.find_one({
                "_id": {"$ne": item_obj_id},
                "tenant_id": tenant_id,
                "emp_code": data.get("emp_code"),
                "is_deleted": {"$ne": True},
            })

            if duplicate_emp_code:
                return jsonify({"message": "Employee code already exists in this tenant"}), 409

        if "team_leader_id" in data:
            data["team_leader_name"] = resolve_employee_name(
                db,
                tenant_id,
                data.get("team_leader_id"),
            )

        if "reporting_officer_id" in data:
            reporting_officer_id = data.get("reporting_officer_id") or ""
            reporting_officer_name = resolve_reporting_officer_name(
                db,
                tenant_id,
                reporting_officer_id,
            )

            if reporting_officer_id and reporting_officer_name is None:
                return jsonify({
                    "message": "Selected Reporting Officer must be Managing Director or Manager"
                }), 400

            data["reporting_officer_name"] = reporting_officer_name or ""

        if "email" in data:
            email = normalize_email(data.get("email"))

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

    if collection in ATTENDANCE_SYSTEM_COLLECTIONS:
        return jsonify({
            "message": "This module is system generated. Use attendance APIs instead."
        }), 400

    if collection in HR_ONLY_CREATE_COLLECTIONS and not is_admin_hr_user(roles):
        return jsonify({"message": "Only HR/Admin can update this record"}), 403

    existing = db[collection].find_one(q)

    if not existing:
        return jsonify({"message": "Record not found"}), 404

    if collection == "holiday_calendar":
        allowed = {
            "state",
            "date",
            "title",
            "message",
            "status",
            "updated_at",
            "updated_by",
        }

        data = {key: value for key, value in data.items() if key in allowed}

        if "state" in data:
            data["state"] = normalize_state(data.get("state"))

            if data["state"] not in SUPPORTED_HOLIDAY_STATES:
                return jsonify({"message": "Invalid holiday state"}), 400

    if collection == "leave_balances":
        allowed = {
            "employee_id",
            "leave_type",
            "opening_balance",
            "credited",
            "used",
            "available",
            "status",
            "updated_at",
            "updated_by",
        }

        data = {key: value for key, value in data.items() if key in allowed}

        merged = sanitize_leave_balance_payload({
            **existing,
            **data,
        })

        merged.update({
            "updated_at": datetime.utcnow(),
            "updated_by": str(g.current_user["_id"]),
        })

        data = merged

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