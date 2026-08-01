import { Link } from "react-router-dom";
import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";
import { productGroups } from "../data/publicSiteData";

export default function ProductPage() {
  return (
    <main className="public-main">
      <PageHero
        eyebrow="YourComate platform"
        title="A connected operating system for everyday people work."
        description="Bring employee data, attendance, leave, projects, recruitment, payroll, payslips, approvals, policies, support, Saya AI and workforce visibility into one responsive role-based platform."
        icon="hierarchy"
        tone="violet"
        variant="product"
        secondary={["View Pricing", "/pricing"]}
        note="Designed for office, remote and field teams"
      >
        <HeroScene type="product" />
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
