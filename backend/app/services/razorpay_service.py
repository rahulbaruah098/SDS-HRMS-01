import hashlib
import hmac
import uuid
from datetime import datetime, timezone

import requests
from flask import current_app


RAZORPAY_API_BASE_URL = "https://api.razorpay.com/v1"


class RazorpayServiceError(RuntimeError):
    def __init__(self, message, status_code=400, details=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details or {}


def now_utc():
    return datetime.now(timezone.utc)


def safe_str(value):
    return str(value or "").strip()


def safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def amount_to_paise(amount):
    """
    Razorpay expects amount in the smallest currency unit.
    For INR, that means paise.
    """

    amount = safe_float(amount, 0.0)

    if amount <= 0:
        raise RazorpayServiceError("Invalid payment amount.", 400)

    return int(round(amount * 100))


def get_razorpay_credentials():
    key_id = safe_str(current_app.config.get("RAZORPAY_KEY_ID"))
    key_secret = safe_str(current_app.config.get("RAZORPAY_KEY_SECRET"))

    if not key_id or not key_secret:
        raise RazorpayServiceError(
            "Razorpay is not configured. Please add Razorpay keys in backend .env.",
            500,
        )

    return key_id, key_secret


def get_public_checkout_config():
    """
    Safe config that can be sent to frontend.
    Never expose RAZORPAY_KEY_SECRET.
    """

    return {
        "key_id": safe_str(current_app.config.get("RAZORPAY_KEY_ID")),
        "currency": safe_str(current_app.config.get("RAZORPAY_CURRENCY", "INR")) or "INR",
        "plan_name": safe_str(current_app.config.get("SAAS_FULL_PLAN_NAME", "Full HRMS")) or "Full HRMS",
        "plan_amount": safe_float(current_app.config.get("SAAS_FULL_PLAN_AMOUNT", 4999.0), 4999.0),
        "plan_interval": safe_str(current_app.config.get("SAAS_FULL_PLAN_INTERVAL", "monthly")) or "monthly",
    }


def build_order_receipt(company_id, prefix="yc_hrms"):
    company_part = safe_str(company_id).replace(" ", "_")[:20] or "company"
    unique_part = uuid.uuid4().hex[:10]
    return f"{prefix}_{company_part}_{unique_part}"[:40]


def compact_reference_part(value, fallback="item", max_length=12):
    """Returns a compact uppercase token safe for invoice/receipt references."""

    cleaned = "".join(
        character
        for character in safe_str(value).upper()
        if character.isalnum()
    )

    if not cleaned:
        cleaned = safe_str(fallback).upper() or "ITEM"

    return cleaned[-max_length:]


def payment_datetime(payment_details=None):
    """Resolves Razorpay's Unix timestamp to an aware UTC datetime."""

    payment_details = payment_details or {}
    created_at = payment_details.get("created_at")

    try:
        if created_at not in [None, ""]:
            return datetime.fromtimestamp(float(created_at), tz=timezone.utc)
    except (TypeError, ValueError, OSError, OverflowError):
        pass

    return now_utc()


def build_invoice_number(company, payment_id, paid_at=None):
    """Builds a stable invoice number from tenant, date and Razorpay payment ID."""

    paid_at = paid_at or now_utc()
    tenant_part = compact_reference_part(
        (company or {}).get("tenant_code")
        or (company or {}).get("tenant_id")
        or (company or {}).get("_id"),
        fallback="CLIENT",
        max_length=8,
    )
    payment_part = compact_reference_part(
        payment_id,
        fallback=uuid.uuid4().hex,
        max_length=10,
    )

    return f"YC-INV-{paid_at:%Y%m%d}-{tenant_part}-{payment_part}"


def build_receipt_number(payment_id, paid_at=None):
    """Builds a client-facing payment receipt reference."""

    paid_at = paid_at or now_utc()
    payment_part = compact_reference_part(
        payment_id,
        fallback=uuid.uuid4().hex,
        max_length=12,
    )

    return f"YC-RCT-{paid_at:%Y%m%d}-{payment_part}"


def create_razorpay_order(company, amount=None, notes=None):
    """
    Creates a Razorpay order for a company subscription upgrade.

    Returns Razorpay order data with public checkout fields.
    """

    key_id, key_secret = get_razorpay_credentials()

    if not company:
        raise RazorpayServiceError("Company not found for payment order.", 404)

    company_id = safe_str(company.get("_id") or company.get("company_id") or company.get("tenant_id"))
    company_name = safe_str(company.get("company_name") or company.get("name"))
    company_email = safe_str(company.get("company_email") or company.get("email"))

    if not company_id:
        raise RazorpayServiceError("Company ID is required for payment order.", 400)

    amount = safe_float(
        amount if amount is not None else current_app.config.get("SAAS_FULL_PLAN_AMOUNT", 4999.0),
        4999.0,
    )
    currency = safe_str(current_app.config.get("RAZORPAY_CURRENCY", "INR")) or "INR"
    amount_paise = amount_to_paise(amount)

    payload = {
        "amount": amount_paise,
        "currency": currency,
        "receipt": build_order_receipt(company_id),
        "payment_capture": 1,
        "notes": {
            "company_id": company_id,
            "company_name": company_name,
            "company_email": company_email,
            "plan_name": safe_str(current_app.config.get("SAAS_FULL_PLAN_NAME", "Full HRMS")),
            **(notes or {}),
        },
    }

    try:
        response = requests.post(
            f"{RAZORPAY_API_BASE_URL}/orders",
            auth=(key_id, key_secret),
            json=payload,
            timeout=20,
        )
    except requests.RequestException as exc:
        raise RazorpayServiceError(
            "Unable to connect to Razorpay. Please try again.",
            502,
            {"error": str(exc)},
        ) from exc

    try:
        response_data = response.json()
    except ValueError:
        response_data = {"raw_response": response.text}

    if response.status_code >= 400:
        raise RazorpayServiceError(
            "Razorpay order creation failed.",
            response.status_code,
            response_data,
        )

    return {
        "razorpay_order": response_data,
        "checkout": {
            "key_id": key_id,
            "amount": amount_paise,
            "amount_rupees": amount,
            "currency": currency,
            "name": "YourComate HRMS",
            "description": safe_str(current_app.config.get("SAAS_FULL_PLAN_NAME", "Full HRMS")),
            "order_id": response_data.get("id"),
            "prefill": {
                "name": company_name,
                "email": company_email,
                "contact": safe_str(company.get("company_phone") or company.get("phone")),
            },
            "notes": payload["notes"],
        },
    }


def verify_payment_signature(order_id, payment_id, signature):
    """
    Verifies Razorpay checkout payment signature.
    Formula from Razorpay docs:
    HMAC_SHA256(order_id + "|" + payment_id, key_secret)
    """

    _, key_secret = get_razorpay_credentials()

    order_id = safe_str(order_id)
    payment_id = safe_str(payment_id)
    signature = safe_str(signature)

    if not order_id or not payment_id or not signature:
        return False

    message = f"{order_id}|{payment_id}".encode("utf-8")
    expected_signature = hmac.new(
        key_secret.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected_signature, signature)


def verify_webhook_signature(raw_body, signature):
    """
    Verifies Razorpay webhook signature.
    raw_body must be the exact request body bytes.
    """

    webhook_secret = safe_str(current_app.config.get("RAZORPAY_WEBHOOK_SECRET"))

    if not webhook_secret:
        raise RazorpayServiceError(
            "Razorpay webhook secret is not configured.",
            500,
        )

    signature = safe_str(signature)

    if not signature:
        return False

    if isinstance(raw_body, str):
        raw_body = raw_body.encode("utf-8")

    expected_signature = hmac.new(
        webhook_secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected_signature, signature)


def fetch_payment(payment_id):
    """
    Fetches payment details from Razorpay for additional verification/storage.
    """

    key_id, key_secret = get_razorpay_credentials()
    payment_id = safe_str(payment_id)

    if not payment_id:
        raise RazorpayServiceError("Razorpay payment ID is required.", 400)

    try:
        response = requests.get(
            f"{RAZORPAY_API_BASE_URL}/payments/{payment_id}",
            auth=(key_id, key_secret),
            timeout=20,
        )
    except requests.RequestException as exc:
        raise RazorpayServiceError(
            "Unable to fetch Razorpay payment details.",
            502,
            {"error": str(exc)},
        ) from exc

    try:
        response_data = response.json()
    except ValueError:
        response_data = {"raw_response": response.text}

    if response.status_code >= 400:
        raise RazorpayServiceError(
            "Unable to fetch Razorpay payment details.",
            response.status_code,
            response_data,
        )

    return response_data


def build_payment_record(company, order_doc, verification_payload, payment_details=None):
    """
    Builds the MongoDB payment/invoice record after successful signature
    verification. Plan and quotation values come from the server-created order
    snapshot rather than browser input.
    """

    payment_details = payment_details or {}
    order_doc = order_doc or {}
    verification_payload = verification_payload or {}

    company_id = safe_str(
        (company or {}).get("_id")
        or (company or {}).get("company_id")
        or (company or {}).get("tenant_id")
    )
    tenant_id = safe_str((company or {}).get("tenant_id") or company_id)

    razorpay_order_id = safe_str(verification_payload.get("razorpay_order_id"))
    razorpay_payment_id = safe_str(verification_payload.get("razorpay_payment_id"))
    razorpay_signature = safe_str(verification_payload.get("razorpay_signature"))

    amount_paise = payment_details.get("amount") or order_doc.get("amount_paise") or 0
    amount_rupees = (
        safe_float(amount_paise, 0.0) / 100
        if amount_paise
        else safe_float(order_doc.get("amount"), 0.0)
    )

    paid_at = payment_datetime(payment_details)
    invoice_number = build_invoice_number(
        company,
        razorpay_payment_id,
        paid_at=paid_at,
    )
    receipt_number = build_receipt_number(
        razorpay_payment_id,
        paid_at=paid_at,
    )

    razorpay_order = order_doc.get("razorpay_order") or {}
    plan_code = safe_str(order_doc.get("plan_code")) or safe_str(
        current_app.config.get("SAAS_DEFAULT_PAID_PLAN_CODE", "growth")
    )
    plan_name = (
        safe_str(order_doc.get("plan_name"))
        or safe_str(current_app.config.get("SAAS_FULL_PLAN_NAME", "Full HRMS"))
        or "Full HRMS"
    )
    plan_label = safe_str(order_doc.get("plan_label")) or plan_name
    plan_interval = (
        safe_str(order_doc.get("plan_interval"))
        or safe_str(order_doc.get("billing_interval"))
        or safe_str(current_app.config.get("SAAS_FULL_PLAN_INTERVAL", "monthly"))
        or "monthly"
    )

    payment_status = safe_str(payment_details.get("status")) or "paid"
    currency = (
        safe_str(payment_details.get("currency"))
        or safe_str(order_doc.get("currency"))
        or safe_str(current_app.config.get("RAZORPAY_CURRENCY", "INR"))
        or "INR"
    )

    return {
        "company_id": company_id,
        "tenant_id": tenant_id,
        "company_name": safe_str(
            (company or {}).get("company_name")
            or (company or {}).get("name")
        ),
        "company_email": safe_str(
            (company or {}).get("company_email")
            or (company or {}).get("contact_email")
            or (company or {}).get("email")
        ),
        "plan_code": plan_code,
        "plan_name": plan_name,
        "plan_label": plan_label,
        "plan_interval": plan_interval,
        "billing_interval": (
            safe_str(order_doc.get("billing_interval"))
            or plan_interval
        ),
        "employee_limit": order_doc.get("employee_limit"),
        "is_unlimited_employees": bool(order_doc.get("is_unlimited_employees")),
        "premium_request_id": order_doc.get("premium_request_id"),
        "request_reference": order_doc.get("request_reference"),
        "quotation_reference": order_doc.get("quotation_reference"),
        "payment_source": order_doc.get("payment_source") or "dynamic_plan_price",
        "renewal_price_source": order_doc.get("renewal_price_source") or (
            "custom_quote" if plan_code == "premium" else "dynamic_plan_price"
        ),
        "renewal_amount": safe_float(
            order_doc.get("amount") or amount_rupees,
            amount_rupees,
        ),
        "amount": amount_rupees,
        "amount_paise": int(amount_paise or 0),
        "currency": currency,
        "razorpay_order_id": razorpay_order_id,
        "razorpay_payment_id": razorpay_payment_id,
        "razorpay_signature": razorpay_signature,
        "razorpay_order_receipt": (
            razorpay_order.get("receipt")
            or order_doc.get("receipt")
        ),
        "payment_status": payment_status,
        "payment_method": payment_details.get("method"),
        "payment_details": payment_details,
        "order_doc_id": order_doc.get("_id"),
        "invoice_number": invoice_number,
        "invoice_status": "paid",
        "invoice_date": paid_at,
        "receipt_number": receipt_number,
        "paid_at": paid_at,
        "created_at": paid_at,
        "updated_at": now_utc(),
    }
