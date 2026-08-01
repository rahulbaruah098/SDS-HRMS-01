import { Link, Navigate, useParams } from "react-router-dom";
import Icon from "../components/Icon";
import {
  legalPages,
  POLICY_EFFECTIVE_DATE,
  POLICY_VERSION,
} from "../data/legalContent";

const relatedPages = [
  ["Privacy Policy", "/privacy"],
  ["Terms of Use", "/terms"],
  ["Cookie Policy", "/cookies"],
  ["Accessibility", "/accessibility"],
  ["Disclaimer", "/disclaimer"],
];

export default function LegalPage({ pageKey }) {
  const { legalKey } = useParams();
  const resolvedKey = pageKey || legalKey;
  const page = legalPages[resolvedKey];

  if (!page) {
    return <Navigate to="/privacy" replace />;
  }

  const openPrivacySettings = () => {
    window.dispatchEvent(new CustomEvent("yc-open-policy-consent"));
  };

  return (
    <main className={`public-main legal-page legal-page-${page.tone}`}>
      <section className="legal-hero">
        <div className="page-width legal-hero-grid">
          <div className="legal-hero-copy">
            <span className="public-kicker">
              <Icon name={page.icon} />
              {page.eyebrow}
            </span>

            <div className="legal-document-meta" aria-label="Document details">
              <span>Official website policy</span>
              <span>Effective {POLICY_EFFECTIVE_DATE}</span>
              <span>Version {POLICY_VERSION}</span>
            </div>

            <h1>{page.title}</h1>
            <p>{page.summary}</p>

            <div className="legal-hero-actions">
              <a className="button button-primary" href="#legal-document">
                Read the document
                <Icon name="arrow" />
              </a>
              <button
                className="button button-ghost"
                type="button"
                onClick={openPrivacySettings}
              >
                Manage privacy
              </button>
            </div>
          </div>

          <aside className="legal-overview-card">
            <header>
              <div>
                <small>Document index</small>
                <strong>{page.sections.length} sections</strong>
              </div>
              <span>{String(page.sections.length).padStart(2, "0")}</span>
            </header>

            <p>
              Use this index to move directly to a section. Formal product and
              commercial commitments remain subject to written agreements.
            </p>

            <nav aria-label={`${page.title} section index`}>
              {page.sections.map(([title], index) => (
                <a href={`#legal-section-${index + 1}`} key={title}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span>{title}</span>
                  <Icon name="arrow" />
                </a>
              ))}
            </nav>
          </aside>
        </div>
      </section>

      <section
        id="legal-document"
        className="public-section legal-content-section"
      >
        <div className="page-width legal-content-layout">
          <div className="legal-document">
            <header className="legal-document-heading">
              <div>
                <small>Published document</small>
                <h2>{page.eyebrow}</h2>
              </div>
              <span>Last published {POLICY_EFFECTIVE_DATE}</span>
            </header>

            {page.sections.map(([title, copy], index) => (
              <article id={`legal-section-${index + 1}`} key={title}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>

          <aside className="legal-side-actions">
            <header>
              <small>YourComate policies</small>
              <h3>Related documents</h3>
            </header>

            <nav aria-label="Related legal pages">
              {relatedPages.map(([label, href]) => (
                <Link
                  className={href === `/${resolvedKey}` ? "is-current" : ""}
                  to={href}
                  key={href}
                >
                  <span>{label}</span>
                  <Icon name="arrow" />
                </Link>
              ))}
            </nav>

            <button type="button" onClick={openPrivacySettings}>
              <span>Manage privacy acknowledgement</span>
              <Icon name="settings" />
            </button>

            <Link className="button button-primary" to="/contact">
              Contact YourComate
              <Icon name="arrow" />
            </Link>
          </aside>
        </div>
      </section>
    </main>
  );
}
