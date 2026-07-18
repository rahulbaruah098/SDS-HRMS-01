import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  IndianRupee,
  Landmark,
  Loader2,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  TrendingUp,
  UserRound,
  UsersRound,
  WalletCards,
  XCircle,
} from 'lucide-react';

import { api, getApiUrl, getToken } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DEFAULT_LIMIT = 500;

const REPORT_TYPES = [
  {
    key: 'payroll_register',
    label: 'Payroll Register',
    description:
      'Employee-level payroll, attendance, statutory deductions, reimbursements, net pay and payroll cost.',
    icon: FileSpreadsheet,
    managementOnly: true,
  },
  {
    key: 'payroll_summary',
    label: 'Payroll Summary',
    description:
      'Period-wise payroll totals, employee counts, statutory deductions and payroll cost.',
    icon: WalletCards,
    managementOnly: true,
  },
  {
    key: 'statutory_summary',
    label: 'Statutory Summary',
    description:
      'State-wise PF, ESI, professional tax, TDS, LWP and deduction totals.',
    icon: ShieldCheck,
    managementOnly: true,
  },
  {
    key: 'department_summary',
    label: 'Department Summary',
    description:
      'Department-wise payroll cost, deductions, reimbursements and net salary.',
    icon: Building2,
    managementOnly: true,
  },
  {
    key: 'employee_statement',
    label: 'Employee Statement',
    description:
      'Period-wise payroll statement for one employee. Employees can access only their own statement.',
    icon: UserRound,
    managementOnly: false,
  },
  {
    key: 'period_variance',
    label: 'Period Variance',
    description:
      'Compare two payroll periods and identify salary, deduction, LWP and employee changes.',
    icon: BarChart3,
    managementOnly: true,
  },
  {
    key: 'payroll_trend',
    label: 'Payroll Trend',
    description:
      'Multi-month payroll trend showing net-pay, payroll-cost and headcount changes.',
    icon: TrendingUp,
    managementOnly: true,
  },
];

const EXPORT_STATUSES = [
  ['', 'All statuses'],
  ['generated', 'Generated'],
  ['downloaded', 'Downloaded'],
  ['shared', 'Shared'],
  ['archived', 'Archived'],
];

const MANAGEMENT_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
]);

const MONEY_KEYS = new Set([
  'monthly_ctc_configured',
  'gross_salary',
  'payable_gross_salary',
  'lwp_deduction',
  'pf_employee',
  'pf_employer',
  'pf_total',
  'esi_employee',
  'esi_employer',
  'esi_total',
  'professional_tax',
  'tds',
  'advances',
  'reimbursements',
  'taxable_reimbursements',
  'non_taxable_reimbursements',
  'total_deductions',
  'net_amount',
  'cost_to_company',
  'total_payroll_cost',
  'base_net_amount',
  'comparison_net_amount',
  'net_amount_variance',
  'base_gross_salary',
  'comparison_gross_salary',
  'gross_salary_variance',
  'base_total_deductions',
  'comparison_total_deductions',
  'deduction_variance',
  'net_amount_change',
  'cost_to_company_change',
  'total_amount',
]);

const PERCENT_KEYS = new Set([
  'net_amount_variance_percent',
  'net_amount_change_percent',
]);

const DATE_KEYS = new Set([
  'created_at',
  'generated_at',
  'calculated_at',
  'locked_at',
  'disbursed_at',
  'last_generated_at',
  'updated_at',
]);

const HIDDEN_TABLE_KEYS = new Set([
  'tenant_id',
  'run_id',
  'payslip_id',
  'employee_id',
  'official_email',
  'month',
  'year',
  'currency',
  'workflow_stage',
  'is_locked',
  'bank_snapshot_available',
  'bank_name',
  'masked_account_number',
  'payment_method',
  'calculated_at',
  'locked_at',
  'disbursed_at',
  'total_payroll_cost',
  'monthly_ctc_configured',
  'taxable_reimbursements',
  'non_taxable_reimbursements',
  'pan',
  'uan',
  'esi_number',
  'pran',
  'date_of_joining',
  'function',
]);

const PRIORITY_COLUMNS = {
  payroll_register: [
    'period_key',
    'employee_code',
    'employee_name',
    'department',
    'designation',
    'working_days',
    'paid_days',
    'lwp_days',
    'gross_salary',
    'payable_gross_salary',
    'lwp_deduction',
    'pf_employee',
    'pf_employer',
    'professional_tax',
    'tds',
    'advances',
    'reimbursements',
    'total_deductions',
    'net_amount',
    'cost_to_company',
    'status',
  ],
  payroll_summary: [
    'period_key',
    'employee_count',
    'gross_salary',
    'payable_gross_salary',
    'reimbursements',
    'total_deductions',
    'net_amount',
    'cost_to_company',
  ],
  statutory_summary: [
    'period_key',
    'state_code',
    'employee_count',
    'pf_eligible_count',
    'pf_employee',
    'pf_employer',
    'pf_total',
    'esi_eligible_count',
    'esi_employee',
    'esi_employer',
    'esi_total',
    'professional_tax',
    'tds',
    'lwp_deduction',
    'total_deductions',
  ],
  department_summary: [
    'period_key',
    'department',
    'employee_count',
    'working_days',
    'paid_days',
    'lwp_days',
    'gross_salary',
    'payable_gross_salary',
    'lwp_deduction',
    'reimbursements',
    'total_deductions',
    'net_amount',
    'cost_to_company',
  ],
  employee_statement: [
    'period_key',
    'working_days',
    'paid_days',
    'lwp_days',
    'gross_salary',
    'payable_gross_salary',
    'reimbursements',
    'total_deductions',
    'net_amount',
    'cost_to_company',
    'status',
  ],
  period_variance: [
    'employee_code',
    'employee_name',
    'department',
    'employee_status',
    'base_period',
    'comparison_period',
    'base_net_amount',
    'comparison_net_amount',
    'net_amount_variance',
    'net_amount_variance_percent',
    'base_gross_salary',
    'comparison_gross_salary',
    'gross_salary_variance',
    'base_total_deductions',
    'comparison_total_deductions',
    'deduction_variance',
    'variance_reasons',
  ],
  payroll_trend: [
    'period_key',
    'employee_count',
    'gross_salary',
    'payable_gross_salary',
    'total_deductions',
    'net_amount',
    'cost_to_company',
    'net_amount_change',
    'net_amount_change_percent',
    'cost_to_company_change',
    'employee_count_change',
  ],
};

function safeText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeKey(value) {
  return safeText(value, '')
    .toLowerCase()
    .replaceAll('-', '_')
    .replace(/\s+/g, '_');
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

function hasAnyRole(user, roleSet) {
  return normalizeRoles(user).some((role) => roleSet.has(role));
}

function isSuperAdmin(user) {
  return normalizeRoles(user).includes('super_admin');
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') {
          query.append(key, item);
        }
      });
      return;
    }

    query.append(key, value);
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(toNumber(value, 0));
}

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits,
  }).format(toNumber(value, 0));
}

function formatDate(value, includeTime = true) {
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
    ...(includeTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
        }
      : {}),
  });
}

function labelFromKey(value) {
  return safeText(value, '—')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function employeeId(employee = {}) {
  return safeText(employee._id || employee.id || employee.employee_id, '');
}

function employeeName(employee = {}) {
  return safeText(
    employee.employee_name ||
      employee.name ||
      employee.full_name ||
      employee.display_name ||
      employee.official_email,
    'Employee',
  );
}

function employeeCode(employee = {}) {
  return safeText(
    employee.employee_code ||
      employee.emp_code ||
      employee.employee_id ||
      employee.code,
    '—',
  );
}

function sortEmployees(items = []) {
  return [...items].sort((left, right) =>
    employeeName(left).localeCompare(employeeName(right), 'en', {
      sensitivity: 'base',
    }),
  );
}

function recordId(record = {}) {
  return safeText(record._id || record.id, '');
}

function getCurrentEmployeeReference(user = {}) {
  return safeText(
    user.employee_id ||
      user.employee?._id ||
      user.employee?.id ||
      user.employee?.employee_id ||
      user.employee_code ||
      user.employee?.employee_code,
    '',
  );
}

function emptyFilters() {
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(
    now.getMonth() + 1,
  ).padStart(2, '0')}`;

  return {
    period: currentPeriod,
    start_period: currentPeriod,
    end_period: currentPeriod,
    base_period: '',
    comparison_period: currentPeriod,
    employee_id: '',
    department: '',
    designation: '',
    location: '',
    state_code: '',
    search: '',
    official_only: true,
    statuses: [],
  };
}

function emptyExportForm() {
  return {
    delimiter: ',',
    include_utf8_bom: true,
    filename_prefix: '',
  };
}

function emptyExportStatusForm() {
  return {
    status: 'downloaded',
    note: '',
  };
}

function reportDefinition(key) {
  return REPORT_TYPES.find((item) => item.key === key) || REPORT_TYPES[0];
}

function statusTone(value) {
  const status = normalizeKey(value);

  if (['downloaded', 'shared'].includes(status)) {
    return 'success';
  }

  if (status === 'archived') {
    return 'neutral';
  }

  return 'warning';
}

function tableColumns(reportType, rows = []) {
  if (!rows.length) {
    return PRIORITY_COLUMNS[reportType] || [];
  }

  const keys = new Set();

  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!HIDDEN_TABLE_KEYS.has(key)) {
        keys.add(key);
      }
    });
  });

  const priority = PRIORITY_COLUMNS[reportType] || [];
  const ordered = priority.filter((key) => keys.has(key));
  const remaining = [...keys]
    .filter((key) => !ordered.includes(key))
    .sort((left, right) => left.localeCompare(right));

  return [...ordered, ...remaining];
}

function formatCell(key, value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (MONEY_KEYS.has(key)) {
    return formatCurrency(value);
  }

  if (PERCENT_KEYS.has(key)) {
    return value === null ? 'N/A' : `${formatNumber(value)}%`;
  }

  if (DATE_KEYS.has(key)) {
    return formatDate(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => safeText(item)).join('; ');
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([objectKey, objectValue]) => {
        if (MONEY_KEYS.has(objectKey)) {
          return `${labelFromKey(objectKey)}: ${formatCurrency(objectValue)}`;
        }

        return `${labelFromKey(objectKey)}: ${safeText(objectValue)}`;
      })
      .join('; ');
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (
    key.endsWith('_days') ||
    key.endsWith('_count') ||
    key === 'employee_count_change'
  ) {
    return formatNumber(value);
  }

  if (
    key === 'status' ||
    key === 'employee_status' ||
    key === 'state_code'
  ) {
    return labelFromKey(value);
  }

  return safeText(value);
}

function totalValue(report = {}, key) {
  const totals = report.totals || {};

  if (totals[key] !== undefined) {
    return totals[key];
  }

  if (totals.comparison?.[key] !== undefined) {
    return totals.comparison[key];
  }

  return 0;
}

function parseDownloadFilename(response, fallback) {
  const disposition = response.headers.get('content-disposition') || '';
  const utfFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i);

  if (utfFilename?.[1]) {
    return decodeURIComponent(utfFilename[1].replace(/["']/g, ''));
  }

  const filename = disposition.match(/filename="?([^"]+)"?/i);
  return filename?.[1]?.trim() || fallback;
}

async function parseFailedDownload(response) {
  const contentType = response.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return (
        data.message ||
        data.error?.message ||
        data.error ||
        `Request failed with status ${response.status}.`
      );
    }

    const text = await response.text();
    return text || `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

export default function PayrollReports({ user = {} }) {
  const alerts = useCustomAlert();
  const superAdmin = isSuperAdmin(user);
  const canManage = hasAnyRole(user, MANAGEMENT_ROLES);
  const ownEmployeeReference = getCurrentEmployeeReference(user);

  const availableReportTypes = useMemo(
    () =>
      REPORT_TYPES.filter(
        (item) => canManage || !item.managementOnly,
      ),
    [canManage],
  );

  const [reportType, setReportType] = useState(
    canManage ? 'payroll_register' : 'employee_statement',
  );
  const [tenantId, setTenantId] = useState(
    safeText(user.tenant_id || user.tenant?.tenant_id || user.tenant?.code, ''),
  );
  const [filters, setFilters] = useState(emptyFilters());
  const [exportForm, setExportForm] = useState(emptyExportForm());

  const [employees, setEmployees] = useState([]);
  const [report, setReport] = useState(null);
  const [reportExports, setReportExports] = useState([]);

  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingExports, setLoadingExports] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [updatingExport, setUpdatingExport] = useState(false);

  const [showExportModal, setShowExportModal] = useState(false);
  const [showExportHistory, setShowExportHistory] = useState(false);
  const [selectedExport, setSelectedExport] = useState(null);
  const [showExportStatusModal, setShowExportStatusModal] = useState(false);
  const [exportStatusForm, setExportStatusForm] = useState(
    emptyExportStatusForm(),
  );
  const [exportStatusFilter, setExportStatusFilter] = useState('');

  const currentDefinition = reportDefinition(reportType);
  const reportRows = Array.isArray(report?.rows) ? report.rows : [];
  const columns = useMemo(
    () => tableColumns(reportType, reportRows),
    [reportRows, reportType],
  );

  const searchableRows = useMemo(() => {
    const search = normalizeKey(filters.search);

    if (!search) {
      return reportRows;
    }

    return reportRows.filter((row) =>
      Object.values(row || {})
        .map((value) => {
          if (Array.isArray(value)) {
            return value.join(' ');
          }

          if (value && typeof value === 'object') {
            return Object.values(value).join(' ');
          }

          return safeText(value, '');
        })
        .join(' ')
        .toLowerCase()
        .includes(search),
    );
  }, [filters.search, reportRows]);

  const chartRows = useMemo(() => {
    if (!['payroll_summary', 'payroll_trend'].includes(reportType)) {
      return [];
    }

    return reportRows.map((row) => ({
      label: safeText(row.period_key),
      value: toNumber(row.net_amount),
      secondary: toNumber(row.cost_to_company),
    }));
  }, [reportRows, reportType]);

  const chartMax = useMemo(() => {
    return Math.max(
      1,
      ...chartRows.flatMap((row) => [row.value, row.secondary]),
    );
  }, [chartRows]);

  function tenantParams() {
    if (!superAdmin || !tenantId.trim()) {
      return {};
    }

    return { tenant_id: tenantId.trim() };
  }

  function assertTenant() {
    if (superAdmin && !tenantId.trim()) {
      alerts.warning(
        'Enter the company tenant ID before generating payroll reports.',
        'Tenant Required',
      );
      return false;
    }

    return true;
  }

  function updateFilter(field, value) {
    setFilters((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateExportForm(field, value) {
    setExportForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function loadEmployees({ silent = false } = {}) {
    if (!canManage) {
      setEmployees([]);
      return [];
    }

    if (!assertTenant()) {
      setEmployees([]);
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
      const rows = sortEmployees(data.items || []);

      setEmployees(rows);
      return rows;
    } catch (error) {
      setEmployees([]);

      if (!silent) {
        alerts.error(
          error.message || 'Unable to load employees.',
          'Employee Load Failed',
        );
      }

      return [];
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadReportExports({ silent = false } = {}) {
    if (!canManage || !assertTenant()) {
      setReportExports([]);
      return [];
    }

    try {
      setLoadingExports(true);

      const data = await api(
        `/payroll/report-exports${buildQuery({
          ...tenantParams(),
          report_type: reportType,
          status: exportStatusFilter,
          limit: 300,
        })}`,
      );
      const rows = Array.isArray(data.items) ? data.items : [];

      setReportExports(rows);
      return rows;
    } catch (error) {
      setReportExports([]);

      if (!silent) {
        alerts.error(
          error.message || 'Unable to load payroll report exports.',
          'Export History Load Failed',
        );
      }

      return [];
    } finally {
      setLoadingExports(false);
    }
  }

  useEffect(() => {
    if (superAdmin && !tenantId.trim()) {
      setEmployees([]);
      setReport(null);
      setReportExports([]);
      return;
    }

    loadEmployees({ silent: true });

    if (canManage) {
      loadReportExports({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (!canManage || (superAdmin && !tenantId.trim())) {
      return;
    }

    loadReportExports({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType, exportStatusFilter]);

  useEffect(() => {
    if (
      !availableReportTypes.some((item) => item.key === reportType)
    ) {
      setReportType(availableReportTypes[0]?.key || 'employee_statement');
    }
  }, [availableReportTypes, reportType]);

  function validateReportFilters() {
    if (!assertTenant()) {
      return false;
    }

    if (reportType === 'period_variance') {
      if (!filters.base_period || !filters.comparison_period) {
        alerts.warning(
          'Select both the base period and comparison period.',
          'Variance Periods Required',
        );
        return false;
      }

      if (filters.base_period === filters.comparison_period) {
        alerts.warning(
          'Base period and comparison period must be different.',
          'Different Periods Required',
        );
        return false;
      }
    } else if (
      ['payroll_trend', 'employee_statement'].includes(reportType)
    ) {
      if (!filters.start_period || !filters.end_period) {
        alerts.warning(
          'Select both the start period and end period.',
          'Report Period Required',
        );
        return false;
      }
    } else if (!filters.period) {
      alerts.warning(
        'Select a payroll period.',
        'Payroll Period Required',
      );
      return false;
    }

    if (
      reportType === 'employee_statement' &&
      canManage &&
      !filters.employee_id
    ) {
      alerts.warning(
        'Select an employee.',
        'Employee Required',
      );
      return false;
    }

    return true;
  }

  function reportPayload() {
    const payload = {
      ...tenantParams(),
      report_type: reportType,
      official_only: canManage ? filters.official_only : true,
      statuses:
        canManage && !filters.official_only
          ? filters.statuses
          : [],
      department: filters.department,
      designation: filters.designation,
      location: filters.location,
      state_code: filters.state_code,
      search: filters.search.trim(),
    };

    if (reportType === 'period_variance') {
      payload.base_period = filters.base_period;
      payload.comparison_period = filters.comparison_period;
    } else if (
      ['payroll_trend', 'employee_statement'].includes(reportType)
    ) {
      payload.start_period = filters.start_period;
      payload.end_period = filters.end_period;
    } else {
      payload.period = filters.period;
    }

    if (reportType === 'employee_statement') {
      payload.employee_id = canManage
        ? filters.employee_id
        : ownEmployeeReference;
    } else if (filters.employee_id) {
      payload.employee_id = filters.employee_id;
    }

    return payload;
  }

  async function generateReport() {
    if (!validateReportFilters()) {
      return;
    }

    try {
      setLoadingReport(true);

      const data = await api('/payroll/reports/generate', {
        method: 'POST',
        body: JSON.stringify(reportPayload()),
      });

      const generatedReport = data.report || null;
      setReport(generatedReport);

      alerts.success(
        data.message || `${currentDefinition.label} generated successfully.`,
        'Payroll Report Generated',
      );
    } catch (error) {
      setReport(null);
      alerts.error(
        error.message || 'Unable to generate the payroll report.',
        'Report Generation Failed',
      );
    } finally {
      setLoadingReport(false);
    }
  }

  function openExport() {
    if (!reportRows.length) {
      alerts.warning(
        'Generate a report with at least one row before exporting it.',
        'Report Required',
      );
      return;
    }

    setExportForm(emptyExportForm());
    setShowExportModal(true);
  }

  function closeExportModal() {
    if (exporting) {
      return;
    }

    setShowExportModal(false);
    setExportForm(emptyExportForm());
  }

  async function downloadReportCsv(event) {
    event.preventDefault();

    if (!validateReportFilters()) {
      return;
    }

    const confirmed = await alerts.confirm(
      `Generate and download the ${currentDefinition.label} CSV? The backend will recalculate the report before export.`,
      'Export Payroll Report',
      {
        confirmText: 'Generate CSV',
        cancelText: 'Go Back',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setExporting(true);

      const token = getToken();
      const response = await fetch(getApiUrl('/payroll/reports/export'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...reportPayload(),
          delimiter: exportForm.delimiter,
          include_utf8_bom: exportForm.include_utf8_bom,
          filename_prefix: exportForm.filename_prefix.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(await parseFailedDownload(response));
      }

      const blob = await response.blob();
      const fallbackFilename = `${reportType}-${
        filters.period ||
        `${filters.start_period}-to-${filters.end_period}` ||
        'report'
      }.csv`;
      const filename = parseDownloadFilename(response, fallbackFilename);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      const rowCount =
        response.headers.get('x-payroll-report-row-count') ||
        reportRows.length;
      const totalAmount =
        response.headers.get('x-payroll-report-total-amount') ||
        totalValue(report, 'net_amount');

      alerts.success(
        `Downloaded ${rowCount} report row(s). Report value: ${formatCurrency(
          totalAmount,
        )}.`,
        'Payroll Report Downloaded',
      );

      closeExportModal();

      if (canManage) {
        await loadReportExports({ silent: true });
      }
    } catch (error) {
      alerts.error(
        error.message || 'Unable to export the payroll report.',
        'Report Export Failed',
      );
    } finally {
      setExporting(false);
    }
  }

  function openExportStatus(record) {
    setSelectedExport(record);
    setExportStatusForm({
      status:
        normalizeKey(record.status) === 'generated'
          ? 'downloaded'
          : normalizeKey(record.status) || 'downloaded',
      note: '',
    });
    setShowExportStatusModal(true);
  }

  function closeExportStatusModal() {
    if (updatingExport) {
      return;
    }

    setShowExportStatusModal(false);
    setSelectedExport(null);
    setExportStatusForm(emptyExportStatusForm());
  }

  async function updateExportStatus(event) {
    event.preventDefault();

    const id = recordId(selectedExport);

    if (!id || !assertTenant()) {
      return;
    }

    try {
      setUpdatingExport(true);

      const data = await api(
        `/payroll/report-exports/${encodeURIComponent(id)}/status`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            status: exportStatusForm.status,
            note: exportStatusForm.note.trim(),
          }),
        },
      );

      alerts.success(
        data.message || 'Payroll report export status updated.',
        'Export Status Updated',
      );

      closeExportStatusModal();
      await loadReportExports({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to update export status.',
        'Export Status Update Failed',
      );
    } finally {
      setUpdatingExport(false);
    }
  }

  function changeReportType(nextType) {
    setReportType(nextType);
    setReport(null);
  }

  const employeeStatementEmployee =
    reportType === 'employee_statement' ? report?.employee : null;

  return (
    <div className="payroll-reports-page">
      <style>{`
        .payroll-reports-page {
          display: grid;
          gap: 18px;
          min-width: 0;
          color: var(--text, #172033);
        }

        .payroll-reports-page * {
          box-sizing: border-box;
        }

        .payrep-hero {
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 22px;
          overflow: hidden;
          padding: 25px;
          border: 1px solid rgba(57, 89, 204, 0.18);
          border-radius: 22px;
          background:
            radial-gradient(circle at 90% 10%, rgba(66, 96, 212, 0.16), transparent 35%),
            linear-gradient(135deg, rgba(248, 250, 255, 0.99), rgba(255, 255, 255, 0.99));
          box-shadow: 0 16px 42px rgba(15, 23, 42, 0.07);
        }

        .payrep-hero::after {
          position: absolute;
          right: -48px;
          bottom: -75px;
          width: 210px;
          height: 210px;
          border-radius: 50%;
          background: rgba(57, 89, 204, 0.07);
          content: '';
        }

        .payrep-hero-content,
        .payrep-hero-actions {
          position: relative;
          z-index: 1;
        }

        .payrep-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 8px;
          color: #3959cc;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .payrep-hero h1 {
          margin: 0 0 8px;
          font-size: clamp(25px, 3vw, 36px);
          line-height: 1.1;
        }

        .payrep-hero p {
          max-width: 820px;
          margin: 0;
          color: var(--muted, #64748b);
          line-height: 1.65;
        }

        .payrep-hero-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }

        .payrep-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 40px;
          padding: 9px 14px;
          border: 1px solid transparent;
          border-radius: 11px;
          font: inherit;
          font-size: 13px;
          font-weight: 850;
          line-height: 1;
          cursor: pointer;
          transition:
            transform 0.15s ease,
            border-color 0.15s ease,
            background 0.15s ease,
            opacity 0.15s ease;
        }

        .payrep-btn:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .payrep-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .payrep-btn-primary {
          color: #fff;
          background: #3959cc;
          border-color: #3959cc;
        }

        .payrep-btn-success {
          color: #fff;
          background: #07875f;
          border-color: #07875f;
        }

        .payrep-btn-secondary {
          color: #27324a;
          background: #fff;
          border-color: var(--border, #dfe5ee);
        }

        .payrep-btn-danger {
          color: #fff;
          background: #c9364b;
          border-color: #c9364b;
        }

        .payrep-report-types {
          display: grid;
          grid-template-columns: repeat(4, minmax(180px, 1fr));
          gap: 12px;
        }

        .payrep-type-card {
          min-width: 0;
          padding: 15px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 15px;
          background: var(--card, #fff);
          cursor: pointer;
          text-align: left;
          transition:
            border-color 0.15s ease,
            box-shadow 0.15s ease,
            transform 0.15s ease;
        }

        .payrep-type-card:hover {
          border-color: rgba(57, 89, 204, 0.45);
          transform: translateY(-1px);
        }

        .payrep-type-card.is-active {
          border-color: #3959cc;
          background: rgba(57, 89, 204, 0.045);
          box-shadow: 0 0 0 3px rgba(57, 89, 204, 0.1);
        }

        .payrep-type-card svg {
          margin-bottom: 10px;
          color: #3959cc;
        }

        .payrep-type-card strong {
          display: block;
          margin-bottom: 5px;
          font-size: 14px;
        }

        .payrep-type-card span {
          display: block;
          color: var(--muted, #64748b);
          font-size: 11px;
          line-height: 1.45;
        }

        .payrep-panel {
          min-width: 0;
          padding: 20px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 18px;
          background: var(--card, #fff);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.055);
        }

        .payrep-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 16px;
        }

        .payrep-section-head h2,
        .payrep-section-head h3 {
          margin: 0 0 5px;
          font-size: 19px;
        }

        .payrep-section-head p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 13px;
          line-height: 1.5;
        }

        .payrep-filters {
          display: grid;
          grid-template-columns: repeat(4, minmax(155px, 1fr));
          gap: 12px;
        }

        .payrep-field {
          display: grid;
          gap: 7px;
          min-width: 0;
        }

        .payrep-field label {
          color: #465269;
          font-size: 12px;
          font-weight: 850;
        }

        .payrep-field input,
        .payrep-field select,
        .payrep-field textarea {
          width: 100%;
          min-width: 0;
          min-height: 42px;
          padding: 10px 12px;
          border: 1px solid var(--border, #d7dee9);
          border-radius: 11px;
          outline: none;
          background: var(--card, #fff);
          color: inherit;
          font: inherit;
          font-size: 14px;
        }

        .payrep-field textarea {
          min-height: 92px;
          resize: vertical;
          line-height: 1.5;
        }

        .payrep-field input:focus,
        .payrep-field select:focus,
        .payrep-field textarea:focus {
          border-color: #536bd7;
          box-shadow: 0 0 0 3px rgba(57, 89, 204, 0.11);
        }

        .payrep-field-full {
          grid-column: 1 / -1;
        }

        .payrep-checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 42px;
          color: #465269;
          font-size: 13px;
          font-weight: 750;
        }

        .payrep-checkbox input {
          width: 17px;
          height: 17px;
        }

        .payrep-filter-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 15px;
        }

        .payrep-metrics {
          display: grid;
          grid-template-columns: repeat(5, minmax(145px, 1fr));
          gap: 13px;
        }

        .payrep-metric {
          min-width: 0;
          padding: 17px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 16px;
          background: var(--card, #fff);
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
        }

        .payrep-metric-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
          color: var(--muted, #64748b);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .payrep-metric strong {
          display: block;
          overflow: hidden;
          font-size: clamp(21px, 2.3vw, 29px);
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .payrep-statement-employee {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 16px;
        }

        .payrep-statement-item {
          min-width: 0;
          padding: 12px;
          border-radius: 12px;
          background: rgba(148, 163, 184, 0.09);
        }

        .payrep-statement-item span {
          display: block;
          margin-bottom: 4px;
          color: var(--muted, #64748b);
          font-size: 10px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .payrep-statement-item strong {
          display: block;
          overflow: hidden;
          font-size: 13px;
          text-overflow: ellipsis;
        }

        .payrep-chart {
          display: grid;
          gap: 12px;
        }

        .payrep-chart-row {
          display: grid;
          grid-template-columns: 90px minmax(0, 1fr) 130px;
          gap: 12px;
          align-items: center;
        }

        .payrep-chart-label {
          color: #465269;
          font-size: 12px;
          font-weight: 850;
        }

        .payrep-chart-bars {
          display: grid;
          gap: 5px;
        }

        .payrep-chart-track {
          height: 9px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.17);
        }

        .payrep-chart-bar {
          height: 100%;
          border-radius: inherit;
          background: #3959cc;
        }

        .payrep-chart-bar.is-secondary {
          background: #07875f;
        }

        .payrep-chart-value {
          text-align: right;
          font-size: 11px;
          font-weight: 800;
        }

        .payrep-table-wrap {
          overflow-x: auto;
        }

        .payrep-table {
          width: 100%;
          min-width: 980px;
          border-collapse: collapse;
        }

        .payrep-table th,
        .payrep-table td {
          padding: 12px 11px;
          border-bottom: 1px solid #e7ebf1;
          text-align: left;
          vertical-align: top;
          font-size: 12px;
        }

        .payrep-table th {
          position: sticky;
          top: 0;
          z-index: 1;
          color: #58647a;
          background: #f8fafc;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .payrep-table td {
          max-width: 260px;
          line-height: 1.45;
        }

        .payrep-table td.is-money {
          font-weight: 800;
          white-space: nowrap;
        }

        .payrep-table td.is-identity strong {
          display: block;
          margin-bottom: 3px;
        }

        .payrep-table td.is-identity small {
          color: var(--muted, #64748b);
        }

        .payrep-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }

        .payrep-status-success {
          color: #047857;
          background: rgba(5, 150, 105, 0.1);
        }

        .payrep-status-warning {
          color: #9a5b00;
          background: rgba(245, 158, 11, 0.13);
        }

        .payrep-status-neutral {
          color: #475569;
          background: rgba(100, 116, 139, 0.12);
        }

        .payrep-empty {
          display: grid;
          place-items: center;
          min-height: 230px;
          padding: 30px;
          border: 1px dashed var(--border, #d7dee9);
          border-radius: 15px;
          color: var(--muted, #64748b);
          text-align: center;
        }

        .payrep-empty svg {
          margin-bottom: 10px;
          opacity: 0.6;
        }

        .payrep-export-table {
          width: 100%;
          min-width: 900px;
          border-collapse: collapse;
        }

        .payrep-export-table th,
        .payrep-export-table td {
          padding: 12px 11px;
          border-bottom: 1px solid #e7ebf1;
          text-align: left;
          vertical-align: top;
          font-size: 12px;
        }

        .payrep-export-table th {
          color: #58647a;
          background: rgba(148, 163, 184, 0.07);
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .payrep-export-table td strong {
          display: block;
          margin-bottom: 3px;
        }

        .payrep-export-table td small {
          color: var(--muted, #64748b);
        }

        .payrep-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 10020;
          display: grid;
          place-items: center;
          overflow: auto;
          padding: 22px;
          background: rgba(15, 23, 42, 0.58);
          backdrop-filter: blur(5px);
        }

        .payrep-modal {
          width: min(720px, 100%);
          max-height: calc(100vh - 44px);
          overflow: auto;
          border: 1px solid rgba(255, 255, 255, 0.35);
          border-radius: 20px;
          background: #fff;
          box-shadow: 0 30px 90px rgba(15, 23, 42, 0.3);
        }

        .payrep-modal-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 20px 22px 14px;
          border-bottom: 1px solid #e4e8ef;
        }

        .payrep-modal-head h2 {
          margin: 0 0 4px;
          font-size: 21px;
        }

        .payrep-modal-head p {
          margin: 0;
          color: #64748b;
          font-size: 13px;
        }

        .payrep-modal-close {
          width: 38px;
          height: 38px;
          border: 1px solid #dfe5ee;
          border-radius: 10px;
          background: #fff;
          color: #334155;
          cursor: pointer;
        }

        .payrep-modal-body {
          display: grid;
          gap: 15px;
          padding: 20px 22px;
        }

        .payrep-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
        }

        .payrep-modal-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 22px 20px;
          border-top: 1px solid #e4e8ef;
        }

        .spin {
          animation: payrep-spin 0.9s linear infinite;
        }

        @keyframes payrep-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1220px) {
          .payrep-report-types {
            grid-template-columns: repeat(3, minmax(180px, 1fr));
          }

          .payrep-filters {
            grid-template-columns: repeat(3, minmax(155px, 1fr));
          }

          .payrep-metrics {
            grid-template-columns: repeat(3, minmax(145px, 1fr));
          }
        }

        @media (max-width: 860px) {
          .payrep-report-types,
          .payrep-filters,
          .payrep-statement-employee {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .payrep-hero {
            flex-direction: column;
            padding: 20px;
          }

          .payrep-hero-actions {
            width: 100%;
            justify-content: stretch;
          }

          .payrep-hero-actions .payrep-btn {
            flex: 1;
          }

          .payrep-report-types,
          .payrep-filters,
          .payrep-metrics,
          .payrep-statement-employee,
          .payrep-form-grid {
            grid-template-columns: 1fr;
          }

          .payrep-chart-row {
            grid-template-columns: 70px minmax(0, 1fr);
          }

          .payrep-chart-value {
            grid-column: 2;
            text-align: left;
          }

          .payrep-modal-backdrop {
            align-items: end;
            padding: 0;
          }

          .payrep-modal {
            max-height: 94vh;
            border-radius: 20px 20px 0 0;
          }

          .payrep-modal-head,
          .payrep-modal-body,
          .payrep-modal-actions {
            padding-left: 16px;
            padding-right: 16px;
          }
        }
      `}</style>

      <header className="payrep-hero">
        <div className="payrep-hero-content">
          <span className="payrep-kicker">
            <BarChart3 size={15} />
            Payroll Analytics
          </span>
          <h1>Payroll Reports</h1>
          <p>
            Generate payroll registers, statutory summaries, employee statements,
            period variance and payroll trends using locked and disbursed payroll
            by default.
          </p>
        </div>

        <div className="payrep-hero-actions">
          <button
            type="button"
            className="payrep-btn payrep-btn-secondary"
            onClick={() => {
              loadEmployees();
              if (canManage) {
                loadReportExports();
              }
            }}
            disabled={loadingEmployees || loadingExports}
          >
            {loadingEmployees || loadingExports ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <RefreshCw size={17} />
            )}
            Refresh
          </button>

          {canManage ? (
            <button
              type="button"
              className="payrep-btn payrep-btn-secondary"
              onClick={() => setShowExportHistory((current) => !current)}
            >
              <History size={17} />
              Export History
            </button>
          ) : null}

          <button
            type="button"
            className="payrep-btn payrep-btn-primary"
            onClick={openExport}
            disabled={!reportRows.length}
          >
            <Download size={17} />
            Export CSV
          </button>
        </div>
      </header>

      <section className="payrep-report-types">
        {availableReportTypes.map((definition) => {
          const Icon = definition.icon;

          return (
            <button
              type="button"
              className={`payrep-type-card ${
                reportType === definition.key ? 'is-active' : ''
              }`}
              key={definition.key}
              onClick={() => changeReportType(definition.key)}
            >
              <Icon size={20} />
              <strong>{definition.label}</strong>
              <span>{definition.description}</span>
            </button>
          );
        })}
      </section>

      <section className="payrep-panel">
        <div className="payrep-section-head">
          <div>
            <h2>{currentDefinition.label} Filters</h2>
            <p>{currentDefinition.description}</p>
          </div>

          {loadingEmployees ? (
            <Loader2 size={20} className="spin" />
          ) : null}
        </div>

        <div className="payrep-filters">
          {reportType === 'period_variance' ? (
            <>
              <div className="payrep-field">
                <label htmlFor="payrep-base-period">Base period *</label>
                <input
                  id="payrep-base-period"
                  type="month"
                  value={filters.base_period}
                  onChange={(event) =>
                    updateFilter('base_period', event.target.value)
                  }
                />
              </div>

              <div className="payrep-field">
                <label htmlFor="payrep-comparison-period">
                  Comparison period *
                </label>
                <input
                  id="payrep-comparison-period"
                  type="month"
                  value={filters.comparison_period}
                  onChange={(event) =>
                    updateFilter('comparison_period', event.target.value)
                  }
                />
              </div>
            </>
          ) : ['payroll_trend', 'employee_statement'].includes(reportType) ? (
            <>
              <div className="payrep-field">
                <label htmlFor="payrep-start-period">Start period *</label>
                <input
                  id="payrep-start-period"
                  type="month"
                  value={filters.start_period}
                  onChange={(event) =>
                    updateFilter('start_period', event.target.value)
                  }
                />
              </div>

              <div className="payrep-field">
                <label htmlFor="payrep-end-period">End period *</label>
                <input
                  id="payrep-end-period"
                  type="month"
                  value={filters.end_period}
                  onChange={(event) =>
                    updateFilter('end_period', event.target.value)
                  }
                />
              </div>
            </>
          ) : (
            <div className="payrep-field">
              <label htmlFor="payrep-period">Payroll period *</label>
              <input
                id="payrep-period"
                type="month"
                value={filters.period}
                onChange={(event) =>
                  updateFilter('period', event.target.value)
                }
              />
            </div>
          )}

          {reportType === 'employee_statement' && canManage ? (
            <div className="payrep-field">
              <label htmlFor="payrep-employee">Employee *</label>
              <select
                id="payrep-employee"
                value={filters.employee_id}
                onChange={(event) =>
                  updateFilter('employee_id', event.target.value)
                }
                disabled={loadingEmployees}
              >
                <option value="">Select employee</option>
                {employees.map((employee) => (
                  <option
                    key={employeeId(employee)}
                    value={employeeId(employee)}
                  >
                    {employeeName(employee)} ({employeeCode(employee)})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {canManage &&
          !['employee_statement', 'payroll_trend'].includes(reportType) ? (
            <div className="payrep-field">
              <label htmlFor="payrep-employee-filter">
                Employee
              </label>
              <select
                id="payrep-employee-filter"
                value={filters.employee_id}
                onChange={(event) =>
                  updateFilter('employee_id', event.target.value)
                }
                disabled={loadingEmployees}
              >
                <option value="">All employees</option>
                {employees.map((employee) => (
                  <option
                    key={employeeId(employee)}
                    value={employeeId(employee)}
                  >
                    {employeeName(employee)} ({employeeCode(employee)})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {canManage &&
          reportType !== 'employee_statement' ? (
            <>
              <div className="payrep-field">
                <label htmlFor="payrep-department">Department</label>
                <input
                  id="payrep-department"
                  type="text"
                  value={filters.department}
                  onChange={(event) =>
                    updateFilter('department', event.target.value)
                  }
                  placeholder="Exact department name"
                />
              </div>

              {reportType !== 'payroll_trend' ? (
                <div className="payrep-field">
                  <label htmlFor="payrep-designation">Designation</label>
                  <input
                    id="payrep-designation"
                    type="text"
                    value={filters.designation}
                    onChange={(event) =>
                      updateFilter('designation', event.target.value)
                    }
                    placeholder="Exact designation"
                  />
                </div>
              ) : null}

              <div className="payrep-field">
                <label htmlFor="payrep-location">Location</label>
                <input
                  id="payrep-location"
                  type="text"
                  value={filters.location}
                  onChange={(event) =>
                    updateFilter('location', event.target.value)
                  }
                  placeholder="Exact location"
                />
              </div>

              {reportType !== 'payroll_trend' ? (
                <div className="payrep-field">
                  <label htmlFor="payrep-state">State code</label>
                  <input
                    id="payrep-state"
                    type="text"
                    value={filters.state_code}
                    onChange={(event) =>
                      updateFilter(
                        'state_code',
                        event.target.value.toUpperCase(),
                      )
                    }
                    placeholder="Example: AS"
                    maxLength={8}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {canManage && !filters.official_only ? (
            <div className="payrep-field">
              <label htmlFor="payrep-statuses">Payroll statuses</label>
              <select
                id="payrep-statuses"
                multiple
                value={filters.statuses}
                onChange={(event) =>
                  updateFilter(
                    'statuses',
                    Array.from(
                      event.target.selectedOptions,
                      (option) => option.value,
                    ),
                  )
                }
              >
                <option value="draft">Draft</option>
                <option value="pending_hr_review">Pending HR Review</option>
                <option value="pending_finance_approval">
                  Pending Finance Approval
                </option>
                <option value="finance_approved">Finance Approved</option>
                <option value="locked">Locked</option>
                <option value="disbursed">Disbursed</option>
              </select>
            </div>
          ) : null}

          {canManage ? (
            <label className="payrep-checkbox">
              <input
                type="checkbox"
                checked={filters.official_only}
                onChange={(event) =>
                  updateFilter('official_only', event.target.checked)
                }
              />
              Use only locked and disbursed payroll
            </label>
          ) : null}

          {superAdmin ? (
            <div className="payrep-field">
              <label htmlFor="payrep-tenant-id">
                Company tenant ID
              </label>
              <input
                id="payrep-tenant-id"
                type="text"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder="Example: sds"
              />
            </div>
          ) : null}
        </div>

        <div className="payrep-filter-actions">
          <button
            type="button"
            className="payrep-btn payrep-btn-secondary"
            onClick={() => {
              setFilters(emptyFilters());
              setReport(null);
            }}
          >
            <RefreshCw size={15} />
            Reset Filters
          </button>

          <button
            type="button"
            className="payrep-btn payrep-btn-primary"
            onClick={generateReport}
            disabled={loadingReport}
          >
            {loadingReport ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <FileText size={16} />
            )}
            Generate Report
          </button>
        </div>
      </section>

      {report ? (
        <>
          <section className="payrep-metrics">
            <article className="payrep-metric">
              <div className="payrep-metric-head">
                <span>Employees</span>
                <UsersRound size={17} />
              </div>
              <strong>
                {formatNumber(
                  totalValue(report, 'employee_count') ||
                    reportRows.length,
                )}
              </strong>
            </article>

            <article className="payrep-metric">
              <div className="payrep-metric-head">
                <span>Gross salary</span>
                <IndianRupee size={17} />
              </div>
              <strong>
                {formatCurrency(totalValue(report, 'gross_salary'))}
              </strong>
            </article>

            <article className="payrep-metric">
              <div className="payrep-metric-head">
                <span>Total deductions</span>
                <ShieldCheck size={17} />
              </div>
              <strong>
                {formatCurrency(totalValue(report, 'total_deductions'))}
              </strong>
            </article>

            <article className="payrep-metric">
              <div className="payrep-metric-head">
                <span>Net pay</span>
                <WalletCards size={17} />
              </div>
              <strong>
                {formatCurrency(totalValue(report, 'net_amount'))}
              </strong>
            </article>

            <article className="payrep-metric">
              <div className="payrep-metric-head">
                <span>Payroll cost</span>
                <Landmark size={17} />
              </div>
              <strong>
                {formatCurrency(totalValue(report, 'cost_to_company'))}
              </strong>
            </article>
          </section>

          {employeeStatementEmployee ? (
            <section className="payrep-panel">
              <div className="payrep-section-head">
                <div>
                  <h2>Employee Statement</h2>
                  <p>Employee identity and payroll statement period.</p>
                </div>
              </div>

              <div className="payrep-statement-employee">
                <article className="payrep-statement-item">
                  <span>Employee</span>
                  <strong>
                    {safeText(employeeStatementEmployee.employee_name)}
                  </strong>
                </article>
                <article className="payrep-statement-item">
                  <span>Employee code</span>
                  <strong>
                    {safeText(employeeStatementEmployee.employee_code)}
                  </strong>
                </article>
                <article className="payrep-statement-item">
                  <span>Department</span>
                  <strong>
                    {safeText(employeeStatementEmployee.department)}
                  </strong>
                </article>
                <article className="payrep-statement-item">
                  <span>Designation</span>
                  <strong>
                    {safeText(employeeStatementEmployee.designation)}
                  </strong>
                </article>
              </div>
            </section>
          ) : null}

          {chartRows.length ? (
            <section className="payrep-panel">
              <div className="payrep-section-head">
                <div>
                  <h2>Payroll Trend Visual</h2>
                  <p>Net pay and payroll cost by payroll period.</p>
                </div>
              </div>

              <div className="payrep-chart">
                {chartRows.map((row) => (
                  <div className="payrep-chart-row" key={row.label}>
                    <div className="payrep-chart-label">{row.label}</div>
                    <div className="payrep-chart-bars">
                      <div className="payrep-chart-track">
                        <div
                          className="payrep-chart-bar"
                          style={{
                            width: `${Math.max(
                              1,
                              (row.value / chartMax) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                      <div className="payrep-chart-track">
                        <div
                          className="payrep-chart-bar is-secondary"
                          style={{
                            width: `${Math.max(
                              1,
                              (row.secondary / chartMax) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="payrep-chart-value">
                      Net: {formatCurrency(row.value)}
                      <br />
                      Cost: {formatCurrency(row.secondary)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="payrep-panel">
            <div className="payrep-section-head">
              <div>
                <h2>{currentDefinition.label}</h2>
                <p>
                  {searchableRows.length} report row
                  {searchableRows.length === 1 ? '' : 's'}
                </p>
              </div>

              <div className="payrep-field" style={{ minWidth: 230 }}>
                <label htmlFor="payrep-table-search">Search report rows</label>
                <div style={{ position: 'relative' }}>
                  <Search
                    size={16}
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#8a96aa',
                    }}
                  />
                  <input
                    id="payrep-table-search"
                    type="search"
                    value={filters.search}
                    onChange={(event) =>
                      updateFilter('search', event.target.value)
                    }
                    placeholder="Search current rows"
                    style={{ paddingLeft: 38 }}
                  />
                </div>
              </div>
            </div>

            {searchableRows.length ? (
              <div className="payrep-table-wrap">
                <table className="payrep-table">
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column}>{labelFromKey(column)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {searchableRows.map((row, rowIndex) => (
                      <tr
                        key={
                          safeText(
                            row.payslip_id ||
                              row.employee_id ||
                              row.period_key,
                            rowIndex,
                          )
                        }
                      >
                        {columns.map((column) => (
                          <td
                            key={column}
                            className={
                              MONEY_KEYS.has(column)
                                ? 'is-money'
                                : column === 'employee_name'
                                  ? 'is-identity'
                                  : ''
                            }
                          >
                            {column === 'employee_name' ? (
                              <>
                                <strong>
                                  {formatCell(column, row[column])}
                                </strong>
                                {row.employee_code ? (
                                  <small>{row.employee_code}</small>
                                ) : null}
                              </>
                            ) : column === 'status' ||
                              column === 'employee_status' ? (
                              <span
                                className={`payrep-status payrep-status-${
                                  normalizeKey(row[column]) === 'removed'
                                    ? 'neutral'
                                    : normalizeKey(row[column]) === 'added'
                                      ? 'success'
                                      : 'warning'
                                }`}
                              >
                                {formatCell(column, row[column])}
                              </span>
                            ) : (
                              formatCell(column, row[column])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="payrep-empty">
                <div>
                  <FileSpreadsheet size={34} />
                  <strong>No report rows found</strong>
                  <p>
                    Change the filters or generate the report for another period.
                  </p>
                </div>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="payrep-panel">
          <div className="payrep-empty">
            <div>
              <BarChart3 size={36} />
              <strong>No payroll report generated</strong>
              <p>
                Select the report type and filters, then generate the report.
              </p>
            </div>
          </div>
        </section>
      )}

      {showExportHistory && canManage ? (
        <section className="payrep-panel">
          <div className="payrep-section-head">
            <div>
              <h2>Payroll Report Export History</h2>
              <p>
                CSV exports are stored with filters, totals and SHA-256 integrity
                hashes.
              </p>
            </div>

            <div className="payrep-field" style={{ minWidth: 200 }}>
              <label htmlFor="payrep-export-status-filter">
                Export status
              </label>
              <select
                id="payrep-export-status-filter"
                value={exportStatusFilter}
                onChange={(event) =>
                  setExportStatusFilter(event.target.value)
                }
              >
                {EXPORT_STATUSES.map(([value, label]) => (
                  <option key={value || 'all'} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loadingExports ? (
            <div className="payrep-empty" style={{ minHeight: 150 }}>
              <div>
                <Loader2 size={30} className="spin" />
                <strong>Loading export history…</strong>
              </div>
            </div>
          ) : reportExports.length ? (
            <div className="payrep-table-wrap">
              <table className="payrep-export-table">
                <thead>
                  <tr>
                    <th>Report</th>
                    <th>Periods</th>
                    <th>Rows</th>
                    <th>Total amount</th>
                    <th>SHA-256</th>
                    <th>Status</th>
                    <th>Generated</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reportExports.map((record) => (
                    <tr key={recordId(record)}>
                      <td>
                        <strong>{labelFromKey(record.report_type)}</strong>
                        <small>{safeText(record.filename)}</small>
                      </td>
                      <td>
                        {(record.periods || []).length
                          ? record.periods.join(', ')
                          : '—'}
                      </td>
                      <td>{formatNumber(record.row_count)}</td>
                      <td>{formatCurrency(record.total_amount)}</td>
                      <td>
                        <strong>
                          {safeText(record.sha256, '').slice(0, 16)}
                          {record.sha256 ? '…' : '—'}
                        </strong>
                      </td>
                      <td>
                        <span
                          className={`payrep-status payrep-status-${statusTone(
                            record.status,
                          )}`}
                        >
                          {labelFromKey(record.status)}
                        </span>
                      </td>
                      <td>{formatDate(record.created_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="payrep-btn payrep-btn-secondary"
                          onClick={() => openExportStatus(record)}
                        >
                          <Eye size={14} />
                          Update Status
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="payrep-empty" style={{ minHeight: 160 }}>
              <div>
                <History size={32} />
                <strong>No report exports found</strong>
                <p>Generate a CSV export or change the export-status filter.</p>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {showExportModal ? (
        <div className="payrep-modal-backdrop" role="presentation">
          <div
            className="payrep-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payrep-export-title"
          >
            <div className="payrep-modal-head">
              <div>
                <h2 id="payrep-export-title">Export Payroll Report</h2>
                <p>{currentDefinition.label}</p>
              </div>

              <button
                type="button"
                className="payrep-modal-close"
                onClick={closeExportModal}
                aria-label="Close"
                disabled={exporting}
              >
                ×
              </button>
            </div>

            <form onSubmit={downloadReportCsv}>
              <div className="payrep-modal-body">
                <div className="payrep-form-grid">
                  <div className="payrep-field payrep-field-full">
                    <label htmlFor="payrep-filename-prefix">
                      Filename prefix
                    </label>
                    <input
                      id="payrep-filename-prefix"
                      type="text"
                      value={exportForm.filename_prefix}
                      onChange={(event) =>
                        updateExportForm(
                          'filename_prefix',
                          event.target.value,
                        )
                      }
                      placeholder={reportType.replaceAll('_', '-')}
                    />
                  </div>

                  <div className="payrep-field">
                    <label htmlFor="payrep-delimiter">CSV delimiter</label>
                    <select
                      id="payrep-delimiter"
                      value={exportForm.delimiter}
                      onChange={(event) =>
                        updateExportForm('delimiter', event.target.value)
                      }
                    >
                      <option value=",">Comma (,)</option>
                      <option value=";">Semicolon (;)</option>
                      <option value="|">Pipe (|)</option>
                      <option value={'\t'}>Tab</option>
                    </select>
                  </div>

                  <label className="payrep-checkbox">
                    <input
                      type="checkbox"
                      checked={exportForm.include_utf8_bom}
                      onChange={(event) =>
                        updateExportForm(
                          'include_utf8_bom',
                          event.target.checked,
                        )
                      }
                    />
                    Add UTF-8 BOM for Excel
                  </label>
                </div>
              </div>

              <div className="payrep-modal-actions">
                <button
                  type="button"
                  className="payrep-btn payrep-btn-secondary"
                  onClick={closeExportModal}
                  disabled={exporting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="payrep-btn payrep-btn-primary"
                  disabled={exporting}
                >
                  {exporting ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  Generate and Download
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showExportStatusModal && selectedExport ? (
        <div className="payrep-modal-backdrop" role="presentation">
          <div
            className="payrep-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payrep-export-status-title"
          >
            <div className="payrep-modal-head">
              <div>
                <h2 id="payrep-export-status-title">
                  Update Report Export Status
                </h2>
                <p>{safeText(selectedExport.filename)}</p>
              </div>

              <button
                type="button"
                className="payrep-modal-close"
                onClick={closeExportStatusModal}
                aria-label="Close"
                disabled={updatingExport}
              >
                ×
              </button>
            </div>

            <form onSubmit={updateExportStatus}>
              <div className="payrep-modal-body">
                <div className="payrep-field">
                  <label htmlFor="payrep-export-status">Status *</label>
                  <select
                    id="payrep-export-status"
                    value={exportStatusForm.status}
                    onChange={(event) =>
                      setExportStatusForm((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                    required
                  >
                    <option value="generated">Generated</option>
                    <option value="downloaded">Downloaded</option>
                    <option value="shared">Shared</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <div className="payrep-field">
                  <label htmlFor="payrep-export-note">Audit note</label>
                  <textarea
                    id="payrep-export-note"
                    value={exportStatusForm.note}
                    onChange={(event) =>
                      setExportStatusForm((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    placeholder="Optional note for this export status."
                  />
                </div>
              </div>

              <div className="payrep-modal-actions">
                <button
                  type="button"
                  className="payrep-btn payrep-btn-secondary"
                  onClick={closeExportStatusModal}
                  disabled={updatingExport}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="payrep-btn payrep-btn-primary"
                  disabled={updatingExport}
                >
                  {updatingExport ? (
                    <Loader2 size={16} className="spin" />
                  ) : exportStatusForm.status === 'archived' ? (
                    <Archive size={16} />
                  ) : exportStatusForm.status === 'shared' ? (
                    <Share2 size={16} />
                  ) : exportStatusForm.status === 'downloaded' ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <XCircle size={16} />
                  )}
                  Update Status
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}