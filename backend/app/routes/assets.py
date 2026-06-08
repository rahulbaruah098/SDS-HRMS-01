from datetime import datetime
from bson import ObjectId
from flask import Blueprint, jsonify, request, g

from app.extensions import get_db
from app.utils.auth import current_user_required, audit
from app.utils.serializers import clean_doc


assets_bp = Blueprint("assets", __name__)


HR_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}


ASSET_TYPES = {
    "hardware",
    "software",
}


ASSET_STATUSES = {
    "assigned",
    "available",
    "returned",
    "lost",
    "damaged",
    "expired",
}


ASSET_CONDITIONS = {
    "new",
    "good",
    "fair",
    "poor",
    "damaged",
    "not_applicable",
}


def now_utc():
    return datetime.utcnow()


def normalize_text(value):
    return str(value or "").strip()


def normalize_key(value):
    return normalize_text(value).lower().replace(" ", "_").replace("-", "_")


def safe_object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def current_user():
    return getattr(g, "current_user", {}) or {}


def current_tenant_id():
    user = current_user()
    return getattr(g, "tenant_id", None) or user.get("tenant_id") or "sds"


def current_user_id():
    user = current_user()
    return str(user.get("_id") or user.get("id") or "")


def current_user_name():
    user = current_user()
    return (
        user.get("name")
        or user.get("full_name")
        or user.get("email")
        or "User"
    )


def current_roles():
    user = current_user()
    roles = user.get("roles") or []

    if isinstance(roles, list):
        return {normalize_key(role) for role in roles if normalize_key(role)}

    if isinstance(roles, str):
        return {normalize_key(role) for role in roles.split(",") if normalize_key(role)}

    role = normalize_key(user.get("role"))
    return {role} if role else set()


def is_hr_user():
    roles = current_roles()
    return bool(roles.intersection(HR_ROLES))


def get_current_employee(db):
    user = current_user()
    tenant_id = current_tenant_id()
    user_id = current_user_id()

    if not user_id:
        return None

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee

    email = normalize_text(user.get("email")).lower()

    if email:
        return db.employees.find_one({
            "tenant_id": tenant_id,
            "$or": [
                {"email": email},
                {"official_email": email},
                {"personal_email": email},
            ],
            "is_deleted": {"$ne": True},
        })

    return None


def employee_display_name(employee):
    if not employee:
        return ""

    return (
        employee.get("employee_name")
        or employee.get("name")
        or employee.get("full_name")
        or employee.get("email")
        or ""
    )


def employee_code(employee):
    if not employee:
        return ""

    return (
        employee.get("employee_code")
        or employee.get("emp_code")
        or employee.get("employee_id")
        or ""
    )


def department_name(employee):
    if not employee:
        return ""

    return (
        employee.get("department_name")
        or employee.get("department")
        or ""
    )


def designation_name(employee):
    if not employee:
        return ""

    return (
        employee.get("designation_name")
        or employee.get("designation")
        or ""
    )


def build_employee_snapshot(employee):
    if not employee:
        return {}

    return {
        "assigned_to_employee_id": str(employee.get("_id")),
        "assigned_to_user_id": str(employee.get("user_id") or ""),
        "assigned_to_name": employee_display_name(employee),
        "assigned_to_employee_code": employee_code(employee),
        "assigned_to_department": department_name(employee),
        "assigned_to_designation": designation_name(employee),
        "assigned_to_email": (
            employee.get("official_email")
            or employee.get("email")
            or employee.get("personal_email")
            or ""
        ),
        "assigned_to_phone": (
            employee.get("phone")
            or employee.get("mobile")
            or ""
        ),
    }


def find_employee_by_id(db, employee_id):
    obj_id = safe_object_id(employee_id)

    if not obj_id:
        return None

    return db.employees.find_one({
        "_id": obj_id,
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    })


def get_request_payload():
    data = request.get_json(silent=True) or {}
    return data if isinstance(data, dict) else {}


def clean_asset_payload(data):
    asset_type = normalize_key(data.get("asset_type") or data.get("type"))
    status = normalize_key(data.get("status") or "assigned")
    condition = normalize_key(data.get("condition") or "good")

    payload = {
        "asset_type": asset_type,
        "asset_name": normalize_text(data.get("asset_name") or data.get("name")),
        "category": normalize_text(data.get("category")),
        "brand": normalize_text(data.get("brand")),
        "model": normalize_text(data.get("model")),
        "license_key": normalize_text(data.get("license_key")),
        "license_email": normalize_text(data.get("license_email")),
        "purchase_date": normalize_text(data.get("purchase_date")),
        "warranty_expiry": normalize_text(data.get("warranty_expiry")),
        "license_expiry": normalize_text(data.get("license_expiry")),
        "status": status,
        "condition": condition,
        "remarks": normalize_text(data.get("remarks")),
    }

    return payload


def validate_asset_payload(payload):
    if payload["asset_type"] not in ASSET_TYPES:
        return "Asset type must be either Hardware or Software"

    if not payload["asset_name"]:
        return "Asset name is required"

    if payload["status"] not in ASSET_STATUSES:
        return "Invalid asset status"

    if payload["condition"] not in ASSET_CONDITIONS:
        return "Invalid asset condition"

    if payload["asset_type"] == "software":
        if not payload["license_key"] and not payload["license_email"]:
            return "For software assets, License Key or License Email is required"

    return ""


def asset_scope_query(db):
    query = {
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    }

    if is_hr_user():
        return query

    employee = get_current_employee(db)

    if not employee:
        query["assigned_to_user_id"] = current_user_id()
        return query

    employee_id = str(employee["_id"])

    query["$or"] = [
        {"assigned_to_employee_id": employee_id},
        {"created_by": current_user_id()},
        {"submitted_by_user_id": current_user_id()},
    ]

    return query


def build_asset_stats(items):
    total = len(items)
    hardware = 0
    software = 0
    assigned = 0
    available = 0
    pending = 0
    verified = 0

    for item in items:
        asset_type = normalize_key(item.get("asset_type"))
        status = normalize_key(item.get("status"))
        verification_status = normalize_key(item.get("verification_status"))

        if asset_type == "hardware":
            hardware += 1

        if asset_type == "software":
            software += 1

        if status == "assigned":
            assigned += 1

        if status == "available":
            available += 1

        if verification_status == "pending":
            pending += 1

        if verification_status == "verified":
            verified += 1

    return {
        "total": total,
        "hardware": hardware,
        "software": software,
        "assigned": assigned,
        "available": available,
        "pending": pending,
        "verified": verified,
    }


@assets_bp.get("")
@assets_bp.get("/")
@current_user_required
def list_assets():
    db = get_db()
    query = asset_scope_query(db)

    search = normalize_text(request.args.get("q"))
    asset_type = normalize_key(request.args.get("asset_type"))
    status = normalize_key(request.args.get("status"))
    verification_status = normalize_key(request.args.get("verification_status"))
    employee_id = normalize_text(request.args.get("employee_id"))

    if asset_type:
        query["asset_type"] = asset_type

    if status:
        query["status"] = status

    if verification_status:
        query["verification_status"] = verification_status

    if employee_id and is_hr_user():
        query["assigned_to_employee_id"] = employee_id

    if search:
        regex = {"$regex": search, "$options": "i"}
        query["$and"] = query.get("$and", [])
        query["$and"].append({
            "$or": [
                {"asset_name": regex},
                {"asset_code": regex},
                {"serial_no": regex},
                {"brand": regex},
                {"model": regex},
                {"vendor": regex},
                {"assigned_to_name": regex},
                {"assigned_to_employee_code": regex},
                {"assigned_to_department": regex},
            ]
        })

    try:
        page = int(request.args.get("page", 1))
    except Exception:
        page = 1

    try:
        limit = int(request.args.get("limit", 100))
    except Exception:
        limit = 100

    page = max(page, 1)
    limit = min(max(limit, 1), 300)
    skip = (page - 1) * limit

    total = db.assets.count_documents(query)

    items = list(
        db.assets
        .find(query)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )

    all_for_stats = list(db.assets.find(asset_scope_query(db)))
    stats = build_asset_stats(all_for_stats)

    return jsonify({
        "items": clean_doc(items),
        "total": total,
        "page": page,
        "limit": limit,
        "stats": stats,
        "can_manage": is_hr_user(),
        "can_report": is_hr_user(),
    })


@assets_bp.get("/employee-options")
@current_user_required
def employee_options():
    if not is_hr_user():
        return jsonify({
            "message": "Only HR/Admin can load employee options"
        }), 403

    db = get_db()
    tenant_id = current_tenant_id()

    employees = list(
        db.employees
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "is_alumni": {"$ne": True},
            "status": {"$nin": ["Resigned", "Inactive", "inactive", "resigned"]},
        })
        .sort("name", 1)
    )

    options = []

    for employee in employees:
        options.append({
            "id": str(employee["_id"]),
            "name": employee_display_name(employee),
            "employee_code": employee_code(employee),
            "department": department_name(employee),
            "designation": designation_name(employee),
            "email": (
                employee.get("official_email")
                or employee.get("email")
                or employee.get("personal_email")
                or ""
            ),
        })

    return jsonify({
        "items": options,
    })


@assets_bp.post("")
@assets_bp.post("/")
@current_user_required
def create_asset():
    db = get_db()
    data = get_request_payload()
    payload = clean_asset_payload(data)

    validation_error = validate_asset_payload(payload)

    if validation_error:
        return jsonify({"message": validation_error}), 400

    now = now_utc()
    hr_entry = is_hr_user()

    if hr_entry:
        assigned_employee = find_employee_by_id(
            db,
            data.get("assigned_to_employee_id") or data.get("employee_id")
        )

        if not assigned_employee:
            return jsonify({
                "message": "Please select a valid employee for this asset"
            }), 400

        payload.update(build_employee_snapshot(assigned_employee))
        payload["entry_source"] = "hr"
        payload["verification_status"] = normalize_key(
            data.get("verification_status") or "verified"
        )
        payload["verified_by"] = current_user_id()
        payload["verified_by_name"] = current_user_name()
        payload["verified_at"] = now
    else:
        current_employee = get_current_employee(db)

        if not current_employee:
            return jsonify({
                "message": "Employee profile not found for your login"
            }), 400

        payload.update(build_employee_snapshot(current_employee))
        payload["entry_source"] = "employee"
        payload["verification_status"] = "pending"
        payload["submitted_by_user_id"] = current_user_id()
        payload["submitted_by_name"] = current_user_name()

    payload.update({
        "tenant_id": current_tenant_id(),
        "created_at": now,
        "updated_at": now,
        "created_by": current_user_id(),
        "created_by_name": current_user_name(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
        "is_deleted": False,
    })

    result = db.assets.insert_one(payload)
    payload["_id"] = result.inserted_id

    audit("create", "assets", result.inserted_id, {
        "asset_name": payload.get("asset_name"),
        "asset_type": payload.get("asset_type"),
        "assigned_to_name": payload.get("assigned_to_name"),
        "entry_source": payload.get("entry_source"),
        "verification_status": payload.get("verification_status"),
    })

    return jsonify({
        "message": "Asset saved successfully",
        "item": clean_doc(payload),
    }), 201


@assets_bp.patch("/<asset_id>")
@current_user_required
def update_asset(asset_id):
    if not is_hr_user():
        return jsonify({
            "message": "Only HR/Admin can update asset records"
        }), 403

    asset_obj_id = safe_object_id(asset_id)

    if not asset_obj_id:
        return jsonify({"message": "Invalid asset id"}), 400

    db = get_db()
    existing = db.assets.find_one({
        "_id": asset_obj_id,
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    })

    if not existing:
        return jsonify({"message": "Asset not found"}), 404

    data = get_request_payload()
    payload = clean_asset_payload(data)

    validation_error = validate_asset_payload(payload)

    if validation_error:
        return jsonify({"message": validation_error}), 400

    assigned_employee_id = data.get("assigned_to_employee_id") or data.get("employee_id")

    if assigned_employee_id:
        assigned_employee = find_employee_by_id(db, assigned_employee_id)

        if not assigned_employee:
            return jsonify({
                "message": "Please select a valid employee for this asset"
            }), 400

        payload.update(build_employee_snapshot(assigned_employee))

    verification_status = normalize_key(
        data.get("verification_status") or existing.get("verification_status") or "verified"
    )

    payload["verification_status"] = verification_status

    if verification_status == "verified":
        payload["verified_by"] = current_user_id()
        payload["verified_by_name"] = current_user_name()
        payload["verified_at"] = now_utc()

    if verification_status == "rejected":
        payload["rejected_by"] = current_user_id()
        payload["rejected_by_name"] = current_user_name()
        payload["rejected_at"] = now_utc()
        payload["rejection_reason"] = normalize_text(data.get("rejection_reason"))

    payload.update({
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    })

    db.assets.update_one(
        {"_id": asset_obj_id},
        {"$set": payload},
    )

    updated = db.assets.find_one({"_id": asset_obj_id})

    audit("update", "assets", asset_obj_id, {
        "asset_name": updated.get("asset_name"),
        "asset_type": updated.get("asset_type"),
        "assigned_to_name": updated.get("assigned_to_name"),
        "verification_status": updated.get("verification_status"),
    })

    return jsonify({
        "message": "Asset updated successfully",
        "item": clean_doc(updated),
    })


@assets_bp.delete("/<asset_id>")
@current_user_required
def delete_asset(asset_id):
    if not is_hr_user():
        return jsonify({
            "message": "Only HR/Admin can delete asset records"
        }), 403

    asset_obj_id = safe_object_id(asset_id)

    if not asset_obj_id:
        return jsonify({"message": "Invalid asset id"}), 400

    db = get_db()

    existing = db.assets.find_one({
        "_id": asset_obj_id,
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    })

    if not existing:
        return jsonify({"message": "Asset not found"}), 404

    db.assets.update_one(
        {"_id": asset_obj_id},
        {
            "$set": {
                "is_deleted": True,
                "deleted_at": now_utc(),
                "deleted_by": current_user_id(),
                "deleted_by_name": current_user_name(),
                "updated_at": now_utc(),
                "updated_by": current_user_id(),
                "updated_by_name": current_user_name(),
            }
        },
    )

    audit("delete", "assets", asset_obj_id, {
        "asset_name": existing.get("asset_name"),
        "assigned_to_name": existing.get("assigned_to_name"),
    })

    return jsonify({
        "message": "Asset deleted successfully",
    })


@assets_bp.get("/report")
@current_user_required
def asset_report():
    if not is_hr_user():
        return jsonify({
            "message": "Only HR/Admin can generate asset reports"
        }), 403

    db = get_db()

    query = {
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    }

    asset_type = normalize_key(request.args.get("asset_type"))
    status = normalize_key(request.args.get("status"))
    verification_status = normalize_key(request.args.get("verification_status"))
    employee_id = normalize_text(request.args.get("employee_id"))

    if asset_type:
        query["asset_type"] = asset_type

    if status:
        query["status"] = status

    if verification_status:
        query["verification_status"] = verification_status

    if employee_id:
        query["assigned_to_employee_id"] = employee_id

    assets = list(
        db.assets
        .find(query)
        .sort([
            ("assigned_to_name", 1),
            ("asset_type", 1),
            ("asset_name", 1),
        ])
    )

    employee_map = {}

    for asset in assets:
        employee_key = asset.get("assigned_to_employee_id") or "unassigned"

        if employee_key not in employee_map:
            employee_map[employee_key] = {
                "employee_id": employee_key,
                "employee_name": asset.get("assigned_to_name") or "Unassigned",
                "employee_code": asset.get("assigned_to_employee_code") or "",
                "department": asset.get("assigned_to_department") or "",
                "designation": asset.get("assigned_to_designation") or "",
                "email": asset.get("assigned_to_email") or "",
                "hardware_count": 0,
                "software_count": 0,
                "total_assets": 0,
                "assets": [],
            }

        row = employee_map[employee_key]
        row["total_assets"] += 1

        if normalize_key(asset.get("asset_type")) == "hardware":
            row["hardware_count"] += 1

        if normalize_key(asset.get("asset_type")) == "software":
            row["software_count"] += 1

        row["assets"].append(clean_doc(asset))

    report_rows = sorted(
        employee_map.values(),
        key=lambda item: (
            item.get("employee_name") or "",
            item.get("employee_code") or "",
        ),
    )

    return jsonify({
        "items": clean_doc(report_rows),
        "flat_items": clean_doc(assets),
        "summary": {
            "employee_count": len(report_rows),
            "asset_count": len(assets),
            "hardware_count": sum(row["hardware_count"] for row in report_rows),
            "software_count": sum(row["software_count"] for row in report_rows),
        },
    })