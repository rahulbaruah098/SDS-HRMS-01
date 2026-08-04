"""Tenant-scoped field visit workflow.

Employees can schedule and manage their own visits. Team Leaders and Reporting
Officers can additionally review visits for employees inside their permitted
team scope. Every visit transition stores its own GPS checkpoint and timestamp.
"""

from datetime import datetime, date
import os
import re
from uuid import uuid4

from bson import ObjectId
from flask import Blueprint, current_app, g, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from app.extensions import get_db
from app.middleware.tenant_guard import tenant_module_required
from app.utils.auth import audit
from app.utils.serializers import clean_doc


field_visits_bp = Blueprint("field_visits", __name__)

ACTIVE_STATUSES = {"scheduled", "started", "reached"}
HISTORY_STATUSES = {"completed", "cancelled"}
TEAM_ROLES = {
    "admin",
    "hr",
    "hr_admin",
    "hr_manager",
    "team_leader",
    "reporting_officer",
    "ro",
    "manager",
}
FULL_TENANT_ROLES = {"admin", "hr", "hr_admin", "hr_manager"}
ALLOWED_PICTURE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_PICTURE_SIZE_BYTES = 8 * 1024 * 1024
MAX_PICTURES_PER_VISIT = 10


def normalize_text(value):
    return str(value or "").strip()


def normalize_role(value):
    return normalize_text(value).lower().replace("-", "_").replace(" ", "_")


def truthy_value(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value == 1
    return normalize_text(value).lower() in {"true", "1", "yes", "on"}


def safe_path_part(value):
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", normalize_text(value))
    return value.strip("._") or "unknown"


def allowed_picture(filename):
    filename = normalize_text(filename)
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_PICTURE_EXTENSIONS


def picture_upload_root():
    configured = normalize_text(current_app.config.get("FIELD_VISIT_UPLOAD_FOLDER"))
    if configured:
        return os.path.abspath(configured)

    backend_root = os.path.abspath(os.path.join(current_app.root_path, os.pardir))
    return os.path.join(backend_root, "uploads", "field_visits")


def file_size_bytes(file_storage):
    stream = file_storage.stream
    current_position = stream.tell()
    stream.seek(0, os.SEEK_END)
    size = stream.tell()
    stream.seek(current_position)
    return size


def safe_object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def now_utc():
    return datetime.utcnow()


def current_tenant_id():
    user = getattr(g, "current_user", {}) or {}
    return normalize_text(getattr(g, "tenant_id", None) or user.get("tenant_id"))


def current_user_id():
    user = getattr(g, "current_user", {}) or {}
    return normalize_text(user.get("_id") or user.get("id"))


def current_user_roles():
    user = getattr(g, "current_user", {}) or {}
    raw_roles = user.get("roles")

    if isinstance(raw_roles, list):
        roles = {normalize_role(role) for role in raw_roles if normalize_role(role)}
    elif isinstance(raw_roles, str):
        roles = {normalize_role(role) for role in raw_roles.split(",") if normalize_role(role)}
    else:
        roles = set()

    single_role = normalize_role(user.get("role"))
    if single_role:
        roles.add(single_role)

    return roles


def can_view_team(employee):
    roles = current_user_roles()
    if roles.intersection(TEAM_ROLES):
        return True

    employee = employee or {}
    return (
        truthy_value(employee.get("is_team_leader"))
        or truthy_value(employee.get("is_reporting_officer"))
    )


def get_current_employee(db):
    tenant_id = current_tenant_id()
    user = getattr(g, "current_user", {}) or {}
    user_id = current_user_id()
    employee_ref = normalize_text(
        user.get("employee_id")
        or user.get("employee_ref_id")
        or user.get("employee_code")
        or user.get("emp_code")
    )
    email = normalize_text(user.get("email") or user.get("username")).lower()

    conditions = []
    if user_id:
        conditions.extend([{"user_id": user_id}, {"employee_ref_id": user_id}])
        user_oid = safe_object_id(user_id)
        if user_oid:
            conditions.append({"user_id": user_oid})

    if employee_ref:
        conditions.extend([
            {"employee_id": employee_ref},
            {"employee_code": employee_ref},
            {"emp_code": employee_ref},
        ])
        employee_oid = safe_object_id(employee_ref)
        if employee_oid:
            conditions.append({"_id": employee_oid})

    if email:
        conditions.extend([
            {"email": email},
            {"official_email": email},
            {"personal_email": email},
        ])

    if not tenant_id or not conditions:
        return None

    return db.employees.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": conditions,
    })


def employee_name(employee):
    return normalize_text(
        employee.get("name")
        or employee.get("full_name")
        or employee.get("employee_name")
    )


def employee_identity_values(employee):
    values = {
        normalize_text(employee.get("_id")),
        normalize_text(employee.get("employee_id")),
        normalize_text(employee.get("employee_code")),
        normalize_text(employee.get("emp_code")),
        normalize_text(employee.get("user_id")),
    }
    return {value for value in values if value}


def team_employee_ids(db, employee):
    """Return tenant-scoped employee identifiers visible to the current user."""
    roles = current_user_roles()
    tenant_id = current_tenant_id()

    if roles.intersection(FULL_TENANT_ROLES):
        employees = db.employees.find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        values = set()
        for item in employees:
            values.update(employee_identity_values(item))
        return values

    own_values = employee_identity_values(employee)
    manager_values = list(own_values)
    manager_name = employee_name(employee)

    reporting_conditions = [
        {"reporting_officer_id": {"$in": manager_values}},
        {"reporting_manager_id": {"$in": manager_values}},
        {"team_leader_id": {"$in": manager_values}},
        {"manager_id": {"$in": manager_values}},
    ]
    if manager_name:
        reporting_conditions.extend([
            {"reporting_officer": manager_name},
            {"reporting_manager": manager_name},
            {"team_leader": manager_name},
            {"manager": manager_name},
        ])

    employees = db.employees.find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": reporting_conditions,
    })

    values = set(own_values)
    for item in employees:
        values.update(employee_identity_values(item))
    return values


def parse_location(payload):
    payload = payload or {}
    try:
        latitude = float(payload.get("latitude"))
        longitude = float(payload.get("longitude"))
    except (TypeError, ValueError):
        return None, "Valid latitude and longitude are required"

    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        return None, "Latitude or longitude is outside the valid range"

    accuracy = payload.get("accuracy")
    try:
        accuracy = float(accuracy) if accuracy not in (None, "") else None
    except (TypeError, ValueError):
        accuracy = None

    return {
        "latitude": latitude,
        "longitude": longitude,
        "accuracy": accuracy,
        "address": normalize_text(payload.get("address")),
        "captured_at": now_utc(),
    }, None


def get_visit_or_404(db, visit_id):
    visit_oid = safe_object_id(visit_id)
    if not visit_oid:
        return None, (jsonify({"message": "Invalid visit ID"}), 400)

    visit = db.field_visits.find_one({
        "_id": visit_oid,
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    })
    if not visit:
        return None, (jsonify({"message": "Visit not found"}), 404)
    return visit, None


def can_view_visit(db, visit, employee):
    employee_id = normalize_text(visit.get("employee_ref_id") or visit.get("employee_id"))
    if employee_id in employee_identity_values(employee):
        return True

    if not can_view_team(employee):
        return False

    return employee_id in team_employee_ids(db, employee)


def is_visit_owner(visit, employee):
    owner_id = normalize_text(visit.get("employee_ref_id") or visit.get("employee_id"))
    return owner_id in employee_identity_values(employee)


@field_visits_bp.get("")
@tenant_module_required("attendance")
def list_visits():
    db = get_db()
    employee = get_current_employee(db)
    if not employee:
        return jsonify({"message": "Employee profile not found"}), 404

    scope = normalize_text(request.args.get("scope") or "mine").lower()
    tab = normalize_text(request.args.get("tab") or "active").lower()
    employee_filter = normalize_text(request.args.get("employee_id"))
    employee_name_filter = normalize_text(request.args.get("employee_name"))
    department = normalize_text(request.args.get("department"))
    visit_date = normalize_text(request.args.get("date"))

    query = {
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    }

    if tab == "history":
        query["status"] = {"$in": sorted(HISTORY_STATUSES)}
    else:
        query["status"] = {"$in": sorted(ACTIVE_STATUSES)}

    if scope == "team":
        if not can_view_team(employee):
            return jsonify({"message": "You do not have permission to view team visits"}), 403

        visible_ids = sorted(team_employee_ids(db, employee))
        query["employee_ref_id"] = {"$in": visible_ids}

        if employee_filter:
            if employee_filter not in visible_ids:
                return jsonify({"items": [], "count": 0})
            query["employee_ref_id"] = employee_filter

        if employee_name_filter:
            query["employee_name"] = {
                "$regex": re.escape(employee_name_filter),
                "$options": "i",
            }
    else:
        own_ids = sorted(employee_identity_values(employee))
        query["employee_ref_id"] = {"$in": own_ids}

    if department:
        query["department"] = {
            "$regex": f"^{re.escape(department)}$",
            "$options": "i",
        }
    if visit_date:
        query["scheduled_date"] = visit_date

    items = list(db.field_visits.find(query).sort([
        ("scheduled_date", 1),
        ("created_at", -1),
    ]))

    return jsonify({"items": clean_doc(items), "count": len(items)})


@field_visits_bp.post("")
@tenant_module_required("attendance")
def create_visit():
    db = get_db()
    employee = get_current_employee(db)
    if not employee:
        return jsonify({"message": "Employee profile not found"}), 404

    payload = request.get_json(silent=True) or {}
    title = normalize_text(payload.get("title"))
    scheduled_date = normalize_text(payload.get("date") or payload.get("scheduled_date"))
    description = normalize_text(payload.get("description"))

    if not title:
        return jsonify({"message": "Visit title is required"}), 400
    try:
        date.fromisoformat(scheduled_date)
    except (TypeError, ValueError):
        return jsonify({"message": "A valid visit date is required"}), 400

    now = now_utc()
    employee_ref_id = normalize_text(employee.get("_id"))
    doc = {
        "tenant_id": current_tenant_id(),
        "employee_ref_id": employee_ref_id,
        "employee_id": normalize_text(employee.get("employee_id") or employee.get("employee_code")),
        "employee_name": employee_name(employee),
        "employee_code": normalize_text(employee.get("employee_code") or employee.get("emp_code")),
        "department": normalize_text(employee.get("department")),
        "designation": normalize_text(employee.get("designation")),
        "title": title,
        "description": description,
        "scheduled_date": scheduled_date,
        "status": "scheduled",
        "pictures": [],
        "visit_notes": "",
        "created_at": now,
        "updated_at": now,
        "created_by": current_user_id(),
        "is_deleted": False,
    }

    result = db.field_visits.insert_one(doc)
    doc["_id"] = result.inserted_id
    audit("create_field_visit", "field_visits", result.inserted_id, {"title": title})
    return jsonify({"message": "Visit created successfully", "item": clean_doc(doc)}), 201


@field_visits_bp.post("/<visit_id>/pictures")
@tenant_module_required("attendance")
def upload_visit_picture(visit_id):
    db = get_db()
    employee = get_current_employee(db)
    if not employee:
        return jsonify({"message": "Employee profile not found"}), 404

    visit, error = get_visit_or_404(db, visit_id)
    if error:
        return error
    if not is_visit_owner(visit, employee):
        return jsonify({"message": "Only the visit owner can upload pictures"}), 403
    if visit.get("status") in HISTORY_STATUSES:
        return jsonify({"message": "Pictures cannot be added to a completed or cancelled visit"}), 409

    pictures = visit.get("pictures") if isinstance(visit.get("pictures"), list) else []
    if len(pictures) >= MAX_PICTURES_PER_VISIT:
        return jsonify({
            "message": f"A visit can contain a maximum of {MAX_PICTURES_PER_VISIT} pictures"
        }), 409

    picture = request.files.get("picture") or request.files.get("image") or request.files.get("file")
    if not picture or not normalize_text(picture.filename):
        return jsonify({"message": "A picture file is required"}), 400
    if not allowed_picture(picture.filename):
        return jsonify({"message": "Only JPG, JPEG, PNG and WEBP pictures are supported"}), 400

    try:
        size = file_size_bytes(picture)
    except (OSError, ValueError):
        return jsonify({"message": "Unable to read the uploaded picture"}), 400

    if size <= 0:
        return jsonify({"message": "The uploaded picture is empty"}), 400
    if size > MAX_PICTURE_SIZE_BYTES:
        return jsonify({"message": "The picture must not exceed 8 MB"}), 413

    original_name = secure_filename(picture.filename)
    extension = original_name.rsplit(".", 1)[1].lower()
    stored_name = f"{uuid4().hex}.{extension}"

    tenant_folder = safe_path_part(current_tenant_id())
    visit_folder = safe_path_part(visit_id)
    destination_folder = os.path.join(
        picture_upload_root(),
        tenant_folder,
        visit_folder,
    )
    os.makedirs(destination_folder, exist_ok=True)
    picture.save(os.path.join(destination_folder, stored_name))

    now = now_utc()
    metadata = {
        "id": uuid4().hex,
        "original_name": original_name,
        "stored_name": stored_name,
        "content_type": normalize_text(picture.mimetype),
        "size": size,
        "url": (
            f"/api/v1/field-visits/uploads/"
            f"{tenant_folder}/{visit_folder}/{stored_name}"
        ),
        "uploaded_at": now,
        "uploaded_by": current_user_id(),
    }

    db.field_visits.update_one(
        {
            "_id": visit["_id"],
            "tenant_id": current_tenant_id(),
            "is_deleted": {"$ne": True},
        },
        {
            "$push": {"pictures": metadata},
            "$set": {"updated_at": now},
        },
    )

    updated = db.field_visits.find_one({
        "_id": visit["_id"],
        "tenant_id": current_tenant_id(),
    })
    audit(
        "upload_field_visit_picture",
        "field_visits",
        visit["_id"],
        {"picture_id": metadata["id"]},
    )
    return jsonify({
        "message": "Visit picture uploaded successfully",
        "item": clean_doc(updated),
    }), 201


@field_visits_bp.get("/uploads/<tenant_folder>/<visit_folder>/<filename>")
def serve_visit_picture(tenant_folder, visit_folder, filename):
    safe_tenant = safe_path_part(tenant_folder)
    safe_visit = safe_path_part(visit_folder)
    safe_filename = secure_filename(filename)

    directory = os.path.join(
        picture_upload_root(),
        safe_tenant,
        safe_visit,
    )
    return send_from_directory(directory, safe_filename)


@field_visits_bp.get("/<visit_id>")
@tenant_module_required("attendance")
def get_visit(visit_id):
    db = get_db()
    employee = get_current_employee(db)
    if not employee:
        return jsonify({"message": "Employee profile not found"}), 404

    visit, error = get_visit_or_404(db, visit_id)
    if error:
        return error
    if not can_view_visit(db, visit, employee):
        return jsonify({"message": "You do not have permission to view this visit"}), 403

    return jsonify({"item": clean_doc(visit)})


@field_visits_bp.patch("/<visit_id>")
@tenant_module_required("attendance")
def update_visit(visit_id):
    db = get_db()
    employee = get_current_employee(db)
    if not employee:
        return jsonify({"message": "Employee profile not found"}), 404

    visit, error = get_visit_or_404(db, visit_id)
    if error:
        return error
    if not is_visit_owner(visit, employee):
        return jsonify({"message": "Only the visit owner can update this visit"}), 403
    if visit.get("status") in HISTORY_STATUSES:
        return jsonify({"message": "Completed or cancelled visits cannot be edited"}), 409

    payload = request.get_json(silent=True) or {}
    updates = {"updated_at": now_utc()}

    if "visit_notes" in payload:
        updates["visit_notes"] = normalize_text(payload.get("visit_notes"))
    if "description" in payload:
        updates["description"] = normalize_text(payload.get("description"))
    if "title" in payload:
        title = normalize_text(payload.get("title"))
        if not title:
            return jsonify({"message": "Visit title cannot be empty"}), 400
        updates["title"] = title

    db.field_visits.update_one({"_id": visit["_id"]}, {"$set": updates})
    updated = db.field_visits.find_one({"_id": visit["_id"]})
    return jsonify({"message": "Visit updated successfully", "item": clean_doc(updated)})


@field_visits_bp.post("/<visit_id>/reschedule")
@tenant_module_required("attendance")
def reschedule_visit(visit_id):
    db = get_db()
    employee = get_current_employee(db)
    visit, error = get_visit_or_404(db, visit_id)
    if error:
        return error
    if not employee or not is_visit_owner(visit, employee):
        return jsonify({"message": "Only the visit owner can reschedule this visit"}), 403
    if visit.get("status") != "scheduled":
        return jsonify({"message": "Only scheduled visits can be rescheduled"}), 409

    payload = request.get_json(silent=True) or {}
    new_date = normalize_text(payload.get("date") or payload.get("scheduled_date"))
    try:
        date.fromisoformat(new_date)
    except (TypeError, ValueError):
        return jsonify({"message": "A valid rescheduled date is required"}), 400

    now = now_utc()
    db.field_visits.update_one({"_id": visit["_id"]}, {"$set": {
        "rescheduled_from": visit.get("scheduled_date"),
        "scheduled_date": new_date,
        "rescheduled_at": now,
        "updated_at": now,
    }})
    updated = db.field_visits.find_one({"_id": visit["_id"]})
    return jsonify({"message": "Visit rescheduled successfully", "item": clean_doc(updated)})


@field_visits_bp.post("/<visit_id>/cancel")
@tenant_module_required("attendance")
def cancel_visit(visit_id):
    db = get_db()
    employee = get_current_employee(db)
    visit, error = get_visit_or_404(db, visit_id)
    if error:
        return error
    if not employee or not is_visit_owner(visit, employee):
        return jsonify({"message": "Only the visit owner can cancel this visit"}), 403
    if visit.get("status") in HISTORY_STATUSES:
        return jsonify({"message": "This visit is already closed"}), 409

    payload = request.get_json(silent=True) or {}
    now = now_utc()
    db.field_visits.update_one({"_id": visit["_id"]}, {"$set": {
        "status": "cancelled",
        "cancellation_reason": normalize_text(payload.get("reason")),
        "cancelled_at": now,
        "updated_at": now,
    }})
    updated = db.field_visits.find_one({"_id": visit["_id"]})
    return jsonify({"message": "Visit cancelled successfully", "item": clean_doc(updated)})


def transition_visit(visit_id, expected_status, next_status, location_field, timestamp_field):
    db = get_db()
    employee = get_current_employee(db)
    visit, error = get_visit_or_404(db, visit_id)
    if error:
        return error
    if not employee or not is_visit_owner(visit, employee):
        return jsonify({"message": "Only the visit owner can update its progress"}), 403
    if visit.get("status") != expected_status:
        return jsonify({
            "message": f"Visit must be {expected_status} before it can be marked {next_status}"
        }), 409

    payload = request.get_json(silent=True) or {}
    location, location_error = parse_location(payload)
    if location_error:
        return jsonify({"message": location_error}), 400

    now = now_utc()
    updates = {
        "status": next_status,
        location_field: location,
        timestamp_field: now,
        "updated_at": now,
    }
    db.field_visits.update_one({"_id": visit["_id"]}, {"$set": updates})
    updated = db.field_visits.find_one({"_id": visit["_id"]})
    return jsonify({
        "message": f"Visit marked as {next_status} successfully",
        "item": clean_doc(updated),
    })


@field_visits_bp.post("/<visit_id>/start")
@tenant_module_required("attendance")
def start_visit(visit_id):
    return transition_visit(visit_id, "scheduled", "started", "start_location", "started_at")


@field_visits_bp.post("/<visit_id>/reached")
@tenant_module_required("attendance")
def reached_visit(visit_id):
    return transition_visit(visit_id, "started", "reached", "reached_location", "reached_at")


@field_visits_bp.post("/<visit_id>/end")
@tenant_module_required("attendance")
def end_visit(visit_id):
    return transition_visit(visit_id, "reached", "completed", "end_location", "ended_at")