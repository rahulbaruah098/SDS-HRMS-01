import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  legalPages,
  POLICY_EFFECTIVE_DATE,
  POLICY_VERSION,
} from "../data/legalContent";
import Icon from "./Icon";

const STORAGE_KEY = "yourcomate_policy_acknowledgement";

const POLICY_DOCUMENTS = [
  {
    key: "privacy",
    label: "Privacy Policy",
    eyebrow: "Data and privacy",
    description:
      "Review how website, enquiry and account information is handled.",
  },
  {
    key: "terms",
    label: "Terms of Use",
    eyebrow: "Website conditions",
    description:
      "Review the conditions governing access to and use of this website.",
  },
];

function readSavedConsent() {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "null",
    );

    return (
      saved?.version === POLICY_VERSION &&
      saved?.privacyAccepted === true &&
      saved?.termsAccepted === true
    );
  } catch {
    return false;
  }
}

export default function PolicyConsentModal() {
  const location = useLocation();
  const navigate = useNavigate();
  const modalRef = useRef(null);
  const readerRef = useRef(null);
  const readerHeadingRef = useRef(null);
  const lastFocusedElementRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [required, setRequired] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [activePolicyKey, setActivePolicyKey] = useState(null);

  const activePolicy = activePolicyKey
    ? legalPages[activePolicyKey]
    : null;

  useEffect(() => {
    const accepted = readSavedConsent();

    setPrivacyChecked(accepted);
    setTermsChecked(accepted);
    setActivePolicyKey(null);

    if (location.pathname === "/demo-registration" && !accepted) {
      setRequired(true);
      setOpen(true);
    } else {
      setRequired(false);
      setOpen(false);
    }

    const handleOpen = () => {
      const currentAccepted = readSavedConsent();
      setPrivacyChecked(currentAccepted);
      setTermsChecked(currentAccepted);
      setActivePolicyKey(null);
      setRequired(false);
      setOpen(true);
    };

    window.addEventListener("yc-open-policy-consent", handleOpen);
    return () =>
      window.removeEventListener("yc-open-policy-consent", handleOpen);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;

    const root = document.documentElement;
    const body = document.body;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - root.clientWidth,
    );

    const previousRootStyles = {
      overflow: root.style.overflow,
      overscrollBehavior: root.style.overscrollBehavior,
      scrollBehavior: root.style.scrollBehavior,
    };
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
      overscrollBehavior: body.style.overscrollBehavior,
    };

    lastFocusedElementRef.current = document.activeElement;

    root.classList.add("policy-consent-open");
    body.classList.add("policy-consent-open");

    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      root.classList.remove("policy-consent-open");
      body.classList.remove("policy-consent-open");

      root.style.overflow = previousRootStyles.overflow;
      root.style.overscrollBehavior =
        previousRootStyles.overscrollBehavior;
      root.style.scrollBehavior = "auto";

      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      body.style.width = previousBodyStyles.width;
      body.style.overflow = previousBodyStyles.overflow;
      body.style.paddingRight = previousBodyStyles.paddingRight;
      body.style.overscrollBehavior =
        previousBodyStyles.overscrollBehavior;

      window.scrollTo({
        left: scrollX,
        top: scrollY,
        behavior: "auto",
      });
      root.style.scrollBehavior = previousRootStyles.scrollBehavior;

      if (
        lastFocusedElementRef.current instanceof HTMLElement &&
        document.contains(lastFocusedElementRef.current)
      ) {
        lastFocusedElementRef.current.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open || activePolicyKey) return undefined;

    const focusFrame = window.requestAnimationFrame(() => {
      modalRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, activePolicyKey]);

  useEffect(() => {
    if (!activePolicyKey) return;

    window.requestAnimationFrame(() => {
      readerRef.current?.scrollTo({ top: 0, behavior: "auto" });
      readerHeadingRef.current?.focus();
    });
  }, [activePolicyKey]);

  useEffect(() => {
    if (!open) return undefined;

    const handleModalKeyDown = (event) => {
      if (event.key === "Escape") {
        if (activePolicyKey) {
          setActivePolicyKey(null);
          return;
        }

        if (!required) {
          setOpen(false);
        }

        return;
      }

      if (event.key !== "Tab") return;

      const modal = modalRef.current;
      if (!modal) return;

      const focusableElements = Array.from(
        modal.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) =>
        element instanceof HTMLElement &&
        !element.hidden &&
        element.getAttribute("aria-hidden") !== "true"
      );

      if (!focusableElements.length) {
        event.preventDefault();
        modal.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (
        event.shiftKey &&
        (document.activeElement === firstElement ||
          document.activeElement === modal)
      ) {
        event.preventDefault();
        lastElement.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === lastElement
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener("keydown", handleModalKeyDown);
    return () =>
      window.removeEventListener("keydown", handleModalKeyDown);
  }, [open, required, activePolicyKey]);

  if (!open) return null;

  const canContinue = privacyChecked && termsChecked;

  const closeModal = () => {
    setActivePolicyKey(null);
    setOpen(false);
  };

  const cancelDemo = () => {
    setActivePolicyKey(null);
    setOpen(false);
    setRequired(false);
    if (window.history.length > 1) navigate(-1);
    else navigate("/", { replace: true });
  };

  const saveAndClose = () => {
    if (!canContinue) return;

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: POLICY_VERSION,
        privacyAccepted: true,
        termsAccepted: true,
        acceptedAt: new Date().toISOString(),
      }),
    );

    setActivePolicyKey(null);
    setRequired(false);
    setOpen(false);
  };

  return (
    <div className="policy-consent-backdrop" role="presentation">
      <section
        ref={modalRef}
        className={`policy-consent-modal${
          activePolicy ? " policy-consent-modal-reading" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={
          activePolicy ? "policy-reader-title" : "policy-consent-title"
        }
        aria-describedby={
          activePolicy
            ? "policy-reader-summary"
            : "policy-consent-description"
        }
        tabIndex={-1}
      >
        {activePolicy ? (
          <>
            <header className="policy-reader-header">
              <button
                className="policy-reader-back"
                type="button"
                onClick={() => setActivePolicyKey(null)}
              >
                <Icon name="arrow" />
                <span>Back</span>
              </button>

              <div>
                <small>{activePolicy.eyebrow}</small>
                <h2
                  id="policy-reader-title"
                  ref={readerHeadingRef}
                  tabIndex={-1}
                >
                  {activePolicy.title}
                </h2>
              </div>

              {!required && (
                <button
                  className="policy-consent-close"
                  type="button"
                  aria-label="Close privacy settings"
                  onClick={closeModal}
                >
                  <Icon name="close" />
                </button>
              )}
            </header>

            <div ref={readerRef} className="policy-reader-body">
              <div className="policy-reader-summary">
                <div>
                  <small>Official website policy</small>
                  <p id="policy-reader-summary">{activePolicy.summary}</p>
                </div>

                <div className="policy-reader-meta" aria-label="Policy details">
                  <span>
                    <small>Effective</small>
                    <strong>{POLICY_EFFECTIVE_DATE}</strong>
                  </span>
                  <span>
                    <small>Version</small>
                    <strong>{POLICY_VERSION}</strong>
                  </span>
                </div>
              </div>

              <nav
                className="policy-reader-index"
                aria-label={`${activePolicy.title} section index`}
              >
                <header>
                  <small>Document index</small>
                  <strong>{activePolicy.sections.length} sections</strong>
                </header>

                {activePolicy.sections.map(([title], index) => (
                  <button
                    type="button"
                    key={title}
                    onClick={() => {
                      document
                        .getElementById(`policy-reader-section-${index + 1}`)
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                    }}
                  >
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>{title}</span>
                  </button>
                ))}
              </nav>

              <div className="policy-reader-document">
                {activePolicy.sections.map(([title, copy], index) => (
                  <article
                    id={`policy-reader-section-${index + 1}`}
                    key={title}
                  >
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <div>
                      <h3>{title}</h3>
                      <p>{copy}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <footer className="policy-reader-footer">
              <span>
                You can return to the acknowledgement without losing your
                selections.
              </span>

              <button
                className="button button-primary"
                type="button"
                onClick={() => setActivePolicyKey(null)}
              >
                Back to Acknowledgement
                <Icon name="arrow" />
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="policy-consent-header">
              <div>
                <small>YourComate website policies</small>
                <h2 id="policy-consent-title">
                  Privacy and terms acknowledgement
                </h2>
              </div>

              {!required && (
                <button
                  className="policy-consent-close"
                  type="button"
                  aria-label="Close privacy settings"
                  onClick={closeModal}
                >
                  <Icon name="close" />
                </button>
              )}
            </header>

            <div className="policy-consent-body">
              <div className="policy-consent-introduction">
                <div>
                  <small>Official acknowledgement</small>
                  <strong>
                    Review the governing documents before continuing.
                  </strong>
                  <p id="policy-consent-description">
                    YourComate stores this acknowledgement in your browser so
                    the mandatory notice does not appear again for the same
                    policy version.
                  </p>
                </div>

                <div className="policy-consent-meta" aria-label="Policy details">
                  <span>
                    <small>Effective</small>
                    <strong>{POLICY_EFFECTIVE_DATE}</strong>
                  </span>
                  <span>
                    <small>Version</small>
                    <strong>{POLICY_VERSION}</strong>
                  </span>
                  <span>
                    <small>Required documents</small>
                    <strong>{POLICY_DOCUMENTS.length}</strong>
                  </span>
                </div>
              </div>

              <div
                className="policy-consent-document-grid"
                aria-label="Policy documents"
              >
                {POLICY_DOCUMENTS.map((document, index) => (
                  <article
                    className="policy-consent-document-card"
                    key={document.key}
                  >
                    <b className="policy-consent-document-number">
                      {String(index + 1).padStart(2, "0")}
                    </b>

                    <div>
                      <small>{document.eyebrow}</small>
                      <h3>{document.label}</h3>
                      <p>{document.description}</p>
                    </div>

                    <button
                      className="policy-consent-document-link"
                      type="button"
                      onClick={() => setActivePolicyKey(document.key)}
                    >
                      Read {document.label}
                      <Icon name="arrow" />
                    </button>
                  </article>
                ))}
              </div>

              <button
                className="policy-consent-secondary-link"
                type="button"
                onClick={() => setActivePolicyKey("cookies")}
              >
                <span>
                  Read the Cookie Policy for browser-storage details.
                </span>
                <Icon name="arrow" />
              </button>

              <div className="policy-consent-checks">
                <label>
                  <input
                    type="checkbox"
                    checked={privacyChecked}
                    onChange={(event) =>
                      setPrivacyChecked(event.target.checked)
                    }
                  />
                  <span>
                    <strong>
                      I confirm that I have read the Privacy Policy.
                    </strong>
                    <small>
                      I understand how information submitted through the
                      public website may be used.
                    </small>
                  </span>
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={termsChecked}
                    onChange={(event) =>
                      setTermsChecked(event.target.checked)
                    }
                  />
                  <span>
                    <strong>I agree to the Terms of Use.</strong>
                    <small>
                      I agree to use the website lawfully and in accordance
                      with the published conditions.
                    </small>
                  </span>
                </label>
              </div>
            </div>

            <footer className="policy-consent-footer">
              <div>
                <small>Effective {POLICY_EFFECTIVE_DATE}</small>
                <span>Policy version {POLICY_VERSION}</span>
              </div>

              <div className="policy-consent-footer-actions">
                {required && (
                  <button
                    className="button button-ghost"
                    type="button"
                    onClick={cancelDemo}
                  >
                    Cancel demo request
                  </button>
                )}

                <button
                  className="button button-primary"
                  type="button"
                  disabled={!canContinue}
                  onClick={saveAndClose}
                >
                  Agree and Continue
                  <Icon name="arrow" />
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
