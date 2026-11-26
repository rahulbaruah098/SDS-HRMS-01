"""Explicit database target; dry-run by default. Never reads .env or starts Flask."""
import argparse
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['indexes', 'process'])
    parser.add_argument('--uri-env', default='YOURCOMATE_MIGRATION_URI', help='Name of environment variable holding the Mongo URI')
    parser.add_argument('--database', required=True)
    parser.add_argument('--tenant')
    parser.add_argument('--period')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--confirm-database')
    args = parser.parse_args()
    if not args.apply:
        print(json.dumps({'dry_run': True, 'operation': args.operation, 'database': args.database,
            'tenant': args.tenant, 'period': args.period, 'changes': 'Add four tenant/employee scope indexes' if args.operation == 'indexes' else 'Reconcile configured compliance events; no payroll mutation'}))
        return 0
    if args.confirm_database != args.database:
        parser.error('--confirm-database must exactly match --database')
    if args.operation == 'process' and (not args.tenant or not args.period):
        parser.error('Explicit --tenant and --period are required for processing')
    uri = os.environ.get(args.uri_env)
    if not uri:
        parser.error('Set the named URI environment variable; credentials are never printed')
    from pymongo import MongoClient
    from app.services.attendance_compliance import ensure_indexes
    client = MongoClient(uri, serverSelectionTimeoutMS=10000)
    try:
        db = client[args.database]
        if args.operation == 'indexes':
            ensure_indexes(db)
            print('Additive compliance indexes created. No historical record was changed.')
        else:
            # Minimal context for existing deferred notifications; no application factory.
            from flask import Flask
            from app.services.attendance_compliance_worker import run_once
            app = Flask(__name__)
            with app.app_context():
                print(json.dumps({'processed': run_once(db, args.tenant, args.period)}))
    finally:
        client.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
