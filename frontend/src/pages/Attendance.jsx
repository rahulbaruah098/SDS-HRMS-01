import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Search, X } from 'lucide-react';
import { api } from '../api/client';
import {
  roles,
  isHRUser,
  isTeamLeader,
  isReportingOfficer,
} from '../utils/authHelpers';
import AttendanceWidget from '../components/AttendanceWidget';
import Table from '../components/Table';

const HOLIDAY_STATES = [
  'Assam(HO)',
  'Manipur',
  'Mizoram',
  'Arunachal Pradesh',
];

const EMPTY_REPORT_FILTERS = {
  employee_id: '',
  department: '',
  mode: '',
  status: '',
  date_from: '',
  date_to: '',
};

const EMPTY_HOLIDAY_FORM = {
  state: 'Assam(HO)',
  date: '',
  title: '',
  message: '',
};

const EMPTY_MODE_REQUEST_FORM = {
  mode: 'wfh',
  date: '',
  reason: '',
  field_location: '',
};

const EMPTY_COMPOFF_FORM = {
  compoff_id: '',
  claim_date: '',
  reason: '',
};

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.append(key, value);
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function formatDate(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

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
    if (Number.isNaN(parsed.getTime())) return value;

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
  return mode || '—';
}

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function requestLiveStatus(row = {}) {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';

  if (stage === 'team_leader') return 'Pending with Team Leader';
  if (stage === 'reporting_officer') return 'Pending with Reporting Officer';
  if (stage === 'hr') return 'Pending with HR';

  return row.approval_stage_label || statusLabel(row.status);
}

function normalizeAttendanceRows(rows = []) {
  return rows.map((row) => ({
    employee_name: row.employee_name || '—',
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
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
    holiday: row.holiday_title || '—',
    verified: row.verified_by_ro ? 'Yes' : 'No',
    _id: row._id,
    verified_by_ro: row.verified_by_ro,
  }));
}

function normalizeModeRequestRows(rows = []) {
  return rows.map((row) => ({
    employee_name: row.employee_name || '—',
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    team_leader: row.team_leader_name || '—',
    reporting_officer: row.reporting_officer_name || '—',
    mode: modeLabel(row.mode),
    date: formatDate(row.date),
    reason: row.reason || '—',
    field_location: row.field_location || '—',
    current_stage: requestLiveStatus(row),
    status: statusLabel(row.status),
    decided_by: row.decided_by_name || row.approved_by_name || row.rejected_by_name || '—',
    decided_at: formatDateTime(row.decided_at || row.approved_at || row.rejected_at),
    _id: row._id,
    raw_status: row.status,
    raw_stage: row.approval_stage,
  }));
}

function normalizeHolidayRows(rows = []) {
  return rows.map((row) => ({
    state: row.state || '—',
    date: formatDate(row.date),
    title: row.title || '—',
    message: row.message || '—',
    status: statusLabel(row.status),
    created_at: formatDateTime(row.created_at),
    _id: row._id,
  }));
}

function normalizeCompOffRows(rows = []) {
  return rows.map((row) => ({
    employee_name: row.employee_name || '—',
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    earned_date: formatDate(row.earned_date),
    valid_until: formatDate(row.valid_until),
    claimed_date: formatDate(row.claimed_date),
    holiday: row.holiday_title || '—',
    status: statusLabel(row.status),
    _id: row._id,
    raw_status: row.status,
  }));
}

export default function Attendance() {
  const [myAttendance, setMyAttendance] = useState([]);
  const [report, setReport] = useState([]);
  const [modeRequests, setModeRequests] = useState([]);
  const [myModeRequests, setMyModeRequests] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [myCompOffs, setMyCompOffs] = useState([]);

  const [message, setMessage] = useState('');
  const [loadingPage, setLoadingPage] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [submittingModeRequest, setSubmittingModeRequest] = useState(false);
  const [decidingRequestId, setDecidingRequestId] = useState('');
  const [verifyingId, setVerifyingId] = useState('');
  const [claimingCompOff, setClaimingCompOff] = useState(false);

  const [filters, setFilters] = useState({ ...EMPTY_REPORT_FILTERS });
  const [holidayForm, setHolidayForm] = useState({ ...EMPTY_HOLIDAY_FORM });
  const [modeRequestForm, setModeRequestForm] = useState({
    ...EMPTY_MODE_REQUEST_FORM,
  });
  const [compOffForm, setCompOffForm] = useState({ ...EMPTY_COMPOFF_FORM });

  const userRoles = roles();

  const canViewReport =
    isHRUser() ||
    isTeamLeader() ||
    isReportingOfficer() ||
    userRoles.some((role) =>
      ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'].includes(role),
    );

  const canManageHoliday = userRoles.some((role) =>
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'].includes(role),
  );

  const hasActiveReportFilters = useMemo(() => {
    return Object.values(filters).some((value) => String(value || '').trim());
  }, [filters]);

  async function loadMyAttendance() {
    const data = await api('/attendance/my');
    setMyAttendance(normalizeAttendanceRows(data.items || []));
  }

  async function loadReport(nextFilters = filters) {
    if (!canViewReport) return;

    setLoadingReport(true);

    try {
      const data = await api(`/attendance/report${buildQuery(nextFilters)}`);
      setReport(normalizeAttendanceRows(data.items || []));
    } finally {
      setLoadingReport(false);
    }
  }

  async function loadModeRequests() {
    if (!canViewReport) return;

    const data = await api('/attendance/mode-requests');
    setModeRequests(normalizeModeRequestRows(data.items || []));
  }

  async function loadMyModeRequests() {
    const data = await api('/attendance/my-mode-requests');
    setMyModeRequests(normalizeModeRequestRows(data.items || []));
  }

  async function loadHolidays() {
    if (!canManageHoliday) return;

    const data = await api('/attendance/holidays');
    setHolidays(normalizeHolidayRows(data.items || []));
  }

  async function loadMyCompOffs() {
    const data = await api('/attendance/compoffs');
    setMyCompOffs(normalizeCompOffRows(data.items || []));
  }

  async function refreshAttendance() {
    try {
      setMessage('');
      setLoadingPage(true);

      await Promise.all([
        loadMyAttendance(),
        loadMyModeRequests(),
        loadMyCompOffs(),
        canViewReport ? loadReport(filters) : Promise.resolve(),
        canViewReport ? loadModeRequests() : Promise.resolve(),
        canManageHoliday ? loadHolidays() : Promise.resolve(),
      ]);
    } catch (error) {
      setMessage(error.message || 'Unable to refresh attendance data');
    } finally {
      setLoadingPage(false);
    }
  }

  useEffect(() => {
    refreshAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchReport(event) {
    event.preventDefault();

    try {
      setMessage('');
      await loadReport(filters);
    } catch (error) {
      setMessage(error.message || 'Unable to load attendance report');
    }
  }

  async function clearReportFilters() {
    const cleared = { ...EMPTY_REPORT_FILTERS };

    try {
      setMessage('');
      setFilters(cleared);
      await loadReport(cleared);
    } catch (error) {
      setMessage(error.message || 'Unable to clear report filters');
    }
  }

  async function verifyAttendance(row) {
    const attendanceId = row?._id;

    if (!attendanceId) {
      setMessage('Attendance id not found');
      return;
    }

    const ok = window.confirm('Verify this attendance record?');

    if (!ok) return;

    try {
      setMessage('');
      setVerifyingId(attendanceId);

      const data = await api(`/attendance/${attendanceId}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });

      setMessage(data.message || 'Attendance verified');
      await loadReport(filters);
    } catch (error) {
      setMessage(error.message || 'Unable to verify attendance');
    } finally {
      setVerifyingId('');
    }
  }

  async function createHoliday(event) {
    event.preventDefault();

    if (!holidayForm.date || !holidayForm.title.trim()) {
      setMessage('Holiday date and title are required');
      return;
    }

    try {
      setMessage('');
      setSavingHoliday(true);

      const data = await api('/attendance/holidays', {
        method: 'POST',
        body: JSON.stringify(holidayForm),
      });

      setMessage(data.message || 'Holiday added');
      setHolidayForm({ ...EMPTY_HOLIDAY_FORM });
      await loadHolidays();
    } catch (error) {
      setMessage(error.message || 'Unable to add holiday');
    } finally {
      setSavingHoliday(false);
    }
  }

  async function submitModeRequest(event) {
    event.preventDefault();

    if (!modeRequestForm.date || !modeRequestForm.reason.trim()) {
      setMessage('Date and reason are required for WFH / Field request');
      return;
    }

    if (
      modeRequestForm.mode === 'field' &&
      !modeRequestForm.field_location.trim()
    ) {
      setMessage('Field location is required for field request');
      return;
    }

    try {
      setMessage('');
      setSubmittingModeRequest(true);

      const data = await api('/attendance/mode-requests', {
        method: 'POST',
        body: JSON.stringify(modeRequestForm),
      });

      setMessage(
        data.message ||
          'Your WFH / Field request has been sent for approval.',
      );

      setModeRequestForm({ ...EMPTY_MODE_REQUEST_FORM });

      await Promise.all([
        loadMyModeRequests(),
        canViewReport ? loadModeRequests() : Promise.resolve(),
      ]);
    } catch (error) {
      setMessage(error.message || 'Unable to submit request');
    } finally {
      setSubmittingModeRequest(false);
    }
  }

  async function decideModeRequest(row, status) {
    const requestId = row?._id;

    if (!requestId) {
      setMessage('Request id not found');
      return;
    }

    const ok = window.confirm(`${statusLabel(status)} this WFH / Field request?`);

    if (!ok) return;

    try {
      setMessage('');
      setDecidingRequestId(requestId);

      const data = await api(`/attendance/mode-requests/${requestId}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      setMessage(data.message || `Request ${status}`);

      await Promise.all([
        loadModeRequests(),
        loadMyModeRequests(),
        loadReport(filters),
      ]);
    } catch (error) {
      setMessage(error.message || 'Unable to update request');
    } finally {
      setDecidingRequestId('');
    }
  }

  async function claimCompOff(event) {
    event.preventDefault();

    if (!compOffForm.compoff_id || !compOffForm.claim_date) {
      setMessage('Select comp-off and claim date');
      return;
    }

    try {
      setMessage('');
      setClaimingCompOff(true);

      const data = await api(`/attendance/compoffs/${compOffForm.compoff_id}/claim`, {
        method: 'POST',
        body: JSON.stringify({
          claim_date: compOffForm.claim_date,
          reason: compOffForm.reason,
        }),
      });

      setMessage(data.message || 'Comp-off claim submitted');
      setCompOffForm({ ...EMPTY_COMPOFF_FORM });
      await loadMyCompOffs();
    } catch (error) {
      setMessage(error.message || 'Unable to claim comp-off');
    } finally {
      setClaimingCompOff(false);
    }
  }

  const reportRows = report.map((row) => ({
    ...row,
    action: row.verified_by_ro ? (
      'Verified'
    ) : (
      <button
        type="button"
        className="secondary"
        onClick={() => verifyAttendance(row)}
        disabled={verifyingId === row._id}
      >
        {verifyingId === row._id ? 'Verifying...' : 'Verify'}
      </button>
    ),
  }));

  const pendingModeRequestCount = modeRequests.filter(
    (row) => row.raw_status === 'pending',
  ).length;

  const modeRequestRows = modeRequests.map((row) => ({
    ...row,
    action:
      row.raw_status === 'pending' ? (
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => decideModeRequest(row, 'approved')}
            disabled={decidingRequestId === row._id}
          >
            {decidingRequestId === row._id ? 'Approving...' : 'Approve'}
          </button>

          <button
            type="button"
            className="danger"
            onClick={() => decideModeRequest(row, 'rejected')}
            disabled={decidingRequestId === row._id}
          >
            {decidingRequestId === row._id ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
      ) : (
        statusLabel(row.raw_status)
      ),
  }));

  const availableCompOffs = myCompOffs.filter(
    (item) => item.raw_status === 'available',
  );

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Office + WFH + Field</span>
          <h1>Attendance Management</h1>
          <p>
            Press and hold for attendance, capture exact latitude and longitude,
            manage late entry reasons after 09:50 AM, early checkout reasons,
            holiday work, WFH/Field approvals and comp-off claims.
          </p>

          <div className="hero-actions">
            <button
              type="button"
              className="secondary"
              onClick={refreshAttendance}
              disabled={loadingPage}
            >
              <RefreshCcw size={16} />
              {loadingPage ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <AttendanceWidget onSuccess={refreshAttendance} />
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="two-col">
        <div className="panel">
          <h3>Request Work From Home / Field</h3>
          <p>
            WFH and Field check-in buttons will appear only after approval for
            the selected date. Approval follows your mapped Team Leader /
            Reporting Officer workflow.
          </p>

          <form className="dynamic-form" onSubmit={submitModeRequest}>
            <label>
              Mode
              <select
                value={modeRequestForm.mode}
                onChange={(e) =>
                  setModeRequestForm({
                    ...modeRequestForm,
                    mode: e.target.value,
                  })
                }
                disabled={submittingModeRequest}
              >
                <option value="wfh">Work From Home</option>
                <option value="field">Field</option>
              </select>
            </label>

            <label>
              Date
              <input
                type="date"
                value={modeRequestForm.date}
                onChange={(e) =>
                  setModeRequestForm({
                    ...modeRequestForm,
                    date: e.target.value,
                  })
                }
                disabled={submittingModeRequest}
              />
            </label>

            {modeRequestForm.mode === 'field' && (
              <label>
                Field Location
                <input
                  value={modeRequestForm.field_location}
                  onChange={(e) =>
                    setModeRequestForm({
                      ...modeRequestForm,
                      field_location: e.target.value,
                    })
                  }
                  placeholder="Visit place / client location"
                  disabled={submittingModeRequest}
                />
              </label>
            )}

            <label>
              Reason
              <textarea
                value={modeRequestForm.reason}
                onChange={(e) =>
                  setModeRequestForm({
                    ...modeRequestForm,
                    reason: e.target.value,
                  })
                }
                placeholder="Reason for WFH / Field attendance"
                disabled={submittingModeRequest}
              />
            </label>

            <button
              type="submit"
              className="primary"
              disabled={submittingModeRequest}
            >
              {submittingModeRequest ? 'Submitting...' : 'Submit Request'}
            </button>
          </form>
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>My WFH / Field Requests</h3>
              <p>Track whether your request is pending, approved, or rejected.</p>
            </div>
          </div>

          <Table rows={myModeRequests} maxColumns={10} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>My Attendance</h3>
          <Table rows={myAttendance} maxColumns={10} />
        </div>

        <div className="panel">
          <h3>My Comp-Off Credits</h3>

          <form className="dynamic-form" onSubmit={claimCompOff}>
            <label>
              Available Comp-Off
              <select
                value={compOffForm.compoff_id}
                onChange={(e) =>
                  setCompOffForm({
                    ...compOffForm,
                    compoff_id: e.target.value,
                  })
                }
                disabled={claimingCompOff}
              >
                <option value="">Select comp-off</option>
                {availableCompOffs.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.earned_date} — valid until {item.valid_until}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Claim Date
              <input
                type="date"
                value={compOffForm.claim_date}
                onChange={(e) =>
                  setCompOffForm({
                    ...compOffForm,
                    claim_date: e.target.value,
                  })
                }
                disabled={claimingCompOff}
              />
            </label>

            <label>
              Reason
              <input
                value={compOffForm.reason}
                onChange={(e) =>
                  setCompOffForm({
                    ...compOffForm,
                    reason: e.target.value,
                  })
                }
                placeholder="Optional reason"
                disabled={claimingCompOff}
              />
            </label>

            <button
              type="submit"
              className="primary"
              disabled={claimingCompOff || !availableCompOffs.length}
            >
              {claimingCompOff ? 'Claiming...' : 'Claim Comp-Off'}
            </button>
          </form>

          <Table rows={myCompOffs} maxColumns={10} />
        </div>
      </section>

      {canViewReport && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>Attendance Report</h3>
              <p>
                HR/Admin can view records across the company. Mapped Team
                Leaders and Reporting Officers can view records for employees
                assigned under them.
              </p>
            </div>

            {hasActiveReportFilters && (
              <button
                type="button"
                className="secondary"
                onClick={clearReportFilters}
                disabled={loadingReport}
              >
                <X size={16} />
                Clear Filters
              </button>
            )}
          </div>

          <form className="dynamic-form" onSubmit={searchReport}>
            <label>
              Employee ID
              <input
                value={filters.employee_id}
                onChange={(e) =>
                  setFilters({ ...filters, employee_id: e.target.value })
                }
                placeholder="Employee Mongo ID"
              />
            </label>

            <label>
              Department
              <input
                value={filters.department}
                onChange={(e) =>
                  setFilters({ ...filters, department: e.target.value })
                }
                placeholder="Department"
              />
            </label>

            <label>
              Mode
              <select
                value={filters.mode}
                onChange={(e) =>
                  setFilters({ ...filters, mode: e.target.value })
                }
              >
                <option value="">All Modes</option>
                <option value="office">Office</option>
                <option value="wfh">Work From Home</option>
                <option value="field">Field</option>
              </select>
            </label>

            <label>
              Status
              <select
                value={filters.status}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value })
                }
              >
                <option value="">All Status</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="early_checkout">Early Checkout</option>
                <option value="holiday_work">Holiday Work</option>
              </select>
            </label>

            <label>
              Date From
              <input
                type="date"
                value={filters.date_from}
                onChange={(e) =>
                  setFilters({ ...filters, date_from: e.target.value })
                }
              />
            </label>

            <label>
              Date To
              <input
                type="date"
                value={filters.date_to}
                onChange={(e) =>
                  setFilters({ ...filters, date_to: e.target.value })
                }
              />
            </label>

            <button type="submit" className="primary" disabled={loadingReport}>
              <Search size={16} />
              {loadingReport ? 'Searching...' : 'Search'}
            </button>

            <button
              type="button"
              className="secondary"
              onClick={clearReportFilters}
              disabled={loadingReport}
            >
              Clear
            </button>
          </form>

          <Table rows={reportRows} maxColumns={12} />
        </section>
      )}

      {canViewReport && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>WFH / Field Approval Requests</h3>
              <p>
                Approval access is based on HR/Admin permission or employee
                mapping as Team Leader / Reporting Officer.
              </p>
            </div>

            <span className="employee-role-pill">
              Pending Requests: {pendingModeRequestCount}
            </span>
          </div>

          <Table rows={modeRequestRows} maxColumns={12} />
        </section>
      )}

      {canManageHoliday && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>State-wise Holiday Calendar</h3>
              <p>
                Add holidays for Assam(HO), Manipur, Mizoram and Arunachal
                Pradesh. Holiday message will show on dashboard and attendance.
              </p>
            </div>
          </div>

          <form className="dynamic-form" onSubmit={createHoliday}>
            <label>
              State
              <select
                value={holidayForm.state}
                onChange={(e) =>
                  setHolidayForm({ ...holidayForm, state: e.target.value })
                }
                disabled={savingHoliday}
              >
                {HOLIDAY_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date
              <input
                type="date"
                value={holidayForm.date}
                onChange={(e) =>
                  setHolidayForm({ ...holidayForm, date: e.target.value })
                }
                disabled={savingHoliday}
              />
            </label>

            <label>
              Holiday Title
              <input
                value={holidayForm.title}
                onChange={(e) =>
                  setHolidayForm({ ...holidayForm, title: e.target.value })
                }
                placeholder="Example: Bohag Bihu"
                disabled={savingHoliday}
              />
            </label>

            <label>
              Message
              <textarea
                value={holidayForm.message}
                onChange={(e) =>
                  setHolidayForm({ ...holidayForm, message: e.target.value })
                }
                placeholder="Holiday message for employees"
                disabled={savingHoliday}
              />
            </label>

            <button type="submit" className="primary" disabled={savingHoliday}>
              {savingHoliday ? 'Adding...' : 'Add Holiday'}
            </button>
          </form>

          <Table rows={holidays} maxColumns={8} />
        </section>
      )}
    </div>
  );
}