"""Test the EXACT embedded HR profile placeholder reported in the real SDS record."""
import unittest
from unittest.mock import MagicMock, patch
from bson import ObjectId
from flask import Flask, g
from app.services import lc_workflow as svc
from app.routes import local_conveyance as api
import inspect

PROFILE = {'display_name': 'Employee', 'employee_name': 'Employee',
           'initials': 'EM', 'name': 'Employee', 'photo_url': '', 'cover_url': ''}
BASE = {'_id':ObjectId(), 'user_id':ObjectId(), 'tenant_id':'sds',
        'designation':'Managing Director', 'name':'Parag Boruah',
        'team_leader': dict(PROFILE), 'reporting_officer':dict(PROFILE)}
APP=Flask('lc-senior-profile-placeholder')

class NestedPlaceholderSafety(unittest.TestCase):
    def test_exact_live_shape_is_eligible(self):
        self.assertTrue(svc.senior_direct_accounts_eligible(BASE))
    def test_exact_live_shape_triggers_bypass_signal(self):
        db=MagicMock()
        with self.assertRaisesRegex(ValueError, 'Accounts Manager verification'):
            svc.resolve_approver(db,'sds',BASE)
        db.employees.find.assert_not_called()
    def test_normal_employee_cannot_bypass(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**BASE,'designation':'Office Assistant'}))
    def test_dict_with_real_id_cannot_bypass(self):
        e={**BASE,'team_leader':{**PROFILE,'_id':str(ObjectId())}}
        self.assertFalse(svc.senior_direct_accounts_eligible(e))
    def test_even_blank_id_field_blocks(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**BASE,'team_leader':{**PROFILE,'employee_id':''}}))
    def test_additional_mapping_field_blocks(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**BASE,'manager_id':'SDS-0014'}))
    def test_mismatched_real_name_blocks(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**BASE,'team_leader':{**PROFILE,'name':'Real Manager'}}))
    def test_unknown_key_blocks(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**BASE,'team_leader':{**PROFILE,'staff_code':'X'}}))
    def test_unexpected_initials_blocks(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**BASE,'team_leader':{**PROFILE,'initials':'XX'}}))
    def test_nonblank_photo_blocks(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**BASE,'team_leader':{**PROFILE,'photo_url':'https://example.test/img'}}))
    def test_real_object_manager_blocks(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**BASE,'team_leader':{'name':'A Manager','employee_code':'SDS-0020'}}))
    def test_empty_profile_without_name_blocks(self):
        self.assertFalse(svc.senior_direct_accounts_eligible({**BASE,'team_leader':{'initials':'EM'}}))
    def test_simple_text_placeholder_still_allowed(self):
        self.assertTrue(svc.senior_direct_accounts_eligible({**BASE,'team_leader':'Employee','reporting_officer':'Employee'}))
    def test_direct_claim_submits_to_accounts(self):
        claimant_user=str(BASE['user_id'])
        finance_id=ObjectId()
        bill={'_id':ObjectId(),'tenant_id':'sds','reference':'LC/SDS/2026/11/000006',
              'status':'draft','employee_ref_id':str(BASE['_id']),
              'employee_name':'Parag Boruah','created_by':claimant_user,
              'revision':0,'approval':None}
        db=MagicMock()
        db.local_conveyance_bills.find_one.return_value=bill
        db.local_conveyance_bills.update_one.return_value.matched_count=1
        db.users.find.return_value=[{'_id':finance_id,'role':'accounts_manager'}]
        db.employees.find.return_value=[]
        with APP.test_request_context('/api/v1/local-conveyance/bills/LC/SDS/2026/11/000006/action',
                                      method='POST',json={'action':'submit'}):
            g.tenant_id='sds'
            g.current_user={'_id':claimant_user,'tenant_id':'sds','role':'employee','roles':['employee']}
            with (patch.object(api,'get_db',return_value=db),
                  patch.object(api,'get_current_employee',return_value=BASE),
                  patch.object(api,'audit'),patch.object(api,'_notify')):
                response=inspect.unwrap(api.bill_action)('LC/SDS/2026/11/000006')
            status=response[1] if isinstance(response,tuple) else 200
            self.assertEqual(status,200)
            changes=db.local_conveyance_bills.update_one.call_args.args[1]['$set']
            self.assertEqual(changes['status'],'pending_accounts')
            self.assertEqual(changes['approval']['type'],'direct_accounts_manager')
            self.assertTrue(changes['manager_validation']['skipped'])

if __name__=='__main__':
    unittest.main(verbosity=2)
