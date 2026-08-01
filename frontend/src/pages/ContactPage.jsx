import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import CloudflareTurnstile from "../components/CloudflareTurnstile";
import Icon from "../components/Icon";

const validTopics = new Set([
  "demo",
  "implementation",
  "support",
  "security",
  "pricing",
  "general",
  "other",
]);

function RequiredLabel({ children }) {
  return (
    <span className="yc-contact-field-label">
      {children}
      <b aria-hidden="true">*</b>
      <span className="sr-only"> required</span>
    </span>
  );
}

export default function ContactPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState("");
  const [otherQuery, setOtherQuery] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const requestedTopic = params.get("topic") || "demo";
  const [topic, setTopic] = useState(
    validTopics.has(requestedTopic) ? requestedTopic : "general",
  );

  useEffect(() => {
    setTopic(validTopics.has(requestedTopic) ? requestedTopic : "general");
    setOtherQuery("");
    setSent(false);
    setFormError("");
  }, [requestedTopic]);

  const handleSubmit = (event) => {
    event.preventDefault();
    setSent(false);
    setFormError("");

    if (!turnstileToken) {
      setFormError("Please complete the Cloudflare verification before sending.");
      return;
    }

    event.currentTarget.reset();
    setTopic("demo");
    setOtherQuery("");
    setTurnstileToken("");
    setTurnstileResetKey((current) => current + 1);
    setSent(true);
  };

  return (
    <main className="public-main yc-contact-page">
      <section className="public-section yc-contact-content-section">
        <div className="page-width yc-contact-layout">
          <div className="yc-contact-intro-card">
            <span aria-hidden="true">
              <Icon name="people" />
            </span>

            <small>WORKFLOW DISCOVERY</small>

            <h1>Let's understand how your workforce operates.</h1>

            <p>
              Every business has different people, processes and goals. Share your workforce size, operational challenges and HR requirements, and our team will help you choose, implement and scale the right YourComate HRMS solution.
            </p>

            <ul>
              <li><Icon name="check" /> ✓ Product demonstration & consultation</li>
              <li><Icon name="check" /> ✓ Implementation & onboarding guidance
</li>
              <li><Icon name="check" /> ✓ Pricing, migration & enterprise support</li>
            </ul>
          </div>

          <form className="yc-contact-form" onSubmit={handleSubmit}>
            <header>
              <small>ENQUIRY DETAILS</small>
              <h2>Start your HRMS journey with the right conversation.</h2>
            </header>

            <div className="yc-contact-form-row">
              <label>
                <RequiredLabel>Full Name</RequiredLabel>
                <input required name="name" type="text" autoComplete="name" placeholder="Your name" />
              </label>

              <label>
                <RequiredLabel>Company Name</RequiredLabel>
                <input required name="company" type="text" autoComplete="organization" placeholder="Company name" />
              </label>
            </div>

            <div className="yc-contact-form-row">
              <label>
                <RequiredLabel>Company Email</RequiredLabel>
                <input required name="email" type="email" autoComplete="email" placeholder="you@company.com" />
              </label>

              <label>
                <RequiredLabel>Phone Number</RequiredLabel>
                <input
                  required
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  pattern="[0-9+()\\-\\s]{7,20}"
                  title="Enter a valid phone number using 7 to 20 digits or phone symbols."
                  placeholder="+91 98765 43210"
                />
              </label>
            </div>

            <div className="yc-contact-form-row yc-contact-form-row-topic">
              <label>
                Employee Count
                <input name="employees" min="1" type="number" inputMode="numeric" placeholder="Example: 50" />
              </label>

              <label>
                <RequiredLabel>How can we help?</RequiredLabel>
                <select
                  required
                  name="topic"
                  value={topic}
                  onChange={(event) => {
                    const nextTopic = event.target.value;
                    setTopic(nextTopic);
                    setSent(false);
                    setFormError("");
                    if (nextTopic !== "other") setOtherQuery("");
                  }}
                >
                  <option value="demo">Demo and pricing</option>
                  <option value="pricing">Pricing discussion</option>
                  <option value="implementation">Implementation</option>
                  <option value="support">Support guidance</option>
                  <option value="security">Security enquiry</option>
                  <option value="general">General question</option>
                  <option value="other">Others</option>
                </select>
              </label>
            </div>

            {topic === "other" && (
              <label className="yc-contact-other-field">
                Explain your query
                <input
                  name="other_query"
                  type="text"
                  value={otherQuery}
                  onChange={(event) => setOtherQuery(event.target.value)}
                  placeholder="Briefly describe what you need help with"
                />
              </label>
            )}

            <label>
              Message
              <textarea name="message" placeholder="Add any other useful details (optional)" />
            </label>

            <label className="yc-contact-consent">
              <input required type="checkbox" name="privacy_acknowledgement" />
              <span>
                I have reviewed the Privacy Policy and agree that this enquiry
                may be used to respond to my request.
              </span>
            </label>

            <CloudflareTurnstile
              resetKey={turnstileResetKey}
              onVerify={(token) => {
                setTurnstileToken(token);
                setFormError("");
              }}
              onExpire={() => setTurnstileToken("")}
            />

            {formError && (
              <p className="yc-contact-form-error" role="alert">
                <Icon name="warning" /> {formError}
              </p>
            )}

            <button className="button button-primary" type="submit" disabled={!turnstileToken}>
              Send Enquiry <Icon name="send" />
            </button>

            {sent && (
              <p className="yc-contact-success">
                <Icon name="check" /> Your enquiry has been captured in this page session.
              </p>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
