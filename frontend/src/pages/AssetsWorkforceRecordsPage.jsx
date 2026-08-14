import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "People foundation",
  title: "Assets & Workforce Records",
  purpose: "The Assets module connects workplace hardware and software records to the responsible employee. Employees can submit their own assigned asset details, while authorised HR/Admin users can assign, verify, update, manage and report on employee-wise asset allocation.",
  icon: "briefcase",
  tone: "mint",
  heroHeading: "Employee-linked hardware and software records with controlled verification.",
  heroPillars: [
  "Hardware & software",
  "Employee allocation",
  "Verification states",
  "Asset reporting"
],
  covers: [
  "Hardware and software asset records linked to an employee.",
  "Hardware information such as category, brand, model, purchase date and warranty expiry.",
  "Software information such as licence key or email and licence expiry.",
  "Status, condition, verification status, remarks and rejection reason.",
  "Search and filtering by asset, employee, code, type, status and verification state.",
  "Employee-wise reports and CSV export for authorised users."
],
  users: [
  "Employees can submit their own hardware or software asset details for verification.",
  "HR/Admin can select employees, create or update allocations, verify submissions and maintain status.",
  "Report access is role controlled and may be broader than an employee's self-view.",
  "All records remain scoped to the current Customer tenant."
],
  workflow: [
  "Select the employee who is responsible for the asset, or use the signed-in employee for self-submission.",
  "Choose Hardware or Software and enter the applicable identification fields.",
  "Record purchase, warranty or licence dates where relevant.",
  "Set the operational status and condition, then submit the record.",
  "HR/Admin verifies or rejects an employee-submitted record with a reason where required.",
  "Maintain later events such as return, loss, damage, availability or expiry and use reports for follow-up."
],
  rules: [
  "Asset statuses: Assigned, Available, Returned, Lost, Damaged and Expired.",
  "Conditions: New, Good, Fair, Poor, Damaged and Not Applicable.",
  "Verification states: Pending Verification, Verified and Rejected.",
  "Hardware and software use different identifiers and expiry information.",
  "The record can include remarks and a rejection reason for controlled review."
],
  modules: [
  "Employee Management supplies employee identity, code and department.",
  "Employee self-service provides the employee's own asset submission and visibility.",
  "Reports provide employee-wise asset allocation and status information.",
  "Lifecycle processes should review assets when an employee exits or changes responsibility."
],
};

export default function AssetsWorkforceRecordsPage() {
  return <FeatureGuideLayout {...page} />;
}
