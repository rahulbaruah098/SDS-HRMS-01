"""Regression checks for My Visits vehicle history and project picker.
Uses the existing JWT/mongomock fixture; no production database is contacted.
"""
from datetime import datetime

from bson import ObjectId
from test_project_planning import env  # existing fixture in this test directory

TWO = 'own_two_wheeler'
FOUR = 'own_four_wheeler'


def add_visit(env, person='employee', **fields):
    employee = env.people[person]
    return str(env.db.field_visits.insert_one({
        'tenant_id': employee['tenant_id'], 'employee_ref_id': str(employee['_id']),
        'scheduled_date': '2026-11-23', 'status': 'scheduled', 'is_deleted': False,
        **fields,
    }).inserted_id)


def start(env, visit, **fields):
    return env.call('employee', 'POST', f'/field-visits/{visit}/start', {
        'latitude': 26.1, 'longitude': 91.7, 'accuracy': 5,
        'travel_mode': TWO, 'vehicle_number': 'AS01AB1234', 'start_km': '10',
        'from_location': 'Office', 'to_location': 'Site', 'purpose': 'Field visit',
        'project_id': '', **fields,
    })


def add_project(env, name, *, tenant='alpha', department='IT', person='employee', status='active'):
    return str(env.db.projects.insert_one({
        'tenant_id': tenant, 'name': name, 'department': department,
        'status': status, 'is_deleted': False,
        'assigned_employee_ids': [str(env.people[person]['_id'])],
    }).inserted_id)


def test_saved_vehicle_history_and_legacy_response(env):
    employee = env.people['employee']
    env.db.employees.update_one({'_id': employee['_id']}, {'$set': {'my_visit_vehicles': {TWO: 'AS 01 AB 1234'}}})
    add_visit(env, status='completed', started_at=datetime(2026, 11, 20), travel={'mode': TWO, 'vehicle_number': 'AS-01-XY-5678'})
    add_visit(env, person='employee2', status='completed', started_at=datetime(2026, 11, 20), travel={'mode': TWO, 'vehicle_number': 'AS01XX0000'})
    assert start(env, add_visit(env), vehicle_number='as01ab1234').status_code == 200
    assert start(env, add_visit(env), vehicle_number='AS01CD5678').status_code == 200
    assert start(env, add_visit(env), travel_mode=FOUR, vehicle_number='AS01EF9012').status_code == 200
    assert start(env, add_visit(env), vehicle_number='AS01ZZ9999', start_km='').status_code == 400
    result = env.call('employee', 'GET', '/field-visits/saved-vehicles').get_json()
    assert result['items'][TWO] == 'AS01CD5678'
    compact = lambda v: v.replace(' ', '').replace('-', '')
    assert sorted(map(compact, result['vehicle_options'][TWO])) == sorted(['AS01AB1234', 'AS01XY5678', 'AS01CD5678'])
    assert result['vehicle_options'][FOUR] == ['AS01EF9012']


def test_project_options_scope_and_snapshot(env):
    own = add_project(env, 'Own project')
    cross = add_project(env, 'Cross-department project', department='Finance')
    hidden = add_project(env, 'Unassigned same department', person='employee2')
    completed = add_project(env, 'Completed project', status='completed')
    hold = add_project(env, 'On hold project', status='on_hold')
    foreign = add_project(env, 'Foreign project', tenant='beta')
    result = env.call('employee', 'GET', '/field-visits/project-options')
    assert result.status_code == 200
    assert {item['id'] for item in result.get_json()['items']} == {own, cross}
    for project_id in [hidden, completed, hold, foreign, str(ObjectId())]:
        vid = add_visit(env)
        assert start(env, vid, project_id=project_id).status_code == 400
        assert env.db.field_visits.find_one({'_id': ObjectId(vid)})['status'] == 'scheduled'
    vid = add_visit(env)
    result = start(env, vid, project_id=cross, project='spoofed name')
    assert result.status_code == 200
    assert result.get_json()['item']['travel']['project_id'] == cross
    assert result.get_json()['item']['travel']['project'] == 'Cross-department project'
    env.db.projects.update_one({'_id': ObjectId(cross)}, {'$set': {'name': 'Renamed'}})
    assert env.db.field_visits.find_one({'_id': ObjectId(vid)})['travel']['project'] == 'Cross-department project'
    assert start(env, add_visit(env), project_id='').status_code == 200


def test_old_mobile_text_project_still_accepted(env):
    vid = add_visit(env)
    result = env.call('employee', 'POST', f'/field-visits/{vid}/start', {
        'latitude': 26.1, 'longitude': 91.7, 'travel_mode': TWO,
        'vehicle_number': 'AS01AB1234', 'start_km': '10', 'from_location': 'A',
        'to_location': 'B', 'purpose': 'Visit', 'project': 'Legacy free-text label',
    })
    assert result.status_code == 200
    assert result.get_json()['item']['travel']['project'] == 'Legacy free-text label'
    assert 'project_id' not in result.get_json()['item']['travel']
