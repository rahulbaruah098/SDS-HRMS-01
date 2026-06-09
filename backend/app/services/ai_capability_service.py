import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from bson import ObjectId

from app.extensions import get_db


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


def _safe_doc(doc):
    if not doc:
        return {}

    cleaned = {}

    blocked_keys = {
        "password",
        "password_hash",
        "secret",
        "token",
        "jwt",
        "api_key",
        "refresh_token",
        "reset_token",
    }

    for key, value in dict(doc).items():
        if key in blocked_keys:
            continue

        if key == "_id":
            cleaned["id"] = str(value)
            continue

        if isinstance(value, ObjectId):
            cleaned[key] = str(value)
            continue

        if isinstance(value, datetime):
            cleaned[key] = value.isoformat()
            continue

        cleaned[key] = value

    return cleaned


def _contains_any(question, keywords):
    text = _lower(question)
    return any(keyword in text for keyword in keywords)


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
    Detects which HRMS real-data capabilities should be attached to the AI answer.
    This is deterministic and role-safe.
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



    if _contains_any(text, ["cl left", "casual leave left", "el left", "earned leave left", "leave balance", "leave balances"]):
        capabilities.add("leave_balance")

    if _contains_any(text, ["my assets", "asset assigned", "assets assigned", "how many assets", "employee asset"]):
        capabilities.add("assets")

    if _contains_any(text, ["late", "on time", "attendance summary", "how many days present", "how many days absent", "office on time"]):
        capabilities.add("attendance_summary")

    if _contains_any(text, ["performance", "weekly performance", "monthly performance", "yearly performance", "this week performance"]):
        capabilities.add("performance_summary")

    if _contains_any(text, ["project list", "department projects", "list projects", "my projects", "projects of department"]):
        capabilities.add("projects")

    return list(capabilities)

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

    Add in backend .env if needed:
    WEATHER_CITY=Guwahati
    WEATHER_LAT=26.1445
    WEATHER_LON=91.7362
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

    except Exception as error:
        return {
            "title": "Weather",
            "content": f"Weather could not be fetched right now. Reason: {str(error)}"
        }


def get_notifications_context(user_context=None, limit=8):
    db = get_db()

    tenant_filter = _tenant_query(user_context)
    user_values = _user_values(user_context)

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    if user_values:
        query_parts.append({
            "$or": [
                {"user_id": {"$in": user_values}},
                {"recipient_id": {"$in": user_values}},
                {"target_user_id": {"$in": user_values}},
                {"created_for": {"$in": user_values}},
                {"audience": "all"},
                {"target": "all"},
            ]
        })

    query = {"$and": query_parts} if query_parts else {}

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
    employee_values = _employee_values(user_context)
    user_values = _user_values(user_context)

    person_values = employee_values + [
        item for item in user_values
        if item not in employee_values
    ]

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    if person_values:
        query_parts.append({
            "$or": [
                {"employee_id": {"$in": person_values}},
                {"user_id": {"$in": person_values}},
                {"created_by": {"$in": person_values}},
                {"applicant_id": {"$in": person_values}},
            ]
        })

    query = {"$and": query_parts} if query_parts else {}

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

        status = (
            doc.get("status")
            or doc.get("approval_status")
            or "Pending"
        )

        start_date = (
            doc.get("start_date")
            or doc.get("from_date")
            or doc.get("date_from")
            or ""
        )

        end_date = (
            doc.get("end_date")
            or doc.get("to_date")
            or doc.get("date_to")
            or ""
        )

        approval_stage = (
            doc.get("approval_stage")
            or doc.get("current_step")
            or doc.get("pending_with_role")
            or ""
        )

        pending_with_role = (
            doc.get("pending_with_role")
            or doc.get("current_step")
            or ""
        )

        team_leader_status = (
            doc.get("team_leader_status")
            or doc.get("tl_status")
            or doc.get("team_leader_approval_status")
            or ""
        )

        reporting_officer_status = (
            doc.get("reporting_officer_status")
            or doc.get("ro_status")
            or doc.get("reporting_officer_approval_status")
            or ""
        )

        hr_status = (
            doc.get("hr_status")
            or doc.get("hr_approval_status")
            or ""
        )

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

                history_lines.append(
                    f"{action} {history_status} by {by_name}. {remark}".strip()
                )

        if status.lower() in ["approved", "final_approved", "completed"]:
            readable_position = "Your leave is approved."
        elif status.lower() in ["rejected", "declined"]:
            readable_position = "Your leave is rejected."
        elif pending_with_role in ["team_leader", "tl"]:
            readable_position = "Your leave is currently waiting for Team Leader approval."
        elif pending_with_role in ["reporting_officer", "ro"]:
            readable_position = "Your leave is currently waiting for Reporting Officer approval."
        elif pending_with_role in ["hr", "hr_admin", "hr_manager"]:
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
    employee_values = _employee_values(user_context)
    user_values = _user_values(user_context)

    person_values = employee_values + [
        item for item in user_values
        if item not in employee_values
    ]

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    if person_values:
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
    employee_values = _employee_values(user_context)
    user_values = _user_values(user_context)

    person_values = employee_values + [item for item in user_values if item not in employee_values]

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    if person_values:
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
    employee_values = _employee_values(user_context)
    user_values = _user_values(user_context)

    person_values = employee_values + [item for item in user_values if item not in employee_values]

    query_parts = [
        {
            "$or": [
                {"date": {"$gte": start.date().isoformat(), "$lte": end.date().isoformat()}},
                {"created_at": {"$gte": start, "$lte": end}},
                {"check_in_at": {"$gte": start, "$lte": end}},
            ]
        }
    ]

    if tenant_filter:
        query_parts.append(tenant_filter)

    if person_values:
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
    employee_values = _employee_values(user_context)
    user_values = _user_values(user_context)

    person_values = employee_values + [item for item in user_values if item not in employee_values]

    query_parts = [
        {
            "$or": [
                {"created_at": {"$gte": start, "$lte": end}},
                {"review_date": {"$gte": start.date().isoformat(), "$lte": end.date().isoformat()}},
            ]
        }
    ]

    if tenant_filter:
        query_parts.append(tenant_filter)

    if person_values:
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


def get_projects_context(user_context=None, limit=12):
    db = get_db()

    tenant_filter = _tenant_query(user_context)

    employee = user_context.get("employee") if isinstance(user_context, dict) else {}
    department = ""

    if isinstance(employee, dict):
        department = (
            employee.get("department")
            or employee.get("department_name")
            or ""
        )

    if not department and isinstance(user_context, dict):
        department = user_context.get("department") or user_context.get("department_name") or ""

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    if department:
        query_parts.append({
            "$or": [
                {"department": department},
                {"department_name": department},
            ]
        })

    query = {"$and": query_parts} if query_parts else {}

    docs = list(
        db.projects
        .find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
    )

    if not docs:
        return {
            "title": "Projects",
            "content": "No department projects were found for this user."
        }

    lines = []

    for index, doc in enumerate(docs, start=1):
        name = doc.get("name") or doc.get("title") or doc.get("project_name") or "Project"
        status = doc.get("status") or "N/A"
        progress = doc.get("progress") or doc.get("progress_percent") or doc.get("completion") or "N/A"

        lines.append(f"{index}. {name} | Status: {status} | Progress: {progress}")

    return {
        "title": "Projects",
        "content": "\n".join(lines)
    }


def build_capability_context(question, user_context=None):
    """
    Returns real HRMS data context based on user question.
    This does not perform write actions.
    """

    capabilities = detect_ai_capabilities(question)

    if not capabilities:
        return ""

    blocks = []

    text = _lower(question)

    period = "month"
    if "week" in text:
        period = "week"
    elif "year" in text:
        period = "year"

    for capability in capabilities:
        if capability == "tenant_profile":
            result = get_tenant_profile_context(user_context)

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

        elif capability == "projects":
            result = get_projects_context(user_context)

        else:
            continue

        blocks.append(
            f"""
Capability: {result.get("title")}
Data:
{result.get("content")}
"""
        )

    return "\n\n".join(blocks).strip()

ROLE_MODULES = {
    "super_admin": [
        "companies",
        "users",
        "password_requests",
        "employees",
        "organisations",
        "employee_directory",
        "management_groups",
        "attendance",
        "leave",
        "projects",
        "team_approvals",
        "application_status",
        "grievance",
        "it_support",
        "leave_balances",
        "holiday_calendar",
        "attendance_mode_requests",
        "attendance_logs",
        "compoff_credits",
        "reports",
        "payroll",
        "recruitment",
        "training",
        "performance",
        "expenses",
        "assets",
        "notifications",
        "policies",
        "departments",
        "designations",
        "states",
        "settings",
        "audit_logs",
        "profile",
        "weather",
        "general_writing",
    ],
    "admin": [
        "employees",
        "organisations",
        "employee_directory",
        "management_groups",
        "attendance",
        "leave",
        "projects",
        "team_approvals",
        "application_status",
        "grievance",
        "it_support",
        "leave_balances",
        "holiday_calendar",
        "attendance_mode_requests",
        "attendance_logs",
        "compoff_credits",
        "reports",
        "performance",
        "assets",
        "notifications",
        "policies",
        "departments",
        "designations",
        "states",
        "profile",
        "weather",
        "general_writing",
    ],
    "hr": [
        "employees",
        "organisations",
        "employee_directory",
        "management_groups",
        "attendance",
        "leave",
        "projects",
        "team_approvals",
        "application_status",
        "grievance",
        "it_support",
        "leave_balances",
        "holiday_calendar",
        "attendance_mode_requests",
        "attendance_logs",
        "compoff_credits",
        "reports",
        "performance",
        "assets",
        "notifications",
        "policies",
        "departments",
        "designations",
        "states",
        "profile",
        "weather",
        "general_writing",
    ],
    "hr_admin": [
        "employees",
        "organisations",
        "employee_directory",
        "management_groups",
        "attendance",
        "leave",
        "projects",
        "team_approvals",
        "application_status",
        "grievance",
        "it_support",
        "leave_balances",
        "holiday_calendar",
        "attendance_mode_requests",
        "attendance_logs",
        "compoff_credits",
        "reports",
        "performance",
        "assets",
        "notifications",
        "policies",
        "departments",
        "designations",
        "states",
        "profile",
        "weather",
        "general_writing",
    ],
    "hr_manager": [
        "employees",
        "organisations",
        "employee_directory",
        "management_groups",
        "attendance",
        "leave",
        "projects",
        "team_approvals",
        "application_status",
        "grievance",
        "it_support",
        "leave_balances",
        "holiday_calendar",
        "attendance_mode_requests",
        "attendance_logs",
        "compoff_credits",
        "reports",
        "performance",
        "assets",
        "notifications",
        "policies",
        "departments",
        "designations",
        "states",
        "profile",
        "weather",
        "general_writing",
    ],
    "team_leader": [
        "attendance",
        "leave",
        "projects",
        "team_approvals",
        "application_status",
        "grievance",
        "it_support",
        "performance",
        "assets",
        "notifications",
        "policies",
        "profile",
        "weather",
        "general_writing",
    ],
    "reporting_officer": [
        "attendance",
        "leave",
        "projects",
        "team_approvals",
        "application_status",
        "grievance",
        "it_support",
        "performance",
        "assets",
        "notifications",
        "policies",
        "profile",
        "weather",
        "general_writing",
    ],
    "ro": [
        "attendance",
        "leave",
        "projects",
        "team_approvals",
        "application_status",
        "grievance",
        "it_support",
        "performance",
        "assets",
        "notifications",
        "policies",
        "profile",
        "weather",
        "general_writing",
    ],
    "manager": [
        "attendance",
        "leave",
        "projects",
        "team_approvals",
        "application_status",
        "grievance",
        "it_support",
        "performance",
        "assets",
        "notifications",
        "policies",
        "profile",
        "weather",
        "general_writing",
    ],
    "employee": [
        "attendance",
        "leave",
        "application_status",
        "grievance",
        "it_support",
        "assets",
        "notifications",
        "policies",
        "profile",
        "weather",
        "general_writing",
    ],
}


QUESTION_MODULE_KEYWORDS = {
    "weather": ["weather", "temperature", "rain", "forecast"],
    "notifications": ["notification", "notifications", "alert", "alerts", "unread"],
    "leave": [
        "leave",
        "cl",
        "el",
        "casual leave",
        "earned leave",
        "half day",
        "leave balance",
        "leave status",
        "approved my leave",
    ],
    "attendance": [
        "attendance",
        "check in",
        "check-in",
        "check out",
        "check-out",
        "late",
        "on time",
        "absent",
        "present",
        "wfh",
        "field",
    ],
    "projects": ["project", "projects", "task", "progress", "department projects"],
    "grievance": ["grievance", "complaint"],
    "it_support": ["it support", "ticket", "issue", "technical issue"],
    "assets": ["asset", "assets", "laptop", "hardware", "software"],
    "reports": ["report", "reports", "excel", "attendance register"],
    "performance": ["performance", "review", "rating", "weekly performance", "monthly performance"],
    "management_groups": [
        "management group",
        "meeting",
        "minutes",
        "minutes writer",
        "agenda",
    ],
    "team_approvals": ["approval", "approvals", "team approval", "approve request"],
    "employee_directory": ["employee directory", "phone number", "contact", "employee contact"],
    "employees": ["employee master", "employee list", "employee management"],
    "policies": ["policy", "policies"],
    "profile": ["profile", "my profile"],
    "general_writing": [
        "write",
        "generate",
        "draft",
        "compose",
        "email",
        "mail",
        "letter",
        "caption",
        "message",
        "reason",
        "notice",
    ],
}


def detect_question_modules(question):
    text = _lower(question)

    matched_modules = []

    for module, keywords in QUESTION_MODULE_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            matched_modules.append(module)

    if not matched_modules:
        matched_modules.append("general_writing")

    return matched_modules


def allowed_modules_for_roles(roles):
    allowed = set()

    for role in roles or []:
        normalized_role = _lower(role)
        for module in ROLE_MODULES.get(normalized_role, []):
            allowed.add(module)

    if not allowed:
        for module in ROLE_MODULES.get("employee", []):
            allowed.add(module)

    return sorted(allowed)


def check_ai_role_permission(question, user_context=None):
    roles = []

    if isinstance(user_context, dict):
        roles = user_context.get("roles") or []

        if not roles and user_context.get("role"):
            roles = [user_context.get("role")]

    if not roles:
        roles = ["employee"]

    allowed_modules = allowed_modules_for_roles(roles)
    asked_modules = detect_question_modules(question)

    blocked_modules = [
        module for module in asked_modules
        if module not in allowed_modules
    ]

    if blocked_modules:
        return {
            "allowed": False,
            "asked_modules": asked_modules,
            "allowed_modules": allowed_modules,
            "blocked_modules": blocked_modules,
            "message": (
                "This question belongs to a module that is not available for your login role. "
                "Please ask about the modules available in your HRMS account, or contact HR/Admin if you need access."
            )
        }

    return {
        "allowed": True,
        "asked_modules": asked_modules,
        "allowed_modules": allowed_modules,
        "blocked_modules": [],
        "message": ""
    }