"""Run all daily YourComate HRMS SaaS maintenance jobs.

NEW FILE
Project path:
    backend/scripts/run_saas_maintenance.py

Run from the backend folder:
    python scripts/run_saas_maintenance.py --dry-run
    python scripts/run_saas_maintenance.py
    python scripts/run_saas_maintenance.py --json
    python scripts/run_saas_maintenance.py --force

Recommended daily cron example (09:00 server time):
    0 9 * * * cd /path/to/backend && /path/to/venv/bin/python scripts/run_saas_maintenance.py >> logs/saas_maintenance.log 2>&1

The command runs:
- 15-day trial reminder and expiry processing.
- Essential, Growth, and Premium renewal reminder and expiry processing.

It does not automatically charge any payment method. Renewals continue through
Billing and the existing Razorpay checkout flow.
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
SCRIPTS_DIR = CURRENT_FILE.parent

for path in (BACKEND_DIR, SCRIPTS_DIR):
    path_text = str(path)
    if path_text not in sys.path:
        sys.path.insert(0, path_text)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def serialize(value: Any) -> Any:
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


def resolve_db(app: Any) -> Any:
    """Resolve the MongoDB database used by the current Flask application."""

    try:
        from app.extensions import get_db

        return get_db()
    except Exception:
        pass

    candidates: list[Any] = []

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
            if hasattr(candidate, "tenants") or hasattr(candidate, "subscriptions"):
                return candidate
        except Exception:
            pass

        try:
            nested = getattr(candidate, "db", None)
            if nested is not None and (
                hasattr(nested, "tenants")
                or hasattr(nested, "subscriptions")
            ):
                return nested
        except Exception:
            pass

    raise RuntimeError("Unable to resolve MongoDB database object.")


def safe_job_result(job_name: str, callback: Any) -> dict[str, Any]:
    """Execute one job and preserve the other job if it fails."""

    started_at = now_utc()

    try:
        result = callback() or {}
        return {
            "ok": True,
            "job": job_name,
            "started_at": started_at,
            "finished_at": now_utc(),
            "result": result,
        }
    except Exception as exc:
        return {
            "ok": False,
            "job": job_name,
            "started_at": started_at,
            "finished_at": now_utc(),
            "error": str(exc),
            "error_type": exc.__class__.__name__,
        }


def run_maintenance(
    app: Any,
    db: Any,
    *,
    dry_run: bool = False,
    force: bool = False,
    run_trials: bool = True,
    run_subscriptions: bool = True,
) -> dict[str, Any]:
    started_at = now_utc()
    jobs: list[dict[str, Any]] = []

    if run_trials:
        from app.services.trial_notification_service import (
            run_trial_notification_job,
        )

        jobs.append(
            safe_job_result(
                "trial_reminders",
                lambda: run_trial_notification_job(
                    db,
                    force=force,
                    dry_run=dry_run,
                ),
            )
        )

    if run_subscriptions:
        from send_subscription_reminders import run_job

        jobs.append(
            safe_job_result(
                "subscription_renewal_reminders",
                lambda: run_job(
                    db,
                    app,
                    dry_run=dry_run,
                    force=force,
                ),
            )
        )

    failed_jobs = [job for job in jobs if not job.get("ok")]

    return {
        "ok": not failed_jobs,
        "started_at": started_at,
        "finished_at": now_utc(),
        "dry_run": dry_run,
        "force": force,
        "job_count": len(jobs),
        "successful_job_count": len(jobs) - len(failed_jobs),
        "failed_job_count": len(failed_jobs),
        "jobs": jobs,
    }


def result_value(job: dict[str, Any], key: str, default: Any = 0) -> Any:
    result = job.get("result") or {}
    return result.get(key, default)


def print_job_summary(job: dict[str, Any]) -> None:
    name = job.get("job") or "unknown"

    if not job.get("ok"):
        print(f"{name}: FAILED")
        print(f"  Error: {job.get('error') or 'Unknown error'}")
        return

    print(f"{name}: OK")
    print(f"  Checked   : {result_value(job, 'checked_count', 0)}")
    print(f"  Processed : {result_value(job, 'processed_count', 0)}")
    print(f"  Skipped   : {result_value(job, 'skipped_count', 0)}")

    if name == "subscription_renewal_reminders":
        print(
            "  Expired   : "
            f"{result_value(job, 'expired_updated_count', 0)}"
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run YourComate HRMS daily SaaS maintenance jobs.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Check due work without sending notifications or updating records.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Process due reminders even if the same reminder was already recorded.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the complete result as JSON.",
    )
    parser.add_argument(
        "--skip-trials",
        action="store_true",
        help="Skip trial reminder and expiry processing.",
    )
    parser.add_argument(
        "--skip-subscriptions",
        action="store_true",
        help="Skip paid-subscription renewal processing.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()

    if args.skip_trials and args.skip_subscriptions:
        print("Nothing to run: both maintenance jobs were skipped.")
        return 2

    os.chdir(BACKEND_DIR)

    from app import create_app

    app = create_app()

    with app.app_context():
        db = resolve_db(app)
        result = run_maintenance(
            app,
            db,
            dry_run=args.dry_run,
            force=args.force,
            run_trials=not args.skip_trials,
            run_subscriptions=not args.skip_subscriptions,
        )

    clean_result = serialize(result)

    if args.json:
        print(json.dumps(clean_result, indent=2, ensure_ascii=False))
    else:
        print("YourComate HRMS SaaS Maintenance")
        print("--------------------------------")
        print(f"Started At       : {clean_result.get('started_at')}")
        print(f"Finished At      : {clean_result.get('finished_at')}")
        print(f"Successful Jobs  : {clean_result.get('successful_job_count', 0)}")
        print(f"Failed Jobs      : {clean_result.get('failed_job_count', 0)}")
        print(f"Dry Run          : {args.dry_run}")
        print(f"Force            : {args.force}")

        for job in clean_result.get("jobs") or []:
            print("")
            print_job_summary(job)

    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())