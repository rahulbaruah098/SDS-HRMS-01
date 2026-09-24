import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
  XCircle,
} from 'lucide-react';
import { api } from '../api/client';

const FALLBACK_STATES = [
  'Assam(HO)',
  'Manipur',
  'Mizoram',
  'Arunachal Pradesh',
  'Tripura',
];

const EMPTY_FORM = {
  state: '',
  date_type: 'single_day',
  date: '',
  start_date: '',
  end_date: '',
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

const HOLIDAY_NOTICE_HIDE_MS = 3600;
const HOLIDAY_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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
  const startDate = row.start_date || row.from_date || row.date || '';
  const endDate = row.end_date || row.to_date || startDate;
  const dateType =
    row.date_type ||
    row.holiday_date_type ||
    (startDate && endDate && startDate !== endDate ? 'date_range' : 'single_day');

  return {
    _id: row._id || row.id || '',
    state: row.state || '—',
    date: startDate,
    start_date: startDate,
    end_date: endDate,
    date_type: dateType,
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

function parseDateKey(value = '') {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) return null;

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKeysInRange(startValue = '', endValue = '') {
  const start = parseDateKey(startValue);
  const end = parseDateKey(endValue || startValue);

  if (!start || !end || end < start) return [];

  const keys = [];
  const cursor = new Date(start);
  let guard = 0;

  while (cursor <= end && guard < 370) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  return keys;
}

function formatHolidayDate(item = {}) {
  const startDate = item.start_date || item.date || '';
  const endDate = item.end_date || startDate;

  if (!startDate) return '—';
  if (!endDate || endDate === startDate) return formatDate(startDate);

  return `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

function isUpcomingHoliday(item = {}) {
  const dateValue = item.end_date || item.start_date || item.date || '';
  if (!dateValue) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const holidayEnd = parseDateKey(dateValue) || new Date(dateValue);
  holidayEnd.setHours(0, 0, 0, 0);

  return holidayEnd >= today;
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

function holidayPageNumbers(pageCount, page) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const current = Math.max(1, Math.min(pageCount, page));
  const pages = new Set([1, pageCount, current]);

  if (current > 2) pages.add(current - 1);
  if (current < pageCount - 1) pages.add(current + 1);

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const output = [];

  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];

    if (index > 0 && value - previous > 1) {
      output.push(`ellipsis-${previous}-${value}`);
    }

    output.push(value);
  });

  return output;
}

function HolidayInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`holiday-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="holiday-inline-feedback-icon">
        {message.loading ? (
          <Loader2 size={15} className="spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="holiday-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="holiday-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function HolidayPagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}) {
  const pageCount = Math.max(
    1,
    Math.ceil(Number(total || 0) / Math.max(1, Number(pageSize || 10))),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);

  if (!total) return null;

  return (
    <div className="holiday-pagination">
      <div className="holiday-pagination-copy">
        <strong>{Number(total || 0).toLocaleString('en-IN')}</strong>
        <span>holidays</span>
      </div>

      <div className="holiday-pagination-controls">
        <label className="holiday-page-size">
          <span>View</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Holidays per page"
          >
            {HOLIDAY_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="holiday-page-button holiday-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="holiday-page-numbers" aria-label="Pagination">
          {holidayPageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`holiday-page-number ${
                  item === safePage ? 'is-active' : ''
                }`}
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span key={item} className="holiday-page-ellipsis">
                …
              </span>
            ),
          )}
        </div>

        <span className="holiday-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="holiday-page-button holiday-page-nav"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
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
  const [deleting, setDeleting] = useState(false);

  const [activeSection, setActiveSection] = useState('calendar');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [feedbackMap, setFeedbackMap] = useState({});
  const feedbackTimersRef = useRef({});

  function clearFeedback(scopeKey) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scopeKey)) {
        return current;
      }

      const next = { ...current };
      delete next[scopeKey];
      return next;
    });
  }

  function showFeedback(
    scopeKey,
    type,
    text,
    title = '',
    options = {},
  ) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => ({
      ...current,
      [scopeKey]: {
        type,
        text,
        title,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      feedbackTimersRef.current[scopeKey] = window.setTimeout(() => {
        setFeedbackMap((current) => {
          const next = { ...current };
          delete next[scopeKey];
          return next;
        });

        delete feedbackTimersRef.current[scopeKey];
      }, HOLIDAY_NOTICE_HIDE_MS);
    }
  }

  const filteredItems = useMemo(() => {
    const keyword = String(filters.search || '').trim().toLowerCase();

    if (!keyword) {
      return items;
    }

    return items.filter((item) => {
      return [
        item.state,
        item.date,
        item.start_date,
        item.end_date,
        item.date_type,
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
    return items.filter((item) => isUpcomingHoliday(item)).length;
  }, [items]);

  const activeCount = useMemo(
    () =>
      items.filter(
        (item) => String(item.status || 'active').toLowerCase() === 'active',
      ).length,
    [items],
  );

  const inactiveCount = useMemo(
    () =>
      items.filter(
        (item) => String(item.status || 'active').toLowerCase() === 'inactive',
      ).length,
    [items],
  );

  const pageCount = Math.max(
    1,
    Math.ceil(filteredItems.length / Math.max(1, pageSize)),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedItems = filteredItems.slice(pageStart, pageStart + pageSize);

  const holidayMap = useMemo(() => {
    return items.reduce((acc, item) => {
      const startDate = item.start_date || item.date || '';
      const endDate = item.end_date || startDate;
      const keys = dateKeysInRange(startDate, endDate);

      keys.forEach((dateKey) => {
        acc[dateKey] = item;
      });

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
    setForm((prev) => {
      if (key === 'date_type') {
        if (value === 'date_range') {
          const startDate = prev.start_date || prev.date || '';
          return {
            ...prev,
            date_type: 'date_range',
            date: '',
            start_date: startDate,
            end_date: prev.end_date || startDate,
          };
        }

        return {
          ...prev,
          date_type: 'single_day',
          date: prev.date || prev.start_date || '',
          start_date: '',
          end_date: '',
        };
      }

      return {
        ...prev,
        [key]: value,
      };
    });
  }

  function resetForm() {
    setEditingId('');
    setForm({ ...EMPTY_FORM });
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

  async function loadHolidays(
    nextFilters = filters,
    { feedbackScope = '' } = {},
  ) {
    setLoading(true);

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        'Refreshing holiday records...',
        'Refreshing',
        { loading: true },
      );
    }

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

      // Do not silently select a state for new holidays. HR/Admin must
      // deliberately choose the state that the declared holiday applies to.

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          'Holiday records are up to date.',
          'Refresh Complete',
        );
      }
    } catch (err) {
      const errorMessage =
        err?.message || 'Unable to load holiday calendar.';

      setItems([]);

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'error',
          errorMessage,
          'Refresh Failed',
        );
      } else {
        showFeedback(
          'page',
          'error',
          errorMessage,
          'Holiday Load Failed',
        );
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!canManage) return;

    setSaving(true);
    clearFeedback('form');

    const state = String(form.state || '').trim();
    const title = String(form.title || '').trim();
    const isRange = form.date_type === 'date_range';
    const startDate = isRange ? form.start_date : form.date;
    const endDate = isRange ? form.end_date : form.date;

    if (!state) {
      showFeedback(
        'form',
        'warning',
        'Please select the state this holiday applies to.',
        'State Required',
      );
      setSaving(false);
      return;
    }

    if (!title) {
      showFeedback(
        'form',
        'warning',
        'Holiday title is required.',
        'Title Required',
      );
      setSaving(false);
      return;
    }

    if (!startDate) {
      showFeedback(
        'form',
        'warning',
        isRange
          ? 'Holiday from date is required.'
          : 'Holiday date is required.',
        'Date Required',
      );
      setSaving(false);
      return;
    }

    if (isRange && !endDate) {
      showFeedback(
        'form',
        'warning',
        'Holiday to date is required for a date range.',
        'End Date Required',
      );
      setSaving(false);
      return;
    }

    if (isRange && endDate < startDate) {
      showFeedback(
        'form',
        'warning',
        'Holiday to date cannot be earlier than the from date.',
        'Invalid Date Range',
      );
      setSaving(false);
      return;
    }

    showFeedback(
      'form',
      'info',
      editingId ? 'Updating the holiday...' : 'Creating the holiday...',
      editingId ? 'Updating Holiday' : 'Creating Holiday',
      { loading: true },
    );

    try {
      const payload = {
        state,
        date_type: isRange ? 'date_range' : 'single_day',
        date: startDate,
        start_date: startDate,
        end_date: endDate,
        from_date: startDate,
        to_date: endDate,
        title,
        message: form.message,
        status: form.status || 'active',
      };

      if (editingId) {
        await api(`/attendance/holidays/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });

        showFeedback(
          'form',
          'success',
          'Holiday updated successfully.',
          'Holiday Updated',
        );
      } else {
        await api('/attendance/holidays', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        showFeedback(
          'form',
          'success',
          'Holiday added successfully.',
          'Holiday Created',
        );
      }

      resetForm();
      await loadHolidays();
    } catch (err) {
      showFeedback(
        'form',
        'error',
        err?.message || 'Unable to save holiday.',
        'Holiday Save Failed',
      );
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(item) {
    if (!canManage) return;

    setEditingId(item._id);
    const startDate = item.start_date || item.date || '';
    const endDate = item.end_date || startDate;
    const dateType =
      item.date_type === 'date_range' || (startDate && endDate && startDate !== endDate)
        ? 'date_range'
        : 'single_day';

    setForm({
      state: item.state || '',
      date_type: dateType,
      date: dateType === 'single_day' ? startDate : '',
      start_date: dateType === 'date_range' ? startDate : '',
      end_date: dateType === 'date_range' ? endDate : '',
      title: item.title || '',
      message: item.message || '',
      status: item.status || 'active',
    });

    setActiveSection('manage');
    showFeedback(
      'form',
      'info',
      `Editing ${item.title || 'holiday'}.`,
      'Edit Mode',
    );

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  function handleDelete(item) {
    if (!canManage || !item?._id) return;

    clearFeedback('delete-modal');
    setDeleteTarget(item);
  }

  function closeDeleteDialog() {
    if (deleting) return;
    clearFeedback('delete-modal');
    setDeleteTarget(null);
  }

  async function confirmDelete() {
    if (!canManage || !deleteTarget?._id) return;

    setDeleting(true);

    showFeedback(
      'delete-modal',
      'info',
      'Deleting the selected holiday...',
      'Deleting Holiday',
      { loading: true },
    );

    try {
      await api(`/attendance/holidays/${deleteTarget._id}`, {
        method: 'DELETE',
      });

      setDeleteTarget(null);

      showFeedback(
        'directory',
        'success',
        'Holiday deleted successfully.',
        'Holiday Deleted',
      );

      await loadHolidays();
    } catch (err) {
      showFeedback(
        'delete-modal',
        'error',
        err?.message || 'Unable to delete holiday.',
        'Delete Failed',
      );
    } finally {
      setDeleting(false);
    }
  }

  function applyFilters() {
    loadHolidays(filters, { feedbackScope: 'filters' });
  }

  function clearFilters() {
    const nextFilters = { ...EMPTY_FILTERS };
    setFilters(nextFilters);
    loadHolidays(nextFilters, { feedbackScope: 'filters' });
  }

  useEffect(() => {
    loadHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.state, filters.date_from, filters.date_to, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    function dismissFeedback(event) {
      if (event.target?.closest?.('.holiday-inline-feedback')) return;

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
      setFeedbackMap({});
    }

    document.addEventListener('pointerdown', dismissFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissFeedback);

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!deleteTarget || typeof document === 'undefined') {
      return undefined;
    }

    const body = document.body;
    const root = document.documentElement;

    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousRootOverscroll = root.style.overscrollBehavior;

    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    root.style.overscrollBehavior = 'none';

    function blockBackgroundScroll(event) {
      if (event.target?.closest?.('.holiday-confirm-dialog')) return;
      event.preventDefault();
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape' && !deleting) {
        closeDeleteDialog();
      }
    }

    document.addEventListener('wheel', blockBackgroundScroll, {
      passive: false,
    });
    document.addEventListener('touchmove', blockBackgroundScroll, {
      passive: false,
    });
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('wheel', blockBackgroundScroll);
      document.removeEventListener('touchmove', blockBackgroundScroll);
      window.removeEventListener('keydown', closeOnEscape);

      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      root.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [deleteTarget, deleting]);

  return (
    <section className="holiday-page">
      <style>{`
        .holiday-page {
          --hc-ink: #101a3a;
          --hc-copy: #5d6d8d;
          --hc-blue: #4d77dd;
          --hc-cyan: #2eb2b9;
          --hc-violet: #575092;
          --hc-danger: #a2344d;
          --hc-line: rgba(16,26,58,.14);
          width: 100%;
          min-width: 0;
          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          color: var(--hc-ink);
        }

        .holiday-page,
        .holiday-page * {
          box-sizing: border-box;
        }

        .holiday-page > *,
        .holiday-page section,
        .holiday-page article,
        .holiday-page form,
        .holiday-page nav,
        .holiday-page label {
          min-width: 0;
          max-width: 100%;
        }

        .holiday-page::before,
        .holiday-page::after,
        .holiday-page .holiday-hero::before,
        .holiday-page .holiday-hero::after,
        .holiday-page .holiday-kpi::before,
        .holiday-page .holiday-kpi::after {
          content: none;
          display: none;
          background: none;
        }

        .holiday-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(190px, 310px);
          gap: clamp(20px, 3vw, 38px);
          align-items: center;
          min-height: 240px;
          padding: clamp(24px, 3vw, 40px);
          border: 1px solid rgba(154,164,205,.58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background:
            linear-gradient(
              90deg,
              #d3f4fb 0%,
              #f7fcfb 34%,
              #fffdf8 52%,
              #fbf8fa 68%,
              #f0edfb 100%
            );
          box-shadow: 0 22px 46px rgba(70,92,140,.10);
        }

        .holiday-hero-copy {
          min-width: 0;
          max-width: 900px;
        }

        .holiday-hero-actions {
          width: 100%;
          display: grid;
          gap: 9px;
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
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 8px 18px rgba(77,119,221,.18);
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
          font-size: clamp(44px, 5.2vw, 76px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .holiday-hero h1 em {
          color: var(--hc-blue);
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

        .holiday-refresh-stack {
          width: min(300px, 100%);
          display: grid;
          gap: 9px;
        }

        .holiday-refresh-btn,
        .holiday-filter-actions button,
        .holiday-calendar-actions button,
        .holiday-save-btn,
        .holiday-cancel-btn,
        .holiday-row-actions button,
        .holiday-section-tab,
        .holiday-page-button,
        .holiday-page-number,
        .holiday-confirm-close,
        .holiday-confirm-actions button,
        .holiday-inline-feedback-close {
          font: inherit;
          cursor: pointer;
        }

        .holiday-refresh-btn,
        .holiday-save-btn,
        .holiday-cancel-btn,
        .holiday-filter-actions button,
        .holiday-confirm-actions button {
          min-height: 44px;
          padding: 10px 15px;
          border: 1px solid transparent;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 900;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            filter 180ms ease,
            opacity 180ms ease;
        }

        .holiday-refresh-btn,
        .holiday-cancel-btn,
        .holiday-filter-actions button:last-child {
          color: #4767b4;
          border-color: rgba(77,119,221,.18);
          background: #fff;
        }

        .holiday-save-btn,
        .holiday-filter-actions button:first-child,
        .holiday-confirm-actions .danger {
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 10px 22px rgba(77,119,221,.18);
        }

        .holiday-confirm-actions .danger {
          background: linear-gradient(135deg, #b4445c, #d85f75);
        }

        .holiday-refresh-btn:hover:not(:disabled),
        .holiday-save-btn:hover:not(:disabled),
        .holiday-cancel-btn:hover:not(:disabled),
        .holiday-filter-actions button:hover:not(:disabled),
        .holiday-row-actions button:hover:not(:disabled),
        .holiday-calendar-actions button:hover:not(:disabled),
        .holiday-section-tab:hover,
        .holiday-page-button:hover:not(:disabled),
        .holiday-page-number:hover:not(:disabled),
        .holiday-confirm-actions button:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: saturate(1.03);
        }

        .holiday-refresh-btn:disabled,
        .holiday-save-btn:disabled,
        .holiday-cancel-btn:disabled,
        .holiday-filter-actions button:disabled,
        .holiday-row-actions button:disabled,
        .holiday-page-button:disabled,
        .holiday-page-number:disabled,
        .holiday-confirm-actions button:disabled,
        .holiday-confirm-close:disabled {
          opacity: .54;
          cursor: not-allowed;
          transform: none;
        }

        .holiday-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .holiday-kpi {
          min-width: 0;
          min-height: 120px;
          padding: 18px;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 0 16px 30px rgba(34,38,110,.07);
        }

        .holiday-kpi:nth-child(2) {
          background: #eaf8f4;
        }

        .holiday-kpi:nth-child(3) {
          background: #fff4d5;
        }

        .holiday-kpi:nth-child(4) {
          background: #f1efff;
        }

        .holiday-kpi span,
        .holiday-kpi strong,
        .holiday-kpi small {
          display: block;
        }

        .holiday-kpi span {
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .holiday-kpi strong {
          margin-top: 8px;
          color: var(--hc-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(28px, 3vw, 42px);
          line-height: 1;
        }

        .holiday-kpi small {
          margin-top: 7px;
          color: var(--hc-copy);
          font-size: 11px;
          line-height: 1.45;
        }

        .holiday-section-tabs {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 12px;
          width: 100%;
          padding: 12px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 22px;
          background: #fff;
          box-shadow: 0 16px 28px rgba(34,38,110,.08);
        }

        .holiday-section-tab {
          min-width: 0;
          min-height: 62px;
          padding: 11px 14px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          border: 1px solid rgba(77,119,221,.22);
          border-radius: 16px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          text-align: left;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .holiday-section-tab.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 8px 18px rgba(77,119,221,.17);
        }

        .holiday-section-tab-copy {
          min-width: 0;
          display: grid;
          gap: 3px;
        }

        .holiday-section-tab-copy strong {
          font-size: 12px;
          font-weight: 950;
          line-height: 1.2;
        }

        .holiday-section-tab-copy small {
          color: currentColor;
          font-size: 9px;
          font-weight: 700;
          line-height: 1.35;
          opacity: .78;
        }

        .holiday-section-tab-count {
          min-width: 28px;
          height: 28px;
          padding: 0 7px;
          display: inline-grid;
          place-items: center;
          border-radius: 999px;
          color: #40348d;
          background: #fff;
          font-size: 9px;
          font-weight: 950;
          white-space: nowrap;
        }

        .holiday-section-content {
          animation: holidaySectionReveal 220ms ease both;
        }

        @keyframes holidaySectionReveal {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .holiday-filter-card,
        .holiday-calendar-card,
        .holiday-form-card,
        .holiday-list-card {
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(24px, 2.2vw, 34px);
          background: #fff;
          box-shadow: 0 20px 38px rgba(34,38,110,.08);
        }

        .holiday-filter-card,
        .holiday-calendar-card,
        .holiday-form-card {
          padding: clamp(18px, 2vw, 26px);
        }

        .holiday-calendar-card {
          width: 100%;
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
        }

        .holiday-section-content.calendar {
          width: 100%;
          min-width: 0;
          max-width: 100%;
          display: grid;
          gap: 18px;
        }

        .holiday-section-title {
          min-width: 0;
          max-width: 100%;
          display: flex;
          align-items: flex-start;
          gap: 11px;
          color: var(--hc-blue);
        }

        .holiday-section-title > div {
          min-width: 0;
        }

        .holiday-section-title > svg {
          margin-top: 2px;
          flex: 0 0 auto;
        }

        .holiday-section-title h3 {
          margin: 0;
          color: var(--hc-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.3vw, 35px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .holiday-section-title p {
          margin: 7px 0 0;
          color: var(--hc-copy);
          font-size: 13px;
          line-height: 1.55;
          overflow-wrap: anywhere;
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
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .holiday-filter-grid input,
        .holiday-filter-grid select,
        .holiday-form-grid input,
        .holiday-form-grid select,
        .holiday-form-grid textarea,
        .holiday-search input,
        .holiday-page-size select {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 14px;
          outline: 0;
          color: var(--hc-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
        }

        .holiday-filter-grid input,
        .holiday-filter-grid select,
        .holiday-form-grid input,
        .holiday-form-grid select {
          min-height: 46px;
          padding: 0 13px;
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
        .holiday-form-grid textarea:focus,
        .holiday-search input:focus,
        .holiday-page-size select:focus {
          border-color: rgba(77,119,221,.65);
          box-shadow: 0 0 0 4px rgba(77,119,221,.09);
        }

        .holiday-filter-actions {
          display: flex;
          align-items: end;
          gap: 8px;
        }

        .holiday-filter-feedback,
        .holiday-form-feedback,
        .holiday-directory-feedback {
          margin-top: 12px;
        }

        .holiday-calendar-head {
          width: 100%;
          min-width: 0;
          max-width: 100%;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          flex-wrap: wrap;
        }

        .holiday-calendar-actions {
          min-width: 0;
          max-width: 100%;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .holiday-calendar-actions button {
          min-width: 38px;
          min-height: 38px;
          padding: 0 10px;
          border: 1px solid rgba(77,119,221,.18);
          border-radius: 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #4767b4;
          background: #fff;
        }

        .holiday-calendar-actions button.today {
          padding-inline: 13px;
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        }

        .holiday-calendar-actions strong {
          min-width: 150px;
          color: var(--hc-ink);
          text-align: center;
          font-family: Georgia, "Times New Roman", serif;
          font-size: 18px;
        }

        .holiday-calendar-legend {
          width: 100%;
          min-width: 0;
          max-width: 100%;
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

        .holiday-calendar-scroll {
          width: 100%;
          min-width: 0;
          max-width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x pan-y;
          scroll-behavior: smooth;
          scrollbar-width: thin;
          scrollbar-color: rgba(77,119,221,.48) rgba(77,119,221,.08);
          padding-bottom: 6px;
        }

        .holiday-calendar-scroll::-webkit-scrollbar {
          height: 8px;
        }

        .holiday-calendar-scroll::-webkit-scrollbar-track {
          border-radius: 999px;
          background: rgba(77,119,221,.08);
        }

        .holiday-calendar-scroll::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(77,119,221,.48);
        }

        .holiday-calendar-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(46,178,185,.68);
        }

        .holiday-calendar-grid {
          width: 100%;
          min-width: 560px;
          display: grid;
          grid-template-columns: repeat(7, minmax(72px, 1fr));
          gap: 7px;
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
          min-height: 90px;
          padding: 10px;
          border: 1px solid rgba(171,181,211,.56);
          border-radius: 14px;
          background: #fff;
          transition:
            transform 170ms ease,
            border-color 170ms ease;
        }

        .holiday-calendar-day:not(.blank):hover {
          transform: translateY(-1px);
          border-color: rgba(77,119,221,.30);
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
        }

        .holiday-calendar-day.sunday {
          background: #fff0f2;
        }

        .holiday-calendar-day.second-saturday {
          background: #edf6ff;
        }

        .holiday-calendar-day.fourth-saturday {
          background: #fff4d5;
        }

        .holiday-calendar-day.working {
          background: #eaf8f4;
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

        .holiday-list-card {
          overflow: hidden;
        }

        .holiday-list-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: clamp(18px, 2vw, 24px);
          border-bottom: 1px solid rgba(65,55,161,.08);
        }

        .holiday-list-head h3 {
          margin: 0;
          color: var(--hc-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.3vw, 35px);
          font-weight: 760;
          letter-spacing: -.045em;
        }

        .holiday-list-head p {
          margin: 7px 0 0;
          color: var(--hc-copy);
          font-size: 13px;
          line-height: 1.5;
        }

        .holiday-directory-controls {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) auto;
          gap: 12px;
          align-items: center;
          padding: 16px clamp(18px, 2vw, 24px);
          background:
            linear-gradient(
              145deg,
              rgba(237,248,255,.44),
              rgba(248,241,255,.30)
            );
        }

        .holiday-search {
          position: relative;
          min-width: 0;
        }

        .holiday-search svg {
          position: absolute;
          top: 50%;
          left: 13px;
          color: var(--hc-blue);
          transform: translateY(-50%);
          pointer-events: none;
        }

        .holiday-search input {
          min-height: 46px;
          padding: 0 13px 0 39px;
          font-size: 13px;
        }

        .holiday-view-label {
          display: inline-flex;
          align-items: center;
          min-height: 38px;
          padding: 7px 11px;
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .holiday-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          font-size: 10px;
          line-height: 1.45;
        }

        .holiday-inline-feedback.success {
          border-color: rgba(4,120,87,.18);
          color: #047857;
          background: #eaf8f4;
        }

        .holiday-inline-feedback.warning {
          border-color: rgba(154,104,23,.18);
          color: #9a6817;
          background: #fff4d5;
        }

        .holiday-inline-feedback.error {
          border-color: rgba(162,52,77,.18);
          color: #a2344d;
          background: #fff0f2;
        }

        .holiday-inline-feedback-icon {
          width: 22px;
          height: 22px;
          display: inline-grid;
          place-items: center;
        }

        .holiday-inline-feedback-copy {
          min-width: 0;
        }

        .holiday-inline-feedback-copy strong,
        .holiday-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .holiday-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .holiday-inline-feedback-copy span {
          font-weight: 750;
        }

        .holiday-inline-feedback-close {
          width: 24px;
          min-width: 24px;
          height: 24px;
          padding: 0;
          border: 0;
          border-radius: 8px;
          display: inline-grid;
          place-items: center;
          color: currentColor;
          background: rgba(255,255,255,.58);
          font-size: 17px;
          line-height: 1;
        }

        .holiday-inline-feedback-close:hover {
          background: #fff;
        }

        .holiday-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 13px clamp(18px, 2vw, 24px);
          border-top: 1px solid rgba(65,55,161,.08);
          border-bottom: 1px solid rgba(65,55,161,.08);
          background: #fff;
        }

        .holiday-pagination-copy {
          display: flex;
          align-items: baseline;
          gap: 6px;
          color: var(--hc-copy);
          font-size: 10px;
          font-weight: 850;
        }

        .holiday-pagination-copy strong {
          color: var(--hc-ink);
          font-size: 13px;
          font-weight: 950;
        }

        .holiday-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .holiday-page-size {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--hc-copy);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .holiday-page-size select {
          width: auto;
          min-width: 78px;
          min-height: 38px;
          padding: 0 28px 0 10px;
          color: #40348d;
          background: #f1efff;
          font-size: 10px;
          font-weight: 900;
        }

        .holiday-page-button,
        .holiday-page-number {
          border: 1px solid rgba(77,119,221,.18);
          color: #4767b4;
          background: #fff;
          font-size: 10px;
          font-weight: 900;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .holiday-page-button {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 11px;
        }

        .holiday-page-nav {
          min-width: 78px;
        }

        .holiday-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .holiday-page-number {
          width: 36px;
          height: 36px;
          padding: 0;
          display: grid;
          place-items: center;
          border-radius: 10px;
        }

        .holiday-page-number.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        }

        .holiday-page-ellipsis {
          width: 18px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .holiday-page-indicator {
          min-width: 82px;
          color: var(--hc-copy);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
        }

        .holiday-table-wrap {
          overflow-x: auto;
          background: #fff;
        }

        .holiday-table {
          width: 100%;
          border-collapse: collapse;
        }

        .holiday-table th,
        .holiday-table td {
          padding: 13px 14px;
          border-bottom: 1px solid rgba(171,181,211,.42);
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
          background: #fafcff;
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
        }

        .holiday-status.inactive {
          color: #a2344d;
          background: #fff0f2;
        }

        .holiday-row-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .holiday-row-actions button {
          min-height: 36px;
          padding: 0 11px;
          border: 1px solid rgba(77,119,221,.18);
          border-radius: 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          color: #4767b4;
          background: #fff;
          font-weight: 900;
        }

        .holiday-row-actions button.delete {
          color: #a2344d;
          border-color: rgba(216,77,104,.20);
          background: #fff0f2;
        }

        .holiday-mobile-list {
          display: none;
        }

        .holiday-mobile-card {
          padding: 15px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 12px 24px rgba(34,38,110,.06);
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
          min-height: 180px;
          margin: 18px;
          padding: 24px;
          border: 1px dashed rgba(77,119,221,.30);
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--hc-copy);
          background: linear-gradient(145deg, #f8fbff, #f8f7ff);
          text-align: center;
          font-weight: 800;
        }

        .holiday-confirm-backdrop {
          position: fixed;
          inset: 0;
          z-index: 10000;
          width: 100vw;
          height: 100dvh;
          padding:
            max(14px, env(safe-area-inset-top))
            max(14px, env(safe-area-inset-right))
            max(14px, env(safe-area-inset-bottom))
            max(14px, env(safe-area-inset-left));
          display: grid;
          place-items: center;
          overflow: hidden;
          background: rgba(15,23,42,.48);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .holiday-confirm-dialog {
          width: min(100%, 520px);
          max-height: calc(100dvh - 28px);
          overflow-y: auto;
          overscroll-behavior: contain;
          border: 1px solid rgba(255,255,255,.62);
          border-radius: 26px;
          background: #fff;
          box-shadow: 0 34px 90px rgba(9,16,35,.28);
          -webkit-overflow-scrolling: touch;
        }

        .holiday-confirm-head {
          position: sticky;
          top: 0;
          z-index: 2;
          padding: 18px 20px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          border-bottom: 1px solid rgba(65,55,161,.10);
          background: linear-gradient(135deg, #fff0f2 0%, #fff8f9 100%);
        }

        .holiday-confirm-head h2 {
          margin: 0;
          color: var(--hc-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 26px;
          font-weight: 760;
          letter-spacing: -.035em;
        }

        .holiday-confirm-head p {
          margin: 6px 0 0;
          color: var(--hc-copy);
          font-size: 12px;
          line-height: 1.5;
        }

        .holiday-confirm-close {
          width: 40px;
          min-width: 40px;
          height: 40px;
          padding: 0;
          border: 1px solid rgba(216,77,104,.18);
          border-radius: 13px;
          display: grid;
          place-items: center;
          color: #a2344d;
          background: #fff;
        }

        .holiday-confirm-body {
          padding: 20px;
        }

        .holiday-confirm-summary {
          padding: 14px;
          border: 1px solid rgba(216,77,104,.16);
          border-radius: 15px;
          color: var(--hc-copy);
          background: #fff8f9;
          font-size: 12px;
          line-height: 1.55;
        }

        .holiday-confirm-summary strong {
          display: block;
          margin-bottom: 4px;
          color: var(--hc-ink);
          font-size: 14px;
        }

        .holiday-confirm-action-stack {
          display: grid;
          gap: 9px;
          margin-top: 16px;
        }

        .holiday-confirm-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .spin {
          animation: holidaySpin .85s linear infinite;
        }

        @keyframes holidaySpin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 1180px) {
          .holiday-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .holiday-filter-grid,
          .holiday-form-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .holiday-message-field {
            grid-column: 1 / -1;
          }

          .holiday-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .holiday-pagination-controls {
            width: 100%;
            justify-content: flex-start;
          }
        }

        @media (max-width: 820px) {
          .holiday-hero {
            grid-template-columns: 1fr;
          }

          .holiday-hero-actions,
          .holiday-refresh-stack {
            width: min(360px, 100%);
          }

          .holiday-directory-controls {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .holiday-page {
            gap: 15px;
          }

          .holiday-hero {
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 0 18px 30px rgba(34,38,110,.09);
          }

          .holiday-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .holiday-kpi-grid {
            grid-template-columns: 1fr;
          }

          .holiday-section-tabs {
            grid-template-columns: 1fr;
          }

          .holiday-calendar-head,
          .holiday-list-head {
            align-items: stretch;
            flex-direction: column;
          }

          .holiday-calendar-actions {
            width: 100%;
            justify-content: space-between;
          }

          .holiday-calendar-actions strong {
            flex: 1;
            min-width: 0;
          }

          .holiday-form-actions {
            flex-direction: column-reverse;
          }

          .holiday-form-actions button {
            width: 100%;
          }

          .holiday-table-wrap {
            display: none;
          }

          .holiday-mobile-list {
            display: grid;
            gap: 13px;
            padding: 14px;
          }

          .holiday-pagination {
            padding: 12px;
          }

          .holiday-pagination-controls {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
          }

          .holiday-page-size,
          .holiday-page-numbers,
          .holiday-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .holiday-page-size {
            justify-content: space-between;
          }

          .holiday-page-size select {
            flex: 1 1 auto;
          }

          .holiday-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .holiday-page-nav {
            width: 100%;
          }

          .holiday-confirm-backdrop {
            align-items: stretch;
            padding: 0;
          }

          .holiday-confirm-dialog {
            width: 100%;
            max-width: 100%;
            height: 100dvh;
            max-height: 100dvh;
            margin: 0;
            border-radius: 0;
            box-shadow: none;
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

          .holiday-calendar-actions {
            display: grid;
            grid-template-columns: 38px 1fr 38px;
          }

          .holiday-calendar-actions .today {
            grid-column: 1 / -1;
            width: 100%;
          }

          .holiday-page-number {
            width: 34px;
            height: 34px;
          }

          .holiday-confirm-actions {
            flex-direction: column-reverse;
          }

          .holiday-confirm-actions button {
            width: 100%;
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
          .holiday-form-card {
            padding: 15px;
          }
        }

        @media (orientation: landscape) and (max-height: 600px) {
          .holiday-confirm-dialog {
            max-height: 100dvh;
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
        <div className="holiday-hero-copy">
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

        <div className="holiday-hero-actions">
          <div className="holiday-refresh-stack">
            <button
              type="button"
              className="holiday-refresh-btn"
              onClick={() =>
                loadHolidays(filters, {
                  feedbackScope: 'refresh',
                })
              }
              disabled={loading}
            >
              {loading ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <RefreshCcw size={17} />
              )}
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>

            <HolidayInlineMessage
              message={feedbackMap.refresh}
              onClose={() => clearFeedback('refresh')}
            />
          </div>
        </div>
      </div>

      <section className="holiday-kpi-grid" aria-label="Holiday summary">
        <article className="holiday-kpi">
          <span>Total Holidays</span>
          <strong>{items.length}</strong>
          <small>Holiday records in the current loaded view</small>
        </article>

        <article className="holiday-kpi">
          <span>Upcoming Holidays</span>
          <strong>{upcomingCount}</strong>
          <small>Current and future holiday dates</small>
        </article>

        <article className="holiday-kpi">
          <span>Active Holidays</span>
          <strong>{activeCount}</strong>
          <small>Records currently marked active</small>
        </article>

        <article className="holiday-kpi">
          <span>Inactive Holidays</span>
          <strong>{inactiveCount}</strong>
          <small>Historical or disabled holiday records</small>
        </article>
      </section>

      {feedbackMap.page ? (
        <HolidayInlineMessage
          message={feedbackMap.page}
          onClose={() => clearFeedback('page')}
        />
      ) : null}

      <nav
        className="holiday-section-tabs"
        aria-label="Holiday calendar sections"
      >
        <button
          type="button"
          className={`holiday-section-tab ${
            activeSection === 'calendar' ? 'is-active' : ''
          }`}
          onClick={() => setActiveSection('calendar')}
          aria-pressed={activeSection === 'calendar'}
        >
          <CalendarDays size={18} />
          <span className="holiday-section-tab-copy">
            <strong>Calendar & Filters</strong>
            <small>State/date filters and monthly holiday view</small>
          </span>
          <span className="holiday-section-tab-count">{items.length}</span>
        </button>

        <button
          type="button"
          className={`holiday-section-tab ${
            activeSection === 'directory' ? 'is-active' : ''
          }`}
          onClick={() => setActiveSection('directory')}
          aria-pressed={activeSection === 'directory'}
        >
          <Search size={18} />
          <span className="holiday-section-tab-copy">
            <strong>Holiday Directory</strong>
            <small>Search, review and manage holiday records</small>
          </span>
          <span className="holiday-section-tab-count">
            {filteredItems.length}
          </span>
        </button>

        {canManage ? (
          <button
            type="button"
            className={`holiday-section-tab ${
              activeSection === 'manage' ? 'is-active' : ''
            }`}
            onClick={() => setActiveSection('manage')}
            aria-pressed={activeSection === 'manage'}
          >
            <Plus size={18} />
            <span className="holiday-section-tab-copy">
              <strong>{editingId ? 'Update Holiday' : 'Manage Holiday'}</strong>
              <small>Create or edit declared holiday records</small>
            </span>
          </button>
        ) : null}
      </nav>

      {activeSection === 'calendar' ? (
        <div className="holiday-section-content calendar">
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
                  onChange={(event) =>
                    updateFilter('state', event.target.value)
                  }
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
                  onChange={(event) =>
                    updateFilter('date_from', event.target.value)
                  }
                />
              </label>

              <label>
                To Date
                <input
                  type="date"
                  value={filters.date_to}
                  onChange={(event) =>
                    updateFilter('date_to', event.target.value)
                  }
                />
              </label>

              <div className="holiday-filter-actions">
                <button
                  type="button"
                  onClick={applyFilters}
                  disabled={loading}
                >
                  {loading ? <Loader2 size={16} className="spin" /> : null}
                  Apply
                </button>

                <button
                  type="button"
                  onClick={clearFilters}
                  disabled={loading}
                >
                  Clear
                </button>
              </div>
            </div>

            {feedbackMap.filters ? (
              <div className="holiday-filter-feedback">
                <HolidayInlineMessage
                  message={feedbackMap.filters}
                  onClose={() => clearFeedback('filters')}
                />
              </div>
            ) : null}
          </div>

          <div className="holiday-calendar-card">
            <div className="holiday-calendar-head">
              <div className="holiday-section-title">
                <CalendarDays size={18} />
                <div>
                  <h3>Monthly Holiday Calendar</h3>
                  <p>
                    Sundays, 2nd Saturday, 4th Saturday and declared holidays
                    are highlighted separately.
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

                <button
                  type="button"
                  className="today"
                  onClick={goToCurrentMonth}
                >
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

            <div className="holiday-calendar-scroll">
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
          </div>
        </div>
      ) : null}

      {activeSection === 'manage' && canManage ? (
        <form
          className="holiday-section-content holiday-form-card"
          onSubmit={handleSubmit}
        >
          <div className="holiday-section-title">
            <Plus size={18} />
            <div>
              <h3>{editingId ? 'Update Holiday' : 'Add Holiday'}</h3>
              <p>
                Only tenant Admin and HR users can create or modify holidays.
              </p>
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
                <option value="">Select state</option>
                {states.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Holiday Duration *
              <select
                value={form.date_type}
                onChange={(event) =>
                  updateForm('date_type', event.target.value)
                }
              >
                <option value="single_day">Single Day</option>
                <option value="date_range">Date Range</option>
              </select>
            </label>

            {form.date_type === 'date_range' ? (
              <>
                <label>
                  From Date *
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(event) =>
                      updateForm('start_date', event.target.value)
                    }
                    required
                  />
                </label>

                <label>
                  To Date *
                  <input
                    type="date"
                    min={form.start_date || undefined}
                    value={form.end_date}
                    onChange={(event) =>
                      updateForm('end_date', event.target.value)
                    }
                    required
                  />
                </label>
              </>
            ) : (
              <label>
                Date *
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    updateForm('date', event.target.value)
                  }
                  required
                />
              </label>
            )}

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
                onChange={(event) =>
                  updateForm('message', event.target.value)
                }
                placeholder="Short note for employees..."
                rows={4}
              />
            </label>
          </div>

          <div className="holiday-form-actions">
            {editingId ? (
              <button
                type="button"
                className="holiday-cancel-btn"
                onClick={() => {
                  resetForm();
                  clearFeedback('form');
                }}
                disabled={saving}
              >
                Cancel
              </button>
            ) : null}

            <button
              type="submit"
              className="holiday-save-btn"
              disabled={saving}
            >
              {saving ? <Loader2 size={17} className="spin" /> : null}
              {saving
                ? editingId
                  ? 'Updating...'
                  : 'Creating...'
                : editingId
                  ? 'Update Holiday'
                  : 'Create Holiday'}
            </button>
          </div>

          {feedbackMap.form ? (
            <div className="holiday-form-feedback">
              <HolidayInlineMessage
                message={feedbackMap.form}
                onClose={() => clearFeedback('form')}
              />
            </div>
          ) : null}
        </form>
      ) : null}

      {activeSection === 'directory' ? (
        <div className="holiday-section-content holiday-list-card">
          <div className="holiday-list-head">
            <div>
              <h3>Holiday Directory</h3>
              <p>
                Search and review {filteredItems.length} holiday record
                {filteredItems.length === 1 ? '' : 's'} in the current view.
              </p>
            </div>

            <span className="holiday-view-label">{currentStateLabel}</span>
          </div>

          <div className="holiday-directory-controls">
            <div className="holiday-search">
              <Search size={18} />
              <input
                type="search"
                value={filters.search}
                onChange={(event) =>
                  updateFilter('search', event.target.value)
                }
                placeholder="Search holiday, state, date, added by..."
                aria-label="Search holidays"
              />
            </div>

            <span className="holiday-view-label">
              {safePage} / {pageCount}
            </span>
          </div>

          {feedbackMap.directory ? (
            <div className="holiday-directory-feedback">
              <HolidayInlineMessage
                message={feedbackMap.directory}
                onClose={() => clearFeedback('directory')}
              />
            </div>
          ) : null}

          <HolidayPagination
            total={filteredItems.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(value) => {
              setPage(1);
              setPageSize(value);
            }}
          />

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
                      <th>Date / Range</th>
                      <th>Holiday</th>
                      <th>State</th>
                      <th>Status</th>
                      <th>Created By</th>
                      {canManage ? <th>Action</th> : null}
                    </tr>
                  </thead>

                  <tbody>
                    {pagedItems.map((item) => (
                      <tr
                        key={
                          item._id ||
                          `${item.state}-${item.date}-${item.title}`
                        }
                      >
                        <td>
                          <strong>{formatHolidayDate(item)}</strong>
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

                        {canManage ? (
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
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="holiday-mobile-list">
                {pagedItems.map((item) => (
                  <article
                    className="holiday-mobile-card"
                    key={`mobile-${
                      item._id ||
                      `${item.state}-${item.date}-${item.title}`
                    }`}
                  >
                    <div>
                      <span>{formatHolidayDate(item)}</span>
                      <strong>{item.title}</strong>
                    </div>

                    <p>{item.state}</p>

                    <div className="holiday-mobile-meta">
                      <span className={`holiday-status ${item.status}`}>
                        {statusLabel(item.status)}
                      </span>
                      <span>Created by {item.created_by_name}</span>
                    </div>

                    {canManage ? (
                      <div className="holiday-row-actions">
                        <button
                          type="button"
                          onClick={() => handleEdit(item)}
                        >
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
                    ) : null}
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
      ) : null}

      {deleteTarget ? (
        <div
          className="holiday-confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteDialog();
            }
          }}
        >
          <section
            className="holiday-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="holiday-delete-title"
          >
            <div className="holiday-confirm-head">
              <div>
                <h2 id="holiday-delete-title">Delete Holiday</h2>
                <p>
                  Confirm before permanently removing this holiday record.
                </p>
              </div>

              <button
                type="button"
                className="holiday-confirm-close"
                onClick={closeDeleteDialog}
                disabled={deleting}
                aria-label="Close delete confirmation"
              >
                <X size={20} />
              </button>
            </div>

            <div className="holiday-confirm-body">
              <div className="holiday-confirm-summary">
                <strong>{deleteTarget.title}</strong>
                {deleteTarget.state} · {formatHolidayDate(deleteTarget)}
              </div>

              <div className="holiday-confirm-action-stack">
                <div className="holiday-confirm-actions">
                  <button
                    type="button"
                    className="holiday-cancel-btn"
                    onClick={closeDeleteDialog}
                    disabled={deleting}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="danger"
                    onClick={confirmDelete}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    {deleting ? 'Deleting...' : 'Delete Holiday'}
                  </button>
                </div>

                <HolidayInlineMessage
                  message={feedbackMap['delete-modal']}
                  onClose={() => clearFeedback('delete-modal')}
                />
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}