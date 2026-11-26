
from copy import deepcopy

from test_project_planning import env
from test_team_succession import (
    setup, separate, add_person, leave, bill
)

from app.services import team_responsibility as r
from app.services.lc_workflow import (
    resolve_approver,
    can_confirm_payment,
    can_verify_accounts,
)


def test_reverse_succession_is_team_scoped(setup):
    e = setup

    e.db.employees.update_one(
        {'_id': e.people['other_tl']['_id']},
        {'$set': {
            'reporting_officer_id':
                str(e.people['ro']['_id'])
        }}
    )

    separate(e, 'ro')

    first, state = r.effective_reporting_officer(
        e.db, 'alpha', e.people['tl']['_id']
    )

    second, other_state = r.effective_reporting_officer(
        e.db, 'alpha', e.people['other_tl']['_id']
    )

    assert state == other_state == 'acting'
    assert first['_id'] == e.people['tl']['_id']
    assert second['_id'] == e.people['other_tl']['_id']

    scoped = r.scoped_people(
        e.db, 'alpha', first
    )

    assert e.people['employee']['_id'] in {
        p['_id'] for p in scoped
    }

    assert e.people['outsider']['_id'] not in {
        p['_id'] for p in scoped
    }


def test_new_ro_ends_acting_authority(setup):
    e = setup
    separate(e, 'ro')

    target = add_person(e, 'new_ro', ro=True)

    e.db.employees.update_one(
        {'_id': e.people['tl']['_id']},
        {'$set': {
            'reporting_officer_id': str(target['_id'])
        }}
    )

    current, state = r.effective_reporting_officer(
        e.db, 'alpha', e.people['tl']['_id']
    )

    assert state == 'active'
    assert current['_id'] == target['_id']

    employee = e.people['employee']

    hierarchy = r.hierarchy_for_employee(
        e.db, 'alpha', employee
    )

    assert hierarchy['reporting_officer']['_id'] == target['_id']


def test_combined_role_manager_receives_one_stage(setup):
    e = setup

    e.db.employees.update_one(
        {'_id': e.people['tl']['_id']},
        {'$set': {
            'is_reporting_officer': True,
            'reporting_officer_id':
                str(e.people['tl']['_id'])
        }}
    )

    owner = e.people['employee']

    hierarchy = r.hierarchy_for_employee(
        e.db, 'alpha', owner
    )

    assert r.same_employee(
        hierarchy['team_leader'],
        hierarchy['reporting_officer'],
    )


def test_tl_own_approval_never_returns_self(setup):
    e = setup
    separate(e, 'ro')

    leader = r.resolve(
        e.db, 'alpha', e.people['tl']['_id']
    )

    assert r.initial_manager_stage(
        e.db, 'alpha', leader
    ) == 'hr'

    assert r.reviewer(e.db, 'alpha', leader) is None


def test_tl_lc_routes_to_ro(setup):
    e = setup

    approver = resolve_approver(
        e.db, 'alpha', e.people['tl']
    )

    assert approver['type'] == 'reporting_officer'
    assert approver['employee_ref_id'] == str(
        e.people['ro']['_id']
    )


def test_employee_lc_still_routes_to_tl(setup):
    e = setup

    approver = resolve_approver(
        e.db, 'alpha', e.people['employee']
    )

    assert approver['type'] == 'team_leader'
    assert approver['employee_ref_id'] == str(
        e.people['tl']['_id']
    )


def test_finance_cannot_verify_or_pay_own_claim(setup):
    e = setup
    claimant = e.people['employee']

    claim = {
        'tenant_id': 'alpha',
        'employee_ref_id': str(claimant['_id']),
        'created_by': claimant['user_id'],
        'approval': {'type': 'team_leader'},
    }

    assert not can_verify_accounts(
        claim, claimant, {'finance'}, claimant['user_id']
    )

    assert not can_confirm_payment(
        claim, claimant, {'finance'}, claimant['user_id']
    )


def test_other_team_cannot_receive_acting_ro_scope(setup):
    e = setup
    separate(e, 'ro')

    owner = e.people['employee']
    outsider = e.people['other_tl']

    assert not r.same_employee(
        outsider,
        r.stage_manager(
            e.db, 'alpha', owner, 'reporting_officer'
        ),
    )


def test_missing_tl_uses_reporting_officer(setup):
    e = setup

    e.db.employees.update_one(
        {'_id': e.people['employee']['_id']},
        {'$set': {'team_leader_id': ''}}
    )

    owner = r.resolve(
        e.db, 'alpha', e.people['employee']['_id']
    )

    hierarchy = r.hierarchy_for_employee(
        e.db, 'alpha', owner
    )

    assert hierarchy['team_leader_status'] == 'acting'

    assert hierarchy['team_leader']['_id'] == (
        e.people['ro']['_id']
    )

    assert r.initial_manager_stage(
        e.db, 'alpha', owner
    ) == 'reporting_officer'


def test_historical_approval_remains_unchanged(setup):
    e = setup

    req = leave(e, status='approved')

    before = deepcopy(
        e.db.leave_requests.find_one({'_id': req})
    )

    separate(e, 'ro')

    with e.app.app_context():
        r.reconcile(e.db, 'alpha', dry_run=False)

    after = e.db.leave_requests.find_one({'_id': req})

    assert before == after
