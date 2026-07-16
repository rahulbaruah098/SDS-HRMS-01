from datetime import datetime, timezone

from bson import ObjectId


DEFAULT_DEMO_MODULES = [
    "all",
]

MODULE_ALIASES = {
    "attendance": "attendance",
    "attendances": "attendance",
    "attendance_logs": "attendance",
    "checkin": "attendance",
    "check_in": "attendance",
    "checkout": "attendance",
    "check_out": "attendance",

    "leave": "apply_leave",
    "leaves": "apply_leave",
    "apply_leave": "apply_leave",
    "leave_apply": "apply_leave",
    "leave_requests": "apply_leave",
    "leave_balances": "apply_leave",
    "workflow_leave": "apply_leave",

    "project": "projects",
    "projects": "projects",
    "project_progress": "projects",
    "project_assignment": "projects",

    "billing": "billing",
    "subscription": "billing",
    "subscriptions": "billing",
    "payments": "billing",
    "payment": "billing",

    "profile": "profile",
    "dashboard": "dashboard",
    "auth": "auth",
    "notifications": "notifications",
}

ALWAYS_ALLOWED_MODULES = {
    "auth",
    "profile",
    "dashboard",
    "billing",
    "notifications",
}

SUPERADMIN_ALLOWED_STATUSES = {
    "active",
    "expired",
    "suspended",
    "pending",
}


class TenantAccessError(RuntimeError):
    def __init__(self, message, status_code=403, code="tenant_access_denied", meta=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.meta = meta or {}


def now_utc():
    return datetime.now(timezone.utc)


def safe_str(value):
    return str(value or "").strip()


def safe_lower(value):
    return safe_str(value).lower()


def truthy(value):
    return safe_lower(value) in {"1", "true", "yes", "y", "on"}


def to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def get_config_value(config, key, default=None):
    if not config:
        return default

    try:
        return config.get(key, default)
    except AttributeError:
        return getattr(config, key, default)


def parse_datetime(value):
    if not value:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None

        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            return None

    return None


def normalize_module_name(module_name):
    module = safe_lower(module_name).replace(" ", "_").replace("-", "_")
    return MODULE_ALIASES.get(module, module)


def normalize_module_list(value):
    if not value:
        return list(DEFAULT_DEMO_MODULES)

    if isinstance(value, str):
        raw_items = value.split(",")
    elif isinstance(value, (list, tuple, set)):
        raw_items = list(value)
    else:
        return list(DEFAULT_DEMO_MODULES)

    modules = []
    for item in raw_items:
        module = normalize_module_name(item)
        if module and module not in modules:
            modules.append(module)

    if "all" in modules:
        return ["all"]

    return modules or list(DEFAULT_DEMO_MODULES)


def user_roles(user):
    if not user:
        return []

    roles = user.get("roles") or []

    if isinstance(roles, str):
        roles = [role.strip() for role in roles.split(",") if role.strip()]

    if not isinstance(roles, list):
        roles = []

    role = safe_str(user.get("role"))
    if role and role not in roles:
        roles.append(role)

    return [safe_lower(role) for role in roles if safe_str(role)]


def is_platform_superadmin(user):
    roles = set(user_roles(user))
    return "super_admin" in roles or "superadmin" in roles


def default_tenant_id(config=None):
    return safe_str(get_config_value(config, "DEFAULT_TENANT_ID", "sds")) or "sds"


def sds_tenant_id(config=None):
    return safe_str(
        get_config_value(config, "SDS_TENANT_ID", default_tenant_id(config))
    ) or "sds"


def sds_tenant_code(config=None):
    return safe_str(get_config_value(config, "SDS_TENANT_CODE", "SDS")) or "SDS"


def build_sds_tenant_document(config=None):
    tenant_id = sds_tenant_id(config)
    created_at = now_utc()

    return {
        "tenant_id": tenant_id,
        "tenant_code": sds_tenant_code(config),
        "name": get_config_value(
            config,
            "SDS_COMPANY_NAME",
            "Sayanant Development Services Pvt. Ltd.",
        ),
        "company_name": get_config_value(
            config,
            "SDS_COMPANY_NAME",
            "Sayanant Development Services Pvt. Ltd.",
        ),
        "domain": get_config_value(config, "YOURCOMATE_DOMAIN", "yourcomate.com"),
        "status": "active",
        "plan": "Lifetime",
        "plan_type": "lifetime",
        "subscription_status": "lifetime",
        "trial_status": "not_required",
        "trial_start_date": None,
        "trial_end_date": None,
        "employee_limit": None,
        "allowed_modules": ["all"],
        "is_sds_company": True,
        "is_lifetime": True,
        "is_demo_company": False,
        "created_at": created_at,
        "updated_at": created_at,
        "is_deleted": False,
    }


def ensure_sds_tenant(db, config=None):
    tenant_id = sds_tenant_id(config)
    tenant = db.tenants.find_one({"tenant_id": tenant_id, "is_deleted": {"$ne": True}})

    sds_doc = build_sds_tenant_document(config)

    if tenant:
        db.tenants.update_one(
            {"_id": tenant["_id"]},
            {
                "$set": {
                    "tenant_code": sds_doc["tenant_code"],
                    "name": sds_doc["name"],
                    "company_name": sds_doc["company_name"],
                    "status": "active",
                    "plan": "Lifetime",
                    "plan_type": "lifetime",
                    "subscription_status": "lifetime",
                    "trial_status": "not_required",
                    "employee_limit": None,
                    "allowed_modules": ["all"],
                    "is_sds_company": True,
                    "is_lifetime": True,
                    "is_demo_company": False,
                    "updated_at": now_utc(),
                }
            },
        )
        tenant.update(sds_doc)
        return tenant

    db.tenants.insert_one(sds_doc)
    return sds_doc


def get_tenant_id_from_user(user, config=None):
    tenant_id = safe_str((user or {}).get("tenant_id"))
    return tenant_id or default_tenant_id(config)


def find_tenant(db, tenant_id, config=None, create_sds_if_missing=True):
    tenant_id = safe_str(tenant_id) or default_tenant_id(config)

    tenant = db.tenants.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    })

    if tenant:
        return tenant

    if create_sds_if_missing and tenant_id == sds_tenant_id(config):
        return ensure_sds_tenant(db, config)

    return None


def is_sds_tenant(tenant, config=None):
    if not tenant:
        return False

    tenant_id = safe_str(tenant.get("tenant_id"))
    tenant_code = safe_str(tenant.get("tenant_code")).upper()

    return (
        truthy(tenant.get("is_sds_company"))
        or tenant_id == sds_tenant_id(config)
        or tenant_code == sds_tenant_code(config).upper()
    )


def is_lifetime_tenant(tenant, config=None):
    if not tenant:
        return False

    return (
        is_sds_tenant(tenant, config)
        or truthy(tenant.get("is_lifetime"))
        or safe_lower(tenant.get("plan_type")) == "lifetime"
        or safe_lower(tenant.get("subscription_status")) == "lifetime"
    )


def is_paid_tenant(tenant):
    if not tenant:
        return False

    subscription_status = safe_lower(tenant.get("subscription_status"))
    plan_code = safe_lower(tenant.get("plan_code"))

    return (
        safe_lower(tenant.get("plan_type")) == "paid"
        or truthy(tenant.get("is_paid_company"))
        or subscription_status in {"paid", "active_paid"}
        or (
            plan_code in {"essential", "growth", "premium"}
            and not is_demo_tenant(tenant)
            and not is_lifetime_tenant(tenant)
        )
    )


def is_demo_tenant(tenant):
    if not tenant:
        return False

    return (
        truthy(tenant.get("is_demo_company"))
        or safe_lower(tenant.get("plan_type")) == "demo"
        or safe_lower(tenant.get("subscription_status")) == "demo"
    )


def is_tenant_suspended(tenant):
    return safe_lower((tenant or {}).get("status")) == "suspended"


def get_trial_end_date(tenant):
    return parse_datetime((tenant or {}).get("trial_end_date"))


def get_subscription_end_date(tenant):
    tenant = tenant or {}

    return parse_datetime(
        tenant.get("subscription_end_date")
        or tenant.get("next_payment_due_date")
        or tenant.get("premium_next_due_date")
        or tenant.get("payment_due_date")
        or tenant.get("ends_at")
        or tenant.get("next_due_date")
    )


def is_trial_expired(tenant):
    if not tenant or not is_demo_tenant(tenant):
        return False

    trial_end = get_trial_end_date(tenant)

    if not trial_end:
        return False

    return now_utc() > trial_end


def is_paid_subscription_expired(tenant):
    if not tenant or not is_paid_tenant(tenant):
        return False

    if (
        safe_lower(tenant.get("status")) == "expired"
        or safe_lower(tenant.get("subscription_status")) == "expired"
        or truthy(tenant.get("requires_payment"))
    ):
        return True

    subscription_end = get_subscription_end_date(tenant)

    if not subscription_end:
        return False

    return now_utc() >= subscription_end


def is_tenant_expired(tenant):
    if not tenant:
        return True

    if is_lifetime_tenant(tenant):
        return False

    if safe_lower(tenant.get("status")) == "expired":
        return True

    if is_demo_tenant(tenant):
        return is_trial_expired(tenant)

    if is_paid_tenant(tenant):
        return is_paid_subscription_expired(tenant)

    return False


def get_trial_days_left(tenant):
    trial_end = get_trial_end_date(tenant)

    if not trial_end:
        return None

    remaining = trial_end - now_utc()
    days_left = remaining.days

    if remaining.total_seconds() > 0 and days_left < 1:
        return 1

    return max(days_left, 0)


def get_subscription_days_left(tenant):
    subscription_end = get_subscription_end_date(tenant)

    if not subscription_end:
        return None

    remaining = subscription_end - now_utc()
    days_left = remaining.days

    if remaining.total_seconds() > 0 and days_left < 1:
        return 1

    return max(days_left, 0)


def get_employee_limit(tenant, config=None):
    """
    Employee limit rules:
    - SDS/lifetime: unlimited
    - Active demo trial: configured DEMO_EMPLOYEE_LIMIT; 0/blank means unlimited during trial
    - Paid plans: tenant.employee_limit from selected pricing plan
    - Premium/custom: None means unlimited
    """

    if not tenant:
        limit = to_int(get_config_value(config, "DEMO_EMPLOYEE_LIMIT", 0), 0)
        return limit if limit > 0 else None

    if is_lifetime_tenant(tenant, config):
        return None

    value = tenant.get("employee_limit")

    if value in [None, "", "unlimited", "Unlimited"]:
        if is_demo_tenant(tenant):
            limit = to_int(get_config_value(config, "DEMO_EMPLOYEE_LIMIT", 0), 0)
            return limit if limit > 0 else None
        return None

    limit = to_int(value, 0)
    return limit if limit > 0 else None


def count_active_employees(db, tenant_id):
    tenant_id = safe_str(tenant_id)

    if not tenant_id:
        return 0

    return db.employees.count_documents({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Deleted"},
    })


def can_create_employee(db, tenant, config=None):
    if not tenant:
        return {
            "allowed": False,
            "message": "Company account not found.",
            "employee_count": 0,
            "employee_limit": None,
        }

    if is_lifetime_tenant(tenant, config):
        return {
            "allowed": True,
            "message": "Employee creation allowed.",
            "employee_count": count_active_employees(db, tenant.get("tenant_id")),
            "employee_limit": None,
        }

    if is_tenant_suspended(tenant):
        return {
            "allowed": False,
            "message": "This company account is suspended.",
            "employee_count": count_active_employees(db, tenant.get("tenant_id")),
            "employee_limit": get_employee_limit(tenant, config),
        }

    if is_tenant_expired(tenant):
        return {
            "allowed": False,
            "message": "Your demo/subscription has expired. Please upgrade to continue.",
            "employee_count": count_active_employees(db, tenant.get("tenant_id")),
            "employee_limit": get_employee_limit(tenant, config),
        }

    employee_limit = get_employee_limit(tenant, config)
    employee_count = count_active_employees(db, tenant.get("tenant_id"))

    if employee_limit is not None and employee_count >= employee_limit:
        plan_name = safe_str(tenant.get("selected_plan_name") or tenant.get("plan") or "current plan")
        return {
            "allowed": False,
            "message": f"Your {plan_name} plan allows only {employee_limit} employees. Please upgrade to continue.",
            "employee_count": employee_count,
            "employee_limit": employee_limit,
        }

    return {
        "allowed": True,
        "message": "Employee creation allowed.",
        "employee_count": employee_count,
        "employee_limit": employee_limit,
    }


def can_access_module(tenant, module_name, user=None, config=None):
    module = normalize_module_name(module_name)

    if is_platform_superadmin(user):
        return {
            "allowed": True,
            "module": module,
            "reason": "platform_superadmin",
        }

    if module in ALWAYS_ALLOWED_MODULES:
        return {
            "allowed": True,
            "module": module,
            "reason": "always_allowed",
        }

    if not tenant:
        return {
            "allowed": False,
            "module": module,
            "reason": "tenant_missing",
            "message": "Company account not found.",
        }

    if is_lifetime_tenant(tenant, config):
        return {
            "allowed": True,
            "module": module,
            "reason": "lifetime_access",
        }

    if is_tenant_suspended(tenant):
        return {
            "allowed": False,
            "module": module,
            "reason": "tenant_suspended",
            "message": "This company account is suspended. Please contact support.",
        }

    if is_tenant_expired(tenant):
        return {
            "allowed": False,
            "module": module,
            "reason": "tenant_expired",
            "message": "Your demo/subscription has expired. Please upgrade to continue.",
        }

    if is_paid_tenant(tenant):
        return {
            "allowed": True,
            "module": module,
            "reason": "paid_access",
        }

    # New SaaS rule:
    # demo companies get full HRMS access during the 15-day trial.
    # After expiry, the earlier tenant_expired block stops access.
    if is_demo_tenant(tenant) and truthy(get_config_value(config, "DEMO_HAS_FULL_ACCESS", True)):
        return {
            "allowed": True,
            "module": module,
            "reason": "active_demo_full_trial_access",
        }

    allowed_modules = normalize_module_list(tenant.get("allowed_modules"))

    if "all" in allowed_modules or module in allowed_modules:
        return {
            "allowed": True,
            "module": module,
            "reason": "module_allowed",
        }

    return {
        "allowed": False,
        "module": module,
        "reason": "module_not_in_demo_plan",
        "message": "This module is not available in your demo plan. Please upgrade to unlock full HRMS access.",
        "allowed_modules": allowed_modules,
    }


def ensure_module_access(db, tenant_id, module_name, user=None, config=None):
    tenant = find_tenant(db, tenant_id, config=config)
    result = can_access_module(tenant, module_name, user=user, config=config)

    if result.get("allowed"):
        return tenant

    raise TenantAccessError(
        result.get("message") or "This module is not available for your current plan.",
        status_code=403,
        code=result.get("reason") or "tenant_access_denied",
        meta={
            "module": result.get("module"),
            "allowed_modules": result.get("allowed_modules", []),
            "tenant_id": tenant_id,
        },
    )


def refresh_tenant_status_if_needed(db, tenant, config=None):
    if not tenant:
        return tenant

    current_time = now_utc()

    if is_lifetime_tenant(tenant, config):
        update_doc = {}

        if safe_lower(tenant.get("status")) != "active":
            update_doc["status"] = "active"

        if truthy(tenant.get("requires_payment")):
            update_doc["requires_payment"] = False

        if update_doc:
            update_doc["updated_at"] = current_time
            db.tenants.update_one(
                {"_id": tenant["_id"]},
                {"$set": update_doc},
            )
            tenant.update(update_doc)

        return tenant

    if is_tenant_suspended(tenant):
        return tenant

    paid_tenant = is_paid_tenant(tenant)
    demo_tenant = is_demo_tenant(tenant)
    expired = is_tenant_expired(tenant)

    if expired:
        update_doc = {
            "status": "expired",
            "requires_payment": True,
            "updated_at": current_time,
        }

        if paid_tenant:
            update_doc.update({
                "subscription_status": "expired",
                "subscription_expired_at": (
                    tenant.get("subscription_expired_at") or current_time
                ),
            })

        if demo_tenant:
            update_doc.update({
                "trial_status": "expired",
                "trial_expired_at": tenant.get("trial_expired_at") or current_time,
            })

        needs_update = any(
            tenant.get(key) != value
            for key, value in update_doc.items()
            if key != "updated_at"
        )

        if needs_update:
            db.tenants.update_one(
                {"_id": tenant["_id"]},
                {"$set": update_doc},
            )

            if paid_tenant:
                db.subscriptions.update_many(
                    {
                        "tenant_id": tenant.get("tenant_id"),
                        "status": {"$in": ["active", "paid", "active_paid"]},
                        "is_deleted": {"$ne": True},
                    },
                    {
                        "$set": {
                            "status": "expired",
                            "subscription_status": "expired",
                            "requires_payment": True,
                            "expired_at": current_time,
                            "updated_at": current_time,
                        }
                    },
                )

            tenant.update(update_doc)

        return tenant

    update_doc = {}

    if safe_lower(tenant.get("status")) == "expired":
        update_doc["status"] = "active"

    if truthy(tenant.get("requires_payment")):
        update_doc["requires_payment"] = False

    if paid_tenant and safe_lower(tenant.get("subscription_status")) == "expired":
        update_doc["subscription_status"] = "active"

    if demo_tenant and safe_lower(tenant.get("trial_status")) == "expired":
        update_doc["trial_status"] = "active"

    if update_doc:
        update_doc["updated_at"] = current_time
        db.tenants.update_one(
            {"_id": tenant["_id"]},
            {"$set": update_doc},
        )
        tenant.update(update_doc)

    return tenant


def get_active_subscription(db, tenant_id):
    tenant_id = safe_str(tenant_id)

    if not tenant_id:
        return None

    return db.subscriptions.find_one(
        {
            "tenant_id": tenant_id,
            "status": {"$in": ["active", "paid", "lifetime"]},
            "is_deleted": {"$ne": True},
        },
        sort=[("created_at", -1)],
    )


def build_subscription_summary(db, tenant, config=None):
    if not tenant:
        return {
            "plan_type": "unknown",
            "status": "missing",
            "message": "Company account not found.",
        }

    tenant = refresh_tenant_status_if_needed(db, tenant, config=config)
    tenant_id = tenant.get("tenant_id")
    employee_limit = get_employee_limit(tenant, config)
    employee_count = count_active_employees(db, tenant_id)
    trial_days_left = get_trial_days_left(tenant)
    subscription_days_left = get_subscription_days_left(tenant)
    expired = is_tenant_expired(tenant)
    lifetime = is_lifetime_tenant(tenant, config)
    paid = is_paid_tenant(tenant)
    demo = is_demo_tenant(tenant)

    selected_plan_name = (
        tenant.get("selected_plan_name")
        or tenant.get("plan_name")
        or tenant.get("plan")
    )

    if lifetime:
        plan_label = "Lifetime Full Access"
    elif paid:
        plan_label = safe_str(
            tenant.get("plan_label")
            or selected_plan_name
            or "Paid Full HRMS"
        )
    elif demo:
        demo_days = to_int(get_config_value(config, "DEMO_DURATION_DAYS", 15), 15)
        if truthy(get_config_value(config, "DEMO_HAS_FULL_ACCESS", True)):
            plan_label = f"{demo_days}-Day Full Access Trial"
        else:
            plan_label = f"{demo_days}-Day Demo"
    else:
        plan_label = safe_str(tenant.get("plan") or tenant.get("plan_type") or "Unknown")

    subscription_end_date = get_subscription_end_date(tenant)

    return {
        "tenant_id": tenant_id,
        "tenant_code": tenant.get("tenant_code"),
        "company_name": tenant.get("company_name") or tenant.get("name"),
        "status": tenant.get("status"),
        "plan": tenant.get("plan"),
        "plan_type": tenant.get("plan_type"),
        "plan_label": plan_label,
        "subscription_status": tenant.get("subscription_status"),
        "trial_status": tenant.get("trial_status"),
        "trial_start_date": tenant.get("trial_start_date"),
        "trial_end_date": tenant.get("trial_end_date"),
        "trial_days_left": trial_days_left,
        "subscription_start_date": (
            tenant.get("subscription_start_date")
            or tenant.get("started_at")
        ),
        "subscription_end_date": subscription_end_date,
        "next_payment_due_date": (
            tenant.get("next_payment_due_date")
            or tenant.get("premium_next_due_date")
            or tenant.get("payment_due_date")
            or subscription_end_date
        ),
        "subscription_days_left": subscription_days_left,
        "employee_count": employee_count,
        "employee_limit": employee_limit,
        "is_unlimited_employees": employee_limit is None,
        "allowed_modules": tenant.get("allowed_modules") or [],
        "plan_code": tenant.get("plan_code"),
        "selected_plan_code": tenant.get("selected_plan_code") or tenant.get("plan_code"),
        "selected_plan_name": selected_plan_name,
        "billing_interval": (
            tenant.get("billing_interval")
            or tenant.get("premium_billing_interval")
        ),
        "renewal_amount": (
            tenant.get("premium_renewal_amount")
            if safe_lower(tenant.get("plan_code")) == "premium"
            else tenant.get("renewal_amount")
        ) or tenant.get("renewal_amount"),
        "renewal_currency": (
            tenant.get("premium_quoted_currency")
            or tenant.get("currency")
            or "INR"
        ),
        "renewal_price_source": tenant.get("renewal_price_source"),
        "payment_source": tenant.get("payment_source"),
        "premium_request_id": tenant.get("premium_request_id"),
        "pending_premium_request_id": tenant.get("pending_premium_request_id"),
        "premium_quote_status": tenant.get("premium_quote_status"),
        "premium_payment_status": tenant.get("premium_payment_status"),
        "last_payment_id": tenant.get("last_payment_id"),
        "last_subscription_id": tenant.get("last_subscription_id"),
        "is_sds_company": is_sds_tenant(tenant, config),
        "is_lifetime": lifetime,
        "is_demo_company": demo,
        "is_paid_company": paid,
        "is_expired": expired,
        "is_suspended": is_tenant_suspended(tenant),
        "demo_has_full_access": truthy(get_config_value(config, "DEMO_HAS_FULL_ACCESS", True)),
        "requires_payment": (
            not lifetime
            and expired
        ),
    }


def build_tenant_context(db, user=None, tenant_id=None, config=None):
    resolved_tenant_id = safe_str(tenant_id) or get_tenant_id_from_user(user, config)
    tenant = find_tenant(db, resolved_tenant_id, config=config)

    if tenant:
        tenant = refresh_tenant_status_if_needed(db, tenant, config=config)

    summary = build_subscription_summary(db, tenant, config=config) if tenant else {
        "tenant_id": resolved_tenant_id,
        "status": "missing",
        "is_expired": True,
        "is_suspended": False,
        "allowed_modules": [],
    }

    return {
        "tenant_id": resolved_tenant_id,
        "tenant": tenant,
        "subscription": summary,
        "is_platform_superadmin": is_platform_superadmin(user),
    }


def tenant_access_error_response(error):
    payload = {
        "ok": False,
        "message": getattr(error, "message", str(error)),
        "code": getattr(error, "code", "tenant_access_denied"),
    }

    meta = getattr(error, "meta", None)
    if meta:
        payload["meta"] = meta

    return payload, getattr(error, "status_code", 403)


def serialize_tenant_for_admin(db, tenant, config=None):
    if not tenant:
        return None

    summary = build_subscription_summary(db, tenant, config=config)

    return {
        "id": str(tenant.get("_id")) if tenant.get("_id") else "",
        "tenant_id": tenant.get("tenant_id"),
        "tenant_code": tenant.get("tenant_code"),
        "company_name": tenant.get("company_name") or tenant.get("name"),
        "contact_email": tenant.get("contact_email"),
        "contact_phone": tenant.get("contact_phone"),
        "status": summary.get("status"),
        "plan_type": summary.get("plan_type"),
        "plan_label": summary.get("plan_label"),
        "subscription_status": summary.get("subscription_status"),
        "trial_start_date": summary.get("trial_start_date"),
        "trial_end_date": summary.get("trial_end_date"),
        "trial_days_left": summary.get("trial_days_left"),
        "employee_count": summary.get("employee_count"),
        "employee_limit": summary.get("employee_limit"),
        "is_unlimited_employees": summary.get("is_unlimited_employees"),
        "allowed_modules": summary.get("allowed_modules"),
        "plan_code": summary.get("plan_code"),
        "selected_plan_code": summary.get("selected_plan_code"),
        "selected_plan_name": summary.get("selected_plan_name"),
        "billing_interval": summary.get("billing_interval"),
        "demo_has_full_access": summary.get("demo_has_full_access"),
        "requires_payment": summary.get("requires_payment"),
        "is_sds_company": summary.get("is_sds_company"),
        "is_lifetime": summary.get("is_lifetime"),
        "is_demo_company": summary.get("is_demo_company"),
        "is_paid_company": summary.get("is_paid_company"),
        "is_expired": summary.get("is_expired"),
        "is_suspended": summary.get("is_suspended"),
        "created_at": tenant.get("created_at"),
        "updated_at": tenant.get("updated_at"),
    }


def object_id_from_text(value):
    text = safe_str(value)
    if not text:
        return None

    try:
        if ObjectId.is_valid(text):
            return ObjectId(text)
    except Exception:
        return None

    return None