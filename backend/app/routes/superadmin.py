from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime
from werkzeug.security import generate_password_hash

from app.extensions import get_db
from app.utils.auth import roles_required, audit
from app.utils.serializers import clean_doc


superadmin_bp = Blueprint("superadmin", __name__)

DEFAULT_DEPARTMENTS = [
    "HR & Admin",
    "Finance & Accounts",
    "Research & Development",
    "Operations",
    "MIS",
    "IT",
]

DEFAULT_DESIGNATIONS = [
    "Managing Director",
    "Director",
    "General Manager",
    "Manager",
    "Executive",
    "Associate",
    "Assistant",
]

DEFAULT_STATES = [
    "Assam",
    "Arunachal Pradesh",
    "Manipur",
    "Mizoram",
    "Tripura",
]

DEFAULT_PROJECTS = [
    "SFAC",
    "NCDC",
    "NFDB",
    "NAFED",
    "NABARD",
    "TRLM FISHERY",
    "TRESP",
    "NEDFi CDAP",
]


EMPLOYEE_PROFILE_FIELDS = [
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
]


def now():
    return datetime.utcnow()


def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def slugify(value):
    raw = "".join(
        ch.lower() if ch.isalnum() else "-"
        for ch in (value or "").strip()
    )
    raw = "-".join([part for part in raw.split("-") if part])
    return raw or "tenant"


def truthy(value):
    return str(value).lower() in ["true", "yes", "1", "on"]


def normalize_text(value):
    return (value or "").strip()


def normalize_email(value):
    return (value or "").strip().lower()


def normalize_float(value, default=0):
    try:
        return float(value or default)
    except Exception:
        return float(default)


def normalize_roles(value):
    if not value:
        return ["employee"]

    if isinstance(value, str):
        roles = [role.strip() for role in value.split(",") if role.strip()]
    elif isinstance(value, list):
        roles = [str(role).strip() for role in value if str(role).strip()]
    else:
        roles = ["employee"]

    return roles or ["employee"]


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

    if truthy(employee_doc.get("is_team_leader")):
        roles.add("team_leader")
    else:
        roles.discard("team_leader")

    if truthy(employee_doc.get("is_reporting_officer")) and can_be_reporting_officer(employee_doc):
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
                "updated_at": now(),
            }
        },
    )


def build_employee_profile_payload(data):
    payload = {}

    for key in EMPLOYEE_PROFILE_FIELDS:
        if key in data:
            payload[key] = data.get(key)

    payload["phone"] = normalize_text(payload.get("phone"))
    payload["employee_id"] = normalize_text(payload.get("employee_id"))
    payload["emp_code"] = normalize_text(payload.get("emp_code"))
    payload["department"] = normalize_text(payload.get("department"))
    payload["designation"] = normalize_text(payload.get("designation"))
    payload["branch"] = normalize_text(payload.get("branch"))
    payload["status"] = payload.get("status") or "Active"

    payload["is_team_leader"] = str(payload.get("is_team_leader", "false")).lower()
    payload["is_reporting_officer"] = str(payload.get("is_reporting_officer", "false")).lower()

    if "salary" in payload:
        payload["salary"] = normalize_float(payload.get("salary"), 0)

    if "gross_salary" in payload:
        payload["gross_salary"] = normalize_text(str(payload.get("gross_salary") or ""))

    return payload


def seed_company_masters(db, tenant_id):
    for name in DEFAULT_DEPARTMENTS:
        db.departments.update_one(
            {"tenant_id": tenant_id, "name": name},
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    "name": name,
                    "status": "active",
                    "created_at": now(),
                }
            },
            upsert=True,
        )

    for title in DEFAULT_DESIGNATIONS:
        db.designations.update_one(
            {"tenant_id": tenant_id, "title": title},
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    "title": title,
                    "status": "active",
                    "created_at": now(),
                }
            },
            upsert=True,
        )

    for name in DEFAULT_STATES:
        db.states.update_one(
            {"tenant_id": tenant_id, "name": name},
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    "name": name,
                    "status": "active",
                    "created_at": now(),
                }
            },
            upsert=True,
        )

    for name in DEFAULT_PROJECTS:
        db.projects.update_one(
            {"tenant_id": tenant_id, "name": name},
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    "name": name,
                    "status": "active",
                    "created_at": now(),
                }
            },
            upsert=True,
        )

    for name, days in [
        ("Casual Leave", 12),
        ("Sick Leave", 12),
        ("Earned Leave", 18),
        ("Comp-Off", 0),
    ]:
        db.leave_types.update_one(
            {"tenant_id": tenant_id, "name": name},
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    "name": name,
                    "days_per_year": days,
                    "carry_forward": name == "Earned Leave",
                    "status": "active",
                    "created_at": now(),
                }
            },
            upsert=True,
        )

    db.system_settings.update_one(
        {
            "tenant_id": tenant_id,
            "setting_group": "attendance",
            "setting_key": "late_cutoff",
        },
        {
            "$setOnInsert": {
                "tenant_id": tenant_id,
                "setting_group": "attendance",
                "setting_key": "late_cutoff",
                "setting_value": "09:45",
                "created_at": now(),
            }
        },
        upsert=True,
    )


@superadmin_bp.get("/companies")
@roles_required("super_admin")
def list_companies():
    db = get_db()
    q = {}

    search = (request.args.get("q") or "").strip()

    if search:
        q = {
            "$or": [
                {"name": {"$regex": search, "$options": "i"}},
                {"tenant_id": {"$regex": search, "$options": "i"}},
                {"domain": {"$regex": search, "$options": "i"}},
            ]
        }

    rows = list(db.tenants.find(q).sort("created_at", -1).limit(500))

    for row in rows:
        row["employee_count"] = db.employees.count_documents({
            "tenant_id": row.get("tenant_id"),
            "status": {"$ne": "Inactive"},
        })
        row["user_count"] = db.users.count_documents({
            "tenant_id": row.get("tenant_id"),
        })

    return jsonify({"items": clean_doc(rows)})


@superadmin_bp.post("/companies")
@roles_required("super_admin")
def create_company():
    db = get_db()
    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()

    if not name:
        return jsonify({"message": "Company name is required"}), 400

    tenant_id = (data.get("tenant_id") or slugify(name)).strip().lower()

    if db.tenants.find_one({"tenant_id": tenant_id}):
        return jsonify({"message": "Company / tenant_id already exists"}), 409

    doc = {
        "tenant_id": tenant_id,
        "name": name,
        "domain": (data.get("domain") or "").strip(),
        "contact_email": (data.get("contact_email") or "").strip().lower(),
        "contact_phone": (data.get("contact_phone") or "").strip(),
        "address": data.get("address", ""),
        "status": "active",
        "plan": data.get("plan", "Internal / Trial"),
        "created_at": now(),
        "created_by": str(g.current_user["_id"]),
    }

    db.tenants.insert_one(doc)
    seed_company_masters(db, tenant_id)

    admin_email = (data.get("admin_email") or "").strip().lower()
    admin_password = data.get("admin_password") or "Admin@123"
    admin_name = (data.get("admin_name") or f"{name} Admin").strip()

    if admin_email:
        if db.users.find_one({"email": admin_email}):
            return jsonify({
                "message": "Company created, but admin email already exists. Use User Control to assign a user.",
                "item": clean_doc(db.tenants.find_one({"tenant_id": tenant_id})),
            }), 201

        user_res = db.users.insert_one({
            "tenant_id": tenant_id,
            "name": admin_name,
            "email": admin_email,
            "password_hash": generate_password_hash(admin_password),
            "roles": ["admin", "hr_manager"],
            "is_active": True,
            "created_at": now(),
            "created_by": str(g.current_user["_id"]),
        })

        db.employees.insert_one({
            "tenant_id": tenant_id,
            "user_id": str(user_res.inserted_id),
            "emp_code": f"{tenant_id.upper()}-ADMIN",
            "name": admin_name,
            "email": admin_email,
            "phone": "",
            "country": "India",
            "joining_date": "",
            "date_of_birth": "",
            "blood_group": "",
            "gross_salary": "",
            "branch": "Assam/Guwahati (HO)",
            "department": "HR & Admin",
            "designation": "Manager",
            "role": "Admin",
            "shift": "General",
            "gender": "",
            "job_type": "Regular",
            "project": "Administration",
            "state": "Assam",
            "status": "Active",
            "salary": 0,
            "is_team_leader": "false",
            "is_reporting_officer": "true",
            "team_leader_id": "",
            "team_leader_name": "",
            "reporting_officer_id": "",
            "reporting_officer_name": "",
            "created_at": now(),
            "created_by": str(g.current_user["_id"]),
        })

    audit("create_company", "tenants", tenant_id, doc)

    return jsonify({
        "message": "Company created",
        "item": clean_doc(db.tenants.find_one({"tenant_id": tenant_id})),
    }), 201


@superadmin_bp.patch("/companies/<tenant_id>")
@roles_required("super_admin")
def update_company(tenant_id):
    db = get_db()
    data = request.get_json(silent=True) or {}

    data.pop("_id", None)
    data.pop("tenant_id", None)

    existing = db.tenants.find_one({"tenant_id": tenant_id})

    if not existing:
        return jsonify({"message": "Company not found"}), 404

    data["updated_at"] = now()
    data["updated_by"] = str(g.current_user["_id"])

    db.tenants.update_one({"tenant_id": tenant_id}, {"$set": data})

    audit("update_company", "tenants", tenant_id, data)

    return jsonify({
        "message": "Company updated",
        "item": clean_doc(db.tenants.find_one({"tenant_id": tenant_id})),
    })


@superadmin_bp.get("/users")
@roles_required("super_admin")
def list_users():
    db = get_db()
    q = {}

    tenant_id = (request.args.get("tenant_id") or "").strip()
    search = (request.args.get("q") or "").strip()

    if tenant_id:
        q["tenant_id"] = tenant_id

    if search:
        q["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"tenant_id": {"$regex": search, "$options": "i"}},
        ]

    rows = list(db.users.find(q).sort("created_at", -1).limit(1000))

    for user in rows:
        emp = db.employees.find_one({"user_id": str(user["_id"])})

        if emp:
            user["employee_profile"] = emp

    return jsonify({"items": clean_doc(rows)})


@superadmin_bp.post("/users")
@roles_required("super_admin")
def create_user():
    db = get_db()
    data = request.get_json(silent=True) or {}

    tenant_id = (data.get("tenant_id") or "sds").strip().lower()

    if not db.tenants.find_one({"tenant_id": tenant_id}):
        return jsonify({"message": "Invalid tenant_id / company"}), 400

    email = normalize_email(data.get("email"))
    password = data.get("password") or "User@123"
    name = normalize_text(data.get("name"))

    if not email or not name:
        return jsonify({"message": "Name and email are required"}), 400

    if len(password) < 6:
        return jsonify({"message": "Password must be at least 6 characters"}), 400

    if truthy(data.get("is_reporting_officer")) and not can_be_reporting_officer(data):
        return jsonify({
            "message": "Only Managing Director or Manager can be Reporting Officer"
        }), 400

    if db.users.find_one({"email": email}):
        return jsonify({"message": "Email already exists"}), 409

    employee_id = normalize_text(data.get("employee_id"))

    if employee_id:
        existing_employee_id = db.employees.find_one({
            "tenant_id": tenant_id,
            "employee_id": employee_id,
            "is_deleted": {"$ne": True},
        })

        if existing_employee_id:
            return jsonify({"message": "Employee ID already exists in this tenant"}), 409

    emp_code = normalize_text(data.get("emp_code"))

    if emp_code:
        existing_emp_code = db.employees.find_one({
            "tenant_id": tenant_id,
            "emp_code": emp_code,
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

    roles = normalize_roles(data.get("roles") or ["employee"])

    user_res = db.users.insert_one({
        "tenant_id": tenant_id,
        "name": name,
        "email": email,
        "password_hash": generate_password_hash(password),
        "roles": roles,
        "is_active": truthy(data.get("is_active", True)),
        "created_at": now(),
        "created_by": str(g.current_user["_id"]),
    })

    emp = build_employee_profile_payload(data)
    emp.update({
        "tenant_id": tenant_id,
        "user_id": str(user_res.inserted_id),
        "name": name,
        "email": email,
        "employee_id": employee_id,
        "emp_code": emp_code,
        "team_leader_id": team_leader_id,
        "team_leader_name": resolve_employee_name(db, tenant_id, team_leader_id),
        "reporting_officer_id": reporting_officer_id,
        "reporting_officer_name": reporting_officer_name or "",
        "created_at": now(),
        "created_by": str(g.current_user["_id"]),
    })

    emp.setdefault("country", "India")
    emp.setdefault("branch", "Assam/Guwahati (HO)")
    emp.setdefault("role", "Employee")
    emp.setdefault("shift", "General")
    emp.setdefault("status", "Active")
    emp.setdefault("is_team_leader", "false")
    emp.setdefault("is_reporting_officer", "false")

    emp_res = db.employees.insert_one(emp)
    created_emp = db.employees.find_one({"_id": emp_res.inserted_id})

    if created_emp:
        sync_employee_roles(db, created_emp)

    audit("create_user", "users", user_res.inserted_id, {
        "email": email,
        "roles": roles,
        "tenant_id": tenant_id,
    })

    created_user = db.users.find_one({"_id": user_res.inserted_id})
    created_user["employee_profile"] = created_emp

    return jsonify({
        "message": "User and employee profile created",
        "item": clean_doc(created_user),
    }), 201


@superadmin_bp.patch("/users/<user_id>")
@roles_required("super_admin")
def update_user(user_id):
    db = get_db()
    data = request.get_json(silent=True) or {}

    user_obj_id = safe_object_id(user_id)

    if not user_obj_id:
        return jsonify({"message": "Invalid user id"}), 400

    existing_user = db.users.find_one({"_id": user_obj_id})

    if not existing_user:
        return jsonify({"message": "User not found"}), 404

    existing_emp_for_validation = db.employees.find_one({"user_id": user_id}) or {}
    merged_for_role_check = {**existing_emp_for_validation, **data}

    if truthy(merged_for_role_check.get("is_reporting_officer")) and not can_be_reporting_officer(merged_for_role_check):
        return jsonify({
            "message": "Only Managing Director or Manager can be Reporting Officer"
        }), 400

    user_update = {}

    if "name" in data:
        name = normalize_text(data.get("name"))

        if not name:
            return jsonify({"message": "Name is required"}), 400

        user_update["name"] = name

    if "email" in data:
        email = normalize_email(data.get("email"))

        if not email:
            return jsonify({"message": "Email is required"}), 400

        duplicate = db.users.find_one({
            "email": email,
            "_id": {"$ne": user_obj_id},
        })

        if duplicate:
            return jsonify({"message": "Email already exists for another user"}), 409

        user_update["email"] = email

    if "tenant_id" in data:
        tenant_id = normalize_text(data.get("tenant_id")).lower()

        if not tenant_id:
            return jsonify({"message": "tenant_id is required"}), 400

        if not db.tenants.find_one({"tenant_id": tenant_id}):
            return jsonify({"message": "Invalid tenant_id / company"}), 400

        user_update["tenant_id"] = tenant_id

    if "is_active" in data:
        user_update["is_active"] = truthy(data.get("is_active"))

    if "roles" in data:
        user_update["roles"] = normalize_roles(data.get("roles"))

    if data.get("password"):
        password = data.get("password")

        if len(password) < 6:
            return jsonify({"message": "Password must be at least 6 characters"}), 400

        user_update["password_hash"] = generate_password_hash(password)

    if user_update:
        user_update["updated_at"] = now()
        user_update["updated_by"] = str(g.current_user["_id"])

        db.users.update_one({"_id": user_obj_id}, {"$set": user_update})

    updated_user = db.users.find_one({"_id": user_obj_id})
    tenant_for_lookup = (
        updated_user.get("tenant_id")
        or existing_user.get("tenant_id")
        or "sds"
    )

    existing_emp = db.employees.find_one({"user_id": user_id})
    emp_update = build_employee_profile_payload(data)

    if "name" in user_update:
        emp_update["name"] = user_update["name"]

    if "email" in user_update:
        emp_update["email"] = user_update["email"]

    if "tenant_id" in user_update:
        emp_update["tenant_id"] = user_update["tenant_id"]

    if emp_update.get("employee_id"):
        duplicate_employee_id = db.employees.find_one({
            "_id": {"$ne": existing_emp["_id"]} if existing_emp else {"$exists": True},
            "tenant_id": tenant_for_lookup,
            "employee_id": emp_update.get("employee_id"),
            "is_deleted": {"$ne": True},
        })

        if duplicate_employee_id:
            return jsonify({"message": "Employee ID already exists in this tenant"}), 409

    if emp_update.get("emp_code"):
        duplicate_emp_code = db.employees.find_one({
            "_id": {"$ne": existing_emp["_id"]} if existing_emp else {"$exists": True},
            "tenant_id": tenant_for_lookup,
            "emp_code": emp_update.get("emp_code"),
            "is_deleted": {"$ne": True},
        })

        if duplicate_emp_code:
            return jsonify({"message": "Employee code already exists in this tenant"}), 409

    if "team_leader_id" in emp_update:
        emp_update["team_leader_name"] = resolve_employee_name(
            db,
            tenant_for_lookup,
            emp_update.get("team_leader_id"),
        )

    if "reporting_officer_id" in emp_update:
        reporting_officer_id = emp_update.get("reporting_officer_id") or ""
        reporting_officer_name = resolve_reporting_officer_name(
            db,
            tenant_for_lookup,
            reporting_officer_id,
        )

        if reporting_officer_id and reporting_officer_name is None:
            return jsonify({
                "message": "Selected Reporting Officer must be Managing Director or Manager"
            }), 400

        emp_update["reporting_officer_name"] = reporting_officer_name or ""

    if emp_update:
        emp_update["updated_at"] = now()
        emp_update["updated_by"] = str(g.current_user["_id"])

        if existing_emp:
            db.employees.update_one(
                {"_id": existing_emp["_id"]},
                {"$set": emp_update},
            )
            updated_emp = db.employees.find_one({"_id": existing_emp["_id"]})
        else:
            emp_update.setdefault("tenant_id", tenant_for_lookup)
            emp_update.setdefault("user_id", user_id)
            emp_update.setdefault("name", updated_user.get("name", ""))
            emp_update.setdefault("email", updated_user.get("email", ""))
            emp_update.setdefault("country", "India")
            emp_update.setdefault("branch", "Assam/Guwahati (HO)")
            emp_update.setdefault("role", "Employee")
            emp_update.setdefault("shift", "General")
            emp_update.setdefault("status", "Active")
            emp_update.setdefault("is_team_leader", "false")
            emp_update.setdefault("is_reporting_officer", "false")
            emp_update["created_at"] = now()
            emp_update["created_by"] = str(g.current_user["_id"])

            res = db.employees.insert_one(emp_update)
            updated_emp = db.employees.find_one({"_id": res.inserted_id})

        if updated_emp:
            sync_employee_roles(db, updated_emp)

    audit("update_user", "users", user_id, data)

    refreshed = db.users.find_one({"_id": user_obj_id})
    employee_profile = db.employees.find_one({"user_id": user_id})

    if employee_profile:
        refreshed["employee_profile"] = employee_profile

    return jsonify({
        "message": "User/profile updated",
        "item": clean_doc(refreshed),
    })


@superadmin_bp.post("/users/<user_id>/reset-password")
@roles_required("super_admin")
def reset_password(user_id):
    user_obj_id = safe_object_id(user_id)

    if not user_obj_id:
        return jsonify({"message": "Invalid user id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    password = data.get("password") or "User@123"

    if len(password) < 6:
        return jsonify({"message": "Password must be at least 6 characters"}), 400

    existing = db.users.find_one({"_id": user_obj_id})

    if not existing:
        return jsonify({"message": "User not found"}), 404

    db.users.update_one(
        {"_id": user_obj_id},
        {
            "$set": {
                "password_hash": generate_password_hash(password),
                "updated_at": now(),
                "updated_by": str(g.current_user["_id"]),
            }
        },
    )

    audit("reset_password", "users", user_id)

    return jsonify({"message": "Password reset successful"})