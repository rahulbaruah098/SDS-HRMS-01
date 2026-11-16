"""Weekly Sprint approval routing/security regression tests. No live database.

Runs against the application's existing helper functions, not a replacement
implementation. Uses Flask request contexts and mocked MongoDB lookups.
"""
import unittest
from unittest.mock import MagicMock, patch
from bson import ObjectId
from flask import Flask
import app.routes.sprint_planning as routes

class SprintWeeklyApprovalRegressionTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.db = MagicMock()
        self.owner_id = str(ObjectId())
        self.monthly_id = ObjectId()
        self.tl_id = str(ObjectId())
        self.ro_id = str(ObjectId())
        self.other_id = str(ObjectId())
        self.owner = {'_id':ObjectId(self.owner_id),'tenant_id':'tenant-A'}
        self.tl = {'_id':ObjectId(self.tl_id),'tenant_id':'tenant-A'}
        self.ro = {'_id':ObjectId(self.ro_id),'tenant_id':'tenant-A'}
        self.other = {'_id':ObjectId(self.other_id),'tenant_id':'tenant-A'}

    def context(self):
        return self.app.test_request_context('/api/v1/sprint-planning/weekly')

    def test_pinned_weekly_tl_kind_is_retained(self):
        with self.context(), patch.object(routes,'_monthly_approval_kind') as fallback:
            self.assertEqual(routes._weekly_plan_reviewer_kind(self.db, {'approval_kind':'tl','employee_id':self.owner_id}), 'tl')
            fallback.assert_not_called()

    def test_pinned_weekly_ro_kind_is_retained(self):
        with self.context(), patch.object(routes,'_monthly_approval_kind') as fallback:
            self.assertEqual(routes._weekly_plan_reviewer_kind(self.db, {'approval_kind':' RO ','employee_id':self.owner_id}), 'ro')
            fallback.assert_not_called()

    def test_legacy_weekly_uses_linked_approved_monthly_reviewer(self):
        self.db.sprint_monthly_plans.find_one.return_value={'approval_kind':'ro'}
        plan={'employee_id':self.owner_id,'monthly_plan_id':str(self.monthly_id)}
        with self.context(), patch.object(routes,'_tenant',return_value='tenant-A'), patch.object(routes,'_monthly_approval_kind') as fallback:
            self.assertEqual(routes._weekly_plan_reviewer_kind(self.db, plan),'ro')
            fallback.assert_not_called()
        lookup = self.db.sprint_monthly_plans.find_one.call_args.args[0]
        self.assertEqual(lookup['tenant_id'],'tenant-A')
        self.assertEqual(lookup['employee_id'],self.owner_id)
        self.assertEqual(lookup['status'],'approved')
        self.assertEqual(lookup['_id'],self.monthly_id)
        self.assertEqual(lookup['is_deleted'],{'$ne':True})

    def test_legacy_weekly_falls_back_if_monthly_not_approved(self):
        self.db.sprint_monthly_plans.find_one.return_value=None
        plan={'employee_id':self.owner_id,'monthly_plan_id':str(self.monthly_id)}
        with self.context(), patch.object(routes,'_tenant',return_value='tenant-A'), patch.object(routes,'_monthly_approval_kind',return_value='tl') as fallback:
            self.assertEqual(routes._weekly_plan_reviewer_kind(self.db,plan),'tl')
            fallback.assert_called_once_with(self.db,self.owner_id)

    def test_legacy_weekly_falls_back_if_linked_monthly_has_no_kind(self):
        self.db.sprint_monthly_plans.find_one.return_value={'status':'approved','approval_kind':'invalid'}
        plan={'employee_id':self.owner_id,'monthly_plan_id':str(self.monthly_id)}
        with self.context(), patch.object(routes,'_tenant',return_value='tenant-A'), patch.object(routes,'_monthly_approval_kind',return_value='ro'):
            self.assertEqual(routes._weekly_plan_reviewer_kind(self.db,plan),'ro')

    def test_legacy_weekly_falls_back_on_malformed_monthly_id(self):
        plan={'employee_id':self.owner_id,'monthly_plan_id':'not-an-object-id'}
        with self.context(), patch.object(routes,'_monthly_approval_kind',return_value='tl'):
            self.assertEqual(routes._weekly_plan_reviewer_kind(self.db,plan),'tl')
        self.db.sprint_monthly_plans.find_one.assert_not_called()

    def test_weekly_pinned_approver_is_authorized(self):
        self.db.employees.find_one.return_value=self.tl
        plan={'employee_id':self.owner_id,'approver_employee_id':self.tl_id}
        with self.context(), patch.object(routes,'_tenant',return_value='tenant-A'), patch.object(routes,'_employee',return_value=self.tl):
            self.assertTrue(routes._monthly_can_review_pinned(self.db,plan))
        query=self.db.employees.find_one.call_args.args[0]
        self.assertEqual(query['tenant_id'],'tenant-A')
        self.assertEqual(query['_id'],ObjectId(self.tl_id))

    def test_weekly_pinned_unrelated_reviewer_denied(self):
        self.db.employees.find_one.return_value=self.tl
        plan={'employee_id':self.owner_id,'approver_employee_id':self.tl_id}
        with self.context(), patch.object(routes,'_tenant',return_value='tenant-A'), patch.object(routes,'_employee',return_value=self.other):
            self.assertFalse(routes._monthly_can_review_pinned(self.db,plan))

    def test_weekly_self_approval_rejected(self):
        plan={'employee_id':self.owner_id,'approver_employee_id':self.owner_id}
        with self.context():
            with self.assertRaises(routes.PlanningError):
                routes._monthly_pinned_individual_approver(self.db,plan)
        self.db.employees.find_one.assert_not_called()

    def test_weekly_inactive_approver_rejected(self):
        self.db.employees.find_one.return_value=None
        plan={'employee_id':self.owner_id,'approver_employee_id':self.ro_id}
        with self.context(), patch.object(routes,'_tenant',return_value='tenant-A'):
            with self.assertRaises(routes.PlanningError):
                routes._monthly_pinned_individual_approver(self.db,plan)

    def test_weekly_employee_routes_to_tl_using_shared_resolver(self):
        with patch.object(routes,'_monthly_assigned_tl',return_value=self.tl), patch.object(routes,'_monthly_assigned_ro') as ro:
            reviewer=routes._monthly_next_individual_approver(self.db,self.owner)
        self.assertEqual(str(reviewer['_id']),self.tl_id)
        ro.assert_not_called()

    def test_weekly_team_leader_routes_to_ro_using_shared_resolver(self):
        with patch.object(routes,'_monthly_assigned_tl') as tl, patch.object(routes,'_monthly_assigned_ro',return_value=self.ro):
            reviewer=routes._monthly_next_individual_approver(self.db,self.tl,is_team_leader=True)
        self.assertEqual(str(reviewer['_id']),self.ro_id)
        tl.assert_not_called()

if __name__=='__main__':
    unittest.main()
