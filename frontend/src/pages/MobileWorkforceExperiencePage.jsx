import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Service & intelligence",
  title: "Mobile Workforce Experience",
  purpose: "The supplied YourComate frontend provides responsive web screens intended to support routine workforce actions on smaller devices. Employees can use role-specific navigation for attendance, leave, projects, requests, support and salary information while working in an office or field context.",
  icon: "mobile",
  tone: "mint",
  heroHeading: "The same role-aware YourComate workflows across smaller screens.",
  heroPillars: [
  "Responsive dashboards",
  "Field actions",
  "Requests & records",
  "Same role controls"
],
  covers: [
  "Responsive dashboards and role-based navigation for smaller screens.",
  "Office, WFH and field attendance actions, including supported location and photo capture.",
  "Leave applications, balances, handover and status review.",
  "Assigned project access and permitted progress/status updates.",
  "IT support, policies, notifications, profile and payslip access.",
  "The same tenant and role controls used by the web platform."
],
  users: [
  "Employees see employee-scoped actions and records.",
  "Mapped TL/RO employees receive capability-based team and approval views where the responsive screen supports them.",
  "HR/Admin and Finance use broader role-specific screens only when authorised.",
  "Mobile layout does not change the underlying permission or approval rules."
],
  workflow: [
  "Open the YourComate web experience in a supported mobile browser.",
  "Sign in to the correct Customer tenant and allow only the permissions required for the selected action.",
  "Use the role-specific menu or dashboard to open attendance, leave, projects, support or another permitted module.",
  "Complete the form, capture required field evidence and review the information before submission.",
  "The request or update is saved to the same platform workflow and follows the same approval rules.",
  "Review the resulting status and use the appropriate support route if the action fails."
],
  rules: [
  "Responsive styles exist across the main layout, dashboards, notifications and multiple operational pages.",
  "Field attendance can carry place, photo and location data when permission is granted and the workflow requires it.",
  "Payslip pages support responsive mobile and desktop reading plus PDF preview/download.",
  "Status remains connected to the platform record rather than a separate mobile-only record.",
  "The public product definition describes a mobile-ready workforce experience, not a different permission model."
],
  modules: [
  "Employee self-service supplies the main personal workflows.",
  "Attendance and My Visits support field work.",
  "Leave, Approvals, Projects and IT Support provide operational actions.",
  "Notifications, Policies, Profile and Payslips provide communication and records."
],
};

export default function MobileWorkforceExperiencePage() {
  return <FeatureGuideLayout {...page} />;
}
