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
}

HR_PROJECT_BLOCKED_ROLES = {
    "hr_admin",
    "hr_manager",
    "hr",
}

PROJECT_CREATOR_ROLES = {
    "admin",
    "team_leader",
    "reporting_officer",
}

PROJECT_WRITE_STATUSES = {
    "active",
    "on_hold",
    "completed",
}

SELF_ASSIGN_ALIASES = {
    "self",
    "me",
    "myself",
    "current",
    "current_user",
    "current_employee",
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
    current_user = getattr(g, "current_user", {}) or {}

    if not user_id:
        return None

    user_email = normalize_email(
        current_user.get("email")
        or current_user.get("username")
        or current_user.get("official_email")
    )

    user_employee_id = normalize_text(
        current_user.get("employee_id")
        or current_user.get("employee_ref_id")
        or current_user.get("emp_code")
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
            {"emp_code": user_employee_id},
            {"employee_code": user_employee_id},
        ])

        user_employee_obj_id = safe_object_id(user_employee_id)

        if user_employee_obj_id:
            identifier_or.append({"_id": user_employee_obj_id})

    if user_email:
        identifier_or.extend([
            {"email": user_email},
            {"official_email": user_email},
        ])

    employee = db.employees.find_one({
        "tenant_id": current_tenant_id(),
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
    employee = get_current_employee(db)
    return str(employee["_id"]) if employee else ""


def employee_display_name(employee):
    if not employee:
        return ""

    return (
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or employee.get("email")
        or "Employee"
    )


def employee_code(employee):
    if not employee:
        return ""

    return (
        employee.get("employee_id")
        or employee.get("emp_code")
        or employee.get("employee_code")
        or employee.get("code")
        or ""
    )


def employee_identifier_values(employee):
    employee = employee or {}
    values = []

    raw_values = [
        employee.get("_id"),
        employee.get("id"),
        str(employee.get("_id")) if employee.get("_id") else "",
        employee.get("employee_id"),
        employee.get("employee_ref_id"),
        employee.get("employee_code"),
        employee.get("emp_code"),
        employee.get("code"),
        employee.get("user_id"),
        employee.get("email"),
        employee.get("official_email"),
    ]

    for value in raw_values:
        text_value = normalize_text(value)

        if not text_value:
            continue

        if text_value not in values:
            values.append(text_value)

        object_value = safe_object_id(text_value)

        if object_value and object_value not in values:
            values.append(object_value)

    return values


def employee_avatar(employee):
    if not employee:
        return ""

    return (
        employee.get("avatar")
        or employee.get("profile_photo")
        or employee.get("profile_picture")
        or employee.get("photo")
        or employee.get("image")
        or employee.get("picture")
        or ""
    )

def safe_employee_avatar(employee):
    """
    Never store base64/profile image blobs inside project documents.
    MongoDB has a 16MB document limit, and copying profile_photo/base64 into
    assigned_members/collaborators/project_team_tree can make project creation fail.
    Only keep normal URLs or small relative paths.
    """
    avatar = employee_avatar(employee)

    if not avatar:
        return ""

    avatar = str(avatar).strip()

    if avatar.startswith("data:image"):
        return ""

    if len(avatar) > 500:
        return ""

    return avatar

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


def is_admin_view_user():
    return bool(current_user_roles().intersection(ADMIN_VIEW_ROLES))


def is_hr_project_blocked_user():
    roles = current_user_roles()

    # Admin and Super Admin must always have Project module access,
    # even if the user also has HR Manager / HR role.
    if roles.intersection(ADMIN_VIEW_ROLES):
        return False

    # Block only pure HR users.
    return bool(roles.intersection(HR_PROJECT_BLOCKED_ROLES))


def hr_project_access_denied_response():
    return jsonify({
        "message": "HR users cannot access the Project module. Projects are available to Admin, Team Leaders, Reporting Officers and assigned employees."
    }), 403


def can_create_assign_or_collaborate_projects(db):
    """
    Rule:
    Admin / Managing Director can manage all projects.
    Team Leader and Reporting Officer capability users can manage scoped projects.
    """
    roles = current_user_roles()

    if roles.intersection(ADMIN_VIEW_ROLES):
        return True

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
        "reporting_officer_id",
        "assigned_to_id",
        "latest_progress_by",
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

    employee_id = str(employee["_id"])
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    return bool(project_member_ids(project).intersection(set(identifier_values)))


def can_update_project_status_or_progress(db, project):
    """
    Normal employees/team members can only view projects in scope and update
    project status/progress. They cannot create, assign, or add collaborators.
    """
    employee = get_current_employee(db)

    if not employee:
        return False

    employee_id = str(employee["_id"])
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    return bool(project_member_ids(project).intersection(set(identifier_values)))


def project_scope_query(db):
    tenant_id = current_tenant_id()

    tenant_filter = {
        "$or": [
            {"tenant_id": tenant_id},
            {"tenant_id": str(tenant_id or "").strip()},
            {"tenant_id": {"$exists": False}},
            {"tenant_id": None},
            {"tenant_id": ""},
        ]
    }

    q = {
        "$and": [
            tenant_filter,
            {"is_deleted": {"$ne": True}},
        ]
    }

    if is_hr_project_blocked_user():
        q["$and"].append({"_id": {"$exists": False}})
        return q

    if is_admin_view_user():
        return q

    employee = get_current_employee(db)

    if not employee:
        q["$and"].append({"_id": {"$exists": False}})
        return q

    employee_id = str(employee["_id"])
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    q["$and"].append({
        "$or": [
            {"created_by_employee_id": {"$in": identifier_values}},
            {"created_by": {"$in": identifier_values}},

            {"team_leader_id": {"$in": identifier_values}},
            {"reporting_officer_id": {"$in": identifier_values}},

            {"assigned_to_id": {"$in": identifier_values}},
            {"assigned_employee_ids": {"$in": identifier_values}},
            {"assigned_members.employee_id": {"$in": identifier_values}},
            {"assigned_members.user_id": {"$in": identifier_values}},
            {"assigned_members.employee_code": {"$in": identifier_values}},
            {"assigned_members.email": {"$in": identifier_values}},

            {"collaborator_ids": {"$in": identifier_values}},
            {"collaborators.employee_id": {"$in": identifier_values}},
            {"collaborators.user_id": {"$in": identifier_values}},
            {"collaborators.employee_code": {"$in": identifier_values}},
            {"collaborators.email": {"$in": identifier_values}},

            {"latest_progress_by": {"$in": identifier_values}},
        ]
    })

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
    raw_id = normalize_text(employee_id)

    if not raw_id:
        return None

    base = {
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    }

    if tenant_id:
        base["tenant_id"] = tenant_id
    else:
        base["tenant_id"] = current_tenant_id()

    identifier_or = [
        {"user_id": raw_id},
        {"employee_id": raw_id},
        {"employee_ref_id": raw_id},
        {"employee_code": raw_id},
        {"emp_code": raw_id},
        {"code": raw_id},
        {"email": normalize_email(raw_id)},
        {"official_email": normalize_email(raw_id)},
    ]

    employee_obj_id = safe_object_id(raw_id)

    if employee_obj_id:
        identifier_or.insert(0, {"_id": employee_obj_id})

    return db.employees.find_one({
        **base,
        "$or": identifier_or,
    })


def resolve_employee_by_user_id(db, user_id, tenant_id=None):
    if not user_id:
        return None

    q = {
        "user_id": str(user_id),
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    }

    if tenant_id:
        q["tenant_id"] = tenant_id
    else:
        q["tenant_id"] = current_tenant_id()

    return db.employees.find_one(q)


def employee_member_payload(employee, relation="member", include_avatar=True):
    if not employee:
        return {}

    avatar_value = employee_avatar(employee) if include_avatar else safe_employee_avatar(employee)

    return {
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "employee_name": employee_display_name(employee),
        "name": employee_display_name(employee),
        "display_name": employee_display_name(employee),
        "email": employee.get("email", ""),
        "phone": employee.get("phone", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "user_id": employee.get("user_id", ""),
        "avatar": avatar_value,
        "profile_photo": avatar_value,
        "profile_picture": avatar_value,
        "photo": avatar_value,
        "is_team_leader": truthy(employee.get("is_team_leader")),
        "is_reporting_officer": truthy(employee.get("is_reporting_officer")),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
        "relation": relation,
    }


def normalize_employee_id_list(value, self_employee_id=""):
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

        if normalize_role(employee_id) in SELF_ASSIGN_ALIASES:
            employee_id = normalize_text(self_employee_id)

        if employee_id and employee_id not in seen:
            seen.add(employee_id)
            cleaned.append(employee_id)

    return cleaned


def resolve_member_list(db, tenant_id, employee_ids, relation="assigned_member", self_employee_id=""):
    resolved_ids = []
    members = []

    for employee_id in normalize_employee_id_list(employee_ids, self_employee_id):
        employee = resolve_employee(db, employee_id, tenant_id)

        if not employee:
            raise ValueError("One or more selected employees were not found")

        resolved_ids.append(str(employee["_id"]))
        members.append(employee_member_payload(employee, relation, include_avatar=False))

    return resolved_ids, members


def same_department_value(left, right):
    return normalize_text(left).lower() == normalize_text(right).lower()


def find_department_team_leader(db, tenant_id, department):
    department = normalize_text(department)

    if not department:
        return None

    employees = list(db.employees.find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
        "department": department,
    }))

    for employee in employees:
        if employee_is_team_leader(employee):
            return employee

    # Fallback for case-insensitive department match
    employees = list(db.employees.find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    }))

    for employee in employees:
        if (
            employee_is_team_leader(employee)
            and same_department_value(employee.get("department"), department)
        ):
            return employee

    return None


def resolve_team_leader_for_project(db, tenant_id, data, creator_employee):
    raw_team_leader_id = normalize_text(data.get("team_leader_id"))

    # Keep backward compatibility if old frontend sends team_leader_id.
    if raw_team_leader_id:
        team_leader = resolve_employee(db, raw_team_leader_id, tenant_id)

        if not team_leader:
            raise ValueError("Selected Team Leader was not found")

        if not employee_is_team_leader(team_leader):
            raise ValueError("Selected Team Leader must have Team Leader capability")

        return team_leader

    project_department = normalize_text(
        data.get("department")
        or creator_employee.get("department")
        if creator_employee
        else ""
    )

    # First priority:
    # If selected assigned members already have a mapped Team Leader,
    # use that mapped Team Leader.
    assigned_source = data.get("assigned_employee_ids") or data.get("assigned_members") or []

    for employee_id in normalize_employee_id_list(assigned_source):
        assigned_employee = resolve_employee(db, employee_id, tenant_id)

        if not assigned_employee:
            continue

        mapped_tl_id = normalize_text(assigned_employee.get("team_leader_id"))

        if mapped_tl_id:
            mapped_tl = resolve_employee(db, mapped_tl_id, tenant_id)

            if (
                mapped_tl
                and employee_is_team_leader(mapped_tl)
                and (
                    not project_department
                    or same_department_value(mapped_tl.get("department"), project_department)
                )
            ):
                return mapped_tl

    # Second priority:
    # If creator is a Team Leader of the selected department, use creator.
    if (
        creator_employee
        and employee_is_team_leader(creator_employee)
        and (
            not project_department
            or same_department_value(creator_employee.get("department"), project_department)
        )
    ):
        return creator_employee

    # Third priority:
    # Pick the Team Leader assigned for the selected department.
    department_team_leader = find_department_team_leader(db, tenant_id, project_department)

    if department_team_leader:
        return department_team_leader

    return None

def resolve_reporting_officer_for_project(db, tenant_id, data, creator_employee, team_leader=None):
    raw_reporting_officer_id = normalize_text(data.get("reporting_officer_id"))

    if raw_reporting_officer_id:
        reporting_officer = resolve_employee(db, raw_reporting_officer_id, tenant_id)

        if not reporting_officer:
            raise ValueError("Selected Reporting Officer was not found")

        if not employee_is_reporting_officer(reporting_officer):
            raise ValueError("Selected Reporting Officer must have Reporting Officer capability")

        return reporting_officer

    # If project has a Team Leader, use the Team Leader's mapped Reporting Officer.
    if team_leader:
        mapped_ro_id = normalize_text(team_leader.get("reporting_officer_id"))

        if mapped_ro_id:
            reporting_officer = resolve_employee(db, mapped_ro_id, tenant_id)

            if reporting_officer:
                return reporting_officer

    # If creator is Reporting Officer, use creator.
    if creator_employee and employee_is_reporting_officer(creator_employee):
        return creator_employee

    # Fallback: creator's mapped Reporting Officer.
    if creator_employee:
        mapped_ro_id = normalize_text(creator_employee.get("reporting_officer_id"))

        if mapped_ro_id:
            reporting_officer = resolve_employee(db, mapped_ro_id, tenant_id)

            if reporting_officer:
                return reporting_officer

    return None


def find_project_employee(db, tenant_id, employee_id):
    if not employee_id:
        return None

    return resolve_employee(db, employee_id, tenant_id)


def enrich_member_from_db(db, tenant_id, member, relation):
    if not isinstance(member, dict):
        return {}

    employee_id = normalize_text(member.get("employee_id") or member.get("_id") or member.get("id"))
    employee = find_project_employee(db, tenant_id, employee_id)

    if employee:
        return employee_member_payload(employee, relation)

    fallback = dict(member)
    fallback["relation"] = relation
    fallback["employee_id"] = employee_id
    fallback["employee_name"] = (
        fallback.get("employee_name")
        or fallback.get("name")
        or fallback.get("email")
        or "Employee"
    )
    fallback["name"] = fallback.get("employee_name")
    fallback_avatar = (
        fallback.get("avatar")
        or fallback.get("profile_photo")
        or fallback.get("profile_picture")
        or ""
    )

    fallback_avatar = str(fallback_avatar or "").strip()

    if fallback_avatar.startswith("data:image") or len(fallback_avatar) > 500:
        fallback_avatar = ""

    fallback["avatar"] = fallback_avatar
    fallback["profile_photo"] = fallback_avatar

    return fallback


def unique_people(people):
    result = []
    seen = set()

    for person in people:
        if not isinstance(person, dict):
            continue

        person_id = normalize_text(
            person.get("employee_id")
            or person.get("_id")
            or person.get("id")
            or person.get("user_id")
            or person.get("email")
        )

        if not person_id:
            continue

        relation = normalize_text(person.get("relation"))
        key = f"{person_id}:{relation}"

        if key in seen:
            continue

        seen.add(key)
        result.append(person)

    return result


def build_project_team_tree(db, project, latest=None):
    tenant_id = project.get("tenant_id") or current_tenant_id()
    latest = latest or {}

    team_leader = None
    reporting_officer = None

    if project.get("team_leader_id"):
        team_leader = resolve_employee(db, project.get("team_leader_id"), tenant_id)

    if not team_leader and project.get("team_leader_name"):
        team_leader = {
            "_id": project.get("team_leader_id") or "",
            "name": project.get("team_leader_name"),
            "department": project.get("department", ""),
            "designation": "Team Leader",
            "is_team_leader": True,
        }

    if project.get("reporting_officer_id"):
        reporting_officer = resolve_employee(db, project.get("reporting_officer_id"), tenant_id)

    if not reporting_officer and team_leader and isinstance(team_leader, dict):
        mapped_ro_id = normalize_text(team_leader.get("reporting_officer_id"))
        if mapped_ro_id:
            reporting_officer = resolve_employee(db, mapped_ro_id, tenant_id)

    if not reporting_officer and project.get("reporting_officer_name"):
        reporting_officer = {
            "_id": project.get("reporting_officer_id") or "",
            "name": project.get("reporting_officer_name"),
            "department": project.get("department", ""),
            "designation": "Reporting Officer",
            "is_reporting_officer": True,
        }

    assigned_members = [
        enrich_member_from_db(db, tenant_id, member, "assigned_member")
        for member in project.get("assigned_members", [])
        if isinstance(member, dict)
    ]

    collaborators = [
        enrich_member_from_db(db, tenant_id, member, "collaborator")
        for member in project.get("collaborators", [])
        if isinstance(member, dict)
    ]

    latest_progress_person = None
    latest_employee_id = normalize_text(
        latest.get("employee_id")
        or project.get("latest_progress_by")
    )

    if latest_employee_id:
        latest_employee = resolve_employee(db, latest_employee_id, tenant_id)
        if latest_employee:
            latest_progress_person = employee_member_payload(latest_employee, "latest_progress_by")

    if not latest_progress_person and (latest.get("employee_name") or project.get("latest_progress_by_name")):
        latest_progress_person = {
            "employee_id": latest_employee_id,
            "employee_name": latest.get("employee_name") or project.get("latest_progress_by_name"),
            "name": latest.get("employee_name") or project.get("latest_progress_by_name"),
            "employee_code": latest.get("employee_code", ""),
            "department": latest.get("employee_department") or project.get("department", ""),
            "designation": latest.get("employee_designation", ""),
            "avatar": "",
            "profile_photo": "",
            "relation": "latest_progress_by",
        }

    doing_people = assigned_members if assigned_members else []
    if not doing_people and latest_progress_person:
        doing_people = [latest_progress_person]

    team_leader_payload = employee_member_payload(team_leader, "team_leader") if team_leader else {}
    reporting_officer_payload = employee_member_payload(reporting_officer, "reporting_officer") if reporting_officer else {}

    all_people = unique_people([
        reporting_officer_payload,
        team_leader_payload,
        *assigned_members,
        *collaborators,
        latest_progress_person,
    ])

    project_team_tree = {
        "reporting_officer": reporting_officer_payload,
        "team_leader": team_leader_payload,
        "assigned_members": assigned_members,
        "collaborators": collaborators,
        "doing_people": doing_people,
        "latest_progress_person": latest_progress_person or {},
        "all_people": all_people,
        "tree_levels": [
            {
                "level": 1,
                "label": "Reporting Officer",
                "people": [reporting_officer_payload] if reporting_officer_payload else [],
            },
            {
                "level": 2,
                "label": "Team Leader",
                "people": [team_leader_payload] if team_leader_payload else [],
            },
            {
                "level": 3,
                "label": "Team Members Doing Project",
                "people": assigned_members,
            },
            {
                "level": 4,
                "label": "Collaborators",
                "people": collaborators,
            },
        ],
        "connection_label": "Reporting Officer → Team Leader → Team Members → Collaborators",
    }

    return project_team_tree


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


def project_card(project, latest=None, include_tree=True):
    db = get_db()
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

    project_team_tree = build_project_team_tree(db, project, latest) if include_tree else {}

    reporting_officer = project_team_tree.get("reporting_officer", {}) if project_team_tree else {}
    team_leader = project_team_tree.get("team_leader", {}) if project_team_tree else {}
    doing_people = project_team_tree.get("doing_people", []) if project_team_tree else []

    doing_people_names = [
        item.get("employee_name") or item.get("name")
        for item in doing_people
        if item.get("employee_name") or item.get("name")
    ]

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

        "reporting_officer_id": project.get("reporting_officer_id", "") or reporting_officer.get("employee_id", ""),
        "reporting_officer_name": project.get("reporting_officer_name", "") or reporting_officer.get("employee_name", ""),
        "reporting_officer": reporting_officer,

        "team_leader_id": project.get("team_leader_id", "") or team_leader.get("employee_id", ""),
        "team_leader_name": project.get("team_leader_name", "") or team_leader.get("employee_name", ""),
        "team_leader": team_leader,

        "assigned_to_id": project.get("assigned_to_id", ""),
        "assigned_to_name": project.get("assigned_to_name", ""),
        "assigned_employee_ids": project.get("assigned_employee_ids", []),
        "assigned_members": project_team_tree.get("assigned_members", project.get("assigned_members", [])) if project_team_tree else project.get("assigned_members", []),

        "collaborator_ids": project.get("collaborator_ids", []),
        "collaborators": project_team_tree.get("collaborators", project.get("collaborators", [])) if project_team_tree else project.get("collaborators", []),

        "doing_people": doing_people,
        "doing_people_names": doing_people_names,
        "doing_person_name": doing_people_names[0] if doing_people_names else project.get("assigned_to_name", ""),
        "project_team_tree": project_team_tree,

        "created_by_employee_id": project.get("created_by_employee_id", ""),
        "created_by_employee_name": project.get("created_by_employee_name", ""),
        "created_at": project.get("created_at"),
        "updated_at": project.get("updated_at"),
        "completed_at": project.get("completed_at"),

        "latest_progress": latest_progress,
        "latest_progress_note": latest.get("note") or latest.get("description") or project.get("latest_progress_note", ""),
        "latest_progress_date": latest.get("date") or project.get("latest_progress_date", ""),
        "latest_progress_by": latest.get("employee_id") or project.get("latest_progress_by", ""),
        "latest_progress_by_name": latest.get("employee_name") or latest.get("created_by_name") or project.get("latest_progress_by_name", ""),
        "latest_progress_person": project_team_tree.get("latest_progress_person", {}) if project_team_tree else {},

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
# Project option helpers
# -----------------------------------------------------------------------------

def employee_option_payload(employee, relation="member"):
    payload = employee_member_payload(employee, relation)

    payload["_id"] = payload.get("employee_id", "")
    payload["id"] = payload.get("employee_id", "")
    payload["label"] = (
        f"{payload.get('employee_name', 'Employee')}"
        f" — {payload.get('employee_code') or payload.get('designation') or payload.get('department') or payload.get('email') or 'Member'}"
    )

    return payload


def project_assignable_employee_query(current_emp):
    tenant_id = current_tenant_id()
    base = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    }

    if is_admin_view_user():
        return base

    if not current_emp:
        return {**base, "_id": {"$exists": False}}

    current_emp_id = str(current_emp["_id"])
    identifier_values = employee_identifier_values(current_emp)

    if current_emp_id not in identifier_values:
        identifier_values.append(current_emp_id)

    scope = [{"_id": current_emp["_id"]}]

    if employee_is_team_leader(current_emp):
        scope.append({"team_leader_id": {"$in": identifier_values}})

    if employee_is_reporting_officer(current_emp):
        scope.extend([
            {"reporting_officer_id": {"$in": identifier_values}},
            {"_id": current_emp["_id"]},
        ])

    return {
        **base,
        "$or": scope,
    }


def capability_query_or(capability):
    if capability == "team_leader":
        return [
            {"is_team_leader": True},
            {"is_team_leader": "true"},
            {"is_team_leader": "1"},
            {"team_leader_capability": True},
            {"team_leader_capability": "true"},
            {"tl_capability": True},
            {"tl_capability": "true"},
            {"roles": "team_leader"},
            {"roles": "team_leader_capability"},
            {"roles": "tl"},
            {"roles": {"$in": ["team_leader", "team_leader_capability", "tl"]}},
        ]

    return [
        {"is_reporting_officer": True},
        {"is_reporting_officer": "true"},
        {"is_reporting_officer": "1"},
        {"reporting_officer_capability": True},
        {"reporting_officer_capability": "true"},
        {"ro_capability": True},
        {"ro_capability": "true"},
        {"roles": "reporting_officer"},
        {"roles": "reporting_officer_capability"},
        {"roles": "ro"},
        {"roles": "manager"},
        {"roles": {"$in": ["reporting_officer", "reporting_officer_capability", "ro", "manager"]}},
    ]


def project_team_leader_query(current_emp):
    tenant_id = current_tenant_id()
    base = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    }
    capability_or = capability_query_or("team_leader")

    if is_admin_view_user():
        return {**base, "$or": capability_or}

    if not current_emp:
        return {**base, "_id": {"$exists": False}}

    current_emp_id = str(current_emp["_id"])
    identifier_values = employee_identifier_values(current_emp)

    if current_emp_id not in identifier_values:
        identifier_values.append(current_emp_id)

    if employee_is_reporting_officer(current_emp):
        return {
            **base,
            "$and": [
                {"$or": capability_or},
                {"$or": [
                    {"reporting_officer_id": {"$in": identifier_values}},
                    {"_id": current_emp["_id"]},
                ]},
            ],
        }

    if employee_is_team_leader(current_emp):
        return {
            **base,
            "$and": [
                {"$or": capability_or},
                {"_id": current_emp["_id"]},
            ],
        }

    return {**base, "_id": {"$exists": False}}


def project_reporting_officer_query(current_emp):
    tenant_id = current_tenant_id()
    base = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    }
    capability_or = capability_query_or("reporting_officer")

    if is_admin_view_user():
        return {**base, "$or": capability_or}

    if not current_emp:
        return {**base, "_id": {"$exists": False}}

    if employee_is_reporting_officer(current_emp):
        return {
            **base,
            "$and": [
                {"$or": capability_or},
                {"_id": current_emp["_id"]},
            ],
        }

    mapped_ro_id = normalize_text(current_emp.get("reporting_officer_id"))
    mapped_ro = resolve_employee(db=get_db(), employee_id=mapped_ro_id, tenant_id=tenant_id)

    if mapped_ro:
        return {
            **base,
            "$and": [
                {"$or": capability_or},
                {"_id": mapped_ro["_id"]},
            ],
        }

    return {**base, "_id": {"$exists": False}}

def fetch_project_options(db):
    current_emp = get_current_employee(db)

    assignable = list(
        db.employees
        .find(project_assignable_employee_query(current_emp))
        .sort([("name", 1), ("employee_name", 1)])
        .limit(1000)
    )

    team_leaders = list(
        db.employees
        .find(project_team_leader_query(current_emp))
        .sort([("name", 1), ("employee_name", 1)])
        .limit(500)
    )

    reporting_officers = list(
        db.employees
        .find(project_reporting_officer_query(current_emp))
        .sort([("name", 1), ("employee_name", 1)])
        .limit(500)
    )

    current_emp_payload = employee_option_payload(current_emp, "self") if current_emp else {}

    return {
        "current_employee": clean_doc(current_emp_payload),
        "assignable_employees": clean_doc([employee_option_payload(row, "assignable") for row in assignable]),
        "assigned_member_options": clean_doc([employee_option_payload(row, "assignable") for row in assignable]),
        "collaborator_options": clean_doc([employee_option_payload(row, "collaborator") for row in assignable]),
        "team_leader_options": clean_doc([employee_option_payload(row, "team_leader") for row in team_leaders]),
        "reporting_officer_options": clean_doc([employee_option_payload(row, "reporting_officer") for row in reporting_officers]),
        "can_assign_self": bool(current_emp and can_create_assign_or_collaborate_projects(db)),
    }


# -----------------------------------------------------------------------------
# Project CRUD APIs
# -----------------------------------------------------------------------------

@projects_bp.get("/options")
@current_user_required
def project_options():
    db = get_db()

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()

    if not can_create_assign_or_collaborate_projects(db):
        return jsonify({
            "current_employee": clean_doc(employee_option_payload(get_current_employee(db), "self") if get_current_employee(db) else {}),
            "assignable_employees": [],
            "assigned_member_options": [],
            "collaborator_options": [],
            "team_leader_options": [],
            "reporting_officer_options": [],
            "can_assign_self": False,
            "can_create_assign_collaborate": False,
            "can_create_projects": False,
            "can_assign_projects": False,
            "can_add_collaborators": False,
        })

    options = fetch_project_options(db)
    options.update({
        "can_create_assign_collaborate": True,
        "can_create_projects": True,
        "can_assign_projects": True,
        "can_add_collaborators": True,
    })

    return jsonify(options)


@projects_bp.get("")
@current_user_required
def list_projects():
    db = get_db()

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
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
                {"reporting_officer_name": {"$regex": search, "$options": "i"}},
                {"assigned_to_name": {"$regex": search, "$options": "i"}},
                {"assigned_members.employee_name": {"$regex": search, "$options": "i"}},
                {"collaborators.employee_name": {"$regex": search, "$options": "i"}},
            ]
        }]

    projects = list(
        db.projects
        .find(q)
        .sort("created_at", -1)
        .limit(1000)
    )

    project_ids_with_saved_tree = [
        project["_id"]
        for project in projects
        if project.get("project_team_tree")
    ]

    if project_ids_with_saved_tree:
        db.projects.update_many(
            {"_id": {"$in": project_ids_with_saved_tree}},
            {"$unset": {"project_team_tree": ""}},
        )

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
        reporting_officer = resolve_reporting_officer_for_project(db, tenant_id, data, creator_employee, team_leader)

        assigned_source = data.get("assigned_employee_ids") or data.get("assigned_members") or []

        if truthy(data.get("assign_to_self")) or truthy(data.get("self_assign")):
            assigned_source = [*normalize_employee_id_list(assigned_source), str(creator_employee["_id"])]

        assigned_employee_ids, assigned_members = resolve_member_list(
            db,
            tenant_id,
            assigned_source,
            "assigned_member",
            str(creator_employee["_id"]),
        )
        collaborator_ids, collaborators = resolve_member_list(
            db,
            tenant_id,
            data.get("collaborator_ids") or data.get("collaborators") or [],
            "collaborator",
            str(creator_employee["_id"]),
        )
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400

    team_leader_id = str(team_leader["_id"]) if team_leader else ""
    team_leader_name = employee_display_name(team_leader) if team_leader else ""

    reporting_officer_id = str(reporting_officer["_id"]) if reporting_officer else ""
    reporting_officer_name = employee_display_name(reporting_officer) if reporting_officer else ""

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

        "reporting_officer_id": reporting_officer_id,
        "reporting_officer_name": reporting_officer_name,

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



    try:
        result = db.projects.insert_one(doc)
    except Exception as exc:
        if exc.__class__.__name__ == "DocumentTooLarge":
            return jsonify({
                "message": "Project could not be created because selected employee profile images made the project data too large. Please try again after removing large base64 profile images from employee records."
            }), 400

        raise
    doc["_id"] = result.inserted_id

    audit("create_project", "projects", result.inserted_id, {
        "name": name,
        "status": status,
        "team_leader_name": team_leader_name,
        "reporting_officer_name": reporting_officer_name,
        "assigned_members": assigned_members,
        "collaborators": collaborators,
    })

    return jsonify({
        "message": "Project created successfully",
        "item": clean_doc(project_card(doc)),
    }), 201


@projects_bp.patch("/<project_id>")
@current_user_required
def update_project(project_id):
    db = get_db()

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
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

    if "team_leader_id" in data:
        team_leader = resolve_team_leader_for_project(db, project.get("tenant_id"), data, get_current_employee(db))
        update["team_leader_id"] = str(team_leader["_id"]) if team_leader else ""
        update["team_leader_name"] = employee_display_name(team_leader) if team_leader else ""

    if "reporting_officer_id" in data:
        reporting_officer = resolve_reporting_officer_for_project(
            db,
            project.get("tenant_id"),
            data,
            get_current_employee(db),
            None,
        )
        update["reporting_officer_id"] = str(reporting_officer["_id"]) if reporting_officer else ""
        update["reporting_officer_name"] = employee_display_name(reporting_officer) if reporting_officer else ""

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

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
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
        current_emp = get_current_employee(db)
        assigned_source = data.get("assigned_employee_ids") or data.get("assigned_members") or []

        if current_emp and (truthy(data.get("assign_to_self")) or truthy(data.get("self_assign"))):
            assigned_source = [*normalize_employee_id_list(assigned_source), str(current_emp["_id"])]

        assigned_employee_ids, assigned_members = resolve_member_list(
            db,
            tenant_id,
            assigned_source,
            "assigned_member",
            str(current_emp["_id"]) if current_emp else "",
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

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
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
        current_emp = get_current_employee(db)
        collaborator_ids, collaborators = resolve_member_list(
            db,
            tenant_id,
            data.get("collaborator_ids") or data.get("collaborators") or [],
            "collaborator",
            str(current_emp["_id"]) if current_emp else "",
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

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
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

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
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

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
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

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
    employee = get_current_employee(db)

    if not employee:
        return jsonify({"items": []})

    tenant_id = employee.get("tenant_id") or current_tenant_id()
    employee_id = str(employee["_id"])
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    rows = list(
        db.project_progress
        .find({
            "tenant_id": tenant_id,
            "employee_id": {"$in": identifier_values},
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

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
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

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
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
        "reporting_officer_id": project.get("reporting_officer_id", ""),
        "reporting_officer_name": project.get("reporting_officer_name", ""),
        "team_leader_id": project.get("team_leader_id", ""),
        "team_leader_name": project.get("team_leader_name", ""),
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "employee_name": employee_display_name(employee),
        "employee_avatar": safe_employee_avatar(employee),
        "employee_profile_photo": safe_employee_avatar(employee),
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
                "latest_progress_by_avatar": safe_employee_avatar(employee),
                "updated_at": now,
                "updated_by": current_user_id(),
                "updated_by_name": current_user_name(),
            }
        },
    )

    updated_project = db.projects.find_one({"_id": project["_id"]})

    audit("add_project_progress", "project_progress", result.inserted_id, {
        "project_id": project_id_str,
        "progress_percent": progress,
    })

    return jsonify({
        "message": "Project progress submitted successfully",
        "item": clean_doc(doc),
        "project": clean_doc(project_card(updated_project, doc)),
    }), 201


@projects_bp.get("/<project_id>")
@current_user_required
def get_project_detail(project_id):
    db = get_db()

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    tenant_id = project.get("tenant_id") or current_tenant_id()
    project_id_str = str(project["_id"])

    if project.get("project_team_tree"):
        db.projects.update_one(
            {"_id": project["_id"]},
            {"$unset": {"project_team_tree": ""}},
        )

        project = db.projects.find_one({"_id": project["_id"]})

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