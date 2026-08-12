import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Talent, payroll & assistance",
  title: "Payslips & Salary Access",
  purpose: "The Payslips module gives employees secure access to generated payroll-period records and gives authorised HR/Finance users broader search and review tools. Each record connects employee and period information to earnings, deductions, attendance/LWP, tax, banking and disbursement context.",
  icon: "payslip",
  tone: "cyan",
  heroHeading: "Secure salary-period records for employees and authorised payroll teams.",
  heroPillars: [
  "Employee self-service",
  "Salary components",
  "Period & status filters",
  "PDF preview & download"
],
  covers: [
  "Employee self-service view of the employee's own generated salary records.",
  "Privileged period, employee, status and search filters.",
  "Earnings, deductions, gross, net pay and payable-day information.",
  "Leave Without Pay, reimbursement, loan recovery and tax snapshots where present.",
  "Bank and transfer details recorded for the payroll period.",
  "PDF preview and download using employee and payroll period references."
],
  users: [
  "Employees access their own authorised payslips rather than a tenant-wide employee list.",
  "Superadmin, Admin, HR roles, Finance and Accounts Finance are treated as privileged in the supplied page.",
  "Privileged access remains tenant and role controlled.",
  "Payslip generation is a payroll output; employees do not approve or alter payroll from this page."
],
  workflow: [
  "Payroll is calculated and progresses through the authorised monthly states.",
  "The system creates or updates the employee's payslip record for the period.",
  "The user selects the relevant period and, for privileged roles, optional employee and status filters.",
  "The list shows matching payslips and summary amounts or stage information.",
  "The user opens the detail view and verifies the salary components.",
  "The user previews or downloads the generated PDF for the valid employee and period."
],
  rules: [
  "Filter stages are Draft, HR Reviewed, Finance Approved, Locked and Disbursed.",
  "The PDF filename is derived from employee code/reference and payroll period.",
  "Payslip snapshots can include tax declaration, TDS instruction, reimbursement, bank and transfer details.",
  "Locked and Disbursed records represent finalised states for summary purposes in the supplied page.",
  "A valid employee reference and year/month are required to produce the PDF."
],
  modules: [
  "Payroll Runs creates the approved period record.",
  "Payroll Configuration supplies earnings, deductions and statutory context.",
  "Attendance, leave, loans, reimbursements, tax and banking supply period snapshots.",
  "Employee self-service provides secure personal access."
],
  controls: [
  "Release only the payslip belonging to the authenticated employee or authorised tenant scope.",
  "Do not treat a Draft record as proof of final payment.",
  "Verify period, employee, status and net amount before sharing or downloading.",
  "Protect salary, bank and tax information as confidential personal data.",
  "Use the corrected payroll process if a value is wrong; do not edit the downloaded PDF as the source record.",
  "Use the Disbursed state and transfer record when confirming salary payment."
],
  checklist: [
  "Confirm employee and period.",
  "Confirm payroll stage.",
  "Confirm earnings, deductions, payable days and LWP.",
  "Confirm tax, reimbursement, recovery and bank context.",
  "Confirm PDF preview and download.",
  "Escalate discrepancies to authorised HR/Finance without exposing banking secrets."
],
  notes: [
  "Payslip access does not itself prove that funds reached the bank; use the recorded disbursement and reconciliation process.",
  "The exact fields shown depend on the saved payroll record and configured salary/statutory components.",
  "Retention and sharing should follow the Customer's privacy, employment and tax obligations."
],
  basis: "This guide reflects the supplied YourComate project implementation. Actual availability depends on the Customer tenant, plan, logged-in role, employee capability mappings and live configuration. Verified against: frontend/src/data/modules.js; frontend/src/pages/Payslips.jsx; frontend/src/pages/Payroll.jsx.",
};

export default function PayslipsSalaryAccessPage() {
  return <FeatureGuideLayout {...page} />;
}
