from flask import Blueprint, jsonify, g, request, send_file
from datetime import datetime, date, timedelta
import re
from bson import ObjectId

from app.extensions import get_db
from app.utils.auth import roles_required
from app.utils.serializers import clean_doc

from app.services.attendance_excel import (
    build_attendance_excel_file,
    build_attendance_excel_filename,
    build_period_dates,
)

reports_bp = Blueprint("reports", __name__)


REPORT_COLLECTIONS = [
    "employees",
    "attendance_logs",
    "attendance_mode_requests",
    "holiday_work_requests",
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
    "holiday_work_requests",
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

    "HALF DAY": "HALF-DAY",
    "HALF-DAY": "HALF-DAY",
    "HALFDAY": "HALF-DAY",
    "HD": "HALF-DAY",

    "LWP": "LWP",
    "LEAVE WITHOUT PAY": "LWP",
    "LOSS OF PAY": "LWP",
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


def normalize_email(value):
    return normalize_text(value).lower()


def normalize_role(value):
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


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
        return [normalize_role(role) for role in value if normalize_role(role)]

    if isinstance(value, str):
        return [normalize_role(role) for role in value.split(",") if normalize_role(role)]

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
        "HALF-DAY": "Half Day",
        "LWP": "Leave Without Pay",
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
    requested_leave_type = normalize_leave_type(
        row.get("requested_leave_type") or row.get("requested_leave_type_label") or leave_type
    )
    deducted_leave_type = normalize_leave_type(
        row.get("deducted_leave_type") or row.get("deducted_leave_type_label") or ""
    )

    row["leave_type"] = leave_type
    row["leave_type_label"] = row.get("leave_type_label") or leave_type_label(leave_type)

    row["requested_leave_type"] = requested_leave_type
    row["requested_leave_type_label"] = (
        row.get("requested_leave_type_label") or leave_type_label(requested_leave_type)
    )

    if deducted_leave_type:
        row["deducted_leave_type"] = deducted_leave_type
        row["deducted_leave_type_label"] = (
            row.get("deducted_leave_type_label") or leave_type_label(deducted_leave_type)
        )
    else:
        row["deducted_leave_type"] = ""
        row["deducted_leave_type_label"] = ""

    row["is_half_day"] = bool(row.get("is_half_day")) or requested_leave_type == "HALF-DAY"
    row["day_type"] = row.get("day_type") or ("half_day" if row["is_half_day"] else "full_day")
    row["lwp_days"] = float(row.get("lwp_days", 0) or 0)

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
    roles = set(normalize_roles(g.current_user.get("roles", [])))
    role = normalize_role(g.current_user.get("role"))

    if role:
        roles.add(role)

    return roles


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
    user_id = str(g.current_user.get("_id") or "")

    if not user_id:
        return None

    user_email = normalize_email(
        g.current_user.get("email")
        or g.current_user.get("username")
        or g.current_user.get("official_email")
    )

    user_employee_id = normalize_text(
        g.current_user.get("employee_id")
        or g.current_user.get("employee_ref_id")
        or g.current_user.get("emp_code")
        or g.current_user.get("employee_code")
    )

    identifier_or = [
        {"user_id": user_id},
        {"employee_ref_id": user_id},
    ]

    user_obj_id = safe_object_id(user_id)

    if user_obj_id:
        identifier_or.append({"_id": user_obj_id})

    if user_employee_id:
        identifier_or.extend([
            {"employee_id": user_employee_id},
            {"employee_ref_id": user_employee_id},
            {"employee_code": user_employee_id},
            {"emp_code": user_employee_id},
            {"code": user_employee_id},
        ])

        employee_obj_id = safe_object_id(user_employee_id)
        if employee_obj_id:
            identifier_or.append({"_id": employee_obj_id})

    if user_email:
        identifier_or.extend([
            {"email": user_email},
            {"official_email": user_email},
        ])

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": identifier_or,
    })

    if employee:
        return employee

    return db.employees.find_one({
        "is_deleted": {"$ne": True},
        "$or": identifier_or,
    })


def current_employee_id(db):
    employee = current_employee(db)
    return str(employee["_id"]) if employee else ""


def employee_roles(employee):
    employee = employee or {}
    roles = set(normalize_roles(employee.get("roles", [])))
    role = normalize_role(employee.get("role"))

    if role:
        roles.add(role)

    return roles


def employee_identifier_values(employee):
    employee = employee or {}
    values = []

    raw_values = [
        employee.get("_id"),
        str(employee.get("_id")) if employee.get("_id") else "",
        employee.get("id"),
        employee.get("user_id"),
        employee.get("employee_id"),
        employee.get("employee_ref_id"),
        employee.get("employee_code"),
        employee.get("emp_code"),
        employee.get("code"),
        employee.get("email"),
        employee.get("official_email"),
    ]

    for value in raw_values:
        text_value = normalize_text(value)

        if not text_value:
            continue

        if text_value not in values:
            values.append(text_value)

    return values


def employee_is_team_leader(employee):
    roles = employee_roles(employee)

    return bool(
        employee
        and (
            truthy(employee.get("is_team_leader"))
            or truthy(employee.get("team_leader_capability"))
            or truthy(employee.get("tl_capability"))
            or "team_leader" in roles
            or "team_leader_capability" in roles
            or "tl" in roles
        )
    )


def employee_is_reporting_officer(employee):
    roles = employee_roles(employee)

    return bool(
        employee
        and (
            truthy(employee.get("is_reporting_officer"))
            or truthy(employee.get("reporting_officer_capability"))
            or truthy(employee.get("ro_capability"))
            or "reporting_officer" in roles
            or "reporting_officer_capability" in roles
            or "ro" in roles
            or "manager" in roles
        )
    )


def scoped_employee_ids(db):
    roles = current_roles()

    if roles.intersection(HR_ADMIN_ROLES):
        return None

    employee = current_employee(db)

    if not employee:
        return []

    employee_id = str(employee["_id"])
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    scope_or = []

    if "team_leader" in roles or employee_is_team_leader(employee):
        scope_or.append({"team_leader_id": {"$in": identifier_values}})

    if "reporting_officer" in roles or "ro" in roles or employee_is_reporting_officer(employee):
        scope_or.append({"reporting_officer_id": {"$in": identifier_values}})

    if not scope_or:
        return identifier_values

    rows = list(
        db.employees.find({
            "tenant_id": employee.get("tenant_id") or current_tenant_id(),
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
            "$or": scope_or,
        })
    )

    ids = []

    for row in rows:
        for value in employee_identifier_values(row):
            if value not in ids:
                ids.append(value)

    for value in identifier_values:
        if value not in ids:
            ids.append(value)

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

def add_holiday_work_filters(q):
    status = normalize_text(request.args.get("status"))
    date_value = normalize_text(request.args.get("date"))
    employee_id = normalize_text(request.args.get("employee_id"))
    department = normalize_text(request.args.get("department"))
    state = normalize_text(request.args.get("state"))

    if status:
        q["status"] = status

    if date_value:
        q["date"] = date_value

    if employee_id:
        q["employee_id"] = employee_id

    if department:
        q["department"] = department

    if state:
        q["state"] = normalize_state(state)

    return q


def attendance_location_text(row, key="check_in_location"):
    location = row.get(key) or row.get("location") or {}

    if not isinstance(location, dict):
        return "—"

    lat = location.get("latitude") or location.get("lat")
    lng = location.get("longitude") or location.get("lng")
    accuracy = location.get("accuracy")

    if lat in [None, ""] or lng in [None, ""]:
        return "—"

    text = f"{lat}, {lng}"

    try:
        if accuracy not in [None, ""]:
            accuracy_value = float(accuracy)

            if accuracy_value >= 0:
                text = f"{text} ±{round(accuracy_value)}m"
    except (TypeError, ValueError):
        pass

    return text


def attendance_map_url(row, key="check_in_location"):
    location = row.get(key) or row.get("location") or {}

    if not isinstance(location, dict):
        return ""

    lat = location.get("latitude") or location.get("lat")
    lng = location.get("longitude") or location.get("lng")

    if not lat or not lng:
        return ""

    return f"https://www.google.com/maps?q={lat},{lng}"


def enrich_attendance_report_row(row):
    row = dict(row or {})

    row["field_photo_url"] = (
        row.get("field_photo")
        or row.get("proof_photo")
        or row.get("photo")
        or ""
    )

    row["check_in_location_text"] = attendance_location_text(row, "check_in_location")
    row["check_out_location_text"] = attendance_location_text(row, "check_out_location")
    row["check_in_map_url"] = attendance_map_url(row, "check_in_location")
    row["check_out_map_url"] = attendance_map_url(row, "check_out_location")

    row["holiday_work_approval_status"] = (
        row.get("holiday_work_status")
        or row.get("holiday_work_approval_status")
        or ("approved" if row.get("holiday_work_request_id") else "")
    )

    row["holiday_title"] = row.get("holiday_title") or row.get("holiday_name") or ""
    row["holiday_type"] = row.get("holiday_type") or ""

    row["verified_by"] = (
        row.get("approved_by_name")
        or row.get("verified_by_name")
        or row.get("decided_by_name")
        or ""
    )

    return row


def enrich_holiday_work_request_report_row(row):
    row = dict(row or {})

    location = row.get("location") or row.get("check_in_location") or {}

    if isinstance(location, dict):
        lat = location.get("latitude") or location.get("lat")
        lng = location.get("longitude") or location.get("lng")

        if lat and lng:
            row["location_text"] = f"{lat}, {lng}"
            row["map_url"] = f"https://www.google.com/maps?q={lat},{lng}"
        else:
            row["location_text"] = "—"
            row["map_url"] = ""
    else:
        row["location_text"] = "—"
        row["map_url"] = ""

    row["proof_photo_url"] = (
        row.get("proof_photo")
        or row.get("field_photo")
        or row.get("photo")
        or ""
    )

    row["live_status"] = leave_live_status(row)

    row["decided_by"] = (
        row.get("decided_by_name")
        or row.get("approved_by_name")
        or row.get("rejected_by_name")
        or ""
    )

    row["decided_at"] = (
        row.get("decided_at")
        or row.get("approved_at")
        or row.get("rejected_at")
        or ""
    )

    return row


def enrich_compoff_report_row(row):
    row = dict(row or {})

    row["holiday_work_request_id"] = row.get("holiday_work_request_id") or ""
    row["attendance_log_id"] = row.get("attendance_log_id") or ""
    row["holiday_title"] = row.get("holiday_title") or row.get("holiday_name") or ""
    row["claim_from_date"] = row.get("claim_from_date") or row.get("available_from") or ""
    row["expiry_date"] = row.get("expiry_date") or row.get("valid_until") or ""
    row["claim_date"] = row.get("claim_date") or row.get("claimed_at") or ""
    row["leave_request_id"] = row.get("leave_request_id") or ""

    return row


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
        "half_day": 0.0,
        "lwp": 0.0,
        "total_days": 0.0,
        "deducted_days": 0.0,
        "not_deducted_days": 0.0,
    }

    for item in items:
        status = normalize_text(item.get("status")).lower()
        stage = normalize_text(item.get("approval_stage")).lower()
        leave_type = normalize_leave_type(item.get("requested_leave_type") or item.get("leave_type"))
        deducted_leave_type = normalize_leave_type(item.get("deducted_leave_type"))
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
        elif leave_type == "HALF-DAY":
            summary["half_day"] += days

        if deducted_leave_type == "LWP" or float(item.get("lwp_days", 0) or 0) > 0:
            summary["lwp"] += float(item.get("lwp_days", 0) or days)

        if item.get("balance_deducted"):
            summary["deducted_days"] += days
        elif deducted_leave_type == "LWP" or float(item.get("lwp_days", 0) or 0) > 0:
            summary["deducted_days"] += 0
            summary["not_deducted_days"] += days
        else:
            summary["not_deducted_days"] += days

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
        {"value": "COMP-OFF", "label": "Comp-Off"},
        {"value": "HALF-DAY", "label": "Half Day"},
        {"value": "LWP", "label": "Leave Without Pay"},
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
# Styled Attendance Excel Export helpers
# -----------------------------------------------------------------------------

def active_employee_query():
    return {
        "$and": [
            {"is_alumni": {"$ne": True}},
            {
                "$or": [
                    {"status": {"$exists": False}},
                    {"status": {"$nin": ["inactive", "Inactive", "Resigned", "resigned", "Left", "left", "Terminated", "terminated", "alumni"]}},
                ]
            },
            {
                "$or": [
                    {"employment_status": {"$exists": False}},
                    {"employment_status": {"$nin": ["inactive", "Inactive", "Resigned", "resigned", "Left", "left", "Terminated", "terminated", "alumni"]}},
                ]
            },
        ]
    }


def excel_employee_identifier_values(employee):
    values = []

    def add(value):
        value = normalize_text(value)
        if value and value not in values:
            values.append(value)

    employee_id = employee.get("_id")

    if employee_id:
        add(str(employee_id))

    add(employee.get("id"))
    add(employee.get("employee_id"))
    add(employee.get("employee_code"))
    add(employee.get("emp_code"))
    add(employee.get("code"))
    add(employee.get("user_id"))
    add(employee.get("employee_ref_id"))
    add(employee.get("email"))
    add(employee.get("official_email"))
    add(employee.get("phone"))
    add(employee.get("mobile"))

    return values


def selected_employee_query():
    employee_id = normalize_text(
        request.args.get("employee_id")
        or request.args.get("employee")
        or request.args.get("staff_id")
    )

    employee_code = normalize_text(
        request.args.get("employee_code")
        or request.args.get("emp_code")
        or request.args.get("staff_code")
    )

    employee_email = normalize_text(
        request.args.get("employee_email")
        or request.args.get("email")
        or request.args.get("official_email")
    )

    employee_name = normalize_text(
        request.args.get("employee_name")
        or request.args.get("name")
    )

    conditions = []

    if employee_id:
        employee_obj_id = safe_object_id(employee_id)

        if employee_obj_id:
            conditions.append({"_id": employee_obj_id})

        conditions.extend([
            {"id": employee_id},
            {"employee_id": employee_id},
            {"user_id": employee_id},
            {"employee_ref_id": employee_id},
        ])

    if employee_code:
        conditions.extend([
            {"employee_code": employee_code},
            {"emp_code": employee_code},
            {"code": employee_code},
        ])

    if employee_email:
        conditions.extend([
            {"email": {"$regex": f"^{re.escape(employee_email)}$", "$options": "i"}},
            {"official_email": {"$regex": f"^{re.escape(employee_email)}$", "$options": "i"}},
        ])

    if employee_name:
        conditions.extend([
            {"name": {"$regex": re.escape(employee_name), "$options": "i"}},
            {"employee_name": {"$regex": re.escape(employee_name), "$options": "i"}},
            {"full_name": {"$regex": re.escape(employee_name), "$options": "i"}},
        ])

    if not conditions:
        return {}

    return {"$or": conditions}


def selected_organisation_query():
    organisation_id = normalize_text(
        request.args.get("organisation_id")
        or request.args.get("organization_id")
        or request.args.get("entity_id")
    )

    organisation_code = normalize_text(
        request.args.get("organisation_code")
        or request.args.get("organization_code")
        or request.args.get("entity_code")
    ).upper()

    organisation_name = normalize_text(
        request.args.get("organisation")
        or request.args.get("organization")
        or request.args.get("entity")
        or request.args.get("organisation_name")
        or request.args.get("organization_name")
    )

    conditions = []

    if organisation_id:
        conditions.extend([
            {"organisation_id": organisation_id},
            {"organization_id": organisation_id},
            {"entity_id": organisation_id},
        ])

    if organisation_code:
        conditions.extend([
            {"organisation_code": organisation_code},
            {"organization_code": organisation_code},
            {"entity_code": organisation_code},
            {"code": organisation_code},
        ])

    if organisation_name:
        conditions.extend([
            {"organisation": {"$regex": f"^{re.escape(organisation_name)}$", "$options": "i"}},
            {"organization": {"$regex": f"^{re.escape(organisation_name)}$", "$options": "i"}},
            {"organisation_name": {"$regex": f"^{re.escape(organisation_name)}$", "$options": "i"}},
            {"organization_name": {"$regex": f"^{re.escape(organisation_name)}$", "$options": "i"}},
            {"entity": {"$regex": f"^{re.escape(organisation_name)}$", "$options": "i"}},
        ])

    if not conditions:
        return {}

    return {"$or": conditions}


def selected_organisation_display(db, tenant_id):
    organisation_id = normalize_text(
        request.args.get("organisation_id")
        or request.args.get("organization_id")
        or request.args.get("entity_id")
    )

    organisation_code = normalize_text(
        request.args.get("organisation_code")
        or request.args.get("organization_code")
        or request.args.get("entity_code")
    )

    organisation_name = normalize_text(
        request.args.get("organisation")
        or request.args.get("organization")
        or request.args.get("entity")
    )

    organisation = None

    if organisation_id:
        org_obj_id = safe_object_id(organisation_id)
        org_query = {
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        }

        if org_obj_id:
            org_query["_id"] = org_obj_id
        else:
            org_query["$or"] = [
                {"id": organisation_id},
                {"organisation_id": organisation_id},
                {"organization_id": organisation_id},
            ]

        organisation = db.organisations.find_one(org_query)

    if not organisation and organisation_code:
        organisation = db.organisations.find_one({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "$or": [
                {"code": {"$regex": f"^{organisation_code}$", "$options": "i"}},
                {"organisation_code": {"$regex": f"^{organisation_code}$", "$options": "i"}},
                {"organization_code": {"$regex": f"^{organisation_code}$", "$options": "i"}},
            ],
        })

    if not organisation and organisation_name:
        organisation = db.organisations.find_one({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "$or": [
                {"name": {"$regex": f"^{organisation_name}$", "$options": "i"}},
                {"organisation_name": {"$regex": f"^{organisation_name}$", "$options": "i"}},
                {"organization_name": {"$regex": f"^{organisation_name}$", "$options": "i"}},
            ],
        })

    if organisation:
        return {
            "name": (
                organisation.get("name")
                or organisation.get("organisation_name")
                or organisation.get("organization_name")
                or organisation_name
                or organisation_code
            ),
            "code": (
                organisation.get("code")
                or organisation.get("organisation_code")
                or organisation.get("organization_code")
                or organisation_code
            ),
        }

    return {
        "name": organisation_name or organisation_code or "Organisation",
        "code": organisation_code,
    }


def excel_date_range_query(dates):
    if not dates:
        return {}

    return {
        "$gte": dates[0].isoformat(),
        "$lte": dates[-1].isoformat(),
    }


def employee_attendance_match_query(employee_identifiers):
    identifiers = [
        normalize_text(value)
        for value in employee_identifiers
        if normalize_text(value)
    ]

    if not identifiers:
        return {"employee_id": {"$in": []}}

    return {
        "$or": [
            {"employee_id": {"$in": identifiers}},
            {"employee_code": {"$in": identifiers}},
            {"emp_code": {"$in": identifiers}},
            {"code": {"$in": identifiers}},
            {"user_id": {"$in": identifiers}},
            {"employee_ref_id": {"$in": identifiers}},
            {"email": {"$in": identifiers}},
            {"official_email": {"$in": identifiers}},
            {"phone": {"$in": identifiers}},
            {"mobile": {"$in": identifiers}},
        ]
    }


def employee_leave_match_query(employee_identifiers):
    identifiers = [
        normalize_text(value)
        for value in employee_identifiers
        if normalize_text(value)
    ]

    if not identifiers:
        return {"employee_id": {"$in": []}}

    return {
        "$or": [
            {"employee_id": {"$in": identifiers}},
            {"employee_code": {"$in": identifiers}},
            {"emp_code": {"$in": identifiers}},
            {"code": {"$in": identifiers}},
            {"user_id": {"$in": identifiers}},
            {"employee_ref_id": {"$in": identifiers}},
            {"email": {"$in": identifiers}},
            {"official_email": {"$in": identifiers}},
            {"phone": {"$in": identifiers}},
            {"mobile": {"$in": identifiers}},
        ]
    }


def excel_safe_query_and(base_q, extra_q):
    if not extra_q:
        return base_q

    if not base_q:
        return extra_q

    return {
        "$and": [
            base_q,
            extra_q,
        ]
    }

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

    holiday_work_pending_query = build_status_query(
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
            "holiday_work_requests": db.holiday_work_requests.count_documents(holiday_work_pending_query),
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

@reports_bp.get("/attendance-register.xlsx")
@roles_required(*AUDIT_ROLES)
def attendance_register_excel_export():
    db = get_db()

    tenant_id = current_tenant_id()

    period = normalize_text(request.args.get("period") or "month").lower()
    year = request.args.get("year")
    month = request.args.get("month")
    date_value = request.args.get("date") or request.args.get("on_date")
    week_start = request.args.get("week_start") or request.args.get("date_from")
    week_end = request.args.get("week_end") or request.args.get("date_to")

    state = normalize_text(request.args.get("state"))
    normalized_state = normalize_state(state) if state else ""

    dates = build_period_dates(
        period=period,
        year=year,
        month=month,
        date_value=date_value,
        week_start=week_start,
        week_end=week_end,
    )

    if not dates:
        return jsonify({
            "message": "Invalid attendance export period or date range.",
            "filters": {
                "period": period,
                "year": year,
                "month": month,
                "date": date_value,
                "week_start": week_start,
                "week_end": week_end,
            },
        }), 400

    employee_q = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }

    employee_q = excel_safe_query_and(employee_q, active_employee_query())

    organisation_q = selected_organisation_query()

    if organisation_q:
        employee_q = excel_safe_query_and(employee_q, organisation_q)

    employee_filter_q = selected_employee_query()

    if employee_filter_q:
        employee_q = excel_safe_query_and(employee_q, employee_filter_q)

    if normalized_state:
        state_conditions = [
            {"state": {"$regex": f"^{re.escape(normalized_state)}$", "$options": "i"}},
            {"office_state": {"$regex": f"^{re.escape(normalized_state)}$", "$options": "i"}},
            {"work_state": {"$regex": f"^{re.escape(normalized_state)}$", "$options": "i"}},
            {"branch": {"$regex": normalized_state, "$options": "i"}},
        ]

        if state and state.lower() != normalized_state.lower():
            state_conditions.extend([
                {"state": {"$regex": f"^{re.escape(state)}$", "$options": "i"}},
                {"office_state": {"$regex": f"^{re.escape(state)}$", "$options": "i"}},
                {"work_state": {"$regex": f"^{re.escape(state)}$", "$options": "i"}},
                {"branch": {"$regex": state, "$options": "i"}},
            ])

        employee_q = excel_safe_query_and(employee_q, {
            "$or": state_conditions
        })

    employees = list(
        db.employees
        .find(employee_q)
        .sort([("organisation_code", 1), ("state", 1), ("name", 1)])
    )

    if not employees:
        return jsonify({
            "message": "No active employees found for the selected organisation/entity and filters.",
            "filters": {
                "tenant_id": tenant_id,
                "organisation_id": (
                    request.args.get("organisation_id")
                    or request.args.get("organization_id")
                    or request.args.get("entity_id")
                ),
                "organisation_code": (
                    request.args.get("organisation_code")
                    or request.args.get("organization_code")
                    or request.args.get("entity_code")
                ),
                "organisation": (
                    request.args.get("organisation")
                    or request.args.get("organization")
                    or request.args.get("entity")
                ),
                "state": state,
                "employee_id": (
                    request.args.get("employee_id")
                    or request.args.get("employee")
                    or request.args.get("staff_id")
                ),
                "employee_code": (
                    request.args.get("employee_code")
                    or request.args.get("emp_code")
                    or request.args.get("staff_code")
                ),
                "employee_email": (
                    request.args.get("employee_email")
                    or request.args.get("email")
                    or request.args.get("official_email")
                ),
                "employee_name": (
                    request.args.get("employee_name")
                    or request.args.get("name")
                ),
                "period": period,
                "year": year,
                "month": month,
                "date": date_value,
                "week_start": week_start,
                "week_end": week_end,
            },
        }), 404

    employee_identifiers = []

    for employee in employees:
        for value in excel_employee_identifier_values(employee):
            if value not in employee_identifiers:
                employee_identifiers.append(value)

    date_q = excel_date_range_query(dates)

    attendance_base_q = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "date": date_q,
    }

    attendance_q = excel_safe_query_and(
        attendance_base_q,
        employee_attendance_match_query(employee_identifiers),
    )

    attendance_logs = list(db.attendance_logs.find(attendance_q))

    leave_base_q = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": [
            {
                "from_date": {"$lte": dates[-1].isoformat()},
                "to_date": {"$gte": dates[0].isoformat()},
            },
            {
                "from_date": {"$lte": dates[-1].isoformat()},
                "upto_date": {"$gte": dates[0].isoformat()},
            },
            {
                "date": date_q,
            },
        ],
    }

    leave_q = excel_safe_query_and(
        leave_base_q,
        employee_leave_match_query(employee_identifiers),
    )

    leave_requests = list(db.leave_requests.find(leave_q))

    holiday_q = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "date": date_q,
        "status": {"$ne": "inactive"},
    }

    if normalized_state:
        holiday_q["$or"] = [
            {"state": {"$regex": f"^{re.escape(normalized_state)}$", "$options": "i"}},
            {"state": {"$regex": f"^{re.escape(state)}$", "$options": "i"}},
        ]

    holidays = list(db.holiday_calendar.find(holiday_q))

    holiday_work_q = excel_safe_query_and(
        {
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "date": date_q,
        },
        employee_attendance_match_query(employee_identifiers),
    )

    holiday_work_requests = list(db.holiday_work_requests.find(holiday_work_q))

    compoff_q = excel_safe_query_and(
        {
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "$or": [
                {"earned_date": date_q},
                {"claim_from_date": date_q},
                {"expiry_date": date_q},
                {"valid_until": date_q},
                {"claim_date": date_q},
            ],
        },
        employee_attendance_match_query(employee_identifiers),
    )

    compoff_credits = list(db.compoff_credits.find(compoff_q))

    organisation_display = selected_organisation_display(db, tenant_id)

    if employees and not organisation_display.get("code"):
        first_employee = employees[0]
        organisation_display = {
            "name": (
                first_employee.get("organisation")
                or first_employee.get("organization")
                or first_employee.get("organisation_name")
                or first_employee.get("organization_name")
                or organisation_display.get("name")
            ),
            "code": (
                first_employee.get("organisation_code")
                or first_employee.get("organization_code")
                or organisation_display.get("code")
            ),
        }

    excel_stream = build_attendance_excel_file(
        employees=employees,
        attendance_logs=attendance_logs,
        leave_requests=leave_requests,
        holidays=holidays,
        holiday_work_requests=holiday_work_requests,
        compoff_credits=compoff_credits,
        period=period,
        year=year,
        month=month,
        date_value=date_value,
        week_start=week_start,
        week_end=week_end,
        organisation_name=organisation_display.get("name", ""),
        organisation_code=organisation_display.get("code", ""),
        state_name=normalized_state or "All States",
    )

    filename_state_name = normalized_state or "All States"

    if len(employees) == 1:
        single_employee = employees[0]
        filename_state_name = (
            single_employee.get("employee_code")
            or single_employee.get("emp_code")
            or single_employee.get("code")
            or single_employee.get("name")
            or single_employee.get("employee_name")
            or filename_state_name
        )

    filename = build_attendance_excel_filename(
        organisation_name=organisation_display.get("name", ""),
        organisation_code=organisation_display.get("code", ""),
        state_name=filename_state_name,
        period=period,
        year=year,
        month=month,
        date_value=date_value,
        week_start=week_start,
        week_end=week_end,
    )

    return send_file(
        excel_stream,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename,
    )

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

    items = [enrich_attendance_report_row(item) for item in items]

    return jsonify({"items": clean_doc(items)})


@reports_bp.get("/field-attendance")
@roles_required(*REPORT_ROLES)
def field_attendance_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q = add_date_filter(q, "date")
    q["mode"] = "field"
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    items = list(
        db.attendance_logs
        .find(q)
        .sort([("date", -1), ("created_at", -1)])
        .limit(1000)
    )

    items = [enrich_attendance_report_row(item) for item in items]

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

@reports_bp.get("/holiday-work-requests")
@roles_required(*REPORT_ROLES)
def holiday_work_requests_report():
    db = get_db()

    q = build_report_query()
    q = add_holiday_work_filters(q)
    q = add_date_filter(q, "date")
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    items = list(
        db.holiday_work_requests
        .find(q)
        .sort([("date", -1), ("created_at", -1)])
        .limit(1000)
    )

    items = [enrich_holiday_work_request_report_row(item) for item in items]

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

    items = [enrich_compoff_report_row(item) for item in items]

    return jsonify({"items": clean_doc(items)})

@reports_bp.get("/compoff-claims")
@roles_required(*REPORT_ROLES)
def compoff_claims_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q["status"] = {"$in": ["claimed", "used", "approved"]}
    q = add_date_filter(q, "claim_date")
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    items = list(
        db.compoff_credits
        .find(q)
        .sort([("claim_date", -1), ("claimed_at", -1)])
        .limit(1000)
    )

    items = [enrich_compoff_report_row(item) for item in items]

    return jsonify({"items": clean_doc(items)})


@reports_bp.get("/expired-compoffs")
@roles_required(*REPORT_ROLES)
def expired_compoffs_report():
    db = get_db()

    q = build_report_query()
    q = add_common_filters(q)
    q["status"] = "expired"
    q = add_date_filter(q, "expiry_date")
    q = apply_employee_scope(db, q, "employee_id")
    q = with_not_deleted(q)

    items = list(
        db.compoff_credits
        .find(q)
        .sort("expiry_date", -1)
        .limit(1000)
    )

    items = [enrich_compoff_report_row(item) for item in items]

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
    q["$or"] = [
        {"balance_deducted": True},
        {"deducted_leave_type": "LWP"},
        {"lwp_days": {"$gt": 0}},
    ]

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