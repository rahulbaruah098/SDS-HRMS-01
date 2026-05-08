from flask import Blueprint, jsonify, g, request
from datetime import datetime, date, timedelta
from bson import ObjectId

from app.extensions import get_db
from app.utils.auth import roles_required
from app.utils.serializers import clean_doc


reports_bp = Blueprint("reports", __name__)


REPORT_COLLECTIONS = [
    "employees",
    "attendance_logs",
    "attendance_mode_requests",
    "holiday_calendar",
    "compoff_credits",
    "leave_balances",
    "leave_requests",
    "payroll_runs",
    "payslips",
    "job_openings",
    "candidates",
    "trainings",
    "performance_reviews",
    "expenses",
    "assets",
    "tickets",
    "notifications",
    "audit_logs",
]


REPORT_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "accounts_finance",
    "finance",
    "team_leader",
    "reporting_officer",
    "employee",
)


AUDIT_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
)


HR_ADMIN_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}


TEAM_CAPABILITY_ROLES = {
    "team_leader",
    "reporting_officer",
}


SELF_REPORT_COLLECTIONS = {
    "attendance_logs",
    "attendance_mode_requests",
    "compoff_credits",
    "leave_balances",
    "leave_requests",
    "payslips",
    "performance_reviews",
    "expenses",
}


ATTENDANCE_PRESENT_STATUSES = [
    "present",
    "late",
    "early_checkout",
    "holiday_work",
]


SUPPORTED_HOLIDAY_STATES = [
    "Assam(HO)",
    "Manipur",
    "Mizoram",
    "Arunachal Pradesh",
]


LEAVE_TYPE_ALIASES = {
    "CL": "CL",
    "CASUAL LEAVE": "CL",
    "CASUAL": "CL",
    "CASUAL_LEAVE": "CL",
    "EL": "EL",
    "EARNED LEAVE": "EL",
    "EARNED": "EL",
    "EARNED_LEAVE": "EL",
    "COMP OFF": "COMP-OFF",
    "COMPOFF": "COMP-OFF",
    "COMP-OFF": "COMP-OFF",
    "COMPENSATORY LEAVE": "COMP-OFF",
    "COMPENSATORY OFF": "COMP-OFF",
}


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


def normalize_state(value):
    state = normalize_text(value)

    if not state:
        return "Assam(HO)"

    lowered = state.lower()

    if lowered in [
        "assam",
        "assam ho",
        "assam(ho)",
        "ho",
        "assam/guwahati (ho)",
    ]:
        return "Assam(HO)"

    for allowed in SUPPORTED_HOLIDAY_STATES:
        if lowered == allowed.lower():
            return allowed

    return state


def normalize_roles(value):
    if not value:
        return []

    if isinstance(value, list):
        return [str(role).strip() for role in value if str(role).strip()]

    if isinstance(value, str):
        return [role.strip() for role in value.split(",") if role.strip()]

    return []


def normalize_leave_type(value):
    key = normalize_text(value).upper()
    return LEAVE_TYPE_ALIASES.get(key, key)


def leave_type_label(value):
    leave_type = normalize_leave_type(value)

    labels = {
        "CL": "Casual Leave",
        "EL": "Earned Leave",
        "COMP-OFF": "Comp-Off",
    }

    return labels.get(leave_type, normalize_text(value) or "Leave")


def leave_stage_label(stage):
    labels = {
        "team_leader": "Team Leader",
        "reporting_officer": "Reporting Officer",
        "hr": "HR",
        "final": "Final Approval",
        "approved": "Approved",
        "rejected": "Rejected",
    }

    return labels.get(normalize_text(stage), normalize_text(stage) or "Approval")


def leave_live_status(row):
    status = normalize_text(row.get("status")).lower()
    stage = normalize_text(row.get("approval_stage")).lower()

    if status == "approved" or stage == "approved":
        return "Approved"

    if status == "rejected" or stage == "rejected":
        return "Rejected"

    if stage == "team_leader":
        return "Pending with Team Leader"

    if stage == "reporting_officer":
        return "Pending with Reporting Officer"

    if stage == "hr":
        return "Pending with HR"

    if status == "pending":
        return "Pending"

    return status.title() if status else "—"


def enrich_leave_request(row):
    row = dict(row or {})
    live_status = leave_live_status(row)
    leave_type = normalize_leave_type(row.get("leave_type") or row.get("leave_type_label"))

    row["leave_type"] = leave_type
    row["leave_type_label"] = row.get("leave_type_label") or leave_type_label(leave_type)
    row["live_status"] = live_status
    row["status_text"] = live_status
    row["status_display"] = live_status
    row["approval_stage_label"] = row.get("approval_stage_label") or leave_stage_label(row.get("approval_stage"))
    row["current_approval_stage"] = live_status
    row["deducted_from_balance"] = bool(row.get("balance_deducted"))

    return row


def enrich_leave_requests(rows):
    return [enrich_leave_request(row) for row in rows]


def truthy(value):
    return str(value or "").strip().lower() in ["true", "yes", "1", "on"]


def current_roles():
    return set(normalize_roles(g.current_user.get("roles", [])))


def current_tenant_id():
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id") or "sds"


def today_string():
    return date.today().isoformat()


def parse_date(value):
    try:
        return datetime.strptime(normalize_text(value), "%Y-%m-%d").date()
    except Exception:
        return None


def month_bounds(target):
    first = target.replace(day=1)

    if first.month == 12:
        next_month = first.replace(year=first.year + 1, month=1)
    else:
        next_month = first.replace(month=first.month + 1)

    last = next_month - timedelta(days=1)
    return first, last


def year_bounds(target):
    return date(target.year, 1, 1), date(target.year, 12, 31)


def resolve_date_range_from_request(default_period=""):
    date_from = parse_date(request.args.get("date_from"))
    date_to = parse_date(request.args.get("date_to"))

    if date_from or date_to:
        start = date_from or date_to
        end = date_to or date_from
        return start, end

    period = normalize_text(
        request.args.get("period")
        or request.args.get("range")
        or request.args.get("view")
        or default_period
    ).lower()

    target = (
        parse_date(request.args.get("on_date"))
        or parse_date(request.args.get("date"))
        or date.today()
    )

    if period in ["today", "day", "daily"]:
        return target, target

    if period in ["week", "weekly"]:
        start = target - timedelta(days=target.weekday())
        end = start + timedelta(days=6)
        return start, end

    if period in ["month", "monthly"]:
        return month_bounds(target)

    if period in ["year", "yearly"]:
        return year_bounds(target)

    return None, None


def build_report_query():
    roles = current_roles()
    tenant_arg = normalize_text(request.args.get("tenant_id"))

    if "super_admin" in roles:
        if tenant_arg:
            return {"tenant_id": tenant_arg}

        return {}

    return {"tenant_id": current_tenant_id()}


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


def employee_is_team_leader(employee):
    return truthy(employee.get("is_team_leader")) if employee else False


def employee_is_reporting_officer(employee):
    return truthy(employee.get("is_reporting_officer")) if employee else False


def scoped_employee_ids(db):
    roles = current_roles()

    if roles.intersection(HR_ADMIN_ROLES):
        return None

    employee = current_employee(db)

    if not employee:
        return []

    employee_id = str(employee["_id"])
    scope_or = []

    if "team_leader" in roles or employee_is_team_leader(employee):
        scope_or.append({"team_leader_id": employee_id})

    if "reporting_officer" in roles or employee_is_reporting_officer(employee):
        scope_or.append({"reporting_officer_id": employee_id})

    if not scope_or:
        return [employee_id]

    rows = list(
        db.employees.find({
            "tenant_id": employee.get("tenant_id") or current_tenant_id(),
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
            "$or": scope_or,
        })
    )

    ids = [str(row["_id"]) for row in rows]

    if employee_id not in ids:
        ids.append(employee_id)

    return ids


def apply_employee_scope(db, q, employee_field="employee_id"):
    roles = current_roles()

    if "super_admin" in roles or roles.intersection(HR_ADMIN_ROLES):
        return q

    ids = scoped_employee_ids(db)

    if ids is not None:
        q[employee_field] = {"$in": ids}

    return q


def add_date_filter(q, date_field="date", default_period=""):
    start, end = resolve_date_range_from_request(default_period)

    if start or end:
        q[date_field] = {}

        if start:
            q[date_field]["$gte"] = start.isoformat()

        if end:
            q[date_field]["$lte"] = end.isoformat()

    return q


def add_leave_overlap_date_filter(q):
    start, end = resolve_date_range_from_request()

    if start or end:
        start_str = start.isoformat() if start else "0000-01-01"
        end_str = end.isoformat() if end else "9999-12-31"

        q["from_date"] = {"$lte": end_str}
        q["to_date"] = {"$gte": start_str}

    return q


def add_common_filters(q):
    status = normalize_text(request.args.get("status"))
    department = normalize_text(request.args.get("department"))
    mode = normalize_text(request.args.get("mode"))
    state = normalize_text(request.args.get("state"))
    employee_id = normalize_text(request.args.get("employee_id"))

    if status:
        q["status"] = status

    if department:
        q["department"] = department

    if mode:
        q["mode"] = mode

    if state:
        q["state"] = normalize_state(state)

    if employee_id:
        q["employee_id"] = employee_id

    return q


def with_not_deleted(q):
    q["is_deleted"] = {"$ne": True}
    return q


def collection_count(db, collection, base_query):
    q = dict(base_query)

    if collection != "audit_logs":
        q["is_deleted"] = {"$ne": True}

    return db[collection].count_documents(q)


def build_status_query(base_query, status):
    q = dict(base_query)
    q["status"] = status
    q["is_deleted"] = {"$ne": True}
    return q


def build_date_query(base_query, target_date):
    q = dict(base_query)
    q["date"] = target_date
    q["is_deleted"] = {"$ne": True}
    return q


def summarize_leave_requests(items):
    summary = {
        "total": len(items),
        "pending": 0,
        "approved": 0,
        "rejected": 0,
        "pending_with_team_leader": 0,
        "pending_with_reporting_officer": 0,
        "pending_with_hr": 0,
        "casual_leave": 0.0,
        "earned_leave": 0.0,
        "comp_off": 0.0,
        "total_days": 0.0,
        "deducted_days": 0.0,
        "not_deducted_days": 0.0,
    }

    for item in items:
        status = normalize_text(item.get("status")).lower()
        stage = normalize_text(item.get("approval_stage")).lower()
        leave_type = normalize_leave_type(item.get("leave_type"))
        days = float(item.get("leave_days", 0) or 0)

        if status in ["pending", "approved", "rejected"]:
            summary[status] += 1

        if status == "pending" and stage == "team_leader":
            summary["pending_with_team_leader"] += 1

        if status == "pending" and stage == "reporting_officer":
            summary["pending_with_reporting_officer"] += 1

        if status == "pending" and stage == "hr":
            summary["pending_with_hr"] += 1

        if leave_type == "CL":
            summary["casual_leave"] += days
        elif leave_type == "EL":
            summary["earned_leave"] += days
        elif leave_type == "COMP-OFF":
            summary["comp_off"] += days

        if item.get("balance_deducted"):
            summary["deducted_days"] += days
        else:
            summary["not_deducted_days"] += days

        summary["total_days"] += days

    return summary


def summarize_leave_balances(items):
    summary = {
        "employees": len({item.get("employee_id") for item in items if item.get("employee_id")}),
        "casual_opening": 0.0,
        "casual_credited": 0.0,
        "casual_used": 0.0,
        "casual_available": 0.0,
        "earned_opening": 0.0,
        "earned_credited": 0.0,
        "earned_used": 0.0,
        "earned_available": 0.0,
        "total_opening": 0.0,
        "total_credited": 0.0,
        "total_used_deducted": 0.0,
        "total_available": 0.0,
    }

    for item in items:
        leave_type = normalize_leave_type(item.get("leave_type") or item.get("leave_type_label"))
        opening = float(item.get("opening_balance", 0) or 0)
        credited = float(item.get("credited", 0) or 0)
        used = float(item.get("used", 0) or 0)
        available = float(item.get("available", 0) or 0)

        if leave_type == "CL":
            summary["casual_opening"] += opening
            summary["casual_credited"] += credited
            summary["casual_used"] += used
            summary["casual_available"] += available

        if leave_type == "EL":
            summary["earned_opening"] += opening
            summary["earned_credited"] += credited
            summary["earned_used"] += used
            summary["earned_available"] += available

        summary["total_opening"] += opening
        summary["total_credited"] += credited
        summary["total_used_deducted"] += used
        summary["total_available"] += available

    return summary


def enrich_leave_balance(row):
    row = dict(row or {})
    leave_type = normalize_leave_type(row.get("leave_type") or row.get("leave_type_label"))

    row["leave_type"] = leave_type
    row["leave_type_label"] = row.get("leave_type_label") or leave_type_label(leave_type)
    row["used_deducted"] = row.get("used", 0)
    row["available_balance"] = row.get("available", 0)

    return row


def enrich_leave_balances(rows):
    return [enrich_leave_balance(row) for row in rows]


def leave_type_options():
    return [
        {"value": "CL", "label": "Casual Leave"},
        {"value": "EL", "label": "Earned Leave"},
    ]


def scoped_collection_query_for_summary(db, collection, base_query):
    q = dict(base_query)

    if collection in SELF_REPORT_COLLECTIONS:
        q = apply_employee_scope(db, q, "employee_id")

    if collection == "employees":
        roles = current_roles()

        if not roles.intersection(HR_ADMIN_ROLES) and "super_admin" not in roles:
            ids = scoped_employee_ids(db)

            if ids is not None:
                object_ids = [safe_object_id(item) for item in ids]
                object_ids = [item for item in object_ids if item]
                q["_id"] = {"$in": object_ids}

    if collection == "notifications":
        roles = current_roles()

        if not roles.intersection(HR_ADMIN_ROLES) and "super_admin" not in roles:
            q["user_id"] = str(g.current_user["_id"])

    return q


# -----------------------------------------------------------------------------
# Reports APIs
# -----------------------------------------------------------------------------

@reports_bp.get("/summary")
@roles_required(*REPORT_ROLES)
def summary():
    db = get_db()
    base_q = build_report_query()

    counts = {}

    for collection in REPORT_COLLECTIONS:
        scoped_q = scoped_collection_query_for_summary(db, collection, base_q)
        counts[collection] = collection_count(db, collection, scoped_q)

    today = today_string()

    attendance_today_query = build_date_query(
        apply_employee_scope(db, dict(base_q), "employee_id"),
        today,
    )

    leave_pending_query = build_status_query(
        apply_employee_scope(db, dict(base_q), "employee_id"),
        "pending",
    )

    mode_pending_query = build_status_query(
        apply_employee_scope(db, dict(base_q), "employee_id"),
        "pending",
    )

    compoff_available_query = build_status_query(
        apply_employee_scope(db, dict(base_q), "employee_id"),
        "available",
    )

    leave_balance_query = with_not_deleted(
        apply_employee_scope(db, dict(base_q), "employee_id")
    )

    approved_deducted_leave_query = {
        **apply_employee_scope(db, dict(base_q), "employee_id"),
        "status": "approved",
        "balance_deducted": True,
        "is_deleted": {"$ne": True},
    }

    pending_with_team_leader_query = {
        **apply_employee_scope(db, dict(base_q), "employee_id"),
        "status": "pending",
        "approval_stage": "team_leader",
        "is_deleted": {"$ne": True},
    }

    pending_with_reporting_officer_query = {
        **apply_employee_scope(db, dict(base_q), "employee_id"),
        "status": "pending",
        "approval_stage": "reporting_officer",
        "is_deleted": {"$ne": True},
    }

    pending_with_hr_query = {
        **apply_employee_scope(db, dict(base_q), "employee_id"),
        "status": "pending",
        "approval_stage": "hr",
        "is_deleted": {"$ne": True},
    }

    holiday_today_query = dict(base_q)
    holiday_today_query["date"] = today
    holiday_today_query["status"] = {"$ne": "inactive"}
    holiday_today_query["is_deleted"] = {"$ne": True}

    balance_rows = list(db.leave_balances.find(leave_balance_query))
    balance_summary = summarize_leave_balances(balance_rows)

    extra = {
        "today": today,
        "attendance": {
            "present_today": db.attendance_logs.count_documents({
                **attendance_today_query,
                "status": {"$in": ATTENDANCE_PRESENT_STATUSES},
            }),
            "late_today": db.attendance_logs.count_documents({
                **attendance_today_query,
                "status": "late",
            }),
            "early_checkout_today": db.attendance_logs.count_documents({
                **attendance_today_query,
                "is_early_checkout": True,
            }),
            "holiday_work_today": db.attendance_logs.count_documents({
                **attendance_today_query,
                "is_holiday_work": True,
            }),
            "wfh_today": db.attendance_logs.count_documents({
                **attendance_today_query,
                "mode": "wfh",
            }),
            "field_today": db.attendance_logs.count_documents({
                **attendance_today_query,
                "mode": "field",
            }),
            "office_today": db.attendance_logs.count_documents({
                **attendance_today_query,
                "mode": "office",
            }),
        },
        "leave": {
            "pending_total": db.leave_requests.count_documents(leave_pending_query),
            "pending_with_team_leader": db.leave_requests.count_documents(pending_with_team_leader_query),
            "pending_with_reporting_officer": db.leave_requests.count_documents(pending_with_reporting_officer_query),
            "pending_with_hr": db.leave_requests.count_documents(pending_with_hr_query),
            "approved": db.leave_requests.count_documents({
                **apply_employee_scope(db, dict(base_q), "employee_id"),
                "status": "approved",
                "is_deleted": {"$ne": True},
            }),
            "rejected": db.leave_requests.count_documents({
                **apply_employee_scope(db, dict(base_q), "employee_id"),
                "status": "rejected",
                "is_deleted": {"$ne": True},
            }),
            "approved_and_deducted": db.leave_requests.count_documents(approved_deducted_leave_query),
            "balance_summary": balance_summary,
        },
        "pending": {
            "leave_requests": db.leave_requests.count_documents(leave_pending_query),
            "wfh_field_requests": db.attendance_mode_requests.count_documents(mode_pending_query),
            "expenses": db.expenses.count_documents({
                **apply_employee_scope(db, dict(base_q), "employee_id"),
                "status": "pending",
                "is_deleted": {"$ne": True},
            }),
            "tickets": db.tickets.count_documents({
                **base_q,
                "status": {"$in": ["open", "in_progress"]},
                "is_deleted": {"$ne": True},
            }),
        },
        "holiday_calendar": {
            "holidays_today": db.holiday_calendar.count_documents(holiday_today_query),
            "supported_states": SUPPORTED_HOLIDAY_STATES,
        },
        "compoff": {
            "available": db.compoff_credits.count_documents(compoff_available_query),
            "claimed": db.compoff_credits.count_documents({
                **apply_employee_scope(db, dict(base_q), "employee_id"),
                "status": "claimed",
                "is_deleted": {"$ne": True},
            }),
            "expired": db.compoff_credits.count_documents({
                **apply_employee_scope(db, dict(base_q), "employee_id"),
                "status": "expired",
                "is_deleted": {"$ne": True},
            }),
        },
    }

    return jsonify({
        "counts": counts,
        "extra": clean_doc(extra),
    })


@reports_bp.get("/attendance")
@roles_required(*REPORT_ROLES)
def attendance_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q = add_date_filter(q, "date")
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    items = list(
        db.attendance_logs
        .find(q)
        .sort([("date", -1), ("created_at", -1)])
        .limit(1000)
    )

    return jsonify({"items": clean_doc(items)})


@reports_bp.get("/attendance-mode-requests")
@roles_required(*REPORT_ROLES)
def attendance_mode_requests_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q = add_date_filter(q, "date")
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    items = list(
        db.attendance_mode_requests
        .find(q)
        .sort("created_at", -1)
        .limit(1000)
    )

    return jsonify({"items": clean_doc(items)})


@reports_bp.get("/holidays")
@roles_required(*REPORT_ROLES)
def holiday_report():
    db = get_db()

    q = build_report_query()

    state = normalize_text(request.args.get("state"))
    status = normalize_text(request.args.get("status"))

    if state:
        q["state"] = normalize_state(state)

    if status:
        q["status"] = status
    else:
        q["status"] = {"$ne": "inactive"}

    q = add_date_filter(q, "date")
    q = with_not_deleted(q)

    items = list(
        db.holiday_calendar
        .find(q)
        .sort("date", -1)
        .limit(1000)
    )

    return jsonify({
        "states": SUPPORTED_HOLIDAY_STATES,
        "items": clean_doc(items),
    })


@reports_bp.get("/compoffs")
@roles_required(*REPORT_ROLES)
def compoff_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q = add_date_filter(q, "earned_date")
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    items = list(
        db.compoff_credits
        .find(q)
        .sort("earned_date", -1)
        .limit(1000)
    )

    return jsonify({"items": clean_doc(items)})


@reports_bp.get("/leave-balances")
@roles_required(*REPORT_ROLES)
def leave_balances_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    leave_type = normalize_leave_type(request.args.get("leave_type"))

    if leave_type:
        q["leave_type"] = leave_type

    items = list(
        db.leave_balances
        .find(q)
        .sort([("employee_name", 1), ("leave_type", 1)])
        .limit(1000)
    )

    enriched_items = enrich_leave_balances(items)

    return jsonify({
        "leave_types": leave_type_options(),
        "summary": summarize_leave_balances(enriched_items),
        "items": clean_doc(enriched_items),
    })


@reports_bp.get("/leave-requests")
@roles_required(*REPORT_ROLES)
def leave_requests_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q = add_leave_overlap_date_filter(q)
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    leave_type = normalize_leave_type(request.args.get("leave_type"))

    if leave_type:
        q["leave_type"] = leave_type

    approval_stage = normalize_text(request.args.get("approval_stage"))

    if approval_stage:
        q["approval_stage"] = approval_stage

    live_status = normalize_text(request.args.get("live_status")).lower()

    if live_status:
        live_stage_map = {
            "pending_with_team_leader": "team_leader",
            "pending with team leader": "team_leader",
            "team_leader": "team_leader",
            "pending_with_reporting_officer": "reporting_officer",
            "pending with reporting officer": "reporting_officer",
            "reporting_officer": "reporting_officer",
            "pending_with_hr": "hr",
            "pending with hr": "hr",
            "hr": "hr",
        }

        if live_status in live_stage_map:
            q["status"] = "pending"
            q["approval_stage"] = live_stage_map[live_status]

    task_handover_to_id = normalize_text(request.args.get("task_handover_to_id"))
    project_handover_id = normalize_text(request.args.get("project_handover_id"))

    if task_handover_to_id:
        q["task_handover_to_id"] = task_handover_to_id

    if project_handover_id:
        q["project_handover_id"] = project_handover_id

    balance_deducted = normalize_text(request.args.get("balance_deducted")).lower()

    if balance_deducted in ["true", "yes", "1"]:
        q["balance_deducted"] = True

    if balance_deducted in ["false", "no", "0"]:
        q["balance_deducted"] = {"$ne": True}

    items = list(
        db.leave_requests
        .find(q)
        .sort([("from_date", -1), ("created_at", -1)])
        .limit(1000)
    )

    enriched_items = enrich_leave_requests(items)

    return jsonify({
        "leave_types": leave_type_options(),
        "summary": summarize_leave_requests(enriched_items),
        "items": clean_doc(enriched_items),
    })


@reports_bp.get("/leave-approvals")
@roles_required(*REPORT_ROLES)
def leave_approvals_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q = add_leave_overlap_date_filter(q)
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    q["approval_stage"] = {
        "$in": ["team_leader", "reporting_officer", "hr", "approved", "rejected"],
    }

    status = normalize_text(request.args.get("status"))

    if status:
        q["status"] = status

    approval_stage = normalize_text(request.args.get("approval_stage"))

    if approval_stage:
        q["approval_stage"] = approval_stage

    items = list(
        db.leave_requests
        .find(q)
        .sort([("updated_at", -1), ("created_at", -1)])
        .limit(1000)
    )

    enriched_items = enrich_leave_requests(items)

    return jsonify({
        "summary": summarize_leave_requests(enriched_items),
        "items": clean_doc(enriched_items),
    })


@reports_bp.get("/leave-deductions")
@roles_required(*REPORT_ROLES)
def leave_deductions_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q = add_leave_overlap_date_filter(q)
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    q["status"] = "approved"
    q["balance_deducted"] = True

    leave_type = normalize_leave_type(request.args.get("leave_type"))

    if leave_type:
        q["leave_type"] = leave_type

    items = list(
        db.leave_requests
        .find(q)
        .sort([("approved_at", -1), ("updated_at", -1), ("created_at", -1)])
        .limit(1000)
    )

    enriched_items = enrich_leave_requests(items)

    return jsonify({
        "summary": summarize_leave_requests(enriched_items),
        "items": clean_doc(enriched_items),
    })


@reports_bp.get("/leave-records")
@roles_required(*REPORT_ROLES)
def leave_records_report():
    return leave_requests_report()


@reports_bp.get("/audit")
@roles_required(*AUDIT_ROLES)
def audits():
    db = get_db()
    q = build_report_query()

    action = normalize_text(request.args.get("action"))
    entity = normalize_text(request.args.get("entity"))
    actor_email = normalize_text(request.args.get("actor_email"))

    if action:
        q["action"] = {"$regex": action, "$options": "i"}

    if entity:
        q["entity"] = {"$regex": entity, "$options": "i"}

    if actor_email:
        q["actor_email"] = {"$regex": actor_email, "$options": "i"}

    items = list(
        db.audit_logs
        .find(q)
        .sort("created_at", -1)
        .limit(500)
    )

    return jsonify({"items": clean_doc(items)})