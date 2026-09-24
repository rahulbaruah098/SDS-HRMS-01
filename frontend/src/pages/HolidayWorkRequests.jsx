import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Inbox,
  ListChecks,
  Loader2,
  MapPin,
  PlusCircle,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  api,
  buildQuery,
  createHolidayWorkRequest,
  getHolidayWorkRequests,
  getMyHolidayWorkRequests,
  decideHolidayWorkRequest,
} from '../api/client';

const MANAGER_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'team_leader',
  'reporting_officer',
  'manager',
  'ro',
]);

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const HWR_NOTICE_HIDE_MS = 3600;
const HWR_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function normalizeRoles(user = {}) {
  const roles = new Set();

  if (Array.isArray(user.roles)) {
    user.roles.forEach((role) => {
      const normalized = normalizeRole(role);
      if (normalized) roles.add(normalized);
    });
  }

  if (typeof user.roles === 'string') {
    user.roles.split(',').forEach((role) => {
      const normalized = normalizeRole(role);
      if (normalized) roles.add(normalized);
    });
  }

  const role = normalizeRole(user.role);
  if (role) roles.add(role);

  return Array.from(roles);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }

  return '';
}

function formatDate(dateValue) {
  if (!dateValue) return '—';

  const date = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    weekday: 'short',
  });
}

function toIsoDate(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function addDays(dateObj, days) {
  const next = new Date(dateObj);
  next.setDate(next.getDate() + days);
  return next;
}

function isSecondOrFourthSaturday(dateObj) {
  if (dateObj.getDay() !== 6) return false;

  const day = dateObj.getDate();
  const saturdayNumber = Math.ceil(day / 7);

  return saturdayNumber === 2 || saturdayNumber === 4;
}

function getWeeklyHolidayTitle(dateObj) {
  if (dateObj.getDay() === 0) {
    return 'Sunday Holiday';
  }

  if (isSecondOrFourthSaturday(dateObj)) {
    return 'Saturday Holiday';
  }

  return '';
}

function buildUpcomingWeeklyHolidays(daysAhead = 90) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items = [];

  for (let index = 0; index <= daysAhead; index += 1) {
    const current = addDays(today, index);
    const title = getWeeklyHolidayTitle(current);

    if (!title) continue;

    items.push({
      date: toIsoDate(current),
      title,
      holiday_type: 'weekly',
      source: 'weekly',
      message:
        title === 'Sunday Holiday'
          ? 'Sunday is a weekly holiday.'
          : 'Second and fourth Saturday are weekly holidays.',
    });
  }

  return items;
}

function uniqueHolidayOptions(manualItems = []) {
  const weekly = buildUpcomingWeeklyHolidays(90);
  const map = new Map();

  weekly.forEach((item) => {
    map.set(item.date, item);
  });

  manualItems.forEach((item) => {
    if (!item?.date) return;

    map.set(item.date, {
      date: item.date,
      title: item.title || item.holiday_title || 'Holiday',
      holiday_type: item.holiday_type || 'manual',
      source: 'calendar',
      message: item.message || '',
      state: item.state || '',
    });
  });

  return Array.from(map.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function statusLabel(value) {
  const status = String(value || '').toLowerCase();

  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'pending') return 'Pending';

  return value || '—';
}

function approvalLabel(row = {}) {
  return (
    row.approval_stage_label ||
    row.pending_approver_role ||
    row.approval_stage ||
    row.status ||
    '—'
  );
}

function getEmployeeProfile(user = {}) {
  const employee = user.employee || user.employee_summary || user.profile || {};

  return {
    employee_id: firstNonEmpty(
      employee._id,
      user.employee_id,
      user.employee_ref_id,
      user.emp_id,
      user._id,
    ),
    employee_name: firstNonEmpty(
      employee.name,
      employee.employee_name,
      employee.full_name,
      user.name,
      user.employee_name,
      user.full_name,
      user.email,
    ),
    employee_code: firstNonEmpty(
      employee.employee_code,
      employee.emp_code,
      employee.code,
      user.employee_code,
      user.emp_code,
      user.code,
    ),
    department: firstNonEmpty(employee.department, user.department),
    designation: firstNonEmpty(employee.designation, user.designation),
    state: firstNonEmpty(employee.state, employee.office_state, user.state),
    team_leader_name: firstNonEmpty(employee.team_leader_name, user.team_leader_name),
    reporting_officer_name: firstNonEmpty(
      employee.reporting_officer_name,
      user.reporting_officer_name,
    ),
  };
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function requestMatchesSearch(row = {}, search = '') {
  const term = normalizeSearchText(search);
  if (!term) return true;

  const haystack = [
    row.employee_name,
    row.employee_code,
    row.department,
    row.designation,
    row.date,
    row.holiday_title,
    row.holiday_type,
    row.reason,
    row.work_location,
    row.field_location,
    row.status,
    approvalLabel(row),
    row.team_leader_name,
    row.reporting_officer_name,
    row.decided_by_name,
  ]
    .map((value) => normalizeSearchText(value))
    .join(' ');

  return haystack.includes(term);
}

function pageCountFor(rows = [], pageSize = 10) {
  if (pageSize === 'all') return 1;
  return Math.max(1, Math.ceil((rows?.length || 0) / Number(pageSize || 10)));
}

function paginateRows(rows = [], page = 1, pageSize = 10) {
  if (pageSize === 'all') return rows;

  const size = Number(pageSize || 10);
  const safePage = Math.max(1, Number(page || 1));
  const start = (safePage - 1) * size;

  return rows.slice(start, start + size);
}

function pageNumbers(pageCount, page) {
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

function HolidayWorkInlineMessage({ feedback, onClose, className = '' }) {
  if (!feedback?.message) return null;

  return (
    <div
      className={`hwr-inline-feedback ${feedback.type || 'info'} ${className}`.trim()}
      role="status"
    >
      <span className="hwr-inline-feedback-icon">
        {feedback.loading ? (
          <Loader2 size={15} className="hwr-spin" />
        ) : feedback.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : feedback.type === 'error' || feedback.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="hwr-inline-feedback-copy">
        {feedback.title ? <strong>{feedback.title}</strong> : null}
        <span>{feedback.message}</span>
      </span>

      <button
        type="button"
        className="hwr-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function HolidayWorkPagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label = 'requests',
}) {
  const pageCount = pageSize === 'all'
    ? 1
    : Math.max(1, Math.ceil(Number(total || 0) / Number(pageSize || 10)));

  if (!total) return null;

  const safePage = Math.min(Math.max(1, page), pageCount);

  return (
    <div className="hwr-pagination">
      <div className="hwr-pagination-copy">
        <strong>{Number(total || 0).toLocaleString('en-IN')}</strong>
        <span>{label}</span>
      </div>

      <div className="hwr-pagination-controls">
        <label className="hwr-page-size-control">
          <span>View</span>
          <select
            value={pageSize}
            onChange={(event) =>
              onPageSizeChange(
                event.target.value === 'all'
                  ? 'all'
                  : Number(event.target.value),
              )
            }
            aria-label={`Number of ${label} to show`}
          >
            <option value="all">View All</option>
            {HWR_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="hwr-page-button"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1 || pageSize === 'all'}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
          <span>Previous</span>
        </button>

        <div className="hwr-page-numbers" aria-label="Pagination">
          {pageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`hwr-page-number ${item === safePage ? 'active' : ''}`}
                onClick={() => onPageChange(item)}
                disabled={pageSize === 'all'}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span key={item} className="hwr-page-ellipsis">
                …
              </span>
            ),
          )}
        </div>

        <span className="hwr-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="hwr-page-button"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount || pageSize === 'all'}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function RequestCard({ row, canManage, decidingId, onDecision }) {
  const isPending = String(row.status || '').toLowerCase() === 'pending';

  return (
    <article className="hwr-request-card">
      <div className="hwr-request-top">
        <div>
          <span className="hwr-request-id">Holiday Work</span>
          <h3>{row.employee_name || 'Employee'}</h3>
          <p>
            {row.department || 'Department not set'}
            {row.designation ? ` • ${row.designation}` : ''}
          </p>
        </div>

        <span className={`hwr-status ${String(row.status || 'pending').toLowerCase()}`}>
          {statusLabel(row.status)}
        </span>
      </div>

      <div className="hwr-request-grid">
        <div>
          <span>Date</span>
          <strong>{formatDate(row.date)}</strong>
        </div>

        <div>
          <span>Holiday</span>
          <strong>{row.holiday_title || 'Holiday'}</strong>
        </div>

        <div>
          <span>Type</span>
          <strong>{row.holiday_type || 'Holiday'}</strong>
        </div>

        <div>
          <span>Approval Stage</span>
          <strong>{approvalLabel(row)}</strong>
        </div>
      </div>

      <div className="hwr-request-copy-grid">
        <div className="hwr-reason-box">
          <span>Reason</span>
          <p>{row.reason || '—'}</p>
        </div>

        {row.work_location || row.field_location ? (
          <div className="hwr-location-box">
            <span>Work Location</span>
            <p>
              <MapPin size={14} />
              {row.work_location || row.field_location}
            </p>
          </div>
        ) : null}
      </div>

      <div className="hwr-meta-line">
        <span>TL: {row.team_leader_name || '—'}</span>
        <span>RO: {row.reporting_officer_name || '—'}</span>
        {row.decided_by_name ? <span>Decided by: {row.decided_by_name}</span> : null}
      </div>

      {canManage && isPending ? (
        <div className="hwr-actions">
          <button
            type="button"
            className="hwr-approve"
            disabled={decidingId === row._id}
            onClick={() => onDecision(row, 'approved')}
          >
            {decidingId === row._id ? (
              <Loader2 size={15} className="hwr-spin" />
            ) : (
              <CheckCircle2 size={15} />
            )}
            {decidingId === row._id ? 'Updating...' : 'Approve'}
          </button>

          <button
            type="button"
            className="hwr-reject"
            disabled={decidingId === row._id}
            onClick={() => onDecision(row, 'rejected')}
          >
            <XCircle size={15} />
            Reject
          </button>
        </div>
      ) : null}
    </article>
  );
}

function HolidayWorkDecisionModal({
  pendingDecision,
  decidingId,
  onClose,
  onConfirm,
}) {
  if (!pendingDecision || typeof document === 'undefined') return null;

  const { row, status } = pendingDecision;
  const isApprove = status === 'approved';

  return createPortal(
    <div className="hwr-page hwr-modal-portal-root">
      <div
        className="hwr-modal-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !decidingId) {
            onClose();
          }
        }}
      >
        <section
          className="hwr-decision-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hwr-decision-modal-title"
        >
          <div className={`hwr-modal-icon ${isApprove ? 'approve' : 'reject'}`}>
            {isApprove ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
          </div>

          <div className="hwr-modal-heading">
            <span>{isApprove ? 'Approve Request' : 'Reject Request'}</span>
            <h2 id="hwr-decision-modal-title">
              {isApprove
                ? 'Confirm holiday work approval'
                : 'Confirm holiday work rejection'}
            </h2>
            <p>
              {isApprove
                ? 'This will approve the selected holiday work request using the existing approval workflow.'
                : 'This will reject the selected holiday work request using the existing approval workflow.'}
            </p>
          </div>

          <div className="hwr-modal-summary">
            <div>
              <span>Employee</span>
              <strong>{row.employee_name || 'Employee'}</strong>
            </div>
            <div>
              <span>Date</span>
              <strong>{formatDate(row.date)}</strong>
            </div>
            <div>
              <span>Holiday</span>
              <strong>{row.holiday_title || 'Holiday'}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{statusLabel(row.status)}</strong>
            </div>
          </div>

          <div className="hwr-modal-actions">
            <button
              type="button"
              className="hwr-modal-cancel"
              onClick={onClose}
              disabled={Boolean(decidingId)}
            >
              Cancel
            </button>

            <button
              type="button"
              className={`hwr-modal-confirm ${isApprove ? 'approve' : 'reject'}`}
              onClick={onConfirm}
              disabled={Boolean(decidingId)}
            >
              {decidingId ? (
                <Loader2 size={16} className="hwr-spin" />
              ) : isApprove ? (
                <CheckCircle2 size={16} />
              ) : (
                <XCircle size={16} />
              )}
              {decidingId
                ? 'Updating...'
                : isApprove
                  ? 'Confirm Approval'
                  : 'Confirm Rejection'}
            </button>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}

const HWR_STYLES = `
@keyframes hwrSpin {
  to { transform: rotate(360deg); }
}

@keyframes hwrRefreshIdle {
  0%, 84% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes hwrSectionReveal {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes hwrSheetFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes hwrSheetSlideIn {
  from { opacity: 0; transform: translateX(34px) scale(.985); }
  to { opacity: 1; transform: translateX(0) scale(1); }
}

@keyframes hwrSheetSlideInMobile {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.hwr-page {
  --hwr-ink: #101a3a;
  --hwr-copy: #5d6d8d;
  --hwr-violet: #4d77dd;
  --hwr-violet-deep: #575092;
  --hwr-blue: #4d77dd;
  --hwr-cyan: #2eb2b9;
  --hwr-teal: #2eb2b9;
  --hwr-yellow: #d8ff43;
  --hwr-danger: #d84d68;
  --hwr-line: rgba(16, 26, 58, .14);

  display: grid;
  gap: clamp(16px, 1.8vw, 24px);
  width: 100%;
  min-width: 0;
  max-width: 100%;
  color: var(--hwr-ink);
  background: transparent;
}

.hwr-page,
.hwr-page * {
  box-sizing: border-box;
}

.hwr-page > *,
.hwr-page section,
.hwr-page article,
.hwr-page form,
.hwr-page nav,
.hwr-page aside,
.hwr-page label {
  min-width: 0;
  max-width: 100%;
}

.hwr-page h1,
.hwr-page h2,
.hwr-page h3,
.hwr-page h4,
.hwr-page p,
.hwr-page strong,
.hwr-page small,
.hwr-page span {
  overflow-wrap: anywhere;
}

.hwr-page button,
.hwr-page input,
.hwr-page select,
.hwr-page textarea {
  font: inherit;
  max-width: 100%;
}

.hwr-page button {
  min-width: 0;
  cursor: pointer;
}

.hwr-page input,
.hwr-page select,
.hwr-page textarea {
  width: 100%;
  min-width: 0;
}

.hwr-spin {
  animation: hwrSpin 1s linear infinite;
}

.hwr-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(190px, 300px);
  gap: clamp(20px, 3vw, 36px);
  align-items: center;
  min-height: 250px;
  padding: clamp(24px, 3vw, 40px);
  border: 1px solid rgba(154, 164, 205, .58);
  border-radius: clamp(28px, 2.7vw, 40px);
  background: linear-gradient(
    90deg,
    #d3f4fb 0%,
    #f7fcfb 34%,
    #fffdf8 52%,
    #fbf8fa 68%,
    #f0edfb 100%
  );
  box-shadow:
    10px 12px 0 #b9d7ff,
    0 26px 44px rgba(70, 92, 140, .12);
}

.hwr-eyebrow,
.hwr-section-kicker {
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

.hwr-eyebrow {
  margin-bottom: 15px;
  padding: 9px 13px;
  box-shadow: 4px 5px 0 #575092;
}

.hwr-section-kicker {
  margin-bottom: 10px;
  padding: 7px 10px;
  box-shadow: 3px 4px 0 #575092;
}

.hwr-hero h1 {
  max-width: 900px;
  margin: 0;
  color: var(--hwr-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(44px, 5.2vw, 77px);
  font-weight: 760;
  line-height: .94;
  letter-spacing: -.058em;
}

.hwr-hero h1 em {
  color: var(--hwr-violet);
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 500;
}

.hwr-hero p {
  max-width: 840px;
  margin: 17px 0 0;
  color: var(--hwr-copy);
  font-size: clamp(13px, 1vw, 16px);
  line-height: 1.68;
}

.hwr-hero-actions {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.hwr-action-stack {
  width: min(320px, 100%);
  display: grid;
  gap: 9px;
}

.hwr-refresh {
  min-height: 54px;
  padding: 10px 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 1px solid rgba(77, 119, 221, .18);
  border-radius: 15px;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow:
    6px 7px 0 #575092,
    0 14px 25px rgba(67, 116, 170, .12);
  font-weight: 900;
  white-space: nowrap;
  transition:
    transform 190ms ease,
    box-shadow 190ms ease,
    filter 190ms ease;
}

.hwr-refresh svg:first-child {
  animation: hwrRefreshIdle 4.2s linear infinite;
}

.hwr-refresh:disabled svg:first-child {
  animation: hwrSpin 1s linear infinite;
}

.hwr-refresh:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: saturate(1.04);
}

.hwr-refresh:disabled {
  opacity: .58;
  cursor: not-allowed;
}

.hwr-stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}

.hwr-stat-card {
  min-width: 0;
  min-height: 120px;
  padding: 18px;
  border: 1px solid rgba(171, 181, 211, .66);
  border-radius: 22px;
  background: #edf6ff;
  box-shadow:
    7px 9px 0 #b9d7ff,
    0 18px 30px rgba(34, 38, 110, .09);
  transition: transform 190ms ease;
}

.hwr-stat-card:nth-child(2) {
  background: #eaf8f4;
  box-shadow:
    7px 9px 0 #aee6d9,
    0 18px 30px rgba(34, 38, 110, .09);
}

.hwr-stat-card:nth-child(3) {
  background: #fff4d5;
  box-shadow:
    7px 9px 0 #ffe0a5,
    0 18px 30px rgba(34, 38, 110, .09);
}

.hwr-stat-card:nth-child(4) {
  background: #f1efff;
  box-shadow:
    7px 9px 0 #c9c0ff,
    0 18px 30px rgba(34, 38, 110, .09);
}

.hwr-stat-card:nth-child(5) {
  background: #fff0f2;
  box-shadow:
    7px 9px 0 #f2c2cc,
    0 18px 30px rgba(34, 38, 110, .09);
}

.hwr-stat-card:hover {
  transform: translateY(-4px);
}

.hwr-stat-card span {
  display: block;
  color: #5d6785;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.hwr-stat-card strong {
  display: block;
  margin-top: 10px;
  color: var(--hwr-ink);
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(30px, 3vw, 43px);
  line-height: 1;
}

.hwr-section-tabs-holder {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.hwr-section-tabs {
  display: grid;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border: 1px solid rgba(171, 181, 211, .62);
  border-radius: 22px;
  background: #fff;
  box-shadow:
    6px 7px 0 #c4ccff,
    0 16px 28px rgba(34, 38, 110, .08);
}

.hwr-section-tabs.is-two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.hwr-section-tabs.is-three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.hwr-section-tab {
  min-width: 0;
  min-height: 62px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 11px 14px;
  border: 1px solid rgba(77, 119, 221, .22);
  border-radius: 16px;
  color: #4767b4;
  background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
  box-shadow: 3px 4px 0 rgba(87, 80, 146, .16);
  text-align: left;
  transition:
    transform 190ms ease,
    border-color 190ms ease,
    box-shadow 190ms ease;
}

.hwr-section-tab:hover {
  transform: translateY(-2px);
  border-color: rgba(46, 178, 185, .46);
}

.hwr-section-tab.active {
  border-color: transparent;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 5px 6px 0 #575092;
}

.hwr-section-tab-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.hwr-section-tab-copy strong {
  font-size: 12px;
  font-weight: 950;
  line-height: 1.2;
}

.hwr-section-tab-copy small {
  color: currentColor;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.35;
  opacity: .78;
}

.hwr-section-tab-count {
  min-width: 28px;
  height: 28px;
  padding: 0 7px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  color: #40348d;
  background: #fff;
  box-shadow: 2px 3px 0 rgba(52, 43, 120, .10);
  font-size: 9px;
  font-weight: 950;
}

.hwr-section-content {
  width: 100%;
  min-width: 0;
  animation: hwrSectionReveal 220ms ease both;
}

.hwr-panel {
  min-width: 0;
  width: 100%;
  padding: clamp(18px, 2vw, 28px);
  overflow: hidden;
  border: 1px solid rgba(171, 181, 211, .70);
  border-radius: clamp(26px, 2.2vw, 36px);
  background: #fff;
  box-shadow:
    8px 10px 0 #c4ccff,
    0 24px 42px rgba(34, 38, 110, .10);
}

.hwr-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-width: 0;
  margin-bottom: 18px;
}

.hwr-panel-head > div {
  flex: 1 1 auto;
  min-width: 0;
}

.hwr-panel-head h2,
.hwr-panel-head h3 {
  margin: 0;
  color: var(--hwr-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(25px, 2.3vw, 37px);
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.045em;
}

.hwr-panel-head p {
  margin: 8px 0 0;
  color: var(--hwr-copy);
  font-size: 13px;
  line-height: 1.58;
}

.hwr-chip {
  padding: 8px 12px;
  border: 1px solid rgba(77, 119, 221, .20);
  border-radius: 999px;
  color: #40348d;
  background: #f1efff;
  box-shadow: 3px 4px 0 #c9c0ff;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.hwr-profile-prefill-card {
  margin-bottom: 20px;
  padding: clamp(15px, 2vw, 20px);
  border: 1px solid rgba(77, 119, 221, .18);
  border-radius: 20px;
  background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
  box-shadow: 4px 5px 0 rgba(87, 80, 146, .12);
}

.hwr-profile-prefill-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 13px;
  color: #4767b4;
  font-size: 10px;
  font-weight: 950;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.hwr-profile-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 11px;
}

.hwr-profile-grid div,
.hwr-request-grid div,
.hwr-modal-summary div {
  min-width: 0;
  padding: 13px;
  border: 1px solid rgba(162, 169, 196, .46);
  border-radius: 17px;
  background: #edf6ff;
  box-shadow: 3px 4px 0 #b9d7ff;
}

.hwr-profile-grid div:nth-child(2n),
.hwr-request-grid div:nth-child(2n),
.hwr-modal-summary div:nth-child(2n) {
  background: #eaf8f4;
  box-shadow: 3px 4px 0 #aee6d9;
}

.hwr-profile-grid div:nth-child(3n),
.hwr-request-grid div:nth-child(3n),
.hwr-modal-summary div:nth-child(3n) {
  background: #fff4d5;
  box-shadow: 3px 4px 0 #ffe0a5;
}

.hwr-profile-grid span,
.hwr-request-grid span,
.hwr-modal-summary span,
.hwr-reason-box span,
.hwr-location-box span {
  display: block;
  margin-bottom: 6px;
  color: #5d6785;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.hwr-profile-grid strong,
.hwr-request-grid strong,
.hwr-modal-summary strong {
  display: block;
  color: var(--hwr-ink);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.hwr-form {
  display: grid;
  gap: 15px;
}

.hwr-form-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.hwr-field label,
.hwr-form > label > span,
.hwr-form-row label > span {
  display: block;
  margin-bottom: 8px;
  color: #303b5b;
  font-size: 11px;
  font-weight: 900;
}

.hwr-field select,
.hwr-field input,
.hwr-field textarea,
.hwr-form > label input,
.hwr-form > label select,
.hwr-form > label textarea,
.hwr-form-row input,
.hwr-form-row select,
.hwr-form-row textarea,
.hwr-filter-bar input,
.hwr-filter-bar select,
.hwr-sheet-toolbar input,
.hwr-sheet-toolbar select {
  width: 100%;
  min-height: 49px;
  padding: 0 14px;
  border: 1px solid rgba(151, 161, 197, .58);
  border-radius: 15px;
  outline: 0;
  color: var(--hwr-ink);
  background: rgba(255, 255, 255, .96);
  font-size: 13px;
  transition:
    border-color 170ms ease,
    box-shadow 170ms ease,
    transform 170ms ease;
}

.hwr-field textarea,
.hwr-form > label textarea {
  min-height: 120px;
  padding: 14px;
  resize: vertical;
}

.hwr-field select:focus,
.hwr-field input:focus,
.hwr-field textarea:focus,
.hwr-form input:focus,
.hwr-form select:focus,
.hwr-form textarea:focus,
.hwr-filter-bar input:focus,
.hwr-filter-bar select:focus,
.hwr-sheet-toolbar input:focus,
.hwr-sheet-toolbar select:focus {
  border-color: rgba(77, 119, 221, .65);
  box-shadow:
    4px 5px 0 rgba(87, 80, 146, .14),
    0 0 0 4px rgba(77, 119, 221, .08);
  transform: translateY(-1px);
}

.hwr-selected-holiday {
  padding: 14px;
  border: 1px solid rgba(77, 119, 221, .22);
  border-radius: 18px;
  color: #40348d;
  background: linear-gradient(145deg, #f1efff, #eef9ff);
  box-shadow: 4px 5px 0 #c9c0ff;
  line-height: 1.48;
}

.hwr-selected-holiday strong {
  display: block;
  margin-bottom: 4px;
  color: #312e81;
}

.hwr-submit,
.hwr-filter-button,
.hwr-actions button,
.hwr-summary-button,
.hwr-modal-cancel,
.hwr-modal-confirm,
.hwr-page-button,
.hwr-page-number,
.hwr-sheet-close {
  font-weight: 900;
  transition:
    transform 190ms ease,
    box-shadow 190ms ease,
    filter 190ms ease,
    opacity 190ms ease;
}

.hwr-submit {
  min-height: 52px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 0;
  border-radius: 15px;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow:
    6px 7px 0 #575092,
    0 14px 25px rgba(67, 116, 170, .16);
}

.hwr-submit:hover:not(:disabled),
.hwr-filter-button:hover:not(:disabled),
.hwr-actions button:hover:not(:disabled),
.hwr-summary-button:hover:not(:disabled),
.hwr-modal-cancel:hover:not(:disabled),
.hwr-modal-confirm:hover:not(:disabled),
.hwr-page-button:hover:not(:disabled),
.hwr-page-number:hover:not(:disabled),
.hwr-sheet-close:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: saturate(1.04);
}

.hwr-submit:disabled,
.hwr-filter-button:disabled,
.hwr-actions button:disabled,
.hwr-summary-button:disabled,
.hwr-modal-cancel:disabled,
.hwr-modal-confirm:disabled,
.hwr-page-button:disabled,
.hwr-page-number:disabled {
  opacity: .58;
  cursor: not-allowed;
  transform: none;
}

.hwr-inline-feedback {
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
  box-shadow: 3px 4px 0 #c9c0ff;
  font-size: 10px;
  line-height: 1.45;
}

.hwr-inline-feedback.success {
  border-color: rgba(4, 120, 87, .18);
  color: #047857;
  background: #eaf8f4;
  box-shadow: 3px 4px 0 #aee6d9;
}

.hwr-inline-feedback.warning {
  border-color: rgba(154, 104, 23, .18);
  color: #9a6817;
  background: #fff4d5;
  box-shadow: 3px 4px 0 #ffe0a5;
}

.hwr-inline-feedback.error {
  border-color: rgba(162, 52, 77, .18);
  color: #a2344d;
  background: #fff0f2;
  box-shadow: 3px 4px 0 #f2c2cc;
}

.hwr-inline-feedback-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
}

.hwr-inline-feedback-copy {
  min-width: 0;
}

.hwr-inline-feedback-copy strong,
.hwr-inline-feedback-copy span {
  display: block;
  overflow-wrap: anywhere;
}

.hwr-inline-feedback-copy strong {
  margin-bottom: 2px;
  font-weight: 950;
}

.hwr-inline-feedback-copy span {
  font-weight: 750;
}

.hwr-inline-feedback-close {
  width: 24px;
  min-width: 24px;
  height: 24px;
  display: inline-grid;
  place-items: center;
  margin: -2px -3px -2px 0;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: currentColor;
  background: rgba(255, 255, 255, .58);
  box-shadow: none;
  font-size: 17px;
  line-height: 1;
}

.hwr-inline-feedback-close:hover {
  transform: none;
  filter: none;
  background: #fff;
}

.hwr-summary-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 18px;
  align-items: center;
  padding: clamp(18px, 2vw, 24px);
  border: 1px solid rgba(77, 119, 221, .18);
  border-radius: 22px;
  background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
  box-shadow: 5px 6px 0 rgba(87, 80, 146, .16);
}

.hwr-summary-icon {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 4px 5px 0 #575092;
}

.hwr-summary-copy span {
  display: block;
  color: #5d6785;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.hwr-summary-copy strong {
  display: block;
  margin-top: 6px;
  color: var(--hwr-ink);
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(30px, 3vw, 44px);
  line-height: 1;
}

.hwr-summary-copy p {
  margin: 9px 0 0;
  color: var(--hwr-copy);
  font-size: 12px;
  line-height: 1.55;
}

.hwr-summary-actions {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
}

.hwr-summary-button {
  min-height: 46px;
  padding: 10px 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 15px;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 6px 7px 0 #575092;
}

.hwr-filter-bar,
.hwr-sheet-toolbar {
  display: grid;
  grid-template-columns: auto minmax(135px, .9fr) minmax(155px, 1fr) minmax(200px, 1.5fr) auto;
  gap: 10px;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  margin-bottom: 18px;
  padding: 12px;
  border: 1px solid rgba(171, 181, 211, .55);
  border-radius: 18px;
  background: #f8f9ff;
  box-shadow: 3px 4px 0 rgba(52, 43, 120, .07);
}

.hwr-sheet-toolbar {
  grid-template-columns: auto minmax(150px, .8fr) minmax(220px, 1.4fr);
}

.hwr-filter-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  align-self: center;
  color: #5d6785;
  font-size: 10px;
  font-weight: 950;
  letter-spacing: .08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.hwr-search-wrap {
  position: relative;
}

.hwr-search-wrap svg {
  position: absolute;
  left: 13px;
  top: 50%;
  color: #6c7da2;
  transform: translateY(-50%);
  pointer-events: none;
}

.hwr-search-wrap input {
  padding-left: 38px;
}

.hwr-filter-button {
  min-height: 49px;
  padding: 10px 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 15px;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 5px 6px 0 #575092;
}

.hwr-request-list {
  display: grid;
  gap: 15px;
}

.hwr-request-card {
  min-width: 0;
  padding: clamp(16px, 1.8vw, 21px);
  border: 1px solid rgba(171, 181, 211, .66);
  border-radius: 21px;
  background: linear-gradient(145deg, #ffffff, #f8fbff);
  box-shadow:
    5px 6px 0 #c4ccff,
    0 17px 30px rgba(34, 38, 110, .08);
  transition:
    transform 190ms ease,
    border-color 190ms ease,
    box-shadow 190ms ease;
}

.hwr-request-card:hover {
  transform: translateY(-2px);
  border-color: rgba(77, 119, 221, .30);
  box-shadow:
    7px 8px 0 #c4ccff,
    0 21px 34px rgba(34, 38, 110, .10);
}

.hwr-request-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.hwr-request-id {
  display: inline-block;
  color: #4767b4;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .10em;
  text-transform: uppercase;
}

.hwr-request-top h3 {
  margin: 9px 0 4px;
  color: var(--hwr-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: 23px;
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.03em;
}

.hwr-request-top p {
  margin: 0;
  color: var(--hwr-copy);
  font-size: 11px;
  line-height: 1.5;
}

.hwr-status {
  display: inline-flex;
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 900;
  text-transform: capitalize;
  white-space: nowrap;
}

.hwr-status.approved {
  color: #047857;
  background: #eaf8f4;
  box-shadow: 2px 3px 0 #aee6d9;
}

.hwr-status.pending {
  color: #9a6817;
  background: #fff4d5;
  box-shadow: 2px 3px 0 #ffe0a5;
}

.hwr-status.rejected {
  color: #a2344d;
  background: #fff0f2;
  box-shadow: 2px 3px 0 #f2c2cc;
}

.hwr-request-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 15px;
}

.hwr-request-copy-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.hwr-reason-box,
.hwr-location-box {
  min-width: 0;
  padding: 13px;
  border: 1px solid rgba(162, 169, 196, .42);
  border-radius: 16px;
  background: #f8f9ff;
}

.hwr-reason-box p,
.hwr-location-box p {
  margin: 0;
  color: var(--hwr-ink);
  font-size: 11px;
  line-height: 1.55;
}

.hwr-location-box p {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.hwr-location-box p svg {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--hwr-cyan);
}

.hwr-meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 12px;
}

.hwr-meta-line span {
  padding: 6px 9px;
  border-radius: 999px;
  color: #5d6785;
  background: #eef3fb;
  font-size: 9px;
  font-weight: 800;
}

.hwr-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.hwr-actions button {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 14px;
}

.hwr-approve {
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 4px 5px 0 #575092;
}

.hwr-reject {
  color: #a2344d;
  background: #fff0f2;
  box-shadow: 4px 5px 0 #f2c2cc;
}

.hwr-empty {
  min-height: 180px;
  padding: 24px;
  display: grid;
  place-items: center;
  gap: 8px;
  border: 1px dashed rgba(77, 119, 221, .28);
  border-radius: 20px;
  color: var(--hwr-copy);
  background: #fafbff;
  text-align: center;
}

.hwr-empty svg {
  color: #6b82c5;
}

.hwr-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  min-width: 0;
  margin: 0 0 15px;
  padding: 12px 13px;
  border: 1px solid rgba(171, 181, 211, .52);
  border-radius: 16px;
  background: #f8f9ff;
  box-shadow: 3px 4px 0 rgba(52, 43, 120, .07);
}

.hwr-pagination-copy {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  color: var(--hwr-copy);
  font-size: 10px;
  font-weight: 850;
}

.hwr-pagination-copy strong {
  color: var(--hwr-ink);
  font-size: 13px;
  font-weight: 950;
}

.hwr-pagination-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
}

.hwr-page-size-control {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--hwr-copy);
  font-size: 10px;
  font-weight: 900;
  white-space: nowrap;
}

.hwr-page-size-control select {
  min-width: 108px;
  height: 38px;
  padding: 0 30px 0 10px;
  border: 1px solid rgba(77, 119, 221, .20);
  border-radius: 12px;
  color: #40348d;
  background: #f1efff;
  box-shadow: 2px 3px 0 #c9c0ff;
  font-size: 10px;
  font-weight: 900;
}

.hwr-page-button {
  min-width: 78px;
  height: 38px;
  padding: 0 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid rgba(77, 119, 221, .18);
  border-radius: 12px;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 4px 5px 0 #575092;
  font-size: 10px;
}

.hwr-page-numbers {
  display: flex;
  align-items: center;
  gap: 5px;
}

.hwr-page-number {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(77, 119, 221, .20);
  border-radius: 11px;
  color: #4767b4;
  background: #fff;
  box-shadow: 2px 3px 0 rgba(87, 80, 146, .12);
  font-size: 10px;
}

.hwr-page-number.active {
  border-color: transparent;
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 3px 4px 0 #575092;
}

.hwr-page-ellipsis {
  width: 20px;
  text-align: center;
  color: #7b88a5;
  font-weight: 900;
}

.hwr-page-indicator {
  min-width: 82px;
  color: var(--hwr-copy);
  font-size: 10px;
  font-weight: 900;
  text-align: center;
  white-space: nowrap;
}

.hwr-sheet-backdrop,
.hwr-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 980;
  padding: 18px;
  display: flex;
  justify-content: flex-end;
  background: rgba(16, 26, 58, .48);
  backdrop-filter: blur(7px);
  animation: hwrSheetFadeIn 180ms ease both;
}

.hwr-my-requests-sheet {
  width: min(980px, calc(100vw - 36px));
  height: calc(100dvh - 36px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .62);
  border-radius: 28px;
  background: #fff;
  box-shadow: 0 30px 80px rgba(16, 26, 58, .30);
  animation: hwrSheetSlideIn 260ms cubic-bezier(.22, 1, .36, 1) both;
}

.hwr-sheet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: clamp(20px, 2vw, 28px);
  border-bottom: 1px solid rgba(171, 181, 211, .45);
  background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
}

.hwr-sheet-header h2 {
  margin: 0;
  color: var(--hwr-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(28px, 3vw, 42px);
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.04em;
}

.hwr-sheet-header p {
  margin: 8px 0 0;
  color: var(--hwr-copy);
  font-size: 12px;
  line-height: 1.55;
}

.hwr-sheet-close {
  width: 42px;
  min-width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(77, 119, 221, .18);
  border-radius: 14px;
  color: #40348d;
  background: #fff;
  box-shadow: 3px 4px 0 #c9c0ff;
}

.hwr-sheet-body {
  min-height: 0;
  overflow-y: auto;
  padding: clamp(16px, 2vw, 24px);
}

.hwr-modal-backdrop {
  z-index: 990;
  align-items: center;
  justify-content: center;
}

.hwr-decision-modal {
  width: min(620px, calc(100vw - 36px));
  max-height: calc(100dvh - 36px);
  overflow-y: auto;
  padding: clamp(22px, 3vw, 32px);
  border: 1px solid rgba(255, 255, 255, .70);
  border-radius: 28px;
  background: #fff;
  box-shadow: 0 30px 80px rgba(16, 26, 58, .30);
  animation: hwrSheetSlideInMobile 230ms cubic-bezier(.22, 1, .36, 1) both;
}

.hwr-modal-icon {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  margin-bottom: 16px;
}

.hwr-modal-icon.approve {
  color: #047857;
  background: #eaf8f4;
  box-shadow: 4px 5px 0 #aee6d9;
}

.hwr-modal-icon.reject {
  color: #a2344d;
  background: #fff0f2;
  box-shadow: 4px 5px 0 #f2c2cc;
}

.hwr-modal-heading > span {
  display: inline-block;
  color: #4767b4;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .10em;
  text-transform: uppercase;
}

.hwr-modal-heading h2 {
  margin: 9px 0 0;
  color: var(--hwr-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(28px, 3vw, 40px);
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.04em;
}

.hwr-modal-heading p {
  margin: 12px 0 0;
  color: var(--hwr-copy);
  font-size: 12px;
  line-height: 1.6;
}

.hwr-modal-summary {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.hwr-modal-actions {
  margin-top: 22px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.hwr-modal-cancel,
.hwr-modal-confirm {
  min-height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 15px;
}

.hwr-modal-cancel {
  border: 1px solid rgba(77, 119, 221, .18);
  color: #40348d;
  background: #f1efff;
  box-shadow: 4px 5px 0 #c9c0ff;
}

.hwr-modal-confirm {
  border: 0;
  color: #fff;
}

.hwr-modal-confirm.approve {
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 5px 6px 0 #575092;
}

.hwr-modal-confirm.reject {
  background: linear-gradient(135deg, #d84d68 0%, #bd3d58 100%);
  box-shadow: 5px 6px 0 #f2c2cc;
}

@media (max-width: 1366px) {
  .hwr-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .hwr-section-tab {
    padding-inline: 11px;
  }

  .hwr-section-tab-copy small {
    font-size: 8px;
  }

  .hwr-filter-bar {
    grid-template-columns: auto minmax(130px, .8fr) minmax(145px, .9fr) minmax(180px, 1.2fr);
  }

  .hwr-filter-button {
    grid-column: 2 / -1;
  }
}

@media (max-width: 1024px) {
  .hwr-hero {
    grid-template-columns: 1fr;
  }

  .hwr-hero-actions {
    justify-content: flex-start;
  }

  .hwr-action-stack {
    width: min(360px, 100%);
  }

  .hwr-profile-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hwr-request-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hwr-filter-bar,
  .hwr-sheet-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hwr-filter-label {
    grid-column: 1 / -1;
  }

  .hwr-filter-button {
    grid-column: auto;
  }

  .hwr-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .hwr-pagination-controls {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .hwr-page {
    gap: 16px;
  }

  .hwr-hero {
    min-height: 0;
    padding: 20px;
    border-radius: 26px;
    box-shadow:
      6px 7px 0 #b9d7ff,
      0 18px 30px rgba(34, 38, 110, .10);
  }

  .hwr-hero h1 {
    font-size: clamp(36px, 10vw, 52px);
  }

  .hwr-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hwr-section-tabs.is-two,
  .hwr-section-tabs.is-three {
    grid-template-columns: 1fr;
  }

  .hwr-panel {
    padding: 18px;
    border-radius: 22px;
    box-shadow:
      5px 6px 0 #c4ccff,
      0 17px 28px rgba(34, 38, 110, .09);
  }

  .hwr-panel-head,
  .hwr-request-top,
  .hwr-sheet-header {
    flex-direction: column;
  }

  .hwr-chip,
  .hwr-status {
    align-self: flex-start;
  }

  .hwr-profile-grid,
  .hwr-form-row,
  .hwr-request-grid,
  .hwr-request-copy-grid,
  .hwr-modal-summary,
  .hwr-modal-actions,
  .hwr-filter-bar,
  .hwr-sheet-toolbar {
    grid-template-columns: 1fr;
  }

  .hwr-filter-label,
  .hwr-filter-button {
    grid-column: auto;
  }

  .hwr-actions {
    grid-template-columns: 1fr;
  }

  .hwr-pagination-controls {
    align-items: stretch;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hwr-page-size-control,
  .hwr-page-numbers,
  .hwr-page-indicator {
    grid-column: 1 / -1;
    justify-self: stretch;
  }

  .hwr-page-size-control {
    justify-content: space-between;
  }

  .hwr-page-size-control select {
    flex: 1 1 auto;
  }

  .hwr-page-numbers {
    justify-content: center;
    flex-wrap: wrap;
  }

  .hwr-page-indicator {
    text-align: center;
  }

  .hwr-page-button {
    width: 100%;
  }

  .hwr-sheet-backdrop {
    padding: 0;
    align-items: flex-end;
  }

  .hwr-my-requests-sheet {
    width: 100%;
    height: min(92dvh, 920px);
    border-radius: 26px 26px 0 0;
    animation: hwrSheetSlideInMobile 260ms cubic-bezier(.22, 1, .36, 1) both;
  }
}

@media (max-width: 520px) {
  .hwr-hero {
    padding: 16px;
  }

  .hwr-hero h1 {
    font-size: clamp(32px, 11vw, 44px);
  }

  .hwr-stats {
    grid-template-columns: 1fr;
  }

  .hwr-stat-card {
    min-height: 102px;
  }

  .hwr-panel {
    padding: 15px;
  }

  .hwr-section-tabs {
    padding: 9px;
    border-radius: 18px;
  }

  .hwr-section-tab {
    min-height: 58px;
    padding: 10px 11px;
  }

  .hwr-summary-card {
    grid-template-columns: 1fr;
  }

  .hwr-summary-icon {
    width: 50px;
    height: 50px;
  }

  .hwr-summary-actions,
  .hwr-summary-button,
  .hwr-submit,
  .hwr-refresh,
  .hwr-filter-button {
    width: 100%;
  }

  .hwr-request-card {
    padding: 14px;
    border-radius: 18px;
  }

  .hwr-pagination {
    padding: 10px;
  }

  .hwr-page-number {
    width: 34px;
    height: 34px;
  }

  .hwr-decision-modal {
    width: calc(100vw - 24px);
    padding: 18px;
    border-radius: 22px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hwr-page *,
  .hwr-page *::before,
  .hwr-page *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;

export default function HolidayWorkRequests({ user }) {
  const userRoles = useMemo(() => normalizeRoles(user), [user]);
  const canManage = userRoles.some((role) => MANAGER_ROLES.has(role));
  const employeeProfile = useMemo(() => getEmployeeProfile(user), [user]);

  const [holidayOptions, setHolidayOptions] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loadingPage, setLoadingPage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [decidingId, setDecidingId] = useState('');

  const [activeSection, setActiveSection] = useState('raise');
  const [inlineFeedback, setInlineFeedback] = useState({});
  const feedbackTimersRef = useRef({});

  const [showMyRequestsSheet, setShowMyRequestsSheet] = useState(false);
  const [pendingDecision, setPendingDecision] = useState(null);

  const [mySearch, setMySearch] = useState('');
  const [myStatus, setMyStatus] = useState('');
  const [myPage, setMyPage] = useState(1);
  const [myPageSize, setMyPageSize] = useState(10);

  const [approvalSearch, setApprovalSearch] = useState('');
  const [approvalPage, setApprovalPage] = useState(1);
  const [approvalPageSize, setApprovalPageSize] = useState(10);

  const [form, setForm] = useState({
    date: '',
    reason: '',
    work_location: '',
  });

  const [filters, setFilters] = useState({
    status: 'pending',
    date: '',
  });

  const selectedHoliday = holidayOptions.find((item) => item.date === form.date);

  const myStats = useMemo(() => {
    const rows = myRequests || [];

    return {
      total: rows.length,
      pending: rows.filter((item) => String(item.status || '').toLowerCase() === 'pending').length,
      approved: rows.filter((item) => String(item.status || '').toLowerCase() === 'approved').length,
      rejected: rows.filter((item) => String(item.status || '').toLowerCase() === 'rejected').length,
    };
  }, [myRequests]);

  const filteredMyRequests = useMemo(
    () =>
      (myRequests || []).filter((row) => {
        if (
          myStatus &&
          String(row.status || '').toLowerCase() !== myStatus
        ) {
          return false;
        }

        return requestMatchesSearch(row, mySearch);
      }),
    [myRequests, mySearch, myStatus],
  );

  const filteredApprovalRequests = useMemo(
    () => (requests || []).filter((row) => requestMatchesSearch(row, approvalSearch)),
    [requests, approvalSearch],
  );

  const myPageCount = pageCountFor(filteredMyRequests, myPageSize);
  const approvalPageCount = pageCountFor(filteredApprovalRequests, approvalPageSize);

  const pagedMyRequests = useMemo(
    () =>
      paginateRows(
        filteredMyRequests,
        Math.min(myPage, myPageCount),
        myPageSize,
      ),
    [filteredMyRequests, myPage, myPageCount, myPageSize],
  );

  const pagedApprovalRequests = useMemo(
    () =>
      paginateRows(
        filteredApprovalRequests,
        Math.min(approvalPage, approvalPageCount),
        approvalPageSize,
      ),
    [
      filteredApprovalRequests,
      approvalPage,
      approvalPageCount,
      approvalPageSize,
    ],
  );

  function clearInlineFeedback(scope) {
    if (!scope) return;

    const timer = feedbackTimersRef.current[scope];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scope];
    }

    setInlineFeedback((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scope)) {
        return current;
      }

      const next = { ...current };
      delete next[scope];
      return next;
    });
  }

  function showInlineFeedback(
    scope,
    type,
    message,
    title = '',
    options = {},
  ) {
    if (!scope) return;

    const timer = feedbackTimersRef.current[scope];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scope];
    }

    setInlineFeedback((current) => ({
      ...current,
      [scope]: {
        type,
        message,
        title,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      feedbackTimersRef.current[scope] = window.setTimeout(() => {
        setInlineFeedback((current) => {
          const next = { ...current };
          delete next[scope];
          return next;
        });

        delete feedbackTimersRef.current[scope];
      }, HWR_NOTICE_HIDE_MS);
    }
  }

  function changeSection(section) {
    setShowMyRequestsSheet(false);
    setPendingDecision(null);
    setActiveSection(section);
  }

  async function loadHolidayOptions() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dateFrom = toIsoDate(today);
    const dateTo = toIsoDate(addDays(today, 90));

    let manualHolidays = [];

    try {
      const data = await api(`/attendance/holidays${buildQuery({
        date_from: dateFrom,
        date_to: dateTo,
      })}`);

      manualHolidays = data.items || [];
    } catch (error) {
      console.warn(
        'Unable to load manual holidays. Weekly holidays will still show.',
        error,
      );
    }

    const options = uniqueHolidayOptions(manualHolidays);
    setHolidayOptions(options);

    if (!form.date && options.length) {
      setForm((prev) => ({
        ...prev,
        date: options[0].date,
      }));
    }
  }

  async function loadMyRequests() {
    const data = await getMyHolidayWorkRequests();
    setMyRequests(data.items || []);
  }

  async function loadRequests(nextFilters = filters) {
    if (!canManage) {
      setRequests([]);
      return;
    }

    const payload = {};

    if (nextFilters.status) payload.status = nextFilters.status;
    if (nextFilters.date) payload.date = nextFilters.date;

    const data = await getHolidayWorkRequests(payload);
    setRequests(data.items || []);
  }

  async function refreshPage({ feedbackScope = '' } = {}) {
    try {
      if (feedbackScope) {
        showInlineFeedback(
          feedbackScope,
          'info',
          'Refreshing holiday work requests and holiday options...',
          'Refreshing',
          { loading: true },
        );
      }

      setLoadingPage(true);

      await Promise.all([
        loadHolidayOptions(),
        loadMyRequests(),
        canManage ? loadRequests(filters) : Promise.resolve(),
      ]);

      if (feedbackScope) {
        showInlineFeedback(
          feedbackScope,
          'success',
          'Holiday work data is up to date.',
          'Refresh Complete',
        );
      }
    } catch (error) {
      if (feedbackScope) {
        showInlineFeedback(
          feedbackScope,
          'error',
          error.message || 'Unable to load holiday work requests',
          'Refresh Failed',
        );
      } else {
        showInlineFeedback(
          'page',
          'error',
          error.message || 'Unable to load holiday work requests',
          'Holiday Work',
        );
      }
    } finally {
      setLoadingPage(false);
    }
  }

  useEffect(() => {
    refreshPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMyPage((current) => Math.min(current, myPageCount));
  }, [myPageCount]);

  useEffect(() => {
    setApprovalPage((current) => Math.min(current, approvalPageCount));
  }, [approvalPageCount]);

  useEffect(() => {
    setMyPage(1);
  }, [mySearch, myStatus]);

  useEffect(() => {
    setApprovalPage(1);
  }, [approvalSearch]);

  useEffect(() => {
    if (!canManage && activeSection === 'approvals') {
      setActiveSection('raise');
    }
  }, [activeSection, canManage]);

  useEffect(() => {
    if (
      (!showMyRequestsSheet && !pendingDecision) ||
      typeof document === 'undefined'
    ) {
      return undefined;
    }

    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousRootOverscroll = root.style.overscrollBehavior;

    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    root.style.overscrollBehavior = 'none';

    const blockBackgroundScroll = (event) => {
      const interactiveSurface = event.target?.closest?.(
        '.hwr-my-requests-sheet, .hwr-decision-modal',
      );

      if (interactiveSurface) return;
      event.preventDefault();
    };

    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;

      if (pendingDecision && !decidingId) {
        setPendingDecision(null);
        return;
      }

      if (showMyRequestsSheet) {
        setShowMyRequestsSheet(false);
      }
    };

    document.addEventListener('wheel', blockBackgroundScroll, {
      passive: false,
    });
    document.addEventListener('touchmove', blockBackgroundScroll, {
      passive: false,
    });
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('wheel', blockBackgroundScroll);
      document.removeEventListener('touchmove', blockBackgroundScroll);
      window.removeEventListener('keydown', closeOnEscape);

      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      root.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [
    showMyRequestsSheet,
    pendingDecision,
    decidingId,
  ]);

  useEffect(() => {
    function dismissInlineFeedback(event) {
      if (event.target?.closest?.('.hwr-inline-feedback')) return;

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

  async function submitRequest(event) {
    event.preventDefault();

    if (!form.date) {
      showInlineFeedback(
        'create',
        'warning',
        'Please select a holiday date.',
        'Holiday Required',
      );
      return;
    }

    if (!form.reason.trim()) {
      showInlineFeedback(
        'create',
        'warning',
        'Reason is required.',
        'Reason Required',
      );
      return;
    }

    try {
      showInlineFeedback(
        'create',
        'info',
        'Submitting your holiday work request...',
        'Submitting',
        { loading: true },
      );

      setSubmitting(true);

      const holiday = holidayOptions.find((item) => item.date === form.date);

      const data = await createHolidayWorkRequest({
        date: form.date,
        reason: form.reason.trim(),
        work_location: form.work_location.trim(),
        holiday_title: holiday?.title || '',
        holiday_type: holiday?.holiday_type || '',
      });

      showInlineFeedback(
        'create',
        'success',
        data.message || 'Holiday work request submitted.',
        'Request Submitted',
      );

      setForm((prev) => ({
        ...prev,
        reason: '',
        work_location: '',
      }));

      await Promise.all([
        loadMyRequests(),
        canManage ? loadRequests(filters) : Promise.resolve(),
      ]);
    } catch (error) {
      showInlineFeedback(
        'create',
        'error',
        error.message || 'Unable to submit holiday work request.',
        'Submission Failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFilterSubmit(event) {
    event.preventDefault();

    try {
      showInlineFeedback(
        'approval-filter',
        'info',
        'Loading requests with the selected filters...',
        'Applying Filters',
        { loading: true },
      );

      setApprovalPage(1);
      await loadRequests(filters);

      showInlineFeedback(
        'approval-filter',
        'success',
        'Approval requests updated.',
        'Filters Applied',
      );
    } catch (error) {
      showInlineFeedback(
        'approval-filter',
        'error',
        error.message || 'Unable to load approval requests.',
        'Filter Failed',
      );
    }
  }

  function handleDecision(row, status) {
    setPendingDecision({ row, status });
  }

  async function confirmDecision() {
    if (!pendingDecision?.row?._id || !pendingDecision?.status) return;

    const { row, status } = pendingDecision;

    try {
      setDecidingId(row._id);

      const data = await decideHolidayWorkRequest(row._id, { status });

      showInlineFeedback(
        'approval-action',
        'success',
        data.message || `Request ${status}.`,
        status === 'approved' ? 'Request Approved' : 'Request Rejected',
      );

      await Promise.all([
        loadRequests(filters),
        loadMyRequests(),
      ]);

      setPendingDecision(null);
    } catch (error) {
      showInlineFeedback(
        'approval-action',
        'error',
        error.message || 'Unable to update request.',
        'Update Failed',
      );
    } finally {
      setDecidingId('');
    }
  }

  const sectionTabsElement = (
    <nav
      className={`hwr-section-tabs ${canManage ? 'is-three' : 'is-two'}`}
      aria-label="Holiday work request sections"
    >
      <button
        type="button"
        className={`hwr-section-tab ${activeSection === 'raise' ? 'active' : ''}`}
        onClick={() => changeSection('raise')}
        aria-pressed={activeSection === 'raise'}
      >
        <PlusCircle size={18} />
        <span className="hwr-section-tab-copy">
          <strong>New Request</strong>
          <small>Submit holiday work for an upcoming holiday</small>
        </span>
      </button>

      <button
        type="button"
        className={`hwr-section-tab ${activeSection === 'my' ? 'active' : ''}`}
        onClick={() => changeSection('my')}
        aria-pressed={activeSection === 'my'}
      >
        <Inbox size={18} />
        <span className="hwr-section-tab-copy">
          <strong>My Requests</strong>
          <small>Track submitted requests and approval status</small>
        </span>
        <span className="hwr-section-tab-count">{myRequests.length}</span>
      </button>

      {canManage ? (
        <button
          type="button"
          className={`hwr-section-tab ${activeSection === 'approvals' ? 'active' : ''}`}
          onClick={() => changeSection('approvals')}
          aria-pressed={activeSection === 'approvals'}
        >
          <ListChecks size={18} />
          <span className="hwr-section-tab-copy">
            <strong>Approval Queue</strong>
            <small>Review and decide employee holiday work requests</small>
          </span>
          <span className="hwr-section-tab-count">{requests.length}</span>
        </button>
      ) : null}
    </nav>
  );

  return (
    <div className="hwr-page">
      <style>{HWR_STYLES}</style>

      <section className="hwr-hero">
        <div>
          <span className="hwr-eyebrow">
            <Sparkles size={13} />
            Holiday Work
          </span>

          <h1>
            Holiday work, <em>clearly managed.</em>
          </h1>

          <p>
            Apply using upcoming holidays only. Your employee profile, Team
            Leader and Reporting Officer details remain auto-filled, while
            approvals and status stay connected in one YourComate workspace.
          </p>
        </div>

        <div className="hwr-hero-actions">
          <div className="hwr-action-stack">
            <button
              type="button"
              className="hwr-refresh"
              disabled={loadingPage}
              onClick={() => refreshPage({ feedbackScope: 'refresh' })}
            >
              <RefreshCcw size={16} />
              {loadingPage ? 'Refreshing...' : 'Refresh'}
              <ArrowUpRight size={15} />
            </button>

            <HolidayWorkInlineMessage
              feedback={inlineFeedback.refresh}
              onClose={() => clearInlineFeedback('refresh')}
            />
          </div>
        </div>
      </section>

      <HolidayWorkInlineMessage
        feedback={inlineFeedback.page}
        onClose={() => clearInlineFeedback('page')}
      />

      <section className="hwr-stats">
        <div className="hwr-stat-card">
          <span>My Requests</span>
          <strong>{myStats.total}</strong>
        </div>

        <div className="hwr-stat-card">
          <span>Pending</span>
          <strong>{myStats.pending}</strong>
        </div>

        <div className="hwr-stat-card">
          <span>Approved</span>
          <strong>{myStats.approved}</strong>
        </div>

        <div className="hwr-stat-card">
          <span>Rejected</span>
          <strong>{myStats.rejected}</strong>
        </div>

        {canManage ? (
          <div className="hwr-stat-card">
            <span>Approval Queue</span>
            <strong>{requests.length}</strong>
          </div>
        ) : (
          <div className="hwr-stat-card">
            <span>Upcoming Holidays</span>
            <strong>{holidayOptions.length}</strong>
          </div>
        )}
      </section>

      <div className="hwr-section-tabs-holder">
        {sectionTabsElement}
      </div>

      {activeSection === 'raise' ? (
        <section className="hwr-section-content hwr-panel">
          <div className="hwr-panel-head">
            <div>
              <span className="hwr-section-kicker">
                <CalendarDays size={12} />
                New Request
              </span>
              <h2>Request Holiday Work</h2>
              <p>
                Select an upcoming holiday and submit a short reason. Employee
                and reporting details remain pre-filled automatically.
              </p>
            </div>

            <span className="hwr-chip">Auto-filled</span>
          </div>

          <div className="hwr-profile-prefill-card">
            <div className="hwr-profile-prefill-title">
              <UserCheck size={18} />
              <span>Prefilled Employee Details</span>
            </div>

            <div className="hwr-profile-grid">
              <div>
                <span>Employee</span>
                <strong>{employeeProfile.employee_name || '—'}</strong>
              </div>

              <div>
                <span>Employee Code</span>
                <strong>{employeeProfile.employee_code || '—'}</strong>
              </div>

              <div>
                <span>Department</span>
                <strong>{employeeProfile.department || '—'}</strong>
              </div>

              <div>
                <span>Designation</span>
                <strong>{employeeProfile.designation || '—'}</strong>
              </div>

              <div>
                <span>Team Leader</span>
                <strong>{employeeProfile.team_leader_name || '—'}</strong>
              </div>

              <div>
                <span>Reporting Officer</span>
                <strong>{employeeProfile.reporting_officer_name || '—'}</strong>
              </div>
            </div>
          </div>

          <form className="hwr-form" onSubmit={submitRequest}>
            <div className="hwr-form-row">
              <div className="hwr-field">
                <label>Upcoming Holiday</label>
                <select
                  value={form.date}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      date: event.target.value,
                    }))
                  }
                >
                  {holidayOptions.length ? (
                    holidayOptions.map((holiday) => (
                      <option
                        key={`${holiday.date}-${holiday.title}`}
                        value={holiday.date}
                      >
                        {formatDate(holiday.date)} — {holiday.title}
                      </option>
                    ))
                  ) : (
                    <option value="">No upcoming holidays found</option>
                  )}
                </select>
              </div>

              <div className="hwr-field">
                <label>Work Location</label>
                <input
                  type="text"
                  value={form.work_location}
                  placeholder="Example: Office, project site, field visit location"
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      work_location: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            {selectedHoliday ? (
              <div className="hwr-selected-holiday">
                <strong>{selectedHoliday.title}</strong>
                {formatDate(selectedHoliday.date)} •{' '}
                {selectedHoliday.holiday_type || 'Holiday'}
                {selectedHoliday.message
                  ? ` • ${selectedHoliday.message}`
                  : ''}
              </div>
            ) : null}

            <div className="hwr-field">
              <label>Reason</label>
              <textarea
                value={form.reason}
                placeholder="Explain why you need to work on this holiday"
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    reason: event.target.value,
                  }))
                }
              />
            </div>

            <div className="hwr-action-stack">
              <button
                type="submit"
                className="hwr-submit"
                disabled={submitting || !holidayOptions.length}
              >
                {submitting ? (
                  <Loader2 size={16} className="hwr-spin" />
                ) : (
                  <Send size={16} />
                )}
                {submitting
                  ? 'Submitting...'
                  : 'Submit Holiday Work Request'}
              </button>

              <HolidayWorkInlineMessage
                feedback={inlineFeedback.create}
                onClose={() => clearInlineFeedback('create')}
              />
            </div>
          </form>
        </section>
      ) : null}

      {activeSection === 'my' ? (
        <section className="hwr-section-content hwr-panel">
          <div className="hwr-panel-head">
            <div>
              <span className="hwr-section-kicker">
                <Clock3 size={12} />
                Request History
              </span>
              <h2>My Holiday Work Requests</h2>
              <p>
                Keep the main page clean and open your request history in a
                focused side panel with search, status filters and pagination.
              </p>
            </div>

            <span className="hwr-chip">{myRequests.length} Records</span>
          </div>

          <div className="hwr-summary-card">
            <div className="hwr-summary-icon">
              <CalendarDays size={26} />
            </div>

            <div className="hwr-summary-copy">
              <span>Total Requests Raised</span>
              <strong>{myRequests.length}</strong>
              <p>
                {myStats.pending > 0
                  ? `${myStats.pending} request${myStats.pending > 1 ? 's' : ''} currently waiting for approval.`
                  : 'Track every submitted request, approval stage and final status.'}
              </p>
            </div>
          </div>

          <div className="hwr-summary-actions">
            <button
              type="button"
              className="hwr-summary-button"
              onClick={() => setShowMyRequestsSheet(true)}
            >
              <Inbox size={17} />
              View My Requests
            </button>
          </div>
        </section>
      ) : null}

      {activeSection === 'approvals' && canManage ? (
        <section className="hwr-section-content hwr-panel">
          <div className="hwr-panel-head">
            <div>
              <span className="hwr-section-kicker">
                <ShieldCheck size={12} />
                Approval Queue
              </span>
              <h2>Requests & Approvals</h2>
              <p>
                Review employee holiday work requests using server-side status
                and date filters, plus local search and pagination.
              </p>
            </div>

            <span className="hwr-chip">{requests.length} Records</span>
          </div>

          <form className="hwr-filter-bar" onSubmit={handleFilterSubmit}>
            <div className="hwr-filter-label">
              <Filter size={16} />
              <span>Filters</span>
            </div>

            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  status: event.target.value,
                }))
              }
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={filters.date}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  date: event.target.value,
                }))
              }
            />

            <div className="hwr-search-wrap">
              <Search size={15} />
              <input
                type="search"
                value={approvalSearch}
                onChange={(event) => setApprovalSearch(event.target.value)}
                placeholder="Search employee, holiday, reason..."
                aria-label="Search approval requests"
              />
            </div>

            <button type="submit" className="hwr-filter-button">
              <Search size={15} />
              Apply
            </button>
          </form>

          <HolidayWorkInlineMessage
            feedback={inlineFeedback['approval-filter']}
            onClose={() => clearInlineFeedback('approval-filter')}
          />

          <HolidayWorkInlineMessage
            feedback={inlineFeedback['approval-action']}
            onClose={() => clearInlineFeedback('approval-action')}
            className="hwr-approval-action-feedback"
          />

          {filteredApprovalRequests.length ? (
            <>
              <HolidayWorkPagination
                total={filteredApprovalRequests.length}
                page={Math.min(approvalPage, approvalPageCount)}
                pageSize={approvalPageSize}
                onPageChange={setApprovalPage}
                onPageSizeChange={(value) => {
                  setApprovalPage(1);
                  setApprovalPageSize(value);
                }}
                label="approval requests"
              />

              <div className="hwr-request-list">
                {pagedApprovalRequests.map((row) => (
                  <RequestCard
                    key={row._id}
                    row={row}
                    canManage={canManage}
                    decidingId={decidingId}
                    onDecision={handleDecision}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="hwr-empty">
              <ListChecks size={30} />
              <p>
                {loadingPage
                  ? 'Loading approval requests...'
                  : 'No holiday work requests found for the selected filters.'}
              </p>
            </div>
          )}
        </section>
      ) : null}

      {showMyRequestsSheet && typeof document !== 'undefined'
        ? createPortal(
            <div className="hwr-page hwr-sheet-portal-root">
              <div
                className="hwr-sheet-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    setShowMyRequestsSheet(false);
                  }
                }}
              >
                <section
                  className="hwr-my-requests-sheet"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="hwr-my-requests-title"
                >
                  <div className="hwr-sheet-header">
                    <div>
                      <h2 id="hwr-my-requests-title">My Holiday Work Requests</h2>
                      <p>
                        Search, filter and review your submitted holiday work
                        requests without leaving the current HRMS page.
                      </p>
                    </div>

                    <button
                      type="button"
                      className="hwr-sheet-close"
                      onClick={() => setShowMyRequestsSheet(false)}
                      aria-label="Close my holiday work requests"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="hwr-sheet-body">
                    <div className="hwr-sheet-toolbar">
                      <div className="hwr-filter-label">
                        <Filter size={16} />
                        <span>View</span>
                      </div>

                      <select
                        value={myStatus}
                        onChange={(event) => setMyStatus(event.target.value)}
                        aria-label="Filter my requests by status"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option
                            key={option.value || 'all'}
                            value={option.value}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <div className="hwr-search-wrap">
                        <Search size={15} />
                        <input
                          type="search"
                          value={mySearch}
                          onChange={(event) => setMySearch(event.target.value)}
                          placeholder="Search request, holiday, reason..."
                          aria-label="Search my holiday work requests"
                        />
                      </div>
                    </div>

                    {filteredMyRequests.length ? (
                      <>
                        <HolidayWorkPagination
                          total={filteredMyRequests.length}
                          page={Math.min(myPage, myPageCount)}
                          pageSize={myPageSize}
                          onPageChange={setMyPage}
                          onPageSizeChange={(value) => {
                            setMyPage(1);
                            setMyPageSize(value);
                          }}
                          label="requests"
                        />

                        <div className="hwr-request-list">
                          {pagedMyRequests.map((row) => (
                            <RequestCard
                              key={row._id}
                              row={row}
                              canManage={false}
                              decidingId=""
                              onDecision={() => {}}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="hwr-empty">
                        <Inbox size={30} />
                        <p>
                          {loadingPage
                            ? 'Loading requests...'
                            : 'No holiday work requests match the selected filters.'}
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>,
            document.body,
          )
        : null}

      <HolidayWorkDecisionModal
        pendingDecision={pendingDecision}
        decidingId={decidingId}
        onClose={() => {
          if (!decidingId) {
            setPendingDecision(null);
          }
        }}
        onConfirm={confirmDecision}
      />
    </div>
  );
}
