import logging

from pymongo import MongoClient, ASCENDING


logger = logging.getLogger(__name__)

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
        return collection.create_index(keys, **kwargs)
    except Exception as exc:
        # Keep application startup resilient, but never hide failed protection.
        # The migration script can clean conflicting data/indexes and retry.
        logger.warning(
            "Could not create MongoDB index on %s with keys %s and options %s: %s",
            collection.name,
            keys,
            kwargs,
            exc,
        )
        return None


def active_string_partial_filter(field_name):
    return {
        "is_deleted": False,
        field_name: {
            "$exists": True,
            "$type": "string",
            "$gt": "",
        },
    }


def active_identity_alias_partial_filter():
    return {
        "is_deleted": False,
        "identity_alias_keys": {
            "$exists": True,
            "$type": "array",
        },
    }


def drop_legacy_payroll_period_unique_index(collection):
    """Remove the old organisation-month payroll-run uniqueness constraint.

    Earlier versions allowed only one payroll run for a tenant and period by
    creating a unique ``tenant_id + period_key`` index. Payroll is now split by
    employee, so multiple runs can legitimately exist for the same month.

    Only the exact legacy unique index is removed. Other payroll indexes are
    left untouched.
    """
    try:
        index_information = collection.index_information()
    except Exception:
        return

    expected_keys = [("tenant_id", ASCENDING), ("period_key", ASCENDING)]

    for index_name, definition in index_information.items():
        keys = [tuple(item) for item in definition.get("key", [])]
        if keys != expected_keys or not definition.get("unique"):
            continue

        try:
            collection.drop_index(index_name)
        except Exception:
            # Preserve startup resilience. If removal fails, the application-
            # level employee-period duplicate guard still prevents bad data,
            # but the database administrator should remove the legacy index.
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

    # Tenant-scoped user identity protection.
    # These fields are synchronized from the authoritative employee record.
    create_index_safe(
        database.users,
        [("tenant_id", ASCENDING), ("employee_id", ASCENDING)],
        name="uniq_active_user_tenant_employee_id",
        unique=True,
        partialFilterExpression=active_string_partial_filter("employee_id"),
    )

    create_index_safe(
        database.users,
        [("tenant_id", ASCENDING), ("emp_code", ASCENDING)],
        name="uniq_active_user_tenant_emp_code",
        unique=True,
        partialFilterExpression=active_string_partial_filter("emp_code"),
    )

    create_index_safe(
        database.users,
        [("tenant_id", ASCENDING), ("employee_code", ASCENDING)],
        name="uniq_active_user_tenant_employee_code",
        unique=True,
        partialFilterExpression=active_string_partial_filter("employee_code"),
    )

    # Employees
    # Retain the existing employee-code index for backward compatibility.
    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("emp_code", ASCENDING)],
        unique=True,
        sparse=True,
    )

    # Canonical employee identity protection.
    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("employee_id", ASCENDING)],
        name="uniq_active_employee_tenant_employee_id",
        unique=True,
        partialFilterExpression=active_string_partial_filter("employee_id"),
    )

    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("user_id", ASCENDING)],
        name="uniq_active_employee_tenant_user_id",
        unique=True,
        partialFilterExpression=active_string_partial_filter("user_id"),
    )

    # Cross-field protection. Each active employee stores all code aliases in
    # identity_alias_keys, so the same code cannot be reused in employee_id,
    # employee_code, emp_code, or code for another employee in the same tenant.
    create_index_safe(
        database.employees,
        [("tenant_id", ASCENDING), ("identity_alias_keys", ASCENDING)],
        name="uniq_active_employee_tenant_identity_alias",
        unique=True,
        partialFilterExpression=active_identity_alias_partial_filter(),
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

    # Employee Stories
    # Tenant-first indexes keep company-wide story loading efficient, while the
    # TTL index removes expired story documents automatically in the background.
    # API queries still filter expires_at > now so expiry is immediate even
    # before MongoDB's TTL monitor performs its cleanup pass.
    create_index_safe(
        database.employee_stories,
        [
            ("tenant_id", ASCENDING),
            ("expires_at", ASCENDING),
        ],
        name="employee_stories_tenant_expiry_idx",
    )

    create_index_safe(
        database.employee_stories,
        [
            ("tenant_id", ASCENDING),
            ("employee_user_id", ASCENDING),
            ("expires_at", ASCENDING),
        ],
        name="employee_stories_tenant_user_expiry_idx",
    )

    create_index_safe(
        database.employee_stories,
        [
            ("tenant_id", ASCENDING),
            ("employee_mongo_id", ASCENDING),
            ("created_at", ASCENDING),
        ],
        name="employee_stories_tenant_employee_created_idx",
    )

    create_index_safe(
        database.employee_stories,
        [("expires_at", ASCENDING)],
        name="employee_stories_expiry_ttl",
        expireAfterSeconds=0,
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
    # Multiple runs are allowed for a tenant and payroll period because each
    # run may contain a different employee subset. Remove the legacy unique
    # tenant-period index before creating the replacement lookup index.
    drop_legacy_payroll_period_unique_index(database.payroll_runs)

    create_index_safe(
        database.payroll_runs,
        [
            ("tenant_id", ASCENDING),
            ("period_key", ASCENDING),
            ("created_at", ASCENDING),
        ],
        name="payroll_runs_tenant_period_created_idx",
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "period_key": {"$exists": True},
        },
    )

    # Run codes must remain unique even when several runs exist in one month.
    create_index_safe(
        database.payroll_runs,
        [
            ("tenant_id", ASCENDING),
            ("run_code", ASCENDING),
        ],
        name="payroll_runs_tenant_run_code_unique_idx",
        unique=True,
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "run_code": {"$exists": True, "$type": "string", "$gt": ""},
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

    # An employee may appear only once for a tenant and payroll period,
    # regardless of which monthly run contains the employee.
    create_index_safe(
        database.payslips,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("period_key", ASCENDING),
        ],
        name="payslips_tenant_employee_period_unique_idx",
        unique=True,
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "employee_id": {"$exists": True},
            "period_key": {"$exists": True},
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
    
    # Payroll banking and salary-disbursement lookups:
    # - duplicate active employee bank-account protection
    # - Finance verification queues
    # - idempotent bank-export metadata persistence
    # - payroll-run and payroll-period export history
    create_index_safe(
        database.bank_details,
        [
            ("tenant_id", ASCENDING),
            ("account_number_fingerprint", ASCENDING),
            ("is_active", ASCENDING),
            ("is_deleted", ASCENDING),
        ],
    )

    create_index_safe(
        database.bank_details,
        [
            ("tenant_id", ASCENDING),
            ("verification_status", ASCENDING),
            ("is_active", ASCENDING),
            ("employee_name", ASCENDING),
            ("employee_code", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_bank_exports,
        [
            ("tenant_id", ASCENDING),
            ("export_key", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "export_key": {"$exists": True},
        },
    )

    create_index_safe(
        database.payroll_bank_exports,
        [
            ("tenant_id", ASCENDING),
            ("run_id", ASCENDING),
            ("created_at", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_bank_exports,
        [
            ("tenant_id", ASCENDING),
            ("period_key", ASCENDING),
            ("status", ASCENDING),
            ("created_at", ASCENDING),
        ],
    )

    # Payroll reporting:
    # - official and internal payroll-register queries by period/status
    # - idempotent CSV export metadata
    # - report-type, period and export-status history
    create_index_safe(
        database.payslips,
        [
            ("tenant_id", ASCENDING),
            ("period_key", ASCENDING),
            ("status", ASCENDING),
            ("is_deleted", ASCENDING),
            ("employee_code", ASCENDING),
            ("employee_name", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_report_exports,
        [
            ("tenant_id", ASCENDING),
            ("export_key", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={
            "tenant_id": {"$exists": True},
            "export_key": {"$exists": True},
        },
    )

    create_index_safe(
        database.payroll_report_exports,
        [
            ("tenant_id", ASCENDING),
            ("report_type", ASCENDING),
            ("status", ASCENDING),
            ("created_at", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_report_exports,
        [
            ("tenant_id", ASCENDING),
            ("periods", ASCENDING),
            ("report_type", ASCENDING),
            ("created_at", ASCENDING),
        ],
    )

    # Employee tax declarations:
    # - employee/FY declaration resolution
    # - HR and Finance workflow queues
    # - company-wide financial-year reporting
    create_index_safe(
        database.payroll_tax_declarations,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("financial_year", ASCENDING),
            ("status", ASCENDING),
            ("is_deleted", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_tax_declarations,
        [
            ("tenant_id", ASCENDING),
            ("financial_year", ASCENDING),
            ("status", ASCENDING),
            ("employee_name", ASCENDING),
            ("employee_code", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_tax_declarations,
        [
            ("tenant_id", ASCENDING),
            ("status", ASCENDING),
            ("updated_at", ASCENDING),
        ],
    )

    # TDS instructions:
    # - only one active instruction per employee/FY
    # - effective payroll-period resolution
    # - fingerprint-based duplicate protection
    # - Finance instruction history
    create_index_safe(
        database.payroll_tax_instructions,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("financial_year", ASCENDING),
        ],
        unique=True,
        partialFilterExpression={
            "status": "active",
            "is_deleted": False,
        },
    )

    create_index_safe(
        database.payroll_tax_instructions,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("financial_year", ASCENDING),
            ("status", ASCENDING),
            ("effective_from_period", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_tax_instructions,
        [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
            ("fingerprint", ASCENDING),
            ("status", ASCENDING),
            ("is_deleted", ASCENDING),
        ],
    )

    create_index_safe(
        database.payroll_tax_instructions,
        [
            ("tenant_id", ASCENDING),
            ("financial_year", ASCENDING),
            ("status", ASCENDING),
            ("created_at", ASCENDING),
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
    ]

    for collection_name in indexed_collections:
        create_index_safe(
            database[collection_name],
            [("tenant_id", ASCENDING), ("created_at", ASCENDING)],
        )