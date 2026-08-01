import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const deliveryCards = [
  [
    "Product thinking",
    "Start with the operating problem, the people involved and the outcome the organisation needs.",
    "sparkle",
    "sky",
  ],
  [
    "Software engineering",
    "Build dependable interfaces, services and data structures as one connected platform.",
    "settings",
    "lilac",
  ],
  [
    "Implementation support",
    "Configure, introduce and improve technology alongside the teams who will use it.",
    "hierarchy",
    "cream",
  ],
];

const pillars = [
  [
    "Technology with purpose",
    "Digital products are shaped around useful outcomes, dependable operation and clear ownership.",
    "sparkle",
    "sky",
    "Useful outcomes",
  ],
  [
    "Long-term partnership",
    "The group works with organisations beyond launch, supporting improvement as real needs evolve.",
    "people",
    "lilac",
    "Built to evolve",
  ],
  [
    "Responsible delivery",
    "Security, accessibility, maintainability and practical performance remain part of every decision.",
    "shield",
    "cream",
    "Responsible systems",
  ],
  [
    "Built for people",
    "Complex systems are translated into interfaces and workflows that teams can understand and use.",
    "building",
    "mint",
    "Clear everyday use",
  ],
];

function SayanantDeliveryScene() {
  return (
    <div
      className="yc-sayanant-group-scene"
      aria-label="Sayanant Group digital delivery approach"
    >
      <header className="yc-sayanant-scene-header">
        <span className="yc-sayanant-scene-mark" aria-hidden="true">
          <Icon name="building" />
        </span>

        <div>
          <small>SAYANANT GROUP</small>
          <strong>Connected digital delivery</strong>
        </div>

        <em>
          <i />
          Product to implementation
        </em>
      </header>

      <div className="yc-sayanant-scene-flow" aria-label="Delivery stages">
        <span>Understand</span>
        <i />
        <span>Design</span>
        <i />
        <span>Build</span>
        <i />
        <span>Support</span>
      </div>

      <div className="yc-sayanant-scene-cards">
        {deliveryCards.map(([title, copy, icon, tone], index) => (
          <article className={`tone-${tone}`} key={title}>
            <header>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <span aria-hidden="true">
                <Icon name={icon} />
              </span>
            </header>
            <small>DELIVERY CAPABILITY</small>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </div>

      <footer className="yc-sayanant-scene-footer">
        <span>
          <Icon name="checklist" />
          Practical systems built to remain useful after launch
        </span>
        <strong>YourComate is one platform shaped through this approach.</strong>
      </footer>
    </div>
  );
}

export default function AboutSayanantPage() {
  return (
    <main className="public-main yc-group-about-page">
      <PageHero
        eyebrow="About Sayanant Group"
        title="A technology group building practical digital systems for growing organisations."
        description="Sayanant Group brings product thinking, software engineering and implementation support together to create dependable platforms such as YourComate."
        icon="building"
        tone="cyan"
        variant="about"
        primary={["Explore YourComate", "/product"]}
        secondary={["Contact the team", "/contact"]}
      >
        <SayanantDeliveryScene />
      </PageHero>

      <section className="public-section yc-group-story-section">
        <div className="page-width yc-group-story-shell">
          <header>
            <span className="public-kicker">
              <Icon name="sparkle" /> How we work
            </span>
            <h2>Thoughtful technology, grounded in everyday operations.</h2>
            <p>
              Sayanant Group combines research, design and engineering with
              direct understanding of how teams actually work. The result is
              software that feels clear at first use and remains dependable as
              an organisation grows.
            </p>
          </header>

          <div className="yc-group-pillars">
            {pillars.map(([title, copy, icon, tone, signal], index) => (
              <article className={`tone-${tone}`} key={title}>
                <header>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span aria-hidden="true">
                    <Icon name={icon} />
                  </span>
                </header>

                <div>
                  <small>WORKING PRINCIPLE</small>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>

                <footer>
                  <span>{signal}</span>
                </footer>
              </article>
            ))}
          </div>

          <Link className="button button-primary" to="/contact">
            Start a conversation <Icon name="arrow" />
          </Link>
        </div>
      </section>
    </main>
  );
}
