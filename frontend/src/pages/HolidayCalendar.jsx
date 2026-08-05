import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Filter,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api/client';

const FALLBACK_STATES = [
  'Assam(HO)',
  'Manipur',
  'Mizoram',
  'Arunachal Pradesh',
];

const EMPTY_FORM = {
  state: 'Assam(HO)',
  date: '',
  title: '',
  message: '',
  status: 'active',
};

const EMPTY_FILTERS = {
  state: '',
  date_from: '',
  date_to: '',
  search: '',
};

function normalizeRole(role = '') {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function getUserRoles(user = {}) {
  if (Array.isArray(user.roles)) {
    return user.roles.map(normalizeRole).filter(Boolean);
  }

  if (typeof user.roles === 'string') {
    return user.roles
      .split(',')
      .map(normalizeRole)
      .filter(Boolean);
  }

  const role = normalizeRole(user.role);
  return role ? [role] : [];
}

function hasManageAccess(user = {}) {
  const roles = getUserRoles(user);

  return roles.some((role) =>
    [
      'super_admin',
      'admin',
      'hr_admin',
      'hr_manager',
      'hr',
    ].includes(role),
  );
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    const cleanValue = String(value ?? '').trim();

    if (!cleanValue) return;

    query.append(key, cleanValue);
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

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

function statusLabel(value = '') {
  const status = String(value || 'active').toLowerCase();

  if (status === 'active') return 'Active';
  if (status === 'inactive') return 'Inactive';

  return status
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeHoliday(row = {}) {
  return {
    _id: row._id || row.id || '',
    state: row.state || '—',
    date: row.date || '',
    title: row.title || '—',
    message: row.message || '',
    status: row.status || 'active',
    created_by_name:
      row.created_by_name ||
      row.created_by_display_name ||
      row.created_by_user_name ||
      row.created_by_email ||
      'System',
  };
}

function isUpcoming(dateValue = '') {
  if (!dateValue) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const date = new Date(dateValue);
  date.setHours(0, 0, 0, 0);

  return date >= today;
}


function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getMonthLabel(date) {
  return date.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

function getSecondAndFourthSaturdayKeys(year, monthIndex) {
  const saturdayKeys = [];

  const totalDays = new Date(year, monthIndex + 1, 0).getDate();

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(year, monthIndex, day);

    if (date.getDay() === 6) {
      saturdayKeys.push(toDateKey(date));
    }
  }

  return {
    secondSaturday: saturdayKeys[1] || '',
    fourthSaturday: saturdayKeys[3] || '',
  };
}

function buildCalendarDays(monthDate, holidayMap = {}) {
  const year = monthDate.getFullYear();
  const monthIndex = monthDate.getMonth();

  const firstDay = new Date(year, monthIndex, 1);
  const totalDays = new Date(year, monthIndex + 1, 0).getDate();
  const startOffset = firstDay.getDay();

  const { secondSaturday, fourthSaturday } = getSecondAndFourthSaturdayKeys(
    year,
    monthIndex,
  );

  const cells = [];

  for (let blank = 0; blank < startOffset; blank += 1) {
    cells.push({
      key: `blank-${blank}`,
      day: '',
      dateKey: '',
      type: 'blank',
      label: '',
      holiday: null,
    });
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(year, monthIndex, day);
    const dateKey = toDateKey(date);
    const weekday = date.getDay();

    const manualHoliday = holidayMap[dateKey];

    let type = 'working';
    let label = 'Working Day';

    if (manualHoliday) {
      type = 'manual';
      label = manualHoliday.title || 'Holiday';
    } else if (weekday === 0) {
      type = 'sunday';
      label = 'Sunday Holiday';
    } else if (dateKey === secondSaturday) {
      type = 'second-saturday';
      label = '2nd Saturday Holiday';
    } else if (dateKey === fourthSaturday) {
      type = 'fourth-saturday';
      label = '4th Saturday Holiday';
    }

    cells.push({
      key: dateKey,
      day,
      dateKey,
      type,
      label,
      holiday: manualHoliday || null,
    });
  }

  return cells;
}

export default function HolidayCalendar({ user = {} }) {
  const canManage = hasManageAccess(user);

  const [states, setStates] = useState(FALLBACK_STATES);
  const [defaultState, setDefaultState] = useState('');
  const [items, setItems] = useState([]);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const filteredItems = useMemo(() => {
    const keyword = String(filters.search || '').trim().toLowerCase();

    if (!keyword) {
      return items;
    }

    return items.filter((item) => {
      return [
        item.state,
        item.date,
        item.title,
        item.created_by_name,
        statusLabel(item.status),
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [items, filters.search]);

  const upcomingCount = useMemo(() => {
    return items.filter((item) => isUpcoming(item.date)).length;
  }, [items]);

  const holidayMap = useMemo(() => {
    return items.reduce((acc, item) => {
      if (item.date) {
        acc[item.date] = item;
      }

      return acc;
    }, {});
  }, [items]);

  const calendarDays = useMemo(() => {
    return buildCalendarDays(calendarMonth, holidayMap);
  }, [calendarMonth, holidayMap]);

  const currentStateLabel = filters.state || defaultState || 'All States';

  function updateFilter(key, value) {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function updateForm(key, value) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function resetForm() {
    setEditingId('');
    setForm({
      ...EMPTY_FORM,
      state: defaultState || states[0] || 'Assam(HO)',
    });
  }


  function goToPreviousMonth() {
    setCalendarMonth((prev) => {
      return new Date(prev.getFullYear(), prev.getMonth() - 1, 1);
    });
  }

  function goToNextMonth() {
    setCalendarMonth((prev) => {
      return new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
    });
  }

  function goToCurrentMonth() {
    setCalendarMonth(new Date());
  }

  async function loadHolidays(nextFilters = filters) {
    setLoading(true);
    setError('');

    try {
      const data = await api(
        `/attendance/holidays${buildQuery({
          state: nextFilters.state,
          date_from: nextFilters.date_from,
          date_to: nextFilters.date_to,
        })}`,
      );

      const nextStates = Array.isArray(data.states) && data.states.length
        ? data.states
        : FALLBACK_STATES;

      const nextDefaultState = data.default_state || nextStates[0] || 'Assam(HO)';

      setStates(nextStates);
      setDefaultState(nextDefaultState);
      setItems((data.items || []).map(normalizeHoliday));

      setForm((prev) => ({
        ...prev,
        state: prev.state || nextDefaultState,
      }));
    } catch (err) {
      setError(err?.message || 'Unable to load holiday calendar.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!canManage) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const payload = {
        state: form.state,
        date: form.date,
        title: form.title,
        message: form.message,
        status: form.status || 'active',
      };

      if (editingId) {
        await api(`/attendance/holidays/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });

        setMessage('Holiday updated successfully.');
      } else {
        await api('/attendance/holidays', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        setMessage('Holiday added successfully.');
      }

      resetForm();
      await loadHolidays();
    } catch (err) {
      setError(err?.message || 'Unable to save holiday.');
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(item) {
    if (!canManage) return;

    setEditingId(item._id);
    setForm({
      state: item.state || defaultState || states[0] || 'Assam(HO)',
      date: item.date || '',
      title: item.title || '',
      message: item.message || '',
      status: item.status || 'active',
    });

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  async function handleDelete(item) {
    if (!canManage || !item?._id) return;

    const confirmed = window.confirm(
      `Delete holiday "${item.title}" for ${item.state}?`,
    );

    if (!confirmed) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await api(`/attendance/holidays/${item._id}`, {
        method: 'DELETE',
      });

      setMessage('Holiday deleted successfully.');
      await loadHolidays();
    } catch (err) {
      setError(err?.message || 'Unable to delete holiday.');
    } finally {
      setSaving(false);
    }
  }

  function applyFilters() {
    loadHolidays(filters);
  }

  function clearFilters() {
    const nextFilters = { ...EMPTY_FILTERS };
    setFilters(nextFilters);
    loadHolidays(nextFilters);
  }

  useEffect(() => {
    loadHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="holiday-page">
      <style>{`
        .holiday-page {
          --hc-ink: #101a3a;
          --hc-copy: #5d6d8d;
          --hc-violet: #6658dc;
          --hc-violet-deep: #40348d;
          --hc-blue: #3766db;
          --hc-cyan: #18b5c8;
          --hc-teal: #34c9c4;
          --hc-yellow: #d8ff43;
          --hc-danger: #d84d68;
          --hc-line: rgba(16, 26, 58, .14);
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          color: var(--hc-ink);
        }

        .holiday-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: clamp(22px, 3vw, 40px);
          align-items: center;
          min-height: 270px;
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

        .holiday-hero::before {
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

        .holiday-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          margin-bottom: 15px;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          box-shadow: 4px 5px 0 #18b5c8;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .holiday-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--hc-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 77px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .holiday-hero h1 em {
          color: var(--hc-violet);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .holiday-hero p {
          max-width: 820px;
          margin: 17px 0 0;
          color: var(--hc-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .holiday-hero-card {
          min-width: 190px;
          padding: 20px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 24px;
          background: #f1efff;
          box-shadow:
            7px 9px 0 #c9c0ff,
            0 18px 30px rgba(34, 38, 110, .09);
          text-align: center;
        }

        .holiday-hero-card span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .10em;
          text-transform: uppercase;
        }

        .holiday-hero-card strong {
          display: block;
          margin-top: 8px;
          color: var(--hc-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(34px, 3vw, 48px);
          line-height: 1;
        }

        .holiday-hero-card small {
          display: block;
          margin-top: 7px;
          color: var(--hc-copy);
          font-weight: 800;
        }

        .holiday-alert {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          border-radius: 18px;
          border: 1px solid;
          font-weight: 850;
          box-shadow: 4px 5px 0 rgba(52, 43, 120, .08);
        }

        .holiday-alert.success {
          color: #047857;
          background: #eaf8f4;
          border-color: rgba(52, 201, 196, .36);
          box-shadow: 4px 5px 0 #aee6d9;
        }

        .holiday-alert.error {
          color: #a2344d;
          background: #fff0f2;
          border-color: rgba(216, 77, 104, .28);
          box-shadow: 4px 5px 0 #f2c2cc;
        }

        .holiday-toolbar,
        .holiday-filter-card,
        .holiday-calendar-card,
        .holiday-form-card,
        .holiday-list-card {
          border: 1px solid rgba(171, 181, 211, .70);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34, 38, 110, .10);
        }

        .holiday-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          padding: 15px;
          border-radius: 24px;
        }

        .holiday-search {
          min-width: min(430px, 100%);
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 14px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 999px;
          background: rgba(255, 255, 255, .94);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .08);
        }

        .holiday-search svg {
          color: var(--hc-violet);
        }

        .holiday-search input {
          width: 100%;
          border: 0;
          outline: 0;
          background: transparent;
          padding: 13px 0;
          color: var(--hc-ink);
          font-weight: 700;
        }

        .holiday-refresh-btn,
        .holiday-filter-actions button,
        .holiday-calendar-actions button,
        .holiday-save-btn,
        .holiday-cancel-btn,
        .holiday-row-actions button {
          border: 0;
          cursor: pointer;
          border-radius: 15px;
          font-weight: 900;
          transition:
            transform 190ms cubic-bezier(.22,1,.36,1),
            box-shadow 190ms ease,
            filter 190ms ease;
        }

        .holiday-refresh-btn {
          min-height: 46px;
          padding: 0 15px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36, 74, 128, .16);
        }

        .holiday-refresh-btn:hover,
        .holiday-filter-actions button:hover,
        .holiday-calendar-actions button:hover,
        .holiday-save-btn:hover,
        .holiday-cancel-btn:hover,
        .holiday-row-actions button:hover {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .holiday-refresh-btn svg:first-child:not(.spin) {
          animation: holidayRefreshIdle 4.2s linear infinite;
        }

        .holiday-filter-card,
        .holiday-calendar-card,
        .holiday-form-card,
        .holiday-list-card {
          padding: clamp(20px, 2vw, 28px);
          border-radius: clamp(26px, 2.2vw, 36px);
          transition:
            transform 210ms cubic-bezier(.22,1,.36,1),
            box-shadow 210ms ease,
            border-color 210ms ease;
        }

        .holiday-filter-card:hover,
        .holiday-calendar-card:hover,
        .holiday-form-card:hover,
        .holiday-list-card:hover {
          border-color: rgba(102, 88, 220, .28);
          transform: translateY(-3px);
          box-shadow:
            10px 12px 0 #c4ccff,
            0 30px 50px rgba(34, 38, 110, .14);
        }

        .holiday-section-title {
          display: flex;
          align-items: flex-start;
          gap: 11px;
          color: var(--hc-violet);
        }

        .holiday-section-title > svg {
          margin-top: 2px;
          flex: 0 0 auto;
        }

        .holiday-section-title h3 {
          margin: 0;
          color: var(--hc-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 2.3vw, 37px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .holiday-section-title p {
          margin: 7px 0 0;
          color: var(--hc-copy);
          line-height: 1.55;
        }

        .holiday-filter-grid,
        .holiday-form-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-top: 18px;
        }

        .holiday-filter-grid label,
        .holiday-form-grid label {
          display: grid;
          gap: 8px;
          min-width: 0;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .holiday-filter-grid input,
        .holiday-filter-grid select,
        .holiday-form-grid input,
        .holiday-form-grid select,
        .holiday-form-grid textarea {
          width: 100%;
          min-width: 0;
          min-height: 48px;
          padding: 0 13px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 15px;
          outline: 0;
          color: var(--hc-ink);
          background: rgba(255, 255, 255, .94);
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease;
        }

        .holiday-form-grid textarea {
          min-height: 120px;
          padding: 13px;
          resize: vertical;
        }

        .holiday-filter-grid input:focus,
        .holiday-filter-grid select:focus,
        .holiday-form-grid input:focus,
        .holiday-form-grid select:focus,
        .holiday-form-grid textarea:focus {
          border-color: rgba(102, 88, 220, .65);
          box-shadow:
            4px 5px 0 rgba(102, 88, 220, .14),
            0 0 0 4px rgba(102, 88, 220, .08);
          transform: translateY(-1px);
        }

        .holiday-filter-actions {
          display: flex;
          align-items: end;
          gap: 8px;
        }

        .holiday-filter-actions button {
          min-height: 48px;
          padding: 0 15px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .holiday-filter-actions button:first-child {
          color: #fff;
          background: #342b78;
          box-shadow: 4px 5px 0 #18b5c8;
        }

        .holiday-calendar-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          flex-wrap: wrap;
        }

        .holiday-calendar-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .holiday-calendar-actions button {
          min-width: 38px;
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .holiday-calendar-actions button.today {
          padding-inline: 13px;
          color: #fff;
          background: #342b78;
          box-shadow: 4px 5px 0 #18b5c8;
        }

        .holiday-calendar-actions strong {
          min-width: 150px;
          color: var(--hc-ink);
          text-align: center;
          font-family: Georgia, "Times New Roman", serif;
          font-size: 18px;
        }

        .holiday-calendar-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 18px;
        }

        .holiday-calendar-legend span {
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          box-shadow: 2px 3px 0 rgba(52, 43, 120, .07);
        }

        .holiday-calendar-legend .manual {
          color: #40348d;
          background: #f1efff;
        }

        .holiday-calendar-legend .sunday {
          color: #a2344d;
          background: #fff0f2;
        }

        .holiday-calendar-legend .second-saturday {
          color: #245da8;
          background: #edf6ff;
        }

        .holiday-calendar-legend .fourth-saturday {
          color: #9a6817;
          background: #fff4d5;
        }

        .holiday-calendar-legend .working {
          color: #047857;
          background: #eaf8f4;
        }

        .holiday-calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 8px;
        }

        .holiday-calendar-weekdays {
          margin-top: 16px;
        }

        .holiday-calendar-weekdays span {
          padding: 10px 6px;
          color: #5d6785;
          text-align: center;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .holiday-calendar-days {
          margin-top: 4px;
        }

        .holiday-calendar-day {
          min-height: 96px;
          padding: 10px;
          border: 1px solid rgba(171, 181, 211, .56);
          border-radius: 17px;
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .07);
          transition:
            transform 170ms ease,
            box-shadow 170ms ease;
        }

        .holiday-calendar-day:not(.blank):hover {
          transform: translateY(-2px);
        }

        .holiday-calendar-day.blank {
          opacity: 0;
          pointer-events: none;
        }

        .holiday-calendar-day strong {
          display: block;
          color: var(--hc-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: 20px;
        }

        .holiday-calendar-day span {
          display: block;
          margin-top: 8px;
          color: var(--hc-copy);
          font-size: 10px;
          font-weight: 750;
          line-height: 1.35;
        }

        .holiday-calendar-day.manual {
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .holiday-calendar-day.sunday {
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .holiday-calendar-day.second-saturday {
          background: #edf6ff;
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .holiday-calendar-day.fourth-saturday {
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .holiday-calendar-day.working {
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .holiday-message-field {
          grid-column: 1 / -1;
        }

        .holiday-form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 18px;
        }

        .holiday-save-btn,
        .holiday-cancel-btn {
          min-height: 46px;
          padding: 0 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .holiday-save-btn {
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36, 74, 128, .16);
        }

        .holiday-cancel-btn {
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .holiday-table-wrap {
          margin-top: 18px;
          overflow-x: auto;
          border: 1px solid rgba(171, 181, 211, .56);
          border-radius: 18px;
          background: #fff;
          box-shadow: 4px 5px 0 rgba(52, 43, 120, .08);
        }

        .holiday-table {
          width: 100%;
          border-collapse: collapse;
        }

        .holiday-table th,
        .holiday-table td {
          padding: 13px 14px;
          border-bottom: 1px solid rgba(171, 181, 211, .42);
          text-align: left;
          vertical-align: middle;
        }

        .holiday-table th {
          color: #536381;
          background: linear-gradient(180deg, #f8f8ff, #f4f8fb);
          font-size: 10px;
          font-weight: 950;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .holiday-table td {
          color: var(--hc-copy);
          font-size: 13px;
        }

        .holiday-table tbody tr:hover td {
          background: #fafaff;
        }

        .holiday-title-cell strong,
        .holiday-table td > strong {
          color: var(--hc-ink);
        }

        .holiday-status {
          display: inline-flex;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
        }

        .holiday-status.active {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 2px 3px 0 #aee6d9;
        }

        .holiday-status.inactive {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 2px 3px 0 #f2c2cc;
        }

        .holiday-row-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .holiday-row-actions button {
          min-height: 36px;
          padding: 0 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
        }

        .holiday-row-actions button.delete {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 2px 3px 0 #f2c2cc;
        }

        .holiday-mobile-list {
          display: none;
        }

        .holiday-mobile-card {
          padding: 15px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 20px;
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow: 5px 6px 0 #c4ccff;
        }

        .holiday-mobile-card > div:first-child span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .holiday-mobile-card > div:first-child strong {
          display: block;
          margin-top: 6px;
          color: var(--hc-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: 20px;
        }

        .holiday-mobile-card p {
          color: var(--hc-copy);
        }

        .holiday-mobile-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          color: var(--hc-copy);
          font-size: 12px;
        }

        .holiday-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-height: 120px;
          margin-top: 18px;
          padding: 22px;
          border: 1px dashed rgba(102, 88, 220, .34);
          border-radius: 22px;
          color: var(--hc-copy);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          text-align: center;
          font-weight: 800;
          box-shadow: 4px 5px 0 rgba(52, 43, 120, .07);
        }

        .spin {
          animation: holidaySpin 1s linear infinite;
        }

        @keyframes holidayRefreshIdle {
          0%, 84% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes holidaySpin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 1100px) {
          .holiday-filter-grid,
          .holiday-form-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .holiday-message-field {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 760px) {
          .holiday-page {
            gap: 18px;
          }

          .holiday-hero {
            grid-template-columns: 1fr;
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow:
              6px 7px 0 #c6d8f7,
              0 18px 30px rgba(34, 38, 110, .10);
          }

          .holiday-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .holiday-hero-card {
            width: 100%;
            min-width: 0;
          }

          .holiday-toolbar,
          .holiday-filter-card,
          .holiday-calendar-card,
          .holiday-form-card,
          .holiday-list-card {
            border-radius: 22px;
            box-shadow:
              5px 6px 0 #c4ccff,
              0 17px 28px rgba(34, 38, 110, .09);
          }

          .holiday-toolbar {
            align-items: stretch;
          }

          .holiday-refresh-btn {
            width: 100%;
          }

          .holiday-calendar-head {
            align-items: stretch;
          }

          .holiday-calendar-actions {
            width: 100%;
            justify-content: space-between;
          }

          .holiday-calendar-actions strong {
            flex: 1;
            min-width: 0;
          }

          .holiday-calendar-grid {
            gap: 5px;
          }

          .holiday-calendar-day {
            min-height: 76px;
            padding: 7px;
            border-radius: 13px;
          }

          .holiday-calendar-day strong {
            font-size: 17px;
          }

          .holiday-calendar-day span {
            font-size: 8px;
          }

          .holiday-table-wrap {
            display: none;
          }

          .holiday-mobile-list {
            display: grid;
            gap: 13px;
            margin-top: 18px;
          }

          .holiday-form-actions {
            flex-direction: column-reverse;
          }

          .holiday-form-actions button {
            width: 100%;
          }
        }

        @media (max-width: 520px) {
          .holiday-filter-grid,
          .holiday-form-grid {
            grid-template-columns: 1fr;
          }

          .holiday-message-field {
            grid-column: auto;
          }

          .holiday-filter-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }

          .holiday-filter-actions button {
            width: 100%;
          }

          .holiday-calendar-weekdays span {
            font-size: 8px;
            padding-inline: 2px;
          }

          .holiday-calendar-day {
            min-height: 64px;
            padding: 5px;
          }

          .holiday-calendar-day strong {
            font-size: 15px;
          }

          .holiday-calendar-day span {
            margin-top: 5px;
            font-size: 6.8px;
            line-height: 1.2;
          }
        }

        @media (max-width: 390px) {
          .holiday-hero {
            padding: 16px;
          }

          .holiday-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .holiday-filter-card,
          .holiday-calendar-card,
          .holiday-form-card,
          .holiday-list-card {
            padding: 15px;
          }

          .holiday-calendar-actions {
            display: grid;
            grid-template-columns: 38px 1fr 38px;
          }

          .holiday-calendar-actions .today {
            grid-column: 1 / -1;
            width: 100%;
          }

          .holiday-calendar-grid {
            gap: 4px;
          }

          .holiday-calendar-day {
            min-height: 58px;
            padding: 4px;
            border-radius: 10px;
          }

          .holiday-calendar-day span {
            display: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .holiday-page *,
          .holiday-page *::before,
          .holiday-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
      <div className="holiday-hero">
        <div>
          <span className="holiday-eyebrow">
            <Sparkles size={14} />
            Holiday Calendar
          </span>

          <h1>
            Holidays, <em>beautifully organised.</em>
          </h1>

          <p>
            View tenant holidays, state-wise schedules, Sundays, second and
            fourth Saturdays, and declared holidays from one connected
            YourComate calendar.
          </p>
        </div>

        <div className="holiday-hero-card">
          <span>Total Holidays</span>
          <strong>{items.length}</strong>
          <small>{upcomingCount} upcoming</small>
        </div>
      </div>

      {(message || error) && (
        <div className={`holiday-alert ${error ? 'error' : 'success'}`}>
          {error ? <X size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || message}</span>
        </div>
      )}

      <div className="holiday-toolbar">
        <div className="holiday-search">
          <Search size={18} />
          <input
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            placeholder="Search holiday, state, date, added by..."
          />
        </div>

        <button
          type="button"
          className="holiday-refresh-btn"
          onClick={() => loadHolidays()}
          disabled={loading}
        >
          {loading ? <Loader2 size={17} className="spin" /> : <RefreshCcw size={17} />}
          Refresh
          <ArrowUpRight size={15} />
        </button>
      </div>

      <div className="holiday-filter-card">
        <div className="holiday-section-title">
          <Filter size={18} />
          <div>
            <h3>Filter Holidays</h3>
            <p>Current view: {currentStateLabel}</p>
          </div>
        </div>

        <div className="holiday-filter-grid">
          <label>
            State
            <select
              value={filters.state}
              onChange={(event) => updateFilter('state', event.target.value)}
            >
              <option value="">Default / All</option>
              {states.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </label>

          <label>
            From Date
            <input
              type="date"
              value={filters.date_from}
              onChange={(event) => updateFilter('date_from', event.target.value)}
            />
          </label>

          <label>
            To Date
            <input
              type="date"
              value={filters.date_to}
              onChange={(event) => updateFilter('date_to', event.target.value)}
            />
          </label>

          <div className="holiday-filter-actions">
            <button type="button" onClick={applyFilters} disabled={loading}>
              Apply
            </button>

            <button type="button" onClick={clearFilters} disabled={loading}>
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="holiday-calendar-card">
        <div className="holiday-calendar-head">
          <div className="holiday-section-title">
            <CalendarDays size={18} />
            <div>
              <h3>Monthly Holiday Calendar</h3>
              <p>
                Sundays, 2nd Saturday, 4th Saturday and declared holidays are
                highlighted separately.
              </p>
            </div>
          </div>

          <div className="holiday-calendar-actions">
            <button type="button" onClick={goToPreviousMonth}>
              <ChevronLeft size={17} />
            </button>

            <strong>{getMonthLabel(calendarMonth)}</strong>

            <button type="button" onClick={goToNextMonth}>
              <ChevronRight size={17} />
            </button>

            <button type="button" className="today" onClick={goToCurrentMonth}>
              Today
            </button>
          </div>
        </div>

        <div className="holiday-calendar-legend">
          <span className="manual">Declared Holiday</span>
          <span className="sunday">Sunday</span>
          <span className="second-saturday">2nd Saturday</span>
          <span className="fourth-saturday">4th Saturday</span>
          <span className="working">Working Day</span>
        </div>

        <div className="holiday-calendar-grid holiday-calendar-weekdays">
          <span>Sun</span>
          <span>Mon</span>
          <span>Tue</span>
          <span>Wed</span>
          <span>Thu</span>
          <span>Fri</span>
          <span>Sat</span>
        </div>

        <div className="holiday-calendar-grid holiday-calendar-days">
          {calendarDays.map((cell) => (
            <div
              key={cell.key}
              className={`holiday-calendar-day ${cell.type}`}
              title={cell.label}
            >
              {cell.day && (
                <>
                  <strong>{cell.day}</strong>
                  <span>{cell.label}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {canManage && (
        <form className="holiday-form-card" onSubmit={handleSubmit}>
          <div className="holiday-section-title">
            <Plus size={18} />
            <div>
              <h3>{editingId ? 'Update Holiday' : 'Add Holiday'}</h3>
              <p>Only tenant Admin and HR users can create or modify holidays.</p>
            </div>
          </div>

          <div className="holiday-form-grid">
            <label>
              State *
              <select
                value={form.state}
                onChange={(event) => updateForm('state', event.target.value)}
                required
              >
                {states.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date *
              <input
                type="date"
                value={form.date}
                onChange={(event) => updateForm('date', event.target.value)}
                required
              />
            </label>

            <label>
              Title *
              <input
                value={form.title}
                onChange={(event) => updateForm('title', event.target.value)}
                placeholder="Example: Bohag Bihu"
                required
              />
            </label>

            <label>
              Status
              <select
                value={form.status}
                onChange={(event) => updateForm('status', event.target.value)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>

            <label className="holiday-message-field">
              Message
              <textarea
                value={form.message}
                onChange={(event) => updateForm('message', event.target.value)}
                placeholder="Short note for employees..."
                rows={4}
              />
            </label>
          </div>

          <div className="holiday-form-actions">
            {editingId && (
              <button
                type="button"
                className="holiday-cancel-btn"
                onClick={resetForm}
                disabled={saving}
              >
                Cancel
              </button>
            )}

            <button type="submit" className="holiday-save-btn" disabled={saving}>
              {saving ? <Loader2 size={17} className="spin" /> : null}
              {editingId ? 'Update Holiday' : 'Create Holiday'}
            </button>
          </div>
        </form>
      )}

      <div className="holiday-list-card">
        <div className="holiday-section-title">
          <CalendarDays size={18} />
          <div>
            <h3>Holiday List</h3>
            <p>
              Showing {filteredItems.length} record
              {filteredItems.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="holiday-empty">
            <Loader2 size={24} className="spin" />
            Loading holidays...
          </div>
        ) : filteredItems.length ? (
          <>
            <div className="holiday-table-wrap">
              <table className="holiday-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Holiday</th>
                    <th>State</th>
                    <th>Status</th>
                    <th>Created By</th>
                    {canManage && <th>Action</th>}
                  </tr>
                </thead>

                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item._id || `${item.state}-${item.date}-${item.title}`}>
                      <td>
                        <strong>{formatDate(item.date)}</strong>
                      </td>

                      <td>
                        <div className="holiday-title-cell">
                          <strong>{item.title}</strong>
                        </div>
                      </td>

                      <td>{item.state}</td>

                      <td>
                        <span className={`holiday-status ${item.status}`}>
                          {statusLabel(item.status)}
                        </span>
                      </td>

                      <td>{item.created_by_name}</td>

                      {canManage && (
                        <td>
                          <div className="holiday-row-actions">
                            <button
                              type="button"
                              onClick={() => handleEdit(item)}
                              title="Edit holiday"
                            >
                              <Edit3 size={15} />
                              Edit
                            </button>

                            <button
                              type="button"
                              className="delete"
                              onClick={() => handleDelete(item)}
                              title="Delete holiday"
                            >
                              <Trash2 size={15} />
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="holiday-mobile-list">
              {filteredItems.map((item) => (
                <article
                  className="holiday-mobile-card"
                  key={`mobile-${item._id || `${item.state}-${item.date}-${item.title}`}`}
                >
                  <div>
                    <span>{formatDate(item.date)}</span>
                    <strong>{item.title}</strong>
                  </div>

                  <p>{item.state}</p>

                  <div className="holiday-mobile-meta">
                    <span className={`holiday-status ${item.status}`}>
                      {statusLabel(item.status)}
                    </span>
                    <span>Created by {item.created_by_name}</span>
                  </div>

                  {canManage && (
                    <div className="holiday-row-actions">
                      <button type="button" onClick={() => handleEdit(item)}>
                        <Edit3 size={15} />
                        Edit
                      </button>

                      <button
                        type="button"
                        className="delete"
                        onClick={() => handleDelete(item)}
                      >
                        <Trash2 size={15} />
                        Delete
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="holiday-empty">
            <CalendarDays size={26} />
            No holiday records found.
          </div>
        )}
      </div>
    </section>
  );
}