"""Regression tests for working-day leave deduction and Holiday Calendar policy.

Run from backend: python -m unittest discover -s tests -p test_leave_working_days.py -v
"""
import unittest
from datetime import date
from unittest.mock import MagicMock

from app.services.leave_working_days import calculate_chargeable_leave_period
from app.routes.attendance import weekly_holiday_reason
from app.routes.workflow import leave_working_day_preview


class LeaveWorkingDayRules(unittest.TestCase):
    def calc(self, start='2026-12-01', end='2026-12-11', holidays=(), half=False):
        return calculate_chargeable_leave_period(
            start, end, holidays, weekly_holiday_reason, half_day=half
        )

    def test_dec_1_to_11_excludes_sunday(self):
        result = self.calc()
        self.assertEqual(result['calendar_days'], 11)
        self.assertEqual(result['chargeable_days'], 10)
        self.assertEqual(result['weekly_off_days'], 1)
        self.assertEqual(result['declared_holiday_days'], 0)
        self.assertNotIn('2026-12-06', result['working_dates'])

    def test_two_extra_state_holidays_excluded(self):
        result = self.calc(holidays=[
            {'date': '2026-12-03', 'title': 'State holiday A'},
            {'start_date': '2026-12-09', 'end_date': '2026-12-09', 'title': 'State holiday B'},
        ])
        self.assertEqual(result['chargeable_days'], 8)
        self.assertEqual(result['excluded_days'], 3)

    def test_declared_holiday_overlapping_sunday_counted_once(self):
        result = self.calc(holidays=[{'date':'2026-12-06', 'title':'Declared Sunday'}])
        self.assertEqual(result['excluded_days'], 1)
        self.assertEqual(result['chargeable_days'], 10)

    def test_second_fourth_saturday_excluded(self):
        result = self.calc('2026-12-01', '2026-12-31')
        self.assertNotIn('2026-12-12', result['working_dates'])
        self.assertNotIn('2026-12-26', result['working_dates'])
        self.assertEqual(result['weekly_off_days'], 6)  # 4 Sundays + 2 Saturdays

    def test_holiday_range_multiple_days(self):
        result = self.calc(holidays=[{
            'start_date':'2026-12-02','end_date':'2026-12-04','title':'3-day shutdown'
        }])
        self.assertEqual(result['chargeable_days'], 7)

    def test_duplicate_holidays_do_not_double_deduct(self):
        result = self.calc(holidays=[
            {'date':'2026-12-03'}, {'date':'2026-12-03'}
        ])
        self.assertEqual(result['chargeable_days'], 9)
        self.assertEqual(result['declared_holiday_days'], 1)

    def test_half_day_on_working_date(self):
        self.assertEqual(self.calc('2026-12-01','2026-12-01',half=True)['chargeable_days'],0.5)

    def test_half_day_on_sunday_charges_zero(self):
        self.assertEqual(self.calc('2026-12-06','2026-12-06',half=True)['chargeable_days'],0)

    def test_rejects_half_day_multi_day(self):
        with self.assertRaises(ValueError):
            self.calc(half=True)

    def test_rejects_reverse_dates(self):
        with self.assertRaises(ValueError):
            self.calc('2026-12-11','2026-12-01')

    def test_rejects_abnormally_long_range(self):
        with self.assertRaises(ValueError):
            self.calc('2026-01-01','2027-12-31')

    def test_state_and_tenant_scoped_query(self):
        db = MagicMock()
        db.holiday_calendar.find.return_value = [
            {'date': '2026-12-03', 'title': 'Assam state holiday'}
        ]
        employee = {'tenant_id':'tenant-a', 'state':'Assam(HO)'}
        preview = leave_working_day_preview(db, employee,
                                            date(2026,12,1),date(2026,12,11))
        query = db.holiday_calendar.find.call_args.args[0]
        self.assertEqual(query['tenant_id'],'tenant-a')
        self.assertEqual(preview['chargeable_days'],9)
        self.assertTrue(query['state'])
        self.assertEqual(query['is_deleted'], {'$ne': True})


if __name__ == '__main__':
    unittest.main()
