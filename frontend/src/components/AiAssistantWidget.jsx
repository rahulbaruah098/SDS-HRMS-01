import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Send,
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
          <MessageCircle size={30} />
        </button>
      )}

      {open && (
        <div className="ai-assistant-panel ai-glass-phone">
          <div className="ai-top-bar">
            <button
              type="button"
              className="ai-circle-action"
              onClick={() => setOpen(false)}
              title="Close"
            >
              <X size={18} />
            </button>

            <div className="ai-brand-mark">
              <span>SDS</span>
            </div>

            <button
              type="button"
              className="ai-circle-action"
              onClick={clearChat}
              title="Clear chat"
            >
              <Trash2 size={16} />
            </button>
          </div>

          <div className="ai-hero-zone">
            <div className="ai-soft-grid" />

            <div className="ai-intro-copy">
              <p>SDS HRMS Assistant</p>
              <h2>
                AI Powers <span>Leave, Attendance</span> And HR Workflows
              </h2>
            </div>

            <div
              className={`ai-orb-shell ${
                loading ? "is-thinking" : listening ? "is-listening" : ""
              }`}
            >
              <div className="ai-orb-core">
                <div className="ai-orb-gloss" />
                <div className="ai-orb-shine" />
                <div className="ai-orb-ring one" />
                <div className="ai-orb-ring two" />
                <div className="ai-orb-ring three" />
                <Mic size={28} className="ai-orb-mic" />
              </div>
              <div className="ai-orb-reflection" />
            </div>

            <div className="ai-status-copy">
              {loading ? (
                <>
                  <small>You asked:</small>
                  <strong>{messages[messages.length - 1]?.text || "Processing..."}</strong>
                  <span>Thinking...</span>
                </>
              ) : listening ? (
                <>
                  <small>Voice Assistant</small>
                  <strong>Listening...</strong>
                  <span>Speak clearly and wait for transcript.</span>
                </>
              ) : (
                <>
                  <small>Ready</small>
                  <strong>Ask anything about HRMS</strong>
                  <span>Leave, attendance, assets, approvals, reports and more.</span>
                </>
              )}
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

          <div className="ai-response-area">
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
                    Assistant is preparing your response...
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
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
            <div className="ai-input-card">
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={listening ? "Listening..." : "Ask me anything..."}
                rows={3}
              />

              <div className="ai-input-actions">
                <button
                  type="button"
                  className={`ai-mic-btn ${listening ? "listening" : ""}`}
                  onClick={startListening}
                  title="Speak your question"
                >
                  {listening ? <MicOff size={18} /> : <Mic size={18} />}
                </button>

                <button
                  type="button"
                  className="ai-voice-pill"
                  onClick={startListening}
                  disabled={loading}
                >
                  <Volume2 size={16} />
                  Voice
                </button>

                <button
                  type="button"
                  className="ai-send-btn"
                  onClick={() => sendMessage()}
                  disabled={loading || !message.trim()}
                  title="Send"
                >
                  {loading ? (
                    <Loader2 size={17} className="ai-spin" />
                  ) : (
                    <>
                      <Send size={16} />
                      Send
                    </>
                  )}
                </button>
              </div>
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
          width: 72px;
          height: 72px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.72);
          background:
            radial-gradient(circle at 34% 20%, #ffffff 0%, #a5f3fc 18%, #f0abfc 44%, #2563eb 72%, #1e1b4b 100%);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow:
            0 28px 70px rgba(79,70,229,.34),
            0 0 0 12px rgba(129,140,248,.14),
            inset 0 2px 12px rgba(255,255,255,.5);
          cursor: pointer;
          overflow: visible;
          animation: aiLauncherFloat 3.2s ease-in-out infinite;
        }

        .ai-assistant-online-dot-fixed {
          position: absolute;
          width: 17px;
          height: 17px;
          right: 6px;
          top: 7px;
          border-radius: 50%;
          background: #22c55e;
          border: 3px solid #ffffff;
          box-shadow: 0 0 0 5px rgba(34,197,94,.18);
        }

        .ai-glass-phone {
          position: fixed;
          right: 22px;
          bottom: 22px;
          z-index: 2147483647;
          width: 430px;
          max-width: calc(100vw - 24px);
          height: 720px;
          max-height: calc(100vh - 24px);
          border-radius: 34px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,.74);
          background:
            radial-gradient(circle at 20% 0%, rgba(255,255,255,.96), rgba(255,255,255,.2) 24%, transparent 48%),
            linear-gradient(180deg, #fff8fb 0%, #fff9fd 38%, #fde7f0 100%);
          box-shadow:
            0 34px 110px rgba(15,23,42,.22),
            inset 0 0 0 1px rgba(255,255,255,.8);
          display: flex;
          flex-direction: column;
          backdrop-filter: blur(26px);
        }

        .ai-top-bar {
          position: relative;
          z-index: 2;
          padding: 16px 18px 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .ai-circle-action {
          width: 44px;
          height: 44px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.8);
          background: rgba(255,255,255,.62);
          color: #0f172a;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 14px 34px rgba(15,23,42,.08);
          backdrop-filter: blur(18px);
        }

        .ai-brand-mark {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at 35% 20%, #ffffff, #bae6fd 28%, #e9d5ff 64%, #fce7f3 100%);
          box-shadow:
            0 14px 30px rgba(15,23,42,.10),
            inset 0 0 0 1px rgba(255,255,255,.8);
          color: #0f172a;
          font-weight: 900;
          font-size: 11px;
          letter-spacing: .08em;
        }

        .ai-hero-zone {
          position: relative;
          padding: 12px 22px 8px;
          min-height: 270px;
          display: grid;
          justify-items: center;
          align-content: start;
          overflow: hidden;
        }

        .ai-soft-grid {
          position: absolute;
          inset: 0;
          opacity: .55;
          background-image:
            linear-gradient(45deg, rgba(148,163,184,.16) 1px, transparent 1px),
            linear-gradient(-45deg, rgba(148,163,184,.12) 1px, transparent 1px);
          background-size: 18px 18px;
          mask-image: radial-gradient(circle at 50% 48%, black, transparent 76%);
          pointer-events: none;
        }

        .ai-intro-copy {
          position: relative;
          z-index: 1;
          text-align: center;
          margin-top: 12px;
        }

        .ai-intro-copy p {
          margin: 0 0 8px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .03em;
        }

        .ai-intro-copy h2 {
          max-width: 330px;
          margin: 0 auto;
          color: #111827;
          font-size: 24px;
          line-height: 1.16;
          letter-spacing: -.04em;
          font-weight: 950;
        }

        .ai-intro-copy h2 span {
          color: rgba(219,39,119,.42);
        }

        .ai-orb-shell {
          position: relative;
          z-index: 1;
          width: 150px;
          height: 174px;
          margin-top: 24px;
          display: grid;
          justify-items: center;
          animation: aiOrbFloat 3.8s ease-in-out infinite;
        }

        .ai-orb-core {
          position: relative;
          width: 132px;
          height: 132px;
          border-radius: 999px;
          overflow: hidden;
          background:
            radial-gradient(circle at 28% 22%, #ffffff 0%, #ffffff 9%, transparent 18%),
            radial-gradient(circle at 62% 72%, #7dd3fc 0%, #22d3ee 20%, transparent 36%),
            radial-gradient(circle at 34% 40%, #f9a8d4 0%, #ec4899 32%, transparent 58%),
            radial-gradient(circle at 78% 34%, #fb7185 0%, transparent 34%),
            linear-gradient(135deg, #fdf2f8 0%, #f0abfc 36%, #22d3ee 75%, #0f172a 120%);
          box-shadow:
            0 30px 60px rgba(236,72,153,.26),
            0 10px 40px rgba(34,211,238,.20),
            inset 0 5px 14px rgba(255,255,255,.72),
            inset -12px -18px 28px rgba(15,23,42,.24);
          animation: aiOrbRotate 7s linear infinite;
        }

        .ai-orb-shell.is-thinking .ai-orb-core {
          animation-duration: 2.2s;
        }

        .ai-orb-shell.is-listening .ai-orb-core {
          animation-duration: 3s;
          box-shadow:
            0 30px 72px rgba(236,72,153,.34),
            0 0 0 12px rgba(236,72,153,.10),
            inset 0 5px 14px rgba(255,255,255,.72),
            inset -12px -18px 28px rgba(15,23,42,.24);
        }

        .ai-orb-gloss {
          position: absolute;
          width: 44px;
          height: 28px;
          left: 22px;
          top: 18px;
          border-radius: 999px;
          background: rgba(255,255,255,.82);
          filter: blur(.2px);
          transform: rotate(-32deg);
        }

        .ai-orb-shine {
          position: absolute;
          inset: 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.54);
          box-shadow: inset 0 0 24px rgba(255,255,255,.26);
        }

        .ai-orb-ring {
          position: absolute;
          inset: 8px;
          border-radius: 999px;
          border: 2px solid transparent;
          border-top-color: rgba(255,255,255,.72);
          border-right-color: rgba(15,23,42,.26);
          animation: aiRingSpin 3.6s linear infinite;
        }

        .ai-orb-ring.two {
          inset: 18px;
          border-top-color: rgba(34,211,238,.65);
          border-left-color: rgba(236,72,153,.52);
          animation-duration: 4.8s;
          animation-direction: reverse;
        }

        .ai-orb-ring.three {
          inset: 29px;
          border-top-color: rgba(255,255,255,.44);
          border-bottom-color: rgba(255,255,255,.22);
          animation-duration: 5.8s;
        }

        .ai-orb-mic {
          position: absolute;
          inset: 0;
          margin: auto;
          color: rgba(255,255,255,.38);
          filter: drop-shadow(0 2px 6px rgba(15,23,42,.18));
        }

        .ai-orb-reflection {
          width: 112px;
          height: 30px;
          margin-top: -7px;
          border-radius: 50%;
          background: radial-gradient(ellipse at center, rgba(236,72,153,.26), transparent 68%);
          filter: blur(4px);
          transform: perspective(120px) rotateX(62deg);
        }

        .ai-status-copy {
          position: relative;
          z-index: 1;
          display: grid;
          justify-items: center;
          gap: 3px;
          text-align: center;
          margin-top: 2px;
          max-width: 330px;
        }

        .ai-status-copy small {
          color: #64748b;
          font-size: 11px;
          font-weight: 800;
        }

        .ai-status-copy strong {
          color: #0f172a;
          font-size: 13px;
          line-height: 1.35;
          max-width: 300px;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .ai-status-copy span {
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
        }

        .ai-action-mode-strip {
          margin: 0 18px 10px;
          padding: 10px 13px;
          border-radius: 18px;
          background: rgba(255,255,255,.76);
          border: 1px solid rgba(255,255,255,.86);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          box-shadow: 0 14px 32px rgba(15,23,42,.06);
        }

        .ai-action-mode-strip span {
          color: #be185d;
          font-size: 12px;
          font-weight: 900;
        }

        .ai-action-mode-strip small {
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
        }

        .ai-assistant-quick-row {
          margin: 0 18px 10px;
          display: flex;
          gap: 8px;
          overflow-x: auto;
          scrollbar-width: none;
        }

        .ai-assistant-quick-row::-webkit-scrollbar {
          display: none;
        }

        .ai-assistant-quick-row button {
          flex: 0 0 auto;
          border: 1px solid rgba(226,232,240,.82);
          background: rgba(255,255,255,.72);
          color: #334155;
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
          box-shadow: 0 12px 24px rgba(15,23,42,.04);
        }

        .ai-assistant-quick-row button:disabled {
          opacity: .55;
          cursor: not-allowed;
        }

        .ai-response-area {
          flex: 1;
          min-height: 0;
          margin: 0 18px;
          border-radius: 24px;
          background: rgba(255,255,255,.62);
          border: 1px solid rgba(255,255,255,.86);
          box-shadow: 0 18px 46px rgba(15,23,42,.06);
          overflow: hidden;
        }

        .ai-assistant-messages {
          height: 100%;
          overflow-y: auto;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
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
          max-width: 88%;
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
          background: linear-gradient(135deg, #ec4899, #d946ef);
          color: #ffffff;
          border: 1px solid rgba(236,72,153,.48);
          box-shadow: 0 12px 24px rgba(236,72,153,.18);
        }

        .ai-message-bubble.assistant {
          border-radius: 18px 18px 18px 5px;
          background: rgba(255,255,255,.88);
          color: #0f172a;
          border: 1px solid rgba(226,232,240,.9);
          box-shadow: 0 10px 22px rgba(15,23,42,.045);
        }

        .ai-message-actions {
          display: flex;
          gap: 6px;
        }

        .ai-message-actions button {
          height: 26px;
          border-radius: 999px;
          border: 1px solid rgba(226,232,240,.9);
          background: rgba(255,255,255,.72);
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
          background: rgba(255,255,255,.88);
          border: 1px solid rgba(226,232,240,.9);
          color: #475569;
          font-size: 13px;
        }

        .ai-guided-replies {
          margin: 10px 18px 0;
          display: flex;
          gap: 8px;
          overflow-x: auto;
          scrollbar-width: none;
        }

        .ai-guided-replies::-webkit-scrollbar {
          display: none;
        }

        .ai-guided-replies button {
          border: 1px solid rgba(226,232,240,.9);
          background: rgba(255,255,255,.72);
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
          margin: 10px 18px 0;
          border-radius: 14px;
          padding: 9px 11px;
          background: rgba(254,226,226,.8);
          color: #dc2626;
          font-size: 12px;
          font-weight: 800;
        }

        .ai-voice-hint {
          margin: 10px 18px 0;
          border-radius: 14px;
          padding: 9px 11px;
          background: rgba(219,234,254,.72);
          color: #2563eb;
          font-size: 12px;
          font-weight: 800;
        }

        .ai-voice-card-wrap {
          margin: 10px 18px 0;
        }

        .ai-voice-card {
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,.86);
          background: rgba(255,255,255,.74);
          padding: 11px 13px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          box-shadow: 0 14px 32px rgba(15,23,42,.06);
        }

        .ai-voice-title {
          font-size: 12px;
          font-weight: 900;
          color: #be185d;
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
          background: #ec4899;
          animation: aiVoiceWave .8s ease-in-out infinite alternate;
        }

        .ai-voice-bars span:nth-child(1) { height: 18px; opacity: .45; animation-delay: 0s; }
        .ai-voice-bars span:nth-child(2) { height: 25px; opacity: .6; animation-delay: .1s; }
        .ai-voice-bars span:nth-child(3) { height: 31px; opacity: .78; animation-delay: .2s; }
        .ai-voice-bars span:nth-child(4) { height: 22px; opacity: .55; animation-delay: .3s; }

        .ai-assistant-input-area {
          padding: 14px 18px 18px;
        }

        .ai-input-card {
          border-radius: 24px;
          background: rgba(255,255,255,.82);
          border: 1px solid rgba(255,255,255,.9);
          box-shadow:
            0 18px 48px rgba(236,72,153,.12),
            inset 0 0 0 1px rgba(255,255,255,.64);
          padding: 12px;
        }

        .ai-input-card textarea {
          width: 100%;
          resize: none;
          border: 0;
          outline: none;
          background: transparent;
          color: #0f172a;
          font: inherit;
          font-size: 13px;
          line-height: 1.5;
          min-height: 58px;
          max-height: 96px;
        }

        .ai-input-card textarea::placeholder {
          color: #94a3b8;
        }

        .ai-input-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
        }

        .ai-mic-btn,
        .ai-send-btn,
        .ai-voice-pill {
          height: 38px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 900;
        }

        .ai-mic-btn {
          width: 38px;
          border: 1px solid rgba(226,232,240,.9);
          background: rgba(248,250,252,.9);
          color: #0f172a;
          flex: 0 0 auto;
        }

        .ai-mic-btn.listening {
          border-color: rgba(236,72,153,.38);
          background: linear-gradient(135deg, #ec4899, #f97316);
          color: #ffffff;
        }

        .ai-voice-pill {
          border: 1px solid rgba(226,232,240,.9);
          background: rgba(255,255,255,.78);
          color: #334155;
          padding: 0 15px;
        }

        .ai-voice-pill:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .ai-send-btn {
          margin-left: auto;
          border: none;
          background: linear-gradient(135deg, #ec4899, #d946ef);
          color: #ffffff;
          padding: 0 17px;
          box-shadow: 0 13px 28px rgba(236,72,153,.24);
        }

        .ai-send-btn:disabled {
          background: #cbd5e1;
          color: #64748b;
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
          padding: 0 4px;
        }

        @keyframes aiAssistantSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes aiOrbRotate {
          0% { transform: rotate(0deg) scale(1); filter: hue-rotate(0deg); }
          50% { transform: rotate(180deg) scale(1.025); filter: hue-rotate(12deg); }
          100% { transform: rotate(360deg) scale(1); filter: hue-rotate(0deg); }
        }

        @keyframes aiRingSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes aiOrbFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-9px); }
        }

        @keyframes aiLauncherFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }

        @keyframes aiVoiceWave {
          from { transform: scaleY(.55); }
          to { transform: scaleY(1.15); }
        }

        .ai-spin {
          animation: aiAssistantSpin .9s linear infinite;
        }

        @media (max-width: 520px) {
          .ai-glass-phone {
            right: 10px;
            bottom: 10px;
            width: calc(100vw - 20px);
            height: calc(100vh - 20px);
            border-radius: 28px;
          }

          .ai-assistant-launcher-fixed {
            right: 18px;
            bottom: 18px;
            width: 66px;
            height: 66px;
          }

          .ai-hero-zone {
            min-height: 250px;
            padding-inline: 16px;
          }

          .ai-orb-shell {
            width: 130px;
            height: 150px;
            margin-top: 18px;
          }

          .ai-orb-core {
            width: 112px;
            height: 112px;
          }

          .ai-intro-copy h2 {
            font-size: 21px;
          }

          .ai-response-area {
            margin-inline: 14px;
          }

          .ai-assistant-quick-row,
          .ai-guided-replies,
          .ai-voice-error,
          .ai-voice-hint,
          .ai-voice-card-wrap {
            margin-inline: 14px;
          }

          .ai-assistant-input-area {
            padding-inline: 14px;
          }
        }
      `}</style>
    </>
  );
}