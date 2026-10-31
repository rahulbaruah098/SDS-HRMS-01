"""Validate department-specific Sprint Planning row values.

Template definitions control accepted fields. Historical plans retain
the template snapshot they were created with.
"""

from datetime import date
from decimal import Decimal, InvalidOperation
from copy import deepcopy

from app.services.sprint_template_service import (
    SprintTemplateError,
    normalise_columns,
)

MAX_TEXT_LENGTH = 500
MAX_TEXTAREA_LENGTH = 5000
MAX_FILE_REFERENCE_LENGTH = 1000


def _value_is_missing(value):
    return value is None or value == ""


def validate_template_values(columns, values):
    """Return validated values or reject unknown/invalid fields."""
    definitions = normalise_columns(columns)

    if not isinstance(values, dict):
        raise SprintTemplateError(
            "Custom field values must be an object"
        )

    allowed = {column["key"] for column in definitions}
    unknown = set(values) - allowed

    if unknown:
        raise SprintTemplateError(
            "Unknown planning columns: " +
            ", ".join(sorted(str(key) for key in unknown))
        )

    validated = {}

    for column in definitions:
        key = column["key"]
        label = column["label"]
        field_type = column["type"]
        value = values.get(key)

        if _value_is_missing(value):
            if column["required"]:
                raise SprintTemplateError(
                    f"{label} is required"
                )
            validated[key] = None
            continue

        if field_type in ("text", "textarea", "file"):
            if not isinstance(value, str):
                raise SprintTemplateError(
                    f"{label} must be text"
                )

            value = value.strip()
            maximum = (
                MAX_TEXTAREA_LENGTH
                if field_type == "textarea"
                else MAX_FILE_REFERENCE_LENGTH
                if field_type == "file"
                else MAX_TEXT_LENGTH
            )

            if len(value) > maximum:
                raise SprintTemplateError(
                    f"{label} exceeds {maximum} characters"
                )

            if column["required"] and not value:
                raise SprintTemplateError(
                    f"{label} is required"
                )

            validated[key] = value or None

        elif field_type == "number":
            if isinstance(value, bool):
                raise SprintTemplateError(
                    f"{label} must be a number"
                )

            try:
                number = Decimal(str(value))
            except (InvalidOperation, ValueError):
                raise SprintTemplateError(
                    f"{label} must be a valid number"
                )

            if not number.is_finite():
                raise SprintTemplateError(
                    f"{label} must be a finite number"
                )

            validated[key] = str(number)

        elif field_type == "date":
            if not isinstance(value, str):
                raise SprintTemplateError(
                    f"{label} must be a YYYY-MM-DD date"
                )

            try:
                parsed = date.fromisoformat(value)
            except ValueError:
                raise SprintTemplateError(
                    f"{label} must be a valid date"
                )

            if parsed.isoformat() != value:
                raise SprintTemplateError(
                    f"{label} must use YYYY-MM-DD"
                )

            validated[key] = value

        elif field_type == "select":
            if not isinstance(value, str):
                raise SprintTemplateError(
                    f"{label} must be a dropdown option"
                )

            if value not in column["options"]:
                raise SprintTemplateError(
                    f"{label} contains an invalid option"
                )

            validated[key] = value

        elif field_type == "checkbox":
            if type(value) is not bool:
                raise SprintTemplateError(
                    f"{label} must be true or false"
                )

            validated[key] = value

        else:
            raise SprintTemplateError(
                f"Unsupported field type: {field_type}"
            )

    return validated


def snapshot_template(template):
    """Freeze the template definition for historical plan rendering."""
    if not isinstance(template, dict):
        raise SprintTemplateError(
            "A valid template is required"
        )

    version = template.get("version")
    if type(version) is not int or version < 1:
        raise SprintTemplateError(
            "A positive template version is required"
        )

    return {
        "template_id": str(template.get("template_id") or template.get("_id") or template.get("id") or ""),
        "department": str(template.get("department") or "").strip(),
        "plan_type": str(template.get("plan_type") or "").strip(),
        "version": version,
        "columns": deepcopy(
            normalise_columns(template.get("columns"))
        ),
    }
