import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import Stat from '../components/Stat';
import Table from '../components/Table';

function formatDate(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

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

function leaveTypeLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized === 'CL' || normalized === 'CASUAL LEAVE') {
    return 'Casual Leave';
  }

  if (normalized === 'EL' || normalized === 'EARNED LEAVE') {
    return 'Earned Leave';
  }

  if (normalized === 'COMP-OFF' || normalized === 'COMPOFF') {
    return 'Comp-Off';
  }

  return value || '—';
}

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function boolLabel(value) {
  return ['true', 'yes', '1', 'on'].includes(String(value || '').toLowerCase())
    ? 'Yes'
    : 'No';
}

function leaveLiveStatus(row = {}) {
  if (row.live_status || row.status_text || row.status_display) {
    return row.live_status || row.status_text || row.status_display;
  }

  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved' || stage === 'approved') return 'Approved';
  if (status === 'rejected' || stage === 'rejected') return 'Rejected';
  if (stage === 'team_leader') return 'Pending with Team Leader';
  if (stage === 'reporting_officer') return 'Pending with Reporting Officer';
  if (stage === 'hr') return 'Pending with HR';

  return row.approval_stage_label || statusLabel(row.status);
}

function modeRequestLiveStatus(row = {}) {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (stage === 'team_leader') return 'Pending with Team Leader';
  if (stage === 'reporting_officer') return 'Pending with Reporting Officer';
  if (stage === 'hr') return 'Pending with HR';

  return row.approval_stage_label || statusLabel(row.status);
}

export default function AdminDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [decisionSavingId, setDecisionSavingId] = useState('');

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

  async function decideLeave(row, status) {
    const requestId = row?._id;

    if (!requestId) {
      setMessage('Leave request id not found');
      return;
    }

    const ok = window.confirm(`${statusLabel(status)} this leave request?`);

    if (!ok) return;

    try {
      setMessage('');
      setDecisionSavingId(requestId);

      const res = await api(`/leave_requests/${requestId}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      setMessage(res.message || `Leave ${status}`);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'Unable to update leave request');
    } finally {
      setDecisionSavingId('');
    }
  }

  async function decideModeRequest(row, status) {
    const requestId = row?._id;

    if (!requestId) {
      setMessage('WFH / Field request id not found');
      return;
    }

    const ok = window.confirm(`${statusLabel(status)} this WFH / Field request?`);

    if (!ok) return;

    try {
      setMessage('');
      setDecisionSavingId(requestId);

      const res = await api(`/attendance/mode-requests/${requestId}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      setMessage(res.message || `Request ${status}`);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'Unable to update WFH / Field request');
    } finally {
      setDecisionSavingId('');
    }
  }

  const stats = data?.stats || {};
  const employeeSummary = data?.employee_summary || null;
  const myPendingLeaves = data?.my_pending_leave_approvals || [];
  const myPendingModeRequests = data?.my_pending_attendance_mode_requests || [];
  const teamScopeCount = data?.team_scope_employee_ids?.length || 0;
  const pendingLeaveRequests = data?.pending?.leave_requests || [];

  const leaveSummary = useMemo(() => {
    const pendingWithTeamLeader = pendingLeaveRequests.filter(
      (row) => String(row.approval_stage || '').toLowerCase() === 'team_leader',
    ).length;

    const pendingWithReportingOfficer = pendingLeaveRequests.filter(
      (row) => String(row.approval_stage || '').toLowerCase() === 'reporting_officer',
    ).length;

    const pendingWithHr = pendingLeaveRequests.filter(
      (row) => String(row.approval_stage || '').toLowerCase() === 'hr',
    ).length;

    return {
      pendingWithTeamLeader,
      pendingWithReportingOfficer,
      pendingWithHr,
      assignedToMe: myPendingLeaves.length,
    };
  }, [pendingLeaveRequests, myPendingLeaves]);

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
    ['Pending TL Leaves', leaveSummary.pendingWithTeamLeader],
    ['Pending RO Leaves', leaveSummary.pendingWithReportingOfficer],
    ['Pending HR Leaves', leaveSummary.pendingWithHr],
    ['Pending WFH/Field', stats['Pending WFH/Field'] || 0],
    ['Available Comp-Off', stats['Available Comp-Off'] || 0],
    ['Open Tickets', stats['Open Tickets'] || 0],
    ['Pending Expenses', stats['Pending Expenses'] || 0],
    ['Candidates', stats.Candidates || 0],
    ['Assets Assigned', stats['Assets Assigned'] || 0],
    ['Departments', stats.Departments || 0],
    ['Designations', stats.Designations || 0],
  ];

  const mappedCapabilityStats = employeeSummary
    ? [
        ['My Mapped Employees', teamScopeCount],
        ['My Leave Approvals', myPendingLeaves.length],
        ['My WFH/Field Approvals', myPendingModeRequests.length],
      ]
    : [];

  const recentAttendanceRows = (data?.recent_attendance || []).map((row) => ({
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    state: row.state || '—',
    date: formatDate(row.date),
    mode: modeLabel(row.mode),
    status: statusLabel(row.status),
    check_in: formatDateTime(row.check_in),
    check_out: formatDateTime(row.check_out),
    late_reason: row.late_reason || '—',
    early_checkout_reason: row.early_checkout_reason || '—',
    verified: row.verified_by_ro ? 'Yes' : 'No',
  }));

  const pendingLeaveRows = pendingLeaveRequests.map((row) => ({
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    from_date: formatDate(row.from_date),
    upto_date: formatDate(row.to_date || row.upto_date),
    leave_days: row.leave_days ?? '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    current_stage: leaveLiveStatus(row),
    reason: row.reason || '—',
    final_status: statusLabel(row.status),
  }));

  const myPendingLeaveRows = myPendingLeaves.map((row) => ({
    action: (
      <div className="row-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => decideLeave(row, 'approved')}
          disabled={decisionSavingId === row._id}
        >
          {decisionSavingId === row._id ? 'Approving...' : 'Approve'}
        </button>

        <button
          type="button"
          className="danger"
          onClick={() => decideLeave(row, 'rejected')}
          disabled={decisionSavingId === row._id}
        >
          {decisionSavingId === row._id ? 'Rejecting...' : 'Reject'}
        </button>
      </div>
    ),
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    from_date: formatDate(row.from_date),
    upto_date: formatDate(row.to_date || row.upto_date),
    leave_days: row.leave_days ?? '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    current_stage: leaveLiveStatus(row),
    final_status: statusLabel(row.status),
  }));

  const pendingModeRows = (data?.pending?.attendance_mode_requests || []).map(
    (row) => ({
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      mode: modeLabel(row.mode),
      date: formatDate(row.date),
      reason: row.reason || '—',
      field_location: row.field_location || '—',
      current_stage: modeRequestLiveStatus(row),
      status: statusLabel(row.status),
    }),
  );

  const myPendingModeRows = myPendingModeRequests.map((row) => ({
    action: (
      <div className="row-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => decideModeRequest(row, 'approved')}
          disabled={decisionSavingId === row._id}
        >
          {decisionSavingId === row._id ? 'Approving...' : 'Approve'}
        </button>

        <button
          type="button"
          className="danger"
          onClick={() => decideModeRequest(row, 'rejected')}
          disabled={decisionSavingId === row._id}
        >
          {decisionSavingId === row._id ? 'Rejecting...' : 'Reject'}
        </button>
      </div>
    ),
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    mode: modeLabel(row.mode),
    date: formatDate(row.date),
    reason: row.reason || '—',
    field_location: row.field_location || '—',
    current_stage: modeRequestLiveStatus(row),
    status: statusLabel(row.status),
  }));

  const recentCompOffRows = (data?.recent_compoffs || []).map((row) => ({
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    earned_date: formatDate(row.earned_date),
    valid_until: formatDate(row.valid_until),
    claimed_date: formatDate(row.claimed_date),
    holiday: row.holiday_title || '—',
    status: statusLabel(row.status),
  }));

  const holidayRows = (data?.holidays_today || []).map((row) => ({
    state: row.state || '—',
    date: formatDate(row.date),
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
    is_team_leader: boolLabel(row.is_team_leader),
    is_reporting_officer: boolLabel(row.is_reporting_officer),
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
            Monitor attendance, WFH/Field requests, holidays, leave approvals,
            leave balances, employee mappings, comp-off credits, tickets,
            expenses and reports from one dashboard.
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
              Employee Master
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

      {mappedCapabilityStats.length > 0 && (
        <section className="stats-grid">
          {mappedCapabilityStats.map(([label, value]) => (
            <Stat key={label} label={label} value={value} />
          ))}
        </section>
      )}

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

      {employeeSummary && (
        <section className="two-col">
          <div className="panel">
            <div className="toolbar">
              <div>
                <h3>My Pending Leave Approvals</h3>
                <p>
                  These requests are pending at your mapped Team Leader or
                  Reporting Officer approval stage. Approval will move the leave
                  to the next stage, and final approval deducts balance.
                </p>
              </div>

              <button
                type="button"
                className="secondary"
                onClick={() => goTo('leave_requests')}
              >
                Open Leave Management
              </button>
            </div>

            <Table rows={myPendingLeaveRows} maxColumns={11} />
          </div>

          <div className="panel">
            <div className="toolbar">
              <div>
                <h3>My Pending WFH / Field Approvals</h3>
                <p>
                  These are attendance mode requests assigned to you through
                  employee mapping.
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

            <Table rows={myPendingModeRows} maxColumns={9} />
          </div>
        </section>
      )}

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending Leave Requests</h3>
              <p>
                HR/Admin/Super Admin can view all pending leave requests. Actual
                approval follows Team Leader → Reporting Officer, with HR as
                fallback when no approver mapping exists.
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

          <Table rows={pendingLeaveRows} maxColumns={12} />
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

          <Table rows={pendingModeRows} maxColumns={9} />
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
              <p>
                Latest active employees with Team Leader and Reporting Officer
                capability mapping.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('employees')}
            >
              Employee Master
            </button>
          </div>

          <Table rows={recentEmployeeRows} maxColumns={10} />
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