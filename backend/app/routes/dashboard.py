from flask import Blueprint, jsonify, g
from datetime import date

from app.extensions import get_db
from app.utils.auth import current_user_required
from app.utils.serializers import clean_doc


dashboard_bp = Blueprint("dashboard", __name__)


def normalize_roles(value):
    if not value:
        return []

    if isinstance(value, list):
        return [str(role).strip() for role in value if str(role).strip()]

    if isinstance(value, str):
        return [role.strip() for role in value.split(",") if role.strip()]

    return []


def has_role(*allowed_roles):
    roles = set(normalize_roles(g.current_user.get("roles", [])))
    return bool(roles.intersection(set(allowed_roles)))


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


def current_employee(db):
    tenant_id = current_tenant_id()

    employee = db.employees.find_one({
        "tenant_id": tenant_id,
        "user_id": str(g.current_user["_id"]),
    })

    if employee:
        return employee

    return db.employees.find_one({
        "user_id": str(g.current_user["_id"]),
    })


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
                "_id": {
                    "$ifNull": ["$department", "Unassigned"],
                },
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
                "_id": {
                    "$ifNull": ["$designation", "Unassigned"],
                },
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

    stats = {
        "Companies": db.tenants.count_documents({}),
        "Active Companies": db.tenants.count_documents({"status": "active"}),
        "Total Users": db.users.count_documents({}),
        "Active Users": db.users.count_documents({"is_active": True}),
        "Total Employees": db.employees.count_documents(
            active_employee_filter()
        ),
        "Total Attendance Logs": db.attendance_logs.count_documents({}),
        "Open Tickets": db.tickets.count_documents({
            "status": {"$in": ["open", "in_progress"]}
        }),
        "Pending Leaves": db.leave_requests.count_documents({"status": "pending"}),
        "Pending Password Requests": db.password_requests.count_documents({
            "status": "pending"
        }),
        "Payroll Runs": db.payroll_runs.count_documents({}),
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
            "open_tickets": db.tickets.count_documents({
                "tenant_id": tenant_id,
                "status": {"$in": ["open", "in_progress"]},
            }),
            "departments": db.departments.count_documents({
                "tenant_id": tenant_id,
                "status": {"$ne": "inactive"},
            }),
            "designations": db.designations.count_documents({
                "tenant_id": tenant_id,
                "status": {"$ne": "inactive"},
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

    return jsonify({
        "stats": stats,
        "tenants": clean_doc(tenant_summary),
        "recent_users": clean_doc(recent_users),
        "recent_audit": clean_doc(recent_audit),
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

    total_employees = count_collection(
        db,
        "employees",
        active_employee_filter(),
    )

    checked_today = count_collection(
        db,
        "attendance_logs",
        {"date": today},
    )

    stats = {
        "Total Employees": total_employees,
        "Present Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "status": {"$in": ["present", "late"]},
            },
        ),
        "Late Today": count_collection(
            db,
            "attendance_logs",
            {
                "date": today,
                "status": "late",
            },
        ),
        "Absent Today": max(0, total_employees - checked_today),
        "On Leave": count_collection(
            db,
            "leave_requests",
            {"status": "approved"},
        ),
        "Pending Leaves": count_collection(
            db,
            "leave_requests",
            {"status": "pending"},
        ),
        "Open Tickets": count_collection(
            db,
            "tickets",
            {"status": {"$in": ["open", "in_progress"]}},
        ),
        "Pending Expenses": count_collection(
            db,
            "expenses",
            {"status": "pending"},
        ),
        "Candidates": count_collection(db, "candidates"),
        "Assets Assigned": count_collection(
            db,
            "assets",
            {"status": "assigned"},
        ),
        "Departments": count_collection(
            db,
            "departments",
            {"status": {"$ne": "inactive"}},
        ),
        "Designations": count_collection(
            db,
            "designations",
            {"status": {"$ne": "inactive"}},
        ),
    }

    departments = list(
        db.departments
        .find({"tenant_id": tenant_id})
        .sort("name", 1)
    )

    designations = list(
        db.designations
        .find({"tenant_id": tenant_id})
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
        .find({"tenant_id": tenant_id})
        .sort("created_at", -1)
        .limit(8)
    )

    pending = {
        "leave_requests": list(
            db.leave_requests
            .find({"tenant_id": tenant_id, "status": "pending"})
            .sort("created_at", -1)
            .limit(5)
        ),
        "expenses": list(
            db.expenses
            .find({"tenant_id": tenant_id, "status": "pending"})
            .sort("created_at", -1)
            .limit(5)
        ),
        "tickets": list(
            db.tickets
            .find({
                "tenant_id": tenant_id,
                "status": {"$in": ["open", "in_progress"]},
            })
            .sort("created_at", -1)
            .limit(5)
        ),
    }

    return jsonify({
        "stats": stats,
        "departments": clean_doc(departments),
        "designations": clean_doc(designations),
        "department_summary": clean_doc(department_summary(db, tenant_id)),
        "designation_summary": clean_doc(designation_summary(db, tenant_id)),
        "recent_employees": clean_doc(recent_employees),
        "recent_attendance": clean_doc(recent_attendance),
        "pending": clean_doc(pending),
    })


@dashboard_bp.get("/employee")
@current_user_required
def employee_dashboard():
    db = get_db()
    roles = set(normalize_roles(g.current_user.get("roles", [])))

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
            "my_performance_reviews": [],
            "reviews_given": [],
            "today_attendance": None,
            "leaves": [],
            "tickets": [],
            "notifications": [],
        })

    tenant_id = emp.get("tenant_id") or current_tenant_id()
    emp_id = str(emp["_id"])
    today = date.today().isoformat()

    team_members = []

    if "team_leader" in roles:
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

    if roles.intersection({"reporting_officer", "manager", "ro"}):
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
        })
        .sort("created_at", -1)
        .limit(10)
    )

    reviews_given = list(
        db.performance_reviews
        .find({
            "tenant_id": tenant_id,
            "reviewer_employee_id": emp_id,
        })
        .sort("created_at", -1)
        .limit(10)
    )

    today_attendance = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": emp_id,
        "date": today,
    })

    leaves = list(
        db.leave_requests
        .find({
            "tenant_id": tenant_id,
            "employee_id": emp_id,
        })
        .sort("created_at", -1)
        .limit(5)
    )

    tickets = list(
        db.tickets
        .find({
            "tenant_id": tenant_id,
            "raised_by": emp_id,
        })
        .sort("created_at", -1)
        .limit(5)
    )

    notifications = list(
        db.notifications
        .find({
            "tenant_id": tenant_id,
            "user_id": str(g.current_user["_id"]),
        })
        .sort("created_at", -1)
        .limit(8)
    )

    team_pending_leaves = []

    if team_scope_ids:
        team_pending_leaves = list(
            db.leave_requests
            .find({
                "tenant_id": tenant_id,
                "employee_id": {"$in": team_scope_ids},
                "status": "pending",
            })
            .sort("created_at", -1)
            .limit(10)
        )

    return jsonify({
        "employee": clean_doc(emp),
        "employee_summary": clean_doc(employee_snapshot(emp)),
        "roles": list(roles),
        "is_team_leader": "team_leader" in roles,
        "is_reporting_officer": bool(
            roles.intersection({"reporting_officer", "manager", "ro"})
        ),
        "team_members": clean_doc(team_members),
        "reporting_members": clean_doc(reporting_members),
        "team_pending_leaves": clean_doc(team_pending_leaves),
        "my_performance_reviews": clean_doc(my_reviews),
        "reviews_given": clean_doc(reviews_given),
        "today_attendance": clean_doc(today_attendance),
        "leaves": clean_doc(leaves),
        "tickets": clean_doc(tickets),
        "notifications": clean_doc(notifications),
    })