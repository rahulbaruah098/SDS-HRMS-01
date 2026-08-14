import { useEffect } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const categories = [
  {
    "title": "01. Platform and product",
    "items": [
      {
        "question": "01. What is YourComate?",
        "answer": "YourComate is a tenant-based HRMS workspace connecting employee records, attendance, leave, projects, recruitment, payroll, payslips, approvals, support, reports and role-aware guidance."
      },
      {
        "question": "02. Is YourComate only an attendance system?",
        "answer": "No. Attendance is one capability within a wider people, work, talent, payroll, service and reporting platform."
      },
      {
        "question": "03. Can the same platform support office, remote and field teams?",
        "answer": "Yes. The supplied product includes responsive views, office/WFH/field attendance, field visits, projects, requests and mobile-oriented actions. Exact device features depend on configuration and permission."
      },
      {
        "question": "04. Does every organisation share the same data?",
        "answer": "No. The SaaS design is tenant-based. Users and records belong to their Customer tenant, while Platform Superadmin performs defined platform-level administration."
      },
      {
        "question": "05. Are all modules available to every user?",
        "answer": "No. Visibility depends on tenant, plan, role, employee capability, mapping and configuration."
      },
      {
        "question": "06. Can modules be used independently?",
        "answer": "Some can begin independently, but clean people records, masters, roles and mappings are foundational to dependable approvals, reporting and payroll."
      },
      {
        "question": "07. Is the website guide the same as Saya?",
        "answer": "No. The public website guide provides general navigation. Saya operates inside the signed-in HRMS and can use role, permission and workspace context."
      },
      {
        "question": "08. Where should users verify a final result?",
        "answer": "Use the relevant source module, Application Status, payment/subscription record, payslip or audit trail rather than relying only on a dashboard card or assistant response."
      }
    ]
  },
  {
    "title": "02. Trial, plans and onboarding",
    "items": [
      {
        "question": "01. How long is the current trial?",
        "answer": "The configured YourComate trial is 15 days."
      },
      {
        "question": "02. When does the trial begin?",
        "answer": "It begins when Platform Superadmin approves the verified request and creates the trial tenant, not when the registration form is submitted."
      },
      {
        "question": "03. Why is company-email OTP required?",
        "answer": "OTP verifies access to the registered company email before the request enters Superadmin review."
      },
      {
        "question": "04. Does OTP verification guarantee approval?",
        "answer": "No. It makes the request review-ready; Superadmin still approves or rejects it."
      },
      {
        "question": "05. What happens after approval?",
        "answer": "The system creates the company, starts the trial, generates administrator credentials and sends them through the configured email route."
      },
      {
        "question": "06. What happens when the trial expires?",
        "answer": "Ordinary tenant access may be restricted until a paid subscription is successfully verified or an authorised extension is granted."
      },
      {
        "question": "07. Which paid plans exist in the supplied project?",
        "answer": "Essential, Growth and Premium. Essential and Growth are dynamically priced plans; Premium is custom quotation-based."
      },
      {
        "question": "08. Are published Essential and Growth prices permanently fixed?",
        "answer": "No. Superadmin can update pricing. The authoritative price is the live server-side plan amount when the payment order is created."
      },
      {
        "question": "09. How is Premium priced?",
        "answer": "Superadmin/Sales prepares a company-specific quotation. A payment action becomes available after the quotation is released to the client with the required amount and reference."
      },
      {
        "question": "10. Should production rollout begin before masters are ready?",
        "answer": "No. Configure entity, department, designation, state, roles and approval ownership before broad employee onboarding."
      }
    ]
  },
  {
    "title": "03. Accounts, users and roles",
    "items": [
      {
        "question": "01. Are Team Leader and Reporting Officer separate login types?",
        "answer": "No. They remain employee logins with capability flags and mappings on the employee record."
      },
      {
        "question": "02. Who can manage employees?",
        "answer": "Authorised HR/Admin roles manage Employee Master, Create Employee and Alumni within the Customer tenant."
      },
      {
        "question": "03. Who can manage tenant users from the platform side?",
        "answer": "Platform Superadmin uses User Control after selecting the relevant tenant."
      },
      {
        "question": "04. Who is eligible for the Reporting Officer selector?",
        "answer": "The supplied rule matches designations such as Manager, Managing Director, Director, CEO or Chief Executive Officer."
      },
      {
        "question": "05. Why can a manager not see a team member?",
        "answer": "First verify the employee’s TL/RO capability flags, team mappings, active status, tenant and the manager’s effective role."
      },
      {
        "question": "06. Can one credential be shared by a department?",
        "answer": "It should not be. Credentials are intended for an assigned user so access and audit history remain accountable."
      },
      {
        "question": "07. What happens when an employee resigns?",
        "answer": "HR/Admin can move the active employee out of Employee Master into Alumni and update/disable access according to the exit process."
      },
      {
        "question": "08. Can a past employee be added without a login?",
        "answer": "Yes. HR/Admin can add a historical past employee directly to Alumni without creating an active login."
      },
      {
        "question": "09. Can active employee and Alumni data be exported?",
        "answer": "The supplied Employee Management workflow provides authorised CSV downloads."
      },
      {
        "question": "10. Why should role access be reviewed regularly?",
        "answer": "Employment, reporting, Finance and administrator responsibilities change. Stale access creates privacy, security and workflow-routing risk."
      }
    ]
  },
  {
    "title": "04. Attendance, visits and leave",
    "items": [
      {
        "question": "01. Which attendance modes are supported?",
        "answer": "The supplied product describes office, work-from-home and field attendance."
      },
      {
        "question": "02. What may field attendance require?",
        "answer": "Depending on configuration, a place, location and photograph, plus device permission."
      },
      {
        "question": "03. What are Attendance Logs?",
        "answer": "System-generated attendance records with authorised visibility into timing, location, late entry and checkout details."
      },
      {
        "question": "04. What is My Visit?",
        "answer": "It is the employee’s personal field-visit module. Mapped TL/RO/HR/Admin users can review the appropriate team scope."
      },
      {
        "question": "05. Can completed or cancelled visits be freely edited?",
        "answer": "No. The supplied workflow protects completed/cancelled visits from ordinary editing and restricts pictures after final status."
      },
      {
        "question": "06. Do I need approval before working on a holiday?",
        "answer": "Yes. Submit and obtain the applicable holiday-work approval before marking eligible holiday attendance."
      },
      {
        "question": "07. Does holiday check-in automatically create Comp-Off?",
        "answer": "Not by itself. The required sequence is approved holiday-work request followed by eligible attendance."
      },
      {
        "question": "08. When can a generated Comp-Off credit be claimed?",
        "answer": "From the next working day and within seven working days under the supplied rule."
      },
      {
        "question": "09. Which leave types are available to employees?",
        "answer": "Casual Leave, Earned Leave, Half Day and Comp-Off."
      },
      {
        "question": "10. Can any Comp-Off date be typed into leave?",
        "answer": "No. The employee selects from available approved Comp-Off credits."
      },
      {
        "question": "11. Who assigns Casual and Earned Leave balances?",
        "answer": "Authorised HR/Admin users through Leave Balances."
      },
      {
        "question": "12. Where does an employee see the current approval stage?",
        "answer": "Application Status shows live request stage and history for leave and related workflows."
      }
    ]
  },
  {
    "title": "05. Projects, approvals and performance",
    "items": [
      {
        "question": "01. Who creates and assigns projects?",
        "answer": "Team Leader and Reporting Officer capability users within their authorised scope."
      },
      {
        "question": "02. Is a project selected while creating an employee?",
        "answer": "No. Projects are assigned later through the Projects module."
      },
      {
        "question": "03. Which project statuses are implemented?",
        "answer": "Active, On Hold and Completed."
      },
      {
        "question": "04. Which project priorities are implemented?",
        "answer": "Low, Medium, High and Critical."
      },
      {
        "question": "05. What does the project team tree represent?",
        "answer": "Reporting Officer, Team Leader, assigned member doing the project and collaborator."
      },
      {
        "question": "06. Who uses Team Approvals?",
        "answer": "Authorised TL, RO and HR/Admin roles for live approval queues and history."
      },
      {
        "question": "07. Who submits performance reviews?",
        "answer": "Team Leader and Reporting Officer capability users for mapped team members/reporting targets."
      },
      {
        "question": "08. Does HR submit weekly performance ratings in this module?",
        "answer": "No. The supplied workflow explicitly reserves rating submission for TL/RO capability users."
      },
      {
        "question": "09. How are monthly and yearly performance graphs produced?",
        "answer": "They are generated from weekly review data."
      }
    ]
  },
  {
    "title": "06. Recruitment",
    "items": [
      {
        "question": "01. Who can raise a hiring request?",
        "answer": "Authorised recruitment roles can do so. A Team Leader raises the need for the mapped department and cannot approve its own request."
      },
      {
        "question": "02. What should the hiring request contain?",
        "answer": "Business reason, department, role/headcount, budget context, approval requirements and the authorised final approver."
      },
      {
        "question": "03. Who gives final approval before HR publishes?",
        "answer": "An authorised Admin or Managing Director under the supplied workflow."
      },
      {
        "question": "04. Can Finance approval be required?",
        "answer": "Yes. The request can require Finance budget confirmation."
      },
      {
        "question": "05. Does resume parsing automatically select a candidate?",
        "answer": "No. It structures information and may support matching; human decision is required."
      },
      {
        "question": "06. Can interviews have multiple interviewers?",
        "answer": "Yes. The panel can include multiple employees, and each selected interviewer must have one or more interview roles."
      },
      {
        "question": "07. What interview modes are available?",
        "answer": "The supplied screen includes online, office, phone and hybrid modes."
      },
      {
        "question": "08. What does interview feedback include?",
        "answer": "Role knowledge, relevant experience, communication, problem solving, work approach, strengths, concerns, comments and a recommendation."
      },
      {
        "question": "09. What recommendations are available?",
        "answer": "Strong Hire, Hire, Hold and Reject."
      },
      {
        "question": "10. Can submitted feedback be revised?",
        "answer": "The supplied interface allows an interviewer to revise their own scorecard while retaining prior history for audit."
      },
      {
        "question": "11. What is included in an offer draft?",
        "answer": "Designation, department, reporting manager, location, employment type, joining date, probation, salary components, deadline and notes."
      },
      {
        "question": "12. What happens after offer acceptance?",
        "answer": "Joining documents and background checks are managed, then the candidate can be converted into an employee record."
      }
    ]
  },
  {
    "title": "07. Payroll and finance",
    "items": [
      {
        "question": "01. What must be configured before payroll?",
        "answer": "Salary structures, statutory rules, attendance/LWP context, employee eligibility, bank information, tax instructions and approved adjustments."
      },
      {
        "question": "02. What is the payroll state sequence?",
        "answer": "Draft → HR Review → Finance Approved → Locked → Disbursed."
      },
      {
        "question": "03. Who performs HR Review?",
        "answer": "Authorised HR/Admin roles confirm employee, attendance, LWP, reimbursement and calculation context."
      },
      {
        "question": "04. Who approves, locks and records disbursement?",
        "answer": "Authorised Finance or Accounts Finance users under the role-controlled workflow."
      },
      {
        "question": "05. Why might an employee be skipped from calculation?",
        "answer": "The employee may be inactive/ineligible, missing required setup or already in HR Review, Finance Approval, Locked or Disbursed status for the period."
      },
      {
        "question": "06. What is LWP?",
        "answer": "Leave Without Pay context used in payroll calculation according to attendance, leave and configured rules."
      },
      {
        "question": "07. How do loans affect payroll?",
        "answer": "Approved/disbursed loans or advances can create EMI recovery schedules and balances used during eligible payroll periods."
      },
      {
        "question": "08. When does a reimbursement affect payroll?",
        "answer": "Only after the required claim, receipt, HR review, Finance approval, tax treatment and payroll scheduling statuses are satisfied."
      },
      {
        "question": "09. What does Payroll Banking manage?",
        "answer": "Employee bank details, verification, snapshots, salary-disbursement files and export tracking."
      },
      {
        "question": "10. What does Tax Declarations & TDS manage?",
        "answer": "Declarations, proofs, tax regimes, HR/Finance approvals and disabled/manual/external TDS instruction context."
      },
      {
        "question": "11. When are payslips available?",
        "answer": "After the payroll result/payslip is generated and the user has the authorised Finance or employee access."
      },
      {
        "question": "12. What reports are available?",
        "answer": "Payroll registers, summaries, statutory/department reports, employee statements, variance, trends and audited CSV exports are described in the supplied module."
      }
    ]
  },
  {
    "title": "08. Support, grievances, communication and assets",
    "items": [
      {
        "question": "01. Who can raise an IT support ticket?",
        "answer": "Every login can raise a ticket."
      },
      {
        "question": "02. Do Admin and HR manage IT tickets?",
        "answer": "They can raise tickets, but the tenant IT Department Head controls normal assignment/reassignment to tenant IT members."
      },
      {
        "question": "03. When does Superadmin see an IT issue?",
        "answer": "When the tenant IT Head escalates a major software, server, database, network/infrastructure, security or other major platform issue."
      },
      {
        "question": "04. Which IT ticket statuses exist?",
        "answer": "Open, Assigned, In Progress, Waiting for User, Resolved, Closed and Reopened."
      },
      {
        "question": "05. Can every login raise a grievance?",
        "answer": "Yes."
      },
      {
        "question": "06. What does anonymous grievance mean in the product?",
        "answer": "The employee identity is hidden from the HR/Admin frontend display for that submission."
      },
      {
        "question": "07. Who changes grievance status?",
        "answer": "Authorised HR/Admin users can move it through Pending, Under Review, Resolved or Rejected."
      },
      {
        "question": "08. Who can submit an asset record?",
        "answer": "Employees can submit assigned assets; HR/Admin can also add, verify, manage and report them."
      },
      {
        "question": "09. Who publishes policies?",
        "answer": "Authorised HR users upload tenant policy documents; employees can download accessible policies."
      },
      {
        "question": "10. How can notifications be targeted?",
        "answer": "Depending on role: tenant, department, team, selected users, all tenants or a selected tenant."
      }
    ]
  },
  {
    "title": "09. Billing, Razorpay, privacy and accessibility",
    "items": [
      {
        "question": "01. How are Essential and Growth payment amounts chosen?",
        "answer": "The server uses the latest Superadmin-managed plan record and ignores a browser-supplied amount."
      },
      {
        "question": "02. Can Premium use a default public checkout price?",
        "answer": "No. Premium requires the active custom quotation amount released to the client."
      },
      {
        "question": "03. What does Razorpay handle?",
        "answer": "It facilitates the selected online payment method. YourComate creates the order and verifies the returned payment identifiers/signature before activation."
      },
      {
        "question": "04. Does a created Razorpay order mean payment succeeded?",
        "answer": "No. Created, pending, abandoned, failed or unverified states do not activate paid access."
      },
      {
        "question": "05. Where can an administrator confirm payment?",
        "answer": "On the Billing page through subscription status, payment history and available invoice download."
      },
      {
        "question": "06. Does YourComate automatically debit a renewal?",
        "answer": "The supplied implementation uses a new customer-initiated order for each term. A future recurring mandate would require express authorisation."
      },
      {
        "question": "07. What should I do after a bank debit but no activation?",
        "answer": "Do not expose banking secrets or immediately repeat payment. Check status and contact the published support/billing channel with company, amount, date and Razorpay order/payment reference."
      },
      {
        "question": "08. Where are refund rules explained?",
        "answer": "In the published YourComate Refund Policy."
      },
      {
        "question": "09. Does YourComate store full card details or UPI PIN?",
        "answer": "The documented integration expects transaction identifiers and verification metadata; users must never send a CVV, UPI PIN, banking password or full card number to SDS."
      },
      {
        "question": "10. Who controls employee and candidate data?",
        "answer": "The Customer ordinarily determines its HR purposes and access, while SDS processes the data to provide the tenant service, as detailed in the Privacy Policy and contract."
      },
      {
        "question": "11. What accessibility target is used?",
        "answer": "The published Accessibility Statement uses WCAG 2.2 Level AA as the design and testing target, without claiming every page is independently certified."
      },
      {
        "question": "12. How do I report an issue or barrier?",
        "answer": "Use the relevant support route or email hr@sayanant.com. Include the page/workflow and useful technical details without passwords, OTPs or unnecessary personal data."
      }
    ]
  }
];

export default function FrequentlyAskedQuestionsPage() {
  useEffect(() => {
      document.documentElement.classList.add("yc-resource-page-active");
      document.body.classList.add("yc-resource-page-active");

      return () => {
        document.documentElement.classList.remove("yc-resource-page-active");
        document.body.classList.remove("yc-resource-page-active");
      };
    }, []);

  return (
    <main className="public-main yc-resource-document yc-resource-faq-document">
      <PageHero
        eyebrow="Frequently asked questions"
        title="Find practical answers without"
        titleAccent="searching across the system."
        description="Browse verified answers covering setup, roles, attendance, leave, recruitment, payroll, support, billing and access."
        icon="help"
        tone="amber"
        variant="resource-detail"
        secondary={["All Resources", "/resources"]}
      >
        <div className="yc-resource-hero-panel tone-amber">
          <span className="yc-resource-hero-panel-kicker">
            <Icon name="help" /> Verified answers
          </span>
          <h2>Start with the question. Finish with the right source of truth.</h2>
          <p>
            Scan the topic that matches your issue, understand the implemented
            behaviour, then verify the final action in the authorised screen.
          </p>
          <div className="yc-resource-hero-panel-links">
            <span>Setup &amp; access</span>
            <span>Workflows &amp; approvals</span>
            <span>Payroll, billing &amp; support</span>
          </div>
        </div>
      </PageHero>

      <section className="public-section yc-resource-document-section">
        <div className="page-width yc-resource-document-shell">
          <section className="yc-resource-glance">
            <header>
              <span className="public-kicker"><Icon name="help" /> Resource at a glance</span>
              <h2>Use the FAQ to find the category first, then verify the final action in the authorised screen.</h2>
            </header>
            <div className="yc-resource-glance-grid">
              <article className="tone-amber"><strong>Questions</strong><p>95 verified answers across nine categories.</p></article>
              <article className="tone-cyan"><strong>Best use</strong><p>Search by category, then verify the final action or status in the relevant role-authorised screen.</p></article>
              <article className="tone-mint"><strong>Escalation</strong><p>Use Customer HR/Admin for workforce records, tenant IT for normal IT issues and Superadmin only for platform-level scope.</p></article>
            </div>
            <aside className="yc-resource-callout tone-violet">
              <strong>Verified basis</strong>
              <p>This resource is tailored to the supplied YourComate source code and implemented workflow language. It avoids presenting future or unverified capability as current behaviour.</p>
            </aside>
          </section>

          <nav className="yc-resource-jump-nav" aria-label="FAQ categories">
            {categories.map((category) => (
              <a key={category.title} href={`#faq-${category.title.slice(0, 2)}`}>
                {category.title}
              </a>
            ))}
          </nav>

          <div className="yc-resource-faq-categories">
            {categories.map((category, categoryIndex) => (
              <section
                className="yc-resource-faq-category"
                id={`faq-${category.title.slice(0, 2)}`}
                key={category.title}
              >
                <h2>{category.title}</h2>
                <div className="yc-resource-faq-cards">
                  {category.items.map((item, index) => (
                    <article
                      className={`yc-resource-faq-card tone-${(categoryIndex + index) % 3 === 0 ? "amber" : (categoryIndex + index) % 3 === 1 ? "cyan" : "paper"}`}
                      key={item.question}
                    >
                      <h3>{item.question}</h3>
                      <p>{item.answer}</p>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="yc-resource-end-actions">
            <Link className="button button-ghost" to="/resources"><Icon name="arrowLeft" /> All Resources</Link>
            <Link className="button button-primary" to="/demo-registration">Request a Demo <Icon name="arrow" /></Link>
          </div>
        </div>
      </section>
    </main>
  );
}
