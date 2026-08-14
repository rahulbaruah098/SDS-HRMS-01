import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Talent, payroll & assistance",
  title: "Recruitment & Candidate Pipeline",
  purpose: "The Recruitment module connects the business need for a hire to approval, vacancy publication, candidate management, interviews, feedback, offer, joining and employee conversion. It gives HR and authorised leaders a single pipeline while keeping human review mandatory for candidate decisions.",
  icon: "recruitment",
  tone: "coral",
  heroHeading: "From an approved hiring need to candidate joining and employee conversion.",
  heroPillars: [
  "Hiring requests",
  "Candidate pipeline",
  "Interviews & scorecards",
  "Offers & joining"
],
  covers: [
  "Department-scoped hiring requests, vacancy count, qualification, expected joining date and budget context.",
  "Final request approval before HR publishes a job opening.",
  "Candidate profiles, resumes, applications and application status.",
  "Interview rounds, schedules, participants, meeting details and feedback scorecards.",
  "Offer drafting, approval, candidate response and expiry handling.",
  "Joining documents, background checks, joining status and employee conversion."
],
  users: [
  "A Team Leader can raise a request only for the department mapped to the employee profile.",
  "Admin or Managing Director gives the final hiring-request approval under the supplied workflow.",
  "HR publishes openings and manages candidates, interviews, offers and joining operations.",
  "Interviewers record authorised feedback; Finance access and offer approval remain role controlled."
],
  workflow: [
  "Create and submit the department hiring request with role, vacancies, qualification, timing and budget context.",
  "The authorised final approver approves, rejects, holds or returns the request as supported.",
  "HR creates and publishes the approved vacancy and assigns recruiting responsibility.",
  "Create candidate/application records, attach the resume and perform human screening.",
  "Schedule interviews, collect scorecards and record the authorised recommendation.",
  "Prepare and approve the offer, record candidate response, complete joining checks and convert the accepted candidate to an employee."
],
  rules: [
  "Hiring request states include Draft, Submitted, Approved, Rejected, On Hold and Closed.",
  "Job openings can be Draft, Open or Paused under the eligibility checks shown in the page.",
  "Candidate stages include applied, under review, shortlisted, interview scheduled/interviewed, selected and offer-related states.",
  "Joining states include Documents Pending, Ready to Join, Joining Deferred, Joined and Did Not Join.",
  "An offer contains designation, department, reporting manager, work location, employment type, joining date, probation and salary components."
],
  modules: [
  "Departments, designations and employee records provide hiring and interviewer options.",
  "Approved offers and joining records feed employee conversion.",
  "Notifications and reports support recruitment follow-up.",
  "Employee project and payroll setup occurs after conversion through their respective modules."
],
};

export default function RecruitmentCandidatePipelinePage() {
  return <FeatureGuideLayout {...page} />;
}
