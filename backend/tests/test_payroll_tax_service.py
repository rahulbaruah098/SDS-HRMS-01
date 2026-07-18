from __future__ import annotations

import copy
import unittest
from datetime import UTC, datetime
from decimal import Decimal

from bson import ObjectId

from app.services.payroll_tax_service import (
    PayrollTaxError,
    activate_tds_instruction,
    approve_tax_declaration,
    cancel_tax_declaration,
    complete_tax_hr_review,
    create_tds_instruction,
    deactivate_tds_instruction,
    financial_year_for_period,
    get_tax_declaration,
    list_tax_declarations,
    list_tds_instructions,
    lock_tax_declaration,
    money_decimal,
    normalize_declaration_payload,
    normalize_financial_year,
    normalize_tax_regime,
    normalize_tds_mode,
    reject_tax_declaration,
    resolve_payroll_tax_context,
    resolve_tds_for_payroll,
    submit_tax_declaration,
    tax_declaration_snapshot,
    upsert_tax_declaration,
)


_MISSING = object()


def _value_at(document, dotted_key):
    value = document

    for part in dotted_key.split("."):
        if not isinstance(value, dict) or part not in value:
            return _MISSING
        value = value[part]

    return value


def _matches(document, query):
    for key, expected in (query or {}).items():
        if key == "$or":
            if not any(_matches(document, item) for item in expected):
                return False
            continue

        actual = _value_at(document, key)

        if isinstance(expected, dict):
            for operator, operand in expected.items():
                if operator == "$ne":
                    if actual is not _MISSING and actual == operand:
                        return False
                elif operator == "$in":
                    if actual is _MISSING or actual not in operand:
                        return False
                elif operator == "$nin":
                    if actual is not _MISSING and actual in operand:
                        return False
                elif operator == "$lte":
                    if actual is _MISSING or actual > operand:
                        return False
                elif operator == "$exists":
                    if bool(actual is not _MISSING) != bool(operand):
                        return False
                else:
                    raise AssertionError(f"Unsupported fake query operator: {operator}")
            continue

        if actual is _MISSING or actual != expected:
            return False

    return True


def _set_value(document, dotted_key, value):
    target = document
    parts = dotted_key.split(".")

    for part in parts[:-1]:
        target = target.setdefault(part, {})

    target[parts[-1]] = copy.deepcopy(value)


class FakeCursor:
    def __init__(self, documents):
        self.documents = [copy.deepcopy(item) for item in documents]

    def sort(self, specification):
        if isinstance(specification, str):
            specification = [(specification, 1)]

        for key, direction in reversed(list(specification)):
            self.documents.sort(
                key=lambda item: (
                    _value_at(item, key) is _MISSING,
                    _value_at(item, key),
                ),
                reverse=direction < 0,
            )

        return self

    def limit(self, count):
        self.documents = self.documents[:count]
        return self

    def __iter__(self):
        return iter(self.documents)


class FakeCollection:
    def __init__(self, documents=None):
        self.documents = [copy.deepcopy(item) for item in (documents or [])]

    def find_one(self, query):
        for document in self.documents:
            if _matches(document, query):
                return copy.deepcopy(document)
        return None

    def find(self, query):
        return FakeCursor(
            document
            for document in self.documents
            if _matches(document, query)
        )

    def insert_one(self, document):
        self.documents.append(copy.deepcopy(document))

        class Result:
            inserted_id = document.get("_id")

        return Result()

    def update_many(self, query, update):
        count = 0

        for document in self.documents:
            if not _matches(document, query):
                continue
            self._apply_update(document, update)
            count += 1

        class Result:
            modified_count = count

        return Result()

    def find_one_and_update(
        self,
        query,
        update,
        upsert=False,
        return_document=None,
    ):
        for document in self.documents:
            if not _matches(document, query):
                continue
            self._apply_update(document, update)
            return copy.deepcopy(document)

        if not upsert:
            return None

        document = {}

        for key, value in query.items():
            if key.startswith("$") or isinstance(value, dict):
                continue
            _set_value(document, key, value)

        self._apply_update(document, update)
        document.setdefault("_id", ObjectId())
        self.documents.append(document)
        return copy.deepcopy(document)

    @staticmethod
    def _apply_update(document, update):
        for key, value in (update.get("$setOnInsert") or {}).items():
            if _value_at(document, key) is _MISSING:
                _set_value(document, key, value)

        for key, value in (update.get("$set") or {}).items():
            _set_value(document, key, value)

        for key, value in (update.get("$push") or {}).items():
            target = document.setdefault(key, [])
            target.append(copy.deepcopy(value))

        for key, value in (update.get("$inc") or {}).items():
            document[key] = document.get(key, 0) + value


class FakeDatabase:
    def __init__(self):
        self.employees = FakeCollection()
        self.payroll_tax_declarations = FakeCollection()
        self.payroll_tax_instructions = FakeCollection()

    def __getitem__(self, name):
        return getattr(self, name)


def sample_employee(**overrides):
    document = {
        "_id": ObjectId(),
        "tenant_id": "tenant-a",
        "employee_code": "EMP-001",
        "employee_name": "Asha Das",
        "official_email": "asha@example.com",
        "user_id": "user-1",
        "is_deleted": False,
    }
    document.update(overrides)
    return document


def sample_component(
    component_type="section_80c",
    declared_amount=50000,
    approved_amount=0,
    proof_status="pending",
    proofs=None,
):
    return {
        "type": component_type,
        "declared_amount": declared_amount,
        "approved_amount": approved_amount,
        "proof_status": proof_status,
        "proofs": proofs
        if proofs is not None
        else [
            {
                "reference": "attachment-1",
                "filename": "proof.pdf",
                "status": "pending",
            }
        ],
    }


def sample_declaration_payload(**overrides):
    payload = {
        "tax_regime": "old",
        "components": [sample_component()],
        "employee_note": "Employee declaration",
        "consent_confirmed": True,
    }
    payload.update(overrides)
    return payload


class PayrollTaxServiceTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.employee = sample_employee()
        self.db.employees.insert_one(self.employee)
        self.employee_id = str(self.employee["_id"])

    def create_declaration(self, **payload_overrides):
        return upsert_tax_declaration(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            payload=sample_declaration_payload(**payload_overrides),
            actor_id="employee-user",
            actor_name="Asha Das",
        )

    def submit_declaration(self, **payload_overrides):
        self.create_declaration(**payload_overrides)
        return submit_tax_declaration(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            actor_id="employee-user",
            actor_name="Asha Das",
        )

    def test_normalize_financial_year_accepts_consecutive_years(self):
        self.assertEqual(normalize_financial_year("2026/2027"), "2026-2027")

    def test_normalize_financial_year_rejects_non_consecutive_years(self):
        with self.assertRaises(PayrollTaxError) as context:
            normalize_financial_year("2026-2028")

        self.assertEqual(context.exception.code, "invalid_financial_year")

    def test_financial_year_for_period_handles_april_and_march(self):
        self.assertEqual(financial_year_for_period("2026-04"), "2026-2027")
        self.assertEqual(financial_year_for_period("2027-03"), "2026-2027")

    def test_tax_regime_aliases_are_normalized(self):
        self.assertEqual(normalize_tax_regime("old-regime"), "old")
        self.assertEqual(normalize_tax_regime("new_regime"), "new")
        self.assertEqual(normalize_tax_regime("none"), "not_selected")

    def test_tds_mode_aliases_are_normalized(self):
        self.assertEqual(normalize_tds_mode("off"), "disabled")
        self.assertEqual(normalize_tds_mode("manual-entry"), "manual")
        self.assertEqual(normalize_tds_mode("external-provider"), "external")

    def test_money_decimal_rejects_negative_amount(self):
        with self.assertRaises(PayrollTaxError) as context:
            money_decimal("-1", field_name="amount")

        self.assertEqual(context.exception.code, "invalid_payroll_tax_amount")

    def test_declaration_payload_calculates_declared_and_approved_totals(self):
        normalized = normalize_declaration_payload(
            {
                "tax_regime": "old",
                "components": [
                    sample_component(
                        declared_amount=50000,
                        approved_amount=40000,
                        proof_status="accepted",
                    ),
                    sample_component(
                        component_type="other_income",
                        declared_amount=10000,
                        approved_amount=10000,
                        proof_status="not_required",
                        proofs=[],
                    ),
                ],
                "consent_confirmed": True,
            },
            financial_year="2026-2027",
        )

        self.assertEqual(normalized["declared_total"], 60000)
        self.assertEqual(normalized["approved_total"], 50000)

    def test_declaration_payload_rejects_duplicate_component_types(self):
        with self.assertRaises(PayrollTaxError) as context:
            normalize_declaration_payload(
                {
                    "tax_regime": "old",
                    "components": [
                        sample_component(),
                        sample_component(),
                    ],
                },
                financial_year="2026-2027",
            )

        self.assertEqual(
            context.exception.code,
            "duplicate_tax_declaration_component",
        )

    def test_component_approved_amount_cannot_exceed_declared_amount(self):
        with self.assertRaises(PayrollTaxError) as context:
            normalize_declaration_payload(
                {
                    "tax_regime": "old",
                    "components": [
                        sample_component(
                            declared_amount=1000,
                            approved_amount=1200,
                        )
                    ],
                },
                financial_year="2026-2027",
            )

        self.assertEqual(
            context.exception.code,
            "approved_tax_amount_exceeds_declared_amount",
        )

    def test_tax_proof_reference_is_required(self):
        with self.assertRaises(PayrollTaxError) as context:
            normalize_declaration_payload(
                {
                    "tax_regime": "old",
                    "components": [
                        sample_component(
                            proofs=[{"filename": "missing-reference.pdf"}]
                        )
                    ],
                },
                financial_year="2026-2027",
            )

        self.assertEqual(
            context.exception.code,
            "tax_proof_reference_required",
        )

    def test_upsert_creates_draft_declaration(self):
        declaration = self.create_declaration()

        self.assertEqual(declaration["status"], "draft")
        self.assertEqual(declaration["revision_number"], 1)
        self.assertEqual(declaration["employee_code"], "EMP-001")
        self.assertEqual(declaration["declared_total"], 50000)

    def test_upsert_updates_editable_declaration_and_records_revision(self):
        original = self.create_declaration()
        updated = upsert_tax_declaration(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            payload=sample_declaration_payload(
                employee_note="Updated employee note",
            ),
            actor_id="employee-user",
            actor_name="Asha Das",
        )

        self.assertEqual(updated["revision_number"], 2)
        self.assertEqual(updated["employee_note"], "Updated employee note")
        self.assertEqual(len(updated["revisions"]), 1)
        self.assertEqual(
            updated["revisions"][0]["revision_number"],
            original["revision_number"],
        )

    def test_upsert_rejects_non_editable_declaration(self):
        self.create_declaration()
        declaration = self.db.payroll_tax_declarations.documents[0]
        declaration["status"] = "pending_hr_review"

        with self.assertRaises(PayrollTaxError) as context:
            self.create_declaration()

        self.assertEqual(
            context.exception.code,
            "tax_declaration_not_editable",
        )

    def test_submit_requires_employee_consent(self):
        self.create_declaration(consent_confirmed=False)

        with self.assertRaises(PayrollTaxError) as context:
            submit_tax_declaration(
                self.db,
                tenant_id="tenant-a",
                employee_reference=self.employee_id,
                financial_year="2026-2027",
            )

        self.assertEqual(
            context.exception.code,
            "tax_declaration_consent_required",
        )

    def test_submit_requires_tax_regime(self):
        self.create_declaration(tax_regime="not_selected")

        with self.assertRaises(PayrollTaxError) as context:
            submit_tax_declaration(
                self.db,
                tenant_id="tenant-a",
                employee_reference=self.employee_id,
                financial_year="2026-2027",
            )

        self.assertEqual(context.exception.code, "tax_regime_required")

    def test_submit_requires_proof_for_positive_proof_required_component(self):
        self.create_declaration(
            components=[sample_component(proofs=[])]
        )

        with self.assertRaises(PayrollTaxError) as context:
            submit_tax_declaration(
                self.db,
                tenant_id="tenant-a",
                employee_reference=self.employee_id,
                financial_year="2026-2027",
            )

        self.assertEqual(
            context.exception.code,
            "tax_declaration_proofs_required",
        )

    def test_submit_moves_declaration_to_hr_review(self):
        declaration = self.submit_declaration()

        self.assertEqual(declaration["status"], "pending_hr_review")
        self.assertEqual(
            declaration["workflow_history"][-1]["action"],
            "submit",
        )

    def test_hr_review_requires_accepted_proof_for_approved_amount(self):
        self.submit_declaration()

        with self.assertRaises(PayrollTaxError) as context:
            complete_tax_hr_review(
                self.db,
                tenant_id="tenant-a",
                employee_reference=self.employee_id,
                financial_year="2026-2027",
                component_reviews=[
                    {
                        "type": "section_80c",
                        "approved_amount": 40000,
                        "proof_status": "pending",
                    }
                ],
            )

        self.assertEqual(context.exception.code, "tax_proof_not_accepted")

    def test_hr_review_moves_declaration_to_finance_approval(self):
        self.submit_declaration()
        declaration = complete_tax_hr_review(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            component_reviews=[
                {
                    "type": "section_80c",
                    "approved_amount": 40000,
                    "proof_status": "accepted",
                }
            ],
            actor_id="hr-user",
            actor_name="HR User",
        )

        self.assertEqual(
            declaration["status"],
            "pending_finance_approval",
        )
        self.assertEqual(declaration["approved_total"], 40000)

    def test_finance_approval_moves_declaration_to_approved(self):
        self.submit_declaration()
        complete_tax_hr_review(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            component_reviews=[
                {
                    "type": "section_80c",
                    "approved_amount": 40000,
                    "proof_status": "accepted",
                }
            ],
        )
        declaration = approve_tax_declaration(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            actor_id="finance-user",
            actor_name="Finance User",
        )

        self.assertEqual(declaration["status"], "approved")
        self.assertEqual(
            declaration["workflow_history"][-1]["action"],
            "approve",
        )

    def test_reject_requires_reason(self):
        self.submit_declaration()

        with self.assertRaises(PayrollTaxError) as context:
            reject_tax_declaration(
                self.db,
                tenant_id="tenant-a",
                employee_reference=self.employee_id,
                financial_year="2026-2027",
                reason="",
            )

        self.assertEqual(
            context.exception.code,
            "tax_declaration_rejection_reason_required",
        )

    def test_rejected_declaration_can_be_revised(self):
        self.submit_declaration()
        rejected = reject_tax_declaration(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            reason="Upload a clearer document.",
        )
        revised = upsert_tax_declaration(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            payload=sample_declaration_payload(
                employee_note="Proof corrected",
            ),
        )

        self.assertEqual(rejected["status"], "rejected")
        self.assertEqual(revised["status"], "draft")
        self.assertEqual(revised["revision_number"], 2)

    def test_cancel_does_not_allow_approved_declaration(self):
        declaration = self.create_declaration()
        self.db.payroll_tax_declarations.documents[0]["status"] = "approved"

        with self.assertRaises(PayrollTaxError) as context:
            cancel_tax_declaration(
                self.db,
                tenant_id="tenant-a",
                employee_reference=self.employee_id,
                financial_year="2026-2027",
                reason="Employee request",
            )

        self.assertEqual(
            context.exception.code,
            "tax_declaration_not_cancellable",
        )
        self.assertEqual(declaration["status"], "draft")

    def test_lock_requires_approved_declaration(self):
        self.create_declaration()

        with self.assertRaises(PayrollTaxError) as context:
            lock_tax_declaration(
                self.db,
                tenant_id="tenant-a",
                employee_reference=self.employee_id,
                financial_year="2026-2027",
            )

        self.assertEqual(
            context.exception.code,
            "tax_declaration_not_lockable",
        )

    def test_lock_is_idempotent_for_locked_declaration(self):
        declaration = self.create_declaration()
        stored = self.db.payroll_tax_declarations.documents[0]
        stored["status"] = "locked"

        locked = lock_tax_declaration(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
        )

        self.assertEqual(locked["status"], "locked")
        self.assertEqual(locked["_id"], declaration["_id"])

    def test_list_tax_declarations_filters_by_employee_and_year(self):
        self.create_declaration()
        rows = list_tax_declarations(
            self.db,
            tenant_id="tenant-a",
            employee_reference="EMP-001",
            financial_years=["2026-2027"],
            statuses=["draft"],
            tax_regimes=["old"],
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["employee_id"], self.employee_id)

    def test_manual_tds_instruction_is_created_and_resolved(self):
        instruction = create_tds_instruction(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            effective_from_period="2026-04",
            mode="manual",
            monthly_tds_amount=2500,
            actor_id="finance-user",
            actor_name="Finance User",
        )
        resolved = resolve_tds_for_payroll(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            period_key="2026-08",
        )

        self.assertEqual(instruction["status"], "active")
        self.assertEqual(resolved["mode"], "manual")
        self.assertEqual(resolved["tds_amount"], 2500)

    def test_disabled_tds_instruction_requires_zero_amount(self):
        with self.assertRaises(PayrollTaxError) as context:
            create_tds_instruction(
                self.db,
                tenant_id="tenant-a",
                employee_reference=self.employee_id,
                financial_year="2026-2027",
                effective_from_period="2026-04",
                mode="disabled",
                monthly_tds_amount=100,
            )

        self.assertEqual(
            context.exception.code,
            "disabled_tds_amount_must_be_zero",
        )

    def test_external_tds_instruction_requires_reference_and_source(self):
        with self.assertRaises(PayrollTaxError) as context:
            create_tds_instruction(
                self.db,
                tenant_id="tenant-a",
                employee_reference=self.employee_id,
                financial_year="2026-2027",
                effective_from_period="2026-04",
                mode="external",
                monthly_tds_amount=3000,
            )

        self.assertEqual(
            context.exception.code,
            "external_tds_reference_required",
        )

    def test_duplicate_tds_instruction_returns_existing_record(self):
        first = create_tds_instruction(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            effective_from_period="2026-04",
            mode="manual",
            monthly_tds_amount=2500,
        )
        second = create_tds_instruction(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            effective_from_period="2026-04",
            mode="manual",
            monthly_tds_amount=2500,
        )

        self.assertEqual(first["_id"], second["_id"])
        self.assertEqual(
            len(self.db.payroll_tax_instructions.documents),
            1,
        )

    def test_new_active_instruction_supersedes_previous_instruction(self):
        first = create_tds_instruction(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            effective_from_period="2026-04",
            mode="manual",
            monthly_tds_amount=2000,
        )
        second = create_tds_instruction(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            effective_from_period="2026-07",
            mode="manual",
            monthly_tds_amount=3000,
        )
        rows = list_tds_instructions(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_years=["2026-2027"],
        )
        by_id = {str(row["_id"]): row for row in rows}

        self.assertEqual(by_id[str(first["_id"])]["status"], "superseded")
        self.assertEqual(by_id[str(second["_id"])]["status"], "active")

    def test_draft_tds_instruction_can_be_activated(self):
        instruction = create_tds_instruction(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            effective_from_period="2026-04",
            mode="manual",
            monthly_tds_amount=2200,
            activate=False,
        )
        activated = activate_tds_instruction(
            self.db,
            tenant_id="tenant-a",
            instruction_id=instruction["_id"],
            actor_id="finance-user",
            actor_name="Finance User",
        )

        self.assertEqual(activated["status"], "active")
        self.assertEqual(activated["activated_by"], "finance-user")

    def test_active_tds_instruction_can_be_deactivated(self):
        instruction = create_tds_instruction(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            effective_from_period="2026-04",
            mode="manual",
            monthly_tds_amount=2200,
        )
        deactivated = deactivate_tds_instruction(
            self.db,
            tenant_id="tenant-a",
            instruction_id=instruction["_id"],
            reason="Replaced by external provider",
            actor_id="finance-user",
            actor_name="Finance User",
        )

        self.assertEqual(deactivated["status"], "inactive")
        self.assertEqual(
            deactivated["deactivation_reason"],
            "Replaced by external provider",
        )

    def test_resolve_tds_returns_disabled_when_no_instruction_exists(self):
        resolved = resolve_tds_for_payroll(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            period_key="2026-06",
        )

        self.assertEqual(resolved["mode"], "disabled")
        self.assertEqual(resolved["tds_amount"], 0)
        self.assertEqual(resolved["instruction_id"], "")

    def test_tax_declaration_snapshot_handles_missing_declaration(self):
        snapshot = tax_declaration_snapshot(None)

        self.assertFalse(snapshot["available"])
        self.assertEqual(snapshot["status"], "not_found")
        self.assertEqual(snapshot["tax_regime"], "not_selected")

    def test_payroll_tax_context_uses_approved_declaration_and_manual_tds(self):
        declaration = self.create_declaration()
        stored = self.db.payroll_tax_declarations.documents[0]
        stored["status"] = "approved"
        stored["approved_total"] = 40000
        stored["approved_at"] = datetime.now(UTC)

        create_tds_instruction(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            financial_year="2026-2027",
            effective_from_period="2026-04",
            mode="manual",
            monthly_tds_amount=2500,
        )
        context = resolve_payroll_tax_context(
            self.db,
            tenant_id="tenant-a",
            employee_reference=self.employee_id,
            period_key="2026-08",
        )

        self.assertEqual(
            context["declaration"]["tax_declaration_id"],
            str(declaration["_id"]),
        )
        self.assertEqual(context["declaration"]["status"], "approved")
        self.assertEqual(context["tds"]["tds_amount"], 2500)
        self.assertFalse(
            context["calculation_policy"][
                "automatic_income_tax_calculation_enabled"
            ]
        )

    def test_get_tax_declaration_rejects_missing_record(self):
        with self.assertRaises(PayrollTaxError) as context:
            get_tax_declaration(
                self.db,
                tenant_id="tenant-a",
                employee_reference=self.employee_id,
                financial_year="2026-2027",
            )

        self.assertEqual(
            context.exception.code,
            "tax_declaration_not_found",
        )


if __name__ == "__main__":
    unittest.main()