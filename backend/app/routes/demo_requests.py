from datetime import datetime, timezone

from bson import ObjectId
from flask import Blueprint, current_app, g, jsonify, request

from app.extensions import get_db
from app.services.demo_request_service import (
    DemoRequestError,
    approve_demo_request,
    build_demo_request_document,
    find_demo_request,
    reject_demo_request,
    safe_str,
)
from app.services.email_service import (
    send_demo_approval_email,
    send_demo_otp_email,
    send_demo_rejection_email,
    send_demo_request_received_email,
)
from app.services.otp_service import (
    build_otp_payload,
    build_resend_otp_update,
    generate_numeric_otp,
    verify_demo_request_otp,
)
from app.utils.auth import audit, roles_required
from app.utils.serializers import clean_doc


demo_requests_bp = Blueprint("demo_requests", __name__)


PUBLIC_DEMO_FIELDS = [
    "company_name",
    "company_email",
    "company_phone",
    "company_address",
    "company_type",
    "contact_person_name",
    "contact_person_phone",
    "requested_employee_count",
    "message",
]


def now_utc():
    return datetime.now(timezone.utc)


def normalize_email(value):
    return str(value or "").strip().lower()


def request_json():
    if not request.is_json:
        return {}

    return request.get_json(silent=True) or {}


def object_id(value):
    try:
        value = str(value or "").strip()
        if value and ObjectId.is_valid(value):
            return ObjectId(value)
    except Exception:
        pass

    return None


def current_actor_id():
    user = getattr(g, "current_user", {}) or {}
    return str(user.get("_id") or user.get("id") or user.get("email") or "system")


def sanitize_demo_request(doc, include_internal=False):
    if not doc:
        return None

    cleaned = dict(doc)

    # Never expose OTP hash or security internals to frontend.
    for key in [
        "otp_hash",
        "generated_admin_password",
    ]:
        cleaned.pop(key, None)

    if not include_internal:
        cleaned.pop("tenant_object_id", None)
        cleaned.pop("admin_user_id", None)
        cleaned.pop("admin_employee_id", None)
        cleaned.pop("subscription_id", None)

    return clean_doc(cleaned)


def public_request_payload(data):
    return {
        field: data.get(field)
        for field in PUBLIC_DEMO_FIELDS
        if field in data
    }


def duplicate_demo_request(db, company_email):
    email = normalize_email(company_email)

    if not email:
        return None

    return db.demo_requests.find_one({
        "company_email": email,
        "is_deleted": {"$ne": True},
        "status": {
            "$in": [
                "otp_pending",
                "pending",
                "otp_verified",
                "approved",
            ]
        },
    })


def demo_request_query_from_filters(args):
    query = {"is_deleted": {"$ne": True}}

    status = safe_str(args.get("status"))
    search = safe_str(args.get("search"))
    email = normalize_email(args.get("email"))
    otp_verified = safe_str(args.get("otp_verified")).lower()

    if status and status.lower() != "all":
        query["status"] = status

    if email:
        query["company_email"] = email

    if otp_verified in {"true", "1", "yes"}:
        query["otp_verified"] = True
    elif otp_verified in {"false", "0", "no"}:
        query["otp_verified"] = {"$ne": True}

    if search:
        query["$or"] = [
            {"company_name": {"$regex": search, "$options": "i"}},
            {"company_email": {"$regex": search, "$options": "i"}},
            {"company_phone": {"$regex": search, "$options": "i"}},
            {"contact_person_name": {"$regex": search, "$options": "i"}},
        ]

    return query


@demo_requests_bp.post("/apply")
def apply_for_demo():
    """
    Public API used by Login page: Apply for Trial Registration.

    Flow:
    1. Company submits details.
    2. Backend generates OTP.
    3. OTP is emailed to registered company email through SMTP.
    4. Request is stored as otp_pending.
    """

    db = get_db()
    data = request_json()

    company_email = normalize_email(data.get("company_email") or data.get("email"))

    duplicate = duplicate_demo_request(db, company_email)
    if duplicate:
        return jsonify({
            "ok": False,
            "message": "A trial request already exists for this company email.",
            "status": duplicate.get("status"),
            "request_id": str(duplicate.get("_id")),
        }), 409

    otp_code = generate_numeric_otp(
        current_app.config.get("DEMO_OTP_LENGTH", 6),
    )
    otp_payload = build_otp_payload(
        otp_code,
        current_app.config.get("DEMO_OTP_EXPIRY_MINUTES", 10),
    )

    try:
        doc = build_demo_request_document(data, otp_payload=otp_payload)
    except DemoRequestError as exc:
        return jsonify({
            "ok": False,
            "message": exc.message,
        }), exc.status_code

    insert_result = db.demo_requests.insert_one(doc)
    request_id = str(insert_result.inserted_id)

    mail_result = send_demo_otp_email(
        current_app.config,
        doc.get("company_email"),
        doc.get("company_name"),
        otp_code,
        current_app.config.get("DEMO_OTP_EXPIRY_MINUTES", 10),
    )

    db.demo_requests.update_one(
        {"_id": insert_result.inserted_id},
        {
            "$set": {
                "otp_email_sent": bool(mail_result.get("ok")),
                "otp_email_result": mail_result,
                "updated_at": now_utc(),
            }
        },
    )

    return jsonify({
        "ok": True,
        "message": "Trial registration submitted. Please verify the OTP sent to the registered company email.",
        "request_id": request_id,
        "email": doc.get("company_email"),
        "otp_email_sent": bool(mail_result.get("ok")),
        "mail_message": mail_result.get("message"),
    }), 201


@demo_requests_bp.post("/verify-otp")
def verify_demo_otp():
    """
    Public API used after trial registration OTP entry.
    After successful OTP verification, request becomes pending for Superadmin approval.
    """

    db = get_db()
    data = request_json()

    request_id = data.get("request_id") or data.get("id")
    email = data.get("company_email") or data.get("email")
    otp = data.get("otp") or data.get("otp_code")

    demo_request = find_demo_request(
        db,
        request_id=request_id,
        email=email,
    )

    result = verify_demo_request_otp(
        demo_request,
        otp,
        current_app.config.get("DEMO_OTP_MAX_VERIFY_ATTEMPTS", 5),
    )

    if result.get("update"):
        db.demo_requests.update_one(
            {"_id": demo_request["_id"]},
            result["update"],
        )

    if not result.get("success"):
        status_code = 404 if result.get("message") == "Demo request not found." else 400
        return jsonify({
            "ok": False,
            "message": result.get("message"),
        }), status_code

    if demo_request and demo_request.get("otp_verified") is not True:
        mail_result = send_demo_request_received_email(
            current_app.config,
            demo_request.get("company_email"),
            demo_request.get("company_name"),
        )
        db.demo_requests.update_one(
            {"_id": demo_request["_id"]},
            {
                "$set": {
                    "request_received_email_sent": bool(mail_result.get("ok")),
                    "request_received_email_result": mail_result,
                    "updated_at": now_utc(),
                }
            },
        )

    updated_request = find_demo_request(
        db,
        request_id=request_id,
        email=email,
    )

    return jsonify({
        "ok": True,
        "message": result.get("message") or "Email verified successfully.",
        "request": sanitize_demo_request(updated_request),
        "trial": {
            "duration_days": current_app.config.get("DEMO_DURATION_DAYS", 15),
            "has_full_access": current_app.config.get("DEMO_HAS_FULL_ACCESS", True),
            "allowed_modules": current_app.config.get("DEMO_ALLOWED_MODULES", ["all"]),
            "requires_payment_after_expiry": True,
        },
    })


@demo_requests_bp.post("/resend-otp")
def resend_demo_otp():
    """
    Public API to resend OTP before Superadmin approval.
    """

    db = get_db()
    data = request_json()

    request_id = data.get("request_id") or data.get("id")
    email = data.get("company_email") or data.get("email")

    demo_request = find_demo_request(
        db,
        request_id=request_id,
        email=email,
    )

    if not demo_request:
        return jsonify({
            "ok": False,
            "message": "Demo request not found.",
        }), 404

    if demo_request.get("status") in {"approved", "rejected"}:
        return jsonify({
            "ok": False,
            "message": "OTP cannot be resent for an approved or rejected request.",
        }), 400

    if demo_request.get("otp_verified") is True:
        return jsonify({
            "ok": False,
            "message": "Email is already verified. Request is waiting for Superadmin approval.",
        }), 400

    otp_code = generate_numeric_otp(
        current_app.config.get("DEMO_OTP_LENGTH", 6),
    )
    update_payload = build_resend_otp_update(
        otp_code,
        current_app.config.get("DEMO_OTP_EXPIRY_MINUTES", 10),
    )

    db.demo_requests.update_one(
        {"_id": demo_request["_id"]},
        update_payload,
    )

    mail_result = send_demo_otp_email(
        current_app.config,
        demo_request.get("company_email"),
        demo_request.get("company_name"),
        otp_code,
        current_app.config.get("DEMO_OTP_EXPIRY_MINUTES", 10),
    )

    db.demo_requests.update_one(
        {"_id": demo_request["_id"]},
        {
            "$set": {
                "otp_email_sent": bool(mail_result.get("ok")),
                "otp_email_result": mail_result,
                "updated_at": now_utc(),
            }
        },
    )

    return jsonify({
        "ok": True,
        "message": "OTP resent to the registered company email.",
        "otp_email_sent": bool(mail_result.get("ok")),
        "mail_message": mail_result.get("message"),
    })


@demo_requests_bp.get("/status")
def demo_request_status():
    """
    Public API for company to check its request status after applying.
    """

    db = get_db()
    request_id = request.args.get("request_id") or request.args.get("id")
    email = request.args.get("email") or request.args.get("company_email")

    demo_request = find_demo_request(
        db,
        request_id=request_id,
        email=email,
    )

    if not demo_request:
        return jsonify({
            "ok": False,
            "message": "Demo request not found.",
        }), 404

    return jsonify({
        "ok": True,
        "request": sanitize_demo_request(demo_request),
    })


@demo_requests_bp.get("/admin/requests")
@roles_required("super_admin")
def list_demo_requests_for_admin():
    """
    Platform Superadmin API to monitor trial applications.
    """

    db = get_db()
    query = demo_request_query_from_filters(request.args)

    try:
        page = int(request.args.get("page", 1) or 1)
    except (TypeError, ValueError):
        page = 1

    try:
        limit = int(request.args.get("limit", 20) or 20)
    except (TypeError, ValueError):
        limit = 20

    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    skip = (page - 1) * limit

    total = db.demo_requests.count_documents(query)
    docs = list(
        db.demo_requests
        .find(query)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )

    counts_pipeline = [
        {"$match": {"is_deleted": {"$ne": True}}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    counts = {
        item.get("_id") or "unknown": item.get("count", 0)
        for item in db.demo_requests.aggregate(counts_pipeline)
    }

    return jsonify({
        "ok": True,
        "items": [sanitize_demo_request(doc, include_internal=True) for doc in docs],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit if limit else 1,
        },
        "counts": counts,
    })


@demo_requests_bp.get("/admin/requests/<request_id>")
@roles_required("super_admin")
def get_demo_request_for_admin(request_id):
    db = get_db()
    demo_request = find_demo_request(db, request_id=request_id)

    if not demo_request:
        return jsonify({
            "ok": False,
            "message": "Demo request not found.",
        }), 404

    return jsonify({
        "ok": True,
        "request": sanitize_demo_request(demo_request, include_internal=True),
    })


@demo_requests_bp.post("/admin/requests/<request_id>/approve")
@roles_required("super_admin")
def approve_demo_request_for_admin(request_id):
    """
    Superadmin approval API.

    On approval:
    - tenant/company is created
    - admin user is created
    - admin employee profile is created
    - 15-day full-access trial starts
    - generated login details are emailed to registered company email
    """

    db = get_db()

    try:
        result = approve_demo_request(
            db,
            request_id,
            approved_by=current_actor_id(),
            config=current_app.config,
        )
    except DemoRequestError as exc:
        return jsonify({
            "ok": False,
            "message": exc.message,
        }), exc.status_code

    demo_request = find_demo_request(db, request_id=request_id)

    frontend_base_url = str(current_app.config.get("FRONTEND_BASE_URL", "") or "").strip()
    login_url = frontend_base_url.rstrip("/") if frontend_base_url else None

    mail_result = send_demo_approval_email(
        current_app.config,
        demo_request.get("company_email"),
        demo_request.get("company_name"),
        result.get("admin_email"),
        result.get("admin_password"),
        login_url=login_url,
        trial_end_date=result.get("trial_end_date"),
    )

    db.demo_requests.update_one(
        {"_id": demo_request["_id"]},
        {
            "$set": {
                "approval_email_sent": bool(mail_result.get("ok")),
                "approval_email_result": mail_result,
                "updated_at": now_utc(),
            }
        },
    )

    audit(
        "approve_demo_request",
        "demo_request",
        request_id,
        {
            "tenant_id": result.get("tenant_id"),
            "company_name": demo_request.get("company_name"),
            "admin_email": result.get("admin_email"),
            "approval_email_sent": bool(mail_result.get("ok")),
        },
    )

    safe_result = dict(result)
    safe_result.pop("admin_password", None)
    safe_result["approval_email_sent"] = bool(mail_result.get("ok"))
    safe_result["mail_message"] = mail_result.get("message")

    return jsonify({
        "ok": True,
        "message": "Trial request approved successfully. Admin login details have been emailed to the registered company email.",
        "result": clean_doc(safe_result),
    })


@demo_requests_bp.post("/admin/requests/<request_id>/reject")
@roles_required("super_admin")
def reject_demo_request_for_admin(request_id):
    db = get_db()
    data = request_json()
    reason = data.get("reason") or data.get("rejection_reason") or ""

    try:
        result = reject_demo_request(
            db,
            request_id,
            rejected_by=current_actor_id(),
            reason=reason,
        )
    except DemoRequestError as exc:
        return jsonify({
            "ok": False,
            "message": exc.message,
        }), exc.status_code

    mail_result = send_demo_rejection_email(
        current_app.config,
        result.get("company_email"),
        result.get("company_name"),
        result.get("reason"),
    )

    demo_request = find_demo_request(db, request_id=request_id)
    if demo_request:
        db.demo_requests.update_one(
            {"_id": demo_request["_id"]},
            {
                "$set": {
                    "rejection_email_sent": bool(mail_result.get("ok")),
                    "rejection_email_result": mail_result,
                    "updated_at": now_utc(),
                }
            },
        )

    audit(
        "reject_demo_request",
        "demo_request",
        request_id,
        {
            "company_name": result.get("company_name"),
            "reason": result.get("reason"),
            "rejection_email_sent": bool(mail_result.get("ok")),
        },
    )

    return jsonify({
        "ok": True,
        "message": "Trial request rejected successfully.",
        "result": clean_doc(result),
        "rejection_email_sent": bool(mail_result.get("ok")),
        "mail_message": mail_result.get("message"),
    })