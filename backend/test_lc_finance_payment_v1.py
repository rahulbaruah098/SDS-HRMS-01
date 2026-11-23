"""Finance role Local Conveyance payment permission regression tests.

Run: cd backend && python -m unittest -v test_lc_finance_payment_v1
Mock-only: never connects to MongoDB or changes payment records.
"""
import inspect
import unittest
from unittest.mock import MagicMock, patch
from flask import Flask, g
from bson import ObjectId

from app.services import lc_workflow as svc
from app.routes import local_conveyance as route

APP = Flask('yc-lc-finance-payment-v1')
EID = ObjectId()
UID = ObjectId()
REF = 'LC/SDS/2026/11/000003'


def make_bill(status='verified', direct=False, with_verification=True, **updates):
    value = dict(
        _id=ObjectId(), tenant_id='sds', reference=REF,
        employee_ref_id=str(EID), employee_name='Another Employee',
        created_by=str(ObjectId()), status=status, revision=1,
        approval={'type': 'direct_accounts_manager' if direct else 'team_leader'},
        manager_validation={'skipped': True} if direct else {'by': 'tl'},
        accounts_verification={'by': 'accounts', 'at': 'earlier'} if with_verification else None,
    )
    value.update(updates)
    return value


class FinancePaymentRules(unittest.TestCase):
    def test_finance_role_enables_payment_without_employee_designation(self):
        for role in ('finance', 'accounts_finance'):
            with self.subTest(role=role):
                self.assertTrue(svc.can_mark_paid({role}, None))
                self.assertTrue(svc.can_mark_paid({role}, {'designation': 'Assistant'}))
                self.assertTrue(svc.can_confirm_payment(make_bill(), None, {role}, str(UID)))

    def test_manager_roles_still_work(self):
        self.assertTrue(svc.can_mark_paid({'accounts_manager'}, None))
        self.assertTrue(svc.can_mark_paid({'finance_manager'}, None))
        self.assertTrue(svc.can_mark_paid({'accounts_finance'}, {'designation': 'Manager (Accounts)'}))

    def test_unrelated_roles_cannot_pay(self):
        for role in ('admin', 'hr', 'employee', 'team_leader', 'accountant', 'accounts'):
            with self.subTest(role=role):
                self.assertFalse(svc.can_mark_paid({role}, None))
        self.assertFalse(svc.can_mark_paid({'admin'}, {'designation': 'Manager Finance & Accounts'}))

    def test_direct_senior_accounts_verification_allows_finance_without_manager_title(self):
        direct = make_bill('pending_accounts', direct=True)
        finance_employee = {'_id': ObjectId(), 'designation': 'Accountant'}
        self.assertTrue(svc.can_verify_accounts(direct, finance_employee, {'finance'}, str(UID)))
        self.assertTrue(svc.can_verify_accounts(direct, finance_employee, {'accounts_finance'}, str(UID)))
        self.assertTrue(svc.can_verify_accounts(direct, finance_employee, {'accounts_manager'}, str(UID)))
        self.assertFalse(svc.can_verify_accounts(direct, finance_employee, {'employee'}, str(UID)))

    def test_normal_accounts_verification_unchanged(self):
        self.assertTrue(svc.can_verify_accounts(make_bill('pending_accounts'), None, {'finance'}, str(UID)))
        self.assertFalse(svc.can_verify_accounts(make_bill('pending_accounts'), None, {'employee'}, str(UID)))

    def test_direct_senior_claimant_cannot_pay_own_claim(self):
        direct = make_bill(direct=True, created_by=str(UID))
        self.assertFalse(svc.can_confirm_payment(direct, None, {'finance'}, str(UID)))
        direct2 = make_bill(direct=True, employee_ref_id=str(EID))
        self.assertFalse(svc.can_confirm_payment(direct2, {'_id': EID}, {'finance'}, str(ObjectId())))

    def test_finance_can_confirm_another_employees_direct_claim(self):
        direct = make_bill(direct=True)
        self.assertTrue(svc.can_confirm_payment(direct, None, {'finance'}, str(UID)))


class FinancePaymentHttp(unittest.TestCase):
    def request(self, role='finance', action='mark_paid'):
        ctx = APP.test_request_context('/api/v1/local-conveyance/bills/'+REF+'/action',
                                       method='POST', json={'action': action})
        ctx.push()
        g.tenant_id = 'sds'
        g.current_user = {'_id': str(UID), 'tenant_id': 'sds', 'role': role, 'roles': [role]}
        self.addCleanup(ctx.pop)

    def exercise(self, bill, employee=None):
        db = MagicMock()
        db.local_conveyance_bills.find_one.return_value = bill
        db.local_conveyance_bills.update_one.return_value.matched_count = 1
        with (patch.object(route, 'get_db', return_value=db),
              patch.object(route, 'get_current_employee', return_value=employee),
              patch.object(route, 'audit'), patch.object(route, '_notify'),
              patch.object(route, '_record')):
            response = inspect.unwrap(route.bill_action)(REF)
        http_status = response[1] if isinstance(response, tuple) else 200
        return http_status, db

    def test_finance_marks_verified_bill_paid_without_profile(self):
        self.request('finance')
        status, db = self.exercise(make_bill())
        self.assertEqual(status, 200)
        update = db.local_conveyance_bills.update_one.call_args
        self.assertEqual(update.args[1]['$set']['status'], 'paid')
        self.assertTrue(update.args[1]['$set']['paid'])
        self.assertEqual(update.args[1]['$set']['paid_by'], str(UID))
        self.assertEqual(update.args[1]['$push']['verification_history']['stage'], 'paid')
        self.assertEqual(db.local_conveyance_bills.find_one.call_args.args[0]['tenant_id'], 'sds')

    def test_accounts_finance_role_marks_paid(self):
        self.request('accounts_finance')
        status, db = self.exercise(make_bill())
        self.assertEqual(status, 200)
        self.assertEqual(db.local_conveyance_bills.update_one.call_args.args[1]['$set']['status'], 'paid')

    def test_reject_payment_before_verification(self):
        self.request('finance')
        for state in ('draft', 'pending_manager', 'pending_accounts', 'paid'):
            with self.subTest(state=state):
                result, db = self.exercise(make_bill(status=state))
                self.assertEqual(result, 409)
                db.local_conveyance_bills.update_one.assert_not_called()

    def test_reject_verified_without_accounts_record(self):
        self.request('finance')
        result, db = self.exercise(make_bill(with_verification=False))
        self.assertEqual(result, 409)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_employee_role_not_allowed_payment(self):
        self.request('employee')
        result, db = self.exercise(make_bill())
        self.assertEqual(result, 403)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_direct_claimant_with_finance_role_cannot_self_pay(self):
        self.request('finance')
        result, db = self.exercise(make_bill(direct=True, created_by=str(UID)))
        self.assertEqual(result, 403)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_backend_capability_controls_button_visibility(self):
        self.request('finance')
        with (patch.object(route, 'get_current_employee', return_value=None),
              patch.object(route, 'current_user_roles', return_value={'finance'})):
            visible = route._serialize_with_actions(MagicMock(), make_bill())
        self.assertTrue(visible['capabilities']['can_mark_paid'])
        with (patch.object(route, 'get_current_employee', return_value=None),
              patch.object(route, 'current_user_roles', return_value={'employee'})):
            visible2 = route._serialize_with_actions(MagicMock(), make_bill())
        self.assertFalse(visible2['capabilities']['can_mark_paid'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
