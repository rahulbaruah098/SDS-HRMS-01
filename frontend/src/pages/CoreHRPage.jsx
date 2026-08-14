import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "People foundation",
  title: "Core HR & Employee Records",
  purpose: "YourComate uses the employee record as the main people-data foundation for attendance, leave, projects, approvals, payroll, directory access and other workforce processes. The supplied implementation separates active employees from former employees and keeps organisational masters, reporting relationships and login access connected to the correct Customer tenant.",
  icon: "people",
  tone: "violet",
  heroHeading: "One people-data foundation for connected workforce operations.",
  heroPillars: [
  "Active employee master",
  "Alumni lifecycle",
  "Organisation masters",
  "Reporting mappings"
],
  covers: [
  "Employee Management combines Employee Master, Create Employee and Alumni in one HR/Admin workspace.",
  "Employee Master contains active employees; resigned or departed employees are moved to Alumni.",
  "HR/Admin can add a historical employee directly to Alumni without creating a login account.",
  "Employee and Alumni information can be downloaded as CSV for authorised operational use.",
  "Organisation/entity, department, designation and state masters provide controlled dropdown values.",
  "The employee directory exposes tenant-scoped name, designation, state, phone, email and profile photo information."
],
  users: [
  "HR/Admin maintains people masters, creates employees, manages lifecycle changes and controls records.",
  "Employees use their own profile and permitted directory information through role-controlled screens.",
  "Team Leader and Reporting Officer are employee capabilities, not separate login identities.",
  "Platform Superadmin tenant user control is a separate SaaS-level function and should not replace normal tenant HR work."
],
  workflow: [
  "Prepare organisation/entity, department, designation and state master values.",
  "Create the active employee and associated employee login from Employee Management.",
  "Assign the employee's ordinary role and, where required, Team Leader or Reporting Officer capability flags.",
  "Map team leader and reporting officer relationships on the employee record.",
  "Use the employee identity across attendance, leave, projects, assets, payroll and service workflows.",
  "When employment ends, record the exit and move the person from the active master to Alumni."
],
  rules: [
  "Lifecycle statuses include Active, Probation, Confirmed, Inactive, Resigned, Left, Terminated and Retired.",
  "Employee types include Full Time, Part Time, Contract and Intern; job types include Permanent, Probation, Temporary, Consultant and Regular.",
  "Reporting Officer selection is restricted to configured designations matching Manager, Managing Director, Director, CEO or Chief Executive Officer.",
  "A project is not selected during employee creation; project allocation happens later through authorised TL/RO project workflow.",
  "Historical Alumni entry does not create a current employee login."
],
  modules: [
  "Attendance and leave use employee identity, state, reporting relationships and active status.",
  "Projects use TL/RO capability mappings and assigned employee scope.",
  "Payroll uses active employee, salary, bank and statutory context.",
  "Assets, policies, notifications and the directory remain tenant-scoped."
],
};

export default function CoreHRPage() {
  return <FeatureGuideLayout {...page} />;
}
