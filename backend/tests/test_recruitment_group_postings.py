"""Regression coverage: group websites and safe job editing (no real database writes)."""
import unittest
from unittest.mock import Mock
from datetime import timedelta, date
from bson import ObjectId
from app.services.recruitment_service import (
    RecruitmentService, RecruitmentServiceError, normalize_organization_websites
)

class OrganizationWebsiteRules(unittest.TestCase):
    def test_multiple_organizations(self):
        result=normalize_organization_websites([
            {'name':'Group Member A','url':'https://example.org'},
            {'name':'Group Member B','url':'https://example.net/about'},
        ])
        self.assertEqual(len(result),2)
        self.assertEqual(result[1]['name'],'Group Member B')
    def test_no_websites_is_allowed(self):
        self.assertEqual(normalize_organization_websites([]),[])
    def test_blocks_non_http_links(self):
        for unsafe in ('javascript:alert(1)','file:///etc/passwd','https://user:secret@example.org', 'https://localhost'):
            with self.subTest(unsafe=unsafe), self.assertRaises(RecruitmentServiceError):
                normalize_organization_websites([{'name':'Unsafe','url':unsafe}])
    def test_no_duplicate_website(self):
        with self.assertRaises(RecruitmentServiceError):
            normalize_organization_websites([{'name':'A','url':'https://example.com'},{'name':'B','url':'https://example.com/'}])
    def test_missing_name_rejected(self):
        with self.assertRaises(RecruitmentServiceError):
            normalize_organization_websites([{'name':'','url':'https://example.com'}])
    def test_max_twelve(self):
        with self.assertRaises(RecruitmentServiceError):
            normalize_organization_websites([{'name':str(x),'url':f'https://site{x}.example.com'} for x in range(13)])

class EditablePostingRules(unittest.TestCase):
    def setUp(self):
        self.svc = RecruitmentService.__new__(RecruitmentService)
        self.svc.tenant_id='sds'
        self.svc.actor_id='hr-user-1'
        self.svc.actor_name='HR'
        self.svc._require_hr_publisher = Mock()
        self.job = {'_id': ObjectId(), 'tenant_id':'sds', 'job_title':'Existing', 'status':'open', 'filled_vacancies':2}
        self.svc._get = Mock(side_effect=lambda col, key, label: dict(self.job))
        self.collection=Mock()
        self.collection.update_one.return_value.matched_count=1
        self.svc._c=Mock(return_value=self.collection)
        self.svc._activity=Mock()
    def test_edit_preserves_immutable_fields(self):
        tomorrow=(date.today()+timedelta(days=400)).isoformat()
        self.svc.update_job_opening(str(self.job['_id']), {
            'job_title':'Edited','description':'Changed', 'closing_date':tomorrow,
            'organization_name':'Member company',
            'organization_websites':[{'name':'Member company','url':'https://example.com'}],
            'tenant_id':'other-company', 'status':'cancelled', 'public_slug':'hijack', 'hiring_request_id':'forged'
        })
        query, update=self.collection.update_one.call_args.args
        self.assertEqual(query['tenant_id'],'sds')
        fields=update['$set']
        self.assertEqual(fields['job_title'],'Edited')
        self.assertNotIn('tenant_id',fields)
        self.assertNotIn('status',fields)
        self.assertNotIn('hiring_request_id',fields)
        self.assertNotIn('public_slug',fields)
    def test_vacancy_below_filled_rejected(self):
        with self.assertRaises(RecruitmentServiceError):
            self.svc.update_job_opening(str(self.job['_id']), {'vacancies':1})
    def test_bad_url_rejected(self):
        with self.assertRaises(RecruitmentServiceError):
            self.svc.update_job_opening(str(self.job['_id']), {'organization_websites':[{'name':'X','url':'javascript:alert(1)'}]})
    def test_title_cannot_be_emptied(self):
        with self.assertRaises(RecruitmentServiceError):
            self.svc.update_job_opening(str(self.job['_id']), {'job_title':' '})
    def test_requires_hr_publisher(self):
        self.svc._require_hr_publisher.side_effect=RecruitmentServiceError('Denied',status_code=403)
        with self.assertRaises(RecruitmentServiceError):
            self.svc.update_job_opening(str(self.job['_id']), {'job_title':'Edited'})
        self.collection.update_one.assert_not_called()

if __name__=='__main__': unittest.main()
