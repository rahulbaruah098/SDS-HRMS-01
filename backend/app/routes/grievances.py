from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime

from app.extensions import get_db
from app.utils.auth import current_user_required, roles_required, audit
from app.utils.serializers import clean_doc


grievances_bp = Blueprint("grievances", __name__)


HR_ADMIN_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}

GRIEVANCE_TYPES = [
    {"value": "workplace_issue", "label": "Workplace Issue"},
    {"value": "salary_payroll", "label": "Salary / Payroll"},
    {"value": "leave_attendance", "label": "Leave / Attendance"},
    {"value": "harassment", "label": "Harassment / Misconduct"},
    {"value": "policy_concern", "label": "Policy Concern"},
    {"value": "manager_team_issue", "label": "Manager / Team Issue"},
    {"value": "facilities", "label": "Facilities / Office Infrastructure"},
    {"value": "other", "label": "Other"},
]

PRIORITIES = [
    {"value": "low", "label": "Low"},
    {"value": "medium", "label": "Medium"},
    {"value": "high", "label": "High"},
    {"value": "critical", "label": "Critical"},
]

STATUSES = [
    {"value": "pending", "label": "Pending"},
    {"value": "under_review", "label": "Under Review"},
    {"value": "resolved", "label": "Resolved"},
    {"value": "rejected", "label": "Rejected"},
]


def now_utc():
    return datetime.utcnow()


def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def normalize_text(value):
    return str(value or "").strip()


def normalize_key(value):
    return (
        normalize_text(value)
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def truthy(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def current_tenant_id():
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id") or "sds"


def current_user_roles():
    roles = g.current_user.get("roles", [])

    if isinstance(roles, list):
        return {normalize_key(role) for role in roles if normalize_key(role)}

    if isinstance(roles, str):
        return {normalize_key(role) for role in roles.split(",") if normalize_key(role)}

    role = normalize_key(g.current_user.get("role"))
    return {role} if role else set()


def has_hr_access():
    return bool(current_user_roles().intersection(HR_ADMIN_ROLES))


def current_employee(db):
    tenant_id = current_tenant_id()
    user_id = str(g.current_user.get("_id"))

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee

    employee_id = normalize_text(
        g.current_user.get("employee_id") or g.current_user.get("employee_ref_id")
    )
    employee_obj_id = safe_object_id(employee_id)

    if employee_obj_id:
        employee = db.employees.find_one({
            "_id": employee_obj_id,
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })

        if employee:
            return employee

    email = normalize_text(g.current_user.get("email")).lower()

    if email:
        return db.employees.find_one({
            "tenant_id": tenant_id,
            "email": {"$regex": f"^{email}$", "$options": "i"},
            "is_deleted": {"$ne": True},
        })

    return None


def employee_display_name(employee=None, user=None):
    employee = employee or {}
    user = user or {}

    return (
        normalize_text(employee.get("employee_name"))
        or normalize_text(employee.get("name"))
        or normalize_text(employee.get("full_name"))
        or normalize_text(user.get("name"))
        or normalize_text(user.get("full_name"))
        or normalize_text(user.get("email"))
        or "Employee"
    )


def employee_code(employee=None, user=None):
    employee = employee or {}
    user = user or {}

    return (
        normalize_text(employee.get("emp_code"))
        or normalize_text(employee.get("employee_code"))
        or normalize_text(employee.get("employee_id"))
        or normalize_text(user.get("emp_code"))
        or ""
    )


def build_employee_snapshot(employee=None, user=None):
    employee = employee or {}
    user = user or {}

    return {
        "employee_id": str(employee.get("_id")) if employee.get("_id") else normalize_text(user.get("employee_id")),
        "user_id": str(user.get("_id")) if user.get("_id") else normalize_text(employee.get("user_id")),
        "name": employee_display_name(employee, user),
        "emp_code": employee_code(employee, user),
        "email": normalize_text(employee.get("email") or user.get("email")),
        "phone": normalize_text(employee.get("phone") or employee.get("mobile") or user.get("phone")),
        "department": normalize_text(employee.get("department") or user.get("department")),
        "department_id": normalize_text(employee.get("department_id") or user.get("department_id")),
        "designation": normalize_text(employee.get("designation") or user.get("designation")),
        "designation_id": normalize_text(employee.get("designation_id") or user.get("designation_id")),
        "team_leader_id": normalize_text(employee.get("team_leader_id")),
        "team_leader_name": normalize_text(employee.get("team_leader_name")),
        "reporting_officer_id": normalize_text(employee.get("reporting_officer_id")),
        "reporting_officer_name": normalize_text(employee.get("reporting_officer_name")),
    }


def label_for(options, value):
    key = normalize_key(value)

    for option in options:
        if option["value"] == key:
            return option["label"]

    return normalize_text(value).replace("_", " ").title()


def users_for_roles(db, role_names, tenant_id=None):
    tenant_id = tenant_id or current_tenant_id()
    normalized_roles = list({normalize_key(role) for role in role_names})

    rows = db.users.find({
        "tenant_id": tenant_id,
        "is_active": True,
        "$or": [
            {"roles": {"$in": normalized_roles}},
            {"role": {"$in": normalized_roles}},
        ],
    })

    return [str(row["_id"]) for row in rows]


def notify_users(db, user_ids, title, body, meta=None, tenant_id=None):
    docs = []
    now = now_utc()

    for user_id in set([str(uid) for uid in user_ids if uid]):
        docs.append({
            "tenant_id": tenant_id or current_tenant_id(),
            "user_id": user_id,
            "title": title,
            "body": body,
            "meta": meta or {},
            "read": False,
            "status": "unread",
            "created_at": now,
            "updated_at": now,
        })

    if docs:
        db.notifications.insert_many(docs)


def public_grievance_doc(doc, reveal_identity=False):
    if not doc:
        return None

    row = clean_doc(doc)

    if row.get("is_anonymous") and not reveal_identity:
        row["employee_snapshot"] = {
            "name": "Anonymous Employee",
            "emp_code": "",
            "email": "",
            "phone": "",
            "department": "Hidden",
            "designation": "Hidden",
            "team_leader_name": "Hidden",
            "reporting_officer_name": "Hidden",
        }
        row["employee_name"] = "Anonymous Employee"
        row["employee_code"] = ""
        row.pop("employee_id", None)
        row.pop("employee_user_id", None)
        row.pop("created_by", None)
        row.pop("created_by_user_id", None)

    return row


@grievances_bp.get("/options")
@current_user_required
def grievance_options():
    return jsonify({
        "types": GRIEVANCE_TYPES,
        "priorities": PRIORITIES,
        "statuses": STATUSES,
    })


@grievances_bp.get("/profile")
@current_user_required
def grievance_profile():
    db = get_db()
    employee = current_employee(db)
    snapshot = build_employee_snapshot(employee, g.current_user)

    return jsonify({
        "profile": snapshot,
        "employee": clean_doc(employee) if employee else None,
    })


@grievances_bp.post("")
@current_user_required
def create_grievance():
    db = get_db()
    data = request.get_json(silent=True) or {}
    tenant_id = current_tenant_id()
    employee = current_employee(db)
    snapshot = build_employee_snapshot(employee, g.current_user)

    grievance_type = normalize_key(data.get("grievance_type") or data.get("type"))
    priority = normalize_key(data.get("priority") or "medium")
    subject = normalize_text(data.get("subject"))
    description = normalize_text(data.get("description"))
    is_anonymous = truthy(data.get("is_anonymous") or data.get("anonymous"))

    allowed_types = {item["value"] for item in GRIEVANCE_TYPES}
    allowed_priorities = {item["value"] for item in PRIORITIES}

    if not grievance_type:
        return jsonify({"message": "Grievance type is required"}), 400

    if grievance_type not in allowed_types:
        return jsonify({"message": "Invalid grievance type"}), 400

    if priority not in allowed_priorities:
        return jsonify({"message": "Invalid priority"}), 400

    if not subject:
        return jsonify({"message": "Subject is required"}), 400

    if not description:
        return jsonify({"message": "Description is required"}), 400

    now = now_utc()
    ticket_no = f"GRV-{now.strftime('%Y%m%d%H%M%S')}"

    doc = {
        "tenant_id": tenant_id,
        "ticket_no": ticket_no,
        "grievance_type": grievance_type,
        "grievance_type_label": label_for(GRIEVANCE_TYPES, grievance_type),
        "priority": priority,
        "priority_label": label_for(PRIORITIES, priority),
        "subject": subject,
        "description": description,
        "is_anonymous": is_anonymous,
        "status": "pending",
        "status_label": "Pending",
        "hr_remarks": "",
        "resolution_note": "",
        "employee_id": snapshot.get("employee_id"),
        "employee_user_id": snapshot.get("user_id"),
        "employee_name": snapshot.get("name"),
        "employee_code": snapshot.get("emp_code"),
        "employee_snapshot": snapshot,
        "created_by": str(g.current_user.get("_id")),
        "created_by_user_id": str(g.current_user.get("_id")),
        "created_by_email": g.current_user.get("email", ""),
        "created_at": now,
        "updated_at": now,
        "history": [
            {
                "action": "created",
                "status": "pending",
                "note": "Grievance submitted anonymously" if is_anonymous else "Grievance submitted",
                "actor_id": str(g.current_user.get("_id")),
                "actor_name": employee_display_name(employee, g.current_user),
                "created_at": now,
            }
        ],
    }

    res = db.grievances.insert_one(doc)

    hr_user_ids = users_for_roles(db, HR_ADMIN_ROLES, tenant_id)
    notify_users(
        db,
        hr_user_ids,
        "New anonymous grievance" if is_anonymous else "New employee grievance",
        f"{ticket_no}: {subject}",
        {
            "module": "grievances",
            "type": "grievance_created",
            "grievance_id": str(res.inserted_id),
            "ticket_no": ticket_no,
            "is_anonymous": is_anonymous,
        },
        tenant_id,
    )

    audit("create", "grievances", res.inserted_id, {
        "ticket_no": ticket_no,
        "is_anonymous": is_anonymous,
        "grievance_type": grievance_type,
    })

    created = db.grievances.find_one({"_id": res.inserted_id})

    return jsonify({
        "message": "Grievance submitted successfully",
        "grievance": public_grievance_doc(created, reveal_identity=True),
    }), 201


@grievances_bp.get("/my")
@current_user_required
def my_grievances():
    db = get_db()
    tenant_id = current_tenant_id()
    employee = current_employee(db)
    user_id = str(g.current_user.get("_id"))
    employee_id = str(employee.get("_id")) if employee and employee.get("_id") else ""

    query = {
        "tenant_id": tenant_id,
        "$or": [
            {"created_by_user_id": user_id},
            {"created_by": user_id},
            {"employee_user_id": user_id},
        ],
    }

    if employee_id:
        query["$or"].append({"employee_id": employee_id})

    status = normalize_key(request.args.get("status"))

    if status:
        query["status"] = status

    rows = list(db.grievances.find(query).sort("created_at", -1))

    return jsonify({
        "grievances": [public_grievance_doc(row, reveal_identity=True) for row in rows]
    })


@grievances_bp.get("")
@roles_required("super_admin", "admin", "hr_admin", "hr_manager", "hr")
def list_grievances():
    db = get_db()
    tenant_id = current_tenant_id()

    query = {"tenant_id": tenant_id}

    status = normalize_key(request.args.get("status"))
    priority = normalize_key(request.args.get("priority"))
    grievance_type = normalize_key(request.args.get("grievance_type") or request.args.get("type"))
    search = normalize_text(request.args.get("q") or request.args.get("search"))

    if status:
        query["status"] = status

    if priority:
        query["priority"] = priority

    if grievance_type:
        query["grievance_type"] = grievance_type

    if search:
        query["$or"] = [
            {"ticket_no": {"$regex": search, "$options": "i"}},
            {"subject": {"$regex": search, "$options": "i"}},
            {"description": {"$regex": search, "$options": "i"}},
            {"employee_name": {"$regex": search, "$options": "i"}},
            {"employee_code": {"$regex": search, "$options": "i"}},
        ]

    rows = list(db.grievances.find(query).sort("created_at", -1))

    return jsonify({
        "grievances": [public_grievance_doc(row, reveal_identity=False) for row in rows]
    })


@grievances_bp.get("/<grievance_id>")
@current_user_required
def grievance_detail(grievance_id):
    db = get_db()
    tenant_id = current_tenant_id()
    grievance_obj_id = safe_object_id(grievance_id)

    if not grievance_obj_id:
        return jsonify({"message": "Invalid grievance id"}), 400

    doc = db.grievances.find_one({
        "_id": grievance_obj_id,
        "tenant_id": tenant_id,
    })

    if not doc:
        return jsonify({"message": "Grievance not found"}), 404

    employee = current_employee(db)
    current_emp_id = str(employee.get("_id")) if employee and employee.get("_id") else ""
    current_user_id = str(g.current_user.get("_id"))

    is_owner = current_user_id in {
        normalize_text(doc.get("created_by")),
        normalize_text(doc.get("created_by_user_id")),
        normalize_text(doc.get("employee_user_id")),
    } or (current_emp_id and current_emp_id == normalize_text(doc.get("employee_id")))

    if not is_owner and not has_hr_access():
        return jsonify({"message": "Forbidden"}), 403

    return jsonify({
        "grievance": public_grievance_doc(doc, reveal_identity=is_owner)
    })


@grievances_bp.patch("/<grievance_id>/status")
@roles_required("super_admin", "admin", "hr_admin", "hr_manager", "hr")
def update_grievance_status(grievance_id):
    db = get_db()
    data = request.get_json(silent=True) or {}
    tenant_id = current_tenant_id()
    grievance_obj_id = safe_object_id(grievance_id)

    if not grievance_obj_id:
        return jsonify({"message": "Invalid grievance id"}), 400

    doc = db.grievances.find_one({
        "_id": grievance_obj_id,
        "tenant_id": tenant_id,
    })

    if not doc:
        return jsonify({"message": "Grievance not found"}), 404

    status = normalize_key(data.get("status"))
    allowed_statuses = {item["value"] for item in STATUSES}

    if not status:
        return jsonify({"message": "Status is required"}), 400

    if status not in allowed_statuses:
        return jsonify({"message": "Invalid grievance status"}), 400

    hr_remarks = normalize_text(data.get("hr_remarks") or data.get("remarks"))
    resolution_note = normalize_text(data.get("resolution_note"))
    now = now_utc()

    update_doc = {
        "status": status,
        "status_label": label_for(STATUSES, status),
        "updated_at": now,
        "updated_by": str(g.current_user.get("_id")),
        "updated_by_name": g.current_user.get("name", ""),
    }

    if hr_remarks or "hr_remarks" in data or "remarks" in data:
        update_doc["hr_remarks"] = hr_remarks

    if resolution_note or "resolution_note" in data:
        update_doc["resolution_note"] = resolution_note

    history_item = {
        "action": "status_updated",
        "status": status,
        "status_label": label_for(STATUSES, status),
        "note": hr_remarks or resolution_note,
        "actor_id": str(g.current_user.get("_id")),
        "actor_name": g.current_user.get("name", "HR"),
        "created_at": now,
    }

    db.grievances.update_one(
        {"_id": grievance_obj_id, "tenant_id": tenant_id},
        {
            "$set": update_doc,
            "$push": {"history": history_item},
        },
    )

    employee_user_id = normalize_text(
        doc.get("employee_user_id") or doc.get("created_by_user_id") or doc.get("created_by")
    )

    if employee_user_id:
        notify_users(
            db,
            [employee_user_id],
            "Grievance status updated",
            f"{doc.get('ticket_no', 'Grievance')} is now {label_for(STATUSES, status)}.",
            {
                "module": "grievances",
                "type": "grievance_status_updated",
                "grievance_id": str(doc["_id"]),
                "ticket_no": doc.get("ticket_no"),
                "status": status,
            },
            tenant_id,
        )

    audit("update_status", "grievances", grievance_obj_id, {
        "ticket_no": doc.get("ticket_no"),
        "status": status,
    })

    updated = db.grievances.find_one({"_id": grievance_obj_id})

    return jsonify({
        "message": "Grievance status updated successfully",
        "grievance": public_grievance_doc(updated, reveal_identity=False),
    })