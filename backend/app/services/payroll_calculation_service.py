from __future__ import annotations

"""Pure payroll calculation engine.

This module deliberately has no Flask, MongoDB, or application-context imports.
It accepts plain dictionaries and returns a JSON-serialisable dictionary, so the
same calculation can be used by API routes, batch jobs, tests, and future CLI
maintenance scripts.

Important accounting treatment used here
----------------------------------------
The approved SDS payslip has a separate "Deduction against Leave without pay"
row. To avoid deducting LWP twice, contractual earnings are retained as the
payslip earning amounts while each component also exposes ``payable_amount``.
The difference between contractual and payable gross is the single LWP
 deduction included in total deductions.

TDS is never estimated by this module. When TDS is enabled in configuration, an
explicit manual/external amount must be supplied by the caller.
"""

from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_FLOOR
from decimal import ROUND_HALF_UP
from typing import Any, Iterable, Mapping, Sequence


ZERO = Decimal("0")
ONE = Decimal("1")
HUNDRED = Decimal("100")
MONEY_QUANTUM = Decimal("0.01")
RUPEE_QUANTUM = Decimal("1")

SUPPORTED_ROUNDING_MODES = {
    "nearest_rupee",
    "two_decimals",
    "floor",
    "ceil",
}
SUPPORTED_LWP_DIVISOR_MODES = {
    "calendar_days",
    "fixed_days",
    "working_days",
}
SUPPORTED_TDS_MODES = {
    "manual",
    "external",
    "disabled",
}


class PayrollCalculationError(Exception):
    """Raised when payroll input/configuration cannot be calculated safely."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "payroll_calculation_error",
        field: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.field = field

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "message": self.message,
            "code": self.code,
        }
        if self.field:
            payload["field"] = self.field
        return payload


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _normalize_code(value: Any) -> str:
    return (
        _safe_str(value)
        .lower()
        .replace("&", "and")
        .replace("-", "_")
        .replace("/", "_")
        .replace(" ", "_")
    )


def _bool_value(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return default
    return _safe_str(value).lower() in {"1", "true", "yes", "y", "on"}


def _decimal(
    value: Any,
    field: str,
    *,
    minimum: Decimal | None = ZERO,
    maximum: Decimal | None = None,
    required: bool = True,
) -> Decimal | None:
    if value in (None, ""):
        if required:
            raise PayrollCalculationError(
                f"{field} is required.",
                code="required_value_missing",
                field=field,
            )
        return None

    if isinstance(value, bool):
        raise PayrollCalculationError(
            f"{field} must be a number.",
            code="invalid_number",
            field=field,
        )

    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise PayrollCalculationError(
            f"{field} must be a valid number.",
            code="invalid_number",
            field=field,
        )

    if not result.is_finite():
        raise PayrollCalculationError(
            f"{field} must be finite.",
            code="invalid_number",
            field=field,
        )

    if minimum is not None and result < minimum:
        raise PayrollCalculationError(
            f"{field} must be at least {minimum}.",
            code="number_below_minimum",
            field=field,
        )

    if maximum is not None and result > maximum:
        raise PayrollCalculationError(
            f"{field} must not exceed {maximum}.",
            code="number_above_maximum",
            field=field,
        )

    return result


def _whole_or_fractional_days(value: Any, field: str) -> Decimal:
    return _decimal(value, field, minimum=ZERO) or ZERO


def _round_money(value: Decimal, mode: str) -> Decimal:
    normalized_mode = _normalize_code(mode or "nearest_rupee")

    if normalized_mode == "nearest_rupee":
        return value.quantize(RUPEE_QUANTUM, rounding=ROUND_HALF_UP)
    if normalized_mode == "two_decimals":
        return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    if normalized_mode == "floor":
        return value.quantize(RUPEE_QUANTUM, rounding=ROUND_FLOOR)
    if normalized_mode == "ceil":
        return value.quantize(RUPEE_QUANTUM, rounding=ROUND_CEILING)

    raise PayrollCalculationError(
        f"Unsupported rounding_mode: {normalized_mode}.",
        code="invalid_rounding_mode",
        field="statutory_config.rounding_mode",
    )


def _money_number(value: Decimal) -> int | float:
    rounded = value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    if rounded == rounded.to_integral_value():
        return int(rounded)
    return float(rounded)


def _ratio_number(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP))


def _sum(values: Iterable[Decimal]) -> Decimal:
    return sum(values, ZERO)


def _active_components(salary_structure: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw_components = salary_structure.get("components")
    if not isinstance(raw_components, list) or not raw_components:
        raise PayrollCalculationError(
            "salary_structure.components must contain at least one component.",
            code="salary_components_required",
            field="salary_structure.components",
        )

    components: list[dict[str, Any]] = []
    seen_codes: set[str] = set()

    for index, raw in enumerate(raw_components):
        if not isinstance(raw, Mapping):
            raise PayrollCalculationError(
                f"salary_structure.components[{index}] must be an object.",
                code="invalid_salary_component",
                field=f"salary_structure.components[{index}]",
            )

        if not _bool_value(raw.get("is_active"), default=True):
            continue

        code = _normalize_code(raw.get("code") or raw.get("name"))
        if not code:
            raise PayrollCalculationError(
                f"salary_structure.components[{index}].code is required.",
                code="salary_component_code_required",
                field=f"salary_structure.components[{index}].code",
            )
        if code in seen_codes:
            raise PayrollCalculationError(
                f"Duplicate active salary component code: {code}.",
                code="duplicate_salary_component_code",
                field="salary_structure.components",
            )
        seen_codes.add(code)

        category = _normalize_code(raw.get("category") or "earning")
        calculation_type = _normalize_code(
            raw.get("calculation_type")
            or raw.get("calculationType")
            or "fixed"
        )

        components.append(
            {
                **dict(raw),
                "code": code,
                "label": _safe_str(raw.get("label") or raw.get("name") or code),
                "category": category,
                "calculation_type": calculation_type,
                "display_order": int(raw.get("display_order") or index + 1),
                "include_in_gross": _bool_value(
                    raw.get("include_in_gross"),
                    default=category == "earning",
                ),
                "include_in_ctc": _bool_value(
                    raw.get("include_in_ctc"),
                    default=category in {"earning", "employer_contribution"},
                ),
                "show_in_earnings": _bool_value(
                    raw.get("show_in_earnings"),
                    default=category in {"earning", "employer_contribution"},
                ),
                "show_in_deductions": _bool_value(
                    raw.get("show_in_deductions"),
                    default=category == "deduction",
                ),
                "prorate_on_lwp": _bool_value(
                    raw.get("prorate_on_lwp"),
                    default=category == "earning",
                ),
            }
        )

    if not components:
        raise PayrollCalculationError(
            "No active salary components are available.",
            code="active_salary_components_required",
            field="salary_structure.components",
        )

    return components


def _resolve_lwp(
    attendance: Mapping[str, Any],
    statutory_config: Mapping[str, Any],
) -> dict[str, Any]:
    lwp_days = _whole_or_fractional_days(
        attendance.get("lwp_days", attendance.get("lwpDays", 0)),
        "attendance.lwp_days",
    )
    total_days = _whole_or_fractional_days(
        attendance.get("total_days", attendance.get("totalDays")),
        "attendance.total_days",
    )
    if total_days <= ZERO:
        raise PayrollCalculationError(
            "attendance.total_days must be greater than zero.",
            code="invalid_total_days",
            field="attendance.total_days",
        )

    paid_leave_days = _whole_or_fractional_days(
        attendance.get(
            "paid_leave_days",
            attendance.get(
                "paidLeaveDays",
                attendance.get("leave_availed", attendance.get("leaveAvailed", 0)),
            ),
        ),
        "attendance.paid_leave_days",
    )

    lwp_config = statutory_config.get("lwp") or {}
    if not isinstance(lwp_config, Mapping):
        raise PayrollCalculationError(
            "statutory_config.lwp must be an object.",
            code="invalid_lwp_config",
            field="statutory_config.lwp",
        )

    divisor_mode = _normalize_code(lwp_config.get("divisor_mode"))

    if lwp_days > ZERO and not divisor_mode:
        raise PayrollCalculationError(
            "LWP divisor is not configured. Select calendar_days, fixed_days, or working_days before calculating payroll with LWP.",
            code="lwp_divisor_not_configured",
            field="statutory_config.lwp.divisor_mode",
        )

    if divisor_mode and divisor_mode not in SUPPORTED_LWP_DIVISOR_MODES:
        raise PayrollCalculationError(
            f"Unsupported LWP divisor mode: {divisor_mode}.",
            code="invalid_lwp_divisor_mode",
            field="statutory_config.lwp.divisor_mode",
        )

    if divisor_mode == "fixed_days":
        divisor_days = _whole_or_fractional_days(
            lwp_config.get("fixed_days"),
            "statutory_config.lwp.fixed_days",
        )
    elif divisor_mode == "working_days":
        divisor_days = _whole_or_fractional_days(
            attendance.get("working_days", attendance.get("workingDays")),
            "attendance.working_days",
        )
    else:
        # With no LWP, calendar days are safe for informational output even if
        # HR has not selected the future LWP policy yet.
        divisor_mode = divisor_mode or "calendar_days"
        divisor_days = total_days

    if divisor_days <= ZERO:
        raise PayrollCalculationError(
            "The selected LWP divisor must be greater than zero.",
            code="invalid_lwp_divisor",
            field="statutory_config.lwp",
        )
    if lwp_days > divisor_days:
        raise PayrollCalculationError(
            "attendance.lwp_days cannot exceed the selected LWP divisor.",
            code="lwp_days_exceed_divisor",
            field="attendance.lwp_days",
        )

    payable_days = divisor_days - lwp_days
    proration_factor = payable_days / divisor_days

    configured_codes = lwp_config.get("prorate_component_codes") or [
        "basic",
        "hra",
        "medical_allowance",
        "other_allowances",
    ]
    if not isinstance(configured_codes, Sequence) or isinstance(
        configured_codes, (str, bytes)
    ):
        raise PayrollCalculationError(
            "statutory_config.lwp.prorate_component_codes must be a list.",
            code="invalid_lwp_component_codes",
            field="statutory_config.lwp.prorate_component_codes",
        )

    return {
        "total_days": total_days,
        "working_days": _decimal(
            attendance.get("working_days", attendance.get("workingDays")),
            "attendance.working_days",
            minimum=ZERO,
            required=False,
        ),
        "paid_leave_days": paid_leave_days,
        "lwp_days": lwp_days,
        "divisor_mode": divisor_mode,
        "divisor_days": divisor_days,
        "payable_days": payable_days,
        "proration_factor": proration_factor,
        "prorate_component_codes": {
            _normalize_code(code) for code in configured_codes if _normalize_code(code)
        },
    }


def _component_metadata(
    components: Sequence[Mapping[str, Any]],
    statutory_rule: str,
    *,
    fallback_code: str,
    fallback_label: str,
    fallback_category: str,
    fallback_order: int,
) -> dict[str, Any]:
    wanted = _normalize_code(statutory_rule)
    for component in components:
        if (
            component.get("calculation_type") == "statutory"
            and _normalize_code(component.get("statutory_rule")) == wanted
        ):
            return dict(component)

    return {
        "code": fallback_code,
        "label": fallback_label,
        "category": fallback_category,
        "calculation_type": "statutory",
        "statutory_rule": wanted,
        "display_order": fallback_order,
        "include_in_gross": False,
        "include_in_ctc": fallback_category == "employer_contribution",
        "show_in_earnings": fallback_category == "employer_contribution",
        "show_in_deductions": fallback_category == "deduction",
        "prorate_on_lwp": False,
    }


def _resolve_non_statutory_components(
    salary_structure: Mapping[str, Any],
    components: Sequence[Mapping[str, Any]],
) -> dict[str, Decimal]:
    monthly_ctc = _decimal(
        salary_structure.get("monthly_ctc", salary_structure.get("monthlyCtc")),
        "salary_structure.monthly_ctc",
        minimum=ZERO,
    ) or ZERO
    annual_ctc = _decimal(
        salary_structure.get("annual_ctc", salary_structure.get("annualCtc")),
        "salary_structure.annual_ctc",
        minimum=ZERO,
        required=False,
    )
    if annual_ctc is None:
        annual_ctc = monthly_ctc * Decimal("12")

    by_code = {component["code"]: component for component in components}
    resolved: dict[str, Decimal] = {}
    resolving: set[str] = set()

    def resolve(code: str) -> Decimal:
        normalized_code = _normalize_code(code)
        if normalized_code == "monthly_ctc":
            return monthly_ctc
        if normalized_code == "annual_ctc":
            return annual_ctc
        if normalized_code in resolved:
            return resolved[normalized_code]
        if normalized_code in resolving:
            raise PayrollCalculationError(
                f"Circular salary component dependency detected at {normalized_code}.",
                code="salary_component_dependency_cycle",
                field="salary_structure.components",
            )

        component = by_code.get(normalized_code)
        if not component:
            raise PayrollCalculationError(
                f"Salary component base {normalized_code} was not found.",
                code="salary_component_base_not_found",
                field="salary_structure.components",
            )

        calculation_type = component.get("calculation_type")
        if calculation_type in {"statutory", "balancing"}:
            raise PayrollCalculationError(
                f"Component {normalized_code} cannot be used as a base before it is calculated.",
                code="unresolved_salary_component_base",
                field=f"salary_structure.components.{normalized_code}",
            )

        resolving.add(normalized_code)
        try:
            if calculation_type == "fixed":
                value = _decimal(
                    component.get("amount", component.get("value")),
                    f"salary_structure.components.{normalized_code}.amount",
                    minimum=ZERO,
                ) or ZERO
            elif calculation_type == "percentage":
                percentage = _decimal(
                    component.get("percentage", component.get("value")),
                    f"salary_structure.components.{normalized_code}.percentage",
                    minimum=ZERO,
                    maximum=HUNDRED,
                ) or ZERO
                base_code = _normalize_code(
                    component.get("base_component")
                    or component.get("baseComponent")
                    or "monthly_ctc"
                )
                value = resolve(base_code) * percentage / HUNDRED
            else:
                raise PayrollCalculationError(
                    f"Unsupported calculation_type for {normalized_code}: {calculation_type}.",
                    code="unsupported_salary_component_calculation_type",
                    field=f"salary_structure.components.{normalized_code}.calculation_type",
                )

            resolved[normalized_code] = value
            return value
        finally:
            resolving.discard(normalized_code)

    for component in components:
        if component.get("calculation_type") not in {"balancing", "statutory"}:
            resolve(component["code"])

    return resolved


def _wage_from_codes(
    amount_by_code: Mapping[str, Decimal],
    codes: Sequence[Any],
    *,
    field: str,
) -> Decimal:
    normalized_codes = [_normalize_code(code) for code in codes if _normalize_code(code)]
    if not normalized_codes:
        raise PayrollCalculationError(
            f"{field} must contain at least one salary component code.",
            code="statutory_wage_base_required",
            field=field,
        )

    missing = [code for code in normalized_codes if code not in amount_by_code]
    if missing:
        raise PayrollCalculationError(
            f"Statutory wage base component(s) not found: {', '.join(missing)}.",
            code="statutory_wage_component_not_found",
            field=field,
        )

    return _sum(amount_by_code[code] for code in normalized_codes)


def _pf_values(
    pf_config: Mapping[str, Any],
    amount_by_code: Mapping[str, Decimal],
) -> dict[str, Decimal | bool]:
    enabled = _bool_value(pf_config.get("enabled"), default=False)
    if not enabled:
        return {
            "enabled": False,
            "base_wage": ZERO,
            "employee_wage": ZERO,
            "employer_wage": ZERO,
            "employee_amount": ZERO,
            "employer_amount": ZERO,
        }

    employee_rate = _decimal(
        pf_config.get("employee_rate_percent"),
        "statutory_config.pf.employee_rate_percent",
        minimum=ZERO,
        maximum=HUNDRED,
    ) or ZERO
    employer_rate = _decimal(
        pf_config.get("employer_rate_percent"),
        "statutory_config.pf.employer_rate_percent",
        minimum=ZERO,
        maximum=HUNDRED,
    ) or ZERO
    ceiling = _decimal(
        pf_config.get("wage_ceiling"),
        "statutory_config.pf.wage_ceiling",
        minimum=ZERO,
    ) or ZERO

    codes = pf_config.get("wage_base_component_codes") or ["basic"]
    if not isinstance(codes, Sequence) or isinstance(codes, (str, bytes)):
        raise PayrollCalculationError(
            "statutory_config.pf.wage_base_component_codes must be a list.",
            code="invalid_pf_wage_base_codes",
            field="statutory_config.pf.wage_base_component_codes",
        )

    base_wage = _wage_from_codes(
        amount_by_code,
        codes,
        field="statutory_config.pf.wage_base_component_codes",
    )
    allow_higher = _bool_value(
        pf_config.get("allow_higher_wage_contribution"),
        default=False,
    )
    employee_higher = allow_higher and _bool_value(
        pf_config.get("employee_higher_wage_enabled"),
        default=False,
    )
    employer_higher = allow_higher and _bool_value(
        pf_config.get("employer_higher_wage_enabled"),
        default=False,
    )

    employee_wage = base_wage if employee_higher else min(base_wage, ceiling)
    employer_wage = base_wage if employer_higher else min(base_wage, ceiling)

    return {
        "enabled": True,
        "base_wage": base_wage,
        "employee_wage": employee_wage,
        "employer_wage": employer_wage,
        "employee_amount": employee_wage * employee_rate / HUNDRED,
        "employer_amount": employer_wage * employer_rate / HUNDRED,
    }


def _esi_values(
    esi_config: Mapping[str, Any],
    amount_by_code: Mapping[str, Decimal],
    gross_salary: Decimal,
) -> dict[str, Decimal | bool]:
    enabled = _bool_value(esi_config.get("enabled"), default=False)
    if not enabled:
        return {
            "enabled": False,
            "eligible": False,
            "wage": ZERO,
            "employee_amount": ZERO,
            "employer_amount": ZERO,
        }

    employee_rate = _decimal(
        esi_config.get("employee_rate_percent"),
        "statutory_config.esi.employee_rate_percent",
        minimum=ZERO,
        maximum=HUNDRED,
    ) or ZERO
    employer_rate = _decimal(
        esi_config.get("employer_rate_percent"),
        "statutory_config.esi.employer_rate_percent",
        minimum=ZERO,
        maximum=HUNDRED,
    ) or ZERO
    ceiling = _decimal(
        esi_config.get("wage_ceiling"),
        "statutory_config.esi.wage_ceiling",
        minimum=ZERO,
    ) or ZERO
    wage_base = _normalize_code(esi_config.get("wage_base") or "gross_salary")

    if wage_base in {"gross", "gross_salary", "payable_gross_salary"}:
        wage = gross_salary
    else:
        if wage_base not in amount_by_code:
            raise PayrollCalculationError(
                f"ESI wage base component not found: {wage_base}.",
                code="esi_wage_base_not_found",
                field="statutory_config.esi.wage_base",
            )
        wage = amount_by_code[wage_base]

    eligible = wage <= ceiling
    return {
        "enabled": True,
        "eligible": eligible,
        "wage": wage,
        "employee_amount": wage * employee_rate / HUNDRED if eligible else ZERO,
        "employer_amount": wage * employer_rate / HUNDRED if eligible else ZERO,
    }


def _professional_tax_amount(
    pt_config: Mapping[str, Any],
    *,
    gross_salary: Decimal,
    monthly_ctc: Decimal,
    amount_by_code: Mapping[str, Decimal],
) -> tuple[Decimal, Decimal]:
    if not _bool_value(pt_config.get("enabled"), default=False):
        return ZERO, gross_salary

    basis_code = _normalize_code(pt_config.get("basis") or "gross_salary")
    if basis_code in {"gross", "gross_salary", "payable_gross_salary"}:
        basis = gross_salary
    elif basis_code == "monthly_ctc":
        basis = monthly_ctc
    elif basis_code in amount_by_code:
        basis = amount_by_code[basis_code]
    else:
        raise PayrollCalculationError(
            f"Professional Tax basis is not available: {basis_code}.",
            code="professional_tax_basis_not_found",
            field="statutory_config.professional_tax.basis",
        )

    slabs = pt_config.get("slabs")
    if not isinstance(slabs, list) or not slabs:
        raise PayrollCalculationError(
            "Professional Tax is enabled but no slabs are configured.",
            code="professional_tax_slabs_required",
            field="statutory_config.professional_tax.slabs",
        )

    for index, slab in enumerate(slabs):
        if not isinstance(slab, Mapping):
            raise PayrollCalculationError(
                f"Professional Tax slab {index} must be an object.",
                code="invalid_professional_tax_slab",
                field=f"statutory_config.professional_tax.slabs[{index}]",
            )

        minimum = _decimal(
            slab.get("minimum_amount", slab.get("min", 0)),
            f"statutory_config.professional_tax.slabs[{index}].minimum_amount",
            minimum=ZERO,
        ) or ZERO
        maximum = _decimal(
            slab.get("maximum_amount", slab.get("max")),
            f"statutory_config.professional_tax.slabs[{index}].maximum_amount",
            minimum=ZERO,
            required=False,
        )
        tax = _decimal(
            slab.get("tax_amount", slab.get("amount")),
            f"statutory_config.professional_tax.slabs[{index}].tax_amount",
            minimum=ZERO,
        ) or ZERO
        minimum_inclusive = _bool_value(
            slab.get("minimum_inclusive"),
            default=True,
        )
        maximum_inclusive = _bool_value(
            slab.get("maximum_inclusive"),
            default=True,
        )

        minimum_matches = basis >= minimum if minimum_inclusive else basis > minimum
        maximum_matches = (
            True
            if maximum is None
            else (basis <= maximum if maximum_inclusive else basis < maximum)
        )
        if minimum_matches and maximum_matches:
            return tax, basis

    raise PayrollCalculationError(
        f"No Professional Tax slab matches the calculated basis amount {basis}.",
        code="professional_tax_slab_not_found",
        field="statutory_config.professional_tax.slabs",
    )


def _tds_amount(
    tds_config: Mapping[str, Any],
    inputs: Mapping[str, Any],
) -> tuple[Decimal, str]:
    mode = _normalize_code(tds_config.get("mode") or "manual")
    if mode not in SUPPORTED_TDS_MODES:
        raise PayrollCalculationError(
            f"Unsupported TDS mode: {mode}.",
            code="invalid_tds_mode",
            field="statutory_config.tds.mode",
        )

    if mode == "disabled":
        return ZERO, mode

    explicit_key_present = "tds_amount" in inputs or "tdsAmount" in inputs
    if not explicit_key_present:
        raise PayrollCalculationError(
            "TDS is enabled but no explicit tds_amount was supplied. This engine does not estimate TDS.",
            code="tds_amount_required",
            field="inputs.tds_amount",
        )

    return (
        _decimal(
            inputs.get("tds_amount", inputs.get("tdsAmount")),
            "inputs.tds_amount",
            minimum=ZERO,
        )
        or ZERO,
        mode,
    )


def _advance_lines(inputs: Mapping[str, Any]) -> tuple[list[dict[str, Any]], Decimal]:
    raw_advances = inputs.get("advances", inputs.get("advance_details", []))
    if raw_advances in (None, ""):
        raw_advances = []
    if not isinstance(raw_advances, list):
        raise PayrollCalculationError(
            "inputs.advances must be a list.",
            code="invalid_advances",
            field="inputs.advances",
        )

    lines: list[dict[str, Any]] = []
    total = ZERO

    for index, raw in enumerate(raw_advances):
        if not isinstance(raw, Mapping):
            raise PayrollCalculationError(
                f"inputs.advances[{index}] must be an object.",
                code="invalid_advance",
                field=f"inputs.advances[{index}]",
            )
        status = _normalize_code(raw.get("status") or "active")
        if status not in {"active", "approved", "disbursed", "recovering"}:
            continue

        amount = _decimal(
            raw.get(
                "deduction_amount",
                raw.get("emi_amount", raw.get("amount", 0)),
            ),
            f"inputs.advances[{index}].deduction_amount",
            minimum=ZERO,
        ) or ZERO
        if amount == ZERO:
            continue

        code = _normalize_code(raw.get("type") or raw.get("code") or "advance")
        label = _safe_str(raw.get("label") or raw.get("type") or "Advance")
        lines.append(
            {
                "code": code,
                "label": label,
                "amount_decimal": amount,
                "reference_id": _safe_str(raw.get("id") or raw.get("_id")),
                "remaining_balance": _decimal(
                    raw.get("remaining_balance", raw.get("remainingBalance")),
                    f"inputs.advances[{index}].remaining_balance",
                    minimum=ZERO,
                    required=False,
                ),
                "display_order": 700 + index,
            }
        )
        total += amount

    explicit_total_present = "advance_amount" in inputs or "advanceAmount" in inputs
    if explicit_total_present:
        explicit_total = _decimal(
            inputs.get("advance_amount", inputs.get("advanceAmount")),
            "inputs.advance_amount",
            minimum=ZERO,
        ) or ZERO
        if lines and explicit_total != total:
            raise PayrollCalculationError(
                "inputs.advance_amount does not match the sum of inputs.advances.",
                code="advance_total_mismatch",
                field="inputs.advance_amount",
            )
        if not lines and explicit_total > ZERO:
            lines.append(
                {
                    "code": "advances",
                    "label": "Advances",
                    "amount_decimal": explicit_total,
                    "reference_id": "",
                    "remaining_balance": None,
                    "display_order": 700,
                }
            )
            total = explicit_total

    return lines, total


def _line(
    *,
    code: str,
    label: str,
    amount: Decimal,
    display_order: int,
    category: str,
    full_amount: Decimal | None = None,
    payable_amount: Decimal | None = None,
    source: str = "salary_structure",
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    item = {
        "code": _normalize_code(code),
        "label": label,
        "category": category,
        "amount": _money_number(amount),
        "display_order": int(display_order),
        "source": source,
    }
    if full_amount is not None:
        item["full_amount"] = _money_number(full_amount)
    if payable_amount is not None:
        item["payable_amount"] = _money_number(payable_amount)
    if metadata:
        item["metadata"] = dict(metadata)
    return item


def calculate_payroll(
    *,
    salary_structure: Mapping[str, Any],
    statutory_config: Mapping[str, Any],
    attendance: Mapping[str, Any],
    inputs: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Calculate one employee's payroll without reading or writing a database.

    Args:
        salary_structure: Active salary-structure document produced by
            ``payroll_config_service``.
        statutory_config: Effective state/default statutory configuration.
        attendance: Monthly attendance summary. ``total_days`` is required;
            ``working_days`` is required only for working-day LWP policy.
        inputs: Explicit non-derived values such as ``tds_amount`` and active
            ``advances``.

    Returns:
        A JSON-serialisable payroll calculation snapshot.

    Raises:
        PayrollCalculationError: When a monetary rule is missing, ambiguous, or
            invalid. No database mutation occurs.
    """

    if not isinstance(salary_structure, Mapping):
        raise PayrollCalculationError(
            "salary_structure must be an object.",
            code="invalid_salary_structure",
            field="salary_structure",
        )
    if not isinstance(statutory_config, Mapping):
        raise PayrollCalculationError(
            "statutory_config must be an object.",
            code="invalid_statutory_config",
            field="statutory_config",
        )
    if not isinstance(attendance, Mapping):
        raise PayrollCalculationError(
            "attendance must be an object.",
            code="invalid_attendance",
            field="attendance",
        )
    inputs = inputs or {}
    if not isinstance(inputs, Mapping):
        raise PayrollCalculationError(
            "inputs must be an object.",
            code="invalid_calculation_inputs",
            field="inputs",
        )

    rounding_mode = _normalize_code(
        statutory_config.get("rounding_mode") or "nearest_rupee"
    )
    if rounding_mode not in SUPPORTED_ROUNDING_MODES:
        raise PayrollCalculationError(
            f"Unsupported rounding_mode: {rounding_mode}.",
            code="invalid_rounding_mode",
            field="statutory_config.rounding_mode",
        )

    monthly_ctc = _decimal(
        salary_structure.get("monthly_ctc", salary_structure.get("monthlyCtc")),
        "salary_structure.monthly_ctc",
        minimum=ZERO,
    ) or ZERO
    components = _active_components(salary_structure)
    lwp = _resolve_lwp(attendance, statutory_config)
    full_amounts = _resolve_non_statutory_components(salary_structure, components)

    balancing_components = [
        component
        for component in components
        if component.get("calculation_type") == "balancing"
    ]
    if len(balancing_components) > 1:
        raise PayrollCalculationError(
            "Only one active balancing salary component is supported.",
            code="multiple_balancing_components",
            field="salary_structure.components",
        )

    pf_config = statutory_config.get("pf") or {}
    esi_config = statutory_config.get("esi") or {}
    pt_config = statutory_config.get("professional_tax") or {}
    tds_config = statutory_config.get("tds") or {}
    if not all(
        isinstance(item, Mapping)
        for item in (pf_config, esi_config, pt_config, tds_config)
    ):
        raise PayrollCalculationError(
            "PF, ESI, Professional Tax, and TDS configurations must be objects.",
            code="invalid_statutory_section",
            field="statutory_config",
        )

    # A balancing component can safely account for employer PF because PF is
    # normally based on Basic. It cannot safely close a CTC containing an ESI
    # employer contribution based on gross salary without creating a circular
    # equation, so that unsupported combination is rejected explicitly.
    if balancing_components and _bool_value(esi_config.get("enabled"), False):
        esi_wage_base = _normalize_code(esi_config.get("wage_base") or "gross_salary")
        if esi_wage_base in {"gross", "gross_salary", "payable_gross_salary"}:
            raise PayrollCalculationError(
                "A balancing salary component cannot be combined with gross-based ESI because it creates a circular CTC calculation. Use fixed components or a non-gross ESI wage base.",
                code="balancing_esi_calculation_cycle",
                field="salary_structure.components",
            )

    contractual_pf = _pf_values(pf_config, full_amounts)

    contractual_gross_before_balance = _sum(
        full_amounts.get(component["code"], ZERO)
        for component in components
        if component.get("calculation_type") not in {"statutory", "balancing"}
        and component.get("include_in_gross")
    )
    contractual_esi = _esi_values(
        esi_config,
        full_amounts,
        contractual_gross_before_balance,
    )

    if balancing_components:
        balancing = balancing_components[0]
        code = balancing["code"]
        balance_of = _normalize_code(
            balancing.get("balance_of")
            or balancing.get("balanceOf")
            or "monthly_ctc"
        )
        if balance_of == "monthly_ctc":
            target = monthly_ctc
        elif balance_of == "annual_ctc":
            annual = _decimal(
                salary_structure.get("annual_ctc", salary_structure.get("annualCtc")),
                "salary_structure.annual_ctc",
                minimum=ZERO,
            ) or ZERO
            target = annual / Decimal("12")
        elif balance_of in full_amounts:
            target = full_amounts[balance_of]
        else:
            raise PayrollCalculationError(
                f"Balancing target was not found: {balance_of}.",
                code="balancing_target_not_found",
                field=f"salary_structure.components.{code}.balance_of",
            )

        occupied_ctc = _sum(
            full_amounts.get(component["code"], ZERO)
            for component in components
            if component.get("calculation_type") not in {"statutory", "balancing"}
            and component.get("include_in_ctc")
        )
        occupied_ctc += Decimal(str(contractual_pf["employer_amount"]))
        occupied_ctc += Decimal(str(contractual_esi["employer_amount"]))

        minimum_amount = _decimal(
            balancing.get("minimum_amount", 0),
            f"salary_structure.components.{code}.minimum_amount",
            minimum=ZERO,
        ) or ZERO
        balance_amount = target - occupied_ctc
        if balance_amount < minimum_amount:
            raise PayrollCalculationError(
                f"Balancing component {code} would be {balance_amount}, below its minimum {minimum_amount}.",
                code="balancing_component_below_minimum",
                field=f"salary_structure.components.{code}",
            )
        full_amounts[code] = balance_amount

    # Apply LWP proportion to configured earning components. Paid leave is
    # intentionally ignored; it never changes the factor.
    payable_amounts: dict[str, Decimal] = {}
    for component in components:
        if component.get("calculation_type") == "statutory":
            continue
        code = component["code"]
        full_amount = full_amounts.get(code, ZERO)
        should_prorate = (
            lwp["lwp_days"] > ZERO
            and component.get("prorate_on_lwp")
            and code in lwp["prorate_component_codes"]
        )
        payable_amounts[code] = (
            full_amount * lwp["proration_factor"] if should_prorate else full_amount
        )

    contractual_gross = _sum(
        full_amounts.get(component["code"], ZERO)
        for component in components
        if component.get("calculation_type") != "statutory"
        and component.get("include_in_gross")
    )
    payable_gross = _sum(
        payable_amounts.get(component["code"], ZERO)
        for component in components
        if component.get("calculation_type") != "statutory"
        and component.get("include_in_gross")
    )
    lwp_deduction = max(contractual_gross - payable_gross, ZERO)

    current_pf = _pf_values(pf_config, payable_amounts)
    current_esi = _esi_values(esi_config, payable_amounts, payable_gross)
    pt_amount, pt_basis = _professional_tax_amount(
        pt_config,
        gross_salary=payable_gross,
        monthly_ctc=monthly_ctc,
        amount_by_code=payable_amounts,
    )
    tds_amount, tds_mode = _tds_amount(tds_config, inputs)
    advance_details, advances_total = _advance_lines(inputs)

    earnings: list[dict[str, Any]] = []
    fixed_deductions: list[dict[str, Any]] = []

    for component in components:
        if component.get("calculation_type") == "statutory":
            continue
        code = component["code"]
        full = _round_money(full_amounts.get(code, ZERO), rounding_mode)
        payable = _round_money(payable_amounts.get(code, ZERO), rounding_mode)

        if component.get("show_in_earnings"):
            earnings.append(
                _line(
                    code=code,
                    label=component["label"],
                    amount=full,
                    full_amount=full,
                    payable_amount=payable,
                    display_order=component["display_order"],
                    category=component["category"],
                )
            )
        if component.get("show_in_deductions"):
            fixed_deductions.append(
                _line(
                    code=code,
                    label=component["label"],
                    amount=payable,
                    full_amount=full,
                    payable_amount=payable,
                    display_order=component["display_order"],
                    category="deduction",
                )
            )

    pf_employee = _round_money(
        Decimal(str(current_pf["employee_amount"])),
        rounding_mode,
    )
    pf_employer = _round_money(
        Decimal(str(current_pf["employer_amount"])),
        rounding_mode,
    )
    esi_employee = _round_money(
        Decimal(str(current_esi["employee_amount"])),
        rounding_mode,
    )
    esi_employer = _round_money(
        Decimal(str(current_esi["employer_amount"])),
        rounding_mode,
    )
    professional_tax = _round_money(pt_amount, rounding_mode)
    tds = _round_money(tds_amount, rounding_mode)
    lwp_deduction_rounded = _round_money(lwp_deduction, rounding_mode)

    employer_contributions: list[dict[str, Any]] = []

    pf_employer_meta = _component_metadata(
        components,
        "pf_employer",
        fallback_code="pf_employer",
        fallback_label="Employer's Contribution towards PF",
        fallback_category="employer_contribution",
        fallback_order=50,
    )
    if current_pf["enabled"]:
        pf_employer_line = _line(
            code=pf_employer_meta["code"],
            label=pf_employer_meta["label"],
            amount=pf_employer,
            full_amount=_round_money(
                Decimal(str(contractual_pf["employer_amount"])),
                rounding_mode,
            ),
            payable_amount=pf_employer,
            display_order=pf_employer_meta["display_order"],
            category="employer_contribution",
            source="statutory_config",
            metadata={
                "rule": "pf_employer",
                "wage": _money_number(
                    _round_money(
                        Decimal(str(current_pf["employer_wage"])),
                        rounding_mode,
                    )
                ),
            },
        )
        employer_contributions.append(pf_employer_line)
        if _bool_value(
            pf_config.get("show_employer_pf_as_earning"),
            default=True,
        ):
            earnings.append(dict(pf_employer_line))

    if current_esi["enabled"] and current_esi["eligible"]:
        esi_employer_meta = _component_metadata(
            components,
            "esi_employer",
            fallback_code="esi_employer",
            fallback_label="Employer's ESI Contribution",
            fallback_category="employer_contribution",
            fallback_order=55,
        )
        esi_employer_line = _line(
            code=esi_employer_meta["code"],
            label=esi_employer_meta["label"],
            amount=esi_employer,
            display_order=esi_employer_meta["display_order"],
            category="employer_contribution",
            source="statutory_config",
            metadata={"rule": "esi_employer"},
        )
        employer_contributions.append(esi_employer_line)
        if esi_employer_meta.get("show_in_earnings"):
            earnings.append(dict(esi_employer_line))

    deductions: list[dict[str, Any]] = list(fixed_deductions)

    tds_meta = _component_metadata(
        components,
        "tds",
        fallback_code="tds",
        fallback_label="Tax Deducted at Source (TDS)",
        fallback_category="deduction",
        fallback_order=100,
    )
    deductions.append(
        _line(
            code=tds_meta["code"],
            label=tds_meta["label"],
            amount=tds,
            display_order=tds_meta["display_order"],
            category="deduction",
            source="manual_input" if tds_mode == "manual" else "external_input",
            metadata={"mode": tds_mode},
        )
    )

    pf_employee_meta = _component_metadata(
        components,
        "pf_employee",
        fallback_code="pf_employee",
        fallback_label="PF Contribution- Employee",
        fallback_category="deduction",
        fallback_order=110,
    )
    if current_pf["enabled"]:
        deductions.append(
            _line(
                code=pf_employee_meta["code"],
                label=pf_employee_meta["label"],
                amount=pf_employee,
                display_order=pf_employee_meta["display_order"],
                category="deduction",
                source="statutory_config",
                metadata={
                    "rule": "pf_employee",
                    "wage": _money_number(
                        _round_money(
                            Decimal(str(current_pf["employee_wage"])),
                            rounding_mode,
                        )
                    ),
                },
            )
        )

        if _bool_value(
            pf_config.get("show_employer_pf_as_deduction"),
            default=True,
        ):
            deductions.append(
                _line(
                    code="pf_employer_pass_through",
                    label="PF Contribution- Employer",
                    amount=pf_employer,
                    display_order=120,
                    category="deduction",
                    source="statutory_config",
                    metadata={"rule": "pf_employer", "pass_through": True},
                )
            )

    if current_esi["enabled"] and current_esi["eligible"]:
        deductions.append(
            _line(
                code="esi_employee",
                label="ESI Contribution- Employee",
                amount=esi_employee,
                display_order=125,
                category="deduction",
                source="statutory_config",
                metadata={"rule": "esi_employee"},
            )
        )
        # Employer ESI is a CTC pass-through, like employer PF, so it cannot
        # inflate employee take-home pay.
        deductions.append(
            _line(
                code="esi_employer_pass_through",
                label="ESI Contribution- Employer",
                amount=esi_employer,
                display_order=126,
                category="deduction",
                source="statutory_config",
                metadata={"rule": "esi_employer", "pass_through": True},
            )
        )

    deductions.append(
        _line(
            code="lwp_deduction",
            label="Deduction against Leave without pay",
            amount=lwp_deduction_rounded,
            display_order=130,
            category="deduction",
            source="attendance",
            metadata={
                "lwp_days": _ratio_number(lwp["lwp_days"]),
                "divisor_mode": lwp["divisor_mode"],
                "divisor_days": _ratio_number(lwp["divisor_days"]),
            },
        )
    )

    pt_meta = _component_metadata(
        components,
        "professional_tax",
        fallback_code="professional_tax",
        fallback_label="Professional Tax",
        fallback_category="deduction",
        fallback_order=140,
    )
    deductions.append(
        _line(
            code=pt_meta["code"],
            label=pt_meta["label"],
            amount=professional_tax,
            display_order=pt_meta["display_order"],
            category="deduction",
            source="statutory_config",
            metadata={"basis": _money_number(_round_money(pt_basis, rounding_mode))},
        )
    )

    for advance in advance_details:
        deductions.append(
            _line(
                code=advance["code"],
                label=advance["label"],
                amount=_round_money(advance["amount_decimal"], rounding_mode),
                display_order=advance["display_order"],
                category="deduction",
                source="loans_advances",
                metadata={
                    "reference_id": advance["reference_id"],
                    "remaining_balance": (
                        _money_number(advance["remaining_balance"])
                        if advance["remaining_balance"] is not None
                        else None
                    ),
                },
            )
        )

    earnings.sort(key=lambda item: (item["display_order"], item["code"]))
    employer_contributions.sort(
        key=lambda item: (item["display_order"], item["code"])
    )
    deductions.sort(key=lambda item: (item["display_order"], item["code"]))

    gross_salary = _round_money(contractual_gross, rounding_mode)
    payable_gross_salary = _round_money(payable_gross, rounding_mode)
    employer_contribution_total = _round_money(
        pf_employer + esi_employer,
        rounding_mode,
    )
    cost_to_company = gross_salary + employer_contribution_total
    total_deductions = _sum(
        Decimal(str(item["amount"])) for item in deductions
    )
    total_deductions = _round_money(total_deductions, rounding_mode)
    net_amount = _round_money(cost_to_company - total_deductions, rounding_mode)

    if net_amount < ZERO:
        raise PayrollCalculationError(
            "Calculated net amount is negative. Review deductions and salary configuration.",
            code="negative_net_amount",
            field="deductions",
        )

    warnings: list[str] = []
    ctc_difference = _round_money(cost_to_company - monthly_ctc, "two_decimals")
    if abs(ctc_difference) > Decimal("1.00") and lwp["lwp_days"] == ZERO:
        warnings.append(
            "Calculated CTC does not match salary_structure.monthly_ctc. Review component and employer-contribution configuration."
        )

    return {
        "calculation_version": "1.0",
        "currency": _safe_str(salary_structure.get("currency") or "INR").upper(),
        "rounding_mode": rounding_mode,
        "attendance": {
            "total_days": _ratio_number(lwp["total_days"]),
            "working_days": (
                _ratio_number(lwp["working_days"])
                if lwp["working_days"] is not None
                else None
            ),
            "paid_leave_days": _ratio_number(lwp["paid_leave_days"]),
            "lwp_days": _ratio_number(lwp["lwp_days"]),
            "divisor_mode": lwp["divisor_mode"],
            "divisor_days": _ratio_number(lwp["divisor_days"]),
            "payable_days": _ratio_number(lwp["payable_days"]),
            "proration_factor": _ratio_number(lwp["proration_factor"]),
            "paid_leave_affects_salary": False,
        },
        "earnings": earnings,
        "employer_contributions": employer_contributions,
        "deductions": deductions,
        "advance_details": [
            {
                "code": item["code"],
                "label": item["label"],
                "deduction_amount": _money_number(
                    _round_money(item["amount_decimal"], rounding_mode)
                ),
                "reference_id": item["reference_id"],
                "remaining_balance": (
                    _money_number(item["remaining_balance"])
                    if item["remaining_balance"] is not None
                    else None
                ),
            }
            for item in advance_details
        ],
        "statutory": {
            "pf": {
                "enabled": bool(current_pf["enabled"]),
                "base_wage": _money_number(
                    _round_money(Decimal(str(current_pf["base_wage"])), rounding_mode)
                ),
                "employee_wage": _money_number(
                    _round_money(
                        Decimal(str(current_pf["employee_wage"])), rounding_mode
                    )
                ),
                "employer_wage": _money_number(
                    _round_money(
                        Decimal(str(current_pf["employer_wage"])), rounding_mode
                    )
                ),
                "employee_amount": _money_number(pf_employee),
                "employer_amount": _money_number(pf_employer),
            },
            "professional_tax": {
                "enabled": _bool_value(pt_config.get("enabled"), default=False),
                "basis": _money_number(_round_money(pt_basis, rounding_mode)),
                "amount": _money_number(professional_tax),
            },
            "esi": {
                "enabled": bool(current_esi["enabled"]),
                "eligible": bool(current_esi["eligible"]),
                "wage": _money_number(
                    _round_money(Decimal(str(current_esi["wage"])), rounding_mode)
                ),
                "employee_amount": _money_number(esi_employee),
                "employer_amount": _money_number(esi_employer),
            },
            "tds": {
                "mode": tds_mode,
                "amount": _money_number(tds),
                "calculated_by_engine": False,
            },
        },
        "totals": {
            "monthly_ctc_configured": _money_number(
                _round_money(monthly_ctc, rounding_mode)
            ),
            "gross_salary": _money_number(gross_salary),
            "payable_gross_salary": _money_number(payable_gross_salary),
            "lwp_deduction": _money_number(lwp_deduction_rounded),
            "employer_contribution_total": _money_number(
                employer_contribution_total
            ),
            "cost_to_company": _money_number(cost_to_company),
            "tds": _money_number(tds),
            "pf_employee": _money_number(pf_employee),
            "pf_employer": _money_number(pf_employer),
            "professional_tax": _money_number(professional_tax),
            "esi_employee": _money_number(esi_employee),
            "esi_employer": _money_number(esi_employer),
            "advances": _money_number(
                _round_money(advances_total, rounding_mode)
            ),
            "total_deductions": _money_number(total_deductions),
            "net_amount": _money_number(net_amount),
        },
        "warnings": warnings,
    }


__all__ = [
    "PayrollCalculationError",
    "calculate_payroll",
]