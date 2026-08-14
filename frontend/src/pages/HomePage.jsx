import { useState } from "react";
import { Link } from "react-router-dom";
import AppStoreBadges, { AppleIcon } from "../components/AppStoreBadges";
import Icon from "../components/Icon";
import "../styles/homepage-hero.css";
import "../styles/homepage-sections.css";

const heroTaglines = [
  "People, process and performance — finally connected.",
  "A clearer workday for every role in your organisation.",
  "From attendance to payroll, every action stays in flow.",
  "One intelligent HR workspace built around real work.",
];

const heroCards = [
  [
    "attendance",
    "Attendance",
    "Office, remote and field attendance stays clearly tracked.",
    "/product/attendance",
  ],
  [
    "calendar",
    "Leave & approvals",
    "Requests, balances and decisions remain in one clear flow.",
    "/product/leave",
  ],
  [
    "payroll",
    "Payroll & payslip",
    "Salary processing and approved payslips stay connected.",
    "/product/payroll",
  ],
  [
    "sparkle",
    "SAYA AI",
    "Role-aware guidance connects every question to the next action.",
    "/saya",
  ],
];

const modules = [
  ["People", "people", "/product/core-hr", "One dependable source for every employee record."],
  ["Attendance", "attendance", "/product/attendance", "Office, remote, field and offline work in one view."],
  ["Leave", "calendar", "/product/leave", "Requests, balances and decisions without follow-up chains."],
  ["Projects", "project", "/product/projects", "Owners, collaborators and delivery signals stay visible."],
  ["Approvals", "approval", "/product/approvals", "The right context reaches the right decision-maker."],
  ["Support", "support", "/product/helpdesk", "Employee questions and IT requests stay connected."],
  ["Recruitment", "recruitment", "/product/recruitment", "Openings, candidates, interviews and offers stay in one clear hiring flow."],
  ["Payroll", "payroll", "/product/payroll", "Salary inputs, calculations and reviews stay in one controlled flow."],
  ["Payslips", "payslip", "/product/payslip", "Approved salary records remain clear and accessible to employees."],
  ["Saya AI", "sparkle", "/saya", "Role-aware guidance connects questions to the next available action."],
];

const roleViews = {
  employee: { label: "Employee", icon: "people", headline: "Start the day knowing exactly what needs you.", copy: "Check in, review requests, update work and find personal documents from one focused workspace.", signal: "Your day is ready", metrics: [["attendance", "09:02", "Checked in"], ["approval", "02", "Open requests"], ["project", "04", "Tasks in view"]], actions: [["attendance", "Attendance confirmed"], ["calendar", "Leave status updated"], ["project", "Project action due at 4 PM"]] },
  manager: { label: "Manager", icon: "hierarchy", headline: "Make decisions with the context already attached.", copy: "See team availability, pending requests and delivery risks without searching across separate tools.", signal: "5 decisions waiting", metrics: [["people", "92%", "Team present"], ["approval", "05", "Decisions"], ["project", "14", "Deliverables"]], actions: [["calendar", "Two leave requests"], ["attendance", "One attendance exception"], ["project", "One milestone needs attention"]] },
  admin: { label: "HR & Admin", icon: "settings", headline: "Operate the organisation from one connected structure.", copy: "People, policies, attendance rules, support and reports stay aligned to the same roles and reporting lines.", signal: "Organisation in sync", metrics: [["people", "58", "Active people"], ["approval", "08", "Approvals"], ["support", "03", "Support items"]], actions: [["people", "New employee ready"], ["document", "Policy acknowledgement at 96%"], ["payroll", "Payroll inputs complete"]] },
  field: { label: "Field Team", icon: "mobile", headline: "Carry the workday with you, not the paperwork.", copy: "Check in, receive assignments, update visits and raise support from responsive mobile workflows.", signal: "Mobile route active", metrics: [["mobile", "06", "Visits"], ["attendance", "01", "Check-in due"], ["send", "09", "Updates sent"]], actions: [["mobile", "Next visit mapped"], ["attendance", "Location check-in available"], ["send", "Supervisor update delivered"]] },
};

const dayMoments = [
  ["09:02", "attendance", "Workday opens", "The employee checks in from the correct work mode."],
  ["11:20", "approval", "A decision moves", "The manager receives the request with its full context."],
  ["15:10", "project", "Delivery updates", "The project view reflects what changed today."],
  ["17:42", "sparkle", "Saya closes the loop", "The next useful action is ready before tomorrow begins."],
];

export default function HomePage() {
  const [roleKey, setRoleKey] = useState("employee");
  const role = roleViews[roleKey];

  return (
    <main className="public-main yc-premium-home yc-horizontal-enabled yc-editorial-home yc-restored-home">
      <section className="yc-minoru-hero" data-panel-label="YourComate HRMS">
        <div className="yc-minoru-shell">
          <div className="yc-minoru-main">
            <Link
              className="yc-minoru-saya-star"
              to="/saya"
              aria-label="Open SAYA Assistant"
            >
              <span>AI POWERED</span>
              <strong>SAYA ASSISTANT</strong>
            </Link>

            <Link
              className="yc-minoru-login-portal"
              to="/login"
              aria-label="Open YourComate login"
            >
              <span className="yc-minoru-login-portal-icon" aria-hidden="true">
                <Icon name="people" />
              </span>
              <span className="yc-minoru-login-portal-copy">
                <small>YOUR WORKSPACE</small>
                <strong>Login</strong>
              </span>
              <span className="yc-minoru-login-portal-arrow" aria-hidden="true">
                <Icon name="arrow" />
              </span>
            </Link>
            <div className="yc-minoru-organic" aria-hidden="true"><i /><i /><i /><i /><i /></div>
            <div className="yc-minoru-brand-stage" aria-label="Your Comate">
              <span className="yc-minoru-word yc-minoru-word-your">YOUR</span>
              <div className="yc-minoru-logo-mark" aria-hidden="true">
                <img src="/images/hero-384.webp" srcSet="/images/hero-192.webp 192w, /images/hero-384.webp 384w, /images/hero-576.webp 576w" sizes="(max-width: 420px) 68px, (max-width: 760px) 80px, (max-width: 1120px) 19vw, 17vw" width="668" height="890" alt="" loading="eager" decoding="async" fetchPriority="high" />
              </div>
              <span className="yc-minoru-word yc-minoru-word-comate">COMATE</span>
            </div>
            <p className="yc-minoru-tagline">One HRMS. Every workday connected.</p>
            <div className="yc-minoru-marquee" aria-label="YourComate highlights">
              <div className="yc-minoru-marquee-track" aria-hidden="true">
                {[0, 1].map((group) => <div className="yc-minoru-marquee-group" key={group}>{heroTaglines.map((tagline) => <span key={`${group}-${tagline}`}>{tagline}</span>)}</div>)}
              </div>
            </div>
          </div>
          <div className="yc-minoru-info">
            <header><h1><span>A better workday,</span><span>in one place.</span></h1></header>
            <div className="yc-minoru-cards">
              {heroCards.map(([icon, title, copy, href]) => (
                <Link to={href} key={title}>
                  <span className="yc-minoru-card-number yc-icon-number-box"><Icon name={icon} /></span>
                  <div className="yc-minoru-card-copy"><div className="yc-minoru-card-title"><strong>{title}</strong><span className="yc-minoru-card-symbol" aria-hidden="true"><Icon name="arrow" /></span></div><small>{copy}</small></div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="public-section yc-shift-official-panel" data-panel-label="From scattered to connected">
        <div className="page-width yc-shift-official-shell">
          <header className="yc-shift-official-copy"><p className="yc-shift-official-kicker">FROM SCATTERED WORK TO ONE CLEAR FLOW</p><h2>One action should never disappear<em>between people and work.</em></h2><div className="yc-shift-official-before" aria-label="Disconnected work examples"><small>BEFORE YOURCOMATE</small><div><span>Attendance sheet</span><span>Leave message</span><span>Project update</span><span>Approval follow-up</span><span>Employee document</span></div></div></header>
          <div className="yc-shift-official-workflow"><header><div><small>WITH YOURCOMATE</small><h3>One connected workday.</h3></div><span><i />Live workflow</span></header><div className="yc-shift-official-grid">
            {dayMoments.map(([time, icon, title, copy], index) => <article className={`yc-shift-official-card card-${index + 1}`} tabIndex={0} key={time}><span className="yc-shift-official-number yc-icon-number-box"><Icon name={icon} /></span><div className="yc-shift-official-card-copy"><div className="yc-shift-official-card-title"><strong>{title}</strong></div><small>{copy}</small></div><time>{time}</time></article>)}
          </div><footer>Every record, owner and next action stays visible in one place.</footer></div>
        </div>
      </section>

      <section className="public-section yc-soft-modules-panel" data-panel-label="Connected HRMS modules">
        <div className="page-width yc-soft-modules-shell"><header className="yc-soft-modules-header"><div><h2>Ten everyday tools.<em>One shared foundation.</em></h2></div></header><div className="yc-soft-modules-board"><div className="yc-soft-modules-foundation"><span>YOURCOMATE FOUNDATION</span><strong>People records · Roles · Rules · Reporting structure</strong><small>Update once. Use everywhere.</small></div><div className="yc-soft-modules-track">
          {modules.map(([title, icon, href, copy], index) => <Link className={`yc-soft-module-card card-${index + 1}`} to={href} key={title}><span className="yc-soft-module-number yc-icon-number-box" aria-hidden="true"><Icon name={icon} /></span><span className="yc-soft-module-copy"><strong>{title}</strong><small>{copy}</small></span><Icon name="arrow" /></Link>)}
        </div><footer className="yc-soft-modules-footer"><span><i /> Connected</span><p>A change in one workflow stays useful in every workflow that follows.</p></footer></div></div>
      </section>

      <section className="public-section yc-soft-roles-panel" data-panel-label="Role-aware workspaces">
        <div className="page-width yc-soft-roles-shell"><header className="yc-soft-roles-header"><div className="yc-soft-roles-heading"><h2>One organisation.<em>A clearer view for every role.</em></h2></div></header><div className="yc-soft-role-workbench"><div className="yc-soft-role-tabs" role="tablist" aria-label="Choose a role view">
          {Object.entries(roleViews).map(([key, item]) => <button type="button" role="tab" aria-selected={roleKey === key} className={roleKey === key ? "active" : ""} onClick={() => setRoleKey(key)} key={key}><b><Icon name={item.icon} /></b><span>{item.label}</span></button>)}
        </div><article className="yc-soft-role-sheet" data-role={roleKey}><header className="yc-soft-role-sheet-header"><span><i />{role.signal}</span><small>{role.label.toUpperCase()} WORKSPACE</small></header><div className="yc-soft-role-sheet-body"><div className="yc-soft-role-message"><small>CURRENT PERSPECTIVE</small><h3>{role.headline}</h3><p>{role.copy}</p></div><div className="yc-soft-role-metrics">
          {role.metrics.map(([icon, value, label], index) => <span className={`metric-${index + 1}`} key={label}><b><Icon name={icon} /></b><strong>{value}</strong><small>{label}</small></span>)}
        </div></div><div className="yc-soft-role-actions"><small>NEXT ACTIONS</small>{role.actions.map(([icon, action]) => <span key={action}><b><Icon name={icon} /></b><strong>{action}</strong><Icon name="arrow" /></span>)}</div></article></div></div>
      </section>

      <section id="yourcomate-app" className="public-section yc-app-showcase-panel" data-panel-label="YourComate mobile app">
        <div className="page-width yc-app-showcase-shell">
   <header className="yc-app-showcase-copy">
  

 <h2 className="yc-app-editorial-heading">
  <span>Your complete workday,</span>
  <em>comfortably in your hand.</em>
</h2>
            <p>Attendance, requests, projects, payslips, support and Saya move with employees through one focused mobile experience for office, remote and field work.</p>
            <div className="yc-app-feature-pills">
              <span><Icon name="attendance" /> Fast check-in</span>
              <span><Icon name="shield" /> Secure access</span>
              <span><Icon name="sparkle" /> Saya guidance</span>
            </div>
            <AppStoreBadges disabled />
          </header>

          <div className="yc-app-device-gallery" aria-label="YourComate app shown on iPhone and Android devices">
            <article className="yc-app-device-group yc-app-iphone-group" aria-label="YourComate iPhone app preview">
              <span className="yc-app-device-label"><b>iPhone</b><small>Coming soon on iOS</small></span>
              <div className="yc-app-iphone-pair">
                <span className="yc-app-iphone-back" aria-hidden="true">
                  <i className="camera camera-one" />
                  <i className="camera camera-two" />
                  <i className="camera-flash" />
                  <i className="apple-mark"><AppleIcon /></i>
                </span>
                <span className="yc-app-device yc-app-iphone-front">
                  <span className="yc-app-dynamic-island" />
                  <img src="/images/yourcomate-app-screen.png" alt="YourComate mobile app on iPhone" loading="lazy" decoding="async" />
                </span>
              </div>
            </article>

            <article className="yc-app-device-group yc-app-android-group" aria-label="YourComate Android app preview">
              <span className="yc-app-device-label"><b>Android</b><small>Available on Google Play</small></span>
              <span className="yc-app-device yc-app-android-phone">
                <span className="yc-app-android-camera" />
                <img src="/images/yourcomate-app-screen.png" alt="YourComate mobile app on Android" loading="lazy" decoding="async" />
              </span>
            </article>
          </div>
        </div>
      </section>

      <section className="public-section yc-soft-saya-panel" data-panel-label="SAYA AI">
 <div className="yc-soft-saya-background-line" aria-hidden="true">
  <span>SAYA AI   SAYA AI   SAYA AI   SAYA AI /</span>
  <span>SAYA AI   SAYA AI   SAYA AI   SAYA AI /</span>
</div>

  <div className="page-width yc-soft-saya-shell">
    <header className="yc-soft-saya-copy">
      <p className="yc-soft-saya-kicker">AI POWERED ASSISTANT</p>

      <h2>
        Ask naturally.
        <em>Continue with confidence.</em>
      </h2>

      <div className="yc-soft-saya-points">
        <span><b>01</b>Understands the signed-in role</span>
        <span><b>02</b>Uses live work context</span>
        <span><b>03</b>Suggests permitted actions</span>
      </div>

      <Link className="yc-soft-saya-cta" to="/saya">
        Meet Saya AI
        <Icon name="arrow" />
      </Link>
    </header>

    <div
      className="yc-soft-saya-desk"
      aria-label="Saya AI workspace preview"
    >
      <div className="yc-soft-saya-visual-frame">
        <img
          className="yc-soft-saya-visual"
          src="/images/5.jpg"
          alt="Role-aware Saya AI guidance inside the signed-in YourComate workspace"
          width="926"
          height="1647"
          loading="eager"
          decoding="async"
          fetchPriority="high"
          draggable="false"
        />
      </div>
    </div>
  </div>
</section>
    </main>
  );
}
