import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const productPrinciples = [
  [
    "People first",
    "Every workflow begins with the employee, manager or administrator who needs to complete real work clearly.",
    "people",
    "sky",
    "Designed around users",
  ],
  [
    "Connected work",
    "People records, attendance, leave, projects, approvals, payroll and support remain connected instead of becoming separate systems.",
    "link",
    "lilac",
    "One shared context",
  ],
  [
    "Role-aware access",
    "Each person sees the information and actions appropriate to their responsibility inside the organisation.",
    "shield",
    "cream",
    "Clear responsibility",
  ],
  [
    "Everyday usability",
    "The experience supports office, remote and field teams across responsive web and mobile views.",
    "mobile",
    "mint",
    "Ready for daily work",
  ],
];

export default function AboutPage() {
  return (
    <main className="public-main yc-about-yourcomate-page">
      <PageHero
        eyebrow="About YourComate"
        title="HR technology designed around real people, real roles and real work."
        description="YourComate is a connected HRMS workspace that helps organisations manage employee records, attendance, leave, projects, recruitment, payroll, approvals and support through clear role-aware workflows."
        icon="people"
        tone="violet"
        variant="about"
        primary={["Explore the platform", "/product"]}
        secondary={["Request a demo", "/demo-registration"]}
      >
        <HeroScene type="about" />
      </PageHero>

      <section className="public-section yc-company-values-section">
        <div className="page-width">
          <div className="yc-inside-section-heading yc-company-values-heading">
            <span className="public-kicker">
              <Icon name="sparkle" /> Product principles
            </span>

            <div>
              <h2>A clearer way to manage the everyday employee journey.</h2>
              <p>
                YourComate is shaped around connected information, responsible
                access and practical actions that employees and teams can use
                throughout the workday.
              </p>
            </div>
          </div>

          <div className="yc-company-values-grid">
            {productPrinciples.map(
              ([title, copy, icon, tone, signal], index) => (
                <article className={`tone-${tone}`} key={title}>
                  <header>
                    <b>{String(index + 1).padStart(2, "0")}</b>

                    <span aria-hidden="true">
                      <Icon name={icon} />
                    </span>
                  </header>

                  <div className="yc-company-value-copy">
                    <small>
                      PRODUCT PRINCIPLE{" "}
                      {String(index + 1).padStart(2, "0")}
                    </small>

                    <h2>{title}</h2>
                    <p>{copy}</p>
                  </div>

                  <footer>
                    <span>{signal}</span>
                  </footer>
                </article>
              ),
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
