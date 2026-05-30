import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  Filter,
  MapPin,
  RefreshCcw,
  Search,
  UserRound,
  X,
} from 'lucide-react';
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
  employee_name: '',
  department: '',
  organisation: '',
  state: '',
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


function cleanText(value, fallback = '—') {
  const text = String(value || '').trim();
  return text || fallback;
}

function attendanceStatusClass(value) {
  const normalized = String(value || '').toLowerCase();

  if (normalized.includes('late')) return 'is-late';
  if (normalized.includes('holiday')) return 'is-holiday';
  if (normalized.includes('early')) return 'is-warning';
  if (normalized.includes('present')) return 'is-present';
  if (normalized.includes('absent')) return 'is-absent';

  return 'is-neutral';
}

function locationText(location) {
  if (!location || typeof location !== 'object') {
    return '—';
  }

  const latitude = location.latitude;
  const longitude = location.longitude;

  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
    return cleanText(location.address || location.location_address);
  }

  const accuracy = location.accuracy
    ? ` • ±${Math.round(Number(location.accuracy))}m`
    : '';

  const address = cleanText(location.address || location.location_address, '');

  return address
    ? `${address} • ${latitude}, ${longitude}${accuracy}`
    : `${latitude}, ${longitude}${accuracy}`;
}

function locationMapUrl(location) {
  if (!location || typeof location !== 'object') {
    return '';
  }

  const latitude = location.latitude;
  const longitude = location.longitude;

  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
    return '';
  }

  return `https://www.google.com/maps?q=${latitude},${longitude}`;
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
  return rows.map((row) => {
    const organisation =
      row.organisation ||
      row.organization ||
      row.organisation_name ||
      row.organization_name ||
      row.organisation_code ||
      row.organization_code ||
      '';

    return {
      employee_name: row.employee_name || '—',
      employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      organisation: organisation || '—',
      organisation_code: row.organisation_code || row.organization_code || '',
      state: row.state || '—',
      date: formatDate(row.date),
      raw_date: row.date || '',
      mode: modeLabel(row.mode),
      status: statusLabel(row.status),
      raw_status: row.status || '',
      check_in: formatDateTime(row.check_in),
      check_out: formatDateTime(row.check_out),
      check_in_location: row.check_in_location || null,
      check_out_location: row.check_out_location || null,
      check_in_location_text: locationText(row.check_in_location),
      check_out_location_text: locationText(row.check_out_location),
      check_in_map_url: locationMapUrl(row.check_in_location),
      check_out_map_url: locationMapUrl(row.check_out_location),
      field_location: row.field_location || '—',
      late_reason: row.late_reason || '—',
      early_checkout_reason: row.early_checkout_reason || '—',
      holiday: row.holiday_title || '—',
      verified: row.verified_by_ro ? 'Yes' : 'No',
      _id: row._id,
      verified_by_ro: row.verified_by_ro,
    };
  });
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


function AttendanceReportList({ rows = [], loading = false }) {
  if (loading) {
    return (
      <div className="attendance-record-list">
        {[1, 2, 3].map((item) => (
          <div key={item} className="attendance-record-card is-loading">
            <div className="attendance-skeleton-line wide" />
            <div className="attendance-skeleton-line" />
            <div className="attendance-skeleton-grid">
              <span />
              <span />
              <span />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="attendance-empty-state">
        <CalendarDays size={34} />
        <strong>No attendance records found</strong>
        <span>Today’s attendance will appear here. Use filters to view past records.</span>
      </div>
    );
  }

  return (
    <div className="attendance-record-list">
      {rows.map((row) => (
        <article key={row._id || `${row.employee_id}-${row.raw_date}`} className="attendance-record-card">
          <div className="attendance-record-top">
            <div className="attendance-employee-block">
              <div className="attendance-avatar">
                <UserRound size={18} />
              </div>

              <div>
                <h4>{cleanText(row.employee_name)}</h4>
                <p>
                  {cleanText(row.employee_id)}
                  {' • '}
                  {cleanText(row.designation)}
                </p>
              </div>
            </div>

            <span className={`attendance-status-pill ${attendanceStatusClass(row.status)}`}>
              {cleanText(row.status)}
            </span>
          </div>

          <div className="attendance-meta-grid">
            <div>
              <span>Date</span>
              <strong>{cleanText(row.date)}</strong>
            </div>

            <div>
              <span>Mode</span>
              <strong>{cleanText(row.mode)}</strong>
            </div>

            <div>
              <span>Department</span>
              <strong>{cleanText(row.department)}</strong>
            </div>

            <div>
              <span>Organisation</span>
              <strong>{cleanText(row.organisation)}</strong>
            </div>

            <div>
              <span>State</span>
              <strong>{cleanText(row.state)}</strong>
            </div>

            <div>
              <span>Verified</span>
              <strong>{cleanText(row.verified)}</strong>
            </div>
          </div>

          <div className="attendance-time-grid">
            <div>
              <span>Check In</span>
              <strong>{cleanText(row.check_in)}</strong>
            </div>

            <div>
              <span>Check Out</span>
              <strong>{cleanText(row.check_out)}</strong>
            </div>

            <div>
              <span>Late Reason</span>
              <strong>{cleanText(row.late_reason)}</strong>
            </div>

            <div>
              <span>Early Checkout Reason</span>
              <strong>{cleanText(row.early_checkout_reason)}</strong>
            </div>
          </div>

          <div className="attendance-location-grid">
            <div className="attendance-location-box">
              <MapPin size={16} />
              <div>
                <span>Check-in Location</span>
                <strong>{cleanText(row.check_in_location_text)}</strong>

                {row.check_in_map_url && (
                  <a href={row.check_in_map_url} target="_blank" rel="noreferrer">
                    Open map
                  </a>
                )}
              </div>
            </div>

            <div className="attendance-location-box">
              <MapPin size={16} />
              <div>
                <span>Check-out Location</span>
                <strong>{cleanText(row.check_out_location_text)}</strong>

                {row.check_out_map_url && (
                  <a href={row.check_out_map_url} target="_blank" rel="noreferrer">
                    Open map
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="attendance-record-footer">
            <div>
              <span>Field Location</span>
              <strong>{cleanText(row.field_location)}</strong>
            </div>

            <div className="attendance-record-action">
              {row.action}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
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

  const isHrAdminAttendanceView = userRoles.some((role) =>
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'].includes(role),
  );

  const showEmployeeSelfAttendancePanel = !isHrAdminAttendanceView;

  const canManageHoliday = userRoles.some((role) =>
    ['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr'].includes(role),
  );

  const hasActiveReportFilters = useMemo(() => {
    return Object.values(filters).some((value) => String(value || '').trim());
  }, [filters]);


  const reportSummary = useMemo(() => {
    const total = report.length;

    return {
      total,
      present: report.filter((row) => String(row.raw_status || row.status || '').toLowerCase().includes('present')).length,
      late: report.filter((row) => String(row.raw_status || row.status || '').toLowerCase().includes('late')).length,
      verified: report.filter((row) => row.verified_by_ro).length,
    };
  }, [report]);

  async function loadMyAttendance() {
    if (!showEmployeeSelfAttendancePanel) {
      setMyAttendance([]);
      return;
    }

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
    if (!showEmployeeSelfAttendancePanel) {
      setMyModeRequests([]);
      return;
    }

    const data = await api('/attendance/my-mode-requests');
    setMyModeRequests(normalizeModeRequestRows(data.items || []));
  }

  async function loadHolidays() {
    if (!canManageHoliday) return;

    const data = await api('/attendance/holidays');
    setHolidays(normalizeHolidayRows(data.items || []));
  }

  async function loadMyCompOffs() {
    if (!showEmployeeSelfAttendancePanel) {
      setMyCompOffs([]);
      return;
    }

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
          <span className="kicker">
            {isHrAdminAttendanceView ? 'HR Attendance Control' : 'Office + WFH + Field'}
          </span>
          <h1>Attendance Management</h1>
          <p>
            {isHrAdminAttendanceView
              ? 'Monitor daily attendance records, employee locations, late reasons, WFH/Field approvals, and holiday attendance from one HR control panel.'
              : 'Press and hold for attendance, capture exact latitude and longitude, manage late entry reasons after 09:50 AM, early checkout reasons, holiday work, WFH/Field approvals and comp-off claims.'}
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

                {showEmployeeSelfAttendancePanel && (
          <AttendanceWidget onSuccess={refreshAttendance} />
        )}
      </section>

      {message && <div className="inline-message">{message}</div>}

              {showEmployeeSelfAttendancePanel && (
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
      )}

      {showEmployeeSelfAttendancePanel && (
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
      )}

      {canViewReport && (
        <section className="panel attendance-report-panel">
          <div className="attendance-report-header">
            <div>
              <span className="kicker">Daily Attendance</span>
              <h3>Today’s Attendance Records</h3>
              <p>
                Showing daily attendance by default. Past records will appear only after selecting a date or date range.
              </p>
            </div>

            <div className="attendance-report-actions">
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
          </div>

          <div className="attendance-summary-grid">
            <div className="attendance-summary-card">
              <span>Total Records</span>
              <strong>{reportSummary.total}</strong>
            </div>

            <div className="attendance-summary-card">
              <span>Present</span>
              <strong>{reportSummary.present}</strong>
            </div>

            <div className="attendance-summary-card">
              <span>Late</span>
              <strong>{reportSummary.late}</strong>
            </div>

            <div className="attendance-summary-card">
              <span>Verified</span>
              <strong>{reportSummary.verified}</strong>
            </div>
          </div>

          <form className="attendance-filter-card" onSubmit={searchReport}>
            <div className="attendance-filter-title">
              <Filter size={16} />
              <strong>Filter attendance</strong>
              <span>Use filters only when you need specific employee or past records.</span>
            </div>

            <div className="attendance-filter-grid">
              <label>
                Employee Name
                <input
                  value={filters.employee_name}
                  onChange={(e) =>
                    setFilters({ ...filters, employee_name: e.target.value })
                  }
                  placeholder="Search by name, email or code"
                />
              </label>

              <label>
                Employee ID
                <input
                  value={filters.employee_id}
                  onChange={(e) =>
                    setFilters({ ...filters, employee_id: e.target.value })
                  }
                  placeholder="Employee ID"
                />
              </label>

              <label>
                Organisation / Entity
                <div className="input-with-icon">
                  <Building2 size={16} />
                  <input
                    value={filters.organisation}
                    onChange={(e) =>
                      setFilters({ ...filters, organisation: e.target.value })
                    }
                    placeholder="SDS / AVPL / SDF"
                  />
                </div>
              </label>

              <label>
                State
                <input
                  value={filters.state}
                  onChange={(e) =>
                    setFilters({ ...filters, state: e.target.value })
                  }
                  placeholder="State"
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
            </div>

            <div className="attendance-filter-actions">
              <button type="submit" className="primary" disabled={loadingReport}>
                <Search size={16} />
                {loadingReport ? 'Searching...' : 'Search Records'}
              </button>

              <button
                type="button"
                className="secondary"
                onClick={clearReportFilters}
                disabled={loadingReport}
              >
                Clear
              </button>
            </div>
          </form>

          <AttendanceReportList rows={reportRows} loading={loadingReport} />
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