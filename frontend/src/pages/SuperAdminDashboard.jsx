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

export default function SuperAdminDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    loadDashboard();
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

  const dashboardModules = allModules.filter(
    ([key]) => !['profile'].includes(key),
  );

  const tenantRows = tenants.map((row) => ({
    tenant_id: row.tenant_id || '—',
    name: row.name || '—',
    status: statusLabel(row.status),
    users: row.users || 0,
    employees: row.employees || 0,
    present_today: row.present_today || 0,
    late_today: row.late_today || 0,
    pending_wfh_field: row.pending_wfh_field || 0,
    pending_leaves: row.pending_leaves || 0,
    open_tickets: row.open_tickets || 0,
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

  return (
    <div className="page-grid">
      <section className="hero">
        <div>
          <span className="kicker">Platform Super Admin</span>

          <h1>Complete HRMS Control Center</h1>

          <p>
            Create companies, manage every tenant, reset any user password,
            change designations, edit complete user profiles, monitor
            attendance, holidays, WFH/Field requests, leave approvals, comp-off
            credits and audit every action across the SaaS platform.
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
              <h3>Companies / Tenants</h3>
              <p>
                Tenant-wise overview including users, employees, attendance,
                leaves, WFH/Field requests and open tickets.
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
          </div>
        </div>
      </section>

      <ModuleGrid modules={dashboardModules.slice(0, 16)} setPage={setPage} />
    </div>
  );
}