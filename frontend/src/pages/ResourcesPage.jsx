import { useEffect } from "react";
import { Link } from "react-router-dom";
import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const resources = [
  {
    type: "HRMS guide",
    title: "YourComate HRMS Guide",
    copy: "A complete operating guide to people, work, talent, payroll, service and platform administration.",
    icon: "book",
    tone: "cyan",
    href: "/resources/hrms-guide",
    detail: "Operating handbook",
  },
  {
    type: "Product walkthroughs",
    title: "YourComate Product Walkthroughs",
    copy: "Role-by-role journeys through the most important YourComate workflows.",
    icon: "play",
    tone: "violet",
    href: "/resources/product-walkthroughs",
    detail: "16 guided workflows",
  },
  {
    type: "Frequently asked questions",
    title: "YourComate Frequently Asked Questions",
    copy: "Clear answers about setup, roles, workflows, payroll, recruitment, support and Razorpay billing.",
    icon: "help",
    tone: "amber",
    href: "/resources/frequently-asked-questions",
    detail: "95 verified answers",
  },
];

export default function ResourcesPage() {
  useEffect(() => {
      document.documentElement.classList.add("yc-resource-page-active");
      document.body.classList.add("yc-resource-page-active");

      return () => {
        document.documentElement.classList.remove("yc-resource-page-active");
        document.body.classList.remove("yc-resource-page-active");
      };
    }, []);

  return (
    <main className="public-main yc-resource-centre-page">
      <PageHero
        eyebrow="Resource centre"
        title="Choose the resource that matches what you need to do next."
        description="Use the operating guide for implementation, walkthroughs for role-by-role actions, or FAQs for quick verified answers."
        icon="book"
        tone="amber"
        variant="resources"
        secondary={["Explore Product", "/product"]}
      >
        <div className="yc-resource-hero-panel tone-amber">
          <span className="yc-resource-hero-panel-kicker">
            <Icon name="book" /> Resource centre
          </span>
          <h2>Three focused ways to learn YourComate.</h2>
          <p>
            Pick the format that matches the job in front of you, then move
            directly into the relevant guide, workflow or answer.
          </p>
          <div className="yc-resource-hero-panel-links">
            <span><Icon name="book" /> Operating guide</span>
            <span><Icon name="play" /> Product walkthroughs</span>
            <span><Icon name="help" /> Verified FAQs</span>
          </div>
        </div>
      </PageHero>

      <section className="public-section yc-resource-library-section">
        <div className="page-width">
          <header className="yc-resource-heading">
            <span className="public-kicker">
              <Icon name="book" /> Resource library
            </span>
            <div>
              <h2>Choose the resource that matches what you need to do next.</h2>
              <p>
                The former combined resource content is now separated into three
                dedicated pages for faster scanning, clearer navigation and better
                mobile rendering.
              </p>
            </div>
          </header>

          <div className="yc-resource-library-grid">
            {resources.map((resource, index) => (
              <Link
                className={`yc-resource-library-card tone-${resource.tone}`}
                to={resource.href}
                key={resource.href}
                aria-label={`Open ${resource.title}`}
              >
                <header>
                  <span aria-hidden="true"><Icon name={resource.icon} /></span>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                </header>
                <small>{resource.type}</small>
                <h3>{resource.title}</h3>
                <p>{resource.copy}</p>
                <div className="yc-resource-card-meta">{resource.detail}</div>
                <span className="yc-resource-card-open">
                  Open resource <Icon name="arrow" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
