import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

export default function SayaPage() {
  const capabilities = [
    ["Work context", "Use signed-in HR information and the user’s role before offering guidance.", "people", "violet"],
    ["Workflow guidance", "Help employees and authorised users identify the right next action inside HRMS.", "arrow", "cyan"],
    ["Permission awareness", "Keep recommendations and supported actions within role and access boundaries.", "shield", "coral"],
    ["HRMS assistance", "Support attendance, leave, approvals, projects and other connected YourComate workflows.", "settings", "amber"],
  ];

  return (
    <main className="public-main">
      <PageHero
        eyebrow="Saya inside HRMS"
        title="Role-aware guidance inside the signed-in YourComate workspace."
        description="Saya is YourComate’s in-product HR assistant. It uses the signed-in user’s role, permissions and workspace context to guide employees and authorised teams. The public website helper remains a separate general navigation assistant."
        icon="sparkle"
        tone="violet"
        variant="saya"
        primary={["Explore the Platform", "/product"]}
        secondary={["Request a Demo", "/demo-registration"]}
      >
        <HeroScene type="saya" />
      </PageHero>

      <section className="public-section">
        <div className="page-width saya-capability-grid">
          {capabilities.map(([title, copy, icon, tone]) => (
            <article className={`saya-capability-${tone}`} key={title}>
              <span><Icon name={icon} /></span>
              <h2>{title}</h2>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
