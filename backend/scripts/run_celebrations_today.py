import os
import sys
from datetime import datetime

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from app import create_app
from app.extensions import get_db
from app.routes.celebrations import generate_today_celebrations_for_tenant


def get_active_tenant_ids():
    db = get_db()

    tenant_ids = set()

    for tenant in db.tenants.find({}):
        tenant_id = (
            tenant.get("tenant_id")
            or tenant.get("id")
            or tenant.get("slug")
            or tenant.get("_id")
        )

        if tenant_id:
            tenant_ids.add(str(tenant_id))

    for company in db.companies.find({}):
        tenant_id = company.get("tenant_id")

        if tenant_id:
            tenant_ids.add(str(tenant_id))

    for employee in db.employees.find({}):
        tenant_id = employee.get("tenant_id")

        if tenant_id:
            tenant_ids.add(str(tenant_id))

    if not tenant_ids:
        tenant_ids.add("sds")

    return sorted(tenant_ids)


def main():
    app = create_app()

    with app.app_context():
        tenant_ids = get_active_tenant_ids()

        print("=" * 70)
        print("SDS HRMS Celebration Generator")
        print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"Tenants found: {len(tenant_ids)}")
        print("=" * 70)

        total_created = 0
        total_notified = 0

        for tenant_id in tenant_ids:
            result = generate_today_celebrations_for_tenant(
                tenant_id=tenant_id,
                force=True,
            )

            created = int(result.get("created") or 0)
            notified = int(result.get("notified") or 0)

            total_created += created
            total_notified += notified

            print(
                f"[{tenant_id}] "
                f"status={result.get('status')} "
                f"created={created} "
                f"notified={notified}"
            )

        print("=" * 70)
        print(f"Total created: {total_created}")
        print(f"Total notified: {total_notified}")
        print("Completed.")
        print("=" * 70)


if __name__ == "__main__":
    main()