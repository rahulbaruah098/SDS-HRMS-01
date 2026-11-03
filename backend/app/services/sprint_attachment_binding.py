"""Validate a saved Sprint attachment before field binding.

No database operations. Callers must supply server-loaded
records; never trust attachment metadata sent by clients.
"""


class SprintAttachmentBindingError(ValueError):
    pass


def _required(value, label):
    result = str(value).strip() if value is not None else ""
    if not result:
        raise SprintAttachmentBindingError(
            f"{label} is required"
        )
    return result


def validate_attachment_binding(
    *,
    plan,
    attachment,
    tenant_id,
    employee_id,
    plan_type,
    field_key,
    row_id=None,
    activity_id=None,
):
    """Validate an attachment's identity, ownership and field scope.

    Returns an attachment reference, not an updated plan.
    """

    if not isinstance(plan, dict):
        raise SprintAttachmentBindingError("Plan not found")

    if not isinstance(attachment, dict):
        raise SprintAttachmentBindingError("Attachment not found")

    tenant = _required(tenant_id, "Tenant")
    employee = _required(employee_id, "Employee")
    field = _required(field_key, "Field")
    plan_id = _required(plan.get("_id"), "Plan ID")

    if plan_type not in {"monthly", "weekly", "daily"}:
        raise SprintAttachmentBindingError(
            "Unsupported planning type"
        )

    for record in (plan, attachment):
        if str(record.get("tenant_id") or "") != tenant:
            raise SprintAttachmentBindingError(
                "Cross-tenant attachment binding denied"
            )

        if str(record.get("employee_id") or "") != employee:
            raise SprintAttachmentBindingError(
                "Attachment owner mismatch"
            )

        if record.get("is_deleted") is True:
            raise SprintAttachmentBindingError(
                "Deleted records cannot be bound"
            )

    if str(attachment.get("plan_id") or "") != plan_id:
        raise SprintAttachmentBindingError(
            "Attachment belongs to another plan"
        )

    if attachment.get("plan_type") != plan_type:
        raise SprintAttachmentBindingError(
            "Attachment planning type mismatch"
        )

    if attachment.get("field_key") != field:
        raise SprintAttachmentBindingError(
            "Attachment field mismatch"
        )

    if plan_type == "monthly":
        requested_row = _required(row_id, "Monthly row ID")

        if attachment.get("activity_id"):
            raise SprintAttachmentBindingError(
                "Monthly attachment has an activity scope"
            )

        if str(attachment.get("row_id") or "") != requested_row:
            raise SprintAttachmentBindingError(
                "Attachment belongs to another monthly row"
            )

        rows = plan.get("sheet_rows") or []

        if not any(
            isinstance(row, dict)
            and str(row.get("row_id") or "") == requested_row
            for row in rows
        ):
            raise SprintAttachmentBindingError(
                "Monthly row not found"
            )

    else:
        requested_activity = _required(
            activity_id, "Activity ID"
        )

        if attachment.get("row_id"):
            raise SprintAttachmentBindingError(
                "Activity attachment has a monthly row scope"
            )

        if str(attachment.get("activity_id") or "") != requested_activity:
            raise SprintAttachmentBindingError(
                "Attachment belongs to another activity"
            )

        activities = plan.get("activities") or []

        if not any(
            isinstance(activity, dict)
            and str(activity.get("activity_id") or "")
                == requested_activity
            for activity in activities
        ):
            raise SprintAttachmentBindingError(
                "Activity not found"
            )

    attachment_id = _required(
        attachment.get("attachment_id"), "Attachment ID"
    )

    from app.services.sprint_attachment_field_policy import (
        SprintAttachmentFieldError,
        validate_attachment_field,
    )

    try:
        validate_attachment_field(
            plan,
            plan_type,
            field,
            row_id=row_id if plan_type == "monthly" else None,
            activity_id=(
                activity_id if plan_type != "monthly" else None
            ),
        )
    except SprintAttachmentFieldError as error:
        raise SprintAttachmentBindingError(str(error)) from error

    return attachment_id


def attachment_reference(attachment_id):
    """Canonical text reference for an already validated attachment."""

    identifier = _required(attachment_id, "Attachment ID")

    import re
    if not re.fullmatch(r"[0-9a-f]{32}", identifier):
        raise SprintAttachmentBindingError(
            "Invalid attachment identifier"
        )

    return "sprint-attachment:" + identifier
