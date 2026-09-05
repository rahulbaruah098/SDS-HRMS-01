"""
Saya HR + Recruitment action plugin.

This module is auto-discovered by app.services.ai_action_service.
It keeps HR/recruitment language handling separate from authority: every read
and write is tenant-scoped, role-checked, and revalidated immediately before
execution. Canonical RecruitmentService methods remain the source of truth for
recruitment business rules, notifications, history, and transitions.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta
import re

from bson import ObjectId
from flask import current_app

from app.extensions import get_db
from app.utils.auth import audit
from app.services.ai_action_service import (
    register_saya_action,
    save_pending_action,
    clear_pending_action,
)
from app.services.recruitment_service import (
    RecruitmentService,
    RecruitmentServiceError,
    HR_ROLES as RECRUITMENT_HR_ROLES,
    READER_ROLES as RECRUITMENT_READER_ROLES,
    FINAL_APPROVAL_ROLES,
    FINAL_APPROVAL_CAPABILITIES,
    APPLICATION_TRANSITIONS,
    HIRING_REQUEST_TRANSITIONS,
    DOCUMENT_STATUSES,
    BACKGROUND_CHECK_STATUSES,
    JOINING_STATUSES,
    ONBOARDING_TASKS,
    JOB_OPENING_TRANSITIONS,
    INTERVIEW_TRANSITIONS,
    OFFER_TRANSITIONS,
    RECOMMENDATIONS,
    FINANCE_ROLES,
    ADMIN_ROLES,
    HR_PUBLISH_ROLES,
)
from app.routes.workflow import (
    ADMIN_HR_ROLES,
    ADMIN_APPROVER_ROLES,
    HR_APPROVER_ROLES,
    LEAVE_TYPES_WITH_BALANCE,
    approval_stage_update_fields,
    create_leave_history_entry,
    deduct_leave_balance,
    has_sufficient_leave_balance,
    leave_stage_label,
    leave_type_label,
    mark_compoff_used_if_needed,
    normalize_leave_type,
    notify_employee_leave_decision,
    notify_hr_leave_result,
    rollback_compoff_claim_if_needed,
)


HR_ROLES = set(RECRUITMENT_HR_ROLES)
RECRUITMENT_READ_ROLES = set(RECRUITMENT_READER_ROLES)
FINAL_HIRING_ROLES = set(FINAL_APPROVAL_ROLES)
OFFER_APPROVAL_ROLES = set(FINANCE_ROLES) | set(ADMIN_ROLES) | {"hr_admin", "hr_manager"}

DISPLAY_LIMIT = 12
READ_LIMIT = 50


def _text(value):
    return str(value or "").strip()


def _norm(value):
    return re.sub(r"\s+", " ", _text(value).lower()).strip()


def _role_key(value):
    return re.sub(r"[^a-z0-9]+", "_", _text(value).lower()).strip("_")


def _roles(user_context=None):
    context = user_context or {}
    raw = context.get("roles") or []
    if isinstance(raw, str):
        raw = [item.strip() for item in raw.split(",") if item.strip()]
    output = {_role_key(item) for item in raw if _role_key(item)}
    role = _role_key(context.get("role"))
    if role:
        output.add(role)
    return output


def _capabilities(user_context=None):
    context = user_context or {}
    output = set()
    for key in (
        "capabilities", "permissions", "permission_keys",
        "access_capabilities", "module_permissions",
    ):
        raw = context.get(key)
        if isinstance(raw, dict):
            for item, enabled in raw.items():
                if enabled and _role_key(item):
                    output.add(_role_key(item))
        elif isinstance(raw, str):
            output.update(_role_key(item) for item in raw.split(",") if _role_key(item))
        elif isinstance(raw, (list, tuple, set)):
            for item in raw:
                if isinstance(item, dict):
                    key_value = _role_key(item.get("key") or item.get("name") or item.get("permission"))
                    if key_value and item.get("enabled", True):
                        output.add(key_value)
                elif _role_key(item):
                    output.add(_role_key(item))
    return output


def _tenant_id(user_context=None):
    return _text((user_context or {}).get("tenant_id"))


def _actor_id(user_context=None):
    return _text((user_context or {}).get("user_id") or (user_context or {}).get("_id"))


def _actor_name(user_context=None):
    context = user_context or {}
    return _text(
        context.get("display_name")
        or context.get("employee_name")
        or context.get("name")
        or context.get("email")
        or "Saya HR User"
    )


def _employee(user_context=None):
    item = (user_context or {}).get("employee") or {}
    return item if isinstance(item, dict) else {}


def _recruitment_actor(user_context=None):
    context = dict(user_context or {})
    employee = _employee(context)
    actor = {
        "_id": _actor_id(context),
        "id": _actor_id(context),
        "name": _actor_name(context),
        "full_name": _actor_name(context),
        "email": context.get("email") or employee.get("official_email") or employee.get("email"),
        "role": context.get("role"),
        "roles": list(_roles(context)),
        "employee_id": context.get("employee_id") or employee.get("_id") or employee.get("employee_id"),
        "employee_ref_id": context.get("employee_id") or employee.get("_id") or employee.get("employee_ref_id"),
        "department": context.get("department") or employee.get("department") or employee.get("department_name"),
        "department_name": context.get("department_name") or employee.get("department_name") or employee.get("department"),
        "department_id": employee.get("department_id") or employee.get("department_ref_id"),
        "capabilities": list(_capabilities(context)),
    }
    return actor


def _service(user_context=None):
    tenant_id = _tenant_id(user_context)
    if not tenant_id:
        raise RecruitmentServiceError(
            "Organisation context is required.",
            code="tenant_id_required",
            status_code=401,
        )
    try:
        config = dict(current_app.config)
    except Exception:
        config = {}
    return RecruitmentService(
        get_db(),
        tenant_id=tenant_id,
        actor=_recruitment_actor(user_context),
        config=config,
    )


def _hr_access(user_context=None):
    if not _tenant_id(user_context):
        return "I cannot verify your organisation context. Please sign in again and retry."
    if not _actor_id(user_context):
        return "I cannot verify your signed-in user identity. Please sign in again and retry."
    if not _roles(user_context).intersection(HR_ROLES):
        return "This HR function is available only to authorised HR or company administrators."
    return ""


def _recruitment_reader_access(user_context=None):
    if not _tenant_id(user_context):
        return "I cannot verify your organisation context. Please sign in again and retry."
    if not _actor_id(user_context):
        return "I cannot verify your signed-in user identity. Please sign in again and retry."
    if not _roles(user_context).intersection(RECRUITMENT_READ_ROLES):
        return "You do not have access to recruitment records for this organisation."
    return ""


def _hiring_creator_access(user_context=None):
    if not _tenant_id(user_context) or not _actor_id(user_context):
        return "I cannot verify your organisation and user context. Please sign in again and retry."
    if not _roles(user_context).intersection(HR_ROLES | {"team_leader"}):
        return "Only authorised HR, company administrators, or Team Leaders can create hiring requests."
    return ""


def _final_hiring_access(user_context=None):
    if not _tenant_id(user_context) or not _actor_id(user_context):
        return "I cannot verify your organisation and user context. Please sign in again and retry."
    if _roles(user_context).intersection(FINAL_HIRING_ROLES):
        return ""
    if _capabilities(user_context).intersection(FINAL_APPROVAL_CAPABILITIES):
        return ""
    return "Final hiring approval is available only to an authorised Admin or Managing Director."


def _yes(value):
    return _norm(value) in {
        "yes", "y", "confirm", "confirmed", "proceed", "go ahead",
        "do it", "submit", "yes proceed", "yes confirm",
    }


def _no(value):
    return _norm(value) in {"no", "n", "cancel", "stop", "do not", "don't", "dont"}


def _skip(value):
    return _norm(value) in {"skip", "none", "default", "no note", "no notes", "not applicable", "n/a"}


def _cancel(value):
    clean = _norm(value)
    return clean in {"cancel", "stop", "exit", "quit", "forget it", "never mind", "nevermind"}


def _safe_error(exc, default="I could not complete that HRMS action. Please try again."):
    if isinstance(exc, RecruitmentServiceError):
        return _text(getattr(exc, "message", "")) or default
    text = _text(exc)
    # Do not expose raw database/stack details.
    if any(token in text.lower() for token in ("traceback", "mongodb", "pymongo", "objectid", "duplicate key", "localhost")):
        return default
    return text[:500] or default


def _oid(value):
    try:
        text = _text(value)
        return ObjectId(text) if ObjectId.is_valid(text) else None
    except Exception:
        return None


def _iso(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return _text(value)


def _format_date(value):
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y")
    text = _text(value)
    if not text:
        return ""
    try:
        return datetime.fromisoformat(text[:10]).strftime("%d %b %Y")
    except Exception:
        return text


def _format_datetime(value):
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y, %I:%M %p")
    text = _text(value)
    if not text:
        return ""
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%d %b %Y, %I:%M %p")
    except Exception:
        return text


def _number_choice(text, items):
    match = re.search(r"(?:^|\b)(\d{1,2})(?:\b|$)", _norm(text))
    if not match:
        return None
    idx = int(match.group(1)) - 1
    return items[idx] if 0 <= idx < len(items) else None


def _list_choices(title, items, formatter):
    if not items:
        return title
    lines = [title]
    for idx, item in enumerate(items[:DISPLAY_LIMIT], 1):
        lines.append(f"{idx}. {formatter(item)}")
    if len(items) > DISPLAY_LIMIT:
        lines.append(f"Showing the first {DISPLAY_LIMIT} of {len(items)} records. Refine your request if needed.")
    return "\n".join(lines)


def _extract_candidate_hint(question):
    clean = _text(question)
    patterns = [
        r"(?:candidate|applicant)\s+(.+?)(?:\s+(?:for|on|at|tomorrow|today|next|this)\b|$)",
        r"(?:interview|application|onboarding)\s+(?:for\s+)?(.+?)(?:\s+(?:for|on|at|tomorrow|today|next|this)\b|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, clean, flags=re.I)
        if match:
            value = _text(match.group(1)).strip(" ,.-")
            if value and value.lower() not in {"the", "a", "an"}:
                return value[:120]
    return ""


def _applications(search, user_context=None, statuses=None, limit=20):
    service = _service(user_context)
    result = service.list_applications(search=search or "", page=1, page_size=min(100, limit))
    items = list(result.get("items") or [])
    if statuses:
        allowed = {_role_key(item) for item in statuses}
        items = [item for item in items if _role_key(item.get("status")) in allowed]
    return items


def _application_label(item):
    return " — ".join(filter(None, [
        _text(item.get("candidate_name") or "Candidate"),
        _text(item.get("job_title")),
        _text(item.get("status")).replace("_", " ").title(),
        _text(item.get("reference_no")),
    ]))


def _resolve_application(question, user_context=None, statuses=None):
    hint = _extract_candidate_hint(question)
    items = _applications(hint, user_context, statuses=statuses, limit=20)
    if hint:
        exact = [
            item for item in items
            if hint.lower() in _text(item.get("candidate_name")).lower()
            or hint.lower() in _text(item.get("candidate_email")).lower()
            or hint.lower() in _text(item.get("reference_no")).lower()
        ]
        if len(exact) == 1:
            return exact[0], items
        if exact:
            items = exact
    if len(items) == 1:
        return items[0], items
    return None, items


def _find_application_by_saved_id(application_id, user_context=None):
    if not application_id:
        return None
    try:
        return _service(user_context).get_application(application_id)
    except Exception:
        return None


def _month_add(source_date, months):
    month_index = source_date.month - 1 + months
    year = source_date.year + month_index // 12
    month = month_index % 12 + 1
    day = min(source_date.day, monthrange(year, month)[1])
    return date(year, month, day)


def _parse_date_value(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _text(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(text[:20], fmt).date()
        except Exception:
            pass
    try:
        return datetime.fromisoformat(text[:10]).date()
    except Exception:
        return None


def _probation_end(employee):
    explicit = (
        employee.get("probation_end_date")
        or employee.get("probation_end")
        or employee.get("confirmation_due_date")
    )
    parsed = _parse_date_value(explicit)
    if parsed:
        return parsed
    joining = _parse_date_value(employee.get("joining_date") or employee.get("date_of_joining"))
    if not joining:
        return None
    period = _norm(employee.get("probation_period") or employee.get("probation"))
    match = re.search(r"(\d+)\s*(month|months|m)\b", period)
    if match:
        return _month_add(joining, int(match.group(1)))
    match = re.search(r"(\d+)\s*(day|days|d)\b", period)
    if match:
        return joining + timedelta(days=int(match.group(1)))
    return None


# ---------------------------------------------------------------------------
# Read intelligence: HR workforce, recruitment, interviews, onboarding, leave
# ---------------------------------------------------------------------------


def _workforce_overview_answer(question, user_context=None):
    db = get_db()
    tenant = _tenant_id(user_context)
    query = {"tenant_id": tenant, "is_deleted": {"$ne": True}}
    employees = list(db.employees.find(query, {
        "employee_name": 1, "name": 1, "full_name": 1, "employee_code": 1,
        "department": 1, "department_name": 1, "designation": 1,
        "designation_name": 1, "status": 1, "employment_status": 1,
        "employee_status": 1, "joining_date": 1, "date_of_joining": 1,
        "probation_period": 1, "probation_end_date": 1, "probation_end": 1,
        "confirmation_due_date": 1,
    }).limit(1000))

    inactive_terms = {"resigned", "left", "terminated", "retired", "inactive", "disabled", "alumni"}
    active = []
    inactive = []
    probation = []
    departments = {}
    today = date.today()
    month_end = date(today.year, today.month, monthrange(today.year, today.month)[1])
    probation_due = []

    for employee in employees:
        status = _role_key(employee.get("employment_status") or employee.get("employee_status") or employee.get("status") or "active")
        if status in inactive_terms:
            inactive.append(employee)
        else:
            active.append(employee)
        if "probation" in status:
            probation.append(employee)
        department = _text(employee.get("department") or employee.get("department_name") or "Unassigned")
        departments[department] = departments.get(department, 0) + 1
        end_date = _probation_end(employee)
        if end_date and today <= end_date <= month_end:
            probation_due.append((employee, end_date))

    lines = [
        f"Workforce overview: {len(active)} active employee(s), {len(inactive)} inactive/alumni record(s), and {len(probation)} employee(s) currently marked on probation."
    ]
    if departments:
        top = sorted(departments.items(), key=lambda item: (-item[1], item[0]))[:8]
        lines.append("Department distribution: " + ", ".join(f"{name}: {count}" for name, count in top) + ".")
    if "probation" in _norm(question) or "confirmation" in _norm(question):
        if probation_due:
            lines.append(f"Probation/confirmation due this month: {len(probation_due)} employee(s).")
            for employee, end_date in probation_due[:DISPLAY_LIMIT]:
                name = _text(employee.get("employee_name") or employee.get("full_name") or employee.get("name") or "Employee")
                lines.append(f"- {name} — due {end_date.strftime('%d %b %Y')}")
        else:
            lines.append("No employee with a calculable probation/confirmation end date was found due this month.")
    return "\n".join(lines)


def _workforce_start(question="", user_context=None):
    return {"handled": True, "answer": _workforce_overview_answer(question, user_context)}


def _recruitment_dashboard_start(question="", user_context=None):
    try:
        data = _service(user_context).get_dashboard()
    except Exception as exc:
        return {"handled": True, "answer": _safe_error(exc, "I could not load the recruitment dashboard safely.")}
    cards = data.get("cards") or {}
    lines = [
        "Recruitment overview:",
        f"- Open hiring requests: {cards.get('open_hiring_requests', 0)}",
        f"- Open vacancies: {cards.get('open_vacancies', 0)}",
        f"- New applications: {cards.get('new_applications', 0)}",
        f"- Pending screening: {cards.get('pending_screening', 0)}",
        f"- Interviews today: {cards.get('interviews_today', 0)}",
        f"- Interview feedback pending: {cards.get('feedback_pending', 0)}",
        f"- Offers awaiting candidate reply: {cards.get('offers_awaiting_reply', 0)}",
        f"- Ready to join: {cards.get('ready_to_join', 0)}",
    ]
    pipeline = data.get("pipeline") or []
    if pipeline:
        lines.append("Pipeline: " + ", ".join(
            f"{_text(item.get('status')).replace('_', ' ').title()}: {item.get('count', 0)}"
            for item in pipeline[:10]
        ) + ".")
    return {"handled": True, "answer": "\n".join(lines)}


def _pipeline_start(question="", user_context=None):
    try:
        service = _service(user_context)
        data = service.get_dashboard()
    except Exception as exc:
        return {"handled": True, "answer": _safe_error(exc, "I could not load the candidate pipeline safely.")}
    lines = ["Candidate pipeline:"]
    for item in (data.get("pipeline") or [])[:15]:
        lines.append(f"- {_text(item.get('status')).replace('_', ' ').title()}: {item.get('count', 0)}")
    recent = data.get("recent_applications") or []
    if recent:
        lines.append("Recently updated applications:")
        for item in recent[:8]:
            lines.append(f"- {_application_label(item)}")
    if len(lines) == 1:
        lines.append("No recruitment applications are currently available in your authorised scope.")
    return {"handled": True, "answer": "\n".join(lines)}


def _interviews_start(question="", user_context=None):
    clean = _norm(question)
    today = date.today()
    from_date = ""
    to_date = ""
    if "today" in clean:
        from_date = to_date = today.isoformat()
    elif "this week" in clean or "upcoming" in clean:
        from_date = today.isoformat()
        to_date = (today + timedelta(days=7)).isoformat()
    try:
        result = _service(user_context).list_interviews(
            from_date=from_date,
            to_date=to_date,
            page=1,
            page_size=30,
        )
    except Exception as exc:
        return {"handled": True, "answer": _safe_error(exc, "I could not load the interview schedule safely.")}
    items = result.get("items") or []
    if not items:
        return {"handled": True, "answer": "No interviews were found for the requested period in your authorised recruitment scope."}
    lines = [f"Interview schedule ({len(items)} record(s)):"]
    for item in items[:DISPLAY_LIMIT]:
        lines.append(
            f"- {_text(item.get('candidate_name') or 'Candidate')} — {_text(item.get('round_label') or item.get('round_key')).replace('_', ' ').title()} — "
            f"{_format_datetime(item.get('scheduled_at'))} — {_text(item.get('status')).replace('_', ' ').title()}"
        )
    return {"handled": True, "answer": "\n".join(lines)}


def _onboarding_start(question="", user_context=None):
    db = get_db()
    tenant = _tenant_id(user_context)
    tasks = list(db[ONBOARDING_TASKS].find({
        "tenant_id": tenant,
        "is_deleted": {"$ne": True},
    }).sort([("updated_at", -1), ("created_at", -1)]).limit(500))
    if not tasks:
        return {"handled": True, "answer": "No onboarding tasks were found for this organisation."}
    groups = {}
    for task in tasks:
        key = _text(task.get("employee_id") or task.get("application_id") or task.get("employee_name"))
        bucket = groups.setdefault(key, {
            "name": _text(task.get("employee_name") or "Employee"),
            "pending": 0,
            "completed": 0,
            "total": 0,
            "overdue": 0,
        })
        bucket["total"] += 1
        status = _role_key(task.get("status") or "pending")
        if status in {"completed", "done", "closed"}:
            bucket["completed"] += 1
        else:
            bucket["pending"] += 1
            due = _parse_date_value(task.get("due_date"))
            if due and due < date.today():
                bucket["overdue"] += 1
    incomplete = [item for item in groups.values() if item["pending"] > 0]
    incomplete.sort(key=lambda item: (-item["overdue"], -item["pending"], item["name"]))
    lines = [
        f"Onboarding overview: {len(groups)} employee onboarding record(s), with {len(incomplete)} still having pending task(s)."
    ]
    for item in incomplete[:DISPLAY_LIMIT]:
        overdue = f", {item['overdue']} overdue" if item["overdue"] else ""
        lines.append(f"- {item['name']} — {item['pending']} pending of {item['total']} task(s){overdue}")
    if not incomplete:
        lines.append("All recorded onboarding tasks are completed.")
    return {"handled": True, "answer": "\n".join(lines)}


def _hr_leave_scope(user_context=None):
    roles = _roles(user_context)
    clauses = []
    if roles.intersection(ADMIN_HR_ROLES):
        clauses.append({"approval_stage": "hr", "status": {"$in": ["pending", "in_review"]}})
    if roles.intersection(ADMIN_APPROVER_ROLES):
        clauses.append({"approval_stage": "admin", "status": {"$in": ["pending", "in_review"]}})
    return clauses


def _hr_leave_docs(user_context=None, limit=READ_LIMIT):
    clauses = _hr_leave_scope(user_context)
    if not clauses:
        return []
    return list(get_db().leave_requests.find({
        "tenant_id": _tenant_id(user_context),
        "is_deleted": {"$ne": True},
        "$or": clauses,
    }).sort("updated_at", -1).limit(limit))


def _hr_leave_queue_start(question="", user_context=None):
    docs = _hr_leave_docs(user_context, limit=50)
    if not docs:
        return {"handled": True, "answer": "There are no leave requests currently pending in your HR/Admin approval stage."}
    lines = [f"HR/Admin leave approval queue: {len(docs)} pending request(s)."]
    for item in docs[:DISPLAY_LIMIT]:
        name = _text(item.get("employee_name") or item.get("applicant_name") or "Employee")
        leave_type = leave_type_label(normalize_leave_type(item.get("leave_type")))
        date_text = _text(item.get("from_date"))
        if item.get("to_date") and item.get("to_date") != item.get("from_date"):
            date_text += f" to {_text(item.get('to_date'))}"
        lines.append(f"- {name} — {leave_type} — {date_text} — {leave_stage_label(item.get('approval_stage') or 'hr')}")
    return {"handled": True, "answer": "\n".join(lines)}


# ---------------------------------------------------------------------------
# HR leave decision
# ---------------------------------------------------------------------------


def _hr_leave_candidates(user_context=None):
    items = []
    for doc in _hr_leave_docs(user_context, limit=100):
        items.append({
            "id": str(doc.get("_id")),
            "employee_name": _text(doc.get("employee_name") or doc.get("applicant_name") or "Employee"),
            "leave_type": leave_type_label(normalize_leave_type(doc.get("leave_type"))),
            "from_date": _text(doc.get("from_date")),
            "to_date": _text(doc.get("to_date")),
            "stage": _text(doc.get("approval_stage") or "hr"),
        })
    return items


def _match_leave_candidate(text, candidates):
    numbered = _number_choice(text, candidates)
    if numbered:
        return numbered
    clean = _norm(text)
    matches = []
    for item in candidates:
        if any(_norm(value) and _norm(value) in clean for value in (
            item.get("employee_name"), item.get("from_date"), item.get("id"),
        )):
            matches.append(item)
    return matches[0] if len(matches) == 1 else None


def _decision(text):
    clean = _norm(text)
    if any(term in clean for term in ("reject", "decline", "deny", "not approve")):
        return "rejected"
    if any(term in clean for term in ("approve", "accept", "allow")):
        return "approved"
    return ""


def _safe_hr_leave_doc(request_id, user_context=None):
    oid = _oid(request_id)
    if not oid:
        return None
    for doc in _hr_leave_docs(user_context, limit=200):
        if doc.get("_id") == oid:
            return doc
    return None


def _execute_hr_leave_decision(request_id, decision, note, user_context=None):
    db = get_db()
    existing = _safe_hr_leave_doc(request_id, user_context)
    if not existing:
        raise ValueError("The leave request is no longer pending in your HR/Admin approval scope.")
    if decision not in {"approved", "rejected"}:
        raise ValueError("The leave decision must be approve or reject.")

    employee_oid = _oid(existing.get("employee_id"))
    if not employee_oid:
        raise ValueError("The leave request has an invalid employee mapping.")
    employee = db.employees.find_one({
        "_id": employee_oid,
        "tenant_id": _tenant_id(user_context),
        "is_deleted": {"$ne": True},
    })
    if not employee:
        raise ValueError("The employee mapped to this leave request could not be found.")

    current_stage = _text(existing.get("approval_stage") or "hr")
    roles = _roles(user_context)
    if current_stage == "admin" and not roles.intersection(ADMIN_APPROVER_ROLES):
        raise ValueError("This leave request requires an Admin approver.")
    if current_stage == "hr" and not roles.intersection(ADMIN_HR_ROLES):
        raise ValueError("This leave request requires an authorised HR/Admin approver.")

    now = datetime.utcnow()
    actor_id = _actor_id(user_context)
    actor_name = _actor_name(user_context)
    stage_fields = approval_stage_update_fields(current_stage, decision, note)

    if decision == "rejected":
        rollback_compoff_claim_if_needed(db, existing)
        db.leave_requests.update_one(
            {"_id": existing["_id"], "tenant_id": _tenant_id(user_context)},
            {
                "$set": {
                    "status": "rejected",
                    "approval_stage": "rejected",
                    "approval_stage_label": "Rejected / Cancelled",
                    "decision_reason": note,
                    "rejected_at": now,
                    "rejected_by": actor_id,
                    "rejected_by_name": actor_name,
                    "updated_at": now,
                    **stage_fields,
                },
                "$push": {"approval_history": create_leave_history_entry("rejected", current_stage, note)},
            },
        )
        updated = db.leave_requests.find_one({"_id": existing["_id"]})
        notify_employee_leave_decision(db, employee, updated, "rejected")
        notify_hr_leave_result(db, employee, updated, "rejected")
        audit("saya_hr_reject_leave", "leave_requests", request_id, {"note": note, "stage": current_stage})
        return "Leave rejected successfully. The employee has been notified."

    leave_type = normalize_leave_type(existing.get("leave_type"))
    leave_days = float(existing.get("leave_days", 1) or 1)
    deducted_leave_type = leave_type
    deducted_label = leave_type_label(leave_type)
    balance_deducted = False
    lwp_days = 0.0

    if leave_type == "HALF-DAY" and not existing.get("balance_deducted"):
        deduction = deduct_leave_balance(db, employee, existing)
        deducted_leave_type = normalize_leave_type(deduction.get("leave_type") if isinstance(deduction, dict) else leave_type)
        deducted_label = leave_type_label(deducted_leave_type)
        balance_deducted = deducted_leave_type in LEAVE_TYPES_WITH_BALANCE
        lwp_days = leave_days if deducted_leave_type == "LWP" else 0.0
    elif leave_type in LEAVE_TYPES_WITH_BALANCE and not existing.get("balance_deducted"):
        sufficient, balance = has_sufficient_leave_balance(db, employee, leave_type, leave_days)
        if not sufficient:
            available = float((balance or {}).get("available", 0) or 0)
            raise ValueError(
                f"Final approval cannot be completed because the employee has only {available:g} day(s) of {leave_type_label(leave_type)} available."
            )
        deduct_leave_balance(db, employee, existing)
        balance_deducted = True
    elif leave_type == "COMP-OFF":
        deducted_leave_type = "COMP-OFF"
        deducted_label = leave_type_label("COMP-OFF")

    db.leave_requests.update_one(
        {"_id": existing["_id"], "tenant_id": _tenant_id(user_context)},
        {
            "$set": {
                "status": "approved",
                "approval_stage": "approved",
                "approval_stage_label": "Approved",
                "decision_reason": note,
                "approved_at": now,
                "approved_by": actor_id,
                "approved_by_name": actor_name,
                "deducted_leave_type": deducted_leave_type,
                "deducted_leave_type_label": deducted_label,
                "lwp_days": lwp_days,
                "balance_deducted": balance_deducted,
                "compoff_status": "used" if leave_type == "COMP-OFF" else existing.get("compoff_status", ""),
                "updated_at": now,
                **stage_fields,
            },
            "$push": {"approval_history": create_leave_history_entry("approved", current_stage, note)},
        },
    )
    updated = db.leave_requests.find_one({"_id": existing["_id"]})
    mark_compoff_used_if_needed(db, updated)
    updated = db.leave_requests.find_one({"_id": existing["_id"]})
    notify_employee_leave_decision(db, employee, updated, "approved")
    notify_hr_leave_result(db, employee, updated, "approved")
    audit("saya_hr_approve_leave", "leave_requests", request_id, {"note": note, "stage": current_stage})
    return "Leave approved successfully. The employee has been notified and the final leave workflow has been completed."


def _hr_leave_decision_start(question="", user_context=None):
    if any(term in _norm(question) for term in ("approve all", "reject all", "bulk approve", "bulk reject")):
        return {"handled": True, "answer": "For safety, Saya does not bulk-approve or bulk-reject leave requests. Please decide one request at a time."}
    candidates = _hr_leave_candidates(user_context)
    if not candidates:
        return {"handled": True, "answer": "There are no leave requests currently pending in your HR/Admin approval scope."}
    selected = _match_leave_candidate(question, candidates)
    decision = _decision(question)
    if not selected:
        save_pending_action(user_context, "hr_decide_leave", {"candidates": candidates}, "request")
        return {"handled": True, "answer": _list_choices("Which leave request do you want to review?", candidates, lambda item: f"{item['employee_name']} — {item['leave_type']} — {item['from_date']} to {item['to_date'] or item['from_date']} — {leave_stage_label(item['stage'])}")}
    data = {"request_id": selected["id"], "request_label": f"{selected['employee_name']} — {selected['leave_type']} — {selected['from_date']}", "decision": decision}
    step = "note" if decision else "decision"
    save_pending_action(user_context, "hr_decide_leave", data, step)
    if decision == "rejected":
        return {"handled": True, "answer": "Please provide the rejection reason."}
    if decision == "approved":
        return {"handled": True, "answer": "Add an approval note, or reply Skip."}
    return {"handled": True, "answer": "Would you like to approve or reject this leave request?"}


def _hr_leave_decision_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The HR leave decision has been cancelled."}
    if step == "request":
        candidates = data.get("candidates") or _hr_leave_candidates(user_context)
        selected = _match_leave_candidate(question, candidates)
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one leave request:", candidates, lambda item: f"{item['employee_name']} — {item['leave_type']} — {item['from_date']}")}
        data = {"request_id": selected["id"], "request_label": f"{selected['employee_name']} — {selected['leave_type']} — {selected['from_date']}"}
        save_pending_action(user_context, "hr_decide_leave", data, "decision")
        return {"handled": True, "answer": "Would you like to approve or reject this leave request?"}
    if step == "decision":
        value = _decision(question)
        if not value:
            return {"handled": True, "answer": "Please reply Approve or Reject."}
        data["decision"] = value
        save_pending_action(user_context, "hr_decide_leave", data, "note")
        return {"handled": True, "answer": "Please provide the rejection reason." if value == "rejected" else "Add an approval note, or reply Skip."}
    if step == "note":
        note = "" if _skip(question) else _text(question)[:1500]
        if data.get("decision") == "rejected" and not note:
            return {"handled": True, "answer": "A written reason is required to reject a leave request."}
        data["note"] = note
        save_pending_action(user_context, "hr_decide_leave", data, "confirm")
        return {"handled": True, "answer": f"Review: {data.get('decision', '').title()} {data.get('request_label', 'this leave request')}." + (f" Note: {note}" if note else "") + " Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": "Please reply Yes to confirm the leave decision, or Cancel to stop."}
        try:
            answer = _execute_hr_leave_decision(data.get("request_id"), data.get("decision"), data.get("note", ""), user_context)
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not complete the leave decision safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": answer}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete HR leave action was cleared safely. Please start again."}


# ---------------------------------------------------------------------------
# Hiring request create / submit / final decision
# ---------------------------------------------------------------------------


def _extract_hiring_title(question):
    clean = _text(question)
    patterns = [
        r"(?:hiring request|hire|recruit)\s+(?:for\s+)?(?:an?\s+)?(.+?)(?:\s+for\s+the\s+|\s+in\s+the\s+|$)",
        r"(?:need|want)\s+(?:an?\s+)?(.+?)\s+(?:position|role|vacancy)",
    ]
    for pattern in patterns:
        match = re.search(pattern, clean, re.I)
        if match:
            value = _text(match.group(1)).strip(" ,.-")
            if value:
                return value[:160]
    return ""


def _hiring_request_review(data):
    lines = ["Please review the hiring request:"]
    lines.append(f"- Job title: {data.get('job_title')}")
    lines.append(f"- Department: {data.get('department')}")
    lines.append(f"- Vacancies: {data.get('vacancies', 1)}")
    lines.append(f"- Business reason: {data.get('business_reason')}")
    if data.get("employment_type"):
        lines.append(f"- Employment type: {data.get('employment_type')}")
    if data.get("work_location"):
        lines.append(f"- Work location: {data.get('work_location')}")
    lines.append("Reply Yes to create the draft hiring request, or Cancel to stop.")
    return "\n".join(lines)


def _create_hiring_start(question="", user_context=None):
    data = {}
    title = _extract_hiring_title(question)
    if title:
        data["job_title"] = title
    if _roles(user_context).intersection({"team_leader"}) and not _roles(user_context).intersection(HR_ROLES):
        department = _text((user_context or {}).get("department") or _employee(user_context).get("department") or _employee(user_context).get("department_name"))
        if department:
            data["department"] = department
    step = "department" if data.get("job_title") else "job_title"
    if data.get("job_title") and data.get("department"):
        step = "vacancies"
    save_pending_action(user_context, "recruitment_create_hiring_request", data, step)
    prompts = {
        "job_title": "What job title or role do you want to hire for?",
        "department": "Which department is this hiring request for?",
        "vacancies": "How many vacancies are required?",
    }
    return {"handled": True, "answer": prompts[step]}


def _create_hiring_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The hiring-request draft has been cancelled."}
    if step == "job_title":
        value = _text(question)[:180]
        if len(value) < 2:
            return {"handled": True, "answer": "Please provide the job title or role."}
        data["job_title"] = value
        next_step = "department"
        if _roles(user_context).intersection({"team_leader"}) and not _roles(user_context).intersection(HR_ROLES):
            department = _text((user_context or {}).get("department") or _employee(user_context).get("department") or _employee(user_context).get("department_name"))
            if department:
                data["department"] = department
                next_step = "vacancies"
        save_pending_action(user_context, "recruitment_create_hiring_request", data, next_step)
        return {"handled": True, "answer": "Which department is this hiring request for?" if next_step == "department" else "How many vacancies are required?"}
    if step == "department":
        value = _text(question)[:180]
        if not value:
            return {"handled": True, "answer": "Please provide the department."}
        data["department"] = value
        save_pending_action(user_context, "recruitment_create_hiring_request", data, "vacancies")
        return {"handled": True, "answer": "How many vacancies are required?"}
    if step == "vacancies":
        match = re.search(r"\d+", _text(question))
        if not match or int(match.group()) < 1 or int(match.group()) > 500:
            return {"handled": True, "answer": "Please provide a valid vacancy count between 1 and 500."}
        data["vacancies"] = int(match.group())
        save_pending_action(user_context, "recruitment_create_hiring_request", data, "business_reason")
        return {"handled": True, "answer": "Please provide the business reason for this hiring requirement."}
    if step == "business_reason":
        value = _text(question)[:3000]
        if len(value) < 3:
            return {"handled": True, "answer": "A clear business reason is required."}
        data["business_reason"] = value
        save_pending_action(user_context, "recruitment_create_hiring_request", data, "employment_type")
        return {"handled": True, "answer": "What is the employment type (for example Permanent, Contract, Internship), or reply Skip for Permanent?"}
    if step == "employment_type":
        data["employment_type"] = "permanent" if _skip(question) else _role_key(question)[:80]
        save_pending_action(user_context, "recruitment_create_hiring_request", data, "work_location")
        return {"handled": True, "answer": "What is the work location, or reply Skip if not specified?"}
    if step == "work_location":
        if not _skip(question):
            data["work_location"] = _text(question)[:250]
        save_pending_action(user_context, "recruitment_create_hiring_request", data, "confirm")
        return {"handled": True, "answer": _hiring_request_review(data)}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": _hiring_request_review(data)}
        try:
            item = _service(user_context).create_hiring_request(data)
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not create the hiring request safely.")}
        clear_pending_action(user_context)
        reference = _text(item.get("reference_no"))
        return {"handled": True, "answer": f"Hiring request {reference or ''} was created successfully as a draft. It has not been submitted for final approval yet.".strip()}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete hiring-request action was cleared safely. Please start again."}


def _hiring_request_candidates(user_context=None, statuses=None):
    service = _service(user_context)
    result = service.list_hiring_requests(page=1, page_size=50)
    items = result.get("items") or []
    if statuses:
        allowed = {_role_key(item) for item in statuses}
        items = [item for item in items if _role_key(item.get("status")) in allowed]
    return items


def _hiring_label(item):
    return " — ".join(filter(None, [
        _text(item.get("reference_no")), _text(item.get("job_title")),
        _text(item.get("department")), _text(item.get("status")).replace("_", " ").title(),
    ]))


def _match_hiring(text, items):
    numbered = _number_choice(text, items)
    if numbered:
        return numbered
    clean = _norm(text)
    matches = []
    for item in items:
        if any(_norm(value) and _norm(value) in clean for value in (
            item.get("reference_no"), item.get("job_title"), item.get("department"), str(item.get("_id")),
        )):
            matches.append(item)
    return matches[0] if len(matches) == 1 else None


def _submit_hiring_start(question="", user_context=None):
    try:
        items = _hiring_request_candidates(user_context, statuses={"draft", "returned", "on_hold"})
    except Exception as exc:
        return {"handled": True, "answer": _safe_error(exc)}
    selected = _match_hiring(question, items)
    if not selected:
        if not items:
            return {"handled": True, "answer": "No hiring request in your authorised scope is currently ready to submit."}
        save_pending_action(user_context, "recruitment_submit_hiring_request", {"items": [{"id": str(item.get("_id")), "label": _hiring_label(item)} for item in items]}, "request")
        return {"handled": True, "answer": _list_choices("Which hiring request do you want to submit?", items, _hiring_label)}
    data = {"request_id": str(selected.get("_id")), "label": _hiring_label(selected)}
    save_pending_action(user_context, "recruitment_submit_hiring_request", data, "confirm")
    return {"handled": True, "answer": f"Review: submit {data['label']} for final approval. Reply Yes to confirm or Cancel to stop."}


def _submit_hiring_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The hiring-request submission has been cancelled."}
    if step == "request":
        items = _hiring_request_candidates(user_context, statuses={"draft", "returned", "on_hold"})
        selected = _match_hiring(question, items)
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one hiring request:", items, _hiring_label)}
        data = {"request_id": str(selected.get("_id")), "label": _hiring_label(selected)}
        save_pending_action(user_context, "recruitment_submit_hiring_request", data, "confirm")
        return {"handled": True, "answer": f"Review: submit {data['label']} for final approval. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": f"Reply Yes to submit {data.get('label', 'this hiring request')} for final approval, or Cancel to stop."}
        try:
            item = _service(user_context).submit_hiring_request(data.get("request_id"))
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not submit the hiring request safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": f"Hiring request {_text(item.get('reference_no'))} was submitted successfully for final approval."}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete hiring-request submission was cleared safely."}


def _final_hiring_start(question="", user_context=None):
    if any(term in _norm(question) for term in ("approve all", "reject all", "bulk approve", "bulk reject")):
        return {"handled": True, "answer": "For safety, Saya does not bulk-decide hiring requests. Please decide one request at a time."}
    try:
        items = _hiring_request_candidates(user_context, statuses={"submitted"})
    except Exception as exc:
        return {"handled": True, "answer": _safe_error(exc)}
    selected = _match_hiring(question, items)
    decision = _decision(question)
    if not selected:
        if not items:
            return {"handled": True, "answer": "There are no submitted hiring requests currently awaiting your final decision."}
        save_pending_action(user_context, "recruitment_decide_hiring_request", {}, "request")
        return {"handled": True, "answer": _list_choices("Which hiring request do you want to decide?", items, _hiring_label)}
    data = {"request_id": str(selected.get("_id")), "label": _hiring_label(selected), "decision": decision}
    step = "reason" if decision in {"rejected", "on_hold", "returned"} else ("confirm" if decision == "approved" else "decision")
    save_pending_action(user_context, "recruitment_decide_hiring_request", data, step)
    if step == "decision":
        return {"handled": True, "answer": "Would you like to approve, reject, return, or place this hiring request on hold?"}
    if step == "reason":
        return {"handled": True, "answer": "Please provide the written reason for this decision."}
    return {"handled": True, "answer": f"Review: approve {data['label']}. Reply Yes to confirm or Cancel to stop."}


def _final_hiring_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The final hiring decision has been cancelled."}
    if step == "request":
        items = _hiring_request_candidates(user_context, statuses={"submitted"})
        selected = _match_hiring(question, items)
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one submitted hiring request:", items, _hiring_label)}
        data = {"request_id": str(selected.get("_id")), "label": _hiring_label(selected)}
        save_pending_action(user_context, "recruitment_decide_hiring_request", data, "decision")
        return {"handled": True, "answer": "Would you like to approve, reject, return, or place this hiring request on hold?"}
    if step == "decision":
        clean = _norm(question)
        value = ""
        if "approve" in clean:
            value = "approved"
        elif "reject" in clean or "decline" in clean:
            value = "rejected"
        elif "return" in clean:
            value = "returned"
        elif "hold" in clean:
            value = "on_hold"
        if not value:
            return {"handled": True, "answer": "Please reply Approve, Reject, Return, or Hold."}
        data["decision"] = value
        next_step = "reason" if value in {"rejected", "returned", "on_hold"} else "confirm"
        save_pending_action(user_context, "recruitment_decide_hiring_request", data, next_step)
        if next_step == "reason":
            return {"handled": True, "answer": "Please provide the written reason for this decision."}
        return {"handled": True, "answer": f"Review: approve {data.get('label', 'this hiring request')}. Reply Yes to confirm or Cancel to stop."}
    if step == "reason":
        reason = _text(question)[:3000]
        if len(reason) < 3:
            return {"handled": True, "answer": "A written reason is required."}
        data["reason"] = reason
        save_pending_action(user_context, "recruitment_decide_hiring_request", data, "confirm")
        return {"handled": True, "answer": f"Review: {data.get('decision', '').replace('_', ' ').title()} {data.get('label', 'this hiring request')}. Reason: {reason}. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": "Please reply Yes to confirm the final hiring decision, or Cancel to stop."}
        try:
            item = _service(user_context).decide_hiring_request(
                data.get("request_id"), data.get("decision"), reason=data.get("reason", "")
            )
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not complete the final hiring decision safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": f"Hiring request {_text(item.get('reference_no'))} is now {_text(item.get('status')).replace('_', ' ')}."}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete final hiring decision was cleared safely."}


# ---------------------------------------------------------------------------
# Candidate application stage
# ---------------------------------------------------------------------------


def _application_stage_start(question="", user_context=None):
    selected, items = _resolve_application(question, user_context)
    if not selected:
        if not items:
            save_pending_action(user_context, "recruitment_update_application_stage", {}, "candidate")
            return {"handled": True, "answer": "Which candidate or application do you want to update?"}
        save_pending_action(user_context, "recruitment_update_application_stage", {}, "candidate")
        return {"handled": True, "answer": _list_choices("Which application do you want to update?", items, _application_label)}
    data = {"application_id": str(selected.get("_id")), "label": _application_label(selected), "current_status": _role_key(selected.get("status"))}
    save_pending_action(user_context, "recruitment_update_application_stage", data, "status")
    allowed = sorted(APPLICATION_TRANSITIONS.get(data["current_status"], set()))
    return {"handled": True, "answer": "What should the new candidate stage be? Allowed next stages: " + ", ".join(item.replace("_", " ").title() for item in allowed) + "."}


def _application_stage_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The candidate-stage update has been cancelled."}
    if step == "candidate":
        items = _applications(_text(question), user_context, limit=20)
        selected = _number_choice(question, items)
        if not selected:
            matches = [item for item in items if _norm(question) in _norm(item.get("candidate_name")) or _norm(question) in _norm(item.get("reference_no"))]
            selected = matches[0] if len(matches) == 1 else (items[0] if len(items) == 1 else None)
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one candidate application:", items, _application_label) if items else "I could not find that candidate application. Please provide the candidate name, email, or application reference."}
        data = {"application_id": str(selected.get("_id")), "label": _application_label(selected), "current_status": _role_key(selected.get("status"))}
        save_pending_action(user_context, "recruitment_update_application_stage", data, "status")
        allowed = sorted(APPLICATION_TRANSITIONS.get(data["current_status"], set()))
        return {"handled": True, "answer": "What should the new candidate stage be? Allowed next stages: " + ", ".join(item.replace("_", " ").title() for item in allowed) + "."}
    if step == "status":
        target = _role_key(question)
        aliases = {
            "shortlist": "shortlisted", "shortlisted": "shortlisted", "review": "under_review",
            "under_review": "under_review", "reject": "rejected", "rejected": "rejected",
            "hold": "on_hold", "on_hold": "on_hold", "selected": "selected",
            "interviewed": "interviewed", "withdrawn": "withdrawn",
        }
        target = aliases.get(target, target)
        allowed = APPLICATION_TRANSITIONS.get(data.get("current_status"), set())
        if target not in allowed:
            return {"handled": True, "answer": "That stage is not a valid next transition. Allowed next stages: " + ", ".join(item.replace("_", " ").title() for item in sorted(allowed)) + "."}
        data["target_status"] = target
        next_step = "reason" if target in {"rejected", "on_hold"} else "notes"
        save_pending_action(user_context, "recruitment_update_application_stage", data, next_step)
        return {"handled": True, "answer": "Please provide a reason for this stage change." if next_step == "reason" else "Add an internal note for this stage change, or reply Skip."}
    if step == "reason":
        value = _text(question)[:3000]
        if len(value) < 3:
            return {"handled": True, "answer": "A written reason is required for this stage change."}
        data["reason"] = value
        save_pending_action(user_context, "recruitment_update_application_stage", data, "confirm")
        return {"handled": True, "answer": f"Review: move {data.get('label')} to {data.get('target_status', '').replace('_', ' ').title()}. Reason: {value}. Reply Yes to confirm or Cancel to stop."}
    if step == "notes":
        if not _skip(question):
            data["notes"] = _text(question)[:3000]
        save_pending_action(user_context, "recruitment_update_application_stage", data, "confirm")
        return {"handled": True, "answer": f"Review: move {data.get('label')} to {data.get('target_status', '').replace('_', ' ').title()}. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": "Please reply Yes to confirm the candidate-stage update, or Cancel to stop."}
        try:
            item = _service(user_context).change_application_status(
                data.get("application_id"), data.get("target_status"),
                reason=data.get("reason", ""), notes=data.get("notes", ""),
            )
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not update the candidate stage safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": f"Candidate stage updated successfully to {_text(item.get('status')).replace('_', ' ').title()}."}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete candidate-stage action was cleared safely."}


# ---------------------------------------------------------------------------
# Interview scheduling / rescheduling
# ---------------------------------------------------------------------------

WEEKDAYS = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}


def _parse_time_component(text):
    match = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", text, re.I)
    if match:
        hour = int(match.group(1))
        minute = int(match.group(2) or 0)
        meridian = match.group(3).lower()
        if hour < 1 or hour > 12 or minute > 59:
            return None
        if meridian == "pm" and hour != 12:
            hour += 12
        if meridian == "am" and hour == 12:
            hour = 0
        return hour, minute
    match = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", text)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None


def _parse_interview_datetime(text):
    clean = _norm(text)
    time_part = _parse_time_component(clean)
    if not time_part:
        return None
    hour, minute = time_part
    today = date.today()
    target = None
    if "tomorrow" in clean:
        target = today + timedelta(days=1)
    elif "today" in clean:
        target = today
    else:
        iso = re.search(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", clean)
        if iso:
            target = date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        else:
            dmy = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b", clean)
            if dmy:
                target = date(int(dmy.group(3)), int(dmy.group(2)), int(dmy.group(1)))
    if target is None:
        for name, weekday in WEEKDAYS.items():
            if name in clean:
                delta = (weekday - today.weekday()) % 7
                if "next " + name in clean or delta == 0:
                    delta = 7 if delta == 0 else delta
                target = today + timedelta(days=delta)
                break
    if target is None:
        month_match = re.search(r"\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(20\d{2})?\b", clean, re.I)
        if month_match:
            months = {name.lower(): idx for idx, names in enumerate([
                ("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"), ("may",), ("jun", "june"),
                ("jul", "july"), ("aug", "august"), ("sep", "september"), ("oct", "october"), ("nov", "november"), ("dec", "december")
            ], 1) for name in names}
            month = months[month_match.group(2).lower()]
            year = int(month_match.group(3) or today.year)
            candidate = date(year, month, int(month_match.group(1)))
            if not month_match.group(3) and candidate < today:
                candidate = date(year + 1, month, int(month_match.group(1)))
            target = candidate
    if target is None:
        return None
    return datetime(target.year, target.month, target.day, hour, minute)


def _resolve_interviewers(text, user_context=None):
    clean = _text(text)
    if not clean:
        return [], []
    names = [item.strip() for item in re.split(r",|\band\b", clean, flags=re.I) if item.strip()]
    db = get_db()
    tenant = _tenant_id(user_context)
    resolved = []
    unresolved = []
    for name in names:
        regex = re.escape(name)
        users = list(db.users.find({
            "tenant_id": tenant,
            "is_deleted": {"$ne": True},
            "is_active": {"$ne": False},
            "status": {"$ne": "inactive"},
            "$or": [
                {"name": {"$regex": regex, "$options": "i"}},
                {"full_name": {"$regex": regex, "$options": "i"}},
                {"email": {"$regex": f"^{regex}$", "$options": "i"}},
            ],
        }, {"name": 1, "full_name": 1, "email": 1}).limit(5))
        if len(users) == 1:
            resolved.append({"id": str(users[0].get("_id")), "name": _text(users[0].get("name") or users[0].get("full_name") or users[0].get("email"))})
        else:
            unresolved.append(name)
    return resolved, unresolved


def _interview_rounds(application_id, user_context=None):
    service = _service(user_context)
    application = service.get_application(application_id)
    return service._available_interview_rounds(application)


def _schedule_interview_start(question="", user_context=None):
    selected, items = _resolve_application(question, user_context, statuses={"shortlisted", "on_hold", "interview_scheduled", "interviewed"})
    if not selected:
        save_pending_action(user_context, "recruitment_schedule_interview", {}, "candidate")
        if items:
            return {"handled": True, "answer": _list_choices("Which candidate application should the interview be scheduled for?", items, _application_label)}
        return {"handled": True, "answer": "Which shortlisted candidate should the interview be scheduled for?"}
    data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
    rounds = _interview_rounds(data["application_id"], user_context)
    data["rounds"] = [{"key": item.get("key"), "label": item.get("label") or item.get("key")} for item in rounds]
    save_pending_action(user_context, "recruitment_schedule_interview", data, "round")
    return {"handled": True, "answer": _list_choices("Which interview round should I schedule?", data["rounds"], lambda item: _text(item.get("label")))}


def _schedule_interview_review(data):
    return "\n".join([
        "Please review the interview schedule:",
        f"- Candidate: {data.get('label')}",
        f"- Round: {data.get('round_label')}",
        f"- Date/time: {_format_datetime(data.get('scheduled_at'))}",
        f"- Interviewer(s): {', '.join(item.get('name') for item in data.get('interviewers', []))}",
        f"- Mode: {data.get('mode', 'online').replace('_', ' ').title()}",
        f"- Location/link: {data.get('location_or_link') or 'Not specified'}",
        f"- Duration: {data.get('duration_minutes', 45)} minutes",
        "Reply Yes to schedule the interview, or Cancel to stop.",
    ])


def _schedule_interview_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The interview scheduling action has been cancelled."}
    if step == "candidate":
        items = _applications(_text(question), user_context, statuses={"shortlisted", "on_hold", "interview_scheduled", "interviewed"}, limit=20)
        selected = _number_choice(question, items) or (items[0] if len(items) == 1 else None)
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one eligible candidate application:", items, _application_label) if items else "I could not find an eligible shortlisted candidate. Please provide the candidate name or application reference."}
        data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
        rounds = _interview_rounds(data["application_id"], user_context)
        data["rounds"] = [{"key": item.get("key"), "label": item.get("label") or item.get("key")} for item in rounds]
        save_pending_action(user_context, "recruitment_schedule_interview", data, "round")
        return {"handled": True, "answer": _list_choices("Which interview round should I schedule?", data["rounds"], lambda item: _text(item.get("label")))}
    if step == "round":
        rounds = data.get("rounds") or _interview_rounds(data.get("application_id"), user_context)
        selected = _number_choice(question, rounds)
        if not selected:
            clean = _norm(question)
            matches = [item for item in rounds if clean in _norm(item.get("label")) or clean == _norm(item.get("key"))]
            selected = matches[0] if len(matches) == 1 else None
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose a configured interview round:", rounds, lambda item: _text(item.get("label")))}
        data["round_key"] = _text(selected.get("key"))
        data["round_label"] = _text(selected.get("label") or selected.get("key"))
        save_pending_action(user_context, "recruitment_schedule_interview", data, "scheduled_at")
        return {"handled": True, "answer": "When should the interview be held? For example: next Tuesday at 11 AM, tomorrow at 3 PM, or 2026-09-10 14:30."}
    if step == "scheduled_at":
        value = _parse_interview_datetime(question)
        if not value or value <= datetime.now() + timedelta(minutes=5):
            return {"handled": True, "answer": "Please provide a valid future interview date and time, for example next Tuesday at 11 AM."}
        data["scheduled_at"] = value.isoformat()
        save_pending_action(user_context, "recruitment_schedule_interview", data, "interviewers")
        return {"handled": True, "answer": "Who should interview the candidate? Provide the interviewer name or names separated by commas."}
    if step == "interviewers":
        resolved, unresolved = _resolve_interviewers(question, user_context)
        if unresolved or not resolved:
            detail = f" I could not uniquely resolve: {', '.join(unresolved)}." if unresolved else ""
            return {"handled": True, "answer": "Please provide the exact active HRMS user name or email for each interviewer." + detail}
        data["interviewers"] = resolved
        save_pending_action(user_context, "recruitment_schedule_interview", data, "mode")
        return {"handled": True, "answer": "What is the interview mode: Online, In Person, or Phone?"}
    if step == "mode":
        clean = _norm(question)
        if "phone" in clean:
            mode = "phone"
        elif "person" in clean or "offline" in clean or "office" in clean:
            mode = "in_person"
        elif "online" in clean or "virtual" in clean or "video" in clean:
            mode = "online"
        else:
            return {"handled": True, "answer": "Please choose Online, In Person, or Phone."}
        data["mode"] = mode
        save_pending_action(user_context, "recruitment_schedule_interview", data, "location")
        return {"handled": True, "answer": "Provide the meeting link/location, or reply Skip if it will be added later."}
    if step == "location":
        if not _skip(question):
            data["location_or_link"] = _text(question)[:1000]
        save_pending_action(user_context, "recruitment_schedule_interview", data, "duration")
        return {"handled": True, "answer": "How many minutes should the interview last? Reply Skip for 45 minutes."}
    if step == "duration":
        if _skip(question):
            duration = 45
        else:
            match = re.search(r"\d+", _text(question))
            duration = int(match.group()) if match else 0
        if duration < 10 or duration > 480:
            return {"handled": True, "answer": "Interview duration must be between 10 and 480 minutes."}
        data["duration_minutes"] = duration
        save_pending_action(user_context, "recruitment_schedule_interview", data, "notes")
        return {"handled": True, "answer": "Add a note for the candidate, or reply Skip."}
    if step == "notes":
        if not _skip(question):
            data["candidate_notes"] = _text(question)[:5000]
        save_pending_action(user_context, "recruitment_schedule_interview", data, "confirm")
        return {"handled": True, "answer": _schedule_interview_review(data)}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": _schedule_interview_review(data)}
        payload = {
            "round_key": data.get("round_key"),
            "scheduled_at": data.get("scheduled_at"),
            "duration_minutes": data.get("duration_minutes", 45),
            "timezone": "Asia/Kolkata",
            "mode": data.get("mode") or "online",
            "interviewer_user_ids": [item.get("id") for item in data.get("interviewers", [])],
            "candidate_notes": data.get("candidate_notes", ""),
        }
        if data.get("mode") == "online":
            payload["meeting_link"] = data.get("location_or_link", "")
        else:
            payload["location"] = data.get("location_or_link", "")
        try:
            item = _service(user_context).schedule_interview(data.get("application_id"), payload)
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not schedule the interview safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": f"Interview {_text(item.get('reference_no'))} was scheduled successfully for {_format_datetime(item.get('scheduled_at'))}. Candidate/interviewer notifications will follow the existing recruitment workflow."}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete interview scheduling action was cleared safely."}


def _reschedule_interview_start(question="", user_context=None):
    try:
        result = _service(user_context).list_interviews(page=1, page_size=30)
        items = [item for item in (result.get("items") or []) if _role_key(item.get("status")) in {"scheduled", "rescheduled", "candidate_absent", "interviewer_absent"}]
    except Exception as exc:
        return {"handled": True, "answer": _safe_error(exc)}
    if not items:
        return {"handled": True, "answer": "No interview in your authorised scope is currently eligible for rescheduling."}
    selected = _number_choice(question, items)
    if not selected:
        hint = _extract_candidate_hint(question)
        matches = [item for item in items if hint and hint.lower() in _text(item.get("candidate_name")).lower()]
        selected = matches[0] if len(matches) == 1 else None
    if not selected:
        save_pending_action(user_context, "recruitment_reschedule_interview", {}, "interview")
        return {"handled": True, "answer": _list_choices("Which interview do you want to reschedule?", items, lambda item: f"{_text(item.get('candidate_name'))} — {_text(item.get('round_label'))} — {_format_datetime(item.get('scheduled_at'))}")}
    data = {"interview_id": str(selected.get("_id")), "label": f"{_text(selected.get('candidate_name'))} — {_text(selected.get('round_label'))}"}
    save_pending_action(user_context, "recruitment_reschedule_interview", data, "scheduled_at")
    return {"handled": True, "answer": "What is the new interview date and time?"}


def _reschedule_interview_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The interview rescheduling action has been cancelled."}
    if step == "interview":
        result = _service(user_context).list_interviews(page=1, page_size=30)
        items = [item for item in (result.get("items") or []) if _role_key(item.get("status")) in {"scheduled", "rescheduled", "candidate_absent", "interviewer_absent"}]
        selected = _number_choice(question, items)
        if not selected:
            matches = [item for item in items if _norm(question) in _norm(item.get("candidate_name"))]
            selected = matches[0] if len(matches) == 1 else None
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one interview:", items, lambda item: f"{_text(item.get('candidate_name'))} — {_format_datetime(item.get('scheduled_at'))}")}
        data = {"interview_id": str(selected.get("_id")), "label": f"{_text(selected.get('candidate_name'))} — {_text(selected.get('round_label'))}"}
        save_pending_action(user_context, "recruitment_reschedule_interview", data, "scheduled_at")
        return {"handled": True, "answer": "What is the new interview date and time?"}
    if step == "scheduled_at":
        value = _parse_interview_datetime(question)
        if not value or value <= datetime.now() + timedelta(minutes=5):
            return {"handled": True, "answer": "Please provide a valid future date and time."}
        data["scheduled_at"] = value.isoformat()
        save_pending_action(user_context, "recruitment_reschedule_interview", data, "reason")
        return {"handled": True, "answer": "Please provide the reason for rescheduling."}
    if step == "reason":
        value = _text(question)[:3000]
        if len(value) < 3:
            return {"handled": True, "answer": "A rescheduling reason is required."}
        data["reason"] = value
        save_pending_action(user_context, "recruitment_reschedule_interview", data, "confirm")
        return {"handled": True, "answer": f"Review: reschedule {data.get('label')} to {_format_datetime(data.get('scheduled_at'))}. Reason: {value}. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": "Please reply Yes to confirm the interview reschedule, or Cancel to stop."}
        try:
            item = _service(user_context).reschedule_interview(data.get("interview_id"), {"scheduled_at": data.get("scheduled_at"), "reason": data.get("reason")})
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not reschedule the interview safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": f"Interview rescheduled successfully to {_format_datetime(item.get('scheduled_at'))}."}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete interview-reschedule action was cleared safely."}


# ---------------------------------------------------------------------------
# Joining/onboarding document, background-check, status and conversion actions
# ---------------------------------------------------------------------------


def _joining_application_candidates(user_context=None):
    statuses = {"offer_accepted", "documents_pending", "ready_to_join", "joining_deferred"}
    return _applications("", user_context, statuses=statuses, limit=50)


def _joining_doc_start(question="", user_context=None):
    selected, items = _resolve_application(question, user_context, statuses={"offer_accepted", "documents_pending", "ready_to_join", "joining_deferred"})
    if not selected:
        save_pending_action(user_context, "recruitment_review_joining_document", {}, "candidate")
        return {"handled": True, "answer": _list_choices("Which candidate's joining document do you want to review?", items, _application_label) if items else "Which candidate's joining document do you want to review?"}
    data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
    try:
        docs = _service(user_context).list_joining_documents(data["application_id"])
    except Exception as exc:
        return {"handled": True, "answer": _safe_error(exc)}
    pending_docs = [doc for doc in docs if _role_key(doc.get("status")) not in {"accepted", "not_required"}]
    if not pending_docs:
        return {"handled": True, "answer": "No joining document currently requires review for this candidate."}
    data["documents"] = [{"id": str(doc.get("_id")), "label": _text(doc.get("document_label") or doc.get("document_key")), "status": _text(doc.get("status"))} for doc in pending_docs]
    save_pending_action(user_context, "recruitment_review_joining_document", data, "document")
    return {"handled": True, "answer": _list_choices("Which document do you want to review?", data["documents"], lambda item: f"{item['label']} — {item['status'].replace('_', ' ').title()}")}


def _joining_doc_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The joining-document review has been cancelled."}
    if step == "candidate":
        items = _applications(_text(question), user_context, statuses={"offer_accepted", "documents_pending", "ready_to_join", "joining_deferred"}, limit=20)
        selected = _number_choice(question, items) or (items[0] if len(items) == 1 else None)
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one candidate:", items, _application_label) if items else "I could not find that candidate in the joining workflow."}
        data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
        docs = _service(user_context).list_joining_documents(data["application_id"])
        pending_docs = [doc for doc in docs if _role_key(doc.get("status")) not in {"accepted", "not_required"}]
        if not pending_docs:
            clear_pending_action(user_context)
            return {"handled": True, "answer": "No joining document currently requires review for this candidate."}
        data["documents"] = [{"id": str(doc.get("_id")), "label": _text(doc.get("document_label") or doc.get("document_key")), "status": _text(doc.get("status"))} for doc in pending_docs]
        save_pending_action(user_context, "recruitment_review_joining_document", data, "document")
        return {"handled": True, "answer": _list_choices("Which document do you want to review?", data["documents"], lambda item: f"{item['label']} — {item['status'].replace('_', ' ').title()}")}
    if step == "document":
        docs = data.get("documents") or []
        selected = _number_choice(question, docs)
        if not selected:
            matches = [item for item in docs if _norm(question) in _norm(item.get("label"))]
            selected = matches[0] if len(matches) == 1 else None
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one joining document:", docs, lambda item: item.get("label"))}
        data["document_id"] = selected["id"]
        data["document_label"] = selected["label"]
        save_pending_action(user_context, "recruitment_review_joining_document", data, "status")
        return {"handled": True, "answer": "Mark this document as Accepted, Rejected, Needs Correction, Pending, or Not Required?"}
    if step == "status":
        clean = _role_key(question)
        aliases = {"accept": "accepted", "accepted": "accepted", "reject": "rejected", "rejected": "rejected", "needs_correction": "needs_correction", "correction": "needs_correction", "pending": "pending", "not_required": "not_required"}
        status = aliases.get(clean, clean)
        if status not in DOCUMENT_STATUSES:
            return {"handled": True, "answer": "Please choose Accepted, Rejected, Needs Correction, Pending, or Not Required."}
        data["status"] = status
        next_step = "reason" if status in {"rejected", "needs_correction"} else "confirm"
        save_pending_action(user_context, "recruitment_review_joining_document", data, next_step)
        if next_step == "reason":
            return {"handled": True, "answer": "Please provide the review reason/instructions for the candidate."}
        return {"handled": True, "answer": f"Review: mark {data.get('document_label')} as {status.replace('_', ' ')}. Reply Yes to confirm or Cancel to stop."}
    if step == "reason":
        reason = _text(question)[:5000]
        if len(reason) < 3:
            return {"handled": True, "answer": "A written reason is required."}
        data["reason"] = reason
        save_pending_action(user_context, "recruitment_review_joining_document", data, "confirm")
        return {"handled": True, "answer": f"Review: mark {data.get('document_label')} as {data.get('status', '').replace('_', ' ')}. Reason: {reason}. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": "Please reply Yes to confirm the document review, or Cancel to stop."}
        try:
            result = _service(user_context).review_joining_document(data.get("document_id"), data.get("status"), reason=data.get("reason", ""))
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not review the joining document safely.")}
        clear_pending_action(user_context)
        readiness = result.get("readiness") or {}
        extra = " The candidate is now ready to join." if readiness.get("ready_to_join") else ""
        return {"handled": True, "answer": f"Joining document updated successfully.{extra}"}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete joining-document action was cleared safely."}


def _background_start(question="", user_context=None):
    selected, items = _resolve_application(question, user_context, statuses={"offer_accepted", "documents_pending", "ready_to_join", "joining_deferred"})
    if not selected:
        save_pending_action(user_context, "recruitment_update_background_check", {}, "candidate")
        return {"handled": True, "answer": _list_choices("Which candidate's background check do you want to update?", items, _application_label) if items else "Which candidate's background check do you want to update?"}
    data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
    save_pending_action(user_context, "recruitment_update_background_check", data, "check_type")
    return {"handled": True, "answer": "Which background-check type are you updating (for example Identity, Employment, Education, or Reference)?"}


def _background_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The background-check update has been cancelled."}
    if step == "candidate":
        items = _applications(_text(question), user_context, statuses={"offer_accepted", "documents_pending", "ready_to_join", "joining_deferred"}, limit=20)
        selected = _number_choice(question, items) or (items[0] if len(items) == 1 else None)
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one candidate:", items, _application_label) if items else "I could not find that candidate in the joining workflow."}
        data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
        save_pending_action(user_context, "recruitment_update_background_check", data, "check_type")
        return {"handled": True, "answer": "Which background-check type are you updating?"}
    if step == "check_type":
        value = _role_key(question)
        if not value:
            return {"handled": True, "answer": "Please provide the background-check type."}
        data["check_type"] = value
        save_pending_action(user_context, "recruitment_update_background_check", data, "status")
        return {"handled": True, "answer": "What is the result: Pending, Clear, Clarification Required, Not Clear, or Not Required?"}
    if step == "status":
        clean = _role_key(question)
        aliases = {"clarification": "clarification_required", "needs_clarification": "clarification_required", "not_clear": "not_clear", "clear": "clear", "pending": "pending", "not_required": "not_required"}
        status = aliases.get(clean, clean)
        if status not in BACKGROUND_CHECK_STATUSES:
            return {"handled": True, "answer": "Please choose Pending, Clear, Clarification Required, Not Clear, or Not Required."}
        data["status"] = status
        if status in {"clear", "clarification_required", "not_clear"}:
            save_pending_action(user_context, "recruitment_update_background_check", data, "consent")
            return {"handled": True, "answer": "Has the candidate's consent for this background check been recorded? Reply Yes or No."}
        save_pending_action(user_context, "recruitment_update_background_check", data, "summary")
        return {"handled": True, "answer": "Add a result summary/note, or reply Skip."}
    if step == "consent":
        if _yes(question):
            data["consent_received"] = True
        elif _no(question):
            data["consent_received"] = False
        else:
            return {"handled": True, "answer": "Please reply Yes or No."}
        save_pending_action(user_context, "recruitment_update_background_check", data, "summary")
        return {"handled": True, "answer": "Add a result summary/note, or reply Skip."}
    if step == "summary":
        if not _skip(question):
            data["result_summary"] = _text(question)[:5000]
        save_pending_action(user_context, "recruitment_update_background_check", data, "confirm")
        return {"handled": True, "answer": f"Review: mark {data.get('check_type', '').replace('_', ' ')} check for {data.get('label')} as {data.get('status', '').replace('_', ' ')}. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": "Please reply Yes to confirm the background-check update, or Cancel to stop."}
        payload = {
            "check_type": data.get("check_type"),
            "status": data.get("status"),
            "consent_received": bool(data.get("consent_received")),
            "result_summary": data.get("result_summary", ""),
        }
        try:
            result = _service(user_context).update_background_check(data.get("application_id"), payload)
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not update the background check safely.")}
        clear_pending_action(user_context)
        readiness = result.get("readiness") or {}
        extra = " The candidate is now ready to join." if readiness.get("ready_to_join") else ""
        return {"handled": True, "answer": f"Background check updated successfully.{extra}"}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete background-check action was cleared safely."}


def _joining_status_start(question="", user_context=None):
    selected, items = _resolve_application(question, user_context, statuses={"offer_accepted", "documents_pending", "ready_to_join", "joining_deferred"})
    if not selected:
        save_pending_action(user_context, "recruitment_change_joining_status", {}, "candidate")
        return {"handled": True, "answer": _list_choices("Which candidate's joining status do you want to update?", items, _application_label) if items else "Which candidate's joining status do you want to update?"}
    data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
    save_pending_action(user_context, "recruitment_change_joining_status", data, "status")
    return {"handled": True, "answer": "Set the joining status to Documents Pending, Ready to Join, Joining Deferred, or Did Not Join?"}


def _joining_status_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The joining-status update has been cancelled."}
    if step == "candidate":
        items = _applications(_text(question), user_context, statuses={"offer_accepted", "documents_pending", "ready_to_join", "joining_deferred"}, limit=20)
        selected = _number_choice(question, items) or (items[0] if len(items) == 1 else None)
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one candidate:", items, _application_label) if items else "I could not find that candidate in the joining workflow."}
        data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
        save_pending_action(user_context, "recruitment_change_joining_status", data, "status")
        return {"handled": True, "answer": "Set the joining status to Documents Pending, Ready to Join, Joining Deferred, or Did Not Join?"}
    if step == "status":
        clean = _role_key(question)
        aliases = {"documents": "documents_pending", "documents_pending": "documents_pending", "ready": "ready_to_join", "ready_to_join": "ready_to_join", "deferred": "joining_deferred", "joining_deferred": "joining_deferred", "did_not_join": "did_not_join", "not_joined": "did_not_join"}
        status = aliases.get(clean, clean)
        allowed = {"documents_pending", "ready_to_join", "joining_deferred", "did_not_join"}
        if status not in allowed:
            return {"handled": True, "answer": "Please choose Documents Pending, Ready to Join, Joining Deferred, or Did Not Join."}
        data["status"] = status
        if status in {"joining_deferred", "did_not_join"}:
            save_pending_action(user_context, "recruitment_change_joining_status", data, "reason")
            return {"handled": True, "answer": "Please provide the written reason."}
        save_pending_action(user_context, "recruitment_change_joining_status", data, "joining_date")
        return {"handled": True, "answer": "Provide the planned joining date (YYYY-MM-DD), or reply Skip to leave it unchanged."}
    if step == "reason":
        value = _text(question)[:3000]
        if len(value) < 3:
            return {"handled": True, "answer": "A written reason is required."}
        data["reason"] = value
        save_pending_action(user_context, "recruitment_change_joining_status", data, "joining_date")
        return {"handled": True, "answer": "Provide the joining date (YYYY-MM-DD), or reply Skip."}
    if step == "joining_date":
        if not _skip(question):
            parsed = _parse_date_value(question)
            if not parsed:
                return {"handled": True, "answer": "Please provide a valid date such as 2026-09-15, or reply Skip."}
            data["joining_date"] = parsed.isoformat()
        save_pending_action(user_context, "recruitment_change_joining_status", data, "confirm")
        return {"handled": True, "answer": f"Review: set {data.get('label')} to {data.get('status', '').replace('_', ' ').title()}." + (f" Reason: {data.get('reason')}" if data.get("reason") else "") + " Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": "Please reply Yes to confirm the joining-status update, or Cancel to stop."}
        try:
            item = _service(user_context).change_joining_status(
                data.get("application_id"), data.get("status"),
                reason=data.get("reason", ""), joining_date=data.get("joining_date", ""),
            )
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not update the joining status safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": f"Joining status updated successfully to {_text(item.get('status')).replace('_', ' ').title()}."}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete joining-status action was cleared safely."}


def _convert_start(question="", user_context=None):
    selected, items = _resolve_application(question, user_context, statuses={"ready_to_join"})
    if not selected:
        save_pending_action(user_context, "recruitment_convert_candidate_to_employee", {}, "candidate")
        return {"handled": True, "answer": _list_choices("Which Ready-to-Join candidate do you want to convert to an employee?", items, _application_label) if items else "There are no Ready-to-Join candidates in your authorised scope."}
    data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
    save_pending_action(user_context, "recruitment_convert_candidate_to_employee", data, "confirm")
    return {"handled": True, "answer": f"High-impact action: converting {data['label']} will create the employee/user records and onboarding tasks. To proceed, reply exactly: CONFIRM CONVERT. Reply Cancel to stop."}


def _convert_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "Candidate-to-employee conversion has been cancelled."}
    if step == "candidate":
        items = _applications(_text(question), user_context, statuses={"ready_to_join"}, limit=20)
        selected = _number_choice(question, items) or (items[0] if len(items) == 1 else None)
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one Ready-to-Join candidate:", items, _application_label) if items else "No Ready-to-Join candidate matched that request."}
        data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
        save_pending_action(user_context, "recruitment_convert_candidate_to_employee", data, "confirm")
        return {"handled": True, "answer": f"High-impact action: converting {data['label']} will create the employee/user records and onboarding tasks. To proceed, reply exactly: CONFIRM CONVERT. Reply Cancel to stop."}
    if step == "confirm":
        if _norm(question) != "confirm convert":
            return {"handled": True, "answer": "For this high-impact action, reply exactly CONFIRM CONVERT to proceed, or Cancel to stop."}
        try:
            result = _service(user_context).convert_candidate_to_employee(data.get("application_id"), {})
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not convert the candidate to an employee safely.")}
        clear_pending_action(user_context)
        employee = result.get("employee") or {}
        name = _text(employee.get("employee_name") or employee.get("name") or data.get("label"))
        code = _text(employee.get("employee_code") or employee.get("emp_code"))
        already = bool(result.get("already_converted"))
        if already:
            return {"handled": True, "answer": f"{name} was already converted to an employee" + (f" ({code})" if code else "") + ". No duplicate employee was created."}
        return {"handled": True, "answer": f"{name} was converted to an employee successfully" + (f" with employee code {code}" if code else "") + ". The canonical recruitment workflow also created the onboarding tasks."}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete candidate-conversion action was cleared safely."}



# ---------------------------------------------------------------------------
# Additional recruitment lifecycle actions: candidates, jobs, screening,
# interview status/feedback, offers. These are kept here so this plugin is the
# single HR/recruitment action module and does not need repeated edits later.
# ---------------------------------------------------------------------------


def _job_openings(user_context=None, statuses=None, limit=50):
    result = _service(user_context).list_job_openings(page=1, page_size=min(100, limit))
    items = list(result.get("items") or [])
    if statuses:
        allowed = {_role_key(item) for item in statuses}
        items = [item for item in items if _role_key(item.get("status")) in allowed]
    return items


def _job_label(item):
    return " — ".join(filter(None, [
        _text(item.get("reference_no")), _text(item.get("job_title")),
        _text(item.get("department")), _text(item.get("status")).replace("_", " ").title(),
    ]))


def _match_item(text, items, fields):
    numbered = _number_choice(text, items)
    if numbered:
        return numbered
    clean = _norm(text)
    matches = []
    for item in items:
        if any(_norm(item.get(field)) and _norm(item.get(field)) in clean for field in fields):
            matches.append(item)
    return matches[0] if len(matches) == 1 else None


def _create_job_start(question="", user_context=None):
    try:
        requests = _hiring_request_candidates(user_context, statuses={"approved"})
    except Exception as exc:
        return {"handled": True, "answer": _safe_error(exc)}
    if not requests:
        return {"handled": True, "answer": "No finally approved hiring request is currently available to create a job opening."}
    selected = _match_hiring(question, requests)
    if not selected:
        save_pending_action(user_context, "recruitment_create_job_opening", {}, "request")
        return {"handled": True, "answer": _list_choices("Which approved hiring request should become a job opening?", requests, _hiring_label)}
    data = {"hiring_request_id": str(selected.get("_id")), "label": _hiring_label(selected)}
    save_pending_action(user_context, "recruitment_create_job_opening", data, "description")
    return {"handled": True, "answer": "Please provide the job description."}


def _create_job_continue(pending=None, question="", user_context=None):
    pending = pending or {}
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    if _cancel(question):
        clear_pending_action(user_context)
        return {"handled": True, "answer": "The job-opening creation has been cancelled."}
    if step == "request":
        requests = _hiring_request_candidates(user_context, statuses={"approved"})
        selected = _match_hiring(question, requests)
        if not selected:
            return {"handled": True, "answer": _list_choices("Please choose one approved hiring request:", requests, _hiring_label)}
        data = {"hiring_request_id": str(selected.get("_id")), "label": _hiring_label(selected)}
        save_pending_action(user_context, "recruitment_create_job_opening", data, "description")
        return {"handled": True, "answer": "Please provide the job description."}
    if step == "description":
        value = _text(question)[:12000]
        if len(value) < 10:
            return {"handled": True, "answer": "Please provide a meaningful job description."}
        data["description"] = value
        save_pending_action(user_context, "recruitment_create_job_opening", data, "closing_date")
        return {"handled": True, "answer": "Provide the application closing date (YYYY-MM-DD), or reply Skip for no closing date."}
    if step == "closing_date":
        if not _skip(question):
            parsed = _parse_date_value(question)
            if not parsed or parsed < date.today():
                return {"handled": True, "answer": "Please provide a valid closing date that is today or later, or reply Skip."}
            data["closing_date"] = parsed.isoformat()
        save_pending_action(user_context, "recruitment_create_job_opening", data, "work_mode")
        return {"handled": True, "answer": "What is the work mode: Office, Hybrid, or Remote? Reply Skip for Office."}
    if step == "work_mode":
        if _skip(question):
            mode = "office"
        else:
            clean = _role_key(question)
            aliases = {"in_office": "office", "onsite": "office", "work_from_home": "remote", "wfh": "remote"}
            mode = aliases.get(clean, clean)
        if mode not in {"office", "hybrid", "remote"}:
            return {"handled": True, "answer": "Please choose Office, Hybrid, or Remote."}
        data["work_mode"] = mode
        save_pending_action(user_context, "recruitment_create_job_opening", data, "confirm")
        return {"handled": True, "answer": f"Review: create a draft job opening from {data.get('label')} with work mode {mode.title()}. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question):
            return {"handled": True, "answer": "Please reply Yes to create the draft job opening, or Cancel to stop."}
        try:
            item = _service(user_context).create_job_opening({
                "hiring_request_id": data.get("hiring_request_id"),
                "description": data.get("description"),
                "closing_date": data.get("closing_date", ""),
                "work_mode": data.get("work_mode", "office"),
            })
        except Exception as exc:
            return {"handled": True, "answer": _safe_error(exc, "I could not create the job opening safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": f"Job opening {_text(item.get('reference_no'))} was created successfully as a draft. It is not public until an authorised HR publisher opens it."}
    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete job-opening action was cleared safely."}


def _job_status_start(question="", user_context=None):
    try:
        items = _job_openings(user_context, statuses={"draft", "open", "paused"}, limit=50)
    except Exception as exc:
        return {"handled": True, "answer": _safe_error(exc)}
    if not items:
        return {"handled": True, "answer": "No active/draft job opening is available for a status change."}
    selected = _match_item(question, items, ("reference_no", "job_title", "department"))
    if not selected:
        save_pending_action(user_context, "recruitment_change_job_opening_status", {}, "job")
        return {"handled": True, "answer": _list_choices("Which job opening do you want to update?", items, _job_label)}
    data = {"job_id": str(selected.get("_id")), "label": _job_label(selected), "current_status": _role_key(selected.get("status"))}
    save_pending_action(user_context, "recruitment_change_job_opening_status", data, "status")
    allowed = JOB_OPENING_TRANSITIONS.get(data["current_status"], set())
    return {"handled": True, "answer": "Choose the new status: " + ", ".join(item.title() for item in sorted(allowed)) + "."}


def _job_status_continue(pending=None, question="", user_context=None):
    pending = pending or {}; data = dict(pending.get("data") or {}); step = _text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled": True, "answer": "The job-opening status change has been cancelled."}
    if step == "job":
        items = _job_openings(user_context, statuses={"draft", "open", "paused"}, limit=50)
        selected = _match_item(question, items, ("reference_no", "job_title", "department"))
        if not selected: return {"handled": True, "answer": _list_choices("Please choose one job opening:", items, _job_label)}
        data = {"job_id": str(selected.get("_id")), "label": _job_label(selected), "current_status": _role_key(selected.get("status"))}
        save_pending_action(user_context, "recruitment_change_job_opening_status", data, "status")
        return {"handled": True, "answer": "Choose the new status: " + ", ".join(item.title() for item in sorted(JOB_OPENING_TRANSITIONS.get(data["current_status"], set()))) + "."}
    if step == "status":
        target = _role_key(question)
        aliases = {"publish": "open", "published": "open", "pause": "paused", "close": "closed", "cancel": "cancelled"}
        target = aliases.get(target, target)
        if target not in JOB_OPENING_TRANSITIONS.get(data.get("current_status"), set()):
            return {"handled": True, "answer": "That is not a valid next status. Allowed: " + ", ".join(item.title() for item in sorted(JOB_OPENING_TRANSITIONS.get(data.get("current_status"), set()))) + "."}
        data["target_status"] = target
        save_pending_action(user_context, "recruitment_change_job_opening_status", data, "reason")
        return {"handled": True, "answer": "Add a reason/note for this status change, or reply Skip."}
    if step == "reason":
        if not _skip(question): data["reason"] = _text(question)[:3000]
        save_pending_action(user_context, "recruitment_change_job_opening_status", data, "confirm")
        return {"handled": True, "answer": f"Review: move {data.get('label')} to {data.get('target_status', '').title()}. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question): return {"handled": True, "answer": "Please reply Yes to confirm the job-opening status change, or Cancel to stop."}
        try:
            channels = ["career_page"] if data.get("target_status") == "open" else None
            item = _service(user_context).change_job_status(data.get("job_id"), data.get("target_status"), channels=channels, reason=data.get("reason", ""))
        except Exception as exc: return {"handled": True, "answer": _safe_error(exc, "I could not update the job opening safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": f"Job opening {_text(item.get('reference_no'))} is now {_text(item.get('status')).replace('_', ' ').title()}."}
    clear_pending_action(user_context); return {"handled": True, "answer": "The incomplete job-opening status action was cleared safely."}


def _candidate_create_start(question="", user_context=None):
    data = {}
    save_pending_action(user_context, "recruitment_create_candidate", data, "name")
    return {"handled": True, "answer": "What is the candidate's full name?"}


def _candidate_create_continue(pending=None, question="", user_context=None):
    pending = pending or {}; data = dict(pending.get("data") or {}); step = _text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled": True, "answer": "Candidate creation has been cancelled."}
    if step == "name":
        value = _text(question)[:200]
        if len(value) < 2: return {"handled": True, "answer": "Please provide the candidate's full name."}
        data["full_name"] = value; save_pending_action(user_context, "recruitment_create_candidate", data, "contact")
        return {"handled": True, "answer": "Provide the candidate's email or phone number."}
    if step == "contact":
        value = _text(question)[:250]
        if "@" in value: data["email"] = value
        else:
            digits = re.sub(r"\D", "", value)
            if len(digits) < 7: return {"handled": True, "answer": "Please provide a valid email address or phone number."}
            data["phone"] = value
        save_pending_action(user_context, "recruitment_create_candidate", data, "designation")
        return {"handled": True, "answer": "Provide the candidate's current designation, or reply Skip."}
    if step == "designation":
        if not _skip(question): data["current_designation"] = _text(question)[:200]
        save_pending_action(user_context, "recruitment_create_candidate", data, "skills")
        return {"handled": True, "answer": "List key skills separated by commas, or reply Skip."}
    if step == "skills":
        if not _skip(question): data["skills"] = [x.strip() for x in _text(question).split(",") if x.strip()][:30]
        save_pending_action(user_context, "recruitment_create_candidate", data, "confirm")
        return {"handled": True, "answer": f"Review: create candidate {data.get('full_name')} with contact {data.get('email') or data.get('phone')}. No resume will be attached through this text action. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question): return {"handled": True, "answer": "Please reply Yes to create the candidate, or Cancel to stop."}
        try: item = _service(user_context).create_candidate(data)
        except Exception as exc: return {"handled": True, "answer": _safe_error(exc, "I could not create the candidate safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": f"Candidate {_text(item.get('reference_no'))} — {_text(item.get('full_name'))} — was created successfully. A resume can still be uploaded through the recruitment screen when required."}
    clear_pending_action(user_context); return {"handled": True, "answer": "The incomplete candidate action was cleared safely."}


def _application_create_start(question="", user_context=None):
    try: candidates = _service(user_context).list_candidates(search=_extract_candidate_hint(question), page=1, page_size=20).get("items") or []
    except Exception as exc: return {"handled": True, "answer": _safe_error(exc)}
    selected = _match_item(question, candidates, ("reference_no", "full_name", "email", "phone"))
    if not selected:
        save_pending_action(user_context, "recruitment_create_application", {}, "candidate")
        return {"handled": True, "answer": _list_choices("Which candidate should be linked to a job opening?", candidates, lambda i: f"{_text(i.get('full_name'))} — {_text(i.get('reference_no'))}") if candidates else "Which candidate should be linked to a job opening?"}
    data = {"candidate_id": str(selected.get("_id")), "candidate_label": _text(selected.get("full_name"))}
    save_pending_action(user_context, "recruitment_create_application", data, "job")
    jobs = _job_openings(user_context, statuses={"open", "draft", "paused"}, limit=30)
    return {"handled": True, "answer": _list_choices("Which job opening is this application for?", jobs, _job_label)}


def _application_create_continue(pending=None, question="", user_context=None):
    pending = pending or {}; data = dict(pending.get("data") or {}); step = _text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled": True, "answer": "Application creation has been cancelled."}
    if step == "candidate":
        items = _service(user_context).list_candidates(search=_text(question), page=1, page_size=20).get("items") or []
        selected = _number_choice(question, items) or (items[0] if len(items) == 1 else None)
        if not selected: return {"handled": True, "answer": _list_choices("Please choose one candidate:", items, lambda i: f"{_text(i.get('full_name'))} — {_text(i.get('reference_no'))}") if items else "I could not find that candidate."}
        data = {"candidate_id": str(selected.get("_id")), "candidate_label": _text(selected.get("full_name"))}
        save_pending_action(user_context, "recruitment_create_application", data, "job")
        return {"handled": True, "answer": _list_choices("Which job opening is this application for?", _job_openings(user_context, statuses={"open", "draft", "paused"}, limit=30), _job_label)}
    if step == "job":
        jobs = _job_openings(user_context, statuses={"open", "draft", "paused"}, limit=30)
        selected = _match_item(question, jobs, ("reference_no", "job_title", "department"))
        if not selected: return {"handled": True, "answer": _list_choices("Please choose one job opening:", jobs, _job_label)}
        data["job_opening_id"] = str(selected.get("_id")); data["job_label"] = _job_label(selected)
        save_pending_action(user_context, "recruitment_create_application", data, "confirm")
        return {"handled": True, "answer": f"Review: create an application for {data.get('candidate_label')} against {data.get('job_label')}. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question): return {"handled": True, "answer": "Please reply Yes to create the application, or Cancel to stop."}
        try: item = _service(user_context).create_application({"candidate_id": data.get("candidate_id"), "job_opening_id": data.get("job_opening_id"), "source": "manual"})
        except Exception as exc: return {"handled": True, "answer": _safe_error(exc, "I could not create the application safely.")}
        clear_pending_action(user_context)
        return {"handled": True, "answer": f"Application {_text(item.get('reference_no'))} was created successfully for {_text(item.get('candidate_name'))}."}
    clear_pending_action(user_context); return {"handled": True, "answer": "The incomplete application action was cleared safely."}


def _screening_start(question="", user_context=None):
    selected, items = _resolve_application(question, user_context, statuses={"applied", "under_review"})
    if not selected:
        save_pending_action(user_context, "recruitment_screen_candidate", {}, "candidate")
        return {"handled": True, "answer": _list_choices("Which candidate application do you want to screen?", items, _application_label) if items else "Which candidate application do you want to screen?"}
    data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}
    save_pending_action(user_context, "recruitment_screen_candidate", data, "outcome")
    return {"handled": True, "answer": "Choose the screening outcome: Shortlisted, Under Review, On Hold, or Rejected."}


def _screening_continue(pending=None, question="", user_context=None):
    pending = pending or {}; data = dict(pending.get("data") or {}); step = _text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled": True, "answer": "Candidate screening has been cancelled."}
    if step == "candidate":
        items = _applications(_text(question), user_context, statuses={"applied", "under_review"}, limit=20)
        selected = _number_choice(question, items) or (items[0] if len(items) == 1 else None)
        if not selected: return {"handled": True, "answer": _list_choices("Please choose one application:", items, _application_label) if items else "I could not find an application awaiting screening."}
        data = {"application_id": str(selected.get("_id")), "label": _application_label(selected)}; save_pending_action(user_context, "recruitment_screen_candidate", data, "outcome")
        return {"handled": True, "answer": "Choose the screening outcome: Shortlisted, Under Review, On Hold, or Rejected."}
    if step == "outcome":
        clean = _role_key(question); aliases={"shortlist":"shortlisted","review":"under_review","hold":"on_hold","reject":"rejected"}; outcome=aliases.get(clean,clean)
        if outcome not in {"shortlisted","under_review","on_hold","rejected"}: return {"handled": True, "answer": "Please choose Shortlisted, Under Review, On Hold, or Rejected."}
        data["outcome"] = outcome; next_step="reason" if outcome in {"on_hold","rejected"} else "notes"; save_pending_action(user_context,"recruitment_screen_candidate",data,next_step)
        return {"handled": True, "answer": "Please provide the written reason." if next_step=="reason" else "Add screening notes, or reply Skip."}
    if step == "reason":
        value=_text(question)[:5000]
        if len(value)<3: return {"handled": True, "answer": "A written reason is required."}
        data["reason"]=value; save_pending_action(user_context,"recruitment_screen_candidate",data,"notes"); return {"handled": True,"answer":"Add screening notes, or reply Skip."}
    if step == "notes":
        if not _skip(question): data["notes"]=_text(question)[:10000]
        save_pending_action(user_context,"recruitment_screen_candidate",data,"confirm"); return {"handled": True,"answer":f"Review: mark {data.get('label')} as {data.get('outcome','').replace('_',' ').title()}. Reply Yes to confirm or Cancel to stop."}
    if step == "confirm":
        if not _yes(question): return {"handled": True,"answer":"Please reply Yes to confirm the screening outcome, or Cancel to stop."}
        try: item=_service(user_context).update_screening(data.get("application_id"),{"outcome":data.get("outcome"),"reason":data.get("reason", ""),"notes":data.get("notes", "")})
        except Exception as exc: return {"handled": True,"answer":_safe_error(exc,"I could not update candidate screening safely.")}
        clear_pending_action(user_context); return {"handled": True,"answer":f"Candidate screening updated successfully to {_text(item.get('status')).replace('_',' ').title()}."}
    clear_pending_action(user_context); return {"handled": True,"answer":"The incomplete screening action was cleared safely."}


def _eligible_interviews(user_context=None, statuses=None):
    result = _service(user_context).list_interviews(page=1, page_size=50)
    items = list(result.get("items") or [])
    if statuses:
        allowed={_role_key(x) for x in statuses}; items=[x for x in items if _role_key(x.get("status")) in allowed]
    return items


def _interview_label(item):
    return f"{_text(item.get('candidate_name'))} — {_text(item.get('round_label') or item.get('round_key'))} — {_format_datetime(item.get('scheduled_at'))} — {_text(item.get('status')).replace('_',' ').title()}"


def _interview_status_start(question="", user_context=None):
    items=_eligible_interviews(user_context, statuses={"scheduled","rescheduled","candidate_absent","interviewer_absent"})
    if not items: return {"handled": True,"answer":"No interview in your authorised scope is currently eligible for a status update."}
    selected=_match_item(question,items,("candidate_name","reference_no","round_label"))
    if not selected:
        save_pending_action(user_context,"recruitment_change_interview_status",{},"interview"); return {"handled":True,"answer":_list_choices("Which interview do you want to update?",items,_interview_label)}
    data={"interview_id":str(selected.get("_id")),"label":_interview_label(selected),"current_status":_role_key(selected.get("status"))}; save_pending_action(user_context,"recruitment_change_interview_status",data,"status")
    return {"handled":True,"answer":"Choose the new interview status: Completed, Cancelled, Candidate Absent, or Interviewer Absent."}


def _interview_status_continue(pending=None,question="",user_context=None):
    pending=pending or {}; data=dict(pending.get("data") or {}); step=_text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled":True,"answer":"The interview-status update has been cancelled."}
    if step=="interview":
        items=_eligible_interviews(user_context,statuses={"scheduled","rescheduled","candidate_absent","interviewer_absent"}); selected=_match_item(question,items,("candidate_name","reference_no","round_label"))
        if not selected: return {"handled":True,"answer":_list_choices("Please choose one interview:",items,_interview_label)}
        data={"interview_id":str(selected.get("_id")),"label":_interview_label(selected),"current_status":_role_key(selected.get("status"))}; save_pending_action(user_context,"recruitment_change_interview_status",data,"status"); return {"handled":True,"answer":"Choose Completed, Cancelled, Candidate Absent, or Interviewer Absent."}
    if step=="status":
        clean=_role_key(question); aliases={"complete":"completed","completed":"completed","cancel":"cancelled","cancelled":"cancelled","candidate_absent":"candidate_absent","interviewer_absent":"interviewer_absent"}; target=aliases.get(clean,clean)
        if target not in INTERVIEW_TRANSITIONS.get(data.get("current_status"),set()): return {"handled":True,"answer":"That is not a valid next interview status."}
        data["target_status"]=target; next_step="reason" if target in {"cancelled","candidate_absent","interviewer_absent"} else "confirm"; save_pending_action(user_context,"recruitment_change_interview_status",data,next_step)
        return {"handled":True,"answer":"Please provide the written reason." if next_step=="reason" else f"Review: mark {data.get('label')} as Completed. Reply Yes to confirm or Cancel to stop."}
    if step=="reason":
        value=_text(question)[:3000]
        if len(value)<3: return {"handled":True,"answer":"A written reason is required."}
        data["reason"]=value; save_pending_action(user_context,"recruitment_change_interview_status",data,"confirm"); return {"handled":True,"answer":f"Review: mark {data.get('label')} as {data.get('target_status','').replace('_',' ').title()}. Reason: {value}. Reply Yes to confirm or Cancel to stop."}
    if step=="confirm":
        if not _yes(question): return {"handled":True,"answer":"Please reply Yes to confirm the interview-status update, or Cancel to stop."}
        try: item=_service(user_context).change_interview_status(data.get("interview_id"),data.get("target_status"),reason=data.get("reason", ""))
        except Exception as exc: return {"handled":True,"answer":_safe_error(exc,"I could not update the interview status safely.")}
        clear_pending_action(user_context); return {"handled":True,"answer":f"Interview status updated successfully to {_text(item.get('status')).replace('_',' ').title()}."}
    clear_pending_action(user_context); return {"handled":True,"answer":"The incomplete interview-status action was cleared safely."}


def _feedback_start(question="", user_context=None):
    items=_eligible_interviews(user_context,statuses={"completed"})
    actor=_actor_id(user_context)
    items=[i for i in items if actor in [str(x) for x in (i.get("interviewer_user_ids") or [])]]
    if not items: return {"handled":True,"answer":"No completed interview currently requires feedback from your signed-in interviewer account."}
    selected=_match_item(question,items,("candidate_name","reference_no","round_label"))
    if not selected:
        save_pending_action(user_context,"recruitment_submit_interview_feedback",{},"interview"); return {"handled":True,"answer":_list_choices("Which completed interview do you want to submit feedback for?",items,_interview_label)}
    data={"interview_id":str(selected.get("_id")),"label":_interview_label(selected)}; settings=_service(user_context).get_settings(); areas=settings.get("feedback_required_areas") or []
    data["areas"]=areas; data["ratings"]={}; first=areas[0] if areas else "overall"; save_pending_action(user_context,"recruitment_submit_interview_feedback",data,f"rating:{first}")
    return {"handled":True,"answer":f"Rate {first.replace('_',' ')} from {settings.get('feedback_rating_min',1)} to {settings.get('feedback_rating_max',5)}."}


def _feedback_continue(pending=None,question="",user_context=None):
    pending=pending or {}; data=dict(pending.get("data") or {}); step=_text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled":True,"answer":"Interview feedback has been cancelled."}
    if step=="interview":
        items=_eligible_interviews(user_context,statuses={"completed"}); actor=_actor_id(user_context); items=[i for i in items if actor in [str(x) for x in (i.get("interviewer_user_ids") or [])]]; selected=_match_item(question,items,("candidate_name","reference_no","round_label"))
        if not selected: return {"handled":True,"answer":_list_choices("Please choose one completed interview:",items,_interview_label)}
        data={"interview_id":str(selected.get("_id")),"label":_interview_label(selected)}; settings=_service(user_context).get_settings(); areas=settings.get("feedback_required_areas") or []; data["areas"]=areas; data["ratings"]={}; first=areas[0] if areas else "overall"; save_pending_action(user_context,"recruitment_submit_interview_feedback",data,f"rating:{first}"); return {"handled":True,"answer":f"Rate {first.replace('_',' ')} from {settings.get('feedback_rating_min',1)} to {settings.get('feedback_rating_max',5)}."}
    if step.startswith("rating:"):
        area=step.split(":",1)[1]; settings=_service(user_context).get_settings(); lo=int(settings.get("feedback_rating_min") or 1); hi=int(settings.get("feedback_rating_max") or 5)
        try: score=float(_text(question))
        except Exception: score=0
        if score<lo or score>hi: return {"handled":True,"answer":f"Please provide a rating between {lo} and {hi}."}
        data.setdefault("ratings",{})[area]=score; areas=data.get("areas") or []; idx=areas.index(area) if area in areas else len(areas)-1
        if idx+1<len(areas): nxt=areas[idx+1]; save_pending_action(user_context,"recruitment_submit_interview_feedback",data,f"rating:{nxt}"); return {"handled":True,"answer":f"Rate {nxt.replace('_',' ')} from {lo} to {hi}."}
        save_pending_action(user_context,"recruitment_submit_interview_feedback",data,"recommendation"); return {"handled":True,"answer":"Choose the final recommendation: Strong Hire, Hire, Hold, or Reject."}
    if step=="recommendation":
        clean=_role_key(question); aliases={"strong":"strong_hire","strong_hire":"strong_hire","hire":"hire","hold":"hold","reject":"reject"}; rec=aliases.get(clean,clean)
        if rec not in RECOMMENDATIONS: return {"handled":True,"answer":"Please choose Strong Hire, Hire, Hold, or Reject."}
        data["recommendation"]=rec; save_pending_action(user_context,"recruitment_submit_interview_feedback",data,"comments"); return {"handled":True,"answer":"Please provide written interview feedback/comments."}
    if step=="comments":
        value=_text(question)[:15000]
        if len(value)<3: return {"handled":True,"answer":"Written feedback is required."}
        data["comments"]=value; save_pending_action(user_context,"recruitment_submit_interview_feedback",data,"strengths"); return {"handled":True,"answer":"List key strengths, or reply Skip."}
    if step=="strengths":
        if not _skip(question): data["strengths"]=_text(question)[:5000]
        save_pending_action(user_context,"recruitment_submit_interview_feedback",data,"concerns"); return {"handled":True,"answer":"List any concerns, or reply Skip."}
    if step=="concerns":
        if not _skip(question): data["concerns"]=_text(question)[:5000]
        save_pending_action(user_context,"recruitment_submit_interview_feedback",data,"confirm"); return {"handled":True,"answer":f"Review feedback for {data.get('label')}: recommendation {data.get('recommendation','').replace('_',' ').title()}. Reply Yes to submit or Cancel to stop."}
    if step=="confirm":
        if not _yes(question): return {"handled":True,"answer":"Please reply Yes to submit the interview feedback, or Cancel to stop."}
        try: item=_service(user_context).submit_interview_feedback(data.get("interview_id"),{"ratings":data.get("ratings",{}),"recommendation":data.get("recommendation"),"comments":data.get("comments"),"strengths":data.get("strengths", ""),"concerns":data.get("concerns", "")})
        except Exception as exc: return {"handled":True,"answer":_safe_error(exc,"I could not submit the interview feedback safely.")}
        clear_pending_action(user_context); return {"handled":True,"answer":f"Interview feedback submitted successfully with recommendation {_text(item.get('recommendation')).replace('_',' ').title()}."}
    clear_pending_action(user_context); return {"handled":True,"answer":"The incomplete interview-feedback action was cleared safely."}


def _complete_interview_process_start(question="",user_context=None):
    selected,items=_resolve_application(question,user_context,statuses={"interviewed"})
    if not selected:
        save_pending_action(user_context,"recruitment_complete_interview_process",{},"candidate"); return {"handled":True,"answer":_list_choices("Which interviewed candidate's interview process should be completed?",items,_application_label) if items else "No interviewed candidate is currently available."}
    data={"application_id":str(selected.get("_id")),"label":_application_label(selected)}; save_pending_action(user_context,"recruitment_complete_interview_process",data,"confirm"); return {"handled":True,"answer":f"Review: complete the full interview process for {data.get('label')}. Saya will let the recruitment service verify all configured rounds and feedback. Reply Yes to confirm or Cancel to stop."}


def _complete_interview_process_continue(pending=None,question="",user_context=None):
    pending=pending or {}; data=dict(pending.get("data") or {}); step=_text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled":True,"answer":"Completing the interview process has been cancelled."}
    if step=="candidate":
        items=_applications(_text(question),user_context,statuses={"interviewed"},limit=20); selected=_number_choice(question,items) or (items[0] if len(items)==1 else None)
        if not selected: return {"handled":True,"answer":_list_choices("Please choose one interviewed candidate:",items,_application_label) if items else "No interviewed candidate matched."}
        data={"application_id":str(selected.get("_id")),"label":_application_label(selected)}; save_pending_action(user_context,"recruitment_complete_interview_process",data,"confirm"); return {"handled":True,"answer":f"Review: complete the full interview process for {data.get('label')}. Reply Yes to confirm or Cancel to stop."}
    if step=="confirm":
        if not _yes(question): return {"handled":True,"answer":"Please reply Yes to complete the interview process, or Cancel to stop."}
        try: item=_service(user_context).complete_interview_process(data.get("application_id"))
        except Exception as exc: return {"handled":True,"answer":_safe_error(exc,"I could not complete the interview process safely.")}
        clear_pending_action(user_context); return {"handled":True,"answer":f"Interview process completed successfully for {_text(item.get('candidate_name') or data.get('label'))}."}
    clear_pending_action(user_context); return {"handled":True,"answer":"The incomplete interview-process action was cleared safely."}


def _offer_items(user_context=None,statuses=None):
    result=_service(user_context).list_offers(page=1,page_size=50); items=list(result.get("items") or [])
    if statuses: allowed={_role_key(x) for x in statuses}; items=[i for i in items if _role_key(i.get("status")) in allowed]
    return items


def _offer_label(item):
    return f"{_text(item.get('reference_no'))} — {_text(item.get('candidate_name'))} — {_text(item.get('job_title'))} — {_text(item.get('status')).replace('_',' ').title()}"


def _offer_create_start(question="",user_context=None):
    selected,items=_resolve_application(question,user_context,statuses={"selected","offer_pending","offer_expired"})
    items=[i for i in items if i.get("interview_process_completed") is True]
    if selected and selected.get("interview_process_completed") is not True: selected=None
    if not selected:
        save_pending_action(user_context,"recruitment_create_offer",{},"candidate"); return {"handled":True,"answer":_list_choices("Which selected candidate with a completed interview process should receive an offer draft?",items,_application_label) if items else "No selected candidate with a completed interview process is currently ready for an offer."}
    data={"application_id":str(selected.get("_id")),"label":_application_label(selected),"designation":_text(selected.get("job_title")),"department":_text(selected.get("department"))}; save_pending_action(user_context,"recruitment_create_offer",data,"joining_date"); return {"handled":True,"answer":"What is the proposed joining date?"}


def _offer_create_continue(pending=None,question="",user_context=None):
    pending=pending or {}; data=dict(pending.get("data") or {}); step=_text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled":True,"answer":"Offer creation has been cancelled."}
    if step=="candidate":
        items=_applications(_text(question),user_context,statuses={"selected","offer_pending","offer_expired"},limit=20); items=[i for i in items if i.get("interview_process_completed") is True]; selected=_number_choice(question,items) or (items[0] if len(items)==1 else None)
        if not selected: return {"handled":True,"answer":_list_choices("Please choose one eligible selected candidate:",items,_application_label) if items else "No eligible selected candidate matched."}
        data={"application_id":str(selected.get("_id")),"label":_application_label(selected),"designation":_text(selected.get("job_title")),"department":_text(selected.get("department"))}; save_pending_action(user_context,"recruitment_create_offer",data,"joining_date"); return {"handled":True,"answer":"What is the proposed joining date?"}
    if step=="joining_date":
        parsed=_parse_date_value(question)
        if not parsed or parsed<date.today(): return {"handled":True,"answer":"Please provide a valid future joining date."}
        data["joining_date"]=parsed.isoformat(); save_pending_action(user_context,"recruitment_create_offer",data,"response_deadline"); return {"handled":True,"answer":"What is the candidate's offer response deadline?"}
    if step=="response_deadline":
        parsed=_parse_date_value(question)
        if not parsed or parsed<date.today(): return {"handled":True,"answer":"Please provide a valid response deadline that is today or later."}
        if parsed.isoformat()>data.get("joining_date",""): return {"handled":True,"answer":"The response deadline cannot be after the proposed joining date."}
        data["response_deadline"]=parsed.isoformat(); save_pending_action(user_context,"recruitment_create_offer",data,"salary_summary"); return {"handled":True,"answer":"Provide the approved salary summary exactly as it should appear in the offer (for example Annual CTC ₹6,00,000)."}
    if step=="salary_summary":
        value=_text(question)[:2000]
        if len(value)<3: return {"handled":True,"answer":"Approved salary details are required before an offer can be prepared."}
        data["salary_summary"]=value; save_pending_action(user_context,"recruitment_create_offer",data,"work_location"); return {"handled":True,"answer":"Provide the work location, or reply Skip."}
    if step=="work_location":
        if not _skip(question): data["work_location"]=_text(question)[:300]
        save_pending_action(user_context,"recruitment_create_offer",data,"employment_type"); return {"handled":True,"answer":"What is the employment type? Reply Skip for Permanent."}
    if step=="employment_type":
        data["employment_type"]="permanent" if _skip(question) else _role_key(question); save_pending_action(user_context,"recruitment_create_offer",data,"probation"); return {"handled":True,"answer":"Provide the probation period (for example 6 months), or reply Skip."}
    if step=="probation":
        if not _skip(question): data["probation_period"]=_text(question)[:100]
        save_pending_action(user_context,"recruitment_create_offer",data,"message"); return {"handled":True,"answer":"Add an offer message, or reply Skip."}
    if step=="message":
        if not _skip(question): data["offer_message"]=_text(question)[:10000]
        save_pending_action(user_context,"recruitment_create_offer",data,"confirm"); return {"handled":True,"answer":f"Sensitive compensation action: prepare an offer draft for {data.get('label')} with salary summary '{data.get('salary_summary')}', joining {data.get('joining_date')}, response deadline {data.get('response_deadline')}. Reply exactly CONFIRM OFFER DRAFT to proceed, or Cancel to stop."}
    if step=="confirm":
        if _norm(question)!="confirm offer draft": return {"handled":True,"answer":"For this compensation action, reply exactly CONFIRM OFFER DRAFT to proceed, or Cancel to stop."}
        payload={k:data.get(k) for k in ("designation","department","joining_date","response_deadline","salary_summary","work_location","employment_type","probation_period","offer_message")}; payload["currency"]="INR"
        try: item=_service(user_context).create_offer(data.get("application_id"),payload)
        except Exception as exc: return {"handled":True,"answer":_safe_error(exc,"I could not create the offer draft safely.")}
        clear_pending_action(user_context); return {"handled":True,"answer":f"Offer {_text(item.get('reference_no'))} was prepared successfully as a draft. It has not been sent to the candidate."}
    clear_pending_action(user_context); return {"handled":True,"answer":"The incomplete offer action was cleared safely."}


def _offer_submit_start(question="",user_context=None):
    items=_offer_items(user_context,statuses={"draft"})
    if not items: return {"handled":True,"answer":"No draft offer is currently ready for approval submission."}
    selected=_match_item(question,items,("reference_no","candidate_name","job_title"))
    if not selected: save_pending_action(user_context,"recruitment_submit_offer_for_approval",{},"offer"); return {"handled":True,"answer":_list_choices("Which offer should be submitted for approval?",items,_offer_label)}
    data={"offer_id":str(selected.get("_id")),"label":_offer_label(selected)}; save_pending_action(user_context,"recruitment_submit_offer_for_approval",data,"confirm"); return {"handled":True,"answer":f"Review: submit {data.get('label')} to the configured salary/offer approvers. Reply Yes to confirm or Cancel to stop."}


def _offer_submit_continue(pending=None,question="",user_context=None):
    pending=pending or {}; data=dict(pending.get("data") or {}); step=_text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled":True,"answer":"Offer approval submission has been cancelled."}
    if step=="offer":
        items=_offer_items(user_context,statuses={"draft"}); selected=_match_item(question,items,("reference_no","candidate_name","job_title"))
        if not selected: return {"handled":True,"answer":_list_choices("Please choose one draft offer:",items,_offer_label)}
        data={"offer_id":str(selected.get("_id")),"label":_offer_label(selected)}; save_pending_action(user_context,"recruitment_submit_offer_for_approval",data,"confirm"); return {"handled":True,"answer":f"Review: submit {data.get('label')} to configured approvers. Reply Yes to confirm or Cancel to stop."}
    if step=="confirm":
        if not _yes(question): return {"handled":True,"answer":"Please reply Yes to submit the offer for approval, or Cancel to stop."}
        try: item=_service(user_context).submit_offer_for_approval(data.get("offer_id"))
        except Exception as exc: return {"handled":True,"answer":_safe_error(exc,"I could not submit the offer for approval safely.")}
        clear_pending_action(user_context); return {"handled":True,"answer":f"Offer {_text(item.get('reference_no'))} was submitted successfully for approval."}
    clear_pending_action(user_context); return {"handled":True,"answer":"The incomplete offer approval action was cleared safely."}


def _offer_decision_access(user_context=None):
    if not _tenant_id(user_context) or not _actor_id(user_context): return "I cannot verify your organisation and user context."
    if _roles(user_context).intersection(OFFER_APPROVAL_ROLES): return ""
    # An explicitly assigned approver may not have a generic role; RecruitmentService
    # will re-check the exact offer approval_user_ids at execution time.
    return "Offer approval is available only to authorised Finance/Admin/HR approvers."


def _offer_decide_start(question="",user_context=None):
    if any(x in _norm(question) for x in ("approve all","reject all","bulk approve","bulk reject")): return {"handled":True,"answer":"For safety, Saya does not bulk-decide offers. Please decide one offer at a time."}
    items=_offer_items(user_context,statuses={"approval_pending"})
    if not items: return {"handled":True,"answer":"No offer is currently pending approval in your authorised scope."}
    selected=_match_item(question,items,("reference_no","candidate_name","job_title")); decision=_decision(question)
    if not selected: save_pending_action(user_context,"recruitment_decide_offer",{},"offer"); return {"handled":True,"answer":_list_choices("Which offer do you want to decide?",items,_offer_label)}
    data={"offer_id":str(selected.get("_id")),"label":_offer_label(selected),"decision":decision}; step="reason" if decision=="rejected" else ("confirm" if decision=="approved" else "decision"); save_pending_action(user_context,"recruitment_decide_offer",data,step)
    return {"handled":True,"answer":"Please provide the rejection reason." if step=="reason" else (f"Review: approve {data.get('label')}. Reply Yes to confirm or Cancel to stop." if step=="confirm" else "Would you like to approve or reject this offer?")}


def _offer_decide_continue(pending=None,question="",user_context=None):
    pending=pending or {}; data=dict(pending.get("data") or {}); step=_text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled":True,"answer":"Offer decision has been cancelled."}
    if step=="offer":
        items=_offer_items(user_context,statuses={"approval_pending"}); selected=_match_item(question,items,("reference_no","candidate_name","job_title"))
        if not selected: return {"handled":True,"answer":_list_choices("Please choose one pending offer:",items,_offer_label)}
        data={"offer_id":str(selected.get("_id")),"label":_offer_label(selected)}; save_pending_action(user_context,"recruitment_decide_offer",data,"decision"); return {"handled":True,"answer":"Would you like to approve or reject this offer?"}
    if step=="decision":
        decision=_decision(question)
        if not decision: return {"handled":True,"answer":"Please reply Approve or Reject."}
        data["decision"]=decision; next_step="reason" if decision=="rejected" else "confirm"; save_pending_action(user_context,"recruitment_decide_offer",data,next_step); return {"handled":True,"answer":"Please provide the rejection reason." if next_step=="reason" else f"Review: approve {data.get('label')}. Reply Yes to confirm or Cancel to stop."}
    if step=="reason":
        reason=_text(question)[:3000]
        if len(reason)<3: return {"handled":True,"answer":"A written rejection reason is required."}
        data["reason"]=reason; save_pending_action(user_context,"recruitment_decide_offer",data,"confirm"); return {"handled":True,"answer":f"Review: reject {data.get('label')}. Reason: {reason}. Reply Yes to confirm or Cancel to stop."}
    if step=="confirm":
        if not _yes(question): return {"handled":True,"answer":"Please reply Yes to confirm the offer decision, or Cancel to stop."}
        try: item=_service(user_context).decide_offer(data.get("offer_id"),data.get("decision"),reason=data.get("reason", ""))
        except Exception as exc: return {"handled":True,"answer":_safe_error(exc,"I could not complete the offer decision safely.")}
        clear_pending_action(user_context); return {"handled":True,"answer":f"Offer {_text(item.get('reference_no'))} is now {_text(item.get('status')).replace('_',' ').title()}."}
    clear_pending_action(user_context); return {"handled":True,"answer":"The incomplete offer-decision action was cleared safely."}


def _offer_send_start(question="",user_context=None):
    items=_offer_items(user_context,statuses={"approved"})
    if not items: return {"handled":True,"answer":"No approved offer is currently ready to send."}
    selected=_match_item(question,items,("reference_no","candidate_name","job_title"))
    if not selected: save_pending_action(user_context,"recruitment_send_offer",{},"offer"); return {"handled":True,"answer":_list_choices("Which approved offer do you want to send to the candidate?",items,_offer_label)}
    data={"offer_id":str(selected.get("_id")),"label":_offer_label(selected)}; save_pending_action(user_context,"recruitment_send_offer",data,"confirm"); return {"handled":True,"answer":f"High-impact external communication: this will email/send {data.get('label')} to the candidate and create the response token. Reply exactly CONFIRM SEND OFFER to proceed, or Cancel to stop."}


def _offer_send_continue(pending=None,question="",user_context=None):
    pending=pending or {}; data=dict(pending.get("data") or {}); step=_text(pending.get("current_step"))
    if _cancel(question): clear_pending_action(user_context); return {"handled":True,"answer":"Offer sending has been cancelled."}
    if step=="offer":
        items=_offer_items(user_context,statuses={"approved"}); selected=_match_item(question,items,("reference_no","candidate_name","job_title"))
        if not selected: return {"handled":True,"answer":_list_choices("Please choose one approved offer:",items,_offer_label)}
        data={"offer_id":str(selected.get("_id")),"label":_offer_label(selected)}; save_pending_action(user_context,"recruitment_send_offer",data,"confirm"); return {"handled":True,"answer":f"High-impact external communication: reply exactly CONFIRM SEND OFFER to send {data.get('label')}, or Cancel to stop."}
    if step=="confirm":
        if _norm(question)!="confirm send offer": return {"handled":True,"answer":"For this external communication, reply exactly CONFIRM SEND OFFER to proceed, or Cancel to stop."}
        try:
            base=_text(current_app.config.get("FRONTEND_URL") or current_app.config.get("PUBLIC_FRONTEND_URL") or current_app.config.get("APP_URL")).rstrip("/")
        except Exception: base=""
        offer_url=f"{base}/careers/offers/{{token}}" if base else ""
        try: result=_service(user_context).send_offer(data.get("offer_id"),offer_url=offer_url)
        except Exception as exc: return {"handled":True,"answer":_safe_error(exc,"I could not send the offer safely.")}
        clear_pending_action(user_context); offer=result.get("offer") or {}; email=(result.get("email_result") or {}).get("ok"); suffix=" Candidate email delivery was requested through the configured recruitment email service." if email else " The offer status was updated, but the configured email service did not confirm delivery; HR should verify the candidate communication."
        return {"handled":True,"answer":f"Offer {_text(offer.get('reference_no'))} was marked Sent successfully.{suffix}"}
    clear_pending_action(user_context); return {"handled":True,"answer":"The incomplete offer-send action was cleared safely."}

# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

register_saya_action(
    "hr_workforce_overview",
    {
        "label": "HR Workforce Overview",
        "module": "HR",
        "kind": "read",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": False,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_workforce_start,
    access_handler=_hr_access,
    intent_phrases=[
        "workforce overview", "hr workforce overview", "employee headcount",
        "how many active employees", "employees on probation", "probation ending this month",
        "probation ends this month", "confirmation due this month",
    ],
)

register_saya_action(
    "recruitment_dashboard_summary",
    {
        "label": "Recruitment Dashboard Summary",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "read",
        "scope": "recruitment_authorised",
        "requires_tenant": True,
        "requires_confirmation": False,
        "allowed_roles": sorted(RECRUITMENT_READ_ROLES),
    },
    start_handler=_recruitment_dashboard_start,
    access_handler=_recruitment_reader_access,
    intent_phrases=[
        "recruitment dashboard", "recruitment overview", "hiring overview",
        "recruitment status", "recruitment summary",
    ],
)

register_saya_action(
    "recruitment_candidate_pipeline",
    {
        "label": "Candidate Pipeline",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "read",
        "scope": "recruitment_authorised",
        "requires_tenant": True,
        "requires_confirmation": False,
        "allowed_roles": sorted(RECRUITMENT_READ_ROLES),
    },
    start_handler=_pipeline_start,
    access_handler=_recruitment_reader_access,
    intent_phrases=[
        "candidate pipeline", "recruitment pipeline", "application pipeline",
        "show candidates by stage", "recent applications", "candidate stages",
    ],
)

register_saya_action(
    "recruitment_interview_schedule_view",
    {
        "label": "Recruitment Interview Schedule",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "read",
        "scope": "recruitment_authorised",
        "requires_tenant": True,
        "requires_confirmation": False,
        "allowed_roles": sorted(RECRUITMENT_READ_ROLES),
    },
    start_handler=_interviews_start,
    access_handler=_recruitment_reader_access,
    intent_phrases=[
        "show interviews", "interviews today", "upcoming interviews",
        "interview schedule", "recruitment interviews",
    ],
)

register_saya_action(
    "hr_onboarding_overview",
    {
        "label": "Onboarding Overview",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "read",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": False,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_onboarding_start,
    access_handler=_hr_access,
    intent_phrases=[
        "onboarding overview", "who has not completed onboarding", "pending onboarding",
        "incomplete onboarding", "onboarding tasks", "onboarding status",
    ],
)

register_saya_action(
    "hr_leave_approval_queue",
    {
        "label": "HR Leave Approval Queue",
        "module": "Leave",
        "module_key": "apply_leave",
        "kind": "read",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": False,
        "allowed_roles": sorted(ADMIN_HR_ROLES),
    },
    start_handler=_hr_leave_queue_start,
    access_handler=_hr_access,
    intent_phrases=[
        "hr leave approvals", "leave approvals pending with hr", "pending hr leave approvals",
        "hr approval queue", "show hr leave queue",
    ],
)

register_saya_action(
    "hr_decide_leave",
    {
        "label": "Approve / Reject HR-Stage Leave",
        "module": "Leave",
        "module_key": "apply_leave",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(ADMIN_HR_ROLES),
    },
    start_handler=_hr_leave_decision_start,
    continue_handler=_hr_leave_decision_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "hr approve leave", "hr reject leave", "approve leave as hr", "reject leave as hr",
        "final approve leave", "final leave approval",
    ],
)

register_saya_action(
    "recruitment_create_hiring_request",
    {
        "label": "Create Hiring Request",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "authorised_hiring_request_creator",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES | {"team_leader"}),
    },
    start_handler=_create_hiring_start,
    continue_handler=_create_hiring_continue,
    access_handler=_hiring_creator_access,
    intent_phrases=[
        "create hiring request", "new hiring request", "raise hiring request",
        "need to hire", "request new position", "request new vacancy",
    ],
)

register_saya_action(
    "recruitment_submit_hiring_request",
    {
        "label": "Submit Hiring Request for Approval",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "authorised_hiring_request_creator",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES | {"team_leader"}),
    },
    start_handler=_submit_hiring_start,
    continue_handler=_submit_hiring_continue,
    access_handler=_hiring_creator_access,
    intent_phrases=[
        "submit hiring request", "send hiring request for approval",
        "submit vacancy request", "submit recruitment request",
    ],
)

register_saya_action(
    "recruitment_decide_hiring_request",
    {
        "label": "Final Hiring Request Decision",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "final_hiring_approver",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(FINAL_HIRING_ROLES),
    },
    start_handler=_final_hiring_start,
    continue_handler=_final_hiring_continue,
    access_handler=_final_hiring_access,
    intent_phrases=[
        "approve hiring request", "reject hiring request", "final hiring approval",
        "return hiring request", "hold hiring request",
    ],
)

register_saya_action(
    "recruitment_update_application_stage",
    {
        "label": "Update Candidate Stage",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_application_stage_start,
    continue_handler=_application_stage_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "update candidate stage", "move candidate to", "shortlist candidate",
        "reject candidate", "put candidate on hold", "change application status",
    ],
)

register_saya_action(
    "recruitment_schedule_interview",
    {
        "label": "Schedule Candidate Interview",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_schedule_interview_start,
    continue_handler=_schedule_interview_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "schedule interview", "schedule candidate interview", "create interview",
        "book interview", "arrange interview",
    ],
)

register_saya_action(
    "recruitment_reschedule_interview",
    {
        "label": "Reschedule Candidate Interview",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_reschedule_interview_start,
    continue_handler=_reschedule_interview_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "reschedule interview", "change interview time", "move interview to",
    ],
)

register_saya_action(
    "recruitment_review_joining_document",
    {
        "label": "Review Joining Document",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_joining_doc_start,
    continue_handler=_joining_doc_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "review joining document", "accept joining document", "reject joining document",
        "joining document correction", "verify joining document",
    ],
)

register_saya_action(
    "recruitment_update_background_check",
    {
        "label": "Update Background Check",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_background_start,
    continue_handler=_background_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "update background check", "background verification", "mark background check",
        "candidate background check",
    ],
)

register_saya_action(
    "recruitment_change_joining_status",
    {
        "label": "Change Candidate Joining Status",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_joining_status_start,
    continue_handler=_joining_status_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "change joining status", "mark candidate ready to join", "joining deferred",
        "candidate did not join", "documents pending candidate",
    ],
)

register_saya_action(
    "recruitment_convert_candidate_to_employee",
    {
        "label": "Convert Candidate to Employee",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr_high_impact",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_convert_start,
    continue_handler=_convert_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "convert candidate to employee", "create employee from candidate",
        "onboard candidate as employee", "make candidate employee",
    ],
)

# Additional lifecycle registrations -------------------------------------------------

register_saya_action(
    "recruitment_create_job_opening",
    {
        "label": "Create Job Opening",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr_publisher",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(set(HR_PUBLISH_ROLES)),
    },
    start_handler=_create_job_start,
    continue_handler=_create_job_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "create job opening", "create vacancy", "create job from hiring request",
        "open approved vacancy", "prepare job opening",
    ],
)

register_saya_action(
    "recruitment_change_job_opening_status",
    {
        "label": "Publish / Pause / Close Job Opening",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr_publisher",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(set(HR_PUBLISH_ROLES)),
    },
    start_handler=_job_status_start,
    continue_handler=_job_status_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "publish job opening", "open job vacancy", "pause job opening",
        "close job opening", "cancel job opening", "change job opening status",
    ],
)

register_saya_action(
    "recruitment_create_candidate",
    {
        "label": "Create Candidate",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_candidate_create_start,
    continue_handler=_candidate_create_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "create candidate", "add candidate", "new candidate",
        "register candidate", "add applicant",
    ],
)

register_saya_action(
    "recruitment_create_application",
    {
        "label": "Create Candidate Application",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_application_create_start,
    continue_handler=_application_create_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "create application for candidate", "link candidate to job",
        "apply candidate to job", "add candidate application",
    ],
)

register_saya_action(
    "recruitment_screen_candidate",
    {
        "label": "Screen Candidate",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_screening_start,
    continue_handler=_screening_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "screen candidate", "candidate screening", "shortlist after screening",
        "screen this applicant", "update screening outcome",
    ],
)

register_saya_action(
    "recruitment_change_interview_status",
    {
        "label": "Update Interview Status",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "authorised_interview",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(RECRUITMENT_READ_ROLES),
    },
    start_handler=_interview_status_start,
    continue_handler=_interview_status_continue,
    access_handler=_recruitment_reader_access,
    intent_phrases=[
        "mark interview completed", "complete interview", "cancel interview",
        "candidate absent interview", "interviewer absent", "update interview status",
    ],
)

register_saya_action(
    "recruitment_submit_interview_feedback",
    {
        "label": "Submit Interview Feedback",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "assigned_interviewer",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(RECRUITMENT_READ_ROLES),
    },
    start_handler=_feedback_start,
    continue_handler=_feedback_continue,
    access_handler=_recruitment_reader_access,
    intent_phrases=[
        "submit interview feedback", "give interview feedback", "record interview feedback",
        "interview recommendation", "candidate interview feedback",
    ],
)

register_saya_action(
    "recruitment_complete_interview_process",
    {
        "label": "Complete Interview Process",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_complete_interview_process_start,
    continue_handler=_complete_interview_process_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "complete interview process", "finish interview process", "close interview rounds",
        "complete all interview rounds",
    ],
)

register_saya_action(
    "recruitment_create_offer",
    {
        "label": "Prepare Offer Draft",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr_sensitive",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_offer_create_start,
    continue_handler=_offer_create_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "create offer", "prepare offer", "draft offer",
        "create candidate offer", "prepare salary offer",
    ],
)

register_saya_action(
    "recruitment_submit_offer_for_approval",
    {
        "label": "Submit Offer for Approval",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr_sensitive",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_offer_submit_start,
    continue_handler=_offer_submit_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "submit offer for approval", "send offer for approval",
        "request offer approval", "salary offer approval",
    ],
)

register_saya_action(
    "recruitment_decide_offer",
    {
        "label": "Approve / Reject Offer",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "offer_approver",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(OFFER_APPROVAL_ROLES),
    },
    start_handler=_offer_decide_start,
    continue_handler=_offer_decide_continue,
    access_handler=_offer_decision_access,
    intent_phrases=[
        "approve offer", "reject offer", "offer approval decision",
        "approve salary offer", "reject salary offer",
    ],
)

register_saya_action(
    "recruitment_send_offer",
    {
        "label": "Send Approved Offer",
        "module": "Recruitment",
        "module_key": "recruitment",
        "kind": "write",
        "scope": "tenant_hr_external_communication",
        "requires_tenant": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(HR_ROLES),
    },
    start_handler=_offer_send_start,
    continue_handler=_offer_send_continue,
    access_handler=_hr_access,
    intent_phrases=[
        "send offer to candidate", "send approved offer", "email candidate offer",
        "issue offer letter", "send offer letter",
    ],
)
