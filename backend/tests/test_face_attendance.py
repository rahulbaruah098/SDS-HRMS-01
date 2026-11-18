"""Private disposable DB tests for the actual YourComate JWT, attendance and ML routes."""

import base64
import io
import json
import os
import secrets
import shutil
import socket
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from bson import ObjectId
from flask import g
from PIL import Image
from pymongo import MongoClient

from app import create_app, extensions
from app.routes import attendance
from app.services import face_attendance as svc, ai_action_service as eve
from app.services.face_vision import (
    FaceError,
    MODEL_DIR,
    Observation,
    check_pose,
    decode_photo,
    engine,
    enroll,
)
from app.utils.auth import issue_access_token

API = "/api/v1/face-attendance/"
ATT = "/api/v1/attendance/"
GPS = {"latitude": 26.18, "longitude": 91.74, "accuracy": 10}
DAY = datetime(2026, 11, 17, 9, tzinfo=attendance.ATTENDANCE_LOCAL_TIMEZONE)
FIX = Path(__file__).parent


def picture(name="face_fixture.jpg"):
    return base64.b64encode((FIX / name).read_bytes()).decode()


def sample(yaw=0, fingerprint=0, other=False):
    vector = np.zeros(128, dtype="<f4")
    vector[int(other)] = 1
    return Observation(vector, yaw, (0.5, 0.5), 0.4, fingerprint.to_bytes(8, "big"))


class VisionTests(unittest.TestCase):
    def test_real_model_identity(self):
        model = engine(str(MODEL_DIR))
        a = model.observe(picture()).embedding
        self.assertEqual(a.shape, (128,))
        self.assertAlmostEqual(
            float(a @ model.observe(picture()).embedding), 1, places=5
        )
        self.assertLess(
            float(a @ model.observe(picture("face_other_fixture.jpg")).embedding), 0.50
        )

    def test_no_face_and_two_faces(self):
        im = cv2.imread(str(FIX / "face_fixture.jpg"))
        for image in (np.zeros_like(im), np.hstack((im, im))):
            with self.assertRaisesRegex(FaceError, "exactly one"):
                engine(str(MODEL_DIR)).observe(
                    base64.b64encode(cv2.imencode(".jpg", image)[1]).decode()
                )

    def test_image_limits(self):
        out = io.BytesIO()
        Image.new("L", (3200, 2800)).save(out, "PNG")
        for bad in (
            {},
            "!!!",
            "a" * 2_900_000,
            base64.b64encode(out.getvalue()).decode(),
        ):
            with self.assertRaises(FaceError):
                decode_photo(bad)

    def test_duplicate_and_mixed_people(self):
        with self.assertRaisesRegex(FaceError, "different photograph"):
            enroll([picture()] * 3, engine(str(MODEL_DIR)), 0.5)
        with self.assertRaisesRegex(FaceError, "same employee"):
            enroll(
                [picture(), picture("face_other_fixture.jpg"), picture()],
                engine(str(MODEL_DIR)),
                0.5,
            )

    def test_pose_sequence(self):
        base = {"x": 0.5, "y": 0.5, "size": 0.4, "yaw": 0}
        for direction in ("left", "right"):
            with self.assertRaises(FaceError):
                check_pose(sample(), direction, base)
        check_pose(sample(0.3), "left", base)
        check_pose(sample(-0.3), "right", base)
        with self.assertRaises(FaceError):
            check_pose(sample(0.3), "center", base)


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        binary = os.getenv("FACE_TEST_MONGOD") or shutil.which("mongod")
        if binary:
            temporary = tempfile.TemporaryDirectory(prefix="yc-face-mongodb-")
            cls.addClassCleanup(temporary.cleanup)
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            command = [
                binary,
                "--dbpath",
                temporary.name,
                "--bind_ip",
                "127.0.0.1",
                "--port",
                str(port),
                "--logpath",
                str(Path(temporary.name) / "mongodb.log"),
            ]
            if os.name != "nt":
                command.append("--nounixsocket")
            proc = subprocess.Popen(
                command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )

            def stop():
                proc.terminate()
                proc.wait(timeout=30)

            cls.addClassCleanup(stop)
            client = MongoClient("127.0.0.1", port, serverSelectionTimeoutMS=15000)
            cls.addClassCleanup(client.close)
            print("Isolated MongoDB", client.server_info()["version"])
        else:
            import mongomock

            client = mongomock.MongoClient()
            print("Isolated mongomock")
        cls.db = client["yc_face_test_" + secrets.token_hex(5)]
        cfg = {
            "FACE_ATTENDANCE_ENFORCE_TENANTS": "sds",
            "FACE_ATTENDANCE_PREPARE_TENANTS": "",
            "FACE_ATTENDANCE_KEY_ID": "test",
            "FACE_ATTENDANCE_KEYS": json.dumps(
                {"test": base64.b64encode(secrets.token_bytes(32)).decode()}
            ),
            "FACE_ATTENDANCE_MODEL_DIR": str(MODEL_DIR),
            "FACE_ATTENDANCE_RETENTION_DAYS": "180",
            "FACE_ATTENDANCE_MATCH_THRESHOLD": "0.50",
        }
        for p in (patch.dict(os.environ, cfg), patch.object(extensions, "db", cls.db)):
            p.start()
            cls.addClassCleanup(p.stop)
        with patch("app.init_db", return_value=cls.db):
            cls.app = create_app()
        cls.app.config.update(
            TESTING=True,
            JWT_SECRET_KEY=secrets.token_hex(32),
            SDS_TENANT_ID="sds",
            DEFAULT_TENANT_ID="sds",
            NOTICE_PERIOD_ENABLED=False,
        )

    def setUp(self):
        for name in self.db.list_collection_names():
            self.db[name].delete_many({})
        self.app.config.update(
            FACE_ATTENDANCE_ENFORCE_TENANTS="sds", FACE_ATTENDANCE_PREPARE_TENANTS=""
        )
        self.client = self.app.test_client()
        self.db.tenants.insert_one(
            {"tenant_id": "sds", "status": "active", "plan_type": "lifetime"}
        )
        self.employee, self.login = self.person("A")
        self.hr, self.hrlogin = self.person("HR", "hr_manager")
        self.foreign, _ = self.person("Foreign", tenant="other")
        self.sub = {"tenant_id": "sds", "employee_id": str(self.employee["_id"])}
        p = patch.object(attendance, "now_local", return_value=DAY)
        self.clock = p.start()
        self.addCleanup(p.stop)
        p = patch.object(attendance, "notify_attendance_stakeholders")
        self.notify = p.start()
        self.addCleanup(p.stop)

    def person(self, name, role="employee", tenant="sds", **fields):
        uid = ObjectId()
        e = {
            "_id": ObjectId(),
            "user_id": str(uid),
            "name": name,
            "email": name + "@example.invalid",
            "employee_id": "E-" + name,
            "tenant_id": tenant,
            "status": "Active",
            "is_deleted": False,
            **fields,
        }
        u = {
            "_id": uid,
            "tenant_id": tenant,
            "employee_ref_id": str(e["_id"]),
            "is_active": True,
            "roles": [role],
            "name": name,
            "email": e["email"],
        }
        self.db.employees.insert_one(e)
        self.db.users.insert_one(u)
        with self.app.app_context():
            return e, {"Authorization": "Bearer " + issue_access_token(u)}

    def call(self, path, data=None, login=None):
        headers = self.login if login is None else login
        return (
            self.client.get(API + path, headers=headers)
            if data is None
            else self.client.post(API + path, json=data, headers=headers)
        )

    def admin(self, path, data=None, login=None, target=None):
        return self.call(
            f"employees/{(target or self.employee)['_id']}/{path}",
            data,
            login or self.hrlogin,
        )

    def mark(self, action, data=None, login=None):
        return self.client.post(
            ATT + action, json={**GPS, **(data or {})}, headers=login or self.login
        )

    def accept(self):
        r = self.call(
            "consent",
            {"decision": "accept", "notice_version": svc.NOTICE, "revision": 0},
        )
        self.assertEqual(r.status_code, 200, r.json)

    def register(self):
        self.accept()
        with patch.object(
            engine(str(MODEL_DIR)),
            "observe",
            side_effect=[sample(fingerprint=n) for n in (0, 255, 65535)],
        ):
            r = self.admin("enroll", {"revision": 1, "photos": ["one", "two", "three"]})
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(r.json["record"]["status"], "Registered")

    def proof(self, action):
        if not self.db.face_profiles.find_one(self.sub):
            self.register()
        reply = self.call("challenge", {"action": action})
        self.assertEqual(reply.status_code, 200, reply.json)
        state = reply.json
        token = state["challenge"]
        for step in range(3):
            self.db.face_challenges.update_one(
                {"_id": svc.digest(token)},
                {"$set": {"next_at": svc.now() - timedelta(seconds=1)}},
            )
            with patch.object(
                engine(str(MODEL_DIR)),
                "observe",
                return_value=sample(
                    {"center": 0, "left": 0.3, "right": -0.3}[state["prompt"]]
                ),
            ):
                reply = self.call(
                    "frame", {"step": step, "challenge": token, "frame": "unit fixture"}
                )
            self.assertEqual(reply.status_code, 200, reply.json)
            state = reply.json
        return state["proof"]

    # PATCH 2026-11-18 - company-level activation and attendance regression.
    def face_settings(self, mode=None, revision=0, login=None, confirm=False):
        if mode is None:
            return self.client.get(API + "settings", headers=self.hrlogin if login is None else login)
        return self.client.patch(
            API + "settings", headers=self.hrlogin if login is None else login,
            json={"mode": mode, "revision": revision,
                  "confirm_enforcement": confirm},
        )

    def test_settings_roles_and_tenant_isolation(self):
        self.assertEqual(self.face_settings(login=self.login).status_code, 403)
        self.assertEqual(self.face_settings("off", login=self.login).status_code, 403)
        self.assertEqual(self.face_settings(login={}).status_code, 401)
        self.assertEqual(self.face_settings().status_code, 200)
        self.assertEqual(self.face_settings().json["mode"], "enforce")
        denied = self.face_settings("prepare", revision=0, login=self.login)
        self.assertEqual(denied.status_code, 403)
        saved = self.face_settings("off", revision=0)
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertEqual(saved.json["revision"], 1)
        with self.app.app_context():
            self.assertEqual(svc.mode("sds", self.db), "off")
            self.assertEqual(svc.mode("other", self.db), "off")
        self.assertEqual(self.db.system_settings.count_documents({"tenant_id": "other"}), 0)

    def test_pilot_preparation_then_enforcement_and_off(self):
        prep = self.face_settings("prepare", revision=0)
        self.assertEqual(prep.status_code, 200, prep.json)
        self.assertEqual(prep.json["mode"], "prepare")
        self.assertEqual(self.face_settings("enforce", revision=1, confirm=True).status_code, 409)
        self.register()
        ready = self.face_settings().json
        self.assertEqual(ready["readiness"]["registered"], 1)
        self.assertEqual(self.face_settings("enforce", revision=1).status_code, 400)
        active = self.face_settings("enforce", revision=1, confirm=True)
        self.assertEqual(active.status_code, 200, active.json)
        self.assertEqual(active.json["mode"], "enforce")
        denied = self.mark("check-in")
        self.assertEqual(denied.status_code, 428, denied.json)
        turned_off = self.face_settings("off", revision=2)
        self.assertEqual(turned_off.status_code, 200, turned_off.json)
        self.assertEqual(self.mark("check-in").status_code, 200)
        self.assertEqual(self.db.face_profiles.count_documents(self.sub), 1)

    def test_revision_validation_and_concurrent_updates(self):
        self.assertEqual(self.face_settings("invalid").status_code, 400)
        self.assertEqual(self.face_settings("off", revision=-1).status_code, 400)
        self.assertEqual(self.face_settings("off").status_code, 200)
        self.assertEqual(self.face_settings("prepare", revision=0).status_code, 409)
        self.assertEqual(self.face_settings("prepare", revision=1).status_code, 200)
        self.assertEqual(self.face_settings().json["mode"], "prepare")

    def test_missing_model_or_key_fails_closed_without_saving(self):
        with patch.object(svc, "keyring", side_effect=RuntimeError("test-only secret error")):
            reply = self.face_settings("prepare")
        self.assertEqual(reply.status_code, 503, reply.json)
        self.assertEqual(reply.json["code"], "FACE_SETUP")
        self.assertNotIn("secret error", str(reply.json))
        self.assertEqual(self.db.system_settings.count_documents({"setting_group": "face_attendance"}), 0)

    def test_auth_and_permissions(self):
        self.assertEqual(self.call("employees", login={}).status_code, 401)
        for path, data in (
            ("revoke", {}),
            ("enroll", {}),
            ("exception", {}),
            ("history", None),
        ):
            self.assertEqual(self.admin(path, data, login=self.login).status_code, 403)

    def test_hr_and_it_capabilities(self):
        for role in (
            "admin",
            "hr",
            "hr_admin",
            "hr_manager",
            "super_admin",
            "superadmin",
            "HR Manager",
        ):
            _, h = self.person(role, role)
            self.assertEqual(self.call("employees", login=h).status_code, 200)
        for name, fields, expected in (
            ("head", {"is_it_support_head": True}, 200),
            ("ITlead", {"department": "Technology", "is_team_leader": True}, 200),
            ("member", {"is_it_support_member": True}, 403),
            ("Audit", {"department": "Audit", "is_team_leader": True}, 403),
        ):
            _, h = self.person(name, **fields)
            self.assertEqual(self.call("employees", login=h).status_code, expected)

    def test_strict_tenant_scope_including_superadmin(self):
        _, platform = self.person("Platform", "super_admin")
        for h in (platform, self.hrlogin):
            self.assertNotIn(
                "Foreign", str(self.call("employees", login=h).json["roster"])
            )
            for path, data in (
                ("revoke", {}),
                ("enroll", {}),
                ("exception", {}),
                ("history", None),
            ):
                self.assertEqual(
                    self.admin(path, data, h, self.foreign).status_code, 404
                )
            self.assertEqual(
                self.call("employees?tenant_id=other", login=h).status_code, 403
            )
        self.assertEqual(self.call("consent", {"tenant_id": "other"}).status_code, 403)

    def test_search_paging(self):
        for i in range(30):
            self.person("Page" + str(i))
        self.person("PageRetired", employment_status="retired")
        first = self.call("employees?q=Page", login=self.hrlogin).json
        second = self.call(
            "employees?q=Page&after=" + first["next_after"], login=self.hrlogin
        ).json
        self.assertEqual(len(first["roster"]), 25)
        self.assertEqual(len({r["id"] for r in first["roster"] + second["roster"]}), 30)

    def test_consent_revision_and_count(self):
        self.assertEqual(
            self.admin("enroll", {"revision": 0, "photos": []}).json["code"],
            "FACE_CONSENT",
        )
        self.accept()
        self.assertEqual(self.admin("revoke", {"revision": 0}).status_code, 409)
        self.assertEqual(
            self.admin("enroll", {"revision": 1, "photos": []}).status_code, 422
        )

    def test_encryption_and_private_collections(self):
        self.register()
        v = self.db.face_vectors.find_one(self.sub)
        self.assertNotIn(sample().embedding.tobytes(), bytes(v["ciphertext"]))
        for path in ("face_profiles", "face_vectors", "face_audit", "face_challenges"):
            self.assertEqual(
                self.client.get("/api/v1/" + path, headers=self.hrlogin).status_code,
                404,
            )
        target = {**self.sub, "tenant_id": "other"}
        row = self.db.face_profiles.find_one(self.sub)
        self.db.face_vectors.update_one({"_id": v["_id"]}, {"$set": target})
        with self.app.app_context(), self.assertRaises(FaceError):
            svc.load_template(self.db, target, row)

    def test_retrain_invalidates_old_template_and_proof(self):
        token = self.proof("check-in")
        old = self.db.face_vectors.find_one(self.sub)["_id"]
        with patch.object(
            engine(str(MODEL_DIR)),
            "observe",
            side_effect=[sample(fingerprint=n) for n in (0, 255, 65535)],
        ):
            self.assertEqual(
                self.admin(
                    "enroll", {"revision": 2, "photos": ["a", "b", "c"]}
                ).status_code,
                200,
            )
        self.assertIsNone(self.db.face_vectors.find_one({"_id": old}))
        self.assertEqual(self.mark("check-in", {"face_proof": token}).status_code, 403)

    def test_expiry_revoke_and_withdraw(self):
        self.register()
        self.db.face_profiles.update_one(
            self.sub, {"$set": {"valid_until": svc.now() - timedelta(days=1)}}
        )
        self.assertEqual(self.call("access").json["mine"]["status"], "Needs Retraining")
        self.assertEqual(
            self.call("challenge", {"action": "check-in"}).json["code"],
            "FACE_ENROLLMENT",
        )
        self.assertEqual(self.admin("revoke", {"revision": 2}).status_code, 200)
        self.assertEqual(self.db.face_vectors.count_documents({}), 0)
        self.app.config["FACE_ATTENDANCE_ENFORCE_TENANTS"] = ""
        self.assertFalse(
            self.call("consent", {"revision": 3, "decision": "withdraw"}).json["mine"][
                "consented"
            ]
        )

    def test_real_enrollment_and_first_frame(self):
        self.accept()
        photos = [
            picture(n)
            for n in (
                "face_fixture.jpg",
                "face_enrollment_view2.jpg",
                "face_enrollment_view3.jpg",
            )
        ]
        r = self.admin("enroll", {"revision": 1, "photos": photos})
        self.assertEqual(r.status_code, 200, r.json)
        token = self.call("challenge", {"action": "check-in"}).json["challenge"]
        first = self.call("frame", {"challenge": token, "step": 0, "frame": photos[0]})
        self.assertIn(first.json["prompt"], ("left", "right"))
        self.assertNotIn("proof", first.json)
        self.assertEqual(self.call("cancel", {"challenge": token}).status_code, 204)

    def test_wrong_action(self):
        token = self.proof("check-out")
        self.assertEqual(
            self.mark("check-in", {"face_proof": token}).json["code"],
            "FACE_PROOF_INVALID",
        )
        self.assertEqual(self.db.attendance_logs.count_documents({}), 0)

    def test_expiry_and_identity_reassignment(self):
        self.register()
        token = self.call("challenge", {"action": "check-in"}).json["challenge"]
        self.db.face_challenges.update_one(
            {"_id": svc.digest(token)},
            {"$set": {"expires": svc.now() - timedelta(seconds=1)}},
        )
        self.assertEqual(
            self.call(
                "frame", {"step": 0, "challenge": token, "frame": ""}
            ).status_code,
            409,
        )
        self.db.employees.update_one(
            {"_id": self.employee["_id"]}, {"$set": {"user_id": str(ObjectId())}}
        )
        self.assertEqual(
            self.call("challenge", {"action": "check-in"}).json["code"], "FACE_IDENTITY"
        )

    def test_retention_scoped_and_preview(self):
        from scripts.face_attendance_admin import prune

        self.register()
        other = self.db.face_vectors.find_one(self.sub)
        other.update(_id=ObjectId(), tenant_id="other")
        self.db.face_vectors.insert_one(other)
        self.db.employees.update_one(
            {"_id": self.employee["_id"]}, {"$set": {"status": "Resigned"}}
        )
        with self.app.app_context():
            prune(self.db, "sds", False)
            self.assertEqual(self.db.face_vectors.count_documents(self.sub), 1)
            prune(self.db, "sds", True)
        self.assertEqual(self.db.face_vectors.count_documents(self.sub), 0)
        self.assertEqual(
            self.db.face_vectors.count_documents({"tenant_id": "other"}), 1
        )

    def test_wrong_person_and_timing(self):
        self.register()

        def start():
            return self.call("challenge", {"action": "check-in"}).json["challenge"]

        t = start()
        data = {"challenge": t, "frame": "fixture", "step": 0}
        with patch.object(
            engine(str(MODEL_DIR)), "observe", return_value=sample(other=True)
        ):
            self.assertEqual(self.call("frame", data).json["code"], "FACE_NO_MATCH")
            self.assertEqual(self.call("frame", data).json["code"], "FACE_CHALLENGE")
        data["challenge"] = start()
        with patch.object(engine(str(MODEL_DIR)), "observe", return_value=sample()):
            self.assertEqual(self.call("frame", data).json["step"], 1)
            self.assertEqual(self.call("frame", {**data, "step": 1}).status_code, 409)
        self.assertEqual(self.db.attendance_logs.count_documents({}), 0)

    def test_direct_and_offline_denials(self):
        for action in svc.ACTIONS:
            self.assertEqual(
                self.mark(action, {"face_verified": True}).status_code, 428
            )
            self.assertEqual(
                self.mark(
                    action, {"created_offline": True, "face_proof": "invalid"}
                ).json["code"],
                "FACE_OFFLINE_REVIEW",
            )

    def test_exception_approval_and_audit(self):
        data = {
            "decision": "grant",
            "revision": 0,
            "days": 3,
            "category": "device",
            "reference": "HR-109",
        }
        self.assertEqual(self.admin("exception", data, target=self.hr).status_code, 403)
        self.assertEqual(self.admin("exception", data).status_code, 200)
        self.assertEqual(self.mark("check-in").status_code, 200)
        self.assertEqual(
            self.db.attendance_logs.find_one({})["check_in_identity_method"],
            "approved_exception",
        )
        self.assertEqual(
            self.db.face_audit.count_documents({"action": "exception_use"}), 1
        )
        self.db.face_profiles.update_one(
            self.sub, {"$set": {"exception_until": svc.now() - timedelta(seconds=1)}}
        )
        self.assertEqual(self.mark("check-out").status_code, 428)
        self.assertTrue(
            any(
                e.get("reference") == "HR-109"
                for e in self.admin("history").json["events"]
            )
        )

    def test_proof_expiry_and_two_attendance_actions(self):
        token = self.proof("check-in")
        _, other = self.person("OtherEmployee")
        self.assertEqual(
            self.mark("check-in", {"face_proof": token}, other).status_code, 403
        )
        r = self.mark("check-in", {"face_proof": token})
        self.assertEqual(r.status_code, 200, r.json)
        self.assertNotIn(token, str(r.json))
        token = self.proof("check-out")
        self.db.face_profiles.update_one(
            self.sub,
            {"$set": {"proofs.check-out.expires": svc.now() - timedelta(seconds=1)}},
        )
        self.assertEqual(
            self.mark(
                "check-out",
                {"face_proof": token, "early_checkout_reason_code": "official_duty"},
            ).status_code,
            403,
        )
        r = self.mark(
            "check-out",
            {
                "face_proof": self.proof("check-out"),
                "early_checkout_reason_code": "official_duty",
            },
        )
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(len(self.db.attendance_logs.find_one({})["timeline"]), 2)

    def test_concurrent_consume(self):
        token = self.proof("check-in")

        def send(_):
            with self.app.test_client() as c:
                return c.post(
                    ATT + "check-in",
                    headers=self.login,
                    json={**GPS, "face_proof": token},
                ).status_code

        with ThreadPoolExecutor(2) as pool:
            codes = list(pool.map(send, range(2)))
        self.assertEqual(codes.count(200), 1, codes)
        self.assertEqual(self.db.attendance_logs.count_documents({}), 1)

    def test_field_gps_and_reason_validation_before_consume(self):
        token = self.proof("check-in")
        for payload in (
            {"face_proof": token},
            {**GPS, "mode": "field", "face_proof": token},
        ):
            self.assertEqual(
                self.client.post(
                    ATT + "check-in", headers=self.login, json=payload
                ).status_code,
                400,
            )
        self.clock.return_value = DAY.replace(hour=11)
        self.assertEqual(self.mark("check-in", {"face_proof": token}).status_code, 400)
        r = self.mark(
            "check-in",
            {
                "face_proof": token,
                "mode": "field",
                "field_location": "Site",
                "field_photo": "field-only",
                "late_reason_code": "traffic_congestion",
            },
        )
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(r.json["attendance"]["field_photo"], "field-only")
        self.notify.assert_called_once()

    def test_holiday_and_sprint_preconditions(self):
        token = self.proof("check-in")
        self.clock.return_value = DAY.replace(day=15)
        self.assertEqual(self.mark("check-in", {"face_proof": token}).status_code, 403)
        self.clock.return_value = DAY
        self.assertEqual(
            self.mark("check-in", {"face_proof": token, "mode": "wfh"}).status_code, 200
        )
        checkout = self.proof("check-out")
        self.db.system_settings.insert_one(
            {
                "_id": "sprint-planning:sds",
                "tenant_id": "sds",
                "setting_group": "sprint_planning",
                "setting_key": "module_enabled",
                "enabled": True,
            }
        )
        self.db.sprint_weekly_plans.insert_one(
            {
                **self.sub,
                "status": "approved",
                "week_start": "2026-11-16",
                "week_end": "2026-11-22",
                "activities": [
                    {
                        "planned_date": "2026-11-17",
                        "activity_id": "a",
                        "status": "planned",
                    }
                ],
            }
        )
        r = self.mark(
            "check-out",
            {"face_proof": checkout, "early_checkout_reason_code": "official_duty"},
        )
        self.assertEqual(r.json["code"], "DAILY_WORK_REPORT_REQUIRED")
        self.assertTrue(self.db.face_profiles.find_one(self.sub)["proofs"]["check-out"])

    def test_approved_holiday_and_duplicate_checkout(self):
        self.clock.return_value = DAY.replace(day=15)
        self.db.holiday_work_requests.insert_one(
            {**self.sub, "date": "2026-11-15", "status": "approved"}
        )
        self.assertEqual(
            self.mark("check-in", {"face_proof": self.proof("check-in")}).status_code,
            200,
        )
        self.clock.return_value = DAY.replace(day=15, hour=18)
        payload = {
            "face_proof": self.proof("check-out"),
            "client_attendance_id": "device-checkout-01",
        }
        self.assertEqual(self.mark("check-out", payload).status_code, 200)
        self.assertEqual(
            self.mark("check-out", payload).json["message"], "Check-out already synced"
        )
        self.assertEqual(self.db.compoff_credits.count_documents(self.sub), 1)
        self.assertEqual(len(self.db.attendance_logs.find_one(self.sub)["timeline"]), 2)

    def test_default_off_and_offline_compatibility(self):
        self.app.config["FACE_ATTENDANCE_ENFORCE_TENANTS"] = ""
        self.assertEqual(self.call("employees", login=self.hrlogin).status_code, 404)
        self.app.config["FACE_ATTENDANCE_PREPARE_TENANTS"] = "sds"
        p = {
            "created_offline": True,
            "client_attendance_id": "queue-1",
            "offline_marked_at": DAY.isoformat(),
        }
        self.assertEqual(self.mark("check-in", p).status_code, 200)
        self.assertEqual(
            self.mark("check-in", p).json["message"], "Check-in already synced"
        )
        self.assertNotIn(
            "check_in_identity_method", self.db.attendance_logs.find_one({})
        )

    def test_eve_final_writers(self):
        with (
            self.app.test_request_context(),
            patch.object(eve, "_attendance_employee", return_value=self.employee),
        ):
            g.tenant_id = "sds"
            for fn in (eve._submit_ai_check_in, eve._submit_ai_check_out):
                with self.assertRaisesRegex(RuntimeError, "Open the Attendance screen"):
                    fn({}, {"tenant_id": "sds"})
        self.assertEqual(self.db.attendance_logs.count_documents({}), 0)

    def test_rate_limit_and_generic_crud(self):
        self.register()
        for _ in range(8):
            self.assertEqual(
                self.call("challenge", {"action": "check-in"}).status_code, 200
            )
        self.assertEqual(
            self.call("challenge", {"action": "check-in"}).status_code, 429
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/attendance_logs", headers=self.hrlogin, json={}
            ).status_code,
            403,
        )
