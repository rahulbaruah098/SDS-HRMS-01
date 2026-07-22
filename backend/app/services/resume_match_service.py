"""Explainable resume-to-job matching for YourComate Recruitment.

Decision-support only: this service never approves, rejects, ranks, shortlists,
or selects a candidate automatically. It uses only role-related requirements and
resume evidence. Protected or sensitive attributes are excluded.
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Mapping, Sequence

MATCH_VERSION = "1.0.0"
WEIGHTS = {"skills": 50, "experience": 25, "qualification": 15, "role_evidence": 10}
STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
    "have", "in", "is", "it", "job", "of", "on", "or", "our", "position",
    "required", "role", "the", "to", "we", "will", "with", "work", "working",
    "year", "years",
}
SENSITIVE_FIELDS = {
    "age", "date_of_birth", "dob", "gender", "sex", "marital_status", "religion",
    "caste", "ethnicity", "race", "nationality", "disability", "photo",
    "photograph", "address", "home_address",
}


def safe_text(value: Any) -> str:
    return str(value or "").strip()


def normalize(value: Any) -> str:
    text = safe_text(value).lower()
    text = re.sub(r"[^a-z0-9+#.]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_skill(value: Any) -> str:
    text = normalize(value)
    aliases = {
        "node js": "node.js", "nodejs": "node.js", "react js": "react",
        "reactjs": "react", "next js": "next.js", "nextjs": "next.js",
        "powerbi": "power bi", "ms excel": "microsoft excel",
        "mongo db": "mongodb", "postgre sql": "postgresql",
    }
    return aliases.get(text, text)


def unique(values: Iterable[Any], limit: int = 200) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        item = safe_text(value)
        key = normalize(item)
        if item and key and key not in seen:
            seen.add(key)
            output.append(item)
        if len(output) >= limit:
            break
    return output


def flatten(value: Any, field_name: str = "") -> list[str]:
    if normalize(field_name).replace(" ", "_") in SENSITIVE_FIELDS:
        return []
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, Mapping):
        output: list[str] = []
        for key, nested in value.items():
            normalized_key = normalize(key).replace(" ", "_")
            if normalized_key not in SENSITIVE_FIELDS:
                output.extend(flatten(nested, normalized_key))
        return output
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        output: list[str] = []
        for nested in value:
            output.extend(flatten(nested, field_name))
        return output
    return [safe_text(value)] if safe_text(value) else []


def tokens(value: Any) -> set[str]:
    return {
        token for token in normalize(value).split()
        if len(token) >= 2 and token not in STOP_WORDS
    }


def number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return max(float(value), 0.0)
    match = re.search(r"\d+(?:\.\d+)?", normalize(value))
    return float(match.group(0)) if match else None


def string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return unique(part for part in re.split(r"[,;\n|/]+", value) if safe_text(part))
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        output: list[str] = []
        for item in value:
            output.extend(flatten(item) if isinstance(item, Mapping) else [safe_text(item)])
        return unique(output)
    return [safe_text(value)] if safe_text(value) else []


def fields_of(parser_result: Mapping[str, Any] | None) -> dict[str, Any]:
    fields = dict(parser_result or {}).get("fields")
    return dict(fields) if isinstance(fields, Mapping) else {}


def required_skills(job: Mapping[str, Any] | None) -> list[str]:
    source = dict(job or {})
    return string_list(source.get("required_skills") or source.get("skills") or [])


def candidate_skills(parser_result: Mapping[str, Any] | None) -> list[str]:
    return string_list(fields_of(parser_result).get("skills") or [])


def skills_match(expected: str, actual: str) -> bool:
    left, right = normalize_skill(expected), normalize_skill(actual)
    if not left or not right:
        return False
    if left == right or (len(left) >= 4 and left in right) or (len(right) >= 4 and right in left):
        return True
    left_tokens, right_tokens = tokens(left), tokens(right)
    return bool(left_tokens) and len(left_tokens & right_tokens) / len(left_tokens) >= 0.8


def skill_component(job: Mapping[str, Any] | None, parser_result: Mapping[str, Any] | None) -> dict[str, Any]:
    required = required_skills(job)
    candidate = candidate_skills(parser_result)
    if not required:
        return {"available": False, "score": 0, "max_score": WEIGHTS["skills"], "matched": [], "missing": []}
    matched = [item for item in required if any(skills_match(item, skill) for skill in candidate)]
    missing = [item for item in required if item not in matched]
    ratio = len(matched) / len(required)
    return {
        "available": True, "score": round(ratio * WEIGHTS["skills"], 2),
        "max_score": WEIGHTS["skills"], "ratio_percent": round(ratio * 100, 1),
        "matched": matched, "missing": missing, "candidate_skills": candidate,
        "message": f"{len(matched)} of {len(required)} configured skills were detected.",
    }


def experience_requirement(job: Mapping[str, Any] | None) -> dict[str, Any]:
    source = dict(job or {})
    raw = safe_text(source.get("required_experience") or source.get("experience_required") or source.get("experience"))
    text = re.sub(r"\s+", " ", raw.lower()).strip()
    if not text:
        return {"available": False, "raw": raw, "minimum": None, "maximum": None}
    if any(term in text for term in {"fresher", "entry level", "no experience"}):
        return {"available": True, "raw": raw, "minimum": 0.0, "maximum": None}
    range_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(\d+(?:\.\d+)?)", text)
    if range_match:
        minimum, maximum = float(range_match.group(1)), float(range_match.group(2))
        if maximum < minimum:
            minimum, maximum = maximum, minimum
        return {"available": True, "raw": raw, "minimum": minimum, "maximum": maximum}
    plus_match = re.search(r"(\d+(?:\.\d+)?)\s*\+", text)
    minimum = float(plus_match.group(1)) if plus_match else number(text)
    return {"available": minimum is not None, "raw": raw, "minimum": minimum, "maximum": None}


def experience_component(job: Mapping[str, Any] | None, parser_result: Mapping[str, Any] | None) -> dict[str, Any]:
    requirement = experience_requirement(job)
    fields = fields_of(parser_result)
    candidate_value = fields.get("total_experience_years")
    if candidate_value in (None, ""):
        candidate_value = fields.get("total_experience")
    if candidate_value in (None, ""):
        candidate_value = fields.get("experience_years")
    candidate = number(candidate_value)
    if not requirement["available"]:
        return {"available": False, "score": 0, "max_score": WEIGHTS["experience"], "candidate_years": candidate}
    if candidate is None:
        return {"available": True, "score": 0, "max_score": WEIGHTS["experience"], "candidate_years": None,
                "required_minimum": requirement["minimum"], "required_maximum": requirement["maximum"],
                "message": "The resume did not provide a reliable experience total."}
    minimum = float(requirement["minimum"] or 0)
    ratio = 1.0 if minimum <= 0 or candidate >= minimum else max(candidate / minimum, 0.0)
    return {"available": True, "score": round(ratio * WEIGHTS["experience"], 2),
            "max_score": WEIGHTS["experience"], "ratio_percent": round(ratio * 100, 1),
            "candidate_years": candidate, "required_minimum": minimum,
            "required_maximum": requirement["maximum"],
            "message": f"Detected {candidate:g} years against a minimum requirement of {minimum:g} years."}


def qualification_text(job: Mapping[str, Any] | None) -> str:
    source = dict(job or {})
    return safe_text(source.get("qualification") or source.get("required_qualification") or source.get("education_requirement"))


def qualification_component(job: Mapping[str, Any] | None, parser_result: Mapping[str, Any] | None) -> dict[str, Any]:
    required = qualification_text(job)
    education = " ".join(flatten(fields_of(parser_result).get("education"), "education"))
    if not required:
        return {"available": False, "score": 0, "max_score": WEIGHTS["qualification"]}
    expected, actual = tokens(required), tokens(education)
    ratio = len(expected & actual) / len(expected) if expected and actual else 0.0
    return {"available": True, "score": round(ratio * WEIGHTS["qualification"], 2),
            "max_score": WEIGHTS["qualification"], "ratio_percent": round(ratio * 100, 1),
            "required": required, "matched_terms": sorted(expected & actual),
            "message": "Education evidence was compared with the configured qualification."}


def role_component(job: Mapping[str, Any] | None, parser_result: Mapping[str, Any] | None) -> dict[str, Any]:
    source = dict(job or {})
    expected_text = " ".join(flatten([
        source.get("job_title"), source.get("title"), source.get("description"),
        source.get("job_description"), source.get("responsibilities"), source.get("summary"),
    ]))
    fields = fields_of(parser_result)
    evidence_text = " ".join(flatten([
        fields.get("summary"), fields.get("professional_summary"), fields.get("current_designation"),
        fields.get("skills"), fields.get("education"), fields.get("employment_history"),
        fields.get("certifications"), fields.get("projects"),
    ], "role_evidence"))
    expected, actual = tokens(expected_text), tokens(evidence_text)
    for skill in required_skills(job):
        expected.difference_update(tokens(skill))
    expected.difference_update(tokens(qualification_text(job)))
    if not expected:
        return {"available": False, "score": 0, "max_score": WEIGHTS["role_evidence"]}
    matched = expected & actual
    ratio = min((len(matched) / len(expected)) / 0.35, 1.0)
    return {"available": True, "score": round(ratio * WEIGHTS["role_evidence"], 2),
            "max_score": WEIGHTS["role_evidence"], "ratio_percent": round(ratio * 100, 1),
            "matched_terms": sorted(matched)[:30],
            "message": "Role-related wording was compared with resume evidence."}


def completeness(parser_result: Mapping[str, Any] | None) -> dict[str, Any]:
    fields = fields_of(parser_result)
    checks = {
        "name": bool(safe_text(fields.get("full_name") or fields.get("name"))),
        "email": bool(safe_text(fields.get("email"))), "phone": bool(safe_text(fields.get("phone"))),
        "current role": bool(safe_text(fields.get("current_designation"))),
        "experience": number(fields.get("total_experience_years") or fields.get("total_experience")) is not None,
        "skills": bool(candidate_skills(parser_result)), "education": bool(flatten(fields.get("education"))),
    }
    completed = sum(1 for present in checks.values() if present)
    return {"percent": round(completed / len(checks) * 100),
            "available_fields": [key for key, present in checks.items() if present],
            "missing_fields": [key for key, present in checks.items() if not present]}


def match_band(score: int) -> tuple[str, str]:
    if score >= 80:
        return "high_alignment", "High alignment"
    if score >= 65:
        return "good_alignment", "Good alignment"
    if score >= 45:
        return "partial_alignment", "Partial alignment"
    return "limited_evidence", "Limited evidence"


def score_resume_match(parser_result: Mapping[str, Any] | None, job: Mapping[str, Any] | None) -> dict[str, Any]:
    components = {
        "skills": skill_component(job, parser_result),
        "experience": experience_component(job, parser_result),
        "qualification": qualification_component(job, parser_result),
        "role_evidence": role_component(job, parser_result),
    }
    available = [item for item in components.values() if item.get("available") is True]
    available_weight = sum(float(item.get("max_score") or 0) for item in available)
    earned = sum(float(item.get("score") or 0) for item in available)
    insufficient = available_weight <= 0
    score = 0 if insufficient else round(earned / available_weight * 100)
    band, label = match_band(score)
    skills = components["skills"]
    experience = components["experience"]
    qualification = components["qualification"]
    strengths: list[str] = []
    notes: list[str] = []
    if skills.get("ratio_percent", 0) >= 70:
        strengths.append("Most configured skills were detected.")
    if experience.get("ratio_percent", 0) >= 100:
        strengths.append("Detected experience meets the configured minimum.")
    if qualification.get("ratio_percent", 0) >= 70:
        strengths.append("Education evidence aligns with the configured qualification.")
    if insufficient:
        notes.append("The job needs more structured requirements before a meaningful score can be produced.")
    if skills.get("missing"):
        notes.append("Some configured skills were not detected; the recruitment team must review equivalent wording manually.")
    if experience.get("available") and experience.get("candidate_years") is None:
        notes.append("Experience could not be reliably extracted and must be confirmed manually.")
    notes.extend(unique(dict(parser_result or {}).get("warnings") or [], 30))
    return {
        "ok": True, "match_version": MATCH_VERSION, "score": score, "band": band, "label": label,
        "insufficient_job_requirements": insufficient, "components": components,
        "matched_skills": list(skills.get("matched") or []), "missing_skills": list(skills.get("missing") or []),
        "profile_completeness": completeness(parser_result), "strengths": unique(strengths),
        "review_notes": unique(notes), "human_review_required": True,
        "automatic_decision_allowed": False,
        "candidate_message": "This is an indicative comparison with the published job requirements. It is not an employment decision, and the recruitment team will review the complete application.",
        "methodology": {
            "used": ["required skills", "required experience", "required qualification", "role-related resume evidence"],
            "not_used": ["name", "age", "date of birth", "gender", "marital status", "religion", "caste", "ethnicity", "race", "nationality", "disability", "photograph", "home address"],
        },
    }


__all__ = ["MATCH_VERSION", "score_resume_match"]