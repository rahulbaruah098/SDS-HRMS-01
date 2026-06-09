import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { askAiAssistant } from "../api/client";

const QUICK_QUESTIONS = [
  "How to apply leave?",
  "I want to apply leave",
  "Any notifications?",
  "How many CL are left?",
  "How many assets do I have?",
  "Schedule management group meeting",
  "Remind me",
];

const WELCOME_MESSAGE = {
  role: "assistant",
  text:
    "Hi, I am your SDS HRMS Assistant. Ask me about HRMS workflows, leave, attendance, assets, reports, notifications, approvals, policies, or ask me to draft emails, leave reasons, messages, and other professional text.",
};

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function speakText(text) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(String(text || ""));
  utterance.lang = "en-IN";
  utterance.rate = 0.95;
  utterance.pitch = 1;

  window.speechSynthesis.speak(utterance);
}

function detectActionMode(messages) {
  const lastAssistant = [...messages]
    .reverse()
    .find((item) => item.role === "assistant");

  const text = String(lastAssistant?.text || "").toLowerCase();

  if (!text) return "";

  if (
    text.includes("leave type") ||
    text.includes("leave request") ||
    text.includes("handover") ||
    text.includes("date/range")
  ) {
    return "Leave Assistant";
  }

  if (
    text.includes("management group") ||
    text.includes("meeting") ||
    text.includes("minutes writer") ||
    text.includes("agenda")
  ) {
    return "Meeting Assistant";
  }

  if (
    text.includes("reminder") ||
    text.includes("remind you")
  ) {
    return "Reminder Assistant";
  }

  return "";
}

function buildQuickReplies(messages, loading) {
  if (loading) return [];

  const lastAssistant = [...messages]
    .reverse()
    .find((item) => item.role === "assistant");

  const text = String(lastAssistant?.text || "").toLowerCase();

  if (!text) return [];

  const replies = [];

  if (
    text.includes("reply 'confirm'") ||
    text.includes("reply confirm") ||
    text.includes("confirm to")
  ) {
    replies.push("confirm", "cancel");
  }

  if (
    text.includes("please select") ||
    text.includes("reply with the option number") ||
    text.includes("reply with option number") ||
    text.includes("choose a valid") ||
    text.includes("select the")
  ) {
    replies.push("1", "2", "3", "4");
  }

  if (text.includes("type 'none'") || text.includes("type none")) {
    replies.push("none");
  }

  if (text.includes("leave date") || text.includes("date range")) {
    replies.push("today", "tomorrow", "12 June 2026 to 13 June 2026");
  }

  const unique = [];

  for (const item of replies) {
    if (!unique.includes(item)) {
      unique.push(item);
    }
  }

  return unique.slice(0, 6);
}

export default function AiAssistantWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [copiedIndex, setCopiedIndex] = useState(null);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");

  const actionMode = useMemo(() => detectActionMode(messages), [messages]);
  const quickReplies = useMemo(
    () => buildQuickReplies(messages, loading),
    [messages, loading]
  );

  useEffect(() => {
    if (!open) return;

    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }, 80);

    return () => clearTimeout(timer);
  }, [messages, loading, open]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // ignore
      }

      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  async function sendMessage(manualMessage) {
    const cleanMessage = String(manualMessage || message || "").trim();

    if (!cleanMessage) return;
    if (loading) return;

    const historyBeforeQuestion = [...messages];

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: cleanMessage,
      },
    ]);

    setMessage("");
    setVoiceHint("");
    setVoiceError("");
    setLoading(true);

    try {
      const response = await askAiAssistant(cleanMessage, historyBeforeQuestion);

      const answer =
        response?.answer ||
        response?.message ||
        "I could not generate a response right now. Please try again.";

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: answer,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            error?.message ||
            "AI Assistant could not respond. Please check backend and try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function startListening() {
    setVoiceError("");
    setVoiceHint("");

    const SpeechRecognition = getSpeechRecognition();

    if (!SpeechRecognition) {
      setVoiceError(
        "Speech-to-text is not available in this browser. Use Google Chrome on http://localhost:5173, or type your question manually."
      );
      return;
    }

    if (listening) {
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // ignore
      }

      setListening(false);
      return;
    }

    try {
      finalTranscriptRef.current = "";

      const recognition = new SpeechRecognition();

      recognition.lang = "en-IN";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 3;

      recognition.onstart = () => {
        setListening(true);
        setVoiceError("");
        setVoiceHint("Listening... speak clearly. Your words will appear in the input.");
      };

      recognition.onerror = (event) => {
        setListening(false);

        if (event?.error === "not-allowed") {
          setVoiceError(
            "Microphone permission denied. Click the lock icon in the browser address bar and allow microphone access."
          );
          return;
        }

        if (event?.error === "no-speech") {
          setVoiceError("No speech detected. Please click mic and try again.");
          return;
        }

        if (event?.error === "network") {
          setVoiceError(
            "Speech recognition network error. Please use Chrome and stable internet."
          );
          return;
        }

        setVoiceError(`Voice input failed${event?.error ? `: ${event.error}` : ""}.`);
      };

      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";

        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript || "";

          if (result.isFinal) {
            finalText += `${transcript} `;
          } else {
            interimText += `${transcript} `;
          }
        }

        const cleanFinalText = finalText.trim();
        const cleanInterimText = interimText.trim();

        if (cleanFinalText) {
          finalTranscriptRef.current = cleanFinalText;
          setMessage(cleanFinalText);
          setVoiceHint("Voice captured. Review the text and press Send.");
          return;
        }

        if (cleanInterimText) {
          setMessage(cleanInterimText);
          setVoiceHint("Listening... capturing your words.");
        }
      };

      recognition.onend = () => {
        setListening(false);

        const capturedText = finalTranscriptRef.current.trim();

        if (capturedText) {
          setMessage(capturedText);
          setVoiceHint("Voice captured. Review the text and press Send.");
        } else {
          setVoiceHint("Voice capture stopped. If text appeared, review and press Send.");
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (error) {
      setListening(false);
      setVoiceError(
        error?.message ||
          "Could not start microphone. Please check browser microphone permission."
      );
    }
  }

  async function copyMessage(text, index) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setCopiedIndex(index);

      setTimeout(() => {
        setCopiedIndex(null);
      }, 1200);
    } catch {
      setCopiedIndex(null);
    }
  }

  function clearChat() {
    setMessages([WELCOME_MESSAGE]);
    setMessage("");
    setVoiceHint("");
    setVoiceError("");
    setLoading(false);

    try {
      recognitionRef.current?.stop?.();
    } catch {
      // ignore
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Open SDS HRMS AI Assistant"
          className="ai-assistant-launcher-fixed"
        >
          <span className="ai-assistant-online-dot-fixed" />
          <MessageCircle size={28} />
        </button>
      )}

      {open && (
        <div className="ai-assistant-panel">
          <div className="ai-assistant-header">
            <div className="ai-assistant-title-wrap">
              <div className="ai-assistant-bot-icon">
                <Bot size={23} />
              </div>

              <div>
                <div className="ai-assistant-title">
                  SDS HRMS Assistant <Sparkles size={15} />
                </div>
                <div className="ai-assistant-subtitle">
                  Tenant-aware AI helpdesk
                </div>
              </div>
            </div>

            <div className="ai-assistant-header-actions">
              <button type="button" onClick={clearChat} title="Clear chat">
                <Trash2 size={16} />
              </button>

              <button type="button" onClick={() => setOpen(false)} title="Close">
                <X size={18} />
              </button>
            </div>
          </div>

          {actionMode && (
            <div className="ai-action-mode-strip">
              <span>{actionMode}</span>
              <small>Guided action is active</small>
            </div>
          )}

          <div className="ai-assistant-quick-row">
            {QUICK_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                disabled={loading}
                onClick={() => sendMessage(question)}
              >
                {question}
              </button>
            ))}
          </div>

          <div className="ai-assistant-messages">
            {messages.map((item, index) => {
              const isUser = item.role === "user";

              return (
                <div
                  key={`${item.role}-${index}`}
                  className={`ai-message-row ${isUser ? "user" : "assistant"}`}
                >
                  <div className="ai-message-stack">
                    <div className={`ai-message-bubble ${isUser ? "user" : "assistant"}`}>
                      {item.text}
                    </div>

                    {!isUser && index > 0 && (
                      <div className="ai-message-actions">
                        <button
                          type="button"
                          onClick={() => copyMessage(item.text, index)}
                          title="Copy answer"
                        >
                          {copiedIndex === index ? (
                            <>
                              <Check size={13} /> Copied
                            </>
                          ) : (
                            <>
                              <Copy size={13} /> Copy
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => speakText(item.text)}
                          title="Speak answer"
                        >
                          <Volume2 size={13} /> Speak
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="ai-message-row assistant">
                <div className="ai-thinking">
                  <Loader2 size={15} className="ai-spin" />
                  Assistant is thinking...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {quickReplies.length > 0 && (
            <div className="ai-guided-replies">
              {quickReplies.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  disabled={loading}
                  onClick={() => sendMessage(reply)}
                  className={
                    reply === "confirm"
                      ? "confirm"
                      : reply === "cancel"
                      ? "cancel"
                      : ""
                  }
                >
                  {reply}
                </button>
              ))}
            </div>
          )}

          {voiceError && <div className="ai-voice-error">{voiceError}</div>}

          {voiceHint && !voiceError && (
            <div className="ai-voice-hint">{voiceHint}</div>
          )}

          {listening && (
            <div className="ai-voice-card-wrap">
              <div className="ai-voice-card">
                <div>
                  <div className="ai-voice-title">Listening...</div>
                  <div className="ai-voice-subtitle">
                    Speak clearly and wait for the transcript.
                  </div>
                </div>

                <div className="ai-voice-bars">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}

          <div className="ai-assistant-input-area">
            <div className="ai-assistant-input-row">
              <button
                type="button"
                className={`ai-mic-btn ${listening ? "listening" : ""}`}
                onClick={startListening}
                title="Speak your question"
              >
                {listening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={listening ? "Listening..." : "Ask or speak here..."}
              />

              <button
                type="button"
                className="ai-send-btn"
                onClick={() => sendMessage()}
                disabled={loading || !message.trim()}
                title="Send"
              >
                {loading ? <Loader2 size={18} className="ai-spin" /> : <Send size={18} />}
              </button>
            </div>

            <div className="ai-assistant-footer">
              <span>{listening ? "Listening..." : "Review voice before send"}</span>
              <span>Enter to send</span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .ai-assistant-launcher-fixed {
          position: fixed;
          right: 26px;
          bottom: 26px;
          z-index: 2147483647;
          width: 64px;
          height: 64px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.65);
          background: radial-gradient(circle at 30% 20%, #7dd3fc 0%, #2563eb 42%, #111827 100%);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 22px 50px rgba(37,99,235,.42), 0 0 0 8px rgba(37,99,235,.10);
          cursor: pointer;
        }

        .ai-assistant-online-dot-fixed {
          position: absolute;
          width: 16px;
          height: 16px;
          right: 6px;
          top: 7px;
          border-radius: 50%;
          background: #22c55e;
          border: 3px solid #fff;
        }

        .ai-assistant-panel {
          position: fixed;
          right: 22px;
          bottom: 22px;
          z-index: 2147483647;
          width: 430px;
          max-width: calc(100vw - 24px);
          height: 650px;
          max-height: calc(100vh - 24px);
          background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,252,.98));
          border-radius: 28px;
          border: 1px solid rgba(226,232,240,.95);
          box-shadow: 0 30px 90px rgba(15,23,42,.26), 0 0 0 1px rgba(255,255,255,.75) inset;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          backdrop-filter: blur(18px);
        }

        .ai-assistant-header {
          padding: 16px;
          background: radial-gradient(circle at top left, rgba(59,130,246,.85), transparent 32%), linear-gradient(135deg, #020617, #111827 55%, #1e293b);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .ai-assistant-title-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ai-assistant-bot-icon {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          background: rgba(255,255,255,.12);
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255,255,255,.18);
        }

        .ai-assistant-title {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 15px;
          font-weight: 900;
        }

        .ai-assistant-subtitle {
          font-size: 12px;
          color: rgba(255,255,255,.72);
          margin-top: 2px;
        }

        .ai-assistant-header-actions {
          display: flex;
          gap: 8px;
        }

        .ai-assistant-header-actions button {
          width: 36px;
          height: 36px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.14);
          background: rgba(255,255,255,.08);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .ai-action-mode-strip {
          padding: 9px 14px;
          background: linear-gradient(135deg, #eef2ff, #eff6ff);
          border-bottom: 1px solid #dbeafe;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .ai-action-mode-strip span {
          color: #1d4ed8;
          font-size: 12px;
          font-weight: 900;
        }

        .ai-action-mode-strip small {
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
        }

        .ai-assistant-quick-row {
          padding: 12px 14px;
          background: #fff;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          gap: 8px;
          overflow-x: auto;
        }

        .ai-assistant-quick-row button {
          flex: 0 0 auto;
          border: 1px solid #dbeafe;
          background: #eff6ff;
          color: #1d4ed8;
          border-radius: 999px;
          padding: 8px 11px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
        }

        .ai-assistant-quick-row button:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .ai-assistant-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          background: radial-gradient(circle at top left, rgba(219,234,254,.65), transparent 28%), #f8fafc;
          display: flex;
          flex-direction: column;
          gap: 13px;
        }

        .ai-message-row {
          display: flex;
        }

        .ai-message-row.user {
          justify-content: flex-end;
        }

        .ai-message-row.assistant {
          justify-content: flex-start;
        }

        .ai-message-stack {
          max-width: 86%;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .ai-message-row.user .ai-message-stack {
          align-items: flex-end;
        }

        .ai-message-row.assistant .ai-message-stack {
          align-items: flex-start;
        }

        .ai-message-bubble {
          padding: 11px 13px;
          font-size: 13px;
          line-height: 1.58;
          white-space: pre-wrap;
        }

        .ai-message-bubble.user {
          border-radius: 18px 18px 5px 18px;
          background: linear-gradient(135deg, #2563eb, #4f46e5);
          color: #fff;
          border: 1px solid rgba(37,99,235,.8);
          box-shadow: 0 12px 24px rgba(37,99,235,.2);
        }

        .ai-message-bubble.assistant {
          border-radius: 18px 18px 18px 5px;
          background: #fff;
          color: #0f172a;
          border: 1px solid #e2e8f0;
          box-shadow: 0 10px 22px rgba(15,23,42,.05);
        }

        .ai-message-actions {
          display: flex;
          gap: 6px;
        }

        .ai-message-actions button {
          height: 26px;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #475569;
          padding: 0 9px;
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
        }

        .ai-thinking {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 16px 16px 16px 5px;
          background: #fff;
          border: 1px solid #e2e8f0;
          color: #475569;
          font-size: 13px;
        }

        .ai-guided-replies {
          padding: 10px 14px;
          background: #fff;
          border-top: 1px solid #e2e8f0;
          display: flex;
          gap: 8px;
          overflow-x: auto;
        }

        .ai-guided-replies button {
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          color: #0f172a;
          border-radius: 999px;
          padding: 8px 13px;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          text-transform: capitalize;
          white-space: nowrap;
        }

        .ai-guided-replies button.confirm {
          border-color: #bbf7d0;
          background: #dcfce7;
          color: #166534;
        }

        .ai-guided-replies button.cancel {
          border-color: #fecaca;
          background: #fee2e2;
          color: #991b1b;
        }

        .ai-guided-replies button:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .ai-voice-error {
          padding: 8px 14px 0;
          background: #fff;
          color: #dc2626;
          font-size: 12px;
          font-weight: 700;
        }

        .ai-voice-hint {
          padding: 8px 14px 0;
          background: #fff;
          color: #2563eb;
          font-size: 12px;
          font-weight: 700;
        }

        .ai-voice-card-wrap {
          padding: 10px 14px 0;
          background: #fff;
        }

        .ai-voice-card {
          border-radius: 16px;
          border: 1px solid #bfdbfe;
          background: linear-gradient(135deg, #eff6ff, #eef2ff);
          padding: 10px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .ai-voice-title {
          font-size: 12px;
          font-weight: 900;
          color: #1d4ed8;
        }

        .ai-voice-subtitle {
          font-size: 11px;
          color: #64748b;
          margin-top: 2px;
        }

        .ai-voice-bars {
          display: flex;
          gap: 4px;
          align-items: center;
        }

        .ai-voice-bars span {
          width: 5px;
          border-radius: 999px;
          background: #2563eb;
        }

        .ai-voice-bars span:nth-child(1) { height: 18px; opacity: .45; }
        .ai-voice-bars span:nth-child(2) { height: 25px; opacity: .6; }
        .ai-voice-bars span:nth-child(3) { height: 31px; opacity: .78; }
        .ai-voice-bars span:nth-child(4) { height: 22px; opacity: .55; }

        .ai-assistant-input-area {
          padding: 14px;
          background: #fff;
          border-top: 1px solid #e2e8f0;
        }

        .ai-assistant-input-row {
          display: flex;
          gap: 9px;
          align-items: center;
        }

        .ai-assistant-input-row input {
          flex: 1;
          height: 46px;
          border-radius: 16px;
          border: 1px solid #cbd5e1;
          padding: 0 13px;
          outline: none;
          font-size: 13px;
          background: #fff;
          color: #0f172a;
        }

        .ai-mic-btn,
        .ai-send-btn {
          width: 46px;
          height: 46px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .ai-mic-btn {
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          color: #0f172a;
        }

        .ai-mic-btn.listening {
          border: 1px solid #ef4444;
          background: linear-gradient(135deg, #ef4444, #f97316);
          color: #fff;
        }

        .ai-send-btn {
          border: none;
          background: linear-gradient(135deg, #0f172a, #1e293b);
          color: #fff;
          box-shadow: 0 12px 24px rgba(15,23,42,.22);
        }

        .ai-send-btn:disabled {
          background: #94a3b8;
          box-shadow: none;
          cursor: not-allowed;
        }

        .ai-assistant-footer {
          margin-top: 9px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-size: 11px;
          color: #64748b;
        }

        @keyframes aiAssistantSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .ai-spin {
          animation: aiAssistantSpin .9s linear infinite;
        }

        @media (max-width: 520px) {
          .ai-assistant-panel {
            right: 12px;
            bottom: 12px;
            width: calc(100vw - 24px);
            height: calc(100vh - 24px);
            border-radius: 22px;
          }

          .ai-assistant-launcher-fixed {
            right: 18px;
            bottom: 18px;
          }
        }
      `}</style>
    </>
  );
}