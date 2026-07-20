from __future__ import annotations

import csv
import hashlib
import io
import re
from collections import defaultdict
from datetime import date, datetime, timezone

UTC = timezone.utc  # Python 3.10 compatible replacement for datetime.UTC
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping, Sequence

from bson import ObjectId
from pymongo import ReturnDocument


PAYROLL_REPORT_EXPORTS_COLLECTION = "payroll_report_exports"

PAYROLL_REPORT_TYPES = {
    "payroll_register",
    "payroll_summary",
    "statutory_summary",
    "department_summary",
    "employee_statement",
    "period_variance",
    "payroll_trend",
}

OFFICIAL_PAYROLL_STATUSES = {
    "locked",
    "disbursed",
}

REPORTABLE_PAYROLL_STATUSES = {
    "draft",
    "pending_hr_review",
    "pending_finance_approval",
    "finance_approved",
    "locked",
    "disbursed",
}

PAYROLL_REPORT_EXPORT_STATUSES = {
    "generated",
    "downloaded",
    "shared",
    "archived",
}

DEFAULT_REGISTER_COLUMNS = (
    ("period_key", "Payroll Period"),
    ("employee_code", "Employee Code"),
    ("employee_name", "Employee Name"),
    ("department", "Department"),
    ("designation", "Designation"),
    ("location", "Location"),
    ("state_code", "State Code"),
    ("working_days", "Working Days"),
    ("paid_days", "Paid Days"),
    ("lwp_days", "LWP Days"),
    ("gross_salary", "Gross Salary"),
    ("payable_gross_salary", "Payable Gross Salary"),
    ("lwp_deduction", "LWP Deduction"),
    ("pf_employee", "Employee PF"),
    ("pf_employer", "Employer PF"),
    ("esi_employee", "Employee ESI"),
    ("esi_employer", "Employer ESI"),
    ("professional_tax", "Professional Tax"),
    ("tds", "TDS"),
    ("advances", "Loan / Advance Recovery"),
    ("reimbursements", "Reimbursements"),
    ("total_deductions", "Total Deductions"),
    ("net_amount", "Net Pay"),
    ("cost_to_company", "Cost to Company"),
    ("status", "Payroll Status"),
)

DEFAULT_STATUTORY_COLUMNS = (
    ("period_key", "Payroll Period"),
    ("state_code", "State Code"),
    ("employee_count", "Employee Count"),
    ("pf_eligible_count", "PF Eligible Employees"),
    ("pf_employee", "Employee PF"),
    ("pf_employer", "Employer PF"),
    ("esi_eligible_count", "ESI Eligible Employees"),
    ("esi_employee", "Employee ESI"),
    ("esi_employer", "Employer ESI"),
    ("professional_tax", "Professional Tax"),
    ("tds", "TDS"),
    ("lwp_deduction", "LWP Deduction"),
    ("total_deductions", "Total Deductions"),
)

DEFAULT_DEPARTMENT_COLUMNS = (
    ("period_key", "Payroll Period"),
    ("department", "Department"),
    ("employee_count", "Employee Count"),
    ("gross_salary", "Gross Salary"),
    ("payable_gross_salary", "Payable Gross Salary"),
    ("reimbursements", "Reimbursements"),
    ("total_deductions", "Total Deductions"),
    ("net_amount", "Net Pay"),
    ("cost_to_company", "Cost to Company"),
)

DEFAULT_VARIANCE_COLUMNS = (
    ("employee_code", "Employee Code"),
    ("employee_name", "Employee Name"),
    ("department", "Department"),
    ("base_period", "Base Period"),
    ("comparison_period", "Comparison Period"),
    ("base_net_amount", "Base Net Pay"),
    ("comparison_net_amount", "Comparison Net Pay"),
    ("net_amount_variance", "Net Pay Variance"),
    ("net_amount_variance_percent", "Net Pay Variance %"),
    ("base_gross_salary", "Base Gross Salary"),
    ("comparison_gross_salary", "Comparison Gross Salary"),
    ("gross_salary_variance", "Gross Salary Variance"),
    ("base_total_deductions", "Base Total Deductions"),
    ("comparison_total_deductions", "Comparison Total Deductions"),
    ("deduction_variance", "Deduction Variance"),
    ("variance_reasons", "Variance Reasons"),
)

ZERO = Decimal("0")
MONEY_QUANTUM = Decimal("0.01")
PERCENT_QUANTUM = Decimal("0.01")
PERIOD_PATTERN = re.compile(r"^(20|21|22)\d{2}-(0[1-9]|1[0-2])$")


class PayrollReportingError(ValueError):
    """Business-rule error raised by payroll reporting operations."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str = "payroll_reporting_error",
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
    field_name: str = "amount",
    minimum: Decimal | None = None,
) -> Decimal:
    if value in (None, ""):
        return ZERO

    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise PayrollReportingError(
            f"{field_name} must be a valid number.",
            code="invalid_payroll_report_amount",
            details={"field": field_name},
        ) from exc

    if not amount.is_finite():
        raise PayrollReportingError(
            f"{field_name} must be a finite number.",
            code="invalid_payroll_report_amount",
            details={"field": field_name},
        )

    if minimum is not None and amount < minimum:
        raise PayrollReportingError(
            f"{field_name} must be at least {minimum}.",
            code="invalid_payroll_report_amount",
            details={
                "field": field_name,
                "minimum": float(minimum),
            },
        )

    return amount.quantize(MONEY_QUANTUM)


def money_value(value: Any) -> int | float:
    amount = money_decimal(value)

    if amount == amount.to_integral_value():
        return int(amount)

    return float(amount)


def percent_value(value: Any) -> int | float:
    amount = Decimal(str(value or 0)).quantize(PERCENT_QUANTUM)

    if amount == amount.to_integral_value():
        return int(amount)

    return float(amount)


def parse_period(value: Any, *, field_name: str = "period_key") -> str:
    text = safe_str(value)

    if not text:
        raise PayrollReportingError(
            f"{field_name} is required.",
            code="payroll_report_period_required",
            details={"field": field_name},
        )

    if not PERIOD_PATTERN.fullmatch(text):
        raise PayrollReportingError(
            f"{field_name} must use YYYY-MM format.",
            code="invalid_payroll_report_period",
            details={"field": field_name},
        )

    return text


def period_ordinal(period_key: Any) -> int:
    normalized = parse_period(period_key)
    year, month = normalized.split("-")
    return int(year) * 12 + int(month)


def period_range(
    start_period: Any,
    end_period: Any,
) -> list[str]:
    start = parse_period(start_period, field_name="start_period")
    end = parse_period(end_period, field_name="end_period")
    start_ordinal = period_ordinal(start)
    end_ordinal = period_ordinal(end)

    if start_ordinal > end_ordinal:
        raise PayrollReportingError(
            "start_period cannot be later than end_period.",
            code="invalid_payroll_report_period_range",
            details={
                "start_period": start,
                "end_period": end,
            },
        )

    periods: list[str] = []

    for ordinal in range(start_ordinal, end_ordinal + 1):
        year, zero_based_month = divmod(ordinal - 1, 12)
        periods.append(f"{year:04d}-{zero_based_month + 1:02d}")

    return periods


def parse_date(
    value: Any,
    *,
    field_name: str,
    required: bool = False,
) -> date | None:
    if value in (None, ""):
        if required:
            raise PayrollReportingError(
                f"{field_name} is required.",
                code="payroll_report_date_required",
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
        raise PayrollReportingError(
            f"{field_name} must use YYYY-MM-DD format.",
            code="invalid_payroll_report_date",
            details={"field": field_name},
        ) from exc


def normalize_statuses(
    statuses: Iterable[Any] | None,
    *,
    official_only: bool = True,
) -> list[str]:
    normalized = {
        normalize_key(item)
        for item in (statuses or [])
        if safe_str(item)
    }

    if not normalized:
        normalized = (
            set(OFFICIAL_PAYROLL_STATUSES)
            if official_only
            else set(REPORTABLE_PAYROLL_STATUSES)
        )

    invalid = normalized - REPORTABLE_PAYROLL_STATUSES

    if invalid:
        raise PayrollReportingError(
            "One or more payroll statuses are not reportable.",
            code="invalid_payroll_report_status",
            details={
                "statuses": sorted(invalid),
                "allowed_statuses": sorted(REPORTABLE_PAYROLL_STATUSES),
            },
        )

    return sorted(normalized)


def normalize_report_type(value: Any) -> str:
    normalized = normalize_key(value)

    aliases = {
        "register": "payroll_register",
        "summary": "payroll_summary",
        "statutory": "statutory_summary",
        "department": "department_summary",
        "employee": "employee_statement",
        "statement": "employee_statement",
        "variance": "period_variance",
        "trend": "payroll_trend",
    }
    normalized = aliases.get(normalized, normalized)

    if normalized not in PAYROLL_REPORT_TYPES:
        raise PayrollReportingError(
            "Unsupported payroll report type.",
            code="invalid_payroll_report_type",
            details={
                "report_type": normalized,
                "allowed_types": sorted(PAYROLL_REPORT_TYPES),
            },
        )

    return normalized


def _normalize_filter_values(values: Iterable[Any] | None) -> list[str]:
    return sorted({
        safe_str(item)
        for item in (values or [])
        if safe_str(item)
    })


def _normalize_key_filter_values(values: Iterable[Any] | None) -> list[str]:
    return sorted({
        normalize_key(item)
        for item in (values or [])
        if safe_str(item)
    })


def _line_amount(
    items: Iterable[Mapping[str, Any]] | None,
    *keys: str,
) -> Decimal:
    normalized_keys = {normalize_key(key) for key in keys}
    total = ZERO

    for item in items or []:
        item_key = normalize_key(
            item.get("key")
            or item.get("code")
            or item.get("type")
            or item.get("name")
            or item.get("label")
        )

        if item_key not in normalized_keys:
            continue

        amount = item.get("amount")

        if amount in (None, ""):
            amount = (
                item.get("value")
                or item.get("monthly_amount")
                or item.get("deducted_amount")
                or item.get("payable_amount")
            )

        total += money_decimal(amount)

    return total.quantize(MONEY_QUANTUM)


def _total_amount(
    payslip: Mapping[str, Any],
    key: str,
    *,
    fallback_items: Iterable[Mapping[str, Any]] | None = None,
    fallback_keys: Sequence[str] = (),
) -> Decimal:
    totals = payslip.get("totals") or {}
    value = totals.get(key)

    if value not in (None, ""):
        return money_decimal(value, field_name=f"totals.{key}")

    if fallback_items is not None:
        keys = fallback_keys or (key,)
        return _line_amount(fallback_items, *keys)

    return ZERO


def _attendance_value(
    payslip: Mapping[str, Any],
    *keys: str,
) -> Decimal:
    attendance = payslip.get("attendance") or {}

    for key in keys:
        value = attendance.get(key)

        if value not in (None, ""):
            try:
                return Decimal(str(value)).quantize(MONEY_QUANTUM)
            except (InvalidOperation, TypeError, ValueError):
                continue

    return ZERO


def _employee_snapshot(payslip: Mapping[str, Any]) -> dict[str, Any]:
    employee = payslip.get("employee_info") or {}

    return {
        "employee_id": safe_str(
            payslip.get("employee_id")
            or employee.get("employee_id")
        ),
        "employee_code": safe_str(
            payslip.get("employee_code")
            or employee.get("employee_code")
        ),
        "employee_name": safe_str(
            payslip.get("employee_name")
            or employee.get("name")
            or employee.get("employee_name")
            or "Employee"
        ),
        "official_email": safe_str(
            employee.get("official_email")
            or employee.get("email")
        ),
        "department": safe_str(
            employee.get("department")
            or employee.get("function")
            or "Unassigned"
        ),
        "function": safe_str(
            employee.get("function")
            or employee.get("department")
            or "Unassigned"
        ),
        "designation": safe_str(
            employee.get("designation")
            or "Unassigned"
        ),
        "location": safe_str(
            employee.get("location")
            or "Unassigned"
        ),
        "date_of_joining": employee.get("date_of_joining"),
        "pan": safe_str(employee.get("pan")),
        "uan": safe_str(employee.get("uan")),
        "esi_number": safe_str(employee.get("esi_number")),
        "pran": safe_str(employee.get("pran")),
    }


def payroll_register_row(
    payslip: Mapping[str, Any],
) -> dict[str, Any]:
    employee = _employee_snapshot(payslip)
    earnings = list(payslip.get("earnings") or [])
    deductions = list(payslip.get("deductions") or [])
    employer_contributions = list(
        payslip.get("employer_contributions") or []
    )
    attendance = payslip.get("attendance") or {}
    totals = payslip.get("totals") or {}
    reimbursement_summary = payslip.get("reimbursement_summary") or {}
    bank_snapshot = payslip.get("bank_details_snapshot") or {}

    gross_salary = _total_amount(
        payslip,
        "gross_salary",
        fallback_items=earnings,
        fallback_keys=("gross_salary", "gross"),
    )
    payable_gross_salary = _total_amount(
        payslip,
        "payable_gross_salary",
    )
    lwp_deduction = _total_amount(
        payslip,
        "lwp_deduction",
        fallback_items=deductions,
        fallback_keys=("lwp_deduction", "leave_without_pay"),
    )
    pf_employee = _total_amount(
        payslip,
        "pf_employee",
        fallback_items=deductions,
        fallback_keys=("pf_employee", "employee_pf", "provident_fund_employee"),
    )
    pf_employer = _total_amount(
        payslip,
        "pf_employer",
        fallback_items=employer_contributions or earnings,
        fallback_keys=("pf_employer", "employer_pf", "provident_fund_employer"),
    )
    esi_employee = _total_amount(
        payslip,
        "esi_employee",
        fallback_items=deductions,
        fallback_keys=("esi_employee", "employee_esi"),
    )
    esi_employer = _total_amount(
        payslip,
        "esi_employer",
        fallback_items=employer_contributions,
        fallback_keys=("esi_employer", "employer_esi"),
    )
    professional_tax = _total_amount(
        payslip,
        "professional_tax",
        fallback_items=deductions,
        fallback_keys=("professional_tax", "pt"),
    )
    tds = _total_amount(
        payslip,
        "tds",
        fallback_items=deductions,
        fallback_keys=("tds", "tax_deducted_at_source"),
    )
    advances = _total_amount(
        payslip,
        "advances",
        fallback_items=deductions,
        fallback_keys=("advances", "loan_recovery", "advance_recovery"),
    )
    reimbursements = _total_amount(
        payslip,
        "reimbursements",
    )
    total_deductions = _total_amount(
        payslip,
        "total_deductions",
    )
    net_amount = _total_amount(
        payslip,
        "net_amount",
    )
    cost_to_company = _total_amount(
        payslip,
        "cost_to_company",
    )

    working_days = _attendance_value(
        payslip,
        "working_days",
        "total_working_days",
        "calendar_working_days",
    )
    paid_days = _attendance_value(
        payslip,
        "salary_paid_days",
        "payable_days",
        "paid_days",
    )
    lwp_days = _attendance_value(
        payslip,
        "lwp_days",
        "leave_without_pay_days",
    )
    present_days = _attendance_value(
        payslip,
        "present_days",
        "attendance_days",
    )
    paid_leave_days = _attendance_value(
        payslip,
        "paid_leave_days",
        "paid_leaves",
    )

    taxable_reimbursements = money_decimal(
        totals.get(
            "taxable_reimbursements",
            reimbursement_summary.get("taxable_amount"),
        )
    )
    non_taxable_reimbursements = money_decimal(
        totals.get(
            "non_taxable_reimbursements",
            reimbursement_summary.get("non_taxable_amount"),
        )
    )

    return {
        "payslip_id": safe_str(payslip.get("_id")),
        "run_id": safe_str(payslip.get("run_id")),
        "tenant_id": safe_str(payslip.get("tenant_id")),
        "period_key": safe_str(payslip.get("period_key")),
        "month": int(payslip.get("month") or 0),
        "year": int(payslip.get("year") or 0),
        **employee,
        "state_code": safe_str(payslip.get("state_code")),
        "status": normalize_key(payslip.get("status") or "draft"),
        "workflow_stage": normalize_key(
            payslip.get("workflow_stage")
            or payslip.get("status")
            or "draft"
        ),
        "is_locked": bool(payslip.get("is_locked")),
        "currency": safe_str(payslip.get("currency") or "INR"),
        "working_days": percent_value(working_days),
        "present_days": percent_value(present_days),
        "paid_leave_days": percent_value(paid_leave_days),
        "paid_days": percent_value(paid_days),
        "lwp_days": percent_value(lwp_days),
        "monthly_ctc_configured": money_value(
            totals.get("monthly_ctc_configured")
        ),
        "gross_salary": money_value(gross_salary),
        "payable_gross_salary": money_value(payable_gross_salary),
        "lwp_deduction": money_value(lwp_deduction),
        "pf_employee": money_value(pf_employee),
        "pf_employer": money_value(pf_employer),
        "esi_employee": money_value(esi_employee),
        "esi_employer": money_value(esi_employer),
        "professional_tax": money_value(professional_tax),
        "tds": money_value(tds),
        "advances": money_value(advances),
        "reimbursements": money_value(reimbursements),
        "taxable_reimbursements": money_value(
            taxable_reimbursements
        ),
        "non_taxable_reimbursements": money_value(
            non_taxable_reimbursements
        ),
        "total_deductions": money_value(total_deductions),
        "net_amount": money_value(net_amount),
        "cost_to_company": money_value(cost_to_company),
        "total_payroll_cost": money_value(
            totals.get("total_payroll_cost")
            or cost_to_company
        ),
        "bank_snapshot_available": bool(bank_snapshot),
        "bank_name": safe_str(bank_snapshot.get("bank_name")),
        "masked_account_number": safe_str(
            bank_snapshot.get("masked_account_number")
        ),
        "payment_method": normalize_key(
            bank_snapshot.get("payment_method")
        ),
        "calculated_at": payslip.get("calculated_at"),
        "locked_at": payslip.get("locked_at"),
        "disbursed_at": payslip.get("disbursed_at"),
    }


def _report_query(
    *,
    tenant_id: str,
    periods: Iterable[str],
    statuses: Iterable[str],
    employee_ids: Iterable[Any] | None = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {
        "tenant_id": tenant_id,
        "period_key": {"$in": list(periods)},
        "status": {"$in": list(statuses)},
        "is_deleted": {"$ne": True},
    }
    normalized_employee_ids = _normalize_filter_values(employee_ids)

    if normalized_employee_ids:
        query["employee_id"] = {"$in": normalized_employee_ids}

    return query


def _resolve_periods(
    *,
    period_key: Any = "",
    start_period: Any = "",
    end_period: Any = "",
    periods: Iterable[Any] | None = None,
) -> list[str]:
    normalized_periods = {
        parse_period(item)
        for item in (periods or [])
        if safe_str(item)
    }

    if period_key not in (None, ""):
        normalized_periods.add(parse_period(period_key))

    if start_period not in (None, "") or end_period not in (None, ""):
        if not start_period or not end_period:
            raise PayrollReportingError(
                "Both start_period and end_period are required for a range.",
                code="payroll_report_period_range_incomplete",
            )

        normalized_periods.update(
            period_range(start_period, end_period)
        )

    if not normalized_periods:
        raise PayrollReportingError(
            "At least one payroll period is required.",
            code="payroll_report_period_required",
        )

    return sorted(normalized_periods, key=period_ordinal)


def _matches_report_filters(
    row: Mapping[str, Any],
    *,
    departments: set[str],
    designations: set[str],
    locations: set[str],
    state_codes: set[str],
    search: str,
) -> bool:
    if departments and normalize_key(row.get("department")) not in departments:
        return False

    if designations and normalize_key(row.get("designation")) not in designations:
        return False

    if locations and normalize_key(row.get("location")) not in locations:
        return False

    if state_codes and normalize_key(row.get("state_code")) not in state_codes:
        return False

    if search:
        haystack = " ".join([
            safe_str(row.get("employee_id")),
            safe_str(row.get("employee_code")),
            safe_str(row.get("employee_name")),
            safe_str(row.get("official_email")),
            safe_str(row.get("department")),
            safe_str(row.get("designation")),
            safe_str(row.get("location")),
            safe_str(row.get("state_code")),
        ]).lower()

        if search.lower() not in haystack:
            return False

    return True


def payroll_register(
    db: Any,
    *,
    tenant_id: str,
    period_key: Any = "",
    start_period: Any = "",
    end_period: Any = "",
    periods: Iterable[Any] | None = None,
    statuses: Iterable[Any] | None = None,
    official_only: bool = True,
    employee_ids: Iterable[Any] | None = None,
    departments: Iterable[Any] | None = None,
    designations: Iterable[Any] | None = None,
    locations: Iterable[Any] | None = None,
    state_codes: Iterable[Any] | None = None,
    search: str = "",
    limit: int = 10000,
) -> dict[str, Any]:
    tenant_id = safe_str(tenant_id)

    if not tenant_id:
        raise PayrollReportingError(
            "tenant_id is required.",
            code="payroll_report_tenant_required",
        )

    normalized_periods = _resolve_periods(
        period_key=period_key,
        start_period=start_period,
        end_period=end_period,
        periods=periods,
    )
    normalized_statuses = normalize_statuses(
        statuses,
        official_only=official_only,
    )
    query = _report_query(
        tenant_id=tenant_id,
        periods=normalized_periods,
        statuses=normalized_statuses,
        employee_ids=employee_ids,
    )
    safe_limit = max(1, min(int(limit or 10000), 50000))
    cursor = (
        db.payslips
        .find(query)
        .sort([
            ("period_key", 1),
            ("employee_code", 1),
            ("employee_name", 1),
        ])
        .limit(safe_limit)
    )
    department_filters = set(
        _normalize_key_filter_values(departments)
    )
    designation_filters = set(
        _normalize_key_filter_values(designations)
    )
    location_filters = set(
        _normalize_key_filter_values(locations)
    )
    state_filters = set(
        _normalize_key_filter_values(state_codes)
    )
    normalized_search = safe_str(search)
    rows: list[dict[str, Any]] = []

    for payslip in cursor:
        row = payroll_register_row(payslip)

        if not _matches_report_filters(
            row,
            departments=department_filters,
            designations=designation_filters,
            locations=location_filters,
            state_codes=state_filters,
            search=normalized_search,
        ):
            continue

        rows.append(row)

    totals = summarize_register_rows(rows)

    return {
        "report_type": "payroll_register",
        "tenant_id": tenant_id,
        "periods": normalized_periods,
        "statuses": normalized_statuses,
        "filters": {
            "employee_ids": _normalize_filter_values(employee_ids),
            "departments": sorted(department_filters),
            "designations": sorted(designation_filters),
            "locations": sorted(location_filters),
            "state_codes": sorted(state_filters),
            "search": normalized_search,
            "official_only": bool(official_only),
        },
        "rows": rows,
        "totals": totals,
        "generated_at": now_utc(),
    }


def summarize_register_rows(
    rows: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    rows = list(rows)
    money_keys = (
        "monthly_ctc_configured",
        "gross_salary",
        "payable_gross_salary",
        "lwp_deduction",
        "pf_employee",
        "pf_employer",
        "esi_employee",
        "esi_employer",
        "professional_tax",
        "tds",
        "advances",
        "reimbursements",
        "taxable_reimbursements",
        "non_taxable_reimbursements",
        "total_deductions",
        "net_amount",
        "cost_to_company",
        "total_payroll_cost",
    )
    day_keys = (
        "working_days",
        "present_days",
        "paid_leave_days",
        "paid_days",
        "lwp_days",
    )
    employee_ids = {
        safe_str(row.get("employee_id"))
        for row in rows
        if safe_str(row.get("employee_id"))
    }
    periods = {
        safe_str(row.get("period_key"))
        for row in rows
        if safe_str(row.get("period_key"))
    }
    totals: dict[str, Any] = {
        "row_count": len(rows),
        "employee_count": len(employee_ids),
        "period_count": len(periods),
        "bank_snapshot_count": sum(
            1
            for row in rows
            if bool(row.get("bank_snapshot_available"))
        ),
    }

    for key in money_keys:
        totals[key] = money_value(sum(
            money_decimal(row.get(key))
            for row in rows
        ))

    for key in day_keys:
        totals[key] = percent_value(sum(
            Decimal(str(row.get(key) or 0))
            for row in rows
        ))

    return totals


def payroll_summary(
    db: Any,
    **register_kwargs: Any,
) -> dict[str, Any]:
    register = payroll_register(
        db,
        **register_kwargs,
    )
    by_period: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in register["rows"]:
        by_period[row["period_key"]].append(row)

    period_rows: list[dict[str, Any]] = []

    for period_key in register["periods"]:
        rows = by_period.get(period_key, [])
        period_totals = summarize_register_rows(rows)
        period_rows.append({
            "period_key": period_key,
            **period_totals,
            "status_counts": _status_counts(rows),
        })

    return {
        **register,
        "report_type": "payroll_summary",
        "rows": period_rows,
        "register_row_count": len(register["rows"]),
    }


def _status_counts(
    rows: Iterable[Mapping[str, Any]],
) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)

    for row in rows:
        counts[normalize_key(row.get("status") or "unknown")] += 1

    return dict(sorted(counts.items()))


def statutory_summary(
    db: Any,
    **register_kwargs: Any,
) -> dict[str, Any]:
    register = payroll_register(
        db,
        **register_kwargs,
    )
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)

    for row in register["rows"]:
        key = (
            safe_str(row.get("period_key")),
            safe_str(row.get("state_code")) or "UNSPECIFIED",
        )
        groups[key].append(row)

    rows: list[dict[str, Any]] = []

    for (period_key, state_code), group_rows in sorted(groups.items()):
        totals = summarize_register_rows(group_rows)
        pf_eligible_count = sum(
            1
            for row in group_rows
            if money_decimal(row.get("pf_employee")) > ZERO
            or money_decimal(row.get("pf_employer")) > ZERO
        )
        esi_eligible_count = sum(
            1
            for row in group_rows
            if money_decimal(row.get("esi_employee")) > ZERO
            or money_decimal(row.get("esi_employer")) > ZERO
        )
        rows.append({
            "period_key": period_key,
            "state_code": state_code,
            "employee_count": totals["employee_count"],
            "pf_eligible_count": pf_eligible_count,
            "pf_employee": totals["pf_employee"],
            "pf_employer": totals["pf_employer"],
            "pf_total": money_value(
                money_decimal(totals["pf_employee"])
                + money_decimal(totals["pf_employer"])
            ),
            "esi_eligible_count": esi_eligible_count,
            "esi_employee": totals["esi_employee"],
            "esi_employer": totals["esi_employer"],
            "esi_total": money_value(
                money_decimal(totals["esi_employee"])
                + money_decimal(totals["esi_employer"])
            ),
            "professional_tax": totals["professional_tax"],
            "tds": totals["tds"],
            "lwp_deduction": totals["lwp_deduction"],
            "advances": totals["advances"],
            "total_deductions": totals["total_deductions"],
            "payable_gross_salary": totals["payable_gross_salary"],
            "net_amount": totals["net_amount"],
        })

    return {
        **register,
        "report_type": "statutory_summary",
        "rows": rows,
        "register_row_count": len(register["rows"]),
    }


def department_summary(
    db: Any,
    **register_kwargs: Any,
) -> dict[str, Any]:
    register = payroll_register(
        db,
        **register_kwargs,
    )
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)

    for row in register["rows"]:
        key = (
            safe_str(row.get("period_key")),
            safe_str(row.get("department")) or "Unassigned",
        )
        groups[key].append(row)

    rows: list[dict[str, Any]] = []

    for (period_key, department), group_rows in sorted(groups.items()):
        totals = summarize_register_rows(group_rows)
        rows.append({
            "period_key": period_key,
            "department": department,
            "employee_count": totals["employee_count"],
            "working_days": totals["working_days"],
            "paid_days": totals["paid_days"],
            "lwp_days": totals["lwp_days"],
            "gross_salary": totals["gross_salary"],
            "payable_gross_salary": totals["payable_gross_salary"],
            "lwp_deduction": totals["lwp_deduction"],
            "reimbursements": totals["reimbursements"],
            "total_deductions": totals["total_deductions"],
            "net_amount": totals["net_amount"],
            "cost_to_company": totals["cost_to_company"],
            "total_payroll_cost": totals["total_payroll_cost"],
        })

    return {
        **register,
        "report_type": "department_summary",
        "rows": rows,
        "register_row_count": len(register["rows"]),
    }


def employee_statement(
    db: Any,
    *,
    tenant_id: str,
    employee_id: Any,
    start_period: Any,
    end_period: Any,
    statuses: Iterable[Any] | None = None,
    official_only: bool = True,
) -> dict[str, Any]:
    normalized_employee_id = safe_str(employee_id)

    if not normalized_employee_id:
        raise PayrollReportingError(
            "employee_id is required.",
            code="payroll_report_employee_required",
        )

    register = payroll_register(
        db,
        tenant_id=tenant_id,
        start_period=start_period,
        end_period=end_period,
        statuses=statuses,
        official_only=official_only,
        employee_ids=[normalized_employee_id],
    )

    if not register["rows"]:
        raise PayrollReportingError(
            "No payroll records were found for the selected employee and period.",
            status_code=404,
            code="employee_payroll_statement_not_found",
            details={
                "employee_id": normalized_employee_id,
                "periods": register["periods"],
            },
        )

    first_row = register["rows"][0]
    earnings_by_period: list[dict[str, Any]] = []

    for row in register["rows"]:
        earnings_by_period.append({
            "period_key": row["period_key"],
            "gross_salary": row["gross_salary"],
            "payable_gross_salary": row["payable_gross_salary"],
            "reimbursements": row["reimbursements"],
            "total_deductions": row["total_deductions"],
            "net_amount": row["net_amount"],
            "cost_to_company": row["cost_to_company"],
            "working_days": row["working_days"],
            "paid_days": row["paid_days"],
            "lwp_days": row["lwp_days"],
            "status": row["status"],
        })

    return {
        "report_type": "employee_statement",
        "tenant_id": tenant_id,
        "employee": {
            "employee_id": first_row["employee_id"],
            "employee_code": first_row["employee_code"],
            "employee_name": first_row["employee_name"],
            "official_email": first_row["official_email"],
            "department": first_row["department"],
            "designation": first_row["designation"],
            "location": first_row["location"],
            "pan": first_row["pan"],
            "uan": first_row["uan"],
            "esi_number": first_row["esi_number"],
            "pran": first_row["pran"],
        },
        "periods": register["periods"],
        "rows": earnings_by_period,
        "totals": register["totals"],
        "generated_at": now_utc(),
    }


def _variance_percent(
    base_value: Any,
    comparison_value: Any,
) -> int | float | None:
    base = money_decimal(base_value)
    comparison = money_decimal(comparison_value)

    if base == ZERO:
        if comparison == ZERO:
            return 0
        return None

    percent = (
        (comparison - base)
        / abs(base)
        * Decimal("100")
    ).quantize(PERCENT_QUANTUM)

    return percent_value(percent)


def _variance_reasons(
    base: Mapping[str, Any],
    comparison: Mapping[str, Any],
) -> list[str]:
    reasons: list[str] = []

    if Decimal(str(base.get("lwp_days") or 0)) != Decimal(
        str(comparison.get("lwp_days") or 0)
    ):
        reasons.append("LWP days changed")

    if money_decimal(base.get("gross_salary")) != money_decimal(
        comparison.get("gross_salary")
    ):
        reasons.append("Gross salary changed")

    if money_decimal(base.get("reimbursements")) != money_decimal(
        comparison.get("reimbursements")
    ):
        reasons.append("Reimbursements changed")

    if money_decimal(base.get("advances")) != money_decimal(
        comparison.get("advances")
    ):
        reasons.append("Loan or advance recovery changed")

    if money_decimal(base.get("tds")) != money_decimal(
        comparison.get("tds")
    ):
        reasons.append("TDS changed")

    if money_decimal(base.get("professional_tax")) != money_decimal(
        comparison.get("professional_tax")
    ):
        reasons.append("Professional tax changed")

    if (
        money_decimal(base.get("pf_employee"))
        != money_decimal(comparison.get("pf_employee"))
        or money_decimal(base.get("esi_employee"))
        != money_decimal(comparison.get("esi_employee"))
    ):
        reasons.append("Statutory deductions changed")

    if not reasons:
        reasons.append("No component-level variance detected")

    return reasons


def period_variance(
    db: Any,
    *,
    tenant_id: str,
    base_period: Any,
    comparison_period: Any,
    statuses: Iterable[Any] | None = None,
    official_only: bool = True,
    employee_ids: Iterable[Any] | None = None,
    departments: Iterable[Any] | None = None,
    designations: Iterable[Any] | None = None,
    locations: Iterable[Any] | None = None,
    state_codes: Iterable[Any] | None = None,
    search: str = "",
) -> dict[str, Any]:
    normalized_base = parse_period(
        base_period,
        field_name="base_period",
    )
    normalized_comparison = parse_period(
        comparison_period,
        field_name="comparison_period",
    )

    if normalized_base == normalized_comparison:
        raise PayrollReportingError(
            "base_period and comparison_period must be different.",
            code="payroll_variance_periods_must_differ",
        )

    register = payroll_register(
        db,
        tenant_id=tenant_id,
        periods=[normalized_base, normalized_comparison],
        statuses=statuses,
        official_only=official_only,
        employee_ids=employee_ids,
        departments=departments,
        designations=designations,
        locations=locations,
        state_codes=state_codes,
        search=search,
    )
    by_period_employee: dict[
        tuple[str, str],
        dict[str, Any],
    ] = {}

    for row in register["rows"]:
        by_period_employee[
            (row["period_key"], row["employee_id"])
        ] = row

    employee_keys = sorted({
        employee_id
        for _, employee_id in by_period_employee
    })
    rows: list[dict[str, Any]] = []

    for employee_id in employee_keys:
        base = by_period_employee.get(
            (normalized_base, employee_id)
        )
        comparison = by_period_employee.get(
            (normalized_comparison, employee_id)
        )

        if not base and not comparison:
            continue

        reference = comparison or base or {}
        base_net = money_decimal(
            (base or {}).get("net_amount")
        )
        comparison_net = money_decimal(
            (comparison or {}).get("net_amount")
        )
        base_gross = money_decimal(
            (base or {}).get("gross_salary")
        )
        comparison_gross = money_decimal(
            (comparison or {}).get("gross_salary")
        )
        base_deductions = money_decimal(
            (base or {}).get("total_deductions")
        )
        comparison_deductions = money_decimal(
            (comparison or {}).get("total_deductions")
        )

        if base and comparison:
            reasons = _variance_reasons(base, comparison)
            employee_status = "existing"
        elif comparison:
            reasons = ["Employee added in comparison period"]
            employee_status = "added"
        else:
            reasons = ["Employee absent from comparison period"]
            employee_status = "removed"

        rows.append({
            "employee_id": employee_id,
            "employee_code": safe_str(
                reference.get("employee_code")
            ),
            "employee_name": safe_str(
                reference.get("employee_name")
            ),
            "department": safe_str(
                reference.get("department")
            ),
            "designation": safe_str(
                reference.get("designation")
            ),
            "location": safe_str(
                reference.get("location")
            ),
            "employee_status": employee_status,
            "base_period": normalized_base,
            "comparison_period": normalized_comparison,
            "base_net_amount": money_value(base_net),
            "comparison_net_amount": money_value(
                comparison_net
            ),
            "net_amount_variance": money_value(
                comparison_net - base_net
            ),
            "net_amount_variance_percent": _variance_percent(
                base_net,
                comparison_net,
            ),
            "base_gross_salary": money_value(base_gross),
            "comparison_gross_salary": money_value(
                comparison_gross
            ),
            "gross_salary_variance": money_value(
                comparison_gross - base_gross
            ),
            "base_total_deductions": money_value(
                base_deductions
            ),
            "comparison_total_deductions": money_value(
                comparison_deductions
            ),
            "deduction_variance": money_value(
                comparison_deductions - base_deductions
            ),
            "base_lwp_days": (
                (base or {}).get("lwp_days") or 0
            ),
            "comparison_lwp_days": (
                (comparison or {}).get("lwp_days") or 0
            ),
            "variance_reasons": reasons,
        })

    base_rows = [
        row
        for row in register["rows"]
        if row["period_key"] == normalized_base
    ]
    comparison_rows = [
        row
        for row in register["rows"]
        if row["period_key"] == normalized_comparison
    ]
    base_totals = summarize_register_rows(base_rows)
    comparison_totals = summarize_register_rows(
        comparison_rows
    )

    return {
        "report_type": "period_variance",
        "tenant_id": tenant_id,
        "base_period": normalized_base,
        "comparison_period": normalized_comparison,
        "rows": rows,
        "totals": {
            "base": base_totals,
            "comparison": comparison_totals,
            "variance": {
                "employee_count": (
                    comparison_totals["employee_count"]
                    - base_totals["employee_count"]
                ),
                "gross_salary": money_value(
                    money_decimal(
                        comparison_totals["gross_salary"]
                    )
                    - money_decimal(
                        base_totals["gross_salary"]
                    )
                ),
                "total_deductions": money_value(
                    money_decimal(
                        comparison_totals["total_deductions"]
                    )
                    - money_decimal(
                        base_totals["total_deductions"]
                    )
                ),
                "net_amount": money_value(
                    money_decimal(
                        comparison_totals["net_amount"]
                    )
                    - money_decimal(
                        base_totals["net_amount"]
                    )
                ),
                "cost_to_company": money_value(
                    money_decimal(
                        comparison_totals["cost_to_company"]
                    )
                    - money_decimal(
                        base_totals["cost_to_company"]
                    )
                ),
            },
        },
        "generated_at": now_utc(),
    }


def payroll_trend(
    db: Any,
    *,
    tenant_id: str,
    start_period: Any,
    end_period: Any,
    statuses: Iterable[Any] | None = None,
    official_only: bool = True,
    departments: Iterable[Any] | None = None,
    locations: Iterable[Any] | None = None,
) -> dict[str, Any]:
    summary = payroll_summary(
        db,
        tenant_id=tenant_id,
        start_period=start_period,
        end_period=end_period,
        statuses=statuses,
        official_only=official_only,
        departments=departments,
        locations=locations,
    )
    rows = summary["rows"]
    previous: dict[str, Any] | None = None
    trend_rows: list[dict[str, Any]] = []

    for row in rows:
        trend_row = dict(row)

        if previous:
            trend_row.update({
                "net_amount_change": money_value(
                    money_decimal(row.get("net_amount"))
                    - money_decimal(previous.get("net_amount"))
                ),
                "net_amount_change_percent": _variance_percent(
                    previous.get("net_amount"),
                    row.get("net_amount"),
                ),
                "cost_to_company_change": money_value(
                    money_decimal(row.get("cost_to_company"))
                    - money_decimal(previous.get("cost_to_company"))
                ),
                "employee_count_change": (
                    int(row.get("employee_count") or 0)
                    - int(previous.get("employee_count") or 0)
                ),
            })
        else:
            trend_row.update({
                "net_amount_change": 0,
                "net_amount_change_percent": 0,
                "cost_to_company_change": 0,
                "employee_count_change": 0,
            })

        trend_rows.append(trend_row)
        previous = row

    return {
        **summary,
        "report_type": "payroll_trend",
        "rows": trend_rows,
    }


def _sanitize_csv_cell(value: Any) -> str:
    if isinstance(value, (list, tuple, set)):
        text = "; ".join(safe_str(item) for item in value)
    elif isinstance(value, Mapping):
        text = "; ".join(
            f"{safe_str(key)}={safe_str(item)}"
            for key, item in value.items()
        )
    else:
        text = safe_str(value)

    text = text.replace("\x00", "")

    if text.startswith(("=", "+", "-", "@")):
        return f"'{text}"

    return text


def _normalize_export_columns(
    columns: Sequence[Any] | None,
    *,
    report_type: str,
) -> tuple[tuple[str, str], ...]:
    if not columns:
        defaults = {
            "payroll_register": DEFAULT_REGISTER_COLUMNS,
            "payroll_summary": DEFAULT_DEPARTMENT_COLUMNS,
            "statutory_summary": DEFAULT_STATUTORY_COLUMNS,
            "department_summary": DEFAULT_DEPARTMENT_COLUMNS,
            "period_variance": DEFAULT_VARIANCE_COLUMNS,
            "payroll_trend": DEFAULT_DEPARTMENT_COLUMNS,
            "employee_statement": DEFAULT_REGISTER_COLUMNS,
        }
        return defaults.get(
            report_type,
            DEFAULT_REGISTER_COLUMNS,
        )

    normalized: list[tuple[str, str]] = []

    for index, column in enumerate(columns):
        if isinstance(column, str):
            key = safe_str(column)
            label = label_from_key(key)
        elif isinstance(column, Mapping):
            key = safe_str(
                column.get("key")
                or column.get("field")
            )
            label = safe_str(
                column.get("label")
                or column.get("header")
                or label_from_key(key)
            )
        elif (
            isinstance(column, (list, tuple))
            and len(column) >= 2
        ):
            key = safe_str(column[0])
            label = safe_str(column[1])
        else:
            raise PayrollReportingError(
                f"columns[{index}] is invalid.",
                code="invalid_payroll_report_column",
                details={"index": index},
            )

        if not key:
            raise PayrollReportingError(
                f"columns[{index}] must contain a field key.",
                code="invalid_payroll_report_column",
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


def _report_rows_for_export(
    report: Mapping[str, Any],
) -> list[dict[str, Any]]:
    rows = report.get("rows") or []

    if not isinstance(rows, list):
        raise PayrollReportingError(
            "Report rows are not available for export.",
            code="payroll_report_rows_missing",
        )

    return [
        dict(row)
        for row in rows
        if isinstance(row, Mapping)
    ]


def generate_payroll_report_csv(
    db: Any,
    *,
    tenant_id: str,
    report_type: Any,
    report: Mapping[str, Any],
    columns: Sequence[Any] | None = None,
    delimiter: str = ",",
    include_utf8_bom: bool = True,
    filename_prefix: str = "",
    actor_id: str = "",
    actor_name: str = "",
    persist_export_metadata: bool = True,
) -> dict[str, Any]:
    normalized_report_type = normalize_report_type(
        report_type
    )

    if safe_str(report.get("tenant_id")) not in {
        "",
        safe_str(tenant_id),
    }:
        raise PayrollReportingError(
            "The report tenant does not match the requested tenant.",
            status_code=409,
            code="payroll_report_tenant_mismatch",
        )

    if len(delimiter) != 1:
        raise PayrollReportingError(
            "delimiter must contain exactly one character.",
            code="invalid_payroll_report_delimiter",
        )

    rows = _report_rows_for_export(report)

    if not rows:
        raise PayrollReportingError(
            "The report contains no rows to export.",
            status_code=409,
            code="payroll_report_has_no_rows",
        )

    normalized_columns = _normalize_export_columns(
        columns,
        report_type=normalized_report_type,
    )
    buffer = io.StringIO(newline="")
    writer = csv.writer(
        buffer,
        delimiter=delimiter,
        quoting=csv.QUOTE_MINIMAL,
        lineterminator="\r\n",
    )
    writer.writerow([
        header
        for _, header in normalized_columns
    ])

    for row in rows:
        writer.writerow([
            _sanitize_csv_cell(row.get(field))
            for field, _ in normalized_columns
        ])

    csv_text = buffer.getvalue()
    csv_bytes = csv_text.encode(
        "utf-8-sig" if include_utf8_bom else "utf-8"
    )
    file_hash = hashlib.sha256(csv_bytes).hexdigest()
    periods = [
        safe_str(item)
        for item in (report.get("periods") or [])
        if safe_str(item)
    ]

    if not periods:
        for key in (
            "period_key",
            "base_period",
            "comparison_period",
        ):
            value = safe_str(report.get(key))

            if value:
                periods.append(value)

    period_label = (
        periods[0]
        if len(periods) == 1
        else (
            f"{periods[0]}-to-{periods[-1]}"
            if periods
            else datetime.now(UTC).strftime("%Y%m%d")
        )
    )
    prefix = (
        normalize_key(filename_prefix)
        or normalized_report_type.replace("_", "-")
    )
    filename = f"{prefix}-{period_label}.csv"
    generated_at = now_utc()
    export_id = ""
    row_count = len(rows)
    total_amount = money_value(
        (report.get("totals") or {}).get("net_amount")
        or sum(
            money_decimal(row.get("net_amount"))
            for row in rows
        )
    )
    export_key_source = "|".join([
        safe_str(tenant_id),
        normalized_report_type,
        ",".join(periods),
        file_hash,
    ])
    export_key = hashlib.sha256(
        export_key_source.encode("utf-8")
    ).hexdigest()

    if persist_export_metadata:
        export_document = db[
            PAYROLL_REPORT_EXPORTS_COLLECTION
        ].find_one_and_update(
            {
                "tenant_id": tenant_id,
                "export_key": export_key,
            },
            {
                "$setOnInsert": {
                    "_id": ObjectId(),
                    "tenant_id": tenant_id,
                    "export_key": export_key,
                    "report_type": normalized_report_type,
                    "periods": periods,
                    "filename": filename,
                    "content_type": "text/csv; charset=utf-8",
                    "sha256": file_hash,
                    "delimiter": delimiter,
                    "include_utf8_bom": bool(
                        include_utf8_bom
                    ),
                    "columns": [
                        {
                            "key": key,
                            "header": header,
                        }
                        for key, header in normalized_columns
                    ],
                    "row_count": row_count,
                    "total_amount": total_amount,
                    "status": "generated",
                    "filters": dict(
                        report.get("filters") or {}
                    ),
                    "created_at": generated_at,
                    "created_by": safe_str(actor_id),
                    "created_by_name": safe_str(actor_name),
                    "is_deleted": False,
                },
                "$set": {
                    "last_generated_at": generated_at,
                    "last_generated_by": safe_str(actor_id),
                    "last_generated_by_name": safe_str(
                        actor_name
                    ),
                },
                "$inc": {
                    "generation_count": 1,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        export_id = safe_str(export_document.get("_id"))
        generated_at = (
            export_document.get("created_at")
            or generated_at
        )

    return {
        "report": report,
        "export": {
            "id": export_id,
            "export_key": export_key,
            "filename": filename,
            "content_type": "text/csv; charset=utf-8",
            "report_type": normalized_report_type,
            "periods": periods,
            "row_count": row_count,
            "total_amount": total_amount,
            "sha256": file_hash,
            "generated_at": generated_at,
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


def list_payroll_report_exports(
    db: Any,
    *,
    tenant_id: str,
    report_types: Iterable[Any] | None = None,
    periods: Iterable[Any] | None = None,
    statuses: Iterable[Any] | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }
    normalized_types = {
        normalize_report_type(item)
        for item in (report_types or [])
        if safe_str(item)
    }

    if normalized_types:
        query["report_type"] = {
            "$in": sorted(normalized_types)
        }

    normalized_periods = {
        parse_period(item)
        for item in (periods or [])
        if safe_str(item)
    }

    if normalized_periods:
        query["periods"] = {
            "$in": sorted(normalized_periods)
        }

    normalized_statuses = {
        normalize_key(item)
        for item in (statuses or [])
        if safe_str(item)
    }

    if normalized_statuses:
        invalid = (
            normalized_statuses
            - PAYROLL_REPORT_EXPORT_STATUSES
        )

        if invalid:
            raise PayrollReportingError(
                "One or more report export statuses are invalid.",
                code="invalid_payroll_report_export_status",
                details={
                    "statuses": sorted(invalid),
                    "allowed_statuses": sorted(
                        PAYROLL_REPORT_EXPORT_STATUSES
                    ),
                },
            )

        query["status"] = {
            "$in": sorted(normalized_statuses)
        }

    safe_limit = max(1, min(int(limit or 200), 1000))

    return list(
        db[PAYROLL_REPORT_EXPORTS_COLLECTION]
        .find(query)
        .sort([
            ("created_at", -1),
            ("_id", -1),
        ])
        .limit(safe_limit)
    )


def update_payroll_report_export_status(
    db: Any,
    *,
    tenant_id: str,
    export_id: Any,
    status: Any,
    actor_id: str = "",
    actor_name: str = "",
    note: str = "",
) -> dict[str, Any]:
    parsed_id = object_id(export_id)

    if not parsed_id:
        raise PayrollReportingError(
            "Invalid payroll report export identifier.",
            status_code=404,
            code="payroll_report_export_not_found",
        )

    normalized_status = normalize_key(status)

    if normalized_status not in PAYROLL_REPORT_EXPORT_STATUSES:
        raise PayrollReportingError(
            "Unsupported payroll report export status.",
            code="invalid_payroll_report_export_status",
            details={
                "allowed_statuses": sorted(
                    PAYROLL_REPORT_EXPORT_STATUSES
                ),
            },
        )

    now = now_utc()
    history_entry = {
        "status": normalized_status,
        "note": safe_str(note),
        "actor_id": safe_str(actor_id),
        "actor_name": safe_str(actor_name),
        "at": now,
    }
    result = db[
        PAYROLL_REPORT_EXPORTS_COLLECTION
    ].find_one_and_update(
        {
            "_id": parsed_id,
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "status": normalized_status,
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
        raise PayrollReportingError(
            "Payroll report export was not found.",
            status_code=404,
            code="payroll_report_export_not_found",
        )

    return result


__all__ = [
    "DEFAULT_DEPARTMENT_COLUMNS",
    "DEFAULT_REGISTER_COLUMNS",
    "DEFAULT_STATUTORY_COLUMNS",
    "DEFAULT_VARIANCE_COLUMNS",
    "OFFICIAL_PAYROLL_STATUSES",
    "PAYROLL_REPORT_EXPORT_STATUSES",
    "PAYROLL_REPORT_TYPES",
    "PAYROLL_REPORT_EXPORTS_COLLECTION",
    "PayrollReportingError",
    "department_summary",
    "employee_statement",
    "generate_payroll_report_csv",
    "label_from_key",
    "list_payroll_report_exports",
    "money_decimal",
    "normalize_report_type",
    "normalize_statuses",
    "parse_period",
    "payroll_register",
    "payroll_register_row",
    "payroll_summary",
    "payroll_trend",
    "period_range",
    "period_variance",
    "statutory_summary",
    "summarize_register_rows",
    "update_payroll_report_export_status",
]