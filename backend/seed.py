from datetime import datetime
from werkzeug.security import generate_password_hash

from app import create_app
from app.extensions import get_db
from app.routes.superadmin import seed_company_masters


app = create_app()


SUPPORTED_HOLIDAY_STATES = [
    "Assam(HO)",
    "Manipur",
    "Mizoram",
    "Arunachal Pradesh",
]


def now():
    return datetime.utcnow()


def normalize_text(value):
    return str(value or "").strip()


def normalize_state(value):
    state = normalize_text(value)

    if not state:
        return "Assam(HO)"

    lowered = state.lower()

    if lowered in ["assam", "assam ho", "assam(ho)", "ho", "assam/guwahati (ho)"]:
        return "Assam(HO)"

    for allowed in SUPPORTED_HOLIDAY_STATES:
        if lowered == allowed.lower():
            return allowed

    return state


def employee_profile_defaults(row):
    state = normalize_state(row.get("state") or row.get("branch") or "Assam(HO)")

    return {
        "avatar": "",
        "phone": row.get("phone", ""),
        "country": row.get("country", "India"),
        "joining_date": row.get("joining_date", "2026-01-01"),
        "date_of_birth": row.get("date_of_birth", ""),
        "blood_group": row.get("blood_group", ""),
        "gross_salary": str(row.get("gross_salary", row.get("salary", ""))),
        "branch": row.get("branch", state),
        "aadhar_no": row.get("aadhar_no", ""),
        "employee_uan_no": row.get("employee_uan_no", ""),
        "employee_type": row.get("employee_type", "Permanent"),
        "skill_level": row.get("skill_level", ""),
        "are_parents_senior_citizen": row.get("are_parents_senior_citizen", "false"),
        "number_of_children": row.get("number_of_children", ""),
        "payment_mode": row.get("payment_mode", "Bank Transfer"),
        "previous_designation": row.get("previous_designation", ""),
        "previous_employment_tenure_end_date": row.get(
            "previous_employment_tenure_end_date",
            "",
        ),
        "role": row.get("role", "Employee"),
        "shift": row.get("shift", "General"),
        "gender": row.get("gender", ""),
        "address": row.get("address", "Guwahati, Assam"),
        "religion": row.get("religion", ""),
        "marital_status": row.get("marital_status", ""),
        "speak_language": row.get("speak_language", "English, Assamese, Hindi"),
        "pan_no": row.get("pan_no", ""),
        "disability_level": row.get("disability_level", "No Disability"),
        "employee_esic_ip": row.get("employee_esic_ip", ""),
        "employment_status": row.get("employment_status", "Active"),
        "father_name": row.get("father_name", ""),
        "dependent_disability_level": row.get(
            "dependent_disability_level",
            "No Disability",
        ),
        "children_in_hostel": row.get("children_in_hostel", ""),
        "previous_employer_name": row.get("previous_employer_name", ""),
        "previous_employment_tenure_from_date": row.get(
            "previous_employment_tenure_from_date",
            "",
        ),
        "state": state,
    }


def create_leave_balance(db, tenant_id, employee_id, employee_name, department, designation, leave_type, total):
    total_value = float(total or 0)

    db.leave_balances.insert_one({
        "tenant_id": tenant_id,
        "employee_id": employee_id,
        "employee_name": employee_name,
        "department": department,
        "designation": designation,
        "leave_type": leave_type,
        "opening_balance": total_value,
        "credited": total_value,
        "used": 0.0,
        "available": total_value,
        "status": "active",
        "created_at": now(),
    })


def create_default_leave_balances(db, tenant_id, employee):
    employee_id = str(employee["_id"])

    create_leave_balance(
        db,
        tenant_id,
        employee_id,
        employee.get("name", ""),
        employee.get("department", ""),
        employee.get("designation", ""),
        "CL",
        8,
    )

    create_leave_balance(
        db,
        tenant_id,
        employee_id,
        employee.get("name", ""),
        employee.get("department", ""),
        employee.get("designation", ""),
        "EL",
        12,
    )


with app.app_context():
    db = get_db()
    tenant_id = "sds"

    collections_to_clear = [
        "tenants",
        "users",
        "employees",
        "departments",
        "designations",
        "projects",
        "states",
        "leave_types",
        "leave_balances",
        "leave_requests",
        "holiday_calendar",
        "attendance_logs",
        "attendance_mode_requests",
        "compoff_credits",
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

    for collection in collections_to_clear:
        db[collection].delete_many({})

    db.tenants.insert_one({
        "tenant_id": "sds",
        "name": "Sayanant Development Services",
        "domain": "sdshr.in",
        "contact_email": "admin@sdshr.in",
        "status": "active",
        "plan": "Internal",
        "created_at": now(),
    })

    db.tenants.insert_one({
        "tenant_id": "demo-company",
        "name": "Demo Client Company",
        "domain": "demo.sdshr.in",
        "contact_email": "clientadmin@example.com",
        "status": "active",
        "plan": "Trial",
        "created_at": now(),
    })

    seed_company_masters(db, "sds")
    seed_company_masters(db, "demo-company")

    users = [
        (
            "Platform Super Admin",
            "superadmin@sdshr.in",
            "Super@123",
            ["super_admin"],
            "platform",
        ),
        (
            "SDS Admin",
            "admin@sdshr.in",
            "Admin@123",
            ["admin", "hr_manager", "accounts_finance"],
            "sds",
        ),
        (
            "HR Manager",
            "hr@sdshr.in",
            "Hr@123",
            ["hr_admin", "hr_manager", "hr", "reporting_officer"],
            "sds",
        ),
        (
            "Finance User",
            "finance@sdshr.in",
            "Finance@123",
            ["finance", "accounts_finance"],
            "sds",
        ),
        (
            "Manager User",
            "manager@sdshr.in",
            "Manager@123",
            ["manager", "team_leader", "reporting_officer"],
            "sds",
        ),
        (
            "Employee User",
            "employee@sdshr.in",
            "Employee@123",
            ["employee"],
            "sds",
        ),
        (
            "Field Employee",
            "field@sdshr.in",
            "Field@123",
            ["employee"],
            "sds",
        ),
        (
            "Client Company Admin",
            "clientadmin@example.com",
            "Client@123",
            ["admin", "hr_manager", "reporting_officer"],
            "demo-company",
        ),
    ]

    uids = {}

    for name, email, password, roles, tenant in users:
        res = db.users.insert_one({
            "tenant_id": tenant,
            "name": name,
            "email": email,
            "password_hash": generate_password_hash(password),
            "roles": roles,
            "is_active": True,
            "created_at": now(),
        })

        uids[email] = str(res.inserted_id)

    employee_rows = [
        {
            "employee_id": "SDS-EMP-001",
            "emp_code": "SDS001",
            "name": "SDS Admin",
            "email": "admin@sdshr.in",
            "phone": "9000000001",
            "department": "HR & Admin",
            "designation": "Managing Director",
            "role": "Admin",
            "salary": 120000,
            "gross_salary": 120000,
            "tenant_id": "sds",
            "gender": "Male",
            "state": "Assam(HO)",
            "branch": "Assam(HO)",
            "is_team_leader": "false",
            "is_reporting_officer": "true",
        },
        {
            "employee_id": "SDS-EMP-002",
            "emp_code": "SDS002",
            "name": "HR Manager",
            "email": "hr@sdshr.in",
            "phone": "9000000002",
            "department": "HR & Admin",
            "designation": "Manager",
            "role": "HR",
            "salary": 65000,
            "gross_salary": 65000,
            "tenant_id": "sds",
            "gender": "Female",
            "state": "Assam(HO)",
            "branch": "Assam(HO)",
            "is_team_leader": "false",
            "is_reporting_officer": "true",
        },
        {
            "employee_id": "SDS-EMP-003",
            "emp_code": "SDS003",
            "name": "Finance User",
            "email": "finance@sdshr.in",
            "phone": "9000000003",
            "department": "Finance & Accounts",
            "designation": "Executive",
            "role": "Employee",
            "salary": 50000,
            "gross_salary": 50000,
            "tenant_id": "sds",
            "gender": "Male",
            "state": "Assam(HO)",
            "branch": "Assam(HO)",
            "is_team_leader": "false",
            "is_reporting_officer": "false",
        },
        {
            "employee_id": "SDS-EMP-004",
            "emp_code": "SDS004",
            "name": "Manager User",
            "email": "manager@sdshr.in",
            "phone": "9000000004",
            "department": "Operations",
            "designation": "Manager",
            "role": "Manager",
            "salary": 60000,
            "gross_salary": 60000,
            "tenant_id": "sds",
            "gender": "Male",
            "state": "Assam(HO)",
            "branch": "Assam(HO)",
            "is_team_leader": "true",
            "is_reporting_officer": "true",
        },
        {
            "employee_id": "SDS-EMP-005",
            "emp_code": "SDS005",
            "name": "Employee User",
            "email": "employee@sdshr.in",
            "phone": "9000000005",
            "department": "Operations",
            "designation": "Associate",
            "role": "Employee",
            "salary": 35000,
            "gross_salary": 35000,
            "tenant_id": "sds",
            "gender": "Male",
            "state": "Assam(HO)",
            "branch": "Assam(HO)",
            "is_team_leader": "false",
            "is_reporting_officer": "false",
        },
        {
            "employee_id": "SDS-EMP-006",
            "emp_code": "SDS006",
            "name": "Field Employee",
            "email": "field@sdshr.in",
            "phone": "9000000006",
            "department": "Operations",
            "designation": "Associate",
            "role": "Employee",
            "salary": 32000,
            "gross_salary": 32000,
            "tenant_id": "sds",
            "gender": "Female",
            "state": "Manipur",
            "branch": "Manipur",
            "is_team_leader": "false",
            "is_reporting_officer": "false",
        },
        {
            "employee_id": "DEMO-EMP-001",
            "emp_code": "DEMO001",
            "name": "Client Company Admin",
            "email": "clientadmin@example.com",
            "phone": "9000000101",
            "department": "HR & Admin",
            "designation": "Manager",
            "role": "Admin",
            "salary": 70000,
            "gross_salary": 70000,
            "tenant_id": "demo-company",
            "gender": "Male",
            "state": "Arunachal Pradesh",
            "branch": "Arunachal Pradesh",
            "is_team_leader": "false",
            "is_reporting_officer": "true",
        },
    ]

    eids = {}

    for row in employee_rows:
        email = row["email"]
        profile_defaults = employee_profile_defaults(row)

        employee_doc = {
            **profile_defaults,
            "tenant_id": row["tenant_id"],
            "user_id": uids[email],
            "employee_id": row["employee_id"],
            "emp_code": row["emp_code"],
            "name": row["name"],
            "email": email,
            "phone": row.get("phone", ""),
            "department": row["department"],
            "designation": row["designation"],
            "role": row.get("role", "Employee"),
            "job_type": "Regular",
            "project": "SFAC",
            "state": normalize_state(row.get("state")),
            "branch": normalize_state(row.get("branch") or row.get("state")),
            "doj": row.get("joining_date", "2026-01-01"),
            "joining_date": row.get("joining_date", "2026-01-01"),
            "status": "Active",
            "employment_status": "Active",
            "salary": row["salary"],
            "gross_salary": str(row.get("gross_salary", row["salary"])),
            "is_team_leader": row["is_team_leader"],
            "is_reporting_officer": row["is_reporting_officer"],
            "team_leader_id": "",
            "team_leader_name": "",
            "reporting_officer_id": "",
            "reporting_officer_name": "",
            "created_at": now(),
        }

        res = db.employees.insert_one(employee_doc)
        eids[email] = str(res.inserted_id)

    employee_manager_map = {
        "employee@sdshr.in": {
            "team_leader_id": eids.get("manager@sdshr.in", ""),
            "team_leader_name": "Manager User",
            "reporting_officer_id": eids.get("hr@sdshr.in", ""),
            "reporting_officer_name": "HR Manager",
        },
        "finance@sdshr.in": {
            "team_leader_id": eids.get("manager@sdshr.in", ""),
            "team_leader_name": "Manager User",
            "reporting_officer_id": eids.get("hr@sdshr.in", ""),
            "reporting_officer_name": "HR Manager",
        },
        "field@sdshr.in": {
            "team_leader_id": eids.get("manager@sdshr.in", ""),
            "team_leader_name": "Manager User",
            "reporting_officer_id": eids.get("hr@sdshr.in", ""),
            "reporting_officer_name": "HR Manager",
        },
    }

    for email, mapping in employee_manager_map.items():
        db.employees.update_one(
            {"email": email},
            {
                "$set": {
                    **mapping,
                    "updated_at": now(),
                }
            },
        )

    refreshed_employees = list(db.employees.find({}))

    for employee in refreshed_employees:
        create_default_leave_balances(
            db,
            employee.get("tenant_id", "sds"),
            employee,
        )

    db.leave_requests.insert_one({
        "tenant_id": tenant_id,
        "employee_id": eids["employee@sdshr.in"],
        "employee_name": "Employee User",
        "department": "Operations",
        "designation": "Associate",
        "team_leader_id": eids["manager@sdshr.in"],
        "team_leader_name": "Manager User",
        "reporting_officer_id": eids["hr@sdshr.in"],
        "reporting_officer_name": "HR Manager",
        "leave_type": "CL",
        "from_date": "2026-05-10",
        "to_date": "2026-05-11",
        "leave_days": 2,
        "reason": "Personal work",
        "status": "pending",
        "approval_stage": "team_leader",
        "approval_stage_label": "Team Leader",
        "approval_history": [],
        "balance_deducted": False,
        "created_at": now(),
    })

    db.leave_requests.insert_one({
        "tenant_id": tenant_id,
        "employee_id": eids["field@sdshr.in"],
        "employee_name": "Field Employee",
        "department": "Operations",
        "designation": "Associate",
        "team_leader_id": eids["manager@sdshr.in"],
        "team_leader_name": "Manager User",
        "reporting_officer_id": eids["hr@sdshr.in"],
        "reporting_officer_name": "HR Manager",
        "leave_type": "CL",
        "from_date": "2026-05-12",
        "to_date": "2026-05-12",
        "leave_days": 0.5,
        "reason": "Half-day personal work",
        "status": "pending",
        "approval_stage": "team_leader",
        "approval_stage_label": "Team Leader",
        "approval_history": [],
        "balance_deducted": False,
        "created_at": now(),
    })

    db.holiday_calendar.insert_one({
        "tenant_id": tenant_id,
        "state": "Assam(HO)",
        "date": "2026-05-08",
        "title": "Bohag Bihu",
        "message": "Bohag Bihu holiday for Assam(HO). Wishing everyone a joyful celebration.",
        "status": "active",
        "created_at": now(),
        "created_by": uids["hr@sdshr.in"],
    })

    db.holiday_calendar.insert_one({
        "tenant_id": tenant_id,
        "state": "Manipur",
        "date": "2026-05-09",
        "title": "State Holiday",
        "message": "Holiday configured for Manipur employees.",
        "status": "active",
        "created_at": now(),
        "created_by": uids["hr@sdshr.in"],
    })

    db.attendance_mode_requests.insert_one({
        "tenant_id": tenant_id,
        "employee_id": eids["employee@sdshr.in"],
        "employee_name": "Employee User",
        "department": "Operations",
        "designation": "Associate",
        "team_leader_id": eids["manager@sdshr.in"],
        "team_leader_name": "Manager User",
        "reporting_officer_id": eids["hr@sdshr.in"],
        "reporting_officer_name": "HR Manager",
        "mode": "wfh",
        "date": "2026-05-08",
        "reason": "Need to work from home due to personal work.",
        "field_location": "",
        "status": "approved",
        "decision_note": "Approved for demo.",
        "decided_at": now(),
        "decided_by": uids["manager@sdshr.in"],
        "decided_by_name": "Manager User",
        "created_at": now(),
        "updated_at": now(),
    })

    db.attendance_mode_requests.insert_one({
        "tenant_id": tenant_id,
        "employee_id": eids["field@sdshr.in"],
        "employee_name": "Field Employee",
        "department": "Operations",
        "designation": "Associate",
        "team_leader_id": eids["manager@sdshr.in"],
        "team_leader_name": "Manager User",
        "reporting_officer_id": eids["hr@sdshr.in"],
        "reporting_officer_name": "HR Manager",
        "mode": "field",
        "date": "2026-05-08",
        "reason": "Client field visit.",
        "field_location": "Imphal field office",
        "status": "pending",
        "created_at": now(),
        "updated_at": now(),
    })

    db.attendance_logs.insert_one({
        "tenant_id": tenant_id,
        "employee_id": eids["employee@sdshr.in"],
        "employee_name": "Employee User",
        "department": "Operations",
        "designation": "Associate",
        "state": "Assam(HO)",
        "team_leader_id": eids["manager@sdshr.in"],
        "team_leader_name": "Manager User",
        "reporting_officer_id": eids["hr@sdshr.in"],
        "reporting_officer_name": "HR Manager",
        "date": "2026-05-07",
        "check_in": now(),
        "check_out": None,
        "office_start": "09:30",
        "late_cutoff": "09:50",
        "office_end": "18:00",
        "mode": "office",
        "field_location": "",
        "late_reason": "",
        "early_checkout_reason": "",
        "check_in_location": {
            "latitude": 26.1445,
            "longitude": 91.7362,
            "accuracy": 25,
            "address": "Guwahati, Assam",
        },
        "check_out_location": None,
        "is_late": False,
        "is_early_checkout": False,
        "is_holiday_work": False,
        "holiday_title": "",
        "holiday_message": "",
        "status": "present",
        "verified_by_ro": False,
        "timeline": [],
        "created_at": now(),
        "updated_at": now(),
    })

    db.attendance_logs.insert_one({
        "tenant_id": tenant_id,
        "employee_id": eids["finance@sdshr.in"],
        "employee_name": "Finance User",
        "department": "Finance & Accounts",
        "designation": "Executive",
        "state": "Assam(HO)",
        "team_leader_id": eids["manager@sdshr.in"],
        "team_leader_name": "Manager User",
        "reporting_officer_id": eids["hr@sdshr.in"],
        "reporting_officer_name": "HR Manager",
        "date": "2026-05-07",
        "check_in": now(),
        "check_out": now(),
        "office_start": "09:30",
        "late_cutoff": "09:50",
        "office_end": "18:00",
        "mode": "office",
        "field_location": "",
        "late_reason": "Traffic delay",
        "early_checkout_reason": "",
        "check_in_location": {
            "latitude": 26.1445,
            "longitude": 91.7362,
            "accuracy": 28,
            "address": "Guwahati, Assam",
        },
        "check_out_location": {
            "latitude": 26.1445,
            "longitude": 91.7362,
            "accuracy": 28,
            "address": "Guwahati, Assam",
        },
        "is_late": True,
        "is_early_checkout": False,
        "is_holiday_work": False,
        "holiday_title": "",
        "holiday_message": "",
        "status": "late",
        "verified_by_ro": True,
        "timeline": [],
        "created_at": now(),
        "updated_at": now(),
    })

    db.compoff_credits.insert_one({
        "tenant_id": tenant_id,
        "employee_id": eids["employee@sdshr.in"],
        "employee_name": "Employee User",
        "department": "Operations",
        "designation": "Associate",
        "team_leader_id": eids["manager@sdshr.in"],
        "team_leader_name": "Manager User",
        "reporting_officer_id": eids["hr@sdshr.in"],
        "reporting_officer_name": "HR Manager",
        "source_attendance_id": "",
        "earned_date": "2026-05-03",
        "valid_until": "2026-08-01",
        "leave_days": 1.0,
        "status": "available",
        "holiday_title": "Sunday Holiday",
        "holiday_message": "Worked on weekly holiday.",
        "created_at": now(),
        "updated_at": now(),
    })

    db.expenses.insert_one({
        "tenant_id": tenant_id,
        "employee_id": eids["employee@sdshr.in"],
        "employee_name": "Employee User",
        "department": "Operations",
        "designation": "Associate",
        "type": "Local Conveyance",
        "amount": 850,
        "description": "Field visit travel",
        "status": "pending",
        "created_at": now(),
    })

    db.tickets.insert_one({
        "tenant_id": tenant_id,
        "raised_by": eids["employee@sdshr.in"],
        "raised_by_name": "Employee User",
        "title": "Laptop issue",
        "category": "IT",
        "description": "System is slow",
        "priority": "medium",
        "status": "open",
        "comments": [],
        "created_at": now(),
    })

    db.assets.insert_one({
        "tenant_id": tenant_id,
        "name": "Dell Laptop",
        "type": "Laptop",
        "serial_no": "SDS-LAP-001",
        "status": "assigned",
        "assigned_to": eids["employee@sdshr.in"],
        "created_at": now(),
    })

    db.job_openings.insert_one({
        "tenant_id": tenant_id,
        "title": "Field Coordinator",
        "department": "Operations",
        "description": "Project field coordination",
        "status": "open",
        "created_at": now(),
    })

    db.candidates.insert_one({
        "tenant_id": tenant_id,
        "name": "Candidate One",
        "email": "candidate@example.com",
        "phone": "9999999999",
        "status": "shortlisted",
        "created_at": now(),
    })

    db.trainings.insert_one({
        "tenant_id": tenant_id,
        "name": "HRMS Induction",
        "venue": "Guwahati",
        "trainer": "HR Team",
        "duration": "1 day",
        "status": "scheduled",
        "created_at": now(),
    })

    db.performance_reviews.insert_one({
        "tenant_id": tenant_id,
        "employee_id": eids["employee@sdshr.in"],
        "employee_name": "Employee User",
        "department": "Operations",
        "designation": "Associate",
        "cycle": "May 2026",
        "rating": 4,
        "comments": "Good progress in assigned operational tasks.",
        "reviewer_id": uids["manager@sdshr.in"],
        "reviewer_employee_id": eids["manager@sdshr.in"],
        "reviewer_name": "Manager User",
        "reviewer_role": "team_leader",
        "visibility": ["md", "hr", "employee_self"],
        "status": "submitted",
        "created_by": uids["manager@sdshr.in"],
        "created_at": now(),
    })

    db.performance_reviews.insert_one({
        "tenant_id": tenant_id,
        "employee_id": eids["employee@sdshr.in"],
        "employee_name": "Employee User",
        "department": "Operations",
        "designation": "Associate",
        "cycle": "May 2026",
        "rating": 4.5,
        "comments": "Consistent attendance and good field coordination.",
        "reviewer_id": uids["hr@sdshr.in"],
        "reviewer_employee_id": eids["hr@sdshr.in"],
        "reviewer_name": "HR Manager",
        "reviewer_role": "reporting_officer",
        "visibility": ["md", "hr", "employee_self"],
        "status": "submitted",
        "created_by": uids["hr@sdshr.in"],
        "created_at": now(),
    })

    db.notifications.insert_one({
        "tenant_id": tenant_id,
        "user_id": uids["employee@sdshr.in"],
        "title": "Welcome to SDS HRMS",
        "body": "Your employee self-service dashboard is active.",
        "read": False,
        "status": "unread",
        "created_at": now(),
    })

    db.notifications.insert_one({
        "tenant_id": tenant_id,
        "user_id": uids["hr@sdshr.in"],
        "title": "Comp-Off Earned",
        "body": "Employee User worked on a holiday and earned one comp-off.",
        "read": False,
        "status": "unread",
        "created_at": now(),
    })

    db.policies.insert_one({
        "tenant_id": tenant_id,
        "title": "Attendance Policy",
        "category": "HR",
        "summary": "Office timing is 09:30 AM to 06:00 PM. Check-in from 09:50 AM requires a late reason.",
        "status": "published",
        "created_at": now(),
    })

    print("Seed completed")
    print("Super Admin: superadmin@sdshr.in / Super@123")
    print("Admin: admin@sdshr.in / Admin@123")
    print("HR: hr@sdshr.in / Hr@123")
    print("Finance: finance@sdshr.in / Finance@123")
    print("Manager / Team Leader: manager@sdshr.in / Manager@123")
    print("Employee: employee@sdshr.in / Employee@123")
    print("Field Employee: field@sdshr.in / Field@123")
    print("Demo Company Admin: clientadmin@example.com / Client@123")