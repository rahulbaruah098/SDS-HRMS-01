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
  currentEmployee,
  currentUser,
  checkOutAttendance,
  getAiAssistantVoiceContext,
  getAttendanceStatus,
  speakAiAssistantText,
  transcribeAiAssistantAudio,
} from "../api/client";

const ASSISTANT_NAME = "Saya";
const PRODUCT_NAME = "YourComate HRMS";

const ROLE_PRIORITY = [
  "super_admin",
  "admin",
  "hr_admin",
  "hr_manager",
  "hr",
  "accounts_finance",
  "finance",
  "reporting_officer",
  "team_leader",
  "employee",
];

const ROLE_ALIASES = {
  superadmin: "super_admin",
  "super admin": "super_admin",
  platform_superadmin: "super_admin",
  platform_admin: "super_admin",
  administrator: "admin",
  tenant_admin: "admin",
  hradmin: "hr_admin",
  "hr admin": "hr_admin",
  hrmanager: "hr_manager",
  "hr manager": "hr_manager",
  human_resources: "hr",
  "human resources": "hr",
  accounts: "accounts_finance",
  "accounts finance": "accounts_finance",
  finance_accounts: "accounts_finance",
  "finance accounts": "accounts_finance",
  teamleader: "team_leader",
  "team leader": "team_leader",
  reporting_officer: "reporting_officer",
  "reporting officer": "reporting_officer",
  manager: "employee",
  staff: "employee",
  user: "employee",
};

const ROLE_LABELS = {
  super_admin: "Platform Super Admin",
  admin: "Tenant Admin",
  hr_admin: "HR Admin",
  hr_manager: "HR Manager",
  hr: "HR",
  accounts_finance: "Accounts & Finance",
  finance: "Finance",
  reporting_officer: "Reporting Officer",
  team_leader: "Team Leader",
  employee: "Employee",
};

const SUBSCRIPTION_LABELS = {
  platform_superadmin: "Platform administration",
  lifetime: "Lifetime access",
  demo: "Demo / trial",
  essential: "Essential plan",
  growth: "Growth plan",
  premium: "Premium plan",
  paid_other: "Paid subscription",
  expired: "Renewal required",
  unknown: "Subscription status unavailable",
};

const ROLE_QUICK_QUESTIONS = {
  super_admin: [
    "What is the current Growth plan price?",
    "How do I approve a trial company?",
    "Show the complete Premium quotation workflow",
    "How do I manage tenant subscriptions?",
    "How do employee limits work?",
    "Which platform notifications need attention?",
  ],
  admin: [
    "How do I create and onboard an employee?",
    "How do I manage attendance and leave?",
    "Which subscription plan is my company using?",
    "How do I upgrade to Premium?",
    "How do I configure company branding?",
    "How do I view tenant reports?",
  ],
  hr_admin: [
    "Show the complete employee onboarding workflow",
    "How does leave approval hierarchy work?",
    "How do I synchronize attendance for payroll?",
    "How do I complete payroll HR Review?",
    "How do I manage employee resignation and alumni?",
    "How do I run performance reviews?",
  ],
  hr_manager: [
    "Show the complete employee onboarding workflow",
    "How does leave approval hierarchy work?",
    "How do I synchronize attendance for payroll?",
    "How do I complete payroll HR Review?",
    "How do I manage policies and grievances?",
    "Which HR reports are available?",
  ],
  hr: [
    "How do I create and onboard an employee?",
    "How does leave approval hierarchy work?",
    "How do I correct attendance?",
    "How do I synchronize attendance for payroll?",
    "How do I complete payroll HR Review?",
    "How do I manage holiday work and comp-off?",
  ],
  accounts_finance: [
    "Show the complete monthly payroll workflow",
    "How do I complete Finance Approval?",
    "How do I lock and disburse payroll?",
    "How do I verify employee bank details?",
    "How do I generate PF, PT and TDS reports?",
    "How do loans, advances and reimbursements work?",
  ],
  finance: [
    "Show the complete monthly payroll workflow",
    "How do I complete Finance Approval?",
    "How do I lock and disburse payroll?",
    "How do I verify employee bank details?",
    "How do I generate PF, PT and TDS reports?",
    "How do loans, advances and reimbursements work?",
  ],
  reporting_officer: [
    "How do I review final team approvals?",
    "How do I monitor project progress?",
    "How do I review team performance?",
    "How do I view my attendance and leave?",
    "How do I download my payslip?",
    "How do I raise an IT support request?",
  ],
  team_leader: [
    "How do I review first-level team approvals?",
    "How do I update project progress?",
    "How do I review my team workload?",
    "How do I view my attendance and leave?",
    "How do I download my payslip?",
    "How do I raise an IT support request?",
  ],
  employee: [
    "How do I apply for leave?",
    "How do I check in or check out?",
    "How do I view my leave balance?",
    "How do I download my payslip?",
    "How do I update project progress?",
    "How do I raise an IT support request?",
  ],
};

const ROLE_MODULES = {
  super_admin: ["Tenants", "Trials", "Pricing", "Premium", "Billing", "Notifications", "Audit Logs"],
  admin: ["Employees", "Attendance", "Leave", "Projects", "Payroll", "Reports", "Billing", "Settings"],
  hr_admin: ["Employees", "Attendance", "Leave", "Payroll", "Performance", "Policies", "Reports"],
  hr_manager: ["Employees", "Attendance", "Leave", "Payroll", "Performance", "Policies", "Reports"],
  hr: ["Employees", "Attendance", "Leave", "Payroll", "Assets", "Policies", "Reports"],
  accounts_finance: ["Payroll", "Banking", "PF / PT / TDS", "Loans", "Reimbursements", "Tax", "Reports"],
  finance: ["Payroll", "Banking", "PF / PT / TDS", "Loans", "Reimbursements", "Tax", "Reports"],
  reporting_officer: ["Team Approvals", "Projects", "Performance", "Attendance", "Leave", "Payslips"],
  team_leader: ["Team Approvals", "Projects", "Progress", "Attendance", "Leave", "Payslips"],
  employee: ["Attendance", "Leave", "Projects", "Payslips", "Assets", "Policies", "IT Support"],
};

function normalizeRole(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, " ");

  if (!normalized) return "";

  return ROLE_ALIASES[normalized] || ROLE_ALIASES[normalized.replace(/ /g, "_")] || normalized.replace(/ /g, "_");
}

function uniqueValues(values = []) {
  return values.filter((value, index, list) => value && list.indexOf(value) === index);
}

function resolvePrimaryRole(roles = []) {
  const normalizedRoles = uniqueValues(roles.map(normalizeRole));
  return ROLE_PRIORITY.find((role) => normalizedRoles.includes(role)) || normalizedRoles[0] || "employee";
}

function deriveSubscriptionProfile(user = {}) {
  const subscription = user?.subscription || user?.tenant?.subscription || {};
  const status = String(
    subscription?.subscription_status ||
      subscription?.status ||
      user?.subscription_status ||
      ""
  ).toLowerCase();
  const planCode = String(
    subscription?.selected_plan_code ||
      subscription?.plan_code ||
      subscription?.plan ||
      user?.selected_plan_code ||
      user?.plan_code ||
      ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (user?.is_platform_superadmin || normalizeRole(user?.role) === "super_admin") {
    return "platform_superadmin";
  }

  if (subscription?.is_lifetime || status === "lifetime") return "lifetime";
  if (
    subscription?.is_expired ||
    subscription?.is_suspended ||
    subscription?.requires_payment ||
    ["expired", "suspended", "payment_required"].includes(status)
  ) {
    return "expired";
  }

  if (subscription?.is_demo_company || user?.is_demo_company) return "demo";
  if (["essential", "growth", "premium"].includes(planCode)) return planCode;
  if (subscription?.is_paid_company || user?.is_paid_company) return "paid_other";

  const planType = String(subscription?.plan_type || user?.plan_type || "").toLowerCase();
  const trialStatus = String(subscription?.trial_status || user?.trial_status || "").toLowerCase();

  if (planType === "demo" || ["active", "trial", "running"].includes(trialStatus)) {
    return "demo";
  }

  return "unknown";
}

function buildInitialAssistantContext() {
  let user = {};
  let employee = {};

  try {
    user = currentUser?.() || {};
  } catch {
    user = {};
  }

  try {
    employee = currentEmployee?.() || {};
  } catch {
    employee = {};
  }

  const roleCandidates = [
    ...(Array.isArray(user?.roles) ? user.roles : []),
    user?.role,
  ]
    .map(normalizeRole)
    .filter(Boolean);

  const hasProtectedRole = roleCandidates.some((role) =>
    ["super_admin", "admin", "hr_admin", "hr_manager", "hr", "finance", "accounts_finance"].includes(role)
  );

  const effectiveRoles = hasProtectedRole
    ? [...roleCandidates]
    : ["employee"];

  if (employee?.is_team_leader) effectiveRoles.push("team_leader");
  if (employee?.is_reporting_officer) effectiveRoles.push("reporting_officer");

  const roles = uniqueValues(effectiveRoles.map(normalizeRole));
  const primaryRole = resolvePrimaryRole(roles);
  const designation = String(
    employee?.designation_name ||
      employee?.designation ||
      user?.designation_name ||
      user?.designation ||
      ""
  ).trim();

  return {
    assistant_name: ASSISTANT_NAME,
    primary_role: primaryRole,
    effective_roles: roles.length ? roles : ["employee"],
    subscription_profile: deriveSubscriptionProfile(user),
    designation,
    detected_modules: [],
  };
}

function mergeAssistantContext(current = {}, incoming = {}) {
  const incomingRoles = Array.isArray(incoming?.effective_roles)
    ? incoming.effective_roles.map(normalizeRole).filter(Boolean)
    : [];
  const currentRoles = Array.isArray(current?.effective_roles)
    ? current.effective_roles.map(normalizeRole).filter(Boolean)
    : [];
  const effectiveRoles = uniqueValues(incomingRoles.length ? incomingRoles : currentRoles);
  const incomingPrimary = normalizeRole(incoming?.primary_role);
  const primaryRole = incomingPrimary || resolvePrimaryRole(effectiveRoles) || current?.primary_role || "employee";

  return {
    ...current,
    ...incoming,
    assistant_name: String(incoming?.assistant_name || current?.assistant_name || ASSISTANT_NAME).trim() || ASSISTANT_NAME,
    primary_role: primaryRole,
    effective_roles: effectiveRoles.length ? effectiveRoles : [primaryRole],
    subscription_profile:
      String(incoming?.subscription_profile || current?.subscription_profile || "unknown").trim().toLowerCase() || "unknown",
    designation: String(incoming?.designation || current?.designation || "").trim(),
    detected_modules: Array.isArray(incoming?.detected_modules)
      ? uniqueValues(incoming.detected_modules.map((item) => String(item || "").trim()).filter(Boolean))
      : current?.detected_modules || [],
  };
}

function getRoleLabel(context = {}) {
  const primaryRole = normalizeRole(context?.primary_role) || "employee";
  return ROLE_LABELS[primaryRole] || "Employee";
}

function getSubscriptionLabel(context = {}) {
  const profile = String(context?.subscription_profile || "unknown").toLowerCase();
  return SUBSCRIPTION_LABELS[profile] || SUBSCRIPTION_LABELS.unknown;
}

function buildRoleQuickQuestions(context = {}) {
  const primaryRole = normalizeRole(context?.primary_role) || "employee";
  const baseQuestions = ROLE_QUICK_QUESTIONS[primaryRole] || ROLE_QUICK_QUESTIONS.employee;
  const designation = String(context?.designation || "").toLowerCase();

  if (/managing director|chief executive officer|\bceo\b|\bdirector\b/.test(designation)) {
    return uniqueValues([
      "Which dashboards and reports should I review?",
      "How do I monitor organisation-wide performance?",
      ...baseQuestions,
    ]).slice(0, 7);
  }

  return baseQuestions.slice(0, 7);
}

function buildRoleModules(context = {}) {
  const primaryRole = normalizeRole(context?.primary_role) || "employee";
  return ROLE_MODULES[primaryRole] || ROLE_MODULES.employee;
}

function buildWelcomeMessage(context = {}) {
  const roleLabel = getRoleLabel(context);
  const subscriptionLabel = getSubscriptionLabel(context);

  return {
    role: "assistant",
    text:
      `Hi, I am ${ASSISTANT_NAME}, your ${PRODUCT_NAME} Assistant. ` +
      `I will guide you according to your ${roleLabel} access and ${subscriptionLabel}. ` +
      "Ask me for exact steps, workflow explanations, live information available to your login, or help using any module you are permitted to access.",
  };
}

function normalizeAssistantAnswer(value) {
  return String(value || "")
    .replace(/SDS HRMS Assistant/gi, `${PRODUCT_NAME} Assistant`)
    .trim();
}

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isIosDevice() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";

  return (
    /iPad|iPhone|iPod/i.test(ua) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isMobileBrowser() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  return (
    isIosDevice() ||
    /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || "")
  );
}

function isMobileSafari() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent || "";

  return (
    isIosDevice() &&
    /Safari/i.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)
  );
}

function supportsReliableBrowserSpeechRecognition() {
  if (typeof window === "undefined") return false;

  // FILE_TWELVE_FORCE_MOBILE_BACKEND_STT_FIX
  // Root cause: Android Chrome SpeechRecognition can turn the mic on/off
  // without returning a final transcript. So mobile must use MediaRecorder
  // + backend STT instead. Keep browser SpeechRecognition only for desktop.
  if (isMobileBrowser()) return false;

  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function getMobileVoiceChunkMs() {
  if (!isMobileBrowser()) return 0;

  return 4200;
}

function formatLocationAccuracy(accuracy) {
  const value = Number(accuracy);

  if (!Number.isFinite(value)) return "";

  return `${Math.round(value)}m`;
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

  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }

  const chunks = cleanText
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]*/g)
    ?.map((item) => item.trim())
    .filter(Boolean) || [cleanText];

  let index = 0;
  let finished = false;
  let resumeTimer = null;

  const stopResumeTimer = () => {
    if (resumeTimer) {
      clearInterval(resumeTimer);
      resumeTimer = null;
    }
  };

  const speakNext = () => {
    if (finished) return;

    if (index >= chunks.length) {
      finished = true;
      stopResumeTimer();
      finish();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    index += 1;

    const voices = window.speechSynthesis.getVoices?.() || [];
    const preferredVoice =
      voices.find((voice) => /en-IN/i.test(voice.lang || "")) ||
      voices.find((voice) => /^en-/i.test(voice.lang || "")) ||
      voices[0];

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.lang = preferredVoice?.lang || "en-IN";
    utterance.rate = isIosDevice() ? 0.88 : 0.92;
    utterance.pitch = 1.02;
    utterance.volume = 1;

    utterance.onend = () => {
      setTimeout(speakNext, 120);
    };

    utterance.onerror = () => {
      setTimeout(speakNext, 120);
    };

    try {
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.resume?.();

      stopResumeTimer();
      resumeTimer = setInterval(() => {
        try {
          window.speechSynthesis.resume?.();
        } catch {
          // ignore
        }
      }, 250);
    } catch {
      finished = true;
      stopResumeTimer();
      finish();
    }
  };

  const startSpeaking = () => {
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume?.();
    } catch {
      // ignore
    }

    speakNext();
  };

  const voices = window.speechSynthesis.getVoices?.() || [];

  if (!voices.length && typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
    window.speechSynthesis.onvoiceschanged = startSpeaking;
    setTimeout(startSpeaking, 350);
  } else {
    startSpeaking();
  }

  return {
    cancel: () => {
      finished = true;
      stopResumeTimer();
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    },
  };
}

const DEFAULT_WAKE_WORD = "hey saya";
const FINAL_IPHONE_WAKE_AND_AUDIO_STABILITY_FIX = true;
const FILE_ONE_SAYA_WAKE_MOBILE_FIX = true;

const WAKE_WORD_VARIANTS = [
  // FINAL_SAYA_WAKE_WORD_VARIANTS_FIX
  // Primary assistant name is Saya. Keep phonetic variants because mobile STT often hears it differently.
  "hey saya",
  "hi saya",
  "hello saya",
  "okay saya",
  "ok saya",
  "saya",
  "saaya",
  "saiya",
  "saiyaa",
  "sayaa",
  "say a",
  "sayaah",
  "saiyaah",
  "sai",
  "sya",
  "sayya",
  "sayiya",
  "saya ji",
  "hey saaya",
  "hi saaya",
  "hello saaya",
  "hey saiya",
  "hi saiya",
  "hello saiya",
  "hey sayaa",
  "hi sayaa",
  "hello sayaa",

  "bisa ya",
  "besa ya",
  "visa ya",
  "vissa ya",
  "bisha ya",
  "visha ya",
  "bisaya",
  "besaia",
  "visaya",
  "vishaya",
  "bisa",
  "besa",
  "visa",
  "bisha",
  "visha",
  "bi saya",
  "be saya",
  "vi saya",
  "b say a",
  "bee saya",];

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

function isLikelyMisheardSayaWakeOnly(value) {
  // FILE_NINE_SAYA_WAKE_GREETING_FIX
  // Mobile STT sometimes hears "Hey Saya" as "thank you" or similar.
  // Treat these as wake-only only inside active voice mode / just after mic tap.
  const text = normalizeVoiceText(value);

  if (!text) return false;

  const wakeOnlyMatches = [
    "thank you",
    "thankyou",
    "thank u",
    "thanks you",
    "saya",
    "saaya",
    "saiya",
    "sayaa",
    "shaya",
    "zaya",
    "hey saya",
    "hi saya",
    "hello saya",
    "he saya",
    "hai saya",
    "hii saya",
    "hey saaya",
    "hi saaya",
    "hey saiya",
    "hi saiya",
    "hey sayaa",
    "hi sayaa",
    "hey shaya",
    "hi shaya",
    "hey zaya",
    "hi zaya",
  
    "bisa ya",
    "besa ya",
    "visa ya",
    "vissa ya",
    "bisha ya",
    "visha ya",
    "bisaya",
    "besaia",
    "visaya",
    "vishaya",
    "bisa",
    "besa",
    "visa",
    "bisha",
    "visha",
    "bi saya",
    "be saya",
    "vi saya",
    "b say a",
    "bee saya",];

  if (wakeOnlyMatches.includes(text)) {
    return true;
  }

  return /^(hey|hi|hello|ok|okay)\s+(saya|saaya|saiya|sayaa|shaya|zaya)$/.test(text);
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
  const initialAssistantContextRef = useRef(null);

  if (!initialAssistantContextRef.current) {
    initialAssistantContextRef.current = buildInitialAssistantContext();
  }

  const [assistantContext, setAssistantContext] = useState(initialAssistantContextRef.current);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([buildWelcomeMessage(initialAssistantContextRef.current)]);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState("");
  const [iosVoicePlayRequest, setIosVoicePlayRequest] = useState(null);
  const [voiceError, setVoiceError] = useState("");
  const [voiceContext, setVoiceContext] = useState(null);
  const [sayaActive, setSayaActive] = useState(false);
  const [autoWakeActive, setAutoWakeActive] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [manualChatOpen, setManualChatOpen] = useState(false);
  const [siriStatus, setSiriStatus] = useState("Click once to activate Saya voice");
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState("");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [mobileReplayText, setMobileReplayText] = useState("");

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
  const messagesRef = useRef([buildWelcomeMessage(initialAssistantContextRef.current)]);
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
  const iosUnlockAudioRef = useRef(null);
  const iosVoiceAudioRef = useRef(null);
  const iosPendingVoiceRef = useRef({ audioUrl: "", onEnd: null });
  const iosTtsAudioContextRef = useRef(null);
  const iosTtsSourceRef = useRef(null);
  const lastHandledTranscriptRef = useRef("");
  const lastHandledTranscriptAtRef = useRef(0);
  const voiceQuotaDisabledUntilRef = useRef(0);
  const lastVoiceActivationAtRef = useRef(0);
  const pendingAttendanceActionRef = useRef(null);
  const speakingSafetyTimerRef = useRef(null);
  const oneShotVoiceModeRef = useRef(false);
  const iosAudioUnlockedRef = useRef(false);
  const lastSpeakableAnswerRef = useRef("");
  const mobileSpeechUnlockedRef = useRef(false);
  const lastMobileGeneratedTtsTextRef = useRef("");
  const lastMobileGeneratedTtsAtRef = useRef(0);
  const lastWakeGreetingTtsAtRef = useRef(0);

  const hasStartedChat = useMemo(
    () => messages.some((item) => item.role === "user"),
    [messages]
  );

  const showChat = manualChatOpen && hasStartedChat;

  const visibleMessages = useMemo(
    () => (showChat ? messages.filter((_, index) => index > 0) : []),
    [showChat, messages]
  );

  const roleQuickQuestions = useMemo(
    () => buildRoleQuickQuestions(assistantContext),
    [assistantContext]
  );
  const roleModules = useMemo(
    () => buildRoleModules(assistantContext),
    [assistantContext]
  );
  const roleLabel = useMemo(
    () => getRoleLabel(assistantContext),
    [assistantContext]
  );
  const subscriptionLabel = useMemo(
    () => getSubscriptionLabel(assistantContext),
    [assistantContext]
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

      if (speakingSafetyTimerRef.current) {
        clearTimeout(speakingSafetyTimerRef.current);
        speakingSafetyTimerRef.current = null;
      }

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

  function getIosSilentAudioElement() {
    if (!isIosDevice() || typeof document === "undefined") {
      return null;
    }

    if (iosUnlockAudioRef.current) {
      return iosUnlockAudioRef.current;
    }

    const audio = document.createElement("audio");

    // 1-frame silent WAV. iPhone needs an actual media element touched by a user gesture.
    audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
    audio.preload = "auto";
    audio.muted = true;
    audio.volume = 0;
    audio.playsInline = true;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.style.position = "fixed";
    audio.style.left = "-9999px";
    audio.style.width = "1px";
    audio.style.height = "1px";
    audio.style.opacity = "0";
    audio.style.pointerEvents = "none";

    try {
      document.body.appendChild(audio);
    } catch {
      // ignore
    }

    iosUnlockAudioRef.current = audio;
    return audio;
  }

  function getIosVoiceAudioElement() {
    if (!isIosDevice() || typeof document === "undefined") {
      return null;
    }

    if (iosVoiceAudioRef.current) {
      return iosVoiceAudioRef.current;
    }

    const audio = document.createElement("audio");

    audio.preload = "auto";
    audio.volume = 1;
    audio.muted = false;
    audio.playsInline = true;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.setAttribute("controls", "controls");
    audio.style.position = "fixed";
    audio.style.left = "-9999px";
    audio.style.width = "1px";
    audio.style.height = "1px";
    audio.style.opacity = "0.01";

    try {
      document.body.appendChild(audio);
    } catch {
      // ignore
    }

    iosVoiceAudioRef.current = audio;
    return audio;
  }

  async function getIosTtsAudioContext() {
    if (!isIosDevice() || typeof window === "undefined") {
      return null;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    let audioContext = iosTtsAudioContextRef.current;

    if (!audioContext || audioContext.state === "closed") {
      audioContext = new AudioContextClass();
      iosTtsAudioContextRef.current = audioContext;
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    return audioContext;
  }

  async function unlockIosAudioPlayback() {
    if (!isIosDevice()) {
      return;
    }

    let unlocked = Boolean(iosAudioUnlockedRef.current);

    try {
      const silentAudio = getIosSilentAudioElement();

      if (silentAudio) {
        silentAudio.currentTime = 0;
        const playPromise = silentAudio.play();

        if (playPromise && typeof playPromise.then === "function") {
          await playPromise;
        }

        silentAudio.pause();
        silentAudio.currentTime = 0;
        unlocked = true;
      }
    } catch {
      // Continue to persistent AudioContext unlock below.
    }

    try {
      const audioContext = await getIosTtsAudioContext();

      if (audioContext) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        gain.gain.value = 0.00001;
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(0);
        oscillator.stop(audioContext.currentTime + 0.04);
        unlocked = true;
      }
    } catch {
      // iPhone audio unlock is best-effort only.
    }

    iosAudioUnlockedRef.current = unlocked;
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
      `Voice understanding quota is cooling down. Try Saya voice again in ${remainingSeconds} seconds. You can still type manually.`
    );

    return true;
  }

  function handleTtsQuotaFallback(cleanText, finishSpeech) {
    // FILE_TEN_TTS_QUOTA_FALLBACK_FIX
    // TTS quota failure should not disable the whole voice assistant.
    // Only generated Saya voice failed; microphone/STT can still continue.
    setVoiceError("");
    setManualChatOpen(false);
    setVoiceHint("Generated Saya voice quota reached. Using browser voice temporarily.");

    try {
      speakText(cleanText, finishSpeech);
    } catch {
      finishSpeech();
    }
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
    setSayaActive(false);
    stopVoiceMeter();
    setManualChatOpen(false);
    setVoiceError("");
    setVoiceHint(
      `Voice understanding ${source} quota reached. Saya voice is paused for ${retrySeconds} seconds. You can still type manually.`
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

    if (speakingSafetyTimerRef.current) {
      clearTimeout(speakingSafetyTimerRef.current);
      speakingSafetyTimerRef.current = null;
    }

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
    setSayaActive(false);
    stopVoiceMeter();

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  function scheduleListeningRestart(delay = 500) {
    clearRestartTimer();

    const shouldListenForOneReply =
      Boolean(pendingAttendanceActionRef.current) ||
      Boolean(voiceConversationModeRef.current) ||
      Boolean(oneShotVoiceModeRef.current) ||
      Boolean(autoWakeModeRef.current);

    // FINAL_ANDROID_SAYA_WAKE_LOOP_FIX
    // Android/desktop can keep restarting short recognition sessions for wake-word listening.
    // iPhone cannot reliably do passive browser wake-word listening, so iPhone stays one-tap.
    const shouldListenForWakeWord = Boolean(autoWakeModeRef.current) && !isIosDevice();

    if (!autoWakeModeRef.current) return;
    if (!shouldListenForOneReply && !shouldListenForWakeWord) return;
    if (Date.now() < voiceQuotaDisabledUntilRef.current) return;
    if (loadingRef.current) return;
    if (isSpeakingRef.current) return;

    restartListenTimerRef.current = setTimeout(() => {
      restartListenTimerRef.current = null;

      const stillNeedsOneReply =
        Boolean(pendingAttendanceActionRef.current) ||
        Boolean(voiceConversationModeRef.current) ||
        Boolean(oneShotVoiceModeRef.current) ||
        Boolean(autoWakeModeRef.current);

      const stillNeedsWakeWord = Boolean(autoWakeModeRef.current) && !isIosDevice();

      if (!autoWakeModeRef.current) return;
      if (!stillNeedsOneReply && !stillNeedsWakeWord) return;
      if (Date.now() < voiceQuotaDisabledUntilRef.current) return;
      if (loadingRef.current) return;
      if (isSpeakingRef.current) return;

      oneShotVoiceModeRef.current = Boolean(stillNeedsOneReply);
      beginListening();
    }, delay);
  }

  function shouldSkipDuplicateMobileGeneratedTts(value) {
    // FILE_TWENTY_ONE_MOBILE_TTS_DUPLICATE_GUARD_FIX
    // AWS logs showed mobile /speak returning 200 first, then repeated 429.
    // That means generated TTS works, but duplicate/repeated calls are exhausting rate limits.
    if (!isMobileBrowser()) return false;

    const key = normalizeVoiceText(value).slice(0, 260);
    const now = Date.now();

    if (!key) return false;

    if (
      lastMobileGeneratedTtsTextRef.current === key &&
      now - lastMobileGeneratedTtsAtRef.current < 25000
    ) {
      return true;
    }

    lastMobileGeneratedTtsTextRef.current = key;
    lastMobileGeneratedTtsAtRef.current = now;

    return false;
  }

  function speakAssistantText(text, options = {}) {
    const { restartAfterSpeech = true, onEnd } = options;
    const cleanText = String(text || "").trim();

    if (Date.now() < voiceQuotaDisabledUntilRef.current) {
      setVoiceHint("Voice understanding quota is cooling down. You can still type manually.");
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

      if (speakingSafetyTimerRef.current) {
        clearTimeout(speakingSafetyTimerRef.current);
        speakingSafetyTimerRef.current = null;
      }

      cleanupCurrentAudio();
      isSpeakingRef.current = false;
      setListening(false);
      listeningRef.current = false;

      if (typeof onEnd === "function") {
        onEnd();
      }

      if (restartAfterSpeech) {
        scheduleListeningRestart(450);
      } else if (!pendingAttendanceActionRef.current && !voiceConversationModeRef.current) {
        setVoiceHint("");
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
    setVoiceHint("Saya is responding...");

    const wordCount = cleanText.split(/\s+/).filter(Boolean).length || 1;
    const safetyMs = Math.max(14000, Math.min(90000, wordCount * 720 + 9000));

    speakingSafetyTimerRef.current = setTimeout(() => {
      finishSpeech();
    }, safetyMs);

            if (isMobileBrowser()) {
      // FILE_TWENTY_MOBILE_GENERATED_TTS_RESTORE_FIX
      // Backend /api/v1/ai-assistant/speak is now fixed and returns 200 with Gemini TTS.
      // Mobile browser speechSynthesis was silent on Android/iPhone, so restore generated Saya voice for mobile.
      lastSpeakableAnswerRef.current = cleanText;
      setMobileReplayText("");

      stopGeminiRecording({ stopLoop: false });
      stopVoiceMeter();
      setListening(false);
      listeningRef.current = false;
      setVoiceHint("Generating Saya voice...");

      if (shouldSkipDuplicateMobileGeneratedTts(cleanText)) {
        setVoiceHint("");
        finishSpeech();
        return;
      }

      speakAiAssistantText(cleanText, {
        voice: options.voice || "Kore",
        timeoutMs: 30000,
      })
        .then((voiceResponse) => {
          const audioUrl = voiceResponse?.audio_url || voiceResponse?.url;

          if (!audioUrl) {
            setVoiceHint("Saya is speaking...");
            speakText(cleanText, finishSpeech);
            return;
          }

          setVoiceHint("Saya is speaking...");
          playGeneratedVoice(audioUrl, finishSpeech, {
            allowManualIosPlay: false,
          });
        })
        .catch((error) => {
          if (isVoiceQuotaError(error)) {
            pauseVoiceForQuota(error, "TTS");
            return;
          }

          setVoiceHint("Saya is speaking...");
          speakText(cleanText, finishSpeech);
        });

      return;
    }

    speakAiAssistantText(cleanText, {
      voice: options.voice || "ritu",
      timeoutMs: 20000,
    })
      .then((voiceResponse) => {
        const audioUrl = voiceResponse?.audio_url || voiceResponse?.url;

        if (!audioUrl) {
          speakText(cleanText, finishSpeech);
          return;
        }

        playGeneratedVoice(audioUrl, finishSpeech);
      })
      .catch((error) => {
        if (isVoiceQuotaError(error)) {
          handleTtsQuotaFallback(cleanText, finishSpeech);
          return;
        }

        // Desktop/browser fallback only.
        speakText(cleanText, finishSpeech);
      });

  }

  function appendWakeGreeting(greeting, userText = "Hey Saya") {
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

  function primeMobileSpeechSynthesis() {
    // FILE_SIXTEEN_MOBILE_SPEECH_PRIME_FIX
    // Mobile browsers often block speechSynthesis after async API calls
    // unless the speech engine is touched during the user's mic/button tap.
    if (!isMobileBrowser()) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume?.();

      const unlockUtterance = new SpeechSynthesisUtterance(".");
      unlockUtterance.lang = "en-IN";
      unlockUtterance.rate = 1;
      unlockUtterance.pitch = 1;
      unlockUtterance.volume = 0.01;

      unlockUtterance.onend = () => {
        mobileSpeechUnlockedRef.current = true;
      };

      unlockUtterance.onerror = () => {
        mobileSpeechUnlockedRef.current = true;
      };

      window.speechSynthesis.speak(unlockUtterance);

      setTimeout(() => {
        try {
          window.speechSynthesis.cancel();
          window.speechSynthesis.resume?.();
        } catch {
          // ignore
        }

        mobileSpeechUnlockedRef.current = true;
      }, 180);
    } catch {
      mobileSpeechUnlockedRef.current = false;
    }
  }

  async function activateSaya() {
    if (showVoiceQuotaCooldownHint()) {
      return;
    }

    stopGeminiRecording({ stopLoop: true });
    cleanupCurrentAudio();

    setAutoWakeMode(true);
    voiceConversationModeRef.current = false;
    pendingGreetingRef.current = "";
    oneShotVoiceModeRef.current = true;

    setSayaActive(true);
    setOpen(true);
    setManualChatOpen(false);
    setMessage("");
    setLastVoiceTranscript("");
    setSiriStatus("Listening. Speak your command now.");
    setVoiceHint('Listening now. Say "check in", "check out", or ask your HRMS question.');
    setVoiceError("");
    primeMobileSpeechSynthesis();
    lastVoiceActivationAtRef.current = Date.now();

    await unlockIosAudioPlayback();
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

    const recentlyActivatedByClick =
      Date.now() - lastVoiceActivationAtRef.current < 12000;

    const waitingForOneVoiceReply =
      Boolean(pendingAttendanceActionRef.current) ||
      Boolean(voiceConversationModeRef.current) ||
      Boolean(oneShotVoiceModeRef.current) ||
      Boolean(autoWakeModeRef.current);

    const likelyMisheardSayaWakeOnly =
      (recentlyActivatedByClick || waitingForOneVoiceReply || autoWakeModeRef.current) &&
      isLikelyMisheardSayaWakeOnly(transcript);

    const hasWakeWord =
      transcriptHasWakeWord(transcript, wakeWord) || likelyMisheardSayaWakeOnly;

    if (!hasWakeWord && !waitingForOneVoiceReply && !recentlyActivatedByClick) {
      setMessage("");
      setLastVoiceTranscript(transcript);
      setSiriStatus(`Heard: ${transcript}`);
      setVoiceHint('Listening in the background. Say "Hey Saya" to open the assistant.');
      scheduleListeningRestart(700);
      return;
    }

    setSayaActive(true);
    setOpen(true);
    setManualChatOpen(false);
    setVoiceError("");
    setLastVoiceTranscript(transcript);

    const greeting = buildWakeGreeting(context);
    const commandText = likelyMisheardSayaWakeOnly
      ? ""
      : (hasWakeWord ? stripWakeWord(transcript) : transcript);

    if (hasWakeWord) {
      voiceConversationModeRef.current = true;
      setSiriStatus(greeting);
    }

    if (!commandText) {
      setMessage("");
      setLastVoiceTranscript("");
      setSiriStatus(greeting);
      setVoiceHint("Saya is greeting...");
      appendWakeGreeting(greeting, "Hey Saya");

      stopRecognition({ suppressRestart: true });

      const wakeGreetingNow = Date.now();

      if (wakeGreetingNow - lastWakeGreetingTtsAtRef.current < 25000) {
        setVoiceHint("Saya is already active. Speak your command.");
        scheduleListeningRestart(700);
        return;
      }

      lastWakeGreetingTtsAtRef.current = wakeGreetingNow;

      speakAssistantText(greeting, {
        restartAfterSpeech: true,
      });

      return;
    }

    setMessage(commandText);
    setLastVoiceTranscript(commandText);
    setSiriStatus(`Processing: ${commandText}`);

    if (hasWakeWord) {
      // FINAL_NO_GREETING_TTS_BEFORE_COMMAND_FIX
      // Do not speak an intermediate greeting before the real answer.
      // On iPhone this was the main reason the UI got stuck on a speaking state with no answer audio.
      setVoiceHint("Processing your command...");
      stopRecognition({ suppressRestart: true });

      await sendMessage(commandText, {
        speakAnswer: true,
        skipWakeWordCheck: true,
        voiceInput: true,
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

    const toPayload = (position, source = "browser_geolocation") => {
      const coords = position?.coords || {};

      if (
        coords.latitude === undefined ||
        coords.latitude === null ||
        coords.longitude === undefined ||
        coords.longitude === null
      ) {
        throw new Error("GPS location is required for attendance. Please enable location permission and try again.");
      }

      return {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        altitude: coords.altitude,
        altitude_accuracy: coords.altitudeAccuracy,
        heading: coords.heading,
        speed: coords.speed,
        location_captured_at: new Date().toISOString(),
        location_source: source,
      };
    };

    return new Promise((resolve, reject) => {
      let resolved = false;
      let watchId = null;
      let bestPosition = null;

      const finish = (position, source = "browser_geolocation") => {
        if (resolved) return;
        resolved = true;

        if (watchId !== null) {
          try {
            navigator.geolocation.clearWatch(watchId);
          } catch {
            // ignore
          }
        }

        try {
          const payload = toPayload(position, source);
          resolve(payload);
        } catch (error) {
          reject(error);
        }
      };

      const fail = (error) => {
        if (resolved) return;
        resolved = true;

        if (watchId !== null) {
          try {
            navigator.geolocation.clearWatch(watchId);
          } catch {
            // ignore
          }
        }

        if (error?.code === 1) {
          reject(new Error("Location permission is blocked. Please allow location permission, then ask Saya to check in again."));
          return;
        }

        if (error?.code === 3) {
          reject(new Error("Unable to get accurate GPS location in time. Please enable Precise Location, keep GPS/mobile data on, stand near a window, and try again."));
          return;
        }

        reject(new Error(error?.message || "GPS location is required for attendance. Please enable location permission and try again."));
      };

      const handlePosition = (position, source) => {
        const accuracy = Number(position?.coords?.accuracy || 99999);
        const bestAccuracy = Number(bestPosition?.coords?.accuracy || 99999);

        if (!bestPosition || accuracy < bestAccuracy) {
          bestPosition = position;
          const accuracyText = formatLocationAccuracy(accuracy);

          if (accuracyText) {
            setVoiceHint(`GPS found. Accuracy: ${accuracyText}. Improving location...`);
          }
        }

        if (accuracy > 0 && accuracy <= 45) {
          finish(position, source);
        }
      };

      const options = {
        enableHighAccuracy: true,
        timeout: isMobileBrowser() ? 20000 : 12000,
        maximumAge: 0,
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          handlePosition(position, "browser_geolocation_current");

          if (!isMobileBrowser()) {
            finish(bestPosition || position, "browser_geolocation_current");
          }
        },
        fail,
        options
      );

      if (typeof navigator.geolocation.watchPosition === "function") {
        watchId = navigator.geolocation.watchPosition(
          (position) => handlePosition(position, "browser_geolocation_watch"),
          () => {
            // Keep waiting for currentPosition/timeout fallback.
          },
          options
        );
      }

      setTimeout(() => {
        if (resolved) return;

        if (bestPosition) {
          finish(bestPosition, "browser_geolocation_best_available");
          return;
        }

        fail({ code: 3 });
      }, isMobileBrowser() ? 16000 : 9000);
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

      const responseContext = {
        ...(response?.context || {}),
        assistant_name: response?.assistant_name || ASSISTANT_NAME,
      };

      setAssistantContext((current) =>
        mergeAssistantContext(current, responseContext)
      );

      const answer = normalizeAssistantAnswer(
        response?.answer ||
          response?.message ||
          `${ASSISTANT_NAME} could not generate a response right now. Please try again.`
      );

      if (options?.voiceInput) {
        setSiriStatus(answer);

        if (isMobileBrowser()) {
          setManualChatOpen(true);
          setOpen(true);
        } else {
          setManualChatOpen(false);
        }
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
        `${ASSISTANT_NAME} could not respond. Please check the backend and try again.`;

      if (options?.voiceInput) {
        setSiriStatus(errorMessage);

        if (isMobileBrowser()) {
          setManualChatOpen(true);
          setOpen(true);
        } else {
          setManualChatOpen(false);
        }
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
            : 'Listening now. Say "Hey Saya", then speak your command clearly.'
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
      voiceConversationModeRef.current || pendingAttendanceActionRef.current
        ? "Listening for your one voice reply..."
        : 'Listening now. Speak your command clearly.'
    );

    if (supportsReliableBrowserSpeechRecognition()) {
      startBrowserSpeechRecognition();
      return;
    }

    if (typeof window === "undefined" || !window.MediaRecorder) {
      setVoiceError(
        "Voice recording is not available in this browser. Please use Chrome, Edge, or Safari with microphone permission enabled."
      );
      setAutoWakeMode(false);
      return;
    }

    geminiLoopActiveRef.current = true;
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

    const types = isIosDevice()
      ? [
          "audio/mp4",
          "audio/mpeg",
          "audio/webm;codecs=opus",
          "audio/webm",
        ]
      : [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/mp4",
          "audio/ogg;codecs=opus",
          "audio/ogg",
        ];

    return types.find((type) => window.MediaRecorder.isTypeSupported(type)) || "";
  }

  function clearPendingIosVoice() {
    iosPendingVoiceRef.current = { audioUrl: "", onEnd: null };
    setIosVoicePlayRequest(null);
  }

  function rememberPendingIosVoice(audioUrl, onEnd) {
    // IPHONE_AUTO_NATIVE_SPEECH_FIX:
    // Do not show a manual Play button as the normal iPhone flow.
    // iPhone should use native speechSynthesis after the user taps Hey Saya/mic.
    iosPendingVoiceRef.current = { audioUrl: "", onEnd: null };
    setIosVoicePlayRequest(null);
    setVoiceHint("Saya answer is shown on screen. iPhone could not play browser voice.");

    if (typeof onEnd === "function") {
      onEnd();
    }
  }

  function cleanupCurrentAudio({ clearPending = true } = {}) {
    if (iosTtsSourceRef.current) {
      try {
        iosTtsSourceRef.current.stop(0);
      } catch {
        // ignore
      }

      iosTtsSourceRef.current = null;
    }

    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.removeAttribute?.("src");
        currentAudioRef.current.src = "";
        currentAudioRef.current.load?.();
      } catch {
        // ignore
      }

      currentAudioRef.current = null;
    }

    if (iosVoiceAudioRef.current) {
      try {
        iosVoiceAudioRef.current.pause();
        iosVoiceAudioRef.current.removeAttribute?.("src");
        iosVoiceAudioRef.current.src = "";
        iosVoiceAudioRef.current.load?.();
      } catch {
        // ignore
      }
    }

    if (currentAudioUrlRef.current) {
      try {
        URL.revokeObjectURL(currentAudioUrlRef.current);
      } catch {
        // ignore
      }

      currentAudioUrlRef.current = "";
    }

    if (clearPending) {
      clearPendingIosVoice();
    }
  }

  async function playIosGeneratedVoiceWithAudioContext(audioUrl, onEnd) {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;

      if (typeof onEnd === "function") {
        onEnd();
      }
    };

    if (!audioUrl) {
      finish();
      return;
    }

    try {
      await unlockIosAudioPlayback();
      const audioContext = await getIosTtsAudioContext();

      if (!audioContext) {
        throw new Error("iPhone AudioContext is not available.");
      }

      if (iosTtsSourceRef.current) {
        try {
          iosTtsSourceRef.current.stop(0);
        } catch {
          // ignore
        }
        iosTtsSourceRef.current = null;
      }

      setVoiceHint("Saya is speaking...");

      const response = await fetch(audioUrl);

      if (!response.ok) {
        throw new Error("Could not load generated Saya voice.");
      }

      const audioBuffer = await response.arrayBuffer();
      const decodedAudio = await audioContext.decodeAudioData(audioBuffer.slice(0));
      const source = audioContext.createBufferSource();

      source.buffer = decodedAudio;
      source.connect(audioContext.destination);
      iosTtsSourceRef.current = source;
      currentAudioUrlRef.current = audioUrl;

      source.onended = () => {
        if (iosTtsSourceRef.current === source) {
          iosTtsSourceRef.current = null;
        }
        finish();
      };

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      source.start(0);
    } catch (error) {
      console.warn("iPhone WebAudio Saya voice failed", error);
      setVoiceHint("Saya answer is shown on screen. iPhone audio output was blocked.");
      finish();
    }
  }

  async function playPendingIosVoice() {
    const pending = iosPendingVoiceRef.current || {};
    const audioUrl = pending.audioUrl;

    if (!audioUrl) {
      setIosVoicePlayRequest(null);
      return;
    }

    setIosVoicePlayRequest(null);
    setVoiceHint("Saya is speaking...");

    try {
      await unlockIosAudioPlayback();
    } catch {
      // Best effort only.
    }

    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearPendingIosVoice();

      if (typeof pending.onEnd === "function") {
        pending.onEnd();
      }
    };

    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
    } catch {
      // ignore
    }

    const audio = getIosVoiceAudioElement() || new Audio();

    audio.preload = "auto";
    audio.volume = 1;
    audio.muted = false;
    audio.playsInline = true;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.src = audioUrl;

    currentAudioRef.current = audio;
    currentAudioUrlRef.current = audioUrl;

    audio.onplaying = () => {
      setVoiceHint("Saya is speaking...");
    };

    audio.onended = finish;
    audio.onerror = () => {
      setVoiceHint("iPhone still could not play the generated voice. The answer is shown on screen.");
      finish();
    };

    try {
      audio.load?.();
      const playPromise = audio.play();

      if (playPromise && typeof playPromise.then === "function") {
        await playPromise;
      }
    } catch {
      setVoiceHint("iPhone still blocked voice playback. The answer is shown on screen.");
      finish();
    }
  }

  function playGeneratedVoice(audioUrl, onEnd, options = {}) {
    const allowManualIosPlay = options.allowManualIosPlay !== false;

    if (!options.keepExistingAudioUrl) {
      cleanupCurrentAudio({ clearPending: false });
    }

    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;

      if (typeof onEnd === "function") {
        onEnd();
      }
    };

    const audio = isIosDevice()
      ? (getIosVoiceAudioElement() || new Audio())
      : new Audio();

    audio.preload = "auto";
    audio.volume = 1;
    audio.muted = false;
    audio.autoplay = false;
    audio.playsInline = true;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.src = audioUrl;

    currentAudioRef.current = audio;
    currentAudioUrlRef.current = audioUrl;

    audio.onplaying = () => {
      clearPendingIosVoice();
      setVoiceHint("Saya is speaking...");
    };

    audio.onended = finish;
    audio.onerror = () => {
      if (isIosDevice() && allowManualIosPlay) {
        rememberPendingIosVoice(audioUrl, onEnd);
        return;
      }

      if (isIosDevice()) {
        setVoiceHint("Saya answer is shown on screen. iPhone could not play generated audio.");
      }

      finish();
    };

    try {
      audio.load?.();
    } catch {
      // ignore
    }

    const playPromise = audio.play();

    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        if (isIosDevice() && allowManualIosPlay) {
          rememberPendingIosVoice(audioUrl, onEnd);
          return;
        }

        if (isIosDevice()) {
          setVoiceHint("Saya answer is shown on screen. iPhone blocked automatic voice playback.");
        }

        finish();
      });
    }
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

  async function ensureMobileVoiceStream() {
    // FILE_ELEVEN_MOBILE_STT_STREAM_FIX
    // Mobile browsers can fail the visual voice meter but still allow direct recording.
    // Do not leave the UI stuck on Listening if no stream exists.
    if (audioStreamRef.current) {
      return audioStreamRef.current;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone recording is not available in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    audioStreamRef.current = stream;
    return stream;
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

    let stream = audioStreamRef.current;

    if (!stream) {
      try {
        stream = await ensureMobileVoiceStream();
      } catch (error) {
        const message =
          error?.message ||
          "Microphone permission is required. Please allow microphone access and tap Saya again.";

        setVoiceError(message);
        setVoiceHint(message);
        setSiriStatus(message);
        setListening(false);
        listeningRef.current = false;
        geminiLoopActiveRef.current = false;
        return;
      }
    }

    if (!stream) {
      const message = "Microphone could not start. Please allow microphone access and tap Saya again.";
      setVoiceError(message);
      setVoiceHint(message);
      setSiriStatus(message);
      setListening(false);
      listeningRef.current = false;
      geminiLoopActiveRef.current = false;
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
        setListening(false);
        listeningRef.current = false;

        if (pendingAttendanceActionRef.current || voiceConversationModeRef.current) {
          scheduleGeminiVoiceLoop(900);
        }
      };

      recorder.onstop = async () => {
        if (suppressGeminiStopRef.current) {
          return;
        }

        mediaRecorderRef.current = null;

        const shouldProcess =
          geminiLoopActiveRef.current &&
          autoWakeModeRef.current &&
          Date.now() >= voiceQuotaDisabledUntilRef.current &&
          !isSpeakingRef.current &&
          !loadingRef.current;

        if (chunks.length && shouldProcess) {
          const audioBlob = new Blob(chunks, {
            type: mimeType || "audio/webm",
          });

          await transcribeGeminiAudioBlob(audioBlob);
        }

        const shouldContinueForOneReply =
          Boolean(pendingAttendanceActionRef.current) ||
          Boolean(voiceConversationModeRef.current) ||
          Boolean(oneShotVoiceModeRef.current) ||
          Boolean(autoWakeModeRef.current);

        if (shouldProcess && shouldContinueForOneReply && !isSpeakingRef.current && !loadingRef.current) {
          scheduleGeminiVoiceLoop(500);
        }
      };

      setVoiceHint("Listening... speak now.");
      setSiriStatus("Listening... speak now.");

      recorder.start();

      const mobileChunkMs = getMobileVoiceChunkMs();
      const chunkMs =
        mobileChunkMs ||
        (voiceConversationModeRef.current || pendingAttendanceActionRef.current ? 2600 : 2200);

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
    } catch (error) {
      mediaRecorderRef.current = null;
      setListening(false);
      listeningRef.current = false;

      const message =
        error?.message ||
        "Mobile voice recording could not start. Please allow microphone access and try again.";

      setVoiceError(message);
      setVoiceHint(message);
      setSiriStatus(message);

      if (
        pendingAttendanceActionRef.current ||
        voiceConversationModeRef.current ||
        oneShotVoiceModeRef.current ||
        autoWakeModeRef.current
      ) {
        scheduleGeminiVoiceLoop(1200);
      }
    }
  }

  async function transcribeGeminiAudioBlob(audioBlob) {
    if (!audioBlob || audioBlob.size < 1000) {
      const message = "I could not capture your voice clearly. Tap Saya again and speak closer to the phone.";
      setVoiceHint(message);
      setSiriStatus(message);
      setListening(false);
      listeningRef.current = false;
      return;
    }
    if (isSpeakingRef.current || loadingRef.current) return;
    if (Date.now() < voiceQuotaDisabledUntilRef.current) return;

    isTranscribingRef.current = true;

    try {
      setVoiceHint("Understanding your voice...");

      const result = await transcribeAiAssistantAudio(audioBlob, {
        timeoutMs: isMobileBrowser() ? 30000 : 22000,
        language: "en-IN",
        filename: isIosDevice()
          ? (audioBlob.type && audioBlob.type.includes("mp4") ? "saya-ios-audio.mp4" : "saya-ios-audio.webm")
          : undefined,
      });

      const transcript = String(
        result?.text ||
          result?.transcript ||
          ""
      ).trim();

      if (!transcript) {
        const noSpeechMessage = "I could not hear clear speech. Tap the mic again and speak closer to the phone.";

        setVoiceHint(noSpeechMessage);
        setSiriStatus(noSpeechMessage);

        if (!pendingAttendanceActionRef.current && !voiceConversationModeRef.current) {
          stopVoiceSession();
        }

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
      setListening(false);
      listeningRef.current = false;

      if (pendingAttendanceActionRef.current || voiceConversationModeRef.current) {
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
      }
    } finally {
      isTranscribingRef.current = false;
    }
  }

  function replayLastSayaVoice() {
    // FILE_FOURTEEN_MOBILE_REPLAY_SAYA_VOICE_FIX
    // Some mobile browsers show speechSynthesis as active but produce no sound.
    // A user-tapped replay button is the reliable browser-safe fallback.
    const replayText = String(
      lastSpeakableAnswerRef.current ||
        mobileReplayText ||
        siriStatus ||
        ""
    ).trim();

    if (!replayText) {
      setVoiceHint("No Saya voice answer is available to replay yet.");
      return;
    }

    setVoiceError("");
    setVoiceHint("Saya is speaking...");

    try {
      window.speechSynthesis?.cancel?.();
      window.speechSynthesis?.resume?.();
    } catch {
      // ignore
    }

    speakText(replayText, () => {
      setVoiceHint("");
    });
  }

  function startListening() {
    if (listeningRef.current || isStartingRecognitionRef.current) {
      stopVoiceSession();
      setVoiceHint("Voice listening stopped. Tap mic or Hey Saya again to reactivate.");
      return;
    }

    if (showVoiceQuotaCooldownHint()) {
      return;
    }

    setAutoWakeMode(true);
    setSayaActive(true);
    setManualChatOpen(false);
    setVoiceError("");
    primeMobileSpeechSynthesis();
    setSiriStatus("Listening. Speak your command now.");
    setVoiceHint('Listening now. Say "check in", "check out", or ask your HRMS question.');
    lastVoiceActivationAtRef.current = Date.now();
    oneShotVoiceModeRef.current = true;
    geminiLoopActiveRef.current = true;
    unlockIosAudioPlayback();
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
    setSiriStatus("Click once to activate Saya voice");
    setLastVoiceTranscript("");
    setMessages([buildWelcomeMessage(assistantContext)]);
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
          onClick={activateSaya}
          title={`Open ${ASSISTANT_NAME} — ${PRODUCT_NAME} Assistant`}
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
              <span>SAYA</span>
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
                <p>{ASSISTANT_NAME} · {PRODUCT_NAME}</p>
                <h2>
                  Role-aware guidance for <span>{roleLabel}</span> workflows
                </h2>
                <div className="ai-context-strip" aria-label="Saya access context">
                  <span>{roleLabel}</span>
                  <span>{subscriptionLabel}</span>
                </div>
              </div>

              <div className="ai-project-scope-grid">
                {roleModules.map((item) => (
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
                        : "Speak your command clearly."}
                    </span>
                  </>
                ) : (
                  <>
                    <small>Ready</small>
                    <strong>{sayaActive ? siriStatus : "Click Saya once to activate voice"}</strong>
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
              {roleQuickQuestions.map((question) => (
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
                      Saya is preparing your response...
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

          {/* FILE_FOURTEEN_RENDER_MOBILE_REPLAY_BUTTON */}
          {mobileReplayText && !loading && !voiceError && (
            <div className="ai-ios-play-wrap">
              <button
                type="button"
                className="ai-ios-play-voice-btn"
                onClick={replayLastSayaVoice}
              >
                <Volume2 size={16} />
                
              </button>
            </div>
          )}

          {false && iosVoicePlayRequest && !voiceError && (
            <div className="ai-ios-play-wrap">
              <button
                type="button"
                className="ai-ios-play-voice-btn"
                onClick={playPendingIosVoice}
              >
                <Volume2 size={16} />
                
              </button>
            </div>
          )}

          {listening && (
            <div className="ai-voice-card-wrap">
              <div className="ai-voice-card">
                <div>
                  <div className="ai-voice-title">Listening...</div>
                  <div className="ai-voice-subtitle">
                    Speak your command clearly.
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
                placeholder={listening ? 'Speak your command...' : 'Ask Saya for steps, workflows, pricing, or live HRMS information...'}
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
                  onClick={activateSaya}
                  disabled={loading}
                >
                  <Volume2 size={16} />
                  Hey Saya
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
              <span>{autoWakeActive ? 'Saya is active in this browser session' : 'Click once to activate Saya voice'}</span>
              <span>{roleLabel} · {subscriptionLabel}</span>
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
          width: 50px;
          height: 42px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at 35% 20%, #ffffff, #bae6fd 28%, #e9d5ff 64%, #fce7f3 100%);
          box-shadow:
            0 14px 30px rgba(15,23,42,.10),
            inset 0 0 0 1px rgba(255,255,255,.8);
          color: #0f172a;
          font-weight: 900;
          font-size: 10px;
          letter-spacing: .06em;
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

        .ai-context-strip {
          margin-top: 10px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
        }

        .ai-context-strip span {
          min-height: 27px;
          padding: 5px 10px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(148,163,184,.25);
          background: rgba(255,255,255,.72);
          color: #334155;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .02em;
          box-shadow: 0 8px 18px rgba(15,23,42,.05);
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

        .ai-ios-play-wrap {
          margin: 10px 18px 0;
          display: flex;
          justify-content: center;
        }

        .ai-ios-play-voice-btn {
          border: 0;
          border-radius: 999px;
          padding: 10px 16px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: linear-gradient(135deg, #2563eb, #ec4899);
          color: #fff;
          font-size: 13px;
          font-weight: 900;
          box-shadow: 0 12px 24px rgba(37,99,235,.24);
          cursor: pointer;
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
          .ai-ios-play-wrap,
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