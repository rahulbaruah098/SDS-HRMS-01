import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Filter,
  Image as ImageIcon,
  Laptop,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { api } from '../api/client';

const PAGE_SIZE = 50;

const MODE_OPTIONS = [
  { value: '', label: 'All attendance modes' },
  { value: 'office', label: 'Office' },
  { value: 'wfh', label: 'Work From Home' },
  { value: 'field', label: 'Field' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All attendance statuses' },
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late Entry' },
  { value: 'early_checkout', label: 'Early Checkout' },
  { value: 'holiday_work', label: 'Holiday Work' },
];

function normaliseText(value = '') {
  return String(value ?? '').trim();
}

function titleCase(value = '') {
  return normaliseText(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function buildQuery(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    const text = normaliseText(value);

    if (text) {
      searchParams.set(key, text);
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value.$date) {
    return parseDate(value.$date);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseClockValue(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value.$date) {
    return parseClockValue(value.$date);
  }

  const text = normaliseText(value);
  const timeMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (timeMatch) {
    const date = new Date();
    date.setHours(
      Number(timeMatch[1]),
      Number(timeMatch[2]),
      Number(timeMatch[3] || 0),
      0,
    );
    return date;
  }

  return parseDate(value);
}

function formatAttendanceDate(value) {
  if (!value) {
    return 'Date unavailable';
  }

  const directDate = /^\d{4}-\d{2}-\d{2}$/.test(normaliseText(value))
    ? new Date(`${value}T00:00:00`)
    : parseDate(value);

  if (!directDate || Number.isNaN(directDate.getTime())) {
    return normaliseText(value) || 'Date unavailable';
  }

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    weekday: 'short',
  }).format(directDate);
}

function formatTime(value) {
  const date = parseClockValue(value);

  if (!date) {
    return 'Not recorded';
  }

  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function minutesBetween(checkIn, checkOut) {
  const start = parseClockValue(checkIn);
  const end = parseClockValue(checkOut);

  if (!start || !end) {
    return null;
  }

  let difference = end.getTime() - start.getTime();

  if (difference < 0) {
    difference += 24 * 60 * 60 * 1000;
  }

  return Math.max(0, Math.round(difference / 60000));
}

function formatDuration(checkIn, checkOut) {
  const minutes = minutesBetween(checkIn, checkOut);

  if (minutes === null) {
    return checkIn && !checkOut ? 'Currently checked in' : 'Not available';
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!hours) {
    return `${remainingMinutes} min`;
  }

  return `${hours} hr${hours === 1 ? '' : 's'} ${remainingMinutes} min`;
}

function employeeName(row = {}) {
  return (
    normaliseText(row.employee_name) ||
    normaliseText(row.name) ||
    'Employee name unavailable'
  );
}

function employeeCode(row = {}) {
  return (
    normaliseText(row.employee_code) ||
    normaliseText(row.emp_code) ||
    ''
  );
}

function attendanceMode(row = {}) {
  return normaliseText(row.mode).toLowerCase() || 'office';
}

function modeLabel(value = '') {
  const mode = normaliseText(value).toLowerCase();

  if (mode === 'wfh') {
    return 'Work From Home';
  }

  if (mode === 'field') {
    return 'Field';
  }

  return 'Office';
}

function statusLabel(value = '') {
  const status = normaliseText(value).toLowerCase();

  if (status === 'late') {
    return 'Late Entry';
  }

  if (status === 'early_checkout') {
    return 'Early Checkout';
  }

  if (status === 'holiday_work') {
    return 'Holiday Work';
  }

  if (status === 'present') {
    return 'Present';
  }

  return titleCase(status) || 'Recorded';
}

function statusTone(row = {}) {
  const status = normaliseText(row.status).toLowerCase();

  if (status === 'late' || row.is_late) {
    return 'warning';
  }

  if (status === 'early_checkout' || row.is_early_checkout) {
    return 'danger';
  }

  if (status === 'holiday_work' || row.is_holiday_work) {
    return 'holiday';
  }

  return 'success';
}

function modeTone(value = '') {
  const mode = normaliseText(value).toLowerCase();

  if (mode === 'field') {
    return 'field';
  }

  if (mode === 'wfh') {
    return 'wfh';
  }

  return 'office';
}

function locationObject(row = {}, key = 'check_in_location') {
  const value = row[key];

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  return {};
}

function firstText(...values) {
  for (const value of values) {
    const text = normaliseText(value);

    if (text) {
      return text;
    }
  }

  return '';
}

function locationSummary(row = {}, key = 'check_in_location') {
  const location = locationObject(row, key);

  return firstText(
    location.address,
    location.location_address,
    key === 'check_in_location' ? row.field_location : '',
  );
}

function locationCoordinates(row = {}, key = 'check_in_location') {
  const location = locationObject(row, key);

  const latitude =
    location.latitude ??
    location.lat ??
    (key === 'check_in_location' ? row.latitude ?? row.lat : null);

  const longitude =
    location.longitude ??
    location.lng ??
    (key === 'check_in_location' ? row.longitude ?? row.lng : null);

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { latitude: lat, longitude: lng };
}

function mapUrl(row = {}, key = 'check_in_location') {
  const coordinates = locationCoordinates(row, key);

  if (!coordinates) {
    return '';
  }

  return `https://www.google.com/maps?q=${coordinates.latitude},${coordinates.longitude}`;
}

function fieldPhotoUrl(row = {}) {
  return firstText(
    row.field_photo_url,
    row.field_photo,
    row.proof_photo,
    row.photo_url,
  );
}

function isInternalIdKey(key = '') {
  const normalised = normaliseText(key).toLowerCase();

  return (
    normalised === 'id' ||
    normalised === '_id' ||
    normalised === 'tenant_id' ||
    normalised === 'employee_id' ||
    normalised.endsWith('_id') ||
    normalised.endsWith('ids')
  );
}

function sanitiseObject(value) {
  if (Array.isArray(value)) {
    return value.map(sanitiseObject);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce((result, [key, item]) => {
    if (!isInternalIdKey(key)) {
      result[key] = sanitiseObject(item);
    }

    return result;
  }, {});
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    return value.length ? value.map(displayValue).join(', ') : '—';
  }

  if (typeof value === 'object') {
    if (value.$date) {
      return `${formatAttendanceDate(value.$date)} • ${formatTime(value.$date)}`;
    }

    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function AttendanceDetailsModal({ row, onClose }) {
  if (!row) {
    return null;
  }

  const safeRow = sanitiseObject(row);
  const checkInMapUrl = mapUrl(row, 'check_in_location');
  const checkOutMapUrl = mapUrl(row, 'check_out_location');
  const photoUrl = fieldPhotoUrl(row);

  const excludedKeys = new Set([
    'employee_name',
    'name',
    'employee_code',
    'emp_code',
    'department',
    'designation',
    'organisation',
    'organization',
    'organisation_name',
    'organization_name',
    'organisation_code',
    'organization_code',
    'state',
    'date',
    'mode',
    'status',
    'check_in',
    'check_out',
    'created_at',
    'updated_at',
    'check_in_location',
    'check_out_location',
    'field_location',
    'field_photo',
    'field_photo_url',
    'proof_photo',
    'photo_url',
    'timeline',
    'is_deleted',
  ]);

  const extraEntries = Object.entries(safeRow).filter(
    ([key, value]) =>
      !excludedKeys.has(key) &&
      value !== '' &&
      value !== null &&
      value !== undefined,
  );

  return (
    <div
      className="attendance-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="attendance-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendance-details-title"
      >
        <header className="attendance-modal-header">
          <div>
            <span className="attendance-eyebrow">
              <ShieldCheck size={16} />
              Attendance record
            </span>

            <h2 id="attendance-details-title">{employeeName(row)}</h2>

            <p>
              {formatAttendanceDate(row.date)} • {modeLabel(row.mode)}
            </p>
          </div>

          <button
            type="button"
            className="attendance-icon-button"
            onClick={onClose}
            aria-label="Close attendance details"
          >
            <X size={20} />
          </button>
        </header>

        <div className="attendance-detail-grid">
          <article className="attendance-detail-card">
            <UserRound size={19} />

            <div>
              <span>Employee</span>
              <strong>{employeeName(row)}</strong>
              <small>
                {employeeCode(row)
                  ? `${employeeCode(row)} • ${normaliseText(row.designation) || 'Designation not recorded'}`
                  : normaliseText(row.designation) || 'Designation not recorded'}
              </small>
            </div>
          </article>

          <article className="attendance-detail-card">
            <BriefcaseBusiness size={19} />

            <div>
              <span>Work assignment</span>
              <strong>{normaliseText(row.department) || 'Department not recorded'}</strong>
              <small>
                {firstText(
                  row.organisation_name,
                  row.organization_name,
                  row.organisation,
                  row.organization,
                  row.state,
                  'Organisation not recorded',
                )}
              </small>
            </div>
          </article>

          <article className="attendance-detail-card">
            <Clock3 size={19} />

            <div>
              <span>Attendance timing</span>
              <strong>
                {formatTime(row.check_in)} – {formatTime(row.check_out)}
              </strong>
              <small>{formatDuration(row.check_in, row.check_out)}</small>
            </div>
          </article>

          <article className="attendance-detail-card">
            <BadgeCheck size={19} />

            <div>
              <span>Attendance result</span>
              <strong>{statusLabel(row.status)}</strong>
              <small>
                {row.verified_by_ro
                  ? 'Verified by Reporting Officer'
                  : 'Verification not recorded'}
              </small>
            </div>
          </article>
        </div>

        <section className="attendance-modal-section">
          <h3>Reasons and remarks</h3>

          <div className="attendance-reason-grid">
            <article>
              <span>Late-entry reason</span>
              <strong>{normaliseText(row.late_reason) || 'Not applicable'}</strong>
            </article>

            <article>
              <span>Early-checkout reason</span>
              <strong>
                {normaliseText(row.early_checkout_reason) || 'Not applicable'}
              </strong>
            </article>

            <article>
              <span>Holiday work</span>
              <strong>
                {row.is_holiday_work
                  ? firstText(row.holiday_title, 'Approved holiday attendance')
                  : 'Not applicable'}
              </strong>
            </article>
          </div>
        </section>

        <section className="attendance-modal-section">
          <h3>Attendance locations</h3>

          <div className="attendance-location-grid">
            <article>
              <div className="attendance-location-heading">
                <Navigation size={18} />
                <strong>Check-in location</strong>
              </div>

              <p>
                {locationSummary(row, 'check_in_location') ||
                  'No readable address was recorded.'}
              </p>

              {checkInMapUrl ? (
                <a href={checkInMapUrl} target="_blank" rel="noreferrer">
                  <MapPin size={15} />
                  Open check-in location
                </a>
              ) : null}
            </article>

            <article>
              <div className="attendance-location-heading">
                <Navigation size={18} />
                <strong>Check-out location</strong>
              </div>

              <p>
                {locationSummary(row, 'check_out_location') ||
                  'No readable address was recorded.'}
              </p>

              {checkOutMapUrl ? (
                <a href={checkOutMapUrl} target="_blank" rel="noreferrer">
                  <MapPin size={15} />
                  Open check-out location
                </a>
              ) : null}
            </article>
          </div>
        </section>

        {photoUrl ? (
          <section className="attendance-modal-section">
            <h3>Field attendance proof</h3>

            <a
              className="attendance-photo-link"
              href={photoUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ImageIcon size={18} />
              View uploaded field photo
            </a>
          </section>
        ) : null}

        {extraEntries.length > 0 ? (
          <section className="attendance-modal-section">
            <h3>Additional record details</h3>

            <dl className="attendance-metadata-list">
              {extraEntries.map(([key, value]) => (
                <div key={key}>
                  <dt>{titleCase(key)}</dt>
                  <dd>{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <footer className="attendance-modal-footer">
          <p>
            Internal database IDs and system reference IDs are intentionally hidden.
          </p>

          <button
            type="button"
            className="attendance-secondary-button"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function AttendanceLogs() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [departmentInput, setDepartmentInput] = useState('');
  const [appliedDepartment, setAppliedDepartment] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [selectedRow, setSelectedRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadAttendanceLogs = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError('');

      try {
        const data = await api(
          `/attendance_logs${buildQuery({
            page,
            limit: PAGE_SIZE,
            q: appliedSearch,
            department: appliedDepartment,
            mode: modeFilter,
            status: statusFilter,
            date_from: dateFrom,
            date_to: dateTo,
            sort_by: 'date',
            sort_dir: 'desc',
          })}`,
        );

        setRows(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total || 0));
      } catch (loadError) {
        setRows([]);
        setTotal(0);
        setError(
          loadError?.message ||
            'Attendance logs could not be loaded. Please check your access and try again.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      appliedDepartment,
      appliedSearch,
      dateFrom,
      dateTo,
      modeFilter,
      page,
      statusFilter,
    ],
  );

  useEffect(() => {
    loadAttendanceLogs();
  }, [loadAttendanceLogs]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setSelectedRow(null);
      }
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const presentCount = useMemo(
    () =>
      rows.filter((row) => {
        const status = normaliseText(row.status).toLowerCase();
        return status === 'present' && !row.is_late && !row.is_early_checkout;
      }).length,
    [rows],
  );

  const lateCount = useMemo(
    () =>
      rows.filter(
        (row) =>
          normaliseText(row.status).toLowerCase() === 'late' || row.is_late,
      ).length,
    [rows],
  );

  const mobileCount = useMemo(
    () =>
      rows.filter((row) => {
        const mode = attendanceMode(row);
        return mode === 'wfh' || mode === 'field';
      }).length,
    [rows],
  );

  const uniqueEmployees = useMemo(
    () =>
      new Set(
        rows
          .map((row) => employeeCode(row) || employeeName(row))
          .filter(Boolean),
      ).size,
    [rows],
  );

  function applyFilters(event) {
    event?.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput.trim());
    setAppliedDepartment(departmentInput.trim());
  }

  function clearFilters() {
    setSearchInput('');
    setAppliedSearch('');
    setDepartmentInput('');
    setAppliedDepartment('');
    setModeFilter('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  const hasFilters = Boolean(
    appliedSearch ||
      appliedDepartment ||
      modeFilter ||
      statusFilter ||
      dateFrom ||
      dateTo,
  );

  return (
    <section className="attendance-log-page">
      <style>{`
        .attendance-log-page {
          --attendance-ink: #10182d;
          --attendance-muted: #65748f;
          --attendance-border: rgba(137, 153, 190, .28);
          --attendance-primary: #4f46ef;
          --attendance-primary-soft: rgba(79, 70, 239, .09);
          position: relative;
          display: grid;
          gap: 22px;
          width: 100%;
          padding-bottom: 34px;
          color: var(--attendance-ink);
        }

        .attendance-hero,
        .attendance-panel {
          border: 1px solid var(--attendance-border);
          border-radius: 30px;
          background: rgba(255, 255, 255, .9);
          box-shadow: 0 20px 55px rgba(39, 53, 91, .09);
          backdrop-filter: blur(16px);
        }

        .attendance-hero {
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 28px;
          padding: 30px 34px;
          background:
            radial-gradient(circle at 6% 12%, rgba(96, 79, 255, .17), transparent 32%),
            radial-gradient(circle at 94% 10%, rgba(65, 216, 181, .17), transparent 30%),
            linear-gradient(120deg, rgba(255, 255, 255, .97), rgba(247, 250, 255, .93));
        }

        .attendance-hero::after {
          content: '';
          position: absolute;
          right: -65px;
          bottom: -95px;
          width: 250px;
          height: 250px;
          border-radius: 50%;
          border: 36px solid rgba(79, 70, 239, .05);
          pointer-events: none;
        }

        .attendance-hero-copy {
          position: relative;
          z-index: 1;
          max-width: 860px;
        }

        .attendance-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #4f46ef;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .1em;
          text-transform: uppercase;
        }

        .attendance-hero h1 {
          margin: 10px 0 8px;
          font-size: clamp(30px, 4vw, 48px);
          line-height: 1.05;
          letter-spacing: -.035em;
        }

        .attendance-hero p {
          max-width: 790px;
          margin: 0;
          color: var(--attendance-muted);
          font-size: 16px;
          line-height: 1.7;
        }

        .attendance-refresh-button,
        .attendance-primary-button,
        .attendance-secondary-button,
        .attendance-page-button,
        .attendance-view-button,
        .attendance-icon-button {
          border: 0;
          font: inherit;
          cursor: pointer;
          transition:
            transform .18s ease,
            box-shadow .18s ease,
            background .18s ease,
            border-color .18s ease;
        }

        .attendance-refresh-button {
          position: relative;
          z-index: 1;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-height: 48px;
          padding: 0 19px;
          border: 1px solid rgba(79, 70, 239, .18);
          border-radius: 16px;
          background: rgba(255, 255, 255, .84);
          color: #3432a9;
          font-weight: 850;
          box-shadow: 0 12px 30px rgba(56, 52, 171, .1);
        }

        .attendance-refresh-button:hover,
        .attendance-primary-button:hover,
        .attendance-secondary-button:hover,
        .attendance-view-button:hover,
        .attendance-page-button:not(:disabled):hover,
        .attendance-icon-button:hover {
          transform: translateY(-2px);
        }

        .attendance-refresh-button svg.is-spinning {
          animation: attendance-spin .8s linear infinite;
        }

        @keyframes attendance-spin {
          to { transform: rotate(360deg); }
        }

        .attendance-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 15px;
        }

        .attendance-kpi {
          display: flex;
          align-items: center;
          gap: 14px;
          min-height: 112px;
          padding: 21px;
          border: 1px solid var(--attendance-border);
          border-radius: 23px;
          background: rgba(255, 255, 255, .92);
          box-shadow: 0 14px 36px rgba(39, 53, 91, .07);
        }

        .attendance-kpi-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 46px;
          height: 46px;
          flex: 0 0 46px;
          border-radius: 15px;
          background: var(--attendance-primary-soft);
          color: var(--attendance-primary);
        }

        .attendance-kpi span {
          display: block;
          color: var(--attendance-muted);
          font-size: 12px;
          font-weight: 850;
          letter-spacing: .045em;
          text-transform: uppercase;
        }

        .attendance-kpi strong {
          display: block;
          margin-top: 5px;
          font-size: 23px;
          line-height: 1.15;
        }

        .attendance-kpi small {
          display: block;
          margin-top: 5px;
          color: #8590a8;
          line-height: 1.35;
        }

        .attendance-panel {
          overflow: hidden;
        }

        .attendance-filter-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 24px 26px 18px;
        }

        .attendance-filter-heading {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .attendance-filter-heading h2 {
          margin: 0;
          font-size: 21px;
        }

        .attendance-filter-heading p {
          margin: 3px 0 0;
          color: var(--attendance-muted);
          font-size: 13px;
        }

        .attendance-filter-form {
          display: grid;
          grid-template-columns:
            minmax(250px, 1.7fr)
            minmax(180px, .9fr)
            minmax(165px, .8fr)
            minmax(175px, .85fr);
          gap: 12px;
          padding: 0 26px 15px;
        }

        .attendance-date-actions {
          display: grid;
          grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr) auto auto;
          gap: 12px;
          padding: 0 26px 24px;
        }

        .attendance-field {
          position: relative;
          display: grid;
          gap: 7px;
        }

        .attendance-field label {
          color: #46536b;
          font-size: 12px;
          font-weight: 850;
        }

        .attendance-input-wrap {
          position: relative;
        }

        .attendance-input-wrap > svg {
          position: absolute;
          top: 50%;
          left: 14px;
          transform: translateY(-50%);
          color: #7c86a0;
          pointer-events: none;
        }

        .attendance-field input,
        .attendance-field select {
          width: 100%;
          min-height: 46px;
          border: 1px solid rgba(137, 153, 190, .34);
          border-radius: 14px;
          outline: none;
          background: rgba(248, 250, 255, .88);
          color: var(--attendance-ink);
          font: inherit;
          padding: 0 14px;
          transition:
            border-color .18s ease,
            box-shadow .18s ease,
            background .18s ease;
        }

        .attendance-input-wrap input {
          padding-left: 43px;
        }

        .attendance-field input:focus,
        .attendance-field select:focus {
          border-color: rgba(79, 70, 239, .58);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(79, 70, 239, .09);
        }

        .attendance-primary-button,
        .attendance-secondary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 46px;
          padding: 0 18px;
          border-radius: 14px;
          font-weight: 850;
        }

        .attendance-primary-button {
          align-self: end;
          background: linear-gradient(135deg, #5147f4, #6d5dfc);
          color: #fff;
          box-shadow: 0 12px 25px rgba(79, 70, 239, .22);
        }

        .attendance-secondary-button {
          align-self: end;
          border: 1px solid rgba(137, 153, 190, .32);
          background: #fff;
          color: #344054;
        }

        .attendance-error,
        .attendance-empty-state {
          margin: 0 26px 24px;
          border-radius: 18px;
          text-align: center;
        }

        .attendance-error {
          padding: 16px 18px;
          border: 1px solid rgba(220, 38, 38, .18);
          background: rgba(254, 226, 226, .65);
          color: #a71d2a;
          font-weight: 750;
        }

        .attendance-table-wrap {
          width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          border-top: 1px solid rgba(137, 153, 190, .2);
          scrollbar-width: thin;
          scrollbar-color: rgba(79, 70, 239, .35) transparent;
          -webkit-overflow-scrolling: touch;
        }

        .attendance-table-wrap::-webkit-scrollbar {
          height: 8px;
        }

        .attendance-table-wrap::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(79, 70, 239, .3);
        }

        .attendance-table {
          width: 100%;
          min-width: 1320px;
          border-collapse: collapse;
          table-layout: auto;
        }

        .attendance-table th {
          padding: 14px 17px;
          background: rgba(246, 248, 253, .97);
          color: #526078;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .065em;
          text-align: left;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .attendance-table td {
          padding: 17px;
          border-top: 1px solid rgba(137, 153, 190, .15);
          vertical-align: middle;
        }

        .attendance-table tbody tr {
          transition: background .18s ease;
        }

        .attendance-table tbody tr:hover {
          background: rgba(79, 70, 239, .035);
        }

        .attendance-employee {
          display: grid;
          gap: 4px;
          min-width: 195px;
        }

        .attendance-employee strong {
          font-size: 14px;
        }

        .attendance-employee small,
        .attendance-time-block small,
        .attendance-date-cell small {
          color: var(--attendance-muted);
        }

        .attendance-table th:nth-child(3),
        .attendance-table td:nth-child(3) {
          min-width: 145px;
          white-space: nowrap;
        }

        .attendance-table th:nth-child(4),
        .attendance-table td:nth-child(4) {
          min-width: 140px;
          white-space: nowrap;
        }

        .attendance-status-badge,
        .attendance-mode-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-wrap: nowrap;
          flex-shrink: 0;
          width: max-content;
          min-width: max-content;
          max-width: none;
          min-height: 34px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 850;
          line-height: 1;
          white-space: nowrap;
          word-break: keep-all;
          overflow-wrap: normal;
          hyphens: none;
        }

        .attendance-status-badge svg,
        .attendance-mode-badge svg {
          flex: 0 0 auto;
        }

        .attendance-status-badge {
          padding: 8px 12px;
        }

        .attendance-status-badge.success {
          background: rgba(16, 185, 129, .11);
          color: #08775c;
        }

        .attendance-status-badge.warning {
          background: rgba(245, 158, 11, .13);
          color: #9a5a00;
        }

        .attendance-status-badge.danger {
          background: rgba(239, 68, 68, .1);
          color: #b4232c;
        }

        .attendance-status-badge.holiday {
          background: rgba(139, 92, 246, .11);
          color: #6d36bd;
        }

        .attendance-mode-badge {
          gap: 7px;
          padding: 7px 11px;
        }

        .attendance-mode-badge.office {
          background: rgba(59, 130, 246, .09);
          color: #245faa;
        }

        .attendance-mode-badge.wfh {
          background: rgba(99, 102, 241, .1);
          color: #4846b8;
        }

        .attendance-mode-badge.field {
          background: rgba(20, 184, 166, .11);
          color: #087d72;
        }

        .attendance-time-block,
        .attendance-date-cell {
          display: grid;
          gap: 4px;
          min-width: 150px;
        }

        .attendance-location-cell {
          max-width: 230px;
          color: #46536b;
          line-height: 1.45;
        }

        .attendance-location-cell span {
          display: -webkit-box;
          overflow: hidden;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }

        .attendance-view-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 38px;
          padding: 0 13px;
          border: 1px solid rgba(79, 70, 239, .22);
          border-radius: 12px;
          background: rgba(79, 70, 239, .06);
          color: #423ac4;
          font-weight: 850;
        }

        .attendance-loading {
          display: grid;
          gap: 11px;
          padding: 28px 26px;
        }

        .attendance-loading span {
          display: block;
          height: 58px;
          border-radius: 15px;
          background:
            linear-gradient(
              90deg,
              rgba(231, 235, 245, .7),
              rgba(250, 251, 255, .95),
              rgba(231, 235, 245, .7)
            );
          background-size: 220% 100%;
          animation: attendance-skeleton 1.25s linear infinite;
        }

        @keyframes attendance-skeleton {
          to { background-position: -220% 0; }
        }

        .attendance-empty-state {
          display: grid;
          justify-items: center;
          gap: 10px;
          padding: 48px 20px;
          color: var(--attendance-muted);
        }

        .attendance-empty-state svg {
          color: #7167de;
        }

        .attendance-empty-state h3 {
          margin: 0;
          color: var(--attendance-ink);
        }

        .attendance-empty-state p {
          max-width: 540px;
          margin: 0;
          line-height: 1.6;
        }

        .attendance-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 24px;
          border-top: 1px solid rgba(137, 153, 190, .18);
        }

        .attendance-pagination p {
          margin: 0;
          color: var(--attendance-muted);
          font-size: 13px;
        }

        .attendance-pagination-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .attendance-page-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 40px;
          height: 40px;
          border: 1px solid rgba(137, 153, 190, .3);
          border-radius: 12px;
          background: #fff;
          color: #3d4960;
        }

        .attendance-page-button:disabled {
          cursor: not-allowed;
          opacity: .45;
        }

        .attendance-page-indicator {
          min-width: 88px;
          text-align: center;
          color: #3d4960;
          font-size: 13px;
          font-weight: 800;
        }

        .attendance-mobile-list {
          display: none;
          gap: 12px;
          padding: 0 16px 18px;
          border-top: 1px solid rgba(137, 153, 190, .18);
        }

        .attendance-mobile-card {
          display: grid;
          gap: 13px;
          padding: 17px;
          border: 1px solid rgba(137, 153, 190, .22);
          border-radius: 18px;
          background: rgba(255, 255, 255, .97);
          box-shadow: 0 10px 25px rgba(39, 53, 91, .06);
        }

        .attendance-mobile-card:first-child {
          margin-top: 16px;
        }

        .attendance-mobile-top,
        .attendance-mobile-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .attendance-mobile-card h3 {
          margin: 0;
          font-size: 16px;
        }

        .attendance-mobile-card p {
          margin: 3px 0 0;
          color: var(--attendance-muted);
          font-size: 13px;
          overflow-wrap: anywhere;
        }

        .attendance-mobile-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .attendance-mobile-meta article {
          padding: 11px;
          border-radius: 13px;
          background: rgba(247, 248, 253, .9);
        }

        .attendance-mobile-meta span {
          display: block;
          color: var(--attendance-muted);
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
        }

        .attendance-mobile-meta strong {
          display: block;
          margin-top: 5px;
          font-size: 13px;
        }

        .attendance-modal-backdrop {
          position: fixed;
          z-index: 2500;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 22px;
          background: rgba(14, 22, 42, .56);
          backdrop-filter: blur(8px);
        }

        .attendance-modal {
          width: min(860px, 100%);
          max-height: min(90vh, 860px);
          overflow-y: auto;
          border: 1px solid rgba(255, 255, 255, .45);
          border-radius: 28px;
          background: #fff;
          box-shadow: 0 34px 90px rgba(9, 16, 35, .3);
          animation: attendance-modal-enter .2s ease-out;
        }

        @keyframes attendance-modal-enter {
          from {
            opacity: 0;
            transform: translateY(12px) scale(.985);
          }

          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .attendance-modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 27px 28px 22px;
          border-bottom: 1px solid rgba(137, 153, 190, .18);
          background:
            radial-gradient(circle at 90% 0%, rgba(69, 211, 179, .15), transparent 35%),
            radial-gradient(circle at 5% 0%, rgba(99, 88, 245, .14), transparent 38%),
            #fff;
        }

        .attendance-modal-header h2 {
          margin: 8px 0 5px;
          font-size: 27px;
        }

        .attendance-modal-header p {
          margin: 0;
          color: var(--attendance-muted);
        }

        .attendance-icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          border-radius: 13px;
          background: rgba(255, 255, 255, .82);
          color: #36435a;
          box-shadow: 0 8px 24px rgba(40, 52, 84, .1);
        }

        .attendance-detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
          padding: 22px 28px 4px;
        }

        .attendance-detail-card {
          display: flex;
          gap: 12px;
          padding: 17px;
          border: 1px solid rgba(137, 153, 190, .2);
          border-radius: 17px;
          background: rgba(249, 250, 254, .78);
        }

        .attendance-detail-card > svg {
          flex: 0 0 auto;
          color: #574ee1;
        }

        .attendance-detail-card div {
          min-width: 0;
        }

        .attendance-detail-card span,
        .attendance-detail-card small {
          display: block;
          color: var(--attendance-muted);
          font-size: 12px;
        }

        .attendance-detail-card strong {
          display: block;
          margin: 4px 0;
          overflow-wrap: anywhere;
        }

        .attendance-modal-section {
          padding: 20px 28px 0;
        }

        .attendance-modal-section h3 {
          margin: 0 0 13px;
          font-size: 16px;
        }

        .attendance-reason-grid,
        .attendance-location-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .attendance-reason-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .attendance-reason-grid article,
        .attendance-location-grid article {
          padding: 16px;
          border: 1px solid rgba(137, 153, 190, .2);
          border-radius: 16px;
          background: rgba(249, 250, 254, .78);
        }

        .attendance-reason-grid span {
          display: block;
          color: var(--attendance-muted);
          font-size: 12px;
        }

        .attendance-reason-grid strong {
          display: block;
          margin-top: 7px;
          line-height: 1.5;
        }

        .attendance-location-heading {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #3f3aa6;
        }

        .attendance-location-grid p {
          min-height: 42px;
          margin: 11px 0;
          color: var(--attendance-muted);
          line-height: 1.5;
        }

        .attendance-location-grid a,
        .attendance-photo-link {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #423ac4;
          font-weight: 850;
          text-decoration: none;
        }

        .attendance-photo-link {
          padding: 13px 15px;
          border: 1px solid rgba(79, 70, 239, .2);
          border-radius: 14px;
          background: rgba(79, 70, 239, .055);
        }

        .attendance-metadata-list {
          display: grid;
          gap: 1px;
          overflow: hidden;
          margin: 0;
          border: 1px solid rgba(137, 153, 190, .2);
          border-radius: 16px;
          background: rgba(137, 153, 190, .18);
        }

        .attendance-metadata-list > div {
          display: grid;
          grid-template-columns: minmax(170px, .55fr) minmax(0, 1fr);
          gap: 18px;
          padding: 14px 16px;
          background: #fff;
        }

        .attendance-metadata-list dt {
          color: #4e5a70;
          font-weight: 850;
        }

        .attendance-metadata-list dd {
          margin: 0;
          color: #27344c;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .attendance-modal-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 22px 28px 27px;
        }

        .attendance-modal-footer p {
          margin: 0;
          color: var(--attendance-muted);
          font-size: 12px;
        }

        @media (max-width: 1180px) {
          .attendance-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .attendance-filter-form,
          .attendance-date-actions {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 980px) {
          .attendance-table-wrap {
            display: none;
          }

          .attendance-mobile-list {
            display: grid;
          }

          .attendance-mobile-top {
            align-items: flex-start;
          }

          .attendance-mobile-top > small {
            flex: 0 0 auto;
            text-align: right;
          }

          .attendance-mobile-bottom {
            align-items: flex-start;
          }

          .attendance-mobile-bottom .attendance-location-cell {
            min-width: 0;
            flex: 1 1 auto;
          }

          .attendance-mobile-bottom .attendance-view-button {
            flex: 0 0 auto;
          }
        }

        @media (max-width: 720px) {
          .attendance-log-page {
            gap: 16px;
          }

          .attendance-hero {
            align-items: flex-start;
            flex-direction: column;
            padding: 25px 21px;
            border-radius: 24px;
          }

          .attendance-refresh-button {
            width: 100%;
            justify-content: center;
          }

          .attendance-kpi-grid {
            grid-template-columns: 1fr;
          }

          .attendance-kpi {
            min-height: 94px;
          }

          .attendance-filter-header {
            align-items: flex-start;
            flex-direction: column;
            padding: 21px 18px 16px;
          }

          .attendance-filter-form,
          .attendance-date-actions {
            grid-template-columns: 1fr;
            padding-left: 18px;
            padding-right: 18px;
          }

          .attendance-date-actions {
            padding-bottom: 20px;
          }

          .attendance-primary-button,
          .attendance-secondary-button {
            width: 100%;
          }

          .attendance-mobile-meta {
            grid-template-columns: 1fr 1fr;
          }

          .attendance-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .attendance-pagination-controls {
            width: 100%;
            justify-content: space-between;
          }

          .attendance-modal-backdrop {
            align-items: end;
            padding: 0;
          }

          .attendance-modal {
            width: 100%;
            max-height: 93vh;
            border-radius: 25px 25px 0 0;
          }

          .attendance-modal-header,
          .attendance-modal-section,
          .attendance-modal-footer {
            padding-left: 19px;
            padding-right: 19px;
          }

          .attendance-detail-grid,
          .attendance-reason-grid,
          .attendance-location-grid {
            grid-template-columns: 1fr;
          }

          .attendance-detail-grid {
            padding: 18px 18px 2px;
          }

          .attendance-metadata-list > div {
            grid-template-columns: 1fr;
            gap: 6px;
          }

          .attendance-modal-footer {
            align-items: stretch;
            flex-direction: column;
          }
        }

        @media (max-width: 460px) {
          .attendance-mobile-top,
          .attendance-mobile-bottom {
            align-items: flex-start;
            flex-direction: column;
          }

          .attendance-mobile-top > small {
            text-align: left;
          }

          .attendance-mobile-meta {
            grid-template-columns: 1fr;
          }

          .attendance-mobile-bottom .attendance-view-button {
            width: 100%;
          }

          .attendance-status-badge,
          .attendance-mode-badge {
            max-width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .attendance-log-page *,
          .attendance-log-page *::before,
          .attendance-log-page *::after {
            scroll-behavior: auto !important;
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }
      `}</style>

      <header className="attendance-hero">
        <div className="attendance-hero-copy">
          <span className="attendance-eyebrow">
            <ShieldCheck size={17} />
            Attendance monitoring
          </span>

          <h1>Attendance Logs</h1>

          <p>
            Review employee attendance in a clear, read-only workspace with
            check-in and check-out timings, work mode, late or early-exit reasons,
            and location information. Internal database IDs are not displayed.
          </p>
        </div>

        <button
          type="button"
          className="attendance-refresh-button"
          onClick={() => loadAttendanceLogs({ silent: true })}
          disabled={refreshing}
        >
          <RefreshCw size={18} className={refreshing ? 'is-spinning' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh logs'}
        </button>
      </header>

      <div className="attendance-kpi-grid">
        <article className="attendance-kpi">
          <span className="attendance-kpi-icon">
            <Activity size={22} />
          </span>

          <div>
            <span>Total records</span>
            <strong>{total.toLocaleString('en-IN')}</strong>
            <small>Attendance records available in your permitted scope</small>
          </div>
        </article>

        <article className="attendance-kpi">
          <span className="attendance-kpi-icon">
            <UserRound size={22} />
          </span>

          <div>
            <span>Employees visible</span>
            <strong>{uniqueEmployees.toLocaleString('en-IN')}</strong>
            <small>Unique employees on the current page</small>
          </div>
        </article>

        <article className="attendance-kpi">
          <span className="attendance-kpi-icon">
            <BadgeCheck size={22} />
          </span>

          <div>
            <span>Present records</span>
            <strong>{presentCount.toLocaleString('en-IN')}</strong>
            <small>{lateCount} late entr{lateCount === 1 ? 'y' : 'ies'} on this page</small>
          </div>
        </article>

        <article className="attendance-kpi">
          <span className="attendance-kpi-icon">
            <Navigation size={22} />
          </span>

          <div>
            <span>WFH / Field</span>
            <strong>{mobileCount.toLocaleString('en-IN')}</strong>
            <small>Remote or field records on the current page</small>
          </div>
        </article>
      </div>

      <section className="attendance-panel">
        <div className="attendance-filter-header">
          <div className="attendance-filter-heading">
            <Filter size={21} />

            <div>
              <h2>Find attendance records</h2>
              <p>
                Search by employee details and filter by department, work mode,
                status, or date.
              </p>
            </div>
          </div>

          {hasFilters ? (
            <button
              type="button"
              className="attendance-secondary-button"
              onClick={clearFilters}
            >
              <X size={17} />
              Clear filters
            </button>
          ) : null}
        </div>

        <form className="attendance-filter-form" onSubmit={applyFilters}>
          <div className="attendance-field">
            <label htmlFor="attendance-log-search">Search employee</label>

            <div className="attendance-input-wrap">
              <Search size={18} />

              <input
                id="attendance-log-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Employee name, code, designation or status"
              />
            </div>
          </div>

          <div className="attendance-field">
            <label htmlFor="attendance-department">Department</label>

            <div className="attendance-input-wrap">
              <Building2 size={18} />

              <input
                id="attendance-department"
                value={departmentInput}
                onChange={(event) => setDepartmentInput(event.target.value)}
                placeholder="All departments"
              />
            </div>
          </div>

          <div className="attendance-field">
            <label htmlFor="attendance-mode">Attendance mode</label>

            <select
              id="attendance-mode"
              value={modeFilter}
              onChange={(event) => {
                setPage(1);
                setModeFilter(event.target.value);
              }}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="attendance-field">
            <label htmlFor="attendance-status">Attendance status</label>

            <select
              id="attendance-status"
              value={statusFilter}
              onChange={(event) => {
                setPage(1);
                setStatusFilter(event.target.value);
              }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </form>

        <div className="attendance-date-actions">
          <div className="attendance-field">
            <label htmlFor="attendance-date-from">From date</label>

            <div className="attendance-input-wrap">
              <CalendarDays size={18} />

              <input
                id="attendance-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setPage(1);
                  setDateFrom(event.target.value);
                }}
              />
            </div>
          </div>

          <div className="attendance-field">
            <label htmlFor="attendance-date-to">To date</label>

            <div className="attendance-input-wrap">
              <CalendarDays size={18} />

              <input
                id="attendance-date-to"
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(event) => {
                  setPage(1);
                  setDateTo(event.target.value);
                }}
              />
            </div>
          </div>

          <button type="button" className="attendance-primary-button" onClick={applyFilters}>
            <Search size={17} />
            Apply search
          </button>

          <button
            type="button"
            className="attendance-secondary-button"
            onClick={() => loadAttendanceLogs({ silent: true })}
          >
            <RefreshCw size={17} />
            Reload
          </button>
        </div>

        {error ? <div className="attendance-error">{error}</div> : null}

        {loading ? (
          <div className="attendance-loading" aria-label="Loading attendance logs">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : rows.length > 0 ? (
          <>
            <div className="attendance-table-wrap">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th>Check-in</th>
                    <th>Check-out</th>
                    <th>Working duration</th>
                    <th>Location / remark</th>
                    <th>Details</th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row, index) => {
                    const rowKey = [
                      row.date,
                      row.employee_code,
                      row.employee_name,
                      row.check_in,
                      index,
                    ].join('-');

                    const locationText =
                      locationSummary(row, 'check_in_location') ||
                      normaliseText(row.late_reason) ||
                      normaliseText(row.early_checkout_reason) ||
                      'No location or special remark';

                    return (
                      <tr key={rowKey}>
                        <td>
                          <div className="attendance-employee">
                            <strong>{employeeName(row)}</strong>
                            <small>
                              {[
                                employeeCode(row),
                                normaliseText(row.department),
                                normaliseText(row.designation),
                              ]
                                .filter(Boolean)
                                .join(' • ') || 'Employee details unavailable'}
                            </small>
                          </div>
                        </td>

                        <td>
                          <div className="attendance-date-cell">
                            <strong>{formatAttendanceDate(row.date)}</strong>
                            <small>{normaliseText(row.state) || 'State not recorded'}</small>
                          </div>
                        </td>

                        <td>
                          <span
                            className={`attendance-mode-badge ${modeTone(row.mode)}`}
                          >
                            {attendanceMode(row) === 'field' ? (
                              <Navigation size={15} />
                            ) : attendanceMode(row) === 'wfh' ? (
                              <Laptop size={15} />
                            ) : (
                              <Building2 size={15} />
                            )}

                            {modeLabel(row.mode)}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`attendance-status-badge ${statusTone(row)}`}
                          >
                            {statusLabel(row.status)}
                          </span>
                        </td>

                        <td>
                          <div className="attendance-time-block">
                            <strong>{formatTime(row.check_in)}</strong>
                            <small>{row.is_late ? 'Late entry recorded' : 'Entry time'}</small>
                          </div>
                        </td>

                        <td>
                          <div className="attendance-time-block">
                            <strong>{formatTime(row.check_out)}</strong>
                            <small>
                              {row.is_early_checkout
                                ? 'Early checkout recorded'
                                : row.check_out
                                  ? 'Exit time'
                                  : 'Still checked in'}
                            </small>
                          </div>
                        </td>

                        <td>
                          <div className="attendance-time-block">
                            <strong>{formatDuration(row.check_in, row.check_out)}</strong>
                            <small>
                              {row.verified_by_ro
                                ? 'RO verified'
                                : 'Verification not recorded'}
                            </small>
                          </div>
                        </td>

                        <td>
                          <div className="attendance-location-cell">
                            <span>{locationText}</span>
                          </div>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="attendance-view-button"
                            onClick={() => setSelectedRow(row)}
                          >
                            <Eye size={16} />
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="attendance-mobile-list">
              {rows.map((row, index) => {
                const rowKey = [
                  'mobile',
                  row.date,
                  row.employee_code,
                  row.employee_name,
                  index,
                ].join('-');

                return (
                  <article className="attendance-mobile-card" key={rowKey}>
                    <div className="attendance-mobile-top">
                      <span
                        className={`attendance-status-badge ${statusTone(row)}`}
                      >
                        {statusLabel(row.status)}
                      </span>

                      <small>{formatAttendanceDate(row.date)}</small>
                    </div>

                    <div>
                      <h3>{employeeName(row)}</h3>
                      <p>
                        {[
                          employeeCode(row),
                          normaliseText(row.department),
                          normaliseText(row.designation),
                        ]
                          .filter(Boolean)
                          .join(' • ') || 'Employee details unavailable'}
                      </p>
                    </div>

                    <span className={`attendance-mode-badge ${modeTone(row.mode)}`}>
                      {attendanceMode(row) === 'field' ? (
                        <Navigation size={15} />
                      ) : attendanceMode(row) === 'wfh' ? (
                        <Laptop size={15} />
                      ) : (
                        <Building2 size={15} />
                      )}

                      {modeLabel(row.mode)}
                    </span>

                    <div className="attendance-mobile-meta">
                      <article>
                        <span>Check-in</span>
                        <strong>{formatTime(row.check_in)}</strong>
                      </article>

                      <article>
                        <span>Check-out</span>
                        <strong>{formatTime(row.check_out)}</strong>
                      </article>

                      <article>
                        <span>Duration</span>
                        <strong>{formatDuration(row.check_in, row.check_out)}</strong>
                      </article>

                      <article>
                        <span>Verification</span>
                        <strong>{row.verified_by_ro ? 'RO verified' : 'Not recorded'}</strong>
                      </article>
                    </div>

                    <div className="attendance-mobile-bottom">
                      <span className="attendance-location-cell">
                        {locationSummary(row, 'check_in_location') ||
                          normaliseText(row.late_reason) ||
                          'No location remark'}
                      </span>

                      <button
                        type="button"
                        className="attendance-view-button"
                        onClick={() => setSelectedRow(row)}
                      >
                        <Eye size={16} />
                        View
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="attendance-empty-state">
            <Clock3 size={43} />
            <h3>No attendance records found</h3>
            <p>
              No records match the selected search and filters. Clear the filters
              or refresh the page to check for newly recorded attendance.
            </p>
          </div>
        )}

        <footer className="attendance-pagination">
          <p>
            Page {page} of {pageCount} • {total.toLocaleString('en-IN')} total
            attendance record{total === 1 ? '' : 's'}
          </p>

          <div className="attendance-pagination-controls">
            <button
              type="button"
              className="attendance-page-button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              aria-label="Previous page"
            >
              <ChevronLeft size={19} />
            </button>

            <span className="attendance-page-indicator">
              {page} / {pageCount}
            </span>

            <button
              type="button"
              className="attendance-page-button"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={page >= pageCount || loading}
              aria-label="Next page"
            >
              <ChevronRight size={19} />
            </button>
          </div>
        </footer>
      </section>

      <AttendanceDetailsModal
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
      />
    </section>
  );
}