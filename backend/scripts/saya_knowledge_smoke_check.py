"""
Validate and optionally seed Saya's role-aware YourComate HRMS knowledge.

Run from the backend folder:

    python scripts/saya_knowledge_smoke_check.py

Run static checks and live MongoDB readiness checks:

    python scripts/saya_knowledge_smoke_check.py --live

Seed the global semantic knowledge catalogue, then verify it:

    python scripts/saya_knowledge_smoke_check.py --seed --live

Seed an additional tenant-scoped catalogue only when custom tenant knowledge is
intentionally required:

    python scripts/saya_knowledge_smoke_check.py --seed --tenant-id TENANT_ID --live

Notes:
- Static validation does not call Gemini, Razorpay, Firebase, or MongoDB.
- --seed requires GEMINI_API_KEY, google-genai, and a reachable MongoDB.
- Global knowledge is normally sufficient. Avoid seeding the same static
  catalogue for every tenant because it creates duplicate embeddings.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence


CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]
PROJECT_DIR = BACKEND_DIR.parent

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


EXPECTED_CAPABILITY_VERSION = "2026-07-21-FILE3-R3"
EXPECTED_KNOWLEDGE_VERSION = "2026-07-21-v2"
MIN_WORKFLOW_COUNT = 100
MIN_MODULE_COUNT = 70


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str
    category: str = "static"
    warning: bool = False


def safe_text(value: Any) -> str:
    return str(value or "").strip()


def serialize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, Path):
        return str(value)

    if isinstance(value, Mapping):
        return {str(key): serialize(item) for key, item in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [serialize(item) for item in value]

    try:
        from bson import ObjectId

        if isinstance(value, ObjectId):
            return str(value)
    except Exception:
        pass

    return value


def make_result(
    name: str,
    ok: bool,
    detail: str,
    *,
    category: str = "static",
    warning: bool = False,
) -> CheckResult:
    return CheckResult(
        name=name,
        ok=bool(ok),
        detail=safe_text(detail),
        category=category,
        warning=bool(warning),
    )


def context(
    role: str,
    *,
    employee: Mapping[str, Any] | None = None,
    designation: str = "",
    allowed_modules: Sequence[str] | None = None,
    profile_key: str = "growth",
) -> Dict[str, Any]:
    tenant_modules = list(allowed_modules or ["all"])
    employee_doc = dict(employee or {})

    if designation:
        employee_doc.setdefault("designation", designation)

    return {
        "role": role,
        "roles": [role],
        "tenant_id": "saya-smoke-test",
        "tenant": {
            "tenant_id": "saya-smoke-test",
            "company_name": "Saya Smoke Test Company",
            "allowed_modules": tenant_modules,
        },
        "employee": employee_doc,
        "designation": designation,
        "_saya_subscription_snapshot": {
            "profile_key": profile_key,
            "plan_code": profile_key
            if profile_key in {"essential", "growth", "premium"}
            else "",
            "allowed_modules": tenant_modules,
            "is_demo_company": profile_key == "demo",
            "is_paid_company": profile_key in {"essential", "growth", "premium"},
            "is_lifetime": profile_key == "lifetime",
            "is_expired": profile_key == "expired",
        },
    }


def titles(rows: Iterable[Mapping[str, Any]]) -> List[str]:
    result = []

    for row in rows:
        doc = row.get("doc") if isinstance(row, Mapping) else None
        if not isinstance(doc, Mapping):
            doc = row if isinstance(row, Mapping) else {}

        title = safe_text(doc.get("title"))
        if title:
            result.append(title)

    return result


def run_static_checks() -> List[CheckResult]:
    from app.ai_knowledge.hrms_workflows import (
        HRMS_WORKFLOWS,
        KNOWLEDGE_VERSION,
        validate_workflow_knowledge,
    )
    from app.ai_knowledge.role_profiles import (
        derive_effective_ai_roles,
        resolve_primary_role,
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
    )

    results: List[CheckResult] = []

    validation = validate_workflow_knowledge()
    results.append(make_result(
        "workflow_catalogue",
        validation.get("workflow_count", 0) >= MIN_WORKFLOW_COUNT
        and validation.get("module_count", 0) >= MIN_MODULE_COUNT
        and validation.get("knowledge_version") == EXPECTED_KNOWLEDGE_VERSION,
        (
            f"version={validation.get('knowledge_version')}, "
            f"workflows={validation.get('workflow_count')}, "
            f"modules={validation.get('module_count')}"
        ),
    ))

    identities = [
        (safe_text(item.get("module")), safe_text(item.get("title")))
        for item in HRMS_WORKFLOWS
    ]
    duplicate_identities = sorted({item for item in identities if identities.count(item) > 1})
    results.append(make_result(
        "workflow_identity_uniqueness",
        not duplicate_identities,
        "No duplicate module/title records."
        if not duplicate_identities
        else f"Duplicates: {duplicate_identities[:5]}",
    ))

    results.append(make_result(
        "knowledge_version",
        KNOWLEDGE_VERSION == EXPECTED_KNOWLEDGE_VERSION,
        f"loaded={KNOWLEDGE_VERSION}, expected={EXPECTED_KNOWLEDGE_VERSION}",
    ))

    results.append(make_result(
        "capability_service_version",
        SAYA_CAPABILITY_SERVICE_VERSION == EXPECTED_CAPABILITY_VERSION,
        (
            f"loaded={SAYA_CAPABILITY_SERVICE_VERSION}, "
            f"expected={EXPECTED_CAPABILITY_VERSION}"
        ),
    ))

    finance = check_ai_role_permission(
        "Explain Finance Approval, payroll lock and salary disbursement.",
        context("finance"),
    )
    results.append(make_result(
        "finance_payroll_access",
        finance.get("allowed") is True
        and finance.get("primary_role") == "finance"
        and "payroll" in (finance.get("asked_modules") or []),
        json.dumps(serialize(finance), ensure_ascii=False),
    ))

    hr = check_ai_role_permission(
        "How do I create a new employee and complete payroll HR Review?",
        context("hr"),
    )
    results.append(make_result(
        "hr_employee_and_payroll_access",
        hr.get("allowed") is True
        and {"employees", "payroll"}.issubset(set(hr.get("asked_modules") or [])),
        json.dumps(serialize(hr), ensure_ascii=False),
    ))

    employee_block = check_ai_role_permission(
        "How do I create a new employee?",
        context("employee"),
    )
    results.append(make_result(
        "employee_master_block",
        employee_block.get("allowed") is False
        and "employees" in (employee_block.get("blocked_modules") or []),
        json.dumps(serialize(employee_block), ensure_ascii=False),
    ))

    managing_director = check_ai_role_permission(
        "How do I create a new employee?",
        context("employee", designation="Managing Director"),
    )
    results.append(make_result(
        "designation_does_not_grant_access",
        managing_director.get("allowed") is False
        and managing_director.get("primary_role") == "employee",
        json.dumps(serialize(managing_director), ensure_ascii=False),
    ))

    team_leader_context = context(
        "employee",
        employee={"is_team_leader": True},
    )
    team_leader = check_ai_role_permission(
        "How do I complete first level team approvals?",
        team_leader_context,
    )
    team_leader_roles = derive_effective_ai_roles(team_leader_context)
    results.append(make_result(
        "verified_team_leader_access",
        team_leader.get("allowed") is True
        and "team_leader" in team_leader_roles
        and resolve_primary_role(team_leader_roles) == "team_leader",
        (
            f"roles={team_leader_roles}; "
            f"permission={json.dumps(serialize(team_leader), ensure_ascii=False)}"
        ),
    ))

    unverified_team_leader = check_ai_role_permission(
        "How do I complete first level team approvals?",
        context("team_leader"),
    )
    results.append(make_result(
        "unverified_team_leader_block",
        unverified_team_leader.get("allowed") is False,
        json.dumps(serialize(unverified_team_leader), ensure_ascii=False),
    ))

    reporting_context = context(
        "employee",
        employee={"is_reporting_officer": True},
    )
    reporting = check_ai_role_permission(
        "How do I complete reporting officer approval?",
        reporting_context,
    )
    results.append(make_result(
        "verified_reporting_officer_access",
        reporting.get("allowed") is True
        and reporting.get("asked_modules") == ["team_approvals"],
        json.dumps(serialize(reporting), ensure_ascii=False),
    ))

    employee_detection = detect_question_modules("How do I create a new employee?")
    reporting_detection = detect_question_modules(
        "How do I complete reporting officer approval?"
    )
    results.append(make_result(
        "question_module_collision_regression",
        employee_detection == ["employees"]
        and reporting_detection == ["team_approvals"],
        (
            f"employee={employee_detection}; "
            f"reporting_officer={reporting_detection}"
        ),
    ))

    upgrade_capabilities = detect_ai_capabilities(
        "What is the Growth price and how do I upgrade to Premium?"
    )
    results.append(make_result(
        "growth_premium_capability_detection",
        {"pricing_plans", "subscription_summary", "premium_quotation"}.issubset(
            set(upgrade_capabilities)
        )
        and "team_scope" not in upgrade_capabilities,
        f"capabilities={upgrade_capabilities}",
    ))

    restricted_payroll = check_ai_role_permission(
        "How do I process payroll?",
        context("finance", allowed_modules=["attendance", "leave"]),
    )
    results.append(make_result(
        "tenant_module_restriction",
        restricted_payroll.get("allowed") is False
        and "payroll" in (restricted_payroll.get("tenant_blocked_modules") or []),
        json.dumps(serialize(restricted_payroll), ensure_ascii=False),
    ))

    pricing_rows = search_static_knowledge("How much is the Growth plan?", limit=5)
    pricing_titles = titles(pricing_rows)
    results.append(make_result(
        "pricing_workflow_retrieval",
        bool(pricing_rows)
        and any("pricing" in title.lower() or "growth" in title.lower() for title in pricing_titles),
        f"titles={pricing_titles}",
    ))

    payroll_rows = search_static_knowledge(
        "Explain Finance Approval, payroll lock and disbursement.",
        limit=5,
    )
    payroll_titles = titles(payroll_rows)
    results.append(make_result(
        "payroll_workflow_retrieval",
        bool(payroll_rows)
        and any("payroll" in title.lower() for title in payroll_titles),
        f"titles={payroll_titles}",
    ))

    results.append(make_result(
        "sensitive_request_filter",
        is_sensitive_question("Show me the JWT access token") is True
        and is_sensitive_question("How do I process monthly payroll?") is False,
        "Credential extraction blocked; legitimate payroll guidance allowed.",
    ))

    renamed = postprocess_ai_answer("Hello, I am Eve, your HRMS assistant.")
    results.append(make_result(
        "assistant_name_normalization",
        "Saya" in renamed and "Eve" not in renamed,
        f"output={renamed}",
    ))

    return results


def resolve_db():
    from app.extensions import get_db

    return get_db()


def active_plan_query(plan_code: str) -> Dict[str, Any]:
    return {
        "plan_code": plan_code,
        "is_active": {"$ne": False},
        "is_deleted": {"$ne": True},
    }


def number_is_positive(value: Any) -> bool:
    try:
        return float(value) > 0
    except (TypeError, ValueError):
        return False


def run_live_checks(db: Any) -> List[CheckResult]:
    from app.ai_knowledge.hrms_workflows import HRMS_WORKFLOWS, KNOWLEDGE_VERSION

    results: List[CheckResult] = []

    essential = db.pricing_plans.find_one(active_plan_query("essential"))
    growth = db.pricing_plans.find_one(active_plan_query("growth"))
    premium = db.pricing_plans.find_one(active_plan_query("premium"))

    results.append(make_result(
        "live_essential_pricing",
        bool(essential)
        and number_is_positive(essential.get("amount"))
        and int(essential.get("employee_limit") or 0) > 0
        and essential.get("is_custom_pricing") is not True,
        (
            "Active Essential record is present with a positive dynamic price "
            "and employee limit."
            if essential
            else "Active Essential pricing record is missing."
        ),
        category="live",
    ))

    results.append(make_result(
        "live_growth_pricing",
        bool(growth)
        and number_is_positive(growth.get("amount"))
        and int(growth.get("employee_limit") or 0) > 0
        and growth.get("is_custom_pricing") is not True,
        (
            "Active Growth record is present with a positive dynamic price "
            "and employee limit."
            if growth
            else "Active Growth pricing record is missing."
        ),
        category="live",
    ))

    results.append(make_result(
        "live_premium_configuration",
        bool(premium)
        and premium.get("is_custom_pricing") is True
        and premium.get("is_unlimited_employees") is True
        and premium.get("allow_online_payment") is not True,
        (
            "Premium is configured as custom, unlimited, and quotation-first."
            if premium
            else "Active Premium pricing record is missing."
        ),
        category="live",
    ))

    tenant_count = db.tenants.count_documents({"tenant_id": {"$exists": True}})
    results.append(make_result(
        "live_tenant_records",
        tenant_count > 0,
        f"tenant_count={tenant_count}",
        category="live",
    ))

    active_global_query = {
        "tenant_id": None,
        "source": "yourcomate_static_workflow",
        "knowledge_version": KNOWLEDGE_VERSION,
        "is_active": True,
    }
    active_global_count = db.ai_knowledge.count_documents(active_global_query)
    results.append(make_result(
        "live_global_knowledge_seed",
        active_global_count == len(HRMS_WORKFLOWS),
        (
            f"active_seeded={active_global_count}, "
            f"expected={len(HRMS_WORKFLOWS)}, version={KNOWLEDGE_VERSION}"
        ),
        category="live",
        warning=active_global_count == 0,
    ))

    return results


def seed_catalogue(db: Any, tenant_id: str | None = None) -> Dict[str, Any]:
    from app.ai_knowledge.hrms_workflows import HRMS_WORKFLOWS, KNOWLEDGE_VERSION
    from app.services.ai_assistant_service import seed_ai_knowledge

    result = seed_ai_knowledge(tenant_id=tenant_id)
    query = {
        "tenant_id": tenant_id,
        "source": "yourcomate_static_workflow",
        "knowledge_version": KNOWLEDGE_VERSION,
        "is_active": True,
    }
    active_count = db.ai_knowledge.count_documents(query)

    return {
        **result,
        "tenant_id": tenant_id,
        "active_verified_count": active_count,
        "expected_active_count": len(HRMS_WORKFLOWS),
        "verified": active_count == len(HRMS_WORKFLOWS),
    }


def source_name_checks() -> List[CheckResult]:
    files = [
        BACKEND_DIR / "app" / "routes" / "ai_assistant.py",
        BACKEND_DIR / "app" / "services" / "ai_assistant_service.py",
        BACKEND_DIR / "app" / "services" / "ai_capability_service.py",
        PROJECT_DIR / "frontend" / "src" / "components" / "AiAssistantWidget.jsx",
    ]

    results: List[CheckResult] = []

    for path in files:
        if not path.exists():
            results.append(make_result(
                f"assistant_name_source:{path.name}",
                False,
                f"File not found: {path}",
                warning=True,
            ))
            continue

        text = path.read_text(encoding="utf-8", errors="replace")
        saya_present = "Saya" in text
        legacy_count = len(re.findall(r"\bEve\b", text))

        # ai_assistant_service.py intentionally keeps one compatibility regex
        # that rewrites old cached/provider output from Eve to Saya. It is not
        # a user-facing assistant identity and is therefore allowed.
        allowed_legacy_count = (
            1
            if path.name == "ai_assistant_service.py"
            and "postprocess_ai_answer" in text
            and "ASSISTANT_NAME = \"Saya\"" in text
            else 0
        )
        unexpected_legacy = max(0, legacy_count - allowed_legacy_count)

        results.append(make_result(
            f"assistant_name_source:{path.name}",
            saya_present and unexpected_legacy == 0,
            (
                f"Saya references={len(re.findall(r'\bSaya\b', text))}; "
                f"legacy compatibility references={legacy_count}; "
                f"unexpected legacy references={unexpected_legacy}"
            ),
            warning=unexpected_legacy > 0,
        ))

    return results


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Validate Saya role/subscription knowledge and optionally seed its "
            "semantic workflow catalogue."
        ),
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Connect to MongoDB and verify pricing, tenant, and seeded knowledge records.",
    )
    parser.add_argument(
        "--seed",
        action="store_true",
        help="Seed the global Saya workflow catalogue using Gemini embeddings.",
    )
    parser.add_argument(
        "--tenant-id",
        default="",
        help=(
            "Also seed the same catalogue for one tenant. Use only for an "
            "intentional tenant-specific knowledge namespace."
        ),
    )
    parser.add_argument(
        "--skip-name-check",
        action="store_true",
        help="Skip source-file checks for the Saya name.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON output.",
    )
    return parser


def print_human(result: Mapping[str, Any]) -> None:
    print("Saya Knowledge and Role Smoke Check")
    print("===================================")
    print(f"Completed: {result.get('completed_at')}")
    print("")

    for item in result.get("checks") or []:
        if item.get("ok"):
            marker = "PASS"
        elif item.get("warning"):
            marker = "WARN"
        else:
            marker = "FAIL"

        print(f"[{marker}] {item.get('name')}")
        print(f"       {item.get('detail')}")

    seed_results = result.get("seed_results") or []
    if seed_results:
        print("")
        print("Seed results")
        print("------------")
        for item in seed_results:
            scope = item.get("tenant_id") or "global"
            print(
                f"- {scope}: inserted={item.get('inserted_count', 0)}, "
                f"updated={item.get('updated_count', 0)}, "
                f"skipped={item.get('skipped_count', 0)}, "
                f"deactivated={item.get('deactivated_count', 0)}, "
                f"verified={item.get('verified')}"
            )

    print("")
    print(
        f"Result: {'PASS' if result.get('ok') else 'FAIL'} | "
        f"passed={result.get('passed')} | "
        f"warnings={result.get('warnings')} | "
        f"failed={result.get('failed')}"
    )


def main() -> int:
    args = build_parser().parse_args()
    os.chdir(BACKEND_DIR)

    checks = run_static_checks()

    if not args.skip_name_check:
        checks.extend(source_name_checks())

    seed_results: List[Dict[str, Any]] = []
    needs_app = args.live or args.seed or bool(safe_text(args.tenant_id))

    if safe_text(args.tenant_id) and not args.seed:
        checks.append(make_result(
            "tenant_seed_argument",
            False,
            "--tenant-id requires --seed.",
        ))

    if needs_app:
        try:
            from app import create_app

            app = create_app()
            with app.app_context():
                db = resolve_db()

                if args.seed:
                    seed_results.append(seed_catalogue(db, tenant_id=None))

                    tenant_id = safe_text(args.tenant_id)
                    if tenant_id:
                        tenant_exists = db.tenants.find_one(
                            {"tenant_id": tenant_id},
                            {"tenant_id": 1},
                        )
                        if not tenant_exists:
                            checks.append(make_result(
                                "tenant_seed_target",
                                False,
                                f"Tenant not found: {tenant_id}",
                                category="live",
                            ))
                        else:
                            seed_results.append(seed_catalogue(db, tenant_id=tenant_id))

                if args.live or args.seed:
                    checks.extend(run_live_checks(db))
        except Exception as exc:
            checks.append(make_result(
                "application_or_database_execution",
                False,
                f"{type(exc).__name__}: {exc}",
                category="live",
            ))

    failed = [item for item in checks if not item.ok and not item.warning]
    warnings = [item for item in checks if not item.ok and item.warning]
    passed = [item for item in checks if item.ok]
    seed_failed = [item for item in seed_results if not item.get("verified")]

    result = {
        "ok": not failed and not seed_failed,
        "completed_at": datetime.now(timezone.utc),
        "capability_version": EXPECTED_CAPABILITY_VERSION,
        "knowledge_version": EXPECTED_KNOWLEDGE_VERSION,
        "passed": len(passed),
        "warnings": len(warnings),
        "failed": len(failed) + len(seed_failed),
        "checks": [asdict(item) for item in checks],
        "seed_results": seed_results,
    }

    clean = serialize(result)

    if args.json:
        print(json.dumps(clean, indent=2, ensure_ascii=False))
    else:
        print_human(clean)

    return 0 if clean.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())