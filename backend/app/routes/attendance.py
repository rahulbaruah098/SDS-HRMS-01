from flask import Blueprint, request, jsonify, g
from datetime import datetime, time, date, timedelta
from bson import ObjectId

from app.extensions import get_db
from app.utils.auth import current_user_required, roles_required, audit
from app.utils.serializers import clean_doc


attendance_bp = Blueprint("attendance", __name__)

OFFICE_START_TIME = time(9, 30)
LATE_CUTOFF = time(9, 50)
OFFICE_END_TIME = time(18, 0)

DEFAULT_STATE = "Assam(HO)"

SUPPORTED_HOLIDAY_STATES = [
    "Assam(HO)",
    "Manipur",
    "Mizoram",
    "Arunachal Pradesh",
]

ATTENDANCE_MODES = ["office", "wfh", "field"]

ATTENDANCE_MANAGER_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "team_leader",
    "reporting_officer",
    "ro",
    "manager",
)

HOLIDAY_MANAGER_ROLES = (
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
)

HOLIDAY_VIEWER_ROLES = (
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "employee",
    "team_leader",
    "reporting_officer",
    "manager",
    "ro",
)

FULL_TENANT_REPORT_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}

TEAM_SCOPE_ROLES = {
    "team_leader",
}

REPORTING_SCOPE_ROLES = {
    "reporting_officer",
    "ro",
    "manager",
}


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


def normalize_mode(value):
    return normalize_text(value).lower()


def truthy(value):
    return str(value or "").strip().lower() in ["true", "yes", "1", "on"]


def normalize_state(value):
    state = normalize_text(value)

    if not state:
        return DEFAULT_STATE

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


def today_local():
    return datetime.now().date()


def now_local():
    return datetime.now()


def parse_date(value):
    try:
        return datetime.strptime(normalize_text(value), "%Y-%m-%d").date()
    except Exception:
        return None


def date_to_str(value):
    if isinstance(value, date):
        return value.isoformat()

    return normalize_text(value)


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

def current_employee_state(db):
    user = getattr(g, "current_user", {}) or {}
    user_id = str(user.get("_id") or "")
    tenant_id = current_tenant_id()

    if not user_id:
        return DEFAULT_STATE

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if not employee:
        employee = db.employees.find_one({
            "user_id": user_id,
            "is_deleted": {"$ne": True},
        })

    if not employee:
        return normalize_state(user.get("state") or DEFAULT_STATE)

    return normalize_state(
        employee.get("state")
        or employee.get("office_state")
        or employee.get("current_state")
        or user.get("state")
        or DEFAULT_STATE
    )


def has_role(*allowed_roles):
    roles = current_user_roles()
    return bool(roles.intersection(set(allowed_roles)))


def emp(db):
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


def employee_state(employee):
    return normalize_state(
        employee.get("state")
        or employee.get("branch")
        or employee.get("work_state")
        or DEFAULT_STATE
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

def employee_organisation_name(employee):
    employee = employee or {}

    return normalize_text(
        employee.get("organisation")
        or employee.get("organization")
        or employee.get("organisation_name")
        or employee.get("organization_name")
    )


def employee_organisation_code(employee):
    employee = employee or {}

    return normalize_text(
        employee.get("organisation_code")
        or employee.get("organization_code")
    ).upper()


def active_employee_base_query(tenant_id=None):
    q = {
        "is_deleted": {"$ne": True},
        "status": {"$nin": [
            "Inactive",
            "inactive",
            "Resigned",
            "resigned",
            "Left",
            "left",
            "Terminated",
            "terminated",
            "Alumni",
            "alumni",
        ]},
    }

    if tenant_id:
        q["tenant_id"] = tenant_id

    return q


def employee_filter_ids(db, tenant_id=None, name="", state="", organisation=""):
    q = active_employee_base_query(tenant_id)

    and_conditions = []

    if name:
        and_conditions.append({
            "$or": [
                {"name": {"$regex": name, "$options": "i"}},
                {"employee_name": {"$regex": name, "$options": "i"}},
                {"full_name": {"$regex": name, "$options": "i"}},
                {"email": {"$regex": name, "$options": "i"}},
                {"official_email": {"$regex": name, "$options": "i"}},
                {"employee_id": {"$regex": name, "$options": "i"}},
                {"employee_code": {"$regex": name, "$options": "i"}},
                {"emp_code": {"$regex": name, "$options": "i"}},
                {"code": {"$regex": name, "$options": "i"}},
            ]
        })

    if state:
        and_conditions.append({
            "$or": [
                {"state": {"$regex": state, "$options": "i"}},
                {"office_state": {"$regex": state, "$options": "i"}},
                {"current_state": {"$regex": state, "$options": "i"}},
                {"branch": {"$regex": state, "$options": "i"}},
                {"work_state": {"$regex": state, "$options": "i"}},
            ]
        })

    if organisation:
        and_conditions.append({
            "$or": [
                {"organisation": {"$regex": organisation, "$options": "i"}},
                {"organization": {"$regex": organisation, "$options": "i"}},
                {"organisation_name": {"$regex": organisation, "$options": "i"}},
                {"organization_name": {"$regex": organisation, "$options": "i"}},
                {"organisation_code": {"$regex": organisation, "$options": "i"}},
                {"organization_code": {"$regex": organisation, "$options": "i"}},
                {"organisation_id": organisation},
                {"organization_id": organisation},
            ]
        })

    if and_conditions:
        q["$and"] = and_conditions

    rows = db.employees.find(q, {"_id": 1})

    return [str(row["_id"]) for row in rows]


def apply_employee_id_filter(q, employee_ids):
    employee_ids = [str(value) for value in employee_ids if value]

    if not employee_ids:
        q["employee_id"] = {"$in": []}
        return q

    existing = q.get("employee_id")

    if isinstance(existing, dict) and "$in" in existing:
        allowed = {str(value) for value in existing.get("$in", [])}
        matched = [value for value in employee_ids if value in allowed]
        q["employee_id"] = {"$in": matched}
        return q

    if existing:
        q["employee_id"] = existing if str(existing) in employee_ids else "__no_match__"
        return q

    q["employee_id"] = {"$in": employee_ids}
    return q


def enrich_attendance_log(db, row):
    row = dict(row or {})
    tenant_id = row.get("tenant_id")
    employee_id = normalize_text(row.get("employee_id"))

    employee = None

    if employee_id:
        employee_obj_id = safe_object_id(employee_id)

        employee_or = [
            {"employee_id": employee_id},
            {"employee_code": employee_id},
            {"emp_code": employee_id},
            {"code": employee_id},
            {"user_id": employee_id},
            {"employee_ref_id": employee_id},
        ]

        if employee_obj_id:
            employee_or.insert(0, {"_id": employee_obj_id})

        employee_q = {
            "is_deleted": {"$ne": True},
            "$or": employee_or,
        }

        if tenant_id:
            employee_q["tenant_id"] = tenant_id

        employee = db.employees.find_one(employee_q)

    if not employee:
        return row

    row["employee_name"] = row.get("employee_name") or employee_display_name(employee)
    row["employee_code"] = row.get("employee_code") or employee_code(employee)
    row["emp_code"] = row.get("emp_code") or employee.get("emp_code", "")
    row["department"] = row.get("department") or employee.get("department", "")
    row["designation"] = row.get("designation") or employee.get("designation", "")
    row["state"] = row.get("state") or employee_state(employee)

    row["organisation"] = (
        row.get("organisation")
        or row.get("organization")
        or employee_organisation_name(employee)
    )

    row["organization"] = row["organisation"]

    row["organisation_name"] = (
        row.get("organisation_name")
        or row.get("organization_name")
        or row["organisation"]
    )

    row["organization_name"] = row["organisation_name"]

    row["organisation_code"] = (
        row.get("organisation_code")
        or row.get("organization_code")
        or employee_organisation_code(employee)
    )

    row["organization_code"] = row["organisation_code"]

    return row

def enrich_field_attendance_log(db, row):
    row = enrich_attendance_log(db, row)

    field_photo = (
        row.get("field_photo")
        or row.get("field_photo_url")
        or row.get("proof_photo")
        or row.get("photo")
        or row.get("check_in_photo")
        or ""
    )

    row["field_photo"] = field_photo
    row["field_photo_url"] = field_photo
    row["photo_url"] = field_photo
    row["field_photo_available"] = bool(field_photo)

    location = (
        row.get("check_in_location")
        or row.get("location")
        or row.get("geo_location")
        or {}
    )

    latitude = (
        location.get("latitude")
        or location.get("lat")
        or row.get("latitude")
        or row.get("lat")
    )

    longitude = (
        location.get("longitude")
        or location.get("lng")
        or row.get("longitude")
        or row.get("lng")
    )

    if latitude and longitude:
        row["map_url"] = f"https://www.google.com/maps?q={latitude},{longitude}"
        row["latitude"] = latitude
        row["longitude"] = longitude
    else:
        row["map_url"] = row.get("map_url", "")

    row["field_location"] = (
        row.get("field_location")
        or row.get("work_location")
        or row.get("visit_place")
        or row.get("place")
        or ""
    )

    return row


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

        object_value = safe_object_id(text_value)

        if object_value and object_value not in values:
            values.append(object_value)

    return values


def employee_is_team_leader(employee):
    employee = employee or {}
    roles = set()

    raw_roles = employee.get("roles", [])

    if isinstance(raw_roles, list):
        roles.update(normalize_role(role) for role in raw_roles if normalize_role(role))
    elif isinstance(raw_roles, str):
        roles.update(normalize_role(role) for role in raw_roles.split(",") if normalize_role(role))

    role = normalize_role(employee.get("role"))

    if role:
        roles.add(role)

    return bool(
        truthy(employee.get("is_team_leader"))
        or truthy(employee.get("team_leader_capability"))
        or truthy(employee.get("tl_capability"))
        or "team_leader" in roles
        or "team_leader_capability" in roles
        or "tl" in roles
    )


def employee_is_reporting_officer(employee):
    employee = employee or {}
    roles = set()

    raw_roles = employee.get("roles", [])

    if isinstance(raw_roles, list):
        roles.update(normalize_role(role) for role in raw_roles if normalize_role(role))
    elif isinstance(raw_roles, str):
        roles.update(normalize_role(role) for role in raw_roles.split(",") if normalize_role(role))

    role = normalize_role(employee.get("role"))

    if role:
        roles.add(role)

    return bool(
        truthy(employee.get("is_reporting_officer"))
        or truthy(employee.get("reporting_officer_capability"))
        or truthy(employee.get("ro_capability"))
        or "reporting_officer" in roles
        or "reporting_officer_capability" in roles
        or "ro" in roles
        or "manager" in roles
    )


def employee_snapshot(employee):
    if not employee:
        return None

    return {
        "_id": str(employee.get("_id")),
        "employee_id": employee_code(employee),
        "name": employee_display_name(employee),
        "email": employee.get("email", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "organisation": employee_organisation_name(employee),
        "organization": employee_organisation_name(employee),
        "organisation_name": employee_organisation_name(employee),
        "organization_name": employee_organisation_name(employee),
        "organisation_code": employee_organisation_code(employee),
        "organization_code": employee_organisation_code(employee),
        "state": employee_state(employee),
        "branch": employee.get("branch", ""),
        "role": "Employee",
        "is_team_leader": str(employee.get("is_team_leader", "false")).lower(),
        "is_reporting_officer": str(employee.get("is_reporting_officer", "false")).lower(),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
    }


def scoped_employee_ids_for_manager(db):
    roles = current_user_roles()

    if roles.intersection(FULL_TENANT_REPORT_ROLES):
        return None

    current_emp = emp(db)

    if not current_emp:
        return []

    current_emp_id = str(current_emp["_id"])
    identifier_values = employee_identifier_values(current_emp)

    if current_emp_id not in identifier_values:
        identifier_values.append(current_emp_id)

    scope_or = []

    if roles.intersection(TEAM_SCOPE_ROLES) or employee_is_team_leader(current_emp):
        scope_or.append({"team_leader_id": {"$in": identifier_values}})

    if roles.intersection(REPORTING_SCOPE_ROLES) or employee_is_reporting_officer(current_emp):
        scope_or.append({"reporting_officer_id": {"$in": identifier_values}})

    if not scope_or:
        return []

    rows = list(
        db.employees.find({
            "tenant_id": current_emp.get("tenant_id") or current_tenant_id(),
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
            "$or": scope_or,
        })
    )

    return [str(row["_id"]) for row in rows]


def manager_scope_query(db):
    roles = current_user_roles()
    tenant_arg = normalize_text(request.args.get("tenant_id"))

    if "super_admin" in roles:
        if tenant_arg:
            return {"tenant_id": tenant_arg}
        return {}

    q = {"tenant_id": current_tenant_id()}

    scoped_employee_ids = scoped_employee_ids_for_manager(db)

    if scoped_employee_ids is not None:
        q["employee_id"] = {"$in": scoped_employee_ids}

    return q


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


def manual_holiday_for_date(db, tenant_id, state, check_date):
    date_str = date_to_str(check_date)

    return db.holiday_calendar.find_one({
        "tenant_id": tenant_id,
        "state": normalize_state(state),
        "date": date_str,
        "status": {"$ne": "inactive"},
        "is_deleted": {"$ne": True},
    })


def holiday_info_for_employee(db, employee, check_date):
    state = employee_state(employee)
    tenant_id = employee.get("tenant_id") or current_tenant_id()

    manual = manual_holiday_for_date(
        db,
        tenant_id,
        state,
        check_date,
    )

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


def approved_mode_for_date(db, employee, attendance_date, mode):
    """WFH and Field no longer need pre-approval.

    The previous flow used attendance_mode_requests for WFH/Field approval.
    New HRMS flow allows office, WFH and field attendance directly.
    Holiday attendance is controlled separately through holiday_work_requests.
    """
    return normalize_mode(mode) in ATTENDANCE_MODES


def available_modes_for_employee(db, employee, attendance_date):
    return list(ATTENDANCE_MODES)


def extract_location(data):
    latitude = data.get("latitude")
    longitude = data.get("longitude")
    accuracy = data.get("accuracy")
    address = normalize_text(data.get("address") or data.get("location_address"))

    try:
        latitude = float(latitude)
    except Exception:
        latitude = None

    try:
        longitude = float(longitude)
    except Exception:
        longitude = None

    try:
        accuracy = float(accuracy)
    except Exception:
        accuracy = None

    return {
        "latitude": latitude,
        "longitude": longitude,
        "accuracy": accuracy,
        "address": address,
    }


def has_required_location(location):
    return (
        location.get("latitude") is not None
        and location.get("longitude") is not None
    )


def get_upload_value(data, *keys):
    for key in keys:
        value = data.get(key)
        if value is not None:
            return value
    return ""


def add_working_days(start_date, working_days, db=None, employee=None):
    """Return the date after adding N working days.

    Weekly holidays are Sunday plus second/fourth Saturday. Manual HR holidays
    are also skipped when db and employee are available.
    """
    cursor = start_date
    added = 0

    while added < working_days:
        if not weekly_holiday_reason(cursor):
            manual = None
            if db is not None and employee is not None:
                manual = manual_holiday_for_date(
                    db,
                    employee.get("tenant_id") or current_tenant_id(),
                    employee_state(employee),
                    cursor,
                )

            if not manual:
                added += 1

        if added < working_days:
            cursor = cursor + timedelta(days=1)

    return cursor


def next_working_day(start_date, db=None, employee=None):
    cursor = start_date + timedelta(days=1)

    while True:
        if weekly_holiday_reason(cursor):
            cursor += timedelta(days=1)
            continue

        if db is not None and employee is not None:
            manual = manual_holiday_for_date(
                db,
                employee.get("tenant_id") or current_tenant_id(),
                employee_state(employee),
                cursor,
            )

            if manual:
                cursor += timedelta(days=1)
                continue

        return cursor


def approved_holiday_work_request(db, employee, attendance_date):
    return db.holiday_work_requests.find_one({
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "employee_id": str(employee["_id"]),
        "date": date_to_str(attendance_date),
        "status": "approved",
        "is_deleted": {"$ne": True},
    })


def pending_holiday_work_request(db, employee, attendance_date):
    return db.holiday_work_requests.find_one({
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "employee_id": str(employee["_id"]),
        "date": date_to_str(attendance_date),
        "status": "pending",
        "is_deleted": {"$ne": True},
    })


def can_decide_holiday_work_request(db, request_doc):
    return can_decide_mode_request(db, request_doc)


def notify_attendance_stakeholders(db, employee, title, body, meta=None, include_employee=False):
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    user_ids = []

    if include_employee and employee.get("user_id"):
        user_ids.append(str(employee.get("user_id")))

    user_ids.extend(approval_target_user_ids(db, employee))
    user_ids.extend(users_for_roles(db, FULL_TENANT_REPORT_ROLES, tenant_id))

    notify_users(db, user_ids, title, body, meta or {}, tenant_id=tenant_id)


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


def users_for_roles(db, role_names, tenant_id=None):
    tenant_id = tenant_id or current_tenant_id()

    rows = db.users.find({
        "tenant_id": tenant_id,
        "is_active": True,
        "roles": {"$in": list(role_names)},
    })

    return [str(row["_id"]) for row in rows]


def employee_user_id(db, employee_id, tenant_id=None):
    raw_id = normalize_text(employee_id)

    if not raw_id:
        return ""

    q = {
        "is_deleted": {"$ne": True},
    }

    if tenant_id:
        q["tenant_id"] = tenant_id
    else:
        q["tenant_id"] = current_tenant_id()

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

    row = db.employees.find_one({
        **q,
        "$or": identifier_or,
    })

    return str(row.get("user_id", "")) if row else ""


def approval_target_user_ids(db, employee):
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    user_ids = []

    team_leader_user_id = employee_user_id(
        db,
        employee.get("team_leader_id"),
        tenant_id,
    )

    reporting_officer_user_id = employee_user_id(
        db,
        employee.get("reporting_officer_id"),
        tenant_id,
    )

    if team_leader_user_id:
        user_ids.append(team_leader_user_id)
    elif reporting_officer_user_id:
        user_ids.append(reporting_officer_user_id)
    else:
        user_ids.extend(users_for_roles(db, FULL_TENANT_REPORT_ROLES, tenant_id))

    return user_ids


def first_approval_stage(employee):
    if employee.get("team_leader_id"):
        return "team_leader", "Team Leader"

    if employee.get("reporting_officer_id"):
        return "reporting_officer", "Reporting Officer"

    return "hr", "HR"


def next_approval_stage_after_team_leader(request_doc):
    if request_doc.get("reporting_officer_id"):
        return "reporting_officer", "Reporting Officer"

    return "approved", "Approved"


def create_compoff_if_needed(db, employee, attendance_doc, holiday_info):
    if not holiday_info.get("is_holiday"):
        return None

    tenant_id = employee.get("tenant_id") or current_tenant_id()

    existing = db.compoff_credits.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "source_attendance_id": str(attendance_doc["_id"]),
        "is_deleted": {"$ne": True},
    })

    if existing:
        return existing

    now = datetime.utcnow()
    earned_date = parse_date(attendance_doc.get("date")) or today_local()
    available_from = next_working_day(earned_date, db, employee)
    valid_until_date = add_working_days(available_from, 7, db, employee)

    compoff_doc = {
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "employee_name": employee_display_name(employee),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
        "source_attendance_id": str(attendance_doc["_id"]),
        "source_holiday_work_request_id": attendance_doc.get("holiday_work_request_id", ""),
        "earned_date": earned_date.isoformat(),
        "available_from": available_from.isoformat(),
        "valid_until": valid_until_date.isoformat(),
        "leave_days": 1.0,
        "status": "available",
        "holiday_title": holiday_info.get("title", ""),
        "holiday_type": holiday_info.get("holiday_type", ""),
        "holiday_message": holiday_info.get("message", ""),
        "claim_window_working_days": 7,
        "created_at": now,
        "updated_at": now,
    }

    res = db.compoff_credits.insert_one(compoff_doc)
    compoff_doc["_id"] = res.inserted_id

    notify_attendance_stakeholders(
        db,
        employee,
        "Comp-Off Earned",
        f"{employee_display_name(employee)} worked on holiday and earned 1 comp-off. It can be claimed from {available_from.isoformat()} to {valid_until_date.isoformat()}.",
        {
            "employee_id": str(employee["_id"]),
            "attendance_id": str(attendance_doc["_id"]),
            "compoff_id": str(res.inserted_id),
            "available_from": available_from.isoformat(),
            "valid_until": valid_until_date.isoformat(),
        },
        include_employee=True,
    )

    audit("create_compoff", "compoff_credits", res.inserted_id, {
        "employee_id": str(employee["_id"]),
        "attendance_id": str(attendance_doc["_id"]),
        "valid_until": valid_until_date.isoformat(),
    })

    return compoff_doc


def expire_old_compoffs(db, tenant_id=None):
    today = today_local().isoformat()
    q = {
        "status": "available",
        "valid_until": {"$lt": today},
        "is_deleted": {"$ne": True},
    }

    if tenant_id:
        q["tenant_id"] = tenant_id
    else:
        q["tenant_id"] = current_tenant_id()

    db.compoff_credits.update_many(
        q,
        {
            "$set": {
                "status": "expired",
                "updated_at": datetime.utcnow(),
            }
        },
    )


def can_decide_mode_request(db, request_doc):
    roles = current_user_roles()

    if roles.intersection(FULL_TENANT_REPORT_ROLES):
        return True

    reviewer = emp(db)

    if not reviewer:
        return False

    reviewer_id = str(reviewer["_id"])
    reviewer_identifier_values = employee_identifier_values(reviewer)

    if reviewer_id not in reviewer_identifier_values:
        reviewer_identifier_values.append(reviewer_id)

    if request_doc.get("approval_stage") == "team_leader":
        return (
            request_doc.get("team_leader_id") in reviewer_identifier_values
            and (
                "team_leader" in roles
                or employee_is_team_leader(reviewer)
            )
        )

    if request_doc.get("approval_stage") == "reporting_officer":
        return (
            request_doc.get("reporting_officer_id") in reviewer_identifier_values
            and (
                "reporting_officer" in roles
                or "ro" in roles
                or employee_is_reporting_officer(reviewer)
            )
        )

    return False


@attendance_bp.get("/status")
@current_user_required
def attendance_status():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    tenant_id = e.get("tenant_id") or current_tenant_id()
    expire_old_compoffs(db, tenant_id)

    check_date = today_local()
    today = check_date.isoformat()

    rec = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "date": today,
        "is_deleted": {"$ne": True},
    })

    holiday_info = holiday_info_for_employee(db, e, check_date)
    modes = available_modes_for_employee(db, e, check_date)
    approved_holiday_request = approved_holiday_work_request(db, e, check_date)
    pending_holiday_request = pending_holiday_work_request(db, e, check_date)

    pending_mode_requests = list(
        db.attendance_mode_requests
        .find({
            "tenant_id": tenant_id,
            "employee_id": str(e["_id"]),
            "date": today,
            "status": "pending",
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
    )

    compoffs = list(
        db.compoff_credits
        .find({
            "tenant_id": tenant_id,
            "employee_id": str(e["_id"]),
            "status": {"$in": ["available", "claimed", "expired"]},
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(20)
    )

    return jsonify({
        "today": today,
        "office_start": "09:30",
        "late_cutoff": "09:50",
        "office_end": "18:00",
        "employee": clean_doc(employee_snapshot(e)),
        "employee_summary": clean_doc(employee_snapshot(e)),
        "employee_state": employee_state(e),
        "team_leader_id": e.get("team_leader_id", ""),
        "team_leader_name": e.get("team_leader_name", ""),
        "reporting_officer_id": e.get("reporting_officer_id", ""),
        "reporting_officer_name": e.get("reporting_officer_name", ""),
        "holiday": holiday_info,
        "available_modes": modes,
        "holiday_work_request": clean_doc(approved_holiday_request or pending_holiday_request),
        "holiday_work_approved": bool(approved_holiday_request),
        "holiday_check_in_blocked": bool(holiday_info.get("is_holiday") and not approved_holiday_request),
        "attendance": clean_doc(rec),
        "pending_mode_requests": clean_doc(pending_mode_requests),
        "compoffs": clean_doc(compoffs),
    })


@attendance_bp.post("/check-in")
@current_user_required
def check_in():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}

    mode = normalize_mode(data.get("mode") or "office")
    late_reason = normalize_text(data.get("late_reason"))
    field_location = normalize_text(
        data.get("field_location")
        or data.get("field_place")
        or data.get("place")
        or data.get("work_place")
    )
    field_photo = get_upload_value(
        data,
        "field_photo",
        "field_photo_url",
        "photo",
        "photo_url",
        "image",
        "image_url",
    )
    location = extract_location(data)

    now = now_local()
    today_date = now.date()
    today = today_date.isoformat()
    tenant_id = e.get("tenant_id") or current_tenant_id()

    if mode not in ATTENDANCE_MODES:
        return jsonify({"message": "Invalid attendance mode"}), 400

    if mode == "field" and not field_location:
        return jsonify({
            "message": "Field location / visit place is required for field attendance"
        }), 400

    if mode == "field" and not field_photo:
        return jsonify({
            "message": "Field attendance photo is required"
        }), 400

    holiday_info = holiday_info_for_employee(db, e, today_date)
    holiday_work_request = None

    if holiday_info.get("is_holiday"):
        holiday_work_request = approved_holiday_work_request(db, e, today_date)

        if not holiday_work_request:
            pending_request = pending_holiday_work_request(db, e, today_date)
            return jsonify({
                "message": "Holiday attendance requires approved holiday work request",
                "holiday": holiday_info,
                "pending_holiday_work_request": clean_doc(pending_request),
            }), 403

    is_late = now.time() >= LATE_CUTOFF and not holiday_info.get("is_holiday")

    if is_late and not late_reason:
        return jsonify({
            "message": "Late reason is required from 09:50 AM onwards"
        }), 400

    old = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "date": today,
        "is_deleted": {"$ne": True},
    })

    if old and old.get("check_in"):
        return jsonify({
            "message": "Already checked in today",
            "attendance": clean_doc(old),
        }), 409

    status = "present"

    if holiday_info.get("is_holiday"):
        status = "holiday_work"
    elif is_late:
        status = "late"

    doc = {
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "employee_code": employee_code(e),
        "emp_code": e.get("emp_code", ""),
        "employee_name": employee_display_name(e),
        "department": e.get("department", ""),
        "designation": e.get("designation", ""),
        "organisation": employee_organisation_name(e),
        "organization": employee_organisation_name(e),
        "organisation_name": employee_organisation_name(e),
        "organization_name": employee_organisation_name(e),
        "organisation_code": employee_organisation_code(e),
        "organization_code": employee_organisation_code(e),
        "state": employee_state(e),
        "team_leader_id": e.get("team_leader_id", ""),
        "team_leader_name": e.get("team_leader_name", ""),
        "reporting_officer_id": e.get("reporting_officer_id", ""),
        "reporting_officer_name": e.get("reporting_officer_name", ""),
        "date": today,
        "check_in": now,
        "check_out": None,
        "office_start": "09:30",
        "late_cutoff": "09:50",
        "office_end": "18:00",
        "mode": mode,
        "field_location": field_location,
        "field_photo": field_photo,
        "field_photo_url": field_photo if isinstance(field_photo, str) else "",
        "late_reason": late_reason,
        "early_checkout_reason": "",
        "check_in_location": location,
        "check_out_location": None,
        "location_accuracy_warning": bool(location.get("accuracy") and location.get("accuracy") > 100),
        "is_late": is_late,
        "is_early_checkout": False,
        "is_holiday_work": bool(holiday_info.get("is_holiday")),
        "holiday_title": holiday_info.get("title", ""),
        "holiday_type": holiday_info.get("holiday_type", ""),
        "holiday_message": holiday_info.get("message", ""),
        "holiday_work_request_id": str(holiday_work_request.get("_id")) if holiday_work_request else "",
        "status": status,
        "verified_by_ro": False,
        "timeline": [
            {
                "type": "check_in",
                "time": now,
                "note": f"{mode.upper()} check-in",
                "location": location,
                "field_location": field_location,
            }
        ],
        "created_at": now,
        "updated_at": now,
    }

    res = db.attendance_logs.insert_one(doc)
    doc["_id"] = res.inserted_id

    if mode == "field":
        map_url = ""

        if location.get("latitude") and location.get("longitude"):
            map_url = f"https://www.google.com/maps?q={location.get('latitude')},{location.get('longitude')}"

        notify_attendance_stakeholders(
            db,
            e,
            "Field Attendance Marked",
            f"{employee_display_name(e)} marked field attendance at {field_location}.",
            {
                "employee_id": str(e["_id"]),
                "attendance_id": str(res.inserted_id),
                "field_attendance_id": str(res.inserted_id),
                "field_location": field_location,
                "field_photo_available": bool(field_photo),
                "field_photo_url": field_photo if isinstance(field_photo, str) else "",
                "map_url": map_url,
                "date": today,
                "mode": mode,
            },
        )

    audit("check_in", "attendance_logs", res.inserted_id, {
        "mode": mode,
        "late": is_late,
        "holiday_work": bool(holiday_info.get("is_holiday")),
    })

    return jsonify({
        "message": "Check-in successful",
        "attendance": clean_doc(doc),
        "holiday": holiday_info,
    })


@attendance_bp.post("/check-out")
@current_user_required
def check_out():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}

    now = now_local()
    today_date = now.date()
    today = today_date.isoformat()
    tenant_id = e.get("tenant_id") or current_tenant_id()

    early_checkout_reason = normalize_text(data.get("early_checkout_reason"))
    location = extract_location(data)

    rec = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "date": today,
        "is_deleted": {"$ne": True},
    })

    if not rec:
        return jsonify({"message": "Please check in first"}), 400

    if rec.get("check_out"):
        return jsonify({
            "message": "Already checked out",
            "attendance": clean_doc(rec),
        }), 409

    holiday_info = holiday_info_for_employee(db, e, today_date)
    is_early_checkout = now.time() < OFFICE_END_TIME and not holiday_info.get("is_holiday")

    if is_early_checkout and not early_checkout_reason:
        return jsonify({
            "message": "Early checkout reason is required before 06:00 PM"
        }), 400

    set_data = {
        "check_out": now,
        "check_out_location": location,
        "checkout_location_accuracy_warning": bool(location.get("accuracy") and location.get("accuracy") > 100),
        "is_early_checkout": is_early_checkout,
        "early_checkout_reason": early_checkout_reason,
        "updated_at": now,
    }

    if rec.get("status") == "present" and is_early_checkout:
        set_data["status"] = "early_checkout"

    db.attendance_logs.update_one(
        {"_id": rec["_id"]},
        {
            "$set": set_data,
            "$push": {
                "timeline": {
                    "type": "check_out",
                    "time": now,
                    "note": "Day closed",
                    "location": location,
                }
            },
        },
    )

    updated = db.attendance_logs.find_one({"_id": rec["_id"]})

    compoff = None

    if updated and updated.get("is_holiday_work"):
        compoff = create_compoff_if_needed(db, e, updated, holiday_info)

    audit("check_out", "attendance_logs", rec["_id"], {
        "early_checkout": is_early_checkout,
        "holiday_work": bool(updated.get("is_holiday_work")) if updated else False,
    })

    return jsonify({
        "message": "Check-out successful",
        "attendance": clean_doc(updated),
        "compoff": clean_doc(compoff),
    })


@attendance_bp.get("/my")
@current_user_required
def my():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"items": []})

    q = {
        "tenant_id": e.get("tenant_id") or current_tenant_id(),
        "employee_id": str(e["_id"]),
        "is_deleted": {"$ne": True},
    }

    items = list(
        db.attendance_logs
        .find(q)
        .sort("date", -1)
        .limit(60)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.get("/report")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def report():
    db = get_db()

    q = manager_scope_query(db)

    employee_id = normalize_text(request.args.get("employee_id"))
    employee_name = normalize_text(
        request.args.get("employee_name")
        or request.args.get("name")
        or request.args.get("q")
        or request.args.get("search")
    )
    department = normalize_text(request.args.get("department"))
    mode = normalize_mode(request.args.get("mode"))
    status = normalize_text(request.args.get("status"))
    state = normalize_text(request.args.get("state"))
    organisation = normalize_text(
        request.args.get("organisation")
        or request.args.get("organization")
        or request.args.get("organisation_name")
        or request.args.get("organization_name")
        or request.args.get("organisation_code")
        or request.args.get("organization_code")
        or request.args.get("entity")
        or request.args.get("entity_code")
        or request.args.get("organisation_id")
        or request.args.get("organization_id")
    )

    exact_date = normalize_text(
        request.args.get("date")
        or request.args.get("on_date")
    )
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))

    tenant_id = q.get("tenant_id") if isinstance(q.get("tenant_id"), str) else current_tenant_id()

    if employee_id:
        if isinstance(q.get("employee_id"), dict) and "$in" in q["employee_id"]:
            if employee_id not in q["employee_id"]["$in"]:
                return jsonify({"items": []})

        q["employee_id"] = employee_id

    if employee_name or state or organisation:
        matched_employee_ids = employee_filter_ids(
            db,
            tenant_id=tenant_id,
            name=employee_name,
            state=state,
            organisation=organisation,
        )

        apply_employee_id_filter(q, matched_employee_ids)

    if department:
        q["department"] = {"$regex": department, "$options": "i"}

    if mode:
        q["mode"] = mode

    if status:
        q["status"] = status

    if exact_date:
        q["date"] = exact_date
    elif date_from or date_to:
        q["date"] = {}

        if date_from:
            q["date"]["$gte"] = date_from

        if date_to:
            q["date"]["$lte"] = date_to
    else:
        # Default HR/Admin report should show daily attendance only.
        # Past records will appear only when date/date_from/date_to is selected.
        q["date"] = today_local().isoformat()

    q["is_deleted"] = {"$ne": True}

    items = list(
        db.attendance_logs
        .find(q)
        .sort([("date", -1), ("check_in", -1), ("created_at", -1)])
        .limit(500)
    )

    enriched_items = [
        enrich_attendance_log(db, item)
        for item in items
    ]

    return jsonify({
        "items": clean_doc(enriched_items),
        "default_date": q.get("date") if isinstance(q.get("date"), str) else "",
    })


@attendance_bp.patch("/<attendance_id>/verify")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def verify(attendance_id):
    attendance_obj_id = safe_object_id(attendance_id)

    if not attendance_obj_id:
        return jsonify({"message": "Invalid attendance id"}), 400

    db = get_db()
    roles = current_user_roles()

    q = {
        "_id": attendance_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    if not roles.intersection(FULL_TENANT_REPORT_ROLES):
        scoped_employee_ids = scoped_employee_ids_for_manager(db)

        if scoped_employee_ids is not None:
            q["employee_id"] = {"$in": scoped_employee_ids}

    existing = db.attendance_logs.find_one(q)

    if not existing:
        return jsonify({
            "message": "Attendance record not found or not in your scope"
        }), 404

    db.attendance_logs.update_one(
        {"_id": existing["_id"]},
        {
            "$set": {
                "verified_by_ro": True,
                "verified_at": datetime.utcnow(),
                "verified_by": str(g.current_user["_id"]),
                "verified_by_name": g.current_user.get("name") or g.current_user.get("email"),
                "updated_at": datetime.utcnow(),
            }
        },
    )

    audit("verify", "attendance_logs", attendance_id)

    return jsonify({"message": "Attendance verified"})


@attendance_bp.get("/holidays")
@roles_required(*HOLIDAY_VIEWER_ROLES)
def list_holidays():
    db = get_db()
    roles = current_user_roles()

    state_arg = normalize_text(request.args.get("state"))
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))
    tenant_arg = normalize_text(request.args.get("tenant_id"))

    manager_roles = {
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "super_admin",
    }

    can_manage_holidays = bool(roles.intersection(manager_roles))
    requested_state = normalize_state(state_arg) if state_arg else ""

    q = {
        "status": {"$ne": "inactive"},
        "is_deleted": {"$ne": True},
    }

    # Tenant isolation:
    # Super Admin can filter tenant by tenant_id.
    # All tenant users, including employees, can only see their own tenant.
    if "super_admin" in roles and tenant_arg:
        q["tenant_id"] = tenant_arg
    else:
        q["tenant_id"] = current_tenant_id()

    # Employee default view:
    # If employee opens holiday page without selecting state,
    # show only their own state holidays.
    # If employee selects another state from filter,
    # allow viewing that state within same tenant only.
    if requested_state:
        q["state"] = requested_state
    elif not can_manage_holidays:
        q["state"] = current_employee_state(db)

    if date_from or date_to:
        q["date"] = {}

        if date_from:
            q["date"]["$gte"] = date_from

        if date_to:
            q["date"]["$lte"] = date_to

    items = list(
        db.holiday_calendar
        .find(q)
        .sort([("date", 1), ("state", 1)])
        .limit(500)
    )

    return jsonify({
        "states": SUPPORTED_HOLIDAY_STATES,
        "default_state": current_employee_state(db),
        "can_manage": can_manage_holidays,
        "items": clean_doc(items),
    })


@attendance_bp.post("/holidays")
@roles_required(*HOLIDAY_MANAGER_ROLES)
def create_holiday():
    db = get_db()
    data = request.get_json(silent=True) or {}
    roles = current_user_roles()

    tenant_id = normalize_text(data.get("tenant_id")) or current_tenant_id()

    if "super_admin" not in roles:
        tenant_id = current_tenant_id()

    state = normalize_state(data.get("state"))
    holiday_date = parse_date(data.get("date"))
    title = normalize_text(data.get("title"))
    message = normalize_text(data.get("message"))

    if state not in SUPPORTED_HOLIDAY_STATES:
        return jsonify({
            "message": "Invalid state for holiday calendar"
        }), 400

    if not holiday_date:
        return jsonify({"message": "Holiday date is required"}), 400

    if not title:
        return jsonify({"message": "Holiday title is required"}), 400

    now = datetime.utcnow()

    doc = {
        "tenant_id": tenant_id,
        "state": state,
        "date": holiday_date.isoformat(),
        "title": title,
        "message": message,
        "status": "active",
        "created_at": now,
        "updated_at": now,
        "created_by": str(g.current_user["_id"]),
        "created_by_name": g.current_user.get("name") or g.current_user.get("email"),
    }

    existing = db.holiday_calendar.find_one({
        "tenant_id": tenant_id,
        "state": state,
        "date": holiday_date.isoformat(),
        "status": {"$ne": "inactive"},
        "is_deleted": {"$ne": True},
    })

    if existing:
        return jsonify({
            "message": "Holiday already exists for this state and date"
        }), 409

    res = db.holiday_calendar.insert_one(doc)
    doc["_id"] = res.inserted_id

    audit("create", "holiday_calendar", res.inserted_id, doc)

    return jsonify({
        "message": "Holiday added",
        "item": clean_doc(doc),
    }), 201


@attendance_bp.patch("/holidays/<holiday_id>")
@roles_required(*HOLIDAY_MANAGER_ROLES)
def update_holiday(holiday_id):
    holiday_obj_id = safe_object_id(holiday_id)

    if not holiday_obj_id:
        return jsonify({"message": "Invalid holiday id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    roles = current_user_roles()

    q = {
        "_id": holiday_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    existing = db.holiday_calendar.find_one(q)

    if not existing:
        return jsonify({"message": "Holiday not found"}), 404

    update_data = {
        "updated_at": datetime.utcnow(),
        "updated_by": str(g.current_user["_id"]),
    }

    if "state" in data:
        state = normalize_state(data.get("state"))

        if state not in SUPPORTED_HOLIDAY_STATES:
            return jsonify({
                "message": "Invalid state for holiday calendar"
            }), 400

        update_data["state"] = state

    if "date" in data:
        holiday_date = parse_date(data.get("date"))

        if not holiday_date:
            return jsonify({"message": "Invalid holiday date"}), 400

        update_data["date"] = holiday_date.isoformat()

    if "title" in data:
        title = normalize_text(data.get("title"))

        if not title:
            return jsonify({"message": "Holiday title is required"}), 400

        update_data["title"] = title

    if "message" in data:
        update_data["message"] = normalize_text(data.get("message"))

    if "status" in data:
        update_data["status"] = normalize_text(data.get("status")) or "active"

    db.holiday_calendar.update_one(
        {"_id": holiday_obj_id},
        {"$set": update_data},
    )

    audit("update", "holiday_calendar", holiday_id, update_data)

    return jsonify({
        "message": "Holiday updated",
        "item": clean_doc(db.holiday_calendar.find_one({"_id": holiday_obj_id})),
    })


@attendance_bp.delete("/holidays/<holiday_id>")
@roles_required(*HOLIDAY_MANAGER_ROLES)
def delete_holiday(holiday_id):
    holiday_obj_id = safe_object_id(holiday_id)

    if not holiday_obj_id:
        return jsonify({"message": "Invalid holiday id"}), 400

    db = get_db()
    roles = current_user_roles()

    q = {"_id": holiday_obj_id}

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    existing = db.holiday_calendar.find_one(q)

    if not existing:
        return jsonify({"message": "Holiday not found"}), 404

    db.holiday_calendar.update_one(
        {"_id": holiday_obj_id},
        {
            "$set": {
                "status": "inactive",
                "is_deleted": True,
                "updated_at": datetime.utcnow(),
                "updated_by": str(g.current_user["_id"]),
            }
        },
    )

    audit("delete", "holiday_calendar", holiday_id)

    return jsonify({"message": "Holiday deleted"})


@attendance_bp.post("/holiday-work-requests")
@current_user_required
def create_holiday_work_request():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}
    request_date = parse_date(data.get("date")) or today_local()
    reason = normalize_text(data.get("reason"))
    work_location = normalize_text(
        data.get("work_location")
        or data.get("field_location")
        or data.get("place")
        or data.get("location")
    )
    proof_photo = get_upload_value(data, "photo", "proof_photo", "field_photo", "image", "photo_url")
    location = extract_location(data)
    tenant_id = e.get("tenant_id") or current_tenant_id()
    holiday_info = holiday_info_for_employee(db, e, request_date)

    if not holiday_info.get("is_holiday"):
        return jsonify({"message": "Holiday work request can be raised only for holiday dates"}), 400

    if request_date < today_local():
        return jsonify({"message": "Holiday work request cannot be raised for past dates"}), 400

    if not reason:
        return jsonify({"message": "Reason is required"}), 400

    existing = db.holiday_work_requests.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "date": request_date.isoformat(),
        "status": {"$in": ["pending", "approved"]},
        "is_deleted": {"$ne": True},
    })

    if existing:
        return jsonify({
            "message": "Holiday work request already exists for this date",
            "item": clean_doc(existing),
        }), 409

    now = datetime.utcnow()
    approval_stage, approval_stage_label = first_approval_stage(e)

    doc = {
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "employee_code": employee_code(e),
        "emp_code": e.get("emp_code", ""),
        "employee_name": employee_display_name(e),
        "department": e.get("department", ""),
        "designation": e.get("designation", ""),
        "state": employee_state(e),
        "team_leader_id": e.get("team_leader_id", ""),
        "team_leader_name": e.get("team_leader_name", ""),
        "reporting_officer_id": e.get("reporting_officer_id", ""),
        "reporting_officer_name": e.get("reporting_officer_name", ""),
        "date": request_date.isoformat(),
        "reason": reason,
        "work_location": work_location,
        "proof_photo": proof_photo,
        "location": location,
        "holiday_title": holiday_info.get("title", ""),
        "holiday_type": holiday_info.get("holiday_type", ""),
        "holiday_message": holiday_info.get("message", ""),
        "status": "pending",
        "approval_stage": approval_stage,
        "approval_stage_label": approval_stage_label,
        "approval_history": [],
        "created_at": now,
        "updated_at": now,
        "created_by": str(g.current_user["_id"]),
    }

    res = db.holiday_work_requests.insert_one(doc)
    doc["_id"] = res.inserted_id

    notify_users(
        db,
        approval_target_user_ids(db, e),
        "Holiday Work Request",
        f"{employee_display_name(e)} requested holiday work approval for {request_date.isoformat()}.",
        {
            "request_id": str(res.inserted_id),
            "employee_id": str(e["_id"]),
            "date": request_date.isoformat(),
            "approval_stage": approval_stage,
        },
        tenant_id=tenant_id,
    )

    audit("create", "holiday_work_requests", res.inserted_id, {
        "employee_id": str(e["_id"]),
        "date": request_date.isoformat(),
    })

    return jsonify({"message": "Holiday work request submitted", "item": clean_doc(doc)}), 201


@attendance_bp.get("/my-holiday-work-requests")
@current_user_required
def my_holiday_work_requests():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"items": []})

    items = list(
        db.holiday_work_requests
        .find({
            "tenant_id": e.get("tenant_id") or current_tenant_id(),
            "employee_id": str(e["_id"]),
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(100)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.get("/holiday-work-requests")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def list_holiday_work_requests():
    db = get_db()
    roles = current_user_roles()
    q = {"is_deleted": {"$ne": True}}

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    status = normalize_text(request.args.get("status"))
    if status:
        q["status"] = status

    date_value = normalize_text(request.args.get("date"))
    if date_value:
        q["date"] = date_value

    scoped_employee_ids = scoped_employee_ids_for_manager(db)
    if scoped_employee_ids is not None:
        q["employee_id"] = {"$in": scoped_employee_ids}

        reviewer = emp(db)
        reviewer_identifier_values = employee_identifier_values(reviewer) if reviewer else []
        pending_scope = []

        if reviewer and ("team_leader" in roles or employee_is_team_leader(reviewer)):
            pending_scope.append({
                "approval_stage": "team_leader",
                "team_leader_id": {"$in": reviewer_identifier_values},
            })

        if reviewer and ("reporting_officer" in roles or "ro" in roles or employee_is_reporting_officer(reviewer)):
            pending_scope.append({
                "approval_stage": "reporting_officer",
                "reporting_officer_id": {"$in": reviewer_identifier_values},
            })

        if pending_scope and status == "pending":
            q["$or"] = pending_scope

    items = list(
        db.holiday_work_requests
        .find(q)
        .sort("created_at", -1)
        .limit(500)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.patch("/holiday-work-requests/<request_id>/decision")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def decide_holiday_work_request(request_id):
    request_obj_id = safe_object_id(request_id)

    if not request_obj_id:
        return jsonify({"message": "Invalid request id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    roles = current_user_roles()

    status = normalize_text(data.get("status")).lower()
    decision_note = normalize_text(data.get("decision_note") or data.get("note"))

    if status not in ["approved", "rejected"]:
        return jsonify({"message": "Status must be approved or rejected"}), 400

    q = {"_id": request_obj_id, "is_deleted": {"$ne": True}}
    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    request_doc = db.holiday_work_requests.find_one(q)

    if not request_doc:
        return jsonify({"message": "Request not found"}), 404

    if request_doc.get("status") != "pending":
        return jsonify({"message": "Only pending requests can be decided"}), 400

    if not can_decide_holiday_work_request(db, request_doc):
        return jsonify({"message": "Request is not in your approval scope"}), 403

    now = datetime.utcnow()

    history_entry = {
        "stage": request_doc.get("approval_stage") or "",
        "stage_label": request_doc.get("approval_stage_label") or "",
        "status": status,
        "decision_note": decision_note,
        "decided_at": now,
        "decided_by": str(g.current_user["_id"]),
        "decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
    }

    set_data = {
        "decision_note": decision_note,
        "last_decided_at": now,
        "last_decided_by": str(g.current_user["_id"]),
        "last_decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
        "updated_at": now,
    }

    if status == "rejected":
        set_data.update({
            "status": "rejected",
            "approval_stage": "rejected",
            "approval_stage_label": "Rejected",
            "decided_at": now,
            "decided_by": str(g.current_user["_id"]),
            "decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
        })
    else:
        if request_doc.get("approval_stage") == "team_leader":
            next_stage, next_stage_label = next_approval_stage_after_team_leader(request_doc)

            if next_stage == "approved":
                set_data.update({
                    "status": "approved",
                    "approval_stage": "approved",
                    "approval_stage_label": "Approved",
                    "decided_at": now,
                    "decided_by": str(g.current_user["_id"]),
                    "decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
                })
            else:
                set_data.update({
                    "status": "pending",
                    "approval_stage": next_stage,
                    "approval_stage_label": next_stage_label,
                })

                reporting_user_id = employee_user_id(
                    db,
                    request_doc.get("reporting_officer_id"),
                    request_doc.get("tenant_id") or current_tenant_id(),
                )

                notify_users(
                    db,
                    [reporting_user_id],
                    "Holiday Work Request",
                    f"{request_doc.get('employee_name', 'Employee')} holiday work request is pending for Reporting Officer approval.",
                    {
                        "request_id": str(request_obj_id),
                        "employee_id": request_doc.get("employee_id"),
                        "date": request_doc.get("date"),
                        "approval_stage": next_stage,
                    },
                    tenant_id=request_doc.get("tenant_id") or current_tenant_id(),
                )
        else:
            set_data.update({
                "status": "approved",
                "approval_stage": "approved",
                "approval_stage_label": "Approved",
                "decided_at": now,
                "decided_by": str(g.current_user["_id"]),
                "decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
            })

    db.holiday_work_requests.update_one(
        {"_id": request_obj_id},
        {"$set": set_data, "$push": {"approval_history": history_entry}},
    )

    updated_doc = db.holiday_work_requests.find_one({"_id": request_obj_id})
    employee_user = employee_user_id(
        db,
        request_doc.get("employee_id"),
        request_doc.get("tenant_id") or current_tenant_id(),
    )

    notify_users(
        db,
        [employee_user],
        "Holiday Work Request Updated",
        f"Your holiday work request for {request_doc.get('date')} is {updated_doc.get('status')}.",
        {"request_id": str(request_obj_id), "status": updated_doc.get("status")},
        tenant_id=request_doc.get("tenant_id") or current_tenant_id(),
    )

    audit(status, "holiday_work_requests", request_id, {
        "decision_note": decision_note,
        "approval_stage": request_doc.get("approval_stage"),
    })

    return jsonify({
        "message": f"Request {updated_doc.get('status') if updated_doc else status}",
        "item": clean_doc(updated_doc),
    })


@attendance_bp.get("/team-field-attendance")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def team_field_attendance():
    db = get_db()
    roles = current_user_roles()

    q = manager_scope_query(db)
    q["mode"] = "field"
    q["is_deleted"] = {"$ne": True}

    start = normalize_text(
        request.args.get("start")
        or request.args.get("from")
        or request.args.get("date_from")
    )
    end = normalize_text(
        request.args.get("end")
        or request.args.get("to")
        or request.args.get("date_to")
    )

    if start or end:
        date_q = {}

        if start:
            date_q["$gte"] = start

        if end:
            date_q["$lte"] = end

        q["date"] = date_q

    else:
        # By default show recent field logs. Do not force only today's date,
        # because TL/RO may open the panel after employee already checked in earlier.
        pass

    try:
        limit = int(request.args.get("limit") or 100)
    except Exception:
        limit = 100

    limit = max(1, min(limit, 500))

    items = list(
        db.attendance_logs
        .find(q)
        .sort([("date", -1), ("check_in", -1), ("created_at", -1)])
        .limit(limit)
    )

    items = [enrich_field_attendance_log(db, row) for row in items]

    return jsonify({
        "items": clean_doc(items),
        "scope": "tenant" if roles.intersection(FULL_TENANT_REPORT_ROLES) else "mapped_team",
        "total": len(items),
    })


@attendance_bp.post("/mode-requests")
@current_user_required
def create_mode_request():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}

    mode = normalize_mode(data.get("mode"))
    request_date = parse_date(data.get("date"))
    reason = normalize_text(data.get("reason"))
    field_location = normalize_text(data.get("field_location"))
    tenant_id = e.get("tenant_id") or current_tenant_id()

    if mode not in ["wfh", "field"]:
        return jsonify({
            "message": "Request mode must be work from home or field"
        }), 400

    if not request_date:
        return jsonify({"message": "Request date is required"}), 400

    if request_date < today_local():
        return jsonify({"message": "Request date cannot be in the past"}), 400

    if not reason:
        return jsonify({"message": "Reason is required"}), 400

    if mode == "field" and not field_location:
        return jsonify({
            "message": "Field visit place is required for field request"
        }), 400

    existing = db.attendance_mode_requests.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "mode": mode,
        "date": request_date.isoformat(),
        "status": {"$in": ["pending", "approved"]},
        "is_deleted": {"$ne": True},
    })

    if existing:
        return jsonify({
            "message": "A pending or approved request already exists for this date and mode"
        }), 409

    approval_stage, approval_stage_label = first_approval_stage(e)
    now = datetime.utcnow()

    doc = {
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "employee_code": employee_code(e),
        "emp_code": e.get("emp_code", ""),
        "employee_name": employee_display_name(e),
        "department": e.get("department", ""),
        "designation": e.get("designation", ""),
        "team_leader_id": e.get("team_leader_id", ""),
        "team_leader_name": e.get("team_leader_name", ""),
        "reporting_officer_id": e.get("reporting_officer_id", ""),
        "reporting_officer_name": e.get("reporting_officer_name", ""),
        "mode": mode,
        "date": request_date.isoformat(),
        "reason": reason,
        "field_location": field_location,
        "status": "pending",
        "approval_stage": approval_stage,
        "approval_stage_label": approval_stage_label,
        "approval_history": [],
        "created_at": now,
        "updated_at": now,
        "created_by": str(g.current_user["_id"]),
    }

    res = db.attendance_mode_requests.insert_one(doc)
    doc["_id"] = res.inserted_id

    notify_users(
        db,
        approval_target_user_ids(db, e),
        "Attendance Mode Request",
        f"{employee_display_name(e)} requested {mode.upper()} attendance for {request_date.isoformat()}.",
        {
            "request_id": str(res.inserted_id),
            "employee_id": str(e["_id"]),
            "mode": mode,
            "date": request_date.isoformat(),
            "approval_stage": approval_stage,
        },
        tenant_id=tenant_id,
    )

    audit("create", "attendance_mode_requests", res.inserted_id, doc)

    return jsonify({
        "message": "Request submitted",
        "item": clean_doc(doc),
    }), 201


@attendance_bp.get("/mode-requests")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def list_mode_requests():
    db = get_db()
    roles = current_user_roles()

    q = {"tenant_id": current_tenant_id(), "is_deleted": {"$ne": True}}

    if "super_admin" in roles:
        tenant_arg = normalize_text(request.args.get("tenant_id"))

        if tenant_arg:
            q["tenant_id"] = tenant_arg
        else:
            q.pop("tenant_id", None)

    status = normalize_text(request.args.get("status"))
    mode = normalize_mode(request.args.get("mode"))
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))

    if status:
        q["status"] = status

    if mode:
        q["mode"] = mode

    if date_from or date_to:
        q["date"] = {}

        if date_from:
            q["date"]["$gte"] = date_from

        if date_to:
            q["date"]["$lte"] = date_to

    if not roles.intersection(FULL_TENANT_REPORT_ROLES):
        scoped_employee_ids = scoped_employee_ids_for_manager(db)

        if scoped_employee_ids is not None:
            q["employee_id"] = {"$in": scoped_employee_ids}

        reviewer = emp(db)

        if reviewer:
            reviewer_id = str(reviewer["_id"])
            reviewer_identifier_values = employee_identifier_values(reviewer)

            if reviewer_id not in reviewer_identifier_values:
                reviewer_identifier_values.append(reviewer_id)

            if "team_leader" in roles or employee_is_team_leader(reviewer):
                q.setdefault("$or", [])
                q["$or"].append({
                    "approval_stage": "team_leader",
                    "team_leader_id": {"$in": reviewer_identifier_values},
                })

            if "reporting_officer" in roles or "ro" in roles or employee_is_reporting_officer(reviewer):
                q.setdefault("$or", [])
                q["$or"].append({
                    "approval_stage": "reporting_officer",
                    "reporting_officer_id": {"$in": reviewer_identifier_values},
                })

    items = list(
        db.attendance_mode_requests
        .find(q)
        .sort("created_at", -1)
        .limit(500)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.get("/my-mode-requests")
@current_user_required
def my_mode_requests():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"items": []})

    employee_id = str(e["_id"])
    identifier_values = employee_identifier_values(e)

    if employee_id not in identifier_values:
        identifier_values.append(employee_id)

    items = list(
        db.attendance_mode_requests
        .find({
            "tenant_id": e.get("tenant_id") or current_tenant_id(),
            "employee_id": {"$in": identifier_values},
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(100)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.patch("/mode-requests/<request_id>/decision")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def decide_mode_request(request_id):
    request_obj_id = safe_object_id(request_id)

    if not request_obj_id:
        return jsonify({"message": "Invalid request id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    roles = current_user_roles()

    status = normalize_text(data.get("status")).lower()
    decision_note = normalize_text(data.get("decision_note") or data.get("note"))

    if status not in ["approved", "rejected"]:
        return jsonify({
            "message": "Status must be approved or rejected"
        }), 400

    q = {
        "_id": request_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    request_doc = db.attendance_mode_requests.find_one(q)

    if not request_doc:
        return jsonify({"message": "Request not found"}), 404

    if request_doc.get("status") != "pending":
        return jsonify({
            "message": "Only pending requests can be decided"
        }), 400

    if not can_decide_mode_request(db, request_doc):
        return jsonify({
            "message": "Request is not in your approval scope"
        }), 403

    now = datetime.utcnow()

    history_entry = {
        "stage": request_doc.get("approval_stage") or "",
        "stage_label": request_doc.get("approval_stage_label") or "",
        "status": status,
        "decision_note": decision_note,
        "decided_at": now,
        "decided_by": str(g.current_user["_id"]),
        "decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
    }

    set_data = {
        "decision_note": decision_note,
        "last_decided_at": now,
        "last_decided_by": str(g.current_user["_id"]),
        "last_decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
        "updated_at": now,
    }

    if status == "rejected":
        set_data.update({
            "status": "rejected",
            "approval_stage": "rejected",
            "approval_stage_label": "Rejected",
            "decided_at": now,
            "decided_by": str(g.current_user["_id"]),
            "decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
        })
    else:
        if request_doc.get("approval_stage") == "team_leader":
            next_stage, next_stage_label = next_approval_stage_after_team_leader(request_doc)

            if next_stage == "approved":
                set_data.update({
                    "status": "approved",
                    "approval_stage": "approved",
                    "approval_stage_label": "Approved",
                    "decided_at": now,
                    "decided_by": str(g.current_user["_id"]),
                    "decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
                })
            else:
                set_data.update({
                    "status": "pending",
                    "approval_stage": next_stage,
                    "approval_stage_label": next_stage_label,
                })

                reporting_user_id = employee_user_id(
                    db,
                    request_doc.get("reporting_officer_id"),
                    request_doc.get("tenant_id") or current_tenant_id(),
                )

                notify_users(
                    db,
                    [reporting_user_id],
                    "Attendance Mode Request",
                    f"{request_doc.get('employee_name', 'Employee')} request is pending for Reporting Officer approval.",
                    {
                        "request_id": str(request_obj_id),
                        "employee_id": request_doc.get("employee_id"),
                        "mode": request_doc.get("mode"),
                        "date": request_doc.get("date"),
                        "approval_stage": next_stage,
                    },
                    tenant_id=request_doc.get("tenant_id") or current_tenant_id(),
                )
        else:
            set_data.update({
                "status": "approved",
                "approval_stage": "approved",
                "approval_stage_label": "Approved",
                "decided_at": now,
                "decided_by": str(g.current_user["_id"]),
                "decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
            })

    db.attendance_mode_requests.update_one(
        {"_id": request_obj_id},
        {
            "$set": set_data,
            "$push": {
                "approval_history": history_entry,
            },
        },
    )

    updated_doc = db.attendance_mode_requests.find_one({"_id": request_obj_id})

    if updated_doc and updated_doc.get("status") in ["approved", "rejected"]:
        employee_user = employee_user_id(
            db,
            request_doc.get("employee_id"),
            request_doc.get("tenant_id") or current_tenant_id(),
        )

        notify_users(
            db,
            [employee_user],
            "Attendance Mode Request Updated",
            f"Your {request_doc.get('mode', '').upper()} request for {request_doc.get('date')} was {updated_doc.get('status')}.",
            {
                "request_id": str(request_obj_id),
                "status": updated_doc.get("status"),
            },
            tenant_id=request_doc.get("tenant_id") or current_tenant_id(),
        )

    audit(status, "attendance_mode_requests", request_id, {
        "decision_note": decision_note,
        "approval_stage": request_doc.get("approval_stage"),
    })

    return jsonify({
        "message": f"Request {updated_doc.get('status') if updated_doc else status}",
        "item": clean_doc(updated_doc),
    })


@attendance_bp.get("/compoffs")
@current_user_required
def my_compoffs():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"items": []})

    tenant_id = e.get("tenant_id") or current_tenant_id()
    expire_old_compoffs(db, tenant_id)

    items = list(
        db.compoff_credits
        .find({
            "tenant_id": tenant_id,
            "employee_id": str(e["_id"]),
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(100)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.post("/compoffs/<compoff_id>/claim")
@current_user_required
def claim_compoff(compoff_id):
    compoff_obj_id = safe_object_id(compoff_id)

    if not compoff_obj_id:
        return jsonify({"message": "Invalid comp-off id"}), 400

    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    tenant_id = e.get("tenant_id") or current_tenant_id()
    expire_old_compoffs(db, tenant_id)

    data = request.get_json(silent=True) or {}
    claim_date = parse_date(data.get("claim_date"))
    reason = normalize_text(data.get("reason"))

    if not claim_date:
        return jsonify({"message": "Claim date is required"}), 400

    if claim_date < today_local():
        return jsonify({"message": "Claim date cannot be in the past"}), 400

    compoff = db.compoff_credits.find_one({
        "_id": compoff_obj_id,
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "status": "available",
        "is_deleted": {"$ne": True},
    })

    if not compoff:
        return jsonify({
            "message": "Available comp-off not found"
        }), 404

    available_from = parse_date(compoff.get("available_from"))
    valid_until = parse_date(compoff.get("valid_until"))
    today = today_local()

    if available_from and today < available_from:
        return jsonify({
            "message": f"This comp-off can be claimed from {available_from.isoformat()}"
        }), 400

    if valid_until and today > valid_until:
        db.compoff_credits.update_one(
            {"_id": compoff_obj_id},
            {"$set": {"status": "expired", "updated_at": datetime.utcnow()}},
        )
        return jsonify({
            "message": "This comp-off has expired. It can be claimed within 7 working days only."
        }), 400

    if valid_until and claim_date > valid_until:
        return jsonify({
            "message": f"Claim date must be on or before {valid_until.isoformat()}"
        }), 400

    existing_leave = db.leave_requests.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "from_date": claim_date.isoformat(),
        "to_date": claim_date.isoformat(),
        "status": {"$in": ["pending", "approved"]},
        "is_deleted": {"$ne": True},
    })

    if existing_leave:
        return jsonify({
            "message": "A pending or approved leave already exists for this date"
        }), 409

    now = datetime.utcnow()
    approval_stage, approval_stage_label = first_approval_stage(e)

    leave_doc = {
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "employee_code": employee_code(e),
        "emp_code": e.get("emp_code", ""),
        "employee_name": employee_display_name(e),
        "department": e.get("department", ""),
        "designation": e.get("designation", ""),
        "team_leader_id": e.get("team_leader_id", ""),
        "team_leader_name": e.get("team_leader_name", ""),
        "reporting_officer_id": e.get("reporting_officer_id", ""),
        "reporting_officer_name": e.get("reporting_officer_name", ""),
        "leave_type": "COMP-OFF",
        "leave_type_label": "Comp-Off",
        "leave_days": 1.0,
        "from_date": claim_date.isoformat(),
        "to_date": claim_date.isoformat(),
        "upto_date": claim_date.isoformat(),
        "reason": reason or "Comp-off claim",
        "task_handover_to_id": "",
        "task_handover_to_name": "",
        "task_handover_employee_id": "",
        "project_handover_id": "",
        "project_handover_name": "",
        "status": "pending",
        "approval_stage": approval_stage,
        "approval_stage_label": approval_stage_label,
        "approval_history": [],
        "balance_deducted": False,
        "source": "compoff",
        "compoff_id": str(compoff_obj_id),
        "created_at": now,
        "updated_at": now,
        "created_by": str(g.current_user["_id"]),
    }

    leave_res = db.leave_requests.insert_one(leave_doc)

    db.compoff_credits.update_one(
        {"_id": compoff_obj_id},
        {
            "$set": {
                "status": "claimed",
                "claimed_date": claim_date.isoformat(),
                "leave_request_id": str(leave_res.inserted_id),
                "updated_at": now,
            }
        },
    )

    notify_users(
        db,
        approval_target_user_ids(db, e),
        "Comp-Off Claimed",
        f"{employee_display_name(e)} claimed comp-off for {claim_date.isoformat()}.",
        {
            "employee_id": str(e["_id"]),
            "compoff_id": str(compoff_obj_id),
            "leave_request_id": str(leave_res.inserted_id),
            "approval_stage": approval_stage,
        },
        tenant_id=tenant_id,
    )

    audit("claim", "compoff_credits", compoff_id, {
        "leave_request_id": str(leave_res.inserted_id),
        "claim_date": claim_date.isoformat(),
    })

    return jsonify({
        "message": "Comp-off claim submitted",
        "leave_request": clean_doc(
            db.leave_requests.find_one({"_id": leave_res.inserted_id})
        ),
    }), 201