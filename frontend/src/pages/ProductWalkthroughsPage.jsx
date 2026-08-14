import { useEffect } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const workflows = [
  {
    "title": "01. Register and activate the 15-day trial",
    "steps": [
      {
        "num": "01",
        "title": "Open trial registration",
        "copy": "Enter company and authorised contact details and submit the request."
      },
      {
        "num": "02",
        "title": "Verify company email",
        "copy": "Enter the OTP within the configured validity and allowed attempts."
      },
      {
        "num": "03",
        "title": "Await Superadmin review",
        "copy": "The verified request becomes review-ready; no tenant exists yet."
      },
      {
        "num": "04",
        "title": "Approve or reject",
        "copy": "Superadmin checks the application. Approval creates the company, generates admin credentials and starts the 15-day trial."
      },
      {
        "num": "05",
        "title": "Receive and use credentials",
        "copy": "The company administrator signs in and confirms tenant access."
      },
      {
        "num": "06",
        "title": "Record the expiry",
        "copy": "The administrator notes the trial end date and begins foundation setup promptly."
      }
    ],
    "control": "Never represent OTP verification as trial approval. Approval by Platform Superadmin is the event that creates access and starts the trial.",
    "meta": [
      "Company applicant; Platform Superadmin",
      "Valid company email and accurate organisation/contact details",
      "Approved trial tenant with administrator credentials and recorded expiry"
    ]
  },
  {
    "title": "02. Complete first-time organisation setup",
    "steps": [
      {
        "num": "01",
        "title": "Confirm tenant identity",
        "copy": "Review company name, plan/trial status and administrator contact."
      },
      {
        "num": "02",
        "title": "Create entity records",
        "copy": "Add organisation/legal-entity records required for employee mapping and reporting."
      },
      {
        "num": "03",
        "title": "Create departments",
        "copy": "Use stable department names that match recruitment, managers and reports."
      },
      {
        "num": "04",
        "title": "Create designations",
        "copy": "Include leadership designations needed for Reporting Officer eligibility."
      },
      {
        "num": "05",
        "title": "Create operating states",
        "copy": "Add states used by employee profiles and holiday calendars."
      },
      {
        "num": "06",
        "title": "Assign operating owners",
        "copy": "Identify HR/Admin, Finance, TL, RO and tenant IT responsibility before adding users."
      },
      {
        "num": "07",
        "title": "Pilot",
        "copy": "Create a small representative user group and validate navigation before bulk rollout."
      }
    ],
    "control": null,
    "meta": [
      "Organisation Admin / HR",
      "Approved tenant and administrator login",
      "Clean masters and responsibility map ready for employee creation"
    ]
  },
  {
    "title": "03. Create an employee and map TL / RO capabilities",
    "steps": [
      {
        "num": "01",
        "title": "Open Employee Management",
        "copy": "Use Create Employee within the combined Employee Master/Create Employee/Alumni page."
      },
      {
        "num": "02",
        "title": "Enter employee identity",
        "copy": "Provide unique employee code, work email and required employment/profile fields."
      },
      {
        "num": "03",
        "title": "Assign masters",
        "copy": "Select department, designation, state, entity, branch and reporting information."
      },
      {
        "num": "04",
        "title": "Set capabilities",
        "copy": "If applicable, mark Team Leader or Reporting Officer capability and create the correct mappings."
      },
      {
        "num": "05",
        "title": "Create login",
        "copy": "Complete user credentials/access according to the organisation process."
      },
      {
        "num": "06",
        "title": "Verify employee dashboard",
        "copy": "Sign in or impersonation-free test with the employee and confirm only appropriate modules/actions are visible."
      },
      {
        "num": "07",
        "title": "Assign projects later",
        "copy": "Do not select a project in employee creation. TL/RO assigns it through Projects."
      }
    ],
    "control": "TL and RO remain employee identities. Do not create duplicate standalone TL/RO accounts for the same person.",
    "meta": [
      "HR / Admin",
      "Department, designation and state masters; unique employee information",
      "Active employee record, login and correct responsibility mapping"
    ]
  },
  {
    "title": "04. Record office, WFH or field attendance",
    "steps": [
      {
        "num": "01",
        "title": "Open Attendance",
        "copy": "Review today’s status and available work modes."
      },
      {
        "num": "02",
        "title": "Choose permitted mode",
        "copy": "Use office, WFH or field according to organisation rules and the visible options."
      },
      {
        "num": "03",
        "title": "Provide required evidence",
        "copy": "For field use, allow location/camera and enter place or photograph where the screen requires it."
      },
      {
        "num": "04",
        "title": "Check in",
        "copy": "Confirm that the system records the check-in rather than assuming the tap succeeded."
      },
      {
        "num": "05",
        "title": "Complete work and check out",
        "copy": "Use checkout when work ends and verify worked-time/status visibility."
      },
      {
        "num": "06",
        "title": "Review exceptions",
        "copy": "Use Attendance Logs or the authorised correction route for late, missing or incorrect events."
      }
    ],
    "control": "Location or photo access should be used only for the organisation’s documented attendance purpose and with the required employee notice.",
    "meta": [
      "Employee; authorised manager/HR review",
      "Active employee, correct work mode, device permission where required",
      "Attendance record with timing, mode and relevant field evidence"
    ]
  },
  {
    "title": "05. Work on a holiday and receive Comp-Off",
    "steps": [
      {
        "num": "01",
        "title": "Submit holiday-work request",
        "copy": "Choose the work date and explain the requirement before attempting holiday attendance."
      },
      {
        "num": "02",
        "title": "Follow Team Approvals",
        "copy": "TL, RO or HR/Admin reviews according to the live approval stage."
      },
      {
        "num": "03",
        "title": "Confirm approval",
        "copy": "Use Application Status; do not proceed on a pending or rejected assumption."
      },
      {
        "num": "04",
        "title": "Record attendance",
        "copy": "On the approved eligible date, complete the required attendance flow."
      },
      {
        "num": "05",
        "title": "Verify credit",
        "copy": "The system generates the Comp-Off credit after approved holiday-work attendance."
      },
      {
        "num": "06",
        "title": "Claim within validity",
        "copy": "Select the available credit for Comp-Off leave from the next working day and within seven working days."
      }
    ],
    "control": "The correct sequence is request → approval → eligible attendance → credit → claim. Skipping approval can prevent credit generation.",
    "meta": [
      "Employee; TL/RO/HR approver",
      "Eligible holiday/Sunday/designated Saturday and work need",
      "Approved holiday work, eligible attendance and generated Comp-Off credit"
    ]
  },
  {
    "title": "06. Apply for leave and follow approval status",
    "steps": [
      {
        "num": "01",
        "title": "Open Apply Leave",
        "copy": "Choose Casual Leave, Earned Leave, Half Day or Comp-Off."
      },
      {
        "num": "02",
        "title": "Enter request details",
        "copy": "Select dates and provide the required reason and handover context."
      },
      {
        "num": "03",
        "title": "Choose Comp-Off credit if applicable",
        "copy": "Only available approved credits can be used for Comp-Off leave."
      },
      {
        "num": "04",
        "title": "Submit",
        "copy": "Confirm the summary and create the request once."
      },
      {
        "num": "05",
        "title": "Approvers act",
        "copy": "Mapped TL/RO and HR/Admin use Team Approvals according to the current stage."
      },
      {
        "num": "06",
        "title": "Track outcome",
        "copy": "Use Application Status for live stage, decision and history."
      }
    ],
    "control": null,
    "meta": [
      "Employee; mapped TL/RO; HR/Admin",
      "Active employee and relevant balance/Comp-Off credit",
      "Approved/rejected leave with visible stage and history"
    ]
  },
  {
    "title": "07. Create, assign and update a project",
    "steps": [
      {
        "num": "01",
        "title": "Create project",
        "copy": "TL/RO enters title, purpose, priority, dates and required context."
      },
      {
        "num": "02",
        "title": "Assign responsible people",
        "copy": "Choose owner/assigned member and collaborators within authorised scope."
      },
      {
        "num": "03",
        "title": "Confirm tree",
        "copy": "Check RO, TL, assigned member and collaborator relationships."
      },
      {
        "num": "04",
        "title": "Employee opens scoped project",
        "copy": "The employee sees only projects assigned or shared within the permitted scope."
      },
      {
        "num": "05",
        "title": "Update progress/status",
        "copy": "Use allowed fields to record delivery progress and Active, On Hold or Completed state."
      },
      {
        "num": "06",
        "title": "Manager reviews",
        "copy": "TL/RO uses the current record rather than a disconnected status message."
      }
    ],
    "control": null,
    "meta": [
      "TL or RO; assigned employee/collaborator",
      "Correct TL/RO mapping and active employees",
      "Scoped project with owner, team, priority, progress and status"
    ]
  },
  {
    "title": "08. Record and review field visits",
    "steps": [
      {
        "num": "01",
        "title": "Open My Visit",
        "copy": "Create the visit under the employee’s own login."
      },
      {
        "num": "02",
        "title": "Enter visit details",
        "copy": "Record date, purpose, location and required notes/evidence."
      },
      {
        "num": "03",
        "title": "Update while active",
        "copy": "Maintain status and permitted content before completion."
      },
      {
        "num": "04",
        "title": "Complete or cancel",
        "copy": "Use the correct final state; completed/cancelled visits are protected from ordinary editing."
      },
      {
        "num": "05",
        "title": "Mapped reviewer checks",
        "copy": "TL, RO, HR or Admin uses the authorised team filter and employee scope."
      }
    ],
    "control": null,
    "meta": [
      "Employee; mapped TL/RO/HR/Admin reviewer",
      "Active employee and required visit/location evidence",
      "Personal visit record with authorised mapped-team visibility"
    ]
  },
  {
    "title": "09. Run the recruitment pipeline",
    "steps": [
      {
        "num": "01",
        "title": "Create hiring request",
        "copy": "Document business reason, department, role, headcount, budget and final approver."
      },
      {
        "num": "02",
        "title": "Approve request",
        "copy": "Finance confirms budget where required; Admin/authorised MD gives final approval."
      },
      {
        "num": "03",
        "title": "Publish opening",
        "copy": "HR creates the vacancy and receives applications."
      },
      {
        "num": "04",
        "title": "Review candidates",
        "copy": "Structure resume information, screen and update application stage."
      },
      {
        "num": "05",
        "title": "Schedule interview",
        "copy": "Choose round, time, mode and interviewer panel; assign at least one role to each interviewer."
      },
      {
        "num": "06",
        "title": "Submit scorecards",
        "copy": "Interviewers record individual ratings and recommendation; human reviewers interpret results."
      },
      {
        "num": "07",
        "title": "Prepare offer",
        "copy": "Use approved designation, department, manager, location, employment, probation, joining and salary terms."
      },
      {
        "num": "08",
        "title": "Manage joining",
        "copy": "Review required documents and background-check status; record corrections or did-not-join if necessary."
      },
      {
        "num": "09",
        "title": "Convert",
        "copy": "Create the employee record from the candidate and approved offer, then finish account setup."
      }
    ],
    "control": "A resume match score, assistant response or interviewer recommendation supports, but does not replace, the authorised selection decision.",
    "meta": [
      "TL/HR/Admin/Finance/leadership/interview panel",
      "Masters, approver authority and hiring need",
      "Selected candidate converted to employee or closed with auditable outcome"
    ]
  },
  {
    "title": "10. Prepare, approve and disburse payroll",
    "steps": [
      {
        "num": "01",
        "title": "Select period and scope",
        "copy": "Choose all or selected active employees and review eligibility/skipped reasons."
      },
      {
        "num": "02",
        "title": "Synchronise attendance",
        "copy": "Bring current attendance/leave/LWP context into eligible employee payroll."
      },
      {
        "num": "03",
        "title": "Calculate Draft",
        "copy": "Apply structures, earnings, deductions, approved claims/recoveries and statutory context."
      },
      {
        "num": "04",
        "title": "HR Review",
        "copy": "Confirm employee, attendance, LWP, reimbursement and calculated results before sending onward."
      },
      {
        "num": "05",
        "title": "Finance approval",
        "copy": "Finance/Accounts Finance reviews and records approval."
      },
      {
        "num": "06",
        "title": "Lock",
        "copy": "Protect the approved payroll from ordinary edits."
      },
      {
        "num": "07",
        "title": "Record disbursement",
        "copy": "Use verified bank context and record salary payment; address any recovery/payment retry message."
      },
      {
        "num": "08",
        "title": "Release records",
        "copy": "Provide payslips and use Payroll Reports/exports for authorised follow-up."
      }
    ],
    "control": "An employee already in HR Review, Finance Approval, Locked or Disbursed status for the period may be blocked from repeated attendance sync or calculation.",
    "meta": [
      "HR/Admin; Finance/Accounts Finance",
      "Configured structures/rules, attendance, eligible employees, bank/tax data",
      "Locked and disbursed payroll with payslips and reports"
    ]
  },
  {
    "title": "11. Process loans, reimbursements, tax and banking",
    "steps": [
      {
        "num": "01",
        "title": "Maintain verified bank details",
        "copy": "Finance reviews employee bank data before payroll snapshots and salary files."
      },
      {
        "num": "02",
        "title": "Loan/advance request",
        "copy": "Employee or authorised user submits; the workflow records approval, disbursement and EMI recovery schedule."
      },
      {
        "num": "03",
        "title": "Reimbursement claim",
        "copy": "Employee submits category, amount and receipt; HR reviews and Finance approves/payment-schedules."
      },
      {
        "num": "04",
        "title": "Tax declaration",
        "copy": "Employee submits regime/declaration/proof context; HR/Finance reviews according to instruction mode."
      },
      {
        "num": "05",
        "title": "Include approved items in payroll",
        "copy": "Only items meeting workflow status and period rules affect calculation."
      },
      {
        "num": "06",
        "title": "Reconcile after disbursement",
        "copy": "Review recovery balances, reimbursement payment status, bank export and retry messages."
      }
    ],
    "control": "Never treat a submitted claim or declaration as payroll-ready until the required HR/Finance status is complete.",
    "meta": null
  },
  {
    "title": "12. Raise and resolve an IT support ticket",
    "steps": [
      {
        "num": "01",
        "title": "Raise ticket",
        "copy": "Choose category and priority; describe the issue once with relevant evidence."
      },
      {
        "num": "02",
        "title": "Tenant IT triage",
        "copy": "IT Department Head reviews and assigns/reassigns to self or a tenant IT member."
      },
      {
        "num": "03",
        "title": "Update progress",
        "copy": "Assigned IT member moves through Assigned, In Progress or Waiting for User and records work."
      },
      {
        "num": "04",
        "title": "Escalate only if major",
        "copy": "IT Head may escalate software, server, database, network/infrastructure, security or other major issues to Superadmin."
      },
      {
        "num": "05",
        "title": "Resolve and review",
        "copy": "IT records resolution; employee reviews and ticket is closed or reopened if genuinely unresolved."
      }
    ],
    "control": "Admin and HR may raise a ticket but do not become the tenant IT assignment desk merely because they are administrators.",
    "meta": [
      "Any login; tenant IT Head/member; Superadmin only on escalation",
      "Correct tenant IT Department and assignment responsibility",
      "Resolved/closed ticket with ownership, history and employee review"
    ]
  },
  {
    "title": "13. Submit and manage a grievance",
    "steps": [
      {
        "num": "01",
        "title": "Open Grievance",
        "copy": "Any login chooses a grievance type and priority and describes the concern."
      },
      {
        "num": "02",
        "title": "Choose identity treatment",
        "copy": "Use the anonymous option where appropriate; the HR/Admin frontend hides employee identity for an anonymous submission."
      },
      {
        "num": "03",
        "title": "Submit once",
        "copy": "Create the grievance and retain the request/status reference."
      },
      {
        "num": "04",
        "title": "HR/Admin review",
        "copy": "Authorised HR/Admin moves the record through Pending, Under Review, Resolved or Rejected."
      },
      {
        "num": "05",
        "title": "Employee follows status",
        "copy": "Use Application Status rather than creating duplicates."
      }
    ],
    "control": "Anonymous frontend display is a product behaviour, not a promise that no technical or legally required record can ever exist. The organisation must handle grievances confidentially.",
    "meta": null
  },
  {
    "title": "14. Publish notifications and policies",
    "steps": [
      {
        "num": "01",
        "title": "Choose communication type",
        "copy": "Use Notifications for timely messages and Policies for controlled documents."
      },
      {
        "num": "02",
        "title": "Select correct scope",
        "copy": "Tenant HR/Admin targets tenant, department, team or selected users; Superadmin targets all or one tenant."
      },
      {
        "num": "03",
        "title": "Prepare accessible content",
        "copy": "Use a clear title, plain language, relevant date and usable attachment."
      },
      {
        "num": "04",
        "title": "Publish",
        "copy": "Confirm the intended audience before sending or uploading."
      },
      {
        "num": "05",
        "title": "Verify delivery/access",
        "copy": "Check notification centre/bell/dashboard behaviour or employee policy download access."
      },
      {
        "num": "06",
        "title": "Replace outdated material",
        "copy": "Maintain one trusted current source and remove or clearly supersede obsolete instructions."
      }
    ],
    "control": null,
    "meta": null
  },
  {
    "title": "15. Purchase or renew through Razorpay",
    "steps": [
      {
        "num": "01",
        "title": "Open Billing",
        "copy": "Review current validity, alerts, available plan action and payment history."
      },
      {
        "num": "02",
        "title": "Choose plan or Premium quote",
        "copy": "Essential/Growth uses the live configured plan; Premium requires a released client-visible quotation."
      },
      {
        "num": "03",
        "title": "Create order",
        "copy": "YourComate creates the Razorpay order from the authoritative server-side amount."
      },
      {
        "num": "04",
        "title": "Complete checkout",
        "copy": "The payer uses the supported Razorpay method and finishes required bank/payment authentication."
      },
      {
        "num": "05",
        "title": "Verify response",
        "copy": "YourComate verifies order ID, payment ID and signature before activating access."
      },
      {
        "num": "06",
        "title": "Confirm subscription",
        "copy": "Review active plan, start/end date, employee limit and renewal source."
      },
      {
        "num": "07",
        "title": "Download invoice record",
        "copy": "Use the authorised Billing page for payment history and available PDF invoice."
      }
    ],
    "control": "Do not treat a bank debit, created order or Razorpay success screen alone as activation. Confirm the YourComate subscription status and invoice/payment record.",
    "meta": [
      "Organisation Admin / authorised payer; Platform Superadmin for pricing/quote",
      "Eligible paid plan or released Premium quotation",
      "Verified payment, active subscription and downloadable billing record"
    ]
  },
  {
    "title": "16. Use Saya responsibly",
    "steps": [
      {
        "num": "01",
        "title": "Open Saya inside HRMS",
        "copy": "Use the signed-in assistant, not the public website navigation helper."
      },
      {
        "num": "02",
        "title": "State the task",
        "copy": "Describe the intended attendance, leave, approval, project or supported HRMS action clearly."
      },
      {
        "num": "03",
        "title": "Review interpreted context",
        "copy": "Check user, role, date, leave type, project, handover, status or other shown fields."
      },
      {
        "num": "04",
        "title": "Correct before confirmation",
        "copy": "Change any misunderstood detail; do not confirm an uncertain material action."
      },
      {
        "num": "05",
        "title": "Allow role-aware routing",
        "copy": "Saya guides only within the user’s permission and workspace context."
      },
      {
        "num": "06",
        "title": "Verify final record",
        "copy": "Open the source module or Application Status and confirm the action was recorded correctly."
      }
    ],
    "control": "Saya assists navigation and understanding. Authorised humans remain responsible for approval, hiring, payroll, discipline and other consequential decisions.",
    "meta": null
  }
];

export default function ProductWalkthroughsPage() {
  useEffect(() => {
      document.documentElement.classList.add("yc-resource-page-active");
      document.body.classList.add("yc-resource-page-active");

      return () => {
        document.documentElement.classList.remove("yc-resource-page-active");
        document.body.classList.remove("yc-resource-page-active");
      };
    }, []);

  return (
    <main className="public-main yc-resource-document yc-resource-walkthrough-document">
      <PageHero
        eyebrow="Product walkthroughs"
        title="See the workflow"
        titleAccent="before you perform the action."
        description="Follow role-by-role sequences for trial activation, attendance, leave, projects, recruitment, payroll, support and Saya."
        icon="play"
        tone="violet"
        variant="resource-detail"
        secondary={["All Resources", "/resources"]}
      >
        <div className="yc-resource-hero-panel tone-violet">
          <span className="yc-resource-hero-panel-kicker">
            <Icon name="play" /> Guided workflow library
          </span>
          <h2>Know who acts, what comes next, and what to verify.</h2>
          <p>
            Each walkthrough keeps responsibility, prerequisites, sequence and
            final checks together so users can follow the live workflow cleanly.
          </p>
          <div className="yc-resource-hero-panel-links">
            <span>Role &amp; prerequisites</span>
            <span>Step-by-step action</span>
            <span>Outcome &amp; control</span>
          </div>
        </div>
      </PageHero>

      <section className="public-section yc-resource-document-section">
        <div className="page-width yc-resource-document-shell">
          <section className="yc-resource-glance">
            <header>
              <span className="public-kicker"><Icon name="play" /> Resource at a glance</span>
              <h2>Follow the implemented sequence, responsible role, prerequisites and expected result.</h2>
            </header>
            <div className="yc-resource-glance-grid">
              <article className="tone-cyan"><strong>Before starting</strong><p>Confirm tenant, role, capability mapping, masters and required source data.</p></article>
              <article className="tone-violet"><strong>During the flow</strong><p>Follow the status and use the same record rather than creating duplicate requests.</p></article>
              <article className="tone-mint"><strong>Before completion</strong><p>Review the final record, approvals and downstream impact before confirming a material action.</p></article>
            </div>
            <aside className="yc-resource-callout tone-violet">
              <strong>Verified basis</strong>
              <p>This resource is tailored to the supplied YourComate source code and implemented workflow language. It avoids presenting future or unverified capability as current behaviour.</p>
            </aside>
          </section>

          <nav className="yc-resource-jump-nav yc-resource-jump-nav-compact" aria-label="Walkthroughs">
            {workflows.map((workflow) => (
              <a key={workflow.title} href={`#walkthrough-${workflow.title.slice(0, 2)}`}>{workflow.title}</a>
            ))}
          </nav>

          <div className="yc-resource-workflows">
            {workflows.map((workflow, workflowIndex) => (
              <section
                className="yc-resource-workflow"
                id={`walkthrough-${workflow.title.slice(0, 2)}`}
                key={workflow.title}
              >
                <h2>{workflow.title}</h2>

                {workflow.meta && (
                  <div className="yc-resource-meta-table">
                    <article><small>Primary roles</small><p>{workflow.meta[0]}</p></article>
                    <article><small>Prerequisites</small><p>{workflow.meta[1]}</p></article>
                    <article><small>Outcome</small><p>{workflow.meta[2]}</p></article>
                  </div>
                )}

                <div className="yc-resource-step-list">
                  {workflow.steps.map((step) => (
                    <article key={`${workflow.title}-${step.num}`}>
                      <b>{step.num}</b>
                      <div><h3>{step.title}</h3><p>{step.copy}</p></div>
                    </article>
                  ))}
                </div>

                {workflow.control && (
                  <aside className={`yc-resource-callout tone-${workflowIndex % 3 === 0 ? "violet" : workflowIndex % 3 === 1 ? "amber" : "cyan"}`}>
                    <strong>Control</strong>
                    <p>{workflow.control}</p>
                  </aside>
                )}
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
