"""
Saya structured intent router.

This module is deliberately limited to language understanding.  It does not
check permissions, query HRMS data, or execute actions.  Those responsibilities
remain in the capability/action services.

File 8 introduces a conservative hybrid router:
1. Deterministic high-confidence rules for common Saya commands.
2. Optional LLM classification only when the deterministic pass is ambiguous.
3. Strict allow-list validation before any intent is returned as actionable.

The public API is ``route_saya_intent(question, ...)``.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, asdict
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.services.ai_provider_service import AiProviderError, generate_ai_chat_response


ROUTER_SCHEMA_VERSION = 1

# Keep this list aligned with ACTION_REGISTRY in ai_action_service.py.
# File 9 will wire this router into that service.  The router intentionally
# does not import ai_action_service to avoid a circular dependency.
EXECUTABLE_ACTION_INTENTS = {
    "apply_leave",
    "attendance_check_in",
    "attendance_check_out",
    "schedule_management_meeting",
    "create_reminder",
}

SPECIAL_INTENTS = {
    "cancel",
    "informational",
    "none",
}

ALLOWED_INTENTS = EXECUTABLE_ACTION_INTENTS | SPECIAL_INTENTS

DEFAULT_ACTION_THRESHOLD = 0.78
DEFAULT_INFO_THRESHOLD = 0.62


@dataclass
class SayaIntentResult:
    intent: str = "none"
    confidence: float = 0.0
    is_action: bool = False
    source: str = "deterministic"
    slots: Dict[str, Any] = None
    reason: str = ""
    schema_version: int = ROUTER_SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["slots"] = dict(self.slots or {})
        return data


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = _safe_str(os.getenv(name, ""))
    if not raw:
        return bool(default)
    return raw.lower() in {"1", "true", "yes", "on", "enabled"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return float(default)


def _clamp_confidence(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def _normalise_text(value: Any) -> str:
    text = _safe_str(value).lower()
    text = text.replace("’", "'")
    text = re.sub(r"\s+", " ", text).strip()

    # Remove common wake words only at the beginning. Do not strip arbitrary
    # occurrences of "saya" from the middle of a user's sentence.
    text = re.sub(
        r"^(?:hey|hi|hello)?\s*(?:saya|saaya|saiya|sayaa)\s*[,.:;!?-]*\s*",
        "",
        text,
        count=1,
    ).strip()
    return text


def _contains_any(text: str, phrases: Iterable[str]) -> bool:
    return any(phrase in text for phrase in phrases)


def _word_present(text: str, word: str) -> bool:
    return bool(re.search(rf"\b{re.escape(word)}\b", text))


def _looks_informational(text: str) -> bool:
    """Return True when the user is asking how/what/where rather than acting."""
    if not text:
        return False

    explicit = (
        "how to ",
        "how do i ",
        "how can i ",
        "how should i ",
        "what is the process",
        "what's the process",
        "what are the steps",
        "what are steps",
        "steps to ",
        "process to ",
        "procedure to ",
        "where can i ",
        "where do i ",
        "where should i ",
        "tell me how",
        "can you tell me how",
        "could you tell me how",
        "would you tell me how",
        "explain how",
        "explain the process",
        "can you explain",
    )

    if text.startswith(explicit):
        return True

    return False


def _detect_cancel(text: str) -> Optional[SayaIntentResult]:
    phrases = (
        "cancel",
        "cancel this",
        "stop this",
        "stop the action",
        "clear action",
        "forget this",
        "restart action",
        "exit leave",
        "exit meeting",
        "exit reminder",
        "never mind",
        "nevermind",
    )
    if text in phrases or _contains_any(text, phrases):
        return SayaIntentResult(
            intent="cancel",
            confidence=0.99,
            is_action=False,
            source="deterministic",
            slots={},
            reason="Explicit cancellation language detected.",
        )
    return None


def _extract_leave_slots(text: str) -> Dict[str, Any]:
    slots: Dict[str, Any] = {}

    leave_types = (
        ("casual_leave", ("casual leave", " cl ", "cl leave", "put cl", "mark cl")),
        ("earned_leave", ("earned leave", " el ", "el leave", "put el", "mark el")),
        ("half_day", ("half day", "half-day", "half leave")),
        ("sick_leave", ("sick leave", "medical leave")),
        ("work_from_home", ("work from home", "wfh")),
    )

    padded = f" {text} "
    for value, phrases in leave_types:
        if any(phrase in padded for phrase in phrases):
            slots["leave_type"] = value
            break

    # Keep natural date text instead of normalising dates here. The action
    # service remains the canonical HRMS date/business-rule parser.
    date_match = re.search(
        r"\b(today|tomorrow|day after tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
        r"(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
        r"\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|"
        r"\d{4}-\d{1,2}-\d{1,2}|"
        r"\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
        r"aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{2,4})?)\b",
        text,
        flags=re.IGNORECASE,
    )
    if date_match:
        slots["date_text"] = date_match.group(0)

    return slots


def _detect_leave(text: str) -> Optional[SayaIntentResult]:
    slots = _extract_leave_slots(text)

    strong_phrases = (
        "apply leave",
        "apply for leave",
        "request leave",
        "submit leave request",
        "create leave request",
        "start leave request",
        "leave application",
        "mark my leave",
        "put my leave",
        "put leave",
        "put cl",
        "put el",
        "book leave",
        "take leave",
        "i need leave",
        "i want leave",
        "need casual leave",
        "need earned leave",
        "need sick leave",
    )

    if _contains_any(text, strong_phrases):
        return SayaIntentResult(
            intent="apply_leave",
            confidence=0.97,
            is_action=True,
            source="deterministic",
            slots=slots,
            reason="Direct leave-application command detected.",
        )

    # Natural employee phrasing that previously required many hard-coded
    # variants: "I won't be coming tomorrow, put CL for me" etc.
    absence_signal = _contains_any(
        text,
        (
            "won't be coming",
            "will not be coming",
            "cannot come",
            "can't come",
            "not coming to office",
            "will be absent",
            "i am sick",
            "i'm sick",
            "feeling sick",
            "not well",
        ),
    )
    action_signal = _contains_any(text, ("put", "mark", "apply", "request", "book", "take"))
    leave_signal = _word_present(text, "leave") or "cl" in text.split() or "el" in text.split()

    if (absence_signal and action_signal) or (action_signal and leave_signal):
        return SayaIntentResult(
            intent="apply_leave",
            confidence=0.90,
            is_action=True,
            source="deterministic",
            slots=slots,
            reason="Natural-language leave request detected.",
        )

    return None


def _detect_attendance(text: str) -> Optional[SayaIntentResult]:
    check_in_phrases = (
        "check me in",
        "check in me",
        "check-in me",
        "checkin me",
        "mark my check in",
        "mark my check-in",
        "mark attendance in",
        "punch me in",
        "punch in",
        "clock me in",
        "clock in",
        "start my attendance",
    )
    check_out_phrases = (
        "check me out",
        "check out me",
        "check-out me",
        "checkout me",
        "mark my check out",
        "mark my check-out",
        "mark attendance out",
        "punch me out",
        "punch out",
        "clock me out",
        "clock out",
        "end my attendance",
    )

    if _contains_any(text, check_out_phrases):
        return SayaIntentResult(
            intent="attendance_check_out",
            confidence=0.99,
            is_action=True,
            source="deterministic",
            slots={},
            reason="Direct attendance check-out command detected.",
        )

    if _contains_any(text, check_in_phrases):
        return SayaIntentResult(
            intent="attendance_check_in",
            confidence=0.99,
            is_action=True,
            source="deterministic",
            slots={},
            reason="Direct attendance check-in command detected.",
        )

    return None


def _detect_management_meeting(text: str) -> Optional[SayaIntentResult]:
    phrases = (
        "schedule management group meeting",
        "schedule a management group meeting",
        "create management group meeting",
        "set up management group meeting",
        "setup management group meeting",
        "schedule meeting",
        "schedule a meeting",
        "create meeting",
        "create a meeting",
        "set a meeting",
        "set up meeting",
        "set up a meeting",
        "setup meeting",
    )
    if _contains_any(text, phrases):
        return SayaIntentResult(
            intent="schedule_management_meeting",
            confidence=0.94,
            is_action=True,
            source="deterministic",
            slots={},
            reason="Direct meeting-scheduling command detected.",
        )
    return None


def _extract_reminder_slots(text: str) -> Dict[str, Any]:
    slots: Dict[str, Any] = {}

    # Keep extraction intentionally lightweight. The reminder action service
    # remains responsible for canonical schedule parsing and validation.
    body = re.sub(
        r"^(?:please\s+)?(?:remind me|set (?:a )?reminder|create (?:a )?reminder|add (?:a )?reminder)\s*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip(" ,.-")
    if body:
        slots["raw_reminder_request"] = body

    time_match = re.search(
        r"\b(today|tomorrow|day after tomorrow|next\s+\w+|\d{4}-\d{1,2}-\d{1,2}|"
        r"\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}\s+[a-z]+(?:\s+\d{2,4})?)"
        r"(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b",
        text,
        flags=re.IGNORECASE,
    )
    if time_match:
        slots["schedule_text"] = time_match.group(0)

    return slots


def _detect_reminder(text: str) -> Optional[SayaIntentResult]:
    phrases = (
        "remind me",
        "set reminder",
        "set a reminder",
        "create reminder",
        "create a reminder",
        "add reminder",
        "add a reminder",
    )
    if _contains_any(text, phrases):
        return SayaIntentResult(
            intent="create_reminder",
            confidence=0.98,
            is_action=True,
            source="deterministic",
            slots=_extract_reminder_slots(text),
            reason="Direct reminder-creation command detected.",
        )
    return None


def _deterministic_route(question: Any) -> SayaIntentResult:
    text = _normalise_text(question)
    if not text:
        return SayaIntentResult(slots={}, reason="Empty request.")

    cancel = _detect_cancel(text)
    if cancel:
        return cancel

    if _looks_informational(text):
        return SayaIntentResult(
            intent="informational",
            confidence=0.97,
            is_action=False,
            source="deterministic",
            slots={},
            reason="Workflow/information question detected; no write action should start.",
        )

    for detector in (
        _detect_attendance,
        _detect_leave,
        _detect_management_meeting,
        _detect_reminder,
    ):
        result = detector(text)
        if result:
            return result

    return SayaIntentResult(
        intent="none",
        confidence=0.45,
        is_action=False,
        source="deterministic",
        slots={},
        reason="No high-confidence deterministic action intent detected.",
    )


def _extract_json_object(text: Any) -> Dict[str, Any]:
    raw = _safe_str(text)
    if not raw:
        return {}

    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw).strip()

    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass

    # Conservative recovery for providers that add one sentence around JSON.
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(raw[start : end + 1])
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    return {}


def _clean_slots(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {}

    cleaned: Dict[str, Any] = {}
    for key, item in value.items():
        key_text = _safe_str(key)[:60]
        if not key_text:
            continue
        if item is None:
            continue
        if isinstance(item, (str, int, float, bool)):
            if isinstance(item, str):
                item = item.strip()[:500]
            cleaned[key_text] = item
    return cleaned


def _should_try_llm(question: Any) -> bool:
    """Avoid a second AI call for ordinary non-action HRMS questions."""
    text = _normalise_text(question)
    if not text:
        return False

    action_cues = (
        "leave", "cl", "el", "check in", "check out", "check-in", "check-out",
        "punch", "clock", "attendance", "meeting", "remind", "reminder",
        "absent", "not coming", "won't be coming", "will not be coming",
        "cannot come", "can't come", "sick", "not well",
    )
    return _contains_any(text, action_cues)


def _llm_route(question: Any) -> Optional[SayaIntentResult]:
    if not _env_bool("SAYA_INTENT_LLM_ENABLED", True):
        return None

    text = _safe_str(question)[:2000]
    if not text:
        return None

    system_prompt = """
You are Saya's intent classifier for an HRMS. Classify language only.
You NEVER authorize, execute, confirm, or claim an HRMS action happened.

Allowed intents exactly:
- apply_leave
- attendance_check_in
- attendance_check_out
- schedule_management_meeting
- create_reminder
- cancel
- informational
- none

Critical rules:
1. Questions asking HOW, WHAT, WHERE, PROCESS, STEPS, or EXPLANATION are informational, not actions.
2. A direct command to perform an action is an action intent.
3. Be conservative. If unclear, return none.
4. Never invent an intent outside the allow-list.
5. Slots may contain only information explicitly stated by the user.
6. "Can you tell me how to check in?" = informational.
7. "Check me in" = attendance_check_in.
8. "I won't be coming tomorrow, put CL for me" = apply_leave.
9. "How do I apply CL?" = informational.
10. "Remind me tomorrow at 10 AM to submit the report" = create_reminder.

Return JSON only in this exact shape:
{"intent":"none","confidence":0.0,"slots":{},"reason":"short reason"}
""".strip()

    try:
        result = generate_ai_chat_response(
            system_prompt=system_prompt,
            user_prompt=text,
            temperature=0.0,
            max_tokens=220,
            timeout=int(os.getenv("SAYA_INTENT_TIMEOUT_SECONDS", "12")),
        )
    except (AiProviderError, Exception):
        # Intent routing must never make Saya unavailable. The deterministic
        # router remains a safe fallback if the provider is unavailable.
        return None

    payload = _extract_json_object(result.get("text") or result.get("answer"))
    intent = _safe_str(payload.get("intent")).lower()
    confidence = _clamp_confidence(payload.get("confidence"))

    if intent not in ALLOWED_INTENTS:
        return None

    is_action = intent in EXECUTABLE_ACTION_INTENTS
    return SayaIntentResult(
        intent=intent,
        confidence=confidence,
        is_action=is_action,
        source=f"llm:{_safe_str(result.get('provider')) or 'provider'}",
        slots=_clean_slots(payload.get("slots")),
        reason=_safe_str(payload.get("reason"))[:240],
    )


def _passes_threshold(result: SayaIntentResult) -> bool:
    if result.intent in EXECUTABLE_ACTION_INTENTS:
        threshold = _env_float("SAYA_INTENT_ACTION_THRESHOLD", DEFAULT_ACTION_THRESHOLD)
        return result.confidence >= threshold
    if result.intent in {"informational", "cancel"}:
        threshold = _env_float("SAYA_INTENT_INFO_THRESHOLD", DEFAULT_INFO_THRESHOLD)
        return result.confidence >= threshold
    return result.intent == "none"


def route_saya_intent(
    question: Any,
    *,
    use_llm_fallback: bool = True,
) -> Dict[str, Any]:
    """
    Classify a Saya user request into a structured, allow-listed intent.

    This function is intentionally side-effect free. It must never execute an
    action or determine authorization.
    """
    deterministic = _deterministic_route(question)

    # High-confidence rules are faster, cheaper, and more predictable than an
    # LLM call. Keep them whenever they pass their safety threshold.
    if deterministic.intent != "none" and _passes_threshold(deterministic):
        return deterministic.to_dict()

    if use_llm_fallback and _should_try_llm(question):
        llm_result = _llm_route(question)
        if llm_result and _passes_threshold(llm_result):
            return llm_result.to_dict()

    # Preserve a deterministic none result instead of treating uncertainty as
    # permission to start a write flow.
    return SayaIntentResult(
        intent="none",
        confidence=max(0.0, deterministic.confidence),
        is_action=False,
        source="deterministic",
        slots={},
        reason="The request was not classified as a safe high-confidence action.",
    ).to_dict()


def intent_name(question: Any, *, use_llm_fallback: bool = True) -> str:
    """Compatibility helper returning only the routed intent name."""
    result = route_saya_intent(question, use_llm_fallback=use_llm_fallback)
    intent = _safe_str(result.get("intent"))
    return "" if intent in {"none", "informational"} else intent


__all__ = [
    "ROUTER_SCHEMA_VERSION",
    "EXECUTABLE_ACTION_INTENTS",
    "ALLOWED_INTENTS",
    "route_saya_intent",
    "intent_name",
]
