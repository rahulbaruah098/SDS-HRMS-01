from datetime import datetime
from werkzeug.security import generate_password_hash

from app import create_app
from app.extensions import get_db


app = create_app()

with app.app_context():
    db = get_db()

    repaired = 0

    employees = list(db.employees.find({
        "$or": [
            {"user_id": {"$exists": False}},
            {"user_id": ""},
            {"user_id": None},
        ]
    }))

    for emp in employees:
        email = (emp.get("email") or "").strip().lower()
        name = emp.get("name") or email

        if not email:
            continue

        user = db.users.find_one({"email": email})

        if user:
            db.employees.update_one(
                {"_id": emp["_id"]},
                {"$set": {"user_id": str(user["_id"]), "updated_at": datetime.utcnow()}},
            )
            repaired += 1
            continue

        roles = ["employee"]

        if str(emp.get("is_team_leader", "")).lower() in ["true", "yes", "1"]:
            roles.append("team_leader")

        if str(emp.get("is_reporting_officer", "")).lower() in ["true", "yes", "1"]:
            roles.append("reporting_officer")

        user_res = db.users.insert_one({
            "tenant_id": emp.get("tenant_id", "sds"),
            "name": name,
            "email": email,
            "password_hash": generate_password_hash("User@123"),
            "roles": roles,
            "is_active": True,
            "created_at": datetime.utcnow(),
        })

        db.employees.update_one(
            {"_id": emp["_id"]},
            {"$set": {"user_id": str(user_res.inserted_id), "updated_at": datetime.utcnow()}},
        )

        repaired += 1

    print(f"Repair completed. Employees linked/created as users: {repaired}")
    print("Default password for repaired users: User@123")