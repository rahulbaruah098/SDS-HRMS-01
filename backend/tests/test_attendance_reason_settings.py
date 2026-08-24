from __future__ import annotations

import copy
import unittest
from types import SimpleNamespace

from flask import Flask, g

from app.routes.attendance import (
    ATTENDANCE_OTHER_REASON_CODE,
    ATTENDANCE_REASON_SETTING_GROUP,
    ATTENDANCE_REASON_SETTING_KEY,
    DEFAULT_EARLY_CHECKOUT_REASON_OPTIONS,
    DEFAULT_LATE_REASON_OPTIONS,
    attendance_reason_settings_for_tenant,
    attendance_reason_settings_id,
    meaningful_other_reason,
    normalize_reason_option_list,
    resolve_attendance_reason,
)


class TenantSettingsCollection:
    """Small tenant-aware substitute for the system_settings collection."""

    def __init__(self, documents=None):
        self.documents = [copy.deepcopy(item) for item in (documents or [])]
        self.queries = []

    def find_one(self, query):
        self.queries.append(copy.deepcopy(query))

        for document in self.documents:
            if document.get("_id") != query.get("_id"):
                continue
            if document.get("tenant_id") != query.get("tenant_id"):
                continue
            if document.get("setting_group") != query.get("setting_group"):
                continue
            if document.get("setting_key") != query.get("setting_key"):
                continue
            if document.get("is_deleted") is True:
                continue
            return copy.deepcopy(document)

        return None


def reason_settings(late_reasons=None, early_checkout_reasons=None):
    return {
        "late_reasons": late_reasons or [
            {"code": "traffic", "label": "Traffic congestion"},
            {
                "code": ATTENDANCE_OTHER_REASON_CODE,
                "label": "Other",
                "requires_details": True,
            },
        ],
        "early_checkout_reasons": early_checkout_reasons or [
            {"code": "medical", "label": "Medical appointment"},
            {
                "code": ATTENDANCE_OTHER_REASON_CODE,
                "label": "Other",
                "requires_details": True,
            },
        ],
    }


class AttendanceReasonOptionTests(unittest.TestCase):
    def test_normalizes_labels_and_generates_unique_codes(self):
        result, error = normalize_reason_option_list(
            [
                {"label": "  Traffic   congestion  "},
                {"code": "traffic_congestion", "label": "Heavy traffic"},
            ],
            "Late check-in reasons",
        )

        self.assertEqual(error, "")
        self.assertEqual(
            result,
            [
                {"code": "traffic_congestion", "label": "Traffic congestion"},
                {"code": "traffic_congestion_2", "label": "Heavy traffic"},
            ],
        )

    def test_rejects_empty_duplicate_unreadable_and_manual_other_options(self):
        invalid_lists = [
            [],
            [{"label": "..."}],
            [{"label": "Traffic"}, {"label": " traffic "}],
            [{"label": "Other"}],
        ]

        for values in invalid_lists:
            with self.subTest(values=values):
                result, error = normalize_reason_option_list(
                    values,
                    "Late check-in reasons",
                )
                self.assertIsNone(result)
                self.assertTrue(error)


class OtherReasonValidationTests(unittest.TestCase):
    def test_accepts_a_meaningful_other_explanation(self):
        result, error = meaningful_other_reason(
            "  The company bus broke down near the office  ",
            "late check-in reason",
        )

        self.assertEqual(error, "")
        self.assertEqual(result, "The company bus broke down near the office")

    def test_rejects_dot_single_word_placeholders_and_gibberish(self):
        invalid_reasons = [
            ".",
            "Unexpected",
            "test reason",
            "qwerty asdf delay",
            "aaaa bbbb cccc",
        ]

        for value in invalid_reasons:
            with self.subTest(value=value):
                result, error = meaningful_other_reason(
                    value,
                    "late check-in reason",
                )
                self.assertEqual(result, "")
                self.assertIn("meaningful late check-in reason", error)
                self.assertIn("gibberish", error)


class AttendanceReasonResolutionTests(unittest.TestCase):
    def test_requires_a_late_reason_when_employee_is_late(self):
        result, error = resolve_attendance_reason(
            {},
            "late",
            reason_settings(),
            required=True,
        )

        self.assertIsNone(result)
        self.assertEqual(error, "Late reason is required from 09:50 AM onwards")

    def test_resolves_a_current_tenant_dropdown_reason(self):
        result, error = resolve_attendance_reason(
            {"late_reason_code": "traffic"},
            "late",
            reason_settings(),
            required=True,
        )

        self.assertEqual(error, "")
        self.assertEqual(
            result,
            {
                "code": "traffic",
                "label": "Traffic congestion",
                "detail": "",
                "value": "Traffic congestion",
            },
        )

    def test_rejects_a_reason_code_not_in_the_current_tenant_list(self):
        result, error = resolve_attendance_reason(
            {"late_reason_code": "not_configured"},
            "late",
            reason_settings(),
            required=True,
        )

        self.assertIsNone(result)
        self.assertEqual(
            error,
            "Select a valid late check-in reason from your company's current list",
        )

    def test_other_requires_valid_details_and_preserves_valid_details(self):
        invalid_result, invalid_error = resolve_attendance_reason(
            {
                "early_checkout_reason_code": "other",
                "early_checkout_reason_detail": ".",
            },
            "early_checkout",
            reason_settings(),
            required=True,
        )
        valid_result, valid_error = resolve_attendance_reason(
            {
                "early_checkout_reason_code": "other",
                "early_checkout_reason_detail": (
                    "My child became unwell and needs medical care"
                ),
            },
            "early_checkout",
            reason_settings(),
            required=True,
        )

        self.assertIsNone(invalid_result)
        self.assertTrue(invalid_error)
        self.assertEqual(valid_error, "")
        self.assertEqual(valid_result["code"], ATTENDANCE_OTHER_REASON_CODE)
        self.assertEqual(valid_result["label"], "Other")
        self.assertEqual(
            valid_result["detail"],
            "My child became unwell and needs medical care",
        )


class TenantAttendanceReasonSettingsTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    def test_defaults_include_fixed_other_option_for_both_flows(self):
        db = SimpleNamespace(system_settings=TenantSettingsCollection())

        with self.app.test_request_context():
            g.current_user = {"roles": ["employee"]}
            settings = attendance_reason_settings_for_tenant(db, "tenant-default")

        self.assertEqual(settings["source"], "default")
        self.assertFalse(settings["can_manage"])
        self.assertEqual(
            len(settings["late_reasons"]),
            len(DEFAULT_LATE_REASON_OPTIONS) + 1,
        )
        self.assertEqual(
            len(settings["early_checkout_reasons"]),
            len(DEFAULT_EARLY_CHECKOUT_REASON_OPTIONS) + 1,
        )

        for field in ("late_reasons", "early_checkout_reasons"):
            self.assertEqual(settings[field][-1]["code"], "other")
            self.assertEqual(settings[field][-1]["label"], "Other")
            self.assertTrue(settings[field][-1]["requires_details"])

    def test_tenant_custom_reasons_do_not_leak_to_another_tenant(self):
        tenant_a = "tenant-a"
        tenant_b = "tenant-b"
        collection = TenantSettingsCollection(
            [
                {
                    "_id": attendance_reason_settings_id(tenant_a),
                    "tenant_id": tenant_a,
                    "setting_group": ATTENDANCE_REASON_SETTING_GROUP,
                    "setting_key": ATTENDANCE_REASON_SETTING_KEY,
                    "late_reasons": [
                        {"code": "tenant_a_reason", "label": "Tenant A reason"},
                    ],
                    "early_checkout_reasons": [
                        {"code": "tenant_a_early", "label": "Tenant A early reason"},
                    ],
                    "is_deleted": False,
                },
            ]
        )
        db = SimpleNamespace(system_settings=collection)

        with self.app.test_request_context():
            g.current_user = {"roles": ["hr"]}
            settings_a = attendance_reason_settings_for_tenant(db, tenant_a)
            settings_b = attendance_reason_settings_for_tenant(db, tenant_b)

        self.assertEqual(settings_a["source"], "tenant")
        self.assertEqual(settings_b["source"], "default")
        self.assertTrue(settings_a["can_manage"])
        self.assertEqual(settings_a["late_reasons"][0]["code"], "tenant_a_reason")
        self.assertNotIn(
            "tenant_a_reason",
            {item["code"] for item in settings_b["late_reasons"]},
        )
        self.assertEqual(
            [query["tenant_id"] for query in collection.queries],
            [tenant_a, tenant_b],
        )
        self.assertEqual(
            [query["_id"] for query in collection.queries],
            [
                attendance_reason_settings_id(tenant_a),
                attendance_reason_settings_id(tenant_b),
            ],
        )


if __name__ == "__main__":
    unittest.main()