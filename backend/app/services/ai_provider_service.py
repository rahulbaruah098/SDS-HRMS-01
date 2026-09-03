import base64
import json
import io
import os
import re
import time
import wave
from typing import Any, Dict, List, Optional, Tuple

import requests


class AiProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        provider: str = "",
        status_code: int = 500,
        quota_exceeded: bool = False,
        retry_after_seconds: int = 0,
        details: str = "",
    ):
        super().__init__(message)
        self.provider = provider
        self.status_code = status_code
        self.quota_exceeded = quota_exceeded
        self.retry_after_seconds = retry_after_seconds
        self.details = details


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name, default)).strip())
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.getenv(name, default)).strip())
    except Exception:
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    value = str(os.getenv(name, "")).strip().lower()

    if not value:
        return default

    return value in {"1", "true", "yes", "y", "on"}


def _safe_str(value: Any) -> str:
    if value is None:
        return ""

    if isinstance(value, str):
        return value

    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def _is_quota_error(text: Any, status_code: int = 0) -> bool:
    lowered = _safe_str(text).lower()

    return (
        status_code in {402, 429}
        or "402" in lowered
        or "429" in lowered
        or "quota" in lowered
        or "credit" in lowered
        or "rate limit" in lowered
        or "resource_exhausted" in lowered
        or "too many requests" in lowered
        or "insufficient_quota" in lowered
    )


def _retry_after_seconds(text: Any, fallback: int = 90) -> int:
    raw = _safe_str(text)

    patterns = [
        r"retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*s",
        r"retry-after[^0-9]*([0-9]+(?:\.[0-9]+)?)",
        r"try again in\s+([0-9]+(?:\.[0-9]+)?)\s*s",
    ]

    for pattern in patterns:
        match = re.search(pattern, raw, flags=re.IGNORECASE)

        if match:
            try:
                return max(30, min(int(float(match.group(1))) + 5, 3600))
            except Exception:
                pass

    return max(30, min(int(fallback), 3600))


def _raise_provider_error(
    provider: str,
    response: requests.Response,
    fallback_message: str,
) -> None:
    try:
        details = response.text[:1800]
    except Exception:
        details = ""

    quota_exceeded = _is_quota_error(details, response.status_code)

    raise AiProviderError(
        message=fallback_message,
        provider=provider,
        status_code=response.status_code,
        quota_exceeded=quota_exceeded,
        retry_after_seconds=_retry_after_seconds(details) if quota_exceeded else 0,
        details=details,
    )


def _json_response(response: requests.Response, provider: str) -> Dict[str, Any]:
    try:
        return response.json()
    except Exception as exc:
        raise AiProviderError(
            message=f"{provider} returned invalid JSON.",
            provider=provider,
            status_code=response.status_code or 500,
            details=response.text[:1000] if hasattr(response, "text") else "",
        ) from exc


def _normalise_chat_messages(
    messages: Optional[List[Dict[str, Any]]] = None,
    system_prompt: str = "",
    user_prompt: str = "",
) -> List[Dict[str, str]]:
    final_messages: List[Dict[str, str]] = []

    if system_prompt:
        final_messages.append({
            "role": "system",
            "content": str(system_prompt).strip(),
        })

    for item in messages or []:
        role = str(item.get("role") or "user").strip().lower()
        content = str(
            item.get("content")
            or item.get("text")
            or item.get("message")
            or ""
        ).strip()

        if not content:
            continue

        if role not in {"system", "user", "assistant"}:
            role = "user"

        final_messages.append({
            "role": role,
            "content": content,
        })

    if user_prompt:
        final_messages.append({
            "role": "user",
            "content": str(user_prompt).strip(),
        })

    if not final_messages:
        final_messages.append({
            "role": "user",
            "content": "Hello",
        })

    return final_messages


def _extract_groq_text(data: Dict[str, Any]) -> str:
    choices = data.get("choices") or []

    if choices:
        message = choices[0].get("message") or {}
        content = message.get("content")

        if isinstance(content, str):
            return content.strip()

        if isinstance(content, list):
            parts = []

            for part in content:
                if isinstance(part, dict):
                    text = part.get("text") or part.get("content") or ""

                    if text:
                        parts.append(str(text))

            return "\n".join(parts).strip()

    return ""


def _groq_chat_completion(
    messages: Optional[List[Dict[str, Any]]] = None,
    system_prompt: str = "",
    user_prompt: str = "",
    temperature: float = 0.2,
    max_tokens: Optional[int] = None,
    timeout: Optional[int] = None,
) -> str:
    api_key = _env("GROQ_API_KEY")

    if not api_key:
        raise AiProviderError(
            "GROQ_API_KEY is missing in backend/.env.",
            provider="groq",
            status_code=500,
        )

    api_base = _env("GROQ_API_BASE", "https://api.groq.com/openai/v1").rstrip("/")
    model = _env("GROQ_CHAT_MODEL", "openai/gpt-oss-20b")
    max_completion_tokens = max_tokens or _env_int("AI_MAX_OUTPUT_TOKENS", 450)
    request_timeout = timeout or _env_int("AI_CHAT_TIMEOUT_SECONDS", 20)

    payload = {
        "model": model,
        "messages": _normalise_chat_messages(messages, system_prompt, user_prompt),
        "temperature": temperature,
        "max_completion_tokens": max_completion_tokens,
    }

    if _env_bool("AI_FAST_MODE", True):
        payload["top_p"] = 0.9

    response = requests.post(
        f"{api_base}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json=payload,
        timeout=request_timeout,
    )

    if not response.ok:
        _raise_provider_error("groq", response, "Groq chat request failed.")

    data = _json_response(response, "groq")
    text = _extract_groq_text(data)

    if not text:
        raise AiProviderError(
            "Groq returned an empty answer.",
            provider="groq",
            status_code=502,
            details=_safe_str(data)[:1000],
        )

    return text


def _gemini_chat_completion(
    messages: Optional[List[Dict[str, Any]]] = None,
    system_prompt: str = "",
    user_prompt: str = "",
    temperature: float = 0.2,
    max_tokens: Optional[int] = None,
    timeout: Optional[int] = None,
) -> str:
    api_key = _env("GEMINI_API_KEY")

    if not api_key:
        raise AiProviderError(
            "GEMINI_API_KEY is missing in backend/.env.",
            provider="gemini",
            status_code=500,
        )

    model = _env("GEMINI_MODEL", "gemini-3.5-flash")
    request_timeout = timeout or _env_int("AI_CHAT_TIMEOUT_SECONDS", 20)
    max_output_tokens = max_tokens or _env_int("AI_MAX_OUTPUT_TOKENS", 450)

    final_messages = _normalise_chat_messages(messages, system_prompt, user_prompt)
    prompt_parts = []

    for item in final_messages:
        role = item.get("role", "user")
        content = item.get("content", "")

        if content:
            prompt_parts.append(f"{role.upper()}:\n{content}")

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": "\n\n".join(prompt_parts),
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
        },
    }

    response = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        json=payload,
        timeout=request_timeout,
    )

    if not response.ok:
        _raise_provider_error("gemini", response, "Gemini fallback chat request failed.")

    data = _json_response(response, "gemini")
    candidates = data.get("candidates") or []

    if not candidates:
        raise AiProviderError(
            "Gemini returned no candidates.",
            provider="gemini",
            status_code=502,
            details=_safe_str(data)[:1000],
        )

    parts = (
        candidates[0]
        .get("content", {})
        .get("parts", [])
    )

    text_parts = [
        str(part.get("text", "")).strip()
        for part in parts
        if isinstance(part, dict) and part.get("text")
    ]

    text = "\n".join(text_parts).strip()

    if not text:
        raise AiProviderError(
            "Gemini returned an empty answer.",
            provider="gemini",
            status_code=502,
            details=_safe_str(data)[:1000],
        )

    return text


def generate_ai_chat_response(
    messages: Optional[List[Dict[str, Any]]] = None,
    system_prompt: str = "",
    user_prompt: str = "",
    temperature: float = 0.2,
    max_tokens: Optional[int] = None,
    timeout: Optional[int] = None,
) -> Dict[str, Any]:
    provider = _env("AI_CHAT_PROVIDER", _env("AI_PROVIDER", "groq")).lower()
    fallback_provider = _env("AI_FALLBACK_PROVIDER", "gemini").lower()

    started_at = time.time()

    try:
        if provider == "groq":
            answer = _groq_chat_completion(
                messages=messages,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout,
            )
        elif provider == "gemini":
            answer = _gemini_chat_completion(
                messages=messages,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout,
            )
        else:
            raise AiProviderError(
                f"Unsupported AI_CHAT_PROVIDER: {provider}",
                provider=provider,
                status_code=500,
            )

        return {
            "success": True,
            "provider": provider,
            "text": answer,
            "answer": answer,
            "latency_ms": int((time.time() - started_at) * 1000),
            "fallback_used": False,
        }

    except AiProviderError as primary_error:
        if fallback_provider and fallback_provider != provider:
            try:
                if fallback_provider == "gemini":
                    answer = _gemini_chat_completion(
                        messages=messages,
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        timeout=timeout,
                    )
                elif fallback_provider == "groq":
                    answer = _groq_chat_completion(
                        messages=messages,
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        timeout=timeout,
                    )
                else:
                    raise primary_error

                return {
                    "success": True,
                    "provider": fallback_provider,
                    "text": answer,
                    "answer": answer,
                    "latency_ms": int((time.time() - started_at) * 1000),
                    "fallback_used": True,
                    "primary_error": str(primary_error),
                }

            except Exception:
                raise primary_error

        raise primary_error


def _normalise_deepgram_language(language: str) -> str:
    clean = str(language or "").strip()

    if not clean:
        return "en"

    lowered = clean.lower()

    if lowered.startswith("en"):
        return "en"

    if lowered.startswith("hi"):
        return "hi"

    if lowered.startswith("bn"):
        return "bn"

    if lowered.startswith("ta"):
        return "ta"

    if lowered.startswith("te"):
        return "te"

    if lowered.startswith("mr"):
        return "mr"

    return clean.split("-")[0].lower()


def _deepgram_transcribe_audio(
    audio_bytes: bytes,
    mime_type: str = "audio/webm",
    language: str = "",
    hints: Optional[List[str]] = None,
    timeout: Optional[int] = None,
) -> str:
    api_key = _env("DEEPGRAM_API_KEY")

    if not api_key:
        raise AiProviderError(
            "DEEPGRAM_API_KEY is missing in backend/.env.",
            provider="deepgram",
            status_code=500,
        )

    if not audio_bytes:
        return ""

    request_timeout = timeout or _env_int("AI_STT_TIMEOUT_SECONDS", 20)
    model = _env("DEEPGRAM_STT_MODEL", "nova-2")
    selected_language = _normalise_deepgram_language(
        language or _env("DEEPGRAM_LANGUAGE", "en")
    )

    params = {
        "model": model,
        "language": selected_language,
        "smart_format": "true" if _env_bool("DEEPGRAM_SMART_FORMAT", True) else "false",
        "punctuate": "true" if _env_bool("DEEPGRAM_PUNCTUATE", True) else "false",
        "utterances": "false",
    }

    if hints:
        keyterms = [
            str(item).strip()
            for item in hints
            if str(item).strip()
        ]

        if keyterms:
            params["keyterm"] = keyterms[:20]

    response = requests.post(
        "https://api.deepgram.com/v1/listen",
        headers={
            "Authorization": f"Token {api_key}",
            "Content-Type": mime_type or "application/octet-stream",
            "Accept": "application/json",
        },
        params=params,
        data=audio_bytes,
        timeout=request_timeout,
    )

    if not response.ok:
        _raise_provider_error("deepgram", response, "Deepgram transcription failed.")

    data = _json_response(response, "deepgram")

    try:
        transcript = (
            data.get("results", {})
            .get("channels", [{}])[0]
            .get("alternatives", [{}])[0]
            .get("transcript", "")
        )
    except Exception:
        transcript = ""

    return str(transcript or "").strip()


def _groq_transcribe_audio(
    audio_bytes: bytes,
    mime_type: str = "audio/webm",
    language: str = "",
    hints: Optional[List[str]] = None,
    timeout: Optional[int] = None,
) -> str:
    api_key = _env("GROQ_API_KEY")

    if not api_key:
        raise AiProviderError(
            "GROQ_API_KEY is missing for Groq STT fallback.",
            provider="groq",
            status_code=500,
        )

    api_base = _env("GROQ_API_BASE", "https://api.groq.com/openai/v1").rstrip("/")
    model = _env("GROQ_STT_MODEL", "whisper-large-v3-turbo")
    request_timeout = timeout or _env_int("AI_STT_TIMEOUT_SECONDS", 20)

    filename = "audio.webm"

    if "wav" in mime_type:
        filename = "audio.wav"
    elif "mpeg" in mime_type or "mp3" in mime_type:
        filename = "audio.mp3"
    elif "mp4" in mime_type:
        filename = "audio.mp4"
    elif "ogg" in mime_type:
        filename = "audio.ogg"

    data = {
        "model": model,
        "response_format": "json",
        "temperature": "0",
    }

    normalised_language = _normalise_deepgram_language(language)

    if normalised_language:
        data["language"] = normalised_language

    if hints:
        prompt = ", ".join(
            str(item).strip()
            for item in hints[:30]
            if str(item).strip()
        )

        if prompt:
            data["prompt"] = prompt

    response = requests.post(
        f"{api_base}/audio/transcriptions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        },
        files={
            "file": (filename, audio_bytes, mime_type or "application/octet-stream"),
        },
        data=data,
        timeout=request_timeout,
    )

    if not response.ok:
        _raise_provider_error("groq", response, "Groq STT fallback failed.")

    payload = _json_response(response, "groq")
    return str(payload.get("text") or "").strip()


def transcribe_ai_audio(
    audio_bytes: bytes,
    mime_type: str = "audio/webm",
    language: str = "",
    hints: Optional[List[str]] = None,
    timeout: Optional[int] = None,
) -> Dict[str, Any]:
    provider = _env("AI_STT_PROVIDER", "deepgram").lower()
    started_at = time.time()

    if not audio_bytes:
        return {
            "success": True,
            "provider": provider,
            "text": "",
            "transcript": "",
            "latency_ms": 0,
            "skipped": True,
            "reason": "empty_audio",
        }

    try:
        if provider == "deepgram":
            transcript = _deepgram_transcribe_audio(
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                language=language,
                hints=hints,
                timeout=timeout,
            )
        elif provider == "groq":
            transcript = _groq_transcribe_audio(
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                language=language,
                hints=hints,
                timeout=timeout,
            )
        else:
            raise AiProviderError(
                f"Unsupported AI_STT_PROVIDER: {provider}",
                provider=provider,
                status_code=500,
            )

        return {
            "success": True,
            "provider": provider,
            "text": transcript,
            "transcript": transcript,
            "latency_ms": int((time.time() - started_at) * 1000),
            "fallback_used": False,
        }

    except AiProviderError as primary_error:
        if provider != "groq" and _env("GROQ_API_KEY"):
            try:
                transcript = _groq_transcribe_audio(
                    audio_bytes=audio_bytes,
                    mime_type=mime_type,
                    language=language,
                    hints=hints,
                    timeout=timeout,
                )

                return {
                    "success": True,
                    "provider": "groq",
                    "text": transcript,
                    "transcript": transcript,
                    "latency_ms": int((time.time() - started_at) * 1000),
                    "fallback_used": True,
                    "primary_error": str(primary_error),
                }
            except Exception:
                raise primary_error

        raise primary_error


def _decode_audio_base64(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value

    text = str(value or "").strip()

    if not text:
        return b""

    if "," in text and text.lower().startswith("data:"):
        text = text.split(",", 1)[1]

    return base64.b64decode(text)


def _extract_sarvam_audio(data: Dict[str, Any]) -> bytes:
    possible_values = []

    for key in [
        "audio",
        "audio_base64",
        "generated_audio",
        "output_audio",
        "base64_audio",
    ]:
        if data.get(key):
            possible_values.append(data.get(key))

    audios = data.get("audios")

    if isinstance(audios, list):
        possible_values.extend(audios)

    outputs = data.get("outputs")

    if isinstance(outputs, list):
        for item in outputs:
            if isinstance(item, dict):
                for key in ["audio", "audio_base64", "generated_audio"]:
                    if item.get(key):
                        possible_values.append(item.get(key))
            elif item:
                possible_values.append(item)

    for value in possible_values:
        try:
            decoded = _decode_audio_base64(value)

            if decoded:
                return decoded
        except Exception:
            continue

    return b""


def _sarvam_text_to_speech(
    text: str,
    voice: str = "",
    language_code: str = "",
    timeout: Optional[int] = None,
) -> Tuple[bytes, str]:
    api_key = _env("SARVAM_API_KEY")

    if not api_key:
        raise AiProviderError(
            "SARVAM_API_KEY is missing in backend/.env.",
            provider="sarvam",
            status_code=500,
        )

    clean_text = str(text or "").strip()

    if not clean_text:
        return b"", "audio/mpeg"

    max_chars = _env_int("SARVAM_TTS_MAX_CHARS", 2400)

    if len(clean_text) > max_chars:
        clean_text = clean_text[:max_chars].rsplit(" ", 1)[0].strip() or clean_text[:max_chars]

    api_base = _env("SARVAM_API_BASE", "https://api.sarvam.ai").rstrip("/")
    model = _env("SARVAM_TTS_MODEL", "bulbul:v3")
    speaker = str(voice or _env("SARVAM_TTS_SPEAKER", "ritu") or "ritu").strip().lower()

    if speaker in {"kore", "anushka"}:
        speaker = "ritu"
    target_language_code = language_code or _env("SARVAM_LANGUAGE_CODE", "en-IN")
    request_timeout = timeout or _env_int("AI_TTS_TIMEOUT_SECONDS", 30)

    output_codec = _env("SARVAM_TTS_OUTPUT_CODEC", "wav").lower()
    sample_rate = _env_int("SARVAM_TTS_SAMPLE_RATE", 24000)
    pace = _env_float("SARVAM_TTS_PACE", 1.08)
    temperature = _env_float("SARVAM_TTS_TEMPERATURE", 0.55)

    payload = {
        "text": clean_text,
        "target_language_code": target_language_code,
        "speaker": speaker,
        "model": model,
        "pace": pace,
        "speech_sample_rate": sample_rate,
        "output_audio_codec": output_codec,
        "temperature": temperature,
    }

    response = requests.post(
        f"{api_base}/text-to-speech",
        headers={
            "api-subscription-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json=payload,
        timeout=request_timeout,
    )

    if not response.ok:
        _raise_provider_error("sarvam", response, "Sarvam text-to-speech failed.")

    content_type = response.headers.get("Content-Type", "")

    if content_type.startswith("audio/"):
        return response.content, content_type.split(";")[0]

    data = _json_response(response, "sarvam")
    audio_bytes = _extract_sarvam_audio(data)

    if not audio_bytes:
        raise AiProviderError(
            "Sarvam returned no audio data.",
            provider="sarvam",
            status_code=502,
            details=_safe_str(data)[:1000],
        )

    mime_type = "audio/mpeg"

    if output_codec == "wav":
        mime_type = "audio/wav"
    elif output_codec == "ogg":
        mime_type = "audio/ogg"
    elif output_codec == "opus":
        mime_type = "audio/ogg"
    elif output_codec == "flac":
        mime_type = "audio/flac"

    return audio_bytes, mime_type



def _clamp_float(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(float(value), maximum))


def _elevenlabs_text_to_speech(
    text: str,
    voice: str = "",
    language_code: str = "",
    timeout: Optional[int] = None,
) -> Tuple[bytes, str]:
    """Generate Saya speech through ElevenLabs Text-to-Speech.

    The voice is intentionally server-controlled through ELEVENLABS_VOICE_ID.
    A voice value sent from the browser is not trusted as a Voice ID, preventing
    clients from switching Saya to an arbitrary ElevenLabs voice.
    """
    api_key = _env("ELEVENLABS_API_KEY")
    voice_id = _env("ELEVENLABS_VOICE_ID")

    if not api_key:
        raise AiProviderError(
            "ELEVENLABS_API_KEY is missing in backend/.env.",
            provider="elevenlabs",
            status_code=500,
        )

    if not voice_id:
        raise AiProviderError(
            "ELEVENLABS_VOICE_ID is missing in backend/.env.",
            provider="elevenlabs",
            status_code=500,
        )

    clean_text = str(text or "").strip()

    if not clean_text:
        return b"", "audio/mpeg"

    # Keep Saya concise and protect the free credit allowance from accidentally
    # synthesizing very large responses. This is independently configurable.
    max_chars = max(100, _env_int("ELEVENLABS_TTS_MAX_CHARS", 1800))

    if len(clean_text) > max_chars:
        clean_text = clean_text[:max_chars].rsplit(" ", 1)[0].strip() or clean_text[:max_chars]

    api_base = _env("ELEVENLABS_API_BASE", "https://api.elevenlabs.io/v1").rstrip("/")
    model = _env("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")
    output_format = _env("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128")
    request_timeout = timeout or _env_int("AI_TTS_TIMEOUT_SECONDS", 30)

    # Defaults tuned for a natural, quick conversational HR assistant.
    stability = _clamp_float(_env_float("ELEVENLABS_STABILITY", 0.45), 0.0, 1.0)
    similarity_boost = _clamp_float(_env_float("ELEVENLABS_SIMILARITY_BOOST", 0.75), 0.0, 1.0)
    style = _clamp_float(_env_float("ELEVENLABS_STYLE", 0.0), 0.0, 1.0)
    speed = _clamp_float(_env_float("ELEVENLABS_SPEED", 1.10), 0.7, 1.2)
    use_speaker_boost = _env_bool("ELEVENLABS_USE_SPEAKER_BOOST", True)

    payload: Dict[str, Any] = {
        "text": clean_text,
        "model_id": model,
        "voice_settings": {
            "stability": stability,
            "similarity_boost": similarity_boost,
            "style": style,
            "use_speaker_boost": use_speaker_boost,
            "speed": speed,
        },
    }

    # ElevenLabs expects ISO-639-1 language codes. Do not force en-IN; the
    # Indian accent is carried by the custom Saya voice itself.
    configured_language = _env("ELEVENLABS_LANGUAGE_CODE", "")
    requested_language = str(language_code or "").strip()
    final_language = configured_language

    if not final_language and requested_language:
        final_language = requested_language.split("-", 1)[0].lower()

    if final_language and re.fullmatch(r"[A-Za-z]{2}", final_language):
        payload["language_code"] = final_language.lower()

    response = requests.post(
        f"{api_base}/text-to-speech/{voice_id}",
        params={"output_format": output_format},
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        json=payload,
        timeout=request_timeout,
    )

    if not response.ok:
        _raise_provider_error(
            "elevenlabs",
            response,
            "ElevenLabs text-to-speech failed.",
        )

    audio_bytes = response.content or b""

    if not audio_bytes:
        raise AiProviderError(
            "ElevenLabs returned no audio data.",
            provider="elevenlabs",
            status_code=502,
        )

    content_type = str(
        response.headers.get("Content-Type") or "audio/mpeg"
    ).split(";", 1)[0].strip()

    if not content_type.startswith("audio/"):
        content_type = "audio/mpeg"

    return audio_bytes, content_type


def _pcm_to_wav_bytes(pcm_bytes: bytes, channels: int = 1, rate: int = 24000, sample_width: int = 2) -> bytes:
    buffer = io.BytesIO()

    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(rate)
        wav_file.writeframes(pcm_bytes)

    return buffer.getvalue()


def _extract_gemini_tts_audio(data: Dict[str, Any]) -> Tuple[bytes, str]:
    candidates = data.get("candidates") or []

    for candidate in candidates:
        content = candidate.get("content") or {}
        parts = content.get("parts") or []

        for part in parts:
            inline_data = (
                part.get("inlineData")
                or part.get("inline_data")
                or {}
            )

            audio_b64 = inline_data.get("data")

            if not audio_b64:
                continue

            mime_type = (
                inline_data.get("mimeType")
                or inline_data.get("mime_type")
                or "audio/L16;codec=pcm;rate=24000"
            )

            try:
                return base64.b64decode(audio_b64), str(mime_type)
            except Exception as exc:
                raise AiProviderError(
                    "Gemini TTS returned invalid base64 audio.",
                    provider="gemini",
                    status_code=502,
                    details=_safe_str(data)[:1000],
                ) from exc

    return b"", ""


def _gemini_audio_response_bytes(audio_bytes: bytes, mime_type: str) -> Tuple[bytes, str]:
    mime = str(mime_type or "").lower()

    if not audio_bytes:
        return b"", "audio/wav"

    if "wav" in mime or "wave" in mime:
        return audio_bytes, "audio/wav"

    if "mpeg" in mime or "mp3" in mime:
        return audio_bytes, "audio/mpeg"

    if "ogg" in mime:
        return audio_bytes, "audio/ogg"

    rate = 24000
    rate_match = re.search(r"rate=([0-9]+)", mime)

    if rate_match:
        try:
            rate = int(rate_match.group(1))
        except Exception:
            rate = 24000

    # Gemini TTS usually returns raw PCM/L16 audio.
    # Browsers need a playable WAV container.
    return _pcm_to_wav_bytes(audio_bytes, channels=1, rate=rate, sample_width=2), "audio/wav"



def _normalize_gemini_tts_model_name(model: str) -> str:
    # FILE_NINETEEN_GEMINI_TTS_VOICE_MODEL_REQUEST_FIX
    # The model list API returns names like "models/gemini-2.5-flash-preview-tts",
    # but generateContent URL expects only "gemini-2.5-flash-preview-tts"
    # after /models/.
    value = str(model or "").strip()

    if value.startswith("models/"):
        value = value.split("/", 1)[1].strip()

    return value


def _select_gemini_tts_voice(requested_voice: str = "") -> str:
    # Frontend/Sarvam may send "ritu", but Gemini TTS needs prebuilt voices
    # such as Kore, Puck, Charon, Fenrir, Aoede, etc.
    valid_voices = {
        "Achernar",
        "Achird",
        "Algenib",
        "Algieba",
        "Alnilam",
        "Aoede",
        "Autonoe",
        "Callirrhoe",
        "Charon",
        "Despina",
        "Enceladus",
        "Erinome",
        "Fenrir",
        "Gacrux",
        "Iapetus",
        "Kore",
        "Laomedeia",
        "Leda",
        "Orus",
        "Puck",
        "Pulcherrima",
        "Rasalgethi",
        "Sadachbia",
        "Sadaltager",
        "Schedar",
        "Sulafat",
        "Umbriel",
        "Vindemiatrix",
        "Zephyr",
        "Zubenelgenubi",
    }

    env_voice = str(_env("GEMINI_TTS_VOICE", "Kore") or "Kore").strip()
    voice = str(requested_voice or "").strip()

    if voice in valid_voices:
        return voice

    if env_voice in valid_voices:
        return env_voice

    return "Kore"


def _gemini_text_to_speech(
    text: str,
    voice: str = "",
    language_code: str = "",
    timeout: Optional[int] = None,
) -> Tuple[bytes, str]:
    # FILE_SEVENTEEN_GEMINI_TTS_PROVIDER_FIX
    # Adds real Gemini TTS support. Earlier synthesize_ai_speech only supported Sarvam,
    # so AI_TTS_PROVIDER=gemini always returned 500.
    api_key = _env("GEMINI_API_KEY") or _env("GOOGLE_API_KEY") or _env("GOOGLE_GEMINI_API_KEY")

    if not api_key:
        raise AiProviderError(
            "GEMINI_API_KEY is missing in backend/.env.",
            provider="gemini",
            status_code=500,
        )

    clean_text = str(text or "").strip()

    if not clean_text:
        return b"", "audio/wav"

    max_chars = _env_int("GEMINI_TTS_MAX_CHARS", 1800)

    if len(clean_text) > max_chars:
        clean_text = clean_text[:max_chars].rsplit(" ", 1)[0].strip() or clean_text[:max_chars]

    api_base = _env("GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")

    # FILE_EIGHTEEN_GEMINI_TTS_MODEL_FALLBACK_FIX
    # Some API keys may not have access to the newest TTS model yet.
    # Try the configured model first, then fallback to documented Gemini TTS preview models.
    primary_model = _env("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")
    fallback_models_raw = _env(
        "GEMINI_TTS_MODEL_FALLBACKS",
        "gemini-2.5-flash-preview-tts,gemini-2.5-pro-preview-tts"
    )

    model_candidates = []

    for candidate in [primary_model, *str(fallback_models_raw or "").split(",")]:
        candidate = _normalize_gemini_tts_model_name(candidate)

        if candidate and candidate not in model_candidates:
            model_candidates.append(candidate)

    if not model_candidates:
        model_candidates = ["gemini-2.5-flash-preview-tts"]

    request_timeout = timeout or _env_int("AI_TTS_TIMEOUT_SECONDS", 45)
    selected_voice = _select_gemini_tts_voice(voice)

    prompt = (
        "Speak naturally in clear Indian English as Saya, a warm SDS HRMS assistant. "
        "Use a calm professional tone. Pronounce HRMS, SDS, CL, EL, WFH, leave and attendance clearly. "
        f"{clean_text}"
    )

    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": prompt,
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": selected_voice,
                    }
                }
            },
        },
    }

    last_response = None
    last_model = ""

    for model in model_candidates:
        payload_for_model = {
            **payload,
            "model": model,
        }

        response = requests.post(
            f"{api_base}/models/{model}:generateContent",
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
            json=payload_for_model,
            timeout=request_timeout,
        )

        if not response.ok:
            last_response = response
            last_model = model

            # FILE_TWENTY_THREE_GEMINI_TTS_429_FALLBACK_FIX
            # 400/403/404 usually means this key/model combination is not available.
            # 429 means the selected model quota/rate limit is exhausted.
            # Continue to another TTS model before failing.
            if response.status_code in {400, 403, 404, 429}:
                continue

            _raise_provider_error("gemini", response, f"Gemini text-to-speech failed using model {model}.")

        data = _json_response(response, "gemini")
        audio_bytes, mime_type = _extract_gemini_tts_audio(data)

        if not audio_bytes:
            last_model = model
            continue

        return _gemini_audio_response_bytes(audio_bytes, mime_type)

    if last_response is not None:
        _raise_provider_error(
            "gemini",
            last_response,
            "Gemini text-to-speech failed for all configured models: "
            + ", ".join(model_candidates)
            + f". Last attempted model: {last_model}.",
        )

    raise AiProviderError(
        "Gemini returned no TTS audio for any configured model.",
        provider="gemini",
        status_code=502,
        details=", ".join(model_candidates),
    )


def synthesize_ai_speech(
    text: str,
    voice: str = "",
    language_code: str = "",
    timeout: Optional[int] = None,
) -> Dict[str, Any]:
    provider = _env("AI_TTS_PROVIDER", "sarvam").lower()
    started_at = time.time()

    if not str(text or "").strip():
        return {
            "success": True,
            "provider": provider,
            "audio_bytes": b"",
            "mime_type": "audio/mpeg",
            "latency_ms": 0,
            "skipped": True,
            "reason": "empty_text",
        }

    if provider in {"elevenlabs", "eleven_labs", "11labs"}:
        audio_bytes, mime_type = _elevenlabs_text_to_speech(
            text=text,
            voice=voice,
            language_code=language_code,
            timeout=timeout,
        )

        return {
            "success": True,
            "provider": "elevenlabs",
            "audio_bytes": audio_bytes,
            "mime_type": mime_type,
            "latency_ms": int((time.time() - started_at) * 1000),
            "model": _env("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5"),
        }

    if provider == "sarvam":
        audio_bytes, mime_type = _sarvam_text_to_speech(
            text=text,
            voice=voice,
            language_code=language_code,
            timeout=timeout,
        )

        return {
            "success": True,
            "provider": "sarvam",
            "audio_bytes": audio_bytes,
            "mime_type": mime_type,
            "latency_ms": int((time.time() - started_at) * 1000),
        }

    if provider == "gemini":
        audio_bytes, mime_type = _gemini_text_to_speech(
            text=text,
            voice=voice,
            language_code=language_code,
            timeout=timeout,
        )

        return {
            "success": True,
            "provider": "gemini",
            "audio_bytes": audio_bytes,
            "mime_type": mime_type,
            "latency_ms": int((time.time() - started_at) * 1000),
        }

    raise AiProviderError(
        f"Unsupported AI_TTS_PROVIDER: {provider}",
        provider=provider,
        status_code=500,
    )


def ai_provider_status() -> Dict[str, Any]:
    return {
        "chat_provider": _env("AI_CHAT_PROVIDER", _env("AI_PROVIDER", "groq")),
        "stt_provider": _env("AI_STT_PROVIDER", "deepgram"),
        "tts_provider": _env("AI_TTS_PROVIDER", "sarvam"),
        "fallback_provider": _env("AI_FALLBACK_PROVIDER", "gemini"),
        "groq_configured": bool(_env("GROQ_API_KEY")),
        "deepgram_configured": bool(_env("DEEPGRAM_API_KEY")),
        "sarvam_configured": bool(_env("SARVAM_API_KEY")),
        "elevenlabs_configured": bool(_env("ELEVENLABS_API_KEY") and _env("ELEVENLABS_VOICE_ID")),
        "gemini_configured": bool(_env("GEMINI_API_KEY")),
        "groq_model": _env("GROQ_CHAT_MODEL", "openai/gpt-oss-20b"),
        "deepgram_model": _env("DEEPGRAM_STT_MODEL", "nova-2"),
        "sarvam_tts_model": _env("SARVAM_TTS_MODEL", "bulbul:v3"),
        "elevenlabs_tts_model": _env("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5"),
        "elevenlabs_output_format": _env("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128"),
        "gemini_tts_model": _env("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts"),
        "gemini_tts_model_fallbacks": _env("GEMINI_TTS_MODEL_FALLBACKS", "gemini-2.5-flash-preview-tts,gemini-2.5-pro-preview-tts"),
        "gemini_tts_voice": _env("GEMINI_TTS_VOICE", "Kore"),
    }


__all__ = [
    "AiProviderError",
    "generate_ai_chat_response",
    "transcribe_ai_audio",
    "synthesize_ai_speech",
    "ai_provider_status",
]