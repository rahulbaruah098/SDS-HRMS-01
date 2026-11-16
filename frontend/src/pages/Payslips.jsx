import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  IndianRupee,
  Landmark,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';

import { api, getApiUrl, getToken } from '../api/client';

const DEFAULT_LIMIT = 1000;

const PRIVILEGED_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
]);

const STATUS_OPTIONS = [
  ['', 'All payroll stages'],
  ['draft', 'Draft'],
  ['hr_reviewed', 'HR Reviewed'],
  ['finance_approved', 'Finance Approved'],
  ['locked', 'Locked'],
  ['disbursed', 'Disbursed'],
];

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
  const roleValues = Array.isArray(user.roles)
    ? user.roles
    : typeof user.roles === 'string'
      ? user.roles.split(',')
      : [];

  const roles = roleValues.map(normalizeKey).filter(Boolean);
  const primaryRole = normalizeKey(user.role);

  if (primaryRole && !roles.includes(primaryRole)) {
    roles.push(primaryRole);
  }

  return roles;
}

function hasPrivilegedAccess(user = {}) {
  return normalizeRoles(user).some((role) => PRIVILEGED_ROLES.has(role));
}

function isSuperAdmin(user = {}) {
  return normalizeRoles(user).includes('super_admin');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function periodLabel(value) {
  const [yearText, monthText] = String(value || '').split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return safeText(value);
  }

  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatDate(value, includeTime = true) {
  if (!value) {
    return '—';
  }

  const raw = typeof value === 'object' && value.$date ? value.$date : value;
  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    return safeText(raw);
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

function statusLabel(value) {
  return safeText(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusTone(value) {
  const status = normalizeKey(value);

  if (status === 'disbursed') {
    return 'success';
  }

  if (status === 'locked') {
    return 'primary';
  }

  if (status === 'finance_approved') {
    return 'blue';
  }

  if (status === 'hr_reviewed') {
    return 'warning';
  }

  return 'neutral';
}

function recordId(record = {}) {
  return safeText(record._id || record.id, '');
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

function payslipEmployeeReference(payslip = {}) {
  return safeText(
    payslip.employee_id ||
      payslip.employee_info?.employee_id ||
      payslip.employee_info?._id ||
      payslip.employee?._id ||
      payslip.employee?.id,
    '',
  );
}

function payslipPeriod(payslip = {}) {
  const directPeriod = safeText(
    payslip.period_key || payslip.payroll_period,
    '',
  );

  if (/^\d{4}-\d{2}$/.test(directPeriod)) {
    return directPeriod;
  }

  const year = toNumber(payslip.year || payslip.payroll_year, 0);
  const month = toNumber(
    payslip.month ||
      payslip.month_number ||
      payslip.payroll_month,
    0,
  );

  if (year >= 2000 && month >= 1 && month <= 12) {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  return '';
}

function payslipTotals(payslip = {}) {
  return payslip.totals || {};
}

function taxDeclarationSnapshot(payslip = {}) {
  return (
    payslip.tax_declaration_snapshot ||
    payslip.tax_context_snapshot?.declaration ||
    {}
  );
}

function tdsInstructionSnapshot(payslip = {}) {
  return (
    payslip.tds_instruction_snapshot ||
    payslip.tax_context_snapshot?.tds ||
    {}
  );
}

function tdsMode(payslip = {}) {
  return normalizeKey(
    tdsInstructionSnapshot(payslip).mode ||
      payslip.calculation_input_snapshot?.tds_source ||
      payslip.statutory_config_snapshot?.tds?.mode ||
      'disabled',
  );
}

function reimbursementTotal(payslip = {}) {
  const totals = payslipTotals(payslip);

  return toNumber(
    totals.reimbursements ??
      totals.reimbursement_amount ??
      totals.approved_reimbursements ??
      payslip.reimbursement_summary?.total_amount,
    0,
  );
}

function bankSnapshot(payslip = {}) {
  return (
    payslip.bank_details_snapshot ||
    payslip.bank_snapshot ||
    payslip.bank_account_snapshot ||
    {}
  );
}

function transferSnapshot(payslip = {}) {
  return payslip.transfer_details || {};
}

function lineLabel(line = {}) {
  return safeText(
    line.label ||
      line.name ||
      line.title ||
      line.component_name ||
      line.component ||
      line.code,
    'Payroll Component',
  );
}

function lineAmount(line = {}) {
  return toNumber(
    line.amount ??
      line.value ??
      line.calculated_amount ??
      line.monthly_amount,
    0,
  );
}

function payslipFilename(payslip = {}) {
  const period = payslipPeriod(payslip) || 'period';
  const code = safeText(
    payslip.employee_code ||
      payslip.employee_info?.employee_code ||
      payslipEmployeeReference(payslip).slice(-8),
    'employee',
  )
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `payslip_${code}_${period}.pdf`;
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


function PayslipFeedbackLine({ feedback, onClose, className = '' }) {
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
        ? AlertTriangle
        : ShieldCheck;

  return (
    <div
      className={`payslip-feedback ${type} ${className}`.trim()}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      <span className="payslip-feedback-icon" aria-hidden="true">
        {feedback.loading ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}
      </span>

      <span className="payslip-feedback-copy">
        {feedback.title ? <strong>{feedback.title}</strong> : null}
        <span>{feedback.message}</span>
      </span>

      <button
        type="button"
        className="payslip-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export default function Payslips({ user = {}, setPage = () => {} }) {
  const privileged = hasPrivilegedAccess(user);
  const superAdmin = isSuperAdmin(user);

  const [tenantId, setTenantId] = useState(
    safeText(user.tenant_id || user.tenant?.tenant_id || user.tenant?.code, ''),
  );
  const [period, setPeriod] = useState(currentPeriod());
  const [status, setStatus] = useState('');
  const [employeeReference, setEmployeeReference] = useState('');
  const [search, setSearch] = useState('');

  const [employees, setEmployees] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [selectedPayslip, setSelectedPayslip] = useState(null);

  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingPayslips, setLoadingPayslips] = useState(false);
  const [pdfActionKey, setPdfActionKey] = useState('');
  const [feedback, setFeedback] = useState({});
  const feedbackTimersRef = useRef({});
  const manualRefreshStatusRef = useRef({
    active: false,
    failed: false,
  });

  function clearPayslipFeedback(scopeKey) {
    if (!scopeKey) {
      return;
    }

    const timer = feedbackTimersRef.current[scopeKey];
    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedback((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scopeKey)) {
        return current;
      }

      const next = { ...current };
      delete next[scopeKey];
      return next;
    });
  }

  function showPayslipFeedback(
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

    setFeedback((current) => ({
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
        setFeedback((current) => {
          const next = { ...current };
          delete next[scopeKey];
          return next;
        });
        delete feedbackTimersRef.current[scopeKey];
      }, 4200);
    }
  }

  useEffect(() => {
    return () => {
      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      feedbackTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const visibleFeedbackKeys = Object.keys(feedback);

    if (!visibleFeedbackKeys.length) {
      return undefined;
    }

    function dismissVisibleFeedbackOnScreenClick() {
      visibleFeedbackKeys.forEach((scopeKey) => {
        const timer = feedbackTimersRef.current[scopeKey];

        if (timer) {
          window.clearTimeout(timer);
          delete feedbackTimersRef.current[scopeKey];
        }
      });

      setFeedback((current) => {
        if (!Object.keys(current).length) {
          return current;
        }

        return {};
      });
    }

    document.addEventListener('pointerdown', dismissVisibleFeedbackOnScreenClick);

    return () => {
      document.removeEventListener(
        'pointerdown',
        dismissVisibleFeedbackOnScreenClick,
      );
    };
  }, [feedback]);


  function tenantParams() {
    if (!superAdmin || !tenantId.trim()) {
      return {};
    }

    return { tenant_id: tenantId.trim() };
  }

  function assertTenant() {
    if (superAdmin && !tenantId.trim()) {
      showPayslipFeedback(
        'filters',
        'warning',
        'Enter the company tenant ID before loading payslips.',
        'Tenant Required',
      );
      return false;
    }

    return true;
  }

  const visiblePayslips = useMemo(() => {
    const term = normalizeKey(search);

    return payslips.filter((payslip) => {
      if (!term) {
        return true;
      }

      const totals = payslipTotals(payslip);

      return [
        payslip.employee_name,
        payslip.employee_code,
        payslip.employee_info?.name,
        payslip.employee_info?.official_email,
        payslip.department,
        payslip.employee_info?.department,
        payslip.designation,
        payslip.employee_info?.designation,
        payslip.period_key,
        payslip.status,
        tdsMode(payslip),
        totals.net_amount,
      ]
        .map(normalizeKey)
        .join(' ')
        .includes(term);
    });
  }, [payslips, search]);

  const metrics = useMemo(() => {
    return visiblePayslips.reduce(
      (summary, payslip) => {
        const totals = payslipTotals(payslip);
        const payslipStatus = normalizeKey(payslip.status);

        summary.total += 1;
        summary.gross += toNumber(
          totals.payable_gross_salary ?? totals.gross_salary,
        );
        summary.deductions += toNumber(totals.total_deductions);
        summary.net += toNumber(totals.net_amount);

        if (['locked', 'disbursed'].includes(payslipStatus)) {
          summary.released += 1;
        }

        if (payslipStatus === 'disbursed') {
          summary.disbursed += 1;
        }

        return summary;
      },
      {
        total: 0,
        gross: 0,
        deductions: 0,
        net: 0,
        released: 0,
        disbursed: 0,
      },
    );
  }, [visiblePayslips]);

  async function loadEmployees({ silent = false } = {}) {
    if (!privileged) {
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
          limit: 500,
          sort_by: 'name',
          sort_dir: 'asc',
        })}`,
      );
      const rows = sortEmployees(data.items || []);

      setEmployees(rows);
      return rows;
    } catch (error) {
      setEmployees([]);

      if (manualRefreshStatusRef.current.active) {
        manualRefreshStatusRef.current.failed = true;
      }

      if (!silent) {
        showPayslipFeedback(
          'filters',
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

  async function loadPayslips({ silent = false } = {}) {
    if (!assertTenant()) {
      setPayslips([]);
      setSelectedPayslip(null);
      return [];
    }

    try {
      setLoadingPayslips(true);

      const data = await api(
        `/payslips${buildQuery({
          ...tenantParams(),
          period_key: period,
          status: privileged ? status : '',
          employee_id: privileged ? employeeReference : '',
          limit: DEFAULT_LIMIT,
          sort_by: privileged ? 'employee_name' : 'period_key',
          sort_dir: privileged ? 'asc' : 'desc',
        })}`,
      );
      const rows = Array.isArray(data.items) ? data.items : [];

      setPayslips(rows);

      if (selectedPayslip) {
        const updatedSelection = rows.find(
          (item) => recordId(item) === recordId(selectedPayslip),
        );
        setSelectedPayslip(updatedSelection || rows[0] || null);
      } else {
        setSelectedPayslip(rows[0] || null);
      }

      return rows;
    } catch (error) {
      setPayslips([]);
      setSelectedPayslip(null);

      if (manualRefreshStatusRef.current.active) {
        manualRefreshStatusRef.current.failed = true;
      }

      if (!silent) {
        showPayslipFeedback(
          'results',
          'error',
          error.message || 'Unable to load payslips.',
          'Payslip Load Failed',
        );
      }

      return [];
    } finally {
      setLoadingPayslips(false);
    }
  }

  async function refreshAll({ silent = false } = {}) {
    const tasks = [loadPayslips({ silent })];

    if (privileged) {
      tasks.push(loadEmployees({ silent: true }));
    }

    await Promise.all(tasks);
  }

  async function handleManualRefresh() {
    if (superAdmin && !tenantId.trim()) {
      showPayslipFeedback(
        'actions',
        'warning',
        'Enter the company tenant ID before refreshing payslip data.',
        'Tenant Required',
      );
      return;
    }

    manualRefreshStatusRef.current = {
      active: true,
      failed: false,
    };

    showPayslipFeedback(
      'actions',
      'info',
      'Refreshing payslip and employee data with the current filters...',
      'Refreshing Payslips',
      { loading: true },
    );

    try {
      await refreshAll({ silent: false });

      if (manualRefreshStatusRef.current.failed) {
        showPayslipFeedback(
          'actions',
          'error',
          'Some payslip data could not be refreshed. Review the related message below and try again.',
          'Refresh Incomplete',
        );
      } else {
        showPayslipFeedback(
          'actions',
          'success',
          'Payslip and employee data were refreshed successfully.',
          'Refresh Complete',
        );
      }
    } finally {
      manualRefreshStatusRef.current = {
        active: false,
        failed: false,
      };
    }
  }

  useEffect(() => {
    if (superAdmin && !tenantId.trim()) {
      setEmployees([]);
      setPayslips([]);
      setSelectedPayslip(null);
      return;
    }

    refreshAll({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, period, status, employeeReference]);

  async function handlePdf(payslip, mode) {
    const employee = payslipEmployeeReference(payslip);
    const selectedPeriod = payslipPeriod(payslip);
    const [yearText, monthText] = selectedPeriod.split('-');
    const year = Number(yearText);
    const month = Number(monthText);

    if (!employee || !year || !month) {
      showPayslipFeedback(
        'pdf',
        'warning',
        'This payslip does not contain a valid employee and payroll period.',
        'Payslip PDF Unavailable',
      );
      return;
    }

    const actionKey = `${recordId(payslip)}-${mode}`;
    let previewWindow = null;

    if (mode === 'preview') {
      previewWindow = window.open('', '_blank');

      if (!previewWindow) {
        showPayslipFeedback(
          'pdf',
          'warning',
          'Allow pop-ups for this HRMS site, then try again.',
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
      showPayslipFeedback(
        'pdf',
        'info',
        mode === 'preview'
          ? 'Preparing the server-generated payslip preview...'
          : 'Preparing the payslip PDF download...',
        mode === 'preview' ? 'Preparing Preview' : 'Preparing Download',
        { loading: true },
      );

      const token = getToken();
      const query = buildQuery({
        ...tenantParams(),
        download: mode === 'download' ? 1 : 0,
      });
      const response = await fetch(
        getApiUrl(
          `/payroll/payslip/${encodeURIComponent(employee)}/${month}/${year}${query}`,
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
      const filename = filenameFromDisposition(
        response.headers.get('content-disposition'),
        payslipFilename(payslip),
      );

      if (mode === 'preview') {
        previewWindow.location.replace(objectUrl);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
        clearPayslipFeedback('pdf');
      } else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

        showPayslipFeedback(
          'pdf',
          'success',
          `${filename} was downloaded successfully.`,
          'Payslip Downloaded',
        );
      }
    } catch (error) {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.close();
      }

      showPayslipFeedback(
        'pdf',
        'error',
        error.message || 'Unable to generate the payslip PDF.',
        mode === 'preview'
          ? 'Payslip Preview Failed'
          : 'Payslip Download Failed',
      );
    } finally {
      setPdfActionKey('');
    }
  }

  function renderPdfActions(payslip) {
    const previewKey = `${recordId(payslip)}-preview`;
    const downloadKey = `${recordId(payslip)}-download`;
    const busy = Boolean(pdfActionKey);

    return (
      <div className="payslip-pdf-actions">
        <button
          type="button"
          className="payslip-btn payslip-btn-secondary"
          onClick={() => handlePdf(payslip, 'preview')}
          disabled={busy}
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
          className="payslip-btn payslip-btn-primary"
          onClick={() => handlePdf(payslip, 'download')}
          disabled={busy}
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
  }

  const selectedTotals = payslipTotals(selectedPayslip || {});
  const selectedTaxDeclaration = taxDeclarationSnapshot(
    selectedPayslip || {},
  );
  const selectedTdsInstruction = tdsInstructionSnapshot(
    selectedPayslip || {},
  );
  const selectedBank = bankSnapshot(selectedPayslip || {});
  const selectedTransfer = transferSnapshot(selectedPayslip || {});

  return (
    <div className="payslips-page">
      <style>{`
        .payslips-page {
          --payslip-ink: #101a3a;
          --payslip-heading: #17213d;
          --payslip-muted: #64738f;
          --payslip-primary: #5145d8;
          --payslip-primary-dark: #40348d;
          --payslip-blue: #4c79df;
          --payslip-cyan: #2bb6c6;
          --payslip-teal: #13a77a;
          --payslip-amber: #c48616;
          --payslip-rose: #c1546d;
          --payslip-border: rgba(166, 177, 213, .66);
          --payslip-soft-border: rgba(171, 181, 211, .46);
          --payslip-card: #ffffff;

          width: min(1280px, calc(100% - 48px));
          max-width: 1280px;
          min-width: 0;
          margin: 0 auto;
          display: grid;
          gap: 22px;
          color: var(--payslip-ink);
        }

        .payslips-page *,
        .payslips-page *::before,
        .payslips-page *::after {
          box-sizing: border-box;
        }

        .payslip-hero {
          position: relative;
          isolation: isolate;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 30px;
          min-height: 255px;
          padding: clamp(28px, 3.2vw, 44px);
          overflow: hidden;
          border: 1px solid rgba(155, 171, 216, .62);
          border-radius: 32px;
          background:
            linear-gradient(
              90deg,
              #d9f6ff 0%,
              #edfaff 27%,
              #ffffff 51%,
              #f7f3ff 73%,
              #ebe5ff 100%
            );
          box-shadow:
            10px 12px 0 #b9d5ff,
            0 28px 54px rgba(34, 38, 110, .10);
        }

        .payslip-hero-content,
        .payslip-hero-actions {
          position: relative;
          z-index: 1;
          min-width: 0;
        }

        .payslip-kicker,
        .payslip-section-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          border-radius: 999px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .10em;
          text-transform: uppercase;
        }

        .payslip-kicker {
          margin-bottom: 17px;
          padding: 10px 14px;
          color: #ffffff;
          background: linear-gradient(135deg, #4f7de2 0%, #2db6c5 100%);
          box-shadow: 5px 6px 0 #504694;
          font-size: 9px;
        }

        .payslip-section-kicker {
          margin-bottom: 7px;
          color: #4d46a8;
          font-size: 9px;
        }

        .payslip-hero h1 {
          max-width: 820px;
          margin: 0;
          color: var(--payslip-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(46px, 5.2vw, 76px);
          font-weight: 760;
          line-height: .96;
          letter-spacing: -.055em;
        }

        .payslip-hero h1 em {
          color: #41398e;
          font-family: inherit;
          font-style: normal;
          font-weight: 500;
        }

        .payslip-hero p {
          max-width: 860px;
          margin: 18px 0 0;
          color: #617394;
          font-size: clamp(13px, 1.12vw, 16px);
          line-height: 1.7;
        }

        .payslip-hero-actions {
          display: grid;
          justify-items: end;
          align-content: center;
          gap: 11px;
          width: min(100%, 430px);
          max-width: 430px;
        }

        .payslip-hero-action-buttons {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          align-items: center;
          gap: 12px;
          width: 100%;
        }

        .payslip-hero-action-buttons > .payslip-btn {
          flex: 0 0 auto;
        }

        .payslip-hero-action-buttons .payslip-pdf-actions {
          margin-top: 0;
        }

        .payslip-hero-action-feedbacks {
          display: grid;
          gap: 9px;
          width: 100%;
          min-width: 0;
          min-height: 0;
        }

        .payslip-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 46px;
          max-width: 100%;
          padding: 11px 16px;
          border: 1px solid transparent;
          border-radius: 16px;
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          line-height: 1;
          white-space: nowrap;
          cursor: pointer;
          transition:
            transform 180ms cubic-bezier(.22,1,.36,1),
            box-shadow 180ms ease,
            border-color 180ms ease,
            opacity 180ms ease,
            filter 180ms ease;
        }

        .payslip-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .payslip-btn:focus-visible,
        .payslip-module-link:focus-visible,
        .payslip-row:focus-visible,
        .payslip-feedback-close:focus-visible,
        .payslip-field input:focus-visible,
        .payslip-field select:focus-visible {
          outline: 3px solid rgba(79, 101, 215, .20);
          outline-offset: 3px;
        }

        .payslip-btn:disabled {
          cursor: not-allowed;
          opacity: .55;
          transform: none;
        }

        .payslip-btn-primary {
          color: #ffffff;
          background: linear-gradient(135deg, #4d7de1 0%, #29b3c2 100%);
          box-shadow:
            5px 6px 0 #51488f,
            0 13px 24px rgba(56, 82, 165, .16);
        }

        .payslip-btn-success {
          color: #ffffff;
          background: linear-gradient(135deg, #118760, #30ba9c);
          box-shadow: 4px 5px 0 #a8dfcf;
        }

        .payslip-btn-secondary {
          color: #40348d;
          border-color: rgba(86, 79, 190, .22);
          background: rgba(255, 255, 255, .94);
          box-shadow:
            4px 5px 0 #ddd7ff,
            0 11px 21px rgba(52, 43, 120, .08);
        }

        .payslip-feedback-zone {
          position: relative;
          z-index: 4;
          width: 100%;
          min-width: 0;
        }

        .payslip-hero-action-feedbacks .payslip-feedback {
          min-height: 62px;
          padding: 10px 11px;
          border-radius: 15px;
          box-shadow:
            4px 5px 0 rgba(184, 207, 244, .72),
            0 10px 20px rgba(34, 38, 110, .06);
        }

        .payslip-hero-action-feedbacks .payslip-feedback.success {
          box-shadow: 4px 5px 0 #b5e6d8;
        }

        .payslip-hero-action-feedbacks .payslip-feedback.warning {
          box-shadow: 4px 5px 0 #ffe0a3;
        }

        .payslip-hero-action-feedbacks .payslip-feedback.error {
          box-shadow: 4px 5px 0 #f2c2cd;
        }

        .payslip-hero-action-feedbacks .payslip-feedback.info {
          box-shadow: 4px 5px 0 #cbc4ff;
        }

        .payslip-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: start;
          gap: 10px;
          width: 100%;
          min-width: 0;
          padding: 12px 13px;
          border: 1px solid rgba(113, 133, 175, .26);
          border-radius: 16px;
          background: #eef6ff;
          box-shadow:
            4px 5px 0 rgba(184, 207, 244, .78),
            0 12px 24px rgba(34, 38, 110, .06);
          animation: payslip-feedback-in 180ms ease-out;
        }

        .payslip-feedback.success {
          color: #087659;
          border-color: rgba(21, 154, 112, .24);
          background: #e8f8f2;
          box-shadow: 4px 5px 0 #b5e6d8;
        }

        .payslip-feedback.warning {
          color: #966111;
          border-color: rgba(207, 146, 32, .28);
          background: #fff6df;
          box-shadow: 4px 5px 0 #ffe0a3;
        }

        .payslip-feedback.error {
          color: #a53d59;
          border-color: rgba(191, 76, 104, .24);
          background: #fff0f3;
          box-shadow: 4px 5px 0 #f2c2cd;
        }

        .payslip-feedback.info {
          color: #40348d;
          border-color: rgba(86, 79, 190, .22);
          background: #f0efff;
          box-shadow: 4px 5px 0 #cbc4ff;
        }

        .payslip-feedback-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 10px;
          background: rgba(255, 255, 255, .68);
        }

        .payslip-feedback-copy {
          display: grid;
          gap: 3px;
          min-width: 0;
          font-size: 11px;
          line-height: 1.45;
        }

        .payslip-feedback-copy strong {
          font-size: 11px;
          font-weight: 950;
        }

        .payslip-feedback-copy span {
          overflow-wrap: anywhere;
        }

        .payslip-feedback-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          padding: 0;
          border: 0;
          border-radius: 10px;
          color: currentColor;
          background: rgba(255, 255, 255, .58);
          cursor: pointer;
        }

        .payslip-feedback-inline {
          margin-top: 14px;
        }

        .payslip-module-links {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 15px;
        }

        .payslip-module-link {
          display: flex;
          align-items: center;
          gap: 11px;
          min-width: 0;
          min-height: 72px;
          padding: 15px 16px;
          border: 1px solid var(--payslip-border);
          border-radius: 20px;
          color: var(--payslip-ink);
          background: #e6f2ff;
          box-shadow:
            5px 6px 0 #b8d7ff,
            0 14px 24px rgba(34, 38, 110, .06);
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          text-align: left;
          cursor: pointer;
          transition:
            transform 180ms ease,
            box-shadow 180ms ease,
            border-color 180ms ease;
        }

        .payslip-module-link:nth-child(2) {
          background: #e7f8f2;
          box-shadow: 5px 6px 0 #b3e6d7;
        }

        .payslip-module-link:nth-child(3) {
          background: #fff2cf;
          box-shadow: 5px 6px 0 #ffdda0;
        }

        .payslip-module-link:nth-child(4) {
          background: #efecff;
          box-shadow: 5px 6px 0 #c8c0ff;
        }

        .payslip-module-link:hover {
          transform: translateY(-2px);
          border-color: rgba(81, 69, 216, .32);
        }

        .payslip-module-link svg {
          flex: 0 0 auto;
          color: var(--payslip-primary);
        }

        .payslip-module-link span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .payslip-panel {
          min-width: 0;
          padding: clamp(20px, 2.1vw, 28px);
          border: 1px solid var(--payslip-border);
          border-radius: 28px;
          background: #ffffff;
          box-shadow:
            8px 10px 0 #cbd2ff,
            0 23px 42px rgba(34, 38, 110, .08);
        }

        .payslip-filter-panel {
          background:
            linear-gradient(
              145deg,
              rgba(255,255,255,.99) 0%,
              rgba(247,249,255,.98) 100%
            );
        }

        .payslip-panel-heading,
        .payslip-section-head,
        .payslip-detail-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .payslip-panel-heading {
          margin-bottom: 18px;
        }

        .payslip-panel-heading h2,
        .payslip-section-head h2,
        .payslip-detail-head h2 {
          margin: 0;
          color: var(--payslip-heading);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-weight: 760;
          line-height: 1.08;
          letter-spacing: -.035em;
        }

        .payslip-panel-heading h2 {
          font-size: clamp(22px, 2vw, 30px);
        }

        .payslip-panel-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 38px;
          padding: 8px 12px;
          border: 1px solid rgba(81, 69, 216, .18);
          border-radius: 999px;
          color: #443c95;
          background: #f0efff;
          box-shadow: 3px 4px 0 #d5d0ff;
          font-size: 10px;
          font-weight: 950;
          white-space: nowrap;
        }

        .payslip-toolbar {
          display: grid;
          grid-template-columns: minmax(250px, 1.35fr) repeat(4, minmax(150px, .72fr));
          gap: 13px;
          align-items: end;
        }

        .payslip-field {
          display: grid;
          gap: 8px;
          min-width: 0;
        }

        .payslip-field label {
          color: #4e5d7c;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .payslip-field input,
        .payslip-field select {
          width: 100%;
          min-width: 0;
          min-height: 50px;
          padding: 10px 14px;
          border: 1px solid rgba(157, 170, 209, .66);
          border-radius: 16px;
          outline: none;
          color: var(--payslip-ink);
          background: #ffffff;
          font: inherit;
          font-size: 13px;
          transition:
            border-color 160ms ease,
            box-shadow 160ms ease,
            transform 160ms ease;
        }

        .payslip-field input:focus,
        .payslip-field select:focus {
          border-color: rgba(81, 69, 216, .64);
          box-shadow:
            0 0 0 4px rgba(81, 69, 216, .08),
            4px 5px 0 rgba(196, 204, 255, .52);
          transform: translateY(-1px);
        }

        .payslip-search {
          position: relative;
        }

        .payslip-search svg {
          position: absolute;
          z-index: 1;
          top: 50%;
          left: 15px;
          width: 18px;
          height: 18px;
          color: #6558dc;
          transform: translateY(-50%);
          pointer-events: none;
        }

        .payslip-search input {
          padding-left: 46px;
        }

        .payslip-metrics {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 15px;
        }

        .payslip-metric {
          container-type: inline-size;
          display: grid;
          align-content: start;
          min-width: 0;
          min-height: 145px;
          padding: 18px;
          overflow: hidden;
          border: 1px solid var(--payslip-border);
          border-radius: 22px;
          background: #e5f2ff;
          box-shadow:
            6px 7px 0 #afd4ff,
            0 15px 28px rgba(31, 41, 92, .06);
        }

        .payslip-metric:nth-child(2) {
          background: #e5f7f0;
          box-shadow: 6px 7px 0 #b1e5d6;
        }

        .payslip-metric:nth-child(3) {
          background: #fff0f3;
          box-shadow: 6px 7px 0 #f2c2cc;
        }

        .payslip-metric:nth-child(4) {
          background: #efecff;
          box-shadow: 6px 7px 0 #c8c0ff;
        }

        .payslip-metric:nth-child(5) {
          background: #fff2cf;
          box-shadow: 6px 7px 0 #ffdda0;
        }

        .payslip-metric:nth-child(6) {
          background: #e5f7f0;
          box-shadow: 6px 7px 0 #b1e5d6;
        }

        .payslip-metric-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 16px;
          color: #5f6b88;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .payslip-metric-head svg {
          flex: 0 0 auto;
          color: #5b50d4;
        }

        .payslip-metric strong {
          display: block;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          overflow: visible;
          color: var(--payslip-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(15px, 1.4vw, 28px);
          font-size: clamp(14px, 8.6cqi, 30px);
          font-weight: 760;
          font-variant-numeric: tabular-nums;
          line-height: 1.02;
          letter-spacing: -.045em;
          white-space: nowrap;
          word-break: keep-all;
        }

        .payslip-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.08fr) minmax(390px, .92fr);
          gap: 22px;
          align-items: start;
        }

        .payslip-main-grid > * {
          min-width: 0;
        }

        .payslip-section-head {
          align-items: center;
          margin-bottom: 18px;
        }

        .payslip-section-head h2 {
          margin-bottom: 5px;
          font-size: clamp(25px, 2.4vw, 35px);
        }

        .payslip-section-head p,
        .payslip-detail-head p {
          margin: 0;
          color: var(--payslip-muted);
          font-size: 12px;
          line-height: 1.5;
        }

        .payslip-list-panel {
          display: flex;
          flex-direction: column;
          min-height: 0;
          max-height: calc(100dvh - 36px);
          overflow: hidden;
        }

        .payslip-list-panel > .payslip-section-head,
        .payslip-list-panel > .payslip-feedback {
          flex: 0 0 auto;
        }

        .payslip-list {
          display: grid;
          gap: 14px;
          min-height: 0;
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 2px 7px 7px 2px;
          scrollbar-width: thin;
          scrollbar-color: rgba(101, 88, 220, .30) transparent;
        }

        .payslip-list::-webkit-scrollbar {
          width: 7px;
        }

        .payslip-list::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(101, 88, 220, .28);
        }

        .payslip-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(150px, auto);
          gap: 16px;
          align-items: center;
          min-width: 0;
          padding: 17px;
          border: 1px solid rgba(171, 181, 211, .58);
          border-radius: 20px;
          background: #f8fbff;
          box-shadow: 4px 5px 0 #dfe8f7;
          cursor: pointer;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease,
            background 170ms ease;
        }

        .payslip-row:nth-child(even) {
          background: #fbfaff;
        }

        .payslip-row:hover {
          border-color: rgba(81, 69, 216, .31);
          transform: translateY(-2px);
        }

        .payslip-row.is-selected {
          border-color: rgba(81, 69, 216, .55);
          background: linear-gradient(135deg, #eef5ff 0%, #f1efff 100%);
          box-shadow:
            5px 6px 0 #c9c0ff,
            0 13px 26px rgba(34, 38, 110, .07);
        }

        .payslip-row-title {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .payslip-row-title strong {
          min-width: 0;
          color: var(--payslip-ink);
          font-size: 14px;
          overflow-wrap: anywhere;
        }

        .payslip-row-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 7px 13px;
          color: var(--payslip-muted);
          font-size: 11px;
        }

        .payslip-row-meta span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .payslip-row-end {
          min-width: 180px;
          text-align: right;
        }

        .payslip-row-end strong {
          display: block;
          margin-bottom: 5px;
          color: var(--payslip-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 19px;
          white-space: nowrap;
        }

        .payslip-row-end small {
          display: block;
          color: var(--payslip-muted);
          font-size: 10px;
          line-height: 1.45;
          white-space: nowrap;
        }

        .payslip-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 28px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 950;
          white-space: nowrap;
        }

        .payslip-status-success {
          color: #087659;
          border: 1px solid rgba(24, 177, 126, .23);
          background: #e8f8f2;
        }

        .payslip-status-primary {
          color: #40348d;
          border: 1px solid rgba(81, 69, 216, .20);
          background: #efedff;
        }

        .payslip-status-blue {
          color: #245da8;
          border: 1px solid rgba(56, 111, 201, .20);
          background: #eaf3ff;
        }

        .payslip-status-warning {
          color: #93600e;
          border: 1px solid rgba(204, 142, 28, .24);
          background: #fff5dc;
        }

        .payslip-status-neutral {
          color: #56627c;
          border: 1px solid rgba(112, 126, 154, .18);
          background: #f2f5f9;
        }

        .payslip-pdf-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
        }

        .payslip-pdf-actions .payslip-btn {
          min-height: 38px;
          padding: 8px 11px;
          font-size: 10px;
        }

        .payslip-detail {
          position: sticky;
          top: 18px;
          min-width: 0;
          max-height: calc(100dvh - 36px);
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: rgba(101, 88, 220, .30) transparent;
        }

        .payslip-detail::-webkit-scrollbar,
        .payslip-timeline::-webkit-scrollbar {
          width: 7px;
        }

        .payslip-detail::-webkit-scrollbar-thumb,
        .payslip-timeline::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(101, 88, 220, .28);
        }

        .payslip-detail-head {
          position: sticky;
          z-index: 3;
          top: -1px;
          margin: -2px -2px 18px;
          padding: 16px 17px;
          border: 1px solid rgba(171, 181, 211, .48);
          border-radius: 19px;
          background:
            linear-gradient(
              90deg,
              rgba(231,247,255,.98) 0%,
              rgba(255,255,255,.98) 52%,
              rgba(240,236,255,.98) 100%
            );
          box-shadow:
            4px 5px 0 #d2d9ff,
            0 12px 24px rgba(34, 38, 110, .05);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        .payslip-detail-head h2 {
          margin-bottom: 5px;
          font-size: 24px;
          overflow-wrap: anywhere;
        }

        .payslip-detail-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 16px 0;
        }

        .payslip-detail-stat {
          min-width: 0;
          min-height: 92px;
          padding: 13px;
          border: 1px solid var(--payslip-soft-border);
          border-radius: 18px;
          background: #e7f2ff;
          box-shadow: 3px 4px 0 rgba(185, 215, 255, .58);
        }

        .payslip-detail-stat:nth-child(2) {
          background: #fff0f3;
        }

        .payslip-detail-stat:nth-child(3) {
          background: #fff3d4;
        }

        .payslip-detail-stat:nth-child(4) {
          background: #e7f8f2;
        }

        .payslip-detail-stat span,
        .payslip-info span {
          display: block;
          margin-bottom: 5px;
          color: #68738f;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .065em;
          text-transform: uppercase;
        }

        .payslip-detail-stat strong {
          display: block;
          min-width: 0;
          color: var(--payslip-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(14px, 1.15vw, 19px);
          font-weight: 760;
          line-height: 1.08;
          white-space: nowrap;
        }

        .payslip-subsection {
          margin-top: 18px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .44);
          border-radius: 19px;
          background: #fbfcff;
        }

        .payslip-subsection:nth-of-type(even) {
          background: #faf8ff;
        }

        .payslip-subsection h3 {
          margin: 0 0 13px;
          color: var(--payslip-heading);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(17px, 1.6vw, 21px);
          font-weight: 760;
        }

        .payslip-line-list {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }

        .payslip-line {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid var(--payslip-soft-border);
          border-radius: 13px;
          background: #fbfcff;
          font-size: 11px;
        }

        .payslip-line span {
          min-width: 0;
          color: var(--payslip-muted);
          overflow-wrap: anywhere;
        }

        .payslip-line strong {
          flex: 0 0 auto;
          color: var(--payslip-ink);
          text-align: right;
          white-space: nowrap;
        }

        .payslip-info-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
        }

        .payslip-info {
          min-width: 0;
          min-height: 72px;
          padding: 11px;
          border: 1px solid var(--payslip-soft-border);
          border-radius: 15px;
          background: #ffffff;
        }

        .payslip-info:nth-child(4n + 2) {
          background: #faf8ff;
        }

        .payslip-info:nth-child(4n + 3) {
          background: #f3fbf8;
        }

        .payslip-info:nth-child(4n + 4) {
          background: #fff9eb;
        }

        .payslip-info strong {
          display: block;
          min-width: 0;
          color: var(--payslip-ink);
          overflow-wrap: anywhere;
          font-size: 11px;
          line-height: 1.4;
        }

        .payslip-timeline {
          display: grid;
          gap: 0;
          max-height: 265px;
          overflow: auto;
          padding: 4px 13px;
          border: 1px solid var(--payslip-soft-border);
          border-radius: 15px;
          background: #fbfcff;
        }

        .payslip-timeline-item {
          padding: 11px 0;
          border-bottom: 1px solid rgba(226, 232, 240, .9);
        }

        .payslip-timeline-item:last-child {
          border-bottom: 0;
        }

        .payslip-timeline-item strong {
          display: block;
          margin-bottom: 3px;
          color: var(--payslip-ink);
          font-size: 11px;
        }

        .payslip-timeline-item p,
        .payslip-timeline-item small {
          display: block;
          margin: 0;
          color: var(--payslip-muted);
          font-size: 10px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .payslip-empty {
          display: grid;
          place-items: center;
          min-height: 220px;
          padding: 30px;
          border: 1px dashed rgba(81, 69, 216, .32);
          border-radius: 20px;
          color: var(--payslip-muted);
          background: linear-gradient(145deg, #f8f7ff, #eef8ff);
          text-align: center;
        }

        .payslip-empty strong {
          display: block;
          margin-bottom: 5px;
          color: var(--payslip-ink);
          font-size: 14px;
        }

        .payslip-empty p {
          margin: 0;
          font-size: 11px;
          line-height: 1.5;
        }

        .payslip-empty svg {
          margin-bottom: 10px;
          color: var(--payslip-primary);
        }

        .payslip-notice {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          min-width: 0;
          padding: 14px 15px;
          border: 1px solid rgba(81, 69, 216, .20);
          border-radius: 17px;
          color: #40348d;
          background: #f0efff;
          box-shadow: 4px 5px 0 #cbc4ff;
          font-size: 11px;
          line-height: 1.5;
          font-weight: 750;
        }

        .payslip-notice span {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .spin {
          animation: payslip-spin .85s linear infinite;
        }

        @keyframes payslip-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes payslip-feedback-in {
          from {
            opacity: 0;
            transform: translateY(-6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 1180px) {
          .payslip-metrics {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .payslip-toolbar {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .payslip-main-grid {
            grid-template-columns: 1fr;
          }

          .payslip-list-panel {
            max-height: none;
            overflow: visible;
          }

          .payslip-list {
            overflow: visible;
            padding-right: 2px;
          }

          .payslip-detail {
            position: static;
            max-height: none;
            overflow: visible;
            overscroll-behavior: auto;
          }

          .payslip-detail-head {
            position: static;
            top: auto;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
          }

          .payslip-detail-stats {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

          .payslip-info-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .payslip-line-list {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .payslip-metric strong {
            font-size: clamp(19px, 2.6vw, 30px);
          }
        }

        @media (max-width: 900px) {
          .payslips-page {
            width: min(100% - 28px, 1280px);
          }

          .payslip-hero {
            grid-template-columns: 1fr;
            min-height: 0;
          }

          .payslip-hero-actions {
            width: 100%;
            max-width: none;
            justify-items: stretch;
          }

          .payslip-hero-action-buttons {
            justify-content: flex-start;
          }

          .payslip-hero-action-feedbacks {
            width: min(100%, 560px);
          }

          .payslip-module-links {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .payslip-detail-stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .payslip-info-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .payslips-page {
            width: min(100% - 20px, 1280px);
            gap: 18px;
          }

          .payslip-hero {
            padding: 22px;
            border-radius: 26px;
            box-shadow:
              6px 7px 0 #b9d5ff,
              0 18px 30px rgba(34, 38, 110, .09);
          }

          .payslip-hero h1 {
            font-size: clamp(38px, 11vw, 54px);
          }

          .payslip-hero-actions {
            width: 100%;
          }

          .payslip-hero-action-buttons {
            display: grid;
            grid-template-columns: 1fr;
            width: 100%;
          }

          .payslip-hero-action-buttons > .payslip-btn,
          .payslip-hero-action-buttons .payslip-pdf-actions {
            width: 100%;
          }

          .payslip-hero-action-buttons .payslip-pdf-actions {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .payslip-hero-action-buttons .payslip-btn {
            width: 100%;
          }

          .payslip-hero-action-feedbacks {
            width: 100%;
          }

          .payslip-module-links,
          .payslip-metrics,
          .payslip-toolbar,
          .payslip-info-grid,
          .payslip-line-list {
            grid-template-columns: 1fr;
          }

          .payslip-metric strong {
            font-size: clamp(21px, 7.4vw, 30px);
          }

          .payslip-panel {
            padding: 18px;
            border-radius: 23px;
            box-shadow:
              5px 6px 0 #cbd2ff,
              0 17px 28px rgba(34, 38, 110, .07);
          }

          .payslip-panel-heading,
          .payslip-section-head,
          .payslip-detail-head {
            flex-direction: column;
            align-items: stretch;
          }

          .payslip-panel-count {
            align-self: flex-start;
          }

          .payslip-row {
            grid-template-columns: 1fr;
          }

          .payslip-row-end {
            min-width: 0;
            text-align: left;
          }

          .payslip-row-end small {
            white-space: normal;
          }

        }

        @media (max-width: 520px) {
          .payslips-page {
            width: calc(100% - 16px);
            gap: 15px;
          }

          .payslip-hero {
            padding: 18px;
            border-radius: 22px;
          }

          .payslip-kicker {
            font-size: 8px;
          }

          .payslip-hero h1 {
            font-size: clamp(34px, 12vw, 46px);
          }

          .payslip-panel {
            padding: 15px;
            border-radius: 20px;
          }

          .payslip-metric {
            min-height: 125px;
            padding: 16px;
          }

          .payslip-detail-stats {
            grid-template-columns: 1fr;
          }

          .payslip-pdf-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .payslip-pdf-actions .payslip-btn {
            width: 100%;
          }

          .payslip-hero-action-buttons .payslip-pdf-actions {
            grid-template-columns: 1fr;
          }

          .payslip-feedback {
            grid-template-columns: auto minmax(0, 1fr) auto;
            padding: 11px;
          }
        }

        @media (max-width: 390px) {
          .payslips-page {
            width: calc(100% - 12px);
          }

          .payslip-hero {
            padding: 16px;
          }

          .payslip-panel {
            padding: 13px;
          }

          .payslip-row {
            padding: 14px;
          }

          .payslip-btn {
            min-height: 44px;
            padding-inline: 13px;
          }
        }

        @media (hover: none) {
          .payslip-btn:hover:not(:disabled),
          .payslip-module-link:hover,
          .payslip-row:hover {
            transform: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .payslips-page *,
          .payslips-page *::before,
          .payslips-page *::after {
            animation: none !important;
            transition: none !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>

      <header className="payslip-hero">
        <div className="payslip-hero-content">
          <span className="payslip-kicker">
            <Sparkles size={14} />
            Payroll Documents
          </span>
          <h1>
            Payslips, <em>clearly organised.</em>
          </h1>
          <p>
            {privileged
              ? 'Review immutable employee payroll snapshots, release stages, tax and TDS context, deductions, reimbursements, bank details and generated PDF payslips.'
              : 'View your released monthly payroll snapshots and securely preview or download your generated payslip PDF.'}
          </p>
        </div>

        <div className="payslip-hero-actions">
          <div className="payslip-hero-action-buttons">
            <button
              type="button"
              className="payslip-btn payslip-btn-secondary"
              onClick={handleManualRefresh}
              disabled={loadingEmployees || loadingPayslips}
            >
              {loadingEmployees || loadingPayslips ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <RefreshCw size={17} />
              )}
              Refresh
            </button>

            {selectedPayslip ? renderPdfActions(selectedPayslip) : null}
          </div>

          {feedback.actions || feedback.pdf ? (
            <div className="payslip-hero-action-feedbacks">
              {feedback.actions ? (
                <div className="payslip-feedback-zone">
                  <PayslipFeedbackLine
                    feedback={feedback.actions}
                    onClose={() => clearPayslipFeedback('actions')}
                  />
                </div>
              ) : null}

              {feedback.pdf ? (
                <div className="payslip-feedback-zone">
                  <PayslipFeedbackLine
                    feedback={feedback.pdf}
                    onClose={() => clearPayslipFeedback('pdf')}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {privileged ? (
        <section className="payslip-module-links" aria-label="Payroll navigation">
          <button
            type="button"
            className="payslip-module-link"
            onClick={() => setPage('payroll_runs')}
          >
            <WalletCards size={18} />
            <span>Payroll Runs</span>
          </button>

          <button
            type="button"
            className="payslip-module-link"
            onClick={() => setPage('payroll_reports')}
          >
            <FileText size={18} />
            <span>Payroll Reports</span>
          </button>

          <button
            type="button"
            className="payslip-module-link"
            onClick={() => setPage('payroll_banking')}
          >
            <Landmark size={18} />
            <span>Payroll Banking</span>
          </button>

          <button
            type="button"
            className="payslip-module-link"
            onClick={() => setPage('tax_declarations')}
          >
            <ShieldCheck size={18} />
            <span>Tax Declarations & TDS</span>
          </button>
        </section>
      ) : (
        <div className="payslip-notice">
          <ShieldCheck size={18} />
          <span>
            Employee access is restricted to your own Locked or Disbursed
            payslips. Draft, HR-review and Finance-approval records remain
            private until payroll is released.
          </span>
        </div>
      )}

      <section className="payslip-panel payslip-filter-panel">
        <div className="payslip-panel-heading">
          <div>
            <span className="payslip-section-kicker">Payslip filters</span>
            <h2>Find the payroll document you need</h2>
          </div>
          <span className="payslip-panel-count">
            {visiblePayslips.length} result{visiblePayslips.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="payslip-toolbar">
          <div className="payslip-field">
            <label htmlFor="payslip-search">Search</label>
            <div className="payslip-search">
              <Search size={16} />
              <input
                id="payslip-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Employee, code, department, stage or TDS mode"
              />
            </div>
          </div>

          <div className="payslip-field">
            <label htmlFor="payslip-period">Payroll month</label>
            <input
              id="payslip-period"
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            />
          </div>

          {privileged ? (
            <div className="payslip-field">
              <label htmlFor="payslip-status">Payroll stage</label>
              <select
                id="payslip-status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value || 'all'} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {privileged ? (
            <div className="payslip-field">
              <label htmlFor="payslip-employee">Employee</label>
              <select
                id="payslip-employee"
                value={employeeReference}
                onChange={(event) => setEmployeeReference(event.target.value)}
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

          {superAdmin ? (
            <div className="payslip-field">
              <label htmlFor="payslip-tenant">Company tenant ID</label>
              <input
                id="payslip-tenant"
                type="text"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder="Example: sds"
              />
            </div>
          ) : null}
        </div>

        <PayslipFeedbackLine
          feedback={feedback.filters}
          onClose={() => clearPayslipFeedback('filters')}
          className="payslip-feedback-inline"
        />
      </section>

      <section className="payslip-metrics">
        <article className="payslip-metric">
          <div className="payslip-metric-head">
            <span>Payslips</span>
            <FileText size={17} />
          </div>
          <strong>{metrics.total}</strong>
        </article>

        <article className="payslip-metric">
          <div className="payslip-metric-head">
            <span>Gross payable</span>
            <IndianRupee size={17} />
          </div>
          <strong>{formatCurrency(metrics.gross)}</strong>
        </article>

        <article className="payslip-metric">
          <div className="payslip-metric-head">
            <span>Deductions</span>
            <Banknote size={17} />
          </div>
          <strong>{formatCurrency(metrics.deductions)}</strong>
        </article>

        <article className="payslip-metric">
          <div className="payslip-metric-head">
            <span>Net payable</span>
            <WalletCards size={17} />
          </div>
          <strong>{formatCurrency(metrics.net)}</strong>
        </article>

        <article className="payslip-metric">
          <div className="payslip-metric-head">
            <span>Released</span>
            <BadgeCheck size={17} />
          </div>
          <strong>{metrics.released}</strong>
        </article>

        <article className="payslip-metric">
          <div className="payslip-metric-head">
            <span>Disbursed</span>
            <CheckCircle2 size={17} />
          </div>
          <strong>{metrics.disbursed}</strong>
        </article>
      </section>

      <div className="payslip-main-grid">
        <section className="payslip-panel payslip-list-panel">
          <div className="payslip-section-head">
            <div>
              <h2>{periodLabel(period)} Payslips</h2>
              <p>
                {visiblePayslips.length} matching payslip
                {visiblePayslips.length === 1 ? '' : 's'}
              </p>
            </div>

            {loadingPayslips ? (
              <Loader2 size={20} className="spin" />
            ) : null}
          </div>

          <PayslipFeedbackLine
            feedback={feedback.results}
            onClose={() => clearPayslipFeedback('results')}
            className="payslip-feedback-inline"
          />

          {visiblePayslips.length ? (
            <div className="payslip-list">
              {visiblePayslips.map((payslip) => {
                const totals = payslipTotals(payslip);
                const selected =
                  recordId(payslip) === recordId(selectedPayslip);

                return (
                  <article
                    key={recordId(payslip)}
                    className={`payslip-row ${
                      selected ? 'is-selected' : ''
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedPayslip(payslip)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedPayslip(payslip);
                      }
                    }}
                  >
                    <div>
                      <div className="payslip-row-title">
                        <strong>
                          {safeText(
                            payslip.employee_name ||
                              payslip.employee_info?.name,
                            'Employee',
                          )}
                        </strong>
                        <span
                          className={`payslip-status payslip-status-${statusTone(
                            payslip.status,
                          )}`}
                        >
                          {statusLabel(payslip.status)}
                        </span>
                      </div>

                      <div className="payslip-row-meta">
                        <span>
                          <UserRound size={13} />
                          {safeText(
                            payslip.employee_code ||
                              payslip.employee_info?.employee_code,
                          )}
                        </span>
                        <span>
                          <CalendarDays size={13} />
                          {periodLabel(payslipPeriod(payslip))}
                        </span>
                        <span>
                          <ShieldCheck size={13} />
                          TDS: {statusLabel(tdsMode(payslip))}
                        </span>
                      </div>

                      {renderPdfActions(payslip)}
                    </div>

                    <div className="payslip-row-end">
                      <strong>{formatCurrency(totals.net_amount)}</strong>
                      <small>
                        Gross:{' '}
                        {formatCurrency(
                          totals.payable_gross_salary ??
                            totals.gross_salary,
                        )}
                      </small>
                      <small>
                        Deductions:{' '}
                        {formatCurrency(totals.total_deductions)}
                      </small>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="payslip-empty">
              <div>
                <FileText size={34} />
                <strong>No payslips found</strong>
                <p>
                  Change the payroll month or filters, then refresh the page.
                </p>
              </div>
            </div>
          )}
        </section>

        <aside className="payslip-panel payslip-detail">
          {selectedPayslip ? (
            <>
              <div className="payslip-detail-head">
                <div>
                  <h2>
                    {safeText(
                      selectedPayslip.employee_name ||
                        selectedPayslip.employee_info?.name,
                      'Employee Payslip',
                    )}
                  </h2>
                  <p>
                    {safeText(
                      selectedPayslip.employee_code ||
                        selectedPayslip.employee_info?.employee_code,
                    )}{' '}
                    · {periodLabel(payslipPeriod(selectedPayslip))}
                  </p>
                </div>

                <span
                  className={`payslip-status payslip-status-${statusTone(
                    selectedPayslip.status,
                  )}`}
                >
                  {statusLabel(selectedPayslip.status)}
                </span>
              </div>

              <div className="payslip-detail-stats">
                <article className="payslip-detail-stat">
                  <span>Gross payable</span>
                  <strong>
                    {formatCurrency(
                      selectedTotals.payable_gross_salary ??
                        selectedTotals.gross_salary,
                    )}
                  </strong>
                </article>

                <article className="payslip-detail-stat">
                  <span>Total deductions</span>
                  <strong>
                    {formatCurrency(selectedTotals.total_deductions)}
                  </strong>
                </article>

                <article className="payslip-detail-stat">
                  <span>Reimbursements</span>
                  <strong>
                    {formatCurrency(reimbursementTotal(selectedPayslip))}
                  </strong>
                </article>

                <article className="payslip-detail-stat">
                  <span>Net payable</span>
                  <strong>
                    {formatCurrency(selectedTotals.net_amount)}
                  </strong>
                </article>
              </div>

              {renderPdfActions(selectedPayslip)}

              <section className="payslip-subsection">
                <h3>Attendance Snapshot</h3>
                <div className="payslip-info-grid">
                  <article className="payslip-info">
                    <span>Total days</span>
                    <strong>
                      {safeText(selectedPayslip.attendance?.total_days, '0')}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Working days</span>
                    <strong>
                      {safeText(
                        selectedPayslip.attendance?.working_days,
                        '0',
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Paid leave</span>
                    <strong>
                      {safeText(
                        selectedPayslip.attendance?.paid_leave_days,
                        '0',
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>LWP days</span>
                    <strong>
                      {safeText(selectedPayslip.attendance?.lwp_days, '0')}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Payable days</span>
                    <strong>
                      {safeText(
                        selectedPayslip.attendance?.payable_days ||
                          selectedPayslip.attendance?.salary_paid_days,
                        '0',
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Attendance source</span>
                    <strong>
                      {statusLabel(
                        selectedPayslip.attendance?.source || 'saved',
                      )}
                    </strong>
                  </article>
                </div>
              </section>

              <section className="payslip-subsection">
                <h3>Earnings</h3>
                <div className="payslip-line-list">
                  {(selectedPayslip.earnings || []).length ? (
                    selectedPayslip.earnings.map((line, index) => (
                      <div
                        className="payslip-line"
                        key={`${line.code || line.label || 'earning'}-${index}`}
                      >
                        <span>{lineLabel(line)}</span>
                        <strong>{formatCurrency(lineAmount(line))}</strong>
                      </div>
                    ))
                  ) : (
                    <div className="payslip-line">
                      <span>No earning lines</span>
                      <strong>—</strong>
                    </div>
                  )}
                </div>
              </section>

              <section className="payslip-subsection">
                <h3>Deductions</h3>
                <div className="payslip-line-list">
                  {(selectedPayslip.deductions || []).length ? (
                    selectedPayslip.deductions.map((line, index) => (
                      <div
                        className="payslip-line"
                        key={`${line.code || line.label || 'deduction'}-${index}`}
                      >
                        <span>{lineLabel(line)}</span>
                        <strong>{formatCurrency(lineAmount(line))}</strong>
                      </div>
                    ))
                  ) : (
                    <div className="payslip-line">
                      <span>No deduction lines</span>
                      <strong>—</strong>
                    </div>
                  )}
                </div>
              </section>

              <section className="payslip-subsection">
                <h3>Tax & TDS Snapshot</h3>
                <div className="payslip-info-grid">
                  <article className="payslip-info">
                    <span>TDS mode</span>
                    <strong>{statusLabel(tdsMode(selectedPayslip))}</strong>
                  </article>
                  <article className="payslip-info">
                    <span>TDS amount</span>
                    <strong>{formatCurrency(selectedTotals.tds)}</strong>
                  </article>
                  <article className="payslip-info">
                    <span>Declaration status</span>
                    <strong>
                      {statusLabel(
                        selectedTaxDeclaration.status || 'not_found',
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Tax regime</span>
                    <strong>
                      {statusLabel(
                        selectedTaxDeclaration.tax_regime ||
                          'not_selected',
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Instruction effective</span>
                    <strong>
                      {safeText(
                        selectedTdsInstruction.effective_from_period,
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>External reference</span>
                    <strong>
                      {safeText(
                        selectedTdsInstruction.external_reference,
                      )}
                    </strong>
                  </article>
                </div>
              </section>

              <section className="payslip-subsection">
                <h3>Bank & Disbursement</h3>
                <div className="payslip-info-grid">
                  <article className="payslip-info">
                    <span>Bank</span>
                    <strong>
                      {safeText(
                        selectedBank.bank_name ||
                          selectedPayslip.employee_info?.bank_name,
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Account</span>
                    <strong>
                      {safeText(
                        selectedBank.masked_account_number ||
                          selectedBank.account_number_masked ||
                          selectedPayslip.employee_info
                            ?.masked_account_number,
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>IFSC</span>
                    <strong>
                      {safeText(
                        selectedBank.ifsc_code ||
                          selectedPayslip.employee_info?.ifsc_code,
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Transfer mode</span>
                    <strong>
                      {statusLabel(
                        selectedTransfer.transfer_mode || 'not_recorded',
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Transfer date</span>
                    <strong>
                      {formatDate(
                        selectedTransfer.transfer_date,
                        false,
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Reference</span>
                    <strong>
                      {safeText(
                        selectedTransfer.transfer_reference ||
                          selectedTransfer.reference ||
                          selectedTransfer.utr_number,
                      )}
                    </strong>
                  </article>
                </div>
              </section>

              <section className="payslip-subsection">
                <h3>Immutable Calculation Record</h3>
                <div className="payslip-info-grid">
                  <article className="payslip-info">
                    <span>Salary structure version</span>
                    <strong>
                      {safeText(
                        selectedPayslip.salary_structure_version,
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Statutory version</span>
                    <strong>
                      {safeText(
                        selectedPayslip.statutory_config_version,
                      )}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Calculation version</span>
                    <strong>
                      {safeText(selectedPayslip.calculation_version)}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Calculated at</span>
                    <strong>
                      {formatDate(selectedPayslip.calculated_at)}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>Calculated by</span>
                    <strong>
                      {safeText(selectedPayslip.calculated_by_name)}
                    </strong>
                  </article>
                  <article className="payslip-info">
                    <span>PDF generated</span>
                    <strong>
                      {selectedPayslip.pdf_generated_at
                        ? formatDate(selectedPayslip.pdf_generated_at)
                        : 'Not generated yet'}
                    </strong>
                  </article>
                </div>
              </section>

              {Array.isArray(selectedPayslip.workflow_history) &&
              selectedPayslip.workflow_history.length ? (
                <section className="payslip-subsection">
                  <h3>Payroll Workflow</h3>
                  <div className="payslip-timeline">
                    {[...selectedPayslip.workflow_history]
                      .reverse()
                      .map((entry, index) => (
                        <article
                          className="payslip-timeline-item"
                          key={`${safeText(entry.at, index)}-${index}`}
                        >
                          <strong>
                            {statusLabel(entry.action || entry.to_status)}
                          </strong>
                          <p>
                            {safeText(entry.actor_name, 'System')} ·{' '}
                            {formatDate(entry.at)}
                          </p>
                          {entry.note ? <small>{entry.note}</small> : null}
                        </article>
                      ))}
                  </div>
                </section>
              ) : null}

              {(selectedPayslip.warnings || []).length ? (
                <section className="payslip-subsection">
                  <div className="payslip-notice">
                    <AlertTriangle size={18} />
                    <span>
                      {(selectedPayslip.warnings || [])
                        .map((warning) =>
                          typeof warning === 'string'
                            ? warning
                            : safeText(
                                warning.message || warning.code,
                                'Payroll warning',
                              ),
                        )
                        .join(' • ')}
                    </span>
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <div className="payslip-empty">
              <div>
                <FileText size={34} />
                <strong>Select a payslip</strong>
                <p>
                  Select a monthly payslip to review its immutable payroll
                  snapshot and PDF.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}