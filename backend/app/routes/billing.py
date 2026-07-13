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

    if isinstance(error, RazorpayServiceError):
        return jsonify({
            "message": error.message,
            "code": error.code,
            "details": clean_doc(error.details),
        }), error.status_code

    return jsonify({
        "message": "Billing request failed.",
        "code": "billing_request_failed",
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

        return jsonify({
            "ok": True,
            "company": clean_doc(company),
            "billing": clean_doc(summary),
        })
    except Exception as exc:
        return error_response(exc)


@billing_bp.post("/create-order")
@current_user_required
def create_order():
    """
    Creates a Razorpay order for upgrading a demo/expired company.
    SDS lifetime tenant will be rejected by the billing service.
    """

    db = get_db()
    data = request_json()
    tenant_id = requested_tenant_id(default_to_current=True)
    amount = data.get("amount")

    try:
        order = create_subscription_order(
            db,
            tenant_id=tenant_id,
            requested_by=current_user_id(),
            amount=amount,
        )

        audit(
            "billing.order_created",
            "payment_orders",
            order.get("order_id"),
            {
                "tenant_id": tenant_id,
                "razorpay_order_id": order.get("razorpay_order_id"),
            },
        )

        return jsonify({
            "ok": True,
            "message": "Payment order created successfully.",
            "order": clean_doc(order),
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

        return jsonify({
            "ok": True,
            **clean_doc(result),
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
            {"plan_name": {"$regex": search, "$options": "i"}},
        ]

    data = paginated_cursor(
        db.subscriptions,
        query,
        page=request.args.get("page", 1),
        limit=request.args.get("limit", 20),
    )

    return jsonify({"ok": True, **data})
