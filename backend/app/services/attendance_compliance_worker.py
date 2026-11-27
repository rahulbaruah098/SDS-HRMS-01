"""Periodic reconciliation, separate from check-in/checkout and approval latency."""
import logging
import os
from datetime import timedelta
from threading import Thread, Event, Lock
from app.extensions import get_db
from . import attendance_compliance as ac


logger = logging.getLogger(__name__)


def run_once(db, tenant=None, period=None):
    tenants = [tenant] if tenant else [r['tenant_id'] for r in db.attendance_compliance_settings.find({}, {'tenant_id': 1})]
    count, failures = 0, 0
    for tid in tenants:
        try:
            # Current disabled tenants retain history; no new points are allocated.
            if not ac.policy(db, tid)['enabled'] and not db.employee_compliance_ledgers.find_one({'tenant_id': tid}, {'_id': 1}):
                continue
            today = ac.local_now().date()
            periods = [period] if period else [str(today)[:7], str(today.replace(day=1) - timedelta(days=1))[:7]]
            for employee in db.employees.find({'tenant_id': tid, 'is_deleted': {'$ne': True}}):
                for selected in periods:
                    try:
                        ac.process_employee(db, tid, employee, selected)
                        count += 1
                    except Exception:
                        failures += 1
                        logger.exception('Compliance reconciliation failed tenant=%s employee_id=%s period=%s', tid, employee['_id'], selected)
        except Exception:
            failures += 1
            logger.exception('Compliance tenant reconciliation failed tenant=%s', tid)
    if failures:
        # Preserve nonzero failure semantics for explicit CLI invocations, but
        # finish the remaining employees/tenants before reporting the failure.
        raise RuntimeError(f'Compliance reconciliation: {count} completed, {failures} failed; see logs')
    return count


def _disabled(app):
    return (app.config.get('TESTING') or os.environ.get('YOURCOMATE_TEST_ISOLATION') == '1'
            or os.environ.get('ATTENDANCE_COMPLIANCE_WORKER', '1') == '0')


def wake_worker(app):
    state = app.extensions.get('attendance_compliance_worker')
    if state and state['pid'] == os.getpid() and not _disabled(app):
        state['wake'].set()


def start_worker(app):
    """Register startup in the serving process, not a Gunicorn preload master.

    The first real request starts reconciliation; no attendance work is done
    synchronously in its request handler. Each worker process starts at most
    one live thread, and ledger CAS/event IDs protect concurrent processes.
    """
    if _disabled(app) or app.extensions.get('attendance_compliance_worker_registered'):
        return
    app.extensions['attendance_compliance_worker_registered'] = True
    startup_lock = Lock()

    @app.before_request
    def ensure_worker_started():
        if _disabled(app):
            return
        pid = os.getpid()
        with startup_lock:
            state = app.extensions.get('attendance_compliance_worker')
            if state and state['pid'] == pid and state['thread'].is_alive():
                return
            stopped, wake = Event(), Event()

            def loop():
                app.logger.info('Attendance compliance worker started pid=%s', pid)
                while not stopped.is_set():
                    wake.clear()
                    try:
                        with app.app_context():
                            count = run_once(get_db())
                        app.logger.info('Attendance compliance reconciliation completed: %s', count)
                    except Exception:
                        app.logger.exception('Attendance compliance reconciliation failed; next pass retries safely')
                    wake.wait(300)

            thread = Thread(target=loop, name='attendance-compliance', daemon=True)
            app.extensions['attendance_compliance_worker'] = {'pid': pid, 'stop': stopped, 'wake': wake, 'thread': thread}
            thread.start()
