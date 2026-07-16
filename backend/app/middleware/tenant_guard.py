from functools import wraps

from flask import current_app, g, jsonify

from app.extensions import get_db
from app.services.tenant_service import (
    TenantAccessError,
    build_tenant_context,
    can_access_module,
    can_create_employee,
    get_tenant_id_from_user,
    is_platform_superadmin,
    tenant_access_error_response,
)
from app.utils.auth import current_user_required


SUBSCRIPTION_ERROR_STATUS_CODES = {
    "tenant_expired": 402,
    "trial_expired": 402,
    "subscription_expired": 402,
    "payment_required": 402,
    "tenant_suspended": 403,
    "tenant_missing": 403,
    "module_not_in_demo_plan": 403,
    "employee_limit_reached": 403,
}


def _status_code_for_reason(reason, default=403):
    return SUBSCRIPTION_ERROR_STATUS_CODES.get(str(reason or ""), default)


def _json_error(message, code="tenant_access_denied", status_code=403, meta=None):
    payload = {
        "ok": False,
        "message": message,
        "code": code,
    }

    if meta:
        payload["meta"] = meta

    return jsonify(payload), status_code


def _safe_lower(value):
    return str(value or "").strip().lower()


def _config_truthy(key, default=False):
    value = current_app.config.get(key, default)

    if isinstance(value, bool):
        return value

    return _safe_lower(value) in {"1", "true", "yes", "y", "on"}


def _contains_all_module(value):
    if value is None:
        return False

    if isinstance(value, str):
        parts = [
            item.strip().lower()
            for item in value.replace(";", ",").split(",")
            if item.strip()
        ]
    elif isinstance(value, (list, tuple, set)):
        parts = [str(item or "").strip().lower() for item in value]
    else:
        return False

    return "all" in parts or "*" in parts


def _is_trial_subscription(subscription=None, tenant=None):
    subscription = subscription or {}
    tenant = tenant or {}

    return (
        _safe_lower(subscription.get("plan_type")) == "demo"
        or _safe_lower(subscription.get("subscription_type")) == "demo"
        or _safe_lower(subscription.get("trial_status")) in {"active", "trial", "running"}
        or _safe_lower(tenant.get("plan_type")) == "demo"
        or _safe_lower(tenant.get("subscription_type")) == "demo"
        or _safe_lower(tenant.get("trial_status")) in {"active", "trial", "running"}
    )


def _is_blocked_subscription(subscription=None, tenant=None):
    subscription = subscription or {}
    tenant = tenant or {}

    status_values = {
        _safe_lower(subscription.get("status")),
        _safe_lower(subscription.get("subscription_status")),
        _safe_lower(subscription.get("trial_status")),
        _safe_lower(tenant.get("status")),
        _safe_lower(tenant.get("subscription_status")),
        _safe_lower(tenant.get("trial_status")),
    }

    if {"expired", "suspended", "blocked", "inactive"} & status_values:
        return True

    return bool(
        subscription.get("is_expired")
        or subscription.get("is_suspended")
        or tenant.get("is_expired")
        or tenant.get("is_suspended")
    )


def _trial_has_full_access(subscription=None, tenant=None):
    subscription = subscription or {}
    tenant = tenant or {}

    if not _is_trial_subscription(subscription, tenant):
        return False

    if _is_blocked_subscription(subscription, tenant):
        return False

    return bool(
        subscription.get("demo_has_full_access") is True
        or tenant.get("demo_has_full_access") is True
        or _contains_all_module(subscription.get("allowed_modules"))
        or _contains_all_module(tenant.get("allowed_modules"))
        or _config_truthy("DEMO_HAS_FULL_ACCESS", False)
        or _contains_all_module(current_app.config.get("DEMO_ALLOWED_MODULES"))
    )


def _subscription_restriction_code(subscription=None):
    subscription = subscription or {}

    if subscription.get("is_paid_company"):
        return "subscription_expired"

    if subscription.get("is_demo_company"):
        return "trial_expired"

    return "tenant_expired"


def _subscription_restriction_message(subscription=None):
    subscription = subscription or {}

    if subscription.get("is_paid_company"):
        plan_label = str(
            subscription.get("plan_label")
            or subscription.get("selected_plan_name")
            or subscription.get("plan_code")
            or "subscription"
        ).strip()

        return (
            f"Your {plan_label} subscription has expired. "
            "Please renew it from Billing to continue using YourComate HRMS."
        )

    if subscription.get("is_demo_company"):
        return (
            "Your 15-day trial has expired. "
            "Please select a plan from Billing to continue using YourComate HRMS."
        )

    return (
        "Your company subscription has expired. "
        "Please open Billing to restore access."
    )


def _restriction_meta(subscription=None, **extra):
    subscription = subscription or {}

    meta = {
        "redirect_to": "/billing",
        "requires_payment": bool(subscription.get("requires_payment")),
        "plan_code": (
            subscription.get("selected_plan_code")
            or subscription.get("plan_code")
        ),
        "plan_label": subscription.get("plan_label"),
        "billing_interval": subscription.get("billing_interval"),
        "renewal_amount": subscription.get("renewal_amount"),
        "renewal_currency": subscription.get("renewal_currency") or "INR",
        "subscription_end_date": subscription.get("subscription_end_date"),
        "next_payment_due_date": subscription.get("next_payment_due_date"),
        "premium_request_id": (
            subscription.get("premium_request_id")
            or subscription.get("pending_premium_request_id")
        ),
        "subscription": subscription,
    }

    meta.update({key: value for key, value in extra.items() if value is not None})
    return meta


def get_request_tenant_id(user=None):
    """
    Returns the tenant/company id for the current request.

    The current project already stores tenant_id in JWT and in g.tenant_id.
    This helper keeps SaaS checks consistent across all future route updates.
    """

    user = user or getattr(g, "current_user", None) or {}

    return (
        getattr(g, "tenant_id", None)
        or user.get("tenant_id")
        or get_tenant_id_from_user(user, current_app.config)
    )


def load_tenant_context(user=None, tenant_id=None, refresh=True):
    """
    Loads tenant/company subscription context and attaches it to flask.g.

    Attached values:
    - g.tenant_context
    - g.current_tenant
    - g.subscription
    - g.tenant_id
    """

    db = get_db()
    user = user or getattr(g, "current_user", None) or {}
    tenant_id = tenant_id or get_request_tenant_id(user)

    context = build_tenant_context(
        db,
        user=user,
        tenant_id=tenant_id,
        config=current_app.config,
    )

    g.tenant_context = context
    g.current_tenant = context.get("tenant")
    g.subscription = context.get("subscription") or {}
    g.tenant_id = context.get("tenant_id") or tenant_id

    return context


def get_loaded_tenant_context():
    context = getattr(g, "tenant_context", None)

    if context:
        return context

    return load_tenant_context()


def tenant_context_required(fn):
    """
    Decorator for routes that only need tenant context loaded, without blocking
    by module. Useful for dashboard/profile/billing routes.
    """

    @wraps(fn)
    @current_user_required
    def wrapper(*args, **kwargs):
        load_tenant_context()
        return fn(*args, **kwargs)

    return wrapper


def active_tenant_required(fn):
    """
    Allows platform Superadmin, SDS lifetime, active trial, and active paid
    tenants. Suspended, missing, expired-trial, and expired-paid tenants are
    blocked.

    Billing and authentication routes must not use this decorator because a
    blocked tenant must still be able to sign in, view its quotation, and pay.
    """

    @wraps(fn)
    @current_user_required
    def wrapper(*args, **kwargs):
        context = load_tenant_context()
        subscription = context.get("subscription") or {}

        if context.get("is_platform_superadmin"):
            return fn(*args, **kwargs)

        if subscription.get("status") == "missing":
            return _json_error(
                "Company account not found.",
                code="tenant_missing",
                status_code=403,
                meta={
                    "redirect_to": "/login",
                    "subscription": subscription,
                },
            )

        if subscription.get("is_suspended"):
            return _json_error(
                "This company account is suspended. Please contact support.",
                code="tenant_suspended",
                status_code=403,
                meta={
                    "redirect_to": "/billing",
                    "subscription": subscription,
                },
            )

        if subscription.get("is_expired") or subscription.get("requires_payment"):
            code = _subscription_restriction_code(subscription)
            return _json_error(
                _subscription_restriction_message(subscription),
                code=code,
                status_code=402,
                meta=_restriction_meta(subscription),
            )

        return fn(*args, **kwargs)

    return wrapper

def tenant_module_required(module_name):
    """
    Decorator used on module routes.

    Examples for later route updates:
    @tenant_module_required("attendance")
    @tenant_module_required("apply_leave")
    @tenant_module_required("projects")

    Active trial tenants are allowed full HRMS access when
    DEMO_HAS_FULL_ACCESS=true or allowed_modules contains "all".

    Expired/suspended trial tenants remain blocked.
    SDS lifetime tenant is always allowed.
    Platform superadmin is always allowed.
    """

    def decorator(fn):
        @wraps(fn)
        @current_user_required
        def wrapper(*args, **kwargs):
            context = load_tenant_context()
            user = getattr(g, "current_user", {}) or {}
            tenant = context.get("tenant")
            subscription = context.get("subscription") or {}

            if _trial_has_full_access(subscription, tenant):
                g.allowed_module = module_name
                g.tenant_access_reason = "active_full_access_trial"
                return fn(*args, **kwargs)

            result = can_access_module(
                tenant,
                module_name,
                user=user,
                config=current_app.config,
            )

            if result.get("allowed"):
                g.allowed_module = result.get("module")
                g.tenant_access_reason = result.get("reason")
                return fn(*args, **kwargs)

            reason = result.get("reason") or "tenant_access_denied"
            response_code = reason
            response_message = (
                result.get("message")
                or "This module is not available for your current subscription/trial status."
            )

            if reason == "tenant_expired":
                response_code = _subscription_restriction_code(subscription)
                response_message = _subscription_restriction_message(subscription)

            return _json_error(
                response_message,
                code=response_code,
                status_code=_status_code_for_reason(response_code, 403),
                meta=_restriction_meta(
                    subscription,
                    module=result.get("module"),
                    allowed_modules=result.get("allowed_modules", []),
                ),
            )

        return wrapper

    return decorator


def employee_creation_allowed_required(fn):
    """
    Decorator for employee creation APIs.

    Employee creation rule:
    - SDS lifetime company has no employee limit.
    - Active 15-day full-access trial has no limit when DEMO_EMPLOYEE_LIMIT=0.
    - Paid companies are limited by selected plan employee_limit.
    - Expired/suspended companies are blocked.
    """

    @wraps(fn)
    @current_user_required
    def wrapper(*args, **kwargs):
        db = get_db()
        context = load_tenant_context()
        tenant = context.get("tenant")
        user = getattr(g, "current_user", {}) or {}

        if is_platform_superadmin(user):
            return fn(*args, **kwargs)

        result = can_create_employee(
            db,
            tenant,
            config=current_app.config,
        )

        g.employee_limit_context = result

        if result.get("allowed"):
            return fn(*args, **kwargs)

        message = result.get("message") or "Employee creation is not allowed for your current plan."

        subscription = context.get("subscription") or {}
        code = "employee_limit_reached"

        if "expired" in message.lower() or subscription.get("requires_payment"):
            code = _subscription_restriction_code(subscription)
            message = _subscription_restriction_message(subscription)
        elif "suspended" in message.lower():
            code = "tenant_suspended"
        elif "not found" in message.lower():
            code = "tenant_missing"

        return _json_error(
            message,
            code=code,
            status_code=_status_code_for_reason(code, 403),
            meta=_restriction_meta(
                subscription,
                employee_count=result.get("employee_count"),
                employee_limit=result.get("employee_limit"),
            ),
        )

    return wrapper


def platform_superadmin_required(fn):
    """
    SaaS platform-level Superadmin guard.

    Use this for new pages/APIs like:
    - demo requests
    - all companies
    - payments/subscriptions monitoring
    """

    @wraps(fn)
    @current_user_required
    def wrapper(*args, **kwargs):
        user = getattr(g, "current_user", {}) or {}

        if is_platform_superadmin(user):
            load_tenant_context(user=user)
            return fn(*args, **kwargs)

        return _json_error(
            "Only Platform Superadmin can access this section.",
            code="platform_superadmin_required",
            status_code=403,
        )

    return wrapper


def handle_tenant_access_error(error):
    """
    Converts TenantAccessError into Flask JSON response.
    This helper is useful if a route calls ensure_module_access manually.
    """

    if not isinstance(error, TenantAccessError):
        return _json_error(str(error), status_code=403)

    payload, status_code = tenant_access_error_response(error)
    return jsonify(payload), status_code


def subscription_payload_for_current_user():
    """
    Returns the subscription summary already loaded on g.
    Useful for login/current-user responses later.
    """

    context = get_loaded_tenant_context()

    return context.get("subscription") or {}