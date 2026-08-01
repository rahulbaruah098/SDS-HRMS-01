import { Link } from "react-router-dom";
import Icon from "./Icon";

function isHrmsRoute(href = "") {
  return (
    href === "/login" ||
    href === "/apply-demo-registration"
  );
}

function prepareRouteNavigation() {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }

  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto",
  });
}

function HeroActionLink({ action, className, showArrow = false }) {
  if (!action) return null;

  const [label, href] = action;

  if (isHrmsRoute(href)) {
    return (
      <a
        className={className}
        href={href}
        onClick={prepareRouteNavigation}
      >
        {label}
        {showArrow && <Icon name="arrow" />}
      </a>
    );
  }

  return (
    <Link
      className={className}
      to={href}
      onClick={prepareRouteNavigation}
    >
      {label}
      {showArrow && <Icon name="arrow" />}
    </Link>
  );
}

export default function PageHero({
  eyebrow,
  title,
  description,
  icon = "sparkle",
  tone = "violet",
  variant = "standard",
  primary = ["Request a Demo", "/apply-demo-registration"],
  secondary = ["Explore Product", "/product"],
  children,
  note,
}) {
  return (
    <section
      className={`public-page-hero public-tone-${tone} hero-variant-${variant}`}
      data-panel-label={eyebrow}
    >
      <div className="page-width public-page-hero-grid">
        <div className="public-page-hero-copy">
          <div className="yc-page-eyebrow-row">
            <span className="public-kicker">
              <Icon name={icon} />
              {eyebrow}
            </span>
          </div>

          <h1>{title}</h1>
          <p>{description}</p>

          <div className="public-hero-actions">
            <HeroActionLink
              action={primary}
              className="button button-primary"
              showArrow
            />

            <HeroActionLink
              action={secondary}
              className="button button-ghost"
            />
          </div>

          {note && (
            <div className="public-hero-note">
              <Icon name="shield" />
              <span>{note}</span>
            </div>
          )}
        </div>

        <div className="public-page-hero-visual" data-motion-depth="1.1">
          <div className="yc-hero-visual-frame">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
