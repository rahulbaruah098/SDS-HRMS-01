import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";
import { api } from "../api/client";

const PLAN_DEFINITIONS = [
  {
    id: "demo",
    name: "Demo",
    subtitle: "Full Premium access for evaluation",
    price: "15 days",
    priceSuffix: "",
    extra: "Unlimited employees · All features unlocked",
    items: [
      "Complete Premium plan access for 15 days",
      "Core HR, payroll, attendance, leave and projects",
      "Performance, expenses, recruitment and alumni modules",
      "Face attendance, geo-location, GPS and time sheets",
      "SSO, API and multi-company capabilities",
      "Advanced reporting, audit visibility and Saya AI",
      "Company-email OTP verification",
      "Superadmin approval and credentials by email",
    ],
    action: ["Start 15-Day Trial", "/apply-demo-registration"],
    tone: "demo",
  },
  {
    id: "essential",
    name: "Essential",
    subtitle: "Starter HRMS subscription for small teams.",
    price: "₹2,495",
    priceSuffix: "/month",
    extra: "Up to 50 employees",
    items: [
      "Full HRMS access",
      "Up to 50 employees",
      "Attendance, leave, projects and employee records",
      "Standard support",
    ],
    action: ["Request a Demo", "/apply-demo-registration"],
    tone: "essential",
  },
  {
    id: "growth",
    name: "Growth",
    subtitle: "Recommended HRMS subscription for growing companies.",
    price: "₹4,495",
    priceSuffix: "/month",
    extra: "Up to 100 employees",
    items: [
      "Full HRMS access",
      "Up to 100 employees",
      "All operational HRMS modules",
      "Priority support",
    ],
    action: ["Request a Demo", "/apply-demo-registration"],
    tone: "growth",
    featured: true,
  },
  {
    id: "premium",
    name: "Premium",
    subtitle: "Custom enterprise HRMS subscription with unlimited employees.",
    price: "Custom",
    priceSuffix: "",
    extra: "Unlimited employees",
    items: [
      "Full HRMS access",
      "Unlimited employees",
      "All modules included",
      "Custom onboarding and support",
    ],
    action: ["Contact Sales Team", "/contact?topic=pricing"],
    tone: "premium",
  },
];


const SUPPORTED_PLAN_CODES = ["essential", "growth", "premium"];

function normalizePlanCode(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

function formatPlanAmount(plan = {}) {
  const amount = Number(plan.amount || 0);

  if (
    plan.is_custom_pricing ||
    plan.is_unlimited_employees ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return "Custom";
  }

  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: plan.currency || "INR",
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString("en-IN")}`;
  }
}

function formatBillingSuffix(plan = {}) {
  if (plan.is_custom_pricing) {
    return "";
  }

  const interval = String(plan.billing_interval || "monthly")
    .trim()
    .toLowerCase();

  const labels = {
    monthly: "/month",
    quarterly: "/quarter",
    yearly: "/year",
    annual: "/year",
    annually: "/year",
    one_time: " one time",
    custom: "",
  };

  return labels[interval] ?? `/${interval.replaceAll("_", " ")}`;
}

function employeeLimitText(plan = {}) {
  if (plan.is_unlimited_employees) {
    return "Unlimited employees";
  }

  const limit = Number(
    plan.included_employees ?? plan.employee_limit,
  );

  if (Number.isFinite(limit) && limit > 0) {
    return `Up to ${limit.toLocaleString("en-IN")} employees`;
  }

  return "";
}

function mergePublicPlans(payload = {}) {
  const dynamicPlans = Array.isArray(payload.plans)
    ? payload.plans
    : [];

  const dynamicByCode = new Map(
    dynamicPlans.map((plan) => [
      normalizePlanCode(plan.plan_code),
      plan,
    ]),
  );

  return PLAN_DEFINITIONS.map((fallback) => {
    if (fallback.id === "demo") {
      return fallback;
    }

    const livePlan = dynamicByCode.get(fallback.id);

    if (!livePlan) {
      return fallback;
    }

    const code = normalizePlanCode(livePlan.plan_code);
    const features = Array.isArray(livePlan.features)
      ? livePlan.features
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [];

    return {
      ...fallback,
      id: code || fallback.id,
      name:
        livePlan.display_name ||
        livePlan.plan_name ||
        fallback.name,
      subtitle:
        livePlan.description ||
        fallback.subtitle,
      price: formatPlanAmount(livePlan),
      priceSuffix: formatBillingSuffix(livePlan),
      extra:
        employeeLimitText(livePlan) ||
        fallback.extra,
      items: features.length ? features : fallback.items,
      featured:
        typeof livePlan.is_recommended === "boolean"
          ? livePlan.is_recommended
          : fallback.featured,
    };
  }).filter(
    (plan) =>
      plan.id === "demo" ||
      SUPPORTED_PLAN_CODES.includes(plan.id),
  );
}


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

export default function PricingPage() {
  const [plans, setPlans] = useState(PLAN_DEFINITIONS);

  useEffect(() => {
    let active = true;

    async function loadPublicPricing() {
      try {
        const payload = await api("/billing/pricing", {
          method: "GET",
          timeoutMs: 30000,
        });

        if (active) {
          setPlans(mergePublicPlans(payload));
        }
      } catch (error) {
        console.error("Unable to load public pricing plans.", error);

        if (active) {
          setPlans(PLAN_DEFINITIONS);
        }
      }
    }

    loadPublicPricing();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="public-main">
      <PageHero
        eyebrow="Straightforward access options"
        title="Pricing that stays clear as your team grows."
        description="Estimate the published monthly structure by employee count, compare the available plans, or evaluate every Premium feature through a 15-day YourComate trial."
        icon="briefcase"
        tone="amber"
        variant="pricing"
        primary={[
          "Start 15-Day Trial",
          "/apply-demo-registration",
        ]}
        secondary={[
          "Contact Sales",
          "/contact?topic=pricing",
        ]}
        note="Employee-count estimates update instantly"
      >
        <HeroScene type="pricing" />
      </PageHero>

      <section className="public-section yc-pricing-plans-section">
        <div className="page-width">
          <div className="yc-pricing-plans-toolbar">
            <div>
              <span className="public-kicker">
                <Icon name="checklist" /> Plan details
              </span>

              <h2>Compare four ways to begin.</h2>
            </div>
          </div>

          <div className="yc-pricing-card-carousel">
            {plans.map((plan) => {
              const actionClassName = `button ${
                plan.featured || plan.tone === "premium"
                  ? "button-primary"
                  : "button-ghost"
              }`;

              return (
                <article
                  className={`yc-pricing-card yc-pricing-card-${plan.tone} ${
                    plan.featured ? "is-featured" : ""
                  }`}
                  key={plan.id}
                >
                  <header>
                    <div>
                      <h3>{plan.name}</h3>
                      <p>{plan.subtitle}</p>
                    </div>

                    {plan.featured && <b>Recommended</b>}
                  </header>

                  <div className="yc-pricing-card-price">
                    <strong>{plan.price}</strong>

                    {plan.priceSuffix && (
                      <span>{plan.priceSuffix}</span>
                    )}
                  </div>

                  <p className="yc-pricing-card-extra">
                    {plan.extra}
                  </p>

                  <ul>
                    {plan.items.map((item) => (
                      <li key={item}>
                        <Icon name="check" />
                        {item}
                      </li>
                    ))}
                  </ul>

                  {plan.savings && (
                    <strong className="yc-pricing-card-savings">
                      {plan.savings}
                    </strong>
                  )}

                  {isHrmsRoute(plan.action[1]) ? (
                    <a
                      className={actionClassName}
                      href={plan.action[1]}
                      onClick={prepareRouteNavigation}
                    >
                      {plan.action[0]} <Icon name="arrow" />
                    </a>
                  ) : (
                    <Link
                      className={actionClassName}
                      to={plan.action[1]}
                      onClick={prepareRouteNavigation}
                    >
                      {plan.action[0]} <Icon name="arrow" />
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="public-section public-compact-section yc-pricing-contact-section">
        <div className="page-width yc-pricing-contact-band">
          <span>
            <Icon name="help" />
          </span>

          <div>
            <h2>Need a precise implementation quote?</h2>
          </div>

          <Link
            className="button button-primary"
            to="/contact?topic=pricing"
            onClick={prepareRouteNavigation}
          >
            Talk to our team
          </Link>
        </div>
      </section>
    </main>
  );
}
