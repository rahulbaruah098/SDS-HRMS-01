import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const controls = [
  [
    "Verified onboarding",
    "Company demo requests require email OTP verification before review.",
    "email",
    "sky",
  ],
  [
    "Role-based access",
    "Users receive navigation and actions based on assigned responsibilities.",
    "people",
    "lilac",
  ],
  [
    "Approval control",
    "Sensitive requests and administrative actions stay with authorised roles.",
    "approval",
    "cream",
  ],
  [
    "Responsive access",
    "The experience supports secure use across web and mobile contexts.",
    "mobile",
    "mint",
  ],
];

export default function SecurityPage() {
  return (
    <main className="public-main">
      <PageHero
        eyebrow="Security & access"
        title="Controlled access begins with clear identity and role boundaries."
        description="YourComate combines verified company onboarding, role-based workspaces and controlled administrative permissions to support responsible platform access."
        icon="shield"
        tone="cyan"
        variant="security"
        secondary={["Contact Us", "/contact?topic=security"]}
      >
        <HeroScene type="security" />
      </PageHero>

      <section className="public-section yc-security-controls-section">
        <div className="page-width">
          <div className="yc-inside-section-heading yc-security-section-heading">
            <span className="public-kicker">
              <Icon name="shield" /> Access controls
            </span>
            <div>
              <h2>Security is organised around identity, role and responsibility.</h2>
              <p>
                Each control supports a clear access decision instead of adding
                decorative complexity or unnecessary steps.
              </p>
            </div>
          </div>

          <div className="yc-security-controls-grid">
            {controls.map(([title, copy, icon, tone], index) => (
              <article className={`tone-${tone}`} key={title}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span aria-hidden="true">
                  <Icon name={icon} />
                </span>
                <h2>{title}</h2>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
