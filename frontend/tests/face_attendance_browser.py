"""Exercise the production React components with Chromium's virtual camera and a controlled API."""

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

from playwright.sync_api import expect, sync_playwright

FRONT = Path(__file__).resolve().parents[1]
FIXTURES = FRONT.parent / "backend" / "tests"
SCREEN = """
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AttendanceWidget from '/src/components/AttendanceWidget.jsx';
import CustomAlertProvider from '/src/components/CustomAlertProvider.jsx';
import {FaceAccess} from '/src/components/FaceAccess.jsx';
import FaceManagement from '/src/pages/FaceManagement.jsx';
import FaceAttendanceSettings from '/src/components/FaceAttendanceSettings.jsx';
function App() {
  const [page, setPage] = useState('attendance');
  return <CustomAlertProvider>{page === 'face_attendance'
    ? <FaceManagement setPage={setPage}/>
    : <><FaceAttendanceSettings confirmChange={async () => true} onOpenEnrollment={() => setPage('face_attendance')}/><FaceAccess setPage={setPage}/><AttendanceWidget/></>}</CustomAlertProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
"""
WATCH = """
window.cameraTracks = [];
window.sawMatch = false;
navigator.mediaDevices.getUserMedia = new Proxy(navigator.mediaDevices.getUserMedia, {
  async apply(original, target, args) {
    if (window.denyCamera) throw new DOMException('Denied', 'NotAllowedError');
    const stream = await Reflect.apply(original, target, args);
    window.cameraTracks.push(...stream.getTracks());
    return stream;
  }
});
new MutationObserver(() => {
  if (document.querySelector('.yf-matched')) window.sawMatch = true;
}).observe(document, {subtree:true, childList:true, attributes:true});
"""


class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_dir = tempfile.TemporaryDirectory(prefix="face_browser_", dir=FRONT)
        cls.addClassCleanup(test_dir.cleanup)
        folder = Path(test_dir.name)
        (folder / "index.html").write_text(
            '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="./screen.jsx"></script>',
            encoding="utf-8",
        )
        (folder / "screen.jsx").write_text(SCREEN, encoding="utf-8")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        cls.url = f"{base}/{folder.name}/index.html"
        log = tempfile.TemporaryFile()
        cls.addClassCleanup(log.close)
        server = subprocess.Popen(
            [
                shutil.which("node") or "node",
                "node_modules/vite/bin/vite.js",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--strictPort",
            ],
            cwd=FRONT,
            env={**os.environ, "VITE_API_BASE": base + "/api/v1"},
            stdout=log,
            stderr=log,
        )

        def stop():
            server.terminate()
            server.wait(timeout=15)

        cls.addClassCleanup(stop)
        http = build_opener(ProxyHandler({}))
        for _ in range(150):
            try:
                with http.open(cls.url, timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                if server.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(log.read().decode(errors="replace"))
                time.sleep(0.1)
        else:
            raise RuntimeError("The Vite test server did not start.")
        driver = sync_playwright().start()
        cls.addClassCleanup(driver.stop)
        cls.browser = driver.chromium.launch(
            executable_path=os.getenv("FACE_TEST_CHROME") or None,
            args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                "--no-proxy-server",
            ],
        )
        cls.addClassCleanup(cls.browser.close)

    def setUp(self):
        self.enforcing = True
        self.policy_mode = 'enforce'
        self.policy_revision = 0
        self.record = {}
        self.profile = {"revision": 0, "consented": False, "status": "Not Registered"}
        self.history = []
        self.writes = []
        self.frames = []
        self.enrollments = []
        self.errors = []
        self.mismatch = False
        self.ctx = self.browser.new_context(
            viewport={"width": 390, "height": 790},
            reduced_motion="reduce",
            geolocation={"latitude": 26.18, "longitude": 91.74, "accuracy": 5},
            permissions=["camera", "geolocation"],
        )
        self.addCleanup(self.ctx.close)
        self.page = self.ctx.new_page()
        self.page.add_init_script(WATCH)
        self.page.on("pageerror", lambda err: self.errors.append(str(err)))
        self.page.route("**/api/v1/**", self.api)

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def api(self, route):
        req = route.request
        path = urlsplit(req.url).path.removeprefix("/api/v1/")
        data = req.post_data_json if req.post_data else {}
        self.history.append(path)
        result, status = {}, 200
        if path == "attendance/status":
            result = {
                "late_cutoff": "23:59",
                "office_end": "00:00",
                "attendance": self.record,
                "available_modes": ["office", "wfh", "field"],
                "face_attendance": {"requires_camera": self.enforcing},
            }
        elif path == "face-attendance/settings":
            if req.method == "PATCH":
                self.policy_mode = data["mode"]
                self.policy_revision += 1
                self.enforcing = self.policy_mode == "enforce"
            result = {
                "tenant_id": "sds",
                "mode": self.policy_mode,
                "revision": self.policy_revision,
                "can_manage": True,
                "readiness": {"registered": 1 if self.profile.get("status") == "Registered" else 0,
                              "temporary_exceptions": 0},
            }
        elif path == "face-attendance/access":
            result = {
                "mode": self.policy_mode,
                "mine": self.profile,
                "can_manage": True,
                "show_privacy": self.policy_mode != "off",
                "retention_days": 180,
                "audit_days": 365,
                "notice_version": "v1",
            }
        elif path == "face-attendance/consent":
            self.profile = {
                **self.profile,
                "consented": data["decision"] == "accept",
                "revision": 1,
            }
            result = {"mine": self.profile}
        elif path == "face-attendance/employees":
            result = {
                "roster": [
                    {
                        "id": "ec1",
                        "name": "Test Employee",
                        "code": "E01",
                        "department": "IT",
                        **self.profile,
                    }
                ],
                "next_after": None,
            }
        elif path == "face-attendance/employees/ec1/enroll":
            self.enrollments.append(data)
            self.profile = {**self.profile, "status": "Registered", "revision": 2}
            result = {"record": self.profile}
        elif path == "face-attendance/challenge":
            result = {"challenge": "browser-session", "step": 0, "prompt": "center"}
        elif path == "face-attendance/frame":
            self.frames.append((data["step"], bool(data["frame"])))
            if self.mismatch:
                status, result = (
                    403,
                    {"message": "Your face did not match.", "code": "FACE_NO_MATCH"},
                )
            elif data["step"] == 2:
                result = {"proof": "browser-only-proof", "expires_in": 45}
            else:
                result = {
                    "prompt": ["left", "center"][data["step"]],
                    "step": data["step"] + 1,
                }
        elif path == "sprint-planning/availability":
            result = {"enabled": False}
        elif path in ("attendance/check-in", "attendance/check-out"):
            self.writes.append((path, data))
            field = "check_in" if path.endswith("check-in") else "check_out"
            self.record[field] = datetime.now(timezone.utc).isoformat()
            result = {"attendance": self.record}
        route.fulfill(
            status=status, content_type="application/json", body=json.dumps(result)
        )

    def visit(self):
        self.page.goto(self.url)
        expect(
            self.page.get_by_role("button", name="Facial attendance privacy")
        ).to_be_visible()
        self.page.wait_for_function(
            "document.querySelector('.attendance-hold-grid') !== null"
        )

    def hold(self, action):
        button = self.page.get_by_role(
            "button", name="Press & Hold to Check " + action, exact=True
        )
        button.scroll_into_view_if_needed()
        button.hover()
        self.page.mouse.down()
        self.page.wait_for_timeout(1740)
        self.page.mouse.up()

    def released(self):
        self.page.wait_for_function(
            "window.cameraTracks.length > 0 && window.cameraTracks.every(t => t.readyState === 'ended')"
        )

    def test_verified_checkin_and_checkout(self):
        self.visit()
        for action in ("In", "Out"):
            self.page.evaluate("window.sawMatch = false")
            self.hold(action)
            expect(
                self.page.get_by_text("Look straight ahead", exact=True)
            ).to_be_visible()
            expect(
                self.page.get_by_text("Turn slowly to your left", exact=True)
            ).to_be_visible()
            expect(
                self.page.get_by_role(
                    "button", name="Already Checked " + action, exact=True
                )
            ).to_be_visible(timeout=15000)
            self.assertTrue(self.page.evaluate("window.sawMatch"))
            self.released()
        self.assertEqual(
            [k for k, _ in self.writes], ["attendance/check-in", "attendance/check-out"]
        )
        self.assertEqual(self.frames, [(0, True), (1, True), (2, True)] * 2)
        for _, body in self.writes:
            self.assertEqual(body["face_proof"], "browser-only-proof")
            self.assertAlmostEqual(body["latitude"], 26.18)
        self.assertIn("sprint-planning/availability", self.history)

    def test_cancel_releases_camera_without_attendance(self):
        self.visit()
        self.hold("In")
        expect(self.page.get_by_text("Look straight ahead", exact=True)).to_be_visible()
        self.page.get_by_role("button", name="Cancel", exact=True).click()
        expect(self.page.get_by_role("dialog")).to_have_count(0)
        self.released()
        self.assertEqual(self.writes, [])
        self.assertIn("face-attendance/cancel", self.history)

    def test_mismatch_permission_retry_escape(self):
        self.mismatch = True
        self.visit()
        self.hold("In")
        expect(
            self.page.get_by_text("Your face did not match.", exact=True)
        ).to_be_visible()
        self.released()
        self.page.evaluate("window.denyCamera = true")
        self.page.get_by_role("button", name="Try again").click()
        expect(
            self.page.get_by_text(
                "Allow camera access in your browser’s site settings, then try again."
            )
        ).to_be_visible()
        self.page.keyboard.press("Escape")
        expect(self.page.get_by_role("dialog")).to_have_count(0)
        self.assertEqual(self.writes, [])

    def test_activation_off_preparation_and_face_training_access(self):
        self.enforcing = False
        self.policy_mode = "off"
        self.page.goto(self.url)
        expect(self.page.get_by_text("Inactive", exact=True)).to_be_visible()
        expect(self.page.get_by_role("button", name="Facial attendance privacy")).to_have_count(0)
        self.page.get_by_role("button", name="Enable enrollment preparation").click()
        expect(self.page.get_by_text("Enrollment preparation", exact=True)).to_be_visible()
        expect(self.page.get_by_role("button", name="Facial attendance privacy")).to_be_visible()
        self.page.get_by_role("button", name="Open Face Training").click()
        expect(self.page.get_by_role("heading", name="Employee Face Training")).to_be_visible()
        expect(self.page.get_by_text("HR captures 3–5 distinct photographs", exact=False)).to_be_visible()
        self.assertIn("face-attendance/settings", self.history)

    def test_activation_switch_updates_attendance_mode(self):
        self.visit()
        switch = self.page.get_by_role("switch", name="Require facial verification for attendance")
        expect(switch).to_have_attribute("aria-checked", "true")
        switch.click()
        expect(switch).to_have_attribute("aria-checked", "false")
        self.assertFalse(self.enforcing)
        self.assertEqual(self.policy_mode, "prepare")
        self.profile["status"] = "Registered"
        switch.click()
        expect(switch).to_have_attribute("aria-checked", "true")
        self.assertTrue(self.enforcing)
        self.assertEqual(self.policy_revision, 2)

    def test_studio_camera_photo_capture(self):
        self.enforcing = False
        self.policy_mode = 'prepare'
        self.visit()
        self.page.get_by_role("button", name="Facial attendance privacy").click()
        self.page.get_by_role("button", name="I agree to facial attendance").click()
        self.page.get_by_role("button", name="Facial enrollment").click()
        self.page.get_by_role("button", name="Test Employee", exact=False).click()
        self.page.get_by_role("button", name="Capture using camera").click()
        preview = self.page.get_by_label("Employee live camera preview")
        expect(preview).to_be_visible()
        # Visible <video> is not proof that the first camera frame has arrived.
        self.page.wait_for_function(
            """() => { const v = document.querySelector('video[aria-label="Employee live camera preview"]');
            return Boolean(v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0); }"""
        )
        capture = self.page.get_by_role("button", name="Capture photo")
        expect(capture).to_be_enabled()
        for photo_number in range(1, 4):
            capture.click()
            # Wait for React to render each state update before another capture.
            expect(self.page.get_by_alt_text(f"Enrollment photo {photo_number}", exact=False)).to_be_visible()
        self.page.get_by_role("button", name="Register face").click()
        expect(self.page.get_by_text("Test Employee · Registered", exact=True)).to_be_visible()
        self.assertEqual(len(self.enrollments[0]["photos"]), 3)

    def test_camera_optional_and_staff_enrollment(self):
        self.enforcing = False
        self.policy_mode = 'prepare'
        self.visit()
        self.hold("In")
        expect(
            self.page.get_by_role("button", name="Already Checked In")
        ).to_be_visible()
        self.assertNotIn("face_proof", self.writes[0][1])
        self.assertNotIn("face-attendance/challenge", self.history)
        self.page.get_by_role("button", name="Facial attendance privacy").click()
        self.page.get_by_role("button", name="I agree to facial attendance").click()
        expect(self.page.get_by_role("dialog")).to_have_count(0)
        self.page.get_by_role("button", name="Facial enrollment").click()
        self.page.get_by_role("textbox", name="Search employees").fill("Test")
        self.page.get_by_role("button", name="Test Employee", exact=False).click()
        input_file = self.page.get_by_label("Choose enrollment photographs")
        input_file.set_input_files(
            [
                FIXTURES / f
                for f in (
                    "face_fixture.jpg",
                    "face_enrollment_view2.jpg",
                    "face_enrollment_view3.jpg",
                )
            ]
        )
        expect(self.page.get_by_alt_text("Enrollment photo 3", exact=False)).to_be_visible()
        self.assertTrue(
            self.page.evaluate(
                "document.documentElement.scrollWidth <= innerWidth && document.querySelector('dialog').scrollWidth <= innerWidth"
            )
        )
        self.page.get_by_role("button", name="Register face").click()
        expect(
            self.page.get_by_text("Test Employee · Registered", exact=True)
        ).to_be_visible()
        self.assertEqual(len(self.enrollments), 1)
        self.assertEqual(len(self.enrollments[0]["photos"]), 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
