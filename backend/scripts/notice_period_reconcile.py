"""CLI: dry-run by default; requires both --apply and NOTICE_PERIOD_ENABLED=1 to write.
Run from backend: python scripts/notice_period_reconcile.py --tenant sds
"""
import argparse
import os
from uuid import uuid4
from pymongo.errors import DuplicateKeyError
from datetime import datetime, timezone
from bson import ObjectId
from app import create_app
from app.extensions import get_db
from app.services.notice_period_service import local_today, terminal_update


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tenant', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    tenant = args.tenant.strip()
    if not tenant:
        parser.error('--tenant is required')

    app = create_app()
    with app.app_context():
        db = get_db()
        today = local_today().isoformat()
        base = {
            'tenant_id': tenant,
            'last_working_day': {'$lt': today, '$type': 'string'},
            'is_deleted': {'$ne': True},
            '$or': [
                {'notice_status': {'$in': ['scheduled', 'serving']},
                 'is_alumni': {'$ne': True}},
                {'notice_status': 'completed',
                 'notice_completed_at': {'$exists': True}},
            ],
        }
        rows = list(db.employees.find(base))
        print('Tenant:', tenant, 'Due/retry candidates:', len(rows),
              'Today:', today, 'Apply:', args.apply)
        if not args.apply:
            print('DRY RUN. No writes performed.')
            return
        if os.getenv('NOTICE_PERIOD_ENABLED') != '1':
            raise SystemExit('Refusing to apply: NOTICE_PERIOD_ENABLED=1 required')

        # Fail closed until a unique event key exists. Without it concurrent
        # upserts could create duplicate transition audit records.
        event_key = [('tenant_id', 1), ('employee_id', 1), ('event', 1)]
        indexes = list(db.notice_period_events.list_indexes())
        if not any(
            bool(index.get('unique'))
            and list(index.get('key', {}).items()) == event_key
            for index in indexes
        ):
            raise SystemExit(
                'Refusing to apply: unique notice-period event index missing. '
                'Complete the separate audited index setup before activation.'
            )

        # _id is uniquely indexed in every MongoDB collection. A tenant-wide
        # persistent claim prevents simultaneous workers on different hosts.
        # Deliberately NO automatic lock stealing: if a worker dies, an
        # operator must investigate and release the stale lock manually.
        owner = uuid4().hex
        lock_key = 'notice_period_reconcile:' + tenant
        try:
            db.notice_period_reconcile_locks.insert_one({
                '_id': lock_key,
                'owner': owner,
                'tenant_id': tenant,
                'acquired_at': datetime.now(timezone.utc),
            })
        except DuplicateKeyError:
            raise SystemExit(
                'Refusing to apply: another reconciliation worker holds '
                'the tenant lock (or a stale lock needs review).'
            )
        try:
            from app.routes.crud import (
                deactivate_employee_login_user,
                deactivate_employee_celebrations,
                find_employee_user,
            )
            from flask import g
            g.current_user = {
                '_id': 'notice-period-system', 'tenant_id': tenant,
                'name': 'Notice Period Scheduler', 'roles': ['admin'],
            }
            g.tenant_id = tenant
            failures = 0
            transitioned = 0
            retried = 0
            for row in rows:
                employee_id = row['_id']
                event_filter = {
                    'tenant_id': tenant,
                    'employee_id': str(employee_id),
                    'event': 'automatic_alumni_transition',
                }
                try:
                    # Re-read to avoid processing an exit cancelled since the scan.
                    employee = db.employees.find_one({
                        '_id': employee_id,
                        'tenant_id': tenant,
                        'is_deleted': {'$ne': True},
                    })
                    if not employee or employee.get('notice_status') not in (
                        'scheduled', 'serving', 'completed',
                    ):
                        continue
                    if employee.get('last_working_day') != row.get('last_working_day'):
                        continue
                    if employee.get('notice_status') == 'completed':
                        if not employee.get('notice_completed_at'):
                            continue
                    elif employee.get('is_alumni') is True:
                        continue
                    if db.notice_period_events.find_one(event_filter, {'_id': 1}):
                        continue

                    user = find_employee_user(db, employee)
                    if not user or str(user.get('tenant_id')) != tenant:
                        raise RuntimeError('Linked tenant user not found')
                    if employee.get('user_id') and str(user['_id']) != str(employee['user_id']):
                        raise RuntimeError('Employee-user linkage mismatch')

                    # First revoke access. On failure, notice remains due and is retried.
                    deactivate_employee_login_user(db, employee)
                    now = datetime.now(timezone.utc)
                    user_id = str(user['_id'])
                    db.auth_sessions.update_many(
                        {'user_id': user_id, 'is_revoked': {'$ne': True}},
                        {'$set': {'is_revoked': True, 'revoked_at': now,
                                  'updated_at': now}},
                    )
                    account = db.users.find_one({'_id': user['_id'], 'tenant_id': tenant})
                    if not account or account.get('is_active') is not False:
                        raise RuntimeError('User deactivation not verified')
                    if str(account.get('status') or '').lower() != 'inactive':
                        raise RuntimeError('User status not inactive')
                    remaining = db.auth_sessions.count_documents({
                        'user_id': user_id, 'is_revoked': {'$ne': True},
                    })
                    if remaining:
                        raise RuntimeError('Unrevoked login sessions remain')

                    if employee['notice_status'] != 'completed':
                        exact = {
                            '_id': employee_id, 'tenant_id': tenant,
                            'notice_status': employee['notice_status'],
                            'last_working_day': employee['last_working_day'],
                            'is_alumni': {'$ne': True},
                        }
                        final = terminal_update(now)
                        final['last_working_date'] = employee['last_working_day']
                        result = db.employees.update_one(exact, {'$set': final})
                        if result.modified_count != 1:
                            raise RuntimeError('Employee state changed during finalization')
                        transitioned += 1
                    else:
                        retried += 1

                    # Audit event occurs last; completed records without an event
                    # remain candidates on the next run if cleanup/audit fails.
                    updated = db.employees.find_one({
                        '_id': employee_id, 'tenant_id': tenant,
                    })
                    if not updated:
                        raise RuntimeError('Finalized employee not found')
                    deactivate_employee_celebrations(db, updated)
                    db.notice_period_events.update_one(
                        event_filter,
                        {'$setOnInsert': {
                            **event_filter, 'at': datetime.now(timezone.utc),
                            'actor_user_id': 'notice-period-system',
                        }},
                        upsert=True,
                    )
                except Exception as exc:
                    failures += 1
                    print('FAILED employee transition:', type(exc).__name__, str(exc))
            print('Transitioned:', transitioned, 'Retried:', retried,
                  'Failed:', failures)
            if failures:
                raise SystemExit(1)
        finally:
            # Release only the claim owned by this process. A crashed process
            # leaves its lock for explicit inspection instead of unsafe steal.
            db.notice_period_reconcile_locks.delete_one({
                '_id': lock_key, 'owner': owner,
            })

if __name__ == '__main__':
    run()
