"""Isolated route/permission regressions. Uses the project's installed Flask/PyMongo.
No MongoDB is contacted. Run from backend: python test_local_conveyance_http.py
These tests are separate from the pure 39-test domain suite.
"""
import inspect
import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

from flask import Flask, g
from bson import ObjectId

import app.routes.local_conveyance as lc
import app.routes.field_visits as visits
import app.routes.attendance as attendance

APP = Flask('yourcomate-lc-isolated-test')
EMP = {'_id': ObjectId(), 'employee_code': 'SDS-0009', 'tenant_id': 'sds', 'name':'Test Employee'}


def raw(handler):
    return inspect.unwrap(handler)


def status(result):
    return result[1] if isinstance(result,tuple) else 200


def payload(result):
    return (result[0] if isinstance(result,tuple) else result).get_json()


class LocalConveyanceHttp(unittest.TestCase):
    def ctx(self, uri, method='GET', data=None, role='employee', tenant='sds'):
        context=APP.test_request_context(uri,method=method,json=data)
        context.push()
        g.tenant_id=tenant
        g.current_user={'_id':str(EMP['_id']),'tenant_id':tenant,'role':role,'roles':[role]}
        self.addCleanup(context.pop)

    def test_default_rates_endpoint(self):
        self.ctx('/api/v1/local-conveyance/settings')
        db=MagicMock()
        db.system_settings.find_one.return_value=None
        with patch.object(lc,'get_db',return_value=db):
            result=raw(lc.lc_settings)()
        self.assertEqual(status(result),200)
        self.assertEqual(payload(result)['two_wheeler_rate'],4)
        self.assertFalse(payload(result)['editable'])

    def test_employee_cannot_update_rates(self):
        self.ctx('/api/v1/local-conveyance/settings','PUT',{'two_wheeler_rate':8,'four_wheeler_rate':20})
        result=raw(lc.update_lc_settings)()
        self.assertEqual(status(result),403)

    def test_hr_can_update_rates(self):
        self.ctx('/api/v1/local-conveyance/settings','PUT',{'two_wheeler_rate':4,'four_wheeler_rate':14},role='hr')
        db=MagicMock()
        with patch.object(lc,'get_db',return_value=db), patch.object(lc,'audit'):
            result=raw(lc.update_lc_settings)()
        self.assertEqual(status(result),200)
        self.assertEqual(db.system_settings.update_one.call_args.args[0]['tenant_id'],'sds')

    def test_employee_cannot_read_another_employee_bill(self):
        self.ctx('/api/v1/local-conveyance/bills/LC/SDS/2026/11/000001')
        db=MagicMock()
        db.local_conveyance_bills.find_one.return_value={'reference':'LC/SDS/2026/11/000001', 'employee_ref_id':'other'}
        with patch.object(lc,'get_db',return_value=db), patch.object(lc,'get_current_employee',return_value=EMP):
            result=raw(lc.bill_detail)('LC/SDS/2026/11/000001')
        self.assertEqual(status(result),403)

    def test_bill_reference_lookup_enforces_tenant(self):
        self.ctx('/api/v1/local-conveyance/bills/LC/SDS/2026/11/000001',role='finance',tenant='tenant-a')
        db=MagicMock()
        db.local_conveyance_bills.find_one.return_value=None
        with patch.object(lc,'get_db',return_value=db), patch.object(lc,'get_current_employee',return_value=None):
            result=raw(lc.bill_detail)('LC/SDS/2026/11/000001')
        self.assertEqual(status(result),404)
        query=db.local_conveyance_bills.find_one.call_args.args[0]
        self.assertEqual(query['tenant_id'],'tenant-a')

    def test_legacy_hr_verification_endpoint_disabled(self):
        self.ctx('/api/v1/local-conveyance/bills/LC/SDS/2026/11/000001/verify','POST',{'action':'hr_verify'})
        with patch.object(lc,'get_db',return_value=MagicMock()),patch.object(lc,'get_current_employee',return_value=EMP):
            result=raw(lc.legacy_verify_disabled)('LC/SDS/2026/11/000001')
        self.assertEqual(status(result),409)
        self.assertEqual(payload(result)['code'],'LC_WORKFLOW_UPDATED')

    def test_accounts_can_only_verify_after_hr(self):
        self.ctx('/api/v1/local-conveyance/bills/LC/SDS/2026/11/000001/verify','POST',{'action':'accounts_verify'},role='finance')
        db=MagicMock()
        db.local_conveyance_bills.find_one.return_value={'_id':ObjectId(),'tenant_id':'sds',
               'reference':'LC/SDS/2026/11/000001','status':'pending_verification','hr_verification':None}
        with patch.object(lc,'get_db',return_value=db), patch.object(lc,'get_current_employee',return_value=None):
            result=raw(lc.legacy_verify_disabled)('LC/SDS/2026/11/000001')
        self.assertEqual(status(result),409)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_legacy_rejection_endpoint_disabled(self):
        self.ctx('/api/v1/local-conveyance/bills/LC/SDS/2026/11/000001/verify','POST',{'action':'reject'},role='hr')
        result=raw(lc.legacy_verify_disabled)('LC/SDS/2026/11/000001')
        self.assertEqual(status(result),409)

    def test_manager_validates_only_assigned_bill(self):
        manager = {**EMP, '_id': ObjectId(), 'is_team_leader': True}
        self.ctx('/api/v1/local-conveyance/bills/LC/SDS/2026/11/000001/action',
                 'POST', {'action': 'manager_validate', 'remarks': 'Checked'}, role='team_leader')
        db = MagicMock()
        db.local_conveyance_bills.find_one.return_value = {
            '_id': ObjectId(), 'tenant_id': 'sds', 'revision': 0,
            'employee_ref_id': str(EMP['_id']), 'employee_name':'Test Employee',
            'reference': 'LC/SDS/2026/11/000001', 'status': 'pending_manager',
            'approval': {'type':'team_leader','employee_ref_id':str(manager['_id'])}}
        db.local_conveyance_bills.update_one.return_value.matched_count=1
        with (patch.object(lc, 'get_db', return_value=db), patch.object(lc,'audit') as audit,
              patch.object(lc, 'get_current_employee', return_value=manager),
              patch.object(lc, '_notify')):
            result = raw(lc.bill_action)('LC/SDS/2026/11/000001')
        self.assertEqual(status(result), 200)
        self.assertEqual(db.local_conveyance_bills.update_one.call_args.args[1]['$set']['status'], 'pending_accounts')
        audit.assert_called_once()

    def test_finance_cannot_mark_paid_before_accounts_verification(self):
        self.ctx('/api/v1/local-conveyance/bills/X/action', 'POST',
                 {'action':'mark_paid', 'remarks':'TXN'}, role='accounts_finance')
        db = MagicMock()
        db.local_conveyance_bills.find_one.return_value = {
            '_id':ObjectId(), 'tenant_id':'sds', 'reference':'X', 'status':'pending_accounts'}
        with patch.object(lc,'get_db',return_value=db),patch.object(lc,'get_current_employee',return_value=None):
            result=raw(lc.bill_action)('X')
        # Finance has payment permission, but the claim is not yet verified.
        self.assertEqual(status(result),409)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_submit_requires_hierarchy_mapping(self):
        self.ctx('/api/v1/local-conveyance/bills/X/action', 'POST', {'action':'submit'})
        db=MagicMock()
        db.local_conveyance_bills.find_one.return_value={
            '_id':ObjectId(),'tenant_id':'sds','reference':'X','status':'draft',
            'employee_ref_id':str(EMP['_id'])}
        with (patch.object(lc,'get_db',return_value=db),
              patch.object(lc,'get_current_employee',return_value=EMP),
              patch.object(lc,'resolve_approver',side_effect=ValueError('No reporting hierarchy'))):
            result=raw(lc.bill_action)('X')
        self.assertEqual(status(result),409)
        db.local_conveyance_bills.update_one.assert_not_called()

    def test_legacy_start_works_but_not_reimbursable(self):
        self.ctx('/api/v1/field-visits/abc/start','POST',{'latitude':26.1,'longitude':91.7})
        db=MagicMock()
        visit={'_id':ObjectId(),'tenant_id':'sds','employee_ref_id':str(EMP['_id']), 'status':'scheduled'}
        db.field_visits.find_one.return_value=visit
        db.system_settings.find_one.return_value=None
        db.field_visits.update_one.return_value.matched_count=1
        with patch.object(visits,'get_db',return_value=db),patch.object(visits,'get_current_employee',return_value=EMP),patch.object(visits,'audit'):
            result=raw(visits.start_visit)(str(visit['_id']))
        self.assertEqual(status(result),200)
        changes=db.field_visits.update_one.call_args.args[1]['$set']
        self.assertEqual(changes['travel']['mode'],'legacy_unspecified')

    def test_end_visit_prevents_duplicate_state_write(self):
        self.ctx('/api/v1/field-visits/abc/end','POST',{'latitude':26.1,'longitude':91.7,'end_km':120})
        db=MagicMock()
        visit={'_id':ObjectId(),'tenant_id':'sds','employee_ref_id':str(EMP['_id']), 'status':'reached',
            'travel':{'mode':'own_two_wheeler','start_km':110,'rate':4}}
        db.field_visits.find_one.return_value=visit
        db.field_visits.update_one.return_value.matched_count=0
        with patch.object(visits,'get_db',return_value=db),patch.object(visits,'get_current_employee',return_value=EMP):
            result=raw(visits.end_visit)(str(visit['_id']))
        self.assertEqual(status(result),409)
        self.assertEqual(payload(result)['code'],'VISIT_STATE_CHANGED')

    def test_checkout_active_visit_blocks_before_write(self):
        self.ctx('/api/v1/attendance/check-out','POST',{'mode':'field'})
        db=MagicMock()
        db.attendance_logs.find_one.return_value={'_id':ObjectId(),'tenant_id':'sds',
            'employee_id':str(EMP['_id']),'check_out':None,'mode':'field'}
        offline={'attendance_time':datetime(2026,11,20,18,15),'server_received_at':datetime.utcnow(),
                 'created_offline':False,'offline_marked_at':None,'client_attendance_id':''}
        with (patch.object(attendance,'get_db',return_value=db), patch.object(attendance,'emp',return_value=EMP),
              patch.object(attendance.face_attendance,'check_submission'),
              patch.object(attendance,'offline_attendance_context',return_value=offline),
              patch.object(attendance,'extract_location',return_value={'latitude':26.1,'longitude':91.7}),
              patch.object(attendance,'validate_attendance_location',return_value=(True,None)),
              patch.object(attendance,'has_active_visit',return_value={'_id':ObjectId()}) as active):
            result=raw(attendance.check_out)()
        self.assertEqual(status(result),409)
        self.assertEqual(payload(result)['code'],'ACTIVE_VISIT_NOT_COMPLETED')
        active.assert_called_once()
        db.attendance_logs.update_one.assert_not_called()


if __name__=='__main__': unittest.main(verbosity=2)
