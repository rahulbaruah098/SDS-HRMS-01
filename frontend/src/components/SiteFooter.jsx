import { Link } from "react-router-dom";
import Brand from "./Brand";
import AppStoreBadges from "./AppStoreBadges";
import FooterFlowFrame from "./FooterFlowFrame";
import Icon from "./Icon";

function WorkflowIcon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  const icons = {
    people: (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <circle cx="8.5" cy="10" r="2.2" />
        <path d="M5.5 16c.7-2 2-3 3-3s2.3 1 3 3" />
        <path d="M14 9h4M14 13h4M14 17h3" />
      </svg>
    ),
    attendance: (
      <svg {...common}>
        <path d="M12 3a9 9 0 1 0 9 9" />
        <path d="M12 7v5l3 2" />
        <path d="M16.5 3.5 18 5l3-3" />
      </svg>
    ),
    leave: (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4M17 3v4M3 10h18" />
        <path d="m9 15 2 2 4-4" />
      </svg>
    ),
    project: (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M8 4v16M16 4v16" />
        <path d="M5.5 8h1M10.5 8h3M18 8h.5M10.5 13h3M5.5 15h1M18 15h.5" />
      </svg>
    ),
    approval: (
      <svg {...common}>
        <circle cx="12" cy="10" r="6" />
        <path d="m9.5 10 1.7 1.7 3.6-3.6" />
        <path d="m8 15-1 6 5-3 5 3-1-6" />
      </svg>
    ),
    support: (
      <svg {...common}>
        <path d="M4 5h16v11H9l-5 4Z" />
        <path d="M8 9h8M8 13h5" />
      </svg>
    ),
    payslip: (
      <svg {...common}>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
        <path d="M9 8h6M9 12h2M14 12h1M9 16h6" />
      </svg>
    ),
    recruitment: (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="14" rx="3" />
        <path d="M8 6V4h8v2" />
        <circle cx="9" cy="12" r="2" />
        <path d="M6.5 17c.6-1.8 1.6-2.8 2.5-2.8s1.9 1 2.5 2.8" />
        <path d="M15 11h3M15 15h3" />
      </svg>
    ),
    payroll: (
      <svg {...common}>
        <circle cx="8" cy="15" r="4" />
        <circle cx="16" cy="9" r="4" />
        <path d="M6.5 15h3M8 13.5v3M14.5 9h3M16 7.5v3" />
        <path d="M12 18h7" />
      </svg>
    ),
    saya: (
      <svg {...common}>
        <path d="M4 5h16v11H9l-5 4Z" />
        <path d="m12 7 .8 2.2L15 10l-2.2.8L12 13l-.8-2.2L9 10l2.2-.8Z" />
        <path d="M16.5 6.5v2M15.5 7.5h2" />
      </svg>
    ),
  };

  return icons[name] || null;
}

const workflowModules = [
  ["people", "People records", "blue", "/product/core-hr"],
  ["attendance", "Attendance", "mint", "/product/attendance"],
  ["leave", "Leave", "yellow", "/product/leave"],
  ["project", "Projects", "violet", "/product/projects"],
  ["approval", "Approvals", "lilac", "/product/approvals"],
  ["support", "Support", "pink", "/product/helpdesk"],
  ["recruitment", "Recruitment", "coral", "/product/recruitment"],
  ["payslip", "Payslip", "sky", "/product/payslip"],
  ["payroll", "Payroll", "teal", "/product/payroll"],
  ["saya", "Saya AI", "amber", "/saya"],
];

const footerGroups = [
  {
    title: "Platform",
    links: [
      ["Product overview", "/product"],
      ["Recruitment", "/product/recruitment"],
      ["Pricing", "/pricing"],
      ["Saya inside HRMS", "/saya"],
    ],
  },
  {
    title: "Explore",
    links: [
      ["Customers", "/customers"],
      ["Resources", "/resources"],
      ["Support", "/support"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About YourComate", "/about"],
      ["About Sayanant Group", "/about-sayanant"],
      ["Contact", "/contact"],
    ],
  },
  {
    title: "Trust",
    links: [
      ["Privacy Policy", "/privacy"],
      ["Terms and Conditions", "/terms-and-conditions"],
      ["Refund Policy", "/refund-policy"],
      ["Accessibility Statement", "/accessibility"],
    ],
  },
];

export default function SiteFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="public-site-footer yc-flow-footer">
      <div className="yc-flow-footer-wave" aria-hidden="true" />

      <div className="yc-flow-footer-frame">
        <FooterFlowFrame />

        <div className="yc-flow-footer-shell">
          <section className="yc-flow-footer-lead">
            <div className="yc-flow-footer-intro">
              <Brand />

              <span className="yc-flow-footer-kicker">
                Connected workday infrastructure
              </span>

              <h2>
                Keep every people process
                <em>moving together.</em>
              </h2>

              <p>
                One practical HRMS workspace for records,
                attendance, leave, projects, recruitment, payroll,
                approvals and everyday employee support.
              </p>

              <AppStoreBadges
                compact
                disabled
                className="yc-footer-store-badges"
              />
            </div>
          </section>

          <div
            className="yc-flow-footer-modules"
            aria-label="Core YourComate workflow"
          >
            {workflowModules.map(([icon, label, tone, href]) => (
              <Link
                className={`tone-${tone}`}
                to={href}
                aria-label={`Open ${label}`}
                key={label}
              >
                <WorkflowIcon name={icon} />
                <strong>{label}</strong>
              </Link>
            ))}
          </div>

          <div className="yc-flow-footer-information">
            <section className="yc-flow-footer-about">
              <span className="yc-flow-footer-section-label">
                About YourComate
              </span>

              <h3>Built for real operating work</h3>

              <p>
                YourComate is developed by Sayanant Development
                Services to connect people, process and performance in
                one clear workspace.
              </p>

              <div className="yc-flow-footer-contact-list">
                <a href="mailto:hr@sayanant.com">
                  <Icon name="email" />
                  hr@sayanant.com
                </a>

                <span>
                  <Icon name="shield" />
                  Secure role-based access
                </span>
              </div>
            </section>

            <nav
              className="yc-flow-footer-directory"
              aria-label="Footer navigation"
            >
              {footerGroups.map((group) => (
                <section key={group.title}>
                  <header>
                    <h3>{group.title}</h3>
                  </header>

                  <div>
                    {group.links.map(([label, href]) => (
                      <Link
                        to={href}
                        key={`${group.title}-${href}`}
                      >
                        <span>{label}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </nav>
          </div>

          <div className="yc-flow-footer-bottom">
            <span>
              © {currentYear} YourComate HRMS.
              All rights reserved.
            </span>

            <div>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent(
                      "yc-open-policy-consent",
                    ),
                  )
                }
              >
                Manage privacy
              </button>

              <Link to="/cookies">Cookie Policy</Link>
            </div>
          </div>

          <div className="yc-flow-footer-credit">
            <span>
              Powered by{" "}
              <a
                href="https://sayanant.com"
                target="_blank"
                rel="noreferrer"
              >
                Sayanant
              </a>{" "}
              Group
            </span>

            <span className="yc-flow-footer-origin">
              Built in Assam ❤️
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
