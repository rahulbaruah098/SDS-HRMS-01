"""Projects planning domain. All queries are tenant scoped; no legacy data is rewritten.

Monthly documents publish one dated baseline and retain a separate editable draft.
Reports and revisions share an optimistic version, so a stale approval cannot erase
a concurrent report. Weeks/days are projections, never duplicated task records.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import json
import math
import re

from bson import BSON, ObjectId
from flask import g
from app.services import team_responsibility as responsibility
from pymongo.errors import DuplicateKeyError

MASTER = json.loads((Path(__file__).parent.parent / "data/project_planning_master.json").read_text(encoding="utf-8"))
TASKS = {r["code"]: r for r in MASTER["tasks"]}
STATUSES = ("completed", "pending", "not_completed")
ORG_ROLES = {"admin", "managing_director", "hr", "hr_admin", "hr_manager"}


class PlanningError(ValueError):
    def __init__(self, message, status=400, code="PLANNING_VALIDATION"):
        super().__init__(message)
        self.status, self.code = status, code


def require(condition, message, status=400):
    if not condition:
        raise PlanningError(message, status)


def project_api():
    from app.routes import projects
    return projects


def tenant():
    value = getattr(g, "tenant_id", None)
    require(isinstance(value, str) and bool(value.strip()), "Company context is required", 403)
    return value


def stamp():
    return datetime.now(timezone.utc).isoformat()


def today():
    from app.routes.attendance import today_local
    return today_local()


def text(value, field="Value", required=False, maximum=2000):
    require(value is None or isinstance(value, (str, int, float)), f"{field} must be text")
    result = str(value or "").strip()
    require(not required or result, f"{field} is required")
    require(len(result) <= maximum, f"{field} is too long (maximum {maximum})")
    return result


def iso(value, field="Date"):
    try:
        result = date.fromisoformat(str(value))
        require(result.isoformat() == value, f"{field} must use YYYY-MM-DD")
        return result.isoformat()
    except (ValueError, TypeError):
        raise PlanningError(f"{field} must be a valid YYYY-MM-DD date")


def month(value):
    value = text(value, "Month", True, 7)
    iso(value + "-01", "Month")
    return value


def number(value, field, minimum=0, maximum=1000000000):
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise PlanningError(f"{field} must be a number")
    require(math.isfinite(result) and minimum <= result <= maximum, f"{field} must be between {minimum} and {maximum}")
    return result


def object_id(value):
    try:
        return ObjectId(str(value))
    except Exception:
        raise PlanningError("Invalid record identifier")


def own_employee(db):
    employee = project_api().get_current_employee(db)
    require(employee, "Your account needs a linked employee profile", 403)
    return employee


def org_access():
    return bool(project_api().current_user_roles() & ORG_ROLES)


def aliases(employee):
    return {str(v) for v in project_api().employee_identifier_values(employee)}


def mapped_to(employee, manager, key):
    return str(employee.get(key, "")) in aliases(manager)


def is_tl(employee):
    return project_api().employee_is_team_leader(employee)


def is_ro(employee):
    return project_api().employee_is_reporting_officer(employee)


def employee_by_id(db, identifier):
    row = db.employees.find_one({"_id": object_id(identifier), "tenant_id": tenant(), "is_deleted": {"$ne": True}})
    require(row, "Employee not found in your company", 404)
    return row


def detail_employees(db):
    if org_access():
        return list(db.employees.find({'tenant_id': tenant(), 'is_deleted': {'$ne': True}}))
    return responsibility.scoped_people(db, tenant(), own_employee(db))


def authorize_employee(db, identifier):
    require(str(identifier) in {str(p["_id"]) for p in detail_employees(db)}, "Employee details are outside your reporting scope", 403)
    return employee_by_id(db, identifier)


def reviewer(db, employee):
    person = responsibility.reviewer(db, tenant(), employee)
    require(person, 'An independent active Team Leader / Reporting Officer must be mapped. HR/Admin reassignment is required.', 409)
    return person


def can_review(db, employee):
    me = project_api().get_current_employee(db)
    if not me or me["_id"] == employee["_id"]:
        return False
    try:
        return reviewer(db, employee)["_id"] == me["_id"]
    except PlanningError:
        return False


def event(action, **details):
    return {"action": action, "at": stamp(), "actor_id": str(g.current_user["_id"]), **details}


def notify(db, employee, title, body):
    from app.utils.auth import audit
    from app.routes.projects import notify_project_employees
    # Reuse the existing tenant-aware notification integration.
    try:
        notify_project_employees(db, {"_id": "planning", "tenant_id": tenant(), "name": "Projects planning"},
                                 [str(employee["_id"])], title, body, notification_type="project_planning")
    except Exception:
        audit("planning_notification_failed", "projects", str(employee["_id"]))


def get_project(db, identifier, manage=False):
    p = db.projects.find_one({"_id": object_id(identifier), "tenant_id": tenant(), "is_deleted": {"$ne": True}})
    require(p, "Project not found", 404)
    api = project_api()
    allowed = api.can_manage_project_team(db, p) if manage else (org_access() or api.can_view_project(db, p))
    require(allowed, "Project is outside your scope", 403)
    return p


def departments(db):
    return [{"id": str(d["_id"]), "name": d.get("name") or d.get("department_name")}
            for d in db.departments.find({"tenant_id": tenant(), "is_deleted": {"$ne": True}})
            if d.get("name") or d.get("department_name")]


def eligible_members(db, leader, department):
    current, _, source = responsibility.effective(db, tenant(), leader['_id'])
    if not current:
        return []
    people = responsibility.team_members(db, tenant(), source['_id']) + [current]
    return list({str(e['_id']): e for e in people}.values())


def validate_project(db, data, existing=None):
    """Called by both existing project create/update endpoints."""
    existing = existing or {}
    combined = {**existing, **data}
    kind = text(combined.get("project_type"), "Project type", True)
    require(kind in {"client", "in_house"}, "Project type must be client or in_house")
    client = text(combined.get("client_name"), "Client name", kind == "client", 200) if kind == "client" else ""
    start = iso(combined.get("start_date"), "Start date")
    end = iso(data.get("end_date") or combined.get("due_date"), "End date")
    require(start <= end, "End date cannot be before start date")
    function = text(combined.get("function"), "Function", True, 100)
    require(function in MASTER["functions"], "Select an approved function")
    leader = responsibility.resolve(db, tenant(), combined.get("team_leader_id"))
    effective_leader, _, _ = responsibility.effective(db, tenant(), leader['_id']) if leader else (None, None, None)
    require(leader and effective_leader, "Select an eligible Team Leader or delegated team")
    me = project_api().get_current_employee(db)
    allowed = responsibility.can_manage_team(db, tenant(), me, leader['_id'])
    require(allowed, "Team Leader is outside your reporting scope", 403)
    department = text(leader.get("department"), "Team Leader department", True, 200)
    require(department in {d["name"] for d in departments(db)}, "The Team Leader must have a valid company department")
    if data.get("department"):
        require(data["department"] == department, "Department must match the selected Team Leader")
    eligible = {str(p["_id"]) for p in eligible_members(db, leader, department)}
    primary = str(combined.get("primary_assignee_id") or combined.get("assigned_to_id") or "")
    require(primary in eligible, "Primary responsible employee must be mapped to the selected Team Leader")
    assigned = combined.get("assigned_employee_ids", [])
    collaborators = combined.get("collaborator_ids", [])
    require(isinstance(assigned, list) and isinstance(collaborators, list), "Team members must be lists")
    require(all(str(v) in eligible for v in assigned + collaborators), "Every team member must be mapped to the selected team")
    raw = combined.get("deliverables", [])
    require(isinstance(raw, list) and 1 <= len(raw) <= 100, "Add between 1 and 100 project deliverables")
    old = {r["id"]: r for r in existing.get("deliverables", [])}
    deliverables, seen = [], set()
    for item in raw:
        require(isinstance(item, dict), "Invalid deliverable")
        identifier = text(item.get("id") or uuid4().hex, "Deliverable ID", True, 64)
        require(re.fullmatch(r"[A-Za-z0-9_-]+", identifier) and identifier not in seen, "Deliverable IDs must be unique and contain only letters, numbers, underscores or hyphens")
        seen.add(identifier)
        due = iso(item.get("due_date"), "Contract due date")
        require(start <= due <= end, "Deliverable deadline must fall within the project period")
        status = item.get("status", "Not Started")
        require(status in MASTER["deliverable_statuses"], "Invalid deliverable status")
        deliverables.append({"id": identifier, "title": text(item.get("title"), "Deliverable", True, 400),
                             "due_date": due, "status": status, "notes": text(item.get("notes")),
                             "manager_id": str(leader["_id"]), "updated_at": stamp()})
    if existing:
        targets = list(db.project_monthly_targets.find({"tenant_id": tenant(), "project_id": str(existing["_id"])}))
        for target in targets:
            require(start <= target["due_date"] <= end, "Project period would exclude an existing monthly target")
            require(target.get("deliverable_id") in seen, "A deliverable linked to a monthly target cannot be removed")
            require(target["employee_id"] in set([str(v) for v in assigned + collaborators] + [primary, str(leader["_id"])]),
                    "An employee with monthly targets must remain a project member")
            deadline = next(d["due_date"] for d in deliverables if d["id"] == target["deliverable_id"])
            require(target["due_date"] <= deadline, "Deliverable timeline would exclude an existing monthly target")
            require(function == existing.get("function"), "A project with monthly targets retains its function to preserve activity mappings")
        if targets:
            require(str(leader["_id"]) == str(existing.get("team_leader_id")) and department == existing.get("department"),
                    "A project with monthly assignments retains its Team Leader and department for historical integrity")
        for plan in db.project_monthly_plans.find({"tenant_id": tenant(), "published_rows.project_id": str(existing["_id"])}):
            require(all(start <= r["date"] <= end for r in plan["published_rows"] if r["project_id"] == str(existing["_id"])),
                    "Project period would exclude published daily work")
    return {"project_type": kind, "client_name": client, "function": function, "department": department,
            "start_date": start, "due_date": end, "deliverables": deliverables, "planning_schema": 1,
            "project_code": existing.get("project_code") or "PRJ-" + uuid4().hex[:12].upper()}


def validate_existing_members(db, project, ids):
    if project.get("planning_schema") != 1:
        return
    leader = responsibility.resolve(db, tenant(), project.get("team_leader_id"))
    require(leader, "Project Team Leader is no longer available")
    eligible = {str(p["_id"]) for p in eligible_members(db, leader, project.get("department"))}
    require(all(str(v) in eligible for v in ids), "Members must belong to this project's mapped team")


def calendar_exception(db, employee, day):
    from app.routes.attendance import holiday_info_for_employee, approved_holiday_work_request, approved_leave_weight_by_date
    d = date.fromisoformat(day)
    if approved_leave_weight_by_date(db, employee, d, d).get(day, 0) >= 1:
        return "Approved full-day leave"
    holiday = holiday_info_for_employee(db, employee, d)
    if holiday.get("is_holiday") and not approved_holiday_work_request(db, employee, day):
        return holiday.get("name") or holiday.get("reason") or "Non-working day"
    return ""


def target_by_id(db, identifier):
    row = db.project_monthly_targets.find_one({"_id": object_id(identifier), "tenant_id": tenant()})
    require(row, "Monthly target not found", 404)
    return row


def save_target(db, data):
    project = get_project(db, data.get("project_id"), manage=True)
    require(project.get("planning_schema") == 1, "Complete this project's dates, function and deliverables first")
    employee = authorize_employee(db, data.get("employee_id"))
    require(str(employee["_id"]) in project_api().project_member_ids(project), "Employee must be assigned to the project")
    require(project.get("status") == "active", "Monthly targets require an active project")
    period = month(data.get("month"))
    due = iso(data.get("due_date"), "Target due date")
    require(due[:7] == period and project["start_date"] <= due <= project["due_date"], "Target deadline must fall in the selected month and project period")
    deliverable = next((d for d in project["deliverables"] if d["id"] == data.get("deliverable_id")), None)
    require(deliverable, "Select a project deliverable")
    require(due <= deliverable["due_date"], "Target deadline must be on or before the deliverable deadline")
    unit = data.get("unit", "Count")
    require(unit in MASTER["units"], "Select a valid unit")
    priority = data.get("priority", "Medium")
    require(priority in MASTER["priorities"], "Select a valid priority")
    function = project["function"]
    activity = text(data.get("activity"), "Standard activity", True, 200)
    require(any(t["function"] == function and t["activity"] == activity for t in TASKS.values()), "Activity does not belong to the project's function")
    key = text(data.get("request_id"), "Request ID", True, 64)
    require(re.fullmatch(r"[A-Za-z0-9_-]{8,64}", key), "Invalid request ID")
    identifier = ObjectId(sha256((tenant() + ":target:" + key).encode()).hexdigest()[:24])
    require(not db.project_monthly_targets.find_one({"_id": identifier}), "This target request has already been saved", 409)
    doc = {"_id": identifier, "tenant_id": tenant(), "month": period, "project_id": str(project["_id"]),
           "project_code": project["project_code"], "project_name": project_api().project_name(project),
           "deliverable_id": deliverable["id"], "deliverable_title": deliverable["title"],
           "employee_id": str(employee["_id"]), "employee_name": project_api().employee_display_name(employee),
           "team_leader_id": str(project["team_leader_id"]), "department": project["department"], "function": function,
           "output": text(data.get("output"), "Monthly output", True, 1000), "activity": activity,
           "quantity": number(data.get("quantity"), "Target quantity", 0.000001), "unit": unit,
           "due_date": due, "expected_evidence": text(data.get("expected_evidence")),
           "evidence_required": bool(data.get("evidence_required")), "priority": priority,
           "status": "approved", "version": 1, "events": [event("assigned")], "created_at": stamp(),
           "assessment": "", "corrective_action": ""}
    try:
        db.project_monthly_targets.insert_one(doc)
    except DuplicateKeyError:
        raise PlanningError("This target request has already been saved", 409)
    notify(db, employee, "Monthly project work assigned", f"{period}: {doc['output']}")
    return doc


def plan_key(employee_id, period):
    return ObjectId(sha256((tenant() + ":plan:" + str(employee_id) + ":" + period).encode()).hexdigest()[:24])


def get_plan(db, employee_id, period):
    month(period)
    employee = authorize_employee(db, employee_id)
    doc = db.project_monthly_plans.find_one({"_id": plan_key(employee_id, period), "tenant_id": tenant()})
    return doc or {"_id": plan_key(employee_id, period), "tenant_id": tenant(), "employee_id": str(employee["_id"]),
                   "employee_name": project_api().employee_display_name(employee), "month": period, "version": 0,
                   "status": "draft", "rows": [], "published_rows": [], "reports": {}, "events": []}


def check_version(doc, value):
    require(isinstance(value, int) and value == doc["version"], "This record changed. Reload before saving to preserve the latest work", 409)


def commit(db, collection, before, after, change):
    after = deepcopy(after)
    after["version"] = before["version"] + 1
    after["updated_at"] = stamp()
    after.setdefault("events", []).append(change)
    require(len(BSON.encode(after)) < 12 * 1024 * 1024, "Planning history has reached the document limit; contact your administrator")
    if before["version"] == 0:
        try:
            db[collection].insert_one(after)
        except DuplicateKeyError:
            raise PlanningError("A monthly plan was created concurrently. Reload to continue", 409)
    else:
        result = db[collection].replace_one({"_id": before["_id"], "tenant_id": tenant(), "version": before["version"]}, after)
        require(result.matched_count == 1, "Another update was saved. Reload before continuing", 409)
    return after


def validate_rows(db, employee, period, rows, baseline):
    require(isinstance(rows, list) and 1 <= len(rows) <= 500, "A monthly plan needs between 1 and 500 dated activities")
    results, seen, hours = [], set(), {}
    old = {r["id"]: r for r in baseline}
    for row in rows:
        require(isinstance(row, dict), "Invalid activity")
        identifier = str(row.get("id") or uuid4().hex)
        require(re.fullmatch(r"[a-f0-9]{32}", identifier) and identifier not in seen, "Task identifiers must be unique")
        seen.add(identifier)
        previous = old.get(identifier)
        # Reuse an unchanged published snapshot even if project metadata changed
        # later. This is essential when revising another activity in the month.
        comparable = {key: row.get(key) for key in ("target_id", "date", "task_code", "output")}
        comparable["quantity"] = number(row.get("quantity"), "Planned quantity", 0.000001)
        comparable["hours"] = number(row.get("hours"), "Estimated hours", 0, 24)
        if previous and all(previous.get(key) == value for key, value in comparable.items()):
            hours[previous["date"]] = hours.get(previous["date"], 0) + previous["hours"]
            require(hours[previous["date"]] <= 24, "Total estimated hours exceed 24 on " + previous["date"])
            results.append(deepcopy(previous))
            continue
        target = target_by_id(db, row.get("target_id"))
        require(target["employee_id"] == str(employee["_id"]) and target["month"] == period, "Monthly target belongs to a different employee or month")
        day = iso(row.get("date"), "Planned date")
        require(day[:7] == period, "Every activity must be inside the selected month")
        p = get_project(db, target["project_id"])
        require(p.get("status") == "active", "New or revised activities require an active project")
        require(p.get("start_date", "") <= day <= min(p.get("due_date", ""), target["due_date"]), "Activity date must fall within its project period and monthly target deadline")
        task = TASKS.get(row.get("task_code"))
        require(task and task["function"] == target["function"] and task["activity"] == target["activity"], "Select a standard task for the target's function and activity")
        item = {"id": identifier, "target_id": str(target["_id"]), "project_id": target["project_id"],
                "project_code": target["project_code"], "project_name": target["project_name"],
                "deliverable_id": target["deliverable_id"], "department": target["department"], "function": target["function"],
                "employee_id": target["employee_id"], "team_leader_id": target["team_leader_id"],
                "collaborator_ids": p.get("collaborator_ids", []), "date": day, "task_code": task["code"],
                "activity": task["activity"], "task": task["task"], "output": text(row.get("output"), "Daily output", True, 1000),
                "quantity": number(row.get("quantity"), "Planned quantity", 0.000001), "unit": target["unit"],
                "hours": number(row.get("hours"), "Estimated hours", 0, 24), "priority": target["priority"],
                "evidence_required": target["evidence_required"], "expected_evidence": target["expected_evidence"]}
        if old.get(identifier) != item:
            require(day >= today().isoformat(), "New or revised work cannot be scheduled in the past")
            require(not calendar_exception(db, employee, day), "Cannot schedule on leave / a non-working day without approved holiday work")
            attendance = db.attendance_logs.find_one({"tenant_id": tenant(), "employee_id": str(employee["_id"]), "date": day, "is_deleted": {"$ne": True}})
            require(not (attendance and attendance.get("check_out")), "Work cannot be added or changed after checkout for that date")
        hours[day] = hours.get(day, 0) + item["hours"]
        require(hours[day] <= 24, "Total estimated hours exceed 24 on " + day)
        results.append(item)
    return results


def protect_history(before, rows):
    new = {r["id"]: r for r in rows}
    old = {r["id"]: r for r in before["published_rows"]}
    closed = before.get("sealed_dates", {})
    for row in rows:
        if row["date"] in closed:
            require(old.get(row["id"]) == row, "This attendance day is closed for scheduling changes")
    for row in before["published_rows"]:
        if row["id"] in before["reports"] or row["date"] < today().isoformat() or row["date"] in closed:
            require(new.get(row["id"]) == row, "Reported and past published activities cannot be changed or removed")


def save_plan(db, data):
    me = own_employee(db)
    before = get_plan(db, str(me["_id"]), month(data.get("month")))
    check_version(before, data.get("version"))
    require(before["status"] != "submitted", "The submitted plan must be reviewed before it can be edited", 409)
    rows = validate_rows(db, me, before["month"], data.get("rows"), before["published_rows"])
    protect_history(before, rows)
    after = {**before, "rows": rows, "status": "draft"}
    return commit(db, "project_monthly_plans", before, after, event("draft_saved", rows=rows))


def submit_plan(db, data):
    me = own_employee(db)
    before = get_plan(db, str(me["_id"]), month(data.get("month")))
    check_version(before, data.get("version"))
    require(before["status"] in {"draft", "revision_required"} and before["rows"], "Save your day-wise plan before submission")
    manager = reviewer(db, me)
    rows = validate_rows(db, me, before["month"], before["rows"], before["published_rows"])
    protect_history(before, rows)
    after = commit(db, "project_monthly_plans", before, {**before, "status": "submitted", "reviewer_id": str(manager["_id"])}, event("submitted"))
    notify(db, manager, "Monthly plan awaiting review", f"{before['employee_name']} submitted {before['month']}.")
    return after


def review_plan(db, identifier, data):
    before = db.project_monthly_plans.find_one({"_id": object_id(identifier), "tenant_id": tenant()})
    require(before, "Plan not found", 404)
    employee = employee_by_id(db, before["employee_id"])
    require(can_review(db, employee), "Only the mapped independent reviewer can decide this plan", 403)
    check_version(before, data.get("version"))
    require(before["status"] == "submitted", "This plan is not awaiting approval", 409)
    decision = data.get("decision")
    require(decision in {"approved", "revision_required"}, "Invalid approval decision")
    remarks = text(data.get("remarks"), "Review remarks", decision == "revision_required")
    after = {**before, "status": decision, "review_remarks": remarks}
    if decision == "approved":
        rows = validate_rows(db, employee, before["month"], before["rows"], before["published_rows"])
        protect_history(before, rows)
        after["published_rows"] = rows
        after["published_at"] = stamp()
    result = commit(db, "project_monthly_plans", before, after, event(decision, remarks=remarks))
    notify(db, employee, "Monthly plan reviewed", f"Your {before['month']} plan: {decision.replace('_', ' ')}. {remarks}")
    return result


def report_payload(data, evidence_required=False):
    status = data.get("status")
    require(status in STATUSES, "Select Completed, Pending or Not Completed")
    note = text(data.get("note"), "Completion details / progress / reason", True, 3000)
    evidence = text(data.get("evidence"), "Evidence link", evidence_required and status == "completed", 1500)
    if evidence:
        parsed = urlparse(evidence)
        require(parsed.scheme in {"https", "http"} and parsed.netloc, "Evidence must be an HTTP or HTTPS link")
    return {"status": status, "note": note, "evidence": evidence,
            "actual_quantity": number(data.get("actual_quantity", 0), "Actual quantity"), "submitted_at": stamp()}


def daily_report(db, data):
    me = own_employee(db)
    before = get_plan(db, str(me["_id"]), month(data.get("month")))
    check_version(before, data.get("version"))
    task = next((r for r in before["published_rows"] if r["id"] == data.get("task_id")), None)
    require(task, "Only published activities can be reported", 404)
    require(task["date"] <= today().isoformat(), "Future activity cannot be reported")
    report = report_payload(data, task["evidence_required"])
    report["submitted_date"] = today().isoformat()
    # On-time completion is based on first server-confirmed completion, never a client date.
    old = before["reports"].get(task["id"], {})
    if old.get("first_completed_date"):
        report["first_completed_date"] = old["first_completed_date"]
    if report["status"] == "completed":
        report["first_completed_date"] = old.get("first_completed_date") or today().isoformat()
    after = deepcopy(before)
    after["reports"][task["id"]] = report
    return commit(db, "project_monthly_plans", before, after, event("daily_report", task_id=task["id"], report=report))


def checkout_readiness(db, employee, day):
    # Called directly from attendance for web, mobile and offline sync.
    day = iso(day)
    exception = calendar_exception(db, employee, day)
    plan = db.project_monthly_plans.find_one({"tenant_id": employee["tenant_id"], "employee_id": str(employee["_id"]), "month": day[:7]}) or {}
    rows = [r for r in plan.get("published_rows", []) if r["date"] == day]
    reports = plan.get("reports", {})
    missing = [] if exception else [{"task_id": r["id"], "project_name": r["project_name"], "output": r["output"]}
                                   for r in rows if reports.get(r["id"], {}).get("status") not in STATUSES]
    # Pending/rejected requests and retrospective V2 records never gate checkout.
    # A completed attendance record remains authoritative even if approval arrives later.
    closed = db.attendance_logs.find_one({"tenant_id": employee["tenant_id"], "employee_id": str(employee["_id"]),
                                          "date": day, "is_deleted": {"$ne": True}, "check_out": {"$exists": True, "$nin": [None, "", False]}})
    extra = []
    if not exception and not closed:
        extra = list(db.project_unplanned_work.find({"tenant_id": employee["tenant_id"], "employee_id": str(employee["_id"]),
                                                     "date": day, "workflow_version": 3, "approval_status": "approved"}))
        missing.extend({"task_id": str(r["_id"]), "project_name": r["project_name"], "output": r["output"]}
                       for r in extra if r.get("report", {}).get("status") not in STATUSES)
    required = 0 if exception else len(rows) + len(extra)
    return {"date": day, "checkout_allowed": not missing, "required_count": required,
            "reported_count": required - len(missing), "missing_tasks": missing,
            "exception": exception, "code": "DAILY_WORK_REPORT_REQUIRED" if missing else "",
            "message": ("Submit reports in Projects → Daily Work: " + "; ".join(r["project_name"] + ": " + r["output"] for r in missing[:5])) if missing else "Daily reporting is complete."}


def seal_checkout_day(db, employee, day):
    """Serialize publication and checkout on the same monthly document.

    No MongoDB transaction is required. Publication uses the same document's
    version and rejects changes on sealed days, including an initially empty day.
    """
    for _ in range(4):
        before = get_plan(db, str(employee["_id"]), day[:7])
        ready = checkout_readiness(db, employee, day)
        if not ready["checkout_allowed"]:
            return ready, None
        if day in before.get("sealed_dates", {}):
            return ready, None
        token = uuid4().hex
        after = deepcopy(before)
        after.setdefault("sealed_dates", {})[day] = token
        try:
            commit(db, "project_monthly_plans", before, after, event("attendance_day_sealed", date=day))
            # Recheck after the CAS seal: an approval may have arrived between
            # readiness and sealing. If it did, release the seal and ask for a report.
            try:
                final = checkout_readiness(db, employee, day)
            except Exception:
                release_checkout_day(db, employee, day, token)
                raise
            if not final["checkout_allowed"]:
                release_checkout_day(db, employee, day, token)
                return final, None
            return final, token
        except PlanningError as exc:
            if exc.status != 409:
                raise
    raise PlanningError("Planning changed during checkout. Please try again", 409)


def release_checkout_day(db, employee, day, token):
    if token:
        db.project_monthly_plans.update_one({"_id": plan_key(str(employee["_id"]), day[:7]), "tenant_id": tenant(),
                                            "sealed_dates." + day: token},
                                           {"$unset": {"sealed_dates." + day: ""}, "$inc": {"version": 1}})


UNPLANNED_TYPES = ("assigned_project", "other_project", "non_project")
UNPLANNED_MODES = ("office", "field", "wfh")


def unplanned_project_type(employee, project):
    return "assigned_project" if aliases(employee).intersection(project_api().project_member_ids(project)) else "other_project"


def unplanned_options(db):
    me = own_employee(db)
    rows = []
    for project in db.projects.find(project_api().project_scope_query(db)):
        if project.get("planning_schema") != 1 or project.get("is_deleted") is True:
            continue
        if project.get("tenant_id") != tenant():
            continue
        if not (org_access() or project_api().can_view_project(db, project)):
            continue
        rows.append({"_id": str(project["_id"]), "name": project_api().project_name(project),
                     "function": project.get("function"), "start_date": project.get("start_date"),
                     "due_date": project.get("due_date"), "work_type": unplanned_project_type(me, project),
                     "deliverables": [{"id": d["id"], "title": d["title"]} for d in project.get("deliverables", [])]})
    return {"department": me.get("department", ""), "projects": sorted(rows, key=lambda r: r["name"].lower())}


def submit_unplanned(db, data, identifier=None):
    if identifier is not None:
        me, before = unplanned_owned(db, identifier, data)
        require(before["approval_status"] == "revision_required", "Only a returned request can be revised", 409)
    else:
        me, before = own_employee(db), None
    manager = reviewer(db, me)
    require(not any(k in data for k in ("status", "report", "actual_quantity", "note", "evidence", "execution_status", "started_at", "approved_at", "approval_status", "visit_id")),
            "Submit the proposed work only. Execution reports and visit linkage are available after approval")
    work_type = text(data.get("work_type", "assigned_project"), "Work type", True, 30)
    require(work_type in UNPLANNED_TYPES, "Select a valid work type")
    mode = text(data.get("work_mode", "office"), "Work location type", True, 20)
    require(mode in UNPLANNED_MODES, "Select Office, Field Work or Work From Home")
    day = iso(data.get("date"))
    require(day >= today().isoformat(), "Request work for today or a future date")
    department = text(me.get("department"), "Employee department", True, 200)
    deliverable = text(data.get("deliverable_id"), "Deliverable", False, 200)
    if work_type == "non_project":
        require(not data.get("project_id") and not deliverable, "Non-project work cannot reference a project or deliverable")
        project_id, name, code = "", "Non-project / Internal work", ""
        function = text(data.get("function"), "Function", True, 200)
    else:
        project = get_project(db, data.get("project_id"))
        require(unplanned_project_type(me, project) == work_type, "Selected work type does not match project membership", 403)
        require(project.get("planning_schema") == 1 and project["start_date"] <= day <= project["due_date"], "Date must fall inside a configured project period")
        project_id, name, code = str(project["_id"]), project_api().project_name(project), project["project_code"]
        function = project["function"]
        require(not data.get("function") or data["function"] == function, "Select the project's function")
        require(not deliverable or any(r["id"] == deliverable for r in project["deliverables"]), "Invalid deliverable")
    require(function in MASTER["functions"], "Select a predefined function")
    task_code = text(data.get("task_code"), "Standard task", True, 100)
    task = TASKS.get(task_code)
    require(task and task["function"] == function and task.get("status") == "Active", "Select an active task for this function")
    require(not data.get("activity") or data["activity"] == task["activity"], "Select a task belonging to the selected activity")
    unit = text(data.get("unit", "Count"), "Unit", True, 100)
    require(unit in MASTER["units"], "Select a predefined unit")
    priority = text(data.get("priority", "Medium"), "Priority", True, 100)
    require(priority in MASTER["priorities"], "Select a predefined priority")
    field_place = text(data.get("field_place"), "Place of visit", mode == "field", 300)
    field_district = text(data.get("field_district"), "District", mode == "field", 200)
    field_purpose = text(data.get("field_purpose"), "Purpose of field visit", mode == "field", 1000)
    if mode != "field":
        require(not any((field_place, field_district, field_purpose)), "Field visit details apply only to Field Work")
    planned_quantity = number(data.get("planned_quantity"), "Planned quantity", 0.000001)
    if before:
        identifier = before["_id"]
    else:
        key = text(data.get("request_id"), "Request ID", True, 64)
        require(re.fullmatch(r"[A-Za-z0-9_-]{8,64}", key), "Invalid request ID")
        identifier = ObjectId(sha256((tenant() + ":unplanned:" + str(me["_id"]) + key).encode()).hexdigest()[:24])
    # Attribute extra work to the employee's own reporting team, not a different project's team.
    leader = me if is_tl(me) else (project_api().resolve_employee(db, me.get("team_leader_id"), tenant()) if me.get("team_leader_id") else None)
    team_id = str(leader["_id"]) if leader and leader.get("tenant_id") == tenant() else ""
    doc = {"_id": identifier, "tenant_id": tenant(), "employee_id": str(me["_id"]),
           "employee_name": project_api().employee_display_name(me), "date": day, "month": day[:7],
           "project_id": project_id, "project_name": name, "project_code": code, "department": department, "function": function,
           "team_leader_id": team_id, "reviewer_id": str(manager["_id"]), "deliverable_id": deliverable,
           "work_type": work_type, "work_mode": mode, "unit": unit, "priority": priority,
           "field_place": field_place, "field_district": field_district, "field_purpose": field_purpose,
           "visit_id": "", "visit_title": "", "planned_quantity": planned_quantity, "workflow_version": 3,
           "execution_status": "not_authorized",
           "task_code": task["code"], "activity": task["activity"], "task": task["task"],
           "output": text(data.get("output"), "Unplanned output", True), "reason": text(data.get("reason"), "Justification", True),
           "hours": number(data.get("hours", 0), "Estimated hours", 0, 24), "approval_status": "submitted",
           "report": {"status": "unreported", "actual_quantity": 0, "note": "", "evidence": ""},
           "version": 1, "events": [event("unplanned_submitted")], "created_at": stamp()}
    if before:
        after = {**doc, "created_at": before["created_at"], "events": deepcopy(before.get("events", [])), "review_remarks": ""}
        result = commit(db, "project_unplanned_work", before, after, event("unplanned_resubmitted"))
        notify(db, manager, "Revised unplanned request awaiting review", result["output"])
        return result
    try:
        db.project_unplanned_work.insert_one(doc)
    except DuplicateKeyError:
        raise PlanningError("This unplanned submission has already been saved", 409)
    notify(db, manager, "Unplanned work awaiting review", doc["output"])
    return doc


def review_unplanned(db, identifier, data):
    before = db.project_unplanned_work.find_one({"_id": object_id(identifier), "tenant_id": tenant()})
    require(before, "Unplanned work not found", 404)
    employee = employee_by_id(db, before["employee_id"])
    require(can_review(db, employee), "Only the mapped independent reviewer can decide this work", 403)
    check_version(before, data.get("version"))
    require(before["approval_status"] == "submitted", "This submission has already been reviewed", 409)
    decision = data.get("decision")
    current = before.get("workflow_version") == 3
    require(decision in ({"approved", "rejected", "revision_required"} if current else {"approved", "rejected"}), "Invalid decision")
    remarks = text(data.get("remarks"), "Review remarks", decision != "approved")
    updated = {**before, "approval_status": decision, "review_remarks": remarks}
    if current:
        require(decision != "approved" or before["date"] >= today().isoformat(), "The requested date has passed. Request a revised date instead of approving.", 409)
        updated["execution_status"] = "not_started" if decision == "approved" else "not_authorized"
        if decision == "approved":
            updated["approved_at"] = stamp()
            updated["approved_by"] = str(g.current_user["_id"])
    after = commit(db, "project_unplanned_work", before, updated, event(decision, remarks=remarks))
    notify(db, employee, "Unplanned work reviewed", f"{before['output']}: {decision.replace('_', ' ')}. {remarks}")
    return unplanned_public(db, after)


def unplanned_owned(db, identifier, data=None):
    me = own_employee(db)
    row = db.project_unplanned_work.find_one({"_id": object_id(identifier), "tenant_id": tenant(), "employee_id": str(me["_id"])})
    require(row, "Unplanned request not found in your records", 404)
    require(row.get("workflow_version") == 3, "Historical submissions cannot be executed or revised", 409)
    if data is not None:
        check_version(row, data.get("version"))
    return me, row


def require_authorized_work(row):
    require(row["approval_status"] == "approved" and row.get("approved_at"), "Work must be approved before execution", 409)


def unplanned_visit_record(db, row):
    if not row.get("visit_id"):
        return None
    return db.field_visits.find_one({"_id": object_id(row["visit_id"]), "tenant_id": row["tenant_id"],
                                    "employee_ref_id": row["employee_id"], "unplanned_request_id": str(row["_id"]),
                                    "scheduled_date": row["date"], "is_deleted": {"$ne": True}})


def unplanned_public(db, row):
    # Derived from the existing GPS visit lifecycle; no duplicate GPS/travel writes.
    result = dict(row)
    if row.get("workflow_version") != 3:
        result["historical"] = True
        result["execution_status"] = row.get("report", {}).get("status", "unreported")
        return result
    if row.get("approval_status") != "approved":
        result["execution_status"] = "not_authorized"
    elif row.get("work_mode") == "field":
        visit = unplanned_visit_record(db, row)
        result["visit_status"] = visit.get("status") if visit else ""
        if visit and visit.get("status") in {"started", "reached", "completed"} and row.get("execution_status") == "not_started":
            result["execution_status"] = "in_progress"
        if visit and visit.get("started_at") and not result.get("started_at"):
            result["started_at"] = visit["started_at"]
    return result


def unplanned_visit_options(db, identifier):
    me, row = unplanned_owned(db, identifier)
    require_authorized_work(row)
    require(row.get("work_mode") == "field", "Only fieldwork can link a visit")
    return {"items": [{"_id": str(v["_id"]), "title": v.get("title", "Visit"), "status": v["status"]}
                      for v in db.field_visits.find({"tenant_id": tenant(), "employee_ref_id": str(me["_id"]),
                          "scheduled_date": row["date"], "status": "scheduled", "is_deleted": {"$ne": True},
                          "$or": [{"unplanned_request_id": {"$in": [None, ""]}}, {"unplanned_request_id": str(row["_id"])}]})]}


def attach_unplanned_visit(db, identifier, data):
    me, before = unplanned_owned(db, identifier, data)
    require_authorized_work(before)
    require(before.get("work_mode") == "field", "Only fieldwork can link a visit")
    require(before["date"] >= today().isoformat(), "The approved visit date has passed; report the reason or submit a new request")
    require(before.get("execution_status") != "completed", "Completed work cannot change its visit", 409)
    current = unplanned_visit_record(db, before)
    require(not current or current.get("status") == "cancelled", "This request already has a linked visit", 409)
    action = data.get("action")
    require(action in {"create_visit", "link_visit"}, "Choose create or link visit")
    from app.routes.field_visits import now_utc, current_user_id, employee_name
    association = str(before["_id"])
    if action == "create_visit":
        # A deterministic identifier makes retried creates idempotent.
        visit_oid = ObjectId(sha256((tenant() + ":unplanned-visit:" + association + ":" + before.get("visit_id", "")).encode()).hexdigest()[:24])
        now = now_utc()
        doc = {"_id": visit_oid, "tenant_id": tenant(), "employee_ref_id": str(me["_id"]),
               "employee_id": str(me.get("employee_id") or me.get("employee_code") or ""),
               "employee_code": str(me.get("employee_code") or me.get("emp_code") or ""),
               "employee_name": employee_name(me), "department": before["department"],
               "designation": str(me.get("designation") or ""), "title": before["output"],
               "description": f"{before['field_place']}, {before['field_district']}\n{before['field_purpose']}",
               "scheduled_date": before["date"], "status": "scheduled", "pictures": [], "visit_notes": "",
               "created_at": now, "updated_at": now, "created_by": current_user_id(), "is_deleted": False,
               "unplanned_request_id": association}
        try:
            db.field_visits.insert_one(doc)
        except DuplicateKeyError:
            # A previous request may have created the visit before the link was committed.
            pass
    else:
        visit_oid = object_id(data.get("visit_id"))
    query = {"_id": visit_oid, "tenant_id": tenant(), "employee_ref_id": str(me["_id"]),
             "scheduled_date": before["date"], "status": "scheduled", "is_deleted": {"$ne": True},
             "$or": [{"unplanned_request_id": {"$in": [None, ""]}}, {"unplanned_request_id": association}]}
    visit = db.field_visits.find_one(query)
    require(visit, "Select your own unstarted, unlinked visit for the approved date", 404)
    # Atomic claim against start/reschedule/another request. The visit route also checks
    # the backlink and approval state, so a partially linked visit cannot be started.
    changed = db.field_visits.update_one(query, {"$set": {"unplanned_request_id": association, "updated_at": now_utc()}})
    require(changed.matched_count == 1, "Visit changed. Reload before linking", 409)
    try:
        after = commit(db, "project_unplanned_work", before,
                       {**before, "visit_id": str(visit_oid), "visit_title": visit.get("title", "Visit")},
                       event("unplanned_visit_linked", visit_id=str(visit_oid)))
    except PlanningError:
        latest = db.project_unplanned_work.find_one({"_id": before["_id"], "tenant_id": tenant()})
        if latest and latest.get("visit_id") == str(visit_oid):
            return unplanned_public(db, latest)
        # Keep a resumable, blocked claim only if the record has not chosen another visit.
        if latest and latest.get("visit_id") and latest.get("visit_id") != before.get("visit_id"):
            claim = {"_id": visit_oid, "tenant_id": tenant(), "status": "scheduled", "unplanned_request_id": association}
            if action == "create_visit":
                # A newly-created duplicate must not become an unguarded standalone visit.
                db.field_visits.update_one(claim, {"$set": {"status": "cancelled", "cancellation_reason": "Concurrent link selected a different visit", "updated_at": now_utc()}})
            else:
                db.field_visits.update_one(claim, {"$unset": {"unplanned_request_id": ""}})
        raise
    return unplanned_public(db, after)


def execute_unplanned(db, identifier, data):
    me, before = unplanned_owned(db, identifier, data)
    require_authorized_work(before)
    action = data.get("action")
    require(action in {"start", "report"}, "Invalid execution action")
    require(before["date"] <= today().isoformat(), "Work cannot start or be reported before its approved date", 409)
    if action == "start":
        require(before.get("work_mode") != "field", "Start fieldwork using its linked My Visit", 409)
        require(before["date"] == today().isoformat(), "Start work on its approved date; otherwise request a new date", 409)
        require(not before.get("started_at") and before.get("execution_status") != "completed", "Work already started or completed", 409)
        after = {**before, "execution_status": "in_progress", "started_at": stamp()}
        return commit(db, "project_unplanned_work", before, after, event("unplanned_started"))
    report = report_payload(data)
    visit = unplanned_visit_record(db, before) if before.get("work_mode") == "field" else None
    started = bool(visit and visit.get("status") in {"started", "reached", "completed"}) if before.get("work_mode") == "field" else bool(before.get("started_at"))
    require(started or (report["status"] != "completed" and report["actual_quantity"] == 0), "Start approved work before reporting completion or actual output", 409)
    if before.get("work_mode") == "field" and report["status"] == "completed":
        require(visit and visit.get("status") == "completed", "Complete the linked My Visit before reporting fieldwork as completed", 409)
    if before.get("execution_status") == "completed":
        require(report["status"] == "completed", "Completed work can only receive a corrected completion report", 409)
    report["submitted_date"] = today().isoformat()
    after = {**before, "report": report, "execution_status": report["status"]}
    if visit and visit.get("started_at"):
        after["started_at"] = visit["started_at"]
    return unplanned_public(db, commit(db, "project_unplanned_work", before, after, event("unplanned_reported", report=report)))

INDEX_SPECS = [
    ("project_monthly_plans", [("tenant_id", 1), ("employee_id", 1), ("month", 1)], {"unique": True, "name": "one_employee_month"}),
    ("project_monthly_plans", [("tenant_id", 1), ("status", 1), ("reviewer_id", 1)], {}),
    ("project_monthly_targets", [("tenant_id", 1), ("employee_id", 1), ("month", 1)], {}),
    ("project_monthly_targets", [("tenant_id", 1), ("project_id", 1), ("deliverable_id", 1)], {}),
    ("project_unplanned_work", [("tenant_id", 1), ("employee_id", 1), ("date", 1)], {}),
    ("project_unplanned_work", [("tenant_id", 1), ("approval_status", 1), ("reviewer_id", 1)], {}),
]


def ensure_indexes(db):
    for collection, keys, options in INDEX_SPECS:
        db[collection].create_index(keys, **options)
