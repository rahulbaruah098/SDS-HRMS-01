import { useState } from "react";
import { Bot, MessageCircle, Send, X } from "lucide-react";
import { askAiAssistant } from "../api/client";

export default function AiAssistantWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hi, I am your SDS HRMS Assistant. Ask me about leave, attendance, projects, IT support, grievance, assets, reports, or HRMS workflows.",
    },
  ]);

  const sendMessage = async () => {
    const cleanMessage = message.trim();

    if (!cleanMessage || loading) return;

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: cleanMessage,
      },
    ]);

    setMessage("");
    setLoading(true);

    try {
      const response = await askAiAssistant(cleanMessage);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: response?.answer || "Sorry, I could not find an answer.",
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            error?.message ||
            "AI Assistant failed. Please check backend and try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="AI Assistant"
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: 9999,
            width: 58,
            height: 58,
            borderRadius: "50%",
            border: "none",
            background: "linear-gradient(135deg, #2563eb, #4f46e5)",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 18px 45px rgba(37, 99, 235, 0.35)",
            cursor: "pointer",
          }}
        >
          <MessageCircle size={26} />
        </button>
      )}

      {open && (
        <div
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: 9999,
            width: 380,
            maxWidth: "calc(100vw - 28px)",
            height: 540,
            maxHeight: "calc(100vh - 28px)",
            background: "#ffffff",
            borderRadius: 22,
            border: "1px solid rgba(226, 232, 240, 1)",
            boxShadow: "0 28px 80px rgba(15, 23, 42, 0.22)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              background: "linear-gradient(135deg, #0f172a, #1e293b)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Bot size={21} />
              </div>

              <div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>
                  SDS HRMS Assistant
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>
                  Workflow helpdesk
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: "none",
                background: "rgba(255,255,255,0.1)",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <X size={18} />
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 16,
              background: "#f8fafc",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {messages.map((item, index) => {
              const isUser = item.role === "user";

              return (
                <div
                  key={`${item.role}-${index}`}
                  style={{
                    display: "flex",
                    justifyContent: isUser ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "84%",
                      padding: "10px 12px",
                      borderRadius: isUser
                        ? "16px 16px 4px 16px"
                        : "16px 16px 16px 4px",
                      background: isUser ? "#2563eb" : "#ffffff",
                      color: isUser ? "#ffffff" : "#0f172a",
                      border: isUser
                        ? "1px solid #2563eb"
                        : "1px solid #e2e8f0",
                      fontSize: 13,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {item.text}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div
                style={{
                  fontSize: 12,
                  color: "#64748b",
                }}
              >
                Assistant is thinking...
              </div>
            )}
          </div>

          <div
            style={{
              padding: 12,
              background: "#ffffff",
              borderTop: "1px solid #e2e8f0",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
              }}
            >
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    sendMessage();
                  }
                }}
                placeholder="Ask: How to apply leave?"
                style={{
                  flex: 1,
                  height: 42,
                  borderRadius: 14,
                  border: "1px solid #cbd5e1",
                  padding: "0 12px",
                  outline: "none",
                  fontSize: 13,
                }}
              />

              <button
                type="button"
                onClick={sendMessage}
                disabled={loading}
                style={{
                  width: 44,
                  height: 42,
                  borderRadius: 14,
                  border: "none",
                  background: loading ? "#94a3b8" : "#0f172a",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}