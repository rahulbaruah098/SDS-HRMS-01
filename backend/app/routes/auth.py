from flask import Blueprint, request, jsonify, g, current_app
from werkzeug.security import check_password_hash

from app.extensions import get_db
from app.utils.auth import issue_token, current_user_required, audit
from app.utils.serializers import clean_doc


auth_bp = Blueprint("auth", __name__)


SUPPORTED_HOLIDAY_STATES = [
    "Assam(HO)",
    "Manipur",
    "Mizoram",
    "Arunachal Pradesh",
]


PROTECTED_LOGIN_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "finance",
    "accounts_finance",
}


EMPLOYEE_CAPABILITY_ROLES = {
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
}


def default_tenant_id():
    return current_app.config.get("DEFAULT_TENANT_ID", "sds")


def normalize_text(value):
    return str(value or "").strip()


def normalize_email(value):
    return str(value or "").strip().lower()


def normalize_role_value(value):
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def normalize_roles(value):
    if not value:
        return ["employee"]

    if isinstance(value, list):
        roles = [normalize_role_value(role) for role in value if normalize_text(role)]
    elif isinstance(value, str):
        roles = [normalize_role_value(role) for role in value.split(",") if normalize_text(role)]
    else:
        roles = ["employee"]

    cleaned_roles = []

    for role in roles:
        if role and role not in cleaned_roles:
            cleaned_roles.append(role)

    return cleaned_roles or ["employee"]


def normalize_state(value):
    state = normalize_text(value)

    if not state:
        return "Assam(HO)"

    lowered = state.lower()

    if lowered in ["assam", "assam ho", "assam(ho)", "ho", "assam/guwahati (ho)"]:
        return "Assam(HO)"

    for allowed in SUPPORTED_HOLIDAY_STATES:
        if lowered == allowed.lower():
            return allowed

    return state


def truthy(value):
    return str(value or "").strip().lower() in ["true", "yes", "1", "on"]


def profile_photo_value(doc):
    doc = doc or {}

    return (
        normalize_text(doc.get("avatar"))
        or normalize_text(doc.get("profile_photo"))
        or normalize_text(doc.get("profile_picture"))
        or normalize_text(doc.get("photo"))
        or normalize_text(doc.get("image"))
        or normalize_text(doc.get("picture"))
        or ""
    )


def apply_profile_photo_aliases(payload, photo_value=None):
    payload = payload or {}
    photo = normalize_text(photo_value) or profile_photo_value(payload)

    if photo:
        payload["avatar"] = photo
        payload["profile_photo"] = photo
        payload["profile_picture"] = photo
        payload["photo"] = photo

    return payload


def merge_profile_photo_from_sources(primary=None, fallback=None):
    return profile_photo_value(primary) or profile_photo_value(fallback)


def build_employee_capability_roles(user_roles, employee):
    roles = set(normalize_roles(user_roles))
    has_protected_role = bool(roles.intersection(PROTECTED_LOGIN_ROLES))

    if not has_protected_role:
        roles.difference_update(EMPLOYEE_CAPABILITY_ROLES)
        roles.add("employee")

    if employee:
        if truthy(employee.get("is_team_leader")):
            roles.add("team_leader")
        else:
            roles.discard("team_leader")

        if truthy(employee.get("is_reporting_officer")):
            roles.add("reporting_officer")
        else:
            roles.discard("reporting_officer")
            roles.discard("manager")
            roles.discard("ro")

    if not roles:
        roles.add("employee")

    return sorted(list(roles))


def sanitize_user_for_response(user):
    if not user:
        return None

    safe_user = dict(user)
    safe_user.pop("password_hash", None)

    safe_user["roles"] = normalize_roles(safe_user.get("roles"))
    safe_user["tenant_id"] = safe_user.get("tenant_id") or default_tenant_id()

    apply_profile_photo_aliases(safe_user)

    return safe_user


def employee_snapshot(employee, user=None):
    if not employee:
        return None

    photo = merge_profile_photo_from_sources(employee, user)

    snapshot = {
        **dict(employee),
        "role": "Employee",
        "state": normalize_state(
            employee.get("state")
            or employee.get("branch")
            or employee.get("work_state")
            or "Assam(HO)"
        ),
        "is_team_leader": str(employee.get("is_team_leader", "false")).lower(),
        "is_reporting_officer": str(employee.get("is_reporting_officer", "false")).lower(),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
        "dashboard_role": "Employee",
        "display_role": "Employee",
        "capabilities": {
            "is_team_leader": truthy(employee.get("is_team_leader")),
            "is_reporting_officer": truthy(employee.get("is_reporting_officer")),
            "can_manage_projects": truthy(employee.get("is_team_leader"))
            or truthy(employee.get("is_reporting_officer")),
            "can_assign_project_members": truthy(employee.get("is_team_leader"))
            or truthy(employee.get("is_reporting_officer")),
            "can_add_project_collaborators": truthy(employee.get("is_team_leader"))
            or truthy(employee.get("is_reporting_officer")),
            "can_update_project_progress": True,
            "can_view_project_team_tree": True,
        },
    }

    snapshot["employee_name"] = (
        snapshot.get("employee_name")
        or snapshot.get("name")
        or snapshot.get("email")
        or "Employee"
    )

    apply_profile_photo_aliases(snapshot, photo)

    return snapshot


def find_employee_for_user(db, user):
    if not user:
        return None

    tenant_id = user.get("tenant_id") or default_tenant_id()
    user_id = str(user["_id"])
    email = normalize_email(user.get("email"))
    employee_ref_id = normalize_text(user.get("employee_ref_id") or user.get("employee_id"))

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee

    employee = db.employees.find_one({
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee

    if employee_ref_id:
        try:
            from bson import ObjectId

            employee = db.employees.find_one({
                "_id": ObjectId(employee_ref_id),
                "is_deleted": {"$ne": True},
            })

            if employee:
                return employee
        except Exception:
            pass

    if email:
        employee = db.employees.find_one({
            "tenant_id": tenant_id,
            "email": email,
            "is_deleted": {"$ne": True},
        })

        if employee:
            return employee

        employee = db.employees.find_one({
            "email": email,
            "is_deleted": {"$ne": True},
        })

        if employee:
            return employee

    return None


def sync_user_login_defaults(db, user):
    update_data = {}

    if not user.get("tenant_id"):
        update_data["tenant_id"] = default_tenant_id()
        user["tenant_id"] = update_data["tenant_id"]

    roles = normalize_roles(user.get("roles"))

    if user.get("roles") != roles:
        update_data["roles"] = roles
        user["roles"] = roles

    if not user.get("username") and user.get("email"):
        update_data["username"] = normalize_email(user.get("email"))
        user["username"] = update_data["username"]

    if not user.get("status"):
        update_data["status"] = "active" if user.get("is_active", True) else "inactive"
        user["status"] = update_data["status"]

    photo = profile_photo_value(user)

    if photo:
        apply_profile_photo_aliases(update_data, photo)
        apply_profile_photo_aliases(user, photo)

    if update_data:
        db.users.update_one(
            {"_id": user["_id"]},
            {"$set": update_data},
        )

    return user


def sync_user_employee_photo(db, user, employee):
    if not user:
        return user, employee

    photo = merge_profile_photo_from_sources(employee, user)

    if not photo:
        return user, employee

    user_update = {}
    apply_profile_photo_aliases(user_update, photo)
    apply_profile_photo_aliases(user, photo)

    db.users.update_one(
        {"_id": user["_id"]},
        {"$set": user_update},
    )

    if employee and employee.get("_id"):
        employee_update = {}
        apply_profile_photo_aliases(employee_update, photo)
        apply_profile_photo_aliases(employee, photo)

        db.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": employee_update},
        )

    return user, employee


def sync_user_employee_link(db, user, employee):
    if not user or not employee:
        return user, employee

    user_id = str(user["_id"])
    employee_id = str(employee["_id"])

    user_update = {
        "employee_id": employee_id,
        "employee_ref_id": employee_id,
        "emp_code": employee.get("employee_id") or employee.get("emp_code") or user.get("emp_code", ""),
        "department": employee.get("department", user.get("department", "")),
        "designation": employee.get("designation", user.get("designation", "")),
    }

    employee_update = {
        "user_id": user_id,
        "employee_name": employee.get("employee_name") or employee.get("name") or user.get("name", ""),
    }

    photo = merge_profile_photo_from_sources(employee, user)

    if photo:
        apply_profile_photo_aliases(user_update, photo)
        apply_profile_photo_aliases(employee_update, photo)
        apply_profile_photo_aliases(user, photo)
        apply_profile_photo_aliases(employee, photo)

    db.users.update_one(
        {"_id": user["_id"]},
        {"$set": user_update},
    )

    db.employees.update_one(
        {"_id": employee["_id"]},
        {"$set": employee_update},
    )

    user.update(user_update)
    employee.update(employee_update)

    return user, employee


def sync_user_employee_capabilities(db, user, employee):
    if not user:
        return user

    current_roles = normalize_roles(user.get("roles"))
    next_roles = build_employee_capability_roles(current_roles, employee)

    update_data = {}

    if current_roles != next_roles:
        update_data["roles"] = next_roles
        user["roles"] = next_roles

    photo = merge_profile_photo_from_sources(employee, user)

    if photo:
        apply_profile_photo_aliases(update_data, photo)
        apply_profile_photo_aliases(user, photo)

    if update_data:
        db.users.update_one(
            {"_id": user["_id"]},
            {"$set": update_data},
        )

    return user


@auth_bp.post("/login")
def login():
    db = get_db()
    data = request.get_json(silent=True) or {}

    email = normalize_email(data.get("email"))
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"message": "Email and password are required"}), 400

    user = db.users.find_one({
        "email": email,
        "is_active": True,
        "is_deleted": {"$ne": True},
    })

    if not user:
        return jsonify({"message": "Invalid email or password"}), 401

    if not check_password_hash(user.get("password_hash", ""), password):
        return jsonify({"message": "Invalid email or password"}), 401

    user = sync_user_login_defaults(db, user)

    raw_employee = find_employee_for_user(db, user)

    user, raw_employee = sync_user_employee_link(db, user, raw_employee)
    user, raw_employee = sync_user_employee_photo(db, user, raw_employee)

    employee = employee_snapshot(raw_employee, user) if raw_employee else None
    user = sync_user_employee_capabilities(db, user, employee)

    token = issue_token(user)

    g.current_user = user
    g.tenant_id = user.get("tenant_id") or default_tenant_id()

    audit("login", "users", user["_id"], {"email": email})

    return jsonify({
        "token": token,
        "user": clean_doc(sanitize_user_for_response(user)),
        "employee": clean_doc(employee),
    })


@auth_bp.get("/me")
@current_user_required
def me():
    db = get_db()

    user = sync_user_login_defaults(db, g.current_user)

    raw_employee = find_employee_for_user(db, user)

    user, raw_employee = sync_user_employee_link(db, user, raw_employee)
    user, raw_employee = sync_user_employee_photo(db, user, raw_employee)

    employee = employee_snapshot(raw_employee, user) if raw_employee else None
    user = sync_user_employee_capabilities(db, user, employee)

    return jsonify({
        "user": clean_doc(sanitize_user_for_response(user)),
        "employee": clean_doc(employee),
    })