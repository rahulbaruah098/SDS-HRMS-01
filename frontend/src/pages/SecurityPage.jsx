import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const responsibilityPillars = [
  ["Verified onboarding", "email", "blue"],
  ["Role-based access", "people", "cyan"],
  ["Approval control", "approval", "violet"],
  ["Web and mobile", "mobile", "mint"],
];

const identityControls = [
  [
    "Verified company onboarding",
    "Trial requests use an email OTP before Platform Super Admin review. The OTP is stored as a hash, expires after a configured period and limits failed attempts. Submission alone does not create company access.",
    "email",
    "blue",
  ],
  [
    "Protected passwords",
    "Passwords are verified against one-way hashes and hashes are removed from API responses. Self-service change requires the current password, confirmation and authentication. Password values stay out of audit details.",
    "lock",
    "cyan",
  ],
  [
    "Short-lived authenticated access",
    "Protected APIs use signed, short-lived bearer access tokens. The backend checks token type, expiry and active user before proceeding, then synchronises effective roles from the current account and employee context.",
    "shield",
    "violet",
  ],
  [
    "Bounded and revocable sessions",
    "Only refresh-token hashes are stored. Tokens rotate atomically, the overall session has an absolute lifetime, and expired or unavailable-user sessions are revoked. Sign-out revokes the matching session.",
    "check",
    "mint",
  ],
];

const authorisationControls = [
  [
    "Tenant-scoped records",
    "The tenant_id field scopes users and operational records. Authenticated requests derive the current tenant context before tenant-specific queries or actions.",
    "building",
    "blue",
  ],
  [
    "Role-based permissions",
    "Protected endpoints verify roles and return forbidden when the required responsibility is absent. Platform Super Admin access is separated from ordinary tenant work.",
    "people",
    "cyan",
  ],
  [
    "Capability-aware access",
    "Team Leader and Reporting Officer remain employee capabilities and mappings. Effective access is rebuilt from the active user and employee record, not only an interface label.",
    "shield",
    "violet",
  ],
  [
    "Approval control",
    "Sensitive workflows keep decision authority with configured roles and the live approval state. Saya or other guidance does not replace authorised approval.",
    "approval",
    "mint",
  ],
  [
    "Identity integrity",
    "Tenant-scoped unique indexes reduce unintended reuse of employee and user identifiers. Disabled, deleted or unavailable accounts do not pass authenticated-user checks.",
    "lock",
    "amber",
  ],
  [
    "Traceable activity",
    "Audit records capture tenant, actor, role, action, entity and time for covered operations. Credentials stay out of audit metadata and ordinary response payloads.",
    "document",
    "pink",
  ],
];

const safeguardControls = [
  [
    "Sensitive response control",
    "Password hashes are excluded from user responses. Session-oriented payloads also avoid oversized embedded profile images.",
    "shield",
    "blue",
  ],
  [
    "Safer file handling",
    "Profile images use extension, size, filename, header, tenant-folder and path checks. Request size is configurable.",
    "document",
    "violet",
  ],
  [
    "Razorpay verification",
    "Razorpay checkout and webhook signatures use HMAC. Webhooks require a configured secret; server-side retrieval supports payment checks.",
    "check",
    "mint",
  ],
];

const sharedResponsibility = [
  {
    title: "Platform operation",
    tone: "blue",
    icon: "shield",
    items: [
      "Use unique production secrets, a strict origin allowlist and HTTPS.",
      "Keep systems patched and monitor security events.",
      "Test backup and recovery; maintain incident, access, upload and integration reviews.",
    ],
  },
  {
    title: "Customer organisation",
    tone: "cyan",
    icon: "people",
    items: [
      "Grant least privilege; review roles, mappings and approvers.",
      "Remove access promptly after role or employment changes.",
      "Train users to protect credentials, minimise uploads and report suspicious activity.",
    ],
  },
];

function SecurityHeading({ eyebrow, title, copy }) {
  return (
    <header className="yc-security-pdf-heading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      {copy ? <p>{copy}</p> : null}
    </header>
  );
}

function SecurityControlCard({ item, index, compact = false }) {
  const [title, copy, icon, tone] = item;

  return (
    <article
      className={`yc-security-pdf-card tone-${tone}${compact ? " is-compact" : ""}`}
    >
      <header>
        <b>{String(index + 1).padStart(2, "0")}</b>
        <span aria-hidden="true">
          <Icon name={icon} />
        </span>
      </header>
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

export default function SecurityPage() {
  return (
    <main className="public-main yc-security-page">
      <PageHero
        eyebrow="Security and Access"
        title="Controlled access begins with "
        titleAccent="clear identity and role boundaries."
        description="YourComate combines verified company onboarding, role-aware workspaces, controlled administrative permissions and traceable operations to support responsible platform access."
        icon="shield"
        tone="cyan"
        variant="security"
        secondary={["Contact Us", "/contact?topic=security"]}
      >
        <HeroScene type="security" />
      </PageHero>

      <section className="public-section yc-security-pdf-section yc-security-responsibility-section">
        <div className="page-width">
          <SecurityHeading
            eyebrow="Security overview"
            title="Security built around responsibility"
            copy="Security is not a decorative feature. It is a set of decisions about who may enter, which tenant and records they may access, what actions their role can perform, which approvals are required and how important activity is traced."
          />

          <div className="yc-security-pillar-grid">
            {responsibilityPillars.map(([title, icon, tone], index) => (
              <article className={`tone-${tone}`} key={title}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span aria-hidden="true">
                  <Icon name={icon} />
                </span>
                <strong>{title}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="public-section yc-security-pdf-section yc-security-identity-section">
        <div className="page-width">
          <SecurityHeading
            eyebrow="Identity protection"
            title="Verified access from onboarding to sign-out"
            copy="The supplied implementation uses several connected controls so that access is based on a verified company request, a valid account, an active session and the current responsibilities of the signed-in user."
          />

          <div className="yc-security-pdf-grid yc-security-pdf-grid-four">
            {identityControls.map((item, index) => (
              <SecurityControlCard item={item} index={index} key={item[0]} />
            ))}
          </div>

          <aside className="yc-security-callout yc-security-callout-dark">
            <span>Everyday user safety</span>
            <p>
              Use only the official YourComate address. Keep passwords, OTPs and
              tokens private. Use a device lock, avoid shared browser profiles,
              sign out when work is complete and report unexpected login or
              account activity through the Security contact route.
            </p>
          </aside>
        </div>
      </section>

      <section className="public-section yc-security-pdf-section yc-security-authorisation-section">
        <div className="page-width">
          <SecurityHeading
            eyebrow="Authorisation and accountability"
            title="Access follows tenant, role and responsibility"
            copy="Authentication answers who the user is. Authorisation then determines which tenant, module, record and action are appropriate for that signed-in identity."
          />

          <div className="yc-security-pdf-grid yc-security-pdf-grid-six">
            {authorisationControls.map((item, index) => (
              <SecurityControlCard
                item={item}
                index={index}
                compact
                key={item[0]}
              />
            ))}
          </div>

          <aside className="yc-security-callout yc-security-callout-dark yc-security-boundary-callout">
            <span aria-hidden="true">
              <Icon name="shield" />
            </span>
            <div>
              <strong>Controlled origins and API boundaries</strong>
              <p>
                Configured origin allowlists restrict cross-origin API access,
                and cross-origin credentials are disabled. Protected routes
                still require authentication and role checks.
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section className="public-section yc-security-pdf-section yc-security-safeguards-section">
        <div className="page-width">
          <SecurityHeading
            eyebrow="Practical safeguards"
            title="Data handling, uploads and payment verification"
            copy="YourComate combines application controls with responsible operation. The following safeguards are present in the supplied implementation; they do not replace secure deployment, monitoring or customer administration."
          />

          <div className="yc-security-pdf-grid yc-security-pdf-grid-three">
            {safeguardControls.map((item, index) => (
              <SecurityControlCard
                item={item}
                index={index}
                compact
                key={item[0]}
              />
            ))}
          </div>

          <h3 className="yc-security-shared-title">
            Security is a shared responsibility
          </h3>

          <div className="yc-security-responsibility-grid">
            {sharedResponsibility.map((group) => (
              <article className={`tone-${group.tone}`} key={group.title}>
                <header>
                  <span aria-hidden="true">
                    <Icon name={group.icon} />
                  </span>
                  <h3>{group.title}</h3>
                </header>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>
                      <i aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

        </div>
      </section>
    </main>
  );
}
