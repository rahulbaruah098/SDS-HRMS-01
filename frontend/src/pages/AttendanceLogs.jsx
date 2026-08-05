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
  Sparkles,
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
          --attendance-ink: #101a3a;
          --attendance-muted: #5d6d8d;
          --attendance-border: rgba(16, 26, 58, .14);
          --attendance-primary: #6658dc;
          --attendance-primary-soft: #f1efff;
          --attendance-blue: #3766db;
          --attendance-cyan: #18b5c8;
          --attendance-teal: #34c9c4;
          --attendance-yellow: #d8ff43;
          position: relative;
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          width: 100%;
          padding-bottom: 34px;
          color: var(--attendance-ink);
        }

        .attendance-hero,
        .attendance-panel {
          border: 1px solid rgba(171, 181, 211, .70);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34, 38, 110, .10);
        }

        .attendance-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: clamp(22px, 3vw, 40px);
          min-height: 275px;
          padding: clamp(25px, 3vw, 42px);
          border-radius: clamp(28px, 2.7vw, 40px);
          background:
            radial-gradient(circle at 8% 6%, rgba(105, 217, 208, .26), transparent 29%),
            radial-gradient(circle at 95% 4%, rgba(153, 164, 245, .24), transparent 31%),
            linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%);
          box-shadow:
            12px 14px 0 #c6d8f7,
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .attendance-hero::before {
          content: "";
          position: absolute;
          z-index: -1;
          width: 175px;
          height: 175px;
          right: 8%;
          bottom: -98px;
          border-radius: 38% 62% 58% 42% / 48% 43% 57% 52%;
          background: linear-gradient(
            145deg,
            rgba(105, 217, 208, .30),
            rgba(132, 181, 241, .28)
          );
          transform: rotate(-18deg);
        }

        .attendance-hero-copy {
          position: relative;
          z-index: 1;
          max-width: 900px;
        }

        .attendance-eyebrow,
        .attendance-section-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .attendance-eyebrow {
          margin-bottom: 15px;
          padding: 9px 13px;
          box-shadow: 4px 5px 0 #18b5c8;
        }

        .attendance-section-kicker {
          margin-bottom: 9px;
          padding: 7px 10px;
          box-shadow: 3px 4px 0 #18b5c8;
        }

        .attendance-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--attendance-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 77px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .attendance-hero h1 em {
          color: var(--attendance-primary);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .attendance-hero p {
          max-width: 830px;
          margin: 17px 0 0;
          color: var(--attendance-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .attendance-refresh-button,
        .attendance-primary-button,
        .attendance-secondary-button,
        .attendance-page-button,
        .attendance-view-button,
        .attendance-icon-button {
          border: 0;
          font: inherit;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 190ms cubic-bezier(.22,1,.36,1),
            box-shadow 190ms ease,
            background 190ms ease,
            border-color 190ms ease,
            filter 190ms ease;
        }

        .attendance-refresh-button {
          position: relative;
          z-index: 1;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          min-height: 54px;
          padding: 0 19px;
          border: 1px solid rgba(65, 55, 161, .18);
          border-radius: 18px;
          background: rgba(255, 255, 255, .90);
          color: #40348d;
          box-shadow:
            6px 7px 0 #b9d7ff,
            0 14px 25px rgba(44, 75, 116, .10);
          white-space: nowrap;
        }

        .attendance-refresh-button:hover,
        .attendance-primary-button:hover,
        .attendance-secondary-button:hover,
        .attendance-view-button:hover,
        .attendance-page-button:not(:disabled):hover,
        .attendance-icon-button:hover {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .attendance-refresh-button svg:not(.is-spinning) {
          animation: attendance-refresh-idle 4.2s linear infinite;
        }

        .attendance-refresh-button svg.is-spinning {
          animation: attendance-spin .8s linear infinite;
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
          min-height: 122px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow:
            7px 9px 0 #b9d7ff,
            0 18px 30px rgba(34, 38, 110, .09);
          transition:
            transform 210ms cubic-bezier(.22,1,.36,1),
            box-shadow 210ms ease;
        }

        .attendance-kpi:nth-child(2) {
          background: #eaf8f4;
          box-shadow:
            7px 9px 0 #aee6d9,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .attendance-kpi:nth-child(3) {
          background: #fff4d5;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .attendance-kpi:nth-child(4) {
          background: #f1efff;
          box-shadow:
            7px 9px 0 #c9c0ff,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .attendance-kpi:hover {
          transform: translateY(-4px);
        }

        .attendance-kpi-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          flex: 0 0 48px;
          border-radius: 16px;
          color: #fff;
          background: linear-gradient(145deg, #6658dc, #18b5c8);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .18);
          animation: attendance-kpi-float 3.2s ease-in-out infinite;
        }

        .attendance-kpi:nth-child(2) .attendance-kpi-icon {
          background: linear-gradient(145deg, #16835f, #34c9c4);
          animation-delay: -.7s;
        }

        .attendance-kpi:nth-child(3) .attendance-kpi-icon {
          background: linear-gradient(145deg, #da7b12, #f5b94f);
          animation-delay: -1.4s;
        }

        .attendance-kpi:nth-child(4) .attendance-kpi-icon {
          background: linear-gradient(145deg, #3766db, #18b5c8);
          animation-delay: -2.1s;
        }

        .attendance-kpi span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .10em;
          text-transform: uppercase;
        }

        .attendance-kpi strong {
          display: block;
          margin-top: 6px;
          color: var(--attendance-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(28px, 2.6vw, 40px);
          line-height: 1.05;
        }

        .attendance-kpi small {
          display: block;
          margin-top: 6px;
          color: var(--attendance-muted);
          line-height: 1.4;
          font-weight: 750;
        }

        .attendance-panel {
          overflow: hidden;
          border-radius: clamp(26px, 2.2vw, 36px);
        }

        .attendance-filter-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding: 24px 26px 18px;
        }

        .attendance-filter-heading {
          display: flex;
          align-items: flex-start;
          gap: 11px;
        }

        .attendance-filter-heading > svg {
          margin-top: 4px;
          color: var(--attendance-primary);
        }

        .attendance-filter-heading h2 {
          margin: 0;
          color: var(--attendance-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 2.3vw, 37px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .attendance-filter-heading p {
          margin: 7px 0 0;
          color: var(--attendance-muted);
          font-size: 13px;
          line-height: 1.55;
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
          gap: 8px;
          min-width: 0;
        }

        .attendance-field label {
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .attendance-input-wrap {
          position: relative;
        }

        .attendance-input-wrap > svg {
          position: absolute;
          top: 50%;
          left: 14px;
          transform: translateY(-50%);
          color: var(--attendance-primary);
          pointer-events: none;
        }

        .attendance-field input,
        .attendance-field select {
          width: 100%;
          min-height: 47px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 15px;
          outline: none;
          background: rgba(255, 255, 255, .94);
          color: var(--attendance-ink);
          font: inherit;
          padding: 0 14px;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease;
        }

        .attendance-input-wrap input {
          padding-left: 43px;
        }

        .attendance-field input:focus,
        .attendance-field select:focus {
          border-color: rgba(102, 88, 220, .65);
          box-shadow:
            4px 5px 0 rgba(102, 88, 220, .14),
            0 0 0 4px rgba(102, 88, 220, .08);
          transform: translateY(-1px);
        }

        .attendance-primary-button,
        .attendance-secondary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 47px;
          padding: 0 18px;
          border-radius: 15px;
        }

        .attendance-primary-button {
          align-self: end;
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36, 74, 128, .16);
        }

        .attendance-secondary-button {
          align-self: end;
          border: 1px solid rgba(65, 55, 161, .18);
          color: #40348d;
          background: rgba(255,255,255,.92);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
        }

        .attendance-error,
        .attendance-empty-state {
          margin: 0 26px 24px;
          border-radius: 20px;
          text-align: center;
        }

        .attendance-error {
          padding: 16px 18px;
          border: 1px solid rgba(216, 77, 104, .28);
          background: #fff0f2;
          color: #a2344d;
          box-shadow: 4px 5px 0 #f2c2cc;
          font-weight: 800;
        }

        .attendance-table-wrap {
          width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          border-top: 1px solid rgba(171, 181, 211, .42);
          scrollbar-width: thin;
          scrollbar-color: rgba(102, 88, 220, .35) transparent;
          -webkit-overflow-scrolling: touch;
        }

        .attendance-table-wrap::-webkit-scrollbar {
          height: 8px;
        }

        .attendance-table-wrap::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(102, 88, 220, .30);
        }

        .attendance-table {
          width: 100%;
          min-width: 1320px;
          border-collapse: collapse;
          table-layout: auto;
        }

        .attendance-table th {
          padding: 14px 17px;
          background: linear-gradient(180deg, #f8f8ff, #f4f8fb);
          color: #536381;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: .07em;
          text-align: left;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .attendance-table td {
          padding: 17px;
          border-top: 1px solid rgba(171, 181, 211, .36);
          vertical-align: middle;
        }

        .attendance-table tbody tr {
          transition: background 180ms ease;
        }

        .attendance-table tbody tr:hover {
          background: #fafaff;
        }

        .attendance-employee {
          display: grid;
          gap: 4px;
          min-width: 195px;
        }

        .attendance-employee strong {
          color: var(--attendance-ink);
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
          min-height: 34px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          line-height: 1;
          white-space: nowrap;
          box-shadow: 2px 3px 0 rgba(52, 43, 120, .07);
        }

        .attendance-status-badge svg,
        .attendance-mode-badge svg {
          flex: 0 0 auto;
        }

        .attendance-status-badge {
          padding: 8px 12px;
        }

        .attendance-status-badge.success {
          background: #eaf8f4;
          color: #047857;
          box-shadow: 2px 3px 0 #aee6d9;
        }

        .attendance-status-badge.warning {
          background: #fff4d5;
          color: #9a6817;
          box-shadow: 2px 3px 0 #ffe0a5;
        }

        .attendance-status-badge.danger {
          background: #fff0f2;
          color: #a2344d;
          box-shadow: 2px 3px 0 #f2c2cc;
        }

        .attendance-status-badge.holiday {
          background: #f1efff;
          color: #40348d;
          box-shadow: 2px 3px 0 #c9c0ff;
        }

        .attendance-mode-badge {
          gap: 7px;
          padding: 7px 11px;
        }

        .attendance-mode-badge.office {
          background: #edf6ff;
          color: #245da8;
          box-shadow: 2px 3px 0 #b9d7ff;
        }

        .attendance-mode-badge.wfh {
          background: #f1efff;
          color: #40348d;
          box-shadow: 2px 3px 0 #c9c0ff;
        }

        .attendance-mode-badge.field {
          background: #eaf8f4;
          color: #047857;
          box-shadow: 2px 3px 0 #aee6d9;
        }

        .attendance-time-block,
        .attendance-date-cell {
          display: grid;
          gap: 4px;
          min-width: 150px;
        }

        .attendance-time-block strong,
        .attendance-date-cell strong {
          color: var(--attendance-ink);
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
          border: 1px solid rgba(102, 88, 220, .22);
          border-radius: 13px;
          background: #f1efff;
          color: #40348d;
          box-shadow: 3px 4px 0 #c9c0ff;
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
              rgba(231, 235, 245, .70),
              rgba(250, 251, 255, .95),
              rgba(231, 235, 245, .70)
            );
          background-size: 220% 100%;
          animation: attendance-skeleton 1.25s linear infinite;
        }

        .attendance-empty-state {
          display: grid;
          justify-items: center;
          gap: 10px;
          padding: 48px 20px;
          border: 1px dashed rgba(102, 88, 220, .34);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          box-shadow: 4px 5px 0 rgba(52,43,120,.07);
          color: var(--attendance-muted);
        }

        .attendance-empty-state svg {
          color: var(--attendance-primary);
        }

        .attendance-empty-state h3 {
          margin: 0;
          color: var(--attendance-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 25px;
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
          border-top: 1px solid rgba(171, 181, 211, .42);
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
          border: 1px solid rgba(102, 88, 220, .20);
          border-radius: 13px;
          background: #f1efff;
          color: #40348d;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .attendance-page-button:disabled {
          cursor: not-allowed;
          opacity: .45;
        }

        .attendance-page-indicator {
          min-width: 88px;
          text-align: center;
          color: #40348d;
          font-size: 13px;
          font-weight: 900;
        }

        .attendance-mobile-list {
          display: none;
          gap: 12px;
          padding: 0 16px 18px;
          border-top: 1px solid rgba(171, 181, 211, .42);
        }

        .attendance-mobile-card {
          display: grid;
          gap: 13px;
          padding: 17px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 21px;
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow: 5px 6px 0 #c4ccff;
        }

        .attendance-mobile-card:nth-child(3n + 1) {
          background: linear-gradient(145deg, #edf6ff, #ffffff);
          box-shadow: 5px 6px 0 #b9d7ff;
        }

        .attendance-mobile-card:nth-child(3n + 2) {
          background: linear-gradient(145deg, #eaf8f4, #ffffff);
          box-shadow: 5px 6px 0 #aee6d9;
        }

        .attendance-mobile-card:nth-child(3n + 3) {
          background: linear-gradient(145deg, #f1efff, #ffffff);
          box-shadow: 5px 6px 0 #c9c0ff;
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
          color: var(--attendance-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 20px;
          font-weight: 760;
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
          border: 1px solid rgba(171, 181, 211, .45);
          border-radius: 15px;
          background: rgba(255,255,255,.84);
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .attendance-mobile-meta span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .07em;
        }

        .attendance-mobile-meta strong {
          display: block;
          margin-top: 5px;
          color: var(--attendance-ink);
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
          width: min(880px, 100%);
          max-height: min(90vh, 880px);
          overflow-y: auto;
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: 28px;
          background:
            radial-gradient(circle at 0% 0%, rgba(105,217,208,.12), transparent 26%),
            radial-gradient(circle at 100% 0%, rgba(102,88,220,.10), transparent 28%),
            #fff;
          box-shadow:
            10px 12px 0 #c4ccff,
            0 34px 90px rgba(9, 16, 35, .30);
          animation: attendance-modal-enter .2s ease-out;
        }

        .attendance-modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 27px 28px 22px;
          border-bottom: 1px solid rgba(171, 181, 211, .46);
          background: rgba(255,255,255,.92);
          backdrop-filter: blur(12px);
        }

        .attendance-modal-header h2 {
          margin: 8px 0 5px;
          color: var(--attendance-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 30px;
          font-weight: 760;
          letter-spacing: -.04em;
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
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 13px;
          background: #fff;
          color: #40348d;
          box-shadow: 3px 4px 0 rgba(52,43,120,.08);
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
          border: 1px solid rgba(171, 181, 211, .50);
          border-radius: 18px;
          background: #edf6ff;
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .attendance-detail-card:nth-child(2) {
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .attendance-detail-card:nth-child(3) {
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .attendance-detail-card:nth-child(4) {
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .attendance-detail-card > svg {
          flex: 0 0 auto;
          color: #40348d;
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
          color: var(--attendance-ink);
          overflow-wrap: anywhere;
        }

        .attendance-modal-section {
          padding: 20px 28px 0;
        }

        .attendance-modal-section h3 {
          margin: 0 0 13px;
          color: var(--attendance-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 20px;
          font-weight: 760;
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
          border: 1px solid rgba(171, 181, 211, .50);
          border-radius: 17px;
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .attendance-reason-grid span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .attendance-reason-grid strong {
          display: block;
          margin-top: 7px;
          color: var(--attendance-ink);
          line-height: 1.5;
        }

        .attendance-location-heading {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #40348d;
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
          color: #40348d;
          font-weight: 900;
          text-decoration: none;
        }

        .attendance-photo-link {
          padding: 13px 15px;
          border: 1px solid rgba(102, 88, 220, .20);
          border-radius: 15px;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .attendance-metadata-list {
          display: grid;
          gap: 1px;
          overflow: hidden;
          margin: 0;
          border: 1px solid rgba(171, 181, 211, .50);
          border-radius: 17px;
          background: rgba(171, 181, 211, .30);
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
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
          font-weight: 900;
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

        @keyframes attendance-refresh-idle {
          0%, 84% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes attendance-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes attendance-kpi-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-3px) rotate(-3deg); }
        }

        @keyframes attendance-skeleton {
          to { background-position: -220% 0; }
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
            gap: 17px;
          }

          .attendance-hero {
            grid-template-columns: 1fr;
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow:
              6px 7px 0 #c6d8f7,
              0 18px 30px rgba(34, 38, 110, .10);
          }

          .attendance-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .attendance-refresh-button {
            width: 100%;
          }

          .attendance-kpi-grid {
            grid-template-columns: 1fr;
          }

          .attendance-kpi {
            min-height: 102px;
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
            box-shadow: 0 -20px 60px rgba(18,23,36,.22);
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
          .attendance-hero {
            padding: 16px;
          }

          .attendance-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

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
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <header className="attendance-hero">
        <div className="attendance-hero-copy">
          <span className="attendance-eyebrow">
            <Sparkles size={14} />
            Attendance Monitoring
          </span>

          <h1>
            Attendance records, <em>clearly organised.</em>
          </h1>

          <p>
            Review employee attendance, check-in and check-out timing, work mode,
            late or early-exit reasons, location details and verification status
            from one connected YourComate workspace. Internal database IDs remain hidden.
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
              <span className="attendance-section-kicker">Search & Filter</span>
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