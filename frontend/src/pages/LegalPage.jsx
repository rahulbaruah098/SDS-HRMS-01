import { Navigate, useParams } from "react-router-dom";
import Icon from "../components/Icon";
import {
  legalPages,
  POLICY_EFFECTIVE_DATE,
  POLICY_VERSION,
} from "../data/legalContent";

const STRUCTURED_POLICY_KEYS = new Set([
  "privacy",
  "terms",
  "refund",
  "accessibility",
]);

const AT_A_GLANCE = {
  privacy: {
    cards: [
      [
        "Website and account data",
        "SDS decides why and how public enquiries, trial registrations, accounts, security logs and billing records are processed.",
      ],
      [
        "Customer workforce data",
        "The Customer generally decides the purposes of employee, candidate and HR data; SDS processes that data to deliver the service and follow valid instructions.",
      ],
      [
        "Payment data",
        "Razorpay processes payment instruments in its checkout. YourComate receives transaction and verification metadata needed to activate and administer subscriptions.",
      ],
    ],
  },
  terms: {
    cards: [
      [
        "Organisation-first service",
        "A person creating or administering a tenant confirms authority to act for the Customer and manage its Authorised Users.",
      ],
      [
        "Verified subscription activation",
        "Razorpay payment does not activate a paid term until YourComate verifies the payment response and records the subscription.",
      ],
      [
        "Customer-controlled HR decisions",
        "YourComate supports workflows; the Customer remains accountable for employment, recruitment, payroll and access decisions.",
      ],
    ],
  },
  refund: {
    cards: [
      [
        "Evaluate before purchase",
        "An approved 15-day trial is available so an organisation can assess the platform before paying.",
      ],
      [
        "Activated digital service",
        "A successfully verified payment creates immediate subscription access; change-of-mind and non-use are normally non-refundable.",
      ],
      [
        "Fair correction",
        "Duplicate charges, verified billing errors, unresolved activation failure and mandatory legal/contractual cases are reviewed for full or proportionate refund.",
      ],
    ],
  },
  accessibility: {
    cards: [
      [
        "Target",
        "YourComate uses WCAG 2.2 Level AA as its design and testing target; this is a commitment to improvement, not a claim of independent certification.",
      ],
      [
        "Scope",
        "The commitment covers public pages and first-party HRMS interfaces. Customer-uploaded content and independent third-party services have separate responsibilities.",
      ],
      [
        "Feedback",
        "Users can report a barrier and request a reasonable alternative format or assisted route through the published contact channel.",
      ],
    ],
  },
};

const TABLE_LAYOUTS = {
  "privacy:01": { header: "Processing context", rows: 3 },
  "privacy:15": { header: "Contact purpose", rows: 4 },
  "terms:02": { header: "Term", rows: 6 },
  "terms:23": { header: "Purpose", rows: 4 },
  "refund:08": { header: "Required information", rows: 5 },
  "refund:12": { header: "Refund channel", rows: 4 },
  "accessibility:11": { header: "What SDS will try to do", rows: 5 },
  "accessibility:13": { header: "Accessibility contact", rows: 5 },
};

const CALLOUT_MARKERS = {
  "privacy:02": "DATA MINIMISATION",
  "privacy:06": "PAYMENT SAFETY",
  "privacy:11": "CUSTOMER ACTION BEFORE EXPIRY",
  "terms:01": "READ WITH OTHER DOCUMENTS",
  "terms:07": "PREMIUM RENEWAL RULE",
  "refund:02": "REVIEW BEFORE AUTHORISING PAYMENT",
  "refund:04": "FULL OR PROPORTIONATE",
  "refund:09": "OPERATIONAL TARGETS",
  "accessibility:01": "ACCESSIBILITY IS CONTINUOUS",
  "accessibility:03": "NO REDUCTION OF RIGHTS",
  "accessibility:08": "CUSTOMER-UPLOADED MATERIAL",
};

const FORCED_PARAGRAPH_BREAKS = {
  "privacy:07": [
    "A user can clear browser storage through browser settings.",
  ],
  "terms:05": [
    "SDS may require a password reset, session termination or temporary restriction",
  ],
  "terms:12": [
    "SDS may investigate suspected misuse and preserve relevant records.",
  ],
  "accessibility:02": [
    "A Customer is responsible for the accessibility of content it uploads or creates",
  ],
  "accessibility:07": [
    "Authentication should support password managers",
    "Razorpay checkout is a third-party payment interface.",
  ],
  "accessibility:10": [
    "SDS prioritises barriers that prevent login, navigation, employment self-service",
  ],
};

const INTERPRETATION_COPY =
  "This document is written for practical website use. It does not remove non-waivable rights under applicable law, and an expressly accepted Order Form may contain more specific terms for a Customer.";

function addForcedParagraphBreaks(text, pageKey, sectionNumber) {
  const markers =
    FORCED_PARAGRAPH_BREAKS[`${pageKey}:${sectionNumber}`] || [];

  return markers.reduce(
    (value, marker) => value.replace(marker, `\n\n${marker}`),
    text,
  );
}

function renderInlineText(text) {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlPattern);

  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          className="legal-inline-link"
          href={part}
          target="_blank"
          rel="noreferrer"
          key={`${part}-${index}`}
        >
          {part}
        </a>
      );
    }

    return part;
  });
}

function renderTextBlocks(text, keyPrefix) {
  const blocks = text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const elements = [];
  let bullets = [];

  const flushBullets = () => {
    if (!bullets.length) {
      return;
    }

    const listIndex = elements.length;
    elements.push(
      <ul
        className="legal-bullet-list"
        key={`${keyPrefix}-list-${listIndex}`}
      >
        {bullets.map((item, index) => (
          <li key={`${keyPrefix}-bullet-${index}`}>
            {renderInlineText(item.replace(/^•\s*/, ""))}
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  blocks.forEach((block, index) => {
    if (block.startsWith("•")) {
      bullets.push(block);
      return;
    }

    flushBullets();

    elements.push(
      <p
        className="legal-body-paragraph"
        key={`${keyPrefix}-paragraph-${index}`}
      >
        {renderInlineText(block)}
      </p>,
    );
  });

  flushBullets();

  return elements;
}

function renderCallout(title, copy, key) {
  return (
    <aside className="legal-pdf-callout" key={key}>
      <strong>{title}</strong>
      <p>{renderInlineText(copy.trim())}</p>
    </aside>
  );
}

function renderAtAGlance(pageKey, page, copy) {
  const layout = AT_A_GLANCE[pageKey];

  if (!layout) {
    return renderTextBlocks(copy, `${pageKey}-gl`);
  }

  return (
    <div className="legal-structured-copy legal-at-a-glance">
      <p className="legal-body-paragraph legal-at-a-glance-intro">
        {page.summary}
      </p>

      <div className="legal-at-a-glance-grid">
        {layout.cards.map(([title, body], index) => (
          <section
            className="legal-at-a-glance-card"
            key={`${pageKey}-gl-card-${title}`}
          >
            <strong>{title}</strong>
            <p>{body}</p>
          </section>
        ))}
      </div>

      {renderCallout(
        "INTERPRETATION",
        INTERPRETATION_COPY,
        `${pageKey}-interpretation`,
      )}
    </div>
  );
}

function renderMappedTable(copy, pageKey, sectionNumber) {
  const config = TABLE_LAYOUTS[`${pageKey}:${sectionNumber}`];

  if (!config) {
    return null;
  }

  const headerIndex = copy.indexOf(config.header);

  if (headerIndex < 0) {
    return null;
  }

  const intro = copy.slice(0, headerIndex).trim();
  const tableText = copy.slice(headerIndex + config.header.length).trim();
  const blocks = tableText
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) {
    return null;
  }

  const secondHeader = blocks[0];
  const rowBlocks = blocks.slice(1, 1 + config.rows * 2);
  const trailing = blocks.slice(1 + config.rows * 2).join("\n\n").trim();
  const rows = [];

  for (let index = 0; index < rowBlocks.length; index += 2) {
    rows.push([rowBlocks[index], rowBlocks[index + 1] || ""]);
  }

  let trailingContent = null;

  if (trailing) {
    const calloutMatch = trailing.match(/^([A-Z][A-Z0-9 ’'&/—-]+)\s+(.+)$/s);

    if (
      calloutMatch &&
      [
        "IMPORTANT ROLE BOUNDARY",
      ].includes(calloutMatch[1].trim())
    ) {
      trailingContent = renderCallout(
        calloutMatch[1].trim(),
        calloutMatch[2].trim(),
        `${pageKey}-${sectionNumber}-table-callout`,
      );
    } else {
      trailingContent = renderTextBlocks(
        trailing,
        `${pageKey}-${sectionNumber}-table-trailing`,
      );
    }
  }

  return (
    <div className="legal-structured-copy">
      {intro
        ? renderTextBlocks(
            intro,
            `${pageKey}-${sectionNumber}-table-intro`,
          )
        : null}

      <div className="legal-data-table" role="table">
        <div className="legal-data-table-head" role="row">
          <strong role="columnheader">{config.header}</strong>
          <strong role="columnheader">{secondHeader}</strong>
        </div>

        <div className="legal-data-table-body">
          {rows.map(([label, value], index) => (
            <div
              className="legal-data-table-row"
              role="row"
              key={`${pageKey}-${sectionNumber}-row-${index}`}
            >
              <strong role="cell">{label}</strong>
              <div role="cell">{renderInlineText(value)}</div>
            </div>
          ))}
        </div>
      </div>

      {trailingContent}
    </div>
  );
}

function renderCalloutSection(copy, pageKey, sectionNumber, marker) {
  const markerIndex = copy.indexOf(marker);

  if (markerIndex < 0) {
    return renderTextBlocks(
      addForcedParagraphBreaks(copy, pageKey, sectionNumber),
      `${pageKey}-${sectionNumber}`,
    );
  }

  const before = copy.slice(0, markerIndex).trim();
  const calloutCopy = copy.slice(markerIndex + marker.length).trim();

  return (
    <div className="legal-structured-copy">
      {before
        ? renderTextBlocks(
            addForcedParagraphBreaks(before, pageKey, sectionNumber),
            `${pageKey}-${sectionNumber}-before-callout`,
          )
        : null}
      {renderCallout(
        marker,
        calloutCopy,
        `${pageKey}-${sectionNumber}-callout`,
      )}
    </div>
  );
}

function renderPrivacyFeatureSection(copy) {
  const markers = [
    "Saya assistance",
    "Location and field activity",
    "Face attendance and photographs",
    "PERMISSION IS NOT PURPOSE",
  ];

  const firstMarkerIndex = copy.indexOf(markers[0]);
  const intro = copy.slice(0, firstMarkerIndex).trim();
  const pieces = [];

  markers.forEach((marker, index) => {
    const start = copy.indexOf(marker);
    const nextMarker = markers[index + 1];
    const end = nextMarker ? copy.indexOf(nextMarker) : copy.length;
    pieces.push([
      marker,
      copy.slice(start + marker.length, end).trim(),
    ]);
  });

  return (
    <div className="legal-structured-copy">
      {renderTextBlocks(intro, "privacy-08-intro")}

      {pieces.slice(0, 3).map(([title, body]) => (
        <section className="legal-pdf-subsection" key={title}>
          <h4>{title}</h4>
          <p>{renderInlineText(body)}</p>
        </section>
      ))}

      {renderCallout(
        pieces[3][0],
        pieces[3][1],
        "privacy-08-permission-callout",
      )}
    </div>
  );
}

function renderReferenceBasis(copy, pageKey) {
  const governanceMarker = "POLICY GOVERNANCE";
  const governanceIndex = copy.indexOf(governanceMarker);
  const beforeGovernance =
    governanceIndex >= 0 ? copy.slice(0, governanceIndex).trim() : copy.trim();
  const governance =
    governanceIndex >= 0
      ? copy.slice(governanceIndex + governanceMarker.length).trim()
      : "";

  const blocks = beforeGovernance
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const intro = blocks.shift() || "";
  const references = blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const first = lines.shift() || "";
    const numberMatch = first.match(/^(\d{2})\s+(.+)$/);

    return {
      number: numberMatch ? numberMatch[1] : "",
      title: numberMatch ? numberMatch[2] : first,
      detail: lines.join(""),
    };
  });

  return (
    <div className="legal-structured-copy legal-reference-basis">
      {renderTextBlocks(intro, `${pageKey}-reference-intro`)}

      <div className="legal-reference-list">
        {references.map((reference, index) => (
          <div
            className="legal-reference-item"
            key={`${pageKey}-reference-${index}`}
          >
            <span>{reference.number || String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{reference.title}</strong>
              {reference.detail ? (
                <p>{renderInlineText(reference.detail)}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {governance
        ? renderCallout(
            governanceMarker,
            governance,
            `${pageKey}-policy-governance`,
          )
        : null}
    </div>
  );
}

function renderStructuredSection({
  pageKey,
  page,
  title,
  copy,
  sectionNumber,
}) {
  if (!STRUCTURED_POLICY_KEYS.has(pageKey)) {
    return (
      <p
        style={{
          whiteSpace: "pre-line",
          overflowWrap: "anywhere",
        }}
      >
        {copy}
      </p>
    );
  }

  if (sectionNumber === "GL") {
    return renderAtAGlance(pageKey, page, copy);
  }

  if (sectionNumber === "REF") {
    return renderReferenceBasis(copy, pageKey);
  }

  const table = renderMappedTable(copy, pageKey, sectionNumber);
  if (table) {
    return table;
  }

  if (pageKey === "privacy" && sectionNumber === "08") {
    return renderPrivacyFeatureSection(copy);
  }

  const calloutMarker =
    CALLOUT_MARKERS[`${pageKey}:${sectionNumber}`];

  if (calloutMarker) {
    return renderCalloutSection(
      copy,
      pageKey,
      sectionNumber,
      calloutMarker,
    );
  }

  return (
    <div className="legal-structured-copy">
      {renderTextBlocks(
        addForcedParagraphBreaks(copy, pageKey, sectionNumber),
        `${pageKey}-${sectionNumber}-${title}`,
      )}
    </div>
  );
}

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
              {page.sections.map(([title, , sectionNumber], index) => (
                <a href={`#legal-section-${index + 1}`} key={`${title}-${index}`}>
                  <b>{sectionNumber || String(index + 1).padStart(2, "0")}</b>
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

            {page.sections.map(([title, copy, sectionNumber], index) => (
              <article
                id={`legal-section-${index + 1}`}
                className={`legal-document-article legal-document-article-${
                  sectionNumber === "GL"
                    ? "glance"
                    : sectionNumber === "REF"
                      ? "reference"
                      : "standard"
                }`}
                key={`${title}-${index}`}
              >
                <b>{sectionNumber || String(index + 1).padStart(2, "0")}</b>
                <div>
                  <h3>{title}</h3>
                  {renderStructuredSection({
                    pageKey: resolvedKey,
                    page,
                    title,
                    copy,
                    sectionNumber,
                  })}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
