"""
Seed dynamic SaaS pricing plans for YourComate HRMS.

Usage from backend folder:

    python scripts/seed_pricing_plans.py

Dry run:

    python scripts/seed_pricing_plans.py --dry-run

Force update existing plans from .env/config defaults:

    python scripts/seed_pricing_plans.py --force

What this script creates:
- Essential: configured amount, default ₹2,495/month, 50 employees
- Growth: configured amount, default ₹4,495/month, 100 employees
- Premium: custom/unlimited employees

Important:
- By default, this script creates missing plans only.
- It does not overwrite Superadmin-edited pricing unless you pass --force.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def now_utc():
    return datetime.now(timezone.utc)


def safe_str(value):
    return str(value or "").strip()


def to_float(value, default=0.0):
    try:
        number = float(value)
        if number < 0:
            return default
        return number
    except (TypeError, ValueError):
        return default


def to_int(value, default=0):
    try:
        number = int(value)
        if number < 0:
            return default
        return number
    except (TypeError, ValueError):
        return default


def truthy(value):
    return safe_str(value).lower() in {"1", "true", "yes", "y", "on"}


def config_value(app, key, default=None):
    try:
        return app.config.get(key, default)
    except Exception:
        return default


def serialize(value):
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


def resolve_db(app):
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
            if hasattr(candidate, "pricing_plans") or hasattr(candidate, "tenants"):
                return candidate
        except Exception:
            pass

        try:
            nested = getattr(candidate, "db", None)

            if nested is not None and (hasattr(nested, "pricing_plans") or hasattr(nested, "tenants")):
                return nested
        except Exception:
            pass

    raise RuntimeError("Unable to resolve MongoDB database object.")


def build_configured_plans(app):
    currency = safe_str(config_value(app, "RAZORPAY_CURRENCY", "INR")) or "INR"

    essential_amount = to_float(
        config_value(app, "SAAS_ESSENTIAL_PLAN_AMOUNT", 2495),
        2495,
    )
    essential_limit = to_int(
        config_value(app, "SAAS_ESSENTIAL_EMPLOYEE_LIMIT", 50),
        50,
    )

    growth_amount = to_float(
        config_value(app, "SAAS_GROWTH_PLAN_AMOUNT", 4495),
        4495,
    )
    growth_limit = to_int(
        config_value(app, "SAAS_GROWTH_EMPLOYEE_LIMIT", 100),
        100,
    )

    premium_amount = to_float(
        config_value(app, "SAAS_PREMIUM_PLAN_AMOUNT", 0),
        0,
    )
    premium_is_custom = truthy(
        config_value(app, "SAAS_PREMIUM_IS_CUSTOM", True),
    )

    default_paid_code = safe_str(
        config_value(app, "SAAS_DEFAULT_PAID_PLAN_CODE", "growth"),
    ).lower() or "growth"

    return [
        {
            "plan_code": "essential",
            "plan_name": "Essential",
            "display_name": "Essential",
            "description": "Starter HRMS subscription for small teams.",
            "amount": essential_amount,
            "currency": currency,
            "billing_interval": "monthly",
            "employee_limit": essential_limit,
            "included_employees": essential_limit,
            "is_unlimited_employees": False,
            "is_custom_pricing": False,
            "allow_online_payment": True,
            "is_recommended": default_paid_code == "essential",
            "is_active": True,
            "sort_order": 10,
            "features": [
                "Full HRMS access",
                f"Up to {essential_limit} employees",
                "Attendance, leave, projects and employee records",
                "Standard support",
            ],
        },
        {
            "plan_code": "growth",
            "plan_name": "Growth",
            "display_name": "Growth",
            "description": "Recommended HRMS subscription for growing companies.",
            "amount": growth_amount,
            "currency": currency,
            "billing_interval": "monthly",
            "employee_limit": growth_limit,
            "included_employees": growth_limit,
            "is_unlimited_employees": False,
            "is_custom_pricing": False,
            "allow_online_payment": True,
            "is_recommended": default_paid_code == "growth",
            "is_active": True,
            "sort_order": 20,
            "features": [
                "Full HRMS access",
                f"Up to {growth_limit} employees",
                "All operational HRMS modules",
                "Priority support",
            ],
        },
        {
            "plan_code": "premium",
            "plan_name": "Premium",
            "display_name": "Premium",
            "description": "Custom enterprise HRMS subscription with unlimited employees.",
            "amount": premium_amount,
            "currency": currency,
            "billing_interval": "monthly",
            "employee_limit": None,
            "included_employees": None,
            "is_unlimited_employees": True,
            "is_custom_pricing": premium_is_custom,
            "allow_online_payment": bool(not premium_is_custom and premium_amount > 0),
            "is_recommended": default_paid_code == "premium",
            "is_active": True,
            "sort_order": 30,
            "features": [
                "Full HRMS access",
                "Unlimited employees",
                "All modules included",
                "Custom onboarding and support",
            ],
        },
    ]


def run_seed(app, dry_run=False, force=False):
    db = resolve_db(app)
    plans = build_configured_plans(app)
    results = []

    for plan in plans:
        existing = db.pricing_plans.find_one({
            "plan_code": plan["plan_code"],
            "is_deleted": {"$ne": True},
        })

        if existing and not force:
            results.append({
                "plan_code": plan["plan_code"],
                "action": "skipped_existing",
                "message": "Plan already exists. Use --force to update from config defaults.",
                "current_amount": existing.get("amount"),
                "current_employee_limit": existing.get("employee_limit"),
            })
            continue

        document = {
            **plan,
            "updated_at": now_utc(),
            "updated_by": "seed_pricing_plans",
            "is_deleted": False,
        }

        if existing:
            if not dry_run:
                db.pricing_plans.update_one(
                    {"_id": existing["_id"]},
                    {"$set": document},
                )

            results.append({
                "plan_code": plan["plan_code"],
                "action": "updated" if not dry_run else "would_update",
                "amount": plan["amount"],
                "employee_limit": plan["employee_limit"],
                "is_unlimited_employees": plan["is_unlimited_employees"],
            })
        else:
            document["created_at"] = now_utc()
            document["created_by"] = "seed_pricing_plans"

            if not dry_run:
                db.pricing_plans.insert_one(document)

            results.append({
                "plan_code": plan["plan_code"],
                "action": "created" if not dry_run else "would_create",
                "amount": plan["amount"],
                "employee_limit": plan["employee_limit"],
                "is_unlimited_employees": plan["is_unlimited_employees"],
            })

    existing_codes = sorted([
        item.get("plan_code")
        for item in db.pricing_plans.find(
            {"is_deleted": {"$ne": True}},
            {"plan_code": 1},
        )
        if item.get("plan_code")
    ]) if not dry_run else []

    return {
        "ok": True,
        "dry_run": dry_run,
        "force": force,
        "results": results,
        "existing_plan_codes": existing_codes,
        "completed_at": now_utc(),
    }


def build_parser():
    parser = argparse.ArgumentParser(
        description="Seed dynamic YourComate SaaS pricing plans.",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing to MongoDB.",
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing pricing plan records from config defaults.",
    )

    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full JSON output.",
    )

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    os.chdir(BACKEND_DIR)

    from app import create_app

    app = create_app()

    with app.app_context():
        result = run_seed(
            app,
            dry_run=args.dry_run,
            force=args.force,
        )

    clean_result = serialize(result)

    if args.json:
        print(json.dumps(clean_result, indent=2, ensure_ascii=False))
        return 0 if clean_result.get("ok") else 1

    print("YourComate HRMS SaaS Pricing Plan Seed")
    print("--------------------------------------")
    print(f"Dry Run : {clean_result.get('dry_run')}")
    print(f"Force   : {clean_result.get('force')}")
    print("")

    for item in clean_result.get("results") or []:
        print(
            f"- {item.get('plan_code')}: {item.get('action')} "
            f"(amount={item.get('amount', item.get('current_amount'))}, "
            f"employee_limit={item.get('employee_limit', item.get('current_employee_limit'))})"
        )
        if item.get("message"):
            print(f"  {item.get('message')}")

    if clean_result.get("existing_plan_codes"):
        print("")
        print("Existing pricing plans:")
        print(", ".join(clean_result["existing_plan_codes"]))

    return 0 if clean_result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())