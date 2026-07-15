"""
YourComate HRMS SaaS Smoke Check

Usage from backend folder:

    python scripts/saas_smoke_check.py

JSON output:

    python scripts/saas_smoke_check.py --json

What this script checks:
- Flask app can start.
- SaaS config values are loaded.
- SMTP/Razorpay config placeholders are detected. Valid zero SaaS settings are accepted.
- Important SaaS routes are registered.
- MongoDB connection is available.
- SDS tenant exists after seed script.
- Required SaaS collections are reachable.

This script is read-only. It does not create, update, or delete records.
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


REQUIRED_ROUTES = [
    "/api/v1/demo-requests/apply",
    "/api/v1/demo-requests/verify-otp",
    "/api/v1/demo-requests/resend-otp",
    "/api/v1/demo-requests/status",
    "/api/v1/demo-requests/admin/requests",
    "/api/v1/billing/pricing",
    "/api/v1/billing/summary",
    "/api/v1/billing/create-order",
    "/api/v1/billing/verify-payment",
    "/api/v1/billing/admin/pricing-plans",
    "/api/v1/billing/admin/subscriptions",
    "/api/v1/billing/admin/payments",
    "/api/v1/billing/admin/orders",
    "/api/v1/billing/admin/refresh-expired-demos",
]

REQUIRED_CONFIG_KEYS = [
    "SAAS_ENABLED",
    "SDS_TENANT_ID",
    "SDS_TENANT_CODE",
    "SDS_COMPANY_NAME",
    "SDS_HAS_LIFETIME_ACCESS",
    "YOURCOMATE_DOMAIN",
    "AUTO_ADMIN_EMAIL_DOMAIN",
    "DEMO_DURATION_DAYS",
    "DEMO_HAS_FULL_ACCESS",
    "DEMO_EMPLOYEE_LIMIT",
    "DEMO_ALLOWED_MODULES",
    "DEMO_OTP_LENGTH",
    "DEMO_OTP_EXPIRY_MINUTES",
    "MAIL_SERVER",
    "MAIL_PORT",
    "MAIL_USERNAME",
    "MAIL_PASSWORD",
    "MAIL_DEFAULT_SENDER",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_CURRENCY",
    "SAAS_FULL_PLAN_AMOUNT",
    "SAAS_FULL_PLAN_INTERVAL",
    "SAAS_ESSENTIAL_PLAN_AMOUNT",
    "SAAS_ESSENTIAL_EMPLOYEE_LIMIT",
    "SAAS_GROWTH_PLAN_AMOUNT",
    "SAAS_GROWTH_EMPLOYEE_LIMIT",
    "SAAS_PREMIUM_PLAN_AMOUNT",
    "SAAS_PREMIUM_EMPLOYEE_LIMIT",
    "SAAS_PREMIUM_IS_CUSTOM",
    "SAAS_DEFAULT_PAID_PLAN_CODE",
    "FRONTEND_BASE_URL",
    "BILLING_PAGE_PATH",
]

SAAS_COLLECTIONS = [
    "tenants",
    "demo_requests",
    "pricing_plans",
    "subscriptions",
    "payments",
    "payment_orders",
    "trial_notifications",
    "notifications",
    "users",
    "employees",
]


def now_utc():
    return datetime.now(timezone.utc)


def serialize_for_json(value):
    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, list):
        return [serialize_for_json(item) for item in value]

    if isinstance(value, dict):
        return {
            str(key): serialize_for_json(item)
            for key, item in value.items()
        }

    try:
        from bson import ObjectId

        if isinstance(value, ObjectId):
            return str(value)
    except Exception:
        pass

    return value


def safe_str(value):
    if value is None:
        return ""

    return str(value).strip()


def is_placeholder(value):
    text = safe_str(value).lower()

    return (
        not text
        or text.startswith("your_")
        or "your_" in text
        or text in {"changeme", "change_me", "replace_me", "todo"}
    )


def is_config_key_valid(key, value):
    """
    Some final SaaS config values are intentionally zero:
    - DEMO_EMPLOYEE_LIMIT=0 means unlimited during the 15-day trial.
    - SAAS_PREMIUM_PLAN_AMOUNT=0 means custom quote.
    - SAAS_PREMIUM_EMPLOYEE_LIMIT=0 means unlimited/custom.
    """

    zero_allowed_keys = {
        "DEMO_EMPLOYEE_LIMIT",
        "SAAS_PREMIUM_PLAN_AMOUNT",
        "SAAS_PREMIUM_EMPLOYEE_LIMIT",
    }

    if key in zero_allowed_keys and safe_str(value) == "0":
        return True

    return value is not None and not is_placeholder(value)



def resolve_db(app):
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
            if hasattr(candidate, "tenants") or hasattr(candidate, "users"):
                return candidate
        except Exception:
            pass

        try:
            nested = getattr(candidate, "db", None)

            if nested is not None and (hasattr(nested, "tenants") or hasattr(nested, "users")):
                return nested
        except Exception:
            pass

    raise RuntimeError("Unable to resolve MongoDB database object.")


def route_exists(app, route_path):
    for rule in app.url_map.iter_rules():
        if str(rule.rule) == route_path:
            return True

    return False


def check_routes(app):
    details = []

    for route_path in REQUIRED_ROUTES:
        exists = route_exists(app, route_path)

        details.append({
            "route": route_path,
            "ok": exists,
            "status": "registered" if exists else "missing",
        })

    return {
        "ok": all(item["ok"] for item in details),
        "total": len(details),
        "registered": len([item for item in details if item["ok"]]),
        "missing": [item["route"] for item in details if not item["ok"]],
        "details": details,
    }


def check_config(app):
    details = []

    for key in REQUIRED_CONFIG_KEYS:
        value = app.config.get(key)
        placeholder = is_placeholder(value)
        ok = is_config_key_valid(key, value)

        details.append({
            "key": key,
            "ok": ok,
            "present": value is not None,
            "placeholder": placeholder and not ok,
            "value_preview": "***" if "PASSWORD" in key or "SECRET" in key else safe_str(value),
        })

    required_runtime_ok = all(
        item["ok"]
        for item in details
        if item["key"] not in {
            "MAIL_USERNAME",
            "MAIL_PASSWORD",
            "MAIL_DEFAULT_SENDER",
            "RAZORPAY_KEY_ID",
            "RAZORPAY_KEY_SECRET",
        }
    )

    payment_email_ready = all(
        item["ok"]
        for item in details
        if item["key"] in {
            "MAIL_USERNAME",
            "MAIL_PASSWORD",
            "MAIL_DEFAULT_SENDER",
            "RAZORPAY_KEY_ID",
            "RAZORPAY_KEY_SECRET",
        }
    )

    return {
        "ok": required_runtime_ok,
        "payment_email_ready": payment_email_ready,
        "total": len(details),
        "ready": len([item for item in details if item["ok"]]),
        "needs_real_values": [
            item["key"]
            for item in details
            if not item["ok"]
        ],
        "details": details,
    }


def check_database(app):
    try:
        db = resolve_db(app)

        collection_names = set(db.list_collection_names())
        collection_details = []

        for collection_name in SAAS_COLLECTIONS:
            exists = collection_name in collection_names

            count = None
            error = ""

            if exists:
                try:
                    count = db[collection_name].estimated_document_count()
                except Exception as exc:
                    error = str(exc)

            collection_details.append({
                "collection": collection_name,
                "exists": exists,
                "count": count,
                "error": error,
            })

        sds_tenant_id = app.config.get("SDS_TENANT_ID", "sds")
        sds_tenant_code = app.config.get("SDS_TENANT_CODE", "SDS")

        sds_tenant = db.tenants.find_one(
            {
                "$or": [
                    {"tenant_id": sds_tenant_id},
                    {"tenant_code": sds_tenant_code},
                    {"is_sds_company": True},
                ],
                "is_deleted": {"$ne": True},
            }
        )

        pricing_plan_codes = []

        if "pricing_plans" in collection_names:
            try:
                pricing_plan_codes = sorted([
                    plan.get("plan_code")
                    for plan in db.pricing_plans.find(
                        {"is_deleted": {"$ne": True}},
                        {"plan_code": 1},
                    )
                    if plan.get("plan_code")
                ])
            except Exception:
                pricing_plan_codes = []

        expected_pricing_codes = {"essential", "growth", "premium"}
        pricing_defaults_exist = expected_pricing_codes.issubset(set(pricing_plan_codes))

        return {
            "ok": True,
            "connected": True,
            "collections": collection_details,
            "sds_tenant_exists": bool(sds_tenant),
            "pricing_defaults_exist": pricing_defaults_exist,
            "pricing_plan_codes": pricing_plan_codes,
            "sds_tenant": {
                "tenant_id": sds_tenant.get("tenant_id") if sds_tenant else "",
                "tenant_code": sds_tenant.get("tenant_code") if sds_tenant else "",
                "company_name": sds_tenant.get("company_name") if sds_tenant else "",
                "plan_type": sds_tenant.get("plan_type") if sds_tenant else "",
                "status": sds_tenant.get("status") if sds_tenant else "",
                "is_sds_company": sds_tenant.get("is_sds_company") if sds_tenant else False,
            },
        }
    except Exception as exc:
        return {
            "ok": False,
            "connected": False,
            "error": str(exc),
            "collections": [],
            "sds_tenant_exists": False,
            "pricing_defaults_exist": False,
            "pricing_plan_codes": [],
        }


def run_check():
    os.chdir(BACKEND_DIR)

    from app import create_app

    app = create_app()

    with app.app_context():
        route_result = check_routes(app)
        config_result = check_config(app)
        database_result = check_database(app)

    return {
        "ok": bool(route_result["ok"] and config_result["ok"] and database_result["ok"]),
        "checked_at": now_utc(),
        "backend_dir": str(BACKEND_DIR),
        "routes": route_result,
        "config": config_result,
        "database": database_result,
        "next_steps": build_next_steps(route_result, config_result, database_result),
    }


def build_next_steps(route_result, config_result, database_result):
    steps = []

    if route_result.get("missing"):
        steps.append("Some SaaS routes are missing. Recheck backend/app/__init__.py route registration.")

    if config_result.get("needs_real_values"):
        steps.append(
            "Some config values are missing/placeholders. Update backend/.env, especially SMTP and Razorpay values."
        )

    if not config_result.get("payment_email_ready"):
        steps.append("SMTP/Razorpay may not be ready yet. OTP email and payment checkout may fail until real credentials are added.")

    if not database_result.get("connected"):
        steps.append("MongoDB connection failed. Check MONGO_URI and database server.")

    if database_result.get("connected") and not database_result.get("sds_tenant_exists"):
        steps.append("SDS lifetime tenant is missing. Run: python scripts/seed_sds_tenant.py")

    if database_result.get("connected") and not database_result.get("pricing_defaults_exist"):
        steps.append("Dynamic pricing defaults are missing. Run: python scripts/seed_pricing_plans.py")

    if database_result.get("connected"):
        missing_collections = [
            item["collection"]
            for item in database_result.get("collections", [])
            if not item.get("exists")
        ]

        if missing_collections:
            steps.append(
                "Some SaaS collections do not exist yet. This is normal until first use, but you can run create_saas_indexes.py."
            )

    if not steps:
        steps.append("Smoke check passed. Continue with frontend/manual demo registration testing.")

    return steps


def build_parser():
    parser = argparse.ArgumentParser(
        description="Run YourComate HRMS SaaS smoke checks.",
    )

    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full result as JSON.",
    )

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    result = serialize_for_json(run_check())

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result.get("ok") else 1

    print("YourComate HRMS SaaS Smoke Check")
    print("--------------------------------")
    print(f"Checked At              : {result.get('checked_at')}")
    print(f"Backend Dir             : {result.get('backend_dir')}")
    print(f"Overall OK              : {result.get('ok')}")

    print("")
    print("Routes")
    print(f"- Registered            : {result['routes'].get('registered')} / {result['routes'].get('total')}")

    if result["routes"].get("missing"):
        print("- Missing:")
        for route_path in result["routes"]["missing"]:
            print(f"  - {route_path}")

    print("")
    print("Config")
    print(f"- Runtime Config OK      : {result['config'].get('ok')}")
    print(f"- SMTP/Razorpay Ready    : {result['config'].get('payment_email_ready')}")

    if result["config"].get("needs_real_values"):
        print("- Needs real values:")
        for key in result["config"]["needs_real_values"]:
            print(f"  - {key}")

    print("")
    print("Database")
    print(f"- Connected             : {result['database'].get('connected')}")
    print(f"- SDS Tenant Exists     : {result['database'].get('sds_tenant_exists')}")
    print(f"- Pricing Defaults      : {result['database'].get('pricing_defaults_exist')}")
    print(f"- Pricing Plan Codes    : {', '.join(result['database'].get('pricing_plan_codes') or []) or 'None'}")

    if result["database"].get("error"):
        print(f"- Error                 : {result['database'].get('error')}")

    print("")
    print("Next Steps")
    next_steps = result.get("next_steps") or []

    if next_steps:
        for step in next_steps:
            print(f"- {step}")
    else:
        print("- No next steps. SaaS smoke check passed.")

    if result["database"].get("connected") and not result["database"].get("pricing_defaults_exist"):
        print("")
        print("Pricing Seed Command")
        print("- python scripts/seed_pricing_plans.py")

    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())