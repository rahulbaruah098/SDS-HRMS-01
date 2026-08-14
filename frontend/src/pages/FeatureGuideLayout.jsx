import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

/*
 * Creates the two-tone hero-title treatment used across the public website.
 *
 * Feature titles containing "&" are split naturally around that separator:
 * "Core HR & Employee Records"
 *    -> "Core HR &" + "Employee Records"
 *
 * Titles without "&" are split toward the end so the full original wording
 * remains unchanged.
 *
 * Only the PageHero title receives this formatting. The original string
 * `title` is still used everywhere else in the feature page.
 */
function splitFeatureHeroTitle(title = "") {
  const cleanTitle = String(title || "").trim();

  if (!cleanTitle) {
    return {
      title: "",
      titleAccent: "",
    };
  }

  if (cleanTitle.includes(" & ")) {
    const [firstPart, ...remainingParts] = cleanTitle.split(" & ");

    return {
      title: `${firstPart} &`,
      titleAccent: remainingParts.join(" & "),
    };
  }

  const words = cleanTitle.split(/\s+/);

  if (words.length === 1) {
    return {
      title: cleanTitle,
      titleAccent: "",
    };
  }

  const splitIndex = Math.max(1, Math.ceil(words.length / 2));

  return {
    title: words.slice(0, splitIndex).join(" "),
    titleAccent: words.slice(splitIndex).join(" "),
  };
}

function FeatureHeading({ eyebrow, title, copy }) {
  return (
    <header className="yc-feature-guide-heading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      {copy ? <p>{copy}</p> : null}
    </header>
  );
}

function TextCard({ children, className = "" }) {
  return (
    <article className={`yc-feature-text-card ${className}`.trim()}>
      {children}
    </article>
  );
}

export default function FeatureGuideLayout({
  category,
  title,
  purpose,
  icon,
  tone,
  heroHeading,
  heroPillars,
  covers,
  users,
  workflow,
  rules,
  modules,
}) {
  const heroTitle = splitFeatureHeroTitle(title);

  return (
    <main className={`public-main yc-feature-guide-page tone-${tone}`}>
      <PageHero
        eyebrow={category}
        title={heroTitle.title}
        titleAccent={heroTitle.titleAccent}
        description={purpose}
        icon={icon}
        tone={tone}
        variant="feature-guide"
        secondary={["All Features", "/product"]}
      >
        <div className="yc-feature-hero-panel">
          <span className="yc-feature-hero-kicker">
            <Icon name={icon} /> {title}
          </span>

          <h2>{heroHeading}</h2>

          <div className="yc-feature-hero-pillars">
            {heroPillars.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>

          <div className="yc-feature-hero-context">
            <strong>Connected YourComate workflow</strong>
            <p>
              The authorised module remains the source of truth for records,
              decisions and final status.
            </p>
          </div>
        </div>
      </PageHero>

      <section className="public-section yc-feature-guide-section yc-feature-purpose-section">
        <div className="page-width yc-feature-guide-shell">
          <FeatureHeading
            eyebrow="Purpose and scope"
            title={title}
            copy={purpose}
          />

          <div className="yc-feature-cover-grid">
            {covers.map((item) => (
              <TextCard key={item}>
                <span className="yc-feature-card-icon">
                  <Icon name="check" />
                </span>
                <p>{item}</p>
              </TextCard>
            ))}
          </div>

          <FeatureHeading
            eyebrow="Who uses it"
            title="Role-aware access around the workflow"
          />

          <div className="yc-feature-user-grid">
            {users.map((item) => (
              <TextCard
                className="yc-feature-user-card"
                key={item}
              >
                <p>{item}</p>
              </TextCard>
            ))}
          </div>
        </div>
      </section>

      <section className="public-section yc-feature-guide-section yc-feature-workflow-section">
        <div className="page-width yc-feature-guide-shell">
          <FeatureHeading
            eyebrow="How the workflow operates"
            title="From the first action to the authoritative record"
          />

          <div className="yc-feature-step-grid">
            {workflow.map((item, index) => (
              <article
                className="yc-feature-step-card"
                key={item}
              >
                <b>{String(index + 1).padStart(2, "0")}</b>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="public-section yc-feature-guide-section yc-feature-rules-section">
        <div className="page-width yc-feature-guide-shell">
          <div className="yc-feature-split-grid">
            <div className="yc-feature-split-heading yc-feature-split-heading-rules">
              <FeatureHeading
                eyebrow="Key records, states and rules"
                title="The records and states that keep the workflow clear"
              />
            </div>

            <div className="yc-feature-split-heading yc-feature-split-heading-modules">
              <FeatureHeading
                eyebrow="Connected YourComate modules"
                title="The surrounding modules that supply or consume context"
              />
            </div>

            <div className="yc-feature-rule-list">
              {rules.map((item) => (
                <TextCard key={item}>
                  <span className="yc-feature-card-icon">
                    <Icon name="shield" />
                  </span>
                  <p>{item}</p>
                </TextCard>
              ))}
            </div>

            <div className="yc-feature-module-list">
              {modules.map((item) => (
                <TextCard key={item}>
                  <span className="yc-feature-card-icon">
                    <Icon name="hierarchy" />
                  </span>
                  <p>{item}</p>
                </TextCard>
              ))}
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}