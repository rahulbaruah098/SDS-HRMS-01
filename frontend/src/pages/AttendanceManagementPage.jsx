import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Everyday operations",
  title: "Attendance Management",
  purpose: "YourComate attendance supports office, work-from-home and field work while recording check-in, check-out, worked-time context and operational exceptions. Field attendance can include location and photo evidence, and holiday attendance is controlled through prior approval and Comp-Off rules.",
  icon: "attendance",
  tone: "cyan",
  heroHeading: "Office, work-from-home and field attendance in one traceable workflow.",
  heroPillars: [
  "Office, WFH & field",
  "Worked-time context",
  "Field evidence",
  "Holiday work & Comp-Off"
],
  covers: [
  "Office, WFH and Field attendance modes.",
  "Check-in and check-out timestamps with worked-time and attendance status.",
  "Field place, photo and location/map context where captured.",
  "Late entry and early checkout reasons and visibility.",
  "Team field tracking and HR/Admin attendance views.",
  "Holiday work request, approved holiday attendance and generated Comp-Off credit."
],
  users: [
  "Employees mark attendance and view their own records within the allowed modes.",
  "Team Leaders and Reporting Officers can review mapped team field or attendance context where authorised.",
  "HR/Admin can monitor attendance records, exceptions, holiday work and Comp-Off information.",
  "Access is tenant-scoped and affected by employee status, role and attendance configuration."
],
  workflow: [
  "The employee selects the permitted work mode and checks in.",
  "For field work, the employee records the visit place and required photo/location evidence.",
  "The system stores time and status context; late or exceptional records may require a reason.",
  "The employee checks out to complete the attendance record and worked-time calculation.",
  "Authorised roles review exceptions, team field information and attendance summaries.",
  "Reports and payroll attendance synchronisation use the saved attendance and approved leave context."
],
  rules: [
  "Attendance statuses include Present, Late, Early Checkout and Holiday Work in the supplied filters.",
  "Records may contain check-in/check-out locations, field location, field photo, late reason and early checkout reason.",
  "Holiday work applies to Sunday, second Saturday, fourth Saturday or HR-created holidays under the supplied rule.",
  "Holiday work approval must exist before attendance is marked.",
  "After approved holiday attendance and checkout, one Comp-Off credit is generated."
],
  modules: [
  "Employee and state masters identify the worker and relevant holiday calendar.",
  "Team Approvals routes holiday work and applicable attendance-mode decisions.",
  "Leave uses generated Comp-Off credits.",
  "Reports and payroll consume attendance, approved leave and LWP context."
],
  controls: [
  "Do not mark holiday attendance without an approved holiday work request.",
  "Capture field place, photo and location truthfully where the workflow requires them.",
  "Provide a meaningful reason for late entry or early checkout.",
  "Check-out is required to complete the attendance and holiday credit sequence.",
  "Do not manually duplicate a Comp-Off credit created by the system.",
  "Use correction or review processes rather than editing records outside the authorised workflow."
],
  checklist: [
  "Confirm employee, state and work schedule configuration.",
  "Confirm allowed attendance modes.",
  "Confirm browser/device permission for field location and photo where needed.",
  "Confirm holiday calendar and weekend rules.",
  "Confirm TL/RO mappings for team review.",
  "Reconcile exceptions before payroll attendance synchronisation."
],
  notes: [
  "Comp-Off can be claimed from the next working day within 7 working days after it is generated.",
  "The exact action shown to a user depends on the live role, employee profile and configured attendance rules.",
  "Location and photo evidence should be processed according to the Customer's privacy and retention requirements."
],
  basis: "This guide reflects the supplied YourComate project implementation. Actual availability depends on the Customer tenant, plan, logged-in role, employee capability mappings and live configuration. Verified against: frontend/src/data/modules.js; frontend/src/pages/Attendance.jsx; frontend/src/pages/HolidayWorkRequests.jsx; frontend/src/pages/AttendanceLogs.jsx.",
};

export default function AttendanceManagementPage() {
  return <FeatureGuideLayout {...page} />;
}
