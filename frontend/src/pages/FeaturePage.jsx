import { Navigate, useParams } from "react-router-dom";
import FeatureHeroVisual from "../components/FeatureHeroVisual";
import Icon from "../components/Icon";
import RecruitmentFeatureVisual from "../components/RecruitmentFeatureVisual";
import PageHero from "../components/PageHero";
import { featurePages } from "../data/publicSiteData";

export default function FeaturePage() {
  const { featureKey } = useParams();
  const feature = featurePages[featureKey];

  if (!feature) {
    return <Navigate to="/product" replace />;
  }

  return (
    <main className="public-main">
      <PageHero
        eyebrow={feature.eyebrow}
        title={feature.title}
        description={feature.description}
        icon={feature.icon}
        tone={feature.tone}
        variant={`feature feature-${featureKey}`}
        note="Role-based controls remain part of every workflow"
      >
        {featureKey === "recruitment" ? (
          <RecruitmentFeatureVisual />
        ) : (
          <FeatureHeroVisual featureKey={featureKey} />
        )}
      </PageHero>

      <section className="public-section">
        <div className="page-width">
          <div className="public-section-heading public-section-heading-centered">
            <span className="public-kicker"><Icon name="checklist" /> Key capabilities</span>
            <h2>Designed for clear everyday use.</h2>
          </div>
          <div className="feature-capability-grid">
          {feature.highlights.map((item, index) => (
  <article key={item}>
    <span>{String(index + 1).padStart(2, "0")}</span>
    <h3>{item}</h3>
  </article>
))}
          </div>
        </div>
      </section>

      <section className="public-section feature-workflow-section">
        <div className="page-width">
          <div className="public-section-heading public-section-heading-split">
            <div><span className="public-kicker"><Icon name="settings" /> Workflow</span><h2>A direct route from action to visibility.</h2></div>
            <p>Each step keeps the right person informed while preserving role-based control.</p>
          </div>
          <div className="feature-workflow-grid">
          {feature.workflow.map((step, index) => (
  <article key={step}>
    <b>{String(index + 1).padStart(2, "0")}</b>
    <strong>{step}</strong>
  </article>
))}
          </div>
        </div>
      </section>
    </main>
  );
}
