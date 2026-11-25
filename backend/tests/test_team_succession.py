"""Actual authenticated API + isolated Mongo fixtures for succession and HR scope."""
from copy import deepcopy
from datetime import date, datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import pytest
from bson import ObjectId
from flask import g
from test_project_planning import env, project_payload, create_project, create_target, dated_row, v2_unplanned_payload
from app.services import team_responsibility as r
from app.routes.workflow import workflow_bp
from app.routes.local_conveyance import lc_bp
from app.routes.employee_handover import employee_handover_bp


@pytest.fixture
def setup(env, monkeypatch):
    env.app.register_blueprint(workflow_bp, url_prefix='/api/v1')
    env.app.register_blueprint(lc_bp, url_prefix='/api/v1/local-conveyance')
    env.app.register_blueprint(employee_handover_bp, url_prefix='/api/v1/employee-handover')
    monkeypatch.setattr('app.services.notice_period_service.local_today', lambda *a, **kw: date(2026, 11, 24))
    r.ensure_indexes(env.db)
    add_person(env, 'hr', roles=['hr'])
    add_person(env, 'replacement', tl=True, officer='ro')
    return env


def add_person(e, name, roles=None, tl=False, ro=False, officer=None, tenant='alpha'):
    person = {'_id': ObjectId(), 'tenant_id': tenant, 'name': name, 'employee_id': 'TEST-' + name,
        'department': 'IT', 'status': 'active', 'is_team_leader': tl, 'is_reporting_officer': ro,
        'reporting_officer_id': str(e.people[officer]['_id']) if officer else '', 'team_leader_id': '', 'user_id': str(ObjectId())}
    user = {'_id': ObjectId(person['user_id']), 'tenant_id': tenant, 'name': name, 'email': name+'@example.test', 'roles': roles or ['employee'], 'is_active': True}
    e.people[name], e.users[name] = person, user
    e.db.employees.insert_one(deepcopy(person)); e.db.users.insert_one(deepcopy(user))
    return person


def separate(e, name='tl', **values):
    e.db.employees.update_one({'_id': e.people[name]['_id']}, {'$set': {'status': 'Resigned', **values}})


def appointment(e, target='replacement', user='hr', version=None):
    row = e.call('hr','GET','/employee-handover/succession').get_json()
    team = next(t for t in row['items'] if t['team_id'] == str(e.people['tl']['_id']))
    return e.call(user,'POST','/employee-handover/succession/appoint', {
        'team_id': team['team_id'], 'replacement_employee_id': str(e.people[target]['_id']),
        'version': team['version'] if version is None else version, 'confirmation': 'ASSIGN'})


def leave(e, owner='employee', status='pending'):
    return e.db.leave_requests.insert_one({'tenant_id': 'alpha', 'employee_id': str(e.people[owner]['_id']),
        'employee_name': owner, 'team_leader_id': str(e.people['tl']['_id']), 'reporting_officer_id': str(e.people['ro']['_id']),
        'approval_stage': 'team_leader', 'status': status, 'leave_type': 'casual_leave', 'leave_days': 1,
        'from_date': '2026-11-25', 'to_date': '2026-11-25', 'approval_history': [{'action': 'submitted', 'note': 'retain me'}],
        'reference': 'LEAVE-KEEP', 'attachments': ['evidence'], 'team_leader_status': 'pending'}).inserted_id


def bill(e):
    return e.db.local_conveyance_bills.insert_one({'tenant_id': 'alpha', 'employee_ref_id': str(e.people['employee']['_id']),
        'employee_name': 'employee', 'reference': 'LC/TEST/1', 'status': 'pending_manager', 'revision': 1, 'total': 120,
        'approval': {'type': 'team_leader', 'employee_ref_id': str(e.people['tl']['_id']), 'user_id': str(e.users['tl']['_id'])},
        'verification_history': [], 'lines': [{'fare': 120}], 'created_at': datetime.now(timezone.utc)}).inserted_id


@pytest.mark.parametrize('values,expected', [({}, 'active'), ({'resignation_date': '2026-11-20'}, 'active'),
    ({'notice_status':'serving','notice_start_date':'2026-11-20','last_working_day':'2026-11-24'},'active'),
    ({'notice_status':'serving','notice_start_date':'2026-11-20','last_working_day':'2026-11-23'},'acting'),
    ({'notice_status':'serving','notice_start_date':'2026-11-20','last_working_day':'2026-11-25','last_working_date':'2026-11-25'},'active'),
    ({'status':'Resigned'},'acting'), ({'is_active':False},'acting'), ({'is_deleted':True},'acting')])
def test_lifecycle_effective_authority(setup, values, expected):
    e=setup;e.db.employees.update_one({'_id':e.people['tl']['_id']},{'$set':values})
    leader,state,_=r.effective(e.db,'alpha',e.people['tl']['_id'])
    assert state==expected
    assert leader['_id']==e.people['tl' if state=='active' else 'ro']['_id']


@pytest.mark.parametrize('bad', ['missing','inactive','deleted','foreign','no_capability'])
def test_invalid_ro_requires_reassignment(setup,bad):
    e=setup;separate(e)
    if bad=='missing': e.db.employees.update_one({'_id':e.people['tl']['_id']},{'$set':{'reporting_officer_id':str(ObjectId())}})
    elif bad=='foreign': e.db.employees.update_one({'_id':e.people['ro']['_id']},{'$set':{'tenant_id':'beta'}})
    else:e.db.employees.update_one({'_id':e.people['ro']['_id']},{'$set':{'inactive':{'status':'inactive'},'deleted':{'is_deleted':True},'no_capability':{'is_reporting_officer':False}}[bad]})
    assert r.effective(e.db,'alpha',e.people['tl']['_id'])[:2]==(None,'reassignment_required')
    req=leave(e)
    assert e.call('replacement','PATCH',f'/leave_requests/{req}/decision',{'status':'approved'}).status_code in (403,404)
    with e.app.app_context():
        r.reconcile(e.db,'alpha',dry_run=False)
    assert e.db.notifications.count_documents({'user_id':str(e.users['hr']['_id'])})==1
    assert e.db.leave_requests.find_one({'_id':req})['status']=='pending'


def test_pending_leave_transfer_and_independent_hr_stage(setup):
    e=setup;req=leave(e);before=e.db.leave_requests.find_one({'_id':req});separate(e)
    rows=e.call('ro','GET','/team_approvals').get_json()['items'];assert str(req) in [x['_id'] for x in rows]
    response=e.call('ro','PATCH',f'/leave_requests/{req}/decision',{'status':'approved','note':'Acting TL verified'})
    assert response.status_code==200,response.get_json()
    current=e.db.leave_requests.find_one({'_id':req})
    assert current['approval_stage']=='hr' and current['status']=='pending'
    assert current['team_leader_decision_by']==str(e.users['ro']['_id'])
    assert current['reference']==before['reference'] and current['attachments']==before['attachments']
    assert current['approval_history'][0]==before['approval_history'][0]
    assert e.call('ro','PATCH',f'/leave_requests/{req}/decision',{'status':'approved'}).status_code in (403,404)


def test_new_leave_notifies_acting_reviewer(setup,monkeypatch):
    from app.routes import workflow
    e=setup;separate(e);sent=[]
    monkeypatch.setattr(workflow,'notify_users',lambda db,users,*a,**k: sent.extend(users))
    with e.app.test_request_context():
        g.tenant_id='alpha';g.current_user=e.users['employee']
        workflow.notify_next_leave_approvers(e.db,e.people['employee'],{'_id':ObjectId(),'tenant_id':'alpha','team_leader_id':str(e.people['tl']['_id'])},'team_leader')
    assert str(e.users['ro']['_id']) in sent and str(e.users['tl']['_id']) not in sent


def test_lc_pending_new_routing_accounts_and_replacement(setup):
    from app.services.lc_workflow import resolve_approver
    e=setup;bid=bill(e);separate(e)
    assert resolve_approver(e.db,'alpha',e.people['employee'])['employee_ref_id']==str(e.people['ro']['_id'])
    assert len(e.call('ro','GET','/local-conveyance/bills?scope=all').get_json()['items'])==1
    assert e.call('ro','GET','/local-conveyance/bills/LC/TEST/1').status_code==200
    assert appointment(e).status_code==200
    assert e.call('ro','POST','/local-conveyance/bills/LC/TEST/1/action',{'action':'manager_validate'}).status_code==403
    response=e.call('replacement','POST','/local-conveyance/bills/LC/TEST/1/action',{'action':'manager_validate'})
    assert response.status_code==200,response.get_json()
    saved=e.db.local_conveyance_bills.find_one({'_id':bid})
    assert saved['status']=='pending_accounts' and saved['total']==120 and saved['lines']==[{'fare':120}]
    assert e.call('replacement','POST','/local-conveyance/bills/LC/TEST/1/action',{'action':'accounts_verify'}).status_code==403
    assert e.call('replacement','POST','/local-conveyance/bills/LC/TEST/1/action',{'action':'mark_paid'}).status_code==403


@pytest.mark.parametrize('new_after_exit',[False,True])
def test_expense_pending_visibility_and_finance_boundary(setup,new_after_exit):
    e=setup
    if new_after_exit:separate(e)
    eid=e.db.expenses.insert_one({'tenant_id':'alpha','employee_id':str(e.people['employee']['_id']), 'status':'pending','amount':234,'description':'preserve'}).inserted_id
    if not new_after_exit:separate(e)
    listing=e.call('ro','GET','/expenses').get_json()
    assert str(eid) in [x['_id'] for x in listing['items']]
    assert e.call('ro','PATCH',f'/expenses/{eid}/decision',{'status':'paid'}).status_code==403
    assert e.call('ro','PATCH',f'/expenses/{eid}/decision',{'status':'approved'}).status_code==200
    assert e.db.expenses.find_one({'_id':eid})['amount']==234


def pending_plan(e):
    project=create_project(e);target=create_target(e,project)
    saved=e.call('employee','PUT','/projects/planning/monthly',{'month':'2026-11','version':0,'rows':[dated_row(target)]}).get_json()['item']
    return project,e.call('employee','POST','/projects/planning/monthly/submit',{'month':'2026-11','version':saved['version']}).get_json()['item']


def test_planning_pending_transfer_and_replacement_scope(setup):
    e=setup;project,plan=pending_plan(e);separate(e)
    assert len(e.call('ro','GET','/projects/planning/approvals').get_json()['plans'])==1
    assert appointment(e).status_code==200
    assert not e.call('ro','GET','/projects/planning/approvals').get_json()['plans']
    assert len(e.call('replacement','GET','/projects/planning/approvals').get_json()['plans'])==1
    response=e.call('replacement','POST',f"/projects/planning/monthly/{plan['_id']}/review",{'version':plan['version'],'decision':'approved'})
    assert response.status_code==200,response.get_json()
    assert e.call('replacement','GET',f"/projects/{project['_id']}").get_json()['item']['can_manage_project_team']
    assert e.call('replacement','GET',f"/projects/planning/monthly?month=2026-11&employee_id={e.people['outsider']['_id']}").status_code==403
    assert e.call('replacement','GET','/projects/planning/export?month=2026-11').status_code==200


@pytest.mark.parametrize('new_after_exit',[False,True])
def test_additional_work_pending_and_new_review(setup,new_after_exit):
    e=setup
    if new_after_exit:separate(e)
    response=e.call('employee','POST','/projects/planning/unplanned',v2_unplanned_payload())
    assert response.status_code==201,response.get_json()
    item=response.get_json()['item']
    if not new_after_exit:separate(e)
    assert item['_id'] in [x['_id'] for x in e.call('ro','GET','/projects/planning/approvals').get_json()['unplanned']]
    reviewed=e.call('ro','POST',f"/projects/planning/unplanned/{item['_id']}/review",{'decision':'approved','version':item['version'],'remarks':'Authorized'})
    assert reviewed.status_code==200,reviewed.get_json()
    assert reviewed.get_json()['item']['execution_status']=='not_started'


def test_acting_project_create_edit_targets_and_department(setup):
    e=setup;project=create_project(e);separate(e)
    created=create_project(e,user='ro',name='During vacancy')
    assert created['team_leader_id']==str(e.people['tl']['_id'])
    updated=e.call('ro','PATCH',f"/projects/{project['_id']}",{**project_payload(e),'planning_version':1,'name':'Continuing'})
    assert updated.status_code==200,updated.get_json()
    assert appointment(e).status_code==200
    create_project(e,user='replacement',name='After appointment')
    options=e.call('replacement','GET',f"/projects/planning/options?team_leader_id={e.people['tl']['_id']}").get_json()
    assert str(e.people['employee']['_id']) in [x['id'] for x in options['eligible_members']]
    assert str(e.people['outsider']['_id']) not in [x['id'] for x in options['eligible_members']]


def test_reconciliation_idempotence_history_and_no_business_rewrite(setup):
    e=setup;project=create_project(e);req=leave(e,status='approved');separate(e)
    before=deepcopy(e.db.leave_requests.find_one({'_id':req}));p_before=deepcopy(e.db.projects.find_one({'_id':ObjectId(project['_id'])}))
    with e.app.app_context():
        r.reconcile(e.db,'alpha',dry_run=True)
        assert e.db.team_successions.count_documents({})==0
        r.reconcile(e.db,'alpha',dry_run=False);r.reconcile(e.db,'alpha',dry_run=False)
    assert e.db.audit_logs.count_documents({'action':'team_succession'})==1
    assert e.db.employee_handover_history.count_documents({'kind':'team_succession'})==1
    assert e.db.notifications.count_documents({'user_id':str(e.users['ro']['_id']),'type':'team_succession'})==0  # normalized notification_type is used
    notes=list(e.db.notifications.find({'notification_type':'team_succession'}))
    assert notes and len({n['event_key'] for n in notes})==len(notes)
    assert e.db.leave_requests.find_one({'_id':req})==before
    assert e.db.projects.find_one({'_id':ObjectId(project['_id'])})==p_before
    first=appointment(e);assert first.status_code==200
    count=e.db.audit_logs.count_documents({'action':'team_succession'})
    assert appointment(e).status_code==200
    assert e.db.audit_logs.count_documents({'action':'team_succession'})==count


@pytest.mark.parametrize('user',['employee','ro','tl','foreign'])
def test_only_hr_admin_can_appoint(setup,user):
    e=setup;separate(e)
    assert appointment(e,user=user).status_code in (401,403)


@pytest.mark.parametrize('target',['foreign_tl','outsider','ro'])
def test_invalid_replacement_rejected(setup,target):
    e=setup;separate(e)
    assert appointment(e,target=target).status_code==409
    assert r.effective(e.db,'alpha',e.people['tl']['_id'])[0]['_id']==e.people['ro']['_id']


def test_no_title_based_automatic_replacement_and_unrelated_team(setup):
    e=setup;separate(e)
    e.db.employees.update_one({'_id':e.people['employee2']['_id']},{'$set':{'designation':'Team Leader'}})
    assert r.effective(e.db,'alpha',e.people['tl']['_id'])[0]['_id']==e.people['ro']['_id']
    assert r.effective(e.db,'alpha',e.people['other_tl']['_id'])[0]['_id']==e.people['other_tl']['_id']
    assert not r.can_lead(e.db,'alpha',e.people['ro'],e.people['other_tl']['_id'])


def test_self_approval_and_departed_stale_token(setup):
    e=setup;req=leave(e,owner='ro');separate(e)
    assert e.call('ro','PATCH',f'/leave_requests/{req}/decision',{'status':'approved'}).status_code==403
    assert e.call('tl','GET','/projects').status_code==401
    assert e.call('tl','POST','/projects',project_payload(e)).status_code==401


def test_appointment_and_decision_serialize_across_workers(setup):
    e=setup;separate(e)
    with r.mutation_guard(e.db,'alpha'):
        with ThreadPoolExecutor(max_workers=1) as pool:
            def collide():
                with pytest.raises(r.ResponsibilityBusy):
                    with r.mutation_guard(e.db,'alpha'): pass
            pool.submit(collide).result()
    assert appointment(e).status_code==200


@pytest.mark.parametrize('field',['primary_assignee_id','assigned_employee_ids','collaborator_ids'])
def test_cross_department_members_and_editing(setup,field):
    e=setup;e.db.employees.update_one({'_id':e.people['employee']['_id']},{'$set':{'department':'Finance'}})
    options=e.call('ro','GET',f"/projects/planning/options?team_leader_id={e.people['tl']['_id']}").get_json()
    assert str(e.people['employee']['_id']) in [p['id'] for p in options['eligible_members']]
    value=str(e.people['employee']['_id']);values={field:[value] if field.endswith('_ids') else value}
    project=create_project(e,**values)
    assert project['department']=='IT'
    response=e.call('tl','PATCH',f"/projects/{project['_id']}",{**project_payload(e,**values),'planning_version':1})
    assert response.status_code==200,response.get_json()
    assert e.db.employees.find_one({'_id':e.people['employee']['_id']})['department']=='Finance'


@pytest.mark.parametrize('changes',[{'status':'inactive'},{'is_deleted':True},{'tenant_id':'beta'},{'team_leader_id':'unrelated'}])
def test_invalid_members_not_eligible(setup,changes):
    e=setup;e.db.employees.update_one({'_id':e.people['employee']['_id']},{'$set':changes})
    assert e.call('tl','POST','/projects',project_payload(e)).status_code==400


@pytest.mark.parametrize('role',['hr','hr_admin','hr_manager','admin','managing_director'])
@pytest.mark.parametrize('capability',[False,True])
def test_admin_hr_permission_matrix_and_read_scope(setup,role,capability):
    e=setup;e.db.users.update_one({'_id':e.users['hr']['_id']},{'$set':{'roles':[role]}})
    if capability:
        e.db.employees.update_one({'_id':e.people['hr']['_id']},{'$set':{'is_reporting_officer':True}})
        e.db.employees.update_one({'_id':e.people['tl']['_id']},{'$set':{'reporting_officer_id':str(e.people['hr']['_id'])}})
    p=create_project(e)
    for path in ['/projects','/projects/planning/options','/projects/planning/targets?month=2026-11',
                 '/projects/planning/performance?month=2026-11','/projects/planning/export?month=2026-11&report=organisation',
                 f"/projects/planning/monthly?month=2026-11&employee_id={e.people['outsider']['_id']}",
                 f"/projects/planning/schedule?date_from=2026-11-23&date_to=2026-11-24&employee_id={e.people['employee']['_id']}"]:
        assert e.call('hr','GET',path).status_code==200,path
    response=e.call('hr','POST','/projects',project_payload(e))
    assert response.status_code==(201 if capability else 403),response.get_json()
    if not capability:
        assert not e.call('hr','GET',f"/projects/{p['_id']}").get_json()['item']['can_manage_project_team']
        assert e.call('hr','PATCH',f"/projects/{p['_id']}",project_payload(e)).status_code==403


def test_hr_without_employee_and_superadmin_exclusion(setup):
    e=setup;create_project(e);e.db.employees.delete_one({'_id':e.people['hr']['_id']})
    assert e.call('hr','GET','/projects/planning/options').status_code==200
    assert e.call('hr','GET','/projects').status_code==200
    assert e.call('hr','POST','/projects',project_payload(e)).status_code==403
    e.db.users.update_one({'_id':e.users['hr']['_id']},{'$set':{'roles':['super_admin','hr']}})
    assert e.call('hr','GET','/projects').status_code==403
    assert e.call('hr','GET','/projects/planning/options').status_code==403
    assert e.call('hr','GET','/employee-handover/succession').status_code==403
    assert e.client.get('/api/v1/projects').status_code==401


@pytest.mark.parametrize('route,collection',[('holiday-work-requests','holiday_work_requests'),('mode-requests','attendance_mode_requests')])
def test_attendance_approval_transfer_and_independent_stage(setup,route,collection):
    e=setup;separate(e)
    oid=e.db[collection].insert_one({'tenant_id':'alpha','employee_id':str(e.people['employee']['_id']),
        'employee_name':'employee','date':'2026-11-29','mode':'field','status':'pending','approval_stage':'team_leader',
        'team_leader_id':str(e.people['tl']['_id']),'reporting_officer_id':str(e.people['ro']['_id']), 'approval_history':[]}).inserted_id
    listing=e.call('ro','GET','/attendance/'+route)
    assert listing.status_code==200,listing.get_json()
    assert str(oid) in [x['_id'] for x in listing.get_json()['items']]
    approved=e.call('ro','PATCH',f'/attendance/{route}/{oid}/decision',{'status':'approved'})
    assert approved.status_code==200,approved.get_json()
    assert e.db[collection].find_one({'_id':oid})['approval_stage']=='hr'
    assert e.call('ro','PATCH',f'/attendance/{route}/{oid}/decision',{'status':'approved'}).status_code==403
    assert e.call('hr','PATCH',f'/attendance/{route}/{oid}/decision',{'status':'approved'}).status_code==200


def test_notice_date_uses_ist_boundary(setup):
    from app.services.notice_period_service import local_today
    from app.services.active_employee_scope import employee_is_active
    from zoneinfo import ZoneInfo
    source={**setup.people['tl'],'notice_status':'serving','notice_start_date':'2026-11-01','last_working_day':'2026-11-24'}
    assert r.separation_instant(source)=='2026-11-25T00:00:00+05:30'
    assert employee_is_active(source)


def test_missing_source_is_visible_for_hr_without_arbitrary_delegation(setup):
    e=setup;sid=e.people['tl']['_id'];e.db.employees.delete_one({'_id':sid})
    result=e.call('hr','GET','/employee-handover/succession').get_json()
    assert next(t for t in result['items'] if t['team_id']==str(sid))['status']=='reassignment_required'
    assert r.effective(e.db,'alpha',sid)[0] is None


def test_pending_requests_created_during_acting_period_follow_replacement(setup):
    from app.services.lc_workflow import resolve_approver
    e=setup;separate(e);oid=bill(e)
    approval=resolve_approver(e.db,'alpha',e.people['employee'])
    e.db.local_conveyance_bills.update_one({'_id':oid},{'$set':{'approval':approval}})
    assert appointment(e).status_code==200
    listing=e.call('replacement','GET','/local-conveyance/bills?scope=all').get_json()
    assert listing['items']
    assert e.call('replacement','POST','/local-conveyance/bills/LC/TEST/1/action',{'action':'manager_validate'}).status_code==200


def test_hr_monitoring_has_no_operational_approval_or_self_service_override(setup):
    e=setup;project,plan=pending_plan(e)
    assert e.call('hr','POST',f"/projects/planning/monthly/{plan['_id']}/review",{'decision':'approved','version':plan['version']}).status_code==403
    work=e.call('employee','POST','/projects/planning/unplanned',v2_unplanned_payload()).get_json()['item']
    assert e.call('hr','POST',f"/projects/planning/unplanned/{work['_id']}/review",{'decision':'approved','version':work['version']}).status_code==403
    assert not e.call('hr','GET',f"/projects/planning/unplanned?month=2026-11&employee_id={e.people['employee']['_id']}").get_json()['items'][0]['can_review']
    assert e.call('hr','POST','/projects/planning/daily-report',{'month':'2026-11','version':plan['version'],'task_id':plan['rows'][0]['id'],'status':'completed'}).status_code in (400,403,409)
    for method in ['POST','PATCH','DELETE']:
        endpoint='/projects' if method=='POST' else f"/projects/{project['_id']}"
        assert e.call('hr',method,endpoint,project_payload(e)).status_code==403


def test_dashboard_pending_scope_and_visit_scope(setup):
    from app.routes.dashboard import pending_leave_scope_for_employee_capability
    from app.routes.field_visits import team_employee_ids
    e=setup;oid=leave(e);separate(e)
    with e.app.test_request_context():
        g.tenant_id='alpha';g.current_user=e.users['ro']
        scope=pending_leave_scope_for_employee_capability('alpha',str(e.people['ro']['_id']),e.people['ro'],['reporting_officer'])
        assert e.db.leave_requests.find_one(scope)['_id']==oid
        scoped=team_employee_ids(e.db,e.people['ro'])
        assert str(e.people['employee']['_id']) in scoped
        assert str(e.people['outsider']['_id']) not in scoped


def test_early_authorized_notice_handover_is_available_in_hr_ui(setup):
    e=setup
    e.db.employees.update_one({'_id':e.people['tl']['_id']},{'$set':{
        'notice_status':'serving','notice_start_date':'2026-11-20','last_working_day':'2026-11-30'}})
    rows=e.call('hr','GET','/employee-handover/succession').get_json()['items']
    row=next(x for x in rows if x['team_id']==str(e.people['tl']['_id']))
    assert row['status']=='active' and row['appointment_available']
    req=leave(e)
    assert appointment(e).status_code==200
    assert e.call('tl','PATCH',f'/leave_requests/{req}/decision',{'status':'approved'}).status_code in (403,404)
    assert e.call('replacement','PATCH',f'/leave_requests/{req}/decision',{'status':'approved'}).status_code==200


def test_subsequent_replacement_separation_can_be_reassigned(setup):
    e=setup;separate(e);req=leave(e)
    assert appointment(e).status_code==200
    add_person(e,'next_replacement',tl=True,officer='ro')
    assert appointment(e,target='next_replacement').status_code==409
    separate(e,'replacement')
    assert r.effective(e.db,'alpha',e.people['tl']['_id'])[1]=='acting'
    assert appointment(e,target='next_replacement').status_code==200
    assert r.effective(e.db,'alpha',e.people['tl']['_id'])[0]['_id']==e.people['next_replacement']['_id']
    assert e.db.leave_requests.find_one({'_id':req})['team_leader_id']==str(e.people['tl']['_id'])
    events=e.db.team_successions.find_one({'source_employee_id':str(e.people['tl']['_id'])})['events']
    assert [x['effective_leader_id'] for x in events if x['status']=='replacement_assigned']==[
        str(e.people['replacement']['_id']),str(e.people['next_replacement']['_id'])]


def test_legacy_ro_code_is_canonicalized_for_replacement_picker(setup):
    e=setup;separate(e)
    e.db.employees.update_one({'_id':e.people['replacement']['_id']},{'$set':{'reporting_officer_id':e.people['ro']['employee_id']}})
    row=e.call('hr','GET','/employee-handover/succession').get_json()
    candidate=next(c for c in row['candidates'] if c['id']==str(e.people['replacement']['_id']))
    assert candidate['reporting_officer_id']==str(e.people['ro']['_id'])
    assert appointment(e).status_code==200


def test_replacement_loses_scope_if_mapped_ro_becomes_inactive(setup):
    e=setup;separate(e)
    assert appointment(e).status_code==200
    separate(e,'ro')
    assert r.effective(e.db,'alpha',e.people['tl']['_id'])[:2]==(None,'reassignment_required')


def test_appointment_retry_finishes_interrupted_outbox(setup,monkeypatch):
    e=setup;separate(e)
    real=r.dispatch_events
    with monkeypatch.context() as m:
        m.setattr(r,'dispatch_events',lambda *a,**k: None)
        assert appointment(e).status_code==200
    record=e.db.team_successions.find_one({'source_employee_id':str(e.people['tl']['_id'])})
    assert not record['events'][0].get('delivered')
    assert appointment(e).status_code==200
    record=e.db.team_successions.find_one({'_id':record['_id']})
    assert len(record['events'])==1 and record['events'][0]['delivered']


def test_audit_has_effective_dates_and_immutable_delegation_history(setup):
    e=setup;separate(e)
    with e.app.app_context():r.reconcile(e.db,'alpha',dry_run=False)
    first=e.db.audit_logs.find_one({'action':'team_succession'})
    assert first['tenant_id']=='alpha' and first['meta']['previous_team_leader_code']==e.people['tl']['employee_id']
    assert first['meta']['team_id']==str(e.people['tl']['_id'])
    assert first['meta']['effective_at'] and first['meta']['delegation_started_at']
    assert first['meta']['delegation_ended_at'] is None
    assert appointment(e).status_code==200
    assert e.db.audit_logs.find_one({'_id':first['_id']})==first
    after=e.db.audit_logs.find_one({'meta.status':'replacement_assigned'})['meta']
    assert after['replacement_employee_id']==str(e.people['replacement']['_id'])
    assert after['delegation_started_at']==first['meta']['delegation_started_at']
    assert after['delegation_ended_at'] and after['effective_at']
