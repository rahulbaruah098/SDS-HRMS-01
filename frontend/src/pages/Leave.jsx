import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Filter,
  RefreshCcw,
  Search,
  XCircle,
} from 'lucide-react';
import {
  getLeaveRequestReports,
  getActiveEmployees,
  downloadCsv,
} from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const today = new Date().toISOString().slice(0, 10);

const EMPTY_FILTERS = {
  period: 'today',
  on_date: today,
  date_from: '',
  date_to: '',
  employee_id: '',
  leave_type: '',
  status: '',
  approval_stage: '',
  live_status: '',
};

const LEAVE_COLUMNS = [
  ['employee_name', 'Employee'],
  ['employee_code', 'Employee Code'],
  ['department', 'Department'],
  ['designation', 'Designation'],
  ['leave_type_label', 'Leave Type'],
  ['day_type_label', 'Day Type'],
  ['from_date', 'From Date'],
  ['to_date', 'To Date'],
  ['leave_days', 'Leave Days'],
  ['lwp_days', 'LWP Days'],
  ['compoff_holiday_title', 'Comp-Off Holiday'],
  ['compoff_earned_date', 'Comp-Off Earned Date'],
  ['compoff_available_from', 'Comp-Off Claim From'],
  ['compoff_valid_until', 'Comp-Off Valid Until'],
  ['holiday_work_request_id', 'Holiday Work Request ID'],
  ['attendance_log_id', 'Attendance Log ID'],
  ['live_status', 'Current Status'],
  ['approval_stage_label', 'Approval Stage'],
  ['reason', 'Reason'],
  ['created_at', 'Applied On'],
];

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

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function leaveTypeLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized === 'CL' || normalized === 'CASUAL LEAVE') {
    return 'Casual Leave';
  }

  if (normalized === 'EL' || normalized === 'EARNED LEAVE') {
    return 'Earned Leave';
  }

  if (normalized === 'COMP-OFF' || normalized === 'COMPOFF') {
    return 'Comp-Off';
  }

  if (
    normalized === 'HALF-DAY' ||
    normalized === 'HALF DAY' ||
    normalized === 'HALFDAY'
  ) {
    return 'Half Day';
  }

  if (normalized === 'LWP' || normalized === 'LEAVE WITHOUT PAY') {
    return 'Leave Without Pay';
  }

  return value || 'Leave';
}

function isCompOffLeave(row = {}) {
  const leaveType = String(
    row.leave_type ||
      row.requested_leave_type ||
      row.leave_type_label ||
      row.requested_leave_type_label ||
      '',
  ).toUpperCase();

  return leaveType === 'COMP-OFF' || leaveType === 'COMPOFF';
}

function employeeOptionLabel(employee = {}) {
  const name =
    employee.name ||
    employee.employee_name ||
    employee.full_name ||
    employee.email ||
    'Employee';

  const code =
    employee.employee_code ||
    employee.emp_code ||
    employee.employee_id ||
    employee.code ||
    '';

  const designation =
    employee.designation ||
    employee.designation_name ||
    '';

  const meta = [code, designation].filter(Boolean).join(' • ');

  return meta ? `${name} (${meta})` : name;
}

function normalizeLeaveRow(row = {}) {
  const requestedLeaveType =
    row.requested_leave_type_label ||
    row.requested_leave_type ||
    row.leave_type_label ||
    row.leave_type ||
    '';

  const isHalfDay =
    Boolean(row.is_half_day) ||
    String(row.day_type || '').toLowerCase() === 'half_day' ||
    String(row.requested_leave_type || row.leave_type || '').toUpperCase() === 'HALF-DAY' ||
    Number(row.leave_days || 0) === 0.5;

  const liveStatus =
    row.live_status ||
    row.status_text ||
    row.status_display ||
    row.current_approval_stage ||
    row.approval_stage_label ||
    statusLabel(row.status);

  return {
    ...row,
    id: row.id || row._id || '',
    employee_name: row.employee_name || row.name || 'Employee',
    employee_code: row.employee_code || row.emp_code || row.employee_id || '—',
    department: row.department || row.department_name || '—',
    designation: row.designation || row.designation_name || '—',
    leave_type_label: leaveTypeLabel(requestedLeaveType),
    day_type_label: isHalfDay ? 'Half Day' : 'Full Day',
    from_date_display: formatDate(row.from_date || row.date),
    to_date_display: formatDate(row.to_date || row.upto_date || row.from_date || row.date),
    created_at_display: formatDateTime(row.created_at),
    approved_at_display: formatDateTime(row.approved_at || row.decided_at),
    live_status: liveStatus,
    approval_stage_label: row.approval_stage_label || statusLabel(row.approval_stage),
    lwp_days: Number(row.lwp_days || 0),
    leave_days: row.leave_days ?? '—',
    reason: row.reason || '—',

    is_compoff_leave: isCompOffLeave(row),
    compoff_id: row.compoff_id || row.compoff_credit_id || '',
    compoff_holiday_title: row.compoff_holiday_title || row.holiday_title || '—',
    compoff_earned_date: formatDate(row.compoff_earned_date),
    compoff_available_from: formatDate(row.compoff_available_from),
    compoff_valid_until: formatDate(row.compoff_valid_until),
    holiday_work_request_id: row.holiday_work_request_id || '—',
    attendance_log_id: row.attendance_log_id || '—',
  };
}

function normalizeLeaveRows(rows = []) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => normalizeLeaveRow(row));
}

function buildReportParams(filters = {}) {
  const payload = {
    employee_id: filters.employee_id,
    leave_type: filters.leave_type,
    status: filters.status,
    approval_stage: filters.approval_stage,
    live_status: filters.live_status,
  };

  if (filters.period === 'today') {
    payload.period = 'day';
    payload.on_date = today;
  } else if (filters.period === 'day') {
    payload.period = 'day';
    payload.on_date = filters.on_date || today;
  } else if (filters.period === 'week') {
    payload.period = 'week';
    payload.on_date = filters.on_date || today;
  } else if (filters.period === 'month') {
    payload.period = 'month';
    payload.on_date = filters.on_date || today;
  } else if (filters.period === 'year') {
    payload.period = 'year';
    payload.on_date = filters.on_date || today;
  } else if (filters.period === 'custom') {
    payload.date_from = filters.date_from;
    payload.date_to = filters.date_to;
  }

  return payload;
}

function leaveStatusClass(value = '') {
  const status = String(value || '').toLowerCase();

  if (status.includes('approved')) return 'leave-status approved';
  if (status.includes('rejected')) return 'leave-status rejected';
  if (status.includes('pending')) return 'leave-status pending';

  return 'leave-status neutral';
}

export default function Leave() {
  const alerts = useCustomAlert();

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  const normalizedRows = useMemo(() => normalizeLeaveRows(rows), [rows]);

  const computedSummary = useMemo(() => {
    const total = normalizedRows.length;
    const pending = normalizedRows.filter((row) =>
      String(row.live_status || row.status || '').toLowerCase().includes('pending')
    ).length;
    const approved = normalizedRows.filter((row) =>
      String(row.live_status || row.status || '').toLowerCase().includes('approved')
    ).length;
    const rejected = normalizedRows.filter((row) =>
      String(row.live_status || row.status || '').toLowerCase().includes('rejected')
    ).length;
    const halfDay = normalizedRows.filter((row) => row.day_type_label === 'Half Day').length;
    const lwp = normalizedRows.reduce((sum, row) => sum + Number(row.lwp_days || 0), 0);

    return {
      total: summary.total ?? total,
      pending: summary.pending ?? pending,
      approved: summary.approved ?? approved,
      rejected: summary.rejected ?? rejected,
      half_day: summary.half_day ?? halfDay,
      lwp: summary.lwp ?? lwp,
    };
  }, [normalizedRows, summary]);

  async function loadEmployees() {
    try {
      setLoadingEmployees(true);

      const data = await getActiveEmployees({
        limit: 1000,
        employee_scope: 'active',
      });

      setEmployees(data.items || []);
    } catch (error) {
      setEmployees([]);
      alerts.error(
        error.message || 'Unable to load employee list.',
        'Employee List Failed',
      );
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadLeaves(nextFilters = filters, options = {}) {
    const errorTitle = options.errorTitle || 'Leave Records Load Failed';

    try {
      setLoading(true);

      const data = await getLeaveRequestReports(buildReportParams(nextFilters));

      setRows(data.items || []);
      setSummary(data.summary || {});
    } catch (error) {
      setRows([]);
      setSummary({});
      alerts.error(
        error.message || 'Unable to load leave records.',
        errorTitle,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEmployees();
    loadLeaves({ ...EMPTY_FILTERS });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(key, value) {
    setFilters((current) => {
      const next = {
        ...current,
        [key]: value,
      };

      if (key === 'period') {
        if (value === 'today') {
          next.on_date = today;
          next.date_from = '';
          next.date_to = '';
        }

        if (['day', 'week', 'month', 'year'].includes(value) && !next.on_date) {
          next.on_date = today;
        }

        if (value !== 'custom') {
          next.date_from = '';
          next.date_to = '';
        }
      }

      return next;
    });
  }

  async function handleSearch(event) {
    event.preventDefault();
    await loadLeaves(filters, { errorTitle: 'Search Failed' });
  }

  async function handleReset() {
    const cleared = { ...EMPTY_FILTERS };
    setFilters(cleared);
    await loadLeaves(cleared, { errorTitle: 'Reset Failed' });
  }

function handleCsvExport() {
  if (!normalizedRows.length) {
    alerts.warning('There are no leave records to export.', 'Export Not Available');
    return;
  }

  const exportRows = normalizedRows.map((row) => ({
    ...row,
    from_date: row.from_date_display,
    to_date: row.to_date_display,
    created_at: row.created_at_display,
    compoff_holiday_title: row.is_compoff_leave ? row.compoff_holiday_title : '',
    compoff_earned_date: row.is_compoff_leave ? row.compoff_earned_date : '',
    compoff_available_from: row.is_compoff_leave ? row.compoff_available_from : '',
    compoff_valid_until: row.is_compoff_leave ? row.compoff_valid_until : '',
    holiday_work_request_id: row.is_compoff_leave ? row.holiday_work_request_id : '',
    attendance_log_id: row.is_compoff_leave ? row.attendance_log_id : '',
  }));

  downloadCsv('hr-leave-management.csv', exportRows, LEAVE_COLUMNS);
  alerts.success('Leave records CSV export is ready.', 'Export Ready');
}

  return (
    <div className="page-grid leave-management-page">
      <section className="hero compact leave-hero">
        <div>
          <span className="kicker">HR Leave Management</span>
          <h1>Leave Records & Daily Availability</h1>
      <p>
        Review today&apos;s leave records by default, track approval status,
        comp-off claims, holiday work references, and filter historical leave
        records by employee, leave type, date range, status, and approval stage.
      </p>
        </div>

        <button
          type="button"
          className="secondary"
          onClick={() => loadLeaves(filters, { errorTitle: 'Refresh Failed' })}
          disabled={loading}
        >
          <RefreshCcw size={16} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <span>Total Leaves</span>
          <strong>{computedSummary.total}</strong>
          <small>Filtered records</small>
        </div>

        <div className="stat-card">
          <span>Pending</span>
          <strong>{computedSummary.pending}</strong>
          <small>Awaiting action</small>
        </div>

        <div className="stat-card">
          <span>Approved</span>
          <strong>{computedSummary.approved}</strong>
          <small>Confirmed leaves</small>
        </div>

        <div className="stat-card">
          <span>Rejected</span>
          <strong>{computedSummary.rejected}</strong>
          <small>Rejected requests</small>
        </div>

        <div className="stat-card">
          <span>Half Day</span>
          <strong>{computedSummary.half_day}</strong>
          <small>Half-day records</small>
        </div>

        <div className="stat-card">
          <span>LWP Days</span>
          <strong>{computedSummary.lwp}</strong>
          <small>Leave without pay</small>
        </div>
      </section>

      <section className="panel leave-filter-panel">
        <div className="toolbar">
          <div>
            <h3>Leave Filters</h3>
            <p>
              Today&apos;s leave is shown by default. Change the period or use
              custom dates to view previous records.
            </p>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={handleCsvExport}
            disabled={!normalizedRows.length}
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>

        <form className="dynamic-form" onSubmit={handleSearch}>
          <label>
            Period
            <select
              value={filters.period}
              onChange={(e) => updateFilter('period', e.target.value)}
            >
              <option value="today">Today</option>
              <option value="day">Specific Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </label>

          {filters.period !== 'custom' && (
            <label>
              Reference Date
              <input
                type="date"
                value={filters.on_date}
                onChange={(e) => updateFilter('on_date', e.target.value)}
              />
            </label>
          )}

          {filters.period === 'custom' && (
            <>
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
            </>
          )}

          <label>
            Employee
            <select
              value={filters.employee_id}
              onChange={(e) => updateFilter('employee_id', e.target.value)}
              disabled={loadingEmployees}
            >
              <option value="">All Employees</option>
              {employees.map((employee) => {
                const id = employee.id || employee._id || '';
                return (
                  <option
                    key={id || employee.employee_code || employee.email}
                    value={id}
                  >
                    {employeeOptionLabel(employee)}
                  </option>
                );
              })}
            </select>
          </label>

          <label>
            Leave Type
            <select
              value={filters.leave_type}
              onChange={(e) => updateFilter('leave_type', e.target.value)}
            >
              <option value="">All Leave Types</option>
              <option value="CL">Casual Leave</option>
              <option value="EL">Earned Leave</option>
              <option value="COMP-OFF">Comp-Off</option>
              <option value="HALF-DAY">Half Day</option>
              <option value="LWP">Leave Without Pay</option>
            </select>
          </label>

          <label>
            Status
            <select
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>

          <label>
            Approval Stage
            <select
              value={filters.approval_stage}
              onChange={(e) => updateFilter('approval_stage', e.target.value)}
            >
              <option value="">All Stages</option>
              <option value="team_leader">Team Leader</option>
              <option value="reporting_officer">Reporting Officer</option>
              <option value="hr">HR</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>

          <label>
            Live Status
            <select
              value={filters.live_status}
              onChange={(e) => updateFilter('live_status', e.target.value)}
            >
              <option value="">All Live Status</option>
              <option value="pending_with_team_leader">Pending with Team Leader</option>
              <option value="pending_with_reporting_officer">Pending with Reporting Officer</option>
              <option value="pending_with_hr">Pending with HR</option>
            </select>
          </label>

          <button
            type="submit"
            className="primary"
            disabled={loading}
          >
            <Search size={16} />
            {loading ? 'Searching...' : 'Search Leaves'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={handleReset}
            disabled={loading}
          >
            <Filter size={16} />
            Reset Today
          </button>
        </form>
      </section>

      <section className="panel leave-record-panel">
        <div className="toolbar">
          <div>
            <h3>Leave Records</h3>
            <p>
              {filters.period === 'today'
                ? 'Showing leave records for today.'
                : 'Showing leave records based on selected filters.'}
            </p>
          </div>
        </div>

        {loading && <div className="inline-message">Loading leave records...</div>}

        {!loading && !normalizedRows.length && (
          <div className="empty-state">
            <CalendarDays size={34} />
            <h3>No leave records found</h3>
            <p>No employees are on leave for the selected period or filters.</p>
          </div>
        )}

        {!!normalizedRows.length && (
          <div className="leave-card-grid">
            {normalizedRows.map((row) => (
              <article key={row.id || `${row.employee_name}-${row.from_date_display}`} className="leave-card">
                <div className="leave-card-head">
                  <div>
                    <h3>{row.employee_name}</h3>
                    <p>
                      {row.employee_code} • {row.department} • {row.designation}
                    </p>
                  </div>

                  <span className={leaveStatusClass(row.live_status)}>
                    {row.live_status}
                  </span>
                </div>

                <div className="leave-card-body">
                  <span>
                    <small>Leave Type</small>
                    <strong>{row.leave_type_label}</strong>
                  </span>

                  <span>
                    <small>Day Type</small>
                    <strong>{row.day_type_label}</strong>
                  </span>

                  <span>
                    <small>From</small>
                    <strong>{row.from_date_display}</strong>
                  </span>

                  <span>
                    <small>To</small>
                    <strong>{row.to_date_display}</strong>
                  </span>

                  <span>
                    <small>Leave Days</small>
                    <strong>{row.leave_days}</strong>
                  </span>

                  <span>
                    <small>LWP Days</small>
                    <strong>{row.lwp_days || '—'}</strong>
                  </span>

                  {row.is_compoff_leave && (
                    <>
                      <span>
                        <small>Comp-Off Holiday</small>
                        <strong>{row.compoff_holiday_title}</strong>
                      </span>

                      <span>
                        <small>Claim Window</small>
                        <strong>
                          {row.compoff_available_from} to {row.compoff_valid_until}
                        </strong>
                      </span>
                    </>
                  )}

                </div>

                <div className="leave-card-footer">
                  <div>
                    <small>Reason</small>
                    <p>{row.reason}</p>

                    {row.is_compoff_leave && (
                      <p>
                        Comp-Off Credit: {row.compoff_id || '—'} <br />
                        Holiday Work Request: {row.holiday_work_request_id} <br />
                        Attendance Log: {row.attendance_log_id}
                      </p>
                    )}
                  </div>

                  <div className="leave-meta-row">
                    <span>
                      <Clock3 size={14} />
                      Applied: {row.created_at_display}
                    </span>

                    <span>
                      {String(row.live_status || '').toLowerCase().includes('approved') ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <XCircle size={14} />
                      )}
                      Stage: {row.approval_stage_label}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}