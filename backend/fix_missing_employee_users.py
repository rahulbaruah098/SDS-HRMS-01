from datetime import datetime
from werkzeug.security import generate_password_hash

from app import create_app
from app.extensions import get_db


DEFAULT_PASSWORD = "User@123"


def normalize_text(value):
    return str(value or "").strip()


def normalize_email(value):
    return normalize_text(value).lower()


def truthy(value):
    return str(value or "").strip().lower() in {"true", "1", "yes", "on"}


def employee_display_name(employee):
    return (
        normalize_text(employee.get("name"))
        or normalize_text(employee.get("employee_name"))
        or normalize_text(employee.get("full_name"))
        or normalize_email(employee.get("email"))
        or "Employee"
    )


def employee_code(employee):
    return (
        normalize_text(employee.get("employee_id"))
        or normalize_text(employee.get("emp_code"))
        or normalize_text(employee.get("code"))
        or ""
    )


def build_roles(employee, existing_roles=None):
    protected_roles = {
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "finance",
        "accounts_finance",
    }

    capability_roles = {
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
    }

    roles = set()

    if isinstance(existing_roles, list):
        roles = {normalize_text(role) for role in existing_roles if normalize_text(role)}
    elif isinstance(existing_roles, str):
        roles = {
            normalize_text(role)
            for role in existing_roles.split(",")
            if normalize_text(role)
        }

    if not roles.intersection(protected_roles):
        roles.difference_update(capability_roles)
        roles.add("employee")

    if truthy(employee.get("is_team_leader")):
        roles.add("team_leader")
    else:
        roles.discard("team_leader")

    if truthy(employee.get("is_reporting_officer")):
        roles.add("reporting_officer")
    else:
        roles.discard("reporting_officer")
        roles.discard("manager")
        roles.discard("ro")

    if not roles:
        roles.add("employee")

    return sorted(list(roles))


def build_user_payload(employee, existing_user=None):
    existing_user = existing_user or {}

    name = employee_display_name(employee)
    email = normalize_email(employee.get("email"))
    tenant_id = employee.get("tenant_id") or existing_user.get("tenant_id") or "sds"
    status = normalize_text(employee.get("status") or "active").lower()

    is_active = not (
        status in {"inactive", "disabled", "deleted"}
        or truthy(employee.get("is_deleted"))
    )

    payload = {
        "tenant_id": tenant_id,
        "name": name,
        "full_name": name,
        "email": email,
        "username": email,
        "role": "employee",
        "roles": build_roles(employee, existing_user.get("roles")),
        "employee_id": str(employee["_id"]),
        "employee_ref_id": str(employee["_id"]),
        "emp_code": employee_code(employee),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "is_active": is_active,
        "status": "active" if is_active else "inactive",
        "updated_at": datetime.utcnow(),
    }

    if employee.get("department_id"):
        payload["department_id"] = employee.get("department_id")

    if employee.get("designation_id"):
        payload["designation_id"] = employee.get("designation_id")

    return payload


def linked_user_exists(db, employee):
    user_id = normalize_text(employee.get("user_id"))

    if not user_id:
        return None

    try:
        from bson import ObjectId

        return db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        return None


def repair_missing_employee_users():
    app = create_app()

    with app.app_context():
        db = get_db()
        now = datetime.utcnow()

        repaired = 0
        created = 0
        linked = 0
        synced = 0
        skipped_no_email = 0

        employees = list(db.employees.find({
            "is_deleted": {"$ne": True},
            "$or": [
                {"user_id": {"$exists": False}},
                {"user_id": ""},
                {"user_id": None},
            ],
        }))

        employees_with_broken_user_id = []

        for emp in db.employees.find({
            "is_deleted": {"$ne": True},
            "user_id": {"$exists": True, "$nin": ["", None]},
        }):
            if not linked_user_exists(db, emp):
                employees_with_broken_user_id.append(emp)

        employees.extend(employees_with_broken_user_id)

        seen_employee_ids = set()
        unique_employees = []

        for emp in employees:
            emp_id = str(emp["_id"])

            if emp_id in seen_employee_ids:
                continue

            seen_employee_ids.add(emp_id)
            unique_employees.append(emp)

        for emp in unique_employees:
            email = normalize_email(emp.get("email"))

            if not email:
                skipped_no_email += 1
                continue

            tenant_id = emp.get("tenant_id") or "sds"

            existing_user = db.users.find_one({
                "email": email,
                "tenant_id": tenant_id,
                "is_deleted": {"$ne": True},
            })

            if not existing_user:
                existing_user = db.users.find_one({
                    "email": email,
                    "is_deleted": {"$ne": True},
                })

            if existing_user:
                user_payload = build_user_payload(emp, existing_user)
                user_payload.update({
                    "updated_by_name": "Repair Script",
                })

                db.users.update_one(
                    {"_id": existing_user["_id"]},
                    {"$set": user_payload},
                )

                db.employees.update_one(
                    {"_id": emp["_id"]},
                    {
                        "$set": {
                            "user_id": str(existing_user["_id"]),
                            "name": employee_display_name(emp),
                            "employee_name": employee_display_name(emp),
                            "email": email,
                            "tenant_id": tenant_id,
                            "updated_at": now,
                        }
                    },
                )

                linked += 1
                repaired += 1
                continue

            user_payload = build_user_payload(emp)
            user_payload.update({
                "password_hash": generate_password_hash(DEFAULT_PASSWORD),
                "created_at": now,
                "created_by_name": "Repair Script",
                "updated_by_name": "Repair Script",
                "is_deleted": False,
            })

            user_res = db.users.insert_one(user_payload)

            db.employees.update_one(
                {"_id": emp["_id"]},
                {
                    "$set": {
                        "user_id": str(user_res.inserted_id),
                        "name": employee_display_name(emp),
                        "employee_name": employee_display_name(emp),
                        "email": email,
                        "tenant_id": tenant_id,
                        "updated_at": now,
                    }
                },
            )

            created += 1
            repaired += 1

        employees_with_users = list(db.employees.find({
            "is_deleted": {"$ne": True},
            "user_id": {"$exists": True, "$nin": ["", None]},
        }))

        for emp in employees_with_users:
            user = linked_user_exists(db, emp)

            if not user:
                continue

            email = normalize_email(emp.get("email"))

            if not email:
                continue

            user_payload = build_user_payload(emp, user)
            user_payload.update({
                "updated_by_name": "Repair Script",
            })

            db.users.update_one(
                {"_id": user["_id"]},
                {"$set": user_payload},
            )

            synced += 1

        print("Repair completed.")
        print(f"Employees linked/created as users: {repaired}")
        print(f"New users created: {created}")
        print(f"Existing users linked: {linked}")
        print(f"Linked users synced: {synced}")
        print(f"Skipped employees without email: {skipped_no_email}")
        print(f"Default password for newly created repaired users: {DEFAULT_PASSWORD}")


if __name__ == "__main__":
    repair_missing_employee_users()