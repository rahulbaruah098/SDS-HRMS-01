from __future__ import annotations

"""Unit tests for the pure payroll calculation engine.

Run from the ``backend`` directory with:

    python -m unittest tests.test_payroll_calculation_service -v

The tests intentionally use only Python's standard ``unittest`` module so no
additional testing dependency is required in the HRMS backend.
"""

import copy
import importlib.util
import json
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
    """Covers the final SDS payroll calculation contract and high-risk rules."""

    def setUp(self) -> None:
        self.salary_structure = self.sds_salary(22800)

        self.statutory_config = {
            "state_code": "AS",
            "rounding_mode": "nearest_rupee",
            "pf": {
                "enabled": True,
                "employee_rate_percent": 12,
                "employer_rate_percent": 12,
                "wage_ceiling": 15000,
                "wage_base_component_codes": [
                    "basic",
                    "hra",
                    "medical_allowance",
                ],
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

    def sds_salary(self, monthly_ctc: int | float) -> dict[str, Any]:
        return {
            "employee_id": "employee-rahul",
            "monthly_ctc": monthly_ctc,
            "annual_ctc": round(float(monthly_ctc) * 12, 2),
            "currency": "INR",
            "components": [
                {
                    "code": "basic",
                    "label": "Basic",
                    "category": "earning",
                    "calculation_type": "percentage",
                    "percentage": 50,
                    "base_component": "gross_salary",
                    "display_order": 10,
                    "prorate_on_lwp": True,
                    "include_in_gross": True,
                    "include_in_ctc": True,
                    "show_in_earnings": True,
                    "is_active": True,
                },
                {
                    "code": "hra",
                    "label": "HRA",
                    "category": "earning",
                    "calculation_type": "percentage",
                    "percentage": 50,
                    "base_component": "basic",
                    "display_order": 20,
                    "prorate_on_lwp": True,
                    "include_in_gross": True,
                    "include_in_ctc": True,
                    "show_in_earnings": True,
                    "is_active": True,
                },
                {
                    "code": "medical_allowance",
                    "label": "Medical Allowance",
                    "category": "earning",
                    "calculation_type": "percentage",
                    "percentage": 40,
                    "base_component": "basic",
                    "display_order": 30,
                    "prorate_on_lwp": True,
                    "include_in_gross": True,
                    "include_in_ctc": True,
                    "show_in_earnings": True,
                    "is_active": True,
                },
                {
                    "code": "other_allowances",
                    "label": "Other Allowances",
                    "category": "earning",
                    "calculation_type": "percentage",
                    "percentage": 10,
                    "base_component": "basic",
                    "display_order": 40,
                    "prorate_on_lwp": True,
                    "include_in_gross": True,
                    "include_in_ctc": True,
                    "show_in_earnings": True,
                    "is_active": True,
                },
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

    def test_ctc_22800_exact_sds_breakup_and_net(self) -> None:
        """A: exact approved SDS reference calculation for monthly CTC 22,800."""
        result = self.calculate()

        self.assertEqual(result["currency"], "INR")
        self.assertEqual(result["totals"]["monthly_ctc_configured"], 22800)
        self.assertEqual(result["totals"]["gross_salary"], 21000)
        self.assertEqual(result["totals"]["payable_gross_salary"], 21000)

        self.assertEqual(component_amount(result["earnings"], "basic"), 10500)
        self.assertEqual(component_amount(result["earnings"], "hra"), 5250)
        self.assertEqual(component_amount(result["earnings"], "medical_allowance"), 4200)
        self.assertEqual(component_amount(result["earnings"], "other_allowances"), 1050)

        self.assertEqual(result["statutory"]["pf"]["base_wage"], 19950)
        self.assertEqual(result["statutory"]["pf"]["employee_wage"], 15000)
        self.assertEqual(result["statutory"]["pf"]["employer_wage"], 15000)
        self.assertEqual(result["totals"]["pf_employee"], 1800)
        self.assertEqual(result["totals"]["pf_employer"], 1800)
        self.assertEqual(result["totals"]["professional_tax"], 180)

        self.assertEqual(result["totals"]["employer_contribution_total"], 1800)
        self.assertEqual(result["totals"]["cost_to_company"], 22800)
        self.assertEqual(result["totals"]["total_deductions"], 3780)
        self.assertEqual(result["totals"]["net_amount"], 19020)

        self.assertEqual(component_amount(result["earnings"], "pf_employer"), 1800)
        self.assertEqual(component_amount(result["deductions"], "pf_employee"), 1800)
        self.assertEqual(
            component_amount(result["deductions"], "pf_employer_pass_through"),
            1800,
        )
        self.assertEqual(component_amount(result["deductions"], "professional_tax"), 180)

    def test_pf_below_ceiling_uses_actual_pf_wage(self) -> None:
        """B: below ceiling uses actual Basic+HRA+MA wage, not zero and not 15,000."""
        result = self.calculate(salary_structure=self.sds_salary(13368))

        self.assertEqual(result["totals"]["gross_salary"], 12000)
        self.assertEqual(component_amount(result["earnings"], "basic"), 6000)
        self.assertEqual(component_amount(result["earnings"], "hra"), 3000)
        self.assertEqual(component_amount(result["earnings"], "medical_allowance"), 2400)
        self.assertEqual(component_amount(result["earnings"], "other_allowances"), 600)
        self.assertEqual(result["statutory"]["pf"]["base_wage"], 11400)
        self.assertEqual(result["statutory"]["pf"]["employee_wage"], 11400)
        self.assertEqual(result["statutory"]["pf"]["employer_wage"], 11400)
        self.assertEqual(result["totals"]["pf_employee"], 1368)
        self.assertEqual(result["totals"]["pf_employer"], 1368)
        self.assertEqual(result["totals"]["professional_tax"], 0)
        self.assertEqual(result["totals"]["cost_to_company"], 13368)
        self.assertEqual(result["totals"]["net_amount"], 10632)

    def test_pf_wage_exactly_15000_produces_1800_each(self) -> None:
        """C: PF wage exactly at ceiling must still produce 1,800 each."""
        # PF wage = 95% of Gross, so Gross = 15000 / 0.95.
        gross = 15000 / 0.95
        monthly_ctc = gross + 1800
        result = self.calculate(salary_structure=self.sds_salary(monthly_ctc))

        self.assertEqual(result["statutory"]["pf"]["base_wage"], 15000)
        self.assertEqual(result["statutory"]["pf"]["employee_wage"], 15000)
        self.assertEqual(result["statutory"]["pf"]["employer_wage"], 15000)
        self.assertEqual(result["totals"]["pf_employee"], 1800)
        self.assertEqual(result["totals"]["pf_employer"], 1800)

    def test_higher_wage_flags_do_not_bypass_pf_ceiling(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["pf"].update(
            {
                "employee_rate_percent": 99,
                "employer_rate_percent": 99,
                "wage_ceiling": 999999,
                "wage_base_component_codes": ["basic"],
                "allow_higher_wage_contribution": True,
                "employee_higher_wage_enabled": True,
                "employer_higher_wage_enabled": True,
            }
        )

        result = self.calculate(statutory_config=config)

        self.assertEqual(result["statutory"]["pf"]["base_wage"], 19950)
        self.assertEqual(result["statutory"]["pf"]["employee_wage"], 15000)
        self.assertEqual(result["statutory"]["pf"]["employer_wage"], 15000)
        self.assertEqual(result["totals"]["pf_employee"], 1800)
        self.assertEqual(result["totals"]["pf_employer"], 1800)

    def test_professional_tax_gross_exactly_15000_is_zero(self) -> None:
        """D: Gross exactly 15,000 => PT 0."""
        config = self.config_without_pf()
        result = self.calculate(
            salary_structure=self.sds_salary(15000),
            statutory_config=config,
            inputs={},
        )
        self.assertEqual(result["totals"]["gross_salary"], 15000)
        self.assertEqual(result["totals"]["professional_tax"], 0)

    def test_professional_tax_gross_just_above_15000_is_180(self) -> None:
        """E: Gross just above 15,000 => PT 180."""
        config = self.config_without_pf()
        result = self.calculate(
            salary_structure=self.sds_salary(15001),
            statutory_config=config,
            inputs={},
        )
        self.assertEqual(result["totals"]["gross_salary"], 15001)
        self.assertEqual(result["totals"]["professional_tax"], 180)

    def test_professional_tax_gross_exactly_25000_is_208(self) -> None:
        """F: Gross exactly 25,000 => PT 208."""
        config = self.config_without_pf()
        result = self.calculate(
            salary_structure=self.sds_salary(25000),
            statutory_config=config,
            inputs={},
        )
        self.assertEqual(result["totals"]["gross_salary"], 25000)
        self.assertEqual(result["totals"]["professional_tax"], 208)

    def test_employer_pf_is_not_double_deducted_from_net(self) -> None:
        """G: Net is Gross - employee PF - PT when no other employee deduction exists."""
        result = self.calculate()

        expected_net = (
            result["totals"]["gross_salary"]
            - result["totals"]["pf_employee"]
            - result["totals"]["professional_tax"]
        )
        self.assertEqual(expected_net, 19020)
        self.assertEqual(result["totals"]["net_amount"], expected_net)

    def test_ctc_equals_gross_plus_employer_pf_without_other_employer_contribution(self) -> None:
        """H: employer PF is inside configured CTC and reconciles exactly."""
        result = self.calculate()

        self.assertEqual(result["totals"]["esi_employer"], 0)
        self.assertEqual(
            result["totals"]["cost_to_company"],
            result["totals"]["gross_salary"] + result["totals"]["pf_employer"],
        )
        self.assertEqual(result["totals"]["cost_to_company"], 22800)

    def test_paid_leave_is_tracking_only_and_does_not_reduce_salary(self) -> None:
        """J: paid leave must remain non-deductible."""
        attendance = copy.deepcopy(self.attendance)
        attendance["paid_leave_days"] = 5

        result = self.calculate(attendance=attendance)

        self.assertEqual(result["attendance"]["paid_leave_days"], 5.0)
        self.assertFalse(result["attendance"]["paid_leave_affects_salary"])
        self.assertEqual(result["attendance"]["proration_factor"], 1.0)
        self.assertEqual(result["totals"]["lwp_deduction"], 0)
        self.assertEqual(result["totals"]["net_amount"], 19020)

    def test_positive_lwp_requires_an_explicit_divisor_policy(self) -> None:
        attendance = copy.deepcopy(self.attendance)
        attendance["lwp_days"] = 1

        with self.assertRaises(PayrollCalculationError) as context:
            self.calculate(attendance=attendance)

        self.assertEqual(context.exception.code, "lwp_divisor_not_configured")
        self.assertEqual(context.exception.field, "statutory_config.lwp.divisor_mode")

    def test_calendar_day_lwp_prorates_salary_once_and_recalculates_pf(self) -> None:
        """I: existing LWP behavior remains, with PF recomputed on payable earnings."""
        config = copy.deepcopy(self.statutory_config)
        config["lwp"]["divisor_mode"] = "calendar_days"
        attendance = copy.deepcopy(self.attendance)
        attendance["lwp_days"] = 1

        result = self.calculate(statutory_config=config, attendance=attendance)

        self.assertEqual(result["attendance"]["divisor_days"], 30.0)
        self.assertEqual(result["attendance"]["payable_days"], 29.0)
        self.assertAlmostEqual(
            result["attendance"]["proration_factor"],
            29 / 30,
            places=8,
        )

        self.assertEqual(result["totals"]["gross_salary"], 21000)
        self.assertEqual(result["totals"]["payable_gross_salary"], 20300)
        self.assertEqual(result["totals"]["lwp_deduction"], 700)

        # PF wage remains above ceiling after one-day LWP, so both PF values stay capped.
        self.assertEqual(result["statutory"]["pf"]["employee_wage"], 15000)
        self.assertEqual(result["totals"]["pf_employee"], 1800)
        self.assertEqual(result["totals"]["pf_employer"], 1800)

        # Employer PF pass-through cancels only employer contribution; no double deduction.
        self.assertEqual(result["totals"]["net_amount"], 18320)

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
        self.assertEqual(result["totals"]["lwp_deduction"], 700)

    def test_working_day_lwp_policy_uses_attendance_working_days(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["lwp"]["divisor_mode"] = "working_days"
        attendance = copy.deepcopy(self.attendance)
        attendance["working_days"] = 26
        attendance["lwp_days"] = 1

        result = self.calculate(statutory_config=config, attendance=attendance)

        self.assertEqual(result["attendance"]["divisor_days"], 26.0)
        self.assertEqual(result["attendance"]["payable_days"], 25.0)
        self.assertEqual(result["totals"]["lwp_deduction"], 808)

    def test_manual_tds_must_be_supplied_and_is_not_estimated(self) -> None:
        """K: manual TDS still requires an explicit payroll input."""
        with self.assertRaises(PayrollCalculationError) as context:
            self.calculate(inputs={})

        self.assertEqual(context.exception.code, "tds_amount_required")
        self.assertEqual(context.exception.field, "inputs.tds_amount")

        result = self.calculate(inputs={"tds_amount": 1250})
        self.assertEqual(result["statutory"]["tds"]["mode"], "manual")
        self.assertFalse(result["statutory"]["tds"]["calculated_by_engine"])
        self.assertEqual(result["totals"]["tds"], 1250)
        self.assertEqual(result["totals"]["net_amount"], 17770)

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
        self.assertEqual(result["totals"]["total_deductions"], 4280)
        self.assertEqual(result["totals"]["net_amount"], 18520)
        self.assertEqual(len(result["advance_details"]), 1)
        self.assertEqual(result["advance_details"][0]["reference_id"], "advance-active")
        self.assertEqual(
            component_amount(result["deductions"], "personal_advance"),
            500,
        )

    def test_advance_total_mismatch_is_rejected(self) -> None:
        """L: explicit advance total must reconcile to recoverable advance rows."""
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

    def test_two_decimal_rounding_preserves_paise_below_pf_ceiling(self) -> None:
        """M: two-decimal mode preserves paise in uncapped PF calculations."""
        config = copy.deepcopy(self.statutory_config)
        config["rounding_mode"] = "two_decimals"

        # Pick a CTC that resolves below PF ceiling and produces paise.
        result = self.calculate(
            salary_structure=self.sds_salary(13368.55),
            statutory_config=config,
        )

        self.assertIsInstance(result["totals"]["pf_employee"], float)
        self.assertIsInstance(result["totals"]["pf_employer"], float)
        self.assertEqual(
            result["totals"]["pf_employee"],
            result["totals"]["pf_employer"],
        )
        self.assertEqual(
            round(result["totals"]["cost_to_company"], 2),
            round(
                result["totals"]["gross_salary"]
                + result["totals"]["pf_employer"],
                2,
            ),
        )

    def test_pf_configuration_cannot_switch_to_basic_only(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["pf"]["wage_base_component_codes"] = ["basic"]

        result = self.calculate(statutory_config=config)

        self.assertEqual(result["statutory"]["pf"]["base_wage"], 19950)
        self.assertEqual(result["totals"]["pf_employee"], 1800)
        self.assertEqual(result["totals"]["pf_employer"], 1800)

    def test_pf_rate_and_ceiling_configuration_cannot_override_sds_rule(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["pf"]["employee_rate_percent"] = 1
        config["pf"]["employer_rate_percent"] = 50
        config["pf"]["wage_ceiling"] = 999999

        result = self.calculate(statutory_config=config)

        self.assertEqual(result["statutory"]["pf"]["employee_wage"], 15000)
        self.assertEqual(result["statutory"]["pf"]["employer_wage"], 15000)
        self.assertEqual(result["totals"]["pf_employee"], 1800)
        self.assertEqual(result["totals"]["pf_employer"], 1800)

    def test_professional_tax_basis_configuration_cannot_override_gross(self) -> None:
        config = copy.deepcopy(self.statutory_config)
        config["pf"] = {"enabled": False}
        config["tds"] = {"mode": "disabled"}
        config["professional_tax"]["basis"] = "monthly_ctc"

        result = self.calculate(
            salary_structure=self.sds_salary(15001),
            statutory_config=config,
            inputs={},
        )

        self.assertEqual(result["totals"]["gross_salary"], 15001)
        self.assertEqual(result["totals"]["professional_tax"], 180)

    def test_negative_net_salary_is_rejected(self) -> None:
        config = self.config_without_pf(tds_mode="manual")
        config["professional_tax"]["enabled"] = False

        with self.assertRaises(PayrollCalculationError) as context:
            self.calculate(
                salary_structure=self.sds_salary(1000),
                statutory_config=config,
                inputs={"tds_amount": 2000},
            )

        self.assertEqual(context.exception.code, "negative_net_amount")
        self.assertEqual(context.exception.field, "deductions")

    def test_result_contains_only_json_serialisable_money_values(self) -> None:
        result = self.calculate()
        encoded = json.dumps(result)

        self.assertIn('"net_amount": 19020', encoded)


if __name__ == "__main__":
    unittest.main(verbosity=2)
