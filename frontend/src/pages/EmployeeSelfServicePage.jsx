import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "People foundation",
  title: "Employee Self-Service",
  purpose: "Employee self-service gives each signed-in employee direct access to routine HR work without requiring HR to perform every action. The employee dashboard, profile and permitted modules bring attendance, leave, projects, requests, documents, support and salary records into one role-aware experience.",
  icon: "mobile",
  tone: "amber",
  heroHeading: "Routine HR work, directly in the employee's hands.",
  heroPillars: [
  "Personal dashboard",
  "Attendance & leave",
  "Projects & requests",
  "Policies, payslips & support"
],
  covers: [
  "A personal dashboard with role-relevant summaries and actions.",
  "Office, work-from-home and field attendance access, including worked-time and status visibility.",
  "Leave application, available Casual/Earned Leave balances, handover details and request history.",
  "Assigned project visibility and permitted progress or status updates.",
  "Tenant policy downloads, IT support tickets, grievance submission and asset records.",
  "Payslip preview/download, profile photo management and secure password change."
],
  users: [
  "The ordinary employee sees personal and employee-scoped information rather than unrestricted tenant records.",
  "A mapped Team Leader or Reporting Officer remains an employee login and receives added capability-based views.",
  "HR/Admin and Finance may see broader records only inside their authorised modules.",
  "Every view remains restricted to the current Customer tenant and the user's effective role."
],
  workflow: [
  "The employee signs in with the account connected to the active employee record.",
  "The dashboard loads employee identity, current status, reporting context and permitted actions.",
  "The employee opens the required module, such as attendance, leave, projects, policies or support.",
  "A submitted request follows its configured approval or assignment path.",
  "The employee monitors progress through the relevant module or Application Status.",
  "Completed records remain available according to role, tenant and retention rules."
],
  rules: [
  "Application Status can show leave, holiday work, password, grievance, IT support and Comp-Off request progress.",
  "Notifications appear through the notification bell, notification centre and supported dashboard notices.",
  "The employee directory provides permitted tenant contact information.",
  "Profile access supports profile photo and password management.",
  "Payslip access is connected to employee identity and payroll period."
],
  modules: [
  "Employee Management supplies identity, role, department, designation and reporting mappings.",
  "Attendance and Leave supply everyday personal records.",
  "Projects and approvals use employee and manager scope.",
  "Policies, IT Support, Assets, Grievance and Payslips supply employee service records."
],
  controls: [
  "Employees should use only their own credentials and keep passwords confidential.",
  "A submission should be checked before confirmation because it creates an operational record.",
  "Status should be reviewed before submitting duplicate leave, support or grievance requests.",
  "Sensitive screenshots, passwords, OTPs and banking secrets should not be added to ordinary support text.",
  "TL/RO actions appear only when the employee has the required capability and mappings.",
  "Access may vary by tenant plan, role and live configuration."
],
  checklist: [
  "Confirm the employee account is linked to the correct active profile.",
  "Confirm reporting relationships and department are current.",
  "Explain attendance, leave and request status workflows during onboarding.",
  "Explain where policies, payslips and support records are found.",
  "Test the main actions at desktop and mobile widths.",
  "Provide a clear route for access, data or workflow corrections."
],
  notes: [
  "Self-service does not remove approval controls; it gives employees a direct and traceable way to initiate and monitor work.",
  "The authorised screen is the source of truth for actions currently available to a particular employee.",
  "Responsive access is part of the supplied web experience; native app scope is addressed separately in the Mobile Workforce guide."
],
  basis: "This guide reflects the supplied YourComate project implementation. Actual availability depends on the Customer tenant, plan, logged-in role, employee capability mappings and live configuration. Verified against: frontend/src/data/publicSiteData.js; frontend/src/data/modules.js; frontend/src/pages/EmployeeDashboard.jsx; frontend/src/pages/Profile.jsx.",
};

export default function EmployeeSelfServicePage() {
  return <FeatureGuideLayout {...page} />;
}
