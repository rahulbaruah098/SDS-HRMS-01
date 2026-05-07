import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Search, X } from 'lucide-react';
import { api } from '../api/client';
import Table from '../components/Table';
import Stat from '../components/Stat';

const REPORT_TABS = [
  {
    key: 'attendance',
    title: 'Attendance Report',
    endpoint: '/reports/attendance',
  },
  {
    key: 'attendance-mode-requests',
    title: 'WFH / Field Requests',
    endpoint: '/reports/attendance-mode-requests',
  },
  {
    key: 'holidays',
    title: 'Holiday Calendar',
    endpoint: '/reports/holidays',
  },
  {
    key: 'compoffs',
    title: 'Comp-Off Report',
    endpoint: '/reports/compoffs',
  },
  {
    key: 'leave-balances',
    title: 'Leave Balances',
    endpoint: '/reports/leave-balances',
  },
  {
    key: 'leave-requests',
    title: 'Leave Requests',
    endpoint: '/reports/leave-requests',
  },
  {
    key: 'audit',
    title: 'Audit Logs',
    endpoint: '/reports/audit',
  },
];

const HOLIDAY_STATES = [
  'Assam(HO)',
  'Manipur',
  'Mizoram',
  'Arunachal Pradesh',
];

const EMPTY_FILTERS = {
  tenant_id: '',
  employee_id: '',
  department: '',
  status: '',
  mode: '',
  state: '',
  leave_type: '',
  date_from: '',
  date_to: '',
  action: '',
  entity: '',
  actor_email: '',
};

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    query.append(key, value);
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function formatDateTime(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

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

function normalizeRows(tab, rows = []) {
  if (tab === 'attendance') {
    return rows.map((row) => ({
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      state: row.state || '—',
      date: row.date || '—',
      mode: modeLabel(row.mode),
      status: statusLabel(row.status),
      check_in: formatDateTime(row.check_in),
      check_out: formatDateTime(row.check_out),
      late_reason: row.late_reason || '—',
      early_checkout_reason: row.early_checkout_reason || '—',
      holiday: row.holiday_title || '—',
      verified: row.verified_by_ro ? 'Yes' : 'No',
    }));
  }

  if (tab === 'attendance-mode-requests') {
    return rows.map((row) => ({
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      mode: modeLabel(row.mode),
      date: row.date || '—',
      reason: row.reason || '—',
      field_location: row.field_location || '—',
      status: statusLabel(row.status),
      decided_by: row.decided_by_name || '—',
      decided_at: formatDateTime(row.decided_at),
    }));
  }

  if (tab === 'holidays') {
    return rows.map((row) => ({
      state: row.state || '—',
      date: row.date || '—',
      title: row.title || '—',
      message: row.message || '—',
      status: statusLabel(row.status),
      created_at: formatDateTime(row.created_at),
    }));
  }

  if (tab === 'compoffs') {
    return rows.map((row) => ({
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      earned_date: row.earned_date || '—',
      valid_until: row.valid_until || '—',
      claimed_date: row.claimed_date || '—',
      holiday: row.holiday_title || '—',
      status: statusLabel(row.status),
    }));
  }

  if (tab === 'leave-balances') {
    return rows.map((row) => ({
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      leave_type: row.leave_type || '—',
      opening_balance: row.opening_balance ?? '—',
      credited: row.credited ?? '—',
      used: row.used ?? '—',
      available: row.available ?? '—',
      status: statusLabel(row.status),
    }));
  }

  if (tab === 'leave-requests') {
    return rows.map((row) => ({
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      leave_type: row.leave_type || '—',
      from_date: row.from_date || '—',
      to_date: row.to_date || '—',
      leave_days: row.leave_days ?? '—',
      reason: row.reason || '—',
      stage: row.approval_stage_label || statusLabel(row.approval_stage) || '—',
      status: statusLabel(row.status),
    }));
  }

  if (tab === 'audit') {
    return rows.map((row) => ({
      action: row.action || '—',
      entity: row.entity || '—',
      entity_id: row.entity_id || row.record_id || '—',
      actor_email: row.actor_email || row.actor || '—',
      tenant_id: row.tenant_id || '—',
      created_at: formatDateTime(row.created_at),
    }));
  }

  return rows;
}

export default function Reports() {
  const [summary, setSummary] = useState(null);
  const [activeTab, setActiveTab] = useState('attendance');
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });

  const currentTab = REPORT_TABS.find((tab) => tab.key === activeTab);

  const hasActiveFilters = useMemo(() => {
    return Object.values(filters).some((value) => String(value || '').trim());
  }, [filters]);

  async function loadSummary(nextFilters = filters) {
    try {
      setLoadingSummary(true);
      setMessage('');

      const data = await api(
        `/reports/summary${buildQuery({
          tenant_id: nextFilters.tenant_id,
        })}`,
      );

      setSummary(data);
    } catch (error) {
      setMessage(error.message || 'Unable to load report summary');
    } finally {
      setLoadingSummary(false);
    }
  }

  async function loadRows(tabKey = activeTab, nextFilters = filters) {
    const selectedTab = REPORT_TABS.find((tab) => tab.key === tabKey);

    if (!selectedTab) {
      return;
    }

    try {
      setLoadingRows(true);
      setMessage('');

      const data = await api(`${selectedTab.endpoint}${buildQuery(nextFilters)}`);
      setRows(normalizeRows(tabKey, data.items || []));
    } catch (error) {
      setRows([]);
      setMessage(error.message || 'Unable to load report');
    } finally {
      setLoadingRows(false);
    }
  }

  async function refreshAll(tabKey = activeTab, nextFilters = filters) {
    await Promise.all([
      loadSummary(nextFilters),
      loadRows(tabKey, nextFilters),
    ]);
  }

  useEffect(() => {
    refreshAll(activeTab, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeTab(tabKey) {
    setActiveTab(tabKey);
    setRows([]);
    await loadRows(tabKey, filters);
  }

  async function searchReport(event) {
    event.preventDefault();
    await refreshAll(activeTab, filters);
  }

  async function clearFilters() {
    const cleared = { ...EMPTY_FILTERS };

    setFilters(cleared);
    setMessage('');
    await refreshAll(activeTab, cleared);
  }

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  const counts = summary?.counts || {};
  const extra = summary?.extra || {};

  const statItems = [
    ['Employees', counts.employees || 0],
    ['Attendance Logs', counts.attendance_logs || 0],
    ['WFH / Field Requests', counts.attendance_mode_requests || 0],
    ['Holiday Calendar', counts.holiday_calendar || 0],
    ['Comp-Off Credits', counts.compoff_credits || 0],
    ['Leave Balances', counts.leave_balances || 0],
    ['Leave Requests', counts.leave_requests || 0],
    ['Tickets', counts.tickets || 0],
    ['Expenses', counts.expenses || 0],
    ['Audit Logs', counts.audit_logs || 0],
  ];

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Reports</span>
          <h1>HRMS Reports Center</h1>
          <p>
            View attendance, WFH/Field requests, holidays, comp-off, leave
            balances, leave requests and audit logs from one reporting screen.
          </p>
        </div>

        <button
          type="button"
          className="secondary"
          onClick={() => refreshAll(activeTab, filters)}
          disabled={loadingSummary || loadingRows}
        >
          <RefreshCcw size={16} />
          {loadingSummary || loadingRows ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="stats-grid">
        {statItems.map(([label, value]) => (
          <Stat key={label} label={label} value={value} />
        ))}
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>Today&apos;s Attendance Summary</h3>

          <div className="mini-list">
            <span>
              <strong>Present Today</strong>
              <small>{extra?.attendance?.present_today || 0}</small>
            </span>

            <span>
              <strong>Late Today</strong>
              <small>{extra?.attendance?.late_today || 0}</small>
            </span>

            <span>
              <strong>Early Checkout Today</strong>
              <small>{extra?.attendance?.early_checkout_today || 0}</small>
            </span>

            <span>
              <strong>Holiday Work Today</strong>
              <small>{extra?.attendance?.holiday_work_today || 0}</small>
            </span>
          </div>
        </div>

        <div className="panel">
          <h3>Pending & Comp-Off Summary</h3>

          <div className="mini-list">
            <span>
              <strong>Pending Leave Requests</strong>
              <small>{extra?.pending?.leave_requests || 0}</small>
            </span>

            <span>
              <strong>Pending WFH / Field</strong>
              <small>{extra?.pending?.wfh_field_requests || 0}</small>
            </span>

            <span>
              <strong>Available Comp-Off</strong>
              <small>{extra?.compoff?.available || 0}</small>
            </span>

            <span>
              <strong>Holidays Today</strong>
              <small>{extra?.holiday_calendar?.holidays_today || 0}</small>
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Report Filters</h3>
            <p>
              Use filters according to the active report. Empty fields are
              ignored.
            </p>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="secondary"
              onClick={clearFilters}
              disabled={loadingRows || loadingSummary}
            >
              <X size={16} />
              Clear Filters
            </button>
          )}
        </div>

        <form className="dynamic-form" onSubmit={searchReport}>
          <label>
            Tenant ID
            <input
              value={filters.tenant_id}
              onChange={(e) => updateFilter('tenant_id', e.target.value)}
              placeholder="For Super Admin only"
            />
          </label>

          <label>
            Employee ID
            <input
              value={filters.employee_id}
              onChange={(e) => updateFilter('employee_id', e.target.value)}
              placeholder="Employee Mongo ID"
            />
          </label>

          <label>
            Department
            <input
              value={filters.department}
              onChange={(e) => updateFilter('department', e.target.value)}
              placeholder="Department"
            />
          </label>

          <label>
            Status
            <input
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
              placeholder="present / pending / approved"
            />
          </label>

          <label>
            Mode
            <select
              value={filters.mode}
              onChange={(e) => updateFilter('mode', e.target.value)}
            >
              <option value="">All Modes</option>
              <option value="office">Office</option>
              <option value="wfh">Work From Home</option>
              <option value="field">Field</option>
            </select>
          </label>

          <label>
            State
            <select
              value={filters.state}
              onChange={(e) => updateFilter('state', e.target.value)}
            >
              <option value="">All States</option>
              {HOLIDAY_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </label>

          <label>
            Leave Type
            <select
              value={filters.leave_type}
              onChange={(e) => updateFilter('leave_type', e.target.value)}
            >
              <option value="">All Leave Types</option>
              <option value="CL">Casual Leave (CL)</option>
              <option value="EL">Earned Leave (EL)</option>
              <option value="COMP-OFF">Comp-Off</option>
            </select>
          </label>

          <label>
            Date From
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) => updateFilter('date_from', e.target.value)}
            />
          </label>

          <label>
            Date To
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) => updateFilter('date_to', e.target.value)}
            />
          </label>

          {activeTab === 'audit' && (
            <>
              <label>
                Audit Action
                <input
                  value={filters.action}
                  onChange={(e) => updateFilter('action', e.target.value)}
                  placeholder="login / create / update"
                />
              </label>

              <label>
                Audit Entity
                <input
                  value={filters.entity}
                  onChange={(e) => updateFilter('entity', e.target.value)}
                  placeholder="users / employees"
                />
              </label>

              <label>
                Actor Email
                <input
                  value={filters.actor_email}
                  onChange={(e) => updateFilter('actor_email', e.target.value)}
                  placeholder="user@email.com"
                />
              </label>
            </>
          )}

          <button
            type="submit"
            className="primary"
            disabled={loadingRows || loadingSummary}
          >
            <Search size={16} />
            {loadingRows ? 'Searching...' : 'Search Report'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={clearFilters}
            disabled={loadingRows || loadingSummary}
          >
            Clear
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>{currentTab?.title || 'Report'}</h3>
            <p>
              Showing latest records based on selected report and filters.
            </p>
          </div>
        </div>

        <div className="report-tab-row">
          {REPORT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={activeTab === tab.key ? 'selected' : ''}
              onClick={() => changeTab(tab.key)}
              disabled={loadingRows}
            >
              {tab.title}
            </button>
          ))}
        </div>

        {loadingRows && <div className="inline-message">Loading report...</div>}

        <Table rows={rows} maxColumns={12} />
      </section>
    </div>
  );
}