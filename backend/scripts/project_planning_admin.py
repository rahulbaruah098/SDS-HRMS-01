"""Explicit, additive setup. Run from backend with its existing virtual environment.

No records are inferred from a job title; no legacy rows are assigned to tenants.
Indexes need --apply. Granting MD visibility needs exact tenant + user IDs and
--apply. Database credentials come only from the existing backend configuration.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(BACKEND / ".env", override=False)
from app.config import Config
from app.services.project_planning import INDEX_SPECS, ensure_indexes


def grant_md(db, tenant_id, user_id, apply=False):
    if not tenant_id or not ObjectId.is_valid(user_id):
        raise ValueError("An exact tenant ID and valid user ObjectId are required")
    query = {"_id": ObjectId(user_id), "tenant_id": tenant_id, "is_deleted": {"$ne": True}}
    user = db.users.find_one(query)
    if not user or user.get("is_active") is False:
        raise ValueError("No active user matches both IDs; nothing changed")
    original = user.get("roles", [])
    if not isinstance(original, (list, str)):
        raise ValueError("Unexpected roles format; repair the account separately")
    roles = [str(x).strip() for x in original] if isinstance(original, list) else original.split(",")
    roles = sorted({x.strip() for x in roles if x.strip()} | {"managing_director"})
    result = {"tenant_id": tenant_id, "user_id": user_id, "before_roles": original,
              "after_roles": roles, "applied": False}
    if apply and original != roles:
        query["roles"] = original if "roles" in user else {"$exists": False}
        changed = db.users.update_one(query, {"$set": {"roles": roles}})
        if changed.matched_count != 1:
            raise ValueError("Account changed concurrently; inspect it before retrying")
        db.audit_logs.insert_one({"tenant_id": tenant_id, "actor_id": "local_administrator",
                                  "action": "grant_managing_director", "entity": "users",
                                  "entity_id": user_id, "meta": {"before_roles": original, "after_roles": roles},
                                  "created_at": datetime.now(timezone.utc)})
        result["applied"] = True
    elif apply:
        result["applied"] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    indexes = sub.add_parser("indexes", help="Show or create six additive planning indexes")
    indexes.add_argument("--apply", action="store_true")
    md = sub.add_parser("grant-md", help="Grant tenant-wide performance visibility to one existing account")
    md.add_argument("--tenant-id", required=True)
    md.add_argument("--user-id", required=True)
    md.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.command == "indexes":
        print(json.dumps([{"collection": c, "keys": k, **o} for c, k, o in INDEX_SPECS], indent=2))
        if not args.apply:
            print("Preview only. Verify backend .env points to the intended local database, then add --apply.")
            return
    # Do not log the connection URI: it may contain credentials.
    with MongoClient(Config.MONGO_URI, serverSelectionTimeoutMS=5000) as client:
        db = client.get_default_database()
        if args.command == "indexes":
            ensure_indexes(db)
            print("Planning indexes created or already present. No records were rewritten.")
        else:
            print(json.dumps(grant_md(db, args.tenant_id, args.user_id, args.apply), indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Avoid printing a connection exception containing a URI/password.
        print(str(exc) if isinstance(exc, ValueError) else f"Setup failed ({type(exc).__name__}); inspect database access/index conflicts locally. No data migration is performed.", file=sys.stderr)
        sys.exit(1)
