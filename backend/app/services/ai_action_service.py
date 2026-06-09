from datetime import date, datetime, timezone, timedelta

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

    query = {
        "user_key": user_key,
        "status": "collecting",
    }

    if tenant_id:
        query["tenant_id"] = tenant_id

    return query


def get_pending_action(user_context=None):
    user_key = _user_key(user_context)

    if not user_key:
        return None

    db = get_db()

    return db[ACTION_COLLECTION].find_one(
        _pending_action_query(user_context),
        sort=[("updated_at", -1), ("_id", -1)]
    )


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
                "updated_at": _now_utc(),
            }
        }
    )


def save_pending_action(user_context=None, action_type="", data=None, current_step=""):
    db = get_db()

    user_key = _user_key(user_context)

    if not user_key:
        return None

    tenant_id = _tenant_id(user_context)

    payload = {
        "tenant_id": tenant_id,
        "user_key": user_key,
        "employee_id": _employee_id(user_context),
        "action_type": action_type,
        "data": data or {},
        "current_step": current_step,
        "status": "collecting",
        "updated_at": _now_utc(),
    }

    existing = get_pending_action(user_context)

    if existing:
        db[ACTION_COLLECTION].update_one(
            {"_id": existing["_id"]},
            {
                "$set": payload,
                "$setOnInsert": {
                    "created_at": _now_utc(),
                }
            },
            upsert=True
        )

        return db[ACTION_COLLECTION].find_one({"_id": existing["_id"]})

    payload["created_at"] = _now_utc()

    inserted = db[ACTION_COLLECTION].insert_one(payload)

    return db[ACTION_COLLECTION].find_one({"_id": inserted.inserted_id})


def detect_action_intent(question):
    text = _lower(question)

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
    ]

    if any(phrase in text for phrase in info_question_phrases):
        return ""

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

    # Start leave guided flow only when user clearly wants to submit/apply.
    if any(word in text for word in [
        "i want to apply leave",
        "i need to apply leave",
        "i want leave",
        "i need leave",
        "apply for leave",
        "request leave now",
        "submit leave request",
        "start leave request",
        "create leave request",
        "leave application",
    ]):
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

    return ""


def _tenant_match_filter(user_context=None):
    tenant_id = _tenant_id(user_context)
    values = _id_variants(tenant_id)

    if not values:
        return {}

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

    options = [
        {
            "value": "CL",
            "label": f"Casual Leave (CL) - Available: {cl:g}, Used: {cl_used:g}",
        },
        {
            "value": "EL",
            "label": f"Earned Leave (EL) - Available: {el:g}, Used: {el_used:g}",
        },
        {
            "value": "HALF_DAY",
            "label": (
                "Half-Day Leave - Deducts 0.5 day from CL first, "
                "then EL if CL is insufficient"
            ),
        },
        {
            "value": "LWP",
            "label": "Leave Without Pay (LWP)",
        },
    ]

    return options


def get_handover_employee_options(user_context=None, limit=12):
    db = get_db()

    tenant_filter = _tenant_match_filter(user_context)
    department = _department(user_context)
    employee_id = _employee_id(user_context)

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    if department:
        query_parts.append({
            "$or": [
                {"department": department},
                {"department_name": department},
            ]
        })

    if employee_id:
        own_values = _id_variants(employee_id)
        query_parts.append({
            "_id": {
                "$nin": [
                    item for item in own_values
                    if isinstance(item, ObjectId)
                ]
            }
        })

    query_parts.append({
        "$or": [
            {"status": {"$in": ["active", "Active", "ACTIVE"]}},
            {"is_active": True},
            {"active": True},
            {"status": {"$exists": False}},
        ]
    })

    query = {"$and": query_parts} if query_parts else {}

    docs = list(
        db.employees
        .find(query)
        .sort([("name", 1), ("employee_name", 1)])
        .limit(limit)
    )

    options = []

    for doc in docs:
        name = (
            doc.get("name")
            or doc.get("employee_name")
            or doc.get("full_name")
            or "Employee"
        )

        designation = (
            doc.get("designation")
            or doc.get("designation_name")
            or ""
        )

        options.append({
            "id": str(doc.get("_id")),
            "label": f"{name}{f' - {designation}' if designation else ''}",
            "name": name,
        })

    return options


def get_project_handover_options(user_context=None, limit=12):
    db = get_db()

    tenant_filter = _tenant_match_filter(user_context)
    employee_id = _employee_id(user_context)
    user_key = _user_key(user_context)
    department = _department(user_context)

    employee = user_context.get("employee") if isinstance(user_context, dict) else {}
    employee = employee or {}

    team_leader_id = (
        user_context.get("team_leader_id")
        or employee.get("team_leader_id")
        or employee.get("team_leader_user_id")
        or employee.get("tl_id")
    )

    reporting_officer_id = (
        user_context.get("reporting_officer_id")
        or employee.get("reporting_officer_id")
        or employee.get("reporting_officer_user_id")
        or employee.get("ro_id")
    )

    person_values = []

    for raw_value in [
        employee_id,
        user_key,
        team_leader_id,
        reporting_officer_id,
        employee.get("_id"),
        employee.get("id"),
        employee.get("user_id"),
        employee.get("employee_id"),
    ]:
        for value in _id_variants(raw_value):
            if value not in person_values:
                person_values.append(value)

    query_parts = []

    if tenant_filter:
        query_parts.append(tenant_filter)

    project_or_parts = []

    if person_values:
        project_or_parts.extend([
            {"assigned_to": {"$in": person_values}},
            {"assigned_user_id": {"$in": person_values}},
            {"assigned_employee_id": {"$in": person_values}},
            {"employee_id": {"$in": person_values}},
            {"user_id": {"$in": person_values}},
            {"created_by": {"$in": person_values}},

            {"team_leader_id": {"$in": person_values}},
            {"team_leader_user_id": {"$in": person_values}},
            {"reporting_officer_id": {"$in": person_values}},
            {"reporting_officer_user_id": {"$in": person_values}},
            {"manager_id": {"$in": person_values}},

            {"members": {"$in": person_values}},
            {"member_ids": {"$in": person_values}},
            {"team_members": {"$in": person_values}},
            {"team_member_ids": {"$in": person_values}},
            {"collaborators": {"$in": person_values}},
            {"collaborator_ids": {"$in": person_values}},

            {"team_members.employee_id": {"$in": person_values}},
            {"team_members.user_id": {"$in": person_values}},
            {"team_members.id": {"$in": person_values}},
            {"members.employee_id": {"$in": person_values}},
            {"members.user_id": {"$in": person_values}},
            {"collaborators.employee_id": {"$in": person_values}},
            {"collaborators.user_id": {"$in": person_values}},
        ])

    if department:
        project_or_parts.extend([
            {"department": department},
            {"department_name": department},
            {"assigned_department": department},
            {"assigned_department_name": department},
        ])

    if project_or_parts:
        query_parts.append({"$or": project_or_parts})

    active_filter = {
        "$or": [
            {"is_deleted": {"$ne": True}},
            {"deleted": {"$ne": True}},
            {"is_active": True},
            {"active": True},
            {"status": {"$nin": ["deleted", "Deleted", "DELETED", "cancelled", "Cancelled"]}},
            {"status": {"$exists": False}},
        ]
    }

    query_parts.append(active_filter)

    query = {"$and": query_parts} if query_parts else {}

    docs = list(
        db.projects
        .find(query)
        .sort([("created_at", -1), ("_id", -1)])
        .limit(limit)
    )

    # Fallback:
    # If no directly assigned project is found, show tenant + department projects.
    # This is useful for handover because employees may hand over department work
    # even when project member fields are stored differently.
    if not docs and department:
        fallback_parts = []

        if tenant_filter:
            fallback_parts.append(tenant_filter)

        fallback_parts.append({
            "$or": [
                {"department": department},
                {"department_name": department},
                {"assigned_department": department},
                {"assigned_department_name": department},
            ]
        })

        fallback_parts.append(active_filter)

        docs = list(
            db.projects
            .find({"$and": fallback_parts})
            .sort([("created_at", -1), ("_id", -1)])
            .limit(limit)
        )

    # Final fallback:
    # Show recent active tenant projects instead of saying no project found.
    if not docs:
        fallback_parts = []

        if tenant_filter:
            fallback_parts.append(tenant_filter)

        fallback_parts.append(active_filter)

        docs = list(
            db.projects
            .find({"$and": fallback_parts})
            .sort([("created_at", -1), ("_id", -1)])
            .limit(limit)
        )

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

    group = db.management_groups.find_one({"_id": oid})

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


def _normalize_option_text(value):
    text = _lower(value)

    text = (
        text.replace("-", " ")
        .replace("_", " ")
        .replace("/", " ")
        .replace("(", " ")
        .replace(")", " ")
        .replace(".", " ")
        .replace(",", " ")
    )

    return " ".join(text.split())


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
        "earned leave": "el",
        "half day": "half_day",
        "halfday": "half_day",
        "leave without pay": "lwp",
        "loss of pay": "lwp",
    }

    clean_alias = aliases.get(clean, clean)

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

    if not employee_obj_id:
        raise RuntimeError("Employee profile is not mapped properly for this login.")

    employee = db.employees.find_one({
        "_id": employee_obj_id,
        "tenant_id": tenant_id,
        "is_deleted": {"$ne": True},
    })

    if not employee:
        employee = db.employees.find_one({
            "_id": employee_obj_id,
            "is_deleted": {"$ne": True},
        })

    if not employee:
        raise RuntimeError("Employee profile was not found for this login.")

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


def _apply_leave_start(user_context=None):
    leave_options = get_leave_type_options(user_context)

    save_pending_action(
        user_context=user_context,
        action_type="apply_leave",
        data={
            "leave_options": leave_options,
        },
        current_step="leave_type"
    )

    return {
        "handled": True,
        "answer": (
            "Sure, I can help you apply for leave.\n\n"
            "Please select the leave type:\n"
            f"{_format_options(leave_options)}\n\n"
            "Reply with the option number or leave type, for example: CL or 1."
        )
    }


def _apply_leave_continue(pending, question, user_context=None):
    data = pending.get("data") or {}
    step = pending.get("current_step")

    if step == "leave_type":
        # Always refresh leave balance options from live HRMS data.
        # Do not trust old cached options stored in ai_pending_actions.
        leave_options = get_leave_type_options(user_context)
        data["leave_options"] = leave_options

        selected = _extract_selected_option(question, leave_options)

        if not selected:
            return {
                "handled": True,
                "answer": (
                    "Please choose a valid leave type from the list:\n"
                    f"{_format_options(leave_options)}"
                )
            }

        data["leave_type"] = selected.get("value") or selected.get("name")
        data["leave_type_label"] = selected.get("label")

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="date_range"
        )

        return {
            "handled": True,
            "answer": (
                f"Selected leave type: {data['leave_type_label']}.\n\n"
                "Now tell me the leave date or date range.\n"
                "Example: 12 June 2026 to 13 June 2026, or 12-06-2026."
            )
        }

    if step == "date_range":
        data["date_range_text"] = _safe_str(question)

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="reason"
        )

        return {
            "handled": True,
            "answer": (
                f"Leave date noted: {data['date_range_text']}.\n\n"
                "Please provide the reason for your leave."
            )
        }

    if step == "reason":
        data["reason"] = _safe_str(question)

        handover_options = get_handover_employee_options(user_context)
        data["handover_options"] = handover_options

        if not handover_options:
            data["handover_to_id"] = ""
            data["handover_to_name"] = "Not selected"

            project_options = get_project_handover_options(user_context)
            data["project_options"] = project_options

            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="handover_projects"
            )

            return {
                "handled": True,
                "answer": (
                    "Reason noted.\n\n"
                    "I could not find any teammate from your department for handover.\n"
                    "Now select the project/work to hand over:\n"
                    f"{_format_options(project_options)}\n\n"
                    "Reply with option number, project name, or type 'none'."
                )
            }

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="handover_to"
        )

        return {
            "handled": True,
            "answer": (
                "Reason noted.\n\n"
                "Now select who will handle your work during leave:\n"
                f"{_format_options(handover_options)}\n\n"
                "Reply with the option number or employee name."
            )
        }

    if step == "handover_to":
        handover_options = data.get("handover_options") or get_handover_employee_options(user_context)
        selected = _extract_selected_option(question, handover_options)

        if not selected:
            return {
                "handled": True,
                "answer": (
                    "Please choose a valid handover employee from the list:\n"
                    f"{_format_options(handover_options)}"
                )
            }

        data["handover_to_id"] = selected.get("id")
        data["handover_to_name"] = selected.get("name") or selected.get("label")

        project_options = get_project_handover_options(user_context)
        data["project_options"] = project_options

        if not project_options:
            data["handover_project_id"] = ""
            data["handover_project_name"] = "None"

            save_pending_action(
                user_context=user_context,
                action_type="apply_leave",
                data=data,
                current_step="confirm"
            )

            return {
                "handled": True,
                "answer": (
                    f"Handover person selected: {data['handover_to_name']}.\n\n"
                    "I could not find any assigned project/work for handover.\n\n"
                    "Please review your leave request:\n\n"
                    f"Leave Type: {data.get('leave_type_label')}\n"
                    f"Date/Range: {data.get('date_range_text')}\n"
                    f"Reason: {data.get('reason')}\n"
                    f"Handover To: {data.get('handover_to_name')}\n"
                    f"Handover Work/Project: None\n\n"
                    "Reply 'confirm' to submit, or 'cancel' to stop."
                )
            }

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="handover_projects"
        )

        return {
            "handled": True,
            "answer": (
                f"Handover person selected: {data['handover_to_name']}.\n\n"
                "Now select the project/work to hand over:\n"
                f"{_format_options(project_options)}\n\n"
                "Reply with option number, project name, or type 'none'."
            )
        }

    if step == "handover_projects":
        if _lower(question) in ["none", "no", "skip"]:
            data["handover_project_id"] = ""
            data["handover_project_name"] = "None"
        else:
            project_options = data.get("project_options") or get_project_handover_options(user_context)
            selected = _extract_selected_option(question, project_options)

            if not selected:
                return {
                    "handled": True,
                    "answer": (
                        "Please choose a valid project/work from the list, or type 'none':\n"
                        f"{_format_options(project_options)}"
                    )
                }

            data["handover_project_id"] = selected.get("id")
            data["handover_project_name"] = selected.get("name") or selected.get("label")

        save_pending_action(
            user_context=user_context,
            action_type="apply_leave",
            data=data,
            current_step="confirm"
        )

        return {
            "handled": True,
            "answer": (
                "Please review your leave request:\n\n"
                f"Leave Type: {data.get('leave_type_label')}\n"
                f"Date/Range: {data.get('date_range_text')}\n"
                f"Reason: {data.get('reason')}\n"
                f"Handover To: {data.get('handover_to_name')}\n"
                f"Handover Work/Project: {data.get('handover_project_name')}\n\n"
                "Reply 'confirm' to submit, or 'cancel' to stop.\n\n"
                "Note: Actual submission will be connected in the next backend file."
            )
        }

    if step == "confirm":
        if _lower(question) in ["confirm", "yes", "submit", "ok", "okay"]:
            try:
                submission = _submit_leave_request_from_ai(
                    data,
                    user_context=user_context
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
                    )
                }

            except Exception as error:
                return {
                    "handled": True,
                    "answer": (
                        "I could not submit your leave request.\n\n"
                        f"Reason: {str(error)}\n\n"
                        "Please correct the details and start again by saying: I want to apply leave."
                    )
                }

            if _lower(question) in ["cancel", "no", "stop"]:
                clear_pending_action(user_context)

                return {
                    "handled": True,
                    "answer": "Leave request setup cancelled."
                }

        return {
            "handled": True,
            "answer": "I am still collecting your leave request details. Please continue with the requested information."
        }


def _get_management_group(group_id):
    db = get_db()

    oid = _as_object_id(group_id)

    if not oid:
        return None

    return db.management_groups.find_one({"_id": oid})


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
    db = get_db()

    tenant_id = _tenant_id(user_context)
    user_key = _user_key(user_context)

    group_id = data.get("group_id")
    group = _get_management_group(group_id)

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
                "Reply 'confirm' to create this meeting, or 'cancel' to stop.\n\n"
                "Note: Actual meeting creation API will be connected in the next backend file."
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
                        f"Reason: {str(error)}\n\n"
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

def _submit_reminder_from_ai(data, user_context=None):
    db = get_db()

    tenant_id = _tenant_id(user_context)
    user_key = _user_key(user_context)
    employee_id = _employee_id(user_context)

    reminder_text = _safe_str(data.get("reminder_text"))
    reminder_time_text = _safe_str(data.get("reminder_time_text"))

    reminder_doc = {
        "tenant_id": tenant_id,
        "user_id": user_key,
        "employee_id": employee_id,
        "title": "AI Assistant Reminder",
        "message": reminder_text,
        "reminder_text": reminder_text,
        "reminder_time_text": reminder_time_text,
        "status": "Pending",
        "source": "ai_assistant",
        "is_completed": False,
        "is_read": False,
        "read": False,
        "created_by": user_key,
        "created_at": _now_utc(),
        "updated_at": _now_utc(),
    }

    result = db.ai_reminders.insert_one(reminder_doc)

    _create_notification_safe(
        tenant_id=tenant_id,
        user_id=user_key,
        title="Reminder Created",
        message=f"Reminder created: {reminder_text}. Time: {reminder_time_text}",
        notification_type="ai_reminder",
    )

    _create_ai_audit_log(
        user_context=user_context,
        action_type="create_reminder",
        status="success",
        message="Reminder created through AI Assistant.",
        metadata={
            "reminder_id": str(result.inserted_id),
            "reminder_text": reminder_text,
            "reminder_time_text": reminder_time_text,
        },
    )

    clear_pending_action(user_context)

    return {
        "reminder_id": str(result.inserted_id),
        "reminder_text": reminder_text,
        "reminder_time_text": reminder_time_text,
    }

def _reminder_start(user_context=None):
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
                f"Time: {data.get('reminder_time_text')}\n\n"
                "Reply 'confirm' to create this reminder, or 'cancel' to stop.\n\n"
                "Note: Actual reminder saving will be connected in the next backend file."
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
                        "Your reminder has been created successfully.\n\n"
                        f"Reminder ID: {reminder.get('reminder_id')}\n"
                        f"Reminder: {reminder.get('reminder_text')}\n"
                        f"Time: {reminder.get('reminder_time_text')}\n\n"
                        "It has also been added to your notifications."
                    )
                }

            except Exception as error:
                return {
                    "handled": True,
                    "answer": (
                        "I could not create the reminder right now.\n\n"
                        f"Reason: {str(error)}\n\n"
                        "Please try again."
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

    return any(keyword in text for keyword in normal_question_keywords)


def handle_guided_action(question, user_context=None):
    """
    Handles multi-turn guided actions.
    This function must not trap every normal chatbot question inside an old action.
    It also restarts the guided flow if the user clearly starts the same action again.
    """

    clean_question = _safe_str(question)

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
        clear_pending_action(user_context)

        if intent == "apply_leave":
            return _apply_leave_start(user_context=user_context)

        if intent == "schedule_management_meeting":
            return _meeting_start(user_context=user_context)

        if intent == "create_reminder":
            return _reminder_start(user_context=user_context)

    # If a pending guided action exists but the user asks a normal unrelated question,
    # cancel the stale flow and let the normal AI/capability system answer.
    if pending and not intent and _looks_like_new_normal_question(clean_question):
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
        return _apply_leave_start(user_context=user_context)

    if intent == "schedule_management_meeting":
        return _meeting_start(user_context=user_context)

    if intent == "create_reminder":
        return _reminder_start(user_context=user_context)

    return {
        "handled": False,
        "answer": "",
    }