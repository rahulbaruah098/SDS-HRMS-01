from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from bson import ObjectId

try:
    from bson.decimal128 import Decimal128
except Exception:  # pragma: no cover - defensive for unusual bson builds
    Decimal128 = ()  # type: ignore[assignment]


def _clean_decimal(value: Decimal) -> int | float | str:
    """Return a JSON-safe representation without unnecessary precision loss."""
    if not value.is_finite():
        return str(value)

    if value == value.to_integral_value():
        return int(value)

    return float(value)


def clean_doc(doc: Any) -> Any:
    """Recursively convert Mongo/Python values into Flask JSON-safe values.

    Payroll configuration responses can contain values originating from older
    MongoDB documents (for example BSON Decimal128). Flask's default JSON
    encoder cannot serialize those values and would otherwise turn an already
    successful save into a generic HTML 500 response.
    """
    if doc is None:
        return None

    if isinstance(doc, ObjectId):
        return str(doc)

    if isinstance(doc, (datetime, date)):
        return doc.isoformat()

    if Decimal128 and isinstance(doc, Decimal128):
        return _clean_decimal(doc.to_decimal())

    if isinstance(doc, Decimal):
        return _clean_decimal(doc)

    if isinstance(doc, dict):
        return {str(key): clean_doc(value) for key, value in doc.items()}

    if isinstance(doc, (list, tuple, set)):
        return [clean_doc(value) for value in doc]

    if isinstance(doc, bytes):
        return doc.decode("utf-8", errors="replace")

    return doc