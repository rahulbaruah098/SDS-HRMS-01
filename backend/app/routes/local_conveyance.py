"""Tenant-safe My Visit monthly LC documents and HR/Finance verification."""
from datetime import datetime
from decimal import Decimal
from io import BytesIO

from bson import ObjectId
from flask import Blueprint, g, jsonify, request, send_file
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.extensions import get_db
from app.middleware.tenant_guard import tenant_module_required
from app.routes.field_visits import (get_current_employee, current_tenant_id,
    current_user_id, current_user_roles, employee_name, employee_identity_values)
from app.services.local_conveyance import (MODE_TWO, MODE_FOUR, MODE_PUBLIC,
    tenant_rates, validate_rates)
from app.services.local_conveyance_pdf import render_lc_bill_pdf
from app.utils.auth import audit
from app.utils.serializers import clean_doc

lc_bp = Blueprint("local_conveyance", __name__)
HR = {"admin", "hr", "hr_admin", "hr_manager"}
FINANCE = {"admin", "finance", "accounts_finance"}
STAFF = HR | FINANCE
BILL_TYPES = {MODE_TWO, MODE_FOUR, MODE_PUBLIC}


def _error(message, status=400, code=None):
    return jsonify({"message": message, **({"code": code} if code else {})}), status


def _valid_period(payload):
    try:
        year, month = int(payload.get("year")), int(payload.get("month"))
        if not 2020 <= year <= 2100 or not 1 <= month <= 12:
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError("Please select a valid LC month and year")
    return year, month


def _bill_scope(employee):
    return {"tenant_id": current_tenant_id(),
            "employee_ref_id": {"$in": sorted(employee_identity_values(employee))}}


def _can_review():
    return bool(current_user_roles() & STAFF)


def _owned_or_reviewable(bill, employee):
    return _can_review() or bool(employee and str(bill.get("employee_ref_id")) in employee_identity_values(employee))


def _bill(db, ref):
    return db.local_conveyance_bills.find_one({"tenant_id": current_tenant_id(), "reference": str(ref)})


def _bill_document(db, bill_type, employee, year, month, visits):
    tenant = current_tenant_id()
    amount = float(sum(Decimal(str(v["travel"]["amount"])) for v in visits))
    # This is the only reference-number sequence; gaps are acceptable but reuse isn't.
    counter = db.local_conveyance_counters.find_one_and_update(
        {"_id": f"lc:{tenant}:{year}:{month:02d}"},
        {"$inc": {"seq": 1}, "$setOnInsert": {"tenant_id": tenant}},
        upsert=True, return_document=ReturnDocument.AFTER)
    sequence = int(counter["seq"])
    tenant_code = "".join(x for x in tenant.upper() if x.isalnum())[:14] or "TENANT"
    reference = f"LC/{tenant_code}/{year}/{month:02d}/{sequence:06d}"
    lines = []
    for visit in visits:
        travel = visit["travel"]
        lines.append({
            "visit_id": str(visit["_id"]),
            "date": visit.get("scheduled_date") or "",
            "title": visit.get("title") or "",
            "from_location": travel.get("from_location") or "",
            "to_location": travel.get("to_location") or "",
            "purpose": travel.get("purpose") or visit.get("description") or "",
            "project": travel.get("project") or "",
            "remarks": travel.get("remarks") or "",
            "mode": travel["mode"],
            "vehicle_number": travel.get("vehicle_number") or "",
            "start_km": travel.get("start_km"), "end_km": travel.get("end_km"),
            "distance_km": travel.get("distance_km"), "rate": travel.get("rate"),
            "transport_type": travel.get("transport_type"),
            "transport_other": travel.get("transport_other") or "",
            "fare": travel.get("fare"), "amount": travel["amount"],
        })
    now = datetime.utcnow()
    return {
        "tenant_id": tenant, "reference": reference,
        "employee_ref_id": str(employee["_id"]),
        "employee_code": str(employee.get("employee_code") or employee.get("emp_code") or ""),
        "employee_name": employee_name(employee),
        "designation": str(employee.get("designation") or ""),
        "department": str(employee.get("department") or ""),
        "location": str(employee.get("location") or employee.get("state") or ""),
        "year": year, "month": month, "bill_type": bill_type,
        "visit_ids": [line["visit_id"] for line in lines],
        "lines": lines, "total": amount, "currency": "INR",
        "status": "pending_verification", "hr_verification": None,
        "accounts_verification": None, "verification_history": [],
        "created_at": now, "created_by": current_user_id(),
        "updated_at": now, "paid": False,
    }


@lc_bp.get("/settings")
@tenant_module_required("attendance")
def lc_settings():
    rates = tenant_rates(get_db(), current_tenant_id())
    return jsonify({"two_wheeler_rate": float(rates[MODE_TWO]),
                    "four_wheeler_rate": float(rates[MODE_FOUR]),
                    "editable": bool(current_user_roles() & HR)})


@lc_bp.put("/settings")
@tenant_module_required("attendance")
def update_lc_settings():
    if not current_user_roles() & HR:
        return _error("Only HR/Admin can update local conveyance rates", 403)
    try:
        validated = validate_rates(request.get_json(silent=True) or {})
    except ValueError as exc:
        return _error(str(exc))
    tenant = current_tenant_id()
    get_db().system_settings.update_one(
        {"_id": f"local-conveyance:{tenant}", "tenant_id": tenant},
        {"$set": {**validated, "setting_group": "local_conveyance", "setting_key": "rates",
                  "updated_at": datetime.utcnow(), "updated_by": current_user_id(), "is_deleted": False},
         "$setOnInsert": {"tenant_id": tenant}}, upsert=True)
    audit("update_lc_rates", "system_settings", f"local-conveyance:{tenant}", validated)
    return jsonify({"message": "Rates updated for future visits", **validated})


@lc_bp.get("/bills")
@tenant_module_required("attendance")
def list_bills():
    db = get_db()
    employee = get_current_employee(db)
    if not employee and not _can_review():
        return _error("Employee profile not found", 404)
    query = {"tenant_id": current_tenant_id()}
    if not (_can_review() and request.args.get("scope") == "all"):
        if not employee:
            return _error("Employee profile not found", 404)
        query["employee_ref_id"] = {"$in": sorted(employee_identity_values(employee))}
    ref = str(request.args.get("reference") or "").strip()
    if ref:
        query["reference"] = ref
    try:
        if request.args.get("year") or request.args.get("month"):
            year, month = _valid_period(request.args)
            query.update({"year": year, "month": month})
    except ValueError as exc:
        return _error(str(exc))
    bills = list(db.local_conveyance_bills.find(query).sort("created_at", -1).limit(150))
    return jsonify({"items": clean_doc(bills), "count": len(bills)})


@lc_bp.post("/bills/generate")
@tenant_module_required("attendance")
def generate_bills():
    db = get_db()
    employee = get_current_employee(db)
    if not employee:
        return _error("Employee profile not found", 404)
    try:
        year, month = _valid_period(request.get_json(silent=True) or {})
    except ValueError as exc:
        return _error(str(exc))
    query = {**_bill_scope(employee), "scheduled_date": {"$regex": f"^{year}-{month:02d}-"},
             "status": "completed", "is_deleted": {"$ne": True},
             "travel.eligible": True, "travel.mode": {"$in": sorted(BILL_TYPES)}}
    eligible = list(db.field_visits.find(query).sort([("scheduled_date", 1), ("created_at", 1)]))
    if not eligible:
        return _error("No completed eligible visit journeys for the selected month", 404)
    # Fail closed if the mandatory duplicate-claim protection is missing.
    # The local setup script creates the unique multikey index once.
    try:
        indexes = db.local_conveyance_bills.index_information()
        protected = any(
            list(ix.get("key", [])) == [("tenant_id", 1), ("visit_ids", 1)]
            and ix.get("unique") is True
            for ix in indexes.values()
        )
    except Exception:
        protected = False
    if not protected:
        return _error("Local Conveyance index migration is required before bill generation", 503, "LC_INDEXES_REQUIRED")

    # Compound unique multikey (tenant_id, visit_ids) prevents duplicate bills.
    already = set()
    for item in db.local_conveyance_bills.find({"tenant_id": current_tenant_id(),
                        "visit_ids": {"$in": [str(v["_id"]) for v in eligible]}}, {"visit_ids": 1}):
        already.update(item.get("visit_ids") or [])
    generated = []
    for bill_type in (MODE_TWO, MODE_FOUR, MODE_PUBLIC):
        fresh = [v for v in eligible if v["travel"]["mode"] == bill_type
                 and str(v["_id"]) not in already]
        if not fresh:
            continue
        doc = _bill_document(db, bill_type, employee, year, month, fresh)
        try:
            inserted = db.local_conveyance_bills.insert_one(doc)
            audit("generate_lc_bill", "local_conveyance_bills", inserted.inserted_id,
                  {"reference": doc["reference"], "total": doc["total"]})
            generated.append(doc["reference"])
            already.update(doc["visit_ids"])
        except DuplicateKeyError:
            # Another concurrent request claimed at least one visit. Never duplicate it.
            continue
    existing = list(db.local_conveyance_bills.find({"tenant_id": current_tenant_id(),
           "employee_ref_id": str(employee["_id"]), "year": year, "month": month}).sort("created_at", -1))
    return jsonify({"message": "LC bills generated" if generated else "Existing LC bills returned (no new eligible journeys)",
                    "generated_references": generated, "items": clean_doc(existing)})


@lc_bp.get("/bills/<path:reference>")
@tenant_module_required("attendance")
def bill_detail(reference):
    db = get_db()
    employee = get_current_employee(db)
    if not employee and not _can_review():
        return _error("Employee profile not found", 404)
    bill = _bill(db, reference)
    if not bill:
        return _error("LC bill not found", 404)
    if not _owned_or_reviewable(bill, employee):
        return _error("Not authorised to view this LC bill", 403)
    return jsonify({"item": clean_doc(bill)})


@lc_bp.get("/bills/<path:reference>/pdf")
@tenant_module_required("attendance")
def download_bill(reference):
    db = get_db()
    employee = get_current_employee(db)
    if not employee and not _can_review():
        return _error("Employee profile not found", 404)
    bill = _bill(db, reference)
    if not bill:
        return _error("LC bill not found", 404)
    if not _owned_or_reviewable(bill, employee):
        return _error("Not authorised to view this LC bill", 403)
    try:
        rendered = render_lc_bill_pdf(bill)
    except Exception:
        return _error("LC PDF renderer unavailable. Check WeasyPrint dependencies.", 503)
    # Never expose a raw filesystem path; this is sent from in-memory bytes.
    safe_name = bill["reference"].replace("/", "-") + ".pdf"
    return send_file(BytesIO(rendered), mimetype="application/pdf", as_attachment=True,
                     download_name=safe_name)


@lc_bp.post("/bills/<path:reference>/verify")
@tenant_module_required("attendance")
def verify_bill(reference):
    db = get_db()
    employee = get_current_employee(db)
    if not employee and not _can_review():
        return _error("Employee profile not found", 404)
    roles = current_user_roles()
    payload = request.get_json(silent=True) or {}
    action = str(payload.get("action") or "").strip().lower()
    remarks = str(payload.get("remarks") or "").strip()[:1000]
    if action not in {"hr_verify", "accounts_verify", "reject"}:
        return _error("Select HR Verify, Accounts Verify or Reject")
    if action == "hr_verify" and not roles & HR:
        return _error("HR/Admin verification rights required", 403)
    if action == "accounts_verify" and not roles & FINANCE:
        return _error("Finance/Accounts verification rights required", 403)
    if action == "reject" and not roles & STAFF:
        return _error("HR or Accounts verification rights required", 403)
    if action == "reject" and not remarks:
        return _error("A rejection reason is required")
    bill = _bill(db, reference)
    if not bill:
        return _error("LC bill not found", 404)
    if bill.get("status") == "rejected":
        return _error("Rejected bills cannot be verified without a correction workflow", 409)
    if bill.get("status") == "accounts_verified":
        return _error("Already Accounts verified; this bill is locked", 409)
    if action == "hr_verify" and bill.get("hr_verification"):
        return _error("This bill is already HR verified", 409)
    if action == "accounts_verify" and not bill.get("hr_verification"):
        return _error("HR verification is required before Accounts verification", 409)
    now = datetime.utcnow()
    stage = {"hr_verify": "hr_verified", "accounts_verify": "accounts_verified", "reject": "rejected"}[action]
    record = {"stage": stage, "by": current_user_id(), "roles": sorted(roles),
              "at": now, "remarks": remarks}
    update = {"$set": {"status": stage, "updated_at": now},
              "$push": {"verification_history": record}}
    if action == "hr_verify":
        update["$set"]["hr_verification"] = record
    elif action == "accounts_verify":
        update["$set"]["accounts_verification"] = record
    # Optimistic lock: simultaneous approvals cannot both silently succeed.
    changed = db.local_conveyance_bills.update_one(
        {"_id": bill["_id"], "tenant_id": current_tenant_id(), "status": bill["status"]}, update)
    if not changed.matched_count:
        return _error("Bill was changed by another reviewer. Refresh it.", 409)
    audit("verify_lc_bill", "local_conveyance_bills", bill["_id"],
          {"reference": reference, "stage": stage, "remarks": remarks})
    return jsonify({"message": "LC verification saved", "item": clean_doc(_bill(db, reference))})
