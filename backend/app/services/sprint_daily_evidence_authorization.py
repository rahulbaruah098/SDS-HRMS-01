"""Ownership validation for Sprint Planning daily evidence.

Validates internal attachment references using server-saved metadata.
Does not perform database writes.
"""

import re


class SprintDailyEvidenceAuthorizationError(ValueError):
    """An internal daily evidence attachment is not authorized."""


_INTERNAL_PREFIX = "sprint-attachment:"
_INTERNAL_REFERENCE = re.compile(
    r"^sprint-attachment:([0-9a-f]{32})$"
)


def validate_daily_evidence_ownership(
    *,
    attachments,
    evidence,
    tenant_id,
    employee_id,
    plan_id,
    activity_id,
):
    """Verify ownership and scope of internal daily evidence attachments."""

    if not isinstance(evidence, list):
        raise SprintDailyEvidenceAuthorizationError(
            "Evidence must be a list"
        )

    tenant = str(tenant_id or "").strip()
    employee = str(employee_id or "").strip()
    plan = str(plan_id or "").strip()
    activity = str(activity_id or "").strip()

    if not all((tenant, employee, plan, activity)):
        raise SprintDailyEvidenceAuthorizationError(
            "Daily evidence ownership context is incomplete"
        )

    for item in evidence:
        if not isinstance(item, dict):
            raise SprintDailyEvidenceAuthorizationError(
                "Invalid evidence entry"
            )

        reference = item.get("reference")

        if not isinstance(reference, str):
            raise SprintDailyEvidenceAuthorizationError(
                "Evidence reference must be text"
            )

        reference = reference.strip()

        # External links and ordinary references retain existing behavior.
        if not reference.lower().startswith(_INTERNAL_PREFIX):
            continue

        match = _INTERNAL_REFERENCE.fullmatch(reference)

        if not match:
            raise SprintDailyEvidenceAuthorizationError(
                "Invalid internal Sprint attachment reference"
            )

        attachment_id = match.group(1)

        saved = attachments.find_one({
            "attachment_id": attachment_id,
            "tenant_id": tenant,
            "is_deleted": {"$ne": True},
        })

        if not isinstance(saved, dict):
            raise SprintDailyEvidenceAuthorizationError(
                "Internal evidence attachment not found"
            )

        if saved.get("is_deleted") is True:
            raise SprintDailyEvidenceAuthorizationError(
                "Deleted evidence attachment cannot be used"
            )

        if str(saved.get("tenant_id") or "") != tenant:
            raise SprintDailyEvidenceAuthorizationError(
                "Evidence tenant mismatch"
            )

        if str(saved.get("employee_id") or "") != employee:
            raise SprintDailyEvidenceAuthorizationError(
                "Evidence owner mismatch"
            )

        if str(saved.get("plan_id") or "") != plan:
            raise SprintDailyEvidenceAuthorizationError(
                "Evidence belongs to another plan"
            )

        if str(saved.get("activity_id") or "") != activity:
            raise SprintDailyEvidenceAuthorizationError(
                "Evidence belongs to another activity"
            )

        if saved.get("plan_type") != "daily":
            raise SprintDailyEvidenceAuthorizationError(
                "Evidence is not a daily reporting attachment"
            )

        if saved.get("row_id"):
            raise SprintDailyEvidenceAuthorizationError(
                "Evidence has an invalid monthly row scope"
            )

        if not str(saved.get("field_key") or "").strip():
            raise SprintDailyEvidenceAuthorizationError(
                "Evidence attachment field is missing"
            )

    return evidence
