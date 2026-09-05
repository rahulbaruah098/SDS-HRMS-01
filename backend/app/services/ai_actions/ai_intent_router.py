"""
Saya final structured intent router.

File 19 consolidates every currently registered Saya operational intent across
Employee self-service, Team Leader/Reporting Officer, HR/Recruitment,
Finance/Payroll, and Admin/Super Admin modules.

This module performs LANGUAGE CLASSIFICATION ONLY. It never authorizes a user,
checks tenant permissions, writes HRMS data, approves requests, or claims that an
action succeeded. Authorization and execution remain in ai_action_service.py
and its registered action plugins.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, Iterable, Optional

from app.services.ai_provider_service import AiProviderError, generate_ai_chat_response


ROUTER_SCHEMA_VERSION = 2
DEFAULT_ACTION_THRESHOLD = 0.78
DEFAULT_INFO_THRESHOLD = 0.62

# Final File 19 catalog. Keep IDs exactly aligned with the core action registry
# and the plugins delivered in Files 15-18. The router does not import those
# modules, avoiding an ai_intent_router <-> ai_action_service circular import.
INTENT_CATALOG = {
    'admin_module_access': {"label": 'Organisation Module Access', "kind": 'read', "phrases": ('our allowed modules', 'company module access', 'which modules do we have', 'subscription modules', 'enabled modules')},
    'admin_organisation_overview': {"label": 'Organisation Administration Overview', "kind": 'read', "phrases": ('organisation overview', 'organization overview', 'company admin overview', 'company overview', 'admin dashboard overview')},
    'admin_subscription_status': {"label": 'Organisation Subscription Status', "kind": 'read', "phrases": ('our subscription status', 'company subscription', 'our plan status', 'subscription expiry', 'our trial status', 'company plan')},
    'admin_user_access_overview': {"label": 'Organisation User Access Overview', "kind": 'read', "phrases": ('user access overview', 'company users overview', 'how many active users', 'admin user accounts', 'role distribution')},
    'apply_leave': {"label": 'Apply Leave', "kind": 'write', "phrases": ('apply leave', 'apply for leave', 'request leave', 'submit leave request', 'create leave request', 'start leave request', 'mark my leave', 'put my leave', 'put leave', 'put cl', 'put el', 'book leave', 'take leave', 'i need leave', 'i want leave')},
    'attendance_check_in': {"label": 'Attendance Check-In', "kind": 'write', "phrases": ('check me in', 'check in me', 'mark my check in', 'mark my check-in', 'punch me in', 'punch in', 'clock me in', 'clock in', 'start my attendance')},
    'attendance_check_out': {"label": 'Attendance Check-Out', "kind": 'write', "phrases": ('check me out', 'check out me', 'mark my check out', 'mark my check-out', 'punch me out', 'punch out', 'clock me out', 'clock out', 'end my attendance')},
    'claim_compoff': {"label": 'Claim Comp-Off', "kind": 'write', "phrases": ('claim compoff', 'claim comp-off', 'claim comp off', 'use compoff', 'use comp-off', 'use comp off')},
    'create_it_support_ticket': {"label": 'Create IT Support Ticket', "kind": 'write', "phrases": ('raise it ticket', 'create it ticket', 'open it ticket', 'raise support ticket', 'create support ticket', 'open support ticket', 'report it issue', 'submit it issue')},
    'create_reminder': {"label": 'Create Reminder', "kind": 'write', "phrases": ('remind me', 'set reminder', 'set a reminder', 'create reminder', 'create a reminder', 'add reminder', 'add a reminder')},
    'decide_attendance_mode_request': {"label": 'Approve / Reject WFH or Field Attendance', "kind": 'write', "phrases": ('approve wfh', 'reject wfh', 'approve work from home', 'reject work from home', 'approve field attendance', 'reject field attendance', 'approve field request', 'reject field request')},
    'decide_holiday_work_request': {"label": 'Approve / Reject Holiday Work', "kind": 'write', "phrases": ('approve holiday work', 'reject holiday work', 'holiday work approval', 'approve holiday request', 'reject holiday request')},
    'decide_team_leave': {"label": 'Approve / Reject Team Leave', "kind": 'write', "phrases": ('approve leave', 'reject leave', 'approve team leave', 'reject team leave', 'approve his leave', 'approve her leave', 'decline leave request', 'leave approval')},
    'hr_decide_leave': {"label": 'Approve / Reject HR-Stage Leave', "kind": 'write', "phrases": ('hr approve leave', 'hr reject leave', 'approve leave as hr', 'reject leave as hr', 'final approve leave', 'final leave approval')},
    'hr_leave_approval_queue': {"label": 'HR Leave Approval Queue', "kind": 'read', "phrases": ('hr leave approvals', 'leave approvals pending with hr', 'pending hr leave approvals', 'hr approval queue', 'show hr leave queue')},
    'hr_onboarding_overview': {"label": 'Onboarding Overview', "kind": 'read', "phrases": ('onboarding overview', 'who has not completed onboarding', 'pending onboarding', 'incomplete onboarding', 'onboarding tasks', 'onboarding status')},
    'hr_workforce_overview': {"label": 'HR Workforce Overview', "kind": 'read', "phrases": ('workforce overview', 'hr workforce overview', 'employee headcount', 'how many active employees', 'employees on probation', 'probation ending this month', 'probation ends this month', 'confirmation due this month')},
    'manager_pending_approvals': {"label": 'Show My Pending Team Approvals', "kind": 'read', "phrases": ('show my pending approvals', 'pending team approvals', 'what approvals are waiting for me', 'show pending requests for approval', 'my approval queue', 'team approval queue')},
    'manager_project_overview': {"label": 'Team Project Overview', "kind": 'read', "phrases": ('show team projects', 'team project overview', 'which projects are behind', 'which projects are overdue', 'show projects behind schedule', 'my team projects')},
    'manager_team_attendance': {"label": 'Team Attendance Summary', "kind": 'read', "phrases": ('team attendance', 'who is absent today', 'who is late today', 'who has not checked in', 'show my team attendance', 'team attendance today', 'who is on wfh today', 'who is in field today')},
    'payroll_calculate_run': {"label": 'Calculate Draft Payroll', "kind": 'write', "phrases": ('calculate payroll', 'run payroll calculation', 'process draft payroll', 'calculate monthly payroll', 'prepare payroll run')},
    'payroll_change_tds_instruction_status': {"label": 'Activate / Deactivate TDS Instruction', "kind": 'write', "phrases": ('activate tds instruction', 'deactivate tds instruction', 'enable tds instruction', 'disable tds instruction')},
    'payroll_decide_loan': {"label": 'Approve / Reject Loan or Advance', "kind": 'write', "phrases": ('approve loan', 'reject loan', 'approve salary advance', 'reject advance', 'review loan request', 'review advance request')},
    'payroll_disburse_loan': {"label": 'Disburse Loan or Advance', "kind": 'write', "phrases": ('disburse loan', 'disburse advance', 'mark loan paid', 'mark advance disbursed')},
    'payroll_disburse_run': {"label": 'Mark Payroll Disbursed', "kind": 'write', "phrases": ('mark payroll disbursed', 'salary disbursed', 'complete salary disbursement', 'mark salaries paid', 'record payroll disbursement')},
    'payroll_exceptions': {"label": 'Payroll Exceptions', "kind": 'read', "phrases": ('payroll exceptions', 'payroll errors', 'payroll issues', 'payroll problems', 'reconciliation issues', 'payroll mismatch')},
    'payroll_finance_approve_run': {"label": 'Finance Approve Payroll', "kind": 'write', "phrases": ('finance approve payroll', 'approve payroll by finance', 'approve salary payroll', 'finance approval payroll')},
    'payroll_hr_review_run': {"label": 'Complete Payroll HR Review', "kind": 'write', "phrases": ('complete payroll hr review', 'hr review payroll', 'mark payroll hr reviewed', 'send payroll to finance')},
    'payroll_loan_queue': {"label": 'Loan / Advance Finance Queue', "kind": 'read', "phrases": ('pending loans', 'pending advances', 'loan approval queue', 'advance approval queue', 'loans waiting for finance')},
    'payroll_lock_run': {"label": 'Lock Payroll', "kind": 'write', "phrases": ('lock payroll', 'lock salary run', 'release payslips', 'finalize and lock payroll')},
    'payroll_missing_bank_details': {"label": 'Payroll Bank Readiness', "kind": 'read', "phrases": ('missing bank details', 'bank details missing', 'unverified bank details', 'bank readiness', 'employees missing bank')},
    'payroll_overview': {"label": 'Payroll Status Overview', "kind": 'read', "phrases": ('payroll status', 'payroll overview', 'salary processing status', 'payroll run status', 'where is payroll')},
    'payroll_reimbursement_queue': {"label": 'Reimbursement Review Queue', "kind": 'read', "phrases": ('pending reimbursements', 'reimbursement queue', 'reimbursements waiting', 'reimbursement approvals')},
    'payroll_review_reimbursement': {"label": 'Review Reimbursement', "kind": 'write', "phrases": ('approve reimbursement', 'reject reimbursement', 'review reimbursement', 'complete reimbursement hr review', 'finance approve reimbursement')},
    'payroll_review_tax_declaration': {"label": 'Review Employee Tax Declaration', "kind": 'write', "phrases": ('review tax declaration', 'approve tax declaration', 'reject tax declaration', 'lock tax declaration', 'complete tax hr review')},
    'payroll_statutory_summary': {"label": 'Payroll Statutory Summary', "kind": 'read', "phrases": ('statutory summary', 'payroll pf esi', 'pf esi tds summary', 'professional tax summary', 'payroll statutory')},
    'payroll_summary_report': {"label": 'Payroll Summary', "kind": 'read', "phrases": ('payroll summary', 'salary summary', 'monthly payroll total', 'net payroll', 'payroll totals')},
    'payroll_sync_attendance': {"label": 'Synchronize Payroll Attendance', "kind": 'write', "phrases": ('sync payroll attendance', 'synchronize payroll attendance', 'refresh payroll attendance', 'prepare attendance for payroll')},
    'payroll_tax_queue': {"label": 'Tax Declaration Review Queue', "kind": 'read', "phrases": ('pending tax declarations', 'tax declaration queue', 'tax declarations waiting', 'tax approval queue')},
    'payroll_tds_overview': {"label": 'TDS Instruction Overview', "kind": 'read', "phrases": ('tds instructions', 'tds overview', 'active tds', 'tds status')},
    'payroll_trend': {"label": 'Payroll Trend', "kind": 'read', "phrases": ('payroll trend', 'salary trend', 'payroll last six months', 'payroll history trend')},
    'payroll_variance': {"label": 'Payroll Variance', "kind": 'read', "phrases": ('payroll variance', 'compare payroll', 'salary variance', 'month on month payroll', 'payroll difference')},
    'payroll_verify_bank_details': {"label": 'Verify / Reject Employee Bank Details', "kind": 'write', "phrases": ('verify bank details', 'approve bank details', 'reject bank details', 'verify employee bank account')},
    'recruitment_candidate_pipeline': {"label": 'Candidate Pipeline', "kind": 'read', "phrases": ('candidate pipeline', 'recruitment pipeline', 'application pipeline', 'show candidates by stage', 'recent applications', 'candidate stages')},
    'recruitment_change_interview_status': {"label": 'Update Interview Status', "kind": 'write', "phrases": ('mark interview completed', 'complete interview', 'cancel interview', 'candidate absent interview', 'interviewer absent', 'update interview status')},
    'recruitment_change_job_opening_status': {"label": 'Publish / Pause / Close Job Opening', "kind": 'write', "phrases": ('publish job opening', 'open job vacancy', 'pause job opening', 'close job opening', 'cancel job opening', 'change job opening status')},
    'recruitment_change_joining_status': {"label": 'Change Candidate Joining Status', "kind": 'write', "phrases": ('change joining status', 'mark candidate ready to join', 'joining deferred', 'candidate did not join', 'documents pending candidate')},
    'recruitment_complete_interview_process': {"label": 'Complete Interview Process', "kind": 'write', "phrases": ('complete interview process', 'finish interview process', 'close interview rounds', 'complete all interview rounds')},
    'recruitment_convert_candidate_to_employee': {"label": 'Convert Candidate to Employee', "kind": 'write', "phrases": ('convert candidate to employee', 'create employee from candidate', 'onboard candidate as employee', 'make candidate employee')},
    'recruitment_create_application': {"label": 'Create Candidate Application', "kind": 'write', "phrases": ('create application for candidate', 'link candidate to job', 'apply candidate to job', 'add candidate application')},
    'recruitment_create_candidate': {"label": 'Create Candidate', "kind": 'write', "phrases": ('create candidate', 'add candidate', 'new candidate', 'register candidate', 'add applicant')},
    'recruitment_create_hiring_request': {"label": 'Create Hiring Request', "kind": 'write', "phrases": ('create hiring request', 'new hiring request', 'raise hiring request', 'need to hire', 'request new position', 'request new vacancy')},
    'recruitment_create_job_opening': {"label": 'Create Job Opening', "kind": 'write', "phrases": ('create job opening', 'create vacancy', 'create job from hiring request', 'open approved vacancy', 'prepare job opening')},
    'recruitment_create_offer': {"label": 'Prepare Offer Draft', "kind": 'write', "phrases": ('create offer', 'prepare offer', 'draft offer', 'create candidate offer', 'prepare salary offer')},
    'recruitment_dashboard_summary': {"label": 'Recruitment Dashboard Summary', "kind": 'read', "phrases": ('recruitment dashboard', 'recruitment overview', 'hiring overview', 'recruitment status', 'recruitment summary')},
    'recruitment_decide_hiring_request': {"label": 'Final Hiring Request Decision', "kind": 'write', "phrases": ('approve hiring request', 'reject hiring request', 'final hiring approval', 'return hiring request', 'hold hiring request')},
    'recruitment_decide_offer': {"label": 'Approve / Reject Offer', "kind": 'write', "phrases": ('approve offer', 'reject offer', 'offer approval decision', 'approve salary offer', 'reject salary offer')},
    'recruitment_interview_schedule_view': {"label": 'Recruitment Interview Schedule', "kind": 'read', "phrases": ('show interviews', 'interviews today', 'upcoming interviews', 'interview schedule', 'recruitment interviews')},
    'recruitment_reschedule_interview': {"label": 'Reschedule Candidate Interview', "kind": 'write', "phrases": ('reschedule interview', 'change interview time', 'move interview to')},
    'recruitment_review_joining_document': {"label": 'Review Joining Document', "kind": 'write', "phrases": ('review joining document', 'accept joining document', 'reject joining document', 'joining document correction', 'verify joining document')},
    'recruitment_schedule_interview': {"label": 'Schedule Candidate Interview', "kind": 'write', "phrases": ('schedule interview', 'schedule candidate interview', 'create interview', 'book interview', 'arrange interview')},
    'recruitment_screen_candidate': {"label": 'Screen Candidate', "kind": 'write', "phrases": ('screen candidate', 'candidate screening', 'shortlist after screening', 'screen this applicant', 'update screening outcome')},
    'recruitment_send_offer': {"label": 'Send Approved Offer', "kind": 'write', "phrases": ('send offer to candidate', 'send approved offer', 'email candidate offer', 'issue offer letter', 'send offer letter')},
    'recruitment_submit_hiring_request': {"label": 'Submit Hiring Request for Approval', "kind": 'write', "phrases": ('submit hiring request', 'send hiring request for approval', 'submit vacancy request', 'submit recruitment request')},
    'recruitment_submit_interview_feedback': {"label": 'Submit Interview Feedback', "kind": 'write', "phrases": ('submit interview feedback', 'give interview feedback', 'record interview feedback', 'interview recommendation', 'candidate interview feedback')},
    'recruitment_submit_offer_for_approval': {"label": 'Submit Offer for Approval', "kind": 'write', "phrases": ('submit offer for approval', 'send offer for approval', 'request offer approval', 'salary offer approval')},
    'recruitment_update_application_stage': {"label": 'Update Candidate Stage', "kind": 'write', "phrases": ('update candidate stage', 'move candidate to', 'shortlist candidate', 'reject candidate', 'put candidate on hold', 'change application status')},
    'recruitment_update_background_check': {"label": 'Update Background Check', "kind": 'write', "phrases": ('update background check', 'background verification', 'mark background check', 'candidate background check')},
    'request_attendance_mode': {"label": 'Request WFH / Field Attendance', "kind": 'write', "phrases": ('request wfh', 'apply wfh', 'request work from home', 'apply work from home', 'request field attendance', 'request field work', 'field attendance request', 'field work request')},
    'request_holiday_work': {"label": 'Request Holiday Work', "kind": 'write', "phrases": ('request holiday work', 'holiday work request', 'apply holiday work', 'work on holiday approval', 'request to work on holiday')},
    'schedule_management_meeting': {"label": 'Schedule Management Group Meeting', "kind": 'write', "phrases": ('schedule management group meeting', 'schedule a management group meeting', 'create management group meeting', 'set up management group meeting', 'schedule meeting', 'schedule a meeting', 'create meeting', 'create a meeting', 'set up meeting')},
    'submit_grievance': {"label": 'Submit Grievance', "kind": 'write', "phrases": ('raise grievance', 'submit grievance', 'file grievance', 'create grievance', 'raise complaint', 'file complaint')},
    'superadmin_activate_company': {"label": 'Activate Company', "kind": 'write', "phrases": ('activate company', 'activate tenant', 'reactivate company', 'enable company account')},
    'superadmin_billing_overview': {"label": 'Platform Billing Overview', "kind": 'read', "phrases": ('platform billing overview', 'saas billing overview', 'subscription billing status', 'payment overview', 'platform revenue overview')},
    'superadmin_company_list': {"label": 'Platform Company List', "kind": 'read', "phrases": ('list companies', 'show tenants', 'show companies', 'list trial companies', 'list paid companies', 'suspended companies', 'expired companies')},
    'superadmin_expiring_tenants': {"label": 'Expiring Subscription / Trial Monitor', "kind": 'read', "phrases": ('subscriptions expiring', 'companies expiring', 'tenants expiring', 'trials expiring', 'expiring in 30 days', 'renewals due')},
    'superadmin_extend_trial': {"label": 'Extend Trial', "kind": 'write', "phrases": ('extend trial', 'extend demo', 'add trial days', 'extend company trial')},
    'superadmin_maintenance_status': {"label": 'Platform Maintenance Status', "kind": 'read', "phrases": ('maintenance status', 'is maintenance mode on', 'platform maintenance', 'yourcomate maintenance status')},
    'superadmin_mark_company_paid': {"label": 'Manual Paid Activation', "kind": 'write', "phrases": ('mark company paid', 'manual paid activation', 'activate paid plan', 'mark tenant paid')},
    'superadmin_platform_overview': {"label": 'YourComate Platform Overview', "kind": 'read', "phrases": ('platform overview', 'super admin overview', 'saas overview', 'yourcomate platform status', 'all tenants summary')},
    'superadmin_premium_requests': {"label": 'Premium Request Overview', "kind": 'read', "phrases": ('premium requests', 'premium quotation requests', 'open premium requests', 'premium sales pipeline', 'premium quotes')},
    'superadmin_pricing_overview': {"label": 'Pricing Plan Overview', "kind": 'read', "phrases": ('pricing plans', 'show plans', 'plan pricing', 'essential growth premium pricing', 'subscription plans')},
    'superadmin_refresh_expired_trials': {"label": 'Refresh Expired Trials', "kind": 'write', "phrases": ('refresh expired trials', 'expire due demos', 'update expired demos', 'refresh demo status')},
    'superadmin_set_maintenance': {"label": 'Change Platform Maintenance Mode', "kind": 'write', "phrases": ('enable maintenance', 'disable maintenance', 'turn on maintenance', 'turn off maintenance', 'maintenance mode on', 'maintenance mode off')},
    'superadmin_set_tenant_user_status': {"label": 'Enable / Disable Tenant User', "kind": 'write', "phrases": ('enable user account', 'disable user account', 'activate tenant user', 'deactivate tenant user', 'block user account', 'unblock user account')},
    'superadmin_suspend_company': {"label": 'Suspend Company', "kind": 'write', "phrases": ('suspend company', 'suspend tenant', 'disable company account', 'block tenant')},
    'superadmin_trial_overview': {"label": 'Trial Account Overview', "kind": 'read', "phrases": ('trial overview', 'demo overview', 'trial tenants', 'trial companies status', 'demo companies status')},
    'superadmin_update_premium_request': {"label": 'Update / Send Premium Quotation', "kind": 'write', "phrases": ('update premium request', 'send premium quotation', 'send premium quote', 'quote premium plan', 'change premium request status')},
    'superadmin_update_pricing_plan': {"label": 'Update Pricing Plan', "kind": 'write', "phrases": ('update pricing plan', 'change growth price', 'change essential price', 'change plan amount', 'change employee limit', 'deactivate pricing plan', 'activate pricing plan')},
    'update_project_progress': {"label": 'Update Project Progress', "kind": 'write', "phrases": ('update project progress', 'add project progress', 'submit project progress', 'set project progress', 'mark project progress', 'project progress update')},
    'verify_team_field_attendance': {"label": 'Verify Team Field Attendance', "kind": 'write', "phrases": ('verify field attendance', 'verify team attendance', 'verify field check in', 'verify field check-in', 'approve field attendance verification')},
}

READ_OPERATION_INTENTS = frozenset(['admin_module_access', 'admin_organisation_overview', 'admin_subscription_status', 'admin_user_access_overview', 'hr_leave_approval_queue', 'hr_onboarding_overview', 'hr_workforce_overview', 'manager_pending_approvals', 'manager_project_overview', 'manager_team_attendance', 'payroll_exceptions', 'payroll_loan_queue', 'payroll_missing_bank_details', 'payroll_overview', 'payroll_reimbursement_queue', 'payroll_statutory_summary', 'payroll_summary_report', 'payroll_tax_queue', 'payroll_tds_overview', 'payroll_trend', 'payroll_variance', 'recruitment_candidate_pipeline', 'recruitment_dashboard_summary', 'recruitment_interview_schedule_view', 'superadmin_billing_overview', 'superadmin_company_list', 'superadmin_expiring_tenants', 'superadmin_maintenance_status', 'superadmin_platform_overview', 'superadmin_premium_requests', 'superadmin_pricing_overview', 'superadmin_trial_overview'])
WRITE_OPERATION_INTENTS = frozenset(['apply_leave', 'attendance_check_in', 'attendance_check_out', 'claim_compoff', 'create_it_support_ticket', 'create_reminder', 'decide_attendance_mode_request', 'decide_holiday_work_request', 'decide_team_leave', 'hr_decide_leave', 'payroll_calculate_run', 'payroll_change_tds_instruction_status', 'payroll_decide_loan', 'payroll_disburse_loan', 'payroll_disburse_run', 'payroll_finance_approve_run', 'payroll_hr_review_run', 'payroll_lock_run', 'payroll_review_reimbursement', 'payroll_review_tax_declaration', 'payroll_sync_attendance', 'payroll_verify_bank_details', 'recruitment_change_interview_status', 'recruitment_change_job_opening_status', 'recruitment_change_joining_status', 'recruitment_complete_interview_process', 'recruitment_convert_candidate_to_employee', 'recruitment_create_application', 'recruitment_create_candidate', 'recruitment_create_hiring_request', 'recruitment_create_job_opening', 'recruitment_create_offer', 'recruitment_decide_hiring_request', 'recruitment_decide_offer', 'recruitment_reschedule_interview', 'recruitment_review_joining_document', 'recruitment_schedule_interview', 'recruitment_screen_candidate', 'recruitment_send_offer', 'recruitment_submit_hiring_request', 'recruitment_submit_interview_feedback', 'recruitment_submit_offer_for_approval', 'recruitment_update_application_stage', 'recruitment_update_background_check', 'request_attendance_mode', 'request_holiday_work', 'schedule_management_meeting', 'submit_grievance', 'superadmin_activate_company', 'superadmin_extend_trial', 'superadmin_mark_company_paid', 'superadmin_refresh_expired_trials', 'superadmin_set_maintenance', 'superadmin_set_tenant_user_status', 'superadmin_suspend_company', 'superadmin_update_premium_request', 'superadmin_update_pricing_plan', 'update_project_progress', 'verify_team_field_attendance'])
EXECUTABLE_ACTION_INTENTS = frozenset(INTENT_CATALOG)
SPECIAL_INTENTS = frozenset({"cancel", "informational", "none"})
ALLOWED_INTENTS = EXECUTABLE_ACTION_INTENTS | SPECIAL_INTENTS

# Longest phrase wins. This ensures a specific phrase such as
# "hr approve leave" is checked before generic "approve leave".
DETERMINISTIC_PHRASE_RULES = tuple(
    sorted(
        (
            (str(phrase).strip().lower(), intent)
            for intent, definition in INTENT_CATALOG.items()
            for phrase in definition.get("phrases", ())
            if str(phrase).strip()
        ),
        key=lambda item: (-len(item[0]), item[0], item[1]),
    )
)


@dataclass
class SayaIntentResult:
    intent: str = "none"
    confidence: float = 0.0
    is_action: bool = False
    source: str = "deterministic"
    slots: Dict[str, Any] = None
    reason: str = ""
    schema_version: int = ROUTER_SCHEMA_VERSION
    operation_kind: str = "none"

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["slots"] = dict(self.slots or {})
        return data


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = _safe_str(os.getenv(name, ""))
    if not raw:
        return bool(default)
    return raw.lower() in {"1", "true", "yes", "on", "enabled"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return float(default)


def _clamp_confidence(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def _normalise_text(value: Any) -> str:
    text = _safe_str(value).lower().replace("’", "'")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(
        r"^(?:hey|hi|hello)?\s*(?:saya|saaya|saiya|sayaa)\s*[,.:;!?-]*\s*",
        "", text, count=1,
    ).strip()
    return text


def _contains_any(text: str, phrases: Iterable[str]) -> bool:
    return any(phrase in text for phrase in phrases)


def _word_present(text: str, word: str) -> bool:
    return bool(re.search(rf"\b{re.escape(word)}\b", text))


def _operation_kind(intent: str) -> str:
    if intent in READ_OPERATION_INTENTS:
        return "read"
    if intent in WRITE_OPERATION_INTENTS:
        return "write"
    return "none"


def _result(intent: str, confidence: float, *, source: str, slots=None, reason="") -> SayaIntentResult:
    intent = _safe_str(intent).lower()
    operational = intent in EXECUTABLE_ACTION_INTENTS
    return SayaIntentResult(
        intent=intent if intent in ALLOWED_INTENTS else "none",
        confidence=_clamp_confidence(confidence),
        is_action=operational,
        source=source,
        slots=dict(slots or {}),
        reason=_safe_str(reason)[:300],
        operation_kind=_operation_kind(intent),
    )


def _looks_informational(text: str) -> bool:
    if not text:
        return False
    explicit = (
        "how to ", "how do i ", "how can i ", "how should i ",
        "what is the process", "what's the process", "what are the steps",
        "steps to ", "process to ", "procedure to ", "where can i ",
        "where do i ", "where should i ", "tell me how",
        "can you tell me how", "could you tell me how", "explain how",
        "explain the process", "can you explain",
    )
    return text.startswith(explicit)


def _detect_cancel(text: str) -> Optional[SayaIntentResult]:
    exact = {
        "cancel", "cancel this", "stop this", "stop the action", "clear action",
        "forget this", "restart action", "never mind", "nevermind", "exit",
    }
    if text in exact:
        return _result("cancel", 0.99, source="deterministic", reason="Explicit cancellation command detected.")
    return None


def _extract_leave_slots(text: str) -> Dict[str, Any]:
    slots: Dict[str, Any] = {}
    padded = f" {text} "
    leave_types = (
        ("casual_leave", ("casual leave", " cl ", "cl leave", "put cl", "mark cl")),
        ("earned_leave", ("earned leave", " el ", "el leave", "put el", "mark el")),
        ("half_day", ("half day", "half-day", "half leave")),
        ("sick_leave", ("sick leave", "medical leave")),
        ("work_from_home", ("work from home", "wfh")),
    )
    for value, phrases in leave_types:
        if any(phrase in padded for phrase in phrases):
            slots["leave_type"] = value
            break
    date_match = re.search(
        r"\b(today|tomorrow|day after tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
        r"(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
        r"\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{1,2}-\d{1,2}|"
        r"\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
        r"aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{2,4})?)\b",
        text, flags=re.IGNORECASE,
    )
    if date_match:
        slots["date_text"] = date_match.group(0)
    return slots


def _detect_natural_leave(text: str) -> Optional[SayaIntentResult]:
    # Preserve the richer File 8 natural-language leave interpretation beyond
    # the explicit phrase catalog.
    absence_signal = _contains_any(text, (
        "won't be coming", "will not be coming", "cannot come", "can't come",
        "not coming to office", "will be absent", "i am sick", "i'm sick",
        "feeling sick", "not well",
    ))
    action_signal = _contains_any(text, ("put", "mark", "apply", "request", "book", "take"))
    leave_signal = _word_present(text, "leave") or "cl" in text.split() or "el" in text.split()
    if (absence_signal and action_signal) or (action_signal and leave_signal):
        return _result(
            "apply_leave", 0.90, source="deterministic",
            slots=_extract_leave_slots(text), reason="Natural-language leave request detected.",
        )
    return None


def _extract_reminder_slots(text: str) -> Dict[str, Any]:
    slots: Dict[str, Any] = {}
    body = re.sub(
        r"^(?:please\s+)?(?:remind me|set (?:a )?reminder|create (?:a )?reminder|add (?:a )?reminder)\s*",
        "", text, flags=re.IGNORECASE,
    ).strip(" ,.-")
    if body:
        slots["raw_reminder_request"] = body
    schedule = re.search(
        r"\b(today|tomorrow|day after tomorrow|next\s+\w+|\d{4}-\d{1,2}-\d{1,2}|"
        r"\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}\s+[a-z]+(?:\s+\d{2,4})?)"
        r"(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b",
        text, flags=re.IGNORECASE,
    )
    if schedule:
        slots["schedule_text"] = schedule.group(0)
    return slots


def _phrase_matches(text: str, phrase: str) -> bool:
    # Most HRMS phrases are intentionally substring-friendly. Very short
    # phrases are matched on word boundaries to avoid accidental collisions.
    if len(phrase) <= 3 and phrase.isalnum():
        return bool(re.search(rf"\b{re.escape(phrase)}\b", text))
    return phrase in text


def _deterministic_catalog_route(text: str) -> Optional[SayaIntentResult]:
    for phrase, intent in DETERMINISTIC_PHRASE_RULES:
        if not _phrase_matches(text, phrase):
            continue
        slots = {}
        if intent == "apply_leave":
            slots = _extract_leave_slots(text)
        elif intent == "create_reminder":
            slots = _extract_reminder_slots(text)
        return _result(
            intent, 0.97, source="deterministic:catalog", slots=slots,
            reason=f"Matched supported Saya intent phrase: {phrase}",
        )
    return None


def _deterministic_route(question: Any) -> SayaIntentResult:
    text = _normalise_text(question)
    if not text:
        return _result("none", 0.0, source="deterministic", reason="Empty request.")

    cancelled = _detect_cancel(text)
    if cancelled:
        return cancelled

    # Explicit HOW/PROCESS questions must never accidentally start a write
    # workflow just because they contain words such as apply/approve/create.
    if _looks_informational(text):
        return _result(
            "informational", 0.98, source="deterministic",
            reason="Workflow/information question detected; no operational action should start.",
        )

    matched = _deterministic_catalog_route(text)
    if matched:
        return matched

    natural_leave = _detect_natural_leave(text)
    if natural_leave:
        return natural_leave

    return _result(
        "none", 0.45, source="deterministic",
        reason="No high-confidence deterministic operational intent detected.",
    )


def _extract_json_object(text: Any) -> Dict[str, Any]:
    raw = _safe_str(text)
    if not raw:
        return {}
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw).strip()
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass
    start, end = raw.find("{"), raw.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(raw[start:end + 1])
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _clean_slots(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    cleaned: Dict[str, Any] = {}
    for key, item in value.items():
        key_text = _safe_str(key)[:60]
        if not key_text or item is None:
            continue
        if isinstance(item, (str, int, float, bool)):
            cleaned[key_text] = item.strip()[:500] if isinstance(item, str) else item
    return cleaned


# Broad enough for every operational domain, while ordinary conversational
# messages still avoid an extra classifier call.
LLM_ACTION_CUES = (
    "leave", "attendance", "check in", "check out", "wfh", "field", "holiday work",
    "project", "remind", "reminder", "meeting", "ticket", "grievance", "complaint",
    "approval", "approve", "reject", "verify", "team", "workforce", "probation",
    "recruitment", "candidate", "application", "interview", "hiring", "vacancy",
    "job opening", "offer", "joining", "background check", "onboarding",
    "payroll", "salary", "payslip", "bank", "reimbursement", "loan", "advance",
    "tax", "tds", "pf", "esi", "statutory", "disburse", "finance",
    "subscription", "tenant", "company", "trial", "demo", "billing", "pricing",
    "premium", "maintenance", "user account", "module access", "saas",
)


def _should_try_llm(question: Any) -> bool:
    text = _normalise_text(question)
    return bool(text and _contains_any(text, LLM_ACTION_CUES))


def _intent_prompt_catalog() -> str:
    lines = []
    for intent in sorted(INTENT_CATALOG):
        definition = INTENT_CATALOG[intent]
        examples = "; ".join(definition.get("phrases", ())[:3])
        lines.append(
            f"- {intent} [{definition.get('kind', 'write')}]: {definition.get('label', intent)}"
            + (f" | examples: {examples}" if examples else "")
        )
    return "\n".join(lines)


def _llm_route(question: Any) -> Optional[SayaIntentResult]:
    if not _env_bool("SAYA_INTENT_LLM_ENABLED", True):
        return None
    text = _safe_str(question)[:2500]
    if not text:
        return None

    catalog = _intent_prompt_catalog()
    system_prompt = f"""
You are Saya's STRICT HRMS intent classifier. Classify language only.
You NEVER authorize, execute, approve, modify data, or claim an action happened.

Choose exactly one intent from the catalog below, or informational, or none.

{catalog}

Special intents:
- informational: the user wants explanation/guidance rather than an operational read/write handler.
- cancel: the user explicitly cancels an active action.
- none: there is not enough evidence for any supported intent.

Critical rules:
1. HOW/WHAT IS THE PROCESS/WHERE/EXPLAIN questions about performing an action are informational.
2. Direct read requests such as 'show pending payroll exceptions' may select a READ intent.
3. Direct write commands such as 'approve the reimbursement' may select a WRITE intent.
4. Generic 'approve leave' means decide_team_leave. Use hr_decide_leave only when HR/final-stage wording is explicit.
5. Never invent an intent outside this catalog.
6. Never use the user's asserted role as authorization; role checks happen elsewhere.
7. Extract slots only when explicitly stated. Do not guess IDs, employee names, dates, amounts, stages, decisions, or companies.
8. If two intents are equally plausible, return none rather than guessing.
9. A classifier result can never mean an action succeeded.

Return JSON only:
{{"intent":"none","confidence":0.0,"slots":{{}},"reason":"short reason"}}
""".strip()

    try:
        result = generate_ai_chat_response(
            system_prompt=system_prompt, user_prompt=text, temperature=0.0,
            max_tokens=280, timeout=int(os.getenv("SAYA_INTENT_TIMEOUT_SECONDS", "12")),
        )
    except Exception:
        return None

    payload = _extract_json_object(result.get("text") or result.get("answer"))
    intent = _safe_str(payload.get("intent")).lower()
    confidence = _clamp_confidence(payload.get("confidence"))
    if intent not in ALLOWED_INTENTS:
        return None
    return _result(
        intent, confidence,
        source=f"llm:{_safe_str(result.get('provider')) or 'provider'}",
        slots=_clean_slots(payload.get("slots")),
        reason=_safe_str(payload.get("reason"))[:240],
    )


def _passes_threshold(result: SayaIntentResult) -> bool:
    if result.intent in EXECUTABLE_ACTION_INTENTS:
        return result.confidence >= _env_float("SAYA_INTENT_ACTION_THRESHOLD", DEFAULT_ACTION_THRESHOLD)
    if result.intent in {"informational", "cancel"}:
        return result.confidence >= _env_float("SAYA_INTENT_INFO_THRESHOLD", DEFAULT_INFO_THRESHOLD)
    return result.intent == "none"


def route_saya_intent(question: Any, *, use_llm_fallback: bool = True) -> Dict[str, Any]:
    """Return a side-effect-free, allow-listed structured Saya intent."""
    deterministic = _deterministic_route(question)
    if deterministic.intent != "none" and _passes_threshold(deterministic):
        return deterministic.to_dict()

    if use_llm_fallback and _should_try_llm(question):
        llm_result = _llm_route(question)
        if llm_result and _passes_threshold(llm_result):
            return llm_result.to_dict()

    return _result(
        "none", max(0.0, deterministic.confidence), source="deterministic",
        reason="The request was not classified as a safe high-confidence supported intent.",
    ).to_dict()


def intent_name(question: Any, *, use_llm_fallback: bool = True) -> str:
    result = route_saya_intent(question, use_llm_fallback=use_llm_fallback)
    intent = _safe_str(result.get("intent"))
    return "" if intent in {"none", "informational"} else intent


def supported_intents() -> Dict[str, Dict[str, Any]]:
    """Safe introspection for tests/analytics/UI; returns no permissions or secrets."""
    return {
        key: {
            "label": value.get("label"),
            "kind": value.get("kind"),
            "example_count": len(value.get("phrases", ())),
        }
        for key, value in INTENT_CATALOG.items()
    }


__all__ = [
    "ROUTER_SCHEMA_VERSION", "INTENT_CATALOG", "READ_OPERATION_INTENTS",
    "WRITE_OPERATION_INTENTS", "EXECUTABLE_ACTION_INTENTS", "ALLOWED_INTENTS",
    "route_saya_intent", "intent_name", "supported_intents",
]
