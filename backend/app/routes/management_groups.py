from datetime import datetime
from bson import ObjectId
from flask import Blueprint, jsonify, request, g

from app.extensions import get_db
from app.utils.auth import current_user_required, normalize_roles, audit
from app.utils.serializers import clean_doc


management_groups_bp = Blueprint("management_groups", __name__)


TENANT_MANAGEMENT_ADMIN_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}


def now_utc():
    return datetime.utcnow()


def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def normalize_text(value):
    return str(value or "").strip()


def normalize_date_text(value):
    return normalize_text(value)[:10]


def current_tenant_id():
    return getattr(g, "tenant_id", "") or g.current_user.get("tenant_id") or "sds"


def current_user_id():
    return str(g.current_user.get("_id") or "")


def current_user_name():
    return (
        g.current_user.get("name")
        or g.current_user.get("full_name")
        or g.current_user.get("email")
        or "User"
    )


def current_user_roles():
    return set(normalize_roles(g.current_user.get("roles", [])))


def is_tenant_management_admin():
    roles = current_user_roles()
    return bool(roles.intersection(TENANT_MANAGEMENT_ADMIN_ROLES))


def current_employee(db):
    user_id = current_user_id()
    tenant_id = current_tenant_id()

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee

    return db.employees.find_one({
        "user_id": user_id,
        "is_deleted": {"$ne": True},
    })


def employee_display_name(employee):
    return (
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or employee.get("email")
        or employee.get("official_email")
        or "Employee"
    )


def user_display_name(user):
    return (
        user.get("name")
        or user.get("full_name")
        or user.get("email")
        or "User"
    )


def employee_projection():
    return {
        "name": 1,
        "employee_name": 1,
        "full_name": 1,
        "email": 1,
        "official_email": 1,
        "phone": 1,
        "mobile": 1,
        "department": 1,
        "department_name": 1,
        "designation": 1,
        "designation_name": 1,
        "employee_id": 1,
        "employee_code": 1,
        "emp_code": 1,
        "user_id": 1,
        "tenant_id": 1,
        "avatar": 1,
        "profile_photo": 1,
        "profile_picture": 1,
        "photo": 1,
    }


def ensure_management_group(db):
    tenant_id = current_tenant_id()

    group = db.management_groups.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    })

    if group:
        return group

    now = now_utc()

    payload = {
        "tenant_id": tenant_id,
        "name": "Management Group",
        "description": "Tenant-level management group for internal meetings, minutes and management communication.",
        "member_employee_ids": [],
        "member_user_ids": [],
        "group_admin_user_ids": [],
        "status": "active",
        "is_deleted": False,
        "created_at": now,
        "updated_at": now,
        "created_by": current_user_id(),
        "created_by_name": current_user_name(),
    }

    result = db.management_groups.insert_one(payload)
    payload["_id"] = result.inserted_id

    return payload


def serialize_member(employee, group):
    employee_id = str(employee.get("_id"))
    user_id = str(employee.get("user_id") or "")

    return {
        "_id": employee_id,
        "employee_id": employee_id,
        "user_id": user_id,
        "name": employee_display_name(employee),
        "email": employee.get("email") or employee.get("official_email") or "",
        "phone": employee.get("phone") or employee.get("mobile") or "",
        "department": employee.get("department") or employee.get("department_name") or "",
        "designation": employee.get("designation") or employee.get("designation_name") or "",
        "employee_code": (
            employee.get("employee_code")
            or employee.get("emp_code")
            or employee.get("employee_id")
            or ""
        ),
        "avatar": (
            employee.get("avatar")
            or employee.get("profile_photo")
            or employee.get("profile_picture")
            or employee.get("photo")
            or ""
        ),
        "is_group_admin": user_id in set(group.get("group_admin_user_ids", [])),
    }


def group_member_scope(db, group):
    employee_ids = [
        safe_object_id(value)
        for value in group.get("member_employee_ids", [])
        if safe_object_id(value)
    ]

    if not employee_ids:
        return []

    employees = list(
        db.employees
        .find(
            {
                "_id": {"$in": employee_ids},
                "tenant_id": group.get("tenant_id"),
                "is_deleted": {"$ne": True},
            },
            employee_projection(),
        )
        .sort("name", 1)
    )

    return [serialize_member(employee, group) for employee in employees]


def is_current_user_group_member(db, group):
    user_id = current_user_id()

    if user_id in set(group.get("member_user_ids", [])):
        return True

    employee = current_employee(db)

    if employee and str(employee.get("_id")) in set(group.get("member_employee_ids", [])):
        return True

    return False


def can_manage_group(db, group):
    if is_tenant_management_admin():
        return True

    user_id = current_user_id()

    if user_id in set(group.get("group_admin_user_ids", [])):
        return True

    return False


def can_view_group_private_area(db, group):
    return can_manage_group(db, group) or is_current_user_group_member(db, group)


def notify_users(db, user_ids, title, body, meta=None):
    meta = meta or {}
    tenant_id = current_tenant_id()
    now = now_utc()
    docs = []

    for user_id in sorted(set([str(uid) for uid in user_ids if str(uid).strip()])):
        docs.append({
            "tenant_id": tenant_id,
            "target_tenant_id": tenant_id,
            "user_id": user_id,
            "user_ids": [user_id],
            "title": title,
            "body": body,
            "message": body,
            "notification_type": meta.get("notification_type") or "management_group",
            "priority": meta.get("priority") or "normal",
            "target": meta.get("target") or "management_groups",
            "target_scope": "selected_users",
            "audience": "selected_users",
            "show_popup": True,
            "popup_seen": False,
            "popup_seen_at": "",
            "read": False,
            "status": "unread",
            "meta": meta,
            "created_at": now,
            "updated_at": now,
            "created_by": current_user_id(),
            "created_by_name": current_user_name(),
            "is_deleted": False,
        })

    if docs:
        db.notifications.insert_many(docs)


def meeting_query_for_group(group_id):
    return {
        "group_id": str(group_id),
        "tenant_id": current_tenant_id(),
        "is_deleted": {"$ne": True},
    }


@management_groups_bp.get("")
@current_user_required
def get_management_group():
    db = get_db()
    group = ensure_management_group(db)
    members = group_member_scope(db, group)

    is_member = is_current_user_group_member(db, group)
    can_manage = can_manage_group(db, group)
    can_view_private = can_view_group_private_area(db, group)

    response = {
        "group": clean_doc(group),
        "members": clean_doc(members),
        "permissions": {
            "is_member": is_member,
            "can_manage": can_manage,
            "can_view_private": can_view_private,
            "can_schedule_meeting": can_manage,
            "can_update_members": can_manage,
        },
    }

    return jsonify(response)


@management_groups_bp.get("/employee-options")
@current_user_required
def management_group_employee_options():
    db = get_db()
    group = ensure_management_group(db)

    if not can_manage_group(db, group):
        return jsonify({"message": "Only tenant admin can manage Management Group members"}), 403

    employees = list(
        db.employees
        .find(
            {
                "tenant_id": current_tenant_id(),
                "is_deleted": {"$ne": True},
                "status": {"$nin": ["Resigned", "Left", "Terminated", "Retired"]},
                "employment_status": {"$nin": ["Resigned", "Left", "Terminated", "Retired"]},
            },
            employee_projection(),
        )
        .sort("name", 1)
        .limit(5000)
    )

    options = []

    for employee in employees:
        options.append({
            "_id": str(employee.get("_id")),
            "employee_id": str(employee.get("_id")),
            "user_id": str(employee.get("user_id") or ""),
            "name": employee_display_name(employee),
            "email": employee.get("email") or employee.get("official_email") or "",
            "department": employee.get("department") or employee.get("department_name") or "",
            "designation": employee.get("designation") or employee.get("designation_name") or "",
            "employee_code": (
                employee.get("employee_code")
                or employee.get("emp_code")
                or employee.get("employee_id")
                or ""
            ),
        })

    return jsonify({
        "items": clean_doc(options),
        "employees": clean_doc(options),
    })


@management_groups_bp.put("/members")
@current_user_required
def update_management_group_members():
    db = get_db()
    group = ensure_management_group(db)

    if not can_manage_group(db, group):
        return jsonify({"message": "Only tenant admin can update Management Group members"}), 403

    data = request.get_json(silent=True) or {}

    member_employee_ids = [
        str(value)
        for value in data.get("member_employee_ids", [])
        if safe_object_id(value)
    ]

    group_admin_user_ids = [
        str(value)
        for value in data.get("group_admin_user_ids", [])
        if str(value or "").strip()
    ]

    if not member_employee_ids:
        return jsonify({"message": "Select at least one Management Group member"}), 400

    employee_obj_ids = [safe_object_id(value) for value in member_employee_ids]

    employees = list(
        db.employees.find({
            "_id": {"$in": employee_obj_ids},
            "tenant_id": current_tenant_id(),
            "is_deleted": {"$ne": True},
        })
    )

    if len(employees) != len(set(member_employee_ids)):
        return jsonify({"message": "One or more selected employees are invalid for this tenant"}), 400

    member_user_ids = [
        str(employee.get("user_id"))
        for employee in employees
        if str(employee.get("user_id") or "").strip()
    ]

    valid_user_ids = set(member_user_ids)

    filtered_group_admin_user_ids = [
        user_id
        for user_id in group_admin_user_ids
        if user_id in valid_user_ids
    ]

    update = {
        "name": normalize_text(data.get("name")) or group.get("name") or "Management Group",
        "description": normalize_text(data.get("description")) or group.get("description") or "",
        "member_employee_ids": sorted(set(member_employee_ids)),
        "member_user_ids": sorted(set(member_user_ids)),
        "group_admin_user_ids": sorted(set(filtered_group_admin_user_ids)),
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    db.management_groups.update_one(
        {"_id": group["_id"]},
        {"$set": update},
    )

    audit("update_management_group_members", "management_groups", group["_id"], {
        "member_count": len(update["member_employee_ids"]),
        "group_admin_count": len(update["group_admin_user_ids"]),
    })

    updated_group = db.management_groups.find_one({"_id": group["_id"]})

    return jsonify({
        "message": "Management Group members updated successfully",
        "group": clean_doc(updated_group),
        "members": clean_doc(group_member_scope(db, updated_group)),
    })


@management_groups_bp.post("/meetings")
@current_user_required
def create_management_group_meeting():
    db = get_db()
    group = ensure_management_group(db)

    if not can_manage_group(db, group):
        return jsonify({"message": "Only tenant admin can schedule Management Group meetings"}), 403

    data = request.get_json(silent=True) or {}

    topic = normalize_text(data.get("topic") or data.get("title"))
    meeting_date = normalize_date_text(data.get("meeting_date") or data.get("date"))
    start_time = normalize_text(data.get("start_time"))
    end_time = normalize_text(data.get("end_time"))
    mode = normalize_text(data.get("mode")) or "Offline"
    location = normalize_text(data.get("location"))
    agenda = normalize_text(data.get("agenda"))
    assigned_minutes_user_id = normalize_text(data.get("assigned_minutes_user_id"))

    if not topic:
        return jsonify({"message": "Meeting topic is required"}), 400

    if not meeting_date:
        return jsonify({"message": "Meeting date is required"}), 400

    member_user_ids = set(group.get("member_user_ids", []))

    if assigned_minutes_user_id and assigned_minutes_user_id not in member_user_ids:
        return jsonify({"message": "Minutes writer must be a Management Group member"}), 400

    assigned_minutes_user = None

    if assigned_minutes_user_id:
        assigned_minutes_user = db.users.find_one({
            "_id": safe_object_id(assigned_minutes_user_id),
            "tenant_id": current_tenant_id(),
            "is_active": True,
        })

    now = now_utc()

    payload = {
        "tenant_id": current_tenant_id(),
        "group_id": str(group["_id"]),
        "topic": topic,
        "title": topic,
        "meeting_date": meeting_date,
        "start_time": start_time,
        "end_time": end_time,
        "mode": mode,
        "location": location,
        "agenda": agenda,
        "assigned_minutes_user_id": assigned_minutes_user_id,
        "assigned_minutes_user_name": user_display_name(assigned_minutes_user) if assigned_minutes_user else "",
        "status": "scheduled",
        "minutes_status": "pending" if assigned_minutes_user_id else "not_assigned",
        "minutes": "",
        "decisions": "",
        "action_items": "",
        "attendee_user_ids": sorted(member_user_ids),
        "created_at": now,
        "updated_at": now,
        "created_by": current_user_id(),
        "created_by_name": current_user_name(),
        "is_deleted": False,
    }

    result = db.management_group_meetings.insert_one(payload)
    payload["_id"] = result.inserted_id

    notify_users(
        db,
        group.get("member_user_ids", []),
        "Management Group meeting scheduled",
        f"{topic} has been scheduled on {meeting_date}.",
        {
            "management_group_id": str(group["_id"]),
            "meeting_id": str(result.inserted_id),
            "topic": topic,
            "meeting_date": meeting_date,
            "target": "management_groups",
        },
    )

    if assigned_minutes_user_id:
        notify_users(
            db,
            [assigned_minutes_user_id],
            "Meeting minutes assigned",
            f"You have been assigned to enter minutes for {topic} on {meeting_date}.",
            {
                "management_group_id": str(group["_id"]),
                "meeting_id": str(result.inserted_id),
                "topic": topic,
                "meeting_date": meeting_date,
                "target": "management_groups",
                "assignment": "minutes_writer",
            },
        )

    audit("create_management_group_meeting", "management_group_meetings", result.inserted_id, {
        "topic": topic,
        "meeting_date": meeting_date,
        "member_notification_count": len(group.get("member_user_ids", [])),
        "assigned_minutes_user_id": assigned_minutes_user_id,
    })

    return jsonify({
        "message": "Management Group meeting scheduled successfully",
        "meeting": clean_doc(payload),
    }), 201


@management_groups_bp.get("/meetings")
@current_user_required
def list_management_group_meetings():
    db = get_db()
    group = ensure_management_group(db)

    if not can_view_group_private_area(db, group):
        return jsonify({
            "items": [],
            "meetings": [],
            "message": "Only Management Group members can view meetings",
        })

    topic = normalize_text(request.args.get("topic"))
    from_date = normalize_date_text(request.args.get("from_date"))
    to_date = normalize_date_text(request.args.get("to_date"))

    q = meeting_query_for_group(group["_id"])

    if topic:
        q["$or"] = [
            {"topic": {"$regex": topic, "$options": "i"}},
            {"title": {"$regex": topic, "$options": "i"}},
            {"agenda": {"$regex": topic, "$options": "i"}},
            {"minutes": {"$regex": topic, "$options": "i"}},
        ]

    if from_date or to_date:
        q["meeting_date"] = {}

        if from_date:
            q["meeting_date"]["$gte"] = from_date

        if to_date:
            q["meeting_date"]["$lte"] = to_date

    items = list(
        db.management_group_meetings
        .find(q)
        .sort([("meeting_date", -1), ("start_time", -1), ("created_at", -1)])
        .limit(500)
    )

    return jsonify({
        "items": clean_doc(items),
        "meetings": clean_doc(items),
    })


@management_groups_bp.get("/meetings/<meeting_id>")
@current_user_required
def get_management_group_meeting(meeting_id):
    db = get_db()
    group = ensure_management_group(db)

    if not can_view_group_private_area(db, group):
        return jsonify({"message": "Only Management Group members can view meeting details"}), 403

    meeting_obj_id = safe_object_id(meeting_id)

    if not meeting_obj_id:
        return jsonify({"message": "Invalid meeting id"}), 400

    meeting = db.management_group_meetings.find_one({
        "_id": meeting_obj_id,
        **meeting_query_for_group(group["_id"]),
    })

    if not meeting:
        return jsonify({"message": "Meeting not found"}), 404

    can_edit_minutes = (
        can_manage_group(db, group)
        or current_user_id() == str(meeting.get("assigned_minutes_user_id") or "")
    )

    return jsonify({
        "meeting": clean_doc(meeting),
        "permissions": {
            "can_edit_minutes": can_edit_minutes,
            "can_manage": can_manage_group(db, group),
        },
    })


@management_groups_bp.put("/meetings/<meeting_id>/minutes")
@current_user_required
def update_management_group_minutes(meeting_id):
    db = get_db()
    group = ensure_management_group(db)

    meeting_obj_id = safe_object_id(meeting_id)

    if not meeting_obj_id:
        return jsonify({"message": "Invalid meeting id"}), 400

    meeting = db.management_group_meetings.find_one({
        "_id": meeting_obj_id,
        **meeting_query_for_group(group["_id"]),
    })

    if not meeting:
        return jsonify({"message": "Meeting not found"}), 404

    can_edit_minutes = (
        can_manage_group(db, group)
        or current_user_id() == str(meeting.get("assigned_minutes_user_id") or "")
    )

    if not can_edit_minutes:
        return jsonify({"message": "Only the assigned minutes writer or tenant admin can update minutes"}), 403

    data = request.get_json(silent=True) or {}

    minutes = normalize_text(data.get("minutes"))
    decisions = normalize_text(data.get("decisions"))
    action_items = normalize_text(data.get("action_items"))

    if not minutes:
        return jsonify({"message": "Meeting minutes are required"}), 400

    update = {
        "minutes": minutes,
        "decisions": decisions,
        "action_items": action_items,
        "minutes_status": "completed",
        "minutes_updated_at": now_utc(),
        "minutes_updated_by": current_user_id(),
        "minutes_updated_by_name": current_user_name(),
        "updated_at": now_utc(),
    }

    db.management_group_meetings.update_one(
        {"_id": meeting["_id"]},
        {"$set": update},
    )

    notify_users(
        db,
        group.get("member_user_ids", []),
        "Management Group minutes updated",
        f"Meeting minutes for {meeting.get('topic', 'Management Group meeting')} have been updated.",
        {
            "management_group_id": str(group["_id"]),
            "meeting_id": str(meeting["_id"]),
            "topic": meeting.get("topic", ""),
            "meeting_date": meeting.get("meeting_date", ""),
            "target": "management_groups",
        },
    )

    audit("update_management_group_minutes", "management_group_meetings", meeting["_id"], {
        "topic": meeting.get("topic", ""),
        "meeting_date": meeting.get("meeting_date", ""),
    })

    updated = db.management_group_meetings.find_one({"_id": meeting["_id"]})

    return jsonify({
        "message": "Meeting minutes saved successfully",
        "meeting": clean_doc(updated),
    })


@management_groups_bp.patch("/meetings/<meeting_id>/assign-minutes")
@current_user_required
def assign_management_group_minutes_writer(meeting_id):
    db = get_db()
    group = ensure_management_group(db)

    if not can_manage_group(db, group):
        return jsonify({"message": "Only tenant admin can assign minutes writer"}), 403

    meeting_obj_id = safe_object_id(meeting_id)

    if not meeting_obj_id:
        return jsonify({"message": "Invalid meeting id"}), 400

    meeting = db.management_group_meetings.find_one({
        "_id": meeting_obj_id,
        **meeting_query_for_group(group["_id"]),
    })

    if not meeting:
        return jsonify({"message": "Meeting not found"}), 404

    data = request.get_json(silent=True) or {}
    assigned_minutes_user_id = normalize_text(data.get("assigned_minutes_user_id"))

    if assigned_minutes_user_id not in set(group.get("member_user_ids", [])):
        return jsonify({"message": "Minutes writer must be a Management Group member"}), 400

    assigned_user = db.users.find_one({
        "_id": safe_object_id(assigned_minutes_user_id),
        "tenant_id": current_tenant_id(),
        "is_active": True,
    })

    if not assigned_user:
        return jsonify({"message": "Assigned user not found"}), 404

    update = {
        "assigned_minutes_user_id": assigned_minutes_user_id,
        "assigned_minutes_user_name": user_display_name(assigned_user),
        "minutes_status": "pending" if not meeting.get("minutes") else "completed",
        "updated_at": now_utc(),
        "updated_by": current_user_id(),
        "updated_by_name": current_user_name(),
    }

    db.management_group_meetings.update_one(
        {"_id": meeting["_id"]},
        {"$set": update},
    )

    notify_users(
        db,
        [assigned_minutes_user_id],
        "Meeting minutes assigned",
        f"You have been assigned to enter minutes for {meeting.get('topic', 'Management Group meeting')}.",
        {
            "management_group_id": str(group["_id"]),
            "meeting_id": str(meeting["_id"]),
            "topic": meeting.get("topic", ""),
            "meeting_date": meeting.get("meeting_date", ""),
            "target": "management_groups",
            "assignment": "minutes_writer",
        },
    )

    audit("assign_management_group_minutes_writer", "management_group_meetings", meeting["_id"], {
        "assigned_minutes_user_id": assigned_minutes_user_id,
    })

    updated = db.management_group_meetings.find_one({"_id": meeting["_id"]})

    return jsonify({
        "message": "Minutes writer assigned successfully",
        "meeting": clean_doc(updated),
    })


@management_groups_bp.delete("/meetings/<meeting_id>")
@current_user_required
def delete_management_group_meeting(meeting_id):
    db = get_db()
    group = ensure_management_group(db)

    if not can_manage_group(db, group):
        return jsonify({"message": "Only tenant admin can delete Management Group meetings"}), 403

    meeting_obj_id = safe_object_id(meeting_id)

    if not meeting_obj_id:
        return jsonify({"message": "Invalid meeting id"}), 400

    result = db.management_group_meetings.update_one(
        {
            "_id": meeting_obj_id,
            **meeting_query_for_group(group["_id"]),
        },
        {
            "$set": {
                "is_deleted": True,
                "deleted_at": now_utc(),
                "deleted_by": current_user_id(),
                "deleted_by_name": current_user_name(),
                "updated_at": now_utc(),
            }
        },
    )

    if result.matched_count == 0:
        return jsonify({"message": "Meeting not found"}), 404

    audit("delete_management_group_meeting", "management_group_meetings", meeting_id)

    return jsonify({"message": "Meeting deleted successfully"})