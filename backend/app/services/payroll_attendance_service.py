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
    "reviewed",
    "finance_approved",
    "approved",
    "locked",
    "disbursed",
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

    if not state:
        return "Assam(HO)"

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
        or "Assam(HO)"
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
    manual_holidays = _manual_holiday_dates(
        db,
        tenant_id,
        employee_state(employee),
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


def assert_payroll_period_is_editable(
    db: Any,
    tenant_id: str,
    period_key: str,
) -> None:
    run = db.payroll_runs.find_one({
        "tenant_id": tenant_id,
        "period_key": period_key,
        "is_deleted": {"$ne": True},
    })

    if not run:
        return

    status = normalize_key(run.get("status"))

    if truthy(run.get("is_locked")) or status in FINALIZED_PAYROLL_STATUSES:
        raise PayrollAttendanceError(
            "Attendance cannot be synchronized because this payroll run has "
            "already entered review, approval, lock, or disbursement.",
            status_code=409,
            code="payroll_period_not_editable",
            details={
                "run_id": safe_str(run.get("_id")),
                "status": status,
                "period_key": period_key,
            },
        )


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

    assert_payroll_period_is_editable(
        db,
        tenant_id,
        payroll_period.period_key,
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

    synced_at = datetime.now(UTC)
    items: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for employee in employees:
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
            failures.append({
                "employee_id": canonical_employee_id(employee),
                "employee_code": employee_code(employee),
                "employee_name": employee_name(employee),
                "message": exc.message,
                "code": exc.code,
                "details": exc.details,
            })
        except Exception as exc:  # Preserve batch progress but report exact employee.
            failures.append({
                "employee_id": canonical_employee_id(employee),
                "employee_code": employee_code(employee),
                "employee_name": employee_name(employee),
                "message": str(exc) or "Unexpected attendance synchronization failure.",
                "code": "unexpected_attendance_sync_error",
            })

    totals = {
        "employees_requested": len(employees),
        "employees_synced": len(items),
        "employees_failed": len(failures),
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