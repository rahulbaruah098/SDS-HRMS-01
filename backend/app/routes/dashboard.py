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


def normalize_role_value(value):
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def normalize_roles(value):
    if not value:
        return []

    if isinstance(value, list):
        return [
            normalize_role_value(role)
            for role in value
            if normalize_role_value(role)
        ]

    if isinstance(value, str):
        return [
            normalize_role_value(role)
            for role in value.split(",")
            if normalize_role_value(role)
        ]

    return []


def current_roles():
    return set(normalize_roles(g.current_user.get("roles", [])))


def has_role(*allowed_roles):
    return bool(current_roles().intersection(set(allowed_roles)))


def current_tenant_id():
    tenant_id = (
        getattr(g, "tenant_id", None)
        or g.current_user.get("tenant_id")
        or g.current_user.get("company_id")
        or g.current_user.get("tenant")
        or "sds"
    )

    tenant_id = str(tenant_id or "").strip()

    return tenant_id or "sds"


def tenant_query(extra=None, include_legacy=True):
    tenant_id = current_tenant_id()
    extra = extra or {}

    tenant_values = [
        tenant_id,
        str(tenant_id or "").strip(),
        str(tenant_id or "").strip().lower(),
        str(tenant_id or "").strip().upper(),
    ]

    tenant_values = list(dict.fromkeys([value for value in tenant_values if value]))

    if include_legacy:
        tenant_filter = {
            "$or": [
                {"tenant_id": {"$in": tenant_values}},
                {"tenant_id": {"$exists": False}},
                {"tenant_id": None},
                {"tenant_id": ""},
            ]
        }
    else:
        tenant_filter = {"tenant_id": {"$in": tenant_values}}

    if "$and" in extra:
        return {
            "$and": [
                tenant_filter,
                *extra.get("$and", []),
            ]
        }

    return {
        "$and": [
            tenant_filter,
            extra,
        ]
    }


def active_employee_filter(extra=None):
    q = {
        "status": {"$ne": "Inactive"},
        "is_deleted": {"$ne": True},
    }

    q.update(extra or {})
    return q


def count_collection(db, collection, extra=None):
    """
    Dashboard counter with safe fallback.

    1. First count using exact tenant_id.
    2. Then count tenant + legacy blank/missing tenant_id.
    3. If still 0, count without tenant_id filter.

    This fixes KPI 000 issue when old records are saved with different tenant_id.
    """
    extra = extra or {}

    strict_count = db[collection].count_documents(
        tenant_query(extra, include_legacy=False)
    )

    if strict_count:
        return strict_count

    legacy_count = db[collection].count_documents(
        tenant_query(extra, include_legacy=True)
    )

    if legacy_count:
        return legacy_count

    return db[collection].count_documents(extra)


def normalize_text(value):
    return str(value or "").strip()

def safe_profile_photo_value(value):
    photo = normalize_text(value)

    if not photo:
        return ""

    # Never return large base64 profile images in dashboard APIs.
    # One photo can be repeated in employee_summary, team_members,
    # project cards, hierarchy tree, performance graphs, and crash the dashboard.
    if photo.startswith("data:image") and len(photo) > 5000:
        return ""

    # Normal uploaded image path/URL should be short.
    # Example: /uploads/profile_photos/employee.jpg
    if len(photo) > 1000 and not photo.startswith("http"):
        return ""

    return photo


def profile_photo_value(doc):
    doc = doc or {}

    return (
        safe_profile_photo_value(doc.get("avatar"))
        or safe_profile_photo_value(doc.get("profile_photo"))
        or safe_profile_photo_value(doc.get("profile_picture"))
        or safe_profile_photo_value(doc.get("photo"))
        or safe_profile_photo_value(doc.get("image"))
        or safe_profile_photo_value(doc.get("picture"))
        or ""
    )


def apply_profile_photo_aliases(payload, photo_value=None):
    payload = payload or {}
    photo = safe_profile_photo_value(photo_value) or profile_photo_value(payload)

    if photo:
        payload["avatar"] = photo
        payload["profile_photo"] = photo
        payload["profile_picture"] = photo
        payload["photo"] = photo
    else:
        # Remove unsafe/huge base64 photo fields from dashboard response objects.
        for key in [
            "avatar",
            "profile_photo",
            "profile_picture",
            "photo",
            "image",
            "picture",
            "employee_avatar",
            "employee_profile_photo",
            "latest_progress_by_avatar",
        ]:
            if payload.get(key) and not safe_profile_photo_value(payload.get(key)):
                payload.pop(key, None)

    return payload


def employee_photo(employee):
    return profile_photo_value(employee)


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
    employee = employee or {}
    roles = set(normalize_roles(list(roles or [])))

    return bool(
        truthy(employee.get("is_team_leader"))
        or truthy(employee.get("team_leader_capability"))
        or truthy(employee.get("tl_capability"))
        or "team_leader" in roles
        or "team_leader_capability" in roles
        or "tl" in roles
    )


def is_reporting_officer_capability(employee, roles=None):
    employee = employee or {}
    roles = set(normalize_roles(list(roles or [])))

    return bool(
        truthy(employee.get("is_reporting_officer"))
        or truthy(employee.get("reporting_officer_capability"))
        or truthy(employee.get("ro_capability"))
        or "reporting_officer" in roles
        or "reporting_officer_capability" in roles
        or "ro" in roles
        or "manager" in roles
    )


def current_employee(db):
    tenant_id = current_tenant_id()
    user_id = str(g.current_user.get("_id") or g.current_user.get("id") or "").strip()
    user_email = normalize_text(
        g.current_user.get("email")
        or g.current_user.get("username")
        or g.current_user.get("official_email")
    ).lower()

    user_employee_code = normalize_text(
        g.current_user.get("employee_id")
        or g.current_user.get("employee_code")
        or g.current_user.get("emp_code")
        or g.current_user.get("employee_ref_id")
    )

    identifier_or = []

    if user_id:
        identifier_or.extend([
            {"user_id": user_id},
            {"employee_ref_id": user_id},
        ])

        try:
            identifier_or.append({"_id": ObjectId(user_id)})
        except Exception:
            pass

    if user_email:
        identifier_or.extend([
            {"email": {"$regex": f"^{user_email}$", "$options": "i"}},
            {"official_email": {"$regex": f"^{user_email}$", "$options": "i"}},
        ])

    if user_employee_code:
        identifier_or.extend([
            {"employee_id": user_employee_code},
            {"employee_code": user_employee_code},
            {"emp_code": user_employee_code},
            {"code": user_employee_code},
        ])

        try:
            identifier_or.append({"_id": ObjectId(user_employee_code)})
        except Exception:
            pass

    if not identifier_or:
        return None

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": identifier_or,
    })

    if not employee:
        employee = db.employees.find_one({
            "is_deleted": {"$ne": True},
            "$or": identifier_or,
        })

    if not employee:
        return None

    employee_tenant_id = str(employee.get("tenant_id") or tenant_id or "sds").strip() or "sds"
    g.tenant_id = employee_tenant_id
    employee["tenant_id"] = employee_tenant_id

    if user_id and normalize_text(employee.get("user_id")) != user_id:
        db.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {
                "user_id": user_id,
                "tenant_id": employee_tenant_id,
                "updated_at": datetime.utcnow(),
            }},
        )
        employee["user_id"] = user_id

    return employee


def employee_identifier_values(employee):
    """
    Return all possible identifier values that may be stored in mapping fields.

    Older records may store team_leader_id/reporting_officer_id as:
    - employee Mongo _id string
    - employee Mongo ObjectId
    - user_id
    - employee_id / employee_code / emp_code / code
    - email
    """

    employee = employee or {}
    values = []

    raw_values = [
        employee.get("_id"),
        str(employee.get("_id")) if employee.get("_id") else "",
        employee.get("user_id"),
        employee.get("employee_id"),
        employee.get("employee_code"),
        employee.get("emp_code"),
        employee.get("code"),
        employee.get("email"),
    ]

    for value in raw_values:
        if value is None:
            continue

        text_value = normalize_text(value)

        if not text_value:
            continue

        if text_value not in values:
            values.append(text_value)

        try:
            object_value = ObjectId(text_value)
            if object_value not in values:
                values.append(object_value)
        except Exception:
            pass

    return values


def employee_mapping_query(field_name, employee, tenant_id):
    identifier_values = employee_identifier_values(employee)

    tenant_text = normalize_text(tenant_id)
    tenant_values = list(dict.fromkeys([
        tenant_text,
        tenant_text.lower(),
        tenant_text.upper(),
    ]))

    return {
        "$and": [
            {
                "$or": [
                    {"tenant_id": {"$in": tenant_values}},
                    {"tenant_id": {"$exists": False}},
                    {"tenant_id": None},
                    {"tenant_id": ""},
                ]
            },
            {
                field_name: {"$in": identifier_values},
            },
            {
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            },
        ]
    }

def employee_state(employee):
    employee = employee or {}

    return normalize_state(
        employee.get("state")
        or employee.get("branch")
        or employee.get("work_state")
        or "Assam(HO)"
    )


def employee_code(employee):
    employee = employee or {}

    return (
        employee.get("employee_id")
        or employee.get("emp_code")
        or employee.get("code")
        or ""
    )


def employee_name(employee):
    employee = employee or {}

    return (
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or employee.get("email")
        or "Employee"
    )


def employee_member_payload(employee, relation="member"):
    if not employee:
        return {}

    payload = {
        "_id": employee.get("_id"),
        "employee_id": str(employee.get("_id", "")),
        "employee_code": employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "employee_name": employee_name(employee),
        "name": employee_name(employee),
        "display_name": employee_name(employee),
        "email": employee.get("email", ""),
        "phone": employee.get("phone", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "user_id": employee.get("user_id", ""),
        "role": "Employee",
        "relation": relation,
        "state": employee_state(employee),
        "is_team_leader": truthy(employee.get("is_team_leader")),
        "is_reporting_officer": truthy(employee.get("is_reporting_officer")),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
    }

    apply_profile_photo_aliases(payload, employee_photo(employee))

    return payload


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
    display_name = employee_name(employee)

    display_role = (
        "Team Leader + Reporting Officer"
        if is_team_leader and is_reporting_officer
        else "Team Leader"
        if is_team_leader
        else "Reporting Officer"
        if is_reporting_officer
        else "Employee"
    )

    snapshot = {
        "_id": employee.get("_id"),
        "tenant_id": employee.get("tenant_id"),
        "user_id": employee.get("user_id"),
        "employee_id": employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "name": display_name,
        "employee_name": display_name,
        "display_name": display_name,
        "dashboard_title": display_name,
        "dashboard_subtitle": "Employee Dashboard",
        "display_role": display_role,
        "email": employee.get("email", ""),
        "phone": employee.get("phone", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "role": display_role,
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

    apply_profile_photo_aliases(snapshot, employee_photo(employee))

    return snapshot


def scoped_employee_ids_for_manager(db, tenant_id, emp_id, roles, employee=None):
    scope_or = []
    employee = employee or {}

    identifier_values = employee_identifier_values(employee)

    if emp_id and emp_id not in identifier_values:
        identifier_values.append(emp_id)

    if is_team_leader_capability(employee, roles):
        scope_or.append({"team_leader_id": {"$in": identifier_values}})

    if is_reporting_officer_capability(employee, roles):
        scope_or.append({"reporting_officer_id": {"$in": identifier_values}})

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
    identifier_values = employee_identifier_values(employee)

    if emp_id and emp_id not in identifier_values:
        identifier_values.append(emp_id)

    if is_team_leader_capability(employee, roles):
        stage_or.append({
            "team_leader_id": {"$in": identifier_values},
            "approval_stage": "team_leader",
        })

    if is_reporting_officer_capability(employee, roles):
        stage_or.append({
            "reporting_officer_id": {"$in": identifier_values},
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
    identifier_values = employee_identifier_values(employee)

    if emp_id and emp_id not in identifier_values:
        identifier_values.append(emp_id)

    if is_team_leader_capability(employee, roles):
        stage_or.append({
            "team_leader_id": {"$in": identifier_values},
            "approval_stage": "team_leader",
        })

    if is_reporting_officer_capability(employee, roles):
        stage_or.append({
            "reporting_officer_id": {"$in": identifier_values},
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
# Team hierarchy / spider-root helpers
# -----------------------------------------------------------------------------

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

        relation = normalize_text(person.get("relation"))
        key = f"{person_id}:{relation}"

        if not person_id or key in seen:
            continue

        seen.add(key)
        result.append(person)

    return result


def employee_by_id(db, tenant_id, employee_id):
    raw_id = normalize_text(employee_id)

    if not raw_id:
        return None

    tenant_id = str(tenant_id or current_tenant_id() or "sds").strip() or "sds"

    base_query = {
        "tenant_id": tenant_id,
        "status": {"$ne": "Inactive"},
        "is_deleted": {"$ne": True},
    }

    identifier_or = [
        {"user_id": raw_id},
        {"employee_id": raw_id},
        {"employee_code": raw_id},
        {"emp_code": raw_id},
        {"code": raw_id},
        {"email": {"$regex": f"^{raw_id}$", "$options": "i"}},
        {"official_email": {"$regex": f"^{raw_id}$", "$options": "i"}},
    ]

    try:
        identifier_or.insert(0, {"_id": ObjectId(raw_id)})
    except Exception:
        pass

    employee = db.employees.find_one({
        **base_query,
        "$or": identifier_or,
    })

    if employee:
        return employee

    fallback_query = {
        "status": {"$ne": "Inactive"},
        "is_deleted": {"$ne": True},
        "$or": identifier_or,
    }

    return db.employees.find_one(fallback_query)


def enrich_project_member(db, tenant_id, member, relation):
    if not isinstance(member, dict):
        return {}

    emp_id = normalize_text(member.get("employee_id") or member.get("_id") or member.get("id"))
    employee = employee_by_id(db, tenant_id, emp_id)

    if employee:
        return employee_member_payload(employee, relation)

    fallback = dict(member)
    fallback["employee_id"] = emp_id
    fallback["employee_name"] = (
        fallback.get("employee_name")
        or fallback.get("name")
        or fallback.get("email")
        or "Employee"
    )
    fallback["name"] = fallback.get("employee_name")
    fallback["display_name"] = fallback.get("employee_name")
    fallback["relation"] = relation
    apply_profile_photo_aliases(fallback)
    return fallback


def build_project_team_tree(db, tenant_id, project, latest=None):
    latest = latest or {}

    reporting_officer = employee_by_id(db, tenant_id, project.get("reporting_officer_id"))
    team_leader = employee_by_id(db, tenant_id, project.get("team_leader_id"))

    if not reporting_officer and team_leader and team_leader.get("reporting_officer_id"):
        reporting_officer = employee_by_id(db, tenant_id, team_leader.get("reporting_officer_id"))

    reporting_officer_payload = (
        employee_member_payload(reporting_officer, "reporting_officer")
        if reporting_officer
        else {
            "employee_id": project.get("reporting_officer_id", ""),
            "employee_name": project.get("reporting_officer_name", ""),
            "name": project.get("reporting_officer_name", ""),
            "display_name": project.get("reporting_officer_name", ""),
            "designation": "Reporting Officer",
            "department": project.get("department", ""),
            "relation": "reporting_officer",
        }
        if project.get("reporting_officer_name")
        else {}
    )
    apply_profile_photo_aliases(reporting_officer_payload)

    team_leader_payload = (
        employee_member_payload(team_leader, "team_leader")
        if team_leader
        else {
            "employee_id": project.get("team_leader_id", ""),
            "employee_name": project.get("team_leader_name", ""),
            "name": project.get("team_leader_name", ""),
            "display_name": project.get("team_leader_name", ""),
            "designation": "Team Leader",
            "department": project.get("department", ""),
            "relation": "team_leader",
        }
        if project.get("team_leader_name")
        else {}
    )
    apply_profile_photo_aliases(team_leader_payload)

    assigned_members = [
        enrich_project_member(db, tenant_id, member, "assigned_member")
        for member in project.get("assigned_members", [])
        if isinstance(member, dict)
    ]

    collaborators = [
        enrich_project_member(db, tenant_id, member, "collaborator")
        for member in project.get("collaborators", [])
        if isinstance(member, dict)
    ]

    latest_progress_person = {}
    latest_progress_by = normalize_text(latest.get("employee_id") or project.get("latest_progress_by"))

    if latest_progress_by:
        latest_employee = employee_by_id(db, tenant_id, latest_progress_by)

        if latest_employee:
            latest_progress_person = employee_member_payload(latest_employee, "latest_progress_by")

    if not latest_progress_person and (latest.get("employee_name") or project.get("latest_progress_by_name")):
        latest_progress_person = {
            "employee_id": latest_progress_by,
            "employee_name": latest.get("employee_name") or project.get("latest_progress_by_name"),
            "name": latest.get("employee_name") or project.get("latest_progress_by_name"),
            "display_name": latest.get("employee_name") or project.get("latest_progress_by_name"),
            "department": latest.get("employee_department") or project.get("department", ""),
            "designation": latest.get("employee_designation", ""),
            "relation": "latest_progress_by",
        }
        apply_profile_photo_aliases(
            latest_progress_person,
            latest.get("employee_avatar")
            or latest.get("employee_profile_photo")
            or project.get("latest_progress_by_avatar"),
        )

    doing_people = assigned_members if assigned_members else []
    if not doing_people and latest_progress_person:
        doing_people = [latest_progress_person]

    all_people = unique_people([
        reporting_officer_payload,
        team_leader_payload,
        *assigned_members,
        *collaborators,
        latest_progress_person,
    ])

    return {
        "reporting_officer": reporting_officer_payload,
        "team_leader": team_leader_payload,
        "assigned_members": assigned_members,
        "collaborators": collaborators,
        "doing_people": doing_people,
        "latest_progress_person": latest_progress_person,
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


def build_employee_team_hierarchy_tree(db, tenant_id, employee, roles, team_members=None, reporting_members=None):
    employee = employee or {}
    emp_id = str(employee.get("_id", ""))
    team_members = team_members or []
    reporting_members = reporting_members or []

    self_payload = employee_member_payload(employee, "self")

    reporting_officer = None
    team_leader = None

    if employee.get("reporting_officer_id"):
        reporting_officer = employee_by_id(db, tenant_id, employee.get("reporting_officer_id"))

    if employee.get("team_leader_id"):
        team_leader = employee_by_id(db, tenant_id, employee.get("team_leader_id"))

    reporting_officer_payload = (
        employee_member_payload(reporting_officer, "reporting_officer")
        if reporting_officer
        else employee_member_payload(employee, "reporting_officer")
        if is_reporting_officer_capability(employee, roles)
        else {}
    )

    team_leader_payload = (
        employee_member_payload(team_leader, "team_leader")
        if team_leader
        else employee_member_payload(employee, "team_leader")
        if is_team_leader_capability(employee, roles)
        else {}
    )

    team_member_payloads = [
        employee_member_payload(member, "team_member")
        for member in team_members
    ]

    reporting_member_payloads = [
        employee_member_payload(member, "reporting_member")
        for member in reporting_members
    ]

    team_leaders_under_reporting = [
        employee_member_payload(member, "team_leader_under_reporting")
        for member in reporting_members
        if truthy(member.get("is_team_leader"))
    ]

    all_people = unique_people([
        reporting_officer_payload,
        team_leader_payload,
        self_payload,
        *team_member_payloads,
        *reporting_member_payloads,
    ])

    return {
        "self": self_payload,
        "reporting_officer": reporting_officer_payload,
        "team_leader": team_leader_payload,
        "team_members": team_member_payloads,
        "reporting_members": reporting_member_payloads,
        "team_leaders_under_reporting": team_leaders_under_reporting,
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
                "label": "Team Members",
                "people": team_member_payloads,
            },
            {
                "level": 4,
                "label": "Reporting Members",
                "people": reporting_member_payloads,
            },
        ],
        "connection_label": "Reporting Officer → Team Leader → Team Members",
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


def project_scope_for_employee(tenant_id, emp_id, employee=None):
    employee = employee or {}
    identifier_values = employee_identifier_values(employee)

    if emp_id and emp_id not in identifier_values:
        identifier_values.append(emp_id)

    tenant_text = normalize_text(tenant_id)
    tenant_values = list(dict.fromkeys([
        tenant_text,
        tenant_text.lower(),
        tenant_text.upper(),
    ]))

    return {
        "$and": [
            {
                "$or": [
                    {"tenant_id": {"$in": tenant_values}},
                    {"tenant_id": {"$exists": False}},
                    {"tenant_id": None},
                    {"tenant_id": ""},
                ]
            },
            {
                "is_deleted": {"$ne": True},
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
                    {"assigned_members.emp_code": {"$in": identifier_values}},
                    {"assigned_members.email": {"$in": identifier_values}},

                    {"collaborator_ids": {"$in": identifier_values}},
                    {"collaborators.employee_id": {"$in": identifier_values}},
                    {"collaborators.user_id": {"$in": identifier_values}},
                    {"collaborators.employee_code": {"$in": identifier_values}},
                    {"collaborators.emp_code": {"$in": identifier_values}},
                    {"collaborators.email": {"$in": identifier_values}},

                    {"latest_progress_by": {"$in": identifier_values}},
                ],
            },
        ]
    }


def project_scope_for_team_leader(tenant_id, emp_id, employee=None):
    employee = employee or {}
    identifier_values = employee_identifier_values(employee)

    if emp_id and emp_id not in identifier_values:
        identifier_values.append(emp_id)

    tenant_text = normalize_text(tenant_id)
    tenant_values = list(dict.fromkeys([
        tenant_text,
        tenant_text.lower(),
        tenant_text.upper(),
    ]))

    return {
        "$and": [
            {
                "$or": [
                    {"tenant_id": {"$in": tenant_values}},
                    {"tenant_id": {"$exists": False}},
                    {"tenant_id": None},
                    {"tenant_id": ""},
                ]
            },
            {
                "is_deleted": {"$ne": True},
                "$or": [
                    {"created_by_employee_id": {"$in": identifier_values}},
                    {"created_by": {"$in": identifier_values}},
                    {"team_leader_id": {"$in": identifier_values}},
                ],
            },
        ]
    }


def project_scope_for_reporting_officer(tenant_id, team_leader_ids, reporting_officer_id=None):
    scope_or = []

    if team_leader_ids:
        scope_or.extend([
            {"created_by_employee_id": {"$in": team_leader_ids}},
            {"team_leader_id": {"$in": team_leader_ids}},
        ])

    if reporting_officer_id:
        scope_or.append({"reporting_officer_id": reporting_officer_id})
        scope_or.append({"reporting_officer_id": str(reporting_officer_id)})

    if not scope_or:
        return {
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "_id": {"$exists": False},
        }

    return {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": scope_or,
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

        if normalize_project_status(project.get("status")) == "completed" and latest_progress == 0:
            latest_progress = 100

        project_team_tree = build_project_team_tree(db, tenant_id, project, latest)
        doing_people = project_team_tree.get("doing_people", [])
        doing_people_names = [
            item.get("employee_name") or item.get("name")
            for item in doing_people
            if item.get("employee_name") or item.get("name")
        ]

        cards.append({
            "_id": pid,
            "name": project_name(project),
            "project_name": project_name(project),
            "title": project_name(project),
            "description": project.get("description", ""),
            "status": normalize_project_status(project.get("status")),
            "department": project.get("department", ""),
            "priority": project.get("priority", "medium"),
            "start_date": project.get("start_date", ""),
            "due_date": project.get("due_date", ""),

            "reporting_officer_id": project.get("reporting_officer_id", ""),
            "reporting_officer_name": project.get("reporting_officer_name", ""),
            "reporting_officer": project_team_tree.get("reporting_officer", {}),

            "team_leader_id": project.get("team_leader_id", ""),
            "team_leader_name": project.get("team_leader_name", ""),
            "team_leader": project_team_tree.get("team_leader", {}),

            "assigned_to_id": project.get("assigned_to_id", ""),
            "assigned_to_name": project.get("assigned_to_name", ""),
            "assigned_employee_ids": project.get("assigned_employee_ids", []),
            "assigned_members": project_team_tree.get("assigned_members", []),

            "collaborator_ids": project.get("collaborator_ids", []),
            "collaborators": project_team_tree.get("collaborators", []),

            "doing_people": doing_people,
            "doing_people_names": doing_people_names,
            "doing_person_name": doing_people_names[0] if doing_people_names else project.get("assigned_to_name", ""),

            "project_team_tree": project_team_tree,

            "created_by_employee_id": project.get("created_by_employee_id", ""),
            "created_by_employee_name": project.get("created_by_employee_name", ""),
            "created_at": project.get("created_at"),
            "completed_at": project.get("completed_at"),

            "latest_progress": latest_progress,
            "latest_progress_note": latest.get("note") or latest.get("description") or project.get("latest_progress_note", ""),
            "latest_progress_date": latest.get("date") or project.get("latest_progress_date", ""),
            "latest_progress_by": latest.get("employee_id") or project.get("latest_progress_by", ""),
            "latest_progress_by_name": latest.get("employee_name") or latest.get("created_by_name") or project.get("latest_progress_by_name", ""),
            "latest_progress_person": project_team_tree.get("latest_progress_person", {}),
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
                "on_hold_projects": 0,
                "completed_projects": 0,
                "completion_rate": 0,
                "score": 0,
            }

        row = department_map[department]
        row["total_projects"] += 1

        status = normalize_project_status(project.get("status"))

        if status == "active":
            row["active_projects"] += 1

        if status == "on_hold":
            row["on_hold_projects"] += 1

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
                "on_hold_projects": 0,
                "completed_projects": 0,
                "completion_rate": 0,
            }

        row = leader_map[leader_id]
        row["total_projects"] += 1

        status = normalize_project_status(project.get("status"))

        if status == "active":
            row["active_projects"] += 1

        if status == "on_hold":
            row["on_hold_projects"] += 1

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
    cards = serialize_project_cards(db, tenant_id, projects)
    rows = []

    for card in cards:
        latest = latest_map.get(card["_id"]) or {}
        status = normalize_project_status(card.get("status"))
        latest_progress = latest_project_progress_value(latest)

        if status == "completed" and latest_progress == 0:
            latest_progress = 100

        card["latest_progress"] = latest_progress
        card["progress_percent"] = latest_progress
        card["assigned_count"] = len(card.get("assigned_employee_ids", [])) if isinstance(card.get("assigned_employee_ids"), list) else 0
        card["collaborator_count"] = len(card.get("collaborator_ids", [])) if isinstance(card.get("collaborator_ids"), list) else 0
        card["score"] = latest_progress + (20 if status == "completed" else 0)

        rows.append(card)

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

    rating = to_float(raw_value, 0)

    if rating < 0:
        return 0

    if rating > 5:
        return 5

    return round(rating, 2)


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


def performance_review_date(review):
    raw_value = (
        review.get("review_date")
        or review.get("date")
        or review.get("week_start")
        or review.get("created_at")
    )

    if isinstance(raw_value, datetime):
        return raw_value.date()

    if isinstance(raw_value, date):
        return raw_value

    raw_text = normalize_text(raw_value)

    if not raw_text:
        return date.today()

    for fmt in ["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d-%m-%Y"]:
        try:
            return datetime.strptime(raw_text[:19], fmt).date()
        except Exception:
            pass

    try:
        return datetime.fromisoformat(raw_text.replace("Z", "+00:00")).date()
    except Exception:
        return date.today()


def performance_week_bounds(base_date=None):
    base = base_date or date.today()
    start = base - timedelta(days=base.weekday())
    return start, start + timedelta(days=6)


def performance_period_key_label(review, period):
    review_date_value = performance_review_date(review)
    period = normalize_text(period).lower()

    if period in ["month", "monthly"]:
        month_key = review.get("month_key") or review.get("month") or review_date_value.strftime("%Y-%m")
        month_label = review.get("month_label") or review_date_value.strftime("%b %Y")
        return normalize_text(month_key), normalize_text(month_label)

    if period in ["year", "yearly"]:
        year_key = review.get("year_key") or review.get("year") or str(review_date_value.year)
        year_label = str(review.get("year") or review_date_value.year)
        return normalize_text(year_key), normalize_text(year_label)

    week_start = normalize_text(review.get("week_start"))
    week_end = normalize_text(review.get("week_end"))
    week_key = normalize_text(review.get("week_key"))
    week_label = normalize_text(review.get("week_label"))

    if not week_start or not week_end:
        start, end = performance_week_bounds(review_date_value)
        week_start = start.isoformat()
        week_end = end.isoformat()

    if not week_key:
        week_key = f"{week_start}:{week_end}"

    if not week_label:
        week_label = f"{week_start} to {week_end}"

    return week_key, week_label


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
        "rating_label": performance_rating_bucket(average_rating),
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


def empty_performance_chart(title="Performance"):
    summary = performance_summary_from_reviews([])

    return {
        "title": title,
        "summary": summary,
        "members": [],
        "rating_distribution": summary["distribution"],
        "recent_reviews": [],
        "weekly_chart": [],
        "monthly_chart": [],
        "yearly_chart": [],
        "performance_3d_graph": [],
        "three_d_graph": [],
        "graph_mode": "3d-ready",
    }


def performance_period_series(reviews, period="weekly", limit=12):
    grouped = {}

    for review in reviews:
        key, label = performance_period_key_label(review, period)
        rating = performance_rating_value(review)

        if not key:
            continue

        if key not in grouped:
            grouped[key] = {
                "key": key,
                "period_key": key,
                "label": label,
                "period_label": label,
                "period": period,
                "reviews": 0,
                "rated_reviews": 0,
                "average_rating": 0,
                "rating_percentage": 0,
                "rating_label": "Not Rated",
                "_total": 0,
            }

        row = grouped[key]
        row["reviews"] += 1

        if rating > 0:
            row["rated_reviews"] += 1
            row["_total"] += rating

    rows = []

    for row in grouped.values():
        rated = row.get("rated_reviews", 0)
        total = row.pop("_total", 0)
        average = round(total / rated, 2) if rated else 0
        row["average_rating"] = average
        row["rating_percentage"] = round((average / 5) * 100, 2) if average else 0
        row["rating_label"] = performance_rating_bucket(average)
        row["graph_value"] = row["rating_percentage"]
        row["score"] = average
        rows.append(row)

    rows = sorted(rows, key=lambda item: item.get("key", ""))

    if limit and len(rows) > limit:
        rows = rows[-limit:]

    return rows


def performance_member_period_matrix(reviews, employee_lookup, period="weekly", limit=8):
    grouped = {}

    for review in reviews:
        employee_id = normalize_text(review.get("employee_id"))

        if not employee_id:
            continue

        key, label = performance_period_key_label(review, period)
        rating = performance_rating_value(review)
        employee = employee_lookup.get(employee_id, {})
        matrix_key = f"{employee_id}:{key}"

        if matrix_key not in grouped:
            grouped[matrix_key] = {
                "employee_id": employee_id,
                "employee_name": review.get("employee_name") or employee_name(employee),
                "emp_code": review.get("employee_code") or employee_code(employee),
                "department": review.get("employee_department") or employee.get("department", ""),
                "designation": review.get("employee_designation") or employee.get("designation", ""),
                "period": period,
                "period_key": key,
                "period_label": label,
                "x": label,
                "y": review.get("employee_name") or employee_name(employee),
                "z": 0,
                "reviews": 0,
                "rated_reviews": 0,
                "average_rating": 0,
                "rating_percentage": 0,
                "rating_label": "Not Rated",
                "_total": 0,
            }
            apply_profile_photo_aliases(grouped[matrix_key], employee_photo(employee))

        row = grouped[matrix_key]
        row["reviews"] += 1

        if rating > 0:
            row["rated_reviews"] += 1
            row["_total"] += rating

    rows = []

    for row in grouped.values():
        rated = row.get("rated_reviews", 0)
        total = row.pop("_total", 0)
        average = round(total / rated, 2) if rated else 0
        row["average_rating"] = average
        row["rating_percentage"] = round((average / 5) * 100, 2) if average else 0
        row["rating_label"] = performance_rating_bucket(average)
        row["z"] = row["rating_percentage"]
        row["graph_value"] = row["rating_percentage"]
        rows.append(row)

    rows = sorted(
        rows,
        key=lambda item: (item.get("period_key", ""), item.get("average_rating", 0), item.get("employee_name", "")),
    )

    if limit and len(rows) > limit * max(len(employee_lookup), 1):
        rows = rows[-limit * max(len(employee_lookup), 1):]

    return rows


def performance_chart_for_members(db, tenant_id, member_ids, reviewer_id=None, title="Performance"):
    member_ids = [str(member_id) for member_id in member_ids if normalize_text(member_id)]

    if not member_ids:
        return empty_performance_chart(title)

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
        .limit(1000)
    )

    valid_object_ids = [
        ObjectId(member_id)
        for member_id in member_ids
        if ObjectId.is_valid(member_id)
    ]

    employees = list(
        db.employees.find({
            "tenant_id": tenant_id,
            "_id": {"$in": valid_object_ids},
            "is_deleted": {"$ne": True},
        })
    ) if valid_object_ids else []

    lookup = employee_lookup_map(employees)
    grouped = {}

    for member_id in member_ids:
        employee = lookup.get(member_id, {})
        row = {
            "employee_id": member_id,
            "employee_name": employee_name(employee) if employee else "Employee",
            "name": employee_name(employee) if employee else "Employee",
            "display_name": employee_name(employee) if employee else "Employee",
            "emp_code": employee_code(employee) if employee else "",
            "employee_code": employee_code(employee) if employee else "",
            "department": employee.get("department", "") if employee else "",
            "designation": employee.get("designation", "") if employee else "",
            "is_team_leader": truthy(employee.get("is_team_leader")) if employee else False,
            "is_reporting_officer": truthy(employee.get("is_reporting_officer")) if employee else False,
            "total_reviews": 0,
            "average_rating": 0,
            "rating_percentage": 0,
            "latest_rating": 0,
            "latest_rating_label": "Not Rated",
            "latest_review_date": "",
            "latest_review_by_name": "",
            "latest_week_label": "",
            "latest_month_label": "",
            "year": "",
            "weekly_average_rating": 0,
            "monthly_average_rating": 0,
            "yearly_average_rating": 0,
            "_rating_total": 0,
            "_rating_count": 0,
        }
        apply_profile_photo_aliases(row, employee_photo(employee))
        grouped[member_id] = row

    today_value = date.today()
    current_week_key, _ = performance_period_key_label({"review_date": today_value}, "weekly")
    current_month_key, _ = performance_period_key_label({"review_date": today_value}, "monthly")
    current_year_key, _ = performance_period_key_label({"review_date": today_value}, "yearly")
    member_period_totals = {}

    for review in reviews:
        member_id = normalize_text(review.get("employee_id"))

        if member_id not in grouped:
            continue

        rating = performance_rating_value(review)
        row = grouped[member_id]
        row["total_reviews"] += 1

        if rating > 0:
            row["_rating_total"] += rating
            row["_rating_count"] += 1

        for period_name, period_key in [
            ("weekly", current_week_key),
            ("monthly", current_month_key),
            ("yearly", current_year_key),
        ]:
            review_period_key, review_period_label = performance_period_key_label(review, period_name)

            if review_period_key != period_key:
                continue

            metric_key = f"{member_id}:{period_name}"

            if metric_key not in member_period_totals:
                member_period_totals[metric_key] = {
                    "total": 0,
                    "count": 0,
                    "label": review_period_label,
                }

            if rating > 0:
                member_period_totals[metric_key]["total"] += rating
                member_period_totals[metric_key]["count"] += 1

        if not row["latest_review_date"]:
            week_key, week_label = performance_period_key_label(review, "weekly")
            month_key, month_label = performance_period_key_label(review, "monthly")
            year_key, year_label = performance_period_key_label(review, "yearly")
            row["latest_rating"] = rating
            row["latest_rating_label"] = performance_rating_bucket(rating)
            row["latest_review_date"] = review.get("review_date") or review.get("date") or review.get("created_at") or ""
            row["latest_review_by_name"] = review.get("reviewer_name") or review.get("reviewer_employee_name") or ""
            row["latest_week_label"] = week_label
            row["latest_month_label"] = month_label
            row["year"] = year_label

    member_rows = []

    for row in grouped.values():
        rating_count = row.pop("_rating_count", 0)
        rating_total = row.pop("_rating_total", 0)
        row["average_rating"] = round(rating_total / rating_count, 2) if rating_count else 0
        row["rating_percentage"] = round((row["average_rating"] / 5) * 100, 2) if row["average_rating"] else 0
        row["rating_label"] = performance_rating_bucket(row["average_rating"])

        for period_name in ["weekly", "monthly", "yearly"]:
            metric_key = f"{row['employee_id']}:{period_name}"
            metric = member_period_totals.get(metric_key, {})
            count = metric.get("count", 0)
            avg = round(metric.get("total", 0) / count, 2) if count else 0
            row[f"{period_name}_average_rating"] = avg
            row[f"{period_name}_rating_percentage"] = round((avg / 5) * 100, 2) if avg else 0
            row[f"{period_name}_rating_label"] = performance_rating_bucket(avg)

        member_rows.append(row)

    member_rows = sorted(
        member_rows,
        key=lambda item: (item["average_rating"], item["total_reviews"], item["employee_name"]),
        reverse=True,
    )

    summary = performance_summary_from_reviews(reviews)
    weekly_chart = performance_period_series(reviews, "weekly", 12)
    monthly_chart = performance_period_series(reviews, "monthly", 12)
    yearly_chart = performance_period_series(reviews, "yearly", 5)
    weekly_3d_graph = performance_member_period_matrix(reviews, lookup, "weekly", 8)
    monthly_3d_graph = performance_member_period_matrix(reviews, lookup, "monthly", 6)
    yearly_3d_graph = performance_member_period_matrix(reviews, lookup, "yearly", 5)

    return {
        "title": title,
        "summary": summary,
        "members": member_rows,
        "rating_distribution": summary["distribution"],
        "recent_reviews": clean_doc(reviews[:20]),
        "weekly_chart": weekly_chart,
        "monthly_chart": monthly_chart,
        "yearly_chart": yearly_chart,
        "weekly_3d_graph": weekly_3d_graph,
        "monthly_3d_graph": monthly_3d_graph,
        "yearly_3d_graph": yearly_3d_graph,
        "performance_3d_graph": weekly_3d_graph,
        "three_d_graph": weekly_3d_graph,
        "graph_mode": "3d-ready",
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
        .limit(500)
    )

    summary = performance_summary_from_reviews(reviews)
    weekly_chart = performance_period_series(reviews, "weekly", 12)
    monthly_chart = performance_period_series(reviews, "monthly", 12)
    yearly_chart = performance_period_series(reviews, "yearly", 5)
    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "_id": ObjectId(employee_id),
        "is_deleted": {"$ne": True},
    }) if ObjectId.is_valid(str(employee_id)) else None
    lookup = {employee_id: employee} if employee else {}
    weekly_3d_graph = performance_member_period_matrix(reviews, lookup, "weekly", 8)
    monthly_3d_graph = performance_member_period_matrix(reviews, lookup, "monthly", 6)
    yearly_3d_graph = performance_member_period_matrix(reviews, lookup, "yearly", 5)

    return {
        "title": title,
        "summary": summary,
        "rating_distribution": summary["distribution"],
        "recent_reviews": clean_doc(reviews[:20]),
        "weekly_chart": weekly_chart,
        "monthly_chart": monthly_chart,
        "yearly_chart": yearly_chart,
        "weekly_3d_graph": weekly_3d_graph,
        "monthly_3d_graph": monthly_3d_graph,
        "yearly_3d_graph": yearly_3d_graph,
        "performance_3d_graph": weekly_3d_graph,
        "three_d_graph": weekly_3d_graph,
        "graph_mode": "3d-ready",
    }


def combined_performance_3d_graph(*charts):
    rows = []

    for chart in charts:
        if not isinstance(chart, dict):
            continue

        title = chart.get("title") or "Performance"

        for row in chart.get("performance_3d_graph", []) or chart.get("weekly_3d_graph", []):
            item = dict(row)
            item["group"] = title
            item["graph_group"] = title
            rows.append(item)

    return rows

def project_dashboard_for_employee(db, tenant_id, emp_id, employee, roles, team_member_ids=None, reporting_member_ids=None):
    team_member_ids = team_member_ids or []
    reporting_member_ids = reporting_member_ids or []

    my_scope = project_scope_for_employee(tenant_id, emp_id, employee)
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
            .find(project_scope_for_team_leader(tenant_id, emp_id, employee))
            .sort("created_at", -1)
            .limit(100)
        )
        team_project_ids = [str(project["_id"]) for project in team_leader_projects]

    reporting_projects = []
    reporting_project_ids = []

    if is_reporting_officer_capability(employee, roles):
        team_leaders = list(
            db.employees.find(
                employee_mapping_query("reporting_officer_id", employee, tenant_id),
                {"_id": 1},
            )
        )

        team_leader_ids = [str(row["_id"]) for row in team_leaders]
        reporting_projects = list(
            db.projects
            .find(project_scope_for_reporting_officer(tenant_id, team_leader_ids, emp_id))
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
                for row in db.employees.find(
                    employee_mapping_query("reporting_officer_id", employee, tenant_id),
                    {"_id": 1},
                )
            ],
        ) if is_reporting_officer_capability(employee, roles) else [],
        "summary": {
            "total_projects": len(my_projects),
            "active_projects": len(active_projects),
            "completed_projects": len(completed_projects),

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
    on_hold_projects = [
        project for project in all_projects
        if normalize_project_status(project.get("status")) == "on_hold"
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
            "on_hold_projects": len(on_hold_projects),
            "completed_projects": len(completed_projects),
            "average_progress": project_progress_average(db, tenant_id, all_project_ids),
        },

        # IMPORTANT:
        # Dashboard should not load full project root maps / hierarchy maps here.
        # Those can contain employee avatar/base64 data and make dashboard APIs slow/heavy.
        # Full hierarchy will be loaded from project detail/list APIs separately.
        "projects": [],
        "active_projects": [],
        "on_hold_projects": [],
        "completed_projects": [],

        "department_performance": department_performance,
        "top_performing_departments": department_performance[:5],
        "daily_progress_chart": project_daily_progress_chart(db, tenant_id, all_project_ids, 14),

        # Keep this lightweight for dashboard.
        "project_wise_performance": [],
        "top_project_performance": [],

        "project_status_chart": project_status_chart(db, tenant_id),
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

    for user in recent_users:
        apply_profile_photo_aliases(user)

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

    current_emp = current_employee(db)

    if current_emp and current_emp.get("tenant_id"):
        tenant_id = str(current_emp.get("tenant_id") or tenant_id or "sds").strip() or "sds"

    g.tenant_id = tenant_id

    g.tenant_id = tenant_id

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

    for employee in recent_employees:
        apply_profile_photo_aliases(employee, employee_photo(employee))

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

    team_scope_ids = []
    my_pending_leave_approvals = []
    my_pending_attendance_mode_requests = []

    if current_emp:
        apply_profile_photo_aliases(current_emp, employee_photo(current_emp))
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
        "tenant_id": tenant_id,
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
                "title": employee_name(emp),
                "subtitle": "Employee profile not found",
                "display_role": "Employee",
                "show_name_as_primary_heading": True,
            },
            "roles": list(roles),
            "is_team_leader": False,
            "is_reporting_officer": False,
            "team_members": [],
            "reporting_members": [],
            "team_hierarchy_tree": {},
            "team_pending_leaves": [],
            "team_pending_attendance_mode_requests": [],
            "my_performance_reviews": [],
            "reviews_given": [],
            "my_performance_chart": {},
            "team_performance_chart": {},
            "reporting_performance_chart": {},
            "performance_summary": {},
            "weekly_performance_chart": [],
            "monthly_performance_chart": [],
            "yearly_performance_chart": [],
            "team_member_weekly_graph": [],
            "reporting_team_leader_weekly_graph": [],
            "performance_3d_graph": [],
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

    apply_profile_photo_aliases(emp, employee_photo(emp))

    tenant_id = str(emp.get("tenant_id") or current_tenant_id() or "sds").strip() or "sds"
    g.tenant_id = tenant_id
    emp_id = str(emp["_id"])
    today_date = date.today()
    today = today_date.isoformat()

    employee_roles = set(roles)

    if is_team_leader_capability(emp, employee_roles):
        employee_roles.add("team_leader")
        employee_roles.add("team_leader_capability")

    if is_reporting_officer_capability(emp, employee_roles):
        employee_roles.add("reporting_officer")
        employee_roles.add("reporting_officer_capability")

    roles = employee_roles

    is_team_leader_role = is_team_leader_capability(emp, roles)
    is_reporting_officer_role = is_reporting_officer_capability(emp, roles)
    employee_name_value = employee_name(emp)

    team_members = []

    if is_team_leader_role:
        team_members = list(
            db.employees
            .find(employee_mapping_query("team_leader_id", emp, tenant_id))
            .sort("name", 1)
        )
    elif emp.get("team_leader_id"):
        team_leader = employee_by_id(db, tenant_id, emp.get("team_leader_id"))

        if team_leader:
            team_members = list(
                db.employees
                .find(employee_mapping_query("team_leader_id", team_leader, tenant_id))
                .sort("name", 1)
            )
        else:
            team_members = list(
                db.employees
                .find({
                    "tenant_id": tenant_id,
                    "team_leader_id": emp.get("team_leader_id"),
                    "status": {"$ne": "Inactive"},
                    "is_deleted": {"$ne": True},
                })
                .sort("name", 1)
            )

    reporting_members = []

    if is_reporting_officer_role:
        reporting_members = list(
            db.employees
            .find(employee_mapping_query("reporting_officer_id", emp, tenant_id))
            .sort("name", 1)
        )
    elif emp.get("reporting_officer_id"):
        reporting_officer = employee_by_id(db, tenant_id, emp.get("reporting_officer_id"))

        if reporting_officer:
            reporting_members = list(
                db.employees
                .find(employee_mapping_query("reporting_officer_id", reporting_officer, tenant_id))
                .sort("name", 1)
            )
        else:
            reporting_members = list(
                db.employees
                .find({
                    "tenant_id": tenant_id,
                    "reporting_officer_id": emp.get("reporting_officer_id"),
                    "status": {"$ne": "Inactive"},
                    "is_deleted": {"$ne": True},
                })
                .sort("name", 1)
            )

    for member in team_members:
        apply_profile_photo_aliases(member, employee_photo(member))

    for member in reporting_members:
        apply_profile_photo_aliases(member, employee_photo(member))

    team_hierarchy_tree = build_employee_team_hierarchy_tree(
        db,
        tenant_id,
        emp,
        roles,
        team_members,
        reporting_members,
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

    weekly_performance_chart = my_performance_chart.get("weekly_chart", [])
    monthly_performance_chart = my_performance_chart.get("monthly_chart", [])
    yearly_performance_chart = my_performance_chart.get("yearly_chart", [])
    team_member_weekly_graph = team_performance_chart.get("performance_3d_graph", [])
    reporting_team_leader_weekly_graph = reporting_performance_chart.get("performance_3d_graph", [])
    performance_3d_graph = combined_performance_3d_graph(
        my_performance_chart,
        team_performance_chart,
        reporting_performance_chart,
    )

    performance_summary = {
        "my_average_rating": my_performance_chart.get("summary", {}).get("average_rating", 0),
        "team_average_rating": team_performance_chart.get("summary", {}).get("average_rating", 0),
        "reporting_average_rating": reporting_performance_chart.get("summary", {}).get("average_rating", 0),
        "reviews_received": my_performance_chart.get("summary", {}).get("total_reviews", 0),
        "reviews_given": len(reviews_given),
        "team_reviews_given": team_performance_chart.get("summary", {}).get("total_reviews", 0),
        "reporting_reviews_given": reporting_performance_chart.get("summary", {}).get("total_reviews", 0),
        "weekly_periods": len(weekly_performance_chart),
        "monthly_periods": len(monthly_performance_chart),
        "yearly_periods": len(yearly_performance_chart),
        "team_member_graph_points": len(team_member_weekly_graph),
        "reporting_graph_points": len(reporting_team_leader_weekly_graph),
    }

    balance_summary = leave_balance_summary(leave_balances)

    dashboard_display_role = (
        "Team Leader + Reporting Officer"
        if is_team_leader_role and is_reporting_officer_role
        else "Team Leader"
        if is_team_leader_role
        else "Reporting Officer"
        if is_reporting_officer_role
        else "Employee"
    )

    return jsonify({
        "employee": clean_doc(emp),
        "employee_summary": clean_doc(employee_snapshot(emp, roles)),
        "dashboard_display": {
            "title": employee_name(emp),
            "subtitle": "Employee Dashboard",
            "display_role": dashboard_display_role,
            "show_name_as_primary_heading": True,
            "avatar": employee_photo(emp),
            "profile_photo": employee_photo(emp),
            "profile_picture": employee_photo(emp),
            "photo": employee_photo(emp),
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
        "team_hierarchy_tree": clean_doc(team_hierarchy_tree),
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
        "weekly_performance_chart": clean_doc(weekly_performance_chart),
        "monthly_performance_chart": clean_doc(monthly_performance_chart),
        "yearly_performance_chart": clean_doc(yearly_performance_chart),
        "team_member_weekly_graph": clean_doc(team_member_weekly_graph),
        "reporting_team_leader_weekly_graph": clean_doc(reporting_team_leader_weekly_graph),
        "performance_3d_graph": clean_doc(performance_3d_graph),
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
