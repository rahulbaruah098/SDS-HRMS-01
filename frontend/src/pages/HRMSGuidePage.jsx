import { useEffect } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const guideSections = [
  {
    "title": "01. How to use this guide",
    "intro": "Use this document as an operating handbook rather than a list of screens. Begin with the role model and foundation sequence, then move to the workflow relevant to the user. The module directory at the end provides a verified scope map of the supplied implementation.",
    "bullets": [
      "Organisation leadership and HR should read Sections 2-7 before configuring production users.",
      "Managers, Team Leaders and Reporting Officers should focus on role capabilities, approvals, projects, performance and team visibility.",
      "Finance users should review payroll configuration, employee eligibility, approval states, banking and disbursement controls.",
      "Employees should use the self-service sections for attendance, leave, application status, projects, payslips, support and profile actions.",
      "Platform Superadmin should remain within tenant, trial, subscription, user-control, escalation, audit and platform-setting responsibilities."
    ],
    "callout": [
      "READ THE LIVE INTERFACE",
      "Button names and fields can change as the product improves. The live role-authorised screen and the organisation’s approved policy govern the exact action available to a user.",
      "cyan"
    ]
  },
  {
    "title": "02. What YourComate is",
    "intro": "YourComate is a connected HRMS workspace that brings employee records, attendance, leave, projects, recruitment, payroll, payslips, approvals, support, reports and role-aware assistance into one tenant-based system.",
    "table": {
      "headers": [
        "Capability layer",
        "Purpose",
        "Representative modules"
      ],
      "rows": [
        [
          "People foundation",
          "Create dependable organisational and employee context.",
          "Employee Management, entities, departments, designations, states, directory, profile"
        ],
        [
          "Everyday operations",
          "Capture recurring work and route decisions.",
          "Attendance, leave, holiday work, Comp-Off, visits, projects, approvals"
        ],
        [
          "Talent and pay",
          "Move from workforce demand to joining, salary and employee access.",
          "Recruitment, payroll configuration/runs, banking, tax, payslips"
        ],
        [
          "Service and intelligence",
          "Resolve issues and make activity visible.",
          "IT support, grievance, assets, policies, reports, audit, notifications, Saya"
        ]
      ]
    },
    "callout": [
      "CONNECTED CONTEXT",
      "The value is not only that modules exist. Employee identity, role, reporting relationships, attendance, approvals and payroll context are designed to stay related.",
      "mint"
    ]
  },
  {
    "title": "03. Tenant and role model",
    "intro": "YourComate separates platform administration from each Customer tenant. A Platform Superadmin manages SaaS-level operations but should not become the ordinary operator of a Customer’s HRMS work.",
    "table": {
      "headers": [
        "Role / capability",
        "Primary responsibility"
      ],
      "rows": [
        [
          "Platform Superadmin",
          "Companies, trial requests, subscriptions/payments, Premium quotations, tenant user control, global notifications, escalated major IT issues, audit and settings."
        ],
        [
          "Organisation Admin / HR",
          "People masters, employees, HR workflows, leave balances, policies, notifications, reports and tenant administration."
        ],
        [
          "Finance / Accounts Finance",
          "Payroll-related review, approval, banking, tax, disbursement and authorised reports."
        ],
        [
          "Employee",
          "Self-service attendance, leave, projects, requests, profile, payslips, policies, grievances, assets and support."
        ],
        [
          "Team Leader capability",
          "An employee capability for mapped team projects, approvals and weekly performance reviews."
        ],
        [
          "Reporting Officer capability",
          "An employee capability for mapped TL/reporting members, projects, approvals and higher-level review."
        ]
      ]
    },
    "callout": [
      "IDENTITY RULE",
      "Team Leader and Reporting Officer are not separate user identities. They remain employee logins with capability flags and mappings on the employee record.",
      "violet"
    ],
    "after": "The Reporting Officer selector is restricted by the supplied implementation to employees whose designation matches Manager, Managing Director, Director, CEO or Chief Executive Officer. The organisation should maintain designation masters carefully."
  },
  {
    "title": "04. Approved trial and first access",
    "steps": [
      [
        "01",
        "Submit trial registration",
        "The organisation provides company and contact information and verifies the company email using OTP."
      ],
      [
        "02",
        "Superadmin review",
        "The verified request enters Platform Superadmin review; submission alone does not create access."
      ],
      [
        "03",
        "Approve and create tenant",
        "Approval creates the trial company, starts the configured 15-day full-access period and generates initial administrator credentials."
      ],
      [
        "04",
        "Receive credentials",
        "The approved company receives its administrator login details through the configured email route."
      ],
      [
        "05",
        "Complete first sign-in",
        "The administrator confirms access, reviews tenant identity and moves into foundation setup."
      ]
    ],
    "callout": [
      "START DATE",
      "The trial begins on approval/tenant creation, not when the initial registration form is opened or submitted.",
      "amber"
    ]
  },
  {
    "title": "05. Foundation setup sequence",
    "intro": "Configure foundations before importing day-to-day activity. A rushed employee upload without clean masters and responsibility mappings causes avoidable errors in reporting, approvals, holidays and payroll.",
    "steps": [
      [
        "01",
        "Confirm tenant and entity structure",
        "Review the company/tenant and create organisation or legal-entity records needed for employee mapping and entity-wise exports."
      ],
      [
        "02",
        "Create operating masters",
        "Create departments, designations and operating states. Confirm naming, uniqueness and intended reporting use."
      ],
      [
        "03",
        "Define role and approval ownership",
        "Identify Admin/HR, Finance, Team Leaders, Reporting Officers, IT Department Head and escalation responsibility."
      ],
      [
        "04",
        "Prepare employee data",
        "Clean active employee identity, code, email, department, designation, branch, state, reporting and employment fields."
      ],
      [
        "05",
        "Create employees and logins",
        "Create active employee records and corresponding user access, then verify role/capability behaviour."
      ],
      [
        "06",
        "Assign balances and policies",
        "Set Casual/Earned Leave balances, holiday calendars, attendance rules and accessible policy documents."
      ],
      [
        "07",
        "Configure payroll before first run",
        "Complete structures, statutory settings, bank verification and tax instructions before calculation."
      ],
      [
        "08",
        "Pilot real scenarios",
        "Test employee, TL, RO, HR, Finance and IT workflows with a controlled group before organisation-wide adoption."
      ]
    ]
  },
  {
    "title": "06. Employee lifecycle and people records",
    "intro": "Employee Management combines three related areas: active Employee Master, Create Employee and Alumni. The workflow intentionally separates current workforce records from past employees.",
    "bullets": [
      "Create Employee creates an active employee record and its login user using available Department, Designation and State masters.",
      "Project is not selected while creating an employee; TL/RO assign projects later through the Projects workflow.",
      "Team Leader and Reporting Officer capability flags and mappings are maintained on the employee record.",
      "Employee Master shows active employees. HR/Admin can mark an active employee as resigned/left and move the person to Alumni.",
      "HR/Admin may add a historical past employee directly to Alumni without creating a login account.",
      "Active and Alumni data can be downloaded as CSV where the authorised interface provides the action.",
      "Employee Directory gives common role-accessible contact visibility without exposing every administrative employee field."
    ],
    "callout": [
      "DATA DISCIPLINE",
      "Use unique employee codes and work emails, maintain current reporting mappings and review access immediately when employment status changes.",
      "cyan"
    ]
  },
  {
    "title": "07. Attendance, field work and Comp-Off",
    "intro": "Attendance supports office, work-from-home and field scenarios. The exact check-in controls depend on the configured work mode, device permission, holiday rule and user role.",
    "table": {
      "headers": [
        "Flow",
        "What happens"
      ],
      "rows": [
        [
          "Office / WFH",
          "Employee checks in and out; worked time, late entry and attendance status become visible in authorised views."
        ],
        [
          "Field attendance",
          "The workflow may capture place, location and photograph according to configured requirements and device permission."
        ],
        [
          "My Visit",
          "The employee records personal visits; mapped TL/RO/HR/Admin can review the appropriate team scope."
        ],
        [
          "Holiday work",
          "A request must be approved before attendance on an eligible Sunday, designated Saturday or HR-created holiday."
        ],
        [
          "Comp-Off",
          "Approved holiday-work attendance can generate a credit claimable from the next working day within seven working days."
        ],
        [
          "Attendance Logs",
          "Authorised roles review generated timing, location, late-entry and checkout records."
        ]
      ]
    },
    "callout": [
      "NO APPROVED HOLIDAY-WORK REQUEST",
      "The user should not assume that merely checking in on a holiday will create a Comp-Off credit. The approval and eligible attendance sequence matters.",
      "pink"
    ]
  },
  {
    "title": "08. Leave and approval routing",
    "intro": "Employees can request Casual Leave, Earned Leave, Half Day and eligible Comp-Off leave. HR/Admin separately maintains Casual and Earned Leave balances.",
    "steps": [
      [
        "01",
        "Employee submits",
        "Choose the leave type, dates and required reason/handover information. Comp-Off must be selected from an available approved credit."
      ],
      [
        "02",
        "Route to current approver",
        "The request enters the role-aware Team Approvals flow according to the employee’s mapping and configured stage."
      ],
      [
        "03",
        "TL / RO / HR decision",
        "Authorised approvers review the request and record approval or rejection at their stage."
      ],
      [
        "04",
        "Status becomes visible",
        "The employee follows the live stage and history through Application Status."
      ],
      [
        "05",
        "Balances and records align",
        "Approved leave is reflected in the relevant leave and attendance context according to configuration."
      ]
    ],
    "after": "Application Status also centralises other request types, including holiday work, password, grievance, IT support and Comp-Off, so employees do not need to search several modules for an outcome."
  },
  {
    "title": "09. Projects, performance and management work",
    "bullets": [
      "Team Leaders and Reporting Officers create and assign projects within their authorised scope.",
      "Employees see only scoped projects and can update the allowed progress/status fields.",
      "Project states include Active, On Hold and Completed; priorities include Low, Medium, High and Critical.",
      "The project team tree distinguishes Reporting Officer, Team Leader, assigned member and collaborator.",
      "Weekly performance ratings are submitted only by TL and RO capability users for mapped targets; HR/Admin does not submit reviews from this module.",
      "Monthly and yearly performance graphs are derived from weekly review data.",
      "Management Group supports member control, meetings, an assigned minutes writer and searchable minutes history."
    ],
    "callout": [
      "SCOPE BEFORE ACTION",
      "If a manager cannot see an employee or project, verify the employee record’s TL/RO mapping and the user’s capability flags before widening access.",
      "mint"
    ]
  },
  {
    "title": "10. Recruitment and joining",
    "intro": "Recruitment connects workforce demand to a controlled employee conversion. The supplied implementation keeps final selection and employment decisions with authorised people.",
    "steps": [
      [
        "01",
        "Raise hiring request",
        "Record the business reason, department need, role, headcount, budget context and approver. A TL is locked to the mapped department and cannot approve its own request."
      ],
      [
        "02",
        "Budget and leadership approval",
        "Finance confirmation may be required. Admin or an authorised Managing Director gives final approval before HR publishes."
      ],
      [
        "03",
        "Create/publish opening",
        "HR records the vacancy, job details and application route."
      ],
      [
        "04",
        "Receive and structure candidates",
        "Applications and resumes become candidate records; parsing/matching supports review but does not decide selection."
      ],
      [
        "05",
        "Screen and schedule interviews",
        "Move suitable applications to the next stage and choose round, mode, time and role-defined interviewer panel."
      ],
      [
        "06",
        "Record individual feedback",
        "Each interviewer records scores, strengths, concerns, comments and a recommendation. Revisions remain auditable."
      ],
      [
        "07",
        "Prepare approved offer",
        "Confirm designation, department, manager, location, employment type, joining date, probation and salary terms."
      ],
      [
        "08",
        "Complete joining controls",
        "Review joining documents and background-check status; record did-not-join where required."
      ],
      [
        "09",
        "Convert to employee",
        "Create the employee record from the selected candidate and approved offer, then complete normal employee setup."
      ]
    ],
    "callout": [
      "HUMAN DECISION REQUIRED",
      "Resume matching and Saya guidance are assistive. They must not automatically reject, select or rank a candidate without authorised human review.",
      "violet"
    ]
  },
  {
    "title": "11. Payroll and finance controls",
    "intro": "Payroll is a controlled monthly chain built on employee eligibility, attendance, leave, salary configuration, approved adjustments, bank readiness and role-specific approval states.",
    "table": {
      "headers": [
        "State",
        "Owner and meaning"
      ],
      "rows": [
        [
          "Draft",
          "Prepare the period, target employees and inputs; calculate only eligible employees."
        ],
        [
          "HR Review",
          "HR confirms employee data, attendance/LWP, reimbursements and employee-level calculation results."
        ],
        [
          "Finance Approved",
          "Finance/Accounts Finance approves the reviewed run."
        ],
        [
          "Locked",
          "Finance locks the approved payroll against ordinary changes."
        ],
        [
          "Disbursed",
          "Finance records salary disbursement and related recovery/payment outcomes."
        ]
      ]
    },
    "bullets": [
      "Payroll Configuration controls salary structures, statutory rules, PF, PT, ESI, TDS, LWP and revision history.",
      "Payroll Banking manages employee bank details, verification, payroll snapshots, salary-disbursement files and export tracking.",
      "Loans & Advances manages request, approval, disbursement, EMI schedule and payroll recovery balance.",
      "Reimbursements manages receipts, HR review, Finance approval, tax treatment, payroll scheduling and payment status.",
      "Tax Declarations & TDS manages regimes, proofs, approvals and disabled/manual/external TDS instruction context.",
      "Payslips become available from generated payroll results according to role access."
    ],
    "callout": [
      "DO NOT BYPASS LOCKED STATES",
      "Correct the underlying attendance, employee, salary or adjustment source before final approval where the workflow permits. Locked or disbursed payroll requires a controlled correction process.",
      "amber"
    ]
  },
  {
    "title": "12. Employee service, support and communication",
    "table": {
      "headers": [
        "Module",
        "Service model"
      ],
      "rows": [
        [
          "IT Support",
          "Every login can raise a ticket. Tenant IT Head assigns/reassigns to tenant IT staff; assigned staff update progress; employee reviews resolution."
        ],
        [
          "IT escalation",
          "Only the tenant IT Department Head escalates major software, server, database, network, security or major platform issues to Superadmin."
        ],
        [
          "Grievance",
          "Every login can raise a grievance; anonymous submission hides employee identity from the HR/Admin frontend; HR/Admin updates status."
        ],
        [
          "Assets",
          "Employees submit assigned hardware/software; HR/Admin verifies, manages and reports employee-wise."
        ],
        [
          "Policies",
          "HR uploads tenant policy documents and employees download the authorised versions."
        ],
        [
          "Notifications",
          "Tenant HR/Admin can target tenant users; team roles can use authorised team scopes; Superadmin can notify all or one tenant."
        ]
      ]
    },
    "after": "IT support states include Open, Assigned, In Progress, Waiting for User, Resolved, Closed and Reopened. The employee should use the same ticket for the same unresolved issue rather than creating duplicates."
  },
  {
    "title": "13. Reports, audit and operational visibility",
    "bullets": [
      "The Reports module provides authorised attendance, field-attendance, holiday-work, Comp-Off, leave, project and audit reporting.",
      "Payroll Reports provides registers, summaries, statutory and department reports, employee statements, variance/trend views and audited CSV exports.",
      "Dashboards summarise activity but do not replace the underlying employee, attendance, approval, payment or payroll record.",
      "Audit Logs trace actions for authorised Admin/Superadmin review and should be used when investigating who changed a record or decision.",
      "Exports should be treated as controlled organisational data; access and distribution remain the Customer’s responsibility."
    ]
  },
  {
    "title": "14. Saya, mobile use and responsible assistance",
    "intro": "Saya is the in-product, role-aware YourComate assistant. It uses the signed-in role, permissions and relevant workspace context to guide the user toward a permitted next step. The public website guide is a separate general navigation assistant.",
    "bullets": [
      "Saya can explain or guide connected workflows such as attendance, leave, approvals and projects where the capability is enabled.",
      "The user should verify the target employee, date, request type and status before confirming a consequential action.",
      "Saya does not replace HR, Finance, manager or leadership authority and does not provide legal, tax, payroll or employment advice.",
      "Responsive views support desktop, tablet and mobile access; exact device features such as location, camera, microphone and notification delivery depend on permission and platform support.",
      "Never place passwords, OTPs, UPI PINs, full card numbers or irrelevant sensitive information in a prompt or support message."
    ]
  },
  {
    "title": "15. Plans, billing and Razorpay",
    "bullets": [
      "Essential and Growth use the latest Superadmin-configured plan price at the time the order is created; the browser cannot override the authoritative amount.",
      "Premium is quotation-based. Client payment becomes available only after the quotation is released with a valid amount and reference.",
      "Razorpay checkout creates an order, and YourComate activates/renews access only after order, payment and signature verification succeeds.",
      "Created, pending, failed, cancelled or unverified orders do not by themselves activate paid access.",
      "The Billing page shows subscription validity, renewal alerts, Premium details, payment history and downloadable invoice records.",
      "The supplied implementation uses customer-initiated renewal orders; a past payment is not treated as authority for an automatic debit.",
      "Refund questions follow the published Refund Policy; privacy and third-party payment handling follow the Privacy Policy and Razorpay’s terms."
    ]
  },
  {
    "title": "16. Security, privacy and adoption controls",
    "bullets": [
      "Map roles and capabilities to real responsibility; do not grant broad access only to solve a visibility problem.",
      "Review active users, administrators, TL/RO mappings, Finance access and IT assignment responsibility regularly.",
      "Use the correct tenant and never mix one Customer’s employee or payment data with another tenant.",
      "Protect credentials, OTP routes and authorised devices; report suspected compromise promptly.",
      "Treat location, face/photo, payroll, grievance and candidate data according to the organisation’s lawful notice and access rules.",
      "Test a workflow with representative users before rollout, document the owner for each exception and communicate where status can be checked.",
      "Use audit and source records when a dashboard value or exported figure appears inconsistent."
    ],
    "callout": [
      "ADOPTION PRINCIPLE",
      "Launch the smallest coherent workflow that solves a real operating problem, then expand after roles, data quality and exception handling are stable.",
      "mint"
    ]
  }
];
const moduleRows = [
  [
    "Platform",
    "Companies / Tenants",
    "Superadmin creates and manages SaaS companies and tenant status."
  ],
  [
    "Platform",
    "Trial Requests",
    "Superadmin reviews OTP-verified applications and starts approved 15-day trials."
  ],
  [
    "Platform",
    "Premium Requests",
    "Superadmin manages custom requirements, quotations, client release and conversion."
  ],
  [
    "Platform",
    "Subscriptions & Payments",
    "Superadmin monitors trial expiry, plans, Razorpay orders, payments and invoices."
  ],
  [
    "Platform",
    "User Control",
    "Superadmin manages users within a selected tenant, including access and password actions."
  ],
  [
    "People",
    "Employee Management",
    "Active Employee Master, Create Employee, Alumni, TL/RO mapping and CSV downloads."
  ],
  [
    "People",
    "Organisation / Entity Master",
    "Tenant-level organisations or legal entities used for employee mapping and exports."
  ],
  [
    "People",
    "Employee Directory",
    "Role-accessible contact directory with designation, state, phone, email and profile photo."
  ],
  [
    "People",
    "Departments",
    "Department master used by employee, recruitment and organisational workflows."
  ],
  [
    "People",
    "Designations",
    "Designation master used by employee, user and Reporting Officer eligibility workflows."
  ],
  [
    "People",
    "States",
    "Operating-state master used in employee setup and holiday calendar."
  ],
  [
    "People",
    "My Profile",
    "Personal profile, profile photograph and secure password change."
  ],
  [
    "Work",
    "Attendance",
    "Office, WFH and field attendance with relevant place/photo, timing and holiday controls."
  ],
  [
    "Work",
    "Attendance Logs",
    "System-generated records with location, late-entry and checkout details for authorised roles."
  ],
  [
    "Work",
    "My Visit",
    "Personal field visits with mapped-team review for TL, RO, HR and Admin."
  ],
  [
    "Work",
    "Holiday Calendar",
    "State-wise holidays for configured operating states."
  ],
  [
    "Work",
    "Holiday Work Requests",
    "Approval required before eligible work on Sunday, designated Saturdays or holidays."
  ],
  [
    "Work",
    "Comp-Off Credits",
    "Credits generated after approved holiday-work attendance and claimed within configured validity."
  ],
  [
    "Work",
    "Apply Leave",
    "Casual Leave, Earned Leave, Half Day and eligible Comp-Off requests."
  ],
  [
    "Work",
    "Leave Management",
    "HR review view for current and historical leave and approval status."
  ],
  [
    "Work",
    "Leave Balances",
    "HR/Admin assigns Casual and Earned Leave balances."
  ],
  [
    "Work",
    "Team Approvals",
    "Approval inbox for TL, RO and HR/Admin with stage and decision history."
  ],
  [
    "Work",
    "Application Status",
    "Employee view across leave, holiday work, password, grievance, IT and Comp-Off requests."
  ],
  [
    "Delivery",
    "Projects",
    "TL/RO project creation, assignment and employee-scoped progress updates."
  ],
  [
    "Delivery",
    "Performance",
    "Weekly TL/RO reviews with monthly and yearly analytics."
  ],
  [
    "Delivery",
    "Management Group",
    "Membership, meetings, assigned minutes writer and searchable minutes."
  ],
  [
    "Talent",
    "Recruitment",
    "Hiring request, approvals, vacancy, candidates, interviews, offers, joining and conversion."
  ],
  [
    "Payroll",
    "Payroll Configuration",
    "Salary structures, statutory rules, PF, PT, ESI, TDS, LWP and revision history."
  ],
  [
    "Payroll",
    "Payroll Runs",
    "Draft, HR Review, Finance Approved, Locked and Disbursed workflow."
  ],
  [
    "Payroll",
    "Payslips",
    "Generated employee payslips for authorised Finance and employee access."
  ],
  [
    "Payroll",
    "Loans & Advances",
    "Requests, approvals, disbursement, EMI schedules and payroll recovery."
  ],
  [
    "Payroll",
    "Reimbursements",
    "Claims, receipts, HR review, Finance approval, payroll scheduling and payment."
  ],
  [
    "Payroll",
    "Payroll Banking",
    "Bank verification, snapshots, salary files and export tracking."
  ],
  [
    "Payroll",
    "Tax Declarations & TDS",
    "Declarations, proofs, regimes, approvals and payroll tax instruction context."
  ],
  [
    "Payroll",
    "Payroll Reports",
    "Registers, statutory/department reports, statements, variance, trends and audited CSV exports."
  ],
  [
    "Service",
    "IT Support",
    "Tenant IT assignment and escalation of major software/server issues to Platform Superadmin."
  ],
  [
    "Service",
    "Grievance",
    "Employee grievance, anonymous option and HR/Admin status management."
  ],
  [
    "Service",
    "Assets",
    "Employee submission, HR/Admin verification, management and employee-wise reports."
  ],
  [
    "Service",
    "Policies",
    "Tenant HR policy upload and employee download."
  ],
  [
    "Insight",
    "Reports",
    "Attendance, field, holiday-work, Comp-Off, leave, project and audit reporting."
  ],
  [
    "Insight",
    "Notifications",
    "Tenant, department, team, selected-user and platform notification scopes."
  ],
  [
    "Control",
    "Audit Logs",
    "Traceable action history for authorised Admin/Superadmin review."
  ],
  [
    "Control",
    "System Settings",
    "Rule-engine and platform/tenant configuration available to authorised administrators."
  ],
  [
    "Commercial",
    "Billing & Subscription",
    "Validity, renewal alerts, quotation, Razorpay payment history and invoice downloads."
  ]
];
const sourceItems = [
  "frontend/src/data/modules.js - module titles, role sets, capability rules and workflow descriptions",
  "frontend/src/data/publicSiteData.js - public product groups, feature summaries and workflow language",
  "frontend/src/pages/ResourcesPage.jsx and ResourceDetailPage.jsx - resource-centre intent",
  "frontend/src/pages/Recruitment.jsx - hiring request, interview, offer, joining and conversion workflow",
  "frontend/src/pages/Payroll.jsx - payroll eligibility, HR Review, Finance approval, lock and disbursement flow",
  "backend/app/services/pricing_service.py and billing_service.py - plans, authoritative pricing and payment activation"
];

function ResourceTable({ table }) {
  return (
    <div className="yc-resource-table-wrap">
      <table className="yc-resource-table">
        <thead><tr>{table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row[0]}`}>
              {row.map((cell, cellIndex) => (
                <td data-label={table.headers[cellIndex]} key={`${cellIndex}-${cell}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HRMSGuidePage() {
  useEffect(() => {
      document.documentElement.classList.add("yc-resource-page-active");
      document.body.classList.add("yc-resource-page-active");

      return () => {
        document.documentElement.classList.remove("yc-resource-page-active");
        document.body.classList.remove("yc-resource-page-active");
      };
    }, []);

  return (
    <main className="public-main yc-resource-document yc-resource-guide-document">
      <PageHero
        eyebrow="HRMS guide"
        title="Run YourComate with a clear operating playbook."
        description="Set up roles, people data, approvals, payroll and everyday workflows in the right order—from approved trial to stable adoption."
        icon="book"
        tone="cyan"
        variant="resource-detail"
        secondary={["All Resources", "/resources"]}
      >
        <div className="yc-resource-hero-panel tone-cyan">
          <span className="yc-resource-hero-panel-kicker">
            <Icon name="book" /> Operating guide
          </span>
          <h2>From first access to confident everyday use.</h2>
          <p>
            Keep setup, responsibility and connected operations visible while
            moving from implementation into day-to-day HRMS work.
          </p>
          <div className="yc-resource-hero-panel-links">
            <span>Role-aware setup</span>
            <span>Connected operations</span>
            <span>Controls &amp; governance</span>
          </div>
        </div>
      </PageHero>

      <section className="public-section yc-resource-document-section">
        <div className="page-width yc-resource-document-shell">
          <section className="yc-resource-glance">
            <header>
              <span className="public-kicker"><Icon name="book" /> Resource at a glance</span>
              <h2>Move from approved trial to disciplined everyday use with the role model and workflow sequence kept visible.</h2>
            </header>
            <div className="yc-resource-glance-grid">
              <article className="tone-cyan"><strong>Audience</strong><p>Organisation Admin, HR, Finance, managers, TL/RO capability users, employees and Platform Superadmin.</p></article>
              <article className="tone-violet"><strong>Coverage</strong><p>People foundation, attendance, leave, projects, recruitment, payroll, service, insights, billing and Saya.</p></article>
              <article className="tone-mint"><strong>Operating rule</strong><p>Every screen is role-aware. A visible feature still depends on the tenant, plan, configuration and authorised responsibility.</p></article>
            </div>
            <aside className="yc-resource-callout tone-violet">
              <strong>Verified basis</strong>
              <p>This resource is tailored to the supplied YourComate source code and implemented workflow language. It avoids presenting future or unverified capability as current behaviour.</p>
            </aside>
          </section>

          <nav className="yc-resource-jump-nav yc-resource-jump-nav-compact" aria-label="Guide sections">
            {guideSections.map((section) => (
              <a href={`#guide-${section.title.slice(0, 2)}`} key={section.title}>{section.title}</a>
            ))}
            <a href="#guide-17">17. Verified module directory</a>
          </nav>

          <div className="yc-resource-guide-sections">
            {guideSections.map((section, sectionIndex) => (
              <section className="yc-resource-guide-section" id={`guide-${section.title.slice(0, 2)}`} key={section.title}>
                <h2>{section.title}</h2>
                {section.intro && <p className="yc-resource-section-intro">{section.intro}</p>}
                {section.table && <ResourceTable table={section.table} />}
                {section.steps && (
                  <div className="yc-resource-step-list">
                    {section.steps.map(([number, title, copy]) => (
                      <article key={`${section.title}-${number}`}>
                        <b>{number}</b><div><h3>{title}</h3><p>{copy}</p></div>
                      </article>
                    ))}
                  </div>
                )}
                {section.bullets && <ul className="yc-resource-bullets">{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}
                {section.callout && (
                  <aside className={`yc-resource-callout tone-${section.callout[2]}`}>
                    <strong>{section.callout[0]}</strong><p>{section.callout[1]}</p>
                  </aside>
                )}
                {section.after && <p className="yc-resource-section-after">{section.after}</p>}
              </section>
            ))}

            <section className="yc-resource-guide-section" id="guide-17">
              <h2>17. Verified module directory</h2>
              <p className="yc-resource-section-intro">The following directory reflects the supplied project’s module definitions. Availability depends on tenant, plan, role, capability mapping and configuration.</p>
              <ResourceTable table={{ headers: ["Area", "Module", "Implemented purpose"], rows: moduleRows }} />
            </section>
          </div>

          <section className="yc-resource-source-note">
            <h2>Source and maintenance note</h2>
            <p>The following project sources were used to verify the document. Review this resource whenever roles, module names, workflow states, pricing, trial rules or screen behaviour changes.</p>
            <ol>{sourceItems.map((item) => <li key={item}>{item}</li>)}</ol>
            <aside className="yc-resource-callout tone-cyan">
              <strong>Resource owner</strong>
              <p>Sayanant Development Services Pvt. Ltd. / YourComate HRMS. Questions or correction requests: <a href="mailto:hr@sayanant.com">hr@sayanant.com</a>.</p>
            </aside>
          </section>

          <div className="yc-resource-end-actions">
            <Link className="button button-ghost" to="/resources"><Icon name="arrowLeft" /> All Resources</Link>
            <Link className="button button-primary" to="/demo-registration">Request a Demo <Icon name="arrow" /></Link>
          </div>
        </div>
      </section>
    </main>
  );
}
