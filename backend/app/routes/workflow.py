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


def normalize_role(value):
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


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


def first_present(data, keys, default=None):
    for key in keys:
        if key in data and data.get(key) not in [None, ""]:
            return data.get(key)
    return default


def parse_number(value, default=0.0):
    if value in [None, ""]:
        return float(default)

    try:
        return float(value)
    except Exception:
        raise ValueError("Value must be a valid number")


def parse_non_negative_number(value, field_name, default=0.0):
    try:
        number = parse_number(value, default)
    except ValueError:
        raise ValueError(f"{field_name} must be a valid number")

    if number < 0:
        raise ValueError(f"{field_name} cannot be negative")

    return number


def current_tenant_id():
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id") or "sds"


def current_user_roles():
    roles = g.current_user.get("roles", [])

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

    role = normalize_role(g.current_user.get("role"))

    return {role} if role else set()


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
    return bool(roles.intersection({normalize_role(role) for role in allowed_roles}))


def employee_roles(employee):
    raw_roles = employee.get("roles", [])

    if isinstance(raw_roles, list):
        roles = {normalize_role(role) for role in raw_roles if normalize_role(role)}
    elif isinstance(raw_roles, str):
        roles = {normalize_role(role) for role in raw_roles.split(",") if normalize_role(role)}
    else:
        roles = set()

    raw_role = normalize_role(employee.get("role"))

    if raw_role:
        roles.add(raw_role)

    return roles


def employee_is_team_leader(employee):
    if not employee:
        return False

    return (
        truthy(employee.get("is_team_leader"))
        or "team_leader" in employee_roles(employee)
    )


def employee_is_reporting_officer(employee):
    if not employee:
        return False

    return (
        truthy(employee.get("is_reporting_officer"))
        or "reporting_officer" in employee_roles(employee)
        or "ro" in employee_roles(employee)
    )


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
    normalized_roles = list({normalize_role(role) for role in role_names})

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
        ("team_leader" in roles or employee_is_team_leader(reviewer_emp))
        and employee.get("team_leader_id") == reviewer_emp_id
    ):
        return True

    if (
        ("reporting_officer" in roles or employee_is_reporting_officer(reviewer_emp))
        and employee.get("reporting_officer_id") == reviewer_emp_id
    ):
        return True

    return False


# -----------------------------------------------------------------------------
# Live status helpers
# -----------------------------------------------------------------------------

def leave_stage_label(stage):
    labels = {
        "team_leader": "Team Leader",
        "reporting_officer": "Reporting Officer",
        "hr": "HR",
        "final": "Final Approval",
        "approved": "Approved",
        "rejected": "Rejected / Cancelled",
    }

    return labels.get(stage, stage or "Approval")


def leave_request_live_status(leave_doc):
    status = normalize_status(leave_doc.get("status"))
    stage = normalize_text(leave_doc.get("approval_stage"))
    team_leader_status = normalize_status(leave_doc.get("team_leader_status"))
    reporting_officer_status = normalize_status(leave_doc.get("reporting_officer_status"))
    hr_status = normalize_status(leave_doc.get("hr_status"))

    if status == "approved" or stage == "approved":
        if reporting_officer_status == "approved":
            return "Approved by Reporting Officer"
        if team_leader_status == "approved" and hr_status == "approved":
            return "Approved by Team Leader and HR"
        if hr_status == "approved":
            return "Approved by HR"
        return "Approved"

    if status == "rejected" or stage == "rejected":
        if team_leader_status == "rejected":
            return "Rejected by Team Leader"
        if reporting_officer_status == "rejected":
            return "Rejected by Reporting Officer"
        if hr_status == "rejected":
            return "Rejected by HR"
        return "Rejected / Cancelled"

    if stage == "team_leader":
        return "Pending with Team Leader"

    if stage == "reporting_officer":
        if team_leader_status == "approved":
            return "Approved by Team Leader, Pending with Reporting Officer"
        return "Pending with Reporting Officer"

    if stage == "hr":
        if reporting_officer_status == "approved":
            return "Approved by Reporting Officer, Pending HR Record"
        if team_leader_status == "approved":
            return "Approved by Team Leader, Pending HR Record"
        return "Pending with HR"

    return leave_stage_label(stage) if stage else "Pending"


def mode_request_live_status(item):
    status = normalize_status(item.get("status"))
    stage = normalize_text(item.get("approval_stage"))

    if status == "approved":
        return "Approved"

    if status == "rejected":
        return "Rejected / Cancelled"

    if stage == "team_leader":
        return "Pending with Team Leader"

    if stage == "reporting_officer":
        return "Pending with Reporting Officer"

    if stage == "hr":
        return "Pending with HR"

    return leave_stage_label(stage) if stage else status.title() if status else "Pending"


def enrich_leave_request_doc(item):
    item = dict(item or {})
    live_status = leave_request_live_status(item)
    item["live_status"] = live_status
    item["status_text"] = live_status
    item["status_display"] = live_status
    item["current_approval_stage"] = live_status
    item["approval_stage_label"] = item.get("approval_stage_label") or leave_stage_label(item.get("approval_stage"))
    item["leave_type_label"] = item.get("leave_type_label") or leave_type_label(item.get("leave_type"))
    item["approval_timeline"] = item.get("approval_history") or []

    team_leader_approved = (
        normalize_status(item.get("team_leader_status")) == "approved"
        or bool(item.get("approved_by_team_leader"))
        or bool(item.get("approved_by_team_leader_name"))
        or bool(item.get("team_leader_decision_by_name"))
    )
    reporting_officer_approved = (
        normalize_status(item.get("reporting_officer_status")) == "approved"
        or bool(item.get("approved_by_reporting_officer"))
        or bool(item.get("approved_by_reporting_officer_name"))
        or bool(item.get("reporting_officer_decision_by_name"))
    )
    hr_approved = (
        normalize_status(item.get("hr_status")) == "approved"
        or bool(item.get("approved_by_hr"))
        or bool(item.get("approved_by_hr_name"))
        or bool(item.get("hr_decision_by_name"))
    )

    item["approved_by_team_leader"] = team_leader_approved
    item["approved_by_team_leader_id"] = item.get("approved_by_team_leader") if isinstance(item.get("approved_by_team_leader"), str) else item.get("team_leader_decision_by", "")
    item["approved_by_team_leader_name"] = item.get("approved_by_team_leader_name") or item.get("team_leader_decision_by_name", "")
    item["approved_by_team_leader_at"] = item.get("approved_by_team_leader_at") or item.get("team_leader_decision_at", "")

    item["approved_by_reporting_officer"] = reporting_officer_approved
    item["approved_by_reporting_officer_id"] = item.get("approved_by_reporting_officer") if isinstance(item.get("approved_by_reporting_officer"), str) else item.get("reporting_officer_decision_by", "")
    item["approved_by_reporting_officer_name"] = item.get("approved_by_reporting_officer_name") or item.get("reporting_officer_decision_by_name", "")
    item["approved_by_reporting_officer_at"] = item.get("approved_by_reporting_officer_at") or item.get("reporting_officer_decision_at", "")

    item["approved_by_hr"] = hr_approved
    item["approved_by_hr_id"] = item.get("approved_by_hr") if isinstance(item.get("approved_by_hr"), str) else item.get("hr_decision_by", "")
    item["approved_by_hr_name"] = item.get("approved_by_hr_name") or item.get("hr_decision_by_name", "")
    item["approved_by_hr_at"] = item.get("approved_by_hr_at") or item.get("hr_decision_at", "")

    item["hr_notified"] = bool(item.get("hr_notified") or item.get("hr_record_notification_sent") or item.get("hr_notified_at"))
    item["hr_notified_status"] = item.get("hr_notified_status", "")

    if normalize_status(item.get("status")) == "rejected":
        item["rejected_by_role"] = item.get("rejected_by_role") or item.get("approval_stage") or ""
        if item.get("team_leader_decision_by_name") and normalize_status(item.get("team_leader_status")) == "rejected":
            item["rejected_by_role"] = "team_leader"
            item["rejected_by_name"] = item.get("team_leader_decision_by_name")
            item["rejected_at"] = item.get("team_leader_decision_at")
        elif item.get("reporting_officer_decision_by_name") and normalize_status(item.get("reporting_officer_status")) == "rejected":
            item["rejected_by_role"] = "reporting_officer"
            item["rejected_by_name"] = item.get("reporting_officer_decision_by_name")
            item["rejected_at"] = item.get("reporting_officer_decision_at")
        elif item.get("hr_decision_by_name") and normalize_status(item.get("hr_status")) == "rejected":
            item["rejected_by_role"] = "hr"
            item["rejected_by_name"] = item.get("hr_decision_by_name")
            item["rejected_at"] = item.get("hr_decision_at")

    return item

def enrich_leave_request_docs(items):
    return [enrich_leave_request_doc(item) for item in items]


def enrich_mode_request_doc(item):
    item = dict(item or {})
    live_status = mode_request_live_status(item)
    item["live_status"] = live_status
    item["status_text"] = live_status
    item["status_display"] = live_status
    item["current_approval_stage"] = live_status
    item["approval_stage_label"] = item.get("approval_stage_label") or leave_stage_label(item.get("approval_stage"))
    return item


def enrich_mode_request_docs(items):
    return [enrich_mode_request_doc(item) for item in items]


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
    """
    Correct leave approval entry stage:

    - Team Leader's own leave should never go back to Team Leader stage.
    - If no Team Leader is mapped, send directly to Reporting Officer.
    - If no Reporting Officer is mapped, send to HR.
    """

    applicant_is_team_leader = employee_is_team_leader(employee)

    if (
        employee.get("team_leader_id")
        and not applicant_is_team_leader
    ):
        return "team_leader"

    if employee.get("reporting_officer_id"):
        return "reporting_officer"

    return "hr"


def next_leave_stage(employee, current_stage, leave_doc=None):
    """
    Decide the next leave approval stage.

    Important two-step rule:
    - If the current stage is Team Leader and a Reporting Officer is mapped,
      the leave must remain pending and move to Reporting Officer.
    - If no Reporting Officer is mapped, move to HR.
    - Reporting Officer approval is final approval.
    - HR approval is final approval only when the leave directly reached HR.

    We check both the employee master and the leave document because older
    records may have the Reporting Officer saved on the leave request even if
    the employee master was later changed.
    """

    leave_doc = leave_doc or {}
    current_stage = normalize_text(current_stage)

    reporting_officer_id = (
        normalize_text(leave_doc.get("reporting_officer_id"))
        or normalize_text(employee.get("reporting_officer_id") if employee else "")
    )

    if current_stage == "team_leader":
        return "reporting_officer" if reporting_officer_id else "hr"

    if current_stage == "reporting_officer":
        return "final"

    if current_stage == "hr":
        return "final"

    return "final"


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
                or employee_is_team_leader(reviewer_emp)
            )
        )

    if stage == "reporting_officer":
        return (
            leave_doc.get("reporting_officer_id") == reviewer_emp_id
            and (
                "reporting_officer" in roles
                or "ro" in roles
                or employee_is_reporting_officer(reviewer_emp)
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

    if "team_leader" in roles or employee_is_team_leader(reviewer_emp):
        scope_or.append({
            "team_leader_id": reviewer_emp_id,
            "approval_stage": "team_leader",
        })

    if "reporting_officer" in roles or "ro" in roles or employee_is_reporting_officer(reviewer_emp):
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


def leave_balance_payload_for_type(data, leave_type):
    leave_type = normalize_leave_type(leave_type)

    if leave_type == "CL":
        nested = (
            data.get("CL")
            if isinstance(data.get("CL"), dict)
            else data.get("cl")
            if isinstance(data.get("cl"), dict)
            else data.get("casual_leave")
            if isinstance(data.get("casual_leave"), dict)
            else {}
        )
        raw_total = first_present(data, ["CL", "cl", "casual_leave"], None)
        prefixes = ["cl", "casual", "casual_leave"]
    else:
        nested = (
            data.get("EL")
            if isinstance(data.get("EL"), dict)
            else data.get("el")
            if isinstance(data.get("el"), dict)
            else data.get("earned_leave")
            if isinstance(data.get("earned_leave"), dict)
            else {}
        )
        raw_total = first_present(data, ["EL", "el", "earned_leave"], None)
        prefixes = ["el", "earned", "earned_leave"]

    payload = {}

    if isinstance(raw_total, (int, float, str)) and normalize_text(raw_total) != "":
        payload["opening_balance"] = raw_total
        payload["credited"] = 0

    if isinstance(nested, dict):
        payload.update(nested)

    opening_keys = []
    credited_keys = []
    used_keys = []
    available_keys = []
    status_keys = []

    for prefix in prefixes:
        opening_keys.extend([
            f"{prefix}_opening_balance",
            f"{prefix}_opening",
            f"{prefix}_balance",
        ])
        credited_keys.extend([
            f"{prefix}_credited",
            f"{prefix}_credit",
        ])
        used_keys.extend([
            f"{prefix}_used",
            f"{prefix}_used_leave",
        ])
        available_keys.extend([
            f"{prefix}_available",
            f"{prefix}_available_leave",
        ])
        status_keys.append(f"{prefix}_status")

    for source_key, target_key in [
        (opening_keys, "opening_balance"),
        (credited_keys, "credited"),
        (used_keys, "used"),
        (available_keys, "available"),
        (status_keys, "status"),
    ]:
        value = first_present(data, source_key, None)
        if value not in [None, ""]:
            payload[target_key] = value

    return payload


def upsert_leave_balance_from_payload(db, employee, leave_type, payload):
    leave_type = normalize_leave_type(leave_type)

    if leave_type not in LEAVE_TYPES_WITH_BALANCE:
        raise ValueError("Unsupported leave type")

    existing = ensure_leave_balance(db, employee, leave_type)
    now = datetime.utcnow()

    opening_balance = parse_non_negative_number(
        payload.get("opening_balance", existing.get("opening_balance", 0)),
        f"{leave_type_label(leave_type)} opening balance",
        existing.get("opening_balance", 0),
    )
    credited = parse_non_negative_number(
        payload.get("credited", existing.get("credited", 0)),
        f"{leave_type_label(leave_type)} credited",
        existing.get("credited", 0),
    )
    used = parse_non_negative_number(
        payload.get("used", existing.get("used", 0)),
        f"{leave_type_label(leave_type)} used",
        existing.get("used", 0),
    )

    calculated_available = max(opening_balance + credited - used, 0)

    if payload.get("available") not in [None, ""]:
        available = parse_non_negative_number(
            payload.get("available"),
            f"{leave_type_label(leave_type)} available",
            calculated_available,
        )
    else:
        available = calculated_available

    status = normalize_text(payload.get("status") or existing.get("status") or "active").lower()

    db.leave_balances.update_one(
        {"_id": existing["_id"]},
        {
            "$set": {
                "tenant_id": employee.get("tenant_id") or current_tenant_id(),
                "employee_id": str(employee["_id"]),
                "employee_code": employee_code(employee),
                "emp_code": employee.get("emp_code", ""),
                "employee_name": employee_display_name(employee),
                "department": employee.get("department", ""),
                "designation": employee.get("designation", ""),
                "leave_type": leave_type,
                "leave_type_label": leave_type_label(leave_type),
                "opening_balance": opening_balance,
                "credited": credited,
                "used": used,
                "available": available,
                "status": status or "active",
                "updated_at": now,
                "updated_by": str(g.current_user["_id"]),
                "updated_by_name": g.current_user.get("name") or g.current_user.get("email"),
            },
            "$setOnInsert": {
                "created_at": now,
            },
        },
    )

    return db.leave_balances.find_one({"_id": existing["_id"]})


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
    roles = sorted(list(current_user_roles()))
    actor_id = str(g.current_user["_id"])
    actor_name = g.current_user.get("name") or g.current_user.get("email")
    created_at = datetime.utcnow()
    role_label = leave_stage_label(stage)

    return {
        "stage": stage,
        "stage_label": role_label,
        "status": status,
        "action": status,
        "decision": status,
        "note": note,
        "reason": note,
        "user_id": actor_id,
        "approver_id": actor_id,
        "approved_by_id": actor_id if status == "approved" else "",
        "rejected_by_id": actor_id if status == "rejected" else "",
        "by": actor_id,
        "by_name": actor_name,
        "name": actor_name,
        "approver_name": actor_name,
        "approved_by_name": actor_name if status == "approved" else "",
        "rejected_by_name": actor_name if status == "rejected" else "",
        "by_role": role_label,
        "role": stage,
        "approver_role": stage,
        "approved_by_role": stage if status == "approved" else "",
        "rejected_by_role": stage if status == "rejected" else "",
        "actor_roles": roles,
        "created_at": created_at,
        "at": created_at,
        "approved_at": created_at if status == "approved" else "",
        "rejected_at": created_at if status == "rejected" else "",
    }

def notify_next_leave_approvers(db, employee, leave_doc, stage):
    tenant_id = employee.get("tenant_id") or leave_doc.get("tenant_id") or current_tenant_id()
    user_ids = []

    # Prefer the approver mapping saved on the leave request, then fallback to
    # the current employee master. This prevents the Team Leader approval from
    # getting stuck if mappings changed after the leave was applied.
    team_leader_id = normalize_text(leave_doc.get("team_leader_id")) or normalize_text(employee.get("team_leader_id"))
    reporting_officer_id = normalize_text(leave_doc.get("reporting_officer_id")) or normalize_text(employee.get("reporting_officer_id"))

    if stage == "team_leader":
        user_ids.append(employee_user_id(db, team_leader_id, tenant_id))
    elif stage == "reporting_officer":
        user_ids.append(employee_user_id(db, reporting_officer_id, tenant_id))
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
            "target": "team_approvals",
            "page": "team_approvals",
            "leave_request_id": str(leave_doc.get("_id")),
            "employee_id": str(employee.get("_id")),
            "stage": stage,
            "approval_stage": stage,
            "pending_approver_role": stage,
            "status": "pending",
        },
        tenant_id=tenant_id,
    )

def notify_employee_leave_decision(db, employee, leave_doc, status):
    status_text = "approved" if status == "approved" else "rejected/cancelled"

    notify_users(
        db,
        [employee.get("user_id")],
        "Leave Request Updated",
        f"Your leave request has been {status_text}.",
        {
            "target": "application_status",
            "leave_request_id": str(leave_doc.get("_id")),
            "status": status,
        },
        tenant_id=employee.get("tenant_id") or current_tenant_id(),
    )


def notify_hr_leave_result(db, employee, leave_doc, status):
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    user_ids = users_for_roles(db, ADMIN_HR_ROLES, tenant_id)

    if not user_ids:
        return

    status_text = "approved" if status == "approved" else "rejected/cancelled"
    from_date = leave_doc.get("from_date") or ""
    to_date = leave_doc.get("to_date") or leave_doc.get("upto_date") or ""
    team_leader_name = leave_doc.get("team_leader_decision_by_name") or leave_doc.get("approved_by_team_leader_name") or leave_doc.get("team_leader_name") or "Not applicable"
    reporting_officer_name = leave_doc.get("reporting_officer_decision_by_name") or leave_doc.get("approved_by_reporting_officer_name") or leave_doc.get("reporting_officer_name") or "Not applicable"

    notify_users(
        db,
        user_ids,
        "Leave Record Update",
        (
            f"{employee_display_name(employee)}'s leave from {from_date} to {to_date} has been {status_text}. "
            f"Team Leader: {team_leader_name}. Reporting Officer: {reporting_officer_name}."
        ),
        {
            "target": "team_approvals",
            "page": "team_approvals",
            "leave_request_id": str(leave_doc.get("_id")),
            "employee_id": str(employee.get("_id")),
            "from_date": from_date,
            "to_date": to_date,
            "team_leader_name": team_leader_name,
            "reporting_officer_name": reporting_officer_name,
            "status": status,
            "hr_record": True,
            "record_only": True,
        },
        tenant_id=tenant_id,
    )

    db.leave_requests.update_one(
        {"_id": leave_doc.get("_id")},
        {
            "$set": {
                "hr_notified": True,
                "hr_notified_status": "notified",
                "hr_notified_at": datetime.utcnow(),
                "hr_record_notification_sent": True,
            }
        },
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
        "hr_notified_status": "not_notified",
        "hr_notified_at": "",
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

    fields = {
        f"{prefix}_status": status,
        f"{prefix}_decision_note": note,
        f"{prefix}_decision_by": actor_id,
        f"{prefix}_decision_by_name": actor_name,
        f"{prefix}_decision_at": now,
    }

    if status == "approved":
        fields[f"approved_by_{prefix}"] = actor_id
        fields[f"approved_by_{prefix}_name"] = actor_name
        fields[f"approved_by_{prefix}_at"] = now
    elif status == "rejected":
        fields[f"rejected_by_{prefix}"] = actor_id
        fields[f"rejected_by_{prefix}_name"] = actor_name
        fields[f"rejected_by_{prefix}_at"] = now

    return fields


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

    if "team_leader" in roles or employee_is_team_leader(employee):
        scope_or.append({
            "team_leader_id": emp_id,
            "approval_stage": "team_leader",
        })

    if "reporting_officer" in roles or "ro" in roles or employee_is_reporting_officer(employee):
        scope_or.append({
            "reporting_officer_id": emp_id,
            "approval_stage": "reporting_officer",
        })

    q["$or"] = scope_or
    return q


# -----------------------------------------------------------------------------
# Notification APIs
# -----------------------------------------------------------------------------

@workflow_bp.get("/notifications")
@current_user_required
def list_notifications():
    db = get_db()
    only_unread = truthy(request.args.get("unread"))
    limit_raw = request.args.get("limit", 50)

    try:
        limit = min(max(int(limit_raw), 1), 100)
    except Exception:
        limit = 50

    q = {
        "tenant_id": current_tenant_id(),
        "user_id": str(g.current_user["_id"]),
        "is_deleted": {"$ne": True},
    }

    if only_unread:
        q["read"] = {"$ne": True}

    items = list(
        db.notifications
        .find(q)
        .sort("created_at", -1)
        .limit(limit)
    )

    unread_count = db.notifications.count_documents({
        "tenant_id": current_tenant_id(),
        "user_id": str(g.current_user["_id"]),
        "read": {"$ne": True},
        "is_deleted": {"$ne": True},
    })

    return jsonify({
        "items": clean_doc(items),
        "unread_count": unread_count,
    })


@workflow_bp.patch("/notifications/<notification_id>/read")
@current_user_required
def mark_notification_read(notification_id):
    notification_obj_id = safe_object_id(notification_id)

    if not notification_obj_id:
        return jsonify({"message": "Invalid notification id"}), 400

    db = get_db()

    db.notifications.update_one(
        {
            "_id": notification_obj_id,
            "tenant_id": current_tenant_id(),
            "user_id": str(g.current_user["_id"]),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "read": True,
                "status": "read",
                "read_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            }
        },
    )

    return jsonify({"message": "Notification marked as read"})


@workflow_bp.patch("/notifications/read_all")
@current_user_required
def mark_all_notifications_read():
    db = get_db()

    db.notifications.update_many(
        {
            "tenant_id": current_tenant_id(),
            "user_id": str(g.current_user["_id"]),
            "read": {"$ne": True},
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "read": True,
                "status": "read",
                "read_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            }
        },
    )

    return jsonify({"message": "All notifications marked as read"})


# -----------------------------------------------------------------------------
# Team Leader / Reporting Officer approval inbox
# -----------------------------------------------------------------------------

@workflow_bp.get("/team_approvals")
@current_user_required
def team_approvals():
    db = get_db()
    roles = current_user_roles()
    employee = current_employee(db)
    is_admin_hr = bool(roles.intersection(ADMIN_HR_ROLES))
    is_team_leader = bool(employee and ("team_leader" in roles or employee_is_team_leader(employee)))
    is_reporting_officer = bool(employee and ("reporting_officer" in roles or "ro" in roles or employee_is_reporting_officer(employee)))

    if not (is_admin_hr or is_team_leader or is_reporting_officer):
        return jsonify({"message": "Only Team Leaders, Reporting Officers and HR/Admin can access approvals"}), 403

    status_filter = normalize_status(request.args.get("status") or "pending")
    if status_filter not in ["pending", "approved", "rejected", "all", ""]:
        status_filter = "pending"

    tenant_id = current_tenant_id()
    emp_id = str(employee["_id"]) if employee else ""
    approval_or = []

    def add_team_leader_scope():
        if not emp_id:
            return
        if status_filter in ["", "pending"]:
            approval_or.append({
                "team_leader_id": emp_id,
                "approval_stage": "team_leader",
                "status": {"$in": ["pending", "in_review"]},
            })
        elif status_filter == "approved":
            approval_or.append({
                "team_leader_id": emp_id,
                "team_leader_status": "approved",
            })
        elif status_filter == "rejected":
            approval_or.append({
                "team_leader_id": emp_id,
                "team_leader_status": "rejected",
            })
        elif status_filter == "all":
            approval_or.append({"team_leader_id": emp_id})

    def add_reporting_officer_scope():
        if not emp_id:
            return
        if status_filter in ["", "pending"]:
            approval_or.append({
                "reporting_officer_id": emp_id,
                "approval_stage": "reporting_officer",
                "status": {"$in": ["pending", "in_review"]},
            })
        elif status_filter == "approved":
            approval_or.append({
                "reporting_officer_id": emp_id,
                "reporting_officer_status": "approved",
            })
        elif status_filter == "rejected":
            approval_or.append({
                "reporting_officer_id": emp_id,
                "reporting_officer_status": "rejected",
            })
        elif status_filter == "all":
            approval_or.append({"reporting_officer_id": emp_id})

    def add_hr_scope():
        if status_filter in ["", "pending"]:
            approval_or.append({
                "approval_stage": "hr",
                "status": {"$in": ["pending", "in_review"]},
            })
        elif status_filter == "approved":
            approval_or.append({"status": "approved"})
        elif status_filter == "rejected":
            approval_or.append({"status": "rejected"})
        elif status_filter == "all":
            approval_or.append({
                "status": {"$in": ["pending", "in_review", "approved", "rejected"]},
            })

    if is_team_leader:
        add_team_leader_scope()

    if is_reporting_officer:
        add_reporting_officer_scope()

    if is_admin_hr:
        add_hr_scope()

    if not approval_or:
        return jsonify({
            "employee": clean_doc(employee) if employee else None,
            "summary": {
                "total": 0,
                "pending": 0,
                "approved": 0,
                "rejected": 0,
                "pending_leave_requests": 0,
            },
            "leave_requests": [],
            "items": [],
        })

    q = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": approval_or,
    }

    items = list(
        db.leave_requests
        .find(q)
        .sort([("updated_at", -1), ("from_date", -1), ("created_at", -1)])
        .limit(500)
    )

    enriched_items = enrich_leave_request_docs(items)

    summary = {
        "total": len(enriched_items),
        "pending": len([item for item in enriched_items if normalize_status(item.get("status")) in ["pending", "in_review"]]),
        "approved": len([item for item in enriched_items if normalize_status(item.get("status")) == "approved"]),
        "rejected": len([item for item in enriched_items if normalize_status(item.get("status")) == "rejected"]),
        "pending_leave_requests": len([item for item in enriched_items if normalize_status(item.get("status")) in ["pending", "in_review"]]),
        "team_leader_stage": len([item for item in enriched_items if item.get("approval_stage") == "team_leader"]),
        "reporting_officer_stage": len([item for item in enriched_items if item.get("approval_stage") == "reporting_officer"]),
        "hr_stage": len([item for item in enriched_items if item.get("approval_stage") == "hr"]),
    }

    return jsonify({
        "employee": clean_doc(employee) if employee else None,
        "summary": summary,
        "leave_requests": clean_doc(enriched_items),
        "items": clean_doc(enriched_items),
    })


@workflow_bp.patch("/team_approvals/leave_requests/<req_id>/decision")
@current_user_required
def team_leave_decision(req_id):
    return leave_decision(req_id)


# -----------------------------------------------------------------------------
# Application status API
# -----------------------------------------------------------------------------

@workflow_bp.get("/application_status")
@current_user_required
def application_status():
    db = get_db()
    employee = current_employee(db)
    tenant_id = current_tenant_id()
    user_id = str(g.current_user["_id"])

    if not employee:
        return jsonify({
            "employee": None,
            "summary": {
                "total": 0,
                "pending": 0,
                "approved": 0,
                "rejected": 0,
            },
            "leave_requests": [],
            "attendance_mode_requests": [],
            "password_requests": [],
            "tickets": [],
            "compoff_claims": [],
            "notifications": [],
        })

    emp_id = str(employee["_id"])

    leave_requests = list(
        db.leave_requests
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(100)
    )

    attendance_mode_requests = list(
        db.attendance_mode_requests
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(100)
    )

    password_requests = list(
        db.password_requests
        .find({
            "tenant_id": tenant_id,
            "$or": [
                {"user_id": user_id},
                {"employee_id": emp_id},
                {"requested_by": user_id},
            ],
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(50)
    )

    tickets = list(
        db.tickets
        .find({
            "tenant_id": tenant_id,
            "$or": [
                {"raised_by": emp_id},
                {"user_id": user_id},
                {"created_by": user_id},
            ],
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(50)
    )

    compoff_claims = list(
        db.compoff_credits
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(50)
    )

    notifications = list(
        db.notifications
        .find({
            "tenant_id": tenant_id,
            "user_id": user_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(30)
    )

    enriched_leaves = enrich_leave_request_docs(leave_requests)
    enriched_modes = enrich_mode_request_docs(attendance_mode_requests)

    all_status_rows = []

    for row in enriched_leaves:
        all_status_rows.append({
            "type": "Leave Request",
            "title": row.get("leave_type_label") or leave_type_label(row.get("leave_type")),
            "date": row.get("from_date"),
            "from_date": row.get("from_date"),
            "to_date": row.get("to_date") or row.get("upto_date"),
            "status": row.get("status"),
            "live_status": row.get("live_status"),
            "approval_stage": row.get("approval_stage"),
            "approval_stage_label": row.get("approval_stage_label"),
            "approval_history": row.get("approval_history", []),
            "team_leader_name": row.get("team_leader_name", ""),
            "reporting_officer_name": row.get("reporting_officer_name", ""),
            "approved_by_team_leader": row.get("team_leader_decision_by_name", ""),
            "approved_by_reporting_officer": row.get("reporting_officer_decision_by_name", ""),
            "hr_notified_status": row.get("hr_notified_status", ""),
        })

    for row in enriched_modes:
        all_status_rows.append({
            "type": "WFH / Field Request",
            "title": row.get("mode", ""),
            "date": row.get("date"),
            "status": row.get("status"),
            "live_status": row.get("live_status"),
        })

    for row in password_requests:
        status = normalize_status(row.get("status"))
        all_status_rows.append({
            "type": "Password Change Request",
            "title": "Password Change",
            "date": row.get("created_at"),
            "status": status,
            "live_status": "Approved" if status == "approved" else "Rejected / Cancelled" if status == "rejected" else "Pending with Super Admin",
        })

    for row in tickets:
        status = normalize_status(row.get("status"))
        all_status_rows.append({
            "type": "Ticket / Grievance",
            "title": row.get("title", "Ticket"),
            "date": row.get("created_at"),
            "status": status,
            "live_status": status.replace("_", " ").title() if status else "Open",
        })

    for row in compoff_claims:
        status = normalize_status(row.get("status"))
        all_status_rows.append({
            "type": "Comp-Off",
            "title": row.get("holiday_title", "Comp-Off"),
            "date": row.get("earned_date"),
            "status": status,
            "live_status": status.replace("_", " ").title() if status else "Available",
        })

    summary = {
        "total": len(all_status_rows),
        "pending": len([
            row for row in all_status_rows
            if "pending" in normalize_text(row.get("live_status")).lower()
            or normalize_status(row.get("status")) in ["pending", "open", "in_review", "in_progress"]
        ]),
        "approved": len([
            row for row in all_status_rows
            if normalize_status(row.get("status")) in ["approved", "resolved", "closed", "claimed"]
        ]),
        "rejected": len([
            row for row in all_status_rows
            if normalize_status(row.get("status")) in ["rejected", "cancelled", "expired"]
        ]),
    }

    return jsonify({
        "employee": clean_doc(employee),
        "summary": summary,
        "items": clean_doc(all_status_rows),
        "leave_requests": clean_doc(enriched_leaves),
        "attendance_mode_requests": clean_doc(enriched_modes),
        "password_requests": clean_doc(password_requests),
        "tickets": clean_doc(tickets),
        "compoff_claims": clean_doc(compoff_claims),
        "notifications": clean_doc(notifications),
    })


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


@workflow_bp.post("/leave_balances")
@roles_required(*LEAVE_BALANCE_MANAGER_ROLES)
def create_or_update_leave_balances():
    data = request.get_json(silent=True) or {}
    employee_id = normalize_text(data.get("employee_id") or data.get("employee") or data.get("user_id"))

    if not employee_id:
        return jsonify({"message": "employee_id is required"}), 400

    return set_leave_balance(employee_id)


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
    updated_items = []

    for leave_type in ["CL", "EL"]:
        payload = leave_balance_payload_for_type(data, leave_type)

        if not payload:
            continue

        try:
            updated_items.append(upsert_leave_balance_from_payload(db, employee, leave_type, payload))
        except ValueError as exc:
            return jsonify({"message": str(exc)}), 400

        updates.append(leave_type)

    if not updates:
        return jsonify({
            "message": "Send Casual Leave and/or Earned Leave balance details",
            "accepted_formats": [
                {"employee_id": employee_id, "cl_opening_balance": 8, "cl_credited": 0, "el_opening_balance": 32, "el_credited": 0},
                {"employee_id": employee_id, "casual_leave": {"opening_balance": 8, "credited": 0}, "earned_leave": {"opening_balance": 32, "credited": 0}},
            ],
        }), 400

    audit("set_leave_balance", "leave_balances", employee_id, data)

    items = list(db.leave_balances.find({
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "employee_id": str(employee_obj_id),
        "is_deleted": {"$ne": True},
    }).sort("leave_type", 1))

    return jsonify({
        "message": "Leave balances updated",
        "updated_types": updates,
        "items": clean_doc(items),
        "updated_items": clean_doc(updated_items),
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

    return jsonify({"items": clean_doc(enrich_leave_request_docs(items))})


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

    if initial_stage == "team_leader":
        response_message = "Your request has been sent to your Team Leader for approval."
    elif initial_stage == "reporting_officer":
        response_message = "Your request has been sent to your Reporting Officer for approval."
    else:
        response_message = "Your request has been sent to HR for approval."

    return jsonify({
        "message": response_message,
        "item": clean_doc(enrich_leave_request_doc(doc)),
    }), 201


@workflow_bp.patch("/leave_requests/<req_id>/decision")
@current_user_required
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
            "approval_stage_label": "Rejected / Cancelled",
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
        notify_hr_leave_result(db, employee, updated, "rejected")
        updated = db.leave_requests.find_one({"_id": leave_obj_id})
        audit("reject_leave_cancelled", "leave_requests", req_id, data)

        return jsonify({
            "message": "Leave rejected/cancelled",
            "item": clean_doc(enrich_leave_request_doc(updated)),
        })

    next_stage = next_leave_stage(employee, current_stage, existing)
    current_stage_fields = approval_stage_update_fields(current_stage, "approved", note)

    if next_stage != "final":
        # This is the critical two-step leave approval fix.
        # Team Leader approval must NOT final-approve the leave when a Reporting
        # Officer exists. It must keep status pending and move the request to
        # approval_stage="reporting_officer" so the RO can see it in Team Approvals.
        next_pending_fields = {}

        if next_stage == "reporting_officer":
            next_pending_fields.update({
                "reporting_officer_status": "pending",
                "hr_status": existing.get("hr_status") or "view_only",
            })
        elif next_stage == "hr":
            next_pending_fields.update({
                "hr_status": "pending",
            })

        update_set = {
            "status": "pending",
            "approval_stage": next_stage,
            "approval_stage_label": leave_stage_label(next_stage),
            "live_status": (
                "Approved by Team Leader, Pending with Reporting Officer"
                if current_stage == "team_leader" and next_stage == "reporting_officer"
                else f"Pending with {leave_stage_label(next_stage)}"
            ),
            "status_text": (
                "Approved by Team Leader, Pending with Reporting Officer"
                if current_stage == "team_leader" and next_stage == "reporting_officer"
                else f"Pending with {leave_stage_label(next_stage)}"
            ),
            "status_display": (
                "Approved by Team Leader, Pending with Reporting Officer"
                if current_stage == "team_leader" and next_stage == "reporting_officer"
                else f"Pending with {leave_stage_label(next_stage)}"
            ),
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
            "item": clean_doc(enrich_leave_request_doc(updated)),
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
    notify_hr_leave_result(db, employee, updated, "approved")
    updated = db.leave_requests.find_one({"_id": leave_obj_id})
    audit("approve_leave_final", "leave_requests", req_id, data)

    return jsonify({
        "message": "Leave approved",
        "item": clean_doc(enrich_leave_request_doc(updated)),
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


# -----------------------------------------------------------------------------
# Performance review helpers
# -----------------------------------------------------------------------------

def resolve_performance_review_scope(reviewer_emp, reviewer_roles, employee):
    if not reviewer_emp:
        return None, "", "Reviewer employee profile was not found"

    reviewer_emp_id = str(reviewer_emp["_id"])
    reviewed_is_team_leader = employee_is_team_leader(employee)
    reviewed_is_reporting_officer = employee_is_reporting_officer(employee)

    if (
        ("team_leader" in reviewer_roles or employee_is_team_leader(reviewer_emp))
        and employee.get("team_leader_id") == reviewer_emp_id
    ):
        return {
            "reviewer_role": "team_leader",
            "review_target_type": "team_member",
            "review_scope_label": "Team Leader to Team Member",
            "reviewed_employee_is_team_leader": reviewed_is_team_leader,
            "reviewed_employee_is_reporting_officer": reviewed_is_reporting_officer,
            "visibility": [
                "employee_self",
                "team_leader_dashboard",
                "reporting_officer_dashboard",
                "hr",
                "md",
            ],
        }, "", ""

    if (
        ("reporting_officer" in reviewer_roles or "ro" in reviewer_roles or employee_is_reporting_officer(reviewer_emp))
        and employee.get("reporting_officer_id") == reviewer_emp_id
    ):
        if reviewed_is_team_leader:
            review_target_type = "team_leader"
            review_scope_label = "Reporting Officer to Team Leader"
        else:
            review_target_type = "reporting_member"
            review_scope_label = "Reporting Officer to Reporting Member"

        return {
            "reviewer_role": "reporting_officer",
            "review_target_type": review_target_type,
            "review_scope_label": review_scope_label,
            "reviewed_employee_is_team_leader": reviewed_is_team_leader,
            "reviewed_employee_is_reporting_officer": reviewed_is_reporting_officer,
            "visibility": [
                "employee_self",
                "team_leader_dashboard",
                "reporting_officer_dashboard",
                "hr",
                "md",
            ],
        }, "", ""

    return None, "", "You can review only employees or team leaders directly mapped under you"


def notify_performance_review_submitted(db, employee, reviewer_emp, review):
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    notify_ids = []

    if employee.get("user_id"):
        notify_ids.append(employee.get("user_id"))

    if employee.get("reporting_officer_id"):
        reporting_user_id = employee_user_id(db, employee.get("reporting_officer_id"), tenant_id)
        if reporting_user_id:
            notify_ids.append(reporting_user_id)

    if employee.get("team_leader_id"):
        team_leader_user_id = employee_user_id(db, employee.get("team_leader_id"), tenant_id)
        if team_leader_user_id:
            notify_ids.append(team_leader_user_id)

    notify_ids.extend(users_for_roles(db, ADMIN_HR_ROLES, tenant_id))

    reviewer_name = (
        employee_display_name(reviewer_emp)
        if reviewer_emp
        else g.current_user.get("name") or g.current_user.get("email")
    )

    notify_users(
        db,
        notify_ids,
        "Performance Review Submitted",
        f"{reviewer_name} submitted a performance review for {employee_display_name(employee)}.",
        {
            "target": "performance_reviews",
            "performance_review_id": str(review.get("_id", "")),
            "employee_id": str(employee.get("_id")),
            "reviewer_employee_id": review.get("reviewer_employee_id", ""),
            "reviewer_role": review.get("reviewer_role", ""),
            "review_target_type": review.get("review_target_type", ""),
            "rating": review.get("rating"),
            "cycle": review.get("cycle"),
        },
        tenant_id=tenant_id,
    )


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

    employee_id = normalize_text(data.get("employee_id"))
    rating = data.get("rating")
    comments = normalize_text(data.get("comments", ""))
    cycle = normalize_text(data.get("cycle")) or datetime.utcnow().strftime("%B %Y")

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

    reviewer_role = "admin_hr"
    review_target_type = "admin_review"
    review_scope_label = "Admin / HR Review"
    reviewed_employee_is_team_leader = employee_is_team_leader(employee)
    reviewed_employee_is_reporting_officer = employee_is_reporting_officer(employee)
    visibility = ["md", "hr", "employee_self"]

    if not roles.intersection(ADMIN_HR_ROLES):
        scope_payload, _, scope_error = resolve_performance_review_scope(
            reviewer_emp,
            roles,
            employee,
        )

        if scope_error:
            return jsonify({"message": scope_error}), 403

        reviewer_role = scope_payload["reviewer_role"]
        review_target_type = scope_payload["review_target_type"]
        review_scope_label = scope_payload["review_scope_label"]
        reviewed_employee_is_team_leader = scope_payload["reviewed_employee_is_team_leader"]
        reviewed_employee_is_reporting_officer = scope_payload["reviewed_employee_is_reporting_officer"]
        visibility = scope_payload["visibility"]
    else:
        if reviewer_emp:
            reviewer_scope_payload, _, _ = resolve_performance_review_scope(
                reviewer_emp,
                roles,
                employee,
            )

            if reviewer_scope_payload:
                reviewer_role = reviewer_scope_payload["reviewer_role"]
                review_target_type = reviewer_scope_payload["review_target_type"]
                review_scope_label = reviewer_scope_payload["review_scope_label"]
                visibility = list(set(visibility + reviewer_scope_payload["visibility"]))

    review = {
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "employee_name": employee_display_name(employee),
        "employee_user_id": employee.get("user_id", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
        "cycle": cycle,
        "rating": rating,
        "comments": comments,
        "reviewer_id": str(g.current_user["_id"]),
        "reviewer_employee_id": reviewer_emp_id,
        "reviewer_employee_code": employee_code(reviewer_emp) if reviewer_emp else "",
        "reviewer_name": (
            employee_display_name(reviewer_emp)
            if reviewer_emp
            else g.current_user.get("name") or g.current_user.get("email")
        ),
        "reviewer_role": reviewer_role,
        "review_target_type": review_target_type,
        "review_scope_label": review_scope_label,
        "reviewed_employee_is_team_leader": reviewed_employee_is_team_leader,
        "reviewed_employee_is_reporting_officer": reviewed_employee_is_reporting_officer,
        "visibility": visibility,
        "status": "submitted",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "created_by": str(g.current_user["_id"]),
        "created_by_name": g.current_user.get("name") or g.current_user.get("email"),
    }

    res = db.performance_reviews.insert_one(review)
    review["_id"] = res.inserted_id

    notify_performance_review_submitted(db, employee, reviewer_emp, review)

    audit("create_performance_review", "performance_reviews", res.inserted_id, review)

    return jsonify({
        "message": "Performance review submitted",
        "item": clean_doc(review),
    }), 201