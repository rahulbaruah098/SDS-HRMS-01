import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Everyday operations",
  title: "Projects & Team Delivery",
  purpose: "YourComate connects project ownership, reporting hierarchy, assigned team members, collaborators and progress updates. Team Leader and Reporting Officer capability users create and assign projects, while employees see only projects within their scope and update permitted delivery information.",
  icon: "project",
  tone: "coral",
  heroHeading: "Ownership, hierarchy, collaborators and progress in one scoped view.",
  heroPillars: [
  "Project ownership",
  "TL/RO hierarchy",
  "Members & collaborators",
  "Progress visibility"
],
  covers: [
  "Project creation, department selection, status and priority.",
  "Reporting Officer, Team Leader, assigned members and collaborators.",
  "Employee-scoped project lists rather than unrestricted tenant-wide access.",
  "Progress updates, latest updater and delivery status.",
  "Project team-tree and root-map views.",
  "Project counts, average progress, department workload and top-project visibility."
],
  users: [
  "Team Leader and Reporting Officer capability users manage project setup and assignments within their permitted scope.",
  "Employees view assigned or connected projects and update progress/status only where authorised.",
  "A TL or RO remains an employee login with capability flags and mappings.",
  "HR/Admin should not be treated as the default project owner merely because they administer employees."
],
  workflow: [
  "An authorised TL/RO creates the project and selects the relevant department and operating details.",
  "The project is connected to the reporting officer and team leader hierarchy.",
  "Assigned members are identified as the people doing the project; collaborators are added separately.",
  "Team members access the project through their scoped view.",
  "Authorised users record progress and change the operational status.",
  "Managers review delivery health, department workload, progress history and completion."
],
  rules: [
  "Project statuses are Active, On Hold and Completed.",
  "Project priorities are Low, Medium, High and Critical.",
  "Team-tree levels are Reporting Officer, Team Leader, Team Member Doing Project and Collaborator.",
  "The latest progress value and latest updater support current-delivery visibility.",
  "Project assignment happens in this module, not during employee creation."
],
  modules: [
  "Employee Management supplies active people, capability mappings, department and reporting structure.",
  "Employee dashboards show assigned, team and reporting project views.",
  "Performance reviews can use mapped team relationships but remain a separate weekly review workflow.",
  "Reports and dashboard analytics summarise project status and progress."
],
  controls: [
  "Create projects only under the authorised TL/RO capability.",
  "Keep assigned members distinct from collaborators.",
  "Use progress updates that are evidence-based and understandable to the team.",
  "Do not mark Completed until the responsible owner confirms closure.",
  "Review access after team, department or reporting-line changes.",
  "Do not create a project assignment inside the employee onboarding form."
],
  checklist: [
  "Confirm project name, department, status and priority.",
  "Confirm Reporting Officer and Team Leader.",
  "Confirm assigned members and collaborators.",
  "Define who can update progress and status.",
  "Review dashboard visibility for each role.",
  "Close or place inactive work On Hold instead of leaving misleading Active records."
],
  notes: [
  "Project visibility is derived from role, employee capability and relationship scope.",
  "Analytics reflect the saved project and progress data; they do not independently prove delivery quality.",
  "The authorised screen and backend permissions govern the actions available to each user."
],
  basis: "This guide reflects the supplied YourComate project implementation. Actual availability depends on the Customer tenant, plan, logged-in role, employee capability mappings and live configuration. Verified against: frontend/src/data/modules.js; frontend/src/pages/Projects.jsx; frontend/src/pages/EmployeeDashboard.jsx.",
};

export default function ProjectsTeamDeliveryPage() {
  return <FeatureGuideLayout {...page} />;
}
