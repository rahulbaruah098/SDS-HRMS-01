from flask import Blueprint, request, jsonify, g
from bson import ObjectId
from datetime import datetime

from app.extensions import get_db
from app.utils.auth import roles_required, current_user_required, audit


workflow_bp = Blueprint("workflow", __name__)


DECISION_MANAGER_ROLES = (
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


EXPENSE_DECISION_ROLES = (
    "super_admin",
    "admin",
    "accounts_finance",
    "finance",
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
)


PAYROLL_ROLES = (
    "super_admin",
    "admin",
    "accounts_finance",
    "finance",
)


PERFORMANCE_REVIEW_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "team_leader",
    "reporting_officer",
    "manager",
    "ro",
)


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


def is_admin_level_user(roles):
    return bool(roles.intersection({
        "super_admin",
        "admin",
        "hr_admin",
        "hr_manager",
        "hr",
        "accounts_finance",
        "finance",
    }))


def scoped_record_query(record_id):
    roles = set(g.current_user.get("roles", []))
    q = {"_id": record_id}

    if "super_admin" not in roles:
        q["tenant_id"] = g.tenant_id

    return q


@workflow_bp.patch("/leave_requests/<req_id>/decision")
@roles_required(*DECISION_MANAGER_ROLES)
def leave_decision(req_id):
    req_obj_id = safe_object_id(req_id)

    if not req_obj_id:
        return jsonify({"message": "Invalid leave request id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    status = (data.get("status") or "").strip().lower()

    if status not in ["approved", "rejected"]:
        return jsonify({"message": "status must be approved or rejected"}), 400

    q = scoped_record_query(req_obj_id)
    existing = db.leave_requests.find_one(q)

    if not existing:
        return jsonify({"message": "Leave request not found"}), 404

    roles = set(g.current_user.get("roles", []))
    reviewer_emp = current_employee(db)
    reviewer_emp_id = str(reviewer_emp["_id"]) if reviewer_emp else ""

    if not is_admin_level_user(roles):
        employee_id = existing.get("employee_id")

        if "team_leader" in roles and existing.get("team_leader_id"):
            if existing.get("team_leader_id") != reviewer_emp_id:
                return jsonify({"message": "You can approve only your assigned team members"}), 403

        if "reporting_officer" in roles and existing.get("reporting_officer_id"):
            if existing.get("reporting_officer_id") != reviewer_emp_id:
                return jsonify({"message": "You can approve only employees assigned to you"}), 403

        if employee_id == reviewer_emp_id:
            return jsonify({"message": "You cannot approve your own leave request"}), 403

    update = {
        "status": status,
        "decision_reason": data.get("reason", ""),
        "approved_by": str(g.current_user["_id"]),
        "approved_by_name": g.current_user.get("name") or g.current_user.get("email"),
        "updated_at": datetime.utcnow(),
    }

    db.leave_requests.update_one(q, {"$set": update})

    audit(status, "leave_requests", req_id, data)

    return jsonify({"message": f"Leave {status}"})


@workflow_bp.patch("/expenses/<expense_id>/decision")
@roles_required(*EXPENSE_DECISION_ROLES)
def expense_decision(expense_id):
    expense_obj_id = safe_object_id(expense_id)

    if not expense_obj_id:
        return jsonify({"message": "Invalid expense id"}), 400

    db = get_db()
    data = request.get_json(silent=True) or {}
    status = (data.get("status") or "").strip().lower()

    if status not in ["approved", "rejected", "paid"]:
        return jsonify({"message": "Invalid expense status"}), 400

    q = scoped_record_query(expense_obj_id)
    existing = db.expenses.find_one(q)

    if not existing:
        return jsonify({"message": "Expense not found"}), 404

    roles = set(g.current_user.get("roles", []))
    reviewer_emp = current_employee(db)
    reviewer_emp_id = str(reviewer_emp["_id"]) if reviewer_emp else ""

    if not is_admin_level_user(roles):
        employee_id = existing.get("employee_id")

        if employee_id == reviewer_emp_id:
            return jsonify({"message": "You cannot approve your own expense"}), 403

    update = {
        "status": status,
        "decision_note": data.get("note", ""),
        "approved_by": str(g.current_user["_id"]),
        "approved_by_name": g.current_user.get("name") or g.current_user.get("email"),
        "updated_at": datetime.utcnow(),
    }

    if status == "paid":
        update["paid_at"] = datetime.utcnow()
        update["paid_by"] = str(g.current_user["_id"])

    db.expenses.update_one(q, {"$set": update})

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

    status = (data.get("status") or "in_progress").strip().lower()
    comment = (data.get("comment") or "").strip()

    allowed_statuses = ["open", "in_progress", "resolved", "closed", "rejected"]

    if status not in allowed_statuses:
        return jsonify({"message": "Invalid ticket status"}), 400

    q = scoped_record_query(ticket_obj_id)
    existing = db.tickets.find_one(q)

    if not existing:
        return jsonify({"message": "Ticket not found"}), 404

    update = {
        "$set": {
            "status": status,
            "updated_at": datetime.utcnow(),
            "updated_by": str(g.current_user["_id"]),
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

    db.tickets.update_one(q, update)

    audit("ticket_status", "tickets", ticket_id, data)

    return jsonify({"message": "Ticket updated"})


@workflow_bp.post("/payroll/run")
@roles_required(*PAYROLL_ROLES)
def payroll_run():
    db = get_db()
    data = request.get_json(silent=True) or {}

    month = (data.get("month") or "").strip()

    if not month:
        return jsonify({"message": "month is required, format YYYY-MM"}), 400

    tenant_id = g.tenant_id
    roles = set(g.current_user.get("roles", []))

    if "super_admin" in roles and data.get("tenant_id"):
        tenant_id = data.get("tenant_id")

    if tenant_id == "platform":
        tenant_id = data.get("tenant_id") or "sds"

    employees = list(db.employees.find({
        "tenant_id": tenant_id,
        "status": {"$ne": "Inactive"},
    }))

    gross_total = 0
    standard_deduction = float(data.get("standard_deduction", 0) or 0)

    for employee in employees:
        gross = float(employee.get("salary", 30000) or 30000)
        deductions = standard_deduction
        net = gross - deductions
        gross_total += gross

        db.payslips.update_one(
            {
                "tenant_id": tenant_id,
                "employee_id": str(employee["_id"]),
                "month": month,
            },
            {
                "$set": {
                    "tenant_id": tenant_id,
                    "employee_id": str(employee["_id"]),
                    "employee_name": employee.get("name"),
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
        "tenant_id": tenant_id,
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
@roles_required(*PERFORMANCE_REVIEW_ROLES)
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

    if str(employee["_id"]) == reviewer_emp_id and not is_admin_level_user(roles):
        return jsonify({"message": "You cannot review yourself"}), 403

    if "team_leader" in roles and not is_admin_level_user(roles):
        if employee.get("team_leader_id") != reviewer_emp_id:
            return jsonify({"message": "You can review only your assigned team members"}), 403

    if "reporting_officer" in roles and not is_admin_level_user(roles):
        if employee.get("reporting_officer_id") != reviewer_emp_id:
            return jsonify({"message": "You can review only employees assigned to you"}), 403

    review = {
        "tenant_id": g.tenant_id,
        "employee_id": str(employee["_id"]),
        "employee_name": employee.get("name"),
        "cycle": cycle,
        "rating": rating,
        "comments": comments,
        "reviewer_id": str(g.current_user["_id"]),
        "reviewer_employee_id": reviewer_emp_id,
        "reviewer_name": g.current_user.get("name") or g.current_user.get("email"),
        "reviewer_role": ",".join(g.current_user.get("roles", [])),
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