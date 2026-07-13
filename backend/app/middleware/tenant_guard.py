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
    Allows SDS lifetime and active paid/demo tenants.
    Blocks suspended, expired, or missing companies.

    Billing and auth routes should not use this decorator because expired demo
    users still need to login and pay.
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
                meta=subscription,
            )

        if subscription.get("is_suspended"):
            return _json_error(
                "This company account is suspended. Please contact support.",
                code="tenant_suspended",
                status_code=403,
                meta=subscription,
            )

        if subscription.get("is_expired"):
            return _json_error(
                "Your demo/subscription has expired. Please upgrade to continue.",
                code="tenant_expired",
                status_code=402,
                meta=subscription,
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

    Demo tenants are allowed only for configured demo modules.
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
            return _json_error(
                result.get("message")
                or "This module is not available for your current plan.",
                code=reason,
                status_code=_status_code_for_reason(reason, 403),
                meta={
                    "module": result.get("module"),
                    "allowed_modules": result.get("allowed_modules", []),
                    "subscription": context.get("subscription") or {},
                },
            )

        return wrapper

    return decorator


def employee_creation_allowed_required(fn):
    """
    Decorator for employee creation APIs.

    Demo companies can create only up to DEMO_EMPLOYEE_LIMIT employees.
    SDS lifetime company has no employee limit.
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

        code = "employee_limit_reached"
        if "expired" in message.lower():
            code = "tenant_expired"
        elif "suspended" in message.lower():
            code = "tenant_suspended"
        elif "not found" in message.lower():
            code = "tenant_missing"

        return _json_error(
            message,
            code=code,
            status_code=_status_code_for_reason(code, 403),
            meta={
                "employee_count": result.get("employee_count"),
                "employee_limit": result.get("employee_limit"),
                "subscription": context.get("subscription") or {},
            },
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
