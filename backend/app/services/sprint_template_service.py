"""Versioned department-specific Sprint Planning sheet definitions.

This service validates configuration; persistence and access controls are
implemented by the Sprint Planning routes.
"""

import re

FIELD_TYPES = frozenset({
    "text", "textarea", "number", "date",
    "select", "checkbox", "file",
})
PLAN_TYPES = frozenset({"monthly", "weekly", "daily"})
MAX_COLUMNS = 40
MAX_OPTIONS = 40


class SprintTemplateError(ValueError):
    pass


def normalise_columns(columns):
    if not isinstance(columns, list):
        raise SprintTemplateError("Columns must be an array")
    if not 1 <= len(columns) <= MAX_COLUMNS:
        raise SprintTemplateError(
            "A planning sheet requires between 1 and 40 columns"
        )

    result = []
    used_keys = set()

    for position, item in enumerate(columns):
        if not isinstance(item, dict):
            raise SprintTemplateError(
                "Each column must be an object"
            )

        key = str(item.get("key") or "").strip().lower()
        label = str(item.get("label") or "").strip()
        field_type = str(
            item.get("type") or "text"
        ).strip().lower()
        required = item.get("required", False)

        if not re.fullmatch(r"[a-z][a-z0-9_]{1,49}", key):
            raise SprintTemplateError(
                "Column keys must contain 2-50 lowercase "
                "letters, numbers or underscores, starting "
                "with a letter"
            )

        if key in used_keys:
            raise SprintTemplateError(
                f"Duplicate column key: {key}"
            )

        if not label or len(label) > 100:
            raise SprintTemplateError(
                "Column label must contain 1-100 characters"
            )

        if field_type not in FIELD_TYPES:
            raise SprintTemplateError(
                f"Unsupported field type: {field_type}"
            )

        if type(required) is not bool:
            raise SprintTemplateError(
                "Column required must be true or false"
            )

        options = item.get("options", [])

        if field_type == "select":
            if not isinstance(options, list):
                raise SprintTemplateError(
                    "Dropdown options must be an array"
                )
            if not 1 <= len(options) <= MAX_OPTIONS:
                raise SprintTemplateError(
                    "Dropdown requires 1-40 options"
                )

            cleaned_options = [
                str(value).strip()
                for value in options
            ]

            if (
                any(not value or len(value) > 100
                    for value in cleaned_options)
                or len(set(cleaned_options)) != len(cleaned_options)
            ):
                raise SprintTemplateError(
                    "Dropdown options must be unique, nonempty "
                    "and no longer than 100 characters"
                )
        else:
            if options not in ([], None):
                raise SprintTemplateError(
                    "Only dropdown columns accept options"
                )
            cleaned_options = []

        used_keys.add(key)

        result.append({
            "key": key,
            "label": label,
            "type": field_type,
            "required": required,
            "options": cleaned_options,
            "position": position,
        })

    return result


def normalise_plan_type(value):
    result = str(value or "").strip().lower()
    if result not in PLAN_TYPES:
        raise SprintTemplateError(
            "Plan type must be monthly, weekly or daily"
        )
    return result


def normalise_department(value):
    result = str(value or "").strip()
    if not result or len(result) > 100:
        raise SprintTemplateError(
            "A valid department is required"
        )
    return result


def template_identity(tenant_id, department, plan_type):
    tenant = str(tenant_id or "").strip()
    if not tenant:
        raise SprintTemplateError(
            "Organisation context is required"
        )

    return {
        "tenant_id": tenant,
        "department": normalise_department(department),
        "plan_type": normalise_plan_type(plan_type),
    }


def create_template_version(
    tenant_id, department, plan_type,
    columns, version, actor_id,
):
    identity = template_identity(
        tenant_id, department, plan_type
    )

    if type(version) is not int or version < 1:
        raise SprintTemplateError(
            "Template version must be a positive integer"
        )

    return {
        **identity,
        "version": version,
        "columns": normalise_columns(columns),
        "created_by": str(actor_id or ""),
        "is_deleted": False,
    }
