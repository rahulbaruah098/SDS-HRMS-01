import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Stat from '../components/Stat';
import Table from '../components/Table';

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

export default function AdminDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadDashboard() {
    try {
      setLoading(true);
      setMessage('');

      const dashboardData = await api('/dashboard/admin');
      setData(dashboardData);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Unable to load admin dashboard');
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

  const statItems = [
    ['Total Employees', stats['Total Employees'] || 0],
    ['Present Today', stats['Present Today'] || 0],
    ['Late Today', stats['Late Today'] || 0],
    ['Early Checkout Today', stats['Early Checkout Today'] || 0],
    ['Holiday Work Today', stats['Holiday Work Today'] || 0],
    ['WFH Today', stats['WFH Today'] || 0],
    ['Field Today', stats['Field Today'] || 0],
    ['Absent Today', stats['Absent Today'] || 0],
    ['Pending Leaves', stats['Pending Leaves'] || 0],
    ['Pending WFH/Field', stats['Pending WFH/Field'] || 0],
    ['Available Comp-Off', stats['Available Comp-Off'] || 0],
    ['Open Tickets', stats['Open Tickets'] || 0],
    ['Pending Expenses', stats['Pending Expenses'] || 0],
    ['Candidates', stats.Candidates || 0],
    ['Assets Assigned', stats['Assets Assigned'] || 0],
    ['Departments', stats.Departments || 0],
    ['Designations', stats.Designations || 0],
  ];

  const recentAttendanceRows = (data?.recent_attendance || []).map((row) => ({
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    state: row.state || '—',
    date: row.date || '—',
    mode: modeLabel(row.mode),
    status: statusLabel(row.status),
    check_in: formatDateTime(row.check_in),
    check_out: formatDateTime(row.check_out),
    late_reason: row.late_reason || '—',
    early_checkout_reason: row.early_checkout_reason || '—',
    verified: row.verified_by_ro ? 'Yes' : 'No',
  }));

  const pendingLeaveRows = (data?.pending?.leave_requests || []).map((row) => ({
    employee_name: row.employee_name || '—',
    leave_type: row.leave_type || '—',
    from_date: row.from_date || '—',
    to_date: row.to_date || '—',
    leave_days: row.leave_days ?? '—',
    stage: row.approval_stage_label || statusLabel(row.approval_stage),
    reason: row.reason || '—',
    status: statusLabel(row.status),
  }));

  const pendingModeRows = (data?.pending?.attendance_mode_requests || []).map(
    (row) => ({
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      mode: modeLabel(row.mode),
      date: row.date || '—',
      reason: row.reason || '—',
      field_location: row.field_location || '—',
      status: statusLabel(row.status),
    }),
  );

  const recentCompOffRows = (data?.recent_compoffs || []).map((row) => ({
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    earned_date: row.earned_date || '—',
    valid_until: row.valid_until || '—',
    claimed_date: row.claimed_date || '—',
    holiday: row.holiday_title || '—',
    status: statusLabel(row.status),
  }));

  const holidayRows = (data?.holidays_today || []).map((row) => ({
    state: row.state || '—',
    date: row.date || '—',
    title: row.title || '—',
    message: row.message || '—',
    status: statusLabel(row.status),
  }));

  const recentEmployeeRows = (data?.recent_employees || []).map((row) => ({
    name: row.name || '—',
    employee_id: row.employee_id || row.emp_code || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    state: row.state || row.branch || '—',
    team_leader: row.team_leader_name || '—',
    reporting_officer: row.reporting_officer_name || '—',
    status: row.status || row.employment_status || '—',
  }));

  const departmentRows = (data?.department_summary || []).map((row) => ({
    department: row.department || 'Unassigned',
    employees: row.count || 0,
  }));

  const designationRows = (data?.designation_summary || []).map((row) => ({
    designation: row.designation || 'Unassigned',
    employees: row.count || 0,
  }));

  const pendingExpenseRows = (data?.pending?.expenses || []).map((row) => ({
    employee_name: row.employee_name || '—',
    type: row.type || '—',
    amount: row.amount ?? '—',
    description: row.description || '—',
    status: statusLabel(row.status),
  }));

  const ticketRows = (data?.pending?.tickets || []).map((row) => ({
    title: row.title || '—',
    category: row.category || '—',
    priority: statusLabel(row.priority),
    status: statusLabel(row.status),
  }));

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Admin Dashboard</span>

          <h1>HRMS Control Center</h1>

          <p>
            Monitor attendance, late entries, WFH/Field requests, holidays,
            leave approvals, comp-off credits, employees, tickets and expenses
            from one dashboard.
          </p>

          <div className="hero-actions">
            <button
              type="button"
              className="primary"
              onClick={() => goTo('attendance')}
            >
              Attendance
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
              onClick={() => goTo('employees')}
            >
              Employees
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
              onClick={loadDashboard}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </section>

      {message && <div className="inline-message">{message}</div>}

      {loading && (
        <section className="panel">
          <p>Loading dashboard...</p>
        </section>
      )}

      <section className="stats-grid">
        {statItems.map(([label, value]) => (
          <Stat key={label} label={label} value={value} />
        ))}
      </section>

      {holidayRows.length > 0 && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>Today&apos;s State-wise Holidays</h3>
              <p>
                Holidays configured by HR/Admin for today. Employees from these
                states will see the holiday message on their dashboard and
                attendance page.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('holiday_calendar')}
            >
              Manage Holidays
            </button>
          </div>

          <Table rows={holidayRows} maxColumns={8} />
        </section>
      )}

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending Leave Requests</h3>
              <p>
                Requests waiting for Team Leader, Reporting Officer or HR
                approval.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('leave_requests')}
            >
              Open Leaves
            </button>
          </div>

          <Table rows={pendingLeaveRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending WFH / Field Requests</h3>
              <p>
                Employees can check in from WFH or Field only after approval.
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

          <Table rows={pendingModeRows} maxColumns={8} />
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Recent Attendance</h3>
            <p>
              Latest check-in and check-out records with mode, state, late
              reason and early checkout details.
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
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Recent Comp-Off Credits</h3>
            <p>
              Comp-off is generated when an employee works on a weekly or
              state-wise holiday.
            </p>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('compoff_credits')}
          >
            View Comp-Off
          </button>
        </div>

        <Table rows={recentCompOffRows} maxColumns={8} />
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending Expenses</h3>
              <p>Expense claims waiting for approval or finance action.</p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('expenses')}
            >
              Open Expenses
            </button>
          </div>

          <Table rows={pendingExpenseRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Open Tickets</h3>
              <p>Open and in-progress employee tickets.</p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('tickets')}
            >
              Open Tickets
            </button>
          </div>

          <Table rows={ticketRows} maxColumns={8} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Recent Employees</h3>
              <p>Latest active employee records.</p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('employees')}
            >
              Employee Master
            </button>
          </div>

          <Table rows={recentEmployeeRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Department Summary</h3>
              <p>Employee count by department.</p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('departments')}
            >
              Departments
            </button>
          </div>

          <Table rows={departmentRows} maxColumns={8} />
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Designation Summary</h3>
            <p>Employee count by designation.</p>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('designations')}
          >
            Designations
          </button>
        </div>

        <Table rows={designationRows} maxColumns={8} />
      </section>
    </div>
  );
}