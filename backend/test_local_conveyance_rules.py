"""Standalone LC domain tests. No MongoDB/network/Flask needed.
Run: python backend/test_local_conveyance_rules.py
"""
import importlib.util
from pathlib import Path
import unittest
from decimal import Decimal

MODULE = Path(__file__).parent / 'app' / 'services' / 'local_conveyance.py'
spec = importlib.util.spec_from_file_location('lc_rules_under_test', MODULE)
lc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lc)


class SettingsCollection:
    def __init__(self, config=None): self.config = config
    def find_one(self, query):
        assert query['tenant_id'] == query['_id'].split('local-conveyance:', 1)[1]
        return self.config


class FieldCollection:
    def __init__(self): self.query = None
    def find_one(self, query, fields=None):
        self.query = query
        return {'_id': 'v1', 'title': 'Test Visit'} if self.query.get('tenant_id') == 'sds' else None


class DB:
    def __init__(self, config=None):
        self.system_settings = SettingsCollection(config)
        self.field_visits = FieldCollection()


class LocalConveyanceRules(unittest.TestCase):
    def setUp(self):
        self.rates = lc.tenant_rates(DB(), 'sds')
        self.base = dict(travel_mode=lc.MODE_TWO, from_location='Office',
                         to_location='Field', purpose='FPO review', start_km=12450)

    def start(self, **updates):
        return lc.start_travel({**self.base, **updates}, self.rates)

    def test_default_two_rate(self): self.assertEqual(self.rates[lc.MODE_TWO], Decimal('4'))
    def test_default_four_rate(self): self.assertEqual(self.rates[lc.MODE_FOUR], Decimal('14'))
    def test_tenant_custom_rates(self):
        x=lc.tenant_rates(DB({'two_wheeler_rate':5,'four_wheeler_rate':16}), 'sds')
        self.assertEqual(x[lc.MODE_TWO],5)
        self.assertEqual(x[lc.MODE_FOUR],16)
    def test_invalid_stored_rate_fallback(self):
        x=lc.tenant_rates(DB({'two_wheeler_rate':'NaN','four_wheeler_rate':-5}), 'sds')
        self.assertEqual(x,self.rates)
    def test_valid_admin_rates(self): self.assertEqual(lc.validate_rates({'two_wheeler_rate':4,'four_wheeler_rate':14}),{'two_wheeler_rate':4.0,'four_wheeler_rate':14.0})
    def test_invalid_admin_rate_zero(self):
        with self.assertRaises(ValueError): lc.validate_rates({'two_wheeler_rate':0,'four_wheeler_rate':14})
    def test_invalid_admin_rate_negative(self):
        with self.assertRaises(ValueError): lc.validate_rates({'two_wheeler_rate':-1,'four_wheeler_rate':14})
    def test_two_wheeler_start_fields(self):
        v=self.start(vehicle_number='AS01AB0000')
        self.assertEqual(v['vehicle_number'],'AS01AB0000')
        self.assertEqual(v['start_km'],12450.0)
        self.assertNotIn('end_km', v)
    def test_four_wheeler_start_fields(self):
        v=self.start(travel_mode=lc.MODE_FOUR)
        self.assertEqual(v['rate'],14.0)
    def test_two_wheeler_finish_math(self):
        v=lc.finish_travel(self.start(),{'end_km':12490})
        self.assertEqual(v['distance_km'],40)
        self.assertEqual(v['amount'],160)
    def test_four_wheeler_finish_math(self):
        v=lc.finish_travel(self.start(travel_mode=lc.MODE_FOUR),{'end_km':12490})
        self.assertEqual(v['amount'],560)
    def test_decimal_odometer_rates(self):
        v=lc.finish_travel(self.start(start_km='10.25'),{'end_km':'11.50'})
        self.assertEqual(v['distance_km'],1.25)
        self.assertEqual(v['amount'],5)
    def test_end_not_needed_at_start(self): self.assertNotIn('end_km',self.start())
    def test_start_missing_km_rejected(self):
        with self.assertRaisesRegex(ValueError,'Starting'): self.start(start_km='')
    def test_end_missing_km_rejected(self):
        with self.assertRaisesRegex(ValueError,'Ending'): lc.finish_travel(self.start(),{})
    def test_end_smaller_than_start_rejected(self):
        with self.assertRaisesRegex(ValueError,'less than'): lc.finish_travel(self.start(),{'end_km':12449})
    def test_negative_start_rejected(self):
        with self.assertRaises(ValueError): self.start(start_km=-1)
    def test_non_numeric_km_rejected(self):
        with self.assertRaises(ValueError): self.start(start_km='forty')
    def test_infinite_km_rejected(self):
        with self.assertRaises(ValueError): self.start(start_km='Infinity')
    def test_excess_precision_km_rejected(self):
        with self.assertRaisesRegex(ValueError,'two decimal'): self.start(start_km='100.999')
    def test_negative_end_rejected(self):
        with self.assertRaises(ValueError): lc.finish_travel(self.start(),{'end_km':-3})
    def test_equal_km_is_zero_eligible(self):
        v=lc.finish_travel(self.start(),{'end_km':12450})
        self.assertEqual(v['amount'],0)
        self.assertTrue(v['eligible'])
    def test_public_auto_saves_fare(self):
        v=self.start(travel_mode=lc.MODE_PUBLIC,transport_type='auto',fare='180.50')
        self.assertEqual(v['fare'],180.5)
        self.assertNotIn('start_km',v)
        self.assertEqual(lc.finish_travel(v,{})['amount'],180.5)
    def test_public_bus_saves_fare(self):
        v=self.start(travel_mode=lc.MODE_PUBLIC,transport_type='bus',fare=35)
        self.assertEqual(lc.finish_travel(v,{})['amount'],35)
    def test_public_taxi(self):
        v=self.start(travel_mode=lc.MODE_PUBLIC,transport_type='rented_car_taxi',fare=850)
        self.assertTrue(lc.finish_travel(v,{})['eligible'])
    def test_public_other_details_required(self):
        with self.assertRaisesRegex(ValueError,'Specify'): self.start(travel_mode=lc.MODE_PUBLIC,transport_type='other',fare=95)
    def test_public_other_details_saved(self):
        v=self.start(travel_mode=lc.MODE_PUBLIC,transport_type='other',transport_other='shared van',fare=95)
        self.assertEqual(v['transport_other'],'shared van')
    def test_negative_fare_rejected(self):
        with self.assertRaises(ValueError): self.start(travel_mode=lc.MODE_PUBLIC,transport_type='auto',fare=-1)
    def test_public_fare_may_be_added_at_end(self):
        visit=self.start(travel_mode=lc.MODE_PUBLIC,transport_type='auto',fare='')
        with self.assertRaisesRegex(ValueError,'[Ff]are'): lc.finish_travel(visit,{})
        ended=lc.finish_travel(visit,{'fare':190})
        self.assertEqual(ended['amount'],190)
        self.assertEqual(ended['fare'],190)
    def test_public_no_odometer_at_end(self):
        v=self.start(travel_mode=lc.MODE_PUBLIC,transport_type='bus',fare=85)
        self.assertNotIn('end_km',lc.finish_travel(v,{}))
    def test_official_vehicle_zero_lc(self):
        v=self.start(travel_mode=lc.MODE_OFFICIAL,start_km='not necessary',fare='not needed')
        self.assertNotIn('start_km',v)
        self.assertEqual(lc.finish_travel(v,{})['amount'],0)
        self.assertFalse(lc.finish_travel(v,{})['eligible'])
    def test_legacy_flutter_start_remains_compatible(self):
        v=lc.start_travel({},self.rates)
        self.assertEqual(v['mode'],lc.MODE_LEGACY)
        self.assertFalse(lc.finish_travel(v,{})['eligible'])
    def test_strict_start_rejects_missing_mode(self):
        with self.assertRaises(ValueError): lc.start_travel({},self.rates,allow_legacy=False)
    def test_invalid_mode_rejected(self):
        with self.assertRaises(ValueError): self.start(travel_mode='drone')
    def test_from_to_purpose_mandatory(self):
        for k in ('from_location','to_location','purpose'):
            with self.subTest(k=k),self.assertRaises(ValueError): self.start(**{k:''})
    def test_saved_rate_survives_settings_change(self):
        old=self.start()
        self.rates[lc.MODE_TWO]=Decimal('20')
        self.assertEqual(lc.finish_travel(old,{'end_km':12460})['amount'],40)
    def test_employee_query_tenant_isolated(self):
        q=lc.active_visit_query('sds',{'_id':'emp1','employee_code':'SDS-001'})
        self.assertEqual(q['tenant_id'],'sds')
        self.assertEqual(q['status']['$in'],['started','reached'])
        self.assertIn('emp1',q['employee_ref_id']['$in'])
    def test_active_visit_found(self): self.assertTrue(lc.has_active_visit(DB(),'sds',{'_id':'e1'}))
    def test_cross_tenant_query_no_active(self): self.assertIsNone(lc.has_active_visit(DB(),'other',{'_id':'e1'}))


if __name__=='__main__': unittest.main(verbosity=2)
