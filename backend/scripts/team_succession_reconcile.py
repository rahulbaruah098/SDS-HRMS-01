"""Explicit metadata reconciliation. Defaults to dry-run; does not rewrite approvals."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tenant', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--confirm-tenant')
    args = parser.parse_args()
    if args.apply and args.confirm_tenant != args.tenant:
        parser.error('--apply requires --confirm-tenant matching --tenant')
    # Do not create the Flask application: its startup index migrations are unrelated.
    from flask import Flask
    from pymongo import MongoClient
    from app.config import Config
    from app.services.team_responsibility import ensure_indexes, reconcile
    app = Flask(__name__); app.config.from_object(Config)
    with MongoClient(app.config['MONGO_URI'], serverSelectionTimeoutMS=10000) as client:
        db = client.get_default_database()
        if not db.tenants.find_one({'tenant_id': args.tenant}):
            parser.error('Tenant not found in the configured database')
        with app.app_context():
            if args.apply: ensure_indexes(db)
            rows = reconcile(db, args.tenant, dry_run=not args.apply, actor='authorized-reconciliation')
            print(json.dumps({'dry_run': not args.apply, 'tenant': args.tenant, 'teams': rows}, default=str, indent=2))


if __name__ == '__main__':
    main()
