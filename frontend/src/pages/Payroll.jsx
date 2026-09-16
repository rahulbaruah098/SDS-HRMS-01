import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Banknote,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileText,
  IndianRupee,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  WalletCards,
  X,
} from 'lucide-react';

import { api, getApiUrl, getToken } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DEFAULT_LIMIT = 500;
const TABLE_PAGE_SIZE = 8;
const PAYROLL_NOTICE_HIDE_MS = 3600;

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

const HR_PAYROLL_REVIEW_ROLES = new Set([
  'hr',
  'hr_admin',
  'hr_manager',
]);

const FINANCE_PAYROLL_WORKFLOW_ROLES = new Set([
  'finance',
  'accounts_finance',
]);

function todayInputValue() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function emptyPayrollDisbursement() {
  return {
    transfer_date: todayInputValue(),
    transfer_mode: 'NEFT',
    transaction_reference: '',
    bank_file_reference: '',
  };
}

function canonicalPayrollStatus(value) {
  const status = normalizeKey(value || 'draft');
  const aliases = {
    calculated: 'draft',
    pending_hr_review: 'draft',
    hr_review_pending: 'draft',
    hr_review: 'hr_reviewed',
    reviewed: 'hr_reviewed',
    pending_finance_approval: 'hr_reviewed',
    finance_approval: 'hr_reviewed',
    finance_pending: 'hr_reviewed',
    approved: 'finance_approved',
    pending_lock: 'finance_approved',
    completed: 'disbursed',
    paid: 'disbursed',
  };

  return aliases[status] || status;
}

function isFinalizedPayrollStatus(value, isLocked = false) {
  if (isLocked) {
    return true;
  }

  return ['hr_reviewed', 'finance_approved', 'locked', 'disbursed'].includes(
    canonicalPayrollStatus(value),
  );
}

function workflowActionForStatus(value) {
  const status = canonicalPayrollStatus(value);

  if (status === 'draft') {
    return 'hr_review';
  }

  if (status === 'hr_reviewed') {
    return 'finance_approve';
  }

  if (status === 'finance_approved') {
    return 'lock';
  }

  if (status === 'locked') {
    return 'disburse';
  }

  return '';
}

function workflowActionLabel(action) {
  const labels = {
    hr_review: 'Complete HR Review',
    finance_approve: 'Approve as Finance',
    lock: 'Lock Payroll',
    disburse: 'Record Disbursement',
  };

  return labels[action] || statusLabel(action);
}

function workflowActionDescription(action) {
  const descriptions = {
    hr_review:
      'Confirm the payroll calculation, attendance, LWP, reimbursements and employee-level results before sending the run to Finance.',
    finance_approve:
      'Confirm the payroll values and statutory deductions before allowing the run to be locked.',
    lock:
      'Lock the payroll after verified bank details are available. Locked payroll values can no longer be recalculated.',
    disburse:
      'Record the actual salary transfer details after the bank transfer has been completed.',
  };

  return descriptions[action] || '';
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
  const status = canonicalPayrollStatus(value);
  const labels = {
    draft: 'Draft',
    hr_reviewed: 'HR Reviewed',
    finance_approved: 'Finance Approved',
    locked: 'Locked',
    disbursed: 'Disbursed',
    not_processed: 'Not Processed',
  };

  return labels[status] || safeText(status, 'draft')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusClass(value) {
  const status = canonicalPayrollStatus(value);

  if (['finance_approved', 'locked', 'disbursed'].includes(status)) {
    return 'payroll-status payroll-status-success';
  }

  if (['hr_reviewed', 'processing'].includes(status)) {
    return 'payroll-status payroll-status-info';
  }

  if (['failed', 'rejected', 'cancelled'].includes(status)) {
    return 'payroll-status payroll-status-danger';
  }

  return 'payroll-status payroll-status-warning';
}

function payrollIssueKey(item = {}, fallback = '') {
  return [
    safeText(item.employee_id, ''),
    safeText(item.code, ''),
    safeText(item.run_id, ''),
    safeText(item.message || item.reason, fallback),
  ].join('|');
}

function uniquePayrollIssues(...groups) {
  const rows = [];
  const seen = new Set();

  groups.flat().forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const key = payrollIssueKey(item, String(index));
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    rows.push(item);
  });

  return rows;
}

function emptyManualInput(totalDays) {
  return {
    total_days: totalDays || '',
    working_days: '',
    paid_leave_days: '0',
    lwp_days: '',
  };
}

function resolveRunId(run) {
  const source = run && typeof run === 'object' ? run : {};
  return safeText(source._id || source.id || source.run_id, '');
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

function PayrollResultsPortal({ active, children }) {
  if (!active || typeof document === 'undefined') {
    return children;
  }

  return createPortal(
    <div className="payroll-results-full-window-layer">
      {children}
    </div>,
    document.body,
  );
}


function PayrollContainedScrollbar({
  scrollRef,
  refreshKey = '',
  ariaLabel = 'Horizontal table scrollbar',
}) {
  const [scrollbar, setScrollbar] = useState({
    scrollable: false,
    visible: false,
    thumbWidth: 100,
    thumbLeft: 0,
  });
  const hideTimerRef = useRef(null);
  const thumbDragRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
    scrollPerPixel: 1,
  });

  function clearHideTimer() {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  function scheduleHide(delay = 900) {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      setScrollbar((current) => ({
        ...current,
        visible: false,
      }));
      hideTimerRef.current = null;
    }, delay);
  }

  function syncScrollbar({ reveal = false } = {}) {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }

    const clientWidth = Math.max(0, scroller.clientWidth);
    const scrollWidth = Math.max(clientWidth, scroller.scrollWidth);
    const scrollRange = Math.max(0, scrollWidth - clientWidth);
    const scrollable = scrollRange > 2;

    const naturalThumbWidth =
      scrollWidth > 0 ? (clientWidth / scrollWidth) * 100 : 100;
    const thumbWidth = scrollable
      ? Math.min(100, Math.max(12, naturalThumbWidth))
      : 100;
    const maxThumbLeft = Math.max(0, 100 - thumbWidth);
    const thumbLeft =
      scrollable && scrollRange > 0
        ? Math.min(
            maxThumbLeft,
            Math.max(0, (scroller.scrollLeft / scrollRange) * maxThumbLeft),
          )
        : 0;

    setScrollbar((current) => ({
      scrollable,
      visible: scrollable && (reveal || current.visible),
      thumbWidth,
      thumbLeft,
    }));

    if (reveal && scrollable) {
      scheduleHide();
    }
  }

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return undefined;
    }

    const revealFromScroll = () => syncScrollbar({ reveal: true });
    const revealFromPointer = (event) => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
        syncScrollbar({ reveal: true });
      }
    };
    const revealFromTouch = () => syncScrollbar({ reveal: true });
    const refresh = () => syncScrollbar();

    scroller.addEventListener('scroll', revealFromScroll, { passive: true });
    scroller.addEventListener('pointermove', revealFromPointer, { passive: true });
    scroller.addEventListener('touchstart', revealFromTouch, { passive: true });
    window.addEventListener('resize', refresh);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(refresh);
      resizeObserver.observe(scroller);

      const table = scroller.querySelector('table');
      if (table) {
        resizeObserver.observe(table);
      }
    }

    const frame = window.requestAnimationFrame(refresh);

    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', revealFromScroll);
      scroller.removeEventListener('pointermove', revealFromPointer);
      scroller.removeEventListener('touchstart', revealFromTouch);
      window.removeEventListener('resize', refresh);
      resizeObserver?.disconnect();
      clearHideTimer();
    };
    // refreshKey intentionally retriggers measurement after page/search/view changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, scrollRef]);

  function handleTrackPointerDown(event) {
    if (event.target !== event.currentTarget) {
      return;
    }

    const scroller = scrollRef.current;
    if (!scroller || !scrollbar.scrollable) {
      return;
    }

    const trackRect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - trackRect.left) / Math.max(trackRect.width, 1)),
    );
    const scrollRange = Math.max(0, scroller.scrollWidth - scroller.clientWidth);

    scroller.scrollLeft = ratio * scrollRange;
    syncScrollbar({ reveal: true });
    event.preventDefault();
  }

  function handleThumbPointerDown(event) {
    const scroller = scrollRef.current;
    const thumb = event.currentTarget;
    const track = thumb.parentElement;

    if (!scroller || !track || !scrollbar.scrollable) {
      return;
    }

    const trackWidth = Math.max(1, track.getBoundingClientRect().width);
    const thumbWidth = Math.max(1, thumb.getBoundingClientRect().width);
    const thumbTravel = Math.max(1, trackWidth - thumbWidth);
    const scrollRange = Math.max(0, scroller.scrollWidth - scroller.clientWidth);

    clearHideTimer();
    setScrollbar((current) => ({ ...current, visible: true }));

    thumbDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: scroller.scrollLeft,
      scrollPerPixel: scrollRange / thumbTravel,
    };

    thumb.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function handleThumbPointerMove(event) {
    const drag = thumbDragRef.current;
    const scroller = scrollRef.current;

    if (!drag.active || drag.pointerId !== event.pointerId || !scroller) {
      return;
    }

    scroller.scrollLeft =
      drag.startScrollLeft +
      ((event.clientX - drag.startX) * drag.scrollPerPixel);

    syncScrollbar({ reveal: true });
    event.preventDefault();
    event.stopPropagation();
  }

  function endThumbDrag(event) {
    const drag = thumbDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }

    thumbDragRef.current = {
      active: false,
      pointerId: null,
      startX: 0,
      startScrollLeft: 0,
      scrollPerPixel: 1,
    };

    syncScrollbar({ reveal: true });
    scheduleHide(700);
    event.stopPropagation();
  }

  if (!scrollbar.scrollable) {
    return null;
  }

  return (
    <div
      className={
        scrollbar.visible
          ? 'payroll-contained-scrollbar is-visible'
          : 'payroll-contained-scrollbar'
      }
      aria-hidden="true"
    >
      <div
        className="payroll-contained-scrollbar-track"
        onPointerDown={handleTrackPointerDown}
      >
        <div
          className="payroll-contained-scrollbar-thumb"
          style={{
            width: `${scrollbar.thumbWidth}%`,
            left: `${scrollbar.thumbLeft}%`,
          }}
          role="presentation"
          aria-label={ariaLabel}
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={endThumbDrag}
          onPointerCancel={endThumbDrag}
        />
      </div>
    </div>
  );
}

function PayrollInlineMessage({ feedback, onClose, className = '' }) {
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
      className={`payroll-inline-feedback ${type} ${className}`.trim()}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      <span className="payroll-inline-feedback-icon" aria-hidden="true">
        {feedback.loading ? <Loader2 size={15} className="spin" /> : <Icon size={15} />}
      </span>

      <span className="payroll-inline-feedback-copy">
        {feedback.title ? <strong>{feedback.title}</strong> : null}
        <span>{feedback.message}</span>
      </span>

      <button
        type="button"
        className="payroll-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export default function Payroll({ user = {}, setPage = () => {} }) {
  const alerts = useCustomAlert();
  const userRoles = useMemo(() => normalizeRoles(user), [user]);
  const superAdmin = userRoles.includes('super_admin');
  const canHrReview =
    superAdmin || userRoles.some((role) => HR_PAYROLL_REVIEW_ROLES.has(role));
  const canFinanceAct =
    superAdmin ||
    userRoles.some((role) => FINANCE_PAYROLL_WORKFLOW_ROLES.has(role));

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
  const [allPayslips, setAllPayslips] = useState([]);
  const [calculationErrors, setCalculationErrors] = useState([]);
  const [calculationSkipped, setCalculationSkipped] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingPayslips, setLoadingPayslips] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [syncingAttendance, setSyncingAttendance] = useState(false);
  const [attendanceSyncResult, setAttendanceSyncResult] = useState(null);
  const [attendanceSyncFailures, setAttendanceSyncFailures] = useState([]);
  const [attendanceSyncSkipped, setAttendanceSyncSkipped] = useState([]);
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);
  const [pdfActionKey, setPdfActionKey] = useState('');
  const [workflowModal, setWorkflowModal] = useState(null);
  const [workflowNote, setWorkflowNote] = useState('');
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);
  const [disbursementForm, setDisbursementForm] = useState(
    emptyPayrollDisbursement,
  );

  const [inlineFeedback, setInlineFeedback] = useState({});
  const feedbackTimersRef = useRef({});
  const runTableScrollRef = useRef(null);
  const resultTableScrollRef = useRef(null);
  const resultTableDragRef = useRef({
    active: false,
    pointerId: null,
    pointerType: '',
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    horizontalDrag: false,
  });

  function clearInlineFeedback(scopeKey) {
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

  function showInlineFeedback(
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
      }, PAYROLL_NOTICE_HIDE_MS);
    }
  }

  // Table presentation state only.
  const [employeeTablePage, setEmployeeTablePage] = useState(1);
  const [syncTableSearch, setSyncTableSearch] = useState('');
  const [syncTablePage, setSyncTablePage] = useState(1);
  const [manualTableSearch, setManualTableSearch] = useState('');
  const [manualTablePage, setManualTablePage] = useState(1);
  const [runTableSearch, setRunTableSearch] = useState('');
  const [runTablePage, setRunTablePage] = useState(1);
  const [runRowsPerPage, setRunRowsPerPage] = useState('50');
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [showAllRunResults, setShowAllRunResults] = useState(false);
  const [resultTableSearch, setResultTableSearch] = useState('');
  const [resultTablePage, setResultTablePage] = useState(1);
  const [resultRowsPerPage, setResultRowsPerPage] = useState('50');
  const [resultTableFullWindow, setResultTableFullWindow] = useState(false);

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

  const employeeTableRows = useMemo(
    () => filteredEmployees.slice(
      (employeeTablePage - 1) * TABLE_PAGE_SIZE,
      employeeTablePage * TABLE_PAGE_SIZE,
    ),
    [employeeTablePage, filteredEmployees],
  );

  const filteredSyncRows = useMemo(() => {
    const rows = attendanceSyncResult?.items || [];
    const term = normalizeKey(syncTableSearch);
    if (!term) return rows;

    return rows.filter((item) =>
      [
        item.employee_name,
        item.employee_code,
        item.working_days,
        item.present_days,
        item.paid_leave_days,
        item.lwp_days,
        ...(Array.isArray(item.warnings) ? item.warnings : []),
      ]
        .map((value) => normalizeKey(value))
        .join(' ')
        .includes(term),
    );
  }, [attendanceSyncResult, syncTableSearch]);

  const syncTableRows = useMemo(
    () => filteredSyncRows.slice(
      (syncTablePage - 1) * TABLE_PAGE_SIZE,
      syncTablePage * TABLE_PAGE_SIZE,
    ),
    [filteredSyncRows, syncTablePage],
  );

  const filteredManualRows = useMemo(() => {
    const term = normalizeKey(manualTableSearch);
    if (!term) return targetEmployees;

    return targetEmployees.filter((employee) =>
      [
        employeeName(employee),
        employeeCode(employee),
        employeeDepartment(employee),
        employeeDesignation(employee),
      ]
        .map(normalizeKey)
        .join(' ')
        .includes(term),
    );
  }, [manualTableSearch, targetEmployees]);

  const manualTableRows = useMemo(
    () => filteredManualRows.slice(
      (manualTablePage - 1) * TABLE_PAGE_SIZE,
      manualTablePage * TABLE_PAGE_SIZE,
    ),
    [filteredManualRows, manualTablePage],
  );

  const filteredRunRows = useMemo(() => {
    const term = normalizeKey(runTableSearch);
    if (!term) return runs;

    return runs.filter((run) =>
      [
        run.run_code,
        run.period_key || run.month,
        statusLabel(run.status || run.workflow_stage),
        run.employee_count,
      ]
        .map(normalizeKey)
        .join(' ')
        .includes(term),
    );
  }, [runTableSearch, runs]);

  const runTablePageSize = useMemo(
    () => (
      runRowsPerPage === 'all'
        ? Math.max(filteredRunRows.length, 1)
        : Math.max(1, Number(runRowsPerPage) || 50)
    ),
    [filteredRunRows.length, runRowsPerPage],
  );

  const runTableRows = useMemo(
    () => filteredRunRows.slice(
      (runTablePage - 1) * runTablePageSize,
      runTablePage * runTablePageSize,
    ),
    [filteredRunRows, runTablePage, runTablePageSize],
  );

  const resultSourceRows = useMemo(() => {
    if (!showAllRunResults) {
      return payslips;
    }

    const visibleRunIds = new Set(
      runs
        .map(resolveRunId)
        .filter(Boolean),
    );

    return allPayslips.filter((payslip) =>
      visibleRunIds.has(resolvePayslipRunId(payslip)),
    );
  }, [allPayslips, payslips, runs, showAllRunResults]);

  const filteredResultRows = useMemo(() => {
    const term = normalizeKey(resultTableSearch);
    if (!term) return resultSourceRows;

    return resultSourceRows.filter((payslip) =>
      [
        payslip.employee_name || payslip.employee_info?.name,
        payslip.employee_code || payslip.employee_info?.employee_code,
        payslip.status,
        resolveTdsMode(payslip),
      ]
        .map(normalizeKey)
        .join(' ')
        .includes(term),
    );
  }, [resultSourceRows, resultTableSearch]);

  const resultTablePageSize = useMemo(
    () => (
      resultRowsPerPage === 'all'
        ? Math.max(filteredResultRows.length, 1)
        : Math.max(1, Number(resultRowsPerPage) || 50)
    ),
    [filteredResultRows.length, resultRowsPerPage],
  );

  const resultTableRows = useMemo(
    () => filteredResultRows.slice(
      (resultTablePage - 1) * resultTablePageSize,
      resultTablePage * resultTablePageSize,
    ),
    [filteredResultRows, resultTablePage, resultTablePageSize],
  );

  const activeTotals = useMemo(() => {
    if (activeRun) {
      return resolveRunTotals(activeRun);
    }

    return {};
  }, [activeRun]);

  const periodRuns = useMemo(
    () => runs.filter(
      (run) =>
        safeText(run.period_key || run.month, '') === period &&
        run.is_deleted !== true,
    ),
    [period, runs],
  );

  const periodRunMap = useMemo(() => {
    const map = new Map();
    periodRuns.forEach((run) => {
      const runId = resolveRunId(run);
      if (runId) {
        map.set(runId, run);
      }
    });
    return map;
  }, [periodRuns]);

  const editablePeriodRuns = useMemo(
    () => periodRuns.filter(
      (run) =>
        !run.is_locked &&
        canonicalPayrollStatus(run.status || run.workflow_stage) === 'draft',
    ),
    [periodRuns],
  );

  const calculationRun = useMemo(() => {
    const activeRunPeriod = safeText(activeRun?.period_key || activeRun?.month, '');
    const activeRunIsEditable =
      activeRun &&
      activeRunPeriod === period &&
      !activeRun.is_locked &&
      canonicalPayrollStatus(activeRun.status || activeRun.workflow_stage) === 'draft';

    if (activeRunIsEditable) {
      return activeRun;
    }

    return editablePeriodRuns.length === 1 ? editablePeriodRuns[0] : null;
  }, [activeRun, editablePeriodRuns, period]);

  const periodEmployeePayrollMap = useMemo(() => {
    const map = new Map();
    const priority = {
      draft: 10,
      hr_reviewed: 20,
      finance_approved: 30,
      locked: 40,
      disbursed: 50,
    };

    function register(employeeIdValue, run = {}, payslip = {}) {
      const id = safeText(employeeIdValue, '');
      if (!id) {
        return;
      }

      const status = canonicalPayrollStatus(
        payslip.status ||
          payslip.workflow_stage ||
          run.status ||
          run.workflow_stage ||
          'draft',
      );
      const candidate = {
        employee_id: id,
        status,
        run_id: resolveRunId(run) || resolvePayslipRunId(payslip),
        run_code: safeText(run.run_code || payslip.run_code, ''),
        is_finalized: isFinalizedPayrollStatus(
          status,
          Boolean(run.is_locked || payslip.is_locked),
        ),
      };
      const existing = map.get(id);

      if (!existing || (priority[candidate.status] || 0) > (priority[existing.status] || 0)) {
        map.set(id, candidate);
      }
    }

    periodRuns.forEach((run) => {
      (Array.isArray(run.employee_ids) ? run.employee_ids : []).forEach((id) => {
        register(id, run);
      });
    });

    allPayslips.forEach((payslip) => {
      const run = periodRunMap.get(resolvePayslipRunId(payslip)) || {};
      const payslipPeriod = safeText(
        payslip.period_key || payslip.payroll_period || run.period_key || run.month,
        '',
      );

      if (payslipPeriod !== period) {
        return;
      }

      register(resolvePayslipEmployeeId(payslip), run, payslip);
    });

    return map;
  }, [allPayslips, period, periodRunMap, periodRuns]);

  const employeeEligibilityRows = useMemo(() => {
    const calculationRunId = resolveRunId(calculationRun);

    return employees.map((employee) => {
      const id = employeeId(employee);
      const payroll = periodEmployeePayrollMap.get(id);

      if (!payroll) {
        return {
          employee,
          employee_id: id,
          payroll_status: 'not_processed',
          run_id: '',
          run_code: '',
          attendance_eligible: true,
          calculation_eligible: true,
          calculation_reason: 'Not processed for this month.',
        };
      }

      if (payroll.is_finalized) {
        return {
          employee,
          employee_id: id,
          payroll_status: payroll.status,
          run_id: payroll.run_id,
          run_code: payroll.run_code,
          attendance_eligible: false,
          calculation_eligible: false,
          calculation_reason: 'Payroll is already finalized for this month.',
        };
      }

      const belongsToCalculationRun =
        payroll.status === 'draft' &&
        Boolean(calculationRunId) &&
        payroll.run_id === calculationRunId;

      return {
        employee,
        employee_id: id,
        payroll_status: payroll.status,
        run_id: payroll.run_id,
        run_code: payroll.run_code,
        attendance_eligible: true,
        calculation_eligible: belongsToCalculationRun,
        calculation_reason: belongsToCalculationRun
          ? 'Eligible for Draft recalculation.'
          : 'Already belongs to another Draft run. Select that run before recalculating.',
      };
    });
  }, [calculationRun, employees, periodEmployeePayrollMap]);

  const employeeEligibilityMap = useMemo(
    () => new Map(
      employeeEligibilityRows.map((item) => [item.employee_id, item]),
    ),
    [employeeEligibilityRows],
  );

  const targetEmployeeEligibility = useMemo(
    () => targetEmployees
      .map((employee) => employeeEligibilityMap.get(employeeId(employee)))
      .filter(Boolean),
    [employeeEligibilityMap, targetEmployees],
  );

  const targetEmployeeIds = useMemo(
    () => targetEmployeeEligibility
      .map((item) => item.employee_id)
      .filter(Boolean),
    [targetEmployeeEligibility],
  );

  const attendanceEligibleEmployeeIds = useMemo(
    () => targetEmployeeEligibility
      .filter((item) => item.attendance_eligible)
      .map((item) => item.employee_id)
      .filter(Boolean),
    [targetEmployeeEligibility],
  );

  const calculationEligibleEmployeeIds = useMemo(
    () => targetEmployeeEligibility
      .filter((item) => item.calculation_eligible)
      .map((item) => item.employee_id)
      .filter(Boolean),
    [targetEmployeeEligibility],
  );

  const calculationEligibleEmployees = useMemo(() => {
    const eligibleSet = new Set(calculationEligibleEmployeeIds);
    return targetEmployees.filter((employee) => eligibleSet.has(employeeId(employee)));
  }, [calculationEligibleEmployeeIds, targetEmployees]);

  const attendanceBlockedEmployees = useMemo(
    () => targetEmployeeEligibility.filter((item) => !item.attendance_eligible),
    [targetEmployeeEligibility],
  );

  const calculationBlockedEmployees = useMemo(
    () => targetEmployeeEligibility.filter((item) => !item.calculation_eligible),
    [targetEmployeeEligibility],
  );

  function tenantParams() {
    if (!superAdmin || !tenantId.trim()) {
      return {};
    }

    return { tenant_id: tenantId.trim() };
  }

  function startResultTableDrag(event) {
    if (
      resultTableFullWindow ||
      (event.pointerType !== 'touch' && event.button !== 0) ||
      event.ctrlKey ||
      event.metaKey ||
      event.target?.closest?.('button, a, input, select, textarea, label')
    ) {
      return;
    }

    const scroller = event.currentTarget;

    resultTableDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scroller.scrollLeft,
      horizontalDrag: event.pointerType !== 'touch',
    };

    scroller.setPointerCapture?.(event.pointerId);

    if (event.pointerType !== 'touch') {
      scroller.classList.add('is-dragging');
      event.preventDefault();
    }
  }

  function moveResultTableDrag(event) {
    const drag = resultTableDragRef.current;

    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }

    const scroller = event.currentTarget;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (drag.pointerType === 'touch' && !drag.horizontalDrag) {
      const horizontalDistance = Math.abs(deltaX);
      const verticalDistance = Math.abs(deltaY);

      if (horizontalDistance < 6 && verticalDistance < 6) {
        return;
      }

      if (verticalDistance > horizontalDistance) {
        return;
      }

      resultTableDragRef.current.horizontalDrag = true;
      scroller.classList.add('is-dragging');
    }

    if (!resultTableDragRef.current.horizontalDrag) {
      return;
    }

    scroller.scrollLeft = drag.startScrollLeft - deltaX;
    event.preventDefault();
  }

  function endResultTableDrag(event) {
    const drag = resultTableDragRef.current;

    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }

    const scroller = event.currentTarget;

    resultTableDragRef.current = {
      active: false,
      pointerId: null,
      pointerType: '',
      startX: 0,
      startY: 0,
      startScrollLeft: scroller.scrollLeft,
      horizontalDrag: false,
    };

    scroller.classList.remove('is-dragging');

    if (scroller.hasPointerCapture?.(event.pointerId)) {
      scroller.releasePointerCapture?.(event.pointerId);
    }
  }

  function handleResultTableKeyDown(event) {
    if (resultTableFullWindow) {
      return;
    }

    const scroller = event.currentTarget;
    const step = Math.max(220, Math.round(scroller.clientWidth * 0.72));

    if (event.key === 'ArrowRight') {
      scroller.scrollBy({ left: step, behavior: 'smooth' });
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      scroller.scrollBy({ left: -step, behavior: 'smooth' });
      event.preventDefault();
    } else if (event.key === 'Home') {
      scroller.scrollTo({ left: 0, behavior: 'smooth' });
      event.preventDefault();
    } else if (event.key === 'End') {
      scroller.scrollTo({ left: scroller.scrollWidth, behavior: 'smooth' });
      event.preventDefault();
    }
  }

  async function viewAllPayrollRuns() {
    setRunTableSearch('');
    setRunTablePage(1);
    setRunRowsPerPage('all');
    setShowAllRuns(true);
    setShowAllRunResults(true);
    setResultTableSearch('');
    setResultTablePage(1);

    if (!allPayslips.length && runs.length) {
      await loadPayslipsForRun(runs[0], { silent: true });
    }
  }

  function resetPayrollRunView() {
    setRunTableSearch('');
    setRunTablePage(1);
    setRunRowsPerPage('50');
    setShowAllRuns(false);
    setShowAllRunResults(false);
    setResultTableSearch('');
    setResultTablePage(1);
    setResultRowsPerPage('50');
    setActiveRun(null);
    setPayslips([]);
    setAllPayslips([]);
    clearInlineFeedback('results');
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
        showInlineFeedback(
          'refresh',
          'warning',
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
        showInlineFeedback(
          'refresh',
          'error',
          error.message || 'Unable to load employees.',
          'Employee Load Failed',
        );
      }

      return null;
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadRuns({ silent = false, preferredRunId = '' } = {}) {
    if (superAdmin && !tenantId.trim()) {
      setRuns([]);
      setActiveRun(null);
      setPayslips([]);
      setAllPayslips([]);
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
        items.find(
          (run) =>
            resolveRunId(run) === preferredRunId &&
            safeText(run.period_key || run.month, '') === period,
        ) ||
        items.find((run) => safeText(run.period_key || run.month, '') === period) ||
        null;

      setActiveRun(nextActiveRun);

      if (!nextActiveRun) {
        setPayslips([]);
        setAllPayslips([]);
      }

      return items;
    } catch (error) {
      setRuns([]);
      setActiveRun(null);
      setPayslips([]);
      setAllPayslips([]);

      if (!silent) {
        showInlineFeedback(
          'refresh',
          'error',
          error.message || 'Unable to load payroll runs.',
          'Payroll Load Failed',
        );
      }

      return null;
    } finally {
      setLoadingRuns(false);
    }
  }

  async function loadPayslipsForRun(run, { silent = false } = {}) {
    const runId = resolveRunId(run);

    if (!runId) {
      setPayslips([]);
      setAllPayslips([]);
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
      const allItems = data.items || [];
      const items = allItems.filter(
        (payslip) => resolvePayslipRunId(payslip) === runId,
      );

      setAllPayslips(allItems);
      setPayslips(items);
      return items;
    } catch (error) {
      setAllPayslips([]);
      setPayslips([]);

      if (!silent) {
        showInlineFeedback(
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
    setAttendanceSyncSkipped([]);
    setCalculationErrors([]);
    setCalculationSkipped([]);
    setShowAllRuns(false);
    setShowAllRunResults(false);

    const nextPeriodRun = runs.find(
      (run) => safeText(run.period_key || run.month, '') === period,
    );
    setActiveRun(nextPeriodRun || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    setAttendanceSyncResult(null);
    setAttendanceSyncFailures([]);
    setAttendanceSyncSkipped([]);
    setCalculationErrors([]);
    setCalculationSkipped([]);
    setShowAllRuns(false);
    setShowAllRunResults(false);
  }, [tenantId]);

  useEffect(() => {
    if (!activeRun) {
      setPayslips([]);
      setAllPayslips([]);
      return;
    }

    loadPayslipsForRun(activeRun, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun]);

  useEffect(() => {
    function dismissInlineFeedback(event) {
      if (event.target?.closest?.('.payroll-inline-feedback')) {
        return;
      }

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      feedbackTimersRef.current = {};
      setInlineFeedback({});
    }

    document.addEventListener('pointerdown', dismissInlineFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissInlineFeedback);
      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      feedbackTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!workflowModal && !resultTableFullWindow) {
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
  }, [workflowModal, resultTableFullWindow]);

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

    if (!attendanceEligibleEmployeeIds.length) {
      return 'Every selected employee is already in HR Review, Finance Approval, Locked or Disbursed status for this month.';
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

    // Send the full requested employee scope. The backend performs the final
    // employee-level editability check and returns the exact skipped list.
    payload.employee_ids = targetEmployeeIds;

    return payload;
  }

  async function synchronizeAttendance() {
    const validationMessage = validateBeforeAttendanceSync();

    if (validationMessage) {
      showInlineFeedback(
        'attendance-sync',
        'warning',
        validationMessage,
        'Attendance Sync Input Required',
      );
      return;
    }

    const targetCount = attendanceEligibleEmployeeIds.length;
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
      showInlineFeedback(
        'attendance-sync',
        'info',
        'Synchronizing approved attendance, leave and LWP for the selected payroll scope...',
        'Synchronizing Attendance',
        { loading: true },
      );
      setSyncingAttendance(true);
      setAttendanceSyncFailures([]);
      setAttendanceSyncSkipped([]);

      const data = await api('/payroll/attendance-sync', {
        method: 'POST',
        body: JSON.stringify(buildAttendanceSyncPayload()),
        timeoutMs: 120000,
      });

      const result = data.attendance_sync || data;
      const blocked = uniquePayrollIssues(
        result.blocked || [],
        data.blocked || [],
      );
      const allFailures = uniquePayrollIssues(
        result.failures || [],
        data.failures || [],
      );
      const failures = allFailures.filter(
        (item) => item.code !== 'payroll_employee_not_editable',
      );

      setAttendanceSource('saved');
      setAttendanceSyncResult(result);
      setAttendanceSyncSkipped(blocked);
      setAttendanceSyncFailures(failures);

      const syncedCount = toNumber(
        result.totals?.employees_synced ?? data.totals?.employees_synced,
        0,
      );

      if (blocked.length || failures.length) {
        showInlineFeedback(
          'attendance-sync',
          'warning',
          `${syncedCount} employee attendance summar${
            syncedCount === 1 ? 'y was' : 'ies were'
          } saved. ${blocked.length} already processed employee${
            blocked.length === 1 ? ' was' : 's were'
          } skipped and ${failures.length} employee${
            failures.length === 1 ? '' : 's'
          } failed validation.`,
          'Attendance Partially Synchronized',
        );
      } else {
        showInlineFeedback(
          'attendance-sync',
          'success',
          data.message || 'Payroll attendance synchronized successfully.',
          'Attendance Synchronized',
        );
      }
    } catch (error) {
      const payload = error?.payload || {};
      const blocked = uniquePayrollIssues(
        payload.blocked || [],
        payload.details?.blocked || [],
      );
      const failures = uniquePayrollIssues(
        payload.failures || [],
        payload.skipped || [],
      ).filter((item) => item.code !== 'payroll_employee_not_editable');

      setAttendanceSyncSkipped(blocked);
      setAttendanceSyncFailures(failures);

      showInlineFeedback(
        'attendance-sync',
        'error',
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

    if (!calculationEligibleEmployeeIds.length) {
      return 'No selected employee is eligible for calculation. Finalized employees and employees in another Draft run are excluded.';
    }

    if (attendanceSource === 'manual') {
      if (!calculationEligibleEmployees.length) {
        return 'Load the employee list before entering manual payroll inputs.';
      }

      for (const employee of calculationEligibleEmployees) {
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

    // Send the full requested scope so the backend can enforce duplicate
    // employee-month protection and return already-processed employees.
    payload.employee_ids = targetEmployeeIds;

    const calculationRunId = resolveRunId(calculationRun);
    if (calculationRunId) {
      payload.run_id = calculationRunId;
    }

    if (attendanceSource === 'manual') {
      const eligibleSet = new Set(calculationEligibleEmployeeIds);
      payload.attendance = targetEmployees
        .filter((employee) => eligibleSet.has(employeeId(employee)))
        .map((employee) => {
          const id = employeeId(employee);
          const input = manualInputs[id] || emptyManualInput(totalDays);
          const row = {
            employee_id: id,
            total_days: totalDays,
            paid_leave_days:
              input.paid_leave_days === '' ? 0 : Number(input.paid_leave_days),
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
      showInlineFeedback(
        'calculation',
        'warning',
        validationMessage,
        'Payroll Input Required',
      );
      return;
    }

    const targetCount = calculationEligibleEmployeeIds.length;
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
      showInlineFeedback(
        'calculation',
        'info',
        'Calculating the current Draft payroll with the selected inputs...',
        'Calculating Payroll',
        { loading: true },
      );
      setCalculating(true);
      setCalculationErrors([]);
      setCalculationSkipped([]);

      const data = await api('/payroll/calculate', {
        method: 'POST',
        body: JSON.stringify(buildCalculationPayload()),
        timeoutMs: 120000,
      });

      const run = data.run || null;
      const calculatedPayslips = data.payslips || [];

      const alreadyProcessed = uniquePayrollIssues(
        data.already_processed || [],
      );
      const configurationMissing = uniquePayrollIssues(
        data.configuration_missing || [],
        data.errors || [],
      );

      setActiveRun(run);
      setPayslips(calculatedPayslips);
      setCalculationSkipped(alreadyProcessed);
      setCalculationErrors(configurationMissing);

      await loadRuns({
        silent: true,
        preferredRunId: resolveRunId(run),
      });

      if (alreadyProcessed.length || configurationMissing.length) {
        showInlineFeedback(
          'calculation',
          'warning',
          data.message || 'Payroll was calculated for eligible employees and skipped employees are listed below.',
          'Payroll Partially Calculated',
        );
      } else {
        showInlineFeedback(
          'calculation',
          'success',
          data.message || 'Draft payroll calculated successfully.',
          'Payroll Calculated',
        );
      }
    } catch (error) {
      const payload = error?.payload || {};
      const alreadyProcessed = uniquePayrollIssues(
        payload.already_processed || [],
      );
      const rows = uniquePayrollIssues(
        payload.configuration_missing || [],
        payload.errors || [],
      );
      setCalculationSkipped(alreadyProcessed);
      setCalculationErrors(rows);

      showInlineFeedback(
        'calculation',
        'error',
        error.message || 'Unable to calculate payroll.',
        'Payroll Calculation Failed',
      );
    } finally {
      setCalculating(false);
    }
  }

  function canPerformWorkflowAction(action) {
    if (action === 'hr_review') {
      return canHrReview;
    }

    if (['finance_approve', 'lock', 'disburse'].includes(action)) {
      return canFinanceAct;
    }

    return false;
  }

  function workflowInstruction(run) {
    const status = normalizeKey(run?.status || run?.workflow_stage || 'draft');
    const action = workflowActionForStatus(status);

    if (!action) {
      if (status === 'disbursed') {
        return 'This payroll run has completed the full workflow and salary disbursement is recorded.';
      }

      return 'No workflow action is available for this payroll status.';
    }

    if (canPerformWorkflowAction(action)) {
      return workflowActionDescription(action);
    }

    if (action === 'hr_review') {
      return 'Waiting for an HR, HR Admin or HR Manager to complete the HR Review.';
    }

    return action === 'finance_approve'
      ? 'Waiting for Finance or Accounts Finance to approve this payroll run.'
      : action === 'lock'
        ? 'Waiting for Finance or Accounts Finance to lock this payroll run.'
        : 'Waiting for Finance or Accounts Finance to record salary disbursement.';
  }

  function openWorkflowAction(run, requestedAction = '') {
    const action =
      requestedAction ||
      workflowActionForStatus(run?.status || run?.workflow_stage || 'draft');

    if (!action || !canPerformWorkflowAction(action)) {
      showInlineFeedback(
        'workflow',
        'warning',
        'Your current role is not permitted to perform the next payroll workflow action.',
        'Payroll Action Not Allowed',
      );
      return;
    }

    setActiveRun(run);
    setWorkflowNote('');
    setDisbursementForm(emptyPayrollDisbursement());
    setWorkflowModal({ run, action });
  }

  function closeWorkflowModal() {
    if (workflowSubmitting) {
      return;
    }

    setWorkflowModal(null);
    setWorkflowNote('');
    setDisbursementForm(emptyPayrollDisbursement());
  }

  function updateDisbursementField(field, value) {
    setDisbursementForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function executeWorkflowAction(event) {
    event.preventDefault();

    const run = workflowModal?.run;
    const action = workflowModal?.action;
    const runId = resolveRunId(run);

    if (!runId || !action) {
      showInlineFeedback(
        'workflow-modal',
        'error',
        'The selected payroll run or action is missing. Refresh and try again.',
        'Payroll Action Failed',
      );
      return;
    }

    if (!canPerformWorkflowAction(action)) {
      showInlineFeedback(
        'workflow-modal',
        'error',
        'Your current role is not permitted to perform this payroll action.',
        'Payroll Action Not Allowed',
      );
      return;
    }

    if (action === 'disburse') {
      if (!disbursementForm.transfer_date) {
        showInlineFeedback(
          'workflow-modal',
          'warning',
          'Select the actual salary transfer date.',
          'Transfer Date Required',
        );
        return;
      }

      if (!disbursementForm.transfer_mode) {
        showInlineFeedback(
          'workflow-modal',
          'warning',
          'Select the salary transfer mode.',
          'Transfer Mode Required',
        );
        return;
      }

      if (
        !disbursementForm.transaction_reference.trim() &&
        !disbursementForm.bank_file_reference.trim()
      ) {
        showInlineFeedback(
          'workflow-modal',
          'warning',
          'Enter either the UTR/transaction reference or the bank batch/file reference.',
          'Disbursement Reference Required',
        );
        return;
      }
    }

    try {
      showInlineFeedback(
        'workflow-modal',
        'info',
        `${workflowActionLabel(action)} is being saved...`,
        'Updating Payroll Workflow',
        { loading: true },
      );
      setWorkflowSubmitting(true);

      const payload = {
        ...tenantParams(),
        run_id: runId,
        action,
        note: workflowNote.trim(),
      };

      if (action === 'disburse') {
        payload.disbursement = {
          transfer_date: disbursementForm.transfer_date,
          transfer_mode: disbursementForm.transfer_mode,
          transaction_reference:
            disbursementForm.transaction_reference.trim(),
          bank_file_reference:
            disbursementForm.bank_file_reference.trim(),
        };
      }

      const data = await api('/payroll/run/approve', {
        method: 'POST',
        body: JSON.stringify(payload),
        timeoutMs: 120000,
      });

      const updatedRun = data.run || run;
      const updatedPayslips = Array.isArray(data.payslips)
        ? data.payslips
        : [];

      setActiveRun(updatedRun);

      if (updatedPayslips.length) {
        setPayslips(updatedPayslips);
      }

      setWorkflowModal(null);
      setWorkflowNote('');
      setDisbursementForm(emptyPayrollDisbursement());

      await loadRuns({
        silent: true,
        preferredRunId: resolveRunId(updatedRun) || runId,
      });

      if (!updatedPayslips.length) {
        await loadPayslipsForRun(updatedRun, { silent: true });
      }

      showInlineFeedback(
        'workflow',
        'success',
        data.message || `${workflowActionLabel(action)} completed successfully.`,
        'Payroll Workflow Updated',
      );

      if (data.loan_recovery_requires_retry) {
        showInlineFeedback(
          'workflow-followup-loan',
          'warning',
          'Salary disbursement was recorded, but one or more loan recoveries require a Finance retry.',
          'Loan Recovery Follow-up Required',
        );
      }

      if (data.reimbursement_payment_requires_retry) {
        showInlineFeedback(
          'workflow-followup-reimbursement',
          'warning',
          'Salary disbursement was recorded, but one or more reimbursement payments require a Finance retry.',
          'Reimbursement Follow-up Required',
        );
      }
    } catch (error) {
      showInlineFeedback(
        'workflow-modal',
        'error',
        error.message || 'Unable to update the payroll workflow.',
        'Payroll Workflow Failed',
      );
    } finally {
      setWorkflowSubmitting(false);
    }
  }

  function renderWorkflowActionButton(run, compact = false) {
    const action = workflowActionForStatus(
      run?.status || run?.workflow_stage || 'draft',
    );

    if (!action || !canPerformWorkflowAction(action)) {
      return null;
    }

    const Icon =
      action === 'hr_review'
        ? ShieldCheck
        : action === 'lock'
          ? LockKeyhole
          : action === 'disburse'
            ? Banknote
            : CheckCircle2;

    return (
      <button
        type="button"
        className="primary"
        onClick={() => openWorkflowAction(run, action)}
        disabled={workflowSubmitting}
        title={workflowActionDescription(action)}
      >
        {workflowSubmitting &&
        resolveRunId(workflowModal?.run) === resolveRunId(run) ? (
          <Loader2 size={compact ? 14 : 17} className="spin" />
        ) : (
          <Icon size={compact ? 14 : 17} />
        )}
        {workflowActionLabel(action)}
      </button>
    );
  }

  async function refreshAll() {
    if (superAdmin && !tenantId.trim()) {
      showInlineFeedback(
        'refresh',
        'warning',
        'Enter the company tenant ID before refreshing payroll data.',
        'Tenant Required',
      );
      return;
    }

    showInlineFeedback(
      'refresh',
      'info',
      'Refreshing employees, payroll runs and the current payroll view...',
      'Refreshing Payroll Data',
      { loading: true },
    );

    const [employeeItems, runItems] = await Promise.all([
      loadEmployees({ silent: true }),
      loadRuns({
        silent: true,
        preferredRunId: resolveRunId(activeRun),
      }),
    ]);

    if (employeeItems === null || runItems === null) {
      showInlineFeedback(
        'refresh',
        'error',
        'One or more payroll data sources could not be refreshed. Please try again.',
        'Refresh Incomplete',
      );
      return;
    }

    showInlineFeedback(
      'refresh',
      'success',
      'Employee and payroll-run data refreshed successfully.',
      'Refresh Complete',
    );
  }

  function renderTablePagination(totalItems, currentPage, setCurrentPage) {
    if (totalItems <= 0) {
      return null;
    }

    const totalPages = Math.max(1, Math.ceil(totalItems / TABLE_PAGE_SIZE));
    const safePage = Math.min(currentPage, totalPages);
    const start = ((safePage - 1) * TABLE_PAGE_SIZE) + 1;
    const end = Math.min(safePage * TABLE_PAGE_SIZE, totalItems);

    const pageNumbers = [];
    const pageWindow = 5;
    let startPage = Math.max(1, safePage - Math.floor(pageWindow / 2));
    let endPage = Math.min(totalPages, startPage + pageWindow - 1);

    if (endPage - startPage + 1 < pageWindow) {
      startPage = Math.max(1, endPage - pageWindow + 1);
    }

    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      pageNumbers.push(pageNumber);
    }

    return (
      <div className="payroll-pagination" aria-label="Table pagination">
        <span className="payroll-pagination-info">
          Showing <strong>{start}–{end}</strong> of <strong>{totalItems}</strong>
        </span>

        <div className="payroll-pagination-actions">
          <button
            type="button"
            className="secondary payroll-pagination-nav"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={safePage <= 1}
            aria-label="Previous page"
            title="Previous page"
          >
            ‹
          </button>

          <div className="payroll-pagination-numbers" aria-label="Choose page">
            {startPage > 1 ? (
              <>
                <button
                  type="button"
                  className={safePage === 1 ? 'payroll-page-number active' : 'payroll-page-number'}
                  onClick={() => setCurrentPage(1)}
                  aria-label="Go to page 1"
                  aria-current={safePage === 1 ? 'page' : undefined}
                >
                  1
                </button>
                {startPage > 2 ? <span className="payroll-pagination-ellipsis">…</span> : null}
              </>
            ) : null}

            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                className={
                  safePage === pageNumber
                    ? 'payroll-page-number active'
                    : 'payroll-page-number'
                }
                onClick={() => setCurrentPage(pageNumber)}
                aria-label={`Go to page ${pageNumber}`}
                aria-current={safePage === pageNumber ? 'page' : undefined}
              >
                {pageNumber}
              </button>
            ))}

            {endPage < totalPages ? (
              <>
                {endPage < totalPages - 1 ? (
                  <span className="payroll-pagination-ellipsis">…</span>
                ) : null}
                <button
                  type="button"
                  className={
                    safePage === totalPages
                      ? 'payroll-page-number active'
                      : 'payroll-page-number'
                  }
                  onClick={() => setCurrentPage(totalPages)}
                  aria-label={`Go to page ${totalPages}`}
                  aria-current={safePage === totalPages ? 'page' : undefined}
                >
                  {totalPages}
                </button>
              </>
            ) : null}
          </div>

          <span className="payroll-pagination-page" aria-live="polite">
            Page {safePage} of {totalPages}
          </span>

          <button
            type="button"
            className="secondary payroll-pagination-nav"
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={safePage >= totalPages}
            aria-label="Next page"
            title="Next page"
          >
            ›
          </button>
        </div>
      </div>
    );
  }

  function renderPayrollSectionPagination(
    totalItems,
    currentPage,
    setCurrentPage,
    ariaLabel = 'Payroll section pagination',
    pageSize = TABLE_PAGE_SIZE,
  ) {
    const safePageSize = Math.max(1, Number(pageSize) || TABLE_PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
    const safePage = Math.min(Math.max(1, currentPage), totalPages);
    const start = totalItems > 0 ? ((safePage - 1) * safePageSize) + 1 : 0;
    const end = totalItems > 0 ? Math.min(safePage * safePageSize, totalItems) : 0;

    const pageNumbers = [];
    const pageWindow = 5;
    let startPage = Math.max(1, safePage - Math.floor(pageWindow / 2));
    let endPage = Math.min(totalPages, startPage + pageWindow - 1);

    if (endPage - startPage + 1 < pageWindow) {
      startPage = Math.max(1, endPage - pageWindow + 1);
    }

    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      pageNumbers.push(pageNumber);
    }

    return (
      <div className="payroll-section-pagination" aria-label={ariaLabel}>
        <span className="payroll-section-pagination-info">
          Showing <strong>{start}–{end}</strong> of <strong>{totalItems}</strong>
        </span>

        <div className="payroll-section-pagination-actions">
          <button
            type="button"
            className="payroll-section-pagination-nav"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={safePage <= 1}
            aria-label="Previous page"
            title="Previous page"
          >
            ‹
          </button>

          <div className="payroll-section-pagination-numbers" aria-label="Choose page">
            {startPage > 1 ? (
              <>
                <button
                  type="button"
                  className={
                    safePage === 1
                      ? 'payroll-section-page-number active'
                      : 'payroll-section-page-number'
                  }
                  onClick={() => setCurrentPage(1)}
                  aria-label="Go to page 1"
                  aria-current={safePage === 1 ? 'page' : undefined}
                >
                  1
                </button>
                {startPage > 2 ? (
                  <span className="payroll-section-pagination-ellipsis">…</span>
                ) : null}
              </>
            ) : null}

            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                className={
                  safePage === pageNumber
                    ? 'payroll-section-page-number active'
                    : 'payroll-section-page-number'
                }
                onClick={() => setCurrentPage(pageNumber)}
                aria-label={`Go to page ${pageNumber}`}
                aria-current={safePage === pageNumber ? 'page' : undefined}
              >
                {pageNumber}
              </button>
            ))}

            {endPage < totalPages ? (
              <>
                {endPage < totalPages - 1 ? (
                  <span className="payroll-section-pagination-ellipsis">…</span>
                ) : null}
                <button
                  type="button"
                  className={
                    safePage === totalPages
                      ? 'payroll-section-page-number active'
                      : 'payroll-section-page-number'
                  }
                  onClick={() => setCurrentPage(totalPages)}
                  aria-label={`Go to page ${totalPages}`}
                  aria-current={safePage === totalPages ? 'page' : undefined}
                >
                  {totalPages}
                </button>
              </>
            ) : null}
          </div>

          <button
            type="button"
            className="payroll-section-pagination-nav"
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={safePage >= totalPages}
            aria-label="Next page"
            title="Next page"
          >
            ›
          </button>
        </div>
      </div>
    );
  }

  async function handlePayslipPdf(payslip, mode) {
    const employeeIdValue = resolvePayslipEmployeeId(payslip);
    const { year, month } = resolvePayrollPeriod(
      payslip,
      showAllRunResults ? {} : (activeRun || {}),
    );

    if (!employeeIdValue || !year || !month) {
      showInlineFeedback(
        'results',
        'warning',
        'This payslip does not contain a valid employee ID and payroll period.',
        'Payslip PDF Unavailable',
      );
      return;
    }

    const pdfFeedbackScope = `pdf:${employeeIdValue}`;
    const actionKey = `${employeeIdValue}-${year}-${month}-${mode}`;
    let previewWindow = null;

    if (mode === 'preview') {
      previewWindow = window.open('', '_blank');

      if (!previewWindow) {
        showInlineFeedback(
          pdfFeedbackScope,
          'warning',
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
      showInlineFeedback(
        pdfFeedbackScope,
        'info',
        mode === 'preview'
          ? 'Preparing the server-generated payslip PDF preview...'
          : 'Preparing the payslip PDF download...',
        mode === 'preview' ? 'Preparing Preview' : 'Preparing Download',
        { loading: true },
      );
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
        showInlineFeedback(
          pdfFeedbackScope,
          'success',
          'The generated payslip PDF was opened in a new tab.',
          'Payslip Preview Ready',
        );
      } else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

        showInlineFeedback(
          pdfFeedbackScope,
          'success',
          `${filename} was downloaded successfully.`,
          'Payslip Downloaded',
        );
      }
    } catch (error) {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.close();
      }

      showInlineFeedback(
        pdfFeedbackScope,
        'error',
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
          --pr-ink: #101a3a;
          --pr-copy: #5d6d8d;
          --pr-violet: #6658dc;
          --pr-violet-deep: #40348d;
          --pr-blue: #3766db;
          --pr-cyan: #18b5c8;
          --pr-teal: #34c9c4;
          --pr-line: rgba(16, 26, 58, .14);
          --pr-soft-line: rgba(171, 181, 211, .56);
          --pr-shadow: 8px 10px 0 #c4ccff, 0 24px 42px rgba(34, 38, 110, .10);

          display: grid;
          gap: clamp(18px, 2vw, 26px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          color: var(--pr-ink);
        }

        .payroll-page *,
        .payroll-page *::before,
        .payroll-page *::after {
          box-sizing: border-box;
        }

        .payroll-page > *,
        .payroll-page .panel,
        .payroll-module-links,
        .payroll-metric-grid,
        .payroll-form-grid,
        .payroll-sync-metrics,
        .payroll-picker-head,
        .payroll-table-head,
        .payroll-workflow-main,
        .payroll-modal,
        .payroll-modal-grid {
          min-width: 0;
          max-width: 100%;
        }

        .payroll-page img,
        .payroll-page input,
        .payroll-page select,
        .payroll-page textarea,
        .payroll-page button {
          max-width: 100%;
        }

        .payroll-page > .panel,
        .payroll-page section.panel,
        .payroll-page article.panel {
          position: relative;
          overflow: hidden;
          padding: clamp(20px, 2vw, 28px);
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow: var(--pr-shadow);
        }

        .payroll-page .panel::before,
        .payroll-page .panel::after {
          content: none !important;
          display: none !important;
        }

        .payroll-hero {
          isolation: isolate;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center !important;
          gap: clamp(22px, 3vw, 40px) !important;
          min-height: 270px;
          padding: clamp(26px, 3vw, 42px) !important;
          border-radius: clamp(28px, 2.7vw, 40px) !important;
          background: linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%) !important;
          box-shadow:
            12px 14px 0 #c6d8f7,
            0 28px 48px rgba(34, 38, 110, .13) !important;
        }

        .payroll-hero > div:first-child {
          min-width: 0;
        }

        .payroll-hero > div:first-child::before {
          content: "PAYROLL OPERATIONS";
          display: inline-flex;
          align-items: center;
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

        .payroll-hero h2 {
          max-width: 900px;
          margin: 0;
          color: var(--pr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 77px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
          overflow-wrap: anywhere;
        }

        .payroll-hero p {
          max-width: 850px;
          margin: 17px 0 0;
          color: var(--pr-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .payroll-hero-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: fit-content;
          max-width: 100%;
          min-height: 54px;
          padding: 11px 16px;
          border: 1px solid rgba(65, 55, 161, .18);
          border-radius: 16px;
          color: #40348d;
          background: rgba(255, 255, 255, .92);
          box-shadow:
            6px 7px 0 #b9d7ff,
            0 14px 25px rgba(44, 75, 116, .10);
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }

        .payroll-module-links {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
        }

        .payroll-module-link {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          min-height: 74px;
          padding: 15px 16px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 20px;
          color: var(--pr-ink);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            5px 6px 0 rgba(185, 215, 255, .72),
            0 16px 26px rgba(34, 38, 110, .08);
          font: inherit;
          font-size: 11px;
          font-weight: 900;
          text-align: left;
          cursor: pointer;
          transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
        }

        .payroll-module-link:nth-child(2n) {
          box-shadow:
            5px 6px 0 rgba(201, 192, 255, .68),
            0 16px 26px rgba(34, 38, 110, .08);
        }

        .payroll-module-link:nth-child(3n) {
          box-shadow:
            5px 6px 0 rgba(174, 230, 217, .72),
            0 16px 26px rgba(34, 38, 110, .08);
        }

        .payroll-module-link svg {
          width: 34px;
          height: 34px;
          flex: 0 0 34px;
          padding: 8px;
          border: 1px solid rgba(102, 88, 220, .18);
          border-radius: 11px;
          color: var(--pr-violet);
          background: #f1efff;
        }

        .payroll-module-link span {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .payroll-metric-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 14px;
          width: 100%;
        }

        .payroll-metric {
          display: flex;
          min-width: 0;
          align-items: flex-start;
          gap: 13px;
          padding: 19px !important;
          border-radius: 23px !important;
        }

        .payroll-metric:nth-child(1) {
          box-shadow: 6px 8px 0 #b9d7ff, 0 18px 30px rgba(34, 38, 110, .08) !important;
        }

        .payroll-metric:nth-child(2) {
          box-shadow: 6px 8px 0 #ffe0a5, 0 18px 30px rgba(34, 38, 110, .08) !important;
        }

        .payroll-metric:nth-child(3) {
          box-shadow: 6px 8px 0 #c9c0ff, 0 18px 30px rgba(34, 38, 110, .08) !important;
        }

        .payroll-metric:nth-child(4) {
          box-shadow: 6px 8px 0 #aee6d9, 0 18px 30px rgba(34, 38, 110, .08) !important;
        }

        .payroll-metric:nth-child(5) {
          box-shadow: 6px 8px 0 #f2c2cc, 0 18px 30px rgba(34, 38, 110, .08) !important;
        }

        .payroll-metric-icon {
          display: grid;
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          place-items: center;
          border: 1px solid rgba(102, 88, 220, .18);
          border-radius: 14px;
          color: var(--pr-violet);
          background: #f1efff;
          box-shadow: 2px 3px 0 rgba(52, 43, 120, .07);
        }

        .payroll-metric span {
          display: block;
          color: var(--pr-copy);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .payroll-metric strong {
          display: block;
          margin-top: 5px;
          color: var(--pr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(22px, 2vw, 31px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.035em;
          overflow-wrap: anywhere;
        }

        .payroll-page .panel > h3,
        .payroll-picker-head h3,
        .payroll-table-head h3,
        .payroll-workflow-copy h3,
        .payroll-modal-head h3 {
          margin: 0;
          color: var(--pr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.2vw, 35px);
          font-weight: 760;
          line-height: 1.05;
          letter-spacing: -.04em;
        }

        .payroll-page .panel > p,
        .payroll-workflow-copy p,
        .payroll-modal-head p {
          color: var(--pr-copy);
          line-height: 1.6;
        }

        .payroll-form-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          align-items: end;
          margin-top: 18px;
        }

        .payroll-field,
        .payroll-modal-field {
          display: grid;
          gap: 8px;
          min-width: 0;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .payroll-field > span,
        .payroll-modal-field > span {
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .payroll-field input,
        .payroll-field select,
        .payroll-modal-field input,
        .payroll-modal-field select,
        .payroll-modal-field textarea,
        .payroll-search input,
        .payroll-input-table input {
          width: 100%;
          min-width: 0;
          min-height: 47px;
          padding: 0 13px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 15px;
          outline: 0;
          color: var(--pr-ink);
          background: rgba(255, 255, 255, .95);
          font: inherit;
          font-weight: 650;
          transition: border-color 170ms ease, box-shadow 170ms ease, transform 170ms ease;
        }

        .payroll-modal-field textarea {
          min-height: 110px;
          padding: 13px;
          resize: vertical;
        }

        .payroll-field input:focus,
        .payroll-field select:focus,
        .payroll-modal-field input:focus,
        .payroll-modal-field select:focus,
        .payroll-modal-field textarea:focus,
        .payroll-search input:focus,
        .payroll-input-table input:focus {
          border-color: rgba(102, 88, 220, .65);
          box-shadow:
            4px 5px 0 rgba(102, 88, 220, .14),
            0 0 0 4px rgba(102, 88, 220, .08);
          transform: translateY(-1px);
        }

        .payroll-field input[readonly],
        .payroll-input-table input[readonly] {
          color: #667085;
          background: #f4f6fa;
        }

        .payroll-action-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 17px;
        }

        .payroll-page .primary,
        .payroll-page .secondary,
        .payroll-page .payroll-run-actions button,
        .payroll-page .payroll-pdf-actions button,
        .payroll-modal-actions button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 44px;
          padding: 10px 15px;
          border-radius: 15px;
          font: inherit;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
          transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease, filter 180ms ease;
        }

        .payroll-page .primary {
          border: 0;
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36, 74, 128, .16);
        }

        .payroll-page .secondary,
        .payroll-page .payroll-run-actions button,
        .payroll-page .payroll-pdf-actions button {
          border: 1px solid rgba(65, 55, 161, .18);
          color: #40348d;
          background: rgba(255, 255, 255, .94);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .09);
        }

        .payroll-page button:disabled {
          cursor: not-allowed;
          opacity: .56;
        }

        @media (hover: hover) and (pointer: fine) {
          .payroll-module-link:hover:not(:disabled),
          .payroll-page .primary:hover:not(:disabled),
          .payroll-page .secondary:hover:not(:disabled),
          .payroll-page .payroll-run-actions button:hover:not(:disabled),
          .payroll-page .payroll-pdf-actions button:hover:not(:disabled),
          .payroll-modal-actions button:hover:not(:disabled) {
            transform: translateY(-2px);
          }
        }

        .payroll-note {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-top: 14px;
          padding: 13px 15px;
          border: 1px solid rgba(220, 174, 52, .28);
          border-radius: 18px;
          color: #745500;
          background: #fff4d5;
          box-shadow: 4px 5px 0 rgba(255, 224, 165, .65);
          font-size: 11px;
          font-weight: 760;
          line-height: 1.55;
        }

        .payroll-note svg {
          flex: 0 0 auto;
          margin-top: 2px;
        }

        .payroll-picker-head,
        .payroll-table-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
        }

        .payroll-picker-head > *,
        .payroll-table-head > * {
          min-width: 0;
        }

        .payroll-table-head-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 9px;
          flex-wrap: wrap;
          margin-left: auto;
        }

        .payroll-table-head-button {
          min-height: 42px;
          padding: 9px 13px;
          white-space: nowrap;
        }

        .payroll-table-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .payroll-search {
          position: relative;
          width: min(430px, 100%);
        }

        .payroll-search svg {
          position: absolute;
          z-index: 1;
          top: 50%;
          left: 14px;
          color: #8290b1;
          transform: translateY(-50%);
          pointer-events: none;
        }

        .payroll-search input {
          padding-left: 42px;
        }

        .payroll-page .table-scroll,
        .payroll-selector-table,
        .payroll-input-table,
        .payroll-result-table,
        .payroll-run-table,
        .payroll-sync-table {
          position: relative;
          width: 100%;
          min-width: 0;
          overflow-x: auto;
          overscroll-behavior-inline: contain;
          -webkit-overflow-scrolling: touch;
          border: 1px solid rgba(171, 181, 211, .48);
          border-radius: 18px;
          background: #fff;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.7);
        }

        .payroll-page .table-scroll,
        .payroll-selector-table,
        .payroll-input-table,
        .payroll-sync-table {
          scrollbar-width: thin;
          scrollbar-color: rgba(102,88,220,.36) transparent;
        }

        .payroll-page .table-scroll::-webkit-scrollbar,
        .payroll-selector-table::-webkit-scrollbar,
        .payroll-input-table::-webkit-scrollbar,
        .payroll-sync-table::-webkit-scrollbar {
          height: 8px;
        }

        .payroll-page .table-scroll::-webkit-scrollbar-thumb,
        .payroll-selector-table::-webkit-scrollbar-thumb,
        .payroll-input-table::-webkit-scrollbar-thumb,
        .payroll-sync-table::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(102,88,220,.32);
        }

        .payroll-run-table,
        .payroll-result-table {
          scrollbar-width: none !important;
          -ms-overflow-style: none;
        }

        .payroll-run-table::-webkit-scrollbar,
        .payroll-result-table::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
          display: none;
        }

        .payroll-horizontal-scroll-shell {
          position: relative;
          width: 100%;
          min-width: 0;
        }

        .payroll-contained-scrollbar {
          position: absolute;
          z-index: 12;
          right: 24px;
          bottom: 8px;
          left: 24px;
          height: 8px;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition:
            opacity .18s ease,
            visibility .18s ease;
        }

        .payroll-contained-scrollbar.is-visible {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
        }

        .payroll-contained-scrollbar-track {
          position: relative;
          width: 100%;
          height: 6px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(188,198,216,.28);
        }

        .payroll-contained-scrollbar-thumb {
          position: absolute;
          top: 0;
          bottom: 0;
          min-width: 40px;
          border-radius: 999px;
          background: rgba(112,124,157,.56);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.42);
          cursor: grab;
          touch-action: none;
        }

        .payroll-contained-scrollbar-thumb:active {
          cursor: grabbing;
          background: rgba(88,101,143,.72);
        }

        .payroll-page table {
          width: 100%;
          border-collapse: collapse;
        }

        .payroll-selector-table table,
        .payroll-input-table table,
        .payroll-result-table table,
        .payroll-run-table table,
        .payroll-sync-table table {
          min-width: 980px;
        }

        .payroll-selector-table table {
          min-width: 1120px;
        }

        .payroll-result-table table {
          min-width: 1560px;
        }

        .payroll-sync-table table {
          min-width: 1040px;
        }

        .payroll-page th,
        .payroll-page td {
          padding: 12px 13px;
          border-bottom: 1px solid rgba(171, 181, 211, .36);
          text-align: left;
          vertical-align: middle;
          font-size: 11px;
        }

        .payroll-page th {
          position: sticky;
          z-index: 3;
          top: 0;
          color: #5d6785;
          background: linear-gradient(145deg, #edf6ff, #f1efff);
          font-weight: 900;
          letter-spacing: .03em;
          white-space: nowrap;
        }

        .payroll-page th:first-child,
        .payroll-page td:first-child {
          position: sticky;
          left: 0;
        }

        .payroll-page th:first-child {
          z-index: 5;
        }

        .payroll-page td:first-child {
          z-index: 2;
          background: #fff;
          box-shadow: 1px 0 0 rgba(171,181,211,.28);
        }

        .payroll-page .payroll-active-row td:first-child {
          background: #f1efff !important;
        }

        .payroll-page tbody tr:last-child td {
          border-bottom: 0;
        }

        .payroll-page tbody tr {
          transition: background 160ms ease;
        }

        @media (hover: hover) and (pointer: fine) {
          .payroll-page tbody tr:hover td {
            background: #fbfcff;
          }
        }

        .payroll-selector-table input[type='checkbox'] {
          width: 18px;
          height: 18px;
          accent-color: var(--pr-violet);
        }

        .payroll-input-table input {
          width: 112px;
          min-height: 38px;
          padding: 8px 10px;
          border-radius: 11px;
        }

        .payroll-table-tools {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 16px 0 12px;
          min-width: 0;
        }

        .payroll-table-tools .payroll-search {
          flex: 1 1 360px;
          width: min(460px, 100%);
        }

        .payroll-table-count {
          flex: 0 0 auto;
          padding: 8px 11px;
          border: 1px solid rgba(102,88,220,.16);
          border-radius: 999px;
          color: #53617f;
          background: #f7f8ff;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .payroll-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 13px;
          padding: 10px 12px;
          border: 1px solid rgba(171,181,211,.44);
          border-radius: 15px;
          background: linear-gradient(145deg, #fbfcff, #f6f8ff);
        }

        .payroll-pagination-info,
        .payroll-pagination-page {
          color: #65718e;
          font-size: 10px;
          font-weight: 850;
          white-space: nowrap;
        }

        .payroll-pagination-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .payroll-pagination-numbers {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-width: 0;
        }

        .payroll-page-number {
          display: inline-grid;
          width: 36px;
          min-width: 36px;
          height: 36px;
          place-items: center;
          padding: 0;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 11px;
          color: #53617f;
          background: #fff;
          font: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 160ms ease,
            border-color 160ms ease,
            background 160ms ease,
            color 160ms ease,
            box-shadow 160ms ease;
        }

        .payroll-page-number.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow: 3px 4px 0 #a9d6f5;
        }

        .payroll-pagination-ellipsis {
          display: inline-flex;
          min-width: 18px;
          align-items: center;
          justify-content: center;
          color: #7a86a1;
          font-size: 12px;
          font-weight: 900;
        }

        .payroll-pagination-actions .secondary {
          min-height: 36px;
          padding: 7px 11px;
          border-radius: 11px;
          box-shadow: none;
        }

        @media (hover: hover) and (pointer: fine) {
          .payroll-page-number:hover:not(.active) {
            transform: translateY(-1px);
            border-color: rgba(102,88,220,.42);
            color: #40348d;
            background: #f7f8ff;
          }
        }

        .payroll-status {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          max-width: 100%;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .payroll-status-success {
          border: 1px solid rgba(40, 90, 74, .16);
          color: #166534;
          background: #eaf8f4;
        }

        .payroll-status-info {
          border: 1px solid rgba(3, 105, 161, .16);
          color: #075985;
          background: #eef9ff;
        }

        .payroll-status-warning {
          border: 1px solid rgba(138, 90, 23, .15);
          color: #805b00;
          background: #fff4d5;
        }

        .payroll-status-danger {
          border: 1px solid rgba(216, 77, 104, .20);
          color: #b4234f;
          background: #fff0f2;
        }

        .payroll-active-row td {
          background: #f1efff !important;
        }

        .payroll-error-box {
          border-color: rgba(216, 77, 104, .24) !important;
          background: linear-gradient(145deg, #fff7f8, #fff) !important;
          box-shadow:
            6px 8px 0 #f2c2cc,
            0 18px 30px rgba(34, 38, 110, .08) !important;
        }

        .payroll-error-box > h3 {
          color: #991b42 !important;
        }

        .payroll-error-list {
          display: grid;
          gap: 10px;
          margin-top: 14px;
        }

        .payroll-error-item {
          min-width: 0;
          padding: 13px 14px;
          border: 1px solid rgba(216, 77, 104, .22);
          border-radius: 16px;
          background: rgba(255, 255, 255, .96);
          box-shadow: 3px 4px 0 rgba(242, 194, 204, .65);
        }

        .payroll-error-item strong {
          display: block;
          margin-bottom: 4px;
          color: #991b42;
        }

        .payroll-error-item p {
          margin: 0;
          color: #7b3146;
          line-height: 1.5;
        }

        .payroll-muted,
        .payroll-employee-meta,
        .payroll-tax-source small,
        .payroll-pdf-unavailable {
          color: var(--pr-copy);
          font-size: 11px;
        }

        .payroll-employee-name {
          color: var(--pr-ink);
          font-weight: 900;
        }

        .payroll-employee-meta {
          display: block;
          margin-top: 3px;
        }

        .payroll-pdf-actions,
        .payroll-run-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          min-width: 0;
        }

        .payroll-tax-source {
          display: grid;
          gap: 4px;
          min-width: 130px;
        }

        .payroll-bank-ready,
        .payroll-bank-missing,
        .payroll-sync-ok {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 900;
        }

        .payroll-bank-ready,
        .payroll-sync-ok {
          color: #16744b;
        }

        .payroll-bank-missing,
        .payroll-sync-warning {
          color: #805b00;
        }

        .payroll-sync-summary {
          display: grid !important;
          gap: 16px !important;
        }

        .payroll-sync-metrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .payroll-sync-metric {
          min-width: 0;
          padding: 15px;
          border: 1px solid rgba(171, 181, 211, .55);
          border-radius: 18px;
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow: 4px 5px 0 rgba(185, 215, 255, .58);
        }

        .payroll-sync-metric:nth-child(2n) {
          box-shadow: 4px 5px 0 rgba(201, 192, 255, .58);
        }

        .payroll-sync-metric span {
          display: block;
          margin-bottom: 5px;
          color: var(--pr-copy);
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .payroll-sync-metric strong {
          color: var(--pr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 24px;
          line-height: 1.1;
        }

        .payroll-sync-warning {
          display: block;
          max-width: 360px;
          font-size: 11px;
          line-height: 1.45;
        }

        .payroll-workflow-panel {
          display: grid !important;
          gap: 15px !important;
          border-left: 0 !important;
          background: linear-gradient(135deg, #eef9ff 0%, #f8f3ff 60%, #effbf8 100%) !important;
          box-shadow:
            8px 10px 0 #c9c0ff,
            0 24px 42px rgba(34, 38, 110, .10) !important;
        }

        .payroll-workflow-main {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          flex-wrap: wrap;
        }

        .payroll-workflow-copy {
          display: grid;
          gap: 8px;
          min-width: 0;
        }

        .payroll-workflow-copy p {
          max-width: 820px;
          margin: 0;
        }

        .payroll-workflow-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .payroll-workflow-meta span {
          padding: 7px 10px;
          border: 1px solid rgba(102, 88, 220, .18);
          border-radius: 999px;
          color: #53617f;
          background: rgba(255, 255, 255, .80);
          font-size: 10px;
          font-weight: 800;
        }

        .payroll-workflow-waiting {
          padding: 12px 14px;
          border: 1px solid rgba(3, 105, 161, .18);
          border-radius: 16px;
          color: #075985;
          background: #eef9ff;
          font-size: 11px;
          font-weight: 800;
          line-height: 1.5;
        }

        .payroll-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1200;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgba(15, 23, 42, .58);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .payroll-modal {
          width: min(650px, 100%);
          max-height: calc(100vh - 40px);
          overflow: auto;
          border: 1px solid rgba(171, 181, 211, .68);
          border-radius: 28px;
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            9px 11px 0 rgba(201, 192, 255, .70),
            0 34px 86px rgba(15, 23, 42, .28);
        }

        .payroll-modal-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 22px 24px 16px;
          border-bottom: 1px solid rgba(171, 181, 211, .42);
        }

        .payroll-modal-head > div {
          min-width: 0;
        }

        .payroll-modal-head h3 {
          font-size: clamp(27px, 3vw, 38px);
        }

        .payroll-modal-head p {
          margin: 7px 0 0;
        }

        .payroll-modal-close {
          display: grid;
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          place-items: center;
          border: 1px solid rgba(102, 88, 220, .18);
          border-radius: 14px;
          color: var(--pr-violet);
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .08);
          cursor: pointer;
        }

        .payroll-modal-body {
          display: grid;
          gap: 15px;
          padding: 20px 24px;
        }

        .payroll-modal-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
        }

        .payroll-modal-field.is-full {
          grid-column: 1 / -1;
        }

        .payroll-modal-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 10px;
          padding: 0 24px 24px;
        }

        @media (max-width: 1320px) {
          .payroll-module-links {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .payroll-metric-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .payroll-form-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .payroll-sync-metrics {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 1050px) {
          .payroll-hero {
            grid-template-columns: 1fr;
            min-height: 0;
          }

          .payroll-hero-badge {
            justify-self: start;
          }

          .payroll-metric-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .payroll-sync-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 820px) {
          .payroll-page {
            gap: 18px;
          }

          .payroll-hero {
            padding: 26px !important;
          }

          .payroll-hero h2 {
            font-size: clamp(38px, 8vw, 58px);
          }

          .payroll-module-links {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .payroll-page > .panel,
          .payroll-page section.panel,
          .payroll-page article.panel {
            padding: 20px;
            border-radius: 25px;
          }

          .payroll-picker-head,
          .payroll-table-head,
          .payroll-workflow-main {
            align-items: stretch;
            flex-direction: column;
          }

          .payroll-search {
            width: 100%;
          }

          .payroll-action-row,
          .payroll-pdf-actions,
          .payroll-run-actions {
            justify-content: flex-start;
          }

          .payroll-table-tools {
            align-items: stretch;
            flex-direction: column;
          }

          .payroll-table-tools .payroll-search {
            flex-basis: auto;
            width: 100%;
          }

          .payroll-table-count {
            align-self: flex-start;
          }

          .payroll-pagination {
            align-items: stretch;
            flex-direction: column;
          }

          .payroll-pagination-actions {
            justify-content: space-between;
            flex-wrap: wrap;
          }

          .payroll-pagination-numbers {
            order: 2;
            width: 100%;
            overflow-x: auto;
            justify-content: flex-start;
            padding: 2px 0 4px;
            scrollbar-width: none;
          }

          .payroll-pagination-numbers::-webkit-scrollbar {
            display: none;
          }

          .payroll-pagination-page {
            order: 1;
          }
        }

        @media (max-width: 680px) {
          .payroll-page {
            gap: 15px;
          }

          .payroll-hero {
            padding: 22px 18px !important;
            border-radius: 26px !important;
            box-shadow:
              7px 9px 0 #c6d8f7,
              0 20px 34px rgba(34, 38, 110, .11) !important;
          }

          .payroll-hero h2 {
            font-size: clamp(34px, 12vw, 50px);
          }

          .payroll-hero p {
            font-size: 12px;
          }

          .payroll-module-links,
          .payroll-metric-grid,
          .payroll-form-grid,
          .payroll-sync-metrics,
          .payroll-modal-grid {
            grid-template-columns: 1fr;
          }

          .payroll-module-link {
            min-height: 64px;
          }

          .payroll-metric {
            padding: 16px !important;
          }

          .payroll-page > .panel,
          .payroll-page section.panel,
          .payroll-page article.panel {
            padding: 17px;
            border-radius: 22px;
            box-shadow:
              5px 7px 0 #c4ccff,
              0 18px 30px rgba(34, 38, 110, .09);
          }

          .payroll-page .panel > h3,
          .payroll-picker-head h3,
          .payroll-table-head h3,
          .payroll-workflow-copy h3 {
            font-size: 25px;
          }

          .payroll-hero-badge,
          .payroll-action-row .primary,
          .payroll-action-row .secondary,
          .payroll-workflow-main > button,
          .payroll-modal-actions button {
            width: 100%;
          }

          .payroll-action-row {
            align-items: stretch;
            flex-direction: column;
          }

          .payroll-pdf-actions,
          .payroll-run-actions {
            display: grid;
            grid-template-columns: 1fr;
            width: 100%;
          }

          .payroll-pdf-actions button,
          .payroll-run-actions button {
            width: 100%;
          }

          .payroll-status {
            white-space: normal;
          }

          .payroll-page .table-wrap {
            margin-inline: -2px;
            border-radius: 14px;
          }

          .payroll-selector-table table,
          .payroll-input-table table,
          .payroll-run-table table,
          .payroll-sync-table table {
            min-width: 760px;
          }

          .payroll-result-table table {
            min-width: 1180px;
          }

          .payroll-page th,
          .payroll-page td {
            padding: 10px 11px;
            font-size: 10px;
          }

          .payroll-page th:first-child,
          .payroll-page td:first-child {
            min-width: 128px;
          }

          .payroll-pagination-actions {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
            width: 100%;
          }

          .payroll-pagination-actions .secondary {
            width: 100%;
          }

          .payroll-pagination-page {
            align-self: center;
            text-align: center;
          }

          .payroll-pagination-numbers {
            grid-column: 1 / -1;
            width: 100%;
            justify-content: center;
            order: initial;
          }

          .payroll-modal {
            border-radius: 22px;
          }

          .payroll-modal-head,
          .payroll-modal-body {
            padding-inline: 18px;
          }

          .payroll-modal-actions {
            padding: 0 18px 18px;
            flex-direction: column-reverse;
          }
        }

        @media (max-width: 430px) {
          .payroll-hero {
            padding: 20px 15px !important;
          }

          .payroll-hero h2 {
            font-size: clamp(31px, 11vw, 43px);
          }

          .payroll-hero > div:first-child::before {
            max-width: 100%;
            white-space: normal;
          }

          .payroll-page > .panel,
          .payroll-page section.panel,
          .payroll-page article.panel {
            padding: 14px;
            border-radius: 19px;
          }

          .payroll-module-link {
            padding: 13px;
            border-radius: 17px;
          }

          .payroll-metric {
            padding: 14px !important;
          }

          .payroll-metric-grid {
            grid-template-columns: 1fr;
          }

          .payroll-table-tools {
            margin-top: 13px;
          }

          .payroll-pagination {
            padding: 9px;
          }

          .payroll-pagination-actions {
            grid-template-columns: 1fr 1fr;
          }

          .payroll-pagination-page {
            grid-column: 1 / -1;
            grid-row: 1;
            margin-bottom: 2px;
          }

          .payroll-pagination-numbers {
            grid-column: 1 / -1;
            grid-row: 2;
            justify-content: flex-start;
            overflow-x: auto;
          }

          .payroll-pagination-actions .secondary:first-child {
            grid-column: 1;
            grid-row: 3;
          }

          .payroll-pagination-actions .secondary:last-child {
            grid-column: 2;
            grid-row: 3;
          }

          .payroll-modal-head {
            padding-top: 18px;
          }
        }

        /* -------------------------------------------------------------
           Payroll visual refinement
           Presentation-only overrides. Business and API logic unchanged.
        ------------------------------------------------------------- */

        .payroll-page {
          width: min(1280px, calc(100% - 48px));
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 14px 18px 0;
          overflow: visible;
          --pr-ink: #101a3a;
          --pr-copy: #60708e;
          --pr-violet: #6658dc;
          --pr-violet-deep: #40348d;
          --pr-blue: #4d77dd;
          --pr-cyan: #2eb2b9;
          --pr-teal: #34b38a;
          --pr-soft-line: rgba(171,181,211,.62);
        }

        .payroll-page > * {
          width: 100%;
          min-width: 0;
        }

        .payroll-page > .panel,
        .payroll-page section.panel,
        .payroll-page article.panel {
          overflow: visible;
          border: 1px solid rgba(171,181,211,.70);
          background: #ffffff;
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.10);
        }

        .payroll-hero {
          overflow: hidden !important;
          border-color: rgba(171,181,211,.68) !important;
          background:
            linear-gradient(
              90deg,
              #e8fbff 0%,
              #f5fdff 22%,
              #ffffff 50%,
              #faf7ff 72%,
              #f0ebff 100%
            ) !important;
          box-shadow:
            12px 14px 0 #c4ccff,
            0 28px 48px rgba(34,38,110,.12) !important;
        }

        .payroll-module-link {
          border-color: rgba(171,181,211,.64);
          background: #edf6ff;
          box-shadow:
            5px 6px 0 #b9d7ff,
            0 16px 26px rgba(34,38,110,.08);
        }

        .payroll-module-link:nth-child(2),
        .payroll-module-link:nth-child(5) {
          background: #f5f5ff;
          box-shadow:
            5px 6px 0 #c9c0ff,
            0 16px 26px rgba(34,38,110,.08);
        }

        .payroll-module-link:nth-child(3),
        .payroll-module-link:nth-child(6) {
          background: #eaf8f4;
          box-shadow:
            5px 6px 0 #aee6d9,
            0 16px 26px rgba(34,38,110,.08);
        }

        .payroll-module-link:nth-child(4) {
          background: #fff4d5;
          box-shadow:
            5px 6px 0 #ffe0a5,
            0 16px 26px rgba(34,38,110,.08);
        }

        .payroll-metric {
          min-height: 126px;
          border-color: rgba(171,181,211,.66) !important;
          background: #edf6ff !important;
        }

        .payroll-metric:nth-child(2) {
          background: #fff4d5 !important;
        }

        .payroll-metric:nth-child(3) {
          background: #f1efff !important;
        }

        .payroll-metric:nth-child(4) {
          background: #eaf8f4 !important;
        }

        .payroll-metric:nth-child(5) {
          background: #fff0f2 !important;
        }

        .payroll-page .primary,
        .payroll-page .secondary,
        .payroll-page .payroll-module-link,
        .payroll-page .payroll-page-number {
          border-radius: 14px;
        }

        .payroll-page .primary {
          border: 1px solid rgba(77,119,221,.18);
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow:
            4px 5px 0 #575092,
            0 12px 22px rgba(67,116,170,.13);
        }

        .payroll-page .secondary {
          border: 1px solid rgba(102,88,220,.18);
          color: #40348d;
          background: #f5f5ff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .payroll-page input,
        .payroll-page select,
        .payroll-page textarea {
          border: 1px solid rgba(159,169,205,.62);
          border-radius: 14px;
          color: #101a3a;
          background: #ffffff;
        }

        .payroll-page input:focus,
        .payroll-page select:focus,
        .payroll-page textarea:focus {
          border-color: rgba(77,119,221,.78);
          box-shadow: 0 0 0 4px rgba(77,119,221,.09);
          transform: none;
        }

        .payroll-search {
          border-color: rgba(171,181,211,.55);
          border-radius: 14px;
          background: #ffffff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.06);
        }

        .payroll-search:focus-within {
          border-color: rgba(77,119,221,.72);
          box-shadow: 0 0 0 4px rgba(77,119,221,.09);
          transform: none;
        }

        .payroll-note {
          border: 1px solid rgba(171,181,211,.52);
          border-radius: 18px;
          background: #f8f9ff;
          box-shadow: 4px 5px 0 rgba(52,43,120,.07);
        }

        .payroll-sync-summary {
          box-shadow:
            8px 10px 0 #aee6d9,
            0 24px 42px rgba(34,38,110,.10) !important;
        }

        .payroll-workflow-panel {
          box-shadow:
            8px 10px 0 #c9c0ff,
            0 24px 42px rgba(34,38,110,.10) !important;
        }

        .payroll-error-box {
          background: #fff9fa !important;
          box-shadow:
            8px 10px 0 #f2c2cc,
            0 24px 42px rgba(34,38,110,.09) !important;
        }

        .payroll-sync-metric,
        .payroll-error-item {
          border-radius: 18px;
          box-shadow: 4px 5px 0 rgba(52,43,120,.06);
        }

        .payroll-page .table-wrap {
          width: 100%;
          min-width: 0;
          overflow-x: auto;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 20px;
          background: #ffffff;
          box-shadow: 5px 6px 0 rgba(52,43,120,.07);
          scrollbar-width: thin;
          scrollbar-color: rgba(91,119,212,.32) transparent;
        }

        .payroll-page table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
        }

        .payroll-page thead th {
          position: sticky;
          z-index: 2;
          top: 0;
          background: #f5f5ff;
          color: #3d4770;
        }

        .payroll-page tbody tr {
          transition: background 170ms ease;
        }

        .payroll-active-row td {
          background: #edf6ff !important;
        }

        .payroll-pagination {
          border: 1px solid rgba(171,181,211,.52);
          border-radius: 18px;
          background: #f8f9ff;
          box-shadow: 4px 5px 0 rgba(52,43,120,.06);
        }

        .payroll-page-number.active {
          color: #ffffff;
          border-color: rgba(77,119,221,.18);
          background: linear-gradient(135deg, #4d77dd, #2eb2b9);
          box-shadow: 3px 4px 0 #575092;
        }

        .payroll-action-stack {
          display: grid;
          gap: 9px;
          min-width: 0;
          align-content: start;
        }

        .payroll-refresh-stack {
          width: min(100%, 350px);
          justify-self: end;
        }

        .payroll-refresh-stack > button {
          width: 100%;
          min-height: 48px;
        }

        .payroll-action-feedback-grid,
        .payroll-feedback-stack {
          display: grid;
          gap: 9px;
          width: 100%;
          min-width: 0;
          margin-top: 12px;
        }

        .payroll-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 10px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 11px 12px;
          border: 1px solid rgba(91,119,212,.20);
          border-radius: 14px;
          color: #31508e;
          background: #edf6ff;
          box-shadow: 4px 5px 0 #b9d7ff;
          animation: payrollFeedbackIn 180ms ease both;
        }

        .payroll-inline-feedback.success {
          border-color: rgba(4,120,87,.20);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 4px 5px 0 #aee6d9;
        }

        .payroll-inline-feedback.warning {
          border-color: rgba(154,104,23,.20);
          color: #8a5a17;
          background: #fff4d5;
          box-shadow: 4px 5px 0 #ffe0a5;
        }

        .payroll-inline-feedback.error {
          border-color: rgba(180,70,94,.22);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 4px 5px 0 #f2c2cc;
        }

        .payroll-inline-feedback-icon {
          display: grid;
          width: 28px;
          height: 28px;
          place-items: center;
          border-radius: 9px;
          background: rgba(255,255,255,.72);
        }

        .payroll-inline-feedback-copy {
          display: grid;
          gap: 2px;
          min-width: 0;
          font-size: 11px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .payroll-inline-feedback-copy strong {
          font-size: 11px;
          font-weight: 950;
        }

        .payroll-inline-feedback-close {
          display: grid;
          width: 28px;
          height: 28px;
          min-width: 28px;
          min-height: 28px;
          padding: 0;
          place-items: center;
          border: 0;
          border-radius: 9px;
          color: currentColor;
          background: rgba(255,255,255,.64);
          box-shadow: none;
          cursor: pointer;
        }

        .payroll-pdf-actions {
          align-items: stretch;
        }

        .payroll-pdf-feedback {
          grid-column: 1 / -1;
          margin-top: 2px;
          min-width: 240px;
        }

        .payroll-modal {
          border: 1px solid rgba(171,181,211,.72);
          background: #ffffff;
          box-shadow:
            10px 12px 0 #c9c0ff,
            0 30px 60px rgba(20,27,70,.24);
        }

        .payroll-modal-backdrop {
          backdrop-filter: blur(6px);
        }

        @keyframes payrollFeedbackIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (hover: hover) and (pointer: fine) {
          .payroll-module-link:hover:not(:disabled),
          .payroll-page .primary:hover:not(:disabled),
          .payroll-page .secondary:hover:not(:disabled),
          .payroll-page-number:hover:not(:disabled) {
            transform: translateY(-2px);
          }
        }

        @media (max-width: 900px) {
          .payroll-page {
            width: min(100% - 28px, 1280px);
            padding-right: 10px;
          }

          .payroll-refresh-stack {
            width: 100%;
            justify-self: stretch;
          }
        }

        @media (max-width: 680px) {
          .payroll-page {
            width: min(100% - 20px, 1280px);
            padding-right: 8px;
          }

          .payroll-inline-feedback {
            grid-template-columns: auto minmax(0, 1fr) auto;
            padding: 10px;
          }

          .payroll-pdf-feedback {
            min-width: 0;
          }
        }

        @media (max-width: 430px) {
          .payroll-page {
            width: calc(100% - 12px);
            padding-right: 6px;
          }

          .payroll-inline-feedback-copy {
            font-size: 10px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .payroll-page *,
          .payroll-page *::before,
          .payroll-page *::after {
            scroll-behavior: auto !important;
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }


        /* -------------------------------------------------------------
           TABLE / SEARCH / PAGINATION REFINEMENT
           Reference: supplied user-management table visual language.
           Presentation only — filtering, page size and row actions unchanged.
        ------------------------------------------------------------- */

        .payroll-table-tools {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) auto !important;
          gap: 22px !important;
          align-items: center !important;
          width: 100%;
          min-width: 0;
          margin: 18px 0 22px !important;
          padding: 0 !important;
        }

        .payroll-section-table-tools {
          grid-template-columns: minmax(0, 1fr) auto auto !important;
          gap: 14px !important;
        }

        .payroll-section-page-size-control {
          display: inline-grid;
          grid-template-columns: auto minmax(96px, auto);
          gap: 8px;
          align-items: center;
          min-width: 0;
          color: #5d6888;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .payroll-section-page-size-control > span {
          white-space: nowrap;
        }

        .payroll-section-page-size-control select {
          width: auto !important;
          min-width: 108px !important;
          min-height: 46px !important;
          padding: 0 34px 0 12px !important;
          border: 1px solid rgba(163,174,211,.72) !important;
          border-radius: 14px !important;
          color: #40348d !important;
          background-color: #ffffff !important;
          box-shadow: 3px 4px 0 #dedaff !important;
          font-size: 11px !important;
          font-weight: 900 !important;
          cursor: pointer;
        }

        .payroll-section-page-size-control select:focus {
          border-color: rgba(101,88,220,.72) !important;
          box-shadow:
            0 0 0 4px rgba(101,88,220,.08),
            3px 4px 0 #dedaff !important;
        }

        .payroll-table-tools .payroll-search,
        .payroll-picker-head .payroll-search {
          position: relative;
          width: 100% !important;
          min-width: 0;
          flex: none !important;
          border: 0 !important;
          border-radius: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
        }

        .payroll-table-tools .payroll-search svg,
        .payroll-picker-head .payroll-search svg {
          left: 20px !important;
          width: 19px;
          height: 19px;
          color: #6558dc !important;
        }

        .payroll-table-tools .payroll-search input,
        .payroll-picker-head .payroll-search input {
          width: 100% !important;
          min-height: 60px !important;
          padding: 0 22px 0 54px !important;
          border: 1px solid rgba(163,174,211,.72) !important;
          border-radius: 20px !important;
          color: #101a3a !important;
          background: #ffffff !important;
          box-shadow: none !important;
          font-size: 15px !important;
          font-weight: 750 !important;
          line-height: 1.2;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            background 170ms ease !important;
        }

        .payroll-table-tools .payroll-search input::placeholder,
        .payroll-picker-head .payroll-search input::placeholder {
          color: #6f7074 !important;
          opacity: 1;
          font-weight: 750;
        }

        .payroll-table-tools .payroll-search:focus-within,
        .payroll-picker-head .payroll-search:focus-within {
          border: 0 !important;
          box-shadow: none !important;
          transform: none !important;
        }

        .payroll-table-tools .payroll-search input:focus,
        .payroll-picker-head .payroll-search input:focus {
          border-color: rgba(101,88,220,.70) !important;
          box-shadow:
            0 0 0 4px rgba(101,88,220,.08),
            4px 5px 0 rgba(196,204,255,.58) !important;
          background: #ffffff !important;
        }

        .payroll-table-count {
          display: inline-flex !important;
          align-items: baseline !important;
          justify-content: center !important;
          gap: 6px;
          min-width: 92px;
          padding: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          color: #5d6888 !important;
          background: transparent !important;
          box-shadow: none !important;
          font-size: 12px !important;
          font-weight: 900 !important;
          white-space: nowrap;
        }

        /* Main table frame */
        .payroll-page .table-wrap,
        .payroll-selector-table,
        .payroll-input-table,
        .payroll-result-table,
        .payroll-run-table,
        .payroll-sync-table {
          width: 100%;
          min-width: 0;
          overflow-x: auto;
          padding: 12px 12px 18px !important;
          border: 1px solid rgba(171,181,211,.68) !important;
          border-radius: 26px !important;
          background:
            linear-gradient(180deg, #fbfcff 0%, #ffffff 100%) !important;
          box-shadow:
            8px 10px 0 #c4ccff,
            0 22px 38px rgba(34,38,110,.09) !important;
          scrollbar-width: thin;
          scrollbar-color: rgba(101,88,220,.30) transparent;
        }

        .payroll-page table {
          width: 100%;
          border-collapse: separate !important;
          border-spacing: 0 12px !important;
          background: transparent !important;
        }

        /* Header becomes a clean label strip rather than a heavy grid row. */
        .payroll-page thead th {
          position: static !important;
          z-index: auto !important;
          top: auto !important;
          padding: 8px 14px 10px !important;
          border: 0 !important;
          color: #68738f !important;
          background: transparent !important;
          box-shadow: none !important;
          font-size: 10px !important;
          font-weight: 950 !important;
          letter-spacing: .06em !important;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .payroll-page thead th:first-child,
        .payroll-page tbody td:first-child {
          position: static !important;
          left: auto !important;
        }

        /* Each data row reads as one soft rounded information card. */
        .payroll-page tbody tr {
          position: relative;
          background: transparent !important;
          filter: drop-shadow(0 7px 9px rgba(33,42,91,.045));
          transition:
            transform 170ms ease,
            filter 170ms ease !important;
        }

        .payroll-page tbody td {
          padding: 16px 14px !important;
          border-top: 1px solid rgba(171,181,211,.52) !important;
          border-bottom: 1px solid rgba(171,181,211,.52) !important;
          color: #17213d;
          background: #ffffff !important;
          font-size: 11px !important;
          vertical-align: middle;
        }

        .payroll-page tbody td:first-child {
          border-left: 1px solid rgba(171,181,211,.52) !important;
          border-radius: 20px 0 0 20px !important;
          box-shadow: none !important;
        }

        .payroll-page tbody td:last-child {
          border-right: 1px solid rgba(171,181,211,.52) !important;
          border-radius: 0 20px 20px 0 !important;
        }

        .payroll-page tbody tr:nth-child(3n + 1) td {
          background: #f8fbff !important;
        }

        .payroll-page tbody tr:nth-child(3n + 2) td {
          background: #fbfaff !important;
        }

        .payroll-page tbody tr:nth-child(3n + 3) td {
          background: #f8fcfb !important;
        }

        .payroll-page .payroll-active-row td {
          border-color: rgba(101,88,220,.34) !important;
          background:
            linear-gradient(135deg, #edf6ff 0%, #f4f2ff 100%) !important;
        }

        .payroll-page .payroll-active-row td:first-child {
          background:
            linear-gradient(135deg, #edf6ff 0%, #f4f2ff 100%) !important;
        }

        @media (hover: hover) and (pointer: fine) {
          .payroll-page tbody tr:hover {
            transform: translateY(-2px);
            filter: drop-shadow(0 10px 12px rgba(33,42,91,.08));
          }

          .payroll-page tbody tr:hover td {
            border-color: rgba(101,88,220,.28) !important;
          }
        }

        .payroll-employee-name {
          color: #0e1835 !important;
          font-size: 12px;
          font-weight: 950 !important;
        }

        .payroll-employee-meta {
          margin-top: 4px;
          color: #677491 !important;
          font-size: 10px;
          font-weight: 700;
        }

        /* Input-table controls remain functional, but visually match the card rows. */
        .payroll-input-table input {
          min-height: 40px !important;
          border-radius: 12px !important;
          background: #ffffff !important;
        }

        .payroll-selector-table input[type='checkbox'] {
          width: 19px !important;
          height: 19px !important;
          accent-color: #6558dc !important;
        }

        /* Pagination mirrors the supplied reference:
           "Showing x-y of n" left, boxed arrows/pages right. */
        .payroll-pagination {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 18px !important;
          width: 100%;
          margin-top: 24px !important;
          padding: 16px 0 2px !important;
          border: 0 !important;
          border-top: 1px solid rgba(171,181,211,.40) !important;
          border-radius: 0 !important;
          color: #5d6888;
          background: transparent !important;
          box-shadow: none !important;
        }

        .payroll-pagination-info {
          color: #5d6888 !important;
          font-size: 11px !important;
          font-weight: 800 !important;
          white-space: nowrap;
        }

        .payroll-pagination-info strong {
          color: #101a3a;
          font-size: 13px;
          font-weight: 950;
        }

        .payroll-pagination-actions {
          display: flex !important;
          align-items: center !important;
          justify-content: flex-end !important;
          gap: 10px !important;
          min-width: 0;
        }

        .payroll-pagination-numbers {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 8px !important;
          width: auto !important;
          min-width: 0;
          padding: 0 !important;
          overflow: visible !important;
        }

        .payroll-page-number,
        .payroll-pagination-nav {
          display: inline-grid !important;
          width: 46px !important;
          min-width: 46px !important;
          height: 46px !important;
          min-height: 46px !important;
          place-items: center !important;
          padding: 0 !important;
          border: 1px solid rgba(101,88,220,.18) !important;
          border-radius: 15px !important;
          color: #6658dc !important;
          background: #f5f5ff !important;
          box-shadow: 3px 4px 0 #dedaff !important;
          font-size: 13px !important;
          font-weight: 950 !important;
          line-height: 1;
        }

        .payroll-pagination-nav {
          font-size: 22px !important;
        }

        .payroll-page-number.active {
          color: #ffffff !important;
          border-color: rgba(77,119,221,.18) !important;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
          box-shadow:
            5px 6px 0 #575092,
            0 12px 20px rgba(56,89,160,.12) !important;
        }

        .payroll-page-number:disabled,
        .payroll-pagination-nav:disabled {
          opacity: .54 !important;
          color: #7770bc !important;
          background: #f5f5ff !important;
          box-shadow: 3px 4px 0 #e5e1ff !important;
          cursor: not-allowed !important;
        }

        .payroll-pagination-page {
          position: absolute !important;
          width: 1px !important;
          height: 1px !important;
          padding: 0 !important;
          margin: -1px !important;
          overflow: hidden !important;
          clip: rect(0, 0, 0, 0) !important;
          white-space: nowrap !important;
          border: 0 !important;
        }

        .payroll-pagination-ellipsis {
          min-width: 20px !important;
          color: #7a86a1 !important;
          font-size: 13px !important;
        }

        .payroll-section-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          width: 100%;
          margin-top: 20px;
          padding: 15px 0 2px;
          border-top: 1px solid rgba(171,181,211,.40);
        }

        .payroll-section-pagination-info {
          color: #5d6888;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }

        .payroll-section-pagination-info strong {
          color: #101a3a;
          font-size: 13px;
          font-weight: 950;
        }

        .payroll-section-pagination-actions,
        .payroll-section-pagination-numbers {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .payroll-section-page-number,
        .payroll-section-pagination-nav {
          display: inline-grid;
          width: 44px;
          min-width: 44px;
          height: 44px;
          min-height: 44px;
          place-items: center;
          padding: 0;
          border: 1px solid rgba(101,88,220,.18);
          border-radius: 14px;
          color: #6658dc;
          background: #f5f5ff;
          box-shadow: 3px 4px 0 #dedaff;
          font-size: 12px;
          font-weight: 950;
          line-height: 1;
          cursor: pointer;
        }

        .payroll-section-pagination-nav {
          font-size: 21px;
        }

        .payroll-section-page-number.active {
          color: #ffffff;
          border-color: rgba(77,119,221,.18);
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow:
            5px 6px 0 #575092,
            0 12px 20px rgba(56,89,160,.12);
        }

        .payroll-section-page-number:disabled,
        .payroll-section-pagination-nav:disabled {
          opacity: .54;
          cursor: not-allowed;
        }

        .payroll-section-pagination-ellipsis {
          min-width: 18px;
          color: #7a86a1;
          text-align: center;
          font-weight: 900;
        }

        @media (max-width: 900px) {
          .payroll-section-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .payroll-section-pagination-actions {
            width: 100%;
            overflow-x: auto;
            padding: 2px 2px 7px;
            scrollbar-width: none;
          }

          .payroll-section-pagination-actions::-webkit-scrollbar {
            display: none;
          }

          .payroll-section-pagination-info {
            white-space: normal;
          }

          .payroll-table-tools {
            grid-template-columns: 1fr !important;
            gap: 11px !important;
          }

          .payroll-section-table-tools {
            grid-template-columns: minmax(0, 1fr) auto !important;
          }

          .payroll-section-table-tools .payroll-search {
            grid-column: 1 / -1;
          }

          .payroll-section-page-size-control {
            justify-self: start;
          }

          .payroll-table-count {
            justify-self: end;
          }

          .payroll-table-head-actions {
            width: 100%;
            justify-content: flex-start;
          }

          .payroll-table-head-button {
            flex: 0 1 auto;
          }

          .payroll-pagination {
            align-items: stretch !important;
            flex-direction: column !important;
          }

          .payroll-pagination-actions {
            justify-content: flex-start !important;
            flex-wrap: wrap !important;
          }
        }

        @media (max-width: 680px) {
          .payroll-contained-scrollbar {
            right: 18px;
            bottom: 7px;
            left: 18px;
          }

          .payroll-contained-scrollbar-track {
            height: 5px;
          }

          .payroll-section-table-tools {
            grid-template-columns: 1fr !important;
          }

          .payroll-section-table-tools .payroll-search,
          .payroll-section-page-size-control,
          .payroll-table-count {
            grid-column: 1 !important;
            justify-self: stretch;
          }

          .payroll-section-page-size-control {
            grid-template-columns: 1fr minmax(108px, auto);
          }

          .payroll-section-page-size-control select {
            justify-self: end;
          }

          .payroll-table-count {
            justify-self: start;
          }

          .payroll-table-tools .payroll-search input,
          .payroll-picker-head .payroll-search input {
            min-height: 54px !important;
            padding-left: 48px !important;
            border-radius: 17px !important;
            font-size: 13px !important;
          }

          .payroll-table-tools .payroll-search svg,
          .payroll-picker-head .payroll-search svg {
            left: 17px !important;
          }

          .payroll-page .table-wrap,
          .payroll-selector-table,
          .payroll-input-table,
          .payroll-result-table,
          .payroll-run-table,
          .payroll-sync-table {
            padding: 8px 8px 14px !important;
            border-radius: 20px !important;
            box-shadow:
              5px 7px 0 #c4ccff,
              0 16px 28px rgba(34,38,110,.08) !important;
          }

          .payroll-page table {
            border-spacing: 0 9px !important;
          }

          .payroll-page tbody td {
            padding: 13px 11px !important;
          }

          .payroll-page tbody td:first-child {
            border-radius: 15px 0 0 15px !important;
          }

          .payroll-page tbody td:last-child {
            border-radius: 0 15px 15px 0 !important;
          }

          .payroll-pagination {
            margin-top: 18px !important;
            padding-top: 14px !important;
          }

          .payroll-pagination-actions {
            width: 100%;
            flex-wrap: nowrap !important;
            overflow-x: auto;
            padding: 3px 3px 8px;
            scrollbar-width: none;
          }

          .payroll-pagination-actions::-webkit-scrollbar {
            display: none;
          }

          .payroll-page-number,
          .payroll-pagination-nav {
            width: 43px !important;
            min-width: 43px !important;
            height: 43px !important;
            min-height: 43px !important;
            border-radius: 14px !important;
          }
        }

        @media (max-width: 430px) {
          .payroll-table-tools .payroll-search input,
          .payroll-picker-head .payroll-search input {
            min-height: 50px !important;
            font-size: 12px !important;
          }

          .payroll-pagination-info {
            white-space: normal;
          }

          .payroll-page-number,
          .payroll-pagination-nav {
            width: 40px !important;
            min-width: 40px !important;
            height: 40px !important;
            min-height: 40px !important;
          }
        }


        /* -------------------------------------------------------------
           FINAL TABLE / KPI / WORKFLOW MODAL REFINEMENT
           Display-focused only. Payroll data and action logic unchanged.
        ------------------------------------------------------------- */

        /* ---------- KPI VALUE CARDS ---------- */
        .payroll-metric {
          container-type: inline-size;
          grid-template-columns: auto minmax(0, 1fr) !important;
          align-items: center !important;
          gap: clamp(11px, 1.2vw, 18px) !important;
          min-width: 0;
        }

        .payroll-metric > div:last-child {
          min-width: 0;
          overflow: visible;
        }

        .payroll-metric span {
          max-width: 100%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: clip;
        }

        .payroll-metric strong {
          width: max-content;
          max-width: none;
          margin-top: 7px !important;
          white-space: nowrap !important;
          overflow: visible !important;
          overflow-wrap: normal !important;
          word-break: normal !important;
          font-size: clamp(15px, 7.2cqi, 30px) !important;
          line-height: 1 !important;
          letter-spacing: -.035em !important;
          font-variant-numeric: tabular-nums;
        }

        /* ---------- TABLE FRAME ---------- */
        .payroll-page .table-wrap,
        .payroll-selector-table,
        .payroll-input-table,
        .payroll-result-table,
        .payroll-run-table,
        .payroll-sync-table {
          padding: 14px 14px 18px !important;
          border: 1px solid rgba(171,181,211,.72) !important;
          border-radius: 28px !important;
          background: #ffffff !important;
          box-shadow:
            9px 11px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.09) !important;
        }

        .payroll-page table {
          border-collapse: separate !important;
          border-spacing: 0 12px !important;
          background: transparent !important;
        }

        .payroll-page thead th {
          padding: 9px 14px 11px !important;
          border: 0 !important;
          color: #68738f !important;
          background: transparent !important;
          font-size: 10px !important;
          font-weight: 950 !important;
          letter-spacing: .065em !important;
          text-transform: uppercase;
          white-space: nowrap !important;
        }

        .payroll-page tbody tr {
          background: transparent !important;
          filter: none !important;
        }

        .payroll-page tbody td {
          padding: 17px 14px !important;
          border: 0 !important;
          color: #263653 !important;
          background: #f8fbff !important;
          vertical-align: middle !important;
          font-size: 11px !important;
          line-height: 1.45;
          box-shadow: none !important;
        }

        .payroll-page tbody tr:nth-child(even) td {
          background: #fbfaff !important;
        }

        .payroll-page tbody td:first-child {
          border: 0 !important;
          border-radius: 21px 0 0 21px !important;
        }

        .payroll-page tbody td:last-child {
          border: 0 !important;
          border-radius: 0 21px 21px 0 !important;
        }

        .payroll-page .payroll-active-row td,
        .payroll-page .payroll-active-row td:first-child {
          border: 0 !important;
          background:
            linear-gradient(135deg, #eef5ff 0%, #f2f1ff 100%) !important;
        }

        @media (hover: hover) and (pointer: fine) {
          .payroll-page tbody tr:hover td {
            border: 0 !important;
            background: #f5f8ff !important;
          }
        }

        /* Keep payroll values readable on one line.
           Recent runs and payroll results preserve natural column widths and
           scroll horizontally only when the available screen width is smaller. */
        .payroll-run-table td,
        .payroll-result-table td,
        .payroll-sync-table td {
          white-space: nowrap;
        }

        .payroll-result-table {
          position: relative;
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          overflow-x: auto !important;
          overflow-y: hidden !important;
          cursor: grab;
          user-select: text;
          -webkit-user-select: text;
          touch-action: pan-y pinch-zoom;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
        }

        .payroll-result-table:focus-visible {
          outline: 3px solid rgba(77,119,221,.22);
          outline-offset: 4px;
        }

        .payroll-result-table.is-dragging {
          cursor: grabbing;
          scroll-behavior: auto;
        }

        .payroll-result-table table {
          width: max-content !important;
          min-width: 1810px !important;
          max-width: none !important;
          table-layout: auto !important;
        }

        .payroll-run-table {
          width: 100%;
          min-width: 0;
          overflow-x: auto !important;
          overflow-y: hidden !important;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
        }

        .payroll-run-table table {
          width: 100% !important;
          min-width: 1120px !important;
          table-layout: auto !important;
        }

        .payroll-run-table th,
        .payroll-run-table td {
          overflow: visible;
          text-overflow: clip;
          white-space: nowrap !important;
        }

        .payroll-run-table th {
          padding: 9px 12px 11px !important;
          font-size: 9px !important;
          letter-spacing: .045em !important;
        }

        .payroll-run-table td {
          padding: 15px 12px !important;
          font-size: 10px !important;
        }

        .payroll-run-table .payroll-employee-name {
          display: block;
          overflow: visible;
          text-overflow: clip;
          white-space: nowrap;
          font-size: 10px !important;
        }

        .payroll-run-table th:nth-child(1),
        .payroll-run-table td:nth-child(1) { min-width: 220px !important; }

        .payroll-run-table th:nth-child(2),
        .payroll-run-table td:nth-child(2) { min-width: 105px !important; }

        .payroll-run-table th:nth-child(3),
        .payroll-run-table td:nth-child(3) { min-width: 135px !important; }

        .payroll-run-table th:nth-child(4),
        .payroll-run-table td:nth-child(4) { min-width: 95px !important; }

        .payroll-run-table th:nth-child(5),
        .payroll-run-table td:nth-child(5) { min-width: 125px !important; }

        .payroll-run-table th:nth-child(6),
        .payroll-run-table td:nth-child(6) { min-width: 135px !important; }

        .payroll-run-table th:nth-child(7),
        .payroll-run-table td:nth-child(7) { min-width: 190px !important; }

        .payroll-run-table th:nth-child(8),
        .payroll-run-table td:nth-child(8) { min-width: 160px !important; }

        .payroll-run-table .payroll-run-actions {
          flex-wrap: nowrap !important;
          gap: 6px !important;
        }

        .payroll-run-table .payroll-run-actions button {
          min-height: 38px !important;
          padding: 8px 9px !important;
          font-size: 9px !important;
        }

        .payroll-result-table th:nth-child(1),
        .payroll-result-table td:nth-child(1) { min-width: 155px; }

        .payroll-result-table th:nth-child(2),
        .payroll-result-table td:nth-child(2) { min-width: 90px; }

        .payroll-result-table th:nth-child(3),
        .payroll-result-table td:nth-child(3) { min-width: 70px; }

        .payroll-result-table th:nth-child(4),
        .payroll-result-table td:nth-child(4) { min-width: 120px; }

        .payroll-result-table th:nth-child(5),
        .payroll-result-table td:nth-child(5) { min-width: 125px; }

        .payroll-result-table th:nth-child(6),
        .payroll-result-table td:nth-child(6),
        .payroll-result-table th:nth-child(7),
        .payroll-result-table td:nth-child(7) { min-width: 95px; }

        .payroll-result-table th:nth-child(8),
        .payroll-result-table td:nth-child(8) {
          min-width: 220px;
          white-space: nowrap !important;
        }

        .payroll-result-table th:nth-child(9),
        .payroll-result-table td:nth-child(9) { min-width: 120px; }

        .payroll-result-table th:nth-child(10),
        .payroll-result-table td:nth-child(10) { min-width: 150px; }

        .payroll-result-table th:nth-child(11),
        .payroll-result-table td:nth-child(11) { min-width: 155px; }

        .payroll-result-table th:nth-child(12),
        .payroll-result-table td:nth-child(12) { min-width: 145px; }

        .payroll-result-table th:nth-child(13),
        .payroll-result-table td:nth-child(13) { min-width: 145px; }

        .payroll-result-table th:nth-child(14),
        .payroll-result-table td:nth-child(14) {
          min-width: 190px;
          white-space: nowrap !important;
        }

        .payroll-tax-source {
          min-width: 0;
        }

        .payroll-tax-source small {
          white-space: nowrap;
        }

        .payroll-results-full-window-layer {
          position: fixed;
          z-index: 2147483647;
          inset: 0;
          display: grid;
          width: 100vw;
          height: 100dvh;
          padding: 12px;
          overflow: hidden;
          overscroll-behavior: contain;
          background: rgba(20, 27, 70, .44);
          backdrop-filter: blur(14px) saturate(1.04);
          -webkit-backdrop-filter: blur(14px) saturate(1.04);
          isolation: isolate;
        }

        .payroll-results-full-window {
          position: relative !important;
          z-index: 1 !important;
          inset: auto !important;
          display: flex !important;
          flex-direction: column;
          width: 100% !important;
          max-width: none !important;
          height: 100% !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 16px 18px 14px !important;
          overflow: hidden !important;
          border: 1px solid rgba(171,181,211,.78) !important;
          border-radius: 26px !important;
          background: #f8f9ff !important;
          box-shadow:
            0 30px 80px rgba(15, 22, 61, .34),
            7px 9px 0 rgba(201,192,255,.72) !important;
        }

        .payroll-results-full-window .payroll-table-head,
        .payroll-results-full-window .payroll-table-tools,
        .payroll-results-full-window .payroll-section-pagination,
        .payroll-results-full-window > .payroll-inline-feedback {
          flex: 0 0 auto;
        }

        .payroll-results-full-window .payroll-table-head {
          margin-bottom: 8px;
        }

        .payroll-results-full-window .payroll-table-head p {
          margin-top: 3px;
          font-size: 10px;
          line-height: 1.35;
        }

        .payroll-results-full-window .payroll-table-tools {
          margin: 10px 0 12px !important;
        }

        .payroll-results-full-window .payroll-table-tools .payroll-search input {
          min-height: 46px !important;
          font-size: 12px !important;
        }

        .payroll-results-full-window .payroll-section-page-size-control select {
          min-height: 42px !important;
          min-width: 104px !important;
          font-size: 10px !important;
        }

        .payroll-results-full-window .payroll-result-card-grid {
          display: none;
        }

        .payroll-results-full-window .payroll-result-table {
          flex: 1 1 auto;
          min-height: 0;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          cursor: default;
          touch-action: auto;
        }

        .payroll-results-full-window .payroll-result-table table {
          width: 100% !important;
          min-width: 0 !important;
          table-layout: fixed;
        }

        .payroll-results-full-window .payroll-result-table th,
        .payroll-results-full-window .payroll-result-table td {
          min-width: 0 !important;
          padding: 8px 4px !important;
          overflow: visible;
          text-overflow: clip;
          white-space: nowrap !important;
          font-size: clamp(7px, .52vw, 10px) !important;
          line-height: 1.2;
        }

        .payroll-results-full-window .payroll-result-table th {
          font-size: clamp(6.5px, .48vw, 9px) !important;
          letter-spacing: .025em !important;
        }

        .payroll-results-full-window .payroll-result-table th:nth-child(1),
        .payroll-results-full-window .payroll-result-table td:nth-child(1) { width: 9%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(2),
        .payroll-results-full-window .payroll-result-table td:nth-child(2) { width: 4.5%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(3),
        .payroll-results-full-window .payroll-result-table td:nth-child(3) { width: 3.5%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(4),
        .payroll-results-full-window .payroll-result-table td:nth-child(4) { width: 7%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(5),
        .payroll-results-full-window .payroll-result-table td:nth-child(5) { width: 7%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(6),
        .payroll-results-full-window .payroll-result-table td:nth-child(6) { width: 5%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(7),
        .payroll-results-full-window .payroll-result-table td:nth-child(7) { width: 5%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(8),
        .payroll-results-full-window .payroll-result-table td:nth-child(8) { width: 12%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(9),
        .payroll-results-full-window .payroll-result-table td:nth-child(9) { width: 6.5%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(10),
        .payroll-results-full-window .payroll-result-table td:nth-child(10) { width: 8%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(11),
        .payroll-results-full-window .payroll-result-table td:nth-child(11) { width: 8.5%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(12),
        .payroll-results-full-window .payroll-result-table td:nth-child(12) { width: 7%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(13),
        .payroll-results-full-window .payroll-result-table td:nth-child(13) { width: 7%; }
        .payroll-results-full-window .payroll-result-table th:nth-child(14),
        .payroll-results-full-window .payroll-result-table td:nth-child(14) { width: 9%; }

        .payroll-results-full-window .payroll-employee-name,
        .payroll-results-full-window .payroll-employee-meta {
          display: inline !important;
          margin: 0 !important;
          white-space: nowrap !important;
          font-size: inherit !important;
        }

        .payroll-results-full-window .payroll-employee-meta::before {
          content: " · ";
        }

        .payroll-results-full-window .payroll-tax-source {
          display: flex;
          align-items: center;
          gap: 3px;
          flex-wrap: nowrap;
          white-space: nowrap;
        }

        .payroll-results-full-window .payroll-tax-source small {
          display: inline;
          white-space: nowrap !important;
          font-size: clamp(6px, .44vw, 8px) !important;
        }

        .payroll-results-full-window .payroll-status {
          padding: 4px 6px;
          white-space: nowrap;
          font-size: clamp(6px, .44vw, 8px) !important;
        }

        .payroll-results-full-window .payroll-bank-ready,
        .payroll-results-full-window .payroll-bank-missing {
          gap: 3px;
          white-space: nowrap;
          font-size: clamp(6.5px, .46vw, 9px) !important;
        }

        .payroll-results-full-window .payroll-bank-ready svg,
        .payroll-results-full-window .payroll-bank-missing svg {
          width: 11px;
          height: 11px;
        }

        .payroll-results-full-window .payroll-pdf-actions {
          display: flex !important;
          align-items: center !important;
          gap: 3px !important;
          flex-wrap: nowrap !important;
        }

        .payroll-results-full-window .payroll-pdf-actions button {
          min-height: 30px !important;
          padding: 5px 6px !important;
          border-radius: 9px !important;
          font-size: clamp(6px, .44vw, 8px) !important;
        }

        .payroll-results-full-window .payroll-pdf-actions button svg {
          width: 10px;
          height: 10px;
        }

        .payroll-results-full-window .payroll-pdf-feedback {
          position: absolute;
          z-index: 5;
          right: 16px;
          bottom: 68px;
          width: min(420px, calc(100vw - 32px));
          min-width: 0;
        }

        .payroll-results-full-window .payroll-section-pagination {
          margin-top: 10px;
          padding-top: 10px;
        }

        @media (max-width: 760px) {
          .payroll-results-full-window {
            overflow-x: hidden !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch;
            overscroll-behavior-y: contain;
          }

          .payroll-results-full-window .payroll-result-scroll-shell {
            display: none !important;
          }

          .payroll-results-full-window .payroll-result-card-grid {
            display: grid;
            grid-template-columns: 1fr;
            align-content: start;
            gap: 14px;
            flex: 0 0 auto;
            min-height: auto;
            overflow: visible;
            padding: 4px 3px 16px 4px;
            overscroll-behavior: auto;
          }

          .payroll-results-full-window .payroll-result-card {
            display: grid;
            grid-template-rows: auto auto auto;
            align-content: start;
            min-width: 0;
            overflow: hidden;
            border: 1px solid rgba(171,181,211,.66);
            border-radius: 20px;
            background: #ffffff;
            box-shadow:
              5px 7px 0 #c8d1ff,
              0 15px 26px rgba(34,38,110,.07);
          }

          .payroll-results-full-window .payroll-result-card-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 14px;
            min-width: 0;
            padding: 15px;
            border-bottom: 1px solid rgba(171,181,211,.36);
            background:
              linear-gradient(
                90deg,
                rgba(232,247,255,.96) 0%,
                rgba(255,255,255,.98) 52%,
                rgba(242,238,255,.96) 100%
              );
          }

          .payroll-results-full-window .payroll-result-card-head > div {
            display: grid;
            gap: 3px;
            min-width: 0;
          }

          .payroll-results-full-window .payroll-result-card-head strong {
            overflow-wrap: anywhere;
            color: #101a3a;
            font-family: Georgia, "Times New Roman", serif;
            font-size: clamp(18px, 6vw, 24px);
            line-height: 1.06;
          }

          .payroll-results-full-window .payroll-result-card-head small {
            color: #667492;
            font-size: 10px;
            font-weight: 800;
          }

          .payroll-results-full-window .payroll-result-card-eyebrow,
          .payroll-results-full-window .payroll-result-card-field > span {
            color: #68738f;
            font-size: 8.5px;
            font-weight: 950;
            letter-spacing: .065em;
            line-height: 1.2;
            text-transform: uppercase;
          }

          .payroll-results-full-window .payroll-result-card-fields {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 9px;
            padding: 13px 14px 15px;
          }

          .payroll-results-full-window .payroll-result-card-field {
            display: grid;
            align-content: start;
            gap: 7px;
            min-width: 0;
            min-height: 68px;
            padding: 11px;
            border: 1px solid rgba(171,181,211,.42);
            border-radius: 15px;
            background: #f8fbff;
          }

          .payroll-results-full-window .payroll-result-card-field:nth-child(4n + 2) {
            background: #f8f6ff;
          }

          .payroll-results-full-window .payroll-result-card-field:nth-child(4n + 3) {
            background: #f2fbf8;
          }

          .payroll-results-full-window .payroll-result-card-field:nth-child(4n + 4) {
            background: #fff9eb;
          }

          .payroll-results-full-window .payroll-result-card-field strong {
            min-width: 0;
            color: #17213d;
            font-size: 11px;
            font-weight: 900;
            line-height: 1.35;
            overflow-wrap: anywhere;
          }

          .payroll-results-full-window .payroll-result-card-field-net {
            border-color: rgba(72,176,139,.32);
            background: #eaf9f4 !important;
          }

          .payroll-results-full-window .payroll-result-card-field-net strong {
            color: #087659;
            font-size: 13px;
          }

          .payroll-results-full-window .payroll-result-card-field-wide {
            grid-column: 1 / -1;
          }

          .payroll-results-full-window .payroll-result-card-tax {
            display: grid;
            gap: 3px;
            min-width: 0;
          }

          .payroll-results-full-window .payroll-result-card-tax small {
            color: #63718e;
            font-size: 9px;
            line-height: 1.35;
            overflow-wrap: anywhere;
          }

          .payroll-results-full-window .payroll-result-card-field .payroll-bank-ready,
          .payroll-results-full-window .payroll-result-card-field .payroll-bank-missing {
            align-self: start;
            white-space: nowrap;
            font-size: 10px !important;
          }

          .payroll-results-full-window .payroll-result-card-footer {
            display: grid;
            grid-template-columns: 1fr;
            align-items: stretch;
            gap: 9px;
            min-width: 0;
            padding: 13px 14px 15px;
            border-top: 1px solid rgba(171,181,211,.36);
            background: #fbfcff;
          }

          .payroll-results-full-window .payroll-result-card-footer .payroll-pdf-actions {
            display: flex !important;
            align-items: center !important;
            justify-content: stretch;
            gap: 9px !important;
            min-width: 0;
            flex-wrap: wrap !important;
          }

          .payroll-results-full-window .payroll-result-card-footer .payroll-pdf-actions button {
            flex: 1 1 0;
            min-height: 38px !important;
            padding: 8px 11px !important;
            border-radius: 12px !important;
            font-size: 9px !important;
          }

          .payroll-results-full-window .payroll-result-card-footer .payroll-pdf-feedback {
            position: static !important;
            flex: 1 1 100%;
            width: 100%;
            min-width: 0 !important;
          }

          .payroll-results-full-window .payroll-section-pagination {
            flex: 0 0 auto;
            margin-top: 10px;
            padding-top: 10px;
          }
        }

        @media (max-width: 430px) {
          .payroll-results-full-window .payroll-result-card-head {
            flex-direction: column;
          }

          .payroll-results-full-window .payroll-result-card-fields {
            grid-template-columns: 1fr;
          }

          .payroll-results-full-window .payroll-result-card-field-wide {
            grid-column: 1;
          }

          .payroll-results-full-window .payroll-result-card-footer .payroll-pdf-actions {
            display: grid !important;
            grid-template-columns: 1fr !important;
          }

          .payroll-results-full-window .payroll-result-card-footer .payroll-pdf-actions button {
            width: 100%;
          }
        }

        @media (max-width: 980px) {
          .payroll-run-table {
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch;
            overscroll-behavior-x: contain;
          }

          .payroll-run-table table {
            min-width: 1120px !important;
          }
        }

        /* ---------- TABLE ACTION BUTTONS ----------
           Same recent-page language:
           primary = blue -> cyan + deep-violet offset shadow
           secondary = white/lavender + soft lavender offset shadow */
        .payroll-run-actions,
        .payroll-pdf-actions {
          gap: 10px !important;
          align-items: flex-start !important;
        }

        .payroll-run-actions button,
        .payroll-pdf-actions button {
          min-height: 44px !important;
          padding: 10px 15px !important;
          border-radius: 14px !important;
          font-size: 11px !important;
          font-weight: 900 !important;
          line-height: 1 !important;
          white-space: nowrap;
        }

        .payroll-run-actions .primary,
        .payroll-pdf-actions .primary {
          border: 1px solid rgba(77,119,221,.20) !important;
          color: #ffffff !important;
          background:
            linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
          box-shadow:
            4px 5px 0 #575092,
            0 12px 22px rgba(67,116,170,.13) !important;
        }

        .payroll-run-actions .secondary,
        .payroll-pdf-actions .secondary {
          border: 1px solid rgba(102,88,220,.20) !important;
          color: #40348d !important;
          background: #ffffff !important;
          box-shadow:
            4px 5px 0 #d7d2ff,
            0 10px 20px rgba(52,43,120,.06) !important;
        }

        .payroll-run-actions button:disabled,
        .payroll-pdf-actions button:disabled {
          opacity: .58 !important;
          cursor: not-allowed !important;
          transform: none !important;
        }

        @media (hover: hover) and (pointer: fine) {
          .payroll-run-actions .primary:hover:not(:disabled),
          .payroll-pdf-actions .primary:hover:not(:disabled),
          .payroll-run-actions .secondary:hover:not(:disabled),
          .payroll-pdf-actions .secondary:hover:not(:disabled) {
            transform: translateY(-2px) !important;
          }
        }

        .payroll-bank-ready,
        .payroll-bank-missing {
          white-space: nowrap;
        }

        /* ---------- WORKFLOW POPUP ---------- */
        .payroll-modal-backdrop {
          z-index: 1400 !important;
          padding: clamp(14px, 3vw, 30px) !important;
          overflow: hidden !important;
          background: rgba(22, 28, 65, .48) !important;
          backdrop-filter: blur(10px) saturate(1.05) !important;
          -webkit-backdrop-filter: blur(10px) saturate(1.05) !important;
        }

        .payroll-modal {
          width: min(680px, 100%) !important;
          max-height: min(88dvh, 820px) !important;
          overflow: auto !important;
          overscroll-behavior: contain;
          border: 1px solid rgba(171,181,211,.78) !important;
          border-radius: 30px !important;
          background: #ffffff !important;
          box-shadow:
            11px 13px 0 #c9c0ff,
            0 34px 76px rgba(20,27,70,.28) !important;
          scrollbar-width: thin;
          scrollbar-color: rgba(102,88,220,.30) transparent;
        }

        .payroll-modal-head {
          position: sticky;
          z-index: 3;
          top: 0;
          padding: 22px 24px 18px !important;
          border-bottom: 1px solid rgba(171,181,211,.42) !important;
          border-radius: 29px 29px 0 0;
          background:
            linear-gradient(
              90deg,
              #e8fbff 0%,
              #ffffff 50%,
              #f1edff 100%
            ) !important;
        }

        .payroll-modal-head h3 {
          color: #101a3a !important;
          font-size: clamp(27px, 4vw, 38px) !important;
        }

        .payroll-modal-head p {
          color: #66738f !important;
          font-size: 11px;
          font-weight: 750;
        }

        .payroll-modal-close {
          width: 44px !important;
          height: 44px !important;
          flex: 0 0 44px !important;
          border: 1px solid rgba(102,88,220,.18) !important;
          border-radius: 14px !important;
          color: #40348d !important;
          background: #ffffff !important;
          box-shadow: 3px 4px 0 #d7d2ff !important;
        }

        .payroll-modal-body {
          gap: 16px !important;
          padding: 22px 24px 18px !important;
          background: #ffffff;
        }

        .payroll-modal-body .payroll-note {
          border-color: rgba(102,88,220,.18) !important;
          color: #40348d !important;
          background: #f5f5ff !important;
          box-shadow: 4px 5px 0 #d7d2ff !important;
        }

        .payroll-modal-field > span {
          color: #53617f !important;
          font-size: 10px !important;
          font-weight: 950 !important;
          letter-spacing: .04em;
          text-transform: uppercase;
        }

        .payroll-modal-field input,
        .payroll-modal-field select,
        .payroll-modal-field textarea {
          border: 1px solid rgba(159,169,205,.62) !important;
          border-radius: 14px !important;
          color: #101a3a !important;
          background: #ffffff !important;
          box-shadow: none !important;
        }

        .payroll-modal-field input:focus,
        .payroll-modal-field select:focus,
        .payroll-modal-field textarea:focus {
          border-color: rgba(77,119,221,.76) !important;
          box-shadow: 0 0 0 4px rgba(77,119,221,.09) !important;
          transform: none !important;
        }

        .payroll-modal-actions {
          position: sticky;
          z-index: 3;
          bottom: 0;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 10px !important;
          padding: 16px 24px 22px !important;
          border-top: 1px solid rgba(171,181,211,.42);
          border-radius: 0 0 29px 29px;
          background: rgba(250,251,255,.98);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .payroll-modal-actions > button {
          width: 100%;
          min-height: 48px;
          justify-content: center;
          border-radius: 14px !important;
        }

        .payroll-modal-actions .primary {
          border: 1px solid rgba(77,119,221,.20) !important;
          color: #ffffff !important;
          background:
            linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
          box-shadow:
            4px 5px 0 #575092,
            0 12px 22px rgba(67,116,170,.13) !important;
        }

        .payroll-modal-actions .secondary {
          border: 1px solid rgba(102,88,220,.20) !important;
          color: #40348d !important;
          background: #ffffff !important;
          box-shadow: 4px 5px 0 #d7d2ff !important;
        }

        .payroll-modal-feedback {
          grid-column: 1 / -1;
          margin-bottom: 2px;
        }

        .payroll-modal-feedback.payroll-inline-feedback {
          border-radius: 14px !important;
        }

        @media (max-width: 680px) {
          .payroll-metric strong {
            font-size: clamp(15px, 6.6cqi, 26px) !important;
          }

          .payroll-page .table-wrap,
          .payroll-selector-table,
          .payroll-input-table,
          .payroll-result-table,
          .payroll-run-table,
          .payroll-sync-table {
            padding: 9px 9px 14px !important;
            border-radius: 21px !important;
            box-shadow:
              6px 8px 0 #c4ccff,
              0 18px 30px rgba(34,38,110,.08) !important;
          }

          .payroll-page tbody td:first-child {
            border-radius: 16px 0 0 16px !important;
          }

          .payroll-page tbody td:last-child {
            border-radius: 0 16px 16px 0 !important;
          }

          .payroll-results-full-window-layer {
            padding: 6px;
          }

          .payroll-results-full-window {
            border-radius: 18px !important;
            padding: 12px 10px 10px !important;
          }

          .payroll-modal {
            max-height: calc(100dvh - 24px) !important;
            border-radius: 23px !important;
            box-shadow:
              7px 9px 0 #c9c0ff,
              0 24px 52px rgba(20,27,70,.25) !important;
          }

          .payroll-modal-head {
            padding: 18px 17px 15px !important;
            border-radius: 22px 22px 0 0;
          }

          .payroll-modal-body {
            padding: 17px !important;
          }

          .payroll-modal-grid {
            grid-template-columns: 1fr !important;
          }

          .payroll-modal-actions {
            grid-template-columns: 1fr !important;
            padding: 14px 17px 18px !important;
            border-radius: 0 0 22px 22px;
          }

          .payroll-modal-feedback {
            grid-column: 1;
          }
        }

        @media (max-width: 430px) {
          .payroll-metric strong {
            font-size: clamp(14px, 6.2cqi, 23px) !important;
          }

          .payroll-run-actions button,
          .payroll-pdf-actions button {
            min-height: 42px !important;
            padding: 9px 12px !important;
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

          <div className="payroll-action-stack payroll-refresh-stack">
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

            <PayrollInlineMessage
              feedback={inlineFeedback.refresh}
              onClose={() => clearInlineFeedback('refresh')}
            />
          </div>
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

        {periodRuns.length ? (
          <div className="payroll-note">
            <ShieldCheck size={19} />
            <div>
              <strong>
                Employee-level payroll eligibility for {period}.
              </strong>{' '}
              {periodRuns.length} payroll run{periodRuns.length === 1 ? '' : 's'} exist for this month.
              {' '}Attendance eligible: {attendanceEligibleEmployeeIds.length}; attendance blocked: {attendanceBlockedEmployees.length}.
              {' '}Calculation eligible: {calculationEligibleEmployeeIds.length}; calculation skipped: {calculationBlockedEmployees.length}.
              {calculationRun ? (
                <> Draft recalculation target: {safeText(calculationRun.run_code, resolveRunId(calculationRun).slice(-8))}.</>
              ) : editablePeriodRuns.length > 1 ? (
                <> Select the required Draft run before recalculating employees already present in Draft payroll.</>
              ) : null}
            </div>
          </div>
        ) : null}

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
                (scope === 'selected' && selectedIds.length === 0) ||
                attendanceEligibleEmployeeIds.length === 0
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
            disabled={
              calculating ||
              syncingAttendance ||
              loadingEmployees ||
              calculationEligibleEmployeeIds.length === 0
            }
          >
            {calculating ? <Loader2 size={18} className="spin" /> : <Calculator size={18} />}
            {calculating ? 'Calculating payroll…' : 'Calculate Draft Payroll'}
          </button>
        </div>

        <div className="payroll-action-feedback-grid">
          <PayrollInlineMessage
            feedback={inlineFeedback['attendance-sync']}
            onClose={() => clearInlineFeedback('attendance-sync')}
          />
          <PayrollInlineMessage
            feedback={inlineFeedback.calculation}
            onClose={() => clearInlineFeedback('calculation')}
          />
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

      {scope === 'all' && calculationBlockedEmployees.length ? (
        <section className="panel">
          <div className="payroll-table-head">
            <div>
              <h3>Employees that will be skipped</h3>
              <p>
                All active employees is selected. These employees already have payroll for
                this month; eligible employees will continue without them.
              </p>
            </div>
            <span className="payroll-status payroll-status-warning">
              {calculationBlockedEmployees.length} skipped
            </span>
          </div>

          <div className="table-wrap payroll-selector-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Code</th>
                  <th>Payroll status</th>
                  <th>Existing run</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {calculationBlockedEmployees.slice(0, 50).map((item) => (
                  <tr key={`${item.employee_id}-${item.run_id || item.payroll_status}`}>
                    <td className="payroll-employee-name">
                      {employeeName(item.employee)}
                    </td>
                    <td>{employeeCode(item.employee)}</td>
                    <td>
                      <span className={statusClass(item.payroll_status)}>
                        {statusLabel(item.payroll_status)}
                      </span>
                    </td>
                    <td>{safeText(item.run_code)}</td>
                    <td>{item.calculation_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {calculationBlockedEmployees.length > 50 ? (
            <div className="payroll-muted">
              Showing the first 50 of {calculationBlockedEmployees.length} skipped employees.
            </div>
          ) : null}
        </section>
      ) : null}

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
                onChange={(event) => {
                  setEmployeeSearch(event.target.value);
                  setEmployeeTablePage(1);
                }}
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
                  <th>Payroll status</th>
                  <th>Eligibility</th>
                  <th>Existing run</th>
                </tr>
              </thead>
              <tbody>
                {employeeTableRows.map((employee) => {
                  const id = employeeId(employee);
                  const eligibility = employeeEligibilityMap.get(id) || {
                    payroll_status: 'not_processed',
                    attendance_eligible: true,
                    calculation_eligible: true,
                    calculation_reason: 'Not processed for this month.',
                    run_code: '',
                  };

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
                      <td>
                        <span className={statusClass(eligibility.payroll_status)}>
                          {statusLabel(eligibility.payroll_status)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            eligibility.calculation_eligible
                              ? 'payroll-status payroll-status-success'
                              : 'payroll-status payroll-status-danger'
                          }
                          title={eligibility.calculation_reason}
                        >
                          {eligibility.calculation_eligible
                            ? eligibility.payroll_status === 'draft'
                              ? 'Recalculation eligible'
                              : 'Eligible'
                            : 'Not eligible'}
                        </span>
                      </td>
                      <td>{safeText(eligibility.run_code)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {renderTablePagination(
            filteredEmployees.length,
            employeeTablePage,
            setEmployeeTablePage,
          )}

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
              <span>Eligible</span>
              <strong>{toNumber(attendanceSyncResult.totals?.employees_eligible, 0)}</strong>
            </article>
            <article className="payroll-sync-metric">
              <span>Already processed</span>
              <strong>{toNumber(attendanceSyncResult.totals?.employees_blocked, 0)}</strong>
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

          <div className="payroll-table-tools">
            <div className="payroll-search">
              <Search size={17} />
              <input
                value={syncTableSearch}
                onChange={(event) => {
                  setSyncTableSearch(event.target.value);
                  setSyncTablePage(1);
                }}
                placeholder="Search synchronized employees"
                aria-label="Search synchronized attendance"
              />
            </div>
            <span className="payroll-table-count">
              {filteredSyncRows.length} record{filteredSyncRows.length === 1 ? '' : 's'}
            </span>
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
                {syncTableRows.map((item) => {
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

          {renderTablePagination(
            filteredSyncRows.length,
            syncTablePage,
            setSyncTablePage,
          )}

          {!attendanceSyncResult.items?.length ? (
            <div className="empty">No attendance summaries were synchronized.</div>
          ) : !filteredSyncRows.length ? (
            <div className="empty">No synchronized attendance records match your search.</div>
          ) : null}
        </section>
      ) : null}

      {attendanceSyncSkipped.length ? (
        <section className="panel payroll-error-box">
          <h3>Employees skipped from attendance synchronization</h3>
          <p>
            These employees already have payroll in HR Review, Finance Approval,
            Locked or Disbursed status. Other eligible employees were still synchronized.
          </p>

          <div className="payroll-error-list">
            {attendanceSyncSkipped.map((item, index) => (
              <article
                className="payroll-error-item"
                key={`${safeText(item.employee_id, 'employee')}-${safeText(item.run_id, index)}`}
              >
                <strong>
                  {safeText(item.employee_name, 'Employee')}
                  {item.employee_code ? ` (${item.employee_code})` : ''}
                </strong>
                <p>
                  {statusLabel(item.status)}
                  {item.run_code ? ` — ${item.run_code}` : ''}.{' '}
                  {safeText(item.message || item.reason, 'Already processed for this month.')}
                </p>
              </article>
            ))}
          </div>
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

          <div className="payroll-table-tools">
            <div className="payroll-search">
              <Search size={17} />
              <input
                value={manualTableSearch}
                onChange={(event) => {
                  setManualTableSearch(event.target.value);
                  setManualTablePage(1);
                }}
                placeholder="Search employees in manual attendance"
                aria-label="Search manual attendance employees"
              />
            </div>
            <span className="payroll-table-count">
              {filteredManualRows.length} employee{filteredManualRows.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="table-wrap payroll-input-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Eligibility</th>
                  <th>Total days</th>
                  <th>Working days</th>
                  <th>Paid leave</th>
                  <th>LWP days *</th>
                </tr>
              </thead>
              <tbody>
                {manualTableRows.map((employee) => {
                  const id = employeeId(employee);
                  const input = manualInputs[id] || emptyManualInput(totalDays);
                  const eligibility = employeeEligibilityMap.get(id) || {
                    payroll_status: 'not_processed',
                    calculation_eligible: true,
                    calculation_reason: 'Not processed for this month.',
                  };

                  return (
                    <tr key={id}>
                      <td>
                        <span className="payroll-employee-name">{employeeName(employee)}</span>
                        <span className="payroll-employee-meta">{employeeCode(employee)}</span>
                      </td>
                      <td>
                        <span
                          className={
                            eligibility.calculation_eligible
                              ? 'payroll-status payroll-status-success'
                              : 'payroll-status payroll-status-danger'
                          }
                          title={eligibility.calculation_reason}
                        >
                          {eligibility.calculation_eligible
                            ? eligibility.payroll_status === 'draft'
                              ? 'Recalculation eligible'
                              : 'Eligible'
                            : statusLabel(eligibility.payroll_status)}
                        </span>
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
                          disabled={!eligibility.calculation_eligible}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={input.paid_leave_days}
                          onChange={(event) => updateManualInput(id, 'paid_leave_days', event.target.value)}
                          disabled={!eligibility.calculation_eligible}
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
                          required={eligibility.calculation_eligible}
                          disabled={!eligibility.calculation_eligible}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {renderTablePagination(
            filteredManualRows.length,
            manualTablePage,
            setManualTablePage,
          )}

          {!targetEmployees.length ? (
            <div className="empty">
              {scope === 'selected'
                ? 'Select at least one employee to enter manual attendance.'
                : 'Load employees to enter manual attendance.'}
            </div>
          ) : !filteredManualRows.length ? (
            <div className="empty">No employees match your manual-attendance search.</div>
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

      {calculationSkipped.length ? (
        <section className="panel payroll-error-box">
          <h3>Employees skipped as already processed</h3>
          <p>
            Eligible employees were processed. These employees were excluded to prevent
            duplicate payroll for the same tenant, month and employee.
          </p>

          <div className="payroll-error-list">
            {calculationSkipped.map((item, index) => (
              <article
                className="payroll-error-item"
                key={`${safeText(item.employee_id, 'employee')}-${safeText(item.run_id, index)}`}
              >
                <strong>
                  {safeText(item.employee_name, 'Employee')}
                  {item.employee_code ? ` (${item.employee_code})` : ''}
                </strong>
                <p>
                  {statusLabel(item.status)}
                  {item.run_code ? ` — ${item.run_code}` : ''}.{' '}
                  {safeText(item.reason || item.message, 'Already processed for this month.')}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {calculationErrors.length ? (
        <section className="panel payroll-error-box">
          <h3>Payroll configuration missing</h3>
          <p>
            These employees could not be calculated. Other eligible employees may still
            have been saved in the Draft run.
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

          <div className="payroll-table-head-actions">
            {loadingRuns ? (
              <span className="payroll-muted">
                <Loader2 size={15} className="spin" /> Loading runs…
              </span>
            ) : null}

            <button
              type="button"
              className={
                showAllRunResults
                  ? 'primary payroll-table-head-button'
                  : 'secondary payroll-table-head-button'
              }
              onClick={viewAllPayrollRuns}
              disabled={loadingRuns || !runs.length}
              aria-pressed={showAllRunResults}
            >
              <Eye size={15} />
              {showAllRunResults ? 'Viewing all' : 'View all'}
            </button>

            <button
              type="button"
              className="secondary payroll-table-head-button"
              onClick={resetPayrollRunView}
              disabled={loadingRuns}
            >
              <RefreshCw size={15} />
              Reset
            </button>
          </div>
        </div>

        <div className="payroll-feedback-stack">
          <PayrollInlineMessage
            feedback={inlineFeedback.workflow}
            onClose={() => clearInlineFeedback('workflow')}
          />
          <PayrollInlineMessage
            feedback={inlineFeedback['workflow-followup-loan']}
            onClose={() => clearInlineFeedback('workflow-followup-loan')}
          />
          <PayrollInlineMessage
            feedback={inlineFeedback['workflow-followup-reimbursement']}
            onClose={() => clearInlineFeedback('workflow-followup-reimbursement')}
          />
        </div>

        <div className="payroll-table-tools payroll-section-table-tools">
          <div className="payroll-search">
            <Search size={17} />
            <input
              value={runTableSearch}
              onChange={(event) => {
                setRunTableSearch(event.target.value);
                setRunTablePage(1);
              }}
              placeholder="Search run, period or status"
              aria-label="Search payroll runs"
            />
          </div>

          <label className="payroll-section-page-size-control">
            <span>Rows per page</span>
            <select
              value={runRowsPerPage}
              onChange={(event) => {
                setRunRowsPerPage(event.target.value);
                setRunTablePage(1);
              }}
              aria-label="Recent payroll runs rows per page"
            >
              <option value="all">View all</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
            </select>
          </label>

          <span className="payroll-table-count">
            {filteredRunRows.length} run{filteredRunRows.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="payroll-horizontal-scroll-shell payroll-run-scroll-shell">
          <div
            ref={runTableScrollRef}
            className="table-wrap payroll-run-table"
          >
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
              {runTableRows.map((run) => {
                const runId = resolveRunId(run);
                const totals = resolveRunTotals(run);
                const isActive = resolveRunId(activeRun) === runId;

                return (
                  <tr
                    key={runId}
                    className={
                      showAllRunResults || isActive
                        ? 'payroll-active-row'
                        : ''
                    }
                  >
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
                      <div className="payroll-run-actions">
                        <button
                          type="button"
                          className={isActive && !showAllRunResults ? 'primary' : 'secondary'}
                          onClick={() => {
                            setShowAllRunResults(false);
                            setResultTablePage(1);
                            setActiveRun(run);
                          }}
                        >
                          {isActive && !showAllRunResults ? 'Selected' : 'View results'}
                        </button>
                        {renderWorkflowActionButton(run, true)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>

          <PayrollContainedScrollbar
            scrollRef={runTableScrollRef}
            refreshKey={`${runTableRows.length}:${runTablePage}:${runRowsPerPage}:${runTableSearch}`}
            ariaLabel="Recent payroll runs horizontal scrollbar"
          />
        </div>

        {renderPayrollSectionPagination(
          filteredRunRows.length,
          runTablePage,
          setRunTablePage,
          'Recent payroll runs pagination',
          runTablePageSize,
        )}

        {!runs.length && !loadingRuns ? (
          <div className="empty">No payroll run has been created yet.</div>
        ) : runs.length && !filteredRunRows.length ? (
          <div className="empty">No payroll runs match your search.</div>
        ) : null}
      </section>

      {activeRun && !showAllRunResults ? (
        <section className="panel payroll-workflow-panel">
          <div className="payroll-workflow-main">
            <div className="payroll-workflow-copy">
              <h3>
                <ShieldCheck size={20} />
                Payroll approval workflow
              </h3>
              <div className="payroll-workflow-meta">
                <span>
                  Run: {safeText(activeRun.run_code, resolveRunId(activeRun).slice(-8))}
                </span>
                <span>
                  Period: {safeText(activeRun.period_key || activeRun.month)}
                </span>
                <span>
                  Current stage: {statusLabel(
                    activeRun.status || activeRun.workflow_stage,
                  )}
                </span>
              </div>
              <p>{workflowInstruction(activeRun)}</p>
            </div>

            {renderWorkflowActionButton(activeRun)}
          </div>

          {!workflowActionForStatus(
            activeRun.status || activeRun.workflow_stage,
          ) ? null : !canPerformWorkflowAction(
              workflowActionForStatus(
                activeRun.status || activeRun.workflow_stage,
              ),
            ) ? (
            <div className="payroll-workflow-waiting">
              Your login can view this payroll run, but the next workflow action
              must be completed by the role shown above.
            </div>
          ) : null}
        </section>
      ) : null}

      <PayrollResultsPortal active={resultTableFullWindow}>
      <section
        className={
          resultTableFullWindow
            ? 'panel payroll-results-section payroll-results-full-window'
            : 'panel payroll-results-section'
        }
        role={resultTableFullWindow ? 'dialog' : undefined}
        aria-modal={resultTableFullWindow ? 'true' : undefined}
        aria-label={resultTableFullWindow ? 'Payroll results full window' : undefined}
      >
        <div className="payroll-table-head">
          <div>
            <h3 className="payroll-table-title">
              <FileText size={19} />
              Payroll results
              {showAllRunResults
                ? ' — All recent runs'
                : activeRun?.period_key
                  ? ` — ${activeRun.period_key}`
                  : ''}
            </h3>
            <p>
              The figures below are persisted payslip snapshots. Preview or download the
              exact server-generated PDF without recalculating any payroll value.
            </p>
          </div>

          <div className="payroll-table-head-actions">
            {showAllRunResults ? (
              <span className="payroll-status payroll-status-info">
                {runs.length} run{runs.length === 1 ? '' : 's'}
              </span>
            ) : activeRun ? (
              <span className={statusClass(activeRun.status || activeRun.workflow_stage)}>
                {statusLabel(activeRun.status || activeRun.workflow_stage)}
              </span>
            ) : null}

            <button
              type="button"
              className="secondary payroll-table-head-button"
              onClick={() => setResultTableFullWindow((current) => !current)}
              aria-pressed={resultTableFullWindow}
            >
              {resultTableFullWindow ? <X size={15} /> : <Eye size={15} />}
              {resultTableFullWindow ? 'Exit full window' : 'View in full window'}
            </button>
          </div>
        </div>

        <PayrollInlineMessage
          feedback={inlineFeedback.results}
          onClose={() => clearInlineFeedback('results')}
        />

        <div className="payroll-table-tools payroll-section-table-tools">
          <div className="payroll-search">
            <Search size={17} />
            <input
              value={resultTableSearch}
              onChange={(event) => {
                setResultTableSearch(event.target.value);
                setResultTablePage(1);
              }}
              placeholder="Search employee, code or TDS status"
              aria-label="Search payroll results"
            />
          </div>

          <label className="payroll-section-page-size-control">
            <span>Rows per page</span>
            <select
              value={resultRowsPerPage}
              onChange={(event) => {
                setResultRowsPerPage(event.target.value);
                setResultTablePage(1);
              }}
              aria-label="Payroll results rows per page"
            >
              <option value="all">View all</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
            </select>
          </label>

          <span className="payroll-table-count">
            {filteredResultRows.length} result{filteredResultRows.length === 1 ? '' : 's'}
          </span>
        </div>

        {resultTableFullWindow ? (
          <div className="payroll-result-card-grid">
            {resultTableRows.map((payslip) => {
              const totals = resolvePayslipTotals(payslip);
              const attendance = payslip.attendance || {};
              const taxDeclaration = resolveTaxDeclarationSnapshot(payslip);
              const tdsInstruction = resolveTdsInstructionSnapshot(payslip);
              const tdsMode = resolveTdsMode(payslip);
              const bankSnapshotAvailable = hasBankSnapshot(payslip);
              const employeeIdValue = resolvePayslipEmployeeId(payslip);
              const { year, month } = resolvePayrollPeriod(
                payslip,
                showAllRunResults ? {} : (activeRun || {}),
              );
              const previewKey = `${employeeIdValue}-${year}-${month}-preview`;
              const downloadKey = `${employeeIdValue}-${year}-${month}-download`;
              const pdfAvailable = Boolean(employeeIdValue && year && month);

              return (
                <article
                  key={safeText(payslip._id || payslip.employee_id)}
                  className="payroll-result-card"
                >
                  <div className="payroll-result-card-head">
                    <div>
                      <span className="payroll-result-card-eyebrow">Employee</span>
                      <strong>
                        {safeText(
                          payslip.employee_name || payslip.employee_info?.name,
                          'Employee',
                        )}
                      </strong>
                      <small>
                        {safeText(
                          payslip.employee_code || payslip.employee_info?.employee_code,
                        )}
                      </small>
                    </div>

                    <span className={statusClass(
                      tdsMode === 'disabled' ? 'draft' : 'reviewed'
                    )}>
                      {statusLabel(tdsMode)}
                    </span>
                  </div>

                  <div className="payroll-result-card-fields">
                    <div className="payroll-result-card-field">
                      <span>Paid days</span>
                      <strong>
                        {safeText(
                          attendance.payable_days ?? attendance.salary_paid_days,
                          '—',
                        )}
                      </strong>
                    </div>

                    <div className="payroll-result-card-field">
                      <span>LWP</span>
                      <strong>{safeText(attendance.lwp_days, '0')}</strong>
                    </div>

                    <div className="payroll-result-card-field">
                      <span>Gross</span>
                      <strong>{formatCurrency(totals.gross_salary)}</strong>
                    </div>

                    <div className="payroll-result-card-field">
                      <span>Employer PF</span>
                      <strong>{formatCurrency(totals.pf_employer)}</strong>
                    </div>

                    <div className="payroll-result-card-field">
                      <span>PT</span>
                      <strong>{formatCurrency(totals.professional_tax)}</strong>
                    </div>

                    <div className="payroll-result-card-field">
                      <span>TDS</span>
                      <strong>{formatCurrency(totals.tds)}</strong>
                    </div>

                    <div className="payroll-result-card-field payroll-result-card-field-wide">
                      <span>TDS source</span>
                      <div className="payroll-result-card-tax">
                        <strong>{statusLabel(tdsMode)}</strong>
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
                    </div>

                    <div className="payroll-result-card-field">
                      <span>Advances</span>
                      <strong>{formatCurrency(totals.advances)}</strong>
                    </div>

                    <div className="payroll-result-card-field">
                      <span>Reimbursements</span>
                      <strong>{formatCurrency(resolveReimbursementTotal(totals))}</strong>
                    </div>

                    <div className="payroll-result-card-field">
                      <span>Total deductions</span>
                      <strong>{formatCurrency(totals.total_deductions)}</strong>
                    </div>

                    <div className="payroll-result-card-field payroll-result-card-field-net">
                      <span>Net amount</span>
                      <strong>{formatCurrency(totals.net_amount)}</strong>
                    </div>

                    <div className="payroll-result-card-field">
                      <span>Bank snapshot</span>
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
                    </div>
                  </div>

                  <div className="payroll-result-card-footer">
                    <span className="payroll-result-card-eyebrow">Payslip PDF</span>

                    {pdfAvailable ? (
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

                        <PayrollInlineMessage
                          feedback={inlineFeedback[`pdf:${employeeIdValue}`]}
                          onClose={() => clearInlineFeedback(`pdf:${employeeIdValue}`)}
                          className="payroll-pdf-feedback"
                        />
                      </div>
                    ) : (
                      <span className="payroll-pdf-unavailable">
                        PDF data unavailable
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>        ) : null}

        <div className="payroll-horizontal-scroll-shell payroll-result-scroll-shell">
        <div
          ref={resultTableScrollRef}
          className="table-wrap payroll-result-table"
          role="region"
          aria-label="Payroll results table. Scroll horizontally to view all columns."
          tabIndex={0}
          onKeyDown={handleResultTableKeyDown}
          onPointerDown={startResultTableDrag}
          onPointerMove={moveResultTableDrag}
          onPointerUp={endResultTableDrag}
          onPointerCancel={endResultTableDrag}
          onPointerLeave={(event) => {
            if (
              resultTableDragRef.current.active &&
              resultTableDragRef.current.pointerType !== 'touch'
            ) {
              endResultTableDrag(event);
            }
          }}
        >
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
              {resultTableRows.map((payslip) => {
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
                          showAllRunResults ? {} : (activeRun || {}),
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

                            <PayrollInlineMessage
                              feedback={inlineFeedback[`pdf:${employeeIdValue}`]}
                              onClose={() => clearInlineFeedback(`pdf:${employeeIdValue}`)}
                              className="payroll-pdf-feedback"
                            />
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

        <PayrollContainedScrollbar
          scrollRef={resultTableScrollRef}
          refreshKey={`${resultTableRows.length}:${resultTablePage}:${resultRowsPerPage}:${resultTableSearch}:${resultTableFullWindow}`}
          ariaLabel="Payroll results horizontal scrollbar"
        />
        </div>

        {renderPayrollSectionPagination(
          filteredResultRows.length,
          resultTablePage,
          setResultTablePage,
          'Payroll results pagination',
          resultTablePageSize,
        )}

        {loadingPayslips ? (
          <div className="empty">Loading payroll results…</div>
        ) : null}

        {!loadingPayslips &&
        (showAllRunResults || activeRun) &&
        !resultSourceRows.length ? (
          <div className="empty">
            {showAllRunResults
              ? 'No payslips were found for the recent payroll runs.'
              : 'No payslips were found for this payroll run.'}
          </div>
        ) : null}

        {!showAllRunResults && !activeRun ? (
          <div className="empty">Select a payroll run to view its results.</div>
        ) : null}
      </section>
      </PayrollResultsPortal>

      {workflowModal ? (
        <div
          className="payroll-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeWorkflowModal();
            }
          }}
        >
          <form className="payroll-modal" onSubmit={executeWorkflowAction}>
            <div className="payroll-modal-head">
              <div>
                <h3>{workflowActionLabel(workflowModal.action)}</h3>
                <p>
                  {safeText(
                    workflowModal.run?.run_code,
                    resolveRunId(workflowModal.run).slice(-8),
                  )}{' '}
                  · {safeText(
                    workflowModal.run?.period_key || workflowModal.run?.month,
                  )}
                </p>
              </div>

              <button
                type="button"
                className="payroll-modal-close"
                onClick={closeWorkflowModal}
                disabled={workflowSubmitting}
                aria-label="Close payroll action"
              >
                <X size={19} />
              </button>
            </div>

            <div className="payroll-modal-body">
              <div className="payroll-note" style={{ marginTop: 0 }}>
                <AlertTriangle size={18} />
                <div>{workflowActionDescription(workflowModal.action)}</div>
              </div>

              {workflowModal.action === 'disburse' ? (
                <div className="payroll-modal-grid">
                  <label className="payroll-modal-field">
                    <span>Actual transfer date *</span>
                    <input
                      type="date"
                      value={disbursementForm.transfer_date}
                      onChange={(event) =>
                        updateDisbursementField(
                          'transfer_date',
                          event.target.value,
                        )
                      }
                      required
                    />
                  </label>

                  <label className="payroll-modal-field">
                    <span>Transfer mode *</span>
                    <select
                      value={disbursementForm.transfer_mode}
                      onChange={(event) =>
                        updateDisbursementField(
                          'transfer_mode',
                          event.target.value,
                        )
                      }
                      required
                    >
                      <option value="NEFT">NEFT</option>
                      <option value="RTGS">RTGS</option>
                      <option value="IMPS">IMPS</option>
                      <option value="BANK_TRANSFER">Bank Transfer</option>
                    </select>
                  </label>

                  <label className="payroll-modal-field">
                    <span>Transaction / UTR reference (one reference required)</span>
                    <input
                      value={disbursementForm.transaction_reference}
                      onChange={(event) =>
                        updateDisbursementField(
                          'transaction_reference',
                          event.target.value,
                        )
                      }
                      placeholder="Example: UTR123456789"
                    />
                  </label>

                  <label className="payroll-modal-field">
                    <span>Bank batch/file reference (one reference required)</span>
                    <input
                      value={disbursementForm.bank_file_reference}
                      onChange={(event) =>
                        updateDisbursementField(
                          'bank_file_reference',
                          event.target.value,
                        )
                      }
                      placeholder="Example: BANK-BATCH-202609-001"
                    />
                  </label>
                </div>
              ) : null}

              <label className="payroll-modal-field">
                <span>
                  {workflowModal.action === 'hr_review'
                    ? 'HR review note'
                    : workflowModal.action === 'finance_approve'
                      ? 'Finance approval note'
                      : workflowModal.action === 'lock'
                        ? 'Locking note'
                        : 'Disbursement note'}
                </span>
                <textarea
                  value={workflowNote}
                  onChange={(event) => setWorkflowNote(event.target.value)}
                  placeholder="Add an optional note for the workflow history."
                />
              </label>
            </div>

            <div className="payroll-modal-actions">
              <PayrollInlineMessage
                feedback={inlineFeedback['workflow-modal']}
                onClose={() => clearInlineFeedback('workflow-modal')}
                className="payroll-modal-feedback"
              />

              <button
                type="button"
                className="secondary"
                onClick={closeWorkflowModal}
                disabled={workflowSubmitting}
              >
                Go Back
              </button>

              <button
                type="submit"
                className="primary"
                disabled={workflowSubmitting}
              >
                {workflowSubmitting ? (
                  <Loader2 size={17} className="spin" />
                ) : workflowModal.action === 'hr_review' ? (
                  <ShieldCheck size={17} />
                ) : workflowModal.action === 'lock' ? (
                  <LockKeyhole size={17} />
                ) : workflowModal.action === 'disburse' ? (
                  <Banknote size={17} />
                ) : (
                  <CheckCircle2 size={17} />
                )}
                {workflowSubmitting
                  ? 'Saving workflow…'
                  : workflowActionLabel(workflowModal.action)}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}