"""Tenant policy, encrypted templates, lifecycle, exceptions and single-use proofs."""

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from flask import current_app, g
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from app.services.face_vision import FaceError, MODEL_DIR, MODEL_VERSION, engine
from app.utils.auth import employee_login_is_alumni

NOTICE = "yc-attendance-v1"
ACTIONS = ("check-in", "check-out")
AUDIT_DAYS = 365


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def setting(name, default=None):
    return current_app.config.get(name, os.environ.get(name, default))


def tenants(key):
    return {s.strip() for s in str(setting(key, "")).split(",") if s.strip()}


# Mode is now persisted per tenant. Explicit database settings override legacy
# environment lists, including when the chosen setting is OFF.
FACE_SETTING_GROUP = "face_attendance"
FACE_SETTING_KEY = "verification_mode"
FACE_MODES = ("off", "prepare", "enforce")


def settings_id(tenant):
    tenant = str(tenant or "").strip()
    if not tenant:
        raise ValueError("Organisation is required")
    return "face-attendance:" + tenant


def saved_settings(db, tenant):
    return db.system_settings.find_one({
        "_id": settings_id(tenant),
        "tenant_id": str(tenant),
        "setting_group": FACE_SETTING_GROUP,
        "setting_key": FACE_SETTING_KEY,
        "is_deleted": {"$ne": True},
    })


def mode_from_record(row, tenant):
    if row is not None:
        stored = row.get("mode")
        if stored not in FACE_MODES:
            raise RuntimeError("Invalid facial attendance tenant policy")
        return stored
    if tenant in tenants("FACE_ATTENDANCE_ENFORCE_TENANTS"):
        return "enforce"
    return "prepare" if tenant in tenants("FACE_ATTENDANCE_PREPARE_TENANTS") else "off"


def mode(tenant, db=None):
    # A read per request is intentional: check-in/checkout and Eve must observe
    # a policy change immediately without a web-server restart or stale cache.
    if db is None:
        from app.extensions import get_db
        db = get_db()
    return mode_from_record(saved_settings(db, tenant), tenant)


def readiness(db, tenant):
    instant = now()
    registered = db.face_profiles.count_documents({
        "tenant_id": tenant,
        "notice": NOTICE,
        "model": MODEL_VERSION,
        "template_id": {"$exists": True, "$ne": None},
        "valid_until": {"$gt": instant},
    })
    exceptions = db.face_profiles.count_documents({
        "tenant_id": tenant,
        "exception_until": {"$gt": instant},
    })
    return {"registered": registered, "temporary_exceptions": exceptions}


def ensure_activation_ready(db, enforce=False):
    """Fail safely BEFORE enabling enrollment or enforcing attendance."""
    keyring()
    retention()
    threshold()
    vision()
    db.face_profiles.create_index([("tenant_id", 1), ("employee_id", 1)], unique=True)
    for name in ("face_challenges", "face_vectors", "face_audit", "face_limits"):
        db[name].create_index("expires", expireAfterSeconds=0)
    db.face_audit.create_index([("tenant_id", 1), ("employee_id", 1), ("at", -1)])
    db.face_pending.create_index([("tenant_id", 1), ("employee_id", 1)], unique=True)
    db.face_pending.create_index("expires", expireAfterSeconds=0)
    if enforce:
        db.attendance_logs.create_index(
            [("tenant_id", 1), ("employee_id", 1), ("date", 1)], unique=True
        )


def retention():
    days = int(setting("FACE_ATTENDANCE_RETENTION_DAYS", 180))
    if not 1 <= days <= 365:
        raise ValueError("Face retention must be between 1 and 365 days.")
    return days


def threshold():
    score = float(setting("FACE_ATTENDANCE_MATCH_THRESHOLD", 0.50))
    if not 0.363 <= score <= 0.90:
        raise ValueError("Face matching threshold must be between 0.363 and 0.90.")
    return score


def vision():
    return engine(str(setting("FACE_ATTENDANCE_MODEL_DIR", MODEL_DIR)))


def keyring():
    try:
        current = setting("FACE_ATTENDANCE_KEY_ID", "")
        keys = {
            k: base64.b64decode(v, validate=True)
            for k, v in json.loads(setting("FACE_ATTENDANCE_KEYS", "{}")).items()
        }
        if (
            not current
            or current not in keys
            or any(len(value) != 32 for value in keys.values())
        ):
            raise ValueError()
        return current, keys
    except (TypeError, ValueError, AttributeError):
        raise RuntimeError(
            "Configure the facial attendance AES-256 key ring and active key ID."
        ) from None


def initialize(db):
    if not (
        tenants("FACE_ATTENDANCE_PREPARE_TENANTS")
        | tenants("FACE_ATTENDANCE_ENFORCE_TENANTS")
    ):
        return
    ensure_activation_ready(db, bool(tenants("FACE_ATTENDANCE_ENFORCE_TENANTS")))


def scope(employee, own=False):
    if (
        not employee
        or g.current_user.get("tenant_id") != g.tenant_id
        or employee.get("tenant_id") != g.tenant_id
        or employee.get("is_active") is False
        or employee_login_is_alumni(employee)
    ):
        raise FaceError("Active employee profile not found.", "FACE_EMPLOYEE", 404)
    eid = str(employee["_id"])
    if own:
        linked = str(employee.get("user_id") or "")
        user = g.current_user
        if (linked and linked != str(user["_id"])) or (
            not linked
            and eid
            not in {str(user.get("employee_id")), str(user.get("employee_ref_id"))}
        ):
            raise FaceError(
                "Ask HR to confirm the link between your login and employee record.",
                "FACE_IDENTITY",
                409,
            )
    return {"tenant_id": g.tenant_id, "employee_id": eid}


def profile(db, subject):
    return db.face_profiles.find_one(subject, {"proofs": 0}) or {
        **subject,
        "revision": 0,
    }


def exceptional(record):
    return (record.get("exception_until") or datetime.min) > now()


def summary(record):
    status = "Not Registered"
    if record.get("template_id"):
        valid = (record.get("valid_until") or datetime.min) > now() and record.get(
            "model"
        ) == MODEL_VERSION
        status = "Registered" if valid else "Needs Retraining"

    def iso(key):
        value = record.get(key)
        return value.isoformat(timespec="seconds") + "Z" if value else None

    if record.get("pending_id") and (record.get("pending_expires") or datetime.min) > now() and status != "Registered":
        status = "Pending Approval"
    approved = bool(record.get("approved", bool(record.get("template_id"))) and status == "Registered")
    return {
        "revision": record["revision"],
        "status": status,
        "approved": approved,
        "approval_status": "approved" if approved else ("pending" if record.get("pending_id") and (record.get("pending_expires") or datetime.min) > now() else ("rejected" if record.get("rejection_reason") else "none")),
        "consented": record.get("notice") == NOTICE,
        "rejection_reason": str(record.get("rejection_reason") or "")[:250] if not approved else "",
        "valid_until": iso("valid_until"),
        "exception_until": iso("exception_until") if exceptional(record) else None,
    }


def audit(db, subject, action, **details):
    instant = now()
    return db.face_audit.insert_one(
        {
            **subject,
            "actor_id": str(g.current_user["_id"]),
            "action": action,
            "at": instant,
            "expires": instant + timedelta(days=AUDIT_DAYS),
            **details,
        }
    ).inserted_id


def change(db, record, action, fields, remove=(), **details):
    subject = {k: record[k] for k in ("tenant_id", "employee_id")}
    revision = record["revision"]
    event = audit(
        db, subject, action, revision=revision + 1, outcome="requested", **details
    )
    if action == "exception_grant":
        fields = {**fields, "exception_event": event}
    update = {
        "$set": {**fields, "last_event": event},
        "$inc": {"revision": 1},
        "$unset": {k: "" for k in ("proofs", *remove)},
    }
    try:
        row = db.face_profiles.find_one_and_update(
            {**subject, "revision": revision},
            update,
            upsert=revision == 0,
            return_document=ReturnDocument.AFTER,
            projection={"proofs": 0},
        )
    except DuplicateKeyError:
        row = None
    db.face_audit.update_one(
        {**subject, "_id": event},
        {"$set": {"outcome": "applied" if row else "conflict"}},
    )
    if not row:
        raise FaceError(
            "The record changed. Refresh and try again.", "FACE_CONFLICT", 409
        )
    return row


def binding(subject, ident, purpose):
    return json.dumps(
        [
            subject["tenant_id"],
            subject["employee_id"],
            str(ident),
            MODEL_VERSION,
            purpose,
        ],
        separators=(",", ":"),
    ).encode()


def seal(data, aad):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key, ring = keyring()
    nonce = secrets.token_bytes(12)
    return {
        "key_id": key,
        "nonce": nonce,
        "ciphertext": AESGCM(ring[key]).encrypt(nonce, data, aad),
    }


def unseal(record, aad):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    _, ring = keyring()
    try:
        return AESGCM(ring[record["key_id"]]).decrypt(
            record["nonce"], record["ciphertext"], aad
        )
    except Exception:
        current_app.logger.error(
            "Facial data could not be opened. Check key configuration and integrity."
        )
        raise FaceError(
            "Verification is temporarily unavailable. Contact HR.",
            "FACE_UNAVAILABLE",
            503,
        ) from None


def store_template(db, subject, record, data, count):
    ident = ObjectId()
    expires = now() + timedelta(days=min(retention(), record["consent_retention_days"]))
    db.face_vectors.insert_one(
        {
            **subject,
            "_id": ident,
            "created_at": now(),
            "expires": expires,
            **seal(data, binding(subject, ident, "embedding")),
        }
    )
    try:
        row = change(
            db,
            record,
            "retrain" if record.get("template_id") else "enroll",
            {"template_id": ident, "valid_until": expires, "model": MODEL_VERSION,
             "approved": True, "approved_by": str(g.current_user["_id"]),
             "approved_at": now()},
            ("pending_id", "pending_expires", "rejection_reason"), photo_count=count,
        )
    except FaceError:
        db.face_vectors.delete_one({**subject, "_id": ident})
        raise
    if record.get("template_id"):
        db.face_vectors.delete_one({**subject, "_id": record["template_id"]})
    db.face_pending.delete_many(subject)
    return row


def load_template(db, subject, record):
    import numpy as np

    ident = record["template_id"]
    vector = db.face_vectors.find_one(
        {**subject, "_id": ident, "expires": {"$gt": now()}}
    )
    if not vector:
        raise FaceError("Contact HR to renew your enrollment.", "FACE_ENROLLMENT", 409)
    array = np.frombuffer(
        unseal(vector, binding(subject, ident, "embedding")), dtype="<f4"
    )
    if array.size != 128 or not np.isfinite(array).all():
        raise FaceError("Your enrollment needs updating.", "FACE_ENROLLMENT", 409)
    return array


def revoke(db, subject, record, withdraw=False):
    remove = ["template_id", "valid_until", "model", "approved", "approved_by", "approved_at", "pending_id", "pending_expires"]
    if withdraw:
        remove += ["notice", "consented_at", "consented_by", "consent_retention_days"]
    row = change(db, record, "withdraw" if withdraw else "revoke", {}, remove)
    db.face_pending.delete_many(subject)
    db.face_challenges.delete_many(
        {**subject, "revision": {"$lte": record["revision"]}}
    )
    if record.get("template_id"):
        db.face_vectors.delete_one({**subject, "_id": record["template_id"]})
    return row


def digest(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def limit(db, subject, label, maximum):
    at = now()
    bucket = int(at.replace(tzinfo=timezone.utc).timestamp()) // 300
    key = digest(
        json.dumps(
            [
                subject["tenant_id"],
                subject["employee_id"],
                str(g.current_user["_id"]),
                label,
                bucket,
            ]
        )
    )
    query = {"_id": key}
    update = {
        "$inc": {"count": 1},
        "$setOnInsert": {"expires": at + timedelta(minutes=10)},
    }
    try:
        row = db.face_limits.find_one_and_update(
            query, update, upsert=True, return_document=ReturnDocument.AFTER
        )
    except DuplicateKeyError:
        row = db.face_limits.find_one_and_update(
            query, {"$inc": {"count": 1}}, return_document=ReturnDocument.AFTER
        )
    if row["count"] > maximum:
        raise FaceError(
            "Too many attempts. Wait a few minutes before trying again.",
            "FACE_RATE_LIMIT",
            429,
        )


def ensure_registered(row):
    if row.get("notice") != NOTICE or row.get("consented_by") != str(
        g.current_user["_id"]
    ):
        raise FaceError(
            "Open Facial attendance privacy in Attendance, record your choice, then contact HR.",
            "FACE_CONSENT",
            409,
        )
    if not summary(row)["approved"]:
        raise FaceError(
            "Your facial enrollment must be approved by HR, Admin or IT Head.",
            "FACE_ENROLLMENT",
            409,
        )


def policy(db, employee):
    state = mode(g.tenant_id)
    return {
        "mode": state,
        "requires_camera": state == "enforce"
        and not exceptional(profile(db, scope(employee))),
    }


def check_submission(db, employee, data):
    if mode(g.tenant_id) != "enforce":
        return
    subject = scope(employee, own=True)
    if str(data.get("created_offline", "")).lower().strip() in {
        "1",
        "on",
        "true",
        "yes",
    } or data.get("offline_marked_at"):
        raise FaceError(
            "Retain this offline entry for HR review. Online verification is required.",
            "FACE_OFFLINE_REVIEW",
            409,
        )
    if not data.get("face_proof") and not exceptional(profile(db, subject)):
        raise FaceError(
            "Open Attendance and verify your face.", "FACE_PROOF_REQUIRED", 428
        )


def consume(db, employee, data, action):
    if mode(g.tenant_id) != "enforce":
        return None
    subject, instant = scope(employee, own=True), now()
    token = data.get("face_proof")
    if token:
        slot = "proofs." + action
        if not isinstance(token, str) or len(token) > 100:
            raise FaceError("Please scan again.", "FACE_PROOF_INVALID", 403)
        query = {
            **subject,
            "notice": NOTICE,
            "consented_by": str(g.current_user["_id"]),
            "model": MODEL_VERSION,
            "$or": [{"approved": True}, {"approved": {"$exists": False}}],
            "valid_until": {"$gt": instant},
            slot + ".digest": digest(token),
            slot + ".expires": {"$gt": instant},
            slot + ".user_id": str(g.current_user["_id"]),
        }
        if (
            db.face_profiles.update_one(query, {"$unset": {slot: ""}}).matched_count
            != 1
        ):
            raise FaceError(
                "Verification expired or was used. Please scan again.",
                "FACE_PROOF_INVALID",
                403,
            )
        return "face"
    approval = db.face_profiles.find_one(
        {**subject, "exception_until": {"$gt": instant}}, {"exception_event": 1}
    )
    if not approval:
        raise FaceError(
            "Verify your face before continuing.", "FACE_PROOF_REQUIRED", 428
        )
    audit(
        db,
        subject,
        "exception_use",
        attendance_action=action,
        approval=approval["exception_event"],
    )
    return "approved_exception"


def check_assistant_policy(tenant_id):
    if (
        mode(tenant_id) == "enforce"
        or mode(getattr(g, "tenant_id", tenant_id)) == "enforce"
    ):
        raise RuntimeError(
            "Open the Attendance screen and use Check In or Check Out to complete verification."
        )
