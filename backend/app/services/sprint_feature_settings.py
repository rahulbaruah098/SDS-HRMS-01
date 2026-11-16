"""Organisation-specific YourComate Sprint Planning activation.

Missing configuration always means OFF.
"""

SETTING_GROUP = "sprint_planning"
SETTING_KEY = "module_enabled"


def sprint_planning_settings_id(tenant_id):
    tenant = str(tenant_id or "").strip()
    if not tenant:
        raise ValueError("A valid tenant ID is required")
    return f"sprint-planning:{tenant}"


def sprint_planning_enabled(db, tenant_id):
    """Return True only when the organisation explicitly enables Sprint."""
    tenant = str(tenant_id or "").strip()
    if not tenant:
        return False

    stored = db.system_settings.find_one({
        "_id": sprint_planning_settings_id(tenant),
        "tenant_id": tenant,
        "setting_group": SETTING_GROUP,
        "setting_key": SETTING_KEY,
        "is_deleted": {"$ne": True},
    })

    return bool(stored and stored.get("enabled") is True)
