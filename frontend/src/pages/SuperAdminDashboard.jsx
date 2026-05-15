import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { allModules } from '../data/modules';
import Stat from '../components/Stat';
import Table from '../components/Table';
import ModuleGrid from '../components/ModuleGrid';

function formatDateTime(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function modeLabel(mode) {
  if (mode === 'wfh') return 'Work From Home';
  if (mode === 'field') return 'Field';
  if (mode === 'office') return 'Office';
  return mode || 'Office';
}

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function rolesLabel(value) {
  if (Array.isArray(value)) {
    return value.map(statusLabel).join(', ') || '—';
  }

  return value ? statusLabel(value) : '—';
}

function percentValue(value) {
  const number = Number(value || 0);

  if (Number.isNaN(number)) {
    return 0;
  }

  return Math.min(Math.max(number, 0), 100);
}

function projectName(project = {}) {
  return project.name || project.project_name || project.title || 'Untitled Project';
}

function ProjectProgressChart({ rows = [] }) {
  if (!rows.length) {
    return <div className="empty">No project progress chart data found.</div>;
  }

  return (
    <div className="sa-project-chart">
      {rows.map((row) => {
        const value = percentValue(row.average_progress);

        return (
          <div className="sa-project-chart-row" key={row.date}>
            <span>{String(row.date || '').slice(5) || '—'}</span>

            <div className="sa-project-chart-track">
              <div
                className="sa-project-chart-fill"
                style={{ width: `${value}%` }}
              />
            </div>

            <strong>{value}%</strong>
          </div>
        );
      })}
    </div>
  );
}

function DepartmentPerformanceBars({ rows = [] }) {
  if (!rows.length) {
    return <div className="empty">No department project performance data found.</div>;
  }

  return (
    <div className="sa-dept-bars">
      {rows.slice(0, 8).map((row) => {
        const value = percentValue(row.completion_rate);

        return (
          <div className="sa-dept-bar-card" key={row.department}>
            <div className="sa-dept-bar-head">
              <strong>{row.department || 'Unassigned'}</strong>
              <span>{value}%</span>
            </div>

            <div className="sa-dept-track">
              <div
                className="sa-dept-fill"
                style={{ width: `${value}%` }}
              />
            </div>

            <p>
              {row.completed_projects || 0} completed / {row.total_projects || 0} total projects
            </p>
          </div>
        );
      })}
    </div>
  );
}


function notificationBody(notification = {}) {
  return notification.body || notification.message || 'No details available.';
}

function notificationTargetLabel(notification = {}) {
  const scope = String(
    notification.target_scope ||
      notification.target ||
      notification.audience ||
      '',
  ).toLowerCase();

  if (scope === 'all_tenants' || scope === 'global') {
    return 'All Tenants';
  }

  if (scope === 'selected_tenant') {
    return notification.target_tenant_name || notification.target_tenant_id || 'Selected Tenant';
  }

  if (scope === 'selected_users') {
    return 'Selected Users';
  }

  return notification.tenant_name || notification.tenant_id || 'This Tenant';
}

function notificationStatusLabel(notification = {}) {
  if (notification.read === true || notification.status === 'read') {
    return 'Read';
  }

  return 'Unread';
}

function notificationPriorityLabel(value = '') {
  return statusLabel(value || 'normal');
}

export default function SuperAdminDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);

  async function loadDashboard() {
    try {
      setLoading(true);
      setMessage('');

      const dashboardData = await api('/dashboard/superadmin');
      setData(dashboardData);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Unable to load dashboard data');
    } finally {
      setLoading(false);
    }
  }

  async function loadNotifications() {
    try {
      setNotificationLoading(true);

      const data = await api('/notifications?limit=20');

      setNotifications(data.items || []);
      setNotificationUnreadCount(Number(data.unread_count || 0));
    } catch (error) {
      console.error(error);
      setNotifications([]);
      setNotificationUnreadCount(0);
    } finally {
      setNotificationLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    loadNotifications();
  }, []);

  function goTo(page) {
    if (typeof setPage === 'function') {
      setPage(page);
    }
  }

  const stats = data?.stats || {};
  const tenants = data?.tenants || [];
  const recentUsers = data?.recent_users || [];
  const recentAudit = data?.recent_audit || [];
  const recentAttendance = data?.recent_attendance || [];
  const pendingModeRequests = data?.pending_mode_requests || [];
  const projectAnalytics = data?.project_analytics || {};
  const projectSummary = projectAnalytics?.summary || {};
  const topDepartments =
    data?.top_performing_departments ||
    projectAnalytics?.top_performing_departments ||
    [];
  const departmentPerformance =
    data?.department_project_performance ||
    projectAnalytics?.department_performance ||
    [];
  const projectDailyChart =
    data?.project_daily_progress_chart ||
    projectAnalytics?.daily_progress_chart ||
    [];
  const teamLeaderPerformance = projectAnalytics?.team_leader_performance || [];
  const activeProjects = projectAnalytics?.active_projects || [];
  const completedProjects = projectAnalytics?.completed_projects || [];
  const recentNotifications = notifications.slice(0, 8);
  const notificationStats = {
    total: notifications.length,
    unread: notificationUnreadCount,
    popupEnabled: notifications.filter((item) => item.show_popup !== false).length,
    global: notifications.filter((item) => {
      const scope = String(item.target_scope || item.target || item.audience || '').toLowerCase();
      return scope === 'all_tenants' || scope === 'global';
    }).length,
  };

  const dashboardModules = allModules.filter(
    ([key]) => !['profile'].includes(key),
  );

  const tenantRows = tenants.map((row) => ({
    tenant_id: row.tenant_id || '—',
    name: row.name || '—',
    status: statusLabel(row.status),
    users: row.users || 0,
    employees: row.employees || 0,
    projects: row.projects || 0,
    active_projects: row.active_projects || 0,
    completed_projects: row.completed_projects || 0,
    present_today: row.present_today || 0,
    pending_leaves: row.pending_leaves || 0,
  }));

  const recentUserRows = recentUsers.map((row) => ({
    name: row.name || '—',
    email: row.email || '—',
    tenant_id: row.tenant_id || '—',
    roles: rolesLabel(row.roles),
    is_active: row.is_active ? 'Active' : 'Inactive',
    created_at: formatDateTime(row.created_at),
  }));

  const recentAttendanceRows = recentAttendance.map((row) => ({
    tenant_id: row.tenant_id || '—',
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    state: row.state || '—',
    date: row.date || '—',
    mode: modeLabel(row.mode),
    status: statusLabel(row.status),
    check_in: formatDateTime(row.check_in),
    check_out: formatDateTime(row.check_out),
    verified: row.verified_by_ro ? 'Yes' : 'No',
  }));

  const pendingModeRequestRows = pendingModeRequests.map((row) => ({
    tenant_id: row.tenant_id || '—',
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    mode: modeLabel(row.mode),
    date: row.date || '—',
    reason: row.reason || '—',
    field_location: row.field_location || '—',
    status: statusLabel(row.status),
  }));

  const recentAuditRows = recentAudit.map((row) => ({
    action: row.action || '—',
    entity: row.entity || '—',
    actor_email: row.actor_email || row.actor || '—',
    tenant_id: row.tenant_id || '—',
    created_at: formatDateTime(row.created_at),
  }));

  const topDepartmentRows = topDepartments.map((row) => ({
    department: row.department || 'Unassigned',
    total_projects: row.total_projects || 0,
    active_projects: row.active_projects || 0,
    completed_projects: row.completed_projects || 0,
    completion_rate: `${row.completion_rate || 0}%`,
    score: row.score || 0,
  }));

  const departmentPerformanceRows = departmentPerformance.map((row) => ({
    department: row.department || 'Unassigned',
    total_projects: row.total_projects || 0,
    active_projects: row.active_projects || 0,
    completed_projects: row.completed_projects || 0,
    completion_rate: `${row.completion_rate || 0}%`,
    performance_score: row.score || 0,
  }));

  const teamLeaderPerformanceRows = teamLeaderPerformance.map((row) => ({
    team_leader: row.team_leader_name || 'Unassigned',
    department: row.department || '—',
    total_projects: row.total_projects || 0,
    active_projects: row.active_projects || 0,
    completed_projects: row.completed_projects || 0,
    completion_rate: `${row.completion_rate || 0}%`,
  }));

  const activeProjectRows = activeProjects.slice(0, 10).map((project) => ({
    project_name: projectName(project),
    department: project.department || '—',
    team_leader: project.team_leader_name || '—',
    progress: `${percentValue(project.latest_progress)}%`,
    last_update: project.latest_progress_date || '—',
    updated_by: project.latest_progress_by_name || '—',
  }));

  const completedProjectRows = completedProjects.slice(0, 10).map((project) => ({
    project_name: projectName(project),
    department: project.department || '—',
    team_leader: project.team_leader_name || '—',
    completed_at: project.completed_at ? formatDateTime(project.completed_at) : '—',
    final_progress: `${percentValue(project.latest_progress)}%`,
  }));

  const notificationRows = recentNotifications.map((notification) => ({
    title: notification.title || 'Notification',
    message: notificationBody(notification),
    target: notificationTargetLabel(notification),
    priority: notificationPriorityLabel(notification.priority),
    type: statusLabel(notification.notification_type || 'general'),
    status: notificationStatusLabel(notification),
    popup: notification.show_popup === false ? 'No' : 'Yes',
    created_by: notification.created_by_name || notification.sender_name || 'System',
    created_at: formatDateTime(notification.created_at),
  }));

  return (
    <div className="page-grid">
      <style>{`
        .sa-project-hero {
          position: relative;
          overflow: hidden;
          border: 1px solid #e2e8f0;
          border-radius: 28px;
          padding: 24px;
          background:
            radial-gradient(circle at 8% 0%, rgba(79, 70, 229, .13), transparent 34%),
            radial-gradient(circle at 92% 10%, rgba(5, 150, 105, .13), transparent 34%),
            #ffffff;
          box-shadow: 0 18px 50px rgba(15, 23, 42, .08);
        }

        .sa-project-hero h2 {
          margin: 0;
          color: #0f172a;
          font-size: clamp(24px, 3vw, 36px);
          letter-spacing: -.04em;
        }

        .sa-project-hero p {
          margin: 8px 0 0;
          max-width: 860px;
          color: #64748b;
          line-height: 1.7;
        }

        .sa-project-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-top: 20px;
        }

        .sa-project-stat {
          border: 1px solid #e2e8f0;
          border-radius: 22px;
          background: #ffffff;
          padding: 18px;
          box-shadow: 0 12px 30px rgba(15, 23, 42, .07);
        }

        .sa-project-stat span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .sa-project-stat strong {
          display: block;
          margin-top: 8px;
          color: #0f172a;
          font-size: 30px;
          line-height: 1;
        }

        .sa-dept-bars {
          display: grid;
          gap: 12px;
        }

        .sa-dept-bar-card {
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 14px;
          background: #ffffff;
        }

        .sa-dept-bar-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .sa-dept-bar-head strong {
          color: #0f172a;
          font-size: 14px;
        }

        .sa-dept-bar-head span {
          color: #4338ca;
          font-size: 13px;
          font-weight: 900;
        }

        .sa-dept-track,
        .sa-project-chart-track {
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .sa-dept-track {
          height: 10px;
          margin-top: 10px;
        }

        .sa-dept-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #4f46e5, #059669);
        }

        .sa-dept-bar-card p {
          margin: 8px 0 0;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .sa-project-chart {
          display: grid;
          gap: 10px;
        }

        .sa-project-chart-row {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr) 48px;
          align-items: center;
          gap: 10px;
        }

        .sa-project-chart-row span,
        .sa-project-chart-row strong {
          color: #334155;
          font-size: 12px;
          font-weight: 900;
        }

        .sa-project-chart-track {
          height: 12px;
        }

        .sa-project-chart-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #4f46e5, #0284c7, #059669);
        }

        .sa-notification-list {
          display: grid;
          gap: 12px;
        }

        .sa-notification-card {
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 14px;
          background: #ffffff;
          box-shadow: 0 10px 26px rgba(15, 23, 42, .06);
        }

        .sa-notification-card.unread {
          border-color: #bfdbfe;
          background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
        }

        .sa-notification-card h4 {
          margin: 0 0 6px;
          color: #0f172a;
          font-size: 15px;
        }

        .sa-notification-card p {
          margin: 0;
          color: #475569;
          line-height: 1.55;
          font-size: 13px;
        }

        .sa-notification-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }

        .sa-notification-pill {
          border-radius: 999px;
          padding: 6px 9px;
          background: #eef4ff;
          color: #1d4ed8;
          font-size: 11px;
          font-weight: 900;
          text-transform: capitalize;
        }

        @media (max-width: 980px) {
          .sa-project-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 620px) {
          .sa-project-stats {
            grid-template-columns: 1fr;
          }

          .sa-project-hero {
            border-radius: 20px;
            padding: 16px;
          }
        }
      `}</style>

      <section className="hero">
        <div>
          <span className="kicker">Platform Super Admin</span>

          <h1>Complete HRMS Control Center</h1>

          <p>
            Create companies, manage every tenant, reset any user password,
            change designations, edit complete user profiles, monitor
            attendance, holidays, WFH/Field requests, leave approvals, comp-off
            credits, projects, department progress and audit every action across
            the SaaS platform.
          </p>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="primary"
            onClick={() => goTo('companies')}
          >
            Create Company
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('users')}
          >
            Manage Users
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('projects')}
          >
            Projects
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('attendance')}
          >
            Attendance
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('reports')}
          >
            Reports
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('password_requests')}
          >
            Password Requests
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('notifications')}
          >
            Notifications
          </button>

          <button
            type="button"
            className="secondary"
            onClick={loadDashboard}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="stats-grid">
        {Object.entries(stats).map(([key, value]) => (
          <Stat key={key} label={key} value={value} />
        ))}

        <Stat label="Notifications" value={notificationStats.total} />
        <Stat label="Unread Notifications" value={notificationStats.unread} />
        <Stat label="Global Notifications" value={notificationStats.global} />

        {loading && (
          <div className="panel">
            <p>Loading dashboard...</p>
          </div>
        )}

        {!loading && !message && !Object.keys(stats).length && (
          <div className="panel">
            <p>No dashboard stats available.</p>
          </div>
        )}
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Platform Notifications</h3>
              <p>
                Recent global and tenant-targeted notifications visible to Super Admin.
                Use the Notification Center to broadcast to all tenants or a selected tenant.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('notifications')}
            >
              Open Notification Center
            </button>
          </div>

          {notificationLoading ? (
            <div className="empty">Loading notifications...</div>
          ) : recentNotifications.length ? (
            <div className="sa-notification-list">
              {recentNotifications.slice(0, 4).map((notification) => (
                <div
                  key={notification._id || notification.id || `${notification.title}-${notification.created_at}`}
                  className={`sa-notification-card ${notification.read ? 'read' : 'unread'}`}
                >
                  <h4>{notification.title || 'Notification'}</h4>
                  <p>{notificationBody(notification)}</p>

                  <div className="sa-notification-meta">
                    <span className="sa-notification-pill">
                      {notificationStatusLabel(notification)}
                    </span>
                    <span className="sa-notification-pill">
                      {notificationTargetLabel(notification)}
                    </span>
                    <span className="sa-notification-pill">
                      {notificationPriorityLabel(notification.priority)}
                    </span>
                    <span className="sa-notification-pill">
                      {formatDateTime(notification.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">No recent notifications found.</div>
          )}
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Notification Summary</h3>
              <p>
                Super Admin can send platform-wide notifications or target a
                specific tenant from the Notification Center.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={loadNotifications}
              disabled={notificationLoading}
            >
              {notificationLoading ? 'Refreshing...' : 'Refresh Notifications'}
            </button>
          </div>

          <div className="sa-project-stats">
            <div className="sa-project-stat">
              <span>Total</span>
              <strong>{notificationStats.total}</strong>
            </div>

            <div className="sa-project-stat">
              <span>Unread</span>
              <strong>{notificationStats.unread}</strong>
            </div>

            <div className="sa-project-stat">
              <span>Popup Enabled</span>
              <strong>{notificationStats.popupEnabled}</strong>
            </div>

            <div className="sa-project-stat">
              <span>Global</span>
              <strong>{notificationStats.global}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="sa-project-hero">
        <div className="toolbar">
          <div>
            <span className="kicker">Managing Director Project Analytics</span>
            <h2>Department Performance & Project Progress</h2>
            <p>
              Track top-performing departments, active projects, completed
              projects, team leader performance and daily project progress from
              one executive dashboard.
            </p>
          </div>

          <button
            type="button"
            className="primary"
            onClick={() => goTo('projects')}
          >
            Open Projects
          </button>
        </div>

        <div className="sa-project-stats">
          <div className="sa-project-stat">
            <span>Total Projects</span>
            <strong>{projectSummary.total_projects || stats['Total Projects'] || 0}</strong>
          </div>

          <div className="sa-project-stat">
            <span>Active Projects</span>
            <strong>{projectSummary.active_projects || stats['Active Projects'] || 0}</strong>
          </div>

          <div className="sa-project-stat">
            <span>Completed Projects</span>
            <strong>{projectSummary.completed_projects || stats['Completed Projects'] || 0}</strong>
          </div>

          <div className="sa-project-stat">
            <span>Avg. Progress</span>
            <strong>{projectSummary.average_progress || 0}%</strong>
          </div>
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Top Performing Departments</h3>
              <p>
                Ranking is based on project completion rate and active project
                performance score.
              </p>
            </div>
          </div>

          <DepartmentPerformanceBars rows={topDepartments} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Daily Project Progress Graph</h3>
              <p>
                Average daily progress from all project progress updates.
              </p>
            </div>
          </div>

          <ProjectProgressChart rows={projectDailyChart} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Department Project Performance</h3>
              <p>
                Department-wise total, active, completed and completion rate.
              </p>
            </div>
          </div>

          <Table rows={departmentPerformanceRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Team Leader Project Performance</h3>
              <p>
                Project completion and active project status by Team Leader.
              </p>
            </div>
          </div>

          <Table rows={teamLeaderPerformanceRows} maxColumns={8} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Active Projects</h3>
              <p>Current projects still open for daily progress updates.</p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('projects')}
            >
              Manage Projects
            </button>
          </div>

          <Table rows={activeProjectRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Completed Projects</h3>
              <p>
                Completed projects are kept here for dashboard reporting and
                removed from active handover dropdowns.
              </p>
            </div>
          </div>

          <Table rows={completedProjectRows} maxColumns={8} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Companies / Tenants</h3>
              <p>
                Tenant-wise overview including users, employees, projects,
                attendance, leaves, WFH/Field requests and open tickets.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('companies')}
            >
              Manage Companies
            </button>
          </div>

          <Table rows={tenantRows} maxColumns={10} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Recent Users</h3>
              <p>Latest platform users without password data.</p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('users')}
            >
              Manage Users
            </button>
          </div>

          <Table rows={recentUserRows} maxColumns={8} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Recent Attendance</h3>
              <p>
                Latest attendance records across tenants, including Office,
                Work From Home and Field check-ins.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('attendance_logs')}
            >
              View Logs
            </button>
          </div>

          <Table rows={recentAttendanceRows} maxColumns={10} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending WFH / Field Requests</h3>
              <p>
                Cross-tenant WFH and Field attendance approval requests pending
                action.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('attendance_mode_requests')}
            >
              Review Requests
            </button>
          </div>

          <Table rows={pendingModeRequestRows} maxColumns={8} />
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Notification Records</h3>
            <p>Latest notification records with target scope, priority, status and popup setting.</p>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('notifications')}
          >
            Manage Notifications
          </button>
        </div>

        <Table rows={notificationRows} maxColumns={9} />
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Recent Audit</h3>
              <p>Latest system actions across the platform.</p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('audit_logs')}
            >
              Audit Logs
            </button>
          </div>

          <Table rows={recentAuditRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Quick Actions</h3>
              <p>Common platform management shortcuts.</p>
            </div>
          </div>

          <div className="mini-list">
            <button
              type="button"
              className="secondary"
              onClick={() => goTo('companies')}
            >
              Manage Companies / Tenants
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('users')}
            >
              Manage Users
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('employees')}
            >
              Employee Master
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('projects')}
            >
              Project Management
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('attendance')}
            >
              Attendance Management
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('leave_requests')}
            >
              Leave Management
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('leave_balances')}
            >
              Leave Balances
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('holiday_calendar')}
            >
              Holiday Calendar
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('attendance_mode_requests')}
            >
              WFH / Field Requests
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('compoff_credits')}
            >
              Comp-Off Credits
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('reports')}
            >
              Reports Center
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('departments')}
            >
              Manage Departments
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('designations')}
            >
              Manage Designations
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('password_requests')}
            >
              Review Password Requests
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('notifications')}
            >
              Send Notifications
            </button>
          </div>
        </div>
      </section>

      <ModuleGrid modules={dashboardModules.slice(0, 16)} setPage={setPage} />
    </div>
  );
}