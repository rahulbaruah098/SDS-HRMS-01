import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';

import { api, getApiUrl, getToken } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

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

export default function Payslips({ user = {}, setPage = () => {} }) {
  const alerts = useCustomAlert();
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

  function tenantParams() {
    if (!superAdmin || !tenantId.trim()) {
      return {};
    }

    return { tenant_id: tenantId.trim() };
  }

  function assertTenant() {
    if (superAdmin && !tenantId.trim()) {
      alerts.warning(
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

      if (!silent) {
        alerts.error(
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
      alerts.warning(
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
        alerts.warning(
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
          --payslip-muted: #5d6d8d;
          --payslip-primary: #6658dc;
          --payslip-primary-dark: #40348d;
          --payslip-blue: #3766db;
          --payslip-cyan: #18b5c8;
          --payslip-teal: #34c9c4;
          --payslip-yellow: #d8ff43;
          --payslip-border: rgba(16, 26, 58, .14);
          --payslip-card: #ffffff;
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          min-width: 0;
          color: var(--payslip-ink);
        }

        .payslips-page * {
          box-sizing: border-box;
        }

        .payslip-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: clamp(22px, 3vw, 40px);
          min-height: 275px;
          padding: clamp(25px, 3vw, 42px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background:
            radial-gradient(circle at 8% 6%, rgba(105, 217, 208, .26), transparent 29%),
            radial-gradient(circle at 95% 4%, rgba(153, 164, 245, .24), transparent 31%),
            linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%);
          box-shadow:
            12px 14px 0 #c6d8f7,
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .payslip-hero::before {
          content: "";
          position: absolute;
          z-index: -1;
          width: 175px;
          height: 175px;
          right: 8%;
          bottom: -98px;
          border-radius: 38% 62% 58% 42% / 48% 43% 57% 52%;
          background: linear-gradient(
            145deg,
            rgba(105, 217, 208, .30),
            rgba(132, 181, 241, .28)
          );
          transform: rotate(-18deg);
        }

        .payslip-hero-content,
        .payslip-hero-actions {
          position: relative;
          z-index: 1;
        }

        .payslip-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          margin-bottom: 15px;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          box-shadow: 4px 5px 0 #18b5c8;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .payslip-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--payslip-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 77px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .payslip-hero h1 em {
          color: var(--payslip-primary);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .payslip-hero p {
          max-width: 840px;
          margin: 17px 0 0;
          color: var(--payslip-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .payslip-hero-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }

        .payslip-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 44px;
          padding: 10px 15px;
          border: 1px solid transparent;
          border-radius: 15px;
          font: inherit;
          font-size: 13px;
          font-weight: 900;
          line-height: 1;
          cursor: pointer;
          transition:
            transform 190ms cubic-bezier(.22,1,.36,1),
            box-shadow 190ms ease,
            background 190ms ease,
            opacity 190ms ease,
            filter 190ms ease;
        }

        .payslip-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .payslip-btn:disabled {
          cursor: not-allowed;
          opacity: .55;
        }

        .payslip-btn-primary {
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36, 74, 128, .16);
        }

        .payslip-btn-success {
          color: #fff;
          background: linear-gradient(135deg, #16835f, #34c9c4);
          box-shadow: 4px 5px 0 #aee6d9;
        }

        .payslip-btn-secondary {
          color: #40348d;
          background: rgba(255,255,255,.92);
          border-color: rgba(65,55,161,.18);
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

        .payslip-module-links {
          display: grid;
          grid-template-columns: repeat(4, minmax(150px, 1fr));
          gap: 13px;
        }

        .payslip-module-link {
          display: flex;
          align-items: center;
          gap: 11px;
          min-width: 0;
          min-height: 64px;
          padding: 13px 15px;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 19px;
          background: #edf6ff;
          color: var(--payslip-ink);
          box-shadow: 5px 6px 0 #b9d7ff;
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          text-align: left;
          cursor: pointer;
          transition:
            transform 190ms ease,
            border-color 190ms ease,
            box-shadow 190ms ease;
        }

        .payslip-module-link:nth-child(2) {
          background: #eaf8f4;
          box-shadow: 5px 6px 0 #aee6d9;
        }

        .payslip-module-link:nth-child(3) {
          background: #fff4d5;
          box-shadow: 5px 6px 0 #ffe0a5;
        }

        .payslip-module-link:nth-child(4) {
          background: #f1efff;
          box-shadow: 5px 6px 0 #c9c0ff;
        }

        .payslip-module-link:hover {
          transform: translateY(-3px);
          border-color: rgba(102,88,220,.30);
        }

        .payslip-module-link svg {
          flex: 0 0 auto;
          color: var(--payslip-primary);
          animation: payslip-icon-float 3.2s ease-in-out infinite;
        }

        .payslip-module-link:nth-child(2) svg { animation-delay: -.7s; }
        .payslip-module-link:nth-child(3) svg { animation-delay: -1.4s; }
        .payslip-module-link:nth-child(4) svg { animation-delay: -2.1s; }

        .payslip-module-link span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .payslip-panel {
          min-width: 0;
          padding: clamp(20px, 2vw, 28px);
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.10);
          transition:
            transform 210ms cubic-bezier(.22,1,.36,1),
            box-shadow 210ms ease,
            border-color 210ms ease;
        }

        .payslip-panel:hover {
          border-color: rgba(102,88,220,.28);
          transform: translateY(-3px);
          box-shadow:
            10px 12px 0 #c4ccff,
            0 30px 50px rgba(34,38,110,.14);
        }

        .payslip-toolbar {
          display: grid;
          grid-template-columns: minmax(240px, 1.2fr) repeat(4, minmax(150px, .7fr));
          gap: 12px;
          align-items: end;
        }

        .payslip-field {
          display: grid;
          gap: 8px;
          min-width: 0;
        }

        .payslip-field label {
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .payslip-field input,
        .payslip-field select {
          width: 100%;
          min-width: 0;
          min-height: 47px;
          padding: 10px 13px;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 15px;
          outline: none;
          background: rgba(255,255,255,.94);
          color: var(--payslip-ink);
          font: inherit;
          font-size: 14px;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease;
        }

        .payslip-field input:focus,
        .payslip-field select:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow:
            4px 5px 0 rgba(102,88,220,.14),
            0 0 0 4px rgba(102,88,220,.08);
          transform: translateY(-1px);
        }

        .payslip-search {
          position: relative;
        }

        .payslip-search svg {
          position: absolute;
          top: 50%;
          left: 12px;
          color: var(--payslip-primary);
          transform: translateY(-50%);
          pointer-events: none;
        }

        .payslip-search input {
          padding-left: 38px;
        }

        .payslip-metrics {
          display: grid;
          grid-template-columns: repeat(6, minmax(140px, 1fr));
          gap: 13px;
        }

        .payslip-metric {
          min-width: 0;
          padding: 17px;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 20px;
          background: #edf6ff;
          box-shadow: 5px 6px 0 #b9d7ff;
          transition: transform 190ms ease;
        }

        .payslip-metric:nth-child(2) {
          background: #eaf8f4;
          box-shadow: 5px 6px 0 #aee6d9;
        }

        .payslip-metric:nth-child(3) {
          background: #fff0f2;
          box-shadow: 5px 6px 0 #f2c2cc;
        }

        .payslip-metric:nth-child(4) {
          background: #f1efff;
          box-shadow: 5px 6px 0 #c9c0ff;
        }

        .payslip-metric:nth-child(5) {
          background: #fff4d5;
          box-shadow: 5px 6px 0 #ffe0a5;
        }

        .payslip-metric:nth-child(6) {
          background: #eaf8f4;
          box-shadow: 5px 6px 0 #aee6d9;
        }

        .payslip-metric:hover {
          transform: translateY(-3px);
        }

        .payslip-metric-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .payslip-metric-head svg {
          color: var(--payslip-primary);
          animation: payslip-icon-float 3.2s ease-in-out infinite;
        }

        .payslip-metric strong {
          display: block;
          overflow: hidden;
          color: var(--payslip-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(21px, 2.2vw, 31px);
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .payslip-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.28fr) minmax(360px, .72fr);
          gap: 22px;
          align-items: start;
        }

        .payslip-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 16px;
        }

        .payslip-section-head h2,
        .payslip-section-head h3,
        .payslip-detail-head h2 {
          margin: 0 0 5px;
          color: var(--payslip-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-weight: 760;
          letter-spacing: -.04em;
        }

        .payslip-section-head h2 {
          font-size: clamp(25px, 2.3vw, 36px);
        }

        .payslip-section-head p,
        .payslip-detail-head p {
          margin: 0;
          color: var(--payslip-muted);
          font-size: 13px;
          line-height: 1.5;
        }

        .payslip-list {
          display: grid;
          gap: 13px;
        }

        .payslip-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px;
          padding: 16px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 19px;
          background: #fff;
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
          cursor: pointer;
          transition:
            border-color 190ms ease,
            box-shadow 190ms ease,
            transform 190ms ease;
        }

        .payslip-row:hover {
          border-color: rgba(102,88,220,.30);
          transform: translateY(-2px);
        }

        .payslip-row.is-selected {
          border-color: rgba(102,88,220,.65);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          box-shadow:
            5px 6px 0 #c9c0ff,
            0 15px 30px rgba(34,38,110,.10);
        }

        .payslip-row-title {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-bottom: 7px;
        }

        .payslip-row-title strong {
          color: var(--payslip-ink);
          font-size: 15px;
        }

        .payslip-row-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 7px 14px;
          color: var(--payslip-muted);
          font-size: 12px;
        }

        .payslip-row-meta span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .payslip-row-end {
          min-width: 175px;
          text-align: right;
        }

        .payslip-row-end strong {
          display: block;
          margin-bottom: 4px;
          color: var(--payslip-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: 20px;
        }

        .payslip-row-end small {
          display: block;
          color: var(--payslip-muted);
          font-size: 11px;
        }

        .payslip-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
          box-shadow: 2px 3px 0 rgba(52,43,120,.07);
        }

        .payslip-status-success {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 2px 3px 0 #aee6d9;
        }

        .payslip-status-primary {
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
        }

        .payslip-status-blue {
          color: #245da8;
          background: #edf6ff;
          box-shadow: 2px 3px 0 #b9d7ff;
        }

        .payslip-status-warning {
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 2px 3px 0 #ffe0a5;
        }

        .payslip-status-neutral {
          color: #475569;
          background: #f1f5f9;
          box-shadow: 2px 3px 0 #dbe1e8;
        }

        .payslip-pdf-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 13px;
        }

        .payslip-pdf-actions .payslip-btn {
          min-height: 36px;
          padding: 8px 11px;
          font-size: 12px;
        }

        .payslip-detail {
          position: sticky;
          top: 18px;
          min-width: 0;
        }

        .payslip-detail-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 15px;
          border-bottom: 1px solid rgba(171,181,211,.48);
        }

        .payslip-detail-head h2 {
          font-size: 24px;
        }

        .payslip-detail-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 15px 0;
        }

        .payslip-detail-stat {
          min-width: 0;
          padding: 13px;
          border: 1px solid rgba(171,181,211,.46);
          border-radius: 16px;
          background: #edf6ff;
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .payslip-detail-stat:nth-child(2) {
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .payslip-detail-stat:nth-child(3) {
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .payslip-detail-stat:nth-child(4) {
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .payslip-detail-stat span {
          display: block;
          margin-bottom: 5px;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .payslip-detail-stat strong {
          display: block;
          overflow: hidden;
          color: var(--payslip-ink);
          font-size: 14px;
          text-overflow: ellipsis;
        }

        .payslip-subsection {
          margin-top: 18px;
        }

        .payslip-subsection h3 {
          margin: 0 0 10px;
          color: var(--payslip-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 17px;
          font-weight: 760;
        }

        .payslip-line-list {
          display: grid;
          gap: 8px;
        }

        .payslip-line {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 11px;
          border: 1px solid rgba(171,181,211,.48);
          border-radius: 13px;
          background: rgba(255,255,255,.88);
          box-shadow: 2px 3px 0 rgba(52,43,120,.06);
          font-size: 12px;
        }

        .payslip-line span {
          color: var(--payslip-muted);
        }

        .payslip-line strong {
          color: var(--payslip-ink);
          text-align: right;
        }

        .payslip-info-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
        }

        .payslip-info {
          min-width: 0;
          padding: 11px;
          border: 1px solid rgba(171,181,211,.48);
          border-radius: 13px;
          background: rgba(255,255,255,.88);
          box-shadow: 2px 3px 0 rgba(52,43,120,.06);
        }

        .payslip-info span {
          display: block;
          margin-bottom: 5px;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .payslip-info strong {
          display: block;
          color: var(--payslip-ink);
          overflow-wrap: anywhere;
          font-size: 12px;
        }

        .payslip-timeline {
          display: grid;
          gap: 0;
          max-height: 270px;
          overflow: auto;
          padding: 4px 13px;
          border: 1px solid rgba(171,181,211,.48);
          border-radius: 15px;
          background: rgba(255,255,255,.88);
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .payslip-timeline-item {
          padding: 11px 0;
          border-bottom: 1px solid rgba(226,232,240,.9);
        }

        .payslip-timeline-item:last-child {
          border-bottom: 0;
        }

        .payslip-timeline-item strong {
          display: block;
          margin-bottom: 3px;
          color: var(--payslip-ink);
          font-size: 12px;
        }

        .payslip-timeline-item p,
        .payslip-timeline-item small {
          display: block;
          margin: 0;
          color: var(--payslip-muted);
          font-size: 11px;
          line-height: 1.45;
        }

        .payslip-empty {
          display: grid;
          place-items: center;
          min-height: 220px;
          padding: 30px;
          border: 1px dashed rgba(102,88,220,.34);
          border-radius: 20px;
          color: var(--payslip-muted);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          box-shadow: 4px 5px 0 rgba(52,43,120,.07);
          text-align: center;
        }

        .payslip-empty svg {
          margin-bottom: 10px;
          color: var(--payslip-primary);
        }

        .payslip-notice {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 13px 14px;
          border: 1px solid rgba(102,88,220,.20);
          border-radius: 15px;
          background: linear-gradient(145deg, #f1efff, #eef9ff);
          color: #40348d;
          box-shadow: 4px 5px 0 #c9c0ff;
          font-size: 12px;
          line-height: 1.5;
          font-weight: 750;
        }

        .spin {
          animation: payslip-spin .9s linear infinite;
        }

        @keyframes payslip-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes payslip-icon-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-3px) rotate(-3deg); }
        }

        @media (max-width: 1240px) {
          .payslip-metrics {
            grid-template-columns: repeat(3, minmax(140px, 1fr));
          }

          .payslip-toolbar {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .payslip-main-grid {
            grid-template-columns: 1fr;
          }

          .payslip-detail {
            position: static;
          }
        }

        @media (max-width: 900px) {
          .payslip-module-links {
            grid-template-columns: repeat(2, minmax(150px, 1fr));
          }
        }

        @media (max-width: 720px) {
          .payslips-page {
            gap: 18px;
          }

          .payslip-hero {
            grid-template-columns: 1fr;
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow:
              6px 7px 0 #c6d8f7,
              0 18px 30px rgba(34,38,110,.10);
          }

          .payslip-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .payslip-hero-actions {
            width: 100%;
            justify-content: stretch;
          }

          .payslip-hero-actions .payslip-btn {
            flex: 1;
          }

          .payslip-module-links,
          .payslip-metrics,
          .payslip-toolbar,
          .payslip-info-grid {
            grid-template-columns: 1fr;
          }

          .payslip-panel {
            padding: 18px;
            border-radius: 22px;
            box-shadow:
              5px 6px 0 #c4ccff,
              0 17px 28px rgba(34,38,110,.09);
          }

          .payslip-row {
            grid-template-columns: 1fr;
          }

          .payslip-row-end {
            text-align: left;
          }

          .payslip-detail-head {
            flex-direction: column;
          }
        }

        @media (max-width: 430px) {
          .payslip-hero {
            padding: 16px;
          }

          .payslip-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .payslip-panel {
            padding: 15px;
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
        }

        @media (prefers-reduced-motion: reduce) {
          .payslips-page *,
          .payslips-page *::before,
          .payslips-page *::after {
            animation: none !important;
            transition: none !important;
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
          <button
            type="button"
            className="payslip-btn payslip-btn-secondary"
            onClick={() => refreshAll()}
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

      <section className="payslip-panel">
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
        <section className="payslip-panel">
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