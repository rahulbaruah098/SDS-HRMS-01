import { useState } from 'react';
import {
  ClipboardList,
  CalendarDays,
  CalendarRange,
  LayoutDashboard,
  ChevronRight,
  ShieldCheck,
  TrendingUp,
  Users,
  FileCheck2,
  CircleHelp
} from 'lucide-react';

import SprintMonthlyPlanning from './SprintMonthlyPlanning';
import SprintWeeklyPlanning from './SprintWeeklyPlanning';
import SprintApprovals from './SprintApprovals';
import SprintPerformanceDashboard from './SprintPerformanceDashboard';
import SprintTeamDashboard from './SprintTeamDashboard';

// Keep section identifiers and linked pages unchanged so existing
// Sprint Planning navigation and permissions continue to work.
const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'monthly', label: 'Monthly Planning', icon: CalendarDays },
  { id: 'weekly', label: 'Weekly & Day-Wise', icon: CalendarRange },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { id: 'performance', label: 'My Performance', icon: TrendingUp },
  { id: 'team_performance', label: 'Team Performance', icon: Users }
];

const workflow = [
  { title: 'Monthly plan', detail: 'Set priorities and submit for approval.', icon: CalendarDays },
  { title: 'Weekly plan', detail: 'Schedule work under the monthly plan.', icon: CalendarRange },
  { title: 'Daily updates', detail: 'Record progress and supporting evidence.', icon: ClipboardList },
  { title: 'Review', detail: 'Your assigned reviewer checks submissions.', icon: FileCheck2 }
];

// All styles are scoped to this page. Existing project buttons, cards,
// light/dark CSS variables, and child-page layouts are left untouched.
const pageStyles = `
  /* YC_FIX03G13_OVERVIEW_REDESIGN */
  .sprint-planning-shell {
    --sprint-accent: var(--primary, #6254da);
    --sprint-text: var(--text, #192441);
    --sprint-muted: var(--text-muted, #61708b);
    --sprint-border: var(--border, #dee5f1);
    --sprint-panel: var(--surface, #fff);
    --sprint-soft: var(--surface-secondary, #f6f8fc);
    width:100%; max-width:1400px; min-width:0; margin:0 auto;
    padding:clamp(12px,1.7vw,24px); color:var(--sprint-text);
  }
  .sprint-planning-shell *, .sprint-planning-shell *::before,
  .sprint-planning-shell *::after { box-sizing:border-box; }
  .sprint-planning-shell .sprint-heading {
    display:flex; gap:12px; align-items:center; margin:0 0 18px;
  }
  .sprint-planning-shell .sprint-heading-icon {
    flex:0 0 42px; width:42px; height:42px; display:grid; place-items:center;
    background:var(--sprint-soft); border:1px solid var(--sprint-border);
    color:var(--sprint-accent); border-radius:12px;
  }
  .sprint-planning-shell .sprint-page-title {
    margin:0 0 3px; font-size:clamp(20px,2vw,25px);
    font-weight:750; line-height:1.25; letter-spacing:-.02em;
  }
  .sprint-planning-shell .sprint-page-subtitle {
    margin:0; color:var(--sprint-muted); font-size:13px; line-height:1.5;
  }
  .sprint-planning-shell .sprint-nav {
    display:grid; grid-template-columns:repeat(3,minmax(0,1fr));
    gap:8px; margin:0 0 16px;
  }
  .sprint-planning-shell .sprint-nav-button {
    appearance:none; width:100%; min-width:0; min-height:49px;
    display:flex; align-items:center; gap:10px; padding:9px 12px;
    border:1px solid var(--sprint-border); border-radius:10px;
    background:var(--sprint-panel); color:var(--sprint-text);
    cursor:pointer; font:inherit; text-align:left;
    transition:border-color .15s,background .15s; touch-action:manipulation;
  }
  .sprint-planning-shell .sprint-nav-button:hover {
    border-color:var(--sprint-accent); background:var(--sprint-soft);
  }
  .sprint-planning-shell .sprint-nav-button[aria-current='page'] {
    border-color:var(--sprint-accent); background:var(--sprint-soft);
    box-shadow:inset 3px 0 0 var(--sprint-accent);
  }
  .sprint-planning-shell .sprint-nav-icon {
    display:grid; place-items:center; flex:0 0 30px; width:30px; height:30px;
    color:var(--sprint-accent); background:var(--sprint-soft); border-radius:8px;
  }
  .sprint-planning-shell .sprint-nav-copy { flex:1; min-width:0; }
  .sprint-planning-shell .sprint-nav-title {
    display:block; font-size:13px; font-weight:650; line-height:1.4; overflow-wrap:anywhere;
  }
  .sprint-planning-shell .sprint-nav-arrow { color:var(--sprint-muted); flex-shrink:0; }
  .sprint-planning-shell .sprint-main { min-width:0; }
  .sprint-planning-shell .sprint-overview {
    border:1px solid var(--sprint-border); background:var(--sprint-panel);
    border-radius:14px; padding:clamp(16px,2vw,24px); box-shadow:none;
  }
  .sprint-planning-shell .sprint-section-head { margin:0 0 16px; }
  .sprint-planning-shell .sprint-section-title {
    margin:0 0 4px; font-size:clamp(16px,1.8vw,19px); font-weight:700; line-height:1.35;
  }
  .sprint-planning-shell .sprint-section-description {
    margin:0; color:var(--sprint-muted); font-size:12px; line-height:1.55;
  }
  .sprint-planning-shell .sprint-flow-grid {
    display:grid; grid-template-columns:repeat(4,minmax(0,1fr));
    gap:10px; margin:0; padding:0; list-style:none;
  }
  .sprint-planning-shell .sprint-flow-card {
    min-width:0; margin:0; padding:14px; border:1px solid var(--sprint-border);
    border-radius:11px; background:var(--sprint-soft);
  }
  .sprint-planning-shell .sprint-flow-card-top {
    display:flex; align-items:center; justify-content:space-between; margin:0 0 9px;
  }
  .sprint-planning-shell .sprint-flow-icon {
    display:grid; place-items:center; width:30px; height:30px;
    color:var(--sprint-accent); border-radius:8px; background:var(--sprint-panel);
  }
  .sprint-planning-shell .sprint-step-number {
    font-size:11px; font-weight:700; color:var(--sprint-muted);
  }
  .sprint-planning-shell .sprint-flow-title {
    margin:0 0 4px; font-size:13px; font-weight:700; line-height:1.4;
  }
  .sprint-planning-shell .sprint-flow-detail {
    margin:0; font-size:12px; color:var(--sprint-muted); line-height:1.55;
  }
  .sprint-planning-shell .sprint-help-note {
    display:flex; align-items:flex-start; gap:10px; margin:15px 0 0;
    border-top:1px solid var(--sprint-border); padding:13px 0 0;
    color:var(--sprint-muted); font-size:12px; line-height:1.6;
  }
  .sprint-planning-shell .sprint-help-note svg {
    flex:0 0 auto; color:var(--sprint-accent); margin-top:1px;
  }
  .sprint-planning-shell .sprint-help-note p { margin:0; }
  .sprint-planning-shell button:focus-visible {
    outline:3px solid var(--sprint-accent); outline-offset:2px;
  }
  @media(max-width:1024px) {
    .sprint-planning-shell .sprint-flow-grid {grid-template-columns:repeat(2,minmax(0,1fr));}
  }
  @media(max-width:760px) {
    .sprint-planning-shell .sprint-nav {grid-template-columns:repeat(2,minmax(0,1fr));}
    .sprint-planning-shell .sprint-nav-arrow {display:none;}
  }
  @media(max-width:440px) {
    .sprint-planning-shell {
      padding:12px max(10px,env(safe-area-inset-right)) 20px max(10px,env(safe-area-inset-left));
    }
    .sprint-planning-shell .sprint-nav-button {padding:9px; gap:7px;}
    .sprint-planning-shell .sprint-nav-title {font-size:12px;}
    .sprint-planning-shell .sprint-flow-grid {grid-template-columns:1fr;}
    .sprint-planning-shell .sprint-flow-card {padding:12px 13px;}
  }
  @media(prefers-reduced-motion:reduce) {
    .sprint-planning-shell .sprint-nav-button {transition:none;}
  }
`;

export default function SprintPlanning({ user }) {
  const [active, setActive] = useState('overview');

  // UI visibility only. The backend remains the authority
  // for employee relationships, approvals and data access.
  const roleValues = [
    user?.role,
    user?.primary_role,
    ...(Array.isArray(user?.roles) ? user.roles : []),
    ...(Array.isArray(user?.capabilities) ? user.capabilities : []),
    ...(Array.isArray(user?.effective_roles) ? user.effective_roles : [])
  ];

  const roles = new Set(
    roleValues
      .filter(Boolean)
      .map(value => String(value).trim().toLowerCase())
  );

  const managementRoles = [
    'admin', 'hr', 'hr_admin', 'hr_manager',
    'manager', 'team_leader', 'reporting_officer', 'ro'
  ];

  const isManagement = managementRoles.some(role => roles.has(role))
    || user?.is_team_leader === true
    || user?.is_reporting_officer === true;

  const visibleSections = sections.filter(item => {
    if (item.id === 'team_performance' || item.id === 'approvals') {
      return isManagement;
    }
    return true;
  });

  if (roles.has('super_admin')) {
    return (
      <section className="panel" role="alert">
        <h2>Access Restricted</h2>
        <p>Sprint Planning is not available to administrators.</p>
      </section>
    );
  }

  return (
    <div className="sprint-planning sprint-planning-shell">
      <style>{pageStyles}</style>
      <header className="sprint-heading">
        <div className="sprint-heading-icon" aria-hidden="true">
          <ClipboardList size={21} strokeWidth={1.9} />
        </div>
        <div>
          <h1 className="sprint-page-title">Planning workspace</h1>
          <p className="sprint-page-subtitle">Manage plans, daily updates and approvals.</p>
        </div>
      </header>

      <nav className="sprint-nav" aria-label="Sprint Planning navigation">
        {visibleSections.map((item) => {
          const Icon = item.icon;
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className="sprint-nav-button"
              onClick={() => setActive(item.id)}
              aria-current={selected ? 'page' : undefined}
            >
              <span className="sprint-nav-icon" aria-hidden="true">
                <Icon size={19} strokeWidth={1.9} />
              </span>
              <span className="sprint-nav-copy">
                <span className="sprint-nav-title">{item.label}</span>
              </span>
              <ChevronRight className="sprint-nav-arrow" size={16} aria-hidden="true" />
            </button>
          );
        })}
      </nav>

      <main className="sprint-main" aria-label="Sprint Planning content">
        {active === 'overview' && (
          <section className="card sprint-overview" aria-labelledby="sprint-workflow-heading">
            <div className="sprint-section-head">
              <h2 id="sprint-workflow-heading" className="sprint-section-title">Planning workflow</h2>
              <p className="sprint-section-description">Four steps from planning to review.</p>
            </div>
            <ol className="sprint-flow-grid">
              {workflow.map((item, index) => {
                const Icon = item.icon;
                return (
                  <li key={item.title} className="sprint-flow-card">
                    <div className="sprint-flow-card-top">
                      <span className="sprint-flow-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
                      <span className="sprint-step-number">{String(index + 1).padStart(2, '0')}</span>
                    </div>
                    <h3 className="sprint-flow-title">{item.title}</h3>
                    <p className="sprint-flow-detail">{item.detail}</p>
                  </li>
                );
              })}
            </ol>
            <div className="sprint-help-note">
              <CircleHelp size={17} aria-hidden="true" />
              <p><strong>Daily reports:</strong> Add evidence for completed work or a reason for unfinished work before checkout.</p>
            </div>
          </section>
        )}

        {active === 'monthly' && <SprintMonthlyPlanning />}
        {active === 'weekly' && <SprintWeeklyPlanning />}
        {isManagement && active === 'approvals' && <SprintApprovals />}
        {active === 'performance' && <SprintPerformanceDashboard />}
        {isManagement && active === 'team_performance' && <SprintTeamDashboard />}
      </main>
    </div>
  );
}
