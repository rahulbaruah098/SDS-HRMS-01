import base64
import json
import os
import re
import time
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
        status_code == 429
        or "429" in lowered
        or "quota" in lowered
        or "rate limit" in lowered
        or "resource_exhausted" in lowered
        or "too many requests" in lowered
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

    if provider != "sarvam":
        raise AiProviderError(
            f"Unsupported AI_TTS_PROVIDER: {provider}",
            provider=provider,
            status_code=500,
        )

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


def ai_provider_status() -> Dict[str, Any]:
    return {
        "chat_provider": _env("AI_CHAT_PROVIDER", _env("AI_PROVIDER", "groq")),
        "stt_provider": _env("AI_STT_PROVIDER", "deepgram"),
        "tts_provider": _env("AI_TTS_PROVIDER", "sarvam"),
        "fallback_provider": _env("AI_FALLBACK_PROVIDER", "gemini"),
        "groq_configured": bool(_env("GROQ_API_KEY")),
        "deepgram_configured": bool(_env("DEEPGRAM_API_KEY")),
        "sarvam_configured": bool(_env("SARVAM_API_KEY")),
        "gemini_configured": bool(_env("GEMINI_API_KEY")),
        "groq_model": _env("GROQ_CHAT_MODEL", "openai/gpt-oss-20b"),
        "deepgram_model": _env("DEEPGRAM_STT_MODEL", "nova-2"),
        "sarvam_tts_model": _env("SARVAM_TTS_MODEL", "bulbul:v3"),
    }


__all__ = [
    "AiProviderError",
    "generate_ai_chat_response",
    "transcribe_ai_audio",
    "synthesize_ai_speech",
    "ai_provider_status",
]