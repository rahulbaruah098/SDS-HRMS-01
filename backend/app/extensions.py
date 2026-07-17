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
    
        # Payroll configuration and processing indexes

    # Employee salary structures:
    # - one revision number per employee
    # - efficient effective-date and revision-history lookups
    create_index_safe(
        database.salary_structures,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("version", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "employee_id": {"$exists": True},
            "version": {"$exists": True},
        },
    )

    create_index_safe(
        database.salary_structures,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("status", ASCENDING),
            ("effective_from", ASCENDING),
        ],
    )

    create_index_safe(
        database.salary_structures,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("is_deleted", ASCENDING),
            ("version", ASCENDING),
        ],
    )

    # State-wise statutory configuration:
    # - one revision number per state and tenant
    # - efficient active-rule resolution by effective date
    create_index_safe(
        database.statutory_configs,
        [
            ("tenant_id", ASCENDING),
            ("state_code", ASCENDING),
            ("version", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "state_code": {"$exists": True},
            "version": {"$exists": True},
        },
    )

    create_index_safe(
        database.statutory_configs,
        [
            ("tenant_id", ASCENDING),
            ("state_code", ASCENDING),
            ("status", ASCENDING),
            ("effective_from", ASCENDING),
        ],
    )

    # Payroll attendance summaries:
    # one summary per employee for each payroll period
    create_index_safe(
        database.attendance_summaries,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("period_key", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "employee_id": {"$exists": True},
            "period_key": {"$exists": True},
        },
    )

    create_index_safe(
        database.attendance_summaries,
        [
            ("tenant_id", ASCENDING),
            ("period_key", ASCENDING),
            ("sync_status", ASCENDING),
        ],
    )

    # Monthly payroll runs:
    # one authoritative payroll run per tenant and payroll period
    create_index_safe(
        database.payroll_runs,
        [
            ("tenant_id", ASCENDING),
            ("period_key", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "period_key": {"$exists": True},
        },
    )

    create_index_safe(
        database.payroll_runs,
        [
            ("tenant_id", ASCENDING),
            ("status", ASCENDING),
            ("period_key", ASCENDING),
        ],
    )

    # Employee payslips:
    # one payslip per employee inside a payroll run
    create_index_safe(
        database.payslips,
        [
            ("tenant_id", ASCENDING),
            ("run_id", ASCENDING),
            ("employee_id", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "run_id": {"$exists": True},
            "employee_id": {"$exists": True},
        },
    )

    create_index_safe(
        database.payslips,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("period_key", ASCENDING),
            ("status", ASCENDING),
        ],
    )

    create_index_safe(
        database.payslips,
        [
            ("tenant_id", ASCENDING),
            ("run_id", ASCENDING),
            ("status", ASCENDING),
        ],
    )

    # Loans and salary advances
    create_index_safe(
        database.loans_advances,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("status", ASCENDING),
            ("created_at", ASCENDING),
        ],
    )

    # Payroll loan and advance recovery lookups:
    # - employee-wise active recovery resolution
    # - payroll-period eligibility resolution
    # - employee-code fallback resolution
    # - immutable payslip reference lookup for locked/disbursed payroll
    create_index_safe(
        database.loans_advances,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("status", ASCENDING),
            ("recovery_start_period", ASCENDING),
        ],
    )

    create_index_safe(
        database.loans_advances,
        [
            ("tenant_id", ASCENDING),
            ("status", ASCENDING),
            ("recovery_start_period", ASCENDING),
            ("recovery_end_period", ASCENDING),
        ],
    )

    create_index_safe(
        database.loans_advances,
        [
            ("tenant_id", ASCENDING),
            ("employee_code", ASCENDING),
            ("status", ASCENDING),
        ],
    )

    create_index_safe(
        database.payslips,
        [
            ("tenant_id", ASCENDING),
            ("advance_details.reference_id", ASCENDING),
            ("status", ASCENDING),
            ("period_key", ASCENDING),
        ],
    )

    # Payroll reimbursement workflow and payroll-inclusion lookups:
    # - employee claim history and status filtering
    # - HR/Finance workflow queues
    # - employee/payroll-period eligibility resolution
    # - payroll-run reservation and payment completion
    # - immutable payslip reimbursement reference lookup
    create_index_safe(
        database.payroll_reimbursements,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("status", ASCENDING),
            ("created_at", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_reimbursements,
        [
            ("tenant_id", ASCENDING),
            ("status", ASCENDING),
            ("created_at", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_reimbursements,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("payment_mode", ASCENDING),
            ("payroll_period", ASCENDING),
            ("status", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_reimbursements,
        [
            ("tenant_id", ASCENDING),
            ("scheduled_run_id", ASCENDING),
            ("scheduled_period", ASCENDING),
            ("status", ASCENDING),
        ],
    )

    create_index_safe(
        database.payslips,
        [
            ("tenant_id", ASCENDING),
            ("reimbursement_details.reference_id", ASCENDING),
            ("status", ASCENDING),
            ("period_key", ASCENDING),
        ],
    )

    # Employee bank details:
    # one active bank-detail record per employee
    create_index_safe(
        database.bank_details,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "employee_id": {"$exists": True},
        },
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