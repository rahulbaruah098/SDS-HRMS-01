from flask import Blueprint, request, jsonify, g
from functools import wraps
from app.services.tenant_service import is_platform_superadmin
from bson import ObjectId
from datetime import datetime, date, timedelta

from app.services import team_responsibility as responsibility
from app.extensions import get_db
from app.utils.auth import audit
from app.middleware.tenant_guard import tenant_module_required
from app.utils.serializers import clean_doc
from app.services.active_employee_scope import active_employee_fields
from app.services import project_planning as planning


projects_bp = Blueprint("projects", __name__)

@projects_bp.before_request
def validate_project_json_body():
    if request.method in {"POST", "PATCH", "PUT"} and not isinstance(request.get_json(silent=True), dict):
        return jsonify({"message": "Expected a JSON object"}), 400


def private_progress_scope(db):
    if planning.org_access():
        return {}
    if not hasattr(g, "project_progress_detail_ids"):
        g.project_progress_detail_ids = list({str(v) for e in planning.detail_employees(db) for v in employee_identifier_values(e)})
    return {"employee_id": {"$in": g.project_progress_detail_ids}}



ADMIN_VIEW_ROLES = {
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
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id")


def tenant_project_required(fn):
    @wraps(fn)
    @tenant_module_required("projects")
    def wrapped(*args, **kwargs):
        user = getattr(g, "current_user", {}) or {}
        if is_platform_superadmin(user) or current_user_roles().intersection({"super_admin", "superadmin"}):
            return jsonify({"message": "Projects are available only to tenant users"}), 403

        tenant_id = getattr(g, "tenant_id", None)
        if not isinstance(tenant_id, str) or not tenant_id.strip():
            return jsonify({"message": "Company context is required"}), 403

        return fn(*args, **kwargs)
    return wrapped


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

    return employee


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
    return responsibility.capability(employee, 'tl')


def employee_is_reporting_officer(employee):
    return responsibility.capability(employee, 'ro')


def is_admin_view_user():
    return bool(current_user_roles().intersection(ADMIN_VIEW_ROLES))


def is_hr_project_blocked_user():
    # HR monitoring is permitted; writes are checked independently.
    return False


def hr_project_access_denied_response():
    return jsonify({
        "message": "HR users cannot access the Project module. Projects are available to Admin, Team Leaders, Reporting Officers and assigned employees."
    }), 403


def can_create_assign_or_collaborate_projects(db):
    if current_user_roles() & {"super_admin", "superadmin"}:
        return False
    employee = get_current_employee(db)
    return responsibility.capability(employee, 'tl') or responsibility.capability(employee, 'ro')


def project_member_ids(project):
    ids = set()

    for key in [
        "_id",
        "created_by_employee_id",
        "team_leader_id",
        "reporting_officer_id",
        "assigned_to_id",
        "assigned_to_employee_id",
        "assigned_employee_id",
        "latest_progress_by",
    ]:
        value = normalize_text(project.get(key))
        if value:
            ids.add(value)

    for key in [
        "assigned_employee_ids",
        "assigned_to_ids",
        "collaborator_ids",
    ]:
        values = project.get(key, [])
        if isinstance(values, list):
            ids.update(
                normalize_text(value)
                for value in values
                if normalize_text(value)
            )

    for key in ["assigned_members", "collaborators", "team_members"]:
        values = project.get(key, [])
        if isinstance(values, list):
            for item in values:
                if isinstance(item, dict):
                    for item_key in [
                        "_id",
                        "id",
                        "employee_id",
                        "employee_ref_id",
                        "user_id",
                    ]:
                        value = normalize_text(item.get(item_key))
                        if value:
                            ids.add(value)

    return ids


def can_view_project(db, project):
    if planning.org_access():
        return True

    employee = get_current_employee(db)

    if not employee:
        return False

    employee_id = str(employee["_id"])
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    return bool(project_member_ids(project).intersection(set(identifier_values))) or can_manage_project_team(db, project)


def can_manage_project_team(db, project):
    if project.get('tenant_id') != current_tenant_id() or not can_create_assign_or_collaborate_projects(db):
        return False
    employee = get_current_employee(db)
    if project.get('team_leader_id'):
        return responsibility.can_manage_team(db, current_tenant_id(), employee, project['team_leader_id'])
    return bool(employee and responsibility.capability(employee, 'ro') and
                str(project.get('reporting_officer_id', '')) in responsibility.identifiers(employee))

def can_update_project_status_or_progress(db, project):
    """
    Assigned project members, collaborators, TL, RO, and project creator
    can update project status/progress.
    They cannot edit full project details unless they have TL/RO permission.
    """
    employee = get_current_employee(db)

    if not employee:
        return False

    employee_id = str(employee["_id"])
    identifier_values = employee_identifier_values(employee)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    return bool(project_member_ids(project).intersection(set(identifier_values))) or can_manage_project_team(db, project)

def project_scope_query(db):
    tenant_id = current_tenant_id()

    tenant_filter = {"tenant_id": tenant_id}

    q = {
        "$and": [
            tenant_filter,
            {"is_deleted": {"$ne": True}},
        ]
    }

    if is_hr_project_blocked_user():
        q["$and"].append({"_id": {"$exists": False}})
        return q

    if planning.org_access():
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

            {"team_leader_id": {"$in": responsibility.leader_aliases(db, tenant_id, employee)}},
            {"reporting_officer_id": {"$in": identifier_values}},

            {"assigned_to_id": {"$in": identifier_values}},
            {"assigned_to_employee_id": {"$in": identifier_values}},
            {"assigned_employee_id": {"$in": identifier_values}},
            {"assigned_employee_ids": {"$in": identifier_values}},
            {"assigned_to_ids": {"$in": identifier_values}},
            {"assigned_members._id": {"$in": identifier_values}},
            {"assigned_members.id": {"$in": identifier_values}},
            {"assigned_members.employee_id": {"$in": identifier_values}},
            {"assigned_members.user_id": {"$in": identifier_values}},
            {"assigned_members.employee_code": {"$in": identifier_values}},
            {"assigned_members.email": {"$in": identifier_values}},

            {"collaborator_ids": {"$in": identifier_values}},
            {"collaborators._id": {"$in": identifier_values}},
            {"collaborators.id": {"$in": identifier_values}},
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

    base = active_employee_fields()

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

    q = {"user_id": str(user_id), **active_employee_fields()}

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


def existing_assigned_employee_ids(project):
    values = []

    for value in project.get("assigned_employee_ids", []) or []:
        employee_id = normalize_text(value)

        if employee_id and employee_id not in values:
            values.append(employee_id)

    for member in project.get("assigned_members", []) or []:
        if not isinstance(member, dict):
            continue

        employee_id = normalize_text(
            member.get("employee_id")
            or member.get("_id")
            or member.get("id")
        )

        if employee_id and employee_id not in values:
            values.append(employee_id)

    assigned_to_id = normalize_text(
        project.get("assigned_to_id")
        or project.get("primary_assignee_id")
        or project.get("doing_person_id")
    )

    if assigned_to_id and assigned_to_id not in values:
        values.insert(0, assigned_to_id)

    return values


def requested_primary_assignee_id(data, self_employee_id=""):
    raw_value = (
        data.get("primary_assignee_id")
        or data.get("assigned_to_id")
        or data.get("responsible_employee_id")
        or data.get("doing_employee_id")
        or data.get("doing_person_id")
    )

    if isinstance(raw_value, dict):
        raw_value = (
            raw_value.get("employee_id")
            or raw_value.get("_id")
            or raw_value.get("id")
        )

    normalized = normalize_employee_id_list(
        [raw_value] if raw_value not in [None, ""] else [],
        self_employee_id,
    )

    return normalized[0] if normalized else ""


def assignment_request_employee_ids(project, data, self_employee_id=""):
    replace_members = (
        "assigned_employee_ids" in data
        or "assigned_members" in data
    )

    if replace_members:
        source = (
            data.get("assigned_employee_ids")
            if "assigned_employee_ids" in data
            else data.get("assigned_members")
        )
        employee_ids = normalize_employee_id_list(source or [], self_employee_id)
    else:
        employee_ids = existing_assigned_employee_ids(project)

    for key in [
        "add_employee_ids",
        "add_member_ids",
        "members_to_add",
    ]:
        for employee_id in normalize_employee_id_list(
            data.get(key) or [],
            self_employee_id,
        ):
            if employee_id not in employee_ids:
                employee_ids.append(employee_id)

    remove_ids = set()

    for key in [
        "remove_employee_ids",
        "remove_member_ids",
        "members_to_remove",
    ]:
        remove_ids.update(
            normalize_employee_id_list(
                data.get(key) or [],
                self_employee_id,
            )
        )

    if remove_ids:
        employee_ids = [
            employee_id
            for employee_id in employee_ids
            if employee_id not in remove_ids
        ]

    return employee_ids


def employee_is_assignable_by_current_user(db, employee, current_employee):
    return bool(employee and any(p['_id'] == employee['_id'] for p in
        responsibility.scoped_people(db, current_tenant_id(), current_employee)))


def resolve_assignable_member_list(
    db,
    tenant_id,
    employee_ids,
    relation="assigned_member",
    current_employee=None,
    self_employee_id="",
):
    resolved_ids = []
    members = []

    for employee_id in normalize_employee_id_list(
        employee_ids,
        self_employee_id,
    ):
        employee = resolve_employee(db, employee_id, tenant_id)

        if not employee:
            raise ValueError("One or more selected employees were not found")

        if not employee_is_assignable_by_current_user(
            db,
            employee,
            current_employee,
        ):
            raise ValueError(
                f"{employee_display_name(employee)} is outside your mapped team and cannot be assigned to this project"
            )

        resolved_ids.append(str(employee["_id"]))
        members.append(
            employee_member_payload(
                employee,
                relation,
                include_avatar=False,
            )
        )

    return resolved_ids, members


def move_primary_assignee_first(employee_ids, members, primary_assignee_id):
    primary_assignee_id = normalize_text(primary_assignee_id)

    if not primary_assignee_id:
        return employee_ids, members

    paired = list(zip(employee_ids, members))
    primary_rows = [
        row
        for row in paired
        if normalize_text(row[0]) == primary_assignee_id
    ]
    supporting_rows = [
        row
        for row in paired
        if normalize_text(row[0]) != primary_assignee_id
    ]
    ordered = [*primary_rows, *supporting_rows]

    return (
        [row[0] for row in ordered],
        [row[1] for row in ordered],
    )


def same_department_value(left, right):
    return normalize_text(left).lower() == normalize_text(right).lower()


def find_department_team_leader(db, tenant_id, department):
    department = normalize_text(department)

    if not department:
        return None

    employees = list(db.employees.find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        **active_employee_fields(),
        "department": department,
    }))

    for employee in employees:
        if employee_is_team_leader(employee):
            return employee

    # Fallback for case-insensitive department match
    employees = list(db.employees.find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        **active_employee_fields(),
    }))

    for employee in employees:
        if (
            employee_is_team_leader(employee)
            and same_department_value(employee.get("department"), department)
        ):
            return employee

    return None


def resolve_team_leader_for_project(db, tenant_id, data, creator_employee):
    source = responsibility.resolve(db, tenant_id, data.get('team_leader_id'))
    leader, _, _ = responsibility.effective(db, tenant_id, source['_id']) if source else (None, None, None)
    if not leader or not responsibility.can_manage_team(db, tenant_id, creator_employee, source['_id']):
        raise ValueError('Select an authorized active or delegated team.')
    # Persist the stable team key; presentation supplies the effective leader.
    return source

def resolve_reporting_officer_for_project(db, tenant_id, data, creator_employee, team_leader=None):
    officer = responsibility.resolve(db, tenant_id, (team_leader or {}).get('reporting_officer_id'))
    if data.get('reporting_officer_id') and str(data['reporting_officer_id']) not in responsibility.identifiers(officer):
        raise ValueError('Reporting Officer must match the selected team hierarchy.')
    return officer if responsibility.capability(officer, 'ro') else None


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


def active_project_member(db, tenant_id, member, relation):
    """Only currently active employee records are nodes in the project map."""
    employee_ref = normalize_text(
        member.get('employee_id') or member.get('_id') or member.get('id')
    )
    employee = resolve_employee(db, employee_ref, tenant_id)
    return employee_member_payload(employee, relation) if employee else None


def build_project_team_tree(db, project, latest=None):
    tenant_id = project.get("tenant_id") or current_tenant_id()
    latest = latest or {}

    team_leader = None
    reporting_officer = None

    if project.get("team_leader_id"):
        team_leader, succession_status, _ = responsibility.effective(db, tenant_id, project.get("team_leader_id"))

    if not team_leader and not project.get("team_leader_id") and project.get("team_leader_name"):
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

    if not reporting_officer and not project.get("reporting_officer_id") and project.get("reporting_officer_name"):
        reporting_officer = {
            "_id": project.get("reporting_officer_id") or "",
            "name": project.get("reporting_officer_name"),
            "department": project.get("department", ""),
            "designation": "Reporting Officer",
            "is_reporting_officer": True,
        }

    assigned_members = [
        resolved for member in project.get("assigned_members", [])
        if isinstance(member, dict)
        for resolved in [active_project_member(db, tenant_id, member, "assigned_member")]
        if resolved
    ]

    primary_assignee_id = normalize_text(
        project.get("assigned_to_id")
        or project.get("primary_assignee_id")
        or project.get("doing_person_id")
    )

    for member in assigned_members:
        member_id = normalize_text(
            member.get("employee_id")
            or member.get("_id")
            or member.get("id")
        )
        is_primary = bool(
            primary_assignee_id
            and member_id == primary_assignee_id
        )
        member["is_primary_assignee"] = is_primary
        member["responsibility"] = "primary" if is_primary else "supporting"

    assigned_members.sort(
        key=lambda member: (
            not bool(member.get("is_primary_assignee")),
            normalize_text(
                member.get("employee_name")
                or member.get("name")
            ).lower(),
        )
    )

    primary_assignee = next(
        (
            member
            for member in assigned_members
            if member.get("is_primary_assignee")
        ),
        assigned_members[0] if assigned_members else {},
    )

    collaborators = [
        resolved for member in project.get("collaborators", [])
        if isinstance(member, dict)
        for resolved in [active_project_member(db, tenant_id, member, "collaborator")]
        if resolved
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
        "primary_assignee": primary_assignee,
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
                "label": "Primary & Assigned Team Members",
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


def member_name_map(members):
    result = {}

    for member in members or []:
        if not isinstance(member, dict):
            continue

        employee_id = normalize_text(
            member.get("employee_id")
            or member.get("_id")
            or member.get("id")
        )

        if employee_id:
            result[employee_id] = (
                member.get("employee_name")
                or member.get("name")
                or member.get("email")
                or "Employee"
            )

    return result


def record_project_assignment_history(
    db,
    project,
    before_ids,
    before_members,
    before_primary_id,
    after_ids,
    after_members,
    after_primary_id,
    reason="",
    action="team_updated",
    assignment_version=1,
):
    before_ids = [normalize_text(value) for value in before_ids if normalize_text(value)]
    after_ids = [normalize_text(value) for value in after_ids if normalize_text(value)]
    before_name_map = member_name_map(before_members)
    after_name_map = member_name_map(after_members)

    added_ids = [value for value in after_ids if value not in before_ids]
    removed_ids = [value for value in before_ids if value not in after_ids]

    before_primary_id = normalize_text(before_primary_id)
    after_primary_id = normalize_text(after_primary_id)

    history = {
        "tenant_id": project.get("tenant_id") or current_tenant_id(),
        "project_id": str(project.get("_id") or ""),
        "project_name": project_name(project),
        "action": action,
        "reason": normalize_text(reason),
        "assignment_version": assignment_version,
        "before_assigned_employee_ids": before_ids,
        "after_assigned_employee_ids": after_ids,
        "added_employee_ids": added_ids,
        "added_employee_names": [
            after_name_map.get(employee_id, "Employee")
            for employee_id in added_ids
        ],
        "removed_employee_ids": removed_ids,
        "removed_employee_names": [
            before_name_map.get(employee_id, "Employee")
            for employee_id in removed_ids
        ],
        "previous_primary_assignee_id": before_primary_id,
        "previous_primary_assignee_name": before_name_map.get(
            before_primary_id,
            project.get("assigned_to_name", ""),
        ),
        "new_primary_assignee_id": after_primary_id,
        "new_primary_assignee_name": after_name_map.get(
            after_primary_id,
            "",
        ),
        "primary_assignee_changed": before_primary_id != after_primary_id,
        "changed_by": current_user_id(),
        "changed_by_name": current_user_name(),
        "created_at": now_utc(),
        "is_deleted": False,
    }

    result = db.project_assignment_history.insert_one(history)
    history["_id"] = result.inserted_id

    return history


def notification_user_ids_for_employees(db, tenant_id, employee_ids):
    user_ids = []

    for employee_id in employee_ids or []:
        employee = resolve_employee(db, employee_id, tenant_id)
        user_id = normalize_text(employee.get("user_id")) if employee else ""

        if user_id and user_id not in user_ids:
            user_ids.append(user_id)

    return user_ids


def project_notification_employee_ids(project):
    employee_ids = existing_assigned_employee_ids(project)

    for value in [
        project.get("team_leader_id"),
        project.get("reporting_officer_id"),
    ]:
        employee_id = normalize_text(value)

        if employee_id and employee_id not in employee_ids:
            employee_ids.append(employee_id)

    for value in project.get("collaborator_ids", []) or []:
        employee_id = normalize_text(value)

        if employee_id and employee_id not in employee_ids:
            employee_ids.append(employee_id)

    return employee_ids


def notify_project_employees(
    db,
    project,
    employee_ids,
    title,
    body,
    notification_type="project_assignment",
    extra_meta=None,
):
    tenant_id = project.get("tenant_id") or current_tenant_id()
    user_ids = notification_user_ids_for_employees(
        db,
        tenant_id,
        employee_ids,
    )

    if not user_ids:
        return []

    now = now_utc()
    project_id = str(project.get("_id") or "")
    meta = {
        "notification_type": notification_type,
        "target": "projects",
        "page": "projects",
        "project_id": project_id,
        "project_name": project_name(project),
        **(extra_meta or {}),
    }
    docs = []

    for user_id in user_ids:
        docs.append({
            "tenant_id": tenant_id,
            "target_tenant_id": tenant_id,
            "user_id": user_id,
            "user_ids": [user_id],
            "title": title,
            "body": body,
            "message": body,
            "notification_type": notification_type,
            "priority": "normal",
            "target": "projects",
            "target_scope": "selected_users",
            "audience": "selected_users",
            "show_popup": True,
            "popup_seen": False,
            "popup_seen_at": "",
            "read": False,
            "status": "unread",
            "meta": meta,
            "created_at": now,
            "updated_at": now,
            "created_by": current_user_id(),
            "created_by_name": current_user_name(),
            "is_deleted": False,
        })

    if docs:
        db.notifications.insert_many(docs)

    return docs


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
    if not planning.org_access():
        allowed = set(private_progress_scope(db)["employee_id"]["$in"])
        author = str(latest.get("employee_id") or project.get("latest_progress_by") or "")
        if author and author not in allowed:
            latest = {}
            project = {**project, "latest_progress_note": "", "latest_progress_by": "", "latest_progress_by_name": "", "latest_progress_by_avatar": ""}


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

    primary_assignee = (
        project_team_tree.get("primary_assignee", {})
        if project_team_tree
        else {}
    )
    primary_assignee_id = normalize_text(
        primary_assignee.get("employee_id") if include_tree
        else (project.get("assigned_to_id") or project.get("primary_assignee_id"))
    )
    primary_assignee_name = (
        (primary_assignee.get("employee_name") or primary_assignee.get("name") or "")
        if include_tree else
        (project.get("assigned_to_name") or project.get("primary_assignee_name") or "")
    )
    can_manage_team = can_manage_project_team(db, project)

    return {
        "_id": str(project["_id"]),
        **{key: project.get(key) for key in ["project_type", "client_name", "function", "deliverables", "project_code", "planning_schema", "planning_version"]},
        "name": project_name(project),
        "project_name": project_name(project),
        "title": project_name(project),
        "description": project.get("description", ""),
        "status": normalize_status(project.get("status")),
        "department": project.get("department", ""),
        "start_date": project.get("start_date", ""),
        "due_date": project.get("due_date", ""),
        "priority": project.get("priority", "medium"),

        "reporting_officer_id": reporting_officer.get("employee_id", ""),
        "reporting_officer_name": reporting_officer.get("employee_name", ""),
        "reporting_officer": reporting_officer,

        "team_leader_id": str(project.get('team_leader_id') or ''),
        "effective_team_leader_id": team_leader.get("employee_id", ""),
        "succession_status": responsibility.effective(db, current_tenant_id(), project.get('team_leader_id'))[1],
        "team_leader_name": team_leader.get("employee_name", ""),
        "team_leader": team_leader,

        "assigned_to_id": primary_assignee_id,
        "assigned_to_name": primary_assignee_name,
        "primary_assignee_id": primary_assignee_id,
        "primary_assignee_name": primary_assignee_name,
        "primary_assignee": primary_assignee,
        "doing_person_id": primary_assignee_id,
        "doing_person_name": primary_assignee_name,
        "assigned_employee_ids": [member.get("employee_id") for member in project_team_tree.get("assigned_members", [])] if project_team_tree else project.get("assigned_employee_ids", []),
        "assigned_members": project_team_tree.get("assigned_members", project.get("assigned_members", [])) if project_team_tree else project.get("assigned_members", []),

        "collaborator_ids": [member.get("employee_id") for member in project_team_tree.get("collaborators", [])] if project_team_tree else project.get("collaborator_ids", []),
        "collaborators": project_team_tree.get("collaborators", project.get("collaborators", [])) if project_team_tree else project.get("collaborators", []),

        "doing_people": doing_people,
        "doing_people_names": doing_people_names,
        "project_team_tree": project_team_tree,

        "assignment_version": int(project.get("assignment_version") or 0),
        "last_assignment_change": project.get("last_assignment_change", {}),

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
        "can_manage_project_team": can_manage_team,
        "can_add_project_members": can_manage_team,
        "can_remove_project_members": can_manage_team,
        "can_reassign_primary_member": can_manage_team,
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
    people = responsibility.scoped_people(get_db(), current_tenant_id(), current_emp)
    return {'tenant_id': current_tenant_id(), **active_employee_fields(), '_id': {'$in': [p['_id'] for p in people]}}


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
    db, tenant_id = get_db(), current_tenant_id()
    ids = [p['_id'] for p in db.employees.find({'tenant_id': tenant_id})
           if responsibility.can_manage_team(db, tenant_id, current_emp, p['_id'])]
    return {'tenant_id': tenant_id, '_id': {'$in': ids}}


def project_reporting_officer_query(current_emp):
    tenant_id = current_tenant_id()
    base = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        **active_employee_fields(),
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
        "primary_assignee_options": clean_doc([employee_option_payload(row, "primary_assignee") for row in assignable]),
        "collaborator_options": clean_doc([employee_option_payload(row, "collaborator") for row in assignable]),
        "team_leader_options": clean_doc([employee_option_payload(row, "team_leader") for row in team_leaders]),
        "reporting_officer_options": clean_doc([employee_option_payload(row, "reporting_officer") for row in reporting_officers]),
        "can_assign_self": bool(current_emp and can_create_assign_or_collaborate_projects(db)),
    }


# -----------------------------------------------------------------------------
# Project CRUD APIs
# -----------------------------------------------------------------------------

@projects_bp.get("/options")
@tenant_project_required
def project_options():
    db = get_db()

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()

    if not can_create_assign_or_collaborate_projects(db):
        return jsonify({
            "current_employee": clean_doc(employee_option_payload(get_current_employee(db), "self") if get_current_employee(db) else {}),
            "assignable_employees": [],
            "assigned_member_options": [],
            "primary_assignee_options": [],
            "collaborator_options": [],
            "team_leader_options": [],
            "reporting_officer_options": [],
            "can_assign_self": False,
            "can_create_assign_collaborate": False,
            "can_create_projects": False,
            "can_assign_projects": False,
            "can_add_collaborators": False,
            "can_add_project_members": False,
            "can_remove_project_members": False,
            "can_reassign_primary_member": False,
        })

    options = fetch_project_options(db)
    options.update({
        "can_create_assign_collaborate": True,
        "can_create_projects": True,
        "can_assign_projects": True,
        "can_add_collaborators": True,
        "can_add_project_members": True,
        "can_remove_project_members": True,
        "can_reassign_primary_member": True,
    })

    return jsonify(options)


@projects_bp.get("")
@tenant_project_required
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
        "can_add_project_members": can_manage,
        "can_remove_project_members": can_manage,
        "can_reassign_primary_member": can_manage,
    })


@projects_bp.post("")
@tenant_project_required
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
    tenant_id = current_tenant_id()
    try:
        planning_fields = planning.validate_project(db, data)
    except planning.PlanningError as exc:
        return jsonify({"message": str(exc)}), exc.status

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

        requested_primary_id = requested_primary_assignee_id(
            data,
            str(creator_employee["_id"]),
        )

        if requested_primary_id:
            assigned_source = [
                *normalize_employee_id_list(assigned_source),
                requested_primary_id,
            ]

        assigned_employee_ids, assigned_members = resolve_assignable_member_list(
            db,
            tenant_id,
            assigned_source,
            "assigned_member",
            current_employee=creator_employee,
            self_employee_id=str(creator_employee["_id"]),
        )

        if requested_primary_id:
            primary_employee = resolve_employee(
                db,
                requested_primary_id,
                tenant_id,
            )
            primary_assignee_id = (
                str(primary_employee["_id"])
                if primary_employee
                else ""
            )
        else:
            primary_assignee_id = (
                assigned_employee_ids[0]
                if assigned_employee_ids
                else ""
            )

        assigned_employee_ids, assigned_members = move_primary_assignee_first(
            assigned_employee_ids,
            assigned_members,
            primary_assignee_id,
        )

        collaborator_ids, collaborators = resolve_assignable_member_list(
            db,
            tenant_id,
            data.get("collaborator_ids") or data.get("collaborators") or [],
            "collaborator",
            current_employee=creator_employee,
            self_employee_id=str(creator_employee["_id"]),
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

        "assigned_to_id": primary_assignee_id,
        "assigned_to_name": assigned_members[0]["employee_name"] if assigned_members else "",
        "primary_assignee_id": primary_assignee_id,
        "primary_assignee_name": assigned_members[0]["employee_name"] if assigned_members else "",
        "doing_person_id": primary_assignee_id,
        "doing_person_name": assigned_members[0]["employee_name"] if assigned_members else "",
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
        "assignment_version": 1,
        "last_assignment_change": {},
        "is_deleted": False,
    }



    doc.update(planning_fields)
    doc["planning_version"] = 1
    doc["planning_history"] = [planning.event("project_configured", fields=planning_fields)]
    try:
        result = db.projects.insert_one(doc)
    except Exception as exc:
        if exc.__class__.__name__ == "DocumentTooLarge":
            return jsonify({
                "message": "Project could not be created because selected employee profile images made the project data too large. Please try again after removing large base64 profile images from employee records."
            }), 400

        raise
    doc["_id"] = result.inserted_id

    initial_assignment_history = record_project_assignment_history(
        db,
        doc,
        [],
        [],
        "",
        assigned_employee_ids,
        assigned_members,
        primary_assignee_id,
        reason=normalize_text(
            data.get("assignment_reason")
            or data.get("reason")
            or "Initial project assignment"
        ),
        action="initial_assignment",
        assignment_version=1,
    )
    last_assignment_change = {
        key: value
        for key, value in initial_assignment_history.items()
        if key not in {"_id", "is_deleted"}
    }

    db.projects.update_one(
        {"_id": result.inserted_id},
        {"$set": {"last_assignment_change": last_assignment_change}},
    )
    doc["last_assignment_change"] = last_assignment_change

    if assigned_employee_ids:
        notify_project_employees(
            db,
            doc,
            assigned_employee_ids,
            "New Project Assignment",
            f"You were assigned to {name}.",
            notification_type="project_assignment",
            extra_meta={
                "primary_assignee_id": primary_assignee_id,
                "assignment_version": 1,
            },
        )

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
@tenant_project_required
def update_project(project_id):
    db = get_db()

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    if not can_manage_project_team(db, project):
        return jsonify({
            "message": "Only this project's Team Leader, Reporting Officer, or Admin can edit project details"
        }), 403

    data = request.get_json(silent=True) or {}
    try:
        planning_fields = planning.validate_project(db, data, project)
        planning.require(data.get("planning_version", 0) == project.get("planning_version", 0), "Project changed. Reload before saving", 409)
        update = {**planning_fields}
        for key in ["description", "priority"]:
            if key in data:
                update[key] = normalize_text(data[key])
        name = normalize_text(data.get("name") or project_name(project))
        planning.require(name, "Project name is required")
        update.update({"name": name, "project_name": name, "title": name})
        leader = responsibility.resolve(db, current_tenant_id(), data.get("team_leader_id") or project.get("team_leader_id"))
        update.update({"team_leader_id": str(leader["_id"]), "team_leader_name": employee_display_name(leader)})
        if "assigned_employee_ids" in data or "primary_assignee_id" in data:
            primary = data.get("primary_assignee_id") or project.get("primary_assignee_id")
            ids, members = resolve_member_list(db, current_tenant_id(), list(dict.fromkeys([*data.get("assigned_employee_ids", project.get("assigned_employee_ids", [])), primary])))
            ids, members = move_primary_assignee_first(ids, members, primary)
            update.update({"assigned_employee_ids": ids, "assigned_members": members, "primary_assignee_id": primary, "assigned_to_id": primary,
                           "assigned_to_name": members[0]["name"], "primary_assignee_name": members[0]["name"]})
        if "collaborator_ids" in data:
            ids, members = resolve_member_list(db, current_tenant_id(), data["collaborator_ids"], "collaborator")
            update.update({"collaborator_ids": ids, "collaborators": members})
    except planning.PlanningError as exc:
        return jsonify({"message": str(exc)}), exc.status
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400

    if not update:
        return jsonify({"message": "No project fields received for update"}), 400

    update.update({
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    })

    version_query = project.get("planning_version", {"$exists": False})
    changed = db.projects.update_one(
        {"_id": project["_id"], "tenant_id": current_tenant_id(), "planning_version": version_query},
        {"$set": update, "$inc": {"planning_version": 1},
         "$push": {"planning_history": planning.event("project_updated", fields=update)}},
    )
    if not changed.matched_count:
        return jsonify({"message": "Project changed. Reload before saving"}), 409

    updated = db.projects.find_one({"_id": project["_id"]})

    audit("update_project", "projects", project_id, update)

    return jsonify({
        "message": "Project updated successfully",
        "item": clean_doc(project_card(updated)),
    })


@projects_bp.patch("/<project_id>/assign")
@tenant_project_required
def assign_project(project_id):
    db = get_db()

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    if not can_manage_project_team(db, project):
        return jsonify({
            "message": "Only this project's Team Leader, Reporting Officer, or Admin can manage project members"
        }), 403

    data = request.get_json(silent=True) or {}
    tenant_id = project.get("tenant_id") or current_tenant_id()
    current_emp = get_current_employee(db)

    before_ids = existing_assigned_employee_ids(project)
    before_members = project.get("assigned_members", []) or []
    before_primary_id = normalize_text(
        project.get("assigned_to_id")
        or project.get("primary_assignee_id")
        or project.get("doing_person_id")
    )

    try:
        assigned_source = assignment_request_employee_ids(
            project,
            data,
            str(current_emp["_id"]) if current_emp else "",
        )

        if current_emp and (truthy(data.get("assign_to_self")) or truthy(data.get("self_assign"))):
            assigned_source = [*normalize_employee_id_list(assigned_source), str(current_emp["_id"])]

        requested_primary_id = requested_primary_assignee_id(
            data,
            str(current_emp["_id"]) if current_emp else "",
        )

        if requested_primary_id:
            primary_employee = resolve_employee(
                db,
                requested_primary_id,
                tenant_id,
            )

            if not primary_employee:
                raise ValueError("Selected primary responsible employee was not found")

            if not employee_is_assignable_by_current_user(
                db,
                primary_employee,
                current_emp,
            ):
                raise ValueError(
                    f"{employee_display_name(primary_employee)} is outside your mapped team and cannot be made responsible for this project"
                )

            primary_assignee_id = str(primary_employee["_id"])

            if primary_assignee_id not in assigned_source:
                assigned_source.append(primary_assignee_id)
        elif before_primary_id in assigned_source:
            primary_assignee_id = before_primary_id
        else:
            primary_assignee_id = ""

        assigned_employee_ids, assigned_members = resolve_assignable_member_list(
            db,
            tenant_id,
            assigned_source,
            "assigned_member",
            current_employee=current_emp,
            self_employee_id=str(current_emp["_id"]) if current_emp else "",
        )

        if not primary_assignee_id and assigned_employee_ids:
            primary_assignee_id = assigned_employee_ids[0]

        assigned_employee_ids, assigned_members = move_primary_assignee_first(
            assigned_employee_ids,
            assigned_members,
            primary_assignee_id,
        )
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400

    try:
        planning.validate_existing_members(db, project, assigned_employee_ids)
        for target in db.project_monthly_targets.find({"tenant_id": current_tenant_id(), "project_id": str(project["_id"])}):
            planning.require(target["employee_id"] in set(assigned_employee_ids + project.get("collaborator_ids", []) + [project.get("team_leader_id")]), "An employee with monthly targets cannot be removed from the project")
    except planning.PlanningError as exc:
        return jsonify({"message": str(exc)}), exc.status

    primary_assignee_name = (
        assigned_members[0]["employee_name"]
        if assigned_members
        else ""
    )
    added_ids = [
        employee_id
        for employee_id in assigned_employee_ids
        if employee_id not in before_ids
    ]
    removed_ids = [
        employee_id
        for employee_id in before_ids
        if employee_id not in assigned_employee_ids
    ]
    primary_changed = before_primary_id != primary_assignee_id

    if primary_changed:
        assignment_action = "primary_reassigned"
    elif added_ids and removed_ids:
        assignment_action = "team_reconfigured"
    elif added_ids:
        assignment_action = "members_added"
    elif removed_ids:
        assignment_action = "members_removed"
    else:
        assignment_action = "team_updated"

    try:
        assignment_version = int(project.get("assignment_version") or 0) + 1
    except Exception:
        assignment_version = 1

    assignment_reason = normalize_text(
        data.get("assignment_reason")
        or data.get("reason")
        or data.get("remarks")
    )

    assignment_history = record_project_assignment_history(
        db,
        project,
        before_ids,
        before_members,
        before_primary_id,
        assigned_employee_ids,
        assigned_members,
        primary_assignee_id,
        reason=assignment_reason,
        action=assignment_action,
        assignment_version=assignment_version,
    )
    last_assignment_change = {
        key: value
        for key, value in assignment_history.items()
        if key not in {"_id", "is_deleted"}
    }

    update = {
        "assigned_to_id": primary_assignee_id,
        "assigned_to_name": primary_assignee_name,
        "primary_assignee_id": primary_assignee_id,
        "primary_assignee_name": primary_assignee_name,
        "doing_person_id": primary_assignee_id,
        "doing_person_name": primary_assignee_name,
        "assigned_employee_ids": assigned_employee_ids,
        "assigned_members": assigned_members,
        "assignment_version": assignment_version,
        "last_assignment_change": last_assignment_change,
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    db.projects.update_one(
        {"_id": project["_id"]},
        {"$set": update},
    )

    updated = db.projects.find_one({"_id": project["_id"]})

    if removed_ids:
        notify_project_employees(
            db,
            updated,
            removed_ids,
            "Removed from Project",
            f"You were removed from {project_name(updated)} by {current_user_name()}.",
            notification_type="project_assignment_removed",
            extra_meta={
                "assignment_version": assignment_version,
                "assignment_reason": assignment_reason,
            },
        )

    added_non_primary_ids = [
        employee_id
        for employee_id in added_ids
        if employee_id != primary_assignee_id
    ]

    if added_non_primary_ids:
        notify_project_employees(
            db,
            updated,
            added_non_primary_ids,
            "Added to Project",
            f"You were added to {project_name(updated)} by {current_user_name()}.",
            notification_type="project_assignment_added",
            extra_meta={
                "assignment_version": assignment_version,
                "assignment_reason": assignment_reason,
            },
        )

    if primary_changed and primary_assignee_id:
        notify_project_employees(
            db,
            updated,
            [primary_assignee_id],
            "Project Responsibility Assigned",
            f"You are now the primary person responsible for {project_name(updated)}.",
            notification_type="project_primary_reassigned",
            extra_meta={
                "previous_primary_assignee_id": before_primary_id,
                "new_primary_assignee_id": primary_assignee_id,
                "assignment_version": assignment_version,
                "assignment_reason": assignment_reason,
            },
        )

    if (
        primary_changed
        and before_primary_id
        and before_primary_id not in removed_ids
    ):
        notify_project_employees(
            db,
            updated,
            [before_primary_id],
            "Project Responsibility Updated",
            f"Primary responsibility for {project_name(updated)} was reassigned by {current_user_name()}.",
            notification_type="project_primary_reassigned",
            extra_meta={
                "previous_primary_assignee_id": before_primary_id,
                "new_primary_assignee_id": primary_assignee_id,
                "assignment_version": assignment_version,
                "assignment_reason": assignment_reason,
            },
        )

    audit("assign_project", "projects", project_id, {
        "action": assignment_action,
        "assignment_version": assignment_version,
        "added_employee_ids": added_ids,
        "removed_employee_ids": removed_ids,
        "previous_primary_assignee_id": before_primary_id,
        "new_primary_assignee_id": primary_assignee_id,
        "assignment_reason": assignment_reason,
    })

    return jsonify({
        "message": (
            "Project responsibility reassigned successfully"
            if primary_changed
            else "Project members updated successfully"
        ),
        "item": clean_doc(project_card(updated)),
        "assignment_change": clean_doc(last_assignment_change),
    })


@projects_bp.get("/<project_id>/assignment-history")
@tenant_project_required
def project_assignment_history(project_id):
    db = get_db()

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()

    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    rows = list(
        db.project_assignment_history
        .find({
            "tenant_id": project.get("tenant_id") or current_tenant_id(),
            "project_id": str(project["_id"]),
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(100)
    )

    return jsonify({
        "items": clean_doc(rows),
        "total": len(rows),
        "assignment_version": int(project.get("assignment_version") or 0),
    })


@projects_bp.patch("/<project_id>/collaborators")
@tenant_project_required
def update_project_collaborators(project_id):
    db = get_db()

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    if not can_manage_project_team(db, project):
        return jsonify({
            "message": "Only this project's Team Leader, Reporting Officer, or Admin can manage collaborators"
        }), 403

    data = request.get_json(silent=True) or {}
    tenant_id = project.get("tenant_id") or current_tenant_id()

    try:
        current_emp = get_current_employee(db)
        collaborator_ids, collaborators = resolve_assignable_member_list(
            db,
            tenant_id,
            data.get("collaborator_ids") or data.get("collaborators") or [],
            "collaborator",
            current_employee=current_emp,
            self_employee_id=str(current_emp["_id"]) if current_emp else "",
        )
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400

    try:
        planning.validate_existing_members(db, project, collaborator_ids)
        for target in db.project_monthly_targets.find({"tenant_id": current_tenant_id(), "project_id": str(project["_id"])}):
            planning.require(target["employee_id"] in set(collaborator_ids + project.get("assigned_employee_ids", []) + [project.get("team_leader_id")]), "An employee with monthly targets cannot be removed from the project")
    except planning.PlanningError as exc:
        return jsonify({"message": str(exc)}), exc.status
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
@tenant_project_required
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

    previous_status = normalize_status(project.get("status"))
    status_reason = normalize_text(
        data.get("status_reason")
        or data.get("hold_reason")
        or data.get("reason")
        or data.get("remarks")
    )
    status_changed_at = now_utc()
    status_change = {
        "from_status": previous_status,
        "to_status": status,
        "reason": status_reason,
        "changed_by": current_user_id(),
        "changed_by_name": current_user_name(),
        "changed_at": status_changed_at,
    }

    update = {
        "status": status,
        "completed_at": status_changed_at if status == "completed" else "",
        "last_status_change": status_change,
        "updated_at": status_changed_at,
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    if status == "on_hold":
        update.update({
            "on_hold_at": status_changed_at,
            "on_hold_by": current_user_id(),
            "on_hold_by_name": current_user_name(),
            "on_hold_reason": status_reason,
        })
    elif previous_status == "on_hold":
        update.update({
            "resumed_at": status_changed_at,
            "resumed_by": current_user_id(),
            "resumed_by_name": current_user_name(),
        })

    db.projects.update_one(
        {"_id": project["_id"]},
        {"$set": update},
    )

    updated = db.projects.find_one({"_id": project["_id"]})

    if previous_status != status:
        status_history = {
            "tenant_id": updated.get("tenant_id") or current_tenant_id(),
            "project_id": str(updated["_id"]),
            "project_name": project_name(updated),
            **status_change,
            "created_at": status_changed_at,
            "is_deleted": False,
        }
        db.project_status_history.insert_one(status_history)

        notify_project_employees(
            db,
            updated,
            project_notification_employee_ids(updated),
            "Project Status Updated",
            f"{project_name(updated)} was changed from {previous_status.replace('_', ' ').title()} to {status.replace('_', ' ').title()} by {current_user_name()}.",
            notification_type="project_status_changed",
            extra_meta={
                "from_status": previous_status,
                "to_status": status,
                "status_reason": status_reason,
            },
        )

    audit("update_project_status", "projects", project_id, status_change)

    return jsonify({
        "message": "Project status updated successfully",
        "item": clean_doc(project_card(updated)),
    })


@projects_bp.delete("/<project_id>")
@tenant_project_required
def delete_project(project_id):
    db = get_db()

    if is_hr_project_blocked_user():
        return hr_project_access_denied_response()
    project, error = get_project_or_404(db, project_id)

    if error:
        return error

    if not can_manage_project_team(db, project):
        return jsonify({
            "message": "Only Team Leaders and Reporting Officers can delete projects"
        }), 403

    if db.project_monthly_targets.count_documents({"tenant_id": current_tenant_id(), "project_id": str(project["_id"])}):
        return jsonify({"message": "Project has planning history. Mark it Completed instead of deleting it."}), 409

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
@tenant_project_required
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
            "can_add_project_members": can_create_assign_or_collaborate_projects(db),
            "can_remove_project_members": can_create_assign_or_collaborate_projects(db),
            "can_reassign_primary_member": can_create_assign_or_collaborate_projects(db),
        },
    })


@projects_bp.get("/my-progress")
@tenant_project_required
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
@tenant_project_required
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
            **private_progress_scope(db),
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
@tenant_project_required
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
@tenant_project_required
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
            **private_progress_scope(db),
        "is_deleted": {"$ne": True},
    }, sort=[("created_at", -1)])

    progress_items = list(
        db.project_progress
        .find({
            "tenant_id": tenant_id,
            "project_id": project_id_str,
            **private_progress_scope(db),
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
