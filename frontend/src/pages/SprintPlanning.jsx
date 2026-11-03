import { useState } from 'react';
import {
  ClipboardList,
  CalendarDays,
  CalendarRange,
  LayoutDashboard,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  TrendingUp,
  Users,
  ArrowRight,
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
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, description: 'Your planning workspace' },
  { id: 'monthly', label: 'Monthly Planning', icon: CalendarDays, description: 'Set your monthly priorities' },
  { id: 'weekly', label: 'Weekly & Day-Wise', icon: CalendarRange, description: 'Plan and report daily work' },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck, description: 'Review submitted plans' },
  { id: 'performance', label: 'My Performance', icon: TrendingUp, description: 'Review your progress' },
  { id: 'team_performance', label: 'Team Performance', icon: Users, description: 'Review team progress' }
];

const workflow = [
  {
    title: 'Monthly Planning',
    detail: 'Create your monthly plan and submit it to your assigned reviewer.',
    icon: CalendarDays
  },
  {
    title: 'Weekly Planning',
    detail: 'Organize weekly activities under your approved monthly plan.',
    icon: CalendarRange
  },
  {
    title: 'Day-Wise Work',
    detail: 'Update each activity with its status, evidence, or a reason if unfinished.',
    icon: ClipboardList
  },
  {
    title: 'Approvals & Review',
    detail: 'Assigned reviewers approve plans and team compilations as applicable.',
    icon: FileCheck2
  }
];

// All styles are scoped to this page. Existing project buttons, cards,
// light/dark CSS variables, and child-page layouts are left untouched.
const pageStyles = `
  .sprint-planning-shell {
    --sprint-accent: var(--primary, var(--color-primary, #2563eb));
    --sprint-text: var(--text, var(--text-primary, #0f172a));
    --sprint-muted: var(--text-muted, #64748b);
    --sprint-border: var(--border, var(--border-color, #e2e8f0));
    --sprint-panel: var(--surface, var(--card-bg, var(--surface-primary, #fff)));
    --sprint-soft: var(--surface-secondary, #f8fafc);
    color: var(--sprint-text);
    width: 100%;
    max-width: 1450px;
    margin: 0 auto;
    padding: clamp(12px, 2vw, 28px);
    min-width: 0;
  }
  .sprint-planning-shell *, .sprint-planning-shell *::before,
  .sprint-planning-shell *::after { box-sizing: border-box; }
  .sprint-planning-shell .sprint-heading {
    display: flex; align-items: flex-start; gap: 14px;
    margin-bottom: clamp(18px, 2.5vw, 26px);
  }
  .sprint-planning-shell .sprint-heading-icon {
    width: 48px; height: 48px; flex: 0 0 48px;
    display: grid; place-items: center; border-radius: 14px;
    color: var(--sprint-accent);
    background: var(--sprint-soft);
    border: 1px solid var(--sprint-border);
  }
  .sprint-planning-shell .sprint-page-title {
    margin: 0 0 7px; font-size: clamp(22px, 3vw, 30px);
    line-height: 1.18; letter-spacing: -0.025em;
  }
  .sprint-planning-shell .sprint-page-subtitle {
    margin: 0; max-width: 780px; color: var(--sprint-muted);
    line-height: 1.6; font-size: 14px;
  }
  .sprint-planning-shell .sprint-nav {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px; margin-bottom: clamp(16px, 2.5vw, 24px);
  }
  .sprint-planning-shell .sprint-nav-button {
    width: 100%; min-width: 0; min-height: 68px;
    display: flex; align-items: center; gap: 11px;
    padding: 12px 14px; border: 1px solid var(--sprint-border);
    border-radius: 12px; background: var(--sprint-panel);
    color: var(--sprint-text); font: inherit; text-align: left;
    cursor: pointer; transition: border-color 160ms, background 160ms, box-shadow 160ms;
  }
  .sprint-planning-shell .sprint-nav-button:hover {
    border-color: var(--sprint-accent); background: var(--sprint-soft);
  }
  .sprint-planning-shell .sprint-nav-button[aria-current='page'] {
    border-color: var(--sprint-accent);
    box-shadow: inset 0 0 0 1px var(--sprint-accent);
    background: var(--sprint-soft);
  }
  .sprint-planning-shell .sprint-nav-icon {
    flex: 0 0 auto; width: 38px; height: 38px;
    display: grid; place-items: center; border-radius: 10px;
    background: var(--sprint-soft); color: var(--sprint-accent);
  }
  .sprint-planning-shell .sprint-nav-copy { min-width: 0; flex: 1; }
  .sprint-planning-shell .sprint-nav-title {
    display: block; font-size: 13px; font-weight: 650; line-height: 1.35;
  }
  .sprint-planning-shell .sprint-nav-description {
    display: block; color: var(--sprint-muted);
    font-size: 11px; line-height: 1.5; margin-top: 3px;
  }
  .sprint-planning-shell .sprint-nav-arrow {
    flex: 0 0 auto; color: var(--sprint-muted);
  }
  .sprint-planning-shell .sprint-main { min-width: 0; }
  .sprint-planning-shell .sprint-overview {
    padding: clamp(16px, 2.5vw, 28px); border: 1px solid var(--sprint-border);
    border-radius: 16px; background: var(--sprint-panel);
  }
  .sprint-planning-shell .sprint-section-head {
    display: flex; flex-direction: column; gap: 6px;
    margin-bottom: 18px;
  }
  .sprint-planning-shell .sprint-section-title {
    margin: 0; font-size: clamp(17px, 2vw, 21px); line-height: 1.3;
  }
  .sprint-planning-shell .sprint-section-description {
    margin: 0; color: var(--sprint-muted); line-height: 1.6; font-size: 13px;
  }
  .sprint-planning-shell .sprint-flow-grid {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
  }
  .sprint-planning-shell .sprint-flow-card {
    min-width: 0; padding: 18px; border: 1px solid var(--sprint-border);
    border-radius: 12px; background: var(--sprint-panel);
  }
  .sprint-planning-shell .sprint-flow-card-top {
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; margin-bottom: 16px;
  }
  .sprint-planning-shell .sprint-flow-icon {
    display: grid; place-items: center; width: 40px; height: 40px;
    color: var(--sprint-accent); background: var(--sprint-soft);
    border-radius: 11px;
  }
  .sprint-planning-shell .sprint-step-number {
    font-size: 11px; color: var(--sprint-muted); white-space: nowrap;
  }
  .sprint-planning-shell .sprint-flow-title {
    margin: 0 0 8px; font-size: 14px; line-height: 1.4; font-weight: 650;
  }
  .sprint-planning-shell .sprint-flow-detail {
    margin: 0; font-size: 12px; line-height: 1.65; color: var(--sprint-muted);
  }
  .sprint-planning-shell .sprint-actions {
    display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px;
  }
  .sprint-planning-shell .sprint-actions button {
    display: inline-flex; align-items: center; justify-content: center;
    gap: 8px; min-height: 43px; white-space: normal; text-align: center;
  }
  .sprint-planning-shell .sprint-help-note {
    display: flex; align-items: flex-start; gap: 12px;
    margin-top: 22px; padding: 15px 16px; border-radius: 12px;
    border: 1px solid var(--sprint-border);
    background: var(--sprint-soft);
    font-size: 13px; line-height: 1.65;
  }
  .sprint-planning-shell .sprint-help-note svg {
    flex: 0 0 auto; margin-top: 2px; color: var(--sprint-accent);
  }
  .sprint-planning-shell .sprint-help-note p { margin: 0; }
  .sprint-planning-shell button:focus-visible {
    outline: 3px solid var(--sprint-accent); outline-offset: 3px;
  }
  @media (max-width: 1100px) {
    .sprint-planning-shell .sprint-flow-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 760px) {
    .sprint-planning-shell .sprint-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .sprint-planning-shell .sprint-nav-button { min-height: 62px; padding: 10px; }
    .sprint-planning-shell .sprint-nav-icon { width: 34px; height: 34px; }
    .sprint-planning-shell .sprint-nav-description,
    .sprint-planning-shell .sprint-nav-arrow { display: none; }
    .sprint-planning-shell .sprint-flow-grid { gap: 10px; }
  }
  @media (max-width: 420px) {
    .sprint-planning-shell .sprint-heading { gap: 10px; }
    .sprint-planning-shell .sprint-heading-icon {
      width: 42px; height: 42px; flex-basis: 42px;
    }
    .sprint-planning-shell .sprint-nav { gap: 8px; }
    .sprint-planning-shell .sprint-nav-title { font-size: 12px; }
    .sprint-planning-shell .sprint-flow-grid { grid-template-columns: 1fr; }
    .sprint-planning-shell .sprint-actions { flex-direction: column; }
    .sprint-planning-shell .sprint-actions button { width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .sprint-planning-shell .sprint-nav-button { transition: none; }
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
          <ClipboardList size={24} strokeWidth={1.9} />
        </div>
        <div>
          <h1 className="sprint-page-title">Sprint Planning</h1>
          <p className="sprint-page-subtitle">
            Plan your month, organize weekly work, report daily progress,
            and review approvals in one workspace.
          </p>
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
                <span className="sprint-nav-description">{item.description}</span>
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
              <h2 id="sprint-workflow-heading" className="sprint-section-title">
                Your planning workflow
              </h2>
              <p className="sprint-section-description">
                Start with a monthly plan, then organize weekly and day-wise activities.
                Every weekly plan is linked to a monthly plan.
              </p>
            </div>

            <div className="sprint-flow-grid">
              {workflow.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="sprint-flow-card">
                    <div className="sprint-flow-card-top">
                      <span className="sprint-flow-icon" aria-hidden="true">
                        <Icon size={21} strokeWidth={1.9} />
                      </span>
                      <span className="sprint-step-number">Step {index + 1}</span>
                    </div>
                    <h3 className="sprint-flow-title">{item.title}</h3>
                    <p className="sprint-flow-detail">{item.detail}</p>
                  </div>
                );
              })}
            </div>

            <div className="sprint-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setActive('monthly')}
              >
                <CalendarDays size={17} aria-hidden="true" />
                Open Monthly Planning
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActive('weekly')}
              >
                <CalendarRange size={17} aria-hidden="true" />
                Open Weekly & Day-Wise
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="sprint-help-note">
              <CircleHelp size={19} aria-hidden="true" />
              <p>
                <strong>Daily reporting and checkout:</strong>{' '}
                Completed work requires evidence. Incomplete and in-progress work
                requires a valid explanation. Checkout is permitted once all
                required updates have been submitted.
              </p>
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
