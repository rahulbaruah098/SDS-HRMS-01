import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Search, X } from 'lucide-react';
import {
  api,
  downloadAttendanceRegisterExcel,
  getActiveOrganisations,
} from '../api/client';
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
    key: 'leave-approvals',
    title: 'Leave Approvals',
    endpoint: '/reports/leave-approvals',
  },
  {
    key: 'leave-deductions',
    title: 'Leave Deductions',
    endpoint: '/reports/leave-deductions',
  },
  {
    key: 'leave-records',
    title: 'Leave Records',
    endpoint: '/reports/leave-records',
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


const EMPTY_ATTENDANCE_EXCEL_FILTERS = {
  period: 'month',
  year: String(new Date().getFullYear()),
  month: String(new Date().getMonth() + 1),
  date: new Date().toISOString().slice(0, 10),
  week_start: '',
  week_end: '',
  organisation_id: '',
  organisation_code: '',
  organisation: '',
  state: '',
};

const EMPTY_FILTERS = {
  tenant_id: '',
  employee_id: '',
  department: '',
  status: '',
  mode: '',
  state: '',
  leave_type: '',
  approval_stage: '',
  live_status: '',
  balance_deducted: '',
  task_handover_to_id: '',
  project_handover_id: '',
  period: '',
  on_date: '',
  date_from: '',
  date_to: '',
  action: '',
  entity: '',
  actor_email: '',
};

const LEAVE_REPORT_TABS = [
  'leave-requests',
  'leave-records',
  'leave-approvals',
  'leave-deductions',
];

const LEAVE_RELATED_TABS = [
  ...LEAVE_REPORT_TABS,
  'leave-balances',
];

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

function modeLabel(mode) {
  if (mode === 'wfh') return 'Work From Home';
  if (mode === 'field') return 'Field';
  if (mode === 'office') return 'Office';
  return mode || '—';
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
    normalized === 'HALFDAY' ||
    normalized === 'HD'
  ) {
    return 'Half Day';
  }

  if (
    normalized === 'LWP' ||
    normalized === 'LEAVE WITHOUT PAY' ||
    normalized === 'LOSS OF PAY'
  ) {
    return 'Leave Without Pay';
  }

  return value || '—';
}


function leaveRequestTypeLabel(row = {}) {
  return leaveTypeLabel(
    row.requested_leave_type_label ||
      row.requested_leave_type ||
      row.leave_type_label ||
      row.leave_type,
  );
}

function deductedLeaveTypeLabel(row = {}) {
  const status = String(row.status || '').toLowerCase();

  if (status !== 'approved') {
    return '—';
  }

  return leaveTypeLabel(
    row.deducted_leave_type_label ||
      row.deducted_leave_type ||
      row.leave_type_label ||
      row.leave_type,
  );
}

function lwpDaysLabel(row = {}) {
  const value = Number(row.lwp_days || 0);

  return value > 0 ? value : '—';
}

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}


function organisationOptionLabel(organisation = {}) {
  const name =
    organisation.name ||
    organisation.organisation_name ||
    organisation.organization_name ||
    '';

  const code =
    organisation.code ||
    organisation.organisation_code ||
    organisation.organization_code ||
    '';

  if (name && code) {
    return `${name} (${code})`;
  }

  return name || code || 'Organisation';
}

function normalizeRows(tab, rows = []) {
  if (tab === 'attendance') {
    return rows.map((row) => ({
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      state: row.state || '—',
      date: formatDate(row.date),
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
      date: formatDate(row.date),
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
      date: formatDate(row.date),
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
      earned_date: formatDate(row.earned_date),
      valid_until: formatDate(row.valid_until),
      claimed_date: formatDate(row.claimed_date),
      holiday: row.holiday_title || '—',
      status: statusLabel(row.status),
    }));
  }

  if (tab === 'leave-balances') {
    return rows.map((row) => ({
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
      opening_balance: row.opening_balance ?? '—',
      credited: row.credited ?? '—',
      used_deducted: row.used_deducted ?? row.used ?? '—',
      available_balance: row.available_balance ?? row.available ?? '—',
      status: statusLabel(row.status),
    }));
  }

if (
  tab === 'leave-requests' ||
  tab === 'leave-records' ||
  tab === 'leave-approvals' ||
  tab === 'leave-deductions'
) {
  return rows.map((row) => ({
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    leave_type: leaveRequestTypeLabel(row),
    deducted_from: deductedLeaveTypeLabel(row),
    lwp_days: lwpDaysLabel(row),
    from_date: formatDate(row.from_date),
    upto_date: formatDate(row.to_date || row.upto_date),
    leave_days: row.leave_days ?? '—',
    reason: row.reason || '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    team_leader: row.team_leader_name || '—',
    reporting_officer: row.reporting_officer_name || '—',
    current_stage: row.live_status || row.status_text || row.current_approval_stage || row.approval_stage_label || statusLabel(row.approval_stage),
    final_status: statusLabel(row.status),
    deducted: yesNo(row.deducted_from_balance || row.balance_deducted),
    approved_by: row.approved_by_name || '—',
    approved_at: formatDateTime(row.approved_at || row.decided_at),
    created_at: formatDateTime(row.created_at),
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

function normalizeLeaveSummary(summary = {}) {
  const safeSummary = summary || {};

  return {
    total: safeSummary.total || 0,
    pending: safeSummary.pending || 0,
    approved: safeSummary.approved || 0,
    rejected: safeSummary.rejected || 0,
    pending_with_team_leader: safeSummary.pending_with_team_leader || 0,
    pending_with_reporting_officer: safeSummary.pending_with_reporting_officer || 0,
    pending_with_hr: safeSummary.pending_with_hr || 0,
    casual_leave: safeSummary.casual_leave || 0,
    earned_leave: safeSummary.earned_leave || 0,
    comp_off: safeSummary.comp_off || 0,
    half_day: safeSummary.half_day || 0,
    lwp: safeSummary.lwp || 0,
    total_days: safeSummary.total_days || 0,
    deducted_days: safeSummary.deducted_days || 0,
    not_deducted_days: safeSummary.not_deducted_days || 0,
  };
}

function normalizeBalanceSummary(summary = {}) {
  const safeSummary = summary || {};

  return {
    employees: safeSummary.employees || 0,
    casual_credited: safeSummary.casual_credited || 0,
    casual_used: safeSummary.casual_used || 0,
    casual_available: safeSummary.casual_available || 0,
    earned_credited: safeSummary.earned_credited || 0,
    earned_used: safeSummary.earned_used || 0,
    earned_available: safeSummary.earned_available || 0,
    total_credited: safeSummary.total_credited || 0,
    total_used_deducted: safeSummary.total_used_deducted || 0,
    total_available: safeSummary.total_available || 0,
  };
}

export default function Reports() {
  const [summary, setSummary] = useState(null);
  const [activeTab, setActiveTab] = useState('attendance');
  const [rows, setRows] = useState([]);
  const [tabSummary, setTabSummary] = useState(null);
  const [message, setMessage] = useState('');
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
    const [organisations, setOrganisations] = useState([]);
  const [excelFilters, setExcelFilters] = useState({
    ...EMPTY_ATTENDANCE_EXCEL_FILTERS,
  });
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  const currentTab = REPORT_TABS.find((tab) => tab.key === activeTab);

  const hasActiveFilters = useMemo(() => {
    return Object.values(filters).some((value) => String(value || '').trim());
  }, [filters]);

  const showLeaveAdvancedFilters = LEAVE_REPORT_TABS.includes(activeTab);
  const showLeaveFilters = LEAVE_RELATED_TABS.includes(activeTab);
  const showBalanceDeductionFilter = ['leave-requests', 'leave-records'].includes(activeTab);

  function activeTabFilters(tabKey = activeTab, nextFilters = filters) {
    const payload = { ...nextFilters };

    if (!LEAVE_REPORT_TABS.includes(tabKey)) {
      delete payload.approval_stage;
      delete payload.live_status;
      delete payload.task_handover_to_id;
      delete payload.project_handover_id;
      delete payload.period;
      delete payload.on_date;
      delete payload.balance_deducted;
    }

    if (!['leave-requests', 'leave-records'].includes(tabKey)) {
      delete payload.live_status;
      delete payload.balance_deducted;
    }

    if (!['attendance', 'attendance-mode-requests'].includes(tabKey)) {
      delete payload.mode;
    }

    if (!['attendance', 'attendance-mode-requests', 'holidays'].includes(tabKey)) {
      delete payload.state;
    }

    if (!LEAVE_RELATED_TABS.includes(tabKey)) {
      delete payload.leave_type;
    }

    if (tabKey !== 'audit') {
      delete payload.action;
      delete payload.entity;
      delete payload.actor_email;
    }

    return payload;
  }

  async function loadOrganisations() {
    try {
      const data = await getActiveOrganisations({ limit: 500 });
      setOrganisations(data.items || []);
    } catch {
      setOrganisations([]);
    }
  }

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
      setTabSummary(null);

      const filteredPayload = activeTabFilters(tabKey, nextFilters);
      const data = await api(`${selectedTab.endpoint}${buildQuery(filteredPayload)}`);

      setRows(normalizeRows(tabKey, data.items || []));
      setTabSummary(data.summary || null);
    } catch (error) {
      setRows([]);
      setTabSummary(null);
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
    loadOrganisations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeTab(tabKey) {
    setActiveTab(tabKey);
    setRows([]);
    setTabSummary(null);
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

  function updateExcelFilter(key, value) {
    setExcelFilters((current) => {
      const next = {
        ...current,
        [key]: value,
      };

      if (key === 'organisation_id') {
        const selected = organisations.find((organisation) => {
          const id = organisation.id || organisation._id || '';
          return id === value;
        });

        next.organisation = selected
          ? selected.name || selected.organisation_name || selected.organization_name || ''
          : '';

        next.organisation_code = selected
          ? selected.code || selected.organisation_code || selected.organization_code || ''
          : '';
      }

      return next;
    });
  }

  async function handleAttendanceExcelDownload(event) {
    event.preventDefault();

    if (!excelFilters.organisation_id && !excelFilters.organisation_code && !excelFilters.organisation) {
      setMessage('Please select Organisation / Entity before downloading the attendance Excel.');
      return;
    }

    setDownloadingExcel(true);
    setMessage('');

    try {
      const payload = {
        period: excelFilters.period,
        organisation_id: excelFilters.organisation_id,
        organisation_code: excelFilters.organisation_code,
        organisation: excelFilters.organisation,
        state: excelFilters.state,
      };

      if (excelFilters.period === 'day') {
        payload.date = excelFilters.date;
      } else if (excelFilters.period === 'week') {
        payload.week_start = excelFilters.week_start;
        payload.week_end = excelFilters.week_end;
      } else {
        payload.year = excelFilters.year;
        payload.month = excelFilters.month;
      }

      await downloadAttendanceRegisterExcel(payload);
      setMessage('Attendance Excel downloaded successfully.');
    } catch (error) {
      setMessage(error.message || 'Unable to download attendance Excel report.');
    } finally {
      setDownloadingExcel(false);
    }
  }

  const counts = summary?.counts || {};
  const extra = summary?.extra || {};
  const leaveSummary = normalizeLeaveSummary(tabSummary);
  const balanceSummary = normalizeBalanceSummary(tabSummary || extra?.leave?.balance_summary);

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
            balances, leave workflow approvals, leave deductions, and audit logs
            from one reporting screen.
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
          <h3>Leave Workflow Summary</h3>

          <div className="mini-list">
            <span>
              <strong>Pending with Team Leader</strong>
              <small>{extra?.leave?.pending_with_team_leader || 0}</small>
            </span>

            <span>
              <strong>Pending with Reporting Officer</strong>
              <small>{extra?.leave?.pending_with_reporting_officer || 0}</small>
            </span>

            <span>
              <strong>Approved & Deducted</strong>
              <small>{extra?.leave?.approved_and_deducted || 0}</small>
            </span>

            <span>
              <strong>Total Used / Deducted</strong>
              <small>{extra?.leave?.balance_summary?.total_used_deducted || 0}</small>
            </span>
          </div>
        </div>
      </section>

        {showLeaveAdvancedFilters && (
          <section className="stats-grid">
            <Stat label="Filtered Leaves" value={leaveSummary.total} />
            <Stat label="Pending" value={leaveSummary.pending} />
            <Stat label="Approved" value={leaveSummary.approved} />
            <Stat label="Rejected" value={leaveSummary.rejected} />
            <Stat label="Pending TL" value={leaveSummary.pending_with_team_leader} />
            <Stat label="Pending RO" value={leaveSummary.pending_with_reporting_officer} />
            <Stat label="Half Day" value={leaveSummary.half_day} />
            <Stat label="LWP Days" value={leaveSummary.lwp} />
            <Stat label="Deducted Days" value={leaveSummary.deducted_days} />
            <Stat label="Total Leave Days" value={leaveSummary.total_days} />
          </section>
        )}

      {activeTab === 'leave-balances' && (
        <section className="stats-grid">
          <Stat label="Employees" value={balanceSummary.employees} />
          <Stat label="CL Credited" value={balanceSummary.casual_credited} />
          <Stat label="CL Used" value={balanceSummary.casual_used} />
          <Stat label="CL Available" value={balanceSummary.casual_available} />
          <Stat label="EL Credited" value={balanceSummary.earned_credited} />
          <Stat label="EL Used" value={balanceSummary.earned_used} />
          <Stat label="EL Available" value={balanceSummary.earned_available} />
          <Stat label="Total Available" value={balanceSummary.total_available} />
        </section>
      )}

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Styled Attendance Excel Export</h3>
            <p>
              Download entity-wise attendance register in Excel format with
              colours, borders, attendance codes, leave counts, and day-wise
              columns.
            </p>
          </div>
        </div>

        <form className="dynamic-form" onSubmit={handleAttendanceExcelDownload}>
          <label>
            Organisation / Entity
            <select
              value={excelFilters.organisation_id}
              onChange={(e) => updateExcelFilter('organisation_id', e.target.value)}
              required
            >
              <option value="">Select Organisation / Entity</option>
              {organisations.map((organisation) => {
                const id = organisation.id || organisation._id || '';
                return (
                  <option key={id || organisation.code || organisation.name} value={id}>
                    {organisationOptionLabel(organisation)}
                  </option>
                );
              })}
            </select>
          </label>

          <label>
            State
            <select
              value={excelFilters.state}
              onChange={(e) => updateExcelFilter('state', e.target.value)}
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
            Export Period
            <select
              value={excelFilters.period}
              onChange={(e) => updateExcelFilter('period', e.target.value)}
            >
              <option value="month">Month Wise</option>
              <option value="week">Week Wise</option>
              <option value="day">Day Wise</option>
            </select>
          </label>

          {excelFilters.period === 'month' && (
            <>
              <label>
                Year
                <input
                  type="number"
                  value={excelFilters.year}
                  onChange={(e) => updateExcelFilter('year', e.target.value)}
                  min="2020"
                  max="2100"
                  required
                />
              </label>

              <label>
                Month
                <select
                  value={excelFilters.month}
                  onChange={(e) => updateExcelFilter('month', e.target.value)}
                  required
                >
                  <option value="1">January</option>
                  <option value="2">February</option>
                  <option value="3">March</option>
                  <option value="4">April</option>
                  <option value="5">May</option>
                  <option value="6">June</option>
                  <option value="7">July</option>
                  <option value="8">August</option>
                  <option value="9">September</option>
                  <option value="10">October</option>
                  <option value="11">November</option>
                  <option value="12">December</option>
                </select>
              </label>
            </>
          )}

          {excelFilters.period === 'week' && (
            <>
              <label>
                Week Start
                <input
                  type="date"
                  value={excelFilters.week_start}
                  onChange={(e) => updateExcelFilter('week_start', e.target.value)}
                  required
                />
              </label>

              <label>
                Week End
                <input
                  type="date"
                  value={excelFilters.week_end}
                  onChange={(e) => updateExcelFilter('week_end', e.target.value)}
                  required
                />
              </label>
            </>
          )}

          {excelFilters.period === 'day' && (
            <label>
              Date
              <input
                type="date"
                value={excelFilters.date}
                onChange={(e) => updateExcelFilter('date', e.target.value)}
                required
              />
            </label>
          )}

          <button
            type="submit"
            className="primary"
            disabled={downloadingExcel}
          >
            {downloadingExcel ? 'Downloading...' : 'Download Styled Attendance Excel'}
          </button>
        </form>
      </section>


      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Report Filters</h3>
            <p>
              Use filters according to the active report. Leave workflow reports
              support approval stage, live status, deduction status, and period filters.
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
            <select
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="in_review">In Review</option>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="early_checkout">Early Checkout</option>
              <option value="holiday_work">Holiday Work</option>
              <option value="available">Available</option>
              <option value="claimed">Claimed</option>
            </select>
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

          {showLeaveFilters && (
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
          )}

          {showLeaveAdvancedFilters && (
            <>
              <label>
                Period
                <select
                  value={filters.period}
                  onChange={(e) => updateFilter('period', e.target.value)}
                >
                  <option value="">Custom Date Range</option>
                  <option value="today">Today</option>
                  <option value="day">Specific Day</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="year">This Year</option>
                </select>
              </label>

              <label>
                On Date
                <input
                  type="date"
                  value={filters.on_date}
                  onChange={(e) => updateFilter('on_date', e.target.value)}
                />
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
            </>
          )}

          {showBalanceDeductionFilter && (
            <label>
              Balance Deducted
              <select
                value={filters.balance_deducted}
                onChange={(e) => updateFilter('balance_deducted', e.target.value)}
              >
                <option value="">All</option>
                <option value="true">Deducted</option>
                <option value="false">Not Deducted</option>
              </select>
            </label>
          )}

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

        <Table rows={rows} maxColumns={16} />
      </section>
    </div>
  );
}