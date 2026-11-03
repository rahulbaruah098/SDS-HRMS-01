"""Read-only employee-hierarchy attachment authorization.

The caller must load BOTH employee records from the
authenticated tenant. Never pass client-supplied employee
records to this helper.
"""


def _text(value):
    return str(value).strip() if value is not None else ""


def _enabled(value):
    if isinstance(value, bool):
        return value
    return _text(value).lower() in {"true", "1", "yes", "on"}


def _actor_identifiers(employee):
    """Identifiers used by HRMS employee assignments.

    Do not authorize using names, email addresses, department,
    or client-supplied display labels.
    """
    identifiers = set()

    for key in ("_id", "employee_id", "employee_code"):
        value = _text(employee.get(key))
        if value:
            identifiers.add(value)

    return identifiers


def attachment_hierarchy_decision(
    owner_employee,
    actor_employee,
    tenant_id,
):
    """Return owner, team_leader, reporting_officer or denied.

    This checks current employee assignments only.
    HR/Admin permissions must be handled separately, using
    verified tenant authorization.
    """
    if not isinstance(owner_employee, dict):
        return "denied"

    if not isinstance(actor_employee, dict):
        return "denied"

    tenant = _text(tenant_id)

    if not tenant:
        return "denied"

    if _text(owner_employee.get("tenant_id")) != tenant:
        return "denied"

    if _text(actor_employee.get("tenant_id")) != tenant:
        return "denied"

    owner_id = _text(owner_employee.get("_id"))
    actor_id = _text(actor_employee.get("_id"))

    if not owner_id or not actor_id:
        return "denied"

    if owner_id == actor_id:
        return "owner"

    actor_ids = _actor_identifiers(actor_employee)

    team_leader_id = _text(
        owner_employee.get("team_leader_id")
    )

    reporting_officer_id = _text(
        owner_employee.get("reporting_officer_id")
    )

    if (
        team_leader_id
        and team_leader_id in actor_ids
        and _enabled(actor_employee.get("is_team_leader"))
    ):
        return "team_leader"

    if (
        reporting_officer_id
        and reporting_officer_id in actor_ids
        and _enabled(actor_employee.get("is_reporting_officer"))
    ):
        return "reporting_officer"

    return "denied"
