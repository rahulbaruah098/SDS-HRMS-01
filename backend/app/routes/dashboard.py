from flask import Blueprint, jsonify, g
from datetime import date

from app.extensions import get_db
from app.utils.auth import current_user_required
from app.utils.serializers import clean_doc


dashboard_bp = Blueprint("dashboard", __name__)


SUPPORTED_HOLIDAY_STATES = [
    "Assam(HO)",
    "Manipur",
    "Mizoram",
    "Arunachal Pradesh",
]


def normalize_roles(value):
    if not value:
        return []

    if isinstance(value, list):
        return [str(role).strip() for role in value if str(role).strip()]

    if isinstance(value, str):
        return [role.strip() for role in value.split(",") if role.strip()]

    return []


def current_roles():
    return set(normalize_roles(g.current_user.get("roles", [])))


def has_role(*allowed_roles):
    return bool(current_roles().intersection(set(allowed_roles)))


def current_tenant_id():
    return getattr(g, "tenant_id", None) or g.current_user.get("tenant_id") or "sds"


def tenant_query(extra=None):
    q = {"tenant_id": current_tenant_id()}
    q.update(extra or {})
    return q


def active_employee_filter(extra=None):
    q = {
        "status": {"$ne": "Inactive"},
        "is_deleted": {"$ne": True},
    }

    q.update(extra or {})
    return q


def count_collection(db, collection, extra=None):
    return db[collection].count_documents(tenant_query(extra))


def normalize_text(value):
    return str(value or "").strip()


def normalize_state(value):
    state = normalize_text(value)

    if not state:
        return "Assam(HO)"

    lowered = state.lower()

    if lowered in [
        "assam",
        "assam ho",
        "assam(ho)",
        "ho",
        "assam/guwahati (ho)",
    ]:
        return "Assam(HO)"

    for allowed in SUPPORTED_HOLIDAY_STATES:
        if lowered == allowed.lower():
            return allowed

    return state


def truthy(value):
    return str(value or "").strip().lower() in ["true", "yes", "1", "on"]


def current_employee(db):
    tenant_id = current_tenant_id()

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": str(g.current_user["_id"]),
        "is_deleted": {"$ne": True},
    })

    if employee:
        return employee

    return db.employees.find_one({
        "user_id": str(g.current_user["_id"]),
        "is_deleted": {"$ne": True},
    })


def employee_state(employee):
    return normalize_state(
        employee.get("state")
        or employee.get("branch")
        or employee.get("work_state")
        or "Assam(HO)"
    )


def is_second_or_fourth_saturday(check_date):
    if check_date.weekday() != 5:
        return False

    saturday_count = 0

    for day in range(1, check_date.day + 1):
        cursor = date(check_date.year, check_date.month, day)

        if cursor.weekday() == 5:
            saturday_count += 1

    return saturday_count in [2, 4]


def weekly_holiday_reason(check_date):
    if check_date.weekday() == 6:
        return {
            "is_holiday": True,
            "holiday_type": "weekly",
            "title": "Sunday Holiday",
            "message": "Sunday is a weekly holiday.",
        }

    if is_second_or_fourth_saturday(check_date):
        return {
            "is_holiday": True,
            "holiday_type": "weekly",
            "title": "Saturday Holiday",
            "message": "Second and fourth Saturday are weekly holidays.",
        }

    return None


def holiday_info_for_employee(db, employee, check_date):
    state = employee_state(employee)
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    date_str = check_date.isoformat()

    manual = db.holiday_calendar.find_one({
        "tenant_id": tenant_id,
        "state": state,
        "date": date_str,
        "status": {"$ne": "inactive"},
        "is_deleted": {"$ne": True},
    })

    if manual:
        return {
            "is_holiday": True,
            "holiday_type": "manual",
            "state": state,
            "title": manual.get("title", "Holiday"),
            "message": manual.get("message", ""),
            "holiday": clean_doc(manual),
        }

    weekly = weekly_holiday_reason(check_date)

    if weekly:
        weekly["state"] = state
        return weekly

    return {
        "is_holiday": False,
        "holiday_type": "",
        "state": state,
        "title": "",
        "message": "",
    }


def available_attendance_modes(db, employee, check_date):
    modes = ["office"]
    tenant_id = employee.get("tenant_id") or current_tenant_id()
    emp_id = str(employee["_id"])
    date_str = check_date.isoformat()

    for mode in ["wfh", "field"]:
        approved = db.attendance_mode_requests.find_one({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "mode": mode,
            "date": date_str,
            "status": "approved",
            "is_deleted": {"$ne": True},
        })

        if approved:
            modes.append(mode)

    return modes


def department_summary(db, tenant_id):
    pipeline = [
        {
            "$match": {
                "tenant_id": tenant_id,
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            }
        },
        {
            "$group": {
                "_id": {"$ifNull": ["$department", "Unassigned"]},
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"count": -1, "_id": 1}},
    ]

    rows = list(db.employees.aggregate(pipeline))

    return [
        {
            "department": row.get("_id") or "Unassigned",
            "count": row.get("count", 0),
        }
        for row in rows
    ]


def designation_summary(db, tenant_id):
    pipeline = [
        {
            "$match": {
                "tenant_id": tenant_id,
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            }
        },
        {
            "$group": {
                "_id": {"$ifNull": ["$designation", "Unassigned"]},
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"count": -1, "_id": 1}},
    ]

    rows = list(db.employees.aggregate(pipeline))

    return [
        {
            "designation": row.get("_id") or "Unassigned",
            "count": row.get("count", 0),
        }
        for row in rows
    ]


def employee_snapshot(employee):
    if not employee:
        return None

    return {
        "_id": employee.get("_id"),
        "tenant_id": employee.get("tenant_id"),
        "user_id": employee.get("user_id"),
        "employee_id": employee.get("employee_id", ""),
        "emp_code": employee.get("emp_code", ""),
        "name": employee.get("name", ""),
        "email": employee.get("email", ""),
        "phone": employee.get("phone", ""),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "role": employee.get("role", ""),
        "branch": employee.get("branch", ""),
        "state": employee_state(employee),
        "shift": employee.get("shift", ""),
        "joining_date": employee.get("joining_date") or employee.get("doj", ""),
        "employment_status": employee.get("employment_status") or employee.get("status", ""),
        "status": employee.get("status", ""),
        "is_team_leader": employee.get("is_team_leader", "false"),
        "is_reporting_officer": employee.get("is_reporting_officer", "false"),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),
    }


def scoped_employee_ids_for_manager(db, tenant_id, emp_id, roles):
    scope_or = []

    if "team_leader" in roles:
        scope_or.append({"team_leader_id": emp_id})

    if roles.intersection({"reporting_officer", "manager", "ro"}):
        scope_or.append({"reporting_officer_id": emp_id})

    if not scope_or:
        return []

    rows = list(
        db.employees.find({
            "tenant_id": tenant_id,
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
            "$or": scope_or,
        })
    )

    return [str(row["_id"]) for row in rows]


def base_active_query(tenant_id):
    return {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }


@dashboard_bp.get("/superadmin")
@current_user_required
def superadmin_dashboard():
    db = get_db()

    if not has_role("super_admin"):
        return jsonify({"message": "Forbidden"}), 403

    tenants = list(
        db.tenants
        .find({})
        .sort("created_at", -1)
        .limit(8)
    )

    today = date.today().isoformat()

    stats = {
        "Companies": db.tenants.count_documents({}),
        "Active Companies": db.tenants.count_documents({"status": "active"}),
        "Total Users": db.users.count_documents({}),
        "Active Users": db.users.count_documents({"is_active": True}),
        "Total Employees": db.employees.count_documents(active_employee_filter()),
        "Total Attendance Logs": db.attendance_logs.count_documents({
            "is_deleted": {"$ne": True},
        }),
        "Present Today": db.attendance_logs.count_documents({
            "date": today,
            "status": {"$in": ["present", "late", "holiday_work", "early_checkout"]},
            "is_deleted": {"$ne": True},
        }),
        "Late Today": db.attendance_logs.count_documents({
            "date": today,
            "status": "late",
            "is_deleted": {"$ne": True},
        }),
        "Holiday Work Today": db.attendance_logs.count_documents({
            "date": today,
            "is_holiday_work": True,
            "is_deleted": {"$ne": True},
        }),
        "Pending WFH/Field Requests": db.attendance_mode_requests.count_documents({
            "status": "pending",
            "is_deleted": {"$ne": True},
        }),
        "Available Comp-Off Credits": db.compoff_credits.count_documents({
            "status": "available",
            "is_deleted": {"$ne": True},
        }),
        "Open Tickets": db.tickets.count_documents({
            "status": {"$in": ["open", "in_progress"]},
            "is_deleted": {"$ne": True},
        }),
        "Pending Leaves": db.leave_requests.count_documents({
            "status": "pending",
            "is_deleted": {"$ne": True},
        }),
        "Approved Leaves": db.leave_requests.count_documents({
            "status": "approved",
            "is_deleted": {"$ne": True},
        }),
        "Pending Password Requests": db.password_requests.count_documents({
            "status": "pending",
            "is_deleted": {"$ne": True},
        }),
        "Payroll Runs": db.payroll_runs.count_documents({
            "is_deleted": {"$ne": True},
        }),
        "Audit Logs": db.audit_logs.count_documents({}),
    }

    tenant_summary = []

    for tenant in tenants:
        tenant_id = tenant.get("tenant_id")

        tenant_summary.append({
            "tenant_id": tenant_id,
            "name": tenant.get("name"),
            "status": tenant.get("status"),
            "users": db.users.count_documents({"tenant_id": tenant_id}),
            "employees": db.employees.count_documents(
                active_employee_filter({"tenant_id": tenant_id})
            ),
            "present_today": db.attendance_logs.count_documents({
                "tenant_id": tenant_id,
                "date": today,
                "status": {"$in": ["present", "late", "holiday_work", "early_checkout"]},
                "is_deleted": {"$ne": True},
            }),
            "late_today": db.attendance_logs.count_documents({
                "tenant_id": tenant_id,
                "date": today,
                "status": "late",
                "is_deleted": {"$ne": True},
            }),
            "pending_wfh_field": db.attendance_mode_requests.count_documents({
                "tenant_id": tenant_id,
                "status": "pending",
                "is_deleted": {"$ne": True},
            }),
            "pending_leaves": db.leave_requests.count_documents({
                "tenant_id": tenant_id,
                "status": "pending",
                "is_deleted": {"$ne": True},
            }),
            "open_tickets": db.tickets.count_documents({
                "tenant_id": tenant_id,
                "status": {"$in": ["open", "in_progress"]},
                "is_deleted": {"$ne": True},
            }),
            "departments": db.departments.count_documents({
                "tenant_id": tenant_id,
                "status": {"$ne": "inactive"},
                "is_deleted": {"$ne": True},
            }),
            "designations": db.designations.count_documents({
                "tenant_id": tenant_id,
                "status": {"$ne": "inactive"},
                "is_deleted": {"$ne": True},
            }),
        })

    recent_users = list(
        db.users
        .find({}, {"password_hash": 0})
        .sort("created_at", -1)
        .limit(8)
    )

    recent_audit = list(
        db.audit_logs
        .find({})
        .sort("created_at", -1)
        .limit(8)
    )

    recent_attendance = list(
        db.attendance_logs
        .find({"is_deleted": {"$ne": True}})
        .sort("created_at", -1)
        .limit(8)
    )

    pending_mode_requests = list(
        db.attendance_mode_requests
        .find({"status": "pending", "is_deleted": {"$ne": True}})
        .sort("created_at", -1)
        .limit(8)
    )

    return jsonify({
        "stats": stats,
        "tenants": clean_doc(tenant_summary),
        "recent_users": clean_doc(recent_users),
        "recent_audit": clean_doc(recent_audit),
        "recent_attendance": clean_doc(recent_attendance),
        "pending_mode_requests": clean_doc(pending_mode_requests),
    })


@dashboard_bp.get("/admin")
@current_user_required
def admin_dashboard():
    db = get_db()

    if not has_role(
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "finance",
        "accounts_finance",
        "manager",
        "ro",
        "team_leader",
        "reporting_officer",
    ):
        return jsonify({"message": "Forbidden"}), 403

    tenant_id = current_tenant_id()
    today = date.today().isoformat()
    roles = current_roles()

    total_employees = count_collection(
        db,
        "employees",
        active_employee_filter(),
    )

    checked_today = count_collection(
        db,
        "attendance_logs",
        {
            "date": today,
            "is_deleted": {"$ne": True},
        },
    )

    stats = {
        "Total Employees": total_employees,
        "Present Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "status": {"$in": ["present", "late", "holiday_work", "early_checkout"]},
                "is_deleted": {"$ne": True},
            },
        ),
        "Late Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "status": "late",
                "is_deleted": {"$ne": True},
            },
        ),
        "Early Checkout Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "is_early_checkout": True,
                "is_deleted": {"$ne": True},
            },
        ),
        "Holiday Work Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "is_holiday_work": True,
                "is_deleted": {"$ne": True},
            },
        ),
        "WFH Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "mode": "wfh",
                "is_deleted": {"$ne": True},
            },
        ),
        "Field Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "mode": "field",
                "is_deleted": {"$ne": True},
            },
        ),
        "Absent Today": max(0, total_employees - checked_today),
        "On Leave": count_collection(
            db,
            "leave_requests",
            {
                "status": "approved",
                "is_deleted": {"$ne": True},
            },
        ),
        "Pending Leaves": count_collection(
            db,
            "leave_requests",
            {
                "status": "pending",
                "is_deleted": {"$ne": True},
            },
        ),
        "Pending WFH/Field": count_collection(
            db,
            "attendance_mode_requests",
            {
                "status": "pending",
                "is_deleted": {"$ne": True},
            },
        ),
        "Available Comp-Off": count_collection(
            db,
            "compoff_credits",
            {
                "status": "available",
                "is_deleted": {"$ne": True},
            },
        ),
        "Open Tickets": count_collection(
            db,
            "tickets",
            {
                "status": {"$in": ["open", "in_progress"]},
                "is_deleted": {"$ne": True},
            },
        ),
        "Pending Expenses": count_collection(
            db,
            "expenses",
            {
                "status": "pending",
                "is_deleted": {"$ne": True},
            },
        ),
        "Candidates": count_collection(
            db,
            "candidates",
            {"is_deleted": {"$ne": True}},
        ),
        "Assets Assigned": count_collection(
            db,
            "assets",
            {
                "status": "assigned",
                "is_deleted": {"$ne": True},
            },
        ),
        "Departments": count_collection(
            db,
            "departments",
            {
                "status": {"$ne": "inactive"},
                "is_deleted": {"$ne": True},
            },
        ),
        "Designations": count_collection(
            db,
            "designations",
            {
                "status": {"$ne": "inactive"},
                "is_deleted": {"$ne": True},
            },
        ),
    }

    departments = list(
        db.departments
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort("name", 1)
    )

    designations = list(
        db.designations
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort("title", 1)
    )

    recent_employees = list(
        db.employees
        .find({
            "tenant_id": tenant_id,
            "status": {"$ne": "Inactive"},
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    recent_attendance = list(
        db.attendance_logs
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    pending = {
        "leave_requests": list(
            db.leave_requests
            .find({
                "tenant_id": tenant_id,
                "status": "pending",
                "is_deleted": {"$ne": True},
            })
            .sort("created_at", -1)
            .limit(5)
        ),
        "attendance_mode_requests": list(
            db.attendance_mode_requests
            .find({
                "tenant_id": tenant_id,
                "status": "pending",
                "is_deleted": {"$ne": True},
            })
            .sort("created_at", -1)
            .limit(5)
        ),
        "expenses": list(
            db.expenses
            .find({
                "tenant_id": tenant_id,
                "status": "pending",
                "is_deleted": {"$ne": True},
            })
            .sort("created_at", -1)
            .limit(5)
        ),
        "tickets": list(
            db.tickets
            .find({
                "tenant_id": tenant_id,
                "status": {"$in": ["open", "in_progress"]},
                "is_deleted": {"$ne": True},
            })
            .sort("created_at", -1)
            .limit(5)
        ),
    }

    holidays_today = list(
        db.holiday_calendar
        .find({
            "tenant_id": tenant_id,
            "date": today,
            "status": {"$ne": "inactive"},
            "is_deleted": {"$ne": True},
        })
        .sort("state", 1)
    )

    compoff_recent = list(
        db.compoff_credits
        .find({
            "tenant_id": tenant_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    current_emp = current_employee(db)
    team_scope_ids = []

    if current_emp and not roles.intersection({"super_admin", "admin", "hr_admin", "hr_manager", "hr"}):
        team_scope_ids = scoped_employee_ids_for_manager(
            db,
            tenant_id,
            str(current_emp["_id"]),
            roles,
        )

    return jsonify({
        "stats": stats,
        "today": today,
        "roles": list(roles),
        "team_scope_employee_ids": team_scope_ids,
        "holidays_today": clean_doc(holidays_today),
        "departments": clean_doc(departments),
        "designations": clean_doc(designations),
        "department_summary": clean_doc(department_summary(db, tenant_id)),
        "designation_summary": clean_doc(designation_summary(db, tenant_id)),
        "recent_employees": clean_doc(recent_employees),
        "recent_attendance": clean_doc(recent_attendance),
        "recent_compoffs": clean_doc(compoff_recent),
        "pending": clean_doc(pending),
    })


@dashboard_bp.get("/employee")
@current_user_required
def employee_dashboard():
    db = get_db()
    roles = current_roles()

    emp = current_employee(db)

    if not emp:
        return jsonify({
            "employee": None,
            "employee_summary": None,
            "roles": list(roles),
            "is_team_leader": False,
            "is_reporting_officer": False,
            "team_members": [],
            "reporting_members": [],
            "team_pending_leaves": [],
            "team_pending_attendance_mode_requests": [],
            "my_performance_reviews": [],
            "reviews_given": [],
            "today_attendance": None,
            "holiday": None,
            "available_attendance_modes": ["office"],
            "attendance_mode_requests": [],
            "leave_balances": [],
            "compoff_credits": [],
            "leaves": [],
            "tickets": [],
            "notifications": [],
        })

    tenant_id = emp.get("tenant_id") or current_tenant_id()
    emp_id = str(emp["_id"])
    today_date = date.today()
    today = today_date.isoformat()

    is_team_leader_role = "team_leader" in roles or truthy(emp.get("is_team_leader"))
    is_reporting_officer_role = (
        roles.intersection({"reporting_officer", "manager", "ro"})
        or truthy(emp.get("is_reporting_officer"))
    )

    team_members = []

    if is_team_leader_role:
        team_members = list(
            db.employees
            .find({
                "tenant_id": tenant_id,
                "team_leader_id": emp_id,
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            })
            .sort("name", 1)
        )

    reporting_members = []

    if is_reporting_officer_role:
        reporting_members = list(
            db.employees
            .find({
                "tenant_id": tenant_id,
                "reporting_officer_id": emp_id,
                "status": {"$ne": "Inactive"},
                "is_deleted": {"$ne": True},
            })
            .sort("name", 1)
        )

    team_member_ids = [str(member["_id"]) for member in team_members]
    reporting_member_ids = [str(member["_id"]) for member in reporting_members]
    team_scope_ids = list(set(team_member_ids + reporting_member_ids))

    my_reviews = list(
        db.performance_reviews
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(10)
    )

    reviews_given = list(
        db.performance_reviews
        .find({
            "tenant_id": tenant_id,
            "reviewer_employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(10)
    )

    today_attendance = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": emp_id,
        "date": today,
        "is_deleted": {"$ne": True},
    })

    holiday = holiday_info_for_employee(db, emp, today_date)
    available_modes = available_attendance_modes(db, emp, today_date)

    attendance_mode_requests = list(
        db.attendance_mode_requests
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    leave_balances = list(
        db.leave_balances
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("leave_type", 1)
    )

    compoff_credits = list(
        db.compoff_credits
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    leaves = list(
        db.leave_requests
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(5)
    )

    tickets = list(
        db.tickets
        .find({
            "tenant_id": tenant_id,
            "raised_by": emp_id,
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(5)
    )

    notifications = list(
        db.notifications
        .find({
            "tenant_id": tenant_id,
            "user_id": str(g.current_user["_id"]),
            "is_deleted": {"$ne": True},
        })
        .sort("created_at", -1)
        .limit(8)
    )

    team_pending_leaves = []
    team_pending_attendance_mode_requests = []

    if team_scope_ids:
        leave_scope = {
            "tenant_id": tenant_id,
            "employee_id": {"$in": team_scope_ids},
            "status": "pending",
            "is_deleted": {"$ne": True},
        }

        mode_scope = {
            "tenant_id": tenant_id,
            "employee_id": {"$in": team_scope_ids},
            "status": "pending",
            "is_deleted": {"$ne": True},
        }

        if is_team_leader_role and not is_reporting_officer_role:
            leave_scope["approval_stage"] = "team_leader"

        if is_reporting_officer_role and not is_team_leader_role:
            leave_scope["approval_stage"] = "reporting_officer"

        team_pending_leaves = list(
            db.leave_requests
            .find(leave_scope)
            .sort("created_at", -1)
            .limit(10)
        )

        team_pending_attendance_mode_requests = list(
            db.attendance_mode_requests
            .find(mode_scope)
            .sort("created_at", -1)
            .limit(10)
        )

    return jsonify({
        "employee": clean_doc(emp),
        "employee_summary": clean_doc(employee_snapshot(emp)),
        "roles": list(roles),
        "is_team_leader": bool(is_team_leader_role),
        "is_reporting_officer": bool(is_reporting_officer_role),
        "team_members": clean_doc(team_members),
        "reporting_members": clean_doc(reporting_members),
        "team_pending_leaves": clean_doc(team_pending_leaves),
        "team_pending_attendance_mode_requests": clean_doc(team_pending_attendance_mode_requests),
        "my_performance_reviews": clean_doc(my_reviews),
        "reviews_given": clean_doc(reviews_given),
        "today_attendance": clean_doc(today_attendance),
        "holiday": clean_doc(holiday),
        "available_attendance_modes": available_modes,
        "attendance_mode_requests": clean_doc(attendance_mode_requests),
        "leave_balances": clean_doc(leave_balances),
        "compoff_credits": clean_doc(compoff_credits),
        "leaves": clean_doc(leaves),
        "tickets": clean_doc(tickets),
        "notifications": clean_doc(notifications),
    })