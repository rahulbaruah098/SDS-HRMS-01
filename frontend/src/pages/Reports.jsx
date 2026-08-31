import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Search, X } from 'lucide-react';
import {
  api,
  downloadAttendanceExceptionExcel,
  downloadAttendanceRegisterExcel,
  getActiveEmployees,
  getActiveOrganisations,
  getAttendanceExceptionReports,
} from '../api/client';
import Table from '../components/Table';
import Stat from '../components/Stat';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const REPORT_TABS = [
  {
    key: 'attendance',
    title: 'Attendance Report',
    endpoint: '/reports/attendance',
  },
  {
    key: 'field-attendance',
    title: 'Field Attendance',
    endpoint: '/reports/field-attendance',
  },
  {
    key: 'holiday-work-requests',
    title: 'Holiday Work',
    endpoint: '/reports/holiday-work-requests',
  },
  {
    key: 'holidays',
    title: 'Holiday Calendar',
    endpoint: '/reports/holidays',
  },
  {
    key: 'compoffs',
    title: 'Comp-Off Credits',
    endpoint: '/reports/compoffs',
  },
  {
    key: 'compoff-claims',
    title: 'Comp-Off Claims',
    endpoint: '/reports/compoff-claims',
  },
  {
    key: 'expired-compoffs',
    title: 'Expired Comp-Off',
    endpoint: '/reports/expired-compoffs',
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
  employee_id: '',
  employee_code: '',
  employee_email: '',
  employee_name: '',
};

const EMPTY_ATTENDANCE_EXCEPTION_FILTERS = {
  report_type: 'absent',
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
  employee_id: '',
  employee_code: '',
  employee_email: '',
  employee_name: '',
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

function safeLink(url, label = 'Open') {
  if (!url) return '—';

  return (
    <a href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function cleanText(value) {
  return value || '—';
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

  const organisation =
    employee.organisation_code ||
    employee.organization_code ||
    employee.organisation ||
    employee.organization ||
    '';

  const meta = [code, organisation].filter(Boolean).join(' • ');

  return meta ? `${name} (${meta})` : name;
}

function employeeStateValue(employee = {}) {
  return (
    employee.state ||
    employee.office_state ||
    employee.work_state ||
    employee.current_state ||
    employee.branch ||
    ''
  );
}

function normalisedComparable(value) {
  return String(value || '').trim().toLowerCase();
}

function employeeMatchesOrganisation(employee = {}, organisation = null) {
  if (!organisation) {
    return true;
  }

  const organisationValues = [
    organisation.id,
    organisation._id,
    organisation.code,
    organisation.organisation_code,
    organisation.organization_code,
    organisation.name,
    organisation.organisation_name,
    organisation.organization_name,
  ]
    .map(normalisedComparable)
    .filter(Boolean);

  if (!organisationValues.length) {
    return true;
  }

  const employeeValues = [
    employee.organisation_id,
    employee.organization_id,
    employee.entity_id,
    employee.organisation_code,
    employee.organization_code,
    employee.entity_code,
    employee.organisation,
    employee.organization,
    employee.entity,
    employee.organisation_name,
    employee.organization_name,
  ]
    .map(normalisedComparable)
    .filter(Boolean);

  return organisationValues.some((value) => employeeValues.includes(value));
}

function normaliseAttendanceExceptionRows(rows = []) {
  return (rows || []).map((row, index) => ({
    sl_no: row.sl_no || index + 1,
    type:
      row.report_type === 'missing_checkout'
        ? 'Missing Checkout'
        : row.report_type === 'absent'
          ? 'Absent'
          : row.status === 'Not Checked Out'
            ? 'Missing Checkout'
            : 'Absent',
    employee_code: row.employee_code || row.emp_code || row.employee_id || '—',
    employee_name: row.employee_name || row.name || '—',
    organisation: row.organisation || row.organization || row.organisation_code || '—',
    state: row.state || row.branch || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    date: formatDate(row.date),
    status: row.status || '—',
    attendance_code: row.attendance_code || '—',
    mode: row.mode ? modeLabel(row.mode) : '—',
    check_in: row.check_in || '—',
    check_out: row.check_out || '—',
    check_in_location: row.check_in_location || '—',
    check_in_map: safeLink(row.check_in_map_url, 'Open map'),
    remarks: row.remarks || '—',
  }));
}

function normalizeRows(tab, rows = []) {
  if (tab === 'attendance' || tab === 'field-attendance') {
    return rows.map((row) => ({
      employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      state: row.state || '—',
      team_leader: row.team_leader_name || '—',
      reporting_officer: row.reporting_officer_name || '—',
      date: formatDate(row.date),
      mode: modeLabel(row.mode),
      status: statusLabel(row.status),
      field_location: cleanText(row.field_location),
      field_photo: safeLink(row.field_photo_url || row.field_photo, 'View photo'),
      check_in: formatDateTime(row.check_in),
      check_out: formatDateTime(row.check_out),
      check_in_location: row.check_in_location_text || '—',
      check_in_map: safeLink(row.check_in_map_url, 'Open map'),
      check_out_location: row.check_out_location_text || '—',
      check_out_map: safeLink(row.check_out_map_url, 'Open map'),
      late_reason: row.late_reason || '—',
      early_checkout_reason: row.early_checkout_reason || '—',
      holiday: row.holiday_title || '—',
      holiday_type: statusLabel(row.holiday_type),
      holiday_work_approval: statusLabel(row.holiday_work_approval_status),
      verified_by: row.verified_by || '—',
      verified: row.verified_by_ro ? 'Yes' : 'No',
    }));
  }

  if (tab === 'holiday-work-requests') {
    return rows.map((row) => ({
      employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      state: row.state || '—',
      team_leader: row.team_leader_name || '—',
      reporting_officer: row.reporting_officer_name || '—',
      date: formatDate(row.date),
      holiday: row.holiday_title || '—',
      holiday_type: statusLabel(row.holiday_type),
      reason: row.reason || '—',
      work_location: row.work_location || row.field_location || '—',
      proof_photo: safeLink(row.proof_photo_url || row.proof_photo, 'View photo'),
      location: row.location_text || '—',
      map: safeLink(row.map_url, 'Open map'),
      current_stage: row.live_status || statusLabel(row.approval_stage),
      status: statusLabel(row.status),
      decided_by: row.decided_by || row.decided_by_name || '—',
      decided_at: formatDateTime(row.decided_at),
      created_at: formatDateTime(row.created_at),
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

  if (
    tab === 'compoffs' ||
    tab === 'compoff-claims' ||
    tab === 'expired-compoffs'
  ) {
    return rows.map((row) => ({
      employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      team_leader: row.team_leader_name || '—',
      reporting_officer: row.reporting_officer_name || '—',
      earned_date: formatDate(row.earned_date),
      claim_from_date: formatDate(row.claim_from_date || row.available_from),
      expiry_date: formatDate(row.expiry_date || row.valid_until),
      valid_until: formatDate(row.valid_until || row.expiry_date),
      claim_date: formatDate(row.claim_date || row.claimed_date),
      holiday: row.holiday_title || '—',
      holiday_work_request_id: row.holiday_work_request_id || '—',
      attendance_log_id: row.attendance_log_id || '—',
      leave_request_id: row.leave_request_id || '—',
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
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [organisations, setOrganisations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [excelFilters, setExcelFilters] = useState({
    ...EMPTY_ATTENDANCE_EXCEL_FILTERS,
  });
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [exceptionFilters, setExceptionFilters] = useState({
    ...EMPTY_ATTENDANCE_EXCEPTION_FILTERS,
  });
  const [exceptionRows, setExceptionRows] = useState([]);
  const [exceptionSummary, setExceptionSummary] = useState(null);
  const [loadingExceptions, setLoadingExceptions] = useState(false);
  const [downloadingExceptionExcel, setDownloadingExceptionExcel] = useState(false);

  const alerts = useCustomAlert();

  const currentTab = REPORT_TABS.find((tab) => tab.key === activeTab);

  const reportStateOptions = useMemo(() => {
    const values = [
      ...HOLIDAY_STATES,
      ...employees.map((employee) => employeeStateValue(employee)),
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    return Array.from(new Set(values)).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }, [employees]);

  const attendanceExcelEmployees = useMemo(() => {
    const selectedOrganisation = organisations.find((organisation) => {
      const id = organisation.id || organisation._id || '';
      return id === excelFilters.organisation_id;
    });
    const selectedState = normalisedComparable(excelFilters.state);

    return employees.filter((employee) => {
      if (!employeeMatchesOrganisation(employee, selectedOrganisation)) {
        return false;
      }

      if (
        selectedState &&
        normalisedComparable(employeeStateValue(employee)) !== selectedState
      ) {
        return false;
      }

      return true;
    });
  }, [employees, organisations, excelFilters.organisation_id, excelFilters.state]);

  const attendanceExceptionEmployees = useMemo(() => {
    const selectedOrganisation = organisations.find((organisation) => {
      const id = organisation.id || organisation._id || '';
      return id === exceptionFilters.organisation_id;
    });
    const selectedState = normalisedComparable(exceptionFilters.state);

    return employees.filter((employee) => {
      if (!employeeMatchesOrganisation(employee, selectedOrganisation)) {
        return false;
      }

      if (
        selectedState &&
        normalisedComparable(employeeStateValue(employee)) !== selectedState
      ) {
        return false;
      }

      return true;
    });
  }, [employees, organisations, exceptionFilters.organisation_id, exceptionFilters.state]);

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

    if (!['attendance', 'field-attendance'].includes(tabKey)) {
      delete payload.mode;
    }

    if (
      ![
        'attendance',
        'field-attendance',
        'holiday-work-requests',
        'holidays',
      ].includes(tabKey)
    ) {
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
    } catch (error) {
      setOrganisations([]);
      alerts.error(
        error?.message || 'Unable to load organisations for attendance Excel export.',
        'Organisation Load Failed',
      );
    }
  }

  async function loadEmployees() {
    try {
      const data = await getActiveEmployees({
        limit: 1000,
        employee_scope: 'active',
      });

      setEmployees(data.items || []);
    } catch (error) {
      setEmployees([]);
      alerts.error(
        error?.message || 'Unable to load employees for report filters.',
        'Employee Load Failed',
      );
    }
  }

  async function loadSummary(nextFilters = filters) {
    try {
      setLoadingSummary(true);

      const data = await api(
        `/reports/summary${buildQuery({
          tenant_id: nextFilters.tenant_id,
        })}`,
      );

      setSummary(data);
    } catch (error) {
      alerts.error(error.message || 'Unable to load report summary', 'Report Summary Load Failed');
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
      setTabSummary(null);

      const filteredPayload = activeTabFilters(tabKey, nextFilters);
      const data = await api(`${selectedTab.endpoint}${buildQuery(filteredPayload)}`);

      setRows(normalizeRows(tabKey, data.items || []));
      setTabSummary(data.summary || null);
    } catch (error) {
      setRows([]);
      setTabSummary(null);
      alerts.error(error.message || 'Unable to load report', 'Report Load Failed');
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
    loadEmployees();
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

        next.employee_id = '';
        next.employee_code = '';
        next.employee_email = '';
        next.employee_name = '';
      }

      if (key === 'state') {
        next.employee_id = '';
        next.employee_code = '';
        next.employee_email = '';
        next.employee_name = '';
      }

      if (key === 'employee_id') {
        const selected = employees.find((employee) => {
          const id = employee.id || employee._id || '';
          return id === value;
        });

        next.employee_code = selected
          ? selected.employee_code || selected.emp_code || selected.employee_id || selected.code || ''
          : '';

        next.employee_email = selected
          ? selected.official_email || selected.email || ''
          : '';

        next.employee_name = selected
          ? selected.name || selected.employee_name || selected.full_name || ''
          : '';
      }

      if (key === 'period') {
        if (value === 'week' && (!next.week_start || !next.week_end)) {
          const today = new Date();
          const day = today.getDay();
          const diffToMonday = day === 0 ? -6 : 1 - day;
          const monday = new Date(today);

          monday.setDate(today.getDate() + diffToMonday);

          const sunday = new Date(monday);

          sunday.setDate(monday.getDate() + 6);

          next.week_start = monday.toISOString().slice(0, 10);
          next.week_end = sunday.toISOString().slice(0, 10);
        }

        if (value === 'day' && !next.date) {
          next.date = new Date().toISOString().slice(0, 10);
        }

        if ((value === 'month' || value === 'year') && !next.year) {
          next.year = String(new Date().getFullYear());
        }

        if (value === 'month' && !next.month) {
          next.month = String(new Date().getMonth() + 1);
        }
      }

      return next;
    });
  }

  function updateExceptionFilter(key, value) {
    setExceptionFilters((current) => {
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

        next.employee_id = '';
        next.employee_code = '';
        next.employee_email = '';
        next.employee_name = '';
      }

      if (key === 'state') {
        next.employee_id = '';
        next.employee_code = '';
        next.employee_email = '';
        next.employee_name = '';
      }

      if (key === 'employee_id') {
        const selected = employees.find((employee) => {
          const id = employee.id || employee._id || '';
          return id === value;
        });

        next.employee_code = selected
          ? selected.employee_code || selected.emp_code || selected.employee_id || selected.code || ''
          : '';

        next.employee_email = selected
          ? selected.official_email || selected.email || ''
          : '';

        next.employee_name = selected
          ? selected.name || selected.employee_name || selected.full_name || ''
          : '';
      }

      if (key === 'period') {
        if (value === 'week' && (!next.week_start || !next.week_end)) {
          const today = new Date();
          const day = today.getDay();
          const diffToMonday = day === 0 ? -6 : 1 - day;
          const monday = new Date(today);

          monday.setDate(today.getDate() + diffToMonday);

          const sunday = new Date(monday);

          sunday.setDate(monday.getDate() + 6);

          next.week_start = monday.toISOString().slice(0, 10);
          next.week_end = sunday.toISOString().slice(0, 10);
        }

        if (value === 'day' && !next.date) {
          next.date = new Date().toISOString().slice(0, 10);
        }

        if (value === 'month' && !next.year) {
          next.year = String(new Date().getFullYear());
        }

        if (value === 'month' && !next.month) {
          next.month = String(new Date().getMonth() + 1);
        }
      }

      return next;
    });

    setExceptionRows([]);
    setExceptionSummary(null);
  }

  function attendanceExceptionPayload() {
    const payload = {
      report_type: exceptionFilters.report_type,
      period: exceptionFilters.period,
      organisation_id: exceptionFilters.organisation_id,
      organisation_code: exceptionFilters.organisation_code,
      organisation: exceptionFilters.organisation,
      state: exceptionFilters.state,
      employee_id: exceptionFilters.employee_id,
      employee_code: exceptionFilters.employee_code,
      employee_email: exceptionFilters.employee_email,
      employee_name: exceptionFilters.employee_name,
    };

    if (exceptionFilters.period === 'day') {
      payload.date = exceptionFilters.date;
    } else if (exceptionFilters.period === 'week') {
      payload.week_start = exceptionFilters.week_start;
      payload.week_end = exceptionFilters.week_end;
    } else {
      payload.year = exceptionFilters.year;
      payload.month = exceptionFilters.month;
    }

    return payload;
  }

  function validateAttendanceExceptionFilters() {
    if (exceptionFilters.period === 'month' && (!exceptionFilters.year || !exceptionFilters.month)) {
      alerts.warning('Please select year and month.', 'Month Required');
      return false;
    }

    if (exceptionFilters.period === 'week' && (!exceptionFilters.week_start || !exceptionFilters.week_end)) {
      alerts.warning('Please select week start and week end.', 'Week Range Required');
      return false;
    }

    if (exceptionFilters.period === 'day' && !exceptionFilters.date) {
      alerts.warning('Please select a date.', 'Date Required');
      return false;
    }

    return true;
  }

  async function handleAttendanceExceptionPreview(event) {
    event.preventDefault();

    if (!validateAttendanceExceptionFilters()) {
      return;
    }

    setLoadingExceptions(true);

    try {
      const data = await getAttendanceExceptionReports(attendanceExceptionPayload());
      const nextRows = normaliseAttendanceExceptionRows(data.items || []);

      setExceptionRows(nextRows);
      setExceptionSummary(data.summary || null);

      if (!nextRows.length) {
        alerts.info(
          'No matching attendance exceptions were found for the selected filters.',
          'No Exceptions Found',
        );
      }
    } catch (error) {
      setExceptionRows([]);
      setExceptionSummary(null);
      alerts.error(
        error.message || 'Unable to load attendance exception report.',
        'Report Load Failed',
      );
    } finally {
      setLoadingExceptions(false);
    }
  }

  async function handleAttendanceExceptionDownload() {
    if (!validateAttendanceExceptionFilters()) {
      return;
    }

    setDownloadingExceptionExcel(true);

    try {
      await downloadAttendanceExceptionExcel(attendanceExceptionPayload());
      alerts.success(
        'Attendance exception Excel downloaded successfully.',
        'Download Complete',
      );
    } catch (error) {
      alerts.error(
        error.message || 'Unable to download attendance exception Excel report.',
        'Download Failed',
      );
    } finally {
      setDownloadingExceptionExcel(false);
    }
  }

  async function handleAttendanceExcelDownload(event) {
    event.preventDefault();

    if (!excelFilters.organisation_id && !excelFilters.organisation_code && !excelFilters.organisation) {
      alerts.warning(
        'Please select Organisation / Entity before downloading the attendance Excel.',
        'Organisation Required',
      );
      return;
    }

    if (excelFilters.period === 'month' && (!excelFilters.year || !excelFilters.month)) {
      alerts.warning('Please select year and month before downloading.', 'Month Required');
      return;
    }

    if (excelFilters.period === 'week' && (!excelFilters.week_start || !excelFilters.week_end)) {
      alerts.warning('Please select week start and week end before downloading.', 'Week Range Required');
      return;
    }

    if (excelFilters.period === 'day' && !excelFilters.date) {
      alerts.warning('Please select date before downloading.', 'Date Required');
      return;
    }

    if (excelFilters.period === 'year' && !excelFilters.year) {
      alerts.warning('Please enter year before downloading.', 'Year Required');
      return;
    }

    setDownloadingExcel(true);

    try {
      const payload = {
        period: excelFilters.period,
        organisation_id: excelFilters.organisation_id,
        organisation_code: excelFilters.organisation_code,
        organisation: excelFilters.organisation,
        state: excelFilters.state,
        employee_id: excelFilters.employee_id,
        employee_code: excelFilters.employee_code,
        employee_email: excelFilters.employee_email,
        employee_name: excelFilters.employee_name,
      };

      if (excelFilters.period === 'day') {
        payload.date = excelFilters.date;
      } else if (excelFilters.period === 'week') {
        payload.week_start = excelFilters.week_start;
        payload.week_end = excelFilters.week_end;
      } else if (excelFilters.period === 'year') {
        payload.year = excelFilters.year;
      } else {
        payload.year = excelFilters.year;
        payload.month = excelFilters.month;
      }

      await downloadAttendanceRegisterExcel(payload);
      alerts.success('Attendance Excel downloaded successfully.', 'Download Complete');
    } catch (error) {
      alerts.error(error.message || 'Unable to download attendance Excel report.', 'Download Failed');
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
    ['Holiday Work Requests', counts.holiday_work_requests || 0],
    ['Holiday Calendar', counts.holiday_calendar || 0],
    ['Comp-Off Credits', counts.compoff_credits || 0],
    ['Leave Balances', counts.leave_balances || 0],
    ['Leave Requests', counts.leave_requests || 0],
    ['Tickets', counts.tickets || 0],
    ['Expenses', counts.expenses || 0],
    ['Audit Logs', counts.audit_logs || 0],
  ];

  return (
    <div className="page-grid reports-center-page">

      <style>{`
        .reports-center-page{
          --report-ink:#101a3a;
          --report-muted:#596483;
          --report-primary:#6254da;
          --report-deep:#342b78;
          --report-blue:#3766db;
          --report-teal:#18aaa8;
          --report-flat-blue:#b9d7ff;
          --report-flat-violet:#c9c0ff;
          --report-flat-teal:#aee6d9;
          --report-ease:cubic-bezier(.22,1,.36,1);
          display:grid;
          gap:22px;
          width:100%;
          min-width:0;
          padding-bottom:max(34px,env(safe-area-inset-bottom));
          color:var(--report-ink);
          font-family:var(--yc-ui,var(--body),inherit);
        }

        .reports-center-page>.hero{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:28px;
          min-height:230px;
          padding:clamp(25px,3vw,40px);
          border:1px solid rgba(171,181,211,.72);
          border-radius:clamp(28px,2.5vw,40px);
          background:
            radial-gradient(circle at 8% 8%,rgba(121,219,238,.34),transparent 31%),
            radial-gradient(circle at 92% 12%,rgba(191,190,249,.3),transparent 34%),
            linear-gradient(135deg,#f1fbff 0%,#fffdf8 48%,#f8f2ff 100%);
          box-shadow:12px 14px 0 var(--report-flat-blue),0 28px 48px rgba(34,38,110,.13);
        }

        .reports-center-page>.hero::before{
          content:"";
          position:absolute;
          inset:0;
          z-index:-2;
          opacity:.42;
          pointer-events:none;
          background-image:
            linear-gradient(rgba(65,55,161,.035) 1px,transparent 1px),
            linear-gradient(90deg,rgba(65,55,161,.035) 1px,transparent 1px);
          background-size:42px 42px;
        }

        .reports-center-page>.hero::after{
          content:"";
          position:absolute;
          z-index:-1;
          width:clamp(165px,20vw,290px);
          aspect-ratio:1;
          right:clamp(-110px,-7vw,-55px);
          top:clamp(-118px,-8vw,-60px);
          border:1px solid rgba(65,55,161,.12);
          border-radius:34% 66% 58% 42% / 44% 38% 62% 56%;
          background:linear-gradient(145deg,rgba(105,217,208,.72),rgba(121,189,242,.72));
          transform:rotate(18deg);
        }

        .reports-center-page>.hero>div{min-width:0;max-width:900px}
        .reports-center-page .kicker{
          display:inline-flex;
          align-items:center;
          width:fit-content;
          padding:9px 13px;
          border-radius:999px;
          color:#fff;
          background:var(--report-deep);
          font-size:9px;
          font-weight:950;
          line-height:1;
          letter-spacing:.12em;
          text-transform:uppercase;
        }
        .reports-center-page>.hero h1{
          margin:15px 0 10px;
          color:var(--report-ink);
          font-family:var(--yc-display,var(--heading),inherit);
          font-size:clamp(34px,4.4vw,66px);
          font-weight:760;
          line-height:.94;
          letter-spacing:-.055em;
        }
        .reports-center-page>.hero p{
          max-width:850px;
          margin:0;
          color:var(--report-muted);
          font-size:clamp(13px,1vw,16px);
          line-height:1.68;
        }

        .reports-center-page button{
          touch-action:manipulation;
          font-weight:900;
          transition:transform 240ms var(--report-ease),box-shadow 240ms var(--report-ease),filter 200ms ease;
        }
        .reports-center-page button:hover:not(:disabled){transform:translateY(-2px);filter:saturate(1.04)}
        .reports-center-page button:active:not(:disabled){transform:translateY(0) scale(.985)}
        .reports-center-page button:disabled{opacity:.56;cursor:not-allowed;transform:none;filter:none}

        .reports-center-page .primary,
        .reports-center-page .secondary{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          min-height:46px;
          padding:0 17px;
          border-radius:14px;
          line-height:1;
          white-space:nowrap;
        }
        .reports-center-page .primary{
          border:1px solid rgba(52,43,120,.16);
          color:#fff;
          background:linear-gradient(145deg,#4f72df,#2bb9b5);
          box-shadow:5px 6px 0 rgba(52,43,120,.8),0 12px 22px rgba(55,102,219,.16);
        }
        .reports-center-page .secondary{
          border:1px solid rgba(98,84,218,.18);
          color:var(--report-deep);
          background:#f1efff;
          box-shadow:4px 5px 0 rgba(98,84,218,.14);
        }

        .reports-center-page>.stats-grid{
          display:grid;
          grid-template-columns:repeat(5,minmax(0,1fr));
          gap:15px;
        }

        .reports-center-page>.stats-grid>*{
          min-width:0;
          border:1px solid rgba(171,181,211,.68)!important;
          border-radius:21px!important;
          background:#f8fbff!important;
          box-shadow:7px 9px 0 var(--report-flat-blue),0 18px 30px rgba(15,20,75,.08)!important;
          transition:transform 260ms var(--report-ease),border-color 220ms ease!important;
        }
        .reports-center-page>.stats-grid>*:nth-child(2n){background:#eaf8f4!important;box-shadow:7px 9px 0 var(--report-flat-teal),0 18px 30px rgba(15,20,75,.08)!important}
        .reports-center-page>.stats-grid>*:nth-child(3n){background:#f1efff!important;box-shadow:7px 9px 0 var(--report-flat-violet),0 18px 30px rgba(15,20,75,.08)!important}
        .reports-center-page>.stats-grid>*:nth-child(5n){background:#fff4d5!important;box-shadow:7px 9px 0 #ffe0a5,0 18px 30px rgba(15,20,75,.08)!important}
        .reports-center-page>.stats-grid>*:hover{transform:translateY(-3px);border-color:rgba(98,84,218,.3)!important}

        .reports-center-page .two-col{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:18px;
        }

        .reports-center-page .panel{
          min-width:0;
          overflow:hidden;
          border:1px solid rgba(171,181,211,.72);
          border-radius:clamp(24px,2vw,32px);
          background:linear-gradient(145deg,rgba(255,255,255,.99),rgba(244,249,255,.98));
          box-shadow:9px 11px 0 #d1dcfa,0 24px 42px rgba(34,38,110,.1);
        }

        .reports-center-page .panel>h3{
          margin:0;
          padding:23px 25px 18px;
          border-bottom:1px solid rgba(65,55,161,.08);
          color:var(--report-ink);
          font-family:var(--yc-display,var(--heading),inherit);
          font-size:clamp(21px,2vw,29px);
          font-weight:760;
          letter-spacing:-.03em;
          background:rgba(255,255,255,.66);
        }

        .reports-center-page .toolbar{
          display:flex;
          align-items:flex-end;
          justify-content:space-between;
          gap:18px;
          padding:23px 25px 18px;
          border-bottom:1px solid rgba(65,55,161,.08);
          background:rgba(255,255,255,.66);
        }
        .reports-center-page .toolbar>div{min-width:0}
        .reports-center-page .toolbar h3{
          margin:0;
          color:var(--report-ink);
          font-family:var(--yc-display,var(--heading),inherit);
          font-size:clamp(22px,2vw,30px);
          font-weight:760;
          line-height:1;
          letter-spacing:-.03em;
        }
        .reports-center-page .toolbar p{
          margin:6px 0 0;
          color:var(--report-muted);
          font-size:12px;
          line-height:1.5;
        }

        .reports-center-page .mini-list{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:12px;
          padding:18px 25px 25px;
        }
        .reports-center-page .mini-list>span{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          min-width:0;
          padding:14px;
          border:1px solid rgba(98,84,218,.09);
          border-radius:15px;
          background:rgba(241,239,255,.48);
        }
        .reports-center-page .mini-list strong{
          color:#334164;
          font-size:12px;
          line-height:1.4;
        }
        .reports-center-page .mini-list small{
          flex:0 0 auto;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          min-width:34px;
          min-height:30px;
          padding:0 10px;
          border-radius:999px;
          color:var(--report-deep);
          background:#e5e9ff;
          font-size:12px;
          font-weight:950;
        }

        .reports-center-page .dynamic-form{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:14px;
          padding:20px 25px 25px;
          background:linear-gradient(145deg,rgba(237,248,255,.44),rgba(248,241,255,.34));
        }
        .reports-center-page .dynamic-form label{
          display:grid;
          min-width:0;
          gap:7px;
          color:#334164;
          font-size:12px;
          font-weight:900;
        }
        .reports-center-page .dynamic-form input,
        .reports-center-page .dynamic-form select{
          width:100%;
          min-width:0;
          min-height:46px;
          border:1px solid rgba(159,169,205,.62);
          border-radius:14px;
          outline:none;
          background:rgba(255,255,255,.9);
          color:var(--report-ink);
          padding:0 13px;
          font:inherit;
          font-weight:600;
          transition:border-color 180ms ease,box-shadow 180ms ease,background 180ms ease;
        }
        .reports-center-page .dynamic-form input:hover,
        .reports-center-page .dynamic-form select:hover{border-color:rgba(98,84,218,.34)}
        .reports-center-page .dynamic-form input:focus,
        .reports-center-page .dynamic-form select:focus{
          border-color:var(--report-primary);
          background:#fff;
          box-shadow:0 0 0 4px rgba(98,84,218,.11);
        }
        .reports-center-page .dynamic-form>button{align-self:end}

        .reports-center-page .report-tab-row{
          display:flex;
          gap:9px;
          overflow-x:auto;
          padding:16px 20px;
          border-bottom:1px solid rgba(65,55,161,.09);
          background:linear-gradient(145deg,rgba(237,248,255,.42),rgba(248,241,255,.4));
          scrollbar-width:thin;
          scrollbar-color:rgba(98,84,218,.35) transparent;
          -webkit-overflow-scrolling:touch;
        }
        .reports-center-page .report-tab-row::-webkit-scrollbar{height:7px}
        .reports-center-page .report-tab-row::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(98,84,218,.35)}
        .reports-center-page .report-tab-row button{
          flex:0 0 auto;
          min-height:38px;
          padding:0 13px;
          border:1px solid rgba(98,84,218,.14);
          border-radius:999px;
          color:#4f5e7f;
          background:#fff;
          box-shadow:none;
          font-size:11px;
          white-space:nowrap;
        }
        .reports-center-page .report-tab-row button.selected{
          color:#fff;
          background:linear-gradient(145deg,#4f72df,#2bb9b5);
          box-shadow:3px 4px 0 rgba(52,43,120,.62);
        }

        .reports-center-page .inline-message{
          margin:20px 24px;
          padding:15px 16px;
          border:1px solid rgba(98,84,218,.14);
          border-radius:15px;
          color:var(--report-deep);
          background:#f1efff;
          font-size:12px;
          font-weight:850;
        }

        .reports-center-page .panel a{
          color:var(--report-blue);
          font-weight:850;
          text-decoration:none;
        }
        .reports-center-page .panel a:hover{text-decoration:underline}

        .reports-center-page .panel>:last-child{
          border-bottom-left-radius:inherit;
          border-bottom-right-radius:inherit;
        }

        @media (min-width:1500px){
          .reports-center-page>.stats-grid{grid-template-columns:repeat(5,minmax(0,1fr))}
        }
        @media (max-width:1180px){
          .reports-center-page>.stats-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
          .reports-center-page .dynamic-form{grid-template-columns:repeat(3,minmax(0,1fr))}
        }
        @media (max-width:900px){
          .reports-center-page .two-col{grid-template-columns:1fr}
          .reports-center-page .dynamic-form{grid-template-columns:repeat(2,minmax(0,1fr))}
        }
        @media (max-width:640px){
          .reports-center-page{gap:16px}
          .reports-center-page>.hero{
            align-items:flex-start;
            flex-direction:column;
            min-height:auto;
            padding:20px;
            border-radius:24px;
            box-shadow:7px 8px 0 var(--report-flat-blue),0 18px 30px rgba(34,38,110,.1);
          }
          .reports-center-page>.hero h1{font-size:clamp(31px,9.2vw,43px)}
          .reports-center-page>.hero .secondary{width:100%}
          .reports-center-page>.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
          .reports-center-page .panel{
            border-radius:23px;
            box-shadow:6px 7px 0 #d1dcfa,0 16px 28px rgba(34,38,110,.08);
          }
          .reports-center-page .toolbar{
            align-items:flex-start;
            flex-direction:column;
            padding:20px 17px 15px;
          }
          .reports-center-page .toolbar .secondary{width:100%}
          .reports-center-page .mini-list{grid-template-columns:1fr;padding:16px 17px 20px}
          .reports-center-page .dynamic-form{grid-template-columns:1fr;padding:16px 17px 20px}
          .reports-center-page .dynamic-form>button{width:100%}
          .reports-center-page .report-tab-row{padding-left:14px;padding-right:14px}
        }
        @media (max-width:430px){
          .reports-center-page>.stats-grid{grid-template-columns:1fr}
        }
        @media (prefers-reduced-motion:reduce){
          .reports-center-page *,
          .reports-center-page *::before,
          .reports-center-page *::after{
            animation-duration:.01ms!important;
            animation-iteration-count:1!important;
            transition-duration:.01ms!important;
            scroll-behavior:auto!important;
          }
        }
      `}</style>

      <section className="hero compact">
        <div>
          <span className="kicker">Reports</span>
          <h1>HRMS Reports Center</h1>
          <p>
            View attendance, field attendance with location/photo, holiday work
            approvals, comp-off credits, comp-off claims, expired comp-off,
            leave workflow approvals, leave deductions, and audit logs from one
            reporting screen.
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
              <strong>Pending Holiday Work</strong>
              <small>{extra?.pending?.holiday_work_requests || 0}</small>
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
              Download entity-wise or employee-wise attendance register in Excel
              format with attendance codes, CL/EL/LWP counts, half-day leave
              marking, and day-wise columns.
            </p>
          </div>
        </div>

        <form className="dynamic-form" onSubmit={handleAttendanceExcelDownload} noValidate>
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
              {reportStateOptions.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </label>

          <label>
            Employee
            <select
              value={excelFilters.employee_id}
              onChange={(e) => updateExcelFilter('employee_id', e.target.value)}
            >
              <option value="">All Employees</option>
              {attendanceExcelEmployees.map((employee) => {
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
            Export Period
            <select
              value={excelFilters.period}
              onChange={(e) => updateExcelFilter('period', e.target.value)}
            >
              <option value="month">Month Wise</option>
              <option value="week">Week Wise</option>
              <option value="day">Day Wise</option>
              <option value="year">Year Wise</option>
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

          {excelFilters.period === 'year' && (
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
            <h3>Absence & Missing Checkout Export</h3>
            <p>
              Preview or export day-wise, week-wise, or month-wise absent employees
              and employees who checked in but did not check out. Filters are applied
              exactly by organisation, state, and employee.
            </p>
          </div>
        </div>

        <form className="dynamic-form" onSubmit={handleAttendanceExceptionPreview} noValidate>
          <label>
            Report Type
            <select
              value={exceptionFilters.report_type}
              onChange={(e) => updateExceptionFilter('report_type', e.target.value)}
            >
              <option value="absent">Absent Employees</option>
              <option value="missing_checkout">Missing Checkout</option>
              <option value="exceptions">Absent + Missing Checkout</option>
            </select>
          </label>

          <label>
            Organisation / Entity
            <select
              value={exceptionFilters.organisation_id}
              onChange={(e) => updateExceptionFilter('organisation_id', e.target.value)}
            >
              <option value="">All Organisations / Entities</option>
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
              value={exceptionFilters.state}
              onChange={(e) => updateExceptionFilter('state', e.target.value)}
            >
              <option value="">All States</option>
              {reportStateOptions.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </label>

          <label>
            Employee
            <select
              value={exceptionFilters.employee_id}
              onChange={(e) => updateExceptionFilter('employee_id', e.target.value)}
            >
              <option value="">All Employees</option>
              {attendanceExceptionEmployees.map((employee) => {
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
            Period
            <select
              value={exceptionFilters.period}
              onChange={(e) => updateExceptionFilter('period', e.target.value)}
            >
              <option value="day">Day Wise</option>
              <option value="week">Week Wise</option>
              <option value="month">Month Wise</option>
            </select>
          </label>

          {exceptionFilters.period === 'month' && (
            <>
              <label>
                Year
                <input
                  type="number"
                  value={exceptionFilters.year}
                  onChange={(e) => updateExceptionFilter('year', e.target.value)}
                  min="2020"
                  max="2100"
                  required
                />
              </label>

              <label>
                Month
                <select
                  value={exceptionFilters.month}
                  onChange={(e) => updateExceptionFilter('month', e.target.value)}
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

          {exceptionFilters.period === 'week' && (
            <>
              <label>
                Week Start
                <input
                  type="date"
                  value={exceptionFilters.week_start}
                  onChange={(e) => updateExceptionFilter('week_start', e.target.value)}
                  required
                />
              </label>

              <label>
                Week End
                <input
                  type="date"
                  value={exceptionFilters.week_end}
                  onChange={(e) => updateExceptionFilter('week_end', e.target.value)}
                  required
                />
              </label>
            </>
          )}

          {exceptionFilters.period === 'day' && (
            <label>
              Date
              <input
                type="date"
                value={exceptionFilters.date}
                onChange={(e) => updateExceptionFilter('date', e.target.value)}
                required
              />
            </label>
          )}

          <button
            type="submit"
            className="primary"
            disabled={loadingExceptions || downloadingExceptionExcel}
          >
            <Search size={16} />
            {loadingExceptions ? 'Loading...' : 'Preview Report'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={handleAttendanceExceptionDownload}
            disabled={loadingExceptions || downloadingExceptionExcel}
          >
            {downloadingExceptionExcel ? 'Downloading...' : 'Download Excel'}
          </button>
        </form>

        {exceptionSummary && (
          <section className="stats-grid" style={{ marginTop: 18 }}>
            <Stat label="Absent Records" value={exceptionSummary.absent_records || 0} />
            <Stat label="Absent Employees" value={exceptionSummary.absent_employees || 0} />
            <Stat label="Missing Checkout Records" value={exceptionSummary.missing_checkout_records || 0} />
            <Stat label="Missing Checkout Employees" value={exceptionSummary.missing_checkout_employees || 0} />
          </section>
        )}

        {loadingExceptions && (
          <div className="inline-message">Loading attendance exception report...</div>
        )}

        {!loadingExceptions && exceptionSummary && (
          <div style={{ marginTop: 18 }}>
            <Table rows={exceptionRows} maxColumns={18} />
          </div>
        )}
      </section>


      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Report Filters</h3>
            <p>
              Use filters according to the active report. Attendance reports support
              date, mode, state, department, and employee filters. Holiday work and
              leave workflow reports support approval status and stage filters.
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

        <form className="dynamic-form" onSubmit={searchReport} noValidate>
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
              <option value="used">Used</option>
              <option value="expired">Expired</option>
            </select>
          </label>

          {['attendance', 'field-attendance'].includes(activeTab) && (
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
          )}

          <label>
            State
            <select
              value={filters.state}
              onChange={(e) => updateFilter('state', e.target.value)}
            >
              <option value="">All States</option>
              {reportStateOptions.map((state) => (
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