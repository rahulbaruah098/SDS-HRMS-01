from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timezone

UTC = timezone.utc  # Python 3.10 compatible replacement for datetime.UTC
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping, Sequence

from bson import ObjectId
from pymongo import ReturnDocument


TAX_DECLARATIONS_COLLECTION = "payroll_tax_declarations"
TAX_INSTRUCTIONS_COLLECTION = "payroll_tax_instructions"

TAX_REGIMES = {
    "old",
    "new",
    "not_selected",
}

TAX_DECLARATION_STATUSES = {
    "draft",
    "submitted",
    "pending_hr_review",
    "pending_finance_approval",
    "approved",
    "rejected",
    "cancelled",
    "locked",
}

TAX_PROOF_STATUSES = {
    "not_required",
    "pending",
    "accepted",
    "rejected",
}

TDS_MODES = {
    "disabled",
    "manual",
    "external",
}

TDS_INSTRUCTION_STATUSES = {
    "draft",
    "active",
    "inactive",
    "superseded",
}

TAX_DECLARATION_COMPONENTS = {
    "section_80c": {
        "label": "Section 80C",
        "proof_required": True,
    },
    "section_80ccd_1b": {
        "label": "Section 80CCD(1B)",
        "proof_required": True,
    },
    "section_80d": {
        "label": "Section 80D",
        "proof_required": True,
    },
    "hra_exemption": {
        "label": "HRA Exemption",
        "proof_required": True,
    },
    "home_loan_interest": {
        "label": "Home Loan Interest",
        "proof_required": True,
    },
    "education_loan_interest": {
        "label": "Education Loan Interest",
        "proof_required": True,
    },
    "donations": {
        "label": "Eligible Donations",
        "proof_required": True,
    },
    "other_deductions": {
        "label": "Other Deductions",
        "proof_required": True,
    },
    "other_income": {
        "label": "Other Income",
        "proof_required": False,
    },
    "previous_employer_income": {
        "label": "Previous Employer Income",
        "proof_required": True,
    },
    "previous_employer_tds": {
        "label": "Previous Employer TDS",
        "proof_required": True,
    },
}

FINAL_DECLARATION_STATUSES = {
    "approved",
    "locked",
    "cancelled",
}

EDITABLE_DECLARATION_STATUSES = {
    "draft",
    "rejected",
}

REVIEWABLE_DECLARATION_STATUSES = {
    "submitted",
    "pending_hr_review",
    "pending_finance_approval",
}

MONEY_QUANTUM = Decimal("0.01")
ZERO = Decimal("0")
FINANCIAL_YEAR_PATTERN = re.compile(r"^(20|21|22)\d{2}-(20|21|22)\d{2}$")
PERIOD_PATTERN = re.compile(r"^(20|21|22)\d{2}-(0[1-9]|1[0-2])$")


class PayrollTaxError(ValueError):
    """Business-rule error for payroll tax declarations and TDS instructions."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str = "payroll_tax_error",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details or {}


def safe_str(value: Any) -> str:
    return str(value or "").strip()


def normalize_key(value: Any) -> str:
    return safe_str(value).lower().replace("-", "_").replace(" ", "_")


def now_utc() -> datetime:
    return datetime.now(UTC)


def object_id(value: Any) -> ObjectId | None:
    try:
        return ObjectId(safe_str(value))
    except Exception:
        return None


def money_decimal(
    value: Any,
    *,
    field_name: str,
    required: bool = False,
    minimum: Decimal | None = ZERO,
) -> Decimal:
    if value in (None, ""):
        if required:
            raise PayrollTaxError(
                f"{field_name} is required.",
                code="payroll_tax_field_required",
                details={"field": field_name},
            )
        return ZERO

    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise PayrollTaxError(
            f"{field_name} must be a valid number.",
            code="invalid_payroll_tax_amount",
            details={"field": field_name},
        ) from exc

    if not amount.is_finite():
        raise PayrollTaxError(
            f"{field_name} must be a finite number.",
            code="invalid_payroll_tax_amount",
            details={"field": field_name},
        )

    if minimum is not None and amount < minimum:
        raise PayrollTaxError(
            f"{field_name} must be at least {minimum}.",
            code="invalid_payroll_tax_amount",
            details={
                "field": field_name,
                "minimum": float(minimum),
            },
        )

    return amount.quantize(MONEY_QUANTUM)


def money_value(value: Any) -> int | float:
    amount = money_decimal(
        value,
        field_name="amount",
        minimum=None,
    )

    if amount == amount.to_integral_value():
        return int(amount)

    return float(amount)


def normalize_financial_year(value: Any) -> str:
    text = safe_str(value).replace("/", "-")

    if not FINANCIAL_YEAR_PATTERN.fullmatch(text):
        raise PayrollTaxError(
            "financial_year must use YYYY-YYYY format.",
            code="invalid_financial_year",
            details={"financial_year": text},
        )

    start_year, end_year = (int(part) for part in text.split("-"))

    if end_year != start_year + 1:
        raise PayrollTaxError(
            "financial_year must contain consecutive years.",
            code="invalid_financial_year",
            details={"financial_year": text},
        )

    return f"{start_year:04d}-{end_year:04d}"


def financial_year_for_period(period_key: Any) -> str:
    period = safe_str(period_key)

    if not PERIOD_PATTERN.fullmatch(period):
        raise PayrollTaxError(
            "period_key must use YYYY-MM format.",
            code="invalid_payroll_period",
            details={"period_key": period},
        )

    year, month = (int(part) for part in period.split("-"))

    if month >= 4:
        return f"{year:04d}-{year + 1:04d}"

    return f"{year - 1:04d}-{year:04d}"


def normalize_tax_regime(value: Any) -> str:
    regime = normalize_key(value or "not_selected")
    aliases = {
        "old_regime": "old",
        "new_regime": "new",
        "none": "not_selected",
        "unselected": "not_selected",
    }
    regime = aliases.get(regime, regime)

    if regime not in TAX_REGIMES:
        raise PayrollTaxError(
            "Unsupported tax regime.",
            code="invalid_tax_regime",
            details={
                "regime": regime,
                "allowed_regimes": sorted(TAX_REGIMES),
            },
        )

    return regime


def normalize_tds_mode(value: Any) -> str:
    mode = normalize_key(value or "disabled")
    aliases = {
        "off": "disabled",
        "none": "disabled",
        "manual_entry": "manual",
        "external_engine": "external",
        "external_provider": "external",
    }
    mode = aliases.get(mode, mode)

    if mode not in TDS_MODES:
        raise PayrollTaxError(
            "Unsupported TDS mode.",
            code="invalid_tds_mode",
            details={
                "mode": mode,
                "allowed_modes": sorted(TDS_MODES),
            },
        )

    return mode


def parse_date(
    value: Any,
    *,
    field_name: str,
    required: bool = False,
) -> date | None:
    if value in (None, ""):
        if required:
            raise PayrollTaxError(
                f"{field_name} is required.",
                code="payroll_tax_date_required",
                details={"field": field_name},
            )
        return None

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    try:
        return date.fromisoformat(safe_str(value)[:10])
    except ValueError as exc:
        raise PayrollTaxError(
            f"{field_name} must use YYYY-MM-DD format.",
            code="invalid_payroll_tax_date",
            details={"field": field_name},
        ) from exc


def employee_name(employee: Mapping[str, Any]) -> str:
    return safe_str(
        employee.get("employee_name")
        or employee.get("name")
        or employee.get("full_name")
        or employee.get("display_name")
        or employee.get("official_email")
        or employee.get("email")
        or "Employee"
    )


def employee_code(employee: Mapping[str, Any]) -> str:
    return safe_str(
        employee.get("employee_code")
        or employee.get("emp_code")
        or employee.get("employee_id")
        or employee.get("code")
    )


def canonical_employee_id(employee: Mapping[str, Any]) -> str:
    return safe_str(employee.get("_id"))


def find_employee(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
) -> dict[str, Any] | None:
    reference = safe_str(employee_reference)

    if not reference:
        return None

    alternatives: list[dict[str, Any]] = [
        {"employee_id": reference},
        {"employee_code": reference},
        {"emp_code": reference},
        {"code": reference},
        {"user_id": reference},
        {"official_email": reference.lower()},
        {"email": reference.lower()},
    ]
    parsed_id = object_id(reference)

    if parsed_id:
        alternatives.insert(0, {"_id": parsed_id})

    return db.employees.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": alternatives,
    })


def _normalize_proof(
    proof: Mapping[str, Any],
    *,
    index: int,
) -> dict[str, Any]:
    if not isinstance(proof, Mapping):
        raise PayrollTaxError(
            f"proofs[{index}] must be an object.",
            code="invalid_tax_proof",
            details={"index": index},
        )

    reference = safe_str(
        proof.get("reference")
        or proof.get("attachment_id")
        or proof.get("attachmentId")
        or proof.get("url")
        or proof.get("path")
    )
    filename = safe_str(
        proof.get("filename")
        or proof.get("file_name")
        or proof.get("fileName")
    )
    document_type = normalize_key(
        proof.get("document_type")
        or proof.get("documentType")
        or "supporting_document"
    )
    status = normalize_key(
        proof.get("status")
        or "pending"
    )

    if not reference:
        raise PayrollTaxError(
            f"proofs[{index}].reference is required.",
            code="tax_proof_reference_required",
            details={"index": index},
        )

    if status not in TAX_PROOF_STATUSES:
        raise PayrollTaxError(
            f"proofs[{index}].status is invalid.",
            code="invalid_tax_proof_status",
            details={
                "index": index,
                "status": status,
                "allowed_statuses": sorted(TAX_PROOF_STATUSES),
            },
        )

    return {
        "proof_id": safe_str(proof.get("proof_id")) or str(ObjectId()),
        "reference": reference,
        "filename": filename,
        "document_type": document_type,
        "status": status,
        "note": safe_str(proof.get("note"))[:1000],
        "uploaded_at": proof.get("uploaded_at") or now_utc(),
        "uploaded_by": safe_str(proof.get("uploaded_by")),
    }


def _normalize_component(
    component: Mapping[str, Any],
    *,
    index: int,
) -> dict[str, Any]:
    if not isinstance(component, Mapping):
        raise PayrollTaxError(
            f"components[{index}] must be an object.",
            code="invalid_tax_declaration_component",
            details={"index": index},
        )

    component_type = normalize_key(
        component.get("type")
        or component.get("component_type")
        or component.get("componentType")
    )

    if component_type not in TAX_DECLARATION_COMPONENTS:
        raise PayrollTaxError(
            f"components[{index}].type is unsupported.",
            code="invalid_tax_declaration_component_type",
            details={
                "index": index,
                "type": component_type,
                "allowed_types": sorted(TAX_DECLARATION_COMPONENTS),
            },
        )

    declared_amount = money_decimal(
        component.get("declared_amount", component.get("declaredAmount")),
        field_name=f"components[{index}].declared_amount",
        minimum=ZERO,
    )
    approved_amount = money_decimal(
        component.get("approved_amount", component.get("approvedAmount")),
        field_name=f"components[{index}].approved_amount",
        minimum=ZERO,
    )

    if approved_amount > declared_amount:
        raise PayrollTaxError(
            f"components[{index}].approved_amount cannot exceed declared_amount.",
            code="approved_tax_amount_exceeds_declared_amount",
            details={
                "index": index,
                "declared_amount": money_value(declared_amount),
                "approved_amount": money_value(approved_amount),
            },
        )

    proofs = [
        _normalize_proof(proof, index=proof_index)
        for proof_index, proof in enumerate(component.get("proofs") or [])
    ]
    default_proof_required = TAX_DECLARATION_COMPONENTS[
        component_type
    ]["proof_required"]
    proof_required = bool(
        component.get(
            "proof_required",
            component.get("proofRequired", default_proof_required),
        )
    )
    proof_status = normalize_key(
        component.get("proof_status")
        or component.get("proofStatus")
        or (
            "not_required"
            if not proof_required
            else "pending"
        )
    )

    if proof_status not in TAX_PROOF_STATUSES:
        raise PayrollTaxError(
            f"components[{index}].proof_status is invalid.",
            code="invalid_tax_proof_status",
            details={
                "index": index,
                "status": proof_status,
                "allowed_statuses": sorted(TAX_PROOF_STATUSES),
            },
        )

    return {
        "component_id": safe_str(component.get("component_id")) or str(ObjectId()),
        "type": component_type,
        "label": safe_str(
            component.get("label")
            or TAX_DECLARATION_COMPONENTS[component_type]["label"]
        ),
        "description": safe_str(component.get("description"))[:2000],
        "declared_amount": money_value(declared_amount),
        "approved_amount": money_value(approved_amount),
        "proof_required": proof_required,
        "proof_status": proof_status,
        "proofs": proofs,
        "review_note": safe_str(
            component.get("review_note")
            or component.get("reviewNote")
        )[:1000],
    }


def normalize_declaration_payload(
    payload: Mapping[str, Any],
    *,
    financial_year: str,
    existing: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise PayrollTaxError(
            "Tax declaration payload must be an object.",
            code="invalid_tax_declaration_payload",
        )

    existing = existing or {}
    regime = normalize_tax_regime(
        payload.get(
            "tax_regime",
            payload.get(
                "taxRegime",
                existing.get("tax_regime") or "not_selected",
            ),
        )
    )
    components_payload = payload.get(
        "components",
        existing.get("components") or [],
    )

    if not isinstance(components_payload, list):
        raise PayrollTaxError(
            "components must be an array.",
            code="invalid_tax_declaration_components",
        )

    components = [
        _normalize_component(component, index=index)
        for index, component in enumerate(components_payload)
    ]
    duplicate_types = {
        component["type"]
        for component in components
        if sum(
            1
            for item in components
            if item["type"] == component["type"]
        ) > 1
    }

    if duplicate_types:
        raise PayrollTaxError(
            "Each declaration component type may appear only once.",
            code="duplicate_tax_declaration_component",
            details={"types": sorted(duplicate_types)},
        )

    declared_total = sum(
        money_decimal(
            component["declared_amount"],
            field_name="declared_amount",
        )
        for component in components
    )
    approved_total = sum(
        money_decimal(
            component["approved_amount"],
            field_name="approved_amount",
        )
        for component in components
    )

    return {
        "financial_year": normalize_financial_year(financial_year),
        "tax_regime": regime,
        "components": components,
        "declared_total": money_value(declared_total),
        "approved_total": money_value(approved_total),
        "employee_note": safe_str(
            payload.get(
                "employee_note",
                payload.get(
                    "employeeNote",
                    existing.get("employee_note"),
                ),
            )
        )[:2000],
        "consent_confirmed": bool(
            payload.get(
                "consent_confirmed",
                payload.get(
                    "consentConfirmed",
                    existing.get("consent_confirmed", False),
                ),
            )
        ),
    }


def _workflow_entry(
    *,
    action: str,
    from_status: str,
    to_status: str,
    actor_id: str,
    actor_name: str,
    note: str = "",
) -> dict[str, Any]:
    return {
        "action": normalize_key(action),
        "from_status": normalize_key(from_status),
        "to_status": normalize_key(to_status),
        "actor_id": safe_str(actor_id),
        "actor_name": safe_str(actor_name),
        "note": safe_str(note)[:1000],
        "at": now_utc(),
    }


def get_tax_declaration(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    financial_year: Any,
    include_cancelled: bool = False,
) -> dict[str, Any]:
    employee = find_employee(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
    )

    if not employee:
        raise PayrollTaxError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    query: dict[str, Any] = {
        "tenant_id": tenant_id,
        "employee_id": canonical_employee_id(employee),
        "financial_year": normalize_financial_year(financial_year),
        "is_deleted": {"$ne": True},
    }

    if not include_cancelled:
        query["status"] = {"$ne": "cancelled"}

    declaration = db[TAX_DECLARATIONS_COLLECTION].find_one(query)

    if not declaration:
        raise PayrollTaxError(
            "Tax declaration was not found.",
            status_code=404,
            code="tax_declaration_not_found",
            details={
                "employee_id": canonical_employee_id(employee),
                "financial_year": query["financial_year"],
            },
        )

    return declaration


def upsert_tax_declaration(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    financial_year: Any,
    payload: Mapping[str, Any],
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    employee = find_employee(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
    )

    if not employee:
        raise PayrollTaxError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    employee_id = canonical_employee_id(employee)
    normalized_year = normalize_financial_year(financial_year)
    existing = db[TAX_DECLARATIONS_COLLECTION].find_one({
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "financial_year": normalized_year,
        "status": {"$ne": "cancelled"},
        "is_deleted": {"$ne": True},
    })
    existing_status = normalize_key(
        (existing or {}).get("status") or "draft"
    )

    if existing and existing_status not in EDITABLE_DECLARATION_STATUSES:
        raise PayrollTaxError(
            "Only draft or rejected declarations can be edited.",
            status_code=409,
            code="tax_declaration_not_editable",
            details={"status": existing_status},
        )

    normalized = normalize_declaration_payload(
        payload,
        financial_year=normalized_year,
        existing=existing,
    )
    now = now_utc()

    if not existing:
        declaration = {
            "_id": ObjectId(),
            "tenant_id": tenant_id,
            "employee_id": employee_id,
            "employee_code": employee_code(employee),
            "employee_name": employee_name(employee),
            "user_id": safe_str(employee.get("user_id")),
            **normalized,
            "status": "draft",
            "revision_number": 1,
            "workflow_history": [],
            "created_at": now,
            "created_by": safe_str(actor_id),
            "created_by_name": safe_str(actor_name),
            "updated_at": now,
            "updated_by": safe_str(actor_id),
            "updated_by_name": safe_str(actor_name),
            "is_deleted": False,
        }
        db[TAX_DECLARATIONS_COLLECTION].insert_one(declaration)
        return declaration

    previous_snapshot = {
        "revision_number": int(existing.get("revision_number") or 1),
        "tax_regime": safe_str(existing.get("tax_regime")),
        "components": list(existing.get("components") or []),
        "declared_total": existing.get("declared_total", 0),
        "approved_total": existing.get("approved_total", 0),
        "employee_note": safe_str(existing.get("employee_note")),
        "consent_confirmed": bool(existing.get("consent_confirmed")),
        "status": existing_status,
        "updated_at": existing.get("updated_at"),
        "updated_by": safe_str(existing.get("updated_by")),
        "updated_by_name": safe_str(existing.get("updated_by_name")),
        "superseded_at": now,
        "superseded_by": safe_str(actor_id),
        "superseded_by_name": safe_str(actor_name),
    }
    next_revision = int(existing.get("revision_number") or 1) + 1
    result = db[TAX_DECLARATIONS_COLLECTION].find_one_and_update(
        {
            "_id": existing["_id"],
            "tenant_id": tenant_id,
            "revision_number": existing.get("revision_number", 1),
            "status": {"$in": sorted(EDITABLE_DECLARATION_STATUSES)},
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                **normalized,
                "employee_code": employee_code(employee),
                "employee_name": employee_name(employee),
                "user_id": safe_str(employee.get("user_id")),
                "status": "draft",
                "revision_number": next_revision,
                "rejection_reason": "",
                "rejected_at": None,
                "rejected_by": "",
                "rejected_by_name": "",
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "revisions": previous_snapshot,
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollTaxError(
            "The tax declaration changed while the update was being applied.",
            status_code=409,
            code="tax_declaration_concurrent_update",
        )

    return result


def submit_tax_declaration(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    financial_year: Any,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
) -> dict[str, Any]:
    declaration = get_tax_declaration(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        financial_year=financial_year,
    )
    status = normalize_key(declaration.get("status"))

    if status not in EDITABLE_DECLARATION_STATUSES:
        raise PayrollTaxError(
            "Only a draft or rejected declaration can be submitted.",
            status_code=409,
            code="tax_declaration_not_submittable",
            details={"status": status},
        )

    if not declaration.get("consent_confirmed"):
        raise PayrollTaxError(
            "Employee declaration consent must be confirmed before submission.",
            code="tax_declaration_consent_required",
        )

    if normalize_tax_regime(declaration.get("tax_regime")) == "not_selected":
        raise PayrollTaxError(
            "Select a tax regime before submitting the declaration.",
            code="tax_regime_required",
        )

    components = list(declaration.get("components") or [])
    proof_failures: list[dict[str, Any]] = []

    for component in components:
        if (
            component.get("proof_required")
            and money_decimal(
                component.get("declared_amount"),
                field_name="declared_amount",
            ) > ZERO
            and not (component.get("proofs") or [])
        ):
            proof_failures.append({
                "component_id": safe_str(component.get("component_id")),
                "type": safe_str(component.get("type")),
                "message": "At least one proof is required.",
            })

    if proof_failures:
        raise PayrollTaxError(
            "One or more declaration components require supporting proof.",
            code="tax_declaration_proofs_required",
            details={"components": proof_failures},
        )

    now = now_utc()
    to_status = "pending_hr_review"
    result = db[TAX_DECLARATIONS_COLLECTION].find_one_and_update(
        {
            "_id": declaration["_id"],
            "tenant_id": tenant_id,
            "status": {"$in": sorted(EDITABLE_DECLARATION_STATUSES)},
            "revision_number": declaration.get("revision_number", 1),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": to_status,
                "submitted_at": now,
                "submitted_by": safe_str(actor_id),
                "submitted_by_name": safe_str(actor_name),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _workflow_entry(
                    action="submit",
                    from_status=status,
                    to_status=to_status,
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note,
                ),
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollTaxError(
            "The declaration changed before submission completed.",
            status_code=409,
            code="tax_declaration_concurrent_update",
        )

    return result


def _review_components(
    declaration: Mapping[str, Any],
    reviews: Sequence[Mapping[str, Any]] | None,
) -> tuple[list[dict[str, Any]], Decimal]:
    reviews_by_id: dict[str, Mapping[str, Any]] = {}
    reviews_by_type: dict[str, Mapping[str, Any]] = {}

    for review in reviews or []:
        component_id = safe_str(review.get("component_id"))
        component_type = normalize_key(review.get("type"))

        if component_id:
            reviews_by_id[component_id] = review

        if component_type:
            reviews_by_type[component_type] = review

    updated_components: list[dict[str, Any]] = []
    approved_total = ZERO

    for component in declaration.get("components") or []:
        component_id = safe_str(component.get("component_id"))
        component_type = normalize_key(component.get("type"))
        review = (
            reviews_by_id.get(component_id)
            or reviews_by_type.get(component_type)
            or {}
        )
        declared_amount = money_decimal(
            component.get("declared_amount"),
            field_name="declared_amount",
        )
        approved_amount = money_decimal(
            review.get(
                "approved_amount",
                review.get(
                    "approvedAmount",
                    component.get("approved_amount"),
                ),
            ),
            field_name=f"{component_type}.approved_amount",
            minimum=ZERO,
        )

        if approved_amount > declared_amount:
            raise PayrollTaxError(
                f"Approved amount for {component_type} cannot exceed declared amount.",
                code="approved_tax_amount_exceeds_declared_amount",
                details={
                    "component_id": component_id,
                    "type": component_type,
                    "declared_amount": money_value(declared_amount),
                    "approved_amount": money_value(approved_amount),
                },
            )

        proof_status = normalize_key(
            review.get(
                "proof_status",
                review.get(
                    "proofStatus",
                    component.get("proof_status"),
                ),
            )
        )

        if proof_status not in TAX_PROOF_STATUSES:
            raise PayrollTaxError(
                f"Invalid proof status for {component_type}.",
                code="invalid_tax_proof_status",
                details={
                    "component_id": component_id,
                    "type": component_type,
                    "status": proof_status,
                },
            )

        if (
            component.get("proof_required")
            and approved_amount > ZERO
            and proof_status != "accepted"
        ):
            raise PayrollTaxError(
                f"Proof must be accepted before approving {component_type}.",
                code="tax_proof_not_accepted",
                details={
                    "component_id": component_id,
                    "type": component_type,
                    "proof_status": proof_status,
                },
            )

        updated_component = {
            **component,
            "approved_amount": money_value(approved_amount),
            "proof_status": proof_status,
            "review_note": safe_str(
                review.get(
                    "review_note",
                    review.get(
                        "reviewNote",
                        component.get("review_note"),
                    ),
                )
            )[:1000],
        }
        updated_components.append(updated_component)
        approved_total += approved_amount

    return updated_components, approved_total.quantize(MONEY_QUANTUM)


def complete_tax_hr_review(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    financial_year: Any,
    component_reviews: Sequence[Mapping[str, Any]] | None = None,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
) -> dict[str, Any]:
    declaration = get_tax_declaration(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        financial_year=financial_year,
    )
    status = normalize_key(declaration.get("status"))

    if status != "pending_hr_review":
        raise PayrollTaxError(
            "Only declarations pending HR review can be reviewed.",
            status_code=409,
            code="tax_declaration_not_pending_hr_review",
            details={"status": status},
        )

    reviewed_components, approved_total = _review_components(
        declaration,
        component_reviews,
    )
    now = now_utc()
    to_status = "pending_finance_approval"
    result = db[TAX_DECLARATIONS_COLLECTION].find_one_and_update(
        {
            "_id": declaration["_id"],
            "tenant_id": tenant_id,
            "status": "pending_hr_review",
            "revision_number": declaration.get("revision_number", 1),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "components": reviewed_components,
                "approved_total": money_value(approved_total),
                "status": to_status,
                "hr_reviewed_at": now,
                "hr_reviewed_by": safe_str(actor_id),
                "hr_reviewed_by_name": safe_str(actor_name),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _workflow_entry(
                    action="complete_hr_review",
                    from_status=status,
                    to_status=to_status,
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note,
                ),
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollTaxError(
            "The declaration changed before HR review completed.",
            status_code=409,
            code="tax_declaration_concurrent_update",
        )

    return result


def approve_tax_declaration(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    financial_year: Any,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
) -> dict[str, Any]:
    declaration = get_tax_declaration(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        financial_year=financial_year,
    )
    status = normalize_key(declaration.get("status"))

    if status != "pending_finance_approval":
        raise PayrollTaxError(
            "Only declarations pending Finance approval can be approved.",
            status_code=409,
            code="tax_declaration_not_pending_finance_approval",
            details={"status": status},
        )

    now = now_utc()
    to_status = "approved"
    result = db[TAX_DECLARATIONS_COLLECTION].find_one_and_update(
        {
            "_id": declaration["_id"],
            "tenant_id": tenant_id,
            "status": "pending_finance_approval",
            "revision_number": declaration.get("revision_number", 1),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": to_status,
                "approved_at": now,
                "approved_by": safe_str(actor_id),
                "approved_by_name": safe_str(actor_name),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _workflow_entry(
                    action="approve",
                    from_status=status,
                    to_status=to_status,
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note,
                ),
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollTaxError(
            "The declaration changed before Finance approval completed.",
            status_code=409,
            code="tax_declaration_concurrent_update",
        )

    return result


def reject_tax_declaration(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    financial_year: Any,
    reason: str,
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    reason = safe_str(reason)

    if not reason:
        raise PayrollTaxError(
            "A rejection reason is required.",
            code="tax_declaration_rejection_reason_required",
        )

    declaration = get_tax_declaration(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        financial_year=financial_year,
    )
    status = normalize_key(declaration.get("status"))

    if status not in REVIEWABLE_DECLARATION_STATUSES:
        raise PayrollTaxError(
            "Only a submitted or pending-review declaration can be rejected.",
            status_code=409,
            code="tax_declaration_not_rejectable",
            details={"status": status},
        )

    now = now_utc()
    to_status = "rejected"
    result = db[TAX_DECLARATIONS_COLLECTION].find_one_and_update(
        {
            "_id": declaration["_id"],
            "tenant_id": tenant_id,
            "status": {"$in": sorted(REVIEWABLE_DECLARATION_STATUSES)},
            "revision_number": declaration.get("revision_number", 1),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": to_status,
                "rejection_reason": reason,
                "rejected_at": now,
                "rejected_by": safe_str(actor_id),
                "rejected_by_name": safe_str(actor_name),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _workflow_entry(
                    action="reject",
                    from_status=status,
                    to_status=to_status,
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=reason,
                ),
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollTaxError(
            "The declaration changed before rejection completed.",
            status_code=409,
            code="tax_declaration_concurrent_update",
        )

    return result


def cancel_tax_declaration(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    financial_year: Any,
    reason: str,
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    reason = safe_str(reason)

    if not reason:
        raise PayrollTaxError(
            "A cancellation reason is required.",
            code="tax_declaration_cancellation_reason_required",
        )

    declaration = get_tax_declaration(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        financial_year=financial_year,
    )
    status = normalize_key(declaration.get("status"))

    if status in {"approved", "locked", "cancelled"}:
        raise PayrollTaxError(
            "Approved, locked or already-cancelled declarations cannot be cancelled.",
            status_code=409,
            code="tax_declaration_not_cancellable",
            details={"status": status},
        )

    now = now_utc()
    result = db[TAX_DECLARATIONS_COLLECTION].find_one_and_update(
        {
            "_id": declaration["_id"],
            "tenant_id": tenant_id,
            "status": {"$nin": ["approved", "locked", "cancelled"]},
            "revision_number": declaration.get("revision_number", 1),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "cancelled",
                "cancelled_at": now,
                "cancelled_by": safe_str(actor_id),
                "cancelled_by_name": safe_str(actor_name),
                "cancellation_reason": reason,
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _workflow_entry(
                    action="cancel",
                    from_status=status,
                    to_status="cancelled",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=reason,
                ),
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollTaxError(
            "The declaration changed before cancellation completed.",
            status_code=409,
            code="tax_declaration_concurrent_update",
        )

    return result


def lock_tax_declaration(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    financial_year: Any,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
) -> dict[str, Any]:
    declaration = get_tax_declaration(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        financial_year=financial_year,
    )
    status = normalize_key(declaration.get("status"))

    if status == "locked":
        return declaration

    if status != "approved":
        raise PayrollTaxError(
            "Only an approved tax declaration can be locked.",
            status_code=409,
            code="tax_declaration_not_lockable",
            details={"status": status},
        )

    now = now_utc()
    result = db[TAX_DECLARATIONS_COLLECTION].find_one_and_update(
        {
            "_id": declaration["_id"],
            "tenant_id": tenant_id,
            "status": "approved",
            "revision_number": declaration.get("revision_number", 1),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "locked",
                "locked_at": now,
                "locked_by": safe_str(actor_id),
                "locked_by_name": safe_str(actor_name),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _workflow_entry(
                    action="lock",
                    from_status=status,
                    to_status="locked",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note,
                ),
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollTaxError(
            "The declaration changed before locking completed.",
            status_code=409,
            code="tax_declaration_concurrent_update",
        )

    return result


def list_tax_declarations(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any = "",
    financial_years: Iterable[Any] | None = None,
    statuses: Iterable[Any] | None = None,
    tax_regimes: Iterable[Any] | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }

    if employee_reference not in (None, ""):
        employee = find_employee(
            db,
            tenant_id=tenant_id,
            employee_reference=employee_reference,
        )

        if not employee:
            raise PayrollTaxError(
                "Employee was not found in the selected company.",
                status_code=404,
                code="payroll_employee_not_found",
            )

        query["employee_id"] = canonical_employee_id(employee)

    normalized_years = {
        normalize_financial_year(item)
        for item in (financial_years or [])
        if safe_str(item)
    }

    if normalized_years:
        query["financial_year"] = {"$in": sorted(normalized_years)}

    normalized_statuses = {
        normalize_key(item)
        for item in (statuses or [])
        if safe_str(item)
    }

    if normalized_statuses:
        invalid = normalized_statuses - TAX_DECLARATION_STATUSES

        if invalid:
            raise PayrollTaxError(
                "One or more tax declaration statuses are invalid.",
                code="invalid_tax_declaration_status",
                details={"statuses": sorted(invalid)},
            )

        query["status"] = {"$in": sorted(normalized_statuses)}

    normalized_regimes = {
        normalize_tax_regime(item)
        for item in (tax_regimes or [])
        if safe_str(item)
    }

    if normalized_regimes:
        query["tax_regime"] = {"$in": sorted(normalized_regimes)}

    safe_limit = max(1, min(int(limit or 500), 2000))

    return list(
        db[TAX_DECLARATIONS_COLLECTION]
        .find(query)
        .sort([
            ("financial_year", -1),
            ("employee_name", 1),
            ("employee_code", 1),
        ])
        .limit(safe_limit)
    )


def _instruction_fingerprint(
    *,
    tenant_id: str,
    employee_id: str,
    financial_year: str,
    effective_from_period: str,
    mode: str,
    monthly_tds_amount: Any,
    external_reference: str,
) -> str:
    payload = "|".join([
        safe_str(tenant_id),
        safe_str(employee_id),
        safe_str(financial_year),
        safe_str(effective_from_period),
        safe_str(mode),
        str(money_decimal(
            monthly_tds_amount,
            field_name="monthly_tds_amount",
            minimum=ZERO,
        )),
        safe_str(external_reference),
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def create_tds_instruction(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    financial_year: Any,
    effective_from_period: Any,
    mode: Any,
    monthly_tds_amount: Any = 0,
    external_reference: str = "",
    source_system: str = "",
    note: str = "",
    actor_id: str = "",
    actor_name: str = "",
    activate: bool = True,
) -> dict[str, Any]:
    employee = find_employee(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
    )

    if not employee:
        raise PayrollTaxError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    employee_id = canonical_employee_id(employee)
    normalized_year = normalize_financial_year(financial_year)
    period = safe_str(effective_from_period)

    if not PERIOD_PATTERN.fullmatch(period):
        raise PayrollTaxError(
            "effective_from_period must use YYYY-MM format.",
            code="invalid_payroll_period",
            details={"period_key": period},
        )

    if financial_year_for_period(period) != normalized_year:
        raise PayrollTaxError(
            "effective_from_period must fall inside the selected financial year.",
            code="tds_instruction_period_outside_financial_year",
            details={
                "effective_from_period": period,
                "financial_year": normalized_year,
            },
        )

    normalized_mode = normalize_tds_mode(mode)
    amount = money_decimal(
        monthly_tds_amount,
        field_name="monthly_tds_amount",
        minimum=ZERO,
    )
    external_reference = safe_str(external_reference)
    source_system = safe_str(source_system)

    if normalized_mode == "disabled" and amount != ZERO:
        raise PayrollTaxError(
            "monthly_tds_amount must be zero when TDS mode is disabled.",
            code="disabled_tds_amount_must_be_zero",
        )

    if normalized_mode == "manual" and amount < ZERO:
        raise PayrollTaxError(
            "Manual TDS amount cannot be negative.",
            code="invalid_manual_tds_amount",
        )

    if normalized_mode == "external":
        if not external_reference:
            raise PayrollTaxError(
                "external_reference is required for external TDS mode.",
                code="external_tds_reference_required",
            )

        if not source_system:
            raise PayrollTaxError(
                "source_system is required for external TDS mode.",
                code="external_tds_source_required",
            )

    fingerprint = _instruction_fingerprint(
        tenant_id=tenant_id,
        employee_id=employee_id,
        financial_year=normalized_year,
        effective_from_period=period,
        mode=normalized_mode,
        monthly_tds_amount=amount,
        external_reference=external_reference,
    )
    duplicate = db[TAX_INSTRUCTIONS_COLLECTION].find_one({
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "fingerprint": fingerprint,
        "status": {"$in": ["draft", "active"]},
        "is_deleted": {"$ne": True},
    })

    if duplicate:
        return duplicate

    now = now_utc()
    instruction = {
        "_id": ObjectId(),
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "employee_code": employee_code(employee),
        "employee_name": employee_name(employee),
        "financial_year": normalized_year,
        "effective_from_period": period,
        "mode": normalized_mode,
        "monthly_tds_amount": money_value(amount),
        "external_reference": external_reference,
        "source_system": source_system,
        "note": safe_str(note)[:2000],
        "status": "active" if activate else "draft",
        "fingerprint": fingerprint,
        "created_at": now,
        "created_by": safe_str(actor_id),
        "created_by_name": safe_str(actor_name),
        "activated_at": now if activate else None,
        "activated_by": safe_str(actor_id) if activate else "",
        "activated_by_name": safe_str(actor_name) if activate else "",
        "is_deleted": False,
    }

    if activate:
        db[TAX_INSTRUCTIONS_COLLECTION].update_many(
            {
                "tenant_id": tenant_id,
                "employee_id": employee_id,
                "financial_year": normalized_year,
                "status": "active",
                "is_deleted": {"$ne": True},
            },
            {
                "$set": {
                    "status": "superseded",
                    "superseded_at": now,
                    "superseded_by": safe_str(actor_id),
                    "superseded_by_name": safe_str(actor_name),
                }
            },
        )

    db[TAX_INSTRUCTIONS_COLLECTION].insert_one(instruction)
    return instruction


def activate_tds_instruction(
    db: Any,
    *,
    tenant_id: str,
    instruction_id: Any,
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    parsed_id = object_id(instruction_id)

    if not parsed_id:
        raise PayrollTaxError(
            "Invalid TDS instruction identifier.",
            status_code=404,
            code="tds_instruction_not_found",
        )

    instruction = db[TAX_INSTRUCTIONS_COLLECTION].find_one({
        "_id": parsed_id,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    })

    if not instruction:
        raise PayrollTaxError(
            "TDS instruction was not found.",
            status_code=404,
            code="tds_instruction_not_found",
        )

    status = normalize_key(instruction.get("status"))

    if status == "active":
        return instruction

    if status not in {"draft", "inactive"}:
        raise PayrollTaxError(
            "Only a draft or inactive TDS instruction can be activated.",
            status_code=409,
            code="tds_instruction_not_activatable",
            details={"status": status},
        )

    now = now_utc()
    db[TAX_INSTRUCTIONS_COLLECTION].update_many(
        {
            "tenant_id": tenant_id,
            "employee_id": instruction.get("employee_id"),
            "financial_year": instruction.get("financial_year"),
            "status": "active",
            "_id": {"$ne": parsed_id},
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "superseded",
                "superseded_at": now,
                "superseded_by": safe_str(actor_id),
                "superseded_by_name": safe_str(actor_name),
            }
        },
    )
    result = db[TAX_INSTRUCTIONS_COLLECTION].find_one_and_update(
        {
            "_id": parsed_id,
            "tenant_id": tenant_id,
            "status": {"$in": ["draft", "inactive"]},
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "active",
                "activated_at": now,
                "activated_by": safe_str(actor_id),
                "activated_by_name": safe_str(actor_name),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            }
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollTaxError(
            "The TDS instruction changed before activation completed.",
            status_code=409,
            code="tds_instruction_concurrent_update",
        )

    return result


def deactivate_tds_instruction(
    db: Any,
    *,
    tenant_id: str,
    instruction_id: Any,
    reason: str,
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    parsed_id = object_id(instruction_id)
    reason = safe_str(reason)

    if not parsed_id:
        raise PayrollTaxError(
            "Invalid TDS instruction identifier.",
            status_code=404,
            code="tds_instruction_not_found",
        )

    if not reason:
        raise PayrollTaxError(
            "A deactivation reason is required.",
            code="tds_instruction_deactivation_reason_required",
        )

    now = now_utc()
    result = db[TAX_INSTRUCTIONS_COLLECTION].find_one_and_update(
        {
            "_id": parsed_id,
            "tenant_id": tenant_id,
            "status": {"$in": ["draft", "active"]},
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "inactive",
                "deactivated_at": now,
                "deactivated_by": safe_str(actor_id),
                "deactivated_by_name": safe_str(actor_name),
                "deactivation_reason": reason,
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            }
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollTaxError(
            "TDS instruction was not found or is no longer active.",
            status_code=409,
            code="tds_instruction_not_deactivatable",
        )

    return result


def list_tds_instructions(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any = "",
    financial_years: Iterable[Any] | None = None,
    statuses: Iterable[Any] | None = None,
    modes: Iterable[Any] | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }

    if employee_reference not in (None, ""):
        employee = find_employee(
            db,
            tenant_id=tenant_id,
            employee_reference=employee_reference,
        )

        if not employee:
            raise PayrollTaxError(
                "Employee was not found in the selected company.",
                status_code=404,
                code="payroll_employee_not_found",
            )

        query["employee_id"] = canonical_employee_id(employee)

    normalized_years = {
        normalize_financial_year(item)
        for item in (financial_years or [])
        if safe_str(item)
    }

    if normalized_years:
        query["financial_year"] = {"$in": sorted(normalized_years)}

    normalized_statuses = {
        normalize_key(item)
        for item in (statuses or [])
        if safe_str(item)
    }

    if normalized_statuses:
        invalid = normalized_statuses - TDS_INSTRUCTION_STATUSES

        if invalid:
            raise PayrollTaxError(
                "One or more TDS instruction statuses are invalid.",
                code="invalid_tds_instruction_status",
                details={"statuses": sorted(invalid)},
            )

        query["status"] = {"$in": sorted(normalized_statuses)}

    normalized_modes = {
        normalize_tds_mode(item)
        for item in (modes or [])
        if safe_str(item)
    }

    if normalized_modes:
        query["mode"] = {"$in": sorted(normalized_modes)}

    safe_limit = max(1, min(int(limit or 500), 2000))

    return list(
        db[TAX_INSTRUCTIONS_COLLECTION]
        .find(query)
        .sort([
            ("financial_year", -1),
            ("effective_from_period", -1),
            ("created_at", -1),
        ])
        .limit(safe_limit)
    )


def _effective_instruction_for_period(
    instructions: Iterable[Mapping[str, Any]],
    period_key: str,
) -> dict[str, Any] | None:
    eligible = [
        dict(instruction)
        for instruction in instructions
        if normalize_key(instruction.get("status")) == "active"
        and safe_str(instruction.get("effective_from_period")) <= period_key
    ]

    if not eligible:
        return None

    eligible.sort(
        key=lambda item: (
            safe_str(item.get("effective_from_period")),
            item.get("created_at") or datetime.min.replace(tzinfo=UTC),
        ),
        reverse=True,
    )
    return eligible[0]


def resolve_tds_for_payroll(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    period_key: Any,
) -> dict[str, Any]:
    employee = find_employee(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
    )

    if not employee:
        raise PayrollTaxError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    period = safe_str(period_key)

    if not PERIOD_PATTERN.fullmatch(period):
        raise PayrollTaxError(
            "period_key must use YYYY-MM format.",
            code="invalid_payroll_period",
            details={"period_key": period},
        )

    financial_year = financial_year_for_period(period)
    instructions = list(
        db[TAX_INSTRUCTIONS_COLLECTION]
        .find({
            "tenant_id": tenant_id,
            "employee_id": canonical_employee_id(employee),
            "financial_year": financial_year,
            "status": "active",
            "effective_from_period": {"$lte": period},
            "is_deleted": {"$ne": True},
        })
        .sort([
            ("effective_from_period", -1),
            ("created_at", -1),
        ])
    )
    instruction = _effective_instruction_for_period(
        instructions,
        period,
    )

    if not instruction:
        return {
            "tenant_id": tenant_id,
            "employee_id": canonical_employee_id(employee),
            "employee_code": employee_code(employee),
            "employee_name": employee_name(employee),
            "period_key": period,
            "financial_year": financial_year,
            "mode": "disabled",
            "tds_amount": 0,
            "instruction_id": "",
            "external_reference": "",
            "source_system": "",
            "reason": "No active TDS instruction exists for this payroll period.",
        }

    mode = normalize_tds_mode(instruction.get("mode"))
    amount = money_decimal(
        instruction.get("monthly_tds_amount"),
        field_name="monthly_tds_amount",
        minimum=ZERO,
    )

    if mode == "disabled":
        amount = ZERO

    return {
        "tenant_id": tenant_id,
        "employee_id": canonical_employee_id(employee),
        "employee_code": employee_code(employee),
        "employee_name": employee_name(employee),
        "period_key": period,
        "financial_year": financial_year,
        "mode": mode,
        "tds_amount": money_value(amount),
        "instruction_id": safe_str(instruction.get("_id")),
        "external_reference": safe_str(
            instruction.get("external_reference")
        ),
        "source_system": safe_str(instruction.get("source_system")),
        "effective_from_period": safe_str(
            instruction.get("effective_from_period")
        ),
        "instruction_created_at": instruction.get("created_at"),
    }


def tax_declaration_snapshot(
    declaration: Mapping[str, Any] | None,
) -> dict[str, Any]:
    if not declaration:
        return {
            "available": False,
            "status": "not_found",
            "financial_year": "",
            "tax_regime": "not_selected",
            "declared_total": 0,
            "approved_total": 0,
            "components": [],
        }

    status = normalize_key(declaration.get("status"))

    return {
        "available": True,
        "tax_declaration_id": safe_str(declaration.get("_id")),
        "employee_id": safe_str(declaration.get("employee_id")),
        "financial_year": safe_str(declaration.get("financial_year")),
        "tax_regime": normalize_tax_regime(
            declaration.get("tax_regime")
        ),
        "status": status,
        "revision_number": int(
            declaration.get("revision_number") or 1
        ),
        "declared_total": money_value(
            declaration.get("declared_total")
        ),
        "approved_total": money_value(
            declaration.get("approved_total")
        ),
        "components": [
            {
                "component_id": safe_str(component.get("component_id")),
                "type": safe_str(component.get("type")),
                "label": safe_str(component.get("label")),
                "declared_amount": money_value(
                    component.get("declared_amount")
                ),
                "approved_amount": money_value(
                    component.get("approved_amount")
                ),
                "proof_required": bool(
                    component.get("proof_required")
                ),
                "proof_status": safe_str(
                    component.get("proof_status")
                ),
            }
            for component in declaration.get("components") or []
        ],
        "approved_at": declaration.get("approved_at"),
        "locked_at": declaration.get("locked_at"),
        "snapshot_at": now_utc(),
    }


def resolve_payroll_tax_context(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    period_key: Any,
) -> dict[str, Any]:
    employee = find_employee(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
    )

    if not employee:
        raise PayrollTaxError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    financial_year = financial_year_for_period(period_key)
    declaration = db[TAX_DECLARATIONS_COLLECTION].find_one({
        "tenant_id": tenant_id,
        "employee_id": canonical_employee_id(employee),
        "financial_year": financial_year,
        "status": {"$in": ["approved", "locked"]},
        "is_deleted": {"$ne": True},
    })
    tds = resolve_tds_for_payroll(
        db,
        tenant_id=tenant_id,
        employee_reference=canonical_employee_id(employee),
        period_key=period_key,
    )

    return {
        "tenant_id": tenant_id,
        "employee_id": canonical_employee_id(employee),
        "employee_code": employee_code(employee),
        "employee_name": employee_name(employee),
        "period_key": safe_str(period_key),
        "financial_year": financial_year,
        "declaration": tax_declaration_snapshot(declaration),
        "tds": tds,
        "calculation_policy": {
            "automatic_income_tax_calculation_enabled": False,
            "tds_source": tds["mode"],
            "note": (
                "The payroll module records TDS from disabled, manual or external "
                "instructions. Statutory slab calculation is intentionally not "
                "performed by this service."
            ),
        },
    }


__all__ = [
    "EDITABLE_DECLARATION_STATUSES",
    "FINAL_DECLARATION_STATUSES",
    "REVIEWABLE_DECLARATION_STATUSES",
    "TAX_DECLARATION_COMPONENTS",
    "TAX_DECLARATION_STATUSES",
    "TAX_DECLARATIONS_COLLECTION",
    "TAX_INSTRUCTIONS_COLLECTION",
    "TAX_PROOF_STATUSES",
    "TAX_REGIMES",
    "TDS_INSTRUCTION_STATUSES",
    "TDS_MODES",
    "PayrollTaxError",
    "activate_tds_instruction",
    "approve_tax_declaration",
    "cancel_tax_declaration",
    "complete_tax_hr_review",
    "create_tds_instruction",
    "deactivate_tds_instruction",
    "financial_year_for_period",
    "find_employee",
    "get_tax_declaration",
    "list_tax_declarations",
    "list_tds_instructions",
    "lock_tax_declaration",
    "money_decimal",
    "normalize_declaration_payload",
    "normalize_financial_year",
    "normalize_tax_regime",
    "normalize_tds_mode",
    "reject_tax_declaration",
    "resolve_payroll_tax_context",
    "resolve_tds_for_payroll",
    "submit_tax_declaration",
    "tax_declaration_snapshot",
    "upsert_tax_declaration",
]