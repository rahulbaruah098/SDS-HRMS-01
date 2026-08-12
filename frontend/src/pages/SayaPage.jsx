import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const everydayAdvantages = [
  {
    title: "Find the right place faster",
    copy: "Saya can point users to the relevant module, including Apply Leave, Application Status, Projects, Payslips, Policies or IT Support. This reduces menu searching and helps people begin in the correct workflow.",
    tone: "blue",
  },
  {
    title: "Understand the next action",
    copy: "A user may know the goal but not the sequence. Saya can explain the needed information, the next step and where the final action occurs. This creates clearer progress while the live module remains authoritative.",
    tone: "cyan",
  },
  {
    title: "Keep guidance role-aware",
    copy: "Saya uses role and permission context. Employees, leadership capability users, HR administrators and Finance users should receive guidance that respects the signed-in account's access boundaries.",
    tone: "violet",
  },
  {
    title: "Support confident adoption",
    copy: "New and occasional users can ask in ordinary language. Consistent explanations reinforce approved processes, reduce repeat how-to questions and build confidence in connected HRMS workflows.",
    tone: "mint",
  },
];

const connectedAreas = [
  "Attendance",
  "Leave",
  "Approvals",
  "Projects",
  "Policies",
  "IT Support",
  "Payslips",
  "Status",
];

const roleValues = [
  {
    title: "Employees",
    copy: "Find self-service actions for attendance, leave, request status, scoped projects, payslips, policies, profile work, grievances and IT support. Saya explains the route while the employee remains responsible for correct details and submission.",
    tone: "blue",
  },
  {
    title: "Team Leader capability",
    copy: "Get guidance for mapped-team approvals, projects and weekly performance review. Team Leader remains an employee capability, not a separate login identity, so the advice follows the employee's actual mapping and access.",
    tone: "cyan",
  },
  {
    title: "Reporting Officer capability",
    copy: "Understand next steps for mapped Team Leaders or reporting members, including authorised approvals, project responsibility and higher-level review. Guidance stays within configured reporting relationships.",
    tone: "violet",
  },
  {
    title: "HR and Admin",
    copy: "Use Saya as a process aide for people masters, employee records, leave balances, policies, recruitment, reports and administration. Final policy interpretation and employee decisions stay with authorised HR.",
    tone: "mint",
  },
  {
    title: "Finance and Accounts",
    copy: "Locate authorised payroll, banking, tax, reimbursement, loan, report and payment workflows. Saya can clarify states and inputs, but it does not approve, lock or disburse payroll outside live controls and responsible users.",
    tone: "amber",
  },
  {
    title: "IT and operational support",
    copy: "Help users raise a useful IT ticket, include relevant details and understand status. Tenant IT assignment and escalation remain in the IT Support workflow; major platform issues follow the authorised path.",
    tone: "coral",
  },
];

const scenarios = [
  {
    question: '"I want to apply for Casual Leave tomorrow. What do I do?"',
    answer: "Saya helps: Open Apply Leave and check the date and reason. The employee submits; the authorised approver decides through the live approval flow.",
    tone: "blue",
  },
  {
    question: '"Where can I see my pending leave approval?"',
    answer: "Saya helps: Open Application Status to view the live stage and decision history. Check the existing request before creating another.",
    tone: "cyan",
  },
  {
    question: '"Can I use a Comp-Off credit?"',
    answer: "Saya helps: Confirm approved holiday work and eligible attendance. Claim an available credit from the next working day within seven working days, as shown in the live records.",
    tone: "violet",
  },
  {
    question: '"How do I update my project progress?"',
    answer: "Saya helps: Open scoped Projects and the allowed progress or status fields. If missing, verify assignment and TL/RO mapping with the responsible manager or administrator.",
    tone: "mint",
  },
  {
    question: '"My laptop is not working. How do I get help?"',
    answer: "Saya helps: Open IT Support and capture the issue summary, device, error and impact. Tenant IT assigns and resolves; authorised major issues follow the escalation path.",
    tone: "coral",
  },
  {
    question: '"Where can I find my payslip or company policy?"',
    answer: "Saya helps: Open Payslips for generated payslips or Policies for authorised documents. If unavailable, verify the period, access or publication with HR or Finance.",
    tone: "amber",
  },
];

const boundaries = [
  {
    title: "Access control",
    copy: "Saya must not bypass role access, approval stages or restricted records. The live authorised module remains the source of truth.",
    tone: "blue",
    icon: "shield",
  },
  {
    title: "Human control",
    copy: "HR, managers, Finance and other responsible users confirm important dates, amounts, people, status and decisions before action.",
    tone: "violet",
    icon: "people",
  },
  {
    title: "Data safety",
    copy: "Users should never share passwords, OTPs, CVVs, UPI PINs, full bank secrets or unnecessary sensitive personal information.",
    tone: "mint",
    icon: "lock",
  },
];

const rolloutSteps = [
  {
    title: "Verify connected scope",
    copy: "Confirm which HRMS modules and services are live for the tenant.",
    tone: "blue",
  },
  {
    title: "Validate role boundaries",
    copy: "Test employee, TL, RO, HR, Finance and IT views with authorised accounts.",
    tone: "cyan",
  },
  {
    title: "Approve answer sources",
    copy: "Use current policies, workflow rules and system records as authoritative context.",
    tone: "violet",
  },
  {
    title: "Pilot real questions",
    copy: "Run common user scenarios and correct unclear, incomplete or unsafe guidance.",
    tone: "mint",
  },
  {
    title: "Train safe prompting",
    copy: "Teach users to ask direct questions without sharing credentials or excess personal data.",
    tone: "coral",
  },
  {
    title: "Measure and improve",
    copy: "Review completion, escalations, repeat queries, feedback and workflow quality.",
    tone: "amber",
  },
];

const heroPillars = [
  ["Role aware", "blue"],
  ["Workflow focused", "cyan"],
  ["Permission conscious", "violet"],
  ["HRMS connected", "mint"],
];

function SayaSectionHeading({ eyebrow, title, copy }) {
  return (
    <header className="yc-saya-guide-heading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
    </header>
  );
}

function SayaInfoCard({ item, className = "" }) {
  return (
    <article className={`yc-saya-info-card tone-${item.tone} ${className}`.trim()}>
      <h3>{item.title}</h3>
      <p>{item.copy}</p>
    </article>
  );
}

export default function SayaPage() {
  return (
    <main className="public-main yc-saya-guide-page">
      <PageHero
        eyebrow="Saya AI Assistant"
        title="Practical help inside YourComate."
        description="Saya is the in-product HR assistant designed to use the signed-in user's role, permissions and workspace context before offering guidance. It helps people understand where to go, what to do next and how an HRMS workflow fits together."
        icon="sparkle"
        tone="violet"
        variant="saya"
        primary={["Explore the Platform", "/product"]}
        secondary={["Request a Demo", "/demo-registration"]}
      >
        <div className="yc-saya-hero-guide">
          <span className="yc-saya-hero-kicker">
            <Icon name="sparkle" /> Saya AI Assistant
          </span>

          <h2>Helpful guidance at the point of need.</h2>

          <div className="yc-saya-hero-pillars">
            {heroPillars.map(([label, tone]) => (
              <span className={`tone-${tone}`} key={label}>
                {label}
              </span>
            ))}
          </div>

          <div className="yc-saya-hero-value">
            <strong>Why Saya can be valuable</strong>
            <p>
              It can reduce navigation friction, make complex processes easier to
              understand, provide consistent next-step guidance and support safer
              adoption of YourComate. Final records, approvals and decisions still
              remain in the authorised HRMS modules and with responsible people.
            </p>
          </div>
        </div>
      </PageHero>

      <section className="public-section yc-saya-guide-section yc-saya-everyday-section">
        <div className="page-width">
          <SayaSectionHeading
            eyebrow="The everyday advantage"
            title="How Saya helps during real work"
            copy="Saya is most useful at the moment a user is unsure. Instead of searching menus or waiting for a basic how-to answer, the user can ask a direct question and receive guidance shaped by the signed-in workspace."
          />

          <div className="yc-saya-four-grid">
            {everydayAdvantages.map((item) => (
              <SayaInfoCard item={item} key={item.title} />
            ))}
          </div>

          <div className="yc-saya-connected-band">
            <h3>Connected areas where guidance can help</h3>
            <div>
              {connectedAreas.map((area) => (
                <span key={area}>{area}</span>
              ))}
            </div>
          </div>

          <div className="yc-saya-expectation">
            <strong>Practical expectation</strong>
            <p>
              These are expected usability benefits. Actual value should be measured
              after rollout using user feedback, task completion, avoidable support
              volume and workflow quality.
            </p>
          </div>
        </div>
      </section>

      <section className="public-section yc-saya-guide-section yc-saya-role-section">
        <div className="page-width">
          <SayaSectionHeading
            eyebrow="Useful to the right person"
            title="Role-aware value across the organisation"
            copy="Saya should not provide the same answer to everyone. Its usefulness comes from helping each signed-in user within that person's role, responsibility and authorised scope."
          />

          <div className="yc-saya-six-grid">
            {roleValues.map((item) => (
              <SayaInfoCard item={item} key={item.title} />
            ))}
          </div>

          <div className="yc-saya-core-rule">
            <Icon name="shield" />
            <p>
              <strong>Core rule:</strong> Team Leader and Reporting Officer are
              employee capabilities and mappings. Saya's guidance must follow the
              signed-in identity, configured capability and authorised team scope.
            </p>
          </div>
        </div>
      </section>

      <section className="public-section yc-saya-guide-section yc-saya-scenarios-section">
        <div className="page-width">
          <SayaSectionHeading
            eyebrow="Questions people actually ask"
            title="Six practical ways to use Saya"
            copy="The best questions are direct, task-focused and free of unnecessary sensitive data. Saya should answer with a clear route, the important checks and the point where the user must confirm or act in YourComate."
          />

          <div className="yc-saya-scenario-grid">
            {scenarios.map((scenario) => (
              <article
                className={`yc-saya-scenario-card tone-${scenario.tone}`}
                key={scenario.question}
              >
                <h3>{scenario.question}</h3>
                <p>{scenario.answer}</p>
              </article>
            ))}
          </div>

          <div className="yc-saya-prompt-band">
            <Icon name="shield" />
            <p>
              <strong>Good prompt pattern:</strong> State the goal, relevant date or
              module, and what you have already tried.
              <br />
              Do not include passwords, OTPs, CVVs, UPI PINs, full bank secrets or
              unrelated personal data.
            </p>
          </div>
        </div>
      </section>

      <section className="public-section yc-saya-guide-section yc-saya-responsible-section">
        <div className="page-width">
          <SayaSectionHeading
            eyebrow="Helpful, controlled and trustworthy"
            title="Responsible use and rollout value"
            copy="Saya becomes genuinely helpful when good guidance is combined with permission controls, authoritative HRMS records, human responsibility and a disciplined rollout."
          />

          <h3 className="yc-saya-subheading">Responsible-use boundaries</h3>
          <div className="yc-saya-boundary-grid">
            {boundaries.map((item) => (
              <article className={`yc-saya-boundary-card tone-${item.tone}`} key={item.title}>
                <span><Icon name={item.icon} /></span>
                <h4>{item.title}</h4>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>

          <h3 className="yc-saya-subheading yc-saya-rollout-heading">
            A practical six-step rollout
          </h3>
          <div className="yc-saya-rollout-grid">
            {rolloutSteps.map((item) => (
              <SayaInfoCard item={item} className="yc-saya-rollout-card" key={item.title} />
            ))}
          </div>

          <div className="yc-saya-final-value">
            <span>The final value</span>
            <p>
              Saya can make YourComate easier to understand at the point of need:
              less searching, clearer next steps, more consistent guidance and
              better confidence across connected HR work. Its strongest value is
              assistance with control - not automation without accountability.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
