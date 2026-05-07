from flask import Blueprint, request, jsonify, g
from datetime import datetime, time, date, timedelta
from bson import ObjectId

from app.extensions import get_db
from app.utils.auth import current_user_required, roles_required, audit
from app.utils.serializers import clean_doc


attendance_bp = Blueprint("attendance", __name__)

OFFICE_START_TIME = time(9, 30)
LATE_CUTOFF = time(9, 50)
OFFICE_END_TIME = time(18, 0)

DEFAULT_STATE = "Assam(HO)"

SUPPORTED_HOLIDAY_STATES = [
    "Assam(HO)",
    "Manipur",
    "Mizoram",
    "Arunachal Pradesh",
]

ATTENDANCE_MODES = ["office", "wfh", "field"]

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

HOLIDAY_MANAGER_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
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


def normalize_text(value):
    return str(value or "").strip()


def normalize_mode(value):
    return normalize_text(value).lower()


def normalize_state(value):
    state = normalize_text(value)

    if not state:
        return DEFAULT_STATE

    lowered = state.lower()

    if lowered in [
        "assam",
        "assam ho",
        "assam(ho)",
        "ho",
        "assam/guwahati (ho)",
    ]:
        return "Assam(HO)"

    for allowed in SUPPORTED_HOLIDAY_STATES:
        if lowered == allowed.lower():
            return allowed

    return state


def today_local():
    return datetime.now().date()


def now_local():
    return datetime.now()


def parse_date(value):
    try:
        return datetime.strptime(normalize_text(value), "%Y-%m-%d").date()
    except Exception:
        return None


def date_to_str(value):
    if isinstance(value, date):
        return value.isoformat()

    return normalize_text(value)


def current_tenant_id():
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id") or "sds"


def current_user_roles():
    roles = g.current_user.get("roles", [])

    if isinstance(roles, list):
        return set([str(role).strip() for role in roles if str(role).strip()])

    if isinstance(roles, str):
        return set([role.strip() for role in roles.split(",") if role.strip()])

    return set()


def has_role(*allowed_roles):
    roles = current_user_roles()
    return bool(roles.intersection(set(allowed_roles)))


def emp(db):
    tenant_id = current_tenant_id()

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": str(g.current_user["_id"]),
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee

    return db.employees.find_one({
        "user_id": str(g.current_user["_id"]),
        "is_deleted": {"$ne": True},
    })


def employee_state(employee):
    return normalize_state(
        employee.get("state")
        or employee.get("branch")
        or employee.get("work_state")
        or DEFAULT_STATE
    )


def employee_display_name(employee):
    return (
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("email")
        or "Employee"
    )


def scoped_employee_ids_for_manager(db):
    roles = current_user_roles()

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
            "tenant_id": current_tenant_id(),
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
            "$or": scope_or,
        })
    )

    return [str(row["_id"]) for row in rows]


def manager_scope_query(db):
    roles = current_user_roles()
    tenant_arg = normalize_text(request.args.get("tenant_id"))

    if "super_admin" in roles:
        if tenant_arg:
            return {"tenant_id": tenant_arg}
        return {}

    q = {"tenant_id": current_tenant_id()}

    scoped_employee_ids = scoped_employee_ids_for_manager(db)

    if scoped_employee_ids is not None:
        q["employee_id"] = {"$in": scoped_employee_ids}

    return q


def is_second_or_fourth_saturday(check_date):
    if check_date.weekday() != 5:
        return False

    saturday_count = 0

    for day in range(1, check_date.day + 1):
        cursor = date(check_date.year, check_date.month, day)

        if cursor.weekday() == 5:
            saturday_count += 1

    return saturday_count in [2, 4]


def weekly_holiday_reason(check_date):
    if check_date.weekday() == 6:
        return {
            "is_holiday": True,
            "holiday_type": "weekly",
            "title": "Sunday Holiday",
            "message": "Sunday is a weekly holiday.",
        }

    if is_second_or_fourth_saturday(check_date):
        return {
            "is_holiday": True,
            "holiday_type": "weekly",
            "title": "Saturday Holiday",
            "message": "Second and fourth Saturday are weekly holidays.",
        }

    return None


def manual_holiday_for_date(db, tenant_id, state, check_date):
    date_str = date_to_str(check_date)

    return db.holiday_calendar.find_one({
        "tenant_id": tenant_id,
        "state": normalize_state(state),
        "date": date_str,
        "status": {"$ne": "inactive"},
        "is_deleted": {"$ne": True},
    })


def holiday_info_for_employee(db, employee, check_date):
    state = employee_state(employee)
    tenant_id = employee.get("tenant_id") or current_tenant_id()

    manual = manual_holiday_for_date(
        db,
        tenant_id,
        state,
        check_date,
    )

    if manual:
        return {
            "is_holiday": True,
            "holiday_type": "manual",
            "state": state,
            "title": manual.get("title", "Holiday"),
            "message": manual.get("message", ""),
            "holiday": clean_doc(manual),
        }

    weekly = weekly_holiday_reason(check_date)

    if weekly:
        weekly["state"] = state
        return weekly

    return {
        "is_holiday": False,
        "holiday_type": "",
        "state": state,
        "title": "",
        "message": "",
    }


def approved_mode_for_date(db, employee, attendance_date, mode):
    if mode == "office":
        return True

    req = db.attendance_mode_requests.find_one({
        "tenant_id": employee.get("tenant_id") or current_tenant_id(),
        "employee_id": str(employee["_id"]),
        "mode": mode,
        "date": date_to_str(attendance_date),
        "status": "approved",
        "is_deleted": {"$ne": True},
    })

    return bool(req)


def available_modes_for_employee(db, employee, attendance_date):
    modes = ["office"]

    for mode in ["wfh", "field"]:
        if approved_mode_for_date(db, employee, attendance_date, mode):
            modes.append(mode)

    return modes


def extract_location(data):
    latitude = data.get("latitude")
    longitude = data.get("longitude")
    accuracy = data.get("accuracy")
    address = normalize_text(data.get("address") or data.get("location_address"))

    try:
        latitude = float(latitude)
    except Exception:
        latitude = None

    try:
        longitude = float(longitude)
    except Exception:
        longitude = None

    try:
        accuracy = float(accuracy)
    except Exception:
        accuracy = None

    return {
        "latitude": latitude,
        "longitude": longitude,
        "accuracy": accuracy,
        "address": address,
    }


def has_required_location(location):
    return (
        location.get("latitude") is not None
        and location.get("longitude") is not None
    )


def notify_users(db, user_ids, title, body, meta=None, tenant_id=None):
    now = datetime.utcnow()
    tenant_id = tenant_id or current_tenant_id()
    docs = []

    for user_id in set([uid for uid in user_ids if uid]):
        docs.append({
            "tenant_id": tenant_id,
            "user_id": str(user_id),
            "title": title,
            "body": body,
            "meta": meta or {},
            "read": False,
            "status": "unread",
            "created_at": now,
            "updated_at": now,
        })

    if docs:
        db.notifications.insert_many(docs)


def users_for_roles(db, role_names, tenant_id=None):
    tenant_id = tenant_id or current_tenant_id()

    rows = db.users.find({
        "tenant_id": tenant_id,
        "is_active": True,
        "roles": {"$in": list(role_names)},
    })

    return [str(row["_id"]) for row in rows]


def employee_user_id(db, employee_id, tenant_id=None):
    emp_obj_id = safe_object_id(employee_id)

    if not emp_obj_id:
        return ""

    q = {
        "_id": emp_obj_id,
        "is_deleted": {"$ne": True},
    }

    if tenant_id:
        q["tenant_id"] = tenant_id
    else:
        q["tenant_id"] = current_tenant_id()

    row = db.employees.find_one(q)

    return str(row.get("user_id", "")) if row else ""


def approval_target_user_ids(db, employee):
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    user_ids = []

    for employee_field in ["team_leader_id", "reporting_officer_id"]:
        manager_user_id = employee_user_id(
            db,
            employee.get(employee_field),
            tenant_id,
        )
        if manager_user_id:
            user_ids.append(manager_user_id)

    user_ids.extend(users_for_roles(db, FULL_TENANT_REPORT_ROLES, tenant_id))

    return user_ids


def create_compoff_if_needed(db, employee, attendance_doc, holiday_info):
    if not holiday_info.get("is_holiday"):
        return None

    tenant_id = employee.get("tenant_id") or current_tenant_id()

    existing = db.compoff_credits.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "source_attendance_id": str(attendance_doc["_id"]),
        "is_deleted": {"$ne": True},
    })

    if existing:
        return existing

    now = datetime.utcnow()
    earned_date = attendance_doc.get("date")
    valid_until_date = today_local() + timedelta(days=90)

    compoff_doc = {
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "employee_name": employee_display_name(employee),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
        "source_attendance_id": str(attendance_doc["_id"]),
        "earned_date": earned_date,
        "valid_until": valid_until_date.isoformat(),
        "leave_days": 1.0,
        "status": "available",
        "holiday_title": holiday_info.get("title", ""),
        "holiday_message": holiday_info.get("message", ""),
        "created_at": now,
        "updated_at": now,
    }

    res = db.compoff_credits.insert_one(compoff_doc)
    compoff_doc["_id"] = res.inserted_id

    notify_users(
        db,
        approval_target_user_ids(db, employee),
        "Comp-Off Earned",
        f"{employee_display_name(employee)} worked on holiday and earned 1 comp-off.",
        {
            "employee_id": str(employee["_id"]),
            "attendance_id": str(attendance_doc["_id"]),
            "compoff_id": str(res.inserted_id),
        },
        tenant_id=tenant_id,
    )

    audit("create_compoff", "compoff_credits", res.inserted_id, {
        "employee_id": str(employee["_id"]),
        "attendance_id": str(attendance_doc["_id"]),
    })

    return compoff_doc


def expire_old_compoffs(db, tenant_id=None):
    today = today_local().isoformat()
    q = {
        "status": "available",
        "valid_until": {"$lt": today},
        "is_deleted": {"$ne": True},
    }

    if tenant_id:
        q["tenant_id"] = tenant_id
    else:
        q["tenant_id"] = current_tenant_id()

    db.compoff_credits.update_many(
        q,
        {
            "$set": {
                "status": "expired",
                "updated_at": datetime.utcnow(),
            }
        },
    )


def can_decide_mode_request(db, request_doc):
    roles = current_user_roles()

    if roles.intersection(FULL_TENANT_REPORT_ROLES):
        return True

    reviewer = emp(db)

    if not reviewer:
        return False

    reviewer_id = str(reviewer["_id"])

    if "team_leader" in roles and request_doc.get("team_leader_id") == reviewer_id:
        return True

    if (
        roles.intersection(REPORTING_SCOPE_ROLES)
        and request_doc.get("reporting_officer_id") == reviewer_id
    ):
        return True

    return False


@attendance_bp.get("/status")
@current_user_required
def attendance_status():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    tenant_id = e.get("tenant_id") or current_tenant_id()
    expire_old_compoffs(db, tenant_id)

    check_date = today_local()
    today = check_date.isoformat()

    rec = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "date": today,
        "is_deleted": {"$ne": True},
    })

    holiday_info = holiday_info_for_employee(db, e, check_date)
    modes = available_modes_for_employee(db, e, check_date)

    pending_mode_requests = list(
        db.attendance_mode_requests
        .find({
            "tenant_id": tenant_id,
            "employee_id": str(e["_id"]),
            "date": today,
            "status": "pending",
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
    )

    compoffs = list(
        db.compoff_credits
        .find({
            "tenant_id": tenant_id,
            "employee_id": str(e["_id"]),
            "status": {"$in": ["available", "claimed", "expired"]},
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(20)
    )

    return jsonify({
        "today": today,
        "office_start": "09:30",
        "late_cutoff": "09:50",
        "office_end": "18:00",
        "employee_state": employee_state(e),
        "holiday": holiday_info,
        "available_modes": modes,
        "attendance": clean_doc(rec),
        "pending_mode_requests": clean_doc(pending_mode_requests),
        "compoffs": clean_doc(compoffs),
    })


@attendance_bp.post("/check-in")
@current_user_required
def check_in():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}

    mode = normalize_mode(data.get("mode") or "office")
    late_reason = normalize_text(data.get("late_reason"))
    field_location = normalize_text(data.get("field_location"))
    location = extract_location(data)

    now = now_local()
    today_date = now.date()
    today = today_date.isoformat()
    tenant_id = e.get("tenant_id") or current_tenant_id()

    if mode not in ATTENDANCE_MODES:
        return jsonify({"message": "Invalid attendance mode"}), 400

    if not approved_mode_for_date(db, e, today_date, mode):
        return jsonify({
            "message": f"{mode.upper()} check-in is not approved for today"
        }), 403

    if not has_required_location(location):
        return jsonify({
            "message": "Latitude and longitude are required for attendance"
        }), 400

    if mode == "field" and not field_location:
        return jsonify({
            "message": "Field location / visit place is required for field mode"
        }), 400

    holiday_info = holiday_info_for_employee(db, e, today_date)
    is_late = now.time() >= LATE_CUTOFF and not holiday_info.get("is_holiday")

    if is_late and not late_reason:
        return jsonify({
            "message": "Late reason is required from 09:50 AM onwards"
        }), 400

    old = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "date": today,
        "is_deleted": {"$ne": True},
    })

    if old and old.get("check_in"):
        return jsonify({
            "message": "Already checked in today",
            "attendance": clean_doc(old),
        }), 409

    status = "present"

    if holiday_info.get("is_holiday"):
        status = "holiday_work"
    elif is_late:
        status = "late"

    doc = {
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "employee_name": employee_display_name(e),
        "department": e.get("department", ""),
        "designation": e.get("designation", ""),
        "state": employee_state(e),
        "team_leader_id": e.get("team_leader_id", ""),
        "team_leader_name": e.get("team_leader_name", ""),
        "reporting_officer_id": e.get("reporting_officer_id", ""),
        "reporting_officer_name": e.get("reporting_officer_name", ""),
        "date": today,
        "check_in": now,
        "check_out": None,
        "office_start": "09:30",
        "late_cutoff": "09:50",
        "office_end": "18:00",
        "mode": mode,
        "field_location": field_location,
        "late_reason": late_reason,
        "early_checkout_reason": "",
        "check_in_location": location,
        "check_out_location": None,
        "is_late": is_late,
        "is_early_checkout": False,
        "is_holiday_work": bool(holiday_info.get("is_holiday")),
        "holiday_title": holiday_info.get("title", ""),
        "holiday_message": holiday_info.get("message", ""),
        "status": status,
        "verified_by_ro": False,
        "timeline": [
            {
                "type": "check_in",
                "time": now,
                "note": f"{mode.upper()} check-in",
                "location": location,
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
        "holiday_work": bool(holiday_info.get("is_holiday")),
    })

    return jsonify({
        "message": "Check-in successful",
        "attendance": clean_doc(doc),
        "holiday": holiday_info,
    })


@attendance_bp.post("/check-out")
@current_user_required
def check_out():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}

    now = now_local()
    today_date = now.date()
    today = today_date.isoformat()
    tenant_id = e.get("tenant_id") or current_tenant_id()

    early_checkout_reason = normalize_text(data.get("early_checkout_reason"))
    location = extract_location(data)

    if not has_required_location(location):
        return jsonify({
            "message": "Latitude and longitude are required for checkout"
        }), 400

    rec = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "date": today,
        "is_deleted": {"$ne": True},
    })

    if not rec:
        return jsonify({"message": "Please check in first"}), 400

    if rec.get("check_out"):
        return jsonify({
            "message": "Already checked out",
            "attendance": clean_doc(rec),
        }), 409

    holiday_info = holiday_info_for_employee(db, e, today_date)
    is_early_checkout = now.time() < OFFICE_END_TIME and not holiday_info.get("is_holiday")

    if is_early_checkout and not early_checkout_reason:
        return jsonify({
            "message": "Early checkout reason is required before 06:00 PM"
        }), 400

    set_data = {
        "check_out": now,
        "check_out_location": location,
        "is_early_checkout": is_early_checkout,
        "early_checkout_reason": early_checkout_reason,
        "updated_at": now,
    }

    if rec.get("status") == "present" and is_early_checkout:
        set_data["status"] = "early_checkout"

    db.attendance_logs.update_one(
        {"_id": rec["_id"]},
        {
            "$set": set_data,
            "$push": {
                "timeline": {
                    "type": "check_out",
                    "time": now,
                    "note": "Day closed",
                    "location": location,
                }
            },
        },
    )

    updated = db.attendance_logs.find_one({"_id": rec["_id"]})

    compoff = None

    if updated and updated.get("is_holiday_work"):
        compoff = create_compoff_if_needed(db, e, updated, holiday_info)

    audit("check_out", "attendance_logs", rec["_id"], {
        "early_checkout": is_early_checkout,
        "holiday_work": bool(updated.get("is_holiday_work")) if updated else False,
    })

    return jsonify({
        "message": "Check-out successful",
        "attendance": clean_doc(updated),
        "compoff": clean_doc(compoff),
    })


@attendance_bp.get("/my")
@current_user_required
def my():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"items": []})

    q = {
        "tenant_id": e.get("tenant_id") or current_tenant_id(),
        "employee_id": str(e["_id"]),
        "is_deleted": {"$ne": True},
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

    employee_id = normalize_text(request.args.get("employee_id"))
    department = normalize_text(request.args.get("department"))
    mode = normalize_mode(request.args.get("mode"))
    status = normalize_text(request.args.get("status"))
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))

    if employee_id:
        if isinstance(q.get("employee_id"), dict) and "$in" in q["employee_id"]:
            if employee_id not in q["employee_id"]["$in"]:
                return jsonify({"items": []})

        q["employee_id"] = employee_id

    if department:
        q["department"] = department

    if mode:
        q["mode"] = mode

    if status:
        q["status"] = status

    if date_from or date_to:
        q["date"] = {}

        if date_from:
            q["date"]["$gte"] = date_from

        if date_to:
            q["date"]["$lte"] = date_to

    q["is_deleted"] = {"$ne": True}

    items = list(
        db.attendance_logs
        .find(q)
        .sort("date", -1)
        .limit(500)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.patch("/<attendance_id>/verify")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def verify(attendance_id):
    attendance_obj_id = safe_object_id(attendance_id)

    if not attendance_obj_id:
        return jsonify({"message": "Invalid attendance id"}), 400

    db = get_db()
    roles = current_user_roles()

    q = {
        "_id": attendance_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    if not roles.intersection(FULL_TENANT_REPORT_ROLES):
        scoped_employee_ids = scoped_employee_ids_for_manager(db)

        if scoped_employee_ids is not None:
            q["employee_id"] = {"$in": scoped_employee_ids}

    existing = db.attendance_logs.find_one(q)

    if not existing:
        return jsonify({
            "message": "Attendance record not found or not in your scope"
        }), 404

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


@attendance_bp.get("/holidays")
@roles_required(*HOLIDAY_MANAGER_ROLES)
def list_holidays():
    db = get_db()
    roles = current_user_roles()

    state_arg = normalize_text(request.args.get("state"))
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))
    tenant_arg = normalize_text(request.args.get("tenant_id"))

    q = {
        "status": {"$ne": "inactive"},
        "is_deleted": {"$ne": True},
    }

    if "super_admin" in roles and tenant_arg:
        q["tenant_id"] = tenant_arg
    else:
        q["tenant_id"] = current_tenant_id()

    if state_arg:
        q["state"] = normalize_state(state_arg)

    if date_from or date_to:
        q["date"] = {}

        if date_from:
            q["date"]["$gte"] = date_from

        if date_to:
            q["date"]["$lte"] = date_to

    items = list(
        db.holiday_calendar
        .find(q)
        .sort("date", 1)
        .limit(500)
    )

    return jsonify({
        "states": SUPPORTED_HOLIDAY_STATES,
        "items": clean_doc(items),
    })


@attendance_bp.post("/holidays")
@roles_required(*HOLIDAY_MANAGER_ROLES)
def create_holiday():
    db = get_db()
    data = request.get_json(silent=True) or {}
    roles = current_user_roles()

    tenant_id = normalize_text(data.get("tenant_id")) or current_tenant_id()

    if "super_admin" not in roles:
        tenant_id = current_tenant_id()

    state = normalize_state(data.get("state"))
    holiday_date = parse_date(data.get("date"))
    title = normalize_text(data.get("title"))
    message = normalize_text(data.get("message"))

    if state not in SUPPORTED_HOLIDAY_STATES:
        return jsonify({
            "message": "Invalid state for holiday calendar"
        }), 400

    if not holiday_date:
        return jsonify({"message": "Holiday date is required"}), 400

    if not title:
        return jsonify({"message": "Holiday title is required"}), 400

    now = datetime.utcnow()

    doc = {
        "tenant_id": tenant_id,
        "state": state,
        "date": holiday_date.isoformat(),
        "title": title,
        "message": message,
        "status": "active",
        "created_at": now,
        "updated_at": now,
        "created_by": str(g.current_user["_id"]),
        "created_by_name": g.current_user.get("name") or g.current_user.get("email"),
    }

    existing = db.holiday_calendar.find_one({
        "tenant_id": tenant_id,
        "state": state,
        "date": holiday_date.isoformat(),
        "status": {"$ne": "inactive"},
        "is_deleted": {"$ne": True},
    })

    if existing:
        return jsonify({
            "message": "Holiday already exists for this state and date"
        }), 409

    res = db.holiday_calendar.insert_one(doc)
    doc["_id"] = res.inserted_id

    audit("create", "holiday_calendar", res.inserted_id, doc)

    return jsonify({
        "message": "Holiday added",
        "item": clean_doc(doc),
    }), 201


@attendance_bp.patch("/holidays/<holiday_id>")
@roles_required(*HOLIDAY_MANAGER_ROLES)
def update_holiday(holiday_id):
    holiday_obj_id = safe_object_id(holiday_id)

    if not holiday_obj_id:
        return jsonify({"message": "Invalid holiday id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    roles = current_user_roles()

    q = {
        "_id": holiday_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    existing = db.holiday_calendar.find_one(q)

    if not existing:
        return jsonify({"message": "Holiday not found"}), 404

    update_data = {
        "updated_at": datetime.utcnow(),
        "updated_by": str(g.current_user["_id"]),
    }

    if "state" in data:
        state = normalize_state(data.get("state"))

        if state not in SUPPORTED_HOLIDAY_STATES:
            return jsonify({
                "message": "Invalid state for holiday calendar"
            }), 400

        update_data["state"] = state

    if "date" in data:
        holiday_date = parse_date(data.get("date"))

        if not holiday_date:
            return jsonify({"message": "Invalid holiday date"}), 400

        update_data["date"] = holiday_date.isoformat()

    if "title" in data:
        title = normalize_text(data.get("title"))

        if not title:
            return jsonify({"message": "Holiday title is required"}), 400

        update_data["title"] = title

    if "message" in data:
        update_data["message"] = normalize_text(data.get("message"))

    if "status" in data:
        update_data["status"] = normalize_text(data.get("status")) or "active"

    db.holiday_calendar.update_one(
        {"_id": holiday_obj_id},
        {"$set": update_data},
    )

    audit("update", "holiday_calendar", holiday_id, update_data)

    return jsonify({
        "message": "Holiday updated",
        "item": clean_doc(db.holiday_calendar.find_one({"_id": holiday_obj_id})),
    })


@attendance_bp.delete("/holidays/<holiday_id>")
@roles_required(*HOLIDAY_MANAGER_ROLES)
def delete_holiday(holiday_id):
    holiday_obj_id = safe_object_id(holiday_id)

    if not holiday_obj_id:
        return jsonify({"message": "Invalid holiday id"}), 400

    db = get_db()
    roles = current_user_roles()

    q = {"_id": holiday_obj_id}

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    existing = db.holiday_calendar.find_one(q)

    if not existing:
        return jsonify({"message": "Holiday not found"}), 404

    db.holiday_calendar.update_one(
        {"_id": holiday_obj_id},
        {
            "$set": {
                "status": "inactive",
                "is_deleted": True,
                "updated_at": datetime.utcnow(),
                "updated_by": str(g.current_user["_id"]),
            }
        },
    )

    audit("delete", "holiday_calendar", holiday_id)

    return jsonify({"message": "Holiday deleted"})


@attendance_bp.post("/mode-requests")
@current_user_required
def create_mode_request():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    data = request.get_json(silent=True) or {}

    mode = normalize_mode(data.get("mode"))
    request_date = parse_date(data.get("date"))
    reason = normalize_text(data.get("reason"))
    field_location = normalize_text(data.get("field_location"))
    tenant_id = e.get("tenant_id") or current_tenant_id()

    if mode not in ["wfh", "field"]:
        return jsonify({
            "message": "Request mode must be work from home or field"
        }), 400

    if not request_date:
        return jsonify({"message": "Request date is required"}), 400

    if request_date < today_local():
        return jsonify({"message": "Request date cannot be in the past"}), 400

    if not reason:
        return jsonify({"message": "Reason is required"}), 400

    if mode == "field" and not field_location:
        return jsonify({
            "message": "Field visit place is required for field request"
        }), 400

    existing = db.attendance_mode_requests.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "mode": mode,
        "date": request_date.isoformat(),
        "status": {"$in": ["pending", "approved"]},
        "is_deleted": {"$ne": True},
    })

    if existing:
        return jsonify({
            "message": "A pending or approved request already exists for this date and mode"
        }), 409

    now = datetime.utcnow()

    doc = {
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "employee_name": employee_display_name(e),
        "department": e.get("department", ""),
        "designation": e.get("designation", ""),
        "team_leader_id": e.get("team_leader_id", ""),
        "team_leader_name": e.get("team_leader_name", ""),
        "reporting_officer_id": e.get("reporting_officer_id", ""),
        "reporting_officer_name": e.get("reporting_officer_name", ""),
        "mode": mode,
        "date": request_date.isoformat(),
        "reason": reason,
        "field_location": field_location,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
        "created_by": str(g.current_user["_id"]),
    }

    res = db.attendance_mode_requests.insert_one(doc)
    doc["_id"] = res.inserted_id

    notify_users(
        db,
        approval_target_user_ids(db, e),
        "Attendance Mode Request",
        f"{employee_display_name(e)} requested {mode.upper()} attendance for {request_date.isoformat()}.",
        {
            "request_id": str(res.inserted_id),
            "employee_id": str(e["_id"]),
            "mode": mode,
            "date": request_date.isoformat(),
        },
        tenant_id=tenant_id,
    )

    audit("create", "attendance_mode_requests", res.inserted_id, doc)

    return jsonify({
        "message": "Request submitted",
        "item": clean_doc(doc),
    }), 201


@attendance_bp.get("/mode-requests")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def list_mode_requests():
    db = get_db()
    roles = current_user_roles()

    q = {"tenant_id": current_tenant_id(), "is_deleted": {"$ne": True}}

    if "super_admin" in roles:
        tenant_arg = normalize_text(request.args.get("tenant_id"))

        if tenant_arg:
            q["tenant_id"] = tenant_arg
        else:
            q.pop("tenant_id", None)

    status = normalize_text(request.args.get("status"))
    mode = normalize_mode(request.args.get("mode"))
    date_from = normalize_text(request.args.get("date_from"))
    date_to = normalize_text(request.args.get("date_to"))

    if status:
        q["status"] = status

    if mode:
        q["mode"] = mode

    if date_from or date_to:
        q["date"] = {}

        if date_from:
            q["date"]["$gte"] = date_from

        if date_to:
            q["date"]["$lte"] = date_to

    if not roles.intersection(FULL_TENANT_REPORT_ROLES):
        scoped_employee_ids = scoped_employee_ids_for_manager(db)

        if scoped_employee_ids is not None:
            q["employee_id"] = {"$in": scoped_employee_ids}

    items = list(
        db.attendance_mode_requests
        .find(q)
        .sort("created_at", -1)
        .limit(500)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.get("/my-mode-requests")
@current_user_required
def my_mode_requests():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"items": []})

    items = list(
        db.attendance_mode_requests
        .find({
            "tenant_id": e.get("tenant_id") or current_tenant_id(),
            "employee_id": str(e["_id"]),
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(100)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.patch("/mode-requests/<request_id>/decision")
@roles_required(*ATTENDANCE_MANAGER_ROLES)
def decide_mode_request(request_id):
    request_obj_id = safe_object_id(request_id)

    if not request_obj_id:
        return jsonify({"message": "Invalid request id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    roles = current_user_roles()

    status = normalize_text(data.get("status")).lower()
    decision_note = normalize_text(data.get("decision_note") or data.get("note"))

    if status not in ["approved", "rejected"]:
        return jsonify({
            "message": "Status must be approved or rejected"
        }), 400

    q = {
        "_id": request_obj_id,
        "is_deleted": {"$ne": True},
    }

    if "super_admin" not in roles:
        q["tenant_id"] = current_tenant_id()

    request_doc = db.attendance_mode_requests.find_one(q)

    if not request_doc:
        return jsonify({"message": "Request not found"}), 404

    if request_doc.get("status") != "pending":
        return jsonify({
            "message": "Only pending requests can be decided"
        }), 400

    if not can_decide_mode_request(db, request_doc):
        return jsonify({
            "message": "Request is not in your approval scope"
        }), 403

    now = datetime.utcnow()

    db.attendance_mode_requests.update_one(
        {"_id": request_obj_id},
        {
            "$set": {
                "status": status,
                "decision_note": decision_note,
                "decided_at": now,
                "decided_by": str(g.current_user["_id"]),
                "decided_by_name": g.current_user.get("name") or g.current_user.get("email"),
                "updated_at": now,
            }
        },
    )

    employee_user = employee_user_id(
        db,
        request_doc.get("employee_id"),
        request_doc.get("tenant_id") or current_tenant_id(),
    )

    notify_users(
        db,
        [employee_user],
        "Attendance Mode Request Updated",
        f"Your {request_doc.get('mode', '').upper()} request for {request_doc.get('date')} was {status}.",
        {
            "request_id": str(request_obj_id),
            "status": status,
        },
        tenant_id=request_doc.get("tenant_id") or current_tenant_id(),
    )

    audit(status, "attendance_mode_requests", request_id, {
        "decision_note": decision_note,
    })

    return jsonify({
        "message": f"Request {status}",
        "item": clean_doc(db.attendance_mode_requests.find_one({"_id": request_obj_id})),
    })


@attendance_bp.get("/compoffs")
@current_user_required
def my_compoffs():
    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"items": []})

    tenant_id = e.get("tenant_id") or current_tenant_id()
    expire_old_compoffs(db, tenant_id)

    items = list(
        db.compoff_credits
        .find({
            "tenant_id": tenant_id,
            "employee_id": str(e["_id"]),
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(100)
    )

    return jsonify({"items": clean_doc(items)})


@attendance_bp.post("/compoffs/<compoff_id>/claim")
@current_user_required
def claim_compoff(compoff_id):
    compoff_obj_id = safe_object_id(compoff_id)

    if not compoff_obj_id:
        return jsonify({"message": "Invalid comp-off id"}), 400

    db = get_db()
    e = emp(db)

    if not e:
        return jsonify({"message": "Employee profile not found"}), 404

    tenant_id = e.get("tenant_id") or current_tenant_id()
    expire_old_compoffs(db, tenant_id)

    data = request.get_json(silent=True) or {}
    claim_date = parse_date(data.get("claim_date"))
    reason = normalize_text(data.get("reason"))

    if not claim_date:
        return jsonify({"message": "Claim date is required"}), 400

    if claim_date < today_local():
        return jsonify({"message": "Claim date cannot be in the past"}), 400

    compoff = db.compoff_credits.find_one({
        "_id": compoff_obj_id,
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "status": "available",
        "is_deleted": {"$ne": True},
    })

    if not compoff:
        return jsonify({
            "message": "Available comp-off not found"
        }), 404

    existing_leave = db.leave_requests.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "from_date": claim_date.isoformat(),
        "to_date": claim_date.isoformat(),
        "status": {"$in": ["pending", "approved"]},
        "is_deleted": {"$ne": True},
    })

    if existing_leave:
        return jsonify({
            "message": "A pending or approved leave already exists for this date"
        }), 409

    now = datetime.utcnow()

    if e.get("team_leader_id"):
        approval_stage = "team_leader"
        approval_stage_label = "Team Leader"
    elif e.get("reporting_officer_id"):
        approval_stage = "reporting_officer"
        approval_stage_label = "Reporting Officer"
    else:
        approval_stage = "hr"
        approval_stage_label = "HR"

    leave_doc = {
        "tenant_id": tenant_id,
        "employee_id": str(e["_id"]),
        "employee_name": employee_display_name(e),
        "department": e.get("department", ""),
        "designation": e.get("designation", ""),
        "team_leader_id": e.get("team_leader_id", ""),
        "team_leader_name": e.get("team_leader_name", ""),
        "reporting_officer_id": e.get("reporting_officer_id", ""),
        "reporting_officer_name": e.get("reporting_officer_name", ""),
        "leave_type": "COMP-OFF",
        "leave_days": 1.0,
        "from_date": claim_date.isoformat(),
        "to_date": claim_date.isoformat(),
        "reason": reason or "Comp-off claim",
        "status": "pending",
        "approval_stage": approval_stage,
        "approval_stage_label": approval_stage_label,
        "approval_history": [],
        "balance_deducted": False,
        "source": "compoff",
        "compoff_id": str(compoff_obj_id),
        "created_at": now,
        "updated_at": now,
        "created_by": str(g.current_user["_id"]),
    }

    leave_res = db.leave_requests.insert_one(leave_doc)

    db.compoff_credits.update_one(
        {"_id": compoff_obj_id},
        {
            "$set": {
                "status": "claimed",
                "claimed_date": claim_date.isoformat(),
                "leave_request_id": str(leave_res.inserted_id),
                "updated_at": now,
            }
        },
    )

    notify_users(
        db,
        approval_target_user_ids(db, e),
        "Comp-Off Claimed",
        f"{employee_display_name(e)} claimed comp-off for {claim_date.isoformat()}.",
        {
            "employee_id": str(e["_id"]),
            "compoff_id": str(compoff_obj_id),
            "leave_request_id": str(leave_res.inserted_id),
        },
        tenant_id=tenant_id,
    )

    audit("claim", "compoff_credits", compoff_id, {
        "leave_request_id": str(leave_res.inserted_id),
        "claim_date": claim_date.isoformat(),
    })

    return jsonify({
        "message": "Comp-off claim submitted",
        "leave_request": clean_doc(
            db.leave_requests.find_one({"_id": leave_res.inserted_id})
        ),
    }), 201