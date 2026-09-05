"""
Saya Admin + Super Admin action plugin.

This module is auto-discovered by app.services.ai_action_service.
It deliberately separates tenant-admin intelligence from platform-superadmin
control. Tenant admins can read only their own organisation context. Platform
operations require the verified ``super_admin`` role and every destructive or
financially significant write is confirmed before the canonical HRMS route is
invoked.

The module never resets passwords, reveals password hashes/API credentials, or
creates a company with a default password through conversational AI. Those
operations remain in the dedicated Super Admin UI.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
import re
from typing import Any

from bson import ObjectId
from flask import current_app, g

from app.extensions import get_db
from app.services.ai_action_service import (
    register_saya_action,
    save_pending_action,
    clear_pending_action,
)
from app.services.tenant_service import (
    build_subscription_summary,
    serialize_tenant_for_admin,
)
from app.services.pricing_service import (
    ensure_default_pricing_plans,
    list_pricing_plans,
)


SUPERADMIN_ROLES = {"super_admin"}
TENANT_ADMIN_ROLES = {
    "admin",
    "hr_admin",
    "hr_manager",
    "super_admin",
}

READ_LIMIT = 50
DISPLAY_LIMIT = 12


# ---------------------------------------------------------------------------
# Common helpers
# ---------------------------------------------------------------------------


def _text(value: Any) -> str:
    return str(value or "").strip()


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", _text(value).lower()).strip()


def _role_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", _text(value).lower()).strip("_")


def _roles(user_context=None) -> set[str]:
    context = user_context or {}
    raw = context.get("roles") or []
    if isinstance(raw, str):
        raw = [item.strip() for item in raw.split(",") if item.strip()]
    roles = {_role_key(item) for item in raw if _role_key(item)}
    primary = _role_key(context.get("role"))
    if primary:
        roles.add(primary)
    if context.get("is_platform_superadmin"):
        roles.add("super_admin")
    return roles


def _tenant_id(user_context=None) -> str:
    return _text((user_context or {}).get("tenant_id"))


def _actor_id(user_context=None) -> str:
    context = user_context or {}
    return _text(context.get("user_id") or context.get("_id"))


def _actor_name(user_context=None) -> str:
    context = user_context or {}
    return _text(
        context.get("display_name")
        or context.get("employee_name")
        or context.get("name")
        or context.get("email")
        or "Saya Administrator"
    )


def _tenant_admin_access(user_context=None):
    if not _tenant_id(user_context):
        return "I cannot verify your organisation context. Please sign in again and retry."
    if not _actor_id(user_context):
        return "I cannot verify your signed-in user identity. Please sign in again and retry."
    if not _roles(user_context).intersection(TENANT_ADMIN_ROLES):
        return "This administration function is not available for your current role."
    return ""


def _superadmin_access(user_context=None):
    if not _actor_id(user_context):
        return "I cannot verify your signed-in platform identity. Please sign in again and retry."
    if not _roles(user_context).intersection(SUPERADMIN_ROLES):
        return "This platform-level function is available only to Super Admin."
    return ""


def _superadmin_write_access(user_context=None):
    error = _superadmin_access(user_context)
    if error:
        return error
    # The central pending-action store is tenant-bound. Platform Super Admin
    # normally carries the SDS tenant context; fail safely if that mapping is
    # absent rather than executing an unconfirmed write.
    if not _tenant_id(user_context):
        return (
            "I can verify your Super Admin role, but the current session does not "
            "have the platform tenant context required for a confirmed Saya action. "
            "Please sign in again through the Super Admin portal."
        )
    return ""


def _yes(value: Any) -> bool:
    return _norm(value) in {
        "yes", "y", "confirm", "confirmed", "proceed", "go ahead", "do it",
        "yes proceed", "yes confirm", "continue", "submit", "apply",
    }


def _no(value: Any) -> bool:
    return _norm(value) in {
        "no", "n", "cancel", "stop", "abort", "do not", "don't", "dont",
    }


def _skip(value: Any) -> bool:
    return _norm(value) in {"skip", "none", "default", "n/a", "na", "no note"}


def _money(value: Any, currency="₹") -> str:
    try:
        amount = float(value or 0)
    except Exception:
        amount = 0.0
    return f"{currency}{amount:,.2f}"


def _date_label(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y")
    text = _text(value)
    if not text:
        return "—"
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.strftime("%d %b %Y")
    except Exception:
        return text


def _safe_error(exc: Exception, default="I could not complete that administration action. Please try again.") -> str:
    text = _text(exc)
    blocked = (
        "traceback", "mongodb", "pymongo", "objectid", "duplicate key",
        "localhost", "connection refused", "server selection", "stack trace",
        "password_hash", "private_key", "api_key", "secret",
    )
    if any(item in text.lower() for item in blocked):
        return default
    return text[:500] or default


def _result(answer: str, *, requires_confirmation=False, choices=None):
    payload = {
        "handled": True,
        "answer": _text(answer),
        "requires_confirmation": bool(requires_confirmation),
    }
    if choices:
        payload["choices"] = choices
    return payload


def _pending_data(pending=None) -> dict:
    data = (pending or {}).get("data") or {}
    return dict(data) if isinstance(data, dict) else {}


def _pending_step(pending=None) -> str:
    return _text((pending or {}).get("current_step"))


def _save(user_context, action_type, data, step):
    saved = save_pending_action(user_context, action_type, data, step)
    if saved is None:
        return False
    return True


def _cancel(user_context, message="The administration action was cancelled."):
    clear_pending_action(user_context)
    return _result(message)


def _parse_int(text: Any, default=None):
    match = re.search(r"(?<!\d)(\d{1,4})(?!\d)", _text(text))
    if not match:
        return default
    try:
        return int(match.group(1))
    except Exception:
        return default


def _parse_amount(text: Any):
    clean = _text(text).replace(",", "")
    patterns = [
        r"(?:₹|rs\.?|inr|amount|price|quote|quoted)\s*[:=]?\s*(\d+(?:\.\d+)?)",
        r"(\d+(?:\.\d+)?)\s*(?:rupees|inr)",
    ]
    for pattern in patterns:
        match = re.search(pattern, clean, re.I)
        if match:
            try:
                return float(match.group(1))
            except Exception:
                pass
    return None


def _days_window(question: Any, default=30, maximum=365):
    clean = _norm(question)
    match = re.search(r"(?:next|within|in)\s+(\d{1,3})\s+days?", clean)
    if not match:
        match = re.search(r"(\d{1,3})\s+days?", clean)
    if not match:
        return default
    return max(1, min(int(match.group(1)), maximum))


def _tenant_display(tenant: dict) -> str:
    return _text(
        tenant.get("company_name")
        or tenant.get("name")
        or tenant.get("tenant_name")
        or tenant.get("tenant_id")
        or "Company"
    )


def _tenant_candidates(search_text: Any, limit=10):
    db = get_db()
    clean = _text(search_text)
    if not clean:
        return []

    # Strong exact identifiers first.
    exact = db.tenants.find_one({
        "is_deleted": {"$ne": True},
        "$or": [
            {"tenant_id": clean.lower()},
            {"tenant_code": {"$regex": f"^{re.escape(clean)}$", "$options": "i"}},
            {"company_name": {"$regex": f"^{re.escape(clean)}$", "$options": "i"}},
            {"name": {"$regex": f"^{re.escape(clean)}$", "$options": "i"}},
            {"company_email": {"$regex": f"^{re.escape(clean)}$", "$options": "i"}},
            {"contact_email": {"$regex": f"^{re.escape(clean)}$", "$options": "i"}},
        ],
    })
    if exact:
        return [exact]

    # Search the full command as well as significant word groups.
    terms = [clean]
    reduced = re.sub(
        r"\b(?:activate|suspend|company|tenant|trial|demo|extend|mark|paid|payment|please|for|the|a|an|days?|because|reason|subscription|show|details?|status)\b",
        " ", clean, flags=re.I,
    )
    reduced = re.sub(r"\s+", " ", reduced).strip()
    if reduced and reduced.lower() != clean.lower():
        terms.append(reduced)

    clauses = []
    for term in terms:
        if len(term) < 2:
            continue
        pattern = re.escape(term)
        clauses.extend([
            {"tenant_id": {"$regex": pattern, "$options": "i"}},
            {"tenant_code": {"$regex": pattern, "$options": "i"}},
            {"company_name": {"$regex": pattern, "$options": "i"}},
            {"name": {"$regex": pattern, "$options": "i"}},
            {"company_email": {"$regex": pattern, "$options": "i"}},
            {"contact_email": {"$regex": pattern, "$options": "i"}},
        ])
    if not clauses:
        return []
    return list(db.tenants.find({
        "is_deleted": {"$ne": True},
        "$or": clauses,
    }).sort("created_at", -1).limit(limit))


def _tenant_choices(candidates):
    lines = ["I found multiple matching companies. Please reply with the number or tenant ID:"]
    choices = []
    for index, tenant in enumerate(candidates[:DISPLAY_LIMIT], 1):
        name = _tenant_display(tenant)
        tenant_id = _text(tenant.get("tenant_id"))
        plan = _text(tenant.get("plan_label") or tenant.get("plan_name") or tenant.get("plan_type"))
        lines.append(f"{index}. {name} — {tenant_id}" + (f" — {plan}" if plan else ""))
        choices.append({"label": name, "value": tenant_id})
    return "\n".join(lines), choices


def _match_selected_tenant(text, candidates):
    clean = _norm(text)
    match = re.search(r"(?:^|\b)(\d{1,2})(?:\b|$)", clean)
    if match:
        index = int(match.group(1)) - 1
        if 0 <= index < len(candidates):
            return candidates[index]
    for tenant in candidates:
        fields = [
            tenant.get("tenant_id"), tenant.get("tenant_code"), tenant.get("company_name"),
            tenant.get("name"), tenant.get("company_email"), tenant.get("contact_email"),
        ]
        if any(_norm(field) and _norm(field) in clean for field in fields):
            return tenant
    return None


def _tenant_snapshot(tenant):
    if not tenant:
        return {}
    return {
        "id": _text(tenant.get("_id")),
        "tenant_id": _text(tenant.get("tenant_id")),
        "name": _tenant_display(tenant),
        "plan_type": _text(tenant.get("plan_type")),
        "plan_code": _text(tenant.get("plan_code") or tenant.get("selected_plan_code")),
        "status": _text(tenant.get("status")),
    }


def _resolve_tenant_for_action(question, user_context, action_type, *, next_step="confirm"):
    candidates = _tenant_candidates(question)
    if len(candidates) == 1:
        return candidates[0], None
    if not candidates:
        if not _save(user_context, action_type, {}, "tenant"):
            return None, _result("I could not open the confirmed platform action safely. Please sign in again and retry.")
        return None, _result("Which company should I use? Please provide the company name, tenant ID, tenant code, or company email.")
    stored = [_tenant_snapshot(item) for item in candidates]
    if not _save(user_context, action_type, {"tenant_candidates": stored}, "tenant"):
        return None, _result("I could not open the confirmed platform action safely. Please sign in again and retry.")
    message, choices = _tenant_choices(candidates)
    return None, _result(message, choices=choices)


def _tenant_from_pending_selection(data, question):
    candidates = data.get("tenant_candidates") or []
    if candidates:
        selected = _match_selected_tenant(question, candidates)
        if selected:
            real = _tenant_candidates(selected.get("tenant_id"))
            return real[0] if real else None
    found = _tenant_candidates(question)
    return found[0] if len(found) == 1 else None


# ---------------------------------------------------------------------------
# Canonical route invocation
# ---------------------------------------------------------------------------


def _unwrap_view(view):
    current = view
    seen = set()
    while callable(current) and hasattr(current, "__wrapped__") and id(current) not in seen:
        seen.add(id(current))
        current = current.__wrapped__
    return current


def _parse_flask_result(result):
    status_code = 200
    response = result
    if isinstance(result, tuple):
        if len(result) >= 2 and isinstance(result[1], int):
            status_code = result[1]
        response = result[0]
    payload = None
    if hasattr(response, "get_json"):
        try:
            payload = response.get_json(silent=True)
        except TypeError:
            payload = response.get_json()
    elif isinstance(response, dict):
        payload = response
    return payload or {}, status_code


def _call_canonical_view(module_name, view_name, path, method, body, user_context=None, path_args=None):
    if module_name == "superadmin":
        from app.routes import superadmin as route_module
    elif module_name == "billing":
        from app.routes import billing as route_module
    else:
        raise RuntimeError("Unsupported administration route module.")

    view = getattr(route_module, view_name, None)
    if not callable(view):
        raise RuntimeError("The canonical administration workflow is unavailable in this deployment.")

    app = current_app._get_current_object()
    context = user_context or {}
    previous = {
        "current_user": getattr(g, "current_user", None),
        "tenant_id": getattr(g, "tenant_id", None),
        "current_tenant": getattr(g, "current_tenant", None),
        "subscription": getattr(g, "subscription", None),
    }

    route_user = dict(previous.get("current_user") or {})
    route_user.setdefault("_id", _actor_id(context))
    route_user.setdefault("id", _actor_id(context))
    route_user.setdefault("tenant_id", _tenant_id(context))
    route_user.setdefault("name", _actor_name(context))
    route_user["role"] = "super_admin"
    route_user["roles"] = sorted(_roles(context) | {"super_admin"})

    try:
        with app.test_request_context(path, method=method.upper(), json=dict(body or {})):
            g.current_user = route_user
            if _tenant_id(context):
                g.tenant_id = _tenant_id(context)
            if context.get("tenant"):
                g.current_tenant = context.get("tenant")
            if context.get("subscription"):
                g.subscription = context.get("subscription")

            output = _unwrap_view(view)(**(path_args or {}))
            payload, status = _parse_flask_result(output)
            if status >= 400 or payload.get("ok") is False or payload.get("success") is False:
                raise RuntimeError(
                    _text(payload.get("message") or payload.get("error"))
                    or "The administration workflow rejected this request."
                )
            return payload
    finally:
        for key, value in previous.items():
            try:
                setattr(g, key, value)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Tenant Admin read intelligence (current organisation only)
# ---------------------------------------------------------------------------


def _current_tenant_document(user_context=None):
    tenant_id = _tenant_id(user_context)
    if not tenant_id:
        return None
    db = get_db()
    return db.tenants.find_one({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }) or db.companies.find_one({
        "$or": [{"tenant_id": tenant_id}, {"_id": tenant_id}],
        "is_deleted": {"$ne": True},
    })


def _tenant_org_overview_start(question, user_context=None):
    error = _tenant_admin_access(user_context)
    if error:
        return _result(error)
    db = get_db()
    tenant_id = _tenant_id(user_context)
    tenant = _current_tenant_document(user_context)
    if not tenant:
        return _result("I could not find the organisation record for this login.")

    active_employees = db.employees.count_documents({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "status": {"$nin": ["Deleted", "Resigned", "Inactive"]},
    })
    active_users = db.users.count_documents({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
        "is_active": {"$ne": False},
    })
    departments = db.departments.count_documents({"tenant_id": tenant_id, "is_deleted": {"$ne": True}})
    projects = db.projects.count_documents({"tenant_id": tenant_id, "is_deleted": {"$ne": True}})
    summary = build_subscription_summary(db, tenant, config=current_app.config)

    answer = (
        f"Organisation overview for {_tenant_display(tenant)}:\n"
        f"• Account status: {_text(summary.get('status') or tenant.get('status')).title() or 'Unknown'}\n"
        f"• Plan: {_text(summary.get('plan_label') or summary.get('plan_type')).strip() or 'Unknown'}\n"
        f"• Active employees: {active_employees}\n"
        f"• Active user accounts: {active_users}\n"
        f"• Departments: {departments}\n"
        f"• Projects: {projects}"
    )
    return _result(answer)


def _tenant_subscription_start(question, user_context=None):
    error = _tenant_admin_access(user_context)
    if error:
        return _result(error)
    db = get_db()
    tenant = _current_tenant_document(user_context)
    if not tenant:
        return _result("I could not find the subscription record for this organisation.")
    summary = build_subscription_summary(db, tenant, config=current_app.config)
    limit = summary.get("employee_limit")
    limit_text = "Unlimited" if limit is None else str(limit)
    days = summary.get("trial_days_left") if summary.get("is_demo_company") else summary.get("subscription_days_left")
    days_text = "Not applicable" if days is None else str(days)
    answer = (
        f"Subscription status for {_tenant_display(tenant)}:\n"
        f"• Plan: {_text(summary.get('plan_label') or summary.get('plan_type')) or 'Unknown'}\n"
        f"• Account status: {_text(summary.get('status')).title() or 'Unknown'}\n"
        f"• Subscription status: {_text(summary.get('subscription_status')).title() or 'Unknown'}\n"
        f"• Employees: {summary.get('employee_count', 0)} / {limit_text}\n"
        f"• Days remaining: {days_text}\n"
        f"• Valid until: {_date_label(summary.get('trial_end_date') or summary.get('subscription_end_date'))}\n"
        f"• Payment required: {'Yes' if summary.get('requires_payment') else 'No'}"
    )
    return _result(answer)


def _tenant_users_start(question, user_context=None):
    error = _tenant_admin_access(user_context)
    if error:
        return _result(error)
    db = get_db()
    tenant_id = _tenant_id(user_context)
    users = list(db.users.find({
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    }, {
        "name": 1, "full_name": 1, "email": 1, "role": 1, "roles": 1,
        "is_active": 1, "status": 1,
    }).sort("created_at", -1).limit(500))
    active = sum(1 for item in users if item.get("is_active") is not False and _norm(item.get("status")) not in {"inactive", "disabled"})
    inactive = len(users) - active
    role_counts = Counter()
    for item in users:
        role_values = item.get("roles") or [item.get("role")]
        if isinstance(role_values, str):
            role_values = [role_values]
        for role in role_values:
            if _role_key(role):
                role_counts[_role_key(role)] += 1
    role_text = ", ".join(f"{role.replace('_', ' ').title()}: {count}" for role, count in role_counts.most_common(8)) or "No role data"
    answer = (
        "User-access overview for this organisation:\n"
        f"• Total user accounts: {len(users)}\n"
        f"• Active: {active}\n"
        f"• Inactive/disabled: {inactive}\n"
        f"• Role distribution: {role_text}"
    )
    return _result(answer)


def _tenant_modules_start(question, user_context=None):
    error = _tenant_admin_access(user_context)
    if error:
        return _result(error)
    tenant = _current_tenant_document(user_context)
    if not tenant:
        return _result("I could not find the module-access record for this organisation.")
    summary = build_subscription_summary(get_db(), tenant, config=current_app.config)
    modules = summary.get("allowed_modules") or []
    if not modules and (summary.get("is_paid_company") or summary.get("is_lifetime")):
        module_text = "Full HRMS access according to the current paid/lifetime subscription."
    elif "all" in {_norm(item) for item in modules}:
        module_text = "All HRMS modules."
    else:
        module_text = ", ".join(_text(item) for item in modules if _text(item)) or "No modules are currently listed."
    return _result(f"Module access for {_tenant_display(tenant)}: {module_text}")


# ---------------------------------------------------------------------------
# Super Admin read intelligence
# ---------------------------------------------------------------------------


def _platform_overview_start(question, user_context=None):
    error = _superadmin_access(user_context)
    if error:
        return _result(error)
    db = get_db()
    tenants = list(db.tenants.find({"is_deleted": {"$ne": True}}).limit(5000))
    summaries = [build_subscription_summary(db, item, config=current_app.config) for item in tenants]
    total_employees = db.employees.count_documents({"is_deleted": {"$ne": True}, "status": {"$nin": ["Deleted", "Resigned"]}})
    total_users = db.users.count_documents({"is_deleted": {"$ne": True}})
    counts = Counter(_norm(item.get("status")) or "unknown" for item in summaries)
    plan_counts = Counter(_norm(item.get("plan_type")) or "unknown" for item in summaries)
    pending_premium = db.premium_plan_requests.count_documents({
        "is_deleted": {"$ne": True},
        "status": {"$nin": ["converted", "closed", "cancelled"]},
    })
    answer = (
        "YourComate platform overview:\n"
        f"• Companies: {len(tenants)}\n"
        f"• Active: {counts.get('active', 0)} | Expired: {counts.get('expired', 0)} | Suspended: {counts.get('suspended', 0)}\n"
        f"• Trial companies: {plan_counts.get('demo', 0)} | Paid: {plan_counts.get('paid', 0)} | Lifetime: {plan_counts.get('lifetime', 0)}\n"
        f"• Employee records: {total_employees}\n"
        f"• User accounts: {total_users}\n"
        f"• Open Premium requests: {pending_premium}"
    )
    return _result(answer)


def _company_list_start(question, user_context=None):
    error = _superadmin_access(user_context)
    if error:
        return _result(error)
    db = get_db()
    clean = _norm(question)
    query = {"is_deleted": {"$ne": True}}
    if "suspended" in clean:
        query["status"] = "suspended"
    elif "expired" in clean:
        query["status"] = "expired"
    if "trial" in clean or "demo" in clean:
        query["plan_type"] = "demo"
    elif "lifetime" in clean:
        query["plan_type"] = "lifetime"
    elif "paid" in clean:
        query["plan_type"] = "paid"
    rows = list(db.tenants.find(query).sort("created_at", -1).limit(READ_LIMIT))
    if not rows:
        return _result("I could not find any companies matching that platform filter.")
    lines = [f"I found {len(rows)} matching companies. Showing up to {DISPLAY_LIMIT}:"]
    for item in rows[:DISPLAY_LIMIT]:
        summary = build_subscription_summary(db, item, config=current_app.config)
        lines.append(
            f"• {_tenant_display(item)} ({_text(item.get('tenant_id'))}) — "
            f"{_text(summary.get('plan_label') or summary.get('plan_type'))}, "
            f"{_text(summary.get('status')).title() or 'Unknown'}"
        )
    if len(rows) > DISPLAY_LIMIT:
        lines.append(f"• …and {len(rows) - DISPLAY_LIMIT} more in this result set.")
    return _result("\n".join(lines))


def _expiring_tenants_start(question, user_context=None):
    error = _superadmin_access(user_context)
    if error:
        return _result(error)
    days = _days_window(question, default=30)
    db = get_db()
    rows = list(db.tenants.find({"is_deleted": {"$ne": True}, "status": {"$ne": "suspended"}}).limit(5000))
    expiring = []
    for tenant in rows:
        summary = build_subscription_summary(db, tenant, config=current_app.config)
        remaining = summary.get("trial_days_left") if summary.get("is_demo_company") else summary.get("subscription_days_left")
        if remaining is None:
            continue
        try:
            remaining = int(remaining)
        except Exception:
            continue
        if 0 <= remaining <= days:
            expiring.append((remaining, tenant, summary))
    expiring.sort(key=lambda row: row[0])
    if not expiring:
        return _result(f"No accessible company subscriptions or trials are due to expire within the next {days} days.")
    lines = [f"Companies expiring within the next {days} days: {len(expiring)}. Showing up to {DISPLAY_LIMIT}:"]
    for remaining, tenant, summary in expiring[:DISPLAY_LIMIT]:
        lines.append(
            f"• {_tenant_display(tenant)} ({tenant.get('tenant_id')}) — {remaining} day{'s' if remaining != 1 else ''} remaining — "
            f"{_text(summary.get('plan_label') or summary.get('plan_type'))}"
        )
    return _result("\n".join(lines))


def _trial_overview_start(question, user_context=None):
    error = _superadmin_access(user_context)
    if error:
        return _result(error)
    db = get_db()
    demos = list(db.tenants.find({"plan_type": "demo", "is_deleted": {"$ne": True}}).limit(5000))
    buckets = Counter()
    due = []
    for tenant in demos:
        summary = build_subscription_summary(db, tenant, config=current_app.config)
        status = _norm(summary.get("status")) or "unknown"
        buckets[status] += 1
        left = summary.get("trial_days_left")
        if left is not None:
            try:
                if int(left) <= 7:
                    due.append((int(left), tenant))
            except Exception:
                pass
    due.sort(key=lambda row: row[0])
    lines = [
        "Trial-account overview:",
        f"• Total trials: {len(demos)}",
        f"• Active: {buckets.get('active', 0)} | Expired: {buckets.get('expired', 0)} | Suspended: {buckets.get('suspended', 0)}",
        f"• Trials with 7 days or less remaining: {len([item for item in due if item[0] >= 0])}",
    ]
    for left, tenant in due[:8]:
        lines.append(f"• {_tenant_display(tenant)} ({tenant.get('tenant_id')}) — {left} day{'s' if left != 1 else ''} remaining")
    return _result("\n".join(lines))


def _billing_overview_start(question, user_context=None):
    error = _superadmin_access(user_context)
    if error:
        return _result(error)
    db = get_db()
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    paid_query = {"is_deleted": {"$ne": True}, "status": "paid"}
    payments = list(db.payments.find({**paid_query, "created_at": {"$gte": thirty_days_ago}}, {"amount": 1, "currency": 1}).limit(10000))
    revenue = sum(float(item.get("amount") or 0) for item in payments)
    active_subscriptions = db.subscriptions.count_documents({
        "is_deleted": {"$ne": True},
        "status": {"$in": ["active", "paid", "lifetime"]},
    })
    open_orders = db.payment_orders.count_documents({
        "is_deleted": {"$ne": True},
        "status": {"$nin": ["paid", "captured", "cancelled", "failed"]},
    })
    premium_open = db.premium_plan_requests.count_documents({
        "is_deleted": {"$ne": True},
        "status": {"$nin": ["converted", "closed", "cancelled"]},
    })
    return _result(
        "Platform billing overview:\n"
        f"• Active/paid subscriptions: {active_subscriptions}\n"
        f"• Open payment orders: {open_orders}\n"
        f"• Successful payments in the last 30 days: {len(payments)}\n"
        f"• Recorded paid amount in the last 30 days: {_money(revenue)}\n"
        f"• Open Premium quotation requests: {premium_open}"
    )


def _pricing_overview_start(question, user_context=None):
    error = _superadmin_access(user_context)
    if error:
        return _result(error)
    db = get_db()
    ensure_default_pricing_plans(db, created_by=_actor_id(user_context) or "system")
    plans = list_pricing_plans(db, include_inactive=True, include_deleted=False)
    if not plans:
        return _result("No pricing plans are currently configured.")
    lines = ["Current pricing plans:"]
    for plan in plans[:DISPLAY_LIMIT]:
        if plan.get("is_custom_pricing"):
            price = "Custom quotation"
        else:
            price = _money(plan.get("amount"))
        limit = "Unlimited" if plan.get("is_unlimited_employees") else _text(plan.get("employee_limit") or plan.get("included_employees") or "—")
        lines.append(
            f"• {_text(plan.get('display_name') or plan.get('plan_name') or plan.get('plan_code'))} "
            f"({plan.get('plan_code')}) — {price} / {_text(plan.get('billing_interval') or 'month')} — "
            f"Employees: {limit} — {'Active' if plan.get('is_active') is not False else 'Inactive'}"
        )
    return _result("\n".join(lines))


def _premium_requests_start(question, user_context=None):
    error = _superadmin_access(user_context)
    if error:
        return _result(error)
    db = get_db()
    clean = _norm(question)
    query = {"is_deleted": {"$ne": True}}
    if "pending" in clean or "open" in clean:
        query["status"] = {"$nin": ["converted", "closed", "cancelled"]}
    rows = list(db.premium_plan_requests.find(query).sort("updated_at", -1).limit(READ_LIMIT))
    if not rows:
        return _result("There are no accessible Premium requests matching that filter.")
    lines = [f"Premium quotation requests: {len(rows)}. Showing up to {DISPLAY_LIMIT}:"]
    for item in rows[:DISPLAY_LIMIT]:
        amount = item.get("renewal_amount") or item.get("quoted_amount")
        amount_text = _money(amount) if amount else "Not quoted"
        lines.append(
            f"• {_text(item.get('company_name') or item.get('tenant_id') or 'Company')} — "
            f"{_text(item.get('status')).replace('_', ' ').title() or 'New'} — {amount_text} — "
            f"Payment: {_text(item.get('payment_status')).replace('_', ' ').title() or 'Not recorded'}"
        )
    return _result("\n".join(lines))


def _maintenance_status_start(question, user_context=None):
    error = _superadmin_access(user_context)
    if error:
        return _result(error)
    from app.routes.superadmin import get_platform_maintenance_state
    state = get_platform_maintenance_state(get_db()) or {}
    enabled = bool(state.get("enabled"))
    return _result(
        f"YourComate maintenance mode is currently {'ENABLED' if enabled else 'DISABLED'}. "
        f"Message: {_text(state.get('message')) or 'No custom maintenance message is configured.'}"
    )


# ---------------------------------------------------------------------------
# Super Admin write actions
# ---------------------------------------------------------------------------


def _company_action_start(question, user_context, action_type, verb):
    error = _superadmin_write_access(user_context)
    if error:
        return _result(error)
    tenant, response = _resolve_tenant_for_action(question, user_context, action_type)
    if response:
        return response
    data = {"tenant": _tenant_snapshot(tenant)}
    if action_type == "superadmin_suspend_company":
        reason_match = re.search(r"\b(?:because|reason[:=]?)\s+(.+)$", _text(question), re.I)
        if reason_match:
            data["reason"] = _text(reason_match.group(1))[:800]
        if not data.get("reason"):
            _save(user_context, action_type, data, "reason")
            return _result(f"Please provide the suspension reason for {_tenant_display(tenant)}.")
    _save(user_context, action_type, data, "confirm")
    return _result(
        f"Please confirm: {verb} {_tenant_display(tenant)} ({tenant.get('tenant_id')}). Reply Yes to confirm or No to cancel.",
        requires_confirmation=True,
    )


def _company_action_continue(pending, question, user_context, action_type, verb, route_view, route_suffix, method="POST"):
    error = _superadmin_write_access(user_context)
    if error:
        clear_pending_action(user_context)
        return _result(error)
    data = _pending_data(pending)
    step = _pending_step(pending)
    if step == "tenant":
        tenant = _tenant_from_pending_selection(data, question)
        if not tenant:
            found = _tenant_candidates(question)
            if len(found) > 1:
                data["tenant_candidates"] = [_tenant_snapshot(item) for item in found]
                _save(user_context, action_type, data, "tenant")
                message, choices = _tenant_choices(found)
                return _result(message, choices=choices)
            return _result("I could not uniquely identify that company. Please provide the tenant ID or exact company name.")
        data["tenant"] = _tenant_snapshot(tenant)
        if action_type == "superadmin_suspend_company" and not data.get("reason"):
            _save(user_context, action_type, data, "reason")
            return _result(f"Please provide the suspension reason for {_tenant_display(tenant)}.")
        _save(user_context, action_type, data, "confirm")
        return _result(
            f"Please confirm: {verb} {_tenant_display(tenant)} ({tenant.get('tenant_id')}). Reply Yes or No.",
            requires_confirmation=True,
        )
    if step == "reason":
        if not _text(question) or _skip(question):
            return _result("A clear suspension reason is required for this action.")
        data["reason"] = _text(question)[:800]
        _save(user_context, action_type, data, "confirm")
        tenant = data.get("tenant") or {}
        return _result(
            f"Please confirm: suspend {tenant.get('name')} ({tenant.get('tenant_id')}). Reason: {data.get('reason')}. Reply Yes or No.",
            requires_confirmation=True,
        )
    if step == "confirm":
        if _no(question):
            return _cancel(user_context)
        if not _yes(question):
            return _result("Please reply Yes to confirm or No to cancel.", requires_confirmation=True)
        tenant = data.get("tenant") or {}
        tenant_id = _text(tenant.get("tenant_id"))
        if not tenant_id:
            return _cancel(user_context, "The selected company could not be revalidated safely. Please start again.")
        # Revalidate existence immediately before the write.
        current = _tenant_candidates(tenant_id)
        if not current:
            return _cancel(user_context, "The selected company no longer exists or is no longer accessible.")
        body = {"reason": data.get("reason", "")}
        try:
            payload = _call_canonical_view(
                "superadmin", route_view,
                f"/superadmin/companies/{tenant_id}/{route_suffix}", method, body,
                user_context=user_context, path_args={"tenant_id": tenant_id},
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _result(_safe_error(exc))
        clear_pending_action(user_context)
        return _result(_text(payload.get("message")) or f"{tenant.get('name')} was updated successfully.")
    return _cancel(user_context, "The incomplete company administration action was cleared safely.")


def _activate_start(question, user_context=None):
    return _company_action_start(question, user_context, "superadmin_activate_company", "activate")


def _activate_continue(pending, question, user_context=None):
    return _company_action_continue(pending, question, user_context, "superadmin_activate_company", "activate", "activate_company", "activate")


def _suspend_start(question, user_context=None):
    return _company_action_start(question, user_context, "superadmin_suspend_company", "suspend")


def _suspend_continue(pending, question, user_context=None):
    return _company_action_continue(pending, question, user_context, "superadmin_suspend_company", "suspend", "suspend_company", "suspend")


def _extend_trial_start(question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        return _result(error)
    tenant, response = _resolve_tenant_for_action(question, user_context, "superadmin_extend_trial")
    if response:
        return response
    data = {"tenant": _tenant_snapshot(tenant)}
    days_match = re.search(r"(\d{1,3})\s*days?", _norm(question))
    if days_match:
        data["days"] = int(days_match.group(1))
    if not data.get("days"):
        _save(user_context, "superadmin_extend_trial", data, "days")
        return _result(f"How many days should I extend the trial for {_tenant_display(tenant)}? Enter 1 to 365 days.")
    if not 1 <= int(data["days"]) <= 365:
        return _result("Trial extension must be between 1 and 365 days.")
    reason_match = re.search(r"\b(?:because|reason[:=]?)\s+(.+)$", _text(question), re.I)
    if reason_match:
        data["reason"] = _text(reason_match.group(1))[:800]
    _save(user_context, "superadmin_extend_trial", data, "confirm")
    return _result(
        f"Please confirm: extend {_tenant_display(tenant)}'s trial by {data['days']} days. Reply Yes or No.",
        requires_confirmation=True,
    )


def _extend_trial_continue(pending, question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        clear_pending_action(user_context)
        return _result(error)
    data = _pending_data(pending)
    step = _pending_step(pending)
    if step == "tenant":
        tenant = _tenant_from_pending_selection(data, question)
        if not tenant:
            return _result("Please provide the exact trial company name or tenant ID.")
        data["tenant"] = _tenant_snapshot(tenant)
        _save(user_context, "superadmin_extend_trial", data, "days")
        return _result(f"How many days should I extend {_tenant_display(tenant)}'s trial? Enter 1 to 365.")
    if step == "days":
        days = _parse_int(question)
        if days is None or not 1 <= days <= 365:
            return _result("Please enter a valid extension from 1 to 365 days.")
        data["days"] = days
        _save(user_context, "superadmin_extend_trial", data, "confirm")
        return _result(
            f"Please confirm: extend {(data.get('tenant') or {}).get('name')} by {days} days. Reply Yes or No.",
            requires_confirmation=True,
        )
    if step == "confirm":
        if _no(question):
            return _cancel(user_context)
        if not _yes(question):
            return _result("Please reply Yes to confirm or No to cancel.", requires_confirmation=True)
        tenant_id = _text((data.get("tenant") or {}).get("tenant_id"))
        if not tenant_id:
            return _cancel(user_context, "The selected trial company could not be revalidated. Please start again.")
        try:
            payload = _call_canonical_view(
                "superadmin", "extend_company_demo",
                f"/superadmin/companies/{tenant_id}/extend-demo", "POST",
                {"days": data.get("days"), "reason": data.get("reason", "")},
                user_context=user_context, path_args={"tenant_id": tenant_id},
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _result(_safe_error(exc))
        clear_pending_action(user_context)
        return _result(_text(payload.get("message")) or "The trial was extended successfully.")
    return _cancel(user_context, "The incomplete trial-extension action was cleared safely.")


def _mark_paid_start(question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        return _result(error)
    tenant, response = _resolve_tenant_for_action(question, user_context, "superadmin_mark_company_paid")
    if response:
        return response
    data = {"tenant": _tenant_snapshot(tenant)}
    clean = _norm(question)
    for code in ("essential", "growth"):
        if code in clean:
            data["plan_code"] = code
            break
    if "premium" in clean:
        return _result("Premium uses the quotation workflow. Please use the Premium request/quotation action instead of manual paid activation.")
    amount = _parse_amount(question)
    if amount is not None:
        data["amount"] = amount
    duration_match = re.search(r"(?:for|duration)\s+(\d{1,4})\s*days?", clean)
    if duration_match:
        data["duration_days"] = int(duration_match.group(1))
    if not data.get("plan_code"):
        _save(user_context, "superadmin_mark_company_paid", data, "plan")
        return _result("Which standard paid plan should be applied? Reply Essential or Growth. Premium must use the quotation workflow.")
    data.setdefault("duration_days", 30)
    _save(user_context, "superadmin_mark_company_paid", data, "confirm")
    amount_text = f" at {_money(data['amount'])}" if data.get("amount") is not None else " using the configured plan amount"
    return _result(
        f"Please confirm manual paid activation for {_tenant_display(tenant)} on {data['plan_code'].title()}{amount_text} for {data['duration_days']} days. Reply Yes or No.",
        requires_confirmation=True,
    )


def _mark_paid_continue(pending, question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        clear_pending_action(user_context)
        return _result(error)
    data = _pending_data(pending)
    step = _pending_step(pending)
    if step == "tenant":
        tenant = _tenant_from_pending_selection(data, question)
        if not tenant:
            return _result("Please provide the exact company name or tenant ID.")
        data["tenant"] = _tenant_snapshot(tenant)
        _save(user_context, "superadmin_mark_company_paid", data, "plan")
        return _result("Which standard paid plan should be applied? Reply Essential or Growth.")
    if step == "plan":
        clean = _norm(question)
        if "premium" in clean:
            return _cancel(user_context, "Premium must use the Premium quotation workflow; manual standard-plan activation was cancelled.")
        plan = "essential" if "essential" in clean else "growth" if "growth" in clean else ""
        if not plan:
            return _result("Please reply Essential or Growth.")
        data["plan_code"] = plan
        data.setdefault("duration_days", 30)
        _save(user_context, "superadmin_mark_company_paid", data, "confirm")
        return _result(
            f"Please confirm manual paid activation for {(data.get('tenant') or {}).get('name')} on {plan.title()} for {data['duration_days']} days. Reply Yes or No.",
            requires_confirmation=True,
        )
    if step == "confirm":
        if _no(question):
            return _cancel(user_context)
        if not _yes(question):
            return _result("Please reply Yes to confirm or No to cancel.", requires_confirmation=True)
        tenant_id = _text((data.get("tenant") or {}).get("tenant_id"))
        body = {
            "plan_code": data.get("plan_code"),
            "duration_days": data.get("duration_days", 30),
            "reason": data.get("reason", "Saya Super Admin confirmed manual activation"),
        }
        if data.get("amount") is not None:
            body["amount"] = data.get("amount")
        try:
            payload = _call_canonical_view(
                "superadmin", "mark_company_paid",
                f"/superadmin/companies/{tenant_id}/mark-paid", "POST", body,
                user_context=user_context, path_args={"tenant_id": tenant_id},
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _result(_safe_error(exc))
        clear_pending_action(user_context)
        return _result(_text(payload.get("message")) or "The company was marked paid successfully.")
    return _cancel(user_context, "The incomplete manual-paid action was cleared safely.")


def _refresh_trials_start(question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        return _result(error)
    _save(user_context, "superadmin_refresh_expired_trials", {}, "confirm")
    return _result(
        "This will refresh all due trial accounts and mark already-expired demos as expired. Reply Yes to confirm or No to cancel.",
        requires_confirmation=True,
    )


def _refresh_trials_continue(pending, question, user_context=None):
    if _no(question):
        return _cancel(user_context)
    if not _yes(question):
        return _result("Please reply Yes to confirm or No to cancel.", requires_confirmation=True)
    try:
        payload = _call_canonical_view(
            "billing", "admin_refresh_expired_demos", "/billing/admin/refresh-expired-demos",
            "POST", {}, user_context=user_context,
        )
    except Exception as exc:
        clear_pending_action(user_context)
        return _result(_safe_error(exc))
    clear_pending_action(user_context)
    result = payload.get("result") or {}
    return _result(
        f"Expired-trial refresh completed. Accounts updated: {result.get('expired_count', 0)}."
    )


def _maintenance_start(question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        return _result(error)
    clean = _norm(question)
    enabled = None
    if any(term in clean for term in ("enable maintenance", "turn on maintenance", "maintenance on", "start maintenance")):
        enabled = True
    elif any(term in clean for term in ("disable maintenance", "turn off maintenance", "maintenance off", "end maintenance", "stop maintenance")):
        enabled = False
    data = {}
    if enabled is None:
        _save(user_context, "superadmin_set_maintenance", data, "state")
        return _result("Should I enable or disable YourComate maintenance mode?")
    data["enabled"] = enabled
    if enabled:
        message_match = re.search(r"(?:message|saying|with message)\s*[:=]?\s*[\"']?(.+?)[\"']?$", _text(question), re.I)
        if message_match:
            data["message"] = _text(message_match.group(1))[:1000]
    _save(user_context, "superadmin_set_maintenance", data, "confirm")
    return _result(
        f"Please confirm: {'ENABLE' if enabled else 'DISABLE'} platform maintenance mode"
        + (f" with message: {data.get('message')}" if data.get("message") else "")
        + ". Reply Yes or No.",
        requires_confirmation=True,
    )


def _maintenance_continue(pending, question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        clear_pending_action(user_context)
        return _result(error)
    data = _pending_data(pending)
    step = _pending_step(pending)
    if step == "state":
        clean = _norm(question)
        if "enable" in clean or clean in {"on", "start"}:
            data["enabled"] = True
        elif "disable" in clean or clean in {"off", "stop", "end"}:
            data["enabled"] = False
        else:
            return _result("Please reply Enable or Disable.")
        _save(user_context, "superadmin_set_maintenance", data, "confirm")
        return _result(
            f"Please confirm: {'ENABLE' if data['enabled'] else 'DISABLE'} platform maintenance mode. Reply Yes or No.",
            requires_confirmation=True,
        )
    if step == "confirm":
        if _no(question):
            return _cancel(user_context)
        if not _yes(question):
            return _result("Please reply Yes to confirm or No to cancel.", requires_confirmation=True)
        body = {"enabled": bool(data.get("enabled"))}
        if data.get("message"):
            body["message"] = data.get("message")
        try:
            payload = _call_canonical_view(
                "superadmin", "update_platform_maintenance", "/superadmin/maintenance",
                "PATCH", body, user_context=user_context,
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _result(_safe_error(exc))
        clear_pending_action(user_context)
        return _result(_text(payload.get("message")) or "Platform maintenance mode was updated successfully.")
    return _cancel(user_context, "The incomplete maintenance action was cleared safely.")


def _parse_pricing_changes(question):
    clean = _norm(question)
    data = {}
    for code in ("essential", "growth", "premium"):
        if re.search(rf"\b{code}\b", clean):
            data["plan_code"] = code
            break
    amount = _parse_amount(question)
    if amount is not None:
        data["amount"] = amount
    limit_match = re.search(r"(?:employee limit|employees?|limit)\s*(?:to|=|:)\s*(\d{1,6})", clean)
    if limit_match:
        data["employee_limit"] = int(limit_match.group(1))
        data["is_unlimited_employees"] = False
    if "unlimited employee" in clean or "unlimited users" in clean:
        data["is_unlimited_employees"] = True
        data["employee_limit"] = None
    if any(term in clean for term in ("deactivate plan", "make inactive", "disable plan")):
        data["is_active"] = False
    elif any(term in clean for term in ("activate plan", "make active", "enable plan")):
        data["is_active"] = True
    if "recommended" in clean:
        data["is_recommended"] = True
    return data


def _pricing_update_start(question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        return _result(error)
    data = _parse_pricing_changes(question)
    if not data.get("plan_code"):
        _save(user_context, "superadmin_update_pricing_plan", data, "details")
        return _result("Please provide the pricing plan code and change, for example: Growth amount ₹4495, employee limit 100.")
    changes = [key for key in data if key != "plan_code"]
    if not changes:
        _save(user_context, "superadmin_update_pricing_plan", data, "details")
        return _result("What should I change for that plan? You can specify amount, employee limit/unlimited, active status, or recommended status.")
    _save(user_context, "superadmin_update_pricing_plan", data, "confirm")
    details = ", ".join(f"{key.replace('_', ' ')}={value}" for key, value in data.items() if key != "plan_code")
    return _result(
        f"Please confirm pricing-plan update for {data['plan_code'].title()}: {details}. Reply Yes or No.",
        requires_confirmation=True,
    )


def _pricing_update_continue(pending, question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        clear_pending_action(user_context)
        return _result(error)
    data = _pending_data(pending)
    step = _pending_step(pending)
    if step == "details":
        data.update(_parse_pricing_changes(question))
        if not data.get("plan_code") or len([key for key in data if key != "plan_code"]) == 0:
            return _result("Please provide the plan code and at least one valid change, such as: Growth amount ₹4495 employee limit 100.")
        _save(user_context, "superadmin_update_pricing_plan", data, "confirm")
        details = ", ".join(f"{key.replace('_', ' ')}={value}" for key, value in data.items() if key != "plan_code")
        return _result(
            f"Please confirm pricing-plan update for {data['plan_code'].title()}: {details}. Reply Yes or No.",
            requires_confirmation=True,
        )
    if step == "confirm":
        if _no(question):
            return _cancel(user_context)
        if not _yes(question):
            return _result("Please reply Yes to confirm or No to cancel.", requires_confirmation=True)
        plan_code = _text(data.pop("plan_code", ""))
        try:
            payload = _call_canonical_view(
                "billing", "admin_update_pricing_plan",
                f"/billing/admin/pricing-plans/{plan_code}", "PATCH", data,
                user_context=user_context, path_args={"plan_code": plan_code},
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _result(_safe_error(exc))
        clear_pending_action(user_context)
        return _result(_text(payload.get("message")) or "The pricing plan was updated successfully.")
    return _cancel(user_context, "The incomplete pricing-plan action was cleared safely.")


def _premium_candidates(text, limit=10):
    db = get_db()
    clean = _text(text)
    query = {"is_deleted": {"$ne": True}}
    if clean:
        reduced = re.sub(r"\b(?:premium|quote|quotation|request|send|update|company|for|the|status|amount|to|client)\b", " ", clean, flags=re.I)
        reduced = re.sub(r"\s+", " ", reduced).strip()
        term = reduced if len(reduced) >= 2 else clean
        pattern = re.escape(term)
        query["$or"] = [
            {"company_name": {"$regex": pattern, "$options": "i"}},
            {"company_email": {"$regex": pattern, "$options": "i"}},
            {"tenant_id": {"$regex": pattern, "$options": "i"}},
            {"quotation_reference": {"$regex": pattern, "$options": "i"}},
            {"request_reference": {"$regex": pattern, "$options": "i"}},
        ]
    return list(db.premium_plan_requests.find(query).sort("updated_at", -1).limit(limit))


def _premium_snapshot(item):
    return {
        "id": _text(item.get("_id")),
        "company_name": _text(item.get("company_name") or item.get("tenant_id")),
        "tenant_id": _text(item.get("tenant_id")),
        "status": _text(item.get("status")),
        "quoted_amount": item.get("quoted_amount") or item.get("renewal_amount"),
        "reference": _text(item.get("quotation_reference") or item.get("request_reference")),
    }


def _premium_update_start(question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        return _result(error)
    candidates = _premium_candidates(question)
    if len(candidates) != 1:
        if not candidates:
            _save(user_context, "superadmin_update_premium_request", {}, "request")
            return _result("Which Premium request should I update? Provide the company name, tenant ID, or quotation/request reference.")
        snapshots = [_premium_snapshot(item) for item in candidates]
        _save(user_context, "superadmin_update_premium_request", {"request_candidates": snapshots}, "request")
        lines = ["I found multiple Premium requests. Reply with the number or reference:"]
        for idx, item in enumerate(snapshots[:DISPLAY_LIMIT], 1):
            lines.append(f"{idx}. {item['company_name']} — {item['reference'] or item['id']} — {item['status'].replace('_', ' ').title()}")
        return _result("\n".join(lines))
    data = {"request": _premium_snapshot(candidates[0])}
    clean = _norm(question)
    amount = _parse_amount(question)
    if amount is not None:
        data["quoted_amount"] = amount
    if "send" in clean and ("quote" in clean or "quotation" in clean or "client" in clean):
        data["send_to_client"] = True
        data["status"] = "quoted"
    allowed = ["new", "contacted", "requirements_collected", "quoted", "payment_pending", "converted", "closed", "cancelled"]
    for status in allowed:
        if status.replace("_", " ") in clean:
            data["status"] = status
            break
    if not any(key in data for key in ("quoted_amount", "send_to_client", "status")):
        _save(user_context, "superadmin_update_premium_request", data, "details")
        return _result("What should I update? You can provide a quoted amount, status, or say 'send quotation to client'.")
    _save(user_context, "superadmin_update_premium_request", data, "confirm")
    details = []
    if data.get("quoted_amount") is not None:
        details.append(f"quote {_money(data['quoted_amount'])}")
    if data.get("status"):
        details.append(f"status {data['status'].replace('_', ' ').title()}")
    if data.get("send_to_client"):
        details.append("send quotation to client")
    return _result(
        f"Please confirm Premium request update for {data['request']['company_name']}: {', '.join(details)}. Reply Yes or No.",
        requires_confirmation=True,
    )


def _premium_update_continue(pending, question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        clear_pending_action(user_context)
        return _result(error)
    data = _pending_data(pending)
    step = _pending_step(pending)
    if step == "request":
        candidates = data.get("request_candidates") or []
        selected = None
        match = re.search(r"(?:^|\b)(\d{1,2})(?:\b|$)", _norm(question))
        if match and candidates:
            index = int(match.group(1)) - 1
            if 0 <= index < len(candidates):
                selected = candidates[index]
        if not selected:
            found = _premium_candidates(question)
            if len(found) == 1:
                selected = _premium_snapshot(found[0])
        if not selected:
            return _result("I could not uniquely identify that Premium request. Please provide the exact reference or company name.")
        data["request"] = selected
        _save(user_context, "superadmin_update_premium_request", data, "details")
        return _result("What should I update? Provide a quoted amount, status, or say 'send quotation to client'.")
    if step == "details":
        clean = _norm(question)
        amount = _parse_amount(question)
        if amount is not None:
            data["quoted_amount"] = amount
        if "send" in clean and ("quote" in clean or "quotation" in clean or "client" in clean):
            data["send_to_client"] = True
            data.setdefault("status", "quoted")
        for status in ("new", "contacted", "requirements_collected", "quoted", "payment_pending", "converted", "closed", "cancelled"):
            if status.replace("_", " ") in clean:
                data["status"] = status
                break
        if not any(key in data for key in ("quoted_amount", "send_to_client", "status")):
            return _result("Please provide a quoted amount, valid status, or say 'send quotation to client'.")
        _save(user_context, "superadmin_update_premium_request", data, "confirm")
        details = []
        if data.get("quoted_amount") is not None:
            details.append(f"quote {_money(data['quoted_amount'])}")
        if data.get("status"):
            details.append(f"status {data['status'].replace('_', ' ').title()}")
        if data.get("send_to_client"):
            details.append("send quotation to client")
        return _result(
            f"Please confirm Premium request update for {(data.get('request') or {}).get('company_name')}: {', '.join(details)}. Reply Yes or No.",
            requires_confirmation=True,
        )
    if step == "confirm":
        if _no(question):
            return _cancel(user_context)
        if not _yes(question):
            return _result("Please reply Yes to confirm or No to cancel.", requires_confirmation=True)
        request_id = _text((data.get("request") or {}).get("id"))
        body = {}
        for key in ("quoted_amount", "status", "send_to_client"):
            if key in data:
                body[key] = data[key]
        try:
            payload = _call_canonical_view(
                "billing", "admin_update_premium_request",
                f"/billing/admin/premium-requests/{request_id}", "PATCH", body,
                user_context=user_context, path_args={"request_id": request_id},
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _result(_safe_error(exc))
        clear_pending_action(user_context)
        return _result(_text(payload.get("message")) or "The Premium request was updated successfully.")
    return _cancel(user_context, "The incomplete Premium-request action was cleared safely.")


def _user_candidates(text, limit=10):
    db = get_db()
    clean = _text(text)
    if not clean:
        return []
    reduced = re.sub(r"\b(?:enable|disable|activate|deactivate|user|account|login|for|the|please)\b", " ", clean, flags=re.I)
    reduced = re.sub(r"\s+", " ", reduced).strip()
    term = reduced if len(reduced) >= 2 else clean
    pattern = re.escape(term)
    return list(db.users.find({
        "is_deleted": {"$ne": True},
        "$or": [
            {"email": {"$regex": pattern, "$options": "i"}},
            {"name": {"$regex": pattern, "$options": "i"}},
            {"full_name": {"$regex": pattern, "$options": "i"}},
            {"tenant_id": {"$regex": pattern, "$options": "i"}},
        ],
    }, {"name": 1, "full_name": 1, "email": 1, "tenant_id": 1, "role": 1, "roles": 1, "is_active": 1}).limit(limit))


def _user_snapshot(item):
    return {
        "id": _text(item.get("_id")),
        "name": _text(item.get("name") or item.get("full_name") or item.get("email")),
        "email": _text(item.get("email")),
        "tenant_id": _text(item.get("tenant_id")),
        "role": _text(item.get("role")),
        "roles": item.get("roles") or [],
        "is_active": item.get("is_active") is not False,
    }


def _user_status_start(question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        return _result(error)
    clean = _norm(question)
    desired = None
    if any(term in clean for term in ("disable user", "deactivate user", "disable account", "block user")):
        desired = False
    elif any(term in clean for term in ("enable user", "activate user", "enable account", "unblock user")):
        desired = True
    if desired is None:
        return _result("Please specify whether you want to enable or disable the tenant user account.")
    candidates = _user_candidates(question)
    if len(candidates) != 1:
        data = {"is_active": desired, "user_candidates": [_user_snapshot(item) for item in candidates]}
        _save(user_context, "superadmin_set_tenant_user_status", data, "user")
        if not candidates:
            return _result("Which tenant user account should I update? Provide the user's name or email address.")
        lines = ["I found multiple users. Reply with the number or exact email:"]
        for idx, item in enumerate(data["user_candidates"][:DISPLAY_LIMIT], 1):
            lines.append(f"{idx}. {item['name']} — {item['email']} — tenant {item['tenant_id']}")
        return _result("\n".join(lines))
    user = _user_snapshot(candidates[0])
    if "super_admin" in {_role_key(item) for item in user.get("roles", [])} or _role_key(user.get("role")) == "super_admin":
        return _result("Super Admin account status cannot be changed through this Saya action.")
    data = {"user": user, "is_active": desired}
    _save(user_context, "superadmin_set_tenant_user_status", data, "confirm")
    return _result(
        f"Please confirm: {'ENABLE' if desired else 'DISABLE'} {user['name']} ({user['email']}) in tenant {user['tenant_id']}. Reply Yes or No.",
        requires_confirmation=True,
    )


def _user_status_continue(pending, question, user_context=None):
    error = _superadmin_write_access(user_context)
    if error:
        clear_pending_action(user_context)
        return _result(error)
    data = _pending_data(pending)
    step = _pending_step(pending)
    if step == "user":
        candidates = data.get("user_candidates") or []
        selected = None
        match = re.search(r"(?:^|\b)(\d{1,2})(?:\b|$)", _norm(question))
        if match and candidates:
            index = int(match.group(1)) - 1
            if 0 <= index < len(candidates):
                selected = candidates[index]
        if not selected:
            found = _user_candidates(question)
            if len(found) == 1:
                selected = _user_snapshot(found[0])
        if not selected:
            return _result("I could not uniquely identify that user. Please provide the exact email address.")
        if "super_admin" in {_role_key(item) for item in selected.get("roles", [])} or _role_key(selected.get("role")) == "super_admin":
            return _cancel(user_context, "Super Admin account status cannot be changed through this Saya action.")
        data["user"] = selected
        _save(user_context, "superadmin_set_tenant_user_status", data, "confirm")
        return _result(
            f"Please confirm: {'ENABLE' if data.get('is_active') else 'DISABLE'} {selected['name']} ({selected['email']}). Reply Yes or No.",
            requires_confirmation=True,
        )
    if step == "confirm":
        if _no(question):
            return _cancel(user_context)
        if not _yes(question):
            return _result("Please reply Yes to confirm or No to cancel.", requires_confirmation=True)
        user = data.get("user") or {}
        user_id = _text(user.get("id"))
        if not user_id or not ObjectId.is_valid(user_id):
            return _cancel(user_context, "The selected user could not be revalidated safely. Please start again.")
        current = get_db().users.find_one({"_id": ObjectId(user_id), "is_deleted": {"$ne": True}})
        if not current:
            return _cancel(user_context, "The selected user no longer exists or is no longer accessible.")
        roles = current.get("roles") or []
        if current.get("role") == "super_admin" or "super_admin" in roles:
            return _cancel(user_context, "Super Admin account status cannot be changed through this Saya action.")
        try:
            payload = _call_canonical_view(
                "superadmin", "update_tenant_user_status",
                f"/superadmin/tenant-users/{user_id}/status", "PATCH",
                {"is_active": bool(data.get("is_active"))},
                user_context=user_context, path_args={"user_id": user_id},
            )
        except Exception as exc:
            clear_pending_action(user_context)
            return _result(_safe_error(exc))
        clear_pending_action(user_context)
        return _result(_text(payload.get("message")) or "The tenant user status was updated successfully.")
    return _cancel(user_context, "The incomplete user-status action was cleared safely.")


# ---------------------------------------------------------------------------
# Registrations
# ---------------------------------------------------------------------------


def _register_tenant_read(action_type, label, handler, phrases):
    register_saya_action(
        action_type,
        {
            "label": label,
            "module": "Administration",
            "module_key": "",
            "kind": "read",
            "scope": "current_tenant_admin",
            "requires_tenant": True,
            "requires_confirmation": False,
            "allowed_roles": sorted(TENANT_ADMIN_ROLES),
        },
        start_handler=handler,
        access_handler=_tenant_admin_access,
        intent_phrases=phrases,
    )


def _register_platform_read(action_type, label, handler, phrases):
    register_saya_action(
        action_type,
        {
            "label": label,
            "module": "Platform Administration",
            "module_key": "",
            "kind": "read",
            "scope": "platform_superadmin",
            "requires_tenant": False,
            "requires_confirmation": False,
            "allowed_roles": ["super_admin"],
        },
        start_handler=handler,
        access_handler=_superadmin_access,
        intent_phrases=phrases,
    )


_register_tenant_read(
    "admin_organisation_overview", "Organisation Administration Overview", _tenant_org_overview_start,
    ["organisation overview", "organization overview", "company admin overview", "company overview", "admin dashboard overview"],
)
_register_tenant_read(
    "admin_subscription_status", "Organisation Subscription Status", _tenant_subscription_start,
    ["our subscription status", "company subscription", "our plan status", "subscription expiry", "our trial status", "company plan"],
)
_register_tenant_read(
    "admin_user_access_overview", "Organisation User Access Overview", _tenant_users_start,
    ["user access overview", "company users overview", "how many active users", "admin user accounts", "role distribution"],
)
_register_tenant_read(
    "admin_module_access", "Organisation Module Access", _tenant_modules_start,
    ["our allowed modules", "company module access", "which modules do we have", "subscription modules", "enabled modules"],
)

_register_platform_read(
    "superadmin_platform_overview", "YourComate Platform Overview", _platform_overview_start,
    ["platform overview", "super admin overview", "saas overview", "yourcomate platform status", "all tenants summary"],
)
_register_platform_read(
    "superadmin_company_list", "Platform Company List", _company_list_start,
    ["list companies", "show tenants", "show companies", "list trial companies", "list paid companies", "suspended companies", "expired companies"],
)
_register_platform_read(
    "superadmin_expiring_tenants", "Expiring Subscription / Trial Monitor", _expiring_tenants_start,
    ["subscriptions expiring", "companies expiring", "tenants expiring", "trials expiring", "expiring in 30 days", "renewals due"],
)
_register_platform_read(
    "superadmin_trial_overview", "Trial Account Overview", _trial_overview_start,
    ["trial overview", "demo overview", "trial tenants", "trial companies status", "demo companies status"],
)
_register_platform_read(
    "superadmin_billing_overview", "Platform Billing Overview", _billing_overview_start,
    ["platform billing overview", "saas billing overview", "subscription billing status", "payment overview", "platform revenue overview"],
)
_register_platform_read(
    "superadmin_pricing_overview", "Pricing Plan Overview", _pricing_overview_start,
    ["pricing plans", "show plans", "plan pricing", "essential growth premium pricing", "subscription plans"],
)
_register_platform_read(
    "superadmin_premium_requests", "Premium Request Overview", _premium_requests_start,
    ["premium requests", "premium quotation requests", "open premium requests", "premium sales pipeline", "premium quotes"],
)
_register_platform_read(
    "superadmin_maintenance_status", "Platform Maintenance Status", _maintenance_status_start,
    ["maintenance status", "is maintenance mode on", "platform maintenance", "yourcomate maintenance status"],
)

register_saya_action(
    "superadmin_activate_company",
    {
        "label": "Activate Company", "module": "Platform Administration", "module_key": "",
        "kind": "write", "scope": "platform_tenant", "requires_tenant": False,
        "requires_confirmation": True, "allowed_roles": ["super_admin"],
    },
    start_handler=_activate_start, continue_handler=_activate_continue,
    access_handler=_superadmin_write_access,
    intent_phrases=["activate company", "activate tenant", "reactivate company", "enable company account"],
)

register_saya_action(
    "superadmin_suspend_company",
    {
        "label": "Suspend Company", "module": "Platform Administration", "module_key": "",
        "kind": "write", "scope": "platform_tenant_critical", "requires_tenant": False,
        "requires_confirmation": True, "allowed_roles": ["super_admin"],
    },
    start_handler=_suspend_start, continue_handler=_suspend_continue,
    access_handler=_superadmin_write_access,
    intent_phrases=["suspend company", "suspend tenant", "disable company account", "block tenant"],
)

register_saya_action(
    "superadmin_extend_trial",
    {
        "label": "Extend Trial", "module": "Platform Billing", "module_key": "",
        "kind": "write", "scope": "platform_trial", "requires_tenant": False,
        "requires_confirmation": True, "allowed_roles": ["super_admin"],
    },
    start_handler=_extend_trial_start, continue_handler=_extend_trial_continue,
    access_handler=_superadmin_write_access,
    intent_phrases=["extend trial", "extend demo", "add trial days", "extend company trial"],
)

register_saya_action(
    "superadmin_mark_company_paid",
    {
        "label": "Manual Paid Activation", "module": "Platform Billing", "module_key": "",
        "kind": "write", "scope": "platform_billing_critical", "requires_tenant": False,
        "requires_confirmation": True, "allowed_roles": ["super_admin"],
    },
    start_handler=_mark_paid_start, continue_handler=_mark_paid_continue,
    access_handler=_superadmin_write_access,
    intent_phrases=["mark company paid", "manual paid activation", "activate paid plan", "mark tenant paid"],
)

register_saya_action(
    "superadmin_refresh_expired_trials",
    {
        "label": "Refresh Expired Trials", "module": "Platform Billing", "module_key": "",
        "kind": "write", "scope": "platform_trials_bulk_status", "requires_tenant": False,
        "requires_confirmation": True, "allowed_roles": ["super_admin"],
    },
    start_handler=_refresh_trials_start, continue_handler=_refresh_trials_continue,
    access_handler=_superadmin_write_access,
    intent_phrases=["refresh expired trials", "expire due demos", "update expired demos", "refresh demo status"],
)

register_saya_action(
    "superadmin_set_maintenance",
    {
        "label": "Change Platform Maintenance Mode", "module": "Platform Administration", "module_key": "",
        "kind": "write", "scope": "platform_critical", "requires_tenant": False,
        "requires_confirmation": True, "allowed_roles": ["super_admin"],
    },
    start_handler=_maintenance_start, continue_handler=_maintenance_continue,
    access_handler=_superadmin_write_access,
    intent_phrases=["enable maintenance", "disable maintenance", "turn on maintenance", "turn off maintenance", "maintenance mode on", "maintenance mode off"],
)

register_saya_action(
    "superadmin_update_pricing_plan",
    {
        "label": "Update Pricing Plan", "module": "Platform Billing", "module_key": "",
        "kind": "write", "scope": "platform_pricing_critical", "requires_tenant": False,
        "requires_confirmation": True, "allowed_roles": ["super_admin"],
    },
    start_handler=_pricing_update_start, continue_handler=_pricing_update_continue,
    access_handler=_superadmin_write_access,
    intent_phrases=["update pricing plan", "change growth price", "change essential price", "change plan amount", "change employee limit", "deactivate pricing plan", "activate pricing plan"],
)

register_saya_action(
    "superadmin_update_premium_request",
    {
        "label": "Update / Send Premium Quotation", "module": "Platform Billing", "module_key": "",
        "kind": "write", "scope": "platform_premium_sales", "requires_tenant": False,
        "requires_confirmation": True, "allowed_roles": ["super_admin"],
    },
    start_handler=_premium_update_start, continue_handler=_premium_update_continue,
    access_handler=_superadmin_write_access,
    intent_phrases=["update premium request", "send premium quotation", "send premium quote", "quote premium plan", "change premium request status"],
)

register_saya_action(
    "superadmin_set_tenant_user_status",
    {
        "label": "Enable / Disable Tenant User", "module": "Platform Administration", "module_key": "",
        "kind": "write", "scope": "platform_user_access_critical", "requires_tenant": False,
        "requires_confirmation": True, "allowed_roles": ["super_admin"],
    },
    start_handler=_user_status_start, continue_handler=_user_status_continue,
    access_handler=_superadmin_write_access,
    intent_phrases=["enable user account", "disable user account", "activate tenant user", "deactivate tenant user", "block user account", "unblock user account"],
)


# Intentionally excluded from conversational execution:
# - password resets / password changes (secret material must not pass through AI)
# - deleting tenant users (irreversible/high-risk; dedicated UI remains canonical)
# - company creation with default admin passwords (current route can default to
#   Admin@123; Saya must not automate that unsafe path)
# - private attendance correction (highly sensitive manual Super Admin tool)
