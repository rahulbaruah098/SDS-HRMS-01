"""
Backfill invoice and receipt references for existing successful SaaS payments.

Run from the backend folder after File 145 has been installed:

    python scripts/backfill_saas_invoice_numbers.py --dry-run
    python scripts/backfill_saas_invoice_numbers.py

Optional filters:

    python scripts/backfill_saas_invoice_numbers.py --tenant-id tenant_123
    python scripts/backfill_saas_invoice_numbers.py --limit 100
    python scripts/backfill_saas_invoice_numbers.py --json

Safety:
- Only successful payment records are considered.
- Existing invoice/receipt values are never replaced.
- Re-running the script is safe and idempotent.
- --dry-run previews changes without writing to MongoDB.
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


SUCCESS_STATUSES = {
    "paid",
    "captured",
    "success",
    "succeeded",
    "completed",
}


def now_utc():
    return datetime.now(timezone.utc)


def safe_str(value):
    if value is None:
        return ""

    return str(value).strip()


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


def as_aware_utc(value):
    if not isinstance(value, datetime):
        return None

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def payment_is_successful(payment):
    direct_status = safe_str(payment.get("payment_status")).lower()
    gateway_status = safe_str(
        (payment.get("payment_details") or {}).get("status")
    ).lower()
    invoice_status = safe_str(payment.get("invoice_status")).lower()

    return any(
        status in SUCCESS_STATUSES
        for status in (direct_status, gateway_status, invoice_status)
    )


def resolve_paid_at(payment):
    for field_name in (
        "paid_at",
        "invoice_date",
        "created_at",
        "updated_at",
    ):
        resolved = as_aware_utc(payment.get(field_name))

        if resolved:
            return resolved

    gateway_created_at = (payment.get("payment_details") or {}).get(
        "created_at"
    )

    try:
        if gateway_created_at not in (None, ""):
            return datetime.fromtimestamp(
                float(gateway_created_at),
                tz=timezone.utc,
            )
    except (TypeError, ValueError, OSError, OverflowError):
        pass

    return now_utc()


def build_company_snapshot(payment):
    return {
        "_id": payment.get("company_id") or payment.get("tenant_id"),
        "company_id": payment.get("company_id"),
        "tenant_id": payment.get("tenant_id"),
        "tenant_code": payment.get("tenant_code"),
        "company_name": payment.get("company_name"),
        "company_email": payment.get("company_email"),
    }


def build_update(payment):
    from app.services.razorpay_service import (
        build_invoice_number,
        build_receipt_number,
    )

    paid_at = resolve_paid_at(payment)
    payment_reference = (
        safe_str(payment.get("razorpay_payment_id"))
        or safe_str(payment.get("payment_id"))
        or safe_str(payment.get("_id"))
    )

    company = build_company_snapshot(payment)
    update_fields = {}

    if not safe_str(payment.get("invoice_number")):
        update_fields["invoice_number"] = build_invoice_number(
            company,
            payment_reference,
            paid_at=paid_at,
        )

    if not safe_str(payment.get("receipt_number")):
        update_fields["receipt_number"] = build_receipt_number(
            payment_reference,
            paid_at=paid_at,
        )

    if not safe_str(payment.get("invoice_status")):
        update_fields["invoice_status"] = "paid"

    if not isinstance(payment.get("invoice_date"), datetime):
        update_fields["invoice_date"] = paid_at

    if not isinstance(payment.get("paid_at"), datetime):
        update_fields["paid_at"] = paid_at

    if not safe_str(payment.get("billing_interval")):
        interval = (
            safe_str(payment.get("plan_interval"))
            or safe_str(
                (payment.get("payment_details") or {})
                .get("notes", {})
                .get("plan_interval")
            )
        )

        if interval:
            update_fields["billing_interval"] = interval

    if not safe_str(payment.get("plan_code")):
        plan_code = safe_str(
            (payment.get("payment_details") or {})
            .get("notes", {})
            .get("plan_code")
        )

        if plan_code:
            update_fields["plan_code"] = plan_code.lower()

    if not safe_str(payment.get("quotation_reference")):
        quotation_reference = safe_str(
            (payment.get("payment_details") or {})
            .get("notes", {})
            .get("quotation_reference")
        )

        if quotation_reference:
            update_fields["quotation_reference"] = quotation_reference

    if not safe_str(payment.get("premium_request_id")):
        premium_request_id = safe_str(
            (payment.get("payment_details") or {})
            .get("notes", {})
            .get("premium_request_id")
        )

        if premium_request_id:
            update_fields["premium_request_id"] = premium_request_id

    if update_fields:
        update_fields["updated_at"] = now_utc()
        update_fields["invoice_backfilled_at"] = now_utc()

    return update_fields


def build_query(tenant_id=None):
    query = {
        "$and": [
            {
                "$or": [
                    {"invoice_number": {"$exists": False}},
                    {"invoice_number": None},
                    {"invoice_number": ""},
                    {"receipt_number": {"$exists": False}},
                    {"receipt_number": None},
                    {"receipt_number": ""},
                    {"invoice_status": {"$exists": False}},
                    {"invoice_date": {"$exists": False}},
                    {"paid_at": {"$exists": False}},
                ]
            },
            {
                "$or": [
                    {"payment_status": {"$in": list(SUCCESS_STATUSES)}},
                    {
                        "payment_details.status": {
                            "$in": list(SUCCESS_STATUSES)
                        }
                    },
                    {"invoice_status": "paid"},
                ]
            },
        ]
    }

    tenant_id = safe_str(tenant_id)

    if tenant_id:
        query["$and"].append({"tenant_id": tenant_id})

    return query


def run_backfill(db, dry_run=False, tenant_id=None, limit=0):
    query = build_query(tenant_id=tenant_id)
    cursor = db.payments.find(query).sort("created_at", 1)

    if limit and limit > 0:
        cursor = cursor.limit(limit)

    report = {
        "dry_run": bool(dry_run),
        "tenant_id": safe_str(tenant_id) or None,
        "limit": int(limit or 0),
        "scanned": 0,
        "eligible": 0,
        "updated": 0,
        "skipped": 0,
        "failed": 0,
        "records": [],
    }

    for payment in cursor:
        report["scanned"] += 1
        payment_id = str(payment.get("_id"))

        if not payment_is_successful(payment):
            report["skipped"] += 1
            continue

        report["eligible"] += 1

        try:
            update_fields = build_update(payment)

            if not update_fields:
                report["skipped"] += 1
                continue

            record_summary = {
                "payment_id": payment_id,
                "tenant_id": safe_str(payment.get("tenant_id")),
                "razorpay_payment_id": safe_str(
                    payment.get("razorpay_payment_id")
                ),
                "invoice_number": update_fields.get(
                    "invoice_number",
                    payment.get("invoice_number"),
                ),
                "receipt_number": update_fields.get(
                    "receipt_number",
                    payment.get("receipt_number"),
                ),
                "fields": sorted(update_fields.keys()),
            }

            if not dry_run:
                result = db.payments.update_one(
                    {"_id": payment["_id"]},
                    {"$set": update_fields},
                )

                if result.modified_count:
                    report["updated"] += 1
                else:
                    report["skipped"] += 1
            else:
                report["updated"] += 1

            report["records"].append(record_summary)
        except Exception as exc:
            report["failed"] += 1
            report["records"].append({
                "payment_id": payment_id,
                "tenant_id": safe_str(payment.get("tenant_id")),
                "error": str(exc),
            })

    report["completed_at"] = now_utc()
    report["ok"] = report["failed"] == 0

    return report


def print_human_report(report):
    mode = "DRY RUN" if report.get("dry_run") else "WRITE"

    print(f"YourComate SaaS invoice backfill: {mode}")
    print(f"Scanned:  {report.get('scanned', 0)}")
    print(f"Eligible: {report.get('eligible', 0)}")
    print(f"Updated:  {report.get('updated', 0)}")
    print(f"Skipped:  {report.get('skipped', 0)}")
    print(f"Failed:   {report.get('failed', 0)}")

    for record in report.get("records", []):
        if record.get("error"):
            print(
                f"ERROR payment={record.get('payment_id')} "
                f"tenant={record.get('tenant_id') or '-'} "
                f"message={record.get('error')}"
            )
            continue

        action = "WOULD UPDATE" if report.get("dry_run") else "UPDATED"
        print(
            f"{action} payment={record.get('payment_id')} "
            f"invoice={record.get('invoice_number') or '-'} "
            f"receipt={record.get('receipt_number') or '-'}"
        )


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Backfill invoice and receipt references for existing "
            "successful YourComate SaaS payments."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview matching updates without changing MongoDB.",
    )
    parser.add_argument(
        "--tenant-id",
        default="",
        help="Restrict the migration to one tenant ID.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of matching payment records to process.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the report as JSON.",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    from app import create_app
    from app.extensions import get_db

    app = create_app()

    with app.app_context():
        report = run_backfill(
            get_db(),
            dry_run=args.dry_run,
            tenant_id=args.tenant_id,
            limit=max(args.limit, 0),
        )

    if args.json:
        print(
            json.dumps(
                serialize_for_json(report),
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print_human_report(report)

    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())