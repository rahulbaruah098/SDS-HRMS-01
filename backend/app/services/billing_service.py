from datetime import datetime, timedelta, timezone

from bson import ObjectId
from flask import current_app

from app.services.email_service import send_payment_success_email
from app.services.razorpay_service import (
    RazorpayServiceError,
    build_payment_record,
    create_razorpay_order,
    fetch_payment,
    get_public_checkout_config,
    safe_float,
    verify_payment_signature,
)
from app.services.pricing_service import (
    PricingServiceError,
    build_public_pricing_payload,
    ensure_default_pricing_plans,
    find_pricing_plan,
    get_default_paid_plan,
    normalize_plan_for_subscription,
)
from app.services.tenant_service import (
    build_subscription_summary,
    find_tenant,
    is_lifetime_tenant,
    is_paid_tenant,
    is_sds_tenant,
    refresh_tenant_status_if_needed,
)


class BillingServiceError(RuntimeError):
    def __init__(self, message, status_code=400, code="billing_error", details=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details or {}


def now_utc():
    return datetime.now(timezone.utc)


def safe_str(value):
    return str(value or "").strip()


def as_object_id(value):
    try:
        text = safe_str(value)
        if text and ObjectId.is_valid(text):
            return ObjectId(text)
    except Exception:
        return None

    return None


def get_config_value(key, default=None):
    try:
        return current_app.config.get(key, default)
    except RuntimeError:
        return default


def parse_datetime(value):
    if not value:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            return None

    return None


def add_subscription_interval(start_date, interval="monthly"):
    """
    Keeps subscription duration simple and configurable.

    monthly  = 30 days
    quarterly = 90 days
    yearly = 365 days
    lifetime = no end date
    """

    start_date = parse_datetime(start_date) or now_utc()
    interval = safe_str(interval).lower() or "monthly"

    if interval in {"lifetime", "forever"}:
        return None

    if interval in {"yearly", "annual", "annually"}:
        return start_date + timedelta(days=365)

    if interval in {"quarterly", "quarter"}:
        return start_date + timedelta(days=90)

    if interval in {"half_yearly", "half-yearly", "semiannual", "semi_annually"}:
        return start_date + timedelta(days=180)

    return start_date + timedelta(days=30)


def find_company_for_billing(db, tenant_id):
    tenant_id = safe_str(tenant_id)

    if not tenant_id:
        raise BillingServiceError("Company account is required for billing.", 400, "company_required")

    tenant = find_tenant(db, tenant_id, config=current_app.config)

    if not tenant:
        object_id = as_object_id(tenant_id)
        if object_id:
            tenant = db.tenants.find_one({"_id": object_id, "is_deleted": {"$ne": True}})

    if not tenant:
        raise BillingServiceError("Company account not found.", 404, "company_not_found")

    tenant = refresh_tenant_status_if_needed(db, tenant, config=current_app.config)
    return tenant


def get_company_contact_email(company):
    return safe_str(
        company.get("company_email")
        or company.get("contact_email")
        or company.get("email")
    )


def get_company_name(company):
    return safe_str(company.get("company_name") or company.get("name")) or "Company"


def ensure_company_can_pay(company):
    if not company:
        raise BillingServiceError("Company account not found.", 404, "company_not_found")

    if is_sds_tenant(company, current_app.config) or is_lifetime_tenant(company, current_app.config):
        raise BillingServiceError(
            "This company already has lifetime full access and does not require payment.",
            409,
            "lifetime_company_no_payment_required",
        )

    if safe_str(company.get("status")).lower() == "suspended":
        raise BillingServiceError(
            "This company is suspended. Please contact platform support.",
            403,
            "company_suspended",
        )

    return True


def resolve_selected_pricing_plan(db, plan_code=None):
    """
    Resolve the selected paid plan.

    Rules:
    - If frontend sends plan_code, use that plan.
    - Otherwise use configured/default recommended plan, normally Growth.
    - Custom Premium plans cannot be paid online unless Superadmin enables online payment.
    """

    ensure_default_pricing_plans(db)

    selected_code = safe_str(plan_code or get_config_value("SAAS_DEFAULT_PAID_PLAN_CODE", "growth"))
    plan = find_pricing_plan(db, selected_code) if selected_code else None

    if not plan:
        plan = get_default_paid_plan(db)

    if not plan:
        raise BillingServiceError(
            "No active pricing plan is available for payment.",
            400,
            "pricing_plan_not_available",
        )

    try:
        normalized = normalize_plan_for_subscription(plan)
    except PricingServiceError as exc:
        raise BillingServiceError(exc.message, exc.status_code, exc.code, exc.details) from exc

    return plan, normalized


def create_subscription_order(db, tenant_id, requested_by=None, amount=None, plan_code=None):
    """
    Creates a Razorpay order for a selected dynamic pricing plan and stores
    a local payment order record. Frontend will use the returned checkout
    object to open Razorpay Checkout.
    """

    company = find_company_for_billing(db, tenant_id)
    ensure_company_can_pay(company)

    plan, subscription_plan = resolve_selected_pricing_plan(db, plan_code=plan_code)

    # Amount override is kept only for Superadmin/internal flexibility.
    # Normal frontend payments should use the dynamic pricing plan amount.
    plan_amount = safe_float(amount if amount is not None else subscription_plan.get("amount"), 0.0)

    if plan_amount <= 0:
        raise BillingServiceError(
            "Selected plan cannot be paid online. Please contact Superadmin for custom pricing.",
            400,
            "custom_plan_requires_superadmin",
        )

    plan_name = safe_str(subscription_plan.get("plan_name") or plan.get("display_name")) or "Full HRMS"
    plan_code = safe_str(subscription_plan.get("plan_code") or plan.get("plan_code"))
    plan_interval = safe_str(subscription_plan.get("billing_interval") or "monthly") or "monthly"
    employee_limit = subscription_plan.get("employee_limit")
    is_unlimited_employees = bool(subscription_plan.get("is_unlimited_employees"))

    order_data = create_razorpay_order(
        company,
        amount=plan_amount,
        notes={
            "requested_by": safe_str(requested_by),
            "tenant_id": safe_str(company.get("tenant_id")),
            "plan_code": plan_code,
            "plan_name": plan_name,
            "plan_interval": plan_interval,
            "employee_limit": "unlimited" if is_unlimited_employees else str(employee_limit or ""),
        },
    )

    razorpay_order = order_data.get("razorpay_order") or {}
    checkout = order_data.get("checkout") or {}
    checkout.update({
        "description": f"YourComate HRMS {plan_name} Subscription",
        "plan_code": plan_code,
        "plan_name": plan_name,
        "plan_label": subscription_plan.get("plan_label") or plan_name,
        "plan_interval": plan_interval,
        "employee_limit": employee_limit,
        "is_unlimited_employees": is_unlimited_employees,
        "plan_amount": plan_amount,
    })

    created_at = now_utc()

    order_doc = {
        "tenant_id": safe_str(company.get("tenant_id")),
        "company_name": get_company_name(company),
        "company_email": get_company_contact_email(company),
        "plan_code": plan_code,
        "plan_name": plan_name,
        "plan_label": subscription_plan.get("plan_label") or plan_name,
        "plan_type": "paid",
        "plan_interval": plan_interval,
        "billing_interval": plan_interval,
        "employee_limit": employee_limit,
        "is_unlimited_employees": is_unlimited_employees,
        "allowed_modules": ["all"],
        "amount": plan_amount,
        "amount_paise": int(checkout.get("amount") or 0),
        "currency": checkout.get("currency") or subscription_plan.get("currency") or get_config_value("RAZORPAY_CURRENCY", "INR"),
        "razorpay_order_id": razorpay_order.get("id"),
        "razorpay_order": razorpay_order,
        "pricing_plan_snapshot": plan,
        "status": "created",
        "requested_by": safe_str(requested_by),
        "created_at": created_at,
        "updated_at": created_at,
        "is_deleted": False,
    }

    result = db.payment_orders.insert_one(order_doc)
    order_doc["_id"] = result.inserted_id

    return {
        "order_id": str(result.inserted_id),
        "razorpay_order_id": order_doc["razorpay_order_id"],
        "plan": plan,
        "selected_plan": subscription_plan,
        "checkout": checkout,
        "billing": build_billing_summary(db, company),
    }


def find_payment_order(db, razorpay_order_id=None, order_id=None, tenant_id=None):
    query = {"is_deleted": {"$ne": True}}

    if razorpay_order_id:
        query["razorpay_order_id"] = safe_str(razorpay_order_id)

    if order_id:
        object_id = as_object_id(order_id)
        if object_id:
            query["_id"] = object_id
        else:
            query["order_id"] = safe_str(order_id)

    if tenant_id:
        query["tenant_id"] = safe_str(tenant_id)

    return db.payment_orders.find_one(query, sort=[("created_at", -1)])


def build_paid_subscription_document(company, payment_record, start_date=None):
    start_date = parse_datetime(start_date) or now_utc()
    plan_code = safe_str(payment_record.get("plan_code") or get_config_value("SAAS_DEFAULT_PAID_PLAN_CODE", "growth"))
    plan_name = payment_record.get("plan_name") or safe_str(get_config_value("SAAS_FULL_PLAN_NAME", "Growth"))
    plan_label = payment_record.get("plan_label") or plan_name
    plan_interval = payment_record.get("plan_interval") or payment_record.get("billing_interval") or safe_str(get_config_value("SAAS_FULL_PLAN_INTERVAL", "monthly"))
    end_date = add_subscription_interval(start_date, plan_interval)
    employee_limit = payment_record.get("employee_limit")
    is_unlimited_employees = bool(payment_record.get("is_unlimited_employees")) or employee_limit in [None, "", "unlimited", "Unlimited"]

    return {
        "tenant_id": safe_str(company.get("tenant_id")),
        "company_name": get_company_name(company),
        "company_email": get_company_contact_email(company),
        "plan_code": plan_code,
        "plan_name": plan_name,
        "plan_label": plan_label,
        "plan_type": "paid",
        "plan_interval": plan_interval,
        "billing_interval": plan_interval,
        "status": "active",
        "amount": safe_float(payment_record.get("amount"), 0.0),
        "currency": payment_record.get("currency") or safe_str(get_config_value("RAZORPAY_CURRENCY", "INR")),
        "employee_limit": None if is_unlimited_employees else employee_limit,
        "is_unlimited_employees": is_unlimited_employees,
        "allowed_modules": ["all"],
        "payment_id": safe_str(payment_record.get("_id")),
        "razorpay_order_id": payment_record.get("razorpay_order_id"),
        "razorpay_payment_id": payment_record.get("razorpay_payment_id"),
        "started_at": start_date,
        "ends_at": end_date,
        "created_at": start_date,
        "updated_at": start_date,
        "is_deleted": False,
    }


def activate_paid_subscription(db, company, payment_record):
    """
    Converts an approved/expired trial company into a paid full-access company.
    SDS/lifetime companies are intentionally not processed here.
    """

    if not company:
        raise BillingServiceError("Company account not found.", 404, "company_not_found")

    if is_lifetime_tenant(company, current_app.config):
        raise BillingServiceError(
            "Lifetime company does not need paid subscription activation.",
            409,
            "lifetime_company_no_payment_required",
        )

    started_at = now_utc()
    subscription_doc = build_paid_subscription_document(
        company,
        payment_record,
        start_date=started_at,
    )

    subscription_result = db.subscriptions.insert_one(subscription_doc)

    update_doc = {
        "$set": {
            "plan": subscription_doc.get("plan_label") or subscription_doc.get("plan_name"),
            "plan_code": subscription_doc.get("plan_code"),
            "plan_name": subscription_doc.get("plan_name"),
            "plan_label": subscription_doc.get("plan_label"),
            "selected_plan_code": subscription_doc.get("plan_code"),
            "selected_plan_name": subscription_doc.get("plan_name"),
            "plan_type": "paid",
            "status": "active",
            "subscription_status": "active",
            "trial_status": "converted",
            "subscription_start_date": subscription_doc["started_at"],
            "subscription_end_date": subscription_doc["ends_at"],
            "employee_limit": subscription_doc.get("employee_limit"),
            "is_unlimited_employees": subscription_doc.get("is_unlimited_employees"),
            "billing_interval": subscription_doc.get("billing_interval") or subscription_doc.get("plan_interval"),
            "allowed_modules": ["all"],
            "requires_payment": False,
            "is_demo_company": False,
            "is_paid_company": True,
            "last_payment_id": safe_str(payment_record.get("_id")),
            "last_subscription_id": str(subscription_result.inserted_id),
            "updated_at": now_utc(),
        }
    }

    db.tenants.update_one({"_id": company["_id"]}, update_doc)

    updated_company = db.tenants.find_one({"_id": company["_id"]})

    return {
        "subscription_id": str(subscription_result.inserted_id),
        "subscription": subscription_doc,
        "company": updated_company,
        "billing": build_billing_summary(db, updated_company),
    }


def verify_and_activate_payment(db, tenant_id, payload):
    """
    Verifies Razorpay checkout payload, stores payment record, and activates full HRMS.

    Expected payload:
    {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    }
    """

    payload = payload or {}
    company = find_company_for_billing(db, tenant_id)
    ensure_company_can_pay(company)

    razorpay_order_id = safe_str(payload.get("razorpay_order_id"))
    razorpay_payment_id = safe_str(payload.get("razorpay_payment_id"))
    razorpay_signature = safe_str(payload.get("razorpay_signature"))

    if not razorpay_order_id or not razorpay_payment_id or not razorpay_signature:
        raise BillingServiceError(
            "Razorpay payment verification details are missing.",
            400,
            "payment_verification_details_missing",
        )

    order_doc = find_payment_order(
        db,
        razorpay_order_id=razorpay_order_id,
        tenant_id=safe_str(company.get("tenant_id")),
    )

    if not order_doc:
        raise BillingServiceError("Payment order not found.", 404, "payment_order_not_found")

    if safe_str(order_doc.get("status")).lower() == "paid":
        raise BillingServiceError("This payment order is already completed.", 409, "payment_already_completed")

    if not verify_payment_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
        db.payment_orders.update_one(
            {"_id": order_doc["_id"]},
            {
                "$set": {
                    "status": "signature_failed",
                    "failure_reason": "Invalid Razorpay signature",
                    "updated_at": now_utc(),
                }
            },
        )
        raise BillingServiceError("Payment signature verification failed.", 400, "payment_signature_failed")

    payment_details = {}
    try:
        payment_details = fetch_payment(razorpay_payment_id)
    except RazorpayServiceError:
        # Signature verification already passed. Keep activation possible even if
        # the extra fetch fails temporarily. The webhook can later enrich details.
        payment_details = {"id": razorpay_payment_id, "status": "paid"}

    payment_record = build_payment_record(
        company,
        order_doc,
        {
            "razorpay_order_id": razorpay_order_id,
            "razorpay_payment_id": razorpay_payment_id,
            "razorpay_signature": razorpay_signature,
        },
        payment_details=payment_details,
    )
    payment_record["plan_code"] = order_doc.get("plan_code") or safe_str(get_config_value("SAAS_DEFAULT_PAID_PLAN_CODE", "growth"))
    payment_record["plan_name"] = order_doc.get("plan_name") or payment_record.get("plan_name")
    payment_record["plan_label"] = order_doc.get("plan_label") or payment_record.get("plan_name")
    payment_record["plan_interval"] = order_doc.get("plan_interval") or safe_str(get_config_value("SAAS_FULL_PLAN_INTERVAL", "monthly"))
    payment_record["billing_interval"] = order_doc.get("billing_interval") or payment_record["plan_interval"]
    payment_record["employee_limit"] = order_doc.get("employee_limit")
    payment_record["is_unlimited_employees"] = bool(order_doc.get("is_unlimited_employees"))

    payment_result = db.payments.insert_one(payment_record)
    payment_record["_id"] = payment_result.inserted_id

    db.payment_orders.update_one(
        {"_id": order_doc["_id"]},
        {
            "$set": {
                "status": "paid",
                "razorpay_payment_id": razorpay_payment_id,
                "payment_id": str(payment_result.inserted_id),
                "paid_at": now_utc(),
                "updated_at": now_utc(),
            }
        },
    )

    activation = activate_paid_subscription(db, company, payment_record)

    company_email = get_company_contact_email(company)
    company_name = get_company_name(company)
    plan_name = (
        payment_record.get("plan_name")
        or payment_record.get("plan_label")
        or order_doc.get("plan_name")
        or order_doc.get("plan_label")
        or "YourComate HRMS Subscription"
    )
    amount = payment_record.get("amount") or order_doc.get("amount") or 0
    currency = payment_record.get("currency") or order_doc.get("currency") or "INR"
    employee_limit = payment_record.get("employee_limit")

    if payment_record.get("is_unlimited_employees"):
        employee_limit = "Unlimited"

    try:
        send_payment_success_email(
            current_app.config,
            company_email,
            company_name,
            plan_name=plan_name,
            amount=amount,
            currency=currency,
            employee_limit=employee_limit,
        )
    except Exception:
        # Payment activation must not fail because email delivery failed.
        pass

    return {
        "payment_id": str(payment_result.inserted_id),
        "payment": payment_record,
        "subscription": activation.get("subscription"),
        "billing": activation.get("billing"),
        "message": "Payment verified successfully. Full HRMS access is now active.",
    }


def build_billing_summary(db, company):
    if not company:
        return {
            "status": "missing",
            "message": "Company account not found.",
        }

    ensure_default_pricing_plans(db)
    summary = build_subscription_summary(db, company, config=current_app.config)
    checkout_config = get_public_checkout_config()
    pricing_payload = build_public_pricing_payload(db)
    default_plan = get_default_paid_plan(db)

    requires_payment = not (
        is_sds_tenant(company, current_app.config)
        or is_lifetime_tenant(company, current_app.config)
        or is_paid_tenant(company)
    )

    if default_plan:
        checkout_config.update({
            "plan_code": default_plan.get("plan_code"),
            "plan_name": default_plan.get("plan_name"),
            "plan_amount": default_plan.get("amount"),
            "plan_interval": default_plan.get("billing_interval"),
            "employee_limit": default_plan.get("employee_limit"),
            "is_unlimited_employees": default_plan.get("is_unlimited_employees"),
        })

    summary.update({
        "requires_payment": requires_payment,
        "billing_page_path": safe_str(get_config_value("BILLING_PAGE_PATH", "/billing")) or "/billing",
        "checkout": checkout_config,
        "pricing": pricing_payload,
        "plans": pricing_payload.get("plans") or [],
        "trial": pricing_payload.get("trial") or {},
        "default_plan": default_plan,
    })

    return summary


def expire_due_demo_companies(db):
    """
    Utility for scheduled/manual checks.
    Marks demo companies expired when their trial end date has passed.
    """

    now = now_utc()
    query = {
        "plan_type": "demo",
        "is_deleted": {"$ne": True},
        "status": {"$ne": "suspended"},
        "trial_end_date": {"$lte": now},
    }

    update = {
        "$set": {
            "status": "expired",
            "trial_status": "expired",
            "subscription_status": "expired",
            "updated_at": now,
        }
    }

    result = db.tenants.update_many(query, update)

    return {
        "expired_count": getattr(result, "modified_count", 0),
        "checked_at": now,
    }