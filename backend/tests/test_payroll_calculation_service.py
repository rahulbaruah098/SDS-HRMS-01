from __future__ import annotations

"""Unit tests for the pure payroll calculation engine.

Run from the ``backend`` directory with:

    python -m unittest tests.test_payroll_calculation_service -v

The tests intentionally use only Python's standard ``unittest`` module so no
additional testing dependency is required in the HRMS backend.
"""

import copy
import importlib.util
import unittest
from pathlib import Path
from typing import Any


BACKEND_DIR = Path(__file__).resolve().parents[1]
SERVICE_PATH = BACKEND_DIR / "app" / "services" / "payroll_calculation_service.py"
SPEC = importlib.util.spec_from_file_location(
    "payroll_calculation_service_under_test",
    SERVICE_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load payroll calculation service: {SERVICE_PATH}")

PAYROLL_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PAYROLL_MODULE)
PayrollCalculationError = PAYROLL_MODULE.PayrollCalculationError
calculate_payroll = PAYROLL_MODULE.calculate_payroll


def component_amount(lines: list[dict[str, Any]], code: str) -> int | float:
    for line in lines:
        if line.get("code") == code:
            return line["amount"]
    raise AssertionError(f"Component {code!r} was not returned.")


class PayrollCalculationServiceTests(unittest.TestCase):
    """Covers reference-payslip and high-risk payroll calculation rules."""

    def setUp(self) -> None:
        # The fourth earning is intentionally balancing. With the statutory
        # employer PF contribution, it resolves to the ₹2,075 shown in the
        # attached SDS reference payslip.
        self.salary_structure = {
            "employee_id": "employee-rahul",
            "monthly_ctc": 29470,
            "annual_ctc": 353640,
            "currency": "INR",
            "components": [
                {
                    "code": "basic",
                    "label": "Basic",
                    "category": "earning",
                    "calculation_type": "fixed",
                    "amount": 13835,
                    "display_order": 10,
                    "prorate_on_lwp": True,
                },
                {
                    "code": "hra",
                    "label": "HRA",
                    "category": "earning",
                    "calculation_type": "fixed",
                    "amount": 6918,
                    "display_order": 20,
                    "prorate_on_lwp": True,
                },
                {
                    "code": "medical_allowance",
                    "label": "Medical Allowance",
                    "category": "earning",
                    "calculation_type": "fixed",
                    "amount": 4842,
                    "display_order": 30,
                    "prorate_on_lwp": True,
                },
                {
                    "code": "other_allowances",
                    "label": "Other Allowances",
                    "category": "earning",
                    "calculation_type": "balancing",
                    "balance_of": "monthly_ctc",
                    "minimum_amount": 0,
                    "display_order": 40,
                    "prorate_on_lwp": True,
                },
            ],
        }

        self.statutory_config = {
            "state_code": "AS",
            "rounding_mode": "nearest_rupee",
            "pf": {
                "enabled": True,
                "employee_rate_percent": 12,
                "employer_rate_percent": 12,
                "wage_ceiling": 15000,
                # The reference payslip's ₹1,800 PF cannot be produced from
                # Basic ₹13,835 alone. This fixture deliberately uses a
                # configurable PF wage base that exceeds the ceiling, without
                # claiming which additional component SDS ultimately adopts.
                "wage_base_component_codes": ["basic", "hra"],
                "allow_higher_wage_contribution": False,
                "employee_higher_wage_enabled": False,
                "employer_higher_wage_enabled": False,
                "show_employer_pf_as_earning": True,
                "show_employer_pf_as_deduction": True,
            },
            "professional_tax": {
                "enabled": True,
                "basis": "gross_salary",
                "slabs": [
                    {
                        "minimum_amount": 0,
                        "maximum_amount": 15000,
                        "tax_amount": 0,
                        "minimum_inclusive": True,
                        "maximum_inclusive": True,
                    },
                    {
                        "minimum_amount": 15000,
                        "maximum_amount": 25000,
                        "tax_amount": 180,
                        "minimum_inclusive": False,
                        "maximum_inclusive": False,
                    },
                    {
                        "minimum_amount": 25000,
                        "maximum_amount": None,
                        "tax_amount": 208,
                        "minimum_inclusive": True,
                        "maximum_inclusive": True,
                    },
                ],
            },
            "esi": {"enabled": False},
            "tds": {"mode": "manual"},
            # The production divisor is deliberately unresolved. Zero-LWP
            # calculations remain allowed; a positive LWP requires an explicit
            # configured divisor.
            "lwp": {
                "divisor_mode": None,
                "fixed_days": None,
                "prorate_component_codes": [
                    "basic",
                    "hra",
                    "medical_allowance",
                    "other_allowances",
                ],
                "paid_leave_affects_salary": False,
            },
        }

        self.attendance = {
            "total_days": 30,
            "working_days": 26,
            "paid_leave_days": 0,
            "lwp_days": 0,
        }

    def calculate(
        self,
        *,
        salary_structure: dict[str, Any] | None = None,
        statutory_config: dict[str, Any] | None = None,
        attendance: dict[str, Any] | None = None,
        inputs: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return calculate_payroll(
            salary_structure=copy.deepcopy(
                salary_structure
                if salary_structure is not None
                else self.salary_structure
            ),
            statutory_config=copy.deepcopy(
                statutory_config
                if statutory_config is not None
                else self.statutory_config
            ),
            attendance=copy.deepcopy(
                attendance if attendance is not None else self.attendance
            ),
            inputs=copy.deepcopy(inputs if inputs is not None else {"tds_amount": 0}),
        )

    def simple_salary(self, gross_salary: int | float) -> dict[str, Any]:
        return {
            "monthly_ctc": gross_salary,
            "currency": "INR",
            "components": [
                {
                    "code": "basic",
                    "label": "Basic",
                    "category": "earning",
                    "calculation_type": "fixed",
                    "amount": gross_salary,
                    "display_order": 10,
                    "prorate_on_lwp": True,
                }
            ],
        }

    def config_without_pf(
        self,
        *,
        tds_mode: str = "disabled",
        rounding_mode: str = "nearest_rupee",
    ) -> dict[str, Any]:
        config = copy.deepcopy(self.statutory_config)
        config["rounding_mode"] = rounding_mode
        config["pf"] = {"enabled": False}
        config["esi"] = {"enabled": False}
        config["tds"] = {"mode": tds_mode}
        return config

    def test_reference_payslip_totals_and_component_layout(self) -> None:
        result = self.calculate()

        self.assertEqual(result["currency"], "INR")
        self.assertEqual(result["totals"]["gross_salary"], 27670)
        self.assertEqual(result["totals"]["payable_gross_salary"], 27670)
        self.assertEqual(result["totals"]["pf_employee"], 1800)
        self.assertEqual(result["totals"]["pf_employer"], 1800)
        self.assertEqual(result["totals"]["professional_tax"], 208)
        self.assertEqual(result["totals"]["cost_to_company"], 29470)
        self.assertEqual(result["totals"]["total_deductions"], 3808)
        self.assertEqual(result["totals"]["net_amount"], 25662)
        self.assertEqual(result["warnings"], [])

        self.assertEqual(component_amount(result["earnings"], "basic"), 13835)
        self.assertEqual(component_amount(result["earnings"], "hra"), 6918)
        self.assertEqual(
            component_amount(result["earnings"], "medical_allowance"),
            4842,
        )
        self.assertEqual(
            component_amount(result["earnings"], "other_allowances"),
            2075,
        )
        self.assertEqual(component_amount(result["earnings"], "pf_employer"), 1800)

        self.assertEqual(component_amount(result["deductions"], "tds"), 0)
        self.assertEqual(component_amount(result["deductions"], "pf_employee"), 1800)
        self.assertEqual(
            component_amount(result["deductions"], "pf_employer_pass_through"),
            1800,
        )
        self.assertEqual(component_amount(result["deductions"], "lwp_deduction"), 0)
        self.assertEqual(
            component_amount(result["deductions"], "professional_tax"),
            208,
        )

    def test_paid_leave_is_tracking_only_and_does_not_reduce_salary(self) -> None:
        attendance = copy.deepcopy(self.attendance)
        attendance["paid_leave_days"] = 5

        result = self.calculate(attendance=attendance)

        self.assertEqual(result["attendance"]["paid_leave_days"], 5.0)
        self.assertFalse(result["attendance"]["paid_leave_affects_salary"])
        self.assertEqual(result["attendance"]["proration_factor"], 1.0)
        self.assertEqual(result["totals"]["lwp_deduction"], 0)
        self.assertEqual(result["totals"]["net_amount"], 25662)

    def test_positive_lwp_requires_an_explicit_divisor_policy(self) -> None:
        attendance = copy.deepcopy(self.attendance)
        attendance["lwp_days"] = 1

        with self.assertRaises(PayrollCalculationError) as context:
            self.calculate(attendance=attendance)

        self.assertEqual(context.exception.code, "lwp_divisor_not_configured")
        self.assertEqual(context.exception.field, "statutory_config.lwp.divisor_mode")

    def test_calendar_day_lwp_prorates_only_configured_earnings_once(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["lwp"]["divisor_mode"] = "calendar_days"
        attendance = copy.deepcopy(self.attendance)
        attendance["lwp_days"] = 2

        result = self.calculate(statutory_config=config, attendance=attendance)

        self.assertEqual(result["attendance"]["divisor_days"], 30.0)
        self.assertEqual(result["attendance"]["payable_days"], 28.0)
        self.assertAlmostEqual(
            result["attendance"]["proration_factor"],
            28 / 30,
            places=8,
        )
        self.assertEqual(result["totals"]["gross_salary"], 27670)
        self.assertEqual(result["totals"]["payable_gross_salary"], 25825)
        self.assertEqual(result["totals"]["lwp_deduction"], 1845)
        self.assertEqual(result["totals"]["total_deductions"], 5653)
        self.assertEqual(result["totals"]["net_amount"], 23817)

        basic_line = next(
            line for line in result["earnings"] if line["code"] == "basic"
        )
        self.assertEqual(basic_line["full_amount"], 13835)
        self.assertEqual(basic_line["payable_amount"], 12913)

    def test_fixed_30_day_lwp_policy_is_independent_of_calendar_length(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["lwp"]["divisor_mode"] = "fixed_days"
        config["lwp"]["fixed_days"] = 30
        attendance = copy.deepcopy(self.attendance)
        attendance["total_days"] = 31
        attendance["lwp_days"] = 1

        result = self.calculate(statutory_config=config, attendance=attendance)

        self.assertEqual(result["attendance"]["total_days"], 31.0)
        self.assertEqual(result["attendance"]["divisor_days"], 30.0)
        self.assertEqual(result["attendance"]["payable_days"], 29.0)
        self.assertEqual(result["totals"]["lwp_deduction"], 922)

    def test_working_day_lwp_policy_uses_attendance_working_days(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["lwp"]["divisor_mode"] = "working_days"
        attendance = copy.deepcopy(self.attendance)
        attendance["working_days"] = 26
        attendance["lwp_days"] = 1

        result = self.calculate(statutory_config=config, attendance=attendance)

        self.assertEqual(result["attendance"]["divisor_days"], 26.0)
        self.assertEqual(result["attendance"]["payable_days"], 25.0)
        self.assertEqual(result["totals"]["lwp_deduction"], 1064)

    def test_pf_uses_configured_wage_components_and_statutory_ceiling(self) -> None:
        result = self.calculate()

        self.assertEqual(result["statutory"]["pf"]["base_wage"], 20753)
        self.assertEqual(result["statutory"]["pf"]["employee_wage"], 15000)
        self.assertEqual(result["statutory"]["pf"]["employer_wage"], 15000)
        self.assertEqual(result["totals"]["pf_employee"], 1800)
        self.assertEqual(result["totals"]["pf_employer"], 1800)

    def test_pf_below_ceiling_uses_actual_configured_wage(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["pf"]["wage_base_component_codes"] = ["basic"]

        result = self.calculate(statutory_config=config)

        self.assertEqual(result["statutory"]["pf"]["base_wage"], 13835)
        self.assertEqual(result["statutory"]["pf"]["employee_wage"], 13835)
        self.assertEqual(result["totals"]["pf_employee"], 1660)
        self.assertEqual(result["totals"]["pf_employer"], 1660)

    def test_pf_higher_wage_flags_can_be_configured_separately(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["pf"]["allow_higher_wage_contribution"] = True
        config["pf"]["employee_higher_wage_enabled"] = True
        config["pf"]["employer_higher_wage_enabled"] = False

        result = self.calculate(statutory_config=config)

        self.assertEqual(result["statutory"]["pf"]["employee_wage"], 20753)
        self.assertEqual(result["statutory"]["pf"]["employer_wage"], 15000)
        self.assertEqual(result["totals"]["pf_employee"], 2490)
        self.assertEqual(result["totals"]["pf_employer"], 1800)

    def test_assam_professional_tax_slab_boundaries(self) -> None:
        config = self.config_without_pf()

        cases = (
            (15000, 0),
            (15001, 180),
            (24999, 180),
            (25000, 208),
            (50000, 208),
        )
        for gross_salary, expected_tax in cases:
            with self.subTest(gross_salary=gross_salary):
                result = self.calculate(
                    salary_structure=self.simple_salary(gross_salary),
                    statutory_config=config,
                    inputs={},
                )
                self.assertEqual(
                    result["totals"]["professional_tax"],
                    expected_tax,
                )

    def test_manual_tds_must_be_supplied_and_is_not_estimated(self) -> None:
        with self.assertRaises(PayrollCalculationError) as context:
            self.calculate(inputs={})

        self.assertEqual(context.exception.code, "tds_amount_required")
        self.assertEqual(context.exception.field, "inputs.tds_amount")

        result = self.calculate(inputs={"tds_amount": 1250})
        self.assertEqual(result["statutory"]["tds"]["mode"], "manual")
        self.assertFalse(result["statutory"]["tds"]["calculated_by_engine"])
        self.assertEqual(result["totals"]["tds"], 1250)
        self.assertEqual(result["totals"]["net_amount"], 24412)

    def test_only_active_or_recoverable_advances_are_deducted(self) -> None:
        result = self.calculate(
            inputs={
                "tds_amount": 0,
                "advances": [
                    {
                        "id": "advance-active",
                        "type": "personal_advance",
                        "label": "Personal Advance",
                        "emi_amount": 500,
                        "remaining_balance": 1500,
                        "status": "active",
                    },
                    {
                        "id": "advance-closed",
                        "type": "tour_advance",
                        "emi_amount": 1000,
                        "remaining_balance": 0,
                        "status": "closed",
                    },
                ],
            }
        )

        self.assertEqual(result["totals"]["advances"], 500)
        self.assertEqual(result["totals"]["total_deductions"], 4308)
        self.assertEqual(result["totals"]["net_amount"], 25162)
        self.assertEqual(len(result["advance_details"]), 1)
        self.assertEqual(result["advance_details"][0]["reference_id"], "advance-active")
        self.assertEqual(
            component_amount(result["deductions"], "personal_advance"),
            500,
        )

    def test_advance_total_mismatch_is_rejected(self) -> None:
        with self.assertRaises(PayrollCalculationError) as context:
            self.calculate(
                inputs={
                    "tds_amount": 0,
                    "advance_amount": 700,
                    "advances": [
                        {
                            "type": "personal_advance",
                            "emi_amount": 500,
                            "status": "active",
                        }
                    ],
                }
            )

        self.assertEqual(context.exception.code, "advance_total_mismatch")

    def test_two_decimal_rounding_preserves_paise(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["rounding_mode"] = "two_decimals"
        config["pf"]["wage_base_component_codes"] = ["basic"]

        result = self.calculate(statutory_config=config)

        self.assertEqual(result["totals"]["pf_employee"], 1660.2)
        self.assertEqual(result["totals"]["pf_employer"], 1660.2)

    def test_missing_pf_wage_component_is_rejected(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["pf"]["wage_base_component_codes"] = ["nonexistent_component"]

        with self.assertRaises(PayrollCalculationError) as context:
            self.calculate(statutory_config=config)

        self.assertEqual(context.exception.code, "statutory_wage_component_not_found")

    def test_circular_percentage_component_dependency_is_rejected(self) -> None:
        salary = {
            "monthly_ctc": 20000,
            "components": [
                {
                    "code": "basic",
                    "label": "Basic",
                    "category": "earning",
                    "calculation_type": "percentage",
                    "percentage": 50,
                    "base_component": "hra",
                },
                {
                    "code": "hra",
                    "label": "HRA",
                    "category": "earning",
                    "calculation_type": "percentage",
                    "percentage": 50,
                    "base_component": "basic",
                },
            ],
        }
        config = self.config_without_pf()

        with self.assertRaises(PayrollCalculationError) as context:
            self.calculate(
                salary_structure=salary,
                statutory_config=config,
                inputs={},
            )

        self.assertEqual(context.exception.code, "salary_component_dependency_cycle")

    def test_negative_net_salary_is_rejected(self) -> None:
        config = self.config_without_pf(tds_mode="manual")
        config["professional_tax"]["enabled"] = False

        with self.assertRaises(PayrollCalculationError) as context:
            self.calculate(
                salary_structure=self.simple_salary(1000),
                statutory_config=config,
                inputs={"tds_amount": 2000},
            )

        self.assertEqual(context.exception.code, "negative_net_amount")
        self.assertEqual(context.exception.field, "deductions")

    def test_result_contains_only_json_serialisable_money_values(self) -> None:
        import json

        result = self.calculate()
        encoded = json.dumps(result)

        self.assertIn('"net_amount": 25662', encoded)


if __name__ == "__main__":
    unittest.main(verbosity=2)