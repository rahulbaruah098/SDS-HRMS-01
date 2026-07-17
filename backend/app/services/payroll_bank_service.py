from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping, Sequence

from bson import ObjectId
from pymongo import ReturnDocument


BANK_DETAILS_COLLECTION = "bank_details"
BANK_EXPORTS_COLLECTION = "payroll_bank_exports"

BANK_ACCOUNT_TYPES = {
    "salary",
    "savings",
    "current",
    "overdraft",
    "nre",
    "nro",
}

BANK_DETAIL_STATUSES = {
    "active",
    "inactive",
}

BANK_VERIFICATION_STATUSES = {
    "pending_verification",
    "verified",
    "rejected",
}

BANK_PAYMENT_METHODS = {
    "neft",
    "rtgs",
    "imps",
    "bank_transfer",
}

BANK_EXPORTABLE_PAYROLL_STATUSES = {
    "locked",
    "disbursed",
}

BANK_SNAPSHOT_PREPARATION_STATUSES = {
    "finance_approved",
    "locked",
    "disbursed",
}

FINAL_PAYROLL_STATUSES = {
    "locked",
    "disbursed",
}

DEFAULT_EXPORT_COLUMNS = (
    ("transaction_reference", "Transaction Reference"),
    ("beneficiary_name", "Beneficiary Name"),
    ("beneficiary_account_number", "Beneficiary Account Number"),
    ("ifsc_code", "IFSC Code"),
    ("bank_name", "Bank Name"),
    ("branch_name", "Branch Name"),
    ("account_type", "Account Type"),
    ("amount", "Amount"),
    ("payment_method", "Payment Method"),
    ("narration", "Narration"),
    ("employee_code", "Employee Code"),
    ("employee_id", "Employee ID"),
    ("period_key", "Payroll Period"),
)

IFSC_PATTERN = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
ACCOUNT_NUMBER_PATTERN = re.compile(r"^[A-Z0-9]{6,34}$")
BENEFICIARY_CODE_PATTERN = re.compile(r"^[A-Z0-9._-]{1,40}$")

ZERO = Decimal("0")
MONEY_QUANTUM = Decimal("0.01")


class PayrollBankError(ValueError):
    """Business-rule error for payroll bank details and disbursement files."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str = "payroll_bank_error",
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
            raise PayrollBankError(
                f"{field_name} is required.",
                code="payroll_bank_field_required",
                details={"field": field_name},
            )
        return ZERO

    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise PayrollBankError(
            f"{field_name} must be a valid number.",
            code="invalid_payroll_bank_amount",
            details={"field": field_name},
        ) from exc

    if not amount.is_finite():
        raise PayrollBankError(
            f"{field_name} must be a finite number.",
            code="invalid_payroll_bank_amount",
            details={"field": field_name},
        )

    if minimum is not None and amount < minimum:
        raise PayrollBankError(
            f"{field_name} must be at least {minimum}.",
            code="invalid_payroll_bank_amount",
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
    required: bool = False,
) -> date | None:
    if value in (None, ""):
        if required:
            raise PayrollBankError(
                f"{field_name} is required.",
                code="payroll_bank_date_required",
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
        raise PayrollBankError(
            f"{field_name} must use YYYY-MM-DD format.",
            code="invalid_payroll_bank_date",
            details={"field": field_name},
        ) from exc


def normalize_period(value: Any, *, field_name: str = "period_key") -> str:
    text = safe_str(value)

    if not text:
        raise PayrollBankError(
            f"{field_name} is required.",
            code="payroll_period_required",
            details={"field": field_name},
        )

    try:
        parsed = datetime.strptime(text, "%Y-%m")
    except ValueError as exc:
        raise PayrollBankError(
            f"{field_name} must use YYYY-MM format.",
            code="invalid_payroll_period",
            details={"field": field_name},
        ) from exc

    if parsed.year < 2000 or parsed.year > 2200:
        raise PayrollBankError(
            f"{field_name} year must be between 2000 and 2200.",
            code="invalid_payroll_period",
            details={"field": field_name},
        )

    return f"{parsed.year:04d}-{parsed.month:02d}"


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


def _find_payroll_run(
    db: Any,
    *,
    tenant_id: str,
    run_id: Any,
) -> dict[str, Any] | None:
    normalized_run_id = safe_str(run_id)
    alternatives: list[dict[str, Any]] = [
        {"_id": normalized_run_id},
        {"run_id": normalized_run_id},
    ]
    parsed_id = object_id(normalized_run_id)

    if parsed_id:
        alternatives.insert(0, {"_id": parsed_id})

    return db.payroll_runs.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": alternatives,
    })


def _normalise_account_number(value: Any) -> str:
    return re.sub(r"[\s-]+", "", safe_str(value)).upper()


def _normalise_ifsc(value: Any) -> str:
    return re.sub(r"\s+", "", safe_str(value)).upper()


def mask_account_number(value: Any) -> str:
    account_number = _normalise_account_number(value)

    if not account_number:
        return ""

    if len(account_number) <= 4:
        return "*" * len(account_number)

    return f"{'*' * (len(account_number) - 4)}{account_number[-4:]}"


def account_fingerprint(
    *,
    tenant_id: str,
    account_number: Any,
) -> str:
    normalized = _normalise_account_number(account_number)

    if not normalized:
        return ""

    payload = f"{safe_str(tenant_id)}:{normalized}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _normalize_account_type(value: Any) -> str:
    normalized = normalize_key(value or "salary")

    aliases = {
        "sal": "salary",
        "saving": "savings",
        "sb": "savings",
        "ca": "current",
        "od": "overdraft",
    }
    normalized = aliases.get(normalized, normalized)

    if normalized not in BANK_ACCOUNT_TYPES:
        raise PayrollBankError(
            "Unsupported bank account type.",
            code="invalid_bank_account_type",
            details={
                "account_type": normalized,
                "allowed_types": sorted(BANK_ACCOUNT_TYPES),
            },
        )

    return normalized


def _normalize_payment_method(value: Any) -> str:
    normalized = normalize_key(value or "neft")

    aliases = {
        "bank": "bank_transfer",
        "transfer": "bank_transfer",
        "banktransfer": "bank_transfer",
    }
    normalized = aliases.get(normalized, normalized)

    if normalized not in BANK_PAYMENT_METHODS:
        raise PayrollBankError(
            "Unsupported bank payment method.",
            code="invalid_bank_payment_method",
            details={
                "payment_method": normalized,
                "allowed_methods": sorted(BANK_PAYMENT_METHODS),
            },
        )

    return normalized


def normalize_bank_details_payload(
    payload: Mapping[str, Any],
    *,
    tenant_id: str,
    employee: Mapping[str, Any],
    existing: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise PayrollBankError(
            "Bank details payload must be an object.",
            code="invalid_bank_details_payload",
        )

    existing = existing or {}

    account_holder_name = safe_str(
        payload.get(
            "account_holder_name",
            payload.get(
                "accountHolderName",
                existing.get("account_holder_name") or employee_name(employee),
            ),
        )
    )
    account_number = _normalise_account_number(
        payload.get(
            "account_number",
            payload.get(
                "accountNumber",
                existing.get("account_number"),
            ),
        )
    )
    ifsc_code = _normalise_ifsc(
        payload.get(
            "ifsc_code",
            payload.get(
                "ifscCode",
                payload.get("ifsc", existing.get("ifsc_code")),
            ),
        )
    )
    bank_name = safe_str(
        payload.get(
            "bank_name",
            payload.get("bankName", existing.get("bank_name")),
        )
    )
    branch_name = safe_str(
        payload.get(
            "branch_name",
            payload.get("branchName", existing.get("branch_name")),
        )
    )
    account_type = _normalize_account_type(
        payload.get(
            "account_type",
            payload.get("accountType", existing.get("account_type") or "salary"),
        )
    )
    payment_method = _normalize_payment_method(
        payload.get(
            "payment_method",
            payload.get(
                "paymentMethod",
                existing.get("payment_method") or "neft",
            ),
        )
    )
    beneficiary_code = safe_str(
        payload.get(
            "beneficiary_code",
            payload.get(
                "beneficiaryCode",
                existing.get("beneficiary_code")
                or employee_code(employee)
                or canonical_employee_id(employee),
            ),
        )
    ).upper()
    effective_from = parse_date(
        payload.get(
            "effective_from",
            payload.get("effectiveFrom", existing.get("effective_from")),
        ),
        field_name="effective_from",
        required=False,
    )

    if len(account_holder_name) < 2 or len(account_holder_name) > 120:
        raise PayrollBankError(
            "account_holder_name must contain between 2 and 120 characters.",
            code="invalid_account_holder_name",
            details={"field": "account_holder_name"},
        )

    if not ACCOUNT_NUMBER_PATTERN.fullmatch(account_number):
        raise PayrollBankError(
            "account_number must contain 6 to 34 letters or digits.",
            code="invalid_bank_account_number",
            details={"field": "account_number"},
        )

    if not IFSC_PATTERN.fullmatch(ifsc_code):
        raise PayrollBankError(
            "ifsc_code must use the RBI IFSC format: four letters, zero, then six letters or digits.",
            code="invalid_ifsc_code",
            details={"field": "ifsc_code"},
        )

    if len(bank_name) < 2 or len(bank_name) > 120:
        raise PayrollBankError(
            "bank_name must contain between 2 and 120 characters.",
            code="invalid_bank_name",
            details={"field": "bank_name"},
        )

    if branch_name and len(branch_name) > 120:
        raise PayrollBankError(
            "branch_name cannot exceed 120 characters.",
            code="invalid_bank_branch_name",
            details={"field": "branch_name"},
        )

    if not BENEFICIARY_CODE_PATTERN.fullmatch(beneficiary_code):
        raise PayrollBankError(
            "beneficiary_code may contain only letters, digits, dots, underscores and hyphens, up to 40 characters.",
            code="invalid_beneficiary_code",
            details={"field": "beneficiary_code"},
        )

    return {
        "account_holder_name": account_holder_name,
        "account_number": account_number,
        "masked_account_number": mask_account_number(account_number),
        "account_number_last4": account_number[-4:],
        "account_number_fingerprint": account_fingerprint(
            tenant_id=tenant_id,
            account_number=account_number,
        ),
        "ifsc_code": ifsc_code,
        "bank_name": bank_name,
        "branch_name": branch_name,
        "account_type": account_type,
        "payment_method": payment_method,
        "beneficiary_code": beneficiary_code,
        "effective_from": effective_from.isoformat() if effective_from else "",
    }


def _bank_revision_snapshot(record: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "revision_number": int(record.get("revision_number") or 1),
        "account_holder_name": safe_str(record.get("account_holder_name")),
        "account_number": safe_str(record.get("account_number")),
        "masked_account_number": safe_str(record.get("masked_account_number")),
        "account_number_last4": safe_str(record.get("account_number_last4")),
        "account_number_fingerprint": safe_str(
            record.get("account_number_fingerprint")
        ),
        "ifsc_code": safe_str(record.get("ifsc_code")),
        "bank_name": safe_str(record.get("bank_name")),
        "branch_name": safe_str(record.get("branch_name")),
        "account_type": safe_str(record.get("account_type")),
        "payment_method": safe_str(record.get("payment_method")),
        "beneficiary_code": safe_str(record.get("beneficiary_code")),
        "effective_from": safe_str(record.get("effective_from")),
        "verification_status": safe_str(record.get("verification_status")),
        "is_verified": bool(record.get("is_verified")),
        "status": safe_str(record.get("status")),
        "is_active": bool(record.get("is_active", True)),
        "updated_at": record.get("updated_at"),
        "updated_by": safe_str(record.get("updated_by")),
        "updated_by_name": safe_str(record.get("updated_by_name")),
    }


def get_bank_details(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    include_inactive: bool = False,
) -> dict[str, Any]:
    employee = find_employee(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
    )

    if not employee:
        raise PayrollBankError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    query: dict[str, Any] = {
        "tenant_id": tenant_id,
        "employee_id": canonical_employee_id(employee),
        "is_deleted": {"$ne": True},
    }

    if not include_inactive:
        query["is_active"] = {"$ne": False}
        query["status"] = {"$ne": "inactive"}

    record = db[BANK_DETAILS_COLLECTION].find_one(query)

    if not record:
        raise PayrollBankError(
            "Bank details were not found for the selected employee.",
            status_code=404,
            code="bank_details_not_found",
            details={
                "employee_id": canonical_employee_id(employee),
            },
        )

    return record


def upsert_bank_details(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    payload: Mapping[str, Any],
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
) -> dict[str, Any]:
    tenant_id = safe_str(tenant_id)

    if not tenant_id:
        raise PayrollBankError(
            "tenant_id is required.",
            code="payroll_tenant_required",
        )

    employee = find_employee(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
    )

    if not employee:
        raise PayrollBankError(
            "Employee was not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    employee_id = canonical_employee_id(employee)
    existing = db[BANK_DETAILS_COLLECTION].find_one({
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "is_deleted": {"$ne": True},
    })
    normalized = normalize_bank_details_payload(
        payload,
        tenant_id=tenant_id,
        employee=employee,
        existing=existing,
    )

    duplicate = db[BANK_DETAILS_COLLECTION].find_one({
        "tenant_id": tenant_id,
        "account_number_fingerprint": normalized["account_number_fingerprint"],
        "employee_id": {"$ne": employee_id},
        "is_active": {"$ne": False},
        "is_deleted": {"$ne": True},
    })

    if duplicate:
        raise PayrollBankError(
            "This bank account is already assigned to another active employee in the company.",
            status_code=409,
            code="duplicate_employee_bank_account",
            details={
                "masked_account_number": normalized["masked_account_number"],
            },
        )

    now = now_utc()

    if not existing:
        document = {
            "_id": ObjectId(),
            "tenant_id": tenant_id,
            "employee_id": employee_id,
            "employee_code": employee_code(employee),
            "employee_name": employee_name(employee),
            "user_id": safe_str(employee.get("user_id")),
            **normalized,
            "verification_status": "pending_verification",
            "is_verified": False,
            "status": "active",
            "is_active": True,
            "revision_number": 1,
            "revisions": [],
            "verification_history": [],
            "created_at": now,
            "created_by": safe_str(actor_id),
            "created_by_name": safe_str(actor_name),
            "updated_at": now,
            "updated_by": safe_str(actor_id),
            "updated_by_name": safe_str(actor_name),
            "update_note": safe_str(note),
            "is_deleted": False,
        }
        db[BANK_DETAILS_COLLECTION].insert_one(document)
        return document

    sensitive_fields = {
        "account_holder_name",
        "account_number",
        "ifsc_code",
        "bank_name",
        "branch_name",
        "account_type",
        "payment_method",
        "beneficiary_code",
        "effective_from",
    }
    changed_fields = sorted(
        field
        for field in sensitive_fields
        if safe_str(existing.get(field)) != safe_str(normalized.get(field))
    )

    if not changed_fields:
        return existing

    revision = {
        **_bank_revision_snapshot(existing),
        "superseded_at": now,
        "superseded_by": safe_str(actor_id),
        "superseded_by_name": safe_str(actor_name),
        "change_note": safe_str(note),
        "changed_fields": changed_fields,
    }
    revision_number = int(existing.get("revision_number") or 1) + 1

    result = db[BANK_DETAILS_COLLECTION].find_one_and_update(
        {
            "_id": existing["_id"],
            "tenant_id": tenant_id,
            "employee_id": employee_id,
            "revision_number": existing.get("revision_number", 1),
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                **normalized,
                "employee_code": employee_code(employee),
                "employee_name": employee_name(employee),
                "user_id": safe_str(employee.get("user_id")),
                "verification_status": "pending_verification",
                "is_verified": False,
                "status": "active",
                "is_active": True,
                "revision_number": revision_number,
                "verified_at": None,
                "verified_by": "",
                "verified_by_name": "",
                "rejected_at": None,
                "rejected_by": "",
                "rejected_by_name": "",
                "rejection_reason": "",
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
                "update_note": safe_str(note),
            },
            "$push": {
                "revisions": revision,
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollBankError(
            "The bank details changed while the update was being applied.",
            status_code=409,
            code="bank_details_concurrent_update",
        )

    return result


def verify_bank_details(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    decision: Any,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
    enforce_segregation_of_duties: bool = True,
) -> dict[str, Any]:
    record = get_bank_details(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        include_inactive=False,
    )
    normalized_decision = normalize_key(decision)

    if normalized_decision not in {"verified", "rejected"}:
        raise PayrollBankError(
            "decision must be verified or rejected.",
            code="invalid_bank_verification_decision",
        )

    if normalized_decision == "rejected" and not safe_str(note):
        raise PayrollBankError(
            "A rejection reason is required.",
            code="bank_verification_rejection_reason_required",
        )

    if (
        enforce_segregation_of_duties
        and safe_str(actor_id)
        and safe_str(record.get("updated_by")) == safe_str(actor_id)
    ):
        raise PayrollBankError(
            "The person who last changed the bank details cannot verify the same revision.",
            status_code=409,
            code="bank_verification_maker_checker_required",
        )

    validate_bank_details_for_disbursement(
        record,
        require_verified=False,
    )

    now = now_utc()
    history_entry = {
        "decision": normalized_decision,
        "revision_number": int(record.get("revision_number") or 1),
        "actor_id": safe_str(actor_id),
        "actor_name": safe_str(actor_name),
        "note": safe_str(note),
        "at": now,
    }
    updates: dict[str, Any] = {
        "verification_status": normalized_decision,
        "is_verified": normalized_decision == "verified",
        "updated_at": now,
        "updated_by": safe_str(actor_id),
        "updated_by_name": safe_str(actor_name),
    }

    if normalized_decision == "verified":
        updates.update({
            "verified_at": now,
            "verified_by": safe_str(actor_id),
            "verified_by_name": safe_str(actor_name),
            "rejected_at": None,
            "rejected_by": "",
            "rejected_by_name": "",
            "rejection_reason": "",
        })
    else:
        updates.update({
            "verified_at": None,
            "verified_by": "",
            "verified_by_name": "",
            "rejected_at": now,
            "rejected_by": safe_str(actor_id),
            "rejected_by_name": safe_str(actor_name),
            "rejection_reason": safe_str(note),
        })

    result = db[BANK_DETAILS_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "revision_number": record.get("revision_number", 1),
            "is_active": {"$ne": False},
            "is_deleted": {"$ne": True},
        },
        {
            "$set": updates,
            "$push": {
                "verification_history": history_entry,
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollBankError(
            "The bank details changed before verification completed.",
            status_code=409,
            code="bank_details_concurrent_update",
        )

    return result


def deactivate_bank_details(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    reason: str,
    actor_id: str = "",
    actor_name: str = "",
) -> dict[str, Any]:
    reason = safe_str(reason)

    if not reason:
        raise PayrollBankError(
            "A deactivation reason is required.",
            code="bank_details_deactivation_reason_required",
        )

    record = get_bank_details(
        db,
        tenant_id=tenant_id,
        employee_reference=employee_reference,
        include_inactive=False,
    )
    now = now_utc()

    result = db[BANK_DETAILS_COLLECTION].find_one_and_update(
        {
            "_id": record["_id"],
            "tenant_id": tenant_id,
            "is_active": {"$ne": False},
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": "inactive",
                "is_active": False,
                "is_verified": False,
                "verification_status": "pending_verification",
                "deactivated_at": now,
                "deactivated_by": safe_str(actor_id),
                "deactivated_by_name": safe_str(actor_name),
                "deactivation_reason": reason,
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "verification_history": {
                    "decision": "deactivated",
                    "revision_number": int(record.get("revision_number") or 1),
                    "actor_id": safe_str(actor_id),
                    "actor_name": safe_str(actor_name),
                    "note": reason,
                    "at": now,
                }
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollBankError(
            "The bank details changed before deactivation completed.",
            status_code=409,
            code="bank_details_concurrent_update",
        )

    return result


def serialize_bank_details(
    record: Mapping[str, Any],
    *,
    include_sensitive: bool = False,
    include_history: bool = False,
) -> dict[str, Any]:
    result = {
        "_id": safe_str(record.get("_id")),
        "id": safe_str(record.get("_id")),
        "tenant_id": safe_str(record.get("tenant_id")),
        "employee_id": safe_str(record.get("employee_id")),
        "employee_code": safe_str(record.get("employee_code")),
        "employee_name": safe_str(record.get("employee_name")),
        "account_holder_name": safe_str(record.get("account_holder_name")),
        "masked_account_number": safe_str(
            record.get("masked_account_number")
            or mask_account_number(record.get("account_number"))
        ),
        "account_number_last4": safe_str(
            record.get("account_number_last4")
            or _normalise_account_number(record.get("account_number"))[-4:]
        ),
        "ifsc_code": safe_str(record.get("ifsc_code")),
        "bank_name": safe_str(record.get("bank_name")),
        "branch_name": safe_str(record.get("branch_name")),
        "account_type": safe_str(record.get("account_type")),
        "payment_method": safe_str(record.get("payment_method")),
        "beneficiary_code": safe_str(record.get("beneficiary_code")),
        "effective_from": safe_str(record.get("effective_from")),
        "verification_status": safe_str(record.get("verification_status")),
        "is_verified": bool(record.get("is_verified")),
        "status": safe_str(record.get("status")),
        "is_active": bool(record.get("is_active", True)),
        "revision_number": int(record.get("revision_number") or 1),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "verified_at": record.get("verified_at"),
        "verified_by_name": safe_str(record.get("verified_by_name")),
        "rejection_reason": safe_str(record.get("rejection_reason")),
    }

    if include_sensitive:
        result["account_number"] = safe_str(record.get("account_number"))

    if include_history:
        result["revisions"] = list(record.get("revisions") or [])
        result["verification_history"] = list(
            record.get("verification_history") or []
        )

    return result


def validate_bank_details_for_disbursement(
    record: Mapping[str, Any],
    *,
    require_verified: bool = True,
) -> dict[str, Any]:
    account_holder_name = safe_str(record.get("account_holder_name"))
    account_number = _normalise_account_number(record.get("account_number"))
    ifsc_code = _normalise_ifsc(record.get("ifsc_code"))
    bank_name = safe_str(record.get("bank_name"))
    account_type = _normalize_account_type(
        record.get("account_type") or "salary"
    )
    payment_method = _normalize_payment_method(
        record.get("payment_method") or "neft"
    )
    beneficiary_code = safe_str(
        record.get("beneficiary_code")
        or record.get("employee_code")
        or record.get("employee_id")
    ).upper()

    errors: list[dict[str, str]] = []

    if len(account_holder_name) < 2:
        errors.append({
            "field": "account_holder_name",
            "message": "Account holder name is missing or invalid.",
        })

    if not ACCOUNT_NUMBER_PATTERN.fullmatch(account_number):
        errors.append({
            "field": "account_number",
            "message": "Bank account number is missing or invalid.",
        })

    if not IFSC_PATTERN.fullmatch(ifsc_code):
        errors.append({
            "field": "ifsc_code",
            "message": "IFSC code is missing or invalid.",
        })

    if len(bank_name) < 2:
        errors.append({
            "field": "bank_name",
            "message": "Bank name is missing or invalid.",
        })

    if not BENEFICIARY_CODE_PATTERN.fullmatch(beneficiary_code):
        errors.append({
            "field": "beneficiary_code",
            "message": "Beneficiary code is missing or invalid.",
        })

    if (
        safe_str(record.get("status") or "active") == "inactive"
        or record.get("is_active") is False
    ):
        errors.append({
            "field": "status",
            "message": "Bank details are inactive.",
        })

    if require_verified and (
        not bool(record.get("is_verified"))
        or normalize_key(record.get("verification_status")) != "verified"
    ):
        errors.append({
            "field": "verification_status",
            "message": "Bank details have not been verified.",
        })

    if errors:
        raise PayrollBankError(
            "Bank details are not valid for salary disbursement.",
            status_code=409,
            code="bank_details_not_disbursement_ready",
            details={
                "errors": errors,
                "masked_account_number": mask_account_number(account_number),
            },
        )

    return {
        "account_holder_name": account_holder_name,
        "account_number": account_number,
        "masked_account_number": mask_account_number(account_number),
        "account_number_last4": account_number[-4:],
        "ifsc_code": ifsc_code,
        "bank_name": bank_name,
        "branch_name": safe_str(record.get("branch_name")),
        "account_type": account_type,
        "payment_method": payment_method,
        "beneficiary_code": beneficiary_code,
        "verification_status": "verified"
        if bool(record.get("is_verified"))
        else safe_str(record.get("verification_status")),
        "verified_at": record.get("verified_at"),
        "revision_number": int(record.get("revision_number") or 1),
    }


def list_bank_details(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any = "",
    verification_statuses: Iterable[Any] | None = None,
    include_inactive: bool = False,
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
            raise PayrollBankError(
                "Employee was not found in the selected company.",
                status_code=404,
                code="payroll_employee_not_found",
            )

        query["employee_id"] = canonical_employee_id(employee)

    normalized_statuses = {
        normalize_key(item)
        for item in (verification_statuses or [])
        if safe_str(item)
    }

    if normalized_statuses:
        invalid = normalized_statuses - BANK_VERIFICATION_STATUSES

        if invalid:
            raise PayrollBankError(
                "One or more bank verification statuses are invalid.",
                code="invalid_bank_verification_status",
                details={"statuses": sorted(invalid)},
            )

        query["verification_status"] = {"$in": sorted(normalized_statuses)}

    if not include_inactive:
        query["is_active"] = {"$ne": False}
        query["status"] = {"$ne": "inactive"}

    safe_limit = max(1, min(int(limit or 500), 2000))

    return list(
        db[BANK_DETAILS_COLLECTION]
        .find(query)
        .sort([
            ("employee_name", 1),
            ("employee_code", 1),
        ])
        .limit(safe_limit)
    )


def bank_details_snapshot(
    record: Mapping[str, Any],
) -> dict[str, Any]:
    validated = validate_bank_details_for_disbursement(
        record,
        require_verified=True,
    )

    return {
        **validated,
        "bank_details_id": safe_str(record.get("_id")),
        "employee_id": safe_str(record.get("employee_id")),
        "employee_code": safe_str(record.get("employee_code")),
        "employee_name": safe_str(record.get("employee_name")),
        "snapshot_at": now_utc(),
    }


def _payslip_employee_reference(payslip: Mapping[str, Any]) -> str:
    employee_info = payslip.get("employee_info") or {}

    return safe_str(
        payslip.get("employee_id")
        or employee_info.get("employee_id")
        or payslip.get("employee_code")
        or employee_info.get("employee_code")
        or employee_info.get("official_email")
    )


def prepare_payroll_bank_snapshots(
    db: Any,
    *,
    tenant_id: str,
    run_id: Any,
    payslips: Iterable[Mapping[str, Any]] | None = None,
    actor_id: str = "",
    actor_name: str = "",
    strict: bool = True,
) -> dict[str, Any]:
    normalized_run_id = safe_str(run_id)

    if not normalized_run_id:
        raise PayrollBankError(
            "run_id is required.",
            code="payroll_run_id_required",
        )

    run = _find_payroll_run(
        db,
        tenant_id=tenant_id,
        run_id=normalized_run_id,
    )

    if not run:
        raise PayrollBankError(
            "Payroll run was not found.",
            status_code=404,
            code="payroll_run_not_found",
        )

    run_status = normalize_key(run.get("status"))

    if run_status not in BANK_SNAPSHOT_PREPARATION_STATUSES:
        raise PayrollBankError(
            "Bank snapshots can be prepared only after Finance approval.",
            status_code=409,
            code="payroll_run_not_bank_snapshot_ready",
            details={"status": run_status},
        )

    if payslips is None:
        payslips = list(db.payslips.find({
            "tenant_id": tenant_id,
            "run_id": {
                "$in": [
                    normalized_run_id,
                    run.get("_id"),
                ]
            },
            "is_deleted": {"$ne": True},
        }))
    else:
        payslips = list(payslips)

    prepared: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for payslip in payslips:
        payslip_id = safe_str(payslip.get("_id"))
        employee_reference = _payslip_employee_reference(payslip)

        try:
            existing_snapshot = payslip.get("bank_details_snapshot") or {}

            if existing_snapshot:
                validate_bank_details_for_disbursement(
                    existing_snapshot,
                    require_verified=True,
                )
                skipped.append({
                    "payslip_id": payslip_id,
                    "employee_id": safe_str(payslip.get("employee_id")),
                    "reason": "snapshot_already_exists",
                })
                continue

            if run_status in FINAL_PAYROLL_STATUSES:
                raise PayrollBankError(
                    "A missing bank snapshot cannot be added after payroll lock.",
                    status_code=409,
                    code="locked_payroll_bank_snapshot_missing",
                )

            record = get_bank_details(
                db,
                tenant_id=tenant_id,
                employee_reference=employee_reference,
                include_inactive=False,
            )
            snapshot = bank_details_snapshot(record)

            result = db.payslips.find_one_and_update(
                {
                    "_id": payslip.get("_id"),
                    "tenant_id": tenant_id,
                    "is_locked": {"$ne": True},
                    "status": {
                        "$nin": sorted(FINAL_PAYROLL_STATUSES),
                    },
                    "$or": [
                        {"bank_details_snapshot": {"$exists": False}},
                        {"bank_details_snapshot": {}},
                        {"bank_details_snapshot": None},
                    ],
                    "is_deleted": {"$ne": True},
                },
                {
                    "$set": {
                        "bank_details_snapshot": snapshot,
                        "bank_details_validated_at": now_utc(),
                        "bank_details_validated_by": safe_str(actor_id),
                        "bank_details_validated_by_name": safe_str(actor_name),
                        "updated_at": now_utc(),
                    }
                },
                return_document=ReturnDocument.AFTER,
            )

            if not result:
                raise PayrollBankError(
                    "The payslip changed before its bank snapshot could be saved.",
                    status_code=409,
                    code="payslip_bank_snapshot_concurrent_update",
                )

            prepared.append({
                "payslip_id": payslip_id,
                "employee_id": safe_str(payslip.get("employee_id")),
                "employee_code": safe_str(payslip.get("employee_code")),
                "employee_name": safe_str(payslip.get("employee_name")),
                "masked_account_number": snapshot["masked_account_number"],
                "ifsc_code": snapshot["ifsc_code"],
                "bank_name": snapshot["bank_name"],
                "revision_number": snapshot["revision_number"],
            })
        except PayrollBankError as exc:
            failures.append({
                "payslip_id": payslip_id,
                "employee_id": safe_str(payslip.get("employee_id")),
                "employee_code": safe_str(payslip.get("employee_code")),
                "employee_name": safe_str(payslip.get("employee_name")),
                "message": exc.message,
                "code": exc.code,
                "details": exc.details,
            })

    result_payload = {
        "run_id": normalized_run_id,
        "period_key": safe_str(run.get("period_key")),
        "prepared": prepared,
        "skipped": skipped,
        "failures": failures,
        "totals": {
            "prepared": len(prepared),
            "skipped": len(skipped),
            "failed": len(failures),
        },
    }

    if strict and failures:
        raise PayrollBankError(
            "One or more employees do not have verified bank details. Payroll cannot be locked.",
            status_code=409,
            code="payroll_bank_snapshot_validation_failed",
            details=result_payload,
        )

    return result_payload


def _extract_net_amount(payslip: Mapping[str, Any]) -> Decimal:
    totals = payslip.get("totals") or {}
    candidates = (
        totals.get("net_amount"),
        totals.get("net_salary"),
        totals.get("net_payable"),
        totals.get("net_pay"),
        payslip.get("net_amount"),
        payslip.get("net_salary"),
        payslip.get("net_payable"),
    )

    for value in candidates:
        if value not in (None, ""):
            return money_decimal(
                value,
                field_name="payslip.net_amount",
                minimum=ZERO,
            )

    raise PayrollBankError(
        "Payslip net amount is missing.",
        code="payslip_net_amount_missing",
    )


def _transaction_reference(
    *,
    run_id: str,
    period_key: str,
    employee_code_value: str,
    employee_id: str,
) -> str:
    stable_source = (
        f"{run_id}|{period_key}|{employee_code_value}|{employee_id}"
    ).encode("utf-8")
    digest = hashlib.sha256(stable_source).hexdigest()[:12].upper()
    period_compact = period_key.replace("-", "")
    code = re.sub(r"[^A-Z0-9]", "", employee_code_value.upper())[:8]

    return f"PY{period_compact}{code}{digest}"[:30]


def _sanitize_csv_cell(value: Any) -> str:
    text = safe_str(value)

    if text.startswith(("=", "+", "-", "@")):
        return f"'{text}"

    return text.replace("\x00", "")


def _normalise_export_columns(
    columns: Sequence[Any] | None,
) -> tuple[tuple[str, str], ...]:
    if not columns:
        return DEFAULT_EXPORT_COLUMNS

    normalized: list[tuple[str, str]] = []

    for index, column in enumerate(columns):
        if isinstance(column, str):
            key = safe_str(column)
            label = label_from_key(key)
        elif isinstance(column, Mapping):
            key = safe_str(column.get("key") or column.get("field"))
            label = safe_str(
                column.get("label")
                or column.get("header")
                or label_from_key(key)
            )
        elif isinstance(column, (list, tuple)) and len(column) >= 2:
            key = safe_str(column[0])
            label = safe_str(column[1])
        else:
            raise PayrollBankError(
                f"columns[{index}] is invalid.",
                code="invalid_bank_export_column",
                details={"index": index},
            )

        if not key:
            raise PayrollBankError(
                f"columns[{index}] must contain a field key.",
                code="invalid_bank_export_column",
                details={"index": index},
            )

        normalized.append((key, label or key))

    return tuple(normalized)


def label_from_key(value: Any) -> str:
    return " ".join(
        word.capitalize()
        for word in normalize_key(value).split("_")
        if word
    )


def build_bank_disbursement_rows(
    db: Any,
    *,
    tenant_id: str,
    run_id: Any,
    payslips: Iterable[Mapping[str, Any]] | None = None,
    narration_prefix: str = "Salary",
) -> dict[str, Any]:
    normalized_run_id = safe_str(run_id)

    if not normalized_run_id:
        raise PayrollBankError(
            "run_id is required.",
            code="payroll_run_id_required",
        )

    run = _find_payroll_run(
        db,
        tenant_id=tenant_id,
        run_id=normalized_run_id,
    )

    if not run:
        raise PayrollBankError(
            "Payroll run was not found.",
            status_code=404,
            code="payroll_run_not_found",
        )

    run_status = normalize_key(run.get("status"))

    if run_status not in BANK_EXPORTABLE_PAYROLL_STATUSES:
        raise PayrollBankError(
            "A bank disbursement file can be generated only after payroll is locked.",
            status_code=409,
            code="payroll_run_not_bank_exportable",
            details={"status": run_status},
        )

    period_key = normalize_period(
        run.get("period_key"),
        field_name="period_key",
    )

    if payslips is None:
        run_ids = [normalized_run_id, run.get("_id")]
        payslips = list(db.payslips.find({
            "tenant_id": tenant_id,
            "run_id": {"$in": run_ids},
            "is_deleted": {"$ne": True},
        }).sort([
            ("employee_code", 1),
            ("employee_name", 1),
        ]))
    else:
        payslips = list(payslips)

    rows: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    seen_accounts: dict[str, str] = {}

    for payslip in payslips:
        employee_id_value = safe_str(payslip.get("employee_id"))
        employee_code_value = safe_str(payslip.get("employee_code"))
        employee_name_value = safe_str(
            payslip.get("employee_name")
            or (payslip.get("employee_info") or {}).get("name")
        )
        payslip_id = safe_str(payslip.get("_id"))

        try:
            amount = _extract_net_amount(payslip)

            if amount == ZERO:
                skipped.append({
                    "payslip_id": payslip_id,
                    "employee_id": employee_id_value,
                    "employee_code": employee_code_value,
                    "employee_name": employee_name_value,
                    "reason": "zero_net_amount",
                })
                continue

            snapshot = payslip.get("bank_details_snapshot") or {}

            if not snapshot:
                raise PayrollBankError(
                    "Verified bank snapshot is missing from the locked payslip.",
                    status_code=409,
                    code="locked_payslip_bank_snapshot_missing",
                )

            bank = validate_bank_details_for_disbursement(
                snapshot,
                require_verified=True,
            )
            fingerprint = account_fingerprint(
                tenant_id=tenant_id,
                account_number=bank["account_number"],
            )

            if fingerprint in seen_accounts:
                raise PayrollBankError(
                    "The same bank account appears on more than one payslip in this payroll run.",
                    status_code=409,
                    code="duplicate_bank_account_in_payroll_run",
                    details={
                        "first_employee_id": seen_accounts[fingerprint],
                        "masked_account_number": bank["masked_account_number"],
                    },
                )

            seen_accounts[fingerprint] = employee_id_value
            transaction_reference = _transaction_reference(
                run_id=normalized_run_id,
                period_key=period_key,
                employee_code_value=employee_code_value,
                employee_id=employee_id_value,
            )
            normalized_narration_prefix = (
                safe_str(narration_prefix) or "Salary"
            )
            narration = safe_str(
                f"{normalized_narration_prefix} {period_key} "
                f"{employee_code_value}"
            )[:100]

            rows.append({
                "transaction_reference": transaction_reference,
                "beneficiary_name": bank["account_holder_name"],
                "beneficiary_account_number": bank["account_number"],
                "masked_account_number": bank["masked_account_number"],
                "ifsc_code": bank["ifsc_code"],
                "bank_name": bank["bank_name"],
                "branch_name": bank["branch_name"],
                "account_type": bank["account_type"],
                "amount": f"{amount:.2f}",
                "payment_method": bank["payment_method"].upper(),
                "narration": narration,
                "employee_code": employee_code_value,
                "employee_id": employee_id_value,
                "employee_name": employee_name_value,
                "payslip_id": payslip_id,
                "period_key": period_key,
                "bank_details_id": safe_str(snapshot.get("bank_details_id")),
                "bank_revision_number": int(
                    snapshot.get("revision_number") or 1
                ),
            })
        except PayrollBankError as exc:
            failures.append({
                "payslip_id": payslip_id,
                "employee_id": employee_id_value,
                "employee_code": employee_code_value,
                "employee_name": employee_name_value,
                "message": exc.message,
                "code": exc.code,
                "details": exc.details,
            })

    total_amount = sum(
        Decimal(row["amount"])
        for row in rows
    )

    return {
        "run_id": normalized_run_id,
        "period_key": period_key,
        "run_status": run_status,
        "rows": rows,
        "skipped": skipped,
        "failures": failures,
        "totals": {
            "transactions": len(rows),
            "skipped": len(skipped),
            "failed": len(failures),
            "amount": money_value(total_amount),
        },
    }


def generate_bank_disbursement_csv(
    db: Any,
    *,
    tenant_id: str,
    run_id: Any,
    payslips: Iterable[Mapping[str, Any]] | None = None,
    columns: Sequence[Any] | None = None,
    delimiter: str = ",",
    include_utf8_bom: bool = True,
    narration_prefix: str = "Salary",
    export_format: str = "generic_neft_csv",
    export_version: str = "1",
    actor_id: str = "",
    actor_name: str = "",
    persist_export_metadata: bool = True,
    fail_on_validation_error: bool = True,
) -> dict[str, Any]:
    if len(delimiter) != 1:
        raise PayrollBankError(
            "delimiter must contain exactly one character.",
            code="invalid_bank_export_delimiter",
        )

    result = build_bank_disbursement_rows(
        db,
        tenant_id=tenant_id,
        run_id=run_id,
        payslips=payslips,
        narration_prefix=narration_prefix,
    )

    if fail_on_validation_error and result["failures"]:
        raise PayrollBankError(
            "The bank file could not be generated because one or more payslips failed validation.",
            status_code=409,
            code="bank_export_validation_failed",
            details={
                "run_id": result["run_id"],
                "period_key": result["period_key"],
                "failures": result["failures"],
                "skipped": result["skipped"],
                "totals": result["totals"],
            },
        )

    if not result["rows"]:
        raise PayrollBankError(
            "No positive salary transactions are available for the bank file.",
            status_code=409,
            code="bank_export_has_no_transactions",
            details={
                "skipped": result["skipped"],
                "failures": result["failures"],
            },
        )

    normalized_columns = _normalise_export_columns(columns)
    buffer = io.StringIO(newline="")
    writer = csv.writer(
        buffer,
        delimiter=delimiter,
        quoting=csv.QUOTE_MINIMAL,
        lineterminator="\r\n",
    )
    writer.writerow([header for _, header in normalized_columns])

    for row in result["rows"]:
        writer.writerow([
            _sanitize_csv_cell(row.get(field))
            for field, _ in normalized_columns
        ])

    csv_text = buffer.getvalue()
    csv_bytes = csv_text.encode("utf-8-sig" if include_utf8_bom else "utf-8")
    file_hash = hashlib.sha256(csv_bytes).hexdigest()
    normalized_format = normalize_key(export_format) or "generic_neft_csv"
    normalized_version = safe_str(export_version) or "1"
    filename = (
        f"salary-disbursement-{result['period_key']}-"
        f"{normalized_format}-v{normalized_version}.csv"
    )
    export_id = ""
    export_created_at = now_utc()

    masked_rows = [
        {
            "transaction_reference": row["transaction_reference"],
            "employee_id": row["employee_id"],
            "employee_code": row["employee_code"],
            "employee_name": row["employee_name"],
            "payslip_id": row["payslip_id"],
            "masked_account_number": row["masked_account_number"],
            "ifsc_code": row["ifsc_code"],
            "bank_name": row["bank_name"],
            "amount": row["amount"],
            "payment_method": row["payment_method"],
        }
        for row in result["rows"]
    ]

    if persist_export_metadata:
        export_key = (
            f"{result['run_id']}:{normalized_format}:"
            f"{normalized_version}:{file_hash}"
        )
        export_document = db[BANK_EXPORTS_COLLECTION].find_one_and_update(
            {
                "tenant_id": tenant_id,
                "export_key": export_key,
            },
            {
                "$setOnInsert": {
                    "_id": ObjectId(),
                    "tenant_id": tenant_id,
                    "run_id": result["run_id"],
                    "period_key": result["period_key"],
                    "export_key": export_key,
                    "export_format": normalized_format,
                    "export_version": normalized_version,
                    "filename": filename,
                    "content_type": "text/csv; charset=utf-8",
                    "sha256": file_hash,
                    "delimiter": delimiter,
                    "include_utf8_bom": bool(include_utf8_bom),
                    "columns": [
                        {
                            "key": key,
                            "header": header,
                        }
                        for key, header in normalized_columns
                    ],
                    "transactions": masked_rows,
                    "transaction_count": result["totals"]["transactions"],
                    "total_amount": result["totals"]["amount"],
                    "status": "generated",
                    "created_at": export_created_at,
                    "created_by": safe_str(actor_id),
                    "created_by_name": safe_str(actor_name),
                    "is_deleted": False,
                },
                "$set": {
                    "last_generated_at": export_created_at,
                    "last_generated_by": safe_str(actor_id),
                    "last_generated_by_name": safe_str(actor_name),
                },
                "$inc": {
                    "generation_count": 1,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        export_id = safe_str(export_document.get("_id"))
        export_created_at = (
            export_document.get("created_at")
            or export_created_at
        )

    return {
        **result,
        "export": {
            "id": export_id,
            "filename": filename,
            "content_type": "text/csv; charset=utf-8",
            "export_format": normalized_format,
            "export_version": normalized_version,
            "sha256": file_hash,
            "generated_at": export_created_at,
            "columns": [
                {
                    "key": key,
                    "header": header,
                }
                for key, header in normalized_columns
            ],
            "csv_text": csv_text,
            "csv_bytes": csv_bytes,
        },
    }


def mark_bank_export_status(
    db: Any,
    *,
    tenant_id: str,
    export_id: Any,
    status: Any,
    actor_id: str = "",
    actor_name: str = "",
    reference: str = "",
    note: str = "",
) -> dict[str, Any]:
    parsed_id = object_id(export_id)

    if not parsed_id:
        raise PayrollBankError(
            "Invalid bank export identifier.",
            status_code=404,
            code="bank_export_not_found",
        )

    normalized_status = normalize_key(status)
    allowed_statuses = {
        "generated",
        "uploaded",
        "accepted",
        "rejected",
        "processed",
    }

    if normalized_status not in allowed_statuses:
        raise PayrollBankError(
            "Unsupported bank export status.",
            code="invalid_bank_export_status",
            details={"allowed_statuses": sorted(allowed_statuses)},
        )

    now = now_utc()
    history_entry = {
        "status": normalized_status,
        "reference": safe_str(reference),
        "note": safe_str(note),
        "actor_id": safe_str(actor_id),
        "actor_name": safe_str(actor_name),
        "at": now,
    }

    result = db[BANK_EXPORTS_COLLECTION].find_one_and_update(
        {
            "_id": parsed_id,
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": normalized_status,
                "status_reference": safe_str(reference),
                "status_note": safe_str(note),
                "updated_at": now,
                "updated_by": safe_str(actor_id),
                "updated_by_name": safe_str(actor_name),
            },
            "$push": {
                "status_history": history_entry,
            },
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        raise PayrollBankError(
            "Bank export record was not found.",
            status_code=404,
            code="bank_export_not_found",
        )

    return result


def list_bank_exports(
    db: Any,
    *,
    tenant_id: str,
    run_id: Any = "",
    period_key: Any = "",
    statuses: Iterable[Any] | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }

    normalized_run_id = safe_str(run_id)

    if normalized_run_id:
        query["run_id"] = normalized_run_id

    normalized_period = safe_str(period_key)

    if normalized_period:
        query["period_key"] = normalize_period(
            normalized_period,
            field_name="period_key",
        )

    normalized_statuses = {
        normalize_key(item)
        for item in (statuses or [])
        if safe_str(item)
    }

    if normalized_statuses:
        query["status"] = {"$in": sorted(normalized_statuses)}

    safe_limit = max(1, min(int(limit or 200), 1000))

    return list(
        db[BANK_EXPORTS_COLLECTION]
        .find(query)
        .sort([
            ("created_at", -1),
            ("_id", -1),
        ])
        .limit(safe_limit)
    )


__all__ = [
    "BANK_ACCOUNT_TYPES",
    "BANK_DETAIL_STATUSES",
    "BANK_EXPORTABLE_PAYROLL_STATUSES",
    "BANK_PAYMENT_METHODS",
    "BANK_VERIFICATION_STATUSES",
    "PayrollBankError",
    "account_fingerprint",
    "bank_details_snapshot",
    "build_bank_disbursement_rows",
    "deactivate_bank_details",
    "find_employee",
    "generate_bank_disbursement_csv",
    "get_bank_details",
    "list_bank_details",
    "list_bank_exports",
    "mark_bank_export_status",
    "mask_account_number",
    "normalize_bank_details_payload",
    "prepare_payroll_bank_snapshots",
    "serialize_bank_details",
    "upsert_bank_details",
    "validate_bank_details_for_disbursement",
    "verify_bank_details",
]