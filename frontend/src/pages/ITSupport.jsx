import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  ClipboardCheck,
  Filter,
  Headphones,
  Laptop,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Star,
  UserCheck,
  Users,
  Wrench,
} from 'lucide-react';

import {
  api,
  assignItSupportTicket,
  createItSupportTicket,
  escalateItSupportTicket,
  getItSupportOptions,
  getItSupportProfile,
  getItSupportTickets,
  getMyItSupportTickets,
  reopenItSupportTicket,
  reviewItSupportTicket,
  updateItSupportTicketStatus,
} from '../api/client';

import {
  IT_SUPPORT_CATEGORY_OPTIONS,
  IT_SUPPORT_PRIORITY_OPTIONS,
  IT_SUPPORT_STATUS_OPTIONS,
} from '../data/modules';

const DEFAULT_ESCALATION_TYPES = [
  { value: 'software_application', label: 'Software / Application Problem' },
  { value: 'server_issue', label: 'Server Issue' },
  { value: 'database_issue', label: 'Database Issue' },
  { value: 'network_infrastructure', label: 'Network / Infrastructure Major Issue' },
  { value: 'security_issue', label: 'Security Issue' },
  { value: 'major_problem', label: 'Other Major Problem' },
];

const IT_SUPPORT_NOTICE_HIDE_MS = 3600;
const IT_SUPPORT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const accountAccessCategories = [
  { value: 'forgot_password', label: 'Forgot password' },
  { value: 'account_locked', label: 'Account locked' },
  { value: 'cannot_login', label: 'Cannot log in' },
  { value: 'email_or_code_issue', label: 'Email or employee code issue' },
  { value: 'otp_or_verification', label: 'OTP or verification issue' },
  { value: 'other', label: 'Other account-access issue' },
];

const emptyTicketForm = {
  issue_category: 'login_password',
  priority: 'medium',
  subject: '',
  description: '',
};

const emptyAssignForm = {
  assigned_to_employee_id: '',
  note: '',
};

const emptyStatusForm = {
  status: 'in_progress',
  status_note: '',
  resolution_note: '',
};

const emptyReviewForm = {
  rating: 5,
  comment: '',
};

const emptyReopenForm = {
  reason: '',
};

const emptyEscalationForm = {
  escalation_type: 'software_application',
  escalation_reason: '',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function formatDate(value) {
  if (!value) return '—';

  try {
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function statusClass(status = '') {
  const key = String(status || '').toLowerCase();

  if (key === 'resolved' || key === 'closed') return 'success';
  if (key === 'waiting_for_user') return 'warning';
  if (key === 'assigned' || key === 'in_progress') return 'info';
  if (key === 'reopened') return 'danger';

  return 'muted';
}

function priorityClass(priority = '') {
  const key = String(priority || '').toLowerCase();

  if (key === 'critical') return 'danger';
  if (key === 'high') return 'warning';
  if (key === 'medium') return 'info';

  return 'muted';
}

function accountAccessManager(profile = {}, permissions = {}) {
  const rawRoles = [
    profile.role,
    ...(Array.isArray(profile.roles) ? profile.roles : []),
    ...(Array.isArray(profile.user_roles) ? profile.user_roles : []),
  ];
  const roles = rawRoles.map((role) => String(role || '').toLowerCase().replaceAll('-', '_').replaceAll(' ', '_'));

  return Boolean(
    permissions.is_it_head ||
    permissions.is_it_member ||
    permissions.can_manage ||
    permissions.can_manage_normal ||
    roles.some((role) => ['super_admin', 'admin', 'hr', 'hr_admin', 'hr_manager', 'it_head', 'it_support_head'].includes(role))
  );
}

function accountAccessStatusLabel(value = '') {
  return optionLabel([], value || 'open');
}

function optionLabel(options = [], value = '') {
  const found = options.find((item) => item.value === value);

  if (found) return found.label;

  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || '—';
}

function profileRows(profile = {}) {
  return [
    ['Employee Name', profile.name],
    ['Employee Code', profile.emp_code],
    ['Department', profile.department],
    ['Designation', profile.designation],
    ['Email', profile.email],
    ['Phone', profile.phone],
  ];
}

function ticketId(ticket = {}) {
  return ticket._id || ticket.id || '';
}

function uniqueTickets(tickets = []) {
  const map = new Map();

  tickets.forEach((ticket) => {
    const id = ticketId(ticket) || ticket.ticket_no || JSON.stringify(ticket);

    if (!map.has(id)) {
      map.set(id, ticket);
    }
  });

  return Array.from(map.values());
}

function isOwnerTicket(ticket = {}, profile = {}) {
  const profileEmployeeId = String(profile.employee_id || '');
  const profileUserId = String(profile.user_id || '');

  return (
    String(ticket.created_by_employee_id || ticket.raised_by_employee_id || '') === profileEmployeeId ||
    String(ticket.created_by_user_id || ticket.raised_by_user_id || '') === profileUserId
  );
}

function canReviewTicket(ticket = {}, profile = {}) {
  const status = String(ticket.status || '').toLowerCase();

  return (
    isOwnerTicket(ticket, profile) &&
    ['resolved', 'closed'].includes(status) &&
    !ticket.review_rating
  );
}

function canReopenTicket(ticket = {}, profile = {}, manageAccess = false) {
  const status = String(ticket.status || '').toLowerCase();

  return (
    ['resolved', 'closed'].includes(status) &&
    (manageAccess || isOwnerTicket(ticket, profile))
  );
}

function canUpdateWorkStatus(ticket = {}, profile = {}, manageAccess = false, workAccess = false, superAdminAccess = false) {
  if (manageAccess || superAdminAccess) return true;

  const profileEmployeeId = String(profile.employee_id || '');
  const profileUserId = String(profile.user_id || '');

  return (
    workAccess &&
    (
      String(ticket.assigned_to_employee_id || '') === profileEmployeeId ||
      String(ticket.assigned_to_user_id || '') === profileUserId
    )
  );
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

function ITSupportInlineMessage({ feedback, onClose, className = '' }) {
  if (!feedback?.message) return null;

  return (
    <div
      className={`it-inline-feedback ${feedback.type || 'info'} ${className}`.trim()}
      role="status"
    >
      <span className="it-inline-feedback-icon">
        {feedback.loading ? (
          <Loader2 size={15} className="spin" />
        ) : feedback.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : feedback.type === 'error' || feedback.type === 'warning' ? (
          <ShieldAlert size={15} />
        ) : (
          <Headphones size={15} />
        )}
      </span>

      <span className="it-inline-feedback-copy">
        {feedback.title ? <strong>{feedback.title}</strong> : null}
        <span>{feedback.message}</span>
      </span>

      <button
        type="button"
        className="it-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function ITPagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label = 'tickets',
}) {
  const pageCount = pageSize === 'all'
    ? 1
    : Math.max(1, Math.ceil(Number(total || 0) / Number(pageSize || 10)));

  if (!total) return null;

  return (
    <div className="it-pagination">
      <div className="it-pagination-copy">
        <strong>{Number(total || 0).toLocaleString('en-IN')}</strong>
        <span>{label}</span>
      </div>

      <div className="it-pagination-controls">
        <label className="it-page-size-control">
          <span>View</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(event.target.value === 'all' ? 'all' : Number(event.target.value))}
            aria-label={`Number of ${label} to show`}
          >
            <option value="all">View All</option>
            {IT_SUPPORT_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="it-page-button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || pageSize === 'all'}
        >
          Previous
        </button>

        <span className="it-page-indicator">
          Page {Math.min(page, pageCount)} of {pageCount}
        </span>

        <button
          type="button"
          className="it-page-button"
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount || pageSize === 'all'}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function StarRating({ value, onChange }) {
  return (
    <div className="rating-picker">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button
          key={rating}
          type="button"
          className={Number(value) >= rating ? 'active' : ''}
          onClick={() => onChange(rating)}
          aria-label={`${rating} star`}
        >
          <Star size={20} />
        </button>
      ))}
    </div>
  );
}


const IT_SUPPORT_SHEET_STYLES = `
@keyframes itSheetFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes itSheetSlideIn {
  from { opacity: 0; transform: translateX(34px) scale(.985); }
  to { opacity: 1; transform: translateX(0) scale(1); }
}

@keyframes itSheetSlideInMobile {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes itIconFloat {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-3px) rotate(-3deg); }
}

@keyframes itRefreshIdle {
  0%, 84% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.it-support-page {
  --it-ink: #101a3a;
  --it-copy: #5d6d8d;
  --it-violet: #4d77dd;
  --it-violet-deep: #575092;
  --it-blue: #4d77dd;
  --it-cyan: #2eb2b9;
  --it-teal: #2eb2b9;
  --it-yellow: #d8ff43;
  --it-danger: #d84d68;
  --it-line: rgba(16, 26, 58, .14);
  display: grid !important;
  gap: clamp(16px, 1.8vw, 24px) !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  padding-right: clamp(8px, 1vw, 14px) !important;
  overflow-x: visible !important;
  color: var(--it-ink);
  background: transparent !important;
  background-image: none !important;
}

.it-support-page,
.it-support-page * {
  box-sizing: border-box;
}

.it-support-page > *,
.it-support-page section,
.it-support-page article,
.it-support-page form,
.it-support-page nav,
.it-support-page aside,
.it-support-page label,
.it-support-page .ticket-list,
.it-support-page .account-access-list,
.it-support-page .it-action-stack,
.it-support-page .it-filter-action-stack,
.it-support-page .it-account-action-stack {
  min-width: 0 !important;
  max-width: 100%;
}

.it-support-page > *,
.it-support-page .panel,
.it-support-page .grievance-hero,
.it-support-page .grievance-stats,
.it-support-page .it-section-tabs,
.it-support-page .it-section-content {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
}

.it-support-page h1,
.it-support-page h2,
.it-support-page h3,
.it-support-page h4,
.it-support-page p,
.it-support-page strong,
.it-support-page small,
.it-support-page span,
.it-support-page dd {
  overflow-wrap: anywhere;
}

.it-support-page svg {
  flex: 0 0 auto;
}

.it-support-page::before,
.it-support-page::after,
.it-support-page .grievance-hero::before,
.it-support-page .grievance-hero::after,
.it-support-page .panel::before,
.it-support-page .panel::after,
.it-support-page .mini-stat-card::before,
.it-support-page .mini-stat-card::after,
.it-support-page .profile-prefill-card::before,
.it-support-page .profile-prefill-card::after,
.it-support-page .it-my-ticket-summary-card::before,
.it-support-page .it-my-ticket-summary-card::after,
.it-support-page .it-team-strip::before,
.it-support-page .it-team-strip::after,
.it-support-page .filter-bar::before,
.it-support-page .filter-bar::after,
.it-support-page .account-access-toolbar::before,
.it-support-page .account-access-toolbar::after,
.it-support-page .ticket-card::before,
.it-support-page .ticket-card::after,
.it-support-page .account-access-ticket::before,
.it-support-page .account-access-ticket::after,
.it-support-page .it-context-panel::before,
.it-support-page .it-context-panel::after,
.it-support-page .account-access-editor::before,
.it-support-page .account-access-editor::after,
.it-support-page .it-section-tabs::before,
.it-support-page .it-section-tabs::after,
.it-support-page .it-pagination::before,
.it-support-page .it-pagination::after {
  content: none !important;
  display: none !important;
  background: none !important;
  background-image: none !important;
}

.it-support-page input,
.it-support-page select,
.it-support-page textarea,
.it-support-page button {
  font: inherit;
  max-width: 100%;
}

.it-support-page input,
.it-support-page select,
.it-support-page textarea {
  width: 100%;
  min-width: 0 !important;
}

.it-support-page button {
  min-width: 0;
  white-space: normal;
  text-align: center;
}

.it-support-page .grievance-hero.it-hero {
  position: relative !important;
  isolation: isolate;
  overflow: hidden !important;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) minmax(190px, 300px) !important;
  gap: clamp(20px, 3vw, 36px) !important;
  align-items: center !important;
  min-height: 250px !important;
  padding: clamp(24px, 3vw, 40px) !important;
  border: 1px solid rgba(154,164,205,.58) !important;
  border-radius: clamp(28px, 2.7vw, 40px) !important;
  background: linear-gradient(
    90deg,
    #d3f4fb 0%,
    #f7fcfb 34%,
    #fffdf8 52%,
    #fbf8fa 68%,
    #f0edfb 100%
  ) !important;
  box-shadow:
    10px 12px 0 #b9d7ff,
    0 26px 44px rgba(70,92,140,.12) !important;
}

.it-support-page .eyebrow {
  display: inline-flex !important;
  align-items: center !important;
  gap: 8px !important;
  width: max-content !important;
  max-width: 100% !important;
  margin-bottom: 15px !important;
  padding: 9px 13px !important;
  border: 0 !important;
  border-radius: 999px !important;
  color: #fff !important;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
  box-shadow: 4px 5px 0 #575092 !important;
  font-size: 9px !important;
  font-weight: 950 !important;
  line-height: 1 !important;
  letter-spacing: .12em !important;
  text-transform: uppercase !important;
}

.it-support-page .it-hero h1 {
  max-width: 900px !important;
  margin: 0 !important;
  color: var(--it-ink) !important;
  font-family: var(--yc-display, Georgia, "Times New Roman", serif) !important;
  font-size: clamp(44px, 5.2vw, 77px) !important;
  font-weight: 760 !important;
  line-height: .94 !important;
  letter-spacing: -.058em !important;
}

.it-support-page .it-hero h1 em {
  color: var(--it-violet);
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 500;
}

.it-support-page .it-hero p {
  max-width: 840px !important;
  margin: 17px 0 0 !important;
  color: var(--it-copy) !important;
  font-size: clamp(13px, 1vw, 16px) !important;
  line-height: 1.68 !important;
}

.it-support-page .grievance-hero-actions {
  position: relative;
  z-index: 1;
  display: flex !important;
  justify-content: flex-end !important;
  gap: 10px !important;
  flex-wrap: wrap !important;
  width: 100% !important;
  min-width: 0 !important;
}

.it-support-page .grievance-hero-actions .it-action-stack {
  width: min(320px, 100%) !important;
}

.it-support-page .ghost-btn,
.it-support-page .primary,
.it-support-page .secondary,
.it-support-page .danger,
.it-support-page .icon-btn {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px !important;
  border-radius: 15px !important;
  font-weight: 900 !important;
  cursor: pointer !important;
  transition:
    transform 190ms ease,
    box-shadow 190ms ease,
    filter 190ms ease,
    opacity 190ms ease !important;
}

.it-support-page .ghost-btn:hover:not(:disabled),
.it-support-page .primary:hover:not(:disabled),
.it-support-page .secondary:hover:not(:disabled),
.it-support-page .danger:hover:not(:disabled),
.it-support-page .icon-btn:hover {
  transform: translateY(-2px);
  filter: saturate(1.04);
}

.it-support-page .ghost-btn:disabled,
.it-support-page .primary:disabled,
.it-support-page .secondary:disabled,
.it-support-page .danger:disabled {
  opacity: .58;
  cursor: not-allowed;
}

.it-support-page .primary {
  min-height: 46px !important;
  padding: 10px 16px !important;
  border: 0 !important;
  color: #fff !important;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
  box-shadow: 6px 7px 0 #575092, 0 14px 25px rgba(67,116,170,.16) !important;
}

.it-support-page .ghost-btn,
.it-support-page .secondary {
  min-height: 44px !important;
  padding: 9px 14px !important;
  border: 1px solid rgba(77,119,221,.18) !important;
  color: #fff !important;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
  box-shadow: 5px 6px 0 #575092 !important;
}

.it-support-page .danger {
  min-height: 44px !important;
  padding: 9px 14px !important;
  border: 1px solid rgba(77,119,221,.18) !important;
  color: #fff !important;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
  box-shadow: 5px 6px 0 #575092 !important;
}

.it-support-page .ghost-btn.active,
.it-support-page .ticket-actions .ghost-btn.active {
  color: #fff !important;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
  border-color: transparent !important;
  box-shadow: 5px 6px 0 #575092 !important;
}

.it-support-page .it-support-refresh-btn {
  min-height: 54px !important;
  padding-inline: 18px !important;
  box-shadow: 6px 7px 0 #575092, 0 14px 25px rgba(67,116,170,.12) !important;
}

.it-support-page .it-support-refresh-btn svg:first-child {
  animation: itRefreshIdle 4.2s linear infinite;
}

.it-support-page .grievance-stats {
  display: grid !important;
  grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
  gap: 14px !important;
  margin: 0 !important;
}

.it-support-page .mini-stat-card {
  min-width: 0 !important;
  min-height: 120px !important;
  padding: 18px !important;
  border: 1px solid rgba(171,181,211,.66) !important;
  border-radius: 22px !important;
  background: #edf6ff !important;
  box-shadow: 7px 9px 0 #b9d7ff, 0 18px 30px rgba(34,38,110,.09) !important;
  transition: transform 190ms ease !important;
}

.it-support-page .mini-stat-card:nth-child(2) {
  background: #eaf8f4 !important;
  box-shadow: 7px 9px 0 #aee6d9, 0 18px 30px rgba(34,38,110,.09) !important;
}

.it-support-page .mini-stat-card:nth-child(3) {
  background: #fff4d5 !important;
  box-shadow: 7px 9px 0 #ffe0a5, 0 18px 30px rgba(34,38,110,.09) !important;
}

.it-support-page .mini-stat-card:nth-child(4) {
  background: #f1efff !important;
  box-shadow: 7px 9px 0 #c9c0ff, 0 18px 30px rgba(34,38,110,.09) !important;
}

.it-support-page .mini-stat-card:nth-child(5) {
  background: #fff0f2 !important;
  box-shadow: 7px 9px 0 #f2c2cc, 0 18px 30px rgba(34,38,110,.09) !important;
}

.it-support-page .mini-stat-card:nth-child(6) {
  background: #edf6ff !important;
  box-shadow: 7px 9px 0 #b9d7ff, 0 18px 30px rgba(34,38,110,.09) !important;
}

.it-support-page .mini-stat-card:hover {
  transform: translateY(-4px);
}

.it-support-page .mini-stat-card span {
  display: block;
  color: #5d6785;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.it-support-page .mini-stat-card strong {
  display: block;
  margin-top: 10px;
  color: var(--it-ink);
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(30px, 3vw, 43px);
  line-height: 1;
}

.it-support-page .it-support-grid,
.it-support-page .grievance-grid.it-support-grid {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) !important;
  gap: 22px !important;
  align-items: start !important;
  width: 100% !important;
  min-width: 0 !important;
  margin: 0 !important;
}

.it-support-page .panel,
.it-support-page .grievance-form-panel,
.it-support-page .grievance-list-panel {
  min-width: 0 !important;
  width: 100% !important;
  overflow: hidden !important;
  border: 1px solid rgba(171,181,211,.70) !important;
  border-radius: clamp(26px, 2.2vw, 36px) !important;
  background: #ffffff !important;
  box-shadow: 8px 10px 0 #c4ccff, 0 24px 42px rgba(34,38,110,.10) !important;
}

.it-support-page .grievance-form-panel,
.it-support-page .it-my-ticket-summary-panel,
.it-support-page > .grievance-list-panel {
  padding: clamp(18px, 2vw, 28px) !important;
}

.it-support-page .section-heading {
  display: flex !important;
  align-items: flex-start !important;
  justify-content: space-between !important;
  gap: 16px !important;
  width: 100% !important;
  min-width: 0 !important;
  margin-bottom: 18px !important;
}

.it-support-page .section-heading > div {
  flex: 1 1 auto;
  min-width: 0 !important;
}

.it-support-page .section-heading h2 {
  margin: 0 !important;
  color: var(--it-ink) !important;
  font-family: var(--yc-display, Georgia, "Times New Roman", serif) !important;
  font-size: clamp(25px, 2.3vw, 37px) !important;
  font-weight: 760 !important;
  line-height: 1 !important;
  letter-spacing: -.045em !important;
}

.it-support-page .section-heading p {
  margin: 8px 0 0 !important;
  color: var(--it-copy) !important;
  font-size: 13px !important;
  line-height: 1.58 !important;
}

.it-support-page .section-heading > svg {
  color: var(--it-violet);
  animation: itIconFloat 3.2s ease-in-out infinite;
}

.it-support-page .profile-prefill-card,
.it-support-page .it-my-ticket-summary-card,
.it-support-page .it-team-strip,
.it-support-page .filter-bar,
.it-support-page .it-context-panel,
.it-support-page .account-access-ticket {
  border: 1px solid rgba(171,181,211,.55) !important;
  border-radius: 22px !important;
  box-shadow: 5px 6px 0 rgba(52,43,120,.08) !important;
}

.it-support-page .profile-prefill-card {
  margin: 0 0 18px !important;
  padding: 17px !important;
  background: #f5f5ff !important;
  box-shadow: 5px 6px 0 #c9c0ff !important;
}

.it-support-page .profile-prefill-title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 13px;
  color: #40348d;
  font-weight: 900;
}

.it-support-page .profile-prefill-grid,
.it-support-page .ticket-meta-grid {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: 12px !important;
  width: 100% !important;
  min-width: 0 !important;
}

.it-support-page .profile-prefill-grid > div,
.it-support-page .ticket-meta-grid > div,
.it-support-page .it-sheet-stats > div {
  min-width: 0 !important;
  padding: 12px !important;
  border: 1px solid rgba(171,181,211,.44) !important;
  border-radius: 16px !important;
  background: rgba(255,255,255,.86) !important;
  box-shadow: 3px 4px 0 rgba(52,43,120,.07) !important;
}

.it-support-page .profile-prefill-grid span,
.it-support-page .ticket-meta-grid span,
.it-support-page .it-sheet-stats span {
  display: block;
  color: #5d6785;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.it-support-page .profile-prefill-grid strong,
.it-support-page .ticket-meta-grid strong,
.it-support-page .it-sheet-stats strong {
  display: block;
  margin-top: 6px;
  color: var(--it-ink);
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.it-support-page .modern-form {
  display: grid !important;
  gap: 15px !important;
}

.it-support-page .form-row.two,
.it-support-page .it-context-form,
.it-support-page .account-access-editor-grid {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: 12px !important;
}

.it-support-page .modern-form label,
.it-support-page .it-context-form label {
  min-width: 0 !important;
  color: #303b5b !important;
  font-size: 11px !important;
  font-weight: 900 !important;
}

.it-support-page .modern-form label > span {
  display: block;
  margin-bottom: 8px;
}

.it-support-page .modern-form input,
.it-support-page .modern-form select,
.it-support-page .modern-form textarea,
.it-support-page .filter-bar input,
.it-support-page .filter-bar select,
.it-support-page .account-access-toolbar input,
.it-support-page .account-access-toolbar select,
.it-support-page .account-access-editor input,
.it-support-page .account-access-editor select,
.it-support-page .account-access-editor textarea {
  width: 100% !important;
  min-width: 0 !important;
  min-height: 47px !important;
  padding: 11px 13px !important;
  border: 1px solid rgba(151,161,197,.58) !important;
  border-radius: 15px !important;
  outline: none !important;
  color: var(--it-ink) !important;
  background: rgba(255,255,255,.94) !important;
  box-shadow: none !important;
}

.it-support-page .modern-form textarea,
.it-support-page .account-access-editor textarea {
  min-height: 120px !important;
  resize: vertical;
}

.it-support-page .modern-form input:focus,
.it-support-page .modern-form select:focus,
.it-support-page .modern-form textarea:focus,
.it-support-page .filter-bar input:focus,
.it-support-page .filter-bar select:focus,
.it-support-page .account-access-toolbar input:focus,
.it-support-page .account-access-toolbar select:focus,
.it-support-page .account-access-editor input:focus,
.it-support-page .account-access-editor select:focus,
.it-support-page .account-access-editor textarea:focus {
  border-color: rgba(102,88,220,.65) !important;
  box-shadow: 4px 5px 0 rgba(102,88,220,.14), 0 0 0 4px rgba(102,88,220,.08) !important;
}

.it-support-page .modern-form .primary {
  width: 100%;
  min-height: 52px !important;
}

.it-support-page .it-my-ticket-summary-panel {
  display: grid !important;
  gap: 18px !important;
  min-height: 0 !important;
}

.it-support-page .it-my-ticket-summary-card {
  display: grid !important;
  grid-template-columns: auto minmax(0, 1fr) !important;
  gap: clamp(14px, 2vw, 20px) !important;
  align-items: center !important;
  width: 100% !important;
  min-width: 0 !important;
  padding: clamp(16px, 2vw, 20px) !important;
  background: #f5f5ff !important;
  box-shadow: 5px 6px 0 #c9c0ff !important;
}

.it-support-page .it-my-ticket-summary-copy {
  min-width: 0 !important;
}

.it-support-page .it-my-ticket-summary-icon {
  width: 68px !important;
  height: 68px !important;
  display: grid !important;
  place-items: center !important;
  border-radius: 22px !important;
  color: #fff !important;
  background: linear-gradient(145deg, #4d77dd, #2eb2b9) !important;
  box-shadow: 4px 5px 0 #575092 !important;
  animation: itIconFloat 3.2s ease-in-out infinite;
}

.it-support-page .it-my-ticket-summary-copy span {
  display: block;
  color: #5d6785;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.it-support-page .it-my-ticket-summary-copy strong {
  display: block;
  margin-top: 6px;
  color: var(--it-ink);
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(40px, 4vw, 58px);
  line-height: 1;
}

.it-support-page .it-my-ticket-summary-copy p {
  margin: 8px 0 0;
  color: var(--it-copy);
  line-height: 1.55;
}

.it-support-page .it-my-ticket-summary-actions .primary {
  width: 100%;
}

.it-support-page .it-team-strip {
  display: grid !important;
  grid-template-columns: minmax(0,1fr) auto !important;
  gap: 8px 16px !important;
  align-items: center !important;
  margin: 0 0 18px !important;
  padding: 17px !important;
  background: #edf6ff !important;
  box-shadow: 5px 6px 0 #b9d7ff !important;
}

.it-support-page .it-team-strip > div {
  display: flex;
  align-items: center;
  gap: 10px;
}

.it-support-page .it-team-strip span {
  color: var(--it-ink);
  font-weight: 900;
}

.it-support-page .it-team-strip strong {
  color: #40348d;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 30px;
}

.it-support-page .it-team-strip small {
  grid-column: 1 / -1;
  color: var(--it-copy);
  font-weight: 750;
}

.it-support-page .filter-bar,
.it-support-page .account-access-toolbar {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)) !important;
  gap: 12px !important;
  align-items: end !important;
  width: 100% !important;
  min-width: 0 !important;
  margin: 0 0 18px !important;
  padding: 14px !important;
  background: #f8f9ff !important;
}

.it-support-page .account-access-toolbar {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)) !important;
}

.it-support-page .filter-label {
  grid-column: 1 / -1;
}

.it-support-page .filter-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #40348d;
  font-size: 10px;
  font-weight: 950;
  letter-spacing: .08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.it-support-page .ticket-list,
.it-support-page .account-access-list {
  display: grid !important;
  gap: 15px !important;
}

.it-support-page .ticket-card.it-ticket-card,
.it-support-page .it-ticket-card,
.it-support-page .account-access-ticket {
  min-width: 0 !important;
  padding: 18px !important;
  border: 1px solid rgba(171,181,211,.62) !important;
  border-radius: 22px !important;
  background: #ffffff !important;
  box-shadow: 5px 6px 0 rgba(52,43,120,.08) !important;
  transition:
    transform 190ms ease,
    box-shadow 190ms ease,
    border-color 190ms ease !important;
}

.it-support-page .it-ticket-card:nth-child(3n + 1),
.it-support-page .account-access-ticket:nth-child(3n + 1) {
  background: #ffffff !important;
  box-shadow: 5px 6px 0 #b9d7ff !important;
}

.it-support-page .it-ticket-card:nth-child(3n + 2),
.it-support-page .account-access-ticket:nth-child(3n + 2) {
  background: #ffffff !important;
  box-shadow: 5px 6px 0 #aee6d9 !important;
}

.it-support-page .it-ticket-card:nth-child(3n + 3),
.it-support-page .account-access-ticket:nth-child(3n + 3) {
  background: #ffffff !important;
  box-shadow: 5px 6px 0 #c9c0ff !important;
}

.it-support-page .it-ticket-card:hover,
.it-support-page .account-access-ticket:hover {
  transform: translateY(-3px);
  border-color: rgba(102,88,220,.28) !important;
}

.it-support-page .it-ticket-card.it-ticket-card-active {
  border-color: rgba(102,88,220,.55) !important;
  box-shadow: 7px 8px 0 #c9c0ff, 0 22px 44px rgba(34,38,110,.12) !important;
}

.it-support-page .ticket-topline,
.it-support-page .account-access-ticket-head,
.it-support-page .account-access-ticket-actions {
  display: flex !important;
  align-items: flex-start !important;
  justify-content: space-between !important;
  gap: 10px !important;
  flex-wrap: wrap !important;
  min-width: 0 !important;
}

.it-support-page .account-access-ticket-meta {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)) !important;
  gap: 8px 12px !important;
  width: 100% !important;
  min-width: 0 !important;
}

.it-support-page .account-access-ticket-meta > span {
  min-width: 0 !important;
  overflow-wrap: anywhere;
}

.it-support-page .ticket-topline strong {
  display: block;
  color: #40348d;
  font-size: 13px;
  font-weight: 950;
  overflow-wrap: anywhere;
}

.it-support-page .ticket-topline span {
  display: block;
  margin-top: 4px;
  color: var(--it-copy);
  font-size: 11px;
}

.it-support-page .ticket-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}

.it-support-page .pill {
  display: inline-flex;
  padding: 7px 10px !important;
  border-radius: 999px !important;
  font-size: 10px !important;
  font-weight: 900 !important;
  text-transform: capitalize;
  box-shadow: 2px 3px 0 rgba(52,43,120,.07);
}

.it-support-page .pill.success {
  color: #047857 !important;
  background: #eaf8f4 !important;
  box-shadow: 2px 3px 0 #aee6d9 !important;
}

.it-support-page .pill.warning {
  color: #9a6817 !important;
  background: #fff4d5 !important;
  box-shadow: 2px 3px 0 #ffe0a5 !important;
}

.it-support-page .pill.info {
  color: #245da8 !important;
  background: #edf6ff !important;
  box-shadow: 2px 3px 0 #b9d7ff !important;
}

.it-support-page .pill.danger {
  color: #a2344d !important;
  background: #fff0f2 !important;
  box-shadow: 2px 3px 0 #f2c2cc !important;
}

.it-support-page .pill.muted {
  color: #475569 !important;
  background: #f1f5f9 !important;
  box-shadow: 2px 3px 0 #dbe1e8 !important;
}

.it-support-page .it-ticket-card h3,
.it-support-page .account-access-ticket h3 {
  margin: 14px 0 7px !important;
  color: var(--it-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: 21px !important;
  font-weight: 760;
  letter-spacing: -.03em;
}

.it-support-page .it-ticket-card > p,
.it-support-page .account-access-ticket p {
  margin: 0 !important;
  color: var(--it-copy) !important;
  line-height: 1.58 !important;
}

.it-support-page .ticket-actions {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)) !important;
  gap: 10px !important;
  width: 100% !important;
  min-width: 0 !important;
  margin-top: 15px !important;
}

.it-support-page .ticket-actions > button {
  width: 100% !important;
  min-width: 0 !important;
}

.it-support-page .it-context-panel,
.it-support-page .account-access-editor {
  display: grid !important;
  gap: 12px !important;
  width: 100% !important;
  min-width: 0 !important;
  margin-top: 14px !important;
  padding: clamp(12px, 1.8vw, 15px) !important;
  border: 1px solid rgba(102,88,220,.22) !important;
  border-radius: 19px !important;
  background: #f7f6ff !important;
  box-shadow: 4px 5px 0 #c9c0ff !important;
}

.it-support-page .it-context-form label:nth-last-of-type(1),
.it-support-page .it-context-form button[type="submit"] {
  grid-column: 1 / -1;
}

.it-support-page .mode-escalate .it-context-form,
.it-support-page .mode-review .it-context-form,
.it-support-page .mode-reopen .it-context-form {
  grid-template-columns: 1fr !important;
}

.it-support-page .rating-picker {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}

.it-support-page .rating-picker button {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(171,181,211,.58);
  border-radius: 13px;
  color: #94a3b8;
  background: #fff;
  cursor: pointer;
}

.it-support-page .rating-picker button.active {
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  border-color: transparent;
  box-shadow: 3px 4px 0 #575092;
}

.it-support-page .it-sheet-backdrop {
  position: fixed !important;
  inset: 0 !important;
  z-index: 9999 !important;
  display: flex !important;
  justify-content: flex-end !important;
  width: 100vw !important;
  height: 100dvh !important;
  padding: max(16px, env(safe-area-inset-top,0px)) max(16px, env(safe-area-inset-right,0px)) max(16px, env(safe-area-inset-bottom,0px)) max(16px, env(safe-area-inset-left,0px)) !important;
  overflow: hidden !important;
  background: rgba(15,23,42,.54) !important;
  backdrop-filter: blur(12px) !important;
  animation: itSheetFadeIn .18s ease both;
}

.it-support-page .it-my-ticket-sheet {
  width: min(980px, calc(100vw - 32px)) !important;
  max-width: calc(100vw - 32px) !important;
  max-height: calc(100dvh - 32px) !important;
  align-self: stretch !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  border: 1px solid rgba(171,181,211,.70) !important;
  border-radius: 30px !important;
  background: #ffffff !important;
  box-shadow: 10px 12px 0 #c4ccff, 0 34px 90px rgba(9,16,35,.30) !important;
  animation: itSheetSlideIn .28s cubic-bezier(.2,.8,.2,1) both;
}

.it-support-page .it-sheet-header {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px !important;
  border-bottom: 1px solid rgba(171,181,211,.46);
  background: rgba(255,255,255,.92);
  backdrop-filter: blur(12px);
}

.it-support-page .it-sheet-header h2 {
  margin: 7px 0 6px;
  color: var(--it-ink);
  font-family: var(--yc-display, Georgia, "Times New Roman", serif);
  font-size: clamp(26px, 3vw, 39px);
  font-weight: 760;
  letter-spacing: -.04em;
}

.it-support-page .it-sheet-header p {
  margin: 0;
  color: var(--it-copy);
  line-height: 1.55;
}

.it-support-page .it-sheet-header .icon-btn {
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  border: 1px solid rgba(77,119,221,.18);
  color: #fff;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
  box-shadow: 4px 5px 0 #575092;
}

.it-support-page .it-sheet-stats {
  flex: 0 0 auto;
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0,1fr)) !important;
  gap: 10px !important;
  padding: 14px 22px !important;
  border-bottom: 1px solid rgba(171,181,211,.42);
}

.it-support-page .it-sheet-body {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  padding: 18px 22px 24px !important;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.it-support-sheet-portal-root.it-support-page {
  width: auto !important;
  min-height: 0 !important;
  transform: none !important;
  position: static !important;
  isolation: auto !important;
}

.it-support-page .account-access-desk {
  margin-top: 0;
}

.it-support-page .account-access-ticket-meta {
  justify-content: flex-start !important;
  margin-top: 12px;
  color: var(--it-copy);
  font-size: 12px;
}


.it-support-page .it-section-content {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin: 0 !important;
  animation: itSectionReveal .18s ease both;
}

.it-support-page .it-section-content.panel {
  padding: clamp(20px, 2vw, 28px) !important;
}

@keyframes itSectionReveal {
  from {
    opacity: 0;
    transform: translateY(5px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.it-support-page .it-section-tabs {
  display: grid !important;
  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  gap: 12px !important;
  width: 100% !important;
  padding: 12px !important;
  border: 1px solid rgba(171,181,211,.62) !important;
  border-radius: 22px !important;
  background: #ffffff !important;
  box-shadow: 6px 7px 0 #c4ccff, 0 16px 28px rgba(34,38,110,.08) !important;
}

.it-support-page .it-section-tab {
  min-width: 0 !important;
  min-height: 62px !important;
  display: grid !important;
  grid-template-columns: auto minmax(0, 1fr) auto !important;
  gap: 10px !important;
  align-items: center !important;
  padding: 11px 14px !important;
  border: 1px solid rgba(77,119,221,.22) !important;
  border-radius: 16px !important;
  color: #4767b4 !important;
  background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%) !important;
  box-shadow: 3px 4px 0 rgba(87,80,146,.16) !important;
  text-align: left !important;
  cursor: pointer !important;
}

.it-support-page .it-section-tab:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: rgba(46,178,185,.46) !important;
}

.it-support-page .it-section-tab.active {
  border-color: transparent !important;
  color: #fff !important;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
  box-shadow: 5px 6px 0 #575092 !important;
}

.it-support-page .it-section-tab:disabled {
  cursor: not-allowed !important;
  opacity: .46 !important;
}

.it-support-page .it-section-tab-copy {
  min-width: 0 !important;
  display: grid !important;
  gap: 3px !important;
}

.it-support-page .it-section-tab-copy strong {
  font-size: 12px !important;
  font-weight: 950 !important;
  line-height: 1.2 !important;
}

.it-support-page .it-section-tab-copy small {
  color: #6b7692 !important;
  font-size: 9px !important;
  font-weight: 750 !important;
  line-height: 1.25 !important;
}

.it-support-page .it-section-tab.active .it-section-tab-copy small {
  color: rgba(255,255,255,.78) !important;
}

.it-support-page .it-section-tab-count {
  display: inline-grid !important;
  place-items: center !important;
  min-width: 30px !important;
  height: 30px !important;
  padding-inline: 7px !important;
  border-radius: 10px !important;
  color: #40348d !important;
  background: #fff !important;
  box-shadow: 2px 3px 0 rgba(52,43,120,.10) !important;
  font-size: 10px !important;
  font-weight: 950 !important;
}

.it-support-page .it-section-tab.active .it-section-tab-count {
  color: #4d77dd !important;
}

.it-support-page .it-action-stack,
.it-support-page .it-filter-action-stack,
.it-support-page .it-account-action-stack {
  display: grid !important;
  gap: 8px !important;
  min-width: 0 !important;
}

.it-support-page .it-filter-action-stack {
  align-self: stretch !important;
}

.it-support-page .it-filter-action-stack > button,
.it-support-page .it-account-action-stack > button {
  width: 100% !important;
}

.it-support-page .it-inline-feedback {
  display: grid !important;
  grid-template-columns: auto minmax(0, 1fr) auto !important;
  gap: 9px !important;
  align-items: start !important;
  width: 100% !important;
  min-width: 0 !important;
  padding: 10px 11px !important;
  border: 1px solid rgba(102,88,220,.18) !important;
  border-radius: 12px !important;
  color: #40348d !important;
  background: #f1efff !important;
  box-shadow: 3px 4px 0 #c9c0ff !important;
  font-size: 10px !important;
  line-height: 1.45 !important;
}

.it-support-page .it-inline-feedback.success {
  border-color: rgba(4,120,87,.18) !important;
  color: #047857 !important;
  background: #eaf8f4 !important;
  box-shadow: 3px 4px 0 #aee6d9 !important;
}

.it-support-page .it-inline-feedback.warning {
  border-color: rgba(154,104,23,.18) !important;
  color: #9a6817 !important;
  background: #fff4d5 !important;
  box-shadow: 3px 4px 0 #ffe0a5 !important;
}

.it-support-page .it-inline-feedback.error {
  border-color: rgba(162,52,77,.18) !important;
  color: #a2344d !important;
  background: #fff0f2 !important;
  box-shadow: 3px 4px 0 #f2c2cc !important;
}

.it-support-page .it-inline-feedback-icon {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 22px !important;
  height: 22px !important;
  flex: 0 0 22px !important;
}

.it-support-page .it-inline-feedback-copy {
  min-width: 0 !important;
}

.it-support-page .it-inline-feedback-copy strong,
.it-support-page .it-inline-feedback-copy span {
  display: block !important;
  overflow-wrap: anywhere !important;
}

.it-support-page .it-inline-feedback-copy strong {
  margin-bottom: 2px !important;
  font-weight: 950 !important;
}

.it-support-page .it-inline-feedback-copy span {
  font-weight: 750 !important;
}

.it-support-page .it-inline-feedback-close {
  width: 24px !important;
  min-width: 24px !important;
  height: 24px !important;
  display: inline-grid !important;
  place-items: center !important;
  margin: -2px -3px -2px 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 8px !important;
  color: currentColor !important;
  background: rgba(255,255,255,.58) !important;
  box-shadow: none !important;
  font-size: 17px !important;
  line-height: 1 !important;
}

.it-support-page .it-inline-feedback-close:hover {
  transform: none !important;
  filter: none !important;
  background: #fff !important;
}

.it-support-page .it-ticket-action-feedback {
  margin-top: 10px !important;
}

.it-support-page .it-pagination {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 14px !important;
  width: 100% !important;
  min-width: 0 !important;
  margin: 0 0 15px !important;
  padding: 12px 13px !important;
  border: 1px solid rgba(171,181,211,.52) !important;
  border-radius: 16px !important;
  background: #f8f9ff !important;
  box-shadow: 3px 4px 0 rgba(52,43,120,.07) !important;
}

.it-support-page .it-pagination-copy {
  display: flex !important;
  align-items: baseline !important;
  gap: 6px !important;
  min-width: 0 !important;
  color: var(--it-copy) !important;
  font-size: 10px !important;
  font-weight: 850 !important;
}

.it-support-page .it-pagination-copy strong {
  color: var(--it-ink) !important;
  font-size: 13px !important;
  font-weight: 950 !important;
}

.it-support-page .it-pagination-controls {
  display: flex !important;
  align-items: center !important;
  justify-content: flex-end !important;
  gap: 8px !important;
  min-width: 0 !important;
  max-width: 100% !important;
  flex-wrap: wrap !important;
}

.it-support-page .it-page-size-control {
  display: inline-flex !important;
  align-items: center !important;
  gap: 7px !important;
  color: var(--it-copy) !important;
  font-size: 10px !important;
  font-weight: 900 !important;
  white-space: nowrap !important;
}

.it-support-page .it-page-size-control select {
  min-width: 108px !important;
  height: 38px !important;
  padding: 0 30px 0 10px !important;
  border: 1px solid rgba(102,88,220,.20) !important;
  border-radius: 12px !important;
  color: #40348d !important;
  background: #f1efff !important;
  box-shadow: 2px 3px 0 #c9c0ff !important;
  font-size: 10px !important;
  font-weight: 900 !important;
}

.it-support-page .it-page-button {
  min-width: 78px !important;
  height: 38px !important;
  padding: 0 11px !important;
  border: 1px solid rgba(77,119,221,.18) !important;
  border-radius: 12px !important;
  color: #fff !important;
  background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
  box-shadow: 4px 5px 0 #575092 !important;
  font-size: 10px !important;
  font-weight: 900 !important;
  cursor: pointer !important;
}

.it-support-page .it-page-button:disabled {
  cursor: not-allowed !important;
  opacity: .42 !important;
}

.it-support-page .it-page-indicator {
  min-width: 82px !important;
  color: var(--it-copy) !important;
  font-size: 10px !important;
  font-weight: 900 !important;
  text-align: center !important;
  white-space: nowrap !important;
}


.it-support-page .it-section-tabs-holder {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
}

@media (max-width: 1366px) {
  .it-support-page .grievance-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  }

  .it-support-page .it-section-tab {
    padding-inline: 11px !important;
  }

  .it-support-page .it-section-tab-copy small {
    font-size: 8px !important;
  }
}

@media (max-width: 1180px) {
  .it-support-page .grievance-hero.it-hero {
    grid-template-columns: minmax(0, 1fr) !important;
    min-height: 0 !important;
  }

  .it-support-page .grievance-hero-actions {
    justify-content: flex-start !important;
  }

  .it-support-page .grievance-hero-actions .it-action-stack {
    width: min(420px, 100%) !important;
  }

  .it-support-page .it-support-grid,
  .it-support-page .grievance-grid.it-support-grid {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .it-support-page .it-section-tab-copy small {
    display: none !important;
  }

  .it-support-page .it-section-tab {
    grid-template-columns: auto minmax(0, 1fr) auto !important;
    min-height: 56px !important;
  }

  .it-support-page .filter-bar,
  .it-support-page .account-access-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  .it-support-page .filter-label,
  .it-support-page .filter-bar input,
  .it-support-page .account-access-toolbar input {
    grid-column: 1 / -1 !important;
  }
}

@media (max-width: 900px) {
  .it-support-page {
    gap: 18px !important;
  }

  .it-support-page .it-section-tabs {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    gap: 8px !important;
    padding: 10px !important;
  }

  .it-support-page .it-section-tab {
    grid-template-columns: minmax(0, 1fr) !important;
    min-height: 52px !important;
    padding: 9px 10px !important;
    text-align: center !important;
  }

  .it-support-page .it-section-tab > svg,
  .it-support-page .it-section-tab-count {
    display: none !important;
  }

  .it-support-page .it-section-tab-copy {
    display: block !important;
    text-align: center !important;
  }

  .it-support-page .it-section-tab-copy strong {
    font-size: 11px !important;
  }

  .it-support-page .it-pagination {
    align-items: stretch !important;
    flex-direction: column !important;
  }

  .it-support-page .it-pagination-controls {
    justify-content: flex-start !important;
  }

  .it-support-page .ticket-meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  .it-support-page .account-access-ticket-actions {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    align-items: end !important;
  }

  .it-support-page .it-account-action-stack {
    min-width: 180px !important;
  }
}

@media (max-width: 760px) {
  .it-support-page {
    gap: 14px !important;
    padding-right: 8px !important;
    overflow-x: visible !important;
  }

  .it-support-page .grievance-hero.it-hero {
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 16px !important;
    min-height: 0 !important;
    padding: 18px !important;
    border-radius: 24px !important;
    box-shadow: 4px 5px 0 #c6d8f7, 0 14px 24px rgba(34,38,110,.09) !important;
  }

  .it-support-page .it-hero h1 {
    font-size: clamp(34px, 10vw, 50px) !important;
    line-height: .98 !important;
  }

  .it-support-page .it-hero p {
    margin-top: 12px !important;
    font-size: 12px !important;
  }

  .it-support-page .grievance-hero-actions,
  .it-support-page .grievance-hero-actions .it-action-stack,
  .it-support-page .grievance-hero-actions .ghost-btn {
    width: 100% !important;
  }

  .it-support-page .grievance-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 10px !important;
  }

  .it-support-page .mini-stat-card {
    min-height: 88px !important;
    padding: 14px !important;
    border-radius: 17px !important;
    box-shadow: 4px 5px 0 rgba(185,215,255,.9), 0 12px 22px rgba(34,38,110,.07) !important;
  }

  /* Mobile/app navigation: compact 2 × 2 headings-only grid. */
  .it-support-page .it-section-tabs {
    position: relative !important;
    top: auto !important;
    z-index: 1 !important;
    align-self: start !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 8px !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 8px !important;
    border-radius: 16px !important;
    background: rgba(255,255,255,.97) !important;
    box-shadow: 4px 5px 0 #c4ccff, 0 12px 24px rgba(34,38,110,.10) !important;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    overflow: visible !important;
    isolation: isolate;
  }

  .it-support-page .it-section-tabs-holder {
    position: relative !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
  }

  .it-support-page .it-section-tab {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-height: 44px !important;
    padding: 8px 10px !important;
    border-radius: 11px !important;
    text-align: center !important;
  }

  .it-support-page .it-section-tab > svg,
  .it-support-page .it-section-tab-count,
  .it-support-page .it-section-tab-copy small {
    display: none !important;
  }

  .it-support-page .it-section-tab-copy {
    display: block !important;
    width: 100% !important;
    text-align: center !important;
  }

  .it-support-page .it-section-tab-copy strong {
    display: block !important;
    font-size: 10.5px !important;
    line-height: 1.2 !important;
  }

  .it-support-page .grievance-form-panel,
  .it-support-page .it-my-ticket-summary-panel,
  .it-support-page > .grievance-list-panel,
  .it-support-page .it-section-content.panel {
    padding: 16px !important;
    border-radius: 20px !important;
    box-shadow: 4px 5px 0 #c4ccff, 0 14px 24px rgba(34,38,110,.08) !important;
  }

  .it-support-page .section-heading {
    gap: 10px !important;
    margin-bottom: 15px !important;
  }

  .it-support-page .section-heading h2 {
    font-size: clamp(24px, 7vw, 31px) !important;
  }

  .it-support-page .section-heading p {
    margin-top: 6px !important;
    font-size: 11px !important;
  }

  .it-support-page .profile-prefill-card,
  .it-support-page .it-my-ticket-summary-card,
  .it-support-page .it-team-strip,
  .it-support-page .filter-bar,
  .it-support-page .account-access-toolbar,
  .it-support-page .it-context-panel,
  .it-support-page .account-access-editor,
  .it-support-page .account-access-ticket,
  .it-support-page .it-ticket-card {
    max-width: 100% !important;
  }

  .it-support-page .profile-prefill-grid,
  .it-support-page .form-row.two,
  .it-support-page .ticket-meta-grid,
  .it-support-page .it-context-form,
  .it-support-page .account-access-editor-grid,
  .it-support-page .filter-bar,
  .it-support-page .account-access-toolbar {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .it-support-page .filter-label,
  .it-support-page .filter-bar input,
  .it-support-page .filter-bar .ghost-btn,
  .it-support-page .filter-bar .it-filter-action-stack,
  .it-support-page .account-access-toolbar input,
  .it-support-page .account-access-toolbar button,
  .it-support-page .account-access-toolbar .it-filter-action-stack {
    grid-column: auto !important;
  }

  .it-support-page .filter-bar,
  .it-support-page .account-access-toolbar {
    padding: 12px !important;
    gap: 10px !important;
    border-radius: 16px !important;
  }

  .it-support-page .it-my-ticket-summary-card {
    grid-template-columns: minmax(0, 1fr) !important;
    justify-items: start !important;
  }

  .it-support-page .it-my-ticket-summary-icon {
    width: 54px !important;
    height: 54px !important;
    border-radius: 17px !important;
  }

  .it-support-page .ticket-topline,
  .it-support-page .account-access-ticket-head {
    flex-direction: column !important;
    align-items: stretch !important;
  }

  .it-support-page .ticket-badges {
    justify-content: flex-start !important;
  }

  .it-support-page .ticket-actions {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .it-support-page .account-access-ticket-actions {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 10px !important;
  }

  .it-support-page .it-account-action-stack {
    width: 100% !important;
    min-width: 0 !important;
  }

  .it-support-page .it-team-strip {
    grid-template-columns: minmax(0, 1fr) auto !important;
    padding: 14px !important;
  }

  .it-support-page .it-pagination {
    gap: 10px !important;
    padding: 11px !important;
    border-radius: 14px !important;
  }

  .it-support-page .it-pagination-controls {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    width: 100% !important;
    gap: 8px !important;
  }

  .it-support-page .it-page-size-control,
  .it-support-page .it-page-indicator {
    grid-column: 1 / -1 !important;
  }

  .it-support-page .it-page-size-control {
    justify-content: space-between !important;
    width: 100% !important;
  }

  .it-support-page .it-page-size-control select {
    width: min(170px, 56vw) !important;
    min-width: 0 !important;
  }

  .it-support-page .it-page-button {
    width: 100% !important;
    min-width: 0 !important;
  }

  .it-support-page .it-sheet-backdrop {
    align-items: flex-end !important;
    padding: 0 !important;
  }

  .it-support-page .it-my-ticket-sheet {
    width: 100vw !important;
    max-width: 100vw !important;
    height: calc(100dvh - env(safe-area-inset-top,0px)) !important;
    max-height: calc(100dvh - env(safe-area-inset-top,0px)) !important;
    border-radius: 24px 24px 0 0 !important;
    border-bottom: 0 !important;
    animation: itSheetSlideInMobile .26s cubic-bezier(.2,.8,.2,1) both;
  }

  .it-support-page .it-sheet-header {
    padding: calc(16px + env(safe-area-inset-top,0px)) 14px 14px !important;
  }

  .it-support-page .it-sheet-stats {
    grid-template-columns: minmax(0, 1fr) !important;
    padding: 12px 14px !important;
  }

  .it-support-page .it-sheet-stats > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .it-support-page .it-sheet-stats strong {
    margin-top: 0;
  }

  .it-support-page .it-sheet-body {
    padding: 14px 14px calc(18px + env(safe-area-inset-bottom,0px)) !important;
  }
}

@media (max-width: 430px) {
  .it-support-page {
    gap: 12px !important;
  }

  .it-support-page .grievance-hero.it-hero {
    padding: 15px !important;
    border-radius: 20px !important;
  }

  .it-support-page .it-hero h1 {
    font-size: clamp(30px, 11vw, 42px) !important;
  }

  .it-support-page .eyebrow {
    padding: 8px 10px !important;
    font-size: 8px !important;
  }

  .it-support-page .grievance-stats {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .it-support-page .mini-stat-card {
    min-height: 72px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 12px !important;
    padding: 13px !important;
  }

  .it-support-page .mini-stat-card strong {
    margin-top: 0 !important;
  }

  .it-support-page .it-section-tabs {
    gap: 6px !important;
    padding: 7px !important;
    border-radius: 14px !important;
  }

  .it-support-page .it-section-tab {
    min-height: 40px !important;
    padding: 7px 8px !important;
  }

  .it-support-page .it-section-tab-copy strong {
    font-size: 9.5px !important;
  }

  .it-support-page .section-heading {
    flex-direction: column !important;
    gap: 8px !important;
  }

  .it-support-page .section-heading > svg {
    display: none !important;
  }

  .it-support-page .grievance-form-panel,
  .it-support-page .it-my-ticket-summary-panel,
  .it-support-page > .grievance-list-panel,
  .it-support-page .it-section-content.panel {
    padding: 14px !important;
    border-radius: 18px !important;
    box-shadow: 3px 4px 0 #c4ccff, 0 12px 20px rgba(34,38,110,.07) !important;
  }

  .it-support-page .profile-prefill-card,
  .it-support-page .it-my-ticket-summary-card,
  .it-support-page .it-team-strip,
  .it-support-page .filter-bar,
  .it-support-page .account-access-toolbar,
  .it-support-page .it-context-panel,
  .it-support-page .account-access-editor,
  .it-support-page .account-access-ticket,
  .it-support-page .it-ticket-card {
    padding-left: 12px !important;
    padding-right: 12px !important;
  }

  .it-support-page .it-team-strip {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .it-support-page .it-page-size-control {
    align-items: stretch !important;
    flex-direction: column !important;
  }

  .it-support-page .it-page-size-control select {
    width: 100% !important;
  }

  .it-support-page .it-page-indicator {
    min-width: 0 !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .it-support-page *,
  .it-support-page *::before,
  .it-support-page *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;

export default function ITSupport() {

  const [profile, setProfile] = useState({});
  const [permissions, setPermissions] = useState({
    can_manage: false,
    can_manage_normal: false,
    can_view_escalated: false,
    can_escalate: false,
    is_super_admin: false,
    is_it_head: false,
    is_it_member: false,
  });

  const [options, setOptions] = useState({
    categories: IT_SUPPORT_CATEGORY_OPTIONS,
    priorities: IT_SUPPORT_PRIORITY_OPTIONS,
    statuses: IT_SUPPORT_STATUS_OPTIONS,
    escalation_types: DEFAULT_ESCALATION_TYPES,
    it_team: [],
    it_heads: [],
    team_slots: {
      expected_total: 4,
      current_total: 0,
      heads: 0,
      members: 0,
      empty_slots: 4,
    },
  });

  const [ticketForm, setTicketForm] = useState(emptyTicketForm);
  const [assignForm, setAssignForm] = useState(emptyAssignForm);
  const [statusForm, setStatusForm] = useState(emptyStatusForm);
  const [reviewForm, setReviewForm] = useState(emptyReviewForm);
  const [reopenForm, setReopenForm] = useState(emptyReopenForm);
  const [escalationForm, setEscalationForm] = useState(emptyEscalationForm);

  const [myTickets, setMyTickets] = useState([]);
  const [teamTickets, setTeamTickets] = useState([]);

const [selectedTicket, setSelectedTicket] = useState(null);
const [panelMode, setPanelMode] = useState('');
const [activeActionKey, setActiveActionKey] = useState('');
const [showMyTicketsSheet, setShowMyTicketsSheet] = useState(false);

  const [activeSection, setActiveSection] = useState('raise');
  const [inlineFeedback, setInlineFeedback] = useState({});
  const feedbackTimersRef = useRef({});

  const [myTicketPage, setMyTicketPage] = useState(1);
  const [myTicketPageSize, setMyTicketPageSize] = useState(10);
  const [accountAccessPage, setAccountAccessPage] = useState(1);
  const [accountAccessPageSize, setAccountAccessPageSize] = useState(10);
  const [deskPage, setDeskPage] = useState(1);
  const [deskPageSize, setDeskPageSize] = useState(10);

  const [accountAccessTickets, setAccountAccessTickets] = useState([]);
  const [accountAccessLoading, setAccountAccessLoading] = useState(false);
  const [accountAccessSaving, setAccountAccessSaving] = useState('');
  const [accountAccessFilters, setAccountAccessFilters] = useState({ status: '', issue_category: '', search: '' });
  const [accountAccessDrafts, setAccountAccessDrafts] = useState({});


  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    issue_category: '',
    assigned_to: '',
    search: '',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [panelSaving, setPanelSaving] = useState(false);

  const manageAccess = Boolean(permissions.can_manage_normal || permissions.can_manage);
  const workAccess = Boolean(permissions.is_it_member || permissions.is_it_head);
  const superAdminEscalatedAccess = Boolean(permissions.can_view_escalated || permissions.is_super_admin);
  const canSeeDesk = manageAccess || workAccess || superAdminEscalatedAccess;
  const canEscalate = Boolean(permissions.can_escalate && manageAccess);
  const canManageAccountAccess = accountAccessManager(profile, permissions);

  const myTicketRows = myTickets || [];
  const deskTicketRows = teamTickets || [];
  const allStatRows = useMemo(
    () => uniqueTickets([...myTicketRows, ...deskTicketRows]),
    [myTicketRows, deskTicketRows],
  );

  const stats = useMemo(() => {
    const rows = allStatRows || [];

    return {
      total: rows.length,
      open: rows.filter((item) => item.status === 'open' || item.status === 'reopened').length,
      assigned: rows.filter((item) => item.status === 'assigned').length,
      inProgress: rows.filter((item) => item.status === 'in_progress').length,
      resolved: rows.filter((item) => item.status === 'resolved' || item.status === 'closed').length,
      unassigned: rows.filter((item) => !item.assigned_to_employee_id).length,
      escalated: rows.filter((item) => item.is_escalated).length,
      pendingReview: myTicketRows.filter((item) => canReviewTicket(item, profile)).length,
    };
  }, [allStatRows, myTicketRows, profile]);

  const myTicketPageCount = pageCountFor(myTicketRows, myTicketPageSize);
  const accountAccessPageCount = pageCountFor(accountAccessTickets, accountAccessPageSize);
  const deskPageCount = pageCountFor(deskTicketRows, deskPageSize);

  const pagedMyTicketRows = useMemo(
    () => paginateRows(myTicketRows, Math.min(myTicketPage, myTicketPageCount), myTicketPageSize),
    [myTicketRows, myTicketPage, myTicketPageCount, myTicketPageSize],
  );
  const pagedAccountAccessTickets = useMemo(
    () => paginateRows(accountAccessTickets, Math.min(accountAccessPage, accountAccessPageCount), accountAccessPageSize),
    [accountAccessTickets, accountAccessPage, accountAccessPageCount, accountAccessPageSize],
  );
  const pagedDeskTicketRows = useMemo(
    () => paginateRows(deskTicketRows, Math.min(deskPage, deskPageCount), deskPageSize),
    [deskTicketRows, deskPage, deskPageCount, deskPageSize],
  );

  function clearInlineFeedback(scope) {
    if (!scope) return;

    const timer = feedbackTimersRef.current[scope];
    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scope];
    }

    setInlineFeedback((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scope)) return current;
      const next = { ...current };
      delete next[scope];
      return next;
    });
  }

  function showInlineFeedback(scope, type, message, title = '', options = {}) {
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
      }, IT_SUPPORT_NOTICE_HIDE_MS);
    }
  }

  function changeSection(section) {
    closePanel();
    setShowMyTicketsSheet(false);
    setActiveSection(section);
  }

  function updateTicketForm(key, value) {
    setTicketForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function updateFilter(key, value) {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function applyPermissionData(data = {}) {
    setPermissions((prev) => ({
      ...prev,
      can_manage: Boolean(data.can_manage ?? prev.can_manage),
      can_manage_normal: Boolean(data.can_manage_normal ?? data.can_manage ?? prev.can_manage_normal),
      can_view_escalated: Boolean(data.can_view_escalated ?? prev.can_view_escalated),
      can_escalate: Boolean(data.can_escalate ?? prev.can_escalate),
      is_super_admin: Boolean(data.is_super_admin ?? prev.is_super_admin),
      is_it_head: Boolean(data.is_it_head ?? prev.is_it_head),
      is_it_member: Boolean(data.is_it_member ?? prev.is_it_member),
    }));
  }

function actionPanelKey(ticket = {}, section = 'desk') {
  const rawId = ticketId(ticket) || ticket.ticket_no || JSON.stringify(ticket);

  return `${section}-${String(rawId)}`
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 120);
}

function actionPanelDomId(ticket = {}, section = 'desk') {
  return `it-action-panel-${actionPanelKey(ticket, section)}`;
}

function panelTitle(mode = panelMode) {
  if (mode === 'assign') return 'Assign Ticket';
  if (mode === 'status') return 'Update Status';
  if (mode === 'review') return 'Give Review';
  if (mode === 'escalate') return 'Escalate to Super Admin';

  return 'Reopen Ticket';
}

function openPanel(mode, ticket, section = 'desk') {
  const nextActionKey = actionPanelKey(ticket, section);

  if (activeActionKey === nextActionKey && panelMode === mode) {
    closePanel();
    return;
  }

  setPanelMode(mode);
  setSelectedTicket(ticket);
  setActiveActionKey(nextActionKey);

  if (mode === 'assign') {
    setAssignForm({
      assigned_to_employee_id: ticket.assigned_to_employee_id || '',
      note: '',
    });
  }

  if (mode === 'status') {
    setStatusForm({
      status:
        ticket.status === 'open' || ticket.status === 'assigned'
          ? 'in_progress'
          : ticket.status || 'in_progress',
      status_note: ticket.last_status_note || ticket.superadmin_status_note || '',
      resolution_note: ticket.resolution_note || '',
    });
  }

  if (mode === 'review') {
    setReviewForm(emptyReviewForm);
  }

  if (mode === 'reopen') {
    setReopenForm(emptyReopenForm);
  }

  if (mode === 'escalate') {
    setEscalationForm({
      escalation_type: ticket.escalation_type || 'software_application',
      escalation_reason: ticket.escalation_reason || '',
    });
  }

  window.setTimeout(() => {
    document
      .getElementById(`it-action-panel-${nextActionKey}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 90);
}

function closePanel() {
  setPanelMode('');
  setSelectedTicket(null);
  setActiveActionKey('');
  setAssignForm(emptyAssignForm);
  setStatusForm(emptyStatusForm);
  setReviewForm(emptyReviewForm);
  setReopenForm(emptyReopenForm);
  setEscalationForm(emptyEscalationForm);
}


async function loadAccountAccessTickets(
  nextFilters = accountAccessFilters,
  feedbackScope = '',
) {
  if (!canManageAccountAccess) return;

  setAccountAccessLoading(true);

  if (feedbackScope) {
    showInlineFeedback(
      feedbackScope,
      'info',
      'Loading account-access requests with the selected filters...',
      'Applying Filters',
      { loading: true },
    );
  }

  try {
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (normalizeText(value)) params.set(key, normalizeText(value));
    });
    params.set('limit', '100');

    const response = await api(`/account-access/requests?${params.toString()}`);
    const payload = response?.data || response || {};
    const rows = payload.items || payload.requests || payload.tickets || [];
    const nextRows = Array.isArray(rows) ? rows : [];

    setAccountAccessTickets(nextRows);

    if (feedbackScope) {
      showInlineFeedback(
        feedbackScope,
        'success',
        `${nextRows.length} account-access request${nextRows.length === 1 ? '' : 's'} loaded.`,
        'Filters Applied',
      );
    }
  } catch (err) {
    showInlineFeedback(
      feedbackScope || 'account-filter',
      'error',
      err.message || 'Unable to load account-access requests.',
      'Account Access Load Failed',
    );
  } finally {
    setAccountAccessLoading(false);
  }
}

function updateAccountAccessDraft(ticket, key, value) {
  const id = ticket.ticket_id || ticket.ticket_no || ticket._id;
  setAccountAccessDrafts((prev) => ({
    ...prev,
    [id]: {
      status: ticket.status || 'open',
      assigned_to_name: ticket.assigned_to_name || '',
      latest_update: ticket.latest_update || ticket.status_note || '',
      resolution_remarks: ticket.resolution_remarks || ticket.resolution_note || '',
      ...(prev[id] || {}),
      [key]: value,
    },
  }));
}

async function saveAccountAccessTicket(ticket) {
  const id = ticket.ticket_id || ticket.ticket_no || ticket._id;
  const feedbackScope = `account-save:${id}`;
  const draft = {
    status: ticket.status || 'open',
    assigned_to_name: ticket.assigned_to_name || '',
    latest_update: ticket.latest_update || ticket.status_note || '',
    resolution_remarks: ticket.resolution_remarks || ticket.resolution_note || '',
    ...(accountAccessDrafts[id] || {}),
  };

  if (draft.status === 'resolved' && !normalizeText(draft.resolution_remarks)) {
    showInlineFeedback(
      feedbackScope,
      'warning',
      'Resolution remarks are required before resolving the request.',
      'Resolution Required',
    );
    return;
  }

  setAccountAccessSaving(id);
  showInlineFeedback(
    feedbackScope,
    'info',
    'Saving the latest account-access update...',
    'Saving Update',
    { loading: true },
  );

  try {
    await api(`/account-access/requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(draft),
    });
    showInlineFeedback(
      feedbackScope,
      'success',
      'Account-access request updated successfully.',
      'Request Updated',
    );
    await loadAccountAccessTickets();
  } catch (err) {
    showInlineFeedback(
      feedbackScope,
      'error',
      err.message || 'Unable to update account-access request.',
      'Update Failed',
    );
  } finally {
    setAccountAccessSaving('');
  }
}

async function loadData({ feedbackScope = '' } = {}) {
  setLoading(true);

  if (feedbackScope) {
    showInlineFeedback(
      feedbackScope,
      'info',
      'Refreshing IT support data...',
      'Refreshing',
      { loading: true },
    );
  }

  try {
    const [profileRes, optionsRes, myRes] = await Promise.all([
      getItSupportProfile(),
      getItSupportOptions(),
      getMyItSupportTickets(),
    ]);

    setProfile(profileRes.profile || {});
    applyPermissionData(profileRes);
    applyPermissionData(optionsRes);

    const nextPermissions = {
      can_manage: Boolean(optionsRes.can_manage ?? profileRes.can_manage),
      can_manage_normal: Boolean(
        optionsRes.can_manage_normal ??
        optionsRes.can_manage ??
        profileRes.can_manage_normal ??
        profileRes.can_manage
      ),
      can_view_escalated: Boolean(optionsRes.can_view_escalated ?? profileRes.can_view_escalated),
      can_escalate: Boolean(optionsRes.can_escalate ?? profileRes.can_escalate),
      is_super_admin: Boolean(optionsRes.is_super_admin ?? profileRes.is_super_admin),
      is_it_head: Boolean(optionsRes.is_it_head ?? profileRes.is_it_head),
      is_it_member: Boolean(optionsRes.is_it_member ?? profileRes.is_it_member),
    };

    setOptions({
      categories: optionsRes.categories?.length
        ? optionsRes.categories
        : IT_SUPPORT_CATEGORY_OPTIONS,
      priorities: optionsRes.priorities?.length
        ? optionsRes.priorities
        : IT_SUPPORT_PRIORITY_OPTIONS,
      statuses: optionsRes.statuses?.length
        ? optionsRes.statuses
        : IT_SUPPORT_STATUS_OPTIONS,
      escalation_types: optionsRes.escalation_types?.length
        ? optionsRes.escalation_types
        : DEFAULT_ESCALATION_TYPES,
      it_team: optionsRes.it_team || [],
      it_heads: optionsRes.it_heads || [],
      team_slots: optionsRes.team_slots || {
        expected_total: 4,
        current_total: 0,
        heads: 0,
        members: 0,
        empty_slots: 4,
      },
    });

    const shouldLoadDesk =
      nextPermissions.can_manage_normal ||
      nextPermissions.can_manage ||
      nextPermissions.is_it_member ||
      nextPermissions.is_it_head ||
      nextPermissions.can_view_escalated ||
      nextPermissions.is_super_admin;

    let teamRes = { tickets: [] };

    if (shouldLoadDesk) {
      teamRes = await getItSupportTickets(filters);
      applyPermissionData(teamRes);
    }

    setMyTickets(myRes.tickets || []);
    setTeamTickets(teamRes.tickets || []);

    if (feedbackScope) {
      showInlineFeedback(
        feedbackScope,
        'success',
        'IT support data refreshed successfully.',
        'Refresh Complete',
      );
    }
  } catch (err) {
    showInlineFeedback(
      feedbackScope || 'refresh',
      'error',
      err.message || 'Unable to load IT support data.',
      'IT Support Load Failed',
    );
  } finally {
    setLoading(false);
  }
}

async function loadTeamTickets(feedbackScope = '') {
    if (!canSeeDesk) return;

    setLoading(true);

    if (feedbackScope) {
      showInlineFeedback(
        feedbackScope,
        'info',
        'Loading IT support tickets with the selected filters...',
        'Applying Filters',
        { loading: true },
      );
    }

    try {
      const data = await getItSupportTickets(filters);
      const nextTickets = data.tickets || [];
      setTeamTickets(nextTickets);
      applyPermissionData(data);

      setOptions((prev) => ({
        ...prev,
        it_team: data.it_team || prev.it_team,
        it_heads: data.it_heads || prev.it_heads,
        team_slots: data.team_slots || prev.team_slots,
      }));

      if (feedbackScope) {
        showInlineFeedback(
          feedbackScope,
          'success',
          `${nextTickets.length} support ticket${nextTickets.length === 1 ? '' : 's'} loaded.`,
          'Filters Applied',
        );
      }
    } catch (err) {
      showInlineFeedback(
        feedbackScope || 'desk-filter',
        'error',
        err.message || 'Unable to load IT support tickets.',
        'Ticket Load Failed',
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTicket(event) {
    event.preventDefault();
    const feedbackScope = 'create-ticket';

    if (!normalizeText(ticketForm.subject)) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Subject is required.',
        'Missing Subject',
      );
      return;
    }

    if (!normalizeText(ticketForm.description)) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Description is required.',
        'Missing Description',
      );
      return;
    }

    setSaving(true);
    showInlineFeedback(
      feedbackScope,
      'info',
      'Submitting your IT support request...',
      'Submitting Ticket',
      { loading: true },
    );

    try {
      await createItSupportTicket({
        issue_category: ticketForm.issue_category,
        priority: ticketForm.priority,
        subject: normalizeText(ticketForm.subject),
        description: normalizeText(ticketForm.description),
      });

      setTicketForm(emptyTicketForm);
      showInlineFeedback(
        feedbackScope,
        'success',
        'IT support ticket submitted successfully to the IT Department.',
        'Ticket Submitted',
      );
      await loadData();
    } catch (err) {
      showInlineFeedback(
        feedbackScope,
        'error',
        err.message || 'Unable to submit IT support ticket.',
        'Ticket Submit Failed',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign(event) {
    event.preventDefault();
    const feedbackScope = activeActionKey ? `ticket:${activeActionKey}` : 'ticket-action';

    if (!selectedTicket) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Please select a ticket first.',
        'Ticket Required',
      );
      return;
    }

    if (!assignForm.assigned_to_employee_id) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Please select an IT Department member.',
        'Assignee Required',
      );
      return;
    }

    setPanelSaving(true);
    showInlineFeedback(
      feedbackScope,
      'info',
      'Saving the ticket assignment...',
      'Saving Assignment',
      { loading: true },
    );

    try {
      await assignItSupportTicket(ticketId(selectedTicket), assignForm);
      showInlineFeedback(
        feedbackScope,
        'success',
        'IT support ticket assigned successfully.',
        'Ticket Assigned',
      );
      closePanel();
      await loadData();
    } catch (err) {
      showInlineFeedback(
        feedbackScope,
        'error',
        err.message || 'Unable to assign ticket.',
        'Assignment Failed',
      );
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleStatusUpdate(event) {
    event.preventDefault();
    const feedbackScope = activeActionKey ? `ticket:${activeActionKey}` : 'ticket-action';

    if (!selectedTicket) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Please select a ticket first.',
        'Ticket Required',
      );
      return;
    }

    if (statusForm.status === 'resolved' && !normalizeText(statusForm.resolution_note || statusForm.status_note)) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Resolution note is required before marking ticket as resolved.',
        'Resolution Note Required',
      );
      return;
    }

    setPanelSaving(true);
    showInlineFeedback(
      feedbackScope,
      'info',
      'Saving the latest ticket status...',
      'Updating Status',
      { loading: true },
    );

    try {
      await updateItSupportTicketStatus(ticketId(selectedTicket), statusForm);
      showInlineFeedback(
        feedbackScope,
        'success',
        statusForm.status === 'resolved'
          ? 'Ticket marked as resolved. The requester can now give a review from My IT Tickets.'
          : 'IT support ticket status updated successfully.',
        statusForm.status === 'resolved' ? 'Ticket Resolved' : 'Status Updated',
      );
      closePanel();
      await loadData();
    } catch (err) {
      showInlineFeedback(
        feedbackScope,
        'error',
        err.message || 'Unable to update ticket status.',
        'Status Update Failed',
      );
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleEscalate(event) {
    event.preventDefault();
    const feedbackScope = activeActionKey ? `ticket:${activeActionKey}` : 'ticket-action';

    if (!selectedTicket) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Please select a ticket first.',
        'Ticket Required',
      );
      return;
    }

    if (!normalizeText(escalationForm.escalation_reason)) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Escalation reason is required.',
        'Escalation Reason Required',
      );
      return;
    }

    setPanelSaving(true);
    showInlineFeedback(
      feedbackScope,
      'info',
      'Escalating this ticket to Super Admin...',
      'Escalating Ticket',
      { loading: true },
    );

    try {
      await escalateItSupportTicket(ticketId(selectedTicket), {
        escalation_type: escalationForm.escalation_type,
        escalation_reason: normalizeText(escalationForm.escalation_reason),
      });

      showInlineFeedback(
        feedbackScope,
        'success',
        'IT support ticket escalated to Super Admin successfully.',
        'Ticket Escalated',
      );
      closePanel();
      await loadData();
    } catch (err) {
      showInlineFeedback(
        feedbackScope,
        'error',
        err.message || 'Unable to escalate ticket.',
        'Escalation Failed',
      );
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleReview(event) {
    event.preventDefault();
    const feedbackScope = activeActionKey ? `ticket:${activeActionKey}` : 'ticket-action';

    if (!selectedTicket) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Please select a ticket first.',
        'Ticket Required',
      );
      return;
    }

    setPanelSaving(true);
    showInlineFeedback(
      feedbackScope,
      'info',
      'Submitting your review...',
      'Submitting Review',
      { loading: true },
    );

    try {
      await reviewItSupportTicket(ticketId(selectedTicket), reviewForm);
      showInlineFeedback(
        feedbackScope,
        'success',
        'Review submitted successfully. The IT support ticket is now closed.',
        'Review Submitted',
      );
      closePanel();
      await loadData();
    } catch (err) {
      showInlineFeedback(
        feedbackScope,
        'error',
        err.message || 'Unable to submit review.',
        'Review Submit Failed',
      );
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleReopen(event) {
    event.preventDefault();
    const feedbackScope = activeActionKey ? `ticket:${activeActionKey}` : 'ticket-action';

    if (!selectedTicket) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Please select a ticket first.',
        'Ticket Required',
      );
      return;
    }

    if (!normalizeText(reopenForm.reason)) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Reopen reason is required.',
        'Reopen Reason Required',
      );
      return;
    }

    setPanelSaving(true);
    showInlineFeedback(
      feedbackScope,
      'info',
      'Reopening this IT support ticket...',
      'Reopening Ticket',
      { loading: true },
    );

    try {
      await reopenItSupportTicket(ticketId(selectedTicket), reopenForm);
      showInlineFeedback(
        feedbackScope,
        'success',
        'IT support ticket reopened successfully.',
        'Ticket Reopened',
      );
      closePanel();
      await loadData();
    } catch (err) {
      showInlineFeedback(
        feedbackScope,
        'error',
        err.message || 'Unable to reopen ticket.',
        'Reopen Failed',
      );
    } finally {
      setPanelSaving(false);
    }
  }

function renderTicketActionPanel(ticket, section = 'desk') {
  const currentActionKey = actionPanelKey(ticket, section);

  if (!selectedTicket || activeActionKey !== currentActionKey) return null;

  return (
    <div
      id={actionPanelDomId(ticket, section)}
      className={`it-context-panel ${panelMode ? `mode-${panelMode}` : ''}`}
    >
      <div className="it-context-panel-head">
        <div>
          <span className="eyebrow">IT Support Action</span>
          <h3>{panelTitle()}</h3>
        </div>

        <button type="button" className="icon-btn" onClick={closePanel} aria-label="Close action panel">
          ×
        </button>
      </div>

      <div className="it-context-summary">
        <strong>{selectedTicket.ticket_no || 'ITS'}</strong>
        <h4>{selectedTicket.subject}</h4>
        <p>{selectedTicket.description}</p>
      </div>

      {panelMode === 'assign' ? (
        <form className="modern-form it-context-form" onSubmit={handleAssign}>
          <label>
            <span>Assign To IT Department Member</span>
            <select
              value={assignForm.assigned_to_employee_id}
              onChange={(event) =>
                setAssignForm((prev) => ({
                  ...prev,
                  assigned_to_employee_id: event.target.value,
                }))
              }
            >
              <option value="">Select IT Department Member</option>
              <option value="self">Assign to Myself</option>
              {options.it_team.map((member) => (
                <option key={member.id || member._id} value={member.id || member._id}>
                  {member.label || member.employee_name || member.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Assignment Note</span>
            <textarea
              rows={4}
              value={assignForm.note}
              onChange={(event) =>
                setAssignForm((prev) => ({
                  ...prev,
                  note: event.target.value,
                }))
              }
              placeholder="Optional note for assigned IT Department member"
            />
          </label>

          <button type="submit" className="primary" disabled={panelSaving}>
            {panelSaving ? <Loader2 className="spin" size={17} /> : <UserCheck size={17} />}
            Save Assignment
          </button>
        </form>
      ) : null}

      {panelMode === 'status' ? (
        <form className="modern-form it-context-form" onSubmit={handleStatusUpdate}>
          <label>
            <span>Status</span>
            <select
              value={statusForm.status}
              onChange={(event) =>
                setStatusForm((prev) => ({
                  ...prev,
                  status: event.target.value,
                }))
              }
            >
              {options.statuses
                .filter((item) => {
                  if (manageAccess || superAdminEscalatedAccess) return true;
                  return ['in_progress', 'waiting_for_user', 'resolved'].includes(item.value);
                })
                .map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
            </select>
          </label>

          <label>
            <span>Status Note</span>
            <textarea
              rows={4}
              value={statusForm.status_note}
              onChange={(event) =>
                setStatusForm((prev) => ({
                  ...prev,
                  status_note: event.target.value,
                }))
              }
              placeholder="Progress update or note"
            />
          </label>

          <label>
            <span>Resolution Note</span>
            <textarea
              rows={4}
              value={statusForm.resolution_note}
              onChange={(event) =>
                setStatusForm((prev) => ({
                  ...prev,
                  resolution_note: event.target.value,
                }))
              }
              placeholder="Required when marking as resolved"
            />
          </label>

          <button type="submit" className="primary" disabled={panelSaving}>
            {panelSaving ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />}
            Save Status
          </button>
        </form>
      ) : null}

      {panelMode === 'escalate' ? (
        <form className="modern-form it-context-form" onSubmit={handleEscalate}>
          <label>
            <span>Escalation Type</span>
            <select
              value={escalationForm.escalation_type}
              onChange={(event) =>
                setEscalationForm((prev) => ({
                  ...prev,
                  escalation_type: event.target.value,
                }))
              }
            >
              {options.escalation_types.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Escalation Reason</span>
            <textarea
              rows={5}
              value={escalationForm.escalation_reason}
              onChange={(event) =>
                setEscalationForm((prev) => ({
                  ...prev,
                  escalation_reason: event.target.value,
                }))
              }
              placeholder="Explain why Super Admin support is required. Example: server issue, major software bug, database problem."
            />
          </label>

          <button type="submit" className="primary" disabled={panelSaving}>
            {panelSaving ? <Loader2 className="spin" size={17} /> : <ShieldAlert size={17} />}
            Escalate to Super Admin
          </button>
        </form>
      ) : null}

      {panelMode === 'review' ? (
        <form className="modern-form it-context-form" onSubmit={handleReview}>
          <label>
            <span>Rating</span>
            <StarRating
              value={reviewForm.rating}
              onChange={(rating) =>
                setReviewForm((prev) => ({
                  ...prev,
                  rating,
                }))
              }
            />
          </label>

          <label>
            <span>Review Comment</span>
            <textarea
              rows={5}
              value={reviewForm.comment}
              onChange={(event) =>
                setReviewForm((prev) => ({
                  ...prev,
                  comment: event.target.value,
                }))
              }
              placeholder="Share your feedback about the IT support resolution"
            />
          </label>

          <button type="submit" className="primary" disabled={panelSaving}>
            {panelSaving ? <Loader2 className="spin" size={17} /> : <Star size={17} />}
            Submit Review
          </button>
        </form>
      ) : null}

      {panelMode === 'reopen' ? (
        <form className="modern-form it-context-form" onSubmit={handleReopen}>
          <label>
            <span>Reopen Reason</span>
            <textarea
              rows={5}
              value={reopenForm.reason}
              onChange={(event) =>
                setReopenForm((prev) => ({
                  ...prev,
                  reason: event.target.value,
                }))
              }
              placeholder="Explain why this ticket needs to be reopened"
            />
          </label>

          <button type="submit" className="primary" disabled={panelSaving}>
            {panelSaving ? <Loader2 className="spin" size={17} /> : <RotateCcw size={17} />}
            Reopen Ticket
          </button>
        </form>
      ) : null}

      <ITSupportInlineMessage
        feedback={inlineFeedback[`ticket:${currentActionKey}`]}
        onClose={() => clearInlineFeedback(`ticket:${currentActionKey}`)}
      />
    </div>
  );
}

function renderTicketCard(ticket, section = 'my') {
  const isDeskSection = section === 'desk';
  const ticketCanUpdate = canUpdateWorkStatus(
    ticket,
    profile,
    manageAccess,
    workAccess,
    superAdminEscalatedAccess,
  );
  const ticketCanReview = canReviewTicket(ticket, profile);
  const ticketCanReopen = canReopenTicket(ticket, profile, manageAccess);
  const ticketCanEscalate = isDeskSection && canEscalate && !ticket.is_escalated;
  const showAssign = isDeskSection && manageAccess;
  const showUpdate = isDeskSection && ticketCanUpdate;
  const isReviewPending = ticketCanReview;
  const currentActionKey = actionPanelKey(ticket, section);
  const isActionOpen = activeActionKey === currentActionKey;

  return (
    <article
      key={`${section}-${ticketId(ticket) || ticket.ticket_no}`}
      className={`ticket-card it-ticket-card ${isReviewPending ? 'review-pending-ticket' : ''} ${isActionOpen ? 'it-ticket-card-active' : ''}`}
    >
      <div className="ticket-topline">
        <div>
          <strong>{ticket.ticket_no || 'ITS'}</strong>
          <span>{formatDate(ticket.created_at)}</span>
        </div>

        <div className="ticket-badges">
          {ticket.is_escalated ? (
            <span className="pill danger">
              Escalated
            </span>
          ) : null}

          {isReviewPending ? (
            <span className="pill warning">
              Review Pending
            </span>
          ) : null}

          <span className={`pill ${statusClass(ticket.status)}`}>
            {ticket.status_label || optionLabel(options.statuses, ticket.status)}
          </span>

          <span className={`pill ${priorityClass(ticket.priority)}`}>
            {ticket.priority_label || optionLabel(options.priorities, ticket.priority)}
          </span>
        </div>
      </div>

      <h3>{ticket.subject}</h3>
      <p>{ticket.description}</p>

      <div className="ticket-meta-grid">
        <div>
          <span>Category</span>
          <strong>
            {ticket.issue_category_label ||
              optionLabel(options.categories, ticket.issue_category)}
          </strong>
        </div>

        <div>
          <span>Raised By</span>
          <strong>{ticket.raised_by_name || '—'}</strong>
        </div>

        <div>
          <span>Assigned Person</span>
          <strong>
            {ticket.assigned_to_name || 'IT Team slot available'}
          </strong>
        </div>

        <div>
          <span>Resolution</span>
          <strong>{ticket.resolution_note || ticket.last_status_note || '—'}</strong>
        </div>
      </div>

      {ticket.is_escalated ? (
        <div className="anonymous-note">
          <ShieldAlert size={16} />
          Escalated to Super Admin
          {ticket.escalation_type_label ? ` — ${ticket.escalation_type_label}` : ''}
          {ticket.escalation_reason ? `: ${ticket.escalation_reason}` : ''}
        </div>
      ) : null}

      {!ticket.assigned_to_name ? (
        <div className="anonymous-note">
          <Wrench size={16} />
          No IT member assigned yet. IT Department Team Leader can assign this ticket.
        </div>
      ) : null}

      {ticket.review_rating ? (
        <div className="review-note">
          <Star size={16} />
          Employee Review: {ticket.review_rating}/5
          {ticket.review_comment ? ` — ${ticket.review_comment}` : ''}
        </div>
      ) : null}

      {isReviewPending ? (
        <div className="review-note">
          <Star size={16} />
          This ticket is resolved. Please give your review to close the support request.
        </div>
      ) : null}

      <div className="ticket-actions">
        {showAssign ? (
          <button
            type="button"
            className={`ghost-btn ${isActionOpen && panelMode === 'assign' ? 'active' : ''}`}
            onClick={() => openPanel('assign', ticket, section)}
          >
            <UserCheck size={15} />
            {ticket.assigned_to_name ? 'Reassign' : 'Assign'}
          </button>
        ) : null}

        {showUpdate ? (
          <button
            type="button"
            className={`ghost-btn ${isActionOpen && panelMode === 'status' ? 'active' : ''}`}
            onClick={() => openPanel('status', ticket, section)}
          >
            <ClipboardCheck size={15} />
            Update Status
          </button>
        ) : null}

        {ticketCanEscalate ? (
          <button
            type="button"
            className={`ghost-btn ${isActionOpen && panelMode === 'escalate' ? 'active' : ''}`}
            onClick={() => openPanel('escalate', ticket, section)}
          >
            <ShieldAlert size={15} />
            Escalate to Super Admin
          </button>
        ) : null}

        {ticketCanReview ? (
          <button
            type="button"
            className={`ghost-btn ${isActionOpen && panelMode === 'review' ? 'active' : ''}`}
            onClick={() => openPanel('review', ticket, section)}
          >
            <Star size={15} />
            Give Review
          </button>
        ) : null}

        {ticketCanReopen ? (
          <button
            type="button"
            className={`ghost-btn ${isActionOpen && panelMode === 'reopen' ? 'active' : ''}`}
            onClick={() => openPanel('reopen', ticket, section)}
          >
            <RotateCcw size={15} />
            Reopen
          </button>
        ) : null}
      </div>

      {!isActionOpen ? (
        <ITSupportInlineMessage
          feedback={inlineFeedback[`ticket:${currentActionKey}`]}
          onClose={() => clearInlineFeedback(`ticket:${currentActionKey}`)}
          className="it-ticket-action-feedback"
        />
      ) : null}

      {renderTicketActionPanel(ticket, section)}
    </article>
  );
}

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canManageAccountAccess) {
      setAccountAccessTickets([]);
      return;
    }

    loadAccountAccessTickets();
    // Account-access requests must load after profile/permission data resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageAccountAccess]);

  useEffect(() => {
    if (!showMyTicketsSheet || typeof document === 'undefined') return undefined;

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
      const sheet = document.querySelector('.it-my-ticket-sheet');
      if (sheet && sheet.contains(event.target)) return;
      event.preventDefault();
    };

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        closePanel();
        setShowMyTicketsSheet(false);
      }
    };

    document.addEventListener('wheel', blockBackgroundScroll, { passive: false });
    document.addEventListener('touchmove', blockBackgroundScroll, { passive: false });
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
  }, [showMyTicketsSheet]);

  useEffect(() => {
    function dismissInlineFeedback(event) {
      if (event.target?.closest?.('.it-inline-feedback')) return;

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
    setMyTicketPage((current) => Math.min(current, myTicketPageCount));
  }, [myTicketPageCount]);

  useEffect(() => {
    setAccountAccessPage((current) => Math.min(current, accountAccessPageCount));
  }, [accountAccessPageCount]);

  useEffect(() => {
    setDeskPage((current) => Math.min(current, deskPageCount));
  }, [deskPageCount]);

  useEffect(() => {
    if (activeSection === 'account' && !canManageAccountAccess) {
      setActiveSection(canSeeDesk ? 'desk' : 'raise');
    }

    if (activeSection === 'desk' && !canSeeDesk) {
      setActiveSection('raise');
    }
  }, [activeSection, canManageAccountAccess, canSeeDesk]);

  const rows = profileRows(profile);

  const sectionTabsElement = (
    <nav
      className="it-section-tabs"
      aria-label="IT support sections"
    >
      <button
        type="button"
        className={`it-section-tab ${activeSection === 'raise' ? 'active' : ''}`}
        onClick={() => changeSection('raise')}
        aria-pressed={activeSection === 'raise'}
      >
        <Laptop size={18} />
        <span className="it-section-tab-copy">
          <strong>Raise Ticket</strong>
          <small>Create a new IT support request</small>
        </span>
      </button>

      <button
        type="button"
        className={`it-section-tab ${activeSection === 'my' ? 'active' : ''}`}
        onClick={() => changeSection('my')}
        aria-pressed={activeSection === 'my'}
      >
        <Headphones size={18} />
        <span className="it-section-tab-copy">
          <strong>My IT Tickets</strong>
          <small>Track your raised tickets and reviews</small>
        </span>
        <span className="it-section-tab-count">{myTicketRows.length}</span>
      </button>

      <button
        type="button"
        className={`it-section-tab ${activeSection === 'desk' ? 'active' : ''}`}
        onClick={() => changeSection('desk')}
        aria-pressed={activeSection === 'desk'}
        disabled={!canSeeDesk}
      >
        <Headphones size={18} />
        <span className="it-section-tab-copy">
          <strong>{superAdminEscalatedAccess ? 'Escalated Desk' : 'Support Desk'}</strong>
          <small>
            {canSeeDesk
              ? superAdminEscalatedAccess
                ? 'Review tenant escalations'
                : 'Assign, update and resolve IT tickets'
              : 'Available to the IT support team'}
          </small>
        </span>
        <span className="it-section-tab-count">{deskTicketRows.length}</span>
      </button>

      <button
        type="button"
        className={`it-section-tab ${activeSection === 'account' ? 'active' : ''}`}
        onClick={() => changeSection('account')}
        aria-pressed={activeSection === 'account'}
        disabled={!canManageAccountAccess}
      >
        <ShieldAlert size={18} />
        <span className="it-section-tab-copy">
          <strong>Account Access</strong>
          <small>
            {canManageAccountAccess
              ? 'Manage pre-login employee requests'
              : 'Available to authorised support managers'}
          </small>
        </span>
        <span className="it-section-tab-count">{accountAccessTickets.length}</span>
      </button>
    </nav>
  );

  return (
    <div className="page-grid it-support-page">
      <style>{IT_SUPPORT_SHEET_STYLES}</style>

      <section className="grievance-hero it-hero">
        <div>
          <span className="eyebrow">Technology Helpdesk</span>
          <h1>IT Support</h1>
          <p>
            Raise IT issues to your tenant IT Department. IT Department Team
            Leader can assign tickets to IT members and escalate major software
            or server problems to Super Admin.
          </p>
        </div>

        <div className="grievance-hero-actions">
          <div className="it-action-stack">
            <button
              type="button"
              className="ghost-btn it-support-refresh-btn"
              onClick={() => loadData({ feedbackScope: 'refresh' })}
            >
              <RefreshCw size={16} />
              Refresh
            </button>

            <ITSupportInlineMessage
              feedback={inlineFeedback.refresh}
              onClose={() => clearInlineFeedback('refresh')}
            />
          </div>
        </div>
      </section>

      <section className="grievance-stats">
        <div className="mini-stat-card">
          <span>Total</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Open</span>
          <strong>{stats.open}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Assigned</span>
          <strong>{stats.assigned}</strong>
        </div>
        <div className="mini-stat-card">
          <span>In Progress</span>
          <strong>{stats.inProgress}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Resolved</span>
          <strong>{stats.resolved}</strong>
        </div>
        <div className="mini-stat-card">
          <span>Review Pending</span>
          <strong>{stats.pendingReview}</strong>
        </div>
      </section>

      <div className="it-section-tabs-holder">
        {sectionTabsElement}
      </div>

      {activeSection === 'raise' ? (
        <div className="it-section-content it-section-content-raise grievance-grid it-support-grid">
        <section className="panel grievance-form-panel">
          <div className="section-heading">
            <div>
              <h2>Raise IT Support Ticket</h2>
              <p>Your employee details are pre-filled automatically.</p>
            </div>
            <Laptop size={22} />
          </div>

          <div className="profile-prefill-card">
            <div className="profile-prefill-title">
              <UserCheck size={18} />
              <span>Prefilled Employee Details</span>
            </div>

            <div className="profile-prefill-grid">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value || '—'}</strong>
                </div>
              ))}
            </div>
          </div>

          <form className="modern-form" onSubmit={handleCreateTicket}>
            <div className="form-row two">
              <label>
                <span>Issue Category</span>
                <select
                  value={ticketForm.issue_category}
                  onChange={(event) => updateTicketForm('issue_category', event.target.value)}
                >
                  {options.categories.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Priority</span>
                <select
                  value={ticketForm.priority}
                  onChange={(event) => updateTicketForm('priority', event.target.value)}
                >
                  {options.priorities.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              <span>Subject</span>
              <input
                type="text"
                value={ticketForm.subject}
                onChange={(event) => updateTicketForm('subject', event.target.value)}
                placeholder="Example: Laptop not connecting to Wi-Fi"
              />
            </label>

            <label>
              <span>Description</span>
              <textarea
                rows={6}
                value={ticketForm.description}
                onChange={(event) => updateTicketForm('description', event.target.value)}
                placeholder="Explain the problem clearly"
              />
            </label>

            <div className="it-action-stack">
              <button type="submit" className="primary" disabled={saving}>
                {saving ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
                Submit IT Ticket
              </button>

              <ITSupportInlineMessage
                feedback={inlineFeedback['create-ticket']}
                onClose={() => clearInlineFeedback('create-ticket')}
              />
            </div>
          </form>
        </section>
        </div>
      ) : null}

      {activeSection === 'my' ? (
        <section className="it-section-content panel grievance-list-panel it-my-ticket-summary-panel">
          <div className="section-heading">
            <div>
              <h2>My IT Tickets</h2>
              <p>
                Your raised IT support requests are moved to a separate panel to keep this page clean.
              </p>
            </div>
            <Headphones size={22} />
          </div>

          <div className="it-my-ticket-summary-card">
            <div className="it-my-ticket-summary-icon">
              <Headphones size={26} />
            </div>

            <div className="it-my-ticket-summary-copy">
              <span>Total Tickets Raised</span>
              <strong>{myTicketRows.length}</strong>
              <p>
                {stats.pendingReview > 0
                  ? `${stats.pendingReview} ticket${stats.pendingReview > 1 ? 's' : ''} waiting for your review.`
                  : 'Track your raised tickets, reviews, reopen requests and resolution status.'}
              </p>
            </div>
          </div>

          <div className="it-my-ticket-summary-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                closePanel();
                setShowMyTicketsSheet(true);
              }}
            >
              <Headphones size={17} />
              View My Tickets
            </button>
          </div>
        </section>
      ) : null}

      {showMyTicketsSheet
        ? createPortal(
            <div className="it-support-page it-support-sheet-portal-root">
              <div
                className="it-sheet-backdrop"
                onClick={() => {
                  closePanel();
                  setShowMyTicketsSheet(false);
                }}
              >
                <aside
                  className="it-my-ticket-sheet"
                  role="dialog"
                  aria-modal="true"
                  aria-label="My IT Tickets"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="it-sheet-header">
                    <div>
                      <span className="eyebrow">Employee Ticket Panel</span>
                      <h2>My IT Tickets</h2>
                      <p>
                        Track tickets raised by you. After IT marks the issue as resolved,
                        use Give Review to close the ticket.
                      </p>
                    </div>

                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => {
                        closePanel();
                        setShowMyTicketsSheet(false);
                      }}
                      aria-label="Close my IT tickets panel"
                    >
                      ×
                    </button>
                  </div>

                  <div className="it-sheet-stats">
                    <div>
                      <span>Total</span>
                      <strong>{myTicketRows.length}</strong>
                    </div>
                    <div>
                      <span>Review Pending</span>
                      <strong>{stats.pendingReview}</strong>
                    </div>
                    <div>
                      <span>Resolved</span>
                      <strong>
                        {
                          myTicketRows.filter((ticket) =>
                            ['resolved', 'closed'].includes(String(ticket.status || '').toLowerCase())
                          ).length
                        }
                      </strong>
                    </div>
                  </div>

                  <div className="it-sheet-body">
                    {loading ? (
                      <div className="empty-state">
                        <Loader2 className="spin" size={28} />
                        <p>Loading your IT tickets...</p>
                      </div>
                    ) : myTicketRows.length ? (
                      <>
                        <ITPagination
                          total={myTicketRows.length}
                          page={Math.min(myTicketPage, myTicketPageCount)}
                          pageSize={myTicketPageSize}
                          onPageChange={setMyTicketPage}
                          onPageSizeChange={(value) => {
                            setMyTicketPage(1);
                            setMyTicketPageSize(value);
                          }}
                          label="my tickets"
                        />

                        <div className="ticket-list">
                          {pagedMyTicketRows.map((ticket) => renderTicketCard(ticket, 'my'))}
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">
                        <Headphones size={30} />
                        <p>No IT support tickets raised by you.</p>
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </div>,
            document.body,
          )
        : null}

      {activeSection === 'account' && canManageAccountAccess ? (
        <section className="it-section-content panel grievance-list-panel account-access-desk">
          <div className="section-heading">
            <div>
              <h2>Account Access Requests</h2>
              <p>Review pre-login access issues raised by employees of your company.</p>
            </div>
            <ShieldAlert size={22} />
          </div>

          <div className="account-access-toolbar">
            <input
              value={accountAccessFilters.search}
              onChange={(event) => setAccountAccessFilters((prev) => ({ ...prev, search: event.target.value }))}
              placeholder="Search ticket, employee or email"
            />
            <select
              value={accountAccessFilters.status}
              onChange={(event) => setAccountAccessFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="">All Status</option>
              {['open', 'assigned', 'in_progress', 'resolved', 'closed', 'rejected', 'reopened'].map((status) => (
                <option key={status} value={status}>{accountAccessStatusLabel(status)}</option>
              ))}
            </select>
            <select
              value={accountAccessFilters.issue_category}
              onChange={(event) => setAccountAccessFilters((prev) => ({ ...prev, issue_category: event.target.value }))}
            >
              <option value="">All Issue Types</option>
              {accountAccessCategories.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <div className="it-filter-action-stack">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setAccountAccessPage(1);
                  loadAccountAccessTickets(accountAccessFilters, 'account-filter');
                }}
              >
                <RefreshCw size={16} /> Apply
              </button>

              <ITSupportInlineMessage
                feedback={inlineFeedback['account-filter']}
                onClose={() => clearInlineFeedback('account-filter')}
              />
            </div>
          </div>

          {accountAccessLoading ? (
            <div className="empty-state"><Loader2 className="spin" size={28} /><p>Loading account-access requests...</p></div>
          ) : accountAccessTickets.length ? (
            <>
              <ITPagination
                total={accountAccessTickets.length}
                page={Math.min(accountAccessPage, accountAccessPageCount)}
                pageSize={accountAccessPageSize}
                onPageChange={setAccountAccessPage}
                onPageSizeChange={(value) => {
                  setAccountAccessPage(1);
                  setAccountAccessPageSize(value);
                }}
                label="account-access requests"
              />

              <div className="account-access-list">
              {pagedAccountAccessTickets.map((ticket) => {
                const id = ticket.ticket_id || ticket.ticket_no || ticket._id;
                const draft = {
                  status: ticket.status || 'open',
                  assigned_to_name: ticket.assigned_to_name || '',
                  latest_update: ticket.latest_update || ticket.status_note || '',
                  resolution_remarks: ticket.resolution_remarks || ticket.resolution_note || '',
                  ...(accountAccessDrafts[id] || {}),
                };

                return (
                  <article key={id} className="account-access-ticket">
                    <div className="account-access-ticket-head">
                      <strong>{id}</strong>
                      <span className={`pill ${statusClass(ticket.status)}`}>{accountAccessStatusLabel(ticket.status)}</span>
                    </div>
                    <h3>{ticket.subject || 'Account access assistance'}</h3>
                    <p>{ticket.description || ticket.issue_description || 'No description provided.'}</p>
                    <div className="account-access-ticket-meta">
                      <span>{ticket.employee_name || 'Employee'}</span>
                      <span>{ticket.employee_code || '—'}</span>
                      <span>{ticket.department || '—'}</span>
                      <span>{ticket.email || ticket.employee_email || '—'}</span>
                      <span>{formatDate(ticket.created_at || ticket.submitted_at)}</span>
                    </div>

                    <div className="account-access-editor">
                      <div className="account-access-editor-grid">
                        <label>
                          <span>Status</span>
                          <select value={draft.status} onChange={(event) => updateAccountAccessDraft(ticket, 'status', event.target.value)}>
                            {['open', 'assigned', 'in_progress', 'resolved', 'closed', 'rejected', 'reopened'].map((status) => (
                              <option key={status} value={status}>{accountAccessStatusLabel(status)}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Assigned To</span>
                          <input value={draft.assigned_to_name} onChange={(event) => updateAccountAccessDraft(ticket, 'assigned_to_name', event.target.value)} placeholder="IT Head or support member" />
                        </label>
                      </div>
                      <label>
                        <span>Latest Update</span>
                        <textarea rows={3} value={draft.latest_update} onChange={(event) => updateAccountAccessDraft(ticket, 'latest_update', event.target.value)} placeholder="Progress visible to the employee" />
                      </label>
                      <label>
                        <span>Resolution Remarks</span>
                        <textarea rows={3} value={draft.resolution_remarks} onChange={(event) => updateAccountAccessDraft(ticket, 'resolution_remarks', event.target.value)} placeholder="Required when resolving the issue" />
                      </label>
                      <div className="account-access-ticket-actions">
                        <small>The employee will receive email updates when the backend notification service is enabled.</small>

                        <div className="it-account-action-stack">
                          <button
                            type="button"
                            className="primary"
                            disabled={accountAccessSaving === id}
                            onClick={() => saveAccountAccessTicket(ticket)}
                          >
                            {accountAccessSaving === id ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
                            Save Update
                          </button>

                          <ITSupportInlineMessage
                            feedback={inlineFeedback[`account-save:${id}`]}
                            onClose={() => clearInlineFeedback(`account-save:${id}`)}
                          />
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              </div>
            </>
          ) : (
            <div className="empty-state"><ShieldAlert size={30} /><p>No account-access requests found.</p></div>
          )}
        </section>
      ) : null}

      {activeSection === 'desk' && canSeeDesk ? (
        <section className="it-section-content panel grievance-list-panel">
          <div className="section-heading">
            <div>
              <h2>
                {superAdminEscalatedAccess
                  ? 'Escalated IT Support'
                  : 'IT Department Support Desk'}
              </h2>
              <p>
                {superAdminEscalatedAccess
                  ? 'Only tickets escalated by tenant IT Department Team Leaders are shown here.'
                  : manageAccess
                    ? 'Assign, reassign, monitor and escalate tenant IT support tickets.'
                    : 'View IT Department tickets and update tickets assigned to you.'}
              </p>
            </div>
            <Headphones size={22} />
          </div>

          <div className="it-team-strip">
            <div>
              <Users size={18} />
              <span>
                {superAdminEscalatedAccess ? 'Escalation Desk' : 'IT Department Team'}
              </span>
            </div>

            <strong>
              {superAdminEscalatedAccess
                ? stats.escalated
                : `${options.team_slots?.current_total || 0}/${options.team_slots?.expected_total || 4}`}
            </strong>

            <small>
              {superAdminEscalatedAccess
                ? 'Super Admin receives only escalated software/server/major issue tickets.'
                : options.team_slots?.empty_slots > 0
                  ? `${options.team_slots.empty_slots} empty IT team slot available`
                  : 'All IT team slots filled'}
            </small>
          </div>

          <div className="filter-bar">
            <div className="filter-label">
              <Filter size={16} />
              <span>Filters</span>
            </div>

            <select
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
            >
              <option value="">All Status</option>
              {options.statuses.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <select
              value={filters.priority}
              onChange={(event) => updateFilter('priority', event.target.value)}
            >
              <option value="">All Priority</option>
              {options.priorities.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <select
              value={filters.issue_category}
              onChange={(event) => updateFilter('issue_category', event.target.value)}
            >
              <option value="">All Categories</option>
              {options.categories.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            {manageAccess ? (
              <select
                value={filters.assigned_to}
                onChange={(event) => updateFilter('assigned_to', event.target.value)}
              >
                <option value="">All Assignments</option>
                <option value="unassigned">Unassigned</option>
                {options.it_team.map((member) => (
                  <option key={member.id || member._id} value={member.id || member._id}>
                    {member.employee_name || member.name}
                  </option>
                ))}
              </select>
            ) : null}

            <input
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="Search ticket..."
            />

            <div className="it-filter-action-stack">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setDeskPage(1);
                  loadTeamTickets('desk-filter');
                }}
              >
                Apply
              </button>

              <ITSupportInlineMessage
                feedback={inlineFeedback['desk-filter']}
                onClose={() => clearInlineFeedback('desk-filter')}
              />
            </div>
          </div>

          {loading ? (
            <div className="empty-state">
              <Loader2 className="spin" size={28} />
              <p>Loading IT support desk...</p>
            </div>
          ) : deskTicketRows.length ? (
            <>
              <ITPagination
                total={deskTicketRows.length}
                page={Math.min(deskPage, deskPageCount)}
                pageSize={deskPageSize}
                onPageChange={setDeskPage}
                onPageSizeChange={(value) => {
                  setDeskPage(1);
                  setDeskPageSize(value);
                }}
                label="support tickets"
              />

              <div className="ticket-list">
                {pagedDeskTicketRows.map((ticket) => renderTicketCard(ticket, 'desk'))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Headphones size={30} />
              <p>No IT support desk tickets found.</p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}