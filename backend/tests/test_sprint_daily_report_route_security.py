"""Regression tests for Sprint daily-report attachment authorization.

Runs the reporting handler in a Flask request context with a mocked DB.
No real MongoDB or attendance operations.
"""

import unittest
from unittest.mock import MagicMock, patch

from bson import ObjectId
from flask import Flask, g

import app.routes.sprint_planning as routes


class SprintDailyReportRouteSecurityTests(unittest.TestCase):

    def setUp(self):
        self.app = Flask(__name__)
        self.plan_oid = ObjectId()
        self.employee_id = str(ObjectId())
        self.activity_id = "activity-001"
        self.attachment_id = "a" * 32

        self.doc = {
            "_id": self.plan_oid,
            "tenant_id": "tenant-A",
            "employee_id": self.employee_id,
            "status": "approved",
            "is_deleted": False,
            "activities": [{
                "activity_id": self.activity_id,
                "status": "planned",
                "evidence": [],
            }],
        }

    def run_report(self, reference, attachment_owner=None):
        db = MagicMock()
        db.sprint_weekly_plans.update_one.return_value.matched_count = 1

        db.sprint_attachments.find_one.return_value = {
            "attachment_id": self.attachment_id,
            "tenant_id": "tenant-A",
            "employee_id": (
                self.employee_id
                if attachment_owner is None
                else attachment_owner
            ),
            "plan_id": str(self.plan_oid),
            "activity_id": self.activity_id,
            "plan_type": "daily",
            "field_key": "work_file",
            "row_id": None,
            "is_deleted": False,
        }

        url = (
            f"/api/v1/sprint-planning/weekly/{self.plan_oid}"
            f"/activities/{self.activity_id}/report"
        )

        with self.app.test_request_context(
            url,
            method="PATCH",
            json={
                "status": "completed",
                "evidence": [{
                    "type": (
                        "link" if reference.startswith("https://")
                        else "document"
                    ),
                    "reference": reference,
                }],
            },
        ):
            g.tenant_id = "tenant-A"
            g.current_user = {
                "_id": ObjectId(),
                "tenant_id": "tenant-A",
                "role": "employee",
            }

            with (
                patch.object(routes, "get_db", return_value=db),
                patch.object(routes, "_document", return_value=self.doc),
                patch.object(
                    routes, "_own_id",
                    return_value=self.employee_id,
                ),
                patch.object(
                    routes,
                    "_sprint_validate_daily_template",
                    return_value={},
                ),
                patch.object(routes, "audit"),
            ):
                result = routes.report_activity.__wrapped__(
                    str(self.plan_oid),
                    self.activity_id,
                )

                if isinstance(result, tuple):
                    response, status = result
                else:
                    response = result
                    status = response.status_code

                return status, response.get_json(), db

    def test_other_employee_attachment_rejected_without_update(self):
        status, body, db = self.run_report(
            "sprint-attachment:" + self.attachment_id,
            attachment_owner=str(ObjectId()),
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["message"], "Evidence owner mismatch")
        db.sprint_weekly_plans.update_one.assert_not_called()
        db.sprint_attachments.find_one.assert_called_once()

    def test_owned_attachment_accepted(self):
        status, _, db = self.run_report(
            "sprint-attachment:" + self.attachment_id
        )

        self.assertEqual(status, 200)
        db.sprint_weekly_plans.update_one.assert_called_once()
        db.sprint_attachments.find_one.assert_called_once()

    def test_external_link_accepted_without_attachment_lookup(self):
        status, _, db = self.run_report(
            "https://docs.google.com/spreadsheets/d/example"
        )

        self.assertEqual(status, 200)
        db.sprint_weekly_plans.update_one.assert_called_once()
        db.sprint_attachments.find_one.assert_not_called()


if __name__ == "__main__":
    unittest.main()
