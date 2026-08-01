import { useState } from "react";
import { Link } from "react-router-dom";
import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";
import { resourceCards } from "../data/publicSiteData";

const walkthroughs = [
  [
    "Attendance overview",
    "Office, work-from-home and field attendance flow",
    "attendance",
    "/product/attendance",
  ],
  [
    "Leave decision flow",
    "Application, review and status visibility",
    "calendar",
    "/product/leave",
  ],
  [
    "Project delivery flow",
    "Ownership, collaboration and progress updates",
    "project",
    "/product/projects",
  ],
];

const faqs = [
  [
    "What is included in the demo?",
    "The demo provides controlled access for up to 10 employees over 15 days, with the available evaluation modules shown during onboarding.",
  ],
  [
    "Why is company email OTP required?",
    "OTP verifies access to the registered company email before the request enters Superadmin review.",
  ],
  [
    "Can different roles receive different dashboards?",
    "Yes. Employees, managers, HR, Admin and field roles receive interfaces aligned with their responsibilities.",
  ],
  [
    "Is the platform mobile ready?",
    "Yes. The public website and HRMS screens are designed to work responsively across desktop, tablet and mobile devices.",
  ],
];

export default function ResourcesPage() {
  const [open, setOpen] = useState(0);

  return (
    <main className="public-main">
      <PageHero
        eyebrow="Resource centre"
        title="Practical HRMS knowledge for evaluation, rollout and everyday use."
        description="Use guides, templates, walkthroughs and frequently asked questions to plan a clearer HR technology journey."
        icon="book"
        tone="amber"
        variant="resources"
        secondary={["Explore Product", "/product"]}
      >
        <HeroScene type="resources" />
      </PageHero>

      <section className="public-section yc-resource-library-section" id="guides">
        <div className="page-width">
          <div className="yc-inside-section-heading">
            <span className="public-kicker">
              <Icon name="book" /> Guides and tools
            </span>
            <div>
              <h2>Start with the resource that matches your next decision.</h2>
              <p>
                Use a practical guide, checklist or template without adding
                unnecessary process around the work.
              </p>
            </div>
          </div>

          <div className="yc-resource-library-grid">
            {resourceCards.map((resource, index) => (
              <article
                className={`yc-resource-library-card tone-${resource.tone}`}
                key={resource.title}
              >
                <header>
                  <span aria-hidden="true">
                    <Icon name={resource.icon} />
                  </span>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                </header>

                <small>{resource.type}</small>
                <h3>{resource.title}</h3>
                <p>{resource.copy}</p>

                <Link to={`/resources/${resource.slug}`}>
                  Open resource <Icon name="arrow" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        className="public-section yc-resource-walkthrough-section"
        id="walkthroughs"
      >
        <div className="page-width">
          <div className="public-section-heading public-section-heading-split">
            <div>
              <span className="public-kicker">
                <Icon name="play" /> Product walkthroughs
              </span>
              <h2>Understand the workflow before opening the screen.</h2>
            </div>
            <p>
              Walkthrough topics cover attendance, leave, projects, employee
              self-service, support and demo onboarding.
            </p>
          </div>

          <div className="yc-resource-walkthrough-grid">
            {walkthroughs.map(([title, copy, icon, href], index) => (
              <Link className="yc-resource-walkthrough-card" to={href} key={title}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span aria-hidden="true">
                  <Icon name={icon} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
                <em>
                  View related product <Icon name="arrow" />
                </em>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="public-section yc-resource-template-section" id="templates">
        <div className="page-width">
          <div className="public-section-heading">
            <span className="public-kicker">
              <Icon name="document" /> HR templates
            </span>
            <h2>Reusable structures for evaluation and rollout.</h2>
          </div>

          <div className="yc-resource-template-band">
            <span aria-hidden="true">
              <Icon name="document" />
            </span>
            <div>
              <small>READY-TO-USE STARTING POINT</small>
              <h3>HRMS requirement capture</h3>
              <p>
                Document employee count, locations, work modes, user roles,
                priority modules and decision criteria.
              </p>
            </div>
            <Link className="button button-primary" to="/resources/evaluation-template">
              Open Template <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>

      <section className="public-section yc-resource-faq-section" id="faq">
        <div className="page-width yc-resource-faq-layout">
          <div className="public-section-heading">
            <span className="public-kicker">
              <Icon name="help" /> FAQ
            </span>
            <h2>Common questions, clearly answered.</h2>
            <p>
              Open one question at a time to keep the page quick to scan on
              desktop, tablet and mobile screens.
            </p>
          </div>

          <div className="yc-resource-faq-list">
            {faqs.map(([question, answer], index) => {
              const isOpen = open === index;
              const answerId = `resource-faq-answer-${index}`;

              return (
                <article className={isOpen ? "is-open" : ""} key={question}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => setOpen(isOpen ? -1 : index)}
                  >
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>{question}</span>
                    <Icon name="chevronDown" />
                  </button>
                  <div id={answerId}>
                    <p>{answer}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
