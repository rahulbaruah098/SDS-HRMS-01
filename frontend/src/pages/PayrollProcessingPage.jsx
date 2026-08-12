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
  controls: [
  "Do not calculate until required employee, salary, bank, attendance and statutory setup is complete.",
  "Review skipped reasons rather than forcing an ineligible employee into the run.",
  "Only approved LWP and configured rules should reduce pay.",
  "Keep HR review and Finance approval as distinct authorised stages.",
  "Lock only after reconciliation; a locked run is protected from ordinary recalculation.",
  "Record a verifiable disbursement reference and resolve any loan or reimbursement retry warning."
],
  checklist: [
  "Confirm period, employee scope and eligibility.",
  "Confirm salary structures and statutory configuration.",
  "Confirm attendance, leave and LWP.",
  "Confirm loans, reimbursements, bank and tax context.",
  "Reconcile Draft before HR and Finance stages.",
  "Confirm lock, payment reference, payslip and report outputs."
],
  notes: [
  "The supplied repository describes a full-module MVP foundation; the Customer must validate final statutory and payroll business rules before production use.",
  "The state shown in the live payroll run governs which action is permitted.",
  "Customer finance policy and applicable law remain controlling for calculation, approval and payment."
],
  basis: "This guide reflects the supplied YourComate project implementation. Actual availability depends on the Customer tenant, plan, logged-in role, employee capability mappings and live configuration. Verified against: frontend/src/data/modules.js; frontend/src/pages/Payroll.jsx; frontend/src/pages/PayrollConfiguration.jsx; README.md.",
};

export default function PayrollProcessingPage() {
  return <FeatureGuideLayout {...page} />;
}
