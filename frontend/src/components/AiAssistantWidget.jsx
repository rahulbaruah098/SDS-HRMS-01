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
import { askAiAssistant, getAiAssistantVoiceContext } from "../api/client";

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
  "hey eave",
  "hi eave",
  "hello eave",
  "hey ev",
  "hi ev",
  "hello ev",
  "hey e",
  "hi e",
  "hello e",
  "hey iv",
  "hi iv",
  "hey if",
  "hi if",
  "hay eve",
  "hai eve",
  "hii eve",
  "okay eve",
  "ok eve",
  "hey evie",
  "hi evie",
  "hello evie",
  "hey eevee",
  "hi eevee",
  "hello eevee",
  "hey ivy",
  "hi ivy",
  "hey evening",
  "a eve",
  "eve",
  "eave",
  "eevee",
  "evie",
  "evi",
  "iv",
  "heave",
  "heavy",
  "he is",
  "his",
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

    setListening(false);
    listeningRef.current = false;
    isStartingRecognitionRef.current = false;
  }

  function stopVoiceSession() {
    clearRestartTimer();
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
    if (loadingRef.current) return;
    if (isSpeakingRef.current) return;

    restartListenTimerRef.current = setTimeout(() => {
      restartListenTimerRef.current = null;
      beginListening();
    }, delay);
  }

  function speakAssistantText(text, options = {}) {
    const { restartAfterSpeech = true, onEnd } = options;

    stopRecognition({ suppressRestart: true });
    isSpeakingRef.current = true;

    speakText(text, () => {
      isSpeakingRef.current = false;

      if (typeof onEnd === "function") {
        onEnd();
      }

      if (restartAfterSpeech) {
        scheduleListeningRestart(450);
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
    setAutoWakeMode(true);
    voiceConversationModeRef.current = false;
    pendingGreetingRef.current = "";

    setEveActive(true);
    setOpen(true);
    setManualChatOpen(false);
    setMessage("");
    setLastVoiceTranscript("");
    setSiriStatus("Eve is active. Say “Hey Eve” anytime.");
    setVoiceHint("Eve is active. Keep this browser tab open and say “Hey Eve” anytime.");
    setVoiceError("");

    await refreshVoiceContextIfNeeded(true);
    await startVoiceMeter();

    beginListening();
  }

  async function handleVoiceTranscript(rawText) {
    const transcript = String(rawText || "").trim();

    if (!transcript) return;
    if (loadingRef.current || isSpeakingRef.current) return;

    const context = await refreshVoiceContextIfNeeded();
    const wakeWord = context?.wake_word || DEFAULT_WAKE_WORD;
    const hasWakeWord = transcriptHasWakeWord(transcript, wakeWord);

    if (!hasWakeWord && !voiceConversationModeRef.current) {
      setMessage("");
      setLastVoiceTranscript(transcript);
      setSiriStatus('Waiting for “Hey Eve”.');
      setVoiceHint('Listening in the background. Say "Hey Eve" to open the assistant.');
      scheduleListeningRestart(450);
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
      const response = await askAiAssistant(cleanMessage, historyBeforeQuestion);

      const answer =
        response?.answer ||
        response?.message ||
        "I could not generate a response right now. Please try again.";

      if (options?.voiceInput) {
        setSiriStatus(answer);
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
        speakAssistantText(answer, { restartAfterSpeech: true });
      } else if (autoWakeModeRef.current) {
        scheduleListeningRestart(450);
      }
    } catch (error) {
      const errorMessage =
        error?.message ||
        "AI Assistant could not respond. Please check backend and try again.";

      if (options?.voiceInput) {
        setSiriStatus(errorMessage);
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
        speakAssistantText(errorMessage, { restartAfterSpeech: true });
      } else if (autoWakeModeRef.current) {
        scheduleListeningRestart(450);
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  function beginListening() {
    setVoiceError("");

    const SpeechRecognition = getSpeechRecognition();

    if (!SpeechRecognition) {
      setVoiceError(
        "Speech-to-text is not available in this browser. Use Google Chrome on http://localhost:5173, or type your question manually."
      );
      setAutoWakeMode(false);
      return;
    }

    if (!autoWakeModeRef.current) {
      setAutoWakeMode(true);
    }

    if (listeningRef.current || isStartingRecognitionRef.current) return;
    if (isSpeakingRef.current || loadingRef.current) return;

    try {
      clearRestartTimer();
      finalTranscriptRef.current = "";
      voiceHandledRef.current = false;
      isStartingRecognitionRef.current = true;

      const recognition = new SpeechRecognition();

      recognition.lang = "en-IN";
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 3;

      recognition.onstart = () => {
        isStartingRecognitionRef.current = false;
        listeningRef.current = true;
        setListening(true);
        setVoiceError("");
        setVoiceHint(
          voiceConversationModeRef.current
            ? "Listening for your voice reply..."
            : 'Listening in the background. Say "Hey Eve" anytime.'
        );

        const pendingGreeting = pendingGreetingRef.current;

        if (pendingGreeting) {
          pendingGreetingRef.current = "";
          speakAssistantText(pendingGreeting, { restartAfterSpeech: true });
        }
      };

      recognition.onerror = (event) => {
        isStartingRecognitionRef.current = false;

        const errorType = event?.error || "";

        if (suppressNextRestartRef.current || isSpeakingRef.current) {
          return;
        }

        if (errorType === "not-allowed" || errorType === "service-not-allowed") {
          setListening(false);
          listeningRef.current = false;
          setAutoWakeMode(false);
          setVoiceError(
            "Microphone permission denied. Click the browser lock icon and allow microphone access."
          );
          return;
        }

        if (errorType === "no-speech" || errorType === "aborted") {
          setVoiceHint('Still active. Say "Hey Eve" when you need me.');
          return;
        }

        if (errorType === "network") {
          setVoiceError(
            "Speech recognition network error. Please use Chrome and a stable internet connection."
          );
          scheduleListeningRestart(1200);
          return;
        }

        setVoiceError(`Voice input failed${errorType ? `: ${errorType}` : ""}.`);
        scheduleListeningRestart(1200);
      };

      recognition.onresult = (event) => {
        if (isSpeakingRef.current || loadingRef.current) return;

        let finalText = "";
        let interimText = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
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
          voiceHandledRef.current = true;
          setMessage(cleanFinalText);
          handleVoiceTranscript(cleanFinalText);
          return;
        }

        if (cleanInterimText) {
          setMessage(cleanInterimText);
          setVoiceHint(
            voiceConversationModeRef.current
              ? "Listening for your voice reply..."
              : 'Listening... waiting for "Hey Eve".'
          );
        }
      };

      recognition.onend = () => {
        isStartingRecognitionRef.current = false;
        listeningRef.current = false;
        setListening(false);
        recognitionRef.current = null;

        if (suppressNextRestartRef.current) {
          suppressNextRestartRef.current = false;
          return;
        }

        if (autoWakeModeRef.current) {
          scheduleListeningRestart(500);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (error) {
      isStartingRecognitionRef.current = false;
      listeningRef.current = false;
      setListening(false);
      setVoiceError(
        error?.message ||
          "Could not start microphone. Please check browser microphone permission."
      );
      scheduleListeningRestart(1200);
    }
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

  function startListening() {
    if (listeningRef.current || isStartingRecognitionRef.current) {
      stopVoiceSession();
      setVoiceHint("Voice listening stopped. Click mic or Eve again to reactivate.");
      return;
    }

    setAutoWakeMode(true);
    setEveActive(true);
    setManualChatOpen(false);
    setVoiceError("");
    setSiriStatus('Listening. Say “Hey Eve” anytime.');
    setVoiceHint('Listening in the background. Say "Hey Eve" anytime.');
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