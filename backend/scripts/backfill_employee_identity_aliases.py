"""Audit and repair YourComate employee identity aliases and indexes.

NEW FILE
Project path:
    backend/scripts/backfill_employee_identity_aliases.py

Run from the backend folder:

    # Safe audit only. No database changes.
    python scripts/backfill_employee_identity_aliases.py

    # Apply the repair and create protected indexes.
    python scripts/backfill_employee_identity_aliases.py --apply

    # Machine-readable output.
    python scripts/backfill_employee_identity_aliases.py --json

    # Backfill one tenant only. Global indexes are intentionally skipped.
    python scripts/backfill_employee_identity_aliases.py --tenant-id sds --apply

    # Apply data repair without creating indexes.
    python scripts/backfill_employee_identity_aliases.py --apply --skip-indexes

Safety rules:
- Dry-run is the default.
- Existing employee/user identity values are never rewritten.
- Active records missing ``is_deleted`` are normalized to ``False``.
- ``identity_alias_keys`` is rebuilt from employee_id, employee_code,
  emp_code, and code.
- Duplicate identities are reported before any write.
- Apply mode stops without changing data when blocking conflicts exist.
- A JSON backup of every document that will be changed is created before
  apply mode writes anything.
- Global unique indexes are created only after a complete, unfiltered audit.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

from pymongo import ASCENDING, UpdateOne
from pymongo.errors import DuplicateKeyError, OperationFailure, PyMongoError


CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


EMPLOYEE_IDENTITY_FIELDS = (
    "employee_id",
    "employee_code",
    "emp_code",
    "code",
)

USER_CODE_FIELDS = (
    "emp_code",
    "employee_code",
)

PROTECTED_INDEX_SPECS = (
    {
        "collection": "employees",
        "name": "uniq_active_employee_tenant_employee_id",
        "keys": [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
        ],
        "unique": True,
        "partialFilterExpression": {
            "is_deleted": False,
            "employee_id": {
                "$exists": True,
                "$type": "string",
                "$gt": "",
            },
        },
    },
    {
        "collection": "employees",
        "name": "uniq_active_employee_tenant_user_id",
        "keys": [
            ("tenant_id", ASCENDING),
            ("user_id", ASCENDING),
        ],
        "unique": True,
        "partialFilterExpression": {
            "is_deleted": False,
            "user_id": {
                "$exists": True,
                "$type": "string",
                "$gt": "",
            },
        },
    },
    {
        "collection": "employees",
        "name": "uniq_active_employee_tenant_identity_alias",
        "keys": [
            ("tenant_id", ASCENDING),
            ("identity_alias_keys", ASCENDING),
        ],
        "unique": True,
        "partialFilterExpression": {
            "is_deleted": False,
            "identity_alias_keys": {
                "$exists": True,
                "$type": "array",
            },
        },
    },
    {
        "collection": "users",
        "name": "uniq_active_user_tenant_employee_id",
        "keys": [
            ("tenant_id", ASCENDING),
            ("employee_id", ASCENDING),
        ],
        "unique": True,
        "partialFilterExpression": {
            "is_deleted": False,
            "employee_id": {
                "$exists": True,
                "$type": "string",
                "$gt": "",
            },
        },
    },
    {
        "collection": "users",
        "name": "uniq_active_user_tenant_emp_code",
        "keys": [
            ("tenant_id", ASCENDING),
            ("emp_code", ASCENDING),
        ],
        "unique": True,
        "partialFilterExpression": {
            "is_deleted": False,
            "emp_code": {
                "$exists": True,
                "$type": "string",
                "$gt": "",
            },
        },
    },
    {
        "collection": "users",
        "name": "uniq_active_user_tenant_employee_code",
        "keys": [
            ("tenant_id", ASCENDING),
            ("employee_code", ASCENDING),
        ],
        "unique": True,
        "partialFilterExpression": {
            "is_deleted": False,
            "employee_code": {
                "$exists": True,
                "$type": "string",
                "$gt": "",
            },
        },
    },
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def safe_str(value: Any) -> str:
    return str(value or "").strip()


def normalized_identity(value: Any) -> str:
    return safe_str(value).lower()


def serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if isinstance(value, Mapping):
        return {
            str(key): serialize(item)
            for key, item in value.items()
        }

    if isinstance(value, (list, tuple, set)):
        return [serialize(item) for item in value]

    try:
        from bson import ObjectId

        if isinstance(value, ObjectId):
            return str(value)
    except Exception:
        pass

    return value


def employee_identity_alias_keys(employee: Mapping[str, Any]) -> list[str]:
    return sorted({
        normalized_identity(employee.get(field_name))
        for field_name in EMPLOYEE_IDENTITY_FIELDS
        if normalized_identity(employee.get(field_name))
    })


def active_query(tenant_id: str = "") -> dict[str, Any]:
    query: dict[str, Any] = {
        "is_deleted": {"$ne": True},
    }

    if tenant_id:
        query["tenant_id"] = tenant_id

    return query


def change_query(tenant_id: str = "") -> dict[str, Any]:
    query: dict[str, Any] = {}

    if tenant_id:
        query["tenant_id"] = tenant_id

    return query


def record_summary(
    document: Mapping[str, Any],
    *,
    collection_name: str,
) -> dict[str, Any]:
    return {
        "collection": collection_name,
        "_id": safe_str(document.get("_id")),
        "tenant_id": safe_str(document.get("tenant_id")),
        "name": safe_str(
            document.get("name")
            or document.get("employee_name")
            or document.get("full_name")
        ),
        "email": safe_str(
            document.get("email")
            or document.get("official_email")
        ),
        "employee_id": safe_str(document.get("employee_id")),
        "employee_code": safe_str(document.get("employee_code")),
        "emp_code": safe_str(document.get("emp_code")),
        "code": safe_str(document.get("code")),
        "user_id": safe_str(document.get("user_id")),
        "is_deleted": document.get("is_deleted"),
        "identity_alias_keys": list(
            document.get("identity_alias_keys") or []
        ),
    }


def duplicate_groups(
    documents: Iterable[Mapping[str, Any]],
    *,
    collection_name: str,
    value_getter: Any,
    label: str,
) -> list[dict[str, Any]]:
    owners: dict[tuple[str, str], list[Mapping[str, Any]]] = defaultdict(list)

    for document in documents:
        tenant_id = safe_str(document.get("tenant_id"))

        for raw_value in value_getter(document):
            value = normalized_identity(raw_value)

            if value:
                owners[(tenant_id, value)].append(document)

    conflicts = []

    for (tenant_id, value), rows in sorted(owners.items()):
        unique_rows = {
            safe_str(row.get("_id")): row
            for row in rows
        }

        if len(unique_rows) <= 1:
            continue

        conflicts.append({
            "type": label,
            "tenant_id": tenant_id,
            "value": value,
            "records": [
                record_summary(
                    row,
                    collection_name=collection_name,
                )
                for row in unique_rows.values()
            ],
        })

    return conflicts


def audit_identity_data(
    db: Any,
    *,
    tenant_id: str = "",
) -> dict[str, Any]:
    employee_projection = {
        "_id": 1,
        "tenant_id": 1,
        "name": 1,
        "employee_name": 1,
        "full_name": 1,
        "email": 1,
        "official_email": 1,
        "employee_id": 1,
        "employee_code": 1,
        "emp_code": 1,
        "code": 1,
        "user_id": 1,
        "identity_alias_keys": 1,
        "is_deleted": 1,
    }
    user_projection = {
        "_id": 1,
        "tenant_id": 1,
        "name": 1,
        "full_name": 1,
        "email": 1,
        "employee_id": 1,
        "employee_code": 1,
        "emp_code": 1,
        "is_deleted": 1,
    }

    employees = list(
        db.employees.find(
            active_query(tenant_id),
            employee_projection,
        )
    )
    users = list(
        db.users.find(
            active_query(tenant_id),
            user_projection,
        )
    )

    missing_employee_tenants = [
        record_summary(row, collection_name="employees")
        for row in employees
        if not safe_str(row.get("tenant_id"))
    ]
    missing_user_tenants = [
        record_summary(row, collection_name="users")
        for row in users
        if not safe_str(row.get("tenant_id"))
    ]

    conflicts = []

    conflicts.extend(
        duplicate_groups(
            employees,
            collection_name="employees",
            value_getter=employee_identity_alias_keys,
            label="employee_cross_field_identity_alias",
        )
    )
    conflicts.extend(
        duplicate_groups(
            employees,
            collection_name="employees",
            value_getter=lambda row: [row.get("employee_id")],
            label="employee_employee_id",
        )
    )
    conflicts.extend(
        duplicate_groups(
            employees,
            collection_name="employees",
            value_getter=lambda row: [row.get("user_id")],
            label="employee_user_id",
        )
    )

    for field_name in (
        "employee_id",
        "emp_code",
        "employee_code",
    ):
        conflicts.extend(
            duplicate_groups(
                users,
                collection_name="users",
                value_getter=lambda row, field=field_name: [row.get(field)],
                label=f"user_{field_name}",
            )
        )

    # Future application writes keep both user code fields synchronized.
    # Detect old cross-field drift before the new baseline is accepted.
    conflicts.extend(
        duplicate_groups(
            users,
            collection_name="users",
            value_getter=lambda row: [
                row.get("emp_code"),
                row.get("employee_code"),
            ],
            label="user_cross_field_employee_code",
        )
    )

    employee_changes = []
    for employee in employees:
        set_values: dict[str, Any] = {}
        unset_values: dict[str, Any] = {}

        if "is_deleted" not in employee:
            set_values["is_deleted"] = False

        aliases = employee_identity_alias_keys(employee)
        existing_aliases = sorted({
            normalized_identity(value)
            for value in (employee.get("identity_alias_keys") or [])
            if normalized_identity(value)
        })

        if aliases:
            if existing_aliases != aliases:
                set_values["identity_alias_keys"] = aliases
        elif employee.get("identity_alias_keys"):
            unset_values["identity_alias_keys"] = ""

        if set_values or unset_values:
            employee_changes.append({
                "_id": employee["_id"],
                "before": employee,
                "set": set_values,
                "unset": unset_values,
            })

    user_changes = []
    for user in users:
        if "is_deleted" not in user:
            user_changes.append({
                "_id": user["_id"],
                "before": user,
                "set": {"is_deleted": False},
                "unset": {},
            })

    blocking_issues = []

    if missing_employee_tenants:
        blocking_issues.append({
            "type": "employees_missing_tenant_id",
            "records": missing_employee_tenants,
        })

    if missing_user_tenants:
        blocking_issues.append({
            "type": "users_missing_tenant_id",
            "records": missing_user_tenants,
        })

    blocking_issues.extend(conflicts)

    return {
        "tenant_id": tenant_id,
        "employee_count": len(employees),
        "user_count": len(users),
        "employee_change_count": len(employee_changes),
        "user_change_count": len(user_changes),
        "missing_employee_tenant_count": len(missing_employee_tenants),
        "missing_user_tenant_count": len(missing_user_tenants),
        "conflict_count": len(conflicts),
        "blocking_issue_count": len(blocking_issues),
        "blocking_issues": blocking_issues,
        "employee_changes": employee_changes,
        "user_changes": user_changes,
    }


def build_update_operations(
    changes: Iterable[Mapping[str, Any]],
) -> list[UpdateOne]:
    operations = []

    for change in changes:
        update: dict[str, Any] = {}

        if change.get("set"):
            update["$set"] = dict(change["set"])

        if change.get("unset"):
            update["$unset"] = dict(change["unset"])

        if update:
            operations.append(
                UpdateOne(
                    {"_id": change["_id"]},
                    update,
                )
            )

    return operations


def create_backup(
    db: Any,
    audit: Mapping[str, Any],
    *,
    backup_dir: Path,
) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = now_utc().strftime("%Y%m%d_%H%M%S")
    tenant_suffix = (
        f"_{safe_str(audit.get('tenant_id'))}"
        if safe_str(audit.get("tenant_id"))
        else "_all_tenants"
    )
    backup_path = (
        backup_dir
        / f"employee_identity_backup_{timestamp}{tenant_suffix}.json"
    )

    index_snapshot = {
        "employees": db.employees.index_information(),
        "users": db.users.index_information(),
    }

    backup_payload = {
        "created_at": now_utc(),
        "tenant_id": audit.get("tenant_id") or "",
        "employee_documents": [
            change["before"]
            for change in audit.get("employee_changes") or []
        ],
        "user_documents": [
            change["before"]
            for change in audit.get("user_changes") or []
        ],
        "index_information": index_snapshot,
    }

    backup_path.write_text(
        json.dumps(
            serialize(backup_payload),
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return backup_path


def canonical_index_keys(definition: Mapping[str, Any]) -> list[tuple[str, int]]:
    return [
        (safe_str(field_name), int(direction))
        for field_name, direction in definition.get("key", [])
    ]


def canonical_partial_filter(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): canonical_partial_filter(item)
            for key, item in sorted(value.items())
        }

    if isinstance(value, list):
        return [canonical_partial_filter(item) for item in value]

    return value


def equivalent_index_name(
    collection: Any,
    spec: Mapping[str, Any],
) -> str:
    expected_keys = [
        (safe_str(field_name), int(direction))
        for field_name, direction in spec["keys"]
    ]
    expected_unique = bool(spec.get("unique"))
    expected_partial = canonical_partial_filter(
        spec.get("partialFilterExpression") or {}
    )

    for index_name, definition in collection.index_information().items():
        if canonical_index_keys(definition) != expected_keys:
            continue

        if bool(definition.get("unique")) != expected_unique:
            continue

        actual_partial = canonical_partial_filter(
            definition.get("partialFilterExpression") or {}
        )

        if actual_partial == expected_partial:
            return index_name

    return ""


def ensure_protected_indexes(db: Any) -> list[dict[str, Any]]:
    results = []

    for spec in PROTECTED_INDEX_SPECS:
        collection = db[spec["collection"]]
        existing = collection.index_information()

        if spec["name"] in existing:
            equivalent = equivalent_index_name(collection, spec)

            if equivalent != spec["name"]:
                raise RuntimeError(
                    f"Index {spec['name']} exists with different options."
                )

            results.append({
                "collection": spec["collection"],
                "name": spec["name"],
                "status": "already_exists",
            })
            continue

        equivalent = equivalent_index_name(collection, spec)

        if equivalent:
            results.append({
                "collection": spec["collection"],
                "name": spec["name"],
                "status": "equivalent_exists",
                "existing_name": equivalent,
            })
            continue

        options = {
            key: value
            for key, value in spec.items()
            if key not in {"collection", "keys"}
        }

        created_name = collection.create_index(
            spec["keys"],
            **options,
        )
        results.append({
            "collection": spec["collection"],
            "name": spec["name"],
            "status": "created",
            "created_name": created_name,
        })

    return results


def apply_identity_repairs(
    db: Any,
    audit: Mapping[str, Any],
    *,
    backup_dir: Path,
    create_indexes: bool,
) -> dict[str, Any]:
    if audit.get("blocking_issue_count"):
        return {
            "ok": False,
            "applied": False,
            "reason": "blocking_identity_conflicts",
            "blocking_issue_count": audit.get("blocking_issue_count", 0),
        }

    backup_path = create_backup(
        db,
        audit,
        backup_dir=backup_dir,
    )

    employee_operations = build_update_operations(
        audit.get("employee_changes") or []
    )
    user_operations = build_update_operations(
        audit.get("user_changes") or []
    )

    employee_modified_count = 0
    user_modified_count = 0

    try:
        if employee_operations:
            result = db.employees.bulk_write(
                employee_operations,
                ordered=True,
            )
            employee_modified_count = result.modified_count

        if user_operations:
            result = db.users.bulk_write(
                user_operations,
                ordered=True,
            )
            user_modified_count = result.modified_count
    except (DuplicateKeyError, OperationFailure, PyMongoError):
        raise

    index_results = []

    if create_indexes:
        index_results = ensure_protected_indexes(db)

    return {
        "ok": True,
        "applied": True,
        "backup_path": str(backup_path),
        "employee_modified_count": employee_modified_count,
        "user_modified_count": user_modified_count,
        "index_results": index_results,
    }


def resolve_db(app: Any) -> Any:
    try:
        from app.extensions import get_db

        return get_db()
    except Exception:
        pass

    try:
        database = getattr(app, "db", None)

        if database is not None:
            return database
    except Exception:
        pass

    try:
        database = app.config.get("MONGO_DB")

        if database is not None:
            return database
    except Exception:
        pass

    try:
        from app import extensions

        database = getattr(extensions, "db", None)

        if database is not None:
            return database
    except Exception:
        pass

    raise RuntimeError("Unable to resolve the HRMS MongoDB database.")


def compact_audit(audit: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: serialize(value)
        for key, value in audit.items()
        if key not in {"employee_changes", "user_changes"}
    }


def print_conflicts(blocking_issues: Iterable[Mapping[str, Any]]) -> None:
    issues = list(blocking_issues)

    if not issues:
        print("Blocking Conflicts : 0")
        return

    print(f"Blocking Conflicts : {len(issues)}")

    for issue_index, issue in enumerate(issues, start=1):
        print("")
        print(
            f"[{issue_index}] "
            f"{safe_str(issue.get('type')) or 'identity_conflict'}"
        )

        if issue.get("tenant_id") or issue.get("value"):
            print(
                "    Tenant : "
                f"{safe_str(issue.get('tenant_id')) or '<missing>'}"
            )
            print(
                "    Value  : "
                f"{safe_str(issue.get('value')) or '<missing>'}"
            )

        records = issue.get("records") or []

        for record in records:
            print(
                "    - "
                f"id={record.get('_id')} "
                f"name={record.get('name') or '-'} "
                f"employee_id={record.get('employee_id') or '-'} "
                f"employee_code={record.get('employee_code') or '-'} "
                f"emp_code={record.get('emp_code') or '-'} "
                f"user_id={record.get('user_id') or '-'}"
            )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Audit and backfill YourComate employee identity aliases, "
            "normalize is_deleted, and create protected MongoDB indexes."
        ),
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the repair. Without this flag, the script is audit-only.",
    )
    parser.add_argument(
        "--tenant-id",
        default="",
        help=(
            "Audit/backfill one tenant only. Global index creation is skipped "
            "when this option is used."
        ),
    )
    parser.add_argument(
        "--skip-indexes",
        action="store_true",
        help="Apply data repairs without creating the protected indexes.",
    )
    parser.add_argument(
        "--backup-dir",
        default=str(BACKEND_DIR / "backups"),
        help="Directory for the pre-change JSON backup.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the complete result as JSON.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    tenant_id = safe_str(args.tenant_id)
    backup_dir = Path(args.backup_dir).resolve()

    os.chdir(BACKEND_DIR)

    from app import create_app

    app = create_app()

    with app.app_context():
        db = resolve_db(app)
        audit = audit_identity_data(
            db,
            tenant_id=tenant_id,
        )

        result: dict[str, Any] = {
            "ok": audit.get("blocking_issue_count", 0) == 0,
            "mode": "apply" if args.apply else "audit",
            "started_at": now_utc(),
            "tenant_id": tenant_id,
            "audit": compact_audit(audit),
            "apply_result": None,
        }

        if args.apply:
            create_indexes = not args.skip_indexes and not tenant_id
            result["apply_result"] = apply_identity_repairs(
                db,
                audit,
                backup_dir=backup_dir,
                create_indexes=create_indexes,
            )
            result["ok"] = bool(
                result["apply_result"].get("ok")
            )
            result["indexes_skipped_for_tenant_filter"] = bool(
                tenant_id and not args.skip_indexes
            )

        result["finished_at"] = now_utc()

    clean_result = serialize(result)

    if args.json:
        print(
            json.dumps(
                clean_result,
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        audit_result = clean_result["audit"]
        print("YourComate Employee Identity Migration")
        print("--------------------------------------")
        print(f"Mode               : {clean_result['mode']}")
        print(f"Tenant             : {tenant_id or 'all tenants'}")
        print(f"Employees Audited  : {audit_result['employee_count']}")
        print(f"Users Audited      : {audit_result['user_count']}")
        print(
            "Employee Updates   : "
            f"{audit_result['employee_change_count']}"
        )
        print(
            "User Updates       : "
            f"{audit_result['user_change_count']}"
        )
        print_conflicts(audit_result.get("blocking_issues") or [])

        if not args.apply:
            print("")
            print("No database changes were made.")
            print(
                "Run with --apply only after reviewing and resolving "
                "all reported conflicts."
            )
        else:
            apply_result = clean_result.get("apply_result") or {}
            print("")
            print(
                "Applied            : "
                f"{bool(apply_result.get('applied'))}"
            )

            if apply_result.get("backup_path"):
                print(
                    "Backup             : "
                    f"{apply_result['backup_path']}"
                )

            print(
                "Employees Modified : "
                f"{apply_result.get('employee_modified_count', 0)}"
            )
            print(
                "Users Modified     : "
                f"{apply_result.get('user_modified_count', 0)}"
            )

            for index_result in apply_result.get("index_results") or []:
                print(
                    "Index              : "
                    f"{index_result.get('collection')}."
                    f"{index_result.get('name')} "
                    f"[{index_result.get('status')}]"
                )

            if clean_result.get("indexes_skipped_for_tenant_filter"):
                print(
                    "Indexes            : skipped because --tenant-id "
                    "does not audit every tenant"
                )

    if clean_result.get("ok"):
        return 0

    if clean_result["audit"].get("blocking_issue_count", 0):
        return 2

    return 1


if __name__ == "__main__":
    raise SystemExit(main())