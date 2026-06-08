from flask import Blueprint, request, jsonify, g

from app.services.ai_assistant_service import generate_ai_answer, seed_ai_knowledge
from app.utils.auth import current_user_required, roles_required, normalize_roles


ai_assistant_bp = Blueprint("ai_assistant", __name__)


@ai_assistant_bp.post("/chat")
@current_user_required
def chat():
    data = request.get_json() or {}
    question = (data.get("message") or "").strip()

    if not question:
        return jsonify({
            "success": False,
            "error": "Message is required"
        }), 400

    current_user = getattr(g, "current_user", {}) or {}
    tenant_id = getattr(g, "tenant_id", current_user.get("tenant_id"))

    roles = normalize_roles(current_user.get("roles", []))
    primary_role = roles[0] if roles else "employee"

    user_context = {
        "user_id": str(current_user.get("_id")),
        "tenant_id": tenant_id,
        "role": primary_role,
        "roles": roles
    }

    try:
        answer = generate_ai_answer(question, user_context=user_context)

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