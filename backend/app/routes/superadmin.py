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

    if truthy(employee_doc.get("is_reporting_officer")):
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
            "department": "HR & Admin",
            "designation": "Manager",
            "job_type": "Regular",
            "project": "Administration",
            "state": "Assam",
            "status": "Active",
            "salary": 0,
            "created_at": now(),
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

    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or "User@123"
    name = (data.get("name") or "").strip()

    if not email or not name:
        return jsonify({"message": "Name and email are required"}), 400

    if len(password) < 6:
        return jsonify({"message": "Password must be at least 6 characters"}), 400

    if db.users.find_one({"email": email}):
        return jsonify({"message": "Email already exists"}), 409

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

    team_leader_id = data.get("team_leader_id") or ""
    reporting_officer_id = data.get("reporting_officer_id") or ""

    emp = {
        "tenant_id": tenant_id,
        "user_id": str(user_res.inserted_id),
        "emp_code": data.get("emp_code") or "",
        "name": name,
        "email": email,
        "department": data.get("department", ""),
        "designation": data.get("designation", ""),
        "job_type": data.get("job_type", "Regular"),
        "project": data.get("project", ""),
        "state": data.get("state", ""),
        "status": data.get("status") or data.get("employee_status") or "Active",
        "salary": float(data.get("salary") or 0),
        "is_team_leader": data.get("is_team_leader", "false"),
        "is_reporting_officer": data.get("is_reporting_officer", "false"),
        "team_leader_id": team_leader_id,
        "team_leader_name": resolve_employee_name(db, tenant_id, team_leader_id),
        "reporting_officer_id": reporting_officer_id,
        "reporting_officer_name": resolve_employee_name(db, tenant_id, reporting_officer_id),
        "created_at": now(),
        "created_by": str(g.current_user["_id"]),
    }

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

    user_update = {}

    if "name" in data:
        name = (data.get("name") or "").strip()

        if not name:
            return jsonify({"message": "Name is required"}), 400

        user_update["name"] = name

    if "email" in data:
        email = (data.get("email") or "").strip().lower()

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
        tenant_id = (data.get("tenant_id") or "").strip().lower()

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

    emp_update = {}

    employee_fields = [
        "emp_code",
        "department",
        "designation",
        "job_type",
        "project",
        "state",
        "status",
        "salary",
        "name",
        "email",
        "is_team_leader",
        "is_reporting_officer",
        "team_leader_id",
        "reporting_officer_id",
    ]

    for key in employee_fields:
        if key in data:
            emp_update[key] = data[key]

    if "name" in user_update:
        emp_update["name"] = user_update["name"]

    if "email" in user_update:
        emp_update["email"] = user_update["email"]

    if "tenant_id" in user_update:
        emp_update["tenant_id"] = user_update["tenant_id"]

    if "salary" in emp_update:
        try:
            emp_update["salary"] = float(emp_update.get("salary") or 0)
        except Exception:
            emp_update["salary"] = 0

    if "email" in emp_update:
        emp_update["email"] = (emp_update.get("email") or "").strip().lower()

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

    existing_emp = db.employees.find_one({"user_id": user_id})

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
            emp_update.setdefault("status", "Active")
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