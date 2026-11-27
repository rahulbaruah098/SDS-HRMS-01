"""Isolated HTTP/domain tests. Uses real JWT/tenant guards and mongomock only.
No real MongoDB connection, user record, face model or mail delivery is required.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from uuid import uuid4

import jwt
import mongomock
import openpyxl
import pytest
from bson import ObjectId
from flask import Flask, g

from app import extensions
from app.routes.projects import projects_bp
from app.routes.project_planning import planning_bp
from app.routes.attendance import attendance_bp
from app.routes.crud import crud_bp
from app.routes.field_visits import field_visits_bp
from app.routes import attendance
from app.services import project_planning as p
from app.services import project_performance as perf


@pytest.fixture
def env(monkeypatch):
    db = mongomock.MongoClient().planning_tests
    monkeypatch.setattr(extensions, "db", db)
    monkeypatch.setattr(attendance, "now_local", lambda: datetime(2026, 11, 23, 18, 30))
    p.ensure_indexes(db)
    app = Flask(__name__)
    app.config.update(TESTING=True, JWT_SECRET_KEY="isolated-planning-tests-only", DEFAULT_TENANT_ID="alpha")
    app.register_blueprint(planning_bp, url_prefix="/api/v1/projects/planning")
    app.register_blueprint(projects_bp, url_prefix="/api/v1/projects")
    app.register_blueprint(attendance_bp, url_prefix="/api/v1/attendance")
    app.register_blueprint(field_visits_bp, url_prefix="/api/v1/field-visits")
    app.register_blueprint(crud_bp, url_prefix="/api/v1")
    for tenant in ["alpha", "beta"]:
        db.tenants.insert_one({"tenant_id": tenant, "name": tenant, "status": "active", "is_lifetime": True, "is_deleted": False})
        for department in ["IT", "Finance"]:
            db.departments.insert_one({"tenant_id": tenant, "name": department, "is_deleted": False})
    people, users = {}, {}
    def person(key, department="IT", tenant="alpha", roles=None, tl=False, ro=False, leader=None, officer=None):
        eid, uid = ObjectId(), ObjectId()
        users[key] = {"_id": uid, "tenant_id": tenant, "email": key + "@example.test", "name": key, "roles": roles or ["employee"], "is_active": True}
        people[key] = {"_id": eid, "tenant_id": tenant, "user_id": str(uid), "name": key, "employee_id": "TEST-" + key, "email": key + "@example.test", "department": department,
                       "is_team_leader": tl, "is_reporting_officer": ro, "status": "active", "is_deleted": False,
                       "team_leader_id": str(people[leader]["_id"]) if leader else "", "reporting_officer_id": str(people[officer]["_id"]) if officer else ""}
        db.users.insert_one(deepcopy(users[key])); db.employees.insert_one(deepcopy(people[key]))
    person("ro", ro=True)
    person("tl", tl=True, officer="ro")
    person("employee", leader="tl", officer="ro")
    person("employee2", leader="tl", officer="ro")
    person("other_tl", department="Finance", tl=True)
    person("outsider", department="Finance", leader="other_tl")
    person("admin", roles=["admin"])
    person("director", roles=["managing_director"])
    person("title_only")
    db.employees.update_one({"_id": people["title_only"]["_id"]}, {"$set": {"designation": "Managing Director"}})
    person("foreign_tl", tenant="beta", tl=True)
    person("foreign", tenant="beta", leader="foreign_tl")
    client = app.test_client()
    def call(user, method, path, data=None, **kwargs):
        token = jwt.encode({"sub": str(users[user]["_id"]), "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, app.config["JWT_SECRET_KEY"], algorithm="HS256")
        return client.open("/api/v1" + path, method=method, json=data, headers={"Authorization": "Bearer " + token}, **kwargs)
    return type("Env", (), {"db": db, "app": app, "people": people, "users": users, "call": staticmethod(call), "client": client})()


def project_payload(env, **overrides):
    return {"name": "Delivery platform", "project_type": "client", "client_name": "Example client", "start_date": "2026-11-01", "due_date": "2027-02-28", "department": "IT", "function": "IT & HRMS",
            "team_leader_id": str(env.people["tl"]["_id"]), "primary_assignee_id": str(env.people["employee"]["_id"]),
            "assigned_employee_ids": [str(env.people["employee"]["_id"]), str(env.people["employee2"]["_id"])], "collaborator_ids": [],
            "deliverables": [{"id": "milestone-1", "title": "Ship tested release", "due_date": "2027-02-28", "status": "Not Started", "notes": ""}], **overrides}


def create_project(env, user="tl", **overrides):
    result = env.call(user, "POST", "/projects", project_payload(env, **overrides))
    assert result.status_code == 201, result.get_json()
    return result.get_json()["item"]


def create_target(env, project, employee="employee", period="2026-11", **overrides):
    task = next(t for t in p.MASTER["tasks"] if t["function"] == project["function"])
    payload = {"request_id": uuid4().hex, "month": period, "project_id": project["_id"], "deliverable_id": project["deliverables"][0]["id"],
               "employee_id": str(env.people[employee]["_id"]), "output": "Deliver reviewed output", "unit": "Count", "quantity": 10,
               "activity": task["activity"], "due_date": period + "-28", "expected_evidence": "Report link", "priority": "High", **overrides}
    response = env.call("tl", "POST", "/projects/planning/targets", payload)
    assert response.status_code == 201, response.get_json()
    return response.get_json()["item"]


def dated_row(target, day="2026-11-23", **overrides):
    task = next(t for t in p.MASTER["tasks"] if t["function"] == target["function"] and t["activity"] == target["activity"])
    return {"id": uuid4().hex, "target_id": target["_id"], "date": day, "task_code": task["code"], "output": "Prepare and review output", "quantity": 5, "hours": 3, **overrides}


def publish(env, rows, employee="employee", period="2026-11", reviewer="tl"):
    result = env.call(employee, "PUT", "/projects/planning/monthly", {"month": period, "version": 0, "rows": rows})
    assert result.status_code == 200, result.get_json()
    doc = result.get_json()["item"]
    result = env.call(employee, "POST", "/projects/planning/monthly/submit", {"month": period, "version": doc["version"]})
    assert result.status_code == 200, result.get_json()
    doc = result.get_json()["item"]
    result = env.call(reviewer, "POST", f"/projects/planning/monthly/{doc['_id']}/review", {"version": doc["version"], "decision": "approved"})
    assert result.status_code == 200, result.get_json()
    return result.get_json()["item"]


def report(env, plan, task, status="completed", **overrides):
    result = env.call("employee", "POST", "/projects/planning/daily-report", {"month": plan["month"], "version": plan["version"], "task_id": task["id"], "status": status, "note": "Meaningful update with actual result", "actual_quantity": 4, **overrides})
    assert result.status_code == 200, result.get_json()
    return result.get_json()["item"]


@pytest.mark.parametrize("user,expected", [("employee", 403), ("outsider", 403), ("director", 403), ("title_only", 403), ("tl", 201), ("ro", 201), ("admin", 403)])
def test_project_creation_permissions(env, user, expected):
    assert env.call(user, "POST", "/projects", project_payload(env)).status_code == expected


@pytest.mark.parametrize("changes", [{"client_name": ""}, {"project_type": "unknown"}, {"start_date": "2027-03-01"}, {"department": "Unknown"}, {"function": "Unapproved function"}, {"deliverables": []}, {"due_date": "invalid"}])
def test_project_validation(env, changes):
    assert env.call("tl", "POST", "/projects", project_payload(env, **changes)).status_code == 400


def test_in_house_clears_client_and_supports_many_projects(env):
    a = create_project(env, project_type="in_house", client_name="should clear")
    b = create_project(env, name="Second parallel project")
    assert a["client_name"] == "" and a["_id"] != b["_id"]
    assert a["department"] == b["department"]


@pytest.mark.parametrize("key", ["primary_assignee_id", "collaborator_ids", "assigned_employee_ids"])
def test_team_member_selection_enforced_server_side(env, key):
    value = str(env.people["outsider"]["_id"])
    if key.endswith("_ids"): value = [value]
    assert env.call("tl", "POST", "/projects", project_payload(env, **{key: value})).status_code == 400


def test_tenantless_and_foreign_projects_are_not_visible(env):
    a = create_project(env)
    doc = env.db.projects.find_one({"_id": ObjectId(a["_id"])})
    doc.pop("_id"); doc.pop("tenant_id")
    missing_id = env.db.projects.insert_one(deepcopy(doc)).inserted_id
    doc["tenant_id"] = "beta"
    foreign_id = env.db.projects.insert_one(doc).inserted_id
    for user in ["tl", "employee", "admin", "director"]:
        for identifier in [missing_id, foreign_id]:
            assert env.call(user, "GET", f"/projects/{identifier}").status_code == 404
    assert len(env.call("admin", "GET", "/projects").get_json()["items"]) == 1


def test_options_and_direct_employee_access_hide_other_team(env):
    options = env.call("tl", "GET", "/projects/planning/options").get_json()
    assert str(env.people["outsider"]["_id"]) not in {e["id"] for e in options["employees"]}
    for path in ["monthly", "targets", "unplanned"]:
        assert env.call("tl", "GET", f"/projects/planning/{path}?month=2026-11&employee_id={env.people['outsider']['_id']}").status_code == 403


def test_function_master_and_cascading_tasks_match_workbook(env):
    master = env.call("employee", "GET", "/projects/planning/options").get_json()["master"]
    assert len(master["functions"]) == 13 and len(master["tasks"]) == 203
    assert "IT & HRMS" in master["functions"]
    assert len({t["code"] for t in master["tasks"]}) == 203


def test_months_and_multiple_projects_are_independent(env):
    one, two = create_project(env), create_project(env, name="Mobile release")
    t1, t2 = create_target(env, one), create_target(env, two)
    plan = publish(env, [dated_row(t1), dated_row(t2)])
    next_target = create_target(env, one, period="2026-12")
    later = publish(env, [dated_row(next_target, day="2026-12-01")], period="2026-12")
    assert len(plan["published_rows"]) == 2 and len(later["published_rows"]) == 1
    assert env.db.project_monthly_plans.count_documents({}) == 2
    ready = env.call("employee", "GET", "/projects/planning/checkout-readiness?date=2026-11-23").get_json()
    assert ready["required_count"] == 2 and not ready["checkout_allowed"]


def test_target_submission_idempotency(env):
    project = create_project(env)
    request_id = uuid4().hex
    create_target(env, project, request_id=request_id)
    task = next(t for t in p.MASTER["tasks"] if t["function"] == "IT & HRMS")
    r = env.call("tl", "POST", "/projects/planning/targets", {"request_id": request_id, "month": "2026-11", "project_id": project["_id"], "deliverable_id": "milestone-1", "employee_id": str(env.people["employee"]["_id"]), "activity": task["activity"], "due_date": "2026-11-28"})
    assert r.status_code == 409


@pytest.mark.parametrize("change", [{"date": "2026-12-01"}, {"date": "2026-11-22"}, {"hours": 25}, {"quantity": -1}, {"task_code": "unknown"}, {"output": ""}])
def test_daywise_validation(env, change):
    target = create_target(env, create_project(env))
    assert env.call("employee", "PUT", "/projects/planning/monthly", {"month": "2026-11", "version": 0, "rows": [dated_row(target, **change)]}).status_code == 400


def test_day_can_have_multiple_activities_and_week_crosses_month(env):
    target = create_target(env, create_project(env), due_date="2026-11-30")
    publish(env, [dated_row(target, "2026-11-30"), dated_row(target, "2026-11-30")])
    r = env.call("employee", "GET", "/projects/planning/schedule?date_from=2026-11-30&date_to=2026-12-06").get_json()
    assert len(r["days"]) == 7 and len(r["days"][0]["tasks"]) == 2
    assert r["days"][0]["week_start"] == r["days"][-1]["week_start"] == "2026-11-30"


def test_draft_and_unapproved_work_do_not_gate_checkout(env):
    target = create_target(env, create_project(env))
    env.call("employee", "PUT", "/projects/planning/monthly", {"month": "2026-11", "version": 0, "rows": [dated_row(target)]})
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]


@pytest.mark.parametrize("status", ["completed", "pending", "not_completed"])
def test_every_valid_status_satisfies_reporting_not_completion(env, status):
    target = create_target(env, create_project(env))
    plan = publish(env, [dated_row(target), dated_row(target)])
    plan = report(env, plan, plan["published_rows"][0], status)
    ready = env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()
    assert not ready["checkout_allowed"] and len(ready["missing_tasks"]) == 1
    plan = report(env, plan, plan["published_rows"][1], status)
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]
    stats = env.call("employee", "GET", "/projects/planning/performance?month=2026-11").get_json()
    assert stats["summary"]["reporting_rate"] == 100
    assert stats["summary"]["completed"] == (2 if status == "completed" else 0)


@pytest.mark.parametrize("changes", [{"note": ""}, {"status": "fake"}, {"actual_quantity": -1}, {"evidence": "javascript:alert(1)"}])
def test_reports_require_real_status_reason_and_safe_link(env, changes):
    t = create_target(env, create_project(env))
    plan = publish(env, [dated_row(t)])
    r = env.call("employee", "POST", "/projects/planning/daily-report", {"month": "2026-11", "version": plan["version"], "task_id": plan["rows"][0]["id"], "status": "pending", "note": "Progress details", **changes})
    assert r.status_code == 400


def test_required_evidence_and_no_future_report(env):
    t = create_target(env, create_project(env), evidence_required=True)
    plan = publish(env, [dated_row(t), dated_row(t, "2026-11-24")])
    payload = {"month": "2026-11", "version": plan["version"], "task_id": plan["rows"][0]["id"], "status": "completed", "note": "Done"}
    assert env.call("employee", "POST", "/projects/planning/daily-report", payload).status_code == 400
    payload.update(evidence="https://example.test/report", task_id=plan["rows"][1]["id"])
    assert env.call("employee", "POST", "/projects/planning/daily-report", payload).status_code == 400


def test_revisions_preserve_published_work_and_report_history(env):
    t = create_target(env, create_project(env))
    plan = publish(env, [dated_row(t)])
    plan = report(env, plan, plan["rows"][0], "pending")
    rows = plan["rows"] + [dated_row(t, "2026-11-24")]
    response = env.call("employee", "PUT", "/projects/planning/monthly", {"month": "2026-11", "version": plan["version"], "rows": rows})
    updated = response.get_json()["item"]
    assert len(updated["published_rows"]) == 1 and updated["reports"] == plan["reports"]
    rows[0]["output"] = "Overwrite history"
    assert env.call("employee", "PUT", "/projects/planning/monthly", {"month": "2026-11", "version": updated["version"], "rows": rows}).status_code == 400


def test_stale_plan_version_and_duplicate_cycle_rejected(env):
    t = create_target(env, create_project(env))
    row = dated_row(t)
    r = env.call("employee", "PUT", "/projects/planning/monthly", {"month": "2026-11", "version": 0, "rows": [row]})
    assert r.status_code == 200
    r = env.call("employee", "PUT", "/projects/planning/monthly", {"month": "2026-11", "version": 0, "rows": [row]})
    assert r.status_code == 409 and env.db.project_monthly_plans.count_documents({}) == 1


def test_revision_keeps_published_snapshot_after_team_metadata_changes(env):
    proj = create_project(env)
    target = create_target(env, proj)
    plan = publish(env, [dated_row(target)])
    plan = report(env, plan, plan["rows"][0], "pending")
    env.db.projects.update_one({"_id": ObjectId(proj["_id"])}, {"$set": {"collaborator_ids": [str(env.people["employee2"]["_id"])]}})
    rows = plan["rows"] + [dated_row(target, "2026-11-24")]
    result = env.call("employee", "PUT", "/projects/planning/monthly", {"month": plan["month"], "version": plan["version"], "rows": rows})
    assert result.status_code == 200, result.get_json()
    saved = result.get_json()["item"]
    assert saved["rows"][0] == plan["rows"][0]
    assert saved["rows"][1]["collaborator_ids"] == [str(env.people["employee2"]["_id"])]


def test_first_completion_date_survives_status_correction(env, monkeypatch):
    target = create_target(env, create_project(env))
    plan = publish(env, [dated_row(target)])
    row = plan["rows"][0]
    plan = report(env, plan, row)
    first = plan["reports"][row["id"]]["first_completed_date"]
    monkeypatch.setattr(attendance, "now_local", lambda: datetime(2026, 11, 24, 18, 30))
    plan = report(env, plan, row, "pending")
    assert plan["reports"][row["id"]]["first_completed_date"] == first
    plan = report(env, plan, row)
    assert plan["reports"][row["id"]]["first_completed_date"] == first


def test_explicit_md_setup_is_tenant_scoped_and_dry_run_by_default(env):
    from scripts.project_planning_admin import grant_md
    user = env.users["employee"]
    preview = grant_md(env.db, "alpha", str(user["_id"]))
    assert not preview["applied"]
    assert env.db.users.find_one({"_id": user["_id"]})["roles"] == ["employee"]
    with pytest.raises(ValueError):
        grant_md(env.db, "beta", str(user["_id"]), True)
    grant_md(env.db, "alpha", str(user["_id"]), True)
    grant_md(env.db, "alpha", str(user["_id"]), True)
    assert env.db.users.find_one({"_id": user["_id"]})["roles"] == ["employee", "managing_director"]
    assert env.db.audit_logs.count_documents({"action": "grant_managing_director"}) == 1


def test_planning_routes_allow_pure_hr_monitoring(env):
    env.db.users.update_one({"_id": env.users["employee"]["_id"]}, {"$set": {"roles": ["hr"]}})
    for path in ["/options", "/performance?month=2026-11", "/export?month=2026-11", "/monthly?month=2026-11"]:
        assert env.call("employee", "GET", "/projects/planning" + path).status_code == 200


def test_employee_cannot_approve_own_plan_and_tl_self_goes_to_ro(env):
    proj = create_project(env, primary_assignee_id=str(env.people["tl"]["_id"]), assigned_employee_ids=[str(env.people["tl"]["_id"])])
    target = create_target(env, proj, employee="tl")
    plan = publish(env, [dated_row(target)], employee="tl", reviewer="ro")
    r = env.call("tl", "POST", f"/projects/planning/monthly/{plan['_id']}/review", {"version": plan["version"], "decision": "approved"})
    assert r.status_code == 403


def test_approval_rejection_requires_reason_and_keeps_old_publication(env):
    target = create_target(env, create_project(env))
    plan = publish(env, [dated_row(target)])
    draft = env.call("employee", "PUT", "/projects/planning/monthly", {"month": "2026-11", "version": plan["version"], "rows": plan["rows"] + [dated_row(target, "2026-11-24")]}).get_json()["item"]
    submitted = env.call("employee", "POST", "/projects/planning/monthly/submit", {"month": "2026-11", "version": draft["version"]}).get_json()["item"]
    url = f"/projects/planning/monthly/{plan['_id']}/review"
    assert env.call("tl", "POST", url, {"version": submitted["version"], "decision": "revision_required"}).status_code == 400
    result = env.call("tl", "POST", url, {"version": submitted["version"], "decision": "revision_required", "remarks": "Clarify the daily output"}).get_json()["item"]
    assert result["published_rows"] == plan["published_rows"]


def test_no_tasks_holiday_and_full_leave_do_not_block(env):
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]
    t = create_target(env, create_project(env))
    publish(env, [dated_row(t)])
    env.db.leave_requests.insert_one({"tenant_id": "alpha", "employee_id": str(env.people["employee"]["_id"]), "status": "approved", "approval_stage": "approved", "from_date": "2026-11-23", "to_date": "2026-11-23", "leave_days": 1})
    ready = env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()
    assert ready["checkout_allowed"] and ready["exception"] == "Approved full-day leave"
    env.db.leave_requests.update_many({}, {"$set": {"is_half_day": True, "leave_days": .5}})
    assert not env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness?date=2026-11-29").get_json()["checkout_allowed"]


def unplanned_payload(env, proj, **changes):
    task = next(t for t in p.MASTER["tasks"] if t["function"] == "IT & HRMS")
    return {"request_id": uuid4().hex, "project_id": proj["_id"], "date": "2026-11-23", "task_code": task["code"], "output": "Urgent support", "reason": "Production request", "planned_quantity": 1, "hours": 1, **changes}


@pytest.mark.parametrize("decision", ["approved", "rejected"])
def test_unplanned_work_approval_and_analytics(env, decision):
    project = create_project(env)
    u = env.call("employee", "POST", "/projects/planning/unplanned", unplanned_payload(env, project)).get_json()["item"]
    url = f"/projects/planning/unplanned/{u['_id']}/review"
    assert env.call("employee", "POST", url, {"version": 1, "decision": "approved"}).status_code == 403
    assert env.call("other_tl", "POST", url, {"version": 1, "decision": "approved"}).status_code == 403
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]
    r = env.call("tl", "POST", url, {"version": 1, "decision": decision, "remarks": "Reviewed submission"})
    assert r.status_code == 200
    data = env.call("employee", "GET", "/projects/planning/performance?month=2026-11").get_json()
    assert data["summary"]["approved_unplanned"] == (1 if decision == "approved" else 0)
    assert data["summary"]["assigned"] == 0
    assert env.db.project_unplanned_work.count_documents({}) == 1


def test_actual_quantities_follow_workbook_formula(env):
    target = create_target(env, create_project(env))
    plan = publish(env, [dated_row(target), dated_row(target)])
    plan = report(env, plan, plan["rows"][0], "completed", actual_quantity=4)
    plan = report(env, plan, plan["rows"][1], "pending", actual_quantity=2)
    data = env.call("employee", "GET", "/projects/planning/performance?month=2026-11").get_json()
    assert data["targets"][0]["achievement_percent"] == 60
    assert data["summary"]["completion_rate"] == 50
    assert data["summary"]["on_time_rate"] == 100


def test_private_data_scope_and_md_access(env):
    target = create_target(env, create_project(env))
    plan = publish(env, [dated_row(target)])
    report(env, plan, plan["rows"][0])
    for user in ["outsider", "other_tl", "title_only"]:
        data = env.call(user, "GET", "/projects/planning/performance?month=2026-11").get_json()
        assert data["activities"] == [] and data["employees"] == []
        if user == "other_tl":
            assert data["team_comparison"] and "id" not in data["team_comparison"][0]
            assert "employee_name" not in str(data["team_comparison"])
        r = env.call(user, "GET", f"/projects/planning/performance?month=2026-11&employee_id={env.people['employee']['_id']}")
        assert r.status_code == 403
    data = env.call("director", "GET", "/projects/planning/performance?month=2026-11").get_json()
    assert len(data["activities"]) == 1 and data["organisation_access"]


def test_export_permissions_and_excel_safety(env):
    t = create_target(env, create_project(env))
    plan = publish(env, [dated_row(t, output="=HYPERLINK(\"https://example.test\")")])
    report(env, plan, plan["rows"][0], note="=1+1")
    assert env.call("tl", "GET", "/projects/planning/export?month=2026-11&report=organisation").status_code == 403
    assert env.call("other_tl", "GET", f"/projects/planning/export?month=2026-11&employee_id={env.people['employee']['_id']}").status_code == 403
    result = env.call("director", "GET", "/projects/planning/export?month=2026-11&report=organisation")
    assert result.status_code == 200
    wb = openpyxl.load_workbook(BytesIO(result.data))
    ws = wb["Daily Activities"]
    assert ws.freeze_panes == "A2" and ws.auto_filter.ref
    assert ws["L2"].value.startswith("'=") and ws["T2"].value == "'=1+1"
    assert ws["M2"].number_format == "dd mmm yyyy"
    assert "Monthly Review" in wb.sheetnames


def test_project_timeline_and_linked_deliverable_preservation(env):
    project = create_project(env)
    target = create_target(env, project)
    publish(env, [dated_row(target)])
    for changes in [{"due_date": "2026-11-22"}, {"deliverables": [{"id": "new-id", "title": "Replace history", "due_date": "2027-02-28", "status": "Not Started"}]}]:
        r = env.call("tl", "PATCH", f"/projects/{project['_id']}", {**project_payload(env), "planning_version": 1, **changes})
        assert r.status_code == 400
    assert env.call("tl", "DELETE", f"/projects/{project['_id']}").status_code == 409


@pytest.mark.parametrize("offline", [False, True])
def test_actual_checkout_route_cannot_bypass_reporting(env, offline):
    t = create_target(env, create_project(env))
    plan = publish(env, [dated_row(t)])
    eid = str(env.people["employee"]["_id"])
    env.db.attendance_logs.insert_one({"tenant_id": "alpha", "employee_id": eid, "date": "2026-11-23", "mode": "office", "check_in": datetime(2026, 11, 23, 9, 30), "check_out": None, "status": "present", "is_deleted": False})
    payload = {"latitude": 26.1, "longitude": 91.7, "accuracy": 5}
    if offline:
        payload.update(created_offline=True, offline_marked_at="2026-11-23T18:30:00+05:30", client_attendance_id="test-offline-checkout")
    blocked = env.call("employee", "POST", "/attendance/check-out", payload)
    assert blocked.status_code == 409, blocked.get_json()
    assert blocked.get_json()["code"] == "DAILY_WORK_REPORT_REQUIRED"
    assert env.db.attendance_logs.find_one({})["check_out"] is None
    report(env, plan, plan["rows"][0], "not_completed")
    allowed = env.call("employee", "POST", "/attendance/check-out", payload)
    assert allowed.status_code == 200, allowed.get_json()
    duplicate = env.call("employee", "POST", "/attendance/check-out", payload)
    assert duplicate.status_code == (200 if offline else 409)


def test_checkout_seal_prevents_schedule_race_on_empty_day(env):
    project = create_project(env)
    target = create_target(env, project)
    with env.app.test_request_context():
        g.current_user, g.tenant_id = env.users["employee"], "alpha"
        ready, token = p.seal_checkout_day(env.db, env.people["employee"], "2026-11-23")
        assert ready["checkout_allowed"] and token
        doc = p.get_plan(env.db, str(env.people["employee"]["_id"]), "2026-11")
        with pytest.raises(p.PlanningError):
            p.save_plan(env.db, {"month": "2026-11", "version": doc["version"], "rows": [dated_row(target)]})


def test_auth_and_cross_tenant_readiness(env):
    assert env.client.get("/api/v1/projects/planning/options").status_code == 401
    target = create_target(env, create_project(env))
    publish(env, [dated_row(target)])
    assert env.call("foreign", "GET", "/projects/planning/checkout-readiness").get_json()["required_count"] == 0
    assert env.call("foreign", "GET", "/projects/planning/performance?month=2026-11").get_json()["activities"] == []


def test_invalid_json_and_date_range_are_validation_errors(env):
    assert env.call("employee", "PUT", "/projects/planning/monthly", []).status_code == 400
    assert env.call("employee", "GET", "/projects/planning/performance?date_from=2026-12-01&date_to=2026-11-01").status_code == 400

# Unplanned Work V2: all tests use the existing isolated mongomock fixture.
def v2_unplanned_payload(function="IT & HRMS", **changes):
    task = next(t for t in p.MASTER["tasks"] if t["function"] == function)
    return {"request_id": uuid4().hex, "date": "2026-11-23", "work_type": "non_project",
            "project_id": "", "deliverable_id": "", "work_mode": "office", "function": function,
            "activity": task["activity"], "task_code": task["code"], "output": "Additional test work",
            "reason": "Unexpected requirement",
            "unit": "Count", "priority": "High", "planned_quantity": 2, "hours": 1, **changes}


def test_v2_nonproject_without_assigned_project(env):
    payload = v2_unplanned_payload(department="Untrusted client department")
    options = env.call("employee", "GET", "/projects/planning/unplanned/options").get_json()
    assert options["department"] == "IT" and options["projects"] == []
    r = env.call("employee", "POST", "/projects/planning/unplanned", payload)
    assert r.status_code == 201, r.get_json()
    item = r.get_json()["item"]
    assert item["project_id"] == "" and item["department"] == "IT"
    assert item["reviewer_id"] == str(env.people["tl"]["_id"])
    assert item["report"]["actual_quantity"] == 0 and item["planned_quantity"] == 2
    assert item["execution_status"] == "not_authorized"
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]
    assert env.call("employee", "POST", "/projects/planning/unplanned", payload).status_code == 409
    url = f"/projects/planning/unplanned/{item['_id']}/review"
    assert env.call("employee", "POST", url, {"version": 1, "decision": "approved"}).status_code == 403
    assert env.call("foreign_tl", "POST", url, {"version": 1, "decision": "approved"}).status_code == 404
    assert env.call("tl", "POST", url, {"version": 1, "decision": "approved"}).status_code == 200
    ready = env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()
    assert not ready["checkout_allowed"] and ready["required_count"] == 1
    execute = f"/projects/planning/unplanned/{item['_id']}/execute"
    assert env.call("employee", "POST", execute, {"version": 2, "action": "report", "status": "completed", "actual_quantity": 2, "note": "Not started"}).status_code == 409
    assert env.call("employee", "POST", execute, {"version": 2, "action": "start"}).status_code == 200
    assert env.call("employee", "POST", execute, {"version": 3, "action": "report", "status": "completed", "actual_quantity": 2, "note": "Recorded output"}).status_code == 200
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]
    result = env.call("employee", "GET", "/projects/planning/performance?month=2026-11").get_json()
    assert result["summary"]["completed_unplanned"] == 1
    assert result["summary"]["assigned"] == 0
    assert result["summary"]["approved_unplanned"] == 1
    assert result["summary"]["unplanned_non_project"] == 1
    book = env.call("employee", "GET", "/projects/planning/export?month=2026-11&report=employee")
    assert book.status_code == 200
    ws = openpyxl.load_workbook(BytesIO(book.data))["Unplanned Work"]
    headers = [c.value for c in ws[1]]
    row = dict(zip(headers, [c.value for c in ws[2]]))
    assert row["Work type"] == "Non-project / Internal work" and row["Actual quantity"] == 2
    assert row["Department"] == "IT" and row["Unit"] == "Count"


@pytest.mark.parametrize("changes", [
    {"work_type": "custom"}, {"work_mode": "custom"}, {"function": "Custom function"},
    {"activity": "Custom activity"}, {"task_code": "CUSTOM"}, {"unit": "Custom unit"},
    {"priority": "Urgent custom"}, {"project_id": "invalid"}, {"deliverable_id": "invalid"},
    {"work_mode": "field"}, {"field_place": "Office"}, {"visit_id": "invalid"},
    {"date": "2026-11-22"}, {"status": "completed"}, {"actual_quantity": 1}, {"planned_quantity": 0},
])
def test_v2_unplanned_invalid_fields(env, changes):
    payload = v2_unplanned_payload()
    payload.update(changes)
    r = env.call("employee", "POST", "/projects/planning/unplanned", payload)
    assert r.status_code == 400, r.get_json()
    assert env.db.project_unplanned_work.count_documents({}) == 0


def test_v2_project_categories_scope(env):
    project = create_project(env)
    url = "/projects/planning/unplanned"
    payload = v2_unplanned_payload(work_type="assigned_project", project_id=project["_id"], deliverable_id=project["deliverables"][0]["id"])
    assert env.call("employee", "POST", url, payload).status_code == 201
    mine = env.call("employee", "GET", url + "/options").get_json()["projects"]
    assert any(x["_id"] == project["_id"] and x["work_type"] == "assigned_project" for x in mine)
    payload.update(work_type="other_project", request_id=uuid4().hex)
    assert env.call("employee", "POST", url, payload).status_code == 403
    assert env.call("outsider", "POST", url, payload).status_code == 403
    assert not env.call("outsider", "GET", url + "/options").get_json()["projects"]
    env.db.employees.update_one({"_id": env.people["admin"]["_id"]}, {"$set": {"reporting_officer_id": str(env.people["ro"]["_id"])}})
    choices = env.call("admin", "GET", url + "/options").get_json()["projects"]
    assert any(x["_id"] == project["_id"] and x["work_type"] == "other_project" for x in choices)
    r = env.call("admin", "POST", url, payload)
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["item"]["reviewer_id"] == str(env.people["ro"]["_id"])
    foreign = deepcopy(env.db.projects.find_one({"_id": ObjectId(project["_id"])}))
    foreign.pop("_id"); foreign["tenant_id"] = "beta"
    payload.update(project_id=str(env.db.projects.insert_one(foreign).inserted_id), request_id=uuid4().hex)
    assert env.call("admin", "POST", url, payload).status_code == 404


def test_v3_fieldwork_visit_validation_and_ro_routing(env):
    url = "/projects/planning/unplanned"
    def make_visit(owner="tl", tenant="alpha", day="2026-11-23", status="scheduled"):
        return str(env.db.field_visits.insert_one({"tenant_id": tenant, "employee_ref_id": str(env.people[owner]["_id"]), "title": "Field inspection", "scheduled_date": day, "status": status, "is_deleted": False}).inserted_id)
    own = make_visit()
    payload = v2_unplanned_payload(work_mode="field", field_place="Project site", field_district="Kamrup", field_purpose="Site review")
    r = env.call("tl", "POST", url, payload)
    assert r.status_code == 201, r.get_json()
    item = r.get_json()["item"]
    base = f"{url}/{item['_id']}"
    assert not item["visit_id"] and item["reviewer_id"] == str(env.people["ro"]["_id"])
    assert item["work_mode"] == "field" and item["field_district"] == "Kamrup"
    assert env.call("tl", "GET", base + "/visits").status_code == 409
    assert env.call("tl", "POST", base + "/visits", {"version": 1, "action": "link_visit", "visit_id": own}).status_code == 409
    assert env.call("tl", "POST", base + "/review", {"version": 1, "decision": "approved"}).status_code == 403
    assert env.call("ro", "POST", base + "/review", {"version": 1, "decision": "approved"}).status_code == 200
    for visit_id in (make_visit(owner="employee"), make_visit(tenant="beta"), make_visit(day="2026-11-22"), make_visit(status="cancelled"), make_visit(status="completed")):
        assert env.call("tl", "POST", base + "/visits", {"version": 2, "action": "link_visit", "visit_id": visit_id}).status_code == 404
    choices = env.call("tl", "GET", base + "/visits").get_json()["items"]
    assert [r["_id"] for r in choices] == [own]
    linked = env.call("tl", "POST", base + "/visits", {"version": 2, "action": "link_visit", "visit_id": own})
    assert linked.status_code == 200, linked.get_json()
    assert linked.get_json()["item"]["visit_title"] == "Field inspection"
    assert env.db.field_visits.find_one({"_id": ObjectId(own)})["unplanned_request_id"] == item["_id"]
    assert env.call("tl", "POST", base + "/execute", {"version": 3, "action": "report", "status": "completed", "actual_quantity": 1, "note": "Premature"}).status_code == 409
    assert env.call("tl", "POST", f"/field-visits/{own}/reschedule", {"date": "2026-11-24"}).status_code == 409
    # Exercise actual GPS workflow using the existing visit endpoints (official vehicle, no claim).
    gps = {"latitude": 26.1, "longitude": 91.7, "accuracy": 5, "travel_mode": "official_vehicle"}
    for action in ("start", "reached", "end"):
        transitioned = env.call("tl", "POST", f"/field-visits/{own}/{action}", gps)
        assert transitioned.status_code == 200, transitioned.get_json()
    assert env.db.field_visits.find_one({"_id": ObjectId(own)})["travel"]["eligible"] is False
    completed = env.call("tl", "POST", base + "/execute", {"version": 3, "action": "report", "status": "completed", "actual_quantity": 1, "note": "Site review complete"})
    assert completed.status_code == 200, completed.get_json()
    payload.update(request_id=uuid4().hex)
    assert env.call("tl", "POST", url, payload).status_code == 201
    assert env.db.field_visits.count_documents({}) == 6
    assert env.db.local_conveyance_bills.count_documents({}) == 0
    assert env.call("tl", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]
    summary = env.call("tl", "GET", "/projects/planning/performance?month=2026-11").get_json()["summary"]
    assert summary["unplanned_fieldwork"] == 2 and summary["authorized_unplanned"] == 1 and summary["completed_unplanned"] == 1 and summary["pending_unplanned"] == 1


# Approval-first V3 regression coverage. No live database or network operations.
@pytest.mark.parametrize("decision", ["submitted", "rejected", "revision_required"])
def test_v3_no_execution_before_approval(env, decision):
    base = "/projects/planning/unplanned"
    item = env.call("employee", "POST", base, v2_unplanned_payload()).get_json()["item"]
    route = base + "/" + item["_id"]
    version = 1
    if decision != "submitted":
        r = env.call("tl", "POST", route + "/review", {"version": 1, "decision": decision, "remarks": "Review required"})
        assert r.status_code == 200, r.get_json()
        version = 2
    for payload in ({"action": "start"}, {"action": "report", "status": "completed", "actual_quantity": 1, "note": "Invalid"}):
        assert env.call("employee", "POST", route + "/execute", {"version": version, **payload}).status_code == 409
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]


def test_v3_revision_preserves_identity_and_history(env):
    url = "/projects/planning/unplanned"
    payload = v2_unplanned_payload()
    item = env.call("employee", "POST", url, payload).get_json()["item"]
    route = url + "/" + item["_id"]
    assert env.call("employee", "POST", route + "/revise", {**payload, "version": 1}).status_code == 409
    assert env.call("tl", "POST", route + "/review", {"version": 1, "decision": "revision_required", "remarks": "Change the quantity"}).status_code == 200
    assert env.call("employee2", "POST", route + "/revise", {**payload, "version": 2}).status_code == 404
    result = env.call("employee", "POST", route + "/revise", {**payload, "version": 2, "planned_quantity": 3})
    assert result.status_code == 200, result.get_json()
    revised = result.get_json()["item"]
    assert revised["_id"] == item["_id"] and revised["version"] == 3 and revised["planned_quantity"] == 3
    assert revised["approval_status"] == "submitted" and revised["report"]["status"] == "unreported"
    assert len(revised["events"]) == 3


def test_v3_future_work_and_late_approval_do_not_block_checkout(env):
    url = "/projects/planning/unplanned"
    future = env.call("employee", "POST", url, v2_unplanned_payload(date="2026-11-24"))
    assert future.status_code == 201, future.get_json()
    f = future.get_json()["item"]
    assert env.call("tl", "POST", f"{url}/{f['_id']}/review", {"version": 1, "decision": "approved"}).status_code == 200
    assert env.call("employee", "POST", f"{url}/{f['_id']}/execute", {"version": 2, "action": "start"}).status_code == 409
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]
    item = env.call("employee", "POST", url, v2_unplanned_payload()).get_json()["item"]
    env.db.attendance_logs.insert_one({"tenant_id": "alpha", "employee_id": str(env.people["employee"]["_id"]), "date": "2026-11-23", "check_out": datetime(2026, 11, 23, 18), "is_deleted": False})
    assert env.call("tl", "POST", f"{url}/{item['_id']}/review", {"version": 1, "decision": "approved"}).status_code == 200
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]
    assert env.db.attendance_logs.find_one({})["check_out"] == datetime(2026, 11, 23, 18)


def test_v3_approved_unplanned_actual_checkout_gate(env):
    base = "/projects/planning/unplanned"
    item = env.call("employee", "POST", base, v2_unplanned_payload()).get_json()["item"]
    route = f"{base}/{item['_id']}"
    assert env.call("tl", "POST", route + "/review", {"version": 1, "decision": "approved"}).status_code == 200
    env.db.attendance_logs.insert_one({"tenant_id": "alpha", "employee_id": str(env.people["employee"]["_id"]), "date": "2026-11-23", "mode": "office", "check_in": datetime(2026, 11, 23, 9, 30), "check_out": None, "status": "present", "is_deleted": False})
    payload = {"latitude": 26.1, "longitude": 91.7, "accuracy": 5}
    blocked = env.call("employee", "POST", "/attendance/check-out", payload)
    assert blocked.status_code == 409 and blocked.get_json()["code"] == "DAILY_WORK_REPORT_REQUIRED", blocked.get_json()
    assert env.db.attendance_logs.find_one({})["check_out"] is None
    reported = env.call("employee", "POST", route + "/execute", {"version": 2, "action": "report", "status": "pending", "actual_quantity": 0, "note": "Awaiting information"})
    assert reported.status_code == 200, reported.get_json()
    assert env.call("employee", "POST", "/attendance/check-out", payload).status_code == 200


def test_v3_create_visit_only_after_approval_and_prevent_early_start(env):
    base = "/projects/planning/unplanned"
    payload = v2_unplanned_payload(work_mode="field", field_place="Test site", field_district="Kamrup", field_purpose="Test support")
    item = env.call("employee", "POST", base, payload).get_json()["item"]
    route = f"{base}/{item['_id']}"
    assert env.call("employee", "POST", route + "/visits", {"version": 1, "action": "create_visit"}).status_code == 409
    assert env.db.field_visits.count_documents({}) == 0
    # Even an incorrectly tagged visit cannot start before approval.
    bad = env.db.field_visits.insert_one({"tenant_id": "alpha", "employee_ref_id": str(env.people["employee"]["_id"]), "status": "scheduled", "scheduled_date": "2026-11-23", "unplanned_request_id": item["_id"], "is_deleted": False}).inserted_id
    blocked = env.call("employee", "POST", f"/field-visits/{bad}/start", {"latitude": 26.1, "longitude": 91.7})
    assert blocked.status_code == 409 and blocked.get_json()["code"] == "UNPLANNED_APPROVAL_REQUIRED", blocked.get_json()
    assert env.call("tl", "POST", route + "/review", {"version": 1, "decision": "approved"}).status_code == 200
    created = env.call("employee", "POST", route + "/visits", {"version": 2, "action": "create_visit"})
    assert created.status_code == 200, created.get_json()
    linked = created.get_json()["item"]
    visit = env.db.field_visits.find_one({"_id": ObjectId(linked["visit_id"])})
    assert visit["status"] == "scheduled" and visit["unplanned_request_id"] == item["_id"]
    assert env.db.local_conveyance_bills.count_documents({}) == 0
    assert env.call("employee", "POST", route + "/visits", {"version": 3, "action": "create_visit"}).status_code == 409
    assert env.call("foreign", "GET", route + "/visits").status_code == 404


def test_v3_historical_record_remains_visible_but_not_executable(env):
    item = env.call("employee", "POST", "/projects/planning/unplanned", v2_unplanned_payload()).get_json()["item"]
    env.db.project_unplanned_work.update_one({"_id": ObjectId(item["_id"])}, {"$unset": {"workflow_version": "", "execution_status": "", "planned_quantity": ""}, "$set": {"approval_status": "approved", "report": {"status": "completed", "actual_quantity": 1, "note": "Historical", "evidence": ""}}})
    rows = env.call("employee", "GET", "/projects/planning/unplanned?month=2026-11").get_json()["items"]
    assert rows[0]["historical"] and rows[0]["report"]["actual_quantity"] == 1
    assert env.call("employee", "POST", f"/projects/planning/unplanned/{item['_id']}/execute", {"version": 1, "action": "start"}).status_code == 409
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]
    summary = env.call("employee", "GET", "/projects/planning/performance?month=2026-11").get_json()["summary"]
    assert summary["historical_unplanned"] == 1 and summary["completed_unplanned"] == 0 and summary["authorized_unplanned"] == 0


@pytest.mark.parametrize("status", ["pending", "not_completed"])
def test_v3_unstarted_work_can_report_zero_without_false_completion(env, status):
    base = "/projects/planning/unplanned"
    item = env.call("employee", "POST", base, v2_unplanned_payload(work_mode="wfh")).get_json()["item"]
    route = f"{base}/{item['_id']}"
    assert env.call("tl", "POST", route + "/review", {"version": 1, "decision": "approved"}).status_code == 200
    assert env.call("employee2", "POST", route + "/execute", {"version": 2, "action": "start"}).status_code == 404
    assert env.call("employee", "POST", route + "/execute", {"version": 1, "action": "start"}).status_code == 409
    assert env.call("employee", "POST", route + "/execute", {"version": 2, "action": "report", "status": status, "actual_quantity": 1, "note": "False output"}).status_code == 409
    assert env.call("employee", "POST", route + "/execute", {"version": 2, "action": "report", "status": status, "actual_quantity": 0, "note": "Could not begin"}).status_code == 200
    assert env.call("employee", "GET", "/projects/planning/checkout-readiness").get_json()["checkout_allowed"]


def test_v3_approval_during_checkout_seal_requires_report(env, monkeypatch):
    base = "/projects/planning/unplanned"
    item = env.call("employee", "POST", base, v2_unplanned_payload()).get_json()["item"]
    original = p.commit
    def race(db, collection, before, after, change):
        result = original(db, collection, before, after, change)
        if change.get("action") == "attendance_day_sealed":
            db.project_unplanned_work.update_one({"_id": ObjectId(item["_id"])}, {"$set": {"approval_status": "approved", "approved_at": p.stamp(), "execution_status": "not_started"}})
        return result
    monkeypatch.setattr(p, "commit", race)
    with env.app.test_request_context():
        g.current_user, g.tenant_id = env.users["employee"], "alpha"
        ready, token = p.seal_checkout_day(env.db, env.people["employee"], "2026-11-23")
        assert not ready["checkout_allowed"] and token is None
        assert "2026-11-23" not in p.get_plan(env.db, str(env.people["employee"]["_id"]), "2026-11").get("sealed_dates", {})


def batch_target_payload(env, project, recipients=("employee", "employee2"), **overrides):
    task = next(t for t in p.MASTER["tasks"] if t["function"] == project["function"])
    return {"request_id": uuid4().hex, "month": "2026-11", "project_id": project["_id"],
            "deliverable_id": project["deliverables"][0]["id"],
            "employee_ids": [str(env.people[name]["_id"]) for name in recipients],
            "output": "Complete assigned development work", "unit": "Count", "quantity": 2,
            "activity": task["activity"], "due_date": "2026-11-28", "priority": "Medium", **overrides}


def test_bulk_monthly_targets_per_employee_and_retry(env):
    project = create_project(env)
    payload = batch_target_payload(env, project, ("employee", "employee2", "tl", "employee"))
    first = env.call("tl", "POST", "/projects/planning/targets", payload)
    assert first.status_code == 201, first.get_json()
    data = first.get_json()
    assert data["count"] == data["created_count"] == 3
    assert len({t["_id"] for t in data["items"]}) == 3
    assert all(t["quantity"] == 2 and t["status"] == "approved" for t in data["items"])
    for name in ("employee", "employee2", "tl"):
        mine = env.call(name, "GET", f"/projects/planning/targets?month=2026-11&employee_id={env.people[name]['_id']}")
        assert mine.status_code == 200
        assert len(mine.get_json()["items"]) == 1
    again = env.call("tl", "POST", "/projects/planning/targets", payload)
    assert again.status_code == 200 and again.get_json()["created_count"] == 0
    assert env.db.project_monthly_targets.count_documents({}) == 3
    changed = env.call("tl", "POST", "/projects/planning/targets", {**payload, "quantity": 9})
    assert changed.status_code == 409
    assert env.db.project_monthly_targets.count_documents({}) == 3


@pytest.mark.parametrize("recipients", [("employee", "outsider"), ("employee", "foreign"), ("employee", "ro"), ()])
def test_bulk_invalid_recipient_writes_nothing(env, recipients):
    project = create_project(env)
    result = env.call("tl", "POST", "/projects/planning/targets", batch_target_payload(env, project, recipients))
    assert result.status_code in (400, 403), result.get_json()
    assert env.db.project_monthly_targets.count_documents({}) == 0


def test_bulk_rejects_inactive_employee_and_unauthorized_actor(env):
    project = create_project(env)
    payload = batch_target_payload(env, project)
    assert env.call("employee", "POST", "/projects/planning/targets", payload).status_code == 403
    env.db.employees.update_one({"_id": env.people["employee2"]["_id"]}, {"$set": {"status": "resigned"}})
    assert env.call("tl", "POST", "/projects/planning/targets", payload).status_code in (400, 403)
    assert env.db.project_monthly_targets.count_documents({}) == 0


def test_bulk_retry_resumes_partial_write(env, monkeypatch):
    from pymongo.errors import AutoReconnect
    project = create_project(env)
    payload = batch_target_payload(env, project)
    collection_class = type(env.db.project_monthly_targets)
    original = collection_class.update_one
    calls = 0
    def interrupted(self, *args, **kwargs):
        nonlocal calls
        if self.name == "project_monthly_targets":
            calls += 1
            if calls == 2:
                raise AutoReconnect("simulated temporary disconnect")
        return original(self, *args, **kwargs)
    monkeypatch.setattr(collection_class, "update_one", interrupted)
    first = env.call("tl", "POST", "/projects/planning/targets", payload)
    assert first.status_code == 503
    assert env.db.project_monthly_targets.count_documents({}) == 1
    second = env.call("tl", "POST", "/projects/planning/targets", payload)
    assert second.status_code == 201, second.get_json()
    assert second.get_json()["count"] == 2 and second.get_json()["created_count"] == 1
    assert env.db.project_monthly_targets.count_documents({}) == 2
