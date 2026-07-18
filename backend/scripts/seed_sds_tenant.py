"""
Seed / migrate the existing SDS HRMS data into the lifetime SDS tenant.

Usage from backend folder:

    python scripts/seed_sds_tenant.py

Testing without writing:

    python scripts/seed_sds_tenant.py --dry-run

What this script does:
- Creates or refreshes the SDS lifetime tenant in db.tenants.
- Adds tenant_id / tenant_code / company_name to existing legacy records
  that do not already have a tenant.
- Keeps existing trial/paid tenant records untouched.
- Does not require SDS to pay, renew, or subscribe.
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


EXCLUDED_COLLECTIONS = {
    "tenants",
    "companies",
    "demo_requests",
    "pricing_plans",
    "subscriptions",
    "payments",
    "payment_orders",
    "trial_notifications",
    "system.indexes",
}

DEFAULT_LEGACY_COLLECTIONS = [
    "users",
    "employees",
    "departments",
    "designations",
    "states",
    "attendance",
    "attendance_logs",
    "attendance_mode_requests",
    "holiday_work_requests",
    "holidays",
    "leave_requests",
    "leave_balances",
    "leave_deductions",
    "projects",
    "project_members",
    "project_updates",
    "assets",
    "asset_assignments",
    "policies",
    "notifications",
    "grievances",
    "it_tickets",
    "management_groups",
    "performance_reviews",
    "reports",
    "celebrations",
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


def get_collection_names(db):
    try:
        return list(db.list_collection_names())
    except Exception:
        return []


def get_target_collections(db, include_all=False):
    available = set(get_collection_names(db))

    if include_all:
        return sorted(
            name
            for name in available
            if name not in EXCLUDED_COLLECTIONS and not name.startswith("system.")
        )

    return [
        name
        for name in DEFAULT_LEGACY_COLLECTIONS
        if name in available and name not in EXCLUDED_COLLECTIONS
    ]


def missing_tenant_query():
    return {
        "$or": [
            {"tenant_id": {"$exists": False}},
            {"tenant_id": None},
            {"tenant_id": ""},
            {"company_id": {"$exists": False}},
            {"company_id": None},
            {"company_id": ""},
        ],
        "is_deleted": {"$ne": True},
    }


def build_sds_update_payload(sds_tenant, config):
    tenant_id = sds_tenant.get("tenant_id") or config.get("SDS_TENANT_ID", "sds")
    tenant_code = sds_tenant.get("tenant_code") or config.get("SDS_TENANT_CODE", "SDS")
    company_name = (
        sds_tenant.get("company_name")
        or sds_tenant.get("name")
        or config.get("SDS_COMPANY_NAME", "Sayanant Development Services Pvt. Ltd.")
    )

    return {
        "tenant_id": tenant_id,
        "company_id": tenant_id,
        "tenant_code": tenant_code,
        "company_name": company_name,
        "updated_at": now_utc(),
    }


def build_sds_lifetime_tenant_fields(sds_tenant, config):
    tenant_id = sds_tenant.get("tenant_id") or config.get("SDS_TENANT_ID", "sds")
    tenant_code = sds_tenant.get("tenant_code") or config.get("SDS_TENANT_CODE", "SDS")
    company_name = (
        sds_tenant.get("company_name")
        or sds_tenant.get("name")
        or config.get("SDS_COMPANY_NAME", "Sayanant Development Services Pvt. Ltd.")
    )

    return {
        "tenant_id": tenant_id,
        "company_id": tenant_id,
        "tenant_code": tenant_code,
        "company_name": company_name,
        "name": company_name,
        "plan": "Lifetime Full HRMS",
        "plan_code": "lifetime",
        "plan_name": "Lifetime Full HRMS",
        "plan_label": "Lifetime Full HRMS",
        "plan_type": "lifetime",
        "billing_interval": "lifetime",
        "status": "active",
        "subscription_status": "lifetime",
        "trial_status": "not_required",
        "employee_limit": None,
        "is_unlimited_employees": True,
        "allowed_modules": ["all"],
        "demo_duration_days": None,
        "demo_has_full_access": False,
        "requires_payment": False,
        "has_lifetime_access": True,
        "is_sds_company": True,
        "is_lifetime": True,
        "is_demo_company": False,
        "is_paid_company": False,
        "updated_at": now_utc(),
        "is_deleted": False,
    }


def ensure_sds_lifetime_tenant_fields(db, sds_tenant, config, dry_run=False):
    fields = build_sds_lifetime_tenant_fields(sds_tenant, config)
    query = {
        "$or": [
            {"tenant_id": fields["tenant_id"]},
            {"tenant_code": fields["tenant_code"]},
            {"is_sds_company": True},
        ],
        "is_deleted": {"$ne": True},
    }

    existing = db.tenants.find_one(query)

    if dry_run:
        preview = {
            **(existing or sds_tenant or {}),
            **fields,
        }

        return preview, {
            "action": "would_update" if existing else "would_create",
            "dry_run": True,
        }

    db.tenants.update_one(
        query,
        {
            "$set": fields,
            "$setOnInsert": {
                "created_at": now_utc(),
                "created_by": "seed_sds_tenant",
            },
        },
        upsert=True,
    )

    updated = db.tenants.find_one(query) or fields

    return updated, {
        "action": "updated",
        "dry_run": False,
    }


def migrate_collection(db, collection_name, update_payload, dry_run=False):
    collection = db[collection_name]
    query = missing_tenant_query()
    matched_count = collection.count_documents(query)

    if dry_run:
        return {
            "collection": collection_name,
            "matched": matched_count,
            "modified": 0,
            "dry_run": True,
        }

    if matched_count <= 0:
        return {
            "collection": collection_name,
            "matched": 0,
            "modified": 0,
            "dry_run": False,
        }

    result = collection.update_many(
        query,
        {
            "$set": update_payload,
        },
    )

    return {
        "collection": collection_name,
        "matched": matched_count,
        "modified": getattr(result, "modified_count", 0),
        "dry_run": False,
    }


def ensure_sds_subscription_record(db, sds_tenant, config, dry_run=False):
    tenant_id = sds_tenant.get("tenant_id") or config.get("SDS_TENANT_ID", "sds")
    now = now_utc()

    existing = db.subscriptions.find_one(
        {
            "tenant_id": tenant_id,
            "plan_type": "lifetime",
            "is_deleted": {"$ne": True},
        }
    )

    doc = {
        "tenant_id": tenant_id,
        "company_id": tenant_id,
        "tenant_code": sds_tenant.get("tenant_code") or config.get("SDS_TENANT_CODE", "SDS"),
        "company_name": (
            sds_tenant.get("company_name")
            or sds_tenant.get("name")
            or config.get("SDS_COMPANY_NAME", "Sayanant Development Services Pvt. Ltd.")
        ),
        "plan_code": "lifetime",
        "plan_name": "Lifetime Full HRMS",
        "plan_label": "Lifetime Full HRMS",
        "plan_type": "lifetime",
        "billing_interval": "lifetime",
        "status": "active",
        "subscription_status": "lifetime",
        "trial_status": "not_required",
        "amount": 0,
        "currency": config.get("RAZORPAY_CURRENCY", "INR"),
        "employee_limit": None,
        "is_unlimited_employees": True,
        "allowed_modules": ["all"],
        "demo_duration_days": None,
        "demo_has_full_access": False,
        "requires_payment": False,
        "has_lifetime_access": True,
        "start_date": now,
        "end_date": None,
        "is_sds_company": True,
        "is_lifetime": True,
        "updated_at": now,
        "is_deleted": False,
    }

    if dry_run:
        return {
            "action": "would_update" if existing else "would_create",
            "subscription_id": str(existing.get("_id")) if existing else "",
            "dry_run": True,
        }

    if existing:
        db.subscriptions.update_one(
            {"_id": existing["_id"]},
            {
                "$set": doc,
            },
        )

        return {
            "action": "updated",
            "subscription_id": str(existing.get("_id")),
            "dry_run": False,
        }

    doc["created_at"] = now
    result = db.subscriptions.insert_one(doc)

    return {
        "action": "created",
        "subscription_id": str(result.inserted_id),
        "dry_run": False,
    }


def run_seed(db, app, *, dry_run=False, include_all=False):
    from app.services.tenant_service import ensure_sds_tenant

    config = app.config

    if dry_run:
        # Build/preview SDS tenant without calling ensure_sds_tenant because that writes.
        from app.services.tenant_service import build_sds_tenant_document

        sds_tenant = build_sds_tenant_document(config)
        tenant_action = "would_create_or_update"
    else:
        sds_tenant = ensure_sds_tenant(db, config)
        tenant_action = "created_or_updated"

    sds_tenant, lifetime_result = ensure_sds_lifetime_tenant_fields(
        db,
        sds_tenant,
        config,
        dry_run=dry_run,
    )

    update_payload = build_sds_update_payload(sds_tenant, config)
    collections = get_target_collections(db, include_all=include_all)

    collection_results = [
        migrate_collection(
            db,
            collection_name,
            update_payload,
            dry_run=dry_run,
        )
        for collection_name in collections
    ]

    subscription_result = ensure_sds_subscription_record(
        db,
        sds_tenant,
        config,
        dry_run=dry_run,
    )

    return {
        "ok": True,
        "dry_run": dry_run,
        "include_all": include_all,
        "tenant_action": tenant_action,
        "lifetime_field_action": lifetime_result,
        "sds_tenant": {
            "tenant_id": sds_tenant.get("tenant_id"),
            "tenant_code": sds_tenant.get("tenant_code"),
            "company_name": sds_tenant.get("company_name") or sds_tenant.get("name"),
            "plan_type": sds_tenant.get("plan_type"),
            "status": sds_tenant.get("status"),
            "is_sds_company": sds_tenant.get("is_sds_company"),
            "is_lifetime": sds_tenant.get("is_lifetime"),
            "has_lifetime_access": sds_tenant.get("has_lifetime_access"),
            "allowed_modules": sds_tenant.get("allowed_modules") or ["all"],
            "requires_payment": False,
        },
        "subscription": subscription_result,
        "collections_checked": len(collection_results),
        "total_matched": sum(item.get("matched", 0) for item in collection_results),
        "total_modified": sum(item.get("modified", 0) for item in collection_results),
        "collections": collection_results,
        "completed_at": now_utc(),
    }


def build_parser():
    parser = argparse.ArgumentParser(
        description="Seed/migrate existing SDS HRMS data into lifetime SDS tenant.",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing to MongoDB.",
    )

    parser.add_argument(
        "--all-collections",
        action="store_true",
        help=(
            "Apply tenant_id to all non-SaaS/non-system collections. "
            "Default only updates known HRMS collections."
        ),
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

        result = run_seed(
            db,
            app,
            dry_run=args.dry_run,
            include_all=args.all_collections,
        )

    clean_result = serialize_for_json(result)

    if args.json:
        print(json.dumps(clean_result, indent=2, ensure_ascii=False))
        return 0

    print("YourComate HRMS SDS Tenant Seed / Migration")
    print("-------------------------------------------")
    print(f"Dry Run            : {clean_result.get('dry_run')}")
    print(f"SDS Tenant Action  : {clean_result.get('tenant_action')}")
    print(f"SDS Tenant ID      : {clean_result.get('sds_tenant', {}).get('tenant_id')}")
    print(f"SDS Tenant Code    : {clean_result.get('sds_tenant', {}).get('tenant_code')}")
    print(f"SDS Company        : {clean_result.get('sds_tenant', {}).get('company_name')}")
    print(f"SDS Plan Type      : {clean_result.get('sds_tenant', {}).get('plan_type')}")
    print(f"SDS Status         : {clean_result.get('sds_tenant', {}).get('status')}")
    print(f"SDS Lifetime Access: {clean_result.get('sds_tenant', {}).get('has_lifetime_access')}")
    print(f"SDS Requires Pay   : {clean_result.get('sds_tenant', {}).get('requires_payment')}")
    print(f"Lifetime Field Fix : {clean_result.get('lifetime_field_action', {}).get('action')}")
    print(f"Subscription Action: {clean_result.get('subscription', {}).get('action')}")
    print(f"Collections Checked: {clean_result.get('collections_checked')}")
    print(f"Records Matched    : {clean_result.get('total_matched')}")
    print(f"Records Modified   : {clean_result.get('total_modified')}")

    collections = clean_result.get("collections") or []

    if collections:
        print("")
        print("Collection Details:")
        for item in collections:
            print(
                f"- {item.get('collection')}: "
                f"matched={item.get('matched', 0)}, "
                f"modified={item.get('modified', 0)}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())