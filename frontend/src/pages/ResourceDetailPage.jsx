import { Navigate, useParams } from "react-router-dom";
import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";
import { resourceCards } from "../data/publicSiteData";

export default function ResourceDetailPage() {
  const { resourceKey } = useParams();
  const resource = resourceCards.find((item) => item.slug === resourceKey);

  if (!resource) {
    return <Navigate to="/resources" replace />;
  }

  return (
    <main className="public-main">
      <PageHero
        eyebrow={resource.type}
        title={resource.title}
        description={resource.copy}
        icon={resource.icon}
        tone={resource.tone}
        variant="resource-detail"
        primary={["Request a Demo", "/demo-registration"]}
        secondary={["All Resources", "/resources"]}
      >
        <HeroScene type="resource" title={resource.title} />
      </PageHero>

      <section className="public-section yc-resource-detail-section">
        <div className="page-width yc-resource-detail-layout">
          <aside className={`yc-resource-detail-intro tone-${resource.tone}`}>
            <span aria-hidden="true">
              <Icon name={resource.icon} />
            </span>
            <small>{resource.type}</small>
            <h2>Use this resource as a practical starting point.</h2>
            <p>
              Adapt each section to your organisation’s actual roles, policies
              and rollout requirements.
            </p>
            <div>
              <b>{String(resource.sections.length).padStart(2, "0")}</b>
              <span>focused sections</span>
            </div>
          </aside>

          <div className="yc-resource-detail-steps">
            {resource.sections.map(([title, copy], index) => (
              <article key={title}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <div>
                  <h2>{title}</h2>
                  <p>{copy}</p>
                </div>

              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
