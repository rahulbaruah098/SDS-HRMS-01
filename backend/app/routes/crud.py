from flask import Blueprint, request, jsonify, g
from datetime import datetime
from bson import ObjectId
from werkzeug.security import generate_password_hash
import re

from app.extensions import get_db
from app.utils.auth import current_user_required, audit
from app.utils.serializers import clean_doc

crud_bp = Blueprint("crud", __name__)


ADMIN_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}

PROJECT_CREATOR_ROLES = {
    "team_leader",
    "reporting_officer",
}

READ_ALLOWED_COLLECTIONS = {
    "employees",
    "departments",
    "designations",
    "projects",
    "leave_balances",
    "leave_requests",
    "holiday_calendar",
    "attendance_logs",
    "attendance_mode_requests",
    "compoff_credits",
    "companies",
    "users",
    "notifications",
}

WRITE_ALLOWED_COLLECTIONS = {
    "employees",
    "departments",
    "designations",
    "projects",
    "leave_balances",
    "holiday_calendar",
    "notifications",
}

SOFT_DELETE_COLLECTIONS = {
    "employees",
    "departments",
    "designations",
    "projects",
    "holiday_calendar",
    "attendance_logs",
    "attendance_mode_requests",
    "compoff_credits",
    "notifications",
}

SEARCH_FIELDS = {
    "employees": [
        "name",
        "employee_name",
        "email",
        "phone",
        "employee_id",
        "emp_code",
        "department",
        "designation",
    ],
    "departments": [
        "name",
        "department_name",
        "code",
    ],
    "designations": [
        "name",
        "designation_name",
        "department",
        "title",
    ],
    "projects": [
        "name",
        "project_name",
        "title",
        "description",
        "status",
        "department",
        "assigned_to_name",
        "team_leader_name",
        "reporting_officer_name",
        "assigned_members.employee_name",
        "collaborators.employee_name",
    ],
    "leave_balances": [
        "employee_name",
        "employee_code",
        "emp_code",
        "department",
        "designation",
        "leave_type",
        "leave_type_label",
    ],
    "leave_requests": [
        "employee_name",
        "employee_code",
        "emp_code",
        "leave_type",
        "leave_type_label",
        "reason",
        "status",
        "approval_stage",
        "approval_stage_label",
        "task_handover_to_name",
        "project_handover_name",
    ],
    "holiday_calendar": [
        "title",
        "state",
        "message",
    ],
    "attendance_logs": [
        "employee_name",
        "employee_code",
        "department",
        "designation",
        "status",
        "mode",
    ],
    "attendance_mode_requests": [
        "employee_name",
        "employee_code",
        "department",
        "mode",
        "status",
        "reason",
    ],
    "compoff_credits": [
        "employee_name",
        "employee_code",
        "department",
        "status",
        "holiday_title",
    ],
    "notifications": [
        "title",
        "body",
        "status",
    ],
}

LEAVE_TYPE_ALIASES = {
    "CL": "CL",
    "CASUAL": "CL",
    "CASUAL LEAVE": "CL",
    "CASUAL_LEAVE": "CL",
    "EL": "EL",
    "EARNED": "EL",
    "EARNED LEAVE": "EL",
    "EARNED_LEAVE": "EL",
    "COMP OFF": "COMP-OFF",
    "COMPOFF": "COMP-OFF",
    "COMP-OFF": "COMP-OFF",
    "COMPENSATORY LEAVE": "COMP-OFF",
    "COMPENSATORY OFF": "COMP-OFF",
}

BALANCE_LEAVE_TYPES = {"CL", "EL"}

PROJECT_WRITE_STATUSES = {
    "active",
    "on_hold",
    "completed",
}

PROFILE_PHOTO_FIELDS = {
    "avatar",
    "profile_photo",
    "profile_picture",
    "photo",
}


def safe_object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def normalize_text(value):
    return str(value or "").strip()


def normalize_key(value):
    return normalize_text(value).lower()


def normalize_role_key(value):
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def now_utc():
    return datetime.utcnow()


def current_tenant_id():
    if hasattr(g, "tenant_id") and g.tenant_id:
        return g.tenant_id

    current_user = getattr(g, "current_user", {}) or {}

    return current_user.get("tenant_id") or "sds"


def current_user_id():
    current_user = getattr(g, "current_user", {}) or {}
    return str(current_user.get("_id") or current_user.get("id") or "")


def current_user_name():
    current_user = getattr(g, "current_user", {}) or {}
    return (
        current_user.get("name")
        or current_user.get("full_name")
        or current_user.get("email")
        or current_user.get("username")
        or "User"
    )


def current_user_roles():
    current_user = getattr(g, "current_user", {}) or {}
    roles = current_user.get("roles", [])

    if isinstance(roles, list):
        return {
            normalize_role_key(role)
            for role in roles
            if normalize_role_key(role)
        }

    if isinstance(roles, str):
        return {
            normalize_role_key(role)
            for role in roles.split(",")
            if normalize_role_key(role)
        }

    role = normalize_role_key(current_user.get("role"))
    return {role} if role else set()


def has_any_role(role_set):
    return bool(current_user_roles().intersection(role_set))


def is_super_admin():
    return "super_admin" in current_user_roles()


def truthy(value):
    return str(value or "").strip().lower() in {"true", "1", "yes", "on"}


def normalize_email(value):
    return normalize_text(value).lower()


def employee_avatar_from_payload(payload):
    return (
        normalize_text(payload.get("avatar"))
        or normalize_text(payload.get("profile_photo"))
        or normalize_text(payload.get("profile_picture"))
        or normalize_text(payload.get("photo"))
        or normalize_text(payload.get("image"))
        or normalize_text(payload.get("picture"))
    )


def apply_avatar_aliases(payload, avatar_value=None):
    avatar = normalize_text(avatar_value) or employee_avatar_from_payload(payload)

    if avatar:
        payload["avatar"] = avatar
        payload["profile_photo"] = avatar
        payload["profile_picture"] = avatar
        payload["photo"] = avatar

    return payload


def normalize_role_value(value):
    role_key = normalize_role_key(value)

    role_map = {
        "super_admin": "super_admin",
        "admin": "admin",
        "hr": "hr",
        "hr_admin": "hr_admin",
        "hr_manager": "hr_manager",
        "finance": "finance",
        "accounts_finance": "accounts_finance",
        "manager": "manager",
        "ro": "ro",
        "team_leader": "team_leader",
        "reporting_officer": "reporting_officer",
        "employee": "employee",
    }

    return role_map.get(role_key, "employee")


def normalize_roles(value):
    if not value:
        return ["employee"]

    if isinstance(value, str):
        roles = [role.strip() for role in value.split(",") if role.strip()]
    elif isinstance(value, list):
        roles = [str(role).strip() for role in value if str(role).strip()]
    else:
        roles = ["employee"]

    cleaned_roles = []

    for role in roles:
        normalized = normalize_role_value(role)

        if normalized in {"team_leader", "reporting_officer", "manager", "ro"}:
            normalized = "employee"

        if normalized not in cleaned_roles:
            cleaned_roles.append(normalized)

    return cleaned_roles or ["employee"]


def employee_role_set(employee_doc):
    if not employee_doc:
        return set()

    raw_roles = employee_doc.get("roles", [])

    if isinstance(raw_roles, list):
        roles = {normalize_role_key(role) for role in raw_roles if normalize_role_key(role)}
    elif isinstance(raw_roles, str):
        roles = {normalize_role_key(role) for role in raw_roles.split(",") if normalize_role_key(role)}
    else:
        roles = set()

    raw_role = normalize_role_key(employee_doc.get("role"))

    if raw_role:
        roles.add(raw_role)

    return roles


def build_employee_capability_roles(employee_doc, current_user_roles=None):
    current_user_roles = set(current_user_roles or [])

    protected_roles = {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "finance",
        "accounts_finance",
    }

    capability_roles = {
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
    }

    roles = set(current_user_roles)

    if not roles.intersection(protected_roles):
        roles.difference_update(capability_roles)
        roles.add("employee")

    if truthy(employee_doc.get("is_team_leader")):
        roles.add("team_leader")
    else:
        roles.discard("team_leader")

    if truthy(employee_doc.get("is_reporting_officer")):
        roles.add("reporting_officer")
    else:
        roles.discard("reporting_officer")
        roles.discard("manager")
        roles.discard("ro")

    if not roles:
        roles.add("employee")

    return sorted(list(roles))


def employee_name_from_payload(payload):
    return (
        normalize_text(payload.get("name"))
        or normalize_text(payload.get("employee_name"))
        or normalize_text(payload.get("full_name"))
    )


def employee_email_from_payload(payload):
    return normalize_email(payload.get("email") or payload.get("official_email"))


def employee_joining_date(payload):
    return (
        normalize_text(payload.get("joining_date"))
        or normalize_text(payload.get("date_of_joining"))
        or normalize_text(payload.get("doj"))
    )


def remove_employee_auth_fields(payload):
    for key in [
        "password",
        "confirm_password",
        "password_confirm",
        "new_password",
        "password_mode",
    ]:
        payload.pop(key, None)

    return payload


def find_employee_user(db, employee_doc):
    user_id = employee_doc.get("user_id")
    user_obj_id = safe_object_id(user_id)

    if user_obj_id:
        user = db.users.find_one({"_id": user_obj_id})
        if user:
            return user

    email = employee_email_from_payload(employee_doc)

    if email:
        return db.users.find_one({
            "email": email,
            "tenant_id": employee_doc.get("tenant_id") or current_tenant_id(),
            "is_deleted": {"$ne": True},
        })

    return None


def build_user_sync_payload(employee_doc, existing_user=None):
    existing_user = existing_user or {}
    name = employee_name_from_payload(employee_doc)
    email = employee_email_from_payload(employee_doc)
    status = normalize_text(employee_doc.get("status") or "active")
    avatar = employee_avatar_from_payload(employee_doc)

    is_active = not (
        status.lower() in {"inactive", "disabled", "deleted"}
        or truthy(employee_doc.get("is_deleted"))
    )

    roles = build_employee_capability_roles(
        employee_doc,
        normalize_roles(existing_user.get("roles") if existing_user else ["employee"]),
    )

    payload = {
        "tenant_id": employee_doc.get("tenant_id") or current_tenant_id(),
        "name": name,
        "full_name": name,
        "email": email,
        "username": email,
        "roles": roles,
        "role": "employee",
        "employee_id": str(employee_doc.get("_id")) if employee_doc.get("_id") else employee_doc.get("employee_id", ""),
        "employee_ref_id": str(employee_doc.get("_id")) if employee_doc.get("_id") else "",
        "emp_code": employee_doc.get("emp_code") or employee_doc.get("employee_id") or employee_doc.get("code") or "",
        "department": employee_doc.get("department", ""),
        "designation": employee_doc.get("designation", ""),
        "is_active": is_active,
        "status": "active" if is_active else "inactive",
        "updated_at": now_utc(),
    }

    if avatar:
        apply_avatar_aliases(payload, avatar)

    if employee_doc.get("department_id"):
        payload["department_id"] = employee_doc.get("department_id")

    if employee_doc.get("designation_id"):
        payload["designation_id"] = employee_doc.get("designation_id")

    return payload


def ensure_employee_login_user(db, employee_doc, raw_password=None):
    email = employee_email_from_payload(employee_doc)
    name = employee_name_from_payload(employee_doc)

    if not name:
        return None, "Employee name is required"

    if not email:
        return None, "Employee email is required to create login account"

    apply_avatar_aliases(employee_doc)

    existing_user = find_employee_user(db, employee_doc)

    if existing_user:
        employee_doc["user_id"] = str(existing_user["_id"])
        sync_payload = build_user_sync_payload(employee_doc, existing_user)
        update_doc = {"$set": sync_payload}

        if raw_password:
            if len(str(raw_password)) < 6:
                return None, "Password must be at least 6 characters"
            update_doc["$set"]["password_hash"] = generate_password_hash(str(raw_password))

        db.users.update_one({"_id": existing_user["_id"]}, update_doc)
        return db.users.find_one({"_id": existing_user["_id"]}), ""

    duplicate = db.users.find_one({
        "email": email,
        "is_deleted": {"$ne": True},
    })

    if duplicate:
        return None, "A user with this email already exists"

    password = str(raw_password or "User@123")

    if len(password) < 6:
        return None, "Password must be at least 6 characters"

    now = now_utc()
    user_payload = build_user_sync_payload(employee_doc, {})
    user_payload.update({
        "password_hash": generate_password_hash(password),
        "created_at": now,
        "created_by": current_user_id(),
        "created_by_name": current_user_name(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
        "is_deleted": False,
    })

    result = db.users.insert_one(user_payload)
    user_payload["_id"] = result.inserted_id
    employee_doc["user_id"] = str(result.inserted_id)

    return user_payload, ""


def sync_employee_login_user(db, employee_doc, raw_password=None):
    apply_avatar_aliases(employee_doc)

    user = find_employee_user(db, employee_doc)

    if not user:
        return ensure_employee_login_user(db, employee_doc, raw_password)

    email = employee_email_from_payload(employee_doc)

    if email and email != normalize_email(user.get("email")):
        duplicate = db.users.find_one({
            "email": email,
            "_id": {"$ne": user["_id"]},
            "is_deleted": {"$ne": True},
        })

        if duplicate:
            return None, "A user with this email already exists"

    update_data = build_user_sync_payload(employee_doc, user)
    update_data.update({
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    })

    if raw_password:
        if len(str(raw_password)) < 6:
            return None, "Password must be at least 6 characters"

        update_data["password_hash"] = generate_password_hash(str(raw_password))

    db.users.update_one(
        {"_id": user["_id"]},
        {"$set": update_data},
    )

    return db.users.find_one({"_id": user["_id"]}), ""


def deactivate_employee_login_user(db, employee_doc):
    user = find_employee_user(db, employee_doc)

    if not user:
        return

    db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "is_active": False,
                "status": "inactive",
                "updated_at": now_utc(),
                "updated_by": current_user_id(),
                "updated_by_name": current_user_name(),
            }
        },
    )


def normalize_leave_type(value):
    key = normalize_text(value).upper()
    return LEAVE_TYPE_ALIASES.get(key, key)


def leave_type_label(value):
    leave_type = normalize_leave_type(value)

    labels = {
        "CL": "Casual Leave",
        "EL": "Earned Leave",
        "COMP-OFF": "Comp-Off",
    }

    return labels.get(leave_type, normalize_text(value) or "Leave")


def parse_float(value, default=0.0):
    if value in [None, ""]:
        return float(default)

    try:
        return float(value)
    except Exception:
        return float(default)


def employee_display_name(employee):
    if not employee:
        return "Employee"

    return (
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or employee.get("email")
        or "Employee"
    )


def employee_code(employee):
    if not employee:
        return ""

    return (
        employee.get("employee_id")
        or employee.get("emp_code")
        or employee.get("employee_code")
        or employee.get("code")
        or ""
    )


def employee_avatar(employee):
    if not employee:
        return ""

    return employee_avatar_from_payload(employee)


def get_current_employee(db):
    user_id = current_user_id()

    if not user_id:
        return None

    employee = db.employees.find_one({
        "tenant_id": current_tenant_id(),
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee

    return db.employees.find_one({
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })


def employee_is_team_leader(employee):
    if not employee:
        return False

    return (
        truthy(employee.get("is_team_leader"))
        or "team_leader" in employee_role_set(employee)
    )


def employee_is_reporting_officer(employee):
    if not employee:
        return False

    return (
        truthy(employee.get("is_reporting_officer"))
        or "reporting_officer" in employee_role_set(employee)
        or "ro" in employee_role_set(employee)
    )


def can_create_assign_or_collaborate_projects():
    db = get_db()
    roles = current_user_roles()
    employee = get_current_employee(db)

    return bool(
        roles.intersection(PROJECT_CREATOR_ROLES)
        or employee_is_team_leader(employee)
        or employee_is_reporting_officer(employee)
    )


def project_member_ids(project):
    ids = set()

    for key in [
        "created_by_employee_id",
        "team_leader_id",
        "reporting_officer_id",
        "assigned_to_id",
        "latest_progress_by",
    ]:
        value = normalize_text(project.get(key))
        if value:
            ids.add(value)

    for key in ["assigned_employee_ids", "collaborator_ids"]:
        values = project.get(key, [])
        if isinstance(values, list):
            ids.update(normalize_text(value) for value in values if normalize_text(value))

    for key in ["assigned_members", "collaborators"]:
        values = project.get(key, [])
        if isinstance(values, list):
            for item in values:
                if isinstance(item, dict):
                    employee_id = normalize_text(item.get("employee_id") or item.get("_id") or item.get("id"))
                    if employee_id:
                        ids.add(employee_id)

    return ids


def can_update_project_status(project):
    db = get_db()
    employee = get_current_employee(db)

    if not employee:
        return False

    return str(employee["_id"]) in project_member_ids(project)


def can_write_collection(collection):
    roles = current_user_roles()

    if collection not in WRITE_ALLOWED_COLLECTIONS:
        return False

    if collection == "projects":
        return can_create_assign_or_collaborate_projects()

    if roles.intersection(ADMIN_ROLES):
        return True

    return False


def is_profile_photo_only_payload(data):
    payload_keys = {
        key
        for key in (data or {}).keys()
        if key not in {"_id", "id"}
    }

    return bool(payload_keys) and payload_keys.issubset(PROFILE_PHOTO_FIELDS)


def can_update_own_employee_photo(db, item_id, data):
    if not is_profile_photo_only_payload(data):
        return False

    employee_obj_id = safe_object_id(item_id)

    if not employee_obj_id:
        return False

    user_id = current_user_id()

    if not user_id:
        return False

    employee = db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": current_tenant_id(),
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if employee:
        return True

    current_employee = get_current_employee(db)

    if not current_employee:
        return False

    return str(current_employee.get("_id")) == str(employee_obj_id)


def collection_exists(collection):
    return collection in READ_ALLOWED_COLLECTIONS


def get_collection(db, collection):
    if not collection_exists(collection):
        return None

    return getattr(db, collection)


def clean_payload(data):
    blocked_keys = {
        "_id",
        "id",
        "created_at",
        "created_by",
        "created_by_name",
        "updated_at",
        "updated_by",
        "updated_by_name",
        "deleted_at",
        "deleted_by",
        "is_deleted",
    }

    payload = {}

    for key, value in (data or {}).items():
        if key in blocked_keys:
            continue

        payload[key] = value

    return payload


def build_search_query(collection, search_text):
    search_text = normalize_text(search_text)

    if not search_text:
        return {}

    fields = SEARCH_FIELDS.get(collection, [])
    regex = re.compile(re.escape(search_text), re.IGNORECASE)

    return {
        "$or": [
            {field: regex}
            for field in fields
        ]
    } if fields else {}


def base_scope_query(collection):
    q = {
        "is_deleted": {"$ne": True},
    }

    tenant_arg = normalize_text(request.args.get("tenant_id"))

    if is_super_admin() and tenant_arg:
        q["tenant_id"] = tenant_arg
    elif collection not in {"companies"}:
        q["tenant_id"] = current_tenant_id()

    return q


def apply_common_filters(collection, q):
    status = normalize_text(request.args.get("status"))
    department = normalize_text(request.args.get("department"))
    employee_id = normalize_text(request.args.get("employee_id"))
    leave_type = normalize_leave_type(request.args.get("leave_type"))
    approval_stage = normalize_text(request.args.get("approval_stage"))
    mode = normalize_text(request.args.get("mode"))
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))
    q_text = normalize_text(request.args.get("q") or request.args.get("search"))

    if status:
        if collection == "projects":
            q["status"] = normalize_project_status(status)
        else:
            q["status"] = status

    if department:
        q["department"] = department

    if employee_id:
        q["employee_id"] = employee_id

    if leave_type and collection in {"leave_balances", "leave_requests"}:
        q["leave_type"] = leave_type

    if approval_stage and collection == "leave_requests":
        q["approval_stage"] = approval_stage

    if mode and collection in {"attendance_logs", "attendance_mode_requests"}:
        q["mode"] = mode

    if collection in {"attendance_logs", "holiday_calendar", "attendance_mode_requests"} and (date_from or date_to):
        q["date"] = {}

        if date_from:
            q["date"]["$gte"] = date_from

        if date_to:
            q["date"]["$lte"] = date_to

    if collection == "leave_requests" and (date_from or date_to):
        start = date_from or "0000-01-01"
        end = date_to or "9999-12-31"
        q["from_date"] = {"$lte": end}
        q["to_date"] = {"$gte": start}

    search_query = build_search_query(collection, q_text)

    if search_query:
        if "$or" in q:
            q = {
                "$and": [
                    q,
                    search_query,
                ]
            }
        else:
            q.update(search_query)

    return q


def project_scope_query(db, q):
    roles = current_user_roles()

    if roles.intersection(ADMIN_ROLES):
        return q

    employee = get_current_employee(db)

    if not employee:
        q["_id"] = {"$exists": False}
        return q

    employee_id = str(employee["_id"])

    q["$or"] = [
        {"created_by_employee_id": employee_id},
        {"team_leader_id": employee_id},
        {"reporting_officer_id": employee_id},
        {"assigned_to_id": employee_id},
        {"assigned_employee_ids": employee_id},
        {"assigned_members.employee_id": employee_id},
        {"collaborator_ids": employee_id},
        {"collaborators.employee_id": employee_id},
        {"latest_progress_by": employee_id},
    ]

    return q


def employee_scoped_ids_for_current_user(db):
    roles = current_user_roles()

    if roles.intersection(ADMIN_ROLES):
        return None

    employee = get_current_employee(db)

    if not employee:
        return []

    employee_id = str(employee["_id"])
    scope_or = []

    if "team_leader" in roles or employee_is_team_leader(employee):
        scope_or.append({"team_leader_id": employee_id})

    if "reporting_officer" in roles or employee_is_reporting_officer(employee):
        scope_or.append({"reporting_officer_id": employee_id})

    if not scope_or:
        return [employee_id]

    rows = list(db.employees.find({
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "status": {"$ne": "Inactive"},
        "is_deleted": {"$ne": True},
        "$or": scope_or,
    }, {"_id": 1}))

    scoped_ids = [str(row["_id"]) for row in rows]

    if employee_id not in scoped_ids:
        scoped_ids.append(employee_id)

    return scoped_ids


def employee_owned_collection_scope(db, q, employee_field="employee_id"):
    scoped_ids = employee_scoped_ids_for_current_user(db)

    if scoped_ids is None:
        return q

    q[employee_field] = {"$in": scoped_ids}
    return q


def leave_request_scope_query(db, q):
    roles = current_user_roles()

    if roles.intersection(ADMIN_ROLES):
        return q

    employee = get_current_employee(db)

    if not employee:
        q["_id"] = {"$exists": False}
        return q

    employee_id = str(employee["_id"])
    scope_or = [{"employee_id": employee_id}]

    if "team_leader" in roles or employee_is_team_leader(employee):
        scope_or.append({
            "team_leader_id": employee_id,
            "approval_stage": "team_leader",
        })

    if "reporting_officer" in roles or employee_is_reporting_officer(employee):
        scope_or.append({
            "reporting_officer_id": employee_id,
            "approval_stage": "reporting_officer",
        })

    if "$or" in q:
        q = {
            "$and": [
                q,
                {"$or": scope_or},
            ]
        }
    else:
        q["$or"] = scope_or

    return q


def notification_scope_query(q):
    roles = current_user_roles()

    if roles.intersection(ADMIN_ROLES):
        return q

    q["user_id"] = current_user_id()
    return q


def scoped_query_for_collection(db, collection):
    q = base_scope_query(collection)
    q = apply_common_filters(collection, q)

    if collection == "projects":
        q = project_scope_query(db, q)

    if collection in {"leave_balances", "attendance_logs", "attendance_mode_requests", "compoff_credits"}:
        q = employee_owned_collection_scope(db, q, "employee_id")

    if collection == "leave_requests":
        q = leave_request_scope_query(db, q)

    if collection == "notifications":
        q = notification_scope_query(q)

    if collection == "employees":
        roles = current_user_roles()

        if not roles.intersection(ADMIN_ROLES):
            scoped_ids = employee_scoped_ids_for_current_user(db)

            if scoped_ids is not None:
                object_ids = [
                    safe_object_id(item)
                    for item in scoped_ids
                    if safe_object_id(item)
                ]

                q["_id"] = {"$in": object_ids}

    return q


def normalize_project_status(status):
    value = normalize_key(status)

    if value in {"completed", "complete", "done", "closed", "inactive"}:
        return "completed"

    if value in {"active", "ongoing", "in_progress", "in-progress", "open"}:
        return "active"

    if value in {"on_hold", "on-hold", "hold"}:
        return "on_hold"

    return "active"


def normalize_id_list(value):
    if value is None:
        return []

    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = value.split(",")
    else:
        raw_values = [value]

    cleaned = []
    seen = set()

    for item in raw_values:
        if isinstance(item, dict):
            raw = item.get("employee_id") or item.get("_id") or item.get("id")
        else:
            raw = item

        item_id = normalize_text(raw)

        if item_id and item_id not in seen:
            cleaned.append(item_id)
            seen.add(item_id)

    return cleaned


def resolve_employee_for_project(db, employee_id, tenant_id):
    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return None

    return db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": tenant_id,
        "status": {"$ne": "Inactive"},
        "is_deleted": {"$ne": True},
    })


def project_member_payload(employee, relation="member"):
    return {
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "employee_name": employee_display_name(employee),
        "name": employee_display_name(employee),
        "email": employee.get("email", ""),
        "phone": employee.get("phone", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "user_id": employee.get("user_id", ""),
        "avatar": employee_avatar(employee),
        "profile_photo": employee_avatar(employee),
        "profile_picture": employee_avatar(employee),
        "photo": employee_avatar(employee),
        "is_team_leader": truthy(employee.get("is_team_leader")),
        "is_reporting_officer": truthy(employee.get("is_reporting_officer")),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
        "relation": relation,
    }


def resolve_project_member_list(db, tenant_id, employee_ids, relation="assigned_member"):
    resolved_ids = []
    members = []

    for employee_id in normalize_id_list(employee_ids):
        employee = resolve_employee_for_project(db, employee_id, tenant_id)

        if not employee:
            raise ValueError("One or more selected employees were not found")

        resolved_ids.append(str(employee["_id"]))
        members.append(project_member_payload(employee, relation))

    return resolved_ids, members


def resolve_project_employee(db, tenant_id, employee_id):
    if not employee_id:
        return None

    return resolve_employee_for_project(db, employee_id, tenant_id)


def resolve_project_team_leader(db, tenant_id, payload, existing=None, current_employee=None):
    existing = existing or {}
    current_employee = current_employee or get_current_employee(db)

    raw_team_leader_id = normalize_text(
        payload.get("team_leader_id")
        or existing.get("team_leader_id")
    )

    if raw_team_leader_id:
        employee = resolve_project_employee(db, tenant_id, raw_team_leader_id)
        if employee:
            return employee

    if current_employee and employee_is_team_leader(current_employee):
        return current_employee

    return None


def resolve_project_reporting_officer(db, tenant_id, payload, existing=None, team_leader=None, current_employee=None):
    existing = existing or {}
    current_employee = current_employee or get_current_employee(db)

    raw_reporting_officer_id = normalize_text(
        payload.get("reporting_officer_id")
        or existing.get("reporting_officer_id")
    )

    if raw_reporting_officer_id:
        employee = resolve_project_employee(db, tenant_id, raw_reporting_officer_id)
        if employee:
            return employee

    if current_employee and employee_is_reporting_officer(current_employee):
        return current_employee

    if team_leader and team_leader.get("reporting_officer_id"):
        employee = resolve_project_employee(db, tenant_id, team_leader.get("reporting_officer_id"))
        if employee:
            return employee

    if current_employee and current_employee.get("reporting_officer_id"):
        employee = resolve_project_employee(db, tenant_id, current_employee.get("reporting_officer_id"))
        if employee:
            return employee

    return None


def enrich_member_from_db(db, tenant_id, member, relation):
    if not isinstance(member, dict):
        return {}

    employee_id = normalize_text(member.get("employee_id") or member.get("_id") or member.get("id"))
    employee = resolve_project_employee(db, tenant_id, employee_id)

    if employee:
        return project_member_payload(employee, relation)

    fallback = dict(member)
    fallback["employee_id"] = employee_id
    fallback["employee_name"] = (
        fallback.get("employee_name")
        or fallback.get("name")
        or fallback.get("email")
        or "Employee"
    )
    fallback["name"] = fallback.get("employee_name")
    fallback["avatar"] = (
        fallback.get("avatar")
        or fallback.get("profile_photo")
        or fallback.get("profile_picture")
        or fallback.get("photo")
        or ""
    )
    fallback["profile_photo"] = fallback.get("avatar")
    fallback["profile_picture"] = fallback.get("avatar")
    fallback["photo"] = fallback.get("avatar")
    fallback["relation"] = relation
    return fallback


def unique_people(people):
    result = []
    seen = set()

    for person in people:
        if not isinstance(person, dict):
            continue

        person_id = normalize_text(
            person.get("employee_id")
            or person.get("_id")
            or person.get("id")
            or person.get("user_id")
            or person.get("email")
        )

        if not person_id:
            continue

        relation = normalize_text(person.get("relation"))
        key = f"{person_id}:{relation}"

        if key in seen:
            continue

        seen.add(key)
        result.append(person)

    return result


def build_project_team_tree(db, project):
    tenant_id = project.get("tenant_id") or current_tenant_id()

    team_leader = resolve_project_employee(db, tenant_id, project.get("team_leader_id"))
    reporting_officer = resolve_project_employee(db, tenant_id, project.get("reporting_officer_id"))

    if not reporting_officer and team_leader and team_leader.get("reporting_officer_id"):
        reporting_officer = resolve_project_employee(db, tenant_id, team_leader.get("reporting_officer_id"))

    assigned_members = [
        enrich_member_from_db(db, tenant_id, member, "assigned_member")
        for member in project.get("assigned_members", [])
        if isinstance(member, dict)
    ]

    collaborators = [
        enrich_member_from_db(db, tenant_id, member, "collaborator")
        for member in project.get("collaborators", [])
        if isinstance(member, dict)
    ]

    latest_progress_person = {}
    latest_progress_by = normalize_text(project.get("latest_progress_by"))

    if latest_progress_by:
        latest_employee = resolve_project_employee(db, tenant_id, latest_progress_by)
        if latest_employee:
            latest_progress_person = project_member_payload(latest_employee, "latest_progress_by")

    if not latest_progress_person and project.get("latest_progress_by_name"):
        latest_progress_person = {
            "employee_id": latest_progress_by,
            "employee_name": project.get("latest_progress_by_name"),
            "name": project.get("latest_progress_by_name"),
            "employee_code": "",
            "department": project.get("department", ""),
            "designation": "",
            "avatar": project.get("latest_progress_by_avatar", ""),
            "profile_photo": project.get("latest_progress_by_avatar", ""),
            "relation": "latest_progress_by",
        }

    reporting_officer_payload = (
        project_member_payload(reporting_officer, "reporting_officer")
        if reporting_officer
        else {
            "employee_id": project.get("reporting_officer_id", ""),
            "employee_name": project.get("reporting_officer_name", ""),
            "name": project.get("reporting_officer_name", ""),
            "designation": "Reporting Officer",
            "department": project.get("department", ""),
            "avatar": "",
            "profile_photo": "",
            "relation": "reporting_officer",
        }
        if project.get("reporting_officer_name")
        else {}
    )

    team_leader_payload = (
        project_member_payload(team_leader, "team_leader")
        if team_leader
        else {
            "employee_id": project.get("team_leader_id", ""),
            "employee_name": project.get("team_leader_name", ""),
            "name": project.get("team_leader_name", ""),
            "designation": "Team Leader",
            "department": project.get("department", ""),
            "avatar": "",
            "profile_photo": "",
            "relation": "team_leader",
        }
        if project.get("team_leader_name")
        else {}
    )

    doing_people = assigned_members if assigned_members else []
    if not doing_people and latest_progress_person:
        doing_people = [latest_progress_person]

    all_people = unique_people([
        reporting_officer_payload,
        team_leader_payload,
        *assigned_members,
        *collaborators,
        latest_progress_person,
    ])

    return {
        "reporting_officer": reporting_officer_payload,
        "team_leader": team_leader_payload,
        "assigned_members": assigned_members,
        "collaborators": collaborators,
        "doing_people": doing_people,
        "latest_progress_person": latest_progress_person,
        "all_people": all_people,
        "tree_levels": [
            {
                "level": 1,
                "label": "Reporting Officer",
                "people": [reporting_officer_payload] if reporting_officer_payload else [],
            },
            {
                "level": 2,
                "label": "Team Leader",
                "people": [team_leader_payload] if team_leader_payload else [],
            },
            {
                "level": 3,
                "label": "Team Members Doing Project",
                "people": assigned_members,
            },
            {
                "level": 4,
                "label": "Collaborators",
                "people": collaborators,
            },
        ],
        "connection_label": "Reporting Officer → Team Leader → Team Members → Collaborators",
    }


def normalize_project_payload(payload, existing=None):
    existing = existing or {}
    db = get_db()
    employee = get_current_employee(db)
    tenant_id = payload.get("tenant_id") or existing.get("tenant_id") or current_tenant_id()

    name = (
        payload.get("name")
        or payload.get("project_name")
        or payload.get("title")
        or existing.get("name")
        or existing.get("project_name")
        or ""
    )

    status = normalize_project_status(
        payload.get("status")
        or existing.get("status")
        or "active"
    )

    assigned_employee_ids = payload.get("assigned_employee_ids")
    collaborator_ids = payload.get("collaborator_ids")

    if assigned_employee_ids is None:
        assigned_employee_ids = payload.get("assigned_to_ids") or payload.get("assigned_members")

    if collaborator_ids is None:
        collaborator_ids = payload.get("collaborators_ids") or payload.get("collaborators")

    if assigned_employee_ids is None:
        assigned_employee_ids = existing.get("assigned_employee_ids", [])

    if collaborator_ids is None:
        collaborator_ids = existing.get("collaborator_ids", [])

    try:
        assigned_employee_ids, assigned_members = resolve_project_member_list(
            db,
            tenant_id,
            assigned_employee_ids,
            "assigned_member",
        )
        collaborator_ids, collaborators = resolve_project_member_list(
            db,
            tenant_id,
            collaborator_ids,
            "collaborator",
        )
    except ValueError:
        assigned_employee_ids = existing.get("assigned_employee_ids", []) if existing else []
        assigned_members = existing.get("assigned_members", []) if existing else []
        collaborator_ids = existing.get("collaborator_ids", []) if existing else []
        collaborators = existing.get("collaborators", []) if existing else []

    team_leader = resolve_project_team_leader(db, tenant_id, payload, existing, employee)
    reporting_officer = resolve_project_reporting_officer(
        db,
        tenant_id,
        payload,
        existing,
        team_leader,
        employee,
    )

    payload["name"] = normalize_text(name)
    payload["project_name"] = normalize_text(name)
    payload["title"] = normalize_text(name)
    payload["status"] = status
    payload["assigned_employee_ids"] = assigned_employee_ids
    payload["assigned_members"] = assigned_members
    payload["assigned_to_id"] = assigned_employee_ids[0] if assigned_employee_ids else ""
    payload["assigned_to_name"] = assigned_members[0]["employee_name"] if assigned_members else ""
    payload["collaborator_ids"] = collaborator_ids
    payload["collaborators"] = collaborators

    if team_leader:
        payload["team_leader_id"] = str(team_leader["_id"])
        payload["team_leader_name"] = employee_display_name(team_leader)
    else:
        payload["team_leader_id"] = existing.get("team_leader_id", "")
        payload["team_leader_name"] = existing.get("team_leader_name", "")

    if reporting_officer:
        payload["reporting_officer_id"] = str(reporting_officer["_id"])
        payload["reporting_officer_name"] = employee_display_name(reporting_officer)
    else:
        payload["reporting_officer_id"] = existing.get("reporting_officer_id", "")
        payload["reporting_officer_name"] = existing.get("reporting_officer_name", "")

    if employee:
        payload.setdefault("department", employee.get("department", "") or existing.get("department", ""))

    if status == "completed":
        payload["completed_at"] = existing.get("completed_at") or now_utc()
    elif "completed_at" in payload:
        payload["completed_at"] = ""

    temp_project = dict(existing)
    temp_project.update(payload)
    payload["project_team_tree"] = build_project_team_tree(db, temp_project)

    return payload


def validate_required_fields(collection, payload):
    if collection == "projects":
        if not normalize_text(payload.get("name") or payload.get("project_name")):
            return "Project name is required"

    if collection == "employees":
        if not normalize_text(payload.get("name") or payload.get("employee_name")):
            return "Employee name is required"

    if collection in {"departments", "designations"}:
        if not normalize_text(payload.get("name") or payload.get("title")):
            return "Name is required"

    return ""


def serialize_list(items):
    return clean_doc(items)


def serialize_item(item):
    return clean_doc(item)


def get_employee_for_balance(db, employee_id):
    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return None

    q = {
        "_id": employee_obj_id,
        "is_deleted": {"$ne": True},
    }

    if not is_super_admin():
        q["tenant_id"] = current_tenant_id()

    return db.employees.find_one(q)


def ensure_leave_balance(db, employee, leave_type):
    leave_type = normalize_leave_type(leave_type)
    tenant_id = employee.get("tenant_id") or current_tenant_id()

    existing = db.leave_balances.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "leave_type": leave_type,
        "is_deleted": {"$ne": True},
    })

    if existing:
        return existing

    now = now_utc()

    doc = {
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "employee_name": employee_display_name(employee),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "leave_type": leave_type,
        "leave_type_label": leave_type_label(leave_type),
        "opening_balance": 0.0,
        "credited": 0.0,
        "used": 0.0,
        "available": 0.0,
        "status": "active",
        "created_at": now,
        "updated_at": now,
        "created_by": current_user_id(),
        "created_by_name": current_user_name(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
        "is_deleted": False,
    }

    result = db.leave_balances.insert_one(doc)
    doc["_id"] = result.inserted_id

    return doc


def leave_balance_payload_for_type(data, leave_type):
    leave_type = normalize_leave_type(leave_type)

    if leave_type == "CL":
        nested = (
            data.get("CL")
            if isinstance(data.get("CL"), dict)
            else data.get("cl")
            if isinstance(data.get("cl"), dict)
            else data.get("casual_leave")
            if isinstance(data.get("casual_leave"), dict)
            else {}
        )
        raw_total = data.get("CL") or data.get("cl") or data.get("casual_leave")
        prefixes = ["cl", "casual", "casual_leave"]
    else:
        nested = (
            data.get("EL")
            if isinstance(data.get("EL"), dict)
            else data.get("el")
            if isinstance(data.get("el"), dict)
            else data.get("earned_leave")
            if isinstance(data.get("earned_leave"), dict)
            else {}
        )
        raw_total = data.get("EL") or data.get("el") or data.get("earned_leave")
        prefixes = ["el", "earned", "earned_leave"]

    payload = {}

    if isinstance(raw_total, (int, float, str)) and normalize_text(raw_total):
        payload["opening_balance"] = raw_total
        payload["credited"] = 0

    if isinstance(nested, dict):
        payload.update(nested)

    field_groups = {
        "opening_balance": [],
        "credited": [],
        "used": [],
        "available": [],
        "status": [],
    }

    for prefix in prefixes:
        field_groups["opening_balance"].extend([
            f"{prefix}_opening_balance",
            f"{prefix}_opening",
            f"{prefix}_balance",
        ])
        field_groups["credited"].extend([
            f"{prefix}_credited",
            f"{prefix}_credit",
        ])
        field_groups["used"].extend([
            f"{prefix}_used",
            f"{prefix}_used_leave",
        ])
        field_groups["available"].extend([
            f"{prefix}_available",
            f"{prefix}_available_leave",
        ])
        field_groups["status"].append(f"{prefix}_status")

    for target_key, source_keys in field_groups.items():
        for source_key in source_keys:
            if data.get(source_key) not in [None, ""]:
                payload[target_key] = data.get(source_key)
                break

    return payload


def upsert_leave_balance_from_payload(db, employee, leave_type, payload):
    leave_type = normalize_leave_type(leave_type)

    if leave_type not in BALANCE_LEAVE_TYPES:
        raise ValueError("Only Casual Leave and Earned Leave balances can be managed here")

    existing = ensure_leave_balance(db, employee, leave_type)

    opening_balance = parse_float(
        payload.get("opening_balance", existing.get("opening_balance", 0)),
        existing.get("opening_balance", 0),
    )
    credited = parse_float(
        payload.get("credited", existing.get("credited", 0)),
        existing.get("credited", 0),
    )
    used = parse_float(
        payload.get("used", existing.get("used", 0)),
        existing.get("used", 0),
    )

    opening_balance = max(opening_balance, 0)
    credited = max(credited, 0)
    used = max(used, 0)

    calculated_available = max(opening_balance + credited - used, 0)

    if payload.get("available") not in [None, ""]:
        available = max(parse_float(payload.get("available"), calculated_available), 0)
    else:
        available = calculated_available

    status = normalize_text(payload.get("status") or existing.get("status") or "active").lower()

    update_data = {
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "employee_name": employee_display_name(employee),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "leave_type": leave_type,
        "leave_type_label": leave_type_label(leave_type),
        "opening_balance": opening_balance,
        "credited": credited,
        "used": used,
        "available": available,
        "status": status or "active",
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
        "is_deleted": False,
    }

    db.leave_balances.update_one(
        {"_id": existing["_id"]},
        {"$set": update_data},
    )

    return db.leave_balances.find_one({"_id": existing["_id"]})


def save_combined_leave_balances(db, raw_employee_id, data):
    employee_id = normalize_text(
        raw_employee_id
        or data.get("employee_id")
        or data.get("employee")
        or data.get("user_id")
    )

    if not employee_id:
        return None, {"message": "employee_id is required"}, 400

    employee = get_employee_for_balance(db, employee_id)

    if not employee:
        return None, {"message": "Employee not found"}, 404

    updated_types = []
    updated_items = []

    for leave_type in ["CL", "EL"]:
        payload = leave_balance_payload_for_type(data, leave_type)

        if not payload:
            continue

        if data.get("status") and "status" not in payload:
            payload["status"] = data.get("status")

        try:
            updated_items.append(
                upsert_leave_balance_from_payload(db, employee, leave_type, payload)
            )
        except ValueError as exc:
            return None, {"message": str(exc)}, 400

        updated_types.append(leave_type)

    if not updated_types:
        return None, {
            "message": "Send Casual Leave and/or Earned Leave balance details"
        }, 400

    items = list(db.leave_balances.find({
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "employee_id": str(employee["_id"]),
        "is_deleted": {"$ne": True},
    }).sort("leave_type", 1))

    audit("set_leave_balance", "leave_balances", str(employee["_id"]), data)

    return {
        "message": "Leave balances updated successfully",
        "updated_types": updated_types,
        "updated_items": serialize_list(updated_items),
        "items": serialize_list(items),
    }, None, None


def enrich_leave_request(row):
    row = dict(row or {})
    status = normalize_text(row.get("status")).lower()
    stage = normalize_text(row.get("approval_stage")).lower()

    if status == "approved" or stage == "approved":
        live_status = "Approved"
    elif status == "rejected" or stage == "rejected":
        live_status = "Rejected"
    elif stage == "team_leader":
        live_status = "Pending with Team Leader"
    elif stage == "reporting_officer":
        live_status = "Pending with Reporting Officer"
    elif stage == "hr":
        live_status = "Pending with HR"
    else:
        live_status = "Pending" if status == "pending" else status.title() if status else "—"

    row["live_status"] = live_status
    row["status_text"] = live_status
    row["status_display"] = live_status

    if not row.get("approval_stage_label"):
        label_map = {
            "team_leader": "Team Leader",
            "reporting_officer": "Reporting Officer",
            "hr": "HR",
            "approved": "Approved",
            "rejected": "Rejected",
        }
        row["approval_stage_label"] = label_map.get(stage, stage or "")

    if not row.get("leave_type_label"):
        row["leave_type_label"] = leave_type_label(row.get("leave_type"))

    return row


def enrich_project_item(item):
    item = dict(item or {})
    db = get_db()
    item["project_team_tree"] = build_project_team_tree(db, item)

    tree = item.get("project_team_tree") or {}
    reporting_officer = tree.get("reporting_officer") or {}
    team_leader = tree.get("team_leader") or {}
    doing_people = tree.get("doing_people") or []

    item["reporting_officer"] = reporting_officer
    item["team_leader"] = team_leader
    item["assigned_members"] = tree.get("assigned_members", item.get("assigned_members", []))
    item["collaborators"] = tree.get("collaborators", item.get("collaborators", []))
    item["doing_people"] = doing_people
    item["doing_people_names"] = [
        person.get("employee_name") or person.get("name")
        for person in doing_people
        if person.get("employee_name") or person.get("name")
    ]
    item["doing_person_name"] = item["doing_people_names"][0] if item["doing_people_names"] else item.get("assigned_to_name", "")

    item["reporting_officer_id"] = item.get("reporting_officer_id") or reporting_officer.get("employee_id", "")
    item["reporting_officer_name"] = item.get("reporting_officer_name") or reporting_officer.get("employee_name", "")
    item["team_leader_id"] = item.get("team_leader_id") or team_leader.get("employee_id", "")
    item["team_leader_name"] = item.get("team_leader_name") or team_leader.get("employee_name", "")

    item["can_create_assign_collaborate"] = can_create_assign_or_collaborate_projects()
    item["can_create_projects"] = can_create_assign_or_collaborate_projects()
    item["can_assign_projects"] = can_create_assign_or_collaborate_projects()
    item["can_add_collaborators"] = can_create_assign_or_collaborate_projects()
    item["can_update_status_progress"] = can_update_project_status(item)

    return item


def enrich_items(collection, items):
    if collection == "leave_requests":
        return [enrich_leave_request(item) for item in items]

    if collection == "projects":
        return [enrich_project_item(item) for item in items]

    return items


@crud_bp.get("/<collection>")
@current_user_required
def list_collection(collection):
    collection = normalize_key(collection)

    if not collection_exists(collection):
        return jsonify({
            "message": f"Collection '{collection}' is not available"
        }), 404

    db = get_db()
    mongo_collection = get_collection(db, collection)

    q = scoped_query_for_collection(db, collection)

    try:
        page = int(request.args.get("page", 1))
    except Exception:
        page = 1

    try:
        limit = int(request.args.get("limit", 200))
    except Exception:
        limit = 200

    page = max(page, 1)
    limit = min(max(limit, 1), 500)
    skip = (page - 1) * limit

    sort_by = normalize_text(request.args.get("sort_by")) or "created_at"
    sort_dir = normalize_text(request.args.get("sort_dir")).lower()
    sort_order = 1 if sort_dir == "asc" else -1

    if collection == "leave_balances" and sort_by == "created_at":
        sort_by = "employee_name"

    if collection == "leave_requests" and sort_by == "created_at":
        sort_by = "from_date"

    total = mongo_collection.count_documents(q)

    items = list(
        mongo_collection
        .find(q)
        .sort(sort_by, sort_order)
        .skip(skip)
        .limit(limit)
    )

    items = enrich_items(collection, items)

    response = {
        "items": serialize_list(items),
        "total": total,
        "page": page,
        "limit": limit,
        "collection": collection,
    }

    if collection == "projects":
        can_manage = can_create_assign_or_collaborate_projects()
        response.update({
            "can_create_assign_collaborate": can_manage,
            "can_create_projects": can_manage,
            "can_assign_projects": can_manage,
            "can_add_collaborators": can_manage,
        })

    return jsonify(response)


@crud_bp.get("/<collection>/<item_id>")
@current_user_required
def get_collection_item(collection, item_id):
    collection = normalize_key(collection)

    if not collection_exists(collection):
        return jsonify({
            "message": f"Collection '{collection}' is not available"
        }), 404

    item_obj_id = safe_object_id(item_id)

    if not item_obj_id:
        return jsonify({"message": "Invalid item id"}), 400

    db = get_db()
    mongo_collection = get_collection(db, collection)

    q = scoped_query_for_collection(db, collection)
    q["_id"] = item_obj_id

    item = mongo_collection.find_one(q)

    if not item:
        return jsonify({"message": "Record not found"}), 404

    if collection == "leave_requests":
        item = enrich_leave_request(item)

    if collection == "projects":
        item = enrich_project_item(item)

    return jsonify({
        "item": serialize_item(item),
    })


@crud_bp.post("/<collection>")
@current_user_required
def create_collection_item(collection):
    collection = normalize_key(collection)

    if not collection_exists(collection):
        return jsonify({
            "message": f"Collection '{collection}' is not available"
        }), 404

    if collection == "projects" and not can_create_assign_or_collaborate_projects():
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can create projects"
        }), 403

    if not can_write_collection(collection):
        return jsonify({
            "message": "You do not have permission to create this record"
        }), 403

    data = request.get_json(silent=True) or {}

    if collection == "leave_balances":
        result, error, status_code = save_combined_leave_balances(
            get_db(),
            data.get("employee_id"),
            data,
        )

        if error:
            return jsonify(error), status_code

        return jsonify(result), 201

    payload = clean_payload(data)
    raw_password = data.get("password") or data.get("new_password")

    if collection == "projects":
        payload = normalize_project_payload(payload)

    validation_error = validate_required_fields(collection, payload)

    if validation_error:
        return jsonify({"message": validation_error}), 400

    db = get_db()
    mongo_collection = get_collection(db, collection)
    now = now_utc()

    payload.setdefault("tenant_id", current_tenant_id())

    if collection == "employees":
        payload["name"] = employee_name_from_payload(payload)
        payload["employee_name"] = payload["name"]
        payload["email"] = employee_email_from_payload(payload)
        payload.setdefault("status", "active")

        joining_date = employee_joining_date(payload)

        if joining_date:
            payload["joining_date"] = joining_date
            payload.setdefault("date_of_joining", joining_date)

        apply_avatar_aliases(payload)
        remove_employee_auth_fields(payload)

        user, user_error = ensure_employee_login_user(db, payload, raw_password)

        if user_error:
            return jsonify({"message": user_error}), 400

        if user:
            payload["user_id"] = str(user["_id"])

    payload.update({
        "created_at": now,
        "updated_at": now,
        "created_by": current_user_id(),
        "created_by_name": current_user_name(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
        "is_deleted": False,
    })

    if collection == "projects":
        employee = get_current_employee(db)

        if employee:
            payload.setdefault("created_by_employee_id", str(employee["_id"]))
            payload.setdefault("created_by_employee_name", employee_display_name(employee))

    result = mongo_collection.insert_one(payload)
    payload["_id"] = result.inserted_id

    if collection == "employees":
        user, user_error = sync_employee_login_user(db, payload, raw_password)

        if user_error:
            mongo_collection.delete_one({"_id": result.inserted_id})
            return jsonify({"message": user_error}), 400

        if user:
            mongo_collection.update_one(
                {"_id": result.inserted_id},
                {"$set": {
                    "user_id": str(user["_id"]),
                    "avatar": payload.get("avatar", ""),
                    "profile_photo": payload.get("profile_photo", ""),
                    "profile_picture": payload.get("profile_picture", ""),
                    "photo": payload.get("photo", ""),
                }},
            )
            payload["user_id"] = str(user["_id"])

        for leave_type in BALANCE_LEAVE_TYPES:
            ensure_leave_balance(db, payload, leave_type)

    if collection == "projects":
        updated_project = mongo_collection.find_one({"_id": result.inserted_id})
        mongo_collection.update_one(
            {"_id": result.inserted_id},
            {"$set": {"project_team_tree": build_project_team_tree(db, updated_project)}},
        )
        payload = mongo_collection.find_one({"_id": result.inserted_id})

    audit("create", collection, result.inserted_id, payload)

    message = "Record created successfully"

    if collection == "employees":
        message = "Employee and login account created successfully"

    if collection == "projects":
        message = "Project created successfully"

    return jsonify({
        "message": message,
        "item": serialize_item(enrich_project_item(payload) if collection == "projects" else payload),
    }), 201


@crud_bp.patch("/<collection>/<item_id>")
@current_user_required
def update_collection_item(collection, item_id):
    collection = normalize_key(collection)

    if not collection_exists(collection):
        return jsonify({
            "message": f"Collection '{collection}' is not available"
        }), 404

    data = request.get_json(silent=True) or {}
    db = get_db()

    self_photo_update = (
        collection == "employees"
        and not has_any_role(ADMIN_ROLES)
        and can_update_own_employee_photo(db, item_id, data)
    )

    if collection == "projects" and not can_create_assign_or_collaborate_projects():
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can edit project details"
        }), 403

    if not self_photo_update and not can_write_collection(collection):
        return jsonify({
            "message": "You do not have permission to update this record"
        }), 403

    if collection == "leave_balances":
        result, error, status_code = save_combined_leave_balances(
            db,
            item_id,
            data,
        )

        if error:
            return jsonify(error), status_code

        return jsonify(result)

    item_obj_id = safe_object_id(item_id)

    if not item_obj_id:
        return jsonify({"message": "Invalid item id"}), 400

    mongo_collection = get_collection(db, collection)

    q = scoped_query_for_collection(db, collection)
    q["_id"] = item_obj_id

    existing = mongo_collection.find_one(q)

    if not existing:
        return jsonify({"message": "Record not found or not in your scope"}), 404

    payload = clean_payload(data)
    raw_password = data.get("password") or data.get("new_password")

    if collection == "projects":
        payload = normalize_project_payload(payload, existing)

    if collection == "employees":
        merged_employee = dict(existing)
        merged_employee.update(payload)
        merged_employee["_id"] = existing["_id"]
        merged_employee.setdefault("tenant_id", existing.get("tenant_id") or current_tenant_id())

        if payload.get("name") or payload.get("employee_name") or payload.get("full_name"):
            payload["name"] = employee_name_from_payload(merged_employee)
            payload["employee_name"] = payload["name"]
            merged_employee["name"] = payload["name"]
            merged_employee["employee_name"] = payload["name"]

        if payload.get("email") or payload.get("official_email"):
            payload["email"] = employee_email_from_payload(merged_employee)
            merged_employee["email"] = payload["email"]

        avatar = employee_avatar_from_payload(merged_employee)
        if avatar:
            apply_avatar_aliases(payload, avatar)
            apply_avatar_aliases(merged_employee, avatar)

        joining_date = employee_joining_date(merged_employee)

        if joining_date and (
            payload.get("joining_date")
            or payload.get("date_of_joining")
            or payload.get("doj")
        ):
            payload["joining_date"] = joining_date
            payload["date_of_joining"] = joining_date
            merged_employee["joining_date"] = joining_date
            merged_employee["date_of_joining"] = joining_date

        remove_employee_auth_fields(payload)

        user, user_error = sync_employee_login_user(db, merged_employee, raw_password)

        if user_error:
            return jsonify({"message": user_error}), 400

        if user:
            payload["user_id"] = str(user["_id"])

    validation_error = "" if self_photo_update else validate_required_fields(collection, payload)

    if validation_error:
        return jsonify({"message": validation_error}), 400

    payload.update({
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    })

    mongo_collection.update_one(
        {"_id": item_obj_id},
        {"$set": payload},
    )

    updated = mongo_collection.find_one({"_id": item_obj_id})

    if collection == "employees":
        sync_employee_login_user(db, updated)

        for leave_type in BALANCE_LEAVE_TYPES:
            ensure_leave_balance(db, updated, leave_type)

        updated = mongo_collection.find_one({"_id": item_obj_id})

    if collection == "projects":
        mongo_collection.update_one(
            {"_id": item_obj_id},
            {"$set": {"project_team_tree": build_project_team_tree(db, updated)}},
        )
        updated = mongo_collection.find_one({"_id": item_obj_id})

    audit("update", collection, item_id, payload)

    message = "Record updated successfully"

    if collection == "employees":
        message = "Employee and login account updated successfully"

    if collection == "projects":
        message = "Project updated successfully"

    return jsonify({
        "message": message,
        "item": serialize_item(enrich_project_item(updated) if collection == "projects" else updated),
    })


@crud_bp.delete("/<collection>/<item_id>")
@current_user_required
def delete_collection_item(collection, item_id):
    collection = normalize_key(collection)

    if not collection_exists(collection):
        return jsonify({
            "message": f"Collection '{collection}' is not available"
        }), 404

    if collection == "leave_balances":
        return jsonify({
            "message": "Leave Balances should be updated instead of deleted"
        }), 400

    if collection == "projects" and not can_create_assign_or_collaborate_projects():
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can delete projects"
        }), 403

    if not can_write_collection(collection):
        return jsonify({
            "message": "You do not have permission to delete this record"
        }), 403

    item_obj_id = safe_object_id(item_id)

    if not item_obj_id:
        return jsonify({"message": "Invalid item id"}), 400

    db = get_db()
    mongo_collection = get_collection(db, collection)

    q = scoped_query_for_collection(db, collection)
    q["_id"] = item_obj_id

    existing = mongo_collection.find_one(q)

    if not existing:
        return jsonify({"message": "Record not found or not in your scope"}), 404

    if collection == "employees":
        deactivate_employee_login_user(db, existing)

    if collection in SOFT_DELETE_COLLECTIONS:
        mongo_collection.update_one(
            {"_id": item_obj_id},
            {
                "$set": {
                    "is_deleted": True,
                    "status": "inactive",
                    "deleted_at": now_utc(),
                    "deleted_by": current_user_id(),
                    "deleted_by_name": current_user_name(),
                    "updated_at": now_utc(),
                    "updated_by": current_user_id(),
                    "updated_by_name": current_user_name(),
                }
            },
        )
    else:
        mongo_collection.delete_one({"_id": item_obj_id})

    audit("delete", collection, item_id)

    message = "Record deleted successfully"

    if collection == "employees":
        message = "Employee deleted and login account deactivated successfully"

    if collection == "projects":
        message = "Project deleted successfully"

    return jsonify({
        "message": message,
    })


@crud_bp.patch("/projects/<project_id>/status")
@current_user_required
def update_project_status(project_id):
    project_obj_id = safe_object_id(project_id)

    if not project_obj_id:
        return jsonify({"message": "Invalid project id"}), 400

    db = get_db()
    q = scoped_query_for_collection(db, "projects")
    q["_id"] = project_obj_id

    existing = db.projects.find_one(q)

    if not existing:
        return jsonify({"message": "Project not found or not in your scope"}), 404

    if not can_update_project_status(existing):
        return jsonify({
            "message": "You do not have permission to update status for this project"
        }), 403

    data = request.get_json(silent=True) or {}
    status = normalize_project_status(data.get("status"))

    if status not in PROJECT_WRITE_STATUSES:
        return jsonify({
            "message": "Project status must be active, on_hold, or completed"
        }), 400

    update_data = {
        "status": status,
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    if status == "completed":
        update_data["completed_at"] = now_utc()
        update_data["completed_by"] = current_user_id()
        update_data["completed_by_name"] = current_user_name()
    else:
        update_data["completed_at"] = ""

    db.projects.update_one(
        {"_id": project_obj_id},
        {"$set": update_data},
    )

    updated = db.projects.find_one({"_id": project_obj_id})

    db.projects.update_one(
        {"_id": project_obj_id},
        {"$set": {"project_team_tree": build_project_team_tree(db, updated)}},
    )

    updated = db.projects.find_one({"_id": project_obj_id})

    audit("update_status", "projects", project_id, update_data)

    return jsonify({
        "message": "Project status updated successfully",
        "item": clean_doc(enrich_project_item(updated)),
    })


@crud_bp.patch("/projects/<project_id>/assign")
@current_user_required
def assign_project(project_id):
    if not can_create_assign_or_collaborate_projects():
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can assign this project"
        }), 403

    project_obj_id = safe_object_id(project_id)

    if not project_obj_id:
        return jsonify({"message": "Invalid project id"}), 400

    db = get_db()
    q = scoped_query_for_collection(db, "projects")
    q["_id"] = project_obj_id

    existing = db.projects.find_one(q)

    if not existing:
        return jsonify({"message": "Project not found or not in your scope"}), 404

    data = request.get_json(silent=True) or {}
    tenant_id = existing.get("tenant_id") or current_tenant_id()

    try:
        assigned_employee_ids, assigned_members = resolve_project_member_list(
            db,
            tenant_id,
            data.get("assigned_employee_ids") or data.get("assigned_to_ids") or [],
            "assigned_member",
        )
        collaborator_ids, collaborators = resolve_project_member_list(
            db,
            tenant_id,
            data.get("collaborator_ids") or [],
            "collaborator",
        )
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400

    update_data = {
        "assigned_to_id": assigned_employee_ids[0] if assigned_employee_ids else "",
        "assigned_to_name": assigned_members[0]["employee_name"] if assigned_members else "",
        "assigned_employee_ids": assigned_employee_ids,
        "assigned_members": assigned_members,
        "collaborator_ids": collaborator_ids,
        "collaborators": collaborators,
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    db.projects.update_one(
        {"_id": project_obj_id},
        {"$set": update_data},
    )

    updated = db.projects.find_one({"_id": project_obj_id})

    db.projects.update_one(
        {"_id": project_obj_id},
        {"$set": {"project_team_tree": build_project_team_tree(db, updated)}},
    )

    updated = db.projects.find_one({"_id": project_obj_id})

    audit("assign", "projects", project_id, update_data)

    return jsonify({
        "message": "Project assignment updated successfully",
        "item": clean_doc(enrich_project_item(updated)),
    })


@crud_bp.patch("/projects/<project_id>/collaborators")
@current_user_required
def update_project_collaborators(project_id):
    if not can_create_assign_or_collaborate_projects():
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can update collaborators"
        }), 403

    project_obj_id = safe_object_id(project_id)

    if not project_obj_id:
        return jsonify({"message": "Invalid project id"}), 400

    db = get_db()
    q = scoped_query_for_collection(db, "projects")
    q["_id"] = project_obj_id

    existing = db.projects.find_one(q)

    if not existing:
        return jsonify({"message": "Project not found or not in your scope"}), 404

    data = request.get_json(silent=True) or {}
    tenant_id = existing.get("tenant_id") or current_tenant_id()

    try:
        collaborator_ids, collaborators = resolve_project_member_list(
            db,
            tenant_id,
            data.get("collaborator_ids") or [],
            "collaborator",
        )
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400

    update_data = {
        "collaborator_ids": collaborator_ids,
        "collaborators": collaborators,
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    db.projects.update_one(
        {"_id": project_obj_id},
        {"$set": update_data},
    )

    updated = db.projects.find_one({"_id": project_obj_id})

    db.projects.update_one(
        {"_id": project_obj_id},
        {"$set": {"project_team_tree": build_project_team_tree(db, updated)}},
    )

    updated = db.projects.find_one({"_id": project_obj_id})

    audit("update_collaborators", "projects", project_id, update_data)

    return jsonify({
        "message": "Project collaborators updated successfully",
        "item": clean_doc(enrich_project_item(updated)),
    })