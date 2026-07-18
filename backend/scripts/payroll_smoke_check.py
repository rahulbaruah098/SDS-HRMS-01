"""
YourComate HRMS Payroll Integration Smoke Check

Run from the backend directory:

    python scripts/payroll_smoke_check.py

Useful options:

    python scripts/payroll_smoke_check.py --json
    python scripts/payroll_smoke_check.py --run-tests
    python scripts/payroll_smoke_check.py --frontend-build
    python scripts/payroll_smoke_check.py --check-db
    python scripts/payroll_smoke_check.py --skip-app

The default check is non-destructive. It validates source contracts, compiles
the payroll backend, imports the Flask application, and checks registered route
contracts. Optional database checking performs only ping/index inspection.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import py_compile
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]
PROJECT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


PAYROLL_ROUTE_FILE = BACKEND_DIR / "app" / "routes" / "payroll.py"
CRUD_ROUTE_FILE = BACKEND_DIR / "app" / "routes" / "crud.py"
EXTENSIONS_FILE = BACKEND_DIR / "app" / "extensions.py"
REQUIREMENTS_FILE = BACKEND_DIR / "requirements.txt"

SERVICE_FILES = {
    "configuration": BACKEND_DIR / "app" / "services" / "payroll_config_service.py",
    "calculation": BACKEND_DIR / "app" / "services" / "payroll_calculation_service.py",
    "attendance": BACKEND_DIR / "app" / "services" / "payroll_attendance_service.py",
    "loans": BACKEND_DIR / "app" / "services" / "payroll_loan_service.py",
    "reimbursements": BACKEND_DIR / "app" / "services" / "payroll_reimbursement_service.py",
    "banking": BACKEND_DIR / "app" / "services" / "payroll_bank_service.py",
    "reporting": BACKEND_DIR / "app" / "services" / "payroll_reporting_service.py",
    "tax": BACKEND_DIR / "app" / "services" / "payroll_tax_service.py",
}

FRONTEND_FILES = {
    "app": FRONTEND_DIR / "src" / "App.jsx",
    "modules": FRONTEND_DIR / "src" / "data" / "modules.js",
    "payroll": FRONTEND_DIR / "src" / "pages" / "Payroll.jsx",
    "configuration": FRONTEND_DIR / "src" / "pages" / "PayrollConfiguration.jsx",
    "loans": FRONTEND_DIR / "src" / "pages" / "LoansAdvances.jsx",
    "reimbursements": FRONTEND_DIR / "src" / "pages" / "Reimbursements.jsx",
    "banking": FRONTEND_DIR / "src" / "pages" / "PayrollBanking.jsx",
    "reports": FRONTEND_DIR / "src" / "pages" / "PayrollReports.jsx",
    "tax": FRONTEND_DIR / "src" / "pages" / "TaxDeclarations.jsx",
    "payslips": FRONTEND_DIR / "src" / "pages" / "Payslips.jsx",
}

TEST_MODULES = [
    "tests.test_payroll_calculation_service",
    "tests.test_payroll_attendance_service",
    "tests.test_payroll_loan_service",
    "tests.test_payroll_reimbursement_service",
    "tests.test_payroll_bank_service",
    "tests.test_payroll_reporting_service",
    "tests.test_payroll_tax_service",
]

EXPECTED_TEST_COUNT = 182

PAYROLL_COLLECTION_NAMES = {
    "salary_structures": "salary_structures",
    "statutory_configurations": "statutory_configs",
    "payroll_runs": "payroll_runs",
    "payslips": "payslips",
    "loans_advances": "loans_advances",
    "reimbursements": "payroll_reimbursements",
    "bank_details": "bank_details",
    "bank_exports": "payroll_bank_exports",
    "report_exports": "payroll_report_exports",
    "tax_declarations": "payroll_tax_declarations",
    "tds_instructions": "payroll_tax_instructions",
}


def contract(route: str, *methods: str) -> dict[str, Any]:
    return {
        "route": route,
        "methods": set(methods),
    }


REQUIRED_ROUTE_CONTRACTS = [
    contract("/api/v1/payroll/salary-structure", "POST"),
    contract("/api/v1/payroll/salary-structure/<employee_reference>", "GET"),
    contract(
        "/api/v1/payroll/salary-structure/<employee_reference>/history",
        "GET",
    ),
    contract(
        "/api/v1/payroll/salary-structure/<salary_structure_id>/activate",
        "POST",
    ),
    contract("/api/v1/payroll/statutory-config", "POST"),
    contract("/api/v1/payroll/statutory-config/<state_code>", "GET"),
    contract(
        "/api/v1/payroll/statutory-config/<state_code>/history",
        "GET",
    ),
    contract(
        "/api/v1/payroll/statutory-config/<statutory_config_id>/activate",
        "POST",
    ),
    contract("/api/v1/payroll/attendance-sync", "POST"),
    contract("/api/v1/payroll/calculate", "POST"),
    contract("/api/v1/payroll/run/approve", "POST"),
    contract(
        "/api/v1/payroll/payslip/<employee_reference>/<int:month>/<int:year>",
        "GET",
    ),
    contract("/api/v1/payroll/loans", "GET", "POST"),
    contract("/api/v1/payroll/loans/<loan_advance_id>", "GET", "PATCH"),
    contract(
        "/api/v1/payroll/loans/<loan_advance_id>/submit",
        "POST",
    ),
    contract(
        "/api/v1/payroll/loans/<loan_advance_id>/approve",
        "POST",
    ),
    contract(
        "/api/v1/payroll/loans/<loan_advance_id>/reject",
        "POST",
    ),
    contract(
        "/api/v1/payroll/loans/<loan_advance_id>/disburse",
        "POST",
    ),
    contract(
        "/api/v1/payroll/loans/<loan_advance_id>/cancel",
        "POST",
    ),
    contract(
        "/api/v1/payroll/loans/<loan_advance_id>/recovery-terms",
        "POST",
    ),
    contract(
        "/api/v1/payroll/run/<run_id>/apply-loan-recoveries",
        "POST",
    ),
    contract("/api/v1/payroll/reimbursements", "GET", "POST"),
    contract(
        "/api/v1/payroll/reimbursements/<reimbursement_id>",
        "GET",
        "PATCH",
    ),
    contract(
        "/api/v1/payroll/reimbursements/<reimbursement_id>/submit",
        "POST",
    ),
    contract(
        "/api/v1/payroll/reimbursements/<reimbursement_id>/hr-review",
        "POST",
    ),
    contract(
        "/api/v1/payroll/reimbursements/<reimbursement_id>/approve",
        "POST",
    ),
    contract(
        "/api/v1/payroll/reimbursements/<reimbursement_id>/reject",
        "POST",
    ),
    contract(
        "/api/v1/payroll/reimbursements/<reimbursement_id>/cancel",
        "POST",
    ),
    contract(
        "/api/v1/payroll/reimbursements/<reimbursement_id>/payment-schedule",
        "POST",
    ),
    contract(
        "/api/v1/payroll/reimbursements/<reimbursement_id>/manual-payment",
        "POST",
    ),
    contract(
        "/api/v1/payroll/run/<run_id>/apply-reimbursement-payments",
        "POST",
    ),
    contract("/api/v1/payroll/bank-details", "GET", "POST"),
    contract(
        "/api/v1/payroll/bank-details/<employee_reference>",
        "GET",
        "PUT",
    ),
    contract(
        "/api/v1/payroll/bank-details/<employee_reference>/verify",
        "POST",
    ),
    contract(
        "/api/v1/payroll/bank-details/<employee_reference>/deactivate",
        "POST",
    ),
    contract(
        "/api/v1/payroll/run/<run_id>/prepare-bank-snapshots",
        "POST",
    ),
    contract(
        "/api/v1/payroll/run/<run_id>/bank-file",
        "GET",
        "POST",
    ),
    contract("/api/v1/payroll/bank-exports", "GET"),
    contract(
        "/api/v1/payroll/bank-exports/<export_id>/status",
        "POST",
    ),
    contract("/api/v1/payroll/reports/register", "GET"),
    contract("/api/v1/payroll/reports/summary", "GET"),
    contract("/api/v1/payroll/reports/statutory", "GET"),
    contract("/api/v1/payroll/reports/departments", "GET"),
    contract(
        "/api/v1/payroll/reports/employee-statement/<employee_reference>",
        "GET",
    ),
    contract("/api/v1/payroll/reports/variance", "GET"),
    contract("/api/v1/payroll/reports/trend", "GET"),
    contract("/api/v1/payroll/reports/generate", "POST"),
    contract("/api/v1/payroll/reports/export", "POST"),
    contract("/api/v1/payroll/report-exports", "GET"),
    contract(
        "/api/v1/payroll/report-exports/<export_id>/status",
        "POST",
    ),
    contract("/api/v1/payroll/tax-declarations", "GET"),
    contract(
        "/api/v1/payroll/tax-declarations/<employee_reference>/<financial_year>",
        "GET",
        "PUT",
    ),
    contract(
        "/api/v1/payroll/tax-declarations/<employee_reference>/<financial_year>/submit",
        "POST",
    ),
    contract(
        "/api/v1/payroll/tax-declarations/<employee_reference>/<financial_year>/hr-review",
        "POST",
    ),
    contract(
        "/api/v1/payroll/tax-declarations/<employee_reference>/<financial_year>/approve",
        "POST",
    ),
    contract(
        "/api/v1/payroll/tax-declarations/<employee_reference>/<financial_year>/reject",
        "POST",
    ),
    contract(
        "/api/v1/payroll/tax-declarations/<employee_reference>/<financial_year>/cancel",
        "POST",
    ),
    contract(
        "/api/v1/payroll/tax-declarations/<employee_reference>/<financial_year>/lock",
        "POST",
    ),
    contract("/api/v1/payroll/tds-instructions", "GET", "POST"),
    contract(
        "/api/v1/payroll/tds-instructions/<instruction_id>/activate",
        "POST",
    ),
    contract(
        "/api/v1/payroll/tds-instructions/<instruction_id>/deactivate",
        "POST",
    ),
    contract(
        "/api/v1/payroll/tax-context/<employee_reference>/<period_key>",
        "GET",
    ),
]


REQUIRED_TAX_FUNCTIONS = {
    "financial_year_for_period",
    "normalize_financial_year",
    "normalize_tax_regime",
    "normalize_tds_mode",
    "normalize_declaration_payload",
    "get_tax_declaration",
    "upsert_tax_declaration",
    "submit_tax_declaration",
    "complete_tax_hr_review",
    "approve_tax_declaration",
    "reject_tax_declaration",
    "cancel_tax_declaration",
    "lock_tax_declaration",
    "list_tax_declarations",
    "create_tds_instruction",
    "activate_tds_instruction",
    "deactivate_tds_instruction",
    "list_tds_instructions",
    "resolve_tds_for_payroll",
    "tax_declaration_snapshot",
    "resolve_payroll_tax_context",
}

REQUIRED_REPORTING_FUNCTIONS = {
    "payroll_register",
    "payroll_summary",
    "statutory_summary",
    "department_summary",
    "period_variance",
    "payroll_trend",
    "employee_statement",
    "normalize_report_type",
    "generate_payroll_report_csv",
    "list_payroll_report_exports",
    "update_payroll_report_export_status",
}


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str
    required: bool = True
    data: Any = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def serialize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, Path):
        return str(value)

    if isinstance(value, set):
        return sorted(serialize(item) for item in value)

    if isinstance(value, tuple):
        return [serialize(item) for item in value]

    if isinstance(value, list):
        return [serialize(item) for item in value]

    if isinstance(value, dict):
        return {
            str(key): serialize(item)
            for key, item in value.items()
        }

    try:
        from bson import ObjectId

        if isinstance(value, ObjectId):
            return str(value)
    except Exception:
        pass

    return value


def result(
    name: str,
    ok: bool,
    detail: str,
    *,
    required: bool = True,
    data: Any = None,
) -> CheckResult:
    return CheckResult(
        name=name,
        ok=bool(ok),
        detail=detail,
        required=required,
        data=serialize(data),
    )


def existing_file_checks() -> list[CheckResult]:
    checks: list[CheckResult] = []

    required_files = {
        "payroll route": PAYROLL_ROUTE_FILE,
        "CRUD route": CRUD_ROUTE_FILE,
        "database extensions": EXTENSIONS_FILE,
        "requirements": REQUIREMENTS_FILE,
        **{
            f"{name} service": path
            for name, path in SERVICE_FILES.items()
        },
        **{
            f"frontend {name}": path
            for name, path in FRONTEND_FILES.items()
        },
    }

    for label, path in required_files.items():
        checks.append(
            result(
                f"File: {label}",
                path.is_file(),
                str(path.relative_to(PROJECT_DIR))
                if path.exists()
                else f"Missing: {path}",
            )
        )

    return checks


def python_compile_checks() -> list[CheckResult]:
    checks: list[CheckResult] = []
    files = [
        PAYROLL_ROUTE_FILE,
        CRUD_ROUTE_FILE,
        EXTENSIONS_FILE,
        *SERVICE_FILES.values(),
    ]

    for path in files:
        if not path.is_file():
            checks.append(
                result(
                    f"Compile: {path.name}",
                    False,
                    f"File does not exist: {path}",
                )
            )
            continue

        try:
            py_compile.compile(
                str(path),
                doraise=True,
            )
            checks.append(
                result(
                    f"Compile: {path.name}",
                    True,
                    "Python syntax is valid.",
                )
            )
        except Exception as exc:
            checks.append(
                result(
                    f"Compile: {path.name}",
                    False,
                    safe_text(exc),
                )
            )

    return checks


def top_level_functions(path: Path) -> set[str]:
    tree = ast.parse(read_text(path), filename=str(path))
    return {
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def service_contract_checks() -> list[CheckResult]:
    checks: list[CheckResult] = []

    contracts = [
        (
            "Payroll tax service functions",
            SERVICE_FILES["tax"],
            REQUIRED_TAX_FUNCTIONS,
        ),
        (
            "Payroll reporting service functions",
            SERVICE_FILES["reporting"],
            REQUIRED_REPORTING_FUNCTIONS,
        ),
    ]

    for label, path, required_names in contracts:
        try:
            functions = top_level_functions(path)
            missing = sorted(required_names.difference(functions))
            checks.append(
                result(
                    label,
                    not missing,
                    (
                        f"All {len(required_names)} required functions are present."
                        if not missing
                        else f"Missing: {', '.join(missing)}"
                    ),
                    data={
                        "required_count": len(required_names),
                        "missing": missing,
                    },
                )
            )
        except Exception as exc:
            checks.append(
                result(
                    label,
                    False,
                    safe_text(exc),
                )
            )

    return checks


def static_payroll_contract_checks() -> list[CheckResult]:
    checks: list[CheckResult] = []

    if not PAYROLL_ROUTE_FILE.is_file():
        return [
            result(
                "Payroll source contracts",
                False,
                f"Missing: {PAYROLL_ROUTE_FILE}",
            )
        ]

    text = read_text(PAYROLL_ROUTE_FILE)

    required_markers = {
        "Tax service imported":
            "from app.services.payroll_tax_service import (",
        "Reporting service imported":
            "from app.services.payroll_reporting_service import (",
        "Tax error handler":
            "def handle_payroll_tax_error",
        "Tax context applied during calculation":
            "tax_context = resolve_payroll_tax_context(",
        "Request-body TDS override removed":
            'calculation_inputs.pop("tdsAmount", None)',
        "Effective TDS mode applied":
            'effective_tds_config["mode"] = resolved_tds_mode',
        "Tax context immutable snapshot":
            '"tax_context_snapshot": _snapshot(tax_context)',
        "Tax declaration immutable snapshot":
            '"tax_declaration_snapshot": _snapshot(',
        "TDS instruction immutable snapshot":
            '"tds_instruction_snapshot": _snapshot(',
        "PDF endpoint":
            '@payroll_bp.get("/payslip/<employee_reference>/<int:month>/<int:year>")',
        "Attendance sync endpoint":
            '@payroll_bp.post("/attendance-sync")',
        "Bank file endpoint":
            '"/run/<run_id>/bank-file"',
        "Report generation endpoint":
            '@payroll_bp.post("/reports/generate")',
        "Tax declaration endpoint":
            '@payroll_bp.get("/tax-declarations")',
        "TDS instruction endpoint":
            '@payroll_bp.post("/tds-instructions")',
    }

    for label, marker in required_markers.items():
        checks.append(
            result(
                f"Payroll contract: {label}",
                marker in text,
                "Present." if marker in text else f"Missing marker: {marker}",
            )
        )

    forbidden_markers = {
        "No hard-coded automatic tax slab engine":
            "calculate_income_tax_slab(",
        "No client TDS override assignment":
            'calculation_inputs["tds_amount"] = _number(',
    }

    for label, marker in forbidden_markers.items():
        present = marker in text
        checks.append(
            result(
                f"Payroll safety: {label}",
                not present,
                (
                    "Forbidden implementation is absent."
                    if not present
                    else f"Forbidden marker found: {marker}"
                ),
            )
        )

    return checks


def registered_route_methods(app: Any, route_path: str) -> set[str]:
    methods: set[str] = set()

    for rule in app.url_map.iter_rules():
        if str(rule.rule) != route_path:
            continue

        methods.update(
            method
            for method in rule.methods
            if method not in {"HEAD", "OPTIONS"}
        )

    return methods


def route_contract_checks(app: Any) -> list[CheckResult]:
    checks: list[CheckResult] = []

    for item in REQUIRED_ROUTE_CONTRACTS:
        expected = set(item["methods"])
        actual = registered_route_methods(app, item["route"])
        missing = sorted(expected.difference(actual))
        ok = bool(actual) and not missing

        checks.append(
            result(
                f"Route: {item['route']}",
                ok,
                (
                    f"Registered methods: {', '.join(sorted(actual))}"
                    if ok
                    else (
                        f"Expected {sorted(expected)}, found {sorted(actual)}; "
                        f"missing {missing}"
                    )
                ),
                data={
                    "expected_methods": sorted(expected),
                    "actual_methods": sorted(actual),
                    "missing_methods": missing,
                },
            )
        )

    return checks


def create_app_check(skip_app: bool) -> tuple[list[CheckResult], Any | None]:
    if skip_app:
        return [
            result(
                "Flask application startup",
                True,
                "Skipped by --skip-app.",
                required=False,
            )
        ], None

    try:
        from app import create_app

        app = create_app()
        checks = [
            result(
                "Flask application startup",
                True,
                "create_app() completed successfully.",
            )
        ]
        checks.extend(route_contract_checks(app))
        return checks, app
    except Exception as exc:
        return [
            result(
                "Flask application startup",
                False,
                f"{type(exc).__name__}: {exc}",
            )
        ], None


def crud_security_checks() -> list[CheckResult]:
    if not CRUD_ROUTE_FILE.is_file():
        return [
            result(
                "Payroll CRUD security",
                False,
                f"Missing: {CRUD_ROUTE_FILE}",
            )
        ]

    text = read_text(CRUD_ROUTE_FILE)
    markers = {
        "Privileged payroll read roles":
            "PAYROLL_PRIVILEGED_READ_ROLES",
        "Employee payslip scope":
            "def payslip_scope_query",
        "Employee payroll-run denial":
            "def payroll_run_scope_query",
        "Released payslip restriction":
            'q["status"] = {"$in": ["locked", "disbursed"]}',
        "Payslip scope applied":
            "q = payslip_scope_query(db, q)",
        "Finance employee picker":
            '{"finance", "accounts_finance"}',
        "Payroll period filter":
            'if collection in {"payroll_runs", "payslips"}:',
    }

    return [
        result(
            f"CRUD security: {label}",
            marker in text,
            "Present." if marker in text else f"Missing marker: {marker}",
        )
        for label, marker in markers.items()
    ]


def index_contract_checks() -> list[CheckResult]:
    if not EXTENSIONS_FILE.is_file():
        return [
            result(
                "Payroll index contracts",
                False,
                f"Missing: {EXTENSIONS_FILE}",
            )
        ]

    text = read_text(EXTENSIONS_FILE)
    markers = {
        "Salary structures": "database.salary_structures",
        "Statutory configurations": "database.statutory_configs",
        "Payroll runs": "database.payroll_runs",
        "Payslips": "database.payslips",
        "Loans and advances": "database.loans_advances",
        "Reimbursements": "database.payroll_reimbursements",
        "Bank details": "database.bank_details",
        "Bank exports": "database.payroll_bank_exports",
        "Report exports": "database.payroll_report_exports",
        "Tax declarations": "database.payroll_tax_declarations",
        "TDS instructions": "database.payroll_tax_instructions",
        "Single active TDS partial index": '"status": "active"',
    }

    return [
        result(
            f"Index contract: {label}",
            marker in text,
            "Present." if marker in text else f"Missing marker: {marker}",
        )
        for label, marker in markers.items()
    ]


def payroll_collection_name_checks() -> list[CheckResult]:
    checks: list[CheckResult] = []

    contracts = [
        (
            "Statutory configuration collection",
            SERVICE_FILES["configuration"],
            'db.statutory_configs',
            EXTENSIONS_FILE,
            'database.statutory_configs',
            PAYROLL_COLLECTION_NAMES["statutory_configurations"],
        ),
        (
            "Loans and advances collection",
            SERVICE_FILES["loans"],
            'LOANS_ADVANCES_COLLECTION = "loans_advances"',
            EXTENSIONS_FILE,
            'database.loans_advances',
            PAYROLL_COLLECTION_NAMES["loans_advances"],
        ),
        (
            "Bank details collection",
            SERVICE_FILES["banking"],
            'BANK_DETAILS_COLLECTION = "bank_details"',
            EXTENSIONS_FILE,
            'database.bank_details',
            PAYROLL_COLLECTION_NAMES["bank_details"],
        ),
    ]

    for (
        label,
        service_path,
        service_marker,
        index_path,
        index_marker,
        collection_name,
    ) in contracts:
        try:
            service_text = read_text(service_path)
            index_text = read_text(index_path)
            service_ok = service_marker in service_text
            index_ok = index_marker in index_text

            checks.append(
                result(
                    f"Collection naming: {label}",
                    service_ok and index_ok,
                    (
                        f"Service and index definitions both use "
                        f"'{collection_name}'."
                        if service_ok and index_ok
                        else (
                            f"Service marker present={service_ok}; "
                            f"index marker present={index_ok}; "
                            f"expected collection='{collection_name}'."
                        )
                    ),
                    data={
                        "collection": collection_name,
                        "service_marker_present": service_ok,
                        "index_marker_present": index_ok,
                    },
                )
            )
        except Exception as exc:
            checks.append(
                result(
                    f"Collection naming: {label}",
                    False,
                    f"{type(exc).__name__}: {exc}",
                )
            )

    return checks


def requirements_checks() -> list[CheckResult]:
    if not REQUIREMENTS_FILE.is_file():
        return [
            result(
                "Payroll dependencies",
                False,
                f"Missing: {REQUIREMENTS_FILE}",
            )
        ]

    requirements = read_text(REQUIREMENTS_FILE).lower()
    checks = [
        result(
            "Dependency: WeasyPrint",
            "weasyprint" in requirements,
            (
                "WeasyPrint is listed in requirements.txt."
                if "weasyprint" in requirements
                else "WeasyPrint is missing from requirements.txt."
            ),
        ),
        result(
            "Dependency: PyMongo",
            "pymongo" in requirements,
            (
                "PyMongo is listed in requirements.txt."
                if "pymongo" in requirements
                else "PyMongo is missing from requirements.txt."
            ),
        ),
    ]

    try:
        from weasyprint import HTML

        html = HTML(string="<html><body><p>Payroll PDF check</p></body></html>")
        pdf_bytes = html.write_pdf()
        checks.append(
            result(
                "WeasyPrint runtime",
                bool(pdf_bytes and pdf_bytes.startswith(b"%PDF")),
                f"Generated {len(pdf_bytes)} PDF bytes.",
            )
        )
    except Exception as exc:
        checks.append(
            result(
                "WeasyPrint runtime",
                False,
                f"{type(exc).__name__}: {exc}",
            )
        )

    return checks


def marker_checks(
    file_label: str,
    path: Path,
    markers: dict[str, str],
) -> list[CheckResult]:
    if not path.is_file():
        return [
            result(
                f"{file_label} contracts",
                False,
                f"Missing: {path}",
            )
        ]

    text = read_text(path)
    return [
        result(
            f"{file_label}: {label}",
            marker in text,
            "Present." if marker in text else f"Missing marker: {marker}",
        )
        for label, marker in markers.items()
    ]


def frontend_contract_checks() -> list[CheckResult]:
    checks: list[CheckResult] = []

    checks.extend(
        marker_checks(
            "App.jsx",
            FRONTEND_FILES["app"],
            {
                "Payroll page import":
                    "import Payroll from './pages/Payroll.jsx';",
                "Payroll Configuration import":
                    "import PayrollConfiguration from './pages/PayrollConfiguration.jsx';",
                "Loans import":
                    "import LoansAdvances from './pages/LoansAdvances.jsx';",
                "Reimbursements import":
                    "import Reimbursements from './pages/Reimbursements.jsx';",
                "Banking import":
                    "import PayrollBanking from './pages/PayrollBanking.jsx';",
                "Reports import":
                    "import PayrollReports from './pages/PayrollReports.jsx';",
                "Tax import":
                    "import TaxDeclarations from './pages/TaxDeclarations.jsx';",
                "Payslips import":
                    "import Payslips from './pages/Payslips.jsx';",
                "Reports dedicated route":
                    "return <PayrollReports setPage={setPage} user={safeUser} />;",
                "Tax dedicated route":
                    "return <TaxDeclarations setPage={setPage} user={safeUser} />;",
                "Payslips dedicated route":
                    "return <Payslips setPage={setPage} user={safeUser} />;",
            },
        )
    )

    checks.extend(
        marker_checks(
            "modules.js",
            FRONTEND_FILES["modules"],
            {
                "Payroll Configuration module":
                    "'payroll_configuration'",
                "Loans module":
                    "'loans_advances'",
                "Reimbursements module":
                    "'reimbursements'",
                "Banking module":
                    "'payroll_banking'",
                "Reports module":
                    "'payroll_reports'",
                "Tax module":
                    "'tax_declarations'",
                "Payroll Runs module":
                    "'payroll_runs'",
                "Payslips module":
                    "'payslips'",
                "Report role constant":
                    "PAYROLL_REPORT_ROLES",
                "Tax role constant":
                    "PAYROLL_TAX_ROLES",
            },
        )
    )

    checks.extend(
        marker_checks(
            "Payroll.jsx",
            FRONTEND_FILES["payroll"],
            {
                "Attendance sync":
                    "/payroll/attendance-sync",
                "Payroll calculation":
                    "/payroll/calculate",
                "No manual TDS heading":
                    "Manual attendance input",
                "Tax/TDS navigation":
                    "setPage('tax_declarations')",
                "Reports navigation":
                    "setPage('payroll_reports')",
                "Banking navigation":
                    "setPage('payroll_banking')",
                "Tax context result":
                    "resolveTaxContextSnapshot",
                "Bank snapshot result":
                    "Bank snapshot",
            },
        )
    )

    checks.extend(
        marker_checks(
            "PayrollConfiguration.jsx",
            FRONTEND_FILES["configuration"],
            {
                "Salary structure API":
                    "/payroll/salary-structure",
                "Statutory configuration API":
                    "/payroll/statutory-config",
                "Tax/TDS navigation":
                    "setPage('tax_declarations')",
                "Assam April 2025 preset":
                    "Load Assam Apr 2025 Preset",
                "Authoritative TDS source":
                    "payroll_tax_instruction",
            },
        )
    )

    checks.extend(
        marker_checks(
            "PayrollBanking.jsx",
            FRONTEND_FILES["banking"],
            {
                "Bank details API":
                    "/payroll/bank-details",
                "Bank snapshot preparation":
                    "prepare-bank-snapshots",
                "Bank file API":
                    "/bank-file",
                "Bank export API":
                    "/payroll/bank-exports",
            },
        )
    )

    checks.extend(
        marker_checks(
            "PayrollReports.jsx",
            FRONTEND_FILES["reports"],
            {
                "Report generation API":
                    "/payroll/reports/generate",
                "Report export API":
                    "/payroll/reports/export",
                "Report export history":
                    "/payroll/report-exports",
                "Employee statement type":
                    "employee_statement",
            },
        )
    )

    checks.extend(
        marker_checks(
            "TaxDeclarations.jsx",
            FRONTEND_FILES["tax"],
            {
                "Declaration list API":
                    "/payroll/tax-declarations",
                "HR review API":
                    "/hr-review",
                "Finance approval API":
                    "/approve",
                "TDS instruction API":
                    "/payroll/tds-instructions",
                "Tax context API":
                    "/payroll/tax-context/",
                "No automatic slab warning":
                    "Automatic tax-slab calculation is disabled",
            },
        )
    )

    checks.extend(
        marker_checks(
            "Payslips.jsx",
            FRONTEND_FILES["payslips"],
            {
                "Dedicated component":
                    "export default function Payslips",
                "Payslip collection read":
                    "/payslips",
                "PDF endpoint":
                    "/payroll/payslip/",
                "Employee release restriction notice":
                    "Locked or Disbursed",
                "Tax snapshot":
                    "Tax & TDS Snapshot",
                "Bank snapshot":
                    "Bank & Disbursement",
                "Immutable metadata":
                    "Immutable Calculation Record",
            },
        )
    )

    # Explicitly guard against the regression that caused File 57's build error.
    modules_path = FRONTEND_FILES["modules"]
    if modules_path.is_file():
        modules_text = read_text(modules_path)
        import_match = re.search(
            r"import\s*\{(?P<body>.*?)\}\s*from\s*['\"]lucide-react['\"]",
            modules_text,
            re.DOTALL,
        )
        if import_match:
            names = [
                item.strip()
                for item in import_match.group("body").split(",")
                if item.strip()
            ]
            duplicates = sorted(
                {
                    name
                    for name in names
                    if names.count(name) > 1
                }
            )
            checks.append(
                result(
                    "modules.js: Lucide import duplicates",
                    not duplicates,
                    (
                        "No duplicate Lucide imports."
                        if not duplicates
                        else f"Duplicates: {', '.join(duplicates)}"
                    ),
                    data={"duplicates": duplicates},
                )
            )
        else:
            checks.append(
                result(
                    "modules.js: Lucide import duplicates",
                    False,
                    "The lucide-react import could not be parsed.",
                )
            )

    return checks


def run_subprocess_check(
    name: str,
    command: list[str],
    cwd: Path,
    *,
    expected_text: str = "",
    required: bool = True,
) -> CheckResult:
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception as exc:
        return result(
            name,
            False,
            f"{type(exc).__name__}: {exc}",
            required=required,
        )

    output = "\n".join(
        part.strip()
        for part in [completed.stdout, completed.stderr]
        if part and part.strip()
    )
    ok = completed.returncode == 0

    if expected_text:
        ok = ok and expected_text in output

    detail = (
        f"Command passed: {' '.join(command)}"
        if ok
        else (
            f"Exit code {completed.returncode}. "
            f"Output: {output[-4000:] if output else 'No output'}"
        )
    )

    return result(
        name,
        ok,
        detail,
        required=required,
        data={
            "command": command,
            "returncode": completed.returncode,
            "output_tail": output[-4000:],
        },
    )


def unit_test_check(run_tests: bool) -> list[CheckResult]:
    if not run_tests:
        return [
            result(
                "Payroll unit tests",
                True,
                "Skipped. Use --run-tests to execute all payroll tests.",
                required=False,
            )
        ]

    command = [
        sys.executable,
        "-m",
        "unittest",
        *TEST_MODULES,
        "-v",
    ]
    check = run_subprocess_check(
        "Payroll unit tests",
        command,
        BACKEND_DIR,
    )

    if check.ok:
        output = safe_text((check.data or {}).get("output_tail"))
        count_match = re.search(r"Ran\s+(\d+)\s+tests?", output)
        actual_count = int(count_match.group(1)) if count_match else None
        count_ok = actual_count == EXPECTED_TEST_COUNT

        return [
            check,
            result(
                "Payroll test count",
                count_ok,
                (
                    f"Ran the expected {EXPECTED_TEST_COUNT} tests."
                    if count_ok
                    else (
                        f"Expected {EXPECTED_TEST_COUNT}, "
                        f"detected {actual_count}."
                    )
                ),
                data={
                    "expected": EXPECTED_TEST_COUNT,
                    "actual": actual_count,
                },
            ),
        ]

    return [check]


def frontend_build_check(run_build: bool) -> list[CheckResult]:
    if not run_build:
        return [
            result(
                "Frontend production build",
                True,
                "Skipped. Use --frontend-build to run npm run build.",
                required=False,
            )
        ]

    npm_command = "npm.cmd" if os.name == "nt" else "npm"
    return [
        run_subprocess_check(
            "Frontend production build",
            [npm_command, "run", "build"],
            FRONTEND_DIR,
        )
    ]


def database_checks(check_db: bool, app: Any | None) -> list[CheckResult]:
    if not check_db:
        return [
            result(
                "MongoDB payroll checks",
                True,
                "Skipped. Use --check-db to inspect live MongoDB indexes.",
                required=False,
            )
        ]

    if app is None:
        return [
            result(
                "MongoDB payroll checks",
                False,
                "Flask application did not start, so database checks cannot run.",
            )
        ]

    try:
        from app.extensions import get_db

        with app.app_context():
            database = get_db()
            ping = database.command("ping")
            ping_ok = ping.get("ok") == 1.0

            required_collections = list(
                PAYROLL_COLLECTION_NAMES.values()
            )

            index_summary: dict[str, Any] = {}
            missing_index_collections: list[str] = []

            for collection_name in required_collections:
                indexes = list(database[collection_name].list_indexes())
                index_summary[collection_name] = [
                    safe_text(index.get("name"))
                    for index in indexes
                ]

                # Every collection should have at least one project index in
                # addition to MongoDB's default _id_ index.
                if len(indexes) <= 1:
                    missing_index_collections.append(collection_name)

            return [
                result(
                    "MongoDB ping",
                    ping_ok,
                    "MongoDB responded to ping."
                    if ping_ok
                    else f"Unexpected ping response: {ping}",
                ),
                result(
                    "Live payroll indexes",
                    not missing_index_collections,
                    (
                        "All required payroll collections have project indexes."
                        if not missing_index_collections
                        else (
                            "No project index detected for: "
                            + ", ".join(missing_index_collections)
                        )
                    ),
                    data=index_summary,
                ),
            ]
    except Exception as exc:
        return [
            result(
                "MongoDB payroll checks",
                False,
                f"{type(exc).__name__}: {exc}",
            )
        ]


def human_print(checks: Iterable[CheckResult]) -> None:
    checks = list(checks)
    required_checks = [item for item in checks if item.required]
    required_passed = [item for item in required_checks if item.ok]
    optional_checks = [item for item in checks if not item.required]

    print("=" * 78)
    print("YOURCOMATE HRMS PAYROLL INTEGRATION SMOKE CHECK")
    print("=" * 78)
    print(f"Project: {PROJECT_DIR}")
    print(f"Checked at: {utc_now_iso()}")
    print()

    for item in checks:
        marker = "PASS" if item.ok else "FAIL"
        requirement = "" if item.required else " [optional]"
        print(f"[{marker}] {item.name}{requirement}")
        print(f"       {item.detail}")

    print()
    print("-" * 78)
    print(
        f"Required checks: {len(required_passed)}/{len(required_checks)} passed"
    )
    print(f"Optional checks: {len(optional_checks)}")
    overall_ok = all(item.ok for item in required_checks)
    print(f"Overall: {'OK' if overall_ok else 'FAILED'}")
    print("-" * 78)


def json_print(checks: Iterable[CheckResult]) -> None:
    checks = list(checks)
    required_checks = [item for item in checks if item.required]
    payload = {
        "checked_at": utc_now_iso(),
        "project_dir": str(PROJECT_DIR),
        "overall_ok": all(item.ok for item in required_checks),
        "required_total": len(required_checks),
        "required_passed": len(
            [item for item in required_checks if item.ok]
        ),
        "checks": [
            serialize(asdict(item))
            for item in checks
        ],
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify the final YourComate HRMS Payroll integration."
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON output.",
    )
    parser.add_argument(
        "--run-tests",
        action="store_true",
        help=f"Run the complete {EXPECTED_TEST_COUNT}-test payroll suite.",
    )
    parser.add_argument(
        "--frontend-build",
        action="store_true",
        help="Run npm run build in the frontend directory.",
    )
    parser.add_argument(
        "--check-db",
        action="store_true",
        help="Ping MongoDB and inspect live payroll indexes.",
    )
    parser.add_argument(
        "--skip-app",
        action="store_true",
        help="Skip Flask app startup and registered-route checks.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    checks: list[CheckResult] = []

    checks.extend(existing_file_checks())
    checks.extend(python_compile_checks())
    checks.extend(service_contract_checks())
    checks.extend(static_payroll_contract_checks())
    checks.extend(crud_security_checks())
    checks.extend(index_contract_checks())
    checks.extend(payroll_collection_name_checks())
    checks.extend(requirements_checks())
    checks.extend(frontend_contract_checks())

    app_checks, app = create_app_check(args.skip_app)
    checks.extend(app_checks)

    checks.extend(unit_test_check(args.run_tests))
    checks.extend(frontend_build_check(args.frontend_build))
    checks.extend(database_checks(args.check_db, app))

    if args.json:
        json_print(checks)
    else:
        human_print(checks)

    required_checks = [item for item in checks if item.required]
    return 0 if all(item.ok for item in required_checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())