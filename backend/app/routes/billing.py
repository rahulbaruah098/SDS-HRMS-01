from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request

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

    normalized = {
        str(role or "").strip().lower().replace("-", "_").replace(" ", "_")
        for role in roles
    }

    return "super_admin" in normalized


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
            "subscription_start_date": company.get("subscription_start_date"),
            "subscription_end_date": company.get("subscription_end_date"),
            "trial_days_left": summary.get("trial_days_left"),
            "days_left": summary.get("trial_days_left"),
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

            # Legacy flat checkout fields.
            "plan_amount": checkout.get("plan_amount"),
            "amount": checkout.get("plan_amount"),
            "currency": checkout.get("currency"),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.post("/create-order")
@current_user_required
def create_order():
    """
    Creates a Razorpay order for a selected dynamic paid plan.

    Expected body:
    {
      "plan_code": "essential" | "growth" | "premium",
      "amount": optional internal override
    }

    SDS lifetime tenants are rejected by the billing service.
    Premium is blocked for online payment unless Superadmin enables online
    payment and sets an amount for it.
    """

    db = get_db()
    data = request_json()
    tenant_id = requested_tenant_id(default_to_current=True)
    amount = data.get("amount")
    plan_code = data.get("plan_code") or data.get("selected_plan_code")

    try:
        order = create_subscription_order(
            db,
            tenant_id=tenant_id,
            requested_by=current_user_id(),
            amount=amount,
            plan_code=plan_code,
        )

        audit(
            "billing.order_created",
            "payment_orders",
            order.get("order_id"),
            {
                "tenant_id": tenant_id,
                "razorpay_order_id": order.get("razorpay_order_id"),
                "plan_code": plan_code,
            },
        )

        checkout = order.get("checkout") or {}
        selected_plan = order.get("selected_plan") or {}
        plan = order.get("plan") or {}

        return jsonify({
            "ok": True,
            "message": "Payment order created successfully.",

            # Local order fields.
            "local_order_id": order.get("order_id"),
            "order_id": order.get("order_id"),

            # Selected dynamic plan.
            "plan": clean_doc(plan),
            "selected_plan": clean_doc(selected_plan),
            "plan_code": checkout.get("plan_code") or selected_plan.get("plan_code"),
            "plan_name": checkout.get("plan_name") or selected_plan.get("plan_name"),
            "plan_label": checkout.get("plan_label") or selected_plan.get("plan_label"),
            "employee_limit": checkout.get("employee_limit"),
            "is_unlimited_employees": checkout.get("is_unlimited_employees"),
            "billing_interval": checkout.get("plan_interval") or selected_plan.get("billing_interval"),

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
            }),

            # Full service response remains available for debugging/admin usage.
            "raw_order": clean_doc(order),
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

    return jsonify({"ok": True, **data})