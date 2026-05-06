from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

from app.extensions import get_db
from app.utils.auth import current_user_required, roles_required, audit
from app.utils.serializers import clean_doc


password_requests_bp = Blueprint("password_requests", __name__)


def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


@password_requests_bp.post("/password-requests")
@current_user_required
def request_password_change():
    db = get_db()
    data = request.get_json(silent=True) or {}

    current_password = data.get("current_password") or ""
    new_password = data.get("new_password") or ""

    if not current_password or not new_password:
        return jsonify({
            "message": "Current password and new password are required"
        }), 400

    if len(new_password) < 6:
        return jsonify({
            "message": "New password must be at least 6 characters"
        }), 400

    user_obj_id = safe_object_id(g.current_user.get("_id"))

    if not user_obj_id:
        return jsonify({"message": "Invalid current user"}), 400

    user = db.users.find_one({"_id": user_obj_id})

    if not user:
        return jsonify({"message": "User not found"}), 404

    if not check_password_hash(user.get("password_hash", ""), current_password):
        return jsonify({"message": "Current password is incorrect"}), 400

    if check_password_hash(user.get("password_hash", ""), new_password):
        return jsonify({
            "message": "New password cannot be the same as current password"
        }), 400

    existing = db.password_requests.find_one({
        "user_id": str(user["_id"]),
        "status": "pending",
    })

    if existing:
        return jsonify({
            "message": "You already have a pending password change request"
        }), 409

    doc = {
        "tenant_id": user.get("tenant_id"),
        "user_id": str(user["_id"]),
        "user_name": user.get("name"),
        "user_email": user.get("email"),
        "new_password_hash": generate_password_hash(new_password),
        "status": "pending",
        "created_at": datetime.utcnow(),
        "created_by": str(user["_id"]),
    }

    res = db.password_requests.insert_one(doc)

    audit("request_password_change", "password_requests", res.inserted_id)

    return jsonify({
        "message": "Password change request sent to Super Admin"
    }), 201


@password_requests_bp.get("/password-requests")
@roles_required("super_admin")
def list_password_requests():
    db = get_db()
    status = (request.args.get("status") or "pending").strip().lower()

    q = {}

    if status != "all":
      q["status"] = status

    rows = list(
        db.password_requests
        .find(q)
        .sort("created_at", -1)
        .limit(500)
    )

    return jsonify({"items": clean_doc(rows)})


@password_requests_bp.post("/password-requests/<request_id>/approve")
@roles_required("super_admin")
def approve_password_request(request_id):
    request_obj_id = safe_object_id(request_id)

    if not request_obj_id:
        return jsonify({"message": "Invalid password request id"}), 400

    db = get_db()

    req = db.password_requests.find_one({
        "_id": request_obj_id,
        "status": "pending",
    })

    if not req:
        return jsonify({"message": "Pending request not found"}), 404

    user_obj_id = safe_object_id(req.get("user_id"))

    if not user_obj_id:
        return jsonify({"message": "Invalid user id in password request"}), 400

    user = db.users.find_one({"_id": user_obj_id})

    if not user:
        return jsonify({"message": "User not found for this request"}), 404

    db.users.update_one(
        {"_id": user_obj_id},
        {
            "$set": {
                "password_hash": req["new_password_hash"],
                "updated_at": datetime.utcnow(),
                "updated_by": str(g.current_user["_id"]),
            }
        },
    )

    db.password_requests.update_one(
        {"_id": request_obj_id},
        {
            "$set": {
                "status": "approved",
                "approved_at": datetime.utcnow(),
                "approved_by": str(g.current_user["_id"]),
                "approved_by_name": g.current_user.get("name") or g.current_user.get("email"),
            }
        },
    )

    audit("approve_password_request", "password_requests", request_id)

    return jsonify({"message": "Password change approved"})


@password_requests_bp.post("/password-requests/<request_id>/reject")
@roles_required("super_admin")
def reject_password_request(request_id):
    request_obj_id = safe_object_id(request_id)

    if not request_obj_id:
        return jsonify({"message": "Invalid password request id"}), 400

    db = get_db()

    req = db.password_requests.find_one({
        "_id": request_obj_id,
        "status": "pending",
    })

    if not req:
        return jsonify({"message": "Pending request not found"}), 404

    db.password_requests.update_one(
        {"_id": request_obj_id},
        {
            "$set": {
                "status": "rejected",
                "rejected_at": datetime.utcnow(),
                "rejected_by": str(g.current_user["_id"]),
                "rejected_by_name": g.current_user.get("name") or g.current_user.get("email"),
            }
        },
    )

    audit("reject_password_request", "password_requests", request_id)

    return jsonify({"message": "Password change request rejected"})