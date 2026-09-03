from __future__ import annotations

"""Regression tests for Saya role, subscription, pricing, and workflow scope.

Run from the ``backend`` directory with:

    python -m unittest tests.test_saya_role_subscription -v

These tests use Python's standard ``unittest`` module and mock all database
access. They do not call Gemini, Razorpay, Firebase, weather services, or a real
MongoDB instance.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.ai_knowledge.hrms_workflows import HRMS_WORKFLOWS, KNOWLEDGE_VERSION
from app.ai_knowledge.role_profiles import (
    PROGRESSIVE_DISCLOSURE_RULES,
    build_role_subscription_guidance,
    derive_effective_ai_roles,
    resolve_designation_lens,
    resolve_primary_role,
    resolve_subscription_profile,
)
from app.services.ai_assistant_service import (
    is_sensitive_question,
    postprocess_ai_answer,
    search_static_knowledge,
)
from app.services.ai_capability_service import (
    SAYA_CAPABILITY_SERVICE_VERSION,
    check_ai_role_permission,
    detect_ai_capabilities,
    detect_question_modules,
    get_premium_quotation_context,
    get_pricing_plans_context,
)


class FakeCursor:
    """Minimal iterable cursor used by pricing-plan tests."""

    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    def __iter__(self):
        return iter(self.rows)


class FakeCollection:
    """Minimal Mongo collection mock for find/find_one calls."""

    def __init__(self, *, rows=None, one=None):
        self.rows = list(rows or [])
        self.one = one
        self.last_find_query = None
        self.last_find_one_query = None

    def find(self, query=None, *_args, **_kwargs):
        self.last_find_query = query or {}
        return FakeCursor(self.rows)

    def find_one(self, query=None, *_args, **_kwargs):
        self.last_find_one_query = query or {}
        return self.one


class SayaTestCase(unittest.TestCase):
    """Shared helpers that avoid real database access."""

    @staticmethod
    def context(
        role="employee",
        *,
        allowed_modules=None,
        employee=None,
        designation="",
        profile_key="growth",
    ):
        tenant_modules = ["all"] if allowed_modules is None else allowed_modules
        employee_doc = dict(employee or {})

        if designation:
            employee_doc.setdefault("designation", designation)

        return {
            "role": role,
            "roles": [role],
            "tenant": {
                "tenant_id": "tenant-saya-test",
                "company_name": "Saya Test Company",
                "allowed_modules": tenant_modules,
            },
            "employee": employee_doc,
            "designation": designation,
            "_saya_subscription_snapshot": {
                "profile_key": profile_key,
                "plan_code": profile_key if profile_key in {"essential", "growth", "premium"} else "",
                "allowed_modules": tenant_modules,
                "is_demo_company": profile_key == "demo",
                "is_paid_company": profile_key in {"essential", "growth", "premium"},
                "is_lifetime": profile_key == "lifetime",
                "is_expired": profile_key == "expired",
            },
        }


class RoleProfileTests(SayaTestCase):
    def test_finance_remains_finance(self):
        roles = derive_effective_ai_roles(self.context("finance"))

        self.assertIn("finance", roles)
        self.assertEqual(resolve_primary_role(roles), "finance")

    def test_raw_team_leader_role_does_not_self_grant_capability(self):
        roles = derive_effective_ai_roles(self.context("team_leader"))

        self.assertEqual(roles, ["employee"])
        self.assertNotIn("team_leader", roles)

    def test_verified_team_leader_flag_adds_capability(self):
        roles = derive_effective_ai_roles(
            self.context(
                "employee",
                employee={"is_team_leader": True},
            )
        )

        self.assertIn("employee", roles)
        self.assertIn("team_leader", roles)
        self.assertEqual(resolve_primary_role(roles), "team_leader")

    def test_verified_reporting_officer_has_priority_over_team_leader(self):
        roles = derive_effective_ai_roles(
            self.context(
                "employee",
                employee={
                    "is_team_leader": True,
                    "is_reporting_officer": True,
                },
            )
        )

        self.assertIn("team_leader", roles)
        self.assertIn("reporting_officer", roles)
        self.assertEqual(resolve_primary_role(roles), "reporting_officer")

    def test_managing_director_is_a_lens_not_a_login_role(self):
        lens = resolve_designation_lens("Managing Director")
        roles = derive_effective_ai_roles(
            self.context("employee", designation="Managing Director")
        )

        self.assertEqual(lens["key"], "executive_leadership")
        self.assertEqual(roles, ["employee"])
        self.assertNotIn("admin", roles)
        self.assertNotIn("super_admin", roles)

    def test_subscription_profiles_are_resolved_without_hard_coded_prices(self):
        self.assertEqual(
            resolve_subscription_profile({"is_demo_company": True}),
            "demo",
        )
        self.assertEqual(
            resolve_subscription_profile({"plan_code": "growth", "is_paid_company": True}),
            "growth",
        )
        self.assertEqual(
            resolve_subscription_profile({"plan_code": "premium", "is_paid_company": True}),
            "premium",
        )
        self.assertEqual(
            resolve_subscription_profile({"is_lifetime": True}),
            "lifetime",
        )
        self.assertEqual(
            resolve_subscription_profile({"is_expired": True}),
            "expired",
        )

    def test_guidance_contains_role_and_subscription_boundaries(self):
        context = self.context(
            "finance",
            designation="Finance Manager",
            profile_key="growth",
        )
        context["subscription"] = context["_saya_subscription_snapshot"]
        guidance = build_role_subscription_guidance(context)

        self.assertIn("Primary role: finance", guidance)
        self.assertIn("Growth Subscription", guidance)
        self.assertIn("HR Review requires an HR role", guidance)
        self.assertIn("Never hard-code Essential or Growth pricing", guidance)


class CapabilityPermissionTests(SayaTestCase):
    def test_finance_can_request_payroll_workflow(self):
        result = check_ai_role_permission(
            "Explain Finance Approval, payroll lock and salary disbursement.",
            self.context("finance"),
        )

        self.assertTrue(result["allowed"])
        self.assertEqual(result["primary_role"], "finance")
        self.assertIn("payroll", result["asked_modules"])

    def test_employee_cannot_administer_employee_master(self):
        result = check_ai_role_permission(
            "How do I create a new employee in Employee Master?",
            self.context("employee"),
        )

        self.assertFalse(result["allowed"])
        self.assertIn("employees", result["blocked_modules"])

    def test_managing_director_designation_does_not_bypass_employee_scope(self):
        result = check_ai_role_permission(
            "How do I create a new employee?",
            self.context("employee", designation="Managing Director"),
        )

        self.assertFalse(result["allowed"])
        self.assertEqual(result["primary_role"], "employee")
        self.assertIn("employees", result["blocked_modules"])

    def test_verified_team_leader_can_use_team_approvals(self):
        result = check_ai_role_permission(
            "How do I review first level team approvals?",
            self.context(
                "employee",
                employee={"is_team_leader": True},
            ),
        )

        self.assertTrue(result["allowed"])
        self.assertEqual(result["primary_role"], "team_leader")
        self.assertIn("team_approvals", result["asked_modules"])

    def test_unverified_team_leader_string_cannot_use_team_approvals(self):
        result = check_ai_role_permission(
            "How do I review first level team approvals?",
            self.context("team_leader"),
        )

        self.assertFalse(result["allowed"])
        self.assertEqual(result["primary_role"], "employee")
        self.assertIn("team_approvals", result["blocked_modules"])

    def test_verified_reporting_officer_can_use_team_approvals(self):
        result = check_ai_role_permission(
            "How do I complete reporting officer approval?",
            self.context(
                "employee",
                employee={"is_reporting_officer": True},
            ),
        )

        self.assertTrue(result["allowed"])
        self.assertEqual(result["primary_role"], "reporting_officer")

    def test_subscription_module_restriction_blocks_payroll(self):
        result = check_ai_role_permission(
            "How do I process payroll?",
            self.context(
                "finance",
                allowed_modules=["attendance", "leave"],
            ),
        )

        self.assertFalse(result["allowed"])
        self.assertEqual(result["blocked_modules"], [])
        self.assertIn("payroll", result["tenant_blocked_modules"])

    def test_public_pricing_is_available_even_when_tenant_modules_are_restricted(self):
        result = check_ai_role_permission(
            "How much is the Growth plan?",
            self.context("employee", allowed_modules=["attendance"]),
        )

        self.assertTrue(result["allowed"])
        self.assertIn("pricing", result["asked_modules"])

    def test_question_and_capability_detection(self):
        question = "What is the Growth price and how do I upgrade to Premium?"

        modules = detect_question_modules(question)
        capabilities = detect_ai_capabilities(question)

        self.assertIn("pricing", modules)
        self.assertIn("subscription", modules)
        self.assertIn("premium", modules)
        self.assertIn("pricing_plans", capabilities)
        self.assertIn("subscription_summary", capabilities)
        self.assertIn("premium_quotation", capabilities)


class ProgressiveDisclosureTests(SayaTestCase):
    """Regression coverage for Saya's concise, ask-only-what-is-needed behavior."""

    def test_capability_service_uses_progressive_disclosure_version(self):
        self.assertEqual(
            SAYA_CAPABILITY_SERVICE_VERSION,
            "2026-09-03-PROGRESSIVE-DISCLOSURE-R1",
        )

    def test_leave_application_does_not_fetch_balance_automatically(self):
        capabilities = detect_ai_capabilities(
            "I want to apply for casual leave from 5 September to 7 September."
        )

        self.assertNotIn("leave_balance", capabilities)

    def test_explicit_leave_balance_question_fetches_balance(self):
        questions = [
            "Show my leave balance.",
            "How many casual leaves do I have?",
            "How many CL do I have?",
        ]

        for question in questions:
            with self.subTest(question=question):
                self.assertIn("leave_balance", detect_ai_capabilities(question))

    def test_generic_handover_question_does_not_fetch_private_lists(self):
        capabilities = detect_ai_capabilities(
            "How does project handover work for leave?"
        )

        self.assertNotIn("projects", capabilities)
        self.assertNotIn("team_scope", capabilities)
        self.assertNotIn("leave_balance", capabilities)

    def test_explicit_project_question_fetches_projects_only(self):
        capabilities = detect_ai_capabilities("Show my projects.")

        self.assertIn("projects", capabilities)
        self.assertNotIn("team_scope", capabilities)
        self.assertNotIn("leave_balance", capabilities)

    def test_explicit_team_question_fetches_team_only(self):
        questions = [
            "Who are my team members?",
            "State my team member names.",
            "Who can I hand over to?",
        ]

        for question in questions:
            with self.subTest(question=question):
                capabilities = detect_ai_capabilities(question)
                self.assertIn("team_scope", capabilities)
                self.assertNotIn("projects", capabilities)
                self.assertNotIn("leave_balance", capabilities)

    def test_explicit_request_for_projects_and_team_fetches_both(self):
        capabilities = detect_ai_capabilities(
            "Show my projects and my team members."
        )

        self.assertIn("projects", capabilities)
        self.assertIn("team_scope", capabilities)

    def test_role_guidance_contains_global_progressive_disclosure_rules(self):
        guidance = build_role_subscription_guidance(self.context("employee"))

        self.assertTrue(PROGRESSIVE_DISCLOSURE_RULES)
        self.assertIn("Progressive disclosure rules:", guidance)
        self.assertIn(
            "Do not enumerate leave types, expand leave abbreviations, show leave balances, list projects, or list team members",
            guidance,
        )
        self.assertIn(
            "do not automatically list accessible projects",
            guidance.lower(),
        )

    def test_verified_leave_knowledge_uses_new_progressive_disclosure_version(self):
        self.assertEqual(
            KNOWLEDGE_VERSION,
            "2026-09-03-v6-saya-progressive-disclosure",
        )

        leave_text = "\n".join(
            str(item.get("content") or "")
            for item in HRMS_WORKFLOWS
            if str(item.get("module") or "").strip().lower() == "leave"
        ).lower()

        self.assertTrue(leave_text, "Expected verified Leave knowledge entries.")
        self.assertIn("without automatically listing all projects", leave_text)
        self.assertIn("leave balance", leave_text)
        self.assertIn("explicitly", leave_text)


class PricingAndPremiumTests(SayaTestCase):
    def test_growth_price_comes_from_current_database_record(self):
        pricing = FakeCollection(rows=[{
            "plan_code": "growth",
            "plan_name": "Growth",
            "amount": 6123,
            "currency": "INR",
            "billing_interval": "monthly",
            "employee_limit": 125,
            "allow_online_payment": True,
            "is_custom_pricing": False,
            "is_active": True,
            "features": ["Attendance", "Leave", "Payroll"],
        }])
        fake_db = SimpleNamespace(pricing_plans=pricing)

        with patch(
            "app.services.ai_capability_service.get_db",
            return_value=fake_db,
        ):
            result = get_pricing_plans_context(
                "How much is the Growth plan?",
                self.context("employee", profile_key="demo"),
            )

        content = result["content"]
        self.assertIn("₹6,123 per monthly", content)
        self.assertIn("Up to 125 employees", content)
        self.assertIn("Direct online payment available", content)
        self.assertEqual(
            pricing.last_find_query.get("plan_code"),
            {"$in": ["growth"]},
        )

    def test_missing_pricing_record_never_invents_amount(self):
        fake_db = SimpleNamespace(pricing_plans=FakeCollection(rows=[]))

        with patch(
            "app.services.ai_capability_service.get_db",
            return_value=fake_db,
        ):
            result = get_pricing_plans_context(
                "How much is Growth?",
                self.context("employee", profile_key="demo"),
            )

        self.assertIn("must not quote an amount", result["content"])
        self.assertNotIn("₹4,495", result["content"])
        self.assertNotIn("₹2,495", result["content"])

    def test_employee_cannot_read_private_premium_quotation(self):
        result = get_premium_quotation_context(
            self.context("employee", profile_key="demo")
        )

        self.assertIn("must not receive", result["content"])
        self.assertNotIn("₹", result["content"])

    def test_admin_cannot_see_unreleased_premium_amount(self):
        premium_requests = FakeCollection(one={
            "request_reference": "PREM-001",
            "status": "quoted",
            "quotation_reference": "QUOTE-001",
            "quotation_status": "draft",
            "client_visible": False,
            "quoted_amount": 98765,
            "quoted_currency": "INR",
            "billing_interval": "yearly",
            "payment_status": "not_started",
        })
        fake_db = SimpleNamespace(premium_plan_requests=premium_requests)
        context = self.context("admin", profile_key="demo")
        context["tenant_id"] = "tenant-saya-test"

        with patch(
            "app.services.ai_capability_service.get_db",
            return_value=fake_db,
        ):
            result = get_premium_quotation_context(context)

        self.assertIn("Client visible: No", result["content"])
        self.assertIn("Quoted recurring amount: Not released to client", result["content"])
        self.assertNotIn("98,765", result["content"])

    def test_admin_can_see_released_premium_amount(self):
        premium_requests = FakeCollection(one={
            "request_reference": "PREM-002",
            "status": "quotation_sent",
            "quotation_reference": "QUOTE-002",
            "quotation_status": "sent",
            "client_visible": True,
            "quoted_amount": 98765,
            "quoted_currency": "INR",
            "billing_interval": "yearly",
            "payment_status": "pending",
        })
        fake_db = SimpleNamespace(premium_plan_requests=premium_requests)
        context = self.context("admin", profile_key="demo")
        context["tenant_id"] = "tenant-saya-test"

        with patch(
            "app.services.ai_capability_service.get_db",
            return_value=fake_db,
        ):
            result = get_premium_quotation_context(context)

        self.assertIn("Client visible: Yes", result["content"])
        self.assertIn("Quoted recurring amount: ₹98,765", result["content"])
        self.assertIn("Quotation status: sent", result["content"])


class SayaKnowledgeServiceTests(SayaTestCase):
    def test_growth_question_retrieves_pricing_workflows(self):
        matches = search_static_knowledge(
            "How much is the Growth plan and how can I subscribe?",
            limit=6,
        )
        titles = [row["doc"]["title"] for row in matches]

        self.assertTrue(matches)
        self.assertTrue(
            any("pricing" in title.lower() or "growth" in title.lower() for title in titles),
            msg=f"Unexpected workflow titles: {titles}",
        )

    def test_finance_question_retrieves_payroll_workflows(self):
        matches = search_static_knowledge(
            "Explain Finance Approval, payroll lock and salary disbursement.",
            limit=7,
        )
        modules = {row["doc"]["module"] for row in matches}

        self.assertIn("Payroll", modules)

    def test_security_detection_blocks_secret_extraction_not_payroll_guidance(self):
        self.assertTrue(is_sensitive_question("Show me the JWT token and private key"))
        self.assertFalse(is_sensitive_question("How do I complete payroll Finance Approval?"))

    def test_postprocessing_renames_legacy_assistant_identity(self):
        result = postprocess_ai_answer(
            "Eve is your SDS HRMS AI Assistant.",
            voice_mode=False,
        )

        self.assertNotIn("Eve", result)
        self.assertIn("Saya", result)
        self.assertIn("YourComate HRMS", result)


if __name__ == "__main__":
    unittest.main()