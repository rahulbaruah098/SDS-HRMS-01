"""Central notification + FCM service for YourComate / SDS HRMS.

This module intentionally contains no Blueprint routes.  Route modules pass an
already-open Mongo database handle and explicit recipient/user context into the
public helpers below.

Design goals
------------
1. MongoDB notification records are the source of truth.
2. FCM is a delivery channel, not the source of truth.
3. Automatic workflow events may be deduplicated with ``event_key``.
4. Push delivery telemetry is stored per recipient notification.
5. Tenant devices and platform/Superadmin devices can be separated by scope.
6. Legacy tenant device records that pre-date ``scope`` remain usable.
"""

from __future__ import annotations

from datetime import datetime
import os
from typing import Any, Iterable, Mapping, Optional

from bson import ObjectId
from flask import current_app, g, has_request_context

try:
    import firebase_admin
    from firebase_admin import credentials, messaging
except Exception as exc:  # pragma: no cover - deployment dependency guard
    print("FCM IMPORT ERROR:", exc)
    firebase_admin = None
    credentials = None
    messaging = None


NOTIFICATION_CHANNEL_ID = "sds_hrms_notifications"

PLATFORM_DEVICE_SCOPE = "platform"
TENANT_DEVICE_SCOPE = "tenant"

PLATFORM_NOTIFICATION_NAVIGATION = {
    "companies": {
        "page": "companies",
        "label": "Open Companies",
        "mobile_route": "/superadmin/companies",
    },
    "company": {
        "page": "companies",
        "label": "Open Companies",
        "mobile_route": "/superadmin/companies",
    },
    "tenants": {
        "page": "companies",
        "label": "Open Companies",
        "mobile_route": "/superadmin/companies",
    },
    "tenant": {
        "page": "companies",
        "label": "Open Companies",
        "mobile_route": "/superadmin/companies",
    },
    "demo_requests": {
        "page": "demo_requests",
        "label": "Open Trial Requests",
        "mobile_route": "/superadmin/trial-requests",
    },
    "trial_requests": {
        "page": "demo_requests",
        "label": "Open Trial Requests",
        "mobile_route": "/superadmin/trial-requests",
    },
    "trial_request": {
        "page": "demo_requests",
        "label": "Open Trial Requests",
        "mobile_route": "/superadmin/trial-requests",
    },
    "premium_requests": {
        "page": "premium_requests",
        "label": "Open Premium Requests",
        "mobile_route": "/superadmin/subscriptions-payments",
    },
    "premium_request": {
        "page": "premium_requests",
        "label": "Open Premium Requests",
        "mobile_route": "/superadmin/subscriptions-payments",
    },
    "subscriptions": {
        "page": "subscriptions",
        "label": "Open Billing & Subscriptions",
        "mobile_route": "/superadmin/subscriptions-payments",
    },
    "subscription": {
        "page": "subscriptions",
        "label": "Open Billing & Subscriptions",
        "mobile_route": "/superadmin/subscriptions-payments",
    },
    "payments": {
        "page": "subscriptions",
        "label": "Open Billing & Subscriptions",
        "mobile_route": "/superadmin/subscriptions-payments",
    },
    "payment": {
        "page": "subscriptions",
        "label": "Open Billing & Subscriptions",
        "mobile_route": "/superadmin/subscriptions-payments",
    },
    "orders": {
        "page": "subscriptions",
        "label": "Open Billing & Subscriptions",
        "mobile_route": "/superadmin/subscriptions-payments",
    },
    "billing": {
        "page": "subscriptions",
        "label": "Open Billing & Subscriptions",
        "mobile_route": "/superadmin/subscriptions-payments",
    },
}

_PLATFORM_ROLES = {
    "super_admin",
    "superadmin",
    "platform_super_admin",
    "platform_superadmin",
}

_firebase_ready = False


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_email(value: Any) -> str:
    return normalize_text(value).lower()


def normalize_role(value: Any) -> str:
    return (
        normalize_text(value)
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def safe_object_id(value: Any) -> Optional[ObjectId]:
    try:
        return ObjectId(value)
    except Exception:
        return None


def _clean_unique(values: Iterable[Any]) -> list[str]:
    result: list[str] = []
    for value in values or []:
        text = normalize_text(value)
        if text and text not in result:
            result.append(text)
    return result


def _actor_context() -> tuple[str, str]:
    if not has_request_context():
        return "system", "System"

    user = getattr(g, "current_user", None) or {}
    actor_id = normalize_text(user.get("_id") or user.get("id")) or "system"
    actor_name = normalize_text(
        user.get("name")
        or user.get("full_name")
        or user.get("email")
        or user.get("username")
    ) or "System"
    return actor_id, actor_name


def device_scope_for_roles(role: Any = "", roles: Any = None) -> str:
    normalized = {normalize_role(role)} if normalize_role(role) else set()

    if isinstance(roles, str):
        normalized.update(
            normalize_role(item)
            for item in roles.split(",")
            if normalize_role(item)
        )
    elif isinstance(roles, (list, tuple, set)):
        normalized.update(
            normalize_role(item)
            for item in roles
            if normalize_role(item)
        )

    if normalized.intersection(_PLATFORM_ROLES):
        return PLATFORM_DEVICE_SCOPE

    return TENANT_DEVICE_SCOPE


def firebase_service_account_path() -> str:
    raw_path = normalize_text(os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH"))
    backend_root = os.path.abspath(os.path.join(current_app.root_path, ".."))

    if raw_path:
        if os.path.isabs(raw_path):
            return raw_path

        backend_relative_path = os.path.join(backend_root, raw_path)
        if os.path.exists(backend_relative_path):
            return backend_relative_path

        return os.path.abspath(raw_path)

    default_path = os.path.join(backend_root, "firebase-service-account.json")
    return default_path if os.path.exists(default_path) else ""


def ensure_firebase_app() -> bool:
    global _firebase_ready

    if _firebase_ready:
        return True

    if firebase_admin is None or credentials is None or messaging is None:
        current_app.logger.warning("firebase-admin is not installed")
        return False

    if firebase_admin._apps:
        _firebase_ready = True
        return True

    service_account_path = firebase_service_account_path()

    if not service_account_path:
        current_app.logger.warning(
            "FIREBASE_SERVICE_ACCOUNT_PATH is not configured"
        )
        return False

    if not os.path.exists(service_account_path):
        current_app.logger.warning(
            "Firebase service account file not found: %s",
            service_account_path,
        )
        return False

    try:
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred)
        _firebase_ready = True
        return True
    except Exception as exc:  # pragma: no cover - depends on credentials/runtime
        current_app.logger.exception(
            "Firebase initialization failed: %s",
            exc,
        )
        return False


def fcm_string_data(data: Optional[Mapping[str, Any]]) -> dict[str, str]:
    if not isinstance(data, Mapping):
        return {}

    safe: dict[str, str] = {}
    for key, value in data.items():
        if value is None or isinstance(value, (dict, list, tuple, set)):
            continue
        safe[str(key)] = str(value)
    return safe


def is_platform_notification_payload(value: Optional[Mapping[str, Any]]) -> bool:
    value = dict(value or {})
    meta = value.get("meta") if isinstance(value.get("meta"), dict) else {}

    notification_type = normalize_text(
        value.get("notification_type")
        or value.get("type")
        or meta.get("notification_type")
        or meta.get("type")
    ).lower()

    return bool(
        value.get("platform_notification")
        or meta.get("platform_notification")
        or notification_type.startswith("platform_")
    )


def canonical_platform_notification_navigation(
    value: Optional[Mapping[str, Any]],
) -> dict[str, str]:
    value = dict(value or {})
    meta = value.get("meta") if isinstance(value.get("meta"), dict) else value

    raw_target = normalize_text(
        value.get("target")
        or value.get("page")
        or meta.get("target")
        or meta.get("page")
    ).lower().replace("-", "_").replace(" ", "_")

    notification_type = normalize_text(
        value.get("notification_type")
        or value.get("type")
        or meta.get("notification_type")
        or meta.get("type")
    ).lower()

    if not raw_target:
        if "trial" in notification_type:
            raw_target = "demo_requests"
        elif "premium" in notification_type:
            raw_target = "premium_requests"
        elif any(
            term in notification_type
            for term in ("payment", "subscription", "order")
        ):
            raw_target = "subscriptions"
        elif any(term in notification_type for term in ("company", "tenant")):
            raw_target = "companies"

    return dict(
        PLATFORM_NOTIFICATION_NAVIGATION.get(
            raw_target,
            {
                "page": raw_target or "notifications",
                "label": "Open Notification",
                "mobile_route": "/notifications",
            },
        )
    )


def normalize_platform_notification_meta(
    meta: Optional[Mapping[str, Any]],
) -> dict[str, Any]:
    result = dict(meta or {})

    if not is_platform_notification_payload(result):
        return result

    navigation = canonical_platform_notification_navigation(result)
    page = navigation["page"]
    route = navigation["mobile_route"]
    label = navigation["label"]

    result.update(
        {
            "platform_notification": True,
            "target": page,
            "page": page,
            "action_page": page,
            "action_target": page,
            "action_label": label,
            "action_route": route,
            "mobile_route": route,
            "web_page": page,
        }
    )

    if not normalize_text(result.get("link_id")):
        result["link_id"] = normalize_text(
            result.get("source_id")
            or result.get("request_id")
            or result.get("premium_request_id")
            or result.get("order_id")
            or result.get("payment_id")
            or result.get("tenant_id")
        )

    if not normalize_text(result.get("link_type")):
        result["link_type"] = normalize_text(
            result.get("notification_type")
            or result.get("type")
            or "platform_notification"
        )

    return result


def normalize_platform_notification_item(
    item: Optional[Mapping[str, Any]],
) -> dict[str, Any]:
    result = dict(item or {})

    if not is_platform_notification_payload(result):
        return result

    meta = normalize_platform_notification_meta(result.get("meta") or {})
    navigation = canonical_platform_notification_navigation(
        {**result, "meta": meta}
    )

    page = navigation["page"]
    label = navigation["label"]
    route = navigation["mobile_route"]

    result.update(
        {
            "platform_notification": True,
            "target": page,
            "page": page,
            "action_page": page,
            "action_target": page,
            "action_label": label,
            "action_route": route,
            "mobile_route": route,
            "web_page": page,
            "meta": meta,
            "action": {
                "page": page,
                "target": page,
                "label": label,
                "route": route,
            },
        }
    )
    return result


def identity_values_from_record(record: Optional[Mapping[str, Any]]) -> list[str]:
    record = dict(record or {})
    values = _clean_unique(
        [
            record.get("_id"),
            record.get("id"),
            record.get("user_id"),
            record.get("employee_user_id"),
            record.get("employee_id"),
            record.get("employee_ref_id"),
            record.get("employee_code"),
            record.get("emp_code"),
            record.get("code"),
            record.get("email"),
            record.get("official_email"),
            record.get("username"),
        ]
    )

    for list_field in ("identity_values", "user_ids"):
        raw_values = record.get(list_field) or []
        if isinstance(raw_values, (list, tuple, set)):
            values = _clean_unique([*values, *raw_values])

    return values


def notification_identity_values_for_user_ids(
    db,
    user_ids: Iterable[Any],
    tenant_id: Optional[str] = None,
) -> list[str]:
    values = _clean_unique(user_ids)
    clean_user_ids = list(values)

    if not clean_user_ids:
        return []

    object_ids = [
        obj
        for obj in (safe_object_id(value) for value in clean_user_ids)
        if obj is not None
    ]

    user_or: list[dict[str, Any]] = [
        {"id": {"$in": clean_user_ids}},
        {"user_id": {"$in": clean_user_ids}},
        {"employee_id": {"$in": clean_user_ids}},
        {"employee_code": {"$in": clean_user_ids}},
        {"emp_code": {"$in": clean_user_ids}},
        {"email": {"$in": clean_user_ids}},
        {"official_email": {"$in": clean_user_ids}},
        {"username": {"$in": clean_user_ids}},
    ]
    if object_ids:
        user_or.insert(0, {"_id": {"$in": object_ids}})

    user_query: dict[str, Any] = {
        "$or": user_or,
        "is_deleted": {"$ne": True},
    }
    if tenant_id:
        user_query["tenant_id"] = tenant_id

    users = list(
        db.users.find(
            user_query,
            {
                "_id": 1,
                "id": 1,
                "user_id": 1,
                "employee_id": 1,
                "employee_code": 1,
                "emp_code": 1,
                "email": 1,
                "official_email": 1,
                "username": 1,
                "tenant_id": 1,
            },
        ).limit(5000)
    )

    for user in users:
        values = _clean_unique([*values, *identity_values_from_record(user)])

    employee_lookup_values = list(values)
    employee_object_ids = [
        obj
        for obj in (
            safe_object_id(value) for value in employee_lookup_values
        )
        if obj is not None
    ]

    employee_or: list[dict[str, Any]] = [
        {"user_id": {"$in": employee_lookup_values}},
        {"employee_user_id": {"$in": employee_lookup_values}},
        {"employee_id": {"$in": employee_lookup_values}},
        {"employee_ref_id": {"$in": employee_lookup_values}},
        {"employee_code": {"$in": employee_lookup_values}},
        {"emp_code": {"$in": employee_lookup_values}},
        {"code": {"$in": employee_lookup_values}},
        {"email": {"$in": employee_lookup_values}},
        {"official_email": {"$in": employee_lookup_values}},
    ]
    if employee_object_ids:
        employee_or.insert(0, {"_id": {"$in": employee_object_ids}})

    employee_query: dict[str, Any] = {
        "$or": employee_or,
        "is_deleted": {"$ne": True},
    }
    if tenant_id:
        employee_query["tenant_id"] = tenant_id

    employees = list(
        db.employees.find(
            employee_query,
            {
                "_id": 1,
                "user_id": 1,
                "employee_user_id": 1,
                "employee_id": 1,
                "employee_ref_id": 1,
                "employee_code": 1,
                "emp_code": 1,
                "code": 1,
                "email": 1,
                "official_email": 1,
                "tenant_id": 1,
            },
        ).limit(5000)
    )

    for employee in employees:
        values = _clean_unique([*values, *identity_values_from_record(employee)])

    return values


def _scope_query(scope: Optional[str]) -> Optional[dict[str, Any]]:
    scope = normalize_text(scope).lower()

    if scope == PLATFORM_DEVICE_SCOPE:
        return {"scope": PLATFORM_DEVICE_SCOPE}

    if scope == TENANT_DEVICE_SCOPE:
        # Backward compatibility: all devices written before the scope migration
        # are tenant devices unless explicitly marked as platform devices.
        return {
            "$or": [
                {"scope": TENANT_DEVICE_SCOPE},
                {"scope": {"$exists": False}},
                {"scope": ""},
                {"scope": None},
            ]
        }

    return None


def active_fcm_device_rows_for_users(
    db,
    user_ids: Iterable[Any],
    tenant_id: Optional[str] = None,
    scope: Optional[str] = None,
):
    identity_values = notification_identity_values_for_user_ids(
        db,
        user_ids,
        tenant_id=tenant_id,
    )

    if not identity_values:
        return [], [], 0

    base_query: dict[str, Any] = {
        "is_active": {"$ne": False},
        "is_deleted": {"$ne": True},
        "token": {"$nin": ["", None]},
    }
    if tenant_id:
        base_query["tenant_id"] = tenant_id

    scope_filter = _scope_query(scope)
    scanned_query: dict[str, Any]
    if scope_filter:
        scanned_query = {"$and": [base_query, scope_filter]}
    else:
        scanned_query = base_query

    scanned_device_count = db.notification_devices.count_documents(scanned_query)

    identity_filter = {
        "$or": [
            {"user_id": {"$in": identity_values}},
            {"employee_id": {"$in": identity_values}},
            {"employee_user_id": {"$in": identity_values}},
            {"user_ids": {"$in": identity_values}},
            {"identity_values": {"$in": identity_values}},
        ]
    }

    query_parts: list[dict[str, Any]] = [base_query, identity_filter]
    if scope_filter:
        query_parts.append(scope_filter)

    rows = list(
        db.notification_devices.find(
            {"$and": query_parts},
            {
                "token": 1,
                "user_id": 1,
                "employee_id": 1,
                "employee_user_id": 1,
                "user_ids": 1,
                "identity_values": 1,
                "tenant_id": 1,
                "platform": 1,
                "device_id": 1,
                "scope": 1,
                "last_seen_at": 1,
            },
        ).limit(10000)
    )

    return rows, identity_values, scanned_device_count


def active_fcm_tokens_for_users(
    db,
    user_ids: Iterable[Any],
    tenant_id: Optional[str] = None,
    scope: Optional[str] = None,
) -> list[str]:
    rows, _, _ = active_fcm_device_rows_for_users(
        db,
        user_ids,
        tenant_id=tenant_id,
        scope=scope,
    )
    return _clean_unique(row.get("token") for row in rows)


def mark_invalid_fcm_tokens(db, tokens: Iterable[Any]) -> None:
    clean_tokens = _clean_unique(tokens)
    if not clean_tokens:
        return

    now = datetime.utcnow()
    db.notification_devices.update_many(
        {"token": {"$in": clean_tokens}},
        {
            "$set": {
                "is_active": False,
                "is_deleted": True,
                "invalidated_at": now,
                "updated_at": now,
            }
        },
    )


def send_fcm_to_tokens(
    db,
    tokens: Iterable[Any],
    title: str,
    body: str,
    data: Optional[Mapping[str, Any]] = None,
) -> dict[str, Any]:
    clean_tokens = _clean_unique(tokens)

    if not clean_tokens:
        return {
            "sent": 0,
            "failed": 0,
            "skipped": True,
            "reason": "no_tokens",
            "token_count": 0,
            "invalid_token_count": 0,
            "errors": [],
        }

    if not ensure_firebase_app():
        return {
            "sent": 0,
            "failed": 0,
            "skipped": True,
            "reason": "firebase_not_ready",
            "token_count": len(clean_tokens),
            "invalid_token_count": 0,
            "errors": [],
        }

    payload_data = fcm_string_data(data or {})
    total_sent = 0
    total_failed = 0
    invalid_tokens: list[str] = []
    error_details: list[dict[str, str]] = []

    for token in clean_tokens:
        token_prefix = token[:18]
        message = messaging.Message(
            token=token,
            notification=messaging.Notification(
                title=normalize_text(title),
                body=normalize_text(body),
            ),
            data=payload_data,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    channel_id=NOTIFICATION_CHANNEL_ID,
                    sound="default",
                    priority="high",
                    default_sound=True,
                    click_action="FLUTTER_NOTIFICATION_CLICK",
                ),
            ),
        )

        try:
            message_id = messaging.send(message)
            total_sent += 1
            current_app.logger.info(
                "FCM sent successfully token_prefix=%s message_id=%s",
                token_prefix,
                message_id,
            )
        except Exception as exc:  # pragma: no cover - Firebase runtime dependent
            total_failed += 1
            error_text = str(exc)
            error_code = getattr(exc, "code", "") or ""
            error_type = exc.__class__.__name__

            current_app.logger.exception(
                "FCM token send failed token_prefix=%s code=%s error=%s",
                token_prefix,
                error_code,
                error_text,
            )

            error_details.append(
                {
                    "token_prefix": token_prefix,
                    "error": error_text,
                    "code": str(error_code),
                    "type": error_type,
                }
            )

            error_text_lower = error_text.lower()
            error_code_lower = str(error_code).lower()
            if (
                "registration-token-not-registered" in error_text_lower
                or "invalid-registration-token" in error_text_lower
                or "requested entity was not found" in error_text_lower
                or "sender id mismatch" in error_text_lower
                or "mismatched credential" in error_text_lower
                or "unregistered" in error_code_lower
                or "invalid-argument" in error_code_lower
                or "sender-id-mismatch" in error_code_lower
            ):
                invalid_tokens.append(token)

    if invalid_tokens:
        mark_invalid_fcm_tokens(db, invalid_tokens)

    return {
        "sent": total_sent,
        "failed": total_failed,
        "skipped": False,
        "errors": error_details[:20],
        "token_count": len(clean_tokens),
        "invalid_token_count": len(invalid_tokens),
    }


def _fcm_payload(
    title: str,
    body: str,
    meta: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "title": normalize_text(title),
        "body": normalize_text(body),
        "message": normalize_text(body),
        "target": meta.get("target") or meta.get("page") or "notifications",
        "page": meta.get("page") or meta.get("target") or "notifications",
        "action_target": (
            meta.get("action_target")
            or meta.get("target")
            or meta.get("page")
            or "notifications"
        ),
        "action_page": (
            meta.get("action_page")
            or meta.get("page")
            or meta.get("target")
            or "notifications"
        ),
        "action_label": meta.get("action_label") or "",
        "action_route": meta.get("action_route") or meta.get("mobile_route") or "",
        "mobile_route": meta.get("mobile_route") or meta.get("action_route") or "",
        "web_page": meta.get("web_page") or meta.get("page") or meta.get("target") or "notifications",
        "platform_notification": meta.get("platform_notification", False),
        "source_id": meta.get("source_id") or "",
        "tenant_id": meta.get("source_tenant_id") or meta.get("tenant_id") or "",
        "company_name": meta.get("company_name") or "",
        "notification_type": meta.get("notification_type") or meta.get("type") or "system",
        "priority": meta.get("priority") or "normal",
        "link_id": meta.get("link_id") or "",
        "link_type": meta.get("link_type") or "",
        "notification_id": meta.get("notification_id") or "",
        "event": meta.get("event") or "",
        "event_key": meta.get("event_key") or "",
    }


def send_fcm_to_users(
    db,
    user_ids: Iterable[Any],
    title: str,
    body: str,
    meta: Optional[Mapping[str, Any]] = None,
    tenant_id: Optional[str] = None,
    device_scope: Optional[str] = None,
) -> dict[str, Any]:
    result_meta = dict(meta or {})
    platform_notification = is_platform_notification_payload(result_meta)

    if platform_notification:
        result_meta = normalize_platform_notification_meta(result_meta)

    if not device_scope:
        device_scope = (
            PLATFORM_DEVICE_SCOPE
            if platform_notification
            else TENANT_DEVICE_SCOPE
        )

    clean_user_ids = _clean_unique(user_ids)
    lookup_tenant = None if device_scope == PLATFORM_DEVICE_SCOPE else tenant_id

    device_rows, identity_values, scanned_device_count = (
        active_fcm_device_rows_for_users(
            db,
            clean_user_ids,
            tenant_id=lookup_tenant,
            scope=device_scope,
        )
    )

    tokens = _clean_unique(row.get("token") for row in device_rows)
    send_result = send_fcm_to_tokens(
        db,
        tokens,
        title,
        body,
        data=_fcm_payload(title, body, result_meta),
    )

    send_result.update(
        {
            "token_count": len(tokens),
            "user_count": len(clean_user_ids),
            "tenant_id": tenant_id or "",
            "device_scope": device_scope,
            "lookup_user_ids": clean_user_ids,
            "lookup_identity_values": identity_values[:80],
            "scanned_device_count": scanned_device_count,
            "device_matches": [
                {
                    "user_id": normalize_text(row.get("user_id")),
                    "employee_id": normalize_text(row.get("employee_id")),
                    "employee_user_id": normalize_text(row.get("employee_user_id")),
                    "tenant_id": normalize_text(row.get("tenant_id")),
                    "platform": normalize_text(row.get("platform")),
                    "device_id": normalize_text(row.get("device_id")),
                    "scope": normalize_text(row.get("scope")) or TENANT_DEVICE_SCOPE,
                    "token_prefix": normalize_text(row.get("token"))[:18],
                    "last_seen_at": row.get("last_seen_at"),
                }
                for row in device_rows
            ],
        }
    )

    current_app.logger.info(
        "FCM result scope=%s tenant=%s users=%s identities=%s scanned_devices=%s tokens=%s sent=%s failed=%s skipped=%s reason=%s",
        device_scope,
        tenant_id or "",
        len(clean_user_ids),
        len(identity_values),
        scanned_device_count,
        len(tokens),
        send_result.get("sent"),
        send_result.get("failed"),
        send_result.get("skipped"),
        send_result.get("reason", ""),
    )

    return send_result


def _notification_source_id(meta: Mapping[str, Any]) -> str:
    return normalize_text(
        meta.get("source_id")
        or meta.get("request_id")
        or meta.get("leave_request_id")
        or meta.get("expense_id")
        or meta.get("ticket_id")
        or meta.get("project_id")
        or meta.get("task_id")
        or meta.get("visit_id")
        or meta.get("review_id")
        or meta.get("performance_review_id")
        or meta.get("asset_id")
        or meta.get("policy_id")
        or meta.get("recruitment_id")
        or meta.get("candidate_id")
        or meta.get("interview_id")
        or meta.get("loan_id")
        or meta.get("reimbursement_id")
        or meta.get("payroll_run_id")
        or meta.get("payslip_id")
        or meta.get("meeting_id")
        or meta.get("link_id")
    )


def build_event_key(
    event: str,
    source_id: Any = "",
    qualifier: Any = "",
) -> str:
    parts = [
        normalize_text(event).lower(),
        normalize_text(source_id),
        normalize_text(qualifier).lower(),
    ]
    return ":".join(part for part in parts if part)


def _push_status_from_result(result: Mapping[str, Any]) -> tuple[str, str, str]:
    if result.get("sent", 0) > 0:
        return "sent", "delivered_to_fcm", ""

    reason = normalize_text(result.get("reason"))
    if result.get("skipped"):
        return (
            f"skipped_{reason}" if reason else "skipped",
            "persisted",
            reason,
        )

    if result.get("failed", 0) > 0:
        first_error = ""
        errors = result.get("errors") or []
        if isinstance(errors, list) and errors:
            first_error = normalize_text(errors[0].get("error"))
        return "failed", "persisted", first_error or "fcm_send_failed"

    return "not_sent", "persisted", reason


def notify_users(
    db,
    user_ids: Iterable[Any],
    title: str,
    body: str,
    meta: Optional[Mapping[str, Any]] = None,
    tenant_id: Optional[str] = None,
    *,
    event: str = "",
    event_key: str = "",
    push: bool = True,
) -> list[dict[str, Any]]:
    """Persist and optionally push an automatic workflow notification.

    ``event_key`` is a base key.  The recipient user id is appended internally,
    which guarantees idempotency per recipient without requiring a database
    schema migration or unique index before this rollout.
    """

    now = datetime.utcnow()
    result_meta = dict(meta or {})
    platform_notification = is_platform_notification_payload(result_meta)

    if platform_notification:
        result_meta = normalize_platform_notification_meta(result_meta)

    if not tenant_id:
        tenant_id = normalize_text(
            result_meta.get("tenant_id")
            or result_meta.get("source_tenant_id")
            or result_meta.get("target_tenant_id")
        ) or "sds"

    recipient_user_ids = _clean_unique(user_ids)
    if not recipient_user_ids:
        return []

    source_id = _notification_source_id(result_meta)
    event = normalize_text(event or result_meta.get("event"))
    base_event_key = normalize_text(event_key or result_meta.get("event_key"))
    if not base_event_key and event:
        base_event_key = build_event_key(
            event,
            source_id,
            result_meta.get("status") or result_meta.get("stage"),
        )

    actor_id, actor_name = _actor_context()
    actor_id = normalize_text(result_meta.get("created_by")) or actor_id
    actor_name = normalize_text(result_meta.get("created_by_name")) or actor_name

    notification_type = normalize_text(
        result_meta.get("notification_type") or result_meta.get("type")
    ) or "system"
    priority = normalize_text(result_meta.get("priority")) or "normal"
    target = normalize_text(
        result_meta.get("target") or result_meta.get("page")
    ) or "notifications"

    created_docs: list[dict[str, Any]] = []

    for user_id in recipient_user_ids:
        recipient_event_key = (
            f"{base_event_key}:user:{user_id}" if base_event_key else ""
        )

        if recipient_event_key:
            existing = db.notifications.find_one(
                {
                    "event_key": recipient_event_key,
                    "user_id": user_id,
                    "is_deleted": {"$ne": True},
                },
                {"_id": 1},
            )
            if existing:
                current_app.logger.info(
                    "Notification deduplicated event_key=%s user=%s",
                    recipient_event_key,
                    user_id,
                )
                continue

        per_user_meta = dict(result_meta)
        if event:
            per_user_meta["event"] = event
        if recipient_event_key:
            per_user_meta["event_key"] = recipient_event_key
        if source_id and not normalize_text(per_user_meta.get("source_id")):
            per_user_meta["source_id"] = source_id

        doc: dict[str, Any] = {
            "tenant_id": tenant_id,
            "target_tenant_id": result_meta.get("target_tenant_id") or tenant_id,
            "user_id": user_id,
            "user_ids": [user_id],
            "title": normalize_text(title),
            "body": normalize_text(body),
            "message": normalize_text(body),
            "notification_type": notification_type,
            "priority": priority,
            "target": target,
            "target_scope": result_meta.get("target_scope") or "selected_users",
            "audience": result_meta.get("audience") or "selected_users",
            "show_popup": result_meta.get("show_popup", True),
            "popup_seen": False,
            "popup_seen_at": "",
            "read": False,
            "status": "unread",
            "meta": per_user_meta,
            "platform_notification": bool(platform_notification),
            "action_page": per_user_meta.get("action_page") or "",
            "action_target": per_user_meta.get("action_target") or "",
            "action_label": per_user_meta.get("action_label") or "",
            "action_route": per_user_meta.get("action_route") or "",
            "mobile_route": per_user_meta.get("mobile_route") or "",
            "web_page": per_user_meta.get("web_page") or "",
            "source_id": source_id,
            "event": event,
            "event_key": recipient_event_key,
            "created_at": now,
            "updated_at": now,
            "created_by": actor_id,
            "created_by_name": actor_name,
            "is_deleted": False,
            "delivery_status": "persisted",
            "push_status": "pending" if push else "disabled",
            "push_attempt_count": 0,
            "last_push_attempt_at": "",
            "push_sent_at": "",
            "failure_reason": "",
            "device_count": 0,
        }

        insert_result = db.notifications.insert_one(doc)
        doc["_id"] = insert_result.inserted_id
        created_docs.append(doc)

    for doc in created_docs:
        if not push:
            continue

        attempt_at = datetime.utcnow()
        push_meta = dict(doc.get("meta") or {})
        push_meta["notification_id"] = str(doc["_id"])
        push_meta["source_id"] = doc.get("source_id") or push_meta.get("source_id") or ""
        push_meta["event"] = doc.get("event") or ""
        push_meta["event_key"] = doc.get("event_key") or ""

        device_scope = (
            PLATFORM_DEVICE_SCOPE
            if doc.get("platform_notification")
            else TENANT_DEVICE_SCOPE
        )

        fcm_result = send_fcm_to_users(
            db,
            [doc["user_id"]],
            doc["title"],
            doc["body"],
            meta=push_meta,
            tenant_id=tenant_id,
            device_scope=device_scope,
        )

        push_status, delivery_status, failure_reason = _push_status_from_result(
            fcm_result
        )
        update = {
            "fcm_result": fcm_result,
            "fcm_sent_at": attempt_at,
            "delivery_status": delivery_status,
            "push_status": push_status,
            "push_attempt_count": 1,
            "last_push_attempt_at": attempt_at,
            "push_sent_at": attempt_at if fcm_result.get("sent", 0) > 0 else "",
            "failure_reason": failure_reason,
            "device_count": int(fcm_result.get("token_count") or 0),
            "updated_at": datetime.utcnow(),
        }

        db.notifications.update_one(
            {"_id": doc["_id"]},
            {"$set": update},
        )
        doc.update(update)

    return created_docs


def register_device(
    db,
    *,
    token: Any,
    user_id: Any,
    tenant_id: Any,
    employee_id: Any = "",
    platform: Any = "android",
    device_id: Any = "",
    app_version: Any = "",
    scope: Any = TENANT_DEVICE_SCOPE,
) -> dict[str, Any]:
    token = normalize_text(token)
    user_id = normalize_text(user_id)
    tenant_id = normalize_text(tenant_id) or "sds"
    employee_id = normalize_text(employee_id)
    platform = normalize_text(platform).lower() or "android"
    device_id = normalize_text(device_id)
    app_version = normalize_text(app_version)
    scope = normalize_text(scope).lower() or TENANT_DEVICE_SCOPE

    if not token:
        raise ValueError("FCM token is required")
    if not user_id:
        raise ValueError("user_id is required")
    if scope not in {TENANT_DEVICE_SCOPE, PLATFORM_DEVICE_SCOPE}:
        raise ValueError("Invalid notification device scope")

    identity_tenant = None if scope == PLATFORM_DEVICE_SCOPE else tenant_id
    identity_values = notification_identity_values_for_user_ids(
        db,
        [user_id, employee_id],
        tenant_id=identity_tenant,
    )

    now = datetime.utcnow()
    update = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "employee_id": employee_id,
        "employee_user_id": user_id,
        "user_ids": identity_values,
        "identity_values": identity_values,
        "token": token,
        "platform": platform,
        "device_id": device_id,
        "app_version": app_version,
        "scope": scope,
        "is_active": True,
        "is_deleted": False,
        "last_seen_at": now,
        "updated_at": now,
        "invalidated_at": "",
        "deleted_at": "",
    }

    db.notification_devices.update_one(
        {"token": token},
        {
            "$set": update,
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    return {
        "registered": True,
        "scope": scope,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "employee_id": employee_id,
        "identity_values": identity_values,
    }


def unregister_device(
    db,
    *,
    token: Any,
    user_id: Any,
) -> dict[str, Any]:
    token = normalize_text(token)
    user_id = normalize_text(user_id)

    if not token:
        raise ValueError("FCM token is required")

    now = datetime.utcnow()
    result = db.notification_devices.update_many(
        {
            "token": token,
            "user_id": user_id,
        },
        {
            "$set": {
                "is_active": False,
                "is_deleted": True,
                "updated_at": now,
                "deleted_at": now,
            }
        },
    )

    return {
        "registered": False,
        "matched_count": result.matched_count,
        "modified_count": result.modified_count,
    }
