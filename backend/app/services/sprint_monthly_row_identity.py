"""Stable server-controlled identity for monthly planning rows.

No database access. Existing plans are not migrated in place.
"""


from copy import deepcopy
from uuid import uuid4


def assign_monthly_row_ids(document, existing=None):
    """Assign IDs without trusting submitted row_id values.

    Preserve an ID only when the activity remains at the same
    position with the same activity text. Replaced or reordered
    activities receive fresh identifiers.
    """
    if not isinstance(document, dict):
        raise ValueError("Invalid monthly plan")

    rows = document.get("sheet_rows") or []

    if not isinstance(rows, list):
        raise ValueError("Invalid monthly planning rows")

    previous = (
        (existing or {}).get("sheet_rows") or []
    )

    if not isinstance(previous, list):
        previous = []

    prepared = []
    used = set()

    for index, original_row in enumerate(rows):
        if not isinstance(original_row, dict):
            raise ValueError("Invalid monthly planning row")

        row = deepcopy(original_row)

        # Client-supplied identifiers must not select an old row.
        row.pop("row_id", None)

        prior = previous[index] if index < len(previous) else None

        row_id = None

        if isinstance(prior, dict):
            same_activity = (
                str(prior.get("activity") or "").strip()
                == str(row.get("activity") or "").strip()
            )

            candidate = str(prior.get("row_id") or "")

            if (
                same_activity
                and candidate
                and candidate not in used
            ):
                row_id = candidate

        if row_id is None:
            row_id = uuid4().hex

        used.add(row_id)
        row["row_id"] = row_id
        prepared.append(row)

    document["sheet_rows"] = prepared
    return document
