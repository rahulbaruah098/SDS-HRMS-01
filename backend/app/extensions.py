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
    # Tenants
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

    # Users
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
        [("tenant_id", ASCENDING), ("role", ASCENDING)],
    )

    create_index_safe(
        database.users,
        [("tenant_id", ASCENDING), ("is_active", ASCENDING)],
    )

    # Employees
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
        [("tenant_id", ASCENDING), ("designation", ASCENDING)],
    )

    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("department", ASCENDING)],
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
        database.employees,
        [("tenant_id", ASCENDING), ("is_team_leader", ASCENDING)],
    )

    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("is_reporting_officer", ASCENDING)],
    )

    # IT Support employee capability indexes:
    # These will support tenant-wise IT Head / IT Assistant assignment.
    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("is_it_support_head", ASCENDING)],
    )

    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("is_it_support_member", ASCENDING)],
    )

    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("department", ASCENDING), ("is_it_support_member", ASCENDING)],
    )

    # Attendance
    create_index_safe(
        database.attendance_logs,
        [("tenant_id", ASCENDING), ("employee_id", ASCENDING), ("date", ASCENDING)],
        unique=True,
    )

    create_index_safe(
        database.attendance_logs,
        [("tenant_id", ASCENDING), ("date", ASCENDING)],
    )

    # Leave / expense / existing tickets
    create_index_safe(
        database.leave_requests,
        [("tenant_id", ASCENDING), ("employee_id", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.leave_requests,
        [("tenant_id", ASCENDING), ("team_leader_id", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.leave_requests,
        [("tenant_id", ASCENDING), ("reporting_officer_id", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.expenses,
        [("tenant_id", ASCENDING), ("employee_id", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.tickets,
        [("tenant_id", ASCENDING), ("raised_by", ASCENDING), ("status", ASCENDING)],
    )

    # Grievance module:
    # Employee grievance submission, anonymous grievance, HR/Admin inbox.
    create_index_safe(
        database.grievances,
        [("tenant_id", ASCENDING), ("employee_id", ASCENDING), ("created_at", ASCENDING)],
    )

    create_index_safe(
        database.grievances,
        [("tenant_id", ASCENDING), ("employee_user_id", ASCENDING), ("created_at", ASCENDING)],
    )

    create_index_safe(
        database.grievances,
        [("tenant_id", ASCENDING), ("status", ASCENDING), ("created_at", ASCENDING)],
    )

    create_index_safe(
        database.grievances,
        [("tenant_id", ASCENDING), ("priority", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.grievances,
        [("tenant_id", ASCENDING), ("grievance_type", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.grievances,
        [("tenant_id", ASCENDING), ("ticket_no", ASCENDING)],
    )

    create_index_safe(
        database.grievances,
        [("tenant_id", ASCENDING), ("is_anonymous", ASCENDING), ("created_at", ASCENDING)],
    )

    # Asset module:
    # Employee and HR/Admin submitted hardware/software asset records.
    # HR/Admin can report employee-wise asset allocation.
    create_index_safe(
        database.assets,
        [("tenant_id", ASCENDING), ("assigned_to_employee_id", ASCENDING), ("created_at", ASCENDING)],
    )

    create_index_safe(
        database.assets,
        [("tenant_id", ASCENDING), ("assigned_to_user_id", ASCENDING), ("created_at", ASCENDING)],
    )

    create_index_safe(
        database.assets,
        [("tenant_id", ASCENDING), ("asset_type", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.assets,
        [("tenant_id", ASCENDING), ("verification_status", ASCENDING), ("created_at", ASCENDING)],
    )

    create_index_safe(
        database.assets,
        [("tenant_id", ASCENDING), ("asset_code", ASCENDING)],
        sparse=True,
    )

    create_index_safe(
        database.assets,
        [("tenant_id", ASCENDING), ("serial_no", ASCENDING)],
        sparse=True,
    )

    create_index_safe(
        database.assets,
        [("tenant_id", ASCENDING), ("license_key", ASCENDING)],
        sparse=True,
    )

    # IT Support module:
    # Tenant-wise IT ticket submission, IT Head assignment, IT member status updates,
    # employee review after resolution.
    create_index_safe(
        database.it_support_tickets,
        [("tenant_id", ASCENDING), ("created_by_employee_id", ASCENDING), ("created_at", ASCENDING)],
    )

    create_index_safe(
        database.it_support_tickets,
        [("tenant_id", ASCENDING), ("created_by_user_id", ASCENDING), ("created_at", ASCENDING)],
    )

    create_index_safe(
        database.it_support_tickets,
        [("tenant_id", ASCENDING), ("assigned_to_employee_id", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.it_support_tickets,
        [("tenant_id", ASCENDING), ("assigned_to_user_id", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.it_support_tickets,
        [("tenant_id", ASCENDING), ("assigned_by_employee_id", ASCENDING), ("created_at", ASCENDING)],
    )

    create_index_safe(
        database.it_support_tickets,
        [("tenant_id", ASCENDING), ("status", ASCENDING), ("created_at", ASCENDING)],
    )

    create_index_safe(
        database.it_support_tickets,
        [("tenant_id", ASCENDING), ("priority", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.it_support_tickets,
        [("tenant_id", ASCENDING), ("issue_category", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.it_support_tickets,
        [("tenant_id", ASCENDING), ("ticket_no", ASCENDING)],
    )

    # Password requests
    create_index_safe(
        database.password_requests,
        [("user_id", ASCENDING), ("status", ASCENDING)],
    )

    create_index_safe(
        database.password_requests,
        [("created_at", ASCENDING)],
    )

        # Policies
    create_index_safe(
        database.policies,
        [("tenant_id", ASCENDING), ("document_id", ASCENDING)],
        unique=True,
    )

    create_index_safe(
        database.policies,
        [("tenant_id", ASCENDING), ("status", ASCENDING), ("created_at", ASCENDING)],
    )
    
        # Celebrations
    create_index_safe(
        database.celebrations,
        [
            ("tenant_id", ASCENDING),
            ("event_type", ASCENDING),
            ("employee_id", ASCENDING),
            ("date_key", ASCENDING),
        ],
        unique=True,
    )

    create_index_safe(
        database.celebrations,
        [
            ("tenant_id", ASCENDING),
            ("date_key", ASCENDING),
            ("status", ASCENDING),
        ],
    )

    create_index_safe(
        database.celebrations,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("date_key", ASCENDING),
        ],
    )

    create_index_safe(
        database.notifications,
        [
            ("user_id", ASCENDING),
            ("target", ASCENDING),
            ("meta.celebration_id", ASCENDING),
        ],
    )
    
    
    # Master data duplicate safety
    create_index_safe(
        database.departments,
        [("tenant_id", ASCENDING), ("name", ASCENDING)],
    )

    create_index_safe(
        database.designations,
        [("tenant_id", ASCENDING), ("title", ASCENDING)],
    )

    create_index_safe(
        database.projects,
        [("tenant_id", ASCENDING), ("name", ASCENDING)],
    )

    create_index_safe(
        database.states,
        [("tenant_id", ASCENDING), ("name", ASCENDING)],
    )

    # Generic tenant/date indexes
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
        "grievances",
        "it_support_tickets",
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