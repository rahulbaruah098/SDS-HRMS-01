
from flask import g

from test_project_planning import env
from test_team_succession import setup, leave

from app.services import team_responsibility as r
from app.services.lc_workflow import resolve_approver

from app.routes.dashboard import (
    build_employee_team_hierarchy_tree,
)

TENANT = 'alpha'


def combined(e):
    e.db.employees.update_one(
        {'_id': e.people['tl']['_id']},
        {'$set': {'is_reporting_officer': True}},
    )

    return r.resolve(
        e.db, TENANT, e.people['tl']['_id']
    )


def test_combined_leader_keeps_own_superior(setup):
    e = setup
    leader = combined(e)

    hierarchy = r.hierarchy_for_employee(
        e.db, TENANT, leader
    )

    assert r.same_employee(
        hierarchy['team_leader'], leader
    )

    assert r.same_employee(
        hierarchy['reporting_officer'], leader
    )

    assert r.same_employee(
        r.reviewer(e.db, TENANT, leader),
        e.people['ro'],
    )

    assert not r.same_employee(
        leader,
        r.reviewer(e.db, TENANT, leader),
    )


def test_combined_member_leave_is_single_stage(setup):
    e = setup
    leader = combined(e)

    member = e.people['employee']

    hierarchy = r.hierarchy_for_employee(
        e.db, TENANT, member
    )

    assert r.same_employee(
        hierarchy['team_leader'], leader
    )

    assert r.same_employee(
        hierarchy['reporting_officer'], leader
    )

    oid = leave(e)

    e.db.leave_requests.update_one(
        {'_id': oid},
        {'$set': {'leave_type': 'LWP'}},
    )

    response = e.call(
        'tl',
        'PATCH',
        f'/leave_requests/{oid}/decision',
        {
            'status': 'approved',
            'note': 'Combined role test',
        },
    )

    assert response.status_code == 200, (
        response.get_json()
    )

    record = e.db.leave_requests.find_one(
        {'_id': oid}
    )

    assert record['status'] == 'approved'

    decisions = [
        entry
        for entry in record['approval_history']
        if entry.get('status') == 'approved'
    ]

    assert len(decisions) == 1


def test_combined_leader_own_leave_to_superior(setup):
    e = setup
    leader = combined(e)

    stage = r.initial_manager_stage(
        e.db, TENANT, leader
    )

    assert stage == 'reporting_officer'

    oid = leave(e, owner='tl')

    e.db.leave_requests.update_one(
        {'_id': oid},
        {'$set': {
            'leave_type': 'LWP',
            'approval_stage': stage,
            'reporting_officer_status': 'pending',
        }},
    )

    forbidden = e.call(
        'tl',
        'PATCH',
        f'/leave_requests/{oid}/decision',
        {'status': 'approved'},
    )

    assert forbidden.status_code in (403, 404)

    approved = e.call(
        'ro',
        'PATCH',
        f'/leave_requests/{oid}/decision',
        {'status': 'approved'},
    )

    assert approved.status_code == 200, (
        approved.get_json()
    )

    assert e.db.leave_requests.find_one({
        '_id': oid,
    })['status'] == 'approved'


def test_combined_role_lc_routing(setup):
    e = setup
    leader = combined(e)

    member_claim = resolve_approver(
        e.db, TENANT, e.people['employee']
    )

    assert member_claim['employee_ref_id'] == str(
        leader['_id']
    )

    leader_claim = resolve_approver(
        e.db, TENANT, leader
    )

    assert leader_claim['employee_ref_id'] == str(
        e.people['ro']['_id']
    )


def test_combined_role_scope_remains_isolated(setup):
    e = setup
    leader = combined(e)

    scope = {
        p['_id']
        for p in r.scoped_people(
            e.db, TENANT, leader
        )
    }

    assert e.people['employee']['_id'] in scope

    assert e.people['outsider']['_id'] not in scope

    superior_scope = {
        p['_id']
        for p in r.scoped_people(
            e.db, TENANT, e.people['ro']
        )
    }

    assert leader['_id'] in superior_scope


def test_combined_root_map_with_personal_superior(setup):
    e = setup
    leader = combined(e)

    with e.app.test_request_context(method='GET'):
        g.tenant_id = TENANT
        g.current_user = e.users['tl']

        tree = build_employee_team_hierarchy_tree(
            e.db,
            TENANT,
            leader,
            e.users['tl']['roles'],
        )

    assert tree['team_leader']['employee_id'] == str(
        leader['_id']
    )

    assert tree['reporting_officer']['employee_id'] == str(
        leader['_id']
    )

    assert tree['effective_hierarchy'][
        'combined_responsibilities'
    ] is True


def test_ordinary_tl_does_not_gain_permanent_ro_role(setup):
    e = setup

    leader = e.people['tl']

    assert not r.capability(leader, 'ro')

    officer, state = r.effective_reporting_officer(
        e.db, TENANT, leader['_id']
    )

    assert state == 'active'
    assert r.same_employee(officer, e.people['ro'])
