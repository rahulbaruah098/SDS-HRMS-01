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
  Users
} from 'lucide-react';

import SprintMonthlyPlanning from './SprintMonthlyPlanning';
import SprintWeeklyPlanning from './SprintWeeklyPlanning';
import SprintApprovals from './SprintApprovals';
import SprintPerformanceDashboard from './SprintPerformanceDashboard';
import SprintTeamDashboard from './SprintTeamDashboard';

const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'monthly', label: 'Monthly Planning', icon: CalendarDays },
  { id: 'weekly', label: 'Weekly & Day-Wise', icon: CalendarRange },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { id: 'performance', label: 'My Performance', icon: TrendingUp },
  { id: 'team_performance', label: 'Team Performance', icon: Users }
];

const workflow = [
  {
    title: 'Monthly Planning',
    detail: 'Create a monthly plan and submit it to your Team Leader.',
    icon: CalendarDays
  },
  {
    title: 'Weekly Planning',
    detail: 'Prepare each weekly planning sheet under your approved monthly plan.',
    icon: CalendarRange
  },
  {
    title: 'Day-Wise Work',
    detail: 'Plan each day and report completed or unfinished activities.',
    icon: ClipboardList
  },
  {
    title: 'Approvals',
    detail: 'Daily changes require Reporting Team Leader and Reporting Officer approval.',
    icon: ShieldCheck
  }
];

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
    'super_admin', 'admin', 'hr', 'hr_admin', 'hr_manager',
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


  return (
    <div
      className="sprint-planning"
      style={{
        maxWidth: 1450,
        margin: '0 auto',
        padding: 'clamp(12px, 2vw, 28px)'
      }}
    >
      <header style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <ClipboardList size={28} />
          <h1 style={{ margin: 0, fontSize: 'clamp(24px, 3vw, 30px)' }}>
            Sprint Planning
          </h1>
        </div>

        <p style={{ color: 'var(--text-muted, #64748b)', lineHeight: 1.6 }}>
          Manage monthly plans, weekly planning sheets, day-wise work,
          evidence and reporting approvals in one place.
        </p>
      </header>

      <nav
        aria-label="Sprint Planning navigation"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 24
        }}
      >
        {visibleSections.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              className={
                active === item.id
                  ? 'btn btn-primary'
                  : 'btn btn-secondary'
              }
              onClick={() => setActive(item.id)}
              aria-current={
                active === item.id ? 'page' : undefined
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {active === 'overview' && (
        <section
          className="card"
          style={{
            padding: 'clamp(16px, 2vw, 26px)',
            borderRadius: 15
          }}
        >
          <h2 style={{ fontSize: 20, marginTop: 0 }}>
            My Sprint Planning Workflow
          </h2>

          <p style={{ color: 'var(--text-muted, #64748b)' }}>
            Every weekly plan belongs to a monthly plan.
            Every day-wise activity belongs to a weekly plan.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
              gap: 14,
              marginTop: 20
            }}
          >
            {workflow.map((item, index) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.title}
                  style={{
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: 12,
                    padding: 17
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 15
                    }}
                  >
                    <Icon size={22} />
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      Step {index + 1}
                    </span>
                  </div>

                  <strong>{item.title}</strong>

                  <p style={{
                    fontSize: 13,
                    color: 'var(--text-muted, #64748b)',
                    lineHeight: 1.6
                  }}>
                    {item.detail}
                  </p>
                </div>
              );
            })}
          </div>

          <div style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            marginTop: 24
          }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setActive('monthly')}
            >
              <CalendarDays size={16} />
              Open Monthly Planning
              <ChevronRight size={16} />
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActive('weekly')}
            >
              <CalendarRange size={16} />
              Open Weekly & Day-Wise Planning
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 12,
              padding: 16,
              marginTop: 24,
              borderRadius: 10,
              background: 'var(--surface-secondary, #f8fafc)'
            }}
          >
            <CheckCircle2 size={20} style={{ flexShrink: 0 }} />
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <strong>Daily reporting and checkout:</strong>
              {' '}Completed work requires evidence.
              Incomplete and in-progress work requires a valid
              explanation. Checkout is permitted after all required
              updates are submitted.
            </div>
          </div>
        </section>
      )}

      {active === 'monthly' && (
        <SprintMonthlyPlanning />
      )}

      {active === 'weekly' && (
        <SprintWeeklyPlanning />
      )}

      {isManagement && active === 'approvals' && (
        <SprintApprovals />
      )}

      {active === 'performance' && (
        <SprintPerformanceDashboard />
      )}

      {isManagement && active === 'team_performance' && (
        <SprintTeamDashboard />
      )}
    </div>
  );
}