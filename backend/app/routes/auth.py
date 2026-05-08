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


def normalize_roles(value):
    if not value:
        return ["employee"]

    if isinstance(value, list):
        roles = [str(role).strip() for role in value if str(role).strip()]
    elif isinstance(value, str):
        roles = [role.strip() for role in value.split(",") if role.strip()]
    else:
        roles = ["employee"]

    return roles or ["employee"]


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

    return safe_user


def employee_snapshot(employee):
    if not employee:
        return None

    return {
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
        },
    }


def find_employee_for_user(db, user):
    if not user:
        return None

    tenant_id = user.get("tenant_id") or default_tenant_id()

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": str(user["_id"]),
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee_snapshot(employee)

    employee = db.employees.find_one({
        "user_id": str(user["_id"]),
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee_snapshot(employee)

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

    if update_data:
        db.users.update_one(
            {"_id": user["_id"]},
            {"$set": update_data},
        )

    return user


def sync_user_employee_capabilities(db, user, employee):
    if not user:
        return user

    current_roles = normalize_roles(user.get("roles"))
    next_roles = build_employee_capability_roles(current_roles, employee)

    if current_roles != next_roles:
        db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"roles": next_roles}},
        )
        user["roles"] = next_roles

    return user


@auth_bp.post("/login")
def login():
    db = get_db()
    data = request.get_json(silent=True) or {}

    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"message": "Email and password are required"}), 400

    user = db.users.find_one({
        "email": email,
        "is_active": True,
    })

    if not user:
        return jsonify({"message": "Invalid email or password"}), 401

    if not check_password_hash(user.get("password_hash", ""), password):
        return jsonify({"message": "Invalid email or password"}), 401

    user = sync_user_login_defaults(db, user)
    employee = find_employee_for_user(db, user)
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
    employee = find_employee_for_user(db, user)
    user = sync_user_employee_capabilities(db, user, employee)

    return jsonify({
        "user": clean_doc(sanitize_user_for_response(user)),
        "employee": clean_doc(employee),
    })