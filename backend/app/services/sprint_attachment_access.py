"""Tenant-scoped Sprint attachment access decisions.

Step 44B.53G.3. This module only makes authorization
decisions. HTTP authentication and database lookup must be
performed by the eventual upload/download routes.
"""


def can_access_sprint_attachment(
    attachment,
    actor_employee,
    tenant_id,
    roles=(),
):
    """Return whether an actor may access an existing attachment.

    The caller must supply employee relationships from verified,
    tenant-scoped database records. Client-provided relationships
    must never be trusted.
    """

    if not isinstance(attachment, dict):
        return False

    if not isinstance(tenant_id, str) or not tenant_id:
        return False

    if str(attachment.get("tenant_id") or "") != tenant_id:
        return False

    if attachment.get("is_deleted") is True:
        return False

    normalized_roles = {
        str(role).strip().lower().replace("-", "_")
        for role in (roles or ())
    }

    # STEP 44B.53G.7E
    # Verify actor tenant membership BEFORE privileged roles.
    if not isinstance(actor_employee, dict):
        return False

    if str(actor_employee.get("tenant_id") or "") != tenant_id:
        return False

    if not str(actor_employee.get("_id") or ""):
        return False

    if normalized_roles & {
        "super_admin", "admin", "hr", "hr_manager"
    }:
        return True

    actor_id = str(actor_employee.get("_id") or "")
    owner_id = str(attachment.get("employee_id") or "")

    if not actor_id or not owner_id:
        return False

    if actor_id == owner_id:
        return True

    allowed_reviewers = {
        str(attachment.get("team_leader_employee_id") or ""),
        str(attachment.get("reporting_officer_employee_id") or ""),
    }

    allowed_reviewers.discard("")

    return actor_id in allowed_reviewers


def validate_sprint_attachment_scope(
    attachment,
    tenant_id,
    plan_type,
    plan_id,
):
    """Ensure a file belongs to the requested plan context."""

    if not isinstance(attachment, dict):
        return False

    if str(attachment.get("tenant_id") or "") != str(tenant_id):
        return False

    if str(attachment.get("plan_type") or "") != str(plan_type):
        return False

    if str(attachment.get("plan_id") or "") != str(plan_id):
        return False

    return attachment.get("is_deleted") is not True
