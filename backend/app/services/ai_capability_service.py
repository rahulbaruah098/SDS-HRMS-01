import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from bson import ObjectId

from app.extensions import get_db
from app.ai_knowledge.role_profiles import (
    build_role_subscription_guidance,
    derive_effective_ai_roles,
    normalise_roles,
    resolve_primary_role,
    resolve_subscription_profile,
)


SAYA_CAPABILITY_SERVICE_VERSION = "2026-09-04-TENANT-SAFE-LIVE-CONTEXT-R2"

def _now_utc():
    return datetime.now(timezone.utc)


def _safe_str(value):
    return str(value or "").strip()


def _lower(value):
    return _safe_str(value).lower()


def _as_object_id(value):
    try:
        if value and ObjectId.is_valid(str(value)):
            return ObjectId(str(value))
    except Exception:
        return None
    return None


def _id_variants(value):
    variants = []

    text = _safe_str(value)
    if text:
        variants.append(text)

    oid = _as_object_id(text)
    if oid:
        variants.append(oid)

    return variants


def _tenant_values(user_context=None):
    tenant_id = None

    if user_context:
        tenant_id = user_context.get("tenant_id")

    values = _id_variants(tenant_id)

    if not values and tenant_id:
        values.append(tenant_id)

    return values


def _user_values(user_context=None):
    values = []

    if not user_context:
        return values

    possible_ids = [
        user_context.get("user_id"),
        user_context.get("_id"),
        user_context.get("employee_id"),
        user_context.get("employee_user_id"),
    ]

    for item in possible_ids:
        for variant in _id_variants(item):
            if variant not in values:
                values.append(variant)

    return values


def _employee_values(user_context=None):
    values = []

    if not user_context:
        return values

    possible_ids = [
        user_context.get("employee_id"),
        user_context.get("employee_profile_id"),
        user_context.get("employee_summary_id"),
        user_context.get("user_id"),
    ]

    employee = user_context.get("employee") or {}

    if isinstance(employee, dict):
        possible_ids.extend([
            employee.get("_id"),
            employee.get("id"),
            employee.get("employee_id"),
            employee.get("user_id"),
        ])

    for item in possible_ids:
        for variant in _id_variants(item):
            if variant not in values:
                values.append(variant)

    return values


def _tenant_query(user_context=None):
    values = _tenant_values(user_context)

    if not values:
        return {}

    return {
        "$or": [
            {"tenant_id": {"$in": values}},
            {"company_id": {"$in": values}},
            {"tenant": {"$in": values}},
        ]
    }




def _private_live_context_unavailable(title, reason="scope"):
    """Return a non-sensitive capability block when live scope cannot be proven."""

    if reason == "tenant":
        message = (
            "Saya could not establish the current tenant scope for this private HRMS data. "
            "No live record was retrieved."
        )
    elif reason == "identity":
        message = (
            "Saya could not securely map this login to an employee identity for this private HRMS data. "
            "No live record was retrieved."
        )
    else:
        message = (
            "Saya could not establish a sufficiently narrow access scope for this private HRMS data. "
            "No live record was retrieved."
        )

    return {
        "title": title,
        "content": message,
    }


def _private_person_values(user_context=None):
    employee_values = _employee_values(user_context)
    user_values = _user_values(user_context)
    return employee_values + [
        item for item in user_values
        if item not in employee_values
    ]


def _normalise_module_list(modules):
    if isinstance(modules, str):
        modules = [item.strip() for item in modules.split(",") if item.strip()]

    if not isinstance(modules, list):
        return []

    return sorted({
        _lower(item).replace("-", "_").replace(" ", "_")
        for item in modules
        if _safe_str(item)
    })


def _safe_doc(doc):
    """Return a recursively sanitized copy of an HRMS document for Saya."""

    if not doc:
        return {}

    blocked_exact_keys = {
        "password",
        "password_hash",
        "hashed_password",
        "secret",
        "client_secret",
        "private_key",
        "private_key_id",
        "jwt",
        "token",
        "auth_token",
        "api_key",
        "refresh_token",
        "reset_token",
        "access_token",
        "id_token",
        "otp",
        "otp_code",
        "otp_hash",
        "razorpay_signature",
        "payment_signature",
        "firebase_private_key",
        "service_account",
    }

    blocked_key_fragments = (
        "password",
        "secret",
        "private_key",
        "api_key",
        "refresh_token",
        "reset_token",
        "access_token",
        "auth_token",
        "otp_",
        "_otp",
        "signature",
    )

    def sanitize(value, key=""):
        key_lower = _safe_str(key).lower()

        if key_lower in blocked_exact_keys:
            return None, False

        if any(fragment in key_lower for fragment in blocked_key_fragments):
            return None, False

        if isinstance(value, ObjectId):
            return str(value), True

        if isinstance(value, datetime):
            return value.isoformat(), True

        if isinstance(value, dict):
            cleaned_dict = {}
            for nested_key, nested_value in value.items():
                safe_value, include = sanitize(nested_value, nested_key)
                if not include:
                    continue
                output_key = "id" if nested_key == "_id" else nested_key
                cleaned_dict[output_key] = safe_value
                if nested_key == "_id":
                    cleaned_dict["_id"] = safe_value
            return cleaned_dict, True

        if isinstance(value, (list, tuple, set)):
            cleaned_items = []
            for item in value:
                safe_value, include = sanitize(item, key)
                if include:
                    cleaned_items.append(safe_value)
            return cleaned_items, True

        return value, True

    cleaned, included = sanitize(dict(doc))
    return cleaned if included and isinstance(cleaned, dict) else {}



def _normalise_match_text(value):
    """Normalize user text for boundary-safe phrase matching."""

    text = _lower(value)
    text = text.replace("_", " ").replace("-", " ")
    return re.sub(r"\s+", " ", text).strip()


def _keyword_in_text(question, keyword):
    """Match a complete word/phrase instead of an arbitrary substring.

    This prevents short workflow terms such as ``ro``, ``cl``, and ``report``
    from matching unrelated words such as ``growth``, ``client``, and
    ``reporting``. Multi-word phrases still tolerate repeated whitespace.
    """

    text = _normalise_match_text(question)
    phrase = _normalise_match_text(keyword)

    if not text or not phrase:
        return False

    escaped_phrase = re.escape(phrase).replace(r"\ ", r"\s+")
    pattern = rf"(?<![a-z0-9]){escaped_phrase}(?![a-z0-9])"
    return re.search(pattern, text) is not None


def _contains_any(question, keywords):
    return any(_keyword_in_text(question, keyword) for keyword in keywords)


def _date_range(period):
    now = _now_utc()

    if period == "week":
        start = now - timedelta(days=7)
    elif period == "year":
        start = now - timedelta(days=365)
    else:
        start = now - timedelta(days=30)

    return start, now


def detect_ai_capabilities(question):
    """
    Detect the read-only live context that may help Saya answer the question.

    Capability detection never grants access. Role, tenant, capability, and
    subscription checks are applied separately before any context is returned.
    """

    capabilities = set()
    text = _lower(question)

    if _contains_any(text, [
        "tenant",
        "company",
        "organisation",
        "organization",
        "which company",
        "company details",
        "tenant details",
        "where is my company",
        "which tenant",
    ]):
        capabilities.add("tenant_profile")

    if _contains_any(text, [
        "pricing",
        "price",
        "plan price",
        "plan cost",
        "subscription cost",
        "how much is essential",
        "how much is growth",
        "how much is premium",
        "essential plan",
        "growth plan",
        "premium plan",
        "compare plans",
        "which plan",
        "employee limit",
        "included employees",
    ]):
        capabilities.add("pricing_plans")

    if _contains_any(text, [
        "my subscription",
        "subscription status",
        "current subscription",
        "current plan",
        "my plan",
        "trial status",
        "trial days",
        "days left",
        "subscription days",
        "subscription expiry",
        "subscription expired",
        "renewal",
        "renew my plan",
        "upgrade",
        "upgrade plan",
        "billing status",
        "payment required",
        "employee limit",
        "allowed modules",
        "enabled modules",
    ]):
        capabilities.add("subscription_summary")

    if _contains_any(text, [
        "premium request",
        "premium quote",
        "premium quotation",
        "quoted amount",
        "quotation amount",
        "quotation status",
        "contact sales",
        "premium payment",
        "premium activation",
        "premium renewal",
        "upgrade to premium",
        "upgrade premium",
    ]):
        capabilities.add("premium_quotation")

    if _contains_any(text, ["weather", "temperature", "rain", "forecast"]):
        capabilities.add("weather")

    if _contains_any(text, ["notification", "notifications", "alerts", "unread"]):
        capabilities.add("notifications")

    if _contains_any(text, [
        "leave status",
        "approved my leave",
        "approve my leave",
        "team leader approved",
        "team leader approve",
        "tl approved",
        "tl approve",
        "reporting officer approved",
        "reporting officer approve",
        "ro approved",
        "ro approve",
        "my leave application",
        "where is my leave",
        "is my leave approved",
        "leave request status",
        "latest leave",
    ]):
        capabilities.add("leave_status")

    # Leave balance is private live data. Retrieve it only when the employee
    # explicitly asks about balance/remaining entitlement. Merely mentioning a
    # leave type or asking to apply for leave must not attach balances to the AI
    # context; the guided action service validates balance internally instead.
    if _contains_any(text, [
        "cl left",
        "casual leave left",
        "casual leaves left",
        "el left",
        "earned leave left",
        "earned leaves left",
        "leave balance",
        "leave balances",
        "casual leave balance",
        "earned leave balance",
        "cl balance",
        "el balance",
        "remaining casual leave",
        "remaining casual leaves",
        "remaining earned leave",
        "remaining earned leaves",
        "remaining cl",
        "remaining el",
        "how many casual leave",
        "how many casual leaves",
        "how many earned leave",
        "how many earned leaves",
        "how many cl",
        "how many el",
    ]):
        capabilities.add("leave_balance")

    if _contains_any(text, [
        "my assets",
        "asset assigned",
        "assets assigned",
        "how many assets",
        "employee asset",
    ]):
        capabilities.add("assets")

    if _contains_any(text, [
        "late",
        "on time",
        "attendance summary",
        "how many days present",
        "how many days absent",
        "office on time",
    ]):
        capabilities.add("attendance_summary")

    if _contains_any(text, [
        "performance",
        "weekly performance",
        "monthly performance",
        "yearly performance",
        "this week performance",
    ]):
        capabilities.add("performance_summary")

    # Project records are fetched only for an explicit live-project request.
    # Do not use bare "project"/"projects" as triggers: a general question such
    # as "how does project handover work?" should receive workflow guidance, not
    # an unsolicited dump of the employee's project names.
    if _contains_any(text, [
        "project list",
        "projects list",
        "department projects",
        "list project",
        "list projects",
        "list my projects",
        "list all projects",
        "show project",
        "show projects",
        "show my projects",
        "show all projects",
        "state my projects",
        "state all projects",
        "my project",
        "my projects",
        "assigned project",
        "assigned projects",
        "projects of department",
        "what are my projects",
        "what projects am i working on",
        "which projects am i working on",
        "which projects do i have",
        "project status",
        "project progress",
        "task progress",
    ]):
        capabilities.add("projects")

    # Team data follows the same progressive-disclosure rule. It is attached
    # only when the user explicitly asks for team/Reporting Officer/Team Leader
    # information or asks who is available for handover.
    if _contains_any(text, [
        "team member",
        "team members",
        "my team",
        "team list",
        "show team members",
        "show my team members",
        "list team members",
        "list my team members",
        "state my team member",
        "state my team members",
        "team member name",
        "team member names",
        "who is in my team",
        "who are my team members",
        "who can i handover to",
        "who can i hand over to",
        "whom can i handover to",
        "whom can i hand over to",
        "handover options",
        "handover employees",
        "reporting officer",
        "my reporting officer",
        "ro",
        "team leader",
        "my team leader",
        "tl",
        "department team",
    ]):
        capabilities.add("team_scope")

    return sorted(capabilities)

def get_tenant_profile_context(user_context=None):
    """
    Builds safe tenant/company context for the AI assistant.
    This does not expose secrets or private configuration.
    """

    tenant = {}

    if isinstance(user_context, dict):
        tenant = user_context.get("tenant") or {}

    if not isinstance(tenant, dict):
        tenant = {}

    tenant_name = (
        tenant.get("name")
        or tenant.get("company_name")
        or tenant.get("tenant_name")
        or (user_context or {}).get("tenant_name")
        or "Current HRMS Tenant"
    )

    city = (
        tenant.get("city")
        or tenant.get("district")
        or ""
    )

    state = (
        tenant.get("state")
        or tenant.get("state_name")
        or ""
    )

    address = (
        tenant.get("address")
        or tenant.get("office_address")
        or ""
    )

    organisation_code = (
        tenant.get("code")
        or tenant.get("company_code")
        or tenant.get("tenant_code")
        or ""
    )

    location_parts = [part for part in [city, state] if part]
    location_text = ", ".join(location_parts) if location_parts else "Location not configured"

    return {
        "title": "Tenant Profile",
        "content": (
            f"Tenant/Company Name: {tenant_name}\n"
            f"Tenant Code: {organisation_code or 'Not configured'}\n"
            f"Location: {location_text}\n"
            f"Address: {address or 'Not configured'}"
        )
    }


def get_tenant_weather_context(user_context=None):
    """
    Weather source:
    1. WEATHER_LAT and WEATHER_LON from backend .env
    2. Tenant/company document latitude/longitude if present
    """

    db = get_db()

    city = os.getenv("WEATHER_CITY", "Configured Location")
    lat = os.getenv("WEATHER_LAT")
    lon = os.getenv("WEATHER_LON")

    if not lat or not lon:
        tenant_values = _tenant_values(user_context)
        tenant_doc = None

        if tenant_values:
            tenant_doc = (
                db.companies.find_one({"_id": {"$in": tenant_values}})
                or db.companies.find_one({"tenant_id": {"$in": tenant_values}})
                or db.tenants.find_one({"_id": {"$in": tenant_values}})
                or db.tenants.find_one({"tenant_id": {"$in": tenant_values}})
            )

        if tenant_doc:
            city = (
                tenant_doc.get("city")
                or tenant_doc.get("state")
                or tenant_doc.get("name")
                or city
            )
            lat = tenant_doc.get("latitude") or tenant_doc.get("lat")
            lon = tenant_doc.get("longitude") or tenant_doc.get("lon") or tenant_doc.get("lng")

    if not lat or not lon:
        return {
            "title": "Weather",
            "content": (
                "Weather is not configured yet. Add WEATHER_CITY, WEATHER_LAT, "
                "and WEATHER_LON in backend .env, or save latitude/longitude in tenant/company details."
            )
        }

    try:
        params = urllib.parse.urlencode({
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
            "timezone": "auto",
        })

        url = f"https://api.open-meteo.com/v1/forecast?{params}"

        with urllib.request.urlopen(url, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))

        current = payload.get("current") or {}

        temperature = current.get("temperature_2m")
        humidity = current.get("relative_humidity_2m")
        rain = current.get("precipitation")
        wind = current.get("wind_speed_10m")

        return {
            "title": "Weather",
            "content": (
                f"Weather for {city}: "
                f"Temperature {temperature}°C, "
                f"Humidity {humidity}%, "
                f"Precipitation {rain} mm, "
                f"Wind speed {wind} km/h."
            )
        }

    except Exception:
        return {
            "title": "Weather",
            "content": "Weather could not be fetched right now. Please try again shortly."
        }




def get_notifications_context(user_context=None, limit=8):
    db = get_db()

    tenant_filter = _tenant_query(user_context)
    if not tenant_filter:
        return _private_live_context_unavailable("Notifications", reason="tenant")

    user_values = _user_values(user_context)

    recipient_or = [
        {"audience": "all"},
        {"target": "all"},
    ]

    if user_values:
        recipient_or.extend([
            {"user_id": {"$in": user_values}},
            {"recipient_id": {"$in": user_values}},
            {"target_user_id": {"$in": user_values}},
            {"created_for": {"$in": user_values}},
        ])

    query = {
        "$and": [
            tenant_filter,
            {"$or": recipient_or},
        ]
    }

    docs = list(
        db.notifications
        .find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
    )

    if not docs:
        return {
            "title": "Notifications",
            "content": "No recent notifications were found for this user."
        }

    lines = []

    for index, doc in enumerate(docs, start=1):
        title = doc.get("title") or doc.get("subject") or "Notification"
        message = doc.get("message") or doc.get("body") or doc.get("description") or ""
        status = "read" if doc.get("is_read") or doc.get("read") else "unread"

        lines.append(f"{index}. {title} - {message} ({status})")

    return {
        "title": "Notifications",
        "content": "\n".join(lines)
    }




def get_leave_status_context(user_context=None, limit=5):
    db = get_db()

    tenant_filter = _tenant_query(user_context)
    if not tenant_filter:
        return _private_live_context_unavailable("Leave Status", reason="tenant")

    person_values = _private_person_values(user_context)
    if not person_values:
        return _private_live_context_unavailable("Leave Status", reason="identity")

    query = {
        "$and": [
            tenant_filter,
            {
                "$or": [
                    {"employee_id": {"$in": person_values}},
                    {"user_id": {"$in": person_values}},
                    {"created_by": {"$in": person_values}},
                    {"applicant_id": {"$in": person_values}},
                ]
            },
        ]
    }

    docs = list(
        db.leave_requests
        .find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
    )

    if not docs:
        return {
            "title": "Leave Status",
            "content": "No recent leave requests were found for this user."
        }

    lines = []

    for index, doc in enumerate(docs, start=1):
        leave_type = (
            doc.get("leave_type_label")
            or doc.get("leave_type")
            or doc.get("type")
            or "Leave"
        )

        status = doc.get("status") or doc.get("approval_status") or "Pending"
        start_date = doc.get("start_date") or doc.get("from_date") or doc.get("date_from") or ""
        end_date = doc.get("end_date") or doc.get("to_date") or doc.get("date_to") or ""
        approval_stage = doc.get("approval_stage") or doc.get("current_step") or doc.get("pending_with_role") or ""
        pending_with_role = doc.get("pending_with_role") or doc.get("current_step") or ""
        team_leader_status = doc.get("team_leader_status") or doc.get("tl_status") or doc.get("team_leader_approval_status") or ""
        reporting_officer_status = doc.get("reporting_officer_status") or doc.get("ro_status") or doc.get("reporting_officer_approval_status") or ""
        hr_status = doc.get("hr_status") or doc.get("hr_approval_status") or ""
        approval_history = doc.get("approval_history") or []

        history_lines = []
        if isinstance(approval_history, list):
            for history in approval_history[-4:]:
                if not isinstance(history, dict):
                    continue
                action = history.get("action") or "updated"
                history_status = history.get("status") or ""
                by_name = history.get("by_name") or history.get("by_role") or ""
                remark = history.get("remark") or ""
                history_lines.append(f"{action} {history_status} by {by_name}. {remark}".strip())

        status_lower = _lower(status)
        pending_lower = _lower(pending_with_role)

        if status_lower in ["approved", "final_approved", "completed"]:
            readable_position = "Your leave is approved."
        elif status_lower in ["rejected", "declined"]:
            readable_position = "Your leave is rejected."
        elif pending_lower in ["team_leader", "tl"]:
            readable_position = "Your leave is currently waiting for Team Leader approval."
        elif pending_lower in ["reporting_officer", "ro"]:
            readable_position = "Your leave is currently waiting for Reporting Officer approval."
        elif pending_lower in ["hr", "hr_admin", "hr_manager"]:
            readable_position = "Your leave is currently waiting for HR approval."
        elif approval_stage:
            readable_position = f"Current approval stage: {approval_stage}."
        else:
            readable_position = "Your leave is currently pending."

        lines.append(
            f"""
Leave Request {index}
Leave Type: {leave_type}
Date: {start_date} to {end_date}
Overall Status: {status}
Team Leader Status: {team_leader_status or "Not updated / Not applicable"}
Reporting Officer Status: {reporting_officer_status or "Not updated / Not applicable"}
HR Status: {hr_status or "Not updated / Not applicable"}
Current Position: {readable_position}
Recent Approval History: {" | ".join(history_lines) if history_lines else "No detailed approval history found."}
""".strip()
        )

    return {
        "title": "Leave Status",
        "content": "\n\n".join(lines)
    }



def _number_value(doc, keys, default=0):
    for key in keys:
        value = doc.get(key)

        if value in [None, ""]:
            continue

        try:
            return float(value)
        except Exception:
            continue

    return default


def _detect_leave_type(doc):
    raw = _lower(
        doc.get("leave_type")
        or doc.get("type")
        or doc.get("name")
        or doc.get("title")
        or doc.get("leave_name")
        or doc.get("label")
    )

    if "casual" in raw or raw == "cl":
        return "CL"

    if "earned" in raw or raw == "el":
        return "EL"

    if "lwp" in raw or "without pay" in raw:
        return "LWP"

    if "half" in raw:
        return "HALF_DAY"

    return raw.upper() if raw else ""


def _calculate_leave_row_balance(doc):
    """
    Supports different HRMS leave balance structures.

    Possible fields:
    - available / balance / remaining / closing
    - opening + credited - used
    - opening_balance + credited_balance - used_balance
    """

    direct_available = _number_value(
        doc,
        [
            "available",
            "available_balance",
            "balance",
            "remaining",
            "remaining_balance",
            "closing",
            "closing_balance",
            "current_balance",
        ],
        default=None,
    )

    used = _number_value(
        doc,
        [
            "used",
            "used_leave",
            "leave_used",
            "taken",
            "leave_taken",
            "availed",
            "deducted",
        ],
        default=0,
    )

    if direct_available is not None:
        return direct_available, used

    opening = _number_value(
        doc,
        [
            "opening",
            "opening_balance",
            "opening_leave",
            "total",
            "total_leave",
            "allocated",
            "allocated_leave",
        ],
        default=0,
    )

    credited = _number_value(
        doc,
        [
            "credited",
            "credit",
            "credited_leave",
            "added",
            "additional",
        ],
        default=0,
    )

    available = opening + credited - used

    return available, used


def get_leave_balance_context(user_context=None):
    db = get_db()

    tenant_filter = _tenant_query(user_context)
    if not tenant_filter:
        return _private_live_context_unavailable("Leave Balance", reason="tenant")

    person_values = _private_person_values(user_context)
    if not person_values:
        return _private_live_context_unavailable("Leave Balance", reason="identity")

    query_parts = [tenant_filter]

    query_parts.append({
            "$or": [
                {"employee_id": {"$in": person_values}},
                {"user_id": {"$in": person_values}},
                {"employee": {"$in": person_values}},
                {"staff_id": {"$in": person_values}},
            ]
        })

    query = {"$and": query_parts} if query_parts else {}

    docs = list(db.leave_balances.find(query).limit(50))

    if not docs:
        return {
            "title": "Leave Balance",
            "content": "No leave balance record was found for this user."
        }

    cl_available = 0
    cl_used = 0
    el_available = 0
    el_used = 0
    lwp_used = 0

    # Format 1: one document contains CL/EL fields directly
    for doc in docs:
        cl_direct = _number_value(
            doc,
            [
                "cl_balance",
                "casual_leave_balance",
                "casual_leave_available",
                "cl_available",
                "CL",
            ],
            default=None,
        )

        el_direct = _number_value(
            doc,
            [
                "el_balance",
                "earned_leave_balance",
                "earned_leave_available",
                "el_available",
                "EL",
            ],
            default=None,
        )

        if cl_direct is not None:
            cl_available = cl_direct

        if el_direct is not None:
            el_available = el_direct

        cl_used_direct = _number_value(
            doc,
            [
                "cl_used",
                "casual_leave_used",
                "used_cl",
            ],
            default=None,
        )

        el_used_direct = _number_value(
            doc,
            [
                "el_used",
                "earned_leave_used",
                "used_el",
            ],
            default=None,
        )

        if cl_used_direct is not None:
            cl_used = cl_used_direct

        if el_used_direct is not None:
            el_used = el_used_direct

    # Format 2: multiple rows, one row per leave type
    for doc in docs:
        leave_type = _detect_leave_type(doc)

        available, used = _calculate_leave_row_balance(doc)

        if leave_type == "CL":
            cl_available = available
            cl_used = used

        elif leave_type == "EL":
            el_available = available
            el_used = used

        elif leave_type == "LWP":
            lwp_used = used

    return {
        "title": "Leave Balance",
        "content": (
            f"Casual Leave Available: {cl_available:g}\n"
            f"Casual Leave Used: {cl_used:g}\n"
            f"Earned Leave Available: {el_available:g}\n"
            f"Earned Leave Used: {el_used:g}\n"
            f"LWP Used: {lwp_used:g}\n\n"
            "Leave deduction rule: Leave balance is deducted only after final approval. "
            "Half-Day leave deducts 0.5 day from CL first, then EL if CL is insufficient, "
            "and becomes LWP if both CL and EL are insufficient."
        )
    }


def get_assets_context(user_context=None, limit=20):
    db = get_db()

    tenant_filter = _tenant_query(user_context)
    if not tenant_filter:
        return _private_live_context_unavailable("Assets", reason="tenant")

    person_values = _private_person_values(user_context)
    if not person_values:
        return _private_live_context_unavailable("Assets", reason="identity")

    query_parts = [tenant_filter]

    query_parts.append({
            "$or": [
                {"employee_id": {"$in": person_values}},
                {"assigned_employee_id": {"$in": person_values}},
                {"assigned_user_id": {"$in": person_values}},
                {"user_id": {"$in": person_values}},
            ]
        })

    query = {"$and": query_parts} if query_parts else {}

    docs = list(db.assets.find(query).sort([("created_at", -1), ("_id", -1)]).limit(limit))

    if not docs:
        return {
            "title": "Assets",
            "content": "No assigned assets were found for this user."
        }

    lines = [f"Total assets found: {len(docs)}"]

    for index, doc in enumerate(docs[:10], start=1):
        name = doc.get("asset_name") or doc.get("name") or doc.get("title") or "Asset"
        asset_type = doc.get("asset_type") or doc.get("type") or "N/A"
        status = doc.get("status") or "N/A"
        condition = doc.get("condition") or "N/A"

        lines.append(
            f"{index}. {name} | Type: {asset_type} | Status: {status} | Condition: {condition}"
        )

    return {
        "title": "Assets",
        "content": "\n".join(lines)
    }


def get_attendance_summary_context(user_context=None, period="month"):
    db = get_db()

    start, end = _date_range(period)

    tenant_filter = _tenant_query(user_context)
    if not tenant_filter:
        return _private_live_context_unavailable(f"Attendance Summary - {period}", reason="tenant")

    person_values = _private_person_values(user_context)
    if not person_values:
        return _private_live_context_unavailable(f"Attendance Summary - {period}", reason="identity")

    query_parts = [
        {
            "$or": [
                {"date": {"$gte": start.date().isoformat(), "$lte": end.date().isoformat()}},
                {"created_at": {"$gte": start, "$lte": end}},
                {"check_in_at": {"$gte": start, "$lte": end}},
            ]
        }
    ]

    query_parts.append(tenant_filter)
    query_parts.append({
        "$or": [
            {"employee_id": {"$in": person_values}},
            {"user_id": {"$in": person_values}},
        ]
    })

    query = {"$and": query_parts}

    docs = list(db.attendance_logs.find(query).limit(500))

    present_count = 0
    late_count = 0
    on_time_count = 0
    absent_count = 0
    wfh_count = 0
    field_count = 0

    for doc in docs:
        status = _lower(doc.get("status") or doc.get("attendance_status"))
        mode = _lower(doc.get("mode") or doc.get("attendance_mode"))
        late = bool(doc.get("is_late")) or "late" in status

        if "absent" in status:
            absent_count += 1
        else:
            present_count += 1

        if late:
            late_count += 1
        else:
            on_time_count += 1

        if "wfh" in mode or "work from home" in mode:
            wfh_count += 1

        if "field" in mode:
            field_count += 1

    return {
        "title": f"Attendance Summary - {period}",
        "content": (
            f"Attendance records checked: {len(docs)}. "
            f"Present days: {present_count}. "
            f"On-time days: {on_time_count}. "
            f"Late days: {late_count}. "
            f"Absent days: {absent_count}. "
            f"WFH days: {wfh_count}. "
            f"Field days: {field_count}."
        )
    }


def get_performance_summary_context(user_context=None, period="month", limit=8):
    db = get_db()

    start, end = _date_range(period)

    tenant_filter = _tenant_query(user_context)
    if not tenant_filter:
        return _private_live_context_unavailable(f"Performance Summary - {period}", reason="tenant")

    person_values = _private_person_values(user_context)
    if not person_values:
        return _private_live_context_unavailable(f"Performance Summary - {period}", reason="identity")

    query_parts = [
        {
            "$or": [
                {"created_at": {"$gte": start, "$lte": end}},
                {"review_date": {"$gte": start.date().isoformat(), "$lte": end.date().isoformat()}},
            ]
        }
    ]

    query_parts.append(tenant_filter)
    query_parts.append({
        "$or": [
            {"employee_id": {"$in": person_values}},
            {"user_id": {"$in": person_values}},
            {"reviewee_id": {"$in": person_values}},
        ]
    })

    docs = list(
        db.performance_reviews
        .find({"$and": query_parts})
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
    )

    if not docs:
        return {
            "title": f"Performance Summary - {period}",
            "content": "No performance reviews were found for this period."
        }

    ratings = []

    lines = []

    for index, doc in enumerate(docs, start=1):
        rating = doc.get("rating") or doc.get("score") or doc.get("overall_rating")
        remarks = doc.get("remarks") or doc.get("comment") or doc.get("summary") or ""

        if isinstance(rating, (int, float)):
            ratings.append(float(rating))

        lines.append(f"{index}. Rating: {rating or 'N/A'} | Remarks: {remarks or 'N/A'}")

    average = round(sum(ratings) / len(ratings), 2) if ratings else "N/A"

    return {
        "title": f"Performance Summary - {period}",
        "content": f"Average rating: {average}\n" + "\n".join(lines)
    }


def _roles(user_context=None):
    """
    Return Saya's effective response roles.

    Team Leader and Reporting Officer are derived from verified employee flags.
    A designation such as Manager or Managing Director never grants a role.
    """

    return derive_effective_ai_roles(user_context or {})


def _is_admin_like_role(user_context=None):
    return bool(set(_roles(user_context)).intersection({
        "super_admin",
        "admin",
        "hr",
        "hr_admin",
        "hr_manager",
    }))

def _unique_values(values):
    unique = []

    for value in values or []:
        if value in [None, ""]:
            continue

        for variant in _id_variants(value):
            if variant not in unique:
                unique.append(variant)

    return unique


def _text_value_set(values):
    result = set()

    for value in values or []:
        text = _safe_str(value)

        if text:
            result.add(text)

    return result


def _employee_department_from_context(user_context=None):
    employee = user_context.get("employee") if isinstance(user_context, dict) else {}

    if not isinstance(employee, dict):
        employee = {}

    return _safe_str(
        employee.get("department")
        or employee.get("department_name")
        or user_context.get("department")
        or user_context.get("department_name")
        if isinstance(user_context, dict)
        else ""
    )


def _employee_designation_from_context(user_context=None):
    employee = user_context.get("employee") if isinstance(user_context, dict) else {}

    if not isinstance(employee, dict):
        employee = {}

    return _safe_str(
        employee.get("designation")
        or employee.get("designation_name")
        or user_context.get("designation")
        or user_context.get("designation_name")
        if isinstance(user_context, dict)
        else ""
    )


def _display_name(doc):
    doc = doc or {}

    return _safe_str(
        doc.get("employee_name")
        or doc.get("name")
        or doc.get("full_name")
        or doc.get("display_name")
        or doc.get("email")
        or "Employee"
    )


def _identity_values_from_doc(doc=None, user_context=None):
    values = []

    if isinstance(user_context, dict):
        values.extend([
            user_context.get("user_id"),
            user_context.get("_id"),
            user_context.get("employee_id"),
            user_context.get("employee_profile_id"),
            user_context.get("employee_summary_id"),
            user_context.get("employee_user_id"),
            user_context.get("email"),
            user_context.get("official_email"),
            user_context.get("work_email"),
        ])

        context_employee = user_context.get("employee") or {}

        if isinstance(context_employee, dict):
            values.extend([
                context_employee.get("_id"),
                context_employee.get("id"),
                context_employee.get("user_id"),
                context_employee.get("employee_id"),
                context_employee.get("employee_code"),
                context_employee.get("emp_code"),
                context_employee.get("code"),
                context_employee.get("email"),
                context_employee.get("official_email"),
                context_employee.get("work_email"),
            ])

    if isinstance(doc, dict):
        values.extend([
            doc.get("_id"),
            doc.get("id"),
            doc.get("user_id"),
            doc.get("employee_user_id"),
            doc.get("login_user_id"),
            doc.get("account_user_id"),
            doc.get("employee_id"),
            doc.get("employee_ref_id"),
            doc.get("employee_profile_id"),
            doc.get("employee_code"),
            doc.get("emp_code"),
            doc.get("code"),
            doc.get("email"),
            doc.get("official_email"),
            doc.get("work_email"),
            doc.get("username"),
        ])

    return _unique_values(values)


def _person_lookup_or(values):
    object_values = [value for value in values or [] if isinstance(value, ObjectId)]
    text_values = [_safe_str(value) for value in values or [] if _safe_str(value)]

    lookup_or = []

    if object_values:
        lookup_or.append({"_id": {"$in": object_values}})

    if text_values:
        lookup_or.extend([
            {"id": {"$in": text_values}},
            {"user_id": {"$in": text_values}},
            {"employee_user_id": {"$in": text_values}},
            {"login_user_id": {"$in": text_values}},
            {"account_user_id": {"$in": text_values}},
            {"employee_id": {"$in": text_values}},
            {"employee_ref_id": {"$in": text_values}},
            {"employee_profile_id": {"$in": text_values}},
            {"employee_code": {"$in": text_values}},
            {"emp_code": {"$in": text_values}},
            {"code": {"$in": text_values}},
            {"email": {"$in": text_values}},
            {"official_email": {"$in": text_values}},
            {"work_email": {"$in": text_values}},
            {"username": {"$in": text_values}},
        ])

    return lookup_or



def _lookup_current_employee(user_context=None):
    """Resolve the current employee only inside the authenticated tenant."""

    db = get_db()
    values = _identity_values_from_doc(user_context=user_context)

    if not values:
        return None

    tenant_filter = _tenant_query(user_context)
    if not tenant_filter:
        return None

    lookup_or = _person_lookup_or(values)
    if not lookup_or:
        return None

    query_parts = [
        tenant_filter,
        {"is_deleted": {"$ne": True}},
        {"deleted": {"$ne": True}},
        {"$or": lookup_or},
    ]

    return db.employees.find_one({"$and": query_parts})



def _department_match_query(department):
    text = _safe_str(department)

    if not text:
        return {}

    return {
        "$or": [
            {"department": text},
            {"department_name": text},
            {"assigned_department": text},
            {"assigned_department_name": text},
        ]
    }


def _active_employee_query_parts():
    return [
        {"is_deleted": {"$ne": True}},
        {"deleted": {"$ne": True}},
        {"is_active": {"$ne": False}},
        {"active": {"$ne": False}},
        {
            "status": {
                "$nin": [
                    "Inactive",
                    "inactive",
                    "INACTIVE",
                    "Resigned",
                    "resigned",
                    "Left",
                    "left",
                    "Terminated",
                    "terminated",
                    "Alumni",
                    "alumni",
                    "Deleted",
                    "deleted",
                    "Blocked",
                    "blocked",
                    "Suspended",
                    "suspended",
                ]
            }
        },
    ]


def _active_project_query_parts():
    return [
        {"is_deleted": {"$ne": True}},
        {"deleted": {"$ne": True}},
        {
            "status": {
                "$nin": [
                    "deleted",
                    "Deleted",
                    "DELETED",
                    "cancelled",
                    "Cancelled",
                    "CANCELLED",
                ]
            }
        },
    ]


def _team_relation_values(employee_doc=None, user_context=None):
    employee_doc = employee_doc or {}

    team_leader_values = _unique_values([
        employee_doc.get("team_leader_id"),
        employee_doc.get("team_leader_user_id"),
        employee_doc.get("tl_id"),
        employee_doc.get("team_leader_employee_id"),
        employee_doc.get("team_leader_employee_code"),
        employee_doc.get("team_leader_code"),
        employee_doc.get("team_leader_email"),
    ])

    reporting_officer_values = _unique_values([
        employee_doc.get("reporting_officer_id"),
        employee_doc.get("reporting_officer_user_id"),
        employee_doc.get("ro_id"),
        employee_doc.get("reporting_officer_employee_id"),
        employee_doc.get("reporting_officer_employee_code"),
        employee_doc.get("reporting_officer_code"),
        employee_doc.get("reporting_officer_email"),
    ])

    if isinstance(user_context, dict):
        team_leader_values = _unique_values(team_leader_values + [
            user_context.get("team_leader_id"),
            user_context.get("team_leader_user_id"),
            user_context.get("tl_id"),
        ])

        reporting_officer_values = _unique_values(reporting_officer_values + [
            user_context.get("reporting_officer_id"),
            user_context.get("reporting_officer_user_id"),
            user_context.get("ro_id"),
        ])

    return team_leader_values, reporting_officer_values


def _employee_brief(employee):
    if not employee:
        return ""

    name = _display_name(employee)
    designation = _safe_str(employee.get("designation") or employee.get("designation_name"))
    department = _safe_str(employee.get("department") or employee.get("department_name"))

    extra = " | ".join([item for item in [designation, department] if item])

    return f"{name}{f' ({extra})' if extra else ''}"



def _find_person_by_values(values, user_context=None):
    """Resolve a related employee only inside the authenticated tenant."""

    values = _unique_values(values)

    if not values:
        return None

    tenant_filter = _tenant_query(user_context)
    if not tenant_filter:
        return None

    db = get_db()
    query_parts = [tenant_filter] + _active_employee_query_parts()
    lookup_or = _person_lookup_or(values)

    if not lookup_or:
        return None

    query_parts.append({"$or": lookup_or})
    return db.employees.find_one({"$and": query_parts})



def get_team_scope_context(user_context=None, limit=30):
    """
    Returns the logged-in user's strict team scope only.

    Rules:
    - Never falls back to all employees.
    - If department is available, every returned employee must match that department.
    - Includes the current employee, their Team Leader, their Reporting Officer,
      peers under the same Team Leader/Reporting Officer, and members who report
      to the logged-in user when the logged-in user is a Team Leader/Reporting Officer.
    """

    db = get_db()

    tenant_filter = _tenant_query(user_context)
    if not tenant_filter:
        return _private_live_context_unavailable("Team Scope", reason="tenant")

    current_employee = _lookup_current_employee(user_context)
    if not current_employee:
        return _private_live_context_unavailable("Team Scope", reason="identity")

    department = _safe_str(
        (current_employee or {}).get("department")
        or (current_employee or {}).get("department_name")
        or _employee_department_from_context(user_context)
    )

    if not current_employee and not department:
        return {
            "title": "Team Scope",
            "content": (
                "No department/team scope was found for this user. "
                "Do not show employee, team member, Team Leader, Reporting Officer, or project details."
            )
        }

    current_values = _identity_values_from_doc(current_employee, user_context=user_context)
    team_leader_values, reporting_officer_values = _team_relation_values(
        current_employee,
        user_context=user_context,
    )

    team_leader = _find_person_by_values(team_leader_values, user_context=user_context)
    reporting_officer = _find_person_by_values(reporting_officer_values, user_context=user_context)

    relationship_or = []

    if current_values:
        current_text_values = list(_text_value_set(current_values))

        relationship_or.extend([
            {"team_leader_id": {"$in": current_text_values}},
            {"team_leader_user_id": {"$in": current_text_values}},
            {"team_leader_employee_id": {"$in": current_text_values}},
            {"team_leader_employee_code": {"$in": current_text_values}},
            {"reporting_officer_id": {"$in": current_text_values}},
            {"reporting_officer_user_id": {"$in": current_text_values}},
            {"reporting_officer_employee_id": {"$in": current_text_values}},
            {"reporting_officer_employee_code": {"$in": current_text_values}},
        ])

    shared_anchor_values = list(_text_value_set(team_leader_values + reporting_officer_values))

    if shared_anchor_values:
        relationship_or.extend([
            {"team_leader_id": {"$in": shared_anchor_values}},
            {"team_leader_user_id": {"$in": shared_anchor_values}},
            {"team_leader_employee_id": {"$in": shared_anchor_values}},
            {"team_leader_employee_code": {"$in": shared_anchor_values}},
            {"reporting_officer_id": {"$in": shared_anchor_values}},
            {"reporting_officer_user_id": {"$in": shared_anchor_values}},
            {"reporting_officer_employee_id": {"$in": shared_anchor_values}},
            {"reporting_officer_employee_code": {"$in": shared_anchor_values}},
        ])

    if current_values:
        self_or = _person_lookup_or(current_values)

        if self_or:
            relationship_or.append({"$or": self_or})

    if team_leader_values:
        tl_or = _person_lookup_or(team_leader_values)

        if tl_or:
            relationship_or.append({"$or": tl_or})

    if reporting_officer_values:
        ro_or = _person_lookup_or(reporting_officer_values)

        if ro_or:
            relationship_or.append({"$or": ro_or})

    query_parts = [tenant_filter]

    query_parts.extend(_active_employee_query_parts())

    if department:
        query_parts.append({
            "$or": [
                {"department": department},
                {"department_name": department},
            ]
        })

    if relationship_or:
        query_parts.append({"$or": relationship_or})
    elif current_values:
        self_lookup = _person_lookup_or(current_values)
        if not self_lookup:
            return _private_live_context_unavailable("Team Scope")
        query_parts.append({"$or": self_lookup})
    else:
        return _private_live_context_unavailable("Team Scope", reason="identity")

    query = {"$and": query_parts}

    docs = list(
        db.employees
        .find(query)
        .sort([("employee_name", 1), ("name", 1)])
        .limit(limit)
    )

    seen = set()
    scoped_people = []

    for doc in docs:
        person_key = str(doc.get("_id") or doc.get("id") or doc.get("employee_id") or "")

        if not person_key or person_key in seen:
            continue

        seen.add(person_key)
        scoped_people.append(doc)

    current_id_values = _text_value_set(current_values)
    tl_id_values = _text_value_set(team_leader_values)
    ro_id_values = _text_value_set(reporting_officer_values)

    member_lines = []

    for person in scoped_people:
        person_values = _text_value_set(_identity_values_from_doc(person))
        relation = []

        if current_id_values and person_values.intersection(current_id_values):
            relation.append("self")

        if tl_id_values and person_values.intersection(tl_id_values):
            relation.append("team leader")

        if ro_id_values and person_values.intersection(ro_id_values):
            relation.append("reporting officer")

        person_tl_values = _text_value_set(_team_relation_values(person)[0])
        person_ro_values = _text_value_set(_team_relation_values(person)[1])

        if current_id_values and (
            person_tl_values.intersection(current_id_values)
            or person_ro_values.intersection(current_id_values)
        ):
            relation.append("reports to current user")

        if not relation:
            relation.append("same team/department scope")

        member_lines.append(
            f"- {_employee_brief(person)} | Scope relation: {', '.join(relation)}"
        )

    content_lines = [
        "Strict scope rule: Use only the people listed in this Team Scope block. Do not mention employees from another department/team.",
        f"Department scope: {department or 'Not configured'}",
        f"Current Employee: {_employee_brief(current_employee) or 'Not found'}",
        f"Team Leader: {_employee_brief(team_leader) or 'Not found in accessible scope'}",
        f"Reporting Officer: {_employee_brief(reporting_officer) or 'Not found in accessible scope'}",
        "Accessible Team Members:",
        "\n".join(member_lines[:limit]) if member_lines else "No accessible team members were found for this user.",
    ]

    return {
        "title": "Team Scope",
        "content": "\n".join(content_lines)
    }


def get_projects_context(user_context=None, limit=12):
    """
    Returns projects only inside the logged-in user's strict department/team scope.

    Rules:
    - Never falls back to all tenant projects.
    - If department exists, projects must match that department.
    - If employee/team identifiers exist, projects are further matched by assignment,
      Team Leader, Reporting Officer, members, collaborators, creator, or manager.
    """

    db = get_db()

    tenant_filter = _tenant_query(user_context)
    if not tenant_filter:
        return _private_live_context_unavailable("Projects", reason="tenant")

    current_employee = _lookup_current_employee(user_context)
    if not current_employee and not _is_admin_like_role(user_context):
        return _private_live_context_unavailable("Projects", reason="identity")

    department = _safe_str(
        (current_employee or {}).get("department")
        or (current_employee or {}).get("department_name")
        or _employee_department_from_context(user_context)
    )

    current_values = _identity_values_from_doc(current_employee, user_context=user_context)
    team_leader_values, reporting_officer_values = _team_relation_values(
        current_employee,
        user_context=user_context,
    )
    team_scope_values = _unique_values(current_values + team_leader_values + reporting_officer_values)
    team_scope_text_values = list(_text_value_set(team_scope_values))

    query_parts = [tenant_filter]

    query_parts.extend(_active_project_query_parts())

    if department:
        query_parts.append(_department_match_query(department))

    project_or_parts = []

    if team_scope_text_values:
        project_or_parts.extend([
            {"assigned_to": {"$in": team_scope_text_values}},
            {"assigned_user_id": {"$in": team_scope_text_values}},
            {"assigned_employee_id": {"$in": team_scope_text_values}},
            {"employee_id": {"$in": team_scope_text_values}},
            {"user_id": {"$in": team_scope_text_values}},
            {"created_by": {"$in": team_scope_text_values}},

            {"team_leader_id": {"$in": team_scope_text_values}},
            {"team_leader_user_id": {"$in": team_scope_text_values}},
            {"team_leader_employee_id": {"$in": team_scope_text_values}},
            {"team_leader_employee_code": {"$in": team_scope_text_values}},
            {"reporting_officer_id": {"$in": team_scope_text_values}},
            {"reporting_officer_user_id": {"$in": team_scope_text_values}},
            {"reporting_officer_employee_id": {"$in": team_scope_text_values}},
            {"reporting_officer_employee_code": {"$in": team_scope_text_values}},
            {"manager_id": {"$in": team_scope_text_values}},

            {"members": {"$in": team_scope_text_values}},
            {"member_ids": {"$in": team_scope_text_values}},
            {"team_members": {"$in": team_scope_text_values}},
            {"team_member_ids": {"$in": team_scope_text_values}},
            {"collaborators": {"$in": team_scope_text_values}},
            {"collaborator_ids": {"$in": team_scope_text_values}},

            {"team_members.employee_id": {"$in": team_scope_text_values}},
            {"team_members.user_id": {"$in": team_scope_text_values}},
            {"team_members.id": {"$in": team_scope_text_values}},
            {"members.employee_id": {"$in": team_scope_text_values}},
            {"members.user_id": {"$in": team_scope_text_values}},
            {"collaborators.employee_id": {"$in": team_scope_text_values}},
            {"collaborators.user_id": {"$in": team_scope_text_values}},
        ])

    # For department project questions, allow department projects even when old
    # project records do not store member IDs consistently. Still never leave the
    # user's department/tenant scope.
    if not _is_admin_like_role(user_context):
        if not project_or_parts:
            return _private_live_context_unavailable("Projects", reason="identity")
        query_parts.append({"$or": project_or_parts})

    query = {"$and": query_parts}

    docs = list(
        db.projects
        .find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
    )

    if not docs:
        return {
            "title": "Projects",
            "content": (
                "No accessible project/team record was found for this user. "
                "Do not mention projects from another department/team."
            )
        }

    lines = [
        "Strict scope rule: Use only the projects listed below. Do not mention projects from another department/team.",
        f"Department scope: {department or 'Not configured'}",
        f"Total accessible projects found: {len(docs)}",
    ]

    for index, doc in enumerate(docs, start=1):
        name = doc.get("name") or doc.get("title") or doc.get("project_name") or "Project"
        status = doc.get("status") or "N/A"
        progress = doc.get("progress") or doc.get("progress_percent") or doc.get("completion") or "N/A"
        team_leader = doc.get("team_leader_name") or doc.get("team_leader") or "N/A"
        reporting_officer = doc.get("reporting_officer_name") or doc.get("reporting_officer") or "N/A"
        project_department = doc.get("department") or doc.get("department_name") or "N/A"

        lines.append(
            f"{index}. {name} | Department: {project_department} | Status: {status} | "
            f"Progress: {progress} | Team Leader: {team_leader} | Reporting Officer: {reporting_officer}"
        )

    return {
        "title": "Projects",
        "content": "\n".join(lines)
    }


def _truthy(value):
    if isinstance(value, bool):
        return value

    return _lower(value) in {"1", "true", "yes", "y", "on"}


def _parse_datetime(value):
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    text = _safe_str(value)

    if not text:
        return None

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (TypeError, ValueError):
        return None


def _days_left(value):
    parsed = _parse_datetime(value)

    if not parsed:
        return None

    remaining = parsed - _now_utc()

    if remaining.total_seconds() <= 0:
        return 0

    return max(1, int((remaining.total_seconds() + 86399) // 86400))


def _format_money(amount, currency="INR"):
    if amount in [None, ""]:
        return "Not available"

    try:
        number = float(amount)
    except (TypeError, ValueError):
        return "Not available"

    if number.is_integer():
        amount_text = f"{int(number):,}"
    else:
        amount_text = f"{number:,.2f}".rstrip("0").rstrip(".")

    currency = _safe_str(currency or "INR").upper()

    if currency == "INR":
        return f"₹{amount_text}"

    return f"{currency} {amount_text}"


def _tenant_document(user_context=None):
    context = user_context or {}
    tenant = context.get("tenant") or {}

    if isinstance(tenant, dict) and tenant:
        return tenant

    tenant_values = _tenant_values(context)

    if not tenant_values:
        return {}

    db = get_db()

    return (
        db.tenants.find_one({"_id": {"$in": tenant_values}})
        or db.tenants.find_one({"tenant_id": {"$in": tenant_values}})
        or db.companies.find_one({"_id": {"$in": tenant_values}})
        or db.companies.find_one({"tenant_id": {"$in": tenant_values}})
        or {}
    )


def _latest_subscription_document(user_context=None):
    tenant_values = _tenant_values(user_context)

    if not tenant_values:
        return {}

    db = get_db()
    query = {
        "$and": [
            {
                "$or": [
                    {"tenant_id": {"$in": tenant_values}},
                    {"company_id": {"$in": tenant_values}},
                    {"tenant": {"$in": tenant_values}},
                ]
            },
            {"is_deleted": {"$ne": True}},
        ]
    }

    return db.subscriptions.find_one(
        query,
        sort=[("created_at", -1), ("updated_at", -1)],
    ) or {}


def _active_employee_count(user_context=None):
    tenant_query = _tenant_query(user_context)

    if not tenant_query:
        return None

    query = {
        "$and": [
            tenant_query,
            {
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False},
                ]
            },
            {
                "$or": [
                    {"status": {"$exists": False}},
                    {"status": {"$nin": ["inactive", "resigned", "alumni", "deleted"]}},
                ]
            },
        ]
    }

    try:
        return get_db().employees.count_documents(query)
    except Exception:
        return None


def build_subscription_snapshot(user_context=None):
    """Build a safe, tenant-scoped subscription snapshot for Saya."""

    context = user_context or {}

    if isinstance(context, dict):
        cached = context.get("_saya_subscription_snapshot")
        if isinstance(cached, dict):
            return cached

    tenant = _tenant_document(context)
    subscription = _latest_subscription_document(context)

    def pick(*keys, default=None):
        for key in keys:
            if subscription.get(key) not in [None, ""]:
                return subscription.get(key)
            if tenant.get(key) not in [None, ""]:
                return tenant.get(key)
        return default

    plan_code = _lower(
        pick("plan_code", "selected_plan_code", default="")
    ).replace("-", "_").replace(" ", "_")

    plan_type = _lower(pick("plan_type", default=""))
    subscription_status = _lower(
        pick("subscription_status", "status", default="")
    )
    trial_status = _lower(pick("trial_status", default=""))

    is_lifetime = bool(
        _truthy(pick("is_lifetime", "is_sds_company", default=False))
        or plan_type == "lifetime"
        or subscription_status == "lifetime"
    )
    is_demo = bool(
        _truthy(pick("is_demo_company", default=False))
        or plan_type == "demo"
        or subscription_status == "demo"
        or trial_status in {"active", "trial", "running"}
    )
    is_paid = bool(
        _truthy(pick("is_paid_company", default=False))
        or plan_type == "paid"
        or subscription_status in {"active", "paid", "active_paid"}
        or (plan_code in {"essential", "growth", "premium"} and not is_demo and not is_lifetime)
    )

    trial_end_date = pick("trial_end_date")
    subscription_end_date = pick(
        "subscription_end_date",
        "ends_at",
        "next_due_date",
        "payment_due_date",
        "premium_next_due_date",
    )
    trial_days_left = _days_left(trial_end_date)
    subscription_days_left = _days_left(subscription_end_date)

    status_is_expired = subscription_status in {
        "expired",
        "suspended",
        "blocked",
        "inactive",
    }
    trial_is_expired = bool(is_demo and trial_days_left == 0)
    paid_is_expired = bool(is_paid and subscription_days_left == 0)
    is_suspended = bool(
        _truthy(pick("is_suspended", default=False))
        or subscription_status in {"suspended", "blocked"}
        or _lower(pick("status", default="")) in {"suspended", "blocked"}
    )
    is_expired = bool(status_is_expired or trial_is_expired or paid_is_expired)

    employee_limit = pick("employee_limit", "included_employees")
    is_unlimited = bool(
        _truthy(pick("is_unlimited_employees", default=False))
        or employee_limit in [None, "", 0, "0", "unlimited", "Unlimited"]
        and plan_code == "premium"
    )

    if is_unlimited:
        employee_limit = None

    allowed_modules = pick("allowed_modules", default=[])
    if isinstance(allowed_modules, str):
        allowed_modules = [
            item.strip()
            for item in allowed_modules.split(",")
            if item.strip()
        ]
    if not isinstance(allowed_modules, list):
        allowed_modules = []

    snapshot = {
        "tenant_id": _safe_str(
            tenant.get("tenant_id")
            or subscription.get("tenant_id")
            or context.get("tenant_id")
        ),
        "company_name": _safe_str(
            tenant.get("company_name")
            or tenant.get("name")
            or subscription.get("company_name")
            or context.get("tenant_name")
        ),
        "plan_code": plan_code,
        "selected_plan_code": plan_code,
        "plan_name": _safe_str(
            pick("plan_name", "selected_plan_name", "plan_label", "plan", default="")
        ),
        "plan_type": plan_type,
        "subscription_status": subscription_status,
        "trial_status": trial_status,
        "trial_start_date": pick("trial_start_date"),
        "trial_end_date": trial_end_date,
        "trial_days_left": trial_days_left,
        "subscription_start_date": pick("subscription_start_date", "started_at"),
        "subscription_end_date": subscription_end_date,
        "subscription_days_left": subscription_days_left,
        "next_payment_due_date": pick(
            "next_payment_due_date",
            "next_due_date",
            "payment_due_date",
            "premium_next_due_date",
        ),
        "billing_interval": _safe_str(
            pick("billing_interval", "plan_interval", "premium_billing_interval", default="")
        ),
        "renewal_amount": pick("premium_renewal_amount", "renewal_amount", "amount"),
        "renewal_currency": _safe_str(
            pick("premium_quoted_currency", "currency", default="INR")
        ).upper() or "INR",
        "renewal_price_source": _safe_str(pick("renewal_price_source", default="")),
        "employee_count": _active_employee_count(context),
        "employee_limit": employee_limit,
        "is_unlimited_employees": is_unlimited,
        "allowed_modules": allowed_modules,
        "premium_request_id": _safe_str(
            pick("premium_request_id", "pending_premium_request_id", default="")
        ),
        "premium_quote_status": _safe_str(pick("premium_quote_status", default="")),
        "premium_payment_status": _safe_str(pick("premium_payment_status", default="")),
        "is_sds_company": _truthy(pick("is_sds_company", default=False)),
        "is_lifetime": is_lifetime,
        "is_demo_company": is_demo,
        "is_paid_company": is_paid,
        "is_expired": is_expired,
        "is_suspended": is_suspended,
        "requires_payment": bool(not is_lifetime and is_expired),
    }

    snapshot["profile_key"] = resolve_subscription_profile(
        snapshot,
        is_platform_superadmin=("super_admin" in _roles(context)),
    )

    if isinstance(context, dict):
        context["_saya_subscription_snapshot"] = snapshot

    return snapshot


def _requested_plan_codes(question):
    text = _lower(question)
    codes = []

    for code in ("essential", "growth", "premium"):
        if code in text:
            codes.append(code)

    return codes


def get_pricing_plans_context(question="", user_context=None):
    """Return public-safe, database-backed active SaaS plan information."""

    db = get_db()
    query = {
        "is_deleted": {"$ne": True},
        "is_active": {"$ne": False},
    }
    requested_codes = _requested_plan_codes(question)

    if requested_codes:
        query["plan_code"] = {"$in": requested_codes}

    plans = list(
        db.pricing_plans.find(query).sort([
            ("sort_order", 1),
            ("amount", 1),
            ("plan_name", 1),
        ])
    )

    if not plans:
        return {
            "title": "Current SaaS Pricing",
            "content": (
                "No active pricing-plan record was found in the pricing_plans collection. "
                "Saya must not quote an amount or invent a plan price. Ask the user to check "
                "the Pricing/Billing page or contact the Sales team."
            ),
        }

    lines = [
        "Use these database values as the current authoritative public pricing."
    ]

    for index, plan in enumerate(plans, start=1):
        code = _lower(plan.get("plan_code"))
        name = _safe_str(
            plan.get("display_name")
            or plan.get("plan_name")
            or code.title()
        )
        interval = _safe_str(plan.get("billing_interval") or "monthly")
        is_custom = bool(plan.get("is_custom_pricing"))
        online_payment = bool(plan.get("allow_online_payment"))
        unlimited = bool(plan.get("is_unlimited_employees"))
        employee_limit = plan.get("employee_limit")
        amount = plan.get("amount")
        currency = plan.get("currency") or "INR"

        if is_custom or code == "premium":
            price_text = "Custom quotation required"
        else:
            price_text = f"{_format_money(amount, currency)} per {interval}"

        employee_text = (
            "Unlimited employees"
            if unlimited
            else f"Up to {employee_limit} employees"
            if employee_limit not in [None, ""]
            else "Employee limit not configured"
        )

        payment_text = (
            "Direct online payment available"
            if online_payment and not is_custom
            else "Quotation-first payment workflow"
            if is_custom or code == "premium"
            else "Online payment unavailable"
        )

        recommended_text = " | Recommended" if plan.get("is_recommended") else ""

        lines.append(
            f"{index}. {name} ({code or 'plan'}): {price_text} | "
            f"{employee_text} | {payment_text}{recommended_text}"
        )

        features = plan.get("features") or []
        if isinstance(features, list) and features:
            safe_features = [
                _safe_str(item)
                for item in features[:6]
                if _safe_str(item)
            ]
            if safe_features:
                lines.append("   Features: " + "; ".join(safe_features))

    lines.extend([
        "Essential and Growth prices must always come from these live records.",
        "Premium must follow Contact Sales -> request -> quotation -> client review -> payment -> activation.",
        "Never invent a discount, promotional price, testimonial, guarantee, or custom Premium amount.",
    ])

    return {
        "title": "Current SaaS Pricing",
        "content": "\n".join(lines),
    }


def get_subscription_context(user_context=None):
    snapshot = build_subscription_snapshot(user_context)

    if not snapshot.get("tenant_id") and not snapshot.get("company_name"):
        return {
            "title": "Current Subscription",
            "content": "No tenant subscription record was found for the logged-in user.",
        }

    if snapshot.get("is_lifetime"):
        plan_label = "Lifetime Full Access"
    elif snapshot.get("plan_name"):
        plan_label = snapshot.get("plan_name")
    elif snapshot.get("is_demo_company"):
        plan_label = "Trial / Demo"
    else:
        plan_label = snapshot.get("plan_code") or "Not configured"

    employee_limit = (
        "Unlimited"
        if snapshot.get("is_unlimited_employees")
        else snapshot.get("employee_limit")
        if snapshot.get("employee_limit") not in [None, ""]
        else "Not configured"
    )
    renewal_amount = snapshot.get("renewal_amount")
    renewal_text = (
        _format_money(renewal_amount, snapshot.get("renewal_currency"))
        if renewal_amount not in [None, ""]
        else "Not available"
    )
    modules = snapshot.get("allowed_modules") or []
    module_text = "All enabled modules" if "all" in [
        _lower(item) for item in modules
    ] else ", ".join(str(item) for item in modules) or "Not configured"

    content = (
        f"Company: {snapshot.get('company_name') or 'Current tenant'}\n"
        f"Subscription profile: {snapshot.get('profile_key') or 'unknown'}\n"
        f"Plan: {plan_label}\n"
        f"Plan code: {snapshot.get('plan_code') or 'Not configured'}\n"
        f"Subscription status: {snapshot.get('subscription_status') or 'Not configured'}\n"
        f"Trial status: {snapshot.get('trial_status') or 'Not applicable'}\n"
        f"Trial days left: {snapshot.get('trial_days_left') if snapshot.get('trial_days_left') is not None else 'Not applicable'}\n"
        f"Subscription days left: {snapshot.get('subscription_days_left') if snapshot.get('subscription_days_left') is not None else 'Not applicable'}\n"
        f"Billing interval: {snapshot.get('billing_interval') or 'Not configured'}\n"
        f"Renewal amount: {renewal_text}\n"
        f"Renewal price source: {snapshot.get('renewal_price_source') or 'Not configured'}\n"
        f"Employees in use: {snapshot.get('employee_count') if snapshot.get('employee_count') is not None else 'Not available'}\n"
        f"Employee limit: {employee_limit}\n"
        f"Allowed modules: {module_text}\n"
        f"Expired: {'Yes' if snapshot.get('is_expired') else 'No'}\n"
        f"Suspended: {'Yes' if snapshot.get('is_suspended') else 'No'}\n"
        f"Payment required: {'Yes' if snapshot.get('requires_payment') else 'No'}"
    )

    return {
        "title": "Current Subscription",
        "content": content,
    }


def get_premium_quotation_context(user_context=None):
    """
    Return tenant-scoped Premium quotation details only to billing-authorized roles.

    Other users can still receive the generic Premium workflow from File 2, but
    Saya must not expose their company's custom quotation amount or payment state.
    """

    roles = set(_roles(user_context))

    if not roles.intersection({"super_admin", "admin"}):
        return {
            "title": "Premium Quotation",
            "content": (
                "The generic Premium workflow may be explained, but this login role "
                "must not receive the tenant's custom quotation amount or payment details. "
                "Ask the tenant Admin or Platform Super Admin to review Billing."
            ),
        }

    tenant_values = _tenant_values(user_context)

    if not tenant_values:
        return {
            "title": "Premium Quotation",
            "content": "No tenant was resolved for this request.",
        }

    query = {
        "$and": [
            {
                "$or": [
                    {"tenant_id": {"$in": tenant_values}},
                    {"company_id": {"$in": tenant_values}},
                    {"tenant": {"$in": tenant_values}},
                ]
            },
            {"is_deleted": {"$ne": True}},
        ]
    }

    request_doc = get_db().premium_plan_requests.find_one(
        query,
        sort=[("quotation_sent_at", -1), ("updated_at", -1), ("created_at", -1)],
    ) or {}

    if not request_doc:
        return {
            "title": "Premium Quotation",
            "content": (
                "No Premium request or quotation was found for this tenant. "
                "Use Billing -> Premium -> Contact Sales / Submit Premium Request."
            ),
        }

    client_visible = request_doc.get("client_visible") is True
    quotation_status = _safe_str(request_doc.get("quotation_status") or "pending")
    request_status = _safe_str(request_doc.get("status") or "pending")
    payment_status = _safe_str(request_doc.get("payment_status") or "not_started")
    amount = request_doc.get("renewal_amount") or request_doc.get("quoted_amount")
    currency = request_doc.get("quoted_currency") or request_doc.get("currency") or "INR"

    if not client_visible:
        amount_text = "Not released to client"
    else:
        amount_text = _format_money(amount, currency)

    content = (
        f"Request reference: {request_doc.get('request_reference') or 'Not available'}\n"
        f"Request status: {request_status}\n"
        f"Quotation reference: {request_doc.get('quotation_reference') or 'Not available'}\n"
        f"Quotation status: {quotation_status}\n"
        f"Client visible: {'Yes' if client_visible else 'No'}\n"
        f"Quoted recurring amount: {amount_text}\n"
        f"Billing interval: {request_doc.get('billing_interval') or request_doc.get('quoted_billing_interval') or 'Not configured'}\n"
        f"Payment status: {payment_status}\n"
        f"Quotation valid until: {request_doc.get('quotation_valid_until') or 'Not configured'}\n"
        "Premium payment must not be recommended until client_visible is Yes and quotation_status is sent or converted."
    )

    return {
        "title": "Premium Quotation",
        "content": content,
    }


def get_role_subscription_guidance_context(user_context=None):
    context = dict(user_context or {})
    roles = _roles(context)
    snapshot = build_subscription_snapshot(context)

    context["roles"] = roles
    context["role"] = resolve_primary_role(roles)
    context["subscription"] = snapshot
    context["is_platform_superadmin"] = "super_admin" in roles

    return {
        "title": "Saya Role and Subscription Guidance",
        "content": build_role_subscription_guidance(context),
    }


def build_capability_context(question, user_context=None):
    """
    Return tenant-safe, read-only context based on the question.

    Saya's verified role/subscription guidance is always attached. Live records
    are added only when a matching capability is detected. A failure in one
    live capability never broadens scope and never aborts the entire answer.
    """

    capabilities = detect_ai_capabilities(question)
    blocks = []

    try:
        role_result = get_role_subscription_guidance_context(user_context)
        blocks.append(
            f"""
Capability: {role_result.get('title')}
Source: Verified role and subscription policy
Data:
{role_result.get('content')}
"""
        )
    except Exception:
        blocks.append(
            "Capability: Saya Role and Subscription Guidance\n"
            "Source: Verified role and subscription policy\n"
            "Data:\nRole/subscription guidance is temporarily unavailable. "
            "Do not infer or broaden access because this block is unavailable."
        )

    text = _lower(question)
    period = "month"
    if "week" in text:
        period = "week"
    elif "year" in text:
        period = "year"

    for capability in capabilities:
        try:
            if capability == "tenant_profile":
                result = get_tenant_profile_context(user_context)

            elif capability == "pricing_plans":
                result = get_pricing_plans_context(question, user_context)

            elif capability == "subscription_summary":
                result = get_subscription_context(user_context)

            elif capability == "premium_quotation":
                result = get_premium_quotation_context(user_context)

            elif capability == "weather":
                result = get_tenant_weather_context(user_context)

            elif capability == "notifications":
                result = get_notifications_context(user_context)

            elif capability == "leave_status":
                result = get_leave_status_context(user_context)

            elif capability == "leave_balance":
                result = get_leave_balance_context(user_context)

            elif capability == "assets":
                result = get_assets_context(user_context)

            elif capability == "attendance_summary":
                result = get_attendance_summary_context(user_context, period=period)

            elif capability == "performance_summary":
                result = get_performance_summary_context(user_context, period=period)

            elif capability == "team_scope":
                result = get_team_scope_context(user_context)

            elif capability == "projects":
                result = get_projects_context(user_context)

            else:
                continue

        except Exception:
            result = {
                "title": capability.replace("_", " ").title(),
                "content": (
                    "This live HRMS context is temporarily unavailable. "
                    "Do not infer values, records, identities, balances, approvals, or status from other users or tenants."
                ),
            }

        blocks.append(
            f"""
Capability: {result.get('title')}
Source: Live tenant-scoped YourComate HRMS data
Data:
{result.get('content')}
Scope rule: Treat 'not found' as 'no accessible record found for this login', not as proof that no record exists anywhere.
"""
        )

    return "\n\n".join(blocks).strip()


ROLE_MODULES = {
    "super_admin": [
        "product_overview", "pricing", "subscription", "billing", "premium", "trial",
        "companies", "users", "employees", "organisations", "employee_directory",
        "management_groups", "attendance", "leave", "projects", "team_approvals",
        "application_status", "grievance", "it_support", "leave_balances",
        "holiday_calendar", "attendance_mode_requests", "attendance_logs",
        "compoff_credits", "reports", "payroll", "recruitment", "training",
        "performance", "expenses", "assets", "notifications", "policies",
        "departments", "designations", "states", "settings", "audit_logs",
        "profile", "weather", "general_writing",
    ],
    "admin": [
        "product_overview", "pricing", "subscription", "billing", "premium", "trial",
        "employees", "organisations", "employee_directory", "management_groups",
        "attendance", "leave", "projects", "team_approvals", "application_status",
        "grievance", "it_support", "leave_balances", "holiday_calendar",
        "attendance_mode_requests", "attendance_logs", "compoff_credits", "reports",
        "performance", "assets", "notifications", "policies", "departments",
        "designations", "states", "payroll", "recruitment", "settings", "profile", "weather",
        "general_writing",
    ],
    "hr": [
        "product_overview", "pricing", "subscription", "trial",
        "employees", "organisations", "employee_directory", "management_groups",
        "attendance", "leave", "projects", "team_approvals", "application_status",
        "grievance", "it_support", "leave_balances", "holiday_calendar",
        "attendance_mode_requests", "attendance_logs", "compoff_credits", "reports",
        "performance", "assets", "notifications", "policies", "departments",
        "designations", "states", "payroll", "recruitment", "profile", "weather", "general_writing",
    ],
    "hr_admin": [
        "product_overview", "pricing", "subscription", "trial",
        "employees", "organisations", "employee_directory", "management_groups",
        "attendance", "leave", "projects", "team_approvals", "application_status",
        "grievance", "it_support", "leave_balances", "holiday_calendar",
        "attendance_mode_requests", "attendance_logs", "compoff_credits", "reports",
        "performance", "assets", "notifications", "policies", "departments",
        "designations", "states", "payroll", "recruitment", "profile", "weather", "general_writing",
    ],
    "hr_manager": [
        "product_overview", "pricing", "subscription", "trial",
        "employees", "organisations", "employee_directory", "management_groups",
        "attendance", "leave", "projects", "team_approvals", "application_status",
        "grievance", "it_support", "leave_balances", "holiday_calendar",
        "attendance_mode_requests", "attendance_logs", "compoff_credits", "reports",
        "performance", "assets", "notifications", "policies", "departments",
        "designations", "states", "payroll", "recruitment", "profile", "weather", "general_writing",
    ],
    "finance": [
        "product_overview", "pricing", "subscription", "trial",
        "attendance", "leave", "application_status", "grievance", "it_support",
        "assets", "notifications", "policies", "payroll", "reports", "recruitment", "profile",
        "weather", "general_writing",
    ],
    "accounts_finance": [
        "product_overview", "pricing", "subscription", "trial",
        "attendance", "leave", "application_status", "grievance", "it_support",
        "assets", "notifications", "policies", "payroll", "reports", "recruitment", "profile",
        "weather", "general_writing",
    ],
    "team_leader": [
        "product_overview", "pricing", "subscription", "trial",
        "attendance", "leave", "projects", "team_approvals", "application_status",
        "grievance", "it_support", "performance", "assets", "notifications",
        "policies", "payroll", "recruitment", "profile", "weather", "general_writing",
    ],
    "reporting_officer": [
        "product_overview", "pricing", "subscription", "trial",
        "attendance", "leave", "projects", "team_approvals", "application_status",
        "grievance", "it_support", "performance", "assets", "notifications",
        "policies", "payroll", "recruitment", "profile", "weather", "general_writing",
    ],
    "employee": [
        "product_overview", "pricing", "subscription", "trial",
        "attendance", "leave", "application_status", "grievance", "it_support",
        "assets", "notifications", "policies", "payroll", "projects", "profile",
        "weather", "general_writing",
    ],
}


PUBLIC_PRODUCT_MODULES = {
    "product_overview",
    "pricing",
    "subscription",
    "trial",
}

TENANT_ALWAYS_ALLOWED_MODULES = {
    "product_overview",
    "pricing",
    "subscription",
    "billing",
    "premium",
    "trial",
    "profile",
    "notifications",
    "general_writing",
    "weather",
}

AI_TO_TENANT_MODULE_ALIASES = {
    "attendance": {"attendance", "attendance_logs", "attendance_mode_requests"},
    "leave": {"leave", "apply_leave", "leave_balances", "compoff_credits", "holiday_calendar"},
    "projects": {"project", "projects", "project_progress", "project_assignment"},
    "payroll": {"payroll", "payslip", "salary"},
    "reports": {"reports", "report"},
    "employees": {"employees", "employee_management"},
    "employee_directory": {"employee_directory"},
    "management_groups": {"management_groups", "management_group"},
    "grievance": {"grievance", "grievances"},
    "it_support": {"it_support", "support"},
    "assets": {"assets", "asset"},
    "policies": {"policies", "policy"},
    "performance": {"performance"},
    "recruitment": {"recruitment", "hiring", "candidate_management"},
    "organisations": {"organisations", "organizations", "organisation", "organization"},
    "departments": {"departments", "department"},
    "designations": {"designations", "designation"},
    "states": {"states", "state"},
    "settings": {"settings", "system_settings"},
    "audit_logs": {"audit_logs", "audit"},
}

QUESTION_MODULE_KEYWORDS = {
    "product_overview": [
        "yourcomate", "your comate", "hrms features", "why yourcomate",
        "why should i choose", "benefits of yourcomate", "what can this hrms do",
    ],
    "pricing": [
        "pricing", "price", "plan price", "plan cost", "subscription cost",
        "essential plan", "growth plan", "premium plan", "compare plans",
        "how much is essential", "how much is growth", "how much is premium",
    ],
    "subscription": [
        "subscription", "current plan", "my plan", "trial", "demo",
        "days left", "expire", "expiry", "renew", "renewal", "upgrade",
        "upgrade plan", "upgrade to premium", "upgrade to growth", "upgrade to essential",
        "employee limit", "enabled modules", "allowed modules",
    ],
    "billing": [
        "billing", "payment", "razorpay", "invoice", "receipt", "pay now",
        "payment failed", "payment verification",
    ],
    "premium": [
        "premium request", "premium quotation", "premium quote", "contact sales",
        "quoted amount", "custom quote", "premium activation", "premium payment",
        "upgrade to premium",
    ],
    "weather": ["weather", "temperature", "rain", "forecast"],
    "notifications": ["notification", "notifications", "alert", "alerts", "unread"],
    "leave": [
        "leave", "cl", "el", "casual leave", "earned leave", "half day",
        "lwp", "leave balance", "leave status", "approved my leave", "comp off",
        "compoff", "holiday work",
    ],
    "attendance": [
        "attendance", "check in", "check-in", "check out", "check-out", "late",
        "on time", "absent", "present", "wfh", "work from home", "field attendance",
        "attendance correction",
    ],
    "projects": [
        "project", "projects", "task", "progress", "department projects",
        "collaborator", "project assignment",
    ],
    "grievance": ["grievance", "complaint"],
    "it_support": ["it support", "support ticket", "technical issue", "ticket escalation"],
    "assets": ["asset", "assets", "laptop", "hardware", "software allocation"],
    "reports": ["report", "reports", "excel", "attendance register", "dashboard analytics"],
    "payroll": [
        "payroll", "salary", "salary structure", "gross salary", "net salary",
        "payslip", "pay slip", "salary slip", "payroll run", "hr review",
        "finance approval", "salary disbursement", "bank verification", "bank details",
        "bank file", "loan advance", "loan recovery", "reimbursement", "reimbursements",
        "expense", "expenses", "expense claim", "expense claims", "travel expense",
        "tax declaration", "tds", "provident fund", "professional tax", "esi", "pf deduction", "lwp deduction",
    ],
    "performance": [
        "performance", "performance review", "rating", "weekly performance",
        "monthly performance",
    ],
    "recruitment": [
        "recruitment", "hiring request", "job opening", "job openings",
        "candidate", "candidates", "application pipeline", "interview schedule",
        "interview feedback", "offer letter", "background check", "onboarding candidate",
    ],
    "management_groups": [
        "management group", "management meeting", "meeting minutes", "minutes writer", "agenda",
    ],
    "team_approvals": [
        "team approval", "team approvals", "approve request", "first level approval",
        "reporting officer approval",
    ],
    "employee_directory": [
        "employee directory", "phone number", "employee contact", "staff contact",
    ],
    "employees": [
        "employee master", "employee list", "employee management",
        "create employee", "create an employee", "create new employee",
        "create a new employee", "add employee", "add an employee",
        "add new employee", "add a new employee", "register employee",
        "register a new employee", "resign employee", "alumni",
        "restore employee",
    ],
    "organisations": ["organisation master", "organization master", "organisation setup"],
    "departments": ["department master", "create department", "add department"],
    "designations": ["designation master", "create designation", "add designation"],
    "states": ["state master", "create state", "add state"],
    "policies": ["policy", "policies", "company policy"],
    "settings": ["system settings", "tenant settings", "company settings", "branding"],
    "audit_logs": ["audit log", "audit logs", "activity log"],
    "profile": [
        "profile", "my profile", "change password", "update password",
        "current password", "new password", "forgot password",
    ],
    "general_writing": [
        "write", "generate", "draft", "compose", "email", "mail", "letter",
        "caption", "message", "reason", "notice",
    ],
}


def detect_question_modules(question):
    text = _lower(question)
    matched_modules = []

    for module, keywords in QUESTION_MODULE_KEYWORDS.items():
        if _contains_any(text, keywords):
            matched_modules.append(module)

    if not matched_modules:
        matched_modules.append("general_writing")

    return sorted(set(matched_modules))


def allowed_modules_for_roles(roles):
    allowed = set(PUBLIC_PRODUCT_MODULES)

    normalized_roles = normalise_roles(roles or []) or ["employee"]

    for role in normalized_roles:
        allowed.update(ROLE_MODULES.get(role, []))

    if not allowed:
        allowed.update(ROLE_MODULES.get("employee", []))

    return sorted(allowed)



def _tenant_enabled_modules(user_context=None):
    """Resolve enabled modules from the trusted request/subscription context first."""

    context = user_context or {}
    module_sources = []

    if isinstance(context, dict):
        module_sources.extend([
            context.get("allowed_modules"),
            (context.get("_saya_subscription_snapshot") or {}).get("allowed_modules")
            if isinstance(context.get("_saya_subscription_snapshot"), dict)
            else None,
            (context.get("subscription") or {}).get("allowed_modules")
            if isinstance(context.get("subscription"), dict)
            else None,
        ])

    tenant = _tenant_document(context)
    if isinstance(tenant, dict):
        module_sources.append(tenant.get("allowed_modules"))

    for modules in module_sources:
        normalized = _normalise_module_list(modules)
        if normalized:
            return normalized

    return []



def _module_enabled_for_tenant(module, enabled_modules):
    if not enabled_modules or "all" in enabled_modules:
        return True

    if module in TENANT_ALWAYS_ALLOWED_MODULES:
        return True

    aliases = AI_TO_TENANT_MODULE_ALIASES.get(module, {module})
    return bool(set(enabled_modules).intersection(aliases))


def check_ai_role_permission(question, user_context=None):
    """
    Validate Saya's answer scope against verified roles and tenant modules.

    This function controls answer scope only. It never replaces route-level
    authorization and never grants an HRMS write action.
    """

    context = user_context or {}
    roles = _roles(context)
    primary_role = resolve_primary_role(roles)
    allowed_modules = allowed_modules_for_roles(roles)
    asked_modules = detect_question_modules(question)

    blocked_modules = [
        module
        for module in asked_modules
        if module not in allowed_modules
    ]

    enabled_modules = _tenant_enabled_modules(context)
    tenant_blocked_modules = [
        module
        for module in asked_modules
        if module not in blocked_modules
        and not _module_enabled_for_tenant(module, enabled_modules)
    ]

    snapshot = build_subscription_snapshot(context)
    subscription_profile = snapshot.get("profile_key") or "unknown"

    if blocked_modules:
        return {
            "allowed": False,
            "primary_role": primary_role,
            "effective_roles": roles,
            "subscription_profile": subscription_profile,
            "asked_modules": asked_modules,
            "allowed_modules": allowed_modules,
            "enabled_tenant_modules": enabled_modules,
            "blocked_modules": blocked_modules,
            "tenant_blocked_modules": tenant_blocked_modules,
            "message": (
                "This request belongs to a module that is not available for the "
                "logged-in role. Saya may explain which authorized role handles it, "
                "but must not provide private records or action instructions as if the "
                "current user had that permission."
            ),
        }

    if tenant_blocked_modules:
        return {
            "allowed": False,
            "primary_role": primary_role,
            "effective_roles": roles,
            "subscription_profile": subscription_profile,
            "asked_modules": asked_modules,
            "allowed_modules": allowed_modules,
            "enabled_tenant_modules": enabled_modules,
            "blocked_modules": [],
            "tenant_blocked_modules": tenant_blocked_modules,
            "message": (
                "This module is not enabled for the current tenant/subscription. "
                "Saya may explain the relevant upgrade or Admin contact path, but must "
                "not claim that the module is currently available."
            ),
        }

    return {
        "allowed": True,
        "primary_role": primary_role,
        "effective_roles": roles,
        "subscription_profile": subscription_profile,
        "asked_modules": asked_modules,
        "allowed_modules": allowed_modules,
        "enabled_tenant_modules": enabled_modules,
        "blocked_modules": [],
        "tenant_blocked_modules": [],
        "message": "",
    }