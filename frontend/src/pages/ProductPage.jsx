import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";
import { productGroups } from "../data/publicSiteData";

export default function ProductPage() {
  return (
    <main className="public-main yc-product-overview-page">
      <PageHero
        eyebrow="YourComate platform"
        title="One connected HR workspace for people, operations and workforce services."
        description="Bring employee records, attendance, leave, projects, approvals, recruitment, payroll, payslips, policies, support, reporting, mobile work and Saya into one role-based platform."
        icon="hierarchy"
        tone="violet"
        variant="product"
        secondary={["View Pricing", "/pricing"]}
        note="Designed for office, remote and field teams"
      >
        <div className="yc-product-hero-panel">
          <span className="yc-product-hero-kicker">
            <Icon name="hierarchy" /> YourComate platform
          </span>
          <h2>Connected workflows, separated by responsibility.</h2>
          <p>
            Start with the area your team needs, while shared people records,
            role permissions and connected operational context keep the wider
            HRMS aligned.
          </p>
          <div className="yc-product-hero-pillars">
            <span>People foundation</span>
            <span>Everyday operations</span>
            <span>Talent & payroll</span>
            <span>Service & intelligence</span>
          </div>
        </div>
      </PageHero>

      <section className="public-section">
        <div className="page-width">
          <div className="public-section-heading public-section-heading-centered">
            <span className="public-kicker"><Icon name="checklist" /> Product capabilities</span>
            <h2>Choose the workflow your team needs to improve first.</h2>
            <p>Every area is connected through shared people records, role permissions, payroll context and responsive dashboards.</p>
          </div>
          <div className="product-directory-grid">
            {productGroups.flatMap((group) => group.links.map(([label, href, icon]) => (
              <Link to={href} key={href}>
                <span><Icon name={icon} /></span>
                <h3>{label}</h3>
                <p>Explore the workflow, capabilities and role-based experience.</p>
                <b>Open product page <Icon name="arrow" /></b>
              </Link>
            )))}
          </div>
        </div>
      </section>
    </main>
  );
}
