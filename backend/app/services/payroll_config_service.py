from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Iterable

from bson import ObjectId


class PayrollConfigError(Exception):
    """Raised when salary/statutory configuration is invalid."""

    def __init__(
        self,
        message: str,
        status_code: int = 400,
        code: str = "payroll_config_error",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


SALARY_STRUCTURE_STATUSES = {"draft", "active", "superseded", "archived"}
COMPONENT_CATEGORIES = {
    "earning",
    "employer_contribution",
    "deduction",
    "information",
}
COMPONENT_CALCULATION_TYPES = {
    "fixed",
    "percentage",
    "balancing",
    "statutory",
}
STATUTORY_CONFIG_STATUSES = {"draft", "active", "superseded", "archived"}
LWP_DIVISOR_MODES = {"calendar_days", "fixed_days", "working_days"}
TDS_MODES = {"manual", "external", "disabled"}
ROUNDING_MODES = {"nearest_rupee", "two_decimals", "floor", "ceil"}

# These codes are required by the approved SDS payslip format. Their values are
# deliberately not hard-coded; HR can configure them as fixed, percentage, or
# balancing components in each salary structure/template.
REQUIRED_EARNING_COMPONENT_CODES = {
    "basic",
    "hra",
    "medical_allowance",
    "other_allowances",
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def safe_str(value: Any) -> str:
    return str(value or "").strip()


def normalize_code(value: Any) -> str:
    return (
        safe_str(value)
        .lower()
        .replace("&", "and")
        .replace("-", "_")
        .replace("/", "_")
        .replace(" ", "_")
    )


def normalize_state_code(value: Any) -> str:
    state_code = safe_str(value).upper().replace(" ", "_")

    if not state_code:
        raise PayrollConfigError(
            "state_code is required.",
            code="state_code_required",
        )

    # ALL is used for national/default rules such as PF. State-specific rules
    # such as Professional Tax should use the ISO-like two-letter state code.
    if state_code != "ALL" and len(state_code) != 2:
        raise PayrollConfigError(
            "state_code must be a two-letter code or ALL.",
            code="invalid_state_code",
        )

    return state_code


def object_id_or_none(value: Any) -> ObjectId | None:
    if isinstance(value, ObjectId):
        return value

    try:
        return ObjectId(safe_str(value))
    except Exception:
        return None


def decimal_value(
    value: Any,
    field_name: str,
    *,
    minimum: Decimal | None = Decimal("0"),
    maximum: Decimal | None = None,
    required: bool = True,
) -> Decimal | None:
    if value in (None, ""):
        if required:
            raise PayrollConfigError(
                f"{field_name} is required.",
                code=f"{normalize_code(field_name)}_required",
            )
        return None

    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise PayrollConfigError(
            f"{field_name} must be a valid number.",
            code=f"invalid_{normalize_code(field_name)}",
        )

    if minimum is not None and result < minimum:
        raise PayrollConfigError(
            f"{field_name} must be at least {minimum}.",
            code=f"invalid_{normalize_code(field_name)}",
        )

    if maximum is not None and result > maximum:
        raise PayrollConfigError(
            f"{field_name} must not exceed {maximum}.",
            code=f"invalid_{normalize_code(field_name)}",
        )

    return result


def money_value(
    value: Any,
    field_name: str,
    *,
    required: bool = True,
) -> float | None:
    result = decimal_value(value, field_name, required=required)

    if result is None:
        return None

    return float(result.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def percentage_value(
    value: Any,
    field_name: str,
    *,
    required: bool = True,
) -> float | None:
    result = decimal_value(
        value,
        field_name,
        minimum=Decimal("0"),
        maximum=Decimal("100"),
        required=required,
    )

    if result is None:
        return None

    return float(result.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def boolean_value(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value

    if value in (None, ""):
        return default

    return safe_str(value).lower() in {"1", "true", "yes", "y", "on"}


def parse_date_value(value: Any, field_name: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.min)
    else:
        raw = safe_str(value)

        if not raw:
            raise PayrollConfigError(
                f"{field_name} is required.",
                code=f"{normalize_code(field_name)}_required",
            )

        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.strptime(raw, "%Y-%m-%d")
            except ValueError:
                raise PayrollConfigError(
                    f"{field_name} must use YYYY-MM-DD format.",
                    code=f"invalid_{normalize_code(field_name)}",
                )

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)

    return parsed.replace(hour=0, minute=0, second=0, microsecond=0)


def optional_date_value(value: Any, field_name: str) -> datetime | None:
    if value in (None, ""):
        return None

    return parse_date_value(value, field_name)


def end_of_previous_day(value: datetime) -> datetime:
    return value - timedelta(microseconds=1)


def next_revision_number(collection: Any, query: dict[str, Any]) -> int:
    existing = collection.find_one(query, sort=[("version", -1)])

    try:
        return int(existing.get("version", 0)) + 1 if existing else 1
    except (TypeError, ValueError):
        return 1


def ensure_unique_codes(items: Iterable[dict[str, Any]], field_name: str) -> None:
    seen: set[str] = set()

    for item in items:
        code = safe_str(item.get("code"))

        if code in seen:
            raise PayrollConfigError(
                f"Duplicate {field_name} code: {code}.",
                code=f"duplicate_{normalize_code(field_name)}_code",
            )

        seen.add(code)


def normalize_salary_component(
    raw_component: dict[str, Any],
    display_order: int,
) -> dict[str, Any]:
    if not isinstance(raw_component, dict):
        raise PayrollConfigError(
            "Each salary component must be an object.",
            code="invalid_salary_component",
        )

    code = normalize_code(raw_component.get("code") or raw_component.get("name"))

    if not code:
        raise PayrollConfigError(
            "Each salary component requires a code.",
            code="salary_component_code_required",
        )

    label = safe_str(raw_component.get("label") or raw_component.get("name"))

    if not label:
        raise PayrollConfigError(
            f"Salary component {code} requires a label.",
            code="salary_component_label_required",
        )

    category = normalize_code(raw_component.get("category") or "earning")

    if category not in COMPONENT_CATEGORIES:
        raise PayrollConfigError(
            f"Unsupported category for {code}: {category}.",
            code="invalid_salary_component_category",
        )

    calculation_type = normalize_code(
        raw_component.get("calculation_type")
        or raw_component.get("calculationType")
        or "fixed"
    )

    if calculation_type not in COMPONENT_CALCULATION_TYPES:
        raise PayrollConfigError(
            f"Unsupported calculation_type for {code}: {calculation_type}.",
            code="invalid_salary_component_calculation_type",
        )

    component: dict[str, Any] = {
        "code": code,
        "label": label,
        "category": category,
        "calculation_type": calculation_type,
        "prorate_on_lwp": boolean_value(
            raw_component.get("prorate_on_lwp"),
            default=category == "earning",
        ),
        "include_in_gross": boolean_value(
            raw_component.get("include_in_gross"),
            default=category == "earning",
        ),
        "include_in_ctc": boolean_value(
            raw_component.get("include_in_ctc"),
            default=category in {"earning", "employer_contribution"},
        ),
        "show_in_earnings": boolean_value(
            raw_component.get("show_in_earnings"),
            default=category in {"earning", "employer_contribution"},
        ),
        "show_in_deductions": boolean_value(
            raw_component.get("show_in_deductions"),
            default=category == "deduction",
        ),
        "taxable": boolean_value(raw_component.get("taxable"), default=True),
        "is_active": boolean_value(raw_component.get("is_active"), default=True),
        "display_order": int(raw_component.get("display_order") or display_order),
    }

    if calculation_type == "fixed":
        component["amount"] = money_value(
            raw_component.get("amount", raw_component.get("value")),
            f"{code}.amount",
        )

    elif calculation_type == "percentage":
        base_component = normalize_code(
            raw_component.get("base_component")
            or raw_component.get("baseComponent")
            or "monthly_ctc"
        )

        if base_component == code:
            raise PayrollConfigError(
                f"Salary component {code} cannot be based on itself.",
                code="salary_component_self_reference",
            )

        component["percentage"] = percentage_value(
            raw_component.get("percentage", raw_component.get("value")),
            f"{code}.percentage",
        )
        component["base_component"] = base_component

    elif calculation_type == "balancing":
        component["balance_of"] = normalize_code(
            raw_component.get("balance_of")
            or raw_component.get("balanceOf")
            or "monthly_ctc"
        )
        component["minimum_amount"] = money_value(
            raw_component.get("minimum_amount", 0),
            f"{code}.minimum_amount",
        )

    elif calculation_type == "statutory":
        statutory_rule = normalize_code(
            raw_component.get("statutory_rule")
            or raw_component.get("statutoryRule")
        )

        if not statutory_rule:
            raise PayrollConfigError(
                f"Salary component {code} requires statutory_rule.",
                code="salary_component_statutory_rule_required",
            )

        component["statutory_rule"] = statutory_rule

    return component


def build_salary_structure_document(
    payload: dict[str, Any],
    *,
    tenant_id: str,
    actor_id: str,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = payload or {}
    existing = existing or {}

    employee_id = safe_str(payload.get("employee_id") or existing.get("employee_id"))

    if not employee_id:
        raise PayrollConfigError(
            "employee_id is required.",
            code="employee_id_required",
        )

    effective_from = parse_date_value(
        payload.get("effective_from") or existing.get("effective_from"),
        "effective_from",
    )
    effective_to = optional_date_value(
        payload.get("effective_to", existing.get("effective_to")),
        "effective_to",
    )

    if effective_to and effective_to < effective_from:
        raise PayrollConfigError(
            "effective_to cannot be before effective_from.",
            code="invalid_salary_structure_date_range",
        )

    annual_ctc = money_value(
        payload.get("annual_ctc", existing.get("annual_ctc")),
        "annual_ctc",
        required=False,
    )
    monthly_ctc = money_value(
        payload.get("monthly_ctc", existing.get("monthly_ctc")),
        "monthly_ctc",
        required=False,
    )

    if annual_ctc is None and monthly_ctc is None:
        raise PayrollConfigError(
            "annual_ctc or monthly_ctc is required.",
            code="ctc_required",
        )

    if annual_ctc is None:
        annual_ctc = round(float(monthly_ctc or 0) * 12, 2)

    if monthly_ctc is None:
        monthly_ctc = round(float(annual_ctc or 0) / 12, 2)

    expected_annual = round(float(monthly_ctc) * 12, 2)

    if abs(float(annual_ctc) - expected_annual) > 1:
        raise PayrollConfigError(
            "annual_ctc must equal monthly_ctc x 12.",
            code="ctc_mismatch",
        )

    raw_components = payload.get("components", existing.get("components", []))

    if not isinstance(raw_components, list) or not raw_components:
        raise PayrollConfigError(
            "At least one salary component is required.",
            code="salary_components_required",
        )

    components = [
        normalize_salary_component(component, index + 1)
        for index, component in enumerate(raw_components)
    ]
    ensure_unique_codes(components, "salary component")

    active_earning_codes = {
        component["code"]
        for component in components
        if component.get("is_active")
        and component.get("category") == "earning"
    }
    missing_codes = sorted(REQUIRED_EARNING_COMPONENT_CODES - active_earning_codes)

    if missing_codes:
        raise PayrollConfigError(
            "Missing required earnings components: " + ", ".join(missing_codes) + ".",
            code="required_salary_components_missing",
        )

    balancing_components = [
        component["code"]
        for component in components
        if component.get("calculation_type") == "balancing"
        and component.get("is_active")
    ]

    if len(balancing_components) > 1:
        raise PayrollConfigError(
            "Only one active balancing salary component is allowed.",
            code="multiple_balancing_components",
        )

    status = normalize_code(payload.get("status") or existing.get("status") or "draft")

    if status not in SALARY_STRUCTURE_STATUSES:
        raise PayrollConfigError(
            f"Unsupported salary structure status: {status}.",
            code="invalid_salary_structure_status",
        )

    current_time = now_utc()
    document = {
        "tenant_id": safe_str(tenant_id),
        "employee_id": employee_id,
        "employee_code": safe_str(
            payload.get("employee_code") or existing.get("employee_code")
        ),
        "employee_name": safe_str(
            payload.get("employee_name") or existing.get("employee_name")
        ),
        "structure_name": safe_str(
            payload.get("structure_name")
            or existing.get("structure_name")
            or "Standard Salary Structure"
        ),
        "template_id": safe_str(payload.get("template_id") or existing.get("template_id")),
        "state_code": normalize_state_code(
            payload.get("state_code") or existing.get("state_code") or "ALL"
        ),
        "effective_from": effective_from,
        "effective_to": effective_to,
        "annual_ctc": annual_ctc,
        "monthly_ctc": monthly_ctc,
        "currency": safe_str(
            payload.get("currency") or existing.get("currency") or "INR"
        ).upper(),
        "components": components,
        "status": status,
        "notes": safe_str(payload.get("notes") or existing.get("notes")),
        "updated_by": safe_str(actor_id),
        "updated_at": current_time,
        "is_deleted": False,
    }

    if not existing:
        document["created_by"] = safe_str(actor_id)
        document["created_at"] = current_time

    return document


def save_salary_structure_draft(
    db: Any,
    *,
    tenant_id: str,
    payload: dict[str, Any],
    actor_id: str,
) -> dict[str, Any]:
    draft_id = object_id_or_none(payload.get("id") or payload.get("_id"))
    existing = None

    if draft_id:
        existing = db.salary_structures.find_one({
            "_id": draft_id,
            "tenant_id": safe_str(tenant_id),
            "status": "draft",
            "is_deleted": {"$ne": True},
        })

        if not existing:
            raise PayrollConfigError(
                "Editable salary structure draft not found.",
                status_code=404,
                code="salary_structure_draft_not_found",
            )

    document = build_salary_structure_document(
        {**payload, "status": "draft"},
        tenant_id=tenant_id,
        actor_id=actor_id,
        existing=existing,
    )

    if existing:
        db.salary_structures.update_one(
            {"_id": existing["_id"]},
            {"$set": document},
        )
        return db.salary_structures.find_one({"_id": existing["_id"]})

    employee_query = {
        "tenant_id": safe_str(tenant_id),
        "employee_id": document["employee_id"],
        "is_deleted": {"$ne": True},
    }
    document["version"] = next_revision_number(db.salary_structures, employee_query)
    result = db.salary_structures.insert_one(document)
    return db.salary_structures.find_one({"_id": result.inserted_id})


def activate_salary_structure_revision(
    db: Any,
    *,
    tenant_id: str,
    salary_structure_id: Any,
    actor_id: str,
) -> dict[str, Any]:
    structure_id = object_id_or_none(salary_structure_id)

    if not structure_id:
        raise PayrollConfigError(
            "Invalid salary structure id.",
            code="invalid_salary_structure_id",
        )

    tenant_id = safe_str(tenant_id)
    draft = db.salary_structures.find_one({
        "_id": structure_id,
        "tenant_id": tenant_id,
        "status": "draft",
        "is_deleted": {"$ne": True},
    })

    if not draft:
        raise PayrollConfigError(
            "Salary structure draft not found.",
            status_code=404,
            code="salary_structure_draft_not_found",
        )

    effective_from = draft["effective_from"]
    current_active = db.salary_structures.find_one({
        "tenant_id": tenant_id,
        "employee_id": draft["employee_id"],
        "status": "active",
        "is_deleted": {"$ne": True},
    })

    if current_active and current_active.get("effective_from") >= effective_from:
        raise PayrollConfigError(
            "The new salary revision must start after the current active revision.",
            code="salary_structure_effective_date_conflict",
        )

    current_time = now_utc()

    if current_active:
        db.salary_structures.update_one(
            {"_id": current_active["_id"]},
            {
                "$set": {
                    "status": "superseded",
                    "effective_to": end_of_previous_day(effective_from),
                    "superseded_by": str(structure_id),
                    "updated_by": safe_str(actor_id),
                    "updated_at": current_time,
                }
            },
        )

    db.salary_structures.update_one(
        {"_id": structure_id},
        {
            "$set": {
                "status": "active",
                "activated_by": safe_str(actor_id),
                "activated_at": current_time,
                "updated_by": safe_str(actor_id),
                "updated_at": current_time,
            }
        },
    )

    return db.salary_structures.find_one({"_id": structure_id})


def get_effective_salary_structure(
    db: Any,
    *,
    tenant_id: str,
    employee_id: str,
    on_date: Any | None = None,
) -> dict[str, Any] | None:
    reference_date = (
        parse_date_value(on_date, "on_date")
        if on_date not in (None, "")
        else now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
    )

    return db.salary_structures.find_one(
        {
            "tenant_id": safe_str(tenant_id),
            "employee_id": safe_str(employee_id),
            "status": "active",
            "effective_from": {"$lte": reference_date},
            "$or": [
                {"effective_to": None},
                {"effective_to": {"$exists": False}},
                {"effective_to": {"$gte": reference_date}},
            ],
            "is_deleted": {"$ne": True},
        },
        sort=[("effective_from", -1), ("version", -1)],
    )


def list_salary_structure_history(
    db: Any,
    *,
    tenant_id: str,
    employee_id: str,
) -> list[dict[str, Any]]:
    return list(
        db.salary_structures.find({
            "tenant_id": safe_str(tenant_id),
            "employee_id": safe_str(employee_id),
            "is_deleted": {"$ne": True},
        }).sort([("version", -1), ("effective_from", -1)])
    )


def normalize_professional_tax_slabs(raw_slabs: Any) -> list[dict[str, Any]]:
    if raw_slabs in (None, ""):
        return []

    if not isinstance(raw_slabs, list):
        raise PayrollConfigError(
            "professional_tax.slabs must be a list.",
            code="invalid_professional_tax_slabs",
        )

    slabs: list[dict[str, Any]] = []

    for index, raw_slab in enumerate(raw_slabs):
        if not isinstance(raw_slab, dict):
            raise PayrollConfigError(
                "Each Professional Tax slab must be an object.",
                code="invalid_professional_tax_slab",
            )

        minimum_amount = money_value(
            raw_slab.get("minimum_amount", raw_slab.get("min")),
            f"professional_tax.slabs[{index}].minimum_amount",
        )
        maximum_amount = money_value(
            raw_slab.get("maximum_amount", raw_slab.get("max")),
            f"professional_tax.slabs[{index}].maximum_amount",
            required=False,
        )
        tax_amount = money_value(
            raw_slab.get("tax_amount", raw_slab.get("amount")),
            f"professional_tax.slabs[{index}].tax_amount",
        )

        if maximum_amount is not None and maximum_amount < minimum_amount:
            raise PayrollConfigError(
                "Professional Tax slab maximum cannot be below minimum.",
                code="invalid_professional_tax_slab_range",
            )

        slabs.append({
            "minimum_amount": minimum_amount,
            "maximum_amount": maximum_amount,
            "minimum_inclusive": boolean_value(
                raw_slab.get("minimum_inclusive"),
                default=True,
            ),
            "maximum_inclusive": boolean_value(
                raw_slab.get("maximum_inclusive"),
                default=True,
            ),
            "tax_amount": tax_amount,
        })

    slabs.sort(key=lambda item: item["minimum_amount"])

    for index in range(1, len(slabs)):
        previous = slabs[index - 1]
        current = slabs[index]

        if previous["maximum_amount"] is None:
            raise PayrollConfigError(
                "Only the final Professional Tax slab may have no maximum.",
                code="invalid_professional_tax_open_slab",
            )

        if current["minimum_amount"] < previous["maximum_amount"]:
            raise PayrollConfigError(
                "Professional Tax slabs cannot overlap.",
                code="overlapping_professional_tax_slabs",
            )

    return slabs


def normalize_pf_config(raw_pf: Any) -> dict[str, Any]:
    raw_pf = raw_pf or {}

    if not isinstance(raw_pf, dict):
        raise PayrollConfigError("pf must be an object.", code="invalid_pf_config")

    enabled = boolean_value(raw_pf.get("enabled"), default=False)

    return {
        "enabled": enabled,
        "employee_rate_percent": percentage_value(
            raw_pf.get("employee_rate_percent"),
            "pf.employee_rate_percent",
            required=enabled,
        ),
        "employer_rate_percent": percentage_value(
            raw_pf.get("employer_rate_percent"),
            "pf.employer_rate_percent",
            required=enabled,
        ),
        "wage_ceiling": money_value(
            raw_pf.get("wage_ceiling"),
            "pf.wage_ceiling",
            required=enabled,
        ),
        "wage_base_component_codes": [
            normalize_code(value)
            for value in raw_pf.get("wage_base_component_codes", ["basic"])
            if normalize_code(value)
        ],
        "allow_higher_wage_contribution": boolean_value(
            raw_pf.get("allow_higher_wage_contribution"),
            default=False,
        ),
        "employee_higher_wage_enabled": boolean_value(
            raw_pf.get("employee_higher_wage_enabled"),
            default=False,
        ),
        "employer_higher_wage_enabled": boolean_value(
            raw_pf.get("employer_higher_wage_enabled"),
            default=False,
        ),
        "show_employer_pf_as_earning": boolean_value(
            raw_pf.get("show_employer_pf_as_earning"),
            default=True,
        ),
        "show_employer_pf_as_deduction": boolean_value(
            raw_pf.get("show_employer_pf_as_deduction"),
            default=True,
        ),
    }


def normalize_esi_config(raw_esi: Any) -> dict[str, Any]:
    raw_esi = raw_esi or {}

    if not isinstance(raw_esi, dict):
        raise PayrollConfigError("esi must be an object.", code="invalid_esi_config")

    enabled = boolean_value(raw_esi.get("enabled"), default=False)

    return {
        "enabled": enabled,
        "employee_rate_percent": percentage_value(
            raw_esi.get("employee_rate_percent"),
            "esi.employee_rate_percent",
            required=enabled,
        ),
        "employer_rate_percent": percentage_value(
            raw_esi.get("employer_rate_percent"),
            "esi.employer_rate_percent",
            required=enabled,
        ),
        "wage_ceiling": money_value(
            raw_esi.get("wage_ceiling"),
            "esi.wage_ceiling",
            required=enabled,
        ),
        "wage_base": normalize_code(raw_esi.get("wage_base") or "gross_salary"),
    }


def normalize_tds_config(raw_tds: Any) -> dict[str, Any]:
    raw_tds = raw_tds or {}

    if not isinstance(raw_tds, dict):
        raise PayrollConfigError("tds must be an object.", code="invalid_tds_config")

    mode = normalize_code(raw_tds.get("mode") or "manual")

    if mode not in TDS_MODES:
        raise PayrollConfigError(
            f"Unsupported TDS mode: {mode}.",
            code="invalid_tds_mode",
        )

    return {
        "mode": mode,
        "enabled": mode != "disabled",
        "source": safe_str(raw_tds.get("source")),
    }


def normalize_lwp_config(raw_lwp: Any) -> dict[str, Any]:
    raw_lwp = raw_lwp or {}

    if not isinstance(raw_lwp, dict):
        raise PayrollConfigError("lwp must be an object.", code="invalid_lwp_config")

    divisor_mode = normalize_code(raw_lwp.get("divisor_mode"))

    # No default is applied intentionally. The company must explicitly choose
    # calendar_days, fixed_days, or working_days before payroll calculation.
    if divisor_mode and divisor_mode not in LWP_DIVISOR_MODES:
        raise PayrollConfigError(
            f"Unsupported LWP divisor mode: {divisor_mode}.",
            code="invalid_lwp_divisor_mode",
        )

    fixed_days = None

    if divisor_mode == "fixed_days":
        fixed_days_decimal = decimal_value(
            raw_lwp.get("fixed_days"),
            "lwp.fixed_days",
            minimum=Decimal("1"),
            maximum=Decimal("31"),
        )
        fixed_days = int(fixed_days_decimal or 0)

    return {
        "divisor_mode": divisor_mode or None,
        "fixed_days": fixed_days,
        "prorate_component_codes": [
            normalize_code(value)
            for value in raw_lwp.get(
                "prorate_component_codes",
                ["basic", "hra", "medical_allowance", "other_allowances"],
            )
            if normalize_code(value)
        ],
        "paid_leave_affects_salary": False,
    }


def build_statutory_config_document(
    payload: dict[str, Any],
    *,
    tenant_id: str,
    actor_id: str,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = payload or {}
    existing = existing or {}

    effective_from = parse_date_value(
        payload.get("effective_from") or existing.get("effective_from"),
        "effective_from",
    )
    effective_to = optional_date_value(
        payload.get("effective_to", existing.get("effective_to")),
        "effective_to",
    )

    if effective_to and effective_to < effective_from:
        raise PayrollConfigError(
            "effective_to cannot be before effective_from.",
            code="invalid_statutory_config_date_range",
        )

    state_code = normalize_state_code(
        payload.get("state_code") or existing.get("state_code")
    )
    status = normalize_code(payload.get("status") or existing.get("status") or "draft")

    if status not in STATUTORY_CONFIG_STATUSES:
        raise PayrollConfigError(
            f"Unsupported statutory config status: {status}.",
            code="invalid_statutory_config_status",
        )

    professional_tax_raw = payload.get(
        "professional_tax",
        existing.get("professional_tax", {}),
    ) or {}

    if not isinstance(professional_tax_raw, dict):
        raise PayrollConfigError(
            "professional_tax must be an object.",
            code="invalid_professional_tax_config",
        )

    pt_enabled = boolean_value(professional_tax_raw.get("enabled"), default=False)
    pt_slabs = normalize_professional_tax_slabs(professional_tax_raw.get("slabs"))

    if pt_enabled and not pt_slabs:
        raise PayrollConfigError(
            "Professional Tax slabs are required when Professional Tax is enabled.",
            code="professional_tax_slabs_required",
        )

    rounding_mode = normalize_code(
        payload.get("rounding_mode")
        or existing.get("rounding_mode")
        or "nearest_rupee"
    )

    if rounding_mode not in ROUNDING_MODES:
        raise PayrollConfigError(
            f"Unsupported rounding_mode: {rounding_mode}.",
            code="invalid_rounding_mode",
        )

    current_time = now_utc()
    document = {
        "tenant_id": safe_str(tenant_id),
        "state_code": state_code,
        "state_name": safe_str(
            payload.get("state_name") or existing.get("state_name")
        ),
        "effective_from": effective_from,
        "effective_to": effective_to,
        "pf": normalize_pf_config(payload.get("pf", existing.get("pf", {}))),
        "professional_tax": {
            "enabled": pt_enabled,
            "basis": normalize_code(
                professional_tax_raw.get("basis") or "gross_salary"
            ),
            "slabs": pt_slabs,
        },
        "esi": normalize_esi_config(payload.get("esi", existing.get("esi", {}))),
        "tds": normalize_tds_config(payload.get("tds", existing.get("tds", {}))),
        "lwp": normalize_lwp_config(payload.get("lwp", existing.get("lwp", {}))),
        "rounding_mode": rounding_mode,
        "status": status,
        "source_reference": safe_str(
            payload.get("source_reference") or existing.get("source_reference")
        ),
        "notes": safe_str(payload.get("notes") or existing.get("notes")),
        "updated_by": safe_str(actor_id),
        "updated_at": current_time,
        "is_deleted": False,
    }

    if not existing:
        document["created_by"] = safe_str(actor_id)
        document["created_at"] = current_time

    return document


def save_statutory_config_draft(
    db: Any,
    *,
    tenant_id: str,
    payload: dict[str, Any],
    actor_id: str,
) -> dict[str, Any]:
    draft_id = object_id_or_none(payload.get("id") or payload.get("_id"))
    existing = None

    if draft_id:
        existing = db.statutory_configs.find_one({
            "_id": draft_id,
            "tenant_id": safe_str(tenant_id),
            "status": "draft",
            "is_deleted": {"$ne": True},
        })

        if not existing:
            raise PayrollConfigError(
                "Editable statutory configuration draft not found.",
                status_code=404,
                code="statutory_config_draft_not_found",
            )

    document = build_statutory_config_document(
        {**payload, "status": "draft"},
        tenant_id=tenant_id,
        actor_id=actor_id,
        existing=existing,
    )

    if existing:
        db.statutory_configs.update_one(
            {"_id": existing["_id"]},
            {"$set": document},
        )
        return db.statutory_configs.find_one({"_id": existing["_id"]})

    revision_query = {
        "tenant_id": safe_str(tenant_id),
        "state_code": document["state_code"],
        "is_deleted": {"$ne": True},
    }
    document["version"] = next_revision_number(db.statutory_configs, revision_query)
    result = db.statutory_configs.insert_one(document)
    return db.statutory_configs.find_one({"_id": result.inserted_id})


def activate_statutory_config_revision(
    db: Any,
    *,
    tenant_id: str,
    statutory_config_id: Any,
    actor_id: str,
) -> dict[str, Any]:
    config_id = object_id_or_none(statutory_config_id)

    if not config_id:
        raise PayrollConfigError(
            "Invalid statutory configuration id.",
            code="invalid_statutory_config_id",
        )

    tenant_id = safe_str(tenant_id)
    draft = db.statutory_configs.find_one({
        "_id": config_id,
        "tenant_id": tenant_id,
        "status": "draft",
        "is_deleted": {"$ne": True},
    })

    if not draft:
        raise PayrollConfigError(
            "Statutory configuration draft not found.",
            status_code=404,
            code="statutory_config_draft_not_found",
        )

    effective_from = draft["effective_from"]
    current_active = db.statutory_configs.find_one({
        "tenant_id": tenant_id,
        "state_code": draft["state_code"],
        "status": "active",
        "is_deleted": {"$ne": True},
    })

    if current_active and current_active.get("effective_from") >= effective_from:
        raise PayrollConfigError(
            "The new statutory revision must start after the current active revision.",
            code="statutory_config_effective_date_conflict",
        )

    current_time = now_utc()

    if current_active:
        db.statutory_configs.update_one(
            {"_id": current_active["_id"]},
            {
                "$set": {
                    "status": "superseded",
                    "effective_to": end_of_previous_day(effective_from),
                    "superseded_by": str(config_id),
                    "updated_by": safe_str(actor_id),
                    "updated_at": current_time,
                }
            },
        )

    db.statutory_configs.update_one(
        {"_id": config_id},
        {
            "$set": {
                "status": "active",
                "activated_by": safe_str(actor_id),
                "activated_at": current_time,
                "updated_by": safe_str(actor_id),
                "updated_at": current_time,
            }
        },
    )

    return db.statutory_configs.find_one({"_id": config_id})


def get_effective_statutory_config(
    db: Any,
    *,
    tenant_id: str,
    state_code: str,
    on_date: Any | None = None,
) -> dict[str, Any] | None:
    reference_date = (
        parse_date_value(on_date, "on_date")
        if on_date not in (None, "")
        else now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
    )
    tenant_id = safe_str(tenant_id)
    requested_state = normalize_state_code(state_code)

    common_query = {
        "tenant_id": tenant_id,
        "status": "active",
        "effective_from": {"$lte": reference_date},
        "$or": [
            {"effective_to": None},
            {"effective_to": {"$exists": False}},
            {"effective_to": {"$gte": reference_date}},
        ],
        "is_deleted": {"$ne": True},
    }

    state_config = db.statutory_configs.find_one(
        {**common_query, "state_code": requested_state},
        sort=[("effective_from", -1), ("version", -1)],
    )

    if state_config or requested_state == "ALL":
        return state_config

    return db.statutory_configs.find_one(
        {**common_query, "state_code": "ALL"},
        sort=[("effective_from", -1), ("version", -1)],
    )


def list_statutory_config_history(
    db: Any,
    *,
    tenant_id: str,
    state_code: str,
) -> list[dict[str, Any]]:
    return list(
        db.statutory_configs.find({
            "tenant_id": safe_str(tenant_id),
            "state_code": normalize_state_code(state_code),
            "is_deleted": {"$ne": True},
        }).sort([("version", -1), ("effective_from", -1)])
    )


def clone_document(document: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return a defensive copy for callers that will enrich a config payload."""

    return deepcopy(document) if document else None