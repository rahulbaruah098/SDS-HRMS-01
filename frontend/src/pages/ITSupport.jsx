import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
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
  Star,
  UserCheck,
  Users,
  Wrench,
} from 'lucide-react';

import {
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
  from {
    opacity: 0;
    transform: translateX(34px) scale(.985);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes itSummaryFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

.it-support-page .it-my-ticket-summary-panel {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.it-support-page .it-my-ticket-summary-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 16px;
  align-items: center;
  padding: 20px;
  border: 1px solid rgba(199, 210, 254, .95);
  border-radius: 24px;
  background:
    radial-gradient(circle at 100% 0%, rgba(79, 70, 229, .12), transparent 34%),
    linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 60%, #EEF2FF 100%);
  box-shadow: 0 18px 46px rgba(15, 23, 42, .075);
}

.it-support-page .it-my-ticket-summary-icon {
  width: 62px;
  height: 62px;
  display: inline-grid;
  place-items: center;
  border-radius: 22px;
  color: #4F46E5;
  background: #EEF2FF;
  box-shadow: inset 0 0 0 1px rgba(79, 70, 229, .14);
  animation: itSummaryFloat 3.4s ease-in-out infinite;
}

.it-support-page .it-my-ticket-summary-copy {
  min-width: 0;
}

.it-support-page .it-my-ticket-summary-copy span {
  display: block;
  color: #64748B;
  font-size: 12px;
  font-weight: 950;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.it-support-page .it-my-ticket-summary-copy strong {
  display: block;
  margin-top: 5px;
  color: #0F172A;
  font-size: clamp(34px, 4vw, 54px);
  line-height: 1;
  letter-spacing: -.055em;
}

.it-support-page .it-my-ticket-summary-copy p {
  margin: 8px 0 0;
  color: #64748B;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.it-support-page .it-my-ticket-summary-actions {
  margin-top: auto;
}

.it-support-page .it-my-ticket-summary-actions .primary {
  width: 100%;
  min-height: 52px;
  justify-content: center;
  border-radius: 17px;
}

.it-support-page .it-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: flex;
  justify-content: flex-end;
  padding: max(14px, env(safe-area-inset-top, 0px)) max(14px, env(safe-area-inset-right, 0px)) max(14px, env(safe-area-inset-bottom, 0px)) max(14px, env(safe-area-inset-left, 0px));
  background: rgba(15, 23, 42, .45);
  backdrop-filter: blur(8px);
  animation: itSheetFadeIn .18s ease both;
}

.it-support-page .it-my-ticket-sheet {
  width: min(860px, 100%);
  max-width: calc(100vw - 28px);
  height: calc(100dvh - 28px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(226, 232, 240, .95);
  border-radius: 30px;
  background:
    radial-gradient(circle at 100% 0%, rgba(79, 70, 229, .10), transparent 34%),
    linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 68%, #EEF2FF 100%);
  box-shadow: 0 30px 90px rgba(15, 23, 42, .28);
  animation: itSheetSlideIn .28s cubic-bezier(.2, .8, .2, 1) both;
}

.it-support-page .it-sheet-header {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px;
  border-bottom: 1px solid rgba(226, 232, 240, .92);
  background: rgba(255, 255, 255, .78);
  backdrop-filter: blur(12px);
}

.it-support-page .it-sheet-header h2 {
  margin: 7px 0 6px;
  color: #0F172A;
  font-size: clamp(25px, 3vw, 38px);
  line-height: 1.08;
  letter-spacing: -.045em;
}

.it-support-page .it-sheet-header p {
  margin: 0;
  max-width: 620px;
  color: #64748B;
  line-height: 1.55;
}

.it-support-page .it-sheet-header .icon-btn {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  display: inline-grid;
  place-items: center;
  border: 1px solid rgba(203, 213, 225, .95);
  border-radius: 16px;
  color: #334155;
  background: #FFFFFF;
  font-size: 26px;
  font-weight: 950;
  line-height: 1;
  cursor: pointer;
  transition: transform .18s ease, color .18s ease, border-color .18s ease, background .18s ease;
}

.it-support-page .it-sheet-header .icon-btn:hover {
  transform: rotate(90deg);
  color: #B91C1C;
  border-color: rgba(248, 113, 113, .55);
  background: #FEF2F2;
}

.it-support-page .it-sheet-stats {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(226, 232, 240, .88);
}

.it-support-page .it-sheet-stats > div {
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid rgba(226, 232, 240, .95);
  border-radius: 20px;
  background: rgba(255, 255, 255, .92);
}

.it-support-page .it-sheet-stats span {
  display: block;
  color: #64748B;
  font-size: 11px;
  font-weight: 950;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.it-support-page .it-sheet-stats strong {
  display: block;
  margin-top: 7px;
  color: #0F172A;
  font-size: clamp(24px, 2.3vw, 34px);
  line-height: 1;
  letter-spacing: -.045em;
}

.it-support-page .it-sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 20px 24px 24px;
}

.it-support-page .it-sheet-body .ticket-list {
  display: grid;
  gap: 16px;
}

.it-support-page .it-sheet-body .it-ticket-card {
  box-shadow: 0 14px 36px rgba(15, 23, 42, .07);
}

@media (max-width: 920px) {
  .it-support-page .it-sheet-backdrop {
    padding: 10px;
  }

  .it-support-page .it-my-ticket-sheet {
    width: 100%;
    max-width: 100%;
    height: calc(100dvh - 20px);
    border-radius: 26px;
  }

  .it-support-page .it-sheet-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding-inline: 18px;
  }

  .it-support-page .it-sheet-header,
  .it-support-page .it-sheet-body {
    padding-inline: 18px;
  }
}

@media (max-width: 720px) {
  @keyframes itSheetSlideInMobile {
    from {
      opacity: 0;
      transform: translateY(28px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .it-support-page .it-my-ticket-summary-card {
    grid-template-columns: 1fr;
    gap: 12px;
    padding: 16px;
    border-radius: 20px;
  }

  .it-support-page .it-my-ticket-summary-icon {
    width: 54px;
    height: 54px;
    border-radius: 18px;
  }

  .it-support-page .it-sheet-backdrop {
    align-items: flex-end;
    padding: 0;
  }

  .it-support-page .it-my-ticket-sheet {
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 24px 24px 0 0;
    border-bottom: 0;
    animation: itSheetSlideInMobile .26s cubic-bezier(.2, .8, .2, 1) both;
  }

  .it-support-page .it-sheet-header {
    padding: calc(16px + env(safe-area-inset-top, 0px)) 14px 14px;
  }

  .it-support-page .it-sheet-header h2 {
    font-size: 26px;
  }

  .it-support-page .it-sheet-header p {
    font-size: 13px;
  }

  .it-support-page .it-sheet-stats {
    grid-template-columns: 1fr;
    gap: 9px;
    padding: 12px 14px;
  }

  .it-support-page .it-sheet-stats > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 16px;
  }

  .it-support-page .it-sheet-stats strong {
    margin-top: 0;
    font-size: 24px;
  }

  .it-support-page .it-sheet-body {
    padding: 14px 14px calc(18px + env(safe-area-inset-bottom, 0px));
  }
}

@media (max-width: 420px) {
  .it-support-page .it-sheet-header {
    gap: 10px;
  }

  .it-support-page .it-sheet-header .icon-btn {
    width: 40px;
    height: 40px;
    border-radius: 14px;
  }

  .it-support-page .it-sheet-header h2 {
    font-size: 23px;
  }
}


/* =========================================================
   PRO RESPONSIVE IT SUPPORT DASHBOARD OVERRIDES
   Keeps existing API/workflow untouched. Overrides only UI.
   ========================================================= */
@keyframes itProPageIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes itProCardIn { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes itProPanelIn { from { opacity: 0; transform: translateY(-8px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }

.it-support-page {
  --it-ink: #0F172A;
  --it-text: #334155;
  --it-muted: #64748B;
  --it-line: #E2E8F0;
  --it-line2: #CBD5E1;
  --it-primary: #4F46E5;
  --it-primary2: #2563EB;
  --it-cyan: #06B6D4;
  --it-success: #059669;
  --it-warning: #D97706;
  --it-danger: #DC2626;
  --it-shadow: 0 18px 52px rgba(15, 23, 42, .08);
  --it-shadow-strong: 0 26px 78px rgba(15, 23, 42, .14);
  display: grid !important;
  gap: clamp(16px, 1.6vw, 24px) !important;
  width: 100% !important;
  min-width: 0 !important;
  animation: itProPageIn .28s cubic-bezier(.2,.8,.2,1) both;
}

.it-support-page,
.it-support-page * { box-sizing: border-box; }
.it-support-page input,
.it-support-page select,
.it-support-page textarea,
.it-support-page button { font: inherit; max-width: 100%; }

.it-support-page .grievance-hero.it-hero {
  position: relative !important;
  isolation: isolate;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto !important;
  gap: 18px !important;
  align-items: center !important;
  min-height: auto !important;
  padding: clamp(20px, 2.4vw, 34px) !important;
  border: 1px solid rgba(191, 219, 254, .85) !important;
  border-radius: 32px !important;
  overflow: hidden !important;
  background:
    radial-gradient(circle at 92% 12%, rgba(79, 70, 229, .18), transparent 28%),
    radial-gradient(circle at 0% 0%, rgba(6, 182, 212, .13), transparent 32%),
    linear-gradient(135deg, rgba(255,255,255,.98) 0%, rgba(248,250,252,.98) 52%, rgba(238,242,255,.98) 100%) !important;
  box-shadow: var(--it-shadow) !important;
}

.it-support-page .grievance-hero.it-hero::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image:
    linear-gradient(rgba(79,70,229,.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(79,70,229,.055) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: linear-gradient(90deg, #000 0%, transparent 78%);
}

.it-support-page .grievance-hero.it-hero::after {
  content: "";
  position: absolute;
  top: -72px;
  right: -58px;
  width: 210px;
  height: 210px;
  border-radius: 999px;
  background: radial-gradient(circle at 36% 36%, rgba(255,255,255,.95), rgba(79,70,229,.16) 46%, rgba(6,182,212,.12) 72%);
  z-index: -1;
}

.it-support-page .eyebrow {
  display: inline-flex !important;
  align-items: center !important;
  width: max-content !important;
  max-width: 100% !important;
  padding: 8px 12px !important;
  border: 1px solid rgba(79, 70, 229, .18) !important;
  border-radius: 999px !important;
  color: var(--it-primary) !important;
  background: rgba(238, 242, 255, .86) !important;
  font-size: 12px !important;
  font-weight: 950 !important;
  letter-spacing: .11em !important;
  text-transform: uppercase !important;
}

.it-support-page .it-hero h1 {
  margin: 12px 0 8px !important;
  color: var(--it-ink) !important;
  font-size: clamp(32px, 4.2vw, 58px) !important;
  line-height: .98 !important;
  letter-spacing: -.065em !important;
}

.it-support-page .it-hero p {
  max-width: 880px !important;
  margin: 0 !important;
  color: var(--it-muted) !important;
  font-size: clamp(14px, 1vw, 17px) !important;
  line-height: 1.65 !important;
}

.it-support-page .grievance-hero-actions { justify-content: flex-end !important; }

.it-support-page .ghost-btn,
.it-support-page .primary,
.it-support-page .secondary,
.it-support-page .danger {
  min-height: 44px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 9px !important;
  border-radius: 16px !important;
  cursor: pointer !important;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease, color .18s ease !important;
}

.it-support-page .primary {
  color: #FFFFFF !important;
  border: 0 !important;
  background: linear-gradient(135deg, var(--it-primary), var(--it-primary2)) !important;
  box-shadow: 0 16px 34px rgba(79, 70, 229, .22) !important;
  font-weight: 950 !important;
}

.it-support-page .ghost-btn {
  border: 1px solid rgba(203, 213, 225, .88) !important;
  color: var(--it-text) !important;
  background: rgba(255,255,255,.92) !important;
  box-shadow: 0 10px 24px rgba(15,23,42,.04) !important;
  font-weight: 900 !important;
}

.it-support-page .ghost-btn:hover,
.it-support-page .primary:hover { transform: translateY(-1px); }

.it-support-page .ghost-btn.active,
.it-support-page .ticket-actions .ghost-btn.active {
  border-color: transparent !important;
  color: #FFFFFF !important;
  background: linear-gradient(135deg, var(--it-primary), var(--it-primary2)) !important;
  box-shadow: 0 14px 34px rgba(79, 70, 229, .24) !important;
}

.it-support-page .grievance-stats {
  display: grid !important;
  grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
  gap: clamp(10px, 1vw, 16px) !important;
  margin: 0 !important;
}

.it-support-page .mini-stat-card {
  position: relative !important;
  min-width: 0 !important;
  min-height: 118px !important;
  overflow: hidden !important;
  padding: 18px !important;
  border: 1px solid rgba(226,232,240,.95) !important;
  border-radius: 24px !important;
  background: radial-gradient(circle at 100% 0%, rgba(79,70,229,.12), transparent 36%), #FFFFFF !important;
  box-shadow: var(--it-shadow) !important;
  animation: itProCardIn .3s cubic-bezier(.2,.8,.2,1) both;
}

.it-support-page .mini-stat-card:nth-child(2) { background: radial-gradient(circle at 100% 0%, rgba(14,165,233,.14), transparent 36%), #FFFFFF !important; }
.it-support-page .mini-stat-card:nth-child(3) { background: radial-gradient(circle at 100% 0%, rgba(245,158,11,.14), transparent 36%), #FFFFFF !important; }
.it-support-page .mini-stat-card:nth-child(4) { background: radial-gradient(circle at 100% 0%, rgba(20,184,166,.14), transparent 36%), #FFFFFF !important; }
.it-support-page .mini-stat-card:nth-child(5) { background: radial-gradient(circle at 100% 0%, rgba(34,197,94,.14), transparent 36%), #FFFFFF !important; }
.it-support-page .mini-stat-card:nth-child(6) { background: radial-gradient(circle at 100% 0%, rgba(236,72,153,.14), transparent 36%), #FFFFFF !important; }

.it-support-page .mini-stat-card::after {
  content: "";
  position: absolute;
  top: -36px;
  right: -24px;
  width: 86px;
  height: 86px;
  border-radius: 999px;
  background: rgba(79, 70, 229, .08);
}

.it-support-page .mini-stat-card span,
.it-support-page .mini-stat-card strong { position: relative; z-index: 1; }
.it-support-page .mini-stat-card span { display: block; color: var(--it-muted); font-size: 12px; font-weight: 950; letter-spacing: .09em; text-transform: uppercase; }
.it-support-page .mini-stat-card strong { display: block; margin-top: 12px; color: var(--it-ink); font-size: clamp(28px, 2.8vw, 42px); line-height: .95; letter-spacing: -.06em; }

.it-support-page .it-support-grid,
.it-support-page .grievance-grid.it-support-grid {
  display: grid !important;
  grid-template-columns: minmax(420px, .78fr) minmax(340px, 1fr) !important;
  gap: clamp(16px, 1.6vw, 24px) !important;
  align-items: start !important;
  margin: 0 !important;
}

.it-support-page .panel,
.it-support-page .grievance-form-panel,
.it-support-page .grievance-list-panel {
  min-width: 0 !important;
  width: 100% !important;
  height: auto !important;
  min-height: 0 !important;
  overflow: hidden !important;
  border: 1px solid rgba(226,232,240,.92) !important;
  border-radius: 32px !important;
  background: radial-gradient(circle at 100% 0%, rgba(79,70,229,.055), transparent 36%), rgba(255,255,255,.94) !important;
  box-shadow: var(--it-shadow) !important;
  backdrop-filter: blur(14px);
  animation: itProCardIn .32s cubic-bezier(.2,.8,.2,1) both;
}

.it-support-page .grievance-form-panel,
.it-support-page .it-my-ticket-summary-panel,
.it-support-page > .grievance-list-panel {
  padding: clamp(18px, 1.8vw, 26px) !important;
}

.it-support-page .section-heading {
  display: flex !important;
  align-items: flex-start !important;
  justify-content: space-between !important;
  gap: 16px !important;
  margin-bottom: 18px !important;
}

.it-support-page .section-heading h2 {
  margin: 0 0 6px !important;
  color: var(--it-ink) !important;
  font-size: clamp(22px, 2vw, 32px) !important;
  line-height: 1.08 !important;
  letter-spacing: -.055em !important;
}

.it-support-page .section-heading p { margin: 0 !important; max-width: 760px !important; color: var(--it-muted) !important; font-size: 14.5px !important; line-height: 1.55 !important; }
.it-support-page .section-heading > svg { flex: 0 0 auto; color: var(--it-primary); }

.it-support-page .profile-prefill-card {
  margin: 0 0 20px !important;
  padding: 18px !important;
  border: 1px solid rgba(226,232,240,.92) !important;
  border-radius: 26px !important;
  background: linear-gradient(135deg, rgba(248,250,252,.95), rgba(255,255,255,.98)) !important;
}

.it-support-page .profile-prefill-title { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; color: var(--it-primary); font-size: 13px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
.it-support-page .profile-prefill-grid { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 12px !important; }
.it-support-page .profile-prefill-grid > div,
.it-support-page .ticket-meta-grid > div,
.it-support-page .it-sheet-stats > div { min-width: 0; border: 1px solid rgba(226,232,240,.92) !important; border-radius: 18px !important; background: rgba(255,255,255,.92) !important; }
.it-support-page .profile-prefill-grid > div { padding: 13px 14px !important; }
.it-support-page .profile-prefill-grid span,
.it-support-page .ticket-meta-grid span,
.it-support-page .it-sheet-stats span { display: block; color: var(--it-muted); font-size: 11px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
.it-support-page .profile-prefill-grid strong,
.it-support-page .ticket-meta-grid strong { display: block; margin-top: 7px; color: var(--it-ink); font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }

.it-support-page .modern-form { display: grid !important; gap: 15px !important; }
.it-support-page .form-row.two { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 14px !important; }
.it-support-page .modern-form label { min-width: 0 !important; }
.it-support-page .modern-form label > span { display: block; margin: 0 0 8px; color: var(--it-text); font-size: 13px; font-weight: 950; }
.it-support-page .modern-form input,
.it-support-page .modern-form select,
.it-support-page .modern-form textarea,
.it-support-page .filter-bar input,
.it-support-page .filter-bar select {
  width: 100% !important;
  min-width: 0 !important;
  min-height: 50px !important;
  border: 1px solid var(--it-line2) !important;
  border-radius: 17px !important;
  padding: 12px 15px !important;
  color: var(--it-ink) !important;
  background: rgba(255,255,255,.96) !important;
  outline: none !important;
  box-shadow: none !important;
}
.it-support-page .modern-form textarea { min-height: 134px !important; resize: vertical; line-height: 1.5; }
.it-support-page .modern-form input:focus,
.it-support-page .modern-form select:focus,
.it-support-page .modern-form textarea:focus,
.it-support-page .filter-bar input:focus,
.it-support-page .filter-bar select:focus { border-color: rgba(79,70,229,.68) !important; box-shadow: 0 0 0 4px rgba(79,70,229,.12) !important; }
.it-support-page .modern-form .primary { width: 100%; min-height: 54px; border-radius: 18px; font-size: 15px; }

.it-support-page .it-my-ticket-summary-panel {
  position: relative !important;
  align-self: start !important;
  display: grid !important;
  gap: 18px !important;
  min-height: 0 !important;
  height: auto !important;
}
.it-support-page .it-my-ticket-summary-panel::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(135deg, rgba(79,70,229,.06), transparent 42%), radial-gradient(circle at 96% 2%, rgba(6,182,212,.12), transparent 28%); }
.it-support-page .it-my-ticket-summary-panel > * { position: relative; z-index: 1; }
.it-support-page .it-my-ticket-summary-card { display: grid !important; grid-template-columns: auto minmax(0, 1fr) !important; gap: 18px !important; align-items: center !important; min-height: 152px !important; padding: clamp(18px, 2vw, 26px) !important; border: 1px solid rgba(199,210,254,.92) !important; border-radius: 28px !important; background: radial-gradient(circle at 100% 0%, rgba(79,70,229,.14), transparent 34%), linear-gradient(135deg, rgba(255,255,255,.98) 0%, rgba(248,250,252,.98) 58%, rgba(238,242,255,.96) 100%) !important; box-shadow: 0 18px 46px rgba(79,70,229,.10) !important; }
.it-support-page .it-my-ticket-summary-icon { width: 74px !important; height: 74px !important; display: grid !important; place-items: center !important; border-radius: 26px !important; color: var(--it-primary) !important; background: linear-gradient(135deg, #EEF2FF, #DBEAFE) !important; box-shadow: inset 0 0 0 1px rgba(79,70,229,.14), 0 16px 36px rgba(79,70,229,.12) !important; animation: itSummaryFloat 3.8s ease-in-out infinite; }
.it-support-page .it-my-ticket-summary-copy { min-width: 0; }
.it-support-page .it-my-ticket-summary-copy span { display: block; color: var(--it-muted); font-size: 12px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
.it-support-page .it-my-ticket-summary-copy strong { display: block; margin-top: 6px; color: var(--it-ink); font-size: clamp(44px, 4.5vw, 66px); line-height: .92; letter-spacing: -.07em; }
.it-support-page .it-my-ticket-summary-copy p { max-width: 640px; margin: 10px 0 0; color: var(--it-muted); font-size: 15px; line-height: 1.55; }
.it-support-page .it-my-ticket-summary-actions { margin-top: 0 !important; }
.it-support-page .it-my-ticket-summary-actions .primary { width: 100%; min-height: 54px; border-radius: 18px; }

.it-support-page > .grievance-list-panel:not(.it-my-ticket-summary-panel) { margin-top: 0 !important; }
.it-support-page .it-team-strip { display: grid !important; grid-template-columns: minmax(0,1fr) auto !important; gap: 8px 16px !important; align-items: center !important; margin: 0 0 18px !important; padding: 18px 20px !important; border: 1px solid rgba(199,210,254,.9) !important; border-radius: 24px !important; background: radial-gradient(circle at 100% 0%, rgba(79,70,229,.12), transparent 34%), linear-gradient(135deg, #FFFFFF, #F8FAFC) !important; }
.it-support-page .it-team-strip > div { min-width: 0; display: flex; align-items: center; gap: 10px; }
.it-support-page .it-team-strip span { color: var(--it-ink); font-size: clamp(17px, 1.4vw, 24px); font-weight: 950; letter-spacing: -.035em; }
.it-support-page .it-team-strip strong { color: var(--it-primary); font-size: clamp(28px, 2.5vw, 40px); line-height: .95; letter-spacing: -.055em; }
.it-support-page .it-team-strip small { grid-column: 1 / -1; color: var(--it-muted); font-weight: 800; }

.it-support-page .filter-bar { display: grid !important; grid-template-columns: auto repeat(4, minmax(140px, 1fr)) minmax(180px, 1.1fr) auto !important; gap: 10px !important; align-items: center !important; margin: 0 0 18px !important; padding: 14px !important; border: 1px solid rgba(226,232,240,.92) !important; border-radius: 24px !important; background: rgba(248,250,252,.86) !important; }
.it-support-page .filter-label { display: inline-flex; align-items: center; gap: 8px; color: var(--it-muted); font-size: 12px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.it-support-page .filter-bar .ghost-btn { min-height: 50px; white-space: nowrap; }

.it-support-page .ticket-list { display: grid !important; gap: 16px !important; }
.it-support-page .ticket-card.it-ticket-card,
.it-support-page .it-ticket-card { position: relative; min-width: 0; overflow: hidden; padding: 20px !important; border: 1px solid rgba(226,232,240,.92) !important; border-radius: 26px !important; background: radial-gradient(circle at 100% 0%, rgba(79,70,229,.055), transparent 36%), #FFFFFF !important; box-shadow: 0 14px 42px rgba(15,23,42,.06) !important; transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease; }
.it-support-page .it-ticket-card:hover { transform: translateY(-2px); border-color: rgba(79,70,229,.30) !important; box-shadow: 0 24px 66px rgba(15,23,42,.10) !important; }
.it-support-page .it-ticket-card.it-ticket-card-active { border-color: rgba(79,70,229,.55) !important; box-shadow: 0 26px 76px rgba(79,70,229,.14) !important; }
.it-support-page .ticket-topline { display: flex !important; align-items: flex-start !important; justify-content: space-between !important; gap: 14px !important; }
.it-support-page .ticket-topline > div:first-child { min-width: 0; }
.it-support-page .ticket-topline strong { display: block; color: var(--it-primary); font-size: 14px; font-weight: 950; overflow-wrap: anywhere; }
.it-support-page .ticket-topline span { display: inline-block; margin-top: 3px; color: var(--it-muted); font-size: 13px; font-weight: 800; }
.it-support-page .ticket-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.it-support-page .pill { border-radius: 999px !important; padding: 7px 11px !important; font-size: 12px !important; font-weight: 950 !important; line-height: 1 !important; }
.it-support-page .it-ticket-card h3 { margin: 18px 0 8px !important; color: var(--it-ink); font-size: clamp(17px, 1.35vw, 22px) !important; line-height: 1.25; letter-spacing: -.03em; overflow-wrap: anywhere; }
.it-support-page .it-ticket-card > p { margin: 0 0 16px !important; color: var(--it-muted); line-height: 1.58; overflow-wrap: anywhere; }
.it-support-page .ticket-meta-grid { display: grid !important; grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 12px !important; margin-top: 16px !important; }
.it-support-page .ticket-meta-grid > div { padding: 13px 14px !important; }
.it-support-page .anonymous-note,
.it-support-page .review-note { display: flex; align-items: flex-start; gap: 10px; margin-top: 16px !important; padding: 13px 14px !important; border-radius: 18px !important; font-size: 14px; font-weight: 850; line-height: 1.45; }
.it-support-page .anonymous-note { border: 1px solid rgba(245,158,11,.32) !important; color: #B45309 !important; background: #FFFBEB !important; }
.it-support-page .review-note { border: 1px solid rgba(37,99,235,.24) !important; color: #1D4ED8 !important; background: #EFF6FF !important; }
.it-support-page .ticket-actions { display: flex !important; flex-wrap: wrap !important; gap: 10px !important; margin-top: 18px !important; }
.it-support-page .ticket-actions .ghost-btn { min-height: 42px; border-radius: 15px; }

.it-support-page .it-context-panel { position: relative; margin-top: 18px !important; padding: 18px !important; border: 1px solid rgba(199,210,254,.95) !important; border-radius: 24px !important; background: radial-gradient(circle at 100% 0%, rgba(79,70,229,.12), transparent 34%), linear-gradient(135deg, #FFFFFF, #F8FAFC 64%, #EEF2FF) !important; box-shadow: 0 18px 56px rgba(79,70,229,.13) !important; animation: itProPanelIn .24s cubic-bezier(.2,.8,.2,1) both; scroll-margin-top: 96px; }
.it-support-page .it-context-panel::before { content: ""; position: absolute; top: -9px; left: 34px; width: 18px; height: 18px; border-left: 1px solid rgba(199,210,254,.95); border-top: 1px solid rgba(199,210,254,.95); background: #FFFFFF; transform: rotate(45deg); }
.it-support-page .it-context-form { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 14px !important; }
.it-support-page .it-context-form label:nth-last-of-type(1),
.it-support-page .it-context-form button[type="submit"] { grid-column: 1 / -1; }
.it-support-page .mode-escalate .it-context-form,
.it-support-page .mode-review .it-context-form,
.it-support-page .mode-reopen .it-context-form { grid-template-columns: 1fr !important; }

.it-support-page .it-sheet-backdrop { position: fixed; inset: 0; z-index: 130; display: flex; justify-content: flex-end; padding: max(14px, env(safe-area-inset-top, 0px)) max(14px, env(safe-area-inset-right, 0px)) max(14px, env(safe-area-inset-bottom, 0px)) max(14px, env(safe-area-inset-left, 0px)); background: rgba(15,23,42,.46); backdrop-filter: blur(9px); animation: itSheetFadeIn .18s ease both; }
.it-support-page .it-my-ticket-sheet { width: min(920px, 100%); max-width: calc(100vw - 28px); height: calc(100dvh - 28px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(226,232,240,.95); border-radius: 32px; background: radial-gradient(circle at 100% 0%, rgba(79,70,229,.12), transparent 34%), linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 66%, #EEF2FF 100%); box-shadow: 0 34px 100px rgba(15,23,42,.30); animation: itSheetSlideIn .28s cubic-bezier(.2,.8,.2,1) both; }
.it-support-page .it-sheet-header { flex: 0 0 auto; padding: 24px; border-bottom: 1px solid rgba(226,232,240,.92); background: rgba(255,255,255,.82); backdrop-filter: blur(12px); }
.it-support-page .it-sheet-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 20px 24px 24px; }

@media (min-width: 1600px) {
  .it-support-page .it-support-grid,
  .it-support-page .grievance-grid.it-support-grid { grid-template-columns: minmax(460px, .72fr) minmax(420px, 1fr) !important; }
  .it-support-page .ticket-meta-grid { grid-template-columns: repeat(4, minmax(160px, 1fr)) !important; }
}
@media (max-width: 1366px) {
  .it-support-page .grievance-stats { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  .it-support-page .filter-bar { grid-template-columns: auto repeat(2, minmax(150px, 1fr)) !important; }
  .it-support-page .ticket-meta-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
}
@media (max-width: 1180px) {
  .it-support-page .it-support-grid,
  .it-support-page .grievance-grid.it-support-grid { grid-template-columns: 1fr !important; }
  .it-support-page .it-my-ticket-summary-card { min-height: 0 !important; }
}
@media (max-width: 1024px) {
  .it-support-page .filter-bar { grid-template-columns: 1fr 1fr !important; }
  .it-support-page .filter-label,
  .it-support-page .filter-bar input,
  .it-support-page .filter-bar .ghost-btn { grid-column: 1 / -1 !important; }
  .it-support-page .it-context-form { grid-template-columns: 1fr !important; }
  .it-support-page .it-context-form label,
  .it-support-page .it-context-form button[type="submit"] { grid-column: 1 / -1 !important; }
}
@media (max-width: 820px) {
  .it-support-page .grievance-hero.it-hero { grid-template-columns: 1fr !important; border-radius: 24px !important; }
  .it-support-page .grievance-hero-actions { justify-content: stretch !important; }
  .it-support-page .grievance-hero-actions .ghost-btn { width: 100%; }
  .it-support-page .grievance-stats { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .it-support-page .profile-prefill-grid,
  .it-support-page .form-row.two,
  .it-support-page .ticket-meta-grid { grid-template-columns: 1fr !important; }
  .it-support-page .ticket-topline { display: grid !important; grid-template-columns: 1fr !important; }
  .it-support-page .ticket-badges { justify-content: flex-start; }
  .it-support-page .it-sheet-backdrop { padding: 10px; }
  .it-support-page .it-my-ticket-sheet { width: 100%; max-width: 100%; height: calc(100dvh - 20px); border-radius: 26px; }
}
@media (max-width: 720px) {
  @keyframes itSheetSlideInMobile { from { opacity: 0; transform: translateY(32px); } to { opacity: 1; transform: translateY(0); } }
  .it-support-page { gap: 14px !important; }
  .it-support-page .grievance-hero.it-hero,
  .it-support-page .grievance-form-panel,
  .it-support-page .it-my-ticket-summary-panel,
  .it-support-page > .grievance-list-panel:not(.it-my-ticket-summary-panel) { border-radius: 22px !important; padding: 16px !important; }
  .it-support-page .it-hero h1 { font-size: 30px !important; letter-spacing: -.05em !important; }
  .it-support-page .section-heading h2 { font-size: 24px !important; }
  .it-support-page .grievance-stats { grid-template-columns: 1fr 1fr !important; gap: 10px !important; }
  .it-support-page .mini-stat-card { min-height: 96px !important; border-radius: 18px !important; padding: 14px !important; }
  .it-support-page .mini-stat-card span { font-size: 10px; }
  .it-support-page .mini-stat-card strong { font-size: 26px; }
  .it-support-page .it-my-ticket-summary-card { grid-template-columns: 1fr !important; min-height: 0 !important; padding: 16px !important; border-radius: 20px !important; }
  .it-support-page .it-my-ticket-summary-copy strong { font-size: 44px !important; }
  .it-support-page .filter-bar { grid-template-columns: 1fr !important; padding: 12px !important; border-radius: 20px !important; }
  .it-support-page .ticket-actions { display: grid !important; grid-template-columns: 1fr !important; }
  .it-support-page .ticket-actions .ghost-btn,
  .it-support-page .filter-bar .ghost-btn,
  .it-support-page .modern-form .primary { width: 100%; }
  .it-support-page .it-context-panel { padding: 15px !important; border-radius: 20px !important; scroll-margin-top: 82px; }
  .it-support-page .it-sheet-backdrop { align-items: flex-end; padding: 0; }
  .it-support-page .it-my-ticket-sheet { height: 100dvh; max-height: 100dvh; border-radius: 24px 24px 0 0; border-bottom: 0; animation: itSheetSlideInMobile .26s cubic-bezier(.2,.8,.2,1) both; }
  .it-support-page .it-sheet-header { padding: calc(16px + env(safe-area-inset-top, 0px)) 14px 14px; }
  .it-support-page .it-sheet-body { padding: 14px 14px calc(18px + env(safe-area-inset-bottom, 0px)); }
  .it-support-page .it-sheet-stats { grid-template-columns: 1fr !important; gap: 9px !important; padding: 12px 14px !important; }
  .it-support-page .it-sheet-stats > div { display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 12px !important; padding: 12px 14px !important; border-radius: 16px !important; }
  .it-support-page .it-sheet-stats strong { margin-top: 0 !important; font-size: 24px !important; }
}
@media (max-width: 480px) {
  .it-support-page .grievance-stats { grid-template-columns: 1fr !important; }
  .it-support-page .mini-stat-card { min-height: 74px !important; display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 12px !important; }
  .it-support-page .mini-stat-card strong { margin-top: 0 !important; }
  .it-support-page .it-team-strip { grid-template-columns: 1fr !important; border-radius: 20px !important; }
  .it-support-page .it-team-strip strong { justify-self: start; }
  .it-support-page .section-heading { display: grid !important; grid-template-columns: 1fr auto !important; }
  .it-support-page .it-ticket-card { padding: 15px !important; border-radius: 20px !important; }
  .it-support-page .it-my-ticket-summary-icon { width: 58px !important; height: 58px !important; border-radius: 20px !important; }
}

/* Portal-safe My Tickets sheet: keeps the sheet attached to viewport, not inside transformed page layout */
.it-support-sheet-portal-root.it-support-page {
  width: auto !important;
  min-height: 0 !important;
  animation: none !important;
  transform: none !important;
  position: static !important;
  isolation: auto !important;
}

.it-support-sheet-portal-root .it-sheet-backdrop {
  position: fixed !important;
  inset: 0 !important;
  z-index: 9999 !important;
  display: flex !important;
  align-items: stretch !important;
  justify-content: flex-end !important;
  width: 100vw !important;
  height: 100dvh !important;
  padding:
    max(16px, env(safe-area-inset-top, 0px))
    max(16px, env(safe-area-inset-right, 0px))
    max(16px, env(safe-area-inset-bottom, 0px))
    max(16px, env(safe-area-inset-left, 0px)) !important;
  overflow: hidden !important;
  background: rgba(15, 23, 42, .54) !important;
  backdrop-filter: blur(12px) !important;
}

.it-support-sheet-portal-root .it-my-ticket-sheet {
  width: min(980px, calc(100vw - 32px)) !important;
  max-width: calc(100vw - 32px) !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: calc(100dvh - 32px) !important;
  align-self: stretch !important;
  margin: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  transform-origin: right center !important;
}

.it-support-sheet-portal-root .it-sheet-header,
.it-support-sheet-portal-root .it-sheet-stats {
  flex: 0 0 auto !important;
}

.it-support-sheet-portal-root .it-sheet-body {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  -webkit-overflow-scrolling: touch !important;
  overscroll-behavior: contain !important;
}

@media (max-width: 920px) {
  .it-support-sheet-portal-root .it-sheet-backdrop {
    padding: 10px !important;
  }

  .it-support-sheet-portal-root .it-my-ticket-sheet {
    width: 100% !important;
    max-width: 100% !important;
    max-height: calc(100dvh - 20px) !important;
  }
}

@media (max-width: 720px) {
  .it-support-sheet-portal-root .it-sheet-backdrop {
    align-items: flex-end !important;
    padding: 0 !important;
  }

  .it-support-sheet-portal-root .it-my-ticket-sheet {
    width: 100vw !important;
    max-width: 100vw !important;
    height: calc(100dvh - env(safe-area-inset-top, 0px)) !important;
    max-height: calc(100dvh - env(safe-area-inset-top, 0px)) !important;
    border-radius: 24px 24px 0 0 !important;
    border-bottom: 0 !important;
  }

  .it-support-sheet-portal-root .it-sheet-header {
    padding-top: calc(16px + env(safe-area-inset-top, 0px)) !important;
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
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const manageAccess = Boolean(permissions.can_manage_normal || permissions.can_manage);
  const workAccess = Boolean(permissions.is_it_member || permissions.is_it_head);
  const superAdminEscalatedAccess = Boolean(permissions.can_view_escalated || permissions.is_super_admin);
  const canSeeDesk = manageAccess || workAccess || superAdminEscalatedAccess;
  const canEscalate = Boolean(permissions.can_escalate && manageAccess);

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

async function loadData() {
  setLoading(true);
  setError('');

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
    setError(err.message || 'Unable to load IT support data.');
  } finally {
    setLoading(false);
  }
}

async function loadTeamTickets() {
    if (!canSeeDesk) return;

    setLoading(true);
    setError('');

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
      setError(err.message || 'Unable to load IT support tickets.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTicket(event) {
    event.preventDefault();

    setError('');
    setSuccess('');

    if (!normalizeText(ticketForm.subject)) {
      setError('Subject is required.');
      return;
    }

    if (!normalizeText(ticketForm.description)) {
      setError('Description is required.');
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
      setSuccess('IT support ticket submitted successfully to the IT Department.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to submit IT support ticket.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign(event) {
    event.preventDefault();

    if (!selectedTicket) {
      setError('Please select a ticket first.');
      return;
    }

    if (!assignForm.assigned_to_employee_id) {
      setError('Please select an IT Department member.');
      return;
    }

    setPanelSaving(true);
    setError('');
    setSuccess('');

    try {
      await assignItSupportTicket(ticketId(selectedTicket), assignForm);
      setSuccess('IT support ticket assigned successfully.');
      closePanel();
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to assign ticket.');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleStatusUpdate(event) {
    event.preventDefault();

    if (!selectedTicket) {
      setError('Please select a ticket first.');
      return;
    }

    if (statusForm.status === 'resolved' && !normalizeText(statusForm.resolution_note || statusForm.status_note)) {
      setError('Resolution note is required before marking ticket as resolved.');
      return;
    }

    setPanelSaving(true);
    setError('');
    setSuccess('');

    try {
      await updateItSupportTicketStatus(ticketId(selectedTicket), statusForm);
      setSuccess(
        statusForm.status === 'resolved'
          ? 'Ticket marked as resolved. The requester can now give a review from My IT Tickets.'
          : 'IT support ticket status updated successfully.',
      );
      closePanel();
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to update ticket status.');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleEscalate(event) {
    event.preventDefault();

    if (!selectedTicket) {
      setError('Please select a ticket first.');
      return;
    }

    if (!normalizeText(escalationForm.escalation_reason)) {
      setError('Escalation reason is required.');
      return;
    }

    setPanelSaving(true);
    setError('');
    setSuccess('');

    try {
      await escalateItSupportTicket(ticketId(selectedTicket), {
        escalation_type: escalationForm.escalation_type,
        escalation_reason: normalizeText(escalationForm.escalation_reason),
      });

      setSuccess('IT support ticket escalated to Super Admin successfully.');
      closePanel();
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to escalate ticket.');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleReview(event) {
    event.preventDefault();

    if (!selectedTicket) {
      setError('Please select a ticket first.');
      return;
    }

    setPanelSaving(true);
    setError('');
    setSuccess('');

    try {
      await reviewItSupportTicket(ticketId(selectedTicket), reviewForm);
      setSuccess('Review submitted successfully. The IT support ticket is now closed.');
      closePanel();
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to submit review.');
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleReopen(event) {
    event.preventDefault();

    if (!selectedTicket) {
      setError('Please select a ticket first.');
      return;
    }

    if (!normalizeText(reopenForm.reason)) {
      setError('Reopen reason is required.');
      return;
    }

    setPanelSaving(true);
    setError('');
    setSuccess('');

    try {
      await reopenItSupportTicket(ticketId(selectedTicket), reopenForm);
      setSuccess('IT support ticket reopened successfully.');
      closePanel();
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to reopen ticket.');
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
          <button type="button" className="ghost-btn" onClick={loadData}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </section>

      {error ? (
        <div className="alert-card danger">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {success ? (
        <div className="alert-card success">
          <CheckCircle2 size={18} />
          <span>{success}</span>
        </div>
      ) : null}

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