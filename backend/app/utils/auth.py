from functools import wraps
from datetime import datetime, timedelta, timezone

from flask import request, jsonify, g, current_app
import jwt
from bson import ObjectId

from app.extensions import get_db


def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def issue_token(user):
    payload = {
        "sub": str(user["_id"]),
        "email": user.get("email"),
        "name": user.get("name"),
        "roles": user.get("roles", []),
        "tenant_id": user.get("tenant_id"),
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
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

        token = auth.replace("Bearer ", "").strip()

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

        g.current_user = user
        g.tenant_id = user.get(
            "tenant_id",
            current_app.config.get("DEFAULT_TENANT_ID", "sds"),
        )

        return fn(*args, **kwargs)

    return wrapper


def roles_required(*roles):
    def decorator(fn):
        @wraps(fn)
        @current_user_required
        def wrapper(*args, **kwargs):
            user_roles = set(g.current_user.get("roles", []))
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
            user.get("tenant_id", current_app.config.get("DEFAULT_TENANT_ID", "sds")),
        )

        db.audit_logs.insert_one({
            "tenant_id": tenant_id,
            "actor_id": str(user.get("_id", "")),
            "actor_email": user.get("email", "system"),
            "actor_name": user.get("name", ""),
            "actor_roles": user.get("roles", []),
            "action": action,
            "entity": entity,
            "entity_id": str(entity_id) if entity_id else None,
            "meta": meta or {},
            "created_at": datetime.utcnow(),
        })
    except Exception:
        pass