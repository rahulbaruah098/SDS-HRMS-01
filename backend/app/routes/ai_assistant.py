from bson import ObjectId
from flask import Blueprint, request, jsonify, g

from app.extensions import get_db
from app.services.ai_assistant_service import generate_ai_answer, seed_ai_knowledge
from app.utils.auth import current_user_required, roles_required, normalize_roles


ai_assistant_bp = Blueprint("ai_assistant", __name__)


def _safe_str(value):
    return str(value or "").strip()


def _as_object_id(value):
    try:
        text = _safe_str(value)
        if text and ObjectId.is_valid(text):
            return ObjectId(text)
    except Exception:
        return None

    return None


def _id_variants(value):
    variants = []

    text = _safe_str(value)
    if text:
        variants.append(text)

    oid = _as_object_id(text)
    if oid:
        variants.append(oid)

    return variants


def _safe_doc(doc):
    if not doc:
        return {}

    blocked_keys = {
        "password",
        "password_hash",
        "secret",
        "token",
        "jwt",
        "api_key",
        "refresh_token",
        "reset_token",
        "otp",
        "otp_code",
    }

    cleaned = {}

    for key, value in dict(doc).items():
        if key in blocked_keys:
            continue

        if key == "_id":
            cleaned["id"] = str(value)
            cleaned["_id"] = str(value)
            continue

        if isinstance(value, ObjectId):
            cleaned[key] = str(value)
            continue

        cleaned[key] = value

    return cleaned


def _safe_chat_history(raw_history):
    """
    Keeps only safe lightweight chat history.
    This avoids sending large/uncontrolled frontend payloads to the AI service.
    """

    if not isinstance(raw_history, list):
        return []

    cleaned = []

    for item in raw_history[-8:]:
        if not isinstance(item, dict):
            continue

        role = _safe_str(item.get("role")).lower()
        text = _safe_str(item.get("text") or item.get("content"))

        if role not in ["user", "assistant"]:
            continue

        if not text:
            continue

        cleaned.append({
            "role": role,
            "text": text[:1200]
        })

    return cleaned


def _find_employee_for_user(current_user, tenant_id):
    """
    Flexible employee lookup because this HRMS stores employee/user links
    using several aliases across modules.
    """

    db = get_db()

    current_user = current_user or {}

    user_id = current_user.get("_id") or current_user.get("id")
    email = current_user.get("email")
    employee_id = (
        current_user.get("employee_id")
        or current_user.get("employee_profile_id")
        or current_user.get("employee_summary_id")
    )

    user_values = _id_variants(user_id)
    employee_values = _id_variants(employee_id)
    tenant_values = _id_variants(tenant_id)

    or_parts = []

    if employee_values:
        or_parts.extend([
            {"_id": {"$in": employee_values}},
            {"id": {"$in": employee_values}},
            {"employee_id": {"$in": employee_values}},
        ])

    if user_values:
        or_parts.extend([
            {"user_id": {"$in": user_values}},
            {"login_user_id": {"$in": user_values}},
            {"account_user_id": {"$in": user_values}},
            {"created_user_id": {"$in": user_values}},
        ])

    if email:
        or_parts.extend([
            {"email": email},
            {"official_email": email},
            {"work_email": email},
        ])

    if not or_parts:
        return {}

    query = {"$or": or_parts}

    if tenant_values:
        query = {
            "$and": [
                query,
                {
                    "$or": [
                        {"tenant_id": {"$in": tenant_values}},
                        {"company_id": {"$in": tenant_values}},
                        {"tenant": {"$in": tenant_values}},
                    ]
                }
            ]
        }

    employee = db.employees.find_one(query)

    return _safe_doc(employee)


def _find_tenant_for_user(tenant_id):
    db = get_db()

    tenant_values = _id_variants(tenant_id)

    if not tenant_values:
        return {}

    tenant = (
        db.companies.find_one({"_id": {"$in": tenant_values}})
        or db.companies.find_one({"tenant_id": {"$in": tenant_values}})
        or db.tenants.find_one({"_id": {"$in": tenant_values}})
        or db.tenants.find_one({"tenant_id": {"$in": tenant_values}})
    )

    return _safe_doc(tenant)


def _build_ai_user_context(current_user):
    current_user = current_user or {}

    tenant_id = getattr(g, "tenant_id", None) or current_user.get("tenant_id")
    roles = normalize_roles(current_user.get("roles", []))

    if not roles:
        single_role = _safe_str(current_user.get("role")).lower()
        roles = [single_role] if single_role else []

    primary_role = roles[0] if roles else "employee"

    employee = _find_employee_for_user(current_user, tenant_id)
    tenant = _find_tenant_for_user(tenant_id)

    employee_id = (
        employee.get("_id")
        or employee.get("id")
        or current_user.get("employee_id")
        or current_user.get("employee_profile_id")
    )

    department = (
        employee.get("department")
        or employee.get("department_name")
        or current_user.get("department")
        or current_user.get("department_name")
        or ""
    )

    designation = (
        employee.get("designation")
        or employee.get("designation_name")
        or current_user.get("designation")
        or current_user.get("designation_name")
        or ""
    )

    tenant_name = (
        tenant.get("name")
        or tenant.get("company_name")
        or tenant.get("tenant_name")
        or current_user.get("company_name")
        or ""
    )

    return {
        "user_id": _safe_str(current_user.get("_id") or current_user.get("id")),
        "_id": _safe_str(current_user.get("_id") or current_user.get("id")),
        "tenant_id": tenant_id,
        "tenant": tenant,
        "tenant_name": tenant_name,
        "role": primary_role,
        "roles": roles,
        "email": current_user.get("email"),
        "name": (
            current_user.get("name")
            or current_user.get("full_name")
            or employee.get("name")
            or employee.get("employee_name")
        ),
        "employee_id": _safe_str(employee_id),
        "employee": employee,
        "department": department,
        "department_name": department,
        "designation": designation,
        "designation_name": designation,
        "team_leader_id": (
            employee.get("team_leader_id")
            or employee.get("team_leader_user_id")
            or employee.get("tl_id")
        ),
        "reporting_officer_id": (
            employee.get("reporting_officer_id")
            or employee.get("reporting_officer_user_id")
            or employee.get("ro_id")
        ),
    }


@ai_assistant_bp.post("/chat")
@current_user_required
def chat():
    data = request.get_json(silent=True) or {}

    question = _safe_str(data.get("message"))
    history = _safe_chat_history(data.get("history"))

    if not question:
        return jsonify({
            "success": False,
            "error": "Message is required"
        }), 400

    current_user = getattr(g, "current_user", {}) or {}
    user_context = _build_ai_user_context(current_user)

    try:
        answer = generate_ai_answer(
            question,
            user_context=user_context,
            history=history
        )

        return jsonify({
            "success": True,
            "question": question,
            "answer": answer
        }), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "error": "AI assistant failed",
            "details": str(e)
        }), 500


@ai_assistant_bp.post("/seed")
@roles_required(
    "super_admin",
    "admin",
    "hr",
    "hr_admin",
    "hr_manager"
)
def seed():
    current_user = getattr(g, "current_user", {}) or {}
    tenant_id = getattr(g, "tenant_id", current_user.get("tenant_id"))

    try:
        global_seed_result = seed_ai_knowledge(tenant_id=None)

        tenant_seed_result = None
        if tenant_id:
            tenant_seed_result = seed_ai_knowledge(tenant_id=tenant_id)

        return jsonify({
            "success": True,
            "message": "AI knowledge seeded successfully",
            "global_seed_result": global_seed_result,
            "tenant_seed_result": tenant_seed_result
        }), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "error": "Knowledge seed failed",
            "details": str(e)
        }), 500