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
};

export default function EmployeeSelfServicePage() {
  return <FeatureGuideLayout {...page} />;
}
