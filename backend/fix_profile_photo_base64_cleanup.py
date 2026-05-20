from pymongo import MongoClient
from app.config import Config


PHOTO_FIELDS = [
    "avatar",
    "profile_photo",
    "profile_picture",
    "photo",
    "image",
    "picture",
    "employee_avatar",
    "employee_profile_photo",
    "latest_progress_by_avatar",
    "profile_photo_url",
    "avatar_url",
    "photo_url",
]


COLLECTIONS_TO_CLEAN = [
    "employees",
    "users",
    "projects",
    "project_progress",
    "attendance_logs",
    "leave_requests",
    "attendance_mode_requests",
    "compoff_credits",
    "performance_reviews",
    "notifications",
]


def is_bad_photo_value(value):
    text = str(value or "").strip()

    if not text:
        return False

    # Main crash reason: full base64 image stored in MongoDB.
    if text.startswith("data:image") and len(text) > 5000:
        return True

    # Any very long non-http value is unsafe for dashboard/session payloads.
    if len(text) > 1000 and not text.startswith("http"):
        return True

    return False


def clean_nested_list_photo_fields(items):
    if not isinstance(items, list):
        return items, False

    changed = False
    cleaned_items = []

    for item in items:
        if not isinstance(item, dict):
            cleaned_items.append(item)
            continue

        cleaned_item = dict(item)

        for field in PHOTO_FIELDS:
            if is_bad_photo_value(cleaned_item.get(field)):
                cleaned_item.pop(field, None)
                changed = True

        cleaned_items.append(cleaned_item)

    return cleaned_items, changed


def clean_project_nested_people(doc):
    set_payload = {}

    for list_field in [
        "assigned_members",
        "collaborators",
        "doing_people",
        "all_people",
    ]:
        cleaned_list, changed = clean_nested_list_photo_fields(doc.get(list_field))

        if changed:
            set_payload[list_field] = cleaned_list

    tree = doc.get("project_team_tree")

    if isinstance(tree, dict):
        cleaned_tree = dict(tree)
        tree_changed = False

        for person_field in [
            "reporting_officer",
            "team_leader",
            "latest_progress_person",
        ]:
            person = cleaned_tree.get(person_field)

            if isinstance(person, dict):
                cleaned_person = dict(person)

                for photo_field in PHOTO_FIELDS:
                    if is_bad_photo_value(cleaned_person.get(photo_field)):
                        cleaned_person.pop(photo_field, None)
                        tree_changed = True

                cleaned_tree[person_field] = cleaned_person

        for list_field in [
            "assigned_members",
            "collaborators",
            "doing_people",
            "all_people",
        ]:
            cleaned_list, changed = clean_nested_list_photo_fields(cleaned_tree.get(list_field))

            if changed:
                cleaned_tree[list_field] = cleaned_list
                tree_changed = True

        tree_levels = cleaned_tree.get("tree_levels")

        if isinstance(tree_levels, list):
            cleaned_levels = []

            for level in tree_levels:
                if not isinstance(level, dict):
                    cleaned_levels.append(level)
                    continue

                cleaned_level = dict(level)
                cleaned_people, changed = clean_nested_list_photo_fields(cleaned_level.get("people"))

                if changed:
                    cleaned_level["people"] = cleaned_people
                    tree_changed = True

                cleaned_levels.append(cleaned_level)

            cleaned_tree["tree_levels"] = cleaned_levels

        if tree_changed:
            set_payload["project_team_tree"] = cleaned_tree

    return set_payload


def clean_collection(db, collection_name):
    collection = db[collection_name]

    scanned = 0
    cleaned = 0

    for doc in collection.find({}):
        scanned += 1

        unset_payload = {}
        set_payload = {}

        for field in PHOTO_FIELDS:
            if is_bad_photo_value(doc.get(field)):
                unset_payload[field] = ""

        # Clean nested project/team people also.
        nested_set_payload = clean_project_nested_people(doc)

        if nested_set_payload:
            set_payload.update(nested_set_payload)

        update_query = {}

        if unset_payload:
            update_query["$unset"] = unset_payload

        if set_payload:
            update_query["$set"] = set_payload

        if update_query:
            collection.update_one(
                {"_id": doc["_id"]},
                update_query,
            )
            cleaned += 1

    print(f"{collection_name}: scanned={scanned}, cleaned={cleaned}")


def main():
    mongo_uri = getattr(Config, "MONGO_URI", "mongodb://localhost:27017/sds_hrms_full")

    client = MongoClient(mongo_uri)

    # Your project stores DB name inside MONGO_URI.
    # Example: mongodb://localhost:27017/sds_hrms_full
    db = client.get_default_database()

    if db is None:
        db = client["sds_hrms_full"]

    print("Starting profile photo base64 cleanup...")
    print(f"Mongo URI: {mongo_uri}")
    print(f"Database: {db.name}")
    print("-" * 60)

    for collection_name in COLLECTIONS_TO_CLEAN:
        clean_collection(db, collection_name)

    print("-" * 60)
    print("Profile photo base64 cleanup completed.")


if __name__ == "__main__":
    main()