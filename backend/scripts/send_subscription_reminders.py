"""
Send YourComate HRMS paid-subscription renewal reminders.

EXISTING FILE TO REPLACE/UPDATE
Project path:
    backend/scripts/send_subscription_reminders.py

Run from the backend folder:
    python scripts/send_subscription_reminders.py --dry-run
    python scripts/send_subscription_reminders.py
    python scripts/send_subscription_reminders.py --json
    python scripts/send_subscription_reminders.py --force

Recommended daily cron example (09:00 server time):
    0 9 * * * cd /path/to/backend && /path/to/venv/bin/python scripts/send_subscription_reminders.py >> logs/subscription_reminders.log 2>&1

What this script does:
- Checks paid SaaS tenants with a subscription end date.
- Skips SDS and lifetime-access tenants.
- Sends renewal reminders at 7, 3 and 1 day before expiry.
- Sends an expiry notice when payment is overdue.
- Creates matching in-app notifications.
- Marks unpaid expired paid subscriptions as expired/requires_payment.
- Uses price_source="dynamic_plan_price" with the latest active Superadmin price for Essential/Growth reminders.
- Uses price_source="custom_quote" and preserves the client-specific accepted Premium recurring quotation.
- Sends in-app Billing reminders only to client company Admin users.
- Creates a fresh reminder set for each subscription renewal cycle.
- Reuses trial_notifications for idempotent SaaS notification records,
  with notification_scope="paid_subscription" and prefixed reminder types.

This script does not automatically charge a saved payment method. Renewal payment
continues through the existing Billing page and Razorpay checkout flow.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Any


CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.platform_notification_service import (
    notify_platform_superadmins,
    notify_subscription_due,
    notify_subscription_expired,
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def safe_str(value: Any) -> str:
    return str(value or "").strip()


def safe_lower(value: Any) -> str:
    return safe_str(value).lower()


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if number >= 0 else default
    except (TypeError, ValueError):
        return default


def safe_int(value: Any, default: int | None = 0) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def safe_platform_notification(
    app: Any,
    callback: Any,
    *args: Any,
    **kwargs: Any,
) -> dict[str, Any]:
    try:
        return callback(*args, **kwargs)
    except Exception as exc:
        try:
            app.logger.exception(
                "Platform Superadmin subscription notification failed: %s",
                exc,
            )
        except Exception:
            pass

        return {
            "ok": False,
            "created_count": 0,
            "error": str(exc),
        }


def notify_platform_subscription_reminder(
    db: Any,
    tenant: dict[str, Any],
    app: Any,
    *,
    reminder_type: str,
    remaining_days: int,
    due_date: datetime,
    renewal: dict[str, Any],
    email_result: dict[str, Any],
    expired_updated: bool,
    force: bool,
) -> dict[str, Any]:
    identifier = tenant_id(tenant)
    due_cycle = due_date.date().isoformat()
    cycle_key = f"{due_cycle}:{reminder_type}"

    notification_tenant = {
        **tenant,
        "subscription_end_date": due_date,
        "next_due_date": due_date,
        "next_payment_due_date": due_date,
        "payment_due_date": due_date,
        "plan_code": renewal.get("plan_code"),
        "plan_name": renewal.get("plan_name"),
        "plan_label": renewal.get("plan_name"),
        "renewal_amount": renewal.get("amount"),
        "currency": renewal.get("currency"),
        "billing_interval": renewal.get(
            "billing_interval"
        ),
        "price_source": renewal.get("price_source"),
        "premium_request_id": renewal.get(
            "premium_request_id"
        ),
        "requires_payment": (
            True
            if remaining_days <= 0
            else tenant.get("requires_payment", False)
        ),
    }

    if remaining_days <= 0:
        reminder_result = safe_platform_notification(
            app,
            notify_subscription_expired,
            db,
            notification_tenant,
            cycle_key=cycle_key,
        )
    else:
        reminder_result = safe_platform_notification(
            app,
            notify_subscription_due,
            db,
            notification_tenant,
            days_left=remaining_days,
            cycle_key=cycle_key,
        )

    if not bool(email_result.get("ok")):
        safe_platform_notification(
            app,
            notify_platform_superadmins,
            db,
            title=(
                "Subscription reminder email delivery failed"
            ),
            body=(
                f"{company_name(tenant)}'s "
                f"{'expiry notice' if remaining_days <= 0 else 'renewal reminder'} "
                "email was not delivered successfully. "
                "Review the company email address or follow up manually."
                + (
                    f" {safe_str(email_result.get('message'))}"
                    if safe_str(email_result.get("message"))
                    else ""
                )
            ),
            notification_type=(
                "platform_subscription_email_failure"
            ),
            priority="urgent",
            target="subscriptions",
            event_key=(
                "subscription_email_failure:"
                f"{identifier}:{cycle_key}"
            ),
            source="subscription_reminders",
            source_id=identifier,
            tenant_id=identifier,
            tenant_name=company_name(tenant),
            tenant_email=company_email(tenant),
            meta={
                "reminder_type": reminder_type,
                "days_left": remaining_days,
                "subscription_end_date": due_date,
                "plan_code": renewal.get("plan_code"),
                "plan_name": renewal.get("plan_name"),
                "renewal_amount": renewal.get("amount"),
                "currency": renewal.get("currency"),
                "billing_interval": renewal.get(
                    "billing_interval"
                ),
                "price_source": renewal.get(
                    "price_source"
                ),
                "premium_request_id": renewal.get(
                    "premium_request_id"
                ),
                "delivery_error": safe_str(
                    email_result.get("message")
                ),
                "expired_status_updated":
                    expired_updated,
            },
            force=force,
        )

    return reminder_result


def normalized_roles(user: dict[str, Any]) -> set[str]:
    values: list[Any] = [user.get("role")]
    raw_roles = user.get("roles")

    if isinstance(raw_roles, (list, tuple, set)):
        values.extend(raw_roles)
    elif raw_roles:
        values.extend(safe_str(raw_roles).replace(";", ",").split(","))

    return {safe_lower(value).replace("-", "_").replace(" ", "_") for value in values if safe_str(value)}


def is_client_billing_admin(user: dict[str, Any]) -> bool:
    roles = normalized_roles(user)
    return "admin" in roles and "super_admin" not in roles


def serialize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, list):
        return [serialize(item) for item in value]

    if isinstance(value, dict):
        return {str(key): serialize(item) for key, item in value.items()}

    try:
        from bson import ObjectId

        if isinstance(value, ObjectId):
            return str(value)
    except Exception:
        pass

    return value


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None

    if isinstance(value, datetime):
        parsed = value
    else:
        text = safe_str(value)
        if not text:
            return None

        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def config_value(app: Any, key: str, default: Any = None) -> Any:
    try:
        return app.config.get(key, default)
    except Exception:
        return default


def resolve_db(app: Any) -> Any:
    try:
        from app.extensions import get_db

        return get_db()
    except Exception:
        pass

    candidates = []

    try:
        candidates.append(getattr(app, "db", None))
    except Exception:
        pass

    try:
        candidates.append(app.config.get("MONGO_DB"))
    except Exception:
        pass

    try:
        for extension_value in getattr(app, "extensions", {}).values():
            candidates.append(getattr(extension_value, "db", None))
            candidates.append(extension_value)
    except Exception:
        pass

    try:
        from app import extensions

        candidates.append(getattr(extensions, "db", None))
        mongo = getattr(extensions, "mongo", None)
        candidates.append(getattr(mongo, "db", None))
        candidates.append(mongo)
    except Exception:
        pass

    for candidate in candidates:
        if candidate is None:
            continue

        try:
            if hasattr(candidate, "tenants") or hasattr(candidate, "subscriptions"):
                return candidate
        except Exception:
            pass

        try:
            nested = getattr(candidate, "db", None)
            if nested is not None and (
                hasattr(nested, "tenants") or hasattr(nested, "subscriptions")
            ):
                return nested
        except Exception:
            pass

    raise RuntimeError("Unable to resolve MongoDB database object.")


def tenant_id(tenant: dict[str, Any]) -> str:
    return (
        safe_str(tenant.get("tenant_id"))
        or safe_str(tenant.get("id"))
        or safe_str(tenant.get("_id"))
    )


def company_name(tenant: dict[str, Any]) -> str:
    return (
        safe_str(tenant.get("company_name"))
        or safe_str(tenant.get("tenant_name"))
        or safe_str(tenant.get("name"))
        or "Company"
    )


def company_email(tenant: dict[str, Any]) -> str:
    return (
        safe_str(tenant.get("company_email"))
        or safe_str(tenant.get("contact_email"))
        or safe_str(tenant.get("registered_email"))
        or safe_str(tenant.get("email"))
    )


def is_sds_or_lifetime(tenant: dict[str, Any], app: Any) -> bool:
    try:
        from app.services.tenant_service import is_lifetime_tenant, is_sds_tenant

        return bool(
            is_sds_tenant(tenant, app.config)
            or is_lifetime_tenant(tenant, app.config)
        )
    except Exception:
        configured_sds_id = safe_lower(config_value(app, "SDS_TENANT_ID", "sds"))
        configured_sds_code = safe_lower(config_value(app, "SDS_TENANT_CODE", "SDS"))

        return bool(
            safe_lower(tenant.get("tenant_id")) == configured_sds_id
            or safe_lower(tenant.get("tenant_code")) == configured_sds_code
            or safe_lower(tenant.get("plan_type")) == "lifetime"
            or safe_lower(tenant.get("subscription_status")) == "lifetime"
            or tenant.get("has_lifetime_access") is True
        )


def subscription_end_date(tenant: dict[str, Any]) -> datetime | None:
    return parse_datetime(
        tenant.get("subscription_end_date")
        or tenant.get("next_payment_due_date")
        or tenant.get("payment_due_date")
        or tenant.get("premium_next_due_date")
    )


def days_left(end_date: datetime, reference_time: datetime | None = None) -> int:
    reference_time = reference_time or now_utc()
    seconds = (end_date - reference_time).total_seconds()

    if seconds <= 0:
        return 0

    return int((seconds + 86399) // 86400)


def configured_reminder_days(app: Any) -> list[int]:
    raw = config_value(app, "SUBSCRIPTION_REMINDER_DAYS", [7, 3, 1])

    if isinstance(raw, str):
        values = raw.split(",")
    elif isinstance(raw, (list, tuple, set)):
        values = list(raw)
    else:
        values = [7, 3, 1]

    result = []

    for value in values:
        parsed = safe_int(value, None)
        if parsed is None or parsed <= 0:
            continue
        if parsed not in result:
            result.append(parsed)

    return sorted(result or [7, 3, 1], reverse=True)


def reminder_type_for_days(app: Any, remaining_days: int) -> str | None:
    if remaining_days <= 0:
        return "subscription_expired"

    # Select only the nearest reached reminder stage. This also catches a job
    # that was not run on the exact threshold day.
    for threshold in sorted(configured_reminder_days(app)):
        if remaining_days <= threshold:
            return f"subscription_due_{threshold}"

    return None


def latest_dynamic_plan(db: Any, plan_code: str) -> dict[str, Any] | None:
    plan_code = safe_lower(plan_code)

    if plan_code not in {"essential", "growth"}:
        return None

    return db.pricing_plans.find_one(
        {
            "plan_code": plan_code,
            "is_active": {"$ne": False},
            "is_deleted": {"$ne": True},
        },
        sort=[("updated_at", -1), ("created_at", -1)],
    )


def renewal_details(db: Any, tenant: dict[str, Any]) -> dict[str, Any]:
    identifier = tenant_id(tenant)
    plan_code = safe_lower(
        tenant.get("plan_code")
        or tenant.get("selected_plan_code")
        or tenant.get("plan")
    )

    currency = safe_str(tenant.get("currency")) or "INR"
    billing_interval = safe_lower(
        tenant.get("billing_interval")
        or tenant.get("plan_interval")
        or "monthly"
    )

    latest_subscription = None
    if identifier:
        latest_subscription = db.subscriptions.find_one(
            {
                "tenant_id": identifier,
                "is_deleted": {"$ne": True},
            },
            sort=[("updated_at", -1), ("created_at", -1)],
        )

    if latest_subscription and not plan_code:
        plan_code = safe_lower(latest_subscription.get("plan_code"))

    if plan_code == "premium":
        premium_request_id = (
            tenant.get("premium_request_id")
            or (latest_subscription or {}).get("premium_request_id")
        )

        premium_request = None
        if premium_request_id:
            try:
                from bson import ObjectId

                if ObjectId.is_valid(safe_str(premium_request_id)):
                    premium_request = db.premium_plan_requests.find_one(
                        {
                            "_id": ObjectId(safe_str(premium_request_id)),
                            "tenant_id": identifier,
                            "is_deleted": {"$ne": True},
                        }
                    )
            except Exception:
                premium_request = None

            if premium_request is None:
                premium_request = db.premium_plan_requests.find_one(
                    {
                        "tenant_id": identifier,
                        "$or": [
                            {"request_id": safe_str(premium_request_id)},
                            {"premium_request_id": safe_str(premium_request_id)},
                        ],
                        "is_deleted": {"$ne": True},
                    },
                    sort=[("updated_at", -1), ("created_at", -1)],
                )

        if premium_request is None and identifier:
            premium_request = db.premium_plan_requests.find_one(
                {
                    "tenant_id": identifier,
                    "client_visible": True,
                    "quotation_status": {"$in": ["sent", "converted"]},
                    "is_deleted": {"$ne": True},
                },
                sort=[("quotation_sent_at", -1), ("updated_at", -1)],
            )

        published = (premium_request or {}).get("published_quotation")
        if not isinstance(published, dict):
            published = premium_request or {}

        amount = safe_float(
            (latest_subscription or {}).get("renewal_amount")
            or tenant.get("premium_renewal_amount")
            or tenant.get("renewal_amount")
            or published.get("renewal_amount")
            or published.get("payment_amount")
            or published.get("quoted_amount")
            or tenant.get("premium_quoted_amount")
        )

        billing_interval = safe_lower(
            (latest_subscription or {}).get("billing_interval")
            or tenant.get("premium_billing_interval")
            or published.get("quoted_billing_interval")
            or published.get("billing_interval")
            or billing_interval
        ) or "monthly"

        currency = (
            safe_str((latest_subscription or {}).get("currency"))
            or safe_str(published.get("quoted_currency"))
            or safe_str(published.get("currency"))
            or currency
        )

        return {
            "plan_code": "premium",
            "plan_name": safe_str(tenant.get("plan_name")) or "Premium",
            "amount": amount,
            "currency": currency,
            "billing_interval": billing_interval,
            "price_source": "custom_quote",
            "premium_request_id": premium_request_id or (premium_request or {}).get("_id"),
            "pricing_available": amount > 0,
        }

    current_plan = latest_dynamic_plan(db, plan_code)

    if current_plan:
        amount = safe_float(current_plan.get("amount"))
        return {
            "plan_code": plan_code,
            "plan_name": (
                safe_str(current_plan.get("display_name"))
                or safe_str(current_plan.get("plan_name"))
                or plan_code.title()
            ),
            "amount": amount,
            "currency": safe_str(current_plan.get("currency")) or currency,
            "billing_interval": (
                safe_lower(current_plan.get("billing_interval"))
                or billing_interval
                or "monthly"
            ),
            "price_source": "dynamic_plan_price",
            "pricing_plan_id": safe_str(current_plan.get("_id")),
            "pricing_available": amount > 0,
        }

    fallback_amount = safe_float(
        (latest_subscription or {}).get("renewal_amount")
        or tenant.get("renewal_amount")
    )

    return {
        "plan_code": plan_code or "paid",
        "plan_name": safe_str(tenant.get("plan_name")) or (plan_code.title() if plan_code else "Paid"),
        "amount": fallback_amount,
        "currency": currency,
        "billing_interval": billing_interval or "monthly",
        "price_source": (
            "dynamic_plan_price"
            if plan_code in {"essential", "growth"}
            else safe_str(tenant.get("renewal_price_source")) or "tenant_snapshot"
        ),
        "pricing_available": False,
    }


def format_amount(amount: float, currency: str) -> str:
    code = safe_str(currency).upper() or "INR"
    if code == "INR":
        return f"₹{amount:,.2f}"
    return f"{code} {amount:,.2f}"


def billing_url(app: Any) -> str:
    frontend_base = safe_str(config_value(app, "FRONTEND_BASE_URL", ""))
    billing_path = safe_str(config_value(app, "BILLING_PAGE_PATH", "/billing")) or "/billing"

    if frontend_base:
        return f"{frontend_base.rstrip('/')}/{billing_path.lstrip('/')}"

    return billing_path


def build_message(
    tenant: dict[str, Any],
    renewal: dict[str, Any],
    remaining_days: int,
    due_date: datetime,
    url: str,
) -> dict[str, str]:
    name = company_name(tenant)
    plan_name = safe_str(renewal.get("plan_name")) or "YourComate HRMS"
    renewal_amount = safe_float(renewal.get("amount"))
    amount = format_amount(renewal_amount, renewal.get("currency") or "INR")
    interval = safe_str(renewal.get("billing_interval")) or "monthly"
    due_text = due_date.strftime("%d %B %Y")
    price_source = safe_str(renewal.get("price_source"))

    if price_source == "custom_quote":
        pricing_note = "This renewal uses your client-specific Premium custom quotation."
    elif price_source == "dynamic_plan_price":
        pricing_note = "This renewal uses the latest active Superadmin-set plan price."
    else:
        pricing_note = "The final payable amount will be confirmed securely on the Billing page."

    if renewal_amount <= 0:
        amount = "Pending price confirmation"

    if remaining_days <= 0:
        subject = "YourComate HRMS subscription payment is due"
        title = "Subscription Expired — Renewal Required"
        text = (
            f"Dear {name},\n\n"
            f"Your {plan_name} subscription reached its renewal date on {due_text}. "
            f"Renewal amount: {amount} ({interval}).\n"
            f"{pricing_note}\n\n"
            "Please complete payment from the Billing page to restore continued access.\n"
            f"Billing: {url}\n\nRegards,\nYourComate HRMS"
        )
        body = (
            f"<p>Dear <strong>{escape(name)}</strong>,</p>"
            f"<p>Your <strong>{escape(plan_name)}</strong> subscription reached its renewal date "
            f"on <strong>{escape(due_text)}</strong>.</p>"
            f"<p><strong>Renewal amount:</strong> {escape(amount)} ({escape(interval)})</p>"
            f"<p>{escape(pricing_note)}</p>"
            f'<p><a href="{escape(url)}">Open Billing and renew now</a></p>'
        )
        priority = "urgent"
    else:
        day_word = "day" if remaining_days == 1 else "days"
        subject = f"YourComate HRMS renewal due in {remaining_days} {day_word}"
        title = f"Subscription Renewal Due in {remaining_days} {day_word.title()}"
        text = (
            f"Dear {name},\n\n"
            f"Your {plan_name} subscription renews on {due_text}. "
            f"Current renewal amount: {amount} ({interval}).\n"
            f"{pricing_note}\n\n"
            "Please complete payment before the due date to avoid interruption.\n"
            f"Billing: {url}\n\nRegards,\nYourComate HRMS"
        )
        body = (
            f"<p>Dear <strong>{escape(name)}</strong>,</p>"
            f"<p>Your <strong>{escape(plan_name)}</strong> subscription renews on "
            f"<strong>{escape(due_text)}</strong>.</p>"
            f"<p><strong>Current renewal amount:</strong> {escape(amount)} ({escape(interval)})</p>"
            f"<p>{escape(pricing_note)}</p>"
            f'<p><a href="{escape(url)}">Open Billing</a></p>'
        )
        priority = "high"

    html = f"""
    <!doctype html>
    <html>
      <body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;">
            <div style="background:#1d4ed8;color:#fff;padding:24px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">YourComate HRMS</div>
              <h1 style="margin:8px 0 0;font-size:24px;">{escape(title)}</h1>
            </div>
            <div style="padding:26px;line-height:1.7;">{body}</div>
          </div>
        </div>
      </body>
    </html>
    """

    return {
        "subject": subject,
        "title": title,
        "text": text,
        "html": html,
        "priority": priority,
    }


def reminder_already_recorded(
    db: Any,
    tenant: dict[str, Any],
    reminder_type: str,
    due_date: datetime,
) -> bool:
    return bool(
        db.trial_notifications.find_one(
            {
                "tenant_id": tenant_id(tenant),
                "reminder_type": reminder_type,
                "notification_scope": "paid_subscription",
                "subscription_end_date": due_date,
                "is_deleted": {"$ne": True},
            }
        )
    )


def tenant_users(db: Any, tenant: dict[str, Any]) -> list[dict[str, Any]]:
    identifier = tenant_id(tenant)
    if not identifier:
        return []

    users = list(
        db.users.find(
            {
                "tenant_id": identifier,
                "is_deleted": {"$ne": True},
                "status": {"$nin": ["disabled", "inactive"]},
                "active": {"$ne": False},
            }
        )
    )

    admin_users = [user for user in users if is_client_billing_admin(user)]
    if admin_users:
        return admin_users

    employees = list(
        db.employees.find(
            {
                "tenant_id": identifier,
                "is_deleted": {"$ne": True},
                "status": {"$ne": "inactive"},
            }
        )
    )

    return [employee for employee in employees if is_client_billing_admin(employee)]


def create_in_app_notifications(
    db: Any,
    tenant: dict[str, Any],
    reminder_type: str,
    message: dict[str, str],
    renewal: dict[str, Any],
    remaining_days: int,
    due_date: datetime,
    url: str,
) -> int:
    docs = []
    identifier = tenant_id(tenant)
    created_at = now_utc()

    for user in tenant_users(db, tenant):
        user_id = safe_str(user.get("_id") or user.get("user_id"))
        if not user_id:
            continue

        existing = db.notifications.find_one(
            {
                "tenant_id": identifier,
                "user_id": user_id,
                "notification_type": "saas_subscription_reminder",
                "meta.reminder_type": reminder_type,
                "meta.subscription_end_date": due_date,
                "is_deleted": {"$ne": True},
            }
        )

        if existing:
            continue

        body = message["title"]
        amount = safe_float(renewal.get("amount"))
        if amount > 0:
            body += f" Renewal amount: {format_amount(amount, renewal.get('currency') or 'INR')}."

        price_source = safe_str(renewal.get("price_source"))
        if price_source == "custom_quote":
            body += " Renewal pricing is based on your custom Premium quotation."
        elif price_source == "dynamic_plan_price":
            body += " Renewal pricing uses the latest active Superadmin-set plan price."

        docs.append(
            {
                "tenant_id": identifier,
                "tenant_name": company_name(tenant),
                "target_tenant_id": identifier,
                "target_tenant_name": company_name(tenant),
                "user_id": user_id,
                "user_ids": [user_id],
                "title": message["title"],
                "body": body,
                "message": body,
                "notification_type": "saas_subscription_reminder",
                "priority": message["priority"],
                "target": "billing",
                "target_scope": "selected_users",
                "audience": "selected_users",
                "show_popup": True,
                "popup_seen": False,
                "read": False,
                "status": "unread",
                "created_at": created_at,
                "updated_at": created_at,
                "created_by": "system",
                "created_by_name": "YourComate SaaS",
                "created_by_role": ["system"],
                "is_deleted": False,
                "meta": {
                    "saas_subscription_reminder": True,
                    "reminder_type": reminder_type,
                    "days_left": remaining_days,
                    "subscription_end_date": due_date,
                    "plan_code": renewal.get("plan_code"),
                    "plan_name": renewal.get("plan_name"),
                    "renewal_amount": renewal.get("amount"),
                    "currency": renewal.get("currency"),
                    "billing_interval": renewal.get("billing_interval"),
                    "price_source": renewal.get("price_source"),
                    "billing_url": url,
                    "target": "billing",
                    "page": "billing",
                },
            }
        )

    if not docs:
        return 0

    result = db.notifications.insert_many(docs)
    return len(getattr(result, "inserted_ids", []) or [])


def mark_expired(db: Any, tenant: dict[str, Any], due_date: datetime) -> bool:
    if due_date > now_utc():
        return False

    identifier = tenant_id(tenant)
    current_status = safe_lower(tenant.get("status"))
    current_subscription_status = safe_lower(tenant.get("subscription_status"))

    already_expired = (
        current_status == "expired"
        and current_subscription_status == "expired"
        and tenant.get("requires_payment") is True
    )

    if already_expired:
        return False

    updated_at = now_utc()

    db.tenants.update_one(
        {"_id": tenant.get("_id")},
        {
            "$set": {
                "status": "expired",
                "subscription_status": "expired",
                "requires_payment": True,
                "next_payment_due_date": due_date,
                "payment_due_date": due_date,
                "subscription_expired_at": updated_at,
                "updated_at": updated_at,
            }
        },
    )

    db.subscriptions.update_many(
        {
            "tenant_id": identifier,
            "plan_type": "paid",
            "status": {"$in": ["active", "paid", "active_paid"]},
            "is_deleted": {"$ne": True},
            "$or": [
                {"ends_at": {"$lte": updated_at}},
                {"next_due_date": {"$lte": updated_at}},
                {"payment_due_date": {"$lte": updated_at}},
            ],
        },
        {
            "$set": {
                "status": "expired",
                "subscription_status": "expired",
                "requires_payment": True,
                "expired_at": updated_at,
                "updated_at": updated_at,
            }
        },
    )

    tenant["status"] = "expired"
    tenant["subscription_status"] = "expired"
    tenant["requires_payment"] = True
    return True


def record_notification(
    db: Any,
    tenant: dict[str, Any],
    reminder_type: str,
    remaining_days: int,
    due_date: datetime,
    renewal: dict[str, Any],
    email_result: dict[str, Any],
    in_app_count: int,
    expired_updated: bool,
) -> str:
    created_at = now_utc()
    doc = {
        "tenant_id": tenant_id(tenant),
        "tenant_object_id": tenant.get("_id"),
        "tenant_code": tenant.get("tenant_code"),
        "company_name": company_name(tenant),
        "company_email": company_email(tenant),
        "notification_scope": "paid_subscription",
        "reminder_type": reminder_type,
        "days_left": remaining_days,
        "subscription_end_date": due_date,
        "plan_type": "paid",
        "plan_code": renewal.get("plan_code"),
        "plan_name": renewal.get("plan_name"),
        "renewal_amount": renewal.get("amount"),
        "currency": renewal.get("currency"),
        "billing_interval": renewal.get("billing_interval"),
        "price_source": renewal.get("price_source"),
        "premium_request_id": renewal.get("premium_request_id"),
        "pricing_plan_id": renewal.get("pricing_plan_id"),
        "email_result": email_result,
        "in_app_notification_count": in_app_count,
        "expired_status_updated": expired_updated,
        "sent_at": created_at,
        "created_at": created_at,
        "updated_at": created_at,
        "is_deleted": False,
    }

    result = db.trial_notifications.insert_one(doc)
    return safe_str(result.inserted_id)


def is_eligible_paid_tenant(tenant: dict[str, Any], app: Any) -> bool:
    if not tenant or is_sds_or_lifetime(tenant, app):
        return False

    if safe_lower(tenant.get("status")) == "suspended":
        return False

    paid_markers = {
        safe_lower(tenant.get("plan_type")),
        safe_lower(tenant.get("subscription_status")),
        safe_lower(tenant.get("status")),
    }

    is_paid = bool(
        "paid" in paid_markers
        or "active_paid" in paid_markers
        or tenant.get("is_paid_company") is True
        or safe_lower(tenant.get("plan_code")) in {"essential", "growth", "premium"}
    )

    return is_paid and subscription_end_date(tenant) is not None


def process_tenant(
    db: Any,
    tenant: dict[str, Any],
    app: Any,
    *,
    dry_run: bool = False,
    force: bool = False,
) -> dict[str, Any]:
    if not is_eligible_paid_tenant(tenant, app):
        return {
            "processed": False,
            "reason": "not_eligible",
            "tenant_id": tenant_id(tenant),
        }

    due_date = subscription_end_date(tenant)
    if due_date is None:
        return {
            "processed": False,
            "reason": "missing_subscription_end_date",
            "tenant_id": tenant_id(tenant),
        }

    remaining_days = days_left(due_date)
    reminder_type = reminder_type_for_days(app, remaining_days)

    if not reminder_type:
        return {
            "processed": False,
            "reason": "no_reminder_due",
            "tenant_id": tenant_id(tenant),
            "days_left": remaining_days,
        }

    if not force and reminder_already_recorded(db, tenant, reminder_type, due_date):
        return {
            "processed": False,
            "reason": "already_sent",
            "tenant_id": tenant_id(tenant),
            "days_left": remaining_days,
            "reminder_type": reminder_type,
        }

    renewal = renewal_details(db, tenant)
    url = billing_url(app)
    message = build_message(tenant, renewal, remaining_days, due_date, url)

    if dry_run:
        return {
            "processed": True,
            "dry_run": True,
            "tenant_id": tenant_id(tenant),
            "company_name": company_name(tenant),
            "days_left": remaining_days,
            "reminder_type": reminder_type,
            "subscription_end_date": due_date,
            "renewal": renewal,
        }

    expired_updated = mark_expired(db, tenant, due_date) if remaining_days <= 0 else False

    email_result = {
        "ok": False,
        "message": "Company email not available.",
        "code": "missing_recipient",
    }

    recipient = company_email(tenant)
    if recipient:
        try:
            from app.services.email_service import send_email

            email_result = send_email(
                app.config,
                recipient,
                message["subject"],
                message["text"],
                message["html"],
            )
        except Exception as exc:
            email_result = {
                "ok": False,
                "message": str(exc),
                "code": "subscription_email_failed",
            }

    in_app_count = create_in_app_notifications(
        db,
        tenant,
        reminder_type,
        message,
        renewal,
        remaining_days,
        due_date,
        url,
    )

    record_id = record_notification(
        db,
        tenant,
        reminder_type,
        remaining_days,
        due_date,
        renewal,
        email_result,
        in_app_count,
        expired_updated,
    )

    notify_platform_subscription_reminder(
        db,
        tenant,
        app,
        reminder_type=reminder_type,
        remaining_days=remaining_days,
        due_date=due_date,
        renewal=renewal,
        email_result=email_result,
        expired_updated=expired_updated,
        force=force,
    )

    return {
        "processed": True,
        "tenant_id": tenant_id(tenant),
        "company_name": company_name(tenant),
        "days_left": remaining_days,
        "reminder_type": reminder_type,
        "subscription_end_date": due_date,
        "renewal": renewal,
        "email_result": email_result,
        "in_app_notification_count": in_app_count,
        "expired_status_updated": expired_updated,
        "record_id": record_id,
    }


def find_paid_tenants(db: Any) -> list[dict[str, Any]]:
    return list(
        db.tenants.find(
            {
                "is_deleted": {"$ne": True},
                "status": {"$ne": "suspended"},
                "$and": [
                    {
                        "$or": [
                            {"plan_type": "paid"},
                            {"subscription_status": {"$in": ["active", "paid", "active_paid", "expired"]}},
                            {"is_paid_company": True},
                            {"plan_code": {"$in": ["essential", "growth", "premium"]}},
                        ]
                    },
                    {
                        "$or": [
                            {"subscription_end_date": {"$exists": True, "$ne": None}},
                            {"next_payment_due_date": {"$exists": True, "$ne": None}},
                            {"payment_due_date": {"$exists": True, "$ne": None}},
                            {"premium_next_due_date": {"$exists": True, "$ne": None}},
                        ]
                    },
                ],
            }
        )
    )


def run_job(db: Any, app: Any, *, dry_run: bool = False, force: bool = False) -> dict[str, Any]:
    tenants = find_paid_tenants(db)
    results = [
        process_tenant(db, tenant, app, dry_run=dry_run, force=force)
        for tenant in tenants
    ]

    processed = [item for item in results if item.get("processed")]

    return {
        "checked_at": now_utc(),
        "checked_count": len(results),
        "processed_count": len(processed),
        "skipped_count": len(results) - len(processed),
        "expired_updated_count": len(
            [item for item in processed if item.get("expired_status_updated")]
        ),
        "results": results,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Send YourComate HRMS paid-subscription renewal reminders.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show due reminders without sending emails or writing records.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Process reminders even when the same reminder type was already recorded.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the complete result as JSON.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    os.chdir(BACKEND_DIR)

    from app import create_app

    app = create_app()

    with app.app_context():
        db = resolve_db(app)
        result = run_job(db, app, dry_run=args.dry_run, force=args.force)

    clean = serialize(result)

    if args.json:
        print(json.dumps(clean, indent=2, ensure_ascii=False))
        return 0

    print("YourComate HRMS Subscription Renewal Job")
    print("-----------------------------------------")
    print(f"Checked At       : {clean.get('checked_at')}")
    print(f"Checked Tenants  : {clean.get('checked_count', 0)}")
    print(f"Processed        : {clean.get('processed_count', 0)}")
    print(f"Skipped          : {clean.get('skipped_count', 0)}")
    print(f"Expired Updated  : {clean.get('expired_updated_count', 0)}")
    print(f"Dry Run          : {args.dry_run}")
    print(f"Force            : {args.force}")

    results = clean.get("results") or []
    if results:
        print("\nDetails:")
        for index, item in enumerate(results, start=1):
            company = item.get("company_name") or item.get("tenant_id") or "Unknown"
            state = "processed" if item.get("processed") else "skipped"
            reason = item.get("reminder_type") or item.get("reason") or ""
            remaining = item.get("days_left")
            days_text = "" if remaining is None else f", days_left={remaining}"
            print(f"{index}. {company}: {state} {reason}{days_text}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())