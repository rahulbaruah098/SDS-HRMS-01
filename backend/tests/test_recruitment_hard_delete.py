"""Physical deletion tests (no real MongoDB connections)."""
import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from tests.test_recruitment_workflow import MemoryCollection, RecruitmentWorkflowTests
from app.services.recruitment_service import (
    APPLICATIONS, HIRING_REQUESTS, JOB_OPENINGS,
    RecruitmentServiceError,
)


def memory_delete_one(self, query):
    from tests.test_recruitment_workflow import _matches
    for i, doc in enumerate(self.documents):
        if _matches(doc, query):
            self.documents.pop(i)
            return SimpleNamespace(deleted_count=1)
    return SimpleNamespace(deleted_count=0)


def memory_delete_many(self, query):
    from tests.test_recruitment_workflow import _matches
    before = len(self.documents)
    self.documents = [doc for doc in self.documents if not _matches(doc, query)]
    return SimpleNamespace(deleted_count=before - len(self.documents))


class PermanentRecruitmentDeletionTests(unittest.TestCase):
    def setUp(self):
        self.patcher1 = patch.object(MemoryCollection, 'delete_one', memory_delete_one, create=True)
        self.patcher2 = patch.object(MemoryCollection, 'delete_many', memory_delete_many, create=True)
        self.patcher1.start(); self.addCleanup(self.patcher1.stop)
        self.patcher2.start(); self.addCleanup(self.patcher2.stop)
        self.fixture = RecruitmentWorkflowTests(methodName='test_draft_edit_updates_required_by_and_keeps_ownership')
        self.fixture.setUp()
        self.f = self.fixture

    def _draft(self):
        self.f.hr.update_settings({'career_company_about':'Recruitment company profile'})
        return self.f.hr.create_hiring_request({
            'job_title':'Developer', 'department':'IT', 'business_reason':'Hiring need',
            'expected_joining_date': (date.today() + timedelta(days=60)).isoformat(),
            'resume_submission_deadline': (date.today() + timedelta(days=40)).isoformat(),
        })

    def test_draft_physically_removed(self):
        doc=self._draft()
        result=self.f.hr.delete_hiring_request_permanently(str(doc['_id']))
        self.assertTrue(result['deleted'])
        self.assertIsNone(self.f.db[HIRING_REQUESTS].find_one({'_id':doc['_id']}))

    def test_other_tenant_cannot_delete(self):
        doc=self._draft()
        with self.assertRaises(RecruitmentServiceError) as err:
            self.f.other_hr.delete_hiring_request_permanently(str(doc['_id']))
        self.assertEqual(err.exception.status_code,404)
        self.assertIsNotNone(self.f.db[HIRING_REQUESTS].find_one({'_id':doc['_id']}))

    def test_regular_employee_cannot_delete(self):
        doc=self._draft()
        with self.assertRaises(RecruitmentServiceError) as err:
            self.f.employee.delete_hiring_request_permanently(str(doc['_id']))
        self.assertEqual(err.exception.status_code,403)

    def test_hiring_request_removes_unreferenced_linked_job(self):
        req,job=self.f._create_approved_job(open_job=True)
        result=self.f.hr.delete_hiring_request_permanently(str(req['_id']))
        self.assertTrue(result['deleted'])
        self.assertEqual(result['deleted_jobs'],1)
        self.assertIsNone(self.f.db[HIRING_REQUESTS].find_one({'_id':req['_id']}))
        self.assertIsNone(self.f.db[JOB_OPENINGS].find_one({'_id':job['_id']}))

    def test_posted_job_can_be_deleted_from_database(self):
        req,job=self.f._create_approved_job(open_job=True)
        result=self.f.hr.delete_job_opening_permanently(str(job['_id']))
        self.assertTrue(result['deleted'])
        self.assertIsNone(self.f.db[JOB_OPENINGS].find_one({'_id':job['_id']}))
        self.assertIsNotNone(self.f.db[HIRING_REQUESTS].find_one({'_id':req['_id']}))

    def test_deletion_blocked_if_candidate_applied(self):
        req,job=self.f._create_approved_job(open_job=True)
        self.f._create_candidate_application(job['_id'])
        for action in (lambda:self.f.hr.delete_job_opening_permanently(str(job['_id'])), lambda:self.f.hr.delete_hiring_request_permanently(str(req['_id']))):
            with self.assertRaises(RecruitmentServiceError) as err: action()
            self.assertEqual(err.exception.status_code,409)
        self.assertIsNotNone(self.f.db[HIRING_REQUESTS].find_one({'_id':req['_id']}))
        self.assertIsNotNone(self.f.db[JOB_OPENINGS].find_one({'_id':job['_id']}))
        self.assertEqual(self.f.db[APPLICATIONS].count_documents({'tenant_id':self.f.TENANT_A}),1)

    def test_deleted_application_history_still_blocks_removal(self):
        req,job=self.f._create_approved_job(open_job=True)
        _candidate, application=self.f._create_candidate_application(job['_id'])
        self.f.db[APPLICATIONS].update_one({'_id':application['_id']},{'$set':{'is_deleted':True}})
        with self.assertRaises(RecruitmentServiceError) as err:
            self.f.hr.delete_job_opening_permanently(str(job['_id']))
        self.assertEqual(err.exception.status_code,409)

    def test_public_careers_stops_showing_deleted_job(self):
        req,job=self.f._create_approved_job(open_job=True)
        before=self.f.public.get_public_job_by_slug(job['public_slug'])
        self.assertEqual(before['job_title'],job['job_title'])
        self.f.hr.delete_job_opening_permanently(str(job['_id']))
        with self.assertRaises(RecruitmentServiceError) as err:
            self.f.public.get_public_job_by_slug(job['public_slug'])
        self.assertEqual(err.exception.status_code,404)

    def test_job_delete_requires_authorised_hr(self):
        req,job=self.f._create_approved_job(open_job=True)
        with self.assertRaises(RecruitmentServiceError) as err:
            self.f.manager.delete_job_opening_permanently(str(job['_id']))
        self.assertEqual(err.exception.status_code,403)


if __name__=='__main__': unittest.main()
