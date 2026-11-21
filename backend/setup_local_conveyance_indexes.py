"""Create the LC indexes idempotently. Requires a configured local MongoDB.

Usage: cd backend; python setup_local_conveyance_indexes.py --apply
Never modifies application records or drops existing indexes.
"""
import argparse
import os
from urllib.parse import urlsplit


def ensure_indexes(db):
    db.field_visits.create_index([("tenant_id", 1), ("employee_ref_id", 1), ("status", 1)])
    db.field_visits.create_index([("tenant_id", 1), ("scheduled_date", 1), ("travel.mode", 1)])
    db.local_conveyance_bills.create_index([("tenant_id", 1), ("reference", 1)], unique=True)
    # Database-level multikey uniqueness prevents a visit belonging to two bills.
    db.local_conveyance_bills.create_index([("tenant_id", 1), ("visit_ids", 1)], unique=True)
    db.local_conveyance_bills.create_index([("tenant_id", 1), ("employee_ref_id", 1),
                                             ("year", 1), ("month", 1)])
    # Legacy (pre-workflow) bills have no claim_key; only new monthly claims
    # participate in this unique partial index. No existing rows are changed.
    db.local_conveyance_bills.create_index(
        [("tenant_id", 1), ("claim_key", 1)], unique=True,
        partialFilterExpression={"claim_key": {"$type": "string"}})
    db.local_conveyance_bills.create_index(
        [("tenant_id", 1), ("approval.employee_ref_id", 1), ("status", 1)])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="Create indexes")
    p.add_argument("--allow-remote", action="store_true", help="Explicitly permit a remote MongoDB")
    args = p.parse_args()
    if not args.apply:
        print("DRY RUN: pass --apply to create indexes on the local MongoDB")
        return
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
    uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/sds_hrms_full")
    parsed = urlsplit(uri)
    hosts = (parsed.netloc.rsplit("@", 1)[-1]).split(",")
    if not args.allow_remote and (parsed.scheme != "mongodb" or any(
        host.split(":")[0].lower() not in {"localhost", "127.0.0.1", "[::1]"}
        for host in hosts)):
        raise SystemExit("SAFETY: Refusing remote MongoDB. Use a reviewed --allow-remote operation separately.")
    with MongoClient(uri, serverSelectionTimeoutMS=5000) as client:
        client.admin.command("ping")
        db = client.get_default_database()
        if db is None:
            raise SystemExit("No database name specified in MONGO_URI")
        ensure_indexes(db)
    print("Local Conveyance indexes ensured; no application records modified")


if __name__ == "__main__":
    main()
