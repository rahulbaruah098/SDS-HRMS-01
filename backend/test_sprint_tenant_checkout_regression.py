"""Isolated YourComate Sprint/attendance regression tests.

Run from the YourComate backend folder:
    .\\venv\\Scripts\\python.exe path\\to\\test_sprint_tenant_checkout_regression.py

No MongoDB connections are opened, and all checkout writes/audits are mocked.
The real project's Flask, PyMongo and route modules must be installed locally.
"""
import inspect
import unittest
from contextlib import ExitStack
from datetime import datetime, time
from unittest.mock import MagicMock, patch

from flask import Flask, g

import app.routes.attendance as attendance
import app.routes.sprint_planning as sprint


APP = Flask('yourcomate_isolated_sprint_regression')
WORK_DATE = '2026-11-05'
WORK_TIME = datetime(2026, 11, 5, 19, 0, 0)


def raw_handler(fn):
    """Avoid authentication decorator; exercise handler logic with isolated identity."""
    return inspect.unwrap(fn)


def http_status(result):
    if isinstance(result, tuple):
        return result[1]
    return getattr(result, 'status_code', 200)


class StrictPlanCollection:
    def __init__(self, docs):
        self.docs = docs
        self.query_history = []

    def find_one(self, query):
        self.query_history.append(query)
        for doc in self.docs:
            if all(doc.get(k) == v or (isinstance(v, dict) and '$ne' in v and doc.get(k) != v['$ne'])
                   for k, v in query.items()):
                return dict(doc)
        return None

    def find(self, query):
        self.query_history.append(query)
        self.result = [dict(d) for d in self.docs if all(
            d.get(k) == v or (isinstance(v, dict) and '$ne' in v and d.get(k) != v['$ne'])
            for k, v in query.items()
        )]
        return self

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, count):
        self.result = self.result[:count]
        return self

    def __iter__(self):
        return iter(self.result)


class SprintRegression(unittest.TestCase):
    def _checkout(self, tenant, enabled, planned, ready):
        """Invoke real checkout body, with every DB dependency replaced by mocks."""
        db = MagicMock()
        attendance_record = {
            '_id': 'isolated-attendance-id', 'tenant_id': tenant,
            'employee_id': 'isolated-employee-id', 'date': WORK_DATE,
            'check_out': None, 'mode': 'office', 'status': 'present',
            'timeline': [],
        }
        checked_out_record = dict(attendance_record, check_out=WORK_TIME)
        db.attendance_logs.find_one.side_effect = [attendance_record, checked_out_record]
        db.sprint_weekly_plans.find.return_value = (
            [{'tenant_id': tenant, 'employee_id': 'isolated-employee-id',
              'activities': [{'planned_date': WORK_DATE, 'status': 'planned', 'activity_id': 'A'}]}]
            if planned else []
        )
        employee = {'_id': 'isolated-employee-id', 'tenant_id': tenant}

        with APP.test_request_context('/check-out', method='POST', json={'mode': 'office'}):
            g.tenant_id = tenant
            g.current_user = {'_id': 'isolated-user-id', 'tenant_id': tenant, 'role': 'employee'}
            with ExitStack() as stack:
                stack.enter_context(patch.object(attendance, 'get_db', return_value=db))
                stack.enter_context(patch.object(attendance, 'emp', return_value=employee))
                stack.enter_context(patch.object(attendance, 'offline_attendance_context', return_value={
                    'attendance_time': WORK_TIME, 'server_received_at': WORK_TIME,
                    'created_offline': False, 'offline_marked_at': None,
                    'client_attendance_id': ''
                }))
                stack.enter_context(patch.object(attendance, 'extract_location', return_value={'accuracy': 10}))
                stack.enter_context(patch.object(attendance, 'validate_attendance_location', return_value=(True, None)))
                stack.enter_context(patch.object(attendance, 'holiday_info_for_employee', return_value={'is_holiday': False}))
                stack.enter_context(patch.object(attendance, 'attendance_schedule_for_tenant', return_value={}))
                stack.enter_context(patch.object(attendance, 'attendance_schedule_time_objects', return_value={'check_out': time(18, 0)}))
                stack.enter_context(patch.object(attendance, 'attendance_reason_settings_for_tenant', return_value={}))
                stack.enter_context(patch.object(attendance, 'resolve_attendance_reason', return_value=({
                    'value': '', 'code': '', 'label': '', 'detail': ''
                }, '')))
                stack.enter_context(patch.object(attendance, 'audit'))
                stack.enter_context(patch('app.services.sprint_feature_settings.sprint_planning_enabled', return_value=enabled))
                readiness = stack.enter_context(patch('app.services.sprint_planning_service.checkout_readiness', return_value={
                    'ready': ready, 'problems': [{'activity_id': 'A', 'message': 'Report required'}]
                }))
                result = raw_handler(attendance.check_out)()
                status = http_status(result)
                payload = result[0].get_json() if isinstance(result, tuple) else result.get_json()
                return status, payload, db, readiness

    def test_sprint_off_normal_checkout_never_loads_sprint_plans(self):
        status, payload, db, readiness = self._checkout('rbpvt', False, planned=True, ready=False)
        self.assertEqual(status, 200)
        self.assertEqual(payload['message'], 'Check-out successful')
        db.sprint_weekly_plans.find.assert_not_called()
        readiness.assert_not_called()
        db.attendance_logs.update_one.assert_called_once()
        print('PASS - Sprint OFF: normal checkout succeeds, no Sprint query')

    def test_sprint_on_pending_report_blocks_without_attendance_write(self):
        status, payload, db, readiness = self._checkout('sds', True, planned=True, ready=False)
        self.assertEqual(status, 409)
        self.assertEqual(payload['code'], 'DAILY_WORK_REPORT_REQUIRED')
        readiness.assert_called_once()
        db.attendance_logs.update_one.assert_not_called()
        print('PASS - Sprint ON: missing report returns 409 without attendance write')

    def test_sprint_on_ready_report_allows_checkout(self):
        status, payload, db, readiness = self._checkout('sds', True, planned=True, ready=True)
        self.assertEqual(status, 200)
        self.assertEqual(payload['message'], 'Check-out successful')
        readiness.assert_called_once()
        db.attendance_logs.update_one.assert_called_once()
        print('PASS - Sprint ON: ready report permits normal checkout')

    def test_cross_tenant_sprint_list_filters_documents(self):
        collection = StrictPlanCollection([
            {'_id': 'sds-plan', 'tenant_id': 'sds', 'employee_id': 'emp-1', 'is_deleted': False},
            {'_id': 'rbpvt-plan', 'tenant_id': 'rbpvt', 'employee_id': 'emp-1', 'is_deleted': False},
            {'_id': 'deleted-plan', 'tenant_id': 'sds', 'employee_id': 'emp-1', 'is_deleted': True},
        ])
        db = MagicMock()
        db.__getitem__.return_value = collection
        with APP.test_request_context('/api/v1/sprint-planning/weekly?employee_id=emp-1'):
            g.current_user = {'_id': 'test-user', 'tenant_id': 'sds', 'role': 'employee'}
            g.tenant_id = 'sds'
            with patch.object(sprint, 'get_db', return_value=db), patch.object(sprint, '_can_read', return_value=True):
                result = raw_handler(sprint.list_plans)('weekly')
        self.assertEqual(http_status(result), 200)
        payload = result[0].get_json() if isinstance(result, tuple) else result.get_json()
        self.assertEqual([x['_id'] for x in payload['items']], ['sds-plan'])
        self.assertEqual(collection.query_history[-1]['tenant_id'], 'sds')
        print('PASS - Sprint list endpoint excludes other tenant and deleted records')

    def test_cross_tenant_sprint_list_denies_unapproved_employee_access(self):
        db = MagicMock()
        with APP.test_request_context('/api/v1/sprint-planning/weekly?employee_id=other-employee'):
            g.current_user = {'_id': 'test-user', 'tenant_id': 'sds', 'role': 'employee'}
            g.tenant_id = 'sds'
            with patch.object(sprint, 'get_db', return_value=db), patch.object(sprint, '_can_read', return_value=False):
                result = raw_handler(sprint.list_plans)('weekly')
        self.assertEqual(http_status(result), 403)
        db.__getitem__.assert_not_called()
        print('PASS - Sprint list endpoint denies unauthorized employee target')


if __name__ == '__main__':
    unittest.main(verbosity=0, exit=True)
