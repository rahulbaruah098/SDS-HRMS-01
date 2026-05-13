import os
from datetime import datetime
from uuid import uuid4

from bson import ObjectId
from flask import Blueprint, request, jsonify, g, current_app, send_file
from werkzeug.utils import secure_filename

from app.extensions import get_db
from app.utils.auth import current_user_required, roles_required, audit
from app.utils.serializers import clean_doc


policies_bp = Blueprint("policies", __name__)


ALLOWED_POLICY_EXTENSIONS = {
    "pdf",
    "docx",
    "jpg",
    "jpeg",
    "png",
    "webp",
}


HR_POLICY_UPLOAD_ROLES = {
    "hr",
    "hr_admin",
    "hr_manager",
}


def now_utc():
    return datetime.utcnow()


def normalize_text(value):
    return str(value or "").strip()


def current_tenant_id():
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id") or "sds"


def current_user_id():
    return str(g.current_user.get("_id") or g.current_user.get("id") or "")


def current_user_name():
    return (
        g.current_user.get("name")
        or g.current_user.get("full_name")
        or g.current_user.get("email")
        or "User"
    )


def safe_object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def get_file_extension(filename):
    if not filename or "." not in filename:
        return ""

    return filename.rsplit(".", 1)[1].lower().strip()


def is_allowed_policy_file(filename):
    return get_file_extension(filename) in ALLOWED_POLICY_EXTENSIONS


def policy_upload_folder():
    folder = os.path.join(
        current_app.root_path,
        "..",
        "uploads",
        "policies",
        current_tenant_id(),
    )

    folder = os.path.abspath(folder)
    os.makedirs(folder, exist_ok=True)

    return folder


def save_policy_file(file_storage):
    original_name = secure_filename(file_storage.filename or "")
    extension = get_file_extension(original_name)

    stored_name = f"policy_{uuid4().hex}.{extension}"
    upload_folder = policy_upload_folder()
    absolute_path = os.path.join(upload_folder, stored_name)

    file_storage.save(absolute_path)

    return {
        "original_name": original_name,
        "stored_name": stored_name,
        "extension": extension,
        "mime_type": file_storage.mimetype or "",
        "size_bytes": os.path.getsize(absolute_path),
        "relative_path": f"uploads/policies/{current_tenant_id()}/{stored_name}",
        "absolute_path": absolute_path,
    }


def policy_base_query():
    return {
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    }


@policies_bp.get("/policies")
@current_user_required
def list_policies():
    db = get_db()

    q = policy_base_query()

    search = normalize_text(request.args.get("q") or request.args.get("search"))
    status = normalize_text(request.args.get("status"))

    if status:
        q["status"] = status
    else:
        q["status"] = {"$ne": "inactive"}

    if search:
        q["$or"] = [
            {"document_id": {"$regex": search, "$options": "i"}},
            {"title": {"$regex": search, "$options": "i"}},
            {"summary": {"$regex": search, "$options": "i"}},
        ]

    try:
        page = max(int(request.args.get("page", 1)), 1)
    except Exception:
        page = 1

    try:
        limit = min(max(int(request.args.get("limit", 20)), 1), 100)
    except Exception:
        limit = 20

    skip = (page - 1) * limit

    total = db.policies.count_documents(q)

    items = list(
        db.policies
        .find(q)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )

    return jsonify({
        "items": clean_doc(items),
        "total": total,
        "page": page,
        "limit": limit,
        "collection": "policies",
    })


@policies_bp.post("/policies")
@roles_required("hr", "hr_admin", "hr_manager")
def upload_policy():
    db = get_db()

    document_id = normalize_text(request.form.get("document_id"))
    title = normalize_text(request.form.get("title"))
    summary = normalize_text(request.form.get("summary"))

    policy_file = request.files.get("file") or request.files.get("policy_file")

    if not document_id:
        return jsonify({"message": "Document ID Number is required"}), 400

    if not title:
        return jsonify({"message": "Policy title is required"}), 400

    if not summary:
        return jsonify({"message": "Policy summary is required"}), 400

    if not policy_file or not policy_file.filename:
        return jsonify({"message": "Policy file is required"}), 400

    if not is_allowed_policy_file(policy_file.filename):
        return jsonify({
            "message": "Only PDF, DOCX, JPG, JPEG, PNG and WEBP files are allowed"
        }), 400

    tenant_id = current_tenant_id()

    duplicate = db.policies.find_one({
        "tenant_id": tenant_id,
        "document_id": document_id,
        "is_deleted": {"$ne": True},
    })

    if duplicate:
        return jsonify({
            "message": "A policy with this Document ID already exists for this tenant"
        }), 400

    saved_file = save_policy_file(policy_file)
    now = now_utc()

    payload = {
        "tenant_id": tenant_id,
        "document_id": document_id,
        "title": title,
        "summary": summary,
        "file": {
            "original_name": saved_file["original_name"],
            "stored_name": saved_file["stored_name"],
            "extension": saved_file["extension"],
            "mime_type": saved_file["mime_type"],
            "size_bytes": saved_file["size_bytes"],
            "relative_path": saved_file["relative_path"],
        },
        "file_original_name": saved_file["original_name"],
        "file_stored_name": saved_file["stored_name"],
        "file_extension": saved_file["extension"],
        "file_mime_type": saved_file["mime_type"],
        "file_size_bytes": saved_file["size_bytes"],
        "file_path": saved_file["relative_path"],
        "status": "active",
        "created_at": now,
        "updated_at": now,
        "created_by": current_user_id(),
        "created_by_name": current_user_name(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
        "is_deleted": False,
    }

    result = db.policies.insert_one(payload)
    payload["_id"] = result.inserted_id

    audit("upload_policy", "policies", str(result.inserted_id), {
        "document_id": document_id,
        "title": title,
        "tenant_id": tenant_id,
    })

    return jsonify({
        "message": "Policy uploaded successfully",
        "item": clean_doc(payload),
    }), 201


@policies_bp.get("/policies/<policy_id>")
@current_user_required
def get_policy(policy_id):
    policy_obj_id = safe_object_id(policy_id)

    if not policy_obj_id:
        return jsonify({"message": "Invalid policy id"}), 400

    db = get_db()

    policy = db.policies.find_one({
        "_id": policy_obj_id,
        **policy_base_query(),
    })

    if not policy:
        return jsonify({"message": "Policy not found"}), 404

    return jsonify({
        "item": clean_doc(policy),
    })


@policies_bp.get("/policies/<policy_id>/download")
@current_user_required
def download_policy(policy_id):
    policy_obj_id = safe_object_id(policy_id)

    if not policy_obj_id:
        return jsonify({"message": "Invalid policy id"}), 400

    db = get_db()

    policy = db.policies.find_one({
        "_id": policy_obj_id,
        **policy_base_query(),
    })

    if not policy:
        return jsonify({"message": "Policy not found"}), 404

    file_data = policy.get("file") or {}
    stored_name = file_data.get("stored_name") or policy.get("file_stored_name")
    original_name = file_data.get("original_name") or policy.get("file_original_name") or stored_name

    if not stored_name:
        return jsonify({"message": "Policy file is missing"}), 404

    file_path = os.path.abspath(
        os.path.join(policy_upload_folder(), stored_name)
    )

    upload_root = os.path.abspath(policy_upload_folder())

    if not file_path.startswith(upload_root):
        return jsonify({"message": "Invalid file path"}), 400

    if not os.path.exists(file_path):
        return jsonify({"message": "Policy file not found on server"}), 404

    return send_file(
        file_path,
        as_attachment=True,
        download_name=original_name,
    )