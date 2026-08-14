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
};

export default function ApprovalsRequestsPage() {
  return <FeatureGuideLayout {...page} />;
}
