import { useEffect, useMemo, useState } from 'react';
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
      <div className="holiday-hero">
        <div>
          <span className="holiday-eyebrow">
            <CalendarDays size={16} />
            Holiday Calendar
          </span>

          <h1>Company Holiday Calendar</h1>

          <p>
            View holidays configured for your tenant. Employees see their own
            state by default and can filter other states when required.
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