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
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

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

const EMPTY_HOLIDAY_WORK_FILTERS = {
  status: '',
  date: '',
};

const EMPTY_TEAM_FIELD_FILTERS = {
  start: '',
  end: '',
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

function fieldPhotoValue(row = {}) {
  return (
    row.field_photo ||
    row.field_photo_url ||
    row.photo_url ||
    row.proof_photo ||
    row.photo ||
    row.check_in_photo ||
    ''
  );
}

function normalizeImageSrc(value = '') {
  const photo = String(value || '').trim();

  if (!photo) {
    return '';
  }

  if (
    photo.startsWith('data:image/') ||
    photo.startsWith('http://') ||
    photo.startsWith('https://') ||
    photo.startsWith('/uploads/')
  ) {
    return photo;
  }

  if (photo.startsWith('uploads/')) {
    return `/${photo}`;
  }

  // If backend stored only raw base64 without data:image prefix
  if (photo.length > 100 && !photo.includes(' ')) {
    return `data:image/jpeg;base64,${photo}`;
  }

  return photo;
}


function openImagePreview(photoSrc = '') {
  if (!photoSrc) {
    return;
  }

  const win = window.open('', '_blank');

  if (!win) {
    return;
  }

  win.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Field Attendance Photo</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #111827;
            font-family: Arial, sans-serif;
          }

          img {
            max-width: 96vw;
            max-height: 96vh;
            object-fit: contain;
            border-radius: 12px;
            background: #ffffff;
            box-shadow: 0 20px 60px rgba(0,0,0,.45);
          }
        </style>
      </head>
      <body>
        <img src="${photoSrc}" alt="Field Attendance Photo" />
      </body>
    </html>
  `);

  win.document.close();
}

function FieldPhotoPreview({ row }) {
  const photoSrc = normalizeImageSrc(fieldPhotoValue(row));

  if (!photoSrc) {
    return <span>—</span>;
  }

  return (
    <div className="field-photo-preview">
      <img
        src={photoSrc}
        alt="Field attendance"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />

      <button
        type="button"
        className="field-photo-open-button"
        onClick={() => openImagePreview(photoSrc)}
      >
        Open Photo
      </button>
    </div>
  );
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
      raw_mode: row.mode || '',
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
field_location: row.field_location || row.work_location || '—',
field_photo:
  row.field_photo ||
  row.field_photo_url ||
  row.photo_url ||
  row.proof_photo ||
  row.photo ||
  row.check_in_photo ||
  '',
field_photo_url:
  row.field_photo_url ||
  row.field_photo ||
  row.photo_url ||
  row.proof_photo ||
  row.photo ||
  row.check_in_photo ||
  '',
photo_url:
  row.photo_url ||
  row.field_photo_url ||
  row.field_photo ||
  row.proof_photo ||
  row.photo ||
  row.check_in_photo ||
  '',
late_reason: row.late_reason || '—',
      early_checkout_reason: row.early_checkout_reason || '—',
      holiday: row.holiday_title || '—',
      verified: row.verified_by_ro ? 'Yes' : 'No',
      _id: row._id,
      verified_by_ro: row.verified_by_ro,
    };
  });
}

function normalizeHolidayWorkRequestRows(rows = []) {
  return rows.map((row) => ({
    employee_name: row.employee_name || '—',
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    state: row.state || '—',
    team_leader: row.team_leader_name || '—',
    reporting_officer: row.reporting_officer_name || '—',
    date: formatDate(row.date),
    raw_date: row.date || '',
    holiday: row.holiday_title || '—',
    holiday_type: statusLabel(row.holiday_type),
    reason: row.reason || '—',
    work_location: row.work_location || row.field_location || '—',
    proof_photo: row.proof_photo || '',
    location_text: locationText(row.location),
    map_url: locationMapUrl(row.location),
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
            {String(row.raw_mode || '').toLowerCase() === 'field' && (
              <div>
                <span>Field Location</span>
                <strong>{cleanText(row.field_location)}</strong>

                <FieldPhotoPreview row={row} />
              </div>
            )}

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
  const alerts = useCustomAlert();

  const [myAttendance, setMyAttendance] = useState([]);
  const [report, setReport] = useState([]);
  const [holidayWorkRequests, setHolidayWorkRequests] = useState([]);
  const [myHolidayWorkRequests, setMyHolidayWorkRequests] = useState([]);
  const [teamFieldAttendance, setTeamFieldAttendance] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [myCompOffs, setMyCompOffs] = useState([]);

  const [loadingPage, setLoadingPage] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [decidingHolidayWorkId, setDecidingHolidayWorkId] = useState('');
  const [loadingTeamField, setLoadingTeamField] = useState(false);
  const [verifyingId, setVerifyingId] = useState('');
  const [claimingCompOff, setClaimingCompOff] = useState(false);

  const [filters, setFilters] = useState({ ...EMPTY_REPORT_FILTERS });
  const [holidayForm, setHolidayForm] = useState({ ...EMPTY_HOLIDAY_FORM });
  const [holidayWorkFilters, setHolidayWorkFilters] = useState({
    ...EMPTY_HOLIDAY_WORK_FILTERS,
  });

  const [teamFieldFilters, setTeamFieldFilters] = useState({
    ...EMPTY_TEAM_FIELD_FILTERS,
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

  async function loadHolidayWorkRequests(nextFilters = holidayWorkFilters) {
    if (!canViewReport) return;

    const data = await api(`/attendance/holiday-work-requests${buildQuery(nextFilters)}`);
    setHolidayWorkRequests(normalizeHolidayWorkRequestRows(data.items || []));
  }

  async function loadMyHolidayWorkRequests() {
    if (!showEmployeeSelfAttendancePanel) {
      setMyHolidayWorkRequests([]);
      return;
    }

    const data = await api('/attendance/my-holiday-work-requests');
    setMyHolidayWorkRequests(normalizeHolidayWorkRequestRows(data.items || []));
  }

  async function loadTeamFieldAttendance(nextFilters = teamFieldFilters) {
    if (!canViewReport) return;

    setLoadingTeamField(true);

    try {
      const data = await api(`/attendance/team-field-attendance${buildQuery(nextFilters)}`);
      setTeamFieldAttendance(normalizeAttendanceRows(data.items || []));
    } finally {
      setLoadingTeamField(false);
    }
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
    setLoadingPage(true);

      await Promise.all([
        loadMyAttendance(),
        loadMyHolidayWorkRequests(),
        loadMyCompOffs(),
        canViewReport ? loadReport(filters) : Promise.resolve(),
        canViewReport ? loadHolidayWorkRequests(holidayWorkFilters) : Promise.resolve(),
        canViewReport ? loadTeamFieldAttendance(teamFieldFilters) : Promise.resolve(),
        canManageHoliday ? loadHolidays() : Promise.resolve(),
      ]);
      } catch (error) {
        alerts.error(error.message || 'Unable to refresh attendance data', 'Refresh Failed');
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
        await loadReport(filters);
      } catch (error) {
        alerts.error(error.message || 'Unable to load attendance report', 'Report Load Failed');
      }
  }

  async function clearReportFilters() {
    const cleared = { ...EMPTY_REPORT_FILTERS };

    try {
      setFilters(cleared);
      await loadReport(cleared);
    } catch (error) {
      alerts.error(error.message || 'Unable to clear report filters', 'Clear Failed');
    }
  }

  async function verifyAttendance(row) {
    const attendanceId = row?._id;

    if (!attendanceId) {
      alerts.error('Attendance id not found', 'Missing Attendance ID');
      return;
    }

    const ok = await alerts.confirm('Verify this attendance record?', {
      title: 'Verify Attendance',
      confirmText: 'Yes, Verify',
      cancelText: 'Cancel',
      type: 'warning',
    });

    if (!ok) return;

    try {
      setVerifyingId(attendanceId);

      const data = await api(`/attendance/${attendanceId}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });

      alerts.success(data.message || 'Attendance verified', 'Attendance Verified');
      await loadReport(filters);
    } catch (error) {
      alerts.error(error.message || 'Unable to verify attendance', 'Verification Failed');
    } finally {
      setVerifyingId('');
    }
  }

async function createHoliday(event) {
  event.preventDefault();

  if (!holidayForm.date || !holidayForm.title.trim()) {
    alerts.warning('Holiday date and title are required', 'Missing Holiday Details');
    return;
  }

  try {
    setSavingHoliday(true);

    const data = await api('/attendance/holidays', {
      method: 'POST',
      body: JSON.stringify(holidayForm),
    });

    alerts.success(data.message || 'Holiday added', 'Holiday Added');
    setHolidayForm({ ...EMPTY_HOLIDAY_FORM });
    await loadHolidays();
  } catch (error) {
    alerts.error(error.message || 'Unable to add holiday', 'Holiday Save Failed');
  } finally {
    setSavingHoliday(false);
  }
}


async function decideHolidayWorkRequest(row, status) {
  const requestId = row?._id;

  if (!requestId) {
    alerts.error('Request id not found', 'Missing Request ID');
    return;
  }

  const decisionText = statusLabel(status);
  const isReject = String(status || '').toLowerCase() === 'rejected';

  const ok = await alerts.confirm(`${decisionText} this holiday work request?`, {
    title: `${decisionText} Holiday Work`,
    confirmText: `Yes, ${decisionText}`,
    cancelText: 'Cancel',
    type: 'warning',
    danger: isReject,
  });

  if (!ok) return;

  try {
    setDecidingHolidayWorkId(requestId);

    const data = await api(`/attendance/holiday-work-requests/${requestId}/decision`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });

    alerts.success(
      data.message || `Holiday work request ${status}`,
      isReject ? 'Holiday Work Rejected' : 'Holiday Work Approved',
    );

    await Promise.all([
      loadHolidayWorkRequests(holidayWorkFilters),
      loadMyHolidayWorkRequests(),
      loadReport(filters),
      loadTeamFieldAttendance(teamFieldFilters),
    ]);
  } catch (error) {
    alerts.error(error.message || 'Unable to update holiday work request', 'Update Failed');
  } finally {
    setDecidingHolidayWorkId('');
  }
}

async function searchHolidayWorkRequests(event) {
  event.preventDefault();

  try {
    await loadHolidayWorkRequests(holidayWorkFilters);
  } catch (error) {
    alerts.error(
      error.message || 'Unable to load holiday work requests',
      'Holiday Requests Load Failed',
    );
  }
}

async function clearHolidayWorkFilters() {
  const cleared = { ...EMPTY_HOLIDAY_WORK_FILTERS };

  try {
    setHolidayWorkFilters(cleared);
    await loadHolidayWorkRequests(cleared);
  } catch (error) {
    alerts.error(
      error.message || 'Unable to clear holiday work request filters',
      'Clear Failed',
    );
  }
}

async function searchTeamFieldAttendance(event) {
  event.preventDefault();

  try {
    await loadTeamFieldAttendance(teamFieldFilters);
  } catch (error) {
    alerts.error(
      error.message || 'Unable to load team field attendance',
      'Field Attendance Load Failed',
    );
  }
}

async function clearTeamFieldFilters() {
  const cleared = { ...EMPTY_TEAM_FIELD_FILTERS };

  try {
    setTeamFieldFilters(cleared);
    await loadTeamFieldAttendance(cleared);
  } catch (error) {
    alerts.error(
      error.message || 'Unable to clear team field attendance filters',
      'Clear Failed',
    );
  }
}

async function claimCompOff(event) {
  event.preventDefault();

  if (!compOffForm.compoff_id || !compOffForm.claim_date) {
    alerts.warning('Select comp-off and claim date', 'Missing Comp-Off Details');
    return;
  }

  try {
    setClaimingCompOff(true);

    const data = await api(`/attendance/compoffs/${compOffForm.compoff_id}/claim`, {
      method: 'POST',
      body: JSON.stringify({
        claim_date: compOffForm.claim_date,
        reason: compOffForm.reason,
      }),
    });

    alerts.success(data.message || 'Comp-off claim submitted', 'Comp-Off Claim Submitted');
    setCompOffForm({ ...EMPTY_COMPOFF_FORM });
    await loadMyCompOffs();
  } catch (error) {
    alerts.error(error.message || 'Unable to claim comp-off', 'Comp-Off Claim Failed');
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

  const pendingHolidayWorkRequestCount = holidayWorkRequests.filter(
    (row) => row.raw_status === 'pending',
  ).length;

  const holidayWorkRequestRows = holidayWorkRequests.map((row) => ({
    ...row,
    proof: row.proof_photo ? (
      <a href={row.proof_photo} target="_blank" rel="noreferrer">
        View photo
      </a>
    ) : (
      '—'
    ),
    map: row.map_url ? (
      <a href={row.map_url} target="_blank" rel="noreferrer">
        Open map
      </a>
    ) : (
      '—'
    ),
    action:
      row.raw_status === 'pending' ? (
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => decideHolidayWorkRequest(row, 'approved')}
            disabled={decidingHolidayWorkId === row._id}
          >
            {decidingHolidayWorkId === row._id ? 'Approving...' : 'Approve'}
          </button>

          <button
            type="button"
            className="danger"
            onClick={() => decideHolidayWorkRequest(row, 'rejected')}
            disabled={decidingHolidayWorkId === row._id}
          >
            {decidingHolidayWorkId === row._id ? 'Rejecting...' : 'Reject'}
          </button>
        </div>
      ) : (
        statusLabel(row.raw_status)
      ),
  }));

  const myHolidayWorkRequestRows = myHolidayWorkRequests.map((row) => ({
    ...row,
    proof: row.proof_photo ? (
      <a href={row.proof_photo} target="_blank" rel="noreferrer">
        View photo
      </a>
    ) : (
      '—'
    ),
    map: row.map_url ? (
      <a href={row.map_url} target="_blank" rel="noreferrer">
        Open map
      </a>
    ) : (
      '—'
    ),
  }));

const teamFieldRows = teamFieldAttendance.map((row) => ({
  ...row,
  field_photo_link: <FieldPhotoPreview row={row} />,
  check_in_map: row.check_in_map_url ? (
      <a href={row.check_in_map_url} target="_blank" rel="noreferrer">
        Open map
      </a>
    ) : (
      '—'
    ),
  }));

  const availableCompOffs = myCompOffs.filter(
    (item) => item.raw_status === 'available',
  );

return (
  <div className="page-grid">
    <style>{`
      .field-photo-preview {
        display: grid;
        gap: 8px;
        max-width: 220px;
        margin-top: 8px;
      }

      .field-photo-preview img {
        width: 180px;
        height: 120px;
        object-fit: cover;
        border-radius: 14px;
        border: 1px solid #dbe4f0;
        background: #f8fafc;
        display: block;
      }

        .field-photo-open-button {
          border: 0;
          background: transparent;
          color: #4f46e5;
          font-weight: 900;
          font-size: 13px;
          text-decoration: underline;
          cursor: pointer;
          padding: 0;
          text-align: left;
        }

      @media (max-width: 640px) {
        .field-photo-preview img {
          width: 100%;
          max-width: 220px;
          height: 130px;
        }
      }
    `}</style>
      <section className="hero compact">
        <div>
          <span className="kicker">
            {isHrAdminAttendanceView ? 'HR Attendance Control' : 'Office + WFH + Field'}
          </span>
          <h1>Attendance Management</h1>
          <p>
            {isHrAdminAttendanceView
              ? 'Monitor daily attendance records, field locations, employee photos, holiday work approvals, and comp-off records from one HR control panel.'
              : 'Mark Office, WFH, or Field attendance directly. Field attendance captures visit place, photo, and location. Holiday work requires approval before attendance and creates claimable comp-off after checkout.'}
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


      {showEmployeeSelfAttendancePanel && (
        <section className="two-col">
          <div className="panel">
            <div className="toolbar">
              <div>
                <h3>My Holiday Work Requests</h3>
                <p>
                  Holiday attendance is allowed only after approval. After approved
                  holiday attendance and checkout, one comp-off credit will be created.
                </p>
              </div>
            </div>

            <Table rows={myHolidayWorkRequestRows} maxColumns={12} />
          </div>

          <div className="panel">
            <h3>Holiday Work Rule</h3>
            <p>
              For Sunday, second Saturday, fourth Saturday, and HR-created holidays,
              you must raise a holiday work request first. Approval will go to your
              Team Leader, then Reporting Officer, or HR fallback.
            </p>
            <p>
              Comp-off can be claimed from the next working day and only within
              7 working days. After that, the credit expires automatically.
            </p>
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
          <p>
            Comp-off is available only after approved holiday work attendance and
            checkout. It can be claimed from the next working day within 7 working days.
          </p>

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
              <h3>Holiday Work Approval Requests</h3>
              <p>
                Approve holiday work before the employee can mark attendance on a
                holiday. Access follows Team Leader, Reporting Officer, and HR scope.
              </p>
            </div>

            <span className="employee-role-pill">
              Pending Requests: {pendingHolidayWorkRequestCount}
            </span>
          </div>

              <form
                className="attendance-filter-card"
                onSubmit={searchHolidayWorkRequests}
              >
            <div className="attendance-filter-grid">
              <label>
                Status
                <select
                  value={holidayWorkFilters.status}
                  onChange={(e) =>
                    setHolidayWorkFilters({
                      ...holidayWorkFilters,
                      status: e.target.value,
                    })
                  }
                >
                  <option value="">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>

              <label>
                Date
                <input
                  type="date"
                  value={holidayWorkFilters.date}
                  onChange={(e) =>
                    setHolidayWorkFilters({
                      ...holidayWorkFilters,
                      date: e.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="attendance-filter-actions">
              <button type="submit" className="primary">
                Search Holiday Requests
              </button>

                  <button
                    type="button"
                    className="secondary"
                    onClick={clearHolidayWorkFilters}
                  >
                    Clear
                  </button>
            </div>
          </form>

          <Table rows={holidayWorkRequestRows} maxColumns={14} />
        </section>
      )}

      {canViewReport && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>Team Field Attendance</h3>
              <p>
                Team Leaders can see their mapped team members. Reporting Officers
                can see their mapped employees. HR/Admin can see all field attendance.
              </p>
            </div>

            <span className="employee-role-pill">
              Field Records: {teamFieldAttendance.length}
            </span>
          </div>

                <form
                  className="attendance-filter-card"
                  onSubmit={searchTeamFieldAttendance}
                >
            <div className="attendance-filter-grid">
              <label>
                Date From
                <input
                  type="date"
                  value={teamFieldFilters.start}
                  onChange={(e) =>
                    setTeamFieldFilters({
                      ...teamFieldFilters,
                      start: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Date To
                <input
                  type="date"
                  value={teamFieldFilters.end}
                  onChange={(e) =>
                    setTeamFieldFilters({
                      ...teamFieldFilters,
                      end: e.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="attendance-filter-actions">
              <button type="submit" className="primary" disabled={loadingTeamField}>
                {loadingTeamField ? 'Loading...' : 'Search Field Attendance'}
              </button>

                    <button
                      type="button"
                      className="secondary"
                      disabled={loadingTeamField}
                      onClick={clearTeamFieldFilters}
                    >
                      Clear
                    </button>
            </div>
          </form>

          <Table rows={teamFieldRows} maxColumns={14} />
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