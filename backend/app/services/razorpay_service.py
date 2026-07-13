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
    Builds the MongoDB payment record after successful signature verification.
    """

    payment_details = payment_details or {}
    company_id = safe_str(company.get("_id") or company.get("company_id") or company.get("tenant_id"))

    amount_paise = payment_details.get("amount") or order_doc.get("amount_paise") or 0
    amount_rupees = safe_float(amount_paise, 0.0) / 100 if amount_paise else safe_float(order_doc.get("amount"), 0.0)

    return {
        "company_id": company_id,
        "tenant_id": safe_str(company.get("tenant_id") or company_id),
        "company_name": safe_str(company.get("company_name") or company.get("name")),
        "company_email": safe_str(company.get("company_email") or company.get("email")),
        "plan_name": safe_str(current_app.config.get("SAAS_FULL_PLAN_NAME", "Full HRMS")),
        "plan_interval": safe_str(current_app.config.get("SAAS_FULL_PLAN_INTERVAL", "monthly")),
        "amount": amount_rupees,
        "amount_paise": int(amount_paise or 0),
        "currency": payment_details.get("currency") or order_doc.get("currency") or current_app.config.get("RAZORPAY_CURRENCY", "INR"),
        "razorpay_order_id": safe_str(verification_payload.get("razorpay_order_id")),
        "razorpay_payment_id": safe_str(verification_payload.get("razorpay_payment_id")),
        "razorpay_signature": safe_str(verification_payload.get("razorpay_signature")),
        "payment_status": payment_details.get("status") or "paid",
        "payment_method": payment_details.get("method"),
        "payment_details": payment_details,
        "order_doc_id": order_doc.get("_id"),
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
