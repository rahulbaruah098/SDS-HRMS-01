"""YourComate notice-period reconciler, one safe pass for every tenant.
Uses unchanged audited worker, setting its execution permission only within a
short-lived per-tenant child process. No permanent .env changes.
"""
import argparse, os, subprocess, sys
from pathlib import Path


def tenants_from_db(db):
    # Only employees on scheduled/serving notice, or interrupted completed exits.
    query = {'tenant_id': {'$type': 'string'}, 'is_deleted': {'$ne': True},
             '$or': [{'notice_status': {'$in': ['scheduled', 'serving']},
                      'is_alumni': {'$ne': True}},
                     {'notice_status': 'completed',
                      'notice_completed_at': {'$exists': True}}]}
    return sorted(x for x in db.employees.distinct('tenant_id', query) if x and isinstance(x, str))


def required_event_index(db):
    keys=[('tenant_id',1),('employee_id',1),('event',1)]
    return any(bool(i.get('unique')) and list(i.get('key',{}).items())==keys
               for i in db.notice_period_events.list_indexes())


def run():
    p=argparse.ArgumentParser()
    p.add_argument('--execute',action='store_true')
    p.add_argument('--check',action='store_true')
    p.add_argument('--setup-index',action='store_true')
    a=p.parse_args()
    if sum([a.execute,a.check,a.setup_index])!=1: p.error('Exactly one mode required')
    backend=Path(__file__).resolve().parent
    sys.path.insert(0,str(backend))
    from app import create_app
    from app.extensions import get_db
    app=create_app()
    with app.app_context():
        db=get_db()
        db.command('ping')
        expected=[('tenant_id',1),('employee_id',1),('event',1)]
        if a.setup_index and not required_event_index(db):
            # Unique-index creation is a deliberate, explicit activation step.
            db.notice_period_events.create_index(expected,unique=True,name='uniq_notice_event_tenant_employee_event')
        if not required_event_index(db):
            raise SystemExit('STOP: required unique notice audit event index absent')
        ts=tenants_from_db(db)
        print('NOTICE LIFECYCLE', 'EXECUTE' if a.execute else 'CHECK', 'tenant scopes:',len(ts),flush=True)
        failures=0
        for t in ts:
            if a.execute:
                env=dict(os.environ)
                env['NOTICE_PERIOD_ENABLED']='1'  # child process only
                action=['--tenant',t,'--apply']
            else:
                env=dict(os.environ)
                env.pop('NOTICE_PERIOD_ENABLED',None)
                action=['--tenant',t]
            command=[sys.executable,str(backend/'scripts'/'notice_period_reconcile.py'),*action]
            result=subprocess.run(command,cwd=str(backend),env=env,check=False)
            if result.returncode:
                failures+=1
                print('TENANT PROCESS FAILED; code:',result.returncode,flush=True)
        print('NOTICE LIFECYCLE completed. Failures:',failures,flush=True)
        if failures: raise SystemExit(1)
if __name__=='__main__':run()
