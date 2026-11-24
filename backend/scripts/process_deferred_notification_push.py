"""Durable, separately run FCM dispatcher for YourComate approval notifications.

Launch with the *same backend virtual environment and .env* as Flask:
    python scripts/process_deferred_notification_push.py --interval 2

Must be running before setting LEAVE_DECISION_DEFER_PUSH=1 in Flask.
No biometric data or leave details are logged.
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

from pymongo import ASCENDING, ReturnDocument

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app  # noqa: E402
from app.extensions import get_db  # noqa: E402
from app.utils.notification_service import (  # noqa: E402
    deliver_deferred_notification,
    _push_status_from_result,
)

log = logging.getLogger("yourcomate.deferred_push")
running = True


def stop(_signum, _frame):
    global running
    running = False


def claim(db, *, lease_seconds=120):
    now = datetime.utcnow()
    return db.notifications.find_one_and_update(
        {
            "deferred_push": True,
            "is_deleted": {"$ne": True},
            "$or": [
                {"push_status": "queued", "next_push_attempt_at": {"$lte": now}},
                {"push_status": "sending", "lease_expires_at": {"$lte": now}},
            ],
        },
        {"$set": {
            "push_status": "sending",
            "lease_expires_at": now + timedelta(seconds=lease_seconds),
            "last_push_attempt_at": now,
            "updated_at": now,
        }},
        sort=[("created_at", ASCENDING)],
        return_document=ReturnDocument.AFTER,
    )


def process_one(db, *, max_attempts=4):
    doc = claim(db)
    if not doc:
        return False
    now = datetime.utcnow()
    attempts = int(doc.get("push_attempt_count") or 0) + 1
    try:
        result = deliver_deferred_notification(db, doc)
        status, delivery, failure = _push_status_from_result(result)
        if status.startswith("skipped_") or status in ("skipped", "sent", "not_sent"):
            final_status = status
        elif status == "failed" and attempts < max_attempts:
            final_status = "queued"
        else:
            final_status = status
        payload = {
            "push_status": final_status,
            "delivery_status": delivery,
            "failure_reason": failure,
            "push_attempt_count": attempts,
            "last_push_attempt_at": now,
            "fcm_sent_at": now,
            "push_sent_at": now if result.get("sent", 0) > 0 else "",
            "device_count": int(result.get("token_count") or 0),
            "fcm_result": result,
            "updated_at": datetime.utcnow(),
        }
    except Exception as exc:
        log.exception("Deferred notification delivery failed id=%s", doc["_id"])
        final_status = "queued" if attempts < max_attempts else "failed"
        payload = {
            "push_status": final_status,
            "delivery_status": "persisted",
            "failure_reason": type(exc).__name__,
            "push_attempt_count": attempts,
            "last_push_attempt_at": now,
            "updated_at": datetime.utcnow(),
        }
    if final_status == "queued":
        # Back off per attempt, avoiding repeated FCM spam on outages.
        payload["next_push_attempt_at"] = datetime.utcnow() + timedelta(seconds=min(120, 5 * 2 ** (attempts - 1)))
    payload["lease_expires_at"] = None
    db.notifications.update_one(
        {"_id": doc["_id"], "push_status": "sending"},
        {"$set": payload},
    )
    log.info("notification_id=%s status=%s attempts=%d", doc["_id"], final_status, attempts)
    return True


def run():
    parser = argparse.ArgumentParser(description="Reliable deferred FCM push dispatcher")
    parser.add_argument("--once", action="store_true", help="Process one batch, then exit")
    parser.add_argument("--check", action="store_true", help="Report queued count, then exit")
    parser.add_argument("--interval", type=float, default=2.0, help="Idle poll interval seconds")
    parser.add_argument("--batch-size", type=int, default=50)
    args = parser.parse_args()
    if not 0.5 <= args.interval <= 300 or not 1 <= args.batch_size <= 500:
        parser.error("Invalid polling interval or batch size")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    # Existing Flask startup initializes the same database and FCM config.
    app = create_app()
    with app.app_context():
        db = get_db()
        # Index is non-unique and intentionally safe to create repeatedly.
        db.notifications.create_index([
            ("deferred_push", ASCENDING),
            ("push_status", ASCENDING),
            ("next_push_attempt_at", ASCENDING),
            ("created_at", ASCENDING),
        ], name="deferred_push_queue_v1")
        if args.check:
            queued = db.notifications.count_documents({"deferred_push": True, "push_status": "queued"})
            print(f"deferred_push_queued={queued}")
            return
        log.info("Deferred FCM worker started")
        while running:
            processed = 0
            for _ in range(args.batch_size):
                if not running or not process_one(db):
                    break
                processed += 1
            if args.once:
                break
            if processed == 0:
                time.sleep(args.interval)
        log.info("Deferred FCM worker stopped")


if __name__ == "__main__":
    run()
