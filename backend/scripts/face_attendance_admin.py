"""Model validation/repair and tenant-scoped retention cleanup."""

import argparse
import base64
import hashlib
import os
import shutil
import sys
import tempfile
import urllib.request
from datetime import timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from bson import ObjectId
from flask import Flask
from pymongo import MongoClient
from app.config import Config
from app.services import face_attendance as service
from app.services.face_vision import MODEL_DIR, MODELS, Vision
from app.utils.auth import employee_login_is_alumni

REVISION = "48b10fa505aeb51fbd127fc60a5c660040e823b7"
ORIGIN = (
    "https://media.githubusercontent.com/media/opencv/opencv_zoo/"
    + REVISION
    + "/models/"
)


def models(repair=False):
    directory = Path(os.getenv("FACE_ATTENDANCE_MODEL_DIR", str(MODEL_DIR)))
    for filename, expected in MODELS.items():
        target = directory / filename
        if repair and (
            not target.exists()
            or hashlib.sha256(target.read_bytes()).hexdigest() != expected
        ):
            directory.mkdir(exist_ok=True, parents=True)
            with tempfile.NamedTemporaryFile(dir=directory, delete=False) as t:
                tmp = Path(t.name)
            try:
                with (
                    urllib.request.urlopen(
                        ORIGIN + filename.rsplit("_", 1)[0] + "/" + filename, timeout=60
                    ) as response,
                    tmp.open("wb") as out,
                ):
                    shutil.copyfileobj(response, out)
                if hashlib.sha256(tmp.read_bytes()).hexdigest() != expected:
                    raise RuntimeError("Downloaded model checksum mismatch")
                os.replace(tmp, target)
            finally:
                tmp.unlink(missing_ok=True)
    observation = Vision(directory).observe(
        base64.b64encode((BACKEND / "tests/face_fixture.jpg").read_bytes()).decode()
    )
    if observation.embedding.shape != (128,):
        raise RuntimeError("Model inference failed")
    print(
        "Both pinned hashes, YuNet detection, alignment and 128-component SFace inference passed."
    )


def prune(db, tenant, apply=False):
    instant = service.now()
    expired = {"tenant_id": tenant, "expires": {"$lte": instant}}
    n_expired = db.face_vectors.count_documents(expired)
    if apply:
        db.face_vectors.delete_many(expired)
    removed = orphans = 0
    for row in db.face_profiles.find({"tenant_id": tenant}, {"proofs": 0}):
        subject = {"tenant_id": tenant, "employee_id": row["employee_id"]}
        employee = db.employees.find_one(
            {
                "tenant_id": tenant,
                "_id": ObjectId(row["employee_id"]),
                "is_deleted": {"$ne": True},
            }
        )
        if (
            employee
            and employee.get("is_active") is not False
            and not employee_login_is_alumni(employee)
        ):
            continue
        removed += 1
        if apply:
            event = db.face_audit.insert_one(
                {
                    **subject,
                    "actor_id": "retention-job",
                    "action": "offboarding_deletion",
                    "outcome": "requested",
                    "at": instant,
                    "expires": instant + timedelta(days=service.AUDIT_DAYS),
                }
            ).inserted_id
            deleted = db.face_profiles.delete_one(
                {**subject, "revision": row["revision"]}
            )
            if deleted.deleted_count:
                db.face_vectors.delete_one({**subject, "_id": row.get("template_id")})
                db.face_challenges.delete_many({**subject, "revision": row["revision"]})
            db.face_audit.update_one(
                {**subject, "_id": event},
                {
                    "$set": {
                        "outcome": "applied" if deleted.deleted_count else "conflict"
                    }
                },
            )
    for vec in db.face_vectors.find(
        {
            "tenant_id": tenant,
            "created_at": {"$lt": instant - timedelta(minutes=10)},
            "expires": {"$gt": instant},
        },
        {"employee_id": 1},
    ):
        subject = {"tenant_id": tenant, "employee_id": vec["employee_id"]}
        if not db.face_profiles.find_one(
            {**subject, "template_id": vec["_id"]}, {"_id": 1}
        ):
            orphans += 1
            if apply:
                db.face_vectors.delete_one({**subject, "_id": vec["_id"]})
    print(
        f"{'Applied' if apply else 'Preview'} for {tenant}: {n_expired} expired, {removed} departed, {orphans} orphaned"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("models").add_argument("--repair", action="store_true")
    p = sub.add_parser("prune")
    p.add_argument("--tenant", required=True)
    p.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.command == "models":
        models(args.repair)
    else:
        app = Flask(__name__)
        app.config.from_object(Config)
        with app.app_context(), MongoClient(app.config["MONGO_URI"]) as client:
            prune(client.get_default_database(), args.tenant, args.apply)
