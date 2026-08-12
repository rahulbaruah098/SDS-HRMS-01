import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

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
  controls,
  checklist,
  notes,
  basis,
}) {
  return (
    <main className={`public-main yc-feature-guide-page tone-${tone}`}>
      <PageHero
        eyebrow={category}
        title={title}
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
                <span className="yc-feature-card-icon"><Icon name="check" /></span>
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
              <TextCard className="yc-feature-user-card" key={item}>
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
              <article className="yc-feature-step-card" key={item}>
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
            <div>
              <FeatureHeading
                eyebrow="Key records, states and rules"
                title="The records and states that keep the workflow clear"
              />
              <div className="yc-feature-rule-list">
                {rules.map((item) => (
                  <TextCard key={item}>
                    <span className="yc-feature-card-icon"><Icon name="shield" /></span>
                    <p>{item}</p>
                  </TextCard>
                ))}
              </div>
            </div>

            <div>
              <FeatureHeading
                eyebrow="Connected YourComate modules"
                title="The surrounding modules that supply or consume context"
              />
              <div className="yc-feature-module-list">
                {modules.map((item) => (
                  <TextCard key={item}>
                    <span className="yc-feature-card-icon"><Icon name="hierarchy" /></span>
                    <p>{item}</p>
                  </TextCard>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="public-section yc-feature-guide-section yc-feature-controls-section">
        <div className="page-width yc-feature-guide-shell">
          <FeatureHeading
            eyebrow="Operational controls"
            title="Guardrails for responsible day-to-day use"
          />

          <div className="yc-feature-control-grid">
            {controls.map((item) => (
              <TextCard className="yc-feature-control-card" key={item}>
                <span className="yc-feature-card-icon"><Icon name="shield" /></span>
                <p>{item}</p>
              </TextCard>
            ))}
          </div>

          <FeatureHeading
            eyebrow="Practical rollout checklist"
            title="What to confirm before teams depend on the workflow"
          />

          <div className="yc-feature-checklist-grid">
            {checklist.map((item) => (
              <TextCard className="yc-feature-check-card" key={item}>
                <span className="yc-feature-card-icon"><Icon name="check" /></span>
                <p>{item}</p>
              </TextCard>
            ))}
          </div>
        </div>
      </section>

      <section className="public-section yc-feature-guide-section yc-feature-notes-section">
        <div className="page-width yc-feature-guide-shell">
          <FeatureHeading
            eyebrow="Important operating notes"
            title="Keep these implementation details visible"
          />

          <div className="yc-feature-note-grid">
            {notes.map((item) => (
              <TextCard className="yc-feature-note-card" key={item}>
                <p>{item}</p>
              </TextCard>
            ))}
          </div>

          <div className="yc-feature-basis-card">
            <span>Implementation basis</span>
            <p>{basis}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
