from flask import Blueprint, jsonify, g, request

from app.extensions import get_db
from app.utils.auth import roles_required
from app.utils.serializers import clean_doc


reports_bp = Blueprint("reports", __name__)


REPORT_COLLECTIONS = [
    "employees",
    "attendance_logs",
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
    "audit_logs",
]


REPORT_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "accounts_finance",
    "finance",
    "manager",
    "ro",
    "team_leader",
    "reporting_officer",
)


AUDIT_ROLES = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
)


def build_report_query():
    roles = set(g.current_user.get("roles", []))
    tenant_arg = (request.args.get("tenant_id") or "").strip()

    if "super_admin" in roles:
        if tenant_arg:
            return {"tenant_id": tenant_arg}
        return {}

    return {"tenant_id": g.tenant_id}


@reports_bp.get("/summary")
@roles_required(*REPORT_ROLES)
def summary():
    db = get_db()
    q = build_report_query()

    counts = {
        collection: db[collection].count_documents(q)
        for collection in REPORT_COLLECTIONS
    }

    return jsonify({"counts": counts})


@reports_bp.get("/audit")
@roles_required(*AUDIT_ROLES)
def audits():
    db = get_db()
    q = build_report_query()

    items = list(
        db.audit_logs
        .find(q)
        .sort("created_at", -1)
        .limit(300)
    )

    return jsonify({"items": clean_doc(items)})