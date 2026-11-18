"""Attendance-only biometric API. Never accept a caller-supplied identity for a self scan."""

import json
import re
import secrets
from datetime import timedelta
from bson import ObjectId
from flask import Blueprint, current_app, g, jsonify, request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.wsgi import get_input_stream

from app.extensions import get_db
from app.middleware.tenant_guard import tenant_module_required
from app.routes.attendance import (
    active_employee_base_query,
    emp,
    employee_code,
    employee_display_name,
)
from app.routes.it_support import current_user_roles, is_it_head, truthy
from app.services import face_attendance as service
from app.services.face_vision import FaceError, check_pose, enroll
from app.utils.auth import employee_login_is_alumni

face_bp = Blueprint("face_attendance", __name__)
access_required = tenant_module_required("attendance")


def error_response(error):
    response = jsonify(message=str(error), code=error.code)
    response.status_code = error.status
    response.headers["Cache-Control"] = "no-store"
    return response


@face_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    return response


@face_bp.errorhandler(PyMongoError)
def unavailable(_):
    return error_response(
        FaceError(
            "Facial attendance is temporarily unavailable.", "FACE_UNAVAILABLE", 503
        )
    )


def body(limit=4096):
    if not request.is_json:
        raise FaceError("Send a JSON request.", "FACE_FORMAT", 415)
    if request.content_length is not None and request.content_length > limit:
        raise FaceError("Upload too large.", "FACE_SIZE", 413)
    try:
        raw = get_input_stream(request.environ, max_content_length=limit).read(
            limit + 1
        )
        if len(raw) > limit:
            raise RequestEntityTooLarge()
        data = json.loads(raw)
    except RequestEntityTooLarge:
        raise FaceError("Upload too large.", "FACE_SIZE", 413) from None
    except (ValueError, RecursionError, UnicodeError):
        raise FaceError("Invalid JSON.", "FACE_FORMAT", 400) from None
    if not isinstance(data, dict):
        raise FaceError("Expected a request object.", "FACE_FORMAT", 400)
    if data.get("tenant_id", g.tenant_id) != g.tenant_id:
        raise FaceError("Invalid organisation context.", "FACE_SCOPE", 403)
    return data


def enabled():
    if service.mode(g.tenant_id) == "off":
        raise FaceError(
            "Facial attendance is off for this organisation.", "FACE_OFF", 404
        )


def manager(db):
    if g.current_user.get("tenant_id") != g.tenant_id:
        return False
    if current_user_roles() & {
        "hr",
        "hr_admin",
        "hr_manager",
        "admin",
        "super_admin",
        "superadmin",
    }:
        return True
    employee = emp(db)
    if not employee or not is_it_head(employee):
        return False
    # Preserve the existing IT Head capability. Bound its implicit department match
    # to whole words so a team leader in e.g. "Audit" receives no biometric access.
    department = " ".join(
        str(employee.get(k) or "") for k in ("department", "department_id")
    ).replace("_", " ")
    if not truthy(employee.get("is_it_support_head")) and not re.search(
        r"\b(it|information technology|technology|tech|software|mis)\b",
        department,
        re.I,
    ):
        return False
    service.scope(employee, own=True)
    return True


def require_manager(db):
    enabled()
    if not manager(db):
        raise FaceError(
            "HR, Admin or IT Head access is required.", "FACE_PERMISSION", 403
        )


def target(db, eid):
    require_manager(db)
    row = None
    if ObjectId.is_valid(eid):
        row = db.employees.find_one(
            {**active_employee_base_query(g.tenant_id), "_id": ObjectId(eid)}
        )
    return service.scope(row)


def current(db, subject, data):
    row = service.profile(db, subject)
    if type(data.get("revision")) is not int or row["revision"] != data["revision"]:
        raise FaceError(
            "The employee record changed. Refresh and try again.", "FACE_CONFLICT", 409
        )
    return row


def settings_manager():
    # Only tenant HR/Admin may change a company-wide mandatory attendance
    # policy. IT heads may enroll staff but cannot enable enforcement.
    return (
        g.current_user.get("tenant_id") == g.tenant_id
        and bool(current_user_roles() & {
            "hr", "hr_admin", "hr_manager", "admin", "super_admin", "superadmin"
        })
    )


def require_settings_manager():
    if not settings_manager():
        raise FaceError("HR or Admin access is required.", "FACE_PERMISSION", 403)


def settings_response(db):
    tenant = g.tenant_id
    row = service.saved_settings(db, tenant)
    return {
        "tenant_id": tenant,
        "mode": service.mode(tenant, db),
        "revision": int(row.get("revision", 0)) if row else 0,
        "can_manage": True,
        "readiness": service.readiness(db, tenant),
        "message": "Changes apply immediately to web attendance and checkout.",
    }


@face_bp.get("/settings")
@access_required
def get_settings():
    require_settings_manager()
    return jsonify(settings_response(get_db()))


@face_bp.patch("/settings")
@access_required
def update_settings():
    require_settings_manager()
    data = body(4096)
    wanted, revision = data.get("mode"), data.get("revision")
    if wanted not in service.FACE_MODES or type(revision) is not int or revision < 0:
        raise FaceError("Invalid mode or revision.", "FACE_SETTINGS", 400)
    if wanted == "enforce" and data.get("confirm_enforcement") is not True:
        raise FaceError("Confirm mandatory camera verification.", "FACE_CONFIRM", 400)
    db = get_db()
    current = service.saved_settings(db, g.tenant_id)
    if revision != (current.get("revision", 0) if current else 0):
        raise FaceError("Settings changed. Refresh and retry.", "FACE_CONFLICT", 409)
    if wanted in ("prepare", "enforce"):
        try:
            service.ensure_activation_ready(db, enforce=(wanted == "enforce"))
        except (RuntimeError, ValueError, OSError) as exc:
            # Do not expose encryption material or local server file paths.
            current_app.logger.warning("Facial activation setup not ready: %s", type(exc).__name__)
            raise FaceError(
                "Face recognition is not configured on the server. Ask IT to configure "
                "the encryption key and OpenCV models before activating.",
                "FACE_SETUP", 503,
            ) from None
    if wanted == "enforce" and service.readiness(db, g.tenant_id)["registered"] < 1:
        raise FaceError(
            "Enroll at least one consenting employee before requiring camera verification.",
            "FACE_NOT_READY", 409,
        )

    instant = service.now()
    user = g.current_user
    record = {
        "tenant_id": g.tenant_id,
        "setting_group": service.FACE_SETTING_GROUP,
        "setting_key": service.FACE_SETTING_KEY,
        "mode": wanted,
        "is_deleted": False,
        "updated_at": instant,
        "updated_by": str(user.get("_id") or ""),
        "updated_by_name": str(user.get("name") or user.get("email") or ""),
        "revision": revision + 1,
    }
    query = {"_id": service.settings_id(g.tenant_id), "tenant_id": g.tenant_id}
    try:
        if not current:
            db.system_settings.insert_one({
                "_id": query["_id"], **record,
                "created_at": instant,
                "created_by": record["updated_by"],
            })
        else:
            changed = db.system_settings.update_one(
                {**query, "revision": revision}, {"$set": record}
            )
            if changed.matched_count != 1:
                raise FaceError("Settings changed. Refresh and retry.", "FACE_CONFLICT", 409)
    except DuplicateKeyError:
        raise FaceError("Settings changed. Refresh and retry.", "FACE_CONFLICT", 409) from None
    service.audit(db, {"tenant_id": g.tenant_id, "employee_id": "__policy__"},
                  "mode_change", previous=service.mode_from_record(current, g.tenant_id), mode=wanted)
    return jsonify(settings_response(db))


@face_bp.get("/access")
@access_required
def access():
    db, policy = get_db(), service.mode(g.tenant_id)
    employee, row = emp(db), {}
    if employee:
        try:
            subject = service.scope(employee, own=True)
        except FaceError:
            subject = None
        if subject:
            row = service.profile(db, subject)
    return jsonify(
        mode=policy,
        can_manage=policy != "off" and manager(db),
        show_privacy=bool(row and (policy != "off" or row["revision"])),
        mine=service.summary(row) if row else None,
        notice_version=service.NOTICE,
        retention_days=service.retention(),
        audit_days=service.AUDIT_DAYS,
    )


@face_bp.post("/consent")
@access_required
def consent():
    db, data = get_db(), body()
    subject = service.scope(emp(db), own=True)
    row = current(db, subject, data)
    if data.get("decision") == "withdraw":
        if row["revision"]:
            row = service.revoke(db, subject, row, True)
    elif (
        data.get("decision") == "accept"
        and data.get("notice_version") == service.NOTICE
    ):
        enabled()
        uid = str(g.current_user["_id"])
        if row.get("notice") != service.NOTICE or row.get("consented_by") != uid:
            old = row.get("template_id")
            row = service.change(
                db,
                row,
                "consent",
                {
                    "notice": service.NOTICE,
                    "consented_by": uid,
                    "consented_at": service.now(),
                    "consent_retention_days": service.retention(),
                },
                ("template_id", "valid_until", "model"),
                notice_version=service.NOTICE,
                retention_days=service.retention(),
            )
            if old:
                db.face_vectors.delete_one({**subject, "_id": old})
    else:
        raise FaceError(
            "Read the current notice and select your choice.", "FACE_NOTICE", 400
        )
    return jsonify(mine=service.summary(row))


@face_bp.post("/self-enroll/check-view")
@access_required
def check_self_enrollment_view():
    """Validate one guided view before moving to the next step.

    This is advisory and stateless. /self-enroll independently revalidates all
    four frames and the reference image; a client cannot skip a pose check.
    """
    db = get_db()
    enabled()
    subject = service.scope(emp(db), own=True)
    service.limit(db, subject, "self_view", 120)
    data = body(3_700_000)
    row = service.profile(db, subject)
    if row.get("notice") != service.NOTICE or row.get("consented_by") != str(g.current_user["_id"]):
        raise FaceError("Accept the biometric notice first.", "FACE_CONSENT", 409)
    if row.get("pending_id") and (row.get("pending_expires") or service.now()) > service.now():
        raise FaceError("Enrollment already awaiting approval.", "FACE_PENDING", 409)
    index = data.get("index")
    if type(index) is not int or index not in (0, 1, 2, 3):
        raise FaceError("Invalid registration step.", "FACE_STEP", 400)
    reference, frame, baseline_photo = data.get("reference"), data.get("frame"), data.get("baseline")
    if not isinstance(reference, str) or not isinstance(frame, str):
        raise FaceError("Camera images are missing.", "FACE_CAPTURE", 400)
    if index and not isinstance(baseline_photo, str):
        raise FaceError("First complete the straight-ahead view.", "FACE_STEP", 400)
    vision = service.vision()
    ref = vision.observe(reference)
    candidate = vision.observe(frame)
    baseline = None
    if index:
        initial = vision.observe(baseline_photo)
        check_pose(initial, "center", None)
        baseline = {"x": initial.center[0], "y": initial.center[1],
                    "size": initial.size, "yaw": initial.yaw}
    prompt = ("center", "left", "right", "center")[index]
    check_pose(candidate, prompt, baseline if index in (1, 2) else None)
    if float(ref.embedding @ candidate.embedding) < service.threshold():
        raise FaceError("Your face does not match the verification photograph. Keep the same employee in front of the camera.", "FACE_NO_MATCH", 403)
    return jsonify(valid=True, index=index, prompt=prompt)


@face_bp.post("/self-enroll")
@access_required
def self_enroll():
    """Employee-directed guided capture. Never activates a template without review."""
    db = get_db()
    enabled()
    subject = service.scope(emp(db), own=True)
    service.limit(db, subject, "self_enroll", 4)
    data = body(14_100_000)
    row = current(db, subject, data)
    if row.get("notice") != service.NOTICE or row.get("consented_by") != str(g.current_user["_id"]):
        raise FaceError("Accept the biometric notice in your own login first.", "FACE_CONSENT", 409)
    if row.get("pending_id"):
        if (row.get("pending_expires") or service.now()) > service.now():
            raise FaceError("Your previous enrollment is awaiting review.", "FACE_PENDING", 409)
        db.face_pending.delete_many(subject)
        row = service.change(db, row, "self_enrollment_expired", {}, ("pending_id", "pending_expires"))
    photos = data.get("frames")
    reference = data.get("reference")
    if not isinstance(photos, list) or len(photos) != 4 or not isinstance(reference, str):
        raise FaceError("Capture the reference photograph and four guided views.", "FACE_CAPTURE", 400)
    vision = service.vision()
    ref = vision.observe(reference)
    views = [vision.observe(f) for f in photos]
    from app.services.face_vision import check_pose, enroll
    baseline = {"x": views[0].center[0], "y": views[0].center[1],
                "size": views[0].size, "yaw": views[0].yaw}
    for view, prompt in zip(views, ("center", "left", "right", "center")):
        check_pose(view, prompt, None if prompt == "center" else baseline)
        if float(ref.embedding @ view.embedding) < service.threshold():
            raise FaceError("Verification photo and live registration do not match.", "FACE_NO_MATCH", 403)
    # Different camera poses are required, not repeated identical frames.
    template = enroll(photos, vision, service.threshold())
    ident = ObjectId()
    expires = service.now() + timedelta(days=14)
    pending = {**subject, "_id": ident, "created_at": service.now(), "expires": expires,
               "template": service.seal(template, service.binding(subject, ident, "pending-template")),
               "reference": service.seal(reference.encode("ascii"), service.binding(subject, ident, "pending-reference"))}
    db.face_pending.replace_one(subject, pending, upsert=True)
    try:
        row = service.change(db, row, "self_enrollment_submitted", {"pending_id": ident, "pending_expires": expires},
                             capture_count=len(photos))
    except FaceError:
        db.face_pending.delete_one({**subject, "_id": ident})
        raise
    return jsonify(mine=service.summary(row))


@face_bp.get("/employees/<eid>/pending")
@access_required
def pending_details(eid):
    db = get_db()
    subject = target(db, eid)
    row = service.profile(db, subject)
    pending = db.face_pending.find_one({**subject, "_id": row.get("pending_id")}) if row.get("pending_id") else None
    if not pending or pending["expires"] <= service.now():
        raise FaceError("There is no active enrollment request.", "FACE_PENDING", 404)
    photo = service.unseal(pending["reference"], service.binding(subject, pending["_id"], "pending-reference")).decode("ascii")
    return jsonify(reference="data:image/jpeg;base64," + photo, revision=row["revision"],
                   submitted_at=pending["created_at"].isoformat() + "Z")


@face_bp.post("/employees/<eid>/review")
@access_required
def review_enrollment(eid):
    db = get_db()
    subject = target(db, eid)
    service.limit(db, subject, "review", 12)
    data = body()
    row = current(db, subject, data)
    pending = db.face_pending.find_one({**subject, "_id": row.get("pending_id")}) if row.get("pending_id") else None
    if not pending or pending["expires"] <= service.now():
        raise FaceError("Pending registration expired. Ask the employee to register again.", "FACE_PENDING", 409)
    employee = emp(db)
    if employee and str(employee["_id"]) == eid:
        raise FaceError("You cannot approve your own enrollment.", "FACE_SELF_APPROVAL", 403)
    decision = data.get("decision")
    if decision == "reject":
        reason = str(data.get("reason") or "").strip()
        if not 5 <= len(reason) <= 250:
            raise FaceError("Provide a rejection reason (5–250 characters).", "FACE_REASON", 400)
        row = service.change(db, row, "self_enrollment_rejected", {}, ("pending_id", "pending_expires"), reason=reason)
    elif decision == "approve":
        template = service.unseal(pending["template"], service.binding(subject, pending["_id"], "pending-template"))
        # Only a verified reviewer may activate the employee template.
        row = service.store_template(db, subject, row, template, 4)
        service.audit(db, subject, "self_enrollment_approved", reviewer=str(g.current_user["_id"]))
    else:
        raise FaceError("Choose approve or reject.", "FACE_DECISION", 400)
    db.face_pending.delete_one({**subject, "_id": pending["_id"]})
    return jsonify(record=service.summary(row))


@face_bp.get("/employees")
@access_required
def employees():
    db = get_db()
    require_manager(db)
    if request.args.get("tenant_id", g.tenant_id) != g.tenant_id:
        raise FaceError("Search is restricted to your organisation.", "FACE_SCOPE", 403)
    query = {**active_employee_base_query(g.tenant_id), "is_active": {"$ne": False}}
    search, after = request.args.get("q", "").strip(), request.args.get("after", "")
    if len(search) > 100 or (after and not ObjectId.is_valid(after)):
        raise FaceError("Invalid search or page.", "FACE_SEARCH", 400)
    if search:
        term = re.compile(re.escape(search), re.I)
        query["$or"] = [
            {k: term}
            for k in (
                "name",
                "employee_name",
                "full_name",
                "employee_id",
                "employee_code",
                "emp_code",
                "email",
            )
        ]
    if after:
        query["_id"] = {"$gt": ObjectId(after)}
    fields = {
        k: 1
        for k in (
            "name",
            "employee_name",
            "full_name",
            "employee_id",
            "employee_code",
            "emp_code",
            "code",
            "email",
            "department",
            "status",
            "is_alumni",
            "employment_status",
            "employee_status",
            "notice_status",
            "last_working_day",
        )
    }
    batch = list(db.employees.find(query, fields).sort("_id", 1).limit(26))
    visible = [e for e in batch[:25] if not employee_login_is_alumni(e)]
    rows = {
        r["employee_id"]: r
        for r in db.face_profiles.find(
            {
                "tenant_id": g.tenant_id,
                "employee_id": {"$in": [str(e["_id"]) for e in visible]},
            },
            {"proofs": 0},
        )
    }
    return jsonify(
        roster=[
            {
                "id": str(e["_id"]),
                "name": employee_display_name(e),
                "code": employee_code(e),
                "department": e.get("department") or "",
                **service.summary(rows.get(str(e["_id"]), {"revision": 0})),
            }
            for e in visible
        ],
        next_after=str(batch[24]["_id"]) if len(batch) > 25 else None,
    )


@face_bp.post("/employees/<eid>/enroll")
@access_required
def register(eid):
    db = get_db()
    subject = target(db, eid)
    service.limit(db, subject, "enroll", 10)
    own = emp(db)
    if own and str(own.get("_id")) == eid:
        raise FaceError("You cannot approve your own face registration.", "FACE_SELF_APPROVAL", 403)
    data = body(14_100_000)
    row = current(db, subject, data)
    if row.get("notice") != service.NOTICE or not row.get("consent_retention_days"):
        raise FaceError(
            "Ask the employee to accept the current notice first.", "FACE_CONSENT", 409
        )
    samples = data.get("photos")
    template = enroll(samples, service.vision(), service.threshold())
    return jsonify(
        record=service.summary(
            service.store_template(db, subject, row, template, len(samples))
        )
    )


@face_bp.post("/employees/<eid>/revoke")
@access_required
def revoke(eid):
    db = get_db()
    subject = target(db, eid)
    return jsonify(
        record=service.summary(
            service.revoke(db, subject, current(db, subject, body()))
        )
    )


@face_bp.post("/employees/<eid>/exception")
@access_required
def exception(eid):
    db = get_db()
    subject = target(db, eid)
    data = body()
    row = current(db, subject, data)
    if data.get("decision") == "end":
        row = service.change(
            db, row, "exception_end", {}, ("exception_until", "exception_event")
        )
    else:
        own = emp(db)
        if own and str(own["_id"]) == eid:
            raise FaceError(
                "Another manager must approve your exception.",
                "FACE_SELF_APPROVAL",
                403,
            )
        days, category, reference = (
            data.get("days"),
            data.get("category"),
            data.get("reference"),
        )
        if (
            data.get("decision") != "grant"
            or type(days) is not int
            or not 1 <= days <= 30
            or category not in ("accessibility", "device", "temporary")
            or not isinstance(reference, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9./_-]{2,63}", reference)
        ):
            raise FaceError(
                "Choose a reason, a case reference and 1–30 days.",
                "FACE_EXCEPTION",
                400,
            )
        until = service.now() + timedelta(days=days)
        row = service.change(
            db,
            row,
            "exception_grant",
            {"exception_until": until},
            category=category,
            reference=reference,
            until=until,
        )
    return jsonify(record=service.summary(row))


@face_bp.get("/employees/<eid>/history")
@access_required
def history(eid):
    db = get_db()
    subject = target(db, eid)
    fields = {
        k: 1
        for k in (
            "action",
            "actor_id",
            "at",
            "outcome",
            "category",
            "reference",
            "attendance_action",
        )
    }
    entries = list(
        db.face_audit.find(subject, {**fields, "_id": 0}).sort("at", -1).limit(20)
    )
    for e in entries:
        e["at"] = e["at"].isoformat(timespec="seconds") + "Z"
    return jsonify(events=entries)


def challenge_subject():
    enabled()
    db = get_db()
    subject = service.scope(emp(db), own=True)
    row = service.profile(db, subject)
    service.ensure_registered(row)
    return db, subject, row


def key_for(subject, token):
    if not isinstance(token, str) or not 32 <= len(token) <= 75:
        raise FaceError("Start a new scan.", "FACE_CHALLENGE", 409)
    return {
        **subject,
        "_id": service.digest(token),
        "user_id": str(g.current_user["_id"]),
    }


@face_bp.post("/challenge")
@access_required
def challenge():
    db, subject, row = challenge_subject()
    action = body().get("action")
    if action not in service.ACTIONS:
        raise FaceError("Select check-in or check-out.", "FACE_ACTION", 400)
    service.limit(db, subject, "challenge", 8)
    token, instant = secrets.token_urlsafe(32), service.now()
    db.face_challenges.insert_one(
        {
            **key_for(subject, token),
            "action": action,
            "revision": row["revision"],
            "template_id": row["template_id"],
            "step": 0,
            "prompt": "center",
            "tries": 0,
            "busy": False,
            "next_at": instant,
            "expires": instant + timedelta(seconds=90),
        }
    )
    return jsonify(challenge=token, step=0, prompt="center")


@face_bp.post("/frame")
@access_required
def frame():
    db, subject, row = challenge_subject()
    data = body(2_800_000)
    step, instant = data.get("step"), service.now()
    if type(step) is not int or not 0 <= step <= 2:
        raise FaceError("Start a new scan.", "FACE_CHALLENGE", 409)
    key = key_for(subject, data.get("challenge"))
    claim = {
        **key,
        "step": step,
        "revision": row["revision"],
        "template_id": row["template_id"],
        "tries": {"$lt": 22},
        "expires": {"$gt": instant},
        "next_at": {"$lte": instant},
        "busy": False,
    }
    session = db.face_challenges.find_one_and_update(
        claim, {"$set": {"busy": True}, "$inc": {"tries": 1}}
    )
    if not session:
        raise FaceError(
            "The scan expired or changed. Start again.", "FACE_CHALLENGE", 409
        )
    aad = service.binding(subject, key["_id"], "pose")
    try:
        observed = service.vision().observe(data.get("frame"))
        if (
            float(observed.embedding @ service.load_template(db, subject, row))
            < service.threshold()
        ):
            db.face_challenges.delete_one(key)
            service.audit(
                db, subject, "verification_failed", attendance_action=session["action"]
            )
            raise FaceError(
                "Your face did not match. Try again in even lighting.",
                "FACE_NO_MATCH",
                403,
            )
        base = (
            json.loads(service.unseal(session["base"], aad))
            if session.get("base")
            else None
        )
        check_pose(observed, session["prompt"], base)
    except FaceError:
        db.face_challenges.update_one(
            key,
            {
                "$set": {
                    "busy": False,
                    "next_at": service.now() + timedelta(milliseconds=550),
                }
            },
        )
        raise
    alive = {**key, "expires": {"$gt": service.now()}}
    if step < 2:
        prompt = (
            secrets.choice(("left", "right"))
            if step == 0
            else secrets.choice(
                ("center", "right" if session["prompt"] == "left" else "left")
            )
        )
        update = {
            "prompt": prompt,
            "step": step + 1,
            "busy": False,
            "next_at": service.now() + timedelta(milliseconds=650),
        }
        if step == 0:
            value = {
                "x": observed.center[0],
                "y": observed.center[1],
                "size": observed.size,
                "yaw": observed.yaw,
            }
            update["base"] = service.seal(json.dumps(value).encode(), aad)
        if not db.face_challenges.update_one(alive, {"$set": update}).matched_count:
            raise FaceError("Start a new scan.", "FACE_CHALLENGE", 409)
        return jsonify(step=step + 1, prompt=prompt)
    if not db.face_challenges.delete_one(alive).deleted_count:
        raise FaceError("The scan expired.", "FACE_CHALLENGE", 409)
    proof = secrets.token_urlsafe(32)
    slot = "proofs." + session["action"]
    issued = db.face_profiles.update_one(
        {
            **subject,
            "revision": row["revision"],
            "template_id": row["template_id"],
            "valid_until": {"$gt": service.now()},
        },
        {
            "$set": {
                slot: {
                    "digest": service.digest(proof),
                    "expires": service.now() + timedelta(seconds=45),
                    "user_id": str(g.current_user["_id"]),
                }
            }
        },
    )
    if not issued.matched_count:
        raise FaceError("Enrollment changed. Start a new scan.", "FACE_CONFLICT", 409)
    return jsonify(proof=proof, expires_in=45)


@face_bp.post("/cancel")
@access_required
def cancel():
    db = get_db()
    db.face_challenges.delete_one(
        key_for(service.scope(emp(db), own=True), body().get("challenge"))
    )
    return "", 204
