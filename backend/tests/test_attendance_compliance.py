from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import pytest
from test_project_planning import env
from test_team_succession import add_person
from app.routes.attendance_compliance import compliance_bp
from app.services import attendance_compliance as ac
from app.services.attendance_payroll_engine import ComplianceError
from app.services.attendance_payroll_integration import enhance_calculation, validate_workflow_snapshots
from app.services.payroll_calculation_service import calculate_payroll

@pytest.fixture
def setup(env,monkeypatch):
    env.app.register_blueprint(compliance_bp,url_prefix='/api/v1/attendance-compliance')
    monkeypatch.setattr(ac,'local_now',lambda:datetime(2026,12,10,20))
    add_person(env,'hr',roles=['hr']);add_person(env,'finance',roles=['finance']);add_person(env,'platform',roles=['super_admin'])
    env.db.employees.update_many({}, {'$set':{'state':'Assam(HO)','joining_date':'2026-01-01'}})
    for p in env.people.values():p.update(state='Assam(HO)',joining_date='2026-01-01')
    ac.ensure_indexes(env.db)
    return env


def configure(e,**changes):
    rules=[{'code':code,'name':code,'enabled':True,'mode':'manual' if code=='leave_not_applied' else 'automatic','points':1,'daily_max':1,'monthly_max':0,'grace_minutes':0,'threshold_minutes':0,'payroll_review':code!='missing_checkout'} for code in ['late','missing_checkout','leave_not_applied']]
    p=ac.validate_policy({**deepcopy(ac.DEFAULT),'enabled':True,'monthly_points':2,'weekly_offs':[6],'saturday_offs':[2],'shifts':[{'start':'09:00','end':'18:00','breaks':[{'start':'13:00','end':'14:00','paid':False}]}],'rules':rules,**changes})
    p.update(version=1,effective_from='2026-11-01',actor_id='test',reason='fixture')
    e.db.attendance_compliance_settings.replace_one({'_id':ac.uid('alpha','settings')},{'_id':ac.uid('alpha','settings'),'tenant_id':'alpha','revision':1,'versions':[p]},upsert=True)
    return p


def log(e,on,start='10:00',end='18:00'):
    return e.db.attendance_logs.insert_one({'tenant_id':'alpha','employee_id':str(e.people['employee']['_id']),'date':on,'check_in':datetime.fromisoformat(on+'T'+start),'check_out':datetime.fromisoformat(on+'T'+end) if end else None,'mode':'office'}).inserted_id


def verify(e,on):
    return ac.add_time_adjustment(e.db,'alpha',e.people['employee'],{'date':on,'kind':'verified','reason':'Evidence reviewed by HR','request_id':'verify-'+on},str(e.users['hr']['_id']))


def summary(e):return ac.build_summary(e.db,'alpha',e.people['employee'],'2026-11')
def process(e):
    with e.app.app_context():return ac.process_employee(e.db,'alpha',e.people['employee'],'2026-11')


def test_default_off_legacy_unchanged(setup):
    e=setup;p=ac.policy(e.db,'alpha');assert not any(p[k] for k in ('enabled','connected','enforce'))
    original={'legacy':True};assert enhance_calculation(e.db,'alpha',e.people['employee'],'2026-11',original,{},{},{},{}) is original
    process(e);assert e.db.employee_compliance_ledgers.count_documents({})==0


def test_tenant_role_and_own_access(setup):
    e=setup;configure(e);root='/attendance-compliance'
    for who in ('employee','finance','platform'):
        assert e.call(who,'POST',root+'/process',{'period':'2026-11','employee_ids':[str(e.people['employee']['_id'])]}).status_code==403
    assert e.call('employee','GET',root+'/summary/'+str(e.people['employee2']['_id'])+'?period=2026-11').status_code==404
    assert e.call('hr','GET',root+'/summary/'+str(e.people['foreign']['_id'])+'?period=2026-11').status_code==404
    assert e.call('employee','GET',root+'/summary/me?period=2026-11').status_code==200
    assert e.call('platform','GET',root+'/settings').status_code==403
    assert 'rules' not in e.call('employee','GET',root+'/settings').get_json()['policy']


def test_effective_versions_finance_and_stale_edits(setup):
    e=setup;data={'policy':deepcopy(ac.DEFAULT),'revision':0,'effective_from':'2026-12-11','reason':'Pilot configuration'}
    r=e.call('hr','PUT','/attendance-compliance/settings',data);assert r.status_code==200,r.get_json()
    assert e.call('hr','PUT','/attendance-compliance/settings',data).status_code==409
    assert ac.policy(e.db,'alpha','2026-12-10').get('version',0)==0
    assert ac.policy(e.db,'alpha','2026-12-11')['version']==1
    data.update(revision=1,effective_from='2026-12-10')
    assert e.call('finance','PUT','/attendance-compliance/settings',data).status_code==403
    data['policy']={'components':[]};assert e.call('finance','PUT','/attendance-compliance/settings',data).status_code==200
    assert e.db.audit_logs.count_documents({'action':'compliance_policy'})==2


def test_duplicate_offline_face_worker(setup):
    e=setup;configure(e);log(e,'2026-11-02');log(e,'2026-11-02')
    for _ in range(3):process(e)
    row=ac.ledger(e.db,'alpha',e.people['employee'],'2026-11-02');assert row['balance']==1 and len(row['events'])==2
    assert e.db.notifications.count_documents({'user_id':str(e.users['employee']['_id'])})==2


def test_atomic_fractional_concurrency(setup):
    e=setup;p=configure(e,monthly_points=5);person=e.people['employee'];on='2026-11-02';ac.ensure_allocation(e.db,'alpha',person,on,p)
    event={'id':'same-event','kind':'violation','rule':'other','rule_snapshot':{'daily_max':0,'monthly_max':0},'delta':-.25,'actor_id':'test','reason':'Concurrency test'}
    with ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(lambda _:ac.post_event(e.db,'alpha',person,on,event,p),range(20)))
    row=ac.ledger(e.db,'alpha',person,on,p);assert row['balance']==4.75 and len(row['events'])==2


def test_missing_checkout_correction_restore(setup):
    e=setup;configure(e);rid=log(e,'2026-11-02','09:00',None);process(e)
    row=next(r for r in summary(e)['days'] if r['date']=='2026-11-02');assert row['uncertain'] and row['eligible_minutes']==0
    assert ac.ledger(e.db,'alpha',e.people['employee'],'2026-11-02')['balance']==1
    e.db.attendance_logs.update_one({'_id':rid},{'$set':{'check_out':datetime(2026,11,2,18)}});process(e);process(e)
    row=ac.ledger(e.db,'alpha',e.people['employee'],'2026-11-02');assert row['balance']==2 and len([x for x in row['events'] if x['kind']=='restoration'])==1


def test_holiday_weeklyoff_leave_union(setup):
    e=setup;configure(e);e.db.holiday_calendar.insert_one({'tenant_id':'alpha','state':'Assam(HO)','date':'2026-11-08'})
    e.db.leave_requests.insert_one({'tenant_id':'alpha','employee_id':str(e.people['employee']['_id']),'status':'approved','approval_stage':'approved','from_date':'2026-11-02','to_date':'2026-11-02','leave_type':'CL','leave_days':1})
    log(e,'2026-11-02','09:00');rows={r['date']:r for r in summary(e)['days']}
    assert rows['2026-11-08']['required_minutes']==0 and rows['2026-11-14']['required_minutes']==0
    assert rows['2026-11-28']['required_minutes']==480
    assert rows['2026-11-02']['accounted_minutes']==480 and rows['2026-11-02']['credited_minutes']==0


def test_central_calendar_live_and_tenant_scoped(setup):
    e=setup;configure(e,calendar_source='organisation',holidays=[{'date':'2026-11-03'}],shifts=[])
    e.db.holiday_calendar.insert_many([
        {'tenant_id':'alpha','date':'2026-11-02','state':'Assam(HO)','status':'active'},
        {'tenant_id':'alpha','date':'2026-11-04','state':'Other','status':'active'},
        {'tenant_id':'other','date':'2026-11-05','state':'Assam(HO)'},
        {'tenant_id':'alpha','date':'2026-11-06','status':'inactive'}])
    rows={r['date']:r for r in summary(e)['days']}
    assert rows['2026-11-02']['required_minutes']==0
    assert rows['2026-11-28']['required_minutes']==0
    for on in ['2026-11-03','2026-11-04','2026-11-05','2026-11-06']:
        assert rows[on]['required_minutes']>0
    log(e,'2026-11-02');process(e)
    assert not any(x['kind']=='violation' and x['date']=='2026-11-02' for x in summary(e)['events'])
    data={'employee_id':str(e.people['employee']['_id']),'date':'2026-11-02','rule':'leave_not_applied','reason':'Test holiday','leave_not_applied':True}
    assert e.call('hr','POST','/attendance-compliance/violations',data).status_code==400
    e.db.holiday_calendar.update_one({'tenant_id':'alpha','date':'2026-11-02'},{'$set':{'status':'inactive'}})
    assert next(r for r in summary(e)['days'] if r['date']=='2026-11-02')['required_minutes']>0


def test_manual_checkbox_and_self_verification(setup):
    e=setup;configure(e);data={'employee_id':str(e.people['employee']['_id']),'date':'2026-11-02','rule':'leave_not_applied','reason':'Application missing'}
    assert e.call('hr','POST','/attendance-compliance/violations',data).status_code==400
    data['leave_not_applied']=True
    for _ in range(2):assert e.call('hr','POST','/attendance-compliance/violations',data).status_code==201
    assert ac.ledger(e.db,'alpha',e.people['employee'],'2026-11-02')['balance']==1
    assert e.call('hr','POST','/attendance-compliance/time-adjustments',{'employee_id':str(e.people['hr']['_id']),'date':'2026-11-02','kind':'verified','reason':'Self review','request_id':'self-review'}).status_code==403


def enforcement(e,model='full_month',boundary='final_event'):
    configure(e,monthly_points=1,connected=True,enforce=True,shortage_model=model,final_point_boundary=boundary,wage_codes=['basic'],deduction_cap_percent=10)
    log(e,'2026-11-02');log(e,'2026-11-03');verify(e,'2026-11-02');verify(e,'2026-11-03');process(e)


@pytest.mark.parametrize('model,boundary,expected',[('full_month','final_event',120),('post_grace','final_event',120),('post_grace','next_event',60)])
def test_exhaustion_boundary(setup,model,boundary,expected):
    e=setup;enforcement(e,model,boundary);assert summary(e)['eligible_minutes']==expected


def test_lwp_other_interval_exclusions(setup):
    e=setup;enforcement(e);e.db.leave_requests.insert_one({'tenant_id':'alpha','employee_id':str(e.people['employee']['_id']),'status':'approved','approval_stage':'approved','from_date':'2026-11-02','to_date':'2026-11-02','leave_type':'LWP','leave_days':1})
    ac.add_time_adjustment(e.db,'alpha',e.people['employee'],{'date':'2026-11-03','kind':'other_deduction','intervals':[[540,570]],'reason':'Already deducted with date allocation','request_id':'other-allocation'},'hr')
    s=summary(e);assert s['eligible_minutes']==30 and s['lwp_excluded_minutes']==60 and s['other_excluded_minutes']==30


def approve(e):
    s=summary(e)
    with e.app.app_context():return ac.approve_summary(e.db,'alpha',e.people['employee'],'2026-11',{'fingerprint':s['fingerprint'],'reason':'Evidence reviewed'},str(e.users['hr']['_id']))


def calculation(e,overrides=None):
    structure={'monthly_ctc':30000,'components':[{'code':k,'category':'earning','calculation_type':'fixed','amount':a} for k,a in [('basic',15000),('hra',7500),('medical_allowance',6000),('other_allowances',1500)]]}
    statutory={'rounding_mode':'two_decimals','pf':{'enabled':False},'esi':{'enabled':False},'professional_tax':{'enabled':False},'tds':{'mode':'disabled'},'lwp':{'divisor_mode':'calendar_days'}}
    attendance={'total_days':30,'working_days':24,'lwp_days':0,'paid_leave_days':0,**(overrides or {})}
    base=calculate_payroll(salary_structure=structure,statutory_config=statutory,attendance=attendance)
    return enhance_calculation(e.db,'alpha',e.people['employee'],'2026-11',base,structure,statutory,attendance,{})


def test_payroll_approval_window_dispute_stale(setup,monkeypatch):
    e=setup;enforcement(e);approve(e);assert calculation(e)['attendance_compliance_snapshot']['deduction']==0
    monkeypatch.setattr(ac,'local_now',lambda:datetime(2026,12,15,20));r=calculation(e);assert r['attendance_compliance_snapshot']['deduction']>0
    slip={'employee_id':str(e.people['employee']['_id']),'period_key':'2026-11','attendance_compliance_snapshot':r['attendance_compliance_snapshot']}
    validate_workflow_snapshots(e.db,'alpha',[slip]);assert calculation(e,{'lwp_days':1})['attendance_compliance_snapshot']['deduction']==0
    assert e.call('employee','POST','/attendance-compliance/disputes',{'period':'2026-11','reason':'Please review my field visit'}).status_code==201
    assert calculation(e)['attendance_compliance_snapshot']['deduction']==0
    with pytest.raises(ComplianceError):validate_workflow_snapshots(e.db,'alpha',[slip])
    assert r['attendance_compliance_snapshot']['deduction']>0


def test_correction_invalidates_review(setup):
    e=setup;enforcement(e);approve(e);before=summary(e);log(e,'2026-11-02','09:00','10:00');after=summary(e)
    assert after['fingerprint']!=before['fingerprint'] and ac.review_for(e.db,'alpha',e.people['employee'],after) is None


def test_employment_dates_overrides_cycle(setup):
    e=setup;p=configure(e,overrides=[{'scope':'department','value':'IT','points':5},{'scope':'employee','value':str(e.people['employee']['_id']),'points':3}])
    assert ac.allocation(p,e.people['employee'],'2026-11-02')==3
    e.people['employee'].update(joining_date='2026-11-03',last_working_day='2026-11-06')
    assert summary(e)['required_minutes']==4*480
    assert ac.cycle('2026-11-03',15)=='2026-10-15'
    assert ac.build_summary(e.db,'alpha',e.people['employee'],'2027-01')['eligible_minutes']==0


def test_dynamic_statutory_engine_reused(setup):
    e=setup;configure(e,enabled=False,components=[{'code':'incentive','name':'Incentive','category':'earning','calculation_type':'formula','formula':'basic * 0.1','amount':0,'effective_from':'2026-11-01'}])
    r=calculation(e);assert next(x for x in r['earnings'] if x['code']=='incentive')['amount']==1500
    assert r['totals']['gross_salary']==31500


def test_core_salary_override_and_employer_pass_through(setup):
    e=setup;configure(e,enabled=False,components=[
      {'code':'basic','name':'Basic','category':'earning','calculation_type':'percentage','basis':'monthly_ctc','amount':40,'effective_from':'2026-11-01'},
      {'code':'retirement_extra','name':'Employer benefit','category':'employer_contribution','calculation_type':'fixed','amount':500,'effective_from':'2026-11-01'}])
    r=calculation(e)
    assert next(x for x in r['earnings'] if x['code']=='basic')['amount']==12000
    assert next(x for x in r['deductions'] if x['code']=='retirement_extra_pass_through')['amount']==500
    assert r['totals']['net_amount']==27000


def test_disconnect_blocks_existing_draft_only(setup,monkeypatch):
    e=setup;enforcement(e);approve(e);monkeypatch.setattr(ac,'local_now',lambda:datetime(2026,12,15,20))
    r=calculation(e);snapshot=deepcopy(r['attendance_compliance_snapshot'])
    p=ac.policy(e.db,'alpha');p['connected']=False
    ac.save_policy(e.db,'alpha',{'policy':p,'revision':1,'effective_from':'2026-12-15','reason':'Disconnect pilot'},'hr')
    assert calculation(e)['attendance_compliance_snapshot']['deduction']==0
    with pytest.raises(ComplianceError): validate_workflow_snapshots(e.db,'alpha',[{'employee_id':str(e.people['employee']['_id']),'period_key':'2026-11','attendance_compliance_snapshot':snapshot}])
    assert r['attendance_compliance_snapshot']==snapshot


def test_carry_expiry_daily_cap_and_reversal(setup):
    e=setup;p=configure(e,monthly_points=2,carry_forward=True,carry_max=1,balance_cap=3)
    who=e.people['employee'];ac.ensure_allocation(e.db,'alpha',who,'2026-11-02',p)
    current=ac.ensure_allocation(e.db,'alpha',who,'2026-12-01',p);assert current['balance']==3
    p['expiry_days']=2
    current=ac.ensure_allocation(e.db,'alpha',who,'2026-12-04',p);assert current['balance']==0
    assert current['events'][-1]['kind']=='expiry'


def test_safe_export_and_finance_read_restrictions(setup):
    e=setup;configure(e);eid=str(e.people['employee']['_id']);e.db.employees.update_one({'_id':e.people['employee']['_id']},{'$set':{'name':'=SUM(1,2)'}})
    r=e.call('finance','GET','/attendance-compliance/summary/'+eid+'?period=2026-11');assert r.status_code==200 and 'events' not in r.get_json()['item']
    r=e.call('hr','GET','/attendance-compliance/export?period=2026-11&employee_id='+eid);assert r.status_code==200
    from openpyxl import load_workbook
    from io import BytesIO
    assert load_workbook(BytesIO(r.data)).active['A2'].value.startswith("'=")


def test_preview_is_readonly_matches_first_allocation_and_duplicate(setup):
    e=setup;configure(e);data={'employee_id':str(e.people['employee']['_id']),'date':'2026-11-02','rule':'leave_not_applied','reason':'Application missing','leave_not_applied':True}
    preview=e.call('hr','POST','/attendance-compliance/violations/preview',data).get_json()
    assert preview['before']==2 and preview['after']==1
    assert e.db.employee_compliance_ledgers.count_documents({})==0
    bad={**data,'reason':''}
    assert e.call('hr','POST','/attendance-compliance/violations',bad).status_code==400
    assert e.db.employee_compliance_ledgers.count_documents({})==0
    assert e.call('hr','POST','/attendance-compliance/violations',data).status_code==201
    preview=e.call('hr','POST','/attendance-compliance/violations/preview',data).get_json();assert preview['after']==1 and preview['points']==0


def test_model_b_excludes_unrelated_same_day_shortage(setup):
    e=setup;configure(e,monthly_points=1,connected=True,enforce=True,shortage_model='post_grace',final_point_boundary='final_event',wage_codes=['basic'],deduction_cap_percent=10)
    log(e,'2026-11-02','10:00','17:00');verify(e,'2026-11-02');process(e)
    assert summary(e)['eligible_minutes']==60


def test_simulator_readonly_uses_server_payroll_context(setup,monkeypatch):
    e=setup;configure(e,enabled=False)
    structure={'monthly_ctc':30000,'state_code':'AS','components':[{'code':k,'category':'earning','calculation_type':'fixed','amount':0} for k in ('basic','hra','medical_allowance','other_allowances')]}
    statutory={'pf':{'enabled':False},'esi':{'enabled':False},'professional_tax':{'enabled':False},'tds':{'mode':'disabled'},'lwp':{'divisor_mode':'calendar_days'}}
    monkeypatch.setattr('app.services.payroll_config_service.get_effective_salary_structure',lambda *a,**k:deepcopy(structure))
    monkeypatch.setattr('app.services.payroll_config_service.get_effective_statutory_config',lambda *a,**k:deepcopy(statutory))
    monkeypatch.setattr('app.services.payroll_tax_service.resolve_payroll_tax_context',lambda *a,**k:{'tds':{'mode':'disabled','tds_amount':0}})
    e.db.attendance_summaries.insert_one({'tenant_id':'alpha','employee_id':str(e.people['employee']['_id']),'period_key':'2026-11','total_days':30,'working_days':24,'lwp_days':0})
    before={n:e.db[n].count_documents({}) for n in e.db.list_collection_names()}
    r=e.call('finance','POST','/attendance-compliance/simulate',{'employee_id':str(e.people['employee']['_id']),'period':'2026-11','monthly_ctc':32000,'tds_amount':99999})
    assert r.status_code==200,r.get_json()
    assert r.get_json()['calculation']['totals']['net_amount']==32000
    after={n:e.db[n].count_documents({}) for n in e.db.list_collection_names() if e.db[n].count_documents({})}
    assert {n:v for n,v in before.items() if v}==after


def test_report_filters_apply_before_pagination_and_kpis(setup):
    e=setup;enforcement(e)
    r=e.call('hr','GET','/attendance-compliance/dashboard?period=2026-11&violation_type=late&limit=1&page=1')
    assert r.status_code==200,r.get_json()
    data=r.get_json();assert data['total']==1 and data['stats']['late_violations']==2
    assert data['items'][0]['employee_id']==str(e.people['employee']['_id'])


def test_expiry_is_not_grace_exhaustion_for_payroll(setup):
    e=setup;configure(e,monthly_points=5,expiry_days=4,connected=True,enforce=True,shortage_model='full_month',final_point_boundary='final_event',wage_codes=['basic'],deduction_cap_percent=10)
    log(e,'2026-11-02');verify(e,'2026-11-02');process(e)
    assert summary(e)['points']==0 and summary(e)['eligible_minutes']==0


def test_completed_offline_duplicate_covers_stale_open_punch(setup):
    e=setup;configure(e);log(e,'2026-11-02','09:00',None);log(e,'2026-11-02','09:00','18:00');process(e)
    row=next(r for r in summary(e)['days'] if r['date']=='2026-11-02')
    assert row['accounted_minutes']==480 and not row['uncertain']
    assert summary(e)['violations']==0


def test_disabled_controls_stop_new_backdated_charges_but_allow_restoration(setup):
    e=setup;configure(e);rid=log(e,'2026-11-02','09:00',None);process(e)
    p=ac.policy(e.db,'alpha');p['enabled']=False
    ac.save_policy(e.db,'alpha',{'policy':p,'revision':1,'effective_from':'2026-12-10','reason':'Disable compliance pilot'},'hr')
    e.db.attendance_logs.update_one({'_id':rid},{'$set':{'check_out':datetime(2026,11,2,18)}})
    log(e,'2026-11-03');process(e)
    row=ac.ledger(e.db,'alpha',e.people['employee'],'2026-11-02');assert row['balance']==2
    assert not any(x.get('date')=='2026-11-03' for x in row['events'])
    data={'employee_id':str(e.people['employee']['_id']),'date':'2026-11-03','rule':'leave_not_applied','leave_not_applied':True,'reason':'Backdated violation'}
    assert e.call('hr','POST','/attendance-compliance/violations',data).status_code==400


def test_midmonth_pilot_own_statement_initialises_missing_ledger(setup, monkeypatch):
    e = setup
    monkeypatch.setattr(ac, 'local_now', lambda: datetime(2026, 11, 27, 10, 30))
    p = configure(e, monthly_points=5, balance_cap=5, expiry_days=0)
    p.update(effective_from='2026-11-27')
    e.db.attendance_compliance_settings.update_one({'_id': ac.uid('alpha', 'settings')}, {'$set': {'versions': [p]}})
    log(e, '2026-11-25')  # Before the pilot: never charged.
    assert summary(e)['allocated'] == 0  # Core summary remains read-only.
    url = '/attendance-compliance/summary/me?period=2026-11'
    for _ in range(2):
        r = e.call('employee', 'GET', url)
        assert r.status_code == 200, r.get_json()
        item = r.get_json()['item']
        assert (item['allocated'], item['points'], item['consumed'], item['eligible_minutes']) == (5, 5, 0, 0)
        assert len(item['events']) == 1 and item['events'][0]['date'] == '2026-11-27'
    process(e)
    assert summary(e)['points'] == 5 and len(summary(e)['events']) == 1
    assert summary(e)['violations'] == 0
    assert e.db.employee_compliance_ledgers.count_documents({'tenant_id': 'alpha'}) == 1


def test_current_statement_never_refills_exhausted_points(setup):
    e = setup
    p = configure(e, monthly_points=1)
    who = e.people['employee']
    on = '2026-12-01'
    ac.ensure_allocation(e.db, 'alpha', who, on, p)
    rule = p['rules'][0]
    ac.post_event(e.db, 'alpha', who, on, {'id': 'exhaust-test', 'kind': 'violation', 'rule': rule['code'],
        'rule_snapshot': rule, 'delta': -1, 'actor_id': 'system', 'reason': 'Test charge'}, p)
    r = e.call('employee', 'GET', '/attendance-compliance/summary/me?period=2026-12')
    assert r.status_code == 200, r.get_json()
    assert r.get_json()['item']['points'] == 0
    assert len(ac.ledger(e.db, 'alpha', who, on, p)['events']) == 2


def test_statement_bootstrap_skips_historical_and_disabled(setup):
    e = setup
    who = e.people['employee']
    assert ac.ensure_current_allocation(e.db, 'alpha', who, '2026-12') is None
    configure(e, monthly_points=5)
    assert ac.ensure_current_allocation(e.db, 'alpha', who, '2026-11') is None
    assert ac.ensure_current_allocation(e.db, 'alpha', who, '2027-01') is None
    assert e.db.employee_compliance_ledgers.count_documents({}) == 0


def test_worker_continues_after_employee_error(setup, monkeypatch):
    from app.services import attendance_compliance_worker as worker
    e = setup
    configure(e)
    seen = []
    bad = str(e.people['employee']['_id'])
    good = str(e.people['employee2']['_id'])
    def fake_process(db, tenant, employee, period):
        eid = str(employee['_id'])
        seen.append(eid)
        if eid == bad:
            raise ValueError('Simulated malformed employee data')
    monkeypatch.setattr(ac, 'process_employee', fake_process)
    with pytest.raises(RuntimeError, match='failed'):
        worker.run_once(e.db, 'alpha', '2026-11')
    assert bad in seen and good in seen


def test_worker_starts_once_in_serving_process(monkeypatch):
    from app.services import attendance_compliance_worker as worker
    monkeypatch.delenv('YOURCOMATE_TEST_ISOLATION', raising=False)
    monkeypatch.delenv('ATTENDANCE_COMPLIANCE_WORKER', raising=False)
    class FakeApp:
        config = {}
        extensions = {}
        hooks = []
        def before_request(self, fn):
            self.hooks.append(fn)
            return fn
    started = []
    class FakeThread:
        def __init__(self, **kwargs):
            self.alive = False
        def start(self):
            started.append(self)
            self.alive = True
        def is_alive(self):
            return self.alive
    monkeypatch.setattr(worker, 'Thread', FakeThread)
    app = FakeApp()
    worker.start_worker(app)
    worker.start_worker(app)
    assert len(app.hooks) == 1 and not started
    app.hooks[0]()
    app.hooks[0]()
    assert len(started) == 1
    state = app.extensions['attendance_compliance_worker']
    worker.wake_worker(app)
    assert state['wake'].is_set()
