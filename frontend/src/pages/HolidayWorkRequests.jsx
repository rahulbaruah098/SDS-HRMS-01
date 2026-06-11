import React, { useEffect, useMemo, useState } from 'react';
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
            {decidingId === row._id ? 'Updating...' : 'Approve'}
          </button>

          <button
            type="button"
            className="hwr-reject"
            disabled={decidingId === row._id}
            onClick={() => onDecision(row, 'rejected')}
          >
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
            display: grid;
            gap: 26px;
          }

          .hwr-hero {
            position: relative;
            overflow: hidden;
            border: 1px solid #E2E8F0;
            border-radius: 32px;
            padding: 34px;
            background:
              radial-gradient(circle at top left, rgba(79, 70, 229, 0.12), transparent 34%),
              radial-gradient(circle at top right, rgba(14, 165, 233, 0.10), transparent 32%),
              linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%);
            box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
            display: flex;
            justify-content: space-between;
            gap: 24px;
          }

          .hwr-eyebrow {
            display: inline-flex;
            padding: 8px 13px;
            border-radius: 999px;
            background: #EEF2FF;
            color: #4338CA;
            font-size: 12px;
            font-weight: 950;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            margin-bottom: 14px;
          }

          .hwr-hero h1 {
            margin: 0;
            color: #0F172A;
            font-size: clamp(34px, 4vw, 52px);
            line-height: 1;
            letter-spacing: -0.06em;
          }

          .hwr-hero p {
            margin: 16px 0 0;
            max-width: 820px;
            color: #64748B;
            font-size: 15px;
            line-height: 1.7;
          }

          .hwr-refresh {
            height: 48px;
            padding: 0 20px;
            border-radius: 16px;
            border: 1px solid #C7D2FE;
            background: #FFFFFF;
            color: #4338CA;
            font-weight: 900;
            cursor: pointer;
            white-space: nowrap;
          }

          .hwr-alert {
            padding: 14px 16px;
            border-radius: 18px;
            border: 1px solid #BFDBFE;
            background: #EFF6FF;
            color: #1D4ED8;
            font-weight: 750;
          }

          .hwr-layout {
            display: grid;
            grid-template-columns: minmax(360px, 0.82fr) minmax(0, 1.18fr);
            gap: 24px;
            align-items: start;
          }

          .hwr-panel {
            border: 1px solid #E2E8F0;
            border-radius: 28px;
            background: #FFFFFF;
            box-shadow: 0 14px 38px rgba(15, 23, 42, 0.07);
            padding: 24px;
            min-width: 0;
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
            color: #0F172A;
            font-size: 24px;
            letter-spacing: -0.035em;
          }

          .hwr-panel-head p {
            margin: 7px 0 0;
            color: #64748B;
            line-height: 1.55;
          }

          .hwr-chip {
            padding: 8px 12px;
            border-radius: 999px;
            background: #F8FAFC;
            color: #475569;
            border: 1px solid #E2E8F0;
            font-size: 12px;
            font-weight: 850;
            white-space: nowrap;
          }

          .hwr-profile-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 18px;
          }

          .hwr-profile-grid div {
            border: 1px solid #E2E8F0;
            background: #F8FAFC;
            border-radius: 18px;
            padding: 13px;
            min-width: 0;
          }

          .hwr-profile-grid span,
          .hwr-request-grid span,
          .hwr-reason-box span,
          .hwr-location-box span {
            display: block;
            color: #64748B;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            margin-bottom: 6px;
          }

          .hwr-profile-grid strong,
          .hwr-request-grid strong {
            display: block;
            color: #0F172A;
            font-size: 14px;
            overflow-wrap: anywhere;
          }

          .hwr-form {
            display: grid;
            gap: 15px;
          }

          .hwr-field label {
            display: block;
            margin-bottom: 8px;
            color: #475569;
            font-size: 13px;
            font-weight: 900;
          }

          .hwr-field select,
          .hwr-field input,
          .hwr-field textarea {
            width: 100%;
            min-height: 48px;
            border-radius: 16px;
            border: 1px solid #CBD5E1;
            background: #FFFFFF;
            color: #0F172A;
            padding: 0 14px;
            outline: none;
            font-size: 14px;
          }

          .hwr-field textarea {
            min-height: 120px;
            padding: 14px;
            resize: vertical;
          }

          .hwr-field select:focus,
          .hwr-field input:focus,
          .hwr-field textarea:focus {
            border-color: #818CF8;
            box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.12);
          }

          .hwr-selected-holiday {
            border: 1px solid #C7D2FE;
            background: #EEF2FF;
            color: #4338CA;
            border-radius: 18px;
            padding: 14px;
            line-height: 1.45;
          }

          .hwr-selected-holiday strong {
            display: block;
            color: #312E81;
            margin-bottom: 4px;
          }

          .hwr-submit {
            min-height: 50px;
            border: 0;
            border-radius: 17px;
            background: linear-gradient(135deg, #4F46E5, #2563EB);
            color: #FFFFFF;
            font-weight: 950;
            cursor: pointer;
            box-shadow: 0 16px 32px rgba(37, 99, 235, 0.22);
          }

          .hwr-submit:disabled,
          .hwr-refresh:disabled {
            opacity: 0.7;
            cursor: not-allowed;
          }

          .hwr-filter-form {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
            padding: 12px;
            border-radius: 20px;
            border: 1px solid #E2E8F0;
            background: #F8FAFC;
            margin-bottom: 18px;
          }

          .hwr-filter-form select,
          .hwr-filter-form input {
            min-height: 44px;
            border-radius: 14px;
            border: 1px solid #CBD5E1;
            background: #FFFFFF;
            color: #0F172A;
            padding: 0 12px;
          }

          .hwr-filter-form button {
            border: 0;
            border-radius: 14px;
            background: #0F172A;
            color: #FFFFFF;
            font-weight: 900;
            cursor: pointer;
          }

          .hwr-list {
            display: grid;
            gap: 14px;
          }

          .hwr-request-card {
            border: 1px solid #E2E8F0;
            border-radius: 24px;
            background: #FFFFFF;
            padding: 18px;
            box-shadow: 0 10px 26px rgba(15, 23, 42, 0.055);
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
            padding: 6px 9px;
            border-radius: 999px;
            background: #EEF2FF;
            color: #4338CA;
            font-size: 10px;
            font-weight: 950;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 8px;
          }

          .hwr-request-card h3 {
            margin: 0;
            color: #0F172A;
            font-size: 20px;
          }

          .hwr-request-card p {
            margin: 5px 0 0;
            color: #64748B;
            line-height: 1.55;
          }

          .hwr-status {
            padding: 8px 11px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 950;
            text-transform: capitalize;
            border: 1px solid #E2E8F0;
            background: #F8FAFC;
            color: #475569;
            white-space: nowrap;
          }

          .hwr-status.pending {
            background: #FFFBEB;
            color: #B45309;
            border-color: #FDE68A;
          }

          .hwr-status.approved {
            background: #ECFDF5;
            color: #047857;
            border-color: #A7F3D0;
          }

          .hwr-status.rejected {
            background: #FFF1F2;
            color: #BE123C;
            border-color: #FECDD3;
          }

          .hwr-request-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 12px;
          }

          .hwr-request-grid div {
            border-radius: 16px;
            border: 1px solid #E2E8F0;
            background: #F8FAFC;
            padding: 12px;
            min-width: 0;
          }

          .hwr-reason-box,
          .hwr-location-box {
            margin-top: 10px;
            border-radius: 16px;
            border: 1px solid #E2E8F0;
            background: #FFFFFF;
            padding: 12px;
          }

          .hwr-reason-box p,
          .hwr-location-box p {
            margin: 0;
            color: #334155;
            overflow-wrap: anywhere;
          }

          .hwr-meta-line {
            margin-top: 12px;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }

          .hwr-meta-line span {
            border-radius: 999px;
            background: #F8FAFC;
            border: 1px solid #E2E8F0;
            color: #64748B;
            padding: 7px 10px;
            font-size: 12px;
            font-weight: 800;
          }

          .hwr-actions {
            display: flex;
            gap: 10px;
            margin-top: 14px;
          }

          .hwr-actions button {
            min-height: 42px;
            border: 0;
            border-radius: 14px;
            padding: 0 16px;
            font-weight: 950;
            cursor: pointer;
          }

          .hwr-approve {
            background: #DCFCE7;
            color: #166534;
          }

          .hwr-reject {
            background: #FFE4E6;
            color: #BE123C;
          }

          .hwr-empty {
            border: 1px dashed #CBD5E1;
            background: #F8FAFC;
            color: #64748B;
            border-radius: 20px;
            padding: 24px;
            text-align: center;
            font-weight: 800;
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

            .hwr-hero,
            .hwr-panel-head,
            .hwr-request-top {
              flex-direction: column;
              align-items: stretch;
            }

            .hwr-hero,
            .hwr-panel {
              padding: 20px;
              border-radius: 24px;
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
          }
        `}
      </style>

      <section className="hwr-hero">
        <div>
          <span className="hwr-eyebrow">Holiday Work</span>
          <h1>Holiday Work Requests</h1>
          <p>
            Apply for holiday work using upcoming holiday dates only. Employee
            details, team leader and reporting officer information are taken from
            your profile automatically, so no internal ID entry is required.
          </p>
        </div>

        <button
          type="button"
          className="hwr-refresh"
          disabled={loadingPage}
          onClick={refreshPage}
        >
          {loadingPage ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      {message ? <div className="hwr-alert">{message}</div> : null}

      <section className="hwr-layout">
        <div className="hwr-panel">
          <div className="hwr-panel-head">
            <div>
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
              {submitting ? 'Submitting...' : 'Submit Holiday Work Request'}
            </button>
          </form>
        </div>

        <div className="hwr-panel">
          <div className="hwr-panel-head">
            <div>
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