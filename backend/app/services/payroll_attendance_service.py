from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

UTC = timezone.utc  # Python 3.10 compatible replacement for datetime.UTC
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

from bson import ObjectId
from pymongo import ReturnDocument


ATTENDANCE_SUMMARY_COLLECTION = "attendance_summaries"

FINALIZED_PAYROLL_STATUSES = {
    "hr_reviewed",
    "finance_approved",
    "locked",
    "disbursed",
}

# Keep attendance synchronization aligned with the canonical payroll workflow.
# Legacy values are normalized at read time; new payroll records are written by
# payroll.py using the canonical values above.
PAYROLL_STATUS_ALIASES = {
    "pending_hr_review": "draft",
    "hr_review_pending": "draft",
    "reviewed": "hr_reviewed",
    "pending_finance_approval": "hr_reviewed",
    "finance_approval_pending": "hr_reviewed",
    "approved": "finance_approved",
    "finance_approved": "finance_approved",
    "locked": "locked",
    "disbursed": "disbursed",
}

ACTIVE_EMPLOYEE_STATUSES = {
    "",
    "active",
    "approved",
    "confirmed",
    "probation",
    "probationary",
    "on_duty",
}


class PayrollAttendanceError(ValueError):
    """Business-rule error raised while preparing payroll attendance summaries."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str = "payroll_attendance_error",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details or {}


@dataclass(frozen=True)
class PayrollPeriod:
    year: int
    month: int
    start_date: date
    end_date: date
    period_key: str
    total_days: int


def safe_str(value: Any) -> str:
    return str(value or "").strip()


def normalize_key(value: Any) -> str:
    return safe_str(value).lower().replace("-", "_").replace(" ", "_")


def truthy(value: Any) -> bool:
    return safe_str(value).lower() in {"1", "true", "yes", "on"}


def decimal_number(
    value: Any,
    *,
    field_name: str,
    default: Decimal = Decimal("0"),
) -> Decimal:
    if value in (None, ""):
        return default

    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise PayrollAttendanceError(
            f"{field_name} must be a valid number.",
            code="invalid_attendance_number",
            details={"field": field_name},
        ) from exc

    if not number.is_finite():
        raise PayrollAttendanceError(
            f"{field_name} must be a finite number.",
            code="invalid_attendance_number",
            details={"field": field_name},
        )

    return number


def json_number(value: Decimal | int | float) -> int | float:
    number = Decimal(str(value))

    if number == number.to_integral_value():
        return int(number)

    return float(number.quantize(Decimal("0.01")))


def parse_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    text = safe_str(value)

    if not text:
        return None

    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        pass

    for pattern in ("%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue

    return None


def resolve_payroll_period(
    period: Any = None,
    *,
    month: Any = None,
    year: Any = None,
) -> PayrollPeriod:
    raw_period = safe_str(period)

    resolved_month: int
    resolved_year: int

    if raw_period:
        try:
            parsed = datetime.strptime(raw_period, "%Y-%m")
        except ValueError as exc:
            raise PayrollAttendanceError(
                "period must use YYYY-MM format.",
                code="invalid_payroll_period",
            ) from exc

        resolved_year = parsed.year
        resolved_month = parsed.month
    else:
        try:
            resolved_year = int(year)
            resolved_month = int(month)
        except (TypeError, ValueError) as exc:
            raise PayrollAttendanceError(
                "Provide period in YYYY-MM format, or provide month and year.",
                code="payroll_period_required",
            ) from exc

    if resolved_year < 2000 or resolved_year > 2200:
        raise PayrollAttendanceError(
            "Payroll year must be between 2000 and 2200.",
            code="invalid_payroll_year",
        )

    if resolved_month < 1 or resolved_month > 12:
        raise PayrollAttendanceError(
            "Payroll month must be between 1 and 12.",
            code="invalid_payroll_month",
        )

    total_days = calendar.monthrange(resolved_year, resolved_month)[1]
    start_date = date(resolved_year, resolved_month, 1)
    end_date = date(resolved_year, resolved_month, total_days)

    return PayrollPeriod(
        year=resolved_year,
        month=resolved_month,
        start_date=start_date,
        end_date=end_date,
        period_key=f"{resolved_year:04d}-{resolved_month:02d}",
        total_days=total_days,
    )


def date_range(start_date: date, end_date: date) -> Iterable[date]:
    cursor = start_date

    while cursor <= end_date:
        yield cursor
        cursor += timedelta(days=1)


def is_second_or_fourth_saturday(check_date: date) -> bool:
    if check_date.weekday() != 5:
        return False

    saturday_number = 0

    for day_number in range(1, check_date.day + 1):
        if date(check_date.year, check_date.month, day_number).weekday() == 5:
            saturday_number += 1

    return saturday_number in {2, 4}


def normalize_employee_state(value: Any) -> str:
    state = safe_str(value)

    # Missing state must remain missing. Defaulting it to Assam can apply the
    # wrong holiday calendar and, later, the wrong Professional Tax rules.
    if not state:
        return ""

    lowered = state.lower()

    if lowered in {
        "assam",
        "assam ho",
        "assam(ho)",
        "ho",
        "assam/guwahati (ho)",
    }:
        return "Assam(HO)"

    return state


def employee_state(employee: dict[str, Any]) -> str:
    return normalize_employee_state(
        employee.get("state")
        or employee.get("branch")
        or employee.get("work_state")
    )


def employee_name(employee: dict[str, Any]) -> str:
    return safe_str(
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or employee.get("display_name")
        or employee.get("official_email")
        or employee.get("email")
        or "Employee"
    )


def employee_code(employee: dict[str, Any]) -> str:
    return safe_str(
        employee.get("employee_code")
        or employee.get("emp_code")
        or employee.get("employee_id")
        or employee.get("code")
    )


def canonical_employee_id(employee: dict[str, Any]) -> str:
    return safe_str(employee.get("_id"))


def object_id(value: Any) -> ObjectId | None:
    try:
        return ObjectId(safe_str(value))
    except Exception:
        return None


def _employee_identity_filters(reference: Any) -> list[dict[str, Any]]:
    text = safe_str(reference)

    if not text:
        return []

    filters: list[dict[str, Any]] = [
        {"employee_id": text},
        {"employee_code": text},
        {"emp_code": text},
        {"code": text},
        {"user_id": text},
        {"official_email": text.lower()},
        {"email": text.lower()},
    ]

    parsed_id = object_id(text)

    if parsed_id:
        filters.insert(0, {"_id": parsed_id})

    return filters


def find_employee(
    db: Any,
    tenant_id: str,
    employee_reference: Any,
) -> dict[str, Any] | None:
    identity_filters = _employee_identity_filters(employee_reference)

    if not identity_filters:
        return None

    return db.employees.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": identity_filters,
    })


def list_payroll_employees(
    db: Any,
    tenant_id: str,
    employee_references: Iterable[Any] | None = None,
) -> list[dict[str, Any]]:
    requested = [
        safe_str(reference)
        for reference in (employee_references or [])
        if safe_str(reference)
    ]

    if requested:
        employees: list[dict[str, Any]] = []
        missing: list[str] = []
        seen_ids: set[str] = set()

        for reference in requested:
            employee = find_employee(db, tenant_id, reference)

            if not employee:
                missing.append(reference)
                continue

            employee_id = canonical_employee_id(employee)

            if employee_id in seen_ids:
                continue

            seen_ids.add(employee_id)
            employees.append(employee)

        if missing:
            raise PayrollAttendanceError(
                "One or more selected employees were not found.",
                status_code=404,
                code="payroll_employees_not_found",
                details={"employee_references": missing},
            )

        return employees

    rows = list(
        db.employees.find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "status": {"$nin": ["Inactive", "inactive", "Alumni", "alumni"]},
        }).sort([
            ("employee_name", 1),
            ("name", 1),
            ("employee_code", 1),
        ])
    )

    return rows


def _manual_holiday_dates(
    db: Any,
    tenant_id: str,
    state: str,
    period: PayrollPeriod,
) -> set[str]:
    state_candidates = {state, normalize_employee_state(state)}

    if state == "Assam(HO)":
        state_candidates.update({
            "Assam",
            "Assam HO",
            "Assam(HO)",
            "Assam/Guwahati (HO)",
            "HO",
        })

    rows = db.holiday_calendar.find({
        "tenant_id": tenant_id,
        "state": {"$in": list(state_candidates)},
        "date": {
            "$gte": period.start_date.isoformat(),
            "$lte": period.end_date.isoformat(),
        },
        "status": {"$ne": "inactive"},
        "is_deleted": {"$ne": True},
    })

    return {
        safe_str(row.get("date"))[:10]
        for row in rows
        if safe_str(row.get("date"))
    }


def working_dates_for_employee(
    db: Any,
    tenant_id: str,
    employee: dict[str, Any],
    period: PayrollPeriod,
) -> tuple[list[str], dict[str, list[str]]]:
    state = employee_state(employee)

    if not state:
        raise PayrollAttendanceError(
            "Payroll state is missing for this employee.",
            code="employee_payroll_state_missing",
            details={
                "employee_id": canonical_employee_id(employee),
                "employee_code": employee_code(employee),
                "employee_name": employee_name(employee),
            },
        )

    manual_holidays = _manual_holiday_dates(
        db,
        tenant_id,
        state,
        period,
    )

    working_dates: list[str] = []
    weekly_holidays: list[str] = []
    configured_holidays: list[str] = []

    for cursor in date_range(period.start_date, period.end_date):
        date_key = cursor.isoformat()

        if date_key in manual_holidays:
            configured_holidays.append(date_key)
            continue

        if cursor.weekday() == 6 or is_second_or_fourth_saturday(cursor):
            weekly_holidays.append(date_key)
            continue

        working_dates.append(date_key)

    return working_dates, {
        "weekly_holidays": weekly_holidays,
        "configured_holidays": configured_holidays,
    }


def _leave_weight(row: dict[str, Any], overlap_days: int) -> Decimal:
    is_half_day = (
        truthy(row.get("is_half_day"))
        or normalize_key(row.get("day_type")) == "half_day"
    )

    stored_days = decimal_number(
        row.get("leave_days"),
        field_name="leave_days",
        default=Decimal("0"),
    )

    if overlap_days == 1 and (is_half_day or stored_days == Decimal("0.5")):
        return Decimal("0.5")

    return Decimal("1")


def _leave_is_lwp(row: dict[str, Any]) -> bool:
    type_values = {
        normalize_key(row.get("leave_type")),
        normalize_key(row.get("leave_type_label")),
        normalize_key(row.get("requested_leave_type")),
        normalize_key(row.get("requested_leave_type_label")),
        normalize_key(row.get("deducted_leave_type")),
        normalize_key(row.get("deducted_leave_type_label")),
    }

    return bool(
        type_values.intersection({
            "lwp",
            "leave_without_pay",
            "leave_without_pay_lwp",
        })
    )


def _approved_leave_rows(
    db: Any,
    tenant_id: str,
    employee_id: str,
    period: PayrollPeriod,
) -> list[dict[str, Any]]:
    return list(db.leave_requests.find({
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "status": "approved",
        "approval_stage": "approved",
        "from_date": {"$lte": period.end_date.isoformat()},
        "to_date": {"$gte": period.start_date.isoformat()},
        "is_deleted": {"$ne": True},
    }))


def leave_summary_for_employee(
    db: Any,
    tenant_id: str,
    employee: dict[str, Any],
    period: PayrollPeriod,
    working_dates: list[str],
) -> dict[str, Any]:
    employee_id = canonical_employee_id(employee)
    working_date_set = set(working_dates)
    leave_rows = _approved_leave_rows(
        db,
        tenant_id,
        employee_id,
        period,
    )

    paid_by_date: dict[str, Decimal] = {}
    lwp_by_date: dict[str, Decimal] = {}
    leave_request_ids: list[str] = []
    warnings: list[str] = []

    for row in leave_rows:
        from_date = parse_date(row.get("from_date"))
        to_date = parse_date(row.get("to_date") or row.get("upto_date")) or from_date

        if not from_date or not to_date:
            warnings.append(
                f"Leave request {safe_str(row.get('_id'))} has an invalid date range."
            )
            continue

        overlap_start = max(from_date, period.start_date)
        overlap_end = min(to_date, period.end_date)

        if overlap_end < overlap_start:
            continue

        overlap_working_dates = [
            cursor.isoformat()
            for cursor in date_range(overlap_start, overlap_end)
            if cursor.isoformat() in working_date_set
        ]

        if not overlap_working_dates:
            continue

        leave_request_ids.append(safe_str(row.get("_id")))
        default_weight = _leave_weight(row, len(overlap_working_dates))
        explicit_lwp_days = decimal_number(
            row.get("lwp_days"),
            field_name="lwp_days",
            default=Decimal("0"),
        )

        if explicit_lwp_days < 0:
            raise PayrollAttendanceError(
                "Approved leave contains a negative LWP value.",
                code="invalid_approved_lwp_days",
                details={"leave_request_id": safe_str(row.get("_id"))},
            )

        remaining_explicit_lwp = explicit_lwp_days
        entire_leave_is_lwp = _leave_is_lwp(row)

        for date_key in overlap_working_dates:
            weight = default_weight

            if entire_leave_is_lwp:
                lwp_weight = weight
            elif remaining_explicit_lwp > 0:
                lwp_weight = min(weight, remaining_explicit_lwp)
                remaining_explicit_lwp -= lwp_weight
            else:
                lwp_weight = Decimal("0")

            paid_weight = max(Decimal("0"), weight - lwp_weight)

            current_lwp = lwp_by_date.get(date_key, Decimal("0"))
            lwp_by_date[date_key] = min(
                Decimal("1"),
                current_lwp + lwp_weight,
            )

            remaining_capacity = max(
                Decimal("0"),
                Decimal("1") - lwp_by_date[date_key],
            )
            current_paid = paid_by_date.get(date_key, Decimal("0"))
            paid_by_date[date_key] = min(
                remaining_capacity,
                current_paid + paid_weight,
            )

        if remaining_explicit_lwp > 0:
            warnings.append(
                "An approved leave request contains more LWP days than its "
                f"working-day overlap in {period.period_key}."
            )

    paid_leave_days = sum(paid_by_date.values(), Decimal("0"))
    lwp_days = sum(lwp_by_date.values(), Decimal("0"))

    leave_balances = list(db.leave_balances.find({
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "is_deleted": {"$ne": True},
    }))

    balance_by_type: dict[str, float | int] = {}
    total_leave_balance = Decimal("0")

    for balance in leave_balances:
        leave_type = safe_str(
            balance.get("leave_type")
            or balance.get("leave_type_label")
            or "UNKNOWN"
        ).upper()
        available = decimal_number(
            balance.get("available"),
            field_name=f"{leave_type} leave balance",
            default=Decimal("0"),
        )
        available = max(Decimal("0"), available)
        balance_by_type[leave_type] = json_number(available)

        # Comp-off is credit-based and should remain visible separately rather
        # than being merged into the ordinary CL/EL balance shown on payslips.
        if leave_type in {"CL", "EL"}:
            total_leave_balance += available

    return {
        "paid_leave_days": json_number(paid_leave_days),
        "lwp_days": json_number(lwp_days),
        "leave_availed": json_number(paid_leave_days + lwp_days),
        "leave_balance": json_number(total_leave_balance),
        "leave_balance_by_type": balance_by_type,
        "paid_leave_dates": sorted(paid_by_date),
        "lwp_dates": sorted(lwp_by_date),
        "leave_request_ids": leave_request_ids,
        "warnings": warnings,
    }


def attendance_log_summary(
    db: Any,
    tenant_id: str,
    employee_id: str,
    period: PayrollPeriod,
) -> dict[str, Any]:
    rows = list(db.attendance_logs.find({
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "date": {
            "$gte": period.start_date.isoformat(),
            "$lte": period.end_date.isoformat(),
        },
        "is_deleted": {"$ne": True},
    }))

    rows_by_date: dict[str, list[dict[str, Any]]] = {}

    for row in rows:
        date_key = safe_str(row.get("date"))[:10]

        if date_key:
            rows_by_date.setdefault(date_key, []).append(row)

    present_dates = sorted(rows_by_date)
    late_dates: list[str] = []
    complete_dates: list[str] = []
    incomplete_dates: list[str] = []
    holiday_work_dates: list[str] = []
    attendance_log_ids: list[str] = []

    for date_key, date_rows in rows_by_date.items():
        attendance_log_ids.extend(
            safe_str(row.get("_id"))
            for row in date_rows
            if safe_str(row.get("_id"))
        )

        if any(
            normalize_key(row.get("status")) == "late"
            or truthy(row.get("is_late"))
            for row in date_rows
        ):
            late_dates.append(date_key)

        if any(row.get("check_out") for row in date_rows):
            complete_dates.append(date_key)
        else:
            incomplete_dates.append(date_key)

        if any(truthy(row.get("is_holiday_work")) for row in date_rows):
            holiday_work_dates.append(date_key)

    latest_updated_at = max(
        (
            row.get("updated_at")
            or row.get("created_at")
            for row in rows
            if row.get("updated_at") or row.get("created_at")
        ),
        default=None,
    )

    return {
        "attendance_log_count": len(rows),
        "present_days": len(present_dates),
        "present_dates": present_dates,
        "late_days": len(set(late_dates)),
        "late_dates": sorted(set(late_dates)),
        "complete_attendance_days": len(set(complete_dates)),
        "complete_attendance_dates": sorted(set(complete_dates)),
        "incomplete_attendance_days": len(set(incomplete_dates)),
        "incomplete_attendance_dates": sorted(set(incomplete_dates)),
        "holiday_work_days": len(set(holiday_work_dates)),
        "holiday_work_dates": sorted(set(holiday_work_dates)),
        "attendance_log_ids": attendance_log_ids,
        "attendance_latest_updated_at": latest_updated_at,
    }


def _employment_period_warnings(
    employee: dict[str, Any],
    period: PayrollPeriod,
) -> list[str]:
    warnings: list[str] = []

    joining_date = parse_date(
        employee.get("date_of_joining")
        or employee.get("joining_date")
        or employee.get("date_joined")
        or employee.get("doj")
    )
    exit_date = parse_date(
        employee.get("last_working_date")
        or employee.get("relieving_date")
        or employee.get("exit_date")
        or employee.get("resignation_effective_date")
    )

    if joining_date and period.start_date <= joining_date <= period.end_date:
        warnings.append(
            "The employee joined during this payroll month. The attendance "
            "summary does not apply an automatic joining-date salary deduction."
        )

    if exit_date and period.start_date <= exit_date <= period.end_date:
        warnings.append(
            "The employee exited during this payroll month. The attendance "
            "summary does not apply an automatic exit-date salary deduction."
        )

    return warnings


def canonical_payroll_status(value: Any) -> str:
    status = normalize_key(value or "draft") or "draft"
    return PAYROLL_STATUS_ALIASES.get(status, status)


def _collection(db: Any, name: str) -> Any:
    try:
        return db[name]
    except (KeyError, TypeError, AttributeError):
        return getattr(db, name)


def _run_identifier(run: dict[str, Any] | None) -> str:
    if not run:
        return ""
    return safe_str(run.get("_id") or run.get("id") or run.get("run_id"))


def _employee_id_values(values: Iterable[Any]) -> set[str]:
    return {safe_str(value) for value in values if safe_str(value)}


def _employee_query_values(employee_ids: Iterable[str]) -> list[Any]:
    values: list[Any] = []
    seen: set[tuple[str, str]] = set()

    for employee_id in employee_ids:
        text = safe_str(employee_id)
        if not text:
            continue

        key = ("str", text)
        if key not in seen:
            seen.add(key)
            values.append(text)

        parsed = object_id(text)
        if parsed is not None:
            object_key = ("object_id", str(parsed))
            if object_key not in seen:
                seen.add(object_key)
                values.append(parsed)

    return values


def _blocked_employee_detail(
    employee_id: str,
    *,
    run: dict[str, Any] | None,
    status: str,
    source: str,
    payslip_id: str = "",
) -> dict[str, Any]:
    normalized_status = canonical_payroll_status(status)
    return {
        "employee_id": employee_id,
        "status": normalized_status,
        "run_id": _run_identifier(run),
        "run_code": safe_str((run or {}).get("run_code")),
        "payslip_id": payslip_id,
        "source": source,
        "eligibility": "already_processed",
        "reason": (
            "Attendance synchronization is blocked because this employee's "
            "payroll has already entered review, approval, lock, or disbursement."
        ),
    }


def assert_payroll_period_is_editable(
    db: Any,
    tenant_id: str,
    period_key: str,
    employee_ids: Iterable[Any] | None = None,
) -> dict[str, Any] | None:
    """Validate payroll attendance editability.

    With no employee IDs this preserves the legacy period-level guard used by
    older callers. With employee IDs it evaluates each employee separately and
    returns eligible and blocked groups, allowing another employee to be synced
    in the same month even when a colleague is already finalized.
    """
    tenant_id = safe_str(tenant_id)
    period_key = safe_str(period_key)
    selected_ids = _employee_id_values(employee_ids or [])
    payroll_runs = _collection(db, "payroll_runs")

    if not selected_ids:
        run = payroll_runs.find_one({
            "tenant_id": tenant_id,
            "period_key": period_key,
            "is_deleted": {"$ne": True},
        })

        if not run:
            return None

        status = canonical_payroll_status(
            run.get("status") or run.get("workflow_stage")
        )

        if truthy(run.get("is_locked")) or status in FINALIZED_PAYROLL_STATUSES:
            raise PayrollAttendanceError(
                "Attendance cannot be synchronized because this payroll run has "
                "already entered review, approval, lock, or disbursement.",
                status_code=409,
                code="payroll_period_not_editable",
                details={
                    "run_id": _run_identifier(run),
                    "status": status,
                    "period_key": period_key,
                },
            )

        return None

    runs = list(payroll_runs.find({
        "tenant_id": tenant_id,
        "period_key": period_key,
        "is_deleted": {"$ne": True},
    }))
    runs_by_id = {
        _run_identifier(run): run
        for run in runs
        if _run_identifier(run)
    }
    blocked_by_employee: dict[str, dict[str, Any]] = {}

    # First inspect employee IDs stored directly on payroll runs. This also
    # supports older data where a payslip may not have been persisted correctly.
    for run in runs:
        status = canonical_payroll_status(
            run.get("status") or run.get("workflow_stage")
        )
        finalized = truthy(run.get("is_locked")) or status in FINALIZED_PAYROLL_STATUSES
        if not finalized:
            continue

        run_employee_ids = _employee_id_values(run.get("employee_ids") or [])
        for employee_id in selected_ids.intersection(run_employee_ids):
            blocked_by_employee[employee_id] = _blocked_employee_detail(
                employee_id,
                run=run,
                status=status,
                source="payroll_run",
            )

    # Payslips are authoritative for employee membership when run.employee_ids
    # is missing or incomplete. Tenant and period remain mandatory filters.
    payslips_collection = _collection(db, "payslips")
    payslips = list(payslips_collection.find({
        "tenant_id": tenant_id,
        "period_key": period_key,
        "employee_id": {"$in": _employee_query_values(selected_ids)},
        "is_deleted": {"$ne": True},
    }))

    status_priority = {
        "draft": 10,
        "hr_reviewed": 20,
        "finance_approved": 30,
        "locked": 40,
        "disbursed": 50,
    }

    for payslip in payslips:
        employee_id = safe_str(payslip.get("employee_id"))
        if employee_id not in selected_ids:
            continue

        run_id = safe_str(payslip.get("run_id") or payslip.get("payroll_run_id"))
        run = runs_by_id.get(run_id)
        status = canonical_payroll_status(
            payslip.get("status")
            or payslip.get("workflow_stage")
            or (run or {}).get("status")
            or (run or {}).get("workflow_stage")
        )
        finalized = (
            truthy(payslip.get("is_locked"))
            or truthy((run or {}).get("is_locked"))
            or status in FINALIZED_PAYROLL_STATUSES
        )
        if not finalized:
            continue

        existing = blocked_by_employee.get(employee_id)
        existing_priority = status_priority.get(
            canonical_payroll_status((existing or {}).get("status")),
            0,
        )
        if existing and existing_priority >= status_priority.get(status, 0):
            continue

        blocked_by_employee[employee_id] = _blocked_employee_detail(
            employee_id,
            run=run,
            status=status,
            source="payslip",
            payslip_id=safe_str(payslip.get("_id")),
        )

    blocked = [
        blocked_by_employee[employee_id]
        for employee_id in sorted(blocked_by_employee)
    ]
    eligible_employee_ids = sorted(selected_ids.difference(blocked_by_employee))

    return {
        "period_key": period_key,
        "eligible_employee_ids": eligible_employee_ids,
        "blocked_employee_ids": [item["employee_id"] for item in blocked],
        "blocked": blocked,
    }


def build_attendance_summary(
    db: Any,
    tenant_id: str,
    employee: dict[str, Any],
    period: PayrollPeriod,
    *,
    actor_id: str = "",
    actor_name: str = "",
    synced_at: datetime | None = None,
) -> dict[str, Any]:
    if safe_str(employee.get("tenant_id")) != tenant_id:
        raise PayrollAttendanceError(
            "Employee does not belong to the selected company.",
            status_code=403,
            code="payroll_employee_tenant_mismatch",
        )

    employee_id = canonical_employee_id(employee)

    if not employee_id:
        raise PayrollAttendanceError(
            "Employee record does not have a valid identifier.",
            code="invalid_payroll_employee",
        )

    working_dates, holiday_summary = working_dates_for_employee(
        db,
        tenant_id,
        employee,
        period,
    )
    leave_summary = leave_summary_for_employee(
        db,
        tenant_id,
        employee,
        period,
        working_dates,
    )
    log_summary = attendance_log_summary(
        db,
        tenant_id,
        employee_id,
        period,
    )

    working_date_set = set(working_dates)
    present_working_dates = working_date_set.intersection(
        log_summary["present_dates"]
    )
    paid_leave_date_set = set(leave_summary["paid_leave_dates"])
    lwp_date_set = set(leave_summary["lwp_dates"])

    absent_days = Decimal("0")

    for date_key in working_dates:
        if date_key in present_working_dates:
            continue

        if date_key in paid_leave_date_set or date_key in lwp_date_set:
            continue

        absent_days += Decimal("1")

    lwp_days = decimal_number(
        leave_summary["lwp_days"],
        field_name="lwp_days",
    )
    payable_days = Decimal(period.total_days) - lwp_days

    if payable_days < 0:
        raise PayrollAttendanceError(
            "LWP days cannot exceed the total calendar days in the payroll month.",
            code="lwp_exceeds_month_days",
            details={
                "employee_id": employee_id,
                "lwp_days": json_number(lwp_days),
                "total_days": period.total_days,
            },
        )

    warnings = [
        *leave_summary["warnings"],
        *_employment_period_warnings(employee, period),
    ]

    if absent_days > 0:
        warnings.append(
            "Uncovered absence days are recorded for attendance tracking only. "
            "They are not converted to LWP automatically."
        )

    if log_summary["incomplete_attendance_days"] > 0:
        warnings.append(
            "One or more attendance days do not have a checkout record."
        )

    now = synced_at or datetime.now(UTC)

    return {
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "employee_code": employee_code(employee),
        "employee_name": employee_name(employee),
        "department": safe_str(employee.get("department")),
        "designation": safe_str(employee.get("designation")),
        "state": employee_state(employee),
        "period_key": period.period_key,
        "month": period.month,
        "year": period.year,
        "period_start": period.start_date.isoformat(),
        "period_end": period.end_date.isoformat(),
        "total_days": period.total_days,
        "working_days": len(working_dates),
        "weekly_holidays": len(holiday_summary["weekly_holidays"]),
        "configured_holidays": len(holiday_summary["configured_holidays"]),
        "present_days": log_summary["present_days"],
        "present_working_days": len(present_working_dates),
        "late_days": log_summary["late_days"],
        "absent_days": json_number(absent_days),
        "paid_leave_days": leave_summary["paid_leave_days"],
        "lwp_days": leave_summary["lwp_days"],
        "leave_availed": leave_summary["leave_availed"],
        "leave_balance": leave_summary["leave_balance"],
        "leave_balance_by_type": leave_summary["leave_balance_by_type"],
        "payable_days": json_number(payable_days),
        "attendance_log_count": log_summary["attendance_log_count"],
        "complete_attendance_days": log_summary["complete_attendance_days"],
        "incomplete_attendance_days": log_summary["incomplete_attendance_days"],
        "holiday_work_days": log_summary["holiday_work_days"],
        "working_dates": working_dates,
        "present_dates": log_summary["present_dates"],
        "late_dates": log_summary["late_dates"],
        "paid_leave_dates": leave_summary["paid_leave_dates"],
        "lwp_dates": leave_summary["lwp_dates"],
        "holiday_work_dates": log_summary["holiday_work_dates"],
        "incomplete_attendance_dates": log_summary["incomplete_attendance_dates"],
        "source_attendance_log_ids": log_summary["attendance_log_ids"],
        "source_leave_request_ids": leave_summary["leave_request_ids"],
        "source_attendance_updated_at": log_summary["attendance_latest_updated_at"],
        "source": "attendance_leave_sync",
        "sync_status": "synced",
        "warnings": warnings,
        "synced_at": now,
        "synced_by": actor_id,
        "synced_by_name": actor_name,
        "updated_at": now,
    }


def save_attendance_summary(
    db: Any,
    summary: dict[str, Any],
) -> dict[str, Any]:
    query = {
        "tenant_id": summary["tenant_id"],
        "employee_id": summary["employee_id"],
        "period_key": summary["period_key"],
    }

    now = summary.get("synced_at") or datetime.now(UTC)
    update_values = dict(summary)
    update_values["updated_at"] = now

    saved = db[ATTENDANCE_SUMMARY_COLLECTION].find_one_and_update(
        query,
        {
            "$set": update_values,
            "$setOnInsert": {
                "created_at": now,
                "is_deleted": False,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    return saved or summary


def sync_attendance_summaries(
    db: Any,
    *,
    tenant_id: str,
    period: Any = None,
    month: Any = None,
    year: Any = None,
    employee_references: Iterable[Any] | None = None,
    actor_id: str = "",
    actor_name: str = "",
    persist: bool = True,
) -> dict[str, Any]:
    tenant_id = safe_str(tenant_id)

    if not tenant_id:
        raise PayrollAttendanceError(
            "tenant_id is required.",
            code="payroll_tenant_required",
        )

    payroll_period = resolve_payroll_period(
        period,
        month=month,
        year=year,
    )

    employees = list_payroll_employees(
        db,
        tenant_id,
        employee_references,
    )

    if not employees:
        raise PayrollAttendanceError(
            "No active employees were found for attendance synchronization.",
            status_code=404,
            code="no_payroll_employees",
        )

    employees_by_id = {
        canonical_employee_id(employee): employee
        for employee in employees
        if canonical_employee_id(employee)
    }
    editability = assert_payroll_period_is_editable(
        db,
        tenant_id,
        payroll_period.period_key,
        employees_by_id.keys(),
    )

    # A mocked or legacy caller may not return the new classification payload.
    # In that case all resolved employees remain eligible, preserving backwards
    # compatibility while the application routes adopt employee-level checks.
    if isinstance(editability, dict):
        eligible_ids = {
            safe_str(value)
            for value in editability.get("eligible_employee_ids") or []
            if safe_str(value)
        }
        blocked_rows = list(editability.get("blocked") or [])
    else:
        eligible_ids = set(employees_by_id)
        blocked_rows = []

    blocked_by_id = {
        safe_str(row.get("employee_id")): row
        for row in blocked_rows
        if safe_str(row.get("employee_id"))
    }
    eligible_employees = [
        employee
        for employee in employees
        if canonical_employee_id(employee) in eligible_ids
        and canonical_employee_id(employee) not in blocked_by_id
    ]

    blocked: list[dict[str, Any]] = []
    for employee_id, row in blocked_by_id.items():
        employee = employees_by_id.get(employee_id) or {}
        blocked.append({
            **row,
            "employee_id": employee_id,
            "employee_code": employee_code(employee),
            "employee_name": employee_name(employee),
            "message": row.get("reason") or (
                "Attendance synchronization is not allowed for this employee."
            ),
            "code": "payroll_employee_not_editable",
            "details": {
                "period_key": payroll_period.period_key,
                "run_id": safe_str(row.get("run_id")),
                "run_code": safe_str(row.get("run_code")),
                "status": canonical_payroll_status(row.get("status")),
            },
        })

    if not eligible_employees:
        raise PayrollAttendanceError(
            "Attendance cannot be synchronized because all selected employees "
            "have already entered payroll review, approval, lock, or disbursement.",
            status_code=409,
            code="payroll_employees_not_editable",
            details={
                "period_key": payroll_period.period_key,
                "blocked_employee_ids": sorted(blocked_by_id),
                "blocked": blocked,
            },
        )

    synced_at = datetime.now(UTC)
    items: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = list(blocked)
    processing_failures = 0

    for employee in eligible_employees:
        try:
            summary = build_attendance_summary(
                db,
                tenant_id,
                employee,
                payroll_period,
                actor_id=actor_id,
                actor_name=actor_name,
                synced_at=synced_at,
            )

            if persist:
                summary = save_attendance_summary(db, summary)

            items.append(summary)
        except PayrollAttendanceError as exc:
            processing_failures += 1
            failures.append({
                "employee_id": canonical_employee_id(employee),
                "employee_code": employee_code(employee),
                "employee_name": employee_name(employee),
                "message": exc.message,
                "code": exc.code,
                "details": exc.details,
            })
        except Exception as exc:  # Preserve batch progress but report exact employee.
            processing_failures += 1
            failures.append({
                "employee_id": canonical_employee_id(employee),
                "employee_code": employee_code(employee),
                "employee_name": employee_name(employee),
                "message": str(exc) or "Unexpected attendance synchronization failure.",
                "code": "unexpected_attendance_sync_error",
            })

    totals = {
        "employees_requested": len(employees),
        "employees_eligible": len(eligible_employees),
        "employees_blocked": len(blocked),
        "employees_synced": len(items),
        "employees_failed": processing_failures,
        "employees_skipped": len(blocked) + processing_failures,
        "total_calendar_days": sum(
            int(item.get("total_days", 0) or 0)
            for item in items
        ),
        "total_working_days": sum(
            int(item.get("working_days", 0) or 0)
            for item in items
        ),
        "total_present_days": sum(
            Decimal(str(item.get("present_days", 0) or 0))
            for item in items
        ),
        "total_paid_leave_days": sum(
            Decimal(str(item.get("paid_leave_days", 0) or 0))
            for item in items
        ),
        "total_lwp_days": sum(
            Decimal(str(item.get("lwp_days", 0) or 0))
            for item in items
        ),
        "total_absent_days": sum(
            Decimal(str(item.get("absent_days", 0) or 0))
            for item in items
        ),
    }

    totals = {
        key: json_number(value) if isinstance(value, Decimal) else value
        for key, value in totals.items()
    }

    return {
        "period_key": payroll_period.period_key,
        "month": payroll_period.month,
        "year": payroll_period.year,
        "period_start": payroll_period.start_date.isoformat(),
        "period_end": payroll_period.end_date.isoformat(),
        "persisted": bool(persist),
        "items": items,
        "eligible_employee_ids": [
            canonical_employee_id(employee) for employee in eligible_employees
        ],
        "blocked_employee_ids": sorted(blocked_by_id),
        "blocked": blocked,
        "skipped": failures,
        "failures": failures,
        "totals": totals,
        "synced_at": synced_at,
    }


def get_saved_attendance_summary(
    db: Any,
    *,
    tenant_id: str,
    employee_reference: Any,
    period: Any = None,
    month: Any = None,
    year: Any = None,
) -> dict[str, Any] | None:
    payroll_period = resolve_payroll_period(
        period,
        month=month,
        year=year,
    )
    employee = find_employee(
        db,
        tenant_id,
        employee_reference,
    )

    if not employee:
        raise PayrollAttendanceError(
            "Employee not found in the selected company.",
            status_code=404,
            code="payroll_employee_not_found",
        )

    return db[ATTENDANCE_SUMMARY_COLLECTION].find_one({
        "tenant_id": tenant_id,
        "employee_id": canonical_employee_id(employee),
        "period_key": payroll_period.period_key,
        "is_deleted": {"$ne": True},
    })