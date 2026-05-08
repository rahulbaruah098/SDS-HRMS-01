from functools import wraps
from datetime import datetime, timedelta, timezone

from flask import request, jsonify, g, current_app
import jwt
from bson import ObjectId

from app.extensions import get_db


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


def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def now_utc():
    return datetime.utcnow()


def normalize_roles(value):
    if not value:
        return []

    if isinstance(value, list):
        return [str(role).strip() for role in value if str(role).strip()]

    if isinstance(value, str):
        return [role.strip() for role in value.split(",") if role.strip()]

    return []


def truthy(value):
    return str(value or "").strip().lower() in ["true", "yes", "1", "on"]


def default_tenant_id():
    return current_app.config.get("DEFAULT_TENANT_ID", "sds")


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
        return employee

    return db.employees.find_one({
        "user_id": str(user["_id"]),
        "is_deleted": {"$ne": True},
    })


def build_effective_roles(user, employee=None):
    roles = set(normalize_roles(user.get("roles", [])))

    if not roles:
        roles.add("employee")

    has_protected_role = bool(roles.intersection(PROTECTED_LOGIN_ROLES))

    # Team Leader / Reporting Officer are employee capabilities, not separate
    # login identities. Protected roles like admin/hr/finance are preserved.
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


def sync_effective_roles(db, user):
    employee = find_employee_for_user(db, user)
    current_roles = normalize_roles(user.get("roles", []))
    effective_roles = build_effective_roles(user, employee)

    if current_roles != effective_roles:
        db.users.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "roles": effective_roles,
                    "updated_at": now_utc(),
                }
            },
        )
        user["roles"] = effective_roles
    else:
        user["roles"] = current_roles

    return user


def issue_token(user):
    roles = normalize_roles(user.get("roles", []))
    tenant_id = user.get("tenant_id") or default_tenant_id()

    payload = {
        "sub": str(user["_id"]),
        "email": user.get("email"),
        "name": user.get("name"),
        "roles": roles,
        "tenant_id": tenant_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "iat": datetime.now(timezone.utc),
    }

    return jwt.encode(
        payload,
        current_app.config["JWT_SECRET_KEY"],
        algorithm="HS256",
    )


def current_user_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")

        if not auth.startswith("Bearer "):
            return jsonify({"message": "Missing token"}), 401

        token = auth.replace("Bearer ", "", 1).strip()

        if not token:
            return jsonify({"message": "Missing token"}), 401

        try:
            payload = jwt.decode(
                token,
                current_app.config["JWT_SECRET_KEY"],
                algorithms=["HS256"],
            )
        except jwt.ExpiredSignatureError:
            return jsonify({"message": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"message": "Invalid token"}), 401

        user_obj_id = safe_object_id(payload.get("sub"))

        if not user_obj_id:
            return jsonify({"message": "Invalid token user"}), 401

        db = get_db()

        user = db.users.find_one({
            "_id": user_obj_id,
            "is_active": True,
        })

        if not user:
            return jsonify({"message": "User not found"}), 401

        tenant_id = user.get("tenant_id") or payload.get("tenant_id") or default_tenant_id()

        user["tenant_id"] = tenant_id
        user = sync_effective_roles(db, user)

        g.current_user = user
        g.tenant_id = tenant_id

        return fn(*args, **kwargs)

    return wrapper


def roles_required(*roles):
    def decorator(fn):
        @wraps(fn)
        @current_user_required
        def wrapper(*args, **kwargs):
            user_roles = set(normalize_roles(g.current_user.get("roles", [])))
            allowed_roles = set(roles)

            if "super_admin" in user_roles:
                return fn(*args, **kwargs)

            if user_roles.intersection(allowed_roles):
                return fn(*args, **kwargs)

            return jsonify({"message": "Forbidden"}), 403

        return wrapper

    return decorator


def audit(action, entity, entity_id=None, meta=None):
    try:
        db = get_db()
        user = getattr(g, "current_user", {}) or {}

        tenant_id = getattr(
            g,
            "tenant_id",
            user.get("tenant_id") or default_tenant_id(),
        )

        db.audit_logs.insert_one({
            "tenant_id": tenant_id,
            "actor_id": str(user.get("_id", "")),
            "actor_email": user.get("email", "system"),
            "actor_name": user.get("name", ""),
            "actor_roles": normalize_roles(user.get("roles", [])),
            "action": action,
            "entity": entity,
            "entity_id": str(entity_id) if entity_id else None,
            "meta": meta or {},
            "created_at": now_utc(),
        })
    except Exception:
        pass