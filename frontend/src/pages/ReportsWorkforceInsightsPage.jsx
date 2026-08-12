import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Service & intelligence",
  title: "Reports & Workforce Insights",
  purpose: "YourComate reports turn saved workforce activity into operational review views for authorised roles. The dedicated Reports page focuses on attendance, field work, holidays, Comp-Off, leave and audit data, while project and payroll modules provide their own specialised metrics and reporting.",
  icon: "chart",
  tone: "cyan",
  heroHeading: "Turn saved workforce activity into authorised operational review views.",
  heroPillars: [
  "Attendance & field data",
  "Leave & Comp-Off",
  "Audit visibility",
  "Filtered exports"
],
  covers: [
  "Attendance and field-attendance records with time, mode, status, location and photo context where available.",
  "Holiday-work requests, holiday calendar, Comp-Off credits, claims and expired credits.",
  "Leave balances, requests, approvals, deductions and records.",
  "Audit-log reporting for authorised operational review.",
  "Filters by organisation/entity, state, employee, date, mode, status, leave type and approval stage.",
  "Attendance register Excel download plus displayed report data and summary counts."
],
  users: [
  "The core Reports module is assigned to HR roles in the supplied module definition.",
  "Other modules, including Projects, Payroll Reports and Assets, apply their own reporting role sets.",
  "Employees use self-service records rather than unrestricted workforce reporting.",
  "All reporting remains tenant scoped unless a separate Platform Superadmin function explicitly states otherwise."
],
  workflow: [
  "Operational modules capture employee, attendance, request, approval and audit records.",
  "An authorised user opens the relevant report tab.",
  "The user selects the period, entity, state, employee, status or other applicable filters.",
  "The report loads summary counts and matching record detail.",
  "The reviewer investigates exceptions such as late, early checkout, pending stages, expired Comp-Off or unreconciled leave.",
  "The user exports supported data and records authorised follow-up in the source workflow."
],
  rules: [
  "Dedicated tabs: Attendance, Field Attendance, Holiday Work, Holiday Calendar, Comp-Off Credits, Comp-Off Claims and Expired Comp-Off.",
  "Additional tabs: Leave Balances, Leave Requests, Leave Approvals, Leave Deductions, Leave Records and Audit Logs.",
  "Attendance modes include Office, Work From Home and Field.",
  "Approval-stage filters include Team Leader, Reporting Officer, HR, Approved and Rejected, with live pending-stage filters.",
  "Time filters support day, week, month, year and custom date ranges where shown."
],
  modules: [
  "Attendance and Holiday Work provide presence, field and Comp-Off data.",
  "Leave and Team Approvals provide balance, request, decision and deduction data.",
  "Projects dashboards provide project status, progress and workload insights outside the core Reports tabs.",
  "Payroll Reports provides separate registers, statutory, department, variance, trend and CSV outputs."
],
  controls: [
  "Apply the correct tenant, period and employee scope before interpreting totals.",
  "Use source records to investigate an exception; a summary is not the complete audit trail.",
  "Do not expose field photos, location or employee data to unauthorised recipients.",
  "Treat filters and status labels consistently across repeated reporting periods.",
  "Export only the fields required for the authorised purpose.",
  "Reconcile attendance and leave reports before payroll processing."
],
  checklist: [
  "Confirm role and reporting purpose.",
  "Confirm entity, state, employee and period.",
  "Confirm status, mode, leave type and approval-stage filters.",
  "Review summary and underlying detail together.",
  "Investigate exceptions in the source module.",
  "Protect, retain and dispose of exports according to Customer policy."
],
  notes: [
  "Report accuracy depends on complete and correct source records.",
  "Project, payroll and asset reporting are not all contained in the core Reports page; their modules provide specialised views.",
  "The live role and tenant configuration determine which reports and exports are available."
],
  basis: "This guide reflects the supplied YourComate project implementation. Actual availability depends on the Customer tenant, plan, logged-in role, employee capability mappings and live configuration. Verified against: frontend/src/data/modules.js; frontend/src/pages/Reports.jsx; frontend/src/pages/Projects.jsx; frontend/src/pages/PayrollReports.jsx.",
};

export default function ReportsWorkforceInsightsPage() {
  return <FeatureGuideLayout {...page} />;
}
