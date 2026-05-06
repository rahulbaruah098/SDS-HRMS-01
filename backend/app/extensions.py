from pymongo import MongoClient, ASCENDING

client = None
db = None


def init_db(app):
    global client, db

    client = MongoClient(app.config["MONGO_URI"])
    db = client.get_default_database()

    ensure_indexes(db)

    return db


def get_db():
    if db is None:
        raise RuntimeError("Database not initialized")

    return db


def create_index_safe(collection, keys, **kwargs):
    try:
        collection.create_index(keys, **kwargs)
    except Exception:
        # Keeps app startup from crashing if an old/conflicting index already exists.
        # Existing data/index cleanup can be handled separately if needed.
        pass


def ensure_indexes(database):
    create_index_safe(
        database.tenants,
        [("tenant_id", ASCENDING)],
        unique=True,
    )

    create_index_safe(
        database.tenants,
        [("domain", ASCENDING)],
        sparse=True,
    )

    create_index_safe(
        database.users,
        [("email", ASCENDING)],
        unique=True,
    )

    create_index_safe(
        database.users,
        [("tenant_id", ASCENDING), ("roles", ASCENDING)],
    )

    create_index_safe(
        database.users,
        [("tenant_id", ASCENDING), ("is_active", ASCENDING)],
    )

    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("emp_code", ASCENDING)],
        unique=True,
        sparse=True,
    )

    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("user_id", ASCENDING)],
    )

    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("team_leader_id", ASCENDING)],
    )

    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("reporting_officer_id", ASCENDING)],
    )

    create_index_safe(
        database.attendance_logs,
        [("tenant_id", ASCENDING), ("employee_id", ASCENDING), ("date", ASCENDING)],
        unique=True,
    )

    create_index_safe(
        database.leave_requests,
        [("tenant_id", ASCENDING), ("employee_id", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.expenses,
        [("tenant_id", ASCENDING), ("employee_id", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.tickets,
        [("tenant_id", ASCENDING), ("raised_by", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.password_requests,
        [("user_id", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.password_requests,
        [("created_at", ASCENDING)],
    )

    indexed_collections = [
        "departments",
        "designations",
        "projects",
        "states",
        "leave_types",
        "leave_requests",
        "payroll_runs",
        "payslips",
        "job_openings",
        "candidates",
        "trainings",
        "performance_reviews",
        "expenses",
        "assets",
        "tickets",
        "notifications",
        "policies",
        "documents",
        "system_settings",
        "audit_logs",
        "password_requests",
    ]

    for collection_name in indexed_collections:
        create_index_safe(
            database[collection_name],
            [("tenant_id", ASCENDING), ("created_at", ASCENDING)],
        )