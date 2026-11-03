
"""Monthly team coverage business rules.

This module performs no database writes and does not grant permissions.
The route layer must validate tenant, membership and reporting hierarchy.
"""

from copy import deepcopy


class CoverageError(ValueError):
    pass


def _key(value):
    return str(value or "").strip()


def build_team_coverage(members, plans, missing_ids=None):
    members = list(members)
    plans = list(plans)
    selected = set(map(_key, missing_ids or []))

    member_ids = [_key(member.get("_id")) for member in members]
    member_set = set(member_ids)

    if not member_ids or not all(member_ids):
        raise CoverageError("A team must contain identifiable members")

    if len(member_ids) != len(member_set):
        raise CoverageError("Duplicate team member")

    if not selected.issubset(member_set):
        raise CoverageError("Missing selection contains a non-team member")

    by_employee = {}

    for plan in plans:
        employee_id = _key(plan.get("employee_id"))

        if employee_id not in member_set:
            raise CoverageError("Source plan belongs to another team")

        if employee_id in by_employee:
            raise CoverageError("Duplicate monthly plan for one member")

        by_employee[employee_id] = plan

    result = []

    for member in members:
        employee_id = _key(member["_id"])
        plan = by_employee.get(employee_id)
        status = _key(plan.get("status")).lower() if plan else ""

        if status in ("approved", "pending_approval", "rejected"):
            classification = status
        else:
            classification = "not_submitted"

        if employee_id in selected and classification != "not_submitted":
            raise CoverageError(
                "Submitted plans cannot be marked as missing"
            )

        approved = classification == "approved"

        result.append({
            "employee_id": employee_id,
            "employee_code": _key(member.get("employee_code")),
            "employee_name": _key(
                member.get("full_name")
                or member.get("name")
                or member.get("employee_name")
            ),
            "submission_status": classification,
            "missing_confirmed": (
                classification == "not_submitted"
                and employee_id in selected
            ),
            "monthly_plan_id": (
                _key(plan.get("_id"))
                if plan and classification != "not_submitted"
                else None
            ),
            "goals": deepcopy(plan.get("goals") or [])
                if approved else [],
            "sheet_rows": deepcopy(plan.get("sheet_rows") or [])
                if approved else [],
        })

    missing = [
        item["employee_id"]
        for item in result
        if item["submission_status"] == "not_submitted"
    ]

    unconfirmed = [
        employee_id
        for employee_id in missing
        if employee_id not in selected
    ]

    return {
        "members": result,
        "total_members": len(result),
        "approved_count": sum(
            item["submission_status"] == "approved"
            for item in result
        ),
        "pending_count": sum(
            item["submission_status"] == "pending_approval"
            for item in result
        ),
        "rejected_count": sum(
            item["submission_status"] == "rejected"
            for item in result
        ),
        "not_submitted_count": len(missing),
        "missing_employee_ids": missing,
        "unconfirmed_missing_ids": unconfirmed,
        "ready_to_submit": not unconfirmed,
    }


def next_distinct_approver(actor_id, ordered_supervisors):
    actor_id = _key(actor_id)

    if not actor_id:
        raise CoverageError("Submitting employee is unidentified")

    seen = {actor_id}

    for supervisor in ordered_supervisors:
        candidate = _key(supervisor)

        if not candidate or candidate in seen:
            continue

        return candidate

    raise CoverageError(
        "No distinct higher-level approver is configured"
    )


def validate_compilation_submission(coverage, approver_id, leader_id):
    if not coverage.get("members"):
        raise CoverageError("Team compilation has no members")

    if coverage.get("unconfirmed_missing_ids"):
        raise CoverageError(
            "Confirm employees who have not submitted plans"
        )

    if not _key(approver_id):
        raise CoverageError("No authorised Reporting Officer configured")

    if _key(approver_id) == _key(leader_id):
        raise CoverageError("Team Leader cannot self-approve")

    return True
