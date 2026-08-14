import { Link } from "react-router-dom";
import HeroScene from "../components/HeroScenes";
import Icon from "../components/Icon";
import PageHero from "../components/PageHero";

const workdayAreas = [
  {
    number: "01",
    label: "People Operations",
    title: "One dependable foundation for your workforce.",
    copy: "Keep employee records, reporting structures, policies, documents, assets and workforce information connected in one organised system.",
    includes: [
      "Employee Records",
      "Employee Self-Service",
      "Policies & Documents",
      "Assets & Workforce Records",
    ],
    cta: "Explore People Operations",
    href: "/product/core-hr",
    icon: "people",
    tone: "sky",
  },
  {
    number: "02",
    label: "Attendance, Leave & Approvals",
    title: "Everyday requests move without losing context.",
    copy: "Manage office, remote, field and offline attendance alongside leave, holidays, requests and role-based approvals.",
    includes: [
      "Attendance Management",
      "Leave & Holidays",
      "Approvals & Requests",
      "Mobile Check-In",
    ],
    cta: "Explore Everyday Operations",
    href: "/product/attendance",
    icon: "attendance",
    tone: "lilac",
  },
  {
    number: "03",
    label: "Projects & Team Delivery",
    title: "Keep ownership and progress visible.",
    copy: "Connect projects with team leaders, reporting officers, members and collaborators so assigned work and progress updates stay within the same workplace.",
    includes: [
      "Projects",
      "Team Delivery",
      "Collaborators",
      "Progress Visibility",
    ],
    cta: "Explore Projects",
    href: "/product/projects",
    icon: "project",
    tone: "cream",
  },
  {
    number: "04",
    label: "Recruitment & Onboarding",
    title: "Bring new people into the same connected system.",
    copy: "Manage job openings, candidates and recruitment workflows, then carry successful hires forward into your employee records and organisational structure.",
    includes: [
      "Job Openings",
      "Candidate Pipeline",
      "Recruitment",
      "Employee Onboarding",
    ],
    cta: "Explore Recruitment",
    href: "/product/recruitment",
    icon: "recruitment",
    tone: "mint",
  },
  {
    number: "05",
    label: "Payroll & Payslips",
    title: "Move from workforce records to payday with clarity.",
    copy: "Keep payroll processing connected with employee information, attendance inputs and salary records while giving employees secure access to their payslips.",
    includes: [
      "Payroll Processing",
      "Salary Records",
      "Payslips",
      "Employee Access",
    ],
    cta: "Explore Payroll",
    href: "/product/payroll",
    icon: "payroll",
    tone: "coral",
  },
  {
    number: "06",
    label: "Support, Insights & Saya AI",
    title: "Give every role a smarter way to get things done.",
    copy: "Bring employee support, workforce reporting and mobile access together with Saya AI — providing role-aware guidance based on the signed-in user's permitted workspace.",
    includes: [
      "Saya AI",
      "IT Support & Helpdesk",
      "Workforce Insights",
      "Mobile Experience",
    ],
    cta: "Meet Saya AI",
    href: "/saya",
    icon: "saya",
    tone: "amber",
  },
];

export default function CustomersPage() {
  return (
    <main className="public-main yc-customers-page">
      <PageHero
        eyebrow="Connected workdays"
        title="Where YourComate"
        titleAccent="fits into the workday."
        description="From joining and attendance to projects, payroll and employee support, YourComate connects the workflows organisations manage every day."
        icon="people"
        tone="cyan"
        variant="customers"
      >
        <HeroScene type="customers" />
      </PageHero>

      <section className="public-section yc-customer-stories-section">
        <div className="page-width">
          <div className="yc-customer-story-grid">
            {workdayAreas.map((area) => (
              <article className={`tone-${area.tone}`} key={area.number}>
                <header>
                  <div className="yc-customer-story-index">
                    <b>{area.number}</b>
                    <small>{area.label}</small>
                  </div>

                  <span aria-hidden="true">
                    <Icon name={area.icon} />
                  </span>
                </header>

                <h2>{area.title}</h2>
                <p>{area.copy}</p>

                <div className="yc-customer-story-includes">
                  <small>Includes</small>
                  <div>
                    {area.includes.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>

                <Link to={area.href}>
                  {area.cta} <Icon name="arrow" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
