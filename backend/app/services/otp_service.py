import secrets
from datetime import datetime, timedelta, timezone

from werkzeug.security import check_password_hash, generate_password_hash


def now_utc():
    return datetime.now(timezone.utc)


def normalize_otp(value):
    return str(value or "").strip()


def generate_numeric_otp(length=6):
    """
    Generates a secure numeric OTP.

    Example:
    length = 6
    OTP = 493827
    """

    try:
        length = int(length)
    except (TypeError, ValueError):
        length = 6

    if length < 4:
        length = 4

    if length > 10:
        length = 10

    first_digit = str(secrets.randbelow(9) + 1)
    remaining_digits = "".join(
        str(secrets.randbelow(10))
        for _ in range(length - 1)
    )

    return f"{first_digit}{remaining_digits}"


def hash_otp(otp):
    otp = normalize_otp(otp)

    if not otp:
        return ""

    return generate_password_hash(otp)


def check_otp(otp, otp_hash):
    otp = normalize_otp(otp)
    otp_hash = str(otp_hash or "").strip()

    if not otp or not otp_hash:
        return False

    try:
        return check_password_hash(otp_hash, otp)
    except Exception:
        return False


def build_otp_payload(otp, expiry_minutes=10):
    """
    Builds OTP fields to save inside demo_requests collection.

    Store only otp_hash in database.
    Never store plain OTP.
    """

    try:
        expiry_minutes = int(expiry_minutes)
    except (TypeError, ValueError):
        expiry_minutes = 10

    if expiry_minutes <= 0:
        expiry_minutes = 10

    issued_at = now_utc()
    expires_at = issued_at + timedelta(minutes=expiry_minutes)

    return {
        "otp_hash": hash_otp(otp),
        "otp_issued_at": issued_at,
        "otp_expires_at": expires_at,
        "otp_verified": False,
        "otp_verified_at": None,
        "otp_attempts": 0,
    }


def is_otp_expired(demo_request):
    if not demo_request:
        return True

    expires_at = demo_request.get("otp_expires_at")

    if not expires_at:
        return True

    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError:
            return True

    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    return now_utc() > expires_at


def has_exceeded_otp_attempts(demo_request, max_attempts=5):
    if not demo_request:
        return True

    try:
        max_attempts = int(max_attempts)
    except (TypeError, ValueError):
        max_attempts = 5

    try:
        attempts = int(demo_request.get("otp_attempts", 0))
    except (TypeError, ValueError):
        attempts = 0

    return attempts >= max_attempts


def verify_demo_request_otp(demo_request, submitted_otp, max_attempts=5):
    """
    Checks submitted OTP against stored demo request OTP data.

    Returns:
    {
        "success": bool,
        "message": str,
        "update": dict
    }

    The route will use "update" to update MongoDB.
    """

    submitted_otp = normalize_otp(submitted_otp)

    if not demo_request:
        return {
            "success": False,
            "message": "Demo request not found.",
            "update": {},
        }

    if demo_request.get("otp_verified") is True:
        return {
            "success": True,
            "message": "Email is already verified.",
            "update": {},
        }

    if not submitted_otp:
        return {
            "success": False,
            "message": "Please enter the OTP.",
            "update": {},
        }

    if is_otp_expired(demo_request):
        return {
            "success": False,
            "message": "OTP has expired. Please request a new OTP.",
            "update": {},
        }

    if has_exceeded_otp_attempts(demo_request, max_attempts):
        return {
            "success": False,
            "message": "Maximum OTP attempts exceeded. Please request a new OTP.",
            "update": {},
        }

    is_valid = check_otp(submitted_otp, demo_request.get("otp_hash"))

    if not is_valid:
        return {
            "success": False,
            "message": "Invalid OTP.",
            "update": {
                "$inc": {
                    "otp_attempts": 1,
                },
                "$set": {
                    "updated_at": now_utc(),
                },
            },
        }

    return {
        "success": True,
        "message": "Email verified successfully.",
        "update": {
            "$set": {
                "otp_verified": True,
                "otp_verified_at": now_utc(),
                "status": "pending",
                "updated_at": now_utc(),
            }
        },
    }


def build_resend_otp_update(otp, expiry_minutes=10):
    """
    Builds MongoDB update payload for resending OTP.
    """

    payload = build_otp_payload(otp, expiry_minutes)

    return {
        "$set": {
            **payload,
            "updated_at": now_utc(),
        }
    }