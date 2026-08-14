import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Service & intelligence",
  title: "IT Support & Helpdesk",
  purpose: "The IT Support module gives every login a structured way to raise a technical request and follow its status. Normal requests remain with the Customer tenant's IT Department; the IT Head assigns or reassigns work, the assigned IT member records progress, and only major escalated issues reach Platform Superadmin.",
  icon: "support",
  tone: "coral",
  heroHeading: "Structured technical support from the tenant queue to controlled escalation.",
  heroPillars: [
  "Ticket intake",
  "IT assignment",
  "Progress & resolution",
  "Major escalation"
],
  covers: [
  "Ticket subject, description, issue category and priority.",
  "Employee My IT Tickets view and status tracking.",
  "IT Head assignment or reassignment to self or a tenant IT Department member.",
  "Assigned-member progress, status and resolution notes.",
  "Employee review, rating and reopen action for a genuinely unresolved ticket.",
  "Controlled escalation of major software, server, database, infrastructure or security problems."
],
  users: [
  "Every login can raise an IT Support ticket.",
  "Admin/HR can raise tickets but do not become the tenant IT assignment desk merely because they are administrators.",
  "The tenant IT Department Team Leader or IT Support Head assigns and reassigns tickets.",
  "Platform Superadmin sees only issues explicitly escalated by the IT Head under the major-issue workflow."
],
  workflow: [
  "The user selects the issue category and priority, then enters a clear subject and description.",
  "The ticket enters the tenant IT queue as an open request.",
  "The IT Head reviews the request and assigns it to self or an appropriate tenant IT member.",
  "The assigned member updates status, progress, user questions and resolution information.",
  "The employee reviews the result and closes/reviews it or reopens it with a genuine reason.",
  "If the issue is a major supported problem, the IT Head records an escalation type and reason for Platform Superadmin."
],
  rules: [
  "Ticket statuses are Open, Assigned, In Progress, Waiting for User, Resolved, Closed and Reopened.",
  "Priorities are Low, Medium, High and Critical.",
  "Categories include login/password, network, device, printer, software, email, attendance/HRMS, data access, hardware, server, database, security and other.",
  "Escalation types include software/application, server, database, network/infrastructure major issue, security and other major problem.",
  "Account-access issues can use focused categories such as forgot password, locked account, cannot login, email/code and OTP verification."
],
  modules: [
  "Employee identity and tenant determine requester and IT scope.",
  "Application Status gives the employee a consolidated support-status view.",
  "Notifications may alert relevant users about ticket activity.",
  "Platform administration receives only explicit major escalations."
],
};

export default function ITSupportHelpdeskPage() {
  return <FeatureGuideLayout {...page} />;
}
