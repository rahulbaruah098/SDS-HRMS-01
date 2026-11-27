from functools import wraps
from datetime import date, timedelta

from flask import Blueprint, jsonify, request, send_file
from app.services import team_responsibility as responsibility
from app.extensions import get_db
from app.routes.projects import tenant_project_required
from app.utils.serializers import clean_doc
from app.services import project_planning as p
from app.services import project_performance as perf

planning_bp = Blueprint("project_planning", __name__)


def endpoint(fn):
    @wraps(fn)
    @tenant_project_required
    def wrapped(*args, **kwargs):
        try:
            p.tenant()
            if p.project_api().is_hr_project_blocked_user():
                return p.project_api().hr_project_access_denied_response()
            if request.method in {"POST", "PATCH", "PUT"}:
                p.require(isinstance(request.get_json(silent=True), dict), "Expected a JSON object")
            return fn(*args, **kwargs)
        except p.PlanningError as exc:
            return jsonify({"message": str(exc), "code": exc.code}), exc.status
    return wrapped


def response(item, status=200):
    return jsonify(clean_doc(item)), status


@planning_bp.get("/options")
@endpoint
def options():
    db = get_db()
    me = p.project_api().get_current_employee(db)
    people = p.detail_employees(db)
    # Creation options are always operationally scoped, even for HR/Admin.
    leaders = [e for e in db.employees.find({'tenant_id': p.tenant()})
               if responsibility.can_manage_team(db, p.tenant(), me, e['_id'])
               and responsibility.effective(db, p.tenant(), e['_id'])[0]]
    leader_id = request.args.get("team_leader_id")
    eligible = []
    if leader_id:
        leader = next((e for e in leaders if str(e["_id"]) == leader_id), None)
        p.require(leader, "Team Leader is outside your scope", 403)
        department = p.text(leader.get("department"), "Team Leader department", True)
        eligible = p.eligible_members(db, leader, department)
    public = lambda e: {"id": str(e["_id"]), "name": p.project_api().employee_display_name(e), "department": e.get("department", ""), "employee_code": p.project_api().employee_code(e), "is_active": responsibility.employee_is_active(e)}
    leader_options = []
    for e in leaders:
        effective, state, _ = responsibility.effective(db, p.tenant(), e['_id'])
        item = public(e)
        item.update({'succession_status': state, 'effective_leader': public(effective),
                     'reporting_officer_id': str(e.get('reporting_officer_id') or '')})
        if state != 'active':
            item['name'] = f"{item['name']}'s team — {p.project_api().employee_display_name(effective)} ({state.replace('_', ' ')})"
        leader_options.append(item)
    return response({"master": p.MASTER, "departments": p.departments(db), "employees": [public(e) for e in people],
                     "team_leaders": leader_options,
                     "monitoring_team_leaders": [public(e) for e in people if p.is_tl(e) or str(e['_id']) in {str(s['_id']) for s in responsibility.sources(db, p.tenant())}],
                     "delegated_teams": [responsibility.describe(db, p.tenant(), source) for source in responsibility.sources(db, p.tenant())
                         if responsibility.can_lead(db, p.tenant(), me, source['_id']) and responsibility.effective(db, p.tenant(), source['_id'])[1] != 'active'], "eligible_members": [public(e) for e in eligible],
                     "current_employee": public(me) if me else None, "organisation_access": p.org_access(),
                     "can_create": p.project_api().can_create_assign_or_collaborate_projects(db),
                     "can_manage": p.project_api().can_create_assign_or_collaborate_projects(db)})


@planning_bp.get("/targets")
@endpoint
def targets():
    db = get_db()
    period = p.month(request.args.get("month"))
    ids = [str(e["_id"]) for e in p.detail_employees(db)]
    if request.args.get("employee_id"):
        p.authorize_employee(db, request.args["employee_id"])
        ids = [request.args["employee_id"]]
    rows = list(db.project_monthly_targets.find({"tenant_id": p.tenant(), "employee_id": {"$in": ids}, "month": period}).sort("due_date", 1))
    for row in rows:
        project = db.projects.find_one({'_id': p.object_id(row['project_id']), 'tenant_id': p.tenant()})
        row['can_manage'] = bool(project and p.project_api().can_manage_project_team(db, project))
    return response({'items': rows})


@planning_bp.post("/targets")
@endpoint
def create_target():
    data = request.get_json()
    if "employee_ids" in data:
        result = p.save_targets(get_db(), data)
        return response(result, 201 if result["created_count"] else 200)
    return response({"item": p.save_target(get_db(), data)}, 201)


@planning_bp.patch("/targets/<identifier>/review")
@endpoint
def target_review(identifier):
    db, data = get_db(), request.get_json()
    before = p.target_by_id(db, identifier)
    p.get_project(db, before["project_id"], manage=True)
    p.authorize_employee(db, before["employee_id"])
    p.check_version(before, data.get("version"))
    after = {**before, "assessment": p.text(data.get("assessment"), "Manager assessment", True),
             "corrective_action": p.text(data.get("corrective_action"), "Corrective action")}
    return response({"item": p.commit(db, "project_monthly_targets", before, after, p.event("monthly_review", assessment=after["assessment"], corrective_action=after["corrective_action"]))})


@planning_bp.get("/monthly")
@endpoint
def monthly():
    db = get_db()
    employee_id = request.args.get("employee_id") or str(p.own_employee(db)["_id"])
    doc = p.get_plan(db, employee_id, p.month(request.args.get("month")))
    doc["can_review"] = p.can_review(db, p.employee_by_id(db, employee_id))
    return response({"item": doc})


@planning_bp.put("/monthly")
@endpoint
def save_monthly():
    return response({"item": p.save_plan(get_db(), request.get_json())})


@planning_bp.post("/monthly/submit")
@endpoint
def submit_monthly():
    return response({"item": p.submit_plan(get_db(), request.get_json())})


@planning_bp.post("/monthly/<identifier>/review")
@endpoint
def review_monthly(identifier):
    return response({"item": p.review_plan(get_db(), identifier, request.get_json())})


@planning_bp.get("/schedule")
@endpoint
def schedule():
    db = get_db()
    employee_id = request.args.get("employee_id") or str(p.own_employee(db)["_id"])
    employee = p.authorize_employee(db, employee_id)
    start, end = perf.bounds(request.args)
    p.require((date.fromisoformat(end) - date.fromisoformat(start)).days <= 62, "Schedule view supports up to 62 days")
    items = perf.execution_rows(db, [employee_id], start, end, {})
    days, cursor = [], date.fromisoformat(start)
    while cursor.isoformat() <= end:
        day = cursor.isoformat()
        days.append({"date": day, "exception": p.calendar_exception(db, employee, day), "tasks": [r for r in items if r["date"] == day],
                     "week_start": (cursor - timedelta(days=cursor.weekday())).isoformat()})
        cursor += timedelta(days=1)
    return response({"days": days})


@planning_bp.post("/daily-report")
@endpoint
def daily_report():
    return response({"item": p.daily_report(get_db(), request.get_json())})


@planning_bp.get("/checkout-readiness")
@endpoint
def checkout_readiness():
    db = get_db()
    return response(p.checkout_readiness(db, p.own_employee(db), request.args.get("date") or p.today().isoformat()))


@planning_bp.get("/unplanned/options")
@endpoint
def unplanned_work_options():
    return response(p.unplanned_options(get_db()))


@planning_bp.get("/unplanned")
@endpoint
def unplanned():
    db = get_db()
    period = p.month(request.args.get("month"))
    people = p.detail_employees(db)
    ids = [str(e["_id"]) for e in people]
    if request.args.get("employee_id"):
        p.authorize_employee(db, request.args["employee_id"])
        ids = [request.args["employee_id"]]
    rows = list(db.project_unplanned_work.find({"tenant_id": p.tenant(), "employee_id": {"$in": ids}, "month": period}).sort("date", -1))
    for row in rows:
        row["can_review"] = p.can_review(db, p.employee_by_id(db, row["employee_id"]))
    return response({"items": [p.unplanned_public(db, row) for row in rows]})


@planning_bp.post("/unplanned")
@endpoint
def new_unplanned():
    return response({"item": p.submit_unplanned(get_db(), request.get_json())}, 201)


@planning_bp.post("/unplanned/<identifier>/review")
@endpoint
def review_unplanned(identifier):
    return response({"item": p.review_unplanned(get_db(), identifier, request.get_json())})


@planning_bp.post("/unplanned/<identifier>/revise")
@endpoint
def revise_unplanned(identifier):
    return response({"item": p.submit_unplanned(get_db(), request.get_json(), identifier)})


@planning_bp.post("/unplanned/<identifier>/execute")
@endpoint
def execute_unplanned(identifier):
    return response({"item": p.execute_unplanned(get_db(), identifier, request.get_json())})


@planning_bp.get("/unplanned/<identifier>/visits")
@endpoint
def unplanned_visit_options(identifier):
    return response(p.unplanned_visit_options(get_db(), identifier))


@planning_bp.post("/unplanned/<identifier>/visits")
@endpoint
def attach_unplanned_visit(identifier):
    return response({"item": p.attach_unplanned_visit(get_db(), identifier, request.get_json())})


@planning_bp.get("/approvals")
@endpoint
def approvals():
    db = get_db()
    ids = [str(e["_id"]) for e in p.detail_employees(db) if p.can_review(db, e)]
    return response({"plans": list(db.project_monthly_plans.find({"tenant_id": p.tenant(), "employee_id": {"$in": ids}, "status": "submitted"})),
                     "unplanned": list(db.project_unplanned_work.find({"tenant_id": p.tenant(), "employee_id": {"$in": ids}, "approval_status": "submitted"}))})


@planning_bp.get("/performance")
@endpoint
def performance():
    return response(perf.dashboard(get_db(), request.args))


@planning_bp.get("/export")
@endpoint
def export():
    report_type = request.args.get("report", "employee")
    p.require(report_type in {"employee", "team", "project", "organisation"}, "Invalid report type")
    p.require(report_type != "organisation" or p.org_access(), "Organisation export requires Managing Director or administrator access", 403)
    data = perf.dashboard(get_db(), request.args)
    return send_file(perf.export_workbook(data, report_type), as_attachment=True,
                     download_name=f"YourComate_{report_type}_{data['date_from']}_{data['date_to']}.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
