import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Everyday operations",
  title: "Approvals & Requests",
  purpose: "YourComate routes decisions through role-based queues and preserves the live approval stage, decision and history. The dedicated Team Approvals implementation focuses on leave and holiday-work requests, while Application Status gives employees a wider view of their submitted HR and service requests.",
  icon: "approval",
  tone: "amber",
  heroHeading: "Live decision stages, mapped approvers and traceable request history.",
  heroPillars: [
  "Approval queues",
  "Mapped stages",
  "Decision history",
  "Application Status"
],
  covers: [
  "Team approval inbox for leave and holiday-work requests.",
  "Mapped Team Leader, Reporting Officer and HR/Admin decision stages.",
  "Live status, current stage and approval history.",
  "Request context including employee, dates, reason, field/work location and proof where applicable.",
  "Employee status visibility after submission.",
  "Application Status coverage for leave, holiday work, password, grievance, IT support and Comp-Off requests."
],
  users: [
  "Employees submit requests and follow status; they do not approve their own ordinary request.",
  "Team Leaders and Reporting Officers decide only the requests mapped to their stage and scope.",
  "HR/Admin handles the authorised HR stage and tenant administration.",
  "Admin/HR may submit requests themselves, but routing changes to avoid self-approval as shown in the leave workflow."
],
  workflow: [
  "The employee completes the relevant request form and submits once.",
  "The system determines the current stage from employee mappings, request type and role rules.",
  "The authorised approver reviews the request details and supporting context.",
  "The approver records approval or rejection with the available decision information.",
  "If another stage applies, the request moves forward; otherwise the final status is recorded.",
  "The employee checks Application Status or the source module instead of relying on disconnected messages."
],
  rules: [
  "Common final states are Approved and Rejected; pending states identify the current responsible stage.",
  "Live stages can include Team Leader, Reporting Officer and HR.",
  "The supplied reports distinguish Pending with Team Leader, Pending with Reporting Officer and Pending with HR.",
  "Decision history should identify the stage and authorised decision record.",
  "IT support and grievance have their own assignment/status workflows even though their status is visible to the employee."
],
  modules: [
  "Leave and Holiday Work Requests create approval items.",
  "Employee mappings determine TL/RO routing.",
  "Application Status consolidates employee-facing request visibility.",
  "Reports provide stage, final status and history views for authorised roles."
],
  controls: [
  "Do not decide a request outside the stage assigned to the logged-in user.",
  "Review dates, reason, balance, location and proof before making a decision.",
  "Avoid duplicate submissions while a matching request is pending.",
  "Do not treat a message or verbal approval as the system's final status.",
  "Keep TL/RO mappings current so requests do not route to the wrong person.",
  "Use rejection or correction information that allows the employee to understand the result."
],
  checklist: [
  "Confirm requester and tenant.",
  "Confirm request type and required evidence.",
  "Confirm current stage and approver authority.",
  "Check history for a prior decision or duplicate.",
  "Record the decision in the correct module.",
  "Verify the employee can see the updated status."
],
  notes: [
  "Not every request uses one identical approval chain; the live mapped stage controls the actual route.",
  "Team Approvals is not a general unrestricted approval editor in the supplied implementation.",
  "Availability depends on role, capability mapping, tenant and configuration."
],
  basis: "This guide reflects the supplied YourComate project implementation. Actual availability depends on the Customer tenant, plan, logged-in role, employee capability mappings and live configuration. Verified against: frontend/src/data/modules.js; frontend/src/pages/TeamApprovals.jsx; frontend/src/pages/ApplicationStatus.jsx; frontend/src/pages/ApplyLeave.jsx.",
};

export default function ApprovalsRequestsPage() {
  return <FeatureGuideLayout {...page} />;
}
