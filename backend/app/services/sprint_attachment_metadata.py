"""Sprint Planning attachment ownership and metadata.

Step 44B.53G.5: pure validation and metadata construction.
No database operations or HTTP routes.
"""

from datetime import datetime, timezone
from uuid import uuid4


class SprintAttachmentOwnershipError(ValueError):
    pass


PLAN_COLLECTIONS = {
    "monthly": "sprint_monthly_plans",
    "weekly": "sprint_weekly_plans",
    "daily": "sprint_weekly_plans",
}


def validate_upload_ownership(
    plan,
    actor_employee,
    tenant_id,
    plan_type,
    activity_id=None,
):
    """Validate ownership using server-loaded plan and employee records."""

    if plan_type not in PLAN_COLLECTIONS:
        raise SprintAttachmentOwnershipError(
            "Unsupported planning type"
        )

    if not isinstance(plan, dict):
        raise SprintAttachmentOwnershipError(
            "Planning record not found"
        )

    if not isinstance(actor_employee, dict):
        raise SprintAttachmentOwnershipError(
            "An employee profile is required"
        )

    tenant = str(tenant_id or "")
    actor_tenant = str(actor_employee.get("tenant_id") or "")
    plan_tenant = str(plan.get("tenant_id") or "")

    if not tenant or actor_tenant != tenant or plan_tenant != tenant:
        raise SprintAttachmentOwnershipError(
            "Planning record does not belong to this tenant"
        )

    employee_id = str(actor_employee.get("_id") or "")
    owner_id = str(plan.get("employee_id") or "")

    if not employee_id or employee_id != owner_id:
        raise SprintAttachmentOwnershipError(
            "Only the planning record owner may upload attachments"
        )

    if plan.get("is_deleted") is True:
        raise SprintAttachmentOwnershipError(
            "Deleted plans cannot receive attachments"
        )

    if plan_type == "daily":
        if not activity_id:
            raise SprintAttachmentOwnershipError(
                "Daily attachments require an activity ID"
            )

        activities = plan.get("activities") or []

        if not any(
            str(item.get("activity_id") or "") == str(activity_id)
            for item in activities
            if isinstance(item, dict)
        ):
            raise SprintAttachmentOwnershipError(
                "Activity does not belong to this weekly plan"
            )

        if plan.get("status") != "approved":
            raise SprintAttachmentOwnershipError(
                "Daily reports require an approved weekly plan"
            )

    elif plan_type == "weekly":
        if plan.get("status") not in (
            "draft", "pending_approval", "approved"
        ):
            raise SprintAttachmentOwnershipError(
                "Weekly plan is not eligible for attachments"
            )

    elif plan_type == "monthly":
        if plan.get("status") not in (
            "draft", "pending_approval", "approved"
        ):
            raise SprintAttachmentOwnershipError(
                "Monthly plan is not eligible for attachments"
            )

    return True


def build_sprint_attachment_metadata(
    *,
    tenant_id,
    employee_id,
    plan_id,
    plan_type,
    storage_metadata,
    activity_id=None,
    field_key=None,
    row_id=None,
):
    """Construct server-controlled attachment metadata."""

    if plan_type not in PLAN_COLLECTIONS:
        raise SprintAttachmentOwnershipError(
            "Unsupported planning type"
        )

    for name, value in (
        ("tenant_id", tenant_id),
        ("employee_id", employee_id),
        ("plan_id", plan_id),
    ):
        if not str(value or "").strip():
            raise SprintAttachmentOwnershipError(
                f"{name} is required"
            )

    if not isinstance(storage_metadata, dict):
        raise SprintAttachmentOwnershipError(
            "Invalid storage metadata"
        )

    for key in (
        "storage_id",
        "original_filename",
        "size_bytes",
    ):
        if not storage_metadata.get(key):
            raise SprintAttachmentOwnershipError(
                f"Missing storage metadata: {key}"
            )

    if str(storage_metadata.get("tenant_id")) != str(tenant_id).lower():
        raise SprintAttachmentOwnershipError(
            "Storage tenant does not match attachment tenant"
        )

    # STEP 44B.53G.8C.3 - Enforce one explicit scope.
    if plan_type == "monthly":
        if not str(row_id or "").strip() or activity_id:
            raise SprintAttachmentOwnershipError(
                "Monthly attachments require row_id only"
            )
    else:
        if not str(activity_id or "").strip() or row_id:
            raise SprintAttachmentOwnershipError(
                "Weekly/daily attachments require activity_id only"
            )

    return {
        "attachment_id": uuid4().hex,
        "tenant_id": str(tenant_id),
        "employee_id": str(employee_id),
        "plan_id": str(plan_id),
        "plan_type": plan_type,
        "activity_id": str(activity_id) if activity_id else None,
        "row_id": str(row_id) if row_id else None,
        "field_key": str(field_key) if field_key else None,
        "storage_id": storage_metadata["storage_id"],
        "original_filename": storage_metadata["original_filename"],
        "size_bytes": storage_metadata["size_bytes"],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "is_deleted": False,
    }
