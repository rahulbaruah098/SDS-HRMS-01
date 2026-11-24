import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Everyday operations",
  title: "Project Management & Sprint Planning",
  purpose: "Connect project deliverables, monthly team targets and weekly individual sprints in one coordinated workspace. YourComate helps teams define measurable outcomes, assign responsibilities, plan their work and track delivery progress through authorised review and approval workflows.",
  icon: "project",
  tone: "coral",
  heroKicker: "From planning to delivery",
  heroHeading: "Clear priorities, accountable teams and measurable progress.",
  heroPillars: [
    "Project deliverables",
    "Monthly team planning",
    "Weekly individual sprints",
    "Progress & approvals",
  ],
  purposeTitle: "Turn project goals into everyday action.",
  purposeCopy: "Give teams a clear connection between what a project must deliver and what each employee needs to accomplish. Organise monthly commitments around project milestones, break them into actionable weekly outputs and review progress against agreed targets.",
  covers: [
    "Project creation, department, ownership, priorities, status and team assignments.",
    "Project deliverables and milestones with defined outputs and deadlines.",
    "Monthly team planning with measurable targets, responsibilities and expected evidence.",
    "Weekly individual sprints that bring assigned project and internal work into one consolidated plan.",
    "Structured activities, tasks, planned outputs and progress updates with supporting evidence.",
    "Manager reviews, approved changes for unplanned work and planned-versus-actual progress tracking.",
  ],
  users: [
    "Team Leaders and Reporting Officers manage projects, coordinate team priorities and review plans within their authorised scope.",
    "Employees prepare individual sprint plans, update task progress, share evidence and flag blockers.",
    "Project teams align monthly targets with deliverables, deadlines and individual responsibilities.",
    "Access and approval responsibilities follow the configured reporting hierarchy and role permissions.",
  ],
  workflow: [
    "Create a project, define deliverables and assign the responsible team members and collaborators.",
    "Agree on monthly team targets, measurable outputs, deadlines and employee accountability.",
    "Prepare and review the monthly plan before translating targets into weekly individual sprints.",
    "Employees plan specific weekly outputs across their assigned projects and internal responsibilities.",
    "Update progress, actual outputs, supporting evidence and blockers as work advances.",
    "Review unplanned work and changes through the applicable approval process without silently altering agreed targets.",
    "Review monthly achievements against planned targets and identify carry-forward actions or improvements.",
  ],
  rules: [
    "Project statuses and priorities help teams distinguish active work, on-hold projects and completed delivery.",
    "Project deliverables, monthly targets and weekly sprint tasks should remain connected wherever applicable.",
    "Plans should specify clear responsibilities, measurable outputs and realistic deadlines.",
    "Unplanned work should be recorded and reviewed separately to preserve the approved planning baseline.",
    "Project visibility, updates and plan approvals follow authorised roles and reporting relationships.",
  ],
  modules: [
    "Employee Management supplies team members, departments and reporting relationships.",
    "Project and employee dashboards provide scoped visibility into assignments and delivery progress.",
    "Sprint Planning connects monthly team targets with individual weekly activities and work updates.",
    "Attendance can connect daily work reporting with checkout when that workflow is enabled.",
    "Reports and dashboard analytics support project progress, target achievement and management review where available.",
  ],
};

export default function ProjectsTeamDeliveryPage() {
  return <FeatureGuideLayout {...page} />;
}
