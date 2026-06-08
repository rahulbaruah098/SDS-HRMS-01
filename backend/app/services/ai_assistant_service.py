import math
import os

from google import genai

from app.extensions import get_db
from app.ai_knowledge.hrms_workflows import HRMS_WORKFLOWS


GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash")
GEMINI_EMBEDDING_MODEL = os.getenv(
    "GEMINI_EMBEDDING_MODEL",
    "gemini-embedding-001"
)

client = genai.Client(api_key=GEMINI_API_KEY)


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
    Inserts HRMS workflow knowledge into MongoDB.
    Run this once from the AI seed API.
    """

    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is missing in backend .env")

    db = get_db()

    inserted_count = 0
    skipped_count = 0

    for item in HRMS_WORKFLOWS:
        existing = db.ai_knowledge.find_one({
            "tenant_id": tenant_id,
            "module": item["module"],
            "title": item["title"]
        })

        if existing:
            skipped_count += 1
            continue

        full_text = f"""
Module: {item["module"]}
Title: {item["title"]}
Content:
{item["content"]}
"""

        embedding = create_embedding(full_text)

        db.ai_knowledge.insert_one({
            "tenant_id": tenant_id,
            "module": item["module"],
            "title": item["title"],
            "content": item["content"],
            "embedding": embedding,
            "provider": "gemini",
            "embedding_model": GEMINI_EMBEDDING_MODEL,
            "is_active": True
        })

        inserted_count += 1

    return {
        "inserted_count": inserted_count,
        "skipped_count": skipped_count
    }


def search_knowledge(question, tenant_id=None, limit=4):
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
        if item["score"] > 0.15:
            matched_docs.append(item["doc"])

    return matched_docs


def generate_ai_answer(question, user_context=None):
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is missing in backend .env")

    tenant_id = None
    role = "employee"

    if user_context:
        tenant_id = user_context.get("tenant_id")
        role = user_context.get("role") or "employee"

    matched_docs = search_knowledge(question, tenant_id=tenant_id)

    context_text = "\n\n".join([
        f"""
Module: {doc.get("module")}
Title: {doc.get("title")}
Content:
{doc.get("content")}
"""
        for doc in matched_docs
    ])

    if not context_text.strip():
        context_text = "No matching SDS HRMS workflow knowledge was found."

    prompt = f"""
You are SDS HRMS AI Assistant.

Important rules:
- Answer only about SDS HRMS workflows.
- Do not answer unrelated general questions.
- Keep answers simple, direct, and step-by-step.
- The current user's role is: {role}
- Do not expose source code, database credentials, JWT tokens, API keys, or .env values.
- Do not claim that you performed any HRMS action.
- You are only a help assistant for explaining how to use the HRMS.

Use the following SDS HRMS workflow knowledge to answer the user's question.

Knowledge:
{context_text}

User question:
{question}
"""

    response = client.models.generate_content(
        model=GEMINI_CHAT_MODEL,
        contents=prompt
    )

    return response.text or "Sorry, I could not generate an answer."