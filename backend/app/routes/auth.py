from flask import Blueprint, request, jsonify, g, current_app
from werkzeug.security import check_password_hash

from app.extensions import get_db
from app.utils.auth import issue_token, current_user_required, audit
from app.utils.serializers import clean_doc


auth_bp = Blueprint("auth", __name__)


def default_tenant_id():
    return current_app.config.get("DEFAULT_TENANT_ID", "sds")


def sanitize_user_for_response(user):
    if not user:
        return None

    safe_user = dict(user)
    safe_user.pop("password_hash", None)

    return safe_user


def find_employee_for_user(db, user):
    if not user:
        return None

    tenant_id = user.get("tenant_id") or default_tenant_id()

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": str(user["_id"]),
    })

    if employee:
        return employee

    return db.employees.find_one({
        "user_id": str(user["_id"]),
    })


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

    if not user.get("tenant_id"):
        user["tenant_id"] = default_tenant_id()

    if not user.get("roles"):
        user["roles"] = ["employee"]

    employee = find_employee_for_user(db, user)

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

    user = g.current_user

    if not user.get("tenant_id"):
        user["tenant_id"] = default_tenant_id()

    employee = find_employee_for_user(db, user)

    return jsonify({
        "user": clean_doc(sanitize_user_for_response(user)),
        "employee": clean_doc(employee),
    })