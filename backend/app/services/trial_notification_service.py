from datetime import datetime, timezone

from bson import ObjectId
from flask import current_app

from app.services.email_service import send_trial_reminder_email
from app.services.tenant_service import (
    is_lifetime_tenant,
    is_paid_tenant,
    is_sds_tenant,
    parse_datetime,
)


class TrialNotificationServiceError(RuntimeError):
    def __init__(self, message, status_code=400, code="trial_notification_error"):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def now_utc():
    return datetime.now(timezone.utc)


def safe_str(value):
    return str(value or "").strip()


def safe_lower(value):
    return safe_str(value).lower()


def to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def config_value(key, default=None):
    try:
        return current_app.config.get(key, default)
    except RuntimeError:
        return default


def as_object_id(value):
    text = safe_str(value)

    if text and ObjectId.is_valid(text):
        return ObjectId(text)

    return None


def tenant_identifier(tenant):
    if not tenant:
        return ""

    return (
        safe_str(tenant.get("tenant_id"))
        or safe_str(tenant.get("_id"))
        or safe_str(tenant.get("id"))
    )


def tenant_name(tenant):
    if not tenant:
        return "Company"

    return (
        safe_str(tenant.get("company_name"))
        or safe_str(tenant.get("tenant_name"))
        or safe_str(tenant.get("name"))
        or "Company"
    )


def tenant_email(tenant):
    if not tenant:
        return ""

    return (
        safe_str(tenant.get("company_email"))
        or safe_str(tenant.get("email"))
        or safe_str(tenant.get("contact_email"))
        or safe_str(tenant.get("registered_email"))
    )


def tenant_status(tenant):
    return safe_lower((tenant or {}).get("status"))


def tenant_plan_type(tenant):
    return safe_lower((tenant or {}).get("plan_type"))


def trial_end_date(tenant):
    return parse_datetime((tenant or {}).get("trial_end_date"))


def days_left_until_trial_end(tenant, reference_time=None):
    end_date = trial_end_date(tenant)

    if not end_date:
        return None

    reference_time = reference_time or now_utc()

    if reference_time.tzinfo is None:
        reference_time = reference_time.replace(tzinfo=timezone.utc)

    remaining_seconds = (end_date - reference_time).total_seconds()

    if remaining_seconds <= 0:
        return 0

    # Ceiling day count without importing math.
    return int((remaining_seconds + 86399) // 86400)


def configured_reminder_days():
    raw_days = config_value("TRIAL_REMINDER_DAYS", [20, 25, 29, 30])
    demo_duration = to_int(config_value("DEMO_DURATION_DAYS", 30), 30)

    if isinstance(raw_days, str):
        values = raw_days.split(",")
    elif isinstance(raw_days, (list, tuple, set)):
        values = list(raw_days)
    else:
        values = [20, 25, 29, 30]

    reminder_days = []

    for value in values:
        day = to_int(value, None)

        if day is None or day <= 0:
            continue

        if day not in reminder_days:
            reminder_days.append(day)

    if not reminder_days:
        reminder_days = [20, 25, 29, 30]

    return sorted(day for day in reminder_days if day <= demo_duration)


def reminder_type_for_tenant(tenant, reference_time=None):
    """
    Returns a stable reminder type for today.

    Example for 30-day demo:
    - Day 20 reminder -> "day_20"
    - Day 25 reminder -> "day_25"
    - Day 29 reminder -> "day_29"
    - Day 30 / expired -> "expired"
    """

    end_date = trial_end_date(tenant)

    if not end_date:
        return None

    reference_time = reference_time or now_utc()

    demo_duration = to_int(config_value("DEMO_DURATION_DAYS", 30), 30)
    days_left = days_left_until_trial_end(tenant, reference_time)

    if days_left is None:
        return None

    if days_left <= 0:
        return "expired"

    days_used = max(demo_duration - days_left, 0)

    for reminder_day in configured_reminder_days():
        if days_used >= reminder_day:
            return f"day_{reminder_day}"

    return None


def reminder_already_sent(db, tenant, reminder_type):
    tenant_id = tenant_identifier(tenant)

    if not tenant_id or not reminder_type:
        return True

    return bool(
        db.trial_notifications.find_one(
            {
                "tenant_id": tenant_id,
                "reminder_type": reminder_type,
                "is_deleted": {"$ne": True},
            }
        )
    )


def record_trial_notification(db, tenant, reminder_type, email_result=None, in_app_count=0):
    tenant_id = tenant_identifier(tenant)
    now = now_utc()

    doc = {
        "tenant_id": tenant_id,
        "tenant_object_id": tenant.get("_id"),
        "tenant_code": tenant.get("tenant_code"),
        "company_name": tenant_name(tenant),
        "company_email": tenant_email(tenant),
        "reminder_type": reminder_type,
        "plan_type": tenant.get("plan_type"),
        "status": tenant.get("status"),
        "trial_start_date": tenant.get("trial_start_date"),
        "trial_end_date": tenant.get("trial_end_date"),
        "email_result": email_result or {},
        "in_app_notification_count": in_app_count,
        "sent_at": now,
        "created_at": now,
        "updated_at": now,
        "is_deleted": False,
    }

    result = db.trial_notifications.insert_one(doc)
    doc["_id"] = result.inserted_id

    return doc


def build_trial_message(tenant, days_left):
    company = tenant_name(tenant)

    if days_left <= 0:
        return {
            "title": "YourComate HRMS Demo Expired",
            "body": (
                f"{company}'s 30-day demo has expired. "
                "Please subscribe to the paid version to continue using YourComate HRMS."
            ),
            "priority": "urgent",
            "target": "subscription_expired",
        }

    if days_left == 1:
        return {
            "title": "YourComate HRMS Demo Expires Tomorrow",
            "body": (
                f"{company}'s demo will expire tomorrow. "
                "Please upgrade now to avoid service interruption."
            ),
            "priority": "high",
            "target": "billing",
        }

    return {
        "title": f"YourComate HRMS Demo Expires in {days_left} Days",
        "body": (
            f"{company}'s demo will expire in {days_left} days. "
            "Please subscribe before expiry to continue using the HRMS."
        ),
        "priority": "high",
        "target": "billing",
    }


def get_tenant_users_for_notifications(db, tenant):
    tenant_id = tenant_identifier(tenant)

    if not tenant_id:
        return []

    query = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "disabled"},
        "active": {"$ne": False},
    }

    users = list(db.users.find(query))

    if users:
        return users

    # Fallback for projects that use employee records for notification audience.
    employees = list(
        db.employees.find(
            {
                "tenant_id": tenant_id,
                "is_deleted": {"$ne": True},
                "status": {"$ne": "inactive"},
            }
        )
    )

    fallback_users = []

    for employee in employees:
        user_id = employee.get("user_id") or employee.get("_id")

        fallback_users.append(
            {
                "_id": user_id,
                "tenant_id": tenant_id,
                "name": employee.get("name") or employee.get("full_name"),
                "email": employee.get("email") or employee.get("work_email"),
                "role": employee.get("role") or "employee",
                "roles": employee.get("roles") or [employee.get("role") or "employee"],
            }
        )

    return fallback_users


def build_in_app_notification_doc(tenant, user, message, reminder_type, days_left):
    now = now_utc()
    tenant_id = tenant_identifier(tenant)
    user_id = safe_str(user.get("_id") or user.get("user_id"))

    return {
        "tenant_id": tenant_id,
        "tenant_name": tenant_name(tenant),
        "target_tenant_id": tenant_id,
        "target_tenant_name": tenant_name(tenant),
        "user_id": user_id,
        "user_ids": [user_id] if user_id else [],
        "title": message["title"],
        "body": message["body"],
        "message": message["body"],
        "notification_type": "saas_trial_reminder",
        "priority": message["priority"],
        "target": message["target"],
        "target_scope": "selected_users",
        "audience": "selected_users",
        "show_popup": True,
        "popup_seen": False,
        "popup_seen_at": "",
        "read": False,
        "status": "unread",
        "created_at": now,
        "updated_at": now,
        "created_by": "system",
        "created_by_name": "YourComate SaaS",
        "created_by_role": ["system"],
        "is_deleted": False,
        "meta": {
            "saas_trial_reminder": True,
            "reminder_type": reminder_type,
            "days_left": days_left,
            "tenant_id": tenant_id,
            "company_name": tenant_name(tenant),
            "trial_end_date": tenant.get("trial_end_date"),
            "target": message["target"],
            "page": message["target"],
        },
    }


def create_in_app_trial_notifications(db, tenant, reminder_type, days_left):
    users = get_tenant_users_for_notifications(db, tenant)

    if not users:
        return 0

    message = build_trial_message(tenant, days_left)
    docs = []

    for user in users:
        user_id = safe_str(user.get("_id") or user.get("user_id"))

        if not user_id:
            continue

        existing = db.notifications.find_one(
            {
                "tenant_id": tenant_identifier(tenant),
                "user_id": user_id,
                "notification_type": "saas_trial_reminder",
                "meta.reminder_type": reminder_type,
                "is_deleted": {"$ne": True},
            }
        )

        if existing:
            continue

        docs.append(build_in_app_notification_doc(tenant, user, message, reminder_type, days_left))

    if not docs:
        return 0

    result = db.notifications.insert_many(docs)

    return len(getattr(result, "inserted_ids", []) or [])


def should_process_tenant(tenant):
    if not tenant:
        return False

    if is_sds_tenant(tenant, current_app.config) or is_lifetime_tenant(tenant, current_app.config):
        return False

    if is_paid_tenant(tenant):
        return False

    if tenant_plan_type(tenant) != "demo":
        return False

    if tenant_status(tenant) == "suspended":
        return False

    return bool(trial_end_date(tenant))


def mark_tenant_expired_if_needed(db, tenant, days_left):
    if days_left is None or days_left > 0:
        return False

    if tenant_status(tenant) == "expired":
        return False

    tenant_object_id = tenant.get("_id")

    if not tenant_object_id:
        return False

    db.tenants.update_one(
        {"_id": tenant_object_id},
        {
            "$set": {
                "status": "expired",
                "trial_status": "expired",
                "subscription_status": "expired",
                "updated_at": now_utc(),
            }
        },
    )

    tenant["status"] = "expired"
    tenant["trial_status"] = "expired"
    tenant["subscription_status"] = "expired"

    return True


def process_trial_notification_for_tenant(db, tenant, *, force=False, dry_run=False):
    if not should_process_tenant(tenant):
        return {
            "processed": False,
            "reason": "not_eligible",
            "tenant_id": tenant_identifier(tenant),
        }

    reference_time = now_utc()
    days_left = days_left_until_trial_end(tenant, reference_time)

    if days_left is None:
        return {
            "processed": False,
            "reason": "missing_trial_end_date",
            "tenant_id": tenant_identifier(tenant),
        }

    mark_tenant_expired_if_needed(db, tenant, days_left)

    reminder_type = reminder_type_for_tenant(tenant, reference_time)

    if not reminder_type:
        return {
            "processed": False,
            "reason": "no_reminder_due_today",
            "tenant_id": tenant_identifier(tenant),
            "days_left": days_left,
        }

    if not force and reminder_already_sent(db, tenant, reminder_type):
        return {
            "processed": False,
            "reason": "already_sent",
            "tenant_id": tenant_identifier(tenant),
            "days_left": days_left,
            "reminder_type": reminder_type,
        }

    if dry_run:
        return {
            "processed": True,
            "dry_run": True,
            "tenant_id": tenant_identifier(tenant),
            "company_name": tenant_name(tenant),
            "days_left": days_left,
            "reminder_type": reminder_type,
        }

    email_result = {"ok": False, "message": "Company email not available."}
    company_email = tenant_email(tenant)

    if company_email:
        try:
            email_result = send_trial_reminder_email(
                company_email,
                tenant_name(tenant),
                days_left,
                billing_path=config_value("BILLING_PAGE_PATH", "/billing"),
            )
        except Exception as exc:
            email_result = {"ok": False, "message": str(exc)}

    in_app_count = create_in_app_trial_notifications(
        db,
        tenant,
        reminder_type,
        days_left,
    )

    record = record_trial_notification(
        db,
        tenant,
        reminder_type,
        email_result=email_result,
        in_app_count=in_app_count,
    )

    return {
        "processed": True,
        "tenant_id": tenant_identifier(tenant),
        "company_name": tenant_name(tenant),
        "days_left": days_left,
        "reminder_type": reminder_type,
        "email_result": email_result,
        "in_app_notification_count": in_app_count,
        "record_id": safe_str(record.get("_id")),
    }


def find_demo_tenants_due_for_trial_check(db):
    """
    Returns demo tenants that may need reminder or expiry processing.
    The per-tenant function decides whether a reminder is actually due today.
    """

    return list(
        db.tenants.find(
            {
                "plan_type": "demo",
                "is_deleted": {"$ne": True},
                "status": {"$nin": ["suspended"]},
                "trial_end_date": {"$exists": True, "$ne": None},
            }
        )
    )


def run_trial_notification_job(db, *, force=False, dry_run=False):
    tenants = find_demo_tenants_due_for_trial_check(db)

    results = []

    for tenant in tenants:
        results.append(
            process_trial_notification_for_tenant(
                db,
                tenant,
                force=force,
                dry_run=dry_run,
            )
        )

    processed_count = len([item for item in results if item.get("processed")])
    skipped_count = len(results) - processed_count

    return {
        "checked_count": len(results),
        "processed_count": processed_count,
        "skipped_count": skipped_count,
        "results": results,
        "checked_at": now_utc(),
    }