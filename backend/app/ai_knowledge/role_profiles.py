"""
Role, designation, and subscription response profiles for the YourComate AI Assistant.

This module does not grant backend permissions. It only builds safe guidance
context for the language model. Actual authorization must continue to be
enforced by route decorators, tenant guards, and ai_capability_service.py.

Important rules:
- Team Leader and Reporting Officer are employee capabilities, not independent
  protected login identities.
- A designation such as Managing Director, Director, CEO, or Manager changes
  the assistant's response emphasis, but never grants additional data access.
- SaaS prices must be loaded from the pricing_plans collection at runtime.
  Never hard-code a price in this module.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Sequence


PROTECTED_LOGIN_ROLES = {
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "finance",
    "accounts_finance",
}

EMPLOYEE_CAPABILITY_ROLES = {
    "employee",
    "team_leader",
    "reporting_officer",
    "manager",
    "ro",
}

ROLE_ALIASES = {
    "superadmin": "super_admin",
    "super admin": "super_admin",
    "platform_superadmin": "super_admin",
    "platform superadmin": "super_admin",
    "platform_admin": "super_admin",
    "platform admin": "super_admin",
    "administrator": "admin",
    "tenant_admin": "admin",
    "tenant admin": "admin",
    "hradmin": "hr_admin",
    "hr admin": "hr_admin",
    "human_resources_admin": "hr_admin",
    "human resources admin": "hr_admin",
    "hrmanager": "hr_manager",
    "hr manager": "hr_manager",
    "human_resources_manager": "hr_manager",
    "human resources manager": "hr_manager",
    "human_resources": "hr",
    "human resources": "hr",
    "accounts": "accounts_finance",
    "accounts finance": "accounts_finance",
    "accounts_finance": "accounts_finance",
    "finance_accounts": "accounts_finance",
    "finance accounts": "accounts_finance",
    "teamleader": "team_leader",
    "team leader": "team_leader",
    "tl": "team_leader",
    "reporting officer": "reporting_officer",
    "reporting_officer": "reporting_officer",
    "ro": "reporting_officer",
    "staff": "employee",
    "user": "employee",
}

ROLE_PRIORITY = (
    "super_admin",
    "admin",
    "hr_admin",
    "hr_manager",
    "hr",
    "accounts_finance",
    "finance",
    "reporting_officer",
    "team_leader",
    "employee",
)

ROLE_PROFILES: Dict[str, Dict[str, Any]] = {
    "super_admin": {
        "label": "Platform Super Admin",
        "response_style": (
            "Give platform-level, cross-tenant operational guidance. Clearly "
            "separate platform actions from tenant actions."
        ),
        "knowledge_focus": [
            "companies and tenants",
            "trial requests and OTP verification",
            "pricing plans",
            "Premium quotation workflow",
            "subscriptions and payments",
            "tenant activation, suspension, and expiry",
            "employee limits and module access",
            "platform notifications",
            "audit logs and system settings",
            "tenant-scoped HRMS modules when a tenant is explicitly selected",
        ],
        "scope_rules": [
            "Do not assume a target tenant when the request is tenant-specific.",
            "Do not expose secrets, payment credentials, private keys, or raw tokens.",
            "For pricing, use current database values supplied in live context.",
            "For Premium, preserve quotation-first workflow before payment.",
        ],
    },
    "admin": {
        "label": "Tenant Admin",
        "response_style": (
            "Give tenant-wide administration steps using the modules available "
            "inside the logged-in company."
        ),
        "knowledge_focus": [
            "employee management",
            "organisation, department, designation, and state masters",
            "attendance and leave administration",
            "projects, assets, policies, reports, and notifications",
            "tenant branding and settings",
            "billing and subscription status",
            "payroll configuration where enabled",
        ],
        "scope_rules": [
            "Remain inside the current tenant.",
            "Do not describe HR Review as an Admin-only payroll action.",
            "Do not describe Finance Approval, Lock, or Disbursement as an Admin-only action.",
            "Mention module or subscription restrictions when relevant.",
        ],
    },
    "hr_admin": {
        "label": "HR Admin",
        "response_style": (
            "Give complete HR operational guidance, including setup, review, "
            "approval, reports, and employee lifecycle steps."
        ),
        "knowledge_focus": [
            "employee onboarding and lifecycle",
            "leave balances and approval fallback",
            "attendance review and correction workflows",
            "holiday calendar and comp-off",
            "assets, policies, grievance, and reports",
            "salary structures and payroll HR Review",
            "reimbursements and tax declaration HR review",
            "performance and employee records",
        ],
        "scope_rules": [
            "Remain inside the current tenant.",
            "Do not expose another tenant's employee records.",
            "Finance Approval, Lock, and Disbursement require Finance capability.",
            "Use live records for employee-specific answers; never guess.",
        ],
    },
    "hr_manager": {
        "label": "HR Manager",
        "response_style": (
            "Give complete HR management guidance with emphasis on review, "
            "compliance, employee lifecycle, and workforce reporting."
        ),
        "knowledge_focus": [
            "employee lifecycle and policy administration",
            "attendance, leave, holiday, and comp-off workflows",
            "HR reports and performance review",
            "payroll preparation and HR Review",
            "reimbursement HR review",
            "tax declaration review",
            "grievance and employee support",
        ],
        "scope_rules": [
            "Remain inside the current tenant.",
            "Finance Approval, Lock, and Disbursement require Finance capability.",
            "Use live HRMS data for personal or employee-specific answers.",
        ],
    },
    "hr": {
        "label": "HR",
        "response_style": (
            "Give practical step-by-step HR guidance using the exact employee, "
            "attendance, leave, payroll, policy, and report workflows."
        ),
        "knowledge_focus": [
            "employee records",
            "attendance and leave operations",
            "leave balances",
            "holiday calendar and comp-off",
            "payroll preparation and HR Review",
            "assets, policies, grievance, and reports",
            "performance and employee support",
        ],
        "scope_rules": [
            "Remain inside the current tenant.",
            "Do not claim Finance Approval, Lock, or Disbursement rights without a Finance role.",
            "Do not invent leave balances, attendance counts, or payroll values.",
        ],
    },
    "accounts_finance": {
        "label": "Accounts and Finance",
        "response_style": (
            "Give detailed payroll, banking, statutory, approval, lock, "
            "disbursement, loan, reimbursement, tax, and reporting steps."
        ),
        "knowledge_focus": [
            "salary structures and payroll calculation",
            "Finance Approval",
            "payroll lock and salary disbursement",
            "employee bank verification",
            "salary bank files",
            "PF, PT, TDS, and statutory reports",
            "loans and advances",
            "reimbursements",
            "tax declarations and TDS instructions",
            "payslips and payroll reports",
        ],
        "scope_rules": [
            "Remain inside the current tenant.",
            "HR Review requires an HR role; Finance must not be told to bypass it.",
            "Only describe status transitions allowed from the current payroll state.",
            "Do not disclose another employee's salary unless live context and role scope permit it.",
        ],
    },
    "finance": {
        "label": "Finance",
        "response_style": (
            "Give detailed payroll and finance workflow guidance, especially "
            "approval, verification, locking, disbursement, and compliance."
        ),
        "knowledge_focus": [
            "payroll calculation and Finance Approval",
            "payroll lock and salary disbursement",
            "bank verification and bank files",
            "PF, PT, TDS, and statutory reporting",
            "loans and advances",
            "reimbursements",
            "tax declarations",
            "payslips and payroll reports",
        ],
        "scope_rules": [
            "Remain inside the current tenant.",
            "HR Review requires an HR role.",
            "Do not bypass Draft to HR Reviewed to Finance Approved workflow.",
            "Do not guess salary, deduction, bank, or tax values.",
        ],
    },
    "reporting_officer": {
        "label": "Reporting Officer",
        "response_style": (
            "Give team-scoped guidance for approvals, projects, progress, "
            "performance, and employee self-service."
        ),
        "knowledge_focus": [
            "final team approval where mapped",
            "project oversight and progress",
            "team attendance and leave visibility where permitted",
            "performance review",
            "management group participation",
            "personal attendance, leave, assets, payroll, and profile",
        ],
        "scope_rules": [
            "Limit team answers to mapped employees and accessible projects.",
            "A reporting capability does not grant access to subordinate salary or bank details.",
            "Use live team context; do not infer an employee relationship.",
        ],
    },
    "team_leader": {
        "label": "Team Leader",
        "response_style": (
            "Give first-level team approval, project coordination, progress, "
            "and employee self-service guidance."
        ),
        "knowledge_focus": [
            "first-level leave and attendance-mode approval",
            "project assignment and progress",
            "team visibility where permitted",
            "performance input",
            "personal attendance, leave, assets, payroll, and profile",
        ],
        "scope_rules": [
            "Limit team answers to mapped employees and accessible projects.",
            "Do not present Team Leader as a separate protected login identity.",
            "Do not expose subordinate salary, bank, tax, loan, or payslip data.",
        ],
    },
    "employee": {
        "label": "Employee",
        "response_style": (
            "Give clear self-service instructions and answer only from the "
            "employee's own accessible HRMS records."
        ),
        "knowledge_focus": [
            "attendance check-in and check-out",
            "WFH and field requests",
            "leave application and status",
            "comp-off",
            "assigned projects and progress",
            "grievance and IT support",
            "assets and policies",
            "own bank details, tax declaration, loans, reimbursements, and payslips",
            "profile and password change",
        ],
        "scope_rules": [
            "Answer only about the logged-in employee's own private records.",
            "Do not expose other employees' salary, attendance, leave, or personal information.",
            "Do not claim that an action was completed unless an action API confirms it.",
        ],
    },
}

DESIGNATION_LENSES: Sequence[Dict[str, Any]] = (
    {
        "key": "executive_leadership",
        "label": "Executive Leadership",
        "patterns": (
            r"\bmanaging\s+director\b",
            r"\bmanaging\s+director\s*\(md\)\b",
            r"\bdirector\b",
            r"\bchief\s+executive\s+officer\b",
            r"\bceo\b",
        ),
        "response_emphasis": [
            "executive dashboards and reports",
            "organisation-wide performance",
            "project and operational oversight",
            "approvals within the user's actual mapped scope",
            "subscription, capacity, and governance information when authorized",
        ],
        "warning": (
            "Designation is an advisory response lens only. It must not grant "
            "cross-tenant access or permissions not present in the user's roles."
        ),
    },
    {
        "key": "manager",
        "label": "Manager",
        "patterns": (
            r"\bmanager\b",
            r"\bdepartment\s+head\b",
            r"\bhead\s+of\s+department\b",
            r"\bhod\b",
        ),
        "response_emphasis": [
            "team approvals",
            "department projects",
            "progress and performance",
            "attendance and leave visibility within mapped scope",
        ],
        "warning": (
            "A Manager designation does not automatically grant Reporting Officer "
            "permissions unless the employee is actually mapped or marked accordingly."
        ),
    },
    {
        "key": "human_resources",
        "label": "Human Resources",
        "patterns": (
            r"\bhuman\s+resources\b",
            r"\bhr\b",
            r"\bpeople\s+operations\b",
        ),
        "response_emphasis": [
            "employee lifecycle",
            "attendance and leave",
            "policies and grievance",
            "payroll HR review",
        ],
        "warning": "Actual HR permissions must come from the authenticated role.",
    },
    {
        "key": "finance",
        "label": "Finance and Accounts",
        "patterns": (
            r"\bfinance\b",
            r"\baccounts?\b",
            r"\baccountant\b",
            r"\bpayroll\b",
        ),
        "response_emphasis": [
            "payroll finance workflow",
            "bank verification",
            "statutory deductions",
            "disbursement and reports",
        ],
        "warning": "Actual Finance permissions must come from the authenticated role.",
    },
    {
        "key": "information_technology",
        "label": "Information Technology",
        "patterns": (
            r"\binformation\s+technology\b",
            r"\bit\s+head\b",
            r"\bit\s+support\b",
            r"\bsystem\s+administrator\b",
        ),
        "response_emphasis": [
            "IT support tickets",
            "assignment and escalation",
            "system usage guidance",
        ],
        "warning": "IT designation alone must not reveal platform secrets or credentials.",
    },
)

SUBSCRIPTION_PROFILES: Dict[str, Dict[str, Any]] = {
    "platform_superadmin": {
        "label": "Platform Administration",
        "response_behavior": [
            "Explain current plans using live pricing-plan data.",
            "Explain trial, direct-payment, Premium quotation, payment, activation, and renewal workflows.",
            "Separate platform actions from tenant actions.",
        ],
    },
    "lifetime": {
        "label": "Lifetime Full Access",
        "response_behavior": [
            "Do not show trial-expiry or payment-pressure messaging.",
            "Answer according to enabled modules and authenticated role.",
            "Mention lifetime access only when relevant.",
        ],
    },
    "demo": {
        "label": "Trial / Demo",
        "response_behavior": [
            "Answer product and workflow questions positively and factually.",
            "Use current live pricing data when the user asks about a plan price.",
            "Explain Essential and Growth direct-payment steps.",
            "Explain Premium as Contact Sales, request, quotation, client review, payment, and activation.",
            "Mention remaining trial days only when live context provides them.",
            "Do not invent discounts, guarantees, testimonials, or unavailable features.",
        ],
    },
    "essential": {
        "label": "Essential Subscription",
        "response_behavior": [
            "Answer according to the user's role and enabled tenant modules.",
            "Use live employee limit, renewal amount, and dates when supplied.",
            "Explain upgrade to Growth or Premium only when asked or operationally relevant.",
        ],
    },
    "growth": {
        "label": "Growth Subscription",
        "response_behavior": [
            "Answer according to the user's role and enabled tenant modules.",
            "Use live employee limit, renewal amount, and dates when supplied.",
            "Explain Premium quotation workflow when the user asks for unlimited or custom requirements.",
        ],
    },
    "premium": {
        "label": "Premium Subscription",
        "response_behavior": [
            "Answer according to the custom quotation and enabled modules.",
            "Use the tenant's quoted renewal amount and billing interval when supplied.",
            "Do not replace the approved custom quote with the public default plan price.",
        ],
    },
    "paid_other": {
        "label": "Paid Subscription",
        "response_behavior": [
            "Answer according to the active tenant plan and enabled modules.",
            "Use live subscription details instead of assumptions.",
        ],
    },
    "expired": {
        "label": "Expired / Payment Required",
        "response_behavior": [
            "Explain renewal or upgrade steps clearly.",
            "Use the current plan, renewal amount, due date, and Premium request state when supplied.",
            "Do not claim access is active when tenant context says it is expired or suspended.",
        ],
    },
    "unknown": {
        "label": "Unknown Subscription",
        "response_behavior": [
            "Avoid guessing the plan.",
            "Use only the live subscription details that are available.",
        ],
    },
}

PRODUCT_TRUTH_RULES = (
    "Describe YourComate HRMS positively but factually.",
    "Never invent customer counts, awards, certifications, testimonials, uptime, discounts, or guarantees.",
    "Never hard-code Essential or Growth pricing in AI knowledge; use live pricing-plan context.",
    "Premium is quotation-first and must not open direct payment before an approved quotation.",
    "Essential and Growth use direct online payment when their active plan configuration allows it.",
    "Renewal guidance must use the latest active plan price for Essential/Growth and the approved custom quote for Premium.",
)


PROGRESSIVE_DISCLOSURE_RULES = (
    "Answer only the information the user asked for and only the next information needed to continue an active workflow.",
    "Do not enumerate leave types, expand leave abbreviations, show leave balances, list projects, or list team members unless the user explicitly asks for that information or the information is required to resolve a blocking validation.",
    "During leave application, silently use authorised live records to validate leave balance and handover scope; do not narrate those records when validation succeeds.",
    "If the selected leave balance is exhausted or insufficient for the requested dates, mention only the relevant blocking balance information and ask for the next corrective choice.",
    "When a project is required for handover, ask which project; do not automatically list accessible projects. When a handover person is required, ask whom; do not automatically list mapped employees.",
    "If the user explicitly asks to see projects, team members, leave types, or balances, return only the requested category and keep the answer concise.",
    "Do not repeat a field the user has already supplied. Extract multiple supplied workflow fields from the same message and move directly to the next missing field.",
)


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value

    return _safe_text(value).lower() in {"1", "true", "yes", "y", "on"}


def _normalise_key(value: Any) -> str:
    text = _safe_text(value).lower().replace("-", "_")
    text = re.sub(r"\s+", " ", text).strip()

    alias = ROLE_ALIASES.get(text)
    if alias:
        return alias

    underscored = text.replace(" ", "_")
    return ROLE_ALIASES.get(underscored, underscored)


def _iter_roles(value: Any) -> Iterable[str]:
    if value is None:
        return []

    if isinstance(value, str):
        return [part for part in value.split(",")]

    if isinstance(value, (list, tuple, set)):
        return value

    return [value]


def _unique(values: Iterable[str]) -> List[str]:
    result: List[str] = []

    for value in values:
        value = _safe_text(value)
        if value and value not in result:
            result.append(value)

    return result


def normalise_roles(value: Any) -> List[str]:
    """Return normalized role names without changing authorization."""

    return _unique(
        _normalise_key(role)
        for role in _iter_roles(value)
        if _safe_text(role)
    )


def derive_effective_ai_roles(user_context: Mapping[str, Any] | None = None) -> List[str]:
    """
    Derive the roles Eve should use for response framing.

    This mirrors the current project rule that Team Leader and Reporting Officer
    are employee capabilities. It does not grant API permissions.
    """

    context = dict(user_context or {})
    employee = context.get("employee") or {}

    if not isinstance(employee, Mapping):
        employee = {}

    roles = normalise_roles(context.get("roles") or context.get("role"))

    if not roles:
        roles = ["employee"]

    has_protected_login_role = bool(set(roles).intersection(PROTECTED_LOGIN_ROLES))

    if not has_protected_login_role:
        roles = [
            role
            for role in roles
            if role not in {"manager", "ro", "team_leader", "reporting_officer"}
        ]

        if "employee" not in roles:
            roles.append("employee")

    if _truthy(employee.get("is_team_leader")):
        roles.append("team_leader")

    if _truthy(employee.get("is_reporting_officer")):
        roles.append("reporting_officer")

    roles = _unique(roles)

    if not roles:
        roles = ["employee"]

    return sorted(
        roles,
        key=lambda role: (
            ROLE_PRIORITY.index(role)
            if role in ROLE_PRIORITY
            else len(ROLE_PRIORITY)
        ),
    )


def resolve_primary_role(roles: Any) -> str:
    normalised = normalise_roles(roles)

    for role in ROLE_PRIORITY:
        if role in normalised:
            return role

    return normalised[0] if normalised else "employee"


def get_role_profile(role: Any) -> Dict[str, Any]:
    normalised = _normalise_key(role)
    return dict(ROLE_PROFILES.get(normalised) or ROLE_PROFILES["employee"])


def resolve_designation_lens(designation: Any) -> Dict[str, Any]:
    text = _safe_text(designation).lower()

    if not text:
        return {}

    for lens in DESIGNATION_LENSES:
        if any(re.search(pattern, text, re.IGNORECASE) for pattern in lens["patterns"]):
            return {
                "key": lens["key"],
                "label": lens["label"],
                "response_emphasis": list(lens["response_emphasis"]),
                "warning": lens["warning"],
            }

    return {
        "key": "general_designation",
        "label": _safe_text(designation),
        "response_emphasis": [],
        "warning": (
            "Designation is descriptive context only and must not grant permissions."
        ),
    }


def resolve_subscription_profile(
    subscription: Mapping[str, Any] | None = None,
    *,
    is_platform_superadmin: bool = False,
) -> str:
    data = dict(subscription or {})

    if is_platform_superadmin:
        return "platform_superadmin"

    if data.get("is_lifetime") or _safe_text(data.get("subscription_status")).lower() == "lifetime":
        return "lifetime"

    if data.get("is_expired") or data.get("is_suspended") or data.get("requires_payment"):
        return "expired"

    if data.get("is_demo_company"):
        return "demo"

    plan_code = _safe_text(
        data.get("selected_plan_code")
        or data.get("plan_code")
        or data.get("plan")
    ).lower().replace("-", "_").replace(" ", "_")

    if plan_code in {"essential", "growth", "premium"}:
        return plan_code

    if data.get("is_paid_company"):
        return "paid_other"

    plan_type = _safe_text(data.get("plan_type")).lower()
    trial_status = _safe_text(data.get("trial_status")).lower()

    if plan_type == "demo" or trial_status in {"active", "trial", "running"}:
        return "demo"

    return "unknown"


def get_subscription_profile(profile_key: Any) -> Dict[str, Any]:
    key = _safe_text(profile_key).lower()
    return dict(SUBSCRIPTION_PROFILES.get(key) or SUBSCRIPTION_PROFILES["unknown"])


def _format_lines(values: Sequence[str]) -> str:
    return "\n".join(f"- {value}" for value in values if _safe_text(value))


def build_role_subscription_guidance(
    user_context: Mapping[str, Any] | None = None,
) -> str:
    """
    Build compact role/subscription prompt context for Saya.

    The returned guidance is injected into ai_assistant_service.py and must
    preserve both authorization scope and progressive disclosure.
    """

    context = dict(user_context or {})
    employee = context.get("employee") or {}

    if not isinstance(employee, Mapping):
        employee = {}

    roles = derive_effective_ai_roles(context)
    primary_role = resolve_primary_role(roles)
    role_profile = get_role_profile(primary_role)

    designation = (
        context.get("designation")
        or context.get("designation_name")
        or employee.get("designation")
        or employee.get("designation_name")
        or employee.get("title")
        or employee.get("position")
        or ""
    )

    designation_lens = resolve_designation_lens(designation)

    subscription = context.get("subscription") or {}
    if not isinstance(subscription, Mapping):
        subscription = {}

    subscription_key = resolve_subscription_profile(
        subscription,
        is_platform_superadmin=bool(context.get("is_platform_superadmin")),
    )
    subscription_profile = get_subscription_profile(subscription_key)

    role_focus = _format_lines(role_profile.get("knowledge_focus") or [])
    role_rules = _format_lines(role_profile.get("scope_rules") or [])
    plan_behavior = _format_lines(subscription_profile.get("response_behavior") or [])
    product_rules = _format_lines(PRODUCT_TRUTH_RULES)
    disclosure_rules = _format_lines(PROGRESSIVE_DISCLOSURE_RULES)

    designation_block = ""

    if designation_lens:
        designation_emphasis = _format_lines(
            designation_lens.get("response_emphasis") or []
        )

        designation_block = f"""
Designation lens:
- Designation: {_safe_text(designation) or "Not available"}
- Lens: {designation_lens.get("label") or "General"}
- Response emphasis:
{designation_emphasis or "- Use authenticated role and live module scope."}
- Safety: {designation_lens.get("warning")}
""".strip()

    return f"""
Authenticated AI role profile:
- Primary role: {primary_role}
- Effective roles: {", ".join(roles)}
- Role label: {role_profile.get("label")}
- Response style: {role_profile.get("response_style")}

Role knowledge focus:
{role_focus}

Role scope rules:
{role_rules}

Subscription audience:
- Profile key: {subscription_key}
- Label: {subscription_profile.get("label")}

Subscription response behavior:
{plan_behavior}

Product truth rules:
{product_rules}

Progressive disclosure rules:
{disclosure_rules}

{designation_block}
""".strip()


__all__ = [
    "DESIGNATION_LENSES",
    "EMPLOYEE_CAPABILITY_ROLES",
    "PRODUCT_TRUTH_RULES",
    "PROGRESSIVE_DISCLOSURE_RULES",
    "PROTECTED_LOGIN_ROLES",
    "ROLE_ALIASES",
    "ROLE_PRIORITY",
    "ROLE_PROFILES",
    "SUBSCRIPTION_PROFILES",
    "build_role_subscription_guidance",
    "derive_effective_ai_roles",
    "get_role_profile",
    "get_subscription_profile",
    "normalise_roles",
    "resolve_designation_lens",
    "resolve_primary_role",
    "resolve_subscription_profile",
]