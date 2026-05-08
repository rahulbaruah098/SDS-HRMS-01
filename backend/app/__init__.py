from flask import Flask, jsonify
from flask_cors import CORS

from .config import Config
from .extensions import init_db
from .routes.auth import auth_bp
from .routes.dashboard import dashboard_bp
from .routes.attendance import attendance_bp
from .routes.crud import crud_bp
from .routes.workflow import workflow_bp
from .routes.reports import reports_bp
from .routes.superadmin import superadmin_bp
from .routes.password_requests import password_requests_bp


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    allowed_origins = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ]

    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": allowed_origins,
            }
        },
        allow_headers=[
            "Content-Type",
            "Authorization",
        ],
        methods=[
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
        ],
        supports_credentials=False,
    )

    init_db(app)

    # Auth/session APIs:
    # login, current user, employee profile snapshot, capability sync.
    app.register_blueprint(auth_bp, url_prefix="/api/v1/auth")

    # Dashboard APIs:
    # Super Admin, Admin/HR/Finance, and Employee dashboard.
    # Team Leader / Reporting Officer are employee capabilities and remain
    # inside Employee Dashboard, not separate dashboard identities.
    app.register_blueprint(dashboard_bp, url_prefix="/api/v1/dashboard")

    # Attendance module APIs:
    # check-in, check-out, status, attendance reports, WFH/Field requests,
    # state-wise holiday calendar, comp-off generation and comp-off claim.
    app.register_blueprint(attendance_bp, url_prefix="/api/v1/attendance")

    # Generic CRUD APIs:
    # employees, masters, leave_balances, leave_requests, holiday_calendar,
    # attendance_logs, attendance_mode_requests, compoff_credits, etc.
    # Employee Master creates every staff profile as Employee.
    # Team Leader / Reporting Officer are stored as employee capability mappings.
    app.register_blueprint(crud_bp, url_prefix="/api/v1")

    # Workflow APIs:
    # leave apply/approval, leave balance updates, performance review,
    # payroll run, expense decisions and ticket workflow.
    # Leave approval flow:
    # Team Leader -> Reporting Officer -> Final approval.
    # If no Team Leader exists, it goes to Reporting Officer.
    # If neither exists, it goes to HR.
    app.register_blueprint(workflow_bp, url_prefix="/api/v1")

    # Report APIs:
    # attendance, WFH/Field, holidays, comp-off, leave balances,
    # leave requests, leave records and audit reports.
    app.register_blueprint(reports_bp, url_prefix="/api/v1/reports")

    # Super Admin APIs:
    # companies, users, full employee profile creation/update,
    # employee capability mapping and password reset.
    app.register_blueprint(superadmin_bp, url_prefix="/api/v1/superadmin")

    # Password request APIs:
    # employee password change request and Super Admin approval flow.
    app.register_blueprint(password_requests_bp, url_prefix="/api/v1")

    @app.get("/")
    def root():
        return jsonify({
            "ok": True,
            "message": "SDS HRMS API",
            "frontend": "Run React Vite on port 5173",
            "backend": "Flask + MongoDB",
            "version": "v1",
            "workflow_rules": {
                "employee_dashboard": "Every staff login opens as Employee unless Admin/HR/Finance/Super Admin.",
                "team_leader": "Team Leader is an employee capability, not a separate login identity.",
                "reporting_officer": "Reporting Officer is an employee capability, not a separate login identity.",
                "leave_approval": "Team Leader -> Reporting Officer -> Final approval; HR fallback when no approver mapping exists.",
                "leave_types": ["Casual Leave", "Earned Leave"],
            },
            "modules": [
                "Authentication",
                "Dashboard",
                "Employee Master",
                "Attendance",
                "WFH / Field Requests",
                "Holiday Calendar",
                "Comp-Off",
                "Leave Management",
                "Leave Balances",
                "Reports",
                "Super Admin",
                "Password Requests",
            ],
        })

    @app.get("/api/v1/health")
    def health():
        return jsonify({
            "ok": True,
            "service": "SDS HRMS API",
            "stack": "React Vite + Flask + MongoDB",
            "version": "v1",
            "attendance_module": True,
            "leave_module": True,
            "reports_module": True,
            "employee_capability_mapping": True,
            "team_leader_as_capability": True,
            "reporting_officer_as_capability": True,
            "leave_types": {
                "casual_leave": "CL",
                "earned_leave": "EL",
            },
        })

    @app.errorhandler(400)
    def bad_request(_error):
        return jsonify({
            "ok": False,
            "message": "Bad request",
        }), 400

    @app.errorhandler(401)
    def unauthorized(_error):
        return jsonify({
            "ok": False,
            "message": "Unauthorized. Please login again.",
        }), 401

    @app.errorhandler(403)
    def forbidden(_error):
        return jsonify({
            "ok": False,
            "message": "You do not have permission to perform this action.",
        }), 403

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({
            "ok": False,
            "message": "API route not found",
        }), 404

    @app.errorhandler(405)
    def method_not_allowed(_error):
        return jsonify({
            "ok": False,
            "message": "Method not allowed for this API route.",
        }), 405

    @app.errorhandler(500)
    def internal_error(_error):
        return jsonify({
            "ok": False,
            "message": "Internal server error",
        }), 500

    return app