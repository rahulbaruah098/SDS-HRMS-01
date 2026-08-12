export const productGroups = [
  {
    title: "People foundation",
    tone: "violet",
    links: [
      ["Core HR & employee records", "/product/core-hr", "people"],
      ["Employee self-service", "/product/employee-self-service", "mobile"],
      ["Policies & documents", "/product/policies", "document"],
      ["Assets & workforce records", "/product/assets", "briefcase"],
    ],
  },
  {
    title: "Everyday operations",
    tone: "cyan",
    links: [
      ["Attendance management", "/product/attendance", "attendance"],
      ["Leave & holiday workflows", "/product/leave", "calendar"],
      ["Projects & team delivery", "/product/projects", "project"],
      ["Approvals & requests", "/product/approvals", "approval"],
    ],
  },
  {
    title: "Talent, payroll & assistance",
    tone: "amber",
    links: [
      ["Recruitment & candidate pipeline", "/product/recruitment", "recruitment"],
      ["Payroll processing", "/product/payroll", "payroll"],
      ["Payslips & salary access", "/product/payslip", "payslip"],
      ["Saya AI assistant", "/saya", "sparkle"],
    ],
  },
  {
    title: "Service & intelligence",
    tone: "coral",
    links: [
      ["IT support & helpdesk", "/product/helpdesk", "support"],
      ["Reports & workforce insights", "/product/reports", "chart"],
      ["Mobile workforce experience", "/product/mobile", "mobile"],
    ],
  },
];

export const navigationMenus = [
  {
    key: "product",
    label: "Features",
    featured: {
      eyebrow: "YourComate platform",
      title: "One connected HR workspace",
      copy: "Bring people records, attendance, leave, projects, recruitment, payroll, payslips, approvals, support and Saya into one role-based operating system.",
      href: "/product",
      linkLabel: "Explore the platform",
    },
    groups: productGroups,
  },
  {
    key: "resources",
    label: "Resources",
    featured: {
      eyebrow: "HR knowledge centre",
      title: "Practical resources for better HR operations",
      copy: "Explore product guides, workflow explainers, FAQs and implementation resources.",
      href: "/resources",
      linkLabel: "Browse resources",
    },
    groups: [
      {
        title: "Learn & explore",
        tone: "amber",
        links: [
          ["HRMS guides", "/resources/hrms-guide", "book"],
          ["Product walkthroughs", "/resources/product-walkthroughs", "play"],
          ["Frequently asked questions", "/resources/frequently-asked-questions", "help"],
        ],
      },
    ],
  },
  {
    key: "company",
    label: "Company",
    featured: {
      eyebrow: "About YourComate",
      title: "HR technology shaped by real operating work",
      copy: "See the principles, working approach and team culture behind a clearer employee and HR experience.",
      href: "/about",
      linkLabel: "About YourComate",
    },
    groups: [
      {
        title: "Company",
        tone: "violet",
        links: [
          ["About YourComate", "/about", "building"],
          ["About Sayanant Group", "/about-sayanant", "people"],
          ["Security", "/security", "shield"],
          ["Contact", "/contact", "email"],
        ],
      },
    ],
  },
];

export const featurePages = {
  "core-hr": {
    icon: "people",
    tone: "violet",
    eyebrow: "People foundation",
    title: "A dependable source of truth for every employee record.",
    description:
      "Organise employee profiles, reporting lines, departments, designations, documents and role access in a structured people directory.",
    highlights: [
      "Employee profile and lifecycle records",
      "Department, designation and reporting hierarchy",
      "Role-based visibility and permissions",
      "Active employee and organisation views",
      "Document and policy access",
      "Responsive employee directory",
    ],
    workflow: ["Create or onboard employee", "Assign role and reporting line", "Maintain records", "Use data across workflows"],
  },
  attendance: {
    icon: "attendance",
    tone: "cyan",
    eyebrow: "Attendance management",
    title: "Attendance designed for office, remote and field teams.",
    description:
      "Capture everyday presence, worked time and attendance status while giving employees and authorised managers the right level of visibility.",
    highlights: [
      "Office and work-from-home attendance",
      "Field employee attendance workflows",
      "Worked-time visibility",
      "Monthly attendance summaries",
      "Late and checkout alerts",
      "Admin and employee attendance views",
    ],
    workflow: ["Employee checks in", "Worked time is recorded", "Exceptions are reviewed", "Monthly status is reported"],
  },
  leave: {
    icon: "calendar",
    tone: "mint",
    eyebrow: "Leave & holidays",
    title: "Clear leave decisions without disconnected messages.",
    description:
      "Let employees apply, managers review, and HR maintain holidays and application status through one controlled workflow.",
    highlights: [
      "Employee leave applications",
      "Manager and team approval views",
      "Application status tracking",
      "Holiday calendar",
      "My Requests history",
      "Past-date and policy controls",
    ],
    workflow: ["Employee applies", "Approver reviews", "Status is updated", "Calendar and records stay aligned"],
  },
  projects: {
    icon: "project",
    tone: "coral",
    eyebrow: "Projects & delivery",
    title: "Connect ownership, collaborators and progress.",
    description:
      "Assign projects, add collaborators and let authorised team members update delivery status with clear manager oversight.",
    highlights: [
      "Project assignment and ownership",
      "Collaborator management",
      "Status and progress updates",
      "Team and manager visibility",
      "Assigned employee dashboards",
      "Role-controlled project actions",
    ],
    workflow: ["Create a project", "Assign owner and collaborators", "Update status", "Review delivery health"],
  },
  "employee-self-service": {
    icon: "mobile",
    tone: "amber",
    eyebrow: "Employee self-service",
    title: "Give employees direct access to everyday HR work.",
    description:
      "Employees can access attendance, leave, projects, policies, support and personal records without depending on HR for every routine action.",
    highlights: [
      "Personal dashboard and records",
      "Attendance and worked-time access",
      "Leave applications and history",
      "Projects and task visibility",
      "Policies and support access",
      "Responsive web and mobile experience",
    ],
    workflow: ["Employee signs in", "Dashboard shows relevant actions", "Requests follow role workflow", "Status remains visible"],
  },
  policies: {
    icon: "document",
    tone: "violet",
    eyebrow: "Policies & documents",
    title: "Publish important workplace information in one trusted place.",
    description:
      "Make policies and employee-facing documents available through controlled, role-appropriate access.",
    highlights: ["Central policy library", "Role-aware access", "Clear document categories", "Employee self-service", "Responsive reading experience", "Administrative publishing controls"],
    workflow: ["Admin publishes", "Access is assigned", "Employees view", "Updates remain centralised"],
  },
  assets: {
    icon: "briefcase",
    tone: "mint",
    eyebrow: "Assets & records",
    title: "Keep employee asset visibility connected to people records.",
    description:
      "Maintain clearer accountability for assigned workplace assets and related employee information.",
    highlights: ["Employee asset visibility", "Assignment records", "Administrative control", "Role-based access", "Searchable information", "Connected employee profiles"],
    workflow: ["Record an asset", "Assign to employee", "Track status", "Update or return"],
  },
  approvals: {
    icon: "approval",
    tone: "amber",
    eyebrow: "Approvals & requests",
    title: "Route decisions to the right people with context.",
    description:
      "Keep leave, support and internal requests visible from submission through review and final status.",
    highlights: ["Role-based approval queues", "Request status visibility", "Manager decision views", "Employee application history", "Consistent workflow states", "Responsive approval screens"],
    workflow: ["Request submitted", "Authorised role reviews", "Decision recorded", "Employee sees status"],
  },
  helpdesk: {
    icon: "support",
    tone: "coral",
    eyebrow: "IT support & helpdesk",
    title: "Give internal support requests a clear owner and status.",
    description:
      "Employees raise tickets while support teams assign, reassign, manage and close requests from focused views.",
    highlights: ["Employee ticket submission", "My IT Tickets view", "Support team assignment", "Reassignment workflow", "Status tracking", "Role-restricted management tools"],
    workflow: ["Employee raises ticket", "Support assigns owner", "Progress is updated", "Ticket is resolved"],
  },
  reports: {
    icon: "chart",
    tone: "cyan",
    eyebrow: "Reports & insights",
    title: "Turn workforce activity into useful operational visibility.",
    description:
      "Give authorised roles clear attendance, project, employee and workflow information without forcing teams into disconnected files.",
    highlights: ["Attendance summaries", "Employee status views", "Project progress visibility", "Approval queue counts", "Role-based reporting", "Dashboard metrics"],
    workflow: ["Operational data is captured", "Dashboards summarise", "Authorised users review", "Teams act on exceptions"],
  },
  recruitment: {
    icon: "recruitment",
    tone: "mint",
    eyebrow: "Recruitment & hiring",
    title: "Move every candidate from opening to offer through one clear pipeline.",
    description:
      "Create job openings, collect and organise applications, parse candidate resumes, schedule interviews, record evaluations and hand selected candidates into onboarding without disconnected trackers.",
    highlights: [
      "Job opening and vacancy management",
      "Candidate profiles and resume collection",
      "Resume parsing and structured candidate information",
      "Screening, stage and application status tracking",
      "Interview scheduling and evaluation records",
      "Offer, selection and onboarding handoff",
    ],
    workflow: [
      "Create and publish an opening",
      "Receive and screen candidates",
      "Schedule interviews and record evaluations",
      "Select the candidate and begin onboarding",
    ],
  },
  payroll: {
    icon: "payroll",
    tone: "cyan",
    eyebrow: "Payroll processing",
    title: "Run dependable payroll from connected employee and attendance inputs.",
    description:
      "Bring salary structures, payable days, approved deductions, statutory components and review steps into one controlled monthly workflow.",
    highlights: [
      "Salary structure and revision support",
      "Attendance and leave input visibility",
      "Earnings and deduction calculation",
      "Payroll review and approval stages",
      "Banking and statutory reporting support",
      "Responsive finance and HR workspaces",
    ],
    workflow: [
      "Prepare payroll inputs",
      "Review attendance and deductions",
      "Calculate and approve payroll",
      "Release salary records",
    ],
  },
  payslip: {
    icon: "payslip",
    tone: "amber",
    eyebrow: "Payslips & salary access",
    title: "Give employees a clear, secure view of every approved salary period.",
    description:
      "Generate structured payslips with earnings, deductions, payable days and employer information, then make them available through role-controlled employee access.",
    highlights: [
      "Structured earnings and deduction details",
      "Payable-day and leave-without-pay visibility",
      "Approved payroll-period records",
      "Employee self-service payslip access",
      "Preview and downloadable document support",
      "Responsive mobile and desktop reading",
    ],
    workflow: [
      "Payroll period is approved",
      "Payslip is generated",
      "Employee receives secure access",
      "Salary record remains available",
    ],
  },
  mobile: {
    icon: "mobile",
    tone: "violet",
    eyebrow: "Mobile workforce",
    title: "A focused HR experience that travels with the employee.",
    description:
      "Support office and field workflows through responsive screens designed for fast everyday actions on smaller devices.",
    highlights: ["Mobile-ready dashboards", "Field attendance workflows", "Leave and request access", "Project status updates", "Support ticket access", "Role-based navigation"],
    workflow: ["Open the mobile experience", "See role-specific actions", "Complete work", "Status syncs with the platform"],
  },
};

export const resourceCards = [
  {
    slug: "hrms-rollout-guide",
    type: "Guide",
    title: "How to plan a practical HRMS rollout",
    copy: "A clear sequence for preparing people data, permissions, workflows and employee communication.",
    icon: "book",
    tone: "violet",
    sections: [
      ["Start with workflow clarity", "Document the employee, manager and HR actions that currently create delay, duplication or confusion."],
      ["Prepare dependable people data", "Review employee records, departments, designations, reporting lines and active-status information before migration."],
      ["Define roles and permissions", "Agree which roles can view, create, approve, assign, report and administer each workflow."],
      ["Launch in controlled phases", "Pilot priority modules, collect feedback, correct issues and then expand adoption with clear communication."],
    ],
  },
  {
    slug: "attendance-checklist",
    type: "Checklist",
    title: "Attendance implementation checklist",
    copy: "Review policies, work modes, late rules, reporting needs and employee guidance before launch.",
    icon: "checklist",
    tone: "cyan",
    sections: [
      ["Work modes", "Confirm office, work-from-home, field and offline attendance scenarios that the organisation must support."],
      ["Rules and exceptions", "Document working hours, late thresholds, checkout expectations and exception-review responsibilities."],
      ["Employee communication", "Prepare clear guidance for check-in, status review, mobile use and support escalation."],
      ["Reporting", "Agree the monthly denominator, status definitions and role-specific attendance views before rollout."],
    ],
  },
];
