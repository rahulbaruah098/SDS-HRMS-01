"""Periodic reconciliation, separate from check-in/checkout and approval latency."""
import os
from datetime import timedelta
from threading import Thread, Event
from flask import current_app
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from app.extensions import get_db
from . import attendance_compliance as ac


def run_once(db, tenant=None, period=None):
    tenants = [tenant] if tenant else [r['tenant_id'] for r in db.attendance_compliance_settings.find({}, {'tenant_id': 1})]
    count = 0
    for tid in tenants:
        # Current disabled tenants retain history; no new points are allocated.
        if not ac.policy(db, tid)['enabled'] and not db.employee_compliance_ledgers.find_one({'tenant_id': tid}, {'_id': 1}):
            continue
        periods = [period] if period else [str(ac.local_now().date())[:7], str(ac.local_now().date().replace(day=1) - timedelta(days=1))[:7]]
        for employee in db.employees.find({'tenant_id': tid, 'is_deleted': {'$ne': True}}):
            for selected in periods:
                ac.process_employee(db, tid, employee, selected)
                count += 1
    return count


def start_worker(app):
    if app.config.get('TESTING') or os.environ.get('YOURCOMATE_TEST_ISOLATION') == '1' or os.environ.get('ATTENDANCE_COMPLIANCE_WORKER', '1') == '0':
        return
    if app.debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return
    if app.extensions.get('attendance_compliance_worker'):
        return
    stopped = Event()
    def loop():
        # Unique events + CAS allow multiple deployment workers without double charges.
        while not stopped.wait(300):
            with app.app_context():
                try:
                    run_once(get_db())
                except Exception:
                    app.logger.exception('Attendance compliance reconciliation failed; next pass retries safely')
    app.extensions['attendance_compliance_worker'] = stopped
    Thread(target=loop, name='attendance-compliance', daemon=True).start()
