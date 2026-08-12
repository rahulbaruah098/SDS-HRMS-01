import { useEffect } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";

const connectedAreas = [
  ["01", "People", "Records, structure, roles, policies and assets", "people"],
  ["02", "Work", "Attendance, leave, projects, requests and approvals", "checklist"],
  ["03", "Talent", "Recruitment, interviews, evaluation and onboarding handoff", "building"],
  ["04", "Pay & service", "Payroll, payslips, reports, support and Saya AI", "document"],
];

const productPrinciples = [
  [
    "01",
    "People first",
    "Workflows begin with the employee, manager or administrator who needs to complete real work clearly—not with the system’s internal structure.",
  ],
  [
    "02",
    "Connected work",
    "Employee records, attendance, leave, projects, approvals, payroll and support remain related through a shared operating context.",
  ],
  [
    "03",
    "Role-aware access",
    "Each person sees information and actions appropriate to their responsibility, protecting clarity as well as organisational control.",
  ],
  [
    "04",
    "Everyday usability",
    "Responsive web and mobile views support recurring work across office, remote and field environments.",
  ],
];

const operatingLayers = [
  ["01", "People foundation", "Records · roles · policies · assets"],
  ["02", "Everyday operations", "Attendance · leave · projects · approvals"],
  ["03", "Talent & pay", "Recruitment · payroll · payslips"],
  ["04", "Service & intelligence", "Helpdesk · reports · mobile · Saya"],
];

const workflowPattern = ["Capture", "Route", "Decide", "Update", "See status"];

const peopleCapabilities = [
  ["01", "Core HR & employee records", "Profiles, departments, designations, reporting lines, lifecycle details and role access form a dependable people directory."],
  ["02", "Employee self-service", "Employees reach their records, attendance, leave, projects, policies and support without routing every routine need through HR."],
  ["03", "Policies & documents", "Important workplace information is published centrally and made available through controlled, role-appropriate access."],
  ["04", "Assets & workforce records", "Assigned workplace assets remain visible alongside the employee context needed for accountability and follow-through."],
];

const operationCapabilities = [
  ["01", "Attendance management", "Office, work-from-home and field attendance records support worked-time visibility, exceptions and monthly summaries."],
  ["02", "Leave & holiday workflows", "Employees apply, authorised roles review, and status and holiday information remain visible in one controlled flow."],
  ["03", "Projects & team delivery", "Owners, collaborators, progress and status updates connect day-to-day delivery with manager oversight."],
  ["04", "Approvals & requests", "Requests move into the right queue with relevant context, a recorded decision and a visible final status."],
];

const extendedCapabilities = [
  ["01", "Recruitment & candidate pipeline", "Create openings; receive and structure applications; screen candidates; schedule interviews; record evaluations; and hand selected candidates into onboarding."],
  ["02", "Payroll processing", "Bring salary structures, payable days, approved deductions, statutory components, calculation and review into a controlled monthly workflow."],
  ["03", "Payslips & salary access", "Generate clear approved-period salary records and give employees secure, responsive access to earnings, deductions and payable-day details."],
  ["04", "Saya AI assistant", "Offer role-aware guidance inside the signed-in HRMS workspace using the user’s permissions and work context."],
  ["05", "IT support & helpdesk", "Let employees raise tickets while support teams assign ownership, update progress and close requests through focused views."],
  ["06", "Reports & workforce insights", "Turn attendance, employee, project and workflow activity into useful operational summaries for authorised roles."],
  ["07", "Mobile workforce experience", "Support quick, role-specific actions for office and field employees through responsive dashboards and smaller-screen workflows."],
];

const lifecycleStages = [
  ["01", "Attract & select", "Open roles, applications, resume structure, screening, interviews, evaluations and selection."],
  ["02", "Join & organise", "Employee profile, department, designation, reporting line, role permissions and documents."],
  ["03", "Work & collaborate", "Attendance, leave, holidays, projects, collaborators, requests and approvals."],
  ["04", "Pay & inform", "Payroll inputs, calculations, reviews, approved salary periods and payslip access."],
  ["05", "Support & guide", "IT tickets, status visibility, policies, mobile access and Saya’s contextual assistance."],
  ["06", "Understand & improve", "Reports and dashboards help authorised teams see activity, exceptions and delivery health."],
];

const roleCards = [
  ["01", "Platform Superadmin", "Oversees tenant-level platform operations, subscriptions, configuration boundaries, global support and controlled administrative functions."],
  ["02", "Organisation Admin / HR", "Maintains people structure, records, policies and priority workflows while coordinating employees, managers and specialist teams."],
  ["03", "Manager / Team Lead", "Reviews team activity, projects, requests, attendance exceptions and decisions within assigned responsibility."],
  ["04", "Reporting Officer", "Receives relevant employee and workflow visibility where the organisation’s reporting design assigns review or approval responsibility."],
  ["05", "Finance / Payroll", "Works with salary structures, attendance and deduction inputs, payroll review, banking/reporting support and approved salary records."],
  ["06", "Employee / Field User", "Uses self-service access for personal information, attendance, leave, projects, requests, policies, payslips and support."],
];

const sayaCapabilities = [
  ["01", "Work context", "Starts from signed-in HR information and responsibility."],
  ["02", "Workflow guidance", "Points users toward the relevant next step in YourComate."],
  ["03", "Permission awareness", "Keeps recommendations inside role and access boundaries."],
  ["04", "HRMS assistance", "Supports attendance, leave, approvals, projects and connected work."],
];

const rolloutStages = [
  ["01", "Discover", "Document current people data, workflows, exceptions and decision owners."],
  ["02", "Configure", "Set organisation structure, roles, permissions, policies and priority modules."],
  ["03", "Pilot", "Test real scenarios with a controlled user group; correct gaps and communication."],
  ["04", "Adopt & improve", "Expand access, monitor exceptions, support users and refine operating discipline."],
];

const trustDisciplines = [
  ["Role boundaries", "Map view, create, approve, edit, assign and report rights to real responsibilities."],
  ["Tenant separation", "Keep each organisation’s people and workflow context logically isolated."],
  ["Traceable status", "Retain clear workflow states and accountable decisions for operational follow-up."],
  ["Human authority", "Keep material employment, payroll and selection decisions under authorised human control."],
];

function YourComateSectionHeading({ eyebrow, title, copy }) {
  return (
    <header className="yc-ycprofile-heading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      {copy ? <p>{copy}</p> : null}
    </header>
  );
}

function YourComateCard({ number, title, copy, tone = "blue" }) {
  return (
    <article className={`yc-ycprofile-card tone-${tone}`}>
      <header>
        <b>{number}</b>
      </header>
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

const yourComateTones = ["blue", "cyan", "violet", "mint", "amber", "pink"];

export default function AboutPage() {
  useEffect(() => {
    document.documentElement.classList.add("yc-about-yourcomate-active");
    document.body.classList.add("yc-about-yourcomate-active");

    return () => {
      document.documentElement.classList.remove("yc-about-yourcomate-active");
      document.body.classList.remove("yc-about-yourcomate-active");
    };
  }, []);

  return (
    <main className="public-main yc-profile-page yc-profile-page-yourcomate">
      <section className="yc-profile-hero">
        <div className="page-width yc-profile-hero-grid">
          <div className="yc-profile-hero-copy">
            <div className="yc-profile-document-line">
              <span>YOURCOMATE × SAYANANT GROUP</span>
              <span>COMPANY & PLATFORM PROFILE</span>
            </div>

            <span className="yc-profile-part">PART 01 · ABOUT YOURCOMATE</span>

            <h1>
              About
              <em>YourComate</em>
            </h1>

            <p>
              A people-centred HRMS workspace that connects employee records,
              everyday operations, talent, payroll, support and guidance through
              role-aware workflows.
            </p>

            <div className="yc-profile-hero-actions">
              <Link className="button button-primary" to="/product">
                Explore the platform <Icon name="arrow" />
              </Link>
              <Link className="button button-ghost" to="/demo-registration">
                Request a demo
              </Link>
            </div>
          </div>

          <aside className="yc-profile-hero-board" aria-label="YourComate profile summary">
            <span>01</span>
            <small>A CONNECTED VIEW OF</small>
            <strong>PURPOSE</strong>
            <strong>PEOPLE</strong>
            <strong>PRACTICE</strong>
            <div>
              <i />
              <p>People. Process. Performance.</p>
            </div>
          </aside>
        </div>
      </section>

      <section className="yc-ycprofile-section yc-ycprofile-overview">
        <div className="page-width">
          <YourComateSectionHeading
            eyebrow="YOURCOMATE / OVERVIEW"
            title="The product in one view."
            copy="YourComate is designed as a connected operating workspace for the everyday employee journey—not a loose collection of isolated HR utilities."
          />

          <div className="yc-ycprofile-overview-layout">
            <div className="yc-ycprofile-overview-left">
              <article className="yc-ycprofile-proposition">
                <span>CORE PROPOSITION</span>
                <h3>One HRMS.<br />Every workday connected.</h3>
                <p>
                  The platform brings shared people information, structured actions
                  and role-appropriate visibility into a responsive workspace for
                  office, remote and field teams.
                </p>
              </article>

              <section className="yc-ycprofile-connects">
                <h3>What it connects</h3>
                <div>
                  {connectedAreas.map(([number, title, copy], index) => (
                    <article key={title}>
                      <b className={`tone-${yourComateTones[index]}`}>{Number(number)}</b>
                      <div>
                        <strong>{title}</strong>
                        <p>{copy}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <div className="yc-ycprofile-phone" aria-hidden="true">
              <div className="yc-ycprofile-phone-speaker" />
              <div className="yc-ycprofile-phone-screen">
                <img
                  src="/images/yourcomate-app-screen.png"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <small>YOURCOMATE</small>
                <strong>People.<br />Process.<br />Performance.</strong>
                <span>Saya + HRMS</span>
              </div>
            </div>
          </div>

          <div className="yc-ycprofile-light-band">
            <small>THE DESIGN INTENT</small>
            <strong>Make routine people work easier to understand, complete and follow through.</strong>
            <p>
              That means less dependence on scattered messages and trackers,
              clearer responsibility at each step, and a dependable status trail
              for employees and authorised teams.
            </p>
          </div>
        </div>
      </section>

      <section className="yc-ycprofile-section yc-ycprofile-philosophy">
        <div className="page-width">
          <YourComateSectionHeading
            eyebrow="YOURCOMATE / PRODUCT PHILOSOPHY"
            title="Purpose expressed through four principles."
            copy="The product narrative centres the platform on users, connected context, responsible access and everyday usability."
          />

          <div className="yc-ycprofile-principles-grid">
            {productPrinciples.map(([number, title, copy], index) => (
              <YourComateCard
                key={title}
                number={number}
                title={title}
                copy={copy}
                tone={["blue", "cyan", "violet", "mint"][index]}
              />
            ))}
          </div>

          <div className="yc-ycprofile-purpose-strip">
            <small>PRODUCT PURPOSE</small>
            <p>
              To give organisations a clearer way to manage the everyday employee
              journey by turning recurring people processes into connected,
              visible and role-appropriate workflows.
            </p>
          </div>
        </div>
      </section>

      <section className="yc-ycprofile-section yc-ycprofile-operating">
        <div className="page-width">
          <YourComateSectionHeading
            eyebrow="YOURCOMATE / OPERATING MODEL"
            title="One shared context across four capability layers."
            copy="A common people record and permission layer gives each workflow organisational context while dashboards and reporting keep activity visible."
          />

          <div className="yc-ycprofile-operating-map">
            <svg
              className="yc-ycprofile-operating-connectors"
              viewBox="0 0 1000 560"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="yc-ycprofile-arrow"
                  markerWidth="9"
                  markerHeight="9"
                  refX="7"
                  refY="4.5"
                  orient="auto"
                >
                  <path d="M0,0 L9,4.5 L0,9 Z" />
                </marker>
              </defs>
              <path d="M255 135 L415 235" />
              <path d="M745 135 L585 235" />
              <path d="M255 425 L415 325" />
              <path d="M745 425 L585 325" />
            </svg>

            <svg
              className="yc-ycprofile-operating-connectors-mobile"
              viewBox="0 0 360 540"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="yc-ycprofile-arrow-mobile"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6.5"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 Z" />
                </marker>
              </defs>
              <path d="M82 122 C92 180 128 205 156 224" />
              <path d="M278 122 C268 180 232 205 204 224" />
              <path d="M156 316 C128 335 92 360 82 418" />
              <path d="M204 316 C232 335 268 360 278 418" />
            </svg>

            {operatingLayers.map(([number, title, copy], index) => (
              <article
                key={title}
                className={`yc-ycprofile-layer yc-ycprofile-layer-${index + 1} tone-${["blue", "cyan", "mint", "pink"][index]}`}
              >
                <div>
                  <b>{Number(number)}</b>
                  <strong>{title}</strong>
                </div>
                <p>{copy}</p>
              </article>
            ))}

            <div className="yc-ycprofile-operating-core">
              <i />
              <strong>
                <span>Shared people record</span>
                <span className="yc-ycprofile-core-plus">+</span>
                <span>permission layer</span>
              </strong>
              <small>ONE DEPENDABLE OPERATING CONTEXT</small>
            </div>
          </div>

          <div className="yc-ycprofile-workflow-band">
            <h3>The workflow pattern</h3>
            <div>
              {workflowPattern.map((label, index) => (
                <span key={label}>
                  <b className={`tone-${yourComateTones[index]}`}>{index + 1}</b>
                  <strong>{label}</strong>
                  {index < workflowPattern.length - 1 ? (
                    <i aria-hidden="true">→</i>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="yc-ycprofile-section yc-ycprofile-capability-one">
        <div className="page-width">
          <YourComateSectionHeading
            eyebrow="YOURCOMATE / CAPABILITY PORTFOLIO I"
            title="The people foundation and everyday operations."
            copy="Eight connected capabilities organise core workforce information and the actions teams repeat most often."
          />

          <div className="yc-ycprofile-dual-column">
            <section>
              <span>PEOPLE FOUNDATION</span>
              <div>
                {peopleCapabilities.map(([number, title, copy]) => (
                  <article key={title} className="tone-blue">
                    <b>{Number(number)}</b>
                    <div>
                      <h3>{title}</h3>
                      <p>{copy}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <span>EVERYDAY OPERATIONS</span>
              <div>
                {operationCapabilities.map(([number, title, copy]) => (
                  <article key={title} className="tone-cyan">
                    <b>{Number(number)}</b>
                    <div>
                      <h3>{title}</h3>
                      <p>{copy}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      </section>

      <section className="yc-ycprofile-section yc-ycprofile-capability-two">
        <div className="page-width">
          <YourComateSectionHeading
            eyebrow="YOURCOMATE / CAPABILITY PORTFOLIO II"
            title="Talent, pay, service and workforce intelligence."
            copy="The second half of the platform carries the employee journey from candidate pipeline to salary access, support and decision visibility."
          />

          <div className="yc-ycprofile-capability-grid">
            {extendedCapabilities.map(([number, title, copy], index) => (
              <article
                key={title}
                className={`${index === extendedCapabilities.length - 1 ? "is-wide " : ""}tone-${yourComateTones[index % yourComateTones.length]}`}
              >
                <b>{number}</b>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="yc-ycprofile-dark-band">
            <small>CONNECTED VALUE</small>
            <p>
              Candidate data becomes employee context; approved work becomes payroll input; service and reports stay visible.
            </p>
          </div>
        </div>
      </section>

      <section className="yc-ycprofile-section yc-ycprofile-journey">
        <div className="page-width">
          <YourComateSectionHeading
            eyebrow="YOURCOMATE / EMPLOYEE JOURNEY"
            title="A lifecycle, not a collection of screens."
            copy="The platform is most useful when information and responsibility move with the person—from application and onboarding to everyday work, pay, growth and support."
          />

          <div className="yc-ycprofile-timeline">
            {lifecycleStages.map(([number, title, copy], index) => (
              <article key={title}>
                <b className={`tone-${yourComateTones[index]}`}>{index + 1}</b>
                <div>
                  <small>STAGE {number}</small>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="yc-ycprofile-light-band">
            <small>WHY CONTINUITY MATTERS</small>
            <p>
              Shared context reduces repeated data capture, clarifies handoffs
              and lets each authorised role act on the same current record.
            </p>
          </div>
        </div>
      </section>

      <section className="yc-ycprofile-section yc-ycprofile-roles">
        <div className="page-width">
          <YourComateSectionHeading
            eyebrow="YOURCOMATE / ROLE-AWARE EXPERIENCE"
            title="The same system, shaped by responsibility."
            copy="Role awareness is both a usability principle and an access-control principle: people should see what helps them do their work, without unnecessary exposure or ambiguity."
          />

          <div className="yc-ycprofile-role-grid">
            {roleCards.map(([number, title, copy], index) => (
              <article key={title} className={`tone-${yourComateTones[index]}`}>
                <div>
                  <b>{index + 1}</b>
                  <h3>{title}</h3>
                </div>
                <p>{copy}</p>
                <small>RELEVANT ACTIONS · APPROPRIATE VISIBILITY</small>
              </article>
            ))}
          </div>

          <div className="yc-ycprofile-dark-band">
            <strong>The role model is configurable in practice.</strong>
            <p>
              Titles and responsibilities vary by organisation; the key design rule is
              to map permissions and workflow ownership before rollout.
            </p>
          </div>
        </div>
      </section>

      <section className="yc-ycprofile-section yc-ycprofile-saya">
        <div className="page-width">
          <YourComateSectionHeading
            eyebrow="YOURCOMATE / SAYA AI"
            title="Guidance inside the signed-in work context."
            copy="Saya is YourComate’s in-product HR assistant, distinct from the general navigation helper on the public website."
          />

          <div className="yc-ycprofile-saya-top">
            <article className="yc-ycprofile-saya-card">
              <span>SAYA INSIDE HRMS</span>
              <h3>Context before guidance.</h3>
              <p>
                Saya uses the signed-in user’s role, permissions and workspace
                context before helping the person understand an HRMS task or
                identify the appropriate next action.
              </p>

              <div>
                {sayaCapabilities.map(([number, title, copy], index) => (
                  <article key={title}>
                    <b className={`tone-${yourComateTones[index]}`}>{index + 1}</b>
                    <div>
                      <strong>{title}</strong>
                      <p>{copy}</p>
                    </div>
                  </article>
                ))}
              </div>
            </article>

            <div className="yc-ycprofile-phone yc-ycprofile-saya-phone" aria-hidden="true">
              <div className="yc-ycprofile-phone-speaker" />
              <div className="yc-ycprofile-phone-screen">
                <img
                  src="/images/yourcomate-app-screen.png"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <small>SAYA</small>
                <strong>Role-aware guidance<br />for employee workflow</strong>
                <span>Ready when work needs clarity.</span>
              </div>
            </div>
          </div>

          <div className="yc-ycprofile-dark-band yc-ycprofile-saya-boundary">
            <small>RESPONSIBLE-ASSISTANCE BOUNDARY</small>
            <strong>Saya helps the user navigate work; authority remains with authorised people and workflows.</strong>
            <p>
              Guidance should not bypass permissions, silently change employment
              records or replace accountable human decisions. Recruitment
              selection, approvals, payroll release and other material decisions
              remain governed by the organisation’s authorised process.
            </p>
          </div>

          <div className="yc-ycprofile-goal-band">
            <small>THE EXPERIENCE GOAL</small>
            <p>Reduce uncertainty at the moment of action: What can I do? What information is relevant? What should happen next?</p>
          </div>
        </div>
      </section>

      <section className="yc-ycprofile-section yc-ycprofile-adoption">
        <div className="page-width">
          <YourComateSectionHeading
            eyebrow="YOURCOMATE / ADOPTION & TRUST"
            title="A practical route from configuration to everyday value."
            copy="Successful HRMS adoption depends on data readiness, role clarity, controlled rollout and visible workflow ownership as much as it depends on software features."
          />

          <h3 className="yc-ycprofile-subheading">Four rollout stages</h3>
          <div className="yc-ycprofile-rollout-grid">
            {rolloutStages.map(([number, title, copy], index) => (
              <article key={title}>
                <b className={`tone-${yourComateTones[index]}`}>{index + 1}</b>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>

          <h3 className="yc-ycprofile-subheading">Trust by operating discipline</h3>
          <div className="yc-ycprofile-trust-grid">
            {trustDisciplines.map(([title, copy], index) => (
              <article key={title} className={`tone-${index < 2 ? "blue" : "violet"}`}>
                <strong>{title}</strong>
                <p>{copy}</p>
              </article>
            ))}
          </div>

          <div className="yc-ycprofile-outcome-band">
            <small>WHAT BETTER LOOKS LIKE</small>
            <div>
              {[
                "Less duplicate handling",
                "Faster, clearer handoffs",
                "Visible employee status",
                "Better workforce insight",
              ].map((label, index) => (
                <span key={label}>
                  <b className={`tone-${yourComateTones[index]}`}>{index + 1}</b>
                  {label}
                </span>
              ))}
            </div>
            <Link className="button button-primary" to="/demo-registration">
              See YourComate in practice <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
