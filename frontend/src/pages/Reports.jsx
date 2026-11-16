import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  RefreshCcw,
  Search,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import {
  api,
  downloadAttendanceExceptionExcel,
  downloadAttendanceRegisterExcel,
  getActiveEmployees,
  getActiveOrganisations,
  getAttendanceExceptionReports,
} from '../api/client';
import Table from '../components/Table';

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


const REPORT_NOTICE_HIDE_MS = 3600;
const REPORT_PAGE_SIZES = [10, 25, 50, 100];

function reportPageNumbers(pageCount, page) {
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

function ReportInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`report-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="report-inline-feedback-icon">
        {message.loading ? (
          <Loader2 size={15} className="report-spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="report-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="report-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function ReportKpi({ label, value }) {
  return (
    <article className="report-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ReportPagination({
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
    <div className="report-pagination">
      <div className="report-pagination-controls">
        <button
          type="button"
          className="report-page-button report-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="report-page-numbers" aria-label="Report pagination">
          {reportPageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`report-page-number ${
                  item === safePage ? 'is-active' : ''
                }`}
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span className="report-page-ellipsis" key={item}>
                …
              </span>
            ),
          )}
        </div>

        <span className="report-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="report-page-button report-page-nav"
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

function SwipeableReportTable({ children, className = '' }) {
  const wrapperRef = useRef(null);
  const swipeRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    moved: false,
    scrollTarget: null,
    suppressClickUntil: 0,
  });

  function isHorizontalScroller(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const overflowX = window.getComputedStyle(element).overflowX;
    const allowsHorizontalScroll = [
      'auto',
      'scroll',
      'overlay',
    ].includes(overflowX);

    return (
      allowsHorizontalScroll &&
      element.scrollWidth > element.clientWidth + 1
    );
  }

  function findScrollTarget(origin = null) {
    const wrapper = wrapperRef.current;

    if (!wrapper) return null;

    let current =
      origin instanceof HTMLElement ? origin : origin?.parentElement;

    while (current && wrapper.contains(current)) {
      if (isHorizontalScroller(current)) {
        return current;
      }

      if (current === wrapper) {
        break;
      }

      current = current.parentElement;
    }

    if (isHorizontalScroller(wrapper)) {
      return wrapper;
    }

    return (
      Array.from(wrapper.querySelectorAll('*')).find(
        isHorizontalScroller,
      ) || null
    );
  }

  function resetSwipeState() {
    swipeRef.current.active = false;
    swipeRef.current.pointerId = null;
    swipeRef.current.scrollTarget = null;
    wrapperRef.current?.classList.remove('is-swiping');
  }

  function handlePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const scrollTarget = findScrollTarget(event.target);

    if (!scrollTarget) return;

    if (event.pointerType === 'mouse') {
      const rect = scrollTarget.getBoundingClientRect();

      if (event.clientY >= rect.bottom - 14) {
        return;
      }
    }

    swipeRef.current = {
      ...swipeRef.current,
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scrollTarget.scrollLeft,
      moved: false,
      scrollTarget,
    };

    // Capture starts only after real horizontal movement so normal clicks,
    // links, selections, and native scrollbar dragging remain untouched.
  }

  function handlePointerMove(event) {
    const swipe = swipeRef.current;

    if (
      !swipe.active ||
      swipe.pointerId !== event.pointerId ||
      !swipe.scrollTarget
    ) {
      return;
    }

    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;

    if (!swipe.moved) {
      if (Math.abs(deltaX) < 6) return;

      if (
        event.pointerType !== 'mouse' &&
        Math.abs(deltaY) > Math.abs(deltaX)
      ) {
        resetSwipeState();
        return;
      }

      swipe.moved = true;
      wrapperRef.current?.classList.add('is-swiping');

      try {
        wrapperRef.current?.setPointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture is optional. Native scrolling remains available.
      }
    }

    swipe.scrollTarget.scrollLeft = swipe.startScrollLeft - deltaX;

    if (event.cancelable) {
      event.preventDefault();
    }
  }

  function finishSwipe(event) {
    const swipe = swipeRef.current;

    if (!swipe.active || swipe.pointerId !== event.pointerId) {
      return;
    }

    if (swipe.moved) {
      swipe.suppressClickUntil =
        typeof performance !== 'undefined'
          ? performance.now() + 180
          : Date.now() + 180;
    }

    resetSwipeState();

    try {
      wrapperRef.current?.releasePointerCapture?.(event.pointerId);
    } catch {
      // Browser may already have released the pointer.
    }
  }

  function cancelSwipe(event) {
    resetSwipeState();

    try {
      wrapperRef.current?.releasePointerCapture?.(event.pointerId);
    } catch {
      // Browser may already have released the pointer.
    }
  }

  function suppressSwipeClick(event) {
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (now < swipeRef.current.suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <div
      ref={wrapperRef}
      className={`report-table-swipe ${className}`.trim()}
      onPointerDownCapture={handlePointerDown}
      onPointerMoveCapture={handlePointerMove}
      onPointerUpCapture={finishSwipe}
      onPointerCancelCapture={cancelSwipe}
      onLostPointerCapture={cancelSwipe}
      onClickCapture={suppressSwipeClick}
    >
      {children}
    </div>
  );
}


export default function Reports() {
  const [summary, setSummary] = useState(null);
  const [activeTab, setActiveTab] = useState('attendance');
  const [rows, setRows] = useState([]);
  const [tabSummary, setTabSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [refreshingSummary, setRefreshingSummary] = useState(false);
  const [refreshingRows, setRefreshingRows] = useState(false);
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
  const [reportPage, setReportPage] = useState(1);
  const [reportPageSize, setReportPageSize] = useState(10);
  const [feedbackMap, setFeedbackMap] = useState({});
  const feedbackTimersRef = useRef({});
  const hasLoadedSummaryRef = useRef(false);
  const hasLoadedRowsRef = useRef(false);

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

  const reportPageCount = Math.max(
    1,
    Math.ceil(
      rows.length / Math.max(1, Number(reportPageSize || 10)),
    ),
  );
  const safeReportPage = Math.min(
    Math.max(1, reportPage),
    reportPageCount,
  );
  const reportPageStart =
    (safeReportPage - 1) * reportPageSize;
  const pagedReportRows = rows.slice(
    reportPageStart,
    reportPageStart + reportPageSize,
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
      }, REPORT_NOTICE_HIDE_MS);
    }
  }

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
      clearFeedback('organisations');
      return true;
    } catch (error) {
      setOrganisations([]);
      showFeedback(
        'organisations',
        'error',
        error?.message ||
          'Unable to load organisations for attendance Excel export.',
        'Organisation Load Failed',
      );
      return false;
    }
  }

  async function loadEmployees() {
    try {
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
        error?.message ||
          'Unable to load employees for report filters.',
        'Employee Load Failed',
      );
      return false;
    }
  }

  async function loadSummary(
    nextFilters = filters,
    { showLoader = !hasLoadedSummaryRef.current } = {},
  ) {
    if (showLoader) {
      setLoadingSummary(true);
    } else {
      setRefreshingSummary(true);
    }

    try {
      const data = await api(
        `/reports/summary${buildQuery({
          tenant_id: nextFilters.tenant_id,
        })}`,
      );

      setSummary(data);
      clearFeedback('page');
      return true;
    } catch (error) {
      if (!hasLoadedSummaryRef.current) {
        setSummary(null);
      }

      showFeedback(
        'page',
        'error',
        error.message || 'Unable to load report summary',
        'Report Summary Load Failed',
      );
      return false;
    } finally {
      hasLoadedSummaryRef.current = true;

      if (showLoader) {
        setLoadingSummary(false);
      } else {
        setRefreshingSummary(false);
      }
    }
  }

  async function loadRows(
    tabKey = activeTab,
    nextFilters = filters,
    {
      showLoader = !hasLoadedRowsRef.current,
      feedbackScope = '',
      successText = 'Report records are up to date.',
      successTitle = 'Report Updated',
      errorTitle = 'Report Load Failed',
    } = {},
  ) {
    const selectedTab = REPORT_TABS.find((tab) => tab.key === tabKey);

    if (!selectedTab) {
      return false;
    }

    if (showLoader) {
      setLoadingRows(true);
    } else {
      setRefreshingRows(true);
    }

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        `Loading ${selectedTab.title.toLowerCase()}...`,
        'Working',
        { loading: true },
      );
    }

    try {
      const filteredPayload = activeTabFilters(tabKey, nextFilters);
      const data = await api(
        `${selectedTab.endpoint}${buildQuery(filteredPayload)}`,
      );

      setRows(normalizeRows(tabKey, data.items || []));
      setTabSummary(data.summary || null);
      setReportPage(1);
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
      if (!hasLoadedRowsRef.current) {
        setRows([]);
        setTabSummary(null);
      }

      showFeedback(
        feedbackScope || 'page',
        'error',
        error.message || 'Unable to load report',
        errorTitle,
      );
      return false;
    } finally {
      hasLoadedRowsRef.current = true;

      if (showLoader) {
        setLoadingRows(false);
      } else {
        setRefreshingRows(false);
      }
    }
  }

  async function refreshAll(
    tabKey = activeTab,
    nextFilters = filters,
    {
      showLoader = false,
      feedbackScope = '',
      successText = 'Report data is up to date.',
      successTitle = 'Refresh Complete',
      errorTitle = 'Refresh Failed',
    } = {},
  ) {
    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        'Refreshing report data...',
        'Refreshing',
        { loading: true },
      );
    }

    const [summaryLoaded, rowsLoaded] = await Promise.all([
      loadSummary(nextFilters, { showLoader }),
      loadRows(tabKey, nextFilters, {
        showLoader,
        errorTitle,
      }),
    ]);

    if (!feedbackScope) {
      return summaryLoaded && rowsLoaded;
    }

    if (summaryLoaded && rowsLoaded) {
      showFeedback(
        feedbackScope,
        'success',
        successText,
        successTitle,
      );
      return true;
    }

    showFeedback(
      feedbackScope,
      'error',
      'Some report data could not be updated. Existing results remain visible.',
      errorTitle,
    );
    return false;
  }

  useEffect(() => {
    refreshAll(activeTab, filters, { showLoader: true });
    loadOrganisations();
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setReportPage((current) =>
      Math.min(current, reportPageCount),
    );
  }, [reportPageCount]);

  useEffect(() => {
    function dismissFeedback(event) {
      if (event.target?.closest?.('.report-inline-feedback')) return;

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

  async function changeTab(tabKey) {
    if (tabKey === activeTab) {
      return;
    }

    setActiveTab(tabKey);
    setReportPage(1);
    clearFeedback('report-tab');

    await loadRows(tabKey, filters, {
      showLoader: false,
      errorTitle: 'Report Change Failed',
    });
  }

  async function searchReport(event) {
    event.preventDefault();
    setReportPage(1);

    await refreshAll(activeTab, filters, {
      showLoader: false,
      feedbackScope: 'search-report',
      successText: 'Report filters were applied successfully.',
      successTitle: 'Search Complete',
      errorTitle: 'Search Failed',
    });
  }

  async function clearFilters() {
    const cleared = { ...EMPTY_FILTERS };

    setFilters(cleared);
    setReportPage(1);

    await refreshAll(activeTab, cleared, {
      showLoader: false,
      feedbackScope: 'clear-filters',
      successText: 'Report filters were cleared.',
      successTitle: 'Filters Cleared',
      errorTitle: 'Clear Filters Failed',
    });
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

  function validateAttendanceExceptionFilters(
    feedbackScope = 'exception-preview',
  ) {
    if (
      exceptionFilters.period === 'month' &&
      (!exceptionFilters.year || !exceptionFilters.month)
    ) {
      showFeedback(
        feedbackScope,
        'warning',
        'Please select year and month.',
        'Month Required',
      );
      return false;
    }

    if (
      exceptionFilters.period === 'week' &&
      (!exceptionFilters.week_start || !exceptionFilters.week_end)
    ) {
      showFeedback(
        feedbackScope,
        'warning',
        'Please select week start and week end.',
        'Week Range Required',
      );
      return false;
    }

    if (
      exceptionFilters.period === 'day' &&
      !exceptionFilters.date
    ) {
      showFeedback(
        feedbackScope,
        'warning',
        'Please select a date.',
        'Date Required',
      );
      return false;
    }

    return true;
  }

  async function handleAttendanceExceptionPreview(event) {
    event.preventDefault();
    clearFeedback('exception-preview');

    if (
      !validateAttendanceExceptionFilters('exception-preview')
    ) {
      return;
    }

    setLoadingExceptions(true);

    showFeedback(
      'exception-preview',
      'info',
      'Loading attendance exception report...',
      'Loading Preview',
      { loading: true },
    );

    try {
      const data = await getAttendanceExceptionReports(
        attendanceExceptionPayload(),
      );
      const nextRows = normaliseAttendanceExceptionRows(
        data.items || [],
      );

      setExceptionRows(nextRows);
      setExceptionSummary(data.summary || null);

      if (!nextRows.length) {
        showFeedback(
          'exception-preview',
          'info',
          'No matching attendance exceptions were found for the selected filters.',
          'No Exceptions Found',
        );
      } else {
        showFeedback(
          'exception-preview',
          'success',
          'Attendance exception preview is ready.',
          'Preview Ready',
        );
      }
    } catch (error) {
      showFeedback(
        'exception-preview',
        'error',
        error.message ||
          'Unable to load attendance exception report.',
        'Report Load Failed',
      );
    } finally {
      setLoadingExceptions(false);
    }
  }

  async function handleAttendanceExceptionDownload() {
    clearFeedback('exception-download');

    if (
      !validateAttendanceExceptionFilters('exception-download')
    ) {
      return;
    }

    setDownloadingExceptionExcel(true);

    showFeedback(
      'exception-download',
      'info',
      'Preparing attendance exception Excel...',
      'Preparing Download',
      { loading: true },
    );

    try {
      await downloadAttendanceExceptionExcel(
        attendanceExceptionPayload(),
      );

      showFeedback(
        'exception-download',
        'success',
        'Attendance exception Excel downloaded successfully.',
        'Download Complete',
      );
    } catch (error) {
      showFeedback(
        'exception-download',
        'error',
        error.message ||
          'Unable to download attendance exception Excel report.',
        'Download Failed',
      );
    } finally {
      setDownloadingExceptionExcel(false);
    }
  }

  function validateAttendanceExcelFilters() {
    if (
      !excelFilters.organisation_id &&
      !excelFilters.organisation_code &&
      !excelFilters.organisation
    ) {
      showFeedback(
        'attendance-excel',
        'warning',
        'Please select Organisation / Entity before downloading the attendance Excel.',
        'Organisation Required',
      );
      return false;
    }

    if (
      excelFilters.period === 'month' &&
      (!excelFilters.year || !excelFilters.month)
    ) {
      showFeedback(
        'attendance-excel',
        'warning',
        'Please select year and month before downloading.',
        'Month Required',
      );
      return false;
    }

    if (
      excelFilters.period === 'week' &&
      (!excelFilters.week_start || !excelFilters.week_end)
    ) {
      showFeedback(
        'attendance-excel',
        'warning',
        'Please select week start and week end before downloading.',
        'Week Range Required',
      );
      return false;
    }

    if (
      excelFilters.period === 'day' &&
      !excelFilters.date
    ) {
      showFeedback(
        'attendance-excel',
        'warning',
        'Please select date before downloading.',
        'Date Required',
      );
      return false;
    }

    if (
      excelFilters.period === 'year' &&
      !excelFilters.year
    ) {
      showFeedback(
        'attendance-excel',
        'warning',
        'Please enter year before downloading.',
        'Year Required',
      );
      return false;
    }

    return true;
  }

  async function handleAttendanceExcelDownload(event) {
    event.preventDefault();
    clearFeedback('attendance-excel');

    if (!validateAttendanceExcelFilters()) {
      return;
    }

    setDownloadingExcel(true);

    showFeedback(
      'attendance-excel',
      'info',
      'Preparing the styled attendance Excel...',
      'Preparing Download',
      { loading: true },
    );

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

      showFeedback(
        'attendance-excel',
        'success',
        'Attendance Excel downloaded successfully.',
        'Download Complete',
      );
    } catch (error) {
      showFeedback(
        'attendance-excel',
        'error',
        error.message ||
          'Unable to download attendance Excel report.',
        'Download Failed',
      );
    } finally {
      setDownloadingExcel(false);
    }
  }

  const counts = summary?.counts || {};
  const extra = summary?.extra || {};
  const leaveSummary = normalizeLeaveSummary(tabSummary);
  const balanceSummary = normalizeBalanceSummary(tabSummary || extra?.leave?.balance_summary);

  const topKpis = [
    ['Employees', counts.employees || 0],
    ['Attendance Logs', counts.attendance_logs || 0],
    ['Leave Requests', counts.leave_requests || 0],
    ['Audit Logs', counts.audit_logs || 0],
  ];

  const coverageItems = [
    ['Holiday Work Requests', counts.holiday_work_requests || 0],
    ['Holiday Calendar', counts.holiday_calendar || 0],
    ['Comp-Off Credits', counts.compoff_credits || 0],
    ['Leave Balances', counts.leave_balances || 0],
    ['Tickets', counts.tickets || 0],
    ['Expenses', counts.expenses || 0],
  ];

  return (
    <div className="page-grid reports-center-page">

      <style>{`
        .reports-center-page {
          --report-ink: #101a3a;
          --report-muted: #5d6d8d;
          --report-primary: #4d77dd;
          --report-deep: #40348d;
          --report-blue: #4d77dd;
          --report-teal: #2eb2b9;
          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding-bottom: max(34px, env(safe-area-inset-bottom));
          color: var(--report-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .reports-center-page,
        .reports-center-page * {
          box-sizing: border-box;
        }

        .reports-center-page > *,
        .reports-center-page section,
        .reports-center-page form,
        .reports-center-page label,
        .reports-center-page nav {
          min-width: 0;
          max-width: 100%;
        }

        .reports-center-page::before,
        .reports-center-page::after,
        .reports-center-page > .hero::before,
        .reports-center-page > .hero::after,
        .reports-center-page .report-kpi::before,
        .reports-center-page .report-kpi::after {
          content: none;
          display: none;
          background: none;
        }

        .reports-center-page > .hero {
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

        .reports-center-page .report-hero-copy {
          min-width: 0;
          max-width: 900px;
        }

        .reports-center-page .kicker,
        .reports-center-page .section-kicker {
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

        .reports-center-page .kicker {
          margin-bottom: 15px;
          padding: 9px 13px;
          box-shadow: 0 8px 18px rgba(77, 119, 221, .18);
        }

        .reports-center-page .section-kicker {
          margin-bottom: 9px;
          padding: 7px 10px;
          box-shadow: 0 7px 15px rgba(77, 119, 221, .14);
        }

        .reports-center-page > .hero h1 {
          max-width: 860px;
          margin: 0;
          color: var(--report-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 76px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .reports-center-page > .hero h1 em {
          color: var(--report-primary);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .reports-center-page > .hero p {
          max-width: 850px;
          margin: 17px 0 0;
          color: var(--report-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .reports-center-page button {
          touch-action: manipulation;
          font-weight: 900;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            filter 180ms ease,
            opacity 180ms ease;
        }

        .reports-center-page button:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: saturate(1.03);
        }

        .reports-center-page button:active:not(:disabled) {
          transform: translateY(0);
        }

        .reports-center-page button:disabled {
          opacity: .56;
          cursor: not-allowed;
          transform: none;
          filter: none;
        }

        .reports-center-page .primary,
        .reports-center-page .secondary {
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

        .reports-center-page .primary {
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 10px 22px rgba(77, 119, 221, .18);
        }

        .reports-center-page .secondary {
          border-color: rgba(77, 119, 221, .18);
          color: #4767b4;
          background: #fff;
        }

        .reports-center-page .hero-action-stack,
        .reports-center-page .toolbar-action-stack,
        .reports-center-page .form-action-stack {
          display: grid;
          gap: 9px;
          min-width: 0;
        }

        .reports-center-page .hero-action-stack {
          width: min(300px, 100%);
        }

        .reports-center-page .hero-action-stack .secondary {
          width: max-content;
          min-width: 130px;
        }

        .reports-center-page .report-inline-feedback {
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

        .reports-center-page .report-inline-feedback.success {
          border-color: rgba(4, 120, 87, .18);
          color: #047857;
          background: #eaf8f4;
        }

        .reports-center-page .report-inline-feedback.warning {
          border-color: rgba(154, 104, 23, .18);
          color: #9a6817;
          background: #fff4d5;
        }

        .reports-center-page .report-inline-feedback.error {
          border-color: rgba(162, 52, 77, .18);
          color: #a2344d;
          background: #fff0f2;
        }

        .reports-center-page .report-inline-feedback-icon {
          width: 22px;
          height: 22px;
          display: inline-grid;
          place-items: center;
        }

        .reports-center-page .report-inline-feedback-copy {
          min-width: 0;
        }

        .reports-center-page .report-inline-feedback-copy strong,
        .reports-center-page .report-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .reports-center-page .report-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .reports-center-page .report-inline-feedback-copy span {
          font-weight: 750;
        }

        .reports-center-page .report-inline-feedback-close {
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

        .reports-center-page .report-inline-feedback-close:hover {
          background: #fff;
        }

        .reports-center-page .page-feedback {
          width: min(680px, 100%);
        }

        .reports-center-page .report-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .reports-center-page .report-kpi {
          min-width: 0;
          min-height: 120px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 0 16px 30px rgba(34, 38, 110, .07);
        }

        .reports-center-page .report-kpi:nth-child(2) {
          background: #eaf8f4;
        }

        .reports-center-page .report-kpi:nth-child(3) {
          background: #fff4d5;
        }

        .reports-center-page .report-kpi:nth-child(4) {
          background: #f1efff;
        }

        .reports-center-page .report-kpi span,
        .reports-center-page .report-kpi strong,
        .reports-center-page .report-kpi small {
          display: block;
        }

        .reports-center-page .report-kpi span {
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .reports-center-page .report-kpi strong {
          margin-top: 8px;
          color: var(--report-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(28px, 3vw, 42px);
          line-height: 1;
        }

        .reports-center-page .report-kpi small {
          margin-top: 7px;
          color: var(--report-muted);
          font-size: 11px;
          line-height: 1.45;
        }

        .reports-center-page .three-col {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
        }

        .reports-center-page .two-col {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .reports-center-page .panel {
          min-width: 0;
          overflow: hidden;
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(24px, 2.2vw, 34px);
          background: #fff;
          box-shadow: 0 20px 38px rgba(34, 38, 110, .08);
        }

        .reports-center-page .panel > h3 {
          margin: 0;
          padding: 23px 25px 18px;
          border-bottom: 1px solid rgba(65, 55, 161, .08);
          color: var(--report-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(21px, 2vw, 29px);
          font-weight: 760;
          letter-spacing: -.03em;
          background:
            linear-gradient(
              180deg,
              rgba(245, 248, 255, .82),
              rgba(255, 255, 255, .32)
            );
        }

        .reports-center-page .toolbar {
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

        .reports-center-page .toolbar > div {
          min-width: 0;
        }

        .reports-center-page .toolbar h3 {
          margin: 0;
          color: var(--report-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.4vw, 35px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .reports-center-page .toolbar p {
          margin: 8px 0 0;
          color: var(--report-muted);
          font-size: 13px;
          line-height: 1.55;
        }

        .reports-center-page .mini-list {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          padding: 18px 25px 25px;
        }

        .reports-center-page .mini-list > span,
        .reports-center-page .detail-summary-grid > span {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
          padding: 13px;
          border: 1px solid rgba(162, 169, 196, .46);
          border-radius: 15px;
          background: #f8fbff;
        }

        .reports-center-page .mini-list > span:nth-child(2n),
        .reports-center-page .detail-summary-grid > span:nth-child(2n) {
          background: #f4fbf8;
        }

        .reports-center-page .mini-list strong,
        .reports-center-page .detail-summary-grid strong {
          color: #334164;
          font-size: 12px;
          line-height: 1.4;
        }

        .reports-center-page .mini-list small,
        .reports-center-page .detail-summary-grid small {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 34px;
          min-height: 30px;
          padding: 0 10px;
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          font-size: 12px;
          font-weight: 950;
        }

        .reports-center-page .detail-summary-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
          padding: 14px 20px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 20px;
          background: #fff;
          box-shadow: 0 14px 28px rgba(34, 38, 110, .06);
        }

        .reports-center-page .dynamic-form {
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

        .reports-center-page .dynamic-form label {
          display: grid;
          min-width: 0;
          gap: 7px;
          color: #334164;
          font-size: 12px;
          font-weight: 900;
        }

        .reports-center-page .dynamic-form input,
        .reports-center-page .dynamic-form select {
          width: 100%;
          min-width: 0;
          min-height: 46px;
          border: 1px solid rgba(159, 169, 205, .62);
          border-radius: 14px;
          outline: none;
          background: rgba(255, 255, 255, .96);
          color: var(--report-ink);
          padding: 0 13px;
          font: inherit;
          font-weight: 600;
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease,
            background 180ms ease;
        }

        .reports-center-page .dynamic-form input:hover,
        .reports-center-page .dynamic-form select:hover {
          border-color: rgba(77, 119, 221, .34);
        }

        .reports-center-page .dynamic-form input:focus,
        .reports-center-page .dynamic-form select:focus {
          border-color: var(--report-primary);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
        }

        .reports-center-page .form-action-stack {
          align-self: end;
          width: 100%;
        }

        .reports-center-page .form-action-stack .primary,
        .reports-center-page .form-action-stack .secondary {
          width: 100%;
        }

        .reports-center-page .report-tab-row {
          display: flex;
          gap: 9px;
          overflow-x: auto;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(65, 55, 161, .09);
          background:
            linear-gradient(
              145deg,
              rgba(237, 248, 255, .42),
              rgba(248, 241, 255, .4)
            );
          scrollbar-width: thin;
          scrollbar-color: rgba(77, 119, 221, .35) transparent;
          -webkit-overflow-scrolling: touch;
        }

        .reports-center-page .report-tab-row::-webkit-scrollbar {
          height: 7px;
        }

        .reports-center-page .report-tab-row::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(77, 119, 221, .35);
        }

        .reports-center-page .report-tab-row button {
          flex: 0 0 auto;
          min-height: 38px;
          padding: 0 13px;
          border: 1px solid rgba(77, 119, 221, .14);
          border-radius: 999px;
          color: #4f5e7f;
          background: #fff;
          box-shadow: none;
          font-size: 11px;
          white-space: nowrap;
        }

        .reports-center-page .report-tab-row button.selected {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 7px 15px rgba(77, 119, 221, .16);
        }

        .reports-center-page .report-record-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 20px;
          border-bottom: 1px solid rgba(65, 55, 161, .08);
          background: #fff;
        }

        .reports-center-page .report-record-toolbar > span {
          color: var(--report-muted);
          font-size: 11px;
          font-weight: 850;
        }

        .reports-center-page .page-size-control {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--report-muted);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .reports-center-page .page-size-control select {
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

        .reports-center-page .page-size-control select:focus {
          border-color: rgba(77, 119, 221, .65);
          box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
        }

        .reports-center-page .report-table-swipe {
          width: 100%;
          max-width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          background: #fff;
          scrollbar-width: thin;
          scrollbar-color: rgba(77, 119, 221, .35) transparent;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
          touch-action: pan-y pinch-zoom;
          cursor: grab;
        }

        .reports-center-page .report-table-swipe.is-swiping {
          cursor: grabbing;
          user-select: none;
        }

        .reports-center-page .report-table-swipe.is-swiping * {
          user-select: none;
        }

        .reports-center-page .report-table-swipe::-webkit-scrollbar {
          height: 8px;
        }

        .reports-center-page .report-table-swipe::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(77, 119, 221, .30);
        }

        .reports-center-page .report-table-swipe table {
          min-width: max-content;
        }

        .reports-center-page .report-pagination {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 14px;
          padding: 13px 20px;
          border-top: 1px solid rgba(65, 55, 161, .08);
          background: #fff;
        }

        .reports-center-page .report-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .reports-center-page .report-page-button,
        .reports-center-page .report-page-number {
          border: 1px solid rgba(77, 119, 221, .18);
          color: #4767b4;
          background: #fff;
          font: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
        }

        .reports-center-page .report-page-button {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 11px;
        }

        .reports-center-page .report-page-nav {
          min-width: 78px;
        }

        .reports-center-page .report-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .reports-center-page .report-page-number {
          width: 36px;
          height: 36px;
          padding: 0;
          display: grid;
          place-items: center;
          border-radius: 10px;
        }

        .reports-center-page .report-page-number.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        }

        .reports-center-page .report-page-ellipsis {
          width: 18px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .reports-center-page .report-page-indicator {
          min-width: 82px;
          color: var(--report-muted);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
        }

        .reports-center-page .inline-message {
          margin: 18px 24px;
          padding: 15px 16px;
          border: 1px solid rgba(77, 119, 221, .14);
          border-radius: 15px;
          color: var(--report-deep);
          background: #f1efff;
          font-size: 12px;
          font-weight: 850;
        }

        .reports-center-page .panel a {
          color: var(--report-blue);
          font-weight: 850;
          text-decoration: none;
        }

        .reports-center-page .panel a:hover {
          text-decoration: underline;
        }

        .reports-center-page .panel > :last-child {
          border-bottom-left-radius: inherit;
          border-bottom-right-radius: inherit;
        }

        .reports-center-page .report-spin {
          animation: reportSpin .82s linear infinite;
        }

        @keyframes reportSpin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1180px) {
          .reports-center-page .report-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .reports-center-page .three-col {
            grid-template-columns: 1fr;
          }

          .reports-center-page .detail-summary-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .reports-center-page .dynamic-form {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 900px) {
          .reports-center-page > .hero,
          .reports-center-page .two-col {
            grid-template-columns: 1fr;
          }

          .reports-center-page .hero-action-stack {
            width: min(360px, 100%);
          }

          .reports-center-page .dynamic-form {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .reports-center-page .toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .reports-center-page .toolbar-action-stack {
            width: min(360px, 100%);
          }
        }

        @media (max-width: 640px) {
          .reports-center-page {
            gap: 15px;
          }

          .reports-center-page > .hero {
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 0 18px 30px rgba(34, 38, 110, .09);
          }

          .reports-center-page > .hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .reports-center-page .hero-action-stack,
          .reports-center-page .hero-action-stack .secondary {
            width: 100%;
          }

          .reports-center-page .report-kpi-grid {
            grid-template-columns: 1fr;
          }

          .reports-center-page .panel {
            border-radius: 23px;
          }

          .reports-center-page .toolbar {
            padding: 20px 17px 15px;
          }

          .reports-center-page .mini-list {
            grid-template-columns: 1fr;
            padding: 16px 17px 20px;
          }

          .reports-center-page .detail-summary-grid {
            grid-template-columns: 1fr;
          }

          .reports-center-page .dynamic-form {
            grid-template-columns: 1fr;
            padding: 16px 17px 20px;
          }

          .reports-center-page .form-action-stack {
            width: 100%;
          }

          .reports-center-page .report-record-toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .reports-center-page .page-size-control {
            justify-content: space-between;
          }

          .reports-center-page .report-pagination {
            justify-content: stretch;
            padding: 12px;
          }

          .reports-center-page .report-pagination-controls {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
          }

          .reports-center-page .report-page-numbers,
          .reports-center-page .report-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .reports-center-page .report-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .reports-center-page .report-page-nav {
            width: 100%;
          }

          .reports-center-page .report-tab-row {
            padding-left: 14px;
            padding-right: 14px;
          }
        }

        @media (max-width: 390px) {
          .reports-center-page > .hero {
            padding: 16px;
          }

          .reports-center-page > .hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .reports-center-page .report-page-number {
            width: 34px;
            height: 34px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .reports-center-page *,
          .reports-center-page *::before,
          .reports-center-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <section className="hero compact">
        <div className="report-hero-copy">
          <span className="kicker">
            <Sparkles size={13} />
            Reports
          </span>

          <h1>
            HRMS reports, <em>clearly.</em>
          </h1>

          <p>
            View attendance, field attendance with location/photo, holiday work
            approvals, comp-off credits, comp-off claims, expired comp-off,
            leave workflow approvals, leave deductions, and audit logs from one
            reporting screen.
          </p>
        </div>

        <div className="hero-action-stack">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              refreshAll(activeTab, filters, {
                showLoader: false,
                feedbackScope: 'refresh',
              })
            }
            disabled={
              loadingSummary ||
              loadingRows ||
              refreshingSummary ||
              refreshingRows
            }
          >
            {refreshingSummary || refreshingRows ? (
              <Loader2 size={16} className="report-spin" />
            ) : (
              <RefreshCcw size={16} />
            )}
            {refreshingSummary || refreshingRows
              ? 'Refreshing...'
              : 'Refresh'}
          </button>

          <ReportInlineMessage
            message={feedbackMap.refresh}
            onClose={() => clearFeedback('refresh')}
          />
        </div>
      </section>

      <section
        className="report-kpi-grid"
        aria-label="Reports center summary"
      >
        {topKpis.map(([label, value]) => (
          <ReportKpi
            key={label}
            label={label}
            value={value}
          />
        ))}
      </section>

      {feedbackMap.page ? (
        <div className="page-feedback">
          <ReportInlineMessage
            message={feedbackMap.page}
            onClose={() => clearFeedback('page')}
          />
        </div>
      ) : null}

      {feedbackMap.organisations ? (
        <div className="page-feedback">
          <ReportInlineMessage
            message={feedbackMap.organisations}
            onClose={() => clearFeedback('organisations')}
          />
        </div>
      ) : null}

      {feedbackMap.employees ? (
        <div className="page-feedback">
          <ReportInlineMessage
            message={feedbackMap.employees}
            onClose={() => clearFeedback('employees')}
          />
        </div>
      ) : null}

      <section className="three-col">
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

        <div className="panel">
          <h3>Additional Report Coverage</h3>

          <div className="mini-list">
            {coverageItems.map(([label, value]) => (
              <span key={label}>
                <strong>{label}</strong>
                <small>{value}</small>
              </span>
            ))}
          </div>
        </div>
      </section>

      {showLeaveAdvancedFilters ? (
        <section
          className="detail-summary-grid"
          aria-label="Filtered leave summary"
        >
          {[
            ['Filtered Leaves', leaveSummary.total],
            ['Pending', leaveSummary.pending],
            ['Approved', leaveSummary.approved],
            ['Rejected', leaveSummary.rejected],
            ['Pending TL', leaveSummary.pending_with_team_leader],
            ['Pending RO', leaveSummary.pending_with_reporting_officer],
            ['Half Day', leaveSummary.half_day],
            ['LWP Days', leaveSummary.lwp],
            ['Deducted Days', leaveSummary.deducted_days],
            ['Total Leave Days', leaveSummary.total_days],
          ].map(([label, value]) => (
            <span key={label}>
              <strong>{label}</strong>
              <small>{value}</small>
            </span>
          ))}
        </section>
      ) : null}

      {activeTab === 'leave-balances' ? (
        <section
          className="detail-summary-grid"
          aria-label="Leave balance summary"
        >
          {[
            ['Employees', balanceSummary.employees],
            ['CL Credited', balanceSummary.casual_credited],
            ['CL Used', balanceSummary.casual_used],
            ['CL Available', balanceSummary.casual_available],
            ['EL Credited', balanceSummary.earned_credited],
            ['EL Used', balanceSummary.earned_used],
            ['EL Available', balanceSummary.earned_available],
            ['Total Available', balanceSummary.total_available],
          ].map(([label, value]) => (
            <span key={label}>
              <strong>{label}</strong>
              <small>{value}</small>
            </span>
          ))}
        </section>
      ) : null}

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

          <div className="form-action-stack">
            <button
              type="submit"
              className="primary"
              disabled={downloadingExcel}
            >
              {downloadingExcel ? (
                <Loader2 size={16} className="report-spin" />
              ) : (
                <Download size={16} />
              )}
              {downloadingExcel
                ? 'Downloading...'
                : 'Download Styled Attendance Excel'}
            </button>

            <ReportInlineMessage
              message={feedbackMap['attendance-excel']}
              onClose={() => clearFeedback('attendance-excel')}
            />
          </div>
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

          <div className="form-action-stack">
            <button
              type="submit"
              className="primary"
              disabled={loadingExceptions || downloadingExceptionExcel}
            >
              {loadingExceptions ? (
                <Loader2 size={16} className="report-spin" />
              ) : (
                <Search size={16} />
              )}
              {loadingExceptions ? 'Loading...' : 'Preview Report'}
            </button>

            <ReportInlineMessage
              message={feedbackMap['exception-preview']}
              onClose={() => clearFeedback('exception-preview')}
            />
          </div>

          <div className="form-action-stack">
            <button
              type="button"
              className="secondary"
              onClick={handleAttendanceExceptionDownload}
              disabled={loadingExceptions || downloadingExceptionExcel}
            >
              {downloadingExceptionExcel ? (
                <Loader2 size={16} className="report-spin" />
              ) : (
                <Download size={16} />
              )}
              {downloadingExceptionExcel
                ? 'Downloading...'
                : 'Download Excel'}
            </button>

            <ReportInlineMessage
              message={feedbackMap['exception-download']}
              onClose={() => clearFeedback('exception-download')}
            />
          </div>
        </form>

        {exceptionSummary ? (
          <section
            className="detail-summary-grid"
            aria-label="Attendance exception summary"
          >
            {[
              ['Absent Records', exceptionSummary.absent_records || 0],
              ['Absent Employees', exceptionSummary.absent_employees || 0],
              [
                'Missing Checkout Records',
                exceptionSummary.missing_checkout_records || 0,
              ],
              [
                'Missing Checkout Employees',
                exceptionSummary.missing_checkout_employees || 0,
              ],
            ].map(([label, value]) => (
              <span key={label}>
                <strong>{label}</strong>
                <small>{value}</small>
              </span>
            ))}
          </section>
        ) : null}

        {loadingExceptions && !exceptionSummary ? (
          <div className="inline-message">
            Loading attendance exception report...
          </div>
        ) : null}

        {exceptionSummary ? (
          <SwipeableReportTable className="exception-table-swipe">
            <Table rows={exceptionRows} maxColumns={18} />
          </SwipeableReportTable>
        ) : null}
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

          {hasActiveFilters ? (
            <div className="toolbar-action-stack">
              <button
                type="button"
                className="secondary"
                onClick={clearFilters}
                disabled={
                  loadingRows ||
                  loadingSummary ||
                  refreshingRows ||
                  refreshingSummary
                }
              >
                {feedbackMap['clear-filters']?.loading ? (
                  <Loader2 size={16} className="report-spin" />
                ) : (
                  <X size={16} />
                )}
                {feedbackMap['clear-filters']?.loading
                  ? 'Clearing...'
                  : 'Clear Filters'}
              </button>

              <ReportInlineMessage
                message={feedbackMap['clear-filters']}
                onClose={() => clearFeedback('clear-filters')}
              />
            </div>
          ) : null}
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

          <div className="form-action-stack">
            <button
              type="submit"
              className="primary"
              disabled={
                loadingRows ||
                loadingSummary ||
                refreshingRows ||
                refreshingSummary
              }
            >
              {feedbackMap['search-report']?.loading ? (
                <Loader2 size={16} className="report-spin" />
              ) : (
                <Search size={16} />
              )}
              {feedbackMap['search-report']?.loading
                ? 'Searching...'
                : 'Search Report'}
            </button>

            <ReportInlineMessage
              message={feedbackMap['search-report']}
              onClose={() => clearFeedback('search-report')}
            />
          </div>

          <div className="form-action-stack">
            <button
              type="button"
              className="secondary"
              onClick={clearFilters}
              disabled={
                loadingRows ||
                loadingSummary ||
                refreshingRows ||
                refreshingSummary
              }
            >
              {feedbackMap['clear-filters']?.loading ? (
                <Loader2 size={16} className="report-spin" />
              ) : (
                <X size={16} />
              )}
              {feedbackMap['clear-filters']?.loading
                ? 'Clearing...'
                : 'Clear'}
            </button>

            <ReportInlineMessage
              message={feedbackMap['clear-filters']}
              onClose={() => clearFeedback('clear-filters')}
            />
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <span className="section-kicker">
              Report Directory
            </span>
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
              disabled={loadingRows || refreshingRows}
            >
              {tab.title}
            </button>
          ))}
        </div>

        <div className="report-record-toolbar">
          <span>
            {rows.length.toLocaleString('en-IN')} record
            {rows.length === 1 ? '' : 's'}
          </span>

          <label className="page-size-control">
            <span>View</span>
            <select
              value={reportPageSize}
              onChange={(event) => {
                setReportPage(1);
                setReportPageSize(Number(event.target.value));
              }}
              aria-label="Report rows per page"
            >
              {REPORT_PAGE_SIZES.map((size) => (
                <option value={size} key={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loadingRows && !rows.length ? (
          <div className="inline-message">
            <Loader2 size={16} className="report-spin" /> Loading report...
          </div>
        ) : null}

        <SwipeableReportTable>
          <Table rows={pagedReportRows} maxColumns={16} />
        </SwipeableReportTable>

        <ReportPagination
          total={rows.length}
          page={safeReportPage}
          pageSize={reportPageSize}
          onPageChange={setReportPage}
        />
      </section>
    </div>
  );
}