from datetime import datetime, timedelta, timezone

from bson import ObjectId
from flask import Blueprint, Response, current_app, g, jsonify, request

from app.extensions import get_db
from app.services.billing_service import (
    BillingServiceError,
    build_billing_summary,
    create_subscription_order,
    expire_due_demo_companies,
    find_company_for_billing,
    verify_and_activate_payment,
)
from app.services.pricing_service import (
    PricingServiceError,
    archive_pricing_plan,
    build_public_pricing_payload,
    ensure_default_pricing_plans,
    list_pricing_plans,
    upsert_pricing_plan,
)
from app.services.razorpay_service import (
    RazorpayServiceError,
    verify_webhook_signature,
)
from app.services.tenant_service import safe_str
from app.services.email_service import send_premium_quotation_email
from app.utils.auth import audit, current_user_required, roles_required
from app.utils.serializers import clean_doc


billing_bp = Blueprint("billing", __name__)


def now_utc():
    return datetime.now(timezone.utc)


def request_json():
    if not request.is_json:
        return {}

    return request.get_json(silent=True) or {}


def current_user_id():
    user = getattr(g, "current_user", {}) or {}
    return str(user.get("_id") or user.get("id") or user.get("email") or "")


def current_tenant_id():
    user = getattr(g, "current_user", {}) or {}
    return safe_str(
        getattr(g, "tenant_id", None)
        or user.get("tenant_id")
        or current_app.config.get("DEFAULT_TENANT_ID", "sds")
    )


def current_user_is_superadmin():
    user = getattr(g, "current_user", {}) or {}
    roles = user.get("roles") or []

    if isinstance(roles, str):
        roles = [role.strip() for role in roles.split(",") if role.strip()]

    roles = list(roles) + [
        user.get("role"),
        user.get("primary_role"),
    ]

    normalized = {
        str(role or "").strip().lower().replace("-", "_").replace(" ", "_")
        for role in roles
        if role
    }

    return "super_admin" in normalized


def object_id_or_none(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def truthy(value):
    if isinstance(value, bool):
        return value

    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def parse_number_or_none(value):
    if value in [None, ""]:
        return None

    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    return number if number >= 0 else None


def parse_int_or_none(value):
    number = parse_number_or_none(value)

    if number is None:
        return None

    return int(number)


def normalize_currency(value):
    currency = safe_str(value or "INR").upper()
    return currency[:8] or "INR"


def normalize_billing_interval(value):
    interval = (
        safe_str(value or "monthly")
        .lower()
        .replace(" ", "_")
        .replace("-", "_")
    )

    allowed = {"monthly", "quarterly", "yearly", "annual", "annually", "one_time", "custom"}

    if interval not in allowed:
        return "monthly"

    if interval in {"annual", "annually"}:
        return "yearly"

    return interval


def parse_date_or_none(value):
    if not value:
        return None

    if isinstance(value, datetime):
        return value

    raw = safe_str(value)

    if not raw:
        return None

    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"

        parsed = datetime.fromisoformat(raw)

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)

        return parsed
    except Exception:
        return None


def default_payment_due_date():
    return now_utc() + timedelta(days=7)


def parse_datetime_value(value):
    if not value:
        return None

    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, dict) and value.get("$date"):
        return parse_datetime_value(value.get("$date"))
    else:
        raw = safe_str(value)

        if not raw:
            return None

        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed


def days_until(value, reference_time=None):
    date_value = parse_datetime_value(value)

    if not date_value:
        return None

    reference_time = reference_time or now_utc()
    remaining = date_value - reference_time

    if remaining.total_seconds() <= 0:
        return 0

    days = remaining.days

    if remaining.total_seconds() > 0 and days < 1:
        return 1

    return max(days, 0)


def renewal_window_days():
    try:
        configured = int(current_app.config.get("SAAS_RENEWAL_WINDOW_DAYS", 7))
    except (TypeError, ValueError):
        configured = 7

    return min(max(configured, 1), 60)


def build_billing_actions(summary):
    summary = summary or {}
    status = safe_str(summary.get("status") or summary.get("subscription_status")).lower()
    is_lifetime = bool(summary.get("is_lifetime") or summary.get("is_sds_company"))
    is_paid = bool(summary.get("is_paid_company"))
    is_expired = bool(summary.get("is_expired")) or status in {
        "expired",
        "suspended",
        "blocked",
        "inactive",
    }
    subscription_days = summary.get("subscription_days_left")
    trial_days = summary.get("trial_days_left")
    days_left = subscription_days if is_paid else trial_days

    try:
        days_left = int(days_left) if days_left is not None else None
    except (TypeError, ValueError):
        days_left = None

    window_days = renewal_window_days()
    active_paid = is_paid and not is_expired
    renewal_due_soon = bool(
        active_paid
        and days_left is not None
        and days_left <= window_days
    )
    requires_payment = bool(summary.get("requires_payment"))
    show_upgrade_actions = bool(
        not is_lifetime
        and (
            not active_paid
            or is_expired
            or renewal_due_soon
            or requires_payment
        )
    )

    return {
        "renewal_window_days": window_days,
        "days_left": days_left,
        "subscription_days_left": subscription_days,
        "trial_days_left": trial_days,
        "subscription_active": active_paid,
        "subscription_expired": is_expired,
        "renewal_due_soon": renewal_due_soon,
        "show_upgrade_actions": show_upgrade_actions,
        "show_plan_selection": show_upgrade_actions,
        "show_payment_actions": show_upgrade_actions,
        "hide_upgrade_actions": not show_upgrade_actions,
        "subscription_valid_until": (
            summary.get("subscription_end_date")
            or summary.get("next_payment_due_date")
        ),
        "current_plan_code": summary.get("plan_code") or summary.get("selected_plan_code"),
        "current_plan_label": summary.get("plan_label") or summary.get("selected_plan_name"),
    }


def build_billing_alerts(summary, premium_request=None):
    summary = summary or {}
    premium_request = premium_request or {}
    actions = build_billing_actions(summary)
    alerts = []
    company_name = safe_str(summary.get("company_name") or "Your company")
    valid_until = actions.get("subscription_valid_until")
    valid_until_text = (
        parse_datetime_value(valid_until).strftime("%d %b %Y")
        if parse_datetime_value(valid_until)
        else "the recorded expiry date"
    )

    if summary.get("is_lifetime") or summary.get("is_sds_company"):
        alerts.append({
            "level": "success",
            "code": "lifetime_access",
            "title": "Lifetime access is active",
            "message": (
                f"{company_name} has lifetime full access. No renewal or subscription payment is required."
            ),
        })
    elif actions.get("subscription_active"):
        days_left = actions.get("days_left")

        if actions.get("renewal_due_soon"):
            alerts.append({
                "level": "warning",
                "code": "subscription_renewal_due_soon",
                "title": "Subscription renewal is approaching",
                "message": (
                    f"Your subscription is valid until {valid_until_text}. "
                    f"{days_left if days_left is not None else 'A limited number of'} day(s) remain. "
                    "Renewal options are now available."
                ),
            })
        else:
            remaining_text = (
                f" {days_left} day(s) remain."
                if days_left is not None
                else ""
            )
            alerts.append({
                "level": "success",
                "code": "subscription_active",
                "title": "Subscription is active",
                "message": (
                    f"Your current subscription is valid until {valid_until_text}."
                    f"{remaining_text} Upgrade and payment controls will appear again near renewal."
                ),
            })
    elif actions.get("subscription_expired"):
        alerts.append({
            "level": "error",
            "code": "subscription_expired",
            "title": "Subscription access has expired",
            "message": "Choose a plan or complete the available renewal payment to restore access.",
        })
    else:
        trial_days = actions.get("trial_days_left")

        if trial_days is not None and int(trial_days) <= 3:
            alerts.append({
                "level": "warning",
                "code": "trial_expiring_soon",
                "title": "Trial is ending soon",
                "message": (
                    f"Your full-access trial has {int(trial_days)} day(s) remaining. "
                    "Choose a subscription to avoid interruption."
                ),
            })
        else:
            alerts.append({
                "level": "info",
                "code": "trial_active",
                "title": "Full-access trial is active",
                "message": (
                    f"Your trial has {trial_days if trial_days is not None else 'a limited number of'} "
                    "day(s) remaining. You may subscribe at any time."
                ),
            })

    premium_status = safe_str(
        premium_request.get("payment_status")
        or premium_request.get("quotation_status")
        or premium_request.get("status")
    ).lower()

    if premium_request and premium_status in {"pending", "order_created", "sent", "payment_pending"}:
        due_date = premium_request.get("payment_due_date")
        due_text = (
            parse_datetime_value(due_date).strftime("%d %b %Y")
            if parse_datetime_value(due_date)
            else "the quotation due date"
        )
        alerts.append({
            "level": "warning",
            "code": "premium_payment_pending",
            "title": "Premium quotation payment is pending",
            "message": f"Complete the Premium quotation payment by {due_text} to activate or renew Premium.",
        })

    return alerts


def build_client_visible_premium_request(request_doc):
    if not request_doc:
        return None

    result = dict(request_doc)
    published = request_doc.get("published_quotation")

    if isinstance(published, dict):
        quote_fields = {
            "quoted_amount",
            "renewal_amount",
            "payment_amount",
            "quoted_currency",
            "quoted_employee_limit",
            "is_unlimited_employees",
            "quoted_billing_interval",
            "payment_due_date",
            "next_due_date",
            "quotation_valid_until",
            "payment_link",
            "quotation_reference",
            "sales_note",
        }

        for field in quote_fields:
            if field in published:
                result[field] = published.get(field)

    return result


def invoice_download_url(payment):
    payment_id = safe_str(
        (payment or {}).get("_id")
        or (payment or {}).get("id")
        or (payment or {}).get("invoice_number")
        or (payment or {}).get("razorpay_payment_id")
    )

    if not payment_id:
        return ""

    return f"/billing/invoices/{payment_id}/download"


def serialize_invoice(payment):
    item = clean_doc(payment or {})
    item["id"] = safe_str(item.get("_id") or item.get("id"))
    item["status"] = (
        item.get("invoice_status")
        or item.get("payment_status")
        or item.get("status")
        or "paid"
    )
    item["download_url"] = invoice_download_url(item)
    return item


def load_tenant_invoices(db, tenant_id, limit=50):
    try:
        limit = min(max(int(limit), 1), 100)
    except (TypeError, ValueError):
        limit = 50

    rows = list(
        db.payments.find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort([("paid_at", -1), ("invoice_date", -1), ("created_at", -1)])
        .limit(limit)
    )

    return [serialize_invoice(row) for row in rows]


def premium_admin_alert(request_doc):
    status = safe_str((request_doc or {}).get("status") or "new").lower()
    payment_status = safe_str((request_doc or {}).get("payment_status")).lower()
    due_date = (request_doc or {}).get("payment_due_date")
    due_days = days_until(due_date)

    if status == "converted" or payment_status == "paid":
        return "success", "Premium subscription activated and payment completed."

    if due_date and due_days == 0 and payment_status not in {"paid", "captured"}:
        return "error", "Premium quotation payment due date has passed. Follow up or revise the quotation."

    if (request_doc or {}).get("draft_revision_pending"):
        return "warning", "An internal quotation revision is saved but has not been sent to the client."

    if (request_doc or {}).get("client_visible") and payment_status in {"pending", "order_created"}:
        return "warning", "Quotation is visible to the client and payment is pending."

    if status in {"new", "contacted", "requirements_collected"}:
        return "info", "Premium request is awaiting quotation follow-up."

    return "info", "Review the Premium request status and next follow-up action."


def subscription_admin_alert(subscription_doc):
    status = safe_str((subscription_doc or {}).get("status") or "active").lower()
    valid_until = (
        (subscription_doc or {}).get("ends_at")
        or (subscription_doc or {}).get("end_date")
        or (subscription_doc or {}).get("subscription_end_date")
        or (subscription_doc or {}).get("trial_end_date")
    )
    remaining = days_until(valid_until)
    window_days = renewal_window_days()

    if status in {"expired", "suspended", "failed", "cancelled"} or remaining == 0:
        return "error", "Subscription is expired or unavailable and requires action.", remaining, valid_until

    if remaining is not None and remaining <= window_days:
        return "warning", f"Subscription expires in {remaining} day(s). Renewal follow-up is due.", remaining, valid_until

    return "success", "Subscription is active and no immediate renewal action is required.", remaining, valid_until


def pdf_escape(value):
    return safe_str(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_text_pdf(lines):
    safe_lines = []

    for line in lines:
        text = safe_str(line)

        while len(text) > 92:
            split_at = text.rfind(" ", 0, 92)
            split_at = split_at if split_at > 20 else 92
            safe_lines.append(text[:split_at])
            text = text[split_at:].strip()

        safe_lines.append(text)

    content_parts = ["BT", "/F1 11 Tf", "50 790 Td", "15 TL"]

    for index, line in enumerate(safe_lines[:46]):
        if index:
            content_parts.append("T*")
        content_parts.append(f"({pdf_escape(line)}) Tj")

    content_parts.append("ET")
    content = "\n".join(content_parts).encode("latin-1", "replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"\nendstream",
    ]

    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]

    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")

    xref_position = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")

    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))

    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_position}\n%%EOF\n"
        ).encode("ascii")
    )

    return bytes(pdf)


def build_invoice_pdf(payment, company):
    payment = payment or {}
    company = company or {}
    paid_at = (
        payment.get("invoice_date")
        or payment.get("paid_at")
        or payment.get("created_at")
    )
    paid_at_text = (
        parse_datetime_value(paid_at).strftime("%d %b %Y, %I:%M %p UTC")
        if parse_datetime_value(paid_at)
        else safe_str(paid_at or "Not available")
    )
    amount = parse_number_or_none(payment.get("amount")) or 0
    amount_text = f"{payment.get('currency') or 'INR'} {amount:,.2f}"
    employee_limit = payment.get("employee_limit")

    if payment.get("is_unlimited_employees") or employee_limit in [None, "", 0, "0"]:
        employee_text = "Unlimited"
    else:
        employee_text = safe_str(employee_limit)

    lines = [
        "YOURCOMATE HRMS - PAYMENT INVOICE",
        "",
        f"Invoice Number: {payment.get('invoice_number') or 'Not assigned'}",
        f"Receipt Number: {payment.get('receipt_number') or 'Not assigned'}",
        f"Invoice Status: {payment.get('invoice_status') or payment.get('payment_status') or 'Paid'}",
        f"Invoice Date: {paid_at_text}",
        "",
        f"Billed To: {payment.get('company_name') or company.get('company_name') or company.get('name') or 'Company'}",
        f"Registered Email: {payment.get('company_email') or company.get('company_email') or company.get('contact_email') or company.get('email') or 'Not available'}",
        f"Tenant ID: {payment.get('tenant_id') or company.get('tenant_id') or 'Not available'}",
        "",
        f"Plan: {payment.get('plan_label') or payment.get('plan_name') or payment.get('plan_code') or 'YourComate HRMS'}",
        f"Billing Interval: {payment.get('billing_interval') or payment.get('plan_interval') or 'Not available'}",
        f"Employee Limit: {employee_text}",
        f"Amount Paid: {amount_text}",
        f"Payment Method: {payment.get('payment_method') or 'Razorpay'}",
        "",
        f"Razorpay Payment ID: {payment.get('razorpay_payment_id') or 'Not available'}",
        f"Razorpay Order ID: {payment.get('razorpay_order_id') or 'Not available'}",
        f"Quotation Reference: {payment.get('quotation_reference') or 'Not applicable'}",
        "",
        "This invoice confirms the subscription payment recorded by YourComate HRMS.",
        "For billing corrections, contact the YourComate support or Superadmin team.",
    ]

    return build_text_pdf(lines)


def build_quote_history_item(request_doc, update_doc):
    quoted_amount = update_doc.get("quoted_amount", request_doc.get("quoted_amount"))
    quoted_currency = update_doc.get("quoted_currency", request_doc.get("quoted_currency", "INR"))
    billing_interval = update_doc.get(
        "quoted_billing_interval",
        request_doc.get("quoted_billing_interval", "monthly"),
    )

    return {
        "status": update_doc.get("status", request_doc.get("status", "quoted")),
        "quoted_amount": quoted_amount,
        "quoted_currency": quoted_currency,
        "quoted_employee_limit": update_doc.get(
            "quoted_employee_limit",
            request_doc.get("quoted_employee_limit"),
        ),
        "quoted_billing_interval": billing_interval,
        "payment_due_date": update_doc.get("payment_due_date", request_doc.get("payment_due_date")),
        "payment_link": update_doc.get("payment_link", request_doc.get("payment_link")),
        "quotation_reference": update_doc.get(
            "quotation_reference",
            request_doc.get("quotation_reference"),
        ),
        "sales_note": update_doc.get("sales_note", request_doc.get("sales_note")),
        "created_at": now_utc(),
        "created_by": current_user_id(),
    }


def company_billing_url():
    base_url = safe_str(
        current_app.config.get("FRONTEND_BASE_URL")
        or current_app.config.get("PUBLIC_FRONTEND_URL")
        or current_app.config.get("APP_FRONTEND_URL")
    )
    billing_path = safe_str(current_app.config.get("BILLING_PAGE_PATH") or "/billing")

    if not base_url:
        return billing_path or "/billing"

    return f"{base_url.rstrip('/')}/{billing_path.lstrip('/')}"


def premium_quotation_email_recipient(request_doc):
    return (
        safe_str((request_doc or {}).get("company_email"))
        or safe_str((request_doc or {}).get("requester_email"))
    )


def premium_notification_recipients(db, tenant_id, request_doc=None):
    role_values = [
        "admin",
        "company_admin",
        "tenant_admin",
        "hr",
        "hr_manager",
        "accounts",
        "accounts_finance",
        "finance",
    ]

    query = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "is_active": {"$ne": False},
        "status": {"$ne": "inactive"},
        "$or": [
            {"roles": {"$in": role_values}},
            {"role": {"$in": role_values}},
            {"role": {"$in": [role.replace("_", " ") for role in role_values]}},
            {"primary_role": {"$in": role_values}},
        ],
    }

    users = list(
        db.users.find(
            query,
            {
                "_id": 1,
                "name": 1,
                "full_name": 1,
                "email": 1,
                "tenant_id": 1,
                "roles": 1,
                "role": 1,
            },
        ).limit(100)
    )

    request_doc = request_doc or {}
    email_values = [
        safe_str(request_doc.get("requester_email")),
        safe_str(request_doc.get("company_email")),
    ]
    email_values = [email for email in email_values if email]

    if email_values:
        extra_users = list(
            db.users.find(
                {
                    "tenant_id": tenant_id,
                    "is_deleted": {"$ne": True},
                    "email": {"$in": email_values},
                },
                {
                    "_id": 1,
                    "name": 1,
                    "full_name": 1,
                    "email": 1,
                    "tenant_id": 1,
                    "roles": 1,
                    "role": 1,
                },
            ).limit(20)
        )
        users.extend(extra_users)

    deduped = []
    seen = set()

    for user in users:
        user_id = str(user.get("_id") or "")

        if user_id and user_id not in seen:
            seen.add(user_id)
            deduped.append(user)

    return deduped


def create_premium_quotation_notifications(db, request_doc):
    tenant_id = safe_str((request_doc or {}).get("tenant_id"))

    if not tenant_id:
        return 0

    users = premium_notification_recipients(db, tenant_id, request_doc)
    now = now_utc()
    amount = request_doc.get("renewal_amount") or request_doc.get("quoted_amount")
    currency = request_doc.get("quoted_currency") or "INR"
    interval = request_doc.get("quoted_billing_interval") or "monthly"
    reference = request_doc.get("quotation_reference") or request_doc.get("request_reference") or "Premium quotation"
    amount_text = f"{currency} {amount}" if amount not in [None, ""] else "as per quotation"

    docs = []

    for user in users:
        user_id = str(user.get("_id") or "")

        if not user_id:
            continue

        docs.append({
            "tenant_id": tenant_id,
            "tenant_name": request_doc.get("company_name") or "",
            "target_tenant_id": tenant_id,
            "target_tenant_name": request_doc.get("company_name") or "",
            "user_id": user_id,
            "user_ids": [user_id],
            "title": "Premium quotation is ready",
            "body": (
                f"Your Premium quotation {reference} is ready. "
                f"Amount: {amount_text} / {interval}. Open Billing to complete payment."
            ),
            "message": (
                f"Your Premium quotation {reference} is ready. "
                f"Amount: {amount_text} / {interval}. Open Billing to complete payment."
            ),
            "notification_type": "premium_quotation",
            "priority": "high",
            "target": "billing",
            "target_scope": "tenant",
            "audience": "tenant",
            "show_popup": True,
            "popup_seen": False,
            "popup_seen_at": "",
            "read": False,
            "status": "unread",
            "created_at": now,
            "updated_at": now,
            "created_by": current_user_id(),
            "created_by_name": "Superadmin",
            "created_by_role": ["super_admin"],
            "is_deleted": False,
            "meta": {
                "target": "billing",
                "page": "billing",
                "request_id": str(request_doc.get("_id") or ""),
                "request_reference": request_doc.get("request_reference"),
                "quotation_reference": request_doc.get("quotation_reference"),
                "payment_status": request_doc.get("payment_status"),
                "payment_due_date": request_doc.get("payment_due_date"),
                "payment_link": request_doc.get("payment_link"),
                "quoted_amount": amount,
                "quoted_currency": currency,
                "billing_interval": interval,
                "recipient_user_id": user_id,
                "recipient_email": user.get("email", ""),
                "recipient_name": user.get("name") or user.get("full_name") or user.get("email") or "User",
            },
        })

    if not docs:
        return 0

    result = db.notifications.insert_many(docs)
    return len(result.inserted_ids or [])


def requested_tenant_id(default_to_current=True):
    data = request_json()
    tenant_id = safe_str(
        data.get("tenant_id")
        or data.get("company_id")
        or request.args.get("tenant_id")
        or request.args.get("company_id")
    )

    if tenant_id and current_user_is_superadmin():
        return tenant_id

    if default_to_current:
        return current_tenant_id()

    return tenant_id


def error_response(error):
    if isinstance(error, BillingServiceError):
        return jsonify({
            "message": error.message,
            "code": error.code,
            "details": clean_doc(error.details),
        }), error.status_code

    if isinstance(error, PricingServiceError):
        return jsonify({
            "message": error.message,
            "code": error.code,
            "details": clean_doc(error.details),
        }), error.status_code

    if isinstance(error, RazorpayServiceError):
        return jsonify({
            "message": error.message,
            "code": error.code,
            "details": clean_doc(error.details),
        }), error.status_code

    return jsonify({
        "message": "Billing request failed.",
        "code": "billing_request_failed",
        "details": str(error),
    }), 500


def paginated_cursor(collection, query, page=1, limit=20, sort=None):
    try:
        page = int(page)
    except (TypeError, ValueError):
        page = 1

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 20

    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    skip = (page - 1) * limit
    sort = sort or [("created_at", -1)]

    total = collection.count_documents(query)
    rows = list(
        collection.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
    )

    return {
        "items": clean_doc(rows),
        "page": page,
        "limit": limit,
        "total": total,
        "pages": (total + limit - 1) // limit if limit else 1,
    }


@billing_bp.get("/pricing")
def public_pricing():
    """
    Public pricing endpoint used by login/demo/billing screens.

    It returns the active dynamic pricing plans:
    - Essential
    - Growth
    - Premium
    plus the 15-day full-access trial details.
    """

    db = get_db()

    try:
        payload = build_public_pricing_payload(db)
        return jsonify({
            "ok": True,
            **clean_doc(payload),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.get("/summary")
@current_user_required
def billing_summary():
    """
    Returns billing/subscription state for the logged-in company.
    Superadmin can optionally pass ?tenant_id=... to check another company.
    """

    db = get_db()
    tenant_id = requested_tenant_id(default_to_current=True)

    try:
        company = find_company_for_billing(db, tenant_id)
        summary = build_billing_summary(db, company)
        checkout = summary.get("checkout") or {}

        latest_premium_request = db.premium_plan_requests.find_one(
            {
                "tenant_id": tenant_id,
                "is_deleted": {"$ne": True},
                "client_visible": True,
                "quotation_status": {"$in": ["sent", "converted"]},
            },
            sort=[("quotation_sent_at", -1), ("updated_at", -1), ("created_at", -1)],
        )
        client_premium_request = build_client_visible_premium_request(latest_premium_request)
        invoices = load_tenant_invoices(db, tenant_id, limit=50)
        billing_actions = build_billing_actions(summary)
        billing_alerts = build_billing_alerts(summary, client_premium_request)
        access_days_left = billing_actions.get("days_left")

        return jsonify({
            "ok": True,
            "company": clean_doc(company),
            "tenant": clean_doc(company),
            "subscription": clean_doc(summary),
            "billing": clean_doc(summary),

            # Flat fields are kept for Billing.jsx compatibility.
            "tenant_id": summary.get("tenant_id"),
            "tenant_code": summary.get("tenant_code"),
            "company_name": summary.get("company_name"),
            "company_email": company.get("company_email") or company.get("contact_email") or company.get("email"),
            "status": summary.get("status"),
            "plan": summary.get("plan"),
            "plan_code": summary.get("plan_code"),
            "plan_type": summary.get("plan_type"),
            "plan_label": summary.get("plan_label"),
            "selected_plan_code": summary.get("selected_plan_code"),
            "selected_plan_name": summary.get("selected_plan_name"),
            "billing_interval": summary.get("billing_interval"),
            "subscription_status": summary.get("subscription_status"),
            "trial_status": summary.get("trial_status"),
            "trial_start_date": summary.get("trial_start_date"),
            "trial_end_date": summary.get("trial_end_date"),
            "subscription_start_date": summary.get("subscription_start_date"),
            "subscription_end_date": summary.get("subscription_end_date"),
            "next_payment_due_date": summary.get("next_payment_due_date"),
            "trial_days_left": summary.get("trial_days_left"),
            "subscription_days_left": summary.get("subscription_days_left"),
            "days_left": access_days_left,
            "subscription_valid_until": billing_actions.get("subscription_valid_until"),
            "employee_count": summary.get("employee_count"),
            "employees_used": summary.get("employee_count"),
            "employee_limit": summary.get("employee_limit"),
            "is_unlimited_employees": summary.get("is_unlimited_employees"),
            "allowed_modules": summary.get("allowed_modules") or [],
            "is_sds_company": summary.get("is_sds_company"),
            "has_lifetime_access": summary.get("is_lifetime"),
            "is_lifetime": summary.get("is_lifetime"),
            "is_demo_company": summary.get("is_demo_company"),
            "is_paid_company": summary.get("is_paid_company"),
            "is_expired": summary.get("is_expired"),
            "is_suspended": summary.get("is_suspended"),
            "demo_has_full_access": summary.get("demo_has_full_access"),
            "requires_payment": summary.get("requires_payment"),
            "billing_page_path": summary.get("billing_page_path"),

            # Dynamic pricing fields.
            "checkout": clean_doc(checkout),
            "pricing": clean_doc(summary.get("pricing") or {}),
            "plans": clean_doc(summary.get("plans") or []),
            "trial": clean_doc(summary.get("trial") or {}),
            "default_plan": clean_doc(summary.get("default_plan") or {}),

            # Client billing actions, status alerts, invoices, and Premium quotation.
            "billing_actions": clean_doc(billing_actions),
            "billing_alerts": clean_doc(billing_alerts),
            "show_upgrade_actions": billing_actions.get("show_upgrade_actions"),
            "show_plan_selection": billing_actions.get("show_plan_selection"),
            "show_payment_actions": billing_actions.get("show_payment_actions"),
            "renewal_due_soon": billing_actions.get("renewal_due_soon"),
            "renewal_window_days": billing_actions.get("renewal_window_days"),
            "invoices": invoices,
            "payment_history": invoices,
            "invoice_count": len(invoices),
            "latest_invoice": invoices[0] if invoices else None,
            "premium_request": clean_doc(client_premium_request),
            "premium_quotation": clean_doc(client_premium_request),
            "premium_payment_due": clean_doc(client_premium_request),

            # Legacy flat checkout fields.
            "plan_amount": checkout.get("plan_amount"),
            "amount": checkout.get("plan_amount"),
            "currency": checkout.get("currency"),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.get("/invoices")
@current_user_required
def billing_invoices():
    """Lists invoice/payment records visible to the logged-in company."""

    db = get_db()
    tenant_id = requested_tenant_id(default_to_current=True)

    try:
        company = find_company_for_billing(db, tenant_id)
        invoices = load_tenant_invoices(
            db,
            tenant_id,
            limit=request.args.get("limit", 50),
        )

        return jsonify({
            "ok": True,
            "tenant_id": tenant_id,
            "company_name": company.get("company_name") or company.get("name"),
            "items": invoices,
            "total": len(invoices),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.get("/invoices/<payment_id>/download")
@current_user_required
def download_billing_invoice(payment_id):
    """Downloads one authorized company payment record as a PDF invoice."""

    db = get_db()
    object_id = object_id_or_none(payment_id)
    identifier_query = (
        {"_id": object_id}
        if object_id
        else {
            "$or": [
                {"invoice_number": payment_id},
                {"receipt_number": payment_id},
                {"razorpay_payment_id": payment_id},
            ]
        }
    )
    query = {
        **identifier_query,
        "is_deleted": {"$ne": True},
    }

    if not current_user_is_superadmin():
        query["tenant_id"] = current_tenant_id()

    payment = db.payments.find_one(query)

    if not payment:
        return jsonify({
            "ok": False,
            "message": "Invoice not found or you do not have access to it.",
            "code": "invoice_not_found",
        }), 404

    company = db.tenants.find_one({
        "tenant_id": payment.get("tenant_id"),
        "is_deleted": {"$ne": True},
    }) or {}
    pdf_bytes = build_invoice_pdf(payment, company)
    invoice_number = safe_str(
        payment.get("invoice_number")
        or payment.get("receipt_number")
        or payment.get("razorpay_payment_id")
        or payment_id
    )
    safe_filename = "".join(
        character if character.isalnum() or character in {"-", "_"} else "-"
        for character in invoice_number
    ).strip("-") or "yourcomate-invoice"

    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}.pdf"',
            "Cache-Control": "private, no-store",
        },
    )


@billing_bp.post("/create-order")
@current_user_required
def create_order():
    """
    Creates a Razorpay order for a selected paid plan.

    Expected body:
    {
      "plan_code": "essential" | "growth" | "premium",
      "premium_request_id": "required for a specific Premium quotation"
    }

    Essential and Growth use the latest active Superadmin price.
    Premium uses the released custom quotation identified by
    premium_request_id. Any browser-supplied amount is ignored by the
    billing service.
    """

    db = get_db()
    data = request_json()
    tenant_id = requested_tenant_id(default_to_current=True)
    amount = data.get("amount")
    plan_code = data.get("plan_code") or data.get("selected_plan_code")
    premium_request_id = (
        data.get("premium_request_id")
        or data.get("premium_plan_request_id")
        or data.get("request_id")
    )

    try:
        order = create_subscription_order(
            db,
            tenant_id=tenant_id,
            requested_by=current_user_id(),
            amount=amount,
            plan_code=plan_code,
            premium_request_id=premium_request_id,
        )

        checkout = order.get("checkout") or {}
        selected_plan = order.get("selected_plan") or {}
        plan = order.get("plan") or {}

        resolved_premium_request_id = (
            checkout.get("premium_request_id")
            or selected_plan.get("premium_request_id")
            or premium_request_id
        )
        quotation_reference = (
            checkout.get("quotation_reference")
            or selected_plan.get("quotation_reference")
        )
        payment_source = (
            checkout.get("payment_source")
            or selected_plan.get("payment_source")
        )
        renewal_price_source = (
            checkout.get("renewal_price_source")
            or selected_plan.get("renewal_price_source")
        )

        audit(
            "billing.order_created",
            "payment_orders",
            order.get("order_id"),
            {
                "tenant_id": tenant_id,
                "razorpay_order_id": order.get("razorpay_order_id"),
                "plan_code": checkout.get("plan_code") or plan_code,
                "premium_request_id": resolved_premium_request_id,
                "quotation_reference": quotation_reference,
            },
        )

        return jsonify({
            "ok": True,
            "message": "Payment order created successfully.",

            # Local order fields.
            "local_order_id": order.get("order_id"),
            "order_id": order.get("order_id"),

            # Selected dynamic/custom plan.
            "plan": clean_doc(plan),
            "selected_plan": clean_doc(selected_plan),
            "plan_code": checkout.get("plan_code") or selected_plan.get("plan_code"),
            "plan_name": checkout.get("plan_name") or selected_plan.get("plan_name"),
            "plan_label": checkout.get("plan_label") or selected_plan.get("plan_label"),
            "employee_limit": checkout.get("employee_limit"),
            "is_unlimited_employees": checkout.get("is_unlimited_employees"),
            "billing_interval": checkout.get("plan_interval") or selected_plan.get("billing_interval"),
            "premium_request_id": resolved_premium_request_id,
            "quotation_reference": quotation_reference,
            "payment_source": payment_source,
            "renewal_price_source": renewal_price_source,

            # Razorpay public fields expected by Billing.jsx.
            "key_id": checkout.get("key_id"),
            "razorpay_key_id": checkout.get("key_id"),
            "razorpay_order_id": order.get("razorpay_order_id"),
            "amount": checkout.get("amount"),
            "amount_rupees": checkout.get("amount_rupees"),
            "currency": checkout.get("currency"),
            "description": checkout.get("description"),
            "prefill": checkout.get("prefill") or {},
            "notes": checkout.get("notes") or {},

            # The order object is shaped like a Razorpay checkout order.
            "order": clean_doc({
                "id": order.get("razorpay_order_id"),
                "razorpay_order_id": order.get("razorpay_order_id"),
                "key_id": checkout.get("key_id"),
                "amount": checkout.get("amount"),
                "amount_rupees": checkout.get("amount_rupees"),
                "currency": checkout.get("currency"),
                "description": checkout.get("description"),
                "prefill": checkout.get("prefill") or {},
                "notes": checkout.get("notes") or {},
                "plan_code": checkout.get("plan_code"),
                "plan_name": checkout.get("plan_name"),
                "plan_label": checkout.get("plan_label"),
                "employee_limit": checkout.get("employee_limit"),
                "is_unlimited_employees": checkout.get("is_unlimited_employees"),
                "billing_interval": checkout.get("plan_interval"),
                "premium_request_id": resolved_premium_request_id,
                "quotation_reference": quotation_reference,
                "payment_source": payment_source,
                "renewal_price_source": renewal_price_source,
            }),

            # Full service response remains available for debugging/admin usage.
            "raw_order": clean_doc(order),
        }), 201
    except Exception as exc:
        return error_response(exc)


@billing_bp.post("/premium-request")
@current_user_required
def premium_plan_request():
    """
    Saves a Premium custom quotation request for Superadmin/Sales review.

    This route does not create a Razorpay order because Premium is quote-based.
    It does not send email. The request is shown in the Superadmin Premium
    Requests page for follow-up, quotation and manual payment/activation.
    Expected optional body:
    {
      "plan_code": "premium",
      "contact_name": "...",
      "contact_email": "...",
      "contact_phone": "...",
      "message": "...",
      "requirements": {
        "employee_count": 250,
        "onboarding": "Yes",
        "training": "Yes",
        "support_sla": "Priority",
        "custom_modules": "..."
      }
    }
    """

    db = get_db()
    data = request_json()
    tenant_id = requested_tenant_id(default_to_current=True)
    user = getattr(g, "current_user", {}) or {}

    try:
        company = find_company_for_billing(db, tenant_id)
        summary = build_billing_summary(db, company)

        selected_plan = db.pricing_plans.find_one({
            "plan_code": safe_str(data.get("plan_code") or "premium").lower() or "premium",
            "is_deleted": {"$ne": True},
        }) or {}

        requester_name = safe_str(
            data.get("contact_name")
            or data.get("requester_name")
            or user.get("name")
            or user.get("full_name")
            or company.get("contact_person")
            or company.get("company_name")
        )

        requester_email = safe_str(
            data.get("contact_email")
            or data.get("requester_email")
            or user.get("email")
            or company.get("company_email")
            or company.get("contact_email")
            or company.get("email")
        )

        requester_phone = safe_str(
            data.get("contact_phone")
            or data.get("requester_phone")
            or user.get("phone")
            or user.get("mobile")
            or company.get("contact_phone")
            or company.get("phone")
            or company.get("mobile")
        )

        requirements = data.get("requirements")
        if not isinstance(requirements, dict):
            requirements = {}

        explicit_employee_count = (
            requirements.get("employee_count")
            or data.get("employee_count")
            or summary.get("employee_count")
        )

        request_doc = {
            "tenant_id": tenant_id,
            "tenant_code": company.get("tenant_code"),
            "company_name": (
                company.get("company_name")
                or company.get("name")
                or summary.get("company_name")
                or "YourComate company"
            ),
            "company_email": (
                safe_str(data.get("company_email"))
                or company.get("company_email")
                or company.get("contact_email")
                or company.get("email")
                or requester_email
            ),
            "requester_name": requester_name,
            "requester_email": requester_email,
            "requester_phone": requester_phone,
            "requested_plan_code": selected_plan.get("plan_code") or "premium",
            "requested_plan_name": selected_plan.get("plan_name") or "Premium",
            "requested_plan_label": selected_plan.get("plan_label") or "Premium",
            "is_custom_pricing": True,
            "allow_online_payment": False,
            "employee_count": explicit_employee_count,

            # Quotation/payment lifecycle.
            "quotation_status": "pending",
            "client_visible": False,
            "payment_status": "not_quoted",
            "quoted_amount": None,
            "quoted_currency": "INR",
            "quoted_employee_limit": None,
            "quoted_billing_interval": "monthly",
            "payment_due_date": None,
            "next_due_date": None,
            "renewal_amount": None,
            "renewal_price_source": "custom_quote",
            "payment_link": "",
            "quotation_reference": "",
            "quotation_sent_at": None,
            "quotation_sent_by": None,
            "quotation_history": [],

            "current_plan_type": summary.get("plan_type"),
            "current_status": summary.get("status"),
            "trial_status": summary.get("trial_status"),
            "trial_days_left": summary.get("trial_days_left"),
            "requirements": requirements,
            "message": safe_str(data.get("message")),
            "status": "new",
            "source": "billing_premium_request_form",
            "created_by": current_user_id(),
            "created_by_email": user.get("email"),
            "created_at": now_utc(),
            "updated_at": now_utc(),
            "is_deleted": False,
        }

        result = db.premium_plan_requests.insert_one(request_doc)
        request_id = str(result.inserted_id)

        db.premium_plan_requests.update_one(
            {"_id": result.inserted_id},
            {
                "$set": {
                    "request_reference": f"PRM-{request_id[-8:].upper()}",
                    "updated_at": now_utc(),
                }
            },
        )

        request_doc["request_reference"] = f"PRM-{request_id[-8:].upper()}"

        db.tenants.update_one(
            {"tenant_id": tenant_id},
            {
                "$set": {
                    "selected_plan_code": "premium",
                    "last_premium_request_id": request_id,
                    "last_premium_request_at": now_utc(),
                    "updated_at": now_utc(),
                }
            },
        )

        audit(
            "billing.premium_request_created",
            "premium_plan_requests",
            request_id,
            {
                "tenant_id": tenant_id,
                "company_name": request_doc.get("company_name"),
                "status": "new",
            },
        )

        return jsonify({
            "ok": True,
            "message": (
                "Premium request submitted successfully. "
                "Our sales team will connect with you within 24 hours."
            ),
            "request_id": request_id,
            "request_reference": request_doc.get("request_reference"),
            "request": clean_doc({
                **request_doc,
                "_id": request_id,
            }),
        }), 201
    except Exception as exc:
        return error_response(exc)



@billing_bp.post("/verify-payment")
@current_user_required
def verify_payment():
    """
    Verifies Razorpay checkout response and activates paid full HRMS access.
    Expected body:
    {
      "razorpay_order_id": "...",
      "razorpay_payment_id": "...",
      "razorpay_signature": "..."
    }
    """

    db = get_db()
    data = request_json()
    tenant_id = requested_tenant_id(default_to_current=True)

    try:
        result = verify_and_activate_payment(
            db,
            tenant_id=tenant_id,
            payload=data,
        )

        audit(
            "billing.payment_verified",
            "payments",
            result.get("payment_id"),
            {
                "tenant_id": tenant_id,
                "razorpay_order_id": data.get("razorpay_order_id"),
                "razorpay_payment_id": data.get("razorpay_payment_id"),
            },
        )

        billing = result.get("billing") or {}
        subscription = result.get("subscription") or billing

        return jsonify({
            "ok": True,
            "message": result.get("message") or "Payment verified successfully. Full HRMS access is now active.",
            **clean_doc(result),

            # Flat fields help frontend refresh status immediately after payment.
            "subscription": clean_doc(subscription),
            "billing": clean_doc(billing),
            "tenant_id": billing.get("tenant_id"),
            "company_name": billing.get("company_name"),
            "status": billing.get("status"),
            "plan_code": billing.get("plan_code") or subscription.get("plan_code"),
            "plan_type": billing.get("plan_type"),
            "plan_label": billing.get("plan_label") or subscription.get("plan_label"),
            "selected_plan_code": billing.get("selected_plan_code") or subscription.get("plan_code"),
            "selected_plan_name": billing.get("selected_plan_name") or subscription.get("plan_name"),
            "subscription_status": billing.get("subscription_status"),
            "employee_limit": billing.get("employee_limit") or subscription.get("employee_limit"),
            "is_unlimited_employees": billing.get("is_unlimited_employees") or subscription.get("is_unlimited_employees"),
            "is_paid_company": billing.get("is_paid_company"),
            "requires_payment": billing.get("requires_payment"),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.post("/webhook")
def razorpay_webhook():
    """
    Stores Razorpay webhook events after signature verification.
    Checkout payment activation still happens through /verify-payment.
    This endpoint is kept ready for production webhook monitoring.
    """

    db = get_db()
    raw_body = request.get_data() or b""
    signature = request.headers.get("X-Razorpay-Signature", "")

    try:
        if not verify_webhook_signature(raw_body, signature):
            return jsonify({
                "ok": False,
                "message": "Invalid Razorpay webhook signature.",
            }), 400

        payload = request.get_json(silent=True) or {}
        event_name = safe_str(payload.get("event"))
        entity = (
            payload.get("payload", {})
            .get("payment", {})
            .get("entity", {})
        )

        webhook_doc = {
            "event": event_name,
            "razorpay_payment_id": entity.get("id"),
            "razorpay_order_id": entity.get("order_id"),
            "payload": payload,
            "created_at": now_utc(),
            "processed": False,
        }

        result = db.razorpay_webhooks.insert_one(webhook_doc)

        return jsonify({
            "ok": True,
            "webhook_id": str(result.inserted_id),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.post("/admin/refresh-expired-demos")
@roles_required("super_admin")
def admin_refresh_expired_demos():
    """
    Superadmin utility endpoint.
    Marks demo companies as expired when trial end date has passed.
    """

    db = get_db()

    try:
        result = expire_due_demo_companies(db)

        audit(
            "billing.refresh_expired_demos",
            "tenants",
            None,
            result,
        )

        return jsonify({
            "ok": True,
            "message": "Expired demo company status refreshed.",
            "result": clean_doc(result),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.get("/admin/pricing-plans")
@roles_required("super_admin")
def admin_pricing_plans():
    """
    Superadmin list of dynamic pricing plans.
    """

    db = get_db()

    try:
        ensure_default_pricing_plans(db, created_by=current_user_id())
        plans = list_pricing_plans(
            db,
            include_inactive=True,
            include_deleted=False,
        )

        return jsonify({
            "ok": True,
            "items": clean_doc(plans),
            "plans": clean_doc(plans),
            "total": len(plans),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.post("/admin/pricing-plans")
@roles_required("super_admin")
def admin_create_or_update_pricing_plan():
    """
    Create or update a dynamic pricing plan.

    Body can include:
    {
      plan_code,
      plan_name,
      amount,
      employee_limit,
      is_unlimited_employees,
      is_custom_pricing,
      allow_online_payment,
      is_recommended,
      features
    }
    """

    db = get_db()
    data = request_json()

    try:
        plan = upsert_pricing_plan(db, data, updated_by=current_user_id())

        audit(
            "billing.pricing_plan_upserted",
            "pricing_plans",
            plan.get("_id") or plan.get("plan_code"),
            {
                "plan_code": plan.get("plan_code"),
                "amount": plan.get("amount"),
                "employee_limit": plan.get("employee_limit"),
            },
        )

        return jsonify({
            "ok": True,
            "message": "Pricing plan saved successfully.",
            "plan": clean_doc(plan),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.put("/admin/pricing-plans/<plan_code>")
@billing_bp.patch("/admin/pricing-plans/<plan_code>")
@roles_required("super_admin")
def admin_update_pricing_plan(plan_code):
    db = get_db()
    data = request_json()
    data["plan_code"] = plan_code

    try:
        plan = upsert_pricing_plan(db, data, updated_by=current_user_id())

        audit(
            "billing.pricing_plan_updated",
            "pricing_plans",
            plan.get("_id") or plan.get("plan_code"),
            {
                "plan_code": plan.get("plan_code"),
                "amount": plan.get("amount"),
                "employee_limit": plan.get("employee_limit"),
            },
        )

        return jsonify({
            "ok": True,
            "message": "Pricing plan updated successfully.",
            "plan": clean_doc(plan),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.delete("/admin/pricing-plans/<plan_code>")
@roles_required("super_admin")
def admin_delete_pricing_plan(plan_code):
    """
    Archives custom pricing plans.
    Default plans cannot be deleted; edit/deactivate them instead.
    """

    db = get_db()

    try:
        result = archive_pricing_plan(db, plan_code, updated_by=current_user_id())

        audit(
            "billing.pricing_plan_archived",
            "pricing_plans",
            plan_code,
            result,
        )

        return jsonify({
            "ok": True,
            "message": "Pricing plan archived successfully.",
            "result": clean_doc(result),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.get("/admin/premium-requests")
@roles_required("super_admin")
def admin_premium_requests():
    """
    Superadmin monitoring list for Premium custom quotation requests.
    """

    db = get_db()
    status = safe_str(request.args.get("status"))
    tenant_id = safe_str(request.args.get("tenant_id"))
    search = safe_str(request.args.get("search"))

    query = {"is_deleted": {"$ne": True}}

    if status and status.lower() != "all":
        query["status"] = status

    if tenant_id:
        query["tenant_id"] = tenant_id

    if search:
        query["$or"] = [
            {"company_name": {"$regex": search, "$options": "i"}},
            {"company_email": {"$regex": search, "$options": "i"}},
            {"requester_name": {"$regex": search, "$options": "i"}},
            {"requester_email": {"$regex": search, "$options": "i"}},
            {"requester_phone": {"$regex": search, "$options": "i"}},
            {"requested_plan_code": {"$regex": search, "$options": "i"}},
            {"requested_plan_name": {"$regex": search, "$options": "i"}},
        ]

    data = paginated_cursor(
        db.premium_plan_requests,
        query,
        page=request.args.get("page", 1),
        limit=request.args.get("limit", 20),
    )

    for item in data.get("items", []):
        alert_level, alert_message = premium_admin_alert(item)
        item["alert_level"] = alert_level
        item["alert_message"] = alert_message
        item["payment_days_left"] = days_until(item.get("payment_due_date"))

    return jsonify({"ok": True, **data})


@billing_bp.patch("/admin/premium-requests/<request_id>")
@billing_bp.put("/admin/premium-requests/<request_id>")
@roles_required("super_admin")
def admin_update_premium_request(request_id):
    """
    Updates Premium request quotation and follow-up status.

    Premium pricing rule:
    - Premium is custom quote-based.
    - Once quoted_amount is decided, that amount becomes the renewal amount.
    - The renewal amount can be revised later by Superadmin.
    - The client panel reads client_visible/payment_status/payment_due_date/payment_link.
    """

    db = get_db()
    data = request_json()
    object_id = object_id_or_none(request_id)

    if not object_id:
        return jsonify({
            "ok": False,
            "message": "Invalid Premium request ID.",
            "code": "invalid_premium_request_id",
        }), 400

    existing = db.premium_plan_requests.find_one({
        "_id": object_id,
        "is_deleted": {"$ne": True},
    })

    if not existing:
        return jsonify({
            "ok": False,
            "message": "Premium request not found.",
            "code": "premium_request_not_found",
        }), 404

    allowed_statuses = {
        "new",
        "contacted",
        "requirements_collected",
        "quoted",
        "payment_pending",
        "converted",
        "closed",
        "cancelled",
    }

    status = safe_str(data.get("status")).lower().replace(" ", "_").replace("-", "_")
    send_to_client = truthy(data.get("send_to_client"))
    update_doc = {
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
    }

    if status:
        if status not in allowed_statuses:
            return jsonify({
                "ok": False,
                "message": "Invalid Premium request status.",
                "code": "invalid_premium_request_status",
                "allowed_statuses": sorted(allowed_statuses),
            }), 400

        update_doc["status"] = status

    simple_fields = [
        "sales_note",
        "quotation_reference",
        "payment_link",
        "follow_up_date",
        "invoice_notes",
        "internal_note",
    ]

    for field in simple_fields:
        if field in data:
            update_doc[field] = data.get(field)

    if "quoted_amount" in data and data.get("quoted_amount") not in [None, ""]:
        quoted_amount = parse_number_or_none(data.get("quoted_amount"))

        if quoted_amount is None or quoted_amount <= 0:
            return jsonify({
                "ok": False,
                "message": "Quoted amount must be a valid positive number.",
                "code": "invalid_quoted_amount",
            }), 400

        update_doc["quoted_amount"] = quoted_amount
        update_doc["renewal_amount"] = quoted_amount
        update_doc["payment_amount"] = quoted_amount
        update_doc["renewal_price_source"] = "custom_quote"

    if "renewal_amount" in data and data.get("renewal_amount") not in [None, ""]:
        renewal_amount = parse_number_or_none(data.get("renewal_amount"))

        if renewal_amount is None or renewal_amount <= 0:
            return jsonify({
                "ok": False,
                "message": "Renewal amount must be a valid positive number.",
                "code": "invalid_renewal_amount",
            }), 400

        update_doc["renewal_amount"] = renewal_amount
        update_doc["payment_amount"] = renewal_amount
        update_doc["renewal_price_source"] = "custom_quote"

    if "quoted_currency" in data:
        update_doc["quoted_currency"] = normalize_currency(data.get("quoted_currency"))

    if truthy(data.get("is_unlimited_employees")):
        update_doc["quoted_employee_limit"] = 0
        update_doc["is_unlimited_employees"] = True
    elif "quoted_employee_limit" in data and data.get("quoted_employee_limit") not in [None, ""]:
        quoted_employee_limit = parse_int_or_none(data.get("quoted_employee_limit"))

        if quoted_employee_limit is None:
            return jsonify({
                "ok": False,
                "message": "Quoted employee limit must be zero/unlimited or a valid number.",
                "code": "invalid_quoted_employee_limit",
            }), 400

        # 0 means unlimited for Premium.
        update_doc["quoted_employee_limit"] = quoted_employee_limit
        update_doc["is_unlimited_employees"] = quoted_employee_limit == 0

    if "quoted_billing_interval" in data:
        update_doc["quoted_billing_interval"] = normalize_billing_interval(
            data.get("quoted_billing_interval")
        )

    if "billing_interval" in data:
        update_doc["quoted_billing_interval"] = normalize_billing_interval(
            data.get("billing_interval")
        )

    if "payment_due_date" in data:
        update_doc["payment_due_date"] = parse_date_or_none(data.get("payment_due_date"))

    if "next_due_date" in data:
        update_doc["next_due_date"] = parse_date_or_none(data.get("next_due_date"))

    if "quotation_valid_until" in data:
        update_doc["quotation_valid_until"] = parse_date_or_none(data.get("quotation_valid_until"))

    quote_amount = update_doc.get("quoted_amount", existing.get("quoted_amount"))
    renewal_amount = update_doc.get("renewal_amount", existing.get("renewal_amount") or quote_amount)

    if send_to_client:
        if quote_amount is None:
            return jsonify({
                "ok": False,
                "message": "Please enter a quoted amount before sending quotation to client.",
                "code": "quoted_amount_required",
            }), 400

        if renewal_amount is None or renewal_amount <= 0:
            return jsonify({
                "ok": False,
                "message": "Please enter a valid quoted amount before sending quotation to client.",
                "code": "quoted_amount_required",
            }), 400

        update_doc["client_visible"] = True
        update_doc["quotation_status"] = "sent"
        update_doc["payment_status"] = "pending"
        update_doc["status"] = "payment_pending"
        update_doc["quotation_sent_at"] = now_utc()
        update_doc["quotation_sent_by"] = current_user_id()
        update_doc["renewal_amount"] = renewal_amount
        update_doc["payment_amount"] = renewal_amount
        update_doc["renewal_price_source"] = "custom_quote"
        update_doc["draft_revision_pending"] = False

        if not update_doc.get("quoted_currency"):
            update_doc["quoted_currency"] = existing.get("quoted_currency") or "INR"

        if not update_doc.get("quoted_billing_interval"):
            update_doc["quoted_billing_interval"] = (
                existing.get("quoted_billing_interval")
                or "monthly"
            )

        if not update_doc.get("payment_due_date") and not existing.get("payment_due_date"):
            update_doc["payment_due_date"] = default_payment_due_date()

    quotation_fields_changed = any(
        field in update_doc
        for field in {
            "quoted_amount",
            "renewal_amount",
            "payment_amount",
            "quoted_currency",
            "quoted_employee_limit",
            "is_unlimited_employees",
            "quoted_billing_interval",
            "payment_due_date",
            "next_due_date",
            "quotation_valid_until",
            "payment_link",
            "quotation_reference",
            "sales_note",
        }
    )

    if not send_to_client and existing.get("client_visible") and quotation_fields_changed:
        update_doc["draft_revision_pending"] = True

    if send_to_client:
        published_quotation = {
            "quoted_amount": update_doc.get("quoted_amount", existing.get("quoted_amount")),
            "renewal_amount": update_doc.get("renewal_amount", existing.get("renewal_amount") or quote_amount),
            "payment_amount": update_doc.get("payment_amount", existing.get("payment_amount") or renewal_amount),
            "quoted_currency": update_doc.get("quoted_currency", existing.get("quoted_currency") or "INR"),
            "quoted_employee_limit": update_doc.get("quoted_employee_limit", existing.get("quoted_employee_limit")),
            "is_unlimited_employees": update_doc.get("is_unlimited_employees", existing.get("is_unlimited_employees")),
            "quoted_billing_interval": update_doc.get("quoted_billing_interval", existing.get("quoted_billing_interval") or "monthly"),
            "payment_due_date": update_doc.get("payment_due_date", existing.get("payment_due_date")),
            "next_due_date": update_doc.get("next_due_date", existing.get("next_due_date")),
            "quotation_valid_until": update_doc.get("quotation_valid_until", existing.get("quotation_valid_until")),
            "payment_link": update_doc.get("payment_link", existing.get("payment_link")),
            "quotation_reference": update_doc.get("quotation_reference", existing.get("quotation_reference")),
            "sales_note": update_doc.get("sales_note", existing.get("sales_note")),
            "published_at": now_utc(),
            "published_by": current_user_id(),
        }
        update_doc["published_quotation"] = published_quotation

    update_ops = {"$set": update_doc}

    if send_to_client:
        update_ops["$push"] = {
            "quotation_history": build_quote_history_item(existing, update_doc)
        }

    db.premium_plan_requests.update_one(
        {"_id": object_id, "is_deleted": {"$ne": True}},
        update_ops,
    )

    updated = db.premium_plan_requests.find_one({"_id": object_id})
    tenant_id = updated.get("tenant_id") if updated else existing.get("tenant_id")

    if send_to_client and tenant_id:
        db.tenants.update_one(
            {"tenant_id": tenant_id},
            {
                "$set": {
                    "selected_plan_code": "premium",
                    "pending_premium_request_id": request_id,
                    "premium_quote_status": "payment_pending",
                    "premium_quoted_amount": updated.get("renewal_amount") or updated.get("quoted_amount"),
                    "premium_quoted_currency": updated.get("quoted_currency") or "INR",
                    "premium_quoted_employee_limit": updated.get("quoted_employee_limit"),
                    "premium_billing_interval": updated.get("quoted_billing_interval") or "monthly",
                    "premium_payment_due_date": updated.get("payment_due_date"),
                    "premium_payment_link": updated.get("payment_link"),
                    "updated_at": now_utc(),
                }
            },
        )

        email_result = send_premium_quotation_email(
            current_app.config,
            to_email=premium_quotation_email_recipient(updated),
            company_name=updated.get("company_name"),
            quotation_reference=updated.get("quotation_reference") or updated.get("request_reference"),
            quoted_amount=updated.get("renewal_amount") or updated.get("quoted_amount"),
            currency=updated.get("quoted_currency") or "INR",
            billing_interval=updated.get("quoted_billing_interval") or "monthly",
            employee_limit=updated.get("quoted_employee_limit"),
            payment_due_date=updated.get("payment_due_date"),
            payment_link=updated.get("payment_link"),
            quotation_valid_until=updated.get("quotation_valid_until"),
            sales_note=updated.get("sales_note"),
            billing_url=company_billing_url(),
        )

        notification_count = create_premium_quotation_notifications(db, updated)

        db.premium_plan_requests.update_one(
            {"_id": object_id},
            {
                "$set": {
                    "quotation_email_sent": bool(email_result.get("ok")),
                    "quotation_email_result": clean_doc(email_result),
                    "quotation_notification_count": notification_count,
                    "quotation_notice_sent_at": now_utc(),
                    "updated_at": now_utc(),
                }
            },
        )

        updated = db.premium_plan_requests.find_one({"_id": object_id})

    audit(
        "billing.premium_request_updated",
        "premium_plan_requests",
        request_id,
        {
            "status": updated.get("status") if updated else status,
            "tenant_id": tenant_id,
            "client_visible": bool(updated.get("client_visible")) if updated else False,
            "quoted_amount": updated.get("quoted_amount") if updated else None,
            "payment_status": updated.get("payment_status") if updated else None,
            "quotation_email_sent": bool(updated.get("quotation_email_sent")) if updated else False,
            "quotation_notification_count": updated.get("quotation_notification_count") if updated else 0,
        },
    )

    return jsonify({
        "ok": True,
        "message": (
            "Premium quotation sent to client panel successfully."
            if send_to_client
            else "Premium request updated successfully."
        ),
        "request": clean_doc(updated),
        "client_visible": bool(updated.get("client_visible")) if updated else False,
        "payment_status": updated.get("payment_status") if updated else None,
        "quotation_email_sent": bool(updated.get("quotation_email_sent")) if updated else False,
        "quotation_email_result": clean_doc(updated.get("quotation_email_result") if updated else {}),
        "quotation_notification_count": updated.get("quotation_notification_count") if updated else 0,
    })


@billing_bp.get("/admin/orders")
@roles_required("super_admin")
def admin_payment_orders():
    db = get_db()
    status = safe_str(request.args.get("status"))
    tenant_id = safe_str(request.args.get("tenant_id"))
    search = safe_str(request.args.get("search"))

    query = {"is_deleted": {"$ne": True}}

    if status and status.lower() != "all":
        query["status"] = status

    if tenant_id:
        query["tenant_id"] = tenant_id

    if search:
        query["$or"] = [
            {"company_name": {"$regex": search, "$options": "i"}},
            {"company_email": {"$regex": search, "$options": "i"}},
            {"razorpay_order_id": {"$regex": search, "$options": "i"}},
            {"plan_code": {"$regex": search, "$options": "i"}},
            {"plan_name": {"$regex": search, "$options": "i"}},
        ]

    data = paginated_cursor(
        db.payment_orders,
        query,
        page=request.args.get("page", 1),
        limit=request.args.get("limit", 20),
    )

    return jsonify({"ok": True, **data})


@billing_bp.get("/admin/payments")
@roles_required("super_admin")
def admin_payments():
    db = get_db()
    tenant_id = safe_str(request.args.get("tenant_id"))
    search = safe_str(request.args.get("search"))

    query = {"is_deleted": {"$ne": True}}

    if tenant_id:
        query["tenant_id"] = tenant_id

    if search:
        query["$or"] = [
            {"company_name": {"$regex": search, "$options": "i"}},
            {"company_email": {"$regex": search, "$options": "i"}},
            {"razorpay_order_id": {"$regex": search, "$options": "i"}},
            {"razorpay_payment_id": {"$regex": search, "$options": "i"}},
            {"plan_code": {"$regex": search, "$options": "i"}},
            {"plan_name": {"$regex": search, "$options": "i"}},
        ]

    data = paginated_cursor(
        db.payments,
        query,
        page=request.args.get("page", 1),
        limit=request.args.get("limit", 20),
    )
    data["items"] = [serialize_invoice(item) for item in data.get("items", [])]

    return jsonify({"ok": True, **data})


@billing_bp.get("/admin/subscriptions")
@roles_required("super_admin")
def admin_subscriptions():
    db = get_db()
    status = safe_str(request.args.get("status"))
    tenant_id = safe_str(request.args.get("tenant_id"))
    search = safe_str(request.args.get("search"))

    query = {"is_deleted": {"$ne": True}}

    if status and status.lower() != "all":
        query["status"] = status

    if tenant_id:
        query["tenant_id"] = tenant_id

    if search:
        query["$or"] = [
            {"company_name": {"$regex": search, "$options": "i"}},
            {"company_email": {"$regex": search, "$options": "i"}},
            {"plan_code": {"$regex": search, "$options": "i"}},
            {"plan_name": {"$regex": search, "$options": "i"}},
        ]

    data = paginated_cursor(
        db.subscriptions,
        query,
        page=request.args.get("page", 1),
        limit=request.args.get("limit", 20),
    )

    for item in data.get("items", []):
        alert_level, alert_message, remaining, valid_until = subscription_admin_alert(item)
        item["alert_level"] = alert_level
        item["alert_message"] = alert_message
        item["days_left"] = remaining
        item["valid_until"] = valid_until
        item["renewal_due_soon"] = bool(
            remaining is not None
            and remaining <= renewal_window_days()
            and remaining > 0
        )

    return jsonify({"ok": True, **data})