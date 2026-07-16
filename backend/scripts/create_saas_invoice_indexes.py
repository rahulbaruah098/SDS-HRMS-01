"""
Create MongoDB indexes for YourComate SaaS invoice and receipt records.

This is a NEW migration script. Create it at:

    backend/scripts/create_saas_invoice_indexes.py

Run from the backend folder after invoice backfill has completed:

    python scripts/create_saas_invoice_indexes.py --dry-run
    python scripts/create_saas_invoice_indexes.py

Optional:

    python scripts/create_saas_invoice_indexes.py --json
    python scripts/create_saas_invoice_indexes.py --drop-existing

Safety:
- Does not modify payment documents.
- Checks duplicate invoice and receipt numbers before creating unique indexes.
- Refuses to create a unique index when duplicate values exist.
- Can be run repeatedly.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


INDEX_DEFINITIONS = [
    {
        "name": "payment_invoice_number_unique",
        "keys": [("invoice_number", 1)],
        "unique_field": "invoice_number",
        "options": {
            "unique": True,
            "partialFilterExpression": {
                "invoice_number": {
                    "$exists": True,
                    "$type": "string",
                    "$gt": "",
                }
            },
        },
    },
    {
        "name": "payment_receipt_number_unique",
        "keys": [("receipt_number", 1)],
        "unique_field": "receipt_number",
        "options": {
            "unique": True,
            "partialFilterExpression": {
                "receipt_number": {
                    "$exists": True,
                    "$type": "string",
                    "$gt": "",
                }
            },
        },
    },
    {
        "name": "payment_tenant_invoice_date",
        "keys": [("tenant_id", 1), ("invoice_date", -1)],
        "options": {},
    },
    {
        "name": "payment_tenant_plan_paid_at",
        "keys": [("tenant_id", 1), ("plan_code", 1), ("paid_at", -1)],
        "options": {},
    },
]


def now_utc():
    return datetime.now(timezone.utc)


def serialize_for_json(value):
    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, list):
        return [serialize_for_json(item) for item in value]

    if isinstance(value, tuple):
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


def find_duplicate_values(collection, field_name, limit=25):
    pipeline = [
        {
            "$match": {
                field_name: {
                    "$exists": True,
                    "$type": "string",
                    "$gt": "",
                }
            }
        },
        {
            "$group": {
                "_id": f"${field_name}",
                "count": {"$sum": 1},
                "payment_ids": {"$push": "$_id"},
            }
        },
        {"$match": {"count": {"$gt": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
        {"$limit": max(int(limit or 25), 1)},
    ]

    duplicates = []

    for item in collection.aggregate(pipeline, allowDiskUse=True):
        duplicates.append({
            "value": item.get("_id"),
            "count": item.get("count", 0),
            "payment_ids": [
                str(payment_id)
                for payment_id in (item.get("payment_ids") or [])[:20]
            ],
        })

    return duplicates


def drop_index_if_present(collection, index_name):
    index_info = collection.index_information()

    if index_name not in index_info:
        return False

    collection.drop_index(index_name)
    return True


def inspect_index(collection, index_name):
    return collection.index_information().get(index_name)


def process_index(
    collection,
    definition,
    dry_run=False,
    drop_existing=False,
):
    name = definition["name"]
    unique_field = definition.get("unique_field")
    existing = inspect_index(collection, name)
    duplicates = []

    if unique_field:
        duplicates = find_duplicate_values(
            collection,
            unique_field,
        )

        if duplicates:
            return {
                "ok": False,
                "index": name,
                "keys": definition["keys"],
                "existing": existing,
                "duplicate_field": unique_field,
                "duplicates": duplicates,
                "message": (
                    f"Duplicate {unique_field} values exist. "
                    "Resolve them before creating the unique index."
                ),
                "dry_run": bool(dry_run),
            }

    if dry_run:
        return {
            "ok": True,
            "index": name,
            "keys": definition["keys"],
            "options": definition.get("options") or {},
            "existing": existing,
            "would_drop_existing": bool(drop_existing and existing),
            "would_create": True,
            "dry_run": True,
        }

    dropped_existing = False

    if drop_existing and existing:
        dropped_existing = drop_index_if_present(
            collection,
            name,
        )

    created_name = collection.create_index(
        definition["keys"],
        name=name,
        **(definition.get("options") or {}),
    )

    return {
        "ok": True,
        "index": name,
        "created_name": created_name,
        "dropped_existing": dropped_existing,
        "dry_run": False,
    }


def run(db, dry_run=False, drop_existing=False):
    collection = db.payments
    results = []

    for definition in INDEX_DEFINITIONS:
        try:
            result = process_index(
                collection,
                definition,
                dry_run=dry_run,
                drop_existing=drop_existing,
            )
        except Exception as exc:
            result = {
                "ok": False,
                "index": definition["name"],
                "error": str(exc),
                "dry_run": bool(dry_run),
            }

        results.append(result)

    return {
        "ok": all(item.get("ok") for item in results),
        "collection": "payments",
        "dry_run": bool(dry_run),
        "drop_existing": bool(drop_existing),
        "total_indexes": len(results),
        "success_count": sum(1 for item in results if item.get("ok")),
        "failed_count": sum(1 for item in results if not item.get("ok")),
        "results": results,
        "completed_at": now_utc(),
    }


def print_human_report(report):
    mode = "DRY RUN" if report.get("dry_run") else "WRITE"

    print(f"YourComate SaaS invoice indexes: {mode}")
    print(f"Collection: {report.get('collection')}")
    print(f"Indexes:    {report.get('total_indexes', 0)}")
    print(f"Successful: {report.get('success_count', 0)}")
    print(f"Failed:     {report.get('failed_count', 0)}")
    print("")

    for item in report.get("results") or []:
        status = "OK" if item.get("ok") else "FAILED"
        print(f"- {status}: {item.get('index')}")

        if item.get("would_drop_existing"):
            print("  Existing index would be dropped and recreated.")

        if item.get("dropped_existing"):
            print("  Existing index was dropped and recreated.")

        if item.get("message"):
            print(f"  {item.get('message')}")

        if item.get("error"):
            print(f"  Error: {item.get('error')}")

        for duplicate in item.get("duplicates") or []:
            print(
                "  Duplicate: "
                f"{duplicate.get('value')} "
                f"({duplicate.get('count')} records)"
            )


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Create invoice, receipt, and invoice-history indexes "
            "for YourComate HRMS SaaS payments."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate duplicates and preview index operations.",
    )
    parser.add_argument(
        "--drop-existing",
        action="store_true",
        help="Drop indexes with matching names before recreating them.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the complete report as JSON.",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    from app import create_app
    from app.extensions import get_db

    app = create_app()

    with app.app_context():
        report = run(
            get_db(),
            dry_run=args.dry_run,
            drop_existing=args.drop_existing,
        )

    clean_report = serialize_for_json(report)

    if args.json:
        print(
            json.dumps(
                clean_report,
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print_human_report(clean_report)

    return 0 if clean_report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())