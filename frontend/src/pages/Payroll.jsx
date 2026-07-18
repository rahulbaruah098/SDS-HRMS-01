import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileText,
  IndianRupee,
  Loader2,
  RefreshCw,
  Search,
  Users,
  WalletCards,
} from 'lucide-react';

import { api, getApiUrl, getToken } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DEFAULT_LIMIT = 500;

function safeText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeKey(value) {
  return safeText(value, '')
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function normalizeRoles(user = {}) {
  const rawRoles = Array.isArray(user.roles)
    ? user.roles
    : typeof user.roles === 'string'
      ? user.roles.split(',')
      : [];

  const roles = rawRoles.map(normalizeKey).filter(Boolean);
  const role = normalizeKey(user.role);

  if (role && !roles.includes(role)) {
    roles.push(role);
  }

  return roles;
}

function isSuperAdmin(user = {}) {
  return normalizeRoles(user).includes('super_admin');
}

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

function getDefaultPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getDaysInPeriod(period) {
  const [yearText, monthText] = String(period || '').split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return 0;
  }

  return new Date(year, month, 0).getDate();
}

function employeeId(employee = {}) {
  return safeText(employee._id || employee.id || employee.employee_id, '');
}

function employeeCode(employee = {}) {
  return safeText(
    employee.employee_code || employee.emp_code || employee.employee_id || employee.code,
    '—',
  );
}

function employeeName(employee = {}) {
  return safeText(
    employee.employee_name || employee.name || employee.full_name || employee.official_email,
    'Employee',
  );
}

function employeeDepartment(employee = {}) {
  return safeText(employee.department || employee.department_name, '—');
}

function employeeDesignation(employee = {}) {
  return safeText(employee.designation || employee.designation_name, '—');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(toNumber(value, 0));
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  const rawValue = typeof value === 'object' && value.$date ? value.$date : value;
  const parsed = new Date(rawValue);

  if (Number.isNaN(parsed.getTime())) {
    return safeText(rawValue);
  }

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(value) {
  return safeText(value, 'draft')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusClass(value) {
  const status = normalizeKey(value);

  if (['approved', 'locked', 'disbursed', 'completed'].includes(status)) {
    return 'payroll-status payroll-status-success';
  }

  if (['reviewed', 'hr_review', 'finance_approval', 'processing'].includes(status)) {
    return 'payroll-status payroll-status-info';
  }

  if (['failed', 'rejected', 'cancelled'].includes(status)) {
    return 'payroll-status payroll-status-danger';
  }

  return 'payroll-status payroll-status-warning';
}

function emptyManualInput(totalDays) {
  return {
    total_days: totalDays || '',
    working_days: '',
    paid_leave_days: '0',
    lwp_days: '',
  };
}

function resolveRunId(run = {}) {
  return safeText(run._id || run.id || run.run_id, '');
}

function resolvePayslipRunId(payslip = {}) {
  return safeText(payslip.run_id || payslip.payroll_run_id, '');
}

function resolveRunTotals(run = {}) {
  return run.totals || run.summary || {};
}

function resolvePayslipTotals(payslip = {}) {
  return payslip.totals || {};
}

function resolveTaxContextSnapshot(payslip = {}) {
  return payslip.tax_context_snapshot || {};
}

function resolveTaxDeclarationSnapshot(payslip = {}) {
  const taxContext = resolveTaxContextSnapshot(payslip);

  return (
    payslip.tax_declaration_snapshot ||
    taxContext.declaration ||
    {}
  );
}

function resolveTdsInstructionSnapshot(payslip = {}) {
  const taxContext = resolveTaxContextSnapshot(payslip);

  return (
    payslip.tds_instruction_snapshot ||
    taxContext.tds ||
    {}
  );
}

function resolveTdsMode(payslip = {}) {
  const instruction = resolveTdsInstructionSnapshot(payslip);
  const calculationInput = payslip.calculation_input_snapshot || {};

  return normalizeKey(
    instruction.mode ||
      calculationInput.tds_source ||
      'disabled',
  );
}

function resolveReimbursementTotal(totals = {}) {
  return toNumber(
    totals.reimbursements ??
      totals.reimbursement_amount ??
      totals.approved_reimbursements,
    0,
  );
}

function hasBankSnapshot(payslip = {}) {
  return Boolean(
    payslip.bank_snapshot_available ||
      payslip.bank_details_snapshot ||
      payslip.bank_snapshot ||
      payslip.bank_account_snapshot,
  );
}

function resolvePayslipEmployeeId(payslip = {}) {
  return safeText(
    payslip.employee_id ||
      payslip.employee_info?.employee_id ||
      payslip.employee_info?._id ||
      payslip.employee?._id ||
      payslip.employee?.id,
    '',
  );
}

function resolvePayrollPeriod(payslip = {}, run = {}) {
  const periodValue = safeText(
    payslip.period_key ||
      payslip.payroll_period ||
      run.period_key ||
      run.payroll_period ||
      run.month,
    '',
  );

  const periodMatch = periodValue.match(/^(\d{4})-(\d{1,2})$/);

  if (periodMatch) {
    return {
      year: Number(periodMatch[1]),
      month: Number(periodMatch[2]),
    };
  }

  const year = toNumber(
    payslip.year ||
      payslip.payroll_year ||
      run.year ||
      run.payroll_year,
    0,
  );
  const month = toNumber(
    payslip.month_number ||
      payslip.payroll_month ||
      (typeof payslip.month === 'number' ? payslip.month : 0) ||
      run.month_number ||
      run.payroll_month ||
      (typeof run.month === 'number' ? run.month : 0),
    0,
  );

  if (
    Number.isInteger(year) &&
    year >= 2000 &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  ) {
    return { year, month };
  }

  return { year: 0, month: 0 };
}

function payslipPdfFilename(payslip = {}, year, month) {
  const code = safeText(
    payslip.employee_code || payslip.employee_info?.employee_code,
    resolvePayslipEmployeeId(payslip).slice(-8) || 'employee',
  )
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `payslip_${code}_${year}-${String(month).padStart(2, '0')}.pdf`;
}

function filenameFromDisposition(disposition = '', fallback = 'payslip.pdf') {
  const utfMatch = String(disposition).match(/filename\*=UTF-8''([^;]+)/i);

  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1].replace(/^["']|["']$/g, ''));
    } catch {
      return utfMatch[1].replace(/^["']|["']$/g, '');
    }
  }

  const basicMatch = String(disposition).match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1]?.trim() || fallback;
}

async function readPdfError(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const payload = await response.json();
      return (
        payload?.message ||
        payload?.error ||
        payload?.details ||
        `Payslip request failed with status ${response.status}.`
      );
    } catch {
      return `Payslip request failed with status ${response.status}.`;
    }
  }

  try {
    const message = (await response.text()).trim();
    return message || `Payslip request failed with status ${response.status}.`;
  } catch {
    return `Payslip request failed with status ${response.status}.`;
  }
}

function sortEmployees(items = []) {
  return [...items].sort((first, second) => {
    const nameComparison = employeeName(first).localeCompare(employeeName(second));

    if (nameComparison !== 0) {
      return nameComparison;
    }

    return employeeCode(first).localeCompare(employeeCode(second));
  });
}

export default function Payroll({ user = {}, setPage = () => {} }) {
  const alerts = useCustomAlert();
  const superAdmin = isSuperAdmin(user);

  const [period, setPeriod] = useState(getDefaultPeriod());
  const [tenantId, setTenantId] = useState(
    safeText(user.tenant_id || user.tenant?.tenant_id || user.tenant?.code, ''),
  );
  const [scope, setScope] = useState('all');
  const [attendanceSource, setAttendanceSource] = useState('saved');
  const [employees, setEmployees] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [manualInputs, setManualInputs] = useState({});
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [payslips, setPayslips] = useState([]);
  const [calculationErrors, setCalculationErrors] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingPayslips, setLoadingPayslips] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [syncingAttendance, setSyncingAttendance] = useState(false);
  const [attendanceSyncResult, setAttendanceSyncResult] = useState(null);
  const [attendanceSyncFailures, setAttendanceSyncFailures] = useState([]);
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);
  const [pdfActionKey, setPdfActionKey] = useState('');

  const totalDays = useMemo(() => getDaysInPeriod(period), [period]);

  const filteredEmployees = useMemo(() => {
    const term = normalizeKey(employeeSearch);

    if (!term) {
      return employees;
    }

    return employees.filter((employee) => {
      const haystack = [
        employeeName(employee),
        employeeCode(employee),
        employeeDepartment(employee),
        employeeDesignation(employee),
        employee.official_email,
      ]
        .map(normalizeKey)
        .join(' ');

      return haystack.includes(term);
    });
  }, [employeeSearch, employees]);

  const targetEmployees = useMemo(() => {
    if (scope === 'all') {
      return employees;
    }

    const selectedSet = new Set(selectedIds);
    return employees.filter((employee) => selectedSet.has(employeeId(employee)));
  }, [employees, scope, selectedIds]);

  const activeTotals = useMemo(() => {
    if (activeRun) {
      return resolveRunTotals(activeRun);
    }

    return {};
  }, [activeRun]);

  function tenantParams() {
    if (!superAdmin || !tenantId.trim()) {
      return {};
    }

    return { tenant_id: tenantId.trim() };
  }

  function ensureManualInputRows(items, nextPeriod = period) {
    const days = getDaysInPeriod(nextPeriod);

    setManualInputs((current) => {
      const next = { ...current };

      items.forEach((employee) => {
        const id = employeeId(employee);

        if (!id) {
          return;
        }

        next[id] = {
          ...emptyManualInput(days),
          ...(next[id] || {}),
          total_days: days || next[id]?.total_days || '',
        };
      });

      return next;
    });
  }

  async function loadEmployees({ silent = false } = {}) {
    if (superAdmin && !tenantId.trim()) {
      if (!silent) {
        alerts.warning(
          'Enter the company tenant ID before loading employees.',
          'Tenant Required',
        );
      }
      setEmployees([]);
      setSelectedIds([]);
      return [];
    }

    try {
      setLoadingEmployees(true);

      const data = await api(
        `/employees${buildQuery({
          ...tenantParams(),
          limit: DEFAULT_LIMIT,
          sort_by: 'name',
          sort_dir: 'asc',
        })}`,
      );
      const items = sortEmployees(data.items || []);

      setEmployees(items);
      setSelectedIds((current) => current.filter((id) => items.some((row) => employeeId(row) === id)));
      ensureManualInputRows(items);
      return items;
    } catch (error) {
      setEmployees([]);
      setSelectedIds([]);

      if (!silent) {
        alerts.error(error.message || 'Unable to load employees.', 'Employee Load Failed');
      }

      return [];
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadRuns({ silent = false, preferredRunId = '' } = {}) {
    if (superAdmin && !tenantId.trim()) {
      setRuns([]);
      setActiveRun(null);
      setPayslips([]);
      return [];
    }

    try {
      setLoadingRuns(true);

      const data = await api(
        `/payroll_runs${buildQuery({
          ...tenantParams(),
          limit: 200,
          sort_by: 'created_at',
          sort_dir: 'desc',
        })}`,
      );
      const items = data.items || [];

      setRuns(items);

      const nextActiveRun =
        items.find((run) => resolveRunId(run) === preferredRunId) ||
        items.find((run) => safeText(run.period_key || run.month, '') === period) ||
        items[0] ||
        null;

      setActiveRun(nextActiveRun);

      if (!nextActiveRun) {
        setPayslips([]);
      }

      return items;
    } catch (error) {
      setRuns([]);
      setActiveRun(null);
      setPayslips([]);

      if (!silent) {
        alerts.error(error.message || 'Unable to load payroll runs.', 'Payroll Load Failed');
      }

      return [];
    } finally {
      setLoadingRuns(false);
    }
  }

  async function loadPayslipsForRun(run, { silent = false } = {}) {
    const runId = resolveRunId(run);

    if (!runId) {
      setPayslips([]);
      return [];
    }

    try {
      setLoadingPayslips(true);

      const data = await api(
        `/payslips${buildQuery({
          ...tenantParams(),
          limit: DEFAULT_LIMIT,
          sort_by: 'employee_name',
          sort_dir: 'asc',
        })}`,
      );
      const items = (data.items || []).filter(
        (payslip) => resolvePayslipRunId(payslip) === runId,
      );

      setPayslips(items);
      return items;
    } catch (error) {
      setPayslips([]);

      if (!silent) {
        alerts.error(error.message || 'Unable to load payslips.', 'Payslip Load Failed');
      }

      return [];
    } finally {
      setLoadingPayslips(false);
    }
  }

  useEffect(() => {
    if (superAdmin && !tenantId.trim()) {
      return;
    }

    loadEmployees({ silent: true });
    loadRuns({ silent: true });
    // Initial tenant-based load only. Explicit refresh is available afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ensureManualInputRows(employees, period);
    setAttendanceSyncResult(null);
    setAttendanceSyncFailures([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    setAttendanceSyncResult(null);
    setAttendanceSyncFailures([]);
  }, [tenantId]);

  useEffect(() => {
    if (!activeRun) {
      setPayslips([]);
      return;
    }

    loadPayslipsForRun(activeRun, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun]);

  function toggleEmployee(id) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function selectAllVisible() {
    const visibleIds = filteredEmployees.map(employeeId).filter(Boolean);

    setSelectedIds((current) => Array.from(new Set([...current, ...visibleIds])));
  }

  function clearVisibleSelection() {
    const visibleIds = new Set(filteredEmployees.map(employeeId));
    setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)));
  }

  function updateManualInput(id, field, value) {
    setManualInputs((current) => ({
      ...current,
      [id]: {
        ...emptyManualInput(totalDays),
        ...(current[id] || {}),
        total_days: totalDays,
        [field]: value,
      },
    }));
  }

  function validateBeforeAttendanceSync() {
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return 'Select a valid payroll month.';
    }

    if (superAdmin && !tenantId.trim()) {
      return 'Enter the tenant ID for the company whose attendance you want to synchronize.';
    }

    if (scope === 'selected' && selectedIds.length === 0) {
      return 'Select at least one employee before synchronizing attendance.';
    }

    return '';
  }

  function buildAttendanceSyncPayload() {
    const payload = {
      period,
      persist: true,
    };

    if (superAdmin) {
      payload.tenant_id = tenantId.trim();
    }

    if (scope === 'selected') {
      payload.employee_ids = selectedIds;
    }

    return payload;
  }

  async function synchronizeAttendance() {
    const validationMessage = validateBeforeAttendanceSync();

    if (validationMessage) {
      alerts.warning(validationMessage, 'Attendance Sync Input Required');
      return;
    }

    const targetCount = scope === 'selected' ? selectedIds.length : employees.length;
    const confirmed = await alerts.confirm(
      `Synchronize approved leave, LWP, leave balances, attendance logs and holidays for ${period}${
        targetCount
          ? ` for ${targetCount} employee${targetCount === 1 ? '' : 's'}`
          : ''
      }? Uncovered absence will be reported but will not be converted to LWP automatically.`,
      'Synchronize Payroll Attendance',
      {
        confirmText: 'Synchronize Attendance',
        cancelText: 'Cancel',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setSyncingAttendance(true);
      setAttendanceSyncFailures([]);

      const data = await api('/payroll/attendance-sync', {
        method: 'POST',
        body: JSON.stringify(buildAttendanceSyncPayload()),
        timeoutMs: 120000,
      });

      const result = data.attendance_sync || data;
      const failures = Array.isArray(result.failures)
        ? result.failures
        : Array.isArray(data.failures)
          ? data.failures
          : [];

      setAttendanceSource('saved');
      setAttendanceSyncResult(result);
      setAttendanceSyncFailures(failures);

      const syncedCount = toNumber(
        result.totals?.employees_synced ?? data.totals?.employees_synced,
        0,
      );

      if (failures.length) {
        alerts.warning(
          `${syncedCount} employee attendance summar${
            syncedCount === 1 ? 'y was' : 'ies were'
          } saved, but ${failures.length} employee${
            failures.length === 1 ? '' : 's'
          } failed validation. Review the details before calculating payroll.`,
          'Attendance Partially Synchronized',
        );
      } else {
        alerts.success(
          data.message || 'Payroll attendance synchronized successfully.',
          'Attendance Synchronized',
        );
      }
    } catch (error) {
      const failures = Array.isArray(error?.payload?.failures)
        ? error.payload.failures
        : [];

      setAttendanceSyncFailures(failures);

      alerts.error(
        error.message || 'Unable to synchronize payroll attendance.',
        'Attendance Sync Failed',
      );
    } finally {
      setSyncingAttendance(false);
    }
  }

  function validateBeforeCalculation() {
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return 'Select a valid payroll month.';
    }

    if (superAdmin && !tenantId.trim()) {
      return 'Enter the tenant ID for the company whose payroll you want to process.';
    }

    if (scope === 'selected' && selectedIds.length === 0) {
      return 'Select at least one employee.';
    }

    if (attendanceSource === 'manual') {
      if (!targetEmployees.length) {
        return 'Load the employee list before entering manual payroll inputs.';
      }

      for (const employee of targetEmployees) {
        const id = employeeId(employee);
        const input = manualInputs[id] || {};

        if (input.lwp_days === '' || input.lwp_days === null || input.lwp_days === undefined) {
          return `Enter LWP days for ${employeeName(employee)}. LWP is never assumed as zero.`;
        }

        const lwpDays = Number(input.lwp_days);

        if (!Number.isFinite(lwpDays) || lwpDays < 0 || lwpDays > totalDays) {
          return `Enter valid LWP days for ${employeeName(employee)}.`;
        }

        if (input.working_days !== '' && toNumber(input.working_days, -1) < 0) {
          return `Enter valid working days for ${employeeName(employee)}.`;
        }

        if (input.paid_leave_days !== '' && toNumber(input.paid_leave_days, -1) < 0) {
          return `Enter valid paid leave days for ${employeeName(employee)}.`;
        }

      }
    }

    return '';
  }

  function buildCalculationPayload() {
    const payload = {
      period,
    };

    if (superAdmin) {
      payload.tenant_id = tenantId.trim();
    }

    if (scope === 'selected') {
      payload.employee_ids = selectedIds;
    }

    if (attendanceSource === 'manual') {
      payload.attendance = targetEmployees.map((employee) => {
        const id = employeeId(employee);
        const input = manualInputs[id] || emptyManualInput(totalDays);
        const row = {
          employee_id: id,
          total_days: totalDays,
          paid_leave_days: input.paid_leave_days === '' ? 0 : Number(input.paid_leave_days),
          lwp_days: Number(input.lwp_days),
        };

        if (input.working_days !== '') {
          row.working_days = Number(input.working_days);
        }

        return row;
      });
    }

    return payload;
  }

  async function calculatePayroll() {
    const validationMessage = validateBeforeCalculation();

    if (validationMessage) {
      alerts.warning(validationMessage, 'Payroll Input Required');
      return;
    }

    const targetCount = scope === 'selected' ? selectedIds.length : employees.length;
    const confirmed = await alerts.confirm(
      `Create or recalculate the Draft payroll for ${period}${
        targetCount ? ` for ${targetCount} employee${targetCount === 1 ? '' : 's'}` : ''
      }? A run that has moved beyond Draft cannot be recalculated.`,
      'Calculate Draft Payroll',
      {
        confirmText: 'Calculate Payroll',
        cancelText: 'Cancel',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setCalculating(true);
      setCalculationErrors([]);

      const data = await api('/payroll/calculate', {
        method: 'POST',
        body: JSON.stringify(buildCalculationPayload()),
        timeoutMs: 120000,
      });

      const run = data.run || null;
      const calculatedPayslips = data.payslips || [];

      setActiveRun(run);
      setPayslips(calculatedPayslips);
      setCalculationErrors([]);

      await loadRuns({
        silent: true,
        preferredRunId: resolveRunId(run),
      });

      alerts.success(
        data.message || 'Draft payroll calculated successfully.',
        'Payroll Calculated',
      );
    } catch (error) {
      const rows = Array.isArray(error?.payload?.errors) ? error.payload.errors : [];
      setCalculationErrors(rows);

      alerts.error(
        error.message || 'Unable to calculate payroll.',
        'Payroll Calculation Failed',
      );
    } finally {
      setCalculating(false);
    }
  }

  async function refreshAll() {
    await Promise.all([
      loadEmployees(),
      loadRuns(),
    ]);
  }

  async function handlePayslipPdf(payslip, mode) {
    const employeeIdValue = resolvePayslipEmployeeId(payslip);
    const { year, month } = resolvePayrollPeriod(payslip, activeRun || {});

    if (!employeeIdValue || !year || !month) {
      alerts.warning(
        'This payslip does not contain a valid employee ID and payroll period.',
        'Payslip PDF Unavailable',
      );
      return;
    }

    const actionKey = `${employeeIdValue}-${year}-${month}-${mode}`;
    let previewWindow = null;

    if (mode === 'preview') {
      previewWindow = window.open('', '_blank');

      if (!previewWindow) {
        alerts.warning(
          'Allow pop-ups for this HRMS site, then try Preview PDF again.',
          'Preview Blocked',
        );
        return;
      }

      previewWindow.opener = null;
      previewWindow.document.title = 'Preparing payslip';
      previewWindow.document.body.innerHTML =
        '<p style="font-family:Arial,sans-serif;padding:24px">Preparing payslip PDF…</p>';
    }

    try {
      setPdfActionKey(actionKey);

      const query = buildQuery({
        ...tenantParams(),
        download: mode === 'download' ? 1 : 0,
      });
      const token = getToken();
      const response = await fetch(
        getApiUrl(
          `/payroll/payslip/${encodeURIComponent(employeeIdValue)}/${month}/${year}${query}`,
        ),
        {
          method: 'GET',
          headers: {
            Accept: 'application/pdf, application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );

      if (!response.ok) {
        throw new Error(await readPdfError(response));
      }

      const blob = await response.blob();

      if (!blob.size) {
        throw new Error('The backend returned an empty payslip PDF.');
      }

      const objectUrl = URL.createObjectURL(blob);
      const fallbackFilename = payslipPdfFilename(payslip, year, month);
      const filename = filenameFromDisposition(
        response.headers.get('content-disposition'),
        fallbackFilename,
      );

      if (mode === 'preview') {
        previewWindow.location.replace(objectUrl);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
      } else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

        alerts.success(
          `${filename} was downloaded successfully.`,
          'Payslip Downloaded',
        );
      }
    } catch (error) {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.close();
      }

      alerts.error(
        error.message || 'Unable to generate the payslip PDF.',
        mode === 'preview' ? 'Payslip Preview Failed' : 'Payslip Download Failed',
      );
    } finally {
      setPdfActionKey('');
    }
  }

  return (
    <div className="payroll-page">
      <style>{`
        .payroll-page {
          display: grid;
          gap: 18px;
          min-width: 0;
        }

        .payroll-hero {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
          flex-wrap: wrap;
          background:
            radial-gradient(circle at 0% 0%, rgba(79, 70, 229, .12), transparent 38%),
            radial-gradient(circle at 100% 20%, rgba(5, 150, 105, .10), transparent 32%),
            #fff;
        }

        .payroll-hero h2 {
          margin: 0 0 8px;
          color: var(--ink);
          font-size: clamp(24px, 3vw, 34px);
        }

        .payroll-hero p {
          margin: 0;
          max-width: 760px;
          line-height: 1.6;
        }

        .payroll-hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid var(--primaryRing);
          background: var(--primarySoft);
          color: var(--primaryDark);
          border-radius: 999px;
          padding: 9px 13px;
          font-weight: 900;
          white-space: nowrap;
        }

        .payroll-module-links {
          display: grid;
          grid-template-columns: repeat(6, minmax(150px, 1fr));
          gap: 11px;
        }

        .payroll-module-link {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          min-height: 54px;
          padding: 12px 13px;
          border: 1px solid var(--line);
          border-radius: 15px;
          background: #fff;
          color: var(--ink);
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          text-align: left;
          cursor: pointer;
          transition:
            transform .15s ease,
            border-color .15s ease,
            box-shadow .15s ease;
        }

        .payroll-module-link:hover {
          transform: translateY(-1px);
          border-color: var(--primaryRing);
          box-shadow: 0 10px 24px rgba(15, 23, 42, .07);
        }

        .payroll-module-link svg {
          flex: 0 0 auto;
          color: var(--primary);
        }

        .payroll-module-link span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .payroll-metric-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 14px;
        }

        .payroll-metric {
          min-width: 0;
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }

        .payroll-metric-icon {
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          color: var(--primary);
          background: var(--primarySoft);
        }

        .payroll-metric span {
          display: block;
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .05em;
        }

        .payroll-metric strong {
          display: block;
          margin-top: 5px;
          color: var(--ink);
          font-size: clamp(18px, 2vw, 26px);
          overflow-wrap: anywhere;
        }

        .payroll-form-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(180px, 1fr));
          gap: 14px;
          align-items: end;
          margin-top: 16px;
        }

        .payroll-field {
          display: grid;
          gap: 7px;
          min-width: 0;
        }

        .payroll-field > span {
          color: var(--muted);
          font-size: 13px;
          font-weight: 900;
        }

        .payroll-field input,
        .payroll-field select {
          width: 100%;
          min-width: 0;
          min-height: 44px;
          padding: 11px 13px;
          border-radius: 14px;
          border: 1px solid var(--line);
          background: #fff;
          color: var(--text);
          outline: none;
        }

        .payroll-field input:focus,
        .payroll-field select:focus {
          border-color: var(--primaryRing);
          box-shadow: 0 0 0 4px rgba(79, 70, 229, .10);
        }

        .payroll-field input[readonly] {
          background: var(--surface2);
          color: var(--muted);
        }

        .payroll-action-row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
          margin-top: 16px;
        }

        .payroll-note {
          margin-top: 14px;
          border: 1px solid #FDE68A;
          background: var(--warningSoft);
          color: #92400E;
          border-radius: 16px;
          padding: 12px 14px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          line-height: 1.5;
        }

        .payroll-note svg {
          flex: 0 0 auto;
          margin-top: 2px;
        }

        .payroll-picker-head,
        .payroll-table-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          align-items: center;
        }

        .payroll-picker-head h3,
        .payroll-table-head h3 {
          margin: 0;
        }

        .payroll-table-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .payroll-search {
          position: relative;
          width: min(420px, 100%);
        }

        .payroll-search svg {
          position: absolute;
          left: 13px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--muted);
          pointer-events: none;
        }

        .payroll-search input {
          width: 100%;
          min-height: 44px;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 11px 13px 11px 40px;
          outline: none;
        }

        .payroll-search input:focus {
          border-color: var(--primaryRing);
          box-shadow: 0 0 0 4px rgba(79, 70, 229, .10);
        }

        .payroll-selector-table table,
        .payroll-input-table table,
        .payroll-result-table table,
        .payroll-run-table table {
          min-width: 980px;
        }

        .payroll-selector-table input[type='checkbox'] {
          width: 18px;
          height: 18px;
          accent-color: var(--primary);
        }

        .payroll-input-table input {
          width: 110px;
          min-height: 38px;
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 8px 10px;
          outline: none;
        }

        .payroll-input-table input:focus {
          border-color: var(--primaryRing);
          box-shadow: 0 0 0 3px rgba(79, 70, 229, .10);
        }

        .payroll-input-table input[readonly] {
          background: var(--surface2);
          color: var(--muted);
        }

        .payroll-status {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
        }

        .payroll-status-success {
          color: #047857;
          background: var(--successSoft);
          border: 1px solid #A7F3D0;
        }

        .payroll-status-info {
          color: #0369A1;
          background: var(--infoSoft);
          border: 1px solid #BAE6FD;
        }

        .payroll-status-warning {
          color: #92400E;
          background: var(--warningSoft);
          border: 1px solid #FDE68A;
        }

        .payroll-status-danger {
          color: #991B1B;
          background: var(--dangerSoft);
          border: 1px solid #FECACA;
        }

        .payroll-active-row td {
          background: var(--primarySoft) !important;
        }

        .payroll-error-box {
          border: 1px solid #FECACA;
          background: #FEF2F2;
        }

        .payroll-error-box h3 {
          color: #991B1B;
        }

        .payroll-error-list {
          display: grid;
          gap: 10px;
          margin-top: 14px;
        }

        .payroll-error-item {
          border: 1px solid #FECACA;
          background: #fff;
          border-radius: 14px;
          padding: 12px;
        }

        .payroll-error-item strong {
          display: block;
          color: #991B1B;
          margin-bottom: 4px;
        }

        .payroll-error-item p {
          margin: 0;
          color: #7F1D1D;
        }

        .payroll-muted {
          color: var(--muted);
          font-size: 13px;
        }

        .payroll-employee-name {
          color: var(--ink);
          font-weight: 900;
        }

        .payroll-employee-meta {
          display: block;
          margin-top: 3px;
          color: var(--muted);
          font-size: 12px;
        }

        .payroll-pdf-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          min-width: 230px;
        }

        .payroll-pdf-actions button {
          min-height: 36px;
          padding: 8px 11px;
          white-space: nowrap;
        }

        .payroll-pdf-actions .payroll-pdf-unavailable {
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
        }

        .payroll-result-table table {
          min-width: 1560px;
        }

        .payroll-tax-source {
          display: grid;
          gap: 4px;
          min-width: 130px;
        }

        .payroll-tax-source small {
          color: var(--muted);
          font-size: 11px;
        }

        .payroll-bank-ready {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #047857;
          font-size: 12px;
          font-weight: 900;
        }

        .payroll-bank-missing {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #92400E;
          font-size: 12px;
          font-weight: 900;
        }

        .payroll-sync-summary {
          display: grid;
          gap: 16px;
        }

        .payroll-sync-metrics {
          display: grid;
          grid-template-columns: repeat(6, minmax(120px, 1fr));
          gap: 12px;
        }

        .payroll-sync-metric {
          min-width: 0;
          padding: 14px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--surface-soft, rgba(148, 163, 184, 0.08));
        }

        .payroll-sync-metric span {
          display: block;
          margin-bottom: 5px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }

        .payroll-sync-metric strong {
          font-size: 22px;
          line-height: 1.2;
        }

        .payroll-sync-table table {
          min-width: 1040px;
        }

        .payroll-sync-warning {
          display: block;
          max-width: 360px;
          color: #92400e;
          font-size: 12px;
          line-height: 1.45;
        }

        .payroll-sync-ok {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #047857;
          font-size: 12px;
          font-weight: 800;
        }

        @media (max-width: 1180px) {
          .payroll-module-links {
            grid-template-columns: repeat(3, minmax(150px, 1fr));
          }

          .payroll-metric-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .payroll-form-grid {
            grid-template-columns: repeat(2, minmax(180px, 1fr));
          }

          .payroll-sync-metrics {
            grid-template-columns: repeat(3, minmax(120px, 1fr));
          }
        }

        @media (max-width: 720px) {
          .payroll-module-links,
          .payroll-metric-grid,
          .payroll-form-grid,
          .payroll-sync-metrics {
            grid-template-columns: 1fr;
          }

          .payroll-hero-badge,
          .payroll-action-row button {
            width: 100%;
          }
        }
      `}</style>

      <section className="panel payroll-hero">
        <div>
          <h2>Payroll Processing</h2>
          <p>
            Calculate Draft payroll using active salary structures, effective statutory
            configuration, synchronized attendance and LWP, approved reimbursements,
            active loan recoveries, verified bank data, and Finance-controlled Disabled,
            Manual or External TDS instructions.
          </p>
        </div>

        <div className="payroll-hero-badge">
          <WalletCards size={18} />
          Draft calculation stage
        </div>
      </section>

      <section className="payroll-module-links" aria-label="Payroll module shortcuts">
        <button
          type="button"
          className="payroll-module-link"
          onClick={() => setPage('payroll_configuration')}
        >
          <Calculator size={18} />
          <span>Payroll Configuration</span>
        </button>

        <button
          type="button"
          className="payroll-module-link"
          onClick={() => setPage('loans_advances')}
        >
          <IndianRupee size={18} />
          <span>Loans & Advances</span>
        </button>

        <button
          type="button"
          className="payroll-module-link"
          onClick={() => setPage('reimbursements')}
        >
          <WalletCards size={18} />
          <span>Reimbursements</span>
        </button>

        <button
          type="button"
          className="payroll-module-link"
          onClick={() => setPage('payroll_banking')}
        >
          <WalletCards size={18} />
          <span>Payroll Banking</span>
        </button>

        <button
          type="button"
          className="payroll-module-link"
          onClick={() => setPage('payroll_reports')}
        >
          <FileText size={18} />
          <span>Payroll Reports</span>
        </button>

        <button
          type="button"
          className="payroll-module-link"
          onClick={() => setPage('tax_declarations')}
        >
          <CheckCircle2 size={18} />
          <span>Tax Declarations & TDS</span>
        </button>
      </section>

      <section className="payroll-metric-grid">
        <article className="panel payroll-metric">
          <div className="payroll-metric-icon">
            <Users size={21} />
          </div>
          <div>
            <span>Employees</span>
            <strong>{activeRun?.employee_count ?? payslips.length ?? 0}</strong>
          </div>
        </article>

        <article className="panel payroll-metric">
          <div className="payroll-metric-icon">
            <IndianRupee size={21} />
          </div>
          <div>
            <span>Gross salary</span>
            <strong>{formatCurrency(activeTotals.gross_salary)}</strong>
          </div>
        </article>

        <article className="panel payroll-metric">
          <div className="payroll-metric-icon">
            <WalletCards size={21} />
          </div>
          <div>
            <span>Cost to company</span>
            <strong>{formatCurrency(activeTotals.cost_to_company)}</strong>
          </div>
        </article>

        <article className="panel payroll-metric">
          <div className="payroll-metric-icon">
            <Calculator size={21} />
          </div>
          <div>
            <span>Total deductions</span>
            <strong>{formatCurrency(activeTotals.total_deductions)}</strong>
          </div>
        </article>

        <article className="panel payroll-metric">
          <div className="payroll-metric-icon">
            <CheckCircle2 size={21} />
          </div>
          <div>
            <span>Net payout</span>
            <strong>{formatCurrency(activeTotals.net_amount)}</strong>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Create or recalculate Draft payroll</h3>
            <p>Locked or non-Draft payroll runs cannot be recalculated.</p>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={refreshAll}
            disabled={
              loadingEmployees ||
              loadingRuns ||
              calculating ||
              syncingAttendance
            }
          >
            {loadingEmployees || loadingRuns ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <RefreshCw size={17} />
            )}
            Refresh data
          </button>
        </div>

        <div className="payroll-form-grid">
          <label className="payroll-field">
            <span>Payroll month</span>
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              disabled={calculating || syncingAttendance}
            />
          </label>

          {superAdmin ? (
            <label className="payroll-field">
              <span>Company tenant ID</span>
              <input
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder="Example: sds"
                disabled={calculating || syncingAttendance}
              />
            </label>
          ) : null}

          <label className="payroll-field">
            <span>Employee scope</span>
            <select
              value={scope}
              onChange={(event) => {
                setScope(event.target.value);
                if (event.target.value === 'selected') {
                  setShowEmployeePicker(true);
                }
              }}
              disabled={calculating || syncingAttendance}
            >
              <option value="all">All active employees</option>
              <option value="selected">Selected employees</option>
            </select>
          </label>

          <label className="payroll-field">
            <span>Attendance input</span>
            <select
              value={attendanceSource}
              onChange={(event) => setAttendanceSource(event.target.value)}
              disabled={calculating || syncingAttendance}
            >
              <option value="saved">Use saved attendance summaries</option>
              <option value="manual">Enter attendance manually</option>
            </select>
          </label>
        </div>

        <div className="payroll-action-row">
          {scope === 'selected' ? (
            <button
              type="button"
              className="secondary"
              onClick={() => setShowEmployeePicker((current) => !current)}
              disabled={loadingEmployees || calculating || syncingAttendance}
            >
              {showEmployeePicker ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
              {selectedIds.length
                ? `${selectedIds.length} employee${selectedIds.length === 1 ? '' : 's'} selected`
                : 'Select employees'}
            </button>
          ) : null}

          {attendanceSource === 'saved' ? (
            <button
              type="button"
              className="secondary"
              onClick={synchronizeAttendance}
              disabled={
                syncingAttendance ||
                calculating ||
                loadingEmployees ||
                (scope === 'selected' && selectedIds.length === 0)
              }
            >
              {syncingAttendance ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <RefreshCw size={18} />
              )}
              {syncingAttendance
                ? 'Synchronizing attendance…'
                : 'Sync Attendance & Leave'}
            </button>
          ) : null}

          <button
            type="button"
            className="primary"
            onClick={calculatePayroll}
            disabled={calculating || syncingAttendance || loadingEmployees}
          >
            {calculating ? <Loader2 size={18} className="spin" /> : <Calculator size={18} />}
            {calculating ? 'Calculating payroll…' : 'Calculate Draft Payroll'}
          </button>
        </div>

        <div className="payroll-note">
          <AlertTriangle size={19} />
          <div>
            <strong>No money rule is guessed.</strong> In saved mode, first synchronize
            attendance and approved leave for the selected month. Only approved LWP reduces
            salary; paid leave is tracking-only, and uncovered absence is never converted to
            LWP automatically. Manual mode requires an explicit LWP value for every employee.
            TDS is sent only when you enter it.
          </div>
        </div>
      </section>

      {scope === 'selected' && showEmployeePicker ? (
        <section className="panel">
          <div className="payroll-picker-head">
            <div>
              <h3>Select employees</h3>
              <p>
                {selectedIds.length} selected from {employees.length} active employees.
              </p>
            </div>

            <div className="payroll-search">
              <Search size={17} />
              <input
                value={employeeSearch}
                onChange={(event) => setEmployeeSearch(event.target.value)}
                placeholder="Search name, code, department or designation"
              />
            </div>
          </div>

          <div className="payroll-action-row">
            <button type="button" className="secondary" onClick={selectAllVisible}>
              Select visible
            </button>
            <button type="button" className="secondary" onClick={clearVisibleSelection}>
              Clear visible
            </button>
          </div>

          <div className="table-wrap payroll-selector-table">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Employee</th>
                  <th>Code</th>
                  <th>Department</th>
                  <th>Designation</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((employee) => {
                  const id = employeeId(employee);

                  return (
                    <tr key={id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(id)}
                          onChange={() => toggleEmployee(id)}
                          aria-label={`Select ${employeeName(employee)}`}
                        />
                      </td>
                      <td className="payroll-employee-name">{employeeName(employee)}</td>
                      <td>{employeeCode(employee)}</td>
                      <td>{employeeDepartment(employee)}</td>
                      <td>{employeeDesignation(employee)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!filteredEmployees.length ? (
            <div className="empty">
              {loadingEmployees ? 'Loading employees…' : 'No matching active employees found.'}
            </div>
          ) : null}
        </section>
      ) : null}

      {attendanceSyncResult ? (
        <section className="panel payroll-sync-summary">
          <div className="payroll-table-head">
            <div>
              <h3>Attendance synchronization — {safeText(attendanceSyncResult.period_key, period)}</h3>
              <p>
                These saved summaries will be used by Draft payroll calculation in
                <strong> saved attendance</strong> mode.
              </p>
            </div>

            <span className="payroll-hero-badge">
              <CheckCircle2 size={16} />
              {safeText(attendanceSyncResult.persisted, false) === 'true'
                ? 'Saved'
                : attendanceSyncResult.persisted
                  ? 'Saved'
                  : 'Preview only'}
            </span>
          </div>

          <div className="payroll-sync-metrics">
            <article className="payroll-sync-metric">
              <span>Employees synced</span>
              <strong>{toNumber(attendanceSyncResult.totals?.employees_synced, 0)}</strong>
            </article>
            <article className="payroll-sync-metric">
              <span>Failed</span>
              <strong>{toNumber(attendanceSyncResult.totals?.employees_failed, 0)}</strong>
            </article>
            <article className="payroll-sync-metric">
              <span>Working days</span>
              <strong>{toNumber(attendanceSyncResult.totals?.total_working_days, 0)}</strong>
            </article>
            <article className="payroll-sync-metric">
              <span>Present days</span>
              <strong>{toNumber(attendanceSyncResult.totals?.total_present_days, 0)}</strong>
            </article>
            <article className="payroll-sync-metric">
              <span>Paid leave</span>
              <strong>{toNumber(attendanceSyncResult.totals?.total_paid_leave_days, 0)}</strong>
            </article>
            <article className="payroll-sync-metric">
              <span>LWP days</span>
              <strong>{toNumber(attendanceSyncResult.totals?.total_lwp_days, 0)}</strong>
            </article>
          </div>

          <div className="table-wrap payroll-sync-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Working</th>
                  <th>Present</th>
                  <th>Paid leave</th>
                  <th>LWP</th>
                  <th>Uncovered absence</th>
                  <th>Payable days</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {(attendanceSyncResult.items || []).map((item) => {
                  const warnings = Array.isArray(item.warnings) ? item.warnings : [];

                  return (
                    <tr key={`${safeText(item.employee_id, 'employee')}-${safeText(item.period_key, period)}`}>
                      <td>
                        <span className="payroll-employee-name">
                          {safeText(item.employee_name, 'Employee')}
                        </span>
                        <span className="payroll-employee-meta">
                          {safeText(item.employee_code)}
                        </span>
                      </td>
                      <td>{safeText(item.working_days, '0')}</td>
                      <td>{safeText(item.present_days, '0')}</td>
                      <td>{safeText(item.paid_leave_days, '0')}</td>
                      <td>{safeText(item.lwp_days, '0')}</td>
                      <td>{safeText(item.absent_days, '0')}</td>
                      <td>{safeText(item.payable_days, '0')}</td>
                      <td>
                        {warnings.length ? (
                          <span className="payroll-sync-warning">
                            {warnings.join(' ')}
                          </span>
                        ) : (
                          <span className="payroll-sync-ok">
                            <CheckCircle2 size={14} />
                            Ready
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!attendanceSyncResult.items?.length ? (
            <div className="empty">No attendance summaries were synchronized.</div>
          ) : null}
        </section>
      ) : null}

      {attendanceSyncFailures.length ? (
        <section className="panel payroll-error-box">
          <h3>Attendance synchronization failures</h3>
          <p>
            Resolve these employee-level issues and run attendance synchronization again
            before calculating payroll.
          </p>

          <div className="payroll-error-list">
            {attendanceSyncFailures.map((failure, index) => (
              <article
                className="payroll-error-item"
                key={`${safeText(failure.employee_id, 'employee')}-${safeText(failure.code, index)}`}
              >
                <strong>
                  {safeText(failure.employee_name, 'Employee')}
                  {failure.employee_code ? ` (${failure.employee_code})` : ''}
                </strong>
                <p>{safeText(failure.message, 'Attendance synchronization failed.')}</p>
                {failure.code ? <small>Code: {failure.code}</small> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {attendanceSource === 'manual' ? (
        <section className="panel">
          <div className="payroll-table-head">
            <div>
              <h3>Manual attendance input</h3>
              <p>
                Calendar days are fixed from the selected month. Leave shown here is
                tracking-only; only LWP reduces salary. TDS is resolved automatically
                from the active Finance instruction and cannot be entered here.
              </p>
            </div>
            <span className="payroll-hero-badge">
              {targetEmployees.length} employee{targetEmployees.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="table-wrap payroll-input-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Total days</th>
                  <th>Working days</th>
                  <th>Paid leave</th>
                  <th>LWP days *</th>
                </tr>
              </thead>
              <tbody>
                {targetEmployees.map((employee) => {
                  const id = employeeId(employee);
                  const input = manualInputs[id] || emptyManualInput(totalDays);

                  return (
                    <tr key={id}>
                      <td>
                        <span className="payroll-employee-name">{employeeName(employee)}</span>
                        <span className="payroll-employee-meta">{employeeCode(employee)}</span>
                      </td>
                      <td>
                        <input value={totalDays} readOnly aria-label="Total calendar days" />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={input.working_days}
                          onChange={(event) => updateManualInput(id, 'working_days', event.target.value)}
                          placeholder="If required"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={input.paid_leave_days}
                          onChange={(event) => updateManualInput(id, 'paid_leave_days', event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max={totalDays}
                          step="0.5"
                          value={input.lwp_days}
                          onChange={(event) => updateManualInput(id, 'lwp_days', event.target.value)}
                          placeholder="Required"
                          required
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!targetEmployees.length ? (
            <div className="empty">
              {scope === 'selected'
                ? 'Select at least one employee to enter manual attendance.'
                : 'Load employees to enter manual attendance.'}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="payroll-note">
        <CheckCircle2 size={18} />
        <div>
          <strong>TDS and tax declarations are centrally controlled.</strong>
          <div>
            Payroll ignores client-entered TDS overrides. Each payslip stores the exact
            approved declaration and effective Disabled, Manual or External TDS
            instruction snapshots used during calculation.
          </div>
        </div>
      </section>

      {calculationErrors.length ? (
        <section className="panel payroll-error-box">
          <h3>Payroll validation failed</h3>
          <p>
            Nothing was saved because one or more employees failed validation.
          </p>

          <div className="payroll-error-list">
            {calculationErrors.map((error, index) => (
              <article
                className="payroll-error-item"
                key={`${safeText(error.employee_id, 'employee')}-${safeText(error.code, index)}`}
              >
                <strong>
                  {safeText(error.employee_name, 'Employee')}
                  {error.employee_code ? ` (${error.employee_code})` : ''}
                </strong>
                <p>{safeText(error.message, 'Payroll validation failed.')}</p>
                {error.code ? <small>Code: {error.code}</small> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="payroll-table-head">
          <div>
            <h3>Recent payroll runs</h3>
            <p>Select a run to view its employee-level payroll results.</p>
          </div>

          {loadingRuns ? (
            <span className="payroll-muted">
              <Loader2 size={15} className="spin" /> Loading runs…
            </span>
          ) : null}
        </div>

        <div className="table-wrap payroll-run-table">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Period</th>
                <th>Status</th>
                <th>Employees</th>
                <th>CTC</th>
                <th>Net payout</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const runId = resolveRunId(run);
                const totals = resolveRunTotals(run);
                const isActive = resolveRunId(activeRun) === runId;

                return (
                  <tr key={runId} className={isActive ? 'payroll-active-row' : ''}>
                    <td>
                      <span className="payroll-employee-name">
                        {safeText(run.run_code, runId.slice(-8).toUpperCase())}
                      </span>
                    </td>
                    <td>{safeText(run.period_key || run.month)}</td>
                    <td>
                      <span className={statusClass(run.status || run.workflow_stage)}>
                        {statusLabel(run.status || run.workflow_stage)}
                      </span>
                    </td>
                    <td>{toNumber(run.employee_count, 0)}</td>
                    <td>{formatCurrency(totals.cost_to_company)}</td>
                    <td>{formatCurrency(totals.net_amount)}</td>
                    <td>{formatDate(run.updated_at || run.calculated_at || run.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className={isActive ? 'primary' : 'secondary'}
                        onClick={() => setActiveRun(run)}
                      >
                        {isActive ? 'Selected' : 'View results'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!runs.length && !loadingRuns ? (
          <div className="empty">No payroll run has been created yet.</div>
        ) : null}
      </section>

      <section className="panel">
        <div className="payroll-table-head">
          <div>
            <h3 className="payroll-table-title">
              <FileText size={19} />
              Payroll results
              {activeRun?.period_key ? ` — ${activeRun.period_key}` : ''}
            </h3>
            <p>
              The figures below are persisted payslip snapshots. Preview or download the
              exact server-generated PDF without recalculating any payroll value.
            </p>
          </div>

          {activeRun ? (
            <span className={statusClass(activeRun.status || activeRun.workflow_stage)}>
              {statusLabel(activeRun.status || activeRun.workflow_stage)}
            </span>
          ) : null}
        </div>

        <div className="table-wrap payroll-result-table">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Paid days</th>
                <th>LWP</th>
                <th>Gross</th>
                <th>Employer PF</th>
                <th>PT</th>
                <th>TDS</th>
                <th>TDS source</th>
                <th>Advances</th>
                <th>Reimbursements</th>
                <th>Total deductions</th>
                <th>Net amount</th>
                <th>Bank snapshot</th>
                <th>Payslip PDF</th>
              </tr>
            </thead>
            <tbody>
              {payslips.map((payslip) => {
                const totals = resolvePayslipTotals(payslip);
                const attendance = payslip.attendance || {};
                const taxDeclaration = resolveTaxDeclarationSnapshot(payslip);
                const tdsInstruction = resolveTdsInstructionSnapshot(payslip);
                const tdsMode = resolveTdsMode(payslip);
                const bankSnapshotAvailable = hasBankSnapshot(payslip);

                return (
                  <tr key={safeText(payslip._id || payslip.employee_id)}>
                    <td>
                      <span className="payroll-employee-name">
                        {safeText(payslip.employee_name || payslip.employee_info?.name, 'Employee')}
                      </span>
                      <span className="payroll-employee-meta">
                        {safeText(payslip.employee_code || payslip.employee_info?.employee_code)}
                      </span>
                    </td>
                    <td>
                      {safeText(
                        attendance.payable_days ?? attendance.salary_paid_days,
                        '—',
                      )}
                    </td>
                    <td>{safeText(attendance.lwp_days, '0')}</td>
                    <td>{formatCurrency(totals.gross_salary)}</td>
                    <td>{formatCurrency(totals.pf_employer)}</td>
                    <td>{formatCurrency(totals.professional_tax)}</td>
                    <td>{formatCurrency(totals.tds)}</td>
                    <td>
                      <div className="payroll-tax-source">
                        <span className={statusClass(
                          tdsMode === 'disabled' ? 'draft' : 'reviewed'
                        )}>
                          {statusLabel(tdsMode)}
                        </span>
                        <small>
                          Declaration: {statusLabel(
                            taxDeclaration.status || 'not_found'
                          )}
                        </small>
                        {tdsInstruction.effective_from_period ? (
                          <small>
                            Effective: {tdsInstruction.effective_from_period}
                          </small>
                        ) : null}
                      </div>
                    </td>
                    <td>{formatCurrency(totals.advances)}</td>
                    <td>{formatCurrency(resolveReimbursementTotal(totals))}</td>
                    <td>{formatCurrency(totals.total_deductions)}</td>
                    <td>
                      <strong>{formatCurrency(totals.net_amount)}</strong>
                    </td>
                    <td>
                      {bankSnapshotAvailable ? (
                        <span className="payroll-bank-ready">
                          <CheckCircle2 size={14} />
                          Available
                        </span>
                      ) : (
                        <span className="payroll-bank-missing">
                          <AlertTriangle size={14} />
                          Not prepared
                        </span>
                      )}
                    </td>
                    <td>
                      {(() => {
                        const employeeIdValue = resolvePayslipEmployeeId(payslip);
                        const { year, month } = resolvePayrollPeriod(
                          payslip,
                          activeRun || {},
                        );
                        const previewKey = `${employeeIdValue}-${year}-${month}-preview`;
                        const downloadKey = `${employeeIdValue}-${year}-${month}-download`;
                        const pdfAvailable = Boolean(employeeIdValue && year && month);

                        if (!pdfAvailable) {
                          return (
                            <span className="payroll-pdf-unavailable">
                              PDF data unavailable
                            </span>
                          );
                        }

                        return (
                          <div className="payroll-pdf-actions">
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => handlePayslipPdf(payslip, 'preview')}
                              disabled={Boolean(pdfActionKey)}
                              title="Open the generated payslip PDF in a new tab"
                            >
                              {pdfActionKey === previewKey ? (
                                <Loader2 size={15} className="spin" />
                              ) : (
                                <Eye size={15} />
                              )}
                              Preview
                            </button>

                            <button
                              type="button"
                              className="primary"
                              onClick={() => handlePayslipPdf(payslip, 'download')}
                              disabled={Boolean(pdfActionKey)}
                              title="Download the generated payslip PDF"
                            >
                              {pdfActionKey === downloadKey ? (
                                <Loader2 size={15} className="spin" />
                              ) : (
                                <Download size={15} />
                              )}
                              Download
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {loadingPayslips ? (
          <div className="empty">Loading payroll results…</div>
        ) : null}

        {!loadingPayslips && activeRun && !payslips.length ? (
          <div className="empty">No payslips were found for this payroll run.</div>
        ) : null}

        {!activeRun ? (
          <div className="empty">Select a payroll run to view its results.</div>
        ) : null}
      </section>
    </div>
  );
}