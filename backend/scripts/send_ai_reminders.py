"""Run the YourComate Saya timed-reminder delivery job.

NEW FILE
Project path:
    backend/scripts/send_ai_reminders.py

Run from the backend folder:

    python scripts/send_ai_reminders.py

Useful diagnostics:

    python scripts/send_ai_reminders.py --dry-run
    python scripts/send_ai_reminders.py --json
    python scripts/send_ai_reminders.py --limit 50
    python scripts/send_ai_reminders.py --tenant-id sds --dry-run

Recommended production cron (every minute):

    * * * * * cd /var/www/sds-hrms/backend && /var/www/sds-hrms/backend/venv/bin/python scripts/send_ai_reminders.py >> logs/saya_reminders.log 2>&1

What this script does:
- Boots the existing Flask application and uses its configured MongoDB database.
- Calls ``app.services.ai_reminder_service.run_ai_reminder_job``.
- Processes reminders whose ``scheduled_at_utc`` is due.
- Relies on the reminder service's atomic claim/lease protection, so overlapping
  cron runs do not deliver the same reminder twice.
- Prints a concise production summary or JSON for diagnostics/monitoring.

This file intentionally does not run a permanent loop and does not start a
background thread inside Gunicorn. Scheduling remains an operating-system job
(cron/systemd timer), keeping web workers stateless and deployment-safe.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def serialize(value: Any) -> Any:
    """Convert Mongo/Python values into JSON-safe output."""

    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, list):
        return [serialize(item) for item in value]

    if isinstance(value, tuple):
        return [serialize(item) for item in value]

    if isinstance(value, dict):
        return {
            str(key): serialize(item)
            for key, item in value.items()
        }

    try:
        from bson import ObjectId

        if isinstance(value, ObjectId):
            return str(value)
    except Exception:
        pass

    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Deliver due YourComate Saya reminders.",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Show due reminders without claiming them, creating notifications, "
            "or sending push notifications."
        ),
    )

    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the complete job result as JSON.",
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help=(
            "Maximum number of due reminders to process in this run. "
            "If omitted, AI_REMINDER_BATCH_SIZE is used."
        ),
    )

    parser.add_argument(
        "--tenant-id",
        default="",
        help=(
            "Optional tenant scope for diagnostics/testing. "
            "Leave empty in normal production cron runs to process all tenants."
        ),
    )

    return parser


def _validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be at least 1.")

    if args.limit is not None and args.limit > 5000:
        parser.error("--limit must not exceed 5000 for a single worker run.")


def _clean_tenant_id(value: Any) -> str:
    tenant_id = str(value or "").strip()

    if len(tenant_id) > 200:
        raise ValueError("Tenant ID is too long.")

    return tenant_id


def _print_summary(result: dict[str, Any], *, tenant_id: str = "") -> None:
    clean = serialize(result or {})

    print("YourComate Saya Reminder Job")
    print("----------------------------")
    print(f"Checked At       : {clean.get('checked_at') or now_utc().isoformat()}")
    print(f"Dry Run          : {bool(clean.get('dry_run'))}")
    print(f"Tenant Scope     : {tenant_id or 'ALL TENANTS'}")

    if clean.get("dry_run"):
        print(f"Due Reminders    : {clean.get('due_count', 0)}")
        print("Processed        : 0")
    else:
        print(f"Processed        : {clean.get('processed_count', 0)}")
        print(f"Delivered        : {clean.get('delivered_count', 0)}")
        print(f"Retry Scheduled  : {clean.get('retry_count', 0)}")
        print(f"Failed           : {clean.get('failed_count', 0)}")
        print(f"Stale Recovered  : {clean.get('recovered_stale_count', 0)}")

    results = clean.get("results") or []
    if not results:
        return

    print("")
    print("Details:")

    for index, item in enumerate(results, start=1):
        reminder_id = item.get("reminder_id") or "unknown"

        if clean.get("dry_run"):
            scheduled = item.get("scheduled_at_utc") or "unknown"
            status = item.get("delivery_status") or "scheduled"
            print(
                f"{index}. reminder={reminder_id}, status={status}, "
                f"scheduled_at_utc={scheduled}"
            )
            continue

        if item.get("delivered"):
            notification_id = item.get("notification_id") or ""
            push_result = item.get("push_result") or {}
            push_sent = push_result.get("sent", 0)
            print(
                f"{index}. reminder={reminder_id}: delivered, "
                f"notification={notification_id or 'created'}, push_sent={push_sent}"
            )
            continue

        status = item.get("delivery_status") or "failed"
        attempts = item.get("attempts") or ""
        error = str(item.get("error") or "Reminder delivery failed.").strip()
        if len(error) > 240:
            error = error[:237] + "..."

        print(
            f"{index}. reminder={reminder_id}: {status}, "
            f"attempts={attempts or '-'}, error={error}"
        )


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    _validate_args(parser, args)

    try:
        tenant_id = _clean_tenant_id(args.tenant_id)
    except ValueError as exc:
        parser.error(str(exc))

    # Match the rest of the project's scheduled scripts. Relative paths in app
    # configuration/logging should resolve from the backend folder.
    os.chdir(BACKEND_DIR)

    try:
        from app import create_app
        from app.extensions import get_db
        from app.services.ai_reminder_service import run_ai_reminder_job

        app = create_app()

        with app.app_context():
            db = get_db()
            result = run_ai_reminder_job(
                db,
                limit=args.limit,
                tenant_id=tenant_id,
                dry_run=bool(args.dry_run),
            )
    except KeyboardInterrupt:
        print("Saya reminder job interrupted.", file=sys.stderr)
        return 130
    except Exception as exc:
        # Keep cron logs useful without printing a full traceback containing
        # environment/configuration details. The Flask app/service logger still
        # records internal delivery exceptions where appropriate.
        error_message = str(exc).strip() or exc.__class__.__name__
        if len(error_message) > 500:
            error_message = error_message[:497] + "..."

        if args.json:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "checked_at": now_utc().isoformat(),
                        "error": error_message,
                        "error_type": exc.__class__.__name__,
                    },
                    indent=2,
                    ensure_ascii=False,
                )
            )
        else:
            print(
                f"Saya reminder job failed: {error_message}",
                file=sys.stderr,
            )

        return 2

    clean_result = serialize(result or {})
    failed_count = int(clean_result.get("failed_count") or 0)

    if args.json:
        output = {
            "ok": failed_count == 0,
            **clean_result,
        }
        print(json.dumps(output, indent=2, ensure_ascii=False))
    else:
        _print_summary(clean_result, tenant_id=tenant_id)

    # A terminal reminder failure should make monitoring notice the run, while
    # normal transient retries remain a successful cron invocation.
    return 1 if failed_count > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
