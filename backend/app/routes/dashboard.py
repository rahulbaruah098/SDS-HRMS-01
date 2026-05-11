from flask import Blueprint, jsonify, g, request
from bson import ObjectId
from datetime import datetime, date, timedelta

from app.extensions import get_db
from app.utils.auth import current_user_required
from app.utils.serializers import clean_doc


dashboard_bp = Blueprint("dashboard", __name__)


SUPPORTED_HOLIDAY_STATES = [
    "Assam(HO)",
    "Manipur",
    "Mizoram",
    "Arunachal Pradesh",
]


ADMIN_HR_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}

ADMIN_DASHBOARD_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "finance",
    "accounts_finance",
}

EMPLOYEE_CAPABILITY_ROLES = {
    "team_leader",
    "reporting_officer",
}

PRESENT_ATTENDANCE_STATUSES = [
    "present",
    "late",
    "holiday_work",
    "early_checkout",
]


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


def has_role(*allowed_roles):
    return bool(current_roles().intersection(set(allowed_roles)))


def current_tenant_id():
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id") or "sds"


def tenant_query(extra=None):
    q = {"tenant_id": current_tenant_id()}
    q.update(extra or {})
    return q


def active_employee_filter(extra=None):
    q = {
        "status": {"$ne": "Inactive"},
        "is_deleted": {"$ne": True},
    }

    q.update(extra or {})
    return q


def count_collection(db, collection, extra=None):
    return db[collection].count_documents(tenant_query(extra))


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


def normalize_project_status(value):
    status = normalize_text(value).lower()

    if status in {"completed", "complete", "done", "closed", "inactive"}:
        return "completed"

    if status in {"on_hold", "on-hold", "hold"}:
        return "on_hold"

    if status in {"active", "ongoing", "in_progress", "in-progress", "open"}:
        return "active"

    return status or "active"


def truthy(value):
    return str(value or "").strip().lower() in ["true", "yes", "1", "on"]


def is_admin_hr_role_set(roles):
    return bool(set(roles).intersection(ADMIN_HR_ROLES))


def is_admin_dashboard_role_set(roles):
    return bool(set(roles).intersection(ADMIN_DASHBOARD_ROLES))


def is_team_leader_capability(employee, roles=None):
    roles = set(roles or [])

    return bool(
        truthy(employee.get("is_team_leader"))
        or "team_leader" in roles
    )


def is_reporting_officer_capability(employee, roles=None):
    roles = set(roles or [])

    return bool(
        truthy(employee.get("is_reporting_officer"))
        or "reporting_officer" in roles
    )


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


def employee_state(employee):
    return normalize_state(
        employee.get("state")
        or employee.get("branch")
        or employee.get("work_state")
        or "Assam(HO)"
    )


def employee_code(employee):
    return (
        employee.get("employee_id")
        or employee.get("emp_code")
        or employee.get("code")
        or ""
    )


def project_name(project):
    return (
        project.get("name")
        or project.get("project_name")
        or project.get("title")
        or "Untitled Project"
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

    return labels.get(stage, stage or "Approval")


def leave_request_live_status(row):
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

    if stage:
        return leave_stage_label(stage)

    return "Pending" if status == "pending" else status.title() if status else "—"


def enrich_leave_request(row):
    row = dict(row or {})
    live_status = leave_request_live_status(row)

    row["live_status"] = live_status
    row["status_text"] = live_status
    row["status_display"] = live_status
    row["approval_stage_label"] = row.get("approval_stage_label") or leave_stage_label(row.get("approval_stage"))
    row["leave_type_label"] = row.get("leave_type_label") or leave_type_label(row.get("leave_type"))

    return row


def enrich_leave_requests(rows):
    return [enrich_leave_request(row) for row in rows]


def leave_balance_summary(leave_balances):
    summary = {
        "casual_leave": {
            "opening_balance": 0,
            "credited": 0,
            "used": 0,
            "available": 0,
        },
        "earned_leave": {
            "opening_balance": 0,
            "credited": 0,
            "used": 0,
            "available": 0,
        },
        "total_opening_balance": 0,
        "total_credited": 0,
        "total_used": 0,
        "total_available": 0,
    }

    for row in leave_balances:
        leave_type = normalize_leave_type(row.get("leave_type") or row.get("leave_type_label"))

        target = None

        if leave_type == "CL":
            target = summary["casual_leave"]

        if leave_type == "EL":
            target = summary["earned_leave"]

        if target is None:
            continue

        opening = float(row.get("opening_balance", 0) or 0)
        credited = float(row.get("credited", 0) or 0)
        used = float(row.get("used", 0) or 0)
        available = float(row.get("available", 0) or 0)

        target["opening_balance"] = opening
        target["credited"] = credited
        target["used"] = used
        target["available"] = available

        summary["total_opening_balance"] += opening
        summary["total_credited"] += credited
        summary["total_used"] += used
        summary["total_available"] += available

    return summary


def is_second_or_fourth_saturday(check_date):
    if check_date.weekday() != 5:
        return False

    saturday_count = 0

    for day in range(1, check_date.day + 1):
        cursor = date(check_date.year, check_date.month, day)

        if cursor.weekday() == 5:
            saturday_count += 1

    return saturday_count in [2, 4]


def weekly_holiday_reason(check_date):
    if check_date.weekday() == 6:
        return {
            "is_holiday": True,
            "holiday_type": "weekly",
            "title": "Sunday Holiday",
            "message": "Sunday is a weekly holiday.",
        }

    if is_second_or_fourth_saturday(check_date):
        return {
            "is_holiday": True,
            "holiday_type": "weekly",
            "title": "Saturday Holiday",
            "message": "Second and fourth Saturday are weekly holidays.",
        }

    return None


def holiday_info_for_employee(db, employee, check_date):
    state = employee_state(employee)
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    date_str = check_date.isoformat()

    manual = db.holiday_calendar.find_one({
        "tenant_id": tenant_id,
        "state": state,
        "date": date_str,
        "status": {"$ne": "inactive"},
        "is_deleted": {"$ne": True},
    })

    if manual:
        return {
            "is_holiday": True,
            "holiday_type": "manual",
            "state": state,
            "title": manual.get("title", "Holiday"),
            "message": manual.get("message", ""),
            "holiday": clean_doc(manual),
        }

    weekly = weekly_holiday_reason(check_date)

    if weekly:
        weekly["state"] = state
        return weekly

    return {
        "is_holiday": False,
        "holiday_type": "",
        "state": state,
        "title": "",
        "message": "",
    }


def available_attendance_modes(db, employee, check_date):
    modes = ["office"]
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    emp_id = str(employee["_id"])
    date_str = check_date.isoformat()

    for mode in ["wfh", "field"]:
        approved = db.attendance_mode_requests.find_one({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "mode": mode,
            "date": date_str,
            "status": "approved",
            "is_deleted": {"$ne": True},
        })

        if approved:
            modes.append(mode)

    return modes


def department_summary(db, tenant_id):
    pipeline = [
        {
            "$match": {
                "tenant_id": tenant_id,
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            }
        },
        {
            "$group": {
                "_id": {"$ifNull": ["$department", "Unassigned"]},
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"count": -1, "_id": 1}},
    ]

    rows = list(db.employees.aggregate(pipeline))

    return [
        {
            "department": row.get("_id") or "Unassigned",
            "count": row.get("count", 0),
        }
        for row in rows
    ]


def designation_summary(db, tenant_id):
    pipeline = [
        {
            "$match": {
                "tenant_id": tenant_id,
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            }
        },
        {
            "$group": {
                "_id": {"$ifNull": ["$designation", "Unassigned"]},
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"count": -1, "_id": 1}},
    ]

    rows = list(db.employees.aggregate(pipeline))

    return [
        {
            "designation": row.get("_id") or "Unassigned",
            "count": row.get("count", 0),
        }
        for row in rows
    ]


def employee_snapshot(employee, roles=None):
    if not employee:
        return None

    roles = set(roles or [])
    is_team_leader = is_team_leader_capability(employee, roles)
    is_reporting_officer = is_reporting_officer_capability(employee, roles)
    display_name = employee.get("name") or employee.get("employee_name") or "Employee"

    return {
        "_id": employee.get("_id"),
        "tenant_id": employee.get("tenant_id"),
        "user_id": employee.get("user_id"),
        "employee_id": employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "name": display_name,
        "display_name": display_name,
        "dashboard_title": display_name,
        "dashboard_subtitle": "Employee Dashboard",
        "display_role": "Employee",
        "email": employee.get("email", ""),
        "phone": employee.get("phone", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "role": "Employee",
        "raw_role": employee.get("role", ""),
        "branch": employee.get("branch", ""),
        "state": employee_state(employee),
        "shift": employee.get("shift", ""),
        "joining_date": employee.get("joining_date") or employee.get("doj", ""),
        "employment_status": employee.get("employment_status") or employee.get("status", ""),
        "status": employee.get("status", ""),
        "is_team_leader": is_team_leader,
        "is_reporting_officer": is_reporting_officer,
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
    }


def scoped_employee_ids_for_manager(db, tenant_id, emp_id, roles, employee=None):
    scope_or = []
    employee = employee or {}

    if is_team_leader_capability(employee, roles):
        scope_or.append({"team_leader_id": emp_id})

    if is_reporting_officer_capability(employee, roles):
        scope_or.append({"reporting_officer_id": emp_id})

    if not scope_or:
        return []

    rows = list(
        db.employees.find({
            "tenant_id": tenant_id,
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
            "$or": scope_or,
        })
    )

    return [str(row["_id"]) for row in rows]


def pending_leave_scope_for_employee_capability(tenant_id, emp_id, employee, roles):
    stage_or = []

    if is_team_leader_capability(employee, roles):
        stage_or.append({
            "team_leader_id": emp_id,
            "approval_stage": "team_leader",
        })

    if is_reporting_officer_capability(employee, roles):
        stage_or.append({
            "reporting_officer_id": emp_id,
            "approval_stage": "reporting_officer",
        })

    if not stage_or:
        return None

    return {
        "tenant_id": tenant_id,
        "status": "pending",
        "is_deleted": {"$ne": True},
        "$or": stage_or,
    }


def pending_attendance_mode_scope_for_employee_capability(tenant_id, emp_id, employee, roles):
    stage_or = []

    if is_team_leader_capability(employee, roles):
        stage_or.append({
            "team_leader_id": emp_id,
            "approval_stage": "team_leader",
        })

    if is_reporting_officer_capability(employee, roles):
        stage_or.append({
            "reporting_officer_id": emp_id,
            "approval_stage": "reporting_officer",
        })

    if not stage_or:
        return None

    return {
        "tenant_id": tenant_id,
        "status": "pending",
        "is_deleted": {"$ne": True},
        "$or": stage_or,
    }


def base_active_query(tenant_id):
    return {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }


# -----------------------------------------------------------------------------
# Project analytics helpers
# -----------------------------------------------------------------------------

def active_project_query(tenant_id, extra=None):
    q = {
        "tenant_id": tenant_id,
        "status": "active",
        "is_deleted": {"$ne": True},
    }
    q.update(extra or {})
    return q


def completed_project_query(tenant_id, extra=None):
    q = {
        "tenant_id": tenant_id,
        "status": "completed",
        "is_deleted": {"$ne": True},
    }
    q.update(extra or {})
    return q


def project_scope_for_employee(tenant_id, emp_id):
    return {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": [
            {"created_by_employee_id": emp_id},
            {"team_leader_id": emp_id},
            {"assigned_to_id": emp_id},
            {"assigned_employee_ids": emp_id},
            {"collaborator_ids": emp_id},
            {"collaborators.employee_id": emp_id},
        ],
    }


def project_scope_for_team_leader(tenant_id, emp_id):
    return {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": [
            {"created_by_employee_id": emp_id},
            {"team_leader_id": emp_id},
        ],
    }


def project_scope_for_reporting_officer(tenant_id, team_leader_ids):
    if not team_leader_ids:
        return {
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "_id": {"$exists": False},
        }

    return {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": [
            {"created_by_employee_id": {"$in": team_leader_ids}},
            {"team_leader_id": {"$in": team_leader_ids}},
        ],
    }


def latest_project_progress_map(db, tenant_id, project_ids):
    if not project_ids:
        return {}

    logs = list(
        db.project_progress
        .find({
            "tenant_id": tenant_id,
            "project_id": {"$in": project_ids},
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
    )

    latest = {}

    for log in logs:
        project_id = log.get("project_id")

        if project_id and project_id not in latest:
            latest[project_id] = log

    return latest


def project_progress_average(db, tenant_id, project_ids):
    if not project_ids:
        return 0

    logs = list(
        db.project_progress
        .find({
            "tenant_id": tenant_id,
            "project_id": {"$in": project_ids},
            "is_deleted": {"$ne": True},
        }, {"progress_percent": 1, "percentage": 1, "progress": 1})
    )

    values = []

    for log in logs:
        raw_value = (
            log.get("progress_percent")
            if log.get("progress_percent") is not None
            else log.get("percentage")
            if log.get("percentage") is not None
            else log.get("progress")
        )

        try:
            values.append(float(raw_value))
        except Exception:
            pass

    if not values:
        return 0

    return round(sum(values) / len(values), 2)


def project_daily_progress_chart(db, tenant_id, project_ids=None, days=14):
    today = date.today()
    start = today - timedelta(days=max(days - 1, 1))
    match = {
        "tenant_id": tenant_id,
        "date": {
            "$gte": start.isoformat(),
            "$lte": today.isoformat(),
        },
        "is_deleted": {"$ne": True},
    }

    if project_ids is not None:
        match["project_id"] = {"$in": project_ids}

    logs = list(db.project_progress.find(match))

    day_map = {}

    for i in range(days):
        cursor = start + timedelta(days=i)
        day_map[cursor.isoformat()] = {
            "date": cursor.isoformat(),
            "updates": 0,
            "average_progress": 0,
            "_total": 0,
        }

    for log in logs:
        log_date = normalize_text(log.get("date"))

        if not log_date:
            created_at = log.get("created_at")

            if isinstance(created_at, datetime):
                log_date = created_at.date().isoformat()

        if log_date not in day_map:
            continue

        raw_progress = (
            log.get("progress_percent")
            if log.get("progress_percent") is not None
            else log.get("percentage")
            if log.get("percentage") is not None
            else log.get("progress")
        )

        try:
            progress_value = float(raw_progress)
        except Exception:
            progress_value = 0

        day_map[log_date]["updates"] += 1
        day_map[log_date]["_total"] += progress_value

    chart = []

    for row in day_map.values():
        updates = row["updates"]
        total = row.pop("_total", 0)
        row["average_progress"] = round(total / updates, 2) if updates else 0
        chart.append(row)

    return chart


def serialize_project_cards(db, tenant_id, projects):
    project_ids = [str(project["_id"]) for project in projects]
    latest_map = latest_project_progress_map(db, tenant_id, project_ids)

    cards = []

    for project in projects:
        pid = str(project["_id"])
        latest = latest_map.get(pid) or {}

        latest_progress = (
            latest.get("progress_percent")
            if latest.get("progress_percent") is not None
            else latest.get("percentage")
            if latest.get("percentage") is not None
            else latest.get("progress")
        )

        try:
            latest_progress = float(latest_progress)
        except Exception:
            latest_progress = 0

        cards.append({
            "_id": pid,
            "name": project_name(project),
            "project_name": project_name(project),
            "status": normalize_project_status(project.get("status")),
            "department": project.get("department", ""),
            "team_leader_id": project.get("team_leader_id", ""),
            "team_leader_name": project.get("team_leader_name", ""),
            "assigned_employee_ids": project.get("assigned_employee_ids", []),
            "assigned_members": project.get("assigned_members", []),
            "collaborator_ids": project.get("collaborator_ids", []),
            "collaborators": project.get("collaborators", []),
            "created_at": project.get("created_at"),
            "completed_at": project.get("completed_at"),
            "latest_progress": latest_progress,
            "latest_progress_note": latest.get("note") or latest.get("description") or "",
            "latest_progress_date": latest.get("date") or "",
            "latest_progress_by_name": latest.get("employee_name") or latest.get("created_by_name") or "",
        })

    return cards


def department_project_performance(db, tenant_id):
    projects = list(
        db.projects
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        }, {
            "department": 1,
            "status": 1,
        })
    )

    department_map = {}

    for project in projects:
        department = normalize_text(project.get("department")) or "Unassigned"

        if department not in department_map:
            department_map[department] = {
                "department": department,
                "total_projects": 0,
                "active_projects": 0,
                "completed_projects": 0,
                "completion_rate": 0,
                "score": 0,
            }

        row = department_map[department]
        row["total_projects"] += 1

        status = normalize_project_status(project.get("status"))

        if status == "active":
            row["active_projects"] += 1

        if status == "completed":
            row["completed_projects"] += 1

    for row in department_map.values():
        total = row["total_projects"]
        completed = row["completed_projects"]
        active = row["active_projects"]

        row["completion_rate"] = round((completed / total) * 100, 2) if total else 0
        row["score"] = round(row["completion_rate"] + min(active * 2, 20), 2)

    return sorted(
        department_map.values(),
        key=lambda item: (item["score"], item["completed_projects"], item["active_projects"]),
        reverse=True,
    )


def team_leader_project_performance(db, tenant_id, team_leader_ids=None):
    q = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }

    if team_leader_ids is not None:
        q["team_leader_id"] = {"$in": team_leader_ids}

    projects = list(
        db.projects
        .find(q, {
            "team_leader_id": 1,
            "team_leader_name": 1,
            "status": 1,
            "department": 1,
        })
    )

    leader_map = {}

    for project in projects:
        leader_id = project.get("team_leader_id") or "unassigned"
        leader_name = project.get("team_leader_name") or "Unassigned"

        if leader_id not in leader_map:
            leader_map[leader_id] = {
                "team_leader_id": leader_id,
                "team_leader_name": leader_name,
                "department": project.get("department", ""),
                "total_projects": 0,
                "active_projects": 0,
                "completed_projects": 0,
                "completion_rate": 0,
            }

        row = leader_map[leader_id]
        row["total_projects"] += 1

        status = normalize_project_status(project.get("status"))

        if status == "active":
            row["active_projects"] += 1

        if status == "completed":
            row["completed_projects"] += 1

    for row in leader_map.values():
        total = row["total_projects"]
        completed = row["completed_projects"]
        row["completion_rate"] = round((completed / total) * 100, 2) if total else 0

    return sorted(
        leader_map.values(),
        key=lambda item: (item["completion_rate"], item["completed_projects"]),
        reverse=True,
    )



def to_float(value, default=0):
    try:
        if value is None or value == "":
            return float(default)
        return float(value)
    except Exception:
        return float(default)


def bounded_percentage(value):
    return max(0, min(100, round(to_float(value, 0), 2)))


def latest_project_progress_value(progress_log):
    progress_log = progress_log or {}
    raw_value = (
        progress_log.get("progress_percent")
        if progress_log.get("progress_percent") is not None
        else progress_log.get("percentage")
        if progress_log.get("percentage") is not None
        else progress_log.get("progress")
    )
    return bounded_percentage(raw_value)


def project_wise_performance(db, tenant_id, limit=100):
    projects = list(
        db.projects
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(limit)
    )

    project_ids = [str(project["_id"]) for project in projects]
    latest_map = latest_project_progress_map(db, tenant_id, project_ids)
    rows = []

    for project in projects:
        project_id = str(project["_id"])
        latest = latest_map.get(project_id) or {}
        status = normalize_project_status(project.get("status"))
        latest_progress = latest_project_progress_value(latest)

        if status == "completed" and latest_progress == 0:
            latest_progress = 100

        assigned_employee_ids = project.get("assigned_employee_ids") or []
        collaborators = project.get("collaborator_ids") or []

        rows.append({
            "project_id": project_id,
            "_id": project_id,
            "name": project_name(project),
            "project_name": project_name(project),
            "department": normalize_text(project.get("department")) or "Unassigned",
            "status": status,
            "team_leader_id": project.get("team_leader_id", ""),
            "team_leader_name": project.get("team_leader_name", "") or "Unassigned",
            "assigned_count": len(assigned_employee_ids) if isinstance(assigned_employee_ids, list) else 0,
            "collaborator_count": len(collaborators) if isinstance(collaborators, list) else 0,
            "latest_progress": latest_progress,
            "progress_percent": latest_progress,
            "latest_progress_date": latest.get("date") or "",
            "latest_progress_note": latest.get("note") or latest.get("description") or "",
            "created_at": project.get("created_at"),
            "completed_at": project.get("completed_at"),
            "score": latest_progress + (20 if status == "completed" else 0),
        })

    return sorted(
        rows,
        key=lambda item: (item["score"], item["latest_progress"], item["project_name"]),
        reverse=True,
    )


def project_status_chart(db, tenant_id):
    projects = list(
        db.projects.find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        }, {"status": 1})
    )

    status_map = {}

    for project in projects:
        status = normalize_project_status(project.get("status"))
        status_map[status] = status_map.get(status, 0) + 1

    return [
        {"status": key, "label": key.replace("_", " ").title(), "count": value}
        for key, value in sorted(status_map.items())
    ]


def performance_rating_value(review):
    raw_value = (
        review.get("rating")
        if review.get("rating") is not None
        else review.get("score")
        if review.get("score") is not None
        else review.get("performance_score")
    )
    return to_float(raw_value, 0)


def performance_rating_bucket(rating):
    if rating >= 4.5:
        return "Excellent"
    if rating >= 3.5:
        return "Good"
    if rating >= 2.5:
        return "Average"
    if rating > 0:
        return "Needs Improvement"
    return "Not Rated"


def performance_summary_from_reviews(reviews):
    ratings = [performance_rating_value(review) for review in reviews]
    ratings = [rating for rating in ratings if rating > 0]
    distribution = {
        "Excellent": 0,
        "Good": 0,
        "Average": 0,
        "Needs Improvement": 0,
        "Not Rated": 0,
    }

    for rating in ratings:
        distribution[performance_rating_bucket(rating)] += 1

    total = len(reviews)
    rated = len(ratings)
    average_rating = round(sum(ratings) / rated, 2) if rated else 0

    return {
        "total_reviews": total,
        "rated_reviews": rated,
        "average_rating": average_rating,
        "rating_percentage": round((average_rating / 5) * 100, 2) if average_rating else 0,
        "distribution": [
            {"label": key, "count": value}
            for key, value in distribution.items()
        ],
    }


def employee_lookup_map(employees):
    return {
        str(employee["_id"]): employee
        for employee in employees
        if employee.get("_id")
    }


def performance_chart_for_members(db, tenant_id, member_ids, reviewer_id=None, title="Performance"):
    member_ids = [str(member_id) for member_id in member_ids if normalize_text(member_id)]

    if not member_ids:
        return {
            "title": title,
            "summary": performance_summary_from_reviews([]),
            "members": [],
            "rating_distribution": performance_summary_from_reviews([])["distribution"],
            "recent_reviews": [],
        }

    q = {
        "tenant_id": tenant_id,
        "employee_id": {"$in": member_ids},
        "is_deleted": {"$ne": True},
    }

    if reviewer_id:
        q["reviewer_employee_id"] = reviewer_id

    reviews = list(
        db.performance_reviews
        .find(q)
        .sort("created_at", -1)
        .limit(500)
    )

    employees = list(
        db.employees.find({
            "tenant_id": tenant_id,
            "_id": {"$in": [ObjectId(member_id) for member_id in member_ids if ObjectId.is_valid(member_id)]},
            "is_deleted": {"$ne": True},
        })
    )
    lookup = employee_lookup_map(employees)
    grouped = {}

    for member_id in member_ids:
        employee = lookup.get(member_id, {})
        grouped[member_id] = {
            "employee_id": member_id,
            "employee_name": employee.get("name") or employee.get("employee_name") or "Employee",
            "emp_code": employee_code(employee) if employee else "",
            "department": employee.get("department", "") if employee else "",
            "designation": employee.get("designation", "") if employee else "",
            "total_reviews": 0,
            "average_rating": 0,
            "rating_percentage": 0,
            "latest_rating": 0,
            "latest_review_date": "",
            "latest_review_by_name": "",
            "_rating_total": 0,
            "_rating_count": 0,
        }

    for review in reviews:
        member_id = review.get("employee_id")

        if member_id not in grouped:
            continue

        rating = performance_rating_value(review)
        row = grouped[member_id]
        row["total_reviews"] += 1

        if rating > 0:
            row["_rating_total"] += rating
            row["_rating_count"] += 1

        if not row["latest_review_date"]:
            row["latest_rating"] = rating
            row["latest_review_date"] = review.get("review_date") or review.get("date") or review.get("created_at") or ""
            row["latest_review_by_name"] = review.get("reviewer_name") or review.get("reviewer_employee_name") or ""

    member_rows = []

    for row in grouped.values():
        rating_count = row.pop("_rating_count", 0)
        rating_total = row.pop("_rating_total", 0)
        row["average_rating"] = round(rating_total / rating_count, 2) if rating_count else 0
        row["rating_percentage"] = round((row["average_rating"] / 5) * 100, 2) if row["average_rating"] else 0
        row["rating_label"] = performance_rating_bucket(row["average_rating"])
        member_rows.append(row)

    member_rows = sorted(
        member_rows,
        key=lambda item: (item["average_rating"], item["total_reviews"], item["employee_name"]),
        reverse=True,
    )

    summary = performance_summary_from_reviews(reviews)

    return {
        "title": title,
        "summary": summary,
        "members": member_rows,
        "rating_distribution": summary["distribution"],
        "recent_reviews": clean_doc(reviews[:10]),
    }


def performance_received_chart(db, tenant_id, employee_id, title="My Performance"):
    reviews = list(
        db.performance_reviews
        .find({
            "tenant_id": tenant_id,
            "employee_id": employee_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(100)
    )

    summary = performance_summary_from_reviews(reviews)

    return {
        "title": title,
        "summary": summary,
        "rating_distribution": summary["distribution"],
        "recent_reviews": clean_doc(reviews[:10]),
    }


def project_dashboard_for_employee(db, tenant_id, emp_id, employee, roles, team_member_ids=None, reporting_member_ids=None):
    team_member_ids = team_member_ids or []
    reporting_member_ids = reporting_member_ids or []

    my_scope = project_scope_for_employee(tenant_id, emp_id)
    my_projects = list(
        db.projects
        .find(my_scope)
        .sort("created_at", -1)
        .limit(50)
    )

    active_projects = [
        project for project in my_projects
        if normalize_project_status(project.get("status")) == "active"
    ]

    completed_projects = [
        project for project in my_projects
        if normalize_project_status(project.get("status")) == "completed"
    ]

    team_leader_projects = []
    team_project_ids = []

    if is_team_leader_capability(employee, roles):
        team_leader_projects = list(
            db.projects
            .find(project_scope_for_team_leader(tenant_id, emp_id))
            .sort("created_at", -1)
            .limit(100)
        )
        team_project_ids = [str(project["_id"]) for project in team_leader_projects]

    reporting_projects = []
    reporting_project_ids = []

    if is_reporting_officer_capability(employee, roles):
        team_leaders = list(
            db.employees
            .find({
                "tenant_id": tenant_id,
                "reporting_officer_id": emp_id,
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            }, {"_id": 1})
        )

        team_leader_ids = [str(row["_id"]) for row in team_leaders]
        reporting_projects = list(
            db.projects
            .find(project_scope_for_reporting_officer(tenant_id, team_leader_ids))
            .sort("created_at", -1)
            .limit(200)
        )
        reporting_project_ids = [str(project["_id"]) for project in reporting_projects]

    all_project_ids = list({
        str(project["_id"])
        for project in my_projects + team_leader_projects + reporting_projects
    })

    recent_progress = list(
        db.project_progress
        .find({
            "tenant_id": tenant_id,
            "project_id": {"$in": all_project_ids} if all_project_ids else [],
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(20)
    )

    return {
        "my_projects": serialize_project_cards(db, tenant_id, my_projects),
        "active_projects": serialize_project_cards(db, tenant_id, active_projects),
        "completed_projects": serialize_project_cards(db, tenant_id, completed_projects),
        "team_leader_projects": serialize_project_cards(db, tenant_id, team_leader_projects),
        "reporting_projects": serialize_project_cards(db, tenant_id, reporting_projects),
        "recent_progress": clean_doc(recent_progress),
        "daily_progress_chart": project_daily_progress_chart(db, tenant_id, all_project_ids, 14),
        "team_daily_progress_chart": project_daily_progress_chart(db, tenant_id, team_project_ids, 14),
        "reporting_daily_progress_chart": project_daily_progress_chart(db, tenant_id, reporting_project_ids, 14),
        "team_leader_performance": team_leader_project_performance(
            db,
            tenant_id,
            [emp_id] if is_team_leader_capability(employee, roles) else [],
        ) if is_team_leader_capability(employee, roles) else [],
        "reporting_team_leader_performance": team_leader_project_performance(
            db,
            tenant_id,
            [
                str(row["_id"])
                for row in db.employees.find({
                    "tenant_id": tenant_id,
                    "reporting_officer_id": emp_id,
                    "status": {"$ne": "Inactive"},
                    "is_deleted": {"$ne": True},
                }, {"_id": 1})
            ],
        ) if is_reporting_officer_capability(employee, roles) else [],
        "summary": {
            "my_total_projects": len(my_projects),
            "my_active_projects": len(active_projects),
            "my_completed_projects": len(completed_projects),
            "team_total_projects": len(team_leader_projects),
            "team_active_projects": len([
                project for project in team_leader_projects
                if normalize_project_status(project.get("status")) == "active"
            ]),
            "team_completed_projects": len([
                project for project in team_leader_projects
                if normalize_project_status(project.get("status")) == "completed"
            ]),
            "reporting_total_projects": len(reporting_projects),
            "reporting_active_projects": len([
                project for project in reporting_projects
                if normalize_project_status(project.get("status")) == "active"
            ]),
            "reporting_completed_projects": len([
                project for project in reporting_projects
                if normalize_project_status(project.get("status")) == "completed"
            ]),
            "average_progress": project_progress_average(db, tenant_id, all_project_ids),
        },
    }


def tenant_project_analytics(db, tenant_id):
    all_projects = list(
        db.projects
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(300)
    )

    all_project_ids = [str(project["_id"]) for project in all_projects]
    active_projects = [
        project for project in all_projects
        if normalize_project_status(project.get("status")) == "active"
    ]
    completed_projects = [
        project for project in all_projects
        if normalize_project_status(project.get("status")) == "completed"
    ]

    department_performance = department_project_performance(db, tenant_id)
    project_performance = project_wise_performance(db, tenant_id, 150)

    return {
        "summary": {
            "total_projects": len(all_projects),
            "active_projects": len(active_projects),
            "completed_projects": len(completed_projects),
            "average_progress": project_progress_average(db, tenant_id, all_project_ids),
        },
        "active_projects": serialize_project_cards(db, tenant_id, active_projects[:20]),
        "completed_projects": serialize_project_cards(db, tenant_id, completed_projects[:20]),
        "daily_progress_chart": project_daily_progress_chart(db, tenant_id, all_project_ids, 14),
        "department_performance": department_performance,
        "top_performing_departments": department_performance[:8],
        "project_performance": project_performance,
        "project_wise_performance": project_performance,
        "top_project_performance": project_performance[:12],
        "project_status_chart": project_status_chart(db, tenant_id),
        "team_leader_performance": team_leader_project_performance(db, tenant_id)[:12],
    }


@dashboard_bp.get("/superadmin")
@current_user_required
def superadmin_dashboard():
    db = get_db()

    if not has_role("super_admin"):
        return jsonify({"message": "Forbidden"}), 403

    tenants = list(
        db.tenants
        .find({})
        .sort("created_at", -1)
        .limit(8)
    )

    today = date.today().isoformat()

    stats = {
        "Companies": db.tenants.count_documents({}),
        "Active Companies": db.tenants.count_documents({"status": "active"}),
        "Total Users": db.users.count_documents({}),
        "Active Users": db.users.count_documents({"is_active": True}),
        "Total Employees": db.employees.count_documents(active_employee_filter()),
        "Total Projects": db.projects.count_documents({"is_deleted": {"$ne": True}}),
        "Active Projects": db.projects.count_documents({"status": "active", "is_deleted": {"$ne": True}}),
        "Completed Projects": db.projects.count_documents({"status": "completed", "is_deleted": {"$ne": True}}),
        "Total Attendance Logs": db.attendance_logs.count_documents({
            "is_deleted": {"$ne": True},
        }),
        "Present Today": db.attendance_logs.count_documents({
            "date": today,
            "status": {"$in": PRESENT_ATTENDANCE_STATUSES},
            "is_deleted": {"$ne": True},
        }),
        "Late Today": db.attendance_logs.count_documents({
            "date": today,
            "status": "late",
            "is_deleted": {"$ne": True},
        }),
        "Holiday Work Today": db.attendance_logs.count_documents({
            "date": today,
            "is_holiday_work": True,
            "is_deleted": {"$ne": True},
        }),
        "Pending WFH/Field Requests": db.attendance_mode_requests.count_documents({
            "status": "pending",
            "is_deleted": {"$ne": True},
        }),
        "Available Comp-Off Credits": db.compoff_credits.count_documents({
            "status": "available",
            "is_deleted": {"$ne": True},
        }),
        "Open Tickets": db.tickets.count_documents({
            "status": {"$in": ["open", "in_progress"]},
            "is_deleted": {"$ne": True},
        }),
        "Pending Leaves": db.leave_requests.count_documents({
            "status": "pending",
            "is_deleted": {"$ne": True},
        }),
        "Approved Leaves": db.leave_requests.count_documents({
            "status": "approved",
            "is_deleted": {"$ne": True},
        }),
        "Pending Password Requests": db.password_requests.count_documents({
            "status": "pending",
            "is_deleted": {"$ne": True},
        }),
        "Payroll Runs": db.payroll_runs.count_documents({
            "is_deleted": {"$ne": True},
        }),
        "Audit Logs": db.audit_logs.count_documents({}),
    }

    tenant_summary = []

    for tenant in tenants:
        tenant_id = tenant.get("tenant_id")

        tenant_summary.append({
            "tenant_id": tenant_id,
            "name": tenant.get("name"),
            "status": tenant.get("status"),
            "users": db.users.count_documents({"tenant_id": tenant_id}),
            "employees": db.employees.count_documents(
                active_employee_filter({"tenant_id": tenant_id})
            ),
            "projects": db.projects.count_documents({
                "tenant_id": tenant_id,
                "is_deleted": {"$ne": True},
            }),
            "active_projects": db.projects.count_documents({
                "tenant_id": tenant_id,
                "status": "active",
                "is_deleted": {"$ne": True},
            }),
            "completed_projects": db.projects.count_documents({
                "tenant_id": tenant_id,
                "status": "completed",
                "is_deleted": {"$ne": True},
            }),
            "present_today": db.attendance_logs.count_documents({
                "tenant_id": tenant_id,
                "date": today,
                "status": {"$in": PRESENT_ATTENDANCE_STATUSES},
                "is_deleted": {"$ne": True},
            }),
            "late_today": db.attendance_logs.count_documents({
                "tenant_id": tenant_id,
                "date": today,
                "status": "late",
                "is_deleted": {"$ne": True},
            }),
            "pending_wfh_field": db.attendance_mode_requests.count_documents({
                "tenant_id": tenant_id,
                "status": "pending",
                "is_deleted": {"$ne": True},
            }),
            "pending_leaves": db.leave_requests.count_documents({
                "tenant_id": tenant_id,
                "status": "pending",
                "is_deleted": {"$ne": True},
            }),
            "open_tickets": db.tickets.count_documents({
                "tenant_id": tenant_id,
                "status": {"$in": ["open", "in_progress"]},
                "is_deleted": {"$ne": True},
            }),
            "departments": db.departments.count_documents({
                "tenant_id": tenant_id,
                "status": {"$ne": "inactive"},
                "is_deleted": {"$ne": True},
            }),
            "designations": db.designations.count_documents({
                "tenant_id": tenant_id,
                "status": {"$ne": "inactive"},
                "is_deleted": {"$ne": True},
            }),
        })

    recent_users = list(
        db.users
        .find({}, {"password_hash": 0})
        .sort("created_at", -1)
        .limit(8)
    )

    recent_audit = list(
        db.audit_logs
        .find({})
        .sort("created_at", -1)
        .limit(8)
    )

    recent_attendance = list(
        db.attendance_logs
        .find({"is_deleted": {"$ne": True}})
        .sort("created_at", -1)
        .limit(8)
    )

    pending_mode_requests = list(
        db.attendance_mode_requests
        .find({"status": "pending", "is_deleted": {"$ne": True}})
        .sort("created_at", -1)
        .limit(8)
    )

    pending_leave_requests = list(
        db.leave_requests
        .find({"status": "pending", "is_deleted": {"$ne": True}})
        .sort("created_at", -1)
        .limit(8)
    )

    default_tenant_id = current_tenant_id()
    project_analytics = tenant_project_analytics(db, default_tenant_id)

    return jsonify({
        "stats": stats,
        "tenants": clean_doc(tenant_summary),
        "recent_users": clean_doc(recent_users),
        "recent_audit": clean_doc(recent_audit),
        "recent_attendance": clean_doc(recent_attendance),
        "pending_mode_requests": clean_doc(pending_mode_requests),
        "pending_leave_requests": clean_doc(enrich_leave_requests(pending_leave_requests)),
        "project_analytics": clean_doc(project_analytics),
        "department_project_performance": clean_doc(project_analytics.get("department_performance", [])),
        "top_performing_departments": clean_doc(project_analytics.get("top_performing_departments", [])),
        "project_daily_progress_chart": clean_doc(project_analytics.get("daily_progress_chart", [])),
        "project_wise_performance": clean_doc(project_analytics.get("project_wise_performance", [])),
        "top_project_performance": clean_doc(project_analytics.get("top_project_performance", [])),
        "project_status_chart": clean_doc(project_analytics.get("project_status_chart", [])),
    })


@dashboard_bp.get("/admin")
@current_user_required
def admin_dashboard():
    db = get_db()
    roles = current_roles()

    if not is_admin_dashboard_role_set(roles):
        return jsonify({"message": "Forbidden"}), 403

    tenant_id = current_tenant_id()
    today = date.today().isoformat()

    total_employees = count_collection(
        db,
        "employees",
        active_employee_filter(),
    )

    checked_today = count_collection(
        db,
        "attendance_logs",
        {
            "date": today,
            "is_deleted": {"$ne": True},
        },
    )

    project_analytics = tenant_project_analytics(db, tenant_id)

    stats = {
        "Total Employees": total_employees,
        "Total Projects": project_analytics["summary"]["total_projects"],
        "Active Projects": project_analytics["summary"]["active_projects"],
        "Completed Projects": project_analytics["summary"]["completed_projects"],
        "Average Project Progress": project_analytics["summary"]["average_progress"],
        "Present Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "status": {"$in": PRESENT_ATTENDANCE_STATUSES},
                "is_deleted": {"$ne": True},
            },
        ),
        "Late Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "status": "late",
                "is_deleted": {"$ne": True},
            },
        ),
        "Early Checkout Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "is_early_checkout": True,
                "is_deleted": {"$ne": True},
            },
        ),
        "Holiday Work Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "is_holiday_work": True,
                "is_deleted": {"$ne": True},
            },
        ),
        "WFH Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "mode": "wfh",
                "is_deleted": {"$ne": True},
            },
        ),
        "Field Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "mode": "field",
                "is_deleted": {"$ne": True},
            },
        ),
        "Absent Today": max(0, total_employees - checked_today),
        "On Leave": count_collection(
            db,
            "leave_requests",
            {
                "status": "approved",
                "is_deleted": {"$ne": True},
            },
        ),
        "Pending Leaves": count_collection(
            db,
            "leave_requests",
            {
                "status": "pending",
                "is_deleted": {"$ne": True},
            },
        ),
        "Pending WFH/Field": count_collection(
            db,
            "attendance_mode_requests",
            {
                "status": "pending",
                "is_deleted": {"$ne": True},
            },
        ),
        "Available Comp-Off": count_collection(
            db,
            "compoff_credits",
            {
                "status": "available",
                "is_deleted": {"$ne": True},
            },
        ),
        "Open Tickets": count_collection(
            db,
            "tickets",
            {
                "status": {"$in": ["open", "in_progress"]},
                "is_deleted": {"$ne": True},
            },
        ),
        "Pending Expenses": count_collection(
            db,
            "expenses",
            {
                "status": "pending",
                "is_deleted": {"$ne": True},
            },
        ),
        "Candidates": count_collection(
            db,
            "candidates",
            {"is_deleted": {"$ne": True}},
        ),
        "Assets Assigned": count_collection(
            db,
            "assets",
            {
                "status": "assigned",
                "is_deleted": {"$ne": True},
            },
        ),
        "Departments": count_collection(
            db,
            "departments",
            {
                "status": {"$ne": "inactive"},
                "is_deleted": {"$ne": True},
            },
        ),
        "Designations": count_collection(
            db,
            "designations",
            {
                "status": {"$ne": "inactive"},
                "is_deleted": {"$ne": True},
            },
        ),
    }

    departments = list(
        db.departments
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort("name", 1)
    )

    designations = list(
        db.designations
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort("title", 1)
    )

    recent_employees = list(
        db.employees
        .find({
            "tenant_id": tenant_id,
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    recent_attendance = list(
        db.attendance_logs
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    pending_leave_requests = list(
        db.leave_requests
        .find({
            "tenant_id": tenant_id,
            "status": "pending",
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(5)
    )

    pending = {
        "leave_requests": enrich_leave_requests(pending_leave_requests),
        "attendance_mode_requests": list(
            db.attendance_mode_requests
            .find({
                "tenant_id": tenant_id,
                "status": "pending",
                "is_deleted": {"$ne": True},
            })
            .sort("created_at", -1)
            .limit(5)
        ),
        "expenses": list(
            db.expenses
            .find({
                "tenant_id": tenant_id,
                "status": "pending",
                "is_deleted": {"$ne": True},
            })
            .sort("created_at", -1)
            .limit(5)
        ),
        "tickets": list(
            db.tickets
            .find({
                "tenant_id": tenant_id,
                "status": {"$in": ["open", "in_progress"]},
                "is_deleted": {"$ne": True},
            })
            .sort("created_at", -1)
            .limit(5)
        ),
    }

    holidays_today = list(
        db.holiday_calendar
        .find({
            "tenant_id": tenant_id,
            "date": today,
            "status": {"$ne": "inactive"},
            "is_deleted": {"$ne": True},
        })
        .sort("state", 1)
    )

    compoff_recent = list(
        db.compoff_credits
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    current_emp = current_employee(db)
    team_scope_ids = []
    my_pending_leave_approvals = []
    my_pending_attendance_mode_requests = []

    if current_emp:
        current_emp_id = str(current_emp["_id"])
        team_scope_ids = scoped_employee_ids_for_manager(
            db,
            tenant_id,
            current_emp_id,
            roles,
            current_emp,
        )

        leave_scope = pending_leave_scope_for_employee_capability(
            tenant_id,
            current_emp_id,
            current_emp,
            roles,
        )

        if leave_scope:
            my_pending_leave_approvals = list(
                db.leave_requests
                .find(leave_scope)
                .sort("created_at", -1)
                .limit(8)
            )

        mode_scope = pending_attendance_mode_scope_for_employee_capability(
            tenant_id,
            current_emp_id,
            current_emp,
            roles,
        )

        if mode_scope:
            my_pending_attendance_mode_requests = list(
                db.attendance_mode_requests
                .find(mode_scope)
                .sort("created_at", -1)
                .limit(8)
            )

    my_pending_leave_approvals = enrich_leave_requests(my_pending_leave_approvals)

    if my_pending_leave_approvals:
        stats["My Pending Leave Approvals"] = len(my_pending_leave_approvals)

    if my_pending_attendance_mode_requests:
        stats["My Pending WFH/Field Approvals"] = len(my_pending_attendance_mode_requests)

    return jsonify({
        "stats": stats,
        "today": today,
        "roles": list(roles),
        "employee_summary": clean_doc(employee_snapshot(current_emp, roles)) if current_emp else None,
        "team_scope_employee_ids": team_scope_ids,
        "my_pending_leave_approvals": clean_doc(my_pending_leave_approvals),
        "my_pending_attendance_mode_requests": clean_doc(my_pending_attendance_mode_requests),
        "holidays_today": clean_doc(holidays_today),
        "departments": clean_doc(departments),
        "designations": clean_doc(designations),
        "department_summary": clean_doc(department_summary(db, tenant_id)),
        "designation_summary": clean_doc(designation_summary(db, tenant_id)),
        "recent_employees": clean_doc(recent_employees),
        "recent_attendance": clean_doc(recent_attendance),
        "recent_compoffs": clean_doc(compoff_recent),
        "pending": clean_doc(pending),
        "project_analytics": clean_doc(project_analytics),
        "department_project_performance": clean_doc(project_analytics.get("department_performance", [])),
        "top_performing_departments": clean_doc(project_analytics.get("top_performing_departments", [])),
        "project_daily_progress_chart": clean_doc(project_analytics.get("daily_progress_chart", [])),
        "project_wise_performance": clean_doc(project_analytics.get("project_wise_performance", [])),
        "top_project_performance": clean_doc(project_analytics.get("top_project_performance", [])),
        "project_status_chart": clean_doc(project_analytics.get("project_status_chart", [])),
    })


@dashboard_bp.get("/employee")
@current_user_required
def employee_dashboard():
    db = get_db()
    roles = current_roles()

    emp = current_employee(db)

    if not emp:
        return jsonify({
            "employee": None,
            "employee_summary": None,
            "dashboard_display": {
                "title": "Employee Dashboard",
                "subtitle": "Employee profile not found",
                "display_role": "Employee",
            },
            "roles": list(roles),
            "is_team_leader": False,
            "is_reporting_officer": False,
            "team_members": [],
            "reporting_members": [],
            "team_pending_leaves": [],
            "team_pending_attendance_mode_requests": [],
            "my_performance_reviews": [],
            "reviews_given": [],
            "my_performance_chart": {},
            "team_performance_chart": {},
            "reporting_performance_chart": {},
            "performance_summary": {},
            "today_attendance": None,
            "holiday": None,
            "available_attendance_modes": ["office"],
            "attendance_mode_requests": [],
            "leave_balances": [],
            "leave_balance_summary": leave_balance_summary([]),
            "compoff_credits": [],
            "leaves": [],
            "tickets": [],
            "notifications": [],
            "project_dashboard": {},
            "projects": [],
            "active_projects": [],
            "completed_projects": [],
        })

    tenant_id = emp.get("tenant_id") or current_tenant_id()
    emp_id = str(emp["_id"])
    today_date = date.today()
    today = today_date.isoformat()

    is_team_leader_role = is_team_leader_capability(emp, roles)
    is_reporting_officer_role = is_reporting_officer_capability(emp, roles)
    employee_name = emp.get("name") or emp.get("employee_name") or "Employee"

    team_members = []

    if is_team_leader_role:
        team_members = list(
            db.employees
            .find({
                "tenant_id": tenant_id,
                "team_leader_id": emp_id,
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            })
            .sort("name", 1)
        )

    reporting_members = []

    if is_reporting_officer_role:
        reporting_members = list(
            db.employees
            .find({
                "tenant_id": tenant_id,
                "reporting_officer_id": emp_id,
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            })
            .sort("name", 1)
        )

    team_member_ids = [str(member["_id"]) for member in team_members]
    reporting_member_ids = [str(member["_id"]) for member in reporting_members]
    team_scope_ids = list(set(team_member_ids + reporting_member_ids))

    my_reviews = list(
        db.performance_reviews
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(10)
    )

    reviews_given = list(
        db.performance_reviews
        .find({
            "tenant_id": tenant_id,
            "reviewer_employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(10)
    )

    today_attendance = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": emp_id,
        "date": today,
        "is_deleted": {"$ne": True},
    })

    holiday = holiday_info_for_employee(db, emp, today_date)
    available_modes = available_attendance_modes(db, emp, today_date)

    attendance_mode_requests = list(
        db.attendance_mode_requests
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    leave_balances = list(
        db.leave_balances
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("leave_type", 1)
    )

    compoff_credits = list(
        db.compoff_credits
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    leaves = list(
        db.leave_requests
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(20)
    )

    leaves = enrich_leave_requests(leaves)

    tickets = list(
        db.tickets
        .find({
            "tenant_id": tenant_id,
            "raised_by": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(5)
    )

    notifications = list(
        db.notifications
        .find({
            "tenant_id": tenant_id,
            "user_id": str(g.current_user["_id"]),
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    team_pending_leaves = []
    team_pending_attendance_mode_requests = []

    leave_approval_scope = pending_leave_scope_for_employee_capability(
        tenant_id,
        emp_id,
        emp,
        roles,
    )

    if leave_approval_scope:
        team_pending_leaves = list(
            db.leave_requests
            .find(leave_approval_scope)
            .sort("created_at", -1)
            .limit(20)
        )

    team_pending_leaves = enrich_leave_requests(team_pending_leaves)

    mode_approval_scope = pending_attendance_mode_scope_for_employee_capability(
        tenant_id,
        emp_id,
        emp,
        roles,
    )

    if mode_approval_scope:
        team_pending_attendance_mode_requests = list(
            db.attendance_mode_requests
            .find(mode_approval_scope)
            .sort("created_at", -1)
            .limit(10)
        )

    project_dashboard = project_dashboard_for_employee(
        db,
        tenant_id,
        emp_id,
        emp,
        roles,
        team_member_ids,
        reporting_member_ids,
    )

    my_performance_chart = performance_received_chart(
        db,
        tenant_id,
        emp_id,
        "My Performance Reviews",
    )

    team_performance_chart = performance_chart_for_members(
        db,
        tenant_id,
        team_member_ids,
        emp_id if is_team_leader_role else None,
        "Team Member Performance",
    ) if is_team_leader_role else {
        "title": "Team Member Performance",
        "summary": performance_summary_from_reviews([]),
        "members": [],
        "rating_distribution": performance_summary_from_reviews([])["distribution"],
        "recent_reviews": [],
    }

    reporting_performance_chart = performance_chart_for_members(
        db,
        tenant_id,
        reporting_member_ids,
        emp_id if is_reporting_officer_role else None,
        "Team Leader Performance by Reporting Officer",
    ) if is_reporting_officer_role else {
        "title": "Team Leader Performance by Reporting Officer",
        "summary": performance_summary_from_reviews([]),
        "members": [],
        "rating_distribution": performance_summary_from_reviews([])["distribution"],
        "recent_reviews": [],
    }

    performance_summary = {
        "my_average_rating": my_performance_chart.get("summary", {}).get("average_rating", 0),
        "team_average_rating": team_performance_chart.get("summary", {}).get("average_rating", 0),
        "reporting_average_rating": reporting_performance_chart.get("summary", {}).get("average_rating", 0),
        "reviews_received": my_performance_chart.get("summary", {}).get("total_reviews", 0),
        "reviews_given": len(reviews_given),
        "team_reviews_given": team_performance_chart.get("summary", {}).get("total_reviews", 0),
        "reporting_reviews_given": reporting_performance_chart.get("summary", {}).get("total_reviews", 0),
    }

    balance_summary = leave_balance_summary(leave_balances)

    return jsonify({
        "employee": clean_doc(emp),
        "employee_summary": clean_doc(employee_snapshot(emp, roles)),
        "dashboard_display": {
            "title": employee_name,
            "subtitle": "Employee Dashboard",
            "display_role": "Employee",
            "show_name_as_primary_heading": True,
        },
        "roles": list(roles),
        "is_team_leader": bool(is_team_leader_role),
        "is_reporting_officer": bool(is_reporting_officer_role),
        "capabilities": {
            "is_team_leader": bool(is_team_leader_role),
            "is_reporting_officer": bool(is_reporting_officer_role),
            "can_approve_leave": bool(team_pending_leaves),
            "can_approve_attendance_mode": bool(team_pending_attendance_mode_requests),
            "can_manage_projects": bool(is_team_leader_role or is_reporting_officer_role),
            "can_update_project_progress": True,
        },
        "team_members": clean_doc(team_members),
        "reporting_members": clean_doc(reporting_members),
        "team_member_count": len(team_members),
        "reporting_member_count": len(reporting_members),
        "pending_approval_counts": {
            "leave_requests": len(team_pending_leaves),
            "attendance_mode_requests": len(team_pending_attendance_mode_requests),
        },
        "team_pending_leaves": clean_doc(team_pending_leaves),
        "team_pending_attendance_mode_requests": clean_doc(team_pending_attendance_mode_requests),
        "my_performance_reviews": clean_doc(my_reviews),
        "reviews_given": clean_doc(reviews_given),
        "my_performance_chart": clean_doc(my_performance_chart),
        "team_performance_chart": clean_doc(team_performance_chart),
        "reporting_performance_chart": clean_doc(reporting_performance_chart),
        "performance_summary": clean_doc(performance_summary),
        "today_attendance": clean_doc(today_attendance),
        "holiday": clean_doc(holiday),
        "available_attendance_modes": available_modes,
        "attendance_mode_requests": clean_doc(attendance_mode_requests),
        "leave_balances": clean_doc(leave_balances),
        "leave_balance_summary": clean_doc(balance_summary),
        "total_leave_available": balance_summary.get("total_available", 0),
        "total_leave_used": balance_summary.get("total_used", 0),
        "total_leave_credited": balance_summary.get("total_credited", 0),
        "compoff_credits": clean_doc(compoff_credits),
        "leaves": clean_doc(leaves),
        "tickets": clean_doc(tickets),
        "notifications": clean_doc(notifications),
        "project_dashboard": clean_doc(project_dashboard),
        "projects": clean_doc(project_dashboard.get("my_projects", [])),
        "active_projects": clean_doc(project_dashboard.get("active_projects", [])),
        "completed_projects": clean_doc(project_dashboard.get("completed_projects", [])),
        "team_leader_projects": clean_doc(project_dashboard.get("team_leader_projects", [])),
        "reporting_projects": clean_doc(project_dashboard.get("reporting_projects", [])),
        "project_daily_progress_chart": clean_doc(project_dashboard.get("daily_progress_chart", [])),
        "team_project_daily_progress_chart": clean_doc(project_dashboard.get("team_daily_progress_chart", [])),
        "reporting_project_daily_progress_chart": clean_doc(project_dashboard.get("reporting_daily_progress_chart", [])),
    })