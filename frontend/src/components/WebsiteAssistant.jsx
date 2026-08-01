import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Icon from "./Icon";
import WebsiteGuidePortrait from "./WebsiteGuidePortrait";

const QUICK_PROMPTS = [
  "Book a demo",
  "Compare plans",
  "Find a feature",
  "Get support",
];

const TEASER_MESSAGES = [
  "Hi! 👋",
  "Hello — how can I help you?",
  "Need help finding the right HRMS plan?",
  "Ask me about demos, pricing or features.",
];

const INITIAL_MESSAGE = {
  id: 1,
  sender: "assistant",
  text: "Hello. I’m the YourComate Website Guide. I can help you explore the platform, compare plans, request a demo or find the right support route.",
  links: [
    ["Explore product", "/product"],
    ["Request a demo", "/apply-demo-registration"],
  ],
};

const intents = [
  {
    matches: ["demo", "trial", "15 day", "evaluate"],
    reply:
      "YourComate offers a 15-day guided trial so your team can evaluate the complete workflow before subscribing. Company-email OTP verification is required before the request moves to Superadmin review.",
    links: [
      ["Start demo registration", "/apply-demo-registration"],
      ["View pricing", "/pricing"],
    ],
  },
  {
    matches: ["price", "pricing", "cost", "quote", "plan"],
    reply:
      "The pricing page includes Demo, Essential, Growth and Premium options. Essential and Growth use direct subscription pricing, while Premium follows a custom quotation workflow.",
    links: [
      ["Calculate pricing", "/pricing"],
      ["Contact sales", "/contact?topic=pricing"],
    ],
  },
  {
    matches: ["attendance", "check in", "check-in", "worked time", "late"],
    reply:
      "Attendance supports office, work-from-home and field workflows, with worked-time visibility, monthly summaries, exception review and role-based views.",
    links: [
      ["Explore attendance", "/product/attendance"],
      ["Request a demo", "/apply-demo-registration"],
    ],
  },
  {
    matches: ["leave", "holiday", "time off", "approval"],
    reply:
      "Employees can apply for leave, track status and view holidays. Managers and authorised roles review requests through controlled approval views.",
    links: [
      ["Explore leave", "/product/leave"],
      ["Explore approvals", "/product/approvals"],
    ],
  },
  {
    matches: ["project", "task", "delivery", "collaborator"],
    reply:
      "Projects connect owners, collaborators, progress updates and manager visibility. Role controls determine who can create, update and review delivery status.",
    links: [
      ["Explore projects", "/product/projects"],
      ["Platform overview", "/product"],
    ],
  },
  {
    matches: ["employee", "core hr", "record", "directory", "people data"],
    reply:
      "Core HR keeps employee profiles, departments, designations, reporting lines, documents and role access organised in one dependable people directory.",
    links: [
      ["Explore Core HR", "/product/core-hr"],
      ["Employee self-service", "/product/employee-self-service"],
    ],
  },
  {
    matches: ["asset", "laptop", "equipment"],
    reply:
      "The asset workflow connects assigned workplace items with employee records so authorised teams can maintain assignment, status and return information.",
    links: [["Explore assets", "/product/assets"]],
  },
  {
    matches: ["policy", "document", "handbook"],
    reply:
      "Policies and employee-facing documents can be published in one controlled library with role-appropriate access.",
    links: [["Explore policies", "/product/policies"]],
  },
  {
    matches: ["report", "analytics", "dashboard", "insight"],
    reply:
      "Reports provide authorised users with attendance summaries, employee status, project visibility, approval counts and operational dashboard metrics.",
    links: [["Explore reports", "/product/reports"]],
  },
  {
    matches: ["mobile", "field", "app", "ios", "android"],
    reply:
      "YourComate is designed for responsive web and mobile use, including focused field attendance, project updates, leave and support actions on smaller screens.",
    links: [["Explore mobile workforce", "/product/mobile"]],
  },
  {
    matches: ["support", "ticket", "help", "issue", "problem"],
    reply:
      "Public visitors can use the Support and Contact pages. Signed-in employees can raise and track internal IT tickets, while authorised support members assign and manage them.",
    links: [
      ["Open support", "/support"],
      ["Contact YourComate", "/contact?topic=support"],
    ],
  },
  {
    matches: ["login", "sign in", "password", "account access"],
    reply:
      "Use the Sign In button in the main navigation to open the HRMS login page. Official company credentials are required.",
    links: [
      ["Open sign in", "/login"],
      ["Account support", "/support"],
    ],
  },
  {
    matches: ["resource", "guide", "template", "checklist", "faq"],
    reply:
      "The Resource Centre includes rollout guidance, an attendance checklist, an HRMS evaluation template, walkthroughs and FAQs.",
    links: [["Browse resources", "/resources"]],
  },
  {
    matches: ["security", "secure", "role", "permission", "otp"],
    reply:
      "YourComate uses verified demo onboarding, role-based workspaces, controlled administrative permissions and approval boundaries. Detailed production security commitments can be confirmed during implementation discussions.",
    links: [
      ["View security", "/security"],
      ["Security enquiry", "/contact?topic=security"],
    ],
  },
  {
    matches: ["privacy", "personal data", "data protection"],
    reply:
      "The Privacy Policy explains what website information may be collected, why it is used, how it may be retained and the choices available to visitors.",
    links: [
      ["Read Privacy Policy", "/privacy"],
      ["Cookie Policy", "/cookies"],
    ],
  },
  {
    matches: ["terms", "conditions", "legal"],
    reply:
      "The Terms of Use describe acceptable website use, informational limitations, intellectual-property expectations and contact routes.",
    links: [
      ["Read Terms of Use", "/terms"],
      ["Legal pages", "/privacy"],
    ],
  },
  {
    matches: ["cookie", "cookies", "tracking"],
    reply:
      "The website uses essential local storage for preferences such as policy acknowledgement. The Cookie Policy explains this and should be updated if analytics or advertising tools are added later.",
    links: [
      ["Read Cookie Policy", "/cookies"],
      ["Manage privacy", "#manage-privacy"],
    ],
  },
  {
    matches: ["saya", "ai assistant", "hr assistant"],
    reply:
      "I’m the public YourComate Website Guide. Saya is the separate assistant available inside the signed-in HRMS workspace, where role and permission context can be used.",
    links: [
      ["Explore Saya", "/saya"],
      ["Explore the platform", "/product"],
    ],
  },
  {
    matches: ["payroll", "salary", "payslip", "salary processing"],
    reply:
      "Payroll is included in the paid YourComate plan structure. For statutory setup, implementation scope and rollout details, speak with the YourComate team.",
    links: [
      ["Compare plans", "/pricing"],
      ["Discuss payroll", "/contact?topic=pricing"],
    ],
  },
  {
    matches: ["otp", "verification", "demo approval", "credentials email"],
    reply:
      "Demo registration verifies the company email through OTP. After verification, the request moves to Superadmin review. Approved companies receive their credentials by email.",
    links: [
      ["Start demo registration", "/apply-demo-registration"],
      ["Demo support", "/support"],
    ],
  },
  {
    matches: ["onboarding", "new employee", "employee setup", "joining"],
    reply:
      "YourComate keeps employee records, reporting structure, role access and self-service information connected so onboarding can follow a controlled company process.",
    links: [
      ["Explore Core HR", "/product/core-hr"],
      ["Employee self-service", "/product/employee-self-service"],
    ],
  },
  {
    matches: ["role based", "admin", "hr", "manager", "employee role", "field employee"],
    reply:
      "YourComate uses role-based workspaces so employees, managers, HR, administrators and field teams see the actions and information relevant to their responsibilities.",
    links: [
      ["Explore the platform", "/product"],
      ["View security", "/security"],
    ],
  },
  {
    matches: ["contact", "sales", "talk to team", "enquiry"],
    reply:
      "Use the Contact page for demo, implementation, security, support or general product enquiries.",
    links: [["Contact YourComate", "/contact"]],
  },
];

function getAssistantReply(rawMessage) {
  const message = rawMessage.toLowerCase();
  const intent = intents.find((item) =>
    item.matches.some((term) => message.includes(term)),
  );

  return (
    intent || {
      reply:
        "I can help you find product features, demo access, pricing, support, resources, security and legal information. Try describing what you need to do.",
      links: [
        ["Explore product", "/product"],
        ["Browse support", "/support"],
      ],
    }
  );
}

export default function WebsiteAssistant() {
  const location = useLocation();
  const messageListRef = useRef(null);
  const inputRef = useRef(null);
  const replyTimerRef = useRef(null);
  const teaserStartTimerRef = useRef(null);
  const teaserIntervalRef = useRef(null);
  const teaserHideTimerRef = useRef(null);
  const teaserIndexRef = useRef(0);

  const [view, setView] = useState("closed");
  const [teaser, setTeaser] = useState(null);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [messages, setMessages] = useState([
    INITIAL_MESSAGE,
  ]);

  const chatOpen = view === "chat";
  const previewOpen = view === "preview";

  useEffect(() => {
    const clearTeaserTimers = () => {
      window.clearTimeout(teaserStartTimerRef.current);
      window.clearTimeout(teaserHideTimerRef.current);
      window.clearInterval(teaserIntervalRef.current);

      teaserStartTimerRef.current = null;
      teaserHideTimerRef.current = null;
      teaserIntervalRef.current = null;
    };

    clearTeaserTimers();

    if (view !== "closed") {
      setTeaser(null);
      return clearTeaserTimers;
    }

    const showNextTeaser = () => {
      const message =
        TEASER_MESSAGES[
          teaserIndexRef.current %
            TEASER_MESSAGES.length
        ];

      teaserIndexRef.current =
        (teaserIndexRef.current + 1) %
        TEASER_MESSAGES.length;

      setTeaser(message);

      window.clearTimeout(
        teaserHideTimerRef.current,
      );

      teaserHideTimerRef.current =
        window.setTimeout(() => {
          setTeaser(null);
        }, 3600);
    };

    // Mandatory first bubble shortly after the website becomes visible.
    teaserStartTimerRef.current =
      window.setTimeout(showNextTeaser, 700);

    // Continue the existing teaser sequence at short, readable intervals.
   teaserIntervalRef.current =
  window.setInterval(showNextTeaser, 12000);

    return clearTeaserTimers;
  }, [view]);

  const pageSuggestion = useMemo(() => {
    if (location.pathname.startsWith("/product")) {
      return "Ask about this product workflow";
    }

    if (location.pathname === "/pricing") {
      return "Ask about plans or pricing";
    }

    if (location.pathname === "/support") {
      return "Describe your support need";
    }

    if (
      location.pathname.startsWith("/resources")
    ) {
      return "Find a guide or template";
    }

    return "Ask the website guide a question";
  }, [location.pathname]);

  useEffect(() => {
    const params = new URLSearchParams(
      location.search,
    );

    if (params.get("chat") === "help") {
      setView("chat");
    }
  }, [location.search]);

  useEffect(() => {
    const handleOpen = () => {
      setView("chat");
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setView("closed");
      }
    };

    window.addEventListener(
      "yc-open-assistant",
      handleOpen,
    );
    window.addEventListener(
      "keydown",
      handleEscape,
    );

    return () => {
      window.removeEventListener(
        "yc-open-assistant",
        handleOpen,
      );
      window.removeEventListener(
        "keydown",
        handleEscape,
      );
      window.clearTimeout(
        replyTimerRef.current,
      );
      window.clearTimeout(
        teaserStartTimerRef.current,
      );
      window.clearTimeout(
        teaserHideTimerRef.current,
      );
      window.clearInterval(
        teaserIntervalRef.current,
      );
    };
  }, []);

  useEffect(() => {
    if (!chatOpen) return;

    window.requestAnimationFrame(() => {
      if (messageListRef.current) {
        messageListRef.current.scrollTop =
          messageListRef.current.scrollHeight;
      }

      inputRef.current?.focus();
    });
  }, [messages, chatOpen, typing]);

  const dismissTeaser = () => {
    window.clearTimeout(
      teaserHideTimerRef.current,
    );
    teaserHideTimerRef.current = null;
    setTeaser(null);
  };

  const closeAssistant = () => {
    setView("closed");
  };

  const resetConversation = () => {
    window.clearTimeout(
      replyTimerRef.current,
    );
    setTyping(false);
    setDraft("");
    setMessages([INITIAL_MESSAGE]);
  };

  const sendMessage = (messageText) => {
    const clean = messageText.trim();

    if (!clean || typing) return;

    const response =
      getAssistantReply(clean);
    const timestamp = Date.now();

    setMessages((current) => [
      ...current,
      {
        id: timestamp,
        sender: "user",
        text: clean,
        links: [],
      },
    ]);

    setDraft("");
    setTyping(true);

    replyTimerRef.current =
      window.setTimeout(() => {
        setMessages((current) => [
          ...current,
          {
            id: timestamp + 1,
            sender: "assistant",
            text: response.reply,
            links: response.links,
          },
        ]);

        setTyping(false);
      }, 560);
  };

  const handleAssistantLink = (href) => {
    if (href === "#manage-privacy") {
      window.dispatchEvent(
        new CustomEvent(
          "yc-open-policy-consent",
        ),
      );

      closeAssistant();
    }
  };

  return (
    <div
      className={[
        "website-assistant",
        previewOpen
          ? "is-preview"
          : "",
        chatOpen
          ? "is-chat-open"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {view === "closed" && (
        <>
          {teaser && (
            <button
              className="website-assistant-teaser"
              type="button"
              aria-label={`Dismiss message: ${teaser}`}
              title="Click to dismiss"
              onClick={dismissTeaser}
            >
              <span>{teaser}</span>
              <Icon name="close" />
            </button>
          )}

          <button
          className="website-assistant-icon"
          type="button"
          aria-label="Open YourComate Website Guide"
          aria-expanded="false"
          onClick={() =>
            setView("preview")
          }
        >
          <span className="website-assistant-icon-avatar">
            <WebsiteGuidePortrait avatar />
          </span>

          <span className="website-assistant-icon-badge">
            <Icon name="people" />
          </span>

          <i aria-hidden="true" />
        </button>
        </>
      )}

      {previewOpen && (
        <section
          className="website-assistant-preview"
          aria-labelledby="website-guide-preview-title"
        >
          <button
            className="website-assistant-preview-close"
            type="button"
            aria-label="Close website guide introduction"
            onClick={closeAssistant}
          >
            <Icon name="close" />
          </button>

          <div className="website-assistant-preview-copy">
            <small>YourComate</small>

            <strong id="website-guide-preview-title">
              Website Guide
            </strong>
          </div>

          <WebsiteGuidePortrait />

          <p>
            How can I help you explore
            YourComate?
          </p>

          <button
            className="website-assistant-preview-cta"
            type="button"
            onClick={() => setView("chat")}
          >
            Let’s chat
            <Icon name="arrow" />
          </button>
        </section>
      )}

      {chatOpen && (
        <section
          className="website-assistant-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="website-assistant-title"
        >
          <header className="website-assistant-header">
            <div className="website-assistant-header-portrait">
              <WebsiteGuidePortrait compact />
            </div>

            <div className="website-assistant-header-copy">
              <small>
                Public website assistance
              </small>

              <strong id="website-assistant-title">
                YourComate Website Guide
              </strong>

              <span>
                <i />
                Online for website guidance
              </span>
            </div>

            <div className="website-assistant-header-actions">
              <button
                type="button"
                onClick={resetConversation}
              >
                Start over
              </button>

              <button
                className="website-assistant-close"
                type="button"
                aria-label="Close website guide"
                onClick={closeAssistant}
              >
                <Icon name="close" />
              </button>
            </div>
          </header>

          <div
            className="website-assistant-messages"
            ref={messageListRef}
            aria-live="polite"
          >
            <div className="website-assistant-conversation-label">
              <span>Today</span>
            </div>

            {messages.map((message) => (
              <div
                key={message.id}
                className={`website-assistant-message website-assistant-message-${message.sender}`}
              >
                {message.sender ===
                  "assistant" && (
                  <span className="website-assistant-message-avatar">
                    <WebsiteGuidePortrait avatar />
                  </span>
                )}

                <div className="website-assistant-message-content">
                  <p>{message.text}</p>

                  {message.links?.length >
                    0 && (
                    <div className="website-assistant-message-links">
                      {message.links.map(([label, href]) => {
  if (href.startsWith("#")) {
    return (
      <button
        type="button"
        key={href}
        onClick={() => handleAssistantLink(href)}
      >
        {label}
        <Icon name="arrow" />
      </button>
    );
  }

if (
  href === "/login" ||
  href === "/apply-demo-registration"
) {
    return (
      <a
        key={href}
        href={href}
        onClick={closeAssistant}
      >
        {label}
        <Icon name="arrow" />
      </a>
    );
  }

  return (
    <Link
      key={href}
      to={href}
      onClick={closeAssistant}
    >
      {label}
      <Icon name="arrow" />
    </Link>
  );
})}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {typing && (
              <div className="website-assistant-message website-assistant-message-assistant">
                <span className="website-assistant-message-avatar">
                  <WebsiteGuidePortrait avatar />
                </span>

                <div
                  className="website-assistant-typing"
                  aria-label="Website guide is typing"
                >
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
          </div>

          <div
            className="website-assistant-prompts"
            aria-label="Suggested questions"
          >
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={typing}
                onClick={() =>
                  sendMessage(prompt)
                }
              >
                {prompt}
              </button>
            ))}
          </div>

          <form
            className="website-assistant-form"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage(draft);
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(event) =>
                setDraft(
                  event.target.value,
                )
              }
              placeholder={pageSuggestion}
              aria-label="Message the YourComate Website Guide"
              disabled={typing}
            />

            <button
              type="submit"
              aria-label="Send message"
              disabled={
                !draft.trim() || typing
              }
            >
              <Icon name="send" />
            </button>
          </form>

          <div className="website-assistant-disclaimer">
            Public website guidance only.
            Signed-in Saya provides separate
            role-aware HRMS assistance.
          </div>
        </section>
      )}
    </div>
  );
}
