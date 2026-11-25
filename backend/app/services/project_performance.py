"""Permission-scoped execution measures; quantities are never mixed across units."""
from collections import defaultdict
from datetime import date, timedelta
from io import BytesIO

from app.services import project_planning as p


DEFINITIONS = {
    "completion_rate": "Completed planned activities / published planned activities × 100. Task counts are execution measures, not an employee rating.",
    "reporting_rate": "Reported due activities / due activities × 100. Future work is excluded; Pending and Not Completed are valid reports.",
    "on_time_rate": "Activities first reported Completed on or before their planned date / all completed planned activities × 100. Server receipt date is authoritative.",
    "overdue": "Published activities with a planned date before today and without a Completed report.",
    "target_achievement": "Actual quantity from daily reports / monthly target quantity × 100, per target (Excel Monthly Review formula). Quantities in different units are not summed.",
    "unplanned": "V3 approved requests are authorized work, not completed work. Only completed execution reports count as completed additional work. Historical retrospective submissions are shown separately. No additional work inflates planned completion or monthly target achievement.",
    "deliverables": "Deliverable status is the manager's recorded contractual status. Related task and target progress are shown separately.",
    "exceptions": "Approved full-day leave and non-working days without approved holiday work are excluded from the checkout gate, not erased from the plan or analytics.",
}


def bounds(params):
    if params.get("date_from") or params.get("date_to"):
        start, end = p.iso(params.get("date_from")), p.iso(params.get("date_to"))
    elif params.get("year"):
        year = str(params["year"])
        start, end = p.iso(year + "-01-01"), p.iso(year + "-12-31")
    else:
        period = p.month(params.get("month") or p.today().strftime("%Y-%m"))
        first = date.fromisoformat(period + "-01")
        next_month = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
        start, end = first.isoformat(), (next_month - timedelta(days=1)).isoformat()
    p.require(start <= end and (date.fromisoformat(end) - date.fromisoformat(start)).days <= 1096, "Select a date range of up to three years")
    return start, end


def matches(row, params):
    keys = {"employee_id": "employee_id", "project_id": "project_id", "team_id": "team_leader_id", "department": "department", "function": "function"}
    return all(not params.get(query) or str(row.get(field, "")) == str(params[query]) for query, field in keys.items())


def execution_rows(db, employee_ids, start, end, params):
    rows = []
    plans = db.project_monthly_plans.find({"tenant_id": p.tenant(), "employee_id": {"$in": list(employee_ids)}, "month": {"$gte": start[:7], "$lte": end[:7]}})
    for plan in plans:
        for row in plan.get("published_rows", []):
            if not start <= row["date"] <= end or not matches(row, params):
                continue
            report = plan.get("reports", {}).get(row["id"], {})
            status = report.get("status", "unreported")
            if params.get("status") and params["status"] != status:
                continue
            rows.append({**row, "employee_name": plan["employee_name"], "status": status,
                         "actual_quantity": report.get("actual_quantity", 0), "note": report.get("note", ""),
                         "evidence": report.get("evidence", ""), "submitted_at": report.get("submitted_at", ""),
                         "completed_date": report.get("first_completed_date", ""), "month": plan["month"],
                         "reported": bool(report), "unplanned": False})
    return rows


def metrics(rows):
    due = [r for r in rows if r["date"] <= p.today().isoformat()]
    complete = [r for r in rows if r["status"] == "completed"]
    return {"assigned": len(rows), "completed": len(complete), "pending": sum(r["status"] == "pending" for r in rows),
            "not_completed": sum(r["status"] == "not_completed" for r in rows), "unreported": sum(not r["reported"] for r in rows),
            "overdue": sum(r["date"] < p.today().isoformat() and r["status"] != "completed" for r in rows),
            "due": len(due), "reported_due": sum(r["reported"] for r in due),
            "completion_rate": round(100 * len(complete) / len(rows), 1) if rows else 0,
            "reporting_rate": round(100 * sum(r["reported"] for r in due) / len(due), 1) if due else 0,
            "on_time_rate": round(100 * sum(bool(r["completed_date"]) and r["completed_date"] <= r["date"] for r in complete) / len(complete), 1) if complete else 0}


def group(rows, key, labels=None):
    grouped = defaultdict(list)
    for row in rows:
        grouped[str(key(row) if callable(key) else row.get(key, "Unassigned"))].append(row)
    return [{"id": k, "label": (labels or {}).get(k, k), **metrics(v)} for k, v in sorted(grouped.items())]


def dashboard(db, params):
    start, end = bounds(params)
    people = p.detail_employees(db)
    ids = {str(e["_id"]) for e in people}
    if params.get("employee_id"):
        p.require(params["employee_id"] in ids, "Employee performance is outside your scope", 403)
        ids = {params["employee_id"]}
    status = params.get("status")
    p.require(not status or status in {*p.STATUSES, "unreported"}, "Invalid activity status")
    rows = execution_rows(db, ids, start, end, params)
    names = {str(e["_id"]): p.project_api().employee_display_name(e) for e in people}
    project_names = {r["project_id"]: r["project_name"] for r in rows}
    # Team labels are public aggregates; individual names/data are never attached to comparisons.
    leaders = {str(e["_id"]): e.get("department", "Team") + " team" for e in db.employees.find({"tenant_id": p.tenant(), "is_team_leader": True}, {"department": 1})}
    unplanned = [p.unplanned_public(db, r) for r in db.project_unplanned_work.find({"tenant_id": p.tenant(), "employee_id": {"$in": list(ids)}, "date": {"$gte": start, "$lte": end}}) if matches(r, params) and (not status or r.get("report", {}).get("status") == status)]
    target_rows = []
    # Quantity actuals deliberately use all daily statuses, even when a chart status filter is selected.
    quantity_params = {k: v for k, v in params.items() if k != "status"}
    quantity_rows = execution_rows(db, ids, start, end, quantity_params)
    for t in db.project_monthly_targets.find({"tenant_id": p.tenant(), "employee_id": {"$in": list(ids)}, "month": {"$gte": start[:7], "$lte": end[:7]}}):
        if not matches(t, params):
            continue
        actual = sum(r["actual_quantity"] for r in quantity_rows if r["target_id"] == str(t["_id"]))
        target_rows.append({**t, "actual_quantity": actual, "achievement_percent": round(100 * actual / t["quantity"], 1) if t["quantity"] else 0})
    deliverables = []
    for project in db.projects.find(p.project_api().project_scope_query(db)):
        if params.get("project_id") and str(project["_id"]) != params["project_id"]:
            continue
        if params.get("department") and project.get("department") != params["department"]:
            continue
        if params.get("function") and project.get("function") != params["function"]:
            continue
        for d in project.get("deliverables", []):
            deliverables.append({**d, "project_id": str(project["_id"]), "project_name": p.project_api().project_name(project),
                                 "related_tasks": metrics([r for r in rows if r["project_id"] == str(project["_id"]) and r["deliverable_id"] == d["id"]])})
    comparisons = []
    me = p.project_api().get_current_employee(db)
    if p.org_access() or (me and (p.is_tl(me) or p.is_ro(me))):
        all_ids = [str(e["_id"]) for e in db.employees.find({"tenant_id": p.tenant()}, {"_id": 1})]
        # Deliberately independent of employee/project/status filters to prevent differencing a private person's results.
        all_rows = execution_rows(db, all_ids, start, end, {})
        comparisons = group(all_rows, "team_leader_id", leaders)
        for item in comparisons:
            item.pop("id", None)
    summary = metrics(rows)
    summary["approved_unplanned"] = sum(r["approval_status"] == "approved" for r in unplanned)
    v3 = [r for r in unplanned if r.get("workflow_version") == 3]
    approved = [r for r in v3 if r["approval_status"] == "approved"]
    summary["authorized_unplanned"] = len(approved)
    summary["completed_unplanned"] = sum(r.get("execution_status") == "completed" and r.get("report", {}).get("status") == "completed" for r in approved)
    summary["in_progress_unplanned"] = sum(r.get("execution_status") == "in_progress" for r in approved)
    summary["not_started_unplanned"] = sum(r.get("execution_status") == "not_started" for r in approved)
    summary["work_pending_unplanned"] = sum(r.get("execution_status") == "pending" for r in approved)
    summary["not_completed_unplanned"] = sum(r.get("execution_status") == "not_completed" for r in approved)
    summary["revision_unplanned"] = sum(r["approval_status"] == "revision_required" for r in v3)
    summary["historical_unplanned"] = len(unplanned) - len(v3)
    summary["pending_unplanned"] = sum(r["approval_status"] == "submitted" for r in unplanned)
    summary["rejected_unplanned"] = sum(r["approval_status"] == "rejected" for r in unplanned)
    for kind in p.UNPLANNED_TYPES:
        summary["unplanned_" + kind] = sum(r.get("work_type", "assigned_project") == kind for r in unplanned)
    summary["unplanned_fieldwork"] = sum(r.get("work_mode", "office") == "field" for r in unplanned)
    summary["deliverables_completed"] = sum(d["status"] == "Completed" for d in deliverables)
    summary["deliverables_total"] = len(deliverables)
    return {"date_from": start, "date_to": end, "summary": summary, "definitions": DEFINITIONS,
            "employees": group(rows, "employee_id", names), "teams": group(rows, "team_leader_id", leaders),
            "projects": group(rows, "project_id", project_names), "departments": group(rows, "department"),
            "weeks": group(rows, lambda r: (date.fromisoformat(r["date"]) - timedelta(days=date.fromisoformat(r["date"]).weekday())).isoformat()),
            "months": group(rows, "month"), "team_comparison": comparisons, "targets": target_rows,
            "deliverables": deliverables, "activities": rows, "unplanned": unplanned, "organisation_access": p.org_access()}


def export_workbook(data, report_type):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    wb = Workbook()
    wb.remove(wb.active)

    def sheet(title, headers, rows):
        ws = wb.create_sheet(title)
        ws.append(headers)
        for row in rows:
            safe = []
            for value in row:
                if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                    value = "'" + value
                safe.append(value)
            ws.append(safe)
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="273B6D")
            c.alignment = Alignment(wrap_text=True)
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        for i in range(1, len(headers) + 1):
            ws.column_dimensions[get_column_letter(i)].width = min(48, max(16, len(headers[i-1]) + 4))
        for row in ws.iter_rows(min_row=2):
            for c in row:
                if isinstance(c.value, (int, float)):
                    c.number_format = "0.00"
                if c.column <= len(headers) and headers[c.column-1] in {"Planned date", "Due date", "From", "To"} and isinstance(c.value, str):
                    try:
                        c.value = date.fromisoformat(c.value)
                        c.number_format = "dd mmm yyyy"
                    except ValueError:
                        pass
                c.alignment = Alignment(vertical="top", wrap_text=True)
        return ws

    sheet("Summary", ["Measure", "Value"], [["Report", report_type], ["From", data["date_from"]], ["To", data["date_to"]]] + [[k.replace("_", " ").title(), v] for k, v in data["summary"].items()])
    keys = ["assigned", "completed", "pending", "not_completed", "unreported", "overdue", "completion_rate", "on_time_rate", "reporting_rate"]
    for key in {"employee": ["employees"], "team": ["teams", "employees"], "project": ["projects"], "organisation": ["departments", "teams", "projects", "employees"]}[report_type]:
        sheet(key.title(), ["Name"] + [k.replace("_", " ").title() for k in keys], [[r["label"]] + [r[k] for k in keys] for r in data[key]])
    sheet("Daily Activities", ["Employee", "Employee ID", "Department", "Team ID", "Project", "Project code", "Function", "Target ID", "Task ID", "Activity", "Task", "Output", "Planned date", "Status", "Unit", "Planned quantity", "Actual quantity", "Hours", "Evidence", "Progress or reason"],
          [[r.get(k, "") for k in ["employee_name", "employee_id", "department", "team_leader_id", "project_name", "project_code", "function", "target_id", "id", "activity", "task", "output", "date", "status", "unit", "quantity", "actual_quantity", "hours", "evidence", "note"]] for r in data["activities"]])
    sheet("Monthly Review", ["Month", "Project code", "Target ID", "Employee", "Output", "Unit", "Target quantity", "Actual quantity", "Achievement %", "Manager assessment", "Corrective action"],
          [[r["month"], r["project_code"], str(r["_id"]), r["employee_name"], r["output"], r["unit"], r["quantity"], r["actual_quantity"], r["achievement_percent"], r.get("assessment", ""), r.get("corrective_action", "")] for r in data["targets"]])
    sheet("Deliverables", ["Project", "Deliverable ID", "Deliverable", "Due date", "Status", "Notes"], [[r["project_name"], r["id"], r["title"], r["due_date"], r["status"], r["notes"]] for r in data["deliverables"]])
    work_types = {"assigned_project": "Assigned project work", "other_project": "Other project work", "non_project": "Non-project / Internal work"}
    work_modes = {"office": "Office", "field": "Field Work", "wfh": "Work From Home"}
    sheet("Unplanned Work", ["Employee", "Project", "Planned date", "Output", "Justification", "Approval", "Work status", "Progress or reason", "Work type", "Work location", "Department", "Function", "Activity", "Task", "Task code", "Unit", "Actual quantity", "Estimated hours", "Priority", "Place of visit", "District", "Visit purpose", "My Visit ID", "My Visit title", "Evidence", "Review remarks", "Workflow", "Planned quantity", "Execution status", "Approved at", "Approved by user ID", "Started at", "Report submitted at", "Visit status"],
          [[r["employee_name"], r["project_name"], r["date"], r["output"], r["reason"], r["approval_status"], r["report"]["status"], r["report"]["note"], work_types.get(r.get("work_type", "assigned_project"), "Unknown"), work_modes.get(r.get("work_mode", "office"), "Unknown"), r.get("department", ""), r.get("function", ""), r.get("activity", ""), r.get("task", ""), r.get("task_code", ""), r.get("unit", "Count"), r["report"].get("actual_quantity", 0), r.get("hours", 0), r.get("priority", ""), r.get("field_place", ""), r.get("field_district", ""), r.get("field_purpose", ""), r.get("visit_id", ""), r.get("visit_title", ""), r["report"].get("evidence", ""), r.get("review_remarks", ""), "Approval first (V3)" if r.get("workflow_version") == 3 else "Historical retrospective", r.get("planned_quantity", ""), r.get("execution_status", r["report"].get("status", "")), r.get("approved_at", ""), r.get("approved_by", ""), str(r.get("started_at") or ""), r["report"].get("submitted_at", ""), r.get("visit_status", "")] for r in data["unplanned"]])
    sheet("Metric Definitions", ["Metric", "Definition"], list(DEFINITIONS.items()))
    result = BytesIO()
    wb.save(result)
    result.seek(0)
    return result
