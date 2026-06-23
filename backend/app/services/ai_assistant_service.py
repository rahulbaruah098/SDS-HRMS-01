import math
import os
import re

try:
    from google import genai
except Exception:
    genai = None

from app.extensions import get_db
from app.ai_knowledge.hrms_workflows import HRMS_WORKFLOWS
from app.services.ai_capability_service import (
    build_capability_context,
    check_ai_role_permission,
)
from app.services.ai_action_service import handle_guided_action
from app.services.ai_provider_service import (
    AiProviderError,
    generate_ai_chat_response,
)


GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash")
GEMINI_EMBEDDING_MODEL = os.getenv(
    "GEMINI_EMBEDDING_MODEL",
    "gemini-embedding-001"
)

client = None

if genai is not None and GEMINI_API_KEY:
    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
    except Exception:
        client = None


def cosine_similarity(vector_a, vector_b):
    if not vector_a or not vector_b:
        return 0

    dot_product = sum(a * b for a, b in zip(vector_a, vector_b))
    norm_a = math.sqrt(sum(a * a for a in vector_a))
    norm_b = math.sqrt(sum(b * b for b in vector_b))

    if norm_a == 0 or norm_b == 0:
        return 0

    return dot_product / (norm_a * norm_b)


def create_embedding(text):
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is missing in backend .env")

    if genai is None:
        raise RuntimeError("google-genai package is not installed")

    if client is None:
        raise RuntimeError("Gemini client is not available")

    response = client.models.embed_content(
        model=GEMINI_EMBEDDING_MODEL,
        contents=text
    )

    embedding = getattr(response, "embedding", None)

    if embedding and hasattr(embedding, "values"):
        return list(embedding.values)

    embeddings = getattr(response, "embeddings", None)

    if embeddings:
        first_embedding = embeddings[0]
        if hasattr(first_embedding, "values"):
            return list(first_embedding.values)

    raise RuntimeError("Gemini embedding response did not return embedding values.")


def seed_ai_knowledge(tenant_id=None):
    """
    Inserts or updates HRMS workflow knowledge into MongoDB.
    Run this from the AI seed API whenever the static HRMS knowledge file is updated.
    """

    db = get_db()

    inserted_count = 0
    updated_count = 0
    skipped_count = 0

    for item in HRMS_WORKFLOWS:
        module = item["module"]
        title = item["title"]
        content = item["content"]

        existing = db.ai_knowledge.find_one({
            "tenant_id": tenant_id,
            "module": module,
            "title": title
        })

        full_text = f"""
Module: {module}
Title: {title}
Content:
{content}
"""

        if existing:
            existing_content = str(existing.get("content") or "").strip()
            incoming_content = str(content or "").strip()
            existing_provider = existing.get("provider")
            existing_embedding_model = existing.get("embedding_model")

            is_same_content = existing_content == incoming_content
            is_same_provider = existing_provider == "gemini"
            is_same_embedding_model = existing_embedding_model == GEMINI_EMBEDDING_MODEL
            has_embedding = bool(existing.get("embedding"))

            if (
                is_same_content
                and is_same_provider
                and is_same_embedding_model
                and has_embedding
            ):
                skipped_count += 1
                continue

            embedding = create_embedding(full_text)

            db.ai_knowledge.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "tenant_id": tenant_id,
                        "module": module,
                        "title": title,
                        "content": content,
                        "embedding": embedding,
                        "provider": "gemini",
                        "embedding_model": GEMINI_EMBEDDING_MODEL,
                        "is_active": True,
                    }
                }
            )

            updated_count += 1
            continue

        embedding = create_embedding(full_text)

        db.ai_knowledge.insert_one({
            "tenant_id": tenant_id,
            "module": module,
            "title": title,
            "content": content,
            "embedding": embedding,
            "provider": "gemini",
            "embedding_model": GEMINI_EMBEDDING_MODEL,
            "is_active": True
        })

        inserted_count += 1

    return {
        "inserted_count": inserted_count,
        "updated_count": updated_count,
        "skipped_count": skipped_count
    }


def search_knowledge(question, tenant_id=None, limit=5):
    """
    Searches seeded HRMS knowledge by semantic similarity.
    If embedding fails, it returns empty context instead of crashing the assistant.
    """

    try:
        db = get_db()
        question_embedding = create_embedding(question)

        query = {
            "is_active": True,
            "$or": [
                {"tenant_id": tenant_id},
                {"tenant_id": None}
            ]
        }

        docs = list(db.ai_knowledge.find(query))

        scored_docs = []

        for doc in docs:
            score = cosine_similarity(question_embedding, doc.get("embedding", []))
            scored_docs.append({
                "score": score,
                "doc": doc
            })

        scored_docs.sort(key=lambda item: item["score"], reverse=True)

        matched_docs = []

        for item in scored_docs[:limit]:
            if item["score"] > 0.18:
                matched_docs.append(item)

        return matched_docs

    except Exception:
        return []


def _keyword_tokens(value):
    words = re.findall(r"[a-z0-9]+", str(value or "").lower())

    stop_words = {
        "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "is",
        "are", "am", "i", "me", "my", "we", "our", "you", "your", "how",
        "what", "when", "where", "why", "can", "could", "should", "would",
        "please", "tell", "show", "give", "get", "want", "need", "do", "does",
        "did", "with", "from", "this", "that", "it", "as", "by", "be", "about"
    }

    return [word for word in words if len(word) > 2 and word not in stop_words]


def search_static_knowledge(question, limit=5):
    """
    Fast local HRMS knowledge search.
    This avoids an extra Gemini embedding API call when AI_FAST_MODE is enabled.
    """

    question_tokens = set(_keyword_tokens(question))

    if not question_tokens:
        return []

    scored_items = []

    for item in HRMS_WORKFLOWS:
        module = str(item.get("module") or "")
        title = str(item.get("title") or "")
        content = str(item.get("content") or "")
        searchable_text = f"{module} {title} {content}"
        text_tokens = set(_keyword_tokens(searchable_text))

        if not text_tokens:
            continue

        overlap = question_tokens.intersection(text_tokens)
        score = len(overlap) / max(1, len(question_tokens))

        title_tokens = set(_keyword_tokens(title))
        module_tokens = set(_keyword_tokens(module))

        if question_tokens.intersection(title_tokens):
            score += 0.20

        if question_tokens.intersection(module_tokens):
            score += 0.16

        if score <= 0:
            continue

        scored_items.append({
            "score": min(score, 1.0),
            "doc": {
                "module": module,
                "title": title,
                "content": content,
            },
        })

    scored_items.sort(key=lambda item: item["score"], reverse=True)

    return [item for item in scored_items[:limit] if item["score"] >= 0.14]


def should_use_fast_static_knowledge():
    fast_mode = str(os.getenv("AI_FAST_MODE", "true")).strip().lower() in {
        "1", "true", "yes", "y", "on"
    }
    use_gemini_search = str(
        os.getenv("AI_USE_GEMINI_KNOWLEDGE_SEARCH", "")
    ).strip().lower()

    if use_gemini_search in {"1", "true", "yes", "y", "on"}:
        return False

    if use_gemini_search in {"0", "false", "no", "n", "off"}:
        return True

    chat_provider = str(
        os.getenv("AI_CHAT_PROVIDER") or os.getenv("AI_PROVIDER") or "gemini"
    ).strip().lower()

    return fast_mode or chat_provider != "gemini"


def build_hrms_context(matched_items):
    if not matched_items:
        return ""

    blocks = []

    for item in matched_items:
        doc = item["doc"]
        score = item["score"]

        blocks.append(
            f"""
Similarity Score: {round(score, 4)}
Module: {doc.get("module")}
Title: {doc.get("title")}
Content:
{doc.get("content")}
"""
        )

    return "\n\n".join(blocks)


def is_sensitive_question(question):
    lowered = str(question or "").lower()

    sensitive_keywords = [
        "api key",
        "secret key",
        "jwt",
        "token",
        ".env",
        "database password",
        "db password",
        "mongodb password",
        "smtp password",
        "gmail password",
        "private key",
        "access key",
        "credential",
        "credentials",
        "show password",
        "source code",
        "dump database",
        "employee salary",
        "all employees data",
        "delete all",
        "bypass login",
        "hack",
        "exploit",
    ]

    return any(keyword in lowered for keyword in sensitive_keywords)


def looks_like_writing_request(question):
    lowered = str(question or "").lower()

    writing_keywords = [
        "write",
        "generate",
        "draft",
        "compose",
        "create a message",
        "create message",
        "email",
        "mail",
        "leave reason",
        "reason for leave",
        "application",
        "caption",
        "notice",
        "letter",
        "request message",
        "professional message",
    ]

    return any(keyword in lowered for keyword in writing_keywords)


def _strip_voice_instruction_suffix(text):
    """
    Removes the frontend-only voice instruction from the real user question.

    The mobile widget may append:
    "Reply very briefly in 1-2 short sentences because this is a voice conversation."
    That instruction is useful for output style, but it must not be treated as
    part of the user's actual HRMS question or action command.
    """

    clean = str(text or "").strip()

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


def looks_like_voice_request(question, history=None):
    lowered = str(question or "").lower()

    if (
        "voice conversation" in lowered
        or "reply very briefly" in lowered
        or "spoken answer" in lowered
    ):
        return True

    if isinstance(history, list):
        for item in history[-4:]:
            if not isinstance(item, dict):
                continue

            text = str(item.get("text") or "").lower()

            if "voice conversation" in text or "reply very briefly" in text:
                return True

    return False


def looks_like_project_team_question(question):
    lowered = str(question or "").lower()

    project_team_keywords = [
        "project",
        "projects",
        "task",
        "tasks",
        "team",
        "team member",
        "team members",
        "team leader",
        "reporting officer",
        "ro",
        "tl",
        "department project",
        "my department",
        "assigned project",
        "active project",
        "project status",
        "project progress",
    ]

    return any(keyword in lowered for keyword in project_team_keywords)


def _user_context_value(user_context, *keys):
    if not isinstance(user_context, dict):
        return ""

    employee = user_context.get("employee") or {}

    for key in keys:
        value = user_context.get(key)

        if value not in [None, ""]:
            return str(value).strip()

        value = employee.get(key)

        if value not in [None, ""]:
            return str(value).strip()

    return ""


def build_scope_guard_context(user_context=None, project_team_question=False):
    """
    Builds a strict natural-language boundary for live project/team answers.

    Important: this guards the answer layer. The next file to fix is
    ai_capability_service.py, because that file builds the live HRMS context.
    """

    employee_name = _user_context_value(
        user_context,
        "name",
        "employee_name",
        "full_name",
        "display_name",
    )

    employee_id = _user_context_value(
        user_context,
        "employee_id",
        "_id",
        "id",
        "user_id",
        "employee_code",
        "emp_code",
        "code",
    )

    department_name = _user_context_value(
        user_context,
        "department_name",
        "department",
        "assigned_department",
        "assigned_department_name",
    )

    designation_name = _user_context_value(
        user_context,
        "designation_name",
        "designation",
    )

    team_leader_name = _user_context_value(
        user_context,
        "team_leader_name",
        "tl_name",
    )

    reporting_officer_name = _user_context_value(
        user_context,
        "reporting_officer_name",
        "ro_name",
    )

    parts = [
        "Strict project/team data boundary:",
        f"- Logged-in employee: {employee_name or 'Not available'}",
        f"- Employee id/code: {employee_id or 'Not available'}",
        f"- Department scope: {department_name or 'Not available'}",
        f"- Designation: {designation_name or 'Not available'}",
        f"- Team Leader scope: {team_leader_name or 'Only if provided in live HRMS context'}",
        f"- Reporting Officer scope: {reporting_officer_name or 'Only if provided in live HRMS context'}",
        "- For project questions, answer only from live HRMS data provided in this prompt.",
        "- Do not invent project names, project counts, project statuses, team members, Team Leaders, or Reporting Officers.",
        "- Do not list projects, employees, team members, Team Leaders, or Reporting Officers from any other department/team.",
        "- If the live HRMS context contains no accessible project/team data, say: No accessible project/team record was found for your login.",
        "- If the question asks for all company projects or all employees, restrict the answer to the logged-in user's accessible department/team scope only.",
    ]

    if project_team_question:
        parts.extend([
            "- This specific user question is about project/team data, so the above boundary is mandatory.",
            "- Workflow knowledge may explain how to use the Projects module, but it must not be used to create fake live project/team data.",
        ])

    return "\n".join(parts)


def _fallback_with_capability_context(prefix, capability_context, voice_mode=False):
    text = f"{prefix}\n\n{capability_context}".strip()

    if voice_mode:
        return postprocess_ai_answer(
            text,
            voice_mode=True,
            is_writing_request=False,
        )

    return text


def postprocess_ai_answer(answer, voice_mode=False, is_writing_request=False):
    clean = str(answer or "").strip()

    if not clean:
        return ""

    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()

    if not voice_mode:
        return clean

    # Voice mode must be complete and short so iPhone/Android TTS does not stop midway.
    if is_writing_request:
        limit = 900
    else:
        limit = 560

    if len(clean) <= limit:
        return clean

    sentence_parts = re.split(r"(?<=[.!?])\s+", clean)
    selected = []

    for sentence in sentence_parts:
        candidate = " ".join(selected + [sentence]).strip()

        if len(candidate) > limit:
            break

        selected.append(sentence)

        if not is_writing_request and len(selected) >= 3:
            break

    if selected:
        compact = " ".join(selected).strip()
    else:
        compact = clean[:limit].rsplit(" ", 1)[0].strip()

    if compact and compact[-1] not in ".!?":
        compact = compact.rstrip(" ,;:-") + "."

    if not is_writing_request:
        compact += " Open the chat for full details."

    return compact


def local_fallback_answer(question):
    """
    Professional fallback if Gemini fails.
    This prevents raw API Error 500 from reaching the chatbot.
    """

    lowered = str(question or "").lower()

    if "email" in lowered or "mail" in lowered:
        return """Here is a professional email draft:

Subject: Request for Approval

Dear Sir/Madam,

I hope you are doing well.

I would like to request your approval regarding the mentioned requirement. Kindly review the request and let me know if any additional details are needed from my side.

Your approval will help us proceed further without delay.

Thank you.

Regards,
[Your Name]"""

    if "leave reason" in lowered or "reason for leave" in lowered:
        return """Here is a professional leave reason:

Due to personal reasons, I need to take leave for the requested period. I will ensure that my pending work is managed properly and will coordinate with the concerned team members before my leave."""

    if "leave" in lowered and ("apply" in lowered or "status" in lowered):
        return """Based on the current assistant knowledge, this is the recommended process:

1. Login to SDS HRMS.
2. Open Apply Leave from the sidebar.
3. Select leave type.
4. Select start date and end date.
5. Enter your leave reason.
6. Submit the request.
7. Track the status from Application Status."""

    if "attendance" in lowered:
        return """Based on the current assistant knowledge, this is the recommended process:

1. Login to SDS HRMS.
2. Open Attendance.
3. Select attendance mode if required.
4. Click Check In.
5. At the end of work, click Check Out.
6. View attendance history from Attendance or Reports."""

    if "it support" in lowered or "ticket" in lowered:
        return """Based on the current assistant knowledge, this is the recommended process:

1. Open IT Support.
2. Select issue category.
3. Enter subject and issue details.
4. Submit the ticket.
5. Track updates from the IT Support module."""

    return """I could not generate a full AI response at the moment, but I can still help.

Please rephrase your question, or ask about:
1. Leave
2. Attendance
3. IT Support
4. Projects
5. Assets
6. Grievance
7. Reports
8. Policies
9. Email or message drafting"""


def generate_ai_answer(question, user_context=None, history=None):
    raw_question = str(question or "").strip()
    voice_mode = looks_like_voice_request(raw_question, history=history)
    clean_question = _strip_voice_instruction_suffix(raw_question)

    if not clean_question:
        return "Please ask a question."

    tenant_id = None
    role = "employee"
    roles = []
    tenant_name = ""
    department_name = ""
    designation_name = ""
    employee_name = ""

    if user_context:
        employee_context = user_context.get("employee") or {}

        tenant_id = user_context.get("tenant_id")
        role = user_context.get("role") or "employee"
        roles = user_context.get("roles") or []
        tenant_name = user_context.get("tenant_name") or ""

        department_name = (
            user_context.get("department_name")
            or user_context.get("department")
            or employee_context.get("department_name")
            or employee_context.get("department")
            or ""
        )

        designation_name = (
            user_context.get("designation_name")
            or user_context.get("designation")
            or employee_context.get("designation_name")
            or employee_context.get("designation")
            or ""
        )

        employee_name = (
            user_context.get("name")
            or user_context.get("employee_name")
            or employee_context.get("name")
            or employee_context.get("employee_name")
            or employee_context.get("full_name")
            or ""
        )

    safe_history = []

    if isinstance(history, list):
        for item in history[-6:]:
            if not isinstance(item, dict):
                continue

            item_role = str(item.get("role") or "").strip().lower()
            item_text = str(item.get("text") or "").strip()

            if item_role not in ["user", "assistant"]:
                continue

            if not item_text:
                continue

            safe_history.append({
                "role": item_role,
                "text": item_text[:1000]
            })

    history_text = ""

    if safe_history:
        history_text = "\n".join([
            f"{item['role'].title()}: {item['text']}"
            for item in safe_history
        ])

    if is_sensitive_question(clean_question):
        return (
            "I cannot help with secrets, credentials, tokens, private employee data, "
            "database dumps, login bypass, or unsafe system actions. I can help with "
            "HRMS workflows, safe general questions, professional emails, leave reasons, "
            "messages, reports, attendance, approvals, assets, IT support, grievance, and policies."
        )

    permission_result = check_ai_role_permission(
        clean_question,
        user_context=user_context
    )

    if not permission_result.get("allowed"):
        allowed_modules = permission_result.get("allowed_modules") or []

        friendly_modules = ", ".join([
            module.replace("_", " ").title()
            for module in allowed_modules[:12]
        ])

        return (
            "I cannot answer this request because this module is not available "
            "for your current HRMS login role.\n\n"
            f"You can ask me about: {friendly_modules}.\n\n"
            "If you believe you should have access, please contact HR/Admin."
        )
    
    guided_action_result = handle_guided_action(
        clean_question,
        user_context=user_context
    )

    if guided_action_result.get("handled"):
        return guided_action_result.get("answer") or (
            "I have started the guided action flow. Please continue with the requested details."
        )

    capability_context = build_capability_context(
        clean_question,
        user_context=user_context
    )

    if should_use_fast_static_knowledge():
        matched_items = search_static_knowledge(clean_question)
    else:
        matched_items = search_knowledge(clean_question, tenant_id=tenant_id)

    hrms_context = build_hrms_context(matched_items)

    top_score = matched_items[0]["score"] if matched_items else 0
    has_reliable_hrms_context = bool(hrms_context.strip()) and top_score >= 0.22
    is_writing_request = looks_like_writing_request(clean_question)
    is_project_team_question = looks_like_project_team_question(clean_question)

    scope_guard_context = build_scope_guard_context(
        user_context=user_context,
        project_team_question=is_project_team_question,
    )

    voice_instruction = ""

    if voice_mode:
        voice_instruction = """
Voice conversation mode is active:
- Answer in 1 to 3 short complete sentences unless the user is asking for a draft/email.
- Do not give long lists in voice mode.
- Never end with an incomplete sentence.
- If more details are needed, say that the details are available in the chat.
"""

    if has_reliable_hrms_context:
        context_instruction = f"""
Relevant SDS HRMS workflow knowledge was found.

Use this HRMS knowledge as the primary source:
{hrms_context}
"""
    else:
        context_instruction = """
No highly reliable SDS HRMS workflow document was found for this question.

If the user asks about SDS HRMS, answer from general HRMS workflow logic and clearly mention:
"Based on the current assistant knowledge, this is the recommended process."

If the user asks for safe text generation such as email, leave reason, message, notice, caption, letter, or professional wording, generate the requested text directly.

If the question is a safe general question unrelated to HRMS, answer normally and briefly.
"""

    allowed_modules_text = ", ".join([
        module.replace("_", " ").title()
        for module in permission_result.get("allowed_modules", [])
    ])

    asked_modules_text = ", ".join([
        module.replace("_", " ").title()
        for module in permission_result.get("asked_modules", [])
    ])

    prompt = f"""
You are SDS HRMS AI Assistant inside the SDS HRMS web application.

Current user context:
- Employee/User Name: {employee_name or "Not available"}
- Tenant/Company Name: {tenant_name or "Not available"}
- Department: {department_name or "Not available"}
- Designation: {designation_name or "Not available"}
- Primary role: {role}
- All roles: {roles}
- Asked modules detected: {asked_modules_text}
- Modules allowed for this user: {allowed_modules_text}

Recent chat history:
{history_text or "No previous chat history provided."}

Real HRMS data available for this question:
{capability_context or "No live HRMS data context was required or found for this question."}

{scope_guard_context}

{voice_instruction}

Core behavior:
1. You are allowed to answer SDS HRMS workflow questions.
2. You are allowed to answer live HRMS data questions using the "Real HRMS data available for this question" section.
3. Always keep answers tenant-aware when tenant/company context is available.
4. You are also allowed to generate safe text such as professional emails, leave reasons, messages, notices, captions, letters, and short drafts.
5. You are also allowed to answer safe general knowledge questions briefly.
6. If live HRMS data is available, use it directly and clearly.
7. If tenant/company data is available, mention it naturally only when relevant.
8. If HRMS knowledge is available, use it as the main source for HRMS workflow answers.
9. If exact HRMS knowledge is missing, still give a practical HRMS-style answer, but do not invent exact backend routes, database fields, hidden permissions, leave counts, asset counts, attendance counts, performance scores, notification data, tenant details, or employee details.
10. Keep answers professional, clear, and directly usable.
11. Prefer step-by-step format for workflow questions.
12. For emails, include Subject and a complete email body.
13. For leave reasons, give 2 to 4 polished options when useful.
14. Mention role-based access where relevant.
15. Do not claim that you submitted, approved, deleted, uploaded, scheduled, created, or changed anything unless a confirmed action API has actually been called.
16. Do not expose source code, database credentials, JWT tokens, API keys, .env values, internal secrets, private employee data, or another tenant's data.
17. Do not give hacking, bypass, credential extraction, privilege escalation, or harmful instructions.
18. Only answer according to the modules allowed for this user's role.
19. If the user asks about a module outside their allowed role, politely say that the module is not available for their current login role.
20. If the user asks for their own live HRMS data, answer only from the provided live HRMS context. If no live data is available, say that no record was found instead of guessing.
21. If the user asks for another employee's private data, only answer if their role clearly allows it and the live HRMS context provides that data. Otherwise refuse politely.
22. If the user asks you to perform an HRMS action like applying leave, scheduling a meeting, or creating a reminder, collect the required details step by step and ask for confirmation before final submission.
23. For guided actions, never skip confirmation. Show a final summary and ask the user to reply confirm or cancel.
24. If an action API has not been connected yet, clearly say that the details are collected but final submission is not available yet.
25. Keep responses short unless the user asks for detailed explanation.
26. If the question is unclear, ask one short clarification question.
27. For project/team questions, never expose another department/team's project or employee details.
28. For project/team questions, use only the live HRMS data available in this prompt; if it is missing, say no accessible record was found.
29. In voice mode, give a complete short answer and never continue beyond the safe speaking length.
Writing request detected: {is_writing_request}
Voice conversation detected: {voice_mode}
Project/team question detected: {is_project_team_question}

Formatting:
- Use short paragraphs.
- Use numbered steps for process/workflow answers.
- Use clean professional formatting for emails/messages.
- Avoid long unnecessary explanation.
- If the question is unclear, ask one short clarification question.

{context_instruction}

User question:
{clean_question}
"""

    try:
        provider_response = generate_ai_chat_response(
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            temperature=0.15,
            max_tokens=(
                int(os.getenv("AI_VOICE_MAX_OUTPUT_TOKENS", "220") or 220)
                if voice_mode
                else int(os.getenv("AI_MAX_OUTPUT_TOKENS", "650") or 650)
            ),
            timeout=int(os.getenv("AI_CHAT_TIMEOUT_SECONDS", "20") or 20),
        )

        answer = str(
            provider_response.get("answer")
            or provider_response.get("text")
            or ""
        ).strip()

        if not answer:
            if capability_context:
                return _fallback_with_capability_context(
                    "I found the following HRMS data for your question:",
                    capability_context,
                    voice_mode=voice_mode,
                )

            return postprocess_ai_answer(
                local_fallback_answer(clean_question),
                voice_mode=voice_mode,
                is_writing_request=is_writing_request,
            )

        return postprocess_ai_answer(
            answer,
            voice_mode=voice_mode,
            is_writing_request=is_writing_request,
        )

    except AiProviderError:
        if capability_context:
            return _fallback_with_capability_context(
                "I could not generate a full AI response right now, but I found this HRMS data:",
                capability_context,
                voice_mode=voice_mode,
            )

        return postprocess_ai_answer(
            local_fallback_answer(clean_question),
            voice_mode=voice_mode,
            is_writing_request=is_writing_request,
        )

    except Exception:
        if capability_context:
            return _fallback_with_capability_context(
                "I could not generate a full AI response right now, but I found this HRMS data:",
                capability_context,
                voice_mode=voice_mode,
            )

        return postprocess_ai_answer(
            local_fallback_answer(clean_question),
            voice_mode=voice_mode,
            is_writing_request=is_writing_request,
        )
