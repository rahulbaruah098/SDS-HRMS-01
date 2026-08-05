import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  RefreshCcw,
  Send,
  Sparkles,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  api,
  buildQuery,
  createHolidayWorkRequest,
  getHolidayWorkRequests,
  getMyHolidayWorkRequests,
  decideHolidayWorkRequest,
} from '../api/client';

const MANAGER_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'team_leader',
  'reporting_officer',
  'manager',
  'ro',
]);

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function normalizeRoles(user = {}) {
  const roles = new Set();

  if (Array.isArray(user.roles)) {
    user.roles.forEach((role) => {
      const normalized = normalizeRole(role);
      if (normalized) roles.add(normalized);
    });
  }

  if (typeof user.roles === 'string') {
    user.roles.split(',').forEach((role) => {
      const normalized = normalizeRole(role);
      if (normalized) roles.add(normalized);
    });
  }

  const role = normalizeRole(user.role);
  if (role) roles.add(role);

  return Array.from(roles);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }

  return '';
}

function formatDate(dateValue) {
  if (!dateValue) return '—';

  const date = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    weekday: 'short',
  });
}

function toIsoDate(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function addDays(dateObj, days) {
  const next = new Date(dateObj);
  next.setDate(next.getDate() + days);
  return next;
}

function isSecondOrFourthSaturday(dateObj) {
  if (dateObj.getDay() !== 6) return false;

  const day = dateObj.getDate();
  const saturdayNumber = Math.ceil(day / 7);

  return saturdayNumber === 2 || saturdayNumber === 4;
}

function getWeeklyHolidayTitle(dateObj) {
  if (dateObj.getDay() === 0) {
    return 'Sunday Holiday';
  }

  if (isSecondOrFourthSaturday(dateObj)) {
    return 'Saturday Holiday';
  }

  return '';
}

function buildUpcomingWeeklyHolidays(daysAhead = 90) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items = [];

  for (let index = 0; index <= daysAhead; index += 1) {
    const current = addDays(today, index);
    const title = getWeeklyHolidayTitle(current);

    if (!title) continue;

    items.push({
      date: toIsoDate(current),
      title,
      holiday_type: 'weekly',
      source: 'weekly',
      message:
        title === 'Sunday Holiday'
          ? 'Sunday is a weekly holiday.'
          : 'Second and fourth Saturday are weekly holidays.',
    });
  }

  return items;
}

function uniqueHolidayOptions(manualItems = []) {
  const weekly = buildUpcomingWeeklyHolidays(90);
  const map = new Map();

  weekly.forEach((item) => {
    map.set(item.date, item);
  });

  manualItems.forEach((item) => {
    if (!item?.date) return;

    map.set(item.date, {
      date: item.date,
      title: item.title || item.holiday_title || 'Holiday',
      holiday_type: item.holiday_type || 'manual',
      source: 'calendar',
      message: item.message || '',
      state: item.state || '',
    });
  });

  return Array.from(map.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function statusLabel(value) {
  const status = String(value || '').toLowerCase();

  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'pending') return 'Pending';

  return value || '—';
}

function approvalLabel(row = {}) {
  return (
    row.approval_stage_label ||
    row.pending_approver_role ||
    row.approval_stage ||
    row.status ||
    '—'
  );
}

function getEmployeeProfile(user = {}) {
  const employee = user.employee || user.employee_summary || user.profile || {};

  return {
    employee_id: firstNonEmpty(
      employee._id,
      user.employee_id,
      user.employee_ref_id,
      user.emp_id,
      user._id,
    ),
    employee_name: firstNonEmpty(
      employee.name,
      employee.employee_name,
      employee.full_name,
      user.name,
      user.employee_name,
      user.full_name,
      user.email,
    ),
    employee_code: firstNonEmpty(
      employee.employee_code,
      employee.emp_code,
      employee.code,
      user.employee_code,
      user.emp_code,
      user.code,
    ),
    department: firstNonEmpty(employee.department, user.department),
    designation: firstNonEmpty(employee.designation, user.designation),
    state: firstNonEmpty(employee.state, employee.office_state, user.state),
    team_leader_name: firstNonEmpty(employee.team_leader_name, user.team_leader_name),
    reporting_officer_name: firstNonEmpty(
      employee.reporting_officer_name,
      user.reporting_officer_name,
    ),
  };
}

function RequestCard({ row, canManage, decidingId, onDecision }) {
  const isPending = String(row.status || '').toLowerCase() === 'pending';

  return (
    <article className="hwr-request-card">
      <div className="hwr-request-top">
        <div>
          <span className="hwr-request-id">Holiday Work</span>
          <h3>{row.employee_name || 'Employee'}</h3>
          <p>
            {row.department || 'Department not set'}
            {row.designation ? ` • ${row.designation}` : ''}
          </p>
        </div>

        <span className={`hwr-status ${String(row.status || 'pending').toLowerCase()}`}>
          {statusLabel(row.status)}
        </span>
      </div>

      <div className="hwr-request-grid">
        <div>
          <span>Date</span>
          <strong>{formatDate(row.date)}</strong>
        </div>

        <div>
          <span>Holiday</span>
          <strong>{row.holiday_title || 'Holiday'}</strong>
        </div>

        <div>
          <span>Type</span>
          <strong>{row.holiday_type || 'Holiday'}</strong>
        </div>

        <div>
          <span>Approval Stage</span>
          <strong>{approvalLabel(row)}</strong>
        </div>
      </div>

      <div className="hwr-reason-box">
        <span>Reason</span>
        <p>{row.reason || '—'}</p>
      </div>

      {row.work_location || row.field_location ? (
        <div className="hwr-location-box">
          <span>Work Location</span>
          <p>{row.work_location || row.field_location}</p>
        </div>
      ) : null}

      <div className="hwr-meta-line">
        <span>TL: {row.team_leader_name || '—'}</span>
        <span>RO: {row.reporting_officer_name || '—'}</span>
        {row.decided_by_name ? <span>Decided by: {row.decided_by_name}</span> : null}
      </div>

      {canManage && isPending ? (
        <div className="hwr-actions">
          <button
            type="button"
            className="hwr-approve"
            disabled={decidingId === row._id}
            onClick={() => onDecision(row, 'approved')}
          >
            <CheckCircle2 size={15} />
            {decidingId === row._id ? 'Updating...' : 'Approve'}
          </button>

          <button
            type="button"
            className="hwr-reject"
            disabled={decidingId === row._id}
            onClick={() => onDecision(row, 'rejected')}
          >
            <XCircle size={15} />
            Reject
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function HolidayWorkRequests({ user }) {
  const userRoles = useMemo(() => normalizeRoles(user), [user]);
  const canManage = userRoles.some((role) => MANAGER_ROLES.has(role));
  const employeeProfile = useMemo(() => getEmployeeProfile(user), [user]);

  const [holidayOptions, setHolidayOptions] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [requests, setRequests] = useState([]);
  const [message, setMessage] = useState('');
  const [loadingPage, setLoadingPage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [decidingId, setDecidingId] = useState('');

  const [form, setForm] = useState({
    date: '',
    reason: '',
    work_location: '',
  });

  const [filters, setFilters] = useState({
    status: 'pending',
    date: '',
  });

  const selectedHoliday = holidayOptions.find((item) => item.date === form.date);

  async function loadHolidayOptions() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dateFrom = toIsoDate(today);
    const dateTo = toIsoDate(addDays(today, 90));

    let manualHolidays = [];

    try {
      const data = await api(`/attendance/holidays${buildQuery({
        date_from: dateFrom,
        date_to: dateTo,
      })}`);

      manualHolidays = data.items || [];
    } catch (error) {
      console.warn('Unable to load manual holidays. Weekly holidays will still show.', error);
    }

    const options = uniqueHolidayOptions(manualHolidays);
    setHolidayOptions(options);

    if (!form.date && options.length) {
      setForm((prev) => ({
        ...prev,
        date: options[0].date,
      }));
    }
  }

  async function loadMyRequests() {
    const data = await getMyHolidayWorkRequests();
    setMyRequests(data.items || []);
  }

  async function loadRequests(nextFilters = filters) {
    if (!canManage) {
      setRequests([]);
      return;
    }

    const payload = {};

    if (nextFilters.status) payload.status = nextFilters.status;
    if (nextFilters.date) payload.date = nextFilters.date;

    const data = await getHolidayWorkRequests(payload);
    setRequests(data.items || []);
  }

  async function refreshPage() {
    try {
      setMessage('');
      setLoadingPage(true);

      await Promise.all([
        loadHolidayOptions(),
        loadMyRequests(),
        canManage ? loadRequests(filters) : Promise.resolve(),
      ]);
    } catch (error) {
      setMessage(error.message || 'Unable to load holiday work requests');
    } finally {
      setLoadingPage(false);
    }
  }

  useEffect(() => {
    refreshPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitRequest(event) {
    event.preventDefault();

    if (!form.date) {
      setMessage('Please select a holiday date.');
      return;
    }

    if (!form.reason.trim()) {
      setMessage('Reason is required.');
      return;
    }

    try {
      setMessage('');
      setSubmitting(true);

      const holiday = holidayOptions.find((item) => item.date === form.date);

      const data = await createHolidayWorkRequest({
        date: form.date,
        reason: form.reason.trim(),
        work_location: form.work_location.trim(),
        holiday_title: holiday?.title || '',
        holiday_type: holiday?.holiday_type || '',
      });

      setMessage(data.message || 'Holiday work request submitted.');

      setForm((prev) => ({
        ...prev,
        reason: '',
        work_location: '',
      }));

      await Promise.all([
        loadMyRequests(),
        canManage ? loadRequests(filters) : Promise.resolve(),
      ]);
    } catch (error) {
      setMessage(error.message || 'Unable to submit holiday work request.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFilterSubmit(event) {
    event.preventDefault();

    try {
      setMessage('');
      await loadRequests(filters);
    } catch (error) {
      setMessage(error.message || 'Unable to load approval requests.');
    }
  }

  async function handleDecision(row, status) {
    const decisionText = status === 'approved' ? 'approve' : 'reject';
    const ok = window.confirm(`Are you sure you want to ${decisionText} this holiday work request?`);

    if (!ok) return;

    try {
      setMessage('');
      setDecidingId(row._id);

      const data = await decideHolidayWorkRequest(row._id, { status });

      setMessage(data.message || `Request ${status}.`);

      await Promise.all([
        loadRequests(filters),
        loadMyRequests(),
      ]);
    } catch (error) {
      setMessage(error.message || 'Unable to update request.');
    } finally {
      setDecidingId('');
    }
  }

  return (
    <div className="hwr-page">
      <style>
        {`
          .hwr-page {
            --hwr-ink: #101a3a;
            --hwr-copy: #5d6d8d;
            --hwr-violet: #6658dc;
            --hwr-violet-deep: #40348d;
            --hwr-blue: #3766db;
            --hwr-cyan: #18b5c8;
            --hwr-teal: #34c9c4;
            --hwr-yellow: #d8ff43;
            --hwr-danger: #d84d68;
            --hwr-line: rgba(16, 26, 58, .14);
            display: grid;
            gap: clamp(18px, 2vw, 26px);
            color: var(--hwr-ink);
          }

          .hwr-hero {
            position: relative;
            isolation: isolate;
            overflow: hidden;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: clamp(22px, 3vw, 40px);
            align-items: center;
            min-height: 275px;
            padding: clamp(25px, 3vw, 42px);
            border: 1px solid rgba(154, 164, 205, .58);
            border-radius: clamp(28px, 2.7vw, 40px);
            background:
              radial-gradient(circle at 8% 6%, rgba(105, 217, 208, .26), transparent 29%),
              radial-gradient(circle at 95% 4%, rgba(153, 164, 245, .24), transparent 31%),
              linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%);
            box-shadow:
              12px 14px 0 #c6d8f7,
              0 28px 48px rgba(34, 38, 110, .13);
          }

          .hwr-hero::before {
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

          .hwr-eyebrow,
          .hwr-section-kicker {
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

          .hwr-eyebrow {
            margin-bottom: 15px;
            padding: 9px 13px;
            box-shadow: 4px 5px 0 #18b5c8;
          }

          .hwr-section-kicker {
            margin-bottom: 10px;
            padding: 7px 10px;
            box-shadow: 3px 4px 0 #18b5c8;
          }

          .hwr-hero h1 {
            max-width: 900px;
            margin: 0;
            color: var(--hwr-ink);
            font-family: var(--yc-display, Georgia, "Times New Roman", serif);
            font-size: clamp(44px, 5.2vw, 77px);
            font-weight: 760;
            line-height: .94;
            letter-spacing: -.058em;
          }

          .hwr-hero h1 em {
            color: var(--hwr-violet);
            font-family: Georgia, "Times New Roman", serif;
            font-weight: 500;
          }

          .hwr-hero p {
            max-width: 830px;
            margin: 17px 0 0;
            color: var(--hwr-copy);
            font-size: clamp(13px, 1vw, 16px);
            line-height: 1.68;
          }

          .hwr-refresh {
            min-height: 54px;
            padding: 0 18px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 9px;
            border: 1px solid rgba(65, 55, 161, .18);
            border-radius: 18px;
            color: #40348d;
            background: rgba(255, 255, 255, .90);
            box-shadow:
              6px 7px 0 #b9d7ff,
              0 14px 25px rgba(44, 75, 116, .10);
            font-weight: 900;
            cursor: pointer;
            white-space: nowrap;
            transition:
              transform 190ms cubic-bezier(.22,1,.36,1),
              box-shadow 190ms ease;
          }

          .hwr-refresh svg:first-child {
            animation: hwrRefreshIdle 4.2s linear infinite;
          }

          .hwr-refresh:disabled svg:first-child {
            animation: hwrSpin 1s linear infinite;
          }

          .hwr-refresh:hover {
            transform: translateY(-3px);
            box-shadow:
              8px 9px 0 #b9d7ff,
              0 18px 30px rgba(44, 75, 116, .14);
          }

          .hwr-alert {
            padding: 14px 16px;
            border: 1px solid rgba(55, 102, 219, .24);
            border-radius: 18px;
            color: #245da8;
            background: #edf6ff;
            box-shadow: 4px 5px 0 #b9d7ff;
            font-weight: 800;
          }

          .hwr-layout {
            display: grid;
            grid-template-columns: minmax(350px, .82fr) minmax(0, 1.18fr);
            gap: 24px;
            align-items: start;
          }

          .hwr-panel,
          .hwr-request-card {
            border: 1px solid rgba(171, 181, 211, .70);
            background: linear-gradient(145deg, #ffffff, #f7fbff);
            box-shadow:
              8px 10px 0 #c4ccff,
              0 24px 42px rgba(34, 38, 110, .10);
            transition:
              transform 210ms cubic-bezier(.22,1,.36,1),
              box-shadow 210ms ease,
              border-color 210ms ease;
          }

          .hwr-panel {
            min-width: 0;
            padding: clamp(20px, 2vw, 28px);
            border-radius: clamp(26px, 2.2vw, 36px);
          }

          .hwr-panel:first-child {
            background:
              radial-gradient(circle at 0% 0%, rgba(105, 217, 208, .14), transparent 28%),
              radial-gradient(circle at 100% 0%, rgba(102, 88, 220, .12), transparent 30%),
              linear-gradient(145deg, #ffffff, #f7fbff);
          }

          .hwr-panel:hover,
          .hwr-request-card:hover {
            border-color: rgba(102, 88, 220, .28);
            transform: translateY(-3px);
            box-shadow:
              10px 12px 0 #c4ccff,
              0 30px 50px rgba(34, 38, 110, .14);
          }

          .hwr-panel-head {
            display: flex;
            justify-content: space-between;
            gap: 18px;
            align-items: flex-start;
            margin-bottom: 22px;
          }

          .hwr-panel-head h2,
          .hwr-panel-head h3 {
            margin: 0;
            color: var(--hwr-ink);
            font-family: var(--yc-display, Georgia, "Times New Roman", serif);
            font-size: clamp(25px, 2.3vw, 37px);
            font-weight: 760;
            line-height: 1;
            letter-spacing: -.045em;
          }

          .hwr-panel-head p {
            margin: 7px 0 0;
            color: var(--hwr-copy);
            line-height: 1.58;
          }

          .hwr-chip {
            padding: 8px 12px;
            border: 1px solid rgba(102, 88, 220, .20);
            border-radius: 999px;
            color: #40348d;
            background: #f1efff;
            box-shadow: 3px 4px 0 #c9c0ff;
            font-size: 11px;
            font-weight: 900;
            white-space: nowrap;
          }

          .hwr-profile-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 11px;
            margin-bottom: 18px;
          }

          .hwr-profile-grid div,
          .hwr-request-grid div {
            min-width: 0;
            padding: 13px;
            border: 1px solid rgba(162, 169, 196, .46);
            border-radius: 17px;
            background: #edf6ff;
            box-shadow: 3px 4px 0 #b9d7ff;
          }

          .hwr-profile-grid div:nth-child(2n),
          .hwr-request-grid div:nth-child(2n) {
            background: #eaf8f4;
            box-shadow: 3px 4px 0 #aee6d9;
          }

          .hwr-profile-grid div:nth-child(3n),
          .hwr-request-grid div:nth-child(3n) {
            background: #fff4d5;
            box-shadow: 3px 4px 0 #ffe0a5;
          }

          .hwr-profile-grid span,
          .hwr-request-grid span,
          .hwr-reason-box span,
          .hwr-location-box span {
            display: block;
            margin-bottom: 6px;
            color: #5d6785;
            font-size: 9px;
            font-weight: 950;
            letter-spacing: .08em;
            text-transform: uppercase;
          }

          .hwr-profile-grid strong,
          .hwr-request-grid strong {
            display: block;
            color: var(--hwr-ink);
            font-size: 13px;
            overflow-wrap: anywhere;
          }

          .hwr-form {
            display: grid;
            gap: 15px;
          }

          .hwr-field label {
            display: block;
            margin-bottom: 8px;
            color: #303b5b;
            font-size: 11px;
            font-weight: 900;
          }

          .hwr-field select,
          .hwr-field input,
          .hwr-field textarea {
            width: 100%;
            min-height: 49px;
            padding: 0 14px;
            border: 1px solid rgba(151, 161, 197, .58);
            border-radius: 15px;
            outline: 0;
            color: var(--hwr-ink);
            background: rgba(255, 255, 255, .94);
            font-size: 13px;
            transition:
              border-color 170ms ease,
              box-shadow 170ms ease,
              transform 170ms ease;
          }

          .hwr-field textarea {
            min-height: 120px;
            padding: 14px;
            resize: vertical;
          }

          .hwr-field select:focus,
          .hwr-field input:focus,
          .hwr-field textarea:focus {
            border-color: rgba(102, 88, 220, .65);
            box-shadow:
              4px 5px 0 rgba(102, 88, 220, .14),
              0 0 0 4px rgba(102, 88, 220, .08);
            transform: translateY(-1px);
          }

          .hwr-selected-holiday {
            padding: 14px;
            border: 1px solid rgba(102, 88, 220, .22);
            border-radius: 18px;
            color: #40348d;
            background: linear-gradient(145deg, #f1efff, #eef9ff);
            box-shadow: 4px 5px 0 #c9c0ff;
            line-height: 1.48;
          }

          .hwr-selected-holiday strong {
            display: block;
            margin-bottom: 4px;
            color: #312e81;
          }

          .hwr-submit,
          .hwr-filter-form button,
          .hwr-actions button {
            border: 0;
            cursor: pointer;
            border-radius: 15px;
            font-weight: 900;
            transition:
              transform 190ms cubic-bezier(.22,1,.36,1),
              box-shadow 190ms ease,
              filter 190ms ease;
          }

          .hwr-submit {
            min-height: 52px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 9px;
            color: #fff;
            background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
            box-shadow:
              5px 6px 0 #a9d6f5,
              0 14px 25px rgba(36, 74, 128, .16);
          }

          .hwr-submit svg {
            animation: hwrSendFloat 2.8s ease-in-out infinite;
          }

          .hwr-submit:hover,
          .hwr-filter-form button:hover,
          .hwr-actions button:hover {
            transform: translateY(-2px);
            filter: saturate(1.04);
          }

          .hwr-submit:disabled,
          .hwr-refresh:disabled,
          .hwr-actions button:disabled {
            opacity: .68;
            cursor: not-allowed;
            transform: none;
          }

          .hwr-filter-form {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 18px;
            padding: 12px;
            border: 1px solid rgba(171, 181, 211, .55);
            border-radius: 20px;
            background: linear-gradient(145deg, #f8fbff, #f7f4ff);
            box-shadow: 4px 5px 0 rgba(52, 43, 120, .08);
          }

          .hwr-filter-form select,
          .hwr-filter-form input {
            min-height: 44px;
            padding: 0 12px;
            border: 1px solid rgba(151, 161, 197, .58);
            border-radius: 14px;
            color: var(--hwr-ink);
            background: #fff;
          }

          .hwr-filter-form button {
            color: #fff;
            background: #342b78;
            box-shadow: 4px 5px 0 #18b5c8;
          }

          .hwr-list {
            display: grid;
            gap: 16px;
          }

          .hwr-request-card {
            padding: 18px;
            border-radius: 25px;
          }

          .hwr-request-top {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            align-items: flex-start;
            margin-bottom: 15px;
          }

          .hwr-request-id {
            display: inline-flex;
            margin-bottom: 8px;
            padding: 6px 9px;
            border-radius: 999px;
            color: #40348d;
            background: #f1efff;
            box-shadow: 2px 3px 0 #c9c0ff;
            font-size: 9px;
            font-weight: 950;
            letter-spacing: .08em;
            text-transform: uppercase;
          }

          .hwr-request-card h3 {
            margin: 0;
            color: var(--hwr-ink);
            font-family: var(--yc-display, Georgia, "Times New Roman", serif);
            font-size: clamp(20px, 2vw, 28px);
            font-weight: 760;
            letter-spacing: -.035em;
          }

          .hwr-request-card p {
            margin: 5px 0 0;
            color: var(--hwr-copy);
            line-height: 1.55;
          }

          .hwr-status {
            padding: 8px 11px;
            border: 1px solid rgba(171, 181, 211, .62);
            border-radius: 999px;
            color: var(--hwr-copy);
            background: #f8fafc;
            box-shadow: 3px 4px 0 rgba(52, 43, 120, .08);
            font-size: 11px;
            font-weight: 950;
            text-transform: capitalize;
            white-space: nowrap;
          }

          .hwr-status.pending {
            color: #9a6817;
            background: #fff4d5;
            box-shadow: 3px 4px 0 #ffe0a5;
          }

          .hwr-status.approved {
            color: #047857;
            background: #eaf8f4;
            box-shadow: 3px 4px 0 #aee6d9;
          }

          .hwr-status.rejected {
            color: #a2344d;
            background: #fff0f2;
            box-shadow: 3px 4px 0 #f2c2cc;
          }

          .hwr-request-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 12px;
          }

          .hwr-reason-box,
          .hwr-location-box {
            margin-top: 10px;
            padding: 12px;
            border: 1px solid rgba(171, 181, 211, .55);
            border-radius: 16px;
            background: linear-gradient(145deg, #f8fbff, #f7f4ff);
            box-shadow: 3px 4px 0 rgba(52, 43, 120, .08);
          }

          .hwr-reason-box p,
          .hwr-location-box p {
            margin: 0;
            color: var(--hwr-ink);
            overflow-wrap: anywhere;
          }

          .hwr-location-box {
            position: relative;
          }

          .hwr-location-box::before {
            content: "";
            display: inline-block;
            width: 8px;
            height: 8px;
            margin-right: 7px;
            border-radius: 999px;
            background: var(--hwr-teal);
            box-shadow: 0 0 0 4px rgba(52, 201, 196, .10);
          }

          .hwr-meta-line {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-top: 12px;
          }

          .hwr-meta-line span {
            padding: 7px 10px;
            border: 1px solid rgba(171, 181, 211, .55);
            border-radius: 999px;
            color: var(--hwr-copy);
            background: #fff;
            box-shadow: 2px 3px 0 rgba(52, 43, 120, .07);
            font-size: 11px;
            font-weight: 800;
          }

          .hwr-actions {
            display: flex;
            gap: 10px;
            margin-top: 14px;
          }

          .hwr-actions button {
            min-height: 42px;
            padding: 0 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
          }

          .hwr-approve {
            color: #047857;
            background: #eaf8f4;
            box-shadow: 3px 4px 0 #aee6d9;
          }

          .hwr-reject {
            color: #a2344d;
            background: #fff0f2;
            box-shadow: 3px 4px 0 #f2c2cc;
          }

          .hwr-empty {
            padding: 24px;
            border: 1px dashed rgba(102, 88, 220, .34);
            border-radius: 20px;
            color: var(--hwr-copy);
            background: linear-gradient(145deg, #f8f7ff, #effbf8);
            text-align: center;
            font-weight: 800;
            box-shadow: 4px 5px 0 rgba(52, 43, 120, .07);
          }

          @keyframes hwrRefreshIdle {
            0%, 84% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          @keyframes hwrSpin {
            to { transform: rotate(360deg); }
          }

          @keyframes hwrSendFloat {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            50% { transform: translate(3px, -2px) rotate(4deg); }
          }

          @media (max-width: 1180px) {
            .hwr-layout {
              grid-template-columns: 1fr;
            }

            .hwr-request-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 720px) {
            .hwr-page {
              gap: 18px;
            }

            .hwr-hero {
              grid-template-columns: 1fr;
              min-height: 0;
              padding: 20px;
              border-radius: 26px;
              box-shadow:
                6px 7px 0 #c6d8f7,
                0 18px 30px rgba(34, 38, 110, .10);
            }

            .hwr-hero h1 {
              font-size: clamp(36px, 10vw, 52px);
            }

            .hwr-panel-head,
            .hwr-request-top {
              flex-direction: column;
              align-items: stretch;
            }

            .hwr-panel,
            .hwr-request-card {
              padding: 18px;
              border-radius: 22px;
              box-shadow:
                5px 6px 0 #c4ccff,
                0 17px 28px rgba(34, 38, 110, .09);
            }

            .hwr-refresh,
            .hwr-submit,
            .hwr-filter-form button {
              width: 100%;
            }

            .hwr-profile-grid,
            .hwr-filter-form,
            .hwr-request-grid {
              grid-template-columns: 1fr;
            }

            .hwr-actions {
              display: grid;
              grid-template-columns: 1fr;
            }

            .hwr-actions button {
              width: 100%;
            }
          }

          @media (max-width: 430px) {
            .hwr-hero {
              padding: 16px;
            }

            .hwr-hero h1 {
              font-size: clamp(32px, 11vw, 44px);
            }

            .hwr-panel,
            .hwr-request-card {
              padding: 15px;
            }

            .hwr-chip,
            .hwr-status {
              align-self: flex-start;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .hwr-page *,
            .hwr-page *::before,
            .hwr-page *::after {
              animation: none !important;
              transition: none !important;
            }
          }
        `}
      </style>

      <section className="hwr-hero">
        <div>
          <span className="hwr-eyebrow">
            <Sparkles size={13} />
            Holiday Work
          </span>
          <h1>
            Holiday work, <em>clearly managed.</em>
          </h1>
          <p>
            Apply using upcoming holidays only. Your employee profile, Team
            Leader and Reporting Officer details remain auto-filled, while
            approvals and status stay connected in one YourComate workspace.
          </p>
        </div>

        <button
          type="button"
          className="hwr-refresh"
          disabled={loadingPage}
          onClick={refreshPage}
        >
          <RefreshCcw size={16} />
          {loadingPage ? 'Refreshing...' : 'Refresh'}
          <ArrowUpRight size={15} />
        </button>
      </section>

      {message ? <div className="hwr-alert">{message}</div> : null}

      <section className="hwr-layout">
        <div className="hwr-panel">
          <div className="hwr-panel-head">
            <div>
              <span className="hwr-section-kicker">
                <CalendarDays size={12} />
                New Request
              </span>
              <h2>Request Holiday Work</h2>
              <p>Select an upcoming holiday and submit a short reason.</p>
            </div>
            <span className="hwr-chip">Auto-filled</span>
          </div>

          <div className="hwr-profile-grid">
            <div>
              <span>Employee</span>
              <strong>{employeeProfile.employee_name || '—'}</strong>
            </div>

            <div>
              <span>Employee Code</span>
              <strong>{employeeProfile.employee_code || '—'}</strong>
            </div>

            <div>
              <span>Department</span>
              <strong>{employeeProfile.department || '—'}</strong>
            </div>

            <div>
              <span>Designation</span>
              <strong>{employeeProfile.designation || '—'}</strong>
            </div>

            <div>
              <span>Team Leader</span>
              <strong>{employeeProfile.team_leader_name || '—'}</strong>
            </div>

            <div>
              <span>Reporting Officer</span>
              <strong>{employeeProfile.reporting_officer_name || '—'}</strong>
            </div>
          </div>

          <form className="hwr-form" onSubmit={submitRequest}>
            <div className="hwr-field">
              <label>Upcoming Holiday</label>
              <select
                value={form.date}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    date: event.target.value,
                  }))
                }
              >
                {holidayOptions.length ? (
                  holidayOptions.map((holiday) => (
                    <option key={`${holiday.date}-${holiday.title}`} value={holiday.date}>
                      {formatDate(holiday.date)} — {holiday.title}
                    </option>
                  ))
                ) : (
                  <option value="">No upcoming holidays found</option>
                )}
              </select>
            </div>

            {selectedHoliday ? (
              <div className="hwr-selected-holiday">
                <strong>{selectedHoliday.title}</strong>
                {formatDate(selectedHoliday.date)} • {selectedHoliday.holiday_type || 'Holiday'}
                {selectedHoliday.message ? ` • ${selectedHoliday.message}` : ''}
              </div>
            ) : null}

            <div className="hwr-field">
              <label>Work Location</label>
              <input
                type="text"
                value={form.work_location}
                placeholder="Example: Office, project site, field visit location"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    work_location: event.target.value,
                  }))
                }
              />
            </div>

            <div className="hwr-field">
              <label>Reason</label>
              <textarea
                value={form.reason}
                placeholder="Explain why you need to work on this holiday"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    reason: event.target.value,
                  }))
                }
              />
            </div>

            <button
              type="submit"
              className="hwr-submit"
              disabled={submitting || !holidayOptions.length}
            >
              <Send size={16} />
              {submitting ? 'Submitting...' : 'Submit Holiday Work Request'}
            </button>
          </form>
        </div>

        <div className="hwr-panel">
          <div className="hwr-panel-head">
            <div>
              <span className="hwr-section-kicker">
                <UserCheck size={12} />
                {canManage ? 'Approval Queue' : 'Request History'}
              </span>
              <h3>{canManage ? 'Requests & Approvals' : 'My Requests'}</h3>
              <p>
                {canManage
                  ? 'Review employee holiday work requests in a clean approval view.'
                  : 'Track your submitted holiday work requests.'}
              </p>
            </div>
            <span className="hwr-chip">
              {canManage ? `${requests.length} Records` : `${myRequests.length} Records`}
            </span>
          </div>

          {canManage ? (
            <form className="hwr-filter-form" onSubmit={handleFilterSubmit}>
              <select
                value={filters.status}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    status: event.target.value,
                  }))
                }
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <input
                type="date"
                value={filters.date}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    date: event.target.value,
                  }))
                }
              />

              <button type="submit">Search</button>
            </form>
          ) : null}

          <div className="hwr-list">
            {(canManage ? requests : myRequests).length ? (
              (canManage ? requests : myRequests).map((row) => (
                <RequestCard
                  key={row._id}
                  row={row}
                  canManage={canManage}
                  decidingId={decidingId}
                  onDecision={handleDecision}
                />
              ))
            ) : (
              <div className="hwr-empty">
                {loadingPage ? 'Loading requests...' : 'No holiday work requests found.'}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}