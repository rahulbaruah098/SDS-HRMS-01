from flask import Blueprint, request, jsonify, g
from datetime import datetime
from bson import ObjectId
import re

from app.extensions import get_db
from app.utils.auth import current_user_required, roles_required, audit
from app.utils.serializers import clean_doc

crud_bp = Blueprint("crud", __name__)


ADMIN_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}

PROJECT_MANAGER_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "team_leader",
    "reporting_officer",
}

READ_ALLOWED_COLLECTIONS = {
    "employees",
    "departments",
    "designations",
    "projects",
    "leave_balances",
    "leave_requests",
    "holiday_calendar",
    "attendance_logs",
    "attendance_mode_requests",
    "compoff_credits",
    "companies",
    "users",
    "notifications",
}

WRITE_ALLOWED_COLLECTIONS = {
    "employees",
    "departments",
    "designations",
    "projects",
    "leave_balances",
    "holiday_calendar",
    "notifications",
}

SOFT_DELETE_COLLECTIONS = {
    "employees",
    "departments",
    "designations",
    "projects",
    "leave_balances",
    "holiday_calendar",
    "attendance_logs",
    "attendance_mode_requests",
    "compoff_credits",
    "notifications",
}

SEARCH_FIELDS = {
    "employees": [
        "name",
        "employee_name",
        "email",
        "phone",
        "employee_id",
        "emp_code",
        "department",
        "designation",
    ],
    "departments": [
        "name",
        "department_name",
        "code",
    ],
    "designations": [
        "name",
        "designation_name",
        "department",
    ],
    "projects": [
        "name",
        "project_name",
        "title",
        "description",
        "status",
        "department",
        "assigned_to_name",
        "team_leader_name",
    ],
    "leave_balances": [
        "employee_name",
        "employee_code",
        "department",
    ],
    "leave_requests": [
        "employee_name",
        "employee_code",
        "leave_type",
        "reason",
        "status",
        "approval_stage_label",
        "task_handover_to_name",
        "project_handover_name",
    ],
    "holiday_calendar": [
        "title",
        "state",
        "message",
    ],
    "attendance_logs": [
        "employee_name",
        "employee_code",
        "department",
        "designation",
        "status",
        "mode",
    ],
    "attendance_mode_requests": [
        "employee_name",
        "employee_code",
        "department",
        "mode",
        "status",
        "reason",
    ],
    "compoff_credits": [
        "employee_name",
        "employee_code",
        "department",
        "status",
        "holiday_title",
    ],
    "notifications": [
        "title",
        "body",
        "status",
    ],
}


def safe_object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def normalize_text(value):
    return str(value or "").strip()


def normalize_key(value):
    return normalize_text(value).lower()


def now_utc():
    return datetime.utcnow()


def current_tenant_id():
    if hasattr(g, "tenant_id") and g.tenant_id:
        return g.tenant_id

    current_user = getattr(g, "current_user", {}) or {}

    return current_user.get("tenant_id") or "sds"


def current_user_id():
    current_user = getattr(g, "current_user", {}) or {}
    return str(current_user.get("_id") or current_user.get("id") or "")


def current_user_name():
    current_user = getattr(g, "current_user", {}) or {}
    return (
        current_user.get("name")
        or current_user.get("full_name")
        or current_user.get("email")
        or current_user.get("username")
        or "User"
    )


def current_user_roles():
    current_user = getattr(g, "current_user", {}) or {}
    roles = current_user.get("roles", [])

    if isinstance(roles, list):
        return {
            normalize_text(role)
            for role in roles
            if normalize_text(role)
        }

    if isinstance(roles, str):
        return {
            normalize_text(role)
            for role in roles.split(",")
            if normalize_text(role)
        }

    role = normalize_text(current_user.get("role"))
    return {role} if role else set()


def has_any_role(role_set):
    return bool(current_user_roles().intersection(role_set))


def is_super_admin():
    return "super_admin" in current_user_roles()


def get_current_employee(db):
    user_id = current_user_id()

    if not user_id:
        return None

    employee = db.employees.find_one({
        "tenant_id": current_tenant_id(),
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee

    return db.employees.find_one({
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })


def truthy(value):
    return str(value or "").strip().lower() in {"true", "1", "yes", "on"}


def employee_is_team_leader(employee):
    if not employee:
        return False

    return truthy(employee.get("is_team_leader"))


def employee_is_reporting_officer(employee):
    if not employee:
        return False

    return truthy(employee.get("is_reporting_officer"))


def can_write_collection(collection):
    roles = current_user_roles()

    if collection not in WRITE_ALLOWED_COLLECTIONS:
        return False

    if roles.intersection(ADMIN_ROLES):
        return True

    if collection == "projects":
        db = get_db()
        employee = get_current_employee(db)

        return (
            roles.intersection(PROJECT_MANAGER_ROLES)
            or employee_is_team_leader(employee)
            or employee_is_reporting_officer(employee)
        )

    return False


def collection_exists(collection):
    return collection in READ_ALLOWED_COLLECTIONS


def get_collection(db, collection):
    if not collection_exists(collection):
        return None

    return getattr(db, collection)


def clean_payload(data):
    blocked_keys = {
        "_id",
        "id",
        "created_at",
        "created_by",
        "created_by_name",
        "updated_at",
        "updated_by",
        "updated_by_name",
        "deleted_at",
        "deleted_by",
        "is_deleted",
    }

    payload = {}

    for key, value in (data or {}).items():
        if key in blocked_keys:
            continue

        payload[key] = value

    return payload


def build_search_query(collection, search_text):
    search_text = normalize_text(search_text)

    if not search_text:
        return {}

    fields = SEARCH_FIELDS.get(collection, [])
    regex = re.compile(re.escape(search_text), re.IGNORECASE)

    return {
        "$or": [
            {field: regex}
            for field in fields
        ]
    } if fields else {}


def base_scope_query(collection):
    q = {
        "is_deleted": {"$ne": True},
    }

    tenant_arg = normalize_text(request.args.get("tenant_id"))

    if is_super_admin() and tenant_arg:
        q["tenant_id"] = tenant_arg
    elif collection not in {"companies"}:
        q["tenant_id"] = current_tenant_id()

    return q


def apply_common_filters(collection, q):
    status = normalize_text(request.args.get("status"))
    department = normalize_text(request.args.get("department"))
    employee_id = normalize_text(request.args.get("employee_id"))
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))
    q_text = normalize_text(request.args.get("q") or request.args.get("search"))

    if status:
        q["status"] = status

    if department:
        q["department"] = department

    if employee_id:
        q["employee_id"] = employee_id

    if collection in {"attendance_logs", "holiday_calendar"} and (date_from or date_to):
        q["date"] = {}

        if date_from:
            q["date"]["$gte"] = date_from

        if date_to:
            q["date"]["$lte"] = date_to

    if collection == "leave_requests" and (date_from or date_to):
        q["from_date"] = {}

        if date_from:
            q["from_date"]["$gte"] = date_from

        if date_to:
            q["from_date"]["$lte"] = date_to

    search_query = build_search_query(collection, q_text)

    if search_query:
        if "$or" in q:
            q = {
                "$and": [
                    q,
                    search_query,
                ]
            }
        else:
            q.update(search_query)

    return q


def project_scope_query(db, q):
    roles = current_user_roles()

    if roles.intersection(ADMIN_ROLES):
        return q

    employee = get_current_employee(db)

    if not employee:
        q["_id"] = {"$exists": False}
        return q

    employee_id = str(employee["_id"])

    q["$or"] = [
        {"created_by_employee_id": employee_id},
        {"team_leader_id": employee_id},
        {"assigned_to_id": employee_id},
        {"assigned_employee_ids": employee_id},
        {"collaborator_ids": employee_id},
        {"collaborators.employee_id": employee_id},
    ]

    return q


def scoped_query_for_collection(db, collection):
    q = base_scope_query(collection)
    q = apply_common_filters(collection, q)

    if collection == "projects":
        q = project_scope_query(db, q)

    return q


def normalize_project_status(status):
    value = normalize_key(status)

    if value in {"completed", "complete", "done", "closed", "inactive"}:
        return "completed"

    if value in {"active", "ongoing", "in_progress", "in-progress", "open"}:
        return "active"

    if value in {"on_hold", "on-hold", "hold"}:
        return "on_hold"

    return "active"


def normalize_project_payload(payload, existing=None):
    existing = existing or {}
    employee = get_current_employee(get_db())

    name = (
        payload.get("name")
        or payload.get("project_name")
        or payload.get("title")
        or existing.get("name")
        or existing.get("project_name")
        or ""
    )

    status = normalize_project_status(
        payload.get("status")
        or existing.get("status")
        or "active"
    )

    assigned_employee_ids = payload.get("assigned_employee_ids")
    collaborator_ids = payload.get("collaborator_ids")

    if assigned_employee_ids is None:
        assigned_employee_ids = payload.get("assigned_to_ids")

    if collaborator_ids is None:
        collaborator_ids = payload.get("collaborators_ids")

    if isinstance(assigned_employee_ids, str):
        assigned_employee_ids = [
            item.strip()
            for item in assigned_employee_ids.split(",")
            if item.strip()
        ]

    if isinstance(collaborator_ids, str):
        collaborator_ids = [
            item.strip()
            for item in collaborator_ids.split(",")
            if item.strip()
        ]

    if assigned_employee_ids is None:
        assigned_employee_ids = existing.get("assigned_employee_ids", [])

    if collaborator_ids is None:
        collaborator_ids = existing.get("collaborator_ids", [])

    if not isinstance(assigned_employee_ids, list):
        assigned_employee_ids = []

    if not isinstance(collaborator_ids, list):
        collaborator_ids = []

    payload["name"] = normalize_text(name)
    payload["project_name"] = normalize_text(name)
    payload["title"] = normalize_text(name)
    payload["status"] = status
    payload["assigned_employee_ids"] = [
        str(item)
        for item in assigned_employee_ids
        if normalize_text(item)
    ]
    payload["collaborator_ids"] = [
        str(item)
        for item in collaborator_ids
        if normalize_text(item)
    ]

    if employee:
        payload.setdefault("team_leader_id", str(employee["_id"]))
        payload.setdefault("team_leader_name", employee.get("name") or employee.get("employee_name") or current_user_name())
        payload.setdefault("department", employee.get("department", ""))

    return payload


def validate_required_fields(collection, payload):
    if collection == "projects":
        if not normalize_text(payload.get("name") or payload.get("project_name")):
            return "Project name is required"

    if collection == "employees":
        if not normalize_text(payload.get("name") or payload.get("employee_name")):
            return "Employee name is required"

    if collection in {"departments", "designations"}:
        if not normalize_text(payload.get("name")):
            return "Name is required"

    return ""


def serialize_list(items):
    return clean_doc(items)


def serialize_item(item):
    return clean_doc(item)


@crud_bp.get("/<collection>")
@current_user_required
def list_collection(collection):
    collection = normalize_key(collection)

    if not collection_exists(collection):
        return jsonify({
            "message": f"Collection '{collection}' is not available"
        }), 404

    db = get_db()
    mongo_collection = get_collection(db, collection)

    q = scoped_query_for_collection(db, collection)

    try:
        page = int(request.args.get("page", 1))
    except Exception:
        page = 1

    try:
        limit = int(request.args.get("limit", 200))
    except Exception:
        limit = 200

    page = max(page, 1)
    limit = min(max(limit, 1), 500)
    skip = (page - 1) * limit

    sort_by = normalize_text(request.args.get("sort_by")) or "created_at"
    sort_dir = normalize_text(request.args.get("sort_dir")).lower()
    sort_order = 1 if sort_dir == "asc" else -1

    total = mongo_collection.count_documents(q)

    items = list(
        mongo_collection
        .find(q)
        .sort(sort_by, sort_order)
        .skip(skip)
        .limit(limit)
    )

    return jsonify({
        "items": serialize_list(items),
        "total": total,
        "page": page,
        "limit": limit,
        "collection": collection,
    })


@crud_bp.get("/<collection>/<item_id>")
@current_user_required
def get_collection_item(collection, item_id):
    collection = normalize_key(collection)

    if not collection_exists(collection):
        return jsonify({
            "message": f"Collection '{collection}' is not available"
        }), 404

    item_obj_id = safe_object_id(item_id)

    if not item_obj_id:
        return jsonify({"message": "Invalid item id"}), 400

    db = get_db()
    mongo_collection = get_collection(db, collection)

    q = scoped_query_for_collection(db, collection)
    q["_id"] = item_obj_id

    item = mongo_collection.find_one(q)

    if not item:
        return jsonify({"message": "Record not found"}), 404

    return jsonify({
        "item": serialize_item(item),
    })


@crud_bp.post("/<collection>")
@current_user_required
def create_collection_item(collection):
    collection = normalize_key(collection)

    if not collection_exists(collection):
        return jsonify({
            "message": f"Collection '{collection}' is not available"
        }), 404

    if not can_write_collection(collection):
        return jsonify({
            "message": "You do not have permission to create this record"
        }), 403

    data = request.get_json(silent=True) or {}
    payload = clean_payload(data)

    if collection == "projects":
        payload = normalize_project_payload(payload)

    validation_error = validate_required_fields(collection, payload)

    if validation_error:
        return jsonify({"message": validation_error}), 400

    db = get_db()
    mongo_collection = get_collection(db, collection)
    now = now_utc()

    payload.setdefault("tenant_id", current_tenant_id())

    payload.update({
        "created_at": now,
        "updated_at": now,
        "created_by": current_user_id(),
        "created_by_name": current_user_name(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
        "is_deleted": False,
    })

    if collection == "projects":
        employee = get_current_employee(db)

        if employee:
            payload.setdefault("created_by_employee_id", str(employee["_id"]))
            payload.setdefault("created_by_employee_name", employee.get("name") or employee.get("employee_name") or current_user_name())

    result = mongo_collection.insert_one(payload)
    payload["_id"] = result.inserted_id

    audit("create", collection, result.inserted_id, payload)

    return jsonify({
        "message": "Record created successfully",
        "item": serialize_item(payload),
    }), 201


@crud_bp.patch("/<collection>/<item_id>")
@current_user_required
def update_collection_item(collection, item_id):
    collection = normalize_key(collection)

    if not collection_exists(collection):
        return jsonify({
            "message": f"Collection '{collection}' is not available"
        }), 404

    if not can_write_collection(collection):
        return jsonify({
            "message": "You do not have permission to update this record"
        }), 403

    item_obj_id = safe_object_id(item_id)

    if not item_obj_id:
        return jsonify({"message": "Invalid item id"}), 400

    db = get_db()
    mongo_collection = get_collection(db, collection)

    q = scoped_query_for_collection(db, collection)
    q["_id"] = item_obj_id

    existing = mongo_collection.find_one(q)

    if not existing:
        return jsonify({"message": "Record not found or not in your scope"}), 404

    data = request.get_json(silent=True) or {}
    payload = clean_payload(data)

    if collection == "projects":
        payload = normalize_project_payload(payload, existing)

    validation_error = validate_required_fields(collection, payload)

    if validation_error:
        return jsonify({"message": validation_error}), 400

    payload.update({
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    })

    mongo_collection.update_one(
        {"_id": item_obj_id},
        {"$set": payload},
    )

    updated = mongo_collection.find_one({"_id": item_obj_id})

    audit("update", collection, item_id, payload)

    return jsonify({
        "message": "Record updated successfully",
        "item": serialize_item(updated),
    })


@crud_bp.delete("/<collection>/<item_id>")
@current_user_required
def delete_collection_item(collection, item_id):
    collection = normalize_key(collection)

    if not collection_exists(collection):
        return jsonify({
            "message": f"Collection '{collection}' is not available"
        }), 404

    if not can_write_collection(collection):
        return jsonify({
            "message": "You do not have permission to delete this record"
        }), 403

    item_obj_id = safe_object_id(item_id)

    if not item_obj_id:
        return jsonify({"message": "Invalid item id"}), 400

    db = get_db()
    mongo_collection = get_collection(db, collection)

    q = scoped_query_for_collection(db, collection)
    q["_id"] = item_obj_id

    existing = mongo_collection.find_one(q)

    if not existing:
        return jsonify({"message": "Record not found or not in your scope"}), 404

    if collection in SOFT_DELETE_COLLECTIONS:
        mongo_collection.update_one(
            {"_id": item_obj_id},
            {
                "$set": {
                    "is_deleted": True,
                    "status": "inactive",
                    "deleted_at": now_utc(),
                    "deleted_by": current_user_id(),
                    "deleted_by_name": current_user_name(),
                    "updated_at": now_utc(),
                    "updated_by": current_user_id(),
                    "updated_by_name": current_user_name(),
                }
            },
        )
    else:
        mongo_collection.delete_one({"_id": item_obj_id})

    audit("delete", collection, item_id)

    return jsonify({
        "message": "Record deleted successfully",
    })


@crud_bp.patch("/projects/<project_id>/status")
@current_user_required
def update_project_status(project_id):
    if not can_write_collection("projects"):
        return jsonify({
            "message": "You do not have permission to update project status"
        }), 403

    project_obj_id = safe_object_id(project_id)

    if not project_obj_id:
        return jsonify({"message": "Invalid project id"}), 400

    db = get_db()
    q = scoped_query_for_collection(db, "projects")
    q["_id"] = project_obj_id

    existing = db.projects.find_one(q)

    if not existing:
        return jsonify({"message": "Project not found or not in your scope"}), 404

    data = request.get_json(silent=True) or {}
    status = normalize_project_status(data.get("status"))

    update_data = {
        "status": status,
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    if status == "completed":
        update_data["completed_at"] = now_utc()
        update_data["completed_by"] = current_user_id()
        update_data["completed_by_name"] = current_user_name()

    db.projects.update_one(
        {"_id": project_obj_id},
        {"$set": update_data},
    )

    updated = db.projects.find_one({"_id": project_obj_id})

    audit("update_status", "projects", project_id, update_data)

    return jsonify({
        "message": "Project status updated successfully",
        "item": clean_doc(updated),
    })


@crud_bp.patch("/projects/<project_id>/assign")
@current_user_required
def assign_project(project_id):
    if not can_write_collection("projects"):
        return jsonify({
            "message": "You do not have permission to assign this project"
        }), 403

    project_obj_id = safe_object_id(project_id)

    if not project_obj_id:
        return jsonify({"message": "Invalid project id"}), 400

    db = get_db()
    q = scoped_query_for_collection(db, "projects")
    q["_id"] = project_obj_id

    existing = db.projects.find_one(q)

    if not existing:
        return jsonify({"message": "Project not found or not in your scope"}), 404

    data = request.get_json(silent=True) or {}

    assigned_employee_ids = data.get("assigned_employee_ids") or data.get("assigned_to_ids") or []
    collaborator_ids = data.get("collaborator_ids") or []

    if isinstance(assigned_employee_ids, str):
        assigned_employee_ids = [
            item.strip()
            for item in assigned_employee_ids.split(",")
            if item.strip()
        ]

    if isinstance(collaborator_ids, str):
        collaborator_ids = [
            item.strip()
            for item in collaborator_ids.split(",")
            if item.strip()
        ]

    if not isinstance(assigned_employee_ids, list):
        assigned_employee_ids = []

    if not isinstance(collaborator_ids, list):
        collaborator_ids = []

    employee_ids = list({
        str(item)
        for item in assigned_employee_ids + collaborator_ids
        if normalize_text(item)
    })

    employee_obj_ids = [
        safe_object_id(employee_id)
        for employee_id in employee_ids
        if safe_object_id(employee_id)
    ]

    employees = list(db.employees.find({
        "_id": {"$in": employee_obj_ids},
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    }))

    employee_name_map = {
        str(employee["_id"]): employee.get("name") or employee.get("employee_name") or employee.get("email") or ""
        for employee in employees
    }

    collaborators = [
        {
            "employee_id": employee_id,
            "employee_name": employee_name_map.get(employee_id, ""),
        }
        for employee_id in collaborator_ids
    ]

    assigned_members = [
        {
            "employee_id": employee_id,
            "employee_name": employee_name_map.get(employee_id, ""),
        }
        for employee_id in assigned_employee_ids
    ]

    update_data = {
        "assigned_employee_ids": [
            str(item)
            for item in assigned_employee_ids
            if normalize_text(item)
        ],
        "assigned_members": assigned_members,
        "collaborator_ids": [
            str(item)
            for item in collaborator_ids
            if normalize_text(item)
        ],
        "collaborators": collaborators,
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    db.projects.update_one(
        {"_id": project_obj_id},
        {"$set": update_data},
    )

    updated = db.projects.find_one({"_id": project_obj_id})

    audit("assign", "projects", project_id, update_data)

    return jsonify({
        "message": "Project assignment updated successfully",
        "item": clean_doc(updated),
    })


@crud_bp.patch("/projects/<project_id>/collaborators")
@current_user_required
def update_project_collaborators(project_id):
    if not can_write_collection("projects"):
        return jsonify({
            "message": "You do not have permission to update collaborators"
        }), 403

    project_obj_id = safe_object_id(project_id)

    if not project_obj_id:
        return jsonify({"message": "Invalid project id"}), 400

    db = get_db()
    q = scoped_query_for_collection(db, "projects")
    q["_id"] = project_obj_id

    existing = db.projects.find_one(q)

    if not existing:
        return jsonify({"message": "Project not found or not in your scope"}), 404

    data = request.get_json(silent=True) or {}
    collaborator_ids = data.get("collaborator_ids") or []

    if isinstance(collaborator_ids, str):
        collaborator_ids = [
            item.strip()
            for item in collaborator_ids.split(",")
            if item.strip()
        ]

    if not isinstance(collaborator_ids, list):
        collaborator_ids = []

    employee_obj_ids = [
        safe_object_id(employee_id)
        for employee_id in collaborator_ids
        if safe_object_id(employee_id)
    ]

    employees = list(db.employees.find({
        "_id": {"$in": employee_obj_ids},
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    }))

    employee_name_map = {
        str(employee["_id"]): employee.get("name") or employee.get("employee_name") or employee.get("email") or ""
        for employee in employees
    }

    collaborators = [
        {
            "employee_id": str(employee_id),
            "employee_name": employee_name_map.get(str(employee_id), ""),
        }
        for employee_id in collaborator_ids
        if normalize_text(employee_id)
    ]

    update_data = {
        "collaborator_ids": [
            str(employee_id)
            for employee_id in collaborator_ids
            if normalize_text(employee_id)
        ],
        "collaborators": collaborators,
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    db.projects.update_one(
        {"_id": project_obj_id},
        {"$set": update_data},
    )

    updated = db.projects.find_one({"_id": project_obj_id})

    audit("update_collaborators", "projects", project_id, update_data)

    return jsonify({
        "message": "Project collaborators updated successfully",
        "item": clean_doc(updated),
    })