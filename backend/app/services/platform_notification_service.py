"""
Platform Superadmin notification service for YourComate HRMS.

BRAND-NEW FILE
Project path:
    backend/app/services/platform_notification_service.py

Purpose:
- Discover all active Platform Superadmin users.
- Create notifications in the existing `notifications` collection.
- Keep the same schema already used by workflow.py, web and Flutter.
- Prevent duplicate notifications through stable event keys.
- Deliver FCM push notifications through the existing workflow FCM helper.
- Work from Flask routes and scheduled maintenance scripts.

This file does not register a new Blueprint and does not replace workflow.py.
Routes/scripts call the event helpers from this service.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from flask import (
    current_app,
    g,
    has_app_context,
    has_request_context,
)


PLATFORM_ROLE_VALUES = {
    "super_admin",
    "superadmin",
    "super-admin",
    "super admin",
}

DEFAULT_PLATFORM_TENANT_ID = "sds"


class PlatformNotificationServiceError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "platform_notification_error",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def safe_str(value: Any) -> str:
    return str(value or "").strip()


def normalized_role(value: Any) -> str:
    return (
        safe_str(value)
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def normalized_roles(user: dict[str, Any] | None) -> set[str]:
    user = user or {}
    values: list[Any] = [
        user.get("role"),
        user.get("primary_role"),
    ]

    raw_roles = user.get("roles")

    if isinstance(raw_roles, (list, tuple, set)):
        values.extend(raw_roles)
    elif raw_roles:
        values.extend(
            safe_str(raw_roles)
            .replace(";", ",")
            .split(",")
        )

    return {
        normalized_role(value)
        for value in values
        if normalized_role(value)
    }


def is_platform_superadmin(user: dict[str, Any] | None) -> bool:
    return "super_admin" in normalized_roles(user)


def user_is_active(user: dict[str, Any] | None) -> bool:
    user = user or {}

    if user.get("is_deleted") is True:
        return False

    if user.get("is_active") is False:
        return False

    if user.get("active") is False:
        return False

    if user.get("is_disabled") is True:
        return False

    status = safe_str(user.get("status")).lower()

    return status not in {
        "inactive",
        "disabled",
        "deleted",
        "blocked",
    }


def platform_superadmin_query() -> dict[str, Any]:
    role_values = list(PLATFORM_ROLE_VALUES)

    return {
        "is_deleted": {"$ne": True},
        "is_active": {"$ne": False},
        "active": {"$ne": False},
        "is_disabled": {"$ne": True},
        "status": {
            "$nin": [
                "inactive",
                "Inactive",
                "disabled",
                "Disabled",
                "deleted",
                "Deleted",
                "blocked",
                "Blocked",
            ]
        },
        "$or": [
            {"role": {"$in": role_values}},
            {"primary_role": {"$in": role_values}},
            {"roles": {"$in": role_values}},
        ],
    }


def platform_user_projection() -> dict[str, int]:
    return {
        "_id": 1,
        "id": 1,
        "tenant_id": 1,
        "name": 1,
        "full_name": 1,
        "display_name": 1,
        "email": 1,
        "official_email": 1,
        "username": 1,
        "role": 1,
        "primary_role": 1,
        "roles": 1,
        "is_active": 1,
        "active": 1,
        "is_disabled": 1,
        "is_deleted": 1,
        "status": 1,
    }


def get_platform_superadmins(db: Any) -> list[dict[str, Any]]:
    users = list(
        db.users.find(
            platform_superadmin_query(),
            platform_user_projection(),
        ).limit(500)
    )

    # Defensive filtering supports historical role values not matched by the
    # Mongo query due to inconsistent casing or separators.
    active_users = [
        user
        for user in users
        if user_is_active(user)
        and is_platform_superadmin(user)
    ]

    # Fallback scan is intentionally limited. It helps older projects where
    # role values were stored with inconsistent casing.
    if not active_users:
        fallback = list(
            db.users.find(
                {
                    "is_deleted": {"$ne": True},
                    "is_active": {"$ne": False},
                    "is_disabled": {"$ne": True},
                },
                platform_user_projection(),
            ).limit(5000)
        )

        active_users = [
            user
            for user in fallback
            if user_is_active(user)
            and is_platform_superadmin(user)
        ]

    unique: dict[str, dict[str, Any]] = {}

    for user in active_users:
        user_id = recipient_user_id(user)

        if user_id:
            unique[user_id] = user

    return list(unique.values())


def recipient_user_id(user: dict[str, Any] | None) -> str:
    user = user or {}

    return safe_str(
        user.get("_id")
        or user.get("id")
        or user.get("user_id")
        or user.get("email")
        or user.get("username")
    )


def recipient_name(user: dict[str, Any] | None) -> str:
    user = user or {}

    return safe_str(
        user.get("name")
        or user.get("full_name")
        or user.get("display_name")
        or user.get("email")
        or "Platform Superadmin"
    )


def recipient_email(user: dict[str, Any] | None) -> str:
    user = user or {}

    return safe_str(
        user.get("email")
        or user.get("official_email")
        or user.get("username")
    ).lower()


def recipient_tenant_id(user: dict[str, Any] | None) -> str:
    user = user or {}

    return (
        safe_str(user.get("tenant_id"))
        or DEFAULT_PLATFORM_TENANT_ID
    )


def record_id(record: dict[str, Any] | None) -> str:
    record = record or {}

    return safe_str(
        record.get("_id")
        or record.get("id")
        or record.get("request_id")
        or record.get("payment_id")
        or record.get("order_id")
        or record.get("tenant_id")
    )


def company_name(record: dict[str, Any] | None) -> str:
    record = record or {}

    return safe_str(
        record.get("company_name")
        or record.get("tenant_name")
        or record.get("name")
        or "Company"
    )


def company_email(record: dict[str, Any] | None) -> str:
    record = record or {}

    return safe_str(
        record.get("company_email")
        or record.get("contact_email")
        or record.get("email")
    ).lower()


def source_tenant_id(record: dict[str, Any] | None) -> str:
    record = record or {}

    return safe_str(
        record.get("tenant_id")
        or record.get("company_id")
        or record.get("tenant_code")
    )


def _request_actor() -> tuple[str, str]:
    if not has_request_context():
        return "system", "System"

    user = getattr(g, "current_user", {}) or {}

    actor_id = safe_str(
        user.get("_id")
        or user.get("id")
        or user.get("email")
        or "system"
    )
    actor_name = safe_str(
        user.get("name")
        or user.get("full_name")
        or user.get("email")
        or "System"
    )

    return actor_id, actor_name


def _logger() -> Any | None:
    if not has_app_context():
        return None

    try:
        return current_app.logger
    except Exception:
        return None


def _log_exception(message: str, error: Exception) -> None:
    logger = _logger()

    if logger is not None:
        logger.exception("%s: %s", message, error)


def _event_key(
    event_type: str,
    source_id: str = "",
    suffix: str = "",
) -> str:
    parts = [
        normalized_role(event_type),
        safe_str(source_id),
        safe_str(suffix),
    ]

    return ":".join(
        part
        for part in parts
        if part
    )


def _dedupe_query(
    *,
    user_id: str,
    event_key: str,
    dedupe_window_hours: int | None,
) -> dict[str, Any]:
    query: dict[str, Any] = {
        "user_id": user_id,
        "is_deleted": {"$ne": True},
        "$or": [
            {"event_key": event_key},
            {"meta.event_key": event_key},
        ],
    }

    if dedupe_window_hours is not None:
        hours = max(int(dedupe_window_hours), 1)
        query["created_at"] = {
            "$gte": now_utc() - timedelta(hours=hours)
        }

    return query


def _notification_doc(
    *,
    user: dict[str, Any],
    title: str,
    body: str,
    notification_type: str,
    priority: str,
    target: str,
    event_key: str,
    source: str,
    source_id: str,
    source_tenant: str,
    source_company_name: str,
    source_company_email: str,
    show_popup: bool,
    actor_id: str,
    actor_name: str,
    meta: dict[str, Any],
) -> dict[str, Any]:
    created_at = now_utc()
    user_id = recipient_user_id(user)
    platform_tenant_id = recipient_tenant_id(user)

    merged_meta = {
        **meta,
        "platform_notification": True,
        "event_key": event_key,
        "source": source,
        "source_id": source_id,
        "target": target,
        "page": target,
        "target_scope": "platform_superadmins",
        "audience": "platform_superadmins",
        "source_tenant_id": source_tenant,
        "company_name": source_company_name,
        "company_email": source_company_email,
        "recipient_user_id": user_id,
        "recipient_name": recipient_name(user),
        "recipient_email": recipient_email(user),
        "recipient_tenant_id": platform_tenant_id,
    }

    return {
        "tenant_id": platform_tenant_id,
        "tenant_name": "YourComate Platform",
        "target_tenant_id": source_tenant or platform_tenant_id,
        "target_tenant_name": (
            source_company_name
            or source_tenant
            or "YourComate Platform"
        ),
        "user_id": user_id,
        "user_ids": [user_id],
        "title": safe_str(title) or "Platform action required",
        "body": safe_str(body),
        "message": safe_str(body),
        "notification_type": (
            safe_str(notification_type)
            or "platform_action"
        ),
        "priority": safe_str(priority).lower() or "normal",
        "target": safe_str(target) or "notifications",
        "target_scope": "platform_superadmins",
        "audience": "platform_superadmins",
        "show_popup": bool(show_popup),
        "popup_seen": False,
        "popup_seen_at": "",
        "read": False,
        "status": "unread",
        "event_key": event_key,
        "source": source,
        "source_id": source_id,
        "created_at": created_at,
        "updated_at": created_at,
        "created_by": actor_id or "system",
        "created_by_name": actor_name or "System",
        "created_by_role": ["system"],
        "is_deleted": False,
        "meta": merged_meta,
    }


def _send_fcm(
    db: Any,
    *,
    users: list[dict[str, Any]],
    title: str,
    body: str,
    notification_type: str,
    priority: str,
    target: str,
    source_id: str,
    event_key: str,
) -> dict[str, Any]:
    grouped: dict[str, list[str]] = defaultdict(list)

    for user in users:
        user_id = recipient_user_id(user)

        if user_id:
            grouped[recipient_tenant_id(user)].append(user_id)

    combined = {
        "sent": 0,
        "failed": 0,
        "token_count": 0,
        "user_count": 0,
        "groups": [],
    }

    if not grouped:
        combined["skipped"] = True
        combined["reason"] = "no_recipients"
        return combined

    try:
        # Lazy import avoids a route/service import cycle during Flask startup.
        from app.routes.workflow import send_fcm_to_users
    except Exception as exc:
        _log_exception(
            "Unable to import workflow FCM helper",
            exc,
        )
        combined["skipped"] = True
        combined["reason"] = "fcm_helper_unavailable"
        combined["error"] = str(exc)
        return combined

    for tenant_id, user_ids in grouped.items():
        try:
            result = send_fcm_to_users(
                db,
                user_ids,
                title,
                body,
                meta={
                    "platform_notification": True,
                    "notification_type": notification_type,
                    "priority": priority,
                    "target": target,
                    "page": target,
                    "source_id": source_id,
                    "event_key": event_key,
                    "link_id": source_id,
                    "link_type": notification_type,
                },
                tenant_id=tenant_id,
            )
        except Exception as exc:
            _log_exception(
                "Platform Superadmin FCM delivery failed",
                exc,
            )
            result = {
                "sent": 0,
                "failed": len(user_ids),
                "skipped": False,
                "reason": "exception",
                "error": str(exc),
                "user_count": len(user_ids),
                "tenant_id": tenant_id,
            }

        combined["sent"] += int(result.get("sent") or 0)
        combined["failed"] += int(result.get("failed") or 0)
        combined["token_count"] += int(
            result.get("token_count") or 0
        )
        combined["user_count"] += len(user_ids)
        combined["groups"].append(result)

    combined["skipped"] = all(
        bool(group.get("skipped"))
        for group in combined["groups"]
    )

    return combined


def notify_platform_superadmins(
    db: Any,
    *,
    title: str,
    body: str,
    notification_type: str,
    priority: str = "high",
    target: str = "notifications",
    event_key: str = "",
    source: str = "system",
    source_id: str = "",
    tenant_id: str = "",
    tenant_name: str = "",
    tenant_email: str = "",
    meta: dict[str, Any] | None = None,
    show_popup: bool = True,
    actor_id: str = "",
    actor_name: str = "",
    force: bool = False,
    dedupe_window_hours: int | None = None,
    send_push: bool = True,
) -> dict[str, Any]:
    """
    Create one notification per active Platform Superadmin.

    Stable event_key values prevent duplicate records. Set force=True only when
    the same event must intentionally be sent again.
    """

    title = safe_str(title)
    body = safe_str(body)

    if not title:
        raise PlatformNotificationServiceError(
            "Notification title is required.",
            code="notification_title_required",
        )

    if not body:
        raise PlatformNotificationServiceError(
            "Notification message is required.",
            code="notification_message_required",
        )

    users = get_platform_superadmins(db)

    if not users:
        return {
            "ok": True,
            "recipient_count": 0,
            "created_count": 0,
            "duplicate_count": 0,
            "notification_ids": [],
            "fcm_result": {
                "sent": 0,
                "failed": 0,
                "skipped": True,
                "reason": "no_platform_superadmins",
            },
        }

    if not actor_id or not actor_name:
        request_actor_id, request_actor_name = _request_actor()
        actor_id = actor_id or request_actor_id
        actor_name = actor_name or request_actor_name

    source_id = safe_str(source_id)
    event_key = safe_str(event_key) or _event_key(
        notification_type,
        source_id,
    )
    meta = dict(meta or {})

    inserted_ids = []
    inserted_users = []
    duplicate_count = 0

    for user in users:
        user_id = recipient_user_id(user)

        if not user_id:
            continue

        doc = _notification_doc(
            user=user,
            title=title,
            body=body,
            notification_type=notification_type,
            priority=priority,
            target=target,
            event_key=event_key,
            source=source,
            source_id=source_id,
            source_tenant=safe_str(tenant_id),
            source_company_name=safe_str(tenant_name),
            source_company_email=safe_str(tenant_email),
            show_popup=show_popup,
            actor_id=actor_id,
            actor_name=actor_name,
            meta=meta,
        )

        if force or not event_key:
            result = db.notifications.insert_one(doc)
            inserted_ids.append(result.inserted_id)
            inserted_users.append(user)
            continue

        query = _dedupe_query(
            user_id=user_id,
            event_key=event_key,
            dedupe_window_hours=dedupe_window_hours,
        )

        result = db.notifications.update_one(
            query,
            {"$setOnInsert": doc},
            upsert=True,
        )

        if result.upserted_id is None:
            duplicate_count += 1
            continue

        inserted_ids.append(result.upserted_id)
        inserted_users.append(user)

    fcm_result: dict[str, Any]

    if send_push and inserted_users:
        fcm_result = _send_fcm(
            db,
            users=inserted_users,
            title=title,
            body=body,
            notification_type=notification_type,
            priority=priority,
            target=target,
            source_id=source_id,
            event_key=event_key,
        )
    else:
        fcm_result = {
            "sent": 0,
            "failed": 0,
            "skipped": True,
            "reason": (
                "push_disabled"
                if not send_push
                else "no_new_notifications"
            ),
        }

    if inserted_ids:
        db.notifications.update_many(
            {"_id": {"$in": inserted_ids}},
            {
                "$set": {
                    "fcm_result": fcm_result,
                    "fcm_sent_at": now_utc(),
                    "updated_at": now_utc(),
                }
            },
        )

    return {
        "ok": True,
        "event_key": event_key,
        "recipient_count": len(users),
        "created_count": len(inserted_ids),
        "duplicate_count": duplicate_count,
        "notification_ids": [
            str(item)
            for item in inserted_ids
        ],
        "fcm_result": fcm_result,
    }


# -----------------------------------------------------------------------------
# Event-specific helpers
# -----------------------------------------------------------------------------


def notify_trial_request_received(
    db: Any,
    request_doc: dict[str, Any],
) -> dict[str, Any]:
    request_id = record_id(request_doc)
    company = company_name(request_doc)

    return notify_platform_superadmins(
        db,
        title="New trial request received",
        body=(
            f"{company} submitted a new YourComate trial request. "
            "Review the company details and OTP status."
        ),
        notification_type="platform_trial_request",
        priority="high",
        target="demo_requests",
        event_key=_event_key(
            "trial_request_received",
            request_id,
        ),
        source="demo_requests",
        source_id=request_id,
        tenant_id=source_tenant_id(request_doc),
        tenant_name=company,
        tenant_email=company_email(request_doc),
        meta={
            "request_id": request_id,
            "request_status": request_doc.get("status"),
            "otp_verified": bool(
                request_doc.get("otp_verified")
            ),
        },
    )


def notify_trial_request_ready_for_review(
    db: Any,
    request_doc: dict[str, Any],
) -> dict[str, Any]:
    request_id = record_id(request_doc)
    company = company_name(request_doc)

    return notify_platform_superadmins(
        db,
        title="Trial request ready for approval",
        body=(
            f"{company} completed email verification. "
            "Superadmin approval or rejection is now required."
        ),
        notification_type="platform_trial_approval",
        priority="urgent",
        target="demo_requests",
        event_key=_event_key(
            "trial_request_ready",
            request_id,
        ),
        source="demo_requests",
        source_id=request_id,
        tenant_id=source_tenant_id(request_doc),
        tenant_name=company,
        tenant_email=company_email(request_doc),
        meta={
            "request_id": request_id,
            "request_status": request_doc.get("status"),
            "otp_verified": True,
        },
    )


def notify_trial_delivery_failure(
    db: Any,
    request_doc: dict[str, Any],
    *,
    delivery_type: str,
    failure_message: str = "",
) -> dict[str, Any]:
    request_id = record_id(request_doc)
    company = company_name(request_doc)
    delivery_label = (
        safe_str(delivery_type)
        .replace("_", " ")
        .strip()
        or "email"
    )

    return notify_platform_superadmins(
        db,
        title="Trial email delivery requires attention",
        body=(
            f"{company}: {delivery_label} delivery was not confirmed."
            + (
                f" {safe_str(failure_message)}"
                if safe_str(failure_message)
                else ""
            )
        ),
        notification_type="platform_trial_email_failure",
        priority="urgent",
        target="demo_requests",
        event_key=_event_key(
            "trial_delivery_failure",
            request_id,
            normalized_role(delivery_type),
        ),
        source="demo_requests",
        source_id=request_id,
        tenant_id=source_tenant_id(request_doc),
        tenant_name=company,
        tenant_email=company_email(request_doc),
        meta={
            "request_id": request_id,
            "delivery_type": delivery_type,
            "delivery_error": failure_message,
        },
    )


def notify_premium_request_received(
    db: Any,
    request_doc: dict[str, Any],
) -> dict[str, Any]:
    request_id = record_id(request_doc)
    company = company_name(request_doc)

    return notify_platform_superadmins(
        db,
        title="New Premium request received",
        body=(
            f"{company} requested a custom Premium quotation. "
            "Review requirements and prepare the quotation."
        ),
        notification_type="platform_premium_request",
        priority="urgent",
        target="premium_requests",
        event_key=_event_key(
            "premium_request_received",
            request_id,
        ),
        source="premium_plan_requests",
        source_id=request_id,
        tenant_id=source_tenant_id(request_doc),
        tenant_name=company,
        tenant_email=company_email(request_doc),
        meta={
            "premium_request_id": request_id,
            "request_reference":
                request_doc.get("request_reference"),
            "employee_count":
                request_doc.get("employee_count"),
            "request_status": request_doc.get("status"),
        },
    )


def notify_premium_action_required(
    db: Any,
    request_doc: dict[str, Any],
    *,
    action: str,
    message: str = "",
    event_suffix: str = "",
) -> dict[str, Any]:
    request_id = record_id(request_doc)
    company = company_name(request_doc)
    action_text = (
        safe_str(action)
        .replace("_", " ")
        .strip()
        or "review"
    )

    return notify_platform_superadmins(
        db,
        title="Premium action required",
        body=(
            safe_str(message)
            or (
                f"{company}'s Premium request requires "
                f"Superadmin {action_text}."
            )
        ),
        notification_type="platform_premium_action",
        priority="high",
        target="premium_requests",
        event_key=_event_key(
            f"premium_{action}",
            request_id,
            event_suffix,
        ),
        source="premium_plan_requests",
        source_id=request_id,
        tenant_id=source_tenant_id(request_doc),
        tenant_name=company,
        tenant_email=company_email(request_doc),
        meta={
            "premium_request_id": request_id,
            "required_action": action,
            "request_status": request_doc.get("status"),
            "quotation_status":
                request_doc.get("quotation_status"),
            "payment_status":
                request_doc.get("payment_status"),
        },
    )


def notify_payment_order_created(
    db: Any,
    order_doc: dict[str, Any],
) -> dict[str, Any]:
    order_id = record_id(order_doc)
    company = company_name(order_doc)

    return notify_platform_superadmins(
        db,
        title="New payment order created",
        body=(
            f"{company} started a subscription payment. "
            "Monitor the Razorpay order until verification completes."
        ),
        notification_type="platform_payment_order",
        priority="normal",
        target="subscriptions",
        event_key=_event_key(
            "payment_order_created",
            order_id,
        ),
        source="payment_orders",
        source_id=order_id,
        tenant_id=source_tenant_id(order_doc),
        tenant_name=company,
        tenant_email=company_email(order_doc),
        meta={
            "order_id": order_id,
            "razorpay_order_id":
                order_doc.get("razorpay_order_id"),
            "amount": order_doc.get("amount"),
            "currency": order_doc.get("currency"),
            "plan_code": order_doc.get("plan_code"),
            "order_status": order_doc.get("status"),
        },
        show_popup=False,
    )


def notify_payment_received(
    db: Any,
    payment_doc: dict[str, Any],
) -> dict[str, Any]:
    payment_id = record_id(payment_doc)
    company = company_name(payment_doc)

    return notify_platform_superadmins(
        db,
        title="Subscription payment received",
        body=(
            f"{company}'s payment was verified successfully. "
            "The subscription activation record is available for review."
        ),
        notification_type="platform_payment_received",
        priority="normal",
        target="subscriptions",
        event_key=_event_key(
            "payment_received",
            payment_id,
        ),
        source="payments",
        source_id=payment_id,
        tenant_id=source_tenant_id(payment_doc),
        tenant_name=company,
        tenant_email=company_email(payment_doc),
        meta={
            "payment_id": payment_id,
            "razorpay_payment_id":
                payment_doc.get("razorpay_payment_id"),
            "amount": payment_doc.get("amount"),
            "currency": payment_doc.get("currency"),
            "plan_code": payment_doc.get("plan_code"),
            "payment_status": payment_doc.get("status"),
        },
        show_popup=False,
    )


def notify_payment_verification_failed(
    db: Any,
    payment_or_order_doc: dict[str, Any],
    *,
    failure_message: str = "",
) -> dict[str, Any]:
    source_id = record_id(payment_or_order_doc)
    company = company_name(payment_or_order_doc)

    return notify_platform_superadmins(
        db,
        title="Payment verification failed",
        body=(
            f"{company}'s payment could not be verified."
            + (
                f" {safe_str(failure_message)}"
                if safe_str(failure_message)
                else " Superadmin review is required."
            )
        ),
        notification_type="platform_payment_failure",
        priority="urgent",
        target="subscriptions",
        event_key=_event_key(
            "payment_verification_failed",
            source_id,
        ),
        source="payment_orders",
        source_id=source_id,
        tenant_id=source_tenant_id(
            payment_or_order_doc
        ),
        tenant_name=company,
        tenant_email=company_email(
            payment_or_order_doc
        ),
        meta={
            "order_id": source_id,
            "razorpay_order_id":
                payment_or_order_doc.get(
                    "razorpay_order_id"
                ),
            "failure_message": failure_message,
        },
    )


def notify_subscription_due(
    db: Any,
    tenant_doc: dict[str, Any],
    *,
    days_left: int,
    cycle_key: str = "",
) -> dict[str, Any]:
    tenant_id = source_tenant_id(tenant_doc)
    company = company_name(tenant_doc)
    days_left = max(int(days_left), 0)
    day_label = (
        "today"
        if days_left == 0
        else (
            "tomorrow"
            if days_left == 1
            else f"in {days_left} days"
        )
    )

    return notify_platform_superadmins(
        db,
        title="Subscription renewal requires monitoring",
        body=(
            f"{company}'s subscription payment is due "
            f"{day_label}. Follow up if payment remains pending."
        ),
        notification_type="platform_subscription_due",
        priority="high" if days_left <= 3 else "normal",
        target="subscriptions",
        event_key=_event_key(
            "subscription_due",
            tenant_id,
            cycle_key or str(days_left),
        ),
        source="subscriptions",
        source_id=tenant_id,
        tenant_id=tenant_id,
        tenant_name=company,
        tenant_email=company_email(tenant_doc),
        meta={
            "days_left": days_left,
            "subscription_end_date":
                tenant_doc.get("subscription_end_date"),
            "next_due_date":
                tenant_doc.get("next_due_date"),
            "plan_code": tenant_doc.get("plan_code"),
            "requires_payment":
                tenant_doc.get("requires_payment"),
        },
    )


def notify_subscription_expired(
    db: Any,
    tenant_doc: dict[str, Any],
    *,
    cycle_key: str = "",
) -> dict[str, Any]:
    tenant_id = source_tenant_id(tenant_doc)
    company = company_name(tenant_doc)

    return notify_platform_superadmins(
        db,
        title="Subscription expired",
        body=(
            f"{company}'s paid subscription has expired "
            "without a verified renewal payment. Superadmin action may be required."
        ),
        notification_type="platform_subscription_expired",
        priority="urgent",
        target="companies",
        event_key=_event_key(
            "subscription_expired",
            tenant_id,
            cycle_key,
        ),
        source="subscriptions",
        source_id=tenant_id,
        tenant_id=tenant_id,
        tenant_name=company,
        tenant_email=company_email(tenant_doc),
        meta={
            "subscription_end_date":
                tenant_doc.get("subscription_end_date"),
            "plan_code": tenant_doc.get("plan_code"),
            "status": tenant_doc.get("status"),
            "requires_payment":
                tenant_doc.get("requires_payment"),
        },
    )


def notify_company_action_required(
    db: Any,
    tenant_doc: dict[str, Any],
    *,
    action: str,
    message: str = "",
    event_suffix: str = "",
    priority: str = "high",
) -> dict[str, Any]:
    tenant_id = source_tenant_id(tenant_doc)
    company = company_name(tenant_doc)
    action_text = (
        safe_str(action)
        .replace("_", " ")
        .strip()
        or "review"
    )

    return notify_platform_superadmins(
        db,
        title="Company action required",
        body=(
            safe_str(message)
            or (
                f"{company} requires Superadmin "
                f"{action_text}."
            )
        ),
        notification_type="platform_company_action",
        priority=priority,
        target="companies",
        event_key=_event_key(
            f"company_{action}",
            tenant_id,
            event_suffix,
        ),
        source="tenants",
        source_id=tenant_id,
        tenant_id=tenant_id,
        tenant_name=company,
        tenant_email=company_email(tenant_doc),
        meta={
            "required_action": action,
            "company_status": tenant_doc.get("status"),
            "plan_code": tenant_doc.get("plan_code"),
            "employee_count":
                tenant_doc.get("employee_count"),
            "employee_limit":
                tenant_doc.get("employee_limit"),
        },
    )


__all__ = [
    "PlatformNotificationServiceError",
    "get_platform_superadmins",
    "is_platform_superadmin",
    "notify_platform_superadmins",
    "notify_trial_request_received",
    "notify_trial_request_ready_for_review",
    "notify_trial_delivery_failure",
    "notify_premium_request_received",
    "notify_premium_action_required",
    "notify_payment_order_created",
    "notify_payment_received",
    "notify_payment_verification_failed",
    "notify_subscription_due",
    "notify_subscription_expired",
    "notify_company_action_required",
]
