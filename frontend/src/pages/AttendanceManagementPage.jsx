import FeatureGuideLayout from "./FeatureGuideLayout";

const page = {
  category: "Everyday operations",
  title: "AI-powered Face Recognition Attendance",
  purpose: "YourComate combines everyday office, work-from-home and field attendance with optional, organisation-controlled AI-powered face verification. Employees can register their face with consent, authorised teams review enrollment, and camera verification supports check-in and checkout when activated. Existing attendance evidence, exceptions and holiday workflows remain connected.",
  heroKicker: "Secure & connected attendance",
  purposeTitle: "One seamless experience for every workday",
  purposeCopy: "From registering for face verification to completing a daily check-in, YourComate keeps the attendance journey clear and connected. Organisations control when to introduce camera verification, while employees and authorised managers retain visibility over enrolment, field activity, attendance exceptions and records.",
  icon: "attendance",
  tone: "cyan",
  heroHeading: "Confident check-ins, secure face verification and one connected attendance record.",
  heroPillars: [
    "AI-powered face verification",
    "Guided enrollment & review",
    "Office, WFH & field",
    "Check-in & checkout",
  ],
  covers: [
    "Optional AI-powered face recognition for check-in and checkout after organisation-level activation.",
    "Employee self-enrollment with guided camera capture, consent and review by authorised personnel.",
    "HR, Admin and IT Head enrollment management, approval and permitted retraining or revocation.",
    "Preparation mode allows enrollment while normal attendance continues; verification is enforced only when enabled.",
    "Office, work-from-home and field attendance with timestamps, work-mode and worked-time context.",
    "Field place, photo and location evidence, where required, plus late-entry and early-checkout reasons.",
    "Holiday work requests, prior approvals, permitted holiday attendance and Comp-Off credit.",
    "Attendance visibility, reporting and authorised team or HR review across the existing workflow.",
  ],
  users: [
    "Employees register from their own camera with consent, check enrollment status and verify attendance when their organisation has enabled it.",
    "HR, Admin and IT Head roles manage permitted enrollments, review approval requests and prepare a controlled rollout.",
    "Team Leaders and Reporting Officers review mapped team attendance and field context where their permissions allow.",
    "Tenant-scoped permissions, employee status and company attendance settings determine what each role can access.",
  ],
  workflow: [
    "An authorised administrator enables enrollment preparation for the company; normal check-in and checkout remain available during this phase.",
    "The employee gives consent and captures guided face images, or an authorised manager assists with enrollment.",
    "An authorised HR, Admin or IT Head reviewer approves the enrollment before it can be used for verification.",
    "When the company explicitly activates camera verification, the employee starts a permitted attendance check-in or checkout.",
    "A camera scan verifies the face against the approved enrollment; attendance is recorded only after applicable verification and work rules succeed.",
    "Existing field evidence, attendance exceptions, checkout rules, holiday approvals and sprint reporting gates continue to apply where configured.",
    "Authorised roles review attendance summaries and exceptions; reporting and payroll use saved attendance and approved leave context.",
  ],
  rules: [
    "Face recognition is company-controlled: Off, Enrollment preparation, and Camera verification ON are distinct settings.",
    "Preparation mode permits consent and registration without requiring face verification for every attendance action.",
    "Live camera verification applies to both check-in and checkout only when enforcement is enabled; approved exceptions may apply.",
    "Face registration requires consent and approval; access to face data and enrollment controls is role-restricted.",
    "Employees may withdraw enrollment through the permitted workflow; protected records follow configured privacy and retention rules.",
    "Attendance statuses, late and early checkout reasons, field evidence and work-mode controls remain part of the underlying record.",
    "Holiday work requires prior approval, and eligible approved holiday attendance can generate Comp-Off after checkout.",
  ],
  modules: [
    "Employee profiles and HR administration manage enrollment identity, access permissions and review status.",
    "Company System Settings controls face enrollment preparation and live attendance verification.",
    "Attendance records remain the authoritative source for check-in, checkout, work mode and approved exceptions.",
    "Team Approvals connects authorised decisions, including applicable holiday work and enrollment review.",
    "Leave, Reports and payroll use saved attendance, approved leave, Comp-Off and LWP context.",
    "Project and Sprint Planning can require a daily work report before checkout when the company has enabled that workflow.",
  ],
};

export default function AttendanceManagementPage() {
  return <FeatureGuideLayout {...page} />;
}
