import { useEffect, useMemo, useState } from 'react';
import {
  api,
  getAttendanceStatus,
  getMyAttendanceModeRequests,
  getMyCompOffs,
  claimCompOff,
} from '../api/client';
import AttendanceWidget from '../components/AttendanceWidget';
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

function formatTime(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleTimeString('en-IN', {
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
  const normalized = String(value || '').toLowerCase();

  if (['true', 'yes', '1', 'on'].includes(normalized)) {
    return 'Yes';
  }

  return 'No';
}

function isTruthy(value) {
  return ['true', 'yes', '1', 'on'].includes(String(value || '').toLowerCase());
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (Array.isArray(value)) {
    return value.join(', ') || '—';
  }

  return String(value);
}

function capabilityLabel(data, employee) {
  const labels = [];

  if (data?.is_team_leader || isTruthy(employee?.is_team_leader)) {
    labels.push('Team Leader');
  }

  if (data?.is_reporting_officer || isTruthy(employee?.is_reporting_officer)) {
    labels.push('Reporting Officer');
  }

  return labels.length ? labels.join(' + ') : 'No additional capability mapped';
}

function normalizeProjectStatus(value) {
  const status = String(value || '').trim().toLowerCase();

  if (['completed', 'complete', 'done', 'closed', 'inactive'].includes(status)) {
    return 'completed';
  }

  if (['on_hold', 'on-hold', 'hold'].includes(status)) {
    return 'on_hold';
  }

  return 'active';
}

function projectName(project = {}) {
  return project.name || project.project_name || project.title || 'Untitled Project';
}

function percentValue(value) {
  const number = Number(value || 0);

  if (Number.isNaN(number)) {
    return 0;
  }

  return Math.min(Math.max(number, 0), 100);
}

function leaveLiveStatus(row = {}) {
  if (row.live_status || row.status_text || row.status_display) {
    return row.live_status || row.status_text || row.status_display;
  }

  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved' || stage === 'approved') {
    return 'Approved';
  }

  if (status === 'rejected' || stage === 'rejected') {
    return 'Rejected';
  }

  if (stage === 'team_leader') {
    return 'Pending with Team Leader';
  }

  if (stage === 'reporting_officer') {
    return 'Pending with Reporting Officer';
  }

  if (stage === 'hr') {
    return 'Pending with HR';
  }

  return row.approval_stage_label || statusLabel(row.status);
}

function MiniProgressBar({ value }) {
  const percentage = percentValue(value);

  return (
    <div className="emp-project-mini-progress">
      <div className="emp-project-mini-progress-track">
        <div
          className="emp-project-mini-progress-fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <strong>{percentage}%</strong>
    </div>
  );
}

function ProjectChart({ title, rows = [] }) {
  const hasRows = rows.length > 0;

  return (
    <div className="panel emp-project-chart-card">
      <div className="toolbar">
        <div>
          <h3>{title}</h3>
          <p>Daily progress trend based on submitted project updates.</p>
        </div>
      </div>

      {!hasRows && <div className="empty">No project progress data found.</div>}

      {hasRows && (
        <div className="emp-project-chart">
          {rows.map((row) => {
            const value = percentValue(row.average_progress);

            return (
              <div className="emp-project-bar-row" key={row.date}>
                <span>{String(row.date || '').slice(5) || '—'}</span>

                <div className="emp-project-bar-track">
                  <div
                    className="emp-project-bar-fill"
                    style={{ width: `${value}%` }}
                  />
                </div>

                <strong>{value}%</strong>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeaveApprovalTable({ rows = [], saving, onDecision }) {
  if (!rows.length) {
    return <div className="empty">No pending leave approval found.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Leave Type</th>
            <th>From</th>
            <th>Upto</th>
            <th>Days</th>
            <th>Task Handover</th>
            <th>Project Handover</th>
            <th>Current Stage</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row._id}>
              <td>
                <strong>{row.employee_name || '—'}</strong>
                <br />
                <small>{row.employee_code || row.emp_code || row.employee_id || '—'}</small>
              </td>
              <td>{leaveTypeLabel(row.leave_type_label || row.leave_type)}</td>
              <td>{formatDate(row.from_date)}</td>
              <td>{formatDate(row.to_date || row.upto_date)}</td>
              <td>{row.leave_days ?? '—'}</td>
              <td>{row.task_handover_to_name || '—'}</td>
              <td>{row.project_handover_name || '—'}</td>
              <td>{leaveLiveStatus(row)}</td>
              <td>
                <div className="row-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onDecision(row, 'approved')}
                    disabled={saving}
                  >
                    Approve
                  </button>

                  <button
                    type="button"
                    className="danger"
                    onClick={() => onDecision(row, 'rejected')}
                    disabled={saving}
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EmployeeDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [attendanceStatus, setAttendanceStatus] = useState(null);
  const [modeRequests, setModeRequests] = useState([]);
  const [compOffs, setCompOffs] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);

  const [claimForm, setClaimForm] = useState({
    compoff_id: '',
    claim_date: '',
    reason: '',
  });

  const [reviewForm, setReviewForm] = useState({
    employee_id: '',
    cycle: '',
    rating: 5,
    comments: '',
  });

  const [message, setMessage] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [claimingCompOff, setClaimingCompOff] = useState(false);
  const [leaveDecisionSaving, setLeaveDecisionSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadDashboard() {
    try {
      setLoading(true);
      setMessage('');

      const [
        dashboardData,
        attendanceData,
        requestData,
        compOffData,
        leaveBalanceData,
        leaveRequestData,
      ] = await Promise.all([
        api('/dashboard/employee'),
        getAttendanceStatus().catch(() => null),
        getMyAttendanceModeRequests().catch(() => ({ items: [] })),
        getMyCompOffs().catch(() => ({ items: [] })),
        api('/leave_balances').catch(() => ({ items: [] })),
        api('/leave_requests').catch(() => ({ items: [] })),
      ]);

      setData(dashboardData);
      setAttendanceStatus(attendanceData);
      setModeRequests(requestData?.items || []);
      setCompOffs(compOffData?.items || []);
      setLeaveBalances(leaveBalanceData?.items || []);
      setLeaveRequests(leaveRequestData?.items || []);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Unable to load employee dashboard');
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

  async function submitReview(event) {
    event.preventDefault();
    setMessage('');

    if (!reviewForm.employee_id) {
      setMessage('Please select an employee to review');
      return;
    }

    const ratingValue = Number(reviewForm.rating);

    if (!ratingValue || ratingValue < 1 || ratingValue > 5) {
      setMessage('Rating must be between 1 and 5');
      return;
    }

    try {
      setSubmittingReview(true);

      const res = await api('/performance/reviews', {
        method: 'POST',
        body: JSON.stringify({
          ...reviewForm,
          rating: ratingValue,
        }),
      });

      setMessage(res.message || 'Performance review submitted');

      setReviewForm({
        employee_id: '',
        cycle: '',
        rating: 5,
        comments: '',
      });

      await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'Unable to submit performance review');
    } finally {
      setSubmittingReview(false);
    }
  }

  async function submitCompOffClaim(event) {
    event.preventDefault();
    setMessage('');

    if (!claimForm.compoff_id) {
      setMessage('Please select an available comp-off');
      return;
    }

    if (!claimForm.claim_date) {
      setMessage('Please select comp-off claim date');
      return;
    }

    try {
      setClaimingCompOff(true);

      const res = await claimCompOff(claimForm.compoff_id, {
        claim_date: claimForm.claim_date,
        reason: claimForm.reason,
      });

      setMessage(res.message || 'Comp-off claim submitted');

      setClaimForm({
        compoff_id: '',
        claim_date: '',
        reason: '',
      });

      await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'Unable to claim comp-off');
    } finally {
      setClaimingCompOff(false);
    }
  }

  async function decideLeave(row, status) {
    const ok = window.confirm(`${statusLabel(status)} this leave request?`);

    if (!ok) {
      return;
    }

    try {
      setMessage('');
      setLeaveDecisionSaving(true);

      const res = await api(`/leave_requests/${row._id}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      setMessage(res.message || `Leave ${status}`);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'Unable to update leave request');
    } finally {
      setLeaveDecisionSaving(false);
    }
  }

  const employee = data?.employee || {};
  const employeeSummary = data?.employee_summary || employee;

  const displayName =
    data?.dashboard_display?.title ||
    employee?.name ||
    employeeSummary?.name ||
    'Employee';

  const employeeId = String(employee?._id || employeeSummary?._id || '');

  const mappedCapabilityLabel = capabilityLabel(data, employee);

  const isMappedApprover = Boolean(
    data?.is_team_leader ||
      data?.is_reporting_officer ||
      isTruthy(employee?.is_team_leader) ||
      isTruthy(employee?.is_reporting_officer),
  );

  const isTeamLeader = Boolean(data?.is_team_leader || isTruthy(employee?.is_team_leader));
  const isReportingOfficer = Boolean(
    data?.is_reporting_officer || isTruthy(employee?.is_reporting_officer),
  );

  const holiday = attendanceStatus?.holiday || data?.holiday || {};
  const todayAttendance =
    attendanceStatus?.attendance || data?.today_attendance || null;

  const availableModes =
    attendanceStatus?.available_modes ||
    data?.available_attendance_modes ||
    ['office'];

  const projectDashboard = data?.project_dashboard || {};
  const projectSummary = projectDashboard?.summary || {};
  const activeProjects = data?.active_projects || projectDashboard?.active_projects || [];
  const completedProjects = data?.completed_projects || projectDashboard?.completed_projects || [];
  const myProjects = data?.projects || projectDashboard?.my_projects || [];
  const teamLeaderProjects =
    data?.team_leader_projects || projectDashboard?.team_leader_projects || [];
  const reportingProjects =
    data?.reporting_projects || projectDashboard?.reporting_projects || [];

  const projectDailyChart =
    data?.project_daily_progress_chart ||
    projectDashboard?.daily_progress_chart ||
    [];

  const teamProjectDailyChart =
    data?.team_project_daily_progress_chart ||
    projectDashboard?.team_daily_progress_chart ||
    [];

  const reportingProjectDailyChart =
    data?.reporting_project_daily_progress_chart ||
    projectDashboard?.reporting_daily_progress_chart ||
    [];

  const availableCompOffs = useMemo(
    () => compOffs.filter((item) => item.status === 'available'),
    [compOffs],
  );

  const pendingModeRequests = useMemo(
    () => modeRequests.filter((item) => item.status === 'pending'),
    [modeRequests],
  );

  const reviewableEmployeesMap = new Map();

  [...(data?.team_members || []), ...(data?.reporting_members || [])].forEach(
    (employeeRow) => {
      if (employeeRow?._id) {
        reviewableEmployeesMap.set(employeeRow._id, employeeRow);
      }
    },
  );

  const reviewableEmployees = Array.from(reviewableEmployeesMap.values());

  const dashboardLeaveBalances = data?.leave_balances || [];
  const leaveBalanceSource = leaveBalances.length ? leaveBalances : dashboardLeaveBalances;

  const dashboardLeaveRequests = data?.leaves || [];
  const leaveRequestSource = leaveRequests.length ? leaveRequests : dashboardLeaveRequests;

  const myLeaveRows = leaveRequestSource.filter((row) => {
    if (!employeeId) {
      return true;
    }

    return String(row.employee_id || '') === employeeId;
  });

  const pendingApprovalLeavesFromApi = leaveRequestSource.filter((row) => {
    if (String(row.status || '').toLowerCase() !== 'pending') {
      return false;
    }

    if (employeeId && String(row.employee_id || '') === employeeId) {
      return false;
    }

    return ['team_leader', 'reporting_officer', 'hr'].includes(
      String(row.approval_stage || '').toLowerCase(),
    );
  });

  const pendingApprovalLeaves =
    pendingApprovalLeavesFromApi.length > 0
      ? pendingApprovalLeavesFromApi
      : data?.team_pending_leaves || [];

  const approvalCounts = data?.pending_approval_counts || {
    leave_requests: pendingApprovalLeaves.length,
    attendance_mode_requests:
      data?.team_pending_attendance_mode_requests?.length || 0,
  };

  const profileRows = [
    {
      field: 'Employee ID',
      value:
        employeeSummary.employee_id ||
        employee.employee_id ||
        employee.emp_code ||
        '',
    },
    {
      field: 'Employee Name',
      value: displayName,
    },
    {
      field: 'Dashboard Role',
      value: 'Employee',
    },
    {
      field: 'Employee Capability',
      value: mappedCapabilityLabel,
    },
    {
      field: 'Department',
      value: employeeSummary.department || employee.department || '',
    },
    {
      field: 'Designation',
      value: employeeSummary.designation || employee.designation || '',
    },
    {
      field: 'State / Branch',
      value:
        employeeSummary.state ||
        employee.state ||
        employeeSummary.branch ||
        employee.branch ||
        '',
    },
    {
      field: 'Shift',
      value: employeeSummary.shift || employee.shift || '',
    },
    {
      field: 'Joining Date',
      value:
        employeeSummary.joining_date ||
        employee.joining_date ||
        employee.doj ||
        '',
    },
    {
      field: 'Employment Status',
      value:
        employeeSummary.employment_status ||
        employee.employment_status ||
        employee.status ||
        '',
    },
    {
      field: 'Mapped Team Leader',
      value: employeeSummary.team_leader_name || employee.team_leader_name || '',
    },
    {
      field: 'Mapped Reporting Officer',
      value:
        employeeSummary.reporting_officer_name ||
        employee.reporting_officer_name ||
        '',
    },
  ];

  const leaveBalanceRows = leaveBalanceSource.map((row) => ({
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    opening_balance: row.opening_balance ?? 0,
    credited: row.credited ?? 0,
    used_deducted: row.used ?? 0,
    available: row.available ?? 0,
    status: statusLabel(row.status),
  }));

  const casualBalance =
    leaveBalanceSource.find((row) =>
      ['CL', 'CASUAL LEAVE'].includes(String(row.leave_type || row.leave_type_label || '').toUpperCase()),
    ) || {};

  const earnedBalance =
    leaveBalanceSource.find((row) =>
      ['EL', 'EARNED LEAVE'].includes(String(row.leave_type || row.leave_type_label || '').toUpperCase()),
    ) || {};

  const totalAvailableLeave = leaveBalanceSource.reduce(
    (total, row) => total + Number(row.available || 0),
    0,
  );

  const totalUsedLeave = leaveBalanceSource.reduce(
    (total, row) => total + Number(row.used || 0),
    0,
  );

  const modeRequestRows = modeRequests.slice(0, 8).map((row) => ({
    mode: modeLabel(row.mode),
    date: row.date || '—',
    reason: row.reason || '—',
    field_location: row.field_location || '—',
    approval_stage: row.approval_stage_label || statusLabel(row.approval_stage),
    status: statusLabel(row.status),
    decided_by: row.decided_by_name || row.last_decided_by_name || '—',
    decided_at: formatDateTime(row.decided_at || row.last_decided_at),
  }));

  const compOffRows = compOffs.slice(0, 8).map((row) => ({
    earned_date: formatDate(row.earned_date),
    valid_until: formatDate(row.valid_until),
    claimed_date: formatDate(row.claimed_date),
    holiday: row.holiday_title || '—',
    status: statusLabel(row.status),
  }));

  const leaveRows = myLeaveRows.map((row) => ({
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    from_date: formatDate(row.from_date),
    upto_date: formatDate(row.to_date || row.upto_date),
    leave_days: row.leave_days ?? '—',
    reason: row.reason || '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    current_status: leaveLiveStatus(row),
    final_status: statusLabel(row.status),
  }));

  const notificationRows = (data?.notifications || []).map((row) => ({
    title: row.title || '—',
    body: row.body || '—',
    status: statusLabel(row.status),
    created_at: formatDateTime(row.created_at),
  }));

  const teamMemberRows = (data?.team_members || []).map((row) => ({
    name: row.name || '—',
    employee_id: row.employee_id || row.emp_code || '—',
    email: row.email || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    state: row.state || row.branch || '—',
    status: row.status || row.employment_status || '—',
  }));

  const reportingMemberRows = (data?.reporting_members || []).map((row) => ({
    name: row.name || '—',
    employee_id: row.employee_id || row.emp_code || '—',
    email: row.email || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    state: row.state || row.branch || '—',
    status: row.status || row.employment_status || '—',
  }));

  const teamPendingModeRows = (
    data?.team_pending_attendance_mode_requests || []
  ).map((row) => ({
    employee_name: row.employee_name || '—',
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    mode: modeLabel(row.mode),
    date: row.date || '—',
    reason: row.reason || '—',
    field_location: row.field_location || '—',
    approval_stage: row.approval_stage_label || statusLabel(row.approval_stage),
    status: statusLabel(row.status),
  }));

  const myReviewRows = (data?.my_performance_reviews || []).map((row) => ({
    cycle: row.cycle || '—',
    rating: row.rating ?? '—',
    comments: row.comments || '—',
    reviewer_name: row.reviewer_name || '—',
    reviewer_role: statusLabel(row.reviewer_role),
    status: statusLabel(row.status),
    created_at: formatDateTime(row.created_at),
  }));

  const projectRows = myProjects.map((project) => ({
    project_name: projectName(project),
    status: statusLabel(project.status),
    department: project.department || '—',
    team_leader: project.team_leader_name || '—',
    progress: `${percentValue(project.latest_progress)}%`,
    last_update: project.latest_progress_date || '—',
    updated_by: project.latest_progress_by_name || '—',
  }));

  const teamProjectRows = teamLeaderProjects.map((project) => ({
    project_name: projectName(project),
    status: statusLabel(project.status),
    department: project.department || '—',
    assigned_members: Array.isArray(project.assigned_members)
      ? project.assigned_members.map((member) => member.employee_name).filter(Boolean).join(', ') || '—'
      : '—',
    collaborators: Array.isArray(project.collaborators)
      ? project.collaborators.map((member) => member.employee_name).filter(Boolean).join(', ') || '—'
      : '—',
    progress: `${percentValue(project.latest_progress)}%`,
    last_update: project.latest_progress_date || '—',
  }));

  const reportingProjectRows = reportingProjects.map((project) => ({
    project_name: projectName(project),
    status: statusLabel(project.status),
    department: project.department || '—',
    team_leader: project.team_leader_name || '—',
    progress: `${percentValue(project.latest_progress)}%`,
    last_update: project.latest_progress_date || '—',
  }));

  const teamLeaderPerformanceRows = (
    projectDashboard?.team_leader_performance ||
    projectDashboard?.reporting_team_leader_performance ||
    []
  ).map((row) => ({
    team_leader: row.team_leader_name || '—',
    department: row.department || '—',
    total_projects: row.total_projects || 0,
    active_projects: row.active_projects || 0,
    completed_projects: row.completed_projects || 0,
    completion_rate: `${row.completion_rate || 0}%`,
  }));

  const recentProjectProgressRows = (projectDashboard?.recent_progress || []).map((row) => ({
    project: row.project_name || '—',
    employee: row.employee_name || '—',
    progress: `${percentValue(row.progress_percent)}%`,
    note: row.note || row.description || '—',
    date: row.date || '—',
  }));

  const todayStatus = statusLabel(todayAttendance?.status || 'Not checked-in');

  return (
    <div className="page-grid employee-dashboard-page">
      <style>{`
        .emp-project-dashboard {
          display: grid;
          gap: 18px;
        }

        .emp-leave-status-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin: 14px 0 18px;
        }

        .emp-leave-status-card {
          border: 1px solid #e2e8f0;
          background: #ffffff;
          border-radius: 18px;
          padding: 14px;
          box-shadow: 0 10px 26px rgba(15, 23, 42, .05);
        }

        .emp-leave-status-card span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .emp-leave-status-card strong {
          display: block;
          margin-top: 7px;
          color: #0f172a;
          font-size: 26px;
        }

        .emp-leave-note {
          background: #f8fafc;
          border: 1px dashed #cbd5e1;
          color: #64748b;
          border-radius: 16px;
          padding: 12px;
          line-height: 1.5;
          font-size: 13px;
          margin-bottom: 14px;
        }

        .emp-project-hero {
          position: relative;
          overflow: hidden;
          border: 1px solid #e2e8f0;
          border-radius: 26px;
          padding: 22px;
          background:
            radial-gradient(circle at 12% 0%, rgba(79, 70, 229, .12), transparent 34%),
            radial-gradient(circle at 92% 10%, rgba(5, 150, 105, .12), transparent 34%),
            #ffffff;
          box-shadow: 0 18px 50px rgba(15, 23, 42, .08);
        }

        .emp-project-hero h3 {
          margin: 0;
          color: #0f172a;
          font-size: clamp(22px, 3vw, 32px);
          letter-spacing: -.04em;
        }

        .emp-project-hero p {
          margin: 8px 0 0;
          color: #64748b;
          line-height: 1.65;
        }

        .emp-project-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-top: 18px;
        }

        .emp-project-stat {
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: #ffffff;
          padding: 16px;
          box-shadow: 0 12px 28px rgba(15, 23, 42, .06);
        }

        .emp-project-stat span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .emp-project-stat strong {
          display: block;
          margin-top: 8px;
          color: #0f172a;
          font-size: 28px;
          line-height: 1;
        }

        .emp-project-card-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .emp-project-card {
          border: 1px solid #e2e8f0;
          border-radius: 22px;
          padding: 16px;
          background: #ffffff;
          box-shadow: 0 12px 32px rgba(15, 23, 42, .07);
        }

        .emp-project-card h4 {
          margin: 0;
          color: #0f172a;
          font-size: 16px;
        }

        .emp-project-card p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.5;
        }

        .emp-project-status {
          display: inline-flex;
          margin-top: 12px;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 900;
          color: #4338ca;
          background: #eef2ff;
        }

        .emp-project-status.active {
          color: #047857;
          background: #ecfdf5;
        }

        .emp-project-status.completed {
          color: #4338ca;
          background: #eef2ff;
        }

        .emp-project-mini-progress {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          margin-top: 14px;
        }

        .emp-project-mini-progress-track {
          height: 9px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .emp-project-mini-progress-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #4f46e5, #059669);
        }

        .emp-project-mini-progress strong {
          color: #0f172a;
          font-size: 13px;
        }

        .emp-project-chart {
          display: grid;
          gap: 10px;
        }

        .emp-project-bar-row {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr) 48px;
          gap: 10px;
          align-items: center;
        }

        .emp-project-bar-row span,
        .emp-project-bar-row strong {
          color: #334155;
          font-size: 12px;
          font-weight: 800;
        }

        .emp-project-bar-track {
          height: 12px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .emp-project-bar-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #4f46e5, #0284c7, #059669);
        }

        @media (max-width: 1024px) {
          .emp-project-stats,
          .emp-project-card-grid,
          .emp-leave-status-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 640px) {
          .emp-project-stats,
          .emp-project-card-grid,
          .emp-leave-status-grid {
            grid-template-columns: 1fr;
          }

          .emp-project-hero {
            border-radius: 20px;
            padding: 16px;
          }
        }
      `}</style>

      <section className="hero employee-hero">
        <div className="employee-identity">
          <span className="kicker">Employee Self Service</span>

          <h1 className="employee-name-heading dashboard-display-name">
            {displayName}
          </h1>

          <p className="employee-dashboard-subtitle">
            Employee dashboard for attendance, leave, profile, tickets,
            notifications, assigned approval responsibilities, and project progress.
          </p>

          <div className="employee-badges">
            <span className="employee-badge primary-cap">
              Dashboard: Employee
            </span>

            <span className="employee-badge success-cap">
              Capability: {mappedCapabilityLabel}
            </span>

            <span className="employee-badge neutral-cap">
              Department:{' '}
              {displayValue(employeeSummary.department || employee.department)}
            </span>
          </div>

          {holiday?.is_holiday && (
            <div className="holiday-banner">
              <div className="holiday-icon">🎉</div>

              <div>
                <strong>{holiday.title || 'Holiday'}</strong>
                <p>
                  {holiday.message ||
                    'Today is marked as a holiday for your state.'}
                </p>
              </div>
            </div>
          )}

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
              Apply Leave
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
              onClick={() => goTo('tickets')}
            >
              Raise Ticket
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('profile')}
            >
              My Profile
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

        <AttendanceWidget onSuccess={loadDashboard} />
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="stats-grid">
        <Stat label="Dashboard" value="Employee" />

        <Stat label="Today Status" value={todayStatus} />

        <Stat
          label="Attendance Mode"
          value={modeLabel(todayAttendance?.mode || 'office')}
        />

        <Stat
          label="Available Modes"
          value={availableModes.map(modeLabel).join(', ')}
        />

        <Stat label="Available Leave" value={totalAvailableLeave} />

        <Stat label="Used / Deducted Leave" value={totalUsedLeave} />

        <Stat label="Available Comp-Off" value={availableCompOffs.length} />

        <Stat label="Pending WFH/Field" value={pendingModeRequests.length} />

        <Stat label="Active Projects" value={projectSummary.my_active_projects || activeProjects.length || 0} />

        <Stat label="Completed Projects" value={projectSummary.my_completed_projects || completedProjects.length || 0} />

        <Stat label="Team Members" value={data?.team_members?.length || 0} />

        <Stat
          label="Reporting Members"
          value={data?.reporting_members?.length || 0}
        />

        <Stat
          label="Pending Leave Approvals"
          value={pendingApprovalLeaves.length || approvalCounts.leave_requests || 0}
        />

        <Stat
          label="Pending WFH/Field Approvals"
          value={approvalCounts.attendance_mode_requests || 0}
        />

        {loading && (
          <div className="panel">
            <p>Loading dashboard...</p>
          </div>
        )}

        {!loading && !message && !data && (
          <div className="panel">
            <p>No dashboard data available.</p>
          </div>
        )}
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>My Leave Balance</h3>
              <p>
                Leave balance is credited by HR/Admin and deducted automatically
                after final approval.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('leave_requests')}
            >
              Apply Leave
            </button>
          </div>

          <div className="emp-leave-status-grid">
            <div className="emp-leave-status-card">
              <span>CL Available</span>
              <strong>{casualBalance.available ?? 0}</strong>
            </div>

            <div className="emp-leave-status-card">
              <span>CL Used</span>
              <strong>{casualBalance.used ?? 0}</strong>
            </div>

            <div className="emp-leave-status-card">
              <span>EL Available</span>
              <strong>{earnedBalance.available ?? 0}</strong>
            </div>

            <div className="emp-leave-status-card">
              <span>EL Used</span>
              <strong>{earnedBalance.used ?? 0}</strong>
            </div>
          </div>

          <div className="emp-leave-note">
            When you apply for leave, it first goes to your Team Leader. If no
            Team Leader is mapped, it goes directly to your Reporting Officer.
            Balance is deducted only after final approval.
          </div>

          <Table rows={leaveBalanceRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>My Leave Request Status</h3>
              <p>
                Track live status: Pending with Team Leader, Pending with
                Reporting Officer, Approved, or Rejected.
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

          <Table rows={leaveRows} maxColumns={8} />
        </div>
      </section>

      {isMappedApprover && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending Leave Approvals</h3>
              <p>
                Shows leave requests currently waiting at your approval stage.
                After Team Leader approval, the request moves to Reporting
                Officer. After final approval, the employee receives notification
                and leave balance is deducted.
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

          <LeaveApprovalTable
            rows={pendingApprovalLeaves}
            saving={leaveDecisionSaving}
            onDecision={decideLeave}
          />
        </section>
      )}

      <section className="emp-project-dashboard">
        <div className="emp-project-hero">
          <div className="toolbar">
            <div>
              <span className="kicker">Project Progress</span>
              <h3>My Projects & Daily Progress</h3>
              <p>
                Active projects stay visible for daily progress updates. Completed
                projects are preserved here for dashboard reporting and analytics.
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

          <div className="emp-project-stats">
            <div className="emp-project-stat">
              <span>My Total Projects</span>
              <strong>{projectSummary.my_total_projects || myProjects.length || 0}</strong>
            </div>

            <div className="emp-project-stat">
              <span>My Active</span>
              <strong>{projectSummary.my_active_projects || activeProjects.length || 0}</strong>
            </div>

            <div className="emp-project-stat">
              <span>My Completed</span>
              <strong>{projectSummary.my_completed_projects || completedProjects.length || 0}</strong>
            </div>

            <div className="emp-project-stat">
              <span>Average Progress</span>
              <strong>{projectSummary.average_progress || 0}%</strong>
            </div>
          </div>
        </div>

        <div className="emp-project-card-grid">
          {activeProjects.slice(0, 6).map((project) => {
            const status = normalizeProjectStatus(project.status);

            return (
              <div className="emp-project-card" key={project._id}>
                <h4>{projectName(project)}</h4>
                <p>
                  {project.department || 'No department'}
                  {project.team_leader_name ? ` • ${project.team_leader_name}` : ''}
                </p>

                <span className={`emp-project-status ${status}`}>
                  {statusLabel(status)}
                </span>

                <MiniProgressBar value={project.latest_progress} />

                <p>
                  Last update: {project.latest_progress_date || 'No update yet'}
                </p>
              </div>
            );
          })}

          {!activeProjects.length && (
            <div className="panel">
              <p>No active projects assigned yet.</p>
            </div>
          )}
        </div>

        <ProjectChart title="My Daily Project Progress" rows={projectDailyChart} />

        {isTeamLeader && (
          <>
            <section className="panel">
              <div className="toolbar">
                <div>
                  <h3>Team Leader Project View</h3>
                  <p>
                    Projects created or managed by you as Team Leader, including
                    assigned members and collaborators.
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => goTo('projects')}
                >
                  Manage Projects
                </button>
              </div>

              <div className="stats-grid">
                <Stat label="Team Projects" value={projectSummary.team_total_projects || 0} />
                <Stat label="Team Active" value={projectSummary.team_active_projects || 0} />
                <Stat label="Team Completed" value={projectSummary.team_completed_projects || 0} />
                <Stat label="Team Members" value={data?.team_members?.length || 0} />
              </div>

              <Table rows={teamProjectRows} maxColumns={8} />
            </section>

            <ProjectChart title="Team Project Progress Graph" rows={teamProjectDailyChart} />
          </>
        )}

        {isReportingOfficer && (
          <>
            <section className="panel">
              <div className="toolbar">
                <div>
                  <h3>Reporting Officer Project View</h3>
                  <p>
                    Department/team-wise progress for team leaders mapped under
                    your reporting officer assignment.
                  </p>
                </div>
              </div>

              <div className="stats-grid">
                <Stat label="Reporting Projects" value={projectSummary.reporting_total_projects || 0} />
                <Stat label="Reporting Active" value={projectSummary.reporting_active_projects || 0} />
                <Stat label="Reporting Completed" value={projectSummary.reporting_completed_projects || 0} />
                <Stat label="Reporting Members" value={data?.reporting_members?.length || 0} />
              </div>

              <Table rows={reportingProjectRows} maxColumns={8} />
            </section>

            <ProjectChart title="Reporting Team Project Progress Graph" rows={reportingProjectDailyChart} />

            <section className="panel">
              <h3>Team Leader Performance Under Reporting Officer</h3>
              <Table rows={teamLeaderPerformanceRows} maxColumns={8} />
            </section>
          </>
        )}

        <section className="two-col">
          <div className="panel">
            <h3>My Project Records</h3>
            <Table rows={projectRows} maxColumns={8} />
          </div>

          <div className="panel">
            <h3>Recent Project Progress Updates</h3>
            <Table rows={recentProjectProgressRows} maxColumns={8} />
          </div>
        </section>
      </section>

      {isMappedApprover && (
        <section className="capability-panel">
          <div className="capability-card">
            <span>Mapped as Team Leader</span>
            <strong>{data?.is_team_leader ? 'Yes' : 'No'}</strong>
          </div>

          <div className="capability-card">
            <span>Mapped as Reporting Officer</span>
            <strong>{data?.is_reporting_officer ? 'Yes' : 'No'}</strong>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Today&apos;s Attendance & Holiday Status</h3>
            <p>
              This section reflects your current day attendance, approved mode,
              late/early status, and state-wise holiday message.
            </p>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('attendance')}
          >
            Open Attendance
          </button>
        </div>

        <div className="attendance-summary">
          <div>
            <span>Status</span>
            <strong>{todayStatus}</strong>
          </div>

          <div>
            <span>Mode</span>
            <strong>{modeLabel(todayAttendance?.mode || 'office')}</strong>
          </div>

          <div>
            <span>Check In</span>
            <strong>{formatTime(todayAttendance?.check_in)}</strong>
          </div>

          <div>
            <span>Check Out</span>
            <strong>{formatTime(todayAttendance?.check_out)}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>My Employee Profile Summary</h3>
            <p>Key employment details from Employee Master.</p>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('profile')}
          >
            View Full Profile
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <tbody>
              {profileRows.map((row) => (
                <tr key={row.field}>
                  <th>{row.field}</th>
                  <td>{displayValue(row.value)}</td>
                </tr>
              ))}

              <tr>
                <th>Is Team Leader</th>
                <td>
                  {boolLabel(employee.is_team_leader || data?.is_team_leader)}
                </td>
              </tr>

              <tr>
                <th>Is Reporting Officer</th>
                <td>
                  {boolLabel(
                    employee.is_reporting_officer ||
                      data?.is_reporting_officer,
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>WFH / Field Requests</h3>
              <p>
                Approved requests unlock WFH or Field check-in on the selected
                date.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('attendance')}
            >
              Request WFH / Field
            </button>
          </div>

          <Table rows={modeRequestRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>My Comp-Off</h3>
              <p>
                If you work on a holiday, one compensatory off is generated and
                can be claimed for one day.
              </p>
            </div>
          </div>

          {availableCompOffs.length > 0 && (
            <form className="dynamic-form" onSubmit={submitCompOffClaim}>
              <label>
                Available Comp-Off
                <select
                  value={claimForm.compoff_id}
                  onChange={(event) =>
                    setClaimForm({
                      ...claimForm,
                      compoff_id: event.target.value,
                    })
                  }
                  disabled={claimingCompOff}
                >
                  <option value="">Select comp-off</option>

                  {availableCompOffs.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.earned_date} — {item.holiday_title || 'Holiday Work'}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Claim Date
                <input
                  type="date"
                  value={claimForm.claim_date}
                  onChange={(event) =>
                    setClaimForm({
                      ...claimForm,
                      claim_date: event.target.value,
                    })
                  }
                  disabled={claimingCompOff}
                />
              </label>

              <label>
                Reason
                <input
                  value={claimForm.reason}
                  placeholder="Reason / note"
                  onChange={(event) =>
                    setClaimForm({
                      ...claimForm,
                      reason: event.target.value,
                    })
                  }
                  disabled={claimingCompOff}
                />
              </label>

              <button
                type="submit"
                className="primary"
                disabled={claimingCompOff}
              >
                {claimingCompOff ? 'Submitting...' : 'Claim Comp-Off'}
              </button>
            </form>
          )}

          <Table rows={compOffRows} maxColumns={8} />
        </div>
      </section>

      {isMappedApprover && (
        <section className="panel">
          <h3>Performance Rating</h3>
          <p>
            This section appears because this employee is mapped as Team Leader
            and/or Reporting Officer for assigned employees.
          </p>

          <form className="dynamic-form" onSubmit={submitReview}>
            <label>
              Employee
              <select
                value={reviewForm.employee_id}
                onChange={(event) =>
                  setReviewForm({
                    ...reviewForm,
                    employee_id: event.target.value,
                  })
                }
                disabled={submittingReview}
              >
                <option value="">Select employee</option>

                {reviewableEmployees.map((employeeRow) => (
                  <option key={employeeRow._id} value={employeeRow._id}>
                    {employeeRow.name} —{' '}
                    {employeeRow.designation ||
                      employeeRow.department ||
                      employeeRow.email}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Cycle
              <input
                value={reviewForm.cycle}
                placeholder="May 2026"
                onChange={(event) =>
                  setReviewForm({
                    ...reviewForm,
                    cycle: event.target.value,
                  })
                }
                disabled={submittingReview}
              />
            </label>

            <label>
              Rating 1 to 5
              <input
                type="number"
                min="1"
                max="5"
                value={reviewForm.rating}
                onChange={(event) =>
                  setReviewForm({
                    ...reviewForm,
                    rating: event.target.value,
                  })
                }
                disabled={submittingReview}
              />
            </label>

            <label>
              Comments
              <input
                value={reviewForm.comments}
                onChange={(event) =>
                  setReviewForm({
                    ...reviewForm,
                    comments: event.target.value,
                  })
                }
                disabled={submittingReview}
              />
            </label>

            <button
              type="submit"
              className="primary"
              disabled={submittingReview}
            >
              {submittingReview ? 'Submitting...' : 'Submit Rating'}
            </button>
          </form>
        </section>
      )}

      {isMappedApprover && (
        <section className="two-col">
          <div className="panel">
            <h3>Employees Under My Team Leader Mapping</h3>
            <Table rows={teamMemberRows} maxColumns={8} />
          </div>

          <div className="panel">
            <h3>Employees Under My Reporting Officer Mapping</h3>
            <Table rows={reportingMemberRows} maxColumns={8} />
          </div>
        </section>
      )}

      {isMappedApprover && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending WFH / Field Approvals</h3>
              <p>
                Shows only WFH / Field requests currently pending at your
                mapped approval stage.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('attendance')}
            >
              Open Attendance
            </button>
          </div>

          <Table rows={teamPendingModeRows} maxColumns={8} />
        </section>
      )}

      <section className="panel">
        <h3>My Performance Reviews</h3>
        <p>This is visible to the employee, HR, and Super Admin.</p>
        <Table rows={myReviewRows} maxColumns={8} />
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>My Tickets</h3>
          <Table rows={data?.tickets || []} maxColumns={8} />
        </div>

        <div className="panel">
          <h3>My Notifications</h3>
          <Table rows={notificationRows} maxColumns={8} />
        </div>
      </section>
    </div>
  );
}