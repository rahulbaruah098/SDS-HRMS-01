import os
import re
import importlib
from difflib import SequenceMatcher
from datetime import date, datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from bson import ObjectId

from app.extensions import get_db
from app.routes.workflow import (
    normalize_leave_type,
    leave_type_label,
    parse_date,
    calculate_leave_days,
    build_initial_leave_stage,
    leave_stage_label,
    leave_stage_status_fields,
    has_sufficient_leave_balance,
    resolve_handover_employee,
    resolve_project_handover,
    notify_next_leave_approvers,
    employee_code,
    employee_display_name,
    enrich_leave_request_doc,
)


ACTION_COLLECTION = "ai_pending_actions"

ACTION_STALE_AFTER_MINUTES = 180
ACTION_STALE_ACTION_TYPES = {
    "apply_leave",
    "schedule_management_meeting",
    "create_reminder",
    "attendance_check_in",
    "attendance_check_out",
}

# STRICT_AI_ACTION_SCOPE:
# AI guided action dropdowns must never leak cross-department/cross-team data.
# Project handover must never fall back to all tenant projects.
STRICT_AI_ACTION_SCOPE = True


# SAYA_ACTION_ENGINE_V1
# Central metadata for every deterministic Saya write action.  The current
# frontend/service contract still uses {handled, answer}; these fields let the
# next UI/action-router files consume structured action state without breaking
# the existing assistant.
ACTION_SCHEMA_VERSION = 1
ACTION_REGISTRY = {
    "apply_leave": {
        "label": "Apply Leave",
        "module": "Leave",
        "kind": "write",
        "scope": "self",
        "requires_tenant": True,
        "requires_employee": True,
        "requires_confirmation": True,
    },
    "attendance_check_in": {
        "label": "Attendance Check-In",
        "module": "Attendance",
        "kind": "write",
        "scope": "self",
        "requires_tenant": True,
        "requires_employee": True,
        "requires_confirmation": False,
    },
    "attendance_check_out": {
        "label": "Attendance Check-Out",
        "module": "Attendance",
        "kind": "write",
        "scope": "self",
        "requires_tenant": True,
        "requires_employee": True,
        "requires_confirmation": False,
    },
    "schedule_management_meeting": {
        "label": "Schedule Management Group Meeting",
        "module": "Management Group",
        "kind": "write",
        "scope": "management",
        "requires_tenant": True,
        "requires_employee": False,
        "requires_confirmation": True,
    },
    "create_reminder": {
        "label": "Create Reminder",
        "module": "Notifications",
        "kind": "write",
        "scope": "self",
        "requires_tenant": True,
        "requires_employee": False,
        "requires_confirmation": True,
    },
}


# SAYA_PLUGIN_ACTION_ENGINE
# Module-specific Saya action files register themselves here.  The core service
# remains the authority for pending state, confirmation state and final dispatch.
SAYA_ACTION_PLUGIN_MODULES = (
    "app.services.ai_actions.team_manager_actions",
    "app.services.ai_actions.hr_recruitment_actions",
    "app.services.ai_actions.finance_payroll_actions",
    "app.services.ai_actions.admin_superadmin_actions",
)
SAYA_ACTION_HANDLERS = {}
SAYA_ACTION_PLUGIN_ERRORS = {}
_SAYA_ACTION_PLUGINS_LOADED = False
_SAYA_ACTION_PLUGINS_LOADING = False


def register_saya_action(
    action_type,
    definition=None,
    *,
    start_handler=None,
    continue_handler=None,
    access_handler=None,
    intent_phrases=None,
    **extra,
):
    """Register one allow-listed Saya action/capability plugin.

    Registration adds metadata only; it never grants access.  Every plugin can
    provide its own access_handler and the authenticated action pipeline still
    performs tenant/user validation before invoking the handler.
    """
    action_key = _safe_str(action_type)
    if not action_key:
        raise ValueError("Saya action_type is required")

    metadata = dict(definition or {})
    metadata.setdefault("label", action_key.replace("_", " ").title())
    metadata.setdefault("kind", "write")
    metadata.setdefault("requires_confirmation", False)
    metadata["plugin"] = True
    ACTION_REGISTRY[action_key] = metadata

    SAYA_ACTION_HANDLERS[action_key] = {
        "start_handler": start_handler,
        "continue_handler": continue_handler,
        "access_handler": access_handler,
        "intent_phrases": list(intent_phrases or []),
        "metadata": metadata,
        **dict(extra or {}),
    }
    return action_key


def _ensure_saya_action_plugins_loaded():
    """Load module-specific Saya actions once, without breaking core actions."""
    global _SAYA_ACTION_PLUGINS_LOADED, _SAYA_ACTION_PLUGINS_LOADING
    if _SAYA_ACTION_PLUGINS_LOADED or _SAYA_ACTION_PLUGINS_LOADING:
        return

    _SAYA_ACTION_PLUGINS_LOADING = True
    try:
        for module_name in SAYA_ACTION_PLUGIN_MODULES:
            try:
                importlib.import_module(module_name)
                SAYA_ACTION_PLUGIN_ERRORS.pop(module_name, None)
            except Exception as exc:
                # Keep legacy Employee actions available even if one optional
                # role plugin has a deployment/import problem.  The error is
                # intentionally kept server-side for health/debug use.
                SAYA_ACTION_PLUGIN_ERRORS[module_name] = f"{type(exc).__name__}: {exc}"
        _SAYA_ACTION_PLUGINS_LOADED = True
    finally:
        _SAYA_ACTION_PLUGINS_LOADING = False


def get_saya_action_registry():
    """Safe action metadata for tests/UI/health; no handler objects are exposed."""
    _ensure_saya_action_plugins_loaded()
    return {key: dict(value) for key, value in ACTION_REGISTRY.items()}


def get_saya_plugin_health():
    _ensure_saya_action_plugins_loaded()
    return {
        "loaded": not bool(SAYA_ACTION_PLUGIN_ERRORS),
        "registered_actions": len(ACTION_REGISTRY),
        "registered_plugin_actions": len(SAYA_ACTION_HANDLERS),
        "plugin_errors": dict(SAYA_ACTION_PLUGIN_ERRORS),
    }


def get_action_definition(action_type):
    """Return a safe copy of Saya action metadata for UI/orchestration use."""
    _ensure_saya_action_plugins_loaded()
    definition = ACTION_REGISTRY.get(_safe_str(action_type)) or {}
    return dict(definition)


def _action_access_error(action_type, user_context=None):
    definition = ACTION_REGISTRY.get(_safe_str(action_type)) or {}

    if definition.get("requires_tenant") and not _tenant_id(user_context):
        return (
            "I cannot perform this action because your organisation context "
            "could not be verified. Please sign in again and retry."
        )

    if not _user_key(user_context):
        return (
            "I cannot perform this action because your signed-in user identity "
            "could not be verified. Please sign in again and retry."
        )

    if definition.get("requires_employee") and not _employee_id(user_context):
        return (
            "I cannot perform this action because your employee profile is not "
            "mapped to this login. Please contact HR or your system administrator."
        )

    if action_type == "schedule_management_meeting" and not _is_management_role(user_context):
        return (
            "Scheduling Management Group meetings is not available for your "
            "current role. Please contact HR or an administrator if you require access."
        )

    return ""


def _action_step_requires_confirmation(action_type, step):
    definition = ACTION_REGISTRY.get(_safe_str(action_type)) or {}
    return bool(definition.get("requires_confirmation") and _safe_str(step) == "confirm")


def _decorate_action_result(result, action_type="", step="", status="collecting"):
    """
    Preserve the legacy action response while adding a stable structured contract.
    Existing callers can keep reading handled/answer; future UI files can use the
    action metadata directly instead of parsing Saya's prose.
    """
    if not isinstance(result, dict):
        result = {"handled": bool(result), "answer": _safe_str(result)}

    resolved_action = _safe_str(action_type or result.get("action"))
    resolved_step = _safe_str(step or result.get("step"))
    definition = get_action_definition(resolved_action)

    output = dict(result)
    output.setdefault("handled", bool(output.get("answer")))
    output["action"] = resolved_action
    output["action_type"] = resolved_action
    output["action_schema_version"] = ACTION_SCHEMA_VERSION
    output["action_definition"] = definition
    output["step"] = resolved_step
    output["status"] = _safe_str(status or output.get("status") or "collecting")
    output["requires_confirmation"] = _action_step_requires_confirmation(
        resolved_action,
        resolved_step,
    )
    return output


def _safe_action_error(error, fallback):
    """Return business validation messages while hiding technical internals."""
    message = _safe_str(error)
    if not message:
        return fallback

    technical_markers = (
        "traceback", "pymongo", "mongodb", "bson", "objectid(", "keyerror",
        "attributeerror", "typeerror", "connection refused", "server selection",
        "localhost:", "127.0.0.1:", "mongodb://", "http://", "https://",
    )
    lowered = message.lower()
    if any(marker in lowered for marker in technical_markers):
        return fallback

    # Validation messages in this service are intentionally written for users.
    return message[:600]

def _now_utc():
    return datetime.now(timezone.utc)


def _safe_str(value):
    return str(value or "").strip()


def _lower(value):
    return _safe_str(value).lower()


def _as_object_id(value):
    try:
        text = _safe_str(value)
        if text and ObjectId.is_valid(text):
            return ObjectId(text)
    except Exception:
        return None

    return None


def _id_variants(value):
    values = []

    text = _safe_str(value)
    if text:
        values.append(text)

    oid = _as_object_id(text)
    if oid:
        values.append(oid)

    return values


def _user_key(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    return _safe_str(
        user_context.get("user_id")
        or user_context.get("_id")
        or user_context.get("employee_id")
        or user_context.get("email")
    )


def _tenant_id(user_context=None):
    if not isinstance(user_context, dict):
        return None

    return user_context.get("tenant_id")


def _employee_id(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    return _safe_str(
        user_context.get("employee_id")
        or (user_context.get("employee") or {}).get("_id")
        or (user_context.get("employee") or {}).get("id")
        or user_context.get("user_id")
    )


def _roles(user_context=None):
    if not isinstance(user_context, dict):
        return ["employee"]

    roles = user_context.get("roles") or []

    if not roles and user_context.get("role"):
        roles = [user_context.get("role")]

    return [_lower(role) for role in roles if _safe_str(role)] or ["employee"]


def _is_hr_admin_role(user_context=None):
    roles = set(_roles(user_context))

    return bool(
        roles.intersection({
            "super_admin",
            "admin",
            "hr",
            "hr_admin",
            "hr_manager",
        })
    )


def _is_management_role(user_context=None):
    roles = set(_roles(user_context))

    return bool(
        roles.intersection({
            "super_admin",
            "admin",
            "hr",
            "hr_admin",
            "hr_manager",
            "manager",
            "team_leader",
            "reporting_officer",
            "ro",
        })
    )


def _pending_action_query(user_context=None):
    user_key = _user_key(user_context)
    tenant_id = _tenant_id(user_context)

    # Guided actions are private, tenant-bound state. Never allow an unscoped
    # lookup if authentication/tenant mapping is incomplete.
    if not user_key or not tenant_id:
        return {"_id": {"$exists": False}}

    return {
        "tenant_id": tenant_id,
        "user_key": user_key,
        "status": "collecting",
    }


def _pending_action_updated_at(action):
    if not action:
        return None

    value = action.get("updated_at") or action.get("created_at")

    if not value:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)

        return value.astimezone(timezone.utc)

    return None


def _pending_action_is_stale(action):
    if not action:
        return False

    action_type = _safe_str(action.get("action_type"))

    if action_type not in ACTION_STALE_ACTION_TYPES:
        return False

    updated_at = _pending_action_updated_at(action)

    if not updated_at:
        return True

    age = _now_utc() - updated_at

    return age > timedelta(minutes=ACTION_STALE_AFTER_MINUTES)


def _cancel_pending_action_by_id(action_id, reason="cancelled"):
    if not action_id:
        return

    db = get_db()

    db[ACTION_COLLECTION].update_one(
        {"_id": action_id},
        {
            "$set": {
                "status": "cancelled",
                "cancel_reason": reason,
                "updated_at": _now_utc(),
            }
        }
    )


def get_pending_action(user_context=None):
    user_key = _user_key(user_context)

    if not user_key:
        return None

    db = get_db()

    action = db[ACTION_COLLECTION].find_one(
        _pending_action_query(user_context),
        sort=[("updated_at", -1), ("_id", -1)]
    )

    if not action:
        return None

    if _pending_action_is_stale(action):
        _cancel_pending_action_by_id(action.get("_id"), "stale_expired")
        return None

    return action


def clear_pending_action(user_context=None):
    user_key = _user_key(user_context)

    if not user_key:
        return

    db = get_db()

    db[ACTION_COLLECTION].update_many(
        _pending_action_query(user_context),
        {
            "$set": {
                "status": "cancelled",
                "cancel_reason": "manual_clear",
                "updated_at": _now_utc(),
            }
        }
    )


def save_pending_action(user_context=None, action_type="", data=None, current_step=""):
    db = get_db()

    user_key = _user_key(user_context)

    tenant_id = _tenant_id(user_context)

    if not user_key or not tenant_id:
        return None

    now = _now_utc()

    payload = {
        "tenant_id": tenant_id,
        "user_key": user_key,
        "employee_id": _employee_id(user_context),
        "action_type": action_type,
        "data": data or {},
        "current_step": current_step,
        "status": "collecting",
        "action_schema_version": ACTION_SCHEMA_VERSION,
        "updated_at": now,
    }

    existing = get_pending_action(user_context)

    if existing and existing.get("action_type") != action_type:
        _cancel_pending_action_by_id(existing.get("_id"), "replaced_by_new_action")
        existing = None

    if existing:
        db[ACTION_COLLECTION].update_one(
            {"_id": existing["_id"]},
            {
                "$set": payload,
                "$setOnInsert": {
                    "created_at": now,
                }
            },
            upsert=True
        )

        return db[ACTION_COLLECTION].find_one({"_id": existing["_id"]})

    payload["created_at"] = now

    inserted = db[ACTION_COLLECTION].insert_one(payload)

    return db[ACTION_COLLECTION].find_one({"_id": inserted.inserted_id})


def _plugin_action_access_error(action_type, user_context=None):
    _ensure_saya_action_plugins_loaded()
    action_key = _safe_str(action_type)
    handlers = SAYA_ACTION_HANDLERS.get(action_key) or {}

    generic_error = _action_access_error(action_key, user_context)
    if generic_error:
        return generic_error

    access_handler = handlers.get("access_handler")
    if callable(access_handler):
        try:
            return _safe_str(access_handler(user_context))
        except Exception as exc:
            print(f"Saya plugin access check failed for {action_key}: {exc}")
            return "Saya could not verify access for this action. Please retry or use the standard HRMS screen."
    return ""


def _plugin_result(action_type, result, user_context=None, default_status="handled"):
    pending = get_pending_action(user_context)
    step = _safe_str((pending or {}).get("current_step"))
    status = default_status
    if pending and _safe_str(pending.get("action_type")) == _safe_str(action_type):
        status = "awaiting_confirmation" if step == "confirm" else "collecting"
    elif isinstance(result, dict):
        status = _safe_str(result.get("status") or default_status)
    return _decorate_action_result(
        result if isinstance(result, dict) else {"handled": True, "answer": _safe_str(result)},
        action_type=action_type,
        step=step,
        status=status,
    )


def _run_plugin_start(action_type, question, user_context=None):
    _ensure_saya_action_plugins_loaded()
    handlers = SAYA_ACTION_HANDLERS.get(_safe_str(action_type)) or {}
    start_handler = handlers.get("start_handler")
    if not callable(start_handler):
        return _decorate_action_result(
            {"handled": True, "answer": "This Saya action is registered but its handler is not available. Please use the standard HRMS screen."},
            action_type=action_type,
            status="blocked",
        )
    access_error = _plugin_action_access_error(action_type, user_context)
    if access_error:
        return _decorate_action_result(
            {"handled": True, "answer": access_error},
            action_type=action_type,
            status="blocked",
        )
    try:
        result = start_handler(question, user_context)
        return _plugin_result(action_type, result, user_context=user_context)
    except Exception as exc:
        print(f"Saya plugin start failed for {action_type}: {exc}")
        return _decorate_action_result(
            {"handled": True, "answer": "Saya could not complete this action safely. Please retry or use the standard HRMS screen."},
            action_type=action_type,
            status="failed",
        )


def _run_plugin_continue(pending, question, user_context=None):
    action_type = _safe_str((pending or {}).get("action_type"))
    _ensure_saya_action_plugins_loaded()
    handlers = SAYA_ACTION_HANDLERS.get(action_type) or {}
    continue_handler = handlers.get("continue_handler")
    if not callable(continue_handler):
        clear_pending_action(user_context)
        return _decorate_action_result(
            {"handled": True, "answer": "This guided Saya action can no longer continue safely, so I cleared it. Please start the request again."},
            action_type=action_type,
            status="cancelled",
        )
    access_error = _plugin_action_access_error(action_type, user_context)
    if access_error:
        clear_pending_action(user_context)
        return _decorate_action_result(
            {"handled": True, "answer": access_error},
            action_type=action_type,
            status="blocked",
        )
    try:
        result = continue_handler(pending, question, user_context)
        return _plugin_result(action_type, result, user_context=user_context)
    except Exception as exc:
        print(f"Saya plugin continuation failed for {action_type}: {exc}")
        clear_pending_action(user_context)
        return _decorate_action_result(
            {"handled": True, "answer": "Saya could not safely continue this action. The pending action was cleared; please retry from the beginning or use the standard HRMS screen."},
            action_type=action_type,
            status="failed",
        )

def detect_action_intent(question):
    text = _strip_assistant_wake_words(_normalize_option_text(_strip_voice_instruction_suffix(question)))

    # These are information questions, not action-start commands.
    # Example: "How to apply leave?" should explain workflow,
    # not start the leave application form.
    info_question_phrases = [
        "how to apply leave",
        "how do i apply leave",
        "how can i apply leave",
        "process to apply leave",
        "steps to apply leave",
        "how to request leave",
        "how do i request leave",
        "how to check in",
        "how do i check in",
        "how can i check in",
        "how to check out",
        "how do i check out",
        "how can i check out",
        "attendance process",
        "steps to mark attendance",
    ]

    if any(phrase in text for phrase in info_question_phrases):
        return ""

    attendance_intent = _detect_attendance_action_intent(text)

    if attendance_intent:
        return attendance_intent

    if any(word in text for word in [
        "cancel",
        "stop",
        "clear action",
        "forget this",
        "restart action",
        "exit leave",
        "exit meeting",
        "exit reminder",
    ]):
        return "cancel"

    # Start leave guided flow only when user clearly wants to apply/request leave.
    # Do not include phrases like "please submit my leave" here, because that
    # phrase is used later as the final confirmation inside an active leave flow.
    leave_start_phrases = [
        "new leave",
        "fresh leave",
        "start new leave",
        "start again leave",
        "restart leave",
        "apply new leave",
        "create new leave",
        "i want to apply a new leave",
        "i want to apply leave",
        "i need to apply leave",
        "i want leave",
        "i need leave",
        "need casual leave",
        "need earned leave",
        "need half day leave",
        "need half leave",
        "apply leave",
        "apply casual leave",
        "apply earned leave",
        "apply half day leave",
        "apply half leave",
        "apply for leave",
        "request leave",
        "request casual leave",
        "request earned leave",
        "request half day leave",
        "request half leave",
        "request leave now",
        "submit leave request",
        "start leave request",
        "create leave request",
        "leave application",
        "mark my leave",
        "put my leave",
        "put cl",
        "put el",
        "book leave",
        "take leave tomorrow",
    ]

    if any(phrase in text for phrase in leave_start_phrases):
        return "apply_leave"

    leave_action_words = ["apply", "request", "create", "start"]

    if "leave" in text and any(word in text for word in leave_action_words):
        return "apply_leave"

    if any(word in text for word in [
        "schedule meeting",
        "setup meeting",
        "set up meeting",
        "create meeting",
        "management group meeting",
        "assign minutes writer",
        "meeting minutes",
    ]):
        return "schedule_management_meeting"

    if any(word in text for word in [
        "remind me",
        "set reminder",
        "create reminder",
        "add reminder",
    ]):
        return "create_reminder"

    # Final structured router pass (File 19).  It is side-effect-free and
    # allow-listed; permission and execution still happen below.
    try:
        _ensure_saya_action_plugins_loaded()
        from app.services.ai_intent_router import route_saya_intent

        routed = route_saya_intent(question, use_llm_fallback=True) or {}
        routed_intent = _safe_str(routed.get("intent"))
        if routed_intent in ACTION_REGISTRY:
            return routed_intent
    except Exception as exc:
        print(f"Saya structured intent routing fallback failed: {exc}")

    return ""


def _tenant_match_filter(user_context=None):
    tenant_id = _tenant_id(user_context)
    values = _id_variants(tenant_id)

    if not values:
        # Returning an impossible filter is safer than returning {} because many
        # action-option helpers compose this filter dynamically.
        return {"_id": {"$exists": False}}

    return {
        "$or": [
            {"tenant_id": {"$in": values}},
            {"company_id": {"$in": values}},
            {"tenant": {"$in": values}},
        ]
    }


def _department(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    employee = user_context.get("employee") or {}

    return _safe_str(
        employee.get("department")
        or employee.get("department_name")
        or user_context.get("department")
        or user_context.get("department_name")
    )


def _number_value(doc, keys, default=0):
    for key in keys:
        value = doc.get(key)

        if value in [None, ""]:
            continue

        try:
            return float(value)
        except Exception:
            continue

    return default


def _detect_leave_type_from_doc(doc):
    raw = _lower(
        doc.get("leave_type")
        or doc.get("type")
        or doc.get("name")
        or doc.get("title")
        or doc.get("leave_name")
        or doc.get("label")
    )

    if "casual" in raw or raw == "cl":
        return "CL"

    if "earned" in raw or raw == "el":
        return "EL"

    if "lwp" in raw or "without pay" in raw:
        return "LWP"

    if "half" in raw:
        return "HALF_DAY"

    return raw.upper() if raw else ""


def _calculate_leave_available_and_used(doc):
    direct_available = _number_value(
        doc,
        [
            "available",
            "available_balance",
            "balance",
            "remaining",
            "remaining_balance",
            "closing",
            "closing_balance",
            "current_balance",
        ],
        default=None,
    )

    used = _number_value(
        doc,
        [
            "used",
            "used_leave",
            "leave_used",
            "taken",
            "leave_taken",
            "availed",
            "deducted",
        ],
        default=0,
    )

    if direct_available is not None:
        return direct_available, used

    opening = _number_value(
        doc,
        [
            "opening",
            "opening_balance",
            "opening_leave",
            "total",
            "total_leave",
            "allocated",
            "allocated_leave",
        ],
        default=0,
    )

    credited = _number_value(
        doc,
        [
            "credited",
            "credit",
            "credited_leave",
            "added",
            "additional",
        ],
        default=0,
    )

    available = opening + credited - used

    return available, used


def get_leave_type_options(user_context=None):
    db = get_db()

    employee_id = _employee_id(user_context)
    tenant_filter = _tenant_match_filter(user_context)

    cl = 0
    el = 0
    cl_used = 0
    el_used = 0

    if employee_id:
        person_values = _id_variants(employee_id)

        query_parts = []

        if tenant_filter:
            query_parts.append(tenant_filter)

        query_parts.append({
            "$or": [
                {"employee_id": {"$in": person_values}},
                {"user_id": {"$in": person_values}},
                {"employee": {"$in": person_values}},
                {"staff_id": {"$in": person_values}},
            ]
        })

        query = {"$and": query_parts}

        leave_balance_docs = list(db.leave_balances.find(query).limit(50))

        # Format 1: direct CL/EL fields in one doc
        for doc in leave_balance_docs:
            cl_direct = _number_value(
                doc,
                [
                    "cl_balance",
                    "casual_leave_balance",
                    "casual_leave_available",
                    "cl_available",
                    "CL",
                ],
                default=None,
            )

            el_direct = _number_value(
                doc,
                [
                    "el_balance",
                    "earned_leave_balance",
                    "earned_leave_available",
                    "el_available",
                    "EL",
                ],
                default=None,
            )

            if cl_direct is not None:
                cl = cl_direct

            if el_direct is not None:
                el = el_direct

            cl_used_direct = _number_value(
                doc,
                [
                    "cl_used",
                    "casual_leave_used",
                    "used_cl",
                ],
                default=None,
            )

            el_used_direct = _number_value(
                doc,
                [
                    "el_used",
                    "earned_leave_used",
                    "used_el",
                ],
                default=None,
            )

            if cl_used_direct is not None:
                cl_used = cl_used_direct

            if el_used_direct is not None:
                el_used = el_used_direct

        # Format 2: one row per leave type
        for doc in leave_balance_docs:
            leave_type = _detect_leave_type_from_doc(doc)
            available, used = _calculate_leave_available_and_used(doc)

            if leave_type == "CL":
                cl = available
                cl_used = used

            elif leave_type == "EL":
                el = available
                el_used = used

    # Keep display labels intentionally concise. Leave balances are stored as
    # metadata for validation, but are not exposed unless the employee asks for
    # them or the requested leave cannot be applied because of insufficient
    # balance. This keeps Saya's guided leave flow conversational instead of
    # dumping HR data before it is relevant.
    options = [
        {
            "value": "CL",
            "label": "Casual Leave (CL)",
            "available": cl,
            "used": cl_used,
            "balance_tracked": True,
        },
        {
            "value": "EL",
            "label": "Earned Leave (EL)",
            "available": el,
            "used": el_used,
            "balance_tracked": True,
        },
        {
            "value": "HALF_DAY",
            "label": "Half-Day Leave",
            "available": None,
            "used": None,
            "balance_tracked": False,
        },
        {
            "value": "LWP",
            "label": "Leave Without Pay (LWP)",
            "available": None,
            "used": None,
            "balance_tracked": False,
        },
    ]

    return options

def _employee_record_is_active(record):
    record = record or {}

    if record.get("is_deleted") is True:
        return False

    if record.get("is_active") is False:
        return False

    if record.get("active") is False:
        return False

    inactive_values = {
        "inactive",
        "in_active",
        "disabled",
        "resigned",
        "resign",
        "left",
        "terminated",
        "alumni",
        "ex_employee",
        "ex-employee",
        "deleted",
        "blocked",
        "suspended",
    }

    for key in ["status", "employment_status", "employee_status"]:
        value = _lower(record.get(key)).replace(" ", "_")

        if value and value in inactive_values:
            return False

    return True


def _employee_lookup_values_from_context(user_context=None):
    if not isinstance(user_context, dict):
        return []

    employee = user_context.get("employee") or {}

    values = [
        user_context.get("employee_id"),
        user_context.get("user_id"),
        user_context.get("_id"),
        user_context.get("email"),
        employee.get("_id"),
        employee.get("id"),
        employee.get("user_id"),
        employee.get("employee_id"),
        employee.get("employee_ref_id"),
        employee.get("employee_profile_id"),
        employee.get("employee_code"),
        employee.get("emp_code"),
        employee.get("code"),
        employee.get("email"),
        employee.get("official_email"),
        employee.get("work_email"),
    ]

    cleaned = []

    for value in values:
        for candidate in _id_variants(value):
            if candidate and candidate not in cleaned:
                cleaned.append(candidate)

    return cleaned


def _current_employee_for_ai_action(user_context=None):
    db = get_db()
    tenant_filter = _tenant_match_filter(user_context)
    lookup_values = _employee_lookup_values_from_context(user_context)

    if not lookup_values:
        return None

    object_values = [
        value for value in lookup_values
        if isinstance(value, ObjectId)
    ]

    text_values = [
        _safe_str(value)
        for value in lookup_values
        if _safe_str(value)
    ]

    lookup_or = [
        {"_id": {"$in": object_values}},
        {"id": {"$in": text_values}},
        {"user_id": {"$in": text_values}},
        {"employee_user_id": {"$in": text_values}},
        {"login_user_id": {"$in": text_values}},
        {"account_user_id": {"$in": text_values}},
        {"employee_id": {"$in": text_values}},
        {"employee_ref_id": {"$in": text_values}},
        {"employee_profile_id": {"$in": text_values}},
        {"employee_code": {"$in": text_values}},
        {"emp_code": {"$in": text_values}},
        {"code": {"$in": text_values}},
        {"email": {"$in": text_values}},
        {"official_email": {"$in": text_values}},
        {"work_email": {"$in": text_values}},
        {"username": {"$in": text_values}},
    ]

    query_parts = [
        {"is_deleted": {"$ne": True}},
        {"$or": lookup_or},
    ]

    if tenant_filter:
        query_parts.insert(0, tenant_filter)

    # Do not retry globally after a tenant-scoped lookup fails. Employee codes,
    # emails and user ids can overlap across HRMS tenants.
    return db.employees.find_one({"$and": query_parts})


def _active_employee_query_for_handover(user_context=None):
    query_parts = []

    tenant_filter = _tenant_match_filter(user_context)

    if tenant_filter:
        query_parts.append(tenant_filter)

    query_parts.extend([
        {"is_deleted": {"$ne": True}},
        {"is_active": {"$ne": False}},
        {"active": {"$ne": False}},
        {
            "status": {
                "$nin": [
                    "Inactive",
                    "inactive",
                    "INACTIVE",
                    "Resigned",
                    "resigned",
                    "Left",
                    "left",
                    "Terminated",
                    "terminated",
                    "Alumni",
                    "alumni",
                    "Deleted",
                    "deleted",
                    "Blocked",
                    "blocked",
                    "Suspended",
                    "suspended",
                ]
            }
        },
    ])

    return {"$and": query_parts} if query_parts else {}


def _scope_text(value):
    return _safe_str(value).strip().lower()


def _scope_value_set(*values):
    scoped = set()

    for value in values:
        for variant in _id_variants(value):
            text = _scope_text(variant)

            if text:
                scoped.add(text)

    return scoped


def _employee_identity_scope_values(employee=None):
    employee = employee or {}

    return _scope_value_set(
        employee.get("_id"),
        employee.get("id"),
        employee.get("user_id"),
        employee.get("employee_user_id"),
        employee.get("login_user_id"),
        employee.get("account_user_id"),
        employee.get("employee_id"),
        employee.get("employee_ref_id"),
        employee.get("employee_profile_id"),
        employee.get("employee_code"),
        employee.get("emp_code"),
        employee.get("code"),
        employee.get("email"),
        employee.get("official_email"),
        employee.get("work_email"),
        employee.get("username"),
    )


def _employee_tl_scope_values(employee=None):
    employee = employee or {}

    return _scope_value_set(
        employee.get("team_leader_id"),
        employee.get("team_leader_user_id"),
        employee.get("tl_id"),
        employee.get("team_lead_id"),
        employee.get("leader_id"),
    )


def _employee_ro_scope_values(employee=None):
    employee = employee or {}

    return _scope_value_set(
        employee.get("reporting_officer_id"),
        employee.get("reporting_officer_user_id"),
        employee.get("ro_id"),
        employee.get("manager_id"),
        employee.get("reporting_manager_id"),
    )


def _employee_department_scope_value(employee=None):
    employee = employee or {}

    return _scope_text(
        employee.get("department")
        or employee.get("department_name")
        or employee.get("assigned_department")
        or employee.get("assigned_department_name")
    )


def _employee_record_matches_ai_action_scope(current_employee=None, candidate_employee=None):
    """
    STRICT_AI_ACTION_SCOPE:
    Handover employee options are restricted to the logged-in employee's own
    department/team scope. This prevents AI guided leave handover from showing
    employees from unrelated departments.
    """

    if not current_employee or not candidate_employee:
        return False

    current_ids = _employee_identity_scope_values(current_employee)
    candidate_ids = _employee_identity_scope_values(candidate_employee)

    current_department = _employee_department_scope_value(current_employee)
    candidate_department = _employee_department_scope_value(candidate_employee)

    if current_department and candidate_department and current_department == candidate_department:
        return True

    current_tl_values = _employee_tl_scope_values(current_employee)
    current_ro_values = _employee_ro_scope_values(current_employee)
    candidate_tl_values = _employee_tl_scope_values(candidate_employee)
    candidate_ro_values = _employee_ro_scope_values(candidate_employee)

    if candidate_ids.intersection(current_tl_values.union(current_ro_values)):
        return True

    if current_ids.intersection(candidate_tl_values.union(candidate_ro_values)):
        return True

    if current_tl_values and candidate_tl_values and current_tl_values.intersection(candidate_tl_values):
        return True

    if current_ro_values and candidate_ro_values and current_ro_values.intersection(candidate_ro_values):
        return True

    return False


def _project_active_filter_for_ai_action():
    return {
        "$and": [
            {"is_deleted": {"$ne": True}},
            {"deleted": {"$ne": True}},
            {"is_active": {"$ne": False}},
            {"active": {"$ne": False}},
            {
                "status": {
                    "$nin": [
                        "deleted",
                        "Deleted",
                        "DELETED",
                        "cancelled",
                        "Cancelled",
                        "CANCELLED",
                    ]
                }
            },
        ]
    }


def _project_department_scope_parts(department):
    if not _safe_str(department):
        return []

    return [
        {"department": department},
        {"department_name": department},
        {"assigned_department": department},
        {"assigned_department_name": department},
    ]


def _project_handover_scope_query_parts(user_context=None, current_employee=None):
    """
    project_handover_scope:
    Build only the logged-in employee's own project/team scope.
    Never falls back to all tenant projects.
    """

    current_employee = current_employee or {}
    employee_id = _employee_id(user_context)
    user_key = _user_key(user_context)
    department = _department(user_context)

    if not department:
        department = _employee_department_scope_value(current_employee)

    current_person_values = []

    for raw_value in [
        employee_id,
        user_key,
        current_employee.get("_id"),
        current_employee.get("id"),
        current_employee.get("user_id"),
        current_employee.get("employee_user_id"),
        current_employee.get("employee_id"),
        current_employee.get("employee_ref_id"),
        current_employee.get("employee_profile_id"),
        current_employee.get("employee_code"),
        current_employee.get("emp_code"),
        current_employee.get("code"),
        current_employee.get("email"),
        current_employee.get("official_email"),
        current_employee.get("work_email"),
    ]:
        for value in _id_variants(raw_value):
            if value not in current_person_values:
                current_person_values.append(value)

    supervisor_values = []

    for raw_value in [
        current_employee.get("team_leader_id"),
        current_employee.get("team_leader_user_id"),
        current_employee.get("tl_id"),
        current_employee.get("reporting_officer_id"),
        current_employee.get("reporting_officer_user_id"),
        current_employee.get("ro_id"),
        current_employee.get("manager_id"),
    ]:
        for value in _id_variants(raw_value):
            if value not in supervisor_values:
                supervisor_values.append(value)

    scope_or_parts = []

    if current_person_values:
        scope_or_parts.extend([
            {"assigned_to": {"$in": current_person_values}},
            {"assigned_user_id": {"$in": current_person_values}},
            {"assigned_employee_id": {"$in": current_person_values}},
            {"employee_id": {"$in": current_person_values}},
            {"user_id": {"$in": current_person_values}},
            {"created_by": {"$in": current_person_values}},

            {"members": {"$in": current_person_values}},
            {"member_ids": {"$in": current_person_values}},
            {"team_members": {"$in": current_person_values}},
            {"team_member_ids": {"$in": current_person_values}},
            {"collaborators": {"$in": current_person_values}},
            {"collaborator_ids": {"$in": current_person_values}},

            {"team_members.employee_id": {"$in": current_person_values}},
            {"team_members.user_id": {"$in": current_person_values}},
            {"team_members.id": {"$in": current_person_values}},
            {"members.employee_id": {"$in": current_person_values}},
            {"members.user_id": {"$in": current_person_values}},
            {"collaborators.employee_id": {"$in": current_person_values}},
            {"collaborators.user_id": {"$in": current_person_values}},
        ])

    department_parts = _project_department_scope_parts(department)

    if department_parts:
        scope_or_parts.extend(department_parts)

    if supervisor_values:
        supervisor_project_parts = [
            {"team_leader_id": {"$in": supervisor_values}},
            {"team_leader_user_id": {"$in": supervisor_values}},
            {"reporting_officer_id": {"$in": supervisor_values}},
            {"reporting_officer_user_id": {"$in": supervisor_values}},
            {"manager_id": {"$in": supervisor_values}},
        ]

        if department_parts:
            scope_or_parts.append({
                "$and": [
                    {"$or": supervisor_project_parts},
                    {"$or": department_parts},
                ]
            })
        else:
            scope_or_parts.extend(supervisor_project_parts)

    return scope_or_parts


def _format_no_accessible_project_message():
    return "No accessible project/work found for your department/team scope."


def get_handover_employee_options(user_context=None, limit=12):
    db = get_db()

    tenant_id = _tenant_id(user_context)
    employee = _current_employee_for_ai_action(user_context)

    if not employee:
        return []

    query = _active_employee_query_for_handover(user_context)

    docs = list(
        db.employees
        .find(query)
        .sort([("name", 1), ("employee_name", 1)])
        .limit(500)
    )

    options = []
    seen_ids = set()

    for doc in docs:
        if not _employee_record_is_active(doc):
            continue

        if str(doc.get("_id")) == str(employee.get("_id")):
            continue

        if STRICT_AI_ACTION_SCOPE and not _employee_record_matches_ai_action_scope(employee, doc):
            continue

        try:
            resolved = resolve_handover_employee(
                db,
                tenant_id,
                employee,
                str(doc.get("_id")),
            )
        except Exception:
            continue

        handover_id = resolved.get("task_handover_to_id") or str(doc.get("_id"))

        if not handover_id or handover_id in seen_ids:
            continue

        seen_ids.add(handover_id)

        name = (
            resolved.get("task_handover_to_name")
            or doc.get("name")
            or doc.get("employee_name")
            or doc.get("full_name")
            or "Employee"
        )

        designation = (
            doc.get("designation")
            or doc.get("designation_name")
            or ""
        )

        department = (
            doc.get("department")
            or doc.get("department_name")
            or ""
        )

        extra_parts = [
            designation,
            department,
        ]

        extra_text = " - ".join([item for item in extra_parts if item])

        options.append({
            "id": handover_id,
            "label": f"{name}{f' - {extra_text}' if extra_text else ''}",
            "name": name,
            "employee_code": resolved.get("task_handover_employee_id") or employee_code(doc),
            "department": department,
            "designation": designation,
        })

        if len(options) >= limit:
            break

    return options


def get_project_handover_options(user_context=None, limit=12):
    db = get_db()

    tenant_filter = _tenant_match_filter(user_context)

    current_employee = _current_employee_for_ai_action(user_context)

    if not current_employee:
        return []

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    scope_or_parts = _project_handover_scope_query_parts(
        user_context=user_context,
        current_employee=current_employee,
    )

    if not scope_or_parts:
        # No employee/team/department identifiers are available, so do not show
        # any project. No accessible project/work found for this scope.
        return []

    query_parts.append({"$or": scope_or_parts})
    query_parts.append(_project_active_filter_for_ai_action())

    query = {"$and": query_parts}

    docs = list(
        db.projects
        .find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
    )

    # STRICT_AI_ACTION_SCOPE:
    # Never falls back to all tenant projects. If no scoped project is found,
    # the guided leave flow will show "No options found" instead of leaking
    # another department/team project.
    if not docs:
        return []

    options = []

    for doc in docs:
        name = (
            doc.get("name")
            or doc.get("title")
            or doc.get("project_name")
            or doc.get("project_title")
            or "Project"
        )

        status = doc.get("status") or "N/A"

        progress = (
            doc.get("progress")
            or doc.get("progress_percent")
            or doc.get("completion")
            or ""
        )

        extra = f" - {progress}%" if isinstance(progress, (int, float)) else ""

        options.append({
            "id": str(doc.get("_id")),
            "label": f"{name} - {status}{extra}",
            "name": name,
            "status": status,
        })

    return options


def get_management_group_options(user_context=None, limit=10):
    db = get_db()

    tenant_filter = _tenant_match_filter(user_context)
    employee_id = _employee_id(user_context)
    user_key = _user_key(user_context)

    person_values = _id_variants(employee_id) + _id_variants(user_key)

    if not _tenant_id(user_context):
        return []

    if not _is_hr_admin_role(user_context) and not person_values:
        return []

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    if not _is_hr_admin_role(user_context) and person_values:
        query_parts.append({
            "$or": [
                {"members.employee_id": {"$in": person_values}},
                {"members.user_id": {"$in": person_values}},
                {"member_ids": {"$in": person_values}},
                {"created_by": {"$in": person_values}},
            ]
        })

    query = {"$and": query_parts} if query_parts else {}

    docs = list(
        db.management_groups
        .find(query)
        .sort([("name", 1), ("title", 1)])
        .limit(limit)
    )

    options = []

    for doc in docs:
        name = doc.get("name") or doc.get("title") or doc.get("group_name") or "Management Group"

        options.append({
            "id": str(doc.get("_id")),
            "label": name,
            "name": name,
        })

    return options


def get_management_group_member_options(group_id, user_context=None, limit=25):
    db = get_db()

    oid = _as_object_id(group_id)

    if not oid:
        return []

    group = _get_management_group(group_id, user_context=user_context)

    if not group:
        return []

    members = group.get("members") or []

    options = []

    for member in members[:limit]:
        if not isinstance(member, dict):
            continue

        name = (
            member.get("name")
            or member.get("employee_name")
            or member.get("full_name")
            or "Member"
        )

        designation = member.get("designation") or member.get("designation_name") or ""

        member_id = (
            member.get("employee_id")
            or member.get("user_id")
            or member.get("_id")
            or member.get("id")
        )

        options.append({
            "id": _safe_str(member_id),
            "label": f"{name}{f' - {designation}' if designation else ''}",
            "name": name,
        })

    return options


def _format_options(options):
    if not options:
        return "No options found."

    lines = []

    for index, item in enumerate(options, start=1):
        label = (
            item.get("label")
            or item.get("name")
            or item.get("value")
            or "Option"
        )

        lines.append(f"{index}. {label}")

    return "\n".join(lines)


def _looks_like_leave_type_list_request(text):
    clean = _normalize_option_text(_strip_voice_instruction_suffix(text))

    if not clean:
        return False

    phrases = [
        "show leave types",
        "show me leave types",
        "list leave types",
        "list all leave types",
        "state all leave types",
        "what leave types",
        "what are the leave types",
        "what types of leave",
        "which leave types",
        "leave type list",
        "leave types list",
        "leave options",
        "show leave options",
        "list leave options",
        "which leaves can i apply",
        "what leaves can i apply",
    ]

    return any(phrase in clean for phrase in phrases)


def _looks_like_project_list_request(text):
    clean = _normalize_option_text(_strip_voice_instruction_suffix(text))

    if not clean:
        return False

    phrases = [
        "show my projects",
        "show projects",
        "show all projects",
        "list my projects",
        "list projects",
        "list all projects",
        "state all projects",
        "state my projects",
        "what are my projects",
        "what projects am i working on",
        "which projects am i working on",
        "which projects do i have",
        "my project names",
        "project list",
        "projects list",
    ]

    return any(phrase in clean for phrase in phrases)


def _looks_like_team_member_list_request(text):
    clean = _normalize_option_text(_strip_voice_instruction_suffix(text))

    if not clean:
        return False

    phrases = [
        "show my team members",
        "show team members",
        "list my team members",
        "list team members",
        "state my team member name",
        "state my team members",
        "team member names",
        "what are my team members",
        "who are my team members",
        "who is in my team",
        "who can i handover to",
        "who can i hand over to",
        "whom can i handover to",
        "whom can i hand over to",
        "show handover employees",
        "list handover employees",
        "handover options",
    ]

    return any(phrase in clean for phrase in phrases)


def _looks_like_leave_balance_request(text):
    clean = _normalize_option_text(_strip_voice_instruction_suffix(text))

    if not clean:
        return False

    phrases = [
        "leave balance",
        "leave balances",
        "cl left",
        "el left",
        "casual leave left",
        "earned leave left",
        "casual leave balance",
        "earned leave balance",
        "remaining casual leave",
        "remaining earned leave",
        "how many casual leave",
        "how many earned leave",
        "how much casual leave",
        "how much earned leave",
    ]

    return any(phrase in clean for phrase in phrases)


def _looks_like_leave_flow_info_request(text):
    return any([
        _looks_like_leave_type_list_request(text),
        _looks_like_project_list_request(text),
        _looks_like_team_member_list_request(text),
        _looks_like_leave_balance_request(text),
    ])


def _format_leave_balance_summary(leave_options):
    lines = []

    for option in leave_options or []:
        if not option.get("balance_tracked"):
            continue

        available = option.get("available")

        try:
            available_text = f"{float(available or 0):g}"
        except Exception:
            available_text = "0"

        label = option.get("label") or option.get("value") or "Leave"
        lines.append(f"{label}: {available_text} day(s) available")

    return "\n".join(lines) if lines else "No leave balance record was found."

def _selected_leave_balance_blocker(data, user_context=None):
    """
    Return a user-facing balance warning only when balance is actually blocking
    the requested CL/EL application. A healthy balance stays completely silent.
    """
    leave_type = _normalize_ai_leave_type(data.get("leave_type"))

    if leave_type not in {"CL", "EL"}:
        return None

    leave_options = get_leave_type_options(user_context)
    selected = _leave_option_for_type(leave_type, leave_options)

    if not selected:
        return None

    try:
        available = float(selected.get("available", 0) or 0)
    except Exception:
        available = 0.0

    leave_name = _simple_leave_type_label(leave_type)

    if available <= 0:
        return {
            "blocked": True,
            "exhausted": True,
            "available": 0.0,
            "requested_days": None,
            "message": (
                f"Your {leave_name} balance is exhausted. "
                "Please choose another leave type."
            ),
        }

    date_range_text = _safe_str(data.get("date_range_text"))

    if not date_range_text:
        return None

    parsed_dates = _parse_leave_dates(date_range_text)

    if parsed_dates.get("invalid"):
        return None

    requested_days = calculate_leave_days({
        "from_date": parsed_dates.get("from_date"),
        "to_date": parsed_dates.get("to_date"),
        "leave_type": leave_type,
        "is_half_day": False,
        "day_type": "full_day",
    })

    if available < float(requested_days):
        return {
            "blocked": True,
            "exhausted": False,
            "available": available,
            "requested_days": float(requested_days),
            "message": (
                f"You have {available:g} day(s) of {leave_name} available, "
                f"but this request needs {float(requested_days):g} day(s). "
                "Please give a shorter date range or choose another leave type."
            ),
        }

    return None


def _leave_flow_info_answer(question, user_context=None):
    """Answer explicitly requested lists/balances without advancing the leave form."""
    if _looks_like_leave_balance_request(question):
        return _format_leave_balance_summary(get_leave_type_options(user_context))

    if _looks_like_leave_type_list_request(question):
        return (
            "These leave types are available to choose from:\n"
            f"{_format_options(get_leave_type_options(user_context))}"
        )

    if _looks_like_project_list_request(question):
        options = get_project_handover_options(user_context, limit=50)
        return (
            "Your accessible project/work options are:\n"
            f"{_format_options(options)}"
        )

    if _looks_like_team_member_list_request(question):
        options = get_handover_employee_options(user_context, limit=50)
        return (
            "Your available handover team members are:\n"
            f"{_format_options(options)}"
        )

    return ""

def _normalize_option_text(value):
    text = _lower(value)

    typo_fixes = {
        "leaev": "leave",
        "leaeve": "leave",
        "leav": "leave",
        "earened": "earned",
        "erned": "earned",
        "casul": "casual",
        "casula": "casual",
        "tommorow": "tomorrow",
        "tomorow": "tomorrow",
        "tmrw": "tomorrow",
        "handiver": "handover",
        "hand over": "handover",
        "hand-over": "handover",
        "proejct": "project",
        "projct": "project",
        "atlnta": "atlanta",
        "gogoii": "gogoi",
        "unnatfarm": "unnat farm",
        "f p o": "fpo",
        "m i s": "mis",
    }

    for wrong, right in typo_fixes.items():
        # Replace typo aliases as complete tokens/phrases only. Using plain
        # str.replace() turned valid words such as "leave" into "leavee"
        # because "leav" is also a typo alias.
        text = re.sub(
            rf"\b{re.escape(wrong)}\b",
            right,
            text,
            flags=re.IGNORECASE,
        )

    text = (
        text.replace("-", " ")
        .replace("_", " ")
        .replace("/", " ")
        .replace("(", " ")
        .replace(")", " ")
        .replace(".", " ")
        .replace(",", " ")
        .replace(":", " ")
        .replace(";", " ")
        .replace("'", " ")
        .replace('"', " ")
    )

    return " ".join(text.split())


def _strip_voice_instruction_suffix(text):
    """
    Frontend voice mode may append an internal speed instruction such as:
    "Reply very briefly in 1-2 short sentences because this is a voice conversation."
    This must never be treated as the user's actual command.
    """
    clean = _safe_str(text)

    if not clean:
        return ""

    clean = re.split(
        r"\n\s*\n\s*reply\s+very\s+briefly\b",
        clean,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    clean = re.split(
        r"\breply\s+very\s+briefly\s+in\s+1\s*[-–]\s*2\s+short\s+sentences\b",
        clean,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    clean = re.split(
        r"\bbecause\s+this\s+is\s+a\s+voice\s+conversation\b",
        clean,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    return " ".join(clean.replace("\n", " ").split())


def _simple_leave_type_label(leave_type):
    normalized = normalize_leave_type(leave_type)

    if normalized == "CL":
        return "Casual Leave"

    if normalized == "EL":
        return "Earned Leave"

    if normalized == "HALF-DAY":
        return "Half-Day Leave"

    if normalized == "COMP-OFF":
        return "Comp-Off"

    if normalized == "LWP":
        return "Leave Without Pay"

    return leave_type_label(normalized) if normalized else "Leave"


def _set_leave_type_data(data, selected=None, detected_leave_type=""):
    raw_type = ""

    if selected:
        raw_type = (
            selected.get("value")
            or selected.get("name")
            or selected.get("label")
            or detected_leave_type
        )
    else:
        raw_type = detected_leave_type

    leave_type = _normalize_ai_leave_type(raw_type)

    if not leave_type:
        return data

    data["leave_type"] = leave_type
    data["leave_type_label"] = _simple_leave_type_label(leave_type)

    if selected and selected.get("label"):
        data["leave_type_balance_label"] = selected.get("label")

    return data


def _extract_leave_reason_from_command(question):
    clean = _strip_voice_instruction_suffix(question)

    if not clean:
        return ""

    patterns = [
        r"\b(?:leave\s+reason|reason)\s+(?:is|as|mention|mentioned|be|for|:)?\s*(.+)$",
        r"\b(?:because|due\s+to|as)\s+(.+)$",
    ]

    for pattern in patterns:
        match = re.search(pattern, clean, flags=re.IGNORECASE)

        if not match:
            continue

        reason = _safe_str(match.group(1))
        reason = re.split(
            r"\b(?:please\s+)?(?:submit|confirm|apply)\b",
            reason,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        reason = re.sub(
            r"^(?:mention|mentioned|is|as|for|my|the)\s+",
            "",
            reason,
            flags=re.IGNORECASE,
        )

        return " ".join(reason.strip(" .,-:;").split())

    return ""


def _extract_handover_command_parts(question):
    clean = _strip_voice_instruction_suffix(question)

    result = {
        "project_text": "",
        "employee_text": "",
        "reason": _extract_leave_reason_from_command(clean),
    }

    if not clean:
        return result

    handover_match = re.search(
        r"\b(?:handover|hand\s+over|hand-over|handiver)\b\s+(.+)$",
        clean,
        flags=re.IGNORECASE,
    )

    if not handover_match:
        return result

    tail = _safe_str(handover_match.group(1))

    tail_without_reason = re.split(
        r"\b(?:and\s+)?(?:leave\s+)?reason\b|\bbecause\b|\bdue\s+to\b",
        tail,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    if re.search(r"\bto\b", tail_without_reason, flags=re.IGNORECASE):
        project_part, employee_part = re.split(
            r"\bto\b",
            tail_without_reason,
            maxsplit=1,
            flags=re.IGNORECASE,
        )
    else:
        project_part = tail_without_reason
        employee_part = ""

    project_part = re.sub(
        r"\b(?:the|my|a|an|project|work|task|active|ongoing|open)\b",
        " ",
        project_part,
        flags=re.IGNORECASE,
    )

    employee_part = re.sub(
        r"\b(?:sir|madam|employee|person|team\s+member)\b",
        " ",
        employee_part,
        flags=re.IGNORECASE,
    )

    result["project_text"] = " ".join(project_part.strip(" .,-:;").split())
    result["employee_text"] = " ".join(employee_part.strip(" .,-:;").split())

    return result


def _looks_like_no_handover_project(text):
    clean = _normalize_option_text(text)

    return clean in {
        "none",
        "no",
        "skip",
        "not required",
        "no project",
        "no handover",
        "nothing",
    }


def _apply_detected_project_and_handover(data, question, user_context=None):
    parts = _extract_handover_command_parts(question)
    project_text = parts.get("project_text")
    employee_text = parts.get("employee_text")
    reason = parts.get("reason")

    if reason and _is_valid_leave_reason(reason):
        data["reason"] = reason

    if project_text:
        if _looks_like_no_handover_project(project_text):
            data["handover_project_id"] = ""
            data["handover_project_name"] = "None"
        else:
            project_options = data.get("project_options") or get_project_handover_options(user_context)
            data["project_options"] = project_options

            selected_project = _extract_selected_option(project_text, project_options)

            if selected_project:
                data["handover_project_id"] = selected_project.get("id")
                data["handover_project_name"] = (
                    selected_project.get("name")
                    or selected_project.get("label")
                    or project_text
                )
            else:
                # Keep the spoken project name. Native resolve_project_handover()
                # will validate/fuzzy-resolve it during final submission.
                data["handover_project_id"] = ""
                data["handover_project_name"] = project_text

    if employee_text:
        handover_options = data.get("handover_options") or get_handover_employee_options(
            user_context,
            limit=50,
        )
        data["handover_options"] = handover_options

        selected_employee = _extract_selected_option(employee_text, handover_options)

        if selected_employee:
            data["handover_to_id"] = selected_employee.get("id")
            data["handover_to_name"] = (
                selected_employee.get("name")
                or selected_employee.get("label")
                or employee_text
            )
        else:
            data["handover_to_search_text"] = employee_text

    return data


def _leave_ready_for_confirmation(data):
    return bool(
        data.get("leave_type")
        and data.get("date_range_text")
        and data.get("handover_project_name")
        and data.get("handover_to_name")
        and _is_valid_leave_reason(data.get("reason"))
    )

def _extract_project_selection_text(text):
    clean = _safe_str(text)

    if not clean:
        return ""

    # If user says: "handover Unnat Farm MIS to Atlanta Gogoi reason is sick leave"
    # then only "Unnat Farm MIS" should be matched against project options.
    handover_match = re.search(
        r"\b(?:handover|hand over|handiver)\b\s+(.+)$",
        clean,
        flags=re.IGNORECASE,
    )

    if handover_match:
        clean = _safe_str(handover_match.group(1))

    clean = re.split(
        r"\b(?:to|reason|because|and reason|for reason)\b",
        clean,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    clean = re.sub(
        r"\b(?:the|a|an|project|work|task|active|ongoing|open|select|option)\b",
        " ",
        clean,
        flags=re.IGNORECASE,
    )

    return " ".join(clean.split()).strip(" .,-")


def _compact_match_text(value):
    clean = _normalize_option_text(value)

    stop_words = {
        "the",
        "a",
        "an",
        "project",
        "work",
        "task",
        "handover",
        "hand",
        "over",
        "to",
        "and",
        "reason",
        "is",
        "for",
        "please",
        "select",
        "option",
        "active",
        "ongoing",
        "open",
        "during",
        "my",
        "leave",
    }

    return " ".join([
        token
        for token in clean.split()
        if token and token not in stop_words
    ])


def _match_score(search_text, candidate_text):
    search = _compact_match_text(search_text)
    candidate = _compact_match_text(candidate_text)

    if not search or not candidate:
        return 0

    if search == candidate:
        return 100

    if search in candidate:
        return 94

    if candidate in search:
        return 90

    search_tokens = set(search.split())
    candidate_tokens = set(candidate.split())

    if not search_tokens or not candidate_tokens:
        return 0

    overlap = search_tokens.intersection(candidate_tokens)
    overlap_score = int((len(overlap) / max(len(search_tokens), 1)) * 88)

    ratio_score = int(SequenceMatcher(None, search, candidate).ratio() * 100)

    return max(overlap_score, ratio_score)


def _extract_selected_option(text, options):
    clean = _normalize_option_text(text)

    if not options:
        return None

    if clean.isdigit():
        index = int(clean) - 1
        if 0 <= index < len(options):
            return options[index]

    aliases = {
        "casual leave": "cl",
        "casual": "cl",
        "cl": "cl",
        "earned leave": "el",
        "earned": "el",
        "el": "el",
        "half day": "half_day",
        "halfday": "half_day",
        "half leave": "half_day",
        "leave without pay": "lwp",
        "loss of pay": "lwp",
    }

    clean_alias = aliases.get(clean, clean)

    best_option = None
    best_score = 0

    for option in options:
        option_value = _normalize_option_text(option.get("value"))
        option_label = _normalize_option_text(option.get("label"))
        option_name = _normalize_option_text(option.get("name"))
        option_id = _normalize_option_text(option.get("id"))

        option_value_alias = aliases.get(option_value, option_value)
        option_label_alias = aliases.get(option_label, option_label)
        option_name_alias = aliases.get(option_name, option_name)

        if option_id and clean == option_id:
            return option

        if option_value_alias and clean_alias == option_value_alias:
            return option

        if option_name_alias and clean_alias == option_name_alias:
            return option

        if option_label_alias and clean_alias == option_label_alias:
            return option

        if option_label_alias and clean_alias in option_label_alias:
            return option

        if option_name_alias and option_name_alias in clean_alias:
            return option

        for candidate in [
            option.get("label"),
            option.get("name"),
            option.get("value"),
            option.get("employee_code"),
            option.get("department"),
            option.get("designation"),
            option.get("status"),
        ]:
            score = _match_score(clean_alias, candidate)

            if score > best_score:
                best_score = score
                best_option = option

    if best_score >= 58:
        return best_option

    return None

def _employee_name(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    employee = user_context.get("employee") or {}

    return _safe_str(
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or user_context.get("name")
    )


def _employee_department(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    employee = user_context.get("employee") or {}

    return _safe_str(
        employee.get("department")
        or employee.get("department_name")
        or user_context.get("department")
        or user_context.get("department_name")
    )


def _employee_designation(user_context=None):
    if not isinstance(user_context, dict):
        return ""

    employee = user_context.get("employee") or {}

    return _safe_str(
        employee.get("designation")
        or employee.get("designation_name")
        or user_context.get("designation")
        or user_context.get("designation_name")
    )


def _parse_leave_dates(date_text):
    """
    Converts AI-entered date text into HRMS-compatible ISO dates.

    Supported:
    - today
    - tomorrow
    - day after tomorrow
    - 2026-06-12
    - 12-06-2026
    - 12/06/2026
    - 2026-06-12 to 2026-06-13

    If the date is not clear, it returns invalid=True.
    """

    text = _safe_str(date_text)
    lowered = _lower(text)

    today = date.today()

    if not text:
        return {
            "invalid": True,
            "message": "Leave date is required.",
        }

    if lowered in ["today"]:
        start = today
        end = today

    elif lowered in ["tomorrow", "tmrw", "tomorow"]:
        start = today + timedelta(days=1)
        end = start

    elif lowered in ["day after tomorrow", "after tomorrow"]:
        start = today + timedelta(days=2)
        end = start

    else:
        normalized = (
            text.replace(" to ", "|")
            .replace(" till ", "|")
            .replace(" until ", "|")
            .replace(" - ", "|")
        )

        parts = [item.strip() for item in normalized.split("|") if item.strip()]

        def parse_any_date(value):
            value = _safe_str(value)

            # Already ISO format
            parsed = parse_date(value)
            if parsed:
                return parsed

            for fmt in ["%d-%m-%Y", "%d/%m/%Y", "%d %B %Y", "%d %b %Y"]:
                try:
                    return datetime.strptime(value, fmt).date()
                except Exception:
                    continue

            return None

        if len(parts) == 1:
            start = parse_any_date(parts[0])
            end = start
        else:
            start = parse_any_date(parts[0])
            end = parse_any_date(parts[-1])

        if not start or not end:
            return {
                "invalid": True,
                "message": (
                    "I could not understand the leave date. "
                    "Please enter date like 2026-06-12 or 12-06-2026."
                ),
            }

    if end < start:
        return {
            "invalid": True,
            "message": "Upto date cannot be before from date.",
        }

    if start < today:
        return {
            "invalid": True,
            "message": "Leave date cannot be in the past.",
        }

    return {
        "invalid": False,
        "start_date": start,
        "end_date": end,
        "from_date": start.isoformat(),
        "to_date": end.isoformat(),
        "upto_date": end.isoformat(),
        "date_text": text,
    }

def _normalize_ai_leave_type(value):
    text = _safe_str(value).replace("_", " ")
    return normalize_leave_type(text)


def _detect_leave_type_from_text(text):
    clean = _normalize_option_text(text)

    if not clean:
        return ""

    if any(phrase in clean for phrase in [
        "half day",
        "halfday",
        "half leave",
        "half",
    ]):
        return "HALF-DAY"

    if any(phrase in clean for phrase in [
        "casual leave",
        "casual",
        "cl",
    ]):
        return "CL"

    if any(phrase in clean for phrase in [
        "earned leave",
        "earned",
        "el",
    ]):
        return "EL"

    if any(phrase in clean for phrase in [
        "comp off",
        "compoff",
        "compensatory",
    ]):
        return "COMP-OFF"

    if any(phrase in clean for phrase in [
        "leave without pay",
        "loss of pay",
        "lwp",
    ]):
        return "LWP"

    return ""


def _leave_option_for_type(leave_type, leave_options):
    target = _normalize_ai_leave_type(leave_type)

    if not target:
        return None

    for option in leave_options or []:
        option_type = _normalize_ai_leave_type(
            option.get("value")
            or option.get("name")
            or option.get("label")
        )

        if option_type == target:
            return option

    selected = _extract_selected_option(leave_type, leave_options or [])

    if selected:
        return selected

    return None


def _extract_leave_date_text_from_command(question):
    text = _safe_str(question)
    lowered = _lower(text)

    if not text:
        return ""

    if "day after tomorrow" in lowered or "after tomorrow" in lowered:
        return "day after tomorrow"

    if "tomorrow" in lowered or "tmrw" in lowered or "tomorow" in lowered:
        return "tomorrow"

    if "today" in lowered:
        return "today"

    month_names = (
        "jan|january|feb|february|mar|march|apr|april|may|jun|june|"
        "jul|july|aug|august|sep|sept|september|oct|october|"
        "nov|november|dec|december"
    )

    iso_date = r"\d{4}-\d{1,2}-\d{1,2}"
    dmy_date = r"\d{1,2}[/-]\d{1,2}[/-]\d{4}"
    named_date = rf"\d{{1,2}}\s+(?:{month_names})\s+\d{{4}}"
    date_token = rf"(?:{iso_date}|{dmy_date}|{named_date})"

    pattern = rf"({date_token})(?:\s*(?:to|till|until)\s*|\s+-\s*)?({date_token})?"
    match = re.search(pattern, text, flags=re.IGNORECASE)

    if not match:
        return ""

    first_date = _safe_str(match.group(1))
    second_date = _safe_str(match.group(2))

    if first_date and second_date:
        return f"{first_date} to {second_date}"

    return first_date


def _is_valid_leave_reason(text):
    reason = _safe_str(text)
    return len(reason) >= 5


def _looks_like_leave_submit_confirmation(text):
    clean = _normalize_option_text(_strip_voice_instruction_suffix(text))

    submit_phrases = {
        "confirm",
        "confirm it",
        "yes",
        "yes confirm",
        "yes please",
        "yes submit",
        "submit",
        "submit it",
        "submit this",
        "please submit",
        "please submit it",
        "submit leave",
        "submit my leave",
        "please submit leave",
        "please submit my leave",
        "submit the leave",
        "please submit the leave",
        "submit leave request",
        "submit the leave request",
        "apply",
        "apply it",
        "apply leave",
        "apply my leave",
        "please apply",
        "please apply leave",
        "please apply my leave",
        "go ahead",
        "yes go ahead",
        "okay",
        "ok",
        "okay submit",
        "ok submit",
        "done",
        "proceed",
        "please proceed",
    }

    if clean in submit_phrases:
        return True

    return bool(
        re.search(
            r"\b(?:please\s+)?(?:confirm|submit|apply|proceed)\b.*\b(?:leave|it|request)?\b",
            clean,
            flags=re.IGNORECASE,
        )
        and not _looks_like_cancel_confirmation(clean)
    )


def _looks_like_cancel_confirmation(text):
    clean = _normalize_option_text(_strip_voice_instruction_suffix(text))

    return clean in {
        "cancel",
        "no",
        "stop",
        "do not submit",
        "dont submit",
        "don t submit",
        "do not apply",
        "dont apply",
        "don t apply",
        "discard",
        "discard it",
        "clear",
        "clear this",
    }


def _leave_review_text(data):
    leave_type = data.get("leave_type")
    leave_type_text = data.get("leave_type_label") or _simple_leave_type_label(leave_type)

    return (
        "Please confirm your leave request:\n\n"
        f"Leave Type: {leave_type_text}\n"
        f"Date/Range: {data.get('date_range_text')}\n"
        f"Handover Work/Project: {data.get('handover_project_name') or 'None'}\n"
        f"Handover To: {data.get('handover_to_name') or 'Not selected'}\n"
        f"Reason: {data.get('reason')}\n\n"
        "Say confirm, submit it, or apply leave to submit. Say cancel to stop."
    )

def _create_ai_audit_log(
    user_context=None,
    action_type="",
    status="success",
    message="",
    metadata=None,
):
    """
    Stores safe AI assistant action audit logs.
    Do not store secrets or private tokens here.
    """

    db = get_db()

    tenant_id = _tenant_id(user_context)
    user_key = _user_key(user_context)

    employee_name = ""
    employee_id = ""

    if isinstance(user_context, dict):
        employee_id = _employee_id(user_context)
        employee = user_context.get("employee") or {}

        employee_name = (
            employee.get("name")
            or employee.get("employee_name")
            or employee.get("full_name")
            or user_context.get("name")
            or ""
        )

    try:
        db.ai_action_logs.insert_one({
            "tenant_id": tenant_id,
            "user_id": user_key,
            "employee_id": employee_id,
            "employee_name": employee_name,
            "action_type": action_type,
            "status": status,
            "message": message,
            "metadata": metadata or {},
            "source": "ai_assistant",
            "created_at": _now_utc(),
        })
    except Exception:
        pass

def _create_notification_safe(
    tenant_id=None,
    user_id=None,
    title="",
    message="",
    notification_type="ai_assistant"
):
    db = get_db()

    if not user_id:
        return

    try:
        db.notifications.insert_one({
            "tenant_id": tenant_id,
            "user_id": user_id,
            "recipient_id": user_id,
            "title": title,
            "message": message,
            "type": notification_type,
            "is_read": False,
            "read": False,
            "created_at": _now_utc(),
            "updated_at": _now_utc(),
        })
    except Exception:
        pass


def _submit_leave_request_from_ai(data, user_context=None):
    """
    Creates leave request using the same structure as normal HRMS Apply Leave.

    This fixes:
    - Team Leader own leave goes to Reporting Officer
    - Employee leave goes Team Leader -> Reporting Officer
    - HR notification compatibility
    - Application Status field compatibility
    - Attendance Excel approved leave compatibility
    """

    db = get_db()

    tenant_id = _tenant_id(user_context)
    employee_id = _employee_id(user_context)
    user_key = _user_key(user_context)

    employee_obj_id = _as_object_id(employee_id)

    if not tenant_id:
        raise RuntimeError("Your organisation context could not be verified. Please sign in again.")

    if not user_key:
        raise RuntimeError("Your signed-in user identity could not be verified. Please sign in again.")

    if not employee_obj_id:
        raise RuntimeError("Employee profile is not mapped properly for this login.")

    employee = db.employees.find_one({
        "$and": [
            _tenant_match_filter(user_context),
            {"_id": employee_obj_id},
            {"is_deleted": {"$ne": True}},
        ]
    })

    if not employee:
        raise RuntimeError("Employee profile was not found for this login and organisation.")

    leave_type = normalize_leave_type(data.get("leave_type"))

    if leave_type not in ["CL", "EL", "COMP-OFF", "HALF-DAY"]:
        raise RuntimeError(
            "Leave type must be Casual Leave, Earned Leave, Comp-Off, or Half-Day."
        )

    parsed_dates = _parse_leave_dates(data.get("date_range_text"))

    if parsed_dates.get("invalid"):
        raise RuntimeError(parsed_dates.get("message"))

    from_date = parsed_dates.get("start_date")
    to_date = parsed_dates.get("end_date")

    reason = _safe_str(data.get("reason"))

    if not reason:
        raise RuntimeError("Leave reason is required.")

    leave_days = calculate_leave_days({
        "from_date": parsed_dates.get("from_date"),
        "to_date": parsed_dates.get("to_date"),
        "leave_days": data.get("leave_days"),
        "leave_type": leave_type,
        "is_half_day": leave_type == "HALF-DAY",
        "day_type": "half_day" if leave_type == "HALF-DAY" else "full_day",
    })

    # Native HRMS duplicate leave check
    existing_leave = db.leave_requests.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "from_date": {"$lte": to_date.isoformat()},
        "to_date": {"$gte": from_date.isoformat()},
        "status": {"$in": ["pending", "approved", "in_review"]},
        "is_deleted": {"$ne": True},
    })

    if existing_leave:
        raise RuntimeError(
            "A pending or approved leave already exists in this date range."
        )

    # Native HRMS balance check.
    # Half-Day never fails at apply time; final approval deducts CL first, then EL, then LWP.
    sufficient, balance = has_sufficient_leave_balance(
        db,
        employee,
        leave_type,
        leave_days
    )

    if not sufficient:
        available = float(balance.get("available", 0) or 0) if balance else 0
        raise RuntimeError(
            f"Insufficient {leave_type_label(leave_type)} balance. Available: {available:g}"
        )

    try:
        handover_data = resolve_handover_employee(
            db,
            tenant_id,
            employee,
            data.get("handover_to_id"),
        )

        project_data = resolve_project_handover(
            db,
            tenant_id,
            data.get("handover_project_id"),
            data.get("handover_project_name"),
            employee=employee,
        )

    except ValueError as exc:
        raise RuntimeError(str(exc))

    initial_stage = build_initial_leave_stage(employee)
    now = datetime.utcnow()

    leave_doc = {
        "tenant_id": tenant_id,

        "employee_id": str(employee["_id"]),
        "employee_code": employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "employee_name": employee_display_name(employee),
        "employee_email": employee.get("email", ""),

        "department": employee.get("department", ""),
        "department_name": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "designation_name": employee.get("designation", ""),

        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),

        "leave_type": leave_type,
        "leave_type_label": leave_type_label(leave_type),
        "requested_leave_type": leave_type,
        "requested_leave_type_label": leave_type_label(leave_type),

        "is_half_day": leave_type == "HALF-DAY" or leave_days == 0.5,
        "day_type": "half_day" if leave_type == "HALF-DAY" or leave_days == 0.5 else "full_day",
        "leave_days": leave_days,
        "days": leave_days,
        "total_days": leave_days,

        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "upto_date": to_date.isoformat(),
        "start_date": from_date.isoformat(),
        "end_date": to_date.isoformat(),
        "date_from": from_date.isoformat(),
        "date_to": to_date.isoformat(),
        "date_range_text": data.get("date_range_text"),

        "reason": reason,
        "leave_reason": reason,

        **handover_data,
        **project_data,

        # Extra aliases for older/newer frontend screens
        "task_handover": handover_data.get("task_handover_to_name", ""),
        "work_handover": handover_data.get("task_handover_to_name", ""),
        "handover_to_id": handover_data.get("task_handover_to_id", ""),
        "handover_to_name": handover_data.get("task_handover_to_name", ""),

        "project_handover": project_data.get("project_handover_name", ""),
        "handover_project_id": project_data.get("project_handover_id", ""),
        "handover_project_name": project_data.get("project_handover_name", ""),

        "status": "pending",
        "approval_status": "pending",
        "request_status": "pending",
        "final_status": "pending",

        "approval_stage": initial_stage,
        "approval_stage_label": leave_stage_label(initial_stage),
        **leave_stage_status_fields(initial_stage),

        "approval_history": [
            {
                "action": "submitted",
                "status": "pending",
                "stage": initial_stage,
                "stage_label": leave_stage_label(initial_stage),
                "by_user_id": user_key,
                "by_name": employee_display_name(employee),
                "at": now,
                "remark": "Submitted through AI Assistant",
            }
        ],

        "balance_deducted": False,
        "source": "ai_assistant",
        "created_by": user_key,
        "created_at": now,
        "updated_at": now,
        "is_deleted": False,
    }

    result = db.leave_requests.insert_one(leave_doc)
    leave_doc["_id"] = result.inserted_id

    # Use native HRMS approver notification logic
    notify_next_leave_approvers(db, employee, leave_doc, initial_stage)

    _create_ai_audit_log(
        user_context=user_context,
        action_type="apply_leave",
        status="success",
        message="Leave request submitted through AI Assistant using native HRMS workflow.",
        metadata={
            "leave_request_id": str(result.inserted_id),
            "approval_stage": initial_stage,
            "leave_type": leave_type,
            "from_date": from_date.isoformat(),
            "to_date": to_date.isoformat(),
            "leave_days": leave_days,
        },
    )

    clear_pending_action(user_context)

    if initial_stage == "team_leader":
        response_message = "Your request has been sent to your Team Leader for approval."
    elif initial_stage == "reporting_officer":
        response_message = "Your request has been sent to your Reporting Officer for approval."
    else:
        response_message = "Your request has been sent to HR for approval."

    return {
        "leave_request_id": str(result.inserted_id),
        "approval_stage": leave_stage_label(initial_stage),
        "approval_stage_key": initial_stage,
        "message": response_message,
        "item": enrich_leave_request_doc(leave_doc),
    }

def _advance_leave_after_dates(data, user_context=None):
    """
    Move the guided leave request to the next missing field without exposing
    leave balances, project lists, or employee lists unless they were explicitly
    requested by the user.
    """
    balance_blocker = _selected_leave_balance_blocker(data, user_context=user_context)

    if balance_blocker:
        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="balance_resolution",
        )

        return {
            "handled": True,
            "answer": balance_blocker.get("message"),
        }

    if data.get("handover_project_name") and not data.get("handover_to_name"):
        if data.get("handover_to_search_text"):
            handover_options = get_handover_employee_options(
                user_context,
                limit=50,
            )
            data["handover_options"] = handover_options

            selected = _extract_selected_option(
                data.get("handover_to_search_text"),
                handover_options,
            )

            if selected:
                data["handover_to_id"] = selected.get("id")
                data["handover_to_name"] = selected.get("name") or selected.get("label")

    if _leave_ready_for_confirmation(data):
        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="confirm",
        )

        return {
            "handled": True,
            "answer": _leave_review_text(data),
        }

    if not data.get("handover_project_name"):
        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="handover_projects",
        )

        return {
            "handled": True,
            "answer": (
                "Okay. Which project/work do you want to hand over during your leave? "
                "Type the project/work name, or say 'none' if no project handover is needed."
            ),
        }

    if not data.get("handover_to_name"):
        handover_options = get_handover_employee_options(
            user_context,
            limit=50,
        )
        data["handover_options"] = handover_options

        if not handover_options:
            data["handover_to_id"] = ""
            data["handover_to_name"] = "Not selected"
        else:
            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="handover_to",
            )

            return {
                "handled": True,
                "answer": "Who do you want to hand this project/work over to?",
            }

    save_pending_action(
        user_context=user_context,
        action_type="apply_leave",
        data=data,
        current_step="reason",
    )

    return {
        "handled": True,
        "answer": "What is the reason for your leave?",
    }


def _apply_leave_start(user_context=None, question=""):
    access_error = _action_access_error("apply_leave", user_context)
    if access_error:
        return {"handled": True, "answer": access_error}

    question = _strip_voice_instruction_suffix(question)
    leave_options = get_leave_type_options(user_context)
    data = {
        "leave_options": leave_options,
    }

    detected_leave_type = _detect_leave_type_from_text(question)

    if detected_leave_type:
        selected_leave_type = _leave_option_for_type(detected_leave_type, leave_options)
        _set_leave_type_data(data, selected_leave_type, detected_leave_type)

    detected_date_text = _extract_leave_date_text_from_command(question)

    if detected_date_text:
        parsed_dates = _parse_leave_dates(detected_date_text)

        if not parsed_dates.get("invalid"):
            data["date_range_text"] = detected_date_text
        else:
            data["date_error"] = parsed_dates.get("message")

    # Preserve one-command support, but resolve project/team data internally.
    # Nothing is listed unless the employee explicitly asks to see a list.
    _apply_detected_project_and_handover(data, question, user_context=user_context)

    if not data.get("leave_type"):
        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="leave_type",
        )

        return {
            "handled": True,
            "answer": "Sure. What type of leave would you like to apply for?",
        }

    balance_blocker = _selected_leave_balance_blocker(data, user_context=user_context)

    if balance_blocker:
        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="balance_resolution",
        )

        return {
            "handled": True,
            "answer": balance_blocker.get("message"),
        }

    if not data.get("date_range_text"):
        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="date_range",
        )

        date_error = data.get("date_error")

        if date_error:
            return {
                "handled": True,
                "answer": f"{date_error} Please tell me the leave date or date range again.",
            }

        return {
            "handled": True,
            "answer": "Okay. What date or date range do you want for this leave?",
        }

    return _advance_leave_after_dates(data, user_context=user_context)


def _apply_leave_continue(pending, question, user_context=None):
    question = _strip_voice_instruction_suffix(question)
    data = pending.get("data") or {}
    step = pending.get("current_step")

    # Progressive disclosure: while a leave application is pending, answer
    # lists/balances only when the employee explicitly requests them. The
    # pending action remains unchanged so the employee can continue afterwards.
    info_answer = _leave_flow_info_answer(question, user_context=user_context)

    if info_answer:
        return {
            "handled": True,
            "answer": info_answer,
        }

    if step == "leave_type":
        leave_options = get_leave_type_options(user_context)
        data["leave_options"] = leave_options

        detected_leave_type = _detect_leave_type_from_text(question)
        selected = None

        if detected_leave_type:
            selected = _leave_option_for_type(detected_leave_type, leave_options)

        if not selected:
            selected = _extract_selected_option(question, leave_options)

        if not selected:
            return {
                "handled": True,
                "answer": "Please tell me the leave type you want to apply for.",
            }

        _set_leave_type_data(data, selected, selected.get("value") or selected.get("name"))

        date_text = _extract_leave_date_text_from_command(question)

        if date_text:
            parsed_dates = _parse_leave_dates(date_text)

            if not parsed_dates.get("invalid"):
                data["date_range_text"] = date_text
            else:
                data["date_error"] = parsed_dates.get("message")

        _apply_detected_project_and_handover(data, question, user_context=user_context)

        balance_blocker = _selected_leave_balance_blocker(data, user_context=user_context)

        if balance_blocker:
            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="balance_resolution",
            )

            return {
                "handled": True,
                "answer": balance_blocker.get("message"),
            }

        if data.get("date_range_text"):
            return _advance_leave_after_dates(data, user_context=user_context)

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="date_range",
        )

        if data.get("date_error"):
            return {
                "handled": True,
                "answer": f"{data.get('date_error')} Please tell me the leave date or date range again.",
            }

        return {
            "handled": True,
            "answer": "Okay. What date or date range do you want for this leave?",
        }

    if step == "date_range":
        # Allow the employee to change the leave type naturally at this step.
        # Example: "Change it to earned leave".
        detected_leave_type = _detect_leave_type_from_text(question)
        date_text = _extract_leave_date_text_from_command(question)

        if detected_leave_type:
            leave_options = get_leave_type_options(user_context)
            data["leave_options"] = leave_options
            selected = _leave_option_for_type(detected_leave_type, leave_options)

            if selected:
                _set_leave_type_data(
                    data,
                    selected,
                    selected.get("value") or selected.get("name"),
                )

        if not date_text and detected_leave_type:
            balance_blocker = _selected_leave_balance_blocker(data, user_context=user_context)

            if balance_blocker:
                save_pending_action(
                    user_context=user_context,
                    action_type="apply_leave",
                    data=data,
                    current_step="balance_resolution",
                )

                return {
                    "handled": True,
                    "answer": balance_blocker.get("message"),
                }

            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="date_range",
            )

            return {
                "handled": True,
                "answer": "Okay. What date or date range do you want for this leave?",
            }

        detected_date_text = date_text or _safe_str(question)
        parsed_dates = _parse_leave_dates(detected_date_text)

        if parsed_dates.get("invalid"):
            return {
                "handled": True,
                "answer": f"{parsed_dates.get('message')} Please enter the leave date again.",
            }

        data["date_range_text"] = detected_date_text
        data.pop("date_error", None)

        _apply_detected_project_and_handover(data, question, user_context=user_context)

        return _advance_leave_after_dates(data, user_context=user_context)

    if step == "balance_resolution":
        leave_options = get_leave_type_options(user_context)
        data["leave_options"] = leave_options

        detected_leave_type = _detect_leave_type_from_text(question)
        date_text = _extract_leave_date_text_from_command(question)
        recognized_update = False

        if detected_leave_type:
            selected = _leave_option_for_type(detected_leave_type, leave_options)

            if selected:
                _set_leave_type_data(
                    data,
                    selected,
                    selected.get("value") or selected.get("name"),
                )
                recognized_update = True

        if date_text:
            parsed_dates = _parse_leave_dates(date_text)

            if parsed_dates.get("invalid"):
                return {
                    "handled": True,
                    "answer": f"{parsed_dates.get('message')} Please enter the leave date again.",
                }

            data["date_range_text"] = date_text
            data.pop("date_error", None)
            recognized_update = True

        if not recognized_update:
            return {
                "handled": True,
                "answer": "Please choose another leave type or give a shorter leave date/range.",
            }

        _apply_detected_project_and_handover(data, question, user_context=user_context)

        balance_blocker = _selected_leave_balance_blocker(data, user_context=user_context)

        if balance_blocker:
            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="balance_resolution",
            )

            return {
                "handled": True,
                "answer": balance_blocker.get("message"),
            }

        if not data.get("date_range_text"):
            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="date_range",
            )

            return {
                "handled": True,
                "answer": "Okay. What date or date range do you want for this leave?",
            }

        return _advance_leave_after_dates(data, user_context=user_context)

    if step == "handover_projects":
        _apply_detected_project_and_handover(data, question, user_context=user_context)

        if not data.get("handover_project_name"):
            if _looks_like_no_handover_project(question):
                data["handover_project_id"] = ""
                data["handover_project_name"] = "None"
            else:
                project_options = data.get("project_options") or get_project_handover_options(
                    user_context,
                    limit=50,
                )
                data["project_options"] = project_options
                project_selection_text = (
                    _extract_handover_command_parts(question).get("project_text")
                    or _extract_project_selection_text(question)
                    or question
                )
                selected = _extract_selected_option(project_selection_text, project_options)

                if not selected:
                    return {
                        "handled": True,
                        "answer": (
                            "I couldn't match that project/work in your accessible project scope. "
                            "Please type the project/work name again. If you want the list, say 'show my projects'."
                        ),
                    }

                data["handover_project_id"] = selected.get("id")
                data["handover_project_name"] = selected.get("name") or selected.get("label")

        handover_options = data.get("handover_options") or get_handover_employee_options(
            user_context,
            limit=50,
        )
        data["handover_options"] = handover_options

        if data.get("handover_to_search_text") and not data.get("handover_to_name"):
            selected_employee = _extract_selected_option(
                data.get("handover_to_search_text"),
                handover_options,
            )

            if selected_employee:
                data["handover_to_id"] = selected_employee.get("id")
                data["handover_to_name"] = selected_employee.get("name") or selected_employee.get("label")

        if not handover_options and not data.get("handover_to_name"):
            data["handover_to_id"] = ""
            data["handover_to_name"] = "Not selected"

        if _leave_ready_for_confirmation(data):
            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="confirm",
            )

            return {
                "handled": True,
                "answer": _leave_review_text(data),
            }

        if not data.get("handover_to_name"):
            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="handover_to",
            )

            return {
                "handled": True,
                "answer": "Who do you want to hand this project/work over to?",
            }

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="reason",
        )

        return {
            "handled": True,
            "answer": "What is the reason for your leave?",
        }

    if step == "handover_to":
        handover_options = data.get("handover_options") or get_handover_employee_options(
            user_context,
            limit=50,
        )
        data["handover_options"] = handover_options

        parts = _extract_handover_command_parts(question)
        employee_text = parts.get("employee_text") or question
        selected = _extract_selected_option(employee_text, handover_options)

        if not selected:
            return {
                "handled": True,
                "answer": (
                    "I couldn't match that employee in your permitted handover team. "
                    "Please type the employee name again. If you want the list, say 'show my team members'."
                ),
            }

        data["handover_to_id"] = selected.get("id")
        data["handover_to_name"] = selected.get("name") or selected.get("label")

        detected_reason = parts.get("reason") or _extract_leave_reason_from_command(question)

        if detected_reason and _is_valid_leave_reason(detected_reason):
            data["reason"] = detected_reason

            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="confirm",
            )

            return {
                "handled": True,
                "answer": _leave_review_text(data),
            }

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="reason",
        )

        return {
            "handled": True,
            "answer": "What is the reason for your leave?",
        }

    if step == "reason":
        reason = _extract_leave_reason_from_command(question) or _safe_str(question)
        reason = re.split(
            r"\b(?:please\s+)?(?:submit|confirm|apply)\b",
            reason,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip(" .,-:;")

        if not _is_valid_leave_reason(reason):
            return {
                "handled": True,
                "answer": "Please provide a valid leave reason with at least 5 characters.",
            }

        data["reason"] = reason

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="confirm",
        )

        return {
            "handled": True,
            "answer": _leave_review_text(data),
        }

    if step == "confirm":
        if _looks_like_cancel_confirmation(question):
            clear_pending_action(user_context)

            return {
                "handled": True,
                "answer": "Leave request setup cancelled.",
            }

        if _looks_like_leave_submit_confirmation(question):
            try:
                submission = _submit_leave_request_from_ai(
                    data,
                    user_context=user_context,
                )

                return {
                    "handled": True,
                    "answer": (
                        "Your leave request has been submitted successfully.\n\n"
                        f"Leave Request ID: {submission.get('leave_request_id')}\n"
                        f"Current Status: Pending\n"
                        f"Approval Stage: {submission.get('approval_stage')}\n"
                        f"{submission.get('message')}\n\n"
                        "You can track this from the Application Status module."
                    ),
                }

            except Exception as error:
                clear_pending_action(user_context)

                return {
                    "handled": True,
                    "answer": (
                        "I could not submit your leave request.\n\n"
                        f"Reason: {_safe_action_error(error, 'The leave request could not be submitted safely.')}\n\n"
                        "I have cleared the incomplete leave setup so it will not reuse old details.\n"
                        "Please start a new leave request when you are ready."
                    ),
                }

        return {
            "handled": True,
            "answer": _leave_review_text(data),
        }

    return {
        "handled": True,
        "answer": "I am still collecting your leave request details. Please continue with the requested information.",
    }

def _get_management_group(group_id, user_context=None):
    db = get_db()

    oid = _as_object_id(group_id)

    if not oid or not _tenant_id(user_context):
        return None

    query_parts = [
        _tenant_match_filter(user_context),
        {"_id": oid},
    ]

    # HR/Admin roles may schedule any management group in their tenant. Other
    # management roles may operate only on groups they belong to or created.
    if not _is_hr_admin_role(user_context):
        person_values = (
            _id_variants(_employee_id(user_context))
            + _id_variants(_user_key(user_context))
        )
        if not person_values:
            return None

        query_parts.append({
            "$or": [
                {"members.employee_id": {"$in": person_values}},
                {"members.user_id": {"$in": person_values}},
                {"member_ids": {"$in": person_values}},
                {"created_by": {"$in": person_values}},
            ]
        })

    return db.management_groups.find_one({"$and": query_parts})


def _create_notifications_for_management_group(
    tenant_id=None,
    group=None,
    title="",
    message="",
):
    if not group:
        return

    members = group.get("members") or []

    for member in members:
        if not isinstance(member, dict):
            continue

        member_user_id = (
            member.get("user_id")
            or member.get("employee_user_id")
            or member.get("login_user_id")
            or member.get("employee_id")
            or member.get("_id")
            or member.get("id")
        )

        _create_notification_safe(
            tenant_id=tenant_id,
            user_id=member_user_id,
            title=title,
            message=message,
            notification_type="management_group_meeting",
        )


def _submit_management_meeting_from_ai(data, user_context=None):
    access_error = _action_access_error("schedule_management_meeting", user_context)
    if access_error:
        raise RuntimeError(access_error)

    db = get_db()

    tenant_id = _tenant_id(user_context)
    user_key = _user_key(user_context)

    group_id = data.get("group_id")
    group = _get_management_group(group_id, user_context=user_context)

    if not group:
        raise RuntimeError("Selected management group was not found.")

    group_name = (
        group.get("name")
        or group.get("title")
        or group.get("group_name")
        or data.get("group_name")
        or "Management Group"
    )

    meeting_doc = {
        "tenant_id": tenant_id,
        "group_id": group_id,
        "management_group_id": group_id,
        "group_name": group_name,

        "title": data.get("agenda") or "Management Group Meeting",
        "agenda": data.get("agenda"),
        "description": data.get("agenda"),

        "meeting_date_time_text": data.get("date_time_text"),
        "date_time_text": data.get("date_time_text"),

        "minutes_writer_id": data.get("minutes_writer_id"),
        "minutes_writer_name": data.get("minutes_writer_name"),
        "assigned_minutes_writer_id": data.get("minutes_writer_id"),
        "assigned_minutes_writer_name": data.get("minutes_writer_name"),

        "status": "Scheduled",
        "meeting_status": "Scheduled",
        "source": "ai_assistant",

        "created_by": user_key,
        "created_at": _now_utc(),
        "updated_at": _now_utc(),

        "members_snapshot": group.get("members") or [],
        "minutes": "",
        "minutes_history": [],
    }

    result = db.management_group_meetings.insert_one(meeting_doc)

    _create_notifications_for_management_group(
        tenant_id=tenant_id,
        group=group,
        title="Management Group Meeting Scheduled",
        message=(
            f"A meeting has been scheduled for {group_name}. "
            f"Agenda: {data.get('agenda')}. "
            f"Date/Time: {data.get('date_time_text')}. "
            f"Minutes Writer: {data.get('minutes_writer_name')}."
        ),
    )

    if data.get("minutes_writer_id"):
        _create_notification_safe(
            tenant_id=tenant_id,
            user_id=data.get("minutes_writer_id"),
            title="You are assigned as Minutes Writer",
            message=(
                f"You have been assigned to write minutes for the meeting: "
                f"{data.get('agenda')}."
            ),
            notification_type="management_group_minutes_writer",
        )

    _create_ai_audit_log(
        user_context=user_context,
        action_type="schedule_management_meeting",
        status="success",
        message="Management group meeting scheduled through AI Assistant.",
        metadata={
            "meeting_id": str(result.inserted_id),
            "group_id": group_id,
            "group_name": group_name,
            "agenda": data.get("agenda"),
            "date_time_text": data.get("date_time_text"),
            "minutes_writer_id": data.get("minutes_writer_id"),
            "minutes_writer_name": data.get("minutes_writer_name"),
        },
    )

    clear_pending_action(user_context)

    return {
        "meeting_id": str(result.inserted_id),
        "group_name": group_name,
        "agenda": data.get("agenda"),
        "date_time": data.get("date_time_text"),
        "minutes_writer": data.get("minutes_writer_name"),
    }

def _meeting_start(user_context=None):
    access_error = _action_access_error("schedule_management_meeting", user_context)
    if access_error:
        return {"handled": True, "answer": access_error}

    if not _is_management_role(user_context):
        return {
            "handled": True,
            "answer": (
                "Meeting setup is not available for your current login role. "
                "Please contact HR/Admin if you need access."
            )
        }

    group_options = get_management_group_options(user_context)
    if not group_options:
        return {
            "handled": True,
            "answer": (
                "I could not find any management group available for your login.\n\n"
                "Please check whether you are added as a member/admin of a Management Group, "
                "or contact HR/Admin."
            )
        }
    save_pending_action(
        
        user_context=user_context,
        action_type="schedule_management_meeting",
        data={
            "group_options": group_options,
        },
        current_step="group"
    )

    return {
        "handled": True,
        "answer": (
            "Sure, I can help you schedule a management group meeting.\n\n"
            "Please select the management group:\n"
            f"{_format_options(group_options)}\n\n"
            "Reply with the option number or group name."
        )
    }


def _meeting_continue(pending, question, user_context=None):
    data = pending.get("data") or {}
    step = pending.get("current_step")

    if step == "group":
        group_options = data.get("group_options") or get_management_group_options(user_context)
        selected = _extract_selected_option(question, group_options)

        if not selected:
            return {
                "handled": True,
                "answer": (
                    "Please choose a valid management group:\n"
                    f"{_format_options(group_options)}"
                )
            }

        data["group_id"] = selected.get("id")
        data["group_name"] = selected.get("name") or selected.get("label")

        save_pending_action(
            user_context=user_context,
            action_type="schedule_management_meeting",
            data=data,
            current_step="agenda"
        )

        return {
            "handled": True,
            "answer": (
                f"Selected group: {data['group_name']}.\n\n"
                "What is the topic or agenda of the meeting?"
            )
        }

    if step == "agenda":
        data["agenda"] = _safe_str(question)

        save_pending_action(
            user_context=user_context,
            action_type="schedule_management_meeting",
            data=data,
            current_step="date_time"
        )

        return {
            "handled": True,
            "answer": (
                "Agenda noted.\n\n"
                "Now tell me the meeting date and time.\n"
                "Example: 15 June 2026 at 3:00 PM."
            )
        }

    if step == "date_time":
        data["date_time_text"] = _safe_str(question)

        member_options = get_management_group_member_options(
            data.get("group_id"),
            user_context=user_context
        )
        data["minutes_writer_options"] = member_options
        if not member_options:
            return {
                "handled": True,
                "answer": (
                    "I could not find members inside this management group for assigning a minutes writer.\n\n"
                    "Please update the Management Group members first, then try again."
                )
            }
        save_pending_action(
            user_context=user_context,
            action_type="schedule_management_meeting",
            data=data,
            current_step="minutes_writer"
        )

        return {
            "handled": True,
            "answer": (
                "Meeting date/time noted.\n\n"
                "Who will write the meeting minutes?\n"
                f"{_format_options(member_options)}\n\n"
                "Reply with option number or member name."
            )
        }

    if step == "minutes_writer":
        member_options = (
            data.get("minutes_writer_options")
            or get_management_group_member_options(
                data.get("group_id"),
                user_context=user_context
            )
        )

        selected = _extract_selected_option(question, member_options)

        if not selected:
            return {
                "handled": True,
                "answer": (
                    "Please choose a valid minutes writer:\n"
                    f"{_format_options(member_options)}"
                )
            }

        data["minutes_writer_id"] = selected.get("id")
        data["minutes_writer_name"] = selected.get("name") or selected.get("label")

        save_pending_action(
            user_context=user_context,
            action_type="schedule_management_meeting",
            data=data,
            current_step="confirm"
        )

        return {
            "handled": True,
            "answer": (
                "Please review the meeting setup:\n\n"
                f"Group: {data.get('group_name')}\n"
                f"Agenda: {data.get('agenda')}\n"
                f"Date/Time: {data.get('date_time_text')}\n"
                f"Minutes Writer: {data.get('minutes_writer_name')}\n\n"
                "Reply 'confirm' to create this meeting, or 'cancel' to stop."
            )
        }

    if step == "confirm":
        if _lower(question) in ["confirm", "yes", "create", "ok", "okay"]:
            try:
                meeting = _submit_management_meeting_from_ai(
                    data,
                    user_context=user_context
                )

                return {
                    "handled": True,
                    "answer": (
                        "Management group meeting has been scheduled successfully.\n\n"
                        f"Meeting ID: {meeting.get('meeting_id')}\n"
                        f"Group: {meeting.get('group_name')}\n"
                        f"Agenda: {meeting.get('agenda')}\n"
                        f"Date/Time: {meeting.get('date_time')}\n"
                        f"Minutes Writer: {meeting.get('minutes_writer')}\n\n"
                        "The group members have been notified."
                    )
                }

            except Exception as error:
                return {
                    "handled": True,
                    "answer": (
                        "I could not create the meeting right now.\n\n"
                        f"Reason: {_safe_action_error(error, 'The meeting could not be created safely.')}\n\n"
                        "Please check the selected management group and try again."
                    )
                }

        if _lower(question) in ["cancel", "no", "stop"]:
            clear_pending_action(user_context)

            return {
                "handled": True,
                "answer": "Meeting setup cancelled."
            }

    return {
        "handled": True,
        "answer": "I am still collecting your meeting details. Please continue with the requested information."
    }

def _reminder_timezone(user_context=None):
    user_context = user_context or {}
    tenant = user_context.get("tenant") or {}
    tz_name = _safe_str(
        user_context.get("timezone")
        or tenant.get("timezone")
        or os.getenv("AI_DEFAULT_TIMEZONE", "Asia/Kolkata")
    ) or "Asia/Kolkata"

    try:
        return tz_name, ZoneInfo(tz_name)
    except Exception:
        # Windows/Python installations without the IANA tzdata package can still
        # schedule correctly for the HRMS default timezone without crashing.
        return "Asia/Kolkata", timezone(timedelta(hours=5, minutes=30))


def _parse_reminder_schedule(value, user_context=None):
    """Parse the common reminder date/time forms supported by Saya today."""
    raw = _safe_str(value)
    if not raw:
        return {"valid": False, "message": "Please provide a reminder date and time."}

    tz_name, tz = _reminder_timezone(user_context)
    now = datetime.now(tz)
    clean = re.sub(r"\s+", " ", raw.lower()).strip()

    target_date = None
    if "tomorrow" in clean:
        target_date = (now + timedelta(days=1)).date()
    elif "today" in clean:
        target_date = now.date()

    if target_date is None:
        iso_match = re.search(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", clean)
        slash_match = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b", clean)
        month_match = re.search(
            r"\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?\b",
            clean,
        )

        try:
            if iso_match:
                target_date = date(int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3)))
            elif slash_match:
                target_date = date(int(slash_match.group(3)), int(slash_match.group(2)), int(slash_match.group(1)))
            elif month_match:
                months = {
                    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
                    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
                }
                month_no = months[month_match.group(2)[:3]]
                year = int(month_match.group(3) or now.year)
                target_date = date(year, month_no, int(month_match.group(1)))
                if not month_match.group(3) and target_date < now.date():
                    target_date = date(year + 1, month_no, int(month_match.group(1)))
        except ValueError:
            return {"valid": False, "message": "That reminder date is not valid. Please provide a valid date."}

    time_match = re.search(r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", clean)
    time_24_match = re.search(r"\bat\s+(\d{1,2}):(\d{2})\b", clean) if not time_match else None

    hour = minute = None
    if time_match:
        hour = int(time_match.group(1))
        minute = int(time_match.group(2) or 0)
        meridiem = time_match.group(3)
        if hour < 1 or hour > 12 or minute > 59:
            return {"valid": False, "message": "That reminder time is not valid."}
        if meridiem == "am":
            hour = 0 if hour == 12 else hour
        else:
            hour = 12 if hour == 12 else hour + 12
    elif time_24_match:
        hour = int(time_24_match.group(1))
        minute = int(time_24_match.group(2))
        if hour > 23 or minute > 59:
            return {"valid": False, "message": "That reminder time is not valid."}

    if target_date is None or hour is None:
        return {
            "valid": False,
            "message": (
                "I need both a clear date and time for the reminder. "
                "For example: tomorrow at 10 AM, or 15 September 2026 at 4 PM."
            ),
        }

    scheduled_local = datetime(
        target_date.year,
        target_date.month,
        target_date.day,
        hour,
        minute,
        tzinfo=tz,
    )

    if scheduled_local <= now:
        return {"valid": False, "message": "The reminder time must be in the future."}

    return {
        "valid": True,
        "timezone": tz_name,
        "scheduled_at": scheduled_local,
        "scheduled_at_utc": scheduled_local.astimezone(timezone.utc),
        "display": scheduled_local.strftime("%d %B %Y at %I:%M %p"),
    }


def _submit_reminder_from_ai(data, user_context=None):
    access_error = _action_access_error("create_reminder", user_context)
    if access_error:
        raise RuntimeError(access_error)

    db = get_db()

    tenant_id = _tenant_id(user_context)
    user_key = _user_key(user_context)
    employee_id = _employee_id(user_context)

    reminder_text = _safe_str(data.get("reminder_text"))
    reminder_time_text = _safe_str(data.get("reminder_time_text"))

    if len(reminder_text) < 2:
        raise RuntimeError("Please provide a valid reminder message.")

    schedule = _parse_reminder_schedule(reminder_time_text, user_context=user_context)
    if not schedule.get("valid"):
        raise RuntimeError(schedule.get("message") or "Please provide a valid reminder date and time.")

    reminder_doc = {
        "tenant_id": tenant_id,
        "user_id": user_key,
        "employee_id": employee_id,
        "title": "Saya Reminder",
        "message": reminder_text,
        "reminder_text": reminder_text,
        "reminder_time_text": reminder_time_text,
        "scheduled_at": schedule.get("scheduled_at"),
        "scheduled_at_utc": schedule.get("scheduled_at_utc"),
        "timezone": schedule.get("timezone"),
        "status": "scheduled",
        "source": "ai_assistant",
        "is_completed": False,
        "is_read": False,
        "read": False,
        # There is no reminder worker in the current codebase yet. This flag
        # prevents the assistant from claiming timed delivery is already active.
        "delivery_status": "awaiting_worker",
        "created_by": user_key,
        "created_at": _now_utc(),
        "updated_at": _now_utc(),
    }

    result = db.ai_reminders.insert_one(reminder_doc)

    _create_notification_safe(
        tenant_id=tenant_id,
        user_id=user_key,
        title="Reminder Saved",
        message=(
            f"Reminder saved for {schedule.get('display')}: {reminder_text}. "
            "Timed reminder delivery is not active yet."
        ),
        notification_type="ai_reminder_created",
    )

    _create_ai_audit_log(
        user_context=user_context,
        action_type="create_reminder",
        status="success",
        message="Reminder schedule saved through AI Assistant.",
        metadata={
            "reminder_id": str(result.inserted_id),
            "reminder_text": reminder_text,
            "reminder_time_text": reminder_time_text,
            "scheduled_at_utc": schedule.get("scheduled_at_utc").isoformat(),
            "timezone": schedule.get("timezone"),
            "delivery_status": "awaiting_worker",
        },
    )

    clear_pending_action(user_context)

    return {
        "reminder_id": str(result.inserted_id),
        "reminder_text": reminder_text,
        "reminder_time_text": reminder_time_text,
        "scheduled_at": schedule.get("scheduled_at").isoformat(),
        "scheduled_at_utc": schedule.get("scheduled_at_utc").isoformat(),
        "timezone": schedule.get("timezone"),
        "display_time": schedule.get("display"),
        "delivery_status": "awaiting_worker",
    }

def _reminder_start(user_context=None):
    access_error = _action_access_error("create_reminder", user_context)
    if access_error:
        return {"handled": True, "answer": access_error}

    save_pending_action(
        user_context=user_context,
        action_type="create_reminder",
        data={},
        current_step="reminder_text"
    )

    return {
        "handled": True,
        "answer": (
            "Sure, I can help you create a reminder.\n\n"
            "What should I remind you about?"
        )
    }


def _reminder_continue(pending, question, user_context=None):
    data = pending.get("data") or {}
    step = pending.get("current_step")

    if step == "reminder_text":
        data["reminder_text"] = _safe_str(question)

        save_pending_action(
            user_context=user_context,
            action_type="create_reminder",
            data=data,
            current_step="reminder_time"
        )

        return {
            "handled": True,
            "answer": (
                "Reminder note saved.\n\n"
                "When should I remind you?\n"
                "Example: tomorrow at 10 AM, or 15 June 2026 at 4 PM."
            )
        }

    if step == "reminder_time":
        data["reminder_time_text"] = _safe_str(question)
        schedule = _parse_reminder_schedule(data["reminder_time_text"], user_context=user_context)

        if not schedule.get("valid"):
            return {
                "handled": True,
                "answer": schedule.get("message") or "Please provide a valid reminder date and time.",
            }

        data["scheduled_at"] = schedule.get("scheduled_at").isoformat()
        data["scheduled_at_utc"] = schedule.get("scheduled_at_utc").isoformat()
        data["timezone"] = schedule.get("timezone")
        data["display_time"] = schedule.get("display")

        save_pending_action(
            user_context=user_context,
            action_type="create_reminder",
            data=data,
            current_step="confirm"
        )

        return {
            "handled": True,
            "answer": (
                "Please review your reminder:\n\n"
                f"Reminder: {data.get('reminder_text')}\n"
                f"Scheduled for: {data.get('display_time')} ({data.get('timezone')})\n\n"
                "Reply 'confirm' to save this reminder schedule, or 'cancel' to stop."
            )
        }

    if step == "confirm":
        if _lower(question) in ["confirm", "yes", "create", "ok", "okay"]:
            try:
                reminder = _submit_reminder_from_ai(
                    data,
                    user_context=user_context
                )

                return {
                    "handled": True,
                    "answer": (
                        "Your reminder schedule has been saved successfully.\n\n"
                        f"Reminder ID: {reminder.get('reminder_id')}\n"
                        f"Reminder: {reminder.get('reminder_text')}\n"
                        f"Scheduled for: {reminder.get('display_time')} ({reminder.get('timezone')})\n\n"
                        "Important: this codebase does not yet have the background reminder worker that sends the notification at the scheduled time. "
                        "The schedule is stored correctly and will become active when that worker is connected."
                    )
                }

            except Exception as error:
                return {
                    "handled": True,
                    "answer": (
                        "I could not save the reminder right now.\n\n"
                        f"Reason: {_safe_action_error(error, 'The reminder could not be saved safely.')}\n\n"
                        "Please review the reminder details and try again."
                    )
                }

        if _lower(question) in ["cancel", "no", "stop"]:
            clear_pending_action(user_context)

            return {
                "handled": True,
                "answer": "Reminder setup cancelled."
            }

    return {
        "handled": True,
        "answer": "I am still collecting your reminder details. Please continue with the requested information."
    }



# ---------------------------------------------------------------------------
# AI Attendance Actions: Check-in / Check-out
# ---------------------------------------------------------------------------

def _strip_assistant_wake_words(value):
    """
    FILE_FOUR_SAYA_ACTION_WAKE_FIX
    Removes Saya/Eve wake phrase if the backend receives the full voice text.
    Example: "hey saya check in" -> "check in".
    """
    clean = str(value or "").strip().lower()

    if not clean:
        return ""

    wake_phrases = [
        "hey saya",
        "hi saya",
        "hello saya",
        "okay saya",
        "ok saya",
        "saya",
        "saaya",
        "saiya",
        "saiyaa",
        "sayaa",
        "say a",
        "sayaah",
        "saiyaah",
        "hey saaya",
        "hi saaya",
        "hello saaya",
        "hey saiya",
        "hi saiya",
        "hello saiya",
        "hey sayaa",
        "hi sayaa",
        "hello sayaa",

        # Temporary legacy Eve support.
        "hey eve",
        "hi eve",
        "hello eve",
        "okay eve",
        "ok eve",
        "eve",
        "evie",
        "eevee",
    ]

    for phrase in sorted(wake_phrases, key=len, reverse=True):
        if clean == phrase:
            return ""

        prefix = f"{phrase} "

        if clean.startswith(prefix):
            return clean[len(prefix):].strip()

    return clean


def _detect_attendance_action_intent(question):
    """
    Detects Saya attendance commands before the normal AI knowledge fallback.

    Supported examples:
    - Hey Saya check in
    - Legacy supported temporarily: Hey Eve check in
    - Please punch in
    - Mark my attendance
    - Check out
    - Punch out
    """

    clean = _strip_assistant_wake_words(_normalize_option_text(_strip_voice_instruction_suffix(question)))

    if not clean:
        return ""

    check_out_phrases = {
        "check out",
        "checkout",
        "punch out",
        "clock out",
        "mark checkout",
        "mark check out",
        "end attendance",
        "close attendance",
        "office out",
        "i want to check out",
        "please check out",
        "please checkout",
        "please punch out",
    }

    check_in_phrases = {
        "check in",
        "checkin",
        "punch in",
        "clock in",
        "mark attendance",
        "mark my attendance",
        "start attendance",
        "office in",
        "i want to check in",
        "please check in",
        "please checkin",
        "please punch in",
    }

    if any(phrase in clean for phrase in check_out_phrases):
        return "attendance_check_out"

    if any(phrase in clean for phrase in check_in_phrases):
        return "attendance_check_in"

    # Voice STT may hear "checking" / "checkout" differently.
    if "attendance" in clean and any(word in clean for word in ["mark", "start", "begin"]):
        return "attendance_check_in"

    if "attendance" in clean and any(word in clean for word in ["end", "close", "finish"]):
        return "attendance_check_out"

    return ""


def _request_json_payload_safe():
    try:
        from flask import request

        return request.get_json(silent=True) or {}
    except Exception:
        return {}


def _request_current_user_safe():
    try:
        from flask import g

        return getattr(g, "current_user", {}) or {}
    except Exception:
        return {}


def _float_or_none(value):
    if value in [None, ""]:
        return None

    try:
        return float(value)
    except Exception:
        return None


def _attendance_location_from_payload(payload=None, fallback_data=None):
    payload = payload or _request_json_payload_safe()
    fallback_data = fallback_data or {}

    client_context = payload.get("client_context") if isinstance(payload.get("client_context"), dict) else {}

    source = (
        fallback_data.get("location")
        or fallback_data.get("attendance_location")
        or payload.get("attendance_location")
        or client_context.get("attendance_location")
        or payload.get("location")
        or client_context.get("location")
        or {}
    )

    if not isinstance(source, dict):
        source = {}

    latitude = _float_or_none(
        source.get("latitude")
        or source.get("lat")
        or fallback_data.get("latitude")
        or payload.get("latitude")
        or client_context.get("latitude")
    )
    longitude = _float_or_none(
        source.get("longitude")
        or source.get("lng")
        or source.get("lon")
        or fallback_data.get("longitude")
        or payload.get("longitude")
        or client_context.get("longitude")
    )
    accuracy = _float_or_none(
        source.get("accuracy")
        or fallback_data.get("accuracy")
        or payload.get("accuracy")
        or client_context.get("accuracy")
    )

    address = _safe_str(
        source.get("address")
        or source.get("location_address")
        or fallback_data.get("address")
        or payload.get("address")
        or client_context.get("address")
    )

    return {
        "latitude": latitude,
        "longitude": longitude,
        "accuracy": accuracy,
        "address": address,
        "source": source.get("source") or "ai_assistant",
    }


def _attendance_location_available(location):
    return bool(
        isinstance(location, dict)
        and location.get("latitude") is not None
        and location.get("longitude") is not None
    )


def _attendance_mode_from_text(question):
    clean = _normalize_option_text(question)

    if any(phrase in clean for phrase in ["work from home", "wfh", "home attendance"]):
        return "wfh"

    # Field attendance needs field place and photo in the native route.
    # Eve uses office mode by default to avoid bypassing those proofs.
    return "office"


def _attendance_employee(user_context=None):
    employee = _current_employee_for_ai_action(user_context)

    if not employee:
        raise RuntimeError("Employee profile was not found for this login.")

    return employee


def _attendance_tenant_id(employee=None, user_context=None):
    employee = employee or {}

    tenant_id = employee.get("tenant_id") or _tenant_id(user_context)
    if not tenant_id:
        raise RuntimeError(
            "Your organisation context could not be verified for attendance. Please sign in again."
        )

    return tenant_id


def _attendance_employee_org_name(employee):
    employee = employee or {}

    return _safe_str(
        employee.get("organisation")
        or employee.get("organization")
        or employee.get("organisation_name")
        or employee.get("organization_name")
    )


def _attendance_employee_org_code(employee):
    employee = employee or {}

    return _safe_str(
        employee.get("organisation_code")
        or employee.get("organization_code")
    ).upper()


def _attendance_employee_state(employee):
    employee = employee or {}

    state = _safe_str(
        employee.get("state")
        or employee.get("branch")
        or employee.get("work_state")
        or "Assam(HO)"
    )

    lowered = state.lower()

    if lowered in ["assam", "assam ho", "assam(ho)", "ho", "assam/guwahati (ho)"]:
        return "Assam(HO)"

    return state or "Assam(HO)"


def _attendance_employee_name(employee):
    employee = employee or {}

    return (
        employee.get("name")
        or employee.get("employee_name")
        or employee.get("full_name")
        or employee.get("email")
        or "Employee"
    )


def _attendance_employee_code(employee):
    employee = employee or {}

    return (
        employee.get("employee_id")
        or employee.get("emp_code")
        or employee.get("code")
        or ""
    )


def _attendance_now_local():
    try:
        from app.routes.attendance import now_local

        return now_local()
    except Exception:
        return datetime.utcnow() + timedelta(minutes=330)


def _attendance_holiday_info(db, employee, attendance_date):
    try:
        from app.routes.attendance import holiday_info_for_employee

        return holiday_info_for_employee(db, employee, attendance_date)
    except Exception:
        return {
            "is_holiday": False,
            "holiday_type": "",
            "state": _attendance_employee_state(employee),
            "title": "",
            "message": "",
        }


def _attendance_approved_holiday_work(db, employee, attendance_date):
    try:
        from app.routes.attendance import approved_holiday_work_request

        return approved_holiday_work_request(db, employee, attendance_date)
    except Exception:
        return None


def _attendance_pending_holiday_work(db, employee, attendance_date):
    try:
        from app.routes.attendance import pending_holiday_work_request

        return pending_holiday_work_request(db, employee, attendance_date)
    except Exception:
        return None


def _attendance_create_compoff_if_needed(db, employee, attendance_doc, holiday_info):
    try:
        from app.routes.attendance import create_compoff_if_needed

        return create_compoff_if_needed(db, employee, attendance_doc, holiday_info)
    except Exception:
        return None


def _attendance_greeting(action_type, employee_name="", is_late=False, is_early=False):
    now = _attendance_now_local()
    hour = now.hour

    if hour < 12:
        greeting = "Good morning"
    elif hour < 17:
        greeting = "Good afternoon"
    else:
        greeting = "Good evening"

    first_name = _safe_str(employee_name).split(" ")[0] if _safe_str(employee_name) else ""

    if action_type == "attendance_check_in":
        if is_late:
            return f"{greeting}{f' {first_name}' if first_name else ''}. Your late check-in is completed."
        return f"{greeting}{f' {first_name}' if first_name else ''}. Your check-in is completed."

    if is_early:
        return f"{greeting}{f' {first_name}' if first_name else ''}. Your early check-out is completed."

    return f"{greeting}{f' {first_name}' if first_name else ''}. Your check-out is completed."


def _attendance_reason_from_text(question):
    clean = _strip_voice_instruction_suffix(question)

    patterns = [
        r"\b(?:reason|because|due\s+to|as)\s+(?:is|was|:)?\s*(.+)$",
    ]

    for pattern in patterns:
        match = re.search(pattern, clean, flags=re.IGNORECASE)

        if match:
            return " ".join(_safe_str(match.group(1)).strip(" .,-:;").split())

    return _safe_str(clean)


def _attendance_schedule_context(db, tenant_id):
    from app.routes.attendance import (
        attendance_schedule_for_tenant,
        attendance_schedule_time_objects,
        format_attendance_schedule_time,
    )

    schedule = attendance_schedule_for_tenant(db, tenant_id)
    schedule_times = attendance_schedule_time_objects(schedule)

    return {
        "schedule": schedule,
        "times": schedule_times,
        "late_cutoff_label": format_attendance_schedule_time(
            schedule.get("late_cutoff_time")
        ),
        "check_out_label": format_attendance_schedule_time(
            schedule.get("check_out_time")
        ),
    }


def _attendance_late_reason_required(now, holiday_info, db, tenant_id):
    schedule_context = _attendance_schedule_context(db, tenant_id)
    return (
        now.time() >= schedule_context["times"]["late_cutoff"]
        and not holiday_info.get("is_holiday")
    )


def _attendance_early_checkout_required(now, holiday_info, db, tenant_id):
    schedule_context = _attendance_schedule_context(db, tenant_id)
    return (
        now.time() < schedule_context["times"]["check_out"]
        and not holiday_info.get("is_holiday")
    )


def _attendance_location_error_message(location):
    if not _attendance_location_available(location):
        return (
            "GPS location is required for attendance. "
            "Please allow location permission in the browser and try again."
        )

    return ""


def _submit_ai_check_in(data=None, user_context=None):
    data = data or {}
    db = get_db()

    employee = _attendance_employee(user_context)
    tenant_id = _attendance_tenant_id(employee, user_context)

    now = _attendance_now_local()
    today_date = now.date()
    today = today_date.isoformat()

    mode = data.get("mode") or "office"
    mode = _safe_str(mode).lower() or "office"

    if mode not in ["office", "wfh", "field"]:
        mode = "office"

    if mode == "field":
        raise RuntimeError(
            "Field attendance needs visit place and photo proof. Please use the Attendance page for field attendance."
        )

    location = _attendance_location_from_payload(fallback_data=data)
    location_error = _attendance_location_error_message(location)

    if location_error:
        raise RuntimeError(location_error)

    holiday_info = _attendance_holiday_info(db, employee, today_date)
    schedule_context = _attendance_schedule_context(db, tenant_id)
    attendance_schedule = schedule_context["schedule"]
    holiday_work_request = None

    if holiday_info.get("is_holiday"):
        holiday_work_request = _attendance_approved_holiday_work(db, employee, today_date)

        if not holiday_work_request:
            pending_request = _attendance_pending_holiday_work(db, employee, today_date)
            if pending_request:
                raise RuntimeError("Holiday attendance requires approved holiday work request. Your request is still pending.")
            raise RuntimeError("Holiday attendance requires approved holiday work request.")

    is_late = _attendance_late_reason_required(now, holiday_info, db, tenant_id)
    late_reason = _safe_str(data.get("late_reason") or data.get("reason"))

    if is_late and not late_reason:
        raise RuntimeError(
            f"Late reason is required from {schedule_context['late_cutoff_label']} onwards."
        )

    old = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "date": today,
        "is_deleted": {"$ne": True},
    })

    if old and old.get("check_in"):
        return {
            "already_done": True,
            "message": "You are already checked in today.",
            "attendance": old,
            "is_late": bool(old.get("is_late")),
        }

    status = "present"

    if holiday_info.get("is_holiday"):
        status = "holiday_work"
    elif is_late:
        status = "late"

    doc = {
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "employee_code": _attendance_employee_code(employee),
        "emp_code": employee.get("emp_code", ""),
        "employee_name": _attendance_employee_name(employee),
        "department": employee.get("department", ""),
        "designation": employee.get("designation", ""),
        "organisation": _attendance_employee_org_name(employee),
        "organization": _attendance_employee_org_name(employee),
        "organisation_name": _attendance_employee_org_name(employee),
        "organization_name": _attendance_employee_org_name(employee),
        "organisation_code": _attendance_employee_org_code(employee),
        "organization_code": _attendance_employee_org_code(employee),
        "state": _attendance_employee_state(employee),
        "team_leader_id": employee.get("team_leader_id", ""),
        "team_leader_name": employee.get("team_leader_name", ""),
        "reporting_officer_id": employee.get("reporting_officer_id", ""),
        "reporting_officer_name": employee.get("reporting_officer_name", ""),

        "date": today,
        "check_in": now,
        "check_out": None,

        "office_start": attendance_schedule["check_in_time"],
        "late_cutoff": attendance_schedule["late_cutoff_time"],
        "break_start": attendance_schedule["break_start_time"],
        "break_end": attendance_schedule["break_end_time"],
        "office_end": attendance_schedule["check_out_time"],

        "mode": mode,
        "field_location": "",
        "field_photo": "",
        "field_photo_url": "",
        "late_reason": late_reason,
        "early_checkout_reason": "",

        "check_in_location": location,
        "check_out_location": None,
        "location_accuracy_warning": bool(
            location.get("accuracy")
            and float(location.get("accuracy")) > 60
        ),

        "is_late": is_late,
        "is_early_checkout": False,
        "is_holiday_work": bool(holiday_info.get("is_holiday")),
        "holiday_title": holiday_info.get("title", ""),
        "holiday_type": holiday_info.get("holiday_type", ""),
        "holiday_message": holiday_info.get("message", ""),
        "holiday_work_request_id": str(holiday_work_request.get("_id")) if holiday_work_request else "",
        "status": status,
        "verified_by_ro": False,

        "created_offline": False,
        "check_in_created_offline": False,
        "offline_marked_at": None,
        "check_in_offline_marked_at": None,
        "client_attendance_id": "",
        "client_check_in_id": "",
        "client_attendance_ids": [],
        "synced_at": None,
        "sync_source": "ai_assistant",

        "timeline": [
            {
                "type": "check_in",
                "time": now,
                "note": f"{mode.upper()} check-in through AI Assistant",
                "location": location,
                "field_location": "",
                "created_offline": False,
                "offline_marked_at": None,
                "synced_at": None,
                "client_attendance_id": "",
            }
        ],

        "created_at": now,
        "updated_at": now,
    }

    result = db.attendance_logs.insert_one(doc)
    doc["_id"] = result.inserted_id

    _create_ai_audit_log(
        user_context=user_context,
        action_type="attendance_check_in",
        status="success",
        message="Attendance check-in completed through AI Assistant.",
        metadata={
            "attendance_id": str(result.inserted_id),
            "date": today,
            "is_late": is_late,
            "mode": mode,
        },
    )

    clear_pending_action(user_context)

    return {
        "already_done": False,
        "attendance": doc,
        "is_late": is_late,
        "message": _attendance_greeting(
            "attendance_check_in",
            _attendance_employee_name(employee),
            is_late=is_late,
        ),
    }


def _submit_ai_check_out(data=None, user_context=None):
    data = data or {}
    db = get_db()

    employee = _attendance_employee(user_context)
    tenant_id = _attendance_tenant_id(employee, user_context)

    now = _attendance_now_local()
    today_date = now.date()
    today = today_date.isoformat()

    location = _attendance_location_from_payload(fallback_data=data)
    location_error = _attendance_location_error_message(location)

    if location_error:
        raise RuntimeError(location_error)

    rec = db.attendance_logs.find_one({
        "tenant_id": tenant_id,
        "employee_id": str(employee["_id"]),
        "date": today,
        "is_deleted": {"$ne": True},
    })

    if not rec:
        raise RuntimeError("Please check in first.")

    if rec.get("check_out"):
        return {
            "already_done": True,
            "message": "You are already checked out today.",
            "attendance": rec,
            "is_early_checkout": bool(rec.get("is_early_checkout")),
        }

    holiday_info = _attendance_holiday_info(db, employee, today_date)
    schedule_context = _attendance_schedule_context(db, tenant_id)
    is_early_checkout = _attendance_early_checkout_required(
        now,
        holiday_info,
        db,
        tenant_id,
    )

    early_checkout_reason = _safe_str(
        data.get("early_checkout_reason")
        or data.get("reason")
    )

    if is_early_checkout and not early_checkout_reason:
        raise RuntimeError(
            f"Early checkout reason is required before {schedule_context['check_out_label']}."
        )

    update_data = {
        "check_out": now,
        "check_out_location": location,
        "checkout_location_accuracy_warning": bool(
            location.get("accuracy")
            and float(location.get("accuracy")) > 60
        ),
        "is_early_checkout": is_early_checkout,
        "early_checkout_reason": early_checkout_reason,
        "updated_at": now,

        "check_out_created_offline": False,
        "check_out_offline_marked_at": None,
        "client_check_out_id": "",
        "synced_at": rec.get("synced_at"),
        "sync_source": rec.get("sync_source", "ai_assistant"),
    }

    if rec.get("status") == "present" and is_early_checkout:
        update_data["status"] = "early_checkout"

    db.attendance_logs.update_one(
        {"_id": rec["_id"]},
        {
            "$set": update_data,
            "$push": {
                "timeline": {
                    "type": "check_out",
                    "time": now,
                    "note": "Day closed through AI Assistant",
                    "location": location,
                    "created_offline": False,
                    "offline_marked_at": None,
                    "synced_at": None,
                    "client_attendance_id": "",
                }
            },
        },
    )

    updated = db.attendance_logs.find_one({"_id": rec["_id"]})

    if updated and updated.get("is_holiday_work"):
        _attendance_create_compoff_if_needed(db, employee, updated, holiday_info)

    _create_ai_audit_log(
        user_context=user_context,
        action_type="attendance_check_out",
        status="success",
        message="Attendance check-out completed through AI Assistant.",
        metadata={
            "attendance_id": str(rec["_id"]),
            "date": today,
            "is_early_checkout": is_early_checkout,
        },
    )

    clear_pending_action(user_context)

    return {
        "already_done": False,
        "attendance": updated,
        "is_early_checkout": is_early_checkout,
        "message": _attendance_greeting(
            "attendance_check_out",
            _attendance_employee_name(employee),
            is_early=is_early_checkout,
        ),
    }


def _attendance_start(action_type, question="", user_context=None):
    access_error = _action_access_error(action_type, user_context)
    if access_error:
        return {"handled": True, "answer": access_error}

    clean_question = _strip_voice_instruction_suffix(question)
    now = _attendance_now_local()
    db = get_db()
    employee = _attendance_employee(user_context)
    tenant_id = _attendance_tenant_id(employee, user_context)
    holiday_info = _attendance_holiday_info(db, employee, now.date())
    location = _attendance_location_from_payload()

    data = {
        "mode": _attendance_mode_from_text(clean_question),
        "location": location,
        "attendance_location": location,
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "accuracy": location.get("accuracy"),
    }

    reason = _attendance_reason_from_text(clean_question)

    # Avoid treating the command itself as a reason.
    command_like_reasons = {
        "check in",
        "please check in",
        "check out",
        "please check out",
        "punch in",
        "punch out",
        "mark attendance",
        "mark my attendance",
    }

    if _normalize_option_text(reason) in command_like_reasons:
        reason = ""

    if action_type == "attendance_check_in":
        if _attendance_late_reason_required(now, holiday_info, db, tenant_id) and not reason:
            save_pending_action(
                user_context=user_context,
                action_type="attendance_check_in",
                data=data,
                current_step="late_reason",
            )

            return {
                "handled": True,
                "answer": "You are late today. Please tell me the late check-in reason."
            }

        if reason:
            data["late_reason"] = reason
            data["reason"] = reason

        try:
            result = _submit_ai_check_in(data, user_context=user_context)

            return {
                "handled": True,
                "answer": result.get("message") or "Your check-in is completed."
            }
        except Exception as error:
            return {
                "handled": True,
                "answer": _safe_action_error(
                    error,
                    "I could not complete the attendance action safely. Please try again."
                )
            }

    if action_type == "attendance_check_out":
        # The existing attendance route requires check-in first. If check-in is missing,
        # submit function will return that exact error.
        if _attendance_early_checkout_required(now, holiday_info, db, tenant_id) and not reason:
            save_pending_action(
                user_context=user_context,
                action_type="attendance_check_out",
                data=data,
                current_step="early_checkout_reason",
            )

            return {
                "handled": True,
                "answer": "You are checking out early. Please tell me the early check-out reason."
            }

        if reason:
            data["early_checkout_reason"] = reason
            data["reason"] = reason

        try:
            result = _submit_ai_check_out(data, user_context=user_context)

            return {
                "handled": True,
                "answer": result.get("message") or "Your check-out is completed."
            }
        except Exception as error:
            return {
                "handled": True,
                "answer": _safe_action_error(
                    error,
                    "I could not complete the attendance action safely. Please try again."
                )
            }

    return {
        "handled": False,
        "answer": "",
    }


def _attendance_continue(pending, question, user_context=None):
    data = pending.get("data") or {}
    step = pending.get("current_step")
    action_type = pending.get("action_type")

    reason = _attendance_reason_from_text(question)

    if not reason or len(reason) < 3:
        if step == "late_reason":
            return {
                "handled": True,
                "answer": "Please tell me a valid late check-in reason."
            }

        return {
            "handled": True,
            "answer": "Please tell me a valid early check-out reason."
        }

    if action_type == "attendance_check_in":
        data["late_reason"] = reason
        data["reason"] = reason

        try:
            result = _submit_ai_check_in(data, user_context=user_context)

            return {
                "handled": True,
                "answer": result.get("message") or "Your check-in is completed."
            }
        except Exception as error:
            clear_pending_action(user_context)

            return {
                "handled": True,
                "answer": _safe_action_error(
                    error,
                    "I could not complete the attendance action safely. Please try again."
                )
            }

    if action_type == "attendance_check_out":
        data["early_checkout_reason"] = reason
        data["reason"] = reason

        try:
            result = _submit_ai_check_out(data, user_context=user_context)

            return {
                "handled": True,
                "answer": result.get("message") or "Your check-out is completed."
            }
        except Exception as error:
            clear_pending_action(user_context)

            return {
                "handled": True,
                "answer": _safe_action_error(
                    error,
                    "I could not complete the attendance action safely. Please try again."
                )
            }

    clear_pending_action(user_context)

    return {
        "handled": True,
        "answer": "I cleared the incomplete attendance action. Please try again."
    }


def _looks_like_new_normal_question(question):
    """
    If a guided action is pending, but the user asks a normal HRMS question,
    we should not force that question into the old pending flow.
    """

    text = _lower(question)

    normal_question_keywords = [
        "how to",
        "what is",
        "what are",
        "show",
        "list",
        "any notification",
        "notifications",
        "how many",
        "cl left",
        "el left",
        "leave balance",
        "assets",
        "asset",
        "attendance",
        "performance",
        "project",
        "projects",
        "weather",
        "company",
        "tenant",
        "policy",
        "policies",
        "status",
        "approved",
        "where is",
    ]

    is_question_like = (
        "?" in text
        or text.startswith((
            "how ",
            "what ",
            "when ",
            "where ",
            "why ",
            "show ",
            "list ",
            "tell me ",
        ))
    )

    return is_question_like and any(keyword in text for keyword in normal_question_keywords)


def _handle_guided_action_legacy(question, user_context=None):
    """
    Handles multi-turn guided actions.
    This function must not trap every normal chatbot question inside an old action.
    It also restarts the guided flow if the user clearly starts the same action again.
    """

    clean_question = _strip_voice_instruction_suffix(question)

    if not clean_question:
        return {
            "handled": False,
            "answer": "",
        }

    intent = detect_action_intent(clean_question)
    pending = get_pending_action(user_context)

    if intent == "cancel":
        clear_pending_action(user_context)

        return {
            "handled": True,
            "answer": "Okay, I have cancelled the current assistant action setup."
        }

    # NEW FIX:
    # If a guided action is already pending and user again says
    # "I want to apply leave" / "schedule meeting" / "remind me",
    # restart that flow from the beginning instead of showing:
    # "I am still collecting your details."
    if pending and intent:
        pending_action_type = pending.get("action_type")
        pending_step = pending.get("current_step")

        # At final leave confirmation, phrases such as
        # "apply leave", "please submit", and "submit it" must submit the
        # prepared request, not restart the leave form.
        if (
            pending_action_type == "apply_leave"
            and pending_step == "confirm"
            and (
                _looks_like_leave_submit_confirmation(clean_question)
                or _looks_like_cancel_confirmation(clean_question)
            )
        ):
            return _apply_leave_continue(pending, clean_question, user_context=user_context)

        clear_pending_action(user_context)

        if intent == "apply_leave":
            return _apply_leave_start(user_context=user_context, question=clean_question)

        if intent == "schedule_management_meeting":
            return _meeting_start(user_context=user_context)

        if intent == "create_reminder":
            return _reminder_start(user_context=user_context)

        if intent in ["attendance_check_in", "attendance_check_out"]:
            return _attendance_start(intent, question=clean_question, user_context=user_context)

    # If a pending guided action exists but the user asks a normal unrelated
    # question, cancel the stale flow and let the normal AI/capability system
    # answer. Explicit leave-flow information requests are the exception:
    # "show my projects", "show my team members", "show leave types", or a
    # leave-balance question should answer in place without losing the leave form.
    if pending and not intent and _looks_like_new_normal_question(clean_question):
        is_leave_flow_info_request = (
            pending.get("action_type") == "apply_leave"
            and _looks_like_leave_flow_info_request(clean_question)
        )

        if not is_leave_flow_info_request:
            clear_pending_action(user_context)

            return {
                "handled": False,
                "answer": "",
            }

    if pending:
        action_type = pending.get("action_type")

        if action_type == "apply_leave":
            return _apply_leave_continue(pending, clean_question, user_context=user_context)

        if action_type == "schedule_management_meeting":
            return _meeting_continue(pending, clean_question, user_context=user_context)

        if action_type == "create_reminder":
            return _reminder_continue(pending, clean_question, user_context=user_context)

        if action_type in ["attendance_check_in", "attendance_check_out"]:
            return _attendance_continue(pending, clean_question, user_context=user_context)

        # Safety fallback for corrupted/unknown pending actions.
        clear_pending_action(user_context)

        return {
            "handled": True,
            "answer": (
                "I found an incomplete assistant action and cleared it safely.\n\n"
                "Please start again. For example, say: I want to apply leave."
            )
        }

    if intent == "apply_leave":
            return _apply_leave_start(user_context=user_context, question=clean_question)

    if intent == "schedule_management_meeting":
        return _meeting_start(user_context=user_context)

    if intent == "create_reminder":
        return _reminder_start(user_context=user_context)

    if intent in ["attendance_check_in", "attendance_check_out"]:
        return _attendance_start(intent, question=clean_question, user_context=user_context)

    return {
        "handled": False,
        "answer": "",
    }

def handle_guided_action(question, user_context=None):
    """Public Saya action-engine entrypoint with lazy module-plugin dispatch."""
    _ensure_saya_action_plugins_loaded()
    clean_question = _strip_voice_instruction_suffix(question)
    pending_before = get_pending_action(user_context)
    pending_action = _safe_str((pending_before or {}).get("action_type"))

    # Continue a registered plugin action deterministically.  Short replies such
    # as "yes", dates, names and reasons must not be sent through a fresh LLM
    # classification while a guided workflow is already active.
    if pending_before and pending_action in SAYA_ACTION_HANDLERS:
        normalized = _lower(clean_question)
        cancel_phrases = {
            "cancel", "stop", "cancel this", "stop this", "clear action",
            "forget this", "exit", "exit action", "never mind", "nevermind",
        }
        if normalized in cancel_phrases:
            clear_pending_action(user_context)
            return _decorate_action_result(
                {"handled": True, "answer": "The pending Saya action has been cancelled."},
                action_type=pending_action,
                status="cancelled",
            )
        return _run_plugin_continue(pending_before, clean_question, user_context=user_context)

    intent = detect_action_intent(clean_question)

    # New module-specific action/read capability.
    if intent in SAYA_ACTION_HANDLERS:
        return _run_plugin_start(intent, clean_question, user_context=user_context)

    effective_action = intent or pending_action
    if effective_action and effective_action != "cancel":
        access_error = _action_access_error(effective_action, user_context)
        if access_error:
            if pending_before:
                clear_pending_action(user_context)
            return _decorate_action_result(
                {"handled": True, "answer": access_error},
                action_type=effective_action,
                status="blocked",
            )

    # Preserve all proven Employee legacy flows (leave, attendance, meeting,
    # reminder) exactly as before.
    result = _handle_guided_action_legacy(question, user_context=user_context)

    pending_after = get_pending_action(user_context)
    action_after = _safe_str((pending_after or {}).get("action_type"))
    step_after = _safe_str((pending_after or {}).get("current_step"))
    resolved_action = action_after or ("" if intent == "cancel" else effective_action)

    if not result.get("handled"):
        return _decorate_action_result(
            result,
            action_type=resolved_action,
            step=step_after,
            status="not_handled",
        )

    answer_text = _lower(result.get("answer"))
    if intent == "cancel" or "cancelled" in answer_text or "canceled" in answer_text:
        status = "cancelled"
    elif pending_after:
        status = "awaiting_confirmation" if step_after == "confirm" else "collecting"
    else:
        completion_markers = (
            "successfully", "has been scheduled", "has been submitted",
            "request has been sent", "checked in", "checked out",
            "already checked in", "already checked out", "schedule has been saved",
        )
        status = (
            "completed"
            if resolved_action and any(marker in answer_text for marker in completion_markers)
            else "handled"
        )

    return _decorate_action_result(
        result,
        action_type=resolved_action,
        step=step_after,
        status=status,
    )


# Load plugins lazily on the first action request.  Do not import them eagerly
# during Flask module discovery because each plugin imports this core service.
