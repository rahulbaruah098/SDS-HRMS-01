"""
YourComate HRMS SaaS Smoke Check

Usage from backend folder:

    python scripts/saas_smoke_check.py

JSON output:

    python scripts/saas_smoke_check.py --json

What this script checks:
- Flask app can start.
- Required SaaS configuration values are loaded.
- SMTP and Razorpay placeholders are detected.
- 19 required SaaS route contracts are registered with the correct methods.
- Premium quotation payment is gated by a released client-visible quotation.
- Premium renewal uses price_source=custom_quote.
- Essential/Growth renewal uses price_source=dynamic_plan_price.
- Client billing summary exposes subscription validity, alerts and invoices.
- Client and Superadmin invoice download routes are integrated.
- Save Draft stays internal until Send Quotation is explicitly requested.
- Client Billing, Premium Requests and Superadmin Subscriptions pages contain
  the required alert, validity, invoice and action-visibility integrations.
- create_saas_indexes.py defines exactly 28 required indexes.
- premium_plan_requests defines and exposes all 5 required indexes.
- MongoDB, SDS lifetime tenant, pricing plans and live SaaS indexes are reachable.

This script is read-only. It does not create, update or delete records.
"""

import argparse
import inspect
import json
import os
import runpy
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]
PROJECT_DIR = BACKEND_DIR.parent

BACKEND_BILLING_ROUTE_FILE = BACKEND_DIR / "app" / "routes" / "billing.py"
INDEX_SCRIPT_FILE = BACKEND_DIR / "scripts" / "create_saas_indexes.py"
FRONTEND_BILLING_FILE = PROJECT_DIR / "frontend" / "src" / "pages" / "Billing.jsx"
FRONTEND_PREMIUM_REQUESTS_FILE = (
    PROJECT_DIR / "frontend" / "src" / "pages" / "PremiumRequests.jsx"
)
FRONTEND_SUBSCRIPTIONS_FILE = (
    PROJECT_DIR / "frontend" / "src" / "pages" / "Subscriptions.jsx"
)

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


REQUIRED_ROUTE_CONTRACTS = [
    {"route": "/api/v1/demo-requests/apply", "methods": {"POST"}},
    {"route": "/api/v1/demo-requests/verify-otp", "methods": {"POST"}},
    {"route": "/api/v1/demo-requests/resend-otp", "methods": {"POST"}},
    {"route": "/api/v1/demo-requests/status", "methods": {"GET"}},
    {"route": "/api/v1/demo-requests/admin/requests", "methods": {"GET"}},
    {"route": "/api/v1/billing/pricing", "methods": {"GET"}},
    {"route": "/api/v1/billing/summary", "methods": {"GET"}},
    {"route": "/api/v1/billing/invoices", "methods": {"GET"}},
    {
        "route": "/api/v1/billing/invoices/<payment_id>/download",
        "methods": {"GET"},
    },
    {"route": "/api/v1/billing/create-order", "methods": {"POST"}},
    {"route": "/api/v1/billing/verify-payment", "methods": {"POST"}},
    {"route": "/api/v1/billing/premium-request", "methods": {"POST"}},
    {
        "route": "/api/v1/billing/admin/premium-requests",
        "methods": {"GET"},
    },
    {
        "route": "/api/v1/billing/admin/premium-requests/<request_id>",
        "methods": {"PATCH", "PUT"},
    },
    {
        "route": "/api/v1/billing/admin/pricing-plans",
        "methods": {"GET"},
    },
    {
        "route": "/api/v1/billing/admin/subscriptions",
        "methods": {"GET"},
    },
    {"route": "/api/v1/billing/admin/payments", "methods": {"GET"}},
    {"route": "/api/v1/billing/admin/orders", "methods": {"GET"}},
    {
        "route": "/api/v1/billing/admin/refresh-expired-demos",
        "methods": {"POST"},
    },
]

REQUIRED_CONFIG_KEYS = [
    "SAAS_ENABLED",
    "SDS_TENANT_ID",
    "SDS_TENANT_CODE",
    "SDS_COMPANY_NAME",
    "SDS_HAS_LIFETIME_ACCESS",
    "YOURCOMATE_DOMAIN",
    "AUTO_ADMIN_EMAIL_DOMAIN",
    "DEMO_DURATION_DAYS",
    "DEMO_HAS_FULL_ACCESS",
    "DEMO_EMPLOYEE_LIMIT",
    "DEMO_ALLOWED_MODULES",
    "DEMO_OTP_LENGTH",
    "DEMO_OTP_EXPIRY_MINUTES",
    "MAIL_SERVER",
    "MAIL_PORT",
    "MAIL_USERNAME",
    "MAIL_PASSWORD",
    "MAIL_DEFAULT_SENDER",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_CURRENCY",
    "SAAS_FULL_PLAN_AMOUNT",
    "SAAS_FULL_PLAN_INTERVAL",
    "SAAS_ESSENTIAL_PLAN_AMOUNT",
    "SAAS_ESSENTIAL_EMPLOYEE_LIMIT",
    "SAAS_GROWTH_PLAN_AMOUNT",
    "SAAS_GROWTH_EMPLOYEE_LIMIT",
    "SAAS_PREMIUM_PLAN_AMOUNT",
    "SAAS_PREMIUM_EMPLOYEE_LIMIT",
    "SAAS_PREMIUM_IS_CUSTOM",
    "SAAS_DEFAULT_PAID_PLAN_CODE",
    "FRONTEND_BASE_URL",
    "BILLING_PAGE_PATH",
]

SAAS_COLLECTIONS = [
    "tenants",
    "demo_requests",
    "pricing_plans",
    "subscriptions",
    "payments",
    "payment_orders",
    "premium_plan_requests",
    "trial_notifications",
    "notifications",
    "users",
    "employees",
]

EXPECTED_INDEX_COUNT = 28
EXPECTED_PREMIUM_INDEX_COUNT = 5

PREMIUM_REQUEST_INDEXES = {
    "premium_requests_tenant_created",
    "premium_requests_status_created",
    "premium_requests_reference_unique",
    "premium_requests_requester_email",
    "premium_requests_company_search",
}


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def now_utc():
    return datetime.now(timezone.utc)


def serialize_for_json(value):
    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, list):
        return [serialize_for_json(item) for item in value]

    if isinstance(value, tuple):
        return [serialize_for_json(item) for item in value]

    if isinstance(value, set):
        return sorted(serialize_for_json(item) for item in value)

    if isinstance(value, dict):
        return {
            str(key): serialize_for_json(item)
            for key, item in value.items()
        }

    try:
        from bson import ObjectId

        if isinstance(value, ObjectId):
            return str(value)
    except Exception:
        pass

    return value


def safe_str(value):
    if value is None:
        return ""

    return str(value).strip()


def read_text(path):
    return Path(path).read_text(encoding="utf-8")


def is_placeholder(value):
    text = safe_str(value).lower()

    return (
        not text
        or text.startswith("your_")
        or "your_" in text
        or text in {"changeme", "change_me", "replace_me", "todo"}
    )


def is_config_key_valid(key, value):
    """
    Some final SaaS config values are intentionally zero:
    - DEMO_EMPLOYEE_LIMIT=0 means unlimited during trial.
    - SAAS_PREMIUM_PLAN_AMOUNT=0 means custom quote.
    - SAAS_PREMIUM_EMPLOYEE_LIMIT=0 means unlimited/custom.
    """

    zero_allowed_keys = {
        "DEMO_EMPLOYEE_LIMIT",
        "SAAS_PREMIUM_PLAN_AMOUNT",
        "SAAS_PREMIUM_EMPLOYEE_LIMIT",
    }

    if key in zero_allowed_keys and safe_str(value) == "0":
        return True

    return value is not None and not is_placeholder(value)


def make_contract_check(name, ok, detail, expected=""):
    return {
        "name": name,
        "ok": bool(ok),
        "detail": detail,
        "expected": expected,
    }


# ---------------------------------------------------------------------------
# Flask route checks
# ---------------------------------------------------------------------------


def route_methods(app, route_path):
    methods = set()

    for rule in app.url_map.iter_rules():
        if str(rule.rule) != route_path:
            continue

        methods.update(
            method
            for method in rule.methods
            if method not in {"HEAD", "OPTIONS"}
        )

    return methods


def check_routes(app):
    details = []

    for contract in REQUIRED_ROUTE_CONTRACTS:
        route_path = contract["route"]
        expected_methods = set(contract["methods"])
        actual_methods = route_methods(app, route_path)
        missing_methods = sorted(expected_methods.difference(actual_methods))
        ok = bool(actual_methods) and not missing_methods

        details.append({
            "route": route_path,
            "ok": ok,
            "expected_methods": sorted(expected_methods),
            "actual_methods": sorted(actual_methods),
            "missing_methods": missing_methods,
            "status": "registered" if ok else "missing_or_wrong_method",
        })

    return {
        "ok": all(item["ok"] for item in details),
        "total": len(details),
        "registered": len([item for item in details if item["ok"]]),
        "missing": [
            item["route"]
            for item in details
            if not item["ok"]
        ],
        "details": details,
    }


# ---------------------------------------------------------------------------
# Configuration checks
# ---------------------------------------------------------------------------


def check_config(app):
    details = []

    for key in REQUIRED_CONFIG_KEYS:
        value = app.config.get(key)
        placeholder = is_placeholder(value)
        ok = is_config_key_valid(key, value)

        details.append({
            "key": key,
            "ok": ok,
            "present": value is not None,
            "placeholder": placeholder and not ok,
            "value_preview": (
                "***"
                if "PASSWORD" in key or "SECRET" in key
                else safe_str(value)
            ),
        })

    credential_keys = {
        "MAIL_USERNAME",
        "MAIL_PASSWORD",
        "MAIL_DEFAULT_SENDER",
        "RAZORPAY_KEY_ID",
        "RAZORPAY_KEY_SECRET",
    }

    required_runtime_ok = all(
        item["ok"]
        for item in details
        if item["key"] not in credential_keys
    )

    payment_email_ready = all(
        item["ok"]
        for item in details
        if item["key"] in credential_keys
    )

    return {
        "ok": required_runtime_ok,
        "payment_email_ready": payment_email_ready,
        "total": len(details),
        "ready": len([item for item in details if item["ok"]]),
        "needs_real_values": [
            item["key"]
            for item in details
            if not item["ok"]
        ],
        "details": details,
    }


# ---------------------------------------------------------------------------
# Index-definition and live-index checks
# ---------------------------------------------------------------------------


def load_index_definitions():
    namespace = runpy.run_path(str(INDEX_SCRIPT_FILE))
    definitions = namespace.get("INDEX_DEFINITIONS")

    if not isinstance(definitions, list):
        raise RuntimeError(
            "create_saas_indexes.py does not expose INDEX_DEFINITIONS as a list."
        )

    return definitions


def check_index_definitions():
    try:
        definitions = load_index_definitions()
        names = [safe_str(item.get("name")) for item in definitions]
        duplicate_names = sorted({name for name in names if names.count(name) > 1})
        premium_names = {
            safe_str(item.get("name"))
            for item in definitions
            if safe_str(item.get("collection")) == "premium_plan_requests"
        }
        missing_premium = sorted(PREMIUM_REQUEST_INDEXES.difference(premium_names))
        extra_premium = sorted(premium_names.difference(PREMIUM_REQUEST_INDEXES))

        details_valid = all(
            safe_str(item.get("collection"))
            and safe_str(item.get("name"))
            and isinstance(item.get("keys"), list)
            and bool(item.get("keys"))
            for item in definitions
        )

        ok = bool(
            len(definitions) == EXPECTED_INDEX_COUNT
            and len(premium_names) == EXPECTED_PREMIUM_INDEX_COUNT
            and not duplicate_names
            and not missing_premium
            and details_valid
        )

        return {
            "ok": ok,
            "script": str(INDEX_SCRIPT_FILE),
            "expected_total": EXPECTED_INDEX_COUNT,
            "defined_total": len(definitions),
            "expected_premium_total": EXPECTED_PREMIUM_INDEX_COUNT,
            "defined_premium_total": len(premium_names),
            "premium_indexes_ok": not missing_premium
            and len(premium_names) == EXPECTED_PREMIUM_INDEX_COUNT,
            "premium_indexes": sorted(premium_names),
            "missing_premium_indexes": missing_premium,
            "extra_premium_indexes": extra_premium,
            "duplicate_index_names": duplicate_names,
            "definitions_valid": details_valid,
            "definitions": definitions,
        }
    except Exception as exc:
        return {
            "ok": False,
            "script": str(INDEX_SCRIPT_FILE),
            "expected_total": EXPECTED_INDEX_COUNT,
            "defined_total": 0,
            "expected_premium_total": EXPECTED_PREMIUM_INDEX_COUNT,
            "defined_premium_total": 0,
            "premium_indexes_ok": False,
            "premium_indexes": [],
            "missing_premium_indexes": sorted(PREMIUM_REQUEST_INDEXES),
            "extra_premium_indexes": [],
            "duplicate_index_names": [],
            "definitions_valid": False,
            "definitions": [],
            "error": str(exc),
        }


# ---------------------------------------------------------------------------
# Billing integration contract checks
# ---------------------------------------------------------------------------


def check_billing_contract():
    """
    Read-only source and signature checks for the Premium, invoice, alert and
    subscription-validity integration.

    These checks intentionally verify the safeguards that were previously easy
    to miss, including client_visible/quotation_status payment gating and the
    separation between Save Draft and Send Quotation.
    """

    checks = []

    try:
        from app.services.billing_service import (
            create_subscription_order,
            resolve_premium_quotation_for_payment,
            verify_and_activate_payment,
        )

        create_signature = inspect.signature(create_subscription_order)
        resolver_signature = inspect.signature(resolve_premium_quotation_for_payment)
        create_source = inspect.getsource(create_subscription_order)
        resolver_source = inspect.getsource(resolve_premium_quotation_for_payment)
        verify_source = inspect.getsource(verify_and_activate_payment)

        checks.append(make_contract_check(
            "service_create_order_accepts_premium_request_id",
            "premium_request_id" in create_signature.parameters,
            str(create_signature),
            "create_subscription_order(..., premium_request_id=None)",
        ))

        checks.append(make_contract_check(
            "service_resolver_accepts_premium_request_id",
            "premium_request_id" in resolver_signature.parameters,
            str(resolver_signature),
            "resolve_premium_quotation_for_payment(..., premium_request_id=None)",
        ))

        checks.append(make_contract_check(
            "explicit_premium_request_id_fails_closed",
            "if selected_request_id:" in resolver_source
            and "premium_quotation_not_available" in resolver_source,
            "An unavailable explicit quotation ID raises instead of falling back.",
            "Explicit request IDs must never silently fall back to another quote.",
        ))

        checks.append(make_contract_check(
            "premium_requires_client_visible_released_quotation",
            'premium_request.get("client_visible") is True' in resolver_source
            and 'quotation_status not in {"sent", "converted"}' in resolver_source
            and "premium_quotation_not_released" in resolver_source,
            "Premium payment is gated by client_visible and quotation_status.",
            "client_visible=True and quotation_status in sent/converted",
        ))

        checks.append(make_contract_check(
            "premium_uses_published_quotation_snapshot",
            'premium_request.get("published_quotation")' in resolver_source
            and "def quotation_value" in resolver_source,
            "Payment resolves from the last published quotation snapshot.",
            "Unpublished draft revisions must not alter client payment amount.",
        ))

        checks.append(make_contract_check(
            "premium_amount_is_server_authoritative",
            'quotation_value("renewal_amount")' in resolver_source
            and 'quotation_value("quoted_amount")' in resolver_source
            and '"amount": amount' in resolver_source,
            "Premium amount is taken from the stored quotation.",
            "Frontend-provided Premium amount must be ignored.",
        ))

        checks.append(make_contract_check(
            "premium_renewal_uses_custom_quote",
            '"renewal_price_source": "custom_quote"' in resolver_source
            and '"payment_source": "premium_custom_quote"' in resolver_source,
            "Premium recurring pricing uses custom_quote.",
            "renewal_price_source=custom_quote",
        ))

        checks.append(make_contract_check(
            "essential_growth_use_dynamic_plan_price",
            "resolve_selected_pricing_plan" in create_source
            and '"dynamic_plan_price"' in create_source,
            "Essential/Growth orders resolve the active pricing-plan record.",
            "renewal_price_source=dynamic_plan_price",
        ))

        checks.append(make_contract_check(
            "payment_order_persists_premium_request_id",
            '"premium_request_id"' in create_source
            and "payment_orders.insert_one" in create_source,
            "Premium request ID is persisted with the Razorpay order.",
            "payment_orders.premium_request_id",
        ))

        checks.append(make_contract_check(
            "payment_verification_activates_premium_and_records_history",
            "premium_plan_requests.update_one" in verify_source
            and '"payment_status": "paid"' in verify_source
            and '"payment_history"' in verify_source
            and '"next_due_date"' in verify_source,
            "Successful payment marks the quotation paid and records renewal history.",
            "paid status, payment_history and next_due_date",
        ))

        checks.append(make_contract_check(
            "payment_verification_preserves_employee_limit",
            '"employee_limit"' in verify_source
            and '"is_unlimited_employees"' in verify_source,
            "Activation carries quoted/unlimited employee access into payment processing.",
            "quoted or unlimited employee limit",
        ))
    except Exception as exc:
        checks.append(make_contract_check(
            "billing_service_import",
            False,
            str(exc),
            "Billing service functions must import successfully.",
        ))

    try:
        route_source = read_text(BACKEND_BILLING_ROUTE_FILE)

        checks.append(make_contract_check(
            "billing_route_forwards_premium_request_id",
            'data.get("premium_request_id")' in route_source
            and "premium_request_id=premium_request_id" in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "create-order reads and forwards premium_request_id",
        ))

        checks.append(make_contract_check(
            "billing_summary_only_exposes_released_quote",
            '"client_visible": True' in route_source
            and '"quotation_status": {"$in": ["sent", "converted"]}' in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "Client summary must exclude internal draft quotations.",
        ))

        checks.append(make_contract_check(
            "billing_summary_exposes_premium_payment_fields",
            '"premium_quotation"' in route_source
            and '"premium_payment_due"' in route_source
            and '"premium_request"' in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "summary returns Premium quotation/payment data",
        ))

        checks.append(make_contract_check(
            "billing_summary_exposes_validity_alerts_and_actions",
            '"subscription_days_left"' in route_source
            and '"subscription_valid_until"' in route_source
            and '"billing_alerts"' in route_source
            and '"billing_actions"' in route_source
            and '"show_upgrade_actions"' in route_source
            and '"renewal_due_soon"' in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "summary returns validity, alerts and frontend action flags",
        ))

        checks.append(make_contract_check(
            "billing_summary_exposes_invoice_history",
            '"invoices"' in route_source
            and '"invoice_count"' in route_source
            and '"latest_invoice"' in route_source
            and "load_tenant_invoices" in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "summary returns invoice/payment history",
        ))

        checks.append(make_contract_check(
            "client_invoice_list_route_exists",
            '@billing_bp.get("/invoices")' in route_source
            and "def billing_invoices" in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "GET /api/v1/billing/invoices",
        ))

        checks.append(make_contract_check(
            "authorized_invoice_pdf_download_exists",
            '@billing_bp.get("/invoices/<payment_id>/download")' in route_source
            and "def download_billing_invoice" in route_source
            and "build_invoice_pdf" in route_source
            and 'mimetype="application/pdf"' in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "GET /api/v1/billing/invoices/<payment_id>/download",
        ))

        old_auto_send_pattern = (
            'truthy(data.get("send_to_client")) or status in '
            '{"quoted", "payment_pending"}'
        )
        checks.append(make_contract_check(
            "save_draft_is_separate_from_send_quotation",
            'send_to_client = truthy(data.get("send_to_client"))' in route_source
            and old_auto_send_pattern not in route_source
            and 'if send_to_client:' in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "Only explicit send_to_client=true may publish a quotation.",
        ))

        checks.append(make_contract_check(
            "sent_quotation_creates_published_snapshot",
            'update_doc["published_quotation"] = published_quotation' in route_source
            and 'update_doc["client_visible"] = True' in route_source
            and 'update_doc["quotation_status"] = "sent"' in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "Released quotation must be snapshotted and marked client-visible.",
        ))

        checks.append(make_contract_check(
            "quotation_email_and_notifications_are_send_only",
            "if send_to_client and tenant_id:" in route_source
            and "send_premium_quotation_email" in route_source
            and "create_premium_quotation_notifications" in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "Draft saving must not email or notify the client.",
        ))

        checks.append(make_contract_check(
            "superadmin_responses_expose_alert_and_invoice_metadata",
            'item["alert_level"]' in route_source
            and 'item["alert_message"]' in route_source
            and 'item["payment_days_left"]' in route_source
            and "serialize_invoice" in route_source,
            str(BACKEND_BILLING_ROUTE_FILE),
            "Premium/subscription/payment admin APIs expose status metadata.",
        ))
    except Exception as exc:
        checks.append(make_contract_check(
            "billing_route_source",
            False,
            str(exc),
            str(BACKEND_BILLING_ROUTE_FILE),
        ))

    try:
        frontend_source = read_text(FRONTEND_BILLING_FILE)

        checks.append(make_contract_check(
            "client_billing_sends_premium_request_id",
            "requestBody.premium_request_id" in frontend_source
            and "'/billing/create-order'" in frontend_source,
            str(FRONTEND_BILLING_FILE),
            "Billing.jsx sends premium_request_id to create-order",
        ))

        checks.append(make_contract_check(
            "client_billing_verifies_razorpay_payment",
            "'/billing/verify-payment'" in frontend_source
            and "razorpay_signature" in frontend_source,
            str(FRONTEND_BILLING_FILE),
            "Billing.jsx verifies Razorpay checkout",
        ))

        checks.append(make_contract_check(
            "client_billing_displays_alerts_and_validity",
            "const billingAlerts" in frontend_source
            and "<BillingAlerts alerts={billingAlerts}" in frontend_source
            and "subscription_valid_until" in frontend_source
            and "Validity Remaining" in frontend_source,
            str(FRONTEND_BILLING_FILE),
            "Client sees billing alerts and remaining subscription validity.",
        ))

        checks.append(make_contract_check(
            "client_billing_displays_and_downloads_invoices",
            "function InvoiceHistory" in frontend_source
            and "Invoices and payment history" in frontend_source
            and "Download PDF" in frontend_source
            and "downloadInvoice" in frontend_source,
            str(FRONTEND_BILLING_FILE),
            "Client can review invoice status and download PDF invoices.",
        ))

        checks.append(make_contract_check(
            "client_billing_hides_upgrade_actions_while_active",
            "computed.showPlanSelection ?" in frontend_source
            and "computed.showPaymentActions ?" in frontend_source
            and "Upgrade and payment controls stay hidden until the renewal window opens" in frontend_source,
            str(FRONTEND_BILLING_FILE),
            "Plan/payment controls depend on backend renewal-window action flags.",
        ))

        checks.append(make_contract_check(
            "client_billing_displays_premium_history",
            "quotation_history" in frontend_source
            and "payment_history" in frontend_source
            and "Pay Premium Quotation" in frontend_source,
            str(FRONTEND_BILLING_FILE),
            "Premium quotation/payment history and payment action are available.",
        ))
    except Exception as exc:
        checks.append(make_contract_check(
            "frontend_billing_source",
            False,
            str(exc),
            str(FRONTEND_BILLING_FILE),
        ))

    try:
        premium_source = read_text(FRONTEND_PREMIUM_REQUESTS_FILE)

        checks.append(make_contract_check(
            "superadmin_premium_has_explicit_draft_and_send_actions",
            "Save Draft" in premium_source
            and "send_to_client" in premium_source
            and "Send Quotation" in premium_source,
            str(FRONTEND_PREMIUM_REQUESTS_FILE),
            "Superadmin can save internally or explicitly release a quotation.",
        ))

        checks.append(make_contract_check(
            "superadmin_premium_hides_paid_actions_and_supports_revision",
            "const showQuotationForm = !paid || revisionMode" in premium_source
            and "Revise Quotation" in premium_source
            and "Quotation and payment action buttons are hidden because this subscription is paid" in premium_source,
            str(FRONTEND_PREMIUM_REQUESTS_FILE),
            "Paid/activated requests become status-only until Revise Quotation.",
        ))

        checks.append(make_contract_check(
            "superadmin_premium_displays_delivery_and_due_alerts",
            "quotation_notification_count" in premium_source
            and "quotation_email_sent" in premium_source
            and "payment_due_date" in premium_source
            and "Next Renewal Due" in premium_source,
            str(FRONTEND_PREMIUM_REQUESTS_FILE),
            "Superadmin sees delivery, due-date and renewal status.",
        ))
    except Exception as exc:
        checks.append(make_contract_check(
            "frontend_premium_requests_source",
            False,
            str(exc),
            str(FRONTEND_PREMIUM_REQUESTS_FILE),
        ))

    try:
        subscriptions_source = read_text(FRONTEND_SUBSCRIPTIONS_FILE)

        checks.append(make_contract_check(
            "superadmin_subscriptions_displays_validity_and_alerts",
            "renewal_due_soon" in subscriptions_source
            and "days_left" in subscriptions_source
            and "Billing alerts requiring attention" in subscriptions_source
            and "subscription expired" in subscriptions_source,
            str(FRONTEND_SUBSCRIPTIONS_FILE),
            "Superadmin sees active, expiring and expired subscription alerts.",
        ))

        checks.append(make_contract_check(
            "superadmin_subscriptions_displays_downloadable_invoices",
            "invoice_number" in subscriptions_source
            and "invoice_status" in subscriptions_source
            and "Download PDF" in subscriptions_source
            and "downloadInvoice" in subscriptions_source,
            str(FRONTEND_SUBSCRIPTIONS_FILE),
            "Superadmin can check payment/invoice status and download PDFs.",
        ))

        checks.append(make_contract_check(
            "superadmin_pricing_keeps_premium_custom_only",
            "Premium remains quotation-based" in subscriptions_source
            and "Direct default-price Razorpay checkout remains disabled" in subscriptions_source,
            str(FRONTEND_SUBSCRIPTIONS_FILE),
            "Premium cannot be converted into a direct fixed-price checkout plan.",
        ))
    except Exception as exc:
        checks.append(make_contract_check(
            "frontend_subscriptions_source",
            False,
            str(exc),
            str(FRONTEND_SUBSCRIPTIONS_FILE),
        ))

    return {
        "ok": all(item.get("ok") for item in checks),
        "total": len(checks),
        "passed": len([item for item in checks if item.get("ok")]),
        "failed": [item.get("name") for item in checks if not item.get("ok")],
        "details": checks,
    }


# ---------------------------------------------------------------------------
# Database checks
# ---------------------------------------------------------------------------


def resolve_db(app):
    candidates = []

    try:
        candidates.append(getattr(app, "db", None))
    except Exception:
        pass

    try:
        candidates.append(app.config.get("MONGO_DB"))
    except Exception:
        pass

    try:
        for extension_value in getattr(app, "extensions", {}).values():
            candidates.append(getattr(extension_value, "db", None))
            candidates.append(extension_value)
    except Exception:
        pass

    try:
        from app import extensions

        candidates.append(getattr(extensions, "db", None))

        mongo = getattr(extensions, "mongo", None)
        candidates.append(getattr(mongo, "db", None))
        candidates.append(mongo)
    except Exception:
        pass

    for candidate in candidates:
        if candidate is None:
            continue

        try:
            if hasattr(candidate, "tenants") or hasattr(candidate, "users"):
                return candidate
        except Exception:
            pass

        try:
            nested = getattr(candidate, "db", None)

            if nested is not None and (
                hasattr(nested, "tenants") or hasattr(nested, "users")
            ):
                return nested
        except Exception:
            pass

    raise RuntimeError("Unable to resolve MongoDB database object.")


def check_database(app, index_contract):
    try:
        db = resolve_db(app)
        collection_names = set(db.list_collection_names())
        collection_details = []

        for collection_name in SAAS_COLLECTIONS:
            exists = collection_name in collection_names
            count = None
            error = ""

            if exists:
                try:
                    count = db[collection_name].estimated_document_count()
                except Exception as exc:
                    error = str(exc)

            collection_details.append({
                "collection": collection_name,
                "exists": exists,
                "count": count,
                "error": error,
            })

        sds_tenant_id = app.config.get("SDS_TENANT_ID", "sds")
        sds_tenant_code = app.config.get("SDS_TENANT_CODE", "SDS")

        sds_tenant = db.tenants.find_one({
            "$or": [
                {"tenant_id": sds_tenant_id},
                {"tenant_code": sds_tenant_code},
                {"is_sds_company": True},
            ],
            "is_deleted": {"$ne": True},
        })

        pricing_plan_codes = []

        if "pricing_plans" in collection_names:
            try:
                pricing_plan_codes = sorted([
                    plan.get("plan_code")
                    for plan in db.pricing_plans.find(
                        {"is_deleted": {"$ne": True}},
                        {"plan_code": 1},
                    )
                    if plan.get("plan_code")
                ])
            except Exception:
                pricing_plan_codes = []

        expected_pricing_codes = {"essential", "growth", "premium"}
        pricing_defaults_exist = expected_pricing_codes.issubset(
            set(pricing_plan_codes)
        )

        definitions = index_contract.get("definitions") or []
        expected_by_collection = defaultdict(set)

        for definition in definitions:
            expected_by_collection[safe_str(definition.get("collection"))].add(
                safe_str(definition.get("name"))
            )

        actual_by_collection = {}
        index_errors = {}

        for collection_name in expected_by_collection:
            if collection_name not in collection_names:
                actual_by_collection[collection_name] = set()
                continue

            try:
                actual_by_collection[collection_name] = {
                    safe_str(index.get("name"))
                    for index in db[collection_name].list_indexes()
                    if index.get("name")
                }
            except Exception as exc:
                actual_by_collection[collection_name] = set()
                index_errors[collection_name] = str(exc)

        missing_indexes = []
        matched_indexes = []

        for collection_name, expected_names in expected_by_collection.items():
            actual_names = actual_by_collection.get(collection_name, set())

            for index_name in sorted(expected_names):
                item = f"{collection_name}.{index_name}"

                if index_name in actual_names:
                    matched_indexes.append(item)
                else:
                    missing_indexes.append(item)

        premium_request_indexes = sorted(
            actual_by_collection.get("premium_plan_requests", set())
        )
        premium_request_indexes_ok = PREMIUM_REQUEST_INDEXES.issubset(
            set(premium_request_indexes)
        )

        all_saas_indexes_ok = bool(
            index_contract.get("ok")
            and len(matched_indexes) == EXPECTED_INDEX_COUNT
            and not missing_indexes
        )

        return {
            "ok": True,
            "connected": True,
            "collections": collection_details,
            "sds_tenant_exists": bool(sds_tenant),
            "pricing_defaults_exist": pricing_defaults_exist,
            "pricing_plan_codes": pricing_plan_codes,
            "expected_index_count": EXPECTED_INDEX_COUNT,
            "live_required_index_count": len(matched_indexes),
            "all_saas_indexes_ok": all_saas_indexes_ok,
            "missing_indexes": missing_indexes,
            "matched_indexes": matched_indexes,
            "index_errors": index_errors,
            "premium_request_collection_exists": (
                "premium_plan_requests" in collection_names
            ),
            "premium_request_indexes_ok": premium_request_indexes_ok,
            "premium_request_indexes": premium_request_indexes,
            "premium_request_missing_indexes": sorted(
                PREMIUM_REQUEST_INDEXES.difference(
                    set(premium_request_indexes)
                )
            ),
            "sds_tenant": {
                "tenant_id": sds_tenant.get("tenant_id") if sds_tenant else "",
                "tenant_code": sds_tenant.get("tenant_code") if sds_tenant else "",
                "company_name": sds_tenant.get("company_name") if sds_tenant else "",
                "plan_type": sds_tenant.get("plan_type") if sds_tenant else "",
                "status": sds_tenant.get("status") if sds_tenant else "",
                "is_sds_company": (
                    sds_tenant.get("is_sds_company") if sds_tenant else False
                ),
            },
        }
    except Exception as exc:
        return {
            "ok": False,
            "connected": False,
            "error": str(exc),
            "collections": [],
            "sds_tenant_exists": False,
            "pricing_defaults_exist": False,
            "pricing_plan_codes": [],
            "expected_index_count": EXPECTED_INDEX_COUNT,
            "live_required_index_count": 0,
            "all_saas_indexes_ok": False,
            "missing_indexes": [],
            "matched_indexes": [],
            "index_errors": {},
            "premium_request_collection_exists": False,
            "premium_request_indexes_ok": False,
            "premium_request_indexes": [],
            "premium_request_missing_indexes": sorted(PREMIUM_REQUEST_INDEXES),
        }


# ---------------------------------------------------------------------------
# Result and output
# ---------------------------------------------------------------------------


def run_check():
    os.chdir(BACKEND_DIR)

    from app import create_app

    app = create_app()

    with app.app_context():
        route_result = check_routes(app)
        config_result = check_config(app)
        index_definition_result = check_index_definitions()
        billing_contract_result = check_billing_contract()
        database_result = check_database(app, index_definition_result)

    overall_ok = bool(
        route_result.get("ok")
        and config_result.get("ok")
        and index_definition_result.get("ok")
        and billing_contract_result.get("ok")
        and database_result.get("connected")
        and database_result.get("sds_tenant_exists")
        and database_result.get("pricing_defaults_exist")
        and database_result.get("all_saas_indexes_ok")
        and database_result.get("premium_request_indexes_ok")
    )

    return {
        "ok": overall_ok,
        "checked_at": now_utc(),
        "backend_dir": str(BACKEND_DIR),
        "routes": route_result,
        "config": config_result,
        "index_definitions": index_definition_result,
        "database": database_result,
        "billing_contract": billing_contract_result,
        # Backward-compatible key retained for older parsing/scripts.
        "premium_billing": billing_contract_result,
        "next_steps": build_next_steps(
            route_result,
            config_result,
            index_definition_result,
            database_result,
            billing_contract_result,
        ),
    }


def build_next_steps(
    route_result,
    config_result,
    index_definition_result,
    database_result,
    billing_contract_result,
):
    steps = []

    if route_result.get("missing"):
        steps.append(
            "Some SaaS routes or HTTP methods are missing. Recheck route registration and billing.py decorators."
        )

    if config_result.get("needs_real_values"):
        steps.append(
            "Some config values are missing/placeholders. Update backend/.env, especially SMTP and Razorpay values."
        )

    if not config_result.get("payment_email_ready"):
        steps.append(
            "SMTP/Razorpay are not fully ready. Quotation email and checkout may fail until real credentials are configured."
        )

    if not index_definition_result.get("ok"):
        steps.append(
            "create_saas_indexes.py must define exactly 28 valid indexes, including all 5 premium_plan_requests indexes."
        )

    if not billing_contract_result.get("ok"):
        failed_checks = ", ".join(
            billing_contract_result.get("failed") or []
        )
        steps.append(
            "Billing integration contract failed. Recheck billing_service.py, billing.py and the three billing frontend pages. "
            f"Failed checks: {failed_checks or 'unknown'}."
        )

    if not database_result.get("connected"):
        steps.append("MongoDB connection failed. Check MONGO_URI and database server.")

    if database_result.get("connected") and not database_result.get("sds_tenant_exists"):
        steps.append("SDS lifetime tenant is missing. Run: python scripts/seed_sds_tenant.py")

    if database_result.get("connected") and not database_result.get("pricing_defaults_exist"):
        steps.append("Dynamic pricing defaults are missing. Run: python scripts/seed_pricing_plans.py")

    if database_result.get("connected") and not database_result.get("all_saas_indexes_ok"):
        steps.append(
            "One or more required SaaS indexes are missing. Run: python scripts/create_saas_indexes.py"
        )

    if (
        database_result.get("connected")
        and not database_result.get("premium_request_indexes_ok")
    ):
        steps.append(
            "Premium request indexes are missing. Run: python scripts/create_saas_indexes.py"
        )

    if not steps:
        steps.append(
            "Smoke check passed. Continue with manual trial, quotation, Razorpay test-payment, invoice-download and renewal-window testing."
        )

    return steps


def build_parser():
    parser = argparse.ArgumentParser(
        description="Run YourComate HRMS SaaS smoke checks.",
    )

    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full result as JSON.",
    )

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    result = serialize_for_json(run_check())

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result.get("ok") else 1

    print("YourComate HRMS SaaS Smoke Check")
    print("--------------------------------")
    print(f"Checked At                 : {result.get('checked_at')}")
    print(f"Backend Dir                : {result.get('backend_dir')}")
    print(f"Overall OK                 : {result.get('ok')}")

    print("")
    print("Routes")
    print(
        f"- Registered               : "
        f"{result['routes'].get('registered')} / "
        f"{result['routes'].get('total')}"
    )

    if result["routes"].get("missing"):
        print("- Missing/Wrong Method:")
        for item in result["routes"].get("details") or []:
            if item.get("ok"):
                continue
            print(
                f"  - {item.get('route')} "
                f"expected={','.join(item.get('expected_methods') or [])} "
                f"actual={','.join(item.get('actual_methods') or []) or 'none'}"
            )

    print("")
    print("Config")
    print(f"- Runtime Config OK         : {result['config'].get('ok')}")
    print(f"- SMTP/Razorpay Ready       : {result['config'].get('payment_email_ready')}")

    if result["config"].get("needs_real_values"):
        print("- Needs real values:")
        for key in result["config"]["needs_real_values"]:
            print(f"  - {key}")

    print("")
    print("Billing Integration Contract")
    print(
        f"- Passed                    : "
        f"{result['billing_contract'].get('passed')} / "
        f"{result['billing_contract'].get('total')}"
    )
    print(f"- Contract OK               : {result['billing_contract'].get('ok')}")

    if result["billing_contract"].get("failed"):
        print("- Failed Checks:")
        for check_name in result["billing_contract"]["failed"]:
            print(f"  - {check_name}")

    print("")
    print("Index Definitions")
    print(
        f"- Defined                   : "
        f"{result['index_definitions'].get('defined_total')} / "
        f"{result['index_definitions'].get('expected_total')}"
    )
    print(
        f"- Premium Definitions       : "
        f"{result['index_definitions'].get('defined_premium_total')} / "
        f"{result['index_definitions'].get('expected_premium_total')}"
    )
    print(f"- Definition Contract OK    : {result['index_definitions'].get('ok')}")

    print("")
    print("Database")
    print(f"- Connected                 : {result['database'].get('connected')}")
    print(f"- SDS Tenant Exists         : {result['database'].get('sds_tenant_exists')}")
    print(f"- Pricing Defaults          : {result['database'].get('pricing_defaults_exist')}")
    print(
        f"- Pricing Plan Codes        : "
        f"{', '.join(result['database'].get('pricing_plan_codes') or []) or 'None'}"
    )
    print(
        f"- Live SaaS Indexes         : "
        f"{result['database'].get('live_required_index_count')} / "
        f"{result['database'].get('expected_index_count')}"
    )
    print(f"- All SaaS Indexes          : {result['database'].get('all_saas_indexes_ok')}")
    print(f"- Premium Requests          : {result['database'].get('premium_request_collection_exists')}")
    print(f"- Premium Req Indexes       : {result['database'].get('premium_request_indexes_ok')}")

    if result["database"].get("premium_request_missing_indexes"):
        print("- Missing Premium Indexes:")
        for index_name in result["database"]["premium_request_missing_indexes"]:
            print(f"  - {index_name}")

    if result["database"].get("missing_indexes"):
        print("- Missing Required Indexes:")
        for index_name in result["database"]["missing_indexes"]:
            print(f"  - {index_name}")

    if result["database"].get("error"):
        print(f"- Error                     : {result['database'].get('error')}")

    print("")
    print("Next Steps")
    for step in result.get("next_steps") or []:
        print(f"- {step}")

    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())