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

export default function EmployeeDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [attendanceStatus, setAttendanceStatus] = useState(null);
  const [modeRequests, setModeRequests] = useState([]);
  const [compOffs, setCompOffs] = useState([]);

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
  const [loading, setLoading] = useState(false);

  async function loadDashboard() {
    try {
      setLoading(true);
      setMessage('');

      const [dashboardData, attendanceData, requestData, compOffData] =
        await Promise.all([
          api('/dashboard/employee'),
          getAttendanceStatus().catch(() => null),
          getMyAttendanceModeRequests().catch(() => ({ items: [] })),
          getMyCompOffs().catch(() => ({ items: [] })),
        ]);

      setData(dashboardData);
      setAttendanceStatus(attendanceData);
      setModeRequests(requestData?.items || []);
      setCompOffs(compOffData?.items || []);
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

  const employee = data?.employee || {};
  const employeeSummary = data?.employee_summary || employee;

  const displayName =
    data?.dashboard_display?.title ||
    employee?.name ||
    employeeSummary?.name ||
    'Employee';

  const mappedCapabilityLabel = capabilityLabel(data, employee);

  const isMappedApprover = Boolean(
    data?.is_team_leader ||
      data?.is_reporting_officer ||
      isTruthy(employee?.is_team_leader) ||
      isTruthy(employee?.is_reporting_officer),
  );

  const holiday = attendanceStatus?.holiday || data?.holiday || {};
  const todayAttendance =
    attendanceStatus?.attendance || data?.today_attendance || null;

  const availableModes =
    attendanceStatus?.available_modes ||
    data?.available_attendance_modes ||
    ['office'];

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

  const approvalCounts = data?.pending_approval_counts || {
    leave_requests: data?.team_pending_leaves?.length || 0,
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

  const leaveBalanceRows = (data?.leave_balances || []).map((row) => ({
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    opening_balance: row.opening_balance ?? '—',
    credited: row.credited ?? '—',
    used: row.used ?? '—',
    available: row.available ?? '—',
    status: statusLabel(row.status),
  }));

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

  const leaveRows = (data?.leaves || []).map((row) => ({
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    from_date: row.from_date || '—',
    upto_date: row.to_date || row.upto_date || '—',
    leave_days: row.leave_days ?? '—',
    reason: row.reason || '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    approval_stage: row.approval_stage_label || statusLabel(row.approval_stage),
    status: statusLabel(row.status),
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

  const teamPendingLeaveRows = (data?.team_pending_leaves || []).map((row) => ({
    employee_name: row.employee_name || '—',
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    from_date: row.from_date || '—',
    upto_date: row.to_date || row.upto_date || '—',
    leave_days: row.leave_days ?? '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    approval_stage: row.approval_stage_label || statusLabel(row.approval_stage),
    status: statusLabel(row.status),
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

  const todayStatus = statusLabel(todayAttendance?.status || 'Not checked-in');

  return (
    <div className="page-grid employee-dashboard-page">
      <section className="hero employee-hero">
        <div className="employee-identity">
          <span className="kicker">Employee Self Service</span>

          <h1 className="employee-name-heading dashboard-display-name">
            {displayName}
          </h1>

          <p className="employee-dashboard-subtitle">
            Employee dashboard for attendance, leave, profile, tickets,
            notifications, and assigned approval responsibilities.
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

        <Stat label="Available Comp-Off" value={availableCompOffs.length} />

        <Stat label="Pending WFH/Field" value={pendingModeRequests.length} />

        <Stat label="Team Members" value={data?.team_members?.length || 0} />

        <Stat
          label="Reporting Members"
          value={data?.reporting_members?.length || 0}
        />

        <Stat
          label="Pending Leave Approvals"
          value={approvalCounts.leave_requests || 0}
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
              <h3>My Leave Balance</h3>
              <p>Casual Leave and Earned Leave are maintained separately.</p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('leave_balances')}
            >
              View Balance
            </button>
          </div>

          <Table rows={leaveBalanceRows} maxColumns={8} />
        </div>

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
      </section>

      <section className="panel">
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
        <section className="two-col">
          <div className="panel">
            <div className="toolbar">
              <div>
                <h3>Pending Leave Approvals</h3>
                <p>
                  Shows only leave requests currently pending at your mapped
                  approval stage.
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

            <Table rows={teamPendingLeaveRows} maxColumns={9} />
          </div>

          <div className="panel">
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
          </div>
        </section>
      )}

      <section className="panel">
        <h3>My Performance Reviews</h3>
        <p>This is visible to the employee, HR, and Super Admin.</p>
        <Table rows={myReviewRows} maxColumns={8} />
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>My Leaves</h3>
              <p>Your recent leave requests and approval status.</p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('leave_requests')}
            >
              Apply Leave
            </button>
          </div>

          <Table rows={leaveRows} maxColumns={8} />
        </div>

        <div className="panel">
          <h3>My Tickets</h3>
          <Table rows={data?.tickets || []} maxColumns={8} />
        </div>
      </section>

      <section className="panel">
        <h3>My Notifications</h3>
        <Table rows={notificationRows} maxColumns={8} />
      </section>
    </div>
  );
}