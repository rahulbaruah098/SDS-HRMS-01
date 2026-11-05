"""Regression tests for Sprint daily evidence authorization.

Pure unit tests using mocked attachment metadata.
No MongoDB access or database writes.
"""

import unittest
from copy import deepcopy
from unittest.mock import MagicMock

from app.services.sprint_daily_evidence_authorization import (
    validate_daily_evidence_ownership,
    SprintDailyEvidenceAuthorizationError,
)


class SprintDailyEvidenceAuthorizationTests(unittest.TestCase):

    def setUp(self):
        self.attachment_id = "a" * 32
        self.reference = "sprint-attachment:" + self.attachment_id

        self.saved = {
            "attachment_id": self.attachment_id,
            "tenant_id": "tenant-A",
            "employee_id": "employee-A",
            "plan_id": "plan-001",
            "activity_id": "activity-001",
            "plan_type": "daily",
            "field_key": "work_file",
            "row_id": None,
            "is_deleted": False,
        }

    def check(self, modifications=None, reference=None):
        saved = deepcopy(self.saved)
        saved.update(modifications or {})

        attachments = MagicMock()

        if (
            saved["tenant_id"] == "tenant-A"
            and not saved["is_deleted"]
        ):
            attachments.find_one.return_value = saved
        else:
            attachments.find_one.return_value = None

        result = validate_daily_evidence_ownership(
            attachments=attachments,
            evidence=[{
                "type": "document",
                "reference": (
                    self.reference
                    if reference is None
                    else reference
                ),
            }],
            tenant_id="tenant-A",
            employee_id="employee-A",
            plan_id="plan-001",
            activity_id="activity-001",
        )

        return result, attachments

    def test_valid_owned_attachment(self):
        result, attachments = self.check()
        self.assertEqual(len(result), 1)
        attachments.find_one.assert_called_once()

    def test_cross_tenant_attachment_rejected(self):
        with self.assertRaises(SprintDailyEvidenceAuthorizationError):
            self.check({"tenant_id": "tenant-B"})

    def test_cross_employee_attachment_rejected(self):
        with self.assertRaises(SprintDailyEvidenceAuthorizationError):
            self.check({"employee_id": "employee-B"})

    def test_different_plan_rejected(self):
        with self.assertRaises(SprintDailyEvidenceAuthorizationError):
            self.check({"plan_id": "plan-999"})

    def test_different_activity_rejected(self):
        with self.assertRaises(SprintDailyEvidenceAuthorizationError):
            self.check({"activity_id": "activity-999"})

    def test_deleted_attachment_rejected(self):
        with self.assertRaises(SprintDailyEvidenceAuthorizationError):
            self.check({"is_deleted": True})

    def test_weekly_attachment_rejected(self):
        with self.assertRaises(SprintDailyEvidenceAuthorizationError):
            self.check({"plan_type": "weekly"})

    def test_monthly_row_scope_rejected(self):
        with self.assertRaises(SprintDailyEvidenceAuthorizationError):
            self.check({"row_id": "row-001"})

    def test_missing_field_key_rejected(self):
        with self.assertRaises(SprintDailyEvidenceAuthorizationError):
            self.check({"field_key": None})

    def test_malformed_internal_reference_rejected(self):
        with self.assertRaises(SprintDailyEvidenceAuthorizationError):
            self.check(reference="sprint-attachment:INVALID")

    def test_external_link_allowed(self):
        result, attachments = self.check(
            reference="https://docs.google.com/spreadsheets/d/example"
        )
        self.assertEqual(len(result), 1)
        attachments.find_one.assert_not_called()

    def test_ordinary_document_reference_allowed(self):
        result, attachments = self.check(
            reference="report-2026.pdf"
        )
        self.assertEqual(len(result), 1)
        attachments.find_one.assert_not_called()


if __name__ == "__main__":
    unittest.main()
