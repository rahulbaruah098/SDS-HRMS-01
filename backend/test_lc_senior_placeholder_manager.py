"""Regression tests for HR 'Employee' placeholder values in senior LC manager fields."""
import unittest
from unittest.mock import MagicMock, patch
from bson import ObjectId
from flask import Flask, g
import inspect

from app.services import lc_workflow as svc
from app.routes import local_conveyance as lc

BASE = {'_id': ObjectId(), 'user_id': ObjectId(), 'tenant_id': 'sds',
        'name': 'Senior staff', 'designation': 'Managing Director'}
PLACEHOLDERS = {**BASE, 'team_leader': 'Employee', 'reporting_officer': 'Employee'}
APP = Flask('senior-lc-placeholder-test')

class SeniorPlaceholderSafety(unittest.TestCase):
    def test_senior_with_both_placeholders_is_eligible(self):
        self.assertTrue(svc.senior_direct_accounts_eligible(PLACEHOLDERS))

    def test_senior_with_case_and_spaces_is_eligible(self):
        e = {**PLACEHOLDERS, 'team_leader': ' employee ', 'reporting_officer': 'EMPLOYEE'}
        self.assertTrue(svc.senior_direct_accounts_eligible(e))

    def test_ordinary_employee_with_placeholders_not_eligible(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**PLACEHOLDERS, 'designation':'Field Executive'}))

    def test_actual_manager_id_and_placeholder_not_eligible(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**PLACEHOLDERS, 'reporting_officer_id':str(ObjectId())}))

    def test_hidden_later_manager_field_blocks_bypass(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**PLACEHOLDERS, 'manager_id':'SDS-0014'}))

    def test_malformed_manager_reference_blocks_bypass(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**PLACEHOLDERS, 'team_leader':{'unknown_id':'abc'}}))

    def test_manager_dict_with_true_id_blocks_bypass(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**PLACEHOLDERS, 'team_leader':{'name':'Employee','_id':str(ObjectId())}}))

    def test_senior_with_actual_manager_not_eligible(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**BASE,'team_leader':'Actual Manager'}))

    def test_senior_placeholder_resolver_signals_bypass(self):
        db = MagicMock()
        with self.assertRaisesRegex(ValueError, 'Accounts Manager verification'):
            svc.resolve_approver(db, 'sds', PLACEHOLDERS)
        db.employees.find.assert_not_called()

    def test_ordinary_placeholder_still_blocked(self):
        db = MagicMock()
        db.employees.find.return_value.limit.return_value = []
        with self.assertRaisesRegex(ValueError,'mapping is missing or ambiguous'):
            svc.resolve_approver(db,'sds', {**PLACEHOLDERS,'designation':'Field Executive'})

    def test_real_manager_route_still_operates(self):
        approver_id = ObjectId()
        db = MagicMock()
        db.employees.find.return_value.limit.return_value = [{'_id': approver_id, 'name':'Actual Manager'}]
        result = svc.resolve_approver(db,'sds', {**BASE,'team_leader': 'Actual Manager'})
        self.assertEqual(result['type'],'team_leader')
        self.assertEqual(result['employee_ref_id'],str(approver_id))

    def test_direct_submit_with_placeholders(self):
        claimant_uid = BASE['user_id']
        finance_uid=ObjectId()
        bill = {'_id':ObjectId(), 'tenant_id':'sds','reference':'LC/SDS/2026/11/000006',
                'status':'draft', 'employee_ref_id':str(BASE['_id']), 'employee_name':'Senior staff',
                'created_by':str(claimant_uid),'revision':0,'approval':None}
        db=MagicMock()
        db.local_conveyance_bills.find_one.return_value=bill
        db.local_conveyance_bills.update_one.return_value.matched_count=1
        db.users.find.return_value=[{'_id':finance_uid, 'role':'accounts_manager'}]
        db.employees.find.return_value=[]
        ctx=APP.test_request_context('/api/v1/local-conveyance/bills/LC/SDS/2026/11/000006/action',
                                      method='POST',json={'action':'submit'})
        with ctx:
            g.tenant_id='sds'
            g.current_user={'_id':str(claimant_uid),'tenant_id':'sds','role':'employee','roles':['employee']}
            with (patch.object(lc,'get_db',return_value=db),
                  patch.object(lc,'get_current_employee',return_value=PLACEHOLDERS),
                  patch.object(lc,'audit'), patch.object(lc,'_notify')):
                response=inspect.unwrap(lc.bill_action)('LC/SDS/2026/11/000006')
            self.assertEqual(response[1] if isinstance(response,tuple) else 200,200)
            changes=db.local_conveyance_bills.update_one.call_args.args[1]['$set']
            self.assertEqual(changes['status'],'pending_accounts')
            self.assertEqual(changes['approval']['type'],'direct_accounts_manager')

if __name__=='__main__':
    unittest.main(verbosity=2)
