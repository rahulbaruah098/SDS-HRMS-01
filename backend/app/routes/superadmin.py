from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime, time
from werkzeug.security import generate_password_hash

from app.extensions import get_db
from app.utils.auth import roles_required, audit
from app.utils.serializers import clean_doc


superadmin_bp = Blueprint("superadmin", __name__)

SUPPORTED_HOLIDAY_STATES = [
    "Assam(HO)",
    "Manipur",
    "Mizoram",
    "Arunachal Pradesh",
]

DEFAULT_DEPARTMENTS = [
    "HR & Admin",
    "Finance & Accounts",
    "Research & Development",
    "Operations",
    "MIS",
    "IT",
]

DEFAULT_DESIGNATIONS = [
    "Managing Director",
    "Director",
    "General Manager",
    "Manager",
    "Team Leader",
    "Reporting Officer",
    "Head of Technology",
    "IT Support Head",
    "IT Support Assistant",
    "Executive",
    "Associate",
    "Assistant",
    "Employee",
]

DEFAULT_STATES = [
    "Assam(HO)",
    "Manipur",
    "Mizoram",
    "Arunachal Pradesh",
]

DEFAULT_PROJECTS = [
    "SFAC",
    "NCDC",
    "NFDB",
    "NAFED",
    "NABARD",
    "TRLM FISHERY",
    "TRESP",
    "NEDFi CDAP",
]

DEFAULT_LEAVE_TYPES = [
    {
        "name": "Casual Leave",
        "code": "CL",
        "days_per_year": 12,
        "carry_forward": False,
    },
    {
        "name": "Earned Leave",
        "code": "EL",
        "days_per_year": 18,
        "carry_forward": True,
    },
    {
        "name": "Comp-Off",
        "code": "COMP-OFF",
        "days_per_year": 0,
        "carry_forward": False,
    },
    {
        "name": "Half Day",
        "code": "HALF-DAY",
        "days_per_year": 0,
        "carry_forward": False,
    },
    {
        "name": "Leave Without Pay",
        "code": "LWP",
        "days_per_year": 0,
        "carry_forward": False,
    },
]

ATTENDANCE_SETTINGS = [
    {
        "setting_group": "attendance",
        "setting_key": "office_start",
        "setting_value": "09:30",
        "description": "Normal office check-in time.",
    },
    {
        "setting_group": "attendance",
        "setting_key": "late_cutoff",
        "setting_value": "09:50",
        "description": "Check-in from this time onwards requires late reason.",
    },
    {
        "setting_group": "attendance",
        "setting_key": "office_end",
        "setting_value": "18:00",
        "description": "Normal office checkout time.",
    },
    {
        "setting_group": "attendance",
        "setting_key": "working_days",
        "setting_value": "Monday to Saturday except Sunday, second Saturday and fourth Saturday",
        "description": "Default working-day policy.",
    },
    {
        "setting_group": "attendance",
        "setting_key": "holiday_states",
        "setting_value": ",".join(SUPPORTED_HOLIDAY_STATES),
        "description": "Supported state-wise holiday calendar states.",
    },
]

EMPLOYEE_PROFILE_FIELDS = [
    "avatar",
    "profile_photo",
    "profile_picture",
    "photo",
    "image",
    "picture",
    "phone",
    "country",
    "joining_date",
    "date_of_birth",
    "blood_group",
    "gross_salary",
    "branch",
    "aadhar_no",
    "employee_uan_no",
    "employee_type",
    "skill_level",
    "are_parents_senior_citizen",
    "number_of_children",
    "payment_mode",
    "previous_designation",
    "previous_employment_tenure_end_date",
    "role",
    "designation",
    "department",
    "shift",
    "gender",
    "address",
    "religion",
    "marital_status",
    "speak_language",
    "pan_no",
    "disability_level",
    "employee_esic_ip",
    "employment_status",
    "father_name",
    "dependent_disability_level",
    "children_in_hostel",
    "previous_employer_name",
    "previous_employment_tenure_from_date",
    "employee_id",
    "emp_code",
    "job_type",
    "project",
    "state",
    "status",
    "salary",
    "is_team_leader",
    "is_reporting_officer",
    "is_it_support_head",
    "is_it_support_member",
    "team_leader_id",
    "team_leader_name",
    "reporting_officer_id",
    "reporting_officer_name",
]


def now():
    return datetime.utcnow()


def safe_object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def slugify(value):
    raw = "".join(
        ch.lower() if ch.isalnum() else "-"
        for ch in (value or "").strip()
    )
    raw = "-".join([part for part in raw.split("-") if part])
    return raw or "tenant"


def truthy(value):
    return str(value).strip().lower() in ["true", "yes", "1", "on"]


def bool_string(value):
    return "true" if truthy(value) else "false"


def normalize_text(value):
    return str(value or "").strip()


def normalize_email(value):
    return str(value or "").strip().lower()


def normalize_float(value, default=0):
    try:
        return float(value or default)
    except Exception:
        return float(default)

def parse_attendance_date(value):
    value = normalize_text(value)

    if not value:
        return None

    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        return None


def parse_attendance_time(value):
    value = normalize_text(value)

    if not value:
        return None

    supported_formats = [
        "%H:%M",
        "%H:%M:%S",
        "%I:%M %p",
        "%I:%M:%S %p",
    ]

    for fmt in supported_formats:
        try:
            return datetime.strptime(value, fmt).time().replace(second=0, microsecond=0)
        except Exception:
            pass

    return None


def combine_attendance_datetime(date_value, time_value):
    parsed_date = parse_attendance_date(date_value)
    parsed_time = parse_attendance_time(time_value)

    if not parsed_date or not parsed_time:
        return None

    return datetime.combine(parsed_date, parsed_time)


def attendance_time_label(value):
    if not isinstance(value, datetime):
        return ""

    return value.strftime("%I:%M %p").lstrip("0")


def attendance_date_label(value):
    if isinstance(value, datetime):
        return value.date().isoformat()

    return normalize_text(value)


def build_attendance_status(check_in_at=None, check_out_at=None):
    if not check_in_at:
        return "absent"

    late_cutoff = time(9, 50)
    office_end = time(18, 0)

    if check_in_at.time() >= late_cutoff:
        return "late"

    if check_out_at and check_out_at.time() < office_end:
        return "early_checkout"

    return "present"


def employee_identity_query_values(employee_doc):
    values = []

    for value in [
        employee_doc.get("_id"),
        str(employee_doc.get("_id")) if employee_doc.get("_id") else "",
        employee_doc.get("employee_id"),
        employee_doc.get("employee_code"),
        employee_doc.get("emp_code"),
        employee_doc.get("code"),
        employee_doc.get("user_id"),
        employee_doc.get("email"),
    ]:
        text_value = normalize_text(value)

        if text_value and text_value not in values:
            values.append(text_value)

        obj_id = safe_object_id(text_value)

        if obj_id and obj_id not in values:
            values.append(obj_id)

    return values


def superadmin_attendance_employee_payload(employee_doc):
    employee_doc = employee_doc or {}

    return {
        "_id": str(employee_doc.get("_id", "")),
        "tenant_id": employee_doc.get("tenant_id", ""),
        "name": employee_display_name(employee_doc),
        "employee_id": employee_code(employee_doc),
        "email": normalize_email(employee_doc.get("email")),
        "department": employee_doc.get("department", ""),
        "designation": employee_doc.get("designation", ""),
        "status": employee_doc.get("status", ""),
    }

def get_attendance_datetime(record_doc, key):
    record_doc = record_doc or {}

    value = record_doc.get(key)

    if isinstance(value, datetime):
        return value

    alias_value = record_doc.get(f"{key}_at")

    if isinstance(alias_value, datetime):
        return alias_value

    if isinstance(value, str):
        parsed = parse_attendance_time(value)

        record_date = parse_attendance_date(record_doc.get("date"))

        if parsed and record_date:
            return datetime.combine(record_date, parsed)

    return None


def parse_attendance_location_input(value):
    value = normalize_text(value)

    if not value:
        return ""

    parts = [part.strip() for part in value.split(",")]

    if len(parts) >= 2:
        try:
            latitude = float(parts[0])
            longitude = float(parts[1])

            return {
                "latitude": latitude,
                "longitude": longitude,
                "address": value,
            }
        except Exception:
            pass

    return value

def superadmin_attendance_record_payload(record_doc):
    if not record_doc:
        return None

    check_in = get_attendance_datetime(record_doc, "check_in")
    check_out = get_attendance_datetime(record_doc, "check_out")

    check_in_location = (
        record_doc.get("check_in_location")
        or record_doc.get("location")
        or record_doc.get("geo_location")
        or ""
    )

    check_out_location = (
        record_doc.get("check_out_location")
        or ""
    )

    return {
        "_id": str(record_doc.get("_id", "")),
        "tenant_id": record_doc.get("tenant_id", ""),
        "employee_ref_id": normalize_text(record_doc.get("employee_ref_id")),
        "employee_id": normalize_text(record_doc.get("employee_id")),
        "employee_name": normalize_text(record_doc.get("employee_name")),
        "date": attendance_date_label(record_doc.get("date")),
        "status": normalize_text(record_doc.get("status")),
        "mode": normalize_text(record_doc.get("mode") or record_doc.get("work_mode")),
        "check_in": attendance_time_label(check_in),
        "check_out": attendance_time_label(check_out),
        "check_in_at": check_in.isoformat() if isinstance(check_in, datetime) else "",
        "check_out_at": check_out.isoformat() if isinstance(check_out, datetime) else "",
        "check_in_location": check_in_location,
        "check_out_location": check_out_location,
        "late_reason": record_doc.get("late_reason") or "",
        "early_checkout_reason": record_doc.get("early_checkout_reason") or "",
        "remarks": record_doc.get("remarks") or "",
    }


def profile_photo_value(doc):
    doc = doc or {}

    return (
        normalize_text(doc.get("avatar"))
        or normalize_text(doc.get("profile_photo"))
        or normalize_text(doc.get("profile_picture"))
        or normalize_text(doc.get("photo"))
        or normalize_text(doc.get("image"))
        or normalize_text(doc.get("picture"))
        or ""
    )


def apply_profile_photo_aliases(payload, photo_value=None):
    photo = normalize_text(photo_value) or profile_photo_value(payload)

    if photo:
        payload["avatar"] = photo
        payload["profile_photo"] = photo
        payload["profile_picture"] = photo
        payload["photo"] = photo

    return payload


def merge_profile_photo_from_sources(primary=None, fallback=None):
    return profile_photo_value(primary) or profile_photo_value(fallback)


def normalize_role_value(value):
    role_key = normalize_text(value).lower().replace("-", "_").replace(" ", "_")

    role_map = {
        "super_admin": "super_admin",
        "admin": "admin",
        "hr": "hr",
        "hr_admin": "hr_admin",
        "hr_manager": "hr_manager",
        "finance": "finance",
        "accounts_finance": "accounts_finance",
        "manager": "manager",
        "ro": "ro",
        "team_leader": "team_leader",
        "reporting_officer": "reporting_officer",
        "employee": "employee",
    }

    return role_map.get(role_key, "employee")


def normalize_roles(value):
    if not value:
        return ["employee"]

    if isinstance(value, str):
        roles = [role.strip() for role in value.split(",") if role.strip()]
    elif isinstance(value, list):
        roles = [str(role).strip() for role in value if str(role).strip()]
    else:
        roles = ["employee"]

    cleaned_roles = []

    for role in roles:
        normalized = normalize_role_value(role)

        if normalized in ["team_leader", "reporting_officer", "manager", "ro"]:
            normalized = "employee"

        if normalized not in cleaned_roles:
            cleaned_roles.append(normalized)

    return cleaned_roles or ["employee"]


def normalize_state(value):
    state = normalize_text(value)

    if not state:
        return "Assam(HO)"

    lowered = state.lower()

    if lowered in ["assam", "assam ho", "assam(ho)", "ho", "assam/guwahati (ho)"]:
        return "Assam(HO)"

    for allowed in SUPPORTED_HOLIDAY_STATES:
        if lowered == allowed.lower():
            return allowed

    return state


def resolve_employee_name(db, tenant_id, emp_id):
    if not emp_id:
        return ""

    emp_obj_id = safe_object_id(emp_id)

    if not emp_obj_id:
        return ""

    emp = db.employees.find_one({
        "_id": emp_obj_id,
        "tenant_id": tenant_id,
        "status": {"$ne": "Inactive"},
        "is_deleted": {"$ne": True},
    })

    return emp.get("name", "") if emp else ""


def build_dynamic_employee_roles(employee_doc, current_user_roles=None):
    current_user_roles = set(current_user_roles or [])

    protected_roles = {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "finance",
        "accounts_finance",
    }

    capability_roles = {
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
    }

    roles = set(current_user_roles)

    if not roles.intersection(protected_roles):
        roles.difference_update(capability_roles)
        roles.add("employee")

    if truthy(employee_doc.get("is_team_leader")):
        roles.add("team_leader")
    else:
        roles.discard("team_leader")

    if truthy(employee_doc.get("is_reporting_officer")):
        roles.add("reporting_officer")
    else:
        roles.discard("reporting_officer")
        roles.discard("manager")
        roles.discard("ro")

    if not roles:
        roles.add("employee")

    return sorted(list(roles))


def employee_display_name(employee_doc):
    return (
        normalize_text(employee_doc.get("name"))
        or normalize_text(employee_doc.get("employee_name"))
        or normalize_text(employee_doc.get("full_name"))
        or normalize_email(employee_doc.get("email"))
        or "Employee"
    )


def employee_code(employee_doc):
    return (
        normalize_text(employee_doc.get("employee_id"))
        or normalize_text(employee_doc.get("emp_code"))
        or normalize_text(employee_doc.get("code"))
        or ""
    )


def employee_status_is_active(employee_doc):
    status = normalize_text(employee_doc.get("status") or "active").lower()

    return not (
        status in {"inactive", "disabled", "deleted", "terminated"}
        or truthy(employee_doc.get("is_deleted"))
    )


def user_profile_payload_from_employee(employee_doc, existing_user=None):
    existing_user = existing_user or {}
    name = employee_display_name(employee_doc)
    email = normalize_email(employee_doc.get("email"))
    is_active = employee_status_is_active(employee_doc)
    roles = build_dynamic_employee_roles(employee_doc, existing_user.get("roles", []))
    photo = merge_profile_photo_from_sources(employee_doc, existing_user)

    payload = {
        "tenant_id": employee_doc.get("tenant_id") or existing_user.get("tenant_id") or "sds",
        "name": name,
        "full_name": name,
        "email": email,
        "username": email,
        "role": "employee",
        "roles": roles,
        "employee_id": str(employee_doc.get("_id")) if employee_doc.get("_id") else "",
        "employee_ref_id": str(employee_doc.get("_id")) if employee_doc.get("_id") else "",
        "emp_code": employee_code(employee_doc),
        "department": employee_doc.get("department", ""),
        "designation": employee_doc.get("designation", ""),
        "is_team_leader": bool_string(employee_doc.get("is_team_leader")),
        "is_reporting_officer": bool_string(employee_doc.get("is_reporting_officer")),
        "is_it_support_head": bool_string(employee_doc.get("is_it_support_head")),
        "is_it_support_member": bool_string(employee_doc.get("is_it_support_member")),
        "is_active": is_active,
        "status": "active" if is_active else "inactive",
        "updated_at": now(),
    }

    apply_profile_photo_aliases(payload, photo)

    if employee_doc.get("department_id"):
        payload["department_id"] = employee_doc.get("department_id")

    if employee_doc.get("designation_id"):
        payload["designation_id"] = employee_doc.get("designation_id")

    return payload


def find_user_for_employee(db, employee_doc):
    user_id = normalize_text(employee_doc.get("user_id"))
    user_obj_id = safe_object_id(user_id)

    if user_obj_id:
        user = db.users.find_one({"_id": user_obj_id})

        if user:
            return user

    email = normalize_email(employee_doc.get("email"))

    if not email:
        return None

    tenant_id = employee_doc.get("tenant_id") or "sds"

    user = db.users.find_one({
        "email": email,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    })

    if user:
        return user

    return db.users.find_one({
        "email": email,
        "is_deleted": {"$ne": True},
    })


def ensure_user_for_employee(db, employee_doc, default_password="User@123"):
    email = normalize_email(employee_doc.get("email"))

    if not email:
        return None

    apply_profile_photo_aliases(employee_doc)

    existing_user = find_user_for_employee(db, employee_doc)

    if existing_user:
        photo = merge_profile_photo_from_sources(employee_doc, existing_user)
        apply_profile_photo_aliases(employee_doc, photo)

        payload = user_profile_payload_from_employee(employee_doc, existing_user)
        payload["updated_by_name"] = "Super Admin User Control Sync"

        db.users.update_one(
            {"_id": existing_user["_id"]},
            {"$set": payload},
        )

        employee_update = {
            "user_id": str(existing_user["_id"]),
            "name": employee_display_name(employee_doc),
            "employee_name": employee_display_name(employee_doc),
            "email": email,
            "updated_at": now(),
        }
        apply_profile_photo_aliases(employee_update, photo)

        db.employees.update_one(
            {"_id": employee_doc["_id"]},
            {"$set": employee_update},
        )

        return db.users.find_one({"_id": existing_user["_id"]})

    user_payload = user_profile_payload_from_employee(employee_doc)
    user_payload.update({
        "password_hash": generate_password_hash(default_password),
        "created_at": now(),
        "created_by_name": "Super Admin User Control Sync",
        "updated_by_name": "Super Admin User Control Sync",
        "is_deleted": False,
    })

    user_res = db.users.insert_one(user_payload)

    employee_update = {
        "user_id": str(user_res.inserted_id),
        "name": employee_display_name(employee_doc),
        "employee_name": employee_display_name(employee_doc),
        "email": email,
        "updated_at": now(),
    }
    apply_profile_photo_aliases(employee_update, profile_photo_value(user_payload))

    db.employees.update_one(
        {"_id": employee_doc["_id"]},
        {"$set": employee_update},
    )

    return db.users.find_one({"_id": user_res.inserted_id})


def sync_employee_roles(db, employee_doc):
    user = find_user_for_employee(db, employee_doc)

    if not user:
        return

    photo = merge_profile_photo_from_sources(employee_doc, user)
    apply_profile_photo_aliases(employee_doc, photo)

    payload = user_profile_payload_from_employee(employee_doc, user)
    apply_profile_photo_aliases(payload, photo)

    db.users.update_one(
        {"_id": user["_id"]},
        {"$set": payload},
    )

    employee_update = {
        "updated_at": now(),
    }
    apply_profile_photo_aliases(employee_update, photo)

    if normalize_text(employee_doc.get("user_id")) != str(user["_id"]):
        employee_update["user_id"] = str(user["_id"])

    db.employees.update_one(
        {"_id": employee_doc["_id"]},
        {"$set": employee_update},
    )


def build_employee_profile_payload(data):
    payload = {}

    for key in EMPLOYEE_PROFILE_FIELDS:
        if key in data:
            payload[key] = data.get(key)

    payload["phone"] = normalize_text(payload.get("phone"))
    payload["employee_id"] = normalize_text(payload.get("employee_id"))
    payload["emp_code"] = normalize_text(payload.get("emp_code"))
    payload["department"] = normalize_text(payload.get("department"))
    payload["designation"] = normalize_text(payload.get("designation"))
    payload["branch"] = normalize_text(payload.get("branch"))
    payload["state"] = normalize_state(payload.get("state") or payload.get("branch"))
    payload["status"] = payload.get("status") or "Active"

    apply_profile_photo_aliases(payload)

    payload["role"] = "Employee"
    payload["is_team_leader"] = bool_string(payload.get("is_team_leader", "false"))
    payload["is_reporting_officer"] = bool_string(payload.get("is_reporting_officer", "false"))
    payload["is_it_support_head"] = bool_string(payload.get("is_it_support_head", "false"))
    payload["is_it_support_member"] = bool_string(payload.get("is_it_support_member", "false"))

    if truthy(payload.get("is_it_support_head")):
        payload["is_it_support_member"] = "true"

    if "salary" in payload:
        payload["salary"] = normalize_float(payload.get("salary"), 0)

    if "gross_salary" in payload:
        payload["gross_salary"] = normalize_text(str(payload.get("gross_salary") or ""))

    return payload


def ensure_leave_balance_for_employee(db, tenant_id, employee, leave_type, total_days):
    leave_type = normalize_text(leave_type).upper()
    employee_id = str(employee["_id"])

    label_map = {
        "CL": "Casual Leave",
        "EL": "Earned Leave",
        "COMP-OFF": "Comp-Off",
        "HALF-DAY": "Half Day",
        "LWP": "Leave Without Pay",
    }

    existing = db.leave_balances.find_one({
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "leave_type": leave_type,
        "is_deleted": {"$ne": True},
    })

    if existing:
        return existing

    doc = {
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "employee_name": employee.get("name", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "leave_type": leave_type,
        "leave_type_label": label_map.get(leave_type, leave_type),
        "opening_balance": float(total_days or 0),
        "credited": float(total_days or 0),
        "used": 0.0,
        "available": float(total_days or 0),
        "status": "active",
        "created_at": now(),
        "updated_at": now(),
        "created_by": str(g.current_user["_id"]),
        "is_deleted": False,
    }

    res = db.leave_balances.insert_one(doc)
    doc["_id"] = res.inserted_id

    return doc


def seed_default_leave_balances_for_employee(db, tenant_id, employee):
    ensure_leave_balance_for_employee(db, tenant_id, employee, "CL", 0)
    ensure_leave_balance_for_employee(db, tenant_id, employee, "EL", 0)


def seed_company_masters(db, tenant_id):
    for name in DEFAULT_DEPARTMENTS:
        db.departments.update_one(
            {"tenant_id": tenant_id, "name": name},
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    "name": name,
                    "status": "active",
                    "created_at": now(),
                    "is_deleted": False,
                }
            },
            upsert=True,
        )

    for title in DEFAULT_DESIGNATIONS:
        db.designations.update_one(
            {"tenant_id": tenant_id, "title": title},
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    "title": title,
                    "status": "active",
                    "created_at": now(),
                    "is_deleted": False,
                }
            },
            upsert=True,
        )

    for name in DEFAULT_STATES:
        db.states.update_one(
            {"tenant_id": tenant_id, "name": name},
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    "name": name,
                    "status": "active",
                    "created_at": now(),
                    "is_deleted": False,
                }
            },
            upsert=True,
        )

    for name in DEFAULT_PROJECTS:
        db.projects.update_one(
            {"tenant_id": tenant_id, "name": name},
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    "name": name,
                    "project_name": name,
                    "title": name,
                    "status": "active",
                    "created_at": now(),
                    "is_deleted": False,
                }
            },
            upsert=True,
        )

    for leave_type in DEFAULT_LEAVE_TYPES:
        db.leave_types.update_one(
            {
                "tenant_id": tenant_id,
                "$or": [
                    {"name": leave_type["name"]},
                    {"code": leave_type["code"]},
                ],
            },
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    "name": leave_type["name"],
                    "code": leave_type["code"],
                    "days_per_year": leave_type["days_per_year"],
                    "carry_forward": leave_type["carry_forward"],
                    "status": "active",
                    "created_at": now(),
                    "is_deleted": False,
                }
            },
            upsert=True,
        )

    for setting in ATTENDANCE_SETTINGS:
        db.system_settings.update_one(
            {
                "tenant_id": tenant_id,
                "setting_group": setting["setting_group"],
                "setting_key": setting["setting_key"],
            },
            {
                "$setOnInsert": {
                    "tenant_id": tenant_id,
                    **setting,
                    "created_at": now(),
                    "is_deleted": False,
                }
            },
            upsert=True,
        )


@superadmin_bp.get("/companies")
@roles_required("super_admin")
def list_companies():
    db = get_db()
    q = {}

    search = normalize_text(request.args.get("q"))

    if search:
        q = {
            "$or": [
                {"name": {"$regex": search, "$options": "i"}},
                {"tenant_id": {"$regex": search, "$options": "i"}},
                {"domain": {"$regex": search, "$options": "i"}},
            ]
        }

    rows = list(db.tenants.find(q).sort("created_at", -1).limit(500))

    today = datetime.utcnow().date().isoformat()

    for row in rows:
        tenant_id = row.get("tenant_id")

        row["employee_count"] = db.employees.count_documents({
            "tenant_id": tenant_id,
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
        })
        row["user_count"] = db.users.count_documents({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        row["present_today"] = db.attendance_logs.count_documents({
            "tenant_id": tenant_id,
            "date": today,
            "status": {"$in": ["present", "late", "early_checkout", "holiday_work"]},
        })
        row["late_today"] = db.attendance_logs.count_documents({
            "tenant_id": tenant_id,
            "date": today,
            "status": "late",
        })
        row["pending_wfh_field"] = db.attendance_mode_requests.count_documents({
            "tenant_id": tenant_id,
            "status": "pending",
        })
        row["pending_leaves"] = db.leave_requests.count_documents({
            "tenant_id": tenant_id,
            "status": "pending",
        })
        row["pending_grievances"] = db.grievances.count_documents({
            "tenant_id": tenant_id,
            "status": {"$in": ["pending", "under_review"]},
        })
        row["pending_it_support"] = db.it_support_tickets.count_documents({
            "tenant_id": tenant_id,
            "status": {"$in": ["open", "assigned", "in_progress", "waiting_for_user", "reopened"]},
        })
        row["available_compoff"] = db.compoff_credits.count_documents({
            "tenant_id": tenant_id,
            "status": "available",
        })

    return jsonify({"items": clean_doc(rows)})


@superadmin_bp.post("/companies")
@roles_required("super_admin")
def create_company():
    db = get_db()
    data = request.get_json(silent=True) or {}

    name = normalize_text(data.get("name"))

    if not name:
        return jsonify({"message": "Company name is required"}), 400

    tenant_id = normalize_text(data.get("tenant_id") or slugify(name)).lower()

    if db.tenants.find_one({"tenant_id": tenant_id}):
        return jsonify({"message": "Company / tenant_id already exists"}), 409

    doc = {
        "tenant_id": tenant_id,
        "name": name,
        "domain": normalize_text(data.get("domain")),
        "contact_email": normalize_email(data.get("contact_email")),
        "contact_phone": normalize_text(data.get("contact_phone")),
        "address": data.get("address", ""),
        "status": "active",
        "plan": data.get("plan", "Internal / Trial"),
        "created_at": now(),
        "created_by": str(g.current_user["_id"]),
        "is_deleted": False,
    }

    db.tenants.insert_one(doc)
    seed_company_masters(db, tenant_id)

    admin_email = normalize_email(data.get("admin_email"))
    admin_password = data.get("admin_password") or "Admin@123"
    admin_name = normalize_text(data.get("admin_name") or f"{name} Admin")
    admin_photo = profile_photo_value(data)

    if admin_email:
        if db.users.find_one({"email": admin_email, "is_deleted": {"$ne": True}}):
            return jsonify({
                "message": "Company created, but admin email already exists. Use User Control to assign a user.",
                "item": clean_doc(db.tenants.find_one({"tenant_id": tenant_id})),
            }), 201

        user_payload = {
            "tenant_id": tenant_id,
            "name": admin_name,
            "full_name": admin_name,
            "email": admin_email,
            "username": admin_email,
            "password_hash": generate_password_hash(admin_password),
            "role": "admin",
            "roles": ["admin", "hr_manager"],
            "is_active": True,
            "status": "active",
            "is_deleted": False,
            "created_at": now(),
            "created_by": str(g.current_user["_id"]),
        }
        apply_profile_photo_aliases(user_payload, admin_photo)

        user_res = db.users.insert_one(user_payload)

        emp_doc = {
            "tenant_id": tenant_id,
            "user_id": str(user_res.inserted_id),
            "emp_code": f"{tenant_id.upper()}-ADMIN",
            "employee_id": f"{tenant_id.upper()}-ADMIN",
            "name": admin_name,
            "employee_name": admin_name,
            "email": admin_email,
            "phone": "",
            "country": "India",
            "joining_date": "",
            "date_of_birth": "",
            "blood_group": "",
            "gross_salary": "",
            "branch": "Assam(HO)",
            "department": "HR & Admin",
            "designation": "Manager",
            "role": "Employee",
            "shift": "General",
            "gender": "",
            "job_type": "Regular",
            "project": "Administration",
            "state": "Assam(HO)",
            "status": "Active",
            "salary": 0,
            "is_team_leader": "false",
            "is_reporting_officer": "true",
            "is_it_support_head": "false",
            "is_it_support_member": "false",
            "team_leader_id": "",
            "team_leader_name": "",
            "reporting_officer_id": "",
            "reporting_officer_name": "",
            "created_at": now(),
            "updated_at": now(),
            "created_by": str(g.current_user["_id"]),
            "is_deleted": False,
        }
        apply_profile_photo_aliases(emp_doc, admin_photo)

        emp_res = db.employees.insert_one(emp_doc)
        created_emp = db.employees.find_one({"_id": emp_res.inserted_id})

        if created_emp:
            user_update = {
                "employee_id": str(created_emp["_id"]),
                "employee_ref_id": str(created_emp["_id"]),
                "emp_code": created_emp.get("emp_code", ""),
                "department": created_emp.get("department", ""),
                "designation": created_emp.get("designation", ""),
                "is_it_support_head": created_emp.get("is_it_support_head", "false"),
                "is_it_support_member": created_emp.get("is_it_support_member", "false"),
                "updated_at": now(),
            }
            apply_profile_photo_aliases(user_update, profile_photo_value(created_emp))

            db.users.update_one(
                {"_id": user_res.inserted_id},
                {"$set": user_update},
            )
            sync_employee_roles(db, created_emp)
            seed_default_leave_balances_for_employee(db, tenant_id, created_emp)

    audit("create_company", "tenants", tenant_id, doc)

    return jsonify({
        "message": "Company created",
        "item": clean_doc(db.tenants.find_one({"tenant_id": tenant_id})),
    }), 201


@superadmin_bp.patch("/companies/<tenant_id>")
@roles_required("super_admin")
def update_company(tenant_id):
    db = get_db()
    data = request.get_json(silent=True) or {}

    data.pop("_id", None)
    data.pop("tenant_id", None)

    existing = db.tenants.find_one({"tenant_id": tenant_id})

    if not existing:
        return jsonify({"message": "Company not found"}), 404

    data["updated_at"] = now()
    data["updated_by"] = str(g.current_user["_id"])

    db.tenants.update_one({"tenant_id": tenant_id}, {"$set": data})

    audit("update_company", "tenants", tenant_id, data)

    return jsonify({
        "message": "Company updated",
        "item": clean_doc(db.tenants.find_one({"tenant_id": tenant_id})),
    })


@superadmin_bp.get("/users")
@roles_required("super_admin")
def list_users():
    db = get_db()
    q = {
        "is_deleted": {"$ne": True},
    }

    tenant_id = normalize_text(request.args.get("tenant_id"))
    search = normalize_text(request.args.get("q"))

    if tenant_id:
        q["tenant_id"] = tenant_id

    employee_repair_query = {
        "is_deleted": {"$ne": True},
        "email": {"$exists": True, "$nin": ["", None]},
        "$or": [
            {"user_id": {"$exists": False}},
            {"user_id": ""},
            {"user_id": None},
        ],
    }

    if tenant_id:
        employee_repair_query["tenant_id"] = tenant_id

    if search:
        employee_repair_query["$and"] = [
            {
                "$or": [
                    {"name": {"$regex": search, "$options": "i"}},
                    {"employee_name": {"$regex": search, "$options": "i"}},
                    {"email": {"$regex": search, "$options": "i"}},
                    {"employee_id": {"$regex": search, "$options": "i"}},
                    {"emp_code": {"$regex": search, "$options": "i"}},
                    {"department": {"$regex": search, "$options": "i"}},
                    {"designation": {"$regex": search, "$options": "i"}},
                ]
            }
        ]

    orphan_employees = list(db.employees.find(employee_repair_query).limit(500))

    for emp in orphan_employees:
        ensure_user_for_employee(db, emp)

    if search:
        q["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"full_name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"username": {"$regex": search, "$options": "i"}},
            {"tenant_id": {"$regex": search, "$options": "i"}},
            {"emp_code": {"$regex": search, "$options": "i"}},
            {"department": {"$regex": search, "$options": "i"}},
            {"designation": {"$regex": search, "$options": "i"}},
        ]

    rows = list(db.users.find(q).sort("created_at", -1).limit(1000))

    for user in rows:
        emp = db.employees.find_one({
            "user_id": str(user["_id"]),
            "is_deleted": {"$ne": True},
        })

        if not emp and user.get("employee_ref_id"):
            emp_obj_id = safe_object_id(user.get("employee_ref_id"))

            if emp_obj_id:
                emp = db.employees.find_one({
                    "_id": emp_obj_id,
                    "is_deleted": {"$ne": True},
                })

        if not emp and user.get("email"):
            emp = db.employees.find_one({
                "email": normalize_email(user.get("email")),
                "tenant_id": user.get("tenant_id"),
                "is_deleted": {"$ne": True},
            })

        if emp:
            photo = merge_profile_photo_from_sources(emp, user)

            if normalize_text(emp.get("user_id")) != str(user["_id"]):
                employee_update = {
                    "user_id": str(user["_id"]),
                    "updated_at": now(),
                }
                apply_profile_photo_aliases(employee_update, photo)

                db.employees.update_one(
                    {"_id": emp["_id"]},
                    {"$set": employee_update},
                )
                emp["user_id"] = str(user["_id"])

            if photo:
                apply_profile_photo_aliases(emp, photo)
                apply_profile_photo_aliases(user, photo)

                db.employees.update_one(
                    {"_id": emp["_id"]},
                    {"$set": {
                        "avatar": photo,
                        "profile_photo": photo,
                        "profile_picture": photo,
                        "photo": photo,
                        "updated_at": now(),
                    }},
                )
                db.users.update_one(
                    {"_id": user["_id"]},
                    {"$set": {
                        "avatar": photo,
                        "profile_photo": photo,
                        "profile_picture": photo,
                        "photo": photo,
                        "updated_at": now(),
                    }},
                )

            user["employee_profile"] = emp
            user["employee_ref_id"] = str(emp["_id"])
            user["employee_id"] = str(emp["_id"])
            user["emp_code"] = employee_code(emp)
            user["department"] = emp.get("department", user.get("department", ""))
            user["designation"] = emp.get("designation", user.get("designation", ""))
            user["is_it_support_head"] = bool_string(emp.get("is_it_support_head"))
            user["is_it_support_member"] = bool_string(emp.get("is_it_support_member"))
            user["avatar"] = photo
            user["profile_photo"] = photo
            user["profile_picture"] = photo
            user["photo"] = photo
        else:
            photo = profile_photo_value(user)
            user["avatar"] = photo
            user["profile_photo"] = photo
            user["profile_picture"] = photo
            user["photo"] = photo

    return jsonify({"items": clean_doc(rows)})


@superadmin_bp.post("/users")
@roles_required("super_admin")
def create_user():
    db = get_db()
    data = request.get_json(silent=True) or {}

    tenant_id = normalize_text(data.get("tenant_id") or "sds").lower()

    if not db.tenants.find_one({"tenant_id": tenant_id}):
        return jsonify({"message": "Invalid tenant_id / company"}), 400

    seed_company_masters(db, tenant_id)

    email = normalize_email(data.get("email"))
    password = data.get("password") or "User@123"
    name = normalize_text(data.get("name"))
    photo = profile_photo_value(data)

    if not email or not name:
        return jsonify({"message": "Name and email are required"}), 400

    if len(password) < 6:
        return jsonify({"message": "Password must be at least 6 characters"}), 400

    if db.users.find_one({"email": email, "is_deleted": {"$ne": True}}):
        return jsonify({"message": "Email already exists"}), 409

    employee_id = normalize_text(data.get("employee_id"))
    emp_code = normalize_text(data.get("emp_code"))

    if employee_id:
        existing_employee_id = db.employees.find_one({
            "tenant_id": tenant_id,
            "employee_id": employee_id,
            "is_deleted": {"$ne": True},
        })

        if existing_employee_id:
            return jsonify({"message": "Employee ID already exists in this tenant"}), 409

    if emp_code:
        existing_emp_code = db.employees.find_one({
            "tenant_id": tenant_id,
            "emp_code": emp_code,
            "is_deleted": {"$ne": True},
        })

        if existing_emp_code:
            return jsonify({"message": "Employee code already exists in this tenant"}), 409

    team_leader_id = data.get("team_leader_id") or ""
    reporting_officer_id = data.get("reporting_officer_id") or ""

    roles = normalize_roles(data.get("roles") or ["employee"])
    is_active = truthy(data.get("is_active", True))

    user_payload = {
        "tenant_id": tenant_id,
        "name": name,
        "full_name": name,
        "email": email,
        "username": email,
        "password_hash": generate_password_hash(password),
        "role": "employee",
        "roles": roles,
        "is_active": is_active,
        "status": "active" if is_active else "inactive",
        "is_deleted": False,
        "created_at": now(),
        "updated_at": now(),
        "created_by": str(g.current_user["_id"]),
    }
    apply_profile_photo_aliases(user_payload, photo)

    user_res = db.users.insert_one(user_payload)

    emp = build_employee_profile_payload(data)
    emp.update({
        "tenant_id": tenant_id,
        "user_id": str(user_res.inserted_id),
        "name": name,
        "employee_name": name,
        "email": email,
        "employee_id": employee_id,
        "emp_code": emp_code,
        "team_leader_id": team_leader_id,
        "team_leader_name": resolve_employee_name(db, tenant_id, team_leader_id),
        "reporting_officer_id": reporting_officer_id,
        "reporting_officer_name": resolve_employee_name(db, tenant_id, reporting_officer_id),
        "created_at": now(),
        "updated_at": now(),
        "created_by": str(g.current_user["_id"]),
        "is_deleted": False,
    })
    apply_profile_photo_aliases(emp, photo)

    emp.setdefault("country", "India")
    emp.setdefault("branch", "Assam(HO)")
    emp.setdefault("state", normalize_state(emp.get("state") or emp.get("branch")))
    emp.setdefault("role", "Employee")
    emp.setdefault("shift", "General")
    emp.setdefault("status", "Active")
    emp.setdefault("is_team_leader", "false")
    emp.setdefault("is_reporting_officer", "false")
    emp.setdefault("is_it_support_head", "false")
    emp.setdefault("is_it_support_member", "false")

    if truthy(emp.get("is_it_support_head")):
        emp["is_it_support_member"] = "true"

    emp_res = db.employees.insert_one(emp)
    created_emp = db.employees.find_one({"_id": emp_res.inserted_id})

    if created_emp:
        user_update = {
            "employee_id": str(created_emp["_id"]),
            "employee_ref_id": str(created_emp["_id"]),
            "emp_code": employee_code(created_emp),
            "department": created_emp.get("department", ""),
            "designation": created_emp.get("designation", ""),
            "is_it_support_head": bool_string(created_emp.get("is_it_support_head")),
            "is_it_support_member": bool_string(created_emp.get("is_it_support_member")),
            "updated_at": now(),
        }
        apply_profile_photo_aliases(user_update, profile_photo_value(created_emp))

        db.users.update_one(
            {"_id": user_res.inserted_id},
            {"$set": user_update},
        )
        sync_employee_roles(db, created_emp)
        seed_default_leave_balances_for_employee(db, tenant_id, created_emp)

    audit("create_user", "users", user_res.inserted_id, {
        "email": email,
        "roles": roles,
        "tenant_id": tenant_id,
    })

    created_user = db.users.find_one({"_id": user_res.inserted_id})
    created_user["employee_profile"] = created_emp
    photo = merge_profile_photo_from_sources(created_emp, created_user)
    apply_profile_photo_aliases(created_user, photo)

    return jsonify({
        "message": "User and employee profile created",
        "item": clean_doc(created_user),
    }), 201


@superadmin_bp.patch("/users/<user_id>")
@roles_required("super_admin")
def update_user(user_id):
    db = get_db()
    data = request.get_json(silent=True) or {}

    user_obj_id = safe_object_id(user_id)

    if not user_obj_id:
        return jsonify({"message": "Invalid user id"}), 400

    existing_user = db.users.find_one({"_id": user_obj_id})

    if not existing_user:
        return jsonify({"message": "User not found"}), 404

    user_update = {}
    incoming_photo = profile_photo_value(data)

    if incoming_photo:
        apply_profile_photo_aliases(user_update, incoming_photo)

    if "name" in data:
        name = normalize_text(data.get("name"))

        if not name:
            return jsonify({"message": "Name is required"}), 400

        user_update["name"] = name
        user_update["full_name"] = name

    if "email" in data:
        email = normalize_email(data.get("email"))

        if not email:
            return jsonify({"message": "Email is required"}), 400

        duplicate = db.users.find_one({
            "email": email,
            "_id": {"$ne": user_obj_id},
            "is_deleted": {"$ne": True},
        })

        if duplicate:
            return jsonify({"message": "Email already exists for another user"}), 409

        user_update["email"] = email
        user_update["username"] = email

    if "tenant_id" in data:
        tenant_id = normalize_text(data.get("tenant_id")).lower()

        if not tenant_id:
            return jsonify({"message": "tenant_id is required"}), 400

        if not db.tenants.find_one({"tenant_id": tenant_id}):
            return jsonify({"message": "Invalid tenant_id / company"}), 400

        user_update["tenant_id"] = tenant_id
        seed_company_masters(db, tenant_id)

    if "is_active" in data:
        is_active = truthy(data.get("is_active"))
        user_update["is_active"] = is_active
        user_update["status"] = "active" if is_active else "inactive"

    if "roles" in data:
        user_update["roles"] = normalize_roles(data.get("roles"))

    if data.get("password"):
        password = data.get("password")

        if len(password) < 6:
            return jsonify({"message": "Password must be at least 6 characters"}), 400

        user_update["password_hash"] = generate_password_hash(password)

    if user_update:
        user_update["updated_at"] = now()
        user_update["updated_by"] = str(g.current_user["_id"])

        db.users.update_one({"_id": user_obj_id}, {"$set": user_update})

    updated_user = db.users.find_one({"_id": user_obj_id})
    tenant_for_lookup = (
        updated_user.get("tenant_id")
        or existing_user.get("tenant_id")
        or "sds"
    )

    existing_emp = db.employees.find_one({
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    emp_update = build_employee_profile_payload(data)

    if incoming_photo:
        apply_profile_photo_aliases(emp_update, incoming_photo)

    if "name" in user_update:
        emp_update["name"] = user_update["name"]
        emp_update["employee_name"] = user_update["name"]

    if "email" in user_update:
        emp_update["email"] = user_update["email"]

    if "tenant_id" in user_update:
        emp_update["tenant_id"] = user_update["tenant_id"]

    if emp_update.get("employee_id"):
        duplicate_query = {
            "tenant_id": tenant_for_lookup,
            "employee_id": emp_update.get("employee_id"),
            "is_deleted": {"$ne": True},
        }

        if existing_emp:
            duplicate_query["_id"] = {"$ne": existing_emp["_id"]}

        duplicate_employee_id = db.employees.find_one(duplicate_query)

        if duplicate_employee_id:
            return jsonify({"message": "Employee ID already exists in this tenant"}), 409

    if emp_update.get("emp_code"):
        duplicate_query = {
            "tenant_id": tenant_for_lookup,
            "emp_code": emp_update.get("emp_code"),
            "is_deleted": {"$ne": True},
        }

        if existing_emp:
            duplicate_query["_id"] = {"$ne": existing_emp["_id"]}

        duplicate_emp_code = db.employees.find_one(duplicate_query)

        if duplicate_emp_code:
            return jsonify({"message": "Employee code already exists in this tenant"}), 409

    if "team_leader_id" in emp_update:
        emp_update["team_leader_name"] = resolve_employee_name(
            db,
            tenant_for_lookup,
            emp_update.get("team_leader_id"),
        )

    if "reporting_officer_id" in emp_update:
        emp_update["reporting_officer_name"] = resolve_employee_name(
            db,
            tenant_for_lookup,
            emp_update.get("reporting_officer_id"),
        )

    updated_emp = None

    if emp_update:
        emp_update["updated_at"] = now()
        emp_update["updated_by"] = str(g.current_user["_id"])

        if existing_emp:
            if not incoming_photo:
                photo = merge_profile_photo_from_sources(existing_emp, updated_user)
                if photo:
                    apply_profile_photo_aliases(emp_update, photo)

            db.employees.update_one(
                {"_id": existing_emp["_id"]},
                {"$set": emp_update},
            )
            updated_emp = db.employees.find_one({"_id": existing_emp["_id"]})
        else:
            if not incoming_photo:
                photo = profile_photo_value(updated_user)
                if photo:
                    apply_profile_photo_aliases(emp_update, photo)

            emp_update.setdefault("tenant_id", tenant_for_lookup)
            emp_update.setdefault("user_id", user_id)
            emp_update.setdefault("name", updated_user.get("name", ""))
            emp_update.setdefault("employee_name", updated_user.get("name", ""))
            emp_update.setdefault("email", updated_user.get("email", ""))
            emp_update.setdefault("country", "India")
            emp_update.setdefault("branch", "Assam(HO)")
            emp_update.setdefault("state", normalize_state(emp_update.get("state") or emp_update.get("branch")))
            emp_update.setdefault("role", "Employee")
            emp_update.setdefault("shift", "General")
            emp_update.setdefault("status", "Active")
            emp_update.setdefault("is_team_leader", "false")
            emp_update.setdefault("is_reporting_officer", "false")
            emp_update.setdefault("is_it_support_head", "false")
            emp_update.setdefault("is_it_support_member", "false")

            if truthy(emp_update.get("is_it_support_head")):
                emp_update["is_it_support_member"] = "true"

            emp_update["created_at"] = now()
            emp_update["created_by"] = str(g.current_user["_id"])
            emp_update["is_deleted"] = False

            res = db.employees.insert_one(emp_update)
            updated_emp = db.employees.find_one({"_id": res.inserted_id})

        if updated_emp:
            photo = merge_profile_photo_from_sources(updated_emp, updated_user)
            if photo:
                apply_profile_photo_aliases(updated_emp, photo)

                db.employees.update_one(
                    {"_id": updated_emp["_id"]},
                    {"$set": {
                        "avatar": photo,
                        "profile_photo": photo,
                        "profile_picture": photo,
                        "photo": photo,
                        "updated_at": now(),
                    }},
                )

                db.users.update_one(
                    {"_id": user_obj_id},
                    {"$set": {
                        "avatar": photo,
                        "profile_photo": photo,
                        "profile_picture": photo,
                        "photo": photo,
                        "updated_at": now(),
                    }},
                )

            sync_employee_roles(db, updated_emp)
            seed_default_leave_balances_for_employee(
                db,
                updated_emp.get("tenant_id") or tenant_for_lookup,
                updated_emp,
            )

    audit("update_user", "users", user_id, data)

    refreshed = db.users.find_one({"_id": user_obj_id})
    employee_profile = db.employees.find_one({
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if employee_profile:
        photo = merge_profile_photo_from_sources(employee_profile, refreshed)
        if photo:
            apply_profile_photo_aliases(employee_profile, photo)
            apply_profile_photo_aliases(refreshed, photo)

        refreshed["employee_profile"] = employee_profile
        refreshed["employee_ref_id"] = str(employee_profile["_id"])
        refreshed["employee_id"] = str(employee_profile["_id"])
        refreshed["emp_code"] = employee_code(employee_profile)
        refreshed["department"] = employee_profile.get("department", refreshed.get("department", ""))
        refreshed["designation"] = employee_profile.get("designation", refreshed.get("designation", ""))
        refreshed["is_it_support_head"] = bool_string(employee_profile.get("is_it_support_head"))
        refreshed["is_it_support_member"] = bool_string(employee_profile.get("is_it_support_member"))
    else:
        photo = profile_photo_value(refreshed)
        apply_profile_photo_aliases(refreshed, photo)

    return jsonify({
        "message": "User/profile updated",
        "item": clean_doc(refreshed),
    })


@superadmin_bp.post("/users/<user_id>/reset-password")
@roles_required("super_admin")
def reset_password(user_id):
    user_obj_id = safe_object_id(user_id)

    if not user_obj_id:
        return jsonify({"message": "Invalid user id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    password = data.get("password") or "User@123"

    if len(password) < 6:
        return jsonify({"message": "Password must be at least 6 characters"}), 400

    existing = db.users.find_one({"_id": user_obj_id})

    if not existing:
        return jsonify({"message": "User not found"}), 404

    db.users.update_one(
        {"_id": user_obj_id},
        {
            "$set": {
                "password_hash": generate_password_hash(password),
                "updated_at": now(),
                "updated_by": str(g.current_user["_id"]),
            }
        },
    )

    audit("reset_password", "users", user_id)

    return jsonify({"message": "Password reset successful"})


# -----------------------------------------------------------------------------
# Super Admin Tenant-wise User / Employee Control
# -----------------------------------------------------------------------------
# These routes are intentionally added as separate Super Admin-only endpoints so
# the existing HR/Admin user creation and existing /superadmin/users workflow
# remain untouched. Frontend UserControl.jsx can call these endpoints for the
# new tenant dropdown, tenant-wise user table, create employee, reset password,
# disable/enable, and soft-delete actions.


@superadmin_bp.get("/tenants")
@roles_required("super_admin")
def list_tenants_for_user_control():
    db = get_db()
    q = {"is_deleted": {"$ne": True}}

    search = normalize_text(request.args.get("q") or request.args.get("search"))

    if search:
        q["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"tenant_id": {"$regex": search, "$options": "i"}},
            {"domain": {"$regex": search, "$options": "i"}},
            {"contact_email": {"$regex": search, "$options": "i"}},
        ]

    tenants = list(db.tenants.find(q).sort([("name", 1), ("tenant_id", 1)]).limit(1000))

    items = []

    for tenant in tenants:
        tenant_id = normalize_text(tenant.get("tenant_id"))

        if not tenant_id:
            continue

        items.append({
            "_id": str(tenant.get("_id")),
            "id": str(tenant.get("_id")),
            "tenant_id": tenant_id,
            "name": tenant.get("name") or tenant_id,
            "domain": tenant.get("domain", ""),
            "contact_email": tenant.get("contact_email", ""),
            "status": tenant.get("status", "active"),
            "is_active": tenant.get("status", "active") != "inactive",
            "employee_count": db.employees.count_documents({
                "tenant_id": tenant_id,
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            }),
            "user_count": db.users.count_documents({
                "tenant_id": tenant_id,
                "is_deleted": {"$ne": True},
            }),
        })

    return jsonify({"items": clean_doc(items)})


@superadmin_bp.get("/tenant-users")
@roles_required("super_admin")
def list_tenant_users_for_user_control():
    db = get_db()

    tenant_id = normalize_text(request.args.get("tenant_id")).lower()
    search = normalize_text(request.args.get("q") or request.args.get("search"))
    designation = normalize_text(request.args.get("designation"))
    include_deleted = truthy(request.args.get("include_deleted"))

    if not tenant_id:
        return jsonify({"items": []})

    if not db.tenants.find_one({"tenant_id": tenant_id}):
        return jsonify({"message": "Invalid tenant_id / company"}), 400

    q = {"tenant_id": tenant_id}

    if not include_deleted:
        q["is_deleted"] = {"$ne": True}

    and_filters = []

    if search:
        and_filters.append({
            "$or": [
                {"name": {"$regex": search, "$options": "i"}},
                {"full_name": {"$regex": search, "$options": "i"}},
                {"email": {"$regex": search, "$options": "i"}},
                {"username": {"$regex": search, "$options": "i"}},
                {"emp_code": {"$regex": search, "$options": "i"}},
                {"employee_id": {"$regex": search, "$options": "i"}},
                {"department": {"$regex": search, "$options": "i"}},
                {"designation": {"$regex": search, "$options": "i"}},
            ]
        })

    if designation:
        and_filters.append({
            "$or": [
                {"designation": {"$regex": designation, "$options": "i"}},
                {"designation_name": {"$regex": designation, "$options": "i"}},
            ]
        })

    if and_filters:
        q["$and"] = and_filters

    users = list(
        db.users.find(
            q,
            {
                "password": 0,
                "password_hash": 0,
                "hashed_password": 0,
            },
        ).sort([("created_at", -1), ("name", 1)]).limit(2000)
    )

    items = []

    for user in users:
        user_id = str(user.get("_id"))
        email = normalize_email(user.get("email"))

        emp_query = {
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "$or": [
                {"user_id": user_id},
                {"user_id": user.get("_id")},
            ],
        }

        if email:
            emp_query["$or"].extend([
                {"email": email},
                {"official_email": email},
            ])

        emp = db.employees.find_one(emp_query)

        if emp:
            photo = merge_profile_photo_from_sources(emp, user)

            if normalize_text(emp.get("user_id")) != user_id:
                emp_update = {
                    "user_id": user_id,
                    "updated_at": now(),
                }
                apply_profile_photo_aliases(emp_update, photo)
                db.employees.update_one({"_id": emp["_id"]}, {"$set": emp_update})
                emp["user_id"] = user_id

            if photo:
                apply_profile_photo_aliases(emp, photo)
                apply_profile_photo_aliases(user, photo)

            user["employee_profile"] = emp
            user["employee_ref_id"] = str(emp["_id"])
            user["employee_id"] = str(emp["_id"])
            user["employee_name"] = employee_display_name(emp)
            user["emp_code"] = employee_code(emp)
            user["department"] = emp.get("department", user.get("department", ""))
            user["designation"] = emp.get("designation", user.get("designation", ""))
            user["phone"] = emp.get("phone", "")
            user["is_team_leader"] = bool_string(emp.get("is_team_leader"))
            user["is_reporting_officer"] = bool_string(emp.get("is_reporting_officer"))
            user["is_it_support_head"] = bool_string(emp.get("is_it_support_head"))
            user["is_it_support_member"] = bool_string(emp.get("is_it_support_member"))
        else:
            photo = profile_photo_value(user)
            apply_profile_photo_aliases(user, photo)
            user["employee_name"] = user.get("name") or user.get("full_name") or user.get("email")
            user["employee_profile"] = None

        if designation:
            combined_designation = normalize_text(user.get("designation")).lower()
            employee_designation = normalize_text((emp or {}).get("designation")).lower()

            if (
                designation.lower() not in combined_designation
                and designation.lower() not in employee_designation
            ):
                continue

        user["is_disabled"] = user.get("is_disabled", user.get("is_active") is False)
        user["is_active"] = user.get("is_active", not truthy(user.get("is_disabled")))

        items.append(user)

    return jsonify({"items": clean_doc(items)})


@superadmin_bp.post("/tenant-employees")
@roles_required("super_admin")
def create_tenant_employee_for_user_control():
    db = get_db()
    data = request.get_json(silent=True) or {}

    tenant_id = normalize_text(data.get("tenant_id") or "sds").lower()

    if not db.tenants.find_one({"tenant_id": tenant_id}):
        return jsonify({"message": "Invalid tenant_id / company"}), 400

    seed_company_masters(db, tenant_id)

    name = normalize_text(
        data.get("name")
        or data.get("employee_name")
        or data.get("full_name")
    )
    email = normalize_email(data.get("email") or data.get("official_email"))
    password = data.get("password") or "User@123"
    confirm_password = data.get("confirm_password") or data.get("password_confirm") or password
    photo = profile_photo_value(data)

    if not name:
        return jsonify({"message": "Employee name is required"}), 400

    if not email:
        return jsonify({"message": "Email is required"}), 400

    if len(password) < 6:
        return jsonify({"message": "Password must be at least 6 characters"}), 400

    if password != confirm_password:
        return jsonify({"message": "Password and confirm password do not match"}), 400

    if db.users.find_one({
        "email": email,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }):
        return jsonify({"message": "Email already exists in this tenant"}), 409

    employee_id = normalize_text(data.get("employee_id"))
    emp_code = normalize_text(data.get("emp_code") or data.get("employee_code"))

    if employee_id:
        if db.employees.find_one({
            "tenant_id": tenant_id,
            "employee_id": employee_id,
            "is_deleted": {"$ne": True},
        }):
            return jsonify({"message": "Employee ID already exists in this tenant"}), 409

    if emp_code:
        if db.employees.find_one({
            "tenant_id": tenant_id,
            "emp_code": emp_code,
            "is_deleted": {"$ne": True},
        }):
            return jsonify({"message": "Employee code already exists in this tenant"}), 409

    roles = normalize_roles(data.get("roles") or data.get("role") or ["employee"])
    is_active = truthy(data.get("is_active", True))

    user_payload = {
        "tenant_id": tenant_id,
        "name": name,
        "full_name": name,
        "email": email,
        "username": email,
        "password_hash": generate_password_hash(password),
        "role": "employee",
        "roles": roles,
        "is_active": is_active,
        "is_disabled": not is_active,
        "status": "active" if is_active else "inactive",
        "is_deleted": False,
        "created_at": now(),
        "updated_at": now(),
        "created_by": str(g.current_user["_id"]),
        "created_by_name": "Super Admin",
    }
    apply_profile_photo_aliases(user_payload, photo)

    user_res = db.users.insert_one(user_payload)

    emp = build_employee_profile_payload(data)

    department = normalize_text(data.get("department") or data.get("department_name"))
    designation = normalize_text(data.get("designation") or data.get("designation_name"))
    phone = normalize_text(data.get("phone") or data.get("mobile"))
    team_leader_id = normalize_text(data.get("team_leader_id"))
    reporting_officer_id = normalize_text(data.get("reporting_officer_id"))

    emp.update({
        "tenant_id": tenant_id,
        "user_id": str(user_res.inserted_id),
        "name": name,
        "employee_name": name,
        "email": email,
        "official_email": email,
        "phone": phone,
        "employee_id": employee_id,
        "emp_code": emp_code,
        "department": department,
        "designation": designation,
        "team_leader_id": team_leader_id,
        "team_leader_name": resolve_employee_name(db, tenant_id, team_leader_id),
        "reporting_officer_id": reporting_officer_id,
        "reporting_officer_name": resolve_employee_name(db, tenant_id, reporting_officer_id),
        "created_at": now(),
        "updated_at": now(),
        "created_by": str(g.current_user["_id"]),
        "created_by_name": "Super Admin",
        "is_deleted": False,
    })
    apply_profile_photo_aliases(emp, photo)

    emp.setdefault("country", "India")
    emp.setdefault("branch", "Assam(HO)")
    emp.setdefault("state", normalize_state(emp.get("state") or emp.get("branch")))
    emp.setdefault("role", "Employee")
    emp.setdefault("shift", "General")
    emp.setdefault("status", "Active" if is_active else "Inactive")
    emp.setdefault("is_team_leader", bool_string(data.get("is_team_leader", "false")))
    emp.setdefault("is_reporting_officer", bool_string(data.get("is_reporting_officer", "false")))
    emp.setdefault("is_it_support_head", bool_string(data.get("is_it_support_head", "false")))
    emp.setdefault("is_it_support_member", bool_string(data.get("is_it_support_member", "false")))

    if truthy(emp.get("is_it_support_head")):
        emp["is_it_support_member"] = "true"

    emp_res = db.employees.insert_one(emp)
    created_emp = db.employees.find_one({"_id": emp_res.inserted_id})

    if created_emp:
        user_update = {
            "employee_id": str(created_emp["_id"]),
            "employee_ref_id": str(created_emp["_id"]),
            "emp_code": employee_code(created_emp),
            "department": created_emp.get("department", ""),
            "designation": created_emp.get("designation", ""),
            "is_team_leader": bool_string(created_emp.get("is_team_leader")),
            "is_reporting_officer": bool_string(created_emp.get("is_reporting_officer")),
            "is_it_support_head": bool_string(created_emp.get("is_it_support_head")),
            "is_it_support_member": bool_string(created_emp.get("is_it_support_member")),
            "updated_at": now(),
        }
        apply_profile_photo_aliases(user_update, profile_photo_value(created_emp))

        db.users.update_one(
            {"_id": user_res.inserted_id},
            {"$set": user_update},
        )
        sync_employee_roles(db, created_emp)
        seed_default_leave_balances_for_employee(db, tenant_id, created_emp)

    audit("create_tenant_employee", "users", user_res.inserted_id, {
        "email": email,
        "roles": roles,
        "tenant_id": tenant_id,
    })

    created_user = db.users.find_one({"_id": user_res.inserted_id})
    created_user["employee_profile"] = created_emp
    photo = merge_profile_photo_from_sources(created_emp, created_user)
    apply_profile_photo_aliases(created_user, photo)

    return jsonify({
        "message": "Employee created successfully",
        "item": clean_doc(created_user),
        "user": clean_doc(created_user),
        "employee": clean_doc(created_emp),
    }), 201


@superadmin_bp.patch("/tenant-users/<user_id>/password")
@roles_required("super_admin")
def change_tenant_user_password(user_id):
    user_obj_id = safe_object_id(user_id)

    if not user_obj_id:
        return jsonify({"message": "Invalid user id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    password = data.get("password") or data.get("new_password") or ""
    confirm_password = data.get("confirm_password") or data.get("password_confirm") or password

    if not password:
        return jsonify({"message": "New password is required"}), 400

    if len(password) < 6:
        return jsonify({"message": "Password must be at least 6 characters"}), 400

    if password != confirm_password:
        return jsonify({"message": "Password and confirm password do not match"}), 400

    existing = db.users.find_one({
        "_id": user_obj_id,
        "is_deleted": {"$ne": True},
    })

    if not existing:
        return jsonify({"message": "User not found"}), 404

    db.users.update_one(
        {"_id": user_obj_id},
        {
            "$set": {
                "password_hash": generate_password_hash(password),
                "updated_at": now(),
                "updated_by": str(g.current_user["_id"]),
                "password_changed_by": str(g.current_user["_id"]),
            }
        },
    )

    audit("change_tenant_user_password", "users", user_id)

    return jsonify({"message": "Password updated successfully"})


@superadmin_bp.patch("/tenant-users/<user_id>/status")
@roles_required("super_admin")
def update_tenant_user_status(user_id):
    user_obj_id = safe_object_id(user_id)

    if not user_obj_id:
        return jsonify({"message": "Invalid user id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    is_active = truthy(data.get("is_active"))

    existing = db.users.find_one({
        "_id": user_obj_id,
        "is_deleted": {"$ne": True},
    })

    if not existing:
        return jsonify({"message": "User not found"}), 404

    user_roles = existing.get("roles") or []

    if existing.get("role") == "super_admin" or "super_admin" in user_roles:
        return jsonify({"message": "Super admin user status cannot be changed here"}), 400

    status = "active" if is_active else "inactive"

    db.users.update_one(
        {"_id": user_obj_id},
        {
            "$set": {
                "is_active": is_active,
                "is_disabled": not is_active,
                "status": status,
                "updated_at": now(),
                "updated_by": str(g.current_user["_id"]),
            }
        },
    )

    db.employees.update_many(
        {
            "tenant_id": existing.get("tenant_id"),
            "is_deleted": {"$ne": True},
            "$or": [
                {"user_id": str(user_obj_id)},
                {"user_id": user_obj_id},
                {"email": normalize_email(existing.get("email"))},
                {"official_email": normalize_email(existing.get("email"))},
            ],
        },
        {
            "$set": {
                "status": "Active" if is_active else "Inactive",
                "updated_at": now(),
                "updated_by": str(g.current_user["_id"]),
            }
        },
    )

    audit("update_tenant_user_status", "users", user_id, {"is_active": is_active})

    return jsonify({
        "message": "User enabled successfully" if is_active else "User disabled successfully",
    })


@superadmin_bp.delete("/tenant-users/<user_id>")
@roles_required("super_admin")
def delete_tenant_user_from_control(user_id):
    user_obj_id = safe_object_id(user_id)

    if not user_obj_id:
        return jsonify({"message": "Invalid user id"}), 400

    db = get_db()
    existing = db.users.find_one({"_id": user_obj_id})

    if not existing:
        return jsonify({"message": "User not found"}), 404

    user_roles = existing.get("roles") or []

    if existing.get("role") == "super_admin" or "super_admin" in user_roles:
        return jsonify({"message": "Super admin user cannot be deleted"}), 400

    delete_payload = {
        "is_deleted": True,
        "is_active": False,
        "is_disabled": True,
        "status": "deleted",
        "deleted_at": now(),
        "deleted_by": str(g.current_user["_id"]),
        "updated_at": now(),
        "updated_by": str(g.current_user["_id"]),
    }

    db.users.update_one(
        {"_id": user_obj_id},
        {"$set": delete_payload},
    )

    db.employees.update_many(
        {
            "tenant_id": existing.get("tenant_id"),
            "$or": [
                {"user_id": str(user_obj_id)},
                {"user_id": user_obj_id},
                {"email": normalize_email(existing.get("email"))},
                {"official_email": normalize_email(existing.get("email"))},
            ],
        },
        {
            "$set": {
                "is_deleted": True,
                "status": "Deleted",
                "deleted_at": now(),
                "deleted_by": str(g.current_user["_id"]),
                "updated_at": now(),
                "updated_by": str(g.current_user["_id"]),
            }
        },
    )

    audit("delete_tenant_user", "users", user_id)

    return jsonify({"message": "User deleted successfully"})

@superadmin_bp.get("/private-attendance-corrections/tenants")
@roles_required("super_admin")
def private_attendance_correction_tenants():
    db = get_db()

    rows = list(
        db.tenants
        .find(
            {"is_deleted": {"$ne": True}},
            {
                "tenant_id": 1,
                "name": 1,
                "company_name": 1,
                "domain": 1,
                "status": 1,
            },
        )
        .sort("name", 1)
        .limit(1000)
    )

    return jsonify({"items": clean_doc(rows)})


@superadmin_bp.get("/private-attendance-corrections/employees")
@roles_required("super_admin")
def private_attendance_correction_employees():
    db = get_db()

    tenant_id = normalize_text(request.args.get("tenant_id"))
    search = normalize_text(request.args.get("q"))

    if not tenant_id:
        return jsonify({"message": "Tenant is required"}), 400

    query = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    }

    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"employee_name": {"$regex": search, "$options": "i"}},
            {"employee_id": {"$regex": search, "$options": "i"}},
            {"employee_code": {"$regex": search, "$options": "i"}},
            {"emp_code": {"$regex": search, "$options": "i"}},
            {"code": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"department": {"$regex": search, "$options": "i"}},
            {"designation": {"$regex": search, "$options": "i"}},
        ]

    employees = list(
        db.employees
        .find(
            query,
            {
                "tenant_id": 1,
                "name": 1,
                "employee_name": 1,
                "employee_id": 1,
                "employee_code": 1,
                "emp_code": 1,
                "code": 1,
                "email": 1,
                "department": 1,
                "designation": 1,
                "status": 1,
            },
        )
        .sort("name", 1)
        .limit(100)
    )

    return jsonify({
        "items": clean_doc([
            superadmin_attendance_employee_payload(employee)
            for employee in employees
        ])
    })


@superadmin_bp.get("/private-attendance-corrections/record")
@roles_required("super_admin")
def private_attendance_correction_record():
    db = get_db()

    tenant_id = normalize_text(request.args.get("tenant_id"))
    employee_id = normalize_text(request.args.get("employee_id"))
    attendance_date = normalize_text(request.args.get("date"))

    if not tenant_id:
        return jsonify({"message": "Tenant is required"}), 400

    if not employee_id:
        return jsonify({"message": "Employee is required"}), 400

    if not parse_attendance_date(attendance_date):
        return jsonify({"message": "Valid attendance date is required"}), 400

    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return jsonify({"message": "Invalid employee id"}), 400

    employee = db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    })

    if not employee:
        return jsonify({"message": "Employee not found"}), 404

    identity_values = employee_identity_query_values(employee)

    record = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "date": attendance_date,
        "$or": [
            {"employee_ref_id": {"$in": identity_values}},
            {"employee_id": {"$in": identity_values}},
            {"user_id": {"$in": identity_values}},
            {"email": {"$in": identity_values}},
        ],
    })

    return jsonify({
        "employee": superadmin_attendance_employee_payload(employee),
        "record": superadmin_attendance_record_payload(record),
    })


@superadmin_bp.post("/private-attendance-corrections/update")
@roles_required("super_admin")
def private_attendance_correction_update():
    db = get_db()
    data = request.get_json(silent=True) or {}

    tenant_id = normalize_text(data.get("tenant_id"))
    employee_id = normalize_text(data.get("employee_id"))
    attendance_date = normalize_text(data.get("date"))

    check_in_time = normalize_text(data.get("check_in"))
    check_out_time = normalize_text(data.get("check_out"))
    mode = normalize_text(data.get("mode") or "office").lower()
    check_in_location = normalize_text(data.get("check_in_location"))
    check_out_location = normalize_text(data.get("check_out_location"))
    late_reason = normalize_text(data.get("late_reason"))
    early_checkout_reason = normalize_text(data.get("early_checkout_reason"))
    remarks = normalize_text(data.get("remarks"))
    correction_reason = normalize_text(data.get("correction_reason"))

    if not tenant_id:
        return jsonify({"message": "Tenant is required"}), 400

    if not employee_id:
        return jsonify({"message": "Employee is required"}), 400

    if not parse_attendance_date(attendance_date):
        return jsonify({"message": "Valid attendance date is required"}), 400

    if mode not in {"office", "wfh", "field"}:
        return jsonify({"message": "Attendance mode must be office, wfh, or field"}), 400

    if not check_in_time:
        return jsonify({"message": "Check-in time is required"}), 400

    check_in_at = combine_attendance_datetime(attendance_date, check_in_time)

    if not check_in_at:
        return jsonify({"message": "Valid check-in time is required"}), 400

    check_out_at = None

    if check_out_time:
        check_out_at = combine_attendance_datetime(attendance_date, check_out_time)

        if not check_out_at:
            return jsonify({"message": "Valid check-out time is required"}), 400

        if check_out_at < check_in_at:
            return jsonify({"message": "Check-out time cannot be earlier than check-in time"}), 400

    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return jsonify({"message": "Invalid employee id"}), 400

    employee = db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    })

    if not employee:
        return jsonify({"message": "Employee not found"}), 404

    identity_values = employee_identity_query_values(employee)

    existing = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "date": attendance_date,
        "$or": [
            {"employee_ref_id": {"$in": identity_values}},
            {"employee_id": {"$in": identity_values}},
            {"user_id": {"$in": identity_values}},
            {"email": {"$in": identity_values}},
        ],
    })

    status = build_attendance_status(check_in_at, check_out_at)
    employee_name = employee_display_name(employee)
    employee_code_value = employee_code(employee)

    parsed_check_in_location = parse_attendance_location_input(check_in_location)
    parsed_check_out_location = parse_attendance_location_input(check_out_location)

    update_payload = {
        "tenant_id": tenant_id,
        "employee_ref_id": str(employee["_id"]),
        "employee_id": str(employee["_id"]),
        "employee_code": employee_code_value,
        "emp_code": employee.get("emp_code", ""),
        "employee_name": employee_name,
        "email": normalize_email(employee.get("email")),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "date": attendance_date,
        "status": status,
        "mode": mode,
        "work_mode": mode,
        "check_in": check_in_at,
        "check_in_at": check_in_at,
        "check_in_location": parsed_check_in_location,
        "location": parsed_check_in_location,
        "late_reason": late_reason,
        "early_checkout_reason": early_checkout_reason,
        "remarks": remarks,
        "manually_corrected": True,
        "manual_correction_source": "super_admin_private_attendance_correction",
        "manual_correction_reason": correction_reason,
        "updated_at": now(),
        "updated_by": str(g.current_user["_id"]),
        "updated_by_name": g.current_user.get("name", "Super Admin"),
    }

    if check_out_at:
        update_payload.update({
            "check_out": check_out_at,
            "check_out_at": check_out_at,
            "check_out_location": parsed_check_out_location,
        })
    else:
        update_payload.update({
            "check_out": None,
            "check_out_at": None,
            "check_out_location": None,
        })

    old_payload = superadmin_attendance_record_payload(existing)

    if existing:
        db.attendance_logs.update_one(
            {"_id": existing["_id"]},
            {"$set": update_payload},
        )

        attendance_id = existing["_id"]
        action = "updated"
    else:
        update_payload.update({
            "created_at": now(),
            "created_by": str(g.current_user["_id"]),
        })

        result = db.attendance_logs.insert_one(update_payload)

        attendance_id = result.inserted_id
        action = "created"

    updated = db.attendance_logs.find_one({"_id": attendance_id})

    db.attendance_private_corrections.insert_one({
        "tenant_id": tenant_id,
        "attendance_id": str(attendance_id),
        "employee_ref_id": str(employee["_id"]),
        "employee_ref_id": str(employee["_id"]),
        "employee_id": employee_code_value,
        "employee_name": employee_name,
        "date": attendance_date,
        "action": action,
        "old_values": old_payload,
        "new_values": superadmin_attendance_record_payload(updated),
        "reason": correction_reason,
        "changed_by": str(g.current_user["_id"]),
        "changed_by_name": g.current_user.get("name", "Super Admin"),
        "changed_by_email": normalize_email(g.current_user.get("email")),
        "created_at": now(),
    })

    return jsonify({
        "message": "Attendance correction saved successfully",
        "record": superadmin_attendance_record_payload(updated),
    })