"""Isolated v2 workflow regressions (no Mongo connection or Flask application).

Run within the complete YourComate backend environment:
  python test_lc_workflow_v2.py
"""
import unittest
from decimal import Decimal
from unittest.mock import MagicMock
from bson import ObjectId
from app.services.lc_workflow import (resolve_approver, is_approver, can_read,
    can_mark_paid, correction_lines, ACCOUNT_ROLES)
from app.services.local_conveyance import has_recorded_field_visit

TENANT = 'sds'
E = {'_id': ObjectId(), 'tenant_id': TENANT, 'employee_code': 'SDS-0009',
     'name': 'Example Employee'}
TL = {'_id': ObjectId(), 'tenant_id': TENANT, 'name': 'Team Lead',
      'user_id': ObjectId(), 'is_team_leader': True}
RO = {'_id': ObjectId(), 'tenant_id': TENANT, 'name': 'Reporting Officer',
      'user_id': ObjectId(), 'is_reporting_officer': True}


class Cursor(list):
    def limit(self, count):
        return Cursor(self[:count])


class DbStub:
    def __init__(self, people):
        self.people = people
        self.employees = self
    def find(self, query):
        self.last_query = query
        matches = []
        for user in self.people:
            if user.get('tenant_id') != query.get('tenant_id') or user.get('is_deleted') is True:
                continue
            or_filters = query.get('$or', [])
            if any(str(user.get(k)) == str(v) for filt in or_filters for k, v in filt.items()):
                matches.append(user)
        return Cursor(matches)


class WorkflowRules(unittest.TestCase):
    def setUp(self):
        self.db = DbStub([E, TL, RO])

    def test_team_leader_priority(self):
        item = {**E, 'team_leader_id': str(TL['_id']), 'reporting_officer_id': str(RO['_id'])}
        result = resolve_approver(self.db, TENANT, item)
        self.assertEqual(result['type'], 'team_leader')
        self.assertEqual(result['employee_ref_id'], str(TL['_id']))

    def test_reporting_officer_fallback(self):
        item = {**E, 'reporting_officer_id': str(RO['_id'])}
        self.assertEqual(resolve_approver(self.db, TENANT, item)['type'], 'reporting_officer')

    def test_team_leader_name_mapping(self):
        item = {**E, 'team_leader_name': 'Team Lead'}
        self.assertEqual(resolve_approver(self.db, TENANT, item)['employee_ref_id'], str(TL['_id']))

    def test_unmapped_employee_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'No Team Leader'):
            resolve_approver(self.db, TENANT, E)

    def test_bad_team_leader_does_not_fallback(self):
        item = {**E, 'team_leader_id': str(ObjectId()), 'reporting_officer_id': str(RO['_id'])}
        with self.assertRaisesRegex(ValueError, 'mapping'):
            resolve_approver(self.db, TENANT, item)

    def test_tenant_bound(self):
        item = {**E, 'team_leader_id': str(TL['_id'])}
        db = DbStub([{**TL, 'tenant_id': 'other-company'}])
        with self.assertRaisesRegex(ValueError, 'mapping'):
            resolve_approver(db, TENANT, item)
        self.assertEqual(db.last_query['tenant_id'], TENANT)

    def test_ambiguous_name_fails_closed(self):
        item = {**E, 'team_leader_name': 'Team Lead'}
        db = DbStub([TL, {**TL, '_id': ObjectId()}])
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            resolve_approver(db, TENANT, item)

    def test_prevent_self_approval(self):
        item = {**E, 'team_leader_id': str(E['_id'])}
        with self.assertRaisesRegex(ValueError, 'Self-approval'):
            resolve_approver(self.db, TENANT, item)

    def test_assigned_team_leader_can_validate(self):
        bill = {'employee_ref_id': str(E['_id']),
                'approval': {'employee_ref_id': str(TL['_id']), 'type': 'team_leader'},
                'status': 'pending_manager'}
        self.assertTrue(is_approver(bill, TL, {'employee'}))
        self.assertFalse(is_approver(bill, RO, {'reporting_officer'}))
        self.assertFalse(is_approver(bill, E, {'admin'}))

    def test_reporting_officer_can_validate(self):
        bill = {'employee_ref_id': str(E['_id']),
                'approval': {'employee_ref_id': str(RO['_id']), 'type': 'reporting_officer'},
                'status': 'pending_manager'}
        self.assertTrue(is_approver(bill, RO, {'employee'}))

    def test_employee_cannot_read_other_draft(self):
        bill = {'employee_ref_id': str(E['_id']), 'status': 'draft', 'approval': None}
        self.assertFalse(can_read(bill, TL, {'employee'}))
        self.assertFalse(can_read(bill, RO, {'reporting_officer'}))
        self.assertTrue(can_read(bill, E, {'employee'}))
        self.assertFalse(can_read(bill, None, {'accounts_finance'}))

    def test_accounts_can_read_submitted(self):
        bill = {'employee_ref_id': str(E['_id']), 'status': 'pending_accounts'}
        self.assertTrue(can_read(bill, None, {'accounts_finance'}))
        self.assertFalse(can_read(bill, None, {'employee'}))

    def test_finance_role_can_mark_paid_without_manager_designation(self):
        self.assertTrue(can_mark_paid({'finance'}, None))
        self.assertTrue(can_mark_paid({'accounts_finance'}, None))
        self.assertTrue(can_mark_paid({'accounts_finance'}, {'designation': 'Accountant'}))
        self.assertTrue(can_mark_paid({'accounts_manager'}, None))
        self.assertFalse(can_mark_paid({'accountant'}, {'designation': 'Assistant'}))
        self.assertFalse(can_mark_paid({'admin'}, {'designation': 'Accounts Manager'}))

    def test_accounts_manager_can_verify_and_record_actual_payment(self):
        self.assertIn('accounts_manager', ACCOUNT_ROLES)
        self.assertTrue(can_mark_paid({'accounts_manager'}, None))
        self.assertIn('accounts_finance', ACCOUNT_ROLES)
        self.assertTrue(can_mark_paid({'accounts_finance'}, None))

    def test_employee_and_accounts_can_see_paid_status(self):
        bill = {'employee_ref_id': str(E['_id']), 'status': 'paid'}
        self.assertTrue(can_read(bill, E, {'employee'}))
        self.assertTrue(can_read(bill, None, {'accounts_manager'}))
        self.assertFalse(can_read(bill, RO, {'employee'}))

    def sample(self):
        return [
            {'visit_id': 'v1', 'date': '2026-11-07', 'mode': 'own_two_wheeler',
             'from_location': 'A', 'to_location': 'B', 'purpose': 'Meeting', 'project': '',
             'remarks': '', 'start_km': 100, 'end_km': 115, 'rate': 4, 'amount': 60},
            {'visit_id': 'v2', 'date': '2026-11-08', 'mode': 'public_transport',
             'from_location': 'B', 'to_location': 'C', 'purpose': 'Survey', 'project': '',
             'remarks': '', 'fare': 125, 'amount': 125},
        ]

    def test_employee_correction_recalculates_amount(self):
        original = self.sample()
        edited = [{**original[0], 'end_km': 120}, {**original[1], 'fare': 140}]
        lines, total = correction_lines(original, edited)
        self.assertEqual(lines[0]['amount'], 80)
        self.assertEqual(lines[1]['amount'], 140)
        self.assertEqual(total, 220)
        self.assertEqual(original[0]['amount'], 60)

    def test_immutable_fields_cannot_be_forged(self):
        original = self.sample()
        edited = [{**original[0], 'rate': 1, 'start_km': 0, 'mode': 'public_transport',
                   'visit_id': 'v1'}, original[1]]
        lines, total = correction_lines(original, edited)
        self.assertEqual(total, 185)
        self.assertEqual(lines[0]['rate'], 4)
        self.assertEqual(lines[0]['start_km'], 100)
        self.assertEqual(lines[0]['mode'], 'own_two_wheeler')

    def test_cannot_remove_visit(self):
        with self.assertRaisesRegex(ValueError, 'remain'):
            correction_lines(self.sample(), [self.sample()[0]])

    def test_cannot_add_visit(self):
        with self.assertRaisesRegex(ValueError, 'remain'):
            correction_lines(self.sample(), self.sample() + [{**self.sample()[0], 'visit_id':'v3'}])

    def test_lower_end_km_rejected(self):
        original = self.sample()
        with self.assertRaisesRegex(ValueError, 'Ending KM'):
            correction_lines(original, [{**original[0], 'end_km': 99}, original[1]])

    def test_negative_fare_rejected(self):
        original = self.sample()
        with self.assertRaisesRegex(ValueError, 'Fare'):
            correction_lines(original, [original[0], {**original[1], 'fare': -10}])

    def test_missing_purpose_rejected(self):
        original = self.sample()
        with self.assertRaisesRegex(ValueError, 'Purpose'):
            correction_lines(original, [{**original[0], 'purpose': ''}, original[1]])

    def test_recorded_visit_status_and_day(self):
        employee = {'_id': ObjectId(), 'employee_code': 'SDS-0009'}
        db = MagicMock()
        db.field_visits.find_one.return_value = {'_id': ObjectId()}
        self.assertTrue(has_recorded_field_visit(db, 'sds', employee, '2026-11-21'))
        query = db.field_visits.find_one.call_args.args[0]
        self.assertEqual(query['scheduled_date'], '2026-11-21')
        self.assertEqual(query['status']['$in'], ['started', 'reached', 'completed'])
        db.field_visits.find_one.return_value = None
        self.assertFalse(has_recorded_field_visit(db, 'sds', employee, '2026-11-21'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
