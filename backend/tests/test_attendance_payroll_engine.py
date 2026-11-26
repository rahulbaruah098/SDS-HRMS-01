from decimal import Decimal
import pytest
from app.services.attendance_payroll_engine import *


def test_interval_union_credits_and_lwp():
    expected=[[540,780],[840,1080]]
    accounted=intersect(union([[540,700],[650,780],[900,1020],[700,780],[840,930]]),expected)
    assert length(accounted)==420
    assert subtract(subtract(expected,accounted),[[1000,1050]])==[[1050,1080]]


def test_overnight_breaks():
    assert schedule_intervals({'start':'22:00','end':'06:00','breaks':[{'start':'02:00','end':'03:00'}]})==[[1320,1560],[1620,1800]]
    assert length(schedule_intervals({'start':'09:00','end':'18:00','breaks':[{'start':'13:00','end':'14:00','paid':True}]}))==540


@pytest.mark.parametrize('expression',['__import__("os")','x.__class__','[x for x in y]','2 ** 100000','lambda: 1','open(1)','min(x=1)','(1,2)','True','1e1000','abs(1,2)','1 / 0'])
def test_rejects_unsafe_or_unbounded_formulas(expression):
    with pytest.raises(ComplianceError): formula(expression,{'x':1,'y':2})


def test_decimal_formula_conditional():
    assert formula('0.1 + 0.2',{})==Decimal('.3')
    assert formula('max(0, basic * 0.5) if payable_days >= 20 else 0',{'basic':10000,'payable_days':21})==5000
    assert formula('abs(-3)',{})==3


def component(code,**kw): return {'code':code,'name':code,'category':'earning','calculation_type':'fixed','amount':100,**kw}


def test_dependencies_and_deterministic_order():
    items=[component('bonus',calculation_type='formula',formula='travel * 2'),component('travel')]
    assert [r['code'] for r in component_order(items)]==['travel','bonus']
    assert {r['code']:r['amount'] for r in calculate_components(items,{k:0 for k in BASES},{},'2026-11')}=={'bonus':200,'travel':100}


@pytest.mark.parametrize('items',[[component('tds')],[component('a',calculation_type='formula',formula='b'),component('b',calculation_type='formula',formula='a')],[component('x',calculation_type='formula',formula='unknown')],[component('x',statutory=True)],[component('x',attendance_related=True)],[component('x',minimum=200,maximum=100)]])
def test_invalid_component_graph(items):
    with pytest.raises(ComplianceError): component_order(items)


def test_slab_and_scope():
    c=component('bonus',calculation_type='slab',basis='gross_salary',slabs=[{'up_to':10000,'amount':100},{'up_to':20000,'amount':200}])
    values={k:0 for k in BASES};values['gross_salary']=15000
    assert calculate_components([c],values,{},'2026-11')[0]['amount']==200
    c['eligibility']={'employee_id':['one']}
    assert calculate_components([c],values,{'_id':'two'},'2026-11')[0]['amount']==0


def test_money_precision_bounds_dates():
    assert money(Decimal(30000)/11040*300)==Decimal('815.22')
    for value in ('NaN','Infinity',-1):
        with pytest.raises(ComplianceError): number(value,0)
    assert len(month_days('2024-02'))==29
    with pytest.raises(ComplianceError): month_days('2026-13')


def test_condition_false_does_not_apply_minimum():
    c=component('bonus',condition='payable_days > 20',minimum=100)
    assert calculate_components([c],{k:0 for k in BASES},{},'2026-11')[0]['amount']==0


def test_custom_time_deduction_cannot_bypass_allocations():
    with pytest.raises(ComplianceError):component_order([component('penalty',category='deduction',calculation_type='minute',amount=5)])


def test_explicit_core_override_dependency_cycle_rejected():
    with pytest.raises(ComplianceError):component_order([component('basic',calculation_type='formula',formula='hra * 2'),component('hra',calculation_type='formula',formula='basic / 2')])
