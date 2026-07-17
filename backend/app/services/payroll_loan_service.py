from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping

from bson import ObjectId
from pymongo import ReturnDocument


LOANS_ADVANCES_COLLECTION = "loans_advances"

LOAN_ADVANCE_TYPES = {
    "work_advance",
    "tour_advance",
    "personal_advance",
    "salary_advance",
    "employee_loan",
    "other_advance",
}

LOAN_ADVANCE_STATUSES = {
    "draft",
    "pending_approval",
    "approved",
    "disbursed",
    "recovering",
    "closed",
    "rejected",
    "cancelled",
}

PAYROLL_DEDUCTIBLE_STATUSES = {
    "active",       # Backward-compatible legacy status.
    "disbursed",
    "recovering",
}

FINAL_PAYROLL_STATUSES = {
    "locked",
    "disbursed",
}

MUTABLE_DRAFT_STATUSES = {
    "draft",
}

CANCELLABLE_STATUSES = {
    "draft",
    "pending_approval",
    "approved",
}

ZERO = Decimal("0")
MONEY_QUANTUM = Decimal("0.01")


class PayrollLoanError(ValueError):
    """Business-rule error for loans, advances, and payroll recoveries."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str = "payroll_loan_error",
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
            raise PayrollLoanError(
                f"{field_name} is required.",
                code="payroll_loan_field_required",
                details={"field": field_name},
            )
        return ZERO

    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise PayrollLoanError(
            f"{field_name} must be a valid number.",
            code="invalid_payroll_loan_amount",
            details={"field": field_name},
        ) from exc

    if not amount.is_finite():
        raise PayrollLoanError(
            f"{field_name} must be a finite number.",
            code="invalid_payroll_loan_amount",
            details={"field": field_name},
        )

    if minimum is not None and amount < minimum:
        raise PayrollLoanError(
            f"{field_name} must be at least {minimum}.",
            code="invalid_payroll_loan_amount",
            details={"field": field_name, "minimum": float(minimum)},
        )

    return amount.quantize(MONEY_QUANTUM)


def money_value(value: Decimal | int | float) -> int | float:
    amount = Decimal(str(value)).quantize(MONEY_QUANTUM)

    if amount == amount.to_integral_value():
        return int(amount)

    return float(amount)


def parse_date(value: Any, *, field_name: str) -> date | None:
    if value in (None, ""):
        return None

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    text = safe_str(value)

    try:
        return date.fromisoformat(text[:10])
    except ValueError as exc:
        raise PayrollLoanError(
            f"{field_name} must use YYYY-MM-DD format.",
            code="invalid_payroll_loan_date",
            details={"field": field_name},
        ) from exc


def normalize_period(value: Any, *, field_name: str) -> str:
    text = safe_str(value)

    if not text:
        raise PayrollLoanError(
            f"{field_name} is required.",
            code="payroll_period_required",
            details={"field": field_name},
        )

    try:
        parsed = datetime.strptime(text, "%Y-%m")
    except ValueError as exc:
        raise PayrollLoanError(
            f"{field_name} must use YYYY-MM format.",
            code="invalid_payroll_period",
            details={"field": field_name},
        ) from exc

    if parsed.year < 2000 or parsed.year > 2200:
        raise PayrollLoanError(
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


def get_loan_advance(
    db: Any,
    *,
    tenant_id: str,
    loan_advance_id: Any,
) -> dict[str, Any]:
    parsed_id = object_id(loan_advance_id)

    if not parsed_id:
        raise PayrollLoanError(
            "Invalid loan or advance identifier.",
            status_code=404,
            code="payroll_loan_not_found",
        )

    record = db[LOANS_ADVANCES_COLLECTION].find_one({
        "_id": parsed_id,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    })

    if not record:
        raise PayrollLoanError(
            "Loan or advance record was not found.",
            status_code=404,
            code="payroll_loan_not_found",
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
    normalized = normalize_key(value or "personal_advance")

    aliases = {
        "work": "work_advance",
        "tour": "tour_advance",
        "personal": "personal_advance",
        "salary": "salary_advance",
        "loan": "employee_loan",
        "employee": "employee_loan",
        "advance": "other_advance",
        "other": "other_advance",
    }
    normalized = aliases.get(normalized, normalized)

    if normalized not in LOAN_ADVANCE_TYPES:
        raise PayrollLoanError(
            "Unsupported loan or advance type.",
            code="invalid_payroll_loan_type",
            details={
                "type": normalized,
                "allowed_types": sorted(LOAN_ADVANCE_TYPES),
            },
        )

    return normalized


def _category_for_type(loan_type: str) -> str:
    return "loan" if loan_type == "employee_loan" else "advance"


def _default_label(loan_type: str) -> str:
    labels = {
        "work_advance": "Work Advance",
        "tour_advance": "Tour Advance",
        "personal_advance": "Personal Advance",
        "salary_advance": "Salary Advance",
        "employee_loan": "Employee Loan",
        "other_advance": "Other Advance",
    }
    return labels[loan_type]


def _normalize_custom_installments(
    value: Any,
) -> list[dict[str, Any]]:
    if value in (None, ""):
        return []

    if not isinstance(value, list):
        raise PayrollLoanError(
            "custom_installments must be a list.",
            code="invalid_custom_installments",
        )

    normalized: list[dict[str, Any]] = []
    seen_periods: set[str] = set()

    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            raise PayrollLoanError(
                f"custom_installments[{index}] must be an object.",
                code="invalid_custom_installment",
            )

        period_key = normalize_period(
            item.get("period_key") or item.get("period"),
            field_name=f"custom_installments[{index}].period_key",
        )

        if period_key in seen_periods:
            raise PayrollLoanError(
                f"Duplicate custom installment for {period_key}.",
                code="duplicate_custom_installment",
                details={"period_key": period_key},
            )

        amount = money_decimal(
            item.get("amount") or item.get("deduction_amount"),
            field_name=f"custom_installments[{index}].amount",
            minimum=ZERO,
        )

        status = normalize_key(item.get("status") or "scheduled")

        if status not in {"scheduled", "held", "cancelled"}:
            raise PayrollLoanError(
                f"Unsupported custom installment status: {status}.",
                code="invalid_custom_installment_status",
                details={"period_key": period_key},
            )

        normalized.append({
            "period_key": period_key,
            "amount": money_value(amount),
            "status": status,
            "note": safe_str(item.get("note")),
        })
        seen_periods.add(period_key)

    return sorted(normalized, key=lambda item: item["period_key"])


def _normalize_hold_periods(value: Any) -> list[str]:
    if value in (None, ""):
        return []

    if not isinstance(value, list):
        raise PayrollLoanError(
            "hold_periods must be a list.",
            code="invalid_hold_periods",
        )

    return sorted({
        normalize_period(item, field_name="hold_periods[]")
        for item in value
    })


def _financial_terms_from_payload(
    payload: Mapping[str, Any],
    *,
    existing: Mapping[str, Any] | None = None,
    require_amount: bool = True,
) -> dict[str, Any]:
    existing = existing or {}

    requested_amount = money_decimal(
        payload.get(
            "requested_amount",
            payload.get(
                "requestedAmount",
                payload.get("amount", existing.get("requested_amount")),
            ),
        ),
        field_name="requested_amount",
        required=require_amount,
        minimum=MONEY_QUANTUM if require_amount else ZERO,
    )

    approved_raw = payload.get(
        "approved_amount",
        payload.get("approvedAmount", existing.get("approved_amount")),
    )
    approved_amount = (
        money_decimal(
            approved_raw,
            field_name="approved_amount",
            minimum=MONEY_QUANTUM,
        )
        if approved_raw not in (None, "")
        else ZERO
    )

    interest_raw = payload.get(
        "interest_amount",
        payload.get("interestAmount", existing.get("interest_amount", 0)),
    )
    interest_amount = money_decimal(
        interest_raw,
        field_name="interest_amount",
        required=False,
        minimum=ZERO,
    )

    emi_raw = payload.get(
        "emi_amount",
        payload.get(
            "emiAmount",
            payload.get(
                "deduction_amount",
                payload.get(
                    "deductionAmount",
                    existing.get("emi_amount"),
                ),
            ),
        ),
    )
    emi_amount = (
        money_decimal(
            emi_raw,
            field_name="emi_amount",
            minimum=MONEY_QUANTUM,
        )
        if emi_raw not in (None, "")
        else ZERO
    )

    recovery_start_period = optional_period(
        payload.get(
            "recovery_start_period",
            payload.get(
                "recoveryStartPeriod",
                existing.get("recovery_start_period"),
            ),
        ),
        field_name="recovery_start_period",
    )
    recovery_end_period = optional_period(
        payload.get(
            "recovery_end_period",
            payload.get(
                "recoveryEndPeriod",
                existing.get("recovery_end_period"),
            ),
        ),
        field_name="recovery_end_period",
    )

    if (
        recovery_start_period
        and recovery_end_period
        and recovery_end_period < recovery_start_period
    ):
        raise PayrollLoanError(
            "recovery_end_period cannot be before recovery_start_period.",
            code="invalid_recovery_period_range",
        )

    custom_installments = _normalize_custom_installments(
        payload.get(
            "custom_installments",
            payload.get(
                "customInstallments",
                existing.get("custom_installments", []),
            ),
        )
    )
    hold_periods = _normalize_hold_periods(
        payload.get(
            "hold_periods",
            payload.get("holdPeriods", existing.get("hold_periods", [])),
        )
    )

    base_amount = approved_amount if approved_amount > ZERO else requested_amount
    recoverable_amount = base_amount + interest_amount

    if emi_amount > recoverable_amount and recoverable_amount > ZERO:
        raise PayrollLoanError(
            "emi_amount cannot exceed the total recoverable amount.",
            code="emi_exceeds_recoverable_amount",
        )

    return {
        "requested_amount": money_value(requested_amount),
        "approved_amount": money_value(approved_amount),
        "interest_amount": money_value(interest_amount),
        "recoverable_amount": money_value(recoverable_amount),
        "emi_amount": money_value(emi_amount),
        "deduction_amount": money_value(emi_amount),
        "recovery_start_period": recovery_start_period,
        "recovery_end_period": recovery_end_period,
        "custom_installments": custom_installments,
        "hold_periods": hold_periods,
    }


def create_loan_advance(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    payload: Mapping[str, Any],
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise PayrollLoanError(
            "Loan or advance payload must be an object.",
            code="invalid_payroll_loan_payload",
        )

    tenant_id = safe_str(tenant_id)

    if not tenant_id:
        raise PayrollLoanError(
            "tenant_id is required.",
            code="payroll_tenant_required",
        )

    employee = find_employee(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
    )

    if not employee:
        raise PayrollLoanError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    loan_type = _normalize_type(
        payload.get("type")
        or payload.get("loan_type")
        or payload.get("loanType")
    )
    terms = _financial_terms_from_payload(payload, require_amount=True)
    requested_amount = money_decimal(
        terms["requested_amount"],
        field_name="requested_amount",
        minimum=MONEY_QUANTUM,
    )

    record_id = ObjectId()
    now = now_utc()

    document = {
        "_id": record_id,
        "tenant_id": tenant_id,
        "employee_id": canonical_employee_id(employee),
        "employee_code": employee_code(employee),
        "employee_name": employee_name(employee),
        "user_id": safe_str(employee.get("user_id")),
        "type": loan_type,
        "loan_type": loan_type,
        "category": _category_for_type(loan_type),
        "label": safe_str(payload.get("label")) or _default_label(loan_type),
        "purpose": safe_str(payload.get("purpose")),
        "request_note": safe_str(
            payload.get("request_note") or payload.get("note")
        ),
        **terms,
        "remaining_balance": money_value(requested_amount),
        "recovered_amount": 0,
        "status": "draft",
        "workflow_stage": "draft",
        "approval": {},
        "disbursement": {},
        "recovery_history": [],
        "recovery_term_revisions": [],
        "workflow_history": [
            _history_entry(
                action="create",
                from_status="not_created",
                to_status="draft",
                actor_id=actor_id,
                actor_name=actor_name,
                note=safe_str(payload.get("note") or "Loan or advance draft created."),
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

    db[LOANS_ADVANCES_COLLECTION].insert_one(document)
    return document


def update_loan_advance_draft(
    db: Any,
    *,
    tenant_id: str,
    loan_advance_id: Any,
    payload: Mapping[str, Any],
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    record = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )
    status = normalize_key(record.get("status"))

    if status not in MUTABLE_DRAFT_STATUSES:
        raise PayrollLoanError(
            "Only a Draft loan or advance can be edited directly.",
            status_code=409,
            code="payroll_loan_not_editable",
            details={"status": status},
        )

    loan_type = _normalize_type(
        payload.get("type")
        or payload.get("loan_type")
        or record.get("type")
    )
    terms = _financial_terms_from_payload(
        payload,
        existing=record,
        require_amount=True,
    )
    requested_amount = money_decimal(
        terms["requested_amount"],
        field_name="requested_amount",
        minimum=MONEY_QUANTUM,
    )

    now = now_utc()
    updates = {
        "type": loan_type,
        "loan_type": loan_type,
        "category": _category_for_type(loan_type),
        "label": safe_str(payload.get("label"))
        or safe_str(record.get("label"))
        or _default_label(loan_type),
        "purpose": safe_str(
            payload.get("purpose")
            if "purpose" in payload
            else record.get("purpose")
        ),
        "request_note": safe_str(
            payload.get("request_note")
            if "request_note" in payload
            else payload.get("note")
            if "note" in payload
            else record.get("request_note")
        ),
        **terms,
        "remaining_balance": money_value(requested_amount),
        "recovered_amount": 0,
        "updated_at": now,
        "updated_by": safe_str(actor_id),
        "updated_by_name": safe_str(actor_name),
    }

    result = db[LOANS_ADVANCES_COLLECTION].find_one_and_update(
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
        raise PayrollLoanError(
            "The loan or advance changed while it was being edited.",
            status_code=409,
            code="payroll_loan_concurrent_update",
        )

    return result


def submit_loan_advance(
    db: Any,
    *,
    tenant_id: str,
    loan_advance_id: Any,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
) -> dict[str, Any]:
    record = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )

    if normalize_key(record.get("status")) != "draft":
        raise PayrollLoanError(
            "Only a Draft loan or advance can be submitted.",
            status_code=409,
            code="invalid_payroll_loan_transition",
        )

    requested_amount = money_decimal(
        record.get("requested_amount"),
        field_name="requested_amount",
        minimum=MONEY_QUANTUM,
    )

    if requested_amount <= ZERO:
        raise PayrollLoanError(
            "A positive requested amount is required before submission.",
            code="requested_amount_required",
        )

    now = now_utc()

    result = db[LOANS_ADVANCES_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": "draft",
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "pending_approval",
                "workflow_stage": "pending_approval",
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
                    to_status="pending_approval",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note or "Submitted for Finance approval.",
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollLoanError(
            "The loan or advance status changed before submission completed.",
            status_code=409,
            code="payroll_loan_concurrent_update",
        )

    return result


def approve_loan_advance(
    db: Any,
    *,
    tenant_id: str,
    loan_advance_id: Any,
    approved_amount: Any,
    emi_amount: Any,
    recovery_start_period: Any,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
    interest_amount: Any = 0,
    recovery_end_period: Any = "",
    custom_installments: Any = None,
    hold_periods: Any = None,
) -> dict[str, Any]:
    record = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )

    if normalize_key(record.get("status")) != "pending_approval":
        raise PayrollLoanError(
            "Only a Pending Approval loan or advance can be approved.",
            status_code=409,
            code="invalid_payroll_loan_transition",
        )

    payload = {
        "requested_amount": record.get("requested_amount"),
        "approved_amount": approved_amount,
        "interest_amount": interest_amount,
        "emi_amount": emi_amount,
        "recovery_start_period": recovery_start_period,
        "recovery_end_period": recovery_end_period,
        "custom_installments": (
            custom_installments
            if custom_installments is not None
            else record.get("custom_installments", [])
        ),
        "hold_periods": (
            hold_periods
            if hold_periods is not None
            else record.get("hold_periods", [])
        ),
    }
    terms = _financial_terms_from_payload(
        payload,
        existing=record,
        require_amount=True,
    )
    approved = money_decimal(
        terms["approved_amount"],
        field_name="approved_amount",
        minimum=MONEY_QUANTUM,
    )
    emi = money_decimal(
        terms["emi_amount"],
        field_name="emi_amount",
        minimum=MONEY_QUANTUM,
    )

    if not terms["recovery_start_period"]:
        raise PayrollLoanError(
            "recovery_start_period is required before approval.",
            code="recovery_start_period_required",
        )

    recoverable = money_decimal(
        terms["recoverable_amount"],
        field_name="recoverable_amount",
        minimum=MONEY_QUANTUM,
    )

    if emi > recoverable:
        raise PayrollLoanError(
            "EMI cannot exceed the recoverable amount.",
            code="emi_exceeds_recoverable_amount",
        )

    now = now_utc()

    result = db[LOANS_ADVANCES_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": "pending_approval",
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                **terms,
                "remaining_balance": money_value(recoverable),
                "recovered_amount": 0,
                "status": "approved",
                "workflow_stage": "approved",
                "approval": {
                    "approved_amount": money_value(approved),
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
                    action="approve",
                    from_status="pending_approval",
                    to_status="approved",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note or "Loan or advance approved.",
                    metadata={
                        "approved_amount": money_value(approved),
                        "emi_amount": money_value(emi),
                        "recovery_start_period": terms["recovery_start_period"],
                    },
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollLoanError(
            "The loan or advance status changed before approval completed.",
            status_code=409,
            code="payroll_loan_concurrent_update",
        )

    return result


def reject_loan_advance(
    db: Any,
    *,
    tenant_id: str,
    loan_advance_id: Any,
    reason: str,
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    reason = safe_str(reason)

    if not reason:
        raise PayrollLoanError(
            "A rejection reason is required.",
            code="payroll_loan_rejection_reason_required",
        )

    record = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )

    if normalize_key(record.get("status")) != "pending_approval":
        raise PayrollLoanError(
            "Only a Pending Approval loan or advance can be rejected.",
            status_code=409,
            code="invalid_payroll_loan_transition",
        )

    now = now_utc()

    result = db[LOANS_ADVANCES_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": "pending_approval",
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "rejected",
                "workflow_stage": "rejected",
                "rejection": {
                    "reason": reason,
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
                    from_status="pending_approval",
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
        raise PayrollLoanError(
            "The loan or advance status changed before rejection completed.",
            status_code=409,
            code="payroll_loan_concurrent_update",
        )

    return result


def disburse_loan_advance(
    db: Any,
    *,
    tenant_id: str,
    loan_advance_id: Any,
    transfer_date: Any,
    transfer_mode: str,
    transaction_reference: str = "",
    bank_reference: str = "",
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
) -> dict[str, Any]:
    record = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )

    if normalize_key(record.get("status")) != "approved":
        raise PayrollLoanError(
            "Only an Approved loan or advance can be disbursed.",
            status_code=409,
            code="invalid_payroll_loan_transition",
        )

    disbursement_date = parse_date(
        transfer_date,
        field_name="transfer_date",
    )
    mode = safe_str(transfer_mode).upper()

    if not disbursement_date:
        raise PayrollLoanError(
            "transfer_date is required.",
            code="transfer_date_required",
        )

    if not mode:
        raise PayrollLoanError(
            "transfer_mode is required.",
            code="transfer_mode_required",
        )

    if not safe_str(record.get("recovery_start_period")):
        raise PayrollLoanError(
            "The approved record does not contain a recovery_start_period.",
            code="recovery_start_period_required",
        )

    recoverable = money_decimal(
        record.get("recoverable_amount"),
        field_name="recoverable_amount",
        minimum=MONEY_QUANTUM,
    )
    now = now_utc()

    result = db[LOANS_ADVANCES_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": "approved",
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "disbursed",
                "workflow_stage": "disbursed",
                "remaining_balance": money_value(recoverable),
                "recovered_amount": 0,
                "disbursement": {
                    "transfer_date": disbursement_date.isoformat(),
                    "transfer_mode": mode,
                    "transaction_reference": safe_str(transaction_reference),
                    "bank_reference": safe_str(bank_reference),
                    "disbursed_by": safe_str(actor_id),
                    "disbursed_by_name": safe_str(actor_name),
                    "disbursed_at": now,
                    "note": safe_str(note),
                },
                "disbursed_at": now,
                "disbursed_by": safe_str(actor_id),
                "disbursed_by_name": safe_str(actor_name),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "workflow_history": _history_entry(
                    action="disburse",
                    from_status="approved",
                    to_status="disbursed",
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note or "Loan or advance disbursed.",
                    metadata={
                        "transfer_date": disbursement_date.isoformat(),
                        "transfer_mode": mode,
                        "transaction_reference": safe_str(transaction_reference),
                    },
                )
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollLoanError(
            "The loan or advance status changed before disbursement completed.",
            status_code=409,
            code="payroll_loan_concurrent_update",
        )

    return result


def cancel_loan_advance(
    db: Any,
    *,
    tenant_id: str,
    loan_advance_id: Any,
    reason: str,
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    record = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )
    status = normalize_key(record.get("status"))
    reason = safe_str(reason)

    if status not in CANCELLABLE_STATUSES:
        raise PayrollLoanError(
            "This loan or advance can no longer be cancelled.",
            status_code=409,
            code="payroll_loan_not_cancellable",
            details={"status": status},
        )

    if not reason:
        raise PayrollLoanError(
            "A cancellation reason is required.",
            code="payroll_loan_cancellation_reason_required",
        )

    now = now_utc()

    result = db[LOANS_ADVANCES_COLLECTION].find_one_and_update(
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
        raise PayrollLoanError(
            "The loan or advance status changed before cancellation completed.",
            status_code=409,
            code="payroll_loan_concurrent_update",
        )

    return result


def _locked_reference_periods(
    db: Any,
    *,
    tenant_id: str,
    loan_advance_id: str,
) -> list[str]:
    rows = db.payslips.find({
        "tenant_id": tenant_id,
        "status": {"$in": list(FINAL_PAYROLL_STATUSES)},
        "is_deleted": {"$ne": True},
        "advance_details": {
            "$elemMatch": {
                "reference_id": loan_advance_id,
            }
        },
    }, {
        "period_key": 1,
    })

    return sorted({
        safe_str(row.get("period_key"))
        for row in rows
        if safe_str(row.get("period_key"))
    })


def revise_recovery_terms(
    db: Any,
    *,
    tenant_id: str,
    loan_advance_id: Any,
    effective_from_period: Any,
    emi_amount: Any,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
    recovery_end_period: Any = "",
    custom_installments: Any = None,
    hold_periods: Any = None,
) -> dict[str, Any]:
    record = get_loan_advance(
        db,
        tenant_id=tenant_id,
        loan_advance_id=loan_advance_id,
    )
    status = normalize_key(record.get("status"))

    if status not in PAYROLL_DEDUCTIBLE_STATUSES:
        raise PayrollLoanError(
            "Recovery terms can be revised only after disbursement and before closure.",
            status_code=409,
            code="payroll_loan_terms_not_revisable",
            details={"status": status},
        )

    effective_period = normalize_period(
        effective_from_period,
        field_name="effective_from_period",
    )
    locked_periods = _locked_reference_periods(
        db,
        tenant_id=tenant_id,
        loan_advance_id=safe_str(record.get("_id")),
    )

    if locked_periods and effective_period <= locked_periods[-1]:
        raise PayrollLoanError(
            "Recovery terms cannot be changed for a payroll period that is already locked or disbursed.",
            status_code=409,
            code="locked_payroll_deduction_immutable",
            details={
                "latest_locked_period": locked_periods[-1],
                "effective_from_period": effective_period,
            },
        )

    new_emi = money_decimal(
        emi_amount,
        field_name="emi_amount",
        minimum=MONEY_QUANTUM,
    )
    remaining = money_decimal(
        record.get("remaining_balance"),
        field_name="remaining_balance",
        minimum=ZERO,
    )

    if remaining <= ZERO:
        raise PayrollLoanError(
            "No remaining balance is available for recovery.",
            status_code=409,
            code="payroll_loan_already_recovered",
        )

    if new_emi > remaining:
        raise PayrollLoanError(
            "The revised EMI cannot exceed the current remaining balance.",
            code="emi_exceeds_remaining_balance",
        )

    end_period = optional_period(
        recovery_end_period,
        field_name="recovery_end_period",
    )
    if end_period and end_period < effective_period:
        raise PayrollLoanError(
            "recovery_end_period cannot be before effective_from_period.",
            code="invalid_recovery_period_range",
        )

    normalized_installments = (
        _normalize_custom_installments(custom_installments)
        if custom_installments is not None
        else []
    )
    normalized_holds = (
        _normalize_hold_periods(hold_periods)
        if hold_periods is not None
        else []
    )

    revision = {
        "effective_from_period": effective_period,
        "emi_amount": money_value(new_emi),
        "deduction_amount": money_value(new_emi),
        "recovery_end_period": end_period,
        "custom_installments": normalized_installments,
        "hold_periods": normalized_holds,
        "note": safe_str(note),
        "created_at": now_utc(),
        "created_by": safe_str(actor_id),
        "created_by_name": safe_str(actor_name),
    }

    existing_revisions = list(record.get("recovery_term_revisions") or [])

    if any(
        safe_str(item.get("effective_from_period")) == effective_period
        for item in existing_revisions
    ):
        raise PayrollLoanError(
            f"A recovery-term revision already exists for {effective_period}.",
            status_code=409,
            code="duplicate_recovery_term_revision",
        )

    result = db[LOANS_ADVANCES_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "status": record.get("status"),
            "is_deleted": {"$ne": True},
        },
        {
            "$push": {
                "recovery_term_revisions": revision,
                "workflow_history": _history_entry(
                    action="revise_recovery_terms",
                    from_status=status,
                    to_status=status,
                    actor_id=actor_id,
                    actor_name=actor_name,
                    note=note or f"Recovery terms revised from {effective_period}.",
                    metadata={
                        "effective_from_period": effective_period,
                        "emi_amount": money_value(new_emi),
                    },
                ),
            },
            "$set": {
                "updated_at": now_utc(),
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollLoanError(
            "The recovery terms changed before the revision completed.",
            status_code=409,
            code="payroll_loan_concurrent_update",
        )

    return result


def _effective_recovery_terms(
    record: Mapping[str, Any],
    period_key: str,
) -> dict[str, Any]:
    terms = {
        "emi_amount": record.get(
            "emi_amount",
            record.get("deduction_amount", 0),
        ),
        "recovery_start_period": safe_str(record.get("recovery_start_period")),
        "recovery_end_period": safe_str(record.get("recovery_end_period")),
        "custom_installments": list(record.get("custom_installments") or []),
        "hold_periods": list(record.get("hold_periods") or []),
    }

    revisions = sorted(
        [
            item
            for item in (record.get("recovery_term_revisions") or [])
            if safe_str(item.get("effective_from_period"))
            and safe_str(item.get("effective_from_period")) <= period_key
        ],
        key=lambda item: safe_str(item.get("effective_from_period")),
    )

    if revisions:
        latest = revisions[-1]
        terms.update({
            "emi_amount": latest.get(
                "emi_amount",
                latest.get("deduction_amount", terms["emi_amount"]),
            ),
            "recovery_end_period": safe_str(
                latest.get("recovery_end_period")
                or terms["recovery_end_period"]
            ),
            "custom_installments": list(
                latest.get("custom_installments")
                if "custom_installments" in latest
                else terms["custom_installments"]
            ),
            "hold_periods": list(
                latest.get("hold_periods")
                if "hold_periods" in latest
                else terms["hold_periods"]
            ),
        })

    return terms


def _deduction_for_period(
    record: Mapping[str, Any],
    period_key: str,
) -> Decimal:
    terms = _effective_recovery_terms(record, period_key)
    start_period = safe_str(terms.get("recovery_start_period"))
    end_period = safe_str(terms.get("recovery_end_period"))

    if start_period and period_key < start_period:
        return ZERO

    if end_period and period_key > end_period:
        return ZERO

    if period_key in {
        safe_str(item)
        for item in (terms.get("hold_periods") or [])
    }:
        return ZERO

    custom_match = next(
        (
            item
            for item in (terms.get("custom_installments") or [])
            if safe_str(item.get("period_key")) == period_key
        ),
        None,
    )

    if custom_match:
        custom_status = normalize_key(custom_match.get("status") or "scheduled")

        if custom_status in {"held", "cancelled"}:
            return ZERO

        amount = money_decimal(
            custom_match.get("amount"),
            field_name="custom_installment.amount",
            minimum=ZERO,
        )
    else:
        amount = money_decimal(
            terms.get("emi_amount"),
            field_name="emi_amount",
            minimum=ZERO,
        )

    remaining = money_decimal(
        record.get("remaining_balance"),
        field_name="remaining_balance",
        minimum=ZERO,
    )

    return min(amount, remaining)


def _recovery_already_applied(
    record: Mapping[str, Any],
    *,
    run_id: str,
) -> bool:
    return any(
        safe_str(entry.get("run_id")) == run_id
        and normalize_key(entry.get("status") or "applied") == "applied"
        for entry in (record.get("recovery_history") or [])
    )


def resolve_payroll_deductions(
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
        raise PayrollLoanError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    employee_id = canonical_employee_id(employee)
    identifiers = {
        employee_id,
        employee_code(employee),
        safe_str(employee.get("official_email")).lower(),
        safe_str(employee.get("email")).lower(),
    }
    identifiers.discard("")

    records = db[LOANS_ADVANCES_COLLECTION].find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$in": list(PAYROLL_DEDUCTIBLE_STATUSES)},
        "$or": [
            {"employee_id": employee_id},
            {"employee_id": {"$in": list(identifiers)}},
            {"employee_code": {"$in": list(identifiers)}},
        ],
    })

    deductions: list[dict[str, Any]] = []
    normalized_run_id = safe_str(run_id)

    for record in records:
        if normalized_run_id and _recovery_already_applied(
            record,
            run_id=normalized_run_id,
        ):
            continue

        remaining = money_decimal(
            record.get("remaining_balance"),
            field_name="remaining_balance",
            minimum=ZERO,
        )

        if remaining <= ZERO:
            continue

        amount = _deduction_for_period(record, period)

        if amount <= ZERO:
            continue

        loan_type = _normalize_type(
            record.get("type")
            or record.get("loan_type")
            or "other_advance"
        )

        deductions.append({
            "id": safe_str(record.get("_id")),
            "_id": safe_str(record.get("_id")),
            "reference_id": safe_str(record.get("_id")),
            "employee_id": employee_id,
            "employee_code": employee_code(employee),
            "type": loan_type,
            "code": loan_type,
            "category": safe_str(record.get("category"))
            or _category_for_type(loan_type),
            "label": safe_str(record.get("label"))
            or _default_label(loan_type),
            "status": normalize_key(record.get("status")),
            "advance_amount": record.get(
                "approved_amount",
                record.get("requested_amount", 0),
            ),
            "deduction_amount": money_value(amount),
            "emi_amount": money_value(amount),
            "remaining_balance": money_value(remaining),
            "remaining_balance_after_deduction": money_value(
                max(ZERO, remaining - amount)
            ),
            "recovery_start_period": safe_str(
                record.get("recovery_start_period")
            ),
            "period_key": period,
            "date": safe_str(
                (record.get("disbursement") or {}).get("transfer_date")
                or record.get("disbursed_at")
            )[:10],
            "bills_received": safe_str(record.get("bills_received")),
        })

    return deductions


def list_loan_advances(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any = "",
    statuses: Iterable[Any] | None = None,
    loan_types: Iterable[Any] | None = None,
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
            raise PayrollLoanError(
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
        invalid_statuses = normalized_statuses - (
            LOAN_ADVANCE_STATUSES | {"active"}
        )
        if invalid_statuses:
            raise PayrollLoanError(
                "One or more loan statuses are invalid.",
                code="invalid_payroll_loan_status",
                details={"statuses": sorted(invalid_statuses)},
            )
        query["status"] = {"$in": sorted(normalized_statuses)}

    normalized_types = {
        _normalize_type(item)
        for item in (loan_types or [])
        if safe_str(item)
    }
    if normalized_types:
        query["type"] = {"$in": sorted(normalized_types)}

    safe_limit = max(1, min(int(limit or 200), 1000))

    return list(
        db[LOANS_ADVANCES_COLLECTION]
        .find(query)
        .sort([
            ("created_at", -1),
            ("_id", -1),
        ])
        .limit(safe_limit)
    )


def apply_payroll_recoveries(
    db: Any,
    *,
    tenant_id: str,
    run_id: Any,
    period_key: Any,
    payslips: Iterable[Mapping[str, Any]],
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    normalized_run_id = safe_str(run_id)

    if not normalized_run_id:
        raise PayrollLoanError(
            "run_id is required.",
            code="payroll_run_id_required",
        )

    period = normalize_period(
        period_key,
        field_name="period_key",
    )
    run = db.payroll_runs.find_one({
        "tenant_id": tenant_id,
        "$or": [
            {"_id": object_id(normalized_run_id)}
            if object_id(normalized_run_id)
            else {"_id": None},
            {"_id": normalized_run_id},
            {"run_id": normalized_run_id},
        ],
        "is_deleted": {"$ne": True},
    })

    if not run:
        raise PayrollLoanError(
            "Payroll run was not found.",
            status_code=404,
            code="payroll_run_not_found",
        )

    if normalize_key(run.get("status")) != "disbursed":
        raise PayrollLoanError(
            "Loan and advance balances can be updated only after the payroll run is marked Disbursed.",
            status_code=409,
            code="payroll_run_not_disbursed",
            details={"status": normalize_key(run.get("status"))},
        )

    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for payslip in payslips:
        employee_id = safe_str(payslip.get("employee_id"))
        advance_details = list(payslip.get("advance_details") or [])

        for detail in advance_details:
            reference_id = safe_str(
                detail.get("reference_id")
                or detail.get("id")
                or detail.get("_id")
            )
            deduction = money_decimal(
                detail.get(
                    "deduction_amount",
                    detail.get("emi_amount", 0),
                ),
                field_name="advance_details.deduction_amount",
                required=False,
                minimum=ZERO,
            )

            if not reference_id or deduction <= ZERO:
                continue

            try:
                record = get_loan_advance(
                    db,
                    tenant_id=tenant_id,
                    loan_advance_id=reference_id,
                )

                if _recovery_already_applied(
                    record,
                    run_id=normalized_run_id,
                ):
                    skipped.append({
                        "loan_advance_id": reference_id,
                        "employee_id": employee_id,
                        "reason": "already_applied",
                    })
                    continue

                current_remaining = money_decimal(
                    record.get("remaining_balance"),
                    field_name="remaining_balance",
                    minimum=ZERO,
                )
                current_recovered = money_decimal(
                    record.get("recovered_amount", 0),
                    field_name="recovered_amount",
                    required=False,
                    minimum=ZERO,
                )

                if current_remaining <= ZERO:
                    skipped.append({
                        "loan_advance_id": reference_id,
                        "employee_id": employee_id,
                        "reason": "already_closed",
                    })
                    continue

                applied_amount = min(deduction, current_remaining)
                remaining_after = max(ZERO, current_remaining - applied_amount)
                recovered_after = current_recovered + applied_amount
                status_after = (
                    "closed" if remaining_after == ZERO else "recovering"
                )
                recovery_entry = {
                    "run_id": normalized_run_id,
                    "period_key": period,
                    "payslip_id": safe_str(payslip.get("_id")),
                    "employee_id": employee_id,
                    "deduction_amount": money_value(applied_amount),
                    "balance_before": money_value(current_remaining),
                    "balance_after": money_value(remaining_after),
                    "status": "applied",
                    "applied_at": now_utc(),
                    "applied_by": safe_str(actor_id),
                    "applied_by_name": safe_str(actor_name),
                }

                result = db[LOANS_ADVANCES_COLLECTION].find_one_and_update(
                    {
                        "_id": record["_id"],
                        "tenant_id": tenant_id,
                        "remaining_balance": record.get("remaining_balance"),
                        "is_deleted": {"$ne": True},
                        "recovery_history": {
                            "$not": {
                                "$elemMatch": {
                                    "run_id": normalized_run_id,
                                    "status": "applied",
                                }
                            }
                        },
                    },
                    {
                        "$set": {
                            "remaining_balance": money_value(remaining_after),
                            "recovered_amount": money_value(recovered_after),
                            "status": status_after,
                            "workflow_stage": status_after,
                            "last_recovery_period": period,
                            "last_recovery_at": now_utc(),
                            "updated_at": now_utc(),
                            "updated_by": safe_str(actor_id),
                            "updated_by_name": safe_str(actor_name),
                        },
                        "$push": {
                            "recovery_history": recovery_entry,
                            "workflow_history": _history_entry(
                                action="apply_payroll_recovery",
                                from_status=normalize_key(record.get("status")),
                                to_status=status_after,
                                actor_id=actor_id,
                                actor_name=actor_name,
                                note=(
                                    f"Payroll recovery applied for {period}."
                                ),
                                metadata={
                                    "run_id": normalized_run_id,
                                    "deduction_amount": money_value(applied_amount),
                                    "balance_after": money_value(remaining_after),
                                },
                            ),
                        },
                    },
                    return_document=ReturnDocument.AFTER,
                )

                if not result:
                    raise PayrollLoanError(
                        "The loan balance changed before recovery could be applied.",
                        status_code=409,
                        code="payroll_loan_recovery_concurrent_update",
                    )

                applied.append({
                    "loan_advance_id": reference_id,
                    "employee_id": employee_id,
                    "deduction_amount": money_value(applied_amount),
                    "remaining_balance": money_value(remaining_after),
                    "status": status_after,
                })
            except PayrollLoanError as exc:
                failures.append({
                    "loan_advance_id": reference_id,
                    "employee_id": employee_id,
                    "message": exc.message,
                    "code": exc.code,
                    "details": exc.details,
                })

    return {
        "run_id": normalized_run_id,
        "period_key": period,
        "applied": applied,
        "skipped": skipped,
        "failures": failures,
        "totals": {
            "recoveries_applied": len(applied),
            "recoveries_skipped": len(skipped),
            "recoveries_failed": len(failures),
            "amount_recovered": money_value(
                sum(
                    Decimal(str(item["deduction_amount"]))
                    for item in applied
                )
            ),
        },
    }


def build_payslip_advance_rows(
    advance_details: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    details = list(advance_details or [])
    by_type = {
        normalize_key(
            item.get("type")
            or item.get("code")
            or item.get("label")
        ): item
        for item in details
    }

    def row(label: str, *keys: str) -> dict[str, Any]:
        match: Mapping[str, Any] = {}

        for key in keys:
            candidate = by_type.get(normalize_key(key))
            if candidate:
                match = candidate
                break

        return {
            "label": label,
            "date": safe_str(match.get("date")),
            "balance": match.get("remaining_balance", ""),
            "amount": match.get(
                "advance_amount",
                match.get("approved_amount", ""),
            ),
            "deduction_amount": match.get(
                "deduction_amount",
                match.get("emi_amount", 0),
            ),
            "bills_received": safe_str(match.get("bills_received")),
            "pending_balance": match.get(
                "remaining_balance_after_deduction",
                match.get("remaining_balance", ""),
            ),
            "reference_id": safe_str(
                match.get("reference_id")
                or match.get("id")
                or match.get("_id")
            ),
        }

    return [
        row("Work Advance", "work_advance", "work"),
        row("Tour Advance", "tour_advance", "tour"),
        row("Personal Advance", "personal_advance", "personal"),
    ]


__all__ = [
    "LOAN_ADVANCE_STATUSES",
    "LOAN_ADVANCE_TYPES",
    "PAYROLL_DEDUCTIBLE_STATUSES",
    "PayrollLoanError",
    "apply_payroll_recoveries",
    "approve_loan_advance",
    "build_payslip_advance_rows",
    "cancel_loan_advance",
    "create_loan_advance",
    "disburse_loan_advance",
    "find_employee",
    "get_loan_advance",
    "list_loan_advances",
    "reject_loan_advance",
    "resolve_payroll_deductions",
    "revise_recovery_terms",
    "submit_loan_advance",
    "update_loan_advance_draft",
]