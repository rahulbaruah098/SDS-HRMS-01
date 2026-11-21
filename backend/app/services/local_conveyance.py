# YC_MYVISIT_FARE_DEVICE_TIME_V1
"""My Visit local-conveyance rules. No attendance side effects.

All money is validated/calculated server-side with Decimal. Visits created by an
older mobile client may have no mode; these are NOT reimbursement-eligible.
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

MODE_TWO = "own_two_wheeler"
MODE_FOUR = "own_four_wheeler"
MODE_PUBLIC = "public_transport"
MODE_OFFICIAL = "official_vehicle"
MODE_LEGACY = "legacy_unspecified"
MODES = {MODE_TWO, MODE_FOUR, MODE_PUBLIC, MODE_OFFICIAL}
TRANSPORT_TYPES = {"auto", "bus", "rented_car_taxi", "other"}
DEFAULT_RATES = {MODE_TWO: Decimal("4.00"), MODE_FOUR: Decimal("14.00")}
MAX_KM = Decimal("9999999")
MAX_FARE = Decimal("1000000")


def _amount(value, label, maximum, mandatory=True):
    if value is None or isinstance(value, bool) or str(value).strip() == "":
        if mandatory:
            raise ValueError(f"{label} is required")
        return None
    try:
        number = Decimal(str(value))
    except (ValueError, InvalidOperation):
        raise ValueError(f"{label} must be a valid number")
    if not number.is_finite() or number < 0 or number > maximum:
        raise ValueError(f"{label} must be between 0 and {maximum}")
    if number.as_tuple().exponent < -2:
        raise ValueError(f"{label} allows at most two decimal places")
    return number


def _money(number):
    return float(number.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def tenant_rates(db, tenant_id):
    rates = dict(DEFAULT_RATES)
    setting = db.system_settings.find_one({
        "_id": f"local-conveyance:{tenant_id}",
        "tenant_id": tenant_id,
        "setting_group": "local_conveyance",
        "setting_key": "rates",
        "is_deleted": {"$ne": True},
    }) or {}
    for mode, key in ((MODE_TWO, "two_wheeler_rate"), (MODE_FOUR, "four_wheeler_rate")):
        try:
            v = _amount(setting.get(key), key, Decimal("1000"), mandatory=False)
            if v is not None and v > 0:
                rates[mode] = v
        except ValueError:
            pass  # Never let corrupt settings turn a valid visit into an error.
    return rates


def validate_rates(payload):
    return {
        "two_wheeler_rate": _money(_positive_rate(payload.get("two_wheeler_rate"))),
        "four_wheeler_rate": _money(_positive_rate(payload.get("four_wheeler_rate"))),
    }


def _positive_rate(value):
    v = _amount(value, "Rate", Decimal("1000"))
    if v <= 0:
        raise ValueError("Reimbursement rate must be positive")
    return v


def start_travel(payload, rates, allow_legacy=True):
    """Validated immutable start snapshot, returned for embedding in field_visits."""
    mode = str(payload.get("travel_mode") or "").strip().lower()
    if not mode and allow_legacy:
        # Backward-compatible Flutter clients. They cannot generate an LC bill.
        return {"mode": MODE_LEGACY, "eligible": False, "amount": 0.0}
    if mode not in MODES:
        raise ValueError("Please select a valid mode of travel")
    fields = {
        "mode": mode,
        "from_location": str(payload.get("from_location") or "").strip()[:250],
        "to_location": str(payload.get("to_location") or "").strip()[:250],
        "purpose": str(payload.get("purpose") or "").strip()[:500],
        "project": str(payload.get("project") or "").strip()[:250],
        "remarks": str(payload.get("remarks") or "").strip()[:500],
        "eligible": False,
        "amount": 0.0,
    }
    if mode == MODE_OFFICIAL:
        return fields
    if not fields["from_location"] or not fields["to_location"] or not fields["purpose"]:
        raise ValueError("From, To and Purpose are required for Local Conveyance")
    if mode in (MODE_TWO, MODE_FOUR):
        fields["vehicle_number"] = str(payload.get("vehicle_number") or "").strip().upper()[:40]
        fields["start_km"] = _money(_amount(payload.get("start_km"), "Starting odometer", MAX_KM))
        fields["rate"] = _money(rates[mode])
    else:
        transport = str(payload.get("transport_type") or "").strip().lower()
        if transport not in TRANSPORT_TYPES:
            raise ValueError("Select a valid public transport type")
        detail = str(payload.get("transport_other") or "").strip()[:120]
        if transport == "other" and not detail:
            raise ValueError("Specify the other public transport type")
        fields["transport_type"] = transport
        fields["transport_other"] = detail if transport == "other" else ""
        # Fare is optional at Start Visit, and must be entered by End Visit.
        starting_fare = _amount(payload.get("fare"), "Fare paid", MAX_FARE, mandatory=False)
        if starting_fare is not None:
            fields["fare"] = _money(starting_fare)
    return fields


def finish_travel(travel, payload):
    """Finalize amounts; legacy and official vehicle visits have no LC claim."""
    travel = dict(travel or {})
    mode = travel.get("mode") or MODE_LEGACY
    if mode in (MODE_TWO, MODE_FOUR):
        beginning = _amount(travel.get("start_km"), "Starting odometer", MAX_KM)
        ending = _amount(payload.get("end_km"), "Ending odometer", MAX_KM)
        if ending < beginning:
            raise ValueError("Ending odometer cannot be less than starting odometer")
        distance = ending - beginning
        rate = _positive_rate(travel.get("rate"))
        travel.update({"end_km": _money(ending), "distance_km": _money(distance),
                       "rate": _money(rate), "amount": _money(distance * rate), "eligible": True})
    elif mode == MODE_PUBLIC:
        # End Visit can supply the actual fare or revise an earlier estimate.
        # A blank End Visit value retains the fare saved at Start Visit.
        final_fare = payload.get("fare")
        if final_fare is None or str(final_fare).strip() == "":
            final_fare = travel.get("fare")
        fare = _amount(final_fare, "Public transport fare at End Visit", MAX_FARE)
        travel.update({"fare": _money(fare), "amount": _money(fare), "eligible": True})
    else:
        travel.update({"eligible": False, "amount": 0.0})
    return travel


def active_visit_query(tenant_id, employee):
    values = {str(employee.get(k) or "").strip() for k in
              ("_id", "employee_id", "employee_code", "emp_code", "user_id")}
    values.discard("")
    return {
        "tenant_id": str(tenant_id),
        "employee_ref_id": {"$in": sorted(values)},
        "status": {"$in": ["started", "reached"]},
        "is_deleted": {"$ne": True},
    }


def has_active_visit(db, tenant_id, employee):
    return db.field_visits.find_one(active_visit_query(tenant_id, employee), {"_id": 1, "title": 1})


def has_recorded_field_visit(db, tenant_id, employee, visit_date):
    """A scheduled-only visit is not a recorded journey for LC reminder purposes."""
    query = active_visit_query(tenant_id, employee)
    query['scheduled_date'] = str(visit_date)
    query['status'] = {'$in': ['started', 'reached', 'completed']}
    return bool(db.field_visits.find_one(query, {'_id': 1}))
