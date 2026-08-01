import { Link } from "react-router-dom";
import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const stories = [
  [
    "Growing services team",
    "From spreadsheet attendance to role-based daily visibility",
    "Attendance, leave and reporting became easier to review across office and field employees.",
    "attendance",
    "sky",
  ],
  [
    "Multi-team organisation",
    "Clearer reporting lines and approval ownership",
    "Employee records, manager views and request status were arranged around actual responsibilities.",
    "hierarchy",
    "lilac",
  ],
  [
    "Project-led workforce",
    "One place for assigned work and progress updates",
    "Managers gained clearer visibility into owners, collaborators and active delivery status.",
    "project",
    "cream",
  ],
];

const outcomes = [
  ["Clearer", "employee self-service"],
  ["Faster", "role-based decisions"],
  ["Connected", "people and work records"],
  ["Responsive", "web and mobile access"],
];

export default function CustomersPage() {
  return (
    <main className="public-main">
      <PageHero
        eyebrow="Customer outcomes"
        title="Built for organisations that want everyday HR work to feel easier."
        description="YourComate is designed around practical operating problems: disconnected records, unclear approvals, limited visibility and difficult mobile access."
        icon="people"
        tone="cyan"
        variant="customers"
        secondary={["Explore Product", "/product"]}
        note="Outcome examples describe intended workflow improvements, not guaranteed results"
      >
        <HeroScene type="customers" />
      </PageHero>

      <section className="public-section yc-customer-stories-section">
        <div className="page-width">
          <div className="yc-inside-section-heading yc-customer-section-heading">
            <span className="public-kicker">
              <Icon name="people" /> Operating outcomes
            </span>
            <div>
              <h2>Examples of where connected workflows create clarity.</h2>
             
            </div>
          </div>

          <div className="yc-customer-story-grid">
            {stories.map(([type, title, copy, icon, tone], index) => (
              <article className={`tone-${tone}`} key={title}>
                <header>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span aria-hidden="true">
                    <Icon name={icon} />
                  </span>
                </header>
                <small>{type}</small>
                <h2>{title}</h2>
                <p>{copy}</p>
                <Link to="/demo-registration">
                  Explore in a demo <Icon name="arrow" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="public-section yc-customer-metrics-section">
        <div className="page-width yc-customer-metric-grid">
          {outcomes.map(([title, copy], index) => (
            <article key={title}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <strong>{title}</strong>
              <span>{copy}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
