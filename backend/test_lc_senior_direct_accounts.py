"""Regression tests for senior Local Conveyance direct-to-Accounts Manager flow.

Run in backend venv: python -m unittest -v test_lc_senior_direct_accounts
Mocks Flask API database calls: no live MongoDB data is read or changed.
"""
import inspect
import unittest
from unittest.mock import MagicMock, patch
from flask import Flask, g
from bson import ObjectId

from app.services import lc_workflow as service
from app.routes import local_conveyance as lc

APP = Flask('yourcomate-senior-accounts-direct-tests')
TENANT = 'sds'
CLAIMANT_UID = ObjectId()
CLAIMANT_EID = ObjectId()
FINANCE_UID = ObjectId()
FINANCE_EID = ObjectId()
CLAIMANT = {'_id': CLAIMANT_EID, 'user_id': CLAIMANT_UID,
            'name': 'Senior Employee', 'tenant_id': TENANT,
            'designation': 'Managing Director'}
FINANCE_MANAGER = {'_id': FINANCE_EID, 'user_id': FINANCE_UID,
                   'name': 'Finance Manager', 'tenant_id': TENANT,
                   'designation': 'Accounts Manager'}


def raw(handler):
    return inspect.unwrap(handler)


def status(response):
    return response[1] if isinstance(response, tuple) else 200


def data(response):
    return (response[0] if isinstance(response, tuple) else response).get_json()


def bill(state='draft', approval=None, **extra):
    return dict(_id=ObjectId(), tenant_id=TENANT,
                reference='LC/SDS/2026/11/000006', status=state,
                employee_ref_id=str(CLAIMANT_EID),
                employee_name='Senior Employee', created_by=str(CLAIMANT_UID),
                revision=0, approval=approval, **extra)


class SeniorRoutingUnitTests(unittest.TestCase):
    def test_managing_director_without_manager_eligible(self):
        self.assertTrue(service.senior_direct_accounts_eligible(CLAIMANT))

    def test_regular_employee_without_manager_cannot_skip(self):
        self.assertFalse(service.senior_direct_accounts_eligible({**CLAIMANT,
                          'designation': 'Field Executive'}))

    def test_admin_role_is_not_senior_designation(self):
        self.assertFalse(service.senior_direct_accounts_eligible({**CLAIMANT,
                          'designation': 'Field Executive', 'role': 'admin'}))

    def test_mapped_senior_cannot_skip(self):
        self.assertFalse(service.senior_direct_accounts_eligible({**CLAIMANT,
                          'reporting_officer_id': str(ObjectId())}))

    def test_explicit_hr_senior_override(self):
        self.assertTrue(service.senior_direct_accounts_eligible({**CLAIMANT,
                          'designation': 'Project Head', 'lc_direct_accounts_approval': True}))

    def test_accounts_finance_role_cannot_approve_direct(self):
        direct = bill('pending_accounts', {'type': 'direct_accounts_manager'})
        self.assertFalse(service.can_verify_accounts(direct, None, {'finance'}, str(FINANCE_UID)))

    def test_accounts_manager_role_can_verify_direct(self):
        direct = bill('pending_accounts', {'type': 'direct_accounts_manager'})
        self.assertTrue(service.can_verify_accounts(direct, FINANCE_MANAGER,
                         {'accounts_manager'}, str(FINANCE_UID)))

    def test_designated_accounts_manager_finance_role_can_verify(self):
        direct = bill('pending_accounts', {'type': 'direct_accounts_manager'})
        self.assertTrue(service.can_verify_accounts(direct, FINANCE_MANAGER,
                         {'accounts_finance'}, str(FINANCE_UID)))

    def test_self_approval_denied_by_employee_and_auth_id(self):
        direct = bill('pending_accounts', {'type': 'direct_accounts_manager'})
        self.assertFalse(service.can_verify_accounts(direct, CLAIMANT,
                         {'accounts_manager'}, str(CLAIMANT_UID)))
        self.assertFalse(service.can_verify_accounts(direct, None,
                         {'accounts_manager'}, str(CLAIMANT_UID)))
        self.assertFalse(service.can_confirm_payment(direct, CLAIMANT,
                         {'accounts_manager'}, str(CLAIMANT_UID)))

    def test_normal_accounts_flow_unchanged(self):
        regular = bill('pending_accounts', {'type': 'team_leader'})
        self.assertTrue(service.can_verify_accounts(regular, None, {'finance'}))
        self.assertTrue(service.can_confirm_payment(regular, None, {'accounts_manager'}))


class SeniorRoutingHttpTests(unittest.TestCase):
    def ctx(self, role='employee', uid=CLAIMANT_UID, payload=None):
        ctx = APP.test_request_context('/api/v1/local-conveyance/bills/LC/SDS/2026/11/000006/action',
                                       method='POST', json=payload or {'action': 'submit'})
        ctx.push()
        g.tenant_id = TENANT
        g.current_user = {'_id': str(uid), 'tenant_id': TENANT, 'role': role, 'roles': [role]}
        self.addCleanup(ctx.pop)

    @staticmethod
    def mock_db(record):
        db = MagicMock()
        db.local_conveyance_bills.find_one.return_value = record
        db.local_conveyance_bills.update_one.return_value.matched_count = 1
        db.users.find.return_value = [{'_id': FINANCE_UID, 'role': 'accounts_manager'}]
        db.employees.find.return_value = []
        return db

    def call(self, db, employee):
        with (patch.object(lc, 'get_db', return_value=db),
              patch.object(lc, 'get_current_employee', return_value=employee),
              patch.object(lc, 'audit'), patch.object(lc, '_notify')):
            return raw(lc.bill_action)('LC/SDS/2026/11/000006')

    def test_senior_direct_submission(self):
        self.ctx()
        db = self.mock_db(bill())
        result = self.call(db, CLAIMANT)
        self.assertEqual(status(result), 200)
        changes = db.local_conveyance_bills.update_one.call_args.args[1]['$set']
        self.assertEqual(changes['status'], 'pending_accounts')
        self.assertEqual(changes['approval']['type'], 'direct_accounts_manager')
        self.assertTrue(changes['manager_validation']['skipped'])
        self.assertEqual(db.users.find.call_args.args[0]['tenant_id'], TENANT)

    def test_missing_finance_manager_refuses_submission(self):
        self.ctx()
        db = self.mock_db(bill())
        db.users.find.return_value = []
        result = self.call(db, CLAIMANT)
        self.assertEqual(status(result), 409)
        self.assertEqual(data(result)['code'], 'LC_FINANCE_MANAGER_REQUIRED')
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_ordinary_employee_missing_manager_still_blocked(self):
        self.ctx()
        db = self.mock_db(bill())
        result = self.call(db, {**CLAIMANT, 'designation': 'Field Executive'})
        self.assertEqual(status(result), 409)
        self.assertEqual(data(result)['code'], 'LC_APPROVER_MAPPING_REQUIRED')
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_finance_role_cannot_verify_direct(self):
        self.ctx(role='finance', uid=FINANCE_UID, payload={'action': 'accounts_verify'})
        db = self.mock_db(bill('pending_accounts', {'type': 'direct_accounts_manager'},
                               manager_validation={'skipped': True}))
        result = self.call(db, FINANCE_MANAGER)
        # Finance employee with an HR Accounts Manager designation may verify.
        self.assertEqual(status(result), 200)
        self.assertEqual(db.local_conveyance_bills.update_one.call_args.args[1]['$set']['status'], 'verified')

    def test_plain_finance_user_cannot_verify_direct(self):
        self.ctx(role='finance', uid=FINANCE_UID, payload={'action': 'accounts_verify'})
        db = self.mock_db(bill('pending_accounts', {'type': 'direct_accounts_manager'},
                               manager_validation={'skipped': True}))
        result = self.call(db, {**FINANCE_MANAGER, 'designation': 'Accountant'})
        self.assertEqual(status(result), 403)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_accounts_manager_can_verify_direct(self):
        self.ctx(role='accounts_manager', uid=FINANCE_UID, payload={'action': 'accounts_verify'})
        db = self.mock_db(bill('pending_accounts', {'type': 'direct_accounts_manager'},
                               manager_validation={'skipped': True}))
        result = self.call(db, FINANCE_MANAGER)
        self.assertEqual(status(result), 200)
        self.assertEqual(db.local_conveyance_bills.update_one.call_args.args[1]['$set']['status'], 'verified')

    def test_claimant_cannot_verify_direct(self):
        self.ctx(role='accounts_manager', uid=CLAIMANT_UID, payload={'action': 'accounts_verify'})
        db = self.mock_db(bill('pending_accounts', {'type': 'direct_accounts_manager'},
                               manager_validation={'skipped': True}))
        result = self.call(db, CLAIMANT)
        self.assertEqual(status(result), 403)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_accounts_manager_can_mark_paid_after_verification(self):
        self.ctx(role='accounts_manager', uid=FINANCE_UID, payload={'action': 'mark_paid'})
        db = self.mock_db(bill('verified', {'type': 'direct_accounts_manager'},
                               manager_validation={'skipped': True},
                               accounts_verification={'by': str(FINANCE_UID)}))
        result = self.call(db, FINANCE_MANAGER)
        self.assertEqual(status(result), 200)
        self.assertEqual(db.local_conveyance_bills.update_one.call_args.args[1]['$set']['status'], 'paid')


if __name__ == '__main__':
    unittest.main(verbosity=2)
