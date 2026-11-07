"""Single definition of active HRMS employees for current-workflow queries.

Do not apply this filter to historical attendance, payroll, completed projects,
or leave audit records: those must remain available to authorised staff.
"""
import re

ALUMNI_STATUS_REGEX = re.compile(
    r"^(inactive|resign|resigned|left|terminated|retired|alumni|ex-employee|ex_employee)$",
    re.IGNORECASE,
)


def active_employee_fields():
    """MongoDB predicates: missing legacy status fields remain eligible."""
    return {
        "is_deleted": {"$ne": True},
        "is_alumni": {"$ne": True},
        "is_active": {"$ne": False},
        "active": {"$ne": False},
        "status": {"$not": ALUMNI_STATUS_REGEX},
        "employment_status": {"$not": ALUMNI_STATUS_REGEX},
        "employee_status": {"$not": ALUMNI_STATUS_REGEX},
        "$or": [
            {"last_working_date": {"$in": [None, ""]}},
            {
                "notice_status": {"$in": ["scheduled", "serving"]},
                "notice_start_date": {"$exists": True, "$nin": [None, ""]},
                "last_working_day": {
                    "$gte": __import__(
                        "app.services.notice_period_service",
                        fromlist=["local_today"],
                    ).local_today().isoformat()
                },
            },
        ],
    }


def employee_is_active(employee):
    """Mirror the predicates for in-memory active-only presentations."""
    if not isinstance(employee, dict):
        return False
    if employee.get('is_deleted') is True or employee.get('is_alumni') is True:
        return False
    if employee.get('is_active') is False or employee.get('active') is False:
        return False
    if str(employee.get('last_working_date') or '').strip():
        return False
    return not any(
        ALUMNI_STATUS_REGEX.fullmatch(str(employee.get(field) or '').strip())
        for field in ('status', 'employment_status', 'employee_status')
    )
