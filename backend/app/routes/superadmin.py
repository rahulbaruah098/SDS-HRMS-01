from flask import Blueprint, request, jsonify, g, current_app
from bson import ObjectId
from pymongo.errors import DuplicateKeyError
from datetime import datetime, time, timedelta
import re
from werkzeug.security import generate_password_hash

from app.extensions import get_db
from app.utils.auth import roles_required, audit
from app.utils.serializers import clean_doc

from app.services.tenant_service import (
    build_subscription_summary,
    ensure_sds_tenant,
    get_trial_days_left,
    is_sds_tenant,
    serialize_tenant_for_admin,
)

from app.services.pricing_service import (
    find_pricing_plan,
    get_default_paid_plan,
    normalize_plan_for_subscription,
    PricingServiceError,
)


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
    "employee_code",
    "emp_code",
    "code",
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


EMPLOYEE_IDENTITY_FIELDS = (
    "employee_id",
    "employee_code",
    "emp_code",
    "code",
)


def employee_identity_alias_keys(payload):
    payload = payload or {}

    return sorted({
        normalize_text(payload.get(field_name)).lower()
        for field_name in EMPLOYEE_IDENTITY_FIELDS
        if normalize_text(payload.get(field_name))
    })


def employee_identity_conflict(db, employee_doc, exclude_employee_id=None):
    employee_doc = employee_doc or {}
    tenant_id = normalize_text(employee_doc.get("tenant_id")).lower()
    aliases = employee_identity_alias_keys(employee_doc)

    if not tenant_id or not aliases:
        return None

    identity_queries = [
        {"identity_alias_keys": {"$in": aliases}},
    ]

    for field_name in EMPLOYEE_IDENTITY_FIELDS:
        for alias in aliases:
            identity_queries.append({
                field_name: {
                    "$regex": f"^{re.escape(alias)}$",
                    "$options": "i",
                }
            })

    query = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": identity_queries,
    }

    if exclude_employee_id:
        exclude_object_id = (
            exclude_employee_id
            if isinstance(exclude_employee_id, ObjectId)
            else safe_object_id(exclude_employee_id)
        )

        if exclude_object_id:
            query["_id"] = {"$ne": exclude_object_id}

    return db.employees.find_one(query)


def normalize_email(value):
    return str(value or "").strip().lower()


def normalize_float(value, default=0):
    try:
        return float(value or default)
    except Exception:
        return float(default)


def config_bool(key, default=False):
    value = current_app.config.get(key, default)

    if isinstance(value, bool):
        return value

    return normalize_text(value).lower() in {"1", "true", "yes", "y", "on"}


def configured_trial_days():
    try:
        return int(current_app.config.get("DEMO_DURATION_DAYS", 15) or 15)
    except Exception:
        return 15


def configured_trial_employee_limit():
    try:
        limit = int(current_app.config.get("DEMO_EMPLOYEE_LIMIT", 0) or 0)
    except Exception:
        limit = 0

    # 0 means unlimited during the 15-day full-access trial.
    return None if limit <= 0 else limit


def configured_trial_allowed_modules():
    raw = current_app.config.get("DEMO_ALLOWED_MODULES", ["all"])

    modules = normalize_allowed_modules(raw, "demo")

    return modules or ["all"]


def configured_trial_plan_name():
    return f"{configured_trial_days()}-Day Full Access Trial"


def get_paid_plan_payload(db, data=None, tenant=None):
    data = data or {}
    tenant = tenant or {}

    requested_plan_code = normalize_text(
        data.get("plan_code")
        or data.get("selected_plan_code")
        or tenant.get("plan_code")
        or tenant.get("selected_plan_code")
    )

    try:
        plan = find_pricing_plan(db, requested_plan_code) if requested_plan_code else None

        if not plan:
            plan = get_default_paid_plan(db)

        if plan:
            return normalize_plan_for_subscription(plan)
    except PricingServiceError:
        raise
    except Exception:
        pass

    amount = normalize_float(
        data.get("amount") or tenant.get("plan_amount"),
        current_app.config.get("SAAS_GROWTH_PLAN_AMOUNT", current_app.config.get("SAAS_FULL_PLAN_AMOUNT", 4495.0)),
    )
    employee_limit = int(
        data.get("employee_limit")
        or tenant.get("employee_limit")
        or current_app.config.get("SAAS_GROWTH_EMPLOYEE_LIMIT", 100)
        or 100
    )

    return {
        "plan_code": normalize_text(requested_plan_code or current_app.config.get("SAAS_DEFAULT_PAID_PLAN_CODE", "growth")) or "growth",
        "plan_name": normalize_text(data.get("plan_name") or tenant.get("plan_name") or current_app.config.get("SAAS_FULL_PLAN_NAME", "Growth")) or "Growth",
        "plan_label": normalize_text(data.get("plan_name") or tenant.get("plan_label") or current_app.config.get("SAAS_FULL_PLAN_NAME", "Growth")) or "Growth",
        "plan_type": "paid",
        "billing_interval": normalize_text(data.get("billing_interval") or tenant.get("billing_interval") or current_app.config.get("SAAS_FULL_PLAN_INTERVAL", "monthly")) or "monthly",
        "amount": amount,
        "currency": normalize_text(data.get("currency") or tenant.get("currency") or current_app.config.get("RAZORPAY_CURRENCY", "INR")) or "INR",
        "employee_limit": employee_limit,
        "is_unlimited_employees": False,
        "allowed_modules": ["all"],
    }


def normalize_plan_type(value, default="paid"):
    plan_type = normalize_text(value or default).lower().replace(" ", "_").replace("-", "_")

    if plan_type in {"trial", "demo_trial", "free_trial"}:
        return "demo"

    if plan_type in {"lifetime", "life_time", "sds", "internal"}:
        return "lifetime"

    if plan_type not in {"demo", "paid", "lifetime"}:
        return default

    return plan_type


def normalize_company_status(value, default="active"):
    status = normalize_text(value or default).lower().replace(" ", "_").replace("-", "_")

    if status not in {"pending", "active", "expired", "suspended", "rejected"}:
        return default

    return status


def normalize_allowed_modules(value, plan_type="paid"):
    if isinstance(value, str):
        modules = [item.strip() for item in value.split(",") if item.strip()]
    elif isinstance(value, (list, tuple, set)):
        modules = [normalize_text(item) for item in value if normalize_text(item)]
    else:
        modules = []

    if modules:
        return modules

    if plan_type == "demo":
        raw_modules = current_app.config.get("DEMO_ALLOWED_MODULES", ["all"])

        if isinstance(raw_modules, str):
            modules = [item.strip() for item in raw_modules.split(",") if item.strip()]
        elif isinstance(raw_modules, (list, tuple, set)):
            modules = [normalize_text(item) for item in raw_modules if normalize_text(item)]
        else:
            modules = []

        return modules or ["all"]

    return ["all"]


def tenant_lookup_query(tenant_id):
    tenant_id = normalize_text(tenant_id)
    object_id = safe_object_id(tenant_id)

    query = {
        "$or": [
            {"tenant_id": tenant_id},
            {"tenant_code": tenant_id},
        ],
        "is_deleted": {"$ne": True},
    }

    if object_id:
        query["$or"].append({"_id": object_id})

    return query


def find_tenant_for_superadmin(db, tenant_id):
    tenant_id = normalize_text(tenant_id)

    if not tenant_id:
        return None

    return db.tenants.find_one(tenant_lookup_query(tenant_id))


def active_employee_count(db, tenant_id):
    return db.employees.count_documents({
        "tenant_id": tenant_id,
        "status": {"$nin": ["Inactive", "inactive", "disabled", "Disabled"]},
        "is_deleted": {"$ne": True},
    })


def enrich_tenant_for_superadmin(db, tenant):
    if not tenant:
        return None

    payload = serialize_tenant_for_admin(db, tenant, current_app.config) or clean_doc(tenant)
    tenant_id = tenant.get("tenant_id")
    today = datetime.utcnow().date().isoformat()

    payload.update({
        "name": tenant.get("name") or tenant.get("company_name"),
        "domain": tenant.get("domain", ""),
        "contact_email": tenant.get("contact_email") or tenant.get("company_email", ""),
        "company_email": tenant.get("company_email") or tenant.get("contact_email", ""),
        "contact_phone": tenant.get("contact_phone") or tenant.get("company_phone", ""),
        "company_phone": tenant.get("company_phone") or tenant.get("contact_phone", ""),
        "address": tenant.get("address", ""),
        "plan": tenant.get("plan") or payload.get("plan_label"),
        "employee_count": active_employee_count(db, tenant_id),
        "user_count": db.users.count_documents({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        }),
        "present_today": db.attendance_logs.count_documents({
            "tenant_id": tenant_id,
            "date": today,
            "status": {"$in": ["present", "late", "early_checkout", "holiday_work"]},
        }),
        "late_today": db.attendance_logs.count_documents({
            "tenant_id": tenant_id,
            "date": today,
            "status": "late",
        }),
        "pending_wfh_field": db.attendance_mode_requests.count_documents({
            "tenant_id": tenant_id,
            "status": "pending",
        }),
        "pending_leaves": db.leave_requests.count_documents({
            "tenant_id": tenant_id,
            "status": "pending",
        }),
        "pending_grievances": db.grievances.count_documents({
            "tenant_id": tenant_id,
            "status": {"$in": ["pending", "under_review"]},
        }),
        "pending_it_support": db.it_support_tickets.count_documents({
            "tenant_id": tenant_id,
            "status": {"$in": ["open", "assigned", "in_progress", "waiting_for_user", "reopened"]},
        }),
        "available_compoff": db.compoff_credits.count_documents({
            "tenant_id": tenant_id,
            "status": "available",
        }),
    })

    payload["subscription"] = build_subscription_summary(db, tenant, current_app.config)

    return payload


def update_tenant_subscription_record(db, tenant):
    tenant_id = tenant.get("tenant_id")
    now_value = now()

    if not tenant_id:
        return

    plan_type = normalize_plan_type(tenant.get("plan_type"), "paid")
    status = normalize_company_status(tenant.get("status"), "active")

    if plan_type == "demo":
        plan_code = tenant.get("plan_code") or "trial"
        plan_name = tenant.get("plan_name") or tenant.get("plan_label") or configured_trial_plan_name()
        amount = 0
        currency = current_app.config.get("RAZORPAY_CURRENCY", "INR")
        employee_limit = tenant.get("employee_limit")
        is_unlimited_employees = employee_limit in [None, "", "unlimited", "Unlimited"]
        billing_interval = "trial"
        demo_has_full_access = tenant.get("demo_has_full_access", config_bool("DEMO_HAS_FULL_ACCESS", True))
        requires_payment = tenant.get("requires_payment", status == "expired")
        allowed_modules = tenant.get("allowed_modules") or configured_trial_allowed_modules()
    elif plan_type == "lifetime":
        plan_code = tenant.get("plan_code") or "lifetime"
        plan_name = "Lifetime Full HRMS"
        amount = 0
        currency = current_app.config.get("RAZORPAY_CURRENCY", "INR")
        employee_limit = None
        is_unlimited_employees = True
        billing_interval = "lifetime"
        demo_has_full_access = False
        requires_payment = False
        allowed_modules = ["all"]
    else:
        paid_plan = get_paid_plan_payload(db, tenant=tenant)
        plan_code = tenant.get("plan_code") or paid_plan.get("plan_code")
        plan_name = tenant.get("plan_name") or tenant.get("plan_label") or paid_plan.get("plan_name")
        amount = normalize_float(
            tenant.get("plan_amount") or tenant.get("amount"),
            paid_plan.get("amount", 4495.0),
        )
        currency = tenant.get("currency") or paid_plan.get("currency") or current_app.config.get("RAZORPAY_CURRENCY", "INR")
        employee_limit = tenant.get("employee_limit", paid_plan.get("employee_limit"))
        is_unlimited_employees = bool(tenant.get("is_unlimited_employees", paid_plan.get("is_unlimited_employees")))
        billing_interval = tenant.get("billing_interval") or paid_plan.get("billing_interval") or "monthly"
        demo_has_full_access = False
        requires_payment = False
        allowed_modules = ["all"]

    db.subscriptions.update_one(
        {
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "tenant_id": tenant_id,
                "company_id": tenant_id,
                "tenant_code": tenant.get("tenant_code"),
                "company_name": tenant.get("company_name") or tenant.get("name"),
                "company_email": tenant.get("company_email") or tenant.get("contact_email"),
                "plan_code": plan_code,
                "plan_name": plan_name,
                "plan_label": tenant.get("plan_label") or plan_name,
                "plan_type": plan_type,
                "billing_interval": billing_interval,
                "status": "active" if status == "active" else status,
                "subscription_status": tenant.get("subscription_status") or status,
                "trial_status": tenant.get("trial_status"),
                "amount": amount,
                "currency": currency,
                "employee_limit": employee_limit,
                "is_unlimited_employees": is_unlimited_employees,
                "allowed_modules": allowed_modules,
                "demo_duration_days": tenant.get("demo_duration_days") or configured_trial_days(),
                "demo_has_full_access": demo_has_full_access,
                "requires_payment": requires_payment,
                "start_date": tenant.get("subscription_start_date") or tenant.get("trial_start_date") or now_value,
                "end_date": tenant.get("subscription_end_date") or tenant.get("trial_end_date"),
                "is_sds_company": tenant.get("is_sds_company") is True,
                "is_lifetime": plan_type == "lifetime",
                "updated_at": now_value,
                "is_deleted": False,
            },
            "$setOnInsert": {
                "created_at": now_value,
            },
        },
        upsert=True,
    )

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

    if (
        check_out_at
        and check_out_at.date() == check_in_at.date()
        and check_out_at.time() < office_end
    ):
        return "early_checkout"

    return "present"


def build_private_correction_timeline(
    existing,
    check_in_at,
    check_out_at,
    check_in_location,
    check_out_location,
    correction_reason,
):
    existing = existing or {}
    source_timeline = existing.get("timeline") or []
    timeline = []
    check_in_found = False
    check_out_found = False

    for source_item in source_timeline:
        if not isinstance(source_item, dict):
            continue

        item = dict(source_item)
        event_type = normalize_text(item.get("type")).lower().replace("-", "_")

        if event_type == "check_in":
            item["time"] = check_in_at
            item["location"] = check_in_location
            item["manually_corrected"] = True
            check_in_found = True

        if event_type == "check_out":
            if not check_out_at:
                continue

            item["time"] = check_out_at
            item["location"] = check_out_location
            item["manually_corrected"] = True
            check_out_found = True

        timeline.append(item)

    if not check_in_found:
        timeline.insert(0, {
            "type": "check_in",
            "time": check_in_at,
            "note": "Check-in time set through private Super Admin correction",
            "location": check_in_location,
            "manually_corrected": True,
        })

    if check_out_at and not check_out_found:
        timeline.append({
            "type": "check_out",
            "time": check_out_at,
            "note": "Check-out time set through private Super Admin correction",
            "location": check_out_location,
            "manually_corrected": True,
        })

    timeline.append({
        "type": "manual_correction",
        "time": now(),
        "note": correction_reason or "Private Super Admin attendance correction",
        "changed_by": str(g.current_user.get("_id", "")),
        "changed_by_name": g.current_user.get("name", "Super Admin"),
    })

    return timeline


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
        "is_late": truthy(record_doc.get("is_late")),
        "is_early_checkout": truthy(record_doc.get("is_early_checkout")),
        "is_holiday_work": truthy(record_doc.get("is_holiday_work")),
        "manually_corrected": truthy(record_doc.get("manually_corrected")),
        "manual_correction_reason": record_doc.get("manual_correction_reason") or "",
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
        or normalize_text(employee_doc.get("employee_code"))
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
        "employee_code": employee_code(employee_doc),
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
    payload["employee_code"] = normalize_text(payload.get("employee_code"))
    payload["emp_code"] = normalize_text(payload.get("emp_code"))
    payload["code"] = normalize_text(payload.get("code"))
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
    ensure_sds_tenant(db, current_app.config)

    q = {
        "is_deleted": {"$ne": True},
    }

    search = normalize_text(request.args.get("q") or request.args.get("search"))
    status = normalize_company_status(request.args.get("status"), "") if request.args.get("status") else ""
    plan_type = normalize_plan_type(request.args.get("plan_type"), "") if request.args.get("plan_type") else ""

    if status:
        q["status"] = status

    if plan_type:
        q["plan_type"] = plan_type

    if search:
        q["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"company_name": {"$regex": search, "$options": "i"}},
            {"tenant_id": {"$regex": search, "$options": "i"}},
            {"tenant_code": {"$regex": search, "$options": "i"}},
            {"domain": {"$regex": search, "$options": "i"}},
            {"contact_email": {"$regex": search, "$options": "i"}},
            {"company_email": {"$regex": search, "$options": "i"}},
        ]

    rows = list(db.tenants.find(q).sort("created_at", -1).limit(500))
    items = [enrich_tenant_for_superadmin(db, row) for row in rows]

    return jsonify({
        "items": clean_doc(items),
        "summary": {
            "total": len(items),
            "active": len([item for item in items if item.get("status") == "active"]),
            "demo": len([item for item in items if item.get("plan_type") == "demo"]),
            "paid": len([item for item in items if item.get("plan_type") == "paid"]),
            "expired": len([item for item in items if item.get("status") == "expired"]),
            "suspended": len([item for item in items if item.get("status") == "suspended"]),
            "lifetime": len([item for item in items if item.get("plan_type") == "lifetime"]),
        },
    })


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

    plan_type = normalize_plan_type(data.get("plan_type") or data.get("plan"), "paid")
    status = normalize_company_status(data.get("status"), "active")
    employee_limit = data.get("employee_limit")

    if plan_type == "demo":
        employee_limit = configured_trial_employee_limit()
        trial_start_date = now()
        trial_end_date = trial_start_date + timedelta(days=configured_trial_days())
        subscription_status = "demo"
        trial_status = "active"
    elif plan_type == "lifetime":
        employee_limit = None
        trial_start_date = None
        trial_end_date = None
        subscription_status = "lifetime"
        trial_status = "not_required"
    else:
        paid_plan = get_paid_plan_payload(db, data=data)
        employee_limit = paid_plan.get("employee_limit")
        trial_start_date = None
        trial_end_date = None
        subscription_status = "active"
        trial_status = "not_required"

    doc = {
        "tenant_id": tenant_id,
        "tenant_code": normalize_text(data.get("tenant_code") or tenant_id.upper()),
        "name": name,
        "company_name": normalize_text(data.get("company_name") or name),
        "domain": normalize_text(data.get("domain")),
        "contact_email": normalize_email(data.get("contact_email") or data.get("company_email")),
        "company_email": normalize_email(data.get("company_email") or data.get("contact_email")),
        "contact_phone": normalize_text(data.get("contact_phone") or data.get("company_phone")),
        "company_phone": normalize_text(data.get("company_phone") or data.get("contact_phone")),
        "address": data.get("address", ""),
        "status": status,
        "plan": data.get("plan") or (configured_trial_plan_name() if plan_type == "demo" else get_paid_plan_payload(db, data=data).get("plan_name", "Growth")),
        "plan_type": plan_type,
        "subscription_status": subscription_status,
        "trial_status": trial_status,
        "trial_start_date": trial_start_date,
        "trial_end_date": trial_end_date,
        "employee_limit": employee_limit,
        "allowed_modules": configured_trial_allowed_modules() if plan_type == "demo" else normalize_allowed_modules(data.get("allowed_modules"), plan_type),
        "demo_duration_days": configured_trial_days() if plan_type == "demo" else None,
        "demo_has_full_access": config_bool("DEMO_HAS_FULL_ACCESS", True) if plan_type == "demo" else False,
        "requires_payment": False,
        "plan_code": "trial" if plan_type == "demo" else get_paid_plan_payload(db, data=data).get("plan_code"),
        "plan_name": configured_trial_plan_name() if plan_type == "demo" else get_paid_plan_payload(db, data=data).get("plan_name"),
        "plan_label": configured_trial_plan_name() if plan_type == "demo" else get_paid_plan_payload(db, data=data).get("plan_label"),
        "billing_interval": "trial" if plan_type == "demo" else get_paid_plan_payload(db, data=data).get("billing_interval"),
        "plan_amount": 0 if plan_type == "demo" else get_paid_plan_payload(db, data=data).get("amount"),
        "currency": current_app.config.get("RAZORPAY_CURRENCY", "INR") if plan_type == "demo" else get_paid_plan_payload(db, data=data).get("currency"),
        "is_unlimited_employees": employee_limit is None,
        "is_sds_company": plan_type == "lifetime" and tenant_id == current_app.config.get("SDS_TENANT_ID", "sds"),
        "is_lifetime": plan_type == "lifetime",
        "is_demo_company": plan_type == "demo",
        "is_paid_company": plan_type == "paid",
        "created_at": now(),
        "updated_at": now(),
        "created_by": str(g.current_user["_id"]),
        "is_deleted": False,
    }

    db.tenants.insert_one(doc)
    seed_company_masters(db, tenant_id)
    update_tenant_subscription_record(db, doc)

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
        emp_doc["identity_alias_keys"] = employee_identity_alias_keys(emp_doc)

        try:
            emp_res = db.employees.insert_one(emp_doc)
        except DuplicateKeyError:
            db.users.delete_one({"_id": user_res.inserted_id})
            return jsonify({
                "message": "Company created, but its admin employee ID/code conflicts with another active employee"
            }), 409

        created_emp = db.employees.find_one({"_id": emp_res.inserted_id})

        if created_emp:
            user_update = {
                "employee_id": str(created_emp["_id"]),
                "employee_ref_id": str(created_emp["_id"]),
                "emp_code": created_emp.get("employee_id") or created_emp.get("employee_code") or created_emp.get("emp_code") or "",
                "employee_code": created_emp.get("employee_id") or created_emp.get("employee_code") or created_emp.get("emp_code") or "",
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

    existing = find_tenant_for_superadmin(db, tenant_id)

    if not existing:
        return jsonify({"message": "Company not found"}), 404

    if "plan_type" in data or "plan" in data:
        data["plan_type"] = normalize_plan_type(data.get("plan_type") or data.get("plan"), existing.get("plan_type") or "paid")
        data["allowed_modules"] = configured_trial_allowed_modules() if data["plan_type"] == "demo" else normalize_allowed_modules(data.get("allowed_modules"), data["plan_type"])
        data["is_lifetime"] = data["plan_type"] == "lifetime"
        data["is_demo_company"] = data["plan_type"] == "demo"
        data["is_paid_company"] = data["plan_type"] == "paid"

        if data["plan_type"] == "demo":
            trial_start = existing.get("trial_start_date") or now()
            data.update({
                "plan": configured_trial_plan_name(),
                "plan_code": "trial",
                "plan_name": configured_trial_plan_name(),
                "plan_label": configured_trial_plan_name(),
                "billing_interval": "trial",
                "plan_amount": 0,
                "employee_limit": configured_trial_employee_limit(),
                "is_unlimited_employees": configured_trial_employee_limit() is None,
                "demo_duration_days": configured_trial_days(),
                "demo_has_full_access": config_bool("DEMO_HAS_FULL_ACCESS", True),
                "requires_payment": False,
                "trial_start_date": trial_start,
                "trial_end_date": existing.get("trial_end_date") or (trial_start + timedelta(days=configured_trial_days())),
                "subscription_status": "demo",
                "trial_status": "active",
            })
        elif data["plan_type"] == "paid":
            paid_plan = get_paid_plan_payload(db, data=data, tenant=existing)
            data.update({
                "plan": paid_plan.get("plan_name"),
                "plan_code": paid_plan.get("plan_code"),
                "plan_name": paid_plan.get("plan_name"),
                "plan_label": paid_plan.get("plan_label"),
                "billing_interval": paid_plan.get("billing_interval"),
                "plan_amount": paid_plan.get("amount"),
                "currency": paid_plan.get("currency"),
                "employee_limit": paid_plan.get("employee_limit"),
                "is_unlimited_employees": paid_plan.get("is_unlimited_employees"),
                "demo_has_full_access": False,
                "requires_payment": False,
                "subscription_status": "active",
                "trial_status": "converted_to_paid",
            })

    if "status" in data:
        data["status"] = normalize_company_status(data.get("status"), existing.get("status") or "active")

    if "company_name" not in data and data.get("name"):
        data["company_name"] = normalize_text(data.get("name"))

    if "company_email" not in data and data.get("contact_email"):
        data["company_email"] = normalize_email(data.get("contact_email"))

    if "contact_email" not in data and data.get("company_email"):
        data["contact_email"] = normalize_email(data.get("company_email"))

    data["updated_at"] = now()
    data["updated_by"] = str(g.current_user["_id"])

    db.tenants.update_one({"_id": existing["_id"]}, {"$set": data})
    updated = db.tenants.find_one({"_id": existing["_id"]})
    update_tenant_subscription_record(db, updated)

    audit("update_company", "tenants", tenant_id, data)

    return jsonify({
        "message": "Company updated",
        "item": clean_doc(enrich_tenant_for_superadmin(db, updated)),
    })


@superadmin_bp.get("/companies/<tenant_id>")
@roles_required("super_admin")
def get_company_detail(tenant_id):
    db = get_db()
    tenant = find_tenant_for_superadmin(db, tenant_id)

    if not tenant:
        return jsonify({"message": "Company not found"}), 404

    tenant_id_value = tenant.get("tenant_id")

    recent_payments = list(
        db.payments.find({
            "tenant_id": tenant_id_value,
            "is_deleted": {"$ne": True},
        }).sort("created_at", -1).limit(10)
    )

    recent_subscriptions = list(
        db.subscriptions.find({
            "tenant_id": tenant_id_value,
            "is_deleted": {"$ne": True},
        }).sort("created_at", -1).limit(10)
    )

    latest_demo_request = db.demo_requests.find_one(
        {
            "$or": [
                {"generated_tenant_id": tenant_id_value},
                {"tenant_id": tenant_id_value},
                {"company_email": tenant.get("company_email") or tenant.get("contact_email")},
            ],
            "is_deleted": {"$ne": True},
        },
        sort=[("created_at", -1)],
    )

    return jsonify({
        "item": clean_doc(enrich_tenant_for_superadmin(db, tenant)),
        "payments": clean_doc(recent_payments),
        "subscriptions": clean_doc(recent_subscriptions),
        "demo_request": clean_doc(latest_demo_request),
    })


@superadmin_bp.post("/companies/<tenant_id>/activate")
@roles_required("super_admin")
def activate_company(tenant_id):
    db = get_db()
    tenant = find_tenant_for_superadmin(db, tenant_id)

    if not tenant:
        return jsonify({"message": "Company not found"}), 404

    update = {
        "status": "active",
        "updated_at": now(),
        "updated_by": str(g.current_user["_id"]),
    }

    if tenant.get("plan_type") == "demo":
        update["trial_status"] = "active"
        update["subscription_status"] = "demo"
    elif tenant.get("plan_type") == "lifetime":
        update["subscription_status"] = "lifetime"
    else:
        update["subscription_status"] = "active"

    db.tenants.update_one({"_id": tenant["_id"]}, {"$set": update})
    updated = db.tenants.find_one({"_id": tenant["_id"]})
    update_tenant_subscription_record(db, updated)

    audit("activate_company", "tenants", tenant.get("tenant_id"), update)

    return jsonify({
        "message": "Company activated",
        "item": clean_doc(enrich_tenant_for_superadmin(db, updated)),
    })


@superadmin_bp.post("/companies/<tenant_id>/suspend")
@roles_required("super_admin")
def suspend_company(tenant_id):
    db = get_db()
    data = request.get_json(silent=True) or {}
    tenant = find_tenant_for_superadmin(db, tenant_id)

    if not tenant:
        return jsonify({"message": "Company not found"}), 404

    if is_sds_tenant(tenant, current_app.config):
        return jsonify({"message": "SDS lifetime company cannot be suspended."}), 400

    update = {
        "status": "suspended",
        "suspension_reason": normalize_text(data.get("reason")),
        "suspended_at": now(),
        "suspended_by": str(g.current_user["_id"]),
        "updated_at": now(),
        "updated_by": str(g.current_user["_id"]),
    }

    db.tenants.update_one({"_id": tenant["_id"]}, {"$set": update})
    updated = db.tenants.find_one({"_id": tenant["_id"]})
    update_tenant_subscription_record(db, updated)

    audit("suspend_company", "tenants", tenant.get("tenant_id"), update)

    return jsonify({
        "message": "Company suspended",
        "item": clean_doc(enrich_tenant_for_superadmin(db, updated)),
    })


@superadmin_bp.post("/companies/<tenant_id>/extend-demo")
@roles_required("super_admin")
def extend_company_demo(tenant_id):
    db = get_db()
    data = request.get_json(silent=True) or {}
    tenant = find_tenant_for_superadmin(db, tenant_id)

    if not tenant:
        return jsonify({"message": "Company not found"}), 404

    if tenant.get("plan_type") != "demo":
        return jsonify({"message": "Trial can be extended only for trial companies."}), 400

    days = int(data.get("days") or data.get("extend_days") or 7)

    if days <= 0:
        return jsonify({"message": "Extension days must be greater than 0."}), 400

    if days > 365:
        return jsonify({"message": "Extension days cannot exceed 365 days."}), 400

    current_end = tenant.get("trial_end_date")

    if isinstance(current_end, str):
        try:
            current_end = datetime.fromisoformat(current_end.replace("Z", "+00:00"))
        except Exception:
            current_end = None

    base_date = current_end if isinstance(current_end, datetime) and current_end > now() else now()
    new_end_date = base_date + timedelta(days=days)

    update = {
        "status": "active",
        "trial_status": "active",
        "subscription_status": "demo",
        "trial_end_date": new_end_date,
        "last_demo_extension_days": days,
        "last_demo_extension_reason": normalize_text(data.get("reason")),
        "last_demo_extended_at": now(),
        "last_demo_extended_by": str(g.current_user["_id"]),
        "last_trial_extension_days": days,
        "last_trial_extension_reason": normalize_text(data.get("reason")),
        "last_trial_extended_at": now(),
        "last_trial_extended_by": str(g.current_user["_id"]),
        "requires_payment": False,
        "demo_has_full_access": config_bool("DEMO_HAS_FULL_ACCESS", True),
        "allowed_modules": configured_trial_allowed_modules(),
        "updated_at": now(),
        "updated_by": str(g.current_user["_id"]),
    }

    db.tenants.update_one({"_id": tenant["_id"]}, {"$set": update})

    db.trial_notifications.update_many(
        {
            "tenant_id": tenant.get("tenant_id"),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "is_deleted": True,
                "deleted_reason": "trial_extended",
                "updated_at": now(),
            }
        },
    )

    updated = db.tenants.find_one({"_id": tenant["_id"]})
    update_tenant_subscription_record(db, updated)

    audit("extend_demo", "tenants", tenant.get("tenant_id"), update)

    return jsonify({
        "message": f"Trial extended by {days} days",
        "item": clean_doc(enrich_tenant_for_superadmin(db, updated)),
    })


@superadmin_bp.post("/companies/<tenant_id>/mark-paid")
@roles_required("super_admin")
def mark_company_paid(tenant_id):
    db = get_db()
    data = request.get_json(silent=True) or {}
    tenant = find_tenant_for_superadmin(db, tenant_id)

    if not tenant:
        return jsonify({"message": "Company not found"}), 404

    paid_plan = get_paid_plan_payload(db, data=data, tenant=tenant)
    amount = normalize_float(data.get("amount"), paid_plan.get("amount", 4495.0))
    start_date = now()
    duration_days = int(data.get("duration_days") or 30)
    end_date = start_date + timedelta(days=duration_days) if duration_days > 0 else None

    update = {
        "status": "active",
        "plan": paid_plan.get("plan_name"),
        "plan_code": paid_plan.get("plan_code"),
        "plan_name": paid_plan.get("plan_name"),
        "plan_label": paid_plan.get("plan_label"),
        "plan_type": "paid",
        "billing_interval": paid_plan.get("billing_interval"),
        "plan_amount": amount,
        "currency": paid_plan.get("currency"),
        "subscription_status": "active",
        "trial_status": "converted_to_paid",
        "subscription_start_date": start_date,
        "subscription_end_date": end_date,
        "employee_limit": paid_plan.get("employee_limit"),
        "is_unlimited_employees": paid_plan.get("is_unlimited_employees"),
        "allowed_modules": ["all"],
        "demo_has_full_access": False,
        "requires_payment": False,
        "is_demo_company": False,
        "is_paid_company": True,
        "is_lifetime": False,
        "manual_paid_amount": amount,
        "manual_paid_reason": normalize_text(data.get("reason")),
        "manual_paid_at": now(),
        "manual_paid_by": str(g.current_user["_id"]),
        "updated_at": now(),
        "updated_by": str(g.current_user["_id"]),
    }

    db.tenants.update_one({"_id": tenant["_id"]}, {"$set": update})
    updated = db.tenants.find_one({"_id": tenant["_id"]})
    update_tenant_subscription_record(db, updated)

    db.payments.insert_one({
        "tenant_id": updated.get("tenant_id"),
        "company_id": updated.get("tenant_id"),
        "tenant_code": updated.get("tenant_code"),
        "company_name": updated.get("company_name") or updated.get("name"),
        "company_email": updated.get("company_email") or updated.get("contact_email"),
        "plan_code": paid_plan.get("plan_code"),
        "plan_name": paid_plan.get("plan_name"),
        "plan_label": paid_plan.get("plan_label"),
        "employee_limit": paid_plan.get("employee_limit"),
        "is_unlimited_employees": paid_plan.get("is_unlimited_employees"),
        "amount": amount,
        "currency": paid_plan.get("currency") or current_app.config.get("RAZORPAY_CURRENCY", "INR"),
        "status": "paid",
        "payment_status": "manual_paid",
        "payment_method": "manual_superadmin",
        "note": normalize_text(data.get("reason")),
        "created_at": now(),
        "created_by": str(g.current_user["_id"]),
        "is_deleted": False,
    })

    audit("mark_company_paid", "tenants", tenant.get("tenant_id"), update)

    return jsonify({
        "message": "Company marked as paid. Selected plan access and employee limit applied.",
        "item": clean_doc(enrich_tenant_for_superadmin(db, updated)),
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
            user["employee_code"] = employee_code(emp)
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

    emp["identity_alias_keys"] = employee_identity_alias_keys(emp)

    try:
        emp_res = db.employees.insert_one(emp)
    except DuplicateKeyError:
        db.users.delete_one({"_id": user_res.inserted_id})
        return jsonify({
            "message": "Employee ID/code is already assigned to another active employee in this company"
        }), 409
    created_emp = db.employees.find_one({"_id": emp_res.inserted_id})

    if created_emp:
        user_update = {
            "employee_id": str(created_emp["_id"]),
            "employee_ref_id": str(created_emp["_id"]),
            "emp_code": employee_code(created_emp),
            "employee_code": employee_code(created_emp),
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

        try:
            db.users.update_one({"_id": user_obj_id}, {"$set": user_update})
        except DuplicateKeyError:
            return jsonify({
                "message": "User email or employee code conflicts with another active user in this company"
            }), 409

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

    for identity_field in EMPLOYEE_IDENTITY_FIELDS:
        if identity_field not in data:
            emp_update.pop(identity_field, None)

    if incoming_photo:
        apply_profile_photo_aliases(emp_update, incoming_photo)

    if "name" in user_update:
        emp_update["name"] = user_update["name"]
        emp_update["employee_name"] = user_update["name"]

    if "email" in user_update:
        emp_update["email"] = user_update["email"]

    if "tenant_id" in user_update:
        emp_update["tenant_id"] = user_update["tenant_id"]

    identity_candidate = dict(existing_emp or {})
    identity_candidate.update(emp_update)
    identity_candidate.setdefault("tenant_id", tenant_for_lookup)
    identity_candidate["identity_alias_keys"] = employee_identity_alias_keys(identity_candidate)

    identity_conflict = employee_identity_conflict(
        db,
        identity_candidate,
        exclude_employee_id=existing_emp.get("_id") if existing_emp else None,
    )

    if identity_conflict:
        if user_update:
            db.users.replace_one({"_id": user_obj_id}, existing_user)

        return jsonify({
            "message": "Employee ID/code is already assigned to another active employee in this company"
        }), 409

    emp_update["identity_alias_keys"] = identity_candidate["identity_alias_keys"]

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

            try:
                db.employees.update_one(
                    {"_id": existing_emp["_id"]},
                    {"$set": emp_update},
                )
            except DuplicateKeyError:
                if user_update:
                    db.users.replace_one({"_id": user_obj_id}, existing_user)

                return jsonify({
                    "message": "Employee ID/code is already assigned to another active employee in this company"
                }), 409

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

            emp_update["identity_alias_keys"] = employee_identity_alias_keys(emp_update)

            try:
                res = db.employees.insert_one(emp_update)
            except DuplicateKeyError:
                if user_update:
                    db.users.replace_one({"_id": user_obj_id}, existing_user)

                return jsonify({
                    "message": "Employee ID/code is already assigned to another active employee in this company"
                }), 409

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
        refreshed["employee_code"] = employee_code(employee_profile)
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
            user["employee_code"] = employee_code(emp)
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

    emp["identity_alias_keys"] = employee_identity_alias_keys(emp)

    try:
        emp_res = db.employees.insert_one(emp)
    except DuplicateKeyError:
        db.users.delete_one({"_id": user_res.inserted_id})
        return jsonify({
            "message": "Employee ID/code is already assigned to another active employee in this company"
        }), 409
    created_emp = db.employees.find_one({"_id": emp_res.inserted_id})

    if created_emp:
        user_update = {
            "employee_id": str(created_emp["_id"]),
            "employee_ref_id": str(created_emp["_id"]),
            "emp_code": employee_code(created_emp),
            "employee_code": employee_code(created_emp),
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

    attendance_id = normalize_text(request.args.get("attendance_id"))
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

    record_query = {
        "tenant_id": tenant_id,
        "date": attendance_date,
        "$or": [
            {"employee_ref_id": {"$in": identity_values}},
            {"employee_id": {"$in": identity_values}},
            {"user_id": {"$in": identity_values}},
            {"email": {"$in": identity_values}},
        ],
    }

    if attendance_id:
        attendance_obj_id = safe_object_id(attendance_id)

        if not attendance_obj_id:
            return jsonify({"message": "Invalid attendance record id"}), 400

        record_query["_id"] = attendance_obj_id

    record = db.attendance_logs.find_one(
        record_query,
        sort=[("updated_at", -1), ("created_at", -1)],
    )

    return jsonify({
        "employee": superadmin_attendance_employee_payload(employee),
        "record": superadmin_attendance_record_payload(record),
    })


@superadmin_bp.post("/private-attendance-corrections/update")
@roles_required("super_admin")
def private_attendance_correction_update():
    db = get_db()
    data = request.get_json(silent=True) or {}

    attendance_id = normalize_text(data.get("attendance_id"))
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

        # The private Super Admin tool may correct overnight attendance.
        # A time earlier than check-in is treated as check-out on the next day,
        # rather than being blocked by the normal same-day attendance rule.
        if check_out_at < check_in_at:
            check_out_at += timedelta(days=1)

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

    attendance_identity_query = {
        "tenant_id": tenant_id,
        "date": attendance_date,
        "$or": [
            {"employee_ref_id": {"$in": identity_values}},
            {"employee_id": {"$in": identity_values}},
            {"user_id": {"$in": identity_values}},
            {"email": {"$in": identity_values}},
        ],
    }

    existing = None

    if attendance_id:
        attendance_obj_id = safe_object_id(attendance_id)

        if not attendance_obj_id:
            return jsonify({"message": "Invalid attendance record id"}), 400

        existing = db.attendance_logs.find_one({
            **attendance_identity_query,
            "_id": attendance_obj_id,
        })

        if not existing:
            return jsonify({
                "message": "The selected attendance record no longer exists. Reload it and try again."
            }), 404
    else:
        existing = db.attendance_logs.find_one(
            attendance_identity_query,
            sort=[("updated_at", -1), ("created_at", -1)],
        )

    status = build_attendance_status(check_in_at, check_out_at)
    is_holiday_work = bool(existing and truthy(existing.get("is_holiday_work")))
    is_late = check_in_at.time() >= time(9, 50) and not is_holiday_work
    is_early_checkout = bool(
        check_out_at
        and check_out_at.date() == check_in_at.date()
        and check_out_at.time() < time(18, 0)
        and not is_holiday_work
    )

    if is_holiday_work:
        status = "holiday_work"

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
        "is_late": is_late,
        "is_early_checkout": is_early_checkout,
        "is_holiday_work": is_holiday_work,
        "office_start": "09:30",
        "late_cutoff": "09:50",
        "office_end": "18:00",
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

    update_payload["timeline"] = build_private_correction_timeline(
        existing,
        check_in_at,
        check_out_at,
        parsed_check_in_location,
        parsed_check_out_location,
        correction_reason,
    )

    old_payload = superadmin_attendance_record_payload(existing)

    if existing:
        update_result = db.attendance_logs.update_one(
            {"_id": existing["_id"]},
            {"$set": update_payload},
        )

        if update_result.matched_count != 1:
            return jsonify({"message": "Attendance record could not be updated"}), 409

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

    if not updated:
        return jsonify({"message": "Saved attendance record could not be reloaded"}), 500

    verified_check_in = get_attendance_datetime(updated, "check_in")
    verified_check_out = get_attendance_datetime(updated, "check_out")

    if verified_check_in != check_in_at or verified_check_out != check_out_at:
        return jsonify({"message": "Attendance correction could not be verified after saving"}), 500

    correction_audit_saved = True

    try:
        db.attendance_private_corrections.insert_one({
            "tenant_id": tenant_id,
            "attendance_id": str(attendance_id),
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
    except Exception:
        # The attendance record has already been saved and verified. A secondary
        # audit-collection problem must not make the UI report that saving failed.
        correction_audit_saved = False
        audit(
            "private_attendance_correction_audit_fallback",
            "attendance_logs",
            attendance_id,
            {
                "tenant_id": tenant_id,
                "employee_ref_id": str(employee["_id"]),
                "date": attendance_date,
                "reason": correction_reason,
            },
        )

    return jsonify({
        "message": "Attendance correction saved successfully",
        "record": superadmin_attendance_record_payload(updated),
        "audit_logged": correction_audit_saved,
    })
