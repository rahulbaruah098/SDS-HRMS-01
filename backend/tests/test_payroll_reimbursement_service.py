from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from bson import ObjectId

from app.services.payroll_reimbursement_service import (
    PayrollReimbursementError,
    apply_payroll_reimbursement_payments,
    approve_reimbursement,
    cancel_reimbursement,
    complete_hr_review,
    create_reimbursement,
    list_reimbursements,
    mark_manual_reimbursement_paid,
    normalize_period,
    reject_reimbursement,
    release_payroll_reimbursements,
    reserve_payroll_reimbursements,
    resolve_payroll_reimbursements,
    revise_reimbursement_schedule,
    submit_reimbursement,
    summarize_payroll_reimbursements,
    update_reimbursement_draft,
)


TENANT_ID = "tenant-payroll"
EMPLOYEE_ID = ObjectId("64b64c5d8f4b2a0012345678")
REIMBURSEMENT_ID = ObjectId("64b64c5d8f4b2a0012345679")
RUN_ID = ObjectId("64b64c5d8f4b2a0012345680")


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


def receipt(reference="receipt-1"):
    return {
        "reference": reference,
        "filename": "bill.pdf",
        "mime_type": "application/pdf",
    }


def claim_item(**overrides):
    row = {
        "item_id": "item-1",
        "type": "travel",
        "expense_date": "2026-07-05",
        "description": "Client visit",
        "amount": 1200,
        "receipts": [receipt()],
    }
    row.update(overrides)
    return row


def reimbursement_record(**overrides):
    row = {
        "_id": REIMBURSEMENT_ID,
        "tenant_id": TENANT_ID,
        "employee_id": str(EMPLOYEE_ID),
        "employee_code": "SDS-001",
        "employee_name": "Payroll Employee",
        "type": "travel",
        "claim_type": "travel",
        "label": "Travel Reimbursement",
        "purpose": "Client visit",
        "items": [claim_item()],
        "claimed_amount": 1200,
        "approved_amount": 0,
        "rejected_amount": 0,
        "tax_treatment": "",
        "is_taxable": None,
        "payment_mode": "",
        "payroll_period": "",
        "status": "draft",
        "workflow_stage": "draft",
        "workflow_history": [],
        "payroll_snapshot": {},
        "payment": {},
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
        self.find_result = FakeCursor()
        self.find_one_and_update_result = None
        self.inserted = []
        self.find_one_calls = []
        self.find_calls = []
        self.update_calls = []

    def insert_one(self, document):
        self.inserted.append(document)
        return SimpleNamespace(inserted_id=document.get("_id"))

    def find_one(self, query, *args, **kwargs):
        self.find_one_calls.append(query)
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
        self.payroll_reimbursements = FakeCollection()
        self.payroll_runs = FakeCollection()

    def __getitem__(self, name):
        return getattr(self, name)


class ValidationTests(unittest.TestCase):
    def test_normalize_period_accepts_year_month(self):
        self.assertEqual(
            normalize_period("2026-07", field_name="period_key"),
            "2026-07",
        )

    def test_normalize_period_rejects_wrong_format(self):
        with self.assertRaises(PayrollReimbursementError) as context:
            normalize_period("07-2026", field_name="period_key")

        self.assertEqual(context.exception.code, "invalid_payroll_period")

    @patch("app.services.payroll_reimbursement_service.find_employee")
    def test_create_reimbursement_creates_itemized_draft(self, mock_find_employee):
        db = FakeDB()
        mock_find_employee.return_value = employee_record()

        result = create_reimbursement(
            db,
            tenant_id=TENANT_ID,
            employee_reference=str(EMPLOYEE_ID),
            payload={
                "type": "travel",
                "purpose": "Client visit",
                "claimed_amount": 1200,
                "items": [claim_item()],
            },
            actor_id="employee-user",
            actor_name="Payroll Employee",
        )

        self.assertEqual(result["status"], "draft")
        self.assertEqual(result["claimed_amount"], 1200)
        self.assertEqual(result["employee_id"], str(EMPLOYEE_ID))
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(len(db.payroll_reimbursements.inserted), 1)

    @patch("app.services.payroll_reimbursement_service.find_employee")
    def test_create_reimbursement_rejects_claim_total_mismatch(self, mock_find_employee):
        db = FakeDB()
        mock_find_employee.return_value = employee_record()

        with self.assertRaises(PayrollReimbursementError) as context:
            create_reimbursement(
                db,
                tenant_id=TENANT_ID,
                employee_reference=str(EMPLOYEE_ID),
                payload={
                    "claimed_amount": 1500,
                    "items": [claim_item(amount=1200)],
                },
            )

        self.assertEqual(context.exception.code, "reimbursement_total_mismatch")

    @patch("app.services.payroll_reimbursement_service.find_employee")
    def test_create_reimbursement_rejects_unknown_type(self, mock_find_employee):
        db = FakeDB()
        mock_find_employee.return_value = employee_record()

        with self.assertRaises(PayrollReimbursementError) as context:
            create_reimbursement(
                db,
                tenant_id=TENANT_ID,
                employee_reference=str(EMPLOYEE_ID),
                payload={
                    "items": [claim_item(type="unsupported_type")],
                },
            )

        self.assertEqual(context.exception.code, "invalid_reimbursement_type")


class WorkflowTests(unittest.TestCase):
    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_only_draft_reimbursement_can_be_edited(self, mock_get):
        db = FakeDB()
        mock_get.return_value = reimbursement_record(status="pending_hr_review")

        with self.assertRaises(PayrollReimbursementError) as context:
            update_reimbursement_draft(
                db,
                tenant_id=TENANT_ID,
                reimbursement_id=str(REIMBURSEMENT_ID),
                payload={"items": [claim_item()]},
            )

        self.assertEqual(context.exception.code, "reimbursement_not_editable")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_submission_requires_receipts_when_enabled(self, mock_get):
        db = FakeDB()
        mock_get.return_value = reimbursement_record(
            items=[claim_item(receipts=[])],
        )

        with self.assertRaises(PayrollReimbursementError) as context:
            submit_reimbursement(
                db,
                tenant_id=TENANT_ID,
                reimbursement_id=str(REIMBURSEMENT_ID),
                receipts_required=True,
            )

        self.assertEqual(context.exception.code, "reimbursement_receipts_required")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_draft_submits_to_hr_review(self, mock_get):
        db = FakeDB()
        draft = reimbursement_record()
        submitted = reimbursement_record(status="pending_hr_review")
        mock_get.return_value = draft
        db.payroll_reimbursements.find_one_and_update_result = submitted

        result = submit_reimbursement(
            db,
            tenant_id=TENANT_ID,
            reimbursement_id=str(REIMBURSEMENT_ID),
            actor_id="employee-user",
            actor_name="Payroll Employee",
        )

        self.assertEqual(result["status"], "pending_hr_review")
        update = db.payroll_reimbursements.update_calls[0][1]
        self.assertEqual(update["$set"]["status"], "pending_hr_review")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_hr_review_moves_claim_to_finance(self, mock_get):
        db = FakeDB()
        record = reimbursement_record(status="pending_hr_review")
        reviewed = reimbursement_record(status="pending_finance_approval")
        mock_get.return_value = record
        db.payroll_reimbursements.find_one_and_update_result = reviewed

        result = complete_hr_review(
            db,
            tenant_id=TENANT_ID,
            reimbursement_id=str(REIMBURSEMENT_ID),
            actor_id="hr-user",
            actor_name="HR User",
        )

        self.assertEqual(result["status"], "pending_finance_approval")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_finance_can_partially_approve_for_payroll(self, mock_get):
        db = FakeDB()
        record = reimbursement_record(status="pending_finance_approval")
        approved = reimbursement_record(
            status="approved",
            claimed_amount=1200,
            approved_amount=1000,
            rejected_amount=200,
            tax_treatment="non_taxable",
            is_taxable=False,
            payment_mode="payroll",
            payroll_period="2026-07",
        )
        mock_get.return_value = record
        db.payroll_reimbursements.find_one_and_update_result = approved

        result = approve_reimbursement(
            db,
            tenant_id=TENANT_ID,
            reimbursement_id=str(REIMBURSEMENT_ID),
            approved_amount=1000,
            tax_treatment="non_taxable",
            payment_mode="payroll",
            payroll_period="2026-07",
            actor_id="finance-user",
            actor_name="Finance User",
        )

        self.assertEqual(result["approved_amount"], 1000)
        update = db.payroll_reimbursements.update_calls[0][1]["$set"]
        self.assertEqual(update["rejected_amount"], 200)
        self.assertFalse(update["is_taxable"])
        self.assertEqual(update["payroll_period"], "2026-07")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_approval_cannot_exceed_claimed_amount(self, mock_get):
        db = FakeDB()
        mock_get.return_value = reimbursement_record(
            status="pending_finance_approval",
            claimed_amount=1200,
        )

        with self.assertRaises(PayrollReimbursementError) as context:
            approve_reimbursement(
                db,
                tenant_id=TENANT_ID,
                reimbursement_id=str(REIMBURSEMENT_ID),
                approved_amount=1200.01,
                tax_treatment="taxable",
                payment_mode="manual",
            )

        self.assertEqual(context.exception.code, "approved_amount_exceeds_claim")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_payroll_approval_requires_period(self, mock_get):
        db = FakeDB()
        mock_get.return_value = reimbursement_record(
            status="pending_finance_approval",
        )

        with self.assertRaises(PayrollReimbursementError) as context:
            approve_reimbursement(
                db,
                tenant_id=TENANT_ID,
                reimbursement_id=str(REIMBURSEMENT_ID),
                approved_amount=1000,
                tax_treatment="non_taxable",
                payment_mode="payroll",
                payroll_period="",
            )

        self.assertEqual(context.exception.code, "reimbursement_payroll_period_required")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_rejection_requires_reason(self, mock_get):
        db = FakeDB()
        mock_get.return_value = reimbursement_record(status="pending_hr_review")

        with self.assertRaises(PayrollReimbursementError) as context:
            reject_reimbursement(
                db,
                tenant_id=TENANT_ID,
                reimbursement_id=str(REIMBURSEMENT_ID),
                reason="",
            )

        self.assertEqual(context.exception.code, "reimbursement_rejection_reason_required")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_hr_or_finance_review_can_reject(self, mock_get):
        db = FakeDB()
        record = reimbursement_record(status="pending_hr_review")
        rejected = reimbursement_record(status="rejected")
        mock_get.return_value = record
        db.payroll_reimbursements.find_one_and_update_result = rejected

        result = reject_reimbursement(
            db,
            tenant_id=TENANT_ID,
            reimbursement_id=str(REIMBURSEMENT_ID),
            reason="Receipt is unreadable.",
        )

        self.assertEqual(result["status"], "rejected")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_paid_reimbursement_cannot_be_cancelled(self, mock_get):
        db = FakeDB()
        mock_get.return_value = reimbursement_record(status="paid")

        with self.assertRaises(PayrollReimbursementError) as context:
            cancel_reimbursement(
                db,
                tenant_id=TENANT_ID,
                reimbursement_id=str(REIMBURSEMENT_ID),
                reason="No longer needed.",
            )

        self.assertEqual(context.exception.code, "reimbursement_not_cancellable")


class PayrollResolutionTests(unittest.TestCase):
    @patch("app.services.payroll_reimbursement_service.find_employee")
    def test_resolve_payroll_reimbursements_preserves_tax_treatment(self, mock_find):
        db = FakeDB()
        mock_find.return_value = employee_record()
        db.payroll_reimbursements.find_result = FakeCursor([
            reimbursement_record(
                status="approved",
                approved_amount=1000,
                payment_mode="payroll",
                payroll_period="2026-07",
                tax_treatment="non_taxable",
                is_taxable=False,
            ),
            reimbursement_record(
                _id=ObjectId("64b64c5d8f4b2a0012345681"),
                status="approved",
                approved_amount=500,
                payment_mode="payroll",
                payroll_period="2026-07",
                tax_treatment="taxable",
                is_taxable=True,
                type="mobile_internet",
                label="Internet Reimbursement",
            ),
        ])

        rows = resolve_payroll_reimbursements(
            db,
            tenant_id=TENANT_ID,
            employee_reference=str(EMPLOYEE_ID),
            period_key="2026-07",
            run_id=str(RUN_ID),
        )

        self.assertEqual(len(rows), 2)
        self.assertFalse(rows[0]["lwp_proratable"])
        self.assertFalse(rows[0]["include_in_taxable_income"])
        self.assertTrue(rows[1]["include_in_taxable_income"])

    @patch("app.services.payroll_reimbursement_service.find_employee")
    def test_scheduled_reimbursement_for_another_run_is_excluded(self, mock_find):
        db = FakeDB()
        mock_find.return_value = employee_record()
        db.payroll_reimbursements.find_result = FakeCursor([
            reimbursement_record(
                status="scheduled",
                scheduled_run_id="another-run",
                approved_amount=1000,
                payment_mode="payroll",
                payroll_period="2026-07",
                tax_treatment="non_taxable",
                is_taxable=False,
            )
        ])

        rows = resolve_payroll_reimbursements(
            db,
            tenant_id=TENANT_ID,
            employee_reference=str(EMPLOYEE_ID),
            period_key="2026-07",
            run_id=str(RUN_ID),
        )

        self.assertEqual(rows, [])

    def test_reimbursement_summary_separates_taxable_and_non_taxable(self):
        summary = summarize_payroll_reimbursements([
            {
                "reference_id": "r1",
                "amount": 1000,
                "tax_treatment": "non_taxable",
                "is_taxable": False,
            },
            {
                "reference_id": "r2",
                "amount": 500.50,
                "tax_treatment": "taxable",
                "is_taxable": True,
            },
        ])

        self.assertEqual(summary["non_taxable_total"], 1000)
        self.assertEqual(summary["taxable_total"], 500.5)
        self.assertEqual(summary["total"], 1500.5)
        self.assertEqual(summary["count"], 2)


class PayrollPersistenceTests(unittest.TestCase):
    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    @patch("app.services.payroll_reimbursement_service._find_payroll_run")
    def test_reserve_reimbursement_creates_immutable_snapshot(self, mock_run, mock_get):
        db = FakeDB()
        mock_run.return_value = {
            "_id": RUN_ID,
            "tenant_id": TENANT_ID,
            "status": "draft",
        }
        record = reimbursement_record(
            status="approved",
            approved_amount=1000,
            payment_mode="payroll",
            payroll_period="2026-07",
            tax_treatment="non_taxable",
            is_taxable=False,
        )
        mock_get.return_value = record
        db.payroll_reimbursements.find_one_and_update_result = reimbursement_record(
            status="scheduled",
        )

        result = reserve_payroll_reimbursements(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            period_key="2026-07",
            employee_id=str(EMPLOYEE_ID),
            reimbursement_details=[{
                "reference_id": str(REIMBURSEMENT_ID),
                "amount": 1000,
            }],
            payslip_id="payslip-1",
        )

        self.assertEqual(result["totals"]["reserved"], 1)
        self.assertEqual(result["totals"]["amount_reserved"], 1000)
        update = db.payroll_reimbursements.update_calls[0][1]["$set"]
        self.assertEqual(update["status"], "scheduled")
        self.assertEqual(update["payroll_snapshot"]["run_id"], str(RUN_ID))

    @patch("app.services.payroll_reimbursement_service._find_payroll_run")
    def test_locked_payroll_blocks_reimbursement_reservation(self, mock_run):
        db = FakeDB()
        mock_run.return_value = {
            "_id": RUN_ID,
            "tenant_id": TENANT_ID,
            "status": "locked",
        }

        with self.assertRaises(PayrollReimbursementError) as context:
            reserve_payroll_reimbursements(
                db,
                tenant_id=TENANT_ID,
                run_id=str(RUN_ID),
                period_key="2026-07",
                employee_id=str(EMPLOYEE_ID),
                reimbursement_details=[],
            )

        self.assertEqual(context.exception.code, "locked_payroll_reimbursement_immutable")

    @patch("app.services.payroll_reimbursement_service._find_payroll_run")
    def test_locked_payroll_blocks_release(self, mock_run):
        db = FakeDB()
        mock_run.return_value = {
            "_id": RUN_ID,
            "tenant_id": TENANT_ID,
            "status": "disbursed",
        }

        with self.assertRaises(PayrollReimbursementError) as context:
            release_payroll_reimbursements(
                db,
                tenant_id=TENANT_ID,
                run_id=str(RUN_ID),
            )

        self.assertEqual(context.exception.code, "locked_payroll_reimbursement_immutable")

    @patch("app.services.payroll_reimbursement_service._find_payroll_run")
    def test_payment_application_requires_disbursed_run(self, mock_run):
        db = FakeDB()
        mock_run.return_value = {
            "_id": RUN_ID,
            "tenant_id": TENANT_ID,
            "status": "locked",
        }

        with self.assertRaises(PayrollReimbursementError) as context:
            apply_payroll_reimbursement_payments(
                db,
                tenant_id=TENANT_ID,
                run_id=str(RUN_ID),
                period_key="2026-07",
            )

        self.assertEqual(context.exception.code, "payroll_run_not_disbursed")

    @patch("app.services.payroll_reimbursement_service._find_payroll_run")
    def test_disbursed_payroll_marks_scheduled_reimbursement_paid(self, mock_run):
        db = FakeDB()
        mock_run.return_value = {
            "_id": RUN_ID,
            "tenant_id": TENANT_ID,
            "status": "disbursed",
        }
        db.payroll_reimbursements.find_result = FakeCursor([
            reimbursement_record(
                status="scheduled",
                scheduled_run_id=str(RUN_ID),
                scheduled_period="2026-07",
                scheduled_payslip_id="payslip-1",
                approved_amount=1000,
            )
        ])
        db.payroll_reimbursements.find_one_and_update_result = reimbursement_record(
            status="paid",
            approved_amount=1000,
        )

        result = apply_payroll_reimbursement_payments(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            period_key="2026-07",
            actor_id="finance-user",
            actor_name="Finance User",
        )

        self.assertEqual(result["totals"]["paid"], 1)
        self.assertEqual(result["totals"]["amount_paid"], 1000)
        update = db.payroll_reimbursements.update_calls[0][1]["$set"]
        self.assertEqual(update["status"], "paid")


class ManualPaymentAndScheduleTests(unittest.TestCase):
    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_payroll_mode_claim_cannot_be_marked_manually_paid(self, mock_get):
        db = FakeDB()
        mock_get.return_value = reimbursement_record(
            status="approved",
            payment_mode="payroll",
            approved_amount=1000,
        )

        with self.assertRaises(PayrollReimbursementError) as context:
            mark_manual_reimbursement_paid(
                db,
                tenant_id=TENANT_ID,
                reimbursement_id=str(REIMBURSEMENT_ID),
                payment_date="2026-07-31",
                payment_reference="UTR-1",
            )

        self.assertEqual(context.exception.code, "reimbursement_not_manual_payment")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_manual_payment_records_reference_and_paid_status(self, mock_get):
        db = FakeDB()
        record = reimbursement_record(
            status="approved",
            payment_mode="manual",
            approved_amount=1000,
        )
        paid = reimbursement_record(
            status="paid",
            payment_mode="manual",
            approved_amount=1000,
        )
        mock_get.return_value = record
        db.payroll_reimbursements.find_one_and_update_result = paid

        result = mark_manual_reimbursement_paid(
            db,
            tenant_id=TENANT_ID,
            reimbursement_id=str(REIMBURSEMENT_ID),
            payment_date="2026-07-31",
            payment_reference="UTR-1",
            actor_id="finance-user",
            actor_name="Finance User",
        )

        self.assertEqual(result["status"], "paid")
        payment = db.payroll_reimbursements.update_calls[0][1]["$set"]["payment"]
        self.assertEqual(payment["payment_reference"], "UTR-1")
        self.assertEqual(payment["payment_date"], "2026-07-31")

    @patch("app.services.payroll_reimbursement_service.get_reimbursement")
    def test_reserved_claim_schedule_is_immutable(self, mock_get):
        db = FakeDB()
        mock_get.return_value = reimbursement_record(
            status="approved",
            payment_mode="payroll",
            payroll_period="2026-07",
            payroll_snapshot={"run_id": str(RUN_ID)},
        )

        with self.assertRaises(PayrollReimbursementError) as context:
            revise_reimbursement_schedule(
                db,
                tenant_id=TENANT_ID,
                reimbursement_id=str(REIMBURSEMENT_ID),
                payment_mode="payroll",
                payroll_period="2026-08",
            )

        self.assertEqual(context.exception.code, "scheduled_reimbursement_immutable")

    @patch("app.services.payroll_reimbursement_service.find_employee")
    def test_list_reimbursements_filters_employee_and_status(self, mock_find):
        db = FakeDB()
        mock_find.return_value = employee_record()
        db.payroll_reimbursements.find_result = FakeCursor([
            reimbursement_record(status="approved")
        ])

        rows = list_reimbursements(
            db,
            tenant_id=TENANT_ID,
            employee_reference=str(EMPLOYEE_ID),
            statuses=["approved"],
            reimbursement_types=["travel"],
            payroll_period="2026-07",
            payment_mode="payroll",
            limit=50,
        )

        self.assertEqual(len(rows), 1)
        query = db.payroll_reimbursements.find_calls[0]
        self.assertEqual(query["employee_id"], str(EMPLOYEE_ID))
        self.assertEqual(query["status"], {"$in": ["approved"]})
        self.assertEqual(query["type"], {"$in": ["travel"]})
        self.assertEqual(query["payroll_period"], "2026-07")


if __name__ == "__main__":
    unittest.main()