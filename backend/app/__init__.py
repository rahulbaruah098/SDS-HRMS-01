from flask import Flask, jsonify
from flask_cors import CORS
import os

from .config import Config
from .extensions import init_db
from .routes.auth import auth_bp
from .routes.demo_requests import demo_requests_bp
from .routes.billing import billing_bp
from .routes.payroll import payroll_bp
from .routes.dashboard import dashboard_bp
from .routes.attendance import attendance_bp
from .routes.field_visits import field_visits_bp
from .routes.workflow import workflow_bp
from .routes.projects import projects_bp
from .routes.grievances import grievances_bp
from .routes.it_support import it_support_bp
from .routes.policies import policies_bp
from .routes.celebrations import celebrations_bp
from .routes.crud import crud_bp
from .routes.reports import reports_bp
from .routes.superadmin import superadmin_bp
from .routes.profile_photos import profile_photos_bp
from app.routes.management_groups import management_groups_bp
from app.routes.assets import assets_bp
from app.routes.ai_assistant import ai_assistant_bp
from .routes.recruitment import recruitment_bp
from .routes.account_access import account_access_bp
from .services.recruitment_service import ensure_recruitment_indexes


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
        "http://127.0.0.1:4173",
        "http://localhost:4173",

        # Current LAN/dev origin.
        "http://192.168.29.94:5173",
        "http://192.168.29.94:3000",
        "http://192.168.29.94:4173",

        # Previous LAN/dev origin kept for fallback.
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

    database = init_db(app)
    ensure_recruitment_indexes(database)

    # Auth/session APIs:
    # login, current user, employee profile snapshot, capability sync.
    app.register_blueprint(auth_bp, url_prefix="/api/v1/auth")

    # YourComate SaaS demo request APIs:
    # apply for demo registration, send/verify/resend OTP,
    # Superadmin approve/reject demo requests, and email demo admin credentials.
    # Keep this early because it is used from the public login/demo registration flow.
    app.register_blueprint(demo_requests_bp, url_prefix="/api/v1/demo-requests")


    # Public account-access support APIs:
    # employee lookup by registered email/employee code, account-access request
    # submission, public ticket tracking, and tenant-restricted HR/IT handling.
    # Keep this before authenticated and generic CRUD routes because employees
    # must be able to create and track these tickets without signing in.
    app.register_blueprint(account_access_bp, url_prefix="/api/v1/account-access")

    # YourComate SaaS billing/payment APIs:
    # billing summary, Razorpay order creation, payment verification,
    # subscription activation, Superadmin payment/subscription monitoring,
    # and expired demo refresh.
    # Keep this early so expired demo companies can still access upgrade/payment APIs.
    app.register_blueprint(billing_bp, url_prefix="/api/v1/billing")

    # Payroll configuration APIs:
    # employee salary structures, salary revision history, activation,
    # and tenant/state-wise statutory configuration.
    # Keep this before workflow and generic CRUD because workflow.py still
    # contains the existing legacy payroll-run endpoint.
    app.register_blueprint(payroll_bp, url_prefix="/api/v1/payroll")

    # Dashboard APIs:
    # Super Admin, Admin/HR/Finance, and Employee dashboard.
    # Team Leader / Reporting Officer are employee capabilities and remain
    # inside Employee Dashboard, not separate dashboard identities.
    app.register_blueprint(dashboard_bp, url_prefix="/api/v1/dashboard")

    # Attendance module APIs:
    # direct Office/WFH/Field check-in, check-out, status, field photo/location,
    # holiday work approval requests, team field tracking, holiday calendar,
    # comp-off generation and comp-off claim.
    app.register_blueprint(attendance_bp, url_prefix="/api/v1/attendance")

    # My Visit APIs:
    # employee visit scheduling, notes, optional photos, rescheduling/cancellation,
    # Start -> Reached -> End GPS checkpoints, visit history, and tenant-scoped
    # Team Leader / Reporting Officer review with employee, date and department filters.
    # Keep this before generic CRUD so visit workflow routes are resolved explicitly.
    app.register_blueprint(field_visits_bp, url_prefix="/api/v1/field-visits")

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

    # Asset module APIs:
    # Employees can submit their own hardware/software asset entries.
    # HR/Admin/Super Admin can add assets for employees, verify records,
    # update asset status/condition, delete records softly, and generate reports.
    #
    # Keep this before generic CRUD so /assets routes are not captured by CRUD fallback.
    app.register_blueprint(assets_bp, url_prefix="/api/v1/assets")
    
    # AI Assistant APIs:
    # HRMS workflow help chatbot for logged-in users.
    # Provides text chat and AI knowledge seeding.
    app.register_blueprint(ai_assistant_bp, url_prefix="/api/v1/ai-assistant")

    # Recruitment module APIs:
    # hiring requests, approved job openings, candidate applications, resume parsing,
    # interviews, structured feedback, offers, joining documents, employee conversion,
    # tenant-wise career pages, dashboards, reports, and recruitment settings.
    #
    # Keep this before generic CRUD so legacy job_openings/candidates routes cannot
    # capture dedicated recruitment workflow endpoints.
    app.register_blueprint(recruitment_bp, url_prefix="/api/v1/recruitment")
    
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
    # legacy attendance_mode_requests, holiday_work_requests, compoff_credits,
    # notifications fallback, etc.
    app.register_blueprint(crud_bp, url_prefix="/api/v1")

    # Report APIs:
    # attendance, field attendance, holiday work approvals, holidays,
    # comp-off credits, comp-off claims, expired comp-off, leave balances,
    # leave requests, leave approvals, leave deductions, leave records and audit.
    app.register_blueprint(reports_bp, url_prefix="/api/v1/reports")

    # Super Admin APIs:
    # companies, users, full employee profile creation/update,
    # employee capability mapping and password reset.
    app.register_blueprint(superadmin_bp, url_prefix="/api/v1/superadmin")

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
                "holiday_work_approval": "Holiday work on Sunday, second Saturday, fourth Saturday or HR-created holiday requires approval before attendance.",
                "attendance_modes": "Office, WFH and Field attendance are directly available. Field attendance requires place, photo and location metadata.",
                "leave_types": ["Casual Leave", "Earned Leave", "Half Day", "Comp-Off"],
                "leave_balance": "Casual Leave and Earned Leave balances are managed together by HR/Admin/Super Admin.",
                "comp_off": "Approved holiday work attendance creates comp-off credit after checkout. Credit is claimable from next working day within 7 working days.",
                "notifications": "Leave, holiday work, attendance and comp-off workflow notifications are available through the notification bell APIs.",
                "recruitment": "Hiring request -> approval -> job opening -> candidate -> interview -> offer -> joining documents -> employee conversion.",
            },
            "modules": [
                "Authentication",
                "SaaS Trial Requests",
                "Public Account Access Support",
                "Dashboard",
                "Employee Master",
                "Attendance",
                "Direct Office/WFH/Field Attendance",
                "Holiday Work Requests",
                "My Visit",
                "Holiday Calendar",
                "Comp-Off Credits",
                "Leave Management",
                "Leave Balances",
                "Payroll",
                "Projects",
                "Project Progress",
                "Management Group",
                "Assets",
                "Grievances",
                "IT Support",
                "Reports",
                "Notifications",
                "Recruitment",
                "Super Admin",
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
            "saas_demo_requests_module": True,
            "account_access_support_module": True,
            "attendance_module": True,
            "direct_attendance_modes": ["office", "wfh", "field"],
            "field_attendance_requires": ["field_location", "field_photo", "location_metadata"],
            "holiday_work_requests": True,
            "my_visit_module": True,
            "field_visit_workflow": ["scheduled", "started", "reached", "completed", "cancelled"],
            "comp_off_claim_window": "Next working day through 7 working days after approved holiday work attendance",
            "leave_module": True,
            "leave_balance_module": True,
            "payroll_module": True,
            "notification_module": True,
            "recruitment_module": True,
            "resume_parser": ["pdf", "docx", "txt"],
            "recruitment_workflow": [
                "Hiring Request",
                "Approval",
                "Job Opening",
                "Candidate Application",
                "Interview",
                "Offer",
                "Joining Documents",
                "Employee Conversion",
            ],
            "project_module": True,
            "project_progress_module": True,
            "grievance_module": True,
            "it_support_module": True,
            "management_group_module": True,
            "asset_module": True,
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
                "half_day": "HALF-DAY",
                "comp_off": "COMP-OFF",
            },
            "leave_approval_flow": [
                "Team Leader",
                "Reporting Officer",
                "Final Approval",
            ],
            "route_order": [
                "auth",
                "demo_requests",
                "account_access",
                "billing",
                "payroll",
                "dashboard",
                "attendance",
                "field_visits",
                "projects",
                "grievances",
                "it_support",
                "management_groups",
                "assets",
                "ai_assistant",
                "recruitment",
                "policies",
                "profile_photos",
                "celebrations",
                "workflow",
                "crud",
                "reports",
                "superadmin",
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