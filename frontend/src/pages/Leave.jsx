import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Filter,
  Loader2,
  RefreshCcw,
  Search,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  getLeaveRequestReports,
  getActiveEmployees,
  downloadCsv,
} from '../api/client';

const today = new Date().toISOString().slice(0, 10);

const EMPTY_FILTERS = {
  period: 'all',
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


function preventDateWheelChange(event) {
  event.currentTarget?.blur?.();
}


const LEAVE_NOTICE_HIDE_MS = 3600;
const LEAVE_PAGE_SIZES = [10, 25, 50, 100];

function leavePageNumbers(pageCount, page) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const current = Math.max(1, Math.min(pageCount, page));
  const pages = new Set([1, pageCount, current]);

  if (current > 2) pages.add(current - 1);
  if (current < pageCount - 1) pages.add(current + 1);

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const output = [];

  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];

    if (index > 0 && value - previous > 1) {
      output.push(`ellipsis-${previous}-${value}`);
    }

    output.push(value);
  });

  return output;
}

function LeaveInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`leave-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="leave-inline-feedback-icon">
        {message.loading ? (
          <Loader2 size={15} className="leave-spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="leave-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="leave-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function LeavePagination({
  total,
  page,
  pageSize,
  onPageChange,
}) {
  const pageCount = Math.max(
    1,
    Math.ceil(Number(total || 0) / Math.max(1, Number(pageSize || 10))),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);

  if (!total) return null;

  return (
    <div className="leave-pagination">
      <div className="leave-pagination-controls">
        <button
          type="button"
          className="leave-page-button leave-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="leave-page-numbers" aria-label="Leave table pagination">
          {leavePageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`leave-page-number ${
                  item === safePage ? 'is-active' : ''
                }`}
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span className="leave-page-ellipsis" key={item}>
                …
              </span>
            ),
          )}
        </div>

        <span className="leave-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="leave-page-button leave-page-nav"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount}
        >
          <span>Next</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

export default function Leave() {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [feedbackMap, setFeedbackMap] = useState({});

  const feedbackTimersRef = useRef({});
  const hasLoadedLeavesRef = useRef(false);
  const tableWrapRef = useRef(null);
  const tableDragRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    moved: false,
  });

  const normalizedRows = useMemo(() => normalizeLeaveRows(rows), [rows]);

  const computedSummary = useMemo(() => {
    const total = normalizedRows.length;
    const pending = normalizedRows.filter((row) =>
      String(row.live_status || row.status || '')
        .toLowerCase()
        .includes('pending'),
    ).length;
    const approved = normalizedRows.filter((row) =>
      String(row.live_status || row.status || '')
        .toLowerCase()
        .includes('approved'),
    ).length;
    const rejected = normalizedRows.filter((row) =>
      String(row.live_status || row.status || '')
        .toLowerCase()
        .includes('rejected'),
    ).length;
    const halfDay = normalizedRows.filter(
      (row) => row.day_type_label === 'Half Day',
    ).length;
    const lwp = normalizedRows.reduce(
      (sum, row) => sum + Number(row.lwp_days || 0),
      0,
    );

    return {
      total: summary.total ?? total,
      pending: summary.pending ?? pending,
      approved: summary.approved ?? approved,
      rejected: summary.rejected ?? rejected,
      half_day: summary.half_day ?? halfDay,
      lwp: summary.lwp ?? lwp,
    };
  }, [normalizedRows, summary]);

  const pageCount = Math.max(
    1,
    Math.ceil(
      normalizedRows.length / Math.max(1, Number(pageSize || 10)),
    ),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = normalizedRows.slice(
    pageStart,
    pageStart + pageSize,
  );

  function clearFeedback(scopeKey) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scopeKey)) {
        return current;
      }

      const next = { ...current };
      delete next[scopeKey];
      return next;
    });
  }

  function showFeedback(
    scopeKey,
    type,
    text,
    title = '',
    options = {},
  ) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => ({
      ...current,
      [scopeKey]: {
        type,
        text,
        title,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      feedbackTimersRef.current[scopeKey] = window.setTimeout(() => {
        setFeedbackMap((current) => {
          const next = { ...current };
          delete next[scopeKey];
          return next;
        });

        delete feedbackTimersRef.current[scopeKey];
      }, LEAVE_NOTICE_HIDE_MS);
    }
  }

  async function loadEmployees() {
    try {
      setLoadingEmployees(true);

      const data = await getActiveEmployees({
        limit: 1000,
        employee_scope: 'active',
      });

      setEmployees(data.items || []);
      clearFeedback('employees');
      return true;
    } catch (error) {
      setEmployees([]);
      showFeedback(
        'employees',
        'error',
        error.message || 'Unable to load employee list.',
        'Employee List Failed',
      );
      return false;
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadLeaves(
    nextFilters = filters,
    {
      showLoader = !hasLoadedLeavesRef.current,
      feedbackScope = '',
      successText = 'Leave records are up to date.',
      successTitle = 'Update Complete',
      errorTitle = 'Leave Records Load Failed',
    } = {},
  ) {
    if (showLoader) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        'Updating leave records...',
        'Working',
        { loading: true },
      );
    }

    try {
      const data = await getLeaveRequestReports(
        buildReportParams(nextFilters),
      );

      setRows(data.items || []);
      setSummary(data.summary || {});
      clearFeedback('page');

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          successText,
          successTitle,
        );
      }

      return true;
    } catch (error) {
      const errorMessage =
        error.message || 'Unable to load leave records.';

      if (!hasLoadedLeavesRef.current) {
        setRows([]);
        setSummary({});
      }

      showFeedback(
        feedbackScope || 'page',
        'error',
        errorMessage,
        errorTitle,
      );

      return false;
    } finally {
      hasLoadedLeavesRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadEmployees();
    loadLeaves({ ...EMPTY_FILTERS }, { showLoader: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    function dismissFeedback(event) {
      if (event.target?.closest?.('.leave-inline-feedback')) return;

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
      setFeedbackMap({});
    }

    document.addEventListener('pointerdown', dismissFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissFeedback);

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
    };
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

        if (
          ['day', 'week', 'month', 'year'].includes(value) &&
          !next.on_date
        ) {
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
    setPage(1);

    await loadLeaves(filters, {
      showLoader: false,
      feedbackScope: 'search',
      successText: 'Leave filters were applied successfully.',
      successTitle: 'Search Complete',
      errorTitle: 'Search Failed',
    });
  }

  async function handleReset() {
    const cleared = { ...EMPTY_FILTERS };
    setFilters(cleared);
    setPage(1);

    await loadLeaves(cleared, {
      showLoader: false,
      feedbackScope: 'reset',
      successText: 'Leave filters were reset successfully.',
      successTitle: 'Filters Reset',
      errorTitle: 'Reset Failed',
    });
  }

  async function handleRefresh() {
    await loadLeaves(filters, {
      showLoader: false,
      feedbackScope: 'refresh',
      successText: 'Leave records are up to date.',
      successTitle: 'Refresh Complete',
      errorTitle: 'Refresh Failed',
    });
  }

  function handleCsvExport() {
    clearFeedback('export');

    if (!normalizedRows.length) {
      showFeedback(
        'export',
        'warning',
        'There are no leave records to export.',
        'Export Not Available',
      );
      return;
    }

    try {
      const exportRows = normalizedRows.map((row) => ({
        ...row,
        from_date: row.from_date_display,
        to_date: row.to_date_display,
        created_at: row.created_at_display,
        compoff_holiday_title: row.is_compoff_leave
          ? row.compoff_holiday_title
          : '',
        compoff_earned_date: row.is_compoff_leave
          ? row.compoff_earned_date
          : '',
        compoff_available_from: row.is_compoff_leave
          ? row.compoff_available_from
          : '',
        compoff_valid_until: row.is_compoff_leave
          ? row.compoff_valid_until
          : '',
        holiday_work_request_id: row.is_compoff_leave
          ? row.holiday_work_request_id
          : '',
        attendance_log_id: row.is_compoff_leave
          ? row.attendance_log_id
          : '',
      }));

      downloadCsv(
        'hr-leave-management.csv',
        exportRows,
        LEAVE_COLUMNS,
      );

      showFeedback(
        'export',
        'success',
        'Leave records CSV export is ready.',
        'Export Ready',
      );
    } catch (error) {
      showFeedback(
        'export',
        'error',
        error.message || 'Unable to export leave records.',
        'Export Failed',
      );
    }
  }

  function handleTablePointerDown(event) {
    const scroller = tableWrapRef.current;

    if (!scroller) return;

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const rect = scroller.getBoundingClientRect();

    if (
      event.pointerType === 'mouse' &&
      event.clientY >= rect.bottom - 14
    ) {
      return;
    }

    tableDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scroller.scrollLeft,
      moved: false,
    };

    // Pointer capture intentionally starts only after a real horizontal
    // movement begins, so ordinary clicks and controls remain untouched.
  }

  function handleTablePointerMove(event) {
    const scroller = tableWrapRef.current;
    const drag = tableDragRef.current;

    if (
      !scroller ||
      !drag.active ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (!drag.moved) {
      if (Math.abs(deltaX) < 6) {
        return;
      }

      if (
        event.pointerType === 'touch' &&
        Math.abs(deltaY) > Math.abs(deltaX)
      ) {
        drag.active = false;
        drag.pointerId = null;
        return;
      }

      drag.moved = true;
      scroller.classList.add('is-dragging');

      try {
        scroller.setPointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture is optional; drag/swipe still works natively.
      }
    }

    scroller.scrollLeft = drag.startScrollLeft - deltaX;

    if (event.cancelable) {
      event.preventDefault();
    }
  }

  function finishTablePointerDrag(event) {
    const scroller = tableWrapRef.current;
    const drag = tableDragRef.current;

    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }

    drag.active = false;
    drag.pointerId = null;
    scroller?.classList.remove('is-dragging');

    try {
      scroller?.releasePointerCapture?.(event.pointerId);
    } catch {
      // Browser may already have released the pointer.
    }
  }

  function cancelTablePointerDrag(event) {
    const scroller = tableWrapRef.current;

    tableDragRef.current.active = false;
    tableDragRef.current.pointerId = null;
    scroller?.classList.remove('is-dragging');

    try {
      scroller?.releasePointerCapture?.(event.pointerId);
    } catch {
      // Browser may already have released the pointer.
    }
  }

  return (
    <div className="page-grid leave-management-page">
      <style>{`
        .leave-management-page {
          --leave-ink: #101a3a;
          --leave-muted: #5d6d8d;
          --leave-primary: #4d77dd;
          --leave-deep: #40348d;
          --leave-teal: #2eb2b9;
          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding-bottom: max(34px, env(safe-area-inset-bottom));
          color: var(--leave-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .leave-management-page,
        .leave-management-page * {
          box-sizing: border-box;
        }

        .leave-management-page > *,
        .leave-management-page section,
        .leave-management-page form,
        .leave-management-page label {
          min-width: 0;
          max-width: 100%;
        }

        .leave-management-page::before,
        .leave-management-page::after,
        .leave-management-page .leave-hero::before,
        .leave-management-page .leave-hero::after,
        .leave-management-page .stat-card::before,
        .leave-management-page .stat-card::after {
          content: none;
          display: none;
          background: none;
        }

        .leave-management-page .leave-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(210px, 300px);
          align-items: center;
          gap: clamp(20px, 3vw, 38px);
          min-height: 240px;
          padding: clamp(24px, 3vw, 40px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background:
            linear-gradient(
              90deg,
              #d3f4fb 0%,
              #f7fcfb 34%,
              #fffdf8 52%,
              #fbf8fa 68%,
              #f0edfb 100%
            );
          box-shadow: 0 22px 46px rgba(70, 92, 140, .10);
        }

        .leave-management-page .leave-hero-copy {
          min-width: 0;
          max-width: 900px;
        }

        .leave-management-page .kicker,
        .leave-management-page .section-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .leave-management-page .kicker {
          margin-bottom: 15px;
          padding: 9px 13px;
          box-shadow: 0 8px 18px rgba(77, 119, 221, .18);
        }

        .leave-management-page .section-kicker {
          margin-bottom: 9px;
          padding: 7px 10px;
          box-shadow: 0 7px 15px rgba(77, 119, 221, .14);
        }

        .leave-management-page .leave-hero h1 {
          max-width: 840px;
          margin: 0;
          color: var(--leave-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 76px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .leave-management-page .leave-hero h1 em {
          color: var(--leave-primary);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .leave-management-page .leave-hero p {
          max-width: 810px;
          margin: 17px 0 0;
          color: var(--leave-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .leave-management-page button {
          touch-action: manipulation;
          font-weight: 900;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            filter 180ms ease,
            opacity 180ms ease;
        }

        .leave-management-page button:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: saturate(1.03);
        }

        .leave-management-page button:active:not(:disabled) {
          transform: translateY(0);
        }

        .leave-management-page button:disabled {
          opacity: .56;
          cursor: not-allowed;
          transform: none;
          filter: none;
        }

        .leave-management-page .primary,
        .leave-management-page .secondary {
          min-height: 44px;
          padding: 10px 15px;
          border: 1px solid transparent;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          line-height: 1;
          white-space: nowrap;
          cursor: pointer;
        }

        .leave-management-page .primary {
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 10px 22px rgba(77, 119, 221, .18);
        }

        .leave-management-page .secondary {
          border-color: rgba(77, 119, 221, .18);
          color: #4767b4;
          background: #fff;
        }

        .leave-management-page .hero-action-stack,
        .leave-management-page .toolbar-action-stack,
        .leave-management-page .form-action-stack {
          display: grid;
          gap: 9px;
          min-width: 0;
        }

        .leave-management-page .hero-action-stack {
          width: min(300px, 100%);
        }

        .leave-management-page .hero-action-stack .secondary {
          width: max-content;
          min-width: 130px;
        }

        .leave-management-page .leave-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(102, 88, 220, .18);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          font-size: 10px;
          line-height: 1.45;
        }

        .leave-management-page .leave-inline-feedback.success {
          border-color: rgba(4, 120, 87, .18);
          color: #047857;
          background: #eaf8f4;
        }

        .leave-management-page .leave-inline-feedback.warning {
          border-color: rgba(154, 104, 23, .18);
          color: #9a6817;
          background: #fff4d5;
        }

        .leave-management-page .leave-inline-feedback.error {
          border-color: rgba(162, 52, 77, .18);
          color: #a2344d;
          background: #fff0f2;
        }

        .leave-management-page .leave-inline-feedback-icon {
          width: 22px;
          height: 22px;
          display: inline-grid;
          place-items: center;
        }

        .leave-management-page .leave-inline-feedback-copy {
          min-width: 0;
        }

        .leave-management-page .leave-inline-feedback-copy strong,
        .leave-management-page .leave-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .leave-management-page .leave-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .leave-management-page .leave-inline-feedback-copy span {
          font-weight: 750;
        }

        .leave-management-page .leave-inline-feedback-close {
          width: 24px;
          min-width: 24px;
          height: 24px;
          padding: 0;
          border: 0;
          border-radius: 8px;
          display: inline-grid;
          place-items: center;
          color: currentColor;
          background: rgba(255, 255, 255, .58);
          font: inherit;
          font-size: 17px;
          line-height: 1;
          cursor: pointer;
        }

        .leave-management-page .leave-inline-feedback-close:hover {
          background: #fff;
        }

        .leave-management-page .page-feedback {
          width: min(620px, 100%);
        }

        .leave-management-page .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .leave-management-page .stat-card {
          min-width: 0;
          min-height: 120px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 0 16px 30px rgba(34, 38, 110, .07);
        }

        .leave-management-page .stat-card:nth-child(2) {
          background: #fff4d5;
        }

        .leave-management-page .stat-card:nth-child(3) {
          background: #eaf8f4;
        }

        .leave-management-page .stat-card:nth-child(4) {
          background: #fff0f2;
        }

        .leave-management-page .stat-card span,
        .leave-management-page .stat-card strong,
        .leave-management-page .stat-card small {
          display: block;
        }

        .leave-management-page .stat-card span {
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .leave-management-page .stat-card strong {
          margin-top: 8px;
          color: var(--leave-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(28px, 3vw, 42px);
          line-height: 1;
        }

        .leave-management-page .stat-card small {
          margin-top: 7px;
          color: var(--leave-muted);
          font-size: 11px;
          line-height: 1.45;
        }

        .leave-management-page .panel {
          min-width: 0;
          overflow: hidden;
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(24px, 2.2vw, 34px);
          background: #fff;
          box-shadow: 0 20px 38px rgba(34, 38, 110, .08);
        }

        .leave-management-page .toolbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding: 23px 25px 18px;
          border-bottom: 1px solid rgba(65, 55, 161, .08);
          background:
            linear-gradient(
              180deg,
              rgba(245, 248, 255, .82),
              rgba(255, 255, 255, .32)
            );
        }

        .leave-management-page .toolbar > div {
          min-width: 0;
        }

        .leave-management-page .toolbar h3 {
          margin: 0;
          color: var(--leave-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.4vw, 35px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .leave-management-page .toolbar p {
          margin: 8px 0 0;
          color: var(--leave-muted);
          font-size: 13px;
          line-height: 1.55;
        }

        .leave-management-page .dynamic-form {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          padding: 20px 25px 25px;
          background:
            linear-gradient(
              145deg,
              rgba(237, 248, 255, .44),
              rgba(248, 241, 255, .34)
            );
        }

        .leave-management-page .dynamic-form label {
          display: grid;
          min-width: 0;
          gap: 7px;
          color: #334164;
          font-size: 12px;
          font-weight: 900;
        }

        .leave-management-page .dynamic-form input,
        .leave-management-page .dynamic-form select {
          width: 100%;
          min-width: 0;
          min-height: 46px;
          border: 1px solid rgba(159, 169, 205, .62);
          border-radius: 14px;
          outline: none;
          background: rgba(255, 255, 255, .96);
          color: var(--leave-ink);
          padding: 0 13px;
          font: inherit;
          font-weight: 600;
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease,
            background 180ms ease;
        }

        .leave-management-page .dynamic-form input:hover,
        .leave-management-page .dynamic-form select:hover {
          border-color: rgba(77, 119, 221, .34);
        }

        .leave-management-page .dynamic-form input:focus,
        .leave-management-page .dynamic-form select:focus {
          border-color: var(--leave-primary);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
        }

        .leave-management-page .form-action-stack {
          align-self: end;
          width: 100%;
        }

        .leave-management-page .form-action-stack .primary,
        .leave-management-page .form-action-stack .secondary {
          width: 100%;
        }

        .leave-management-page .employee-feedback {
          margin: 0 25px 18px;
        }

        .leave-management-page .records-summary-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 13px 24px;
          border-bottom: 1px solid rgba(65, 55, 161, .08);
          background: #fff;
        }

        .leave-management-page .records-summary-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .leave-management-page .records-summary-meta span {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 32px;
          padding: 0 10px;
          border-radius: 999px;
          color: #4767b4;
          background: #edf6ff;
          font-size: 10px;
          font-weight: 900;
        }

        .leave-management-page .records-summary-meta span:nth-child(2) {
          color: #40348d;
          background: #f1efff;
        }

        .leave-management-page .page-size-control {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--leave-muted);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .leave-management-page .page-size-control select {
          width: auto;
          min-width: 78px;
          min-height: 38px;
          padding: 0 28px 0 10px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 12px;
          outline: 0;
          color: #40348d;
          background: #f1efff;
          font: inherit;
          font-size: 10px;
          font-weight: 900;
        }

        .leave-management-page .page-size-control select:focus {
          border-color: rgba(77, 119, 221, .65);
          box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
        }

        .leave-management-page .leave-table-wrap {
          width: 100%;
          max-width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          border-top: 1px solid rgba(171, 181, 211, .35);
          background: #fff;
          scrollbar-width: thin;
          scrollbar-color: rgba(77, 119, 221, .35) transparent;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
          touch-action: pan-y;
          cursor: grab;
        }

        .leave-management-page .leave-table-wrap.is-dragging {
          cursor: grabbing;
          user-select: none;
        }

        .leave-management-page .leave-table-wrap.is-dragging * {
          user-select: none;
        }

        .leave-management-page .leave-table-wrap::-webkit-scrollbar {
          height: 8px;
        }

        .leave-management-page .leave-table-wrap::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(77, 119, 221, .30);
        }

        .leave-management-page .leave-table {
          width: 100%;
          min-width: 1580px;
          border-collapse: collapse;
          table-layout: auto;
        }

        .leave-management-page .leave-table th,
        .leave-management-page .leave-table td {
          padding: 14px 16px;
          border-bottom: 1px solid #edf0f5;
          text-align: left;
          vertical-align: top;
        }

        .leave-management-page .leave-table th {
          color: #526079;
          background: linear-gradient(180deg, #f8f8ff, #f4f8fb);
          font-size: 10px;
          font-weight: 950;
          letter-spacing: .07em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .leave-management-page .leave-table td {
          color: #334155;
          font-size: 12px;
          line-height: 1.48;
        }

        .leave-management-page .leave-table tbody tr:hover td {
          background: #fafcff;
        }

        .leave-management-page .leave-employee-cell {
          min-width: 210px;
        }

        .leave-management-page .leave-employee-cell strong,
        .leave-management-page .leave-employee-cell span {
          display: block;
        }

        .leave-management-page .leave-employee-cell span {
          margin-top: 4px;
          color: var(--leave-muted);
          font-size: 11px;
          line-height: 1.4;
        }

        .leave-management-page .leave-date-cell {
          min-width: 120px;
          white-space: nowrap;
        }

        .leave-management-page .leave-reason-cell {
          min-width: 240px;
          max-width: 330px;
          white-space: normal;
          overflow-wrap: anywhere;
        }

        .leave-management-page .leave-compoff-cell {
          min-width: 260px;
          max-width: 340px;
          white-space: normal;
        }

        .leave-management-page .leave-compoff-cell span,
        .leave-management-page .leave-compoff-cell small {
          display: block;
        }

        .leave-management-page .leave-compoff-cell small {
          margin-top: 4px;
          color: var(--leave-muted);
          line-height: 1.4;
        }

        .leave-management-page .leave-status {
          display: inline-flex;
          align-items: center;
          min-height: 30px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .leave-management-page .leave-status.approved {
          color: #047857;
          background: #eaf8f4;
        }

        .leave-management-page .leave-status.rejected {
          color: #a2344d;
          background: #fff0f2;
        }

        .leave-management-page .leave-status.pending {
          color: #9a6817;
          background: #fff4d5;
        }

        .leave-management-page .leave-status.neutral {
          color: #5f6983;
          background: #edf0f6;
        }

        .leave-management-page .leave-pagination {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 14px;
          padding: 13px 24px;
          border-top: 1px solid rgba(65, 55, 161, .08);
          background: #fff;
        }

        .leave-management-page .leave-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .leave-management-page .leave-page-button,
        .leave-management-page .leave-page-number {
          border: 1px solid rgba(77, 119, 221, .18);
          color: #4767b4;
          background: #fff;
          font: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
        }

        .leave-management-page .leave-page-button {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 11px;
        }

        .leave-management-page .leave-page-nav {
          min-width: 78px;
        }

        .leave-management-page .leave-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .leave-management-page .leave-page-number {
          width: 36px;
          height: 36px;
          padding: 0;
          display: grid;
          place-items: center;
          border-radius: 10px;
        }

        .leave-management-page .leave-page-number.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        }

        .leave-management-page .leave-page-ellipsis {
          width: 18px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .leave-management-page .leave-page-indicator {
          min-width: 82px;
          color: var(--leave-muted);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
        }

        .leave-management-page .loading-line,
        .leave-management-page .empty-state {
          margin: 18px 24px 24px;
          border-radius: 18px;
          text-align: center;
        }

        .leave-management-page .loading-line {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          padding: 18px;
          color: var(--leave-muted);
          background: #f8fbff;
          font-size: 12px;
          font-weight: 850;
        }

        .leave-management-page .empty-state {
          display: grid;
          justify-items: center;
          gap: 10px;
          padding: 44px 20px;
          border: 1px dashed rgba(77, 119, 221, .28);
          color: var(--leave-muted);
          background: linear-gradient(145deg, #f8fbff, #f8f7ff);
        }

        .leave-management-page .empty-state svg {
          color: var(--leave-primary);
        }

        .leave-management-page .empty-state h3 {
          margin: 0;
          color: var(--leave-ink);
          font-size: 18px;
          font-weight: 950;
        }

        .leave-management-page .empty-state p {
          max-width: 540px;
          margin: 0;
          font-size: 12px;
          line-height: 1.6;
        }

        .leave-management-page .leave-spin {
          animation: leaveSpin .82s linear infinite;
        }

        @keyframes leaveSpin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1180px) {
          .leave-management-page .stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .leave-management-page .dynamic-form {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 860px) {
          .leave-management-page .leave-hero {
            grid-template-columns: 1fr;
          }

          .leave-management-page .hero-action-stack {
            width: min(360px, 100%);
          }

          .leave-management-page .dynamic-form {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .leave-management-page .toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .leave-management-page .toolbar-action-stack {
            width: min(360px, 100%);
          }
        }

        @media (max-width: 640px) {
          .leave-management-page {
            gap: 15px;
          }

          .leave-management-page .leave-hero {
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 0 18px 30px rgba(34, 38, 110, .09);
          }

          .leave-management-page .leave-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .leave-management-page .hero-action-stack,
          .leave-management-page .hero-action-stack .secondary {
            width: 100%;
          }

          .leave-management-page .stats-grid {
            grid-template-columns: 1fr;
          }

          .leave-management-page .panel {
            border-radius: 23px;
          }

          .leave-management-page .toolbar {
            padding: 20px 17px 15px;
          }

          .leave-management-page .dynamic-form {
            grid-template-columns: 1fr;
            padding: 16px 17px 20px;
          }

          .leave-management-page .form-action-stack {
            width: 100%;
          }

          .leave-management-page .records-summary-row {
            align-items: stretch;
            flex-direction: column;
            padding: 12px 14px;
          }

          .leave-management-page .page-size-control {
            justify-content: space-between;
          }

          .leave-management-page .leave-pagination {
            justify-content: stretch;
            padding: 12px;
          }

          .leave-management-page .leave-pagination-controls {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
          }

          .leave-management-page .leave-page-numbers,
          .leave-management-page .leave-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .leave-management-page .leave-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .leave-management-page .leave-page-nav {
            width: 100%;
          }
        }

        @media (max-width: 390px) {
          .leave-management-page .leave-hero {
            padding: 16px;
          }

          .leave-management-page .leave-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .leave-management-page .leave-page-number {
            width: 34px;
            height: 34px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .leave-management-page *,
          .leave-management-page *::before,
          .leave-management-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <section className="hero compact leave-hero">
        <div className="leave-hero-copy">
          <span className="kicker">
            <CalendarDays size={14} />
            HR Leave Management
          </span>

          <h1>
            Leave records, <em>clearly.</em>
          </h1>

          <p>
            Review all leave records by default, track approval status,
            comp-off claims, holiday work references, and filter leave
            records by employee, leave type, date range, status, and
            approval stage.
          </p>
        </div>

        <div className="hero-action-stack">
          <button
            type="button"
            className="secondary"
            onClick={handleRefresh}
            disabled={loading || refreshing}
          >
            {refreshing ? (
              <Loader2 size={16} className="leave-spin" />
            ) : (
              <RefreshCcw size={16} />
            )}
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          <LeaveInlineMessage
            message={feedbackMap.refresh}
            onClose={() => clearFeedback('refresh')}
          />
        </div>
      </section>

      <section className="stats-grid" aria-label="Leave summary">
        <article className="stat-card">
          <span>Total Leaves</span>
          <strong>{computedSummary.total}</strong>
          <small>Filtered leave records</small>
        </article>

        <article className="stat-card">
          <span>Pending</span>
          <strong>{computedSummary.pending}</strong>
          <small>Awaiting approval action</small>
        </article>

        <article className="stat-card">
          <span>Approved</span>
          <strong>{computedSummary.approved}</strong>
          <small>Confirmed leave requests</small>
        </article>

        <article className="stat-card">
          <span>Rejected</span>
          <strong>{computedSummary.rejected}</strong>
          <small>Rejected leave requests</small>
        </article>
      </section>

      {feedbackMap.page ? (
        <div className="page-feedback">
          <LeaveInlineMessage
            message={feedbackMap.page}
            onClose={() => clearFeedback('page')}
          />
        </div>
      ) : null}

      <section className="panel leave-filter-panel">
        <div className="toolbar">
          <div>
            <span className="section-kicker">
              Leave Filters
            </span>
            <h3>Filter Leave Records</h3>
            <p>
              All leave records are shown by default. Select a period or
              use custom dates to narrow the results.
            </p>
          </div>

          <div className="toolbar-action-stack">
            <button
              type="button"
              className="secondary"
              onClick={handleCsvExport}
              disabled={!normalizedRows.length}
            >
              <Download size={16} />
              Export CSV
            </button>

            <LeaveInlineMessage
              message={feedbackMap.export}
              onClose={() => clearFeedback('export')}
            />
          </div>
        </div>

        {feedbackMap.employees ? (
          <div className="employee-feedback">
            <LeaveInlineMessage
              message={feedbackMap.employees}
              onClose={() => clearFeedback('employees')}
            />
          </div>
        ) : null}

        <form className="dynamic-form" onSubmit={handleSearch}>
          <label>
            Period
            <select
              value={filters.period}
              onChange={(event) =>
                updateFilter('period', event.target.value)
              }
            >
              <option value="all">All Records</option>
              <option value="today">Today</option>
              <option value="day">Specific Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </label>

          {['today', 'day', 'week', 'month', 'year'].includes(
            filters.period,
          ) ? (
            <label>
              Reference Date
              <input
                type="date"
                value={filters.on_date}
                onChange={(event) =>
                  updateFilter('on_date', event.target.value)
                }
                onWheel={preventDateWheelChange}
              />
            </label>
          ) : null}

          {filters.period === 'custom' ? (
            <>
              <label>
                Date From
                <input
                  type="date"
                  value={filters.date_from}
                  onChange={(event) =>
                    updateFilter('date_from', event.target.value)
                  }
                  onWheel={preventDateWheelChange}
                />
              </label>

              <label>
                Date To
                <input
                  type="date"
                  value={filters.date_to}
                  onChange={(event) =>
                    updateFilter('date_to', event.target.value)
                  }
                  onWheel={preventDateWheelChange}
                />
              </label>
            </>
          ) : null}

          <label>
            Employee
            <select
              value={filters.employee_id}
              onChange={(event) =>
                updateFilter('employee_id', event.target.value)
              }
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
              onChange={(event) =>
                updateFilter('leave_type', event.target.value)
              }
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
              onChange={(event) =>
                updateFilter('status', event.target.value)
              }
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
              onChange={(event) =>
                updateFilter('approval_stage', event.target.value)
              }
            >
              <option value="">All Stages</option>
              <option value="team_leader">Team Leader</option>
              <option value="reporting_officer">
                Reporting Officer
              </option>
              <option value="hr">HR</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>

          <label>
            Live Status
            <select
              value={filters.live_status}
              onChange={(event) =>
                updateFilter('live_status', event.target.value)
              }
            >
              <option value="">All Live Status</option>
              <option value="pending_with_team_leader">
                Pending with Team Leader
              </option>
              <option value="pending_with_reporting_officer">
                Pending with Reporting Officer
              </option>
              <option value="pending_with_hr">
                Pending with HR
              </option>
            </select>
          </label>

          <div className="form-action-stack">
            <button
              type="submit"
              className="primary"
              disabled={loading || refreshing}
            >
              {refreshing && feedbackMap.search?.loading ? (
                <Loader2 size={16} className="leave-spin" />
              ) : (
                <Search size={16} />
              )}
              {feedbackMap.search?.loading
                ? 'Searching...'
                : 'Search Leaves'}
            </button>

            <LeaveInlineMessage
              message={feedbackMap.search}
              onClose={() => clearFeedback('search')}
            />
          </div>

          <div className="form-action-stack">
            <button
              type="button"
              className="secondary"
              onClick={handleReset}
              disabled={loading || refreshing}
            >
              {refreshing && feedbackMap.reset?.loading ? (
                <Loader2 size={16} className="leave-spin" />
              ) : (
                <Filter size={16} />
              )}
              {feedbackMap.reset?.loading
                ? 'Resetting...'
                : 'Reset Filters'}
            </button>

            <LeaveInlineMessage
              message={feedbackMap.reset}
              onClose={() => clearFeedback('reset')}
            />
          </div>
        </form>
      </section>

      <section className="panel leave-record-panel">
        <div className="toolbar">
          <div>
            <span className="section-kicker">
              Leave Directory
            </span>
            <h3>Leave Records</h3>
            <p>
              {filters.period === 'all'
                ? 'Showing all leave records.'
                : filters.period === 'today'
                  ? 'Showing leave records for today.'
                  : 'Showing leave records based on selected filters.'}
            </p>
          </div>
        </div>

        <div className="records-summary-row">
          <div className="records-summary-meta">
            <span>
              Half Day: {computedSummary.half_day}
            </span>
            <span>
              LWP Days: {computedSummary.lwp}
            </span>
          </div>

          <label className="page-size-control">
            <span>View</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value));
              }}
              aria-label="Leave records per page"
            >
              {LEAVE_PAGE_SIZES.map((size) => (
                <option value={size} key={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading && !normalizedRows.length ? (
          <div className="loading-line">
            <Loader2 size={17} className="leave-spin" />
            Loading leave records...
          </div>
        ) : null}

        {!loading && !normalizedRows.length ? (
          <div className="empty-state">
            <CalendarDays size={34} />
            <h3>No leave records found</h3>
            <p>
              No employees are on leave for the selected period or
              filters.
            </p>
          </div>
        ) : null}

        {!!normalizedRows.length ? (
          <>
            <div
              className="leave-table-wrap"
              ref={tableWrapRef}
              onPointerDown={handleTablePointerDown}
              onPointerMove={handleTablePointerMove}
              onPointerUp={finishTablePointerDrag}
              onPointerCancel={cancelTablePointerDrag}
              onLostPointerCapture={cancelTablePointerDrag}
            >
              <table className="leave-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Leave Type</th>
                    <th>Day Type</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Leave Days</th>
                    <th>LWP Days</th>
                    <th>Current Status</th>
                    <th>Approval Stage</th>
                    <th>Reason</th>
                    <th>Comp-Off Details</th>
                    <th>Applied On</th>
                  </tr>
                </thead>

                <tbody>
                  {pagedRows.map((row) => (
                    <tr
                      key={
                        row.id ||
                        `${row.employee_name}-${row.from_date_display}`
                      }
                    >
                      <td>
                        <div className="leave-employee-cell">
                          <strong>{row.employee_name}</strong>
                          <span>
                            {row.employee_code} • {row.department} •{' '}
                            {row.designation}
                          </span>
                        </div>
                      </td>

                      <td>{row.leave_type_label}</td>
                      <td>{row.day_type_label}</td>
                      <td className="leave-date-cell">
                        {row.from_date_display}
                      </td>
                      <td className="leave-date-cell">
                        {row.to_date_display}
                      </td>
                      <td>{row.leave_days}</td>
                      <td>{row.lwp_days || '—'}</td>
                      <td>
                        <span
                          className={leaveStatusClass(row.live_status)}
                        >
                          {row.live_status}
                        </span>
                      </td>
                      <td>{row.approval_stage_label}</td>
                      <td className="leave-reason-cell">
                        {row.reason}
                      </td>
                      <td className="leave-compoff-cell">
                        {row.is_compoff_leave ? (
                          <>
                            <span>
                              {row.compoff_holiday_title}
                            </span>
                            <small>
                              Earned: {row.compoff_earned_date}
                            </small>
                            <small>
                              Claim: {row.compoff_available_from} to{' '}
                              {row.compoff_valid_until}
                            </small>
                            <small>
                              Comp-Off Credit: {row.compoff_id || '—'}
                            </small>
                            <small>
                              Holiday Work: {row.holiday_work_request_id}
                            </small>
                            <small>
                              Attendance: {row.attendance_log_id}
                            </small>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="leave-date-cell">
                        {row.created_at_display}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <LeavePagination
              total={normalizedRows.length}
              page={safePage}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}
