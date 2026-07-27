from __future__ import annotations

import csv
import hashlib
import io
import unittest
from datetime import UTC, datetime
from types import SimpleNamespace

from bson import ObjectId
from pymongo import ReturnDocument

from app.services.payroll_reporting_service import (
    PayrollReportingError,
    canonical_payroll_status,
    department_summary,
    employee_statement,
    generate_payroll_report_csv,
    list_payroll_report_exports,
    normalize_report_type,
    normalize_statuses,
    parse_period,
    payroll_register,
    payroll_register_row,
    payroll_status_query_values,
    payroll_summary,
    payroll_trend,
    period_range,
    period_variance,
    statutory_summary,
    summarize_register_rows,
    update_payroll_report_export_status,
)


TENANT_ID = "tenant-payroll"
EMPLOYEE_ID = "employee-1"
SECOND_EMPLOYEE_ID = "employee-2"
THIRD_EMPLOYEE_ID = "employee-3"
RUN_ID = "run-2026-07"
EXPORT_ID = ObjectId("64b64c5d8f4b2a0012345690")


def payslip_record(**overrides):
    row = {
        "_id": ObjectId(),
        "tenant_id": TENANT_ID,
        "run_id": RUN_ID,
        "period_key": "2026-07",
        "month": 7,
        "year": 2026,
        "employee_id": EMPLOYEE_ID,
        "employee_code": "SDS-001",
        "employee_name": "Payroll Employee",
        "employee_info": {
            "employee_id": EMPLOYEE_ID,
            "employee_code": "SDS-001",
            "name": "Payroll Employee",
            "official_email": "payroll@example.com",
            "department": "IT",
            "function": "IT",
            "designation": "Software Engineer",
            "location": "Guwahati",
            "date_of_joining": "2025-01-15",
            "pan": "ABCDE1234F",
            "uan": "100200300400",
            "esi_number": "ESI-001",
            "pran": "PRAN-001",
        },
        "state_code": "AS",
        "status": "locked",
        "workflow_stage": "locked",
        "is_locked": True,
        "currency": "INR",
        "attendance": {
            "working_days": 26,
            "present_days": 24,
            "paid_leave_days": 1,
            "salary_paid_days": 25,
            "lwp_days": 1,
        },
        "earnings": [
            {"key": "basic", "amount": 18000},
            {"key": "hra", "amount": 8000},
        ],
        "deductions": [
            {"key": "pf_employee", "amount": 1800},
            {"key": "professional_tax", "amount": 208},
            {"key": "tds", "amount": 500},
            {"key": "advances", "amount": 1000},
            {"key": "lwp_deduction", "amount": 1000},
        ],
        "employer_contributions": [
            {"key": "pf_employer", "amount": 1800},
            {"key": "esi_employer", "amount": 0},
        ],
        "reimbursement_summary": {
            "taxable_amount": 500,
            "non_taxable_amount": 1500,
        },
        "totals": {
            "monthly_ctc_configured": 32800,
            "gross_salary": 30000,
            "payable_gross_salary": 29000,
            "lwp_deduction": 1000,
            "pf_employee": 1800,
            "pf_employer": 1800,
            "esi_employee": 0,
            "esi_employer": 0,
            "professional_tax": 208,
            "tds": 500,
            "advances": 1000,
            "reimbursements": 2000,
            "taxable_reimbursements": 500,
            "non_taxable_reimbursements": 1500,
            "total_deductions": 3508,
            "net_amount": 27492,
            "cost_to_company": 31800,
            "total_payroll_cost": 31800,
        },
        "bank_details_snapshot": {
            "bank_name": "State Bank of India",
            "masked_account_number": "********9012",
            "payment_method": "neft",
        },
        "calculated_at": datetime(2026, 7, 30, 9, 0, tzinfo=UTC),
        "locked_at": datetime(2026, 7, 31, 10, 0, tzinfo=UTC),
        "disbursed_at": None,
        "is_deleted": False,
    }
    row.update(overrides)
    return row


def second_payslip(**overrides):
    employee_info = {
        **payslip_record()["employee_info"],
        "employee_id": SECOND_EMPLOYEE_ID,
        "employee_code": "SDS-002",
        "name": "Finance Employee",
        "official_email": "finance@example.com",
        "department": "Finance",
        "function": "Finance",
        "designation": "Accountant",
        "location": "Mangaldoi",
    }
    totals = {
        **payslip_record()["totals"],
        "monthly_ctc_configured": 25200,
        "gross_salary": 24000,
        "payable_gross_salary": 24000,
        "lwp_deduction": 0,
        "pf_employee": 1440,
        "pf_employer": 1440,
        "professional_tax": 180,
        "tds": 0,
        "advances": 0,
        "reimbursements": 1000,
        "taxable_reimbursements": 0,
        "non_taxable_reimbursements": 1000,
        "total_deductions": 1620,
        "net_amount": 23380,
        "cost_to_company": 25440,
        "total_payroll_cost": 25440,
    }
    row = payslip_record(
        _id=ObjectId(),
        employee_id=SECOND_EMPLOYEE_ID,
        employee_code="SDS-002",
        employee_name="Finance Employee",
        employee_info=employee_info,
        state_code="AS",
        attendance={
            "working_days": 26,
            "present_days": 26,
            "paid_leave_days": 0,
            "salary_paid_days": 26,
            "lwp_days": 0,
        },
        totals=totals,
        reimbursement_summary={
            "taxable_amount": 0,
            "non_taxable_amount": 1000,
        },
    )
    row.update(overrides)
    return row


class FakeCursor(list):
    def sort(self, *args, **kwargs):
        return self

    def limit(self, value):
        return FakeCursor(self[:value])


class FakeCollection:
    def __init__(self, find_rows=None):
        self.find_rows = FakeCursor(find_rows or [])
        self.find_calls = []
        self.find_one_and_update_result = None
        self.update_calls = []

    def find(self, query, *args, **kwargs):
        self.find_calls.append(query)
        return FakeCursor(self.find_rows)

    def find_one_and_update(self, query, update, **kwargs):
        self.update_calls.append((query, update, kwargs))
        return self.find_one_and_update_result


class FakeDB:
    def __init__(self, payslips=None):
        self.payslips = FakeCollection(payslips)
        self.payroll_report_exports = FakeCollection()

    def __getitem__(self, name):
        return getattr(self, name)


class PeriodAndStatusValidationTests(unittest.TestCase):
    def test_parse_period_accepts_year_month(self):
        self.assertEqual(parse_period("2026-07"), "2026-07")

    def test_parse_period_rejects_invalid_month(self):
        with self.assertRaises(PayrollReportingError) as context:
            parse_period("2026-13")

        self.assertEqual(context.exception.code, "invalid_payroll_report_period")

    def test_period_range_is_inclusive_across_year_boundary(self):
        self.assertEqual(
            period_range("2025-11", "2026-02"),
            ["2025-11", "2025-12", "2026-01", "2026-02"],
        )

    def test_period_range_rejects_reversed_range(self):
        with self.assertRaises(PayrollReportingError) as context:
            period_range("2026-08", "2026-07")

        self.assertEqual(
            context.exception.code,
            "invalid_payroll_report_period_range",
        )

    def test_official_statuses_are_default(self):
        self.assertEqual(
            set(normalize_statuses(None, official_only=True)),
            {"locked", "disbursed"},
        )

    def test_internal_reporting_can_include_all_stages(self):
        statuses = normalize_statuses(None, official_only=False)
        self.assertIn("draft", statuses)
        self.assertIn("finance_approved", statuses)
        self.assertIn("locked", statuses)

    def test_invalid_status_is_rejected(self):
        with self.assertRaises(PayrollReportingError) as context:
            normalize_statuses(["deleted"], official_only=False)

        self.assertEqual(context.exception.code, "invalid_payroll_report_status")

    def test_legacy_statuses_are_normalized_to_canonical_workflow(self):
        expected = {
            "pending_hr_review": "draft",
            "hr_review": "hr_reviewed",
            "reviewed": "hr_reviewed",
            "pending_finance_approval": "hr_reviewed",
            "finance_approval_pending": "hr_reviewed",
            "approved": "finance_approved",
        }

        for legacy_status, canonical_status in expected.items():
            with self.subTest(legacy_status=legacy_status):
                self.assertEqual(
                    canonical_payroll_status(legacy_status),
                    canonical_status,
                )

    def test_canonical_statuses_remain_unchanged(self):
        canonical_statuses = [
            "draft",
            "hr_reviewed",
            "finance_approved",
            "locked",
            "disbursed",
        ]

        self.assertEqual(
            [canonical_payroll_status(item) for item in canonical_statuses],
            canonical_statuses,
        )

    def test_normalize_statuses_accepts_legacy_values_and_deduplicates(self):
        self.assertEqual(
            normalize_statuses(
                [
                    "pending_hr_review",
                    "draft",
                    "pending_finance_approval",
                    "reviewed",
                    "approved",
                ],
                official_only=False,
            ),
            ["draft", "finance_approved", "hr_reviewed"],
        )

    def test_status_query_expansion_includes_historical_database_values(self):
        values = set(
            payroll_status_query_values(
                ["draft", "hr_reviewed", "finance_approved"]
            )
        )

        self.assertEqual(
            values,
            {
                "draft",
                "pending_hr_review",
                "hr_reviewed",
                "hr_review",
                "reviewed",
                "pending_finance_approval",
                "finance_approval_pending",
                "finance_approved",
                "approved",
            },
        )

    def test_report_type_alias_and_invalid_value(self):
        self.assertEqual(normalize_report_type("variance"), "period_variance")

        with self.assertRaises(PayrollReportingError) as context:
            normalize_report_type("unknown")

        self.assertEqual(context.exception.code, "invalid_payroll_report_type")


class RegisterRowTests(unittest.TestCase):
    def test_register_row_extracts_payroll_and_employee_fields(self):
        row = payroll_register_row(payslip_record())

        self.assertEqual(row["employee_code"], "SDS-001")
        self.assertEqual(row["department"], "IT")
        self.assertEqual(row["gross_salary"], 30000)
        self.assertEqual(row["net_amount"], 27492)
        self.assertEqual(row["lwp_days"], 1)
        self.assertEqual(row["reimbursements"], 2000)
        self.assertEqual(row["masked_account_number"], "********9012")
        self.assertTrue(row["bank_snapshot_available"])

    def test_register_row_exposes_only_canonical_statuses(self):
        source = payslip_record(
            status="pending_finance_approval",
            workflow_stage="approved",
        )

        row = payroll_register_row(source)

        self.assertEqual(row["status"], "hr_reviewed")
        self.assertEqual(row["workflow_stage"], "finance_approved")

    def test_register_row_uses_line_item_fallbacks(self):
        source = payslip_record()
        source["totals"] = {
            "payable_gross_salary": 29000,
            "reimbursements": 0,
            "total_deductions": 3508,
            "net_amount": 25492,
            "cost_to_company": 31800,
        }
        row = payroll_register_row(source)

        self.assertEqual(row["pf_employee"], 1800)
        self.assertEqual(row["pf_employer"], 1800)
        self.assertEqual(row["professional_tax"], 208)
        self.assertEqual(row["tds"], 500)
        self.assertEqual(row["advances"], 1000)
        self.assertEqual(row["lwp_deduction"], 1000)

    def test_summarize_register_rows_totals_distinct_employees(self):
        rows = [
            payroll_register_row(payslip_record()),
            payroll_register_row(second_payslip()),
        ]
        totals = summarize_register_rows(rows)

        self.assertEqual(totals["row_count"], 2)
        self.assertEqual(totals["employee_count"], 2)
        self.assertEqual(totals["period_count"], 1)
        self.assertEqual(totals["gross_salary"], 54000)
        self.assertEqual(totals["net_amount"], 50872)
        self.assertEqual(totals["bank_snapshot_count"], 2)


class ReportGenerationTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB([payslip_record(), second_payslip()])

    def test_payroll_register_uses_official_status_query_and_totals(self):
        report = payroll_register(
            self.db,
            tenant_id=TENANT_ID,
            period_key="2026-07",
        )

        self.assertEqual(len(report["rows"]), 2)
        self.assertEqual(report["totals"]["net_amount"], 50872)
        query = self.db.payslips.find_calls[-1]
        self.assertEqual(query["tenant_id"], TENANT_ID)
        self.assertEqual(query["period_key"], {"$in": ["2026-07"]})
        self.assertEqual(set(query["status"]["$in"]), {"locked", "disbursed"})

    def test_payroll_register_expands_legacy_status_query_and_response(self):
        legacy = payslip_record(
            status="pending_finance_approval",
            workflow_stage="reviewed",
        )
        db = FakeDB([legacy])

        report = payroll_register(
            db,
            tenant_id=TENANT_ID,
            period_key="2026-07",
            statuses=["hr_reviewed"],
            official_only=False,
        )

        query_statuses = set(db.payslips.find_calls[-1]["status"]["$in"])
        self.assertEqual(
            query_statuses,
            {
                "hr_reviewed",
                "hr_review",
                "reviewed",
                "pending_finance_approval",
                "finance_approval_pending",
            },
        )
        self.assertEqual(report["statuses"], ["hr_reviewed"])
        self.assertEqual(report["rows"][0]["status"], "hr_reviewed")
        self.assertEqual(report["rows"][0]["workflow_stage"], "hr_reviewed")

    def test_payroll_register_applies_department_and_search_filters(self):
        report = payroll_register(
            self.db,
            tenant_id=TENANT_ID,
            period_key="2026-07",
            departments=["IT"],
            search="payroll employee",
        )

        self.assertEqual(len(report["rows"]), 1)
        self.assertEqual(report["rows"][0]["employee_id"], EMPLOYEE_ID)

    def test_payroll_summary_groups_by_period(self):
        august = payslip_record(
            _id=ObjectId(),
            period_key="2026-08",
            month=8,
            totals={
                **payslip_record()["totals"],
                "net_amount": 28000,
            },
        )
        db = FakeDB([payslip_record(), second_payslip(), august])
        report = payroll_summary(
            db,
            tenant_id=TENANT_ID,
            start_period="2026-07",
            end_period="2026-08",
        )

        self.assertEqual([row["period_key"] for row in report["rows"]], ["2026-07", "2026-08"])
        self.assertEqual(report["rows"][0]["employee_count"], 2)
        self.assertEqual(report["rows"][1]["employee_count"], 1)

    def test_statutory_summary_groups_by_period_and_state(self):
        report = statutory_summary(
            self.db,
            tenant_id=TENANT_ID,
            period_key="2026-07",
        )

        self.assertEqual(len(report["rows"]), 1)
        row = report["rows"][0]
        self.assertEqual(row["state_code"], "AS")
        self.assertEqual(row["employee_count"], 2)
        self.assertEqual(row["pf_eligible_count"], 2)
        self.assertEqual(row["pf_employee"], 3240)
        self.assertEqual(row["pf_employer"], 3240)
        self.assertEqual(row["professional_tax"], 388)

    def test_department_summary_separates_departments(self):
        report = department_summary(
            self.db,
            tenant_id=TENANT_ID,
            period_key="2026-07",
        )

        departments = {row["department"]: row for row in report["rows"]}
        self.assertEqual(set(departments), {"IT", "Finance"})
        self.assertEqual(departments["IT"]["net_amount"], 27492)
        self.assertEqual(departments["Finance"]["net_amount"], 23380)

    def test_employee_statement_returns_selected_employee_history(self):
        report = employee_statement(
            self.db,
            tenant_id=TENANT_ID,
            employee_id=EMPLOYEE_ID,
            start_period="2026-07",
            end_period="2026-07",
        )

        self.assertEqual(report["employee"]["employee_code"], "SDS-001")
        self.assertEqual(report["rows"][0]["net_amount"], 27492)

    def test_employee_statement_raises_when_no_records_found(self):
        db = FakeDB([])

        with self.assertRaises(PayrollReportingError) as context:
            employee_statement(
                db,
                tenant_id=TENANT_ID,
                employee_id=THIRD_EMPLOYEE_ID,
                start_period="2026-07",
                end_period="2026-07",
            )

        self.assertEqual(
            context.exception.code,
            "employee_payroll_statement_not_found",
        )


class VarianceAndTrendTests(unittest.TestCase):
    def test_period_variance_detects_component_changes(self):
        base = payslip_record(period_key="2026-06", month=6)
        comparison = payslip_record(
            _id=ObjectId(),
            period_key="2026-07",
            month=7,
            attendance={
                **payslip_record()["attendance"],
                "lwp_days": 2,
                "salary_paid_days": 24,
            },
            totals={
                **payslip_record()["totals"],
                "gross_salary": 32000,
                "payable_gross_salary": 30000,
                "reimbursements": 2500,
                "tds": 700,
                "total_deductions": 4200,
                "net_amount": 28300,
            },
        )
        report = period_variance(
            FakeDB([base, comparison]),
            tenant_id=TENANT_ID,
            base_period="2026-06",
            comparison_period="2026-07",
        )
        row = report["rows"][0]

        self.assertEqual(row["net_amount_variance"], 808)
        self.assertEqual(row["gross_salary_variance"], 2000)
        self.assertIn("LWP days changed", row["variance_reasons"])
        self.assertIn("Gross salary changed", row["variance_reasons"])
        self.assertIn("Reimbursements changed", row["variance_reasons"])
        self.assertIn("TDS changed", row["variance_reasons"])

    def test_period_variance_detects_added_and_removed_employees(self):
        removed = payslip_record(period_key="2026-06", month=6)
        added = second_payslip(period_key="2026-07", month=7)
        report = period_variance(
            FakeDB([removed, added]),
            tenant_id=TENANT_ID,
            base_period="2026-06",
            comparison_period="2026-07",
        )
        statuses = {
            row["employee_id"]: row["employee_status"]
            for row in report["rows"]
        }

        self.assertEqual(statuses[EMPLOYEE_ID], "removed")
        self.assertEqual(statuses[SECOND_EMPLOYEE_ID], "added")

    def test_period_variance_rejects_same_period(self):
        with self.assertRaises(PayrollReportingError) as context:
            period_variance(
                FakeDB([]),
                tenant_id=TENANT_ID,
                base_period="2026-07",
                comparison_period="2026-07",
            )

        self.assertEqual(
            context.exception.code,
            "payroll_variance_periods_must_differ",
        )

    def test_payroll_trend_calculates_monthly_changes(self):
        june = payslip_record(period_key="2026-06", month=6)
        july = payslip_record(
            _id=ObjectId(),
            period_key="2026-07",
            month=7,
            totals={
                **payslip_record()["totals"],
                "net_amount": 30000,
                "cost_to_company": 34000,
            },
        )
        report = payroll_trend(
            FakeDB([june, july]),
            tenant_id=TENANT_ID,
            start_period="2026-06",
            end_period="2026-07",
        )

        self.assertEqual(report["rows"][0]["net_amount_change"], 0)
        self.assertEqual(report["rows"][1]["net_amount_change"], 2508)
        self.assertEqual(report["rows"][1]["cost_to_company_change"], 2200)


class CsvAndExportTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.export_document = {
            "_id": EXPORT_ID,
            "tenant_id": TENANT_ID,
            "export_key": "export-key",
            "created_at": datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
            "status": "generated",
        }
        self.db.payroll_report_exports.find_one_and_update_result = self.export_document

    def simple_report(self):
        return {
            "report_type": "payroll_register",
            "tenant_id": TENANT_ID,
            "periods": ["2026-07"],
            "filters": {"official_only": True},
            "rows": [
                {
                    "period_key": "2026-07",
                    "employee_code": "SDS-001",
                    "employee_name": "=HYPERLINK('bad')",
                    "department": "IT",
                    "designation": "Engineer",
                    "location": "Guwahati",
                    "state_code": "AS",
                    "working_days": 26,
                    "paid_days": 25,
                    "lwp_days": 1,
                    "gross_salary": 30000,
                    "payable_gross_salary": 29000,
                    "lwp_deduction": 1000,
                    "pf_employee": 1800,
                    "pf_employer": 1800,
                    "esi_employee": 0,
                    "esi_employer": 0,
                    "professional_tax": 208,
                    "tds": 500,
                    "advances": 1000,
                    "reimbursements": 2000,
                    "total_deductions": 3508,
                    "net_amount": 27492,
                    "cost_to_company": 31800,
                    "status": "locked",
                }
            ],
            "totals": {"net_amount": 27492},
        }

    def test_csv_generation_protects_formula_cells_and_hashes_bytes(self):
        result = generate_payroll_report_csv(
            self.db,
            tenant_id=TENANT_ID,
            report_type="payroll_register",
            report=self.simple_report(),
            include_utf8_bom=False,
            actor_id="finance-1",
            actor_name="Finance User",
        )

        csv_text = result["export"]["csv_text"]
        self.assertIn("'=HYPERLINK('bad')", csv_text)
        self.assertEqual(
            result["export"]["sha256"],
            hashlib.sha256(result["export"]["csv_bytes"]).hexdigest(),
        )
        self.assertEqual(result["export"]["row_count"], 1)
        self.assertEqual(result["export"]["total_amount"], 27492)

    def test_csv_generation_supports_custom_columns_and_delimiter(self):
        result = generate_payroll_report_csv(
            self.db,
            tenant_id=TENANT_ID,
            report_type="register",
            report=self.simple_report(),
            columns=[
                ("employee_code", "Code"),
                {"key": "net_amount", "header": "Net Salary"},
            ],
            delimiter=";",
            include_utf8_bom=False,
        )
        rows = list(csv.reader(io.StringIO(result["export"]["csv_text"]), delimiter=";"))

        self.assertEqual(rows[0], ["Code", "Net Salary"])
        self.assertEqual(rows[1], ["SDS-001", "27492"])

    def test_export_metadata_is_idempotently_upserted(self):
        generate_payroll_report_csv(
            self.db,
            tenant_id=TENANT_ID,
            report_type="payroll_register",
            report=self.simple_report(),
        )
        query, update, kwargs = self.db.payroll_report_exports.update_calls[-1]

        self.assertEqual(query["tenant_id"], TENANT_ID)
        self.assertTrue(query["export_key"])
        self.assertEqual(update["$setOnInsert"]["status"], "generated")
        self.assertEqual(update["$setOnInsert"]["row_count"], 1)
        self.assertEqual(update["$inc"]["generation_count"], 1)
        self.assertTrue(kwargs["upsert"])
        self.assertEqual(kwargs["return_document"], ReturnDocument.AFTER)

    def test_csv_generation_rejects_tenant_mismatch_and_empty_rows(self):
        mismatch = self.simple_report()
        mismatch["tenant_id"] = "other-tenant"

        with self.assertRaises(PayrollReportingError) as mismatch_context:
            generate_payroll_report_csv(
                self.db,
                tenant_id=TENANT_ID,
                report_type="payroll_register",
                report=mismatch,
            )

        self.assertEqual(
            mismatch_context.exception.code,
            "payroll_report_tenant_mismatch",
        )

        empty = self.simple_report()
        empty["rows"] = []

        with self.assertRaises(PayrollReportingError) as empty_context:
            generate_payroll_report_csv(
                self.db,
                tenant_id=TENANT_ID,
                report_type="payroll_register",
                report=empty,
            )

        self.assertEqual(
            empty_context.exception.code,
            "payroll_report_has_no_rows",
        )

    def test_list_exports_applies_filters(self):
        self.db.payroll_report_exports.find_rows = FakeCursor([
            self.export_document,
        ])
        rows = list_payroll_report_exports(
            self.db,
            tenant_id=TENANT_ID,
            report_types=["register"],
            periods=["2026-07"],
            statuses=["generated"],
        )
        query = self.db.payroll_report_exports.find_calls[-1]

        self.assertEqual(len(rows), 1)
        self.assertEqual(query["report_type"], {"$in": ["payroll_register"]})
        self.assertEqual(query["periods"], {"$in": ["2026-07"]})
        self.assertEqual(query["status"], {"$in": ["generated"]})

    def test_update_export_status_records_audit_history(self):
        updated = {
            **self.export_document,
            "status": "downloaded",
        }
        self.db.payroll_report_exports.find_one_and_update_result = updated
        result = update_payroll_report_export_status(
            self.db,
            tenant_id=TENANT_ID,
            export_id=str(EXPORT_ID),
            status="downloaded",
            actor_id="finance-1",
            actor_name="Finance User",
            note="Downloaded by Finance",
        )
        query, update, kwargs = self.db.payroll_report_exports.update_calls[-1]

        self.assertEqual(result["status"], "downloaded")
        self.assertEqual(query["_id"], EXPORT_ID)
        self.assertEqual(update["$set"]["status"], "downloaded")
        self.assertEqual(update["$push"]["status_history"]["note"], "Downloaded by Finance")
        self.assertEqual(kwargs["return_document"], ReturnDocument.AFTER)

    def test_update_export_status_rejects_invalid_status_and_missing_export(self):
        with self.assertRaises(PayrollReportingError) as status_context:
            update_payroll_report_export_status(
                self.db,
                tenant_id=TENANT_ID,
                export_id=str(EXPORT_ID),
                status="deleted",
            )

        self.assertEqual(
            status_context.exception.code,
            "invalid_payroll_report_export_status",
        )

        self.db.payroll_report_exports.find_one_and_update_result = None

        with self.assertRaises(PayrollReportingError) as missing_context:
            update_payroll_report_export_status(
                self.db,
                tenant_id=TENANT_ID,
                export_id=str(EXPORT_ID),
                status="archived",
            )

        self.assertEqual(
            missing_context.exception.code,
            "payroll_report_export_not_found",
        )


if __name__ == "__main__":
    unittest.main()