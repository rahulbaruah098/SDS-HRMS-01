"""Flask routes for the YourComate Recruitment module.

The route layer is intentionally thin. Tenant isolation, permissions, workflow
transitions, duplicate protection, notifications, reporting, and employee
conversion remain inside ``RecruitmentService``.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

from flask import Blueprint, current_app, g, jsonify, request, send_file
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

from app.extensions import get_db
from app.middleware.tenant_guard import tenant_module_required
from app.services.recruitment_service import (
    APPLICATIONS,
    DOCUMENTS,
    HR_ROLES,
    OFFERS,
    DEFAULT_RECRUITMENT_SETTINGS,
    RecruitmentService,
    RecruitmentServiceError,
    deep_merge,
    normalize_email,
    normalize_phone,
    normalize_roles,
    safe_str,
    token_hash,
)
from app.services.resume_parser_service import (
    ALLOWED_RESUME_EXTENSIONS,
    MAX_RESUME_BYTES,
    ResumeParserError,
    parse_resume_upload,
)
from app.services.tenant_service import can_access_module
from app.utils.auth import audit
from app.utils.serializers import clean_doc


recruitment_bp = Blueprint("recruitment", __name__)

JOINING_DOCUMENT_EXTENSIONS = {
    "pdf",
    "doc",
    "docx",
    "jpg",
    "jpeg",
    "png",
    "webp",
}
MAX_JOINING_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_OFFER_ATTACHMENT_BYTES = 10 * 1024 * 1024


# -----------------------------------------------------------------------------
# Common request helpers
# -----------------------------------------------------------------------------


def _current_tenant_id() -> str:
    user = getattr(g, "current_user", {}) or {}
    return safe_str(
        getattr(g, "tenant_id", None)
        or user.get("tenant_id")
        or user.get("company_id")
        or "sds"
    )


def _current_user() -> dict[str, Any]:
    return dict(getattr(g, "current_user", {}) or {})


def _service(*, tenant_id: str | None = None, public: bool = False) -> RecruitmentService:
    return RecruitmentService(
        get_db(),
        tenant_id=tenant_id or _current_tenant_id(),
        actor={} if public else _current_user(),
        config=current_app.config,
        allow_public_actions=public,
    )


def _json_response(payload: Mapping[str, Any], status_code: int = 200):
    return jsonify(clean_doc(dict(payload))), status_code


def _int_value(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return min(max(parsed, minimum), maximum)


def _query_page(default_size: int = 25) -> tuple[int, int]:
    page = _int_value(request.args.get("page"), 1, 1, 100000)
    page_size = _int_value(
        request.args.get("page_size") or request.args.get("limit"),
        default_size,
        1,
        100,
    )
    return page, page_size


def _decode_form_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    text = value.strip()
    if not text:
        return ""

    lowered = text.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered == "null":
        return None

    if text[:1] in {"[", "{"}:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    return text


def _request_payload() -> dict[str, Any]:
    if request.is_json:
        payload = request.get_json(silent=True)
        if payload is None:
            return {}
        if not isinstance(payload, dict):
            raise RecruitmentServiceError(
                "Request body must be a JSON object.",
                code="invalid_request_body",
            )
        return dict(payload)

    payload: dict[str, Any] = {}
    encoded = request.form.get("payload") or request.form.get("data")
    if encoded:
        try:
            decoded = json.loads(encoded)
        except json.JSONDecodeError as exc:
            raise RecruitmentServiceError(
                "The multipart payload must contain valid JSON.",
                code="invalid_multipart_payload",
            ) from exc
        if not isinstance(decoded, dict):
            raise RecruitmentServiceError(
                "The multipart payload must be a JSON object.",
                code="invalid_multipart_payload",
            )
        payload.update(decoded)

    for key in request.form:
        if key in {"payload", "data"}:
            continue
        payload[key] = _decode_form_value(request.form.get(key))

    return payload


def _require_hr_user() -> None:
    roles = normalize_roles(_current_user())
    if not roles.intersection(HR_ROLES):
        raise RecruitmentServiceError(
            "Only authorised HR or company administrators can perform this action.",
            code="recruitment_hr_permission_required",
            status_code=403,
        )


def _frontend_url(path: str) -> str:
    base = safe_str(
        current_app.config.get("FRONTEND_URL")
        or current_app.config.get("PUBLIC_FRONTEND_URL")
        or current_app.config.get("APP_URL")
    ).rstrip("/")
    if not base:
        return ""
    return f"{base}/{path.lstrip('/')}"


# -----------------------------------------------------------------------------
# Controlled errors
# -----------------------------------------------------------------------------


@recruitment_bp.errorhandler(RecruitmentServiceError)
def _handle_recruitment_error(error: RecruitmentServiceError):
    payload = error.to_dict()

    # Public pages must not disclose internal candidate or application IDs.
    if "/public/" in request.path and error.code in {
        "duplicate_candidate",
        "duplicate_job_application",
    }:
        payload.pop("details", None)
        payload["message"] = (
            "An application with these candidate details already exists. "
            "Please contact the company HR team if you need help."
        )

    return _json_response(payload, error.status_code)


@recruitment_bp.errorhandler(ResumeParserError)
def _handle_resume_parser_error(error: ResumeParserError):
    return _json_response(error.to_dict(), error.status_code)


@recruitment_bp.errorhandler(Exception)
def _handle_unexpected_error(error: Exception):
    if isinstance(error, HTTPException):
        return error

    current_app.logger.exception("Unhandled Recruitment API error")
    return _json_response(
        {
            "ok": False,
            "message": "The recruitment request could not be completed.",
            "code": "recruitment_internal_error",
        },
        500,
    )


# -----------------------------------------------------------------------------
# File storage helpers
# -----------------------------------------------------------------------------


def _safe_tenant_segment(tenant_id: str) -> str:
    segment = secure_filename(safe_str(tenant_id))
    if segment:
        return segment
    return hashlib.sha256(safe_str(tenant_id).encode("utf-8")).hexdigest()[:20]


def _recruitment_upload_root() -> Path:
    root = Path(current_app.root_path).resolve().parent / "uploads" / "recruitment"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _upload_folder(tenant_id: str, category: str) -> Path:
    safe_category = secure_filename(category) or "files"
    folder = _recruitment_upload_root() / _safe_tenant_segment(tenant_id) / safe_category
    folder.mkdir(parents=True, exist_ok=True)
    return folder.resolve()


def _extension(filename: str) -> str:
    safe_name = secure_filename(filename or "")
    if "." not in safe_name:
        return ""
    return safe_name.rsplit(".", 1)[1].lower().strip()


def _save_uploaded_file(
    uploaded_file: Any,
    *,
    tenant_id: str,
    category: str,
    allowed_extensions: set[str],
    max_bytes: int,
    prefix: str,
) -> dict[str, Any]:
    if uploaded_file is None or not safe_str(getattr(uploaded_file, "filename", "")):
        raise RecruitmentServiceError(
            "A file is required.",
            code="file_required",
        )

    original_name = secure_filename(uploaded_file.filename or "")
    extension = _extension(original_name)
    if extension not in allowed_extensions:
        allowed = ", ".join(sorted(ext.upper() for ext in allowed_extensions))
        raise RecruitmentServiceError(
            f"Unsupported file type. Allowed types: {allowed}.",
            code="unsupported_file_type",
        )

    stream = getattr(uploaded_file, "stream", uploaded_file)
    try:
        stream.seek(0)
    except Exception:
        pass

    stored_name = f"{prefix}_{uuid4().hex}.{extension}"
    absolute_path = _upload_folder(tenant_id, category) / stored_name
    digest = hashlib.sha256()
    total = 0

    try:
        with absolute_path.open("wb") as destination:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise RecruitmentServiceError(
                        f"The uploaded file is too large. Maximum allowed size is {max_bytes // (1024 * 1024)} MB.",
                        code="file_too_large",
                        status_code=413,
                    )
                digest.update(chunk)
                destination.write(chunk)
    except Exception:
        absolute_path.unlink(missing_ok=True)
        raise
    finally:
        try:
            stream.seek(0)
        except Exception:
            pass

    if total <= 0:
        absolute_path.unlink(missing_ok=True)
        raise RecruitmentServiceError(
            "The uploaded file is empty.",
            code="empty_file",
        )

    relative_path = absolute_path.relative_to(Path(current_app.root_path).resolve().parent)
    relative_value = str(relative_path).replace(os.sep, "/")

    return {
        "original_name": original_name,
        "file_name": original_name,
        "stored_name": stored_name,
        "extension": extension,
        "mime_type": safe_str(getattr(uploaded_file, "mimetype", "")),
        "size_bytes": total,
        "sha256": digest.hexdigest(),
        "relative_path": relative_value,
        "file_path": relative_value,
        "absolute_path": str(absolute_path),
    }


def _remove_saved_file(metadata: Mapping[str, Any] | None) -> None:
    path = safe_str((metadata or {}).get("absolute_path"))
    if path:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            current_app.logger.warning("Could not remove incomplete recruitment upload: %s", path)


def _safe_upload_path(relative_path: str) -> Path:
    relative = safe_str(relative_path).replace("\\", "/").lstrip("/")
    backend_root = Path(current_app.root_path).resolve().parent
    candidate = (backend_root / relative).resolve()
    upload_root = _recruitment_upload_root()

    try:
        candidate.relative_to(upload_root)
    except ValueError as exc:
        raise RecruitmentServiceError(
            "The requested recruitment file path is invalid.",
            code="invalid_recruitment_file_path",
            status_code=400,
        ) from exc

    if not candidate.is_file():
        raise RecruitmentServiceError(
            "The requested recruitment file was not found.",
            code="recruitment_file_not_found",
            status_code=404,
        )

    return candidate


def _download_file(relative_path: str, download_name: str):
    path = _safe_upload_path(relative_path)
    return send_file(
        path,
        as_attachment=True,
        download_name=secure_filename(download_name or path.name) or path.name,
        max_age=0,
    )


# -----------------------------------------------------------------------------
# Public company resolution
# -----------------------------------------------------------------------------


def _resolve_public_company(company_key: str) -> tuple[dict[str, Any], dict[str, Any]]:
    db = get_db()
    key = safe_str(company_key)
    if not key:
        raise RecruitmentServiceError(
            "Company career page was not found.",
            code="career_page_not_found",
            status_code=404,
        )

    escaped = re.escape(key)
    settings = db.recruitment_settings.find_one(
        {
            "public_career_slug": {"$regex": f"^{escaped}$", "$options": "i"},
            "is_deleted": {"$ne": True},
        }
    )

    tenant: dict[str, Any] | None = None
    if settings and settings.get("tenant_id"):
        tenant = db.tenants.find_one(
            {
                "tenant_id": settings.get("tenant_id"),
                "is_deleted": {"$ne": True},
            }
        )

    if not tenant:
        tenant = db.tenants.find_one(
            {
                "$or": [
                    {"tenant_id": {"$regex": f"^{escaped}$", "$options": "i"}},
                    {"tenant_code": {"$regex": f"^{escaped}$", "$options": "i"}},
                ],
                "is_deleted": {"$ne": True},
            }
        )

    if not tenant:
        raise RecruitmentServiceError(
            "Company career page was not found.",
            code="career_page_not_found",
            status_code=404,
        )

    tenant_id = safe_str(tenant.get("tenant_id"))
    if not settings:
        settings = db.recruitment_settings.find_one(
            {"tenant_id": tenant_id, "is_deleted": {"$ne": True}}
        ) or {}

    merged_settings = deep_merge(DEFAULT_RECRUITMENT_SETTINGS, settings)
    access = can_access_module(
        tenant,
        "recruitment",
        user=None,
        config=current_app.config,
    )
    if not access.get("allowed") or merged_settings.get("module_enabled") is False:
        raise RecruitmentServiceError(
            "This company career page is currently unavailable.",
            code="career_page_unavailable",
            status_code=404,
        )
    if merged_settings.get("career_page_enabled") is False:
        raise RecruitmentServiceError(
            "This company career page is currently unavailable.",
            code="career_page_disabled",
            status_code=404,
        )

    return tenant, merged_settings


def _public_service_for_company(company_key: str) -> tuple[RecruitmentService, dict[str, Any], dict[str, Any]]:
    tenant, settings = _resolve_public_company(company_key)
    service = _service(tenant_id=safe_str(tenant.get("tenant_id")), public=True)
    return service, tenant, settings


def _public_service_for_token(collection_name: str, field_name: str, raw_token: str) -> RecruitmentService:
    token = safe_str(raw_token)
    if not token:
        raise RecruitmentServiceError(
            "The recruitment link is invalid.",
            code="recruitment_link_invalid",
            status_code=404,
        )

    db = get_db()
    record = db[collection_name].find_one(
        {
            field_name: token_hash(token),
            "is_deleted": {"$ne": True},
        },
        {"tenant_id": 1},
    )
    if not record or not record.get("tenant_id"):
        raise RecruitmentServiceError(
            "The recruitment link is invalid or no longer available.",
            code="recruitment_link_invalid",
            status_code=404,
        )

    tenant_id = safe_str(record.get("tenant_id"))
    tenant = db.tenants.find_one(
        {"tenant_id": tenant_id, "is_deleted": {"$ne": True}}
    )
    access = can_access_module(
        tenant,
        "recruitment",
        user=None,
        config=current_app.config,
    )
    if not access.get("allowed"):
        raise RecruitmentServiceError(
            "This recruitment link is currently unavailable.",
            code="recruitment_link_unavailable",
            status_code=403,
        )

    settings = deep_merge(
        DEFAULT_RECRUITMENT_SETTINGS,
        db.recruitment_settings.find_one(
            {"tenant_id": tenant_id, "is_deleted": {"$ne": True}}
        ) or {},
    )
    if settings.get("module_enabled") is False:
        raise RecruitmentServiceError(
            "This recruitment link is currently unavailable.",
            code="recruitment_module_disabled",
            status_code=403,
        )

    return _service(tenant_id=tenant_id, public=True)


def _company_public_payload(tenant: Mapping[str, Any], settings: Mapping[str, Any]) -> dict[str, Any]:
    branding = tenant.get("branding") if isinstance(tenant.get("branding"), dict) else {}
    company_name = safe_str(
        tenant.get("company_name")
        or tenant.get("name")
        or tenant.get("tenant_name")
        or tenant.get("legal_name")
        or tenant.get("tenant_code")
    )
    company_logo = safe_str(
        tenant.get("company_logo")
        or tenant.get("company_logo_url")
        or tenant.get("logo")
        or tenant.get("logo_url")
        or branding.get("company_logo")
        or branding.get("company_logo_url")
        or branding.get("logo")
        or branding.get("logo_url")
    )
    return {
        "company_name": company_name,
        "company_logo": company_logo,
        "career_slug": safe_str(settings.get("public_career_slug")),
    }


# -----------------------------------------------------------------------------
# Dashboard and settings
# -----------------------------------------------------------------------------


@recruitment_bp.get("/dashboard")
@tenant_module_required("recruitment")
def recruitment_dashboard():
    return _json_response({"ok": True, "data": _service().get_dashboard()})


@recruitment_bp.get("/settings")
@tenant_module_required("recruitment")
def get_recruitment_settings():
    return _json_response({"ok": True, "item": _service().get_settings()})


@recruitment_bp.put("/settings")
@recruitment_bp.patch("/settings")
@tenant_module_required("recruitment")
def update_recruitment_settings():
    saved = _service().update_settings(_request_payload())
    audit("update_recruitment_settings", "recruitment_settings", meta={"tenant_id": _current_tenant_id()})
    return _json_response(
        {"ok": True, "message": "Recruitment settings updated successfully.", "item": saved}
    )


# -----------------------------------------------------------------------------
# Hiring requests
# -----------------------------------------------------------------------------


@recruitment_bp.get("/hiring-requests")
@tenant_module_required("recruitment")
def list_hiring_requests():
    page, page_size = _query_page()
    result = _service().list_hiring_requests(
        status=request.args.get("status", ""),
        search=request.args.get("q") or request.args.get("search") or "",
        page=page,
        page_size=page_size,
    )
    return _json_response({"ok": True, **result})


@recruitment_bp.post("/hiring-requests")
@tenant_module_required("recruitment")
def create_hiring_request():
    item = _service().create_hiring_request(_request_payload())
    audit("create_hiring_request", "recruitment_hiring_requests", str(item.get("_id")))
    return _json_response(
        {"ok": True, "message": "Hiring request created successfully.", "item": item},
        201,
    )


@recruitment_bp.get("/hiring-requests/<request_id>")
@tenant_module_required("recruitment")
def get_hiring_request(request_id: str):
    return _json_response({"ok": True, "item": _service().get_hiring_request(request_id)})


@recruitment_bp.post("/hiring-requests/<request_id>/submit")
@tenant_module_required("recruitment")
def submit_hiring_request(request_id: str):
    item = _service().submit_hiring_request(request_id)
    audit("submit_hiring_request", "recruitment_hiring_requests", request_id)
    return _json_response(
        {"ok": True, "message": "Hiring request submitted for approval.", "item": item}
    )


@recruitment_bp.post("/hiring-requests/<request_id>/decision")
@tenant_module_required("recruitment")
def decide_hiring_request(request_id: str):
    payload = _request_payload()
    item = _service().decide_hiring_request(
        request_id,
        payload.get("decision") or payload.get("status"),
        payload.get("reason") or "",
    )
    audit(
        "decide_hiring_request",
        "recruitment_hiring_requests",
        request_id,
        {"decision": payload.get("decision") or payload.get("status")},
    )
    return _json_response(
        {"ok": True, "message": "Hiring request decision recorded.", "item": item}
    )


# -----------------------------------------------------------------------------
# Job openings
# -----------------------------------------------------------------------------


@recruitment_bp.get("/job-openings")
@tenant_module_required("recruitment")
def list_job_openings():
    page, page_size = _query_page()
    result = _service().list_job_openings(
        status=request.args.get("status", ""),
        search=request.args.get("q") or request.args.get("search") or "",
        page=page,
        page_size=page_size,
    )
    return _json_response({"ok": True, **result})


@recruitment_bp.post("/job-openings")
@tenant_module_required("recruitment")
def create_job_opening():
    item = _service().create_job_opening(_request_payload())
    audit("create_job_opening", "recruitment_job_openings", str(item.get("_id")))
    return _json_response(
        {"ok": True, "message": "Job opening created successfully.", "item": item},
        201,
    )


@recruitment_bp.post("/job-openings/<job_id>/status")
@tenant_module_required("recruitment")
def change_job_opening_status(job_id: str):
    payload = _request_payload()
    item = _service().change_job_status(
        job_id,
        payload.get("status"),
        channels=payload.get("channels") or payload.get("published_channels"),
        reason=payload.get("reason") or "",
    )
    audit(
        "change_job_opening_status",
        "recruitment_job_openings",
        job_id,
        {"status": payload.get("status")},
    )
    return _json_response(
        {"ok": True, "message": "Job opening status updated.", "item": item}
    )


# -----------------------------------------------------------------------------
# Resume parser and candidates
# -----------------------------------------------------------------------------


@recruitment_bp.post("/resumes/parse")
@tenant_module_required("recruitment")
def parse_resume():
    _require_hr_user()
    uploaded = request.files.get("resume") or request.files.get("file")
    settings = _service().get_settings()
    max_mb = _int_value(settings.get("resume_max_size_mb"), 8, 1, 25)
    parsed = parse_resume_upload(uploaded, max_bytes=max_mb * 1024 * 1024)
    return _json_response(
        {
            "ok": True,
            "message": "Resume parsed. HR must review the extracted details before saving.",
            "result": parsed,
        }
    )


@recruitment_bp.get("/candidates")
@tenant_module_required("recruitment")
def list_candidates():
    page, page_size = _query_page()
    result = _service().list_candidates(
        search=request.args.get("q") or request.args.get("search") or "",
        skill=request.args.get("skill", ""),
        page=page,
        page_size=page_size,
    )
    return _json_response({"ok": True, **result})


@recruitment_bp.post("/candidates")
@tenant_module_required("recruitment")
def create_candidate():
    service = _service()
    payload = _request_payload()
    parser_result = payload.pop("parser_result", None)
    resume_metadata = payload.pop("resume_metadata", None)
    allow_existing = safe_str(payload.pop("allow_existing_candidate_id", ""))
    uploaded = request.files.get("resume") or request.files.get("file")
    saved_file: dict[str, Any] | None = None

    try:
        if uploaded and uploaded.filename:
            settings = service.get_settings()
            max_mb = _int_value(settings.get("resume_max_size_mb"), 8, 1, 25)
            parser_result = parse_resume_upload(
                uploaded,
                max_bytes=max_mb * 1024 * 1024,
            )
            saved_file = _save_uploaded_file(
                uploaded,
                tenant_id=_current_tenant_id(),
                category="resumes",
                allowed_extensions=set(ALLOWED_RESUME_EXTENSIONS),
                max_bytes=max_mb * 1024 * 1024,
                prefix="resume",
            )
            resume_metadata = {
                key: value
                for key, value in saved_file.items()
                if key != "absolute_path"
            }

        item = service.create_candidate(
            payload,
            parser_result=parser_result,
            resume_metadata=resume_metadata,
            allow_existing_candidate_id=allow_existing,
        )
    except Exception:
        _remove_saved_file(saved_file)
        raise

    audit("create_recruitment_candidate", "recruitment_candidates", str(item.get("_id")))
    return _json_response(
        {"ok": True, "message": "Candidate saved successfully.", "item": item},
        201,
    )


@recruitment_bp.get("/candidates/<candidate_id>")
@tenant_module_required("recruitment")
def get_candidate(candidate_id: str):
    return _json_response({"ok": True, "item": _service().get_candidate(candidate_id)})


@recruitment_bp.get("/candidates/<candidate_id>/resume")
@tenant_module_required("recruitment")
def download_candidate_resume(candidate_id: str):
    candidate = _service().get_candidate(candidate_id)
    resume = candidate.get("resume") if isinstance(candidate.get("resume"), dict) else {}
    relative_path = safe_str(resume.get("relative_path") or resume.get("file_path"))
    filename = safe_str(
        resume.get("original_name")
        or resume.get("filename")
        or resume.get("file_name")
        or "candidate-resume"
    )
    if not relative_path:
        raise RecruitmentServiceError(
            "No stored resume is available for this candidate.",
            code="candidate_resume_not_found",
            status_code=404,
        )
    return _download_file(relative_path, filename)


# -----------------------------------------------------------------------------
# Applications and screening
# -----------------------------------------------------------------------------


@recruitment_bp.get("/applications")
@tenant_module_required("recruitment")
def list_applications():
    page, page_size = _query_page()
    result = _service().list_applications(
        job_opening_id=request.args.get("job_opening_id", ""),
        status=request.args.get("status", ""),
        source=request.args.get("source", ""),
        search=request.args.get("q") or request.args.get("search") or "",
        page=page,
        page_size=page_size,
    )
    return _json_response({"ok": True, **result})


@recruitment_bp.post("/applications")
@tenant_module_required("recruitment")
def create_application():
    item = _service().create_application(_request_payload())
    audit("create_recruitment_application", "recruitment_applications", str(item.get("_id")))
    return _json_response(
        {"ok": True, "message": "Application created successfully.", "item": item},
        201,
    )


@recruitment_bp.get("/applications/<application_id>")
@tenant_module_required("recruitment")
def get_application(application_id: str):
    return _json_response({"ok": True, "item": _service().get_application(application_id)})


@recruitment_bp.patch("/applications/<application_id>/screening")
@tenant_module_required("recruitment")
def update_application_screening(application_id: str):
    item = _service().update_screening(application_id, _request_payload())
    audit("update_candidate_screening", "recruitment_applications", application_id)
    return _json_response(
        {"ok": True, "message": "Candidate screening updated.", "item": item}
    )


@recruitment_bp.post("/applications/<application_id>/interview-process/complete")
@tenant_module_required("recruitment")
def complete_interview_process(application_id: str):
    item = _service().complete_interview_process(application_id)
    audit(
        "complete_recruitment_interview_process",
        "recruitment_applications",
        application_id,
    )
    return _json_response(
        {
            "ok": True,
            "message": "Interview process completed successfully.",
            "item": item,
        }
    )


@recruitment_bp.post("/applications/<application_id>/status")
@tenant_module_required("recruitment")
def change_application_status(application_id: str):
    payload = _request_payload()
    item = _service().change_application_status(
        application_id,
        payload.get("status"),
        reason=payload.get("reason") or "",
        notes=payload.get("notes") or "",
    )
    audit(
        "change_recruitment_application_status",
        "recruitment_applications",
        application_id,
        {"status": payload.get("status")},
    )
    return _json_response(
        {"ok": True, "message": "Candidate stage updated.", "item": item}
    )


# -----------------------------------------------------------------------------
# Interviews and feedback
# -----------------------------------------------------------------------------


@recruitment_bp.get("/interviews")
@tenant_module_required("recruitment")
def list_interviews():
    page, page_size = _query_page()
    result = _service().list_interviews(
        application_id=request.args.get("application_id", ""),
        status=request.args.get("status", ""),
        from_date=request.args.get("from_date", ""),
        to_date=request.args.get("to_date", ""),
        page=page,
        page_size=page_size,
    )
    return _json_response({"ok": True, **result})


@recruitment_bp.post("/applications/<application_id>/interviews")
@tenant_module_required("recruitment")
def schedule_interview(application_id: str):
    item = _service().schedule_interview(application_id, _request_payload())
    audit("schedule_recruitment_interview", "recruitment_interviews", str(item.get("_id")))
    return _json_response(
        {"ok": True, "message": "Interview scheduled successfully.", "item": item},
        201,
    )


@recruitment_bp.post("/interviews/<interview_id>/reschedule")
@tenant_module_required("recruitment")
def reschedule_interview(interview_id: str):
    item = _service().reschedule_interview(interview_id, _request_payload())
    audit("reschedule_recruitment_interview", "recruitment_interviews", interview_id)
    return _json_response(
        {"ok": True, "message": "Interview rescheduled successfully.", "item": item}
    )


@recruitment_bp.post("/interviews/<interview_id>/status")
@tenant_module_required("recruitment")
def change_interview_status(interview_id: str):
    payload = _request_payload()
    item = _service().change_interview_status(
        interview_id,
        payload.get("status"),
        reason=payload.get("reason") or "",
    )
    audit(
        "change_recruitment_interview_status",
        "recruitment_interviews",
        interview_id,
        {"status": payload.get("status")},
    )
    return _json_response(
        {"ok": True, "message": "Interview status updated.", "item": item}
    )


@recruitment_bp.post("/interviews/<interview_id>/feedback")
@tenant_module_required("recruitment")
def submit_interview_feedback(interview_id: str):
    item = _service().submit_interview_feedback(interview_id, _request_payload())
    audit("submit_interview_feedback", "recruitment_feedback", str(item.get("_id")))
    return _json_response(
        {"ok": True, "message": "Interview feedback submitted.", "item": item},
        201,
    )


@recruitment_bp.get("/interviews/<interview_id>/feedback")
@tenant_module_required("recruitment")
def list_interview_feedback(interview_id: str):
    items = _service().list_interview_feedback(interview_id)
    return _json_response({"ok": True, "items": items})


@recruitment_bp.get("/applications/<application_id>/interview-feedback")
@tenant_module_required("recruitment")
def get_application_interview_feedback(application_id: str):
    result = _service().get_application_interview_feedback(application_id)
    return _json_response({"ok": True, **result})


# -----------------------------------------------------------------------------
# Offers
# -----------------------------------------------------------------------------


@recruitment_bp.get("/offers")
@tenant_module_required("recruitment")
def list_offers():
    page, page_size = _query_page()
    result = _service().list_offers(
        status=request.args.get("status", ""),
        search=request.args.get("q") or request.args.get("search") or "",
        page=page,
        page_size=page_size,
    )
    return _json_response({"ok": True, **result})


@recruitment_bp.post("/applications/<application_id>/offers")
@tenant_module_required("recruitment")
def create_offer(application_id: str):
    payload = _request_payload()
    uploaded = request.files.get("offer_file") or request.files.get("file")
    saved_file: dict[str, Any] | None = None

    try:
        if uploaded and uploaded.filename:
            saved_file = _save_uploaded_file(
                uploaded,
                tenant_id=_current_tenant_id(),
                category="offers",
                allowed_extensions={"pdf"},
                max_bytes=MAX_OFFER_ATTACHMENT_BYTES,
                prefix="offer",
            )
            payload["offer_file"] = {
                key: value
                for key, value in saved_file.items()
                if key != "absolute_path"
            }
        item = _service().create_offer(application_id, payload)
    except Exception:
        _remove_saved_file(saved_file)
        raise

    audit("create_recruitment_offer", "recruitment_offers", str(item.get("_id")))
    return _json_response(
        {"ok": True, "message": "Offer draft saved successfully.", "item": item},
        201,
    )


@recruitment_bp.post("/offers/<offer_id>/submit-approval")
@tenant_module_required("recruitment")
def submit_offer_for_approval(offer_id: str):
    payload = _request_payload()
    item = _service().submit_offer_for_approval(
        offer_id,
        payload.get("approver_user_ids"),
    )
    audit("submit_offer_for_approval", "recruitment_offers", offer_id)
    return _json_response(
        {"ok": True, "message": "Offer submitted for approval.", "item": item}
    )


@recruitment_bp.post("/offers/<offer_id>/decision")
@tenant_module_required("recruitment")
def decide_offer(offer_id: str):
    payload = _request_payload()
    item = _service().decide_offer(
        offer_id,
        payload.get("decision") or payload.get("status"),
        reason=payload.get("reason") or "",
    )
    audit(
        "decide_recruitment_offer",
        "recruitment_offers",
        offer_id,
        {"decision": payload.get("decision") or payload.get("status")},
    )
    return _json_response(
        {"ok": True, "message": "Offer decision recorded.", "item": item}
    )


@recruitment_bp.post("/offers/<offer_id>/send")
@tenant_module_required("recruitment")
def send_offer(offer_id: str):
    payload = _request_payload()
    offer_url = safe_str(payload.get("offer_url")) or _frontend_url("careers/offers/{token}")
    attachment = None
    offer = get_db().recruitment_offers.find_one(
        {
            "_id": _object_id_or_none(offer_id),
            "tenant_id": _current_tenant_id(),
            "is_deleted": {"$ne": True},
        }
    )
    if offer:
        offer_file = (offer.get("terms") or {}).get("offer_file")
        if isinstance(offer_file, dict):
            relative_path = safe_str(offer_file.get("relative_path") or offer_file.get("file_path"))
            if relative_path:
                attachment = {
                    "path": str(_safe_upload_path(relative_path)),
                    "filename": safe_str(offer_file.get("original_name") or "offer.pdf"),
                    "mime_type": safe_str(offer_file.get("mime_type") or "application/pdf"),
                }

    result = _service().send_offer(
        offer_id,
        offer_url=offer_url,
        offer_attachment=attachment,
    )
    audit("send_recruitment_offer", "recruitment_offers", offer_id)
    return _json_response(
        {"ok": True, "message": "Offer sent to the candidate.", **result}
    )


# -----------------------------------------------------------------------------
# Joining documents, verification, and employee conversion
# -----------------------------------------------------------------------------


def _object_id_or_none(value: str):
    try:
        from bson import ObjectId

        return ObjectId(safe_str(value))
    except Exception:
        return None


@recruitment_bp.get("/applications/<application_id>/joining-documents")
@tenant_module_required("recruitment")
def list_joining_documents(application_id: str):
    items = _service().list_joining_documents(application_id)
    return _json_response({"ok": True, "items": items})


@recruitment_bp.get("/joining-documents/<document_id>/download")
@tenant_module_required("recruitment")
def download_joining_document(document_id: str):
    service = _service()
    document = service._get(DOCUMENTS, document_id, "Joining document")
    service.get_application(document.get("application_id"))
    relative_path = safe_str(document.get("file_path"))
    if not relative_path:
        raise RecruitmentServiceError(
            "No uploaded file is available for this joining document.",
            code="joining_document_file_not_found",
            status_code=404,
        )
    return _download_file(relative_path, safe_str(document.get("file_name") or "joining-document"))


@recruitment_bp.post("/joining-documents/<document_id>/review")
@tenant_module_required("recruitment")
def review_joining_document(document_id: str):
    payload = _request_payload()
    result = _service().review_joining_document(
        document_id,
        payload.get("status"),
        reason=payload.get("reason") or payload.get("review_note") or "",
    )
    audit(
        "review_joining_document",
        "recruitment_documents",
        document_id,
        {"status": payload.get("status")},
    )
    return _json_response(
        {"ok": True, "message": "Joining document review saved.", **result}
    )


@recruitment_bp.get("/applications/<application_id>/background-checks")
@tenant_module_required("recruitment")
def list_background_checks(application_id: str):
    items = _service().list_background_checks(application_id)
    return _json_response({"ok": True, "items": items})


@recruitment_bp.put("/applications/<application_id>/background-checks")
@recruitment_bp.post("/applications/<application_id>/background-checks")
@tenant_module_required("recruitment")
def update_background_check(application_id: str):
    result = _service().update_background_check(application_id, _request_payload())
    audit(
        "update_recruitment_background_check",
        "recruitment_background_checks",
        application_id,
    )
    return _json_response(
        {"ok": True, "message": "Background check updated.", **result}
    )


@recruitment_bp.post("/applications/<application_id>/joining-status")
@tenant_module_required("recruitment")
def change_joining_status(application_id: str):
    payload = _request_payload()
    item = _service().change_joining_status(
        application_id,
        payload.get("status"),
        reason=payload.get("reason") or "",
        joining_date=payload.get("joining_date") or "",
    )
    audit(
        "change_recruitment_joining_status",
        "recruitment_applications",
        application_id,
        {"status": payload.get("status")},
    )
    return _json_response(
        {"ok": True, "message": "Joining status updated.", "item": item}
    )


@recruitment_bp.post("/applications/<application_id>/convert-to-employee")
@tenant_module_required("recruitment")
def convert_candidate_to_employee(application_id: str):
    result = _service().convert_candidate_to_employee(application_id, _request_payload())
    employee = result.get("employee") or {}
    audit(
        "convert_candidate_to_employee",
        "employees",
        str(employee.get("_id") or ""),
        {"application_id": application_id},
    )
    return _json_response(
        {
            "ok": True,
            "message": "Candidate converted to an employee successfully.",
            **result,
        },
        201 if not result.get("already_converted") else 200,
    )


# -----------------------------------------------------------------------------
# Reports and activity
# -----------------------------------------------------------------------------


@recruitment_bp.get("/reports")
@tenant_module_required("recruitment")
def recruitment_reports():
    result = _service().get_reports(
        date_from=request.args.get("date_from", ""),
        date_to=request.args.get("date_to", ""),
        job_opening_id=request.args.get("job_opening_id", ""),
    )
    return _json_response({"ok": True, "data": result})


@recruitment_bp.get("/activity")
@tenant_module_required("recruitment")
def recruitment_activity():
    page, page_size = _query_page(default_size=50)
    result = _service().list_activity(
        application_id=request.args.get("application_id", ""),
        entity_type=request.args.get("entity_type", ""),
        page=page,
        page_size=page_size,
    )
    return _json_response({"ok": True, **result})


# -----------------------------------------------------------------------------
# Public career page and candidate application
# -----------------------------------------------------------------------------


@recruitment_bp.get("/public/<company_key>/jobs")
def public_job_openings(company_key: str):
    service, tenant, settings = _public_service_for_company(company_key)
    page, page_size = _query_page(default_size=20)
    jobs = service.list_job_openings(
        status="open",
        search=request.args.get("q") or request.args.get("search") or "",
        page=page,
        page_size=page_size,
        public=True,
    )
    return _json_response(
        {
            "ok": True,
            "company": _company_public_payload(tenant, settings),
            **jobs,
        }
    )


@recruitment_bp.get("/public/<company_key>/jobs/<job_slug>")
def public_job_opening(company_key: str, job_slug: str):
    service, tenant, settings = _public_service_for_company(company_key)
    job = service.get_public_job_by_slug(job_slug)
    return _json_response(
        {
            "ok": True,
            "company": _company_public_payload(tenant, settings),
            "item": job,
        }
    )


@recruitment_bp.post("/public/<company_key>/jobs/<job_slug>/resume-preview")
def public_resume_preview(company_key: str, job_slug: str):
    """Parse a resume without saving it and return reviewable job-match data."""

    service, _tenant, settings = _public_service_for_company(company_key)
    uploaded = request.files.get("resume") or request.files.get("file")
    if uploaded is None or not uploaded.filename:
        raise RecruitmentServiceError(
            "Select a resume before asking YourComate to extract the details.",
            code="resume_file_required",
        )

    max_mb = _int_value(settings.get("resume_max_size_mb"), 8, 1, 25)
    parsed = parse_resume_upload(
        uploaded,
        max_bytes=max_mb * 1024 * 1024,
    )
    preview = service.preview_public_resume_match(job_slug, parsed)

    return _json_response(
        {
            **preview,
            "message": (
                "Resume details were extracted. Review every field before "
                "submitting the application."
            ),
        }
    )


@recruitment_bp.post("/public/<company_key>/jobs/<job_slug>/apply")
def public_apply_to_job(company_key: str, job_slug: str):
    service, _tenant, settings = _public_service_for_company(company_key)
    job = service.get_public_job_by_slug(job_slug)
    payload = _request_payload()
    uploaded = request.files.get("resume") or request.files.get("file")
    if uploaded is None or not uploaded.filename:
        raise RecruitmentServiceError(
            "Resume file is required to apply for this vacancy.",
            code="resume_file_required",
        )

    max_mb = _int_value(settings.get("resume_max_size_mb"), 8, 1, 25)
    parsed = parse_resume_upload(uploaded, max_bytes=max_mb * 1024 * 1024)
    parsed_fields = parsed.get("fields") if isinstance(parsed.get("fields"), dict) else {}

    consent = payload.get("consent") if isinstance(payload.get("consent"), dict) else {}
    consent_accepted = bool(
        consent.get("accepted") is True
        or payload.get("consent_accepted") is True
        or str(payload.get("consent_accepted") or "").strip().lower() in {"1", "true", "yes", "on"}
    )
    candidate_payload = {
        **payload,
        "source": "career_page",
        "consent": {
            **consent,
            "accepted": consent_accepted,
            "text_version": safe_str(consent.get("text_version") or payload.get("consent_text_version") or "v1"),
            "ip_address": safe_str(request.headers.get("X-Forwarded-For") or request.remote_addr).split(",", 1)[0],
        },
    }

    email = normalize_email(
        candidate_payload.get("email")
        or candidate_payload.get("primary_email")
        or parsed_fields.get("email")
        or parsed_fields.get("primary_email")
    )
    phone = normalize_phone(
        candidate_payload.get("phone")
        or candidate_payload.get("primary_phone")
        or parsed_fields.get("phone")
        or parsed_fields.get("primary_phone")
    )
    duplicates = service.find_duplicate_candidates(
        email=email,
        phone=phone,
        resume_sha256=safe_str((parsed.get("source") or {}).get("sha256")),
    )
    if len(duplicates) > 1:
        raise RecruitmentServiceError(
            "An existing candidate profile could not be selected safely. Please contact HR.",
            code="duplicate_candidate_conflict",
            status_code=409,
        )

    allow_existing = str(duplicates[0]["_id"]) if duplicates else ""
    saved_file: dict[str, Any] | None = None

    try:
        resume_metadata = None
        if not allow_existing:
            saved_file = _save_uploaded_file(
                uploaded,
                tenant_id=service.tenant_id,
                category="resumes",
                allowed_extensions=set(ALLOWED_RESUME_EXTENSIONS),
                max_bytes=max_mb * 1024 * 1024,
                prefix="resume",
            )
            resume_metadata = {
                key: value
                for key, value in saved_file.items()
                if key != "absolute_path"
            }

        candidate = service.create_candidate(
            candidate_payload,
            parser_result=parsed,
            resume_metadata=resume_metadata,
            allow_existing_candidate_id=allow_existing,
            public=True,
        )
        application = service.create_application(
            {
                "candidate_id": str(candidate.get("_id")),
                "job_opening_id": str(job.get("_id")),
                "source": "career_page",
                "source_detail": safe_str(payload.get("source_detail")),
                "cover_letter": safe_str(payload.get("cover_letter")),
                "screening_answers": payload.get("screening_answers") or [],
                "employee_referral_user_id": safe_str(payload.get("employee_referral_user_id")),
            },
            public=True,
        )
    except Exception:
        if not allow_existing:
            _remove_saved_file(saved_file)
        raise

    return _json_response(
        {
            "ok": True,
            "message": "Your application has been submitted successfully.",
            "application": {
                "reference_no": application.get("reference_no"),
                "job_title": application.get("job_title"),
                "status": application.get("status"),
                "applied_at": application.get("applied_at"),
                "resume_match_score": application.get("resume_match_score"),
                "resume_match_band": application.get("resume_match_band"),
                "resume_match": application.get("resume_match"),
            },
            "candidate_message": safe_str(
                (application.get("resume_match") or {}).get("candidate_message")
            ),
        },
        201,
    )


# -----------------------------------------------------------------------------
# Public offer response and joining document portal
# -----------------------------------------------------------------------------


@recruitment_bp.get("/public/offers/<response_token>")
def public_offer(response_token: str):
    service = _public_service_for_token(OFFERS, "response_token_hash", response_token)
    return _json_response({"ok": True, "offer": service.get_public_offer(response_token)})


@recruitment_bp.post("/public/offers/<response_token>/respond")
def public_offer_response(response_token: str):
    payload = _request_payload()
    service = _public_service_for_token(OFFERS, "response_token_hash", response_token)
    result = service.respond_to_offer(
        response_token,
        payload.get("response") or payload.get("status"),
        reason=payload.get("reason") or "",
    )
    return _json_response(
        {"ok": True, "message": "Your offer response has been recorded.", **result}
    )


@recruitment_bp.get("/public/joining/<access_token>")
def public_joining_portal(access_token: str):
    service = _public_service_for_token(APPLICATIONS, "pre_joining_token_hash", access_token)
    return _json_response(
        {"ok": True, **service.get_public_joining_portal(access_token)}
    )


@recruitment_bp.post("/public/joining/<access_token>/documents/<document_key>")
def public_submit_joining_document(access_token: str, document_key: str):
    service = _public_service_for_token(APPLICATIONS, "pre_joining_token_hash", access_token)
    uploaded = request.files.get("document") or request.files.get("file")
    payload = _request_payload()
    saved_file: dict[str, Any] | None = None

    try:
        saved_file = _save_uploaded_file(
            uploaded,
            tenant_id=service.tenant_id,
            category="joining_documents",
            allowed_extensions=set(JOINING_DOCUMENT_EXTENSIONS),
            max_bytes=MAX_JOINING_DOCUMENT_BYTES,
            prefix="joining",
        )
        metadata = {
            key: value
            for key, value in saved_file.items()
            if key != "absolute_path"
        }
        result = service.submit_joining_document(
            access_token,
            document_key,
            metadata,
            candidate_note=payload.get("candidate_note") or payload.get("note") or "",
        )
    except Exception:
        _remove_saved_file(saved_file)
        raise

    return _json_response(
        {"ok": True, "message": "Joining document submitted successfully.", **result},
        201,
    )
