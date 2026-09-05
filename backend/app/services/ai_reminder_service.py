"""Saya timed reminder delivery service for YourComate HRMS.

Project path:
    backend/app/services/ai_reminder_service.py

Purpose:
- Deliver reminders created by Saya after their scheduled UTC time.
- Reuse the existing HRMS `notifications` collection and FCM sender.
- Claim due reminders atomically so overlapping workers do not deliver twice.
- Keep tenant/user scope attached to every reminder delivery.
- Retry transient delivery failures with bounded exponential backoff.
- Remain script-friendly: the caller passes the MongoDB database object.

This service does NOT start a background thread inside Flask/Gunicorn. A small
scheduled script/cron entry should call ``run_ai_reminder_job`` periodically.
That runner is intentionally kept separate so production web workers remain
stateless and duplicate-safe.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo import ReturnDocument

try:
    from flask import current_app, has_app_context
except Exception:  # pragma: no cover - service can also be imported by scripts
    current_app = None

    def has_app_context():
        return False


DEFAULT_BATCH_SIZE = max(int(os.getenv("AI_REMINDER_BATCH_SIZE", "100")), 1)
DEFAULT_MAX_ATTEMPTS = max(int(os.getenv("AI_REMINDER_MAX_ATTEMPTS", "5")), 1)
DEFAULT_STALE_LEASE_MINUTES = max(
    int(os.getenv("AI_REMINDER_STALE_LEASE_MINUTES", "10")),
    1,
)
DEFAULT_RETRY_BASE_SECONDS = max(
    int(os.getenv("AI_REMINDER_RETRY_BASE_SECONDS", "60")),
    15,
)
DEFAULT_RETRY_MAX_SECONDS = max(
    int(os.getenv("AI_REMINDER_RETRY_MAX_SECONDS", "3600")),
    DEFAULT_RETRY_BASE_SECONDS,
)

DUE_DELIVERY_STATUSES = [
    "awaiting_worker",
    "scheduled",
    "queued",
    "retry",
]

FINAL_DELIVERY_STATUSES = {
    "delivered",
    "cancelled",
    "failed",
}


class AiReminderDeliveryError(RuntimeError):
    """Raised when a reminder cannot be persisted/delivered safely."""


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def safe_str(value: Any) -> str:
    return str(value or "").strip()


def _logger():
    if not has_app_context():
        return None

    try:
        return current_app.logger
    except Exception:
        return None


def _log_info(message: str, *args: Any) -> None:
    logger = _logger()
    if logger is not None:
        logger.info(message, *args)


def _log_exception(message: str, error: Exception) -> None:
    logger = _logger()
    if logger is not None:
        logger.exception("%s: %s", message, error)


def _reminder_id(reminder: dict[str, Any] | None) -> str:
    reminder = reminder or {}
    return safe_str(reminder.get("_id") or reminder.get("id"))


def _tenant_id(reminder: dict[str, Any] | None) -> str:
    reminder = reminder or {}
    return safe_str(
        reminder.get("tenant_id")
        or reminder.get("company_id")
        or reminder.get("tenant")
    )


def _user_id(reminder: dict[str, Any] | None) -> str:
    reminder = reminder or {}
    return safe_str(
        reminder.get("user_id")
        or reminder.get("recipient_id")
        or reminder.get("employee_user_id")
        or reminder.get("created_by")
    )


def _reminder_text(reminder: dict[str, Any] | None) -> str:
    reminder = reminder or {}
    return safe_str(
        reminder.get("reminder_text")
        or reminder.get("message")
        or reminder.get("title")
        or "Your scheduled reminder is due."
    )


def _reminder_title(reminder: dict[str, Any] | None) -> str:
    reminder = reminder or {}
    title = safe_str(reminder.get("title"))
    if not title or title.lower() == "saya reminder":
        return "Saya Reminder"
    return title[:160]


def _retry_delay_seconds(attempt_number: int) -> int:
    # 1m, 2m, 4m, 8m... up to the configured ceiling.
    exponent = max(int(attempt_number or 1) - 1, 0)
    delay = DEFAULT_RETRY_BASE_SECONDS * (2**exponent)
    return min(delay, DEFAULT_RETRY_MAX_SECONDS)


def ensure_ai_reminder_indexes(db: Any) -> None:
    """Create non-destructive indexes used by the reminder worker."""

    try:
        db.ai_reminders.create_index(
            [
                ("delivery_status", 1),
                ("scheduled_at_utc", 1),
                ("next_attempt_at", 1),
            ],
            name="saya_reminder_due_lookup",
        )
        db.ai_reminders.create_index(
            [("tenant_id", 1), ("user_id", 1), ("created_at", -1)],
            name="saya_reminder_user_lookup",
        )
    except Exception as exc:
        # Index creation should never stop a due reminder from being processed.
        _log_exception("Saya reminder index creation failed", exc)


def _base_due_query(reference_time: datetime, tenant_id: str = "") -> dict[str, Any]:
    query: dict[str, Any] = {
        "is_deleted": {"$ne": True},
        "is_completed": {"$ne": True},
        "status": {"$nin": ["cancelled", "completed", "failed"]},
        "delivery_status": {"$in": DUE_DELIVERY_STATUSES},
        "scheduled_at_utc": {"$lte": reference_time},
        "$or": [
            {"next_attempt_at": {"$exists": False}},
            {"next_attempt_at": None},
            {"next_attempt_at": {"$lte": reference_time}},
        ],
    }

    tenant_id = safe_str(tenant_id)
    if tenant_id:
        query["tenant_id"] = tenant_id

    return query


def recover_stale_ai_reminder_claims(
    db: Any,
    *,
    reference_time: datetime | None = None,
) -> int:
    """Release reminders left in processing after a crashed worker."""

    reference_time = reference_time or now_utc()
    stale_before = reference_time - timedelta(minutes=DEFAULT_STALE_LEASE_MINUTES)

    result = db.ai_reminders.update_many(
        {
            "delivery_status": "processing",
            "processing_started_at": {"$lte": stale_before},
            "is_completed": {"$ne": True},
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "delivery_status": "retry",
                "next_attempt_at": reference_time,
                "updated_at": reference_time,
                "last_delivery_error": "Previous reminder worker lease expired before completion.",
            },
            "$unset": {
                "processing_token": "",
                "processing_started_at": "",
            },
        },
    )

    return int(result.modified_count or 0)


def _claim_one_due_reminder(
    db: Any,
    *,
    reference_time: datetime,
    tenant_id: str = "",
) -> dict[str, Any] | None:
    token = uuid.uuid4().hex
    query = _base_due_query(reference_time, tenant_id=tenant_id)

    reminder = db.ai_reminders.find_one_and_update(
        query,
        {
            "$set": {
                "delivery_status": "processing",
                "processing_token": token,
                "processing_started_at": reference_time,
                "last_delivery_attempt_at": reference_time,
                "updated_at": reference_time,
            },
            "$inc": {"delivery_attempts": 1},
        },
        sort=[("scheduled_at_utc", 1), ("created_at", 1)],
        return_document=ReturnDocument.AFTER,
    )

    return reminder


def _notification_event_key(reminder: dict[str, Any]) -> str:
    return f"ai_reminder:{_reminder_id(reminder)}"


def _create_in_app_notification(
    db: Any,
    reminder: dict[str, Any],
    *,
    delivered_at: datetime,
) -> tuple[str, bool]:
    """Upsert one reminder notification and return (id, newly_created)."""

    reminder_id = _reminder_id(reminder)
    tenant_id = _tenant_id(reminder)
    user_id = _user_id(reminder)
    body = _reminder_text(reminder)
    title = _reminder_title(reminder)

    if not reminder_id:
        raise AiReminderDeliveryError("Reminder record does not have a valid identifier.")
    if not tenant_id:
        raise AiReminderDeliveryError("Reminder tenant scope is missing.")
    if not user_id:
        raise AiReminderDeliveryError("Reminder recipient is missing.")

    event_key = _notification_event_key(reminder)
    notification_doc = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "recipient_id": user_id,
        "title": title,
        "body": body,
        "message": body,
        "notification_type": "ai_reminder",
        "type": "ai_reminder",
        "priority": "normal",
        "target": "notifications",
        "target_scope": "selected_users",
        "audience": "selected_users",
        "show_popup": True,
        "popup_seen": False,
        "read": False,
        "is_read": False,
        "status": "unread",
        "event_key": event_key,
        "source": "ai_assistant",
        "source_id": reminder_id,
        "created_at": delivered_at,
        "updated_at": delivered_at,
        "created_by": safe_str(reminder.get("created_by") or user_id),
        "created_by_name": "Saya",
        "created_by_role": ["ai_assistant"],
        "is_deleted": False,
        "meta": {
            "event_key": event_key,
            "ai_reminder": True,
            "ai_reminder_id": reminder_id,
            "notification_type": "ai_reminder",
            "target": "notifications",
            "page": "notifications",
            "recipient_user_id": user_id,
            "tenant_id": tenant_id,
            "scheduled_at_utc": reminder.get("scheduled_at_utc"),
            "timezone": safe_str(reminder.get("timezone")),
            "reminder_time_text": safe_str(reminder.get("reminder_time_text")),
        },
    }

    result = db.notifications.update_one(
        {
            "user_id": user_id,
            "tenant_id": tenant_id,
            "$or": [
                {"event_key": event_key},
                {"meta.event_key": event_key},
                {"meta.ai_reminder_id": reminder_id},
            ],
            "is_deleted": {"$ne": True},
        },
        {"$setOnInsert": notification_doc},
        upsert=True,
    )

    if result.upserted_id is not None:
        return str(result.upserted_id), True

    existing = db.notifications.find_one(
        {
            "user_id": user_id,
            "tenant_id": tenant_id,
            "$or": [
                {"event_key": event_key},
                {"meta.event_key": event_key},
                {"meta.ai_reminder_id": reminder_id},
            ],
            "is_deleted": {"$ne": True},
        },
        {"_id": 1},
    )

    return safe_str((existing or {}).get("_id")), False


def _send_existing_fcm_push(
    db: Any,
    reminder: dict[str, Any],
) -> dict[str, Any]:
    """Use the HRMS notification device/FCM pipeline already used elsewhere."""

    tenant_id = _tenant_id(reminder)
    user_id = _user_id(reminder)
    reminder_id = _reminder_id(reminder)

    if not user_id:
        return {
            "sent": 0,
            "failed": 0,
            "skipped": True,
            "reason": "recipient_missing",
        }

    try:
        # Lazy import avoids coupling application startup to this background
        # service and reuses the project's existing device-token resolution.
        from app.routes.workflow import send_fcm_to_users

        return send_fcm_to_users(
            db,
            [user_id],
            _reminder_title(reminder),
            _reminder_text(reminder),
            meta={
                "target": "notifications",
                "page": "notifications",
                "notification_type": "ai_reminder",
                "type": "ai_reminder",
                "priority": "normal",
                "source_id": reminder_id,
                "link_id": reminder_id,
                "link_type": "ai_reminder",
                "tenant_id": tenant_id,
                "ai_reminder": True,
            },
            tenant_id=tenant_id,
        )
    except Exception as exc:
        _log_exception("Saya reminder FCM delivery failed", exc)
        return {
            "sent": 0,
            "failed": 1,
            "skipped": True,
            "reason": "fcm_exception",
            "error": str(exc)[:300],
        }


def _finish_delivery_success(
    db: Any,
    reminder: dict[str, Any],
    *,
    delivered_at: datetime,
    notification_id: str,
    notification_created: bool,
    push_result: dict[str, Any],
) -> bool:
    reminder_id = reminder.get("_id")
    token = safe_str(reminder.get("processing_token"))

    result = db.ai_reminders.update_one(
        {
            "_id": reminder_id,
            "processing_token": token,
            "delivery_status": "processing",
        },
        {
            "$set": {
                "delivery_status": "delivered",
                "status": "completed",
                "is_completed": True,
                "completed_at": delivered_at,
                "delivered_at": delivered_at,
                "notification_id": notification_id,
                "notification_created": bool(notification_created),
                "push_result": push_result or {},
                "updated_at": delivered_at,
                "last_delivery_error": "",
            },
            "$unset": {
                "processing_token": "",
                "processing_started_at": "",
                "next_attempt_at": "",
            },
        },
    )

    return bool(result.modified_count)


def _finish_delivery_failure(
    db: Any,
    reminder: dict[str, Any],
    error: Exception,
    *,
    reference_time: datetime,
) -> dict[str, Any]:
    reminder_id = reminder.get("_id")
    token = safe_str(reminder.get("processing_token"))
    attempts = max(int(reminder.get("delivery_attempts") or 1), 1)
    terminal = attempts >= DEFAULT_MAX_ATTEMPTS
    message = safe_str(error)[:500] or "Reminder delivery failed."

    set_values: dict[str, Any] = {
        "delivery_status": "failed" if terminal else "retry",
        "status": "failed" if terminal else "scheduled",
        "updated_at": reference_time,
        "last_delivery_error": message,
        "last_delivery_failed_at": reference_time,
    }

    if terminal:
        set_values["failed_at"] = reference_time
    else:
        set_values["next_attempt_at"] = reference_time + timedelta(
            seconds=_retry_delay_seconds(attempts)
        )

    db.ai_reminders.update_one(
        {
            "_id": reminder_id,
            "processing_token": token,
            "delivery_status": "processing",
        },
        {
            "$set": set_values,
            "$unset": {
                "processing_token": "",
                "processing_started_at": "",
            },
        },
    )

    return {
        "reminder_id": _reminder_id(reminder),
        "delivered": False,
        "terminal": terminal,
        "attempts": attempts,
        "delivery_status": set_values["delivery_status"],
        "next_attempt_at": set_values.get("next_attempt_at"),
        "error": message,
    }


def deliver_claimed_ai_reminder(
    db: Any,
    reminder: dict[str, Any],
    *,
    reference_time: datetime | None = None,
) -> dict[str, Any]:
    """Deliver an already-claimed reminder exactly once at the DB layer."""

    reference_time = reference_time or now_utc()
    reminder_id = _reminder_id(reminder)

    if not reminder_id:
        raise AiReminderDeliveryError("Claimed reminder is missing its identifier.")

    try:
        notification_id, notification_created = _create_in_app_notification(
            db,
            reminder,
            delivered_at=reference_time,
        )

        # Push is best-effort. The in-app notification is the durable delivery
        # record; users without an active FCM token still receive the reminder
        # in YourComate Notifications the next time they open the app/web UI.
        push_result = _send_existing_fcm_push(db, reminder)

        updated = _finish_delivery_success(
            db,
            reminder,
            delivered_at=reference_time,
            notification_id=notification_id,
            notification_created=notification_created,
            push_result=push_result,
        )

        if not updated:
            raise AiReminderDeliveryError(
                "Reminder processing lease was lost before delivery completion."
            )

        return {
            "reminder_id": reminder_id,
            "delivered": True,
            "delivery_status": "delivered",
            "notification_id": notification_id,
            "notification_created": notification_created,
            "push_result": push_result,
            "delivered_at": reference_time,
        }
    except Exception as exc:
        _log_exception(f"Saya reminder {reminder_id} delivery failed", exc)
        return _finish_delivery_failure(
            db,
            reminder,
            exc,
            reference_time=reference_time,
        )


def due_ai_reminder_count(
    db: Any,
    *,
    reference_time: datetime | None = None,
    tenant_id: str = "",
) -> int:
    reference_time = reference_time or now_utc()
    return int(
        db.ai_reminders.count_documents(
            _base_due_query(reference_time, tenant_id=tenant_id)
        )
    )


def _dry_run_due_reminders(
    db: Any,
    *,
    reference_time: datetime,
    tenant_id: str,
    limit: int,
) -> list[dict[str, Any]]:
    cursor = (
        db.ai_reminders.find(
            _base_due_query(reference_time, tenant_id=tenant_id),
            {
                "tenant_id": 1,
                "user_id": 1,
                "employee_id": 1,
                "reminder_text": 1,
                "scheduled_at_utc": 1,
                "delivery_status": 1,
                "delivery_attempts": 1,
            },
        )
        .sort([("scheduled_at_utc", 1), ("created_at", 1)])
        .limit(limit)
    )

    return [
        {
            "reminder_id": _reminder_id(item),
            "tenant_id": _tenant_id(item),
            "user_id": _user_id(item),
            "reminder_text": _reminder_text(item),
            "scheduled_at_utc": item.get("scheduled_at_utc"),
            "delivery_status": safe_str(item.get("delivery_status")),
            "delivery_attempts": int(item.get("delivery_attempts") or 0),
        }
        for item in cursor
    ]


def run_ai_reminder_job(
    db: Any,
    *,
    limit: int | None = None,
    tenant_id: str = "",
    dry_run: bool = False,
    reference_time: datetime | None = None,
) -> dict[str, Any]:
    """Process due Saya reminders.

    Expected production usage is a cron/systemd timer that calls this function
    every minute through a small script. The worker can safely overlap because
    each reminder is atomically leased before delivery.
    """

    reference_time = reference_time or now_utc()
    limit = max(int(limit or DEFAULT_BATCH_SIZE), 1)
    tenant_id = safe_str(tenant_id)

    ensure_ai_reminder_indexes(db)

    if dry_run:
        due = _dry_run_due_reminders(
            db,
            reference_time=reference_time,
            tenant_id=tenant_id,
            limit=limit,
        )
        return {
            "checked_at": reference_time,
            "dry_run": True,
            "tenant_id": tenant_id,
            "due_count": len(due),
            "processed_count": 0,
            "delivered_count": 0,
            "retry_count": 0,
            "failed_count": 0,
            "recovered_stale_count": 0,
            "results": due,
        }

    recovered_stale_count = recover_stale_ai_reminder_claims(
        db,
        reference_time=reference_time,
    )

    results: list[dict[str, Any]] = []

    for _ in range(limit):
        reminder = _claim_one_due_reminder(
            db,
            reference_time=reference_time,
            tenant_id=tenant_id,
        )

        if not reminder:
            break

        results.append(
            deliver_claimed_ai_reminder(
                db,
                reminder,
                reference_time=reference_time,
            )
        )

    delivered_count = sum(1 for item in results if item.get("delivered"))
    retry_count = sum(
        1
        for item in results
        if item.get("delivery_status") == "retry"
    )
    failed_count = sum(
        1
        for item in results
        if item.get("delivery_status") == "failed"
    )

    _log_info(
        "Saya reminder job processed=%s delivered=%s retry=%s failed=%s stale_recovered=%s",
        len(results),
        delivered_count,
        retry_count,
        failed_count,
        recovered_stale_count,
    )

    return {
        "checked_at": reference_time,
        "dry_run": False,
        "tenant_id": tenant_id,
        "processed_count": len(results),
        "delivered_count": delivered_count,
        "retry_count": retry_count,
        "failed_count": failed_count,
        "recovered_stale_count": recovered_stale_count,
        "results": results,
    }
