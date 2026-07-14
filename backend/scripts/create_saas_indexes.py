"""
Create MongoDB indexes required for YourComate HRMS SaaS features.

Usage from backend folder:

    python scripts/create_saas_indexes.py

Preview mode:

    python scripts/create_saas_indexes.py --dry-run

What this script does:
- Creates indexes for tenants, demo requests, subscriptions, payments,
  payment orders, and trial notifications.
- Helps prevent duplicate demo/company records.
- Improves Superadmin search/filter performance.
- Does not delete or modify existing records.

Important MongoDB compatibility note:
Some MongoDB versions do not allow `$ne` inside partialFilterExpression.
This script avoids `$ne` in partial indexes for better compatibility.
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

    return value


def resolve_db(app):
    """
    Resolves MongoDB database object from the current Flask project.
    """

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

    raise RuntimeError(
        "Unable to resolve MongoDB database object. "
        "Check backend/app/extensions.py and adjust resolve_db() if needed."
    )


def drop_failed_old_index_if_exists(collection, index_name):
    """
    Drops an index by name if it already exists.

    Safe behavior:
    - If index does not exist, do nothing.
    - If drop fails because index does not exist, ignore.
    - Other errors are raised to the caller.
    """

    try:
        existing_indexes = collection.index_information()
    except Exception:
        existing_indexes = {}

    if index_name not in existing_indexes:
        return False

    try:
        collection.drop_index(index_name)
        return True
    except Exception as exc:
        text = str(exc).lower()

        if "index not found" in text or "indexnotfound" in text:
            return False

        raise


INDEX_DEFINITIONS = [
    {
        "collection": "tenants",
        "name": "tenant_id_unique_active",
        "keys": [("tenant_id", 1)],
        "options": {
            "unique": True,
            "partialFilterExpression": {
                "tenant_id": {"$exists": True, "$type": "string"},
            },
        },
    },
    {
        "collection": "tenants",
        "name": "tenant_code_unique_active",
        "keys": [("tenant_code", 1)],
        "options": {
            "unique": True,
            "partialFilterExpression": {
                "tenant_code": {"$exists": True, "$type": "string"},
            },
        },
    },
    {
        "collection": "tenants",
        "name": "tenant_plan_status",
        "keys": [("plan_type", 1), ("status", 1), ("trial_end_date", 1)],
        "options": {},
    },
    {
        "collection": "tenants",
        "name": "tenant_company_search",
        "keys": [("company_name", 1), ("company_email", 1), ("tenant_code", 1)],
        "options": {},
    },
    {
        "collection": "demo_requests",
        "name": "demo_request_email_active",
        "keys": [("company_email", 1), ("status", 1)],
        "options": {
            "partialFilterExpression": {
                "company_email": {"$exists": True, "$type": "string"},
            },
        },
    },
    {
        "collection": "demo_requests",
        "name": "demo_request_status_created",
        "keys": [("status", 1), ("otp_verified", 1), ("created_at", -1)],
        "options": {},
    },
    {
        "collection": "demo_requests",
        "name": "demo_request_company_search",
        "keys": [("company_name", 1), ("company_email", 1), ("contact_person_name", 1)],
        "options": {},
    },
    {
        "collection": "subscriptions",
        "name": "subscription_tenant_status",
        "keys": [("tenant_id", 1), ("status", 1), ("plan_type", 1)],
        "options": {},
    },
    {
        "collection": "subscriptions",
        "name": "subscription_expiry",
        "keys": [("status", 1), ("end_date", 1), ("trial_end_date", 1)],
        "options": {},
    },
    {
        "collection": "payments",
        "name": "payment_razorpay_payment_id_unique",
        "keys": [("razorpay_payment_id", 1)],
        "options": {
            "unique": True,
            "partialFilterExpression": {
                "razorpay_payment_id": {"$exists": True, "$type": "string"},
            },
        },
    },
    {
        "collection": "payments",
        "name": "payment_tenant_created",
        "keys": [("tenant_id", 1), ("created_at", -1)],
        "options": {},
    },
    {
        "collection": "payments",
        "name": "payment_status_created",
        "keys": [("status", 1), ("payment_status", 1), ("created_at", -1)],
        "options": {},
    },
    {
        "collection": "payment_orders",
        "name": "payment_order_razorpay_order_id_unique",
        "keys": [("razorpay_order_id", 1)],
        "options": {
            "unique": True,
            "partialFilterExpression": {
                "razorpay_order_id": {"$exists": True, "$type": "string"},
            },
        },
    },
    {
        "collection": "payment_orders",
        "name": "payment_order_tenant_created",
        "keys": [("tenant_id", 1), ("created_at", -1)],
        "options": {},
    },
    {
        "collection": "payment_orders",
        "name": "payment_order_status",
        "keys": [("status", 1), ("created_at", -1)],
        "options": {},
    },
    {
        "collection": "trial_notifications",
        "name": "trial_notification_once_per_tenant_type",
        "keys": [("tenant_id", 1), ("reminder_type", 1)],
        "options": {
            "unique": True,
            "partialFilterExpression": {
                "tenant_id": {"$exists": True, "$type": "string"},
                "reminder_type": {"$exists": True, "$type": "string"},
            },
        },
    },
    {
        "collection": "trial_notifications",
        "name": "trial_notification_sent_at",
        "keys": [("sent_at", -1)],
        "options": {},
    },
    {
        "collection": "notifications",
        "name": "notification_saas_trial_user",
        "keys": [
            ("tenant_id", 1),
            ("user_id", 1),
            ("notification_type", 1),
            ("meta.reminder_type", 1),
        ],
        "options": {},
    },
    {
        "collection": "users",
        "name": "user_tenant_email",
        "keys": [("tenant_id", 1), ("email", 1)],
        "options": {},
    },
    {
        "collection": "employees",
        "name": "employee_tenant_status",
        "keys": [("tenant_id", 1), ("status", 1), ("employment_status", 1)],
        "options": {},
    },
]


def create_index(db, definition, dry_run=False, drop_existing=False):
    collection_name = definition["collection"]
    index_name = definition["name"]
    keys = definition["keys"]
    options = {
        **definition.get("options", {}),
        "name": index_name,
    }

    if dry_run:
        return {
            "collection": collection_name,
            "index": index_name,
            "keys": keys,
            "options": options,
            "dropped_existing": False,
            "created": False,
            "dry_run": True,
        }

    collection = db[collection_name]
    dropped_existing = False

    if drop_existing:
        dropped_existing = drop_failed_old_index_if_exists(collection, index_name)

    created_name = collection.create_index(keys, **options)

    return {
        "collection": collection_name,
        "index": index_name,
        "created_name": created_name,
        "dropped_existing": dropped_existing,
        "created": True,
        "dry_run": False,
    }


def run_indexes(db, dry_run=False, drop_existing=False):
    results = []

    for definition in INDEX_DEFINITIONS:
        try:
            result = create_index(
                db,
                definition,
                dry_run=dry_run,
                drop_existing=drop_existing,
            )
            result["ok"] = True
        except Exception as exc:
            result = {
                "collection": definition["collection"],
                "index": definition["name"],
                "ok": False,
                "error": str(exc),
                "dry_run": dry_run,
            }

        results.append(result)

    return {
        "ok": all(item.get("ok") for item in results),
        "dry_run": dry_run,
        "drop_existing": drop_existing,
        "total_indexes": len(results),
        "success_count": len([item for item in results if item.get("ok")]),
        "failed_count": len([item for item in results if not item.get("ok")]),
        "results": results,
        "completed_at": now_utc(),
    }


def build_parser():
    parser = argparse.ArgumentParser(
        description="Create MongoDB indexes for YourComate HRMS SaaS features.",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview index operations without creating indexes.",
    )

    parser.add_argument(
        "--drop-existing",
        action="store_true",
        help="Drop existing indexes with the same name before recreating them.",
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

    os.chdir(BACKEND_DIR)

    from app import create_app

    app = create_app()

    with app.app_context():
        db = resolve_db(app)
        result = run_indexes(
            db,
            dry_run=args.dry_run,
            drop_existing=args.drop_existing,
        )

    clean_result = serialize_for_json(result)

    if args.json:
        print(json.dumps(clean_result, indent=2, ensure_ascii=False))
        return 0 if clean_result.get("ok") else 1

    print("YourComate HRMS SaaS MongoDB Index Setup")
    print("----------------------------------------")
    print(f"Dry Run      : {clean_result.get('dry_run')}")
    print(f"Drop Existing: {clean_result.get('drop_existing')}")
    print(f"Total Indexes: {clean_result.get('total_indexes')}")
    print(f"Success      : {clean_result.get('success_count')}")
    print(f"Failed       : {clean_result.get('failed_count')}")

    print("")
    print("Details:")

    for item in clean_result.get("results") or []:
        status = "OK" if item.get("ok") else "FAILED"
        dropped = " dropped_existing=True" if item.get("dropped_existing") else ""
        print(f"- {status}: {item.get('collection')}.{item.get('index')}{dropped}")

        if item.get("error"):
            print(f"  Error: {item.get('error')}")

    return 0 if clean_result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())