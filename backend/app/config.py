import os
from dotenv import load_dotenv


load_dotenv()


def _get_bool(name, default=False):
    value = os.getenv(name)

    if value is None:
        return default

    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _get_int(name, default):
    value = os.getenv(name)

    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _get_float(name, default):
    value = os.getenv(name)

    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _get_csv(name, default=""):
    value = os.getenv(name, default)

    return [
        item.strip()
        for item in str(value or "").split(",")
        if item.strip()
    ]


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-key")

    MONGO_URI = os.getenv(
        "MONGO_URI",
        "mongodb://localhost:27017/sds_hrms_full",
    )

    # Existing SDS / Sayanant Development Services tenant.
    # This tenant must always keep lifetime full access and must not be
    # restricted by demo expiry, employee limit, or Razorpay subscription.
    DEFAULT_TENANT_ID = os.getenv("DEFAULT_TENANT_ID", "sds")
    SDS_TENANT_ID = os.getenv("SDS_TENANT_ID", DEFAULT_TENANT_ID)
    SDS_TENANT_CODE = os.getenv("SDS_TENANT_CODE", "SDS")
    SDS_COMPANY_NAME = os.getenv(
        "SDS_COMPANY_NAME",
        "Sayanant Development Services Pvt. Ltd.",
    )
    SDS_PLAN_TYPE = os.getenv("SDS_PLAN_TYPE", "lifetime")
    SDS_HAS_LIFETIME_ACCESS = _get_bool("SDS_HAS_LIFETIME_ACCESS", True)

    JSON_SORT_KEYS = False

    MAX_CONTENT_LENGTH = _get_int(
        "MAX_CONTENT_LENGTH",
        16 * 1024 * 1024,
    )

    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

    FRONTEND_ORIGINS = [
        origin.strip()
        for origin in os.getenv(
            "FRONTEND_ORIGINS",
            "http://127.0.0.1:5173,http://localhost:5173",
        ).split(",")
        if origin.strip()
    ]

    # ------------------------------------------------------------
    # YourComate SaaS settings
    # ------------------------------------------------------------
    SAAS_ENABLED = _get_bool("SAAS_ENABLED", True)
    YOURCOMATE_DOMAIN = os.getenv("YOURCOMATE_DOMAIN", "yourcomate.com")
    AUTO_ADMIN_EMAIL_DOMAIN = os.getenv(
        "AUTO_ADMIN_EMAIL_DOMAIN",
        YOURCOMATE_DOMAIN,
    )

    # Demo registration / trial settings.
    # New SaaS rule:
    # - demo trial is 15 days
    # - demo companies get full HRMS access during the trial
    # - after expiry, payment/subscription is required
    DEMO_DURATION_DAYS = _get_int("DEMO_DURATION_DAYS", 15)
    DEMO_HAS_FULL_ACCESS = _get_bool("DEMO_HAS_FULL_ACCESS", True)

    # 0 means no employee cap during the 15-day trial.
    # Paid plan limits are controlled by pricing plans after subscription.
    DEMO_EMPLOYEE_LIMIT = _get_int("DEMO_EMPLOYEE_LIMIT", 0)

    # Keep this configurable for backward compatibility.
    # With DEMO_HAS_FULL_ACCESS=true, this is treated as all modules.
    DEMO_ALLOWED_MODULES = _get_csv(
        "DEMO_ALLOWED_MODULES",
        "all",
    )

    # Used while generating approved demo company admin credentials.
    # Example:
    # Company: Rahul Baruah Private Limited
    # Initials: rbpvt
    # Email: rbpvt@yourcomate.com
    # Password: rbpvt@1234
    GENERATED_ADMIN_PASSWORD_SUFFIX = os.getenv(
        "GENERATED_ADMIN_PASSWORD_SUFFIX",
        "@1234",
    )

    # Demo request OTP settings.
    DEMO_OTP_LENGTH = _get_int("DEMO_OTP_LENGTH", 6)
    DEMO_OTP_EXPIRY_MINUTES = _get_int("DEMO_OTP_EXPIRY_MINUTES", 10)
    DEMO_OTP_MAX_VERIFY_ATTEMPTS = _get_int(
        "DEMO_OTP_MAX_VERIFY_ATTEMPTS",
        5,
    )

    # Reminder days are counted from the demo start date.
    # Example with 15-day trial: day 10, day 13, day 14, day 15.
    TRIAL_REMINDER_DAYS = [
        _get_int("TRIAL_REMINDER_DAY_1", 10),
        _get_int("TRIAL_REMINDER_DAY_2", 13),
        _get_int("TRIAL_REMINDER_DAY_3", 14),
        _get_int("TRIAL_REMINDER_DAY_4", 15),
    ]

    SAAS_PLAN_TYPES = {
        "lifetime": "lifetime",
        "demo": "demo",
        "paid": "paid",
    }

    SAAS_COMPANY_STATUSES = {
        "pending": "pending",
        "active": "active",
        "expired": "expired",
        "suspended": "suspended",
        "rejected": "rejected",
    }

    # ------------------------------------------------------------
    # SMTP / email settings
    # ------------------------------------------------------------
    MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.gmail.com")
    MAIL_PORT = _get_int("MAIL_PORT", 587)
    MAIL_USE_TLS = _get_bool("MAIL_USE_TLS", True)
    MAIL_USE_SSL = _get_bool("MAIL_USE_SSL", False)
    MAIL_USERNAME = os.getenv("MAIL_USERNAME", "")
    MAIL_PASSWORD = os.getenv("MAIL_PASSWORD", "")
    MAIL_DEFAULT_SENDER = os.getenv(
        "MAIL_DEFAULT_SENDER",
        MAIL_USERNAME or "no-reply@yourcomate.com",
    )
    MAIL_SENDER_NAME = os.getenv("MAIL_SENDER_NAME", "YourComate HRMS")

    # ------------------------------------------------------------
    # Razorpay settings
    # ------------------------------------------------------------
    RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
    RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
    RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    RAZORPAY_CURRENCY = os.getenv("RAZORPAY_CURRENCY", "INR")

    # Legacy fallback paid package values.
    # New paid plans are controlled dynamically through pricing_plans collection.
    SAAS_FULL_PLAN_NAME = os.getenv("SAAS_FULL_PLAN_NAME", "Growth")
    SAAS_FULL_PLAN_AMOUNT = _get_float("SAAS_FULL_PLAN_AMOUNT", 4495.0)
    SAAS_FULL_PLAN_INTERVAL = os.getenv("SAAS_FULL_PLAN_INTERVAL", "monthly")

    # Default dynamic pricing plan values.
    # Superadmin can later edit actual plan records from pricing APIs/UI.
    SAAS_ESSENTIAL_PLAN_AMOUNT = _get_float("SAAS_ESSENTIAL_PLAN_AMOUNT", 2495.0)
    SAAS_ESSENTIAL_EMPLOYEE_LIMIT = _get_int("SAAS_ESSENTIAL_EMPLOYEE_LIMIT", 50)

    SAAS_GROWTH_PLAN_AMOUNT = _get_float("SAAS_GROWTH_PLAN_AMOUNT", 4495.0)
    SAAS_GROWTH_EMPLOYEE_LIMIT = _get_int("SAAS_GROWTH_EMPLOYEE_LIMIT", 100)

    SAAS_PREMIUM_PLAN_AMOUNT = _get_float("SAAS_PREMIUM_PLAN_AMOUNT", 0.0)
    SAAS_PREMIUM_EMPLOYEE_LIMIT = _get_int("SAAS_PREMIUM_EMPLOYEE_LIMIT", 0)
    SAAS_PREMIUM_IS_CUSTOM = _get_bool("SAAS_PREMIUM_IS_CUSTOM", True)

    SAAS_DEFAULT_PAID_PLAN_CODE = os.getenv("SAAS_DEFAULT_PAID_PLAN_CODE", "growth")

    # Frontend URL used inside emails, subscription reminders, and payment links.
    FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173")
    BILLING_PAGE_PATH = os.getenv("BILLING_PAGE_PATH", "/billing")

    # Optional upload folder overrides used by profile photo APIs.
    PROFILE_PHOTO_UPLOAD_FOLDER = os.getenv("PROFILE_PHOTO_UPLOAD_FOLDER", "")
    PROFILE_COVER_UPLOAD_FOLDER = os.getenv("PROFILE_COVER_UPLOAD_FOLDER", "")