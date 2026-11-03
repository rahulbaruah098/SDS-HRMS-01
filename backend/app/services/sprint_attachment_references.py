"""Validate Sprint file references against saved attachment metadata.

The caller must provide a tenant-scoped database collection and
a server-loaded planning record. No database writes are performed.
"""

import re

from app.services.sprint_attachment_binding import (
    SprintAttachmentBindingError,
    validate_attachment_binding,
)

REFERENCE_PATTERN = re.compile(
    r"^sprint-attachment:([0-9a-f]{32})$"
)


def validate_saved_file_reference(
    *,
    attachments,
    plan,
    tenant_id,
    employee_id,
    plan_type,
    field_key,
    value,
    row_id=None,
    activity_id=None,
):
    if not isinstance(value, str):
        raise SprintAttachmentBindingError(
            "File reference must be text"
        )

    match = REFERENCE_PATTERN.fullmatch(value)

    if not match:
        raise SprintAttachmentBindingError(
            "Invalid or unverified attachment reference"
        )

    if not isinstance(plan, dict) or not plan.get("_id"):
        raise SprintAttachmentBindingError(
            "Saved planning record is required"
        )

    attachment_id = match.group(1)

    # Query must use tenant and attachment ID together.
    # The binding validator checks every other scope field.
    attachment = attachments.find_one({
        "attachment_id": attachment_id,
        "tenant_id": str(tenant_id),
        "is_deleted": {"$ne": True},
    })

    if not attachment:
        raise SprintAttachmentBindingError(
            "Attachment not found in this tenant"
        )

    verified_id = validate_attachment_binding(
        plan=plan,
        attachment=attachment,
        tenant_id=tenant_id,
        employee_id=employee_id,
        plan_type=plan_type,
        field_key=field_key,
        row_id=row_id,
        activity_id=activity_id,
    )

    if verified_id != attachment_id:
        raise SprintAttachmentBindingError(
            "Attachment identifier mismatch"
        )

    return value


def validate_file_custom_values(
    *,
    attachments,
    plan,
    tenant_id,
    employee_id,
    plan_type,
    values,
    row_id=None,
    activity_id=None,
):
    """Validate file references in one row/activity's custom values.

    Other field types are passed through unchanged. Their validation
    remains the responsibility of sprint_template_values.
    """

    if not isinstance(values, dict):
        raise SprintAttachmentBindingError(
            "Custom values must be an object"
        )

    if plan_type == "monthly":
        template = plan.get("sprint_template_snapshot") or {}
    else:
        activities = plan.get("activities") or []
        activity = next(
            (
                item for item in activities
                if isinstance(item, dict)
                and str(item.get("activity_id") or "")
                    == str(activity_id or "")
            ),
            None,
        )

        if activity is None:
            raise SprintAttachmentBindingError(
                "Planning activity not found"
            )

        template = (
            plan.get("sprint_template_snapshot") or {}
            if plan_type == "weekly"
            else activity.get("daily_template_snapshot") or {}
        )

    columns = template.get("columns") or []

    file_keys = {
        col.get("key")
        for col in columns
        if isinstance(col, dict)
        and col.get("type") == "file"
    }

    result = dict(values)

    for key in file_keys:
        value = values.get(key)

        if value is None or value == "":
            continue

        result[key] = validate_saved_file_reference(
            attachments=attachments,
            plan=plan,
            tenant_id=tenant_id,
            employee_id=employee_id,
            plan_type=plan_type,
            field_key=key,
            value=value,
            row_id=row_id,
            activity_id=activity_id,
        )

    return result
