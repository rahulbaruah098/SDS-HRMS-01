from flask import Flask, jsonify
from flask_cors import CORS
import os

from .config import Config
from .extensions import init_db
from .routes.auth import auth_bp
from .routes.dashboard import dashboard_bp
from .routes.attendance import attendance_bp
from .routes.workflow import workflow_bp
from .routes.projects import projects_bp
from .routes.grievances import grievances_bp
from .routes.it_support import it_support_bp
from .routes.policies import policies_bp
from .routes.celebrations import celebrations_bp
from .routes.crud import crud_bp
from .routes.reports import reports_bp
from .routes.superadmin import superadmin_bp
from .routes.password_requests import password_requests_bp
from .routes.profile_photos import profile_photos_bp
from app.routes.management_groups import management_groups_bp


def _get_allowed_origins():
    """
    Builds allowed frontend origins for local development, LAN testing,
    and optional environment-based frontend URLs.

    You can also add this in backend .env if needed:
    FRONTEND_ORIGINS=http://192.168.29.85:5173,http://localhost:5173
    """

    default_origins = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://localhost:3000",

        # Common LAN/dev origins.
        # Keep these so frontend opened from another device can call backend.
        "http://192.168.29.85:5173",
        "http://192.168.29.85:3000",
        "http://192.168.29.85:4173",
    ]

    env_origins = os.getenv("FRONTEND_ORIGINS", "")
    extra_origins = [
        origin.strip()
        for origin in env_origins.split(",")
        if origin.strip()
    ]

    origins = []
    for origin in default_origins + extra_origins:
        if origin not in origins:
            origins.append(origin)

    return origins


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    allowed_origins = _get_allowed_origins()

    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": allowed_origins,
            },
            r"/api/v1/*": {
                "origins": allowed_origins,
            },
            r"/": {
                "origins": allowed_origins,
            },
        },
        allow_headers=[
            "Content-Type",
            "Authorization",
            "Accept",
            "Origin",
            "X-Requested-With",
        ],
        expose_headers=[
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
        max_age=86400,
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

    # Dedicated Project APIs:
    # project detail, project assignment, daily progress submission,
    # project progress history, and project analytics.
    # Keep this before generic CRUD so project-specific routes are preferred.
    app.register_blueprint(projects_bp, url_prefix="/api/v1/projects")

    # Grievance module APIs:
    # employee grievance submission, anonymous grievance option,
    # HR/Admin grievance inbox, status update, remarks and notifications.
    #
    # Keep this before generic CRUD so the dedicated grievance routes are preferred.
    app.register_blueprint(grievances_bp, url_prefix="/api/v1/grievances")

    # IT Support module APIs:
    # employee IT support ticket submission, IT Head ticket assignment/reassignment,
    # assigned IT member status update, employee review after resolution,
    # and tenant-wise IT team handling.
    #
    # Keep this before generic CRUD so the dedicated IT Support routes are preferred.
    app.register_blueprint(it_support_bp, url_prefix="/api/v1/it-support")


    # Management Group module APIs:
    # tenant admin controls Management Group members, schedules group meetings,
    # assigns minutes writers, and maintains meeting minutes history.
    # Non-members can only view the Management Group member list.
    #
    # Keep this before generic CRUD so Management Group routes are not captured by CRUD fallback.
    app.register_blueprint(management_groups_bp, url_prefix="/api/v1/management-groups")

    # Dedicated Policies APIs:
    # HR uploads tenant-wise policy documents.
    # Employees can view/download policies only from their own tenant.
    #
    # Keep this before generic CRUD so upload/download routes are preferred.
    app.register_blueprint(policies_bp, url_prefix="/api/v1")
    
    # Profile Photo APIs:
    # Employees/Admins upload profile photos from computer.
    # Backend stores the file under uploads/profile_photos and saves only the safe URL/path in MongoDB.
    #
    # Keep this before generic CRUD so upload/static profile photo routes are preferred.
    app.register_blueprint(profile_photos_bp, url_prefix="/api/v1")
    
    # Hidden Celebrations APIs:
    # Birthday and work anniversary greetings are tenant-wise and released at 10:00 AM.
    #
    # Keep this before generic CRUD so /celebrations routes are not captured by CRUD fallback.
    app.register_blueprint(celebrations_bp, url_prefix="/api/v1/celebrations")
    
    # Workflow APIs:
    # leave apply/approval, combined CL + EL leave balance updates,
    # notification bell APIs, performance review, payroll run, expense decisions,
    # and existing ticket workflow.
    #
    # Keep this before generic CRUD so dedicated workflow routes are preferred:
    # /leave_balances
    # /leave_requests/options
    # /leave_requests/apply
    # /leave_requests/<id>/decision
    # /notifications
    #
    # Leave approval flow:
    # Team Leader -> Reporting Officer -> Final approval.
    # If no Team Leader exists, it goes to Reporting Officer.
    # If neither exists, it goes to HR.
    app.register_blueprint(workflow_bp, url_prefix="/api/v1")

    # Generic CRUD APIs:
    # employees, masters, projects fallback, leave_balances fallback,
    # leave_requests list fallback, holiday_calendar, attendance_logs,
    # attendance_mode_requests, compoff_credits, notifications fallback, etc.
    #
    # Employee Master creates every staff profile as Employee.
    # Team Leader / Reporting Officer are stored as employee capability mappings.
    app.register_blueprint(crud_bp, url_prefix="/api/v1")

    # Report APIs:
    # attendance, WFH/Field, holidays, comp-off, leave balances,
    # leave requests, leave approvals, leave deductions, leave records and audit.
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
            "cors": {
                "enabled": True,
                "allowed_origins": allowed_origins,
                "note": "Set FRONTEND_ORIGINS in backend .env for additional frontend URLs.",
            },
            "workflow_rules": {
                "employee_dashboard": "Every staff login opens as Employee unless Admin/HR/Finance/Super Admin.",
                "team_leader": "Team Leader is an employee capability, not a separate login identity.",
                "reporting_officer": "Reporting Officer is an employee capability, not a separate login identity.",
                "leave_approval": "Team Leader -> Reporting Officer -> Final approval; HR fallback when no approver mapping exists.",
                "leave_types": ["Casual Leave", "Earned Leave"],
                "leave_balance": "Casual Leave and Earned Leave balances are managed together by HR/Admin/Super Admin.",
                "notifications": "Leave workflow notifications are available through the notification bell APIs.",
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
                "Projects",
                "Project Progress",
                "Management Group",
                "Grievances",
                "IT Support",
                "Reports",
                "Notifications",
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
            "cors": {
                "enabled": True,
                "allowed_origins": allowed_origins,
            },
            "attendance_module": True,
            "leave_module": True,
            "leave_balance_module": True,
            "notification_module": True,
            "project_module": True,
            "project_progress_module": True,
            "grievance_module": True,
            "it_support_module": True,
            "management_group_module": True,
            "reports_module": True,
            "employee_capability_mapping": True,
            "team_leader_as_capability": True,
            "reporting_officer_as_capability": True,
            "it_support_team_mapping": {
                "it_head": "Stored on employee profile as is_it_support_head",
                "it_member": "Stored on employee profile as is_it_support_member",
                "tenant_wise": True,
            },
            "leave_types": {
                "casual_leave": "CL",
                "earned_leave": "EL",
            },
            "leave_approval_flow": [
                "Team Leader",
                "Reporting Officer",
                "Final Approval",
            ],
            "route_order": [
                "auth",
                "dashboard",
                "attendance",
                "projects",
                "grievances",
                "it_support",
                "workflow",
                "crud",
                "reports",
                "superadmin",
                "password_requests",
            ],
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