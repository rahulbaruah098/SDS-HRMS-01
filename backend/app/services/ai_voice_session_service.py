"""
Saya conversational voice-session service.

This module owns durable, tenant/user-isolated state for Saya voice conversations.
It intentionally does not perform authorization, HRMS writes, speech recognition,
LLM generation, or text-to-speech itself. Those remain in the existing Saya route,
provider, capability, and action layers.

The service is designed for multi-worker production deployments:
- MongoDB-backed sessions (no process-local conversational state)
- random opaque session ids
- tenant + authenticated-user ownership checks on every read/write
- idle expiry + MongoDB TTL cleanup
- idempotent client turn ids
- turn sequencing and bounded transcript history
- interruption / restart / repeat / continue / stop control handling
- compact safe context for the main Saya chat route
- no credentials, raw audio, GPS, or sensitive backend objects stored here

File 22 (final ai_assistant.py integration) can consume this service without
changing the existing text-chat contract. File 23 can then use the structured
voice-session metadata from the route.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from app.extensions import get_db


VOICE_SESSION_COLLECTION = "ai_voice_sessions"
VOICE_SESSION_SCHEMA_VERSION = 1
VOICE_SESSION_PREFIX = "saya_vs_"

VOICE_SESSION_IDLE_MINUTES = 30
VOICE_SESSION_MAX_HOURS = 6
VOICE_SESSION_HISTORY_TURNS = 16
VOICE_SESSION_MAX_TURNS = 80
VOICE_SESSION_MAX_TEXT_CHARS = 2400
VOICE_SESSION_MAX_METADATA_KEYS = 24
VOICE_SESSION_CLIENT_TURN_CACHE = 40

_ACTIVE_STATUSES = {"active", "interrupted"}
_TERMINAL_STATUSES = {"closed", "expired"}


class VoiceSessionError(RuntimeError):
    """Base voice-session error safe for the route layer to catch."""

    code = "voice_session_error"


class VoiceSessionIdentityError(VoiceSessionError):
    code = "voice_session_identity_required"


class VoiceSessionNotFoundError(VoiceSessionError):
    code = "voice_session_not_found"


class VoiceSessionOwnershipError(VoiceSessionError):
    code = "voice_session_scope_mismatch"


class VoiceSessionExpiredError(VoiceSessionError):
    code = "voice_session_expired"


class VoiceSessionClosedError(VoiceSessionError):
    code = "voice_session_closed"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _safe_text(value: Any, limit: int = VOICE_SESSION_MAX_TEXT_CHARS) -> str:
    text = str(value or "")
    text = text.replace("\x00", " ")
    text = re.sub(r"[\t\r ]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if limit and len(text) > limit:
        text = text[:limit].rstrip()
    return text


def _lower(value: Any) -> str:
    return _safe_text(value, 500).lower()


def _bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return _lower(value) in {"1", "true", "yes", "on", "y"}


def _safe_small_value(value: Any, depth: int = 0) -> Any:
    """Keep client/session metadata small and JSON/Mongo friendly."""
    if depth > 3:
        return None

    if value is None or isinstance(value, (bool, int, float)):
        return value

    if isinstance(value, datetime):
        return value

    if isinstance(value, str):
        return _safe_text(value, 600)

    if isinstance(value, Mapping):
        result: Dict[str, Any] = {}
        for index, (key, nested) in enumerate(value.items()):
            if index >= VOICE_SESSION_MAX_METADATA_KEYS:
                break
            clean_key = _safe_text(key, 80)
            if not clean_key:
                continue
            # Never persist common secret-bearing metadata even if a client sends it.
            key_lower = clean_key.lower()
            if any(
                fragment in key_lower
                for fragment in (
                    "password",
                    "secret",
                    "token",
                    "api_key",
                    "apikey",
                    "authorization",
                    "cookie",
                    "private_key",
                    "signature",
                    "latitude",
                    "longitude",
                    "coordinates",
                    "gps",
                    "location",
                )
            ):
                continue
            result[clean_key] = _safe_small_value(nested, depth + 1)
        return result

    if isinstance(value, (list, tuple, set)):
        return [_safe_small_value(item, depth + 1) for item in list(value)[:20]]

    return _safe_text(value, 300)


def _safe_metadata(value: Any) -> Dict[str, Any]:
    cleaned = _safe_small_value(value if isinstance(value, Mapping) else {})
    return cleaned if isinstance(cleaned, dict) else {}


def _session_id() -> str:
    # 192 bits of random entropy; no user/tenant information is encoded in the id.
    return VOICE_SESSION_PREFIX + secrets.token_urlsafe(24)


def _session_fingerprint(session_id: str) -> str:
    return hashlib.sha256(_safe_text(session_id, 200).encode("utf-8")).hexdigest()[:16]


def _identity_from_context(user_context: Optional[Mapping[str, Any]]) -> Dict[str, str]:
    context = dict(user_context or {})

    tenant_id = _safe_text(context.get("tenant_id"), 160)
    is_platform_superadmin = bool(
        context.get("is_platform_superadmin")
        or "super_admin" in (context.get("roles") or [])
    )

    # Platform Super Admin can have no tenant bound to the login. Keep that scope
    # explicit rather than mixing it with ordinary tenant sessions.
    if not tenant_id and is_platform_superadmin:
        tenant_id = "__platform__"

    user_id = _safe_text(
        context.get("user_id")
        or context.get("_id")
        or context.get("employee_id"),
        160,
    )

    if not tenant_id or not user_id:
        raise VoiceSessionIdentityError(
            "A verified tenant/platform scope and authenticated user identity are required for Saya voice sessions."
        )

    return {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "employee_id": _safe_text(context.get("employee_id"), 160),
        "primary_role": _safe_text(context.get("role") or "employee", 80),
    }


def _scope_query(session_id: str, identity: Mapping[str, str]) -> Dict[str, Any]:
    return {
        "session_id": _safe_text(session_id, 200),
        "tenant_id": identity["tenant_id"],
        "user_id": identity["user_id"],
    }


def _as_utc_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _expires_at(now: Optional[datetime] = None) -> datetime:
    return (now or _utcnow()) + timedelta(minutes=VOICE_SESSION_IDLE_MINUTES)


def _absolute_expires_at(now: Optional[datetime] = None) -> datetime:
    return (now or _utcnow()) + timedelta(hours=VOICE_SESSION_MAX_HOURS)


def _effective_expiry(session: Mapping[str, Any], now: Optional[datetime] = None) -> datetime:
    now = _as_utc_datetime(now) or _utcnow()
    idle = _as_utc_datetime(session.get("expires_at"))
    absolute = _as_utc_datetime(session.get("absolute_expires_at"))
    candidates = [value for value in (idle, absolute) if value is not None]
    if not candidates:
        return now
    return min(candidates)


def _is_expired(session: Mapping[str, Any], now: Optional[datetime] = None) -> bool:
    now = now or _utcnow()
    now = _as_utc_datetime(now) or _utcnow()
    expiry = _effective_expiry(session, now=now)
    return expiry <= now


def _collection(db=None):
    database = db or get_db()
    return database[VOICE_SESSION_COLLECTION]


def ensure_voice_session_indexes(db=None) -> Dict[str, bool]:
    """Create safe indexes. Safe to call repeatedly during app startup/requests."""
    collection = _collection(db)
    result = {
        "session_unique": False,
        "scope_lookup": False,
        "ttl": False,
        "activity": False,
    }

    try:
        collection.create_index(
            [("session_id", 1)],
            unique=True,
            name="saya_voice_session_id_unique",
        )
        result["session_unique"] = True
    except Exception:
        pass

    try:
        collection.create_index(
            [("tenant_id", 1), ("user_id", 1), ("status", 1), ("updated_at", -1)],
            name="saya_voice_session_scope",
        )
        result["scope_lookup"] = True
    except Exception:
        pass

    try:
        # expires_at is an absolute datetime. MongoDB removes it after that instant.
        collection.create_index(
            [("expires_at", 1)],
            expireAfterSeconds=0,
            name="saya_voice_session_ttl",
        )
        result["ttl"] = True
    except Exception:
        pass

    try:
        collection.create_index(
            [("status", 1), ("expires_at", 1)],
            name="saya_voice_session_activity",
        )
        result["activity"] = True
    except Exception:
        pass

    return result


def _public_session(session: Optional[Mapping[str, Any]], *, include_history: bool = False) -> Dict[str, Any]:
    session = dict(session or {})
    if not session:
        return {}

    result: Dict[str, Any] = {
        "session_id": _safe_text(session.get("session_id"), 200),
        "schema_version": int(session.get("schema_version") or VOICE_SESSION_SCHEMA_VERSION),
        "status": _safe_text(session.get("status") or "active", 40),
        "turn_count": int(session.get("turn_count") or 0),
        "last_turn_sequence": int(session.get("last_turn_sequence") or 0),
        "awaiting_user_reply": bool(session.get("awaiting_user_reply")),
        "last_action": _safe_text(session.get("last_action"), 120),
        "last_action_step": _safe_text(session.get("last_action_step"), 120),
        "last_action_status": _safe_text(session.get("last_action_status"), 80),
        "last_user_text": _safe_text(session.get("last_user_text"), 800),
        "last_assistant_text": _safe_text(session.get("last_assistant_text"), 1200),
        "interruption_count": int(session.get("interruption_count") or 0),
        "restart_count": int(session.get("restart_count") or 0),
        "created_at": session.get("created_at"),
        "updated_at": session.get("updated_at"),
        "expires_at": session.get("expires_at"),
        "absolute_expires_at": session.get("absolute_expires_at"),
        "language": _safe_text(session.get("language") or "en-IN", 40),
    }

    if include_history:
        result["history"] = _history_for_client(session.get("history") or [])

    return result


def _history_for_client(history: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    output: List[Dict[str, Any]] = []
    for item in list(history)[-VOICE_SESSION_HISTORY_TURNS:]:
        if not isinstance(item, Mapping):
            continue
        role = _safe_text(item.get("role"), 20).lower()
        if role not in {"user", "assistant"}:
            continue
        text = _safe_text(item.get("text"), 1200)
        if not text:
            continue
        output.append(
            {
                "role": role,
                "text": text,
                "sequence": int(item.get("sequence") or 0),
                "at": item.get("at"),
            }
        )
    return output


def start_voice_session(
    user_context: Optional[Mapping[str, Any]],
    *,
    language: str = "en-IN",
    client_session_id: str = "",
    device_metadata: Optional[Mapping[str, Any]] = None,
    db=None,
) -> Dict[str, Any]:
    """Create or safely resume a client-provided voice session."""
    identity = _identity_from_context(user_context)
    collection = _collection(db)
    ensure_voice_session_indexes(db=db)
    now = _utcnow()

    requested_id = _safe_text(client_session_id, 200)
    if requested_id:
        existing = collection.find_one(_scope_query(requested_id, identity))
        if existing:
            if _is_expired(existing, now=now):
                collection.update_one(
                    _scope_query(requested_id, identity),
                    {"$set": {"status": "expired", "updated_at": now}},
                )
            elif _safe_text(existing.get("status")) in _ACTIVE_STATUSES:
                collection.update_one(
                    _scope_query(requested_id, identity),
                    {
                        "$set": {
                            "status": "active",
                            "updated_at": now,
                            "expires_at": min(
                                _expires_at(now),
                                _as_utc_datetime(existing.get("absolute_expires_at"))
                                or _absolute_expires_at(now),
                            ),
                        }
                    },
                )
                return _public_session(
                    collection.find_one(_scope_query(requested_id, identity)),
                    include_history=True,
                )

    session_id = _session_id()
    absolute_expiry = _absolute_expires_at(now)
    idle_expiry = min(_expires_at(now), absolute_expiry)

    document = {
        "schema_version": VOICE_SESSION_SCHEMA_VERSION,
        "session_id": session_id,
        "session_fingerprint": _session_fingerprint(session_id),
        "tenant_id": identity["tenant_id"],
        "user_id": identity["user_id"],
        "employee_id": identity.get("employee_id") or "",
        "primary_role": identity.get("primary_role") or "employee",
        "status": "active",
        "language": _safe_text(language or "en-IN", 40) or "en-IN",
        "device_metadata": _safe_metadata(device_metadata),
        "created_at": now,
        "updated_at": now,
        "last_activity_at": now,
        "expires_at": idle_expiry,
        "absolute_expires_at": absolute_expiry,
        "turn_count": 0,
        "last_turn_sequence": 0,
        "history": [],
        "processed_client_turn_ids": [],
        "last_user_text": "",
        "last_assistant_text": "",
        "last_action": "",
        "last_action_step": "",
        "last_action_status": "",
        "awaiting_user_reply": False,
        "interruption_count": 0,
        "restart_count": 0,
        "last_interrupted_at": None,
        "last_restart_at": None,
        "closed_at": None,
        "close_reason": "",
    }

    collection.insert_one(document)
    return _public_session(document, include_history=True)


def _load_owned_session(
    user_context: Optional[Mapping[str, Any]],
    session_id: str,
    *,
    db=None,
    allow_terminal: bool = False,
    touch: bool = False,
) -> Tuple[Dict[str, str], Dict[str, Any]]:
    identity = _identity_from_context(user_context)
    clean_session_id = _safe_text(session_id, 200)
    if not clean_session_id:
        raise VoiceSessionNotFoundError("Saya voice session id is required.")

    collection = _collection(db)
    scoped = collection.find_one(_scope_query(clean_session_id, identity))
    if not scoped:
        # Distinguish "missing" from "belongs to somebody else" without revealing
        # who owns the session to the caller.
        any_scope = collection.find_one({"session_id": clean_session_id}, {"_id": 1})
        if any_scope:
            raise VoiceSessionOwnershipError("This Saya voice session is not available for the current login.")
        raise VoiceSessionNotFoundError("Saya voice session was not found.")

    now = _utcnow()
    if _is_expired(scoped, now=now):
        collection.update_one(
            _scope_query(clean_session_id, identity),
            {"$set": {"status": "expired", "updated_at": now}},
        )
        raise VoiceSessionExpiredError("This Saya voice session has expired. Start a new voice session.")

    status = _safe_text(scoped.get("status"))
    if not allow_terminal and status in _TERMINAL_STATUSES:
        raise VoiceSessionClosedError("This Saya voice session has ended. Start a new voice session.")

    if touch:
        absolute = _as_utc_datetime(scoped.get("absolute_expires_at")) or _absolute_expires_at(now)
        next_expiry = min(_expires_at(now), absolute)
        collection.update_one(
            _scope_query(clean_session_id, identity),
            {
                "$set": {
                    "updated_at": now,
                    "last_activity_at": now,
                    "expires_at": next_expiry,
                }
            },
        )
        scoped["updated_at"] = now
        scoped["last_activity_at"] = now
        scoped["expires_at"] = next_expiry

    return identity, scoped


def get_voice_session(
    user_context: Optional[Mapping[str, Any]],
    session_id: str,
    *,
    include_history: bool = True,
    db=None,
) -> Dict[str, Any]:
    _, session = _load_owned_session(
        user_context,
        session_id,
        db=db,
        touch=True,
    )
    return _public_session(session, include_history=include_history)


def _normalized_control_text(text: str) -> str:
    normalized = _lower(text)
    normalized = re.sub(r"[^a-z0-9\s']+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def detect_voice_control(text: str) -> Dict[str, Any]:
    """
    Recognize explicit conversation controls only.

    We deliberately keep this narrow so ordinary HRMS phrases containing words
    such as "stop" or "continue" are not swallowed by the voice layer.
    """
    value = _normalized_control_text(text)
    if not value:
        return {"control": "none", "matched": False}

    stop_phrases = {
        "stop",
        "stop saya",
        "saya stop",
        "end conversation",
        "end the conversation",
        "end voice",
        "close saya",
        "goodbye saya",
        "bye saya",
    }
    restart_phrases = {
        "start over",
        "start again",
        "restart",
        "restart saya",
        "new conversation",
        "clear conversation",
    }
    repeat_phrases = {
        "repeat",
        "repeat that",
        "say that again",
        "say it again",
        "can you repeat",
        "please repeat",
    }
    continue_phrases = {
        "continue",
        "continue saya",
        "go on",
        "please continue",
        "keep going",
    }

    if value in stop_phrases:
        return {"control": "stop", "matched": True}
    if value in restart_phrases:
        return {"control": "restart", "matched": True}
    if value in repeat_phrases:
        return {"control": "repeat", "matched": True}
    if value in continue_phrases:
        return {"control": "continue", "matched": True}

    return {"control": "none", "matched": False}


def _bounded_history(history: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    items = [dict(item) for item in history if isinstance(item, Mapping)]
    # Keep more raw turns than we expose to the model/client, but never unbounded.
    return items[-(VOICE_SESSION_HISTORY_TURNS * 2) :]


def build_voice_chat_history(session: Mapping[str, Any]) -> List[Dict[str, str]]:
    """Return the format already accepted by Saya's /chat history sanitizer."""
    result: List[Dict[str, str]] = []
    for item in _history_for_client(session.get("history") or []):
        result.append({"role": item["role"], "text": _safe_text(item["text"], 1200)})
    return result


def prepare_voice_turn(
    user_context: Optional[Mapping[str, Any]],
    session_id: str,
    transcript: str,
    *,
    client_turn_id: str = "",
    language: str = "",
    wake_word_detected: bool = False,
    interrupted_previous_speech: bool = False,
    db=None,
) -> Dict[str, Any]:
    """
    Register a final user transcript before the main Saya answer is generated.

    Returns history + control metadata. It never executes an HRMS action itself.
    """
    clean_text = _safe_text(transcript)
    if not clean_text:
        return {
            "accepted": False,
            "reason": "empty_transcript",
            "control": "none",
        }

    identity, session = _load_owned_session(
        user_context,
        session_id,
        db=db,
        touch=True,
    )
    collection = _collection(db)
    now = _utcnow()

    if int(session.get("turn_count") or 0) >= VOICE_SESSION_MAX_TURNS:
        closed = close_voice_session(
            user_context,
            session_id,
            reason="maximum_turns_reached",
            db=db,
        )
        return {
            "accepted": False,
            "control": "stop",
            "should_end": True,
            "reason": "maximum_turns_reached",
            "answer_override": (
                "This voice conversation has reached its turn limit. "
                "Please start a new Saya voice session to continue."
            ),
            "session": closed,
            "history": build_voice_chat_history(session),
        }

    clean_client_turn_id = _safe_text(client_turn_id, 160)
    processed_ids = [
        _safe_text(item, 160)
        for item in (session.get("processed_client_turn_ids") or [])
        if _safe_text(item, 160)
    ][-VOICE_SESSION_CLIENT_TURN_CACHE:]

    if clean_client_turn_id and clean_client_turn_id in processed_ids:
        return {
            "accepted": False,
            "duplicate": True,
            "reason": "duplicate_client_turn",
            "session": _public_session(session, include_history=True),
            "history": build_voice_chat_history(session),
            "control": "none",
        }

    control = detect_voice_control(clean_text)

    if control["control"] == "stop":
        closed = close_voice_session(
            user_context,
            session_id,
            reason="voice_stop_command",
            db=db,
        )
        return {
            "accepted": False,
            "control": "stop",
            "should_end": True,
            "answer_override": "Voice conversation ended.",
            "session": closed,
            "history": build_voice_chat_history(session),
        }

    if control["control"] == "restart":
        restarted = restart_voice_session(
            user_context,
            session_id,
            db=db,
        )
        return {
            "accepted": False,
            "control": "restart",
            "restart": True,
            "answer_override": "Conversation context cleared. What would you like help with?",
            "session": restarted,
            "history": [],
        }

    if control["control"] == "repeat":
        last_answer = _safe_text(session.get("last_assistant_text"), 1800)
        return {
            "accepted": False,
            "control": "repeat",
            "repeat": True,
            "answer_override": last_answer or "There is no previous Saya response to repeat in this voice session.",
            "session": _public_session(session, include_history=True),
            "history": build_voice_chat_history(session),
        }

    sequence = int(session.get("last_turn_sequence") or 0) + 1
    history = _bounded_history(session.get("history") or [])
    history.append(
        {
            "role": "user",
            "text": clean_text,
            "sequence": sequence,
            "at": now,
            "client_turn_id": clean_client_turn_id,
            "wake_word_detected": bool(wake_word_detected),
        }
    )
    history = _bounded_history(history)

    if clean_client_turn_id:
        processed_ids.append(clean_client_turn_id)
        processed_ids = processed_ids[-VOICE_SESSION_CLIENT_TURN_CACHE:]

    update_set: Dict[str, Any] = {
        "status": "active",
        "updated_at": now,
        "last_activity_at": now,
        "last_user_text": clean_text,
        "last_turn_sequence": sequence,
        "history": history,
        "processed_client_turn_ids": processed_ids,
        "awaiting_user_reply": False,
    }
    if language:
        update_set["language"] = _safe_text(language, 40)
    if interrupted_previous_speech:
        update_set["last_interrupted_at"] = now

    update_doc: Dict[str, Any] = {"$set": update_set, "$inc": {"turn_count": 1}}
    if interrupted_previous_speech:
        update_doc["$inc"]["interruption_count"] = 1

    collection.update_one(_scope_query(session_id, identity), update_doc)
    updated = collection.find_one(_scope_query(session_id, identity)) or session

    return {
        "accepted": True,
        "duplicate": False,
        "control": control["control"],  # "continue" can be useful to the route/provider.
        "sequence": sequence,
        "question": clean_text,
        "history": build_voice_chat_history(updated),
        "session": _public_session(updated, include_history=False),
        "interrupted_previous_speech": bool(interrupted_previous_speech),
    }


def record_voice_assistant_turn(
    user_context: Optional[Mapping[str, Any]],
    session_id: str,
    answer: str,
    *,
    sequence: int = 0,
    action_metadata: Optional[Mapping[str, Any]] = None,
    response_metadata: Optional[Mapping[str, Any]] = None,
    awaiting_user_reply: Optional[bool] = None,
    db=None,
) -> Dict[str, Any]:
    """Persist Saya's completed response after the chat/action pipeline succeeds."""
    clean_answer = _safe_text(answer)
    identity, session = _load_owned_session(
        user_context,
        session_id,
        db=db,
        touch=True,
    )
    collection = _collection(db)
    now = _utcnow()

    effective_sequence = int(sequence or session.get("last_turn_sequence") or 0)
    action_metadata = _safe_metadata(action_metadata)
    response_metadata = _safe_metadata(response_metadata)

    history = _bounded_history(session.get("history") or [])
    if clean_answer:
        history.append(
            {
                "role": "assistant",
                "text": clean_answer,
                "sequence": effective_sequence,
                "at": now,
                "action": _safe_text(action_metadata.get("action"), 120),
                "step": _safe_text(action_metadata.get("step"), 120),
                "status": _safe_text(action_metadata.get("status"), 80),
            }
        )
        history = _bounded_history(history)

    if awaiting_user_reply is None:
        awaiting_user_reply = bool(
            action_metadata.get("requires_confirmation")
            or action_metadata.get("step")
            or action_metadata.get("status") in {"awaiting_input", "awaiting_confirmation"}
        )

    update = {
        "status": "active",
        "updated_at": now,
        "last_activity_at": now,
        "last_assistant_text": clean_answer,
        "history": history,
        "awaiting_user_reply": bool(awaiting_user_reply),
        "last_action": _safe_text(action_metadata.get("action"), 120),
        "last_action_step": _safe_text(action_metadata.get("step"), 120),
        "last_action_status": _safe_text(action_metadata.get("status"), 80),
        "last_response_metadata": response_metadata,
    }

    collection.update_one(_scope_query(session_id, identity), {"$set": update})
    updated = collection.find_one(_scope_query(session_id, identity)) or session
    return _public_session(updated, include_history=False)


def mark_voice_interruption(
    user_context: Optional[Mapping[str, Any]],
    session_id: str,
    *,
    reason: str = "user_started_speaking",
    db=None,
) -> Dict[str, Any]:
    identity, session = _load_owned_session(
        user_context,
        session_id,
        db=db,
        touch=True,
    )
    collection = _collection(db)
    now = _utcnow()
    collection.update_one(
        _scope_query(session_id, identity),
        {
            "$set": {
                "status": "interrupted",
                "last_interrupted_at": now,
                "interruption_reason": _safe_text(reason, 160),
                "updated_at": now,
                "last_activity_at": now,
            },
            "$inc": {"interruption_count": 1},
        },
    )
    updated = collection.find_one(_scope_query(session_id, identity)) or session
    return _public_session(updated, include_history=False)


def restart_voice_session(
    user_context: Optional[Mapping[str, Any]],
    session_id: str,
    *,
    db=None,
) -> Dict[str, Any]:
    identity, session = _load_owned_session(
        user_context,
        session_id,
        db=db,
        touch=True,
    )
    collection = _collection(db)
    now = _utcnow()

    collection.update_one(
        _scope_query(session_id, identity),
        {
            "$set": {
                "status": "active",
                "updated_at": now,
                "last_activity_at": now,
                "history": [],
                "processed_client_turn_ids": [],
                "turn_count": 0,
                "last_turn_sequence": 0,
                "last_user_text": "",
                "last_assistant_text": "",
                "last_action": "",
                "last_action_step": "",
                "last_action_status": "",
                "awaiting_user_reply": False,
                "last_restart_at": now,
            },
            "$inc": {"restart_count": 1},
        },
    )
    updated = collection.find_one(_scope_query(session_id, identity)) or session
    return _public_session(updated, include_history=True)


def close_voice_session(
    user_context: Optional[Mapping[str, Any]],
    session_id: str,
    *,
    reason: str = "client_end",
    db=None,
) -> Dict[str, Any]:
    identity, session = _load_owned_session(
        user_context,
        session_id,
        db=db,
        allow_terminal=True,
        touch=False,
    )
    collection = _collection(db)
    now = _utcnow()

    collection.update_one(
        _scope_query(session_id, identity),
        {
            "$set": {
                "status": "closed",
                "closed_at": now,
                "close_reason": _safe_text(reason, 160),
                "updated_at": now,
                # Let MongoDB remove closed session state soon; no need to retain
                # long-lived conversational transcripts.
                "expires_at": min(_expires_at(now), now + timedelta(minutes=10)),
                "awaiting_user_reply": False,
            }
        },
    )
    updated = collection.find_one(_scope_query(session_id, identity)) or session
    return _public_session(updated, include_history=False)


def close_other_active_voice_sessions(
    user_context: Optional[Mapping[str, Any]],
    *,
    keep_session_id: str = "",
    reason: str = "replaced_by_new_session",
    db=None,
) -> int:
    """Optional helper for clients that want exactly one active Saya voice session."""
    identity = _identity_from_context(user_context)
    now = _utcnow()
    query: Dict[str, Any] = {
        "tenant_id": identity["tenant_id"],
        "user_id": identity["user_id"],
        "status": {"$in": list(_ACTIVE_STATUSES)},
    }
    keep = _safe_text(keep_session_id, 200)
    if keep:
        query["session_id"] = {"$ne": keep}

    result = _collection(db).update_many(
        query,
        {
            "$set": {
                "status": "closed",
                "closed_at": now,
                "close_reason": _safe_text(reason, 160),
                "updated_at": now,
                "expires_at": now + timedelta(minutes=10),
                "awaiting_user_reply": False,
            }
        },
    )
    return int(getattr(result, "modified_count", 0) or 0)


def get_latest_active_voice_session(
    user_context: Optional[Mapping[str, Any]],
    *,
    db=None,
) -> Dict[str, Any]:
    identity = _identity_from_context(user_context)
    collection = _collection(db)
    now = _utcnow()
    session = collection.find_one(
        {
            "tenant_id": identity["tenant_id"],
            "user_id": identity["user_id"],
            "status": {"$in": list(_ACTIVE_STATUSES)},
            "expires_at": {"$gt": now},
        },
        sort=[("updated_at", -1)],
    )
    if not session:
        return {}
    if _is_expired(session, now=now):
        return {}
    return _public_session(session, include_history=True)


def session_context_for_saya(
    user_context: Optional[Mapping[str, Any]],
    session_id: str,
    *,
    db=None,
) -> Dict[str, Any]:
    """
    Compact trusted context intended for the route to attach to user_context.

    It intentionally excludes tenant/user identifiers, device metadata, and raw
    MongoDB fields because those are already known to the authenticated route.
    """
    _, session = _load_owned_session(
        user_context,
        session_id,
        db=db,
        touch=True,
    )
    return {
        "voice_session_id": _safe_text(session.get("session_id"), 200),
        "voice_turn_count": int(session.get("turn_count") or 0),
        "voice_last_user_text": _safe_text(session.get("last_user_text"), 800),
        "voice_last_assistant_text": _safe_text(session.get("last_assistant_text"), 1000),
        "voice_last_action": _safe_text(session.get("last_action"), 120),
        "voice_last_action_step": _safe_text(session.get("last_action_step"), 120),
        "voice_last_action_status": _safe_text(session.get("last_action_status"), 80),
        "voice_awaiting_user_reply": bool(session.get("awaiting_user_reply")),
        "voice_interruption_count": int(session.get("interruption_count") or 0),
        "voice_language": _safe_text(session.get("language") or "en-IN", 40),
    }


def voice_session_health(db=None) -> Dict[str, Any]:
    """Small operational snapshot for File 21 analytics/health integration."""
    collection = _collection(db)
    now = _utcnow()
    try:
        active = collection.count_documents(
            {"status": {"$in": list(_ACTIVE_STATUSES)}, "expires_at": {"$gt": now}}
        )
        interrupted = collection.count_documents(
            {"status": "interrupted", "expires_at": {"$gt": now}}
        )
        expired_pending_ttl = collection.count_documents({"expires_at": {"$lte": now}})
        return {
            "ok": True,
            "active_sessions": int(active),
            "interrupted_sessions": int(interrupted),
            "expired_pending_ttl_cleanup": int(expired_pending_ttl),
            "schema_version": VOICE_SESSION_SCHEMA_VERSION,
        }
    except Exception:
        return {
            "ok": False,
            "active_sessions": 0,
            "interrupted_sessions": 0,
            "expired_pending_ttl_cleanup": 0,
            "schema_version": VOICE_SESSION_SCHEMA_VERSION,
        }


__all__ = [
    "VOICE_SESSION_COLLECTION",
    "VOICE_SESSION_SCHEMA_VERSION",
    "VoiceSessionError",
    "VoiceSessionIdentityError",
    "VoiceSessionNotFoundError",
    "VoiceSessionOwnershipError",
    "VoiceSessionExpiredError",
    "VoiceSessionClosedError",
    "ensure_voice_session_indexes",
    "start_voice_session",
    "get_voice_session",
    "get_latest_active_voice_session",
    "prepare_voice_turn",
    "record_voice_assistant_turn",
    "mark_voice_interruption",
    "restart_voice_session",
    "close_voice_session",
    "close_other_active_voice_sessions",
    "detect_voice_control",
    "build_voice_chat_history",
    "session_context_for_saya",
    "voice_session_health",
]
