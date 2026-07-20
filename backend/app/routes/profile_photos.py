import os
from uuid import uuid4
from datetime import datetime

from bson import ObjectId
from flask import Blueprint, request, jsonify, g, current_app, send_from_directory
from werkzeug.utils import secure_filename

from app.extensions import get_db
from app.utils.auth import current_user_required, audit
from app.middleware.tenant_guard import tenant_module_required
from app.utils.serializers import clean_doc


profile_photos_bp = Blueprint("profile_photos", __name__)


ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024
MAX_PROFILE_COVER_BYTES = 5 * 1024 * 1024
MAX_COMPANY_LOGO_BYTES = 3 * 1024 * 1024
MAX_PLATFORM_LOGO_BYTES = 3 * 1024 * 1024


PLATFORM_BRANDING_TENANT_ID = "__platform__"
PLATFORM_BRANDING_SETTING_GROUP = "platform_branding"
PLATFORM_BRANDING_SETTING_KEY = "sidebar_identity"
PLATFORM_PRODUCT_NAME = "YourComate"
DEFAULT_PLATFORM_TAGLINE = "People, Process and Performance"
MAX_PLATFORM_TAGLINE_LENGTH = 160


ADMIN_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}


TENANT_BRANDING_ADMIN_ROLES = {
    "super_admin",
    "admin",
    "tenant_admin",
}


def normalize_text(value):
    return str(value or "").strip()


def normalize_role(value):
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def current_roles():
    current_user = getattr(g, "current_user", {}) or {}
    roles = current_user.get("roles", [])

    if isinstance(roles, list):
        return {
            normalize_role(role)
            for role in roles
            if normalize_role(role)
        }

    if isinstance(roles, str):
        return {
            normalize_role(role)
            for role in roles.split(",")
            if normalize_role(role)
        }

    role = normalize_role(current_user.get("role"))

    return {role} if role else set()


def is_admin_user():
    return bool(current_roles().intersection(ADMIN_ROLES))


def can_manage_tenant_branding():
    return bool(current_roles().intersection(TENANT_BRANDING_ADMIN_ROLES))


def can_manage_platform_branding():
    """Only the global Platform Superadmin may change YourComate branding."""
    return "super_admin" in current_roles()


def current_tenant_id():
    current_user = getattr(g, "current_user", {}) or {}

    tenant_id = (
        getattr(g, "tenant_id", None)
        or current_user.get("tenant_id")
        or current_user.get("company_id")
        or current_user.get("tenant")
        or "sds"
    )

    return normalize_text(tenant_id) or "sds"


def current_user_id():
    current_user = getattr(g, "current_user", {}) or {}

    return normalize_text(
        current_user.get("_id")
        or current_user.get("id")
    )


def safe_object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def employee_email(employee):
    employee = employee or {}

    return normalize_text(
        employee.get("email")
        or employee.get("official_email")
    ).lower()


def photo_alias_payload(photo_path):
    return {
        "avatar": photo_path,
        "profile_photo": photo_path,
        "profile_picture": photo_path,
        "photo": photo_path,
        "image": "",
        "picture": "",
    }


def cover_alias_payload(cover_path):
    return {
        "cover_image": cover_path,
        "cover_photo": cover_path,
        "profile_cover": cover_path,
        "profile_cover_image": cover_path,
        "banner_image": cover_path,
        "banner_photo": cover_path,
    }


def company_logo_alias_payload(logo_path):
    return {
        "company_logo": logo_path,
        "company_logo_url": logo_path,
        "logo": logo_path,
        "logo_url": logo_path,
        "branding.company_logo": logo_path,
        "branding.company_logo_url": logo_path,
        "branding.logo": logo_path,
        "branding.logo_url": logo_path,
    }


def company_name_value(tenant):
    tenant = tenant or {}

    return normalize_text(
        tenant.get("company_name")
        or tenant.get("name")
        or tenant.get("tenant_name")
        or tenant.get("legal_name")
        or tenant.get("tenant_code")
        or current_tenant_id()
    )


def company_logo_value(tenant):
    tenant = tenant or {}
    branding = tenant.get("branding") if isinstance(tenant.get("branding"), dict) else {}

    return normalize_text(
        tenant.get("company_logo")
        or tenant.get("company_logo_url")
        or tenant.get("logo")
        or tenant.get("logo_url")
        or branding.get("company_logo")
        or branding.get("company_logo_url")
        or branding.get("logo")
        or branding.get("logo_url")
    )


def platform_branding_setting_query():
    return {
        "tenant_id": PLATFORM_BRANDING_TENANT_ID,
        "setting_group": PLATFORM_BRANDING_SETTING_GROUP,
        "setting_key": PLATFORM_BRANDING_SETTING_KEY,
        "is_deleted": {"$ne": True},
    }


def find_platform_branding_setting(db):
    return db.system_settings.find_one(platform_branding_setting_query())


def serialize_datetime(value):
    if isinstance(value, datetime):
        return value.isoformat() + "Z"

    return value


def platform_branding_payload(setting=None):
    setting = setting or {}
    setting_value = (
        setting.get("setting_value")
        if isinstance(setting.get("setting_value"), dict)
        else {}
    )

    tagline = normalize_text(
        setting_value.get("tagline")
        or setting.get("tagline")
    ) or DEFAULT_PLATFORM_TAGLINE

    logo_path = normalize_text(
        setting_value.get("logo_url")
        or setting_value.get("logo")
        or setting_value.get("platform_logo_url")
        or setting_value.get("platform_logo")
        or setting.get("logo_url")
        or setting.get("logo")
        or setting.get("platform_logo_url")
        or setting.get("platform_logo")
    )

    return {
        "product_name": PLATFORM_PRODUCT_NAME,
        "name": PLATFORM_PRODUCT_NAME,
        "tagline": tagline,
        "platform_logo": logo_path,
        "platform_logo_url": logo_path,
        "logo": logo_path,
        "logo_url": logo_path,
        "updated_at": serialize_datetime(setting.get("updated_at")),
        "updated_by": normalize_text(setting.get("updated_by")),
    }


def tenant_branding_payload(tenant):
    tenant = tenant or {}
    logo_path = company_logo_value(tenant)
    company_name = company_name_value(tenant)

    return {
        "tenant_id": normalize_text(tenant.get("tenant_id")) or current_tenant_id(),
        "tenant_code": normalize_text(tenant.get("tenant_code") or tenant.get("code")),
        "company_name": company_name,
        "name": company_name,
        "company_logo": logo_path,
        "company_logo_url": logo_path,
        "logo": logo_path,
        "logo_url": logo_path,
        "branding": {
            "company_name": company_name,
            "company_logo": logo_path,
            "company_logo_url": logo_path,
            "logo": logo_path,
            "logo_url": logo_path,
        },
    }


def find_current_tenant(db):
    tenant_id = current_tenant_id()
    tenant_values = list(dict.fromkeys([
        tenant_id,
        tenant_id.lower(),
        tenant_id.upper(),
    ]))

    return db.tenants.find_one({
        "tenant_id": {"$in": tenant_values},
        "is_deleted": {"$ne": True},
    })


def get_upload_root(folder_type="profile_photos"):
    if folder_type == "profile_covers":
        configured = current_app.config.get("PROFILE_COVER_UPLOAD_FOLDER")
        default_folder = "profile_covers"
    elif folder_type == "company_logos":
        configured = current_app.config.get("COMPANY_LOGO_UPLOAD_FOLDER")
        default_folder = "company_logos"
    elif folder_type == "platform_logos":
        configured = current_app.config.get("PLATFORM_LOGO_UPLOAD_FOLDER")
        default_folder = "platform_logos"
    else:
        configured = current_app.config.get("PROFILE_PHOTO_UPLOAD_FOLDER")
        default_folder = "profile_photos"

    if configured:
        upload_root = configured
    else:
        upload_root = os.path.join(
            current_app.root_path,
            "..",
            "uploads",
            default_folder,
        )

    upload_root = os.path.abspath(upload_root)
    os.makedirs(upload_root, exist_ok=True)

    return upload_root


def allowed_file(filename):
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    return extension in ALLOWED_IMAGE_EXTENSIONS


def detect_extension(file_path, fallback_ext):
    fallback_ext = str(fallback_ext or "").lower().replace(".", "")

    try:
        with open(file_path, "rb") as file:
            header = file.read(32)
    except Exception:
        return ""

    # JPEG: FF D8 FF
    if header.startswith(b"\xff\xd8\xff"):
        return "jpg"

    # PNG: 89 50 4E 47 0D 0A 1A 0A
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"

    # WEBP: RIFF....WEBP
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "webp"

    if fallback_ext in ALLOWED_IMAGE_EXTENSIONS:
        return fallback_ext

    return ""


def find_employee(db, employee_id):
    employee_id = normalize_text(employee_id)

    if not employee_id:
        return None

    base_query = {
        "is_deleted": {"$ne": True},
    }

    if not is_admin_user():
        base_query["tenant_id"] = current_tenant_id()

    employee_obj_id = safe_object_id(employee_id)

    if employee_obj_id:
        employee = db.employees.find_one({
            **base_query,
            "_id": employee_obj_id,
        })

        if employee:
            return employee

    lookup_or = [
        {"employee_id": employee_id},
        {"employee_code": employee_id},
        {"emp_code": employee_id},
        {"code": employee_id},
        {"user_id": employee_id},
        {"email": employee_id.lower()},
        {"official_email": employee_id.lower()},
    ]

    employee = db.employees.find_one({
        **base_query,
        "$or": lookup_or,
    })

    if employee:
        return employee

    if is_admin_user():
        admin_base_query = {
            "is_deleted": {"$ne": True},
        }

        if employee_obj_id:
            employee = db.employees.find_one({
                **admin_base_query,
                "_id": employee_obj_id,
            })

            if employee:
                return employee

        return db.employees.find_one({
            **admin_base_query,
            "$or": lookup_or,
        })

    return None


def can_update_employee_photo(employee):
    if not employee:
        return False

    if is_admin_user():
        return True

    user_id = current_user_id()

    if not user_id:
        return False

    if normalize_text(employee.get("user_id")) == user_id:
        return True

    current_user = getattr(g, "current_user", {}) or {}

    user_employee_id = normalize_text(
        current_user.get("employee_id")
        or current_user.get("employee_ref_id")
        or current_user.get("employee_code")
        or current_user.get("emp_code")
        or current_user.get("code")
    )

    employee_identifiers = {
        normalize_text(employee.get("_id")),
        normalize_text(employee.get("employee_id")),
        normalize_text(employee.get("employee_code")),
        normalize_text(employee.get("emp_code")),
        normalize_text(employee.get("code")),
        normalize_text(employee.get("user_id")),
    }

    employee_identifiers = {
        item for item in employee_identifiers if item
    }

    if user_employee_id and user_employee_id in employee_identifiers:
        return True

    user_email = normalize_text(
        current_user.get("email")
        or current_user.get("official_email")
        or current_user.get("username")
    ).lower()

    employee_emails = {
        normalize_text(employee.get("email")).lower(),
        normalize_text(employee.get("official_email")).lower(),
    }

    employee_emails = {
        item for item in employee_emails if item
    }

    if user_email and user_email in employee_emails:
        return True

    return False


def sync_profile_media_to_user(db, employee, update_payload):
    if not employee or not update_payload:
        return

    user_payload = {
        **update_payload,
        "updated_at": datetime.utcnow(),
    }

    user_id = normalize_text(employee.get("user_id"))
    user_obj_id = safe_object_id(user_id)

    if user_obj_id:
        db.users.update_one(
            {"_id": user_obj_id},
            {"$set": user_payload},
        )
        return

    email = employee_email(employee)

    if email:
        db.users.update_one(
            {
                "email": email,
                "tenant_id": employee.get("tenant_id") or current_tenant_id(),
                "is_deleted": {"$ne": True},
            },
            {"$set": user_payload},
        )


def sync_photo_to_user(db, employee, photo_path):
    sync_profile_media_to_user(db, employee, photo_alias_payload(photo_path))


def sync_cover_to_user(db, employee, cover_path):
    sync_profile_media_to_user(db, employee, cover_alias_payload(cover_path))


def save_employee_image_file(file, employee, upload_folder_type, file_prefix, max_bytes, label):
    if not file:
        return "", f"{label} file is required"

    original_filename = secure_filename(file.filename or "")

    if not original_filename or not allowed_file(original_filename):
        return "", "Only JPG, JPEG, PNG, and WEBP images are allowed"

    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)

    if file_size > max_bytes:
        size_mb = max_bytes // (1024 * 1024)
        return "", f"{label} must be below {size_mb}MB"

    employee_id = str(employee.get("_id"))
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    tenant_folder = secure_filename(str(tenant_id).lower()) or "sds"

    upload_root = get_upload_root(upload_folder_type)
    tenant_upload_dir = os.path.join(upload_root, tenant_folder)
    os.makedirs(tenant_upload_dir, exist_ok=True)

    fallback_ext = original_filename.rsplit(".", 1)[-1].lower()
    temp_name = f"tmp_{uuid4().hex}.{fallback_ext}"
    temp_path = os.path.join(tenant_upload_dir, temp_name)

    file.save(temp_path)

    detected_ext = detect_extension(temp_path, fallback_ext)

    if detected_ext not in ALLOWED_IMAGE_EXTENSIONS:
        try:
            os.remove(temp_path)
        except Exception:
            pass

        return "", "Invalid image file"

    final_name = f"employee_{employee_id}_{file_prefix}_{uuid4().hex}.{detected_ext}"
    final_name = secure_filename(final_name)
    final_path = os.path.join(tenant_upload_dir, final_name)

    os.replace(temp_path, final_path)

    return f"/api/v1/uploads/{upload_folder_type}/{tenant_folder}/{final_name}", ""


def save_company_logo_file(file, tenant):
    if not file:
        return "", "Company logo file is required"

    original_filename = secure_filename(file.filename or "")

    if not original_filename or not allowed_file(original_filename):
        return "", "Only JPG, JPEG, PNG, and WEBP images are allowed"

    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)

    if file_size > MAX_COMPANY_LOGO_BYTES:
        return "", "Company logo must be below 3MB"

    tenant_id = normalize_text(tenant.get("tenant_id")) or current_tenant_id()
    tenant_folder = secure_filename(tenant_id.lower()) or "sds"

    upload_root = get_upload_root("company_logos")
    tenant_upload_dir = os.path.join(upload_root, tenant_folder)
    os.makedirs(tenant_upload_dir, exist_ok=True)

    fallback_ext = original_filename.rsplit(".", 1)[-1].lower()
    temp_name = f"tmp_{uuid4().hex}.{fallback_ext}"
    temp_path = os.path.join(tenant_upload_dir, temp_name)

    file.save(temp_path)

    detected_ext = detect_extension(temp_path, fallback_ext)

    if detected_ext not in ALLOWED_IMAGE_EXTENSIONS:
        try:
            os.remove(temp_path)
        except Exception:
            pass

        return "", "Invalid image file"

    final_name = secure_filename(
        f"company_logo_{uuid4().hex}.{detected_ext}"
    )
    final_path = os.path.join(tenant_upload_dir, final_name)

    os.replace(temp_path, final_path)

    return f"/api/v1/uploads/company_logos/{tenant_folder}/{final_name}", ""


def save_platform_logo_file(file):
    if not file:
        return "", "Platform logo file is required"

    original_filename = secure_filename(file.filename or "")

    if not original_filename or not allowed_file(original_filename):
        return "", "Only JPG, JPEG, PNG, and WEBP images are allowed"

    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)

    if file_size > MAX_PLATFORM_LOGO_BYTES:
        return "", "Platform logo must be below 3MB"

    upload_root = get_upload_root("platform_logos")
    fallback_ext = original_filename.rsplit(".", 1)[-1].lower()
    temp_name = f"tmp_{uuid4().hex}.{fallback_ext}"
    temp_path = os.path.join(upload_root, temp_name)

    file.save(temp_path)

    detected_ext = detect_extension(temp_path, fallback_ext)

    if detected_ext not in ALLOWED_IMAGE_EXTENSIONS:
        try:
            os.remove(temp_path)
        except Exception:
            pass

        return "", "Invalid image file"

    final_name = secure_filename(
        f"yourcomate_logo_{uuid4().hex}.{detected_ext}"
    )
    final_path = os.path.join(upload_root, final_name)

    os.replace(temp_path, final_path)

    return f"/api/v1/uploads/platform_logos/{final_name}", ""


def remove_managed_platform_logo(logo_path):
    logo_path = normalize_text(logo_path)
    route_prefix = "/api/v1/uploads/platform_logos/"

    if not logo_path.startswith(route_prefix):
        return

    safe_filename = secure_filename(logo_path[len(route_prefix):])

    if not safe_filename:
        return

    upload_root = get_upload_root("platform_logos")
    file_path = os.path.abspath(os.path.join(upload_root, safe_filename))

    try:
        if os.path.commonpath([upload_root, file_path]) != upload_root:
            return
    except ValueError:
        return

    try:
        if os.path.isfile(file_path):
            os.remove(file_path)
    except OSError:
        pass


def remove_managed_company_logo(logo_path):
    logo_path = normalize_text(logo_path)
    route_prefix = "/api/v1/uploads/company_logos/"

    if not logo_path.startswith(route_prefix):
        return

    relative_path = logo_path[len(route_prefix):]
    path_parts = relative_path.split("/", 1)

    if len(path_parts) != 2:
        return

    tenant_folder = secure_filename(path_parts[0])
    safe_filename = secure_filename(path_parts[1])

    if not tenant_folder or not safe_filename:
        return

    upload_root = get_upload_root("company_logos")
    file_path = os.path.abspath(
        os.path.join(upload_root, tenant_folder, safe_filename)
    )

    try:
        if os.path.commonpath([upload_root, file_path]) != upload_root:
            return
    except ValueError:
        return

    try:
        if os.path.isfile(file_path):
            os.remove(file_path)
    except OSError:
        pass


@profile_photos_bp.get("/platform-branding")
@current_user_required
def get_platform_branding():
    db = get_db()
    setting = find_platform_branding_setting(db)

    return jsonify({
        "branding": platform_branding_payload(setting),
        "can_manage_branding": can_manage_platform_branding(),
    })


@profile_photos_bp.post("/platform-branding")
@current_user_required
def update_platform_branding():
    if not can_manage_platform_branding():
        return jsonify({
            "message": "Only the Platform Superadmin can update YourComate branding"
        }), 403

    db = get_db()
    existing_setting = find_platform_branding_setting(db) or {}
    existing_branding = platform_branding_payload(existing_setting)

    json_payload = request.get_json(silent=True)
    if not isinstance(json_payload, dict):
        json_payload = {}

    tagline_keys = ("tagline", "platform_tagline")
    tagline_provided = any(key in json_payload for key in tagline_keys) or any(
        key in request.form for key in tagline_keys
    )

    tagline_value = None
    if tagline_provided:
        tagline_value = normalize_text(
            json_payload.get("tagline")
            or json_payload.get("platform_tagline")
            or request.form.get("tagline")
            or request.form.get("platform_tagline")
        )

        if not tagline_value:
            tagline_value = DEFAULT_PLATFORM_TAGLINE

        if len(tagline_value) > MAX_PLATFORM_TAGLINE_LENGTH:
            return jsonify({
                "message": (
                    "Platform tagline must not exceed "
                    f"{MAX_PLATFORM_TAGLINE_LENGTH} characters"
                )
            }), 400

    logo_file = (
        request.files.get("logo")
        or request.files.get("platform_logo")
        or request.files.get("file")
        or request.files.get("image")
    )

    if not tagline_provided and not logo_file:
        return jsonify({
            "message": "Provide a tagline or a platform logo to update"
        }), 400

    previous_logo = existing_branding.get("logo_url", "")
    logo_path = previous_logo

    if logo_file:
        logo_path, error = save_platform_logo_file(logo_file)

        if error:
            return jsonify({"message": error}), 400

    tagline = (
        tagline_value
        if tagline_provided
        else existing_branding.get("tagline") or DEFAULT_PLATFORM_TAGLINE
    )

    changed_at = datetime.utcnow()
    changed_by = current_user_id()
    setting_value = {
        "product_name": PLATFORM_PRODUCT_NAME,
        "tagline": tagline,
        "platform_logo": logo_path,
        "platform_logo_url": logo_path,
        "logo": logo_path,
        "logo_url": logo_path,
    }

    query = platform_branding_setting_query()
    query.pop("is_deleted", None)

    db.system_settings.update_one(
        query,
        {
            "$set": {
                "tenant_id": PLATFORM_BRANDING_TENANT_ID,
                "setting_group": PLATFORM_BRANDING_SETTING_GROUP,
                "setting_key": PLATFORM_BRANDING_SETTING_KEY,
                "setting_value": setting_value,
                "product_name": PLATFORM_PRODUCT_NAME,
                "tagline": tagline,
                "platform_logo": logo_path,
                "platform_logo_url": logo_path,
                "logo": logo_path,
                "logo_url": logo_path,
                "description": "Global YourComate sidebar logo and tagline",
                "updated_at": changed_at,
                "updated_by": changed_by,
                "is_deleted": False,
            },
            "$setOnInsert": {
                "created_at": changed_at,
                "created_by": changed_by,
            },
        },
        upsert=True,
    )

    updated_setting = find_platform_branding_setting(db)

    if logo_file and previous_logo and previous_logo != logo_path:
        remove_managed_platform_logo(previous_logo)

    audit(
        "platform_branding_updated",
        "system_settings",
        updated_setting.get("_id") if updated_setting else None,
        {
            "tagline_updated": tagline_provided,
            "logo_updated": bool(logo_file),
        },
    )

    return jsonify({
        "message": "YourComate branding updated successfully",
        "branding": platform_branding_payload(updated_setting),
        "can_manage_branding": True,
    })


@profile_photos_bp.delete("/platform-branding/logo")
@current_user_required
def delete_platform_logo():
    if not can_manage_platform_branding():
        return jsonify({
            "message": "Only the Platform Superadmin can remove the YourComate logo"
        }), 403

    db = get_db()
    existing_setting = find_platform_branding_setting(db) or {}
    existing_branding = platform_branding_payload(existing_setting)
    previous_logo = existing_branding.get("logo_url", "")
    tagline = existing_branding.get("tagline") or DEFAULT_PLATFORM_TAGLINE
    changed_at = datetime.utcnow()
    changed_by = current_user_id()

    query = platform_branding_setting_query()
    query.pop("is_deleted", None)

    db.system_settings.update_one(
        query,
        {
            "$set": {
                "tenant_id": PLATFORM_BRANDING_TENANT_ID,
                "setting_group": PLATFORM_BRANDING_SETTING_GROUP,
                "setting_key": PLATFORM_BRANDING_SETTING_KEY,
                "setting_value": {
                    "product_name": PLATFORM_PRODUCT_NAME,
                    "tagline": tagline,
                    "platform_logo": "",
                    "platform_logo_url": "",
                    "logo": "",
                    "logo_url": "",
                },
                "product_name": PLATFORM_PRODUCT_NAME,
                "tagline": tagline,
                "platform_logo": "",
                "platform_logo_url": "",
                "logo": "",
                "logo_url": "",
                "description": "Global YourComate sidebar logo and tagline",
                "updated_at": changed_at,
                "updated_by": changed_by,
                "is_deleted": False,
            },
            "$setOnInsert": {
                "created_at": changed_at,
                "created_by": changed_by,
            },
        },
        upsert=True,
    )

    updated_setting = find_platform_branding_setting(db)
    remove_managed_platform_logo(previous_logo)

    audit(
        "platform_logo_removed",
        "system_settings",
        updated_setting.get("_id") if updated_setting else None,
        {"previous_logo_present": bool(previous_logo)},
    )

    return jsonify({
        "message": "YourComate logo removed successfully",
        "branding": platform_branding_payload(updated_setting),
        "can_manage_branding": True,
    })


@profile_photos_bp.get("/tenant-branding")
@current_user_required
def get_tenant_branding():
    db = get_db()
    tenant = find_current_tenant(db)

    if not tenant:
        return jsonify({"message": "Company account not found"}), 404

    return jsonify({
        "branding": tenant_branding_payload(tenant),
        "tenant": clean_doc(tenant),
        "can_manage_branding": can_manage_tenant_branding(),
    })


@profile_photos_bp.post("/tenant-branding/logo")
@current_user_required
def upload_company_logo():
    if not can_manage_tenant_branding():
        return jsonify({
            "message": "Only the company administrator can update the company logo"
        }), 403

    db = get_db()
    tenant = find_current_tenant(db)

    if not tenant:
        return jsonify({"message": "Company account not found"}), 404

    file = (
        request.files.get("logo")
        or request.files.get("company_logo")
        or request.files.get("file")
        or request.files.get("image")
    )

    logo_path, error = save_company_logo_file(file, tenant)

    if error:
        return jsonify({"message": error}), 400

    previous_logo = company_logo_value(tenant)
    changed_at = datetime.utcnow()
    changed_by = current_user_id()

    update_payload = {
        **company_logo_alias_payload(logo_path),
        "branding.company_name": company_name_value(tenant),
        "branding.updated_at": changed_at,
        "branding.updated_by": changed_by,
        "updated_at": changed_at,
        "updated_by": changed_by,
    }

    db.tenants.update_one(
        {"_id": tenant["_id"]},
        {"$set": update_payload},
    )

    updated_tenant = db.tenants.find_one({"_id": tenant["_id"]})

    if previous_logo and previous_logo != logo_path:
        remove_managed_company_logo(previous_logo)

    return jsonify({
        "message": "Company logo uploaded successfully",
        "company_logo": logo_path,
        "logo": logo_path,
        "branding": tenant_branding_payload(updated_tenant),
        "tenant": clean_doc(updated_tenant),
    })


@profile_photos_bp.delete("/tenant-branding/logo")
@current_user_required
def delete_company_logo():
    if not can_manage_tenant_branding():
        return jsonify({
            "message": "Only the company administrator can remove the company logo"
        }), 403

    db = get_db()
    tenant = find_current_tenant(db)

    if not tenant:
        return jsonify({"message": "Company account not found"}), 404

    previous_logo = company_logo_value(tenant)
    changed_at = datetime.utcnow()
    changed_by = current_user_id()

    db.tenants.update_one(
        {"_id": tenant["_id"]},
        {
            "$set": {
                **company_logo_alias_payload(""),
                "branding.company_name": company_name_value(tenant),
                "branding.updated_at": changed_at,
                "branding.updated_by": changed_by,
                "updated_at": changed_at,
                "updated_by": changed_by,
            }
        },
    )

    updated_tenant = db.tenants.find_one({"_id": tenant["_id"]})
    remove_managed_company_logo(previous_logo)

    return jsonify({
        "message": "Company logo removed successfully",
        "company_logo": "",
        "logo": "",
        "branding": tenant_branding_payload(updated_tenant),
        "tenant": clean_doc(updated_tenant),
    })


@profile_photos_bp.post("/profile-photos/upload")
@tenant_module_required("profile")
def upload_profile_photo():
    db = get_db()

    employee_id = normalize_text(
        request.form.get("employee_id")
        or request.form.get("employeeId")
        or request.form.get("id")
    )

    if not employee_id:
        return jsonify({"message": "employee_id is required"}), 400

    employee = find_employee(db, employee_id)

    if not employee:
        return jsonify({"message": "Employee not found"}), 404

    if not can_update_employee_photo(employee):
        return jsonify({"message": "You do not have permission to update this photo"}), 403

    file = (
        request.files.get("photo")
        or request.files.get("file")
        or request.files.get("image")
    )

    photo_path, error = save_employee_image_file(
        file=file,
        employee=employee,
        upload_folder_type="profile_photos",
        file_prefix="photo",
        max_bytes=MAX_PROFILE_PHOTO_BYTES,
        label="Profile photo",
    )

    if error:
        return jsonify({"message": error}), 400

    update_payload = {
        **photo_alias_payload(photo_path),
        "updated_at": datetime.utcnow(),
        "updated_by": current_user_id(),
    }

    db.employees.update_one(
        {"_id": employee["_id"]},
        {"$set": update_payload},
    )

    updated_employee = db.employees.find_one({"_id": employee["_id"]})

    sync_photo_to_user(db, updated_employee, photo_path)

    return jsonify({
        "message": "Profile photo uploaded successfully",
        "photo": photo_path,
        "photo_url": photo_path,
        "employee": clean_doc(updated_employee),
    })


@profile_photos_bp.post("/profile-covers/upload")
@tenant_module_required("profile")
def upload_profile_cover():
    db = get_db()

    employee_id = normalize_text(
        request.form.get("employee_id")
        or request.form.get("employeeId")
        or request.form.get("id")
    )

    if not employee_id:
        return jsonify({"message": "employee_id is required"}), 400

    employee = find_employee(db, employee_id)

    if not employee:
        return jsonify({"message": "Employee not found"}), 404

    if not can_update_employee_photo(employee):
        return jsonify({"message": "You do not have permission to update this cover image"}), 403

    file = (
        request.files.get("cover")
        or request.files.get("cover_image")
        or request.files.get("photo")
        or request.files.get("file")
        or request.files.get("image")
    )

    cover_path, error = save_employee_image_file(
        file=file,
        employee=employee,
        upload_folder_type="profile_covers",
        file_prefix="cover",
        max_bytes=MAX_PROFILE_COVER_BYTES,
        label="Cover image",
    )

    if error:
        return jsonify({"message": error}), 400

    update_payload = {
        **cover_alias_payload(cover_path),
        "updated_at": datetime.utcnow(),
        "updated_by": current_user_id(),
    }

    db.employees.update_one(
        {"_id": employee["_id"]},
        {"$set": update_payload},
    )

    updated_employee = db.employees.find_one({"_id": employee["_id"]})

    sync_cover_to_user(db, updated_employee, cover_path)

    return jsonify({
        "message": "Cover image uploaded successfully",
        "cover": cover_path,
        "cover_url": cover_path,
        "cover_image": cover_path,
        "employee": clean_doc(updated_employee),
    })


@profile_photos_bp.get("/uploads/profile_photos/<tenant>/<filename>")
def serve_profile_photo(tenant, filename):
    upload_root = get_upload_root("profile_photos")
    tenant_folder = secure_filename(tenant)
    safe_filename = secure_filename(filename)

    directory = os.path.join(upload_root, tenant_folder)

    return send_from_directory(directory, safe_filename)


@profile_photos_bp.get("/uploads/profile_covers/<tenant>/<filename>")
def serve_profile_cover(tenant, filename):
    upload_root = get_upload_root("profile_covers")
    tenant_folder = secure_filename(tenant)
    safe_filename = secure_filename(filename)

    directory = os.path.join(upload_root, tenant_folder)

    return send_from_directory(directory, safe_filename)

@profile_photos_bp.get("/uploads/platform_logos/<filename>")
def serve_platform_logo(filename):
    upload_root = get_upload_root("platform_logos")
    safe_filename = secure_filename(filename)

    return send_from_directory(upload_root, safe_filename)


@profile_photos_bp.get("/uploads/company_logos/<tenant>/<filename>")
def serve_company_logo(tenant, filename):
    upload_root = get_upload_root("company_logos")
    tenant_folder = secure_filename(tenant)
    safe_filename = secure_filename(filename)

    directory = os.path.join(upload_root, tenant_folder)

    return send_from_directory(directory, safe_filename)