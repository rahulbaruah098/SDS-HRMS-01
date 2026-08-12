import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Everyday operations",
  title: "Leave & Holiday Workflows",
  purpose: "The leave workspace lets employees submit a structured request, review available Casual and Earned Leave, record handover information and follow the approval path. Holiday calendars, holiday work approval and Comp-Off credits are connected so that exceptional work and compensatory leave remain traceable.",
  icon: "calendar",
  tone: "mint",
  heroHeading: "Leave, holiday work and Comp-Off connected end to end.",
  heroPillars: [
  "Leave balances",
  "Handover details",
  "Approval routing",
  "Holiday work & Comp-Off"
],
  covers: [
  "Casual Leave, Earned Leave, Half Day and Comp-Off requests.",
  "Available CL and EL balance visibility before submission.",
  "From/to dates, full-day or half-day selection and required reason.",
  "Project and task handover fields for continuity of work.",
  "Role-based approval routing and Application Status history.",
  "State-wise holiday calendar, prior holiday work approval and generated Comp-Off selection."
],
  users: [
  "Employees submit leave and monitor the request status.",
  "Mapped Team Leaders and Reporting Officers review requests at their authorised stages.",
  "HR/Admin reviews final or administrative stages and manages CL/EL balances and holiday records.",
  "If an HR user applies, the supplied screen routes the request to Admin; an Admin request routes to HR."
],
  workflow: [
  "Review available CL/EL balance and select the leave type.",
  "Choose the date range or Half Day and enter the reason.",
  "Add assigned project, project handover or task handover information where applicable.",
  "Submit once and note the displayed approver path.",
  "The request moves through the mapped TL, RO and HR/Admin stages that apply to the employee.",
  "After final approval, the employee reviews status and the system applies the authorised leave record or balance effect."
],
  rules: [
  "Employee-selectable leave types are CL, EL, HALF-DAY and COMP-OFF.",
  "HR/Admin balance assignment covers Casual Leave and Earned Leave.",
  "Comp-Off must be selected from available approved holiday-work credits.",
  "A Half Day is constrained to a single date in the supplied form.",
  "Approval stages and decision history are visible through Team Approvals, reports and Application Status."
],
  modules: [
  "Attendance and holiday work create the context for Comp-Off.",
  "Employee Management supplies reporting mappings and state.",
  "Projects and employee records supply handover options.",
  "Reports and payroll use approved leave and LWP context."
],
  controls: [
  "Select Comp-Off only from a valid available credit.",
  "Do not submit overlapping or duplicate requests.",
  "Enter complete handover information before a planned absence.",
  "Approvers should use the live stage and history instead of informal messages as the final record.",
  "Leave balance should change only through the authorised final approval process.",
  "Holiday work must be approved before attendance; attendance alone should not create an unauthorised entitlement."
],
  checklist: [
  "Confirm leave type and balance.",
  "Confirm dates and day type.",
  "Confirm reason and work handover.",
  "Confirm reporting mappings and displayed approval path.",
  "Review Application Status before retrying a submission.",
  "Reconcile approved leave before payroll processing."
],
  notes: [
  "Comp-Off becomes claimable from the next working day and remains claimable within 7 working days under the supplied implementation.",
  "Final business policy, entitlement rules and exceptional approval authority remain the Customer's responsibility.",
  "The live screen and configured workflow determine the exact stages for a particular user."
],
  basis: "This guide reflects the supplied YourComate project implementation. Actual availability depends on the Customer tenant, plan, logged-in role, employee capability mappings and live configuration. Verified against: frontend/src/data/modules.js; frontend/src/pages/ApplyLeave.jsx; frontend/src/pages/Leave.jsx; frontend/src/pages/HolidayCalendar.jsx; frontend/src/pages/HolidayWorkRequests.jsx.",
};

export default function LeaveHolidayWorkflowsPage() {
  return <FeatureGuideLayout {...page} />;
}
