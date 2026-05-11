from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime, date, timedelta

from app.extensions import get_db
from app.utils.auth import current_user_required, audit
from app.utils.serializers import clean_doc


projects_bp = Blueprint("projects", __name__)


ADMIN_VIEW_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}

PROJECT_CREATOR_ROLES = {
    "team_leader",
    "reporting_officer",
}

PROJECT_WRITE_STATUSES = {
    "active",
    "on_hold",
    "completed",
}


# -----------------------------------------------------------------------------
# Common helpers
# -----------------------------------------------------------------------------

def safe_object_id(value):
    try:
        return ObjectId(str(value))
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


def truthy(value):
    return str(value or "").strip().lower() in {"true", "1", "yes", "on"}


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


def employee_roles(employee):
    if not employee:
        return set()

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
    return bool(
        employee
        and (
            truthy(employee.get("is_team_leader"))
            or "team_leader" in employee_roles(employee)
        )
    )


def employee_is_reporting_officer(employee):
    return bool(
        employee
        and (
            truthy(employee.get("is_reporting_officer"))
            or "reporting_officer" in employee_roles(employee)
            or "ro" in employee_roles(employee)
        )
    )


def is_admin_view_user():
    return bool(current_user_roles().intersection(ADMIN_VIEW_ROLES))


def can_create_assign_or_collaborate_projects(db):
    """
    New rule:
    Only Team Leader and Reporting Officer capability users can create projects,
    assign team members, or add collaborators.
    """
    roles = current_user_roles()
    employee = get_current_employee(db)

    return bool(
        roles.intersection(PROJECT_CREATOR_ROLES)
        or employee_is_team_leader(employee)
        or employee_is_reporting_officer(employee)
    )


def project_member_ids(project):
    ids = set()

    for key in [
        "created_by_employee_id",
        "team_leader_id",
        "assigned_to_id",
    ]:
        value = normalize_text(project.get(key))
        if value:
            ids.add(value)

    for key in ["assigned_employee_ids", "collaborator_ids"]:
        values = project.get(key, [])
        if isinstance(values, list):
            ids.update(normalize_text(value) for value in values if normalize_text(value))

    for item in project.get("assigned_members", []):
        if isinstance(item, dict):
            value = normalize_text(item.get("employee_id") or item.get("_id"))
            if value:
                ids.add(value)

    for item in project.get("collaborators", []):
        if isinstance(item, dict):
            value = normalize_text(item.get("employee_id") or item.get("_id"))
            if value:
                ids.add(value)

    return ids


def can_view_project(db, project):
    if is_admin_view_user():
        return True

    employee = get_current_employee(db)

    if not employee:
        return False

    return str(employee["_id"]) in project_member_ids(project)


def can_update_project_status_or_progress(db, project):
    """
    New rule:
    Normal employees/team members can only view projects in scope and update
    project status/progress. They cannot create, assign, or add collaborators.
    """
    employee = get_current_employee(db)

    if employee and str(employee["_id"]) in project_member_ids(project):
        return True

    return False


def project_scope_query(db):
    tenant_id = current_tenant_id()

    q = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }

    if is_admin_view_user():
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
        {"assigned_members.employee_id": employee_id},
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


# -----------------------------------------------------------------------------
# Employee/member resolution helpers
# -----------------------------------------------------------------------------

def resolve_employee(db, employee_id, tenant_id=None):
    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return None

    q = {
        "_id": employee_obj_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    }

    if tenant_id:
        q["tenant_id"] = tenant_id
    else:
        q["tenant_id"] = current_tenant_id()

    return db.employees.find_one(q)


def employee_member_payload(employee):
    return {
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "employee_name": employee_display_name(employee),
        "email": employee.get("email", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "user_id": employee.get("user_id", ""),
    }


def normalize_employee_id_list(value):
    if value is None:
        return []

    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = value.split(",")
    else:
        raw_values = [value]

    cleaned = []
    seen = set()

    for item in raw_values:
        if isinstance(item, dict):
            raw = item.get("employee_id") or item.get("_id") or item.get("id")
        else:
            raw = item

        employee_id = normalize_text(raw)

        if employee_id and employee_id not in seen:
            seen.add(employee_id)
            cleaned.append(employee_id)

    return cleaned


def resolve_member_list(db, tenant_id, employee_ids):
    resolved_ids = []
    members = []

    for employee_id in normalize_employee_id_list(employee_ids):
        employee = resolve_employee(db, employee_id, tenant_id)

        if not employee:
            raise ValueError("One or more selected employees were not found")

        resolved_ids.append(str(employee["_id"]))
        members.append(employee_member_payload(employee))

    return resolved_ids, members


def resolve_team_leader_for_project(db, tenant_id, data, creator_employee):
    raw_team_leader_id = normalize_text(data.get("team_leader_id"))

    if raw_team_leader_id:
        team_leader = resolve_employee(db, raw_team_leader_id, tenant_id)

        if not team_leader:
            raise ValueError("Selected Team Leader was not found")

        if not employee_is_team_leader(team_leader):
            raise ValueError("Selected Team Leader must have Team Leader capability")

        return team_leader

    if creator_employee and employee_is_team_leader(creator_employee):
        return creator_employee

    return None


# -----------------------------------------------------------------------------
# Progress/chart helpers
# -----------------------------------------------------------------------------

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
        if latest.get("progress") is not None
        else project.get("latest_progress")
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
        "start_date": project.get("start_date", ""),
        "due_date": project.get("due_date", ""),
        "priority": project.get("priority", "medium"),
        "team_leader_id": project.get("team_leader_id", ""),
        "team_leader_name": project.get("team_leader_name", ""),
        "assigned_to_id": project.get("assigned_to_id", ""),
        "assigned_to_name": project.get("assigned_to_name", ""),
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
        "latest_progress_note": latest.get("note") or latest.get("description") or project.get("latest_progress_note", ""),
        "latest_progress_date": latest.get("date") or project.get("latest_progress_date", ""),
        "latest_progress_by_name": latest.get("employee_name") or latest.get("created_by_name") or project.get("latest_progress_by_name", ""),
        "can_create_assign_collaborate": False,
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
                "on_hold_projects": 0,
                "completed_projects": 0,
                "average_progress": 0,
                "completion_rate": 0,
                "score": 0,
                "_project_ids": [],
            }

        row = department_map[department]
        row["total_projects"] += 1
        row["_project_ids"].append(str(project["_id"]))

        status = normalize_status(project.get("status"))

        if status == "active":
            row["active_projects"] += 1
        elif status == "on_hold":
            row["on_hold_projects"] += 1
        elif status == "completed":
            row["completed_projects"] += 1

    for row in department_map.values():
        total = row["total_projects"]
        completed = row["completed_projects"]
        active = row["active_projects"]
        project_ids = row.pop("_project_ids", [])

        row["average_progress"] = project_progress_average(db, tenant_id, project_ids)
        row["completion_rate"] = round((completed / total) * 100, 2) if total else 0
        row["score"] = round(row["completion_rate"] + row["average_progress"] * 0.35 + min(active * 2, 20), 2)

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
                "on_hold_projects": 0,
                "completed_projects": 0,
                "average_progress": 0,
                "completion_rate": 0,
                "_project_ids": [],
            }

        row = leader_map[leader_id]
        row["total_projects"] += 1
        row["_project_ids"].append(str(project["_id"]))

        status = normalize_status(project.get("status"))

        if status == "active":
            row["active_projects"] += 1
        elif status == "on_hold":
            row["on_hold_projects"] += 1
        elif status == "completed":
            row["completed_projects"] += 1

    for row in leader_map.values():
        total = row["total_projects"]
        completed = row["completed_projects"]
        project_ids = row.pop("_project_ids", [])

        row["average_progress"] = project_progress_average(db, tenant_id, project_ids)
        row["completion_rate"] = round((completed / total) * 100, 2) if total else 0

    return sorted(
        leader_map.values(),
        key=lambda item: (item["completion_rate"], item["average_progress"], item["completed_projects"]),
        reverse=True,
    )


def status_project_chart(projects):
    status_map = {
        "active": {"status": "active", "count": 0},
        "on_hold": {"status": "on_hold", "count": 0},
        "completed": {"status": "completed", "count": 0},
    }

    for project in projects:
        status = normalize_status(project.get("status"))

        if status not in status_map:
            status_map[status] = {"status": status, "count": 0}

        status_map[status]["count"] += 1

    return list(status_map.values())


def project_wise_performance(db, tenant_id, projects):
    project_ids = [str(project["_id"]) for project in projects]
    latest_map = latest_project_progress_map(db, tenant_id, project_ids)

    rows = []

    for project in projects:
        latest = latest_map.get(str(project["_id"]))
        card = project_card(project, latest)
        card["average_progress"] = project_progress_average(db, tenant_id, [str(project["_id"])])
        rows.append(card)

    return sorted(
        rows,
        key=lambda item: (item.get("latest_progress", 0), item.get("average_progress", 0)),
        reverse=True,
    )


# -----------------------------------------------------------------------------
# Project CRUD APIs
# -----------------------------------------------------------------------------

@projects_bp.get("")
@current_user_required
def list_projects():
    db = get_db()
    tenant_id = current_tenant_id()
    q = project_scope_query(db)

    status = normalize_text(request.args.get("status"))
    search = normalize_text(request.args.get("q") or request.args.get("search"))
    department = normalize_text(request.args.get("department"))

    if status:
        q["status"] = normalize_status(status)

    if department:
        q["department"] = department

    if search:
        q["$and"] = q.get("$and", []) + [{
            "$or": [
                {"name": {"$regex": search, "$options": "i"}},
                {"project_name": {"$regex": search, "$options": "i"}},
                {"title": {"$regex": search, "$options": "i"}},
                {"description": {"$regex": search, "$options": "i"}},
                {"department": {"$regex": search, "$options": "i"}},
                {"team_leader_name": {"$regex": search, "$options": "i"}},
            ]
        }]

    projects = list(
        db.projects
        .find(q)
        .sort("created_at", -1)
        .limit(1000)
    )

    project_ids = [str(project["_id"]) for project in projects]
    latest_map = latest_project_progress_map(db, tenant_id, project_ids)
    can_manage = can_create_assign_or_collaborate_projects(db)

    items = []

    for project in projects:
        item = project_card(project, latest_map.get(str(project["_id"])))
        item["can_create_assign_collaborate"] = can_manage
        item["can_update_status_progress"] = can_update_project_status_or_progress(db, project)
        items.append(item)

    return jsonify({
        "items": clean_doc(items),
        "can_create_assign_collaborate": can_manage,
        "can_create_projects": can_manage,
        "can_assign_projects": can_manage,
        "can_add_collaborators": can_manage,
    })


@projects_bp.post("")
@current_user_required
def create_project():
    db = get_db()

    if not can_create_assign_or_collaborate_projects(db):
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can create projects"
        }), 403

    creator_employee = get_current_employee(db)

    if not creator_employee:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}
    tenant_id = creator_employee.get("tenant_id") or current_tenant_id()

    name = normalize_text(
        data.get("name")
        or data.get("project_name")
        or data.get("title")
    )

    if not name:
        return jsonify({"message": "Project name is required"}), 400

    status = normalize_status(data.get("status") or "active")

    if status not in PROJECT_WRITE_STATUSES:
        return jsonify({"message": "Project status must be active, on_hold, or completed"}), 400

    try:
        team_leader = resolve_team_leader_for_project(db, tenant_id, data, creator_employee)
        assigned_employee_ids, assigned_members = resolve_member_list(
            db,
            tenant_id,
            data.get("assigned_employee_ids") or data.get("assigned_members") or [],
        )
        collaborator_ids, collaborators = resolve_member_list(
            db,
            tenant_id,
            data.get("collaborator_ids") or data.get("collaborators") or [],
        )
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400

    team_leader_id = str(team_leader["_id"]) if team_leader else ""
    team_leader_name = employee_display_name(team_leader) if team_leader else ""

    now = now_utc()

    doc = {
        "tenant_id": tenant_id,
        "name": name,
        "project_name": name,
        "title": name,
        "description": normalize_text(data.get("description")),
        "department": normalize_text(data.get("department") or creator_employee.get("department")),
        "status": status,
        "priority": normalize_text(data.get("priority") or "medium"),
        "start_date": normalize_text(data.get("start_date")),
        "due_date": normalize_text(data.get("due_date")),
        "team_leader_id": team_leader_id,
        "team_leader_name": team_leader_name,
        "assigned_to_id": assigned_employee_ids[0] if assigned_employee_ids else "",
        "assigned_to_name": assigned_members[0]["employee_name"] if assigned_members else "",
        "assigned_employee_ids": assigned_employee_ids,
        "assigned_members": assigned_members,
        "collaborator_ids": collaborator_ids,
        "collaborators": collaborators,
        "latest_progress": 0,
        "latest_progress_note": "",
        "latest_progress_date": "",
        "latest_progress_by": "",
        "latest_progress_by_name": "",
        "created_by_employee_id": str(creator_employee["_id"]),
        "created_by_employee_name": employee_display_name(creator_employee),
        "created_by": current_user_id(),
        "created_by_name": current_user_name(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
        "created_at": now,
        "updated_at": now,
        "completed_at": now if status == "completed" else "",
        "is_deleted": False,
    }

    result = db.projects.insert_one(doc)
    doc["_id"] = result.inserted_id

    audit("create_project", "projects", result.inserted_id, {
        "name": name,
        "status": status,
    })

    return jsonify({
        "message": "Project created successfully",
        "item": clean_doc(project_card(doc)),
    }), 201


@projects_bp.patch("/<project_id>")
@current_user_required
def update_project(project_id):
    db = get_db()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    if not can_create_assign_or_collaborate_projects(db):
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can edit project details"
        }), 403

    data = request.get_json(silent=True) or {}
    update = {}

    for key in ["description", "department", "priority", "start_date", "due_date"]:
        if key in data:
            update[key] = normalize_text(data.get(key))

    if any(key in data for key in ["name", "project_name", "title"]):
        name = normalize_text(data.get("name") or data.get("project_name") or data.get("title"))

        if not name:
            return jsonify({"message": "Project name cannot be empty"}), 400

        update["name"] = name
        update["project_name"] = name
        update["title"] = name

    if "status" in data:
        status = normalize_status(data.get("status"))

        if status not in PROJECT_WRITE_STATUSES:
            return jsonify({"message": "Project status must be active, on_hold, or completed"}), 400

        update["status"] = status
        update["completed_at"] = now_utc() if status == "completed" else ""

    if not update:
        return jsonify({"message": "No project fields received for update"}), 400

    update.update({
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    })

    db.projects.update_one(
        {"_id": project["_id"]},
        {"$set": update},
    )

    updated = db.projects.find_one({"_id": project["_id"]})

    audit("update_project", "projects", project_id, update)

    return jsonify({
        "message": "Project updated successfully",
        "item": clean_doc(project_card(updated)),
    })


@projects_bp.patch("/<project_id>/assign")
@current_user_required
def assign_project(project_id):
    db = get_db()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    if not can_create_assign_or_collaborate_projects(db):
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can assign team members"
        }), 403

    data = request.get_json(silent=True) or {}
    tenant_id = project.get("tenant_id") or current_tenant_id()

    try:
        assigned_employee_ids, assigned_members = resolve_member_list(
            db,
            tenant_id,
            data.get("assigned_employee_ids") or data.get("assigned_members") or [],
        )
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400

    update = {
        "assigned_to_id": assigned_employee_ids[0] if assigned_employee_ids else "",
        "assigned_to_name": assigned_members[0]["employee_name"] if assigned_members else "",
        "assigned_employee_ids": assigned_employee_ids,
        "assigned_members": assigned_members,
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    db.projects.update_one(
        {"_id": project["_id"]},
        {"$set": update},
    )

    updated = db.projects.find_one({"_id": project["_id"]})

    audit("assign_project", "projects", project_id, update)

    return jsonify({
        "message": "Project members assigned successfully",
        "item": clean_doc(project_card(updated)),
    })


@projects_bp.patch("/<project_id>/collaborators")
@current_user_required
def update_project_collaborators(project_id):
    db = get_db()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    if not can_create_assign_or_collaborate_projects(db):
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can add collaborators"
        }), 403

    data = request.get_json(silent=True) or {}
    tenant_id = project.get("tenant_id") or current_tenant_id()

    try:
        collaborator_ids, collaborators = resolve_member_list(
            db,
            tenant_id,
            data.get("collaborator_ids") or data.get("collaborators") or [],
        )
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400

    update = {
        "collaborator_ids": collaborator_ids,
        "collaborators": collaborators,
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    db.projects.update_one(
        {"_id": project["_id"]},
        {"$set": update},
    )

    updated = db.projects.find_one({"_id": project["_id"]})

    audit("update_project_collaborators", "projects", project_id, update)

    return jsonify({
        "message": "Project collaborators updated successfully",
        "item": clean_doc(project_card(updated)),
    })


@projects_bp.patch("/<project_id>/status")
@current_user_required
def update_project_status(project_id):
    db = get_db()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    if not can_update_project_status_or_progress(db, project):
        return jsonify({
            "message": "You do not have permission to update status for this project"
        }), 403

    data = request.get_json(silent=True) or {}
    status = normalize_status(data.get("status"))

    if status not in PROJECT_WRITE_STATUSES:
        return jsonify({"message": "Project status must be active, on_hold, or completed"}), 400

    update = {
        "status": status,
        "completed_at": now_utc() if status == "completed" else "",
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    db.projects.update_one(
        {"_id": project["_id"]},
        {"$set": update},
    )

    updated = db.projects.find_one({"_id": project["_id"]})

    audit("update_project_status", "projects", project_id, update)

    return jsonify({
        "message": "Project status updated successfully",
        "item": clean_doc(project_card(updated)),
    })


@projects_bp.delete("/<project_id>")
@current_user_required
def delete_project(project_id):
    db = get_db()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    if not can_create_assign_or_collaborate_projects(db):
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can delete projects"
        }), 403

    db.projects.update_one(
        {"_id": project["_id"]},
        {
            "$set": {
                "is_deleted": True,
                "deleted_at": now_utc(),
                "deleted_by": current_user_id(),
                "deleted_by_name": current_user_name(),
            }
        },
    )

    audit("delete_project", "projects", project_id)

    return jsonify({"message": "Project deleted successfully"})


# -----------------------------------------------------------------------------
# Analytics APIs
# -----------------------------------------------------------------------------

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

    on_hold_projects = [
        project for project in projects
        if normalize_status(project.get("status")) == "on_hold"
    ]

    completed_projects = [
        project for project in projects
        if normalize_status(project.get("status")) == "completed"
    ]

    latest_map = latest_project_progress_map(db, tenant_id, project_ids)
    dept_performance = department_project_performance(db, tenant_id)
    team_leader_performance = team_leader_project_performance(db, tenant_id)
    project_performance = project_wise_performance(db, tenant_id, projects)

    return jsonify({
        "summary": {
            "total_projects": len(projects),
            "active_projects": len(active_projects),
            "on_hold_projects": len(on_hold_projects),
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
        "on_hold_projects": clean_doc([
            project_card(project, latest_map.get(str(project["_id"])))
            for project in on_hold_projects
        ]),
        "completed_projects": clean_doc([
            project_card(project, latest_map.get(str(project["_id"])))
            for project in completed_projects
        ]),
        "project_wise_performance": clean_doc(project_performance),
        "project_status_chart": clean_doc(status_project_chart(projects)),
        "daily_progress_chart": clean_doc(daily_progress_chart(db, tenant_id, project_ids, 14)),
        "department_performance": clean_doc(dept_performance),
        "top_performing_departments": clean_doc(dept_performance[:8]),
        "team_leader_performance": clean_doc(team_leader_performance[:12]),
        "permissions": {
            "can_create_assign_collaborate": can_create_assign_or_collaborate_projects(db),
            "can_create_projects": can_create_assign_or_collaborate_projects(db),
            "can_assign_projects": can_create_assign_or_collaborate_projects(db),
            "can_add_collaborators": can_create_assign_or_collaborate_projects(db),
        },
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

    if not can_update_project_status_or_progress(db, project):
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

    item = project_card(project, latest)
    item["can_create_assign_collaborate"] = can_create_assign_or_collaborate_projects(db)
    item["can_update_status_progress"] = can_update_project_status_or_progress(db, project)

    return jsonify({
        "item": clean_doc(item),
        "project": clean_doc(item),
        "progress": clean_doc(progress_items),
        "daily_progress_chart": clean_doc(daily_progress_chart(db, tenant_id, [project_id_str], 14)),
    })