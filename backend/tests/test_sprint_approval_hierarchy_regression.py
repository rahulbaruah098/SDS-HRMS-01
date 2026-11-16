"""Read-only regression tests for existing Sprint monthly approval routing.

All employee data and database operations are mocked. No live DB connection.
Run: python -B -m unittest discover -s tests -p test_sprint_approval_hierarchy_regression.py -v
"""
import unittest
from unittest.mock import MagicMock, patch

from bson import ObjectId
from flask import Flask, g

import app.routes.sprint_planning as routes


class SprintApprovalHierarchyRegressionTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.db = MagicMock()
        self.employee_id = str(ObjectId())
        self.tl_id = str(ObjectId())
        self.ro_id = str(ObjectId())
        self.other_id = str(ObjectId())
        self.employee = {'_id': ObjectId(self.employee_id), 'tenant_id': 'tenant-A'}
        self.tl = {'_id': ObjectId(self.tl_id), 'tenant_id': 'tenant-A'}
        self.ro = {'_id': ObjectId(self.ro_id), 'tenant_id': 'tenant-A'}

    def context(self):
        return self.app.test_request_context('/api/v1/sprint-planning/monthly')

    def actor(self, employee):
        return patch.object(routes, '_employee', return_value=employee)

    def tenant(self):
        return patch.object(routes, '_tenant', return_value='tenant-A')

    def test_pinned_monthly_approver_can_review(self):
        plan = {'employee_id': self.employee_id, 'approver_employee_id': self.tl_id}
        self.db.employees.find_one.return_value = self.tl
        with self.context(), self.tenant(), self.actor(self.tl):
            self.assertTrue(routes._monthly_can_review_pinned(self.db, plan))

    def test_unrelated_employee_cannot_review_pinned_monthly(self):
        plan = {'employee_id': self.employee_id, 'approver_employee_id': self.tl_id}
        self.db.employees.find_one.return_value = self.tl
        other = {'_id': ObjectId(self.other_id), 'tenant_id': 'tenant-A'}
        with self.context(), self.tenant(), self.actor(other):
            self.assertFalse(routes._monthly_can_review_pinned(self.db, plan))

    def test_pinned_monthly_self_approval_rejected(self):
        plan = {'employee_id': self.employee_id, 'approver_employee_id': self.employee_id}
        with self.context(), self.tenant():
            with self.assertRaisesRegex(routes.PlanningError, 'self-approved'):
                routes._monthly_pinned_individual_approver(self.db, plan)
            self.db.employees.find_one.assert_not_called()

    def test_missing_active_pinned_approver_rejected(self):
        self.db.employees.find_one.return_value = None
        plan = {'employee_id': self.employee_id, 'approver_employee_id': self.tl_id}
        with self.context(), self.tenant():
            with self.assertRaisesRegex(routes.PlanningError, 'no longer an active'):
                routes._monthly_pinned_individual_approver(self.db, plan)

    def test_employee_monthly_routes_to_team_leader(self):
        with patch.object(routes, '_monthly_assigned_tl', return_value=self.tl) as tl_lookup, \
             patch.object(routes, '_monthly_assigned_ro', return_value=self.ro) as ro_lookup:
            selected = routes._monthly_next_individual_approver(self.db, self.employee)
        self.assertEqual(str(selected['_id']), self.tl_id)
        tl_lookup.assert_called_once()
        ro_lookup.assert_not_called()

    def test_team_leader_monthly_routes_to_reporting_officer(self):
        with patch.object(routes, '_monthly_assigned_tl') as tl_lookup, \
             patch.object(routes, '_monthly_assigned_ro', return_value=self.ro) as ro_lookup:
            selected = routes._monthly_next_individual_approver(self.db, self.tl, is_team_leader=True)
        self.assertEqual(str(selected['_id']), self.ro_id)
        tl_lookup.assert_not_called()
        ro_lookup.assert_called_once()

    def test_no_configured_monthly_approver_rejected(self):
        with patch.object(routes, '_monthly_assigned_tl', return_value=None), \
             patch.object(routes, '_monthly_assigned_ro', return_value=None):
            with self.assertRaisesRegex(routes.PlanningError, 'No authorised monthly'):
                routes._monthly_next_individual_approver(self.db, self.employee)

    def test_team_compilation_routes_to_distinct_ro(self):
        with patch.object(routes, '_monthly_assigned_ro', return_value=self.ro):
            result = routes._monthly_next_compilation_approver(self.db, self.tl)
        self.assertEqual(str(result['_id']), self.ro_id)

    def test_team_compilation_self_review_rejected(self):
        with patch.object(routes, '_monthly_assigned_ro', return_value=self.tl):
            with self.assertRaisesRegex(routes.PlanningError, 'same employee'):
                routes._monthly_next_compilation_approver(self.db, self.tl)

    def test_compilation_owner_can_submit_but_not_review(self):
        doc = {'team_leader_employee_id': self.tl_id, 'approver_employee_id': self.ro_id, 'status': 'draft'}
        with self.actor(self.tl):
            self.assertEqual(routes._compilation_access(self.db, doc), (True, False))
            result = routes._compilation_view(self.db, doc)
        self.assertTrue(result['can_submit'])
        self.assertFalse(result['can_review'])

    def test_compilation_pinned_ro_can_review_pending(self):
        doc = {'team_leader_employee_id': self.tl_id, 'approver_employee_id': self.ro_id, 'status': 'pending_approval'}
        with self.actor(self.ro):
            result = routes._compilation_view(self.db, doc)
        self.assertFalse(result['can_submit'])
        self.assertTrue(result['can_review'])

    def test_compilation_unrelated_reviewer_denied(self):
        doc = {'team_leader_employee_id': self.tl_id, 'approver_employee_id': self.ro_id, 'status': 'pending_approval'}
        other = {'_id': ObjectId(self.other_id), 'tenant_id': 'tenant-A'}
        with self.actor(other):
            result = routes._compilation_view(self.db, doc)
        self.assertFalse(result['can_submit'])
        self.assertFalse(result['can_review'])


if __name__ == '__main__':
    unittest.main()
