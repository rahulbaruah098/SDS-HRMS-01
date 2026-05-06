from flask import Blueprint, jsonify, g
from datetime import date

from app.extensions import get_db
from app.utils.auth import current_user_required
from app.utils.serializers import clean_doc


dashboard_bp = Blueprint("dashboard", __name__)


def has_role(*allowed_roles):
    roles = set(g.current_user.get("roles", []))
    return bool(roles.intersection(set(allowed_roles)))


def tenant_query(extra=None):
    q = {"tenant_id": g.tenant_id}
    q.update(extra or {})
    return q


def count_collection(db, collection, extra=None):
    return db[collection].count_documents(tenant_query(extra))


def current_employee(db):
    return db.employees.find_one({
        "tenant_id": g.tenant_id,
        "user_id": str(g.current_user["_id"]),
    })


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
        "Total Employees": db.employees.count_documents({
            "status": {"$ne": "Inactive"}
        }),
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
            "employees": db.employees.count_documents({
                "tenant_id": tenant_id,
                "status": {"$ne": "Inactive"},
            }),
            "open_tickets": db.tickets.count_documents({
                "tenant_id": tenant_id,
                "status": {"$in": ["open", "in_progress"]},
            }),
        })

    recent_users = list(
        db.users
        .find({})
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

    today = date.today().isoformat()

    total_employees = count_collection(
        db,
        "employees",
        {"status": {"$ne": "Inactive"}},
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
    }

    departments = list(
        db.departments
        .find({"tenant_id": g.tenant_id})
        .sort("name", 1)
    )

    recent_attendance = list(
        db.attendance_logs
        .find({"tenant_id": g.tenant_id})
        .sort("created_at", -1)
        .limit(8)
    )

    pending = {
        "leave_requests": list(
            db.leave_requests
            .find({"tenant_id": g.tenant_id, "status": "pending"})
            .sort("created_at", -1)
            .limit(5)
        ),
        "expenses": list(
            db.expenses
            .find({"tenant_id": g.tenant_id, "status": "pending"})
            .sort("created_at", -1)
            .limit(5)
        ),
        "tickets": list(
            db.tickets
            .find({
                "tenant_id": g.tenant_id,
                "status": {"$in": ["open", "in_progress"]},
            })
            .sort("created_at", -1)
            .limit(5)
        ),
    }

    return jsonify({
        "stats": stats,
        "departments": clean_doc(departments),
        "recent_attendance": clean_doc(recent_attendance),
        "pending": clean_doc(pending),
    })


@dashboard_bp.get("/employee")
@current_user_required
def employee_dashboard():
    db = get_db()
    roles = set(g.current_user.get("roles", []))

    emp = current_employee(db)

    if not emp:
        return jsonify({
            "employee": None,
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

    emp_id = str(emp["_id"])
    today = date.today().isoformat()

    team_members = []

    if "team_leader" in roles:
        team_members = list(
            db.employees
            .find({
                "tenant_id": g.tenant_id,
                "team_leader_id": emp_id,
                "status": {"$ne": "Inactive"},
            })
            .sort("name", 1)
        )

    reporting_members = []

    if roles.intersection({"reporting_officer", "manager", "ro"}):
        reporting_members = list(
            db.employees
            .find({
                "tenant_id": g.tenant_id,
                "reporting_officer_id": emp_id,
                "status": {"$ne": "Inactive"},
            })
            .sort("name", 1)
        )

    team_member_ids = [str(member["_id"]) for member in team_members]
    reporting_member_ids = [str(member["_id"]) for member in reporting_members]
    team_scope_ids = list(set(team_member_ids + reporting_member_ids))

    my_reviews = list(
        db.performance_reviews
        .find({
            "tenant_id": g.tenant_id,
            "employee_id": emp_id,
        })
        .sort("created_at", -1)
        .limit(10)
    )

    reviews_given = list(
        db.performance_reviews
        .find({
            "tenant_id": g.tenant_id,
            "reviewer_employee_id": emp_id,
        })
        .sort("created_at", -1)
        .limit(10)
    )

    today_attendance = db.attendance_logs.find_one({
        "tenant_id": g.tenant_id,
        "employee_id": emp_id,
        "date": today,
    })

    leaves = list(
        db.leave_requests
        .find({
            "tenant_id": g.tenant_id,
            "employee_id": emp_id,
        })
        .sort("created_at", -1)
        .limit(5)
    )

    tickets = list(
        db.tickets
        .find({
            "tenant_id": g.tenant_id,
            "raised_by": emp_id,
        })
        .sort("created_at", -1)
        .limit(5)
    )

    notifications = list(
        db.notifications
        .find({
            "tenant_id": g.tenant_id,
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
                "tenant_id": g.tenant_id,
                "employee_id": {"$in": team_scope_ids},
                "status": "pending",
            })
            .sort("created_at", -1)
            .limit(10)
        )

    return jsonify({
        "employee": clean_doc(emp),
        "roles": list(roles),
        "is_team_leader": "team_leader" in roles,
        "is_reporting_officer": bool(roles.intersection({"reporting_officer", "manager", "ro"})),
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