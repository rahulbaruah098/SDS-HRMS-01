import { useEffect, useMemo, useState } from 'react';
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
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DEFAULT_ESCALATION_TYPES = [
  { value: 'software_application', label: 'Software / Application Problem' },
  { value: 'server_issue', label: 'Server Issue' },
  { value: 'database_issue', label: 'Database Issue' },
  { value: 'network_infrastructure', label: 'Network / Infrastructure Major Issue' },
  { value: 'security_issue', label: 'Security Issue' },
  { value: 'major_problem', label: 'Other Major Problem' },
];

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
  --it-violet: #6658dc;
  --it-violet-deep: #40348d;
  --it-blue: #3766db;
  --it-cyan: #18b5c8;
  --it-teal: #34c9c4;
  --it-yellow: #d8ff43;
  --it-danger: #d84d68;
  --it-line: rgba(16, 26, 58, .14);
  display: grid !important;
  gap: clamp(18px, 2vw, 26px) !important;
  width: 100% !important;
  min-width: 0 !important;
  color: var(--it-ink);
}

.it-support-page,
.it-support-page * {
  box-sizing: border-box;
}

.it-support-page input,
.it-support-page select,
.it-support-page textarea,
.it-support-page button {
  font: inherit;
  max-width: 100%;
}

.it-support-page .grievance-hero.it-hero {
  position: relative !important;
  isolation: isolate;
  overflow: hidden !important;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto !important;
  gap: clamp(22px, 3vw, 40px) !important;
  align-items: center !important;
  min-height: 275px !important;
  padding: clamp(25px, 3vw, 42px) !important;
  border: 1px solid rgba(154,164,205,.58) !important;
  border-radius: clamp(28px, 2.7vw, 40px) !important;
  background:
    radial-gradient(circle at 8% 6%, rgba(105,217,208,.26), transparent 29%),
    radial-gradient(circle at 95% 4%, rgba(153,164,245,.24), transparent 31%),
    linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%) !important;
  box-shadow:
    12px 14px 0 #c6d8f7,
    0 28px 48px rgba(34,38,110,.13) !important;
}

.it-support-page .grievance-hero.it-hero::before {
  content: "";
  position: absolute;
  z-index: -1;
  width: 175px;
  height: 175px;
  right: 8%;
  bottom: -98px;
  border-radius: 38% 62% 58% 42% / 48% 43% 57% 52%;
  background: linear-gradient(145deg, rgba(105,217,208,.30), rgba(132,181,241,.28));
  transform: rotate(-18deg);
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
  background: #342b78 !important;
  box-shadow: 4px 5px 0 #18b5c8 !important;
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
  background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8) !important;
  box-shadow: 5px 6px 0 #a9d6f5, 0 14px 25px rgba(36,74,128,.16) !important;
}

.it-support-page .ghost-btn,
.it-support-page .secondary {
  min-height: 44px !important;
  padding: 9px 14px !important;
  border: 1px solid rgba(65,55,161,.18) !important;
  color: #40348d !important;
  background: rgba(255,255,255,.92) !important;
  box-shadow: 3px 4px 0 rgba(52,43,120,.10) !important;
}

.it-support-page .danger {
  min-height: 44px !important;
  padding: 9px 14px !important;
  border: 1px solid rgba(216,77,104,.22) !important;
  color: #a2344d !important;
  background: #fff0f2 !important;
  box-shadow: 3px 4px 0 #f2c2cc !important;
}

.it-support-page .ghost-btn.active,
.it-support-page .ticket-actions .ghost-btn.active {
  color: #fff !important;
  background: #342b78 !important;
  border-color: transparent !important;
  box-shadow: 4px 5px 0 #18b5c8 !important;
}

.it-support-page .it-support-refresh-btn {
  min-height: 54px !important;
  padding-inline: 18px !important;
  box-shadow: 6px 7px 0 #b9d7ff, 0 14px 25px rgba(44,75,116,.10) !important;
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
  grid-template-columns: minmax(380px, .86fr) minmax(0, 1.14fr) !important;
  gap: 22px !important;
  align-items: start !important;
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
  background: linear-gradient(145deg, #ffffff, #f7fbff) !important;
  box-shadow: 8px 10px 0 #c4ccff, 0 24px 42px rgba(34,38,110,.10) !important;
}

.it-support-page .grievance-form-panel,
.it-support-page .it-my-ticket-summary-panel,
.it-support-page > .grievance-list-panel {
  padding: clamp(20px, 2vw, 28px) !important;
}

.it-support-page .section-heading {
  display: flex !important;
  align-items: flex-start !important;
  justify-content: space-between !important;
  gap: 16px !important;
  margin-bottom: 18px !important;
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
  background: linear-gradient(145deg, #edf6ff, #f1efff) !important;
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
  gap: 10px !important;
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
  gap: 18px !important;
  align-items: center !important;
  padding: 20px !important;
  background: linear-gradient(145deg, #edf6ff, #f1efff) !important;
  box-shadow: 5px 6px 0 #c9c0ff !important;
}

.it-support-page .it-my-ticket-summary-icon {
  width: 68px !important;
  height: 68px !important;
  display: grid !important;
  place-items: center !important;
  border-radius: 22px !important;
  color: #fff !important;
  background: linear-gradient(145deg, #6658dc, #18b5c8) !important;
  box-shadow: 4px 5px 0 #b9d7ff !important;
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
  grid-template-columns: auto repeat(4, minmax(130px, 1fr)) minmax(170px, 1.2fr) auto !important;
  gap: 10px !important;
  align-items: center !important;
  margin: 0 0 18px !important;
  padding: 13px !important;
  background: linear-gradient(145deg, #f8fbff, #f7f4ff) !important;
}

.it-support-page .account-access-toolbar {
  grid-template-columns: minmax(180px, 1fr) repeat(2, minmax(150px, .6fr)) auto !important;
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
  background: linear-gradient(145deg, #ffffff, #f7fbff) !important;
  box-shadow: 5px 6px 0 rgba(52,43,120,.08) !important;
  transition:
    transform 190ms ease,
    box-shadow 190ms ease,
    border-color 190ms ease !important;
}

.it-support-page .it-ticket-card:nth-child(3n + 1),
.it-support-page .account-access-ticket:nth-child(3n + 1) {
  background: linear-gradient(145deg, #edf6ff, #ffffff) !important;
  box-shadow: 5px 6px 0 #b9d7ff !important;
}

.it-support-page .it-ticket-card:nth-child(3n + 2),
.it-support-page .account-access-ticket:nth-child(3n + 2) {
  background: linear-gradient(145deg, #eaf8f4, #ffffff) !important;
  box-shadow: 5px 6px 0 #aee6d9 !important;
}

.it-support-page .it-ticket-card:nth-child(3n + 3),
.it-support-page .account-access-ticket:nth-child(3n + 3) {
  background: linear-gradient(145deg, #f1efff, #ffffff) !important;
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
.it-support-page .account-access-ticket-meta,
.it-support-page .account-access-ticket-actions {
  display: flex !important;
  align-items: flex-start !important;
  justify-content: space-between !important;
  gap: 10px !important;
  flex-wrap: wrap !important;
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
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 9px !important;
  margin-top: 15px !important;
}

.it-support-page .it-context-panel,
.it-support-page .account-access-editor {
  display: grid !important;
  gap: 12px !important;
  margin-top: 14px !important;
  padding: 15px !important;
  border: 1px solid rgba(102,88,220,.22) !important;
  border-radius: 19px !important;
  background: linear-gradient(145deg, #f1efff, #eef9ff) !important;
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
  color: #c27a00;
  background: #fff4d5;
  border-color: #ffe0a5;
  box-shadow: 3px 4px 0 #ffe0a5;
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
  background:
    radial-gradient(circle at 0% 0%, rgba(105,217,208,.12), transparent 26%),
    radial-gradient(circle at 100% 0%, rgba(102,88,220,.10), transparent 28%),
    #fff !important;
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
  border: 1px solid rgba(102,88,220,.18);
  color: #40348d;
  background: #fff;
  box-shadow: 3px 4px 0 rgba(52,43,120,.08);
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
  margin-top: 20px;
}

.it-support-page .account-access-ticket-meta {
  justify-content: flex-start !important;
  margin-top: 12px;
  color: var(--it-copy);
  font-size: 12px;
}

@media (max-width: 1366px) {
  .it-support-page .grievance-stats {
    grid-template-columns: repeat(3, minmax(0,1fr)) !important;
  }

  .it-support-page .filter-bar {
    grid-template-columns: auto repeat(2, minmax(140px,1fr)) !important;
  }
}

@media (max-width: 1180px) {
  .it-support-page .it-support-grid,
  .it-support-page .grievance-grid.it-support-grid {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 900px) {
  .it-support-page .filter-bar,
  .it-support-page .account-access-toolbar {
    grid-template-columns: repeat(2, minmax(0,1fr)) !important;
  }

  .it-support-page .filter-label,
  .it-support-page .filter-bar input,
  .it-support-page .filter-bar .ghost-btn,
  .it-support-page .account-access-toolbar input,
  .it-support-page .account-access-toolbar button {
    grid-column: 1 / -1 !important;
  }

  .it-support-page .ticket-meta-grid {
    grid-template-columns: repeat(2, minmax(0,1fr)) !important;
  }
}

@media (max-width: 760px) {
  .it-support-page {
    gap: 16px !important;
  }

  .it-support-page .grievance-hero.it-hero {
    grid-template-columns: 1fr !important;
    min-height: 0 !important;
    padding: 20px !important;
    border-radius: 26px !important;
    box-shadow: 6px 7px 0 #c6d8f7, 0 18px 30px rgba(34,38,110,.10) !important;
  }

  .it-support-page .it-hero h1 {
    font-size: clamp(36px,10vw,52px) !important;
  }

  .it-support-page .grievance-hero-actions,
  .it-support-page .grievance-hero-actions .ghost-btn {
    width: 100%;
  }

  .it-support-page .grievance-stats {
    grid-template-columns: repeat(2, minmax(0,1fr)) !important;
  }

  .it-support-page .grievance-form-panel,
  .it-support-page .it-my-ticket-summary-panel,
  .it-support-page > .grievance-list-panel {
    padding: 18px !important;
    border-radius: 22px !important;
    box-shadow: 5px 6px 0 #c4ccff, 0 17px 28px rgba(34,38,110,.09) !important;
  }

  .it-support-page .profile-prefill-grid,
  .it-support-page .form-row.two,
  .it-support-page .ticket-meta-grid,
  .it-support-page .it-context-form,
  .it-support-page .account-access-editor-grid,
  .it-support-page .filter-bar,
  .it-support-page .account-access-toolbar {
    grid-template-columns: 1fr !important;
  }

  .it-support-page .filter-label,
  .it-support-page .filter-bar input,
  .it-support-page .filter-bar .ghost-btn,
  .it-support-page .account-access-toolbar input,
  .it-support-page .account-access-toolbar button {
    grid-column: auto !important;
  }

  .it-support-page .it-my-ticket-summary-card {
    grid-template-columns: 1fr !important;
  }

  .it-support-page .ticket-topline {
    flex-direction: column;
  }

  .it-support-page .ticket-badges {
    justify-content: flex-start;
  }

  .it-support-page .ticket-actions {
    display: grid !important;
    grid-template-columns: 1fr !important;
  }

  .it-support-page .ticket-actions .ghost-btn,
  .it-support-page .ticket-actions .primary,
  .it-support-page .ticket-actions .secondary,
  .it-support-page .ticket-actions .danger {
    width: 100%;
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
    grid-template-columns: 1fr !important;
    padding: 12px 14px !important;
  }

  .it-support-page .it-sheet-stats > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .it-support-page .it-sheet-stats strong {
    margin-top: 0;
  }

  .it-support-page .it-sheet-body {
    padding: 14px 14px calc(18px + env(safe-area-inset-bottom,0px)) !important;
  }
}

@media (max-width: 430px) {
  .it-support-page .grievance-hero.it-hero {
    padding: 16px !important;
  }

  .it-support-page .it-hero h1 {
    font-size: clamp(32px,11vw,44px) !important;
  }

  .it-support-page .grievance-stats {
    grid-template-columns: 1fr !important;
  }

  .it-support-page .mini-stat-card {
    min-height: 76px !important;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .it-support-page .mini-stat-card strong {
    margin-top: 0;
  }

  .it-support-page .section-heading {
    flex-direction: column;
  }

  .it-support-page .it-team-strip {
    grid-template-columns: 1fr !important;
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
  const alerts = useCustomAlert();

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


async function loadAccountAccessTickets(nextFilters = accountAccessFilters) {
  if (!canManageAccountAccess) return;

  setAccountAccessLoading(true);
  try {
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (normalizeText(value)) params.set(key, normalizeText(value));
    });
    params.set('limit', '100');

    const response = await api(`/account-access/requests?${params.toString()}`);
    const payload = response?.data || response || {};
    const rows = payload.items || payload.requests || payload.tickets || [];
    setAccountAccessTickets(Array.isArray(rows) ? rows : []);
  } catch (err) {
    alerts.error(err.message || 'Unable to load account-access requests.', 'Account Access Load Failed');
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
  const draft = {
    status: ticket.status || 'open',
    assigned_to_name: ticket.assigned_to_name || '',
    latest_update: ticket.latest_update || ticket.status_note || '',
    resolution_remarks: ticket.resolution_remarks || ticket.resolution_note || '',
    ...(accountAccessDrafts[id] || {}),
  };

  if (draft.status === 'resolved' && !normalizeText(draft.resolution_remarks)) {
    alerts.warning('Resolution remarks are required before resolving the request.', 'Resolution Required');
    return;
  }

  setAccountAccessSaving(id);
  try {
    await api(`/account-access/requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(draft),
    });
    alerts.success('Account-access request updated successfully.', 'Request Updated');
    await loadAccountAccessTickets();
  } catch (err) {
    alerts.error(err.message || 'Unable to update account-access request.', 'Update Failed');
  } finally {
    setAccountAccessSaving('');
  }
}

async function loadData() {
  setLoading(true);

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
  } catch (err) {
    alerts.error(err.message || 'Unable to load IT support data.', 'IT Support Load Failed');
  } finally {
    setLoading(false);
  }
}

async function loadTeamTickets() {
    if (!canSeeDesk) return;

    setLoading(true);

    try {
      const data = await getItSupportTickets(filters);
      setTeamTickets(data.tickets || []);
      applyPermissionData(data);

      setOptions((prev) => ({
        ...prev,
        it_team: data.it_team || prev.it_team,
        it_heads: data.it_heads || prev.it_heads,
        team_slots: data.team_slots || prev.team_slots,
      }));
    } catch (err) {
      alerts.error(err.message || 'Unable to load IT support tickets.', 'Ticket Load Failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTicket(event) {
    event.preventDefault();

    if (!normalizeText(ticketForm.subject)) {
      alerts.warning('Subject is required.', 'Missing Subject');
      return;
    }

    if (!normalizeText(ticketForm.description)) {
      alerts.warning('Description is required.', 'Missing Description');
      return;
    }

    setSaving(true);

    try {
      await createItSupportTicket({
        issue_category: ticketForm.issue_category,
        priority: ticketForm.priority,
        subject: normalizeText(ticketForm.subject),
        description: normalizeText(ticketForm.description),
      });

      setTicketForm(emptyTicketForm);
      alerts.success('IT support ticket submitted successfully to the IT Department.', 'Ticket Submitted');
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to submit IT support ticket.', 'Ticket Submit Failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign(event) {
    event.preventDefault();

    if (!selectedTicket) {
      alerts.warning('Please select a ticket first.', 'Ticket Required');
      return;
    }

    if (!assignForm.assigned_to_employee_id) {
      alerts.warning('Please select an IT Department member.', 'Assignee Required');
      return;
    }

    setPanelSaving(true);

    try {
      await assignItSupportTicket(ticketId(selectedTicket), assignForm);
      alerts.success('IT support ticket assigned successfully.', 'Ticket Assigned');
      closePanel();
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to assign ticket.', 'Assignment Failed');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleStatusUpdate(event) {
    event.preventDefault();

    if (!selectedTicket) {
      alerts.warning('Please select a ticket first.', 'Ticket Required');
      return;
    }

    if (statusForm.status === 'resolved' && !normalizeText(statusForm.resolution_note || statusForm.status_note)) {
      alerts.warning('Resolution note is required before marking ticket as resolved.', 'Resolution Note Required');
      return;
    }

    setPanelSaving(true);

    try {
      await updateItSupportTicketStatus(ticketId(selectedTicket), statusForm);
      alerts.success(
        statusForm.status === 'resolved'
          ? 'Ticket marked as resolved. The requester can now give a review from My IT Tickets.'
          : 'IT support ticket status updated successfully.',
        statusForm.status === 'resolved' ? 'Ticket Resolved' : 'Status Updated',
      );
      closePanel();
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to update ticket status.', 'Status Update Failed');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleEscalate(event) {
    event.preventDefault();

    if (!selectedTicket) {
      alerts.warning('Please select a ticket first.', 'Ticket Required');
      return;
    }

    if (!normalizeText(escalationForm.escalation_reason)) {
      alerts.warning('Escalation reason is required.', 'Escalation Reason Required');
      return;
    }

    setPanelSaving(true);

    try {
      await escalateItSupportTicket(ticketId(selectedTicket), {
        escalation_type: escalationForm.escalation_type,
        escalation_reason: normalizeText(escalationForm.escalation_reason),
      });

      alerts.success('IT support ticket escalated to Super Admin successfully.', 'Ticket Escalated');
      closePanel();
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to escalate ticket.', 'Escalation Failed');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleReview(event) {
    event.preventDefault();

    if (!selectedTicket) {
      alerts.warning('Please select a ticket first.', 'Ticket Required');
      return;
    }

    setPanelSaving(true);

    try {
      await reviewItSupportTicket(ticketId(selectedTicket), reviewForm);
      alerts.success('Review submitted successfully. The IT support ticket is now closed.', 'Review Submitted');
      closePanel();
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to submit review.', 'Review Submit Failed');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleReopen(event) {
    event.preventDefault();

    if (!selectedTicket) {
      alerts.warning('Please select a ticket first.', 'Ticket Required');
      return;
    }

    if (!normalizeText(reopenForm.reason)) {
      alerts.warning('Reopen reason is required.', 'Reopen Reason Required');
      return;
    }

    setPanelSaving(true);

    try {
      await reopenItSupportTicket(ticketId(selectedTicket), reopenForm);
      alerts.success('IT support ticket reopened successfully.', 'Ticket Reopened');
      closePanel();
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to reopen ticket.', 'Reopen Failed');
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
    if (!showMyTicketsSheet) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showMyTicketsSheet]);

  const rows = profileRows(profile);

  return (
    <div className="it-support-page">
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
          <button type="button" className="ghost-btn it-support-refresh-btn" onClick={loadData}>
            <RefreshCw size={16} />
            Refresh
          </button>
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

      <div className="grievance-grid it-support-grid">
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

            <button type="submit" className="primary" disabled={saving}>
              {saving ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
              Submit IT Ticket
            </button>
          </form>
        </section>

<section className="panel grievance-list-panel it-my-ticket-summary-panel">
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
            </div>
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
                      <div className="ticket-list">
                        {myTicketRows.map((ticket) => renderTicketCard(ticket, 'my'))}
                      </div>
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

      {canManageAccountAccess ? (
        <section className="panel grievance-list-panel account-access-desk">
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
            <button type="button" className="ghost-btn" onClick={() => loadAccountAccessTickets()}>
              <RefreshCw size={16} /> Apply
            </button>
          </div>

          {accountAccessLoading ? (
            <div className="empty-state"><Loader2 className="spin" size={28} /><p>Loading account-access requests...</p></div>
          ) : accountAccessTickets.length ? (
            <div className="account-access-list">
              {accountAccessTickets.map((ticket) => {
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
                        <button type="button" className="primary" disabled={accountAccessSaving === id} onClick={() => saveAccountAccessTicket(ticket)}>
                          {accountAccessSaving === id ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
                          Save Update
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state"><ShieldAlert size={30} /><p>No account-access requests found.</p></div>
          )}
        </section>
      ) : null}

      {canSeeDesk ? (
        <section className="panel grievance-list-panel">
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

            <button type="button" className="ghost-btn" onClick={loadTeamTickets}>
              Apply
            </button>
          </div>

          {loading ? (
            <div className="empty-state">
              <Loader2 className="spin" size={28} />
              <p>Loading IT support desk...</p>
            </div>
          ) : deskTicketRows.length ? (
            <div className="ticket-list">
              {deskTicketRows.map((ticket) => renderTicketCard(ticket, 'desk'))}
            </div>
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