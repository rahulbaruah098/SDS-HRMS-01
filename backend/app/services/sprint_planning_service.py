
"""YourComate planning domain service (phase 1).

This module defines tenant-scoped monthly, weekly and day-wise plans, mandatory
work-report evidence, and the checkout readiness assessment. It intentionally
has no HTTP routes: role-aware endpoints and checkout integration are added
in subsequent files, after authentication and reporting relationships are wired.

All dates use ISO local-calendar strings (YYYY-MM-DD); timestamps are UTC.
Never accept tenant_id or actor_id from a client: callers must derive them
from the authenticated context and enforce reporting hierarchy permissions.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from pymongo import ASCENDING


class PlanningError(ValueError):
    """Invalid planning operation or document."""


PLAN_STATES = {"draft", "pending_approval", "approved", "rejected"}
DAY_STATES = {"planned", "in_progress", "completed", "not_completed"}
VALID_EVIDENCE_TYPES = {"document", "photo", "report", "link", "other"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def require_date(value: str, field: str) -> str:
    if not isinstance(value, str):
        raise PlanningError(f"{field} must be an ISO date (YYYY-MM-DD)")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise PlanningError(f"{field} must be an ISO date (YYYY-MM-DD)") from exc
    if parsed.isoformat() != value:
        raise PlanningError(f"{field} must be an ISO date (YYYY-MM-DD)")
    return value


def require_text(value: Any, field: str, max_length: int = 500) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PlanningError(f"{field} is required")
    normalized = value.strip()
    if len(normalized) > max_length:
        raise PlanningError(f"{field} exceeds {max_length} characters")
    return normalized


def validate_evidence(evidence: Any) -> list[dict[str, str]]:
    """Validate references only; uploads must be authorized and stored elsewhere.

    Clients must not be allowed to assert that an arbitrary private attachment
    belongs to them; the future route layer must verify ownership/access for
    evidence reference IDs before calling this service.
    """
    if not isinstance(evidence, list) or len(evidence) > 20:
        raise PlanningError("evidence must be a list with at most 20 items")
    validated = []
    for index, item in enumerate(evidence):
        if not isinstance(item, dict):
            raise PlanningError(f"evidence[{index}] must be an object")
        kind = item.get("type")
        if kind not in VALID_EVIDENCE_TYPES:
            raise PlanningError(f"evidence[{index}].type is invalid")
        reference = require_text(
            item.get("reference"),
            f"evidence[{index}].reference",
            2048
        )
        validated.append({"type": kind, "reference": reference})
    return validated


def validate_activities(
    activities: Any,
    start: str,
    end: str
) -> list[dict[str, Any]]:
    if not isinstance(activities, list) or not activities or len(activities) > 200:
        raise PlanningError("activities must contain between 1 and 200 items")
    result = []
    seen = set()
    for number, item in enumerate(activities, start=1):
        if not isinstance(item, dict):
            raise PlanningError(f"activity {number} must be an object")
        planned_date = require_date(item.get("planned_date"), "planned_date")
        if not start <= planned_date <= end:
            raise PlanningError(f"activity {number} is outside the plan period")
        activity_id = str(item.get("activity_id") or uuid4().hex)
        if activity_id in seen:
            raise PlanningError("duplicate activity_id")
        seen.add(activity_id)
        result.append({
            "activity_id": activity_id,
            "planned_date": planned_date,
            "title": require_text(item.get("title"), "title", 200),
            "description": str(item.get("description") or "").strip()[:2000],
            "expected_deliverable": str(
                item.get("expected_deliverable") or ""
            ).strip()[:500],
            "status": "planned",
            "evidence": [],
            "incomplete_reason": None,
            "employee_remarks": "",
            "updated_at": None,
        })
    return result


def ensure_indexes(db: Any) -> None:
    """Non-destructive indexes; call after database initialization.

    Non-unique indexes avoid making assumptions about historical data. Unique
    plan constraints and migration handling can be introduced separately.
    """
    db.sprint_monthly_plans.create_index(
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("month", ASCENDING)
        ]
    )
    db.sprint_weekly_plans.create_index(
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("week_start", ASCENDING)
        ]
    )
    db.sprint_daily_reports.create_index(
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("work_date", ASCENDING)
        ]
    )
    db.sprint_change_requests.create_index(
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("status", ASCENDING)
        ]
    )


def new_monthly_plan(
    *,
    tenant_id: str,
    employee_id: str,
    month: str,
    title: str,
    goals: list[str],
    actor_id: str,
    sheet_rows=None
) -> dict[str, Any]:
    """Build an unsaved draft; route must check actor authorization and duplicates."""
    tenant_id = require_text(tenant_id, "tenant_id", 120)
    employee_id = require_text(employee_id, "employee_id", 120)
    actor_id = require_text(actor_id, "actor_id", 120)
    try:
        canonical = date.fromisoformat(f"{month}-01").strftime("%Y-%m")
    except (TypeError, ValueError) as exc:
        raise PlanningError("month must be YYYY-MM") from exc
    if canonical != month:
        raise PlanningError("month must be YYYY-MM")
    if not isinstance(goals, list) or not goals or len(goals) > 100:
        raise PlanningError("goals must contain between 1 and 100 items")
    cleaned_goals = [require_text(goal, "goal", 500) for goal in goals]

    # Professional sheet rows are optional so existing plans and
    # existing weekly-planning integrations continue to work.
    cleaned_rows = []
    if sheet_rows is not None:
        if not isinstance(sheet_rows, list):
            raise PlanningError("sheet_rows must be a list")
        if len(sheet_rows) != len(cleaned_goals):
            raise PlanningError("Each monthly goal requires one sheet row")
        if len(sheet_rows) > 100:
            raise PlanningError("Too many planning rows")

        from decimal import Decimal, InvalidOperation
        from calendar import monthrange

        total_weight = Decimal("0")
        month_start = f"{month}-01"
        month_end = (
            f"{month}-"
            f"{monthrange(int(month[:4]), int(month[5:7]))[1]:02d}"
        )

        for index, row in enumerate(sheet_rows):
            if not isinstance(row, dict):
                raise PlanningError("Invalid planning row")

            def field(key, max_length=500, required=False):
                text = str(row.get(key) or "").strip()
                if len(text) > max_length:
                    raise PlanningError(f"{key} is too long")
                if required and not text:
                    raise PlanningError(f"{key} is required")
                return text

            objective = field("objective", 200, True)
            activity = field("activity", 500, True)
            deliverable = field("deliverable", 500, True)
            kpi = field("kpi", 300, True)

            if cleaned_goals[index] != activity:
                raise PlanningError(
                    "Monthly goals and sheet activities do not match"
                )

            start_date = field("start_date", 10, True)
            end_date = field("end_date", 10, True)
            try:
                from datetime import date as _date
                start_parsed = _date.fromisoformat(start_date)
                end_parsed = _date.fromisoformat(end_date)
            except ValueError as exc:
                raise PlanningError("Invalid activity date") from exc

            if (
                start_date < month_start
                or end_date > month_end
                or start_parsed > end_parsed
            ):
                raise PlanningError(
                    "Activity dates must be within the planning month"
                )

            try:
                weight = Decimal(str(row.get("weightage") or "0"))
                if not weight.is_finite() or weight < 0 or weight > 100:
                    raise ValueError()
            except (ValueError, InvalidOperation):
                raise PlanningError("Invalid activity weightage")

            total_weight += weight
            priority = field("priority", 20) or "medium"
            if priority not in ("critical", "high", "medium", "low"):
                raise PlanningError("Invalid priority")

            weeks = row.get("weeks") or []
            if not isinstance(weeks, list):
                raise PlanningError("Weekly milestones must be a list")
            weeks = list(dict.fromkeys(weeks))
            if any(week not in (1, 2, 3, 4, 5) for week in weeks):
                raise PlanningError("Invalid weekly milestone")

            cleaned_rows.append({
                "objective": objective,
                "activity": activity,
                "deliverable": deliverable,
                "kpi": kpi,
                "target_quantity": field("target_quantity", 40),
                "unit": field("unit", 60),
                "priority": priority,
                "start_date": start_date,
                "end_date": end_date,
                "responsible_employee": employee_id,
                "dependencies": field("dependencies", 500),
                "weightage": float(weight),
                "remarks": field("remarks", 500),
                "weeks": weeks,
            })

        if total_weight > 100:
            raise PlanningError(
                "Total planned weightage cannot exceed 100%"
            )

    now = utc_now()
    return {
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "month": month,
        "title": require_text(title, "title", 200),
        "goals": cleaned_goals,
        "sheet_rows": cleaned_rows,
        "sheet_version": 1 if sheet_rows is not None else 0,
        "status": "draft",
        "approval_history": [],
        "created_by": actor_id,
        "created_at": now,
        "updated_at": now,
        "is_deleted": False,
    }


def new_weekly_plan(
    *,
    tenant_id: str,
    employee_id: str,
    monthly_plan_id: str,
    week_start: str,
    week_end: str,
    activities: list[dict],
    actor_id: str
) -> dict[str, Any]:
    tenant_id = require_text(tenant_id, "tenant_id", 120)
    employee_id = require_text(employee_id, "employee_id", 120)
    actor_id = require_text(actor_id, "actor_id", 120)
    monthly_plan_id = require_text(
        monthly_plan_id, "monthly_plan_id", 120
    )
    start = require_date(week_start, "week_start")
    end = require_date(week_end, "week_end")
    if (
        end < start
        or (date.fromisoformat(end) - date.fromisoformat(start)).days > 6
    ):
        raise PlanningError(
            "weekly plan period must be between 1 and 7 days"
        )
    now = utc_now()
    return {
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "monthly_plan_id": monthly_plan_id,
        "week_start": start,
        "week_end": end,
        "activities": validate_activities(activities, start, end),
        "status": "draft",
        "approval_history": [],
        "created_by": actor_id,
        "created_at": now,
        "updated_at": now,
        "is_deleted": False,
    }


def validate_daily_update(
    *,
    status: str,
    evidence: Any = None,
    incomplete_reason: str | None = None,
    remarks: str = ""
) -> dict[str, Any]:
    """Return a validated daily report patch; never fabricate completion."""
    if status not in DAY_STATES - {"planned"}:
        raise PlanningError(
            "status must be in_progress, completed or not_completed"
        )
    validated_evidence = validate_evidence(
        evidence if evidence is not None else []
    )
    reason = (incomplete_reason or "").strip()
    if status == "completed" and not validated_evidence:
        raise PlanningError(
            "completed work requires at least one evidence reference"
        )
    if status in {"not_completed", "in_progress"} and len(reason) < 10:
        raise PlanningError(
            "unfinished or in-progress work requires a reason of at least 10 characters"
        )
    if len(reason) > 1000:
        raise PlanningError("incomplete_reason exceeds 1000 characters")
    return {
        "status": status,
        "evidence": validated_evidence,
        "incomplete_reason": (
            reason if status in {"not_completed", "in_progress"} else None
        ),
        "employee_remarks": str(remarks or "").strip()[:2000],
        "updated_at": utc_now(),
    }


def checkout_readiness(
    activities: list[dict[str, Any]]
) -> dict[str, Any]:
    """Assess reporting readiness, not whether *all* work was completed.

    This pure check is not an attendance authorization decision. The checkout
    endpoint must also enforce approved-plan/change-request policies,
    time zone, employee ownership, attendance and emergency exceptions.
    """
    problems = []

    if not isinstance(activities, list):
        raise PlanningError("activities must be a list")

    if not activities:
        return {"ready": True, "problems": []}

    for item in activities:
        activity_id = str(item.get("activity_id", ""))
        status = item.get("status", "planned")

        if status not in {"completed", "in_progress", "not_completed"}:
            problems.append({
                "activity_id": activity_id,
                "reason": "status_required",
            })

        elif status == "completed":
            # FIX 09: Reuse the same evidence validation applied when
            # daily reports are saved. A nonempty list alone is insufficient:
            # entries must have an accepted type and a nonblank reference.
            try:
                validated_evidence = validate_evidence(
                    item.get("evidence")
                )
            except PlanningError:
                validated_evidence = []

            if not validated_evidence:
                problems.append({
                    "activity_id": activity_id,
                    "reason": "evidence_required",
                })

        elif status == "not_completed" and len(
            str(item.get("incomplete_reason") or "").strip()
        ) < 10:
            problems.append({
                "activity_id": activity_id,
                "reason": "incomplete_reason_required",
            })

        elif status == "in_progress" and len(
            str(item.get("incomplete_reason") or "").strip()
        ) < 10:
            # Work that remains in progress at checkout also needs
            # an explanation.
            problems.append({
                "activity_id": activity_id,
                "reason": "incomplete_reason_required",
            })

    return {
        "ready": not problems,
        "problems": problems,
    }
