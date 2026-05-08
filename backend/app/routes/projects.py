from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime, date, timedelta

from app.extensions import get_db
from app.utils.auth import current_user_required, audit
from app.utils.serializers import clean_doc


projects_bp = Blueprint("projects", __name__)


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


def safe_object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def normalize_text(value):
    return str(value or "").strip()


def normalize_status(value):
    status = normalize_text(value).lower()

    if status in {"completed", "complete", "done", "closed", "inactive"}:
        return "completed"

    if status in {"active", "ongoing", "in_progress", "in-progress", "open"}:
        return "active"

    if status in {"on_hold", "on-hold", "hold"}:
        return "on_hold"

    return status or "active"


def now_utc():
    return datetime.utcnow()


def today_str():
    return date.today().isoformat()


def current_tenant_id():
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id") or "sds"


def current_user_id():
    return str(g.current_user.get("_id") or g.current_user.get("id") or "")


def current_user_name():
    return (
        g.current_user.get("name")
        or g.current_user.get("full_name")
        or g.current_user.get("email")
        or g.current_user.get("username")
        or "User"
    )


def current_user_roles():
    roles = g.current_user.get("roles", [])

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

    role = normalize_text(g.current_user.get("role"))
    return {role} if role else set()


def truthy(value):
    return str(value or "").strip().lower() in {"true", "1", "yes", "on"}


def has_any_role(role_set):
    return bool(current_user_roles().intersection(role_set))


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


def employee_display_name(employee):
    if not employee:
        return ""

    return (
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("email")
        or "Employee"
    )


def employee_code(employee):
    if not employee:
        return ""

    return (
        employee.get("employee_id")
        or employee.get("emp_code")
        or employee.get("code")
        or ""
    )


def employee_is_team_leader(employee):
    return bool(employee and truthy(employee.get("is_team_leader")))


def employee_is_reporting_officer(employee):
    return bool(employee and truthy(employee.get("is_reporting_officer")))


def can_manage_projects(db):
    roles = current_user_roles()
    employee = get_current_employee(db)

    return bool(
        roles.intersection(PROJECT_MANAGER_ROLES)
        or employee_is_team_leader(employee)
        or employee_is_reporting_officer(employee)
    )


def can_update_project_progress(db, project):
    roles = current_user_roles()

    if roles.intersection(ADMIN_ROLES):
        return True

    employee = get_current_employee(db)

    if not employee:
        return False

    employee_id = str(employee["_id"])

    return bool(
        project.get("created_by_employee_id") == employee_id
        or project.get("team_leader_id") == employee_id
        or project.get("assigned_to_id") == employee_id
        or employee_id in project.get("assigned_employee_ids", [])
        or employee_id in project.get("collaborator_ids", [])
        or any(
            str(item.get("employee_id")) == employee_id
            for item in project.get("collaborators", [])
            if isinstance(item, dict)
        )
    )


def project_scope_query(db):
    tenant_id = current_tenant_id()
    roles = current_user_roles()

    q = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }

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


def project_name(project):
    return (
        project.get("name")
        or project.get("project_name")
        or project.get("title")
        or "Untitled Project"
    )


def get_project_or_404(db, project_id):
    project_obj_id = safe_object_id(project_id)

    if not project_obj_id:
        return None, (jsonify({"message": "Invalid project id"}), 400)

    q = project_scope_query(db)
    q["_id"] = project_obj_id

    project = db.projects.find_one(q)

    if not project:
        return None, (jsonify({"message": "Project not found or not in your scope"}), 404)

    return project, None


def normalize_progress_value(value):
    try:
        progress = float(value)
    except Exception:
        return None

    if progress < 0 or progress > 100:
        return None

    return progress


def parse_progress_date(value):
    raw = normalize_text(value)

    if not raw:
        return today_str()

    try:
        datetime.strptime(raw, "%Y-%m-%d")
        return raw
    except Exception:
        return today_str()


def latest_project_progress_map(db, tenant_id, project_ids):
    if not project_ids:
        return {}

    rows = list(
        db.project_progress
        .find({
            "tenant_id": tenant_id,
            "project_id": {"$in": project_ids},
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
    )

    latest = {}

    for row in rows:
        project_id = row.get("project_id")

        if project_id and project_id not in latest:
            latest[project_id] = row

    return latest


def project_card(project, latest=None):
    latest = latest or {}

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

    return {
        "_id": str(project["_id"]),
        "name": project_name(project),
        "project_name": project_name(project),
        "title": project_name(project),
        "description": project.get("description", ""),
        "status": normalize_status(project.get("status")),
        "department": project.get("department", ""),
        "team_leader_id": project.get("team_leader_id", ""),
        "team_leader_name": project.get("team_leader_name", ""),
        "assigned_employee_ids": project.get("assigned_employee_ids", []),
        "assigned_members": project.get("assigned_members", []),
        "collaborator_ids": project.get("collaborator_ids", []),
        "collaborators": project.get("collaborators", []),
        "created_by_employee_id": project.get("created_by_employee_id", ""),
        "created_by_employee_name": project.get("created_by_employee_name", ""),
        "created_at": project.get("created_at"),
        "updated_at": project.get("updated_at"),
        "completed_at": project.get("completed_at"),
        "latest_progress": latest_progress,
        "latest_progress_note": latest.get("note") or latest.get("description") or "",
        "latest_progress_date": latest.get("date") or "",
        "latest_progress_by_name": latest.get("employee_name") or latest.get("created_by_name") or "",
    }


def project_progress_average(db, tenant_id, project_ids):
    if not project_ids:
        return 0

    rows = list(
        db.project_progress.find({
            "tenant_id": tenant_id,
            "project_id": {"$in": project_ids},
            "is_deleted": {"$ne": True},
        })
    )

    values = []

    for row in rows:
        progress = normalize_progress_value(
            row.get("progress_percent")
            if row.get("progress_percent") is not None
            else row.get("percentage")
            if row.get("percentage") is not None
            else row.get("progress")
        )

        if progress is not None:
            values.append(progress)

    if not values:
        return 0

    return round(sum(values) / len(values), 2)


def daily_progress_chart(db, tenant_id, project_ids=None, days=14):
    end = date.today()
    start = end - timedelta(days=max(days - 1, 1))

    q = {
        "tenant_id": tenant_id,
        "date": {
            "$gte": start.isoformat(),
            "$lte": end.isoformat(),
        },
        "is_deleted": {"$ne": True},
    }

    if project_ids is not None:
        q["project_id"] = {"$in": project_ids}

    rows = list(db.project_progress.find(q))

    chart_map = {}

    for index in range(days):
        cursor = start + timedelta(days=index)

        chart_map[cursor.isoformat()] = {
            "date": cursor.isoformat(),
            "updates": 0,
            "average_progress": 0,
            "_total_progress": 0,
        }

    for row in rows:
        progress_date = normalize_text(row.get("date"))

        if progress_date not in chart_map:
            continue

        progress = normalize_progress_value(
            row.get("progress_percent")
            if row.get("progress_percent") is not None
            else row.get("percentage")
            if row.get("percentage") is not None
            else row.get("progress")
        )

        if progress is None:
            progress = 0

        chart_map[progress_date]["updates"] += 1
        chart_map[progress_date]["_total_progress"] += progress

    chart = []

    for item in chart_map.values():
        updates = item["updates"]
        total = item.pop("_total_progress", 0)
        item["average_progress"] = round(total / updates, 2) if updates else 0
        chart.append(item)

    return chart


def department_project_performance(db, tenant_id):
    projects = list(
        db.projects.find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
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

        status = normalize_status(project.get("status"))

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

    projects = list(db.projects.find(q))

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

        status = normalize_status(project.get("status"))

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


@projects_bp.get("/analytics")
@current_user_required
def project_analytics():
    db = get_db()
    tenant_id = current_tenant_id()

    q = project_scope_query(db)
    projects = list(
        db.projects
        .find(q)
        .sort("created_at", -1)
        .limit(500)
    )

    project_ids = [str(project["_id"]) for project in projects]

    active_projects = [
        project for project in projects
        if normalize_status(project.get("status")) == "active"
    ]

    completed_projects = [
        project for project in projects
        if normalize_status(project.get("status")) == "completed"
    ]

    latest_map = latest_project_progress_map(db, tenant_id, project_ids)

    return jsonify({
        "summary": {
            "total_projects": len(projects),
            "active_projects": len(active_projects),
            "completed_projects": len(completed_projects),
            "average_progress": project_progress_average(db, tenant_id, project_ids),
        },
        "projects": clean_doc([
            project_card(project, latest_map.get(str(project["_id"])))
            for project in projects
        ]),
        "active_projects": clean_doc([
            project_card(project, latest_map.get(str(project["_id"])))
            for project in active_projects
        ]),
        "completed_projects": clean_doc([
            project_card(project, latest_map.get(str(project["_id"])))
            for project in completed_projects
        ]),
        "daily_progress_chart": clean_doc(daily_progress_chart(db, tenant_id, project_ids, 14)),
        "department_performance": clean_doc(department_project_performance(db, tenant_id)),
        "top_performing_departments": clean_doc(department_project_performance(db, tenant_id)[:8]),
        "team_leader_performance": clean_doc(team_leader_project_performance(db, tenant_id)[:12]),
    })


@projects_bp.get("/my-progress")
@current_user_required
def my_project_progress():
    db = get_db()
    employee = get_current_employee(db)

    if not employee:
        return jsonify({"items": []})

    tenant_id = employee.get("tenant_id") or current_tenant_id()
    employee_id = str(employee["_id"])

    rows = list(
        db.project_progress
        .find({
            "tenant_id": tenant_id,
            "employee_id": employee_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(100)
    )

    return jsonify({
        "items": clean_doc(rows),
    })


@projects_bp.get("/<project_id>/progress")
@current_user_required
def list_project_progress(project_id):
    db = get_db()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    tenant_id = project.get("tenant_id") or current_tenant_id()
    project_id_str = str(project["_id"])

    rows = list(
        db.project_progress
        .find({
            "tenant_id": tenant_id,
            "project_id": project_id_str,
            "is_deleted": {"$ne": True},
        })
        .sort([("date", -1), ("created_at", -1)])
        .limit(200)
    )

    return jsonify({
        "project": clean_doc(project_card(project)),
        "items": clean_doc(rows),
    })


@projects_bp.post("/<project_id>/progress")
@current_user_required
def add_project_progress(project_id):
    db = get_db()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    if normalize_status(project.get("status")) == "completed":
        return jsonify({
            "message": "Progress cannot be added to a completed project"
        }), 400

    if not can_update_project_progress(db, project):
        return jsonify({
            "message": "You do not have permission to update progress for this project"
        }), 403

    employee = get_current_employee(db)

    if not employee:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}

    progress = normalize_progress_value(
        data.get("progress_percent")
        if data.get("progress_percent") is not None
        else data.get("percentage")
        if data.get("percentage") is not None
        else data.get("progress")
    )

    if progress is None:
        return jsonify({
            "message": "Progress percentage must be between 0 and 100"
        }), 400

    note = normalize_text(
        data.get("note")
        or data.get("description")
        or data.get("progress_note")
    )

    if not note:
        return jsonify({
            "message": "Daily progress note is required"
        }), 400

    tenant_id = project.get("tenant_id") or current_tenant_id()
    project_id_str = str(project["_id"])
    progress_date = parse_progress_date(data.get("date"))
    now = now_utc()

    doc = {
        "tenant_id": tenant_id,
        "project_id": project_id_str,
        "project_name": project_name(project),
        "project_status": normalize_status(project.get("status")),
        "department": project.get("department", ""),
        "team_leader_id": project.get("team_leader_id", ""),
        "team_leader_name": project.get("team_leader_name", ""),
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "employee_name": employee_display_name(employee),
        "employee_department": employee.get("department", ""),
        "employee_designation": employee.get("designation", ""),
        "progress_percent": progress,
        "percentage": progress,
        "progress": progress,
        "note": note,
        "description": note,
        "date": progress_date,
        "created_at": now,
        "updated_at": now,
        "created_by": current_user_id(),
        "created_by_name": current_user_name(),
        "is_deleted": False,
    }

    result = db.project_progress.insert_one(doc)
    doc["_id"] = result.inserted_id

    db.projects.update_one(
        {"_id": project["_id"]},
        {
            "$set": {
                "latest_progress": progress,
                "latest_progress_note": note,
                "latest_progress_date": progress_date,
                "latest_progress_by": str(employee["_id"]),
                "latest_progress_by_name": employee_display_name(employee),
                "updated_at": now,
                "updated_by": current_user_id(),
                "updated_by_name": current_user_name(),
            }
        },
    )

    audit("add_project_progress", "project_progress", result.inserted_id, {
        "project_id": project_id_str,
        "progress_percent": progress,
    })

    updated_project = db.projects.find_one({"_id": project["_id"]})

    return jsonify({
        "message": "Project progress submitted successfully",
        "item": clean_doc(doc),
        "project": clean_doc(project_card(updated_project, doc)),
    }), 201


@projects_bp.get("/<project_id>")
@current_user_required
def get_project_detail(project_id):
    db = get_db()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    tenant_id = project.get("tenant_id") or current_tenant_id()
    project_id_str = str(project["_id"])

    latest = db.project_progress.find_one({
        "tenant_id": tenant_id,
        "project_id": project_id_str,
        "is_deleted": {"$ne": True},
    }, sort=[("created_at", -1)])

    progress_items = list(
        db.project_progress
        .find({
            "tenant_id": tenant_id,
            "project_id": project_id_str,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(20)
    )

    return jsonify({
        "item": clean_doc(project_card(project, latest)),
        "project": clean_doc(project_card(project, latest)),
        "progress": clean_doc(progress_items),
        "daily_progress_chart": clean_doc(daily_progress_chart(db, tenant_id, [project_id_str], 14)),
    })