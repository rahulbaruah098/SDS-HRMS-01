import { Link } from "react-router-dom";
import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const options = [
  [
    "Account access",
    "Open the sign-in page with your official credentials.",
    "lock",
    "/login",
    "sky",
  ],
  [
    "Demo support",
    "Start or review the controlled company demo onboarding process.",
    "email",
    "/demo-registration",
    "lilac",
  ],
  [
    "Product guidance",
    "Explore features, roles and platform workflows.",
    "book",
    "/product",
    "cream",
  ],
  [
    "Internal IT ticket",
    "Signed-in employees can raise and track support tickets.",
    "support",
    "/login",
    "mint",
  ],
];

export default function SupportPage() {
  return (
    <main className="public-main">
      <PageHero
        eyebrow="Support"
        title="Find the right path for product, access and technical help."
        description="Use the options below to reach demo guidance, sign-in access, product information or the internal support workflow available after login."
        icon="support"
        tone="mint"
        variant="support"
        primary={["Sign In", "/login"]}
        secondary={["Contact Us", "/contact?topic=support"]}
      >
        <HeroScene type="support" />
      </PageHero>

      <section className="public-section yc-support-options-section">
        <div className="page-width">
          <div className="yc-inside-section-heading">
            <span className="public-kicker">
              <Icon name="support" /> Support routes
            </span>
            <div>
              <h2>Choose the shortest route to the help you need.</h2>
              <p>
                Public guidance, account access and signed-in support remain
                clearly separated so users reach the correct place quickly.
              </p>
            </div>
          </div>

          <div className="yc-support-options-grid">
            {options.map(([title, copy, icon, href, tone], index) => (
              <Link className={`tone-${tone}`} to={href} key={title}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span aria-hidden="true">
                  <Icon name={icon} />
                </span>
                <h2>{title}</h2>
                <p>{copy}</p>
                <em>
                  Continue <Icon name="arrow" />
                </em>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
