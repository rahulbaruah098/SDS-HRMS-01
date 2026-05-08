from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime, date, timedelta

from app.extensions import get_db
from app.utils.auth import roles_required, current_user_required, audit
from app.utils.serializers import clean_doc


workflow_bp = Blueprint("workflow", __name__)


ADMIN_HR_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}

TEAM_APPROVAL_ROLES = {
    "team_leader",
    "reporting_officer",
}

FINANCE_ROLES = {
    "super_admin",
    "admin",
    "finance",
    "accounts_finance",
}

TICKET_MANAGER_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "team_leader",
    "reporting_officer",
}

LEAVE_APPROVAL_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "team_leader",
    "reporting_officer",
}

LEAVE_BALANCE_MANAGER_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}

LEAVE_TYPES_WITH_BALANCE = {"CL", "EL"}


# -----------------------------------------------------------------------------
# Common helpers
# -----------------------------------------------------------------------------

def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def normalize_text(value):
    return str(value or "").strip()


def normalize_status(value):
    return normalize_text(value).lower()


def normalize_project_status(value):
    status = normalize_text(value).lower()

    if status in {"completed", "complete", "done", "closed", "inactive"}:
        return "completed"

    if status in {"on_hold", "on-hold", "hold"}:
        return "on_hold"

    if status in {"active", "ongoing", "in_progress", "in-progress", "open"}:
        return "active"

    return status or "active"


def is_active_project(project):
    if not project:
        return False

    status = normalize_project_status(project.get("status"))

    return (
        status == "active"
        and project.get("is_deleted") is not True
    )


def normalize_leave_type(value):
    value = normalize_text(value).upper()

    aliases = {
        "CASUAL LEAVE": "CL",
        "CASUAL": "CL",
        "CL": "CL",
        "EARNED LEAVE": "EL",
        "EARNED": "EL",
        "EL": "EL",
        "COMP OFF": "COMP-OFF",
        "COMPOFF": "COMP-OFF",
        "COMP-OFF": "COMP-OFF",
        "COMPENSATORY LEAVE": "COMP-OFF",
        "COMPENSATORY OFF": "COMP-OFF",
    }

    return aliases.get(value, value)


def leave_type_label(leave_type):
    labels = {
        "CL": "Casual Leave",
        "EL": "Earned Leave",
        "COMP-OFF": "Comp-Off",
    }

    return labels.get(normalize_leave_type(leave_type), normalize_text(leave_type))


def parse_date(value):
    try:
        return datetime.strptime(normalize_text(value), "%Y-%m-%d").date()
    except Exception:
        return None


def date_to_str(value):
    if isinstance(value, date):
        return value.isoformat()

    return normalize_text(value)


def truthy(value):
    return str(value or "").strip().lower() in [
        "1",
        "true",
        "yes",
        "on",
        "half",
        "half_day",
    ]


def current_tenant_id():
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id") or "sds"


def current_user_roles():
    roles = g.current_user.get("roles", [])

    if isinstance(roles, list):
        return set([str(role).strip() for role in roles if str(role).strip()])

    if isinstance(roles, str):
        return set([role.strip() for role in roles.split(",") if role.strip()])

    return set()


def current_employee(db):
    tenant_id = current_tenant_id()

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": str(g.current_user["_id"]),
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee

    return db.employees.find_one({
        "user_id": str(g.current_user["_id"]),
        "is_deleted": {"$ne": True},
    })


def current_employee_id(db):
    employee = current_employee(db)
    return str(employee["_id"]) if employee else ""


def has_any_role(*allowed_roles):
    roles = current_user_roles()
    return bool(roles.intersection(set(allowed_roles)))


def employee_display_name(employee):
    return (
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("email")
        or "Employee"
    )


def employee_code(employee):
    return (
        employee.get("employee_id")
        or employee.get("emp_code")
        or employee.get("code")
        or ""
    )


def employee_user_id(db, employee_id, tenant_id=None):
    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return ""

    q = {
        "_id": employee_obj_id,
        "is_deleted": {"$ne": True},
    }

    if tenant_id:
        q["tenant_id"] = tenant_id
    else:
        q["tenant_id"] = current_tenant_id()

    row = db.employees.find_one(q)

    if not row:
        return ""

    return str(row.get("user_id", ""))


def users_for_roles(db, role_names, tenant_id=None):
    tenant_id = tenant_id or current_tenant_id()

    rows = db.users.find({
        "tenant_id": tenant_id,
        "is_active": True,
        "roles": {"$in": list(role_names)},
    })

    return [str(row["_id"]) for row in rows]


def notify_users(db, user_ids, title, body, meta=None, tenant_id=None):
    now = datetime.utcnow()
    tenant_id = tenant_id or current_tenant_id()
    docs = []

    for user_id in set([uid for uid in user_ids if uid]):
        docs.append({
            "tenant_id": tenant_id,
            "user_id": str(user_id),
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


def can_manage_employee_record(db, employee_id):
    roles = current_user_roles()

    if roles.intersection(ADMIN_HR_ROLES):
        return True

    reviewer_emp = current_employee(db)

    if not reviewer_emp:
        return False

    reviewer_emp_id = str(reviewer_emp["_id"])

    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return False

    employee = db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    })

    if not employee:
        return False

    if (
        ("team_leader" in roles or truthy(reviewer_emp.get("is_team_leader")))
        and employee.get("team_leader_id") == reviewer_emp_id
    ):
        return True

    if (
        ("reporting_officer" in roles or truthy(reviewer_emp.get("is_reporting_officer")))
        and employee.get("reporting_officer_id") == reviewer_emp_id
    ):
        return True

    return False


# -----------------------------------------------------------------------------
# Leave helpers
# -----------------------------------------------------------------------------

def calculate_leave_days(data):
    if data.get("leave_days") not in [None, ""]:
        try:
            value = float(data.get("leave_days"))
            return 0.5 if value == 0.5 else max(value, 1.0)
        except Exception:
            pass

    if truthy(data.get("is_half_day")) or normalize_text(data.get("day_type")).lower() == "half_day":
        return 0.5

    from_date = parse_date(data.get("from_date"))
    to_date = parse_date(data.get("to_date")) or from_date

    if from_date and to_date and to_date >= from_date:
        return float((to_date - from_date).days + 1)

    return 1.0


def build_initial_leave_stage(employee):
    if employee.get("team_leader_id"):
        return "team_leader"

    if employee.get("reporting_officer_id"):
        return "reporting_officer"

    return "hr"


def next_leave_stage(employee, current_stage):
    if current_stage == "team_leader":
        if employee.get("reporting_officer_id"):
            return "reporting_officer"
        return "final"

    if current_stage == "reporting_officer":
        return "final"

    if current_stage == "hr":
        return "final"

    return "final"


def leave_stage_label(stage):
    labels = {
        "team_leader": "Team Leader",
        "reporting_officer": "Reporting Officer",
        "hr": "HR",
        "final": "Final Approval",
        "approved": "Approved",
        "rejected": "Rejected",
    }

    return labels.get(stage, stage or "Approval")


def reviewer_can_decide_leave(db, leave_doc):
    roles = current_user_roles()
    stage = leave_doc.get("approval_stage") or "hr"

    if stage == "hr":
        return bool(roles.intersection(ADMIN_HR_ROLES))

    reviewer_emp = current_employee(db)

    if not reviewer_emp:
        return False

    reviewer_emp_id = str(reviewer_emp["_id"])

    if stage == "team_leader":
        return (
            leave_doc.get("team_leader_id") == reviewer_emp_id
            and (
                "team_leader" in roles
                or truthy(reviewer_emp.get("is_team_leader"))
            )
        )

    if stage == "reporting_officer":
        return (
            leave_doc.get("reporting_officer_id") == reviewer_emp_id
            and (
                "reporting_officer" in roles
                or truthy(reviewer_emp.get("is_reporting_officer"))
            )
        )

    return False


def scoped_leave_query(db, leave_obj_id):
    roles = current_user_roles()

    q = {
        "_id": leave_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    if roles.intersection(ADMIN_HR_ROLES):
        return q

    reviewer_emp = current_employee(db)

    if not reviewer_emp:
        q["employee_id"] = "__none__"
        return q

    reviewer_emp_id = str(reviewer_emp["_id"])
    scope_or = [{"employee_id": reviewer_emp_id}]

    if "team_leader" in roles or truthy(reviewer_emp.get("is_team_leader")):
        scope_or.append({
            "team_leader_id": reviewer_emp_id,
            "approval_stage": "team_leader",
        })

    if "reporting_officer" in roles or truthy(reviewer_emp.get("is_reporting_officer")):
        scope_or.append({
            "reporting_officer_id": reviewer_emp_id,
            "approval_stage": "reporting_officer",
        })

    q["$or"] = scope_or
    return q


def get_leave_balance(db, employee, leave_type):
    leave_type = normalize_leave_type(leave_type)

    return db.leave_balances.find_one({
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "employee_id": str(employee["_id"]),
        "leave_type": leave_type,
        "is_deleted": {"$ne": True},
    })


def ensure_leave_balance(db, employee, leave_type):
    leave_type = normalize_leave_type(leave_type)
    existing = get_leave_balance(db, employee, leave_type)

    if existing:
        return existing

    now = datetime.utcnow()
    tenant_id = employee.get("tenant_id") or current_tenant_id()

    doc = {
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "employee_name": employee_display_name(employee),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "leave_type": leave_type,
        "leave_type_label": leave_type_label(leave_type),
        "opening_balance": 0.0,
        "credited": 0.0,
        "used": 0.0,
        "available": 0.0,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }

    res = db.leave_balances.insert_one(doc)
    doc["_id"] = res.inserted_id

    return doc


def has_sufficient_leave_balance(db, employee, leave_type, leave_days):
    leave_type = normalize_leave_type(leave_type)

    if leave_type not in LEAVE_TYPES_WITH_BALANCE:
        return True, None

    balance = ensure_leave_balance(db, employee, leave_type)
    available = float(balance.get("available", 0) or 0)

    if available < float(leave_days):
        return False, balance

    return True, balance


def deduct_leave_balance(db, employee, leave_doc):
    leave_type = normalize_leave_type(leave_doc.get("leave_type"))

    if leave_type not in LEAVE_TYPES_WITH_BALANCE:
        return None

    if leave_doc.get("balance_deducted"):
        return get_leave_balance(db, employee, leave_type)

    leave_days = float(leave_doc.get("leave_days", 1) or 1)
    balance = ensure_leave_balance(db, employee, leave_type)
    available = float(balance.get("available", 0) or 0)

    if available < leave_days:
        return None

    db.leave_balances.update_one(
        {"_id": balance["_id"]},
        {
            "$inc": {
                "used": leave_days,
                "available": -leave_days,
            },
            "$set": {"updated_at": datetime.utcnow()},
        },
    )

    return db.leave_balances.find_one({"_id": balance["_id"]})


def rollback_compoff_claim_if_needed(db, leave_doc):
    if normalize_leave_type(leave_doc.get("leave_type")) != "COMP-OFF":
        return

    compoff_id = leave_doc.get("compoff_id")
    compoff_obj_id = safe_object_id(compoff_id)

    if not compoff_obj_id:
        return

    db.compoff_credits.update_one(
        {
            "_id": compoff_obj_id,
            "tenant_id": leave_doc.get("tenant_id") or current_tenant_id(),
            "leave_request_id": str(leave_doc.get("_id")),
        },
        {
            "$set": {
                "status": "available",
                "claimed_date": "",
                "leave_request_id": "",
                "updated_at": datetime.utcnow(),
            }
        },
    )


def create_leave_history_entry(status, stage, note):
    return {
        "stage": stage,
        "stage_label": leave_stage_label(stage),
        "status": status,
        "note": note,
        "by": str(g.current_user["_id"]),
        "by_name": g.current_user.get("name") or g.current_user.get("email"),
        "created_at": datetime.utcnow(),
    }


def notify_next_leave_approvers(db, employee, leave_doc, stage):
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    user_ids = []

    if stage == "team_leader":
        user_ids.append(employee_user_id(db, employee.get("team_leader_id"), tenant_id))
    elif stage == "reporting_officer":
        user_ids.append(employee_user_id(db, employee.get("reporting_officer_id"), tenant_id))
    elif stage == "hr":
        user_ids.extend(users_for_roles(db, ADMIN_HR_ROLES, tenant_id))

    if not user_ids:
        return

    notify_users(
        db,
        user_ids,
        "Leave Approval Pending",
        f"{employee_display_name(employee)} has a leave request pending at {leave_stage_label(stage)} stage.",
        {
            "leave_request_id": str(leave_doc.get("_id")),
            "employee_id": str(employee.get("_id")),
            "stage": stage,
        },
        tenant_id=tenant_id,
    )


def notify_employee_leave_decision(db, employee, leave_doc, status):
    notify_users(
        db,
        [employee.get("user_id")],
        "Leave Request Updated",
        f"Your leave request has been {status}.",
        {
            "leave_request_id": str(leave_doc.get("_id")),
            "status": status,
        },
        tenant_id=employee.get("tenant_id") or current_tenant_id(),
    )


def resolve_handover_employee(db, tenant_id, employee, raw_employee_id):
    handover_id = normalize_text(raw_employee_id)

    if not handover_id:
        return {
            "task_handover_to_id": "",
            "task_handover_to_name": "",
            "task_handover_employee_id": "",
            "task_handover_to_employee_code": "",
        }

    handover_obj_id = safe_object_id(handover_id)

    if not handover_obj_id:
        raise ValueError("Invalid task handover employee")

    q = {
        "_id": handover_obj_id,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    }

    if employee.get("department"):
        q["department"] = employee.get("department")

    handover_employee = db.employees.find_one(q)

    if not handover_employee:
        raise ValueError("Task handover employee must be an active member of the same department")

    if str(handover_employee.get("_id")) == str(employee.get("_id")):
        raise ValueError("Task handover cannot be assigned to yourself")

    handover_code = employee_code(handover_employee)

    return {
        "task_handover_to_id": str(handover_employee["_id"]),
        "task_handover_to_name": employee_display_name(handover_employee),
        "task_handover_employee_id": handover_code,
        "task_handover_to_employee_code": handover_code,
    }


def resolve_project_handover(db, tenant_id, raw_project_id, raw_project_name=""):
    project_id = normalize_text(raw_project_id)
    project_name = normalize_text(raw_project_name)

    if not project_id and not project_name:
        return {
            "project_handover_id": "",
            "project_handover_name": "",
        }

    if project_id:
        project_obj_id = safe_object_id(project_id)

        if not project_obj_id:
            raise ValueError("Invalid project handover selection")

        project = db.projects.find_one({
            "_id": project_obj_id,
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "status": "active",
        })

        if not project:
            raise ValueError("Selected project was not found or is already completed")

        return {
            "project_handover_id": str(project["_id"]),
            "project_handover_name": project.get("name") or project.get("project_name") or project.get("title") or "",
        }

    return {
        "project_handover_id": "",
        "project_handover_name": project_name,
    }


def leave_stage_status_fields(initial_stage):
    return {
        "team_leader_status": "pending" if initial_stage == "team_leader" else "not_applicable",
        "reporting_officer_status": "pending" if initial_stage == "reporting_officer" else "not_applicable",
        "hr_status": "pending" if initial_stage == "hr" else "view_only",
    }


def approval_stage_update_fields(stage, status, note):
    now = datetime.utcnow()
    actor_id = str(g.current_user["_id"])
    actor_name = g.current_user.get("name") or g.current_user.get("email")

    prefix_map = {
        "team_leader": "team_leader",
        "reporting_officer": "reporting_officer",
        "hr": "hr",
    }

    prefix = prefix_map.get(stage)

    if not prefix:
        return {}

    return {
        f"{prefix}_status": status,
        f"{prefix}_decision_note": note,
        f"{prefix}_decision_by": actor_id,
        f"{prefix}_decision_by_name": actor_name,
        f"{prefix}_decision_at": now,
    }


def date_range_for_period(period, base_value=None):
    base = parse_date(base_value) or date.today()
    period = normalize_text(period).lower()

    if period in ["day", "today"]:
        return base, base

    if period in ["week", "this_week"]:
        start = base - timedelta(days=base.weekday())
        return start, start + timedelta(days=6)

    if period in ["month", "this_month"]:
        start = base.replace(day=1)
        if start.month == 12:
            next_month = start.replace(year=start.year + 1, month=1, day=1)
        else:
            next_month = start.replace(month=start.month + 1, day=1)
        return start, next_month - timedelta(days=1)

    if period in ["year", "this_year"]:
        return date(base.year, 1, 1), date(base.year, 12, 31)

    return None, None


def leave_list_scope_query(db):
    roles = current_user_roles()
    tenant_arg = normalize_text(request.args.get("tenant_id"))

    if "super_admin" in roles and tenant_arg:
        q = {"tenant_id": tenant_arg}
    elif "super_admin" in roles and not tenant_arg:
        q = {}
    else:
        q = {"tenant_id": current_tenant_id()}

    q["is_deleted"] = {"$ne": True}

    if roles.intersection(ADMIN_HR_ROLES):
        return q

    employee = current_employee(db)

    if not employee:
        q["employee_id"] = "__none__"
        return q

    emp_id = str(employee["_id"])
    scope_or = [{"employee_id": emp_id}]

    if "team_leader" in roles or truthy(employee.get("is_team_leader")):
        scope_or.append({
            "team_leader_id": emp_id,
            "approval_stage": "team_leader",
        })

    if "reporting_officer" in roles or truthy(employee.get("is_reporting_officer")):
        scope_or.append({
            "reporting_officer_id": emp_id,
            "approval_stage": "reporting_officer",
        })

    q["$or"] = scope_or
    return q


# -----------------------------------------------------------------------------
# Leave management APIs
# -----------------------------------------------------------------------------

@workflow_bp.get("/leave_balances")
@current_user_required
def list_leave_balances():
    db = get_db()
    roles = current_user_roles()
    employee_id = normalize_text(request.args.get("employee_id"))
    tenant_arg = normalize_text(request.args.get("tenant_id"))

    if "super_admin" in roles and tenant_arg:
        q = {"tenant_id": tenant_arg}
    else:
        q = {"tenant_id": current_tenant_id()}

    q["is_deleted"] = {"$ne": True}

    if roles.intersection(LEAVE_BALANCE_MANAGER_ROLES):
        if employee_id:
            q["employee_id"] = employee_id
    else:
        current_emp_id = current_employee_id(db)

        if not current_emp_id:
            return jsonify({"items": []})

        q["employee_id"] = current_emp_id

    items = list(
        db.leave_balances
        .find(q)
        .sort([("employee_name", 1), ("leave_type", 1)])
        .limit(1000)
    )

    return jsonify({"items": clean_doc(items)})


@workflow_bp.patch("/leave_balances/<employee_id>")
@roles_required(*LEAVE_BALANCE_MANAGER_ROLES)
def set_leave_balance(employee_id):
    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return jsonify({"message": "Invalid employee id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    roles = current_user_roles()

    q = {
        "_id": employee_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    employee = db.employees.find_one(q)

    if not employee:
        return jsonify({"message": "Employee not found"}), 404

    updates = []
    now = datetime.utcnow()

    for leave_type in ["CL", "EL"]:
        if leave_type not in data and leave_type.lower() not in data:
            continue

        raw = data.get(leave_type, data.get(leave_type.lower()))

        try:
            total = float(raw)
        except Exception:
            return jsonify({"message": f"{leave_type} balance must be a number"}), 400

        if total < 0:
            return jsonify({"message": f"{leave_type} balance cannot be negative"}), 400

        existing = ensure_leave_balance(db, employee, leave_type)
        used = float(existing.get("used", 0) or 0)
        available = max(total - used, 0)

        db.leave_balances.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "employee_code": employee_code(employee),
                    "emp_code": employee.get("emp_code", ""),
                    "employee_name": employee_display_name(employee),
                    "department": employee.get("department", ""),
                    "designation": employee.get("designation", ""),
                    "leave_type_label": leave_type_label(leave_type),
                    "opening_balance": total,
                    "credited": total,
                    "available": available,
                    "status": "active",
                    "updated_at": now,
                    "updated_by": str(g.current_user["_id"]),
                }
            },
        )

        updates.append(leave_type)

    if not updates:
        return jsonify({"message": "Send CL and/or EL balance to update"}), 400

    audit("set_leave_balance", "leave_balances", employee_id, data)

    items = list(db.leave_balances.find({
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "employee_id": str(employee_obj_id),
        "is_deleted": {"$ne": True},
    }))

    return jsonify({
        "message": "Leave balance updated",
        "items": clean_doc(items),
    })


@workflow_bp.get("/leave_requests/options")
@current_user_required
def leave_request_options():
    db = get_db()
    employee = current_employee(db)

    if not employee:
        return jsonify({
            "members": [],
            "task_handover_options": [],
            "projects": [],
        })

    tenant_id = employee.get("tenant_id") or current_tenant_id()

    member_query = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
        "_id": {"$ne": employee["_id"]},
    }

    if employee.get("department"):
        member_query["department"] = employee.get("department")

    members = list(
        db.employees
        .find(member_query, {
            "name": 1,
            "employee_name": 1,
            "employee_id": 1,
            "emp_code": 1,
            "department": 1,
            "designation": 1,
        })
        .sort("name", 1)
        .limit(500)
    )

    project_query = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": "active",
    }

    if employee.get("department"):
        project_query["$or"] = [
            {"department": employee.get("department")},
            {"department": ""},
            {"department": {"$exists": False}},
        ]

    projects = list(
        db.projects
        .find(project_query, {
            "name": 1,
            "project_name": 1,
            "title": 1,
            "status": 1,
            "department": 1,
            "team_leader_id": 1,
            "team_leader_name": 1,
            "assigned_employee_ids": 1,
            "assigned_members": 1,
            "collaborator_ids": 1,
            "collaborators": 1,
        })
        .sort("name", 1)
        .limit(500)
    )

    return jsonify({
        "members": clean_doc(members),
        "task_handover_options": clean_doc(members),
        "projects": clean_doc(projects),
    })


@workflow_bp.get("/leave_requests")
@current_user_required
def list_leave_requests():
    db = get_db()
    q = leave_list_scope_query(db)

    status = normalize_text(request.args.get("status"))
    employee_id = normalize_text(request.args.get("employee_id"))
    department = normalize_text(request.args.get("department"))
    approval_stage = normalize_text(request.args.get("approval_stage"))
    task_handover_to_id = normalize_text(request.args.get("task_handover_to_id"))
    project_handover_id = normalize_text(request.args.get("project_handover_id"))
    leave_type = normalize_leave_type(request.args.get("leave_type")) if request.args.get("leave_type") else ""
    period = normalize_text(request.args.get("period"))
    base_date = (
        normalize_text(request.args.get("on_date"))
        or normalize_text(request.args.get("date"))
    )
    date_from = parse_date(request.args.get("date_from"))
    date_to = parse_date(request.args.get("date_to"))

    if status:
        q["status"] = status

    if employee_id:
        q["employee_id"] = employee_id

    if department:
        q["department"] = department

    if approval_stage:
        q["approval_stage"] = approval_stage

    if task_handover_to_id:
        q["task_handover_to_id"] = task_handover_to_id

    if project_handover_id:
        q["project_handover_id"] = project_handover_id

    if leave_type:
        q["leave_type"] = leave_type

    if period and not (date_from or date_to):
        date_from, date_to = date_range_for_period(period, base_date)

    if date_from or date_to:
        overlap = {}

        if date_to:
            overlap["from_date"] = {"$lte": date_to.isoformat()}

        if date_from:
            overlap["to_date"] = {"$gte": date_from.isoformat()}

        q.update(overlap)

    items = list(
        db.leave_requests
        .find(q)
        .sort([("from_date", -1), ("created_at", -1)])
        .limit(1000)
    )

    return jsonify({"items": clean_doc(items)})


@workflow_bp.post("/leave_requests/apply")
@current_user_required
def apply_leave_request():
    db = get_db()
    employee = current_employee(db)

    if not employee:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}
    leave_type = normalize_leave_type(data.get("leave_type"))
    from_date = parse_date(data.get("from_date"))
    to_date = parse_date(data.get("to_date") or data.get("upto_date")) or from_date
    reason = normalize_text(data.get("reason"))
    tenant_id = employee.get("tenant_id") or current_tenant_id()

    leave_days = calculate_leave_days({
        "from_date": from_date.isoformat() if from_date else "",
        "to_date": to_date.isoformat() if to_date else "",
        "leave_days": data.get("leave_days"),
    })

    if leave_type not in ["CL", "EL", "COMP-OFF"]:
        return jsonify({"message": "Leave type must be Casual Leave or Earned Leave"}), 400

    if not from_date or not to_date:
        return jsonify({"message": "From date and upto date are required"}), 400

    if to_date < from_date:
        return jsonify({"message": "Upto date cannot be before from date"}), 400

    if from_date < date.today():
        return jsonify({"message": "Leave date cannot be in the past"}), 400

    if not reason:
        return jsonify({"message": "Leave reason is required"}), 400

    try:
        handover_data = resolve_handover_employee(
            db,
            tenant_id,
            employee,
            data.get("task_handover_to_id") or data.get("task_handover_to") or data.get("handover_employee_id"),
        )
        project_data = resolve_project_handover(
            db,
            tenant_id,
            data.get("project_handover_id") or data.get("project_id"),
            data.get("project_handover_name") or data.get("project_name") or data.get("project"),
        )
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400

    existing_leave = db.leave_requests.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "from_date": {"$lte": to_date.isoformat()},
        "to_date": {"$gte": from_date.isoformat()},
        "status": {"$in": ["pending", "approved", "in_review"]},
        "is_deleted": {"$ne": True},
    })

    if existing_leave:
        return jsonify({
            "message": "A pending or approved leave already exists in this date range"
        }), 409

    sufficient, balance = has_sufficient_leave_balance(db, employee, leave_type, leave_days)

    if not sufficient:
        return jsonify({
            "message": f"Insufficient {leave_type_label(leave_type)} balance",
            "available": float(balance.get("available", 0) or 0) if balance else 0,
        }), 400

    initial_stage = build_initial_leave_stage(employee)
    now = datetime.utcnow()

    doc = {
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "employee_name": employee_display_name(employee),
        "employee_email": employee.get("email", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
        "leave_type": leave_type,
        "leave_type_label": leave_type_label(leave_type),
        "leave_days": leave_days,
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "upto_date": to_date.isoformat(),
        "reason": reason,
        **handover_data,
        **project_data,
        "status": "pending",
        "approval_stage": initial_stage,
        "approval_stage_label": leave_stage_label(initial_stage),
        **leave_stage_status_fields(initial_stage),
        "approval_history": [],
        "balance_deducted": False,
        "created_at": now,
        "updated_at": now,
        "created_by": str(g.current_user["_id"]),
    }

    res = db.leave_requests.insert_one(doc)
    doc["_id"] = res.inserted_id

    notify_next_leave_approvers(db, employee, doc, initial_stage)

    audit("apply_leave", "leave_requests", res.inserted_id, doc)

    return jsonify({
        "message": "Leave request submitted",
        "item": clean_doc(doc),
    }), 201


@workflow_bp.patch("/leave_requests/<req_id>/decision")
@roles_required(*LEAVE_APPROVAL_ROLES)
def leave_decision(req_id):
    leave_obj_id = safe_object_id(req_id)

    if not leave_obj_id:
        return jsonify({"message": "Invalid leave request id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    status = normalize_status(data.get("status"))
    note = normalize_text(data.get("reason") or data.get("note") or data.get("decision_reason"))

    if status not in ["approved", "rejected"]:
        return jsonify({"message": "status must be approved or rejected"}), 400

    q = scoped_leave_query(db, leave_obj_id)
    existing = db.leave_requests.find_one(q)

    if not existing:
        return jsonify({"message": "Leave request not found or not in your approval scope"}), 404

    if existing.get("status") not in ["pending", "in_review"]:
        return jsonify({"message": "Only pending leave requests can be decided"}), 400

    if not reviewer_can_decide_leave(db, existing):
        return jsonify({
            "message": f"This leave is pending at {leave_stage_label(existing.get('approval_stage'))} stage"
        }), 403

    employee_obj_id = safe_object_id(existing.get("employee_id"))

    if not employee_obj_id:
        return jsonify({"message": "Leave request has invalid employee mapping"}), 400

    employee = db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": existing.get("tenant_id") or current_tenant_id(),
        "is_deleted": {"$ne": True},
    })

    if not employee:
        return jsonify({"message": "Employee not found"}), 404

    current_stage = existing.get("approval_stage") or build_initial_leave_stage(employee)
    now = datetime.utcnow()

    if status == "rejected":
        rollback_compoff_claim_if_needed(db, existing)

        stage_fields = approval_stage_update_fields(current_stage, "rejected", note)
        update_set = {
            "status": "rejected",
            "approval_stage": "rejected",
            "approval_stage_label": "Rejected",
            "decision_reason": note,
            "rejected_at": now,
            "rejected_by": str(g.current_user["_id"]),
            "rejected_by_name": g.current_user.get("name") or g.current_user.get("email"),
            "updated_at": now,
            **stage_fields,
        }

        db.leave_requests.update_one(
            {"_id": leave_obj_id},
            {
                "$set": update_set,
                "$push": {
                    "approval_history": create_leave_history_entry("rejected", current_stage, note),
                },
            },
        )
        updated = db.leave_requests.find_one({"_id": leave_obj_id})

        notify_employee_leave_decision(db, employee, updated, "rejected")
        audit("reject_leave", "leave_requests", req_id, data)

        return jsonify({
            "message": "Leave rejected",
            "item": clean_doc(updated),
        })

    next_stage = next_leave_stage(employee, current_stage)
    current_stage_fields = approval_stage_update_fields(current_stage, "approved", note)

    if next_stage != "final":
        next_pending_fields = {}

        if next_stage == "reporting_officer":
            next_pending_fields["reporting_officer_status"] = "pending"
        elif next_stage == "hr":
            next_pending_fields["hr_status"] = "pending"

        update_set = {
            "status": "pending",
            "approval_stage": next_stage,
            "approval_stage_label": leave_stage_label(next_stage),
            "updated_at": now,
            **current_stage_fields,
            **next_pending_fields,
        }

        db.leave_requests.update_one(
            {"_id": leave_obj_id},
            {
                "$set": update_set,
                "$push": {
                    "approval_history": create_leave_history_entry("approved", current_stage, note),
                },
            },
        )
        updated = db.leave_requests.find_one({"_id": leave_obj_id})

        notify_next_leave_approvers(db, employee, updated, next_stage)
        audit("approve_leave_stage", "leave_requests", req_id, {
            "stage": current_stage,
            **data,
        })

        return jsonify({
            "message": f"Approved by {leave_stage_label(current_stage)}. Sent to {leave_stage_label(next_stage)}.",
            "item": clean_doc(updated),
        })

    leave_type = normalize_leave_type(existing.get("leave_type"))
    leave_days = float(existing.get("leave_days", 1) or 1)

    if leave_type in LEAVE_TYPES_WITH_BALANCE and not existing.get("balance_deducted"):
        sufficient, balance = has_sufficient_leave_balance(db, employee, leave_type, leave_days)

        if not sufficient:
            return jsonify({
                "message": f"Insufficient {leave_type_label(leave_type)} balance at final approval",
                "available": float(balance.get("available", 0) or 0) if balance else 0,
            }), 400

        deduct_leave_balance(db, employee, existing)

    update_set = {
        "status": "approved",
        "approval_stage": "approved",
        "approval_stage_label": "Approved",
        "decision_reason": note,
        "approved_at": now,
        "approved_by": str(g.current_user["_id"]),
        "approved_by_name": g.current_user.get("name") or g.current_user.get("email"),
        "balance_deducted": leave_type in LEAVE_TYPES_WITH_BALANCE,
        "updated_at": now,
        **current_stage_fields,
    }

    db.leave_requests.update_one(
        {"_id": leave_obj_id},
        {
            "$set": update_set,
            "$push": {
                "approval_history": create_leave_history_entry("approved", current_stage, note),
            },
        },
    )
    updated = db.leave_requests.find_one({"_id": leave_obj_id})

    notify_employee_leave_decision(db, employee, updated, "approved")
    audit("approve_leave_final", "leave_requests", req_id, data)

    return jsonify({
        "message": "Leave approved",
        "item": clean_doc(updated),
    })


# -----------------------------------------------------------------------------
# Existing workflow APIs retained below
# -----------------------------------------------------------------------------

@workflow_bp.patch("/expenses/<expense_id>/decision")
@roles_required(
    "super_admin",
    "admin",
    "finance",
    "accounts_finance",
    "team_leader",
    "reporting_officer",
)
def expense_decision(expense_id):
    expense_obj_id = safe_object_id(expense_id)

    if not expense_obj_id:
        return jsonify({"message": "Invalid expense id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    status = data.get("status")

    if status not in ["approved", "rejected", "paid"]:
        return jsonify({"message": "Invalid expense status"}), 400

    q = {
        "_id": expense_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in current_user_roles():
        q["tenant_id"] = current_tenant_id()

    existing = db.expenses.find_one(q)

    if not existing:
        return jsonify({"message": "Expense not found"}), 404

    roles = current_user_roles()

    if not roles.intersection(FINANCE_ROLES):
        employee_id = existing.get("employee_id")

        if not can_manage_employee_record(db, employee_id):
            return jsonify({"message": "Expense not in your approval scope"}), 403

        if status == "paid":
            return jsonify({"message": "Only finance/admin can mark expense as paid"}), 403

    db.expenses.update_one(
        {"_id": expense_obj_id},
        {
            "$set": {
                "status": status,
                "decision_note": data.get("note", ""),
                "approved_by": str(g.current_user["_id"]),
                "approved_by_name": g.current_user.get("name") or g.current_user.get("email"),
                "updated_at": datetime.utcnow(),
            }
        },
    )

    audit(status, "expenses", expense_id, data)

    return jsonify({"message": f"Expense {status}"})


@workflow_bp.patch("/tickets/<ticket_id>/status")
@current_user_required
def ticket_status(ticket_id):
    ticket_obj_id = safe_object_id(ticket_id)

    if not ticket_obj_id:
        return jsonify({"message": "Invalid ticket id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    status = data.get("status", "in_progress")
    comment = data.get("comment", "")

    if status not in ["open", "in_progress", "resolved", "closed"]:
        return jsonify({"message": "Invalid ticket status"}), 400

    q = {
        "_id": ticket_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in current_user_roles():
        q["tenant_id"] = current_tenant_id()

    existing = db.tickets.find_one(q)

    if not existing:
        return jsonify({"message": "Ticket not found"}), 404

    roles = current_user_roles()
    emp_id = current_employee_id(db)

    is_owner = existing.get("raised_by") == emp_id
    is_manager = bool(roles.intersection(TICKET_MANAGER_ROLES))

    if not is_owner and not is_manager:
        return jsonify({"message": "Ticket not in your scope"}), 403

    if is_owner and not is_manager and status in ["resolved", "closed"]:
        return jsonify({"message": "Only HR/Admin/Manager can resolve or close ticket"}), 403

    update = {
        "$set": {
            "status": status,
            "updated_at": datetime.utcnow(),
        }
    }

    if comment:
        update["$push"] = {
            "comments": {
                "by": str(g.current_user["_id"]),
                "by_name": g.current_user.get("name") or g.current_user.get("email"),
                "comment": comment,
                "created_at": datetime.utcnow(),
            }
        }

    db.tickets.update_one({"_id": ticket_obj_id}, update)

    audit("ticket_status", "tickets", ticket_id, data)

    return jsonify({"message": "Ticket updated"})


@workflow_bp.post("/payroll/run")
@roles_required("super_admin", "admin", "finance", "accounts_finance")
def payroll_run():
    db = get_db()
    data = request.get_json(silent=True) or {}
    month = data.get("month")
    tenant_arg = normalize_text(data.get("tenant_id"))
    roles = current_user_roles()

    if not month:
        return jsonify({"message": "month is required, format YYYY-MM"}), 400

    tenant_id = tenant_arg if "super_admin" in roles and tenant_arg else current_tenant_id()

    employees = list(
        db.employees.find({
            "tenant_id": tenant_id,
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
        })
    )

    gross_total = 0

    for employee in employees:
        gross = float(employee.get("salary", 30000) or 0)
        deductions = float(data.get("standard_deduction", 0) or 0)
        net = gross - deductions
        gross_total += gross

        db.payslips.update_one(
            {
                "tenant_id": tenant_id,
                "employee_id": str(employee["_id"]),
                "month": month,
            },
            {
                "$set": {
                    "tenant_id": tenant_id,
                    "employee_id": str(employee["_id"]),
                    "employee_code": employee_code(employee),
                    "employee_name": employee.get("name"),
                    "month": month,
                    "gross": gross,
                    "deductions": deductions,
                    "net_pay": net,
                    "status": "generated",
                    "updated_at": datetime.utcnow(),
                },
                "$setOnInsert": {
                    "created_at": datetime.utcnow(),
                },
            },
            upsert=True,
        )

    run = {
        "tenant_id": tenant_id,
        "month": month,
        "employee_count": len(employees),
        "gross_total": gross_total,
        "status": "processed",
        "created_at": datetime.utcnow(),
        "created_by": str(g.current_user["_id"]),
    }

    res = db.payroll_runs.insert_one(run)

    audit("payroll_run", "payroll_runs", res.inserted_id, run)

    return jsonify({
        "message": "Payroll processed",
        "run": str(res.inserted_id),
    })


@workflow_bp.post("/performance/reviews")
@roles_required(
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "team_leader",
    "reporting_officer",
)
def create_performance_review():
    db = get_db()
    data = request.get_json(silent=True) or {}

    employee_id = data.get("employee_id")
    rating = data.get("rating")
    comments = data.get("comments", "")
    cycle = data.get("cycle") or datetime.utcnow().strftime("%B %Y")

    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return jsonify({"message": "Valid employee_id is required"}), 400

    try:
        rating = float(rating)
    except Exception:
        return jsonify({"message": "rating must be a number"}), 400

    if rating < 1 or rating > 5:
        return jsonify({"message": "rating must be between 1 and 5"}), 400

    q = {
        "_id": employee_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in current_user_roles():
        q["tenant_id"] = current_tenant_id()

    employee = db.employees.find_one(q)

    if not employee:
        return jsonify({"message": "Employee not found"}), 404

    roles = current_user_roles()
    reviewer_emp = current_employee(db)
    reviewer_emp_id = str(reviewer_emp["_id"]) if reviewer_emp else ""

    if not roles.intersection(ADMIN_HR_ROLES):
        can_review = False

        if (
            ("team_leader" in roles or truthy(reviewer_emp.get("is_team_leader") if reviewer_emp else False))
            and employee.get("team_leader_id") == reviewer_emp_id
        ):
            can_review = True

        if (
            ("reporting_officer" in roles or truthy(reviewer_emp.get("is_reporting_officer") if reviewer_emp else False))
            and employee.get("reporting_officer_id") == reviewer_emp_id
        ):
            can_review = True

        if not can_review:
            return jsonify({"message": "You can review only employees assigned to you"}), 403

    reviewer_role = "admin_hr"

    if (
        reviewer_emp
        and ("team_leader" in roles or truthy(reviewer_emp.get("is_team_leader")))
        and employee.get("team_leader_id") == reviewer_emp_id
    ):
        reviewer_role = "team_leader"

    if (
        reviewer_emp
        and ("reporting_officer" in roles or truthy(reviewer_emp.get("is_reporting_officer")))
        and employee.get("reporting_officer_id") == reviewer_emp_id
    ):
        reviewer_role = "reporting_officer"

    review = {
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "employee_id": employee_id,
        "employee_code": employee_code(employee),
        "employee_name": employee.get("name"),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "cycle": cycle,
        "rating": rating,
        "comments": comments,
        "reviewer_id": str(g.current_user["_id"]),
        "reviewer_employee_id": reviewer_emp_id,
        "reviewer_name": g.current_user.get("name") or g.current_user.get("email"),
        "reviewer_role": reviewer_role,
        "visibility": ["md", "hr", "employee_self"],
        "status": "submitted",
        "created_at": datetime.utcnow(),
        "created_by": str(g.current_user["_id"]),
    }

    res = db.performance_reviews.insert_one(review)

    audit("create_performance_review", "performance_reviews", res.inserted_id, review)

    return jsonify({
        "message": "Performance review submitted",
        "item": str(res.inserted_id),
    }), 201