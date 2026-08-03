from flask import Blueprint, request, jsonify, g, current_app
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from werkzeug.security import check_password_hash, generate_password_hash

from app.extensions import get_db
from app.utils.auth import (
    ACCESS_TOKEN_MINUTES,
    REFRESH_SESSION_DAYS,
    audit,
    current_user_required,
    generate_refresh_token,
    hash_refresh_token,
    issue_access_token,
    now_utc,
    refresh_session_expiry,
)
from app.utils.serializers import clean_doc
from app.services.tenant_service import build_tenant_context, ensure_sds_tenant


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


EMPLOYEE_IDENTITY_FIELDS = (
    "employee_id",
    "employee_code",
    "emp_code",
    "code",
)


class AuthIdentityConflict(RuntimeError):
    pass


def default_tenant_id():
    return current_app.config.get("DEFAULT_TENANT_ID", "sds")


def normalize_text(value):
    return str(value or "").strip()


def normalize_email(value):
    return str(value or "").strip().lower()


def safe_object_id(value):
    try:
        from bson import ObjectId

        text = normalize_text(value)

        if text and ObjectId.is_valid(text):
            return ObjectId(text)
    except Exception:
        return None

    return None


def employee_identity_alias_keys(payload):
    payload = payload or {}
    aliases = []

    stored_aliases = payload.get("identity_alias_keys") or []

    if isinstance(stored_aliases, (list, tuple, set)):
        aliases.extend(
            normalize_text(value).lower()
            for value in stored_aliases
            if normalize_text(value)
        )

    aliases.extend(
        normalize_text(payload.get(field_name)).lower()
        for field_name in EMPLOYEE_IDENTITY_FIELDS
        if normalize_text(payload.get(field_name))
    )

    return sorted(set(aliases))


def canonical_employee_code(employee, user=None):
    employee = employee or {}
    user = user or {}

    return normalize_text(
        employee.get("employee_code")
        or employee.get("emp_code")
        or employee.get("employee_id")
        or employee.get("code")
        or user.get("employee_code")
        or user.get("emp_code")
    )


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


def safe_profile_photo_value(value):
    photo = normalize_text(value)

    if not photo:
        return ""

    # Never return/store large base64 images in auth/session payloads.
    # This prevents frontend localStorage/session and Team Leader dashboard crashes.
    if photo.startswith("data:image") and len(photo) > 5000:
        return ""

    # Normal uploaded image paths/URLs should be short.
    # Example: /uploads/profile_photos/employee.jpg
    if len(photo) > 1000 and not photo.startswith("http"):
        return ""

    return photo


def profile_photo_value(doc):
    doc = doc or {}

    return (
        safe_profile_photo_value(doc.get("avatar"))
        or safe_profile_photo_value(doc.get("profile_photo"))
        or safe_profile_photo_value(doc.get("profile_picture"))
        or safe_profile_photo_value(doc.get("photo"))
        or safe_profile_photo_value(doc.get("image"))
        or safe_profile_photo_value(doc.get("picture"))
        or ""
    )

def apply_profile_photo_aliases(payload, photo_value=None):
    payload = payload or {}
    photo = safe_profile_photo_value(photo_value) or profile_photo_value(payload)

    if photo:
        payload["avatar"] = photo
        payload["profile_photo"] = photo
        payload["profile_picture"] = photo
        payload["photo"] = photo
    else:
        # Remove unsafe/huge photo fields from auth response/session payload.
        for key in [
            "avatar",
            "profile_photo",
            "profile_picture",
            "photo",
            "image",
            "picture",
        ]:
            if payload.get(key) and not safe_profile_photo_value(payload.get(key)):
                payload.pop(key, None)

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


def build_auth_tenant_payload(db, user):
    """
    Builds SaaS tenant/subscription data for login and /me responses.

    Login is intentionally not blocked here. If a trial has expired, the
    frontend will receive the subscription status and redirect the company
    user to Billing/Upgrade, while SDS lifetime users continue normally.
    """

    ensure_sds_tenant(db, current_app.config)

    tenant_context = build_tenant_context(
        db,
        user=user,
        config=current_app.config,
    )

    tenant = clean_doc(tenant_context.get("tenant")) or {}
    subscription = clean_doc(tenant_context.get("subscription")) or {}

    # Keep old backend compatibility value plan_type=demo, but expose enough
    # trial metadata for frontend full-access trial decisions after refresh.
    if str(subscription.get("plan_type") or tenant.get("plan_type") or "").lower() == "demo":
        subscription.setdefault("demo_duration_days", current_app.config.get("DEMO_DURATION_DAYS", 15))
        subscription.setdefault("demo_has_full_access", current_app.config.get("DEMO_HAS_FULL_ACCESS", True))
        subscription.setdefault("allowed_modules", current_app.config.get("DEMO_ALLOWED_MODULES", ["all"]))
        subscription.setdefault("requires_payment", False)

        tenant.setdefault("demo_duration_days", subscription.get("demo_duration_days"))
        tenant.setdefault("demo_has_full_access", subscription.get("demo_has_full_access"))
        tenant.setdefault("allowed_modules", subscription.get("allowed_modules"))
        tenant.setdefault("requires_payment", subscription.get("requires_payment"))

    return {
        "tenant": tenant,
        "subscription": subscription,
        "is_platform_superadmin": bool(
            tenant_context.get("is_platform_superadmin")
        ),
    }


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

    tenant_id = normalize_text(
        user.get("tenant_id") or default_tenant_id()
    )
    user_id = normalize_text(user.get("_id") or user.get("id"))

    if not tenant_id or not user_id:
        return None

    base_query = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }

    # 1. Immutable employee Mongo reference stored on the user.
    employee_reference_values = [
        normalize_text(user.get("employee_ref_id")),
        normalize_text(user.get("employee_id")),
    ]
    employee_object_ids = []

    for value in employee_reference_values:
        object_id = safe_object_id(value)

        if object_id and object_id not in employee_object_ids:
            employee_object_ids.append(object_id)

    if employee_object_ids:
        employee = db.employees.find_one({
            **base_query,
            "_id": {"$in": employee_object_ids},
        })

        if employee:
            return employee

    # 2. Authoritative linked login user.
    employee = db.employees.find_one({
        **base_query,
        "user_id": user_id,
    })

    if employee:
        return employee

    # 3. Tenant-scoped identity aliases retained for legacy users.
    aliases = employee_identity_alias_keys(user)

    if aliases:
        employee = db.employees.find_one({
            **base_query,
            "$or": [
                {"identity_alias_keys": {"$in": aliases}},
                *[
                    {
                        field_name: {
                            "$in": aliases,
                        }
                    }
                    for field_name in EMPLOYEE_IDENTITY_FIELDS
                ],
            ],
        })

        if employee:
            return employee

    # 4. Email is the final tenant-scoped fallback.
    email = normalize_email(
        user.get("email")
        or user.get("username")
        or user.get("official_email")
    )

    if email:
        return db.employees.find_one({
            **base_query,
            "$or": [
                {"email": email},
                {"official_email": email},
            ],
        })

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
    else:
        apply_profile_photo_aliases(user)

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
        apply_profile_photo_aliases(user)

        if employee:
            apply_profile_photo_aliases(employee)

        return user, employee

    user_update = {}
    apply_profile_photo_aliases(user_update, photo)
    apply_profile_photo_aliases(user, photo)

    if user_update:
        db.users.update_one(
            {"_id": user["_id"]},
            {"$set": user_update},
        )

    if employee and employee.get("_id"):
        employee_update = {}
        apply_profile_photo_aliases(employee_update, photo)
        apply_profile_photo_aliases(employee, photo)

        if employee_update:
            db.employees.update_one(
                {"_id": employee["_id"]},
                {"$set": employee_update},
            )

    return user, employee


def restore_document(collection, document):
    document = dict(document or {})

    if not document.get("_id"):
        return

    collection.replace_one(
        {"_id": document["_id"]},
        document,
        upsert=True,
    )


def linked_employee_conflict(db, user, employee):
    tenant_id = normalize_text(
        employee.get("tenant_id")
        or user.get("tenant_id")
        or default_tenant_id()
    )
    user_id = normalize_text(user.get("_id"))
    employee_id = normalize_text(employee.get("_id"))
    linked_user_id = normalize_text(employee.get("user_id"))

    if linked_user_id and linked_user_id != user_id:
        linked_user_object_id = safe_object_id(linked_user_id)

        if linked_user_object_id:
            linked_user = db.users.find_one({
                "_id": linked_user_object_id,
                "tenant_id": tenant_id,
                "is_deleted": {"$ne": True},
            })

            if linked_user:
                return (
                    "This employee profile is already linked to another "
                    "active login account."
                )

    for field_name in ("employee_ref_id", "employee_id"):
        linked_employee_id = normalize_text(user.get(field_name))

        if not linked_employee_id or linked_employee_id == employee_id:
            continue

        linked_employee_object_id = safe_object_id(linked_employee_id)

        if not linked_employee_object_id:
            continue

        linked_employee = db.employees.find_one({
            "_id": linked_employee_object_id,
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })

        if linked_employee and linked_employee["_id"] != employee["_id"]:
            return (
                "This login account is already linked to another active "
                "employee profile."
            )

    return ""


def sync_user_employee_link(db, user, employee):
    if not user or not employee:
        return user, employee

    tenant_id = normalize_text(
        user.get("tenant_id") or default_tenant_id()
    )
    employee_tenant_id = normalize_text(
        employee.get("tenant_id") or tenant_id
    )

    if not tenant_id or employee_tenant_id != tenant_id:
        raise AuthIdentityConflict(
            "The login account and employee profile belong to different companies."
        )

    conflict_message = linked_employee_conflict(
        db,
        user,
        employee,
    )

    if conflict_message:
        raise AuthIdentityConflict(conflict_message)

    user_before = dict(user)
    employee_before = dict(employee)

    user_id = str(user["_id"])
    employee_id = str(employee["_id"])
    employee_code = canonical_employee_code(employee, user)

    user_update = {
        "employee_id": employee_id,
        "employee_ref_id": employee_id,
        "emp_code": employee_code,
        "employee_code": employee_code,
        "department": employee.get(
            "department",
            user.get("department", ""),
        ),
        "designation": employee.get(
            "designation",
            user.get("designation", ""),
        ),
    }

    employee_update = {
        "user_id": user_id,
        "employee_name": (
            employee.get("employee_name")
            or employee.get("name")
            or user.get("name", "")
        ),
    }

    photo = merge_profile_photo_from_sources(employee, user)

    if photo:
        apply_profile_photo_aliases(user_update, photo)
        apply_profile_photo_aliases(employee_update, photo)

    user_written = False

    try:
        db.users.update_one(
            {
                "_id": user["_id"],
                "tenant_id": tenant_id,
                "is_deleted": {"$ne": True},
            },
            {"$set": user_update},
        )
        user_written = True

        db.employees.update_one(
            {
                "_id": employee["_id"],
                "tenant_id": tenant_id,
                "is_deleted": {"$ne": True},
            },
            {"$set": employee_update},
        )
    except DuplicateKeyError as exc:
        if user_written:
            restore_document(db.users, user_before)

        restore_document(db.employees, employee_before)

        raise AuthIdentityConflict(
            "The employee ID/code or login link is already assigned to "
            "another active record in this company."
        ) from exc
    except Exception:
        if user_written:
            restore_document(db.users, user_before)

        restore_document(db.employees, employee_before)
        raise

    user.update(user_update)
    employee.update(employee_update)

    if photo:
        apply_profile_photo_aliases(user, photo)
        apply_profile_photo_aliases(employee, photo)
    else:
        apply_profile_photo_aliases(user)
        apply_profile_photo_aliases(employee)

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
    else:
        apply_profile_photo_aliases(user)

    if update_data:
        db.users.update_one(
            {"_id": user["_id"]},
            {"$set": update_data},
        )

    return user


def ensure_auth_session_indexes(db):
    """
    Creates authentication-session indexes.

    Calling create_index repeatedly is safe. MongoDB reuses an existing
    index when its definition is unchanged.
    """
    db.auth_sessions.create_index(
        "refresh_token_hash",
        unique=True,
        name="unique_refresh_token_hash",
    )

    db.auth_sessions.create_index(
        "expires_at",
        expireAfterSeconds=0,
        name="auth_session_expiry_ttl",
    )

    db.auth_sessions.create_index(
        [
            ("user_id", 1),
            ("is_revoked", 1),
        ],
        name="auth_session_user_revoked",
    )

# Changes by Atlanta
def create_auth_session(db, user, login_data=None):
    """
    Creates a new refresh session and returns the raw refresh token.

    Only the SHA-256 hash is stored in MongoDB.
    """
    login_data = login_data or {}

    refresh_token = generate_refresh_token()
    refresh_token_hash = hash_refresh_token(refresh_token)
    current_time = now_utc()

    db.auth_sessions.insert_one({
        "user_id": str(user["_id"]),
        "tenant_id": (
            user.get("tenant_id")
            or default_tenant_id()
        ),
        "refresh_token_hash": refresh_token_hash,
        "device_id": normalize_text(
            login_data.get("device_id")
        ),
        "device_name": normalize_text(
            login_data.get("device_name")
        ),
        "platform": normalize_text(
            login_data.get("platform")
        ) or "mobile",
        "is_revoked": False,
        "created_at": current_time,
        "updated_at": current_time,
        "last_used_at": current_time,
        "expires_at": None,
        "revoked_at": None,
    })

    return refresh_token


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

    try:
        user, raw_employee = sync_user_employee_link(
            db,
            user,
            raw_employee,
        )
    except AuthIdentityConflict as exc:
        return jsonify({
            "message": str(exc),
            "code": "employee_identity_conflict",
        }), 409

    user, raw_employee = sync_user_employee_photo(db, user, raw_employee)

    employee = employee_snapshot(raw_employee, user) if raw_employee else None
    user = sync_user_employee_capabilities(db, user, employee)

    ensure_auth_session_indexes(db)

    access_token = issue_access_token(user)

    refresh_token = create_auth_session(
        db,
        user,
        login_data=data,
    )

    g.current_user = user
    g.tenant_id = user.get("tenant_id") or default_tenant_id()

    audit("login", "users", user["_id"], {"email": email})

    tenant_payload = build_auth_tenant_payload(db, user)

    return jsonify({
        # Keep "token" temporarily for compatibility with older clients.
        "token": access_token,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_MINUTES * 60,
        "refresh_expires_in": None,
        "user": clean_doc(sanitize_user_for_response(user)),
        "employee": clean_doc(employee),
        "tenant": tenant_payload["tenant"],
        "subscription": tenant_payload["subscription"],
        "is_platform_superadmin": tenant_payload["is_platform_superadmin"],
    })


@auth_bp.post("/refresh")
def refresh_access_token():
    """
    Rotates the refresh token and returns a new access/refresh token pair.

    This endpoint intentionally does not use @current_user_required because
    the access token may already be expired or missing when it is called.
    """
    db = get_db()
    data = request.get_json(silent=True) or {}

    raw_refresh_token = normalize_text(data.get("refresh_token"))

    if not raw_refresh_token:
        return jsonify({"message": "Refresh token is required"}), 400

    ensure_auth_session_indexes(db)

    current_time = now_utc()
    current_hash = hash_refresh_token(raw_refresh_token)

    session = db.auth_sessions.find_one({
        "refresh_token_hash": current_hash,
        "is_revoked": {"$ne": True},
    })

    if not session:
        return jsonify({
            "message": "Invalid or revoked refresh token"
        }), 401

    user_obj_id = safe_object_id(session.get("user_id"))

    if not user_obj_id:
        db.auth_sessions.update_one(
            {"_id": session["_id"]},
            {
                "$set": {
                    "is_revoked": True,
                    "revoked_at": current_time,
                    "updated_at": current_time,
                }
            },
        )
        return jsonify({"message": "Invalid refresh session"}), 401

    user = db.users.find_one({
        "_id": user_obj_id,
        "is_active": True,
        "is_deleted": {"$ne": True},
    })

    if not user:
        db.auth_sessions.update_one(
            {"_id": session["_id"]},
            {
                "$set": {
                    "is_revoked": True,
                    "revoked_at": current_time,
                    "updated_at": current_time,
                }
            },
        )
        return jsonify({"message": "User account is unavailable"}), 401

    user = sync_user_login_defaults(db, user)
    raw_employee = find_employee_for_user(db, user)

    try:
        user, raw_employee = sync_user_employee_link(
            db,
            user,
            raw_employee,
        )
    except AuthIdentityConflict as exc:
        return jsonify({
            "message": str(exc),
            "code": "employee_identity_conflict",
        }), 409

    user, raw_employee = sync_user_employee_photo(
        db,
        user,
        raw_employee,
    )

    employee = (
        employee_snapshot(raw_employee, user)
        if raw_employee
        else None
    )

    user = sync_user_employee_capabilities(
        db,
        user,
        employee,
    )

    new_refresh_token = generate_refresh_token()
    new_refresh_hash = hash_refresh_token(new_refresh_token)

    # Atomic rotation: only the current valid token can rotate this session.
    updated_session = db.auth_sessions.find_one_and_update(
        {
            "_id": session["_id"],
            "refresh_token_hash": current_hash,
            "is_revoked": {"$ne": True},
        },
        {
            "$set": {
                "refresh_token_hash": new_refresh_hash,
                "last_used_at": current_time,
                "updated_at": current_time,
                "expires_at": None,
            }
        },
        return_document=ReturnDocument.AFTER,
    )

    if not updated_session:
        return jsonify({
            "message": "Refresh token has already been rotated"
        }), 409

    access_token = issue_access_token(user)

    return jsonify({
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_MINUTES * 60,
        "refresh_expires_in": None,
    }), 200


@auth_bp.post("/logout")
def logout():
    """
    Revokes the current refresh session.

    The endpoint is idempotent and does not require a valid access token.
    """
    db = get_db()
    data = request.get_json(silent=True) or {}

    raw_refresh_token = normalize_text(data.get("refresh_token"))

    if raw_refresh_token:
        current_time = now_utc()

        db.auth_sessions.update_one(
            {
                "refresh_token_hash": hash_refresh_token(
                    raw_refresh_token
                ),
                "is_revoked": {"$ne": True},
            },
            {
                "$set": {
                    "is_revoked": True,
                    "revoked_at": current_time,
                    "updated_at": current_time,
                }
            },
        )

    return jsonify({"message": "Logged out successfully"}), 200


@auth_bp.post("/change-password")
@current_user_required
def change_password():
    """
    Allows any authenticated user to change only their own login password.

    The current password must be verified before the stored hash is replaced.
    Password values are never written to audit logs or API responses.
    """
    db = get_db()
    data = request.get_json(silent=True) or {}

    current_password = str(data.get("current_password") or "")
    new_password = str(data.get("new_password") or "")
    confirm_password = str(data.get("confirm_password") or "")

    if not current_password or not new_password or not confirm_password:
        return jsonify({
            "message": (
                "Current password, new password and confirm password are required"
            )
        }), 400

    if len(new_password) < 6:
        return jsonify({
            "message": "New password must be at least 6 characters"
        }), 400

    if new_password != confirm_password:
        return jsonify({
            "message": "New password and confirm password do not match"
        }), 400

    authenticated_user = g.current_user or {}
    user_id = authenticated_user.get("_id")

    user = db.users.find_one({
        "_id": user_id,
        "is_active": True,
        "is_deleted": {"$ne": True},
    })

    if not user:
        return jsonify({"message": "Authenticated user was not found"}), 404

    current_password_hash = user.get("password_hash") or ""

    if (
        not current_password_hash
        or not check_password_hash(current_password_hash, current_password)
    ):
        return jsonify({"message": "Current password is incorrect"}), 400

    if check_password_hash(current_password_hash, new_password):
        return jsonify({
            "message": "New password cannot be the same as the current password"
        }), 400

    changed_at = now_utc()
    new_password_hash = generate_password_hash(new_password)

    # Include the existing hash in the filter so simultaneous submissions
    # cannot silently overwrite one another.
    result = db.users.update_one(
        {
            "_id": user["_id"],
            "password_hash": current_password_hash,
            "is_active": True,
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "password_hash": new_password_hash,
                "password_changed_at": changed_at,
                "password_changed_by": str(user["_id"]),
                "password_change_source": "self_service",
                "updated_at": changed_at,
            }
        },
    )

    if result.modified_count != 1:
        return jsonify({
            "message": (
                "Password could not be changed because the account was updated "
                "by another request. Please try again."
            )
        }), 409

    g.current_user = {
        **authenticated_user,
        "password_hash": new_password_hash,
        "password_changed_at": changed_at,
        "updated_at": changed_at,
    }
    g.tenant_id = user.get("tenant_id") or default_tenant_id()

    audit(
        "change_own_password",
        "users",
        user["_id"],
        {
            "email": user.get("email"),
            "self_service": True,
        },
    )

    return jsonify({
        "message": "Password changed successfully"
    }), 200


@auth_bp.get("/me")
@current_user_required
def me():
    db = get_db()

    user = sync_user_login_defaults(db, g.current_user)

    raw_employee = find_employee_for_user(db, user)

    try:
        user, raw_employee = sync_user_employee_link(
            db,
            user,
            raw_employee,
        )
    except AuthIdentityConflict as exc:
        return jsonify({
            "message": str(exc),
            "code": "employee_identity_conflict",
        }), 409

    user, raw_employee = sync_user_employee_photo(db, user, raw_employee)

    employee = employee_snapshot(raw_employee, user) if raw_employee else None
    user = sync_user_employee_capabilities(db, user, employee)

    g.current_user = user
    g.tenant_id = user.get("tenant_id") or default_tenant_id()

    tenant_payload = build_auth_tenant_payload(db, user)

    return jsonify({
        "user": clean_doc(sanitize_user_for_response(user)),
        "employee": clean_doc(employee),
        "tenant": tenant_payload["tenant"],
        "subscription": tenant_payload["subscription"],
        "is_platform_superadmin": tenant_payload["is_platform_superadmin"],
    })