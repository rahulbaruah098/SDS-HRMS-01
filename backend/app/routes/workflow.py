from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime

from app.extensions import get_db
from app.utils.auth import roles_required, current_user_required, audit


workflow_bp = Blueprint("workflow", __name__)


ADMIN_HR_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
}

TEAM_APPROVAL_ROLES = {
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
}

FINANCE_ROLES = {
    "super_admin",
    "admin",
    "finance",
    "accounts_finance",
}

TICKET_MANAGER_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
}


def safe_object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def current_employee(db):
    return db.employees.find_one({
        "tenant_id": g.tenant_id,
        "user_id": str(g.current_user["_id"]),
    })


def current_employee_id(db):
    emp = current_employee(db)
    return str(emp["_id"]) if emp else ""


def has_any_role(*allowed_roles):
    roles = set(g.current_user.get("roles", []))
    return bool(roles.intersection(set(allowed_roles)))


def can_manage_employee_record(db, employee_id):
    roles = set(g.current_user.get("roles", []))

    if roles.intersection(ADMIN_HR_ROLES):
        return True

    reviewer_emp_id = current_employee_id(db)

    if not reviewer_emp_id:
        return False

    employee = db.employees.find_one({
        "_id": safe_object_id(employee_id),
        "tenant_id": g.tenant_id,
    })

    if not employee:
        return False

    if "team_leader" in roles and employee.get("team_leader_id") == reviewer_emp_id:
        return True

    if roles.intersection({"reporting_officer", "manager", "ro"}) and employee.get("reporting_officer_id") == reviewer_emp_id:
        return True

    return False


def scoped_leave_query(db, leave_obj_id):
    roles = set(g.current_user.get("roles", []))

    q = {
        "_id": leave_obj_id,
        "tenant_id": g.tenant_id,
    }

    if roles.intersection(ADMIN_HR_ROLES):
        return q

    reviewer_emp_id = current_employee_id(db)

    if not reviewer_emp_id:
        q["employee_id"] = "__none__"
        return q

    scope_or = []

    if "team_leader" in roles:
        scope_or.append({"team_leader_id": reviewer_emp_id})

    if roles.intersection({"reporting_officer", "manager", "ro"}):
        scope_or.append({"reporting_officer_id": reviewer_emp_id})

    if not scope_or:
        q["employee_id"] = "__none__"
        return q

    q["$or"] = scope_or
    return q


@workflow_bp.patch("/leave_requests/<req_id>/decision")
@roles_required(
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
)
def leave_decision(req_id):
    leave_obj_id = safe_object_id(req_id)

    if not leave_obj_id:
        return jsonify({"message": "Invalid leave request id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    status = data.get("status")

    if status not in ["approved", "rejected"]:
        return jsonify({"message": "status must be approved or rejected"}), 400

    q = scoped_leave_query(db, leave_obj_id)
    existing = db.leave_requests.find_one(q)

    if not existing:
        return jsonify({"message": "Leave request not found or not in your approval scope"}), 404

    db.leave_requests.update_one(
        {"_id": leave_obj_id},
        {
            "$set": {
                "status": status,
                "decision_reason": data.get("reason", ""),
                "approved_by": str(g.current_user["_id"]),
                "approved_by_name": g.current_user.get("name") or g.current_user.get("email"),
                "updated_at": datetime.utcnow(),
            }
        },
    )

    audit(status, "leave_requests", req_id, data)

    return jsonify({"message": f"Leave {status}"})


@workflow_bp.patch("/expenses/<expense_id>/decision")
@roles_required(
    "super_admin",
    "admin",
    "finance",
    "accounts_finance",
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
)
def expense_decision(expense_id):
    expense_obj_id = safe_object_id(expense_id)

    if not expense_obj_id:
        return jsonify({"message": "Invalid expense id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    status = data.get("status")

    if status not in ["approved", "rejected", "paid"]:
        return jsonify({"message": "Invalid expense status"}), 400

    existing = db.expenses.find_one({
        "_id": expense_obj_id,
        "tenant_id": g.tenant_id,
    })

    if not existing:
        return jsonify({"message": "Expense not found"}), 404

    roles = set(g.current_user.get("roles", []))

    if not roles.intersection(FINANCE_ROLES):
        employee_id = existing.get("employee_id")

        if not can_manage_employee_record(db, employee_id):
            return jsonify({"message": "Expense not in your approval scope"}), 403

        if status == "paid":
            return jsonify({"message": "Only finance/admin can mark expense as paid"}), 403

    db.expenses.update_one(
        {"_id": expense_obj_id},
        {
            "$set": {
                "status": status,
                "decision_note": data.get("note", ""),
                "approved_by": str(g.current_user["_id"]),
                "approved_by_name": g.current_user.get("name") or g.current_user.get("email"),
                "updated_at": datetime.utcnow(),
            }
        },
    )

    audit(status, "expenses", expense_id, data)

    return jsonify({"message": f"Expense {status}"})


@workflow_bp.patch("/tickets/<ticket_id>/status")
@current_user_required
def ticket_status(ticket_id):
    ticket_obj_id = safe_object_id(ticket_id)

    if not ticket_obj_id:
        return jsonify({"message": "Invalid ticket id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    status = data.get("status", "in_progress")
    comment = data.get("comment", "")

    if status not in ["open", "in_progress", "resolved", "closed"]:
        return jsonify({"message": "Invalid ticket status"}), 400

    existing = db.tickets.find_one({
        "_id": ticket_obj_id,
        "tenant_id": g.tenant_id,
    })

    if not existing:
        return jsonify({"message": "Ticket not found"}), 404

    roles = set(g.current_user.get("roles", []))
    emp_id = current_employee_id(db)

    is_owner = existing.get("raised_by") == emp_id
    is_manager = bool(roles.intersection(TICKET_MANAGER_ROLES))

    if not is_owner and not is_manager:
        return jsonify({"message": "Ticket not in your scope"}), 403

    if is_owner and not is_manager and status in ["resolved", "closed"]:
        return jsonify({"message": "Only HR/Admin/Manager can resolve or close ticket"}), 403

    update = {
        "$set": {
            "status": status,
            "updated_at": datetime.utcnow(),
        }
    }

    if comment:
        update["$push"] = {
            "comments": {
                "by": str(g.current_user["_id"]),
                "by_name": g.current_user.get("name") or g.current_user.get("email"),
                "comment": comment,
                "created_at": datetime.utcnow(),
            }
        }

    db.tickets.update_one({"_id": ticket_obj_id}, update)

    audit("ticket_status", "tickets", ticket_id, data)

    return jsonify({"message": "Ticket updated"})


@workflow_bp.post("/payroll/run")
@roles_required("super_admin", "admin", "finance", "accounts_finance")
def payroll_run():
    db = get_db()
    data = request.get_json(silent=True) or {}
    month = data.get("month")

    if not month:
        return jsonify({"message": "month is required, format YYYY-MM"}), 400

    employees = list(
        db.employees.find({
            "tenant_id": g.tenant_id,
            "status": {"$ne": "Inactive"},
        })
    )

    gross_total = 0

    for emp in employees:
        gross = float(emp.get("salary", 30000))
        deductions = float(data.get("standard_deduction", 0))
        net = gross - deductions
        gross_total += gross

        db.payslips.update_one(
            {
                "tenant_id": g.tenant_id,
                "employee_id": str(emp["_id"]),
                "month": month,
            },
            {
                "$set": {
                    "tenant_id": g.tenant_id,
                    "employee_id": str(emp["_id"]),
                    "employee_name": emp.get("name"),
                    "month": month,
                    "gross": gross,
                    "deductions": deductions,
                    "net_pay": net,
                    "status": "generated",
                    "updated_at": datetime.utcnow(),
                },
                "$setOnInsert": {
                    "created_at": datetime.utcnow(),
                },
            },
            upsert=True,
        )

    run = {
        "tenant_id": g.tenant_id,
        "month": month,
        "employee_count": len(employees),
        "gross_total": gross_total,
        "status": "processed",
        "created_at": datetime.utcnow(),
        "created_by": str(g.current_user["_id"]),
    }

    res = db.payroll_runs.insert_one(run)

    audit("payroll_run", "payroll_runs", res.inserted_id, run)

    return jsonify({
        "message": "Payroll processed",
        "run": str(res.inserted_id),
    })


@workflow_bp.post("/performance/reviews")
@roles_required(
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
)
def create_performance_review():
    db = get_db()
    data = request.get_json(silent=True) or {}

    employee_id = data.get("employee_id")
    rating = data.get("rating")
    comments = data.get("comments", "")
    cycle = data.get("cycle") or datetime.utcnow().strftime("%B %Y")

    employee_obj_id = safe_object_id(employee_id)

    if not employee_obj_id:
        return jsonify({"message": "Valid employee_id is required"}), 400

    try:
        rating = float(rating)
    except Exception:
        return jsonify({"message": "rating must be a number"}), 400

    if rating < 1 or rating > 5:
        return jsonify({"message": "rating must be between 1 and 5"}), 400

    employee = db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": g.tenant_id,
    })

    if not employee:
        return jsonify({"message": "Employee not found"}), 404

    roles = set(g.current_user.get("roles", []))
    reviewer_emp = current_employee(db)
    reviewer_emp_id = str(reviewer_emp["_id"]) if reviewer_emp else ""

    if not roles.intersection(ADMIN_HR_ROLES):
        can_review = False

        if "team_leader" in roles and employee.get("team_leader_id") == reviewer_emp_id:
            can_review = True

        if roles.intersection({"reporting_officer", "manager", "ro"}) and employee.get("reporting_officer_id") == reviewer_emp_id:
            can_review = True

        if not can_review:
            return jsonify({"message": "You can review only employees assigned to you"}), 403

    reviewer_role = "admin_hr"

    if "team_leader" in roles and employee.get("team_leader_id") == reviewer_emp_id:
        reviewer_role = "team_leader"

    if roles.intersection({"reporting_officer", "manager", "ro"}) and employee.get("reporting_officer_id") == reviewer_emp_id:
        reviewer_role = "reporting_officer"

    review = {
        "tenant_id": g.tenant_id,
        "employee_id": employee_id,
        "employee_name": employee.get("name"),
        "cycle": cycle,
        "rating": rating,
        "comments": comments,
        "reviewer_id": str(g.current_user["_id"]),
        "reviewer_employee_id": reviewer_emp_id,
        "reviewer_name": g.current_user.get("name") or g.current_user.get("email"),
        "reviewer_role": reviewer_role,
        "visibility": ["md", "hr", "employee_self"],
        "status": "submitted",
        "created_at": datetime.utcnow(),
        "created_by": str(g.current_user["_id"]),
    }

    res = db.performance_reviews.insert_one(review)

    audit("create_performance_review", "performance_reviews", res.inserted_id, review)

    return jsonify({
        "message": "Performance review submitted",
        "item": str(res.inserted_id),
    }), 201