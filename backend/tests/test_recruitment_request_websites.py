"""Targeted Recruitment regression tests. Uses the project's existing in-memory DB fixtures."""
import unittest
from datetime import date, timedelta
from tests.test_recruitment_workflow import RecruitmentWorkflowTests
from app.services.recruitment_service import RecruitmentServiceError


class HiringRequestOrganizationWebsitesTests(unittest.TestCase):
    def setUp(self):
        self.fixture = RecruitmentWorkflowTests('test_employee_without_recruitment_role_cannot_create_hiring_request')
        self.fixture.setUp()
        self.hr = self.fixture.hr
        self.admin = self.fixture.admin
        self.hr.update_settings({'career_company_about': 'Multicompany group profile for test.'})

    def request_payload(self, websites):
        return {
            'job_title': 'Field Coordinator', 'department': 'Operations',
            'business_reason': 'Approved operational need',
            'expected_joining_date': (date.today() + timedelta(days=60)).isoformat(),
            'resume_submission_deadline': (date.today() + timedelta(days=45)).isoformat(),
            'approver_user_ids': [str(self.fixture.admin_id)],
            'organization_websites': websites,
        }

    def test_hiring_request_create_edit_then_job_inherits_websites(self):
        links=[{'name':'Organization A','url':'https://example.com'}, {'name':'Organization B','url':'https://example.org'}]
        req=self.hr.create_hiring_request(self.request_payload(links))
        self.assertEqual(req['organization_websites'],links)
        edited=[{'name':'Organization C','url':'https://example.net'}]
        updated=self.hr.update_hiring_request(req['_id'], {'organization_websites':edited})
        self.assertEqual(updated['organization_websites'],edited)
        self.hr.submit_hiring_request(req['_id'])
        self.admin.decide_hiring_request(req['_id'], 'approved')
        job=self.hr.create_job_opening({'hiring_request_id':str(req['_id']), 'description':'Support field operations.'})
        self.assertEqual(job['organization_websites'],edited)
        self.assertEqual(self.hr._public_job(job)['organization_websites'],edited)

    def test_request_without_website_keeps_old_optional_behavior(self):
        payload=self.request_payload([])
        del payload['organization_websites']
        req=self.hr.create_hiring_request(payload)
        self.assertEqual(req['organization_websites'],[])

    def test_unsafe_website_is_rejected(self):
        bad=[{'name':'Unsafe','url':'javascript:alert(1)'}]
        with self.assertRaises(RecruitmentServiceError):
            self.hr.create_hiring_request(self.request_payload(bad))

    def test_edit_unsafe_website_rejected_and_existing_preserved(self):
        original=[{'name':'Organization A','url':'https://example.com'}]
        req=self.hr.create_hiring_request(self.request_payload(original))
        with self.assertRaises(RecruitmentServiceError):
            self.hr.update_hiring_request(req['_id'],{'organization_websites':[{'name':'Bad','url':'http://localhost:5000'}]})
        stored=self.hr.get_hiring_request(req['_id'])
        self.assertEqual(stored['organization_websites'],original)

    def test_submitted_request_cannot_edit_websites(self):
        req=self.hr.create_hiring_request(self.request_payload([]))
        self.hr.submit_hiring_request(req['_id'])
        with self.assertRaises(RecruitmentServiceError):
            self.hr.update_hiring_request(req['_id'],{'organization_websites':[{'name':'Org','url':'https://example.com'}]})


if __name__=='__main__': unittest.main()
