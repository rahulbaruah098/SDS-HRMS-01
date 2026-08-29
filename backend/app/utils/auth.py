from functools import wraps
from datetime import datetime, timedelta, timezone

import hashlib
import secrets
import uuid

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

ACCESS_TOKEN_MINUTES = 30

# Web keeps the existing absolute authenticated-session lifetime.
# Mobile refresh sessions are persistent and are revoked only by explicit
# logout (or when the account becomes unavailable/revoked server-side).
SESSION_MAX_MINUTES = 180
MOBILE_CLIENT_TYPES = {"mobile", "app", "flutter", "android", "ios"}

# Backward-compatible export retained because existing route modules import it.
# The active session lifetime is now minute-based via SESSION_MAX_MINUTES.
REFRESH_SESSION_DAYS = None


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


def generate_refresh_token():
    """
    Generates the raw refresh token returned to the mobile app.

    The raw value must never be stored directly in MongoDB.
    """
    return secrets.token_urlsafe(64)


def hash_refresh_token(token):
    """
    Creates a SHA-256 hash for storing and searching refresh tokens.
    """
    return hashlib.sha256(
        str(token or "").encode("utf-8")
    ).hexdigest()


def normalize_client_type(value):
    """
    Normalizes the requesting client without changing existing web behavior.

    Existing web clients do not need to send a platform/client_type value.
    Only explicitly recognized app values are treated as mobile.
    """
    client_type = str(value or "").strip().lower()
    return "mobile" if client_type in MOBILE_CLIENT_TYPES else "web"


def refresh_session_expiry(client_type="web"):
    """
    Returns the refresh-session expiry for the requested client.

    Web sessions retain the existing 180-minute absolute lifetime. Mobile
    sessions intentionally have no absolute expiry and remain valid until the
    refresh session is revoked (for example, explicit logout) or the account
    becomes unavailable. MongoDB TTL indexes ignore a missing/null date value.
    """
    if normalize_client_type(client_type) == "mobile":
        return None

    return now_utc() + timedelta(minutes=SESSION_MAX_MINUTES)


def issue_access_token(user):
    """
    Creates the short-lived JWT access token used for normal API requests.
    """
    roles = normalize_roles(user.get("roles", []))
    tenant_id = user.get("tenant_id") or default_tenant_id()
    current_time = datetime.now(timezone.utc)

    payload = {
        "sub": str(user["_id"]),
        "email": user.get("email"),
        "name": user.get("name"),
        "roles": roles,
        "tenant_id": tenant_id,
        "token_type": "access",
        "jti": uuid.uuid4().hex,
        "iat": current_time,
        "exp": current_time + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }

    return jwt.encode(
        payload,
        current_app.config["JWT_SECRET_KEY"],
        algorithm="HS256",
    )


def issue_token(user):
    """
    Backward-compatible alias.

    Existing backend files calling issue_token() will continue working,
    but they now receive a 30-minute access token.
    """
    return issue_access_token(user)


def request_has_super_admin_role():
    """
    Returns True when the current request carries a valid, signed access token
    whose JWT role list contains the platform Superadmin role.

    This helper is intentionally lightweight so it can be used by app-level
    middleware before route decorators run. Protected routes still perform the
    normal database-backed current_user_required validation afterwards.
    """
    auth = request.headers.get("Authorization", "")

    if not auth.startswith("Bearer "):
        return False

    token = auth.replace("Bearer ", "", 1).strip()

    if not token:
        return False

    try:
        payload = jwt.decode(
            token,
            current_app.config["JWT_SECRET_KEY"],
            algorithms=["HS256"],
        )
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return False
    except Exception:
        return False

    if payload.get("token_type", "access") != "access":
        return False

    return "super_admin" in set(normalize_roles(payload.get("roles", [])))


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

        token_type = payload.get("token_type", "access")

        if token_type != "access":
            return jsonify({
                "message": "Invalid access token type"
            }), 401

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