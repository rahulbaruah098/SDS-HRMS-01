"""Tests for the explainable Recruitment resume-match service."""

from __future__ import annotations

import unittest

from app.services.resume_match_service import (
    MATCH_VERSION,
    experience_component,
    experience_requirement,
    score_resume_match,
    skills_match,
)


def parser_result(**fields):
    return {
        "parser_version": "test-parser",
        "fields": fields,
        "warnings": [],
        "requires_manual_review": True,
    }


class ResumeMatchServiceTests(unittest.TestCase):
    def test_exact_required_skills_are_matched(self):
        job = {"required_skills": ["Python", "Flask", "MongoDB"]}
        parsed = parser_result(skills=["Python", "Flask", "MongoDB"])

        result = score_resume_match(parsed, job)

        self.assertEqual(result["components"]["skills"]["ratio_percent"], 100.0)
        self.assertEqual(result["matched_skills"], ["Python", "Flask", "MongoDB"])
        self.assertEqual(result["missing_skills"], [])

    def test_common_skill_aliases_are_matched(self):
        self.assertTrue(skills_match("React JS", "React"))
        self.assertTrue(skills_match("NodeJS", "Node.js"))
        self.assertTrue(skills_match("Mongo DB", "MongoDB"))
        self.assertTrue(skills_match("PowerBI", "Power BI"))

    def test_missing_skills_are_explained(self):
        job = {"required_skills": ["Python", "Docker", "AWS"]}
        parsed = parser_result(skills=["Python"])

        result = score_resume_match(parsed, job)

        self.assertEqual(result["matched_skills"], ["Python"])
        self.assertEqual(result["missing_skills"], ["Docker", "AWS"])
        self.assertTrue(result["review_notes"])

    def test_hyphenated_experience_range_is_parsed(self):
        requirement = experience_requirement({"required_experience": "3-5 years"})

        self.assertEqual(requirement["minimum"], 3.0)
        self.assertEqual(requirement["maximum"], 5.0)

    def test_worded_experience_range_is_parsed(self):
        requirement = experience_requirement({"required_experience": "3 to 5 years"})

        self.assertEqual(requirement["minimum"], 3.0)
        self.assertEqual(requirement["maximum"], 5.0)

    def test_en_dash_experience_range_is_parsed(self):
        requirement = experience_requirement({"required_experience": "3–5 years"})

        self.assertEqual(requirement["minimum"], 3.0)
        self.assertEqual(requirement["maximum"], 5.0)

    def test_reversed_experience_range_is_normalised(self):
        requirement = experience_requirement({"required_experience": "5-3 years"})

        self.assertEqual(requirement["minimum"], 3.0)
        self.assertEqual(requirement["maximum"], 5.0)

    def test_plus_experience_requirement_is_parsed(self):
        requirement = experience_requirement({"required_experience": "4+ years"})

        self.assertEqual(requirement["minimum"], 4.0)
        self.assertIsNone(requirement["maximum"])

    def test_fresher_zero_experience_receives_full_experience_component(self):
        component = experience_component(
            {"required_experience": "Fresher"},
            parser_result(total_experience_years=0),
        )

        self.assertEqual(component["candidate_years"], 0.0)
        self.assertEqual(component["ratio_percent"], 100.0)
        self.assertEqual(component["score"], component["max_score"])

    def test_partial_experience_is_scored_proportionally(self):
        component = experience_component(
            {"required_experience": "4+ years"},
            parser_result(total_experience_years=2),
        )

        self.assertEqual(component["ratio_percent"], 50.0)
        self.assertEqual(component["score"], 12.5)

    def test_experience_above_maximum_is_not_penalised(self):
        component = experience_component(
            {"required_experience": "3-5 years"},
            parser_result(total_experience_years=8),
        )

        self.assertEqual(component["ratio_percent"], 100.0)
        self.assertEqual(component["score"], component["max_score"])

    def test_qualification_evidence_contributes_to_score(self):
        job = {"qualification": "Bachelor Computer Science"}
        parsed = parser_result(
            education=[{"degree": "Bachelor", "specialisation": "Computer Science"}]
        )

        result = score_resume_match(parsed, job)
        qualification = result["components"]["qualification"]

        self.assertEqual(qualification["ratio_percent"], 100.0)
        self.assertEqual(qualification["score"], qualification["max_score"])

    def test_role_related_evidence_contributes_to_score(self):
        job = {
            "job_title": "Backend Developer",
            "description": "Build secure APIs and maintain backend services",
        }
        parsed = parser_result(
            current_designation="Backend Developer",
            summary="Builds secure APIs and maintains backend services",
        )

        result = score_resume_match(parsed, job)

        self.assertTrue(result["components"]["role_evidence"]["available"])
        self.assertGreater(result["components"]["role_evidence"]["score"], 0)

    def test_sensitive_attributes_do_not_change_match_score(self):
        job = {
            "required_skills": ["Python", "Flask"],
            "required_experience": "2+ years",
            "qualification": "Bachelor Computer Science",
            "job_title": "Backend Developer",
        }
        common = {
            "skills": ["Python", "Flask"],
            "total_experience_years": 3,
            "education": [{"degree": "Bachelor", "specialisation": "Computer Science"}],
            "current_designation": "Backend Developer",
        }

        normal = score_resume_match(parser_result(**common), job)
        with_sensitive = score_resume_match(
            parser_result(
                **common,
                age=45,
                gender="Example",
                religion="Example",
                caste="Example",
                marital_status="Example",
                disability="Example",
                photograph="example.jpg",
                home_address="Example address",
            ),
            job,
        )

        self.assertEqual(normal["score"], with_sensitive["score"])
        self.assertEqual(normal["components"], with_sensitive["components"])

    def test_no_structured_job_requirements_returns_insufficient_result(self):
        result = score_resume_match(parser_result(full_name="Candidate"), {})

        self.assertEqual(result["score"], 0)
        self.assertTrue(result["insufficient_job_requirements"])
        self.assertEqual(result["band"], "limited_evidence")

    def test_score_is_decision_support_only(self):
        job = {
            "required_skills": ["Python"],
            "required_experience": "1+ years",
        }
        parsed = parser_result(
            skills=["Python"],
            total_experience_years=2,
        )

        result = score_resume_match(parsed, job)

        self.assertTrue(result["human_review_required"])
        self.assertFalse(result["automatic_decision_allowed"])
        self.assertIn("not an employment decision", result["candidate_message"])

    def test_result_contains_version_methodology_and_completeness(self):
        job = {
            "required_skills": ["Python"],
            "required_experience": "Fresher",
        }
        parsed = parser_result(
            full_name="Candidate",
            email="candidate@example.com",
            phone="+91 9000000000",
            current_designation="Graduate",
            total_experience_years=0,
            skills=["Python"],
            education=[{"degree": "Bachelor"}],
        )

        result = score_resume_match(parsed, job)

        self.assertEqual(result["match_version"], MATCH_VERSION)
        self.assertIn("used", result["methodology"])
        self.assertIn("not_used", result["methodology"])
        self.assertIn("profile_completeness", result)
        self.assertGreaterEqual(result["profile_completeness"]["percent"], 80)


if __name__ == "__main__":
    unittest.main()