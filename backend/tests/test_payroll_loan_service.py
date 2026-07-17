from __future__ import annotations

import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from bson import ObjectId
from pymongo import ReturnDocument

from app.services.payroll_loan_service import (
    PayrollLoanError,
    _deduction_for_period,
    apply_payroll_recoveries,
    approve_loan_advance,
    build_payslip_advance_rows,
    cancel_loan_advance,
    create_loan_advance,
    disburse_loan_advance,
    normalize_period,
    reject_loan_advance,
    resolve_payroll_deductions,
    revise_recovery_terms,
    submit_loan_advance,
    update_loan_advance_draft,
)


TENANT_ID = "tenant-payroll"
EMPLOYEE_ID = ObjectId("64b64c5d8f4b2a0012345678")
LOAN_ID = ObjectId("64b64c5d8f4b2a0012345679")
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


def loan_record(**overrides):
    row = {
        "_id": LOAN_ID,
        "tenant_id": TENANT_ID,
        "employee_id": str(EMPLOYEE_ID),
        "employee_code": "SDS-001",
        "employee_name": "Payroll Employee",
        "type": "personal_advance",
        "loan_type": "personal_advance",
        "category": "advance",
        "label": "Personal Advance",
        "requested_amount": 10000,
        "approved_amount": 10000,
        "interest_amount": 0,
        "recoverable_amount": 10000,
        "emi_amount": 2000,
        "deduction_amount": 2000,
        "remaining_balance": 10000,
        "recovered_amount": 0,
        "recovery_start_period": "2026-07",
        "recovery_end_period": "",
        "custom_installments": [],
        "hold_periods": [],
        "recovery_term_revisions": [],
        "recovery_history": [],
        "status": "draft",
        "workflow_history": [],
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
        self.loans_advances = FakeCollection()
        self.payroll_runs = FakeCollection()
        self.payslips = FakeCollection()

    def __getitem__(self, name):
        return getattr(self, name)


class ValidationTests(unittest.TestCase):
    def test_normalize_period_accepts_year_month(self):
        self.assertEqual(
            normalize_period("2026-07", field_name="period_key"),
            "2026-07",
        )

    def test_normalize_period_rejects_wrong_format(self):
        with self.assertRaises(PayrollLoanError) as context:
            normalize_period("07-2026", field_name="period_key")

        self.assertEqual(context.exception.code, "invalid_payroll_period")

    @patch("app.services.payroll_loan_service.find_employee")
    def test_create_loan_advance_creates_draft_with_employee_snapshot(
        self,
        mock_find_employee,
    ):
        db = FakeDB()
        mock_find_employee.return_value = employee_record()

        result = create_loan_advance(
            db,
            tenant_id=TENANT_ID,
            employee_reference="SDS-001",
            payload={
                "type": "personal",
                "amount": 12000,
                "emi_amount": 2000,
                "purpose": "Emergency expense",
            },
            actor_id="user-1",
            actor_name="Finance User",
        )

        self.assertEqual(result["status"], "draft")
        self.assertEqual(result["type"], "personal_advance")
        self.assertEqual(result["employee_id"], str(EMPLOYEE_ID))
        self.assertEqual(result["requested_amount"], 12000)
        self.assertEqual(result["remaining_balance"], 12000)
        self.assertEqual(len(db.loans_advances.inserted), 1)

    @patch("app.services.payroll_loan_service.find_employee")
    def test_create_rejects_unsupported_type(self, mock_find_employee):
        db = FakeDB()
        mock_find_employee.return_value = employee_record()

        with self.assertRaises(PayrollLoanError) as context:
            create_loan_advance(
                db,
                tenant_id=TENANT_ID,
                employee_reference="SDS-001",
                payload={"type": "crypto_loan", "amount": 5000},
            )

        self.assertEqual(context.exception.code, "invalid_payroll_loan_type")


class WorkflowTests(unittest.TestCase):
    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_update_draft_is_blocked_after_submission(self, mock_get):
        db = FakeDB()
        mock_get.return_value = loan_record(status="pending_approval")

        with self.assertRaises(PayrollLoanError) as context:
            update_loan_advance_draft(
                db,
                tenant_id=TENANT_ID,
                loan_advance_id=str(LOAN_ID),
                payload={"amount": 12000},
            )

        self.assertEqual(context.exception.code, "payroll_loan_not_editable")

    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_submit_moves_draft_to_pending_approval(self, mock_get):
        db = FakeDB()
        mock_get.return_value = loan_record(status="draft")
        db.loans_advances.find_one_and_update_result = loan_record(
            status="pending_approval"
        )

        result = submit_loan_advance(
            db,
            tenant_id=TENANT_ID,
            loan_advance_id=str(LOAN_ID),
            actor_id="user-1",
            actor_name="Employee",
        )

        self.assertEqual(result["status"], "pending_approval")
        _, update, kwargs = db.loans_advances.update_calls[0]
        self.assertEqual(update["$set"]["status"], "pending_approval")
        self.assertEqual(kwargs["return_document"], ReturnDocument.AFTER)

    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_approve_sets_recoverable_amount_and_emi(self, mock_get):
        db = FakeDB()
        mock_get.return_value = loan_record(
            status="pending_approval",
            approved_amount=0,
            recoverable_amount=10000,
        )
        db.loans_advances.find_one_and_update_result = loan_record(
            status="approved",
            approved_amount=10000,
            interest_amount=500,
            recoverable_amount=10500,
            remaining_balance=10500,
            emi_amount=2500,
        )

        result = approve_loan_advance(
            db,
            tenant_id=TENANT_ID,
            loan_advance_id=str(LOAN_ID),
            approved_amount=10000,
            interest_amount=500,
            emi_amount=2500,
            recovery_start_period="2026-08",
            actor_id="finance-1",
            actor_name="Finance Approver",
        )

        self.assertEqual(result["status"], "approved")
        self.assertEqual(result["recoverable_amount"], 10500)
        self.assertEqual(result["remaining_balance"], 10500)
        self.assertEqual(result["emi_amount"], 2500)

    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_approve_requires_recovery_start_period(self, mock_get):
        db = FakeDB()
        mock_get.return_value = loan_record(status="pending_approval")

        with self.assertRaises(PayrollLoanError) as context:
            approve_loan_advance(
                db,
                tenant_id=TENANT_ID,
                loan_advance_id=str(LOAN_ID),
                approved_amount=10000,
                emi_amount=2000,
                recovery_start_period="",
            )

        self.assertEqual(context.exception.code, "recovery_start_period_required")

    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_reject_requires_reason(self, mock_get):
        db = FakeDB()
        mock_get.return_value = loan_record(status="pending_approval")

        with self.assertRaises(PayrollLoanError) as context:
            reject_loan_advance(
                db,
                tenant_id=TENANT_ID,
                loan_advance_id=str(LOAN_ID),
                reason="",
            )

        self.assertEqual(
            context.exception.code,
            "payroll_loan_rejection_reason_required",
        )

    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_disburse_moves_approved_record_to_disbursed(self, mock_get):
        db = FakeDB()
        mock_get.return_value = loan_record(status="approved")
        db.loans_advances.find_one_and_update_result = loan_record(
            status="disbursed",
            disbursement={
                "transfer_date": "2026-07-31",
                "transfer_mode": "NEFT",
            },
        )

        result = disburse_loan_advance(
            db,
            tenant_id=TENANT_ID,
            loan_advance_id=str(LOAN_ID),
            transfer_date="2026-07-31",
            transfer_mode="neft",
            transaction_reference="UTR-123",
            actor_id="finance-1",
            actor_name="Finance User",
        )

        self.assertEqual(result["status"], "disbursed")
        self.assertEqual(result["disbursement"]["transfer_mode"], "NEFT")

    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_disbursed_record_cannot_be_cancelled(self, mock_get):
        db = FakeDB()
        mock_get.return_value = loan_record(status="disbursed")

        with self.assertRaises(PayrollLoanError) as context:
            cancel_loan_advance(
                db,
                tenant_id=TENANT_ID,
                loan_advance_id=str(LOAN_ID),
                reason="No longer required",
            )

        self.assertEqual(context.exception.code, "payroll_loan_not_cancellable")


class DeductionTests(unittest.TestCase):
    def test_final_emi_is_capped_to_remaining_balance(self):
        amount = _deduction_for_period(
            loan_record(
                status="recovering",
                remaining_balance=750,
                emi_amount=2000,
            ),
            "2026-09",
        )

        self.assertEqual(amount, Decimal("750.00"))

    def test_deduction_is_zero_before_recovery_start_period(self):
        amount = _deduction_for_period(
            loan_record(
                status="disbursed",
                recovery_start_period="2026-09",
            ),
            "2026-08",
        )

        self.assertEqual(amount, Decimal("0"))

    def test_hold_period_prevents_deduction(self):
        amount = _deduction_for_period(
            loan_record(
                status="recovering",
                hold_periods=["2026-09"],
            ),
            "2026-09",
        )

        self.assertEqual(amount, Decimal("0"))

    def test_custom_installment_overrides_regular_emi(self):
        amount = _deduction_for_period(
            loan_record(
                status="recovering",
                emi_amount=2000,
                custom_installments=[{
                    "period_key": "2026-09",
                    "amount": 3500,
                    "status": "scheduled",
                }],
            ),
            "2026-09",
        )

        self.assertEqual(amount, Decimal("3500.00"))

    @patch("app.services.payroll_loan_service.find_employee")
    def test_resolve_payroll_deductions_skips_same_run_twice(
        self,
        mock_find_employee,
    ):
        db = FakeDB()
        mock_find_employee.return_value = employee_record()
        db.loans_advances.find_result = FakeCursor([
            loan_record(
                status="recovering",
                recovery_history=[{
                    "run_id": str(RUN_ID),
                    "status": "applied",
                }],
            )
        ])

        result = resolve_payroll_deductions(
            db,
            tenant_id=TENANT_ID,
            employee_reference="SDS-001",
            period_key="2026-09",
            run_id=str(RUN_ID),
        )

        self.assertEqual(result, [])

    @patch("app.services.payroll_loan_service.find_employee")
    def test_resolve_payroll_deductions_returns_payslip_snapshot(
        self,
        mock_find_employee,
    ):
        db = FakeDB()
        mock_find_employee.return_value = employee_record()
        db.loans_advances.find_result = FakeCursor([
            loan_record(
                status="recovering",
                remaining_balance=5000,
                emi_amount=2000,
            )
        ])

        result = resolve_payroll_deductions(
            db,
            tenant_id=TENANT_ID,
            employee_reference="SDS-001",
            period_key="2026-09",
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["deduction_amount"], 2000)
        self.assertEqual(result[0]["remaining_balance_after_deduction"], 3000)
        self.assertEqual(result[0]["reference_id"], str(LOAN_ID))


class RecoveryRevisionTests(unittest.TestCase):
    @patch("app.services.payroll_loan_service._locked_reference_periods")
    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_revision_cannot_change_locked_payroll_period(
        self,
        mock_get,
        mock_locked_periods,
    ):
        db = FakeDB()
        mock_get.return_value = loan_record(status="recovering")
        mock_locked_periods.return_value = ["2026-08"]

        with self.assertRaises(PayrollLoanError) as context:
            revise_recovery_terms(
                db,
                tenant_id=TENANT_ID,
                loan_advance_id=str(LOAN_ID),
                effective_from_period="2026-08",
                emi_amount=1500,
            )

        self.assertEqual(
            context.exception.code,
            "locked_payroll_deduction_immutable",
        )

    @patch("app.services.payroll_loan_service._locked_reference_periods")
    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_future_recovery_revision_is_saved(
        self,
        mock_get,
        mock_locked_periods,
    ):
        db = FakeDB()
        mock_get.return_value = loan_record(
            status="recovering",
            remaining_balance=5000,
        )
        mock_locked_periods.return_value = ["2026-08"]
        db.loans_advances.find_one_and_update_result = loan_record(
            status="recovering",
            recovery_term_revisions=[{
                "effective_from_period": "2026-09",
                "emi_amount": 1500,
            }],
        )

        result = revise_recovery_terms(
            db,
            tenant_id=TENANT_ID,
            loan_advance_id=str(LOAN_ID),
            effective_from_period="2026-09",
            emi_amount=1500,
            actor_id="finance-1",
            actor_name="Finance User",
        )

        self.assertEqual(
            result["recovery_term_revisions"][0]["effective_from_period"],
            "2026-09",
        )


class RecoveryApplicationTests(unittest.TestCase):
    def test_recovery_requires_disbursed_payroll_run(self):
        db = FakeDB()
        db.payroll_runs.find_one_result = {
            "_id": RUN_ID,
            "tenant_id": TENANT_ID,
            "status": "locked",
            "period_key": "2026-09",
        }

        with self.assertRaises(PayrollLoanError) as context:
            apply_payroll_recoveries(
                db,
                tenant_id=TENANT_ID,
                run_id=str(RUN_ID),
                period_key="2026-09",
                payslips=[],
            )

        self.assertEqual(context.exception.code, "payroll_run_not_disbursed")

    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_recovery_applies_balance_and_closes_final_installment(self, mock_get):
        db = FakeDB()
        db.payroll_runs.find_one_result = {
            "_id": RUN_ID,
            "tenant_id": TENANT_ID,
            "status": "disbursed",
            "period_key": "2026-09",
        }
        mock_get.return_value = loan_record(
            status="recovering",
            remaining_balance=750,
            recovered_amount=9250,
        )
        db.loans_advances.find_one_and_update_result = loan_record(
            status="closed",
            remaining_balance=0,
            recovered_amount=10000,
        )

        result = apply_payroll_recoveries(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            period_key="2026-09",
            payslips=[{
                "_id": ObjectId(),
                "employee_id": str(EMPLOYEE_ID),
                "advance_details": [{
                    "reference_id": str(LOAN_ID),
                    "deduction_amount": 750,
                }],
            }],
            actor_id="finance-1",
            actor_name="Finance User",
        )

        self.assertEqual(result["totals"]["recoveries_applied"], 1)
        self.assertEqual(result["totals"]["amount_recovered"], 750)
        self.assertEqual(result["applied"][0]["remaining_balance"], 0)
        self.assertEqual(result["applied"][0]["status"], "closed")

    @patch("app.services.payroll_loan_service.get_loan_advance")
    def test_duplicate_recovery_is_skipped(self, mock_get):
        db = FakeDB()
        db.payroll_runs.find_one_result = {
            "_id": RUN_ID,
            "tenant_id": TENANT_ID,
            "status": "disbursed",
            "period_key": "2026-09",
        }
        mock_get.return_value = loan_record(
            status="recovering",
            recovery_history=[{
                "run_id": str(RUN_ID),
                "status": "applied",
            }],
        )

        result = apply_payroll_recoveries(
            db,
            tenant_id=TENANT_ID,
            run_id=str(RUN_ID),
            period_key="2026-09",
            payslips=[{
                "employee_id": str(EMPLOYEE_ID),
                "advance_details": [{
                    "reference_id": str(LOAN_ID),
                    "deduction_amount": 2000,
                }],
            }],
        )

        self.assertEqual(result["totals"]["recoveries_applied"], 0)
        self.assertEqual(result["totals"]["recoveries_skipped"], 1)


class PayslipAdvanceRowsTests(unittest.TestCase):
    def test_payslip_rows_always_return_work_tour_personal_order(self):
        result = build_payslip_advance_rows([
            {
                "type": "personal_advance",
                "reference_id": str(LOAN_ID),
                "advance_amount": 10000,
                "deduction_amount": 2000,
                "remaining_balance_after_deduction": 8000,
            },
            {
                "type": "work_advance",
                "advance_amount": 5000,
                "deduction_amount": 500,
            },
        ])

        self.assertEqual(
            [row["label"] for row in result],
            ["Work Advance", "Tour Advance", "Personal Advance"],
        )
        self.assertEqual(result[0]["deduction_amount"], 500)
        self.assertEqual(result[1]["deduction_amount"], 0)
        self.assertEqual(result[2]["pending_balance"], 8000)


if __name__ == "__main__":
    unittest.main()