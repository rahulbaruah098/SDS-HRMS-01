from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime

from app.extensions import get_db
from app.utils.auth import current_user_required, audit
from app.utils.serializers import clean_doc


it_support_bp = Blueprint("it_support", __name__)


SUPER_ADMIN_ROLES = {
    "super_admin",
}

ISSUE_CATEGORIES = [
    {"value": "login_password", "label": "Login / Password Issue"},
    {"value": "internet_network", "label": "Internet / Network Issue"},
    {"value": "laptop_desktop", "label": "Laptop / Desktop Issue"},
    {"value": "printer_scanner", "label": "Printer / Scanner Issue"},
    {"value": "software_application", "label": "Software / Application Issue"},
    {"value": "email_workspace", "label": "Email / Workspace Issue"},
    {"value": "attendance_hrms", "label": "Attendance / HRMS Issue"},
    {"value": "data_access", "label": "Data / Access Permission Issue"},
    {"value": "hardware_request", "label": "Hardware Request"},
    {"value": "server_issue", "label": "Server Issue"},
    {"value": "database_issue", "label": "Database Issue"},
    {"value": "security_issue", "label": "Security Issue"},
    {"value": "other", "label": "Other"},
]

PRIORITIES = [
    {"value": "low", "label": "Low"},
    {"value": "medium", "label": "Medium"},
    {"value": "high", "label": "High"},
    {"value": "critical", "label": "Critical"},
]

TICKET_STATUSES = [
    {"value": "open", "label": "Open"},
    {"value": "assigned", "label": "Assigned"},
    {"value": "in_progress", "label": "In Progress"},
    {"value": "waiting_for_user", "label": "Waiting for User"},
    {"value": "resolved", "label": "Resolved"},
    {"value": "closed", "label": "Closed"},
    {"value": "reopened", "label": "Reopened"},
]

ESCALATION_TYPES = [
    {"value": "software_application", "label": "Software / Application Problem"},
    {"value": "server_issue", "label": "Server Issue"},
    {"value": "database_issue", "label": "Database Issue"},
    {"value": "network_infrastructure", "label": "Network / Infrastructure Major Issue"},
    {"value": "security_issue", "label": "Security Issue"},
    {"value": "major_problem", "label": "Other Major Problem"},
]

ASSIGNABLE_STATUSES = {
    "open",
    "assigned",
    "in_progress",
    "waiting_for_user",
    "reopened",
}

MEMBER_UPDATE_STATUSES = {
    "in_progress",
    "waiting_for_user",
    "resolved",
}

EMPLOYEE_REVIEW_STATUSES = {
    "resolved",
    "closed",
}


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
    return str(value or "").strip().lower() in {"1", "true", "yes", "on", "1.0"}


def current_tenant_id():
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id") or "sds"


def current_user_id():
    return str(g.current_user.get("_id") or g.current_user.get("id") or "")


def current_user_roles():
    roles = g.current_user.get("roles", [])

    if isinstance(roles, list):
        normalized = {normalize_key(role) for role in roles if normalize_key(role)}
    elif isinstance(roles, str):
        normalized = {normalize_key(role) for role in roles.split(",") if normalize_key(role)}
    else:
        normalized = set()

    role = normalize_key(g.current_user.get("role"))

    if role:
        normalized.add(role)

    return normalized


def is_super_admin_user():
    return bool(current_user_roles().intersection(SUPER_ADMIN_ROLES))


def label_for(options, value):
    key = normalize_key(value)

    for option in options:
        if option["value"] == key:
            return option["label"]

    return normalize_text(value).replace("_", " ").title()


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


def current_employee(db):
    tenant_id = current_tenant_id()
    user_id = current_user_id()

    if user_id:
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


def build_employee_snapshot(employee=None, user=None):
    employee = employee or {}
    user = user or {}

    return {
        "employee_id": str(employee.get("_id")) if employee.get("_id") else normalize_text(user.get("employee_id")),
        "user_id": normalize_text(employee.get("user_id") or user.get("_id") or user.get("id")),
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
        "is_team_leader": truthy(employee.get("is_team_leader")),
        "is_reporting_officer": truthy(employee.get("is_reporting_officer")),
        "is_it_support_head": is_it_head(employee),
        "is_it_support_member": is_it_member(employee),
    }


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


def employee_user_id(employee):
    if not employee:
        return ""

    return normalize_text(employee.get("user_id"))


def department_is_it(employee=None):
    employee = employee or {}
    department = normalize_text(employee.get("department")).lower()
    department_id = normalize_text(employee.get("department_id")).lower()

    department_text = f"{department} {department_id}"

    return any(
        keyword in department_text
        for keyword in [
            "it",
            "information technology",
            "technology",
            "tech",
            "software",
            "mis",
        ]
    )


def is_it_head(employee=None):
    employee = employee or {}

    return truthy(employee.get("is_it_support_head"))


def is_it_member(employee=None):
    employee = employee or {}

    return (
        is_it_head(employee)
        or truthy(employee.get("is_it_support_member"))
    )


def can_manage_normal_it_support(employee=None):
    return is_it_head(employee)


def can_view_superadmin_escalation(ticket=None):
    ticket = ticket or {}
    return is_super_admin_user() and truthy(ticket.get("is_escalated"))


def can_work_on_ticket(ticket, employee=None):
    employee = employee or {}
    user_id = current_user_id()
    emp_id = str(employee.get("_id")) if employee and employee.get("_id") else ""

    return (
        can_manage_normal_it_support(employee)
        or can_view_superadmin_escalation(ticket)
        or normalize_text(ticket.get("assigned_to_user_id")) == user_id
        or (emp_id and normalize_text(ticket.get("assigned_to_employee_id")) == emp_id)
    )


def it_department_query(tenant_id, include_heads=True):
    active_filter = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "is_active": {"$ne": False},
    }

    support_conditions = [
        {"is_it_support_member": {"$in": [True, "true", "True", "1", 1]}},
    ]

    if include_heads:
        support_conditions.append({
            "is_it_support_head": {"$in": [True, "true", "True", "1", 1]}
        })

    return {
        **active_filter,
        "$or": support_conditions,
    }


def get_it_heads(db, tenant_id):
    return list(db.employees.find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "is_active": {"$ne": False},
        "is_it_support_head": {"$in": [True, "true", "True", "1", 1]},
    }).sort("employee_name", 1))


def get_it_members(db, tenant_id, include_heads=True):
    return list(db.employees.find(
        it_department_query(tenant_id, include_heads=include_heads)
    ).sort("employee_name", 1))


def get_super_admin_users(db):
    return list(db.users.find({
        "is_deleted": {"$ne": True},
        "is_active": {"$ne": False},
        "$or": [
            {"role": "super_admin"},
            {"roles": "super_admin"},
            {"roles": {"$in": ["super_admin"]}},
        ],
    }))


def get_employee_by_id(db, employee_id, tenant_id=None):
    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return None

    return db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": tenant_id or current_tenant_id(),
        "is_deleted": {"$ne": True},
    })


def serialize_it_member(employee):
    if not employee:
        return None

    snapshot = build_employee_snapshot(employee, {})
    snapshot["id"] = str(employee["_id"])
    snapshot["_id"] = str(employee["_id"])
    snapshot["label"] = f"{snapshot.get('name', 'IT Member')} ({snapshot.get('designation') or snapshot.get('department') or 'IT Department'})"
    snapshot["is_it_department"] = department_is_it(employee)
    return snapshot


def public_ticket_doc(ticket):
    if not ticket:
        return None

    row = clean_doc(ticket)

    if not row.get("assigned_to_employee_id"):
        row["assigned_to_name"] = ""
        row["assignment_label"] = "Not assigned yet"
        row["assignment_status"] = "empty_slot"
    else:
        row["assignment_label"] = row.get("assigned_to_name") or "Assigned IT Member"
        row["assignment_status"] = "assigned"

    row["is_escalated"] = truthy(row.get("is_escalated"))
    row["escalation_label"] = (
        "Escalated to Super Admin"
        if row["is_escalated"]
        else ""
    )

    return row


def build_ticket_query_for_current_user(db, include_all_for_it=False):
    tenant_id = current_tenant_id()
    user_id = current_user_id()
    employee = current_employee(db)
    emp_id = str(employee.get("_id")) if employee and employee.get("_id") else ""

    if is_super_admin_user():
        query = {"is_escalated": True}
        requested_tenant = normalize_text(request.args.get("tenant_id"))

        if requested_tenant:
            query["tenant_id"] = requested_tenant

        return query

    query = {"tenant_id": tenant_id}

    # Used only when a backend route intentionally wants all tenant tickets for IT Head.
    if include_all_for_it and can_manage_normal_it_support(employee):
        return query

    # My Tickets must show only tickets raised/created by the current user.
    # It must NOT include assigned tickets or all tenant tickets.
    clauses = []

    if user_id:
        clauses.extend([
            {"created_by_user_id": user_id},
            {"raised_by_user_id": user_id},
        ])

    if emp_id:
        clauses.extend([
            {"created_by_employee_id": emp_id},
            {"raised_by_employee_id": emp_id},
        ])

    if not clauses:
        clauses = [{"created_by_user_id": "__none__"}]

    query["$or"] = clauses

    return query


@it_support_bp.get("/options")
@current_user_required
def it_support_options():
    db = get_db()
    tenant_id = current_tenant_id()
    employee = current_employee(db)
    members = get_it_members(db, tenant_id, include_heads=True)
    heads = get_it_heads(db, tenant_id)

    return jsonify({
        "categories": ISSUE_CATEGORIES,
        "priorities": PRIORITIES,
        "statuses": TICKET_STATUSES,
        "escalation_types": ESCALATION_TYPES,
        "can_manage": can_manage_normal_it_support(employee),
        "can_manage_normal": can_manage_normal_it_support(employee),
        "can_view_escalated": is_super_admin_user(),
        "can_escalate": can_manage_normal_it_support(employee),
        "is_super_admin": is_super_admin_user(),
        "is_it_head": is_it_head(employee),
        "is_it_member": is_it_member(employee),
        "it_team": [serialize_it_member(member) for member in members],
        "it_heads": [serialize_it_member(head) for head in heads],
        "team_slots": {
            "expected_total": 4,
            "current_total": len(members),
            "heads": len(heads),
            "members": len([member for member in members if is_it_member(member)]),
            "empty_slots": max(0, 4 - len(members)),
        },
    })


@it_support_bp.get("/profile")
@current_user_required
def it_support_profile():
    db = get_db()
    employee = current_employee(db)
    snapshot = build_employee_snapshot(employee, g.current_user)

    return jsonify({
        "profile": snapshot,
        "employee": clean_doc(employee) if employee else None,
        "can_manage": can_manage_normal_it_support(employee),
        "can_manage_normal": can_manage_normal_it_support(employee),
        "can_view_escalated": is_super_admin_user(),
        "can_escalate": can_manage_normal_it_support(employee),
        "is_super_admin": is_super_admin_user(),
        "is_it_head": is_it_head(employee),
        "is_it_member": is_it_member(employee),
    })


@it_support_bp.post("")
@current_user_required
def create_it_support_ticket():
    db = get_db()
    data = request.get_json(silent=True) or {}
    tenant_id = current_tenant_id()
    employee = current_employee(db)
    snapshot = build_employee_snapshot(employee, g.current_user)

    issue_category = normalize_key(data.get("issue_category") or data.get("category"))
    priority = normalize_key(data.get("priority") or "medium")
    subject = normalize_text(data.get("subject"))
    description = normalize_text(data.get("description"))

    allowed_categories = {item["value"] for item in ISSUE_CATEGORIES}
    allowed_priorities = {item["value"] for item in PRIORITIES}

    if not issue_category:
        return jsonify({"message": "Issue category is required"}), 400

    if issue_category not in allowed_categories:
        return jsonify({"message": "Invalid issue category"}), 400

    if priority not in allowed_priorities:
        return jsonify({"message": "Invalid priority"}), 400

    if not subject:
        return jsonify({"message": "Subject is required"}), 400

    if not description:
        return jsonify({"message": "Description is required"}), 400

    now = now_utc()
    ticket_no = f"ITS-{now.strftime('%Y%m%d%H%M%S')}"

    doc = {
        "tenant_id": tenant_id,
        "ticket_no": ticket_no,
        "issue_category": issue_category,
        "issue_category_label": label_for(ISSUE_CATEGORIES, issue_category),
        "priority": priority,
        "priority_label": label_for(PRIORITIES, priority),
        "subject": subject,
        "description": description,
        "status": "open",
        "status_label": "Open",
        "created_by_employee_id": snapshot.get("employee_id"),
        "created_by_user_id": snapshot.get("user_id") or current_user_id(),
        "raised_by_employee_id": snapshot.get("employee_id"),
        "raised_by_user_id": snapshot.get("user_id") or current_user_id(),
        "raised_by_name": snapshot.get("name"),
        "raised_by_code": snapshot.get("emp_code"),
        "employee_snapshot": snapshot,
        "assigned_to_employee_id": "",
        "assigned_to_user_id": "",
        "assigned_to_name": "",
        "assigned_to_code": "",
        "assigned_to_designation": "",
        "assigned_by_employee_id": "",
        "assigned_by_user_id": "",
        "assigned_by_name": "",
        "assigned_at": None,
        "last_status_note": "",
        "resolution_note": "",
        "resolved_at": None,
        "closed_at": None,
        "review": None,
        "review_rating": None,
        "review_comment": "",
        "reviewed_at": None,
        "is_escalated": False,
        "escalated_to": "",
        "escalated_by_employee_id": "",
        "escalated_by_user_id": "",
        "escalated_by_name": "",
        "escalated_at": None,
        "escalation_type": "",
        "escalation_type_label": "",
        "escalation_reason": "",
        "superadmin_status_note": "",
        "created_at": now,
        "updated_at": now,
        "history": [
            {
                "action": "created",
                "status": "open",
                "status_label": "Open",
                "note": "IT support ticket submitted to tenant IT Department",
                "actor_id": current_user_id(),
                "actor_employee_id": snapshot.get("employee_id"),
                "actor_name": snapshot.get("name"),
                "created_at": now,
            }
        ],
    }

    res = db.it_support_tickets.insert_one(doc)

    # Notify tenant IT Department only.
    # Admin/HR are not notified.
    it_heads = get_it_heads(db, tenant_id)
    it_members = get_it_members(db, tenant_id, include_heads=True)

    notify_user_ids = []
    notify_user_ids.extend([employee_user_id(head) for head in it_heads if employee_user_id(head)])
    notify_user_ids.extend([employee_user_id(member) for member in it_members if employee_user_id(member)])

    notify_users(
        db,
        notify_user_ids,
        "New IT support ticket",
        f"{ticket_no}: {subject}",
        {
            "module": "it_support",
            "type": "it_ticket_created",
            "ticket_id": str(res.inserted_id),
            "ticket_no": ticket_no,
            "priority": priority,
            "tenant_id": tenant_id,
            "target": "tenant_it_department",
        },
        tenant_id,
    )

    audit("create", "it_support_tickets", res.inserted_id, {
        "ticket_no": ticket_no,
        "issue_category": issue_category,
        "priority": priority,
        "target": "tenant_it_department",
    })

    created = db.it_support_tickets.find_one({"_id": res.inserted_id})

    return jsonify({
        "message": "IT support ticket submitted successfully",
        "ticket": public_ticket_doc(created),
    }), 201


@it_support_bp.get("/my")
@current_user_required
def my_it_support_tickets():
    db = get_db()
    query = build_ticket_query_for_current_user(db, include_all_for_it=False)

    status = normalize_key(request.args.get("status"))
    priority = normalize_key(request.args.get("priority"))
    issue_category = normalize_key(request.args.get("issue_category") or request.args.get("category"))

    if status:
        query["status"] = status

    if priority:
        query["priority"] = priority

    if issue_category:
        query["issue_category"] = issue_category

    rows = list(db.it_support_tickets.find(query).sort("created_at", -1))

    return jsonify({
        "tickets": [public_ticket_doc(row) for row in rows]
    })


@it_support_bp.get("")
@current_user_required
def list_it_support_tickets():
    db = get_db()
    employee = current_employee(db)

    if is_super_admin_user():
        query = {"is_escalated": True}
        requested_tenant = normalize_text(request.args.get("tenant_id"))

        if requested_tenant:
            query["tenant_id"] = requested_tenant

        rows = list(db.it_support_tickets.find(query).sort("escalated_at", -1))

        return jsonify({
            "tickets": [public_ticket_doc(row) for row in rows],
            "it_team": [],
            "can_manage": False,
            "can_manage_normal": False,
            "can_view_escalated": True,
            "can_escalate": False,
            "is_super_admin": True,
            "is_it_head": False,
            "is_it_member": False,
            "team_slots": {
                "expected_total": 4,
                "current_total": 0,
                "empty_slots": 0,
            },
        })

    if not is_it_member(employee):
        return my_it_support_tickets()

    tenant_id = current_tenant_id()
    query = {"tenant_id": tenant_id}

    # IT Head sees all tenant IT support tickets.
    # IT Department members can see tenant IT tickets, but only update tickets assigned to them.
    if not can_manage_normal_it_support(employee):
        query["tenant_id"] = tenant_id

    status = normalize_key(request.args.get("status"))
    priority = normalize_key(request.args.get("priority"))
    issue_category = normalize_key(request.args.get("issue_category") or request.args.get("category"))
    assigned_to = normalize_text(request.args.get("assigned_to_employee_id") or request.args.get("assigned_to"))
    search = normalize_text(request.args.get("q") or request.args.get("search"))

    if status:
        query["status"] = status

    if priority:
        query["priority"] = priority

    if issue_category:
        query["issue_category"] = issue_category

    if assigned_to == "unassigned":
        query["assigned_to_employee_id"] = {"$in": ["", None]}
    elif assigned_to:
        query["assigned_to_employee_id"] = assigned_to

    if search:
        search_query = {
            "$or": [
                {"ticket_no": {"$regex": search, "$options": "i"}},
                {"subject": {"$regex": search, "$options": "i"}},
                {"description": {"$regex": search, "$options": "i"}},
                {"raised_by_name": {"$regex": search, "$options": "i"}},
                {"raised_by_code": {"$regex": search, "$options": "i"}},
                {"assigned_to_name": {"$regex": search, "$options": "i"}},
                {"escalation_reason": {"$regex": search, "$options": "i"}},
            ]
        }

        query.update(search_query)

    rows = list(db.it_support_tickets.find(query).sort("created_at", -1))
    members = get_it_members(db, tenant_id, include_heads=True)
    heads = get_it_heads(db, tenant_id)

    return jsonify({
        "tickets": [public_ticket_doc(row) for row in rows],
        "it_team": [serialize_it_member(member) for member in members],
        "it_heads": [serialize_it_member(head) for head in heads],
        "can_manage": can_manage_normal_it_support(employee),
        "can_manage_normal": can_manage_normal_it_support(employee),
        "can_view_escalated": False,
        "can_escalate": can_manage_normal_it_support(employee),
        "is_super_admin": False,
        "is_it_head": is_it_head(employee),
        "is_it_member": is_it_member(employee),
        "team_slots": {
            "expected_total": 4,
            "current_total": len(members),
            "heads": len(heads),
            "empty_slots": max(0, 4 - len(members)),
        },
    })


@it_support_bp.get("/<ticket_id>")
@current_user_required
def it_support_ticket_detail(ticket_id):
    db = get_db()
    ticket_obj_id = safe_object_id(ticket_id)

    if not ticket_obj_id:
        return jsonify({"message": "Invalid ticket id"}), 400

    if is_super_admin_user():
        ticket = db.it_support_tickets.find_one({
            "_id": ticket_obj_id,
            "is_escalated": True,
        })
    else:
        ticket = db.it_support_tickets.find_one({
            "_id": ticket_obj_id,
            "tenant_id": current_tenant_id(),
        })

    if not ticket:
        return jsonify({"message": "IT support ticket not found"}), 404

    employee = current_employee(db)
    user_id = current_user_id()
    emp_id = str(employee.get("_id")) if employee and employee.get("_id") else ""

    is_owner = user_id in {
        normalize_text(ticket.get("created_by_user_id")),
        normalize_text(ticket.get("raised_by_user_id")),
    } or (
        emp_id
        and emp_id in {
            normalize_text(ticket.get("created_by_employee_id")),
            normalize_text(ticket.get("raised_by_employee_id")),
        }
    )

    is_it_dept_viewer = (
        ticket.get("tenant_id") == current_tenant_id()
        and is_it_member(employee)
    )

    if not is_owner and not is_it_dept_viewer and not can_work_on_ticket(ticket, employee):
        return jsonify({"message": "Forbidden"}), 403

    return jsonify({
        "ticket": public_ticket_doc(ticket),
    })


@it_support_bp.patch("/<ticket_id>/assign")
@current_user_required
def assign_it_support_ticket(ticket_id):
    db = get_db()
    data = request.get_json(silent=True) or {}
    tenant_id = current_tenant_id()
    employee = current_employee(db)

    if not can_manage_normal_it_support(employee):
        return jsonify({"message": "Only IT Department Team Leader / IT Support Head can assign IT support tickets"}), 403

    ticket_obj_id = safe_object_id(ticket_id)

    if not ticket_obj_id:
        return jsonify({"message": "Invalid ticket id"}), 400

    ticket = db.it_support_tickets.find_one({
        "_id": ticket_obj_id,
        "tenant_id": tenant_id,
    })

    if not ticket:
        return jsonify({"message": "IT support ticket not found"}), 404

    if normalize_key(ticket.get("status")) not in ASSIGNABLE_STATUSES:
        return jsonify({"message": "This ticket cannot be reassigned in its current status"}), 400

    assigned_to_employee_id = normalize_text(
        data.get("assigned_to_employee_id") or data.get("employee_id")
    )

    if assigned_to_employee_id == "self":
        assigned_employee = employee
    else:
        assigned_employee = get_employee_by_id(db, assigned_to_employee_id, tenant_id)

    if not assigned_employee:
        return jsonify({"message": "Assigned IT member not found"}), 404

    if not is_it_member(assigned_employee):
        return jsonify({"message": "Selected employee is not part of the IT Department / IT Support Team"}), 400

    assigned_snapshot = build_employee_snapshot(assigned_employee, {})
    assigner_snapshot = build_employee_snapshot(employee, g.current_user)
    previous_assigned_to = normalize_text(ticket.get("assigned_to_employee_id"))
    now = now_utc()

    update_doc = {
        "assigned_to_employee_id": str(assigned_employee["_id"]),
        "assigned_to_user_id": assigned_snapshot.get("user_id"),
        "assigned_to_name": assigned_snapshot.get("name"),
        "assigned_to_code": assigned_snapshot.get("emp_code"),
        "assigned_to_designation": assigned_snapshot.get("designation"),
        "assigned_by_employee_id": assigner_snapshot.get("employee_id"),
        "assigned_by_user_id": assigner_snapshot.get("user_id") or current_user_id(),
        "assigned_by_name": assigner_snapshot.get("name"),
        "assigned_at": now,
        "status": "assigned",
        "status_label": "Assigned",
        "updated_at": now,
    }

    history_action = "reassigned" if previous_assigned_to else "assigned"

    history_item = {
        "action": history_action,
        "status": "assigned",
        "status_label": "Assigned",
        "note": normalize_text(data.get("note")) or f"Assigned to {assigned_snapshot.get('name')}",
        "actor_id": current_user_id(),
        "actor_employee_id": assigner_snapshot.get("employee_id"),
        "actor_name": assigner_snapshot.get("name"),
        "assigned_to_employee_id": str(assigned_employee["_id"]),
        "assigned_to_name": assigned_snapshot.get("name"),
        "created_at": now,
    }

    db.it_support_tickets.update_one(
        {"_id": ticket_obj_id, "tenant_id": tenant_id},
        {
            "$set": update_doc,
            "$push": {"history": history_item},
        },
    )

    notify_targets = []

    if assigned_snapshot.get("user_id"):
        notify_targets.append(assigned_snapshot.get("user_id"))

    raised_by_user_id = normalize_text(ticket.get("raised_by_user_id") or ticket.get("created_by_user_id"))

    if raised_by_user_id:
        notify_targets.append(raised_by_user_id)

    notify_users(
        db,
        notify_targets,
        "IT support ticket assigned",
        f"{ticket.get('ticket_no', 'Ticket')} assigned to {assigned_snapshot.get('name')}.",
        {
            "module": "it_support",
            "type": "it_ticket_assigned",
            "ticket_id": str(ticket["_id"]),
            "ticket_no": ticket.get("ticket_no"),
            "assigned_to_employee_id": str(assigned_employee["_id"]),
        },
        tenant_id,
    )

    audit("assign", "it_support_tickets", ticket_obj_id, {
        "ticket_no": ticket.get("ticket_no"),
        "assigned_to_employee_id": str(assigned_employee["_id"]),
        "assigned_to_name": assigned_snapshot.get("name"),
    })

    updated = db.it_support_tickets.find_one({"_id": ticket_obj_id})

    return jsonify({
        "message": "IT support ticket assigned successfully",
        "ticket": public_ticket_doc(updated),
    })


@it_support_bp.patch("/<ticket_id>/status")
@current_user_required
def update_it_support_status(ticket_id):
    db = get_db()
    data = request.get_json(silent=True) or {}
    ticket_obj_id = safe_object_id(ticket_id)

    if not ticket_obj_id:
        return jsonify({"message": "Invalid ticket id"}), 400

    if is_super_admin_user():
        ticket = db.it_support_tickets.find_one({
            "_id": ticket_obj_id,
            "is_escalated": True,
        })
    else:
        ticket = db.it_support_tickets.find_one({
            "_id": ticket_obj_id,
            "tenant_id": current_tenant_id(),
        })

    if not ticket:
        return jsonify({"message": "IT support ticket not found"}), 404

    employee = current_employee(db)

    if not can_work_on_ticket(ticket, employee):
        return jsonify({"message": "Only assigned IT member, IT Department Head, or Super Admin for escalated tickets can update this ticket"}), 403

    status = normalize_key(data.get("status"))
    allowed_statuses = {item["value"] for item in TICKET_STATUSES}

    if not status:
        return jsonify({"message": "Status is required"}), 400

    if status not in allowed_statuses:
        return jsonify({"message": "Invalid ticket status"}), 400

    if (
        not can_manage_normal_it_support(employee)
        and not can_view_superadmin_escalation(ticket)
        and status not in MEMBER_UPDATE_STATUSES
    ):
        return jsonify({"message": "Assigned IT member can only update work progress or resolve the ticket"}), 403

    status_note = normalize_text(data.get("status_note") or data.get("note") or data.get("remarks"))
    resolution_note = normalize_text(data.get("resolution_note"))

    if status == "resolved" and not resolution_note and not status_note:
        return jsonify({"message": "Resolution note is required before marking ticket as resolved"}), 400

    actor_snapshot = build_employee_snapshot(employee, g.current_user)
    now = now_utc()

    update_doc = {
        "status": status,
        "status_label": label_for(TICKET_STATUSES, status),
        "last_status_note": status_note,
        "updated_at": now,
        "updated_by_employee_id": actor_snapshot.get("employee_id"),
        "updated_by_user_id": actor_snapshot.get("user_id") or current_user_id(),
        "updated_by_name": actor_snapshot.get("name"),
    }

    if is_super_admin_user():
        update_doc["superadmin_status_note"] = status_note or resolution_note

    if resolution_note or status == "resolved":
        update_doc["resolution_note"] = resolution_note or status_note

    if status == "resolved":
        update_doc["resolved_at"] = now

    if status == "closed":
        update_doc["closed_at"] = now

    history_item = {
        "action": "status_updated",
        "status": status,
        "status_label": label_for(TICKET_STATUSES, status),
        "note": status_note or resolution_note,
        "resolution_note": resolution_note,
        "actor_id": current_user_id(),
        "actor_employee_id": actor_snapshot.get("employee_id"),
        "actor_name": actor_snapshot.get("name") or g.current_user.get("name") or "Super Admin",
        "created_at": now,
    }

    db.it_support_tickets.update_one(
        {"_id": ticket_obj_id},
        {
            "$set": update_doc,
            "$push": {"history": history_item},
        },
    )

    notify_targets = []

    raised_by_user_id = normalize_text(ticket.get("raised_by_user_id") or ticket.get("created_by_user_id"))

    if raised_by_user_id:
        notify_targets.append(raised_by_user_id)

    assigned_user_id = normalize_text(ticket.get("assigned_to_user_id"))
    if assigned_user_id:
        notify_targets.append(assigned_user_id)

    heads = get_it_heads(db, ticket.get("tenant_id"))
    for head in heads:
        head_user_id = employee_user_id(head)
        if head_user_id:
            notify_targets.append(head_user_id)

    notify_users(
        db,
        notify_targets,
        "IT support ticket status updated",
        f"{ticket.get('ticket_no', 'Ticket')} is now {label_for(TICKET_STATUSES, status)}.",
        {
            "module": "it_support",
            "type": "it_ticket_status_updated",
            "ticket_id": str(ticket["_id"]),
            "ticket_no": ticket.get("ticket_no"),
            "status": status,
        },
        ticket.get("tenant_id") or current_tenant_id(),
    )

    audit("update_status", "it_support_tickets", ticket_obj_id, {
        "ticket_no": ticket.get("ticket_no"),
        "status": status,
        "updated_by_superadmin": is_super_admin_user(),
    })

    updated = db.it_support_tickets.find_one({"_id": ticket_obj_id})

    return jsonify({
        "message": "IT support ticket status updated successfully",
        "ticket": public_ticket_doc(updated),
    })


@it_support_bp.patch("/<ticket_id>/escalate")
@current_user_required
def escalate_it_support_ticket(ticket_id):
    db = get_db()
    data = request.get_json(silent=True) or {}
    tenant_id = current_tenant_id()
    employee = current_employee(db)

    if not can_manage_normal_it_support(employee):
        return jsonify({"message": "Only IT Department Team Leader / IT Support Head can escalate IT support tickets to Super Admin"}), 403

    ticket_obj_id = safe_object_id(ticket_id)

    if not ticket_obj_id:
        return jsonify({"message": "Invalid ticket id"}), 400

    ticket = db.it_support_tickets.find_one({
        "_id": ticket_obj_id,
        "tenant_id": tenant_id,
    })

    if not ticket:
        return jsonify({"message": "IT support ticket not found"}), 404

    escalation_type = normalize_key(data.get("escalation_type") or "major_problem")
    escalation_reason = normalize_text(data.get("escalation_reason") or data.get("reason") or data.get("note"))

    allowed_types = {item["value"] for item in ESCALATION_TYPES}

    if escalation_type not in allowed_types:
        return jsonify({"message": "Invalid escalation type"}), 400

    if not escalation_reason:
        return jsonify({"message": "Escalation reason is required"}), 400

    now = now_utc()
    actor_snapshot = build_employee_snapshot(employee, g.current_user)

    update_doc = {
        "is_escalated": True,
        "escalated_to": "super_admin",
        "escalated_by_employee_id": actor_snapshot.get("employee_id"),
        "escalated_by_user_id": actor_snapshot.get("user_id") or current_user_id(),
        "escalated_by_name": actor_snapshot.get("name"),
        "escalated_at": now,
        "escalation_type": escalation_type,
        "escalation_type_label": label_for(ESCALATION_TYPES, escalation_type),
        "escalation_reason": escalation_reason,
        "updated_at": now,
    }

    history_item = {
        "action": "escalated_to_superadmin",
        "status": ticket.get("status"),
        "status_label": ticket.get("status_label"),
        "note": escalation_reason,
        "escalation_type": escalation_type,
        "escalation_type_label": label_for(ESCALATION_TYPES, escalation_type),
        "actor_id": current_user_id(),
        "actor_employee_id": actor_snapshot.get("employee_id"),
        "actor_name": actor_snapshot.get("name"),
        "created_at": now,
    }

    db.it_support_tickets.update_one(
        {"_id": ticket_obj_id, "tenant_id": tenant_id},
        {
            "$set": update_doc,
            "$push": {"history": history_item},
        },
    )

    super_admins = get_super_admin_users(db)
    super_admin_user_ids = [str(user["_id"]) for user in super_admins if user.get("_id")]

    notify_users(
        db,
        super_admin_user_ids,
        "IT support ticket escalated",
        f"{ticket.get('ticket_no', 'Ticket')} escalated by {actor_snapshot.get('name')} — {label_for(ESCALATION_TYPES, escalation_type)}.",
        {
            "module": "it_support",
            "type": "it_ticket_escalated",
            "ticket_id": str(ticket["_id"]),
            "ticket_no": ticket.get("ticket_no"),
            "tenant_id": tenant_id,
            "escalation_type": escalation_type,
        },
        tenant_id,
    )

    audit("escalate", "it_support_tickets", ticket_obj_id, {
        "ticket_no": ticket.get("ticket_no"),
        "tenant_id": tenant_id,
        "escalation_type": escalation_type,
        "escalation_reason": escalation_reason,
    })

    updated = db.it_support_tickets.find_one({"_id": ticket_obj_id})

    return jsonify({
        "message": "IT support ticket escalated to Super Admin successfully",
        "ticket": public_ticket_doc(updated),
    })


@it_support_bp.patch("/<ticket_id>/review")
@current_user_required
def review_it_support_ticket(ticket_id):
    db = get_db()
    data = request.get_json(silent=True) or {}
    tenant_id = current_tenant_id()
    ticket_obj_id = safe_object_id(ticket_id)

    if not ticket_obj_id:
        return jsonify({"message": "Invalid ticket id"}), 400

    ticket = db.it_support_tickets.find_one({
        "_id": ticket_obj_id,
        "tenant_id": tenant_id,
    })

    if not ticket:
        return jsonify({"message": "IT support ticket not found"}), 404

    employee = current_employee(db)
    emp_id = str(employee.get("_id")) if employee and employee.get("_id") else ""
    user_id = current_user_id()

    is_owner = user_id in {
        normalize_text(ticket.get("created_by_user_id")),
        normalize_text(ticket.get("raised_by_user_id")),
    } or (
        emp_id
        and emp_id in {
            normalize_text(ticket.get("created_by_employee_id")),
            normalize_text(ticket.get("raised_by_employee_id")),
        }
    )

    if not is_owner:
        return jsonify({"message": "Only the ticket owner can review this IT support ticket"}), 403

    if normalize_key(ticket.get("status")) not in EMPLOYEE_REVIEW_STATUSES:
        return jsonify({"message": "Review can be submitted only after ticket is resolved"}), 400

    try:
        rating = int(data.get("rating") or data.get("review_rating") or 0)
    except Exception:
        rating = 0

    if rating < 1 or rating > 5:
        return jsonify({"message": "Rating must be between 1 and 5"}), 400

    comment = normalize_text(data.get("comment") or data.get("review_comment"))
    now = now_utc()
    actor_snapshot = build_employee_snapshot(employee, g.current_user)

    review_doc = {
        "rating": rating,
        "comment": comment,
        "reviewed_by_employee_id": actor_snapshot.get("employee_id"),
        "reviewed_by_user_id": actor_snapshot.get("user_id") or current_user_id(),
        "reviewed_by_name": actor_snapshot.get("name"),
        "reviewed_at": now,
    }

    history_item = {
        "action": "review_submitted",
        "status": ticket.get("status"),
        "status_label": ticket.get("status_label"),
        "note": f"Employee submitted {rating}/5 review",
        "review_rating": rating,
        "review_comment": comment,
        "actor_id": current_user_id(),
        "actor_employee_id": actor_snapshot.get("employee_id"),
        "actor_name": actor_snapshot.get("name"),
        "created_at": now,
    }

    db.it_support_tickets.update_one(
        {"_id": ticket_obj_id, "tenant_id": tenant_id},
        {
            "$set": {
                "review": review_doc,
                "review_rating": rating,
                "review_comment": comment,
                "reviewed_at": now,
                "status": "closed",
                "status_label": "Closed",
                "closed_at": now,
                "updated_at": now,
            },
            "$push": {"history": history_item},
        },
    )

    notify_targets = []

    assigned_user_id = normalize_text(ticket.get("assigned_to_user_id"))
    if assigned_user_id:
        notify_targets.append(assigned_user_id)

    heads = get_it_heads(db, tenant_id)
    for head in heads:
        head_user_id = employee_user_id(head)
        if head_user_id:
            notify_targets.append(head_user_id)

    notify_users(
        db,
        notify_targets,
        "IT support ticket reviewed",
        f"{ticket.get('ticket_no', 'Ticket')} received a {rating}/5 employee review.",
        {
            "module": "it_support",
            "type": "it_ticket_reviewed",
            "ticket_id": str(ticket["_id"]),
            "ticket_no": ticket.get("ticket_no"),
            "rating": rating,
        },
        tenant_id,
    )

    audit("review", "it_support_tickets", ticket_obj_id, {
        "ticket_no": ticket.get("ticket_no"),
        "rating": rating,
    })

    updated = db.it_support_tickets.find_one({"_id": ticket_obj_id})

    return jsonify({
        "message": "Review submitted successfully",
        "ticket": public_ticket_doc(updated),
    })


@it_support_bp.patch("/<ticket_id>/reopen")
@current_user_required
def reopen_it_support_ticket(ticket_id):
    db = get_db()
    data = request.get_json(silent=True) or {}
    tenant_id = current_tenant_id()
    ticket_obj_id = safe_object_id(ticket_id)

    if not ticket_obj_id:
        return jsonify({"message": "Invalid ticket id"}), 400

    ticket = db.it_support_tickets.find_one({
        "_id": ticket_obj_id,
        "tenant_id": tenant_id,
    })

    if not ticket:
        return jsonify({"message": "IT support ticket not found"}), 404

    employee = current_employee(db)
    emp_id = str(employee.get("_id")) if employee and employee.get("_id") else ""
    user_id = current_user_id()

    is_owner = user_id in {
        normalize_text(ticket.get("created_by_user_id")),
        normalize_text(ticket.get("raised_by_user_id")),
    } or (
        emp_id
        and emp_id in {
            normalize_text(ticket.get("created_by_employee_id")),
            normalize_text(ticket.get("raised_by_employee_id")),
        }
    )

    if not is_owner and not can_manage_normal_it_support(employee):
        return jsonify({"message": "Only ticket owner or IT Department Team Leader can reopen this ticket"}), 403

    if normalize_key(ticket.get("status")) not in {"resolved", "closed"}:
        return jsonify({"message": "Only resolved or closed ticket can be reopened"}), 400

    reason = normalize_text(data.get("reason") or data.get("note") or data.get("remarks"))

    if not reason:
        return jsonify({"message": "Reopen reason is required"}), 400

    now = now_utc()
    actor_snapshot = build_employee_snapshot(employee, g.current_user)

    history_item = {
        "action": "reopened",
        "status": "reopened",
        "status_label": "Reopened",
        "note": reason,
        "actor_id": current_user_id(),
        "actor_employee_id": actor_snapshot.get("employee_id"),
        "actor_name": actor_snapshot.get("name"),
        "created_at": now,
    }

    db.it_support_tickets.update_one(
        {"_id": ticket_obj_id, "tenant_id": tenant_id},
        {
            "$set": {
                "status": "reopened",
                "status_label": "Reopened",
                "last_status_note": reason,
                "updated_at": now,
            },
            "$push": {"history": history_item},
        },
    )

    notify_targets = []

    assigned_user_id = normalize_text(ticket.get("assigned_to_user_id"))
    if assigned_user_id:
        notify_targets.append(assigned_user_id)

    heads = get_it_heads(db, tenant_id)
    for head in heads:
        head_user_id = employee_user_id(head)
        if head_user_id:
            notify_targets.append(head_user_id)

    notify_users(
        db,
        notify_targets,
        "IT support ticket reopened",
        f"{ticket.get('ticket_no', 'Ticket')} has been reopened.",
        {
            "module": "it_support",
            "type": "it_ticket_reopened",
            "ticket_id": str(ticket["_id"]),
            "ticket_no": ticket.get("ticket_no"),
        },
        tenant_id,
    )

    audit("reopen", "it_support_tickets", ticket_obj_id, {
        "ticket_no": ticket.get("ticket_no"),
        "reason": reason,
    })

    updated = db.it_support_tickets.find_one({"_id": ticket_obj_id})

    return jsonify({
        "message": "IT support ticket reopened successfully",
        "ticket": public_ticket_doc(updated),
    })