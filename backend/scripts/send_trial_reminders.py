"""Send YourComate HRMS 15-day full-access trial reminders.


Send YourComate HRMS SaaS trial reminder emails and in-app notifications.

Usage from backend folder:

    python scripts/send_trial_reminders.py

Optional:

    python scripts/send_trial_reminders.py --dry-run
    python scripts/send_trial_reminders.py --force
    python scripts/send_trial_reminders.py --json

Recommended cron example, once daily at 09:00:

    0 9 * * * cd /path/to/backend && /path/to/venv/bin/python scripts/send_trial_reminders.py >> logs/trial_reminders.log 2>&1

What this script does:
- Checks active trial companies.
- Sends due reminder emails through SMTP.
- Creates in-app notifications.
- Marks trial companies as expired when trial end date is reached.
- Skips SDS lifetime and paid companies.
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


def now_iso():
    return datetime.now(timezone.utc).isoformat()


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
    Resolves the MongoDB database object from the current project setup.

    This is intentionally defensive because Flask/PyMongo projects can expose
    the database as:
    - app.extensions['pymongo'].db
    - app.extensions['mongo'].db
    - app.extensions.db
    - app.db
    - app.config['MONGO_DB']
    - app.extensions module variables: db or mongo.db
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
            # PyMongo database objects expose collection access using attributes.
            if hasattr(candidate, "tenants") or hasattr(candidate, "users"):
                return candidate
        except Exception:
            pass

        try:
            # Some wrappers expose .db.
            nested = getattr(candidate, "db", None)

            if nested is not None and (hasattr(nested, "tenants") or hasattr(nested, "users")):
                return nested
        except Exception:
            pass

    raise RuntimeError(
        "Unable to resolve MongoDB database object. "
        "Check backend/app/extensions.py and adjust resolve_db() if needed."
    )


def build_parser():
    parser = argparse.ArgumentParser(
        description="Send YourComate HRMS SaaS trial reminders.",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Check due companies without sending emails or creating notifications.",
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help="Send due reminders even if a reminder record already exists.",
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
    from app.services.trial_notification_service import run_trial_notification_job

    app = create_app()

    with app.app_context():
        db = resolve_db(app)

        result = run_trial_notification_job(
            db,
            force=args.force,
            dry_run=args.dry_run,
        )

    clean_result = serialize_for_json(result)

    if args.json:
        print(json.dumps(clean_result, indent=2, ensure_ascii=False))
        return 0

    print("YourComate HRMS SaaS Trial Reminder Job")
    print("---------------------------------------")
    print(f"Checked At       : {clean_result.get('checked_at') or now_iso()}")
    print(f"Checked Companies: {clean_result.get('checked_count', 0)}")
    print(f"Processed        : {clean_result.get('processed_count', 0)}")
    print(f"Skipped          : {clean_result.get('skipped_count', 0)}")
    print(f"Dry Run          : {args.dry_run}")
    print(f"Force            : {args.force}")

    results = clean_result.get("results") or []

    if results:
        print("")
        print("Details:")
        for index, item in enumerate(results, start=1):
            company = item.get("company_name") or item.get("tenant_id") or "Unknown"
            status = "processed" if item.get("processed") else "skipped"
            reason = item.get("reason") or item.get("reminder_type") or ""
            days_left = item.get("days_left")

            days_text = "" if days_left is None else f", days_left={days_left}"

            print(f"{index}. {company}: {status} {reason}{days_text}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())