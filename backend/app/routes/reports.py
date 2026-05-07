from flask import Blueprint, jsonify, g, request
from datetime import datetime, date
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
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
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


MANAGER_ROLES = {
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
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


def scoped_employee_ids(db):
    roles = current_roles()

    if roles.intersection(HR_ADMIN_ROLES):
        return None

    employee = current_employee(db)

    if not employee:
        return []

    employee_id = str(employee["_id"])
    scope_or = []

    if "team_leader" in roles:
        scope_or.append({"team_leader_id": employee_id})

    if roles.intersection({"manager", "ro", "reporting_officer"}):
        scope_or.append({"reporting_officer_id": employee_id})

    if not scope_or:
        return []

    rows = list(
        db.employees.find({
            "tenant_id": current_tenant_id(),
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
            "$or": scope_or,
        })
    )

    return [str(row["_id"]) for row in rows]


def apply_employee_scope(db, q, employee_field="employee_id"):
    roles = current_roles()

    if "super_admin" in roles or roles.intersection(HR_ADMIN_ROLES):
        return q

    ids = scoped_employee_ids(db)

    if ids is not None:
        q[employee_field] = {"$in": ids}

    return q


def add_date_filter(q, date_field="date"):
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))

    if date_from or date_to:
        q[date_field] = {}

        if date_from:
            q[date_field]["$gte"] = date_from

        if date_to:
            q[date_field]["$lte"] = date_to

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


@reports_bp.get("/summary")
@roles_required(*REPORT_ROLES)
def summary():
    db = get_db()
    q = build_report_query()

    counts = {
        collection: collection_count(db, collection, q)
        for collection in REPORT_COLLECTIONS
    }

    today = today_string()

    attendance_today_query = build_date_query(q, today)

    leave_pending_query = build_status_query(q, "pending")
    mode_pending_query = build_status_query(q, "pending")
    compoff_available_query = build_status_query(q, "available")

    holiday_today_query = dict(q)
    holiday_today_query["date"] = today
    holiday_today_query["status"] = {"$ne": "inactive"}
    holiday_today_query["is_deleted"] = {"$ne": True}

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
        "pending": {
            "leave_requests": db.leave_requests.count_documents(leave_pending_query),
            "wfh_field_requests": db.attendance_mode_requests.count_documents(mode_pending_query),
            "expenses": db.expenses.count_documents({
                **q,
                "status": "pending",
                "is_deleted": {"$ne": True},
            }),
            "tickets": db.tickets.count_documents({
                **q,
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
                **q,
                "status": "claimed",
                "is_deleted": {"$ne": True},
            }),
            "expired": db.compoff_credits.count_documents({
                **q,
                "status": "expired",
                "is_deleted": {"$ne": True},
            }),
        },
    }

    return jsonify({
        "counts": counts,
        "extra": extra,
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

    leave_type = normalize_text(request.args.get("leave_type")).upper()

    if leave_type:
        q["leave_type"] = leave_type

    items = list(
        db.leave_balances
        .find(q)
        .sort([("employee_name", 1), ("leave_type", 1)])
        .limit(1000)
    )

    return jsonify({"items": clean_doc(items)})


@reports_bp.get("/leave-requests")
@roles_required(*REPORT_ROLES)
def leave_requests_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q = add_date_filter(q, "from_date")
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    leave_type = normalize_text(request.args.get("leave_type")).upper()

    if leave_type:
        q["leave_type"] = leave_type

    approval_stage = normalize_text(request.args.get("approval_stage"))

    if approval_stage:
        q["approval_stage"] = approval_stage

    items = list(
        db.leave_requests
        .find(q)
        .sort("created_at", -1)
        .limit(1000)
    )

    return jsonify({"items": clean_doc(items)})


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