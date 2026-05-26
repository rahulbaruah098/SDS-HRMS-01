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
    "organisations",
    "departments",
    "designations",
    "states",
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
    "performance_reviews",
}

WRITE_ALLOWED_COLLECTIONS = {
    "employees",
    "organisations",
    "departments",
    "designations",
    "states",
    "projects",
    "leave_balances",
    "holiday_calendar",
    "notifications",
}

SOFT_DELETE_COLLECTIONS = {
    "employees",
    "organisations",
    "departments",
    "designations",
    "states",
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
        "full_name",
        "email",
        "official_email",
        "phone",
        "mobile",
        "employee_id",
        "emp_code",
        "employee_code",
        "organisation",
        "organization",
        "organisation_name",
        "organization_name",
        "organisation_code",
        "organization_code",
        "department",
        "department_name",
        "designation",
        "designation_name",
        "branch",
        "state",
        "role",
        "employee_type",
        "job_type",
        "status",
        "employment_status",
        "resignation_reason",
        "exit_type",
        "last_working_date",
        "is_it_support_head",
        "is_it_support_member",
    ],
    "organisations": [
        "name",
        "organisation_name",
        "organization_name",
        "code",
        "organisation_code",
        "organization_code",
        "status",
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
    "states": [
        "name",
        "state_name",
        "code",
        "status",
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
    "performance_reviews": [
        "employee_name",
        "employee_code",
        "emp_code",
        "department",
        "designation",
        "reviewer_name",
        "reviewer_employee_name",
        "reviewer_role",
        "review_target_type",
        "review_scope_label",
        "cycle",
        "period_type",
        "week_label",
        "month_label",
        "year",
        "rating_label",
        "score_label",
        "remarks",
        "comment",
        "notes",
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
    "image",
    "picture",
}

REPORTING_OFFICER_DESIGNATION_REGEX = re.compile(
    r"(manager|managing director|director|ceo|chief executive officer)",
    re.IGNORECASE,
)


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


def bool_string(value):
    return "true" if truthy(value) else "false"


def normalize_employee_it_support_flags(payload):
    if not isinstance(payload, dict):
        return payload

    if "is_it_support_head" in payload:
        payload["is_it_support_head"] = bool_string(payload.get("is_it_support_head"))

    if "is_it_support_member" in payload:
        payload["is_it_support_member"] = bool_string(payload.get("is_it_support_member"))

    if truthy(payload.get("is_it_support_head")):
        payload["is_it_support_member"] = "true"

    return payload


def normalize_employee_capability_flags(payload):
    if not isinstance(payload, dict):
        return payload

    if "is_team_leader" in payload:
        payload["is_team_leader"] = bool_string(payload.get("is_team_leader"))

    if "is_reporting_officer" in payload:
        payload["is_reporting_officer"] = bool_string(payload.get("is_reporting_officer"))

    normalize_employee_it_support_flags(payload)

    return payload

def normalize_employee_organisation_fields(payload):
    organisation_id = normalize_text(
        payload.get("organisation_id")
        or payload.get("organization_id")
    )

    organisation_name = normalize_text(
        payload.get("organisation")
        or payload.get("organization")
        or payload.get("organisation_name")
        or payload.get("organization_name")
    )

    organisation_code = normalize_text(
        payload.get("organisation_code")
        or payload.get("organization_code")
    ).upper()

    payload["organisation_id"] = organisation_id
    payload["organization_id"] = organisation_id

    payload["organisation"] = organisation_name
    payload["organization"] = organisation_name
    payload["organisation_name"] = organisation_name
    payload["organization_name"] = organisation_name

    payload["organisation_code"] = organisation_code
    payload["organization_code"] = organisation_code

    return payload

def normalize_master_payload(collection, payload):
    if not isinstance(payload, dict):
        return payload

    if collection == "states":
        name = normalize_text(payload.get("name") or payload.get("state_name"))
        if name:
            payload["name"] = name
            payload["state_name"] = name
        payload["status"] = normalize_text(payload.get("status") or "active")
        
    if collection == "organisations":
        name = normalize_text(
            payload.get("name")
            or payload.get("title")
            or payload.get("organisation_name")
            or payload.get("organization_name")
        )
        code = normalize_text(
            payload.get("code")
            or payload.get("organisation_code")
            or payload.get("organization_code")
        ).upper()

    if name:
        payload["name"] = name
        payload["title"] = name
        payload["organisation_name"] = name
        payload["organization_name"] = name

        if code:
            payload["code"] = code
            payload["organisation_code"] = code
            payload["organization_code"] = code

        payload["status"] = normalize_text(payload.get("status") or "active")

    if collection == "departments":
        name = normalize_text(payload.get("name") or payload.get("department_name"))
        if name:
            payload["name"] = name
            payload["department_name"] = name
        payload["status"] = normalize_text(payload.get("status") or "active")

    if collection == "designations":
        name = normalize_text(
            payload.get("name")
            or payload.get("title")
            or payload.get("designation_name")
        )
        if name:
            payload["name"] = name
            payload["title"] = name
            payload["designation_name"] = name
        payload["status"] = normalize_text(payload.get("status") or "active")

    return payload


def normalize_email(value):
    return normalize_text(value).lower()


def safe_employee_avatar_value(value):
    avatar = normalize_text(value)

    if not avatar:
        return ""

    # Never store large base64 images in employee/user/project/dashboard payloads.
    # This prevents Team Leader dashboard crashes after profile photo upload.
    if avatar.startswith("data:image") and len(avatar) > 5000:
        return ""

    # Normal uploaded image paths should be short:
    # /uploads/profile_photos/employee.jpg
    # uploads/profile_photos/employee.jpg
    # https://domain.com/photo.jpg
    if len(avatar) > 1000 and not avatar.startswith("http"):
        return ""

    return avatar

def employee_avatar_from_payload(payload):
    payload = payload or {}

    return (
        safe_employee_avatar_value(payload.get("avatar"))
        or safe_employee_avatar_value(payload.get("profile_photo"))
        or safe_employee_avatar_value(payload.get("profile_picture"))
        or safe_employee_avatar_value(payload.get("photo"))
        or safe_employee_avatar_value(payload.get("image"))
        or safe_employee_avatar_value(payload.get("picture"))
        or ""
    )

def apply_avatar_aliases(payload, avatar_value=None):
    payload = payload or {}
    avatar = safe_employee_avatar_value(avatar_value) or employee_avatar_from_payload(payload)

    if avatar:
        payload["avatar"] = avatar
        payload["profile_photo"] = avatar
        payload["profile_picture"] = avatar
        payload["photo"] = avatar
    else:
        # Remove unsafe photo fields from the payload before saving/syncing.
        for key in [
            "avatar",
            "profile_photo",
            "profile_picture",
            "photo",
            "image",
            "picture",
        ]:
            if payload.get(key) and not safe_employee_avatar_value(payload.get(key)):
                payload.pop(key, None)

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


def employee_date_of_birth(payload):
    return (
        normalize_text(payload.get("date_of_birth"))
        or normalize_text(payload.get("dob"))
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
        "is_team_leader": bool_string(employee_doc.get("is_team_leader")),
        "is_reporting_officer": bool_string(employee_doc.get("is_reporting_officer")),
        "team_leader_id": employee_doc.get("team_leader_id", ""),
        "team_leader_name": employee_doc.get("team_leader_name", ""),
        "reporting_officer_id": employee_doc.get("reporting_officer_id", ""),
        "reporting_officer_name": employee_doc.get("reporting_officer_name", ""),
        "is_it_support_head": bool_string(employee_doc.get("is_it_support_head")),
        "is_it_support_member": bool_string(employee_doc.get("is_it_support_member") or employee_doc.get("is_it_support_head")),
        "date_of_birth": employee_doc.get("date_of_birth", "") or employee_doc.get("dob", ""),
        "dob": employee_doc.get("dob", "") or employee_doc.get("date_of_birth", ""),
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
                "is_it_support_head": "false",
                "is_it_support_member": "false",
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

def employee_identifier_values(employee):
    employee = employee or {}
    values = []

    for value in [
        employee.get("_id"),
        employee.get("id"),
        employee.get("employee_id"),
        employee.get("employee_ref_id"),
        employee.get("employee_code"),
        employee.get("emp_code"),
        employee.get("code"),
        employee.get("user_id"),
        employee.get("email"),
        employee.get("official_email"),
    ]:
        value = normalize_text(value)

        if value and value not in values:
            values.append(value)

    return values


def employee_avatar(employee):
    if not employee:
        return ""

    return employee_avatar_from_payload(employee)


def get_current_employee(db):
    user_id = current_user_id()
    current_user = getattr(g, "current_user", {}) or {}

    if not user_id:
        return None

    user_email = normalize_email(
        current_user.get("email")
        or current_user.get("username")
        or current_user.get("official_email")
    )

    user_employee_id = normalize_text(
        current_user.get("employee_id")
        or current_user.get("employee_ref_id")
        or current_user.get("emp_code")
    )

    identifier_or = [
        {"user_id": user_id},
        {"employee_ref_id": user_id},
    ]

    user_obj_id = safe_object_id(user_id)

    if user_obj_id:
        identifier_or.append({"_id": user_obj_id})

    if user_employee_id:
        identifier_or.extend([
            {"employee_id": user_employee_id},
            {"emp_code": user_employee_id},
            {"employee_code": user_employee_id},
        ])

        user_employee_obj_id = safe_object_id(user_employee_id)

        if user_employee_obj_id:
            identifier_or.append({"_id": user_employee_obj_id})

    if user_email:
        identifier_or.extend([
            {"email": user_email},
            {"official_email": user_email},
        ])

    employee = db.employees.find_one({
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
        "$or": identifier_or,
    })

    if employee:
        return employee

    return db.employees.find_one({
        "is_deleted": {"$ne": True},
        "$or": identifier_or,
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


def reporting_officer_designation_allowed(employee):
    if not employee:
        return False

    values = [
        employee.get("designation"),
        employee.get("designation_name"),
        employee.get("title"),
        employee.get("position"),
    ]

    return any(
        REPORTING_OFFICER_DESIGNATION_REGEX.search(normalize_text(value))
        for value in values
        if normalize_text(value)
    )


def employee_reporting_officer_designation_query():
    return {
        "$or": [
            {"designation": REPORTING_OFFICER_DESIGNATION_REGEX},
            {"designation_name": REPORTING_OFFICER_DESIGNATION_REGEX},
            {"title": REPORTING_OFFICER_DESIGNATION_REGEX},
            {"position": REPORTING_OFFICER_DESIGNATION_REGEX},
        ]
    }


def employee_team_leader_query():
    return {
        "$or": [
            {"is_team_leader": True},
            {"is_team_leader": "true"},
            {"role": re.compile(r"team[_ -]?leader", re.IGNORECASE)},
            {"roles": re.compile(r"team[_ -]?leader", re.IGNORECASE)},
        ]
    }


def resolve_active_employee_by_id(db, employee_id, tenant_id):
    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return None

    return db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$and": [
            {
                "$or": [
                    {"is_alumni": {"$ne": True}},
                    {"is_alumni": {"$exists": False}},
                ],
            },
            {
                "$or": [
                    {"status": {"$exists": False}},
                    {"status": {"$not": ALUMNI_STATUS_REGEX}},
                ],
            },
            {
                "$or": [
                    {"employment_status": {"$exists": False}},
                    {"employment_status": {"$not": ALUMNI_STATUS_REGEX}},
                ],
            },
        ],
    })


def normalize_employee_reporting_mapping(db, payload, tenant_id, existing=None):
    existing = existing or {}
    current_employee_id = normalize_text(existing.get("_id"))

    team_leader_id = normalize_text(payload.get("team_leader_id"))
    reporting_officer_id = normalize_text(payload.get("reporting_officer_id"))

    if "team_leader_id" in payload:
        if team_leader_id:
            if current_employee_id and team_leader_id == current_employee_id:
                return "Employee cannot be mapped as their own Team Leader"

            team_leader = resolve_active_employee_by_id(db, team_leader_id, tenant_id)

            if not team_leader:
                return "Selected Team Leader was not found"

            if not employee_is_team_leader(team_leader):
                return "Selected Team Leader must be marked as Team Leader"

            payload["team_leader_id"] = str(team_leader["_id"])
            payload["team_leader_name"] = employee_display_name(team_leader)
        else:
            payload["team_leader_id"] = ""
            payload["team_leader_name"] = ""

    if "reporting_officer_id" in payload:
        if reporting_officer_id:
            if current_employee_id and reporting_officer_id == current_employee_id:
                return "Employee cannot be mapped as their own Reporting Officer"

            reporting_officer = resolve_active_employee_by_id(db, reporting_officer_id, tenant_id)

            if not reporting_officer:
                return "Selected Reporting Officer was not found"

            if not reporting_officer_designation_allowed(reporting_officer):
                return "Reporting Officer must have Manager, Managing Director, Director, CEO, or Chief Executive Officer designation"

            payload["reporting_officer_id"] = str(reporting_officer["_id"])
            payload["reporting_officer_name"] = employee_display_name(reporting_officer)
        else:
            payload["reporting_officer_id"] = ""
            payload["reporting_officer_name"] = ""

    if truthy(payload.get("is_reporting_officer")):
        employee_designation = {
            "designation": payload.get("designation") or existing.get("designation"),
            "designation_name": payload.get("designation_name") or existing.get("designation_name"),
            "title": payload.get("title") or existing.get("title"),
            "position": payload.get("position") or existing.get("position"),
        }

        if not reporting_officer_designation_allowed(employee_designation):
            return "Only Manager, Managing Director, Director, CEO, or Chief Executive Officer designation employees can be marked as Reporting Officer"

    return ""


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

    employee_id = str(employee["_id"])
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    return bool(project_member_ids(project).intersection(set(identifier_values)))


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


def validate_employee_photo_payload(data):
    data = data or {}

    raw_avatar = (
        data.get("avatar")
        or data.get("profile_photo")
        or data.get("profile_picture")
        or data.get("photo")
        or data.get("image")
        or data.get("picture")
        or ""
    )

    raw_avatar_text = normalize_text(raw_avatar)

    if not raw_avatar_text:
        return ""

    if raw_avatar_text.startswith("data:image") and len(raw_avatar_text) > 5000:
        return "Profile photo is too large/base64. Please save only an uploaded image path or URL."

    if len(raw_avatar_text) > 1000 and not raw_avatar_text.startswith("http"):
        return "Profile photo value is too long. Please save only a short image path or URL."

    return ""


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



ALUMNI_STATUS_REGEX = re.compile(
    r"^(inactive|resigned|left|terminated|alumni|ex-employee|ex_employee)$",
    re.IGNORECASE,
)


def and_query(base_query, extra_query):
    if not extra_query:
        return base_query

    if not base_query:
        return extra_query

    return {
        "$and": [
            base_query,
            extra_query,
        ]
    }


def employee_alumni_query():
    return {
        "$or": [
            {"is_alumni": True},
            {"status": ALUMNI_STATUS_REGEX},
            {"employment_status": ALUMNI_STATUS_REGEX},
            {"last_working_date": {"$exists": True, "$nin": [None, ""]}},
        ]
    }


def employee_active_query():
    return {
        "$and": [
            {"is_alumni": {"$ne": True}},
            {
                "$or": [
                    {"status": {"$exists": False}},
                    {"status": {"$not": ALUMNI_STATUS_REGEX}},
                ]
            },
            {
                "$or": [
                    {"employment_status": {"$exists": False}},
                    {"employment_status": {"$not": ALUMNI_STATUS_REGEX}},
                ]
            },
            {
                "$or": [
                    {"last_working_date": {"$exists": False}},
                    {"last_working_date": {"$in": [None, ""]}},
                ]
            },
        ]
    }


def employee_is_alumni_payload(payload):
    if not payload:
        return False

    if truthy(payload.get("is_alumni")):
        return True

    status = normalize_text(payload.get("status")).lower()
    employment_status = normalize_text(payload.get("employment_status")).lower()

    alumni_statuses = {
        "inactive",
        "resigned",
        "left",
        "terminated",
        "alumni",
        "ex-employee",
        "ex_employee",
    }

    if status in alumni_statuses:
        return True

    if employment_status in alumni_statuses:
        return True

    return bool(normalize_text(payload.get("last_working_date")))

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
    employee_scope = normalize_text(
        request.args.get("employee_scope")
        or request.args.get("scope")
    ).lower()
    designation = normalize_text(request.args.get("designation"))
    branch = normalize_text(request.args.get("branch"))
    employment_status = normalize_text(request.args.get("employment_status"))
    employee_picker = normalize_text(
        request.args.get("employee_picker")
        or request.args.get("picker")
        or request.args.get("lookup")
    ).lower()
    leave_type = normalize_leave_type(request.args.get("leave_type"))
    approval_stage = normalize_text(request.args.get("approval_stage"))
    mode = normalize_text(request.args.get("mode"))
    reviewer_employee_id = normalize_text(request.args.get("reviewer_employee_id") or request.args.get("reviewer_id"))
    review_target_type = normalize_text(request.args.get("review_target_type") or request.args.get("target_type"))
    period_type = normalize_text(request.args.get("period_type") or request.args.get("period"))
    week_key = normalize_text(request.args.get("week_key"))
    month_key = normalize_text(request.args.get("month_key"))
    year_key = normalize_text(request.args.get("year_key") or request.args.get("year"))
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))
    q_text = normalize_text(request.args.get("q") or request.args.get("search"))

    if status:
        if collection == "projects":
            q["status"] = normalize_project_status(status)
        else:
            q["status"] = status

    if department:
        if collection == "employees":
            q["department"] = re.compile(re.escape(department), re.IGNORECASE)
        else:
            q["department"] = department

    if employee_id:
        q["employee_id"] = employee_id

    if collection == "employees":
        if designation:
            q["designation"] = re.compile(re.escape(designation), re.IGNORECASE)

        if branch:
            q["branch"] = re.compile(re.escape(branch), re.IGNORECASE)

        if employment_status:
            q["employment_status"] = re.compile(
                f"^{re.escape(employment_status)}$",
                re.IGNORECASE,
            )

        if employee_picker in {"team_leader", "team-leader", "tl"}:
            q = and_query(q, employee_team_leader_query())

        if employee_picker in {"reporting_officer", "reporting-officer", "ro"}:
            q = and_query(q, employee_reporting_officer_designation_query())

        if employee_scope in {"alumni", "past", "resigned", "inactive", "left"}:
            q = and_query(q, employee_alumni_query())
        elif employee_scope in {"all", "everyone"}:
            pass
        else:
            q = and_query(q, employee_active_query())

    if collection == "performance_reviews":
        if reviewer_employee_id:
            q["reviewer_employee_id"] = reviewer_employee_id

        if review_target_type:
            q["review_target_type"] = review_target_type

        if period_type:
            q["period_type"] = period_type

        if week_key:
            q["week_key"] = week_key

        if month_key:
            q["month_key"] = month_key

        if year_key:
            q["year_key"] = year_key

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

    if collection == "performance_reviews" and (date_from or date_to):
        q["review_date"] = {}

        if date_from:
            q["review_date"]["$gte"] = date_from

        if date_to:
            q["review_date"]["$lte"] = date_to

    if collection == "leave_requests" and (date_from or date_to):
        start = date_from or "0000-01-01"
        end = date_to or "9999-12-31"
        q["from_date"] = {"$lte": end}
        q["to_date"] = {"$gte": start}

    search_query = build_search_query(collection, q_text)

    if search_query:
        q = and_query(q, search_query)

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
    
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    q["$or"] = [
        {"created_by_employee_id": {"$in": identifier_values}},
        {"team_leader_id": {"$in": identifier_values}},
        {"reporting_officer_id": {"$in": identifier_values}},
        {"assigned_to_id": {"$in": identifier_values}},
        {"assigned_employee_ids": {"$in": identifier_values}},
        {"assigned_members.employee_id": {"$in": identifier_values}},
        {"collaborator_ids": {"$in": identifier_values}},
        {"collaborators.employee_id": {"$in": identifier_values}},
        {"latest_progress_by": {"$in": identifier_values}},
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
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    scope_or = []

    if "team_leader" in roles or employee_is_team_leader(employee):
        scope_or.append({"team_leader_id": {"$in": identifier_values}})

    if "reporting_officer" in roles or employee_is_reporting_officer(employee):
        scope_or.append({"reporting_officer_id": {"$in": identifier_values}})

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


def performance_rating_value(review):
    raw_value = (
        review.get("rating")
        if review.get("rating") is not None
        else review.get("score")
        if review.get("score") is not None
        else review.get("performance_score")
    )

    try:
        return float(raw_value or 0)
    except Exception:
        return 0.0


def performance_rating_bucket(rating):
    try:
        rating = float(rating or 0)
    except Exception:
        rating = 0

    if rating >= 4.5:
        return "Excellent"
    if rating >= 3.5:
        return "Good"
    if rating >= 2.5:
        return "Average"
    if rating > 0:
        return "Needs Improvement"
    return "Not Rated"


def performance_review_scope_query(db, q):
    employee = get_current_employee(db)

    if not employee:
        q["_id"] = {"$exists": False}
        return q

    employee_id = str(employee["_id"])
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)
    
    scope_or = [
        {"employee_id": employee_id},
        {"reviewer_employee_id": employee_id},
        {"reviewer_id": current_user_id()},
    ]

    if employee_is_team_leader(employee):
        team_members = list(db.employees.find({
            "tenant_id": employee.get("tenant_id") or current_tenant_id(),
            "team_leader_id": {"$in": identifier_values},
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
        }, {"_id": 1}))

        team_member_ids = [str(row["_id"]) for row in team_members]

        if team_member_ids:
            scope_or.append({
                "employee_id": {"$in": team_member_ids},
                "reviewer_employee_id": employee_id,
            })

    if employee_is_reporting_officer(employee):
        reporting_members = list(db.employees.find({
            "tenant_id": employee.get("tenant_id") or current_tenant_id(),
            "reporting_officer_id": {"$in": identifier_values},
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
        }, {"_id": 1}))

        reporting_member_ids = [str(row["_id"]) for row in reporting_members]

        if reporting_member_ids:
            scope_or.append({
                "employee_id": {"$in": reporting_member_ids},
                "reviewer_employee_id": employee_id,
            })

    if "$or" in q:
        return {
            "$and": [
                q,
                {"$or": scope_or},
            ]
        }

    q["$or"] = scope_or
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
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    scope_or = [{"employee_id": {"$in": identifier_values}}]

    if "team_leader" in roles or employee_is_team_leader(employee):
        scope_or.append({
            "team_leader_id": {"$in": identifier_values},
            "approval_stage": "team_leader",
        })

    if "reporting_officer" in roles or employee_is_reporting_officer(employee):
        scope_or.append({
            "reporting_officer_id": {"$in": identifier_values},
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

    if collection == "performance_reviews":
        q = performance_review_scope_query(db, q)

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
    avatar = employee_avatar(employee)

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
        "avatar": avatar,
        "profile_photo": avatar,
        "profile_picture": avatar,
        "photo": avatar,
        "is_team_leader": truthy(employee.get("is_team_leader")),
        "is_reporting_officer": truthy(employee.get("is_reporting_officer")),
        "is_it_support_head": truthy(employee.get("is_it_support_head")),
        "is_it_support_member": truthy(employee.get("is_it_support_member") or employee.get("is_it_support_head")),
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
    fallback_avatar = employee_avatar_from_payload(fallback)

    fallback["avatar"] = fallback_avatar
    fallback["profile_photo"] = fallback_avatar
    fallback["profile_picture"] = fallback_avatar
    fallback["photo"] = fallback_avatar
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

    latest_progress_avatar = safe_employee_avatar_value(
        project.get("latest_progress_by_avatar", "")
    )

    latest_progress_person = {
        "employee_id": latest_progress_by,
        "employee_name": project.get("latest_progress_by_name"),
        "name": project.get("latest_progress_by_name"),
        "employee_code": "",
        "department": project.get("department", ""),
        "designation": "",
        "avatar": latest_progress_avatar,
        "profile_photo": latest_progress_avatar,
        "profile_picture": latest_progress_avatar,
        "photo": latest_progress_avatar,
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

    if collection in {"organisations", "departments", "designations", "states"}:
        if not normalize_text(
            payload.get("name")
            or payload.get("title")
            or payload.get("state_name")
            or payload.get("organisation_name")
            or payload.get("organization_name")
        ):
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


def enrich_performance_review(item):
    item = dict(item or {})
    rating_value = performance_rating_value(item)
    rating_percent = round((rating_value / 5) * 100, 2) if rating_value else 0
    rating_bucket = performance_rating_bucket(rating_value)

    item["rating_value"] = rating_value
    item["rating_percent"] = rating_percent
    item["rating_percentage"] = rating_percent
    item["rating_bucket"] = item.get("rating_bucket") or rating_bucket
    item["rating_label"] = item.get("rating_label") or item.get("score_label") or rating_bucket
    item["score_label"] = item.get("score_label") or item["rating_label"]
    item["review_date"] = item.get("review_date") or item.get("date") or item.get("created_at") or ""
    item["period_type"] = item.get("period_type") or item.get("review_frequency") or "weekly"
    item["review_frequency"] = item.get("review_frequency") or item["period_type"]
    item["graph_value"] = item.get("graph_value") if item.get("graph_value") is not None else rating_percent
    item["graph_label"] = item.get("graph_label") or item.get("employee_name") or "Employee"
    item["graph_group"] = item.get("graph_group") or item.get("review_target_type") or "performance"

    return item


def enrich_items(collection, items):
    if collection == "leave_requests":
        return [enrich_leave_request(item) for item in items]

    if collection == "projects":
        return [enrich_project_item(item) for item in items]

    if collection == "performance_reviews":
        return [enrich_performance_review(item) for item in items]

    return items



# --------------------------------------------------------------------------
# Employee Directory API
# --------------------------------------------------------------------------
# Tenant-wide public employee contact directory.
# Every logged-in user can view active employees of their own tenant only.
# Resigned/left/terminated/alumni employees are automatically hidden.
# Only safe contact fields are exposed.

DIRECTORY_SEARCH_FIELDS = [
    "name",
    "employee_name",
    "full_name",
    "designation",
    "designation_name",
    "title",
    "state",
    "office_state",
    "work_state",
    "current_state",
    "phone",
    "mobile",
    "contact_number",
    "phone_number",
    "email",
    "official_email",
    "work_email",
]


def directory_employee_name(employee):
    return (
        normalize_text(employee.get("name"))
        or normalize_text(employee.get("employee_name"))
        or normalize_text(employee.get("full_name"))
        or normalize_text(employee.get("email"))
        or "Employee"
    )


def directory_employee_designation(employee):
    return (
        normalize_text(employee.get("designation"))
        or normalize_text(employee.get("designation_name"))
        or normalize_text(employee.get("title"))
        or normalize_text(employee.get("position"))
    )

def directory_employee_department(employee):
    return (
        normalize_text(employee.get("department"))
        or normalize_text(employee.get("department_name"))
        or normalize_text(employee.get("dept"))
        or normalize_text(employee.get("dept_name"))
    )


def directory_employee_organisation(employee):
    return (
        normalize_text(employee.get("organisation"))
        or normalize_text(employee.get("organization"))
        or normalize_text(employee.get("organisation_name"))
        or normalize_text(employee.get("organization_name"))
    )


def directory_employee_organisation_code(employee):
    return (
        normalize_text(employee.get("organisation_code"))
        or normalize_text(employee.get("organization_code"))
    )

def directory_employee_state(employee):
    return (
        normalize_text(employee.get("state"))
        or normalize_text(employee.get("office_state"))
        or normalize_text(employee.get("work_state"))
        or normalize_text(employee.get("current_state"))
    )


def directory_employee_phone(employee):
    return (
        normalize_text(employee.get("phone"))
        or normalize_text(employee.get("mobile"))
        or normalize_text(employee.get("contact_number"))
        or normalize_text(employee.get("phone_number"))
    )


def directory_employee_email(employee):
    return normalize_email(
        employee.get("email")
        or employee.get("official_email")
        or employee.get("work_email")
    )


def directory_employee_photo(employee):
    return (
        safe_employee_avatar_value(employee.get("avatar"))
        or safe_employee_avatar_value(employee.get("profile_photo"))
        or safe_employee_avatar_value(employee.get("profile_picture"))
        or safe_employee_avatar_value(employee.get("photo"))
        or safe_employee_avatar_value(employee.get("image"))
        or safe_employee_avatar_value(employee.get("picture"))
        or ""
    )


def directory_search_query(search_text):
    search_text = normalize_text(search_text)

    if not search_text:
        return {}

    regex = re.compile(re.escape(search_text), re.IGNORECASE)

    return {
        "$or": [
            {field: regex}
            for field in DIRECTORY_SEARCH_FIELDS
        ]
    }


def directory_field_regex(value):
    value = normalize_text(value)

    if not value:
        return None

    return re.compile(re.escape(value), re.IGNORECASE)


def directory_item_matches_filter(item, key, value):
    value = normalize_text(value).lower()

    if not value:
        return True

    return value in normalize_text(item.get(key)).lower()


@crud_bp.get("/employee-directory")
@current_user_required
def employee_directory():
    db = get_db()

    search_text = normalize_text(
        request.args.get("q")
        or request.args.get("search")
    )

    name_filter = normalize_text(request.args.get("name"))
    designation_filter = normalize_text(request.args.get("designation"))
    state_filter = normalize_text(request.args.get("state"))
    phone_filter = normalize_text(request.args.get("phone"))
    email_filter = normalize_text(request.args.get("email"))

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

    q = {
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    }

    # Hide resigned / left / terminated / alumni employees.
    q = and_query(q, employee_active_query())

    search_q = directory_search_query(search_text)

    if search_q:
        q = and_query(q, search_q)

    name_regex = directory_field_regex(name_filter)
    designation_regex = directory_field_regex(designation_filter)
    state_regex = directory_field_regex(state_filter)
    phone_regex = directory_field_regex(phone_filter)
    email_regex = directory_field_regex(email_filter)

    extra_filters = []

    if name_regex:
        extra_filters.append({
            "$or": [
                {"name": name_regex},
                {"employee_name": name_regex},
                {"full_name": name_regex},
            ]
        })

    if designation_regex:
        extra_filters.append({
            "$or": [
                {"designation": designation_regex},
                {"designation_name": designation_regex},
                {"title": designation_regex},
                {"position": designation_regex},
            ]
        })

    if state_regex:
        extra_filters.append({
            "$or": [
                {"state": state_regex},
                {"office_state": state_regex},
                {"work_state": state_regex},
                {"current_state": state_regex},
            ]
        })

    if phone_regex:
        extra_filters.append({
            "$or": [
                {"phone": phone_regex},
                {"mobile": phone_regex},
                {"contact_number": phone_regex},
                {"phone_number": phone_regex},
            ]
        })

    if email_regex:
        extra_filters.append({
            "$or": [
                {"email": email_regex},
                {"official_email": email_regex},
                {"work_email": email_regex},
            ]
        })

    for extra_filter in extra_filters:
        q = and_query(q, extra_filter)

    employees = list(
        db.employees
        .find(q)
        .sort("name", 1)
        .limit(1000)
    )

    items = []

    for employee in employees:
        photo = directory_employee_photo(employee)

        item = {
    "id": str(employee.get("_id")),
    "_id": str(employee.get("_id")),
    "name": directory_employee_name(employee),
    "designation": directory_employee_designation(employee),
    "department": directory_employee_department(employee),
    "department_name": directory_employee_department(employee),

    "organisation": (
        normalize_text(employee.get("organisation"))
        or normalize_text(employee.get("organization"))
        or normalize_text(employee.get("organisation_name"))
        or normalize_text(employee.get("organization_name"))
    ),
    "organization": (
        normalize_text(employee.get("organisation"))
        or normalize_text(employee.get("organization"))
        or normalize_text(employee.get("organisation_name"))
        or normalize_text(employee.get("organization_name"))
    ),
    "organisation_name": (
        normalize_text(employee.get("organisation_name"))
        or normalize_text(employee.get("organisation"))
        or normalize_text(employee.get("organization"))
        or normalize_text(employee.get("organization_name"))
    ),
    "organization_name": (
        normalize_text(employee.get("organization_name"))
        or normalize_text(employee.get("organisation_name"))
        or normalize_text(employee.get("organisation"))
        or normalize_text(employee.get("organization"))
    ),
    "organisation_code": (
        normalize_text(employee.get("organisation_code"))
        or normalize_text(employee.get("organization_code"))
    ),
    "organization_code": (
        normalize_text(employee.get("organization_code"))
        or normalize_text(employee.get("organisation_code"))
    ),

    "state": directory_employee_state(employee),
    "phone": directory_employee_phone(employee),
    "email": directory_employee_email(employee),
    "avatar": photo,
    "profile_photo": photo,
    "profile_picture": photo,
    "photo": photo,
}

        # Final fallback filtering handles data stored under mixed field names.
        if not directory_item_matches_filter(item, "name", name_filter):
            continue

        if not directory_item_matches_filter(item, "designation", designation_filter):
            continue

        if not directory_item_matches_filter(item, "state", state_filter):
            continue

        if not directory_item_matches_filter(item, "phone", phone_filter):
            continue

        if not directory_item_matches_filter(item, "email", email_filter):
            continue

        items.append(item)

    total = len(items)
    start = (page - 1) * limit
    end = start + limit
    paged_items = items[start:end]

    designations = sorted({
        item.get("designation")
        for item in items
        if normalize_text(item.get("designation"))
    })

    states = sorted({
        item.get("state")
        for item in items
        if normalize_text(item.get("state"))
    })

    return jsonify({
        "items": paged_items,
        "total": total,
        "page": page,
        "limit": limit,
        "filters": {
            "designations": designations,
            "states": states,
        },
        "message": "Employee directory loaded successfully",
    })

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

    if collection == "performance_reviews" and sort_by == "created_at":
        sort_by = "review_date"

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

    if collection == "performance_reviews":
        item = enrich_performance_review(item)

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

    if collection == "employees":
        photo_error = validate_employee_photo_payload(data)

        if photo_error:
            return jsonify({"message": photo_error}), 400

    if collection == "projects":
        payload = normalize_project_payload(payload)

    if collection in {"organisations", "departments", "designations", "states"}:
        payload = normalize_master_payload(collection, payload)

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
        payload = normalize_employee_organisation_fields(payload)
        payload.setdefault("status", "active")
        payload.setdefault("employment_status", payload.get("status") or "active")
        payload.setdefault("is_team_leader", "false")
        payload.setdefault("is_reporting_officer", "false")
        payload.setdefault("is_it_support_head", "false")
        payload.setdefault("is_it_support_member", "false")
        normalize_employee_capability_flags(payload)

        hierarchy_error = normalize_employee_reporting_mapping(
            db,
            payload,
            payload.get("tenant_id") or current_tenant_id(),
        )

        if hierarchy_error:
            return jsonify({"message": hierarchy_error}), 400

        is_alumni_employee = employee_is_alumni_payload(payload)
        skip_login = truthy(payload.get("skip_login")) or is_alumni_employee

        if is_alumni_employee:
            payload["is_alumni"] = True
            payload.setdefault("status", "Resigned")
            payload.setdefault("employment_status", "Resigned")
        else:
            payload["is_alumni"] = False

        joining_date = employee_joining_date(payload)

        if joining_date:
            payload["joining_date"] = joining_date
            payload.setdefault("date_of_joining", joining_date)

        date_of_birth = employee_date_of_birth(payload)

        if date_of_birth:
            payload["date_of_birth"] = date_of_birth
            payload.setdefault("dob", date_of_birth)

        apply_avatar_aliases(payload)
        remove_employee_auth_fields(payload)

        if not skip_login:
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
        if not employee_is_alumni_payload(payload):
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
                        "is_team_leader": bool_string(payload.get("is_team_leader")),
                        "is_reporting_officer": bool_string(payload.get("is_reporting_officer")),
                        "team_leader_id": payload.get("team_leader_id", ""),
                        "team_leader_name": payload.get("team_leader_name", ""),
                        "reporting_officer_id": payload.get("reporting_officer_id", ""),
                        "reporting_officer_name": payload.get("reporting_officer_name", ""),
                        "is_it_support_head": bool_string(payload.get("is_it_support_head")),
                        "is_it_support_member": bool_string(payload.get("is_it_support_member") or payload.get("is_it_support_head")),
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

    if collection == "employees":
        photo_error = validate_employee_photo_payload(data)

        if photo_error:
            return jsonify({"message": photo_error}), 400

    if self_photo_update:
        apply_avatar_aliases(payload)

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

        user_id = updated.get("user_id") if updated else ""
        user_obj_id = safe_object_id(user_id)

        user_avatar_payload = {
            "updated_at": now_utc(),
            "updated_by": current_user_id(),
            "updated_by_name": current_user_name(),
        }

        avatar = employee_avatar_from_payload(payload)

        if avatar:
            apply_avatar_aliases(user_avatar_payload, avatar)

        if user_obj_id:
            db.users.update_one(
                {"_id": user_obj_id},
                {"$set": user_avatar_payload},
            )
        else:
            current_user = getattr(g, "current_user", {}) or {}
            user_email = normalize_email(
                current_user.get("email")
                or current_user.get("username")
                or updated.get("email")
                or updated.get("official_email")
            )

            if user_email:
                db.users.update_one(
                    {
                        "email": user_email,
                        "tenant_id": updated.get("tenant_id") or current_tenant_id(),
                        "is_deleted": {"$ne": True},
                    },
                    {"$set": user_avatar_payload},
                )

        audit("update", collection, item_id, payload)

        return jsonify({
            "message": "Profile photo updated successfully",
            "item": serialize_item(updated),
        })
    
    if collection == "projects":
        payload = normalize_project_payload(payload, existing)

    if collection in {"organisations", "departments", "designations", "states"}:
        payload = normalize_master_payload(collection, payload)

    if collection == "employees":
        merged_employee = dict(existing)
        merged_employee.update(payload)
        merged_employee["_id"] = existing["_id"]
        merged_employee.setdefault("tenant_id", existing.get("tenant_id") or current_tenant_id())

        is_alumni_employee = employee_is_alumni_payload(merged_employee)

        if is_alumni_employee:
            payload["is_alumni"] = True
            payload.setdefault("status", "Resigned")
            payload.setdefault("employment_status", "Resigned")
            merged_employee["is_alumni"] = True
            merged_employee["status"] = payload.get("status", "Resigned")
            merged_employee["employment_status"] = payload.get("employment_status", "Resigned")

        if (
            "is_team_leader" in payload
            or "is_reporting_officer" in payload
            or "is_it_support_head" in payload
            or "is_it_support_member" in payload
        ):
            normalize_employee_capability_flags(payload)
            merged_employee.update({
                "is_team_leader": payload.get("is_team_leader", merged_employee.get("is_team_leader", "false")),
                "is_reporting_officer": payload.get("is_reporting_officer", merged_employee.get("is_reporting_officer", "false")),
                "is_it_support_head": payload.get("is_it_support_head", merged_employee.get("is_it_support_head", "false")),
                "is_it_support_member": payload.get("is_it_support_member", merged_employee.get("is_it_support_member", "false")),
            })
            normalize_employee_capability_flags(merged_employee)

        hierarchy_error = normalize_employee_reporting_mapping(
            db,
            payload,
            merged_employee.get("tenant_id") or current_tenant_id(),
            existing,
        )

        if hierarchy_error:
            return jsonify({"message": hierarchy_error}), 400

        merged_employee.update({
            "team_leader_id": payload.get("team_leader_id", merged_employee.get("team_leader_id", "")),
            "team_leader_name": payload.get("team_leader_name", merged_employee.get("team_leader_name", "")),
            "reporting_officer_id": payload.get("reporting_officer_id", merged_employee.get("reporting_officer_id", "")),
            "reporting_officer_name": payload.get("reporting_officer_name", merged_employee.get("reporting_officer_name", "")),
        })

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

        date_of_birth = employee_date_of_birth(merged_employee)

        if date_of_birth and (
            payload.get("date_of_birth")
            or payload.get("dob")
        ):
            payload["date_of_birth"] = date_of_birth
            payload["dob"] = date_of_birth
            merged_employee["date_of_birth"] = date_of_birth
            merged_employee["dob"] = date_of_birth

        remove_employee_auth_fields(payload)

        if employee_is_alumni_payload(merged_employee):
            deactivate_employee_login_user(db, merged_employee)
            remove_employee_auth_fields(payload)
        else:
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
        if employee_is_alumni_payload(updated):
            deactivate_employee_login_user(db, updated)
        else:
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
                    "is_it_support_head": "false" if collection == "employees" else existing.get("is_it_support_head", "false"),
                    "is_it_support_member": "false" if collection == "employees" else existing.get("is_it_support_member", "false"),
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