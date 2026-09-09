from __future__ import annotations

from typing import Any, Mapping

from flask import Blueprint, g, jsonify, request

from app.extensions import get_db
from app.middleware.tenant_guard import tenant_module_required
from app.services.payroll_branding_service import (
    ALLOWED_IMAGE_EXTENSIONS,
    MAX_PAYROLL_LOGO_BYTES,
    PayrollBrandingError,
    activate_payslip_design,
    build_preview_context,
    clear_payroll_logo,
    designer_catalog,
    get_payroll_branding_profile,
    list_payroll_branding_profiles,
    normalize_payslip_design,
    remove_managed_payroll_logo,
    render_payslip_html,
    reset_payslip_design_draft,
    safe_str,
    save_payroll_logo_file,
    save_payslip_design_draft,
    set_payroll_logo,
)
from app.utils.auth import audit, roles_required
from app.utils.serializers import clean_doc


payroll_branding_bp = Blueprint("payroll_branding", __name__)


PAYROLL_BRANDING_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
)


def _normalize_key(value: Any) -> str:
    return safe_str(value).lower().replace("-", "_").replace(" ", "_")


def _current_user() -> dict[str, Any]:
    return getattr(g, "current_user", {}) or {}


def _current_user_id() -> str:
    user = _current_user()
    return safe_str(user.get("_id") or user.get("id"))


def _current_tenant_id() -> str:
    user = _current_user()
    return safe_str(getattr(g, "tenant_id", None) or user.get("tenant_id") or "sds")


def _current_roles() -> set[str]:
    user = _current_user()
    raw_roles = user.get("roles") or []
    if isinstance(raw_roles, str):
        raw_roles = raw_roles.split(",")

    roles = {
        _normalize_key(role)
        for role in raw_roles
        if _normalize_key(role)
    }
    role = _normalize_key(user.get("role"))
    if role:
        roles.add(role)
    return roles


def _request_payload(*, required: bool = False) -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if payload is None:
        if required:
            raise PayrollBrandingError(
                "Request body must be a JSON object.",
                code="payroll_branding_invalid_request_body",
            )
        return {}
    if not isinstance(payload, dict):
        raise PayrollBrandingError(
            "Request body must be a JSON object.",
            code="payroll_branding_invalid_request_body",
        )
    return payload


def _requested_tenant_id(payload: Mapping[str, Any] | None = None) -> str:
    payload = payload or {}
    current_tenant = _current_tenant_id()
    requested_tenant = safe_str(
        payload.get("tenant_id")
        or request.args.get("tenant_id")
        or current_tenant
    )

    if requested_tenant != current_tenant and "super_admin" not in _current_roles():
        raise PayrollBrandingError(
            "You cannot manage payroll branding for another company.",
            code="payroll_branding_tenant_scope_forbidden",
            status_code=403,
            field="tenant_id",
        )

    return requested_tenant or current_tenant


def _organisation_reference(path_reference: Any = "", payload: Mapping[str, Any] | None = None) -> str:
    payload = payload or {}
    reference = safe_str(
        path_reference
        or payload.get("organisation_id")
        or payload.get("organization_id")
        or payload.get("organisation_code")
        or payload.get("organization_code")
        or request.args.get("organisation_id")
        or request.args.get("organization_id")
        or request.args.get("organisation_code")
        or request.args.get("organization_code")
    )
    return reference or "tenant"


def _success(message: str, **data: Any):
    payload = {"ok": True, "message": message}
    payload.update({key: clean_doc(value) for key, value in data.items()})
    return jsonify(payload)


def _profile_audit_meta(profile: Mapping[str, Any], tenant_id: str) -> dict[str, Any]:
    return {
        "tenant_id": tenant_id,
        "profile_key": safe_str(profile.get("profile_key")),
        "organisation_id": safe_str(profile.get("organisation_id")),
        "organization_id": safe_str(profile.get("organization_id")),
        "organisation_name": safe_str(profile.get("organisation_name")),
        "organization_name": safe_str(profile.get("organization_name")),
        "organisation_code": safe_str(profile.get("organisation_code")),
        "organization_code": safe_str(profile.get("organization_code")),
    }


@payroll_branding_bp.errorhandler(PayrollBrandingError)
def handle_payroll_branding_error(error: PayrollBrandingError):
    response = {
        "ok": False,
        "message": error.message,
        "code": error.code,
    }
    if error.field:
        response["field"] = error.field
    return jsonify(response), error.status_code


@payroll_branding_bp.get("/catalog")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_BRANDING_ROLES)
def get_payslip_designer_catalog():
    """Return the supported designer controls and the system-default payslip design."""
    _requested_tenant_id()
    catalog = designer_catalog()
    catalog["logo_upload"] = {
        "max_bytes": MAX_PAYROLL_LOGO_BYTES,
        "max_mb": round(MAX_PAYROLL_LOGO_BYTES / (1024 * 1024), 2),
        "allowed_extensions": sorted(ALLOWED_IMAGE_EXTENSIONS),
    }
    return _success(
        "Payslip designer catalogue fetched successfully.",
        catalog=catalog,
    )


@payroll_branding_bp.get("/profiles")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_BRANDING_ROLES)
def get_payroll_branding_profiles():
    """List all organisations available to HR with their effective payroll branding."""
    db = get_db()
    tenant_id = _requested_tenant_id()
    result = list_payroll_branding_profiles(db, tenant_id)
    return _success(
        "Payroll branding profiles fetched successfully.",
        **result,
    )


@payroll_branding_bp.get("/profiles/<path:organisation_reference>")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_BRANDING_ROLES)
def get_payroll_branding_profile_route(organisation_reference: str):
    """Fetch one organisation's effective logo, active design and editable draft."""
    db = get_db()
    tenant_id = _requested_tenant_id()
    profile = get_payroll_branding_profile(db, tenant_id, organisation_reference)
    return _success(
        "Payroll branding profile fetched successfully.",
        profile=profile,
    )


@payroll_branding_bp.post("/profiles/<path:organisation_reference>/logo")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_BRANDING_ROLES)
def upload_payroll_branding_logo(organisation_reference: str):
    """Upload/replace the dedicated payroll logo for one organisation."""
    db = get_db()
    tenant_id = _requested_tenant_id()
    reference = _organisation_reference(organisation_reference)
    actor_id = _current_user_id()

    uploaded = (
        request.files.get("logo")
        or request.files.get("payroll_logo")
        or request.files.get("file")
        or request.files.get("image")
    )
    if not uploaded or not safe_str(getattr(uploaded, "filename", "")):
        raise PayrollBrandingError(
            "Payroll logo file is required.",
            code="payroll_logo_file_required",
            field="logo",
        )

    existing = get_payroll_branding_profile(db, tenant_id, reference)
    previous_managed_logo = safe_str(existing.get("payroll_logo_url"))
    new_logo_url = ""

    try:
        new_logo_url = save_payroll_logo_file(uploaded, tenant_id, reference)
        profile = set_payroll_logo(
            db,
            tenant_id,
            reference,
            new_logo_url,
            actor_id=actor_id,
        )
    except Exception:
        if new_logo_url:
            remove_managed_payroll_logo(new_logo_url)
        raise

    if previous_managed_logo and previous_managed_logo != new_logo_url:
        remove_managed_payroll_logo(previous_managed_logo)

    audit(
        "payroll_branding_logo_updated",
        "payroll_branding_profiles",
        profile.get("id") or profile.get("profile_key"),
        {
            **_profile_audit_meta(profile, tenant_id),
            "logo_source": profile.get("logo_source"),
            "has_custom_payroll_logo": profile.get("has_custom_payroll_logo"),
        },
    )

    return _success(
        "Payroll logo uploaded successfully.",
        profile=profile,
    )


@payroll_branding_bp.delete("/profiles/<path:organisation_reference>/logo")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_BRANDING_ROLES)
def delete_payroll_branding_logo(organisation_reference: str):
    """Remove the custom payroll logo and return to organisation/tenant fallback branding."""
    db = get_db()
    payload = _request_payload(required=False)
    tenant_id = _requested_tenant_id(payload)
    reference = _organisation_reference(organisation_reference, payload)

    profile, previous_managed_logo = clear_payroll_logo(
        db,
        tenant_id,
        reference,
        actor_id=_current_user_id(),
    )
    if previous_managed_logo:
        remove_managed_payroll_logo(previous_managed_logo)

    audit(
        "payroll_branding_logo_removed",
        "payroll_branding_profiles",
        profile.get("id") or profile.get("profile_key"),
        {
            **_profile_audit_meta(profile, tenant_id),
            "fallback_logo_source": profile.get("logo_source"),
        },
    )

    return _success(
        "Custom payroll logo removed successfully.",
        profile=profile,
    )


@payroll_branding_bp.put("/profiles/<path:organisation_reference>/design/draft")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_BRANDING_ROLES)
def save_payroll_payslip_design_draft(organisation_reference: str):
    """Save an organisation-specific payslip presentation draft without affecting live payslips."""
    db = get_db()
    payload = _request_payload(required=True)
    tenant_id = _requested_tenant_id(payload)
    reference = _organisation_reference(organisation_reference, payload)
    design = payload.get("design")

    if not isinstance(design, Mapping):
        raise PayrollBrandingError(
            "Payslip design must be provided as a JSON object.",
            code="payslip_design_required",
            field="design",
        )

    profile = save_payslip_design_draft(
        db,
        tenant_id,
        reference,
        design,
        actor_id=_current_user_id(),
    )

    audit(
        "payroll_payslip_design_draft_saved",
        "payroll_branding_profiles",
        profile.get("id") or profile.get("profile_key"),
        {
            **_profile_audit_meta(profile, tenant_id),
            "draft_version": profile.get("draft_version"),
            "design_name": (profile.get("draft_design") or {}).get("name"),
        },
    )

    return _success(
        "Payslip design draft saved successfully.",
        profile=profile,
    )


@payroll_branding_bp.post("/profiles/<path:organisation_reference>/design/reset")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_BRANDING_ROLES)
def reset_payroll_payslip_design_draft(organisation_reference: str):
    """Reset the editable draft to the current active design or the system default."""
    db = get_db()
    payload = _request_payload(required=False)
    tenant_id = _requested_tenant_id(payload)
    reference = _organisation_reference(organisation_reference, payload)

    reset_mode = _normalize_key(payload.get("mode") or payload.get("reset_to"))
    if reset_mode in {"default", "system", "system_default"}:
        profile = save_payslip_design_draft(
            db,
            tenant_id,
            reference,
            designer_catalog()["default_design"],
            actor_id=_current_user_id(),
        )
        resolved_mode = "system_default"
    else:
        profile = reset_payslip_design_draft(
            db,
            tenant_id,
            reference,
            actor_id=_current_user_id(),
        )
        resolved_mode = "active_or_default"

    audit(
        "payroll_payslip_design_draft_reset",
        "payroll_branding_profiles",
        profile.get("id") or profile.get("profile_key"),
        {
            **_profile_audit_meta(profile, tenant_id),
            "draft_version": profile.get("draft_version"),
            "reset_mode": resolved_mode,
        },
    )

    return _success(
        "Payslip design draft reset successfully.",
        profile=profile,
    )


@payroll_branding_bp.post("/profiles/<path:organisation_reference>/design/activate")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_BRANDING_ROLES)
def activate_payroll_payslip_design(organisation_reference: str):
    """Promote the saved draft to the organisation's active payslip design."""
    db = get_db()
    payload = _request_payload(required=False)
    tenant_id = _requested_tenant_id(payload)
    reference = _organisation_reference(organisation_reference, payload)

    profile = activate_payslip_design(
        db,
        tenant_id,
        reference,
        actor_id=_current_user_id(),
    )

    audit(
        "payroll_payslip_design_activated",
        "payroll_branding_profiles",
        profile.get("id") or profile.get("profile_key"),
        {
            **_profile_audit_meta(profile, tenant_id),
            "active_version": profile.get("active_version"),
            "design_name": (profile.get("active_design") or {}).get("name"),
        },
    )

    return _success(
        "Payslip design activated successfully.",
        profile=profile,
    )


@payroll_branding_bp.post("/profiles/<path:organisation_reference>/preview")
@tenant_module_required("payroll")
@roles_required(*PAYROLL_BRANDING_ROLES)
def preview_payroll_payslip_design(organisation_reference: str):
    """Render an exact safe HTML preview using sample payroll data and the selected organisation."""
    db = get_db()
    payload = _request_payload(required=False)
    tenant_id = _requested_tenant_id(payload)
    reference = _organisation_reference(organisation_reference, payload)
    profile = get_payroll_branding_profile(db, tenant_id, reference)

    provided_design = payload.get("design")
    if provided_design is not None and not isinstance(provided_design, Mapping):
        raise PayrollBrandingError(
            "Preview design must be a JSON object.",
            code="payslip_preview_design_invalid",
            field="design",
        )

    if isinstance(provided_design, Mapping):
        design = normalize_payslip_design(provided_design)
        preview_source = "unsaved"
    elif profile.get("has_draft"):
        design = normalize_payslip_design(profile.get("draft_design"))
        preview_source = "draft"
    elif profile.get("has_active_custom_design"):
        design = normalize_payslip_design(profile.get("active_design"))
        preview_source = "active"
    else:
        design = normalize_payslip_design(None)
        preview_source = "system_default"

    context = build_preview_context(
        profile,
        logo_url=safe_str(profile.get("effective_logo_url")),
    )
    html = render_payslip_html(context, design)

    return _success(
        "Payslip preview generated successfully.",
        preview={
            "source": preview_source,
            "organisation_id": profile.get("organisation_id"),
            "organization_id": profile.get("organization_id"),
            "organisation_name": profile.get("organisation_name"),
            "organization_name": profile.get("organization_name"),
            "logo_source": profile.get("logo_source"),
            "design": design,
            "html": html,
        },
    )


__all__ = [
    "payroll_branding_bp",
    "PAYROLL_BRANDING_ROLES",
]
