from datetime import datetime, date, time
from zoneinfo import ZoneInfo

from bson import ObjectId
from flask import Blueprint, jsonify, g, request

from app.extensions import get_db
from app.utils.auth import current_user_required, roles_required, audit
from app.utils.serializers import clean_doc


celebrations_bp = Blueprint("celebrations", __name__)

try:
    LOCAL_TZ = ZoneInfo("Asia/Kolkata")
except Exception:
    LOCAL_TZ = datetime.now().astimezone().tzinfo
    
CELEBRATION_RELEASE_TIME = time(10, 0)


BIRTHDAY_MESSAGE = """Wishing you a very Happy Birthday!

On behalf of the entire team, we extend our warmest wishes to you on your special day. Your dedication, hard work, and contribution to the organization are truly appreciated.

May this year bring you good health, happiness, success, and new opportunities. We hope you have a wonderful birthday and a great year ahead.

Happy Birthday!"""


def now_local():
    return datetime.now(LOCAL_TZ)


def now_utc():
    return datetime.utcnow()


def today_local_date():
    return now_local().date()


def today_key():
    return today_local_date().isoformat()


def current_tenant_id():
    return (
        getattr(g, "tenant_id", None)
        or g.current_user.get("tenant_id")
        or "sds"
    )


def normalize_text(value):
    return str(value or "").strip()


def safe_object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def parse_date(value):
    if not value:
        return None

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    raw = str(value).strip()

    if not raw:
        return None

    formats = [
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y/%m/%d",
        "%d %b %Y",
        "%d %B %Y",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(raw[:10], fmt).date()
        except Exception:
            pass

    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except Exception:
        return None


def is_today_month_day(value):
    parsed = parse_date(value)

    if not parsed:
        return False

    today = today_local_date()
    return parsed.day == today.day and parsed.month == today.month


def completed_years(value):
    parsed = parse_date(value)

    if not parsed:
        return 0

    today = today_local_date()

    years = today.year - parsed.year

    if (today.month, today.day) < (parsed.month, parsed.day):
        years -= 1

    return max(years, 0)


def release_time_reached():
    current = now_local()
    return current.time() >= CELEBRATION_RELEASE_TIME


def tenant_name_for(tenant_id):
    db = get_db()

    tenant = (
        db.tenants.find_one({"tenant_id": tenant_id})
        or db.tenants.find_one({"id": tenant_id})
        or db.tenants.find_one({"slug": tenant_id})
        or db.companies.find_one({"tenant_id": tenant_id})
    )

    if not tenant:
        return tenant_id.upper()

    return (
        tenant.get("name")
        or tenant.get("company_name")
        or tenant.get("tenant_name")
        or tenant_id.upper()
    )


def active_employee_query(tenant_id):
    return {
        "tenant_id": tenant_id,
        "$and": [
            {
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False},
                ],
            },
            {
                "$or": [
                    {"is_active": {"$exists": False}},
                    {"is_active": True},
                    {"is_active": "true"},
                    {"is_active": "True"},
                    {"status": "Active"},
                    {"status": "active"},
                    {"employment_status": "Active"},
                    {"employment_status": "active"},
                ],
            },
        ],
    }


def active_user_query(tenant_id):
    return {
        "tenant_id": tenant_id,
        "$and": [
            {
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False},
                ],
            },
            {
                "$or": [
                    {"is_active": {"$exists": False}},
                    {"is_active": True},
                    {"is_active": "true"},
                    {"is_active": "True"},
                    {"status": "Active"},
                    {"status": "active"},
                ],
            },
        ],
    }


def employee_display_name(employee):
    return (
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or employee.get("email")
        or "Employee"
    )


def employee_user_id(employee):
    return (
        employee.get("user_id")
        or employee.get("linked_user_id")
        or employee.get("employee_user_id")
        or ""
    )


def create_notification(user_id, title, body, tenant_id, celebration_id, meta=None):
    if not user_id:
        return None

    db = get_db()
    now = now_utc()

    existing = db.notifications.find_one({
        "user_id": str(user_id),
        "target": "celebrations",
        "meta.celebration_id": str(celebration_id),
    })

    if existing:
        return existing.get("_id")

    payload = {
        "tenant_id": tenant_id,
        "user_id": str(user_id),
        "title": title,
        "body": body,
        "read": False,
        "status": "unread",
        "target": "celebrations",
        "meta": {
            "celebration_id": str(celebration_id),
            **(meta or {}),
        },
        "created_at": now,
        "updated_at": now,
    }

    result = db.notifications.insert_one(payload)
    return result.inserted_id


def ensure_celebration(payload):
    db = get_db()

    existing = db.celebrations.find_one({
        "tenant_id": payload["tenant_id"],
        "event_type": payload["event_type"],
        "employee_id": payload["employee_id"],
        "date_key": payload["date_key"],
    })

    if existing:
        return existing, False

    result = db.celebrations.insert_one(payload)
    payload["_id"] = result.inserted_id

    return payload, True


def notify_tenant_members(celebration):
    db = get_db()

    tenant_id = celebration.get("tenant_id")
    event_type = celebration.get("event_type")
    employee_name = celebration.get("employee_name")
    tenant_name = celebration.get("tenant_name")
    year_count = celebration.get("year_count") or 0

    users = list(db.users.find(active_user_query(tenant_id)))

    celebration_id = celebration.get("_id")

    if event_type == "birthday":
        target_user_id = celebration.get("employee_user_id")

        create_notification(
            target_user_id,
            "Happy Birthday!",
            f"{tenant_name} wishes you a very Happy Birthday, {employee_name}.",
            tenant_id,
            celebration_id,
            {
                "event_type": "birthday",
                "employee_name": employee_name,
            },
        )

        for user in users:
            uid = str(user.get("_id"))

            if target_user_id and uid == str(target_user_id):
                continue

            create_notification(
                uid,
                "Birthday Today",
                f"{employee_name}'s birthday is today. Join {tenant_name} in wishing them a Happy Birthday.",
                tenant_id,
                celebration_id,
                {
                    "event_type": "birthday",
                    "employee_name": employee_name,
                },
            )

    if event_type == "work_anniversary":
        target_user_id = celebration.get("employee_user_id")

        year_label = "1 year" if year_count == 1 else f"{year_count} years"

        create_notification(
            target_user_id,
            "Work Anniversary Congratulations!",
            f"{tenant_name} congratulates you on completing {year_label} with the organization.",
            tenant_id,
            celebration_id,
            {
                "event_type": "work_anniversary",
                "employee_name": employee_name,
                "year_count": year_count,
            },
        )

        for user in users:
            uid = str(user.get("_id"))

            if target_user_id and uid == str(target_user_id):
                continue

            create_notification(
                uid,
                "Work Anniversary Today",
                f"{employee_name} has completed {year_label} with {tenant_name} today.",
                tenant_id,
                celebration_id,
                {
                    "event_type": "work_anniversary",
                    "employee_name": employee_name,
                    "year_count": year_count,
                },
            )


def build_birthday_payload(employee, tenant_id, tenant_name):
    now = now_utc()
    employee_id = str(employee.get("_id"))
    name = employee_display_name(employee)

    return {
        "tenant_id": tenant_id,
        "tenant_name": tenant_name,
        "event_type": "birthday",
        "date_key": today_key(),
        "scheduled_time": "10:00",
        "employee_id": employee_id,
        "employee_user_id": str(employee_user_id(employee) or ""),
        "employee_name": name,
        "employee_code": employee.get("emp_code") or employee.get("employee_id") or "",
        "department": employee.get("department") or "",
        "designation": employee.get("designation") or "",
        "date_of_birth": employee.get("date_of_birth") or employee.get("dob") or "",
        "joining_date": employee.get("joining_date") or "",
        "year_count": 0,
        "title": f"Happy Birthday, {name}!",
        "message": BIRTHDAY_MESSAGE,
        "highlight_name": tenant_name,
        "animation_type": "birthday_confetti",
        "status": "active",
        "is_active": True,
        "notification_sent": False,
        "notification_sent_at": None,
        "created_at": now,
        "updated_at": now,
    }


def build_anniversary_payload(employee, tenant_id, tenant_name, years):
    now = now_utc()
    employee_id = str(employee.get("_id"))
    name = employee_display_name(employee)
    year_label = "1 Year" if years == 1 else f"{years} Years"

    message = (
        f"Congratulations on completing {year_label} with {tenant_name}!\n\n"
        f"Your dedication, hard work, and contribution to the organization are sincerely appreciated. "
        f"We wish you continued success, growth, and happiness in the years ahead."
    )

    return {
        "tenant_id": tenant_id,
        "tenant_name": tenant_name,
        "event_type": "work_anniversary",
        "date_key": today_key(),
        "scheduled_time": "10:00",
        "employee_id": employee_id,
        "employee_user_id": str(employee_user_id(employee) or ""),
        "employee_name": name,
        "employee_code": employee.get("emp_code") or employee.get("employee_id") or "",
        "department": employee.get("department") or "",
        "designation": employee.get("designation") or "",
        "date_of_birth": employee.get("date_of_birth") or employee.get("dob") or "",
        "joining_date": employee.get("joining_date") or "",
        "year_count": years,
        "title": f"Congratulations, {name}!",
        "message": message,
        "highlight_name": tenant_name,
        "animation_type": "anniversary_sparkle",
        "status": "active",
        "is_active": True,
        "notification_sent": False,
        "notification_sent_at": None,
        "created_at": now,
        "updated_at": now,
    }


def generate_today_celebrations_for_tenant(tenant_id, force=False):
    db = get_db()

    if not force and not release_time_reached():
        return {
            "status": "not_due",
            "message": "Celebrations will be released at 10:00 AM.",
            "items": [],
            "created": 0,
            "notified": 0,
        }

    tenant_name = tenant_name_for(tenant_id)
    employees = list(db.employees.find(active_employee_query(tenant_id)))

    items = []
    created_count = 0
    notified_count = 0

    for employee in employees:
        dob = employee.get("date_of_birth") or employee.get("dob")

        if is_today_month_day(dob):
            payload = build_birthday_payload(employee, tenant_id, tenant_name)
            celebration, created = ensure_celebration(payload)

            if created:
                created_count += 1

            if not celebration.get("notification_sent"):
                notify_tenant_members(celebration)
                db.celebrations.update_one(
                    {"_id": celebration["_id"]},
                    {
                        "$set": {
                            "notification_sent": True,
                            "notification_sent_at": now_utc(),
                            "updated_at": now_utc(),
                        }
                    },
                )
                celebration["notification_sent"] = True
                notified_count += 1

            items.append(celebration)

        joining_date = employee.get("joining_date") or employee.get("date_of_joining")
        years = completed_years(joining_date)

        if years >= 1 and is_today_month_day(joining_date):
            payload = build_anniversary_payload(employee, tenant_id, tenant_name, years)
            celebration, created = ensure_celebration(payload)

            if created:
                created_count += 1

            if not celebration.get("notification_sent"):
                notify_tenant_members(celebration)
                db.celebrations.update_one(
                    {"_id": celebration["_id"]},
                    {
                        "$set": {
                            "notification_sent": True,
                            "notification_sent_at": now_utc(),
                            "updated_at": now_utc(),
                        }
                    },
                )
                celebration["notification_sent"] = True
                notified_count += 1

            items.append(celebration)

    audit("generate_today_celebrations", "celebrations", tenant_id, {
        "tenant_id": tenant_id,
        "date_key": today_key(),
        "created": created_count,
        "notified": notified_count,
    })

    return {
        "status": "success",
        "message": "Today celebrations generated successfully.",
        "items": items,
        "created": created_count,
        "notified": notified_count,
    }


@celebrations_bp.get("/today")
@current_user_required
def today_celebrations():
    tenant_id = current_tenant_id()

    generate_today_celebrations_for_tenant(tenant_id, force=False)

    db = get_db()

    q = {
        "tenant_id": tenant_id,
        "date_key": today_key(),
        "status": "active",
        "is_active": True,
    }

    items = list(
        db.celebrations
        .find(q)
        .sort([("event_type", 1), ("employee_name", 1)])
    )

    return jsonify({
        "items": clean_doc(items),
        "date_key": today_key(),
        "release_time": "10:00",
        "released": release_time_reached(),
    })


@celebrations_bp.post("/run-today")
@roles_required("super_admin", "admin", "hr_admin", "hr_manager", "hr")
def run_today_celebrations():
    tenant_id = normalize_text(request.json.get("tenant_id") if request.is_json else "") or current_tenant_id()

    if g.current_user.get("role") != "super_admin":
        tenant_id = current_tenant_id()

    force = bool(request.json.get("force")) if request.is_json else False

    result = generate_today_celebrations_for_tenant(tenant_id, force=force)

    return jsonify(clean_doc(result))


@celebrations_bp.get("/my")
@current_user_required
def my_celebrations():
    db = get_db()

    tenant_id = current_tenant_id()

    user_id = str(g.current_user.get("_id") or g.current_user.get("id") or "")

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "$or": [
            {"user_id": user_id},
            {"linked_user_id": user_id},
            {"employee_user_id": user_id},
            {"email": g.current_user.get("email")},
        ],
    })

    if not employee:
        return jsonify({
            "items": [],
            "date_key": today_key(),
        })

    items = list(
        db.celebrations.find({
            "tenant_id": tenant_id,
            "employee_id": str(employee.get("_id")),
            "date_key": today_key(),
            "status": "active",
            "is_active": True,
        })
    )

    return jsonify({
        "items": clean_doc(items),
        "date_key": today_key(),
    })