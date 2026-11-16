"""Sprint Planning attachment field and editing policy.

This policy validates file columns against server-loaded,
immutable template snapshots. It does not trust templates or
field definitions supplied by an upload client.
"""


class SprintAttachmentFieldError(ValueError):
    pass


def validate_attachment_field(
    plan,
    plan_type,
    field_key,
    *,
    activity_id=None,
    row_id=None,
):
    if not isinstance(plan, dict):
        raise SprintAttachmentFieldError(
            "Planning record is required"
        )

    if plan_type not in ("monthly", "weekly", "daily"):
        raise SprintAttachmentFieldError(
            "Unsupported plan type"
        )

    if not isinstance(field_key, str) or not field_key.strip():
        raise SprintAttachmentFieldError(
            "A configured file field is required"
        )

    status = str(plan.get("status") or "")

    if plan_type == "daily":
        if status != "approved":
            raise SprintAttachmentFieldError(
                "Daily reporting requires an approved weekly plan"
            )

    elif status not in ("draft", "rejected"):
        raise SprintAttachmentFieldError(
            "Submitted or approved plans cannot receive new planning files"
        )

    if plan_type == "monthly":
        template = plan.get("sprint_template_snapshot") or {}

        if row_id:
            rows = plan.get("sheet_rows") or []
            row = next(
                (
                    item for item in rows
                    if str(item.get("row_id") or "") == str(row_id)
                ),
                None,
            )

            if row is None:
                raise SprintAttachmentFieldError(
                    "Monthly row not found"
                )

    else:
        activities = plan.get("activities") or []

        activity = next(
            (
                item for item in activities
                if str(item.get("activity_id") or "") == str(activity_id)
            ),
            None,
        )

        if activity is None:
            raise SprintAttachmentFieldError(
                "Activity not found"
            )

        if plan_type == "weekly":
            template = plan.get("sprint_template_snapshot") or {}
        else:
            template = activity.get("daily_template_snapshot") or {}

    columns = template.get("columns") or []

    match = next(
        (
            column for column in columns
            if column.get("key") == field_key
        ),
        None,
    )

    if not match or match.get("type") != "file":
        raise SprintAttachmentFieldError(
            "Field is not a configured file attachment column"
        )

    return True
