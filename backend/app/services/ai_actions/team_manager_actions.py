"""
Saya Team Leader / Reporting Officer action plugin.

This module deliberately keeps language understanding separate from authority.
Every read/write is tenant-scoped and re-validates the signed-in manager's
mapped employee scope immediately before returning data or changing HRMS state.

The plugin is auto-discovered by app.services.ai_action_service.
"""

from datetime import datetime, date
import re

from bson import ObjectId

from app.extensions import get_db
from app.utils.auth import audit
from app.services.ai_action_service import (
    register_saya_action,
    save_pending_action,
    clear_pending_action,
)
from app.routes.workflow import (
    LEAVE_TYPES_WITH_BALANCE,
    approval_stage_update_fields,
    build_initial_leave_stage,
    create_leave_history_entry,
    deduct_leave_balance,
    employee_display_name,
    enrich_leave_request_doc,
    has_sufficient_leave_balance,
    leave_stage_label,
    leave_type_label,
    mark_compoff_used_if_needed,
    next_leave_stage,
    normalize_leave_type,
    notify_employee_leave_decision,
    notify_hr_leave_result,
    notify_next_leave_approvers,
    rollback_compoff_claim_if_needed,
)
from app.routes.attendance import (
    employee_display_name as attendance_employee_display_name,
    employee_user_id,
    next_approval_stage_after_team_leader,
    notify_users,
    scoped_employee_ids_for_manager,
)


MANAGER_ROLES = {
    "team_leader",
    "reporting_officer",
    "ro",
    "manager",
}

READ_LIMIT = 30
DISPLAY_LIMIT = 12


def _text(value):
    return str(value or "").strip()


def _norm(value):
    return re.sub(r"\s+", " ", _text(value).lower()).strip()


def _tenant_id(user_context=None):
    return _text((user_context or {}).get("tenant_id"))


def _roles(user_context=None):
    raw = (user_context or {}).get("roles") or []
    if isinstance(raw, str):
        raw = [item.strip() for item in raw.split(",") if item.strip()]
    result = {_norm(item).replace(" ", "_") for item in raw if _text(item)}
    role = _norm((user_context or {}).get("role")).replace(" ", "_")
    if role:
        result.add(role)
    if (user_context or {}).get("is_team_leader"):
        result.add("team_leader")
    if (user_context or {}).get("is_reporting_officer"):
        result.add("reporting_officer")
    return result


def _employee(user_context=None):
    employee = (user_context or {}).get("employee") or {}
    return employee if isinstance(employee, dict) else {}


def _manager_access(user_context=None):
    if not _tenant_id(user_context):
        return "I cannot verify your organisation context. Please sign in again and retry."
    if not _employee(user_context):
        return "I cannot verify your employee profile for manager scope. Please contact HR or your administrator."
    if not _roles(user_context).intersection(MANAGER_ROLES):
        return "This Team Leader / Reporting Officer function is not available for your current role."
    return ""


def _actor_id(user_context=None):
    return _text((user_context or {}).get("user_id") or (user_context or {}).get("_id"))


def _actor_name(user_context=None):
    return _text(
        (user_context or {}).get("display_name")
        or (user_context or {}).get("employee_name")
        or (user_context or {}).get("name")
        or (user_context or {}).get("email")
        or "Saya Manager"
    )


def _manager_identifiers(user_context=None):
    employee = _employee(user_context)
    raw = [
        employee.get("_id"),
        employee.get("id"),
        employee.get("employee_id"),
        employee.get("employee_code"),
        employee.get("emp_code"),
        employee.get("code"),
        employee.get("user_id"),
        employee.get("email"),
        employee.get("official_email"),
        (user_context or {}).get("employee_id"),
        (user_context or {}).get("user_id"),
        (user_context or {}).get("email"),
    ]
    result = []
    for value in raw:
        text = _text(value)
        if text and text not in result:
            result.append(text)
    return result


def _oid(value):
    try:
        text = _text(value)
        return ObjectId(text) if ObjectId.is_valid(text) else None
    except Exception:
        return None


def _today_iso():
    return date.today().isoformat()


def _decision_from_text(text):
    clean = _norm(text)
    reject_terms = ("reject", "decline", "deny", "not approve")
    approve_terms = ("approve", "accept", "allow")
    if any(term in clean for term in reject_terms):
        return "rejected"
    if any(term in clean for term in approve_terms):
        return "approved"
    return ""


def _is_yes(text):
    clean = _norm(text)
    return clean in {
        "yes", "y", "confirm", "confirmed", "proceed", "go ahead", "do it",
        "submit", "approve it", "reject it", "yes proceed", "yes confirm",
    }


def _is_no(text):
    clean = _norm(text)
    return clean in {"no", "n", "cancel", "stop", "do not", "don't", "dont"}


def _is_skip(text):
    return _norm(text) in {"skip", "none", "no note", "no reason", "default"}


def _bulk_request(text):
    clean = _norm(text)
    return any(phrase in clean for phrase in (
        "approve all", "reject all", "approve everyone", "reject everyone",
        "approve every", "reject every", "approve pending", "reject pending",
        "bulk approve", "bulk reject",
    ))


def _candidate_number(text, candidates):
    clean = _norm(text)
    match = re.search(r"(?:^|\b)(\d{1,2})(?:\b|$)", clean)
    if match:
        index = int(match.group(1)) - 1
        if 0 <= index < len(candidates):
            return candidates[index]
    return None


def _match_candidate(text, candidates):
    if not candidates:
        return None
    numbered = _candidate_number(text, candidates)
    if numbered:
        return numbered
    clean = _norm(text)
    if not clean:
        return None
    matches = []
    for item in candidates:
        fields = [
            item.get("id"), item.get("employee_name"), item.get("date"),
            item.get("from_date"), item.get("to_date"), item.get("mode"),
            item.get("type"), item.get("short_ref"),
        ]
        if any(_norm(field) and _norm(field) in clean for field in fields):
            matches.append(item)
    return matches[0] if len(matches) == 1 else None


def _manager_stage_or(user_context=None):
    identifiers = _manager_identifiers(user_context)
    roles = _roles(user_context)
    clauses = []
    if "team_leader" in roles:
        clauses.append({
            "approval_stage": "team_leader",
            "team_leader_id": {"$in": identifiers},
        })
    if roles.intersection({"reporting_officer", "ro", "manager"}):
        clauses.append({
            "approval_stage": "reporting_officer",
            "reporting_officer_id": {"$in": identifiers},
        })
    return clauses


def _scoped_leave_docs(user_context=None, limit=READ_LIMIT):
    db = get_db()
    tenant_id = _tenant_id(user_context)
    clauses = _manager_stage_or(user_context)
    if not tenant_id or not clauses:
        return []
    query = {
        "tenant_id": tenant_id,
        "status": {"$in": ["pending", "in_review"]},
        "is_deleted": {"$ne": True},
        "$or": clauses,
    }
    docs = list(db.leave_requests.find(query).sort("created_at", -1).limit(limit))
    return docs


def _scoped_request_docs(collection_name, user_context=None, limit=READ_LIMIT):
    db = get_db()
    tenant_id = _tenant_id(user_context)
    clauses = _manager_stage_or(user_context)
    if not tenant_id or not clauses:
        return []
    docs = list(
        db[collection_name]
        .find({
            "tenant_id": tenant_id,
            "status": "pending",
            "is_deleted": {"$ne": True},
            "$or": clauses,
        })
        .sort("created_at", -1)
        .limit(limit)
    )
    return docs


def _leave_candidates(user_context=None):
    result = []
    for doc in _scoped_leave_docs(user_context):
        item_id = str(doc.get("_id"))
        result.append({
            "id": item_id,
            "short_ref": item_id[-6:],
            "employee_name": _text(doc.get("employee_name") or doc.get("name") or "Employee"),
            "type": leave_type_label(normalize_leave_type(doc.get("leave_type"))),
            "from_date": _text(doc.get("from_date") or doc.get("start_date")),
            "to_date": _text(doc.get("to_date") or doc.get("end_date")),
            "date": _text(doc.get("from_date") or doc.get("start_date")),
            "stage": _text(doc.get("approval_stage")),
        })
    return result


def _mode_candidates(user_context=None):
    result = []
    for doc in _scoped_request_docs("attendance_mode_requests", user_context):
        item_id = str(doc.get("_id"))
        result.append({
            "id": item_id,
            "short_ref": item_id[-6:],
            "employee_name": _text(doc.get("employee_name") or "Employee"),
            "type": _text(doc.get("mode") or "attendance mode").upper(),
            "mode": _text(doc.get("mode")),
            "date": _text(doc.get("date")),
            "stage": _text(doc.get("approval_stage")),
            "field_location": _text(doc.get("field_location")),
        })
    return result


def _holiday_candidates(user_context=None):
    result = []
    for doc in _scoped_request_docs("holiday_work_requests", user_context):
        item_id = str(doc.get("_id"))
        result.append({
            "id": item_id,
            "short_ref": item_id[-6:],
            "employee_name": _text(doc.get("employee_name") or "Employee"),
            "type": "Holiday Work",
            "date": _text(doc.get("date")),
            "stage": _text(doc.get("approval_stage")),
        })
    return result


def _format_candidates(title, candidates):
    if not candidates:
        return f"{title}: there are no pending requests in your current approval scope."
    lines = [title]
    for index, item in enumerate(candidates[:DISPLAY_LIMIT], 1):
        detail = item.get("type") or "Request"
        date_text = item.get("date") or item.get("from_date") or "Date not recorded"
        if item.get("to_date") and item.get("to_date") != date_text:
            date_text = f"{date_text} to {item.get('to_date')}"
        lines.append(
            f"{index}. {item.get('employee_name') or 'Employee'} — {detail} — {date_text} — Ref {item.get('short_ref')}"
        )
    if len(candidates) > DISPLAY_LIMIT:
        lines.append(f"Showing {DISPLAY_LIMIT} of {len(candidates)} requests.")
    return "\n".join(lines)


def _pending_approvals_answer(user_context=None):
    leaves = _leave_candidates(user_context)
    modes = _mode_candidates(user_context)
    holidays = _holiday_candidates(user_context)
    total = len(leaves) + len(modes) + len(holidays)
    if total == 0:
        return "You currently have no pending leave, WFH/field-attendance, or holiday-work requests in your approval scope."
    lines = [f"You currently have {total} pending approval request{'s' if total != 1 else ''} in your scope."]
    if leaves:
        lines.append("")
        lines.append(_format_candidates("Leave requests", leaves))
    if modes:
        lines.append("")
        lines.append(_format_candidates("WFH / Field Attendance requests", modes))
    if holidays:
        lines.append("")
        lines.append(_format_candidates("Holiday Work requests", holidays))
    lines.append("")
    lines.append("Tell me the employee/request and whether you want to approve or reject it. I will ask for confirmation before making any change.")
    return "\n".join(lines)


def _read_pending_start(question="", user_context=None):
    return {"handled": True, "answer": _pending_approvals_answer(user_context)}


def _team_employee_ids(user_context=None):
    access = _manager_access(user_context)
    if access:
        return []
    try:
        return scoped_employee_ids_for_manager(get_db()) or []
    except Exception:
        return []


def _team_attendance_answer(question="", user_context=None):
    db = get_db()
    tenant_id = _tenant_id(user_context)
    ids = _team_employee_ids(user_context)
    if not tenant_id:
        return "I cannot verify your organisation scope."
    if not ids:
        return "I could not find employees mapped to your Team Leader / Reporting Officer scope."

    object_ids = [oid for oid in (_oid(value) for value in ids) if oid]
    employees = list(db.employees.find({
        "tenant_id": tenant_id,
        "_id": {"$in": object_ids},
        "is_deleted": {"$ne": True},
        "status": {"$ne": "Inactive"},
    }))
    employee_map = {str(item.get("_id")): item for item in employees}
    today = _today_iso()
    logs = list(db.attendance_logs.find({
        "tenant_id": tenant_id,
        "employee_id": {"$in": list(employee_map.keys())},
        "date": today,
        "is_deleted": {"$ne": True},
    }))
    log_map = {str(item.get("employee_id")): item for item in logs}

    present, absent, late, wfh, field, checked_out = [], [], [], [], [], []
    for emp_id, employee in employee_map.items():
        name = attendance_employee_display_name(employee)
        log = log_map.get(emp_id)
        if not log or not log.get("check_in"):
            absent.append(name)
            continue
        present.append(name)
        if log.get("is_late") or _norm(log.get("status")) == "late":
            late.append(name)
        mode = _norm(log.get("mode"))
        if mode == "wfh":
            wfh.append(name)
        elif mode == "field":
            field.append(name)
        if log.get("check_out"):
            checked_out.append(name)

    clean = _norm(question)
    targeted = None
    if "absent" in clean or "not checked in" in clean:
        targeted = ("Absent / not checked in", absent)
    elif "late" in clean:
        targeted = ("Late", late)
    elif "wfh" in clean or "work from home" in clean:
        targeted = ("WFH", wfh)
    elif "field" in clean:
        targeted = ("Field", field)

    lines = [
        f"Team attendance for {today}: {len(present)} checked in, {len(absent)} not checked in, {len(late)} late, {len(wfh)} WFH, and {len(field)} field attendance."
    ]
    if targeted is not None:
        label, names = targeted
        lines.append(f"{label}: " + (", ".join(names[:20]) if names else "None"))
    elif absent:
        lines.append("Not checked in: " + ", ".join(absent[:20]))
    return "\n".join(lines)


def _team_attendance_start(question="", user_context=None):
    return {"handled": True, "answer": _team_attendance_answer(question, user_context)}


def _manager_project_query(user_context=None):
    tenant_id = _tenant_id(user_context)
    manager_ids = _manager_identifiers(user_context)
    team_ids = _team_employee_ids(user_context)
    if not tenant_id or not manager_ids:
        return {"_id": {"$exists": False}}
    relation_or = [
        {"team_leader_id": {"$in": manager_ids}},
        {"reporting_officer_id": {"$in": manager_ids}},
        {"created_by_employee_id": {"$in": manager_ids}},
    ]
    if team_ids:
        relation_or.extend([
            {"assigned_to_id": {"$in": team_ids}},
            {"assigned_to_employee_id": {"$in": team_ids}},
            {"assigned_employee_id": {"$in": team_ids}},
            {"assigned_employee_ids": {"$in": team_ids}},
            {"assigned_to_ids": {"$in": team_ids}},
            {"assigned_members._id": {"$in": team_ids}},
            {"assigned_members.employee_id": {"$in": team_ids}},
            {"collaborator_ids": {"$in": team_ids}},
            {"collaborators._id": {"$in": team_ids}},
            {"collaborators.employee_id": {"$in": team_ids}},
        ])
    return {
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "$or": relation_or,
    }


def _project_overview_answer(question="", user_context=None):
    db = get_db()
    projects = list(db.projects.find(_manager_project_query(user_context)).sort("updated_at", -1).limit(50))
    if not projects:
        return "I could not find projects in your current Team Leader / Reporting Officer scope."
    today = _today_iso()
    active, on_hold, completed, overdue = [], [], [], []
    for project in projects:
        name = _text(project.get("name") or project.get("project_name") or project.get("title") or "Project")
        status = _norm(project.get("status") or "active").replace(" ", "_")
        due = _text(project.get("due_date") or project.get("end_date") or project.get("target_date"))
        progress = project.get("latest_progress")
        try:
            progress = int(float(progress)) if progress not in (None, "") else None
        except Exception:
            progress = None
        item = {"name": name, "status": status, "due": due, "progress": progress}
        if status == "completed":
            completed.append(item)
        elif status == "on_hold":
            on_hold.append(item)
        else:
            active.append(item)
        if due and due < today and status != "completed":
            overdue.append(item)

    clean = _norm(question)
    selected = overdue if any(term in clean for term in ("behind", "overdue", "late project", "delayed")) else projects
    lines = [
        f"Project overview: {len(active)} active, {len(on_hold)} on hold, {len(completed)} completed, and {len(overdue)} overdue in your current scope."
    ]
    if selected is overdue:
        if not overdue:
            lines.append("No overdue projects were found.")
        else:
            for item in overdue[:DISPLAY_LIMIT]:
                progress = f", {item['progress']}% progress" if item.get("progress") is not None else ""
                lines.append(f"- {item['name']} — due {item['due']}{progress}")
    else:
        for project in projects[:DISPLAY_LIMIT]:
            name = _text(project.get("name") or project.get("project_name") or project.get("title") or "Project")
            status = _text(project.get("status") or "active").replace("_", " ").title()
            progress = project.get("latest_progress")
            progress_text = f" — {progress}%" if progress not in (None, "") else ""
            lines.append(f"- {name} — {status}{progress_text}")
    return "\n".join(lines)


def _project_overview_start(question="", user_context=None):
    return {"handled": True, "answer": _project_overview_answer(question, user_context)}


def _safe_leave_by_id(request_id, user_context=None):
    oid = _oid(request_id)
    if not oid:
        return None
    for doc in _scoped_leave_docs(user_context, limit=200):
        if doc.get("_id") == oid:
            return doc
    return None


def _safe_request_by_id(collection_name, request_id, user_context=None):
    oid = _oid(request_id)
    if not oid:
        return None
    for doc in _scoped_request_docs(collection_name, user_context, limit=200):
        if doc.get("_id") == oid:
            return doc
    return None


def _decide_leave(request_id, decision, note, user_context=None):
    db = get_db()
    existing = _safe_leave_by_id(request_id, user_context)
    if not existing:
        raise ValueError("The leave request is no longer pending in your approval scope.")
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

    current_stage = existing.get("approval_stage") or build_initial_leave_stage(employee)
    now = datetime.utcnow()
    actor_id = _actor_id(user_context)
    actor_name = _actor_name(user_context)

    if decision == "rejected":
        rollback_compoff_claim_if_needed(db, existing)
        stage_fields = approval_stage_update_fields(current_stage, "rejected", note)
        db.leave_requests.update_one(
            {"_id": existing["_id"]},
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
        audit("saya_reject_leave", "leave_requests", request_id, {"note": note, "stage": current_stage})
        return "Leave rejected successfully. The employee has been notified."

    next_stage = next_leave_stage(employee, current_stage, existing)
    current_stage_fields = approval_stage_update_fields(current_stage, "approved", note)
    if next_stage != "final":
        next_pending_fields = {}
        if next_stage == "reporting_officer":
            next_pending_fields.update({
                "reporting_officer_status": "pending",
                "hr_status": existing.get("hr_status") or "view_only",
            })
        elif next_stage == "hr":
            next_pending_fields["hr_status"] = "pending"
        status_text = (
            "Approved by Team Leader, Pending with Reporting Officer"
            if current_stage == "team_leader" and next_stage == "reporting_officer"
            else f"Pending with {leave_stage_label(next_stage)}"
        )
        db.leave_requests.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "status": "pending",
                    "approval_stage": next_stage,
                    "approval_stage_label": leave_stage_label(next_stage),
                    "live_status": status_text,
                    "status_text": status_text,
                    "status_display": status_text,
                    "updated_at": now,
                    **current_stage_fields,
                    **next_pending_fields,
                },
                "$push": {"approval_history": create_leave_history_entry("approved", current_stage, note)},
            },
        )
        updated = db.leave_requests.find_one({"_id": existing["_id"]})
        notify_next_leave_approvers(db, employee, updated, next_stage)
        audit("saya_approve_leave_stage", "leave_requests", request_id, {"stage": current_stage, "next_stage": next_stage, "note": note})
        return f"Leave approved at {leave_stage_label(current_stage)} stage and sent to {leave_stage_label(next_stage)} for the next decision."

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
            raise ValueError(f"Final approval cannot be completed because the employee has only {available:g} day(s) of {leave_type_label(leave_type)} available.")
        deduct_leave_balance(db, employee, existing)
        balance_deducted = True
    elif leave_type == "COMP-OFF":
        deducted_leave_type = "COMP-OFF"
        deducted_label = leave_type_label("COMP-OFF")

    db.leave_requests.update_one(
        {"_id": existing["_id"]},
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
                **current_stage_fields,
            },
            "$push": {"approval_history": create_leave_history_entry("approved", current_stage, note)},
        },
    )
    updated = db.leave_requests.find_one({"_id": existing["_id"]})
    mark_compoff_used_if_needed(db, updated)
    updated = db.leave_requests.find_one({"_id": existing["_id"]})
    notify_employee_leave_decision(db, employee, updated, "approved")
    notify_hr_leave_result(db, employee, updated, "approved")
    audit("saya_approve_leave_final", "leave_requests", request_id, {"note": note, "stage": current_stage})
    return "Leave approved successfully. The employee has been notified and the final leave workflow has been completed."


def _decide_attendance_request(collection_name, request_id, decision, note, user_context=None):
    db = get_db()
    request_doc = _safe_request_by_id(collection_name, request_id, user_context)
    if not request_doc:
        raise ValueError("The request is no longer pending in your approval scope.")
    if decision not in {"approved", "rejected"}:
        raise ValueError("The decision must be approve or reject.")

    now = datetime.utcnow()
    actor_id = _actor_id(user_context)
    actor_name = _actor_name(user_context)
    stage = _text(request_doc.get("approval_stage"))
    history = {
        "stage": stage,
        "stage_label": request_doc.get("approval_stage_label") or leave_stage_label(stage),
        "status": decision,
        "decision_note": note,
        "decided_at": now,
        "decided_by": actor_id,
        "decided_by_name": actor_name,
    }
    set_data = {
        "decision_note": note,
        "last_decided_at": now,
        "last_decided_by": actor_id,
        "last_decided_by_name": actor_name,
        "updated_at": now,
    }

    if decision == "rejected":
        set_data.update({
            "status": "rejected",
            "approval_stage": "rejected",
            "approval_stage_label": "Rejected",
            "decided_at": now,
            "decided_by": actor_id,
            "decided_by_name": actor_name,
        })
        outcome = "rejected"
    elif stage == "team_leader":
        next_stage, next_label = next_approval_stage_after_team_leader(request_doc)
        if next_stage == "approved":
            set_data.update({
                "status": "approved",
                "approval_stage": "approved",
                "approval_stage_label": "Approved",
                "decided_at": now,
                "decided_by": actor_id,
                "decided_by_name": actor_name,
            })
            outcome = "approved"
        else:
            set_data.update({
                "status": "pending",
                "approval_stage": next_stage,
                "approval_stage_label": next_label,
            })
            reporting_user = employee_user_id(db, request_doc.get("reporting_officer_id"), _tenant_id(user_context))
            title = "Holiday Work Request" if collection_name == "holiday_work_requests" else "Attendance Mode Request"
            notify_users(
                db,
                [reporting_user],
                title,
                f"{request_doc.get('employee_name', 'Employee')} request is pending for Reporting Officer approval.",
                {
                    "request_id": request_id,
                    "employee_id": request_doc.get("employee_id"),
                    "date": request_doc.get("date"),
                    "approval_stage": next_stage,
                },
                tenant_id=_tenant_id(user_context),
            )
            outcome = f"approved at Team Leader stage and sent to {next_label}"
    else:
        set_data.update({
            "status": "approved",
            "approval_stage": "approved",
            "approval_stage_label": "Approved",
            "decided_at": now,
            "decided_by": actor_id,
            "decided_by_name": actor_name,
        })
        outcome = "approved"

    db[collection_name].update_one(
        {"_id": request_doc["_id"]},
        {"$set": set_data, "$push": {"approval_history": history}},
    )
    updated = db[collection_name].find_one({"_id": request_doc["_id"]})
    employee_user = employee_user_id(db, request_doc.get("employee_id"), _tenant_id(user_context))
    title = "Holiday Work Request Updated" if collection_name == "holiday_work_requests" else "Attendance Mode Request Updated"
    notify_users(
        db,
        [employee_user],
        title,
        f"Your request for {request_doc.get('date')} is {updated.get('status') if updated else decision}.",
        {"request_id": request_id, "status": (updated or {}).get("status") or decision},
        tenant_id=_tenant_id(user_context),
    )
    audit(
        f"saya_{decision}_{collection_name}",
        collection_name,
        request_id,
        {"decision_note": note, "approval_stage": stage},
    )
    return f"Request {outcome}. The employee notification has been updated."


def _start_decision(action_type, question, user_context, candidates, request_label):
    if _bulk_request(question):
        return {
            "handled": True,
            "answer": "For safety, Saya does not bulk-approve or bulk-reject manager requests. Please choose one request at a time.",
        }
    decision = _decision_from_text(question)
    candidate = _match_candidate(question, candidates)
    data = {
        "decision": decision,
        "candidates": candidates[:DISPLAY_LIMIT],
        "request_label": request_label,
    }
    if not candidates:
        return {"handled": True, "answer": f"There are no pending {request_label} requests in your current approval scope."}
    if not candidate:
        save_pending_action(user_context, action_type, data, "select_request")
        return {
            "handled": True,
            "answer": _format_candidates(f"Pending {request_label} requests — choose one by number, employee name, date, or reference", candidates),
        }
    data["request_id"] = candidate["id"]
    data["selected"] = candidate
    if not decision:
        save_pending_action(user_context, action_type, data, "decision")
        return {"handled": True, "answer": f"Do you want to approve or reject {candidate['employee_name']}'s {request_label} request?"}
    if decision == "rejected":
        save_pending_action(user_context, action_type, data, "note")
        return {"handled": True, "answer": "Please provide the rejection reason. This will be recorded in the approval history."}
    save_pending_action(user_context, action_type, data, "confirm")
    return {"handled": True, "answer": _decision_review(data)}


def _decision_review(data):
    item = data.get("selected") or {}
    decision = _text(data.get("decision")).replace("ed", "").title()
    label = _text(data.get("request_label") or "request")
    lines = [
        "Please confirm this manager decision:",
        f"Employee: {item.get('employee_name') or 'Employee'}",
        f"Request: {label}",
        f"Date: {item.get('date') or item.get('from_date') or 'Not recorded'}",
        f"Decision: {decision}",
    ]
    if data.get("note"):
        lines.append(f"Note: {data['note']}")
    lines.append("Reply Yes to confirm or No to cancel.")
    return "\n".join(lines)


def _continue_decision(action_type, pending, question, user_context, candidates_loader, executor):
    data = dict(pending.get("data") or {})
    step = _text(pending.get("current_step"))
    candidates = data.get("candidates") or candidates_loader(user_context)

    if step == "select_request":
        candidate = _match_candidate(question, candidates)
        if not candidate:
            return {"handled": True, "answer": "I could not identify one request safely. Please reply with the request number or reference shown in the list."}
        data["request_id"] = candidate["id"]
        data["selected"] = candidate
        if not data.get("decision"):
            save_pending_action(user_context, action_type, data, "decision")
            return {"handled": True, "answer": f"Do you want to approve or reject {candidate['employee_name']}'s request?"}
        if data.get("decision") == "rejected":
            save_pending_action(user_context, action_type, data, "note")
            return {"handled": True, "answer": "Please provide the rejection reason."}
        save_pending_action(user_context, action_type, data, "confirm")
        return {"handled": True, "answer": _decision_review(data)}

    if step == "decision":
        decision = _decision_from_text(question)
        if not decision:
            return {"handled": True, "answer": "Please reply Approve or Reject."}
        data["decision"] = decision
        if decision == "rejected":
            save_pending_action(user_context, action_type, data, "note")
            return {"handled": True, "answer": "Please provide the rejection reason. This will be recorded in the approval history."}
        save_pending_action(user_context, action_type, data, "confirm")
        return {"handled": True, "answer": _decision_review(data)}

    if step == "note":
        note = _text(question)
        if data.get("decision") == "rejected" and (_is_skip(note) or len(note) < 3):
            return {"handled": True, "answer": "A clear rejection reason is required. Please provide the reason."}
        data["note"] = "" if _is_skip(note) else note[:1000]
        save_pending_action(user_context, action_type, data, "confirm")
        return {"handled": True, "answer": _decision_review(data)}

    if step == "confirm":
        if _is_no(question):
            clear_pending_action(user_context)
            return {"handled": True, "answer": "The manager decision was cancelled. No HRMS record was changed."}
        if not _is_yes(question):
            return {"handled": True, "answer": _decision_review(data)}
        try:
            message = executor(
                data.get("request_id"),
                data.get("decision"),
                data.get("note") or "",
                user_context,
            )
        except Exception as exc:
            return {"handled": True, "answer": f"I could not complete the decision safely: {_text(exc) or 'the request could not be validated.'}"}
        clear_pending_action(user_context)
        return {"handled": True, "answer": message}

    clear_pending_action(user_context)
    return {"handled": True, "answer": "The incomplete manager action was cleared safely. Please start again."}


def _leave_decision_start(question="", user_context=None):
    return _start_decision("decide_team_leave", question, user_context, _leave_candidates(user_context), "leave")


def _leave_decision_continue(pending=None, question="", user_context=None):
    return _continue_decision("decide_team_leave", pending or {}, question, user_context, _leave_candidates, _decide_leave)


def _mode_decision_start(question="", user_context=None):
    return _start_decision("decide_attendance_mode_request", question, user_context, _mode_candidates(user_context), "WFH / field-attendance")


def _mode_decision_continue(pending=None, question="", user_context=None):
    return _continue_decision(
        "decide_attendance_mode_request", pending or {}, question, user_context,
        _mode_candidates,
        lambda request_id, decision, note, ctx: _decide_attendance_request("attendance_mode_requests", request_id, decision, note, ctx),
    )


def _holiday_decision_start(question="", user_context=None):
    return _start_decision("decide_holiday_work_request", question, user_context, _holiday_candidates(user_context), "holiday-work")


def _holiday_decision_continue(pending=None, question="", user_context=None):
    return _continue_decision(
        "decide_holiday_work_request", pending or {}, question, user_context,
        _holiday_candidates,
        lambda request_id, decision, note, ctx: _decide_attendance_request("holiday_work_requests", request_id, decision, note, ctx),
    )


def _attendance_verification_candidates(user_context=None):
    db = get_db()
    tenant_id = _tenant_id(user_context)
    ids = _team_employee_ids(user_context)
    if not tenant_id or not ids:
        return []
    docs = list(db.attendance_logs.find({
        "tenant_id": tenant_id,
        "employee_id": {"$in": ids},
        "is_deleted": {"$ne": True},
        "mode": "field",
        "verified_by_ro": {"$ne": True},
    }).sort([("date", -1), ("check_in", -1)]).limit(READ_LIMIT))
    employee_oids = [oid for oid in (_oid(value) for value in ids) if oid]
    employees = list(db.employees.find({"_id": {"$in": employee_oids}, "tenant_id": tenant_id}))
    names = {str(emp.get("_id")): attendance_employee_display_name(emp) for emp in employees}
    result = []
    for doc in docs:
        item_id = str(doc.get("_id"))
        result.append({
            "id": item_id,
            "short_ref": item_id[-6:],
            "employee_name": names.get(_text(doc.get("employee_id"))) or _text(doc.get("employee_name")) or "Employee",
            "type": "Field Attendance",
            "date": _text(doc.get("date")),
        })
    return result


def _verify_field_attendance(request_id, decision, note, user_context=None):
    # Verification is intentionally one-way. 'Reject verification' is not a
    # canonical HRMS operation, so Saya refuses to invent it.
    if decision != "approved":
        raise ValueError("Field attendance can be verified, but this HRMS does not define a manager 'reject attendance' operation.")
    db = get_db()
    candidates = _attendance_verification_candidates(user_context)
    selected = next((item for item in candidates if item.get("id") == request_id), None)
    if not selected:
        raise ValueError("The field attendance record is no longer pending verification in your scope.")
    oid = _oid(request_id)
    now = datetime.utcnow()
    db.attendance_logs.update_one(
        {"_id": oid, "tenant_id": _tenant_id(user_context)},
        {"$set": {
            "verified_by_ro": True,
            "verified_at": now,
            "verified_by": _actor_id(user_context),
            "verified_by_name": _actor_name(user_context),
            "updated_at": now,
        }},
    )
    audit("saya_verify_attendance", "attendance_logs", request_id, {"note": note})
    return "Field attendance verified successfully."


def _verify_start(question="", user_context=None):
    candidates = _attendance_verification_candidates(user_context)
    if not candidates:
        return {"handled": True, "answer": "There are no unverified field-attendance records in your current team scope."}
    # Force the canonical one-way decision.
    effective_question = question if _decision_from_text(question) else f"approve {question}"
    return _start_decision("verify_team_field_attendance", effective_question, user_context, candidates, "field-attendance verification")


def _verify_continue(pending=None, question="", user_context=None):
    return _continue_decision(
        "verify_team_field_attendance", pending or {}, question, user_context,
        _attendance_verification_candidates,
        _verify_field_attendance,
    )


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

register_saya_action(
    "manager_pending_approvals",
    {
        "label": "Show My Pending Team Approvals",
        "module": "Approvals",
        "module_key": "apply_leave",
        "kind": "read",
        "scope": "mapped_team",
        "requires_tenant": True,
        "requires_employee": True,
        "requires_confirmation": False,
        "allowed_roles": sorted(MANAGER_ROLES),
    },
    start_handler=_read_pending_start,
    access_handler=_manager_access,
    intent_phrases=[
        "show my pending approvals", "pending team approvals", "what approvals are waiting for me",
        "show pending requests for approval", "my approval queue", "team approval queue",
    ],
)

register_saya_action(
    "manager_team_attendance",
    {
        "label": "Team Attendance Summary",
        "module": "Attendance",
        "module_key": "attendance",
        "kind": "read",
        "scope": "mapped_team",
        "requires_tenant": True,
        "requires_employee": True,
        "requires_confirmation": False,
        "allowed_roles": sorted(MANAGER_ROLES),
    },
    start_handler=_team_attendance_start,
    access_handler=_manager_access,
    intent_phrases=[
        "team attendance", "who is absent today", "who is late today", "who has not checked in",
        "show my team attendance", "team attendance today", "who is on wfh today", "who is in field today",
    ],
)

register_saya_action(
    "manager_project_overview",
    {
        "label": "Team Project Overview",
        "module": "Projects",
        "module_key": "projects",
        "kind": "read",
        "scope": "mapped_team_projects",
        "requires_tenant": True,
        "requires_employee": True,
        "requires_confirmation": False,
        "allowed_roles": sorted(MANAGER_ROLES),
    },
    start_handler=_project_overview_start,
    access_handler=_manager_access,
    intent_phrases=[
        "show team projects", "team project overview", "which projects are behind",
        "which projects are overdue", "show projects behind schedule", "my team projects",
    ],
)

register_saya_action(
    "decide_team_leave",
    {
        "label": "Approve / Reject Team Leave",
        "module": "Leave",
        "module_key": "apply_leave",
        "kind": "write",
        "scope": "mapped_team",
        "requires_tenant": True,
        "requires_employee": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(MANAGER_ROLES),
    },
    start_handler=_leave_decision_start,
    continue_handler=_leave_decision_continue,
    access_handler=_manager_access,
    intent_phrases=[
        "approve leave", "reject leave", "approve team leave", "reject team leave",
        "approve his leave", "approve her leave", "decline leave request", "leave approval",
    ],
)

register_saya_action(
    "decide_attendance_mode_request",
    {
        "label": "Approve / Reject WFH or Field Attendance",
        "module": "Attendance",
        "module_key": "attendance",
        "kind": "write",
        "scope": "mapped_team",
        "requires_tenant": True,
        "requires_employee": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(MANAGER_ROLES),
    },
    start_handler=_mode_decision_start,
    continue_handler=_mode_decision_continue,
    access_handler=_manager_access,
    intent_phrases=[
        "approve wfh", "reject wfh", "approve work from home", "reject work from home",
        "approve field attendance", "reject field attendance", "approve field request", "reject field request",
    ],
)

register_saya_action(
    "decide_holiday_work_request",
    {
        "label": "Approve / Reject Holiday Work",
        "module": "Attendance",
        "module_key": "attendance",
        "kind": "write",
        "scope": "mapped_team",
        "requires_tenant": True,
        "requires_employee": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(MANAGER_ROLES),
    },
    start_handler=_holiday_decision_start,
    continue_handler=_holiday_decision_continue,
    access_handler=_manager_access,
    intent_phrases=[
        "approve holiday work", "reject holiday work", "holiday work approval",
        "approve holiday request", "reject holiday request",
    ],
)

register_saya_action(
    "verify_team_field_attendance",
    {
        "label": "Verify Team Field Attendance",
        "module": "Attendance",
        "module_key": "attendance",
        "kind": "write",
        "scope": "mapped_team",
        "requires_tenant": True,
        "requires_employee": True,
        "requires_confirmation": True,
        "allowed_roles": sorted(MANAGER_ROLES),
    },
    start_handler=_verify_start,
    continue_handler=_verify_continue,
    access_handler=_manager_access,
    intent_phrases=[
        "verify field attendance", "verify team attendance", "verify field check in",
        "verify field check-in", "approve field attendance verification",
    ],
)
