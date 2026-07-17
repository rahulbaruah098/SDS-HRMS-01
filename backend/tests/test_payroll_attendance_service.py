from __future__ import annotations

import unittest
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from bson import ObjectId
from pymongo import ReturnDocument

from app.services.payroll_attendance_service import (
    PayrollAttendanceError,
    PayrollPeriod,
    assert_payroll_period_is_editable,
    attendance_log_summary,
    build_attendance_summary,
    get_saved_attendance_summary,
    is_second_or_fourth_saturday,
    leave_summary_for_employee,
    normalize_employee_state,
    resolve_payroll_period,
    save_attendance_summary,
    sync_attendance_summaries,
    working_dates_for_employee,
)


TENANT_ID = "tenant-demo"
EMPLOYEE_ID = ObjectId("64b64c5d8f4b2a0012345678")


def employee_record(**overrides):
    row = {
        "_id": EMPLOYEE_ID,
        "tenant_id": TENANT_ID,
        "employee_code": "SDS-001",
        "employee_name": "Payroll Employee",
        "department": "IT",
        "designation": "Engineer",
        "state": "Assam(HO)",
        "status": "active",
    }
    row.update(overrides)
    return row


def period(year=2025, month=8):
    return resolve_payroll_period(f"{year:04d}-{month:02d}")


class PayrollPeriodTests(unittest.TestCase):
    def test_resolve_regular_month(self):
        result = resolve_payroll_period("2026-02")

        self.assertEqual(result.period_key, "2026-02")
        self.assertEqual(result.total_days, 28)
        self.assertEqual(result.start_date, date(2026, 2, 1))
        self.assertEqual(result.end_date, date(2026, 2, 28))

    def test_resolve_leap_year_month(self):
        result = resolve_payroll_period(month=2, year=2024)

        self.assertEqual(result.total_days, 29)
        self.assertEqual(result.end_date, date(2024, 2, 29))

    def test_rejects_invalid_period_format(self):
        with self.assertRaises(PayrollAttendanceError) as context:
            resolve_payroll_period("08-2025")

        self.assertEqual(context.exception.code, "invalid_payroll_period")

    def test_second_and_fourth_saturday_detection(self):
        self.assertFalse(is_second_or_fourth_saturday(date(2025, 8, 2)))
        self.assertTrue(is_second_or_fourth_saturday(date(2025, 8, 9)))
        self.assertFalse(is_second_or_fourth_saturday(date(2025, 8, 16)))
        self.assertTrue(is_second_or_fourth_saturday(date(2025, 8, 23)))

    def test_employee_state_normalization(self):
        self.assertEqual(normalize_employee_state("Assam"), "Assam(HO)")
        self.assertEqual(normalize_employee_state("Assam/Guwahati (HO)"), "Assam(HO)")
        self.assertEqual(normalize_employee_state("Tripura"), "Tripura")


class WorkingCalendarTests(unittest.TestCase):
    def test_working_dates_exclude_sundays_second_fourth_saturdays_and_holiday(self):
        holiday_calendar = MagicMock()
        holiday_calendar.find.return_value = [{"date": "2025-08-15"}]
        db = SimpleNamespace(holiday_calendar=holiday_calendar)

        working_dates, holidays = working_dates_for_employee(
            db,
            TENANT_ID,
            employee_record(),
            period(),
        )

        self.assertEqual(len(working_dates), 23)
        self.assertNotIn("2025-08-03", working_dates)  # Sunday
        self.assertNotIn("2025-08-09", working_dates)  # Second Saturday
        self.assertNotIn("2025-08-15", working_dates)  # Configured holiday
        self.assertNotIn("2025-08-23", working_dates)  # Fourth Saturday
        self.assertIn("2025-08-02", working_dates)  # First Saturday
        self.assertEqual(holidays["configured_holidays"], ["2025-08-15"])


class LeaveSummaryTests(unittest.TestCase):
    def make_db(self, leave_rows, balances=None):
        leave_requests = MagicMock()
        leave_requests.find.return_value = leave_rows
        leave_balances = MagicMock()
        leave_balances.find.return_value = balances or []
        return SimpleNamespace(
            leave_requests=leave_requests,
            leave_balances=leave_balances,
        )

    def test_paid_leave_does_not_create_lwp(self):
        db = self.make_db(
            [{
                "_id": ObjectId(),
                "from_date": "2025-08-04",
                "to_date": "2025-08-05",
                "leave_type": "CL",
                "leave_days": 2,
            }],
            [
                {"leave_type": "CL", "available": 5},
                {"leave_type": "EL", "available": 10},
                {"leave_type": "COMP_OFF", "available": 3},
            ],
        )

        result = leave_summary_for_employee(
            db,
            TENANT_ID,
            employee_record(),
            period(),
            ["2025-08-04", "2025-08-05"],
        )

        self.assertEqual(result["paid_leave_days"], 2)
        self.assertEqual(result["lwp_days"], 0)
        self.assertEqual(result["leave_availed"], 2)
        self.assertEqual(result["leave_balance"], 15)
        self.assertEqual(result["leave_balance_by_type"]["COMP_OFF"], 3)

    def test_full_lwp_leave_is_counted_as_lwp_only(self):
        db = self.make_db([{
            "_id": ObjectId(),
            "from_date": "2025-08-04",
            "to_date": "2025-08-04",
            "leave_type": "Leave Without Pay",
            "leave_days": 1,
        }])

        result = leave_summary_for_employee(
            db,
            TENANT_ID,
            employee_record(),
            period(),
            ["2025-08-04"],
        )

        self.assertEqual(result["paid_leave_days"], 0)
        self.assertEqual(result["lwp_days"], 1)
        self.assertEqual(result["leave_availed"], 1)

    def test_half_day_paid_leave_is_preserved(self):
        db = self.make_db([{
            "_id": ObjectId(),
            "from_date": "2025-08-04",
            "to_date": "2025-08-04",
            "leave_type": "CL",
            "leave_days": 0.5,
            "is_half_day": True,
        }])

        result = leave_summary_for_employee(
            db,
            TENANT_ID,
            employee_record(),
            period(),
            ["2025-08-04"],
        )

        self.assertEqual(result["paid_leave_days"], 0.5)
        self.assertEqual(result["lwp_days"], 0)

    def test_explicit_partial_lwp_splits_one_leave_day(self):
        db = self.make_db([{
            "_id": ObjectId(),
            "from_date": "2025-08-04",
            "to_date": "2025-08-04",
            "leave_type": "CL",
            "leave_days": 1,
            "lwp_days": 0.5,
        }])

        result = leave_summary_for_employee(
            db,
            TENANT_ID,
            employee_record(),
            period(),
            ["2025-08-04"],
        )

        self.assertEqual(result["paid_leave_days"], 0.5)
        self.assertEqual(result["lwp_days"], 0.5)
        self.assertEqual(result["leave_availed"], 1)


class AttendanceLogTests(unittest.TestCase):
    def test_attendance_logs_are_grouped_by_date(self):
        attendance_logs = MagicMock()
        attendance_logs.find.return_value = [
            {
                "_id": ObjectId(),
                "date": "2025-08-04",
                "status": "late",
                "check_out": "18:05",
                "is_holiday_work": False,
                "updated_at": datetime(2025, 8, 4, 18, 5),
            },
            {
                "_id": ObjectId(),
                "date": "2025-08-04",
                "status": "present",
                "check_out": "18:10",
            },
            {
                "_id": ObjectId(),
                "date": "2025-08-05",
                "status": "present",
                "check_out": "",
                "is_holiday_work": True,
            },
        ]
        db = SimpleNamespace(attendance_logs=attendance_logs)

        result = attendance_log_summary(
            db,
            TENANT_ID,
            str(EMPLOYEE_ID),
            period(),
        )

        self.assertEqual(result["attendance_log_count"], 3)
        self.assertEqual(result["present_days"], 2)
        self.assertEqual(result["late_days"], 1)
        self.assertEqual(result["complete_attendance_days"], 1)
        self.assertEqual(result["incomplete_attendance_days"], 1)
        self.assertEqual(result["holiday_work_days"], 1)


class PayrollRunProtectionTests(unittest.TestCase):
    def test_sync_is_allowed_when_no_run_exists(self):
        payroll_runs = MagicMock()
        payroll_runs.find_one.return_value = None
        db = SimpleNamespace(payroll_runs=payroll_runs)

        assert_payroll_period_is_editable(db, TENANT_ID, "2025-08")

    def test_sync_is_blocked_after_hr_review(self):
        payroll_runs = MagicMock()
        payroll_runs.find_one.return_value = {
            "_id": ObjectId(),
            "status": "hr_reviewed",
            "is_locked": False,
        }
        db = SimpleNamespace(payroll_runs=payroll_runs)

        with self.assertRaises(PayrollAttendanceError) as context:
            assert_payroll_period_is_editable(db, TENANT_ID, "2025-08")

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(context.exception.code, "payroll_period_not_editable")

    def test_sync_is_blocked_when_lock_flag_is_true(self):
        payroll_runs = MagicMock()
        payroll_runs.find_one.return_value = {
            "_id": ObjectId(),
            "status": "draft",
            "is_locked": True,
        }
        db = SimpleNamespace(payroll_runs=payroll_runs)

        with self.assertRaises(PayrollAttendanceError):
            assert_payroll_period_is_editable(db, TENANT_ID, "2025-08")


class AttendanceSummaryTests(unittest.TestCase):
    @patch(
        "app.services.payroll_attendance_service.attendance_log_summary"
    )
    @patch(
        "app.services.payroll_attendance_service.leave_summary_for_employee"
    )
    @patch(
        "app.services.payroll_attendance_service.working_dates_for_employee"
    )
    def test_uncovered_absence_is_not_converted_to_lwp(
        self,
        mock_working_dates,
        mock_leave_summary,
        mock_attendance_summary,
    ):
        mock_working_dates.return_value = (
            ["2025-08-04", "2025-08-05", "2025-08-06"],
            {
                "weekly_holidays": [],
                "configured_holidays": [],
            },
        )
        mock_leave_summary.return_value = {
            "paid_leave_days": 1,
            "lwp_days": 0,
            "leave_availed": 1,
            "leave_balance": 10,
            "leave_balance_by_type": {"CL": 5, "EL": 5},
            "paid_leave_dates": ["2025-08-05"],
            "lwp_dates": [],
            "leave_request_ids": ["leave-1"],
            "warnings": [],
        }
        mock_attendance_summary.return_value = {
            "attendance_log_count": 1,
            "present_days": 1,
            "present_dates": ["2025-08-04"],
            "late_days": 0,
            "late_dates": [],
            "complete_attendance_days": 1,
            "complete_attendance_dates": ["2025-08-04"],
            "incomplete_attendance_days": 0,
            "incomplete_attendance_dates": [],
            "holiday_work_days": 0,
            "holiday_work_dates": [],
            "attendance_log_ids": ["attendance-1"],
            "attendance_latest_updated_at": None,
        }

        result = build_attendance_summary(
            SimpleNamespace(),
            TENANT_ID,
            employee_record(),
            period(),
        )

        self.assertEqual(result["lwp_days"], 0)
        self.assertEqual(result["absent_days"], 1)
        self.assertEqual(result["payable_days"], 31)
        self.assertTrue(
            any("not converted to LWP" in warning for warning in result["warnings"])
        )

    @patch(
        "app.services.payroll_attendance_service.attendance_log_summary"
    )
    @patch(
        "app.services.payroll_attendance_service.leave_summary_for_employee"
    )
    @patch(
        "app.services.payroll_attendance_service.working_dates_for_employee"
    )
    def test_only_lwp_reduces_payable_calendar_days(
        self,
        mock_working_dates,
        mock_leave_summary,
        mock_attendance_summary,
    ):
        mock_working_dates.return_value = (
            ["2025-08-04", "2025-08-05"],
            {
                "weekly_holidays": [],
                "configured_holidays": [],
            },
        )
        mock_leave_summary.return_value = {
            "paid_leave_days": 1,
            "lwp_days": 1,
            "leave_availed": 2,
            "leave_balance": 10,
            "leave_balance_by_type": {"CL": 5, "EL": 5},
            "paid_leave_dates": ["2025-08-04"],
            "lwp_dates": ["2025-08-05"],
            "leave_request_ids": ["leave-1", "leave-2"],
            "warnings": [],
        }
        mock_attendance_summary.return_value = {
            "attendance_log_count": 0,
            "present_days": 0,
            "present_dates": [],
            "late_days": 0,
            "late_dates": [],
            "complete_attendance_days": 0,
            "complete_attendance_dates": [],
            "incomplete_attendance_days": 0,
            "incomplete_attendance_dates": [],
            "holiday_work_days": 0,
            "holiday_work_dates": [],
            "attendance_log_ids": [],
            "attendance_latest_updated_at": None,
        }

        result = build_attendance_summary(
            SimpleNamespace(),
            TENANT_ID,
            employee_record(),
            period(),
        )

        self.assertEqual(result["paid_leave_days"], 1)
        self.assertEqual(result["lwp_days"], 1)
        self.assertEqual(result["payable_days"], 30)
        self.assertEqual(result["absent_days"], 0)

    @patch(
        "app.services.payroll_attendance_service.attendance_log_summary"
    )
    @patch(
        "app.services.payroll_attendance_service.leave_summary_for_employee"
    )
    @patch(
        "app.services.payroll_attendance_service.working_dates_for_employee"
    )
    def test_joining_during_month_creates_warning_without_assumed_deduction(
        self,
        mock_working_dates,
        mock_leave_summary,
        mock_attendance_summary,
    ):
        mock_working_dates.return_value = (
            ["2025-08-04"],
            {"weekly_holidays": [], "configured_holidays": []},
        )
        mock_leave_summary.return_value = {
            "paid_leave_days": 0,
            "lwp_days": 0,
            "leave_availed": 0,
            "leave_balance": 10,
            "leave_balance_by_type": {"CL": 5, "EL": 5},
            "paid_leave_dates": [],
            "lwp_dates": [],
            "leave_request_ids": [],
            "warnings": [],
        }
        mock_attendance_summary.return_value = {
            "attendance_log_count": 1,
            "present_days": 1,
            "present_dates": ["2025-08-04"],
            "late_days": 0,
            "late_dates": [],
            "complete_attendance_days": 1,
            "complete_attendance_dates": ["2025-08-04"],
            "incomplete_attendance_days": 0,
            "incomplete_attendance_dates": [],
            "holiday_work_days": 0,
            "holiday_work_dates": [],
            "attendance_log_ids": ["attendance-1"],
            "attendance_latest_updated_at": None,
        }

        result = build_attendance_summary(
            SimpleNamespace(),
            TENANT_ID,
            employee_record(date_of_joining="2025-08-04"),
            period(),
        )

        self.assertEqual(result["payable_days"], 31)
        self.assertTrue(
            any("joined during this payroll month" in warning for warning in result["warnings"])
        )


class PersistenceTests(unittest.TestCase):
    def test_attendance_summary_is_upserted_by_employee_and_period(self):
        collection = MagicMock()
        expected = {
            "_id": ObjectId(),
            "tenant_id": TENANT_ID,
            "employee_id": str(EMPLOYEE_ID),
            "period_key": "2025-08",
        }
        collection.find_one_and_update.return_value = expected
        db = {
            "attendance_summaries": collection,
        }
        summary = {
            "tenant_id": TENANT_ID,
            "employee_id": str(EMPLOYEE_ID),
            "period_key": "2025-08",
            "synced_at": datetime(2025, 8, 31, 12, 0),
            "lwp_days": 0,
        }

        result = save_attendance_summary(db, summary)

        self.assertEqual(result, expected)
        collection.find_one_and_update.assert_called_once()
        call_args = collection.find_one_and_update.call_args
        self.assertEqual(
            call_args.args[0],
            {
                "tenant_id": TENANT_ID,
                "employee_id": str(EMPLOYEE_ID),
                "period_key": "2025-08",
            },
        )
        self.assertTrue(call_args.kwargs["upsert"])
        self.assertEqual(
            call_args.kwargs["return_document"],
            ReturnDocument.AFTER,
        )

    @patch(
        "app.services.payroll_attendance_service.assert_payroll_period_is_editable"
    )
    @patch(
        "app.services.payroll_attendance_service.list_payroll_employees"
    )
    @patch(
        "app.services.payroll_attendance_service.build_attendance_summary"
    )
    @patch(
        "app.services.payroll_attendance_service.save_attendance_summary"
    )
    def test_batch_sync_returns_totals_and_persists_each_summary(
        self,
        mock_save,
        mock_build,
        mock_list,
        mock_editable,
    ):
        employee_one = employee_record()
        employee_two = employee_record(
            _id=ObjectId("64b64c5d8f4b2a0012345679"),
            employee_code="SDS-002",
            employee_name="Second Employee",
        )
        mock_list.return_value = [employee_one, employee_two]

        summary_one = {
            "tenant_id": TENANT_ID,
            "employee_id": str(employee_one["_id"]),
            "period_key": "2025-08",
            "total_days": 31,
            "working_days": 23,
            "present_days": 20,
            "paid_leave_days": 2,
            "lwp_days": 1,
            "absent_days": 0,
        }
        summary_two = {
            "tenant_id": TENANT_ID,
            "employee_id": str(employee_two["_id"]),
            "period_key": "2025-08",
            "total_days": 31,
            "working_days": 23,
            "present_days": 22,
            "paid_leave_days": 1,
            "lwp_days": 0,
            "absent_days": 0,
        }
        mock_build.side_effect = [summary_one, summary_two]
        mock_save.side_effect = [summary_one, summary_two]

        result = sync_attendance_summaries(
            SimpleNamespace(),
            tenant_id=TENANT_ID,
            period="2025-08",
            employee_references=[str(employee_one["_id"]), str(employee_two["_id"])],
            actor_id="user-1",
            actor_name="Finance User",
            persist=True,
        )

        self.assertEqual(result["period_key"], "2025-08")
        self.assertTrue(result["persisted"])
        self.assertEqual(result["totals"]["employees_requested"], 2)
        self.assertEqual(result["totals"]["employees_synced"], 2)
        self.assertEqual(result["totals"]["employees_failed"], 0)
        self.assertEqual(result["totals"]["total_working_days"], 46)
        self.assertEqual(result["totals"]["total_present_days"], 42)
        self.assertEqual(result["totals"]["total_paid_leave_days"], 3)
        self.assertEqual(result["totals"]["total_lwp_days"], 1)
        self.assertEqual(mock_save.call_count, 2)
        mock_editable.assert_called_once()

    @patch(
        "app.services.payroll_attendance_service.find_employee"
    )
    def test_saved_summary_lookup_uses_canonical_employee_id(
        self,
        mock_find_employee,
    ):
        mock_find_employee.return_value = employee_record()
        attendance_summaries = MagicMock()
        expected = {
            "_id": ObjectId(),
            "employee_id": str(EMPLOYEE_ID),
            "period_key": "2025-08",
        }
        attendance_summaries.find_one.return_value = expected
        db = {
            "attendance_summaries": attendance_summaries,
        }

        result = get_saved_attendance_summary(
            db,
            tenant_id=TENANT_ID,
            employee_reference="SDS-001",
            period="2025-08",
        )

        self.assertEqual(result, expected)
        attendance_summaries.find_one.assert_called_once_with({
            "tenant_id": TENANT_ID,
            "employee_id": str(EMPLOYEE_ID),
            "period_key": "2025-08",
            "is_deleted": {"$ne": True},
        })


if __name__ == "__main__":
    unittest.main()