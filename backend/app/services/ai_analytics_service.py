"""
Saya AI analytics and operational observability service.

This service records privacy-minimised operational telemetry for the YourComate
Saya assistant.  It intentionally does *not* persist raw user prompts, model
answers, voice audio, GPS coordinates, payroll values, grievance text, secrets,
or database documents.

File 21 responsibilities
------------------------
* request/event telemetry for chat, STT, TTS, actions and voice sessions
* provider/fallback/latency statistics
* action success, blocked, cancelled and failure statistics
* safe error telemetry
* tenant-aware analytics snapshots
* platform-wide snapshots for authenticated Super Admin context only
* voice-session and reminder-worker health integration
* TTL-based telemetry retention

The final ai_assistant route integration (File 22) is expected to call these
helpers.  All record_* functions are deliberately fail-safe: analytics must
never break an HRMS request.
"""

from __future__ import annotations

import hashlib
import math
import os
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from app.extensions import get_db


AI_ANALYTICS_COLLECTION = os.getenv(
    "AI_ANALYTICS_COLLECTION",
    "ai_analytics_events",
).strip() or "ai_analytics_events"

AI_ANALYTICS_SCHEMA_VERSION = 1
AI_ANALYTICS_RETENTION_DAYS = max(
    1,
    int(os.getenv("AI_ANALYTICS_RETENTION_DAYS", "90") or 90),
)
AI_ANALYTICS_MAX_SNAPSHOT_EVENTS = max(
    100,
    int(os.getenv("AI_ANALYTICS_MAX_SNAPSHOT_EVENTS", "20000") or 20000),
)
AI_ANALYTICS_ENABLED = str(
    os.getenv("AI_ANALYTICS_ENABLED", "true")
).strip().lower() not in {"0", "false", "no", "off"}

_ALLOWED_EVENT_TYPES = {
    "chat",
    "provider",
    "stt",
    "tts",
    "action",
    "voice_session",
    "reminder",
    "error",
    "health",
}

_ALLOWED_CHANNELS = {"text", "voice", "system", "unknown"}
_ALLOWED_ACTION_STATUSES = {
    "started",
    "collecting",
    "awaiting_confirmation",
    "completed",
    "handled",
    "blocked",
    "cancelled",
    "failed",
    "not_handled",
    "unknown",
}

# Metadata keys that may be useful for operational analysis and are safe to
# retain.  Unknown keys are ignored rather than persisted opportunistically.
_SAFE_METADATA_KEYS = {
    "audio_size",
    "cache",
    "cache_hit",
    "detected_modules",
    "finish_reason",
    "http_method",
    "http_status",
    "intent_confidence",
    "intent_source",
    "language",
    "mime_type",
    "module",
    "notification_sent",
    "permission_allowed",
    "primary_role",
    "response_chars",
    "response_mode",
    "retry_count",
    "route",
    "skipped",
    "skip_reason",
    "subscription_profile",
    "transcript_chars",
    "turn_number",
    "voice_control",
}

_SENSITIVE_KEY_FRAGMENTS = (
    "answer",
    "audio",
    "bank",
    "content",
    "credential",
    "gps",
    "grievance",
    "key",
    "location",
    "message",
    "otp",
    "password",
    "payroll",
    "prompt",
    "question",
    "salary",
    "secret",
    "signature",
    "text",
    "token",
    "transcript",
)


def _utcnow() -> datetime:
    # The existing HRMS stores UTC timestamps as naive datetimes in many
    # collections.  Keep the same convention for query compatibility.
    return datetime.utcnow()


def _safe_text(value: Any, limit: int = 160) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:limit]


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _safe_int(value: Any, default: int = 0, minimum: Optional[int] = None) -> int:
    try:
        result = int(value)
    except Exception:
        result = int(default)
    if minimum is not None:
        result = max(minimum, result)
    return result


def _normalise_roles(value: Any) -> List[str]:
    if isinstance(value, str):
        values: Iterable[Any] = [value]
    elif isinstance(value, (list, tuple, set)):
        values = value
    else:
        values = []

    output: List[str] = []
    for item in values:
        role = _safe_text(item, 64).lower().replace("-", "_").replace(" ", "_")
        if role and role not in output:
            output.append(role)
    return output[:12]


def _identity_from_context(user_context: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    context = dict(user_context or {})
    employee = context.get("employee") if isinstance(context.get("employee"), Mapping) else {}

    tenant_id = _safe_text(
        context.get("tenant_id") or context.get("company_id"),
        96,
    )
    if not tenant_id and isinstance(context.get("tenant"), Mapping):
        tenant_id = _safe_text(
            context["tenant"].get("_id") or context["tenant"].get("tenant_id"),
            96,
        )

    user_id = _safe_text(
        context.get("user_id")
        or context.get("_id")
        or context.get("id"),
        96,
    )
    employee_id = _safe_text(
        context.get("employee_id")
        or employee.get("_id")
        or employee.get("id"),
        96,
    )
    roles = _normalise_roles(context.get("roles") or context.get("role") or [])

    return {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "employee_id": employee_id,
        "roles": roles,
        "primary_role": _safe_text(context.get("role") or (roles[0] if roles else ""), 64),
        "subscription_profile": _safe_text(context.get("subscription_profile"), 64),
    }


def _is_platform_superadmin(user_context: Optional[Mapping[str, Any]]) -> bool:
    identity = _identity_from_context(user_context)
    roles = set(identity.get("roles") or [])
    return "super_admin" in roles or _safe_bool((user_context or {}).get("is_platform_superadmin"))


def _hash_identifier(value: Any) -> str:
    text = _safe_text(value, 256)
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def _safe_metadata(metadata: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    if not isinstance(metadata, Mapping):
        return {}

    output: Dict[str, Any] = {}
    for raw_key, raw_value in metadata.items():
        key = _safe_text(raw_key, 80).lower()
        if not key or key not in _SAFE_METADATA_KEYS:
            continue
        if any(fragment in key for fragment in _SENSITIVE_KEY_FRAGMENTS):
            # Explicit allow-list above contains a few length-only fields such
            # as response_chars/transcript_chars.  Those values are numeric and
            # safe, despite their names containing sensitive words.
            if key not in {"audio_size", "response_chars", "transcript_chars"}:
                continue

        if isinstance(raw_value, bool):
            output[key] = raw_value
        elif isinstance(raw_value, (int, float)) and not isinstance(raw_value, bool):
            if math.isfinite(float(raw_value)):
                output[key] = raw_value
        elif isinstance(raw_value, (list, tuple, set)):
            output[key] = [_safe_text(item, 80) for item in list(raw_value)[:20] if _safe_text(item, 80)]
        elif raw_value is not None:
            output[key] = _safe_text(raw_value, 160)

    return output


def new_ai_request_id() -> str:
    """Return an opaque correlation id safe to expose to the client/logs."""
    return uuid.uuid4().hex


def _collection(db=None):
    database = db or get_db()
    return database[AI_ANALYTICS_COLLECTION]


def ensure_ai_analytics_indexes(db=None) -> Dict[str, bool]:
    """Create analytics indexes. Safe to call repeatedly at startup/request time."""
    if not AI_ANALYTICS_ENABLED:
        return {"enabled": False}

    collection = _collection(db)
    results: Dict[str, bool] = {"enabled": True}

    index_specs = {
        "ttl": (
            [("expires_at", 1)],
            {"name": "saya_ai_analytics_ttl", "expireAfterSeconds": 0},
        ),
        "tenant_time": (
            [("tenant_id", 1), ("created_at", -1)],
            {"name": "saya_ai_analytics_tenant_time"},
        ),
        "event_time": (
            [("event_type", 1), ("created_at", -1)],
            {"name": "saya_ai_analytics_event_time"},
        ),
        "provider_time": (
            [("provider", 1), ("created_at", -1)],
            {"name": "saya_ai_analytics_provider_time", "sparse": True},
        ),
        "action_time": (
            [("action_type", 1), ("created_at", -1)],
            {"name": "saya_ai_analytics_action_time", "sparse": True},
        ),
        "request": (
            [("request_id", 1), ("created_at", 1)],
            {"name": "saya_ai_analytics_request", "sparse": True},
        ),
    }

    for key, (keys, options) in index_specs.items():
        try:
            collection.create_index(keys, **options)
            results[key] = True
        except Exception:
            results[key] = False

    return results


def record_ai_event(
    event_type: str,
    *,
    user_context: Optional[Mapping[str, Any]] = None,
    request_id: str = "",
    channel: str = "unknown",
    success: bool = True,
    latency_ms: Optional[int] = None,
    provider: str = "",
    model: str = "",
    fallback_used: bool = False,
    intent: str = "",
    action_type: str = "",
    action_status: str = "",
    error_code: str = "",
    status_code: Optional[int] = None,
    session_id: str = "",
    metadata: Optional[Mapping[str, Any]] = None,
    db=None,
) -> Dict[str, Any]:
    """Persist one privacy-minimised Saya telemetry event.

    This function never raises intentionally; analytics failure must not break
    the user's HRMS request.
    """
    if not AI_ANALYTICS_ENABLED:
        return {"recorded": False, "reason": "analytics_disabled"}

    event_type = _safe_text(event_type, 48).lower()
    if event_type not in _ALLOWED_EVENT_TYPES:
        event_type = "error" if not success else "health"

    channel = _safe_text(channel, 24).lower()
    if channel not in _ALLOWED_CHANNELS:
        channel = "unknown"

    action_status = _safe_text(action_status, 48).lower()
    if action_status and action_status not in _ALLOWED_ACTION_STATUSES:
        action_status = "unknown"

    identity = _identity_from_context(user_context)
    now = _utcnow()

    document: Dict[str, Any] = {
        "schema_version": AI_ANALYTICS_SCHEMA_VERSION,
        "event_type": event_type,
        "request_id": _safe_text(request_id, 96),
        "tenant_id": identity.get("tenant_id") or "",
        "user_id": identity.get("user_id") or "",
        "employee_id": identity.get("employee_id") or "",
        "primary_role": identity.get("primary_role") or "",
        "roles": identity.get("roles") or [],
        "subscription_profile": identity.get("subscription_profile") or "",
        "channel": channel,
        "success": bool(success),
        "provider": _safe_text(provider, 48).lower(),
        "model": _safe_text(model, 120),
        "fallback_used": bool(fallback_used),
        "intent": _safe_text(intent, 96).lower(),
        "action_type": _safe_text(action_type, 96).lower(),
        "action_status": action_status,
        "error_code": _safe_text(error_code, 96).lower(),
        "status_code": _safe_int(status_code, 0, 0) if status_code is not None else None,
        "session_fingerprint": _hash_identifier(session_id),
        "metadata": _safe_metadata(metadata),
        "created_at": now,
        "expires_at": now + timedelta(days=AI_ANALYTICS_RETENTION_DAYS),
    }

    if latency_ms is not None:
        document["latency_ms"] = _safe_int(latency_ms, 0, 0)

    # Remove empty optional fields to keep documents compact and indexes sparse.
    for key in (
        "request_id",
        "tenant_id",
        "user_id",
        "employee_id",
        "primary_role",
        "subscription_profile",
        "provider",
        "model",
        "intent",
        "action_type",
        "action_status",
        "error_code",
        "session_fingerprint",
    ):
        if not document.get(key):
            document.pop(key, None)
    if document.get("status_code") is None:
        document.pop("status_code", None)
    if not document.get("metadata"):
        document.pop("metadata", None)

    try:
        collection = _collection(db)
        result = collection.insert_one(document)
        return {
            "recorded": True,
            "event_id": str(getattr(result, "inserted_id", "") or ""),
            "event_type": event_type,
        }
    except Exception:
        return {"recorded": False, "reason": "analytics_write_failed", "event_type": event_type}


def record_chat_event(
    *,
    user_context: Optional[Mapping[str, Any]],
    request_id: str,
    response_mode: str,
    success: bool,
    latency_ms: int,
    intent: str = "",
    action_type: str = "",
    action_status: str = "",
    provider: str = "",
    model: str = "",
    fallback_used: bool = False,
    response_chars: int = 0,
    status_code: int = 200,
    error_code: str = "",
    metadata: Optional[Mapping[str, Any]] = None,
    db=None,
) -> Dict[str, Any]:
    combined = dict(metadata or {})
    combined["response_mode"] = _safe_text(response_mode, 16) or "text"
    combined["response_chars"] = max(0, _safe_int(response_chars))
    return record_ai_event(
        "chat",
        user_context=user_context,
        request_id=request_id,
        channel="voice" if _safe_text(response_mode).lower() == "voice" else "text",
        success=success,
        latency_ms=latency_ms,
        provider=provider,
        model=model,
        fallback_used=fallback_used,
        intent=intent,
        action_type=action_type,
        action_status=action_status,
        error_code=error_code,
        status_code=status_code,
        metadata=combined,
        db=db,
    )


def record_provider_event(
    operation: str,
    result: Optional[Mapping[str, Any]] = None,
    *,
    user_context: Optional[Mapping[str, Any]] = None,
    request_id: str = "",
    response_mode: str = "",
    success: Optional[bool] = None,
    provider: str = "",
    model: str = "",
    latency_ms: Optional[int] = None,
    fallback_used: Optional[bool] = None,
    error_code: str = "",
    status_code: Optional[int] = None,
    metadata: Optional[Mapping[str, Any]] = None,
    db=None,
) -> Dict[str, Any]:
    data = dict(result or {})
    op = _safe_text(operation, 32).lower()
    event_type = op if op in {"stt", "tts"} else "provider"
    resolved_provider = provider or data.get("provider") or ""
    resolved_model = model or data.get("model") or ""
    resolved_latency = latency_ms if latency_ms is not None else data.get("latency_ms")
    resolved_success = bool(data.get("success", True)) if success is None else bool(success)
    resolved_fallback = bool(data.get("fallback_used")) if fallback_used is None else bool(fallback_used)

    combined = dict(metadata or {})
    if data.get("skipped") is not None:
        combined["skipped"] = bool(data.get("skipped"))
    if data.get("reason"):
        combined["skip_reason"] = _safe_text(data.get("reason"), 80)
    if op == "stt":
        transcript = data.get("text") or data.get("transcript") or ""
        combined["transcript_chars"] = len(str(transcript or ""))

    return record_ai_event(
        event_type,
        user_context=user_context,
        request_id=request_id,
        channel="voice" if op in {"stt", "tts"} or response_mode == "voice" else "text",
        success=resolved_success,
        latency_ms=_safe_int(resolved_latency, 0, 0) if resolved_latency is not None else None,
        provider=resolved_provider,
        model=resolved_model,
        fallback_used=resolved_fallback,
        error_code=error_code,
        status_code=status_code,
        metadata=combined,
        db=db,
    )


def record_action_event(
    *,
    user_context: Optional[Mapping[str, Any]],
    request_id: str,
    action_type: str,
    action_status: str,
    success: bool = True,
    intent: str = "",
    response_mode: str = "text",
    latency_ms: Optional[int] = None,
    metadata: Optional[Mapping[str, Any]] = None,
    db=None,
) -> Dict[str, Any]:
    return record_ai_event(
        "action",
        user_context=user_context,
        request_id=request_id,
        channel="voice" if response_mode == "voice" else "text",
        success=success,
        latency_ms=latency_ms,
        intent=intent or action_type,
        action_type=action_type,
        action_status=action_status,
        metadata=metadata,
        db=db,
    )


def record_voice_session_event(
    operation: str,
    *,
    user_context: Optional[Mapping[str, Any]],
    request_id: str = "",
    session_id: str = "",
    success: bool = True,
    turn_number: Optional[int] = None,
    voice_control: str = "",
    latency_ms: Optional[int] = None,
    metadata: Optional[Mapping[str, Any]] = None,
    db=None,
) -> Dict[str, Any]:
    combined = dict(metadata or {})
    combined["module"] = "voice_session"
    combined["route"] = _safe_text(operation, 80)
    if turn_number is not None:
        combined["turn_number"] = _safe_int(turn_number, 0, 0)
    if voice_control:
        combined["voice_control"] = _safe_text(voice_control, 48)

    return record_ai_event(
        "voice_session",
        user_context=user_context,
        request_id=request_id,
        channel="voice",
        success=success,
        latency_ms=latency_ms,
        session_id=session_id,
        metadata=combined,
        db=db,
    )


def record_error_event(
    error_code: str,
    *,
    user_context: Optional[Mapping[str, Any]] = None,
    request_id: str = "",
    response_mode: str = "",
    status_code: Optional[int] = None,
    provider: str = "",
    action_type: str = "",
    latency_ms: Optional[int] = None,
    metadata: Optional[Mapping[str, Any]] = None,
    db=None,
) -> Dict[str, Any]:
    # Never persist str(exception) here: provider/backend exceptions can contain
    # implementation details.  The route supplies a stable safe error code.
    return record_ai_event(
        "error",
        user_context=user_context,
        request_id=request_id,
        channel="voice" if response_mode == "voice" else "text",
        success=False,
        latency_ms=latency_ms,
        provider=provider,
        action_type=action_type,
        error_code=error_code,
        status_code=status_code,
        metadata=metadata,
        db=db,
    )


def infer_action_outcome(
    *,
    intent_result: Optional[Mapping[str, Any]] = None,
    pending_before: Optional[Mapping[str, Any]] = None,
    pending_after: Optional[Mapping[str, Any]] = None,
    answer: str = "",
    request_success: bool = True,
) -> Dict[str, str]:
    """Infer action telemetry without making authorization decisions.

    The action engine remains the source of truth.  This helper only gives the
    final route a conservative analytics label from the intent and pending-action
    state before/after a request.
    """
    intent_data = dict(intent_result or {})
    before = dict(pending_before or {})
    after = dict(pending_after or {})

    action_type = _safe_text(
        after.get("action_type")
        or before.get("action_type")
        or intent_data.get("intent")
        or intent_data.get("action_type"),
        96,
    ).lower()

    is_action = bool(action_type) and (
        bool(before or after) or bool(intent_data.get("is_action"))
    )
    if not is_action:
        return {"action_type": "", "action_status": ""}

    if not request_success:
        return {"action_type": action_type, "action_status": "failed"}

    answer_lower = str(answer or "").lower()
    if "cancelled" in answer_lower or "canceled" in answer_lower:
        status = "cancelled"
    elif "not authorized" in answer_lower or "not permitted" in answer_lower or "cannot approve" in answer_lower:
        status = "blocked"
    elif after:
        step = _safe_text(after.get("current_step") or after.get("step"), 64).lower()
        status = "awaiting_confirmation" if step == "confirm" else "collecting"
    elif before:
        status = "completed"
    else:
        # A read/plugin action can be fully handled without creating pending
        # state.  Do not overclaim success of a write just because no pending
        # state exists; use a conservative handled label.
        status = "handled"

    return {"action_type": action_type, "action_status": status}


def _percentile(values: Sequence[int], percentile: float) -> int:
    if not values:
        return 0
    ordered = sorted(max(0, int(value)) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    index = int(math.ceil((percentile / 100.0) * len(ordered))) - 1
    return ordered[max(0, min(index, len(ordered) - 1))]


def _scope_query(
    user_context: Optional[Mapping[str, Any]],
    *,
    platform_scope: bool = False,
    tenant_id: str = "",
) -> Dict[str, Any]:
    identity = _identity_from_context(user_context)
    requested_tenant = _safe_text(tenant_id, 96)

    if platform_scope:
        if not _is_platform_superadmin(user_context):
            raise PermissionError("Platform-wide Saya analytics require Super Admin access.")
        return {"tenant_id": requested_tenant} if requested_tenant else {}

    scoped_tenant = requested_tenant or identity.get("tenant_id") or ""
    if not scoped_tenant:
        # A platform Super Admin may request their own platform snapshot with no
        # tenant only when platform_scope=True. Everyone else fails closed.
        raise PermissionError("Tenant context is required for Saya analytics.")
    return {"tenant_id": scoped_tenant}


def get_ai_analytics_snapshot(
    *,
    user_context: Optional[Mapping[str, Any]],
    days: int = 7,
    platform_scope: bool = False,
    tenant_id: str = "",
    db=None,
) -> Dict[str, Any]:
    """Return a compact privacy-safe Saya operational analytics snapshot."""
    days = min(max(_safe_int(days, 7, 1), 1), 90)
    since = _utcnow() - timedelta(days=days)
    scope = _scope_query(user_context, platform_scope=platform_scope, tenant_id=tenant_id)
    query = {**scope, "created_at": {"$gte": since}}

    projection = {
        "event_type": 1,
        "channel": 1,
        "success": 1,
        "latency_ms": 1,
        "provider": 1,
        "model": 1,
        "fallback_used": 1,
        "intent": 1,
        "action_type": 1,
        "action_status": 1,
        "error_code": 1,
        "created_at": 1,
    }

    collection = _collection(db)
    events = list(
        collection.find(query, projection)
        .sort("created_at", -1)
        .limit(AI_ANALYTICS_MAX_SNAPSHOT_EVENTS)
    )

    event_counts: Counter[str] = Counter()
    channel_counts: Counter[str] = Counter()
    provider_counts: Counter[str] = Counter()
    provider_fallbacks: Counter[str] = Counter()
    action_counts: Counter[str] = Counter()
    action_statuses: Counter[str] = Counter()
    errors: Counter[str] = Counter()
    latencies: Dict[str, List[int]] = defaultdict(list)

    success_count = 0
    fallback_count = 0

    for event in events:
        event_type = _safe_text(event.get("event_type"), 48) or "unknown"
        event_counts[event_type] += 1
        channel_counts[_safe_text(event.get("channel"), 24) or "unknown"] += 1
        if event.get("success"):
            success_count += 1

        provider = _safe_text(event.get("provider"), 48).lower()
        if provider:
            provider_counts[provider] += 1
            if event.get("fallback_used"):
                provider_fallbacks[provider] += 1

        if event.get("fallback_used"):
            fallback_count += 1

        action_type = _safe_text(event.get("action_type"), 96).lower()
        if action_type:
            action_counts[action_type] += 1
        action_status = _safe_text(event.get("action_status"), 48).lower()
        if action_status:
            action_statuses[action_status] += 1

        error_code = _safe_text(event.get("error_code"), 96).lower()
        if error_code:
            errors[error_code] += 1

        if event.get("latency_ms") is not None:
            latency = _safe_int(event.get("latency_ms"), 0, 0)
            latencies[event_type].append(latency)
            latencies["all"].append(latency)

    total = len(events)
    provider_total = sum(provider_counts.values())

    latency_summary: Dict[str, Dict[str, int]] = {}
    for key, values in latencies.items():
        if not values:
            continue
        latency_summary[key] = {
            "count": len(values),
            "average_ms": int(sum(values) / len(values)),
            "p95_ms": _percentile(values, 95),
            "max_ms": max(values),
        }

    return {
        "schema_version": AI_ANALYTICS_SCHEMA_VERSION,
        "generated_at": _utcnow(),
        "window_days": days,
        "platform_scope": bool(platform_scope),
        "tenant_id": _safe_text(tenant_id or _identity_from_context(user_context).get("tenant_id"), 96),
        "event_limit": AI_ANALYTICS_MAX_SNAPSHOT_EVENTS,
        "event_limit_reached": total >= AI_ANALYTICS_MAX_SNAPSHOT_EVENTS,
        "total_events": total,
        "success_events": success_count,
        "failed_events": max(0, total - success_count),
        "success_rate_percent": round((success_count / total) * 100, 2) if total else 0.0,
        "fallback_events": fallback_count,
        "fallback_rate_percent": round((fallback_count / provider_total) * 100, 2) if provider_total else 0.0,
        "events_by_type": dict(event_counts.most_common()),
        "events_by_channel": dict(channel_counts.most_common()),
        "providers": dict(provider_counts.most_common()),
        "provider_fallbacks": dict(provider_fallbacks.most_common()),
        "actions": dict(action_counts.most_common(30)),
        "action_statuses": dict(action_statuses.most_common()),
        "top_errors": dict(errors.most_common(20)),
        "latency": latency_summary,
        "content_storage": "disabled",
        "retention_days": AI_ANALYTICS_RETENTION_DAYS,
    }


def get_saya_health_snapshot(
    *,
    user_context: Optional[Mapping[str, Any]] = None,
    db=None,
) -> Dict[str, Any]:
    """Return operational health for internal/admin use without exposing keys."""
    database = db or get_db()

    provider_status: Dict[str, Any] = {}
    try:
        from app.services.ai_provider_service import ai_provider_status

        raw = ai_provider_status() or {}
        provider_status = {
            "chat_provider": _safe_text(raw.get("chat_provider"), 48),
            "fallback_provider": _safe_text(raw.get("fallback_provider"), 48),
            "stt_provider": _safe_text(raw.get("stt_provider"), 48),
            "tts_provider": _safe_text(raw.get("tts_provider"), 48),
            "groq_configured": bool(raw.get("groq_configured")),
            "gemini_configured": bool(raw.get("gemini_configured")),
            "deepgram_configured": bool(raw.get("deepgram_configured")),
            "sarvam_configured": bool(raw.get("sarvam_configured")),
            "elevenlabs_configured": bool(raw.get("elevenlabs_configured")),
        }
    except Exception:
        provider_status = {"available": False}

    try:
        from app.services.ai_voice_session_service import voice_session_health

        voice_health = voice_session_health(database)
    except Exception:
        voice_health = {"ok": False}

    identity = _identity_from_context(user_context)
    reminder_tenant = "" if _is_platform_superadmin(user_context) else (identity.get("tenant_id") or "")
    try:
        from app.services.ai_reminder_service import due_ai_reminder_count

        due_reminders = due_ai_reminder_count(database, tenant_id=reminder_tenant)
    except Exception:
        due_reminders = None

    try:
        index_health = ensure_ai_analytics_indexes(database)
    except Exception:
        index_health = {"enabled": AI_ANALYTICS_ENABLED, "ok": False}

    return {
        "generated_at": _utcnow(),
        "analytics_enabled": AI_ANALYTICS_ENABLED,
        "analytics_retention_days": AI_ANALYTICS_RETENTION_DAYS,
        "provider": provider_status,
        "voice_sessions": voice_health,
        "due_reminders": due_reminders,
        "analytics_indexes": index_health,
    }


__all__ = [
    "AI_ANALYTICS_COLLECTION",
    "AI_ANALYTICS_SCHEMA_VERSION",
    "AI_ANALYTICS_ENABLED",
    "AI_ANALYTICS_RETENTION_DAYS",
    "new_ai_request_id",
    "ensure_ai_analytics_indexes",
    "record_ai_event",
    "record_chat_event",
    "record_provider_event",
    "record_action_event",
    "record_voice_session_event",
    "record_error_event",
    "infer_action_outcome",
    "get_ai_analytics_snapshot",
    "get_saya_health_snapshot",
]
