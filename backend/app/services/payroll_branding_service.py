from __future__ import annotations

import os
import re
from copy import deepcopy
from datetime import datetime
from typing import Any, Iterable, Mapping
from uuid import uuid4

from bson import ObjectId
from flask import current_app
from jinja2 import Environment
from werkzeug.utils import secure_filename


PROFILE_COLLECTION = "payroll_branding_profiles"
TENANT_PROFILE_KEY = "tenant"
DESIGN_SCHEMA_VERSION = 1
MAX_PAYROLL_LOGO_BYTES = 3 * 1024 * 1024
ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
ALLOWED_PAGE_SIZES = {"A4", "Letter"}
ALLOWED_ORIENTATIONS = {"portrait", "landscape"}
ALLOWED_ALIGNMENTS = {"left", "center", "right"}
ALLOWED_LOGO_POSITIONS = {"left", "center", "right"}
ALLOWED_FONT_FAMILIES = {
    "Arial",
    "Helvetica",
    "Verdana",
    "Georgia",
    "Times New Roman",
}
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


class PayrollBrandingError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "payroll_branding_error",
        status_code: int = 400,
        field: str = "",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.field = field


def safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _object_id(value: Any) -> ObjectId | None:
    try:
        return ObjectId(safe_str(value))
    except Exception:
        return None


def _utcnow() -> datetime:
    return datetime.utcnow()


def _number(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def _int_in_range(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _clean_color(value: Any, fallback: str) -> str:
    text = safe_str(value)
    return text if COLOR_PATTERN.match(text) else fallback


def _first(record: Mapping[str, Any] | None, *keys: str) -> str:
    record = record or {}
    for key in keys:
        value = safe_str(record.get(key))
        if value:
            return value
    return ""


def _format_address(value: Any) -> str:
    if isinstance(value, Mapping):
        parts = [
            safe_str(value.get(key))
            for key in (
                "line1",
                "line2",
                "city",
                "district",
                "state",
                "postal_code",
                "pincode",
            )
            if safe_str(value.get(key))
        ]
        return ", ".join(parts)
    return safe_str(value)


def _company_initials(name: Any) -> str:
    words = [item for item in re.split(r"\s+", safe_str(name)) if item]
    if not words:
        return "YC"
    if len(words) == 1:
        return words[0][:3].upper()
    return "".join(item[0] for item in words[:4]).upper()


def _generic_logo_source(record: Mapping[str, Any] | None) -> str:
    record = record or {}
    branding = record.get("branding") or {}
    if not isinstance(branding, Mapping):
        branding = {}

    candidates = (
        record.get("payroll_logo"),
        record.get("payroll_logo_url"),
        record.get("payroll_logo_data_uri"),
        record.get("company_logo"),
        record.get("company_logo_url"),
        record.get("logo"),
        record.get("logo_url"),
        branding.get("payroll_logo"),
        branding.get("payroll_logo_url"),
        branding.get("company_logo"),
        branding.get("company_logo_url"),
        branding.get("logo"),
        branding.get("logo_url"),
    )
    for candidate in candidates:
        value = safe_str(candidate)
        if value and (
            value.startswith("data:image/")
            or value.startswith("http://")
            or value.startswith("https://")
            or value.startswith("/")
        ):
            return value
    return ""


EMPLOYEE_FIELD_CATALOG: tuple[dict[str, str], ...] = (
    {"key": "name", "label": "Name", "source": "employee"},
    {"key": "employee_code", "label": "Employee Code", "source": "employee"},
    {"key": "designation", "label": "Designation", "source": "employee"},
    {"key": "department", "label": "Department", "source": "employee"},
    {"key": "function", "label": "Function", "source": "employee"},
    {"key": "location", "label": "Location", "source": "employee"},
    {"key": "date_of_joining", "label": "Date of Joining", "source": "employee"},
    {"key": "pan", "label": "Permanent Account Number (PAN)", "source": "employee"},
    {"key": "uan", "label": "Universal Account Number (UAN)", "source": "employee"},
    {"key": "esi_number", "label": "ESI Number", "source": "employee"},
    {"key": "pran", "label": "PR Account Number (PRAN)", "source": "employee"},
    {"key": "account_number", "label": "Account No.", "source": "employee"},
    {"key": "ifsc_code", "label": "IFS Code", "source": "employee"},
    {"key": "paid_leave_days", "label": "Total Sanctioned Leave", "source": "attendance"},
    {"key": "lwp_days", "label": "LWP (Leave Without Pay)", "source": "attendance"},
    {"key": "leave_availed", "label": "Leave Availed During This Month", "source": "attendance"},
    {"key": "payable_days", "label": "No. of Days Salary Paid for", "source": "attendance"},
    {"key": "leave_balance", "label": "Leave Balance", "source": "attendance"},
)
EMPLOYEE_FIELD_BY_KEY = {item["key"]: item for item in EMPLOYEE_FIELD_CATALOG}

DEFAULT_EMPLOYEE_FIELDS = [
    "name",
    "pan",
    "employee_code",
    "uan",
    "function",
    "esi_number",
    "designation",
    "pran",
    "location",
    "ifsc_code",
    "account_number",
    "paid_leave_days",
    "date_of_joining",
    "lwp_days",
    "leave_availed",
    "payable_days",
    "leave_balance",
]

SECTION_CATALOG: tuple[dict[str, str], ...] = (
    {"key": "employee_info", "label": "Employee Information"},
    {"key": "earnings_deductions", "label": "Earnings & Deductions"},
    {"key": "advances", "label": "Advance Details"},
    {"key": "transfer", "label": "Payment / Transfer Details"},
    {"key": "footer", "label": "Footer / Signatory"},
)
ALLOWED_SECTION_KEYS = {item["key"] for item in SECTION_CATALOG}
DEFAULT_SECTION_ORDER = [item["key"] for item in SECTION_CATALOG]


def default_payslip_design() -> dict[str, Any]:
    return {
        "schema_version": DESIGN_SCHEMA_VERSION,
        "name": "Classic Payroll",
        "paper": {
            "size": "Letter",
            "orientation": "portrait",
            "margin_mm": 14,
        },
        "theme": {
            "font_family": "Arial",
            "base_font_size": 10,
            "primary_color": "#17251D",
            "accent_color": "#FFF18C",
            "border_color": "#B9B9B9",
            "muted_color": "#666666",
            "table_header_background": "#F0F0F0",
            "net_background": "#F8F8F8",
        },
        "header": {
            "alignment": "center",
            "show_logo": True,
            "logo_position": "left",
            "logo_width_px": 76,
            "logo_height_px": 56,
            "show_organisation_name": True,
            "show_address": True,
            "show_contact": False,
            "title_text": "Pay Slip",
        },
        "employee_info": {
            "visible": True,
            "columns": 2,
            "fields": deepcopy(DEFAULT_EMPLOYEE_FIELDS),
            "labels": {},
            "show_empty_values": True,
        },
        "earnings_deductions": {
            "visible": True,
            "earnings_title": "Earnings",
            "deductions_title": "Deductions",
            "gross_title": "Gross Salary",
            "amount_title": "Amount",
            "show_zero_values": True,
            "show_employer_contributions": True,
            "cost_to_company_label": "Cost to Company",
            "total_deductions_label": "Total Deductions",
            "net_amount_label": "Net Amount",
        },
        "advances": {
            "visible": True,
            "title": "Advance Details",
        },
        "transfer": {
            "visible": True,
            "show_amount_words": True,
            "show_transfer_date": True,
            "show_transfer_mode": True,
        },
        "footer": {
            "visible": True,
            "text": "*This is a computer generated slip & does not require any signature",
            "show_authorized_signatory": False,
            "authorized_signatory_label": "Authorized Signatory",
        },
        "section_order": deepcopy(DEFAULT_SECTION_ORDER),
    }


def designer_catalog() -> dict[str, Any]:
    return {
        "schema_version": DESIGN_SCHEMA_VERSION,
        "default_design": default_payslip_design(),
        "employee_fields": deepcopy(list(EMPLOYEE_FIELD_CATALOG)),
        "sections": deepcopy(list(SECTION_CATALOG)),
        "font_families": sorted(ALLOWED_FONT_FAMILIES),
        "page_sizes": sorted(ALLOWED_PAGE_SIZES),
        "orientations": sorted(ALLOWED_ORIENTATIONS),
        "alignments": sorted(ALLOWED_ALIGNMENTS),
        "logo_positions": sorted(ALLOWED_LOGO_POSITIONS),
        "rules": {
            "calculation_fields_are_read_only": True,
            "supports_custom_html": False,
            "supports_custom_javascript": False,
            "message": (
                "The designer controls presentation only. Earnings, deductions, "
                "attendance and net pay always come from the payroll engine."
            ),
        },
    }


def _merge_mapping(base: Mapping[str, Any], incoming: Mapping[str, Any] | None) -> dict[str, Any]:
    result = deepcopy(dict(base))
    if not isinstance(incoming, Mapping):
        return result
    for key, value in incoming.items():
        if isinstance(value, Mapping) and isinstance(result.get(key), Mapping):
            result[key] = _merge_mapping(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def normalize_payslip_design(value: Mapping[str, Any] | None) -> dict[str, Any]:
    design = _merge_mapping(default_payslip_design(), value)
    defaults = default_payslip_design()

    design["schema_version"] = DESIGN_SCHEMA_VERSION
    design["name"] = safe_str(design.get("name"))[:80] or defaults["name"]

    paper = design.get("paper") if isinstance(design.get("paper"), Mapping) else {}
    paper_size = safe_str(paper.get("size"))
    orientation = safe_str(paper.get("orientation")).lower()
    design["paper"] = {
        "size": paper_size if paper_size in ALLOWED_PAGE_SIZES else defaults["paper"]["size"],
        "orientation": orientation if orientation in ALLOWED_ORIENTATIONS else defaults["paper"]["orientation"],
        "margin_mm": _int_in_range(paper.get("margin_mm"), defaults["paper"]["margin_mm"], 6, 25),
    }

    theme = design.get("theme") if isinstance(design.get("theme"), Mapping) else {}
    font_family = safe_str(theme.get("font_family"))
    design["theme"] = {
        "font_family": font_family if font_family in ALLOWED_FONT_FAMILIES else defaults["theme"]["font_family"],
        "base_font_size": _int_in_range(theme.get("base_font_size"), defaults["theme"]["base_font_size"], 8, 14),
        "primary_color": _clean_color(theme.get("primary_color"), defaults["theme"]["primary_color"]),
        "accent_color": _clean_color(theme.get("accent_color"), defaults["theme"]["accent_color"]),
        "border_color": _clean_color(theme.get("border_color"), defaults["theme"]["border_color"]),
        "muted_color": _clean_color(theme.get("muted_color"), defaults["theme"]["muted_color"]),
        "table_header_background": _clean_color(
            theme.get("table_header_background"), defaults["theme"]["table_header_background"]
        ),
        "net_background": _clean_color(theme.get("net_background"), defaults["theme"]["net_background"]),
    }

    header = design.get("header") if isinstance(design.get("header"), Mapping) else {}
    alignment = safe_str(header.get("alignment")).lower()
    logo_position = safe_str(header.get("logo_position")).lower()
    design["header"] = {
        "alignment": alignment if alignment in ALLOWED_ALIGNMENTS else defaults["header"]["alignment"],
        "show_logo": bool(header.get("show_logo", defaults["header"]["show_logo"])),
        "logo_position": logo_position if logo_position in ALLOWED_LOGO_POSITIONS else defaults["header"]["logo_position"],
        "logo_width_px": _int_in_range(header.get("logo_width_px"), defaults["header"]["logo_width_px"], 40, 140),
        "logo_height_px": _int_in_range(header.get("logo_height_px"), defaults["header"]["logo_height_px"], 32, 100),
        "show_organisation_name": bool(
            header.get("show_organisation_name", defaults["header"]["show_organisation_name"])
        ),
        "show_address": bool(header.get("show_address", defaults["header"]["show_address"])),
        "show_contact": bool(header.get("show_contact", defaults["header"]["show_contact"])),
        "title_text": safe_str(header.get("title_text"))[:80] or defaults["header"]["title_text"],
    }

    employee_info = (
        design.get("employee_info") if isinstance(design.get("employee_info"), Mapping) else {}
    )
    requested_fields = employee_info.get("fields")
    if not isinstance(requested_fields, Iterable) or isinstance(requested_fields, (str, bytes, Mapping)):
        requested_fields = defaults["employee_info"]["fields"]
    normalized_fields: list[str] = []
    for raw in requested_fields:
        key = safe_str(raw)
        if key in EMPLOYEE_FIELD_BY_KEY and key not in normalized_fields:
            normalized_fields.append(key)
    if not normalized_fields:
        normalized_fields = deepcopy(defaults["employee_info"]["fields"])
    raw_labels = employee_info.get("labels") if isinstance(employee_info.get("labels"), Mapping) else {}
    normalized_labels: dict[str, str] = {}
    for key, value in raw_labels.items():
        field_key = safe_str(key)
        label = safe_str(value)[:80]
        if field_key in EMPLOYEE_FIELD_BY_KEY and label:
            normalized_labels[field_key] = label
    design["employee_info"] = {
        "visible": bool(employee_info.get("visible", defaults["employee_info"]["visible"])),
        "columns": 2,
        "fields": normalized_fields,
        "labels": normalized_labels,
        "show_empty_values": bool(
            employee_info.get("show_empty_values", defaults["employee_info"]["show_empty_values"])
        ),
    }

    earnings = (
        design.get("earnings_deductions")
        if isinstance(design.get("earnings_deductions"), Mapping)
        else {}
    )
    default_earnings = defaults["earnings_deductions"]
    design["earnings_deductions"] = {
        "visible": bool(earnings.get("visible", default_earnings["visible"])),
        "earnings_title": safe_str(earnings.get("earnings_title"))[:50] or default_earnings["earnings_title"],
        "deductions_title": safe_str(earnings.get("deductions_title"))[:50] or default_earnings["deductions_title"],
        "gross_title": safe_str(earnings.get("gross_title"))[:50] or default_earnings["gross_title"],
        "amount_title": safe_str(earnings.get("amount_title"))[:50] or default_earnings["amount_title"],
        "show_zero_values": bool(earnings.get("show_zero_values", default_earnings["show_zero_values"])),
        "show_employer_contributions": bool(
            earnings.get("show_employer_contributions", default_earnings["show_employer_contributions"])
        ),
        "cost_to_company_label": safe_str(earnings.get("cost_to_company_label"))[:60]
        or default_earnings["cost_to_company_label"],
        "total_deductions_label": safe_str(earnings.get("total_deductions_label"))[:60]
        or default_earnings["total_deductions_label"],
        "net_amount_label": safe_str(earnings.get("net_amount_label"))[:60]
        or default_earnings["net_amount_label"],
    }

    advances = design.get("advances") if isinstance(design.get("advances"), Mapping) else {}
    design["advances"] = {
        "visible": bool(advances.get("visible", defaults["advances"]["visible"])),
        "title": safe_str(advances.get("title"))[:60] or defaults["advances"]["title"],
    }

    transfer = design.get("transfer") if isinstance(design.get("transfer"), Mapping) else {}
    design["transfer"] = {
        "visible": bool(transfer.get("visible", defaults["transfer"]["visible"])),
        "show_amount_words": bool(transfer.get("show_amount_words", defaults["transfer"]["show_amount_words"])),
        "show_transfer_date": bool(transfer.get("show_transfer_date", defaults["transfer"]["show_transfer_date"])),
        "show_transfer_mode": bool(transfer.get("show_transfer_mode", defaults["transfer"]["show_transfer_mode"])),
    }

    footer = design.get("footer") if isinstance(design.get("footer"), Mapping) else {}
    footer_text = safe_str(footer.get("text"))[:300]
    signatory_label = safe_str(footer.get("authorized_signatory_label"))[:80]
    design["footer"] = {
        "visible": bool(footer.get("visible", defaults["footer"]["visible"])),
        "text": footer_text or defaults["footer"]["text"],
        "show_authorized_signatory": bool(
            footer.get("show_authorized_signatory", defaults["footer"]["show_authorized_signatory"])
        ),
        "authorized_signatory_label": signatory_label or defaults["footer"]["authorized_signatory_label"],
    }

    section_order = design.get("section_order")
    if not isinstance(section_order, Iterable) or isinstance(section_order, (str, bytes, Mapping)):
        section_order = defaults["section_order"]
    normalized_sections: list[str] = []
    for raw in section_order:
        key = safe_str(raw)
        if key in ALLOWED_SECTION_KEYS and key not in normalized_sections:
            normalized_sections.append(key)
    for key in DEFAULT_SECTION_ORDER:
        if key not in normalized_sections:
            normalized_sections.append(key)
    design["section_order"] = normalized_sections

    return design


def _tenant_record(db: Any, tenant_id: str) -> dict[str, Any]:
    values = list(dict.fromkeys([tenant_id, tenant_id.lower(), tenant_id.upper()]))
    return db.tenants.find_one({
        "tenant_id": {"$in": values},
        "is_deleted": {"$ne": True},
    }) or {}


def _tenant_identity(db: Any, tenant_id: str) -> dict[str, Any]:
    tenant = _tenant_record(db, tenant_id)
    name = _first(tenant, "company_name", "name", "tenant_name", "legal_name") or tenant_id.upper()
    code = _first(tenant, "tenant_code", "code").upper()
    return {
        "profile_key": TENANT_PROFILE_KEY,
        "organisation_id": "",
        "organization_id": "",
        "name": name,
        "organisation_name": name,
        "organization_name": name,
        "code": code,
        "organisation_code": code,
        "organization_code": code,
        "address": _format_address(
            tenant.get("address") or tenant.get("registered_address") or tenant.get("office_address")
        ),
        "email": _first(tenant, "email", "official_email", "contact_email"),
        "phone": _first(tenant, "phone", "mobile", "contact_number"),
        "website": _first(tenant, "website", "website_url"),
        "default_logo_url": _generic_logo_source(tenant),
        "is_tenant_fallback": True,
    }


def _organisation_identity(record: Mapping[str, Any]) -> dict[str, Any]:
    organisation_id = safe_str(
        record.get("_id")
        or record.get("id")
        or record.get("organisation_id")
        or record.get("organization_id")
    )
    name = _first(record, "name", "organisation_name", "organization_name")
    code = _first(record, "code", "organisation_code", "organization_code").upper()
    return {
        "profile_key": f"org:{organisation_id}" if organisation_id else f"org-name:{name.lower()}",
        "organisation_id": organisation_id,
        "organization_id": organisation_id,
        "name": name,
        "organisation_name": name,
        "organization_name": name,
        "code": code,
        "organisation_code": code,
        "organization_code": code,
        "address": _format_address(
            record.get("address") or record.get("registered_address") or record.get("office_address")
        ),
        "email": _first(record, "email", "official_email", "contact_email"),
        "phone": _first(record, "phone", "mobile", "contact_number"),
        "website": _first(record, "website", "website_url"),
        "default_logo_url": _generic_logo_source(record),
        "is_tenant_fallback": False,
    }


def list_organisation_identities(db: Any, tenant_id: str) -> list[dict[str, Any]]:
    cursor = db.organisations.find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$nin": ["deleted", "inactive"]},
    }).sort([("name", 1), ("organisation_name", 1), ("code", 1)])
    items = [_organisation_identity(item) for item in cursor]
    items = [item for item in items if item.get("name") or item.get("organisation_id")]
    if not items:
        return [_tenant_identity(db, tenant_id)]
    return items


def resolve_organisation_identity(db: Any, tenant_id: str, reference: Any) -> dict[str, Any]:
    ref = safe_str(reference)
    if not ref or ref.lower() in {"tenant", "default", "company"}:
        identities = list_organisation_identities(db, tenant_id)
        if len(identities) == 1:
            return identities[0]
        return _tenant_identity(db, tenant_id)

    if ref.startswith("org:"):
        ref = ref[4:]

    filters: list[dict[str, Any]] = []
    object_id = _object_id(ref)
    if object_id:
        filters.append({"_id": object_id})
    filters.extend([
        {"_id": ref},
        {"id": ref},
        {"organisation_id": ref},
        {"organization_id": ref},
    ])
    escaped = re.escape(ref)
    exact = {"$regex": f"^{escaped}$", "$options": "i"}
    filters.extend([
        {"code": exact},
        {"organisation_code": exact},
        {"organization_code": exact},
        {"name": exact},
        {"organisation_name": exact},
        {"organization_name": exact},
    ])

    record = db.organisations.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": filters,
    })
    if not record:
        raise PayrollBrandingError(
            "The selected organisation was not found for this company.",
            code="payroll_branding_organisation_not_found",
            status_code=404,
            field="organisation_id",
        )
    return _organisation_identity(record)


def ensure_payroll_branding_indexes(db: Any) -> None:
    collection = db[PROFILE_COLLECTION]
    collection.create_index(
        [("tenant_id", 1), ("profile_key", 1)],
        unique=True,
        name="payroll_branding_profile_scope_unique",
    )
    collection.create_index(
        [("tenant_id", 1), ("organisation_id", 1)],
        name="payroll_branding_organisation_lookup",
    )


def _profile_query(tenant_id: str, identity: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "tenant_id": tenant_id,
        "profile_key": safe_str(identity.get("profile_key")) or TENANT_PROFILE_KEY,
        "is_deleted": {"$ne": True},
    }


def _effective_logo(profile: Mapping[str, Any], identity: Mapping[str, Any], tenant: Mapping[str, Any]) -> tuple[str, str]:
    configured = safe_str(profile.get("payroll_logo_url") or profile.get("payroll_logo"))
    if configured:
        return configured, "payroll_branding"
    organisation_logo = safe_str(identity.get("default_logo_url"))
    if organisation_logo:
        return organisation_logo, "organisation"
    tenant_logo = _generic_logo_source(tenant)
    if tenant_logo:
        return tenant_logo, "tenant"
    return "", "initials"


def _serialize_profile(
    db: Any,
    tenant_id: str,
    identity: Mapping[str, Any],
    profile: Mapping[str, Any] | None,
) -> dict[str, Any]:
    profile = profile or {}
    tenant = _tenant_record(db, tenant_id)
    logo_url, logo_source = _effective_logo(profile, identity, tenant)
    active_design = normalize_payslip_design(profile.get("active_design"))
    draft_source = profile.get("draft_design") or profile.get("active_design")
    draft_design = normalize_payslip_design(draft_source)
    active_version = int(profile.get("active_version") or 0)
    draft_version = int(profile.get("draft_version") or active_version or 1)

    return {
        "id": safe_str(profile.get("_id")),
        "tenant_id": tenant_id,
        "profile_key": safe_str(identity.get("profile_key")),
        "organisation_id": safe_str(identity.get("organisation_id")),
        "organization_id": safe_str(identity.get("organization_id")),
        "organisation_name": safe_str(identity.get("name")),
        "organization_name": safe_str(identity.get("name")),
        "organisation_code": safe_str(identity.get("code")),
        "organization_code": safe_str(identity.get("code")),
        "address": safe_str(identity.get("address")),
        "email": safe_str(identity.get("email")),
        "phone": safe_str(identity.get("phone")),
        "website": safe_str(identity.get("website")),
        "is_tenant_fallback": bool(identity.get("is_tenant_fallback")),
        "payroll_logo_url": safe_str(profile.get("payroll_logo_url")),
        "effective_logo_url": logo_url,
        "logo_source": logo_source,
        "has_custom_payroll_logo": bool(safe_str(profile.get("payroll_logo_url"))),
        "active_design": active_design,
        "active_version": active_version,
        "has_active_custom_design": bool(profile.get("active_design")),
        "draft_design": draft_design,
        "draft_version": draft_version,
        "has_draft": bool(profile.get("draft_design")),
        "active_at": profile.get("active_at"),
        "updated_at": profile.get("updated_at"),
        "updated_by": safe_str(profile.get("updated_by")),
    }


def get_payroll_branding_profile(db: Any, tenant_id: str, organisation_reference: Any) -> dict[str, Any]:
    identity = resolve_organisation_identity(db, tenant_id, organisation_reference)
    profile = db[PROFILE_COLLECTION].find_one(_profile_query(tenant_id, identity)) or {}
    return _serialize_profile(db, tenant_id, identity, profile)


def list_payroll_branding_profiles(db: Any, tenant_id: str) -> dict[str, Any]:
    identities = list_organisation_identities(db, tenant_id)
    profiles = [
        _serialize_profile(
            db,
            tenant_id,
            identity,
            db[PROFILE_COLLECTION].find_one(_profile_query(tenant_id, identity)) or {},
        )
        for identity in identities
    ]
    return {
        "tenant_id": tenant_id,
        "organisation_count": len(profiles),
        "selection_mode": "single" if len(profiles) <= 1 else "multiple",
        "profiles": profiles,
    }


def _upsert_profile(
    db: Any,
    tenant_id: str,
    identity: Mapping[str, Any],
    set_fields: Mapping[str, Any],
    *,
    actor_id: str,
) -> dict[str, Any]:
    ensure_payroll_branding_indexes(db)
    now = _utcnow()
    query = _profile_query(tenant_id, identity)
    query.pop("is_deleted", None)
    payload = {
        **dict(set_fields),
        "tenant_id": tenant_id,
        "profile_key": safe_str(identity.get("profile_key")) or TENANT_PROFILE_KEY,
        "organisation_id": safe_str(identity.get("organisation_id")),
        "organization_id": safe_str(identity.get("organization_id")),
        "organisation_name_snapshot": safe_str(identity.get("name")),
        "organization_name_snapshot": safe_str(identity.get("name")),
        "organisation_code_snapshot": safe_str(identity.get("code")),
        "organization_code_snapshot": safe_str(identity.get("code")),
        "is_deleted": False,
        "updated_at": now,
        "updated_by": safe_str(actor_id),
    }
    db[PROFILE_COLLECTION].update_one(
        query,
        {
            "$set": payload,
            "$setOnInsert": {
                "created_at": now,
                "created_by": safe_str(actor_id),
            },
        },
        upsert=True,
    )
    record = db[PROFILE_COLLECTION].find_one(query) or {}
    return _serialize_profile(db, tenant_id, identity, record)


def set_payroll_logo(
    db: Any,
    tenant_id: str,
    organisation_reference: Any,
    logo_url: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    identity = resolve_organisation_identity(db, tenant_id, organisation_reference)
    logo_url = safe_str(logo_url)
    if not logo_url:
        raise PayrollBrandingError(
            "Payroll logo URL is required.",
            code="payroll_logo_required",
            field="logo",
        )
    return _upsert_profile(
        db,
        tenant_id,
        identity,
        {
            "payroll_logo_url": logo_url,
            "payroll_logo": logo_url,
        },
        actor_id=actor_id,
    )


def clear_payroll_logo(
    db: Any,
    tenant_id: str,
    organisation_reference: Any,
    *,
    actor_id: str,
) -> tuple[dict[str, Any], str]:
    identity = resolve_organisation_identity(db, tenant_id, organisation_reference)
    existing = db[PROFILE_COLLECTION].find_one(_profile_query(tenant_id, identity)) or {}
    previous = safe_str(existing.get("payroll_logo_url") or existing.get("payroll_logo"))
    profile = _upsert_profile(
        db,
        tenant_id,
        identity,
        {"payroll_logo_url": "", "payroll_logo": ""},
        actor_id=actor_id,
    )
    return profile, previous


def save_payslip_design_draft(
    db: Any,
    tenant_id: str,
    organisation_reference: Any,
    design: Mapping[str, Any] | None,
    *,
    actor_id: str,
) -> dict[str, Any]:
    identity = resolve_organisation_identity(db, tenant_id, organisation_reference)
    normalized = normalize_payslip_design(design)
    existing = db[PROFILE_COLLECTION].find_one(_profile_query(tenant_id, identity)) or {}
    current_draft_version = int(existing.get("draft_version") or existing.get("active_version") or 0)
    next_draft_version = max(1, current_draft_version + 1)
    return _upsert_profile(
        db,
        tenant_id,
        identity,
        {
            "draft_design": normalized,
            "draft_version": next_draft_version,
            "draft_saved_at": _utcnow(),
            "draft_saved_by": safe_str(actor_id),
        },
        actor_id=actor_id,
    )


def reset_payslip_design_draft(
    db: Any,
    tenant_id: str,
    organisation_reference: Any,
    *,
    actor_id: str,
) -> dict[str, Any]:
    identity = resolve_organisation_identity(db, tenant_id, organisation_reference)
    existing = db[PROFILE_COLLECTION].find_one(_profile_query(tenant_id, identity)) or {}
    base = existing.get("active_design") or default_payslip_design()
    current_draft_version = int(existing.get("draft_version") or existing.get("active_version") or 0)
    return _upsert_profile(
        db,
        tenant_id,
        identity,
        {
            "draft_design": normalize_payslip_design(base),
            "draft_version": max(1, current_draft_version + 1),
            "draft_saved_at": _utcnow(),
            "draft_saved_by": safe_str(actor_id),
        },
        actor_id=actor_id,
    )


def activate_payslip_design(
    db: Any,
    tenant_id: str,
    organisation_reference: Any,
    *,
    actor_id: str,
) -> dict[str, Any]:
    identity = resolve_organisation_identity(db, tenant_id, organisation_reference)
    existing = db[PROFILE_COLLECTION].find_one(_profile_query(tenant_id, identity)) or {}
    draft = existing.get("draft_design")
    if not isinstance(draft, Mapping):
        raise PayrollBrandingError(
            "Save a payslip design draft before activating it.",
            code="payslip_design_draft_required",
            field="draft_design",
        )
    active_version = max(
        int(existing.get("active_version") or 0) + 1,
        int(existing.get("draft_version") or 1),
    )
    now = _utcnow()
    return _upsert_profile(
        db,
        tenant_id,
        identity,
        {
            "active_design": normalize_payslip_design(draft),
            "active_version": active_version,
            "active_at": now,
            "active_by": safe_str(actor_id),
            "draft_design": normalize_payslip_design(draft),
            "draft_version": active_version,
        },
        actor_id=actor_id,
    )


def build_payroll_branding_snapshot(
    db: Any,
    tenant_id: str,
    organisation_reference: Any,
) -> dict[str, Any]:
    profile = get_payroll_branding_profile(db, tenant_id, organisation_reference)
    design = normalize_payslip_design(profile.get("active_design"))
    return {
        "schema_version": DESIGN_SCHEMA_VERSION,
        "profile_key": safe_str(profile.get("profile_key")),
        "organisation_id": safe_str(profile.get("organisation_id")),
        "organization_id": safe_str(profile.get("organization_id")),
        "organisation_name": safe_str(profile.get("organisation_name")),
        "organization_name": safe_str(profile.get("organization_name")),
        "organisation_code": safe_str(profile.get("organisation_code")),
        "organization_code": safe_str(profile.get("organization_code")),
        "address": safe_str(profile.get("address")),
        "email": safe_str(profile.get("email")),
        "phone": safe_str(profile.get("phone")),
        "website": safe_str(profile.get("website")),
        "logo_url": safe_str(profile.get("effective_logo_url")),
        "logo_source": safe_str(profile.get("logo_source")),
        "design": design,
        "design_version": int(profile.get("active_version") or 0),
        "design_source": "custom" if profile.get("has_active_custom_design") else "system_default",
        "captured_at": _utcnow(),
    }


def resolve_snapshot_for_employee(
    db: Any,
    tenant_id: str,
    employee: Mapping[str, Any],
) -> dict[str, Any]:
    reference = (
        employee.get("organisation_id")
        or employee.get("organization_id")
        or employee.get("organisation_code")
        or employee.get("organization_code")
        or employee.get("organisation")
        or employee.get("organization")
        or employee.get("organisation_name")
        or employee.get("organization_name")
    )
    return build_payroll_branding_snapshot(db, tenant_id, reference)


def _payroll_logo_upload_root() -> str:
    configured = current_app.config.get("COMPANY_LOGO_UPLOAD_FOLDER")
    if configured:
        root = configured
    else:
        root = os.path.join(current_app.root_path, "..", "uploads", "company_logos")
    root = os.path.abspath(root)
    os.makedirs(root, exist_ok=True)
    return root


def _sniff_image_extension(path: str, fallback: str) -> str:
    with open(path, "rb") as handle:
        head = handle.read(16)
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "webp"
    return fallback.lower()


def save_payroll_logo_file(file: Any, tenant_id: str, organisation_reference: Any) -> str:
    if not file:
        raise PayrollBrandingError(
            "Payroll logo file is required.",
            code="payroll_logo_file_required",
            field="logo",
        )
    original_name = secure_filename(getattr(file, "filename", "") or "")
    if not original_name or "." not in original_name:
        raise PayrollBrandingError(
            "Only JPG, JPEG, PNG, and WEBP logo images are allowed.",
            code="payroll_logo_invalid_type",
            field="logo",
        )
    fallback_ext = original_name.rsplit(".", 1)[-1].lower()
    if fallback_ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise PayrollBrandingError(
            "Only JPG, JPEG, PNG, and WEBP logo images are allowed.",
            code="payroll_logo_invalid_type",
            field="logo",
        )

    file.seek(0, os.SEEK_END)
    file_size = int(file.tell())
    file.seek(0)
    if file_size <= 0:
        raise PayrollBrandingError(
            "The selected payroll logo is empty.",
            code="payroll_logo_empty",
            field="logo",
        )
    if file_size > MAX_PAYROLL_LOGO_BYTES:
        raise PayrollBrandingError(
            "Payroll logo must be 3 MB or smaller.",
            code="payroll_logo_too_large",
            field="logo",
        )

    tenant_folder = secure_filename(safe_str(tenant_id).lower()) or "tenant"
    org_slug = secure_filename(safe_str(organisation_reference).lower())[:48] or "default"
    upload_root = _payroll_logo_upload_root()
    tenant_dir = os.path.join(upload_root, tenant_folder)
    os.makedirs(tenant_dir, exist_ok=True)

    temp_path = os.path.join(tenant_dir, f"tmp_payroll_{uuid4().hex}.{fallback_ext}")
    file.save(temp_path)
    detected_ext = _sniff_image_extension(temp_path, fallback_ext)
    if detected_ext not in ALLOWED_IMAGE_EXTENSIONS:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise PayrollBrandingError(
            "The selected file is not a valid logo image.",
            code="payroll_logo_invalid_image",
            field="logo",
        )

    final_name = secure_filename(
        f"payroll_logo_{org_slug}_{uuid4().hex}.{detected_ext}"
    )
    final_path = os.path.join(tenant_dir, final_name)
    os.replace(temp_path, final_path)
    return f"/api/v1/uploads/company_logos/{tenant_folder}/{final_name}"


def remove_managed_payroll_logo(logo_url: Any) -> None:
    value = safe_str(logo_url)
    prefix = "/api/v1/uploads/company_logos/"
    if not value.startswith(prefix):
        return
    relative = value[len(prefix):]
    parts = relative.split("/", 1)
    if len(parts) != 2:
        return
    tenant_folder = secure_filename(parts[0])
    filename = secure_filename(parts[1])
    if not tenant_folder or not filename or not filename.startswith("payroll_logo_"):
        return
    root = _payroll_logo_upload_root()
    path = os.path.abspath(os.path.join(root, tenant_folder, filename))
    try:
        if os.path.commonpath([root, path]) != root:
            return
    except ValueError:
        return
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


def _money(value: Any) -> str:
    amount = _number(value, 0)
    if abs(amount - round(amount)) < 0.000001:
        return f"₹ {int(round(amount)):,}"
    return f"₹ {amount:,.2f}"


def _plain(value: Any) -> str:
    amount = _number(value, 0)
    if abs(amount - round(amount)) < 0.000001:
        return f"{int(round(amount)):,}"
    return f"{amount:,.2f}"


def _field_value(context: Mapping[str, Any], key: str) -> Any:
    item = EMPLOYEE_FIELD_BY_KEY.get(key) or {}
    source = safe_str(item.get("source"))
    record = context.get(source) if isinstance(context.get(source), Mapping) else {}
    value = record.get(key) if isinstance(record, Mapping) else ""
    if key in {"paid_leave_days", "lwp_days", "leave_availed", "payable_days", "leave_balance"}:
        if value in {None, ""}:
            value = 0
        return f"{value} Days"
    return value


def _display_employee_rows(context: Mapping[str, Any], design: Mapping[str, Any]) -> list[list[dict[str, Any]]]:
    settings = design.get("employee_info") or {}
    show_empty = bool(settings.get("show_empty_values", True))
    cells: list[dict[str, Any]] = []
    for key in settings.get("fields") or []:
        meta = EMPLOYEE_FIELD_BY_KEY.get(safe_str(key))
        if not meta:
            continue
        value = _field_value(context, meta["key"])
        empty = value in {None, "", "—"}
        if empty and not show_empty:
            continue
        custom_labels = settings.get("labels") if isinstance(settings.get("labels"), Mapping) else {}
        cells.append({
            "key": meta["key"],
            "label": safe_str(custom_labels.get(meta["key"])) or meta["label"],
            "value": value if not empty else "—",
        })
    rows: list[list[dict[str, Any]]] = []
    for index in range(0, len(cells), 2):
        rows.append(cells[index:index + 2])
    return rows


def _normalize_component_rows(rows: Any, *, show_zero: bool) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in rows or []:
        if isinstance(item, Mapping):
            label = safe_str(item.get("label") or item.get("name") or item.get("code"))
            amount = _number(item.get("amount", item.get("payable_amount", 0)), 0)
            code = safe_str(item.get("code"))
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            label = safe_str(item[0])
            amount = _number(item[1], 0)
            code = ""
        else:
            continue
        if not label:
            continue
        if not show_zero and abs(amount) < 0.000001:
            continue
        normalized.append({"label": label, "amount": amount, "code": code})
    return normalized


def build_preview_context(
    organisation: Mapping[str, Any] | None = None,
    *,
    logo_url: str = "",
) -> dict[str, Any]:
    organisation = organisation or {}
    name = safe_str(
        organisation.get("organisation_name")
        or organisation.get("organization_name")
        or organisation.get("name")
        or "Your Organisation"
    )
    code = safe_str(
        organisation.get("organisation_code")
        or organisation.get("organization_code")
        or organisation.get("code")
    )
    return {
        "company": {
            "name": name,
            "address": safe_str(organisation.get("address")) or "Registered office address",
            "email": safe_str(organisation.get("email")),
            "phone": safe_str(organisation.get("phone")),
            "website": safe_str(organisation.get("website")),
            "initials": code or _company_initials(name),
            "logo_data_uri": safe_str(logo_url or organisation.get("effective_logo_url")),
            "logo_src": safe_str(logo_url or organisation.get("effective_logo_url")),
        },
        "month_name": "September",
        "year": 2026,
        "employee": {
            "name": "Sample Employee",
            "employee_code": "EMP-001",
            "designation": "Senior Executive",
            "department": "Operations",
            "function": "Operations",
            "location": "Guwahati, Assam",
            "date_of_joining": "01-04-2024",
            "pan": "ABCDE1234F",
            "uan": "100000000001",
            "esi_number": "NA",
            "pran": "NA",
            "account_number": "XXXXXX1234",
            "ifsc_code": "SBIN0000001",
        },
        "attendance": {
            "paid_leave_days": 1,
            "lwp_days": 0,
            "leave_availed": 1,
            "payable_days": 30,
            "salary_paid_days": 30,
            "leave_balance": 12,
        },
        "all_earning_rows": [
            {"label": "Basic", "amount": 25000, "code": "basic"},
            {"label": "HRA", "amount": 10000, "code": "hra"},
            {"label": "Medical Allowance", "amount": 2500, "code": "medical_allowance"},
            {"label": "Special Allowance", "amount": 9000, "code": "special_allowance"},
            {"label": "Employer PF", "amount": 3000, "code": "pf_employer"},
        ],
        "all_deduction_rows": [
            {"label": "PF Contribution - Employee", "amount": 3000, "code": "pf_employee"},
            {"label": "Professional Tax", "amount": 208, "code": "professional_tax"},
            {"label": "TDS", "amount": 1000, "code": "tds"},
        ],
        "earning_rows": [],
        "deduction_rows": [],
        "advance_rows": [
            {"label": "Work Advance", "date": "", "balance": "", "deduction": 0, "bills_received": "", "pending": ""},
            {"label": "Tour Advance", "date": "", "balance": "", "deduction": 0, "bills_received": "", "pending": ""},
            {"label": "Personal Advance", "date": "", "balance": "", "deduction": 0, "bills_received": "", "pending": ""},
        ],
        "transfer": {"transfer_date": "30-09-2026", "transfer_mode": "Bank Transfer"},
        "totals": {
            "cost_to_company": 49500,
            "total_deductions": 4208,
            "net_amount": 42292,
            "advances": 0,
        },
        "amount_words": "Rupees Forty Two Thousand Two Hundred Ninety Two only",
        "net_amount": 42292,
    }


PAYSLIP_DESIGNER_HTML_TEMPLATE = r"""
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @page { size: {{ design.paper.size }} {{ design.paper.orientation }}; margin: {{ design.paper.margin_mm }}mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #222; font-family: {{ design.theme.font_family }}, Arial, sans-serif; font-size: {{ design.theme.base_font_size }}px; }
  .sheet { width: 100%; }
  .header { display: grid; grid-template-columns: 110px 1fr 110px; align-items: center; margin-bottom: 8px; min-height: {{ design.header.logo_height_px }}px; }
  .header.logo-center { grid-template-columns: 1fr; gap: 5px; }
  .header.logo-right .logo-box { grid-column: 3; }
  .header.logo-right .company { grid-column: 2; grid-row: 1; }
  .logo-box { width: 100%; min-height: {{ design.header.logo_height_px }}px; display: flex; align-items: center; justify-content: center; color: {{ design.theme.primary_color }}; font-weight: 800; font-size: 20px; }
  .logo-box img { max-width: {{ design.header.logo_width_px }}px; max-height: {{ design.header.logo_height_px }}px; object-fit: contain; }
  .company { text-align: {{ design.header.alignment }}; }
  .company h1 { margin: 0; font-size: calc({{ design.theme.base_font_size }}px + 10px); color: {{ design.theme.primary_color }}; }
  .company p { margin: 2px 0 0; color: {{ design.theme.muted_color }}; }
  .title { text-align: center; font-size: calc({{ design.theme.base_font_size }}px + 3px); font-weight: 700; margin: 6px 0 9px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  td, th { border: 1px solid {{ design.theme.border_color }}; padding: 4px 5px; vertical-align: middle; }
  .info td { min-height: 24px; }
  .info .label { font-weight: 700; width: 19%; }
  .info .value { width: 31%; }
  .section-head { background: {{ design.theme.accent_color }}; font-weight: 700; text-align: left; }
  .earnings th, .advance th { background: {{ design.theme.table_header_background }}; text-align: left; }
  .amount, .right { text-align: right; }
  .center { text-align: center; }
  .summary td { font-weight: 700; }
  .net { font-size: calc({{ design.theme.base_font_size }}px + 3px); font-weight: 800; text-align: center; background: {{ design.theme.net_background }}; }
  .footer-note { background: {{ design.theme.accent_color }}; border: 1px solid {{ design.theme.border_color }}; padding: 6px; margin-top: 7px; }
  .signatory { margin-top: 22px; text-align: right; font-weight: 700; }
  .spacer { height: 6px; }
</style>
</head>
<body>
<div class="sheet">
  <div class="header logo-{{ design.header.logo_position }}{% if design.header.logo_position == 'center' %} logo-center{% endif %}">
    {% if design.header.show_logo %}
    <div class="logo-box">
      {% if company.logo_data_uri %}<img src="{{ company.logo_data_uri }}" alt="Logo">{% else %}{{ company.initials }}{% endif %}
    </div>
    {% endif %}
    <div class="company">
      {% if design.header.show_organisation_name %}<h1>{{ company.name }}</h1>{% endif %}
      {% if design.header.show_address and company.address %}<p>{{ company.address }}</p>{% endif %}
      {% if design.header.show_contact %}
        <p>{% if company.email %}{{ company.email }}{% endif %}{% if company.phone %}{% if company.email %} · {% endif %}{{ company.phone }}{% endif %}{% if company.website %}{% if company.email or company.phone %} · {% endif %}{{ company.website }}{% endif %}</p>
      {% endif %}
    </div>
    {% if design.header.logo_position != 'center' %}<div></div>{% endif %}
  </div>

  <div class="title">{{ design.header.title_text }} for {{ month_name }} - {{ year }}</div>

  {% for section_key in design.section_order %}
    {% if section_key == 'employee_info' and design.employee_info.visible %}
      <table class="info">
      {% for row in employee_rows %}
        <tr>
          {% for cell in row %}
            <td class="label">{{ cell.label }}</td><td class="value">{{ cell.value }}</td>
          {% endfor %}
          {% if row|length == 1 %}<td class="label"></td><td class="value"></td>{% endif %}
        </tr>
      {% endfor %}
      </table>
      <div class="spacer"></div>
    {% elif section_key == 'earnings_deductions' and design.earnings_deductions.visible %}
      <table class="earnings">
        <thead><tr><th>{{ design.earnings_deductions.earnings_title }}</th><th class="amount">{{ design.earnings_deductions.gross_title }}</th><th>{{ design.earnings_deductions.deductions_title }}</th><th class="amount">{{ design.earnings_deductions.amount_title }}</th></tr></thead>
        <tbody>
        {% for index in range(max_component_rows) %}
          <tr>
            <td>{{ earning_rows[index].label if index < earning_rows|length else '' }}</td>
            <td class="amount">{{ money(earning_rows[index].amount) if index < earning_rows|length else '' }}</td>
            <td>{{ deduction_rows[index].label if index < deduction_rows|length else '' }}</td>
            <td class="amount">{{ money(deduction_rows[index].amount) if index < deduction_rows|length else '' }}</td>
          </tr>
        {% endfor %}
        </tbody>
        <tfoot>
          <tr class="summary"><td>{{ design.earnings_deductions.cost_to_company_label }}</td><td class="amount">{{ plain(totals.cost_to_company) }}</td><td>{{ design.earnings_deductions.total_deductions_label }}</td><td class="amount">{{ plain(totals.total_deductions) }}</td></tr>
          <tr><td colspan="2"></td><td class="net">{{ design.earnings_deductions.net_amount_label }}</td><td class="net">{{ plain(net_amount) }}</td></tr>
        </tfoot>
      </table>
      <div class="spacer"></div>
    {% elif section_key == 'advances' and design.advances.visible %}
      <table class="advance">
        <tr><th class="section-head" colspan="7">{{ design.advances.title }}</th></tr>
        <tr><th>Advance Type</th><th>Date</th><th>Balance Advance Amount</th><th>Deduction Amount</th><th>Bills Received</th><th>Pending / Balance</th><th>Remarks</th></tr>
        {% for row in advance_rows %}
        <tr><td>{{ row.label }}</td><td>{{ row.date }}</td><td class="right">{{ plain(row.balance) if row.balance != '' else '' }}</td><td class="right">{{ plain(row.deduction) }}</td><td class="center">{{ row.bills_received }}</td><td class="right">{{ plain(row.pending) if row.pending != '' else '' }}</td><td></td></tr>
        {% endfor %}
        <tr><td colspan="3"><strong>Total Advance Amount</strong></td><td class="right"><strong>{{ plain(totals.advances) }}</strong></td><td colspan="3"></td></tr>
      </table>
      <div class="spacer"></div>
    {% elif section_key == 'transfer' and design.transfer.visible %}
      <table class="transfer">
        <tr><td><strong>Total Amount Transferred</strong></td><td><strong>{{ money(net_amount) }}</strong></td></tr>
        {% if design.transfer.show_amount_words %}<tr><td><strong>Amount (in words)</strong></td><td>{{ amount_words }}</td></tr>{% endif %}
        {% if design.transfer.show_transfer_date %}<tr><td><strong>Transfer Date</strong></td><td>{{ transfer.transfer_date or '—' }}{% if design.transfer.show_transfer_mode and transfer.transfer_mode %}&nbsp;&nbsp;&nbsp;{{ transfer.transfer_mode }}{% endif %}</td></tr>{% endif %}
      </table>
      <div class="spacer"></div>
    {% elif section_key == 'footer' and design.footer.visible %}
      <div class="footer-note">{{ design.footer.text }}</div>
      {% if design.footer.show_authorized_signatory %}<div class="signatory">{{ design.footer.authorized_signatory_label }}</div>{% endif %}
    {% endif %}
  {% endfor %}
</div>
</body>
</html>
"""


def render_payslip_html(context: Mapping[str, Any], design: Mapping[str, Any] | None = None) -> str:
    normalized_design = normalize_payslip_design(design)
    render_context = deepcopy(dict(context))
    render_context["design"] = normalized_design
    render_context["employee_rows"] = _display_employee_rows(render_context, normalized_design)

    component_settings = normalized_design.get("earnings_deductions") or {}
    show_zero = bool(component_settings.get("show_zero_values", True))
    earnings_source = render_context.get("all_earning_rows") or render_context.get("earning_rows") or []
    deductions_source = render_context.get("all_deduction_rows") or render_context.get("deduction_rows") or []
    earnings_rows = _normalize_component_rows(earnings_source, show_zero=show_zero)
    deduction_rows = _normalize_component_rows(deductions_source, show_zero=show_zero)

    if not component_settings.get("show_employer_contributions", True):
        employer_codes = {"pf_employer", "esi_employer", "employer_pf", "employer_esi"}
        earnings_rows = [
            row for row in earnings_rows
            if safe_str(row.get("code")).lower() not in employer_codes
            and "employer" not in safe_str(row.get("label")).lower()
        ]

    render_context["earning_rows"] = earnings_rows
    render_context["deduction_rows"] = deduction_rows
    render_context["max_component_rows"] = max(len(earnings_rows), len(deduction_rows), 1)

    environment = Environment(autoescape=True)
    environment.globals["money"] = _money
    environment.globals["plain"] = _plain
    return environment.from_string(PAYSLIP_DESIGNER_HTML_TEMPLATE).render(**render_context)


__all__ = [
    "PayrollBrandingError",
    "PROFILE_COLLECTION",
    "TENANT_PROFILE_KEY",
    "DESIGN_SCHEMA_VERSION",
    "MAX_PAYROLL_LOGO_BYTES",
    "activate_payslip_design",
    "build_payroll_branding_snapshot",
    "build_preview_context",
    "clear_payroll_logo",
    "default_payslip_design",
    "designer_catalog",
    "ensure_payroll_branding_indexes",
    "get_payroll_branding_profile",
    "list_organisation_identities",
    "list_payroll_branding_profiles",
    "normalize_payslip_design",
    "remove_managed_payroll_logo",
    "render_payslip_html",
    "reset_payslip_design_draft",
    "resolve_organisation_identity",
    "resolve_snapshot_for_employee",
    "safe_str",
    "save_payroll_logo_file",
    "save_payslip_design_draft",
    "set_payroll_logo",
]
