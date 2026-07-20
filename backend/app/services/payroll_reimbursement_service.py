from __future__ import annotations

from datetime import date, datetime, timezone

UTC = timezone.utc  # Python 3.10 compatible replacement for datetime.UTC
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping

from bson import ObjectId
from pymongo import ReturnDocument


REIMBURSEMENTS_COLLECTION = "payroll_reimbursements"

REIMBURSEMENT_TYPES = {
    "travel",
    "local_conveyance",
    "accommodation",
    "meals",
    "mobile_internet",
    "medical",
    "office_supplies",
    "training",
    "relocation",
    "fuel",
    "client_entertainment",
    "other",
}

REIMBURSEMENT_STATUSES = {
    "draft",
    "pending_hr_review",
    "pending_finance_approval",
    "approved",
    "scheduled",
    "paid",
    "rejected",
    "cancelled",
}

TAX_TREATMENTS = {
    "taxable",
    "non_taxable",
}

PAYMENT_MODES = {
    "payroll",
    "manual",
}

MUTABLE_DRAFT_STATUSES = {
    "draft",
}

CANCELLABLE_STATUSES = {
    "draft",
    "pending_hr_review",
    "pending_finance_approval",
}

PAYROLL_ELIGIBLE_STATUSES = {
    "approved",
    "scheduled",
}

FINAL_PAYROLL_STATUSES = {
    "locked",
    "disbursed",
}

ZERO = Decimal("0")
MONEY_QUANTUM = Decimal("0.01")


class PayrollReimbursementError(ValueError):
    """Business-rule error for payroll reimbursement workflows."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str = "payroll_reimbursement_error",
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
    required: bool = True,
    minimum: Decimal | None = ZERO,
) -> Decimal:
    if value in (None, ""):
        if required:
            raise PayrollReimbursementError(
                f"{field_name} is required.",
                code="reimbursement_field_required",
                details={"field": field_name},
            )
        return ZERO

    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise PayrollReimbursementError(
            f"{field_name} must be a valid number.",
            code="invalid_reimbursement_amount",
            details={"field": field_name},
        ) from exc

    if not amount.is_finite():
        raise PayrollReimbursementError(
            f"{field_name} must be a finite number.",
            code="invalid_reimbursement_amount",
            details={"field": field_name},
        )

    if minimum is not None and amount < minimum:
        raise PayrollReimbursementError(
            f"{field_name} must be at least {minimum}.",
            code="invalid_reimbursement_amount",
            details={
                "field": field_name,
                "minimum": float(minimum),
            },
        )

    return amount.quantize(MONEY_QUANTUM)


def money_value(value: Decimal | int | float) -> int | float:
    amount = Decimal(str(value)).quantize(MONEY_QUANTUM)

    if amount == amount.to_integral_value():
        return int(amount)

    return float(amount)


def parse_date(
    value: Any,
    *,
    field_name: str,
    required: bool = True,
) -> date | None:
    if value in (None, ""):
        if required:
            raise PayrollReimbursementError(
                f"{field_name} is required.",
                code="reimbursement_date_required",
                details={"field": field_name},
            )
        return None

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    text = safe_str(value)

    try:
        return date.fromisoformat(text[:10])
    except ValueError as exc:
        raise PayrollReimbursementError(
            f"{field_name} must use YYYY-MM-DD format.",
            code="invalid_reimbursement_date",
            details={"field": field_name},
        ) from exc


def normalize_period(value: Any, *, field_name: str) -> str:
    text = safe_str(value)

    if not text:
        raise PayrollReimbursementError(
            f"{field_name} is required.",
            code="payroll_period_required",
            details={"field": field_name},
        )

    try:
        parsed = datetime.strptime(text, "%Y-%m")
    except ValueError as exc:
        raise PayrollReimbursementError(
            f"{field_name} must use YYYY-MM format.",
            code="invalid_payroll_period",
            details={"field": field_name},
        ) from exc

    if parsed.year < 2000 or parsed.year > 2200:
        raise PayrollReimbursementError(
            f"{field_name} year must be between 2000 and 2200.",
            code="invalid_payroll_period",
            details={"field": field_name},
        )

    return f"{parsed.year:04d}-{parsed.month:02d}"


def optional_period(value: Any, *, field_name: str) -> str:
    if value in (None, ""):
        return ""

    return normalize_period(value, field_name=field_name)


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

    filters: list[dict[str, Any]] = [
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
        filters.insert(0, {"_id": parsed_id})

    return db.employees.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": filters,
    })


def get_reimbursement(
    db: Any,
    *,
    tenant_id: str,
    reimbursement_id: Any,
) -> dict[str, Any]:
    parsed_id = object_id(reimbursement_id)

    if not parsed_id:
        raise PayrollReimbursementError(
            "Invalid reimbursement identifier.",
            status_code=404,
            code="reimbursement_not_found",
        )

    record = db[REIMBURSEMENTS_COLLECTION].find_one({
        "_id": parsed_id,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    })

    if not record:
        raise PayrollReimbursementError(
            "Reimbursement record was not found.",
            status_code=404,
            code="reimbursement_not_found",
        )

    return record


def _history_entry(
    *,
    action: str,
    from_status: str,
    to_status: str,
    actor_id: str,
    actor_name: str,
    note: str = "",
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "action": normalize_key(action),
        "from_status": normalize_key(from_status),
        "to_status": normalize_key(to_status),
        "actor_id": safe_str(actor_id),
        "actor_name": safe_str(actor_name),
        "note": safe_str(note),
        "metadata": dict(metadata or {}),
        "at": now_utc(),
    }


def _normalize_type(value: Any) -> str:
    normalized = normalize_key(value or "other")

    aliases = {
        "conveyance": "local_conveyance",
        "local_travel": "local_conveyance",
        "hotel": "accommodation",
        "lodging": "accommodation",
        "food": "meals",
        "meal": "meals",
        "mobile": "mobile_internet",
        "internet": "mobile_internet",
        "stationery": "office_supplies",
        "office": "office_supplies",
        "petrol": "fuel",
        "diesel": "fuel",
        "medical_reimbursement": "medical",
        "miscellaneous": "other",
        "misc": "other",
    }
    normalized = aliases.get(normalized, normalized)

    if normalized not in REIMBURSEMENT_TYPES:
        raise PayrollReimbursementError(
            "Unsupported reimbursement type.",
            code="invalid_reimbursement_type",
            details={
                "type": normalized,
                "allowed_types": sorted(REIMBURSEMENT_TYPES),
            },
        )

    return normalized


def _default_label(reimbursement_type: str) -> str:
    labels = {
        "travel": "Travel Reimbursement",
        "local_conveyance": "Local Conveyance Reimbursement",
        "accommodation": "Accommodation Reimbursement",
        "meals": "Meal Reimbursement",
        "mobile_internet": "Mobile & Internet Reimbursement",
        "medical": "Medical Reimbursement",
        "office_supplies": "Office Supplies Reimbursement",
        "training": "Training Reimbursement",
        "relocation": "Relocation Reimbursement",
        "fuel": "Fuel Reimbursement",
        "client_entertainment": "Client Entertainment Reimbursement",
        "other": "Other Reimbursement",
    }
    return labels[reimbursement_type]


def _normalize_receipts(value: Any) -> list[dict[str, Any]]:
    if value in (None, ""):
        return []

    if not isinstance(value, list):
        raise PayrollReimbursementError(
            "receipts must be a list.",
            code="invalid_reimbursement_receipts",
        )

    receipts: list[dict[str, Any]] = []
    seen_references: set[str] = set()

    for index, raw in enumerate(value):
        if isinstance(raw, str):
            raw = {"reference": raw}

        if not isinstance(raw, Mapping):
            raise PayrollReimbursementError(
                f"receipts[{index}] must be an object or reference string.",
                code="invalid_reimbursement_receipt",
                details={"index": index},
            )

        reference = safe_str(
            raw.get("reference")
            or raw.get("attachment_id")
            or raw.get("file_id")
            or raw.get("url")
            or raw.get("path")
        )

        if not reference:
            raise PayrollReimbursementError(
                f"receipts[{index}] must contain a file reference.",
                code="reimbursement_receipt_reference_required",
                details={"index": index},
            )

        if reference in seen_references:
            continue

        receipts.append({
            "reference": reference,
            "filename": safe_str(raw.get("filename") or raw.get("name")),
            "mime_type": safe_str(raw.get("mime_type") or raw.get("content_type")),
            "size_bytes": int(raw.get("size_bytes") or raw.get("size") or 0),
            "uploaded_at": raw.get("uploaded_at"),
        })
        seen_references.add(reference)

    return receipts


def _normalize_items(value: Any) -> tuple[list[dict[str, Any]], Decimal]:
    if not isinstance(value, list) or not value:
        raise PayrollReimbursementError(
            "At least one reimbursement item is required.",
            code="reimbursement_items_required",
        )

    normalized: list[dict[str, Any]] = []
    total = ZERO

    for index, raw in enumerate(value):
        if not isinstance(raw, Mapping):
            raise PayrollReimbursementError(
                f"items[{index}] must be an object.",
                code="invalid_reimbursement_item",
                details={"index": index},
            )

        item_type = _normalize_type(
            raw.get("type")
            or raw.get("category")
            or raw.get("claim_type")
            or "other"
        )
        expense_date = parse_date(
            raw.get("expense_date") or raw.get("date"),
            field_name=f"items[{index}].expense_date",
        )
        amount = money_decimal(
            raw.get("amount"),
            field_name=f"items[{index}].amount",
            minimum=MONEY_QUANTUM,
        )
        description = safe_str(
            raw.get("description")
            or raw.get("purpose")
            or raw.get("details")
        )

        if not description:
            raise PayrollReimbursementError(
                f"items[{index}].description is required.",
                code="reimbursement_item_description_required",
                details={"index": index},
            )

        receipts = _normalize_receipts(
            raw.get("receipts")
            or raw.get("attachments")
            or []
        )

        normalized.append({
            "item_id": safe_str(raw.get("item_id")) or safe_str(ObjectId()),
            "type": item_type,
            "category": item_type,
            "label": safe_str(raw.get("label")) or _default_label(item_type),
            "expense_date": expense_date.isoformat(),
            "description": description,
            "amount": money_value(amount),
            "vendor": safe_str(raw.get("vendor")),
            "invoice_number": safe_str(
                raw.get("invoice_number")
                or raw.get("bill_number")
            ),
            "project_id": safe_str(raw.get("project_id")),
            "project_name": safe_str(raw.get("project_name")),
            "location": safe_str(raw.get("location")),
            "receipts": receipts,
        })
        total += amount

    return normalized, total.quantize(MONEY_QUANTUM)


def _validate_claimed_total(
    payload: Mapping[str, Any],
    calculated_total: Decimal,
) -> None:
    supplied = payload.get(
        "claimed_amount",
        payload.get(
            "claimedAmount",
            payload.get("total_amount"),
        ),
    )

    if supplied in (None, ""):
        return

    claimed = money_decimal(
        supplied,
        field_name="claimed_amount",
        minimum=MONEY_QUANTUM,
    )

    if claimed != calculated_total:
        raise PayrollReimbursementError(
            "claimed_amount must equal the total of all reimbursement items.",
            code="reimbursement_total_mismatch",
            details={
                "claimed_amount": money_value(claimed),
                "items_total": money_value(calculated_total),
            },
        )


def _ensure_receipts_when_required(
    items: Iterable[Mapping[str, Any]],
    *,
    receipts_required: bool,
) -> None:
    if not receipts_required:
        return

    missing = [
        safe_str(item.get("item_id"))
        for item in items
        if not list(item.get("receipts") or [])
    ]

    if missing:
        raise PayrollReimbursementError(
            "Every reimbursement item must have at least one receipt before submission.",
            code="reimbursement_receipts_required",
            details={"item_ids": missing},
        )


def create_reimbursement(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    payload: Mapping[str, Any],
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise PayrollReimbursementError(
            "Reimbursement payload must be an object.",
            code="invalid_reimbursement_payload",
        )

    tenant_id = safe_str(tenant_id)

    if not tenant_id:
        raise PayrollReimbursementError(
            "tenant_id is required.",
            code="payroll_tenant_required",
        )

    employee = find_employee(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
    )

    if not employee:
        raise PayrollReimbursementError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    items, claimed_total = _normalize_items(payload.get("items"))
    _validate_claimed_total(payload, claimed_total)

    record_id = ObjectId()
    now = now_utc()
    primary_type = _normalize_type(
        payload.get("type")
        or payload.get("claim_type")
        or items[0]["type"]
    )

    document = {
        "_id": record_id,
        "tenant_id": tenant_id,
        "employee_id": canonical_employee_id(employee),
        "employee_code": employee_code(employee),
        "employee_name": employee_name(employee),
        "user_id": safe_str(employee.get("user_id")),
        "type": primary_type,
        "claim_type": primary_type,
        "label": safe_str(payload.get("label")) or _default_label(primary_type),
        "purpose": safe_str(payload.get("purpose")),
        "items": items,
        "claimed_amount": money_value(claimed_total),
        "approved_amount": 0,
        "rejected_amount": 0,
        "tax_treatment": "",
        "is_taxable": None,
        "payment_mode": "",
        "payroll_period": "",
        "status": "draft",
        "workflow_stage": "draft",
        "hr_review": {},
        "finance_approval": {},
        "payroll_snapshot": {},
        "payment": {},
        "workflow_history": [
            _history_entry(
                action="create",
                from_status="not_created",
                to_status="draft",
                actor_id=actor_id,
                actor_name=actor_name,
                note=safe_str(
                    payload.get("note")
                    or "Reimbursement draft created."
                ),
            )
        ],
        "created_at": now,
        "created_by": safe_str(actor_id),
        "created_by_name": safe_str(actor_name),
        "updated_at": now,
        "updated_by": safe_str(actor_id),
        "updated_by_name": safe_str(actor_name),
        "is_deleted": False,
    }

    db[REIMBURSEMENTS_COLLECTION].insert_one(document)
    return document


def update_reimbursement_draft(
    db: Any,
    *,
    tenant_id: str,
    reimbursement_id: Any,
    payload: Mapping[str, Any],
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    record = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )
    status = normalize_key(record.get("status"))

    if status not in MUTABLE_DRAFT_STATUSES:
        raise PayrollReimbursementError(
            "Only a Draft reimbursement can be edited.",
            status_code=409,
            code="reimbursement_not_editable",
            details={"status": status},
        )

    raw_items = payload.get("items", record.get("items"))
    items, claimed_total = _normalize_items(raw_items)
    _validate_claimed_total(payload, claimed_total)

    primary_type = _normalize_type(
        payload.get("type")
        or payload.get("claim_type")
        or record.get("type")
        or items[0]["type"]
    )
    now = now_utc()

    updates = {
        "type": primary_type,
        "claim_type": primary_type,
        "label": safe_str(payload.get("label"))
        or safe_str(record.get("label"))
        or _default_label(primary_type),
        "purpose": safe_str(
            payload.get("purpose")
            if "purpose" in payload
            else record.get("purpose")
        ),
        "items": items,
        "claimed_amount": money_value(claimed_total),
        "approved_amount": 0,
        "rejected_amount": 0,
        "tax_treatment": "",
        "is_taxable": None,
        "payment_mode": "",
        "payroll_period": "",
        "updated_at": now,
        "updated_by": safe_str(actor_id),
        "updated_by_name": safe_str(actor_name),
    }

    result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": "draft",
            "is_deleted": {"$ne": True},
        },
        {
            "$set": updates,
            "$push": {
                "workflow_history": _history_entry(
                    action="update_draft",
                    from_status="draft",
                    to_status="draft",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=safe_str(payload.get("note") or "Draft updated."),
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollReimbursementError(
            "The reimbursement changed while it was being edited.",
            status_code=409,
            code="reimbursement_concurrent_update",
        )

    return result


def submit_reimbursement(
    db: Any,
    *,
    tenant_id: str,
    reimbursement_id: Any,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
    receipts_required: bool = True,
) -> dict[str, Any]:
    record = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )

    if normalize_key(record.get("status")) != "draft":
        raise PayrollReimbursementError(
            "Only a Draft reimbursement can be submitted.",
            status_code=409,
            code="invalid_reimbursement_transition",
        )

    claimed_amount = money_decimal(
        record.get("claimed_amount"),
        field_name="claimed_amount",
        minimum=MONEY_QUANTUM,
    )
    items = list(record.get("items") or [])

    if not items or claimed_amount <= ZERO:
        raise PayrollReimbursementError(
            "A reimbursement must contain at least one positive-value item before submission.",
            code="reimbursement_items_required",
        )

    _ensure_receipts_when_required(
        items,
        receipts_required=receipts_required,
    )

    now = now_utc()

    result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": "draft",
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "pending_hr_review",
                "workflow_stage": "pending_hr_review",
                "submitted_at": now,
                "submitted_by": safe_str(actor_id),
                "submitted_by_name": safe_str(actor_name),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _history_entry(
                    action="submit",
                    from_status="draft",
                    to_status="pending_hr_review",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note or "Submitted for HR review.",
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollReimbursementError(
            "The reimbursement status changed before submission completed.",
            status_code=409,
            code="reimbursement_concurrent_update",
        )

    return result


def complete_hr_review(
    db: Any,
    *,
    tenant_id: str,
    reimbursement_id: Any,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
) -> dict[str, Any]:
    record = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )

    if normalize_key(record.get("status")) != "pending_hr_review":
        raise PayrollReimbursementError(
            "Only a reimbursement Pending HR Review can move to Finance approval.",
            status_code=409,
            code="invalid_reimbursement_transition",
        )

    now = now_utc()

    result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": "pending_hr_review",
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "pending_finance_approval",
                "workflow_stage": "pending_finance_approval",
                "hr_review": {
                    "reviewed_by": safe_str(actor_id),
                    "reviewed_by_name": safe_str(actor_name),
                    "reviewed_at": now,
                    "note": safe_str(note),
                },
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _history_entry(
                    action="hr_review",
                    from_status="pending_hr_review",
                    to_status="pending_finance_approval",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note or "HR review completed.",
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollReimbursementError(
            "The reimbursement status changed before HR review completed.",
            status_code=409,
            code="reimbursement_concurrent_update",
        )

    return result


def approve_reimbursement(
    db: Any,
    *,
    tenant_id: str,
    reimbursement_id: Any,
    approved_amount: Any,
    tax_treatment: Any,
    payment_mode: Any,
    actor_id: str = "",
    actor_name: str = "",
    payroll_period: Any = "",
    note: str = "",
) -> dict[str, Any]:
    record = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )

    if normalize_key(record.get("status")) != "pending_finance_approval":
        raise PayrollReimbursementError(
            "Only a reimbursement Pending Finance Approval can be approved.",
            status_code=409,
            code="invalid_reimbursement_transition",
        )

    claimed = money_decimal(
        record.get("claimed_amount"),
        field_name="claimed_amount",
        minimum=MONEY_QUANTUM,
    )
    approved = money_decimal(
        approved_amount,
        field_name="approved_amount",
        minimum=MONEY_QUANTUM,
    )

    if approved > claimed:
        raise PayrollReimbursementError(
            "approved_amount cannot exceed the claimed amount.",
            code="approved_amount_exceeds_claim",
            details={
                "claimed_amount": money_value(claimed),
                "approved_amount": money_value(approved),
            },
        )

    normalized_tax = normalize_key(tax_treatment)

    if normalized_tax not in TAX_TREATMENTS:
        raise PayrollReimbursementError(
            "tax_treatment must be taxable or non_taxable.",
            code="invalid_reimbursement_tax_treatment",
            details={"tax_treatment": normalized_tax},
        )

    normalized_payment_mode = normalize_key(payment_mode)

    if normalized_payment_mode not in PAYMENT_MODES:
        raise PayrollReimbursementError(
            "payment_mode must be payroll or manual.",
            code="invalid_reimbursement_payment_mode",
            details={"payment_mode": normalized_payment_mode},
        )

    normalized_period = optional_period(
        payroll_period,
        field_name="payroll_period",
    )

    if normalized_payment_mode == "payroll" and not normalized_period:
        raise PayrollReimbursementError(
            "payroll_period is required when payment_mode is payroll.",
            code="reimbursement_payroll_period_required",
        )

    rejected = claimed - approved
    now = now_utc()

    result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": "pending_finance_approval",
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "approved_amount": money_value(approved),
                "rejected_amount": money_value(rejected),
                "tax_treatment": normalized_tax,
                "is_taxable": normalized_tax == "taxable",
                "payment_mode": normalized_payment_mode,
                "payroll_period": normalized_period,
                "status": "approved",
                "workflow_stage": "approved",
                "finance_approval": {
                    "approved_amount": money_value(approved),
                    "rejected_amount": money_value(rejected),
                    "tax_treatment": normalized_tax,
                    "payment_mode": normalized_payment_mode,
                    "payroll_period": normalized_period,
                    "approved_by": safe_str(actor_id),
                    "approved_by_name": safe_str(actor_name),
                    "approved_at": now,
                    "note": safe_str(note),
                },
                "approved_at": now,
                "approved_by": safe_str(actor_id),
                "approved_by_name": safe_str(actor_name),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _history_entry(
                    action="finance_approve",
                    from_status="pending_finance_approval",
                    to_status="approved",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note or "Reimbursement approved by Finance.",
                    metadata={
                        "claimed_amount": money_value(claimed),
                        "approved_amount": money_value(approved),
                        "rejected_amount": money_value(rejected),
                        "tax_treatment": normalized_tax,
                        "payment_mode": normalized_payment_mode,
                        "payroll_period": normalized_period,
                    },
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollReimbursementError(
            "The reimbursement status changed before approval completed.",
            status_code=409,
            code="reimbursement_concurrent_update",
        )

    return result


def reject_reimbursement(
    db: Any,
    *,
    tenant_id: str,
    reimbursement_id: Any,
    reason: str,
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    reason = safe_str(reason)

    if not reason:
        raise PayrollReimbursementError(
            "A rejection reason is required.",
            code="reimbursement_rejection_reason_required",
        )

    record = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )
    status = normalize_key(record.get("status"))

    if status not in {
        "pending_hr_review",
        "pending_finance_approval",
    }:
        raise PayrollReimbursementError(
            "Only a reimbursement under HR or Finance review can be rejected.",
            status_code=409,
            code="invalid_reimbursement_transition",
            details={"status": status},
        )

    now = now_utc()

    result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": record.get("status"),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "rejected",
                "workflow_stage": "rejected",
                "rejection": {
                    "reason": reason,
                    "rejected_from_status": status,
                    "rejected_by": safe_str(actor_id),
                    "rejected_by_name": safe_str(actor_name),
                    "rejected_at": now,
                },
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _history_entry(
                    action="reject",
                    from_status=status,
                    to_status="rejected",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=reason,
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollReimbursementError(
            "The reimbursement status changed before rejection completed.",
            status_code=409,
            code="reimbursement_concurrent_update",
        )

    return result


def cancel_reimbursement(
    db: Any,
    *,
    tenant_id: str,
    reimbursement_id: Any,
    reason: str,
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    record = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )
    status = normalize_key(record.get("status"))
    reason = safe_str(reason)

    if status not in CANCELLABLE_STATUSES:
        raise PayrollReimbursementError(
            "This reimbursement can no longer be cancelled.",
            status_code=409,
            code="reimbursement_not_cancellable",
            details={"status": status},
        )

    if not reason:
        raise PayrollReimbursementError(
            "A cancellation reason is required.",
            code="reimbursement_cancellation_reason_required",
        )

    now = now_utc()

    result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": record.get("status"),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "cancelled",
                "workflow_stage": "cancelled",
                "cancelled_at": now,
                "cancelled_by": safe_str(actor_id),
                "cancelled_by_name": safe_str(actor_name),
                "cancellation_reason": reason,
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _history_entry(
                    action="cancel",
                    from_status=status,
                    to_status="cancelled",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=reason,
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollReimbursementError(
            "The reimbursement status changed before cancellation completed.",
            status_code=409,
            code="reimbursement_concurrent_update",
        )

    return result


def _find_payroll_run(
    db: Any,
    *,
    tenant_id: str,
    run_id: Any,
) -> dict[str, Any] | None:
    normalized_run_id = safe_str(run_id)
    parsed_id = object_id(normalized_run_id)
    alternatives: list[dict[str, Any]] = [
        {"_id": normalized_run_id},
        {"run_id": normalized_run_id},
    ]

    if parsed_id:
        alternatives.insert(0, {"_id": parsed_id})

    return db.payroll_runs.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": alternatives,
    })


def revise_reimbursement_schedule(
    db: Any,
    *,
    tenant_id: str,
    reimbursement_id: Any,
    payment_mode: Any,
    actor_id: str = "",
    actor_name: str = "",
    payroll_period: Any = "",
    note: str = "",
) -> dict[str, Any]:
    record = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )
    status = normalize_key(record.get("status"))

    if status != "approved":
        raise PayrollReimbursementError(
            "Only an Approved reimbursement can have its payment schedule revised.",
            status_code=409,
            code="reimbursement_schedule_not_revisable",
            details={"status": status},
        )

    if record.get("payroll_snapshot") or record.get("scheduled_run_id"):
        raise PayrollReimbursementError(
            "A reimbursement already reserved in a payroll run cannot be rescheduled.",
            status_code=409,
            code="scheduled_reimbursement_immutable",
        )

    normalized_mode = normalize_key(payment_mode)

    if normalized_mode not in PAYMENT_MODES:
        raise PayrollReimbursementError(
            "payment_mode must be payroll or manual.",
            code="invalid_reimbursement_payment_mode",
        )

    normalized_period = optional_period(
        payroll_period,
        field_name="payroll_period",
    )

    if normalized_mode == "payroll" and not normalized_period:
        raise PayrollReimbursementError(
            "payroll_period is required when payment_mode is payroll.",
            code="reimbursement_payroll_period_required",
        )

    now = now_utc()

    result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": "approved",
            "scheduled_run_id": {"$in": [None, ""]},
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "payment_mode": normalized_mode,
                "payroll_period": normalized_period,
                "finance_approval.payment_mode": normalized_mode,
                "finance_approval.payroll_period": normalized_period,
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _history_entry(
                    action="revise_payment_schedule",
                    from_status="approved",
                    to_status="approved",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note or "Reimbursement payment schedule revised.",
                    metadata={
                        "payment_mode": normalized_mode,
                        "payroll_period": normalized_period,
                    },
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollReimbursementError(
            "The reimbursement schedule changed before the update completed.",
            status_code=409,
            code="reimbursement_concurrent_update",
        )

    return result


def resolve_payroll_reimbursements(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    period_key: Any,
    run_id: Any = "",
) -> list[dict[str, Any]]:
    period = normalize_period(
        period_key,
        field_name="period_key",
    )
    employee = find_employee(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
    )

    if not employee:
        raise PayrollReimbursementError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    canonical_id = canonical_employee_id(employee)
    normalized_run_id = safe_str(run_id)

    rows = db[REIMBURSEMENTS_COLLECTION].find({
        "tenant_id": tenant_id,
        "employee_id": canonical_id,
        "payment_mode": "payroll",
        "payroll_period": period,
        "status": {"$in": sorted(PAYROLL_ELIGIBLE_STATUSES)},
        "is_deleted": {"$ne": True},
    })

    reimbursements: list[dict[str, Any]] = []

    for record in rows:
        status = normalize_key(record.get("status"))
        scheduled_run_id = safe_str(record.get("scheduled_run_id"))

        if (
            status == "scheduled"
            and scheduled_run_id
            and normalized_run_id
            and scheduled_run_id != normalized_run_id
        ):
            continue

        if status == "scheduled" and not normalized_run_id:
            continue

        approved = money_decimal(
            record.get("approved_amount"),
            field_name="approved_amount",
            minimum=MONEY_QUANTUM,
        )
        tax_treatment = normalize_key(record.get("tax_treatment"))

        if tax_treatment not in TAX_TREATMENTS:
            raise PayrollReimbursementError(
                "Approved reimbursement is missing a valid tax treatment.",
                status_code=409,
                code="reimbursement_tax_treatment_missing",
                details={
                    "reimbursement_id": safe_str(record.get("_id")),
                },
            )

        reimbursement_type = _normalize_type(
            record.get("type")
            or record.get("claim_type")
            or "other"
        )
        reimbursement_id = safe_str(record.get("_id"))

        reimbursements.append({
            "id": reimbursement_id,
            "_id": reimbursement_id,
            "reference_id": reimbursement_id,
            "employee_id": canonical_id,
            "employee_code": employee_code(employee),
            "code": f"reimbursement_{reimbursement_type}",
            "type": reimbursement_type,
            "category": "reimbursement",
            "label": safe_str(record.get("label"))
            or _default_label(reimbursement_type),
            "amount": money_value(approved),
            "approved_amount": money_value(approved),
            "claimed_amount": record.get("claimed_amount", 0),
            "tax_treatment": tax_treatment,
            "is_taxable": tax_treatment == "taxable",
            "show_in_earnings": True,
            "include_in_gross_earnings": True,
            "include_in_taxable_income": tax_treatment == "taxable",
            "lwp_proratable": False,
            "payroll_period": period,
            "status": status,
            "items": list(record.get("items") or []),
        })

    return reimbursements


def summarize_payroll_reimbursements(
    reimbursements: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    rows = list(reimbursements or [])
    taxable = ZERO
    non_taxable = ZERO

    for row in rows:
        amount = money_decimal(
            row.get("amount", row.get("approved_amount", 0)),
            field_name="reimbursement.amount",
            required=False,
            minimum=ZERO,
        )

        if bool(row.get("is_taxable")) or normalize_key(
            row.get("tax_treatment")
        ) == "taxable":
            taxable += amount
        else:
            non_taxable += amount

    return {
        "items": rows,
        "taxable_total": money_value(taxable),
        "non_taxable_total": money_value(non_taxable),
        "total": money_value(taxable + non_taxable),
        "count": len(rows),
    }


def reserve_payroll_reimbursements(
    db: Any,
    *,
    tenant_id: str,
    run_id: Any,
    period_key: Any,
    employee_id: Any,
    reimbursement_details: Iterable[Mapping[str, Any]],
    payslip_id: Any = "",
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    normalized_run_id = safe_str(run_id)

    if not normalized_run_id:
        raise PayrollReimbursementError(
            "run_id is required.",
            code="payroll_run_id_required",
        )

    period = normalize_period(
        period_key,
        field_name="period_key",
    )
    normalized_employee_id = safe_str(employee_id)

    if not normalized_employee_id:
        raise PayrollReimbursementError(
            "employee_id is required.",
            code="payroll_employee_id_required",
        )

    run = _find_payroll_run(
        db,
        tenant_id=tenant_id,
        run_id=normalized_run_id,
    )

    if not run:
        raise PayrollReimbursementError(
            "Payroll run was not found.",
            status_code=404,
            code="payroll_run_not_found",
        )

    run_status = normalize_key(run.get("status"))

    if run_status in FINAL_PAYROLL_STATUSES:
        raise PayrollReimbursementError(
            "Reimbursements cannot be added after the payroll run is locked or disbursed.",
            status_code=409,
            code="locked_payroll_reimbursement_immutable",
            details={"status": run_status},
        )

    reserved: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for detail in reimbursement_details or []:
        reference_id = safe_str(
            detail.get("reference_id")
            or detail.get("id")
            or detail.get("_id")
        )

        if not reference_id:
            continue

        try:
            record = get_reimbursement(
                db,
                tenant_id=tenant_id,
                reimbursement_id=reference_id,
            )
            status = normalize_key(record.get("status"))
            existing_run_id = safe_str(record.get("scheduled_run_id"))

            if (
                status == "scheduled"
                and existing_run_id == normalized_run_id
            ):
                skipped.append({
                    "reimbursement_id": reference_id,
                    "reason": "already_reserved_for_run",
                })
                continue

            if status != "approved":
                raise PayrollReimbursementError(
                    "Only an Approved reimbursement can be reserved for payroll.",
                    status_code=409,
                    code="reimbursement_not_payroll_reservable",
                    details={"status": status},
                )

            if normalize_key(record.get("payment_mode")) != "payroll":
                raise PayrollReimbursementError(
                    "Only payroll-mode reimbursements can be reserved in a payroll run.",
                    status_code=409,
                    code="reimbursement_not_payroll_mode",
                )

            if safe_str(record.get("payroll_period")) != period:
                raise PayrollReimbursementError(
                    "The reimbursement belongs to a different payroll period.",
                    status_code=409,
                    code="reimbursement_period_mismatch",
                    details={
                        "record_period": safe_str(record.get("payroll_period")),
                        "requested_period": period,
                    },
                )

            if safe_str(record.get("employee_id")) != normalized_employee_id:
                raise PayrollReimbursementError(
                    "The reimbursement does not belong to the selected employee.",
                    status_code=409,
                    code="reimbursement_employee_mismatch",
                )

            approved = money_decimal(
                record.get("approved_amount"),
                field_name="approved_amount",
                minimum=MONEY_QUANTUM,
            )
            snapshot = {
                "run_id": normalized_run_id,
                "period_key": period,
                "payslip_id": safe_str(payslip_id),
                "employee_id": normalized_employee_id,
                "reimbursement_id": reference_id,
                "label": safe_str(record.get("label")),
                "type": safe_str(record.get("type")),
                "approved_amount": money_value(approved),
                "tax_treatment": safe_str(record.get("tax_treatment")),
                "is_taxable": bool(record.get("is_taxable")),
                "reserved_at": now_utc(),
                "reserved_by": safe_str(actor_id),
                "reserved_by_name": safe_str(actor_name),
            }

            result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
                {
                    "_id": record["_id"],
                    "tenant_id": tenant_id,
                    "status": "approved",
                    "is_deleted": {"$ne": True},
                },
                {
                    "$set": {
                        "status": "scheduled",
                        "workflow_stage": "scheduled",
                        "scheduled_run_id": normalized_run_id,
                        "scheduled_period": period,
                        "scheduled_payslip_id": safe_str(payslip_id),
                        "payroll_snapshot": snapshot,
                        "updated_at": now_utc(),
                        "updated_by": safe_str(actor_id),
                        "updated_by_name": safe_str(actor_name),
                    },
                    "$push": {
                        "workflow_history": _history_entry(
                            action="reserve_for_payroll",
                            from_status="approved",
                            to_status="scheduled",
                            actor_id=actor_id,
                            actor_name=actor_name,
                            note=f"Reserved for payroll period {period}.",
                            metadata={
                                "run_id": normalized_run_id,
                                "payslip_id": safe_str(payslip_id),
                                "approved_amount": money_value(approved),
                            },
                        )
                    },
                },
                return_document=ReturnDocument.AFTER,
            )

            if not result:
                raise PayrollReimbursementError(
                    "The reimbursement changed before payroll reservation completed.",
                    status_code=409,
                    code="reimbursement_concurrent_update",
                )

            reserved.append({
                "reimbursement_id": reference_id,
                "approved_amount": money_value(approved),
                "status": "scheduled",
            })
        except PayrollReimbursementError as exc:
            failures.append({
                "reimbursement_id": reference_id,
                "message": exc.message,
                "code": exc.code,
                "details": exc.details,
            })

    return {
        "run_id": normalized_run_id,
        "period_key": period,
        "employee_id": normalized_employee_id,
        "reserved": reserved,
        "skipped": skipped,
        "failures": failures,
        "totals": {
            "reserved": len(reserved),
            "skipped": len(skipped),
            "failed": len(failures),
            "amount_reserved": money_value(
                sum(
                    Decimal(str(item["approved_amount"]))
                    for item in reserved
                )
            ),
        },
    }


def release_payroll_reimbursements(
    db: Any,
    *,
    tenant_id: str,
    run_id: Any,
    actor_id: str = "",
    actor_name: str = "",
    reason: str = "",
) -> dict[str, Any]:
    normalized_run_id = safe_str(run_id)

    if not normalized_run_id:
        raise PayrollReimbursementError(
            "run_id is required.",
            code="payroll_run_id_required",
        )

    run = _find_payroll_run(
        db,
        tenant_id=tenant_id,
        run_id=normalized_run_id,
    )

    if not run:
        raise PayrollReimbursementError(
            "Payroll run was not found.",
            status_code=404,
            code="payroll_run_not_found",
        )

    run_status = normalize_key(run.get("status"))

    if run_status in FINAL_PAYROLL_STATUSES:
        raise PayrollReimbursementError(
            "Scheduled reimbursements cannot be released after payroll is locked or disbursed.",
            status_code=409,
            code="locked_payroll_reimbursement_immutable",
            details={"status": run_status},
        )

    rows = list(db[REIMBURSEMENTS_COLLECTION].find({
        "tenant_id": tenant_id,
        "status": "scheduled",
        "scheduled_run_id": normalized_run_id,
        "is_deleted": {"$ne": True},
    }))

    released: list[str] = []

    for record in rows:
        result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
            {
                "_id": record["_id"],
                "tenant_id": tenant_id,
                "status": "scheduled",
                "scheduled_run_id": normalized_run_id,
                "is_deleted": {"$ne": True},
            },
            {
                "$set": {
                    "status": "approved",
                    "workflow_stage": "approved",
                    "scheduled_run_id": "",
                    "scheduled_period": "",
                    "scheduled_payslip_id": "",
                    "payroll_snapshot": {},
                    "updated_at": now_utc(),
                    "updated_by": safe_str(actor_id),
                    "updated_by_name": safe_str(actor_name),
                },
                "$push": {
                    "workflow_history": _history_entry(
                        action="release_from_payroll",
                        from_status="scheduled",
                        to_status="approved",
                        actor_id=actor_id,
                        actor_name=actor_name,
                        note=reason or "Released from the draft payroll run.",
                        metadata={"run_id": normalized_run_id},
                    )
                },
            },
            return_document=ReturnDocument.AFTER,
        )

        if result:
            released.append(safe_str(record.get("_id")))

    return {
        "run_id": normalized_run_id,
        "released_reimbursement_ids": released,
        "released_count": len(released),
    }


def apply_payroll_reimbursement_payments(
    db: Any,
    *,
    tenant_id: str,
    run_id: Any,
    period_key: Any,
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    normalized_run_id = safe_str(run_id)

    if not normalized_run_id:
        raise PayrollReimbursementError(
            "run_id is required.",
            code="payroll_run_id_required",
        )

    period = normalize_period(
        period_key,
        field_name="period_key",
    )
    run = _find_payroll_run(
        db,
        tenant_id=tenant_id,
        run_id=normalized_run_id,
    )

    if not run:
        raise PayrollReimbursementError(
            "Payroll run was not found.",
            status_code=404,
            code="payroll_run_not_found",
        )

    if normalize_key(run.get("status")) != "disbursed":
        raise PayrollReimbursementError(
            "Reimbursements can be marked paid only after the payroll run is Disbursed.",
            status_code=409,
            code="payroll_run_not_disbursed",
            details={"status": normalize_key(run.get("status"))},
        )

    rows = list(db[REIMBURSEMENTS_COLLECTION].find({
        "tenant_id": tenant_id,
        "status": "scheduled",
        "scheduled_run_id": normalized_run_id,
        "scheduled_period": period,
        "is_deleted": {"$ne": True},
    }))

    paid: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for record in rows:
        reimbursement_id = safe_str(record.get("_id"))
        approved = money_decimal(
            record.get("approved_amount"),
            field_name="approved_amount",
            minimum=MONEY_QUANTUM,
        )
        payment_entry = {
            "mode": "payroll",
            "run_id": normalized_run_id,
            "period_key": period,
            "payslip_id": safe_str(record.get("scheduled_payslip_id")),
            "amount": money_value(approved),
            "paid_at": now_utc(),
            "paid_by": safe_str(actor_id),
            "paid_by_name": safe_str(actor_name),
        }

        result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
            {
                "_id": record["_id"],
                "tenant_id": tenant_id,
                "status": "scheduled",
                "scheduled_run_id": normalized_run_id,
                "is_deleted": {"$ne": True},
            },
            {
                "$set": {
                    "status": "paid",
                    "workflow_stage": "paid",
                    "payment": payment_entry,
                    "paid_at": payment_entry["paid_at"],
                    "paid_amount": money_value(approved),
                    "updated_at": now_utc(),
                    "updated_by": safe_str(actor_id),
                    "updated_by_name": safe_str(actor_name),
                },
                "$push": {
                    "workflow_history": _history_entry(
                        action="mark_paid",
                        from_status="scheduled",
                        to_status="paid",
                        actor_id=actor_id,
                        actor_name=actor_name,
                        note=f"Paid through payroll period {period}.",
                        metadata={
                            "run_id": normalized_run_id,
                            "amount": money_value(approved),
                        },
                    )
                },
            },
            return_document=ReturnDocument.AFTER,
        )

        if not result:
            failures.append({
                "reimbursement_id": reimbursement_id,
                "message": "The reimbursement changed before payment completion.",
                "code": "reimbursement_concurrent_update",
            })
            continue

        paid.append({
            "reimbursement_id": reimbursement_id,
            "amount": money_value(approved),
            "status": "paid",
        })

    return {
        "run_id": normalized_run_id,
        "period_key": period,
        "paid": paid,
        "failures": failures,
        "totals": {
            "paid": len(paid),
            "failed": len(failures),
            "amount_paid": money_value(
                sum(
                    Decimal(str(item["amount"]))
                    for item in paid
                )
            ),
        },
    }


def mark_manual_reimbursement_paid(
    db: Any,
    *,
    tenant_id: str,
    reimbursement_id: Any,
    payment_date: Any,
    payment_reference: str,
    payment_mode: str = "bank_transfer",
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
) -> dict[str, Any]:
    record = get_reimbursement(
        db,
        tenant_id=tenant_id,
        reimbursement_id=reimbursement_id,
    )

    if normalize_key(record.get("status")) != "approved":
        raise PayrollReimbursementError(
            "Only an Approved reimbursement can be marked manually paid.",
            status_code=409,
            code="invalid_reimbursement_transition",
        )

    if normalize_key(record.get("payment_mode")) != "manual":
        raise PayrollReimbursementError(
            "This reimbursement is configured for payroll payment.",
            status_code=409,
            code="reimbursement_not_manual_payment",
        )

    paid_date = parse_date(
        payment_date,
        field_name="payment_date",
    )
    reference = safe_str(payment_reference)

    if not reference:
        raise PayrollReimbursementError(
            "payment_reference is required for manual reimbursement payment.",
            code="reimbursement_payment_reference_required",
        )

    approved = money_decimal(
        record.get("approved_amount"),
        field_name="approved_amount",
        minimum=MONEY_QUANTUM,
    )
    now = now_utc()
    payment_entry = {
        "mode": normalize_key(payment_mode) or "bank_transfer",
        "payment_date": paid_date.isoformat() if paid_date else "",
        "payment_reference": reference,
        "amount": money_value(approved),
        "paid_at": now,
        "paid_by": safe_str(actor_id),
        "paid_by_name": safe_str(actor_name),
        "note": safe_str(note),
    }

    result = db[REIMBURSEMENTS_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": "approved",
            "payment_mode": "manual",
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "paid",
                "workflow_stage": "paid",
                "payment": payment_entry,
                "paid_at": now,
                "paid_amount": money_value(approved),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _history_entry(
                    action="mark_manual_paid",
                    from_status="approved",
                    to_status="paid",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note or "Reimbursement marked paid manually.",
                    metadata={
                        "payment_date": payment_entry["payment_date"],
                        "payment_reference": reference,
                        "amount": money_value(approved),
                    },
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollReimbursementError(
            "The reimbursement changed before payment completion.",
            status_code=409,
            code="reimbursement_concurrent_update",
        )

    return result


def list_reimbursements(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any = "",
    statuses: Iterable[Any] | None = None,
    reimbursement_types: Iterable[Any] | None = None,
    payroll_period: Any = "",
    payment_mode: Any = "",
    limit: int = 200,
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
            raise PayrollReimbursementError(
                "Employee was not found in the selected company.",
                status_code=404,
                code="payroll_employee_not_found",
            )

        query["employee_id"] = canonical_employee_id(employee)

    normalized_statuses = {
        normalize_key(item)
        for item in (statuses or [])
        if safe_str(item)
    }

    if normalized_statuses:
        invalid_statuses = normalized_statuses - REIMBURSEMENT_STATUSES

        if invalid_statuses:
            raise PayrollReimbursementError(
                "One or more reimbursement statuses are invalid.",
                code="invalid_reimbursement_status",
                details={"statuses": sorted(invalid_statuses)},
            )

        query["status"] = {"$in": sorted(normalized_statuses)}

    normalized_types = {
        _normalize_type(item)
        for item in (reimbursement_types or [])
        if safe_str(item)
    }

    if normalized_types:
        query["type"] = {"$in": sorted(normalized_types)}

    normalized_period = optional_period(
        payroll_period,
        field_name="payroll_period",
    )

    if normalized_period:
        query["payroll_period"] = normalized_period

    normalized_payment_mode = normalize_key(payment_mode)

    if normalized_payment_mode:
        if normalized_payment_mode not in PAYMENT_MODES:
            raise PayrollReimbursementError(
                "payment_mode must be payroll or manual.",
                code="invalid_reimbursement_payment_mode",
            )

        query["payment_mode"] = normalized_payment_mode

    safe_limit = max(1, min(int(limit or 200), 1000))

    return list(
        db[REIMBURSEMENTS_COLLECTION]
        .find(query)
        .sort([
            ("created_at", -1),
            ("_id", -1),
        ])
        .limit(safe_limit)
    )


__all__ = [
    "PAYMENT_MODES",
    "PAYROLL_ELIGIBLE_STATUSES",
    "REIMBURSEMENT_STATUSES",
    "REIMBURSEMENT_TYPES",
    "TAX_TREATMENTS",
    "PayrollReimbursementError",
    "apply_payroll_reimbursement_payments",
    "approve_reimbursement",
    "cancel_reimbursement",
    "complete_hr_review",
    "create_reimbursement",
    "find_employee",
    "get_reimbursement",
    "list_reimbursements",
    "mark_manual_reimbursement_paid",
    "reject_reimbursement",
    "release_payroll_reimbursements",
    "reserve_payroll_reimbursements",
    "resolve_payroll_reimbursements",
    "revise_reimbursement_schedule",
    "submit_reimbursement",
    "summarize_payroll_reimbursements",
    "update_reimbursement_draft",
]