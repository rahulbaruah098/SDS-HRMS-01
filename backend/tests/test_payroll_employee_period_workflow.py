from __future__ import annotations

"""Route-level payroll workflow regression tests.

This file verifies the employee-period protections and payslip organisation
branding implemented in ``app.routes.payroll``.

Run from the backend directory with:

    python -m unittest tests.test_payroll_employee_period_workflow -v
"""

import re
import unittest
from copy import deepcopy
from typing import Any, Iterable, Mapping

from app.routes.payroll import (
    PayrollConfigError,
    _classify_payroll_employees,
    _employee_organisation_snapshot,
    _employee_state_code,
    _payroll_run_code,
    _payslip_company,
    _period_payroll_records,
)


TENANT_ID = "sds"
OTHER_TENANT_ID = "other-tenant"
PERIOD_KEY = "2026-09"
EMPLOYEE_A_ID = "employee-ajanur"
EMPLOYEE_B_ID = "employee-atlanta"


def employee_record(employee_id: str, name: str, code: str, **overrides: Any) -> dict[str, Any]:
    row = {
        "_id": employee_id,
        "employee_id": employee_id,
        "tenant_id": TENANT_ID,
        "employee_name": name,
        "employee_code": code,
        "status": "active",
        "payroll_state_code": "AS",
    }
    row.update(overrides)
    return row


def _matches_scalar(actual: Any, expected: Any) -> bool:
    if isinstance(expected, Mapping):
        for operator, value in expected.items():
            if operator == "$ne":
                if actual == value:
                    return False
            elif operator == "$in":
                if actual not in value:
                    return False
            elif operator == "$nin":
                if actual in value:
                    return False
            elif operator == "$regex":
                flags = re.IGNORECASE if "i" in str(expected.get("$options", "")) else 0
                if re.search(str(value), str(actual or ""), flags) is None:
                    return False
            elif operator == "$options":
                continue
            else:
                raise AssertionError(f"Unsupported fake-query operator: {operator}")
        return True
    return str(actual) == str(expected)


def _matches(document: Mapping[str, Any], query: Mapping[str, Any]) -> bool:
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(document, clause) for clause in expected):
                return False
            continue

        actual = document.get(key)
        if not _matches_scalar(actual, expected):
            return False
    return True


class FakeCursor(list):
    def sort(self, *args: Any, **kwargs: Any) -> "FakeCursor":
        return self


class FakeCollection:
    def __init__(self, rows: Iterable[Mapping[str, Any]] | None = None) -> None:
        self.rows = [deepcopy(dict(row)) for row in (rows or [])]
        self.find_calls: list[dict[str, Any]] = []
        self.find_one_calls: list[dict[str, Any]] = []

    def find(self, query: Mapping[str, Any], *args: Any, **kwargs: Any) -> FakeCursor:
        self.find_calls.append(deepcopy(dict(query)))
        return FakeCursor(
            deepcopy(row) for row in self.rows if _matches(row, query)
        )

    def find_one(self, query: Mapping[str, Any], *args: Any, **kwargs: Any) -> dict[str, Any] | None:
        self.find_one_calls.append(deepcopy(dict(query)))
        for row in self.rows:
            if _matches(row, query):
                return deepcopy(row)
        return None


class FakeCounterCollection:
    def __init__(self, starting_sequence: int = 0) -> None:
        self.sequence = starting_sequence
        self.calls: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = []

    def find_one_and_update(
        self,
        query: Mapping[str, Any],
        update: Mapping[str, Any],
        **kwargs: Any,
    ) -> dict[str, Any]:
        self.calls.append((deepcopy(dict(query)), deepcopy(dict(update)), dict(kwargs)))
        self.sequence += int((update.get("$inc") or {}).get("sequence") or 0)
        return {
            "tenant_id": query.get("tenant_id"),
            "period_key": query.get("period_key"),
            "sequence": self.sequence,
        }


class FakeDB:
    def __init__(
        self,
        *,
        runs: Iterable[Mapping[str, Any]] | None = None,
        payslips: Iterable[Mapping[str, Any]] | None = None,
        organisations: Iterable[Mapping[str, Any]] | None = None,
        tenants: Iterable[Mapping[str, Any]] | None = None,
        counter_sequence: int = 0,
    ) -> None:
        self.payroll_runs = FakeCollection(runs)
        self.payslips = FakeCollection(payslips)
        self.organisations = FakeCollection(organisations)
        self.tenants = FakeCollection(tenants)
        self.payroll_run_counters = FakeCounterCollection(counter_sequence)


class EmployeePeriodEligibilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ajanur = employee_record(EMPLOYEE_A_ID, "Ajanur Rahman", "SDS-001")
        self.atlanta = employee_record(EMPLOYEE_B_ID, "Atlanta Gogoi", "SDS-002")

    def test_completed_employee_does_not_block_unprocessed_employee(self) -> None:
        records = {
            EMPLOYEE_A_ID: [{
                "source": "payslip",
                "run_id": "run-1",
                "run_code": "PAY-SDS-202609-001",
                "status": "disbursed",
                "is_editable": False,
            }],
            EMPLOYEE_B_ID: [],
        }

        eligible, already_processed = _classify_payroll_employees(
            [self.ajanur, self.atlanta],
            records=records,
            editable_run=None,
        )

        self.assertEqual([row["employee_id"] for row in eligible], [EMPLOYEE_B_ID])
        self.assertEqual(len(already_processed), 1)
        self.assertEqual(already_processed[0]["employee_id"], EMPLOYEE_A_ID)
        self.assertEqual(already_processed[0]["status"], "disbursed")

    def test_same_employee_is_blocked_for_same_tenant_and_month(self) -> None:
        db = FakeDB(
            runs=[{
                "_id": "run-1",
                "tenant_id": TENANT_ID,
                "period_key": PERIOD_KEY,
                "run_code": "PAY-SDS-202609-001",
                "status": "locked",
                "is_locked": True,
                "employee_ids": [EMPLOYEE_A_ID],
                "is_deleted": False,
            }],
            payslips=[{
                "_id": "payslip-1",
                "tenant_id": TENANT_ID,
                "period_key": PERIOD_KEY,
                "run_id": "run-1",
                "employee_id": EMPLOYEE_A_ID,
                "status": "locked",
                "is_locked": True,
                "is_deleted": False,
            }],
        )

        records, _ = _period_payroll_records(
            db,
            tenant_id=TENANT_ID,
            period_key=PERIOD_KEY,
            employee_ids=[EMPLOYEE_A_ID],
        )
        eligible, already_processed = _classify_payroll_employees(
            [self.ajanur],
            records=records,
            editable_run=None,
        )

        self.assertEqual(eligible, [])
        self.assertEqual(already_processed[0]["employee_id"], EMPLOYEE_A_ID)
        self.assertEqual(already_processed[0]["status"], "locked")

    def test_same_employee_is_allowed_in_another_month(self) -> None:
        db = FakeDB(
            runs=[{
                "_id": "run-september",
                "tenant_id": TENANT_ID,
                "period_key": "2026-09",
                "status": "disbursed",
                "employee_ids": [EMPLOYEE_A_ID],
                "is_deleted": False,
            }],
            payslips=[{
                "_id": "payslip-september",
                "tenant_id": TENANT_ID,
                "period_key": "2026-09",
                "run_id": "run-september",
                "employee_id": EMPLOYEE_A_ID,
                "status": "disbursed",
                "is_deleted": False,
            }],
        )

        records, _ = _period_payroll_records(
            db,
            tenant_id=TENANT_ID,
            period_key="2026-10",
            employee_ids=[EMPLOYEE_A_ID],
        )
        eligible, already_processed = _classify_payroll_employees(
            [self.ajanur],
            records=records,
            editable_run=None,
        )

        self.assertEqual([row["employee_id"] for row in eligible], [EMPLOYEE_A_ID])
        self.assertEqual(already_processed, [])

    def test_different_tenant_records_do_not_block_employee(self) -> None:
        db = FakeDB(
            runs=[{
                "_id": "run-other-tenant",
                "tenant_id": OTHER_TENANT_ID,
                "period_key": PERIOD_KEY,
                "status": "disbursed",
                "employee_ids": [EMPLOYEE_A_ID],
                "is_deleted": False,
            }],
            payslips=[{
                "_id": "payslip-other-tenant",
                "tenant_id": OTHER_TENANT_ID,
                "period_key": PERIOD_KEY,
                "run_id": "run-other-tenant",
                "employee_id": EMPLOYEE_A_ID,
                "status": "disbursed",
                "is_deleted": False,
            }],
        )

        records, _ = _period_payroll_records(
            db,
            tenant_id=TENANT_ID,
            period_key=PERIOD_KEY,
            employee_ids=[EMPLOYEE_A_ID],
        )
        eligible, already_processed = _classify_payroll_employees(
            [self.ajanur],
            records=records,
            editable_run=None,
        )

        self.assertEqual([row["employee_id"] for row in eligible], [EMPLOYEE_A_ID])
        self.assertEqual(already_processed, [])

    def test_employee_in_selected_draft_run_can_be_recalculated(self) -> None:
        draft_run = {
            "_id": "draft-run",
            "tenant_id": TENANT_ID,
            "period_key": PERIOD_KEY,
            "status": "draft",
            "is_locked": False,
        }
        records = {
            EMPLOYEE_A_ID: [{
                "source": "payslip",
                "run_id": "draft-run",
                "run_code": "PAY-SDS-202609-001",
                "status": "draft",
                "is_editable": True,
            }],
        }

        eligible, already_processed = _classify_payroll_employees(
            [self.ajanur],
            records=records,
            editable_run=draft_run,
        )

        self.assertEqual([row["employee_id"] for row in eligible], [EMPLOYEE_A_ID])
        self.assertEqual(already_processed, [])


class RunCodeTests(unittest.TestCase):
    def test_multiple_runs_in_one_month_receive_incrementing_codes(self) -> None:
        db = FakeDB(counter_sequence=0)

        first = _payroll_run_code(db, TENANT_ID, PERIOD_KEY)
        db.payroll_runs.rows.append({
            "tenant_id": TENANT_ID,
            "run_code": first,
            "is_deleted": False,
        })
        second = _payroll_run_code(db, TENANT_ID, PERIOD_KEY)

        self.assertEqual(first, "PAY-SDS-202609-001")
        self.assertEqual(second, "PAY-SDS-202609-002")
        self.assertNotEqual(first, second)


class PayrollStateTests(unittest.TestCase):
    def test_missing_employee_state_does_not_default_to_assam(self) -> None:
        employee = employee_record(
            EMPLOYEE_A_ID,
            "Ajanur Rahman",
            "SDS-001",
            payroll_state_code="",
            work_state_code="",
            state_code="",
        )

        with self.assertRaises(PayrollConfigError) as context:
            _employee_state_code(employee, {})

        self.assertEqual(context.exception.code, "employee_payroll_state_missing")
        self.assertEqual(
            context.exception.message,
            "Payroll state is missing for this employee.",
        )


class OrganisationPayslipBrandingTests(unittest.TestCase):
    def _tenant(self) -> dict[str, Any]:
        return {
            "tenant_id": TENANT_ID,
            "company_name": "SDS Lifetime Tenant",
            "logo_url": "/uploads/tenant/sds-default.png",
            "address": "Guwahati, Assam",
            "is_deleted": False,
        }

    def test_employee_organisation_name_and_logo_are_used(self) -> None:
        db = FakeDB(
            organisations=[{
                "_id": "org-sdf",
                "tenant_id": TENANT_ID,
                "name": "Sayanant Development Foundation",
                "code": "SDF",
                "logo_url": "/uploads/organisations/sdf-logo.png",
                "address": "Guwahati, Assam",
                "is_deleted": False,
            }],
            tenants=[self._tenant()],
        )
        employee = employee_record(
            EMPLOYEE_B_ID,
            "Atlanta Gogoi",
            "SDF-001",
            organisation_id="org-sdf",
        )
        snapshot = _employee_organisation_snapshot(db, TENANT_ID, employee)
        payslip = {
            "tenant_id": TENANT_ID,
            "employee_info": employee,
            "organisation_id": "org-sdf",
            "organisation_snapshot": snapshot,
        }

        company = _payslip_company(db, payslip, employee)

        self.assertEqual(company["name"], "Sayanant Development Foundation")
        self.assertEqual(company["initials"], "SDF")
        self.assertEqual(company["logo_src"], "/uploads/organisations/sdf-logo.png")
        self.assertEqual(company["branding_source"], "employee_organisation")

    def test_organisation_without_logo_uses_tenant_logo_only_as_fallback(self) -> None:
        db = FakeDB(
            organisations=[{
                "_id": "org-avpl",
                "tenant_id": TENANT_ID,
                "name": "Ayanant Ventures Private Limited",
                "code": "AVPL",
                "is_deleted": False,
            }],
            tenants=[self._tenant()],
        )
        employee = employee_record(
            EMPLOYEE_A_ID,
            "Ajanur Rahman",
            "AVPL-001",
            organisation_id="org-avpl",
        )
        snapshot = _employee_organisation_snapshot(db, TENANT_ID, employee)
        company = _payslip_company(
            db,
            {
                "tenant_id": TENANT_ID,
                "employee_info": employee,
                "organisation_snapshot": snapshot,
            },
            employee,
        )

        self.assertEqual(company["name"], "Ayanant Ventures Private Limited")
        self.assertEqual(company["logo_src"], "/uploads/tenant/sds-default.png")
        self.assertEqual(company["branding_source"], "tenant_logo_fallback")

    def test_other_tenant_organisation_logo_cannot_be_used(self) -> None:
        db = FakeDB(
            organisations=[{
                "_id": "org-foreign",
                "tenant_id": OTHER_TENANT_ID,
                "name": "Foreign Organisation",
                "code": "FOREIGN",
                "logo_url": "/uploads/organisations/foreign-logo.png",
                "is_deleted": False,
            }],
            tenants=[self._tenant()],
        )
        employee = employee_record(
            EMPLOYEE_A_ID,
            "Ajanur Rahman",
            "SDS-001",
            organisation_id="org-foreign",
            organisation_name="Sayanant Development Services Private Limited",
        )

        snapshot = _employee_organisation_snapshot(db, TENANT_ID, employee)
        company = _payslip_company(
            db,
            {
                "tenant_id": TENANT_ID,
                "employee_info": employee,
                "organisation_snapshot": snapshot,
            },
            employee,
        )

        self.assertFalse(snapshot["record_found"])
        self.assertNotEqual(company["logo_src"], "/uploads/organisations/foreign-logo.png")
        self.assertEqual(company["logo_src"], "/uploads/tenant/sds-default.png")


if __name__ == "__main__":
    unittest.main()