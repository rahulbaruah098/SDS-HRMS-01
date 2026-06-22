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
import {
  askAiAssistant,
  checkInAttendance,
  checkOutAttendance,
  getAiAssistantVoiceContext,
  getAttendanceStatus,
  speakAiAssistantText,
  transcribeAiAssistantAudio,
} from "../api/client";

const QUICK_QUESTIONS = [
  "How to apply leave?",
  "I want to apply leave",
  "Any notifications?",
  "How many CL are left?",
  "How many assets do I have?",
  "Schedule management group meeting",
  "Remind me",
];

const PROJECT_MODULES = [
  "Leave",
  "Attendance",
  "Projects",
  "Approvals",
  "Assets",
  "Reports",
  "Notifications",
  "Policies",
  "IT Support",
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

function speakText(text, onEnd) {
  const finish = () => {
    if (typeof onEnd === "function") {
      onEnd();
    }
  };

  if (typeof window === "undefined" || !window.speechSynthesis) {
    finish();
    return null;
  }

  const cleanText = String(text || "").trim();

  if (!cleanText) {
    finish();
    return null;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(cleanText);
  const availableVoices = window.speechSynthesis.getVoices?.() || [];
  const preferredVoice =
    availableVoices.find((voice) => /en-IN/i.test(voice.lang || "")) ||
    availableVoices.find((voice) => /Google.*English/i.test(voice.name || "")) ||
    availableVoices.find((voice) => /^en-/i.test(voice.lang || ""));

  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  utterance.lang = preferredVoice?.lang || "en-IN";
  utterance.rate = 0.92;
  utterance.pitch = 1.02;
  utterance.volume = 1;
  utterance.onend = finish;
  utterance.onerror = finish;

  window.speechSynthesis.speak(utterance);

  return utterance;
}

const DEFAULT_WAKE_WORD = "hey eve";

const WAKE_WORD_VARIANTS = [
  "hey eve",
  "hi eve",
  "hello eve",
  "okay eve",
  "ok eve",
  "hay eve",
  "hai eve",
  "hii eve",
  "hey eave",
  "hi eave",
  "hello eave",
  "hey evie",
  "hi evie",
  "hello evie",
  "hey eevee",
  "hi eevee",
  "hello eevee",
  "hey ivy",
  "hi ivy",
  "hello ivy",
];

function normalizeVoiceText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transcriptHasWakeWord(text, wakeWord = DEFAULT_WAKE_WORD) {
  const normalizedText = normalizeVoiceText(text);
  const normalizedWakeWord = normalizeVoiceText(wakeWord || DEFAULT_WAKE_WORD);

  if (!normalizedText) return false;
  if (normalizedWakeWord && normalizedText.includes(normalizedWakeWord)) return true;

  return WAKE_WORD_VARIANTS.some((variant) =>
    normalizedText.includes(normalizeVoiceText(variant))
  );
}

function stripWakeWord(text) {
  let cleaned = String(text || "");

  const variants = [...WAKE_WORD_VARIANTS]
    .map((variant) => normalizeVoiceText(variant))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|\\s)${escaped}(?=\\s|$|,|\\.|!|\\?)`, "i");

    if (pattern.test(normalizeVoiceText(cleaned))) {
      cleaned = normalizeVoiceText(cleaned).replace(pattern, " ");
      break;
    }
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

function getTimeGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function buildWakeGreeting(context = {}) {
  const greeting = getTimeGreeting();
  const employeeName = String(context?.employee_name || context?.name || "Employee").trim();
  const formalTitle = String(context?.formal_title || "").trim();
  const notificationPhrase = String(context?.notification_phrase || "").trim();

  const namePart = [employeeName, formalTitle].filter(Boolean).join(" ");
  const greetingText = `${greeting}, ${namePart || "Employee"}.`;

  if (notificationPhrase) {
    return `${greetingText} ${notificationPhrase}`;
  }

  return greetingText;
}

function detectAttendanceVoiceAction(value = "") {
  const text = normalizeVoiceText(value);

  if (!text) {
    return "";
  }

  const infoQuestionWords = [
    "how to",
    "how do i",
    "how can i",
    "where",
    "show me",
    "tell me",
    "explain",
    "process",
    "steps",
  ];

  if (infoQuestionWords.some((phrase) => text.includes(phrase))) {
    return "";
  }

  const checkInPhrases = [
    "check in",
    "checkin",
    "punch in",
    "clock in",
    "office in",
    "start attendance",
    "start my attendance",
    "mark my attendance in",
    "mark attendance in",
  ];

  const checkOutPhrases = [
    "check out",
    "checkout",
    "punch out",
    "clock out",
    "office out",
    "end attendance",
    "end my attendance",
    "mark my checkout",
    "mark checkout",
    "mark attendance out",
  ];

  if (checkInPhrases.some((phrase) => text.includes(phrase))) {
    return "check_in";
  }

  if (checkOutPhrases.some((phrase) => text.includes(phrase))) {
    return "check_out";
  }

  if (
    text === "mark attendance" ||
    text === "mark my attendance" ||
    text === "attendance mark" ||
    text === "attendance"
  ) {
    return "smart";
  }

  return "";
}

function isLateCheckInReasonError(error) {
  const message = String(error?.message || error || "").toLowerCase();

  return (
    message.includes("late reason") ||
    message.includes("late_reason") ||
    message.includes("09:50") ||
    message.includes("9:50")
  );
}

function isEarlyCheckoutReasonError(error) {
  const message = String(error?.message || error || "").toLowerCase();

  return (
    message.includes("early checkout reason") ||
    message.includes("early check-out reason") ||
    message.includes("early_checkout_reason") ||
    message.includes("06:00") ||
    message.includes("6:00")
  );
}

function cleanAttendanceReason(value = "") {
  return String(value || "")
    .replace(/\b(?:late\s+reason|reason|because|due\s+to)\b\s*(?:is|as|:)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFallbackVoiceContext() {
  return {
    success: false,
    wake_word: DEFAULT_WAKE_WORD,
    employee_name: "Employee",
    gender: "",
    formal_title: "",
    unread_notification_count: 0,
    notification_phrase: "",
  };
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
    text.includes("leave date") ||
    text.includes("date/range") ||
    text.includes("handover") ||
    text.includes("hand over") ||
    text.includes("during your leave") ||
    text.includes("valid reason for your leave") ||
    text.includes("submit my leave")
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

function shouldKeepVoiceConversation(messages, answer) {
  const text = String(answer || "").toLowerCase();

  if (
    text.includes("submitted successfully") ||
    text.includes("setup cancelled") ||
    text.includes("request has been submitted") ||
    text.includes("track this from the application status") ||
    text.includes("created successfully")
  ) {
    return false;
  }

  return Boolean(detectActionMode(messages));
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
  const [voiceContext, setVoiceContext] = useState(null);
  const [eveActive, setEveActive] = useState(false);
  const [autoWakeActive, setAutoWakeActive] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [manualChatOpen, setManualChatOpen] = useState(false);
  const [siriStatus, setSiriStatus] = useState("Click once to activate Eve voice");
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState("");
  const [voiceLevel, setVoiceLevel] = useState(0);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  const voiceHandledRef = useRef(false);
  const voiceContextLoadedRef = useRef(false);
  const autoWakeModeRef = useRef(false);
  const voiceConversationModeRef = useRef(false);
  const suppressNextRestartRef = useRef(false);
  const restartListenTimerRef = useRef(null);
  const pendingGreetingRef = useRef("");
  const isSpeakingRef = useRef(false);
  const isStartingRecognitionRef = useRef(false);
  const loadingRef = useRef(false);
  const listeningRef = useRef(false);
  const messagesRef = useRef([WELCOME_MESSAGE]);
  const voiceContextRef = useRef(null);
  const audioStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const voiceMeterFrameRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const voiceChunkTimerRef = useRef(null);
  const geminiLoopTimerRef = useRef(null);
  const geminiLoopActiveRef = useRef(false);
  const suppressGeminiStopRef = useRef(false);
  const isTranscribingRef = useRef(false);
  const currentAudioRef = useRef(null);
  const currentAudioUrlRef = useRef("");
  const lastHandledTranscriptRef = useRef("");
  const lastHandledTranscriptAtRef = useRef(0);
  const voiceQuotaDisabledUntilRef = useRef(0);
  const lastVoiceActivationAtRef = useRef(0);
  const pendingAttendanceActionRef = useRef(null);

  const hasStartedChat = useMemo(
    () => messages.some((item) => item.role === "user"),
    [messages]
  );

  const showChat = manualChatOpen && hasStartedChat;

  const visibleMessages = useMemo(
    () => (showChat ? messages.filter((_, index) => index > 0) : []),
    [showChat, messages]
  );

  const actionMode = useMemo(() => detectActionMode(messages), [messages]);
  const quickReplies = useMemo(
    () => buildQuickReplies(messages, loading),
    [messages, loading]
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    voiceContextRef.current = voiceContext;
  }, [voiceContext]);

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
    if (voiceContextLoadedRef.current) return undefined;

    let cancelled = false;
    voiceContextLoadedRef.current = true;

    getAiAssistantVoiceContext()
      .then((context) => {
        if (cancelled) return;
        const nextContext = context || getFallbackVoiceContext();
        setVoiceContext(nextContext);
        voiceContextRef.current = nextContext;
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = getFallbackVoiceContext();
        setVoiceContext(fallback);
        voiceContextRef.current = fallback;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      clearRestartTimer();
      autoWakeModeRef.current = false;
      voiceConversationModeRef.current = false;
      suppressNextRestartRef.current = true;

      stopGeminiRecording({ stopLoop: true });
      cleanupCurrentAudio();

      try {
        recognitionRef.current?.stop?.();
      } catch {
        // ignore
      }

      stopVoiceMeter();

      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function clearRestartTimer() {
    if (restartListenTimerRef.current) {
      clearTimeout(restartListenTimerRef.current);
      restartListenTimerRef.current = null;
    }
  }

  function setAutoWakeMode(enabled) {
    autoWakeModeRef.current = Boolean(enabled);
    setAutoWakeActive(Boolean(enabled));
  }

  function getCurrentVoiceContext() {
    return voiceContextRef.current || voiceContext || getFallbackVoiceContext();
  }

  function getVoiceQuotaRetrySeconds(error, fallback = 90) {
    const retryValue = Number(
      error?.retry_after_seconds ||
        error?.retry_after ||
        0
    );

    if (Number.isFinite(retryValue) && retryValue > 0) {
      return Math.min(Math.max(Math.ceil(retryValue), 30), 3600);
    }

    const message = String(error?.message || error || "");
    const retryMatch = message.match(/retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*s/i);

    if (retryMatch) {
      const parsed = Number(retryMatch[1]);

      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(Math.max(Math.ceil(parsed) + 5, 30), 3600);
      }
    }

    return fallback;
  }

  function isVoiceQuotaError(error) {
    const message = String(error?.message || error || "").toLowerCase();

    return Boolean(
      error?.quota_exceeded ||
        error?.status === 429 ||
        message.includes("429") ||
        message.includes("quota") ||
        message.includes("resource_exhausted") ||
        message.includes("rate limit")
    );
  }

  function getVoiceQuotaRemainingSeconds() {
    return Math.ceil(
      Math.max(0, voiceQuotaDisabledUntilRef.current - Date.now()) / 1000
    );
  }

  function showVoiceQuotaCooldownHint() {
    const remainingSeconds = getVoiceQuotaRemainingSeconds();

    if (remainingSeconds <= 0) {
      return false;
    }

    setManualChatOpen(false);
    setVoiceHint(
      `Voice service quota is cooling down. Try Eve voice again in ${remainingSeconds} seconds. You can still type manually.`
    );

    return true;
  }

  function pauseVoiceForQuota(error, source = "voice") {
    const retrySeconds = getVoiceQuotaRetrySeconds(error);

    voiceQuotaDisabledUntilRef.current = Date.now() + retrySeconds * 1000;
    geminiLoopActiveRef.current = false;
    voiceConversationModeRef.current = false;
    pendingGreetingRef.current = "";
    suppressNextRestartRef.current = true;

    clearRestartTimer();
    stopGeminiRecording({ stopLoop: true });
    cleanupCurrentAudio();

    try {
      recognitionRef.current?.stop?.();
    } catch {
      // ignore
    }

    recognitionRef.current = null;
    setAutoWakeMode(false);
    setListening(false);
    listeningRef.current = false;
    isSpeakingRef.current = false;
    isStartingRecognitionRef.current = false;
    setEveActive(false);
    stopVoiceMeter();
    setManualChatOpen(false);
    setVoiceError("");
    setVoiceHint(
      `Voice service ${source} quota reached. Eve voice is paused for ${retrySeconds} seconds. You can still type manually.`
    );
  }

  function stopRecognition({ suppressRestart = true } = {}) {
    clearRestartTimer();

    if (suppressRestart) {
      suppressNextRestartRef.current = true;
    }

    try {
      recognitionRef.current?.stop?.();
    } catch {
      // ignore
    }

    recognitionRef.current = null;
    setListening(false);
    listeningRef.current = false;
    isStartingRecognitionRef.current = false;
  }

  function stopVoiceSession() {
    clearRestartTimer();
    stopGeminiRecording({ stopLoop: true });
    cleanupCurrentAudio();

    setAutoWakeMode(false);
    voiceConversationModeRef.current = false;
    pendingGreetingRef.current = "";
    suppressNextRestartRef.current = true;
    isSpeakingRef.current = false;

    try {
      recognitionRef.current?.stop?.();
    } catch {
      // ignore
    }

    recognitionRef.current = null;
    setListening(false);
    listeningRef.current = false;
    isStartingRecognitionRef.current = false;
    setEveActive(false);
    stopVoiceMeter();

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  function scheduleListeningRestart(delay = 500) {
    clearRestartTimer();

    if (!autoWakeModeRef.current) return;
    if (Date.now() < voiceQuotaDisabledUntilRef.current) return;
    if (loadingRef.current) return;
    if (isSpeakingRef.current) return;

    restartListenTimerRef.current = setTimeout(() => {
      restartListenTimerRef.current = null;

      if (!autoWakeModeRef.current) return;
      if (Date.now() < voiceQuotaDisabledUntilRef.current) return;
      if (loadingRef.current) return;
      if (isSpeakingRef.current) return;

      beginListening();
    }, delay);
  }

  function speakAssistantText(text, options = {}) {
    const { restartAfterSpeech = true, onEnd } = options;
    const cleanText = String(text || "").trim();

    if (Date.now() < voiceQuotaDisabledUntilRef.current) {
      setVoiceHint("Voice service quota is cooling down. You can still type manually.");
      setManualChatOpen(false);

      if (typeof onEnd === "function") {
        onEnd();
      }

      return;
    }

    let finished = false;

    const finishSpeech = () => {
      if (finished) return;
      finished = true;

      cleanupCurrentAudio();
      isSpeakingRef.current = false;

      if (typeof onEnd === "function") {
        onEnd();
      }

      if (restartAfterSpeech) {
        scheduleListeningRestart(450);
      }
    };

    if (!cleanText) {
      finishSpeech();
      return;
    }

    stopRecognition({ suppressRestart: true });
    stopGeminiRecording({ stopLoop: false });
    cleanupCurrentAudio();

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    isSpeakingRef.current = true;
    setListening(false);
    listeningRef.current = false;
    setVoiceHint("Eve is speaking...");

        speakAiAssistantText(cleanText, {
          voice: options.voice || "anushka",
          timeoutMs: 30000,
        })
      .then((voiceResponse) => {
        const audioUrl = voiceResponse?.audio_url || voiceResponse?.url;

        if (!audioUrl) {
          setVoiceHint("Eve voice could not be generated. Please check the voice service.");
          finishSpeech();
          return;
        }

        playGeneratedVoice(audioUrl, finishSpeech);
      })
      .catch((error) => {
        if (isVoiceQuotaError(error)) {
          pauseVoiceForQuota(error, "TTS");

          if (typeof onEnd === "function") {
            onEnd();
          }

          return;
        }

        setVoiceHint(
          error?.message ||
            "Eve voice could not be generated. Please check the voice service."
        );

        stopGeminiRecording({ stopLoop: true });

        isSpeakingRef.current = false;

        if (typeof onEnd === "function") {
          onEnd();
        }

        if (restartAfterSpeech) {
          setTimeout(() => {
            if (!loadingRef.current && Date.now() >= voiceQuotaDisabledUntilRef.current) {
              geminiLoopActiveRef.current = true;
              beginListening();
            }
          }, 1800);
        }
      });
  }

  function appendWakeGreeting(greeting, userText = "Hey Eve") {
    setMessages((prev) => {
      const alreadyGreeted =
        prev.length >= 2 &&
        prev[prev.length - 2]?.role === "user" &&
        normalizeVoiceText(prev[prev.length - 2]?.text) === normalizeVoiceText(userText) &&
        prev[prev.length - 1]?.role === "assistant" &&
        prev[prev.length - 1]?.text === greeting;

      if (alreadyGreeted) {
        return prev;
      }

      return [
        ...prev,
        {
          role: "user",
          text: userText,
        },
        {
          role: "assistant",
          text: greeting,
        },
      ];
    });
  }

  async function refreshVoiceContextIfNeeded(force = false) {
    const currentContext = getCurrentVoiceContext();

    if (
      !force &&
      currentContext?.employee_name &&
      currentContext.employee_name !== "Employee"
    ) {
      return currentContext;
    }

    try {
      const freshContext = await getAiAssistantVoiceContext();
      const nextContext = freshContext || currentContext || getFallbackVoiceContext();

      setVoiceContext(nextContext);
      voiceContextRef.current = nextContext;

      return nextContext;
    } catch {
      return currentContext || getFallbackVoiceContext();
    }
  }

  async function activateEve() {
    if (showVoiceQuotaCooldownHint()) {
      return;
    }

    setAutoWakeMode(true);
    voiceConversationModeRef.current = false;
    pendingGreetingRef.current = "";

    setEveActive(true);
    setOpen(true);
    setManualChatOpen(false);
    setMessage("");
    setLastVoiceTranscript("");
    setSiriStatus("Eve is active. Say “Hey Eve” anytime.");
    setVoiceHint('Eve is active. Say “Hey Eve” and speak your command clearly.');
    setVoiceError("");
    lastVoiceActivationAtRef.current = Date.now();

    await refreshVoiceContextIfNeeded(true);
    await startVoiceMeter();

    geminiLoopActiveRef.current = true;

    beginListening();
  }

  async function handleVoiceTranscript(rawText) {
    const transcript = String(rawText || "").trim();

    if (!transcript) return;
    if (loadingRef.current || isSpeakingRef.current) return;

    const context = await refreshVoiceContextIfNeeded();
    const wakeWord = context?.wake_word || DEFAULT_WAKE_WORD;
    const hasWakeWord = transcriptHasWakeWord(transcript, wakeWord);

    const recentlyActivatedByClick =
      Date.now() - lastVoiceActivationAtRef.current < 12000;

    const waitingForOneVoiceReply =
      Boolean(pendingAttendanceActionRef.current) || voiceConversationModeRef.current;

    if (!hasWakeWord && !waitingForOneVoiceReply && !recentlyActivatedByClick) {
      setMessage("");
      setLastVoiceTranscript(transcript);
      setSiriStatus(`Heard: ${transcript}`);
      setVoiceHint('Listening in the background. Say "Hey Eve" to open the assistant.');
      scheduleListeningRestart(700);
      return;
    }

    setEveActive(true);
    setOpen(true);
    setManualChatOpen(false);
    setVoiceError("");
    setLastVoiceTranscript(transcript);

    const greeting = buildWakeGreeting(context);
    const commandText = hasWakeWord ? stripWakeWord(transcript) : transcript;

    if (hasWakeWord) {
      voiceConversationModeRef.current = true;
      setSiriStatus(greeting);
    }

    if (!commandText) {
      setMessage("");
      setLastVoiceTranscript("");
      setSiriStatus(greeting);
      setVoiceHint("Eve is active. Speak your HRMS command now.");
      speakAssistantText(greeting, { restartAfterSpeech: true });
      return;
    }

    setMessage(commandText);
    setLastVoiceTranscript(commandText);
    setSiriStatus(`Processing: ${commandText}`);

    if (hasWakeWord) {
      setVoiceHint(`${greeting} Processing your command...`);
      speakAssistantText(greeting, {
        restartAfterSpeech: false,
        onEnd: () => {
          sendMessage(commandText, {
            speakAnswer: true,
            skipWakeWordCheck: true,
            voiceInput: true,
          });
        },
      });
      return;
    }

    setVoiceHint("Processing your voice reply...");
    stopRecognition({ suppressRestart: true });

    await sendMessage(commandText, {
      speakAnswer: true,
      skipWakeWordCheck: true,
      voiceInput: true,
    });
  }

  function getEmployeeNameForSpeech() {
    const context = getCurrentVoiceContext();

    return String(
      context?.employee_name ||
        context?.name ||
        "Employee"
    ).trim();
  }

  function buildAttendancePayload(extra = {}) {
    return {
      mode: "office",
      source: "ai_assistant_widget",
      ...extra,
    };
  }

  async function getBrowserAttendanceLocation() {
    if (typeof window === "undefined" || !navigator?.geolocation) {
      throw new Error(
        "GPS location is required for AI attendance, but geolocation is not available in this browser."
      );
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = position?.coords || {};

          if (
            coords.latitude === undefined ||
            coords.latitude === null ||
            coords.longitude === undefined ||
            coords.longitude === null
          ) {
            reject(new Error("GPS location is required for attendance. Please enable location permission and try again."));
            return;
          }

          resolve({
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            altitude: coords.altitude,
            altitude_accuracy: coords.altitudeAccuracy,
            heading: coords.heading,
            speed: coords.speed,
            location_captured_at: new Date().toISOString(),
            location_source: "browser_geolocation",
          });
        },
        (error) => {
          if (error?.code === 1) {
            reject(new Error("Location permission is blocked. Please allow location permission, then ask Eve to check in again."));
            return;
          }

          if (error?.code === 3) {
            reject(new Error("Unable to get GPS location in time. Please stand near a window or enable precise location and try again."));
            return;
          }

          reject(new Error(error?.message || "GPS location is required for attendance. Please enable location permission and try again."));
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 15000,
        }
      );
    });
  }

  function notifyAttendanceUiChanged(action, response = {}) {
    if (typeof window === "undefined") return;

    const detail = {
      action,
      attendance: response?.attendance || null,
      response,
      updated_at: new Date().toISOString(),
      source: "ai_assistant_widget",
    };

    try {
      window.dispatchEvent(new CustomEvent("sds_hrms_attendance_updated", { detail }));
      window.dispatchEvent(new CustomEvent("attendance-updated", { detail }));
      window.dispatchEvent(new CustomEvent("attendanceStatusRefresh", { detail }));
      localStorage.setItem("sds_hrms_attendance_refresh_at", String(Date.now()));
    } catch {
      // ignore UI refresh event failure
    }
  }

  function buildAttendanceSuccessAnswer(action, response = {}) {
    const employeeName = getEmployeeNameForSpeech();
    const greeting = getTimeGreeting();
    const attendance = response?.attendance || {};

    if (action === "check_in") {
      if (attendance?.is_late || attendance?.status === "late") {
        return `${greeting}, ${employeeName}. Your late check-in is completed and the reason is recorded.`;
      }

      if (attendance?.is_holiday_work || attendance?.status === "holiday_work") {
        return `${greeting}, ${employeeName}. Your holiday work check-in is completed.`;
      }

      return `${greeting}, ${employeeName}. Your check-in is completed.`;
    }

    if (attendance?.is_early_checkout || attendance?.status === "early_checkout") {
      return `${greeting}, ${employeeName}. Your early check-out is completed and the reason is recorded.`;
    }

    return `${greeting}, ${employeeName}. Your check-out is completed.`;
  }

  async function resolveSmartAttendanceAction() {
    try {
      const status = await getAttendanceStatus();
      const attendance = status?.attendance || {};

      if (!attendance?.check_in) {
        return "check_in";
      }

      if (!attendance?.check_out) {
        return "check_out";
      }

      return "done";
    } catch {
      return "check_in";
    }
  }

  function finishVoiceAfterAttendance(answer, shouldListenForReason = false) {
    if (shouldListenForReason) {
      voiceConversationModeRef.current = true;
      speakAssistantText(answer, { restartAfterSpeech: true });
      return;
    }

    voiceConversationModeRef.current = false;
    speakAssistantText(answer, {
      restartAfterSpeech: false,
      onEnd: () => {
        stopVoiceSession();
        setSiriStatus(answer);
      },
    });
  }

  async function submitAttendanceAction(action, payload) {
    if (action === "check_in") {
      return checkInAttendance(payload);
    }

    return checkOutAttendance(payload);
  }

  async function handleAttendanceActionMessage(cleanMessage, options = {}) {
    if (loadingRef.current) return;

    const pendingAttendance = pendingAttendanceActionRef.current;
    let action = pendingAttendance?.action || detectAttendanceVoiceAction(cleanMessage);

    if (action === "smart") {
      action = await resolveSmartAttendanceAction();

      if (action === "done") {
        const doneAnswer = "Your attendance for today is already completed.";

        setMessages((prev) => [
          ...prev,
          { role: "user", text: cleanMessage },
          { role: "assistant", text: doneAnswer },
        ]);

        if (options?.voiceInput || options?.speakAnswer) {
          setSiriStatus(doneAnswer);
          setManualChatOpen(false);
          finishVoiceAfterAttendance(doneAnswer, false);
        }

        return;
      }
    }

    if (!action) return;

    const userText = cleanMessage;

    if (!options?.voiceInput) {
      setManualChatOpen(true);
    }

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: userText,
      },
    ]);

    setMessage("");
    setVoiceHint("");
    setVoiceError("");
    setLoading(true);
    loadingRef.current = true;

    let answer = "";

    try {
      let payload = pendingAttendance?.payload || {};

      if (pendingAttendance) {
        const reason = cleanAttendanceReason(cleanMessage);

        if (reason.length < 3) {
          answer =
            pendingAttendance.action === "check_in"
              ? "Please tell me the late check-in reason clearly."
              : "Please tell me the early check-out reason clearly.";

          pendingAttendanceActionRef.current = pendingAttendance;
          voiceConversationModeRef.current = true;
        } else {
          payload = {
            ...payload,
            [pendingAttendance.reasonField]: reason,
            reason,
            remarks: reason,
          };

          const response = await submitAttendanceAction(pendingAttendance.action, payload);

          pendingAttendanceActionRef.current = null;
          notifyAttendanceUiChanged(pendingAttendance.action, response);
          answer = buildAttendanceSuccessAnswer(pendingAttendance.action, response);
          voiceConversationModeRef.current = false;
        }
      } else {
        const locationPayload = await getBrowserAttendanceLocation();

        payload = buildAttendancePayload(locationPayload);

        try {
          const response = await submitAttendanceAction(action, payload);

          pendingAttendanceActionRef.current = null;
          notifyAttendanceUiChanged(action, response);
          answer = buildAttendanceSuccessAnswer(action, response);
          voiceConversationModeRef.current = false;
        } catch (error) {
          if (action === "check_in" && isLateCheckInReasonError(error)) {
            pendingAttendanceActionRef.current = {
              action: "check_in",
              payload,
              reasonField: "late_reason",
              createdAt: Date.now(),
            };

            answer = "You are late today. Please tell me the late check-in reason.";
            voiceConversationModeRef.current = true;
          } else if (action === "check_out" && isEarlyCheckoutReasonError(error)) {
            pendingAttendanceActionRef.current = {
              action: "check_out",
              payload,
              reasonField: "early_checkout_reason",
              createdAt: Date.now(),
            };

            answer = "You are checking out early. Please tell me the early check-out reason.";
            voiceConversationModeRef.current = true;
          } else {
            pendingAttendanceActionRef.current = null;
            voiceConversationModeRef.current = false;
            answer =
              error?.message ||
              "Attendance could not be marked right now. Please try again.";
          }
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: answer,
        },
      ]);

      if (options?.voiceInput || options?.speakAnswer) {
        setSiriStatus(answer);
        setManualChatOpen(false);
        finishVoiceAfterAttendance(answer, Boolean(pendingAttendanceActionRef.current));
      } else if (autoWakeModeRef.current && pendingAttendanceActionRef.current) {
        scheduleListeningRestart(450);
      }
    } catch (error) {
      pendingAttendanceActionRef.current = null;
      voiceConversationModeRef.current = false;

      const errorMessage =
        error?.message ||
        "Attendance could not be marked. Please check location permission and try again.";

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: errorMessage,
        },
      ]);

      if (options?.voiceInput || options?.speakAnswer) {
        setSiriStatus(errorMessage);
        setManualChatOpen(false);
        finishVoiceAfterAttendance(errorMessage, false);
      } else if (autoWakeModeRef.current) {
        scheduleListeningRestart(450);
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  async function sendMessage(manualMessage, options = {}) {
    const cleanMessage = String(manualMessage ?? message ?? "").trim();

    if (!cleanMessage) return;
    if (loadingRef.current) return;

    if (!options?.voiceInput) {
      setManualChatOpen(true);
    }

    if (
      !options?.skipWakeWordCheck &&
      transcriptHasWakeWord(cleanMessage, getCurrentVoiceContext()?.wake_word || DEFAULT_WAKE_WORD)
    ) {
      await handleVoiceTranscript(cleanMessage);
      return;
    }

    if (
      pendingAttendanceActionRef.current ||
      detectAttendanceVoiceAction(cleanMessage)
    ) {
      await handleAttendanceActionMessage(cleanMessage, options);
      return;
    }

    const historyBeforeQuestion = [...messagesRef.current];

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
    loadingRef.current = true;

    try {
      const aiMessage = options?.voiceInput
        ? `${cleanMessage}\n\nReply very briefly in 1-2 short sentences because this is a voice conversation.`
        : cleanMessage;

      const response = await askAiAssistant(aiMessage, historyBeforeQuestion);

      const answer =
        response?.answer ||
        response?.message ||
        "I could not generate a response right now. Please try again.";

      if (options?.voiceInput) {
        setSiriStatus(answer);
        setManualChatOpen(false);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: answer,
        },
      ]);

      if (options?.voiceInput) {
        const projectedMessages = [
          ...historyBeforeQuestion,
          {
            role: "user",
            text: cleanMessage,
          },
          {
            role: "assistant",
            text: answer,
          },
        ];

        voiceConversationModeRef.current = shouldKeepVoiceConversation(projectedMessages, answer);
      }

      if (options?.speakAnswer) {
        const shouldRestartVoice = Boolean(voiceConversationModeRef.current);

        setManualChatOpen(false);
        speakAssistantText(answer, {
          restartAfterSpeech: shouldRestartVoice,
          onEnd: shouldRestartVoice
            ? undefined
            : () => {
                stopVoiceSession();
                setSiriStatus(answer);
              },
        });
      } else if (autoWakeModeRef.current && voiceConversationModeRef.current) {
        scheduleListeningRestart(450);
      }
    } catch (error) {
      const errorMessage =
        error?.message ||
        "AI Assistant could not respond. Please check backend and try again.";

      if (options?.voiceInput) {
        setSiriStatus(errorMessage);
        setManualChatOpen(false);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: errorMessage,
        },
      ]);

      if (options?.voiceInput) {
        voiceConversationModeRef.current = false;
      }

      if (options?.speakAnswer) {
        const shouldRestartVoice = Boolean(voiceConversationModeRef.current);

        setManualChatOpen(false);
        speakAssistantText(errorMessage, {
          restartAfterSpeech: shouldRestartVoice,
          onEnd: shouldRestartVoice
            ? undefined
            : () => {
                stopVoiceSession();
                setSiriStatus(errorMessage);
              },
        });
      } else if (autoWakeModeRef.current && voiceConversationModeRef.current) {
        scheduleListeningRestart(450);
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  function startBrowserSpeechRecognition() {
    const SpeechRecognition = getSpeechRecognition();

    if (!SpeechRecognition) {
      startGeminiVoiceLoop();
      return;
    }

    if (isStartingRecognitionRef.current || recognitionRef.current) {
      return;
    }

    try {
      const recognition = new SpeechRecognition();

      recognitionRef.current = recognition;
      isStartingRecognitionRef.current = true;
      finalTranscriptRef.current = "";
      interimTranscriptRef.current = "";
      voiceHandledRef.current = false;

      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-IN";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        isStartingRecognitionRef.current = false;
        listeningRef.current = true;
        setListening(true);
        setVoiceError("");
        setVoiceHint(
          voiceConversationModeRef.current
            ? "Listening for your voice reply..."
            : 'Listening now. Say "Hey Eve", then speak your command clearly.'
        );
      };

      recognition.onresult = (event) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const transcript = String(event.results[index][0]?.transcript || "").trim();

          if (event.results[index].isFinal) {
            finalTranscript += ` ${transcript}`;
          } else {
            interimTranscript += ` ${transcript}`;
          }
        }

        const visibleTranscript = String(finalTranscript || interimTranscript || "").trim();

        if (visibleTranscript) {
          interimTranscriptRef.current = visibleTranscript;
          setLastVoiceTranscript(visibleTranscript);
          setSiriStatus(`Heard: ${visibleTranscript}`);
        }

        if (finalTranscript.trim()) {
          finalTranscriptRef.current = finalTranscript.trim();

          try {
            recognition.stop();
          } catch {
            // ignore
          }
        }
      };

      recognition.onerror = () => {
        recognitionRef.current = null;
        isStartingRecognitionRef.current = false;
        listeningRef.current = false;
        setListening(false);

        if (
          autoWakeModeRef.current &&
          Date.now() >= voiceQuotaDisabledUntilRef.current &&
          !loadingRef.current &&
          !isSpeakingRef.current
        ) {
          startGeminiVoiceLoop();
        }
      };

      recognition.onend = async () => {
        recognitionRef.current = null;
        isStartingRecognitionRef.current = false;

        const transcript = String(
          finalTranscriptRef.current ||
            interimTranscriptRef.current ||
            ""
        ).trim();

        finalTranscriptRef.current = "";
        interimTranscriptRef.current = "";

        if (transcript && !voiceHandledRef.current) {
          voiceHandledRef.current = true;
          await handleVoiceTranscript(transcript);
          return;
        }

        if (
          autoWakeModeRef.current &&
          Date.now() >= voiceQuotaDisabledUntilRef.current &&
          !loadingRef.current &&
          !isSpeakingRef.current
        ) {
          scheduleListeningRestart(500);
        }
      };

      recognition.start();
    } catch {
      recognitionRef.current = null;
      isStartingRecognitionRef.current = false;
      startGeminiVoiceLoop();
    }
  }

  function beginListening() {
    setVoiceError("");

    if (showVoiceQuotaCooldownHint()) {
      setAutoWakeMode(false);
      setListening(false);
      listeningRef.current = false;
      geminiLoopActiveRef.current = false;
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError(
        "Microphone access is not available. Please allow microphone permission and try again."
      );
      setAutoWakeMode(false);
      return;
    }

    if (!autoWakeModeRef.current) {
      setAutoWakeMode(true);
    }

    if (isSpeakingRef.current || loadingRef.current) return;

    clearRestartTimer();

    listeningRef.current = true;
    setListening(true);
    setVoiceError("");
    setVoiceHint(
      voiceConversationModeRef.current
        ? "Listening for your voice reply..."
        : 'Listening now. Say "Hey Eve", then speak your command clearly.'
    );

    const SpeechRecognition = getSpeechRecognition();

    if (SpeechRecognition) {
      startBrowserSpeechRecognition();
      return;
    }

    if (typeof window === "undefined" || !window.MediaRecorder) {
      setVoiceError(
        "Voice recording is not available in this browser. Please use Google Chrome or Microsoft Edge."
      );
      setAutoWakeMode(false);
      return;
    }

    startGeminiVoiceLoop();
  }

  async function startVoiceMeter() {
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    if (audioStreamRef.current && analyserRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      audioStreamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;

      if (!AudioContext) return;

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;

      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        if (!analyserRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArray);

        const average =
          dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;

        const normalized = Math.min(1, Math.max(0, average / 120));

        setVoiceLevel(normalized);

        voiceMeterFrameRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch {
      setVoiceLevel(0);
    }
  }

  function stopVoiceMeter() {
    if (voiceMeterFrameRef.current) {
      cancelAnimationFrame(voiceMeterFrameRef.current);
      voiceMeterFrameRef.current = null;
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close?.();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setVoiceLevel(0);
  }

  function getBestRecordingMimeType() {
    if (typeof window === "undefined" || !window.MediaRecorder) {
      return "";
    }

    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ];

    return types.find((type) => window.MediaRecorder.isTypeSupported(type)) || "";
  }

  function cleanupCurrentAudio() {
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = "";
      } catch {
        // ignore
      }

      currentAudioRef.current = null;
    }

    if (currentAudioUrlRef.current) {
      try {
        URL.revokeObjectURL(currentAudioUrlRef.current);
      } catch {
        // ignore
      }

      currentAudioUrlRef.current = "";
    }
  }

  function playGeneratedVoice(audioUrl, onEnd) {
    cleanupCurrentAudio();

    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;

      if (typeof onEnd === "function") {
        onEnd();
      }
    };

    const audio = new Audio(audioUrl);

    currentAudioRef.current = audio;
    currentAudioUrlRef.current = audioUrl;

    audio.onended = finish;
    audio.onerror = finish;

    audio.play().catch(finish);
  }

  function stopGeminiRecording({ stopLoop = false } = {}) {
    if (stopLoop) {
      geminiLoopActiveRef.current = false;
    }

    if (voiceChunkTimerRef.current) {
      clearTimeout(voiceChunkTimerRef.current);
      voiceChunkTimerRef.current = null;
    }

    if (geminiLoopTimerRef.current) {
      clearTimeout(geminiLoopTimerRef.current);
      geminiLoopTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      try {
        suppressGeminiStopRef.current = true;
        recorder.onstop = null;
        recorder.stop();
      } catch {
        // ignore
      }
    }

    mediaRecorderRef.current = null;

    setTimeout(() => {
      suppressGeminiStopRef.current = false;
    }, 0);
  }

  function scheduleGeminiVoiceLoop(delay = 350) {
    if (!geminiLoopActiveRef.current) return;
    if (!autoWakeModeRef.current) return;
    if (Date.now() < voiceQuotaDisabledUntilRef.current) return;
    if (loadingRef.current) return;
    if (isSpeakingRef.current) return;
    if (isTranscribingRef.current) return;

    if (geminiLoopTimerRef.current) {
      clearTimeout(geminiLoopTimerRef.current);
    }

    geminiLoopTimerRef.current = setTimeout(() => {
      geminiLoopTimerRef.current = null;
      startGeminiVoiceLoop();
    }, delay);
  }

  async function startGeminiVoiceLoop() {
    if (!geminiLoopActiveRef.current) return;
    if (!autoWakeModeRef.current) return;
    if (Date.now() < voiceQuotaDisabledUntilRef.current) return;
    if (isSpeakingRef.current) return;
    if (loadingRef.current) return;
    if (isTranscribingRef.current) return;

    if (typeof window === "undefined" || !window.MediaRecorder) {
      return;
    }

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      return;
    }

    await startVoiceMeter();

    const stream = audioStreamRef.current;

    if (!stream) {
      return;
    }

    const mimeType = getBestRecordingMimeType();
    const chunks = [];

    try {
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = () => {
        mediaRecorderRef.current = null;
        scheduleGeminiVoiceLoop(900);
      };

      recorder.onstop = async () => {
        if (suppressGeminiStopRef.current) {
          return;
        }

        mediaRecorderRef.current = null;

        const shouldContinue =
          geminiLoopActiveRef.current &&
          autoWakeModeRef.current &&
          Date.now() >= voiceQuotaDisabledUntilRef.current &&
          !isSpeakingRef.current &&
          !loadingRef.current;

        if (chunks.length && shouldContinue) {
          const audioBlob = new Blob(chunks, {
            type: mimeType || "audio/webm",
          });

          await transcribeGeminiAudioBlob(audioBlob);
        }

        if (shouldContinue) {
          scheduleGeminiVoiceLoop(300);
        }
      };

      recorder.start();

      const chunkMs = voiceConversationModeRef.current ? 1600 : 2200;

      voiceChunkTimerRef.current = setTimeout(() => {
        voiceChunkTimerRef.current = null;

        try {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        } catch {
          mediaRecorderRef.current = null;
        }
      }, chunkMs);
    } catch {
      mediaRecorderRef.current = null;
      scheduleGeminiVoiceLoop(1200);
    }
  }

  async function transcribeGeminiAudioBlob(audioBlob) {
    if (!audioBlob || audioBlob.size < 1000) return;
    if (isSpeakingRef.current || loadingRef.current) return;
    if (Date.now() < voiceQuotaDisabledUntilRef.current) return;

    isTranscribingRef.current = true;

    try {
      setVoiceHint("Understanding your voice...");

    const result = await transcribeAiAssistantAudio(audioBlob, {
      timeoutMs: 22000,
    });

      const transcript = String(
        result?.text ||
          result?.transcript ||
          ""
      ).trim();

        if (!transcript) {
          setVoiceHint('Listening. I could not hear clear speech. Please speak a little closer to the mic.');
          return;
        }

      const normalized = normalizeVoiceText(transcript);
      const now = Date.now();

        if (
          normalized &&
          normalized === lastHandledTranscriptRef.current &&
          now - lastHandledTranscriptAtRef.current < 2200
        ) {
          return;
        }

      lastHandledTranscriptRef.current = normalized;
      lastHandledTranscriptAtRef.current = now;

      setLastVoiceTranscript(transcript);

      await handleVoiceTranscript(transcript);
    } catch (error) {
      if (isVoiceQuotaError(error)) {
        pauseVoiceForQuota(error, "STT");
        return;
      }

      const errorMessage =
        error?.message ||
        "Voice understanding failed. Please check backend voice service logs.";

      setVoiceError(errorMessage);
      setVoiceHint("");

      stopGeminiRecording({ stopLoop: true });

      setTimeout(() => {
        if (
          autoWakeModeRef.current &&
          !loadingRef.current &&
          !isSpeakingRef.current &&
          Date.now() >= voiceQuotaDisabledUntilRef.current
        ) {
          setVoiceError("");
          geminiLoopActiveRef.current = true;
          beginListening();
        }
      }, 2200);
    } finally {
      isTranscribingRef.current = false;
    }
  }

  function startListening() {
    if (listeningRef.current || isStartingRecognitionRef.current) {
      stopVoiceSession();
      setVoiceHint("Voice listening stopped. Click mic or Eve again to reactivate.");
      return;
    }

    if (showVoiceQuotaCooldownHint()) {
      return;
    }

    setAutoWakeMode(true);
    setEveActive(true);
    setManualChatOpen(false);
    setVoiceError("");
    setSiriStatus('Listening. Say “Hey Eve” anytime.');
    setVoiceHint('Listening now. Say "Hey Eve" and speak your command clearly.');
    lastVoiceActivationAtRef.current = Date.now();
    geminiLoopActiveRef.current = true;
    startVoiceMeter();
    beginListening();
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
    stopVoiceSession();
    stopVoiceMeter();
    voiceQuotaDisabledUntilRef.current = 0;
    setManualChatOpen(false);
    setSiriStatus("Click once to activate Eve voice");
    setLastVoiceTranscript("");
    setMessages([WELCOME_MESSAGE]);
    setMessage("");
    setVoiceHint("");
    setVoiceError("");
    setLoading(false);
    loadingRef.current = false;
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={activateEve}
          title="Open SDS HRMS AI Assistant"
          className="ai-assistant-launcher-fixed"
        >
          <span className="ai-assistant-online-dot-fixed" />
          <MessageCircle size={30} />
        </button>
      )}

      {open && (
        <div
          className={`ai-assistant-panel ai-glass-phone ${
            showChat ? "has-chat" : "is-home"
          }`}
        >
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

          {!showChat && (
            <div className="ai-hero-zone">
              <div className="ai-soft-grid" />

              <div className="ai-intro-copy">
                <p>SDS HRMS Assistant</p>
                <h2>
                  AI Powers <span>Leave, Attendance</span> And HR Workflows
                </h2>
              </div>

              <div className="ai-project-scope-grid">
                {PROJECT_MODULES.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>

              <div
                className={`ai-orb-shell ${
                  loading ? "is-thinking" : listening ? "is-listening" : ""
                }`}
                style={{
                  "--voice-level": voiceLevel,
                  "--voice-scale": 1 + voiceLevel * 0.22,
                  "--voice-glow": 0.18 + voiceLevel * 0.42,
                }}
              >
                <div className="ai-orb-core">
                  <div className="ai-orb-gloss" />
                  <div className="ai-orb-shine" />
                  <div className="ai-orb-ring one" />
                  <div className="ai-orb-ring two" />
                  <div className="ai-orb-ring three" />
                  <Mic size={28} className="ai-orb-mic" />
                  <div className="ai-siri-wave">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
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
                    <strong>{siriStatus || "Listening..."}</strong>
                    <span>
                      {lastVoiceTranscript
                        ? `Heard: ${lastVoiceTranscript}`
                        : "Start with “Hey Eve”, then speak your command."}
                    </span>
                  </>
                ) : (
                  <>
                    <small>Ready</small>
                    <strong>{eveActive ? siriStatus : "Click Eve once to activate voice"}</strong>
                    <span>Manual typing opens the full chat. Voice stays in Siri mode.</span>
                  </>
                )}
              </div>
            </div>
          )}

          {showChat && actionMode && (
            <div className="ai-action-mode-strip">
              <span>{actionMode}</span>
              <small>Guided action is active</small>
            </div>
          )}

          {!showChat && (
            <div className="ai-assistant-quick-row">
              {QUICK_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setManualChatOpen(true);
                    sendMessage(question);
                  }}
                >
                  {question}
                </button>
              ))}
            </div>
          )}

          {showChat && (
            <div className="ai-response-area">
              <div className="ai-assistant-messages">
                {visibleMessages.map((item, index) => {
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
                              onClick={() => speakAssistantText(item.text)}
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
          )}

          {showChat && quickReplies.length > 0 && (
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
                    Start with “Hey Eve”, then speak your command.
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
                onFocus={() => setManualChatOpen(true)}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={listening ? 'Say "Hey Eve"...' : 'Ask me anything or say "Hey Eve"...'}
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
                  onClick={activateEve}
                  disabled={loading}
                >
                  <Volume2 size={16} />
                  Hey Eve
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
              <span>{autoWakeActive ? 'Eve is active in this browser session' : 'Click once to activate Eve voice'}</span>
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


        .ai-project-scope-grid {
          position: relative;
          z-index: 1;
          width: min(360px, 100%);
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 6px;
          margin-top: 14px;
        }

        .ai-project-scope-grid span {
          border: 1px solid rgba(226,232,240,.78);
          background: rgba(255,255,255,.62);
          color: #475569;
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 10px;
          line-height: 1;
          font-weight: 900;
          box-shadow: 0 8px 18px rgba(15,23,42,.035);
          backdrop-filter: blur(12px);
        }

        .ai-orb-shell {
          position: relative;
          z-index: 1;
          width: 150px;
          height: 174px;
          margin-top: 18px;
          display: grid;
          justify-items: center;
          transform: scale(var(--voice-scale, 1));
          transition: transform 120ms ease-out;
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
          transform: scale(var(--voice-scale, 1));
          box-shadow:
            0 30px 72px rgba(236,72,153,var(--voice-glow, .28)),
            0 0 0 calc(10px + (var(--voice-level, 0) * 18px)) rgba(236,72,153,.10),
            0 0 0 calc(22px + (var(--voice-level, 0) * 24px)) rgba(34,211,238,.08),
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


        .ai-siri-wave {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          pointer-events: none;
          opacity: .78;
        }

        .ai-siri-wave span {
          width: 5px;
          height: calc(15px + (var(--voice-level, 0) * 42px));
          border-radius: 999px;
          background: rgba(255,255,255,.72);
          box-shadow: 0 0 18px rgba(255,255,255,.48);
          transform-origin: center;
          animation: aiSiriWave 780ms ease-in-out infinite alternate;
        }

        .ai-siri-wave span:nth-child(1) {
          animation-delay: 0ms;
          transform: scaleY(calc(.65 + var(--voice-level, 0)));
        }

        .ai-siri-wave span:nth-child(2) {
          animation-delay: 90ms;
          transform: scaleY(calc(.9 + var(--voice-level, 0)));
        }

        .ai-siri-wave span:nth-child(3) {
          animation-delay: 180ms;
          transform: scaleY(calc(1.2 + var(--voice-level, 0)));
        }

        .ai-siri-wave span:nth-child(4) {
          animation-delay: 270ms;
          transform: scaleY(calc(.9 + var(--voice-level, 0)));
        }

        .ai-siri-wave span:nth-child(5) {
          animation-delay: 360ms;
          transform: scaleY(calc(.65 + var(--voice-level, 0)));
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

        .ai-glass-phone.has-chat .ai-response-area {
          margin-top: 8px;
        }

        .ai-glass-phone.has-chat .ai-assistant-input-area {
          padding-top: 12px;
        }

        .ai-glass-phone.has-chat .ai-top-bar {
          padding-bottom: 12px;
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

        @keyframes aiSiriWave {
          from {
            opacity: .45;
            filter: blur(0);
          }

          to {
            opacity: 1;
            filter: blur(.4px);
          }
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
