from __future__ import annotations

import csv
import hashlib
import io
import unittest
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

from bson import ObjectId
from pymongo import ReturnDocument

from app.services.payroll_bank_service import (
    PayrollBankError,
    account_fingerprint,
    build_bank_disbursement_rows,
    deactivate_bank_details,
    generate_bank_disbursement_csv,
    mark_bank_export_status,
    mask_account_number,
    normalize_bank_details_payload,
    normalize_period,
    prepare_payroll_bank_snapshots,
    serialize_bank_details,
    upsert_bank_details,
    validate_bank_details_for_disbursement,
    verify_bank_details,
)


TENANT_ID = "tenant-payroll"
OTHER_TENANT_ID = "tenant-other"
EMPLOYEE_ID = ObjectId("64b64c5d8f4b2a0012345678")
SECOND_EMPLOYEE_ID = ObjectId("64b64c5d8f4b2a0012345679")
BANK_DETAILS_ID = ObjectId("64b64c5d8f4b2a0012345680")
RUN_ID = ObjectId("64b64c5d8f4b2a0012345681")
PAYSLIP_ID = ObjectId("64b64c5d8f4b2a0012345682")
SECOND_PAYSLIP_ID = ObjectId("64b64c5d8f4b2a0012345683")
EXPORT_ID = ObjectId("64b64c5d8f4b2a0012345684")


def employee_record(**overrides):
    row = {
        "_id": EMPLOYEE_ID,
        "tenant_id": TENANT_ID,
        "employee_code": "SDS-001",
        "employee_name": "Payroll Employee",
        "official_email": "payroll@example.com",
        "status": "active",
    }
    row.update(overrides)
    return row


def bank_payload(**overrides):
    row = {
        "account_holder_name": "Payroll Employee",
        "account_number": "123456789012",
        "ifsc_code": "SBIN0001234",
        "bank_name": "State Bank of India",
        "branch_name": "Guwahati Main",
        "account_type": "salary",
        "payment_method": "neft",
        "beneficiary_code": "SDS-001",
        "effective_from": "2026-07-01",
    }
    row.update(overrides)
    return row


def bank_record(**overrides):
    row = {
        "_id": BANK_DETAILS_ID,
        "tenant_id": TENANT_ID,
        "employee_id": str(EMPLOYEE_ID),
        "employee_code": "SDS-001",
        "employee_name": "Payroll Employee",
        "user_id": "user-1",
        "account_holder_name": "Payroll Employee",
        "account_number": "123456789012",
        "masked_account_number": "********9012",
        "account_number_last4": "9012",
        "account_number_fingerprint": account_fingerprint(
            tenant_id=TENANT_ID,
            account_number="123456789012",
        ),
        "ifsc_code": "SBIN0001234",
        "bank_name": "State Bank of India",
        "branch_name": "Guwahati Main",
        "account_type": "salary",
        "payment_method": "neft",
        "beneficiary_code": "SDS-001",
        "effective_from": "2026-07-01",
        "verification_status": "verified",
        "is_verified": True,
        "verified_at": datetime(2026, 7, 2, 10, 0, tzinfo=UTC),
        "verified_by": "checker-1",
        "verified_by_name": "Finance Checker",
        "status": "active",
        "is_active": True,
        "revision_number": 1,
        "revisions": [],
        "verification_history": [],
        "created_at": datetime(2026, 7, 1, 9, 0, tzinfo=UTC),
        "updated_at": datetime(2026, 7, 2, 10, 0, tzinfo=UTC),
        "updated_by": "maker-1",
        "updated_by_name": "HR Maker",
        "is_deleted": False,
    }
    row.update(overrides)
    return row


def bank_snapshot(**overrides):
    source = bank_record()
    row = {
        "bank_details_id": str(source["_id"]),
        "employee_id": source["employee_id"],
        "employee_code": source["employee_code"],
        "employee_name": source["employee_name"],
        "account_holder_name": source["account_holder_name"],
        "account_number": source["account_number"],
        "masked_account_number": source["masked_account_number"],
        "account_number_last4": source["account_number_last4"],
        "ifsc_code": source["ifsc_code"],
        "bank_name": source["bank_name"],
        "branch_name": source["branch_name"],
        "account_type": source["account_type"],
        "payment_method": source["payment_method"],
        "beneficiary_code": source["beneficiary_code"],
        "verification_status": "verified",
        "is_verified": True,
        "verified_at": source["verified_at"],
        "revision_number": 1,
        "snapshot_at": datetime(2026, 7, 30, 10, 0, tzinfo=UTC),
    }
    row.update(overrides)
    return row


def payroll_run(**overrides):
    row = {
        "_id": RUN_ID,
        "run_id": str(RUN_ID),
        "tenant_id": TENANT_ID,
        "period_key": "2026-07",
        "status": "locked",
        "is_deleted": False,
    }
    row.update(overrides)
    return row


def payslip_record(**overrides):
    row = {
        "_id": PAYSLIP_ID,
        "tenant_id": TENANT_ID,
        "run_id": str(RUN_ID),
        "period_key": "2026-07",
        "employee_id": str(EMPLOYEE_ID),
        "employee_code": "SDS-001",
        "employee_name": "Payroll Employee",
        "totals": {
            "net_amount": 25662,
        },
        "bank_details_snapshot": bank_snapshot(),
        "status": "locked",
        "is_locked": True,
        "is_deleted": False,
    }
    row.update(overrides)
    return row


class FakeCursor(list):
    def sort(self, *args, **kwargs):
        return self

    def limit(self, value):
        return FakeCursor(self[:value])


class FakeCollection:
    def __init__(self):
        self.find_one_result = None
        self.find_one_results = []
        self.find_result = FakeCursor()
        self.find_one_and_update_result = None
        self.inserted = []
        self.find_one_calls = []
        self.find_calls = []
        self.update_calls = []

    def queue_find_one(self, *results):
        self.find_one_results.extend(results)

    def insert_one(self, document):
        self.inserted.append(document)
        return SimpleNamespace(inserted_id=document.get("_id"))

    def find_one(self, query, *args, **kwargs):
        self.find_one_calls.append(query)

        if self.find_one_results:
            return self.find_one_results.pop(0)

        return self.find_one_result

    def find(self, query, *args, **kwargs):
        self.find_calls.append(query)
        return self.find_result

    def find_one_and_update(self, query, update, **kwargs):
        self.update_calls.append((query, update, kwargs))
        return self.find_one_and_update_result


class FakeDB:
    def __init__(self):
        self.employees = FakeCollection()
        self.bank_details = FakeCollection()
        self.payroll_runs = FakeCollection()
        self.payslips = FakeCollection()
        self.payroll_bank_exports = FakeCollection()

    def __getitem__(self, name):
        return getattr(self, name)


class ValidationTests(unittest.TestCase):
    def test_normalize_period_accepts_year_month(self):
        self.assertEqual(normalize_period("2026-07"), "2026-07")

    def test_invalid_account_number_is_rejected(self):
        with self.assertRaises(PayrollBankError) as context:
            normalize_bank_details_payload(
                bank_payload(account_number="123"),
                tenant_id=TENANT_ID,
                employee=employee_record(),
            )

        self.assertEqual(context.exception.code, "invalid_bank_account_number")

    def test_invalid_ifsc_code_is_rejected(self):
        with self.assertRaises(PayrollBankError) as context:
            normalize_bank_details_payload(
                bank_payload(ifsc_code="INVALID"),
                tenant_id=TENANT_ID,
                employee=employee_record(),
            )

        self.assertEqual(context.exception.code, "invalid_ifsc_code")

    def test_account_number_is_normalized_and_masked(self):
        normalized = normalize_bank_details_payload(
            bank_payload(account_number="1234-5678 9012"),
            tenant_id=TENANT_ID,
            employee=employee_record(),
        )

        self.assertEqual(normalized["account_number"], "123456789012")
        self.assertEqual(normalized["masked_account_number"], "********9012")
        self.assertEqual(mask_account_number("1234-5678 9012"), "********9012")

    def test_account_fingerprint_is_normalized_and_tenant_scoped(self):
        first = account_fingerprint(
            tenant_id=TENANT_ID,
            account_number="1234-5678 9012",
        )
        same = account_fingerprint(
            tenant_id=TENANT_ID,
            account_number="123456789012",
        )
        other_tenant = account_fingerprint(
            tenant_id=OTHER_TENANT_ID,
            account_number="123456789012",
        )

        self.assertEqual(first, same)
        self.assertNotEqual(first, other_tenant)
        self.assertEqual(len(first), 64)

    def test_serialization_masks_account_number_by_default(self):
        result = serialize_bank_details(bank_record())

        self.assertNotIn("account_number", result)
        self.assertEqual(result["masked_account_number"], "********9012")


class BankDetailsWorkflowTests(unittest.TestCase):
    @patch("app.services.payroll_bank_service.find_employee")
    def test_bank_details_creation_starts_pending_verification(
        self,
        mock_find_employee,
    ):
        db = FakeDB()
        mock_find_employee.return_value = employee_record()
        db.bank_details.queue_find_one(None, None)

        result = upsert_bank_details(
            db,
            tenant_id=TENANT_ID,
            employee_reference=str(EMPLOYEE_ID),
            payload=bank_payload(),
            actor_id="maker-1",
            actor_name="HR Maker",
        )

        self.assertEqual(result["verification_status"], "pending_verification")
        self.assertFalse(result["is_verified"])
        self.assertEqual(result["revision_number"], 1)
        self.assertEqual(result["masked_account_number"], "********9012")
        self.assertEqual(len(db.bank_details.inserted), 1)

    @patch("app.services.payroll_bank_service.find_employee")
    def test_duplicate_active_bank_account_is_rejected(
        self,
        mock_find_employee,
    ):
        db = FakeDB()
        mock_find_employee.return_value = employee_record()
        db.bank_details.queue_find_one(
            None,
            bank_record(employee_id=str(SECOND_EMPLOYEE_ID)),
        )

        with self.assertRaises(PayrollBankError) as context:
            upsert_bank_details(
                db,
                tenant_id=TENANT_ID,
                employee_reference=str(EMPLOYEE_ID),
                payload=bank_payload(),
            )

        self.assertEqual(context.exception.code, "duplicate_employee_bank_account")

    @patch("app.services.payroll_bank_service.find_employee")
    def test_bank_change_creates_revision_and_requires_reverification(
        self,
        mock_find_employee,
    ):
        db = FakeDB()
        existing = bank_record()
        revised = bank_record(
            account_number="999988887777",
            masked_account_number="********7777",
            account_number_last4="7777",
            verification_status="pending_verification",
            is_verified=False,
            revision_number=2,
        )
        mock_find_employee.return_value = employee_record()
        db.bank_details.queue_find_one(existing, None)
        db.bank_details.find_one_and_update_result = revised

        result = upsert_bank_details(
            db,
            tenant_id=TENANT_ID,
            employee_reference=str(EMPLOYEE_ID),
            payload=bank_payload(account_number="999988887777"),
            actor_id="maker-2",
            actor_name="HR Maker 2",
            note="Employee submitted a new salary account.",
        )

        self.assertEqual(result["revision_number"], 2)
        self.assertFalse(result["is_verified"])
        _, update, kwargs = db.bank_details.update_calls[0]
        self.assertEqual(update["$set"]["verification_status"], "pending_verification")
        self.assertFalse(update["$set"]["is_verified"])
        self.assertEqual(update["$push"]["revisions"]["revision_number"], 1)
        self.assertIn("account_number", update["$push"]["revisions"]["changed_fields"])
        self.assertEqual(kwargs["return_document"], ReturnDocument.AFTER)

    @patch("app.services.payroll_bank_service.get_bank_details")
    def test_maker_cannot_verify_same_revision(self, mock_get_bank_details):
        db = FakeDB()
        mock_get_bank_details.return_value = bank_record(
            verification_status="pending_verification",
            is_verified=False,
            updated_by="maker-1",
        )

        with self.assertRaises(PayrollBankError) as context:
            verify_bank_details(
                db,
                tenant_id=TENANT_ID,
                employee_reference=str(EMPLOYEE_ID),
                decision="verified",
                actor_id="maker-1",
                actor_name="HR Maker",
            )

        self.assertEqual(
            context.exception.code,
            "bank_verification_maker_checker_required",
        )

    @patch("app.services.payroll_bank_service.get_bank_details")
    def test_checker_can_verify_bank_details(self, mock_get_bank_details):
        db = FakeDB()
        pending = bank_record(
            verification_status="pending_verification",
            is_verified=False,
            updated_by="maker-1",
        )
        verified = bank_record(
            verification_status="verified",
            is_verified=True,
            verified_by="checker-1",
        )
        mock_get_bank_details.return_value = pending
        db.bank_details.find_one_and_update_result = verified

        result = verify_bank_details(
            db,
            tenant_id=TENANT_ID,
            employee_reference=str(EMPLOYEE_ID),
            decision="verified",
            actor_id="checker-1",
            actor_name="Finance Checker",
        )

        self.assertTrue(result["is_verified"])
        update = db.bank_details.update_calls[0][1]
        self.assertEqual(update["$set"]["verification_status"], "verified")
        self.assertTrue(update["$set"]["is_verified"])
        self.assertEqual(update["$push"]["verification_history"]["decision"], "verified")

    @patch("app.services.payroll_bank_service.get_bank_details")
    def test_checker_can_reject_bank_details_with_reason(
        self,
        mock_get_bank_details,
    ):
        db = FakeDB()
        pending = bank_record(
            verification_status="pending_verification",
            is_verified=False,
            updated_by="maker-1",
        )
        rejected = bank_record(
            verification_status="rejected",
            is_verified=False,
            rejection_reason="Account proof does not match.",
        )
        mock_get_bank_details.return_value = pending
        db.bank_details.find_one_and_update_result = rejected

        result = verify_bank_details(
            db,
            tenant_id=TENANT_ID,
            employee_reference=str(EMPLOYEE_ID),
            decision="rejected",
            actor_id="checker-1",
            actor_name="Finance Checker",
            note="Account proof does not match.",
        )

        self.assertEqual(result["verification_status"], "rejected")
        update = db.bank_details.update_calls[0][1]
        self.assertEqual(update["$set"]["rejection_reason"], "Account proof does not match.")

    @patch("app.services.payroll_bank_service.get_bank_details")
    def test_deactivation_marks_bank_details_inactive(
        self,
        mock_get_bank_details,
    ):
        db = FakeDB()
        mock_get_bank_details.return_value = bank_record()
        inactive = bank_record(
            status="inactive",
            is_active=False,
            is_verified=False,
            verification_status="pending_verification",
        )
        db.bank_details.find_one_and_update_result = inactive

        result = deactivate_bank_details(
            db,
            tenant_id=TENANT_ID,
            employee_reference=str(EMPLOYEE_ID),
            reason="Employee exited the company.",
            actor_id="finance-1",
            actor_name="Finance User",
        )

        self.assertEqual(result["status"], "inactive")
        self.assertFalse(result["is_active"])
        update = db.bank_details.update_calls[0][1]
        self.assertEqual(update["$set"]["deactivation_reason"], "Employee exited the company.")

    def test_verified_bank_details_are_disbursement_ready(self):
        result = validate_bank_details_for_disbursement(bank_record())

        self.assertEqual(result["account_number"], "123456789012")
        self.assertEqual(result["ifsc_code"], "SBIN0001234")
        self.assertEqual(result["verification_status"], "verified")

    def test_unverified_bank_details_are_not_disbursement_ready(self):
        with self.assertRaises(PayrollBankError) as context:
            validate_bank_details_for_disbursement(
                bank_record(
                    verification_status="pending_verification",
                    is_verified=False,
                )
            )

        self.assertEqual(
            context.exception.code,
            "bank_details_not_disbursement_ready",
        )
        error_fields = {
            item["field"]
            for item in context.exception.details["errors"]
        }
        self.assertIn("verification_status", error_fields)


class PayrollSnapshotTests(unittest.TestCase):
    @patch("app.services.payroll_bank_service.get_bank_details")
    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_verified_bank_snapshot_is_saved_before_lock(
        self,
        mock_find_run,
        mock_get_bank_details,
    ):
        db = FakeDB()
        run = payroll_run(status="finance_approved")
        payslip = payslip_record(
            status="finance_approved",
            is_locked=False,
            bank_details_snapshot={},
        )
        updated_payslip = {
            **payslip,
            "bank_details_snapshot": bank_snapshot(),
        }
        mock_find_run.return_value = run
        mock_get_bank_details.return_value = bank_record()
        db.payslips.find_one_and_update_result = updated_payslip

        result = prepare_payroll_bank_snapshots(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            payslips=[payslip],
            actor_id="finance-1",
            actor_name="Finance User",
        )

        self.assertEqual(result["totals"]["prepared"], 1)
        self.assertEqual(result["totals"]["failed"], 0)
        _, update, _ = db.payslips.update_calls[0]
        snapshot = update["$set"]["bank_details_snapshot"]
        self.assertEqual(snapshot["masked_account_number"], "********9012")
        self.assertEqual(snapshot["revision_number"], 1)
        self.assertEqual(snapshot["verification_status"], "verified")

    @patch("app.services.payroll_bank_service.get_bank_details")
    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_missing_bank_details_block_snapshot_preparation(
        self,
        mock_find_run,
        mock_get_bank_details,
    ):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="finance_approved")
        mock_get_bank_details.side_effect = PayrollBankError(
            "Bank details were not found.",
            status_code=404,
            code="bank_details_not_found",
        )
        payslip = payslip_record(
            status="finance_approved",
            is_locked=False,
            bank_details_snapshot={},
        )

        with self.assertRaises(PayrollBankError) as context:
            prepare_payroll_bank_snapshots(
                db,
                tenant_id=TENANT_ID,
                run_id=str(RUN_ID),
                payslips=[payslip],
                strict=True,
            )

        self.assertEqual(
            context.exception.code,
            "payroll_bank_snapshot_validation_failed",
        )
        self.assertEqual(
            context.exception.details["failures"][0]["code"],
            "bank_details_not_found",
        )

    @patch("app.services.payroll_bank_service.get_bank_details")
    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_unverified_bank_details_block_snapshot_preparation(
        self,
        mock_find_run,
        mock_get_bank_details,
    ):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="finance_approved")
        mock_get_bank_details.return_value = bank_record(
            verification_status="pending_verification",
            is_verified=False,
        )
        payslip = payslip_record(
            status="finance_approved",
            is_locked=False,
            bank_details_snapshot={},
        )

        with self.assertRaises(PayrollBankError) as context:
            prepare_payroll_bank_snapshots(
                db,
                tenant_id=TENANT_ID,
                run_id=str(RUN_ID),
                payslips=[payslip],
                strict=True,
            )

        self.assertEqual(
            context.exception.details["failures"][0]["code"],
            "bank_details_not_disbursement_ready",
        )

    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_missing_snapshot_cannot_be_added_after_payroll_lock(
        self,
        mock_find_run,
    ):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="locked")
        payslip = payslip_record(
            status="locked",
            is_locked=True,
            bank_details_snapshot={},
        )

        with self.assertRaises(PayrollBankError) as context:
            prepare_payroll_bank_snapshots(
                db,
                tenant_id=TENANT_ID,
                run_id=str(RUN_ID),
                payslips=[payslip],
                strict=True,
            )

        self.assertEqual(
            context.exception.code,
            "payroll_bank_snapshot_validation_failed",
        )
        self.assertEqual(
            context.exception.details["failures"][0]["code"],
            "locked_payroll_bank_snapshot_missing",
        )
        self.assertEqual(len(db.payslips.update_calls), 0)

    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_existing_verified_snapshot_is_preserved_after_lock(
        self,
        mock_find_run,
    ):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="locked")
        payslip = payslip_record()

        result = prepare_payroll_bank_snapshots(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            payslips=[payslip],
            strict=True,
        )

        self.assertEqual(result["totals"]["skipped"], 1)
        self.assertEqual(result["skipped"][0]["reason"], "snapshot_already_exists")
        self.assertEqual(len(db.payslips.update_calls), 0)


class BankDisbursementExportTests(unittest.TestCase):
    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_bank_rows_include_deterministic_transaction_reference(
        self,
        mock_find_run,
    ):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="locked")
        payslip = payslip_record()

        first = build_bank_disbursement_rows(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            payslips=[payslip],
        )
        second = build_bank_disbursement_rows(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            payslips=[payslip],
        )

        self.assertEqual(first["totals"]["transactions"], 1)
        self.assertEqual(first["rows"][0]["amount"], "25662.00")
        self.assertEqual(
            first["rows"][0]["transaction_reference"],
            second["rows"][0]["transaction_reference"],
        )
        self.assertTrue(
            first["rows"][0]["transaction_reference"].startswith("PY202607")
        )

    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_zero_net_pay_is_excluded_from_bank_rows(self, mock_find_run):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="locked")
        payslip = payslip_record(totals={"net_amount": 0})

        result = build_bank_disbursement_rows(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            payslips=[payslip],
        )

        self.assertEqual(result["totals"]["transactions"], 0)
        self.assertEqual(result["totals"]["skipped"], 1)
        self.assertEqual(result["skipped"][0]["reason"], "zero_net_amount")

    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_duplicate_account_in_same_run_is_reported(self, mock_find_run):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="locked")
        first = payslip_record()
        second = payslip_record(
            _id=SECOND_PAYSLIP_ID,
            employee_id=str(SECOND_EMPLOYEE_ID),
            employee_code="SDS-002",
            employee_name="Second Employee",
            bank_details_snapshot=bank_snapshot(
                employee_id=str(SECOND_EMPLOYEE_ID),
                employee_code="SDS-002",
                employee_name="Second Employee",
            ),
        )

        result = build_bank_disbursement_rows(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            payslips=[first, second],
        )

        self.assertEqual(result["totals"]["transactions"], 1)
        self.assertEqual(result["totals"]["failed"], 1)
        self.assertEqual(
            result["failures"][0]["code"],
            "duplicate_bank_account_in_payroll_run",
        )

    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_csv_generation_uses_expected_columns_and_narration(
        self,
        mock_find_run,
    ):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="locked")

        result = generate_bank_disbursement_csv(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            payslips=[payslip_record()],
            persist_export_metadata=False,
        )

        csv_rows = list(csv.reader(io.StringIO(result["export"]["csv_text"])))
        self.assertEqual(csv_rows[0][0], "Transaction Reference")
        self.assertEqual(csv_rows[1][1], "Payroll Employee")
        self.assertEqual(csv_rows[1][2], "123456789012")
        self.assertEqual(csv_rows[1][7], "25662.00")
        self.assertEqual(csv_rows[1][8], "NEFT")
        self.assertEqual(csv_rows[1][9], "Salary 2026-07 SDS-001")
        self.assertTrue(result["export"]["csv_bytes"].startswith(b"\xef\xbb\xbf"))

    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_csv_formula_injection_is_neutralized(self, mock_find_run):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="locked")

        result = generate_bank_disbursement_csv(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            payslips=[payslip_record()],
            narration_prefix="=HYPERLINK",
            persist_export_metadata=False,
        )

        csv_rows = list(csv.reader(io.StringIO(result["export"]["csv_text"])))
        narration = csv_rows[1][9]
        self.assertEqual(narration, "'=HYPERLINK 2026-07 SDS-001")

    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_csv_hash_and_export_metadata_are_persisted(self, mock_find_run):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="locked")
        created_at = datetime(2026, 7, 31, 12, 0, tzinfo=UTC)
        db.payroll_bank_exports.find_one_and_update_result = {
            "_id": EXPORT_ID,
            "created_at": created_at,
        }

        result = generate_bank_disbursement_csv(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            payslips=[payslip_record()],
            actor_id="finance-1",
            actor_name="Finance User",
            persist_export_metadata=True,
        )

        expected_hash = hashlib.sha256(
            result["export"]["csv_bytes"]
        ).hexdigest()
        self.assertEqual(result["export"]["sha256"], expected_hash)
        self.assertEqual(result["export"]["id"], str(EXPORT_ID))
        query, update, kwargs = db.payroll_bank_exports.update_calls[0]
        self.assertEqual(update["$setOnInsert"]["sha256"], expected_hash)
        self.assertEqual(update["$setOnInsert"]["transaction_count"], 1)
        self.assertEqual(update["$setOnInsert"]["total_amount"], 25662)
        self.assertNotIn(
            "beneficiary_account_number",
            update["$setOnInsert"]["transactions"][0],
        )
        self.assertTrue(kwargs["upsert"])
        self.assertEqual(query["tenant_id"], TENANT_ID)

    @patch("app.services.payroll_bank_service._find_payroll_run")
    def test_export_generation_fails_when_any_payslip_is_invalid(
        self,
        mock_find_run,
    ):
        db = FakeDB()
        mock_find_run.return_value = payroll_run(status="locked")
        invalid = payslip_record(bank_details_snapshot={})

        with self.assertRaises(PayrollBankError) as context:
            generate_bank_disbursement_csv(
                db,
                tenant_id=TENANT_ID,
                run_id=str(RUN_ID),
                payslips=[invalid],
                persist_export_metadata=False,
                fail_on_validation_error=True,
            )

        self.assertEqual(context.exception.code, "bank_export_validation_failed")
        self.assertEqual(
            context.exception.details["failures"][0]["code"],
            "locked_payslip_bank_snapshot_missing",
        )

    def test_bank_export_status_can_be_updated(self):
        db = FakeDB()
        processed = {
            "_id": EXPORT_ID,
            "tenant_id": TENANT_ID,
            "status": "processed",
            "status_reference": "BANK-BATCH-001",
        }
        db.payroll_bank_exports.find_one_and_update_result = processed

        result = mark_bank_export_status(
            db,
            tenant_id=TENANT_ID,
            export_id=str(EXPORT_ID),
            status="processed",
            actor_id="finance-1",
            actor_name="Finance User",
            reference="BANK-BATCH-001",
            note="Bank confirmed successful processing.",
        )

        self.assertEqual(result["status"], "processed")
        update = db.payroll_bank_exports.update_calls[0][1]
        self.assertEqual(update["$set"]["status"], "processed")
        self.assertEqual(
            update["$push"]["status_history"]["reference"],
            "BANK-BATCH-001",
        )


if __name__ == "__main__":
    unittest.main()