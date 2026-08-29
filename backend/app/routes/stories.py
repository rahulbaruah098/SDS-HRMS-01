from datetime import timedelta

from bson import ObjectId
from flask import Blueprint, g, jsonify, request

from app.extensions import get_db
from app.utils.auth import audit, current_user_required, find_employee_for_user, now_utc


stories_bp = Blueprint("stories", __name__)

STORY_MAX_CHARACTERS = 300
STORY_MAX_ACTIVE_PER_EMPLOYEE = 5
STORY_LIFETIME_HOURS = 24

_INACTIVE_EMPLOYEE_STATUSES = {
    "resigned",
    "inactive",
    "terminated",
    "left",
    "separated",
    "archived",
    "disabled",
}


def _text(value):
    return str(value or "").strip()


def _lower(value):
    return _text(value).lower().replace("-", "_").replace(" ", "_")


def _iso_utc(value):
    if value is None:
        return None

    # Project timestamps are stored as UTC datetimes. Keep the API response
    # explicit so Flutter does not interpret a naive value in local time.
    text = value.isoformat()
    if text.endswith("+00:00"):
        return text[:-6] + "Z"
    if text.endswith("Z"):
        return text
    return text + "Z"


def _safe_object_id(value):
    try:
        if isinstance(value, ObjectId):
            return value
        text = _text(value)
        if text and ObjectId.is_valid(text):
            return ObjectId(text)
    except Exception:
        pass
    return None


def _profile_photo_value(employee):
    employee = employee or {}

    for key in (
        "avatar",
        "profile_photo",
        "profile_picture",
        "photo",
        "image",
        "picture",
    ):
        value = _text(employee.get(key))
        if not value:
            continue

        # Do not push large base64 payloads into the stories rail.
        if value.startswith("data:image") and len(value) > 5000:
            continue

        if len(value) > 1000 and not value.startswith("http"):
            continue

        return value

    return ""


def _employee_name(employee, user=None):
    employee = employee or {}
    user = user or {}

    return _text(
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or user.get("name")
        or user.get("full_name")
        or user.get("email")
    )


def _employee_code(employee):
    employee = employee or {}
    return _text(
        employee.get("employee_id")
        or employee.get("employee_code")
        or employee.get("emp_code")
        or employee.get("code")
        or employee.get("_id")
    )


def _employee_is_active(employee):
    employee = employee or {}

    if not employee or employee.get("is_deleted") is True:
        return False

    if employee.get("is_active") is False:
        return False

    for key in ("status", "employment_status", "employee_status"):
        status = _lower(employee.get(key))
        if status in _INACTIVE_EMPLOYEE_STATUSES:
            return False

    return True


def _current_employee_or_error(db):
    user = getattr(g, "current_user", None) or {}
    tenant_id = _text(getattr(g, "tenant_id", None) or user.get("tenant_id"))

    if not tenant_id:
        return None, None, (jsonify({
            "ok": False,
            "message": "Company context is missing for this account.",
        }), 403)

    employee = find_employee_for_user(db, user)

    if not employee or _text(employee.get("tenant_id")) != tenant_id:
        return None, None, (jsonify({
            "ok": False,
            "message": "Employee profile was not found for this company.",
        }), 404)

    if not _employee_is_active(employee):
        return None, None, (jsonify({
            "ok": False,
            "message": "Stories are unavailable for an inactive employee account.",
        }), 403)

    return tenant_id, employee, None


def _story_payload(story):
    return {
        "id": str(story.get("_id", "")),
        "text": _text(story.get("text")),
        "created_at": _iso_utc(story.get("created_at")),
        "expires_at": _iso_utc(story.get("expires_at")),
    }


def _employee_lookup_for_stories(db, tenant_id, stories):
    mongo_ids = []
    user_ids = []

    for story in stories:
        employee_object_id = _safe_object_id(story.get("employee_mongo_id"))
        if employee_object_id is not None:
            mongo_ids.append(employee_object_id)

        user_id = _text(story.get("employee_user_id"))
        if user_id:
            user_ids.append(user_id)

    clauses = []
    if mongo_ids:
        clauses.append({"_id": {"$in": list(set(mongo_ids))}})
    if user_ids:
        clauses.append({"user_id": {"$in": list(set(user_ids))}})

    if not clauses:
        return {}, {}

    query = {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": clauses,
    }

    employees_by_mongo_id = {}
    employees_by_user_id = {}

    for employee in db.employees.find(query):
        if not _employee_is_active(employee):
            continue

        employees_by_mongo_id[str(employee.get("_id"))] = employee

        employee_user_id = _text(employee.get("user_id"))
        if employee_user_id:
            employees_by_user_id[employee_user_id] = employee

    return employees_by_mongo_id, employees_by_user_id


@stories_bp.get("/", strict_slashes=False)
@current_user_required
def list_stories():
    db = get_db()
    tenant_id, current_employee, error = _current_employee_or_error(db)
    if error:
        return error

    now = now_utc()

    stories = list(
        db.employee_stories.find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
            "expires_at": {"$gt": now},
        }).sort("created_at", -1)
    )

    employees_by_mongo_id, employees_by_user_id = _employee_lookup_for_stories(
        db,
        tenant_id,
        stories,
    )

    groups = {}

    for story in stories:
        employee = employees_by_mongo_id.get(
            _text(story.get("employee_mongo_id"))
        ) or employees_by_user_id.get(
            _text(story.get("employee_user_id"))
        )

        # A resigned/deleted/inactive employee's previously created story must
        # disappear immediately even if its 24-hour expiry has not elapsed.
        if not employee:
            continue

        employee_key = str(employee.get("_id"))
        group = groups.get(employee_key)

        if group is None:
            group = {
                "employee_id": _employee_code(employee),
                "employee_mongo_id": employee_key,
                "employee_user_id": _text(employee.get("user_id")),
                "employee_name": _employee_name(employee),
                "profile_photo": _profile_photo_value(employee),
                "latest_story_at": story.get("created_at"),
                "stories": [],
            }
            groups[employee_key] = group

        group["stories"].append(_story_payload(story))

    grouped_stories = list(groups.values())

    # The employee rail is ordered by whoever posted most recently. Stories
    # inside an employee card are chronological for natural left/right viewing.
    grouped_stories.sort(
        key=lambda item: item.get("latest_story_at") or now,
        reverse=True,
    )

    for group in grouped_stories:
        group.pop("latest_story_at", None)
        group["stories"].sort(key=lambda item: item.get("created_at") or "")

    current_user_id = _text((getattr(g, "current_user", None) or {}).get("_id"))
    my_active_story_count = db.employee_stories.count_documents({
        "tenant_id": tenant_id,
        "employee_user_id": current_user_id,
        "is_deleted": {"$ne": True},
        "expires_at": {"$gt": now},
    })

    return jsonify({
        "ok": True,
        "stories": grouped_stories,
        "empty": len(grouped_stories) == 0,
        "message": "No story available" if not grouped_stories else "Stories loaded successfully",
        "current_employee": {
            "employee_id": _employee_code(current_employee),
            "employee_mongo_id": str(current_employee.get("_id")),
            "employee_user_id": current_user_id,
            "employee_name": _employee_name(
                current_employee,
                getattr(g, "current_user", None) or {},
            ),
            "profile_photo": _profile_photo_value(current_employee),
            "active_story_count": my_active_story_count,
            "active_story_limit": STORY_MAX_ACTIVE_PER_EMPLOYEE,
        },
    }), 200


@stories_bp.post("/", strict_slashes=False)
@current_user_required
def create_story():
    db = get_db()
    tenant_id, employee, error = _current_employee_or_error(db)
    if error:
        return error

    data = request.get_json(silent=True) or {}
    story_text = _text(data.get("text") or data.get("story_text"))

    if not story_text:
        return jsonify({
            "ok": False,
            "message": "Story text is required.",
        }), 400

    if len(story_text) > STORY_MAX_CHARACTERS:
        return jsonify({
            "ok": False,
            "message": f"Story cannot exceed {STORY_MAX_CHARACTERS} characters.",
            "max_characters": STORY_MAX_CHARACTERS,
        }), 400

    user = getattr(g, "current_user", None) or {}
    user_id = _text(user.get("_id"))
    now = now_utc()

    active_story_count = db.employee_stories.count_documents({
        "tenant_id": tenant_id,
        "employee_user_id": user_id,
        "is_deleted": {"$ne": True},
        "expires_at": {"$gt": now},
    })

    if active_story_count >= STORY_MAX_ACTIVE_PER_EMPLOYEE:
        return jsonify({
            "ok": False,
            "message": (
                f"You can have up to {STORY_MAX_ACTIVE_PER_EMPLOYEE} active stories. "
                "Delete one or wait for a story to expire before posting another."
            ),
            "active_story_count": active_story_count,
            "active_story_limit": STORY_MAX_ACTIVE_PER_EMPLOYEE,
        }), 409

    expires_at = now + timedelta(hours=STORY_LIFETIME_HOURS)

    story_document = {
        "tenant_id": tenant_id,
        "employee_id": _employee_code(employee),
        "employee_mongo_id": str(employee.get("_id")),
        "employee_user_id": user_id,
        "employee_name": _employee_name(employee, user),
        "profile_photo": _profile_photo_value(employee),
        "text": story_text,
        "created_at": now,
        "updated_at": now,
        "expires_at": expires_at,
        "is_deleted": False,
        "deleted_at": None,
        "deleted_by_user_id": None,
    }

    result = db.employee_stories.insert_one(story_document)
    story_document["_id"] = result.inserted_id

    audit(
        "create_employee_story",
        "employee_stories",
        result.inserted_id,
        {
            "employee_id": story_document["employee_id"],
            "expires_at": _iso_utc(expires_at),
        },
    )

    return jsonify({
        "ok": True,
        "message": "Story posted successfully.",
        "story": _story_payload(story_document),
        "active_story_count": active_story_count + 1,
        "active_story_limit": STORY_MAX_ACTIVE_PER_EMPLOYEE,
    }), 201


@stories_bp.delete("/<story_id>")
@current_user_required
def delete_story(story_id):
    db = get_db()
    tenant_id, _employee, error = _current_employee_or_error(db)
    if error:
        return error

    story_object_id = _safe_object_id(story_id)
    if story_object_id is None:
        return jsonify({
            "ok": False,
            "message": "Invalid story ID.",
        }), 400

    user = getattr(g, "current_user", None) or {}
    user_id = _text(user.get("_id"))
    now = now_utc()

    story = db.employee_stories.find_one({
        "_id": story_object_id,
        "tenant_id": tenant_id,
        "employee_user_id": user_id,
        "is_deleted": {"$ne": True},
    })

    if not story:
        return jsonify({
            "ok": False,
            "message": "Story was not found or you do not have permission to delete it.",
        }), 404

    result = db.employee_stories.update_one(
        {
            "_id": story_object_id,
            "tenant_id": tenant_id,
            "employee_user_id": user_id,
            "is_deleted": {"$ne": True},
        },
        {
            "$set": {
                "is_deleted": True,
                "deleted_at": now,
                "deleted_by_user_id": user_id,
                "updated_at": now,
            }
        },
    )

    if result.modified_count != 1:
        return jsonify({
            "ok": False,
            "message": "Story could not be deleted. Please try again.",
        }), 409

    audit(
        "delete_employee_story",
        "employee_stories",
        story_object_id,
        {"employee_id": story.get("employee_id")},
    )

    return jsonify({
        "ok": True,
        "message": "Story deleted successfully.",
    }), 200
