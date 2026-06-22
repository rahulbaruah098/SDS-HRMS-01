import base64
import io
import mimetypes
import os
import re
import wave
from datetime import datetime
import requests

from bson import ObjectId
from flask import Blueprint, request, jsonify, g, Response

from app.extensions import get_db
from app.services.ai_assistant_service import generate_ai_answer, seed_ai_knowledge
from app.services.ai_provider_service import (
    AiProviderError,
    synthesize_ai_speech,
    transcribe_ai_audio,
)
from app.utils.auth import current_user_required, roles_required, normalize_roles


ai_assistant_bp = Blueprint("ai_assistant", __name__)



GEMINI_API_KEY = (
    os.getenv("GEMINI_API_KEY", "").strip()
    or os.getenv("GOOGLE_API_KEY", "").strip()
    or os.getenv("GOOGLE_GEMINI_API_KEY", "").strip()
)
GEMINI_API_BASE = os.getenv(
    "GEMINI_API_BASE",
    "https://generativelanguage.googleapis.com/v1beta",
).rstrip("/")
GEMINI_STT_MODEL = os.getenv("GEMINI_STT_MODEL", "gemini-3.5-flash")
GEMINI_TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", "gemini-3.1-flash-tts-preview")
GEMINI_TTS_VOICE = os.getenv("GEMINI_TTS_VOICE", "Kore")

AI_VOICE_MAX_AUDIO_BYTES = int(os.getenv("AI_VOICE_MAX_AUDIO_BYTES", str(15 * 1024 * 1024)))
AI_VOICE_MIN_AUDIO_BYTES = int(os.getenv("AI_VOICE_MIN_AUDIO_BYTES", "2500"))
AI_STT_TIMEOUT_SECONDS = int(os.getenv("AI_STT_TIMEOUT_SECONDS", "35"))
AI_TTS_TIMEOUT_SECONDS = int(os.getenv("AI_TTS_TIMEOUT_SECONDS", "45"))

VOICE_EMPLOYEE_NAME_CACHE_SECONDS = int(os.getenv("VOICE_EMPLOYEE_NAME_CACHE_SECONDS", "600"))
VOICE_EMPLOYEE_NAME_CACHE = {}


def _require_gemini_api_key():
    if not GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY is missing in backend environment. "
            "Add GEMINI_API_KEY to backend .env."
        )

    return GEMINI_API_KEY


def _gemini_generate_content(model, payload, timeout=45):
    api_key = _require_gemini_api_key()
    url = f"{GEMINI_API_BASE}/models/{model}:generateContent"

    response = requests.post(
        url,
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        json=payload,
        timeout=timeout,
    )

    if not response.ok:
        details = response.text[:1200]
        raise RuntimeError(
            f"Gemini API request failed with status {response.status_code}: {details}"
        )

    try:
        return response.json()
    except Exception as exc:
        raise RuntimeError("Gemini API returned invalid JSON.") from exc


def _safe_unlink(path):
    if not path:
        return

    try:
        os.unlink(path)
    except Exception:
        pass


def _guess_audio_mime(filename="", uploaded_mime=""):
    uploaded = _safe_str(uploaded_mime).lower()

    if uploaded.startswith("audio/") or uploaded in ["video/webm", "video/mp4"]:
        return uploaded

    guessed, _ = mimetypes.guess_type(filename or "eve-audio.webm")

    if guessed:
        return guessed

    ext = os.path.splitext(filename or "")[1].lower()

    if ext == ".wav":
        return "audio/wav"
    if ext == ".mp3":
        return "audio/mpeg"
    if ext == ".m4a":
        return "audio/mp4"
    if ext == ".ogg":
        return "audio/ogg"
    if ext == ".mp4":
        return "audio/mp4"

    return "audio/webm"


def _known_employee_names_for_prompt(user_context, limit=24):
    """
    Cached employee-name list for voice transcription.

    Earlier this queried MongoDB on every small voice chunk, which made
    Gemini voice feel slow. Now it caches names per tenant for a short time.
    """

    user_context = user_context or {}
    tenant_id = _safe_str(user_context.get("tenant_id") or "global")
    cache_key = f"{tenant_id}:{limit}"
    now_ts = datetime.utcnow().timestamp()

    cached = VOICE_EMPLOYEE_NAME_CACHE.get(cache_key)

    if cached:
        cached_at = cached.get("cached_at", 0)
        if now_ts - cached_at <= VOICE_EMPLOYEE_NAME_CACHE_SECONDS:
            return cached.get("names", [])

    tenant_values = _id_variants(tenant_id)
    query = {"is_deleted": {"$ne": True}}

    if tenant_values:
        query["$or"] = [
            {"tenant_id": {"$in": tenant_values}},
            {"company_id": {"$in": tenant_values}},
            {"tenant": {"$in": tenant_values}},
        ]

    names = []

    try:
        db = get_db()
        cursor = db.employees.find(
            query,
            {
                "employee_name": 1,
                "name": 1,
                "full_name": 1,
                "display_name": 1,
                "first_name": 1,
                "middle_name": 1,
                "last_name": 1,
            },
        ).limit(limit)

        for employee in cursor:
            name = _display_name_from_record(employee)
            if name and name.lower() != "employee" and name not in names:
                names.append(name)
    except Exception:
        names = []

    VOICE_EMPLOYEE_NAME_CACHE[cache_key] = {
        "cached_at": now_ts,
        "names": names,
    }

    return names


def _build_voice_transcription_prompt(user_context):
    user_context = user_context or {}

    employee_name = (
        user_context.get("employee_name")
        or user_context.get("display_name")
        or user_context.get("name")
        or "Employee"
    )

    known_names = _known_employee_names_for_prompt(user_context, limit=24)
    names_text = ", ".join(known_names[:24])

    prompt_parts = [
        "Transcribe this audio into plain text only.",
        "If there is no clear speech, return empty text only.",
        "Do not answer the user. Do not explain. Do not add markdown.",
        "Context: SDS HRMS voice assistant Eve. Wake phrases: Hey Eve, Hi Eve, Hello Eve, Eve.",
        "Preserve HRMS terms: CL, EL, WFH, attendance, leave, handover, reporting officer, team leader.",
        "Preserve Indian and Assamese names carefully.",
        f"Logged-in employee: {employee_name}.",
    ]

    if names_text:
        prompt_parts.append(f"Known employee names: {names_text}.")

    return " ".join(prompt_parts)[:1000]


def _voice_transcription_hints(user_context):
    hints = [
        "SDS",
        "HRMS",
        "Eve",
        "Hey Eve",
        "CL",
        "EL",
        "WFH",
        "attendance",
        "leave",
        "handover",
        "reporting officer",
        "team leader",
        "management group",
        "IT support",
        "grievance",
        "asset",
        "project",
    ]

    try:
        hints.extend(_known_employee_names_for_prompt(user_context, limit=24))
    except Exception:
        pass

    unique = []

    for item in hints:
        text = _safe_str(item)

        if text and text not in unique:
            unique.append(text)

    return unique[:40]


def _normalize_tts_text(text):
    clean = _safe_str(text)

    if not clean:
        return ""

    replacements = {
        "SDS": "S D S",
        "HRMS": "H R M S",
        "CL": "casual leave",
        "EL": "earned leave",
        "WFH": "work from home",
        "IT": "I T",
        "API": "A P I",
    }

    for source, target in replacements.items():
        clean = re.sub(rf"\b{re.escape(source)}\b", target, clean)

    clean = re.sub(r"\s+", " ", clean).strip()

    return clean[:1800]


def _build_tts_prompt(text):
    clean_text = _normalize_tts_text(text)

    return (
        "Speak naturally in clear Indian English as Eve, a warm SDS HRMS assistant. "
        "Use a calm professional tone. Do not sound robotic. "
        "Pronounce Indian names carefully.\n\n"
        f"{clean_text}"
    )[:2200]


def _extract_gemini_text(response_json):
    candidates = response_json.get("candidates") or []

    for candidate in candidates:
        content = candidate.get("content") or {}
        parts = content.get("parts") or []

        for part in parts:
            text = _safe_str(part.get("text"))
            if text:
                text = re.sub(r"^```[a-zA-Z]*", "", text).replace("```", "")
                text = text.strip().strip('"').strip("'").strip()

                if text.lower() in {
                    "empty",
                    "no speech",
                    "no clear speech",
                    "inaudible",
                    "silence",
                    "silent",
                    "[silence]",
                }:
                    return ""

                return text

    return ""


def _extract_gemini_audio(response_json):
    candidates = response_json.get("candidates") or []

    for candidate in candidates:
        content = candidate.get("content") or {}
        parts = content.get("parts") or []

        for part in parts:
            inline_data = part.get("inlineData") or part.get("inline_data") or {}
            audio_b64 = inline_data.get("data")

            if not audio_b64:
                continue

            mime_type = (
                inline_data.get("mimeType")
                or inline_data.get("mime_type")
                or "audio/L16;codec=pcm;rate=24000"
            )

            return base64.b64decode(audio_b64), mime_type

    return b"", ""


def _pcm_to_wav_bytes(pcm_bytes, channels=1, rate=24000, sample_width=2):
    buffer = io.BytesIO()

    with wave.open(buffer, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm_bytes)

    return buffer.getvalue()


def _audio_response_bytes(audio_bytes, mime_type):
    mime = _safe_str(mime_type).lower()

    if not audio_bytes:
        return b"", "audio/wav"

    if "wav" in mime or "wave" in mime:
        return audio_bytes, "audio/wav"

    if "mpeg" in mime or "mp3" in mime:
        return audio_bytes, "audio/mpeg"

    if "ogg" in mime:
        return audio_bytes, "audio/ogg"

    # Gemini TTS commonly returns raw PCM: audio/L16;codec=pcm;rate=24000.
    # Browser playback needs a WAV container, so wrap the PCM bytes.
    return _pcm_to_wav_bytes(audio_bytes), "audio/wav"


def _safe_str(value):
    return str(value or "").strip()


def _as_object_id(value):
    try:
        text = _safe_str(value)
        if text and ObjectId.is_valid(text):
            return ObjectId(text)
    except Exception:
        return None

    return None


def _id_variants(value):
    variants = []

    text = _safe_str(value)
    if text:
        variants.append(text)

    oid = _as_object_id(text)
    if oid:
        variants.append(oid)

    return variants

def _first_non_empty(*values):
    for value in values:
        text = _safe_str(value)
        if text:
            return text

    return ""


def _normalize_gender(value):
    text = _safe_str(value).lower()

    if text in ["male", "m", "man", "boy", "gentleman"]:
        return "male"

    if text in ["female", "f", "woman", "girl", "lady"]:
        return "female"

    return ""


def _formal_title_from_gender(gender):
    normalized = _normalize_gender(gender)

    if normalized == "male":
        return "sir"

    if normalized == "female":
        return "ma'am"

    return ""

def _display_name_from_record(record):
    record = record or {}

    composed_name = " ".join([
        _safe_str(record.get("first_name")),
        _safe_str(record.get("middle_name")),
        _safe_str(record.get("last_name")),
    ]).strip()

    return _first_non_empty(
        record.get("employee_name"),
        record.get("full_name"),
        record.get("display_name"),
        record.get("name"),
        record.get("staff_name"),
        record.get("user_name"),
        composed_name,
        record.get("email"),
        record.get("official_email"),
        record.get("work_email"),
        record.get("username"),
    )


def _gender_from_records(*records):
    for record in records:
        record = record or {}

        gender = _normalize_gender(
            record.get("gender")
            or record.get("sex")
            or record.get("gender_identity")
            or record.get("employee_gender")
        )

        if gender:
            return gender

    return ""


def _notification_identity_values(user_context):
    user_context = user_context or {}
    employee = user_context.get("employee") or {}

    raw_values = [
        user_context.get("user_id"),
        user_context.get("_id"),
        user_context.get("employee_id"),
        user_context.get("email"),
        employee.get("_id"),
        employee.get("id"),
        employee.get("employee_id"),
        employee.get("user_id"),
        employee.get("login_user_id"),
        employee.get("account_user_id"),
        employee.get("email"),
        employee.get("official_email"),
        employee.get("work_email"),
    ]

    values = []

    for raw_value in raw_values:
        for value in _id_variants(raw_value):
            if value and value not in values:
                values.append(value)

    return values


def _unread_notification_count(user_context):
    user_context = user_context or {}
    tenant_id = user_context.get("tenant_id")
    identity_values = _notification_identity_values(user_context)

    if not identity_values:
        return 0

    tenant_values = _id_variants(tenant_id)

    query_parts = [
        {"is_deleted": {"$ne": True}},
        {"read": {"$ne": True}},
        {
            "$or": [
                {"user_id": {"$in": identity_values}},
                {"recipient_id": {"$in": identity_values}},
                {"receiver_id": {"$in": identity_values}},
                {"target_user_id": {"$in": identity_values}},
                {"employee_id": {"$in": identity_values}},
            ]
        },
    ]

    if tenant_values:
        query_parts.append({
            "$or": [
                {"tenant_id": {"$in": tenant_values}},
                {"company_id": {"$in": tenant_values}},
                {"tenant": {"$in": tenant_values}},
            ]
        })

    try:
        db = get_db()
        return int(db.notifications.count_documents({"$and": query_parts}))
    except Exception:
        return 0

def _safe_doc(doc):
    if not doc:
        return {}

    blocked_keys = {
        "password",
        "password_hash",
        "secret",
        "token",
        "jwt",
        "api_key",
        "refresh_token",
        "reset_token",
        "otp",
        "otp_code",
    }

    cleaned = {}

    for key, value in dict(doc).items():
        if key in blocked_keys:
            continue

        if key == "_id":
            cleaned["id"] = str(value)
            cleaned["_id"] = str(value)
            continue

        if isinstance(value, ObjectId):
            cleaned[key] = str(value)
            continue

        cleaned[key] = value

    return cleaned


def _safe_chat_history(raw_history):
    """
    Keeps only safe lightweight chat history.
    This avoids sending large/uncontrolled frontend payloads to the AI service.
    """

    if not isinstance(raw_history, list):
        return []

    cleaned = []

    for item in raw_history[-8:]:
        if not isinstance(item, dict):
            continue

        role = _safe_str(item.get("role")).lower()
        text = _safe_str(item.get("text") or item.get("content"))

        if role not in ["user", "assistant"]:
            continue

        if not text:
            continue

        cleaned.append({
            "role": role,
            "text": text[:1200]
        })

    return cleaned


def _find_employee_for_user(current_user, tenant_id):
    """
    Flexible employee lookup because users/employees can be linked by
    employee_id, user_id, email, employee_code, phone, or nested employee data.
    """

    db = get_db()

    current_user = current_user or {}

    nested_employee = (
        current_user.get("employee")
        or current_user.get("employee_data")
        or current_user.get("profile")
        or {}
    )

    if isinstance(nested_employee, dict):
        nested_name = _display_name_from_record(nested_employee)
        if nested_name and nested_name.lower() != "employee":
            return _safe_doc(nested_employee)

    user_id = current_user.get("_id") or current_user.get("id")

    email = (
        current_user.get("email")
        or current_user.get("official_email")
        or current_user.get("work_email")
        or current_user.get("username")
        or nested_employee.get("email")
        or nested_employee.get("official_email")
        or nested_employee.get("work_email")
        or nested_employee.get("username")
    )

    employee_id = (
        current_user.get("employee_id")
        or current_user.get("employee_ref_id")
        or current_user.get("employee_profile_id")
        or current_user.get("employee_summary_id")
        or current_user.get("emp_id")
        or nested_employee.get("_id")
        or nested_employee.get("id")
        or nested_employee.get("employee_id")
        or nested_employee.get("employee_ref_id")
        or nested_employee.get("employee_profile_id")
    )

    employee_code = (
        current_user.get("employee_code")
        or current_user.get("emp_code")
        or current_user.get("code")
        or nested_employee.get("employee_code")
        or nested_employee.get("emp_code")
        or nested_employee.get("code")
    )

    phone = (
        current_user.get("phone")
        or current_user.get("mobile")
        or current_user.get("contact")
        or current_user.get("contact_number")
        or nested_employee.get("phone")
        or nested_employee.get("mobile")
        or nested_employee.get("contact")
        or nested_employee.get("contact_number")
    )

    user_values = _id_variants(user_id)
    employee_values = _id_variants(employee_id)
    tenant_values = _id_variants(tenant_id)

    or_parts = []

    if employee_values:
        or_parts.extend([
            {"_id": {"$in": employee_values}},
            {"id": {"$in": employee_values}},
            {"employee_id": {"$in": employee_values}},
            {"employee_ref_id": {"$in": employee_values}},
            {"employee_profile_id": {"$in": employee_values}},
            {"emp_id": {"$in": employee_values}},
        ])

    if user_values:
        or_parts.extend([
            {"user_id": {"$in": user_values}},
            {"login_user_id": {"$in": user_values}},
            {"account_user_id": {"$in": user_values}},
            {"created_user_id": {"$in": user_values}},
            {"mapped_user_id": {"$in": user_values}},
            {"auth_user_id": {"$in": user_values}},
            {"linked_user_id": {"$in": user_values}},
            {"user_ref_id": {"$in": user_values}},
            {"app_user_id": {"$in": user_values}},
        ])

    if employee_code:
        or_parts.extend([
            {"employee_code": employee_code},
            {"emp_code": employee_code},
            {"code": employee_code},
        ])

    if email:
        or_parts.extend([
            {"email": email},
            {"official_email": email},
            {"work_email": email},
            {"username": email},
        ])

    if phone:
        or_parts.extend([
            {"phone": phone},
            {"mobile": phone},
            {"contact": phone},
            {"contact_number": phone},
        ])

    if not or_parts:
        return {}

    base_query = {"$or": or_parts}

    if tenant_values:
        query_with_tenant = {
            "$and": [
                base_query,
                {
                    "$or": [
                        {"tenant_id": {"$in": tenant_values}},
                        {"company_id": {"$in": tenant_values}},
                        {"tenant": {"$in": tenant_values}},
                    ]
                },
            ]
        }

        employee = db.employees.find_one(query_with_tenant)

        if employee:
            return _safe_doc(employee)

    employee = db.employees.find_one(base_query)

    return _safe_doc(employee)


def _find_tenant_for_user(tenant_id):
    db = get_db()

    tenant_values = _id_variants(tenant_id)

    if not tenant_values:
        return {}

    tenant = (
        db.companies.find_one({"_id": {"$in": tenant_values}})
        or db.companies.find_one({"tenant_id": {"$in": tenant_values}})
        or db.tenants.find_one({"_id": {"$in": tenant_values}})
        or db.tenants.find_one({"tenant_id": {"$in": tenant_values}})
    )

    return _safe_doc(tenant)


def _build_ai_user_context(current_user):
    current_user = current_user or {}

    tenant_id = getattr(g, "tenant_id", None) or current_user.get("tenant_id")
    roles = normalize_roles(current_user.get("roles", []))

    if not roles:
        single_role = _safe_str(current_user.get("role")).lower()
        roles = [single_role] if single_role else []

    primary_role = roles[0] if roles else "employee"

    employee = _find_employee_for_user(current_user, tenant_id)
    tenant = _find_tenant_for_user(tenant_id)

    employee_id = (
        employee.get("_id")
        or employee.get("id")
        or current_user.get("employee_id")
        or current_user.get("employee_profile_id")
    )

    department = (
        employee.get("department")
        or employee.get("department_name")
        or current_user.get("department")
        or current_user.get("department_name")
        or ""
    )

    designation = (
        employee.get("designation")
        or employee.get("designation_name")
        or current_user.get("designation")
        or current_user.get("designation_name")
        or ""
    )

    tenant_name = (
        tenant.get("name")
        or tenant.get("company_name")
        or tenant.get("tenant_name")
        or current_user.get("company_name")
        or ""
    )

    gender = _gender_from_records(employee, current_user)

    employee_display_name = (
        _display_name_from_record(employee)
        or _display_name_from_record(current_user)
        or "Employee"
    )

    return {
        "user_id": _safe_str(current_user.get("_id") or current_user.get("id")),
        "_id": _safe_str(current_user.get("_id") or current_user.get("id")),
        "tenant_id": tenant_id,
        "tenant": tenant,
        "tenant_name": tenant_name,
        "role": primary_role,
        "roles": roles,
        "email": current_user.get("email"),
        "gender": gender,
        "formal_title": _formal_title_from_gender(gender),
        "name": employee_display_name,
        "display_name": employee_display_name,
        "employee_name": employee_display_name,

        "employee_id": _safe_str(employee_id),
        "employee": employee,
        "department": department,
        "department_name": department,
        "designation": designation,
        "designation_name": designation,
        "team_leader_id": (
            employee.get("team_leader_id")
            or employee.get("team_leader_user_id")
            or employee.get("tl_id")
        ),
        "reporting_officer_id": (
            employee.get("reporting_officer_id")
            or employee.get("reporting_officer_user_id")
            or employee.get("ro_id")
        ),
    }


@ai_assistant_bp.post("/chat")
@current_user_required
def chat():
    data = request.get_json(silent=True) or {}

    question = _safe_str(data.get("message"))
    history = _safe_chat_history(data.get("history"))

    if not question:
        return jsonify({
            "success": False,
            "error": "Message is required"
        }), 400

    current_user = getattr(g, "current_user", {}) or {}
    user_context = _build_ai_user_context(current_user)

    try:
        answer = generate_ai_answer(
            question,
            user_context=user_context,
            history=history
        )

        return jsonify({
            "success": True,
            "question": question,
            "answer": answer
        }), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "error": "AI assistant failed",
            "details": str(e)
        }), 500

@ai_assistant_bp.get("/voice-context")
@current_user_required
def voice_context():
    current_user = getattr(g, "current_user", {}) or {}
    user_context = _build_ai_user_context(current_user)

    employee_name = (
        user_context.get("employee_name")
        or user_context.get("display_name")
        or user_context.get("name")
        or _display_name_from_record(current_user)
        or "Employee"
    )

    gender = (
        user_context.get("gender")
        or _gender_from_records(user_context.get("employee"), current_user)
    )

    unread_count = _unread_notification_count(user_context)

    if unread_count == 1:
        notification_phrase = "You have one new notification."
    elif unread_count > 1:
        notification_phrase = f"You have {unread_count} new notifications."
    else:
        notification_phrase = ""

    return jsonify({
        "success": True,
        "wake_word": "hey eve",
        "employee_name": employee_name,
        "name": employee_name,
        "display_name": employee_name,
        "gender": gender,
        "formal_title": _formal_title_from_gender(gender),
        "unread_notification_count": unread_count,
        "notification_phrase": notification_phrase,
    }), 200


@ai_assistant_bp.post("/transcribe")
@current_user_required
def transcribe_voice():
    """
    Provider-powered speech-to-text for Eve.

    Current recommended provider from backend/.env:
    - AI_STT_PROVIDER=deepgram

    Frontend sends multipart/form-data:
    - audio: webm/wav/mp3/m4a/ogg audio blob
    """

    current_user = getattr(g, "current_user", {}) or {}
    user_context = _build_ai_user_context(current_user)

    audio_file = request.files.get("audio")

    if not audio_file:
        return jsonify({
            "success": False,
            "error": "Audio file is required"
        }), 400

    try:
        audio_bytes = audio_file.read()
        file_size = len(audio_bytes or b"")
        mime_type = _guess_audio_mime(audio_file.filename, audio_file.mimetype)
        provider_name = os.getenv("AI_STT_PROVIDER", "deepgram").strip().lower() or "deepgram"

        if file_size <= 0:
            return jsonify({
                "success": True,
                "text": "",
                "transcript": "",
                "provider": provider_name,
                "skipped": True,
                "reason": "audio_empty",
            }), 200

        if file_size < AI_VOICE_MIN_AUDIO_BYTES:
            return jsonify({
                "success": True,
                "text": "",
                "transcript": "",
                "provider": provider_name,
                "skipped": True,
                "reason": "audio_too_short",
                "audio_size": file_size,
            }), 200

        if file_size > AI_VOICE_MAX_AUDIO_BYTES:
            return jsonify({
                "success": False,
                "error": "Audio file is too large"
            }), 413

        hints = _voice_transcription_hints(user_context)
        language = _safe_str(request.form.get("language")) or os.getenv("DEEPGRAM_LANGUAGE", "en-IN")

        result = transcribe_ai_audio(
            audio_bytes=audio_bytes,
            mime_type=mime_type,
            language=language,
            hints=hints,
            timeout=AI_STT_TIMEOUT_SECONDS,
        )

        transcript_text = _safe_str(result.get("text") or result.get("transcript"))

        return jsonify({
            "success": True,
            "text": transcript_text,
            "transcript": transcript_text,
            "provider": result.get("provider") or provider_name,
            "fallback_used": bool(result.get("fallback_used")),
            "latency_ms": result.get("latency_ms"),
            "mime_type": mime_type,
            "audio_size": file_size,
        }), 200

    except AiProviderError as exc:
        print(
            f"AI STT failed. Provider: {exc.provider}. "
            f"Status: {exc.status_code}. Details: {exc.details or str(exc)}"
        )

        status_code = exc.status_code or 500

        if exc.quota_exceeded:
            status_code = 429

        return jsonify({
            "success": False,
            "error": "Voice transcription failed",
            "message": (
                "Speech-to-text quota reached. Eve voice has been paused temporarily."
                if exc.quota_exceeded
                else str(exc)
            ),
            "provider": exc.provider,
            "quota_exceeded": bool(exc.quota_exceeded),
            "retry_after_seconds": exc.retry_after_seconds or 90 if exc.quota_exceeded else 0,
        }), status_code

    except Exception as e:
        error_text = f"Voice transcription failed before provider call: {str(e)}"
        print(error_text)

        return jsonify({
            "success": False,
            "error": "Voice transcription failed",
            "message": "Voice transcription failed. Please check backend logs.",
            "quota_exceeded": False,
        }), 500


@ai_assistant_bp.post("/speak")
@current_user_required
def speak_voice():
    """
    Provider-powered text-to-speech for Eve.

    Current recommended provider from backend/.env:
    - AI_TTS_PROVIDER=sarvam
    """

    data = request.get_json(silent=True) or {}
    text = _normalize_tts_text(data.get("text"))

    if not text:
        return jsonify({
            "success": False,
            "error": "Text is required"
        }), 400

    provider_name = os.getenv("AI_TTS_PROVIDER", "sarvam").strip().lower() or "sarvam"

    if provider_name == "sarvam":
        requested_voice = os.getenv("SARVAM_TTS_SPEAKER", "anushka").strip() or "anushka"
        language_code = os.getenv("SARVAM_LANGUAGE_CODE", "en-IN").strip() or "en-IN"
    else:
        requested_voice = _safe_str(data.get("voice")) or GEMINI_TTS_VOICE
        language_code = _safe_str(data.get("language_code")) or "en-IN"

        if not re.match(r"^[A-Za-z0-9_-]{2,40}$", requested_voice):
            requested_voice = GEMINI_TTS_VOICE

    try:
        speech_result = synthesize_ai_speech(
            text=text,
            voice=requested_voice,
            language_code=language_code,
            timeout=AI_TTS_TIMEOUT_SECONDS,
        )

        audio_bytes = speech_result.get("audio_bytes") or b""
        response_mime_type = speech_result.get("mime_type") or "audio/mpeg"

        if not audio_bytes:
            return jsonify({
                "success": False,
                "error": "Speech generation returned empty audio"
            }), 502

        extension = "wav" if response_mime_type == "audio/wav" else "mp3"

        if response_mime_type == "audio/ogg":
            extension = "ogg"

        return Response(
            audio_bytes,
            mimetype=response_mime_type,
            headers={
                "Content-Disposition": f"inline; filename=eve-response.{extension}",
                "Cache-Control": "no-store",
                "X-Eve-Voice": requested_voice,
                "X-Eve-Provider": speech_result.get("provider") or provider_name,
                "X-Eve-Model": os.getenv("SARVAM_TTS_MODEL", "bulbul:v3"),
                "X-Eve-Latency-Ms": str(speech_result.get("latency_ms") or ""),
            },
        )

    except AiProviderError as exc:
        print(
            f"AI TTS failed. Provider: {exc.provider}. "
            f"Status: {exc.status_code}. Details: {exc.details or str(exc)}"
        )

        status_code = exc.status_code or 500

        if exc.quota_exceeded:
            status_code = 429

        return jsonify({
            "success": False,
            "error": "Voice generation failed",
            "message": (
                "Text-to-speech quota reached. Eve voice has been paused temporarily."
                if exc.quota_exceeded
                else str(exc)
            ),
            "provider": exc.provider,
            "quota_exceeded": bool(exc.quota_exceeded),
            "retry_after_seconds": exc.retry_after_seconds or 90 if exc.quota_exceeded else 0,
        }), status_code

    except Exception as e:
        error_text = str(e)
        print(f"AI TTS failed: {error_text}")

        return jsonify({
            "success": False,
            "error": "Voice generation failed",
            "message": "Voice generation failed. Please check backend logs.",
            "quota_exceeded": False,
        }), 500


@ai_assistant_bp.post("/seed")
@roles_required(
    "super_admin",
    "admin",
    "hr",
    "hr_admin",
    "hr_manager"
)
def seed():
    current_user = getattr(g, "current_user", {}) or {}
    tenant_id = getattr(g, "tenant_id", current_user.get("tenant_id"))

    try:
        global_seed_result = seed_ai_knowledge(tenant_id=None)

        tenant_seed_result = None
        if tenant_id:
            tenant_seed_result = seed_ai_knowledge(tenant_id=tenant_id)

        return jsonify({
            "success": True,
            "message": "AI knowledge seeded successfully",
            "global_seed_result": global_seed_result,
            "tenant_seed_result": tenant_seed_result
        }), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "error": "Knowledge seed failed",
            "details": str(e)
        }), 500