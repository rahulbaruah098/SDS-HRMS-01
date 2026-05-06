from flask import Blueprint, request, jsonify, g
from datetime import datetime, time
from bson import ObjectId

from app.extensions import get_db
from app.utils.auth import current_user_required, roles_required, audit
from app.utils.serializers import clean_doc


attendance_bp = Blueprint("attendance", __name__)
LATE_CUTOFF = time(9, 45)


ATTENDANCE_MANAGER_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
)


FULL_TENANT_REPORT_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}


TEAM_SCOPE_ROLES = {
    "team_leader",
}


REPORTING_SCOPE_ROLES = {
    "manager",
    "ro",
    "reporting_officer",
}


def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def emp(db):
    return db.employees.find_one({
        "tenant_id": g.tenant_id,
        "user_id": str(g.current_user["_id"]),
    })


def scoped_employee_ids_for_manager(db):
    roles = set(g.current_user.get("roles", []))

    if roles.intersection(FULL_TENANT_REPORT_ROLES):
        return None

    current_emp = emp(db)

    if not current_emp:
        return []

    current_emp_id = str(current_emp["_id"])
    scope_or = []

    if roles.intersection(TEAM_SCOPE_ROLES):
        scope_or.append({"team_leader_id": current_emp_id})

    if roles.intersection(REPORTING_SCOPE_ROLES):
        scope_or.append({"reporting_officer_id": current_emp_id})

    if not scope_or:
        return []

    rows = list(
        db.employees.find({
            "tenant_id": g.tenant_id,
            "status": {"$ne": "Inactive"},
            "$or": scope_or,
        })
    )

    return [str(row["_id"]) for row in rows]


def manager_scope_query(db):
    roles = set(g.current_user.get("roles", []))
    tenant_arg = (request.args.get("tenant_id") or "").strip()

    if "super_admin" in roles:
        if tenant_arg:
            return {"tenant_id": tenant_arg}
        return {}

    q = {"tenant_id": g.tenant_id}

    scoped_employee_ids = scoped_employee_ids_for_manager(db)

    if scoped_employee_ids is not None:
        q["employee_id"] = {"$in": scoped_employee_ids}

    return q


@attendance_bp.post("/check-in")
@current_user_required
def check_in():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}

    mode = (data.get("mode") or "office").strip().lower()
    late_reason = (data.get("late_reason") or "").strip()
    field_location = (data.get("field_location") or "").strip()

    now = datetime.now()
    today = now.date().isoformat()
    is_late = now.time() > LATE_CUTOFF

    if mode not in ["office", "field"]:
        return jsonify({"message": "Invalid attendance mode"}), 400

    if is_late and not late_reason:
        return jsonify({"message": "Late reason is required after 09:45 AM"}), 400

    if mode == "field" and not field_location:
        return jsonify({"message": "Field location is required for field mode"}), 400

    old = db.attendance_logs.find_one({
        "tenant_id": g.tenant_id,
        "employee_id": str(e["_id"]),
        "date": today,
    })

    if old and old.get("check_in"):
        return jsonify({
            "message": "Already checked in today",
            "attendance": clean_doc(old),
        }), 409

    doc = {
        "tenant_id": g.tenant_id,
        "employee_id": str(e["_id"]),
        "employee_name": e.get("name"),
        "department": e.get("department"),
        "designation": e.get("designation"),
        "team_leader_id": e.get("team_leader_id", ""),
        "team_leader_name": e.get("team_leader_name", ""),
        "reporting_officer_id": e.get("reporting_officer_id", ""),
        "reporting_officer_name": e.get("reporting_officer_name", ""),
        "date": today,
        "check_in": now,
        "check_out": None,
        "mode": mode,
        "field_location": field_location,
        "late_reason": late_reason,
        "status": "late" if is_late else "present",
        "verified_by_ro": False,
        "timeline": [
            {
                "type": "check_in",
                "time": now,
                "note": f"{mode.title()} mode",
            }
        ],
        "created_at": now,
        "updated_at": now,
    }

    res = db.attendance_logs.insert_one(doc)
    doc["_id"] = res.inserted_id

    audit("check_in", "attendance_logs", res.inserted_id, {
        "mode": mode,
        "late": is_late,
    })

    return jsonify({
        "message": "Check-in successful",
        "attendance": clean_doc(doc),
    })


@attendance_bp.post("/check-out")
@current_user_required
def check_out():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    now = datetime.now()
    today = now.date().isoformat()

    rec = db.attendance_logs.find_one({
        "tenant_id": g.tenant_id,
        "employee_id": str(e["_id"]),
        "date": today,
    })

    if not rec:
        return jsonify({"message": "Please check in first"}), 400

    if rec.get("check_out"):
        return jsonify({
            "message": "Already checked out",
            "attendance": clean_doc(rec),
        }), 409

    db.attendance_logs.update_one(
        {"_id": rec["_id"]},
        {
            "$set": {
                "check_out": now,
                "updated_at": now,
            },
            "$push": {
                "timeline": {
                    "type": "check_out",
                    "time": now,
                    "note": "Day closed",
                }
            },
        },
    )

    updated = db.attendance_logs.find_one({"_id": rec["_id"]})

    audit("check_out", "attendance_logs", rec["_id"])

    return jsonify({
        "message": "Check-out successful",
        "attendance": clean_doc(updated),
    })


@attendance_bp.get("/my")
@current_user_required
def my():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"items": []})

    q = {
        "tenant_id": g.tenant_id,
        "employee_id": str(e["_id"]),
    }

    items = list(
        db.attendance_logs
        .find(q)
        .sort("date", -1)
        .limit(60)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.get("/report")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def report():
    db = get_db()

    q = manager_scope_query(db)

    employee_id = (request.args.get("employee_id") or "").strip()
    department = (request.args.get("department") or "").strip()
    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()

    if employee_id:
        if isinstance(q.get("employee_id"), dict) and "$in" in q["employee_id"]:
            if employee_id not in q["employee_id"]["$in"]:
                return jsonify({"items": []})

        q["employee_id"] = employee_id

    if department:
        q["department"] = department

    if date_from or date_to:
        q["date"] = {}

        if date_from:
            q["date"]["$gte"] = date_from

        if date_to:
            q["date"]["$lte"] = date_to

    items = list(
        db.attendance_logs
        .find(q)
        .sort("date", -1)
        .limit(300)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.patch("/<attendance_id>/verify")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def verify(attendance_id):
    attendance_obj_id = safe_object_id(attendance_id)

    if not attendance_obj_id:
        return jsonify({"message": "Invalid attendance id"}), 400

    db = get_db()
    roles = set(g.current_user.get("roles", []))

    q = {"_id": attendance_obj_id}

    if "super_admin" not in roles:
        q["tenant_id"] = g.tenant_id

    if not roles.intersection(FULL_TENANT_REPORT_ROLES):
        scoped_employee_ids = scoped_employee_ids_for_manager(db)

        if scoped_employee_ids is not None:
            q["employee_id"] = {"$in": scoped_employee_ids}

    existing = db.attendance_logs.find_one(q)

    if not existing:
        return jsonify({"message": "Attendance record not found or not in your scope"}), 404

    db.attendance_logs.update_one(
        {"_id": existing["_id"]},
        {
            "$set": {
                "verified_by_ro": True,
                "verified_at": datetime.utcnow(),
                "verified_by": str(g.current_user["_id"]),
                "verified_by_name": g.current_user.get("name") or g.current_user.get("email"),
                "updated_at": datetime.utcnow(),
            }
        },
    )

    audit("verify", "attendance_logs", attendance_id)

    return jsonify({"message": "Attendance verified"})