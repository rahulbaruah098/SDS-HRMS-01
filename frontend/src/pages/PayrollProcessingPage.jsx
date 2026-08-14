import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Talent, payroll & assistance",
  title: "Payroll Processing",
  purpose: "YourComate payroll combines salary structures, statutory configuration, attendance and LWP, approved reimbursements, active loan recoveries, verified banking context and role-controlled monthly approvals. The workflow progresses from Draft through review, approval, locking and recorded disbursement.",
  icon: "payroll",
  tone: "violet",
  heroHeading: "From salary setup to reviewed, locked and recorded disbursement.",
  heroPillars: [
  "Salary structures",
  "Attendance & LWP",
  "HR/Finance stages",
  "Payslips & reports"
],
  covers: [
  "Salary structures, effective revisions and statutory rules for PF, PT, ESI, TDS and LWP.",
  "All-active or selected-employee payroll scope and eligibility checks.",
  "Saved attendance synchronisation or explicit manual attendance/LWP input.",
  "Earnings, deductions, reimbursements, loan recovery and payroll tax context.",
  "HR review, Finance approval, locking and disbursement recording.",
  "Payslip generation, banking exports and payroll reporting connections."
],
  users: [
  "HR, HR Admin and HR Manager perform the HR payroll review stage.",
  "Finance and Accounts Finance perform finance-controlled approval, lock and disbursement actions.",
  "Admin/Superadmin access is defined by the module role set, but the operational stage remains role controlled.",
  "Employees do not calculate payroll; they access authorised payslip and related self-service records."
],
  workflow: [
  "Configure effective salary structures, statutory rules, employee eligibility, bank and tax context.",
  "Select the payroll period and all or selected active employees.",
  "Synchronise saved attendance and approved leave, or provide explicit manual inputs.",
  "Calculate Draft payroll and review skipped employees and calculation results.",
  "Complete HR Review, then Finance Approved, then lock the approved run.",
  "Record disbursement with transfer date, mode, transaction reference and bank-file reference; release payslips and reports."
],
  rules: [
  "Canonical states are Draft, HR Reviewed, Finance Approved, Locked and Disbursed.",
  "Locked or non-Draft payroll runs cannot be recalculated through the Draft action.",
  "Employees can be skipped when inactive/ineligible, missing required setup or already beyond Draft for the period.",
  "Saved mode uses persisted attendance summaries; manual mode requires explicit LWP input for every selected employee.",
  "The calculation uses approved claims/recoveries and verified context rather than guessing a money rule."
],
  modules: [
  "Employee Management and Payroll Configuration provide employee and salary inputs.",
  "Attendance and Leave provide working-day, paid-leave and LWP context.",
  "Loans, Reimbursements, Banking and Tax Declarations/TDS provide controlled adjustments.",
  "Payslips and Payroll Reports provide employee and authorised management outputs."
],
};

export default function PayrollProcessingPage() {
  return <FeatureGuideLayout {...page} />;
}
