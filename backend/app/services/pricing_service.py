"""
Dynamic SaaS pricing plan service for YourComate HRMS.

This service controls the subscription plans used by billing and Superadmin:

Default plans:
- Essential: ₹2,495, up to 50 employees
- Growth: ₹4,495, up to 100 employees
- Premium: custom / unlimited employees

Important rules:
- SDS lifetime tenant is handled separately and never requires payment.
- Demo companies get 15 days trial access through demo/subscription services.
- Paid companies receive employee limits based on the selected plan.
- Superadmin can later update these records dynamically from UI/API.
"""

from copy import deepcopy
from datetime import datetime, timezone

from bson import ObjectId


DEFAULT_PRICING_PLANS = [
    {
        "plan_code": "essential",
        "plan_name": "Essential",
        "display_name": "Essential",
        "description": "Starter HRMS subscription for small teams.",
        "amount": 2495.0,
        "currency": "INR",
        "billing_interval": "monthly",
        "employee_limit": 50,
        "included_employees": 50,
        "is_unlimited_employees": False,
        "is_custom_pricing": False,
        "allow_online_payment": True,
        "is_recommended": False,
        "sort_order": 10,
        "features": [
            "Full HRMS access",
            "Up to 50 employees",
            "Attendance, leave, projects and employee records",
            "Standard support",
        ],
    },
    {
        "plan_code": "growth",
        "plan_name": "Growth",
        "display_name": "Growth",
        "description": "Recommended HRMS subscription for growing companies.",
        "amount": 4495.0,
        "currency": "INR",
        "billing_interval": "monthly",
        "employee_limit": 100,
        "included_employees": 100,
        "is_unlimited_employees": False,
        "is_custom_pricing": False,
        "allow_online_payment": True,
        "is_recommended": True,
        "sort_order": 20,
        "features": [
            "Full HRMS access",
            "Up to 100 employees",
            "All operational HRMS modules",
            "Priority support",
        ],
    },
    {
        "plan_code": "premium",
        "plan_name": "Premium",
        "display_name": "Premium",
        "description": "Custom enterprise HRMS subscription with unlimited employees.",
        "amount": 0.0,
        "currency": "INR",
        "billing_interval": "monthly",
        "employee_limit": None,
        "included_employees": None,
        "is_unlimited_employees": True,
        "is_custom_pricing": True,
        "allow_online_payment": False,
        "is_recommended": False,
        "sort_order": 30,
        "features": [
            "Full HRMS access",
            "Unlimited employees",
            "All modules included",
            "Custom onboarding and support",
        ],
    },
]


class PricingServiceError(RuntimeError):
    def __init__(self, message, status_code=400, code="pricing_error", details=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details or {}


def now_utc():
    return datetime.now(timezone.utc)


def safe_str(value):
    return str(value or "").strip()


def safe_lower(value):
    return safe_str(value).lower()


def normalize_plan_code(value):
    return (
        safe_lower(value)
        .replace(" ", "_")
        .replace("-", "_")
    )


def safe_float(value, default=0.0):
    try:
        number = float(value)
        if number < 0:
            return default
        return number
    except (TypeError, ValueError):
        return default


def safe_int(value, default=None):
    if value is None or value == "":
        return default

    try:
        number = int(value)
        if number < 0:
            return default
        return number
    except (TypeError, ValueError):
        return default


def truthy(value):
    return safe_lower(value) in {"1", "true", "yes", "y", "on"}


def serialize_plan(plan):
    if not plan:
        return None

    item = dict(plan)

    if isinstance(item.get("_id"), ObjectId):
        item["_id"] = str(item["_id"])

    return item


def get_default_plan(plan_code):
    normalized = normalize_plan_code(plan_code)

    for plan in DEFAULT_PRICING_PLANS:
        if plan["plan_code"] == normalized:
            return deepcopy(plan)

    return None


def default_plan_codes():
    return [plan["plan_code"] for plan in DEFAULT_PRICING_PLANS]


def build_plan_document(data, created_by=None, existing=None):
    data = data or {}
    existing = existing or {}
    current_time = now_utc()

    plan_code = normalize_plan_code(
        data.get("plan_code")
        or existing.get("plan_code")
        or data.get("code")
        or data.get("name")
    )

    if not plan_code:
        raise PricingServiceError("Plan code is required.", 400, "plan_code_required")

    plan_name = safe_str(
        data.get("plan_name")
        or data.get("display_name")
        or existing.get("plan_name")
        or plan_code.replace("_", " ").title()
    )

    is_unlimited = bool(
        data.get("is_unlimited_employees")
        if "is_unlimited_employees" in data
        else existing.get("is_unlimited_employees", False)
    )

    employee_limit = None if is_unlimited else safe_int(
        data.get("employee_limit", existing.get("employee_limit")),
        default=0,
    )

    if not is_unlimited and not employee_limit:
        raise PricingServiceError(
            "Employee limit is required for non-premium plans.",
            400,
            "employee_limit_required",
        )

    included_employees = None if is_unlimited else safe_int(
        data.get("included_employees", existing.get("included_employees", employee_limit)),
        default=employee_limit,
    )

    amount = safe_float(data.get("amount", existing.get("amount", 0.0)), 0.0)
    is_custom_pricing = bool(
        data.get("is_custom_pricing")
        if "is_custom_pricing" in data
        else existing.get("is_custom_pricing", amount <= 0 and is_unlimited)
    )

    allow_online_payment = bool(
        data.get("allow_online_payment")
        if "allow_online_payment" in data
        else existing.get("allow_online_payment", not is_custom_pricing)
    )

    if allow_online_payment and amount <= 0:
        raise PricingServiceError(
            "Online payment plans must have an amount greater than 0.",
            400,
            "plan_amount_required",
        )

    document = {
        "plan_code": plan_code,
        "plan_name": plan_name,
        "display_name": safe_str(data.get("display_name") or existing.get("display_name") or plan_name),
        "description": safe_str(data.get("description") or existing.get("description")),
        "amount": amount,
        "currency": safe_str(data.get("currency") or existing.get("currency") or "INR").upper(),
        "billing_interval": safe_lower(data.get("billing_interval") or existing.get("billing_interval") or "monthly"),
        "employee_limit": employee_limit,
        "included_employees": included_employees,
        "is_unlimited_employees": is_unlimited,
        "is_custom_pricing": is_custom_pricing,
        "allow_online_payment": allow_online_payment,
        "is_recommended": bool(
            data.get("is_recommended")
            if "is_recommended" in data
            else existing.get("is_recommended", False)
        ),
        "is_active": bool(
            data.get("is_active")
            if "is_active" in data
            else existing.get("is_active", True)
        ),
        "sort_order": safe_int(data.get("sort_order", existing.get("sort_order", 100)), 100),
        "features": data.get("features") if isinstance(data.get("features"), list) else existing.get("features", []),
        "updated_by": safe_str(created_by),
        "updated_at": current_time,
        "is_deleted": False,
    }

    if not existing:
        document["created_by"] = safe_str(created_by)
        document["created_at"] = current_time

    return document


def ensure_default_pricing_plans(db, created_by="system"):
    """
    Creates missing default pricing plans.

    It does not overwrite Superadmin-customized plans.
    """

    created = []
    updated = []
    unchanged = []

    for default_plan in DEFAULT_PRICING_PLANS:
        plan_code = default_plan["plan_code"]
        existing = db.pricing_plans.find_one({
            "plan_code": plan_code,
            "is_deleted": {"$ne": True},
        })

        if existing:
            # Keep existing Superadmin values. Only backfill fields that may be missing.
            backfill = {}
            for key, value in default_plan.items():
                if key not in existing:
                    backfill[key] = value

            if "is_active" not in existing:
                backfill["is_active"] = True

            if backfill:
                backfill["updated_at"] = now_utc()
                backfill["updated_by"] = created_by
                db.pricing_plans.update_one(
                    {"_id": existing["_id"]},
                    {"$set": backfill},
                )
                updated.append(plan_code)
            else:
                unchanged.append(plan_code)

            continue

        document = build_plan_document(default_plan, created_by=created_by)
        db.pricing_plans.insert_one(document)
        created.append(plan_code)

    return {
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "total_defaults": len(DEFAULT_PRICING_PLANS),
    }


def list_pricing_plans(db, include_inactive=False, include_deleted=False):
    query = {}

    if not include_deleted:
        query["is_deleted"] = {"$ne": True}

    if not include_inactive:
        query["is_active"] = {"$ne": False}

    plans = list(
        db.pricing_plans
        .find(query)
        .sort([("sort_order", 1), ("amount", 1), ("plan_name", 1)])
    )

    return [serialize_plan(plan) for plan in plans]


def find_pricing_plan(db, plan_code, include_inactive=False):
    normalized = normalize_plan_code(plan_code)

    if not normalized:
        return None

    query = {
        "plan_code": normalized,
        "is_deleted": {"$ne": True},
    }

    if not include_inactive:
        query["is_active"] = {"$ne": False}

    plan = db.pricing_plans.find_one(query)

    if not plan:
        default = get_default_plan(normalized)
        if default:
            ensure_default_pricing_plans(db)
            plan = db.pricing_plans.find_one(query)

    return serialize_plan(plan) if plan else None


def get_default_paid_plan(db):
    """
    Returns Growth as the default paid plan because it is recommended.
    Falls back to the first active online-payment plan.
    """

    ensure_default_pricing_plans(db)

    recommended = db.pricing_plans.find_one({
        "is_recommended": True,
        "allow_online_payment": True,
        "is_active": {"$ne": False},
        "is_deleted": {"$ne": True},
    })

    if recommended:
        return serialize_plan(recommended)

    plan = db.pricing_plans.find_one(
        {
            "allow_online_payment": True,
            "is_active": {"$ne": False},
            "is_deleted": {"$ne": True},
        },
        sort=[("sort_order", 1), ("amount", 1)],
    )

    return serialize_plan(plan) if plan else None


def upsert_pricing_plan(db, data, updated_by=None):
    data = data or {}
    plan_code = normalize_plan_code(data.get("plan_code") or data.get("code"))

    if not plan_code:
        raise PricingServiceError("Plan code is required.", 400, "plan_code_required")

    existing = db.pricing_plans.find_one({
        "plan_code": plan_code,
        "is_deleted": {"$ne": True},
    })

    document = build_plan_document(
        {
            **data,
            "plan_code": plan_code,
        },
        created_by=updated_by,
        existing=existing,
    )

    if existing:
        db.pricing_plans.update_one(
            {"_id": existing["_id"]},
            {"$set": document},
        )
        plan_id = existing["_id"]
    else:
        result = db.pricing_plans.insert_one(document)
        plan_id = result.inserted_id

    return serialize_plan(db.pricing_plans.find_one({"_id": plan_id}))


def archive_pricing_plan(db, plan_code, updated_by=None):
    normalized = normalize_plan_code(plan_code)

    if normalized in {"essential", "growth", "premium"}:
        raise PricingServiceError(
            "Default pricing plans cannot be deleted. You can deactivate or edit them instead.",
            400,
            "default_plan_delete_blocked",
        )

    result = db.pricing_plans.update_one(
        {
            "plan_code": normalized,
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "is_deleted": True,
                "is_active": False,
                "deleted_at": now_utc(),
                "deleted_by": safe_str(updated_by),
                "updated_at": now_utc(),
                "updated_by": safe_str(updated_by),
            }
        },
    )

    return {
        "ok": result.modified_count > 0,
        "plan_code": normalized,
        "modified_count": result.modified_count,
    }


def normalize_plan_for_subscription(plan):
    """
    Converts a pricing plan into the fields stored on tenant/subscription/payment records.
    """

    if not plan:
        raise PricingServiceError("Subscription plan not found.", 404, "plan_not_found")

    if not plan.get("allow_online_payment") and plan.get("is_custom_pricing"):
        raise PricingServiceError(
            "This plan uses custom pricing. Superadmin must activate it manually.",
            400,
            "custom_plan_requires_superadmin",
        )

    return {
        "plan_code": plan.get("plan_code"),
        "plan_name": plan.get("plan_name") or plan.get("display_name"),
        "plan_label": plan.get("display_name") or plan.get("plan_name"),
        "plan_type": "paid",
        "billing_interval": plan.get("billing_interval") or "monthly",
        "amount": safe_float(plan.get("amount"), 0.0),
        "currency": plan.get("currency") or "INR",
        "employee_limit": None if plan.get("is_unlimited_employees") else safe_int(plan.get("employee_limit"), 0),
        "is_unlimited_employees": bool(plan.get("is_unlimited_employees")),
        "allowed_modules": ["all"],
    }


def build_public_pricing_payload(db):
    """
    Public-safe pricing payload for login page / billing page.
    """

    ensure_default_pricing_plans(db)
    plans = list_pricing_plans(db)

    return {
        "plans": [
            {
                "plan_code": plan.get("plan_code"),
                "plan_name": plan.get("plan_name"),
                "display_name": plan.get("display_name"),
                "description": plan.get("description"),
                "amount": plan.get("amount"),
                "currency": plan.get("currency"),
                "billing_interval": plan.get("billing_interval"),
                "employee_limit": plan.get("employee_limit"),
                "included_employees": plan.get("included_employees"),
                "is_unlimited_employees": plan.get("is_unlimited_employees"),
                "is_custom_pricing": plan.get("is_custom_pricing"),
                "allow_online_payment": plan.get("allow_online_payment"),
                "is_recommended": plan.get("is_recommended"),
                "features": plan.get("features") or [],
                "sort_order": plan.get("sort_order"),
            }
            for plan in plans
        ],
        "trial": {
            "days": 15,
            "access": "all_modules",
            "employee_limit": None,
            "message": "15 days free trial with all HRMS facilities.",
        },
    }