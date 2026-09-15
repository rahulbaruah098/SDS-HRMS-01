import { useEffect, useMemo, useRef, useState } from 'react';
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
const PAYREP_NOTICE_HIDE_MS = 4200;

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

const PAYROLL_STATUS_OPTIONS = [
  ['draft', 'Draft'],
  ['hr_reviewed', 'HR Reviewed'],
  ['finance_approved', 'Finance Approved'],
  ['locked', 'Locked'],
  ['disbursed', 'Disbursed'],
];

const PAYROLL_STATUS_ALIASES = {
  pending_hr_review: 'draft',
  pending_finance_approval: 'hr_reviewed',
  finance_approval_pending: 'hr_reviewed',
  reviewed: 'hr_reviewed',
  approved: 'finance_approved',
};

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

function normalizePayrollStatus(value) {
  const normalized = normalizeKey(value);
  return PAYROLL_STATUS_ALIASES[normalized] || normalized;
}

function payrollStatusLabel(value) {
  const normalized = normalizePayrollStatus(value);
  const configured = PAYROLL_STATUS_OPTIONS.find(
    ([status]) => status === normalized,
  );
  return configured?.[1] || labelFromKey(normalized);
}

function payrollStatusTone(value) {
  const normalized = normalizePayrollStatus(value);

  if (normalized === 'disbursed') {
    return 'success';
  }

  if (normalized === 'locked' || normalized === 'finance_approved') {
    return 'neutral';
  }

  return 'warning';
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

  if (key === 'status') {
    return payrollStatusLabel(value);
  }

  if (key === 'employee_status' || key === 'state_code') {
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


function PayrollReportFeedback({ feedback, onClose, className = '' }) {
  if (!feedback?.message) {
    return null;
  }

  const type = ['success', 'warning', 'error', 'info'].includes(feedback.type)
    ? feedback.type
    : 'info';

  const Icon =
    type === 'success'
      ? CheckCircle2
      : type === 'error' || type === 'warning'
        ? XCircle
        : ShieldCheck;

  return (
    <div
      className={`payrep-feedback ${type} ${className}`.trim()}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      <span className="payrep-feedback-icon" aria-hidden="true">
        {feedback.loading ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}
      </span>

      <span className="payrep-feedback-copy">
        {feedback.title ? <strong>{feedback.title}</strong> : null}
        <span>{feedback.message}</span>
      </span>

      <button
        type="button"
        className="payrep-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
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

  const [inlineFeedback, setInlineFeedback] = useState({});
  const feedbackTimersRef = useRef({});

  function clearPayrepFeedback(scopeKey) {
    if (!scopeKey) {
      return;
    }

    const timer = feedbackTimersRef.current[scopeKey];
    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setInlineFeedback((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scopeKey)) {
        return current;
      }

      const next = { ...current };
      delete next[scopeKey];
      return next;
    });
  }

  function showPayrepFeedback(
    scopeKey,
    type,
    message,
    title = '',
    options = {},
  ) {
    if (!scopeKey) {
      return;
    }

    const timer = feedbackTimersRef.current[scopeKey];
    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setInlineFeedback((current) => ({
      ...current,
      [scopeKey]: {
        type,
        message,
        title,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      feedbackTimersRef.current[scopeKey] = window.setTimeout(() => {
        setInlineFeedback((current) => {
          const next = { ...current };
          delete next[scopeKey];
          return next;
        });
        delete feedbackTimersRef.current[scopeKey];
      }, PAYREP_NOTICE_HIDE_MS);
    }
  }

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
      showPayrepFeedback(
        'page',
        'warning',
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
        showPayrepFeedback(
          'page',
          'error',
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
        showPayrepFeedback(
          'page',
          'error',
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

  useEffect(() => {
    return () => {
      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      feedbackTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!showExportModal && !showExportStatusModal) {
      return undefined;
    }

    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscroll = root.style.overscrollBehavior;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth,
    );

    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
      body.style.overscrollBehavior = previousBodyOverscroll;
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [showExportModal, showExportStatusModal]);

  function validateReportFilters() {
    if (!assertTenant()) {
      return false;
    }

    if (reportType === 'period_variance') {
      if (!filters.base_period || !filters.comparison_period) {
        showPayrepFeedback(
          'filters',
          'warning',
          'Select both the base period and comparison period.',
          'Variance Periods Required',
        );
        return false;
      }

      if (filters.base_period === filters.comparison_period) {
        showPayrepFeedback(
          'filters',
          'warning',
          'Base period and comparison period must be different.',
          'Different Periods Required',
        );
        return false;
      }
    } else if (
      ['payroll_trend', 'employee_statement'].includes(reportType)
    ) {
      if (!filters.start_period || !filters.end_period) {
        showPayrepFeedback(
          'filters',
          'warning',
          'Select both the start period and end period.',
          'Report Period Required',
        );
        return false;
      }
    } else if (!filters.period) {
      showPayrepFeedback(
        'filters',
        'warning',
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
      showPayrepFeedback(
        'filters',
        'warning',
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
          ? [...new Set(filters.statuses.map(normalizePayrollStatus))]
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
      showPayrepFeedback(
        'filters',
        'info',
        `Generating ${currentDefinition.label} with the selected filters...`,
        'Generating Report',
        { loading: true },
      );
      setLoadingReport(true);

      const data = await api('/payroll/reports/generate', {
        method: 'POST',
        body: JSON.stringify(reportPayload()),
      });

      const generatedReport = data.report || null;
      setReport(generatedReport);

      showPayrepFeedback(
        'filters',
        'success',
        data.message || `${currentDefinition.label} generated successfully.`,
        'Payroll Report Generated',
      );
    } catch (error) {
      setReport(null);
      showPayrepFeedback(
        'filters',
        'error',
        error.message || 'Unable to generate the payroll report.',
        'Report Generation Failed',
      );
    } finally {
      setLoadingReport(false);
    }
  }

  function openExport() {
    if (!reportRows.length) {
      showPayrepFeedback(
        'filters',
        'warning',
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
    clearPayrepFeedback('export-modal');
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
      showPayrepFeedback(
        'export-modal',
        'info',
        `Generating and preparing the ${currentDefinition.label} CSV download...`,
        'Preparing CSV',
        { loading: true },
      );
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

      closeExportModal();

      showPayrepFeedback(
        'page',
        'success',
        `Downloaded ${rowCount} report row(s). Report value: ${formatCurrency(
          totalAmount,
        )}.`,
        'Payroll Report Downloaded',
      );

      if (canManage) {
        await loadReportExports({ silent: true });
      }
    } catch (error) {
      showPayrepFeedback(
        'export-modal',
        'error',
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
    clearPayrepFeedback('export-status-modal');
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
      showPayrepFeedback(
        'export-status-modal',
        'info',
        'Updating this export record and audit status...',
        'Updating Export Status',
        { loading: true },
      );
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

      closeExportStatusModal();
      await loadReportExports({ silent: true });

      showPayrepFeedback(
        'history',
        'success',
        data.message || 'Payroll report export status updated.',
        'Export Status Updated',
      );
    } catch (error) {
      showPayrepFeedback(
        'export-status-modal',
        'error',
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
          --payrep-ink: #111a38;
          --payrep-copy: #60708f;
          --payrep-muted: #7c88a2;
          --payrep-border: rgba(171, 181, 211, .68);
          --payrep-blue: #4d77dd;
          --payrep-cyan: #2eb2b9;
          --payrep-violet: #575092;
          --payrep-lavender: #d9d4ff;
          --payrep-panel: #ffffff;
          --payrep-soft-blue: #eef7ff;
          --payrep-soft-violet: #f4f1ff;
          --payrep-soft-mint: #effbf7;
          --payrep-soft-amber: #fff8e7;
          --payrep-soft-rose: #fff1f4;
          display: grid;
          gap: 22px;
          width: min(1280px, calc(100% - 48px));
          max-width: 1280px;
          min-width: 0;
          margin: 0 auto;
          padding: 24px 0 38px;
          color: var(--payrep-ink);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
            "Segoe UI", sans-serif;
        }

        .payroll-reports-page *,
        .payroll-reports-page *::before,
        .payroll-reports-page *::after {
          box-sizing: border-box;
        }

        .payrep-hero {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 24px;
          overflow: hidden;
          padding: clamp(26px, 3.2vw, 42px);
          border: 1px solid rgba(171, 181, 211, .72);
          border-radius: 28px;
          background:
            linear-gradient(
              90deg,
              #d8f7ff 0%,
              #eefcff 27%,
              #ffffff 52%,
              #f7f2ff 73%,
              #e9e3ff 100%
            );
          box-shadow:
            10px 12px 0 #afd3ff,
            0 28px 58px rgba(32, 42, 99, .10);
        }

        .payrep-hero-content,
        .payrep-hero-actions {
          position: relative;
          z-index: 1;
          min-width: 0;
        }

        .payrep-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          padding: 8px 13px;
          border-radius: 999px;
          color: #443691;
          background: rgba(238, 234, 255, .9);
          box-shadow: 3px 4px 0 #d4ceff;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .payrep-hero h1 {
          margin: 0 0 10px;
          color: var(--payrep-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(34px, 4.6vw, 62px);
          font-weight: 700;
          line-height: .98;
          letter-spacing: -.035em;
        }

        .payrep-hero p {
          max-width: 850px;
          margin: 0;
          color: var(--payrep-copy);
          font-size: clamp(13px, 1.25vw, 16px);
          line-height: 1.7;
        }

        .payrep-hero-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 11px;
        }

        .payrep-hero-feedback {
          grid-column: 1 / -1;
          margin-top: 2px;
        }

        .payrep-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 46px;
          padding: 10px 16px;
          border: 1px solid transparent;
          border-radius: 15px;
          font: inherit;
          font-size: 11px;
          font-weight: 950;
          line-height: 1;
          white-space: nowrap;
          cursor: pointer;
          transition:
            transform .16s ease,
            box-shadow .16s ease,
            opacity .16s ease,
            border-color .16s ease;
        }

        .payrep-btn:disabled {
          cursor: not-allowed;
          opacity: .52;
          transform: none;
        }

        .payrep-btn-primary {
          color: #fff;
          border-color: rgba(77, 119, 221, .20);
          background: linear-gradient(135deg, var(--payrep-blue) 0%, var(--payrep-cyan) 100%);
          box-shadow:
            4px 5px 0 var(--payrep-violet),
            0 12px 22px rgba(67, 116, 170, .13);
        }

        .payrep-btn-success {
          color: #087257;
          border-color: rgba(12, 155, 114, .22);
          background: #e9fbf5;
          box-shadow: 4px 5px 0 #a9ead9;
        }

        .payrep-btn-secondary {
          color: #40348d;
          border-color: rgba(102, 88, 220, .20);
          background: #fff;
          box-shadow:
            4px 5px 0 #d7d2ff,
            0 10px 20px rgba(52, 43, 120, .06);
        }

        .payrep-btn-danger {
          color: #a33249;
          border-color: rgba(211, 78, 103, .20);
          background: #fff2f5;
          box-shadow: 4px 5px 0 #f2c5cf;
        }

        @media (hover: hover) and (pointer: fine) {
          .payrep-btn:hover:not(:disabled),
          .payrep-type-card:hover {
            transform: translateY(-2px);
          }
        }

        .payrep-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: start;
          gap: 10px;
          width: 100%;
          padding: 12px 13px;
          border: 1px solid transparent;
          border-radius: 15px;
          font-size: 11px;
          line-height: 1.45;
          animation: payrep-feedback-in .2s ease-out;
        }

        .payrep-feedback.info {
          color: #3c3b87;
          border-color: #cbc7ff;
          background: #f3f2ff;
          box-shadow: 3px 4px 0 #dedaff;
        }

        .payrep-feedback.success {
          color: #087257;
          border-color: #a7e9d5;
          background: #ecfbf6;
          box-shadow: 3px 4px 0 #b8eadc;
        }

        .payrep-feedback.warning {
          color: #975317;
          border-color: #f2d28f;
          background: #fff8e8;
          box-shadow: 3px 4px 0 #f5dfb1;
        }

        .payrep-feedback.error {
          color: #a2334b;
          border-color: #efbdc8;
          background: #fff1f4;
          box-shadow: 3px 4px 0 #f2cad2;
        }

        .payrep-feedback-icon {
          display: inline-grid;
          width: 28px;
          height: 28px;
          place-items: center;
          border-radius: 9px;
          background: rgba(255, 255, 255, .72);
        }

        .payrep-feedback-copy {
          display: grid;
          gap: 2px;
          min-width: 0;
        }

        .payrep-feedback-copy strong {
          font-weight: 950;
        }

        .payrep-feedback-close {
          display: inline-grid;
          width: 30px;
          height: 30px;
          place-items: center;
          padding: 0;
          border: 0;
          border-radius: 9px;
          color: currentColor;
          background: rgba(255, 255, 255, .72);
          font-size: 18px;
          font-weight: 800;
          cursor: pointer;
        }

        .payrep-section-feedback {
          margin-top: 15px;
        }

        .payrep-report-types {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          grid-auto-rows: 1fr;
          gap: 15px;
        }

        .payrep-type-card {
          position: relative;
          display: grid;
          align-content: start;
          min-width: 0;
          min-height: 156px;
          padding: 20px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 21px;
          color: var(--payrep-ink);
          background: #e8f3ff;
          box-shadow:
            6px 7px 0 #b7d9ff,
            0 15px 28px rgba(31, 41, 92, .065);
          cursor: pointer;
          text-align: left;
          transition:
            transform .16s ease,
            border-color .16s ease,
            box-shadow .16s ease,
            background .16s ease;
        }

        .payrep-type-card:nth-child(1) {
          background: #e5f2ff;
          box-shadow:
            6px 7px 0 #afd4ff,
            0 15px 28px rgba(31, 41, 92, .065);
        }

        .payrep-type-card:nth-child(2) {
          background: #e4f7f0;
          box-shadow:
            6px 7px 0 #afe4d6,
            0 15px 28px rgba(31, 41, 92, .065);
        }

        .payrep-type-card:nth-child(3) {
          background: #fff2cf;
          box-shadow:
            6px 7px 0 #ffdda0,
            0 15px 28px rgba(31, 41, 92, .065);
        }

        .payrep-type-card:nth-child(4) {
          background: #eeebff;
          box-shadow:
            6px 7px 0 #c6bcff,
            0 15px 28px rgba(31, 41, 92, .065);
        }

        .payrep-type-card:nth-child(5) {
          background: #ffe8ed;
          box-shadow:
            6px 7px 0 #f3bec9,
            0 15px 28px rgba(31, 41, 92, .065);
        }

        .payrep-type-card:nth-child(6) {
          background: #e5f2ff;
          box-shadow:
            6px 7px 0 #afd4ff,
            0 15px 28px rgba(31, 41, 92, .065);
        }

        .payrep-type-card:nth-child(7) {
          background: #e4f7f0;
          box-shadow:
            6px 7px 0 #afe4d6,
            0 15px 28px rgba(31, 41, 92, .065);
        }

        .payrep-type-card.is-active {
          border-color: rgba(77, 119, 221, .72);
          background: linear-gradient(145deg, #dcecff 0%, #e9e3ff 100%);
          box-shadow:
            7px 8px 0 #aebcff,
            0 17px 32px rgba(31, 41, 92, .10);
        }

        .payrep-type-card svg {
          margin-bottom: 13px;
          color: #6558dc;
        }

        .payrep-type-card strong {
          display: block;
          margin-bottom: 7px;
          font-size: 14px;
          font-weight: 950;
        }

        .payrep-type-card span {
          display: block;
          color: var(--payrep-copy);
          font-size: 10.5px;
          line-height: 1.55;
        }

        .payrep-panel {
          min-width: 0;
          padding: clamp(19px, 2.2vw, 28px);
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 25px;
          background: #fff;
          box-shadow:
            8px 9px 0 #d4dbff,
            0 22px 40px rgba(29, 40, 92, .065);
        }

        .payrep-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 20px;
        }

        .payrep-section-head > * {
          min-width: 0;
        }

        .payrep-section-head h2,
        .payrep-section-head h3 {
          margin: 0 0 6px;
          color: var(--payrep-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(21px, 2.2vw, 29px);
          line-height: 1.08;
        }

        .payrep-section-head p {
          margin: 0;
          color: var(--payrep-copy);
          font-size: 11.5px;
          line-height: 1.55;
        }

        .payrep-filters {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .payrep-field {
          display: grid;
          gap: 7px;
          min-width: 0;
        }

        .payrep-field label {
          color: #586581;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .055em;
          text-transform: uppercase;
        }

        .payrep-field input,
        .payrep-field select,
        .payrep-field textarea {
          width: 100%;
          min-width: 0;
          min-height: 46px;
          padding: 10px 13px;
          border: 1px solid rgba(163, 174, 211, .70);
          border-radius: 14px;
          outline: none;
          color: #192542;
          background: #fff;
          box-shadow: none;
          font: inherit;
          font-size: 12px;
          transition:
            border-color .15s ease,
            box-shadow .15s ease,
            background .15s ease;
        }

        .payrep-field select[multiple] {
          min-height: 112px;
          padding: 8px;
        }

        .payrep-field textarea {
          min-height: 100px;
          resize: vertical;
          line-height: 1.5;
        }

        .payrep-field input:focus,
        .payrep-field select:focus,
        .payrep-field textarea:focus {
          border-color: rgba(77, 119, 221, .78);
          box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
        }

        .payrep-field-full {
          grid-column: 1 / -1;
        }

        .payrep-checkbox {
          display: flex;
          align-items: center;
          gap: 9px;
          min-height: 46px;
          padding: 10px 12px;
          border: 1px solid rgba(171, 181, 211, .48);
          border-radius: 14px;
          color: #52607d;
          background: #f8faff;
          font-size: 11px;
          font-weight: 850;
        }

        .payrep-checkbox input {
          width: 17px;
          height: 17px;
          accent-color: #5c70dc;
        }

        .payrep-filter-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 11px;
          margin-top: 18px;
          padding-top: 17px;
          border-top: 1px solid rgba(171, 181, 211, .32);
        }

        .payrep-metrics {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 15px;
        }

        .payrep-metric {
          container-type: inline-size;
          min-width: 0;
          min-height: 142px;
          padding: 19px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 22px;
          box-shadow:
            7px 8px 0 #cfdaff,
            0 18px 31px rgba(30, 40, 92, .055);
        }

        .payrep-metric:nth-child(1) {
          background: #edf7ff;
        }

        .payrep-metric:nth-child(2) {
          background: #fff5d8;
          box-shadow: 7px 8px 0 #f4d99b;
        }

        .payrep-metric:nth-child(3) {
          background: #f2efff;
          box-shadow: 7px 8px 0 #cfc5ff;
        }

        .payrep-metric:nth-child(4) {
          background: #eaf9f4;
          box-shadow: 7px 8px 0 #afe3d4;
        }

        .payrep-metric:nth-child(5) {
          background: #fff0f3;
          box-shadow: 7px 8px 0 #f0bdc7;
        }

        .payrep-metric-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 15px;
          color: #62708c;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .055em;
          text-transform: uppercase;
        }

        .payrep-metric-head svg {
          width: 34px;
          height: 34px;
          padding: 8px;
          border: 1px solid rgba(91, 105, 177, .17);
          border-radius: 11px;
          background: rgba(255, 255, 255, .68);
        }

        .payrep-metric strong {
          display: block;
          width: max-content;
          max-width: none;
          overflow: visible;
          color: #131b38;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(17px, 7cqi, 28px);
          line-height: 1;
          letter-spacing: -.025em;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        .payrep-statement-employee {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .payrep-statement-item {
          min-width: 0;
          padding: 15px;
          border: 1px solid rgba(171, 181, 211, .44);
          border-radius: 16px;
          background: #f8faff;
        }

        .payrep-statement-item span {
          display: block;
          margin-bottom: 5px;
          color: #6b7895;
          font-size: 8.5px;
          font-weight: 950;
          letter-spacing: .05em;
          text-transform: uppercase;
        }

        .payrep-statement-item strong {
          display: block;
          overflow-wrap: anywhere;
          color: #17213e;
          font-size: 12px;
          font-weight: 900;
        }

        .payrep-chart {
          display: grid;
          gap: 12px;
        }

        .payrep-chart-row {
          display: grid;
          grid-template-columns: 90px minmax(0, 1fr) 155px;
          gap: 14px;
          align-items: center;
          padding: 12px 13px;
          border: 1px solid rgba(171, 181, 211, .40);
          border-radius: 15px;
          background: #fafbff;
        }

        .payrep-chart-label {
          color: #4d5b79;
          font-size: 10px;
          font-weight: 950;
        }

        .payrep-chart-bars {
          display: grid;
          gap: 6px;
        }

        .payrep-chart-track {
          height: 9px;
          overflow: hidden;
          border-radius: 999px;
          background: #e9edf7;
        }

        .payrep-chart-bar {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #4d77dd, #6e67e7);
        }

        .payrep-chart-bar.is-secondary {
          background: linear-gradient(90deg, #2eb2b9, #57caa4);
        }

        .payrep-chart-value {
          color: #34415f;
          text-align: right;
          font-size: 9.5px;
          font-weight: 850;
          line-height: 1.45;
        }

        .payrep-table-wrap {
          width: 100%;
          min-width: 0;
          overflow-x: auto;
          padding: 13px 13px 17px;
          border: 1px solid rgba(171, 181, 211, .65);
          border-radius: 22px;
          background: #fff;
          box-shadow:
            7px 8px 0 #cdd5ff,
            0 17px 32px rgba(31, 41, 92, .055);
          overscroll-behavior-x: contain;
          scrollbar-width: thin;
          scrollbar-color: #c1cad8 transparent;
        }

        .payrep-table-wrap::-webkit-scrollbar {
          height: 8px;
        }

        .payrep-table-wrap::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: #c1cad8;
        }

        .payrep-table,
        .payrep-export-table {
          width: 100%;
          min-width: 980px;
          border-collapse: separate;
          border-spacing: 0 10px;
        }

        .payrep-export-table {
          min-width: 940px;
        }

        .payrep-table th,
        .payrep-table td,
        .payrep-export-table th,
        .payrep-export-table td {
          padding: 12px 11px;
          text-align: left;
          vertical-align: middle;
          font-size: 10px;
        }

        .payrep-table th,
        .payrep-export-table th {
          position: sticky;
          z-index: 2;
          top: -13px;
          border: 0;
          color: #697591;
          background: #fff;
          font-size: 8.5px;
          font-weight: 950;
          letter-spacing: .055em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .payrep-table td,
        .payrep-export-table td {
          max-width: 270px;
          border-top: 1px solid rgba(171, 181, 211, .44);
          border-bottom: 1px solid rgba(171, 181, 211, .44);
          color: #34415e;
          background: #f8fbff;
          line-height: 1.45;
        }

        .payrep-table tbody tr:nth-child(even) td,
        .payrep-export-table tbody tr:nth-child(even) td {
          background: #fbf9ff;
        }

        .payrep-table td:first-child,
        .payrep-export-table td:first-child {
          border-left: 1px solid rgba(171, 181, 211, .44);
          border-radius: 15px 0 0 15px;
        }

        .payrep-table td:last-child,
        .payrep-export-table td:last-child {
          border-right: 1px solid rgba(171, 181, 211, .44);
          border-radius: 0 15px 15px 0;
        }

        .payrep-table td.is-money {
          color: #1d2946;
          font-weight: 900;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        .payrep-table td.is-identity strong,
        .payrep-export-table td strong {
          display: block;
          margin-bottom: 3px;
          color: #17213d;
          font-weight: 950;
        }

        .payrep-table td.is-identity small,
        .payrep-export-table td small {
          color: #71809d;
        }

        .payrep-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 9px;
          border: 1px solid transparent;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 950;
          white-space: nowrap;
        }

        .payrep-status-success {
          color: #087659;
          border-color: #a8e9d4;
          background: #eafaf4;
        }

        .payrep-status-warning {
          color: #9a5818;
          border-color: #efd28f;
          background: #fff8e9;
        }

        .payrep-status-neutral {
          color: #554b94;
          border-color: #d5cff7;
          background: #f3f1ff;
        }

        .payrep-empty {
          display: grid;
          min-height: 220px;
          place-items: center;
          padding: 30px;
          border: 1px dashed rgba(171, 181, 211, .76);
          border-radius: 19px;
          color: var(--payrep-copy);
          background: #fafbff;
          text-align: center;
        }

        .payrep-empty strong {
          display: block;
          margin-top: 8px;
          color: #2b3655;
        }

        .payrep-empty p {
          margin: 6px 0 0;
          font-size: 11px;
          line-height: 1.5;
        }

        .payrep-empty svg {
          opacity: .65;
        }

        .payrep-modal-backdrop {
          position: fixed;
          z-index: 2147483000;
          inset: 0;
          display: grid;
          place-items: center;
          overflow: hidden;
          padding: clamp(14px, 3vw, 28px);
          background: rgba(22, 28, 65, .50);
          backdrop-filter: blur(11px) saturate(1.04);
          -webkit-backdrop-filter: blur(11px) saturate(1.04);
          overscroll-behavior: contain;
        }

        .payrep-modal {
          width: min(700px, 100%);
          max-height: min(88dvh, 820px);
          overflow: auto;
          overscroll-behavior: contain;
          border: 1px solid rgba(171, 181, 211, .78);
          border-radius: 29px;
          background: #fff;
          box-shadow:
            10px 12px 0 #c9c0ff,
            0 34px 76px rgba(20, 27, 70, .28);
          scrollbar-width: thin;
          scrollbar-color: rgba(102, 88, 220, .30) transparent;
        }

        .payrep-modal-head {
          position: sticky;
          z-index: 3;
          top: 0;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 21px 23px 17px;
          border-bottom: 1px solid rgba(171, 181, 211, .42);
          border-radius: 28px 28px 0 0;
          background:
            linear-gradient(90deg, #e8fbff 0%, #fff 50%, #f1edff 100%);
        }

        .payrep-modal-head h2 {
          margin: 0 0 5px;
          color: #111a38;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(24px, 3vw, 32px);
          line-height: 1;
        }

        .payrep-modal-head p {
          margin: 0;
          color: #66738f;
          font-size: 10.5px;
        }

        .payrep-modal-close {
          display: inline-grid;
          width: 43px;
          height: 43px;
          flex: 0 0 43px;
          place-items: center;
          padding: 0;
          border: 1px solid rgba(102, 88, 220, .18);
          border-radius: 14px;
          color: #40348d;
          background: #fff;
          box-shadow: 3px 4px 0 #d7d2ff;
          font-size: 21px;
          line-height: 1;
          cursor: pointer;
        }

        .payrep-modal-close:disabled {
          cursor: not-allowed;
          opacity: .5;
        }

        .payrep-modal-body {
          display: grid;
          gap: 15px;
          padding: 21px 23px 18px;
          background: #fff;
        }

        .payrep-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .payrep-modal-actions {
          position: sticky;
          z-index: 3;
          bottom: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 11px;
          padding: 15px 23px 21px;
          border-top: 1px solid rgba(171, 181, 211, .42);
          border-radius: 0 0 28px 28px;
          background: rgba(250, 251, 255, .98);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .payrep-modal-actions > .payrep-btn {
          width: 100%;
        }

        .payrep-modal-feedback {
          grid-column: 1 / -1;
          margin-bottom: 2px;
        }

        .spin {
          animation: payrep-spin .9s linear infinite;
        }

        @keyframes payrep-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes payrep-feedback-in {
          from {
            opacity: 0;
            transform: translateY(-5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 1220px) {
          .payrep-report-types {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .payrep-filters {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .payrep-metrics {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 900px) {
          .payroll-reports-page {
            width: min(100% - 28px, 1280px);
            padding-top: 18px;
          }

          .payrep-hero {
            grid-template-columns: 1fr;
            padding: 28px;
          }

          .payrep-hero-actions {
            justify-content: flex-start;
          }

          .payrep-report-types,
          .payrep-filters,
          .payrep-statement-employee {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .payrep-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .payrep-section-head {
            flex-direction: column;
          }

          .payrep-section-head > .payrep-field {
            width: min(100%, 360px);
          }
        }

        @media (max-width: 700px) {
          .payroll-reports-page {
            width: min(100% - 20px, 1280px);
            gap: 17px;
            padding-top: 12px;
          }

          .payrep-hero {
            padding: 22px;
            border-radius: 23px;
            box-shadow:
              7px 9px 0 #cbd3ff,
              0 22px 42px rgba(32, 42, 99, .08);
          }

          .payrep-hero h1 {
            font-size: clamp(34px, 11vw, 48px);
          }

          .payrep-hero-actions {
            display: grid;
            grid-template-columns: 1fr;
            width: 100%;
          }

          .payrep-hero-actions .payrep-btn {
            width: 100%;
          }

          .payrep-report-types,
          .payrep-filters,
          .payrep-metrics,
          .payrep-statement-employee,
          .payrep-form-grid {
            grid-template-columns: 1fr;
          }

          .payrep-type-card {
            min-height: 0;
          }

          .payrep-panel {
            padding: 18px;
            border-radius: 21px;
            box-shadow:
              6px 8px 0 #d4dbff,
              0 18px 32px rgba(29, 40, 92, .06);
          }

          .payrep-filter-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .payrep-filter-actions .payrep-btn {
            width: 100%;
          }

          .payrep-chart-row {
            grid-template-columns: 72px minmax(0, 1fr);
          }

          .payrep-chart-value {
            grid-column: 2;
            text-align: left;
          }

          .payrep-table-wrap {
            padding: 9px 9px 14px;
            border-radius: 18px;
            box-shadow:
              5px 7px 0 #cdd5ff,
              0 15px 26px rgba(31, 41, 92, .05);
          }

          .payrep-modal-backdrop {
            padding: 10px;
          }

          .payrep-modal {
            max-height: calc(100dvh - 20px);
            border-radius: 22px;
            box-shadow:
              7px 9px 0 #c9c0ff,
              0 24px 52px rgba(20, 27, 70, .25);
          }

          .payrep-modal-head {
            padding: 18px 17px 15px;
            border-radius: 21px 21px 0 0;
          }

          .payrep-modal-body {
            padding: 17px;
          }

          .payrep-modal-actions {
            grid-template-columns: 1fr;
            padding: 14px 17px 18px;
            border-radius: 0 0 21px 21px;
          }

          .payrep-modal-feedback {
            grid-column: 1;
          }
        }

        @media (max-width: 520px) {
          .payroll-reports-page {
            width: calc(100% - 16px);
          }

          .payrep-hero,
          .payrep-panel {
            padding: 17px;
          }

          .payrep-kicker {
            padding: 7px 10px;
            font-size: 9px;
          }

          .payrep-metric {
            min-height: 124px;
            padding: 16px;
          }

          .payrep-metric strong {
            font-size: clamp(16px, 7.2cqi, 25px);
          }

          .payrep-feedback {
            grid-template-columns: auto minmax(0, 1fr);
          }

          .payrep-feedback-close {
            grid-column: 2;
            justify-self: end;
          }
        }

        @media (max-width: 390px) {
          .payroll-reports-page {
            width: calc(100% - 12px);
          }

          .payrep-hero,
          .payrep-panel {
            padding: 15px;
          }

          .payrep-btn {
            min-height: 44px;
            padding-inline: 12px;
          }
        }

        @media (hover: none) {
          .payrep-btn,
          .payrep-type-card {
            transform: none !important;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .payroll-reports-page *,
          .payroll-reports-page *::before,
          .payroll-reports-page *::after {
            scroll-behavior: auto !important;
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
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
              showPayrepFeedback(
                'page',
                'info',
                'Refreshing employee and payroll-report export data...',
                'Refreshing Payroll Reports',
              );
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

        <PayrollReportFeedback
          feedback={inlineFeedback.page}
          onClose={() => clearPayrepFeedback('page')}
          className="payrep-hero-feedback"
        />
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
                {PAYROLL_STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
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
              showPayrepFeedback(
                'filters',
                'success',
                'Report filters were restored to their default values.',
                'Filters Reset',
              );
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

        <PayrollReportFeedback
          feedback={inlineFeedback.filters}
          onClose={() => clearPayrepFeedback('filters')}
          className="payrep-section-feedback"
        />
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
                                  column === 'status'
                                    ? payrollStatusTone(row[column])
                                    : normalizeKey(row[column]) === 'removed'
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

          <PayrollReportFeedback
            feedback={inlineFeedback.history}
            onClose={() => clearPayrepFeedback('history')}
            className="payrep-section-feedback"
          />

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
                <PayrollReportFeedback
                  feedback={inlineFeedback['export-modal']}
                  onClose={() => clearPayrepFeedback('export-modal')}
                  className="payrep-modal-feedback"
                />

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
                <PayrollReportFeedback
                  feedback={inlineFeedback['export-status-modal']}
                  onClose={() => clearPayrepFeedback('export-status-modal')}
                  className="payrep-modal-feedback"
                />

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