import os
from uuid import uuid4
from datetime import datetime

from bson import ObjectId
from flask import Blueprint, request, jsonify, g, current_app, send_from_directory
from werkzeug.utils import secure_filename

from app.extensions import get_db
from app.utils.auth import current_user_required
from app.utils.serializers import clean_doc


profile_photos_bp = Blueprint("profile_photos", __name__)


ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024


ADMIN_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
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


def get_upload_root():
    configured = current_app.config.get("PROFILE_PHOTO_UPLOAD_FOLDER")

    if configured:
        upload_root = configured
    else:
        upload_root = os.path.join(
            current_app.root_path,
            "..",
            "uploads",
            "profile_photos",
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
    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return None

    query = {
        "_id": employee_obj_id,
        "is_deleted": {"$ne": True},
    }

    if not is_admin_user():
        query["tenant_id"] = current_tenant_id()

    employee = db.employees.find_one(query)

    if employee:
        return employee

    if is_admin_user():
        return db.employees.find_one({
            "_id": employee_obj_id,
            "is_deleted": {"$ne": True},
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
    )

    if user_employee_id and user_employee_id == str(employee.get("_id")):
        return True

    return False


def sync_photo_to_user(db, employee, photo_path):
    if not employee:
        return

    update_payload = {
        **photo_alias_payload(photo_path),
        "updated_at": datetime.utcnow(),
    }

    user_id = normalize_text(employee.get("user_id"))
    user_obj_id = safe_object_id(user_id)

    if user_obj_id:
        db.users.update_one(
            {"_id": user_obj_id},
            {"$set": update_payload},
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
            {"$set": update_payload},
        )


@profile_photos_bp.post("/profile-photos/upload")
@current_user_required
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

    if not file:
        return jsonify({"message": "Photo file is required"}), 400

    original_filename = secure_filename(file.filename or "")

    if not original_filename or not allowed_file(original_filename):
        return jsonify({"message": "Only JPG, JPEG, PNG, and WEBP images are allowed"}), 400

    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)

    if file_size > MAX_PROFILE_PHOTO_BYTES:
        return jsonify({"message": "Profile photo must be below 2MB"}), 400

    tenant_id = employee.get("tenant_id") or current_tenant_id()
    tenant_folder = secure_filename(str(tenant_id).lower()) or "sds"

    upload_root = get_upload_root()
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

        return jsonify({"message": "Invalid image file"}), 400

    final_name = f"employee_{employee_id}_{uuid4().hex}.{detected_ext}"
    final_name = secure_filename(final_name)
    final_path = os.path.join(tenant_upload_dir, final_name)

    os.replace(temp_path, final_path)

    photo_path = f"/api/v1/uploads/profile_photos/{tenant_folder}/{final_name}"

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


@profile_photos_bp.get("/uploads/profile_photos/<tenant>/<filename>")
def serve_profile_photo(tenant, filename):
    upload_root = get_upload_root()
    tenant_folder = secure_filename(tenant)
    safe_filename = secure_filename(filename)

    directory = os.path.join(upload_root, tenant_folder)

    return send_from_directory(directory, safe_filename)