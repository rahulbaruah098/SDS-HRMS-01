"""Finance senior LC approval + payment — isolated Flask/Mongo mocks, no DB writes."""
import inspect
import unittest
from unittest.mock import MagicMock, patch
from bson import ObjectId
from flask import Flask, g
from app.services import lc_workflow as svc
from app.routes import local_conveyance as route

APP = Flask('yc-finance-senior-v2')
TENANT = 'sds'
OWNER_EID = ObjectId()
OWNER_UID = ObjectId()
FINANCE_UID = ObjectId()
REF = 'LC/SDS/2026/11/000006'


def bill(state='draft', **kw):
    obj = {'_id': ObjectId(), 'tenant_id': TENANT, 'reference': REF,
           'employee_ref_id': str(OWNER_EID), 'employee_name': 'Senior',
           'created_by': str(OWNER_UID), 'status': state, 'revision': 0,
           'approval': {'type': 'direct_accounts_manager'},
           'manager_validation': {'skipped': True},
           'accounts_verification': None}
    obj.update(kw)
    return obj


class FinanceSeniorApproval(unittest.TestCase):
    def ctx(self, role, uid, action):
        c = APP.test_request_context('/api/v1/local-conveyance/bills/'+REF+'/action',
                                     method='POST', json={'action': action})
        c.push(); self.addCleanup(c.pop)
        g.tenant_id = TENANT
        g.current_user = {'_id': str(uid), 'tenant_id': TENANT, 'role': role, 'roles': [role]}

    def execute(self, record, employee=None):
        db=MagicMock()
        db.local_conveyance_bills.find_one.return_value=record
        db.local_conveyance_bills.update_one.return_value.matched_count=1
        with (patch.object(route,'get_db',return_value=db),
              patch.object(route,'get_current_employee',return_value=employee),
              patch.object(route,'audit'), patch.object(route,'_notify'),
              patch.object(route,'_record')):
            response=inspect.unwrap(route.bill_action)(REF)
        return (response[1] if isinstance(response,tuple) else 200),db

    def test_finance_verifies_direct_senior_claim(self):
        for role in ('finance','accounts_finance'):
            with self.subTest(role=role):
                self.ctx(role, FINANCE_UID, 'accounts_verify')
                status,db=self.execute(bill('pending_accounts'))
                self.assertEqual(status,200)
                self.assertEqual(db.local_conveyance_bills.update_one.call_args.args[1]['$set']['status'],'verified')

    def test_finance_marks_direct_senior_paid_only_after_verification(self):
        self.ctx('finance', FINANCE_UID, 'mark_paid')
        status,db=self.execute(bill('verified',accounts_verification={'by': str(FINANCE_UID)}))
        self.assertEqual(status,200)
        self.assertEqual(db.local_conveyance_bills.update_one.call_args.args[1]['$set']['status'],'paid')

    def test_finance_cannot_pay_unverified_senior(self):
        self.ctx('finance', FINANCE_UID, 'mark_paid')
        status,db=self.execute(bill('pending_accounts'))
        self.assertEqual(status,409)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_claimant_cannot_self_approve(self):
        self.ctx('finance', OWNER_UID, 'accounts_verify')
        status,db=self.execute(bill('pending_accounts'))
        self.assertEqual(status,403)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_claimant_cannot_self_pay(self):
        self.ctx('finance', OWNER_UID, 'mark_paid')
        status,db=self.execute(bill('verified',accounts_verification={'by': str(FINANCE_UID)}))
        self.assertEqual(status,403)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_employee_cannot_review_direct(self):
        self.ctx('employee', FINANCE_UID, 'accounts_verify')
        status,db=self.execute(bill('pending_accounts'))
        self.assertEqual(status,403)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_finance_role_reviewer_discovery_query_tenant_scoped(self):
        from unittest.mock import patch
        db=MagicMock()
        db.users.find.return_value=[{'_id':FINANCE_UID,'role':'finance'}]
        db.employees.find.return_value=[]
        with patch.object(route,'current_tenant_id', return_value=TENANT):
            matches=route._direct_manager_user_ids(db,str(OWNER_UID))
        self.assertEqual(matches,[str(FINANCE_UID)])
        q=db.users.find.call_args.args[0]
        self.assertEqual(q['tenant_id'],TENANT)
        self.assertIn('finance',q['$or'][0]['role']['$in'])

    def test_finance_role_reviewer_discovery_excludes_claimant(self):
        db=MagicMock()
        db.users.find.return_value=[{'_id':OWNER_UID,'role':'finance'}, {'_id':FINANCE_UID,'role':'finance'}]
        db.employees.find.return_value=[]
        with patch.object(route,'current_tenant_id',return_value=TENANT):
            matches=route._direct_manager_user_ids(db,str(OWNER_UID))
        self.assertEqual(matches,[str(FINANCE_UID)])

    def test_action_capability_direct_finance_reviewer(self):
        c=APP.test_request_context('/');c.push();self.addCleanup(c.pop)
        g.tenant_id=TENANT
        g.current_user={'_id': str(FINANCE_UID),'tenant_id':TENANT,'role':'finance','roles':['finance']}
        with (patch.object(route,'get_current_employee',return_value=None),
              patch.object(route,'current_user_roles',return_value={'finance'})):
            result=route._serialize_with_actions(MagicMock(),bill('pending_accounts'))
            self.assertTrue(result['capabilities']['can_accounts_verify'])
            result=route._serialize_with_actions(MagicMock(),bill('verified',accounts_verification={'by':str(FINANCE_UID)}))
            self.assertTrue(result['capabilities']['can_mark_paid'])
            invalid=route._serialize_with_actions(MagicMock(),bill('verified'))
            self.assertFalse(invalid['capabilities']['can_mark_paid'])

if __name__ == '__main__': unittest.main(verbosity=2)
