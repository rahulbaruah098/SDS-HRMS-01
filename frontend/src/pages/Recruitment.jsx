import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, ArrowDown, ArrowUp, BadgeCheck, BriefcaseBusiness, CalendarClock, Check,
  CheckCircle2, ChevronRight, ClipboardCheck, Clock3, Download, FileCheck2,
  FileSearch, FileText, Filter, Gauge, Inbox, LayoutDashboard, Loader2, Mail,
  Copy, ExternalLink, Link2, MapPin, Paperclip, PauseCircle, Plus, RefreshCw, Search, Send, Settings2,
  ShieldCheck, Sparkles, Star, Trash2, UploadCloud, UserCheck, UserPlus, Users,
  UserSearch, X, XCircle,
} from 'lucide-react';
import {
  changeRecruitmentApplicationStatus,
  changeRecruitmentInterviewStatus,
  changeRecruitmentJobOpeningStatus,
  changeRecruitmentJoiningStatus,
  convertRecruitmentCandidateToEmployee,
  completeRecruitmentInterviewProcess,
  createRecruitmentApplication,
  createRecruitmentCandidate,
  createRecruitmentHiringRequest,
  createRecruitmentJobOpening,
  createRecruitmentOffer,
  currentEmployee,
  currentUser,
  decideRecruitmentHiringRequest,
  decideRecruitmentOffer,
  downloadRecruitmentCandidateResume,
  downloadRecruitmentJoiningDocument,
  getActiveEmployees,
  getDepartments,
  getDesignations,
  getRecruitmentActivity,
  getRecruitmentApplicationInterviewFeedback,
  getRecruitmentApplications,
  getRecruitmentBackgroundChecks,
  getRecruitmentCandidates,
  getRecruitmentDashboard,
  getRecruitmentHiringRequests,
  getRecruitmentInterviews,
  getRecruitmentJobOpenings,
  getRecruitmentJoiningDocuments,
  getRecruitmentOffers,
  getRecruitmentReports,
  getRecruitmentSettings,
  parseRecruitmentResume,
  rescheduleRecruitmentInterview,
  reviewRecruitmentJoiningDocument,
  scheduleRecruitmentInterview,
  sendRecruitmentOffer,
  submitRecruitmentHiringRequest,
  submitRecruitmentInterviewFeedback,
  submitRecruitmentOfferForApproval,
  updateRecruitmentBackgroundCheck,
  updateRecruitmentScreening,
  updateRecruitmentSettings,
} from '../api/client';
import '../recruitment.css';

const TABS = [
  ['overview', 'Overview', LayoutDashboard],
  ['requests', 'Hiring Requests', ClipboardCheck],
  ['jobs', 'Job Openings', BriefcaseBusiness],
  ['candidates', 'Candidates', Users],
  ['interviews', 'Interviews', CalendarClock],
  ['feedback', 'Interview Feedback', Star],
  ['offers', 'Offers', FileCheck2],
  ['joining', 'Joining', UserCheck],
  ['reports', 'Reports', Gauge],
  ['settings', 'Settings', Settings2],
];

const HR_ROLES = new Set(['super_admin', 'admin', 'hr_admin', 'hr_manager', 'hr']);
const HR_PUBLISH_ROLES = new Set(['hr_admin', 'hr_manager', 'hr']);
const FINAL_APPROVER_ROLES = new Set([
  'super_admin', 'admin', 'managing_director', 'managing_director_admin', 'md',
]);
const FINAL_APPROVER_CAPABILITIES = new Set([
  'recruitment_final_approval', 'approve_hiring_request', 'approve_hiring_requirements',
]);
const TEAM_LEADER_ROLES = new Set(['team_leader']);
const OFFER_APPROVERS = new Set([
  'super_admin', 'admin', 'finance', 'accounts_finance', 'hr_manager', 'hr_admin',
]);
const JOINING_STATUSES = new Set([
  'documents_pending', 'ready_to_join', 'joining_deferred', 'joined', 'did_not_join',
]);
const INTERVIEWER_ROLE_OPTIONS = [
  ['hiring_manager', 'Hiring Manager'],
  ['hiring_assistant', 'Hiring Assistant'],
  ['technical_interviewer', 'Technical Interviewer'],
];
const DEFAULT_INTERVIEW_ROUNDS = [
  { key: 'hr_screening', label: 'HR Screening', order: 1, sequence_no: 1 },
  { key: 'technical', label: 'Technical Interview', order: 2, sequence_no: 2 },
  { key: 'manager', label: 'Manager Interview', order: 3, sequence_no: 3 },
];

const EMPTY_REQUEST = {
  job_title: '', department: '', department_id: '', vacancies: 1,
  work_location: '', employment_type: 'permanent', business_reason: '',
  expected_joining_date: '', required_experience: '', required_skills: '',
  qualification: '', salary_min: '', salary_max: '', currency: 'INR',
  budget_notes: '', hiring_manager_user_id: '', approver_user_id: '',
  finance_approval_required: false, leadership_approval_required: false,
};
const EMPTY_JOB = {
  hiring_request_id: '', job_title: '', department: '', vacancies: 1,
  description: '', responsibilities: '', qualification: '', required_skills: '',
  required_experience: '', employment_type: 'permanent', work_location: '',
  work_mode: 'office', closing_date: '', salary_visible: false,
  recruiter_user_id: '', hiring_manager_user_id: '',
};
const EMPTY_CANDIDATE = {
  full_name: '', email: '', phone: '', location: '', address: '',
  current_designation: '', current_employer: '', total_experience: '',
  notice_period: '', expected_salary: '', summary: '', skills: '',
  linkedin_url: '', github_url: '', job_opening_id: '', source: 'manual',
  source_detail: '', consent_accepted: true,
};
const EMPTY_INTERVIEW = {
  application_id: '', round_key: 'hr_screening', round_label: 'HR Screening',
  scheduled_at: '', duration_minutes: 45, mode: 'online', location: '',
  meeting_link: '', candidate_notes: '', internal_notes: '',
};
const EMPTY_OFFER = {
  application_id: '', designation: '', department: '', reporting_manager_user_id: '',
  work_location: '', employment_type: 'permanent', joining_date: '',
  probation_months: 6, currency: 'INR', gross_salary: '', basic_salary: '',
  hra: '', other_allowance: '', response_deadline: '', notes: '',
};
const DEFAULT_SETTINGS = {
  module_enabled: true, career_page_enabled: true, allow_employee_referrals: true,
  require_hiring_request_approval: true, require_salary_approval: true,
  default_currency: 'INR', default_application_source: 'career_page',
  candidate_retention_days: 730, resume_max_size_mb: 8,
  employee_code_prefix: 'EMP', public_career_slug: '',
  default_interview_rounds: DEFAULT_INTERVIEW_ROUNDS,
  email_candidate_on_application: true, email_candidate_on_interview: true,
  email_candidate_on_offer: true, email_candidate_on_rejection: true,
};

const idOf = (item) => String(item?._id || item?.id || '').trim();
const keyOf = (value) => String(value || '').trim().toLowerCase().replaceAll('-', '_').replace(/\s+/g, '_');
const slugOf = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const labelOf = (value) => {
  const key = keyOf(value);
  const aliases = {
    under_review: 'Under Review', interview_scheduled: 'Interview Scheduled',
    ready_to_join: 'Ready to Join', documents_pending: 'Documents Pending',
    joining_deferred: 'Joining Deferred', did_not_join: 'Did Not Join',
    approval_pending: 'Approval Pending', needs_correction: 'Needs Correction',
    clarification_required: 'Clarification Required', not_clear: 'Not Clear',
    on_hold: 'On Hold',
  };
  return aliases[key] || key.split('_').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') || '—';
};
const listOf = (response) => Array.isArray(response) ? response : response?.items || response?.data || response?.results || [];
const itemOf = (response) => response?.item || response?.data || response?.result || response || {};
const messageOf = (error, fallback = 'The action could not be completed.') => error?.message || error?.data?.message || error?.error || fallback;
const commaList = (value) => Array.isArray(value) ? value.filter(Boolean) : String(value || '').split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
const textOf = (value) => Array.isArray(value) ? value.filter(Boolean).join('\n') : String(value || '').trim();
const orderedRounds = (value) => {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_INTERVIEW_ROUNDS;
  return source
    .map((item, index) => ({
      key: keyOf(item?.key || item?.label || `round_${index + 1}`),
      label: String(item?.label || item?.name || `Interview Round ${index + 1}`).trim(),
      order: Number(item?.order || item?.sequence_no || index + 1),
      sequence_no: Number(item?.sequence_no || item?.order || index + 1),
    }))
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({ ...item, order: index + 1, sequence_no: index + 1 }));
};
const feedbackSheetOf = (response) => response?.data?.rounds ? response.data : response || {};
const dateInput = (value) => value ? String(value).slice(0, 10) : '';
const dateTimeInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const formatDate = (value, time = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
};
const money = (value, currency = 'INR') => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-IN')}`;
  }
};
const initials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? `${parts[0][0] || ''}${parts.length > 1 ? parts.at(-1)[0] : parts[0][1] || ''}`.toUpperCase() : 'NA';
};
const employeeName = (item = {}) => item.name || item.employee_name || item.full_name || item.email || 'Employee';
const employeeUserId = (item = {}) => String(item.user_id || item.user?._id || item._id || item.id || '');
const optionName = (item = {}) => item.name || item.label || item.title || item.department_name || item.designation_name || '';
const rolesOf = (user = {}) => new Set([...(Array.isArray(user.roles) ? user.roles : []), user.role, user.user_role].map(keyOf).filter(Boolean));
const capabilitiesOf = (user = {}) => new Set([
  ...(Array.isArray(user.capabilities) ? user.capabilities : []),
  ...(Array.isArray(user.permissions) ? user.permissions : []),
  ...(Array.isArray(user.allowed_actions) ? user.allowed_actions : []),
].map(keyOf).filter(Boolean));
const canAny = (values, accepted) => Array.from(values).some((value) => accepted.has(value));
const scoreOf = (application = {}) => {
  const value = Number(application.resume_match_score ?? application.resume_match?.score);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
};
const matchPercent = (component = {}) => {
  const direct = Number(component.ratio_percent);
  if (Number.isFinite(direct)) return Math.max(0, Math.min(100, Math.round(direct)));
  const score = Number(component.score);
  const maximum = Number(component.max_score);
  return Number.isFinite(score) && Number.isFinite(maximum) && maximum > 0
    ? Math.max(0, Math.min(100, Math.round((score / maximum) * 100)))
    : 0;
};

function toneOf(status) {
  const key = keyOf(status);
  if (['approved', 'open', 'shortlisted', 'selected', 'accepted', 'ready_to_join', 'joined', 'clear', 'completed', 'received'].includes(key)) return 'success';
  if (['rejected', 'declined', 'expired', 'cancelled', 'did_not_join', 'not_clear', 'candidate_absent', 'interviewer_absent'].includes(key)) return 'danger';
  if (['on_hold', 'paused', 'pending', 'approval_pending', 'joining_deferred', 'needs_correction', 'clarification_required', 'submitted'].includes(key)) return 'warning';
  if (['interviewed', 'rescheduled'].includes(key)) return 'purple';
  if (['applied', 'under_review', 'interview_scheduled', 'scheduled', 'sent', 'documents_pending'].includes(key)) return 'info';
  return 'neutral';
}
function Status({ value }) {
  const key = keyOf(value);
  return <span className={`recruitment-status recruitment-status-${toneOf(key)} recruitment-status-${key || 'neutral'}`}>{labelOf(key)}</span>;
}
function Field({ label, required, hint, full, children }) {
  return <div className={`recruitment-field${full ? ' recruitment-field-full' : ''}`}>
    <label>{label}{required ? <span className="recruitment-required"> *</span> : null}</label>
    {children}{hint ? <p className="recruitment-field-hint">{hint}</p> : null}
  </div>;
}
function SectionHead({ title, description, children }) {
  return <div className="recruitment-section-head"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{children ? <div className="recruitment-section-actions">{children}</div> : null}</div>;
}
function Metric({ icon: Icon, label, value, note, tone }) {
  return <article className="recruitment-metric-card" data-tone={tone}><div className="recruitment-metric-icon"><Icon size={20} /></div><div className="recruitment-metric-copy"><span className="recruitment-metric-label">{label}</span><strong className="recruitment-metric-value">{value ?? 0}</strong><span className="recruitment-metric-note">{note}</span></div></article>;
}
function Empty({ icon: Icon = Inbox, title, message, action, onAction }) {
  return <div className="recruitment-empty"><div><div className="recruitment-empty-icon"><Icon size={22} /></div><h3>{title}</h3><p>{message}</p>{action && onAction ? <button type="button" className="recruitment-btn recruitment-btn-primary" onClick={onAction}><Plus size={15} />{action}</button> : null}</div></div>;
}
function Loading() {
  return <div className="recruitment-loading"><div><div className="recruitment-spinner" />Loading recruitment data…</div></div>;
}

function lockRecruitmentBackgroundScroll() {
  const root = document.documentElement;
  const body = document.body;
  const page = document.querySelector('.recruitment-page');

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  const lockedElements = new Set([root, body]);

  let ancestor = page?.parentElement || null;
  while (ancestor) {
    const styles = window.getComputedStyle(ancestor);
    const overflowY = styles.overflowY;
    const canScroll =
      ancestor.scrollHeight > ancestor.clientHeight &&
      ['auto', 'scroll', 'overlay'].includes(overflowY);

    if (canScroll) lockedElements.add(ancestor);
    ancestor = ancestor.parentElement;
  }

  [
    '.app-main',
    '.app-content',
    '.main-content',
    '.dashboard-content',
    '.content-wrapper',
    '.page-content',
    '.layout-content',
    '.layout-main',
    '[data-scroll-container]',
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      if (element instanceof HTMLElement) {
        lockedElements.add(element);
      }
    });
  });

  const previousStyles = new Map();

  lockedElements.forEach((element) => {
    previousStyles.set(element, {
      overflow: element.style.overflow,
      overflowX: element.style.overflowX,
      overflowY: element.style.overflowY,
      overscrollBehavior: element.style.overscrollBehavior,
      touchAction: element.style.touchAction,
    });

    element.style.overflow = 'hidden';
    element.style.overflowX = 'hidden';
    element.style.overflowY = 'hidden';
    element.style.overscrollBehavior = 'none';
    element.style.touchAction = 'none';
  });

  const previousBodyPosition = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
  };

  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.left = `-${scrollX}px`;
  body.style.right = '0';
  body.style.width = '100%';

  const isPopupScrollTarget = (target) =>
    target instanceof Element &&
    Boolean(
      target.closest(
        '.recruitment-modal-body, .recruitment-drawer-body',
      ),
    );

  const preventBackgroundScroll = (event) => {
    if (isPopupScrollTarget(event.target)) return;
    event.preventDefault();
  };

  window.addEventListener('wheel', preventBackgroundScroll, {
    passive: false,
    capture: true,
  });
  window.addEventListener('touchmove', preventBackgroundScroll, {
    passive: false,
    capture: true,
  });

  return () => {
    window.removeEventListener('wheel', preventBackgroundScroll, {
      capture: true,
    });
    window.removeEventListener('touchmove', preventBackgroundScroll, {
      capture: true,
    });

    lockedElements.forEach((element) => {
      const previous = previousStyles.get(element);
      if (!previous) return;

      element.style.overflow = previous.overflow;
      element.style.overflowX = previous.overflowX;
      element.style.overflowY = previous.overflowY;
      element.style.overscrollBehavior = previous.overscrollBehavior;
      element.style.touchAction = previous.touchAction;
    });

    body.style.position = previousBodyPosition.position;
    body.style.top = previousBodyPosition.top;
    body.style.left = previousBodyPosition.left;
    body.style.right = previousBodyPosition.right;
    body.style.width = previousBodyPosition.width;

    window.scrollTo(scrollX, scrollY);
  };
}

function Modal({ title, subtitle, children, onClose, footer, large }) {
  useEffect(() => {
    const unlockBackgroundScroll = lockRecruitmentBackgroundScroll();
    const escape = (event) => event.key === 'Escape' && onClose();

    document.addEventListener('keydown', escape);

    return () => {
      document.removeEventListener('keydown', escape);
      unlockBackgroundScroll();
    };
  }, [onClose]);
  return <div className="recruitment-modal-backdrop" onMouseDown={onClose}><section className={`recruitment-modal${large ? ' recruitment-modal-lg' : ''}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header className="recruitment-modal-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-icon" onClick={onClose}><X size={17} /></button></header><div className="recruitment-modal-body">{children}</div>{footer ? <footer className="recruitment-modal-foot">{footer}</footer> : null}</section></div>;
}
function Drawer({ title, children, onClose, footer }) {
  useEffect(() => {
    const unlockBackgroundScroll = lockRecruitmentBackgroundScroll();
    const escape = (event) => event.key === 'Escape' && onClose();

    document.addEventListener('keydown', escape);

    return () => {
      document.removeEventListener('keydown', escape);
      unlockBackgroundScroll();
    };
  }, [onClose]);
  return <div className="recruitment-drawer-backdrop" onMouseDown={onClose}><aside className="recruitment-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header className="recruitment-drawer-head"><h2>{title}</h2><button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-icon" onClick={onClose}><X size={17} /></button></header><div className="recruitment-drawer-body">{children}</div>{footer ? <footer className="recruitment-drawer-foot">{footer}</footer> : null}</aside></div>;
}

function ToastRegion({ toasts, onClose }) {
  if (!toasts.length) return null;
  return <div className="recruitment-toast-region" aria-live="polite" aria-atomic="false">
    {toasts.map((toast) => {
      const tone = toast.type === 'danger' ? 'error' : toast.type;
      const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertCircle : tone === 'error' ? XCircle : ShieldCheck;
      return <article className={`recruitment-toast is-${tone || 'info'}`} key={toast.id} role={tone === 'error' ? 'alert' : 'status'}>
        <span className="recruitment-toast-icon"><Icon size={17} /></span>
        <span className="recruitment-toast-copy"><strong>{toast.title || (tone === 'success' ? 'Completed' : tone === 'error' ? 'Action needed' : tone === 'warning' ? 'Please review' : 'Recruitment update')}</strong><p>{toast.message}</p></span>
        <button type="button" className="recruitment-toast-close" aria-label="Dismiss notification" onClick={() => onClose(toast.id)}><X size={14} /></button>
      </article>;
    })}
  </div>;
}

function ResumeMatchCard({ application }) {
  const match = application?.resume_match || {};
  const score = scoreOf(application);
  const components = match.components || {};
  const rows = [
    ['Skills', components.skills],
    ['Experience', components.experience],
    ['Qualification', components.qualification],
    ['Role evidence', components.role_evidence],
  ];
  const matched = match.matched_skills || [];
  const missing = match.missing_skills || [];

  if (score === null) {
    return <div className="recruitment-alert recruitment-alert-warning"><AlertCircle size={17} /><span>No resume-match result is available for this application. HR can verify the resume and job requirements manually.</span></div>;
  }

  return <div className="recruitment-match-card">
    <div className="recruitment-match-score" style={{ '--recruitment-score-angle': `${score * 3.6}deg` }}><div><strong>{score}%</strong><span>Role match</span></div></div>
    <div className="recruitment-match-copy">
      <h4>{match.label || labelOf(application.resume_match_band || match.band || 'role alignment')}</h4>
      <p>{match.candidate_message || 'This is an explainable comparison with the configured job requirements. It supports human review and is not an automatic hiring decision.'}</p>
      <div className="recruitment-match-breakdown">
        {rows.map(([label, component]) => {
          const percent = matchPercent(component || {});
          return <div className="recruitment-match-row" key={label}><span>{label}</span><span className="recruitment-match-track"><span className="recruitment-match-fill" style={{ '--recruitment-match-width': `${percent}%` }} /></span><strong>{component?.available === false ? 'N/A' : `${percent}%`}</strong></div>;
        })}
      </div>
      {matched.length || missing.length ? <div className="recruitment-match-skills">
        {matched.map((skill) => <span className="recruitment-match-skill is-matched" key={`matched-${skill}`}><Check size={11} />{skill}</span>)}
        {missing.map((skill) => <span className="recruitment-match-skill is-missing" key={`missing-${skill}`}><AlertCircle size={11} />{skill}</span>)}
      </div> : null}
      <div className="recruitment-human-review-note"><ShieldCheck size={15} /><span>Human review is mandatory. This result cannot automatically approve, reject, shortlist or select a candidate.</span></div>
    </div>
  </div>;
}


const RECRUITMENT_VISUAL_STYLES = `
  .recruitment-page {
    --rec-ink: #101a3a;
    --rec-soft: #596483;
    --rec-violet: #6254da;
    --rec-deep: #342b78;
    --rec-blue: #3766db;
    --rec-teal: #18aaa8;
    --rec-paper: #fbfcff;
    --rec-flat-blue: #b9d7ff;
    --rec-flat-violet: #c9c0ff;
    --rec-flat-teal: #aee6d9;
    --rec-ease: cubic-bezier(.22, 1, .36, 1);

    display: grid;
    gap: 20px;
    width: 100%;
    color: var(--rec-ink);
    font-family: var(--yc-ui, var(--body), inherit);
  }

  .recruitment-header {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    padding: clamp(24px, 2.8vw, 36px);
    border: 1px solid rgba(171, 181, 211, .72);
    border-radius: clamp(28px, 2.5vw, 40px);
    background:
      radial-gradient(circle at 8% 8%, rgba(121, 219, 238, .34), transparent 31%),
      radial-gradient(circle at 92% 12%, rgba(191, 190, 249, .3), transparent 34%),
      linear-gradient(135deg, #f1fbff 0%, #fffdf8 48%, #f8f2ff 100%);
    box-shadow:
      12px 14px 0 var(--rec-flat-blue),
      0 28px 48px rgba(34, 38, 110, .13);
  }

  .recruitment-header::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -2;
    opacity: .42;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(65, 55, 161, .035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(65, 55, 161, .035) 1px, transparent 1px);
    background-size: 42px 42px;
  }

  .recruitment-header::after {
    content: "";
    position: absolute;
    z-index: -1;
    width: clamp(165px, 20vw, 290px);
    aspect-ratio: 1;
    right: clamp(-110px, -7vw, -55px);
    top: clamp(-118px, -8vw, -60px);
    border: 1px solid rgba(65, 55, 161, .12);
    border-radius: 34% 66% 58% 42% / 44% 38% 62% 56%;
    background: linear-gradient(145deg, rgba(105, 217, 208, .72), rgba(121, 189, 242, .72));
    transform: rotate(18deg);
  }

  .recruitment-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    width: fit-content;
    padding: 9px 13px;
    border-radius: 999px;
    color: #fff;
    background: var(--rec-deep);
    font-size: 9px;
    font-weight: 950;
    line-height: 1;
    letter-spacing: .12em;
    text-transform: uppercase;
  }

  .recruitment-header h1 {
    margin: 15px 0 9px;
    color: var(--rec-ink);
    font-family: var(--yc-display, var(--heading), inherit);
    font-size: clamp(34px, 4.4vw, 66px);
    font-weight: 760;
    line-height: .94;
    letter-spacing: -.055em;
  }

  .recruitment-header p {
    max-width: 820px;
    margin: 0;
    color: var(--rec-soft);
    font-size: clamp(13px, 1vw, 16px);
    line-height: 1.68;
  }

  .recruitment-header-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
  }

  .recruitment-header-note {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 12px;
    border-radius: 999px;
    color: #3657b5;
    background: rgba(229, 233, 255, .88);
    font-size: 10px;
    font-weight: 900;
  }

  .recruitment-tabs-shell {
    position: sticky;
    top: 0;
    z-index: 30;
    overflow: hidden;
    padding: 8px;
    border: 1px solid rgba(171, 181, 211, .7);
    border-radius: 22px;
    background: rgba(255, 255, 255, .88);
    box-shadow:
      7px 9px 0 #d1dcfa,
      0 18px 32px rgba(34, 38, 110, .09);
    backdrop-filter: blur(16px);
  }

  .recruitment-tabs {
    display: flex;
    gap: 7px;
    overflow-x: auto;
    scrollbar-width: none;
    scroll-behavior: smooth;
  }

  .recruitment-tabs::-webkit-scrollbar {
    display: none;
  }

  .recruitment-tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    flex: 0 0 auto;
    min-height: 42px;
    padding: 10px 13px;
    border: 1px solid transparent;
    border-radius: 13px;
    color: #4f5e7f;
    background: transparent;
    font: inherit;
    font-size: 11px;
    font-weight: 900;
    cursor: pointer;
    transition:
      transform 260ms var(--rec-ease),
      color 220ms ease,
      background 220ms ease,
      border-color 220ms ease,
      box-shadow 260ms var(--rec-ease);
  }

  .recruitment-tab:hover {
    transform: translateY(-2px);
    color: var(--rec-deep);
    background: #f1efff;
    border-color: rgba(98, 84, 218, .16);
  }

  .recruitment-tab.active {
    color: #fff;
    background: linear-gradient(145deg, #4f72df, #2bb9b5);
    box-shadow: 4px 5px 0 rgba(52, 43, 120, .72);
  }

  .recruitment-tab:disabled {
    cursor: wait;
    opacity: .72;
  }

  .recruitment-tab-count {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding-inline: 5px;
    border-radius: 999px;
    color: inherit;
    background: rgba(255, 255, 255, .2);
    font-size: 9px;
  }

  .recruitment-route-stage {
    min-width: 0;
    transform-origin: 50% 18%;
    animation: recruitmentPageEnter 520ms var(--rec-ease) both;
    transition:
      opacity 220ms ease,
      transform 260ms var(--rec-ease),
      filter 220ms ease;
  }

  .recruitment-route-stage.is-leaving {
    opacity: 0;
    transform: translateY(10px) scale(.992);
    filter: blur(2px);
    pointer-events: none;
  }

  @keyframes recruitmentPageEnter {
    from {
      opacity: 0;
      transform: translateY(16px) scale(.992);
      filter: blur(3px);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
    }
  }

  .recruitment-route-progress {
    position: fixed;
    z-index: 9999;
    top: 0;
    left: 0;
    height: 3px;
    width: 100%;
    transform-origin: left;
    background: linear-gradient(90deg, #6254da, #3766db, #18aaa8);
    box-shadow: 0 2px 10px rgba(98, 84, 218, .3);
    animation: recruitmentProgress 520ms ease both;
  }

  @keyframes recruitmentProgress {
    from { transform: scaleX(.05); opacity: .6; }
    72% { transform: scaleX(.82); opacity: 1; }
    to { transform: scaleX(1); opacity: 0; }
  }

  .recruitment-transition-note {
    position: fixed;
    z-index: 9998;
    top: 18px;
    left: 50%;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    transform: translateX(-50%);
    padding: 9px 13px;
    border: 1px solid rgba(98, 84, 218, .16);
    border-radius: 999px;
    color: var(--rec-deep);
    background: rgba(255, 255, 255, .94);
    box-shadow: 0 12px 28px rgba(34, 38, 110, .14);
    font-size: 10px;
    font-weight: 900;
    animation: recruitmentNoteIn 240ms var(--rec-ease) both;
    backdrop-filter: blur(14px);
  }

  @keyframes recruitmentNoteIn {
    from { opacity: 0; transform: translate(-50%, -8px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }

  .recruitment-panel,
  .recruitment-report-card,
  .recruitment-offer-card,
  .recruitment-joining-card,
  .recruitment-interview-card,
  .recruitment-match-card {
    border: 1px solid rgba(171, 181, 211, .68) !important;
    border-radius: 24px !important;
    background:
      linear-gradient(145deg, rgba(255,255,255,.99), rgba(244,249,255,.98)) !important;
    box-shadow:
      7px 9px 0 var(--rec-flat-blue),
      0 18px 30px rgba(15, 20, 75, .08) !important;
    transition:
      transform 280ms var(--rec-ease),
      border-color 220ms ease,
      box-shadow 280ms var(--rec-ease),
      filter 220ms ease !important;
  }

  .recruitment-panel:hover,
  .recruitment-report-card:hover,
  .recruitment-offer-card:hover,
  .recruitment-joining-card:hover,
  .recruitment-interview-card:hover {
    transform: translateY(-3px);
    border-color: rgba(98, 84, 218, .3) !important;
    box-shadow:
      10px 12px 0 var(--rec-flat-blue),
      0 24px 38px rgba(15, 20, 75, .12) !important;
  }

  .recruitment-section-head {
    border-bottom-color: rgba(65, 55, 161, .11) !important;
  }

  .recruitment-section-head h2,
  .recruitment-form-section-title {
    color: var(--rec-ink) !important;
    font-family: var(--yc-display, var(--heading), inherit);
    letter-spacing: -.03em;
  }

  .recruitment-section-head p,
  .recruitment-field-hint,
  .recruitment-table-secondary,
  .recruitment-metric-note {
    color: var(--rec-soft) !important;
  }

  .recruitment-metric-card {
    border: 1px solid rgba(171, 181, 211, .68) !important;
    border-radius: 21px !important;
    background: #f8fbff !important;
    box-shadow:
      7px 9px 0 var(--rec-flat-blue),
      0 18px 30px rgba(15, 20, 75, .08) !important;
    transition:
      transform 260ms var(--rec-ease),
      box-shadow 260ms var(--rec-ease);
  }

  .recruitment-metric-card:nth-child(4n + 2) {
    background: #f1efff !important;
    box-shadow: 7px 9px 0 var(--rec-flat-violet), 0 18px 30px rgba(15,20,75,.08) !important;
  }

  .recruitment-metric-card:nth-child(4n + 3) {
    background: #fff4d5 !important;
    box-shadow: 7px 9px 0 #ffe0a5, 0 18px 30px rgba(15,20,75,.08) !important;
  }

  .recruitment-metric-card:nth-child(4n + 4) {
    background: #eaf8f4 !important;
    box-shadow: 7px 9px 0 var(--rec-flat-teal), 0 18px 30px rgba(15,20,75,.08) !important;
  }

  .recruitment-metric-card:hover {
    transform: translateY(-3px);
  }

  .recruitment-btn {
    transition:
      transform 240ms var(--rec-ease),
      box-shadow 240ms var(--rec-ease),
      filter 200ms ease,
      background 200ms ease !important;
  }

  .recruitment-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    filter: saturate(1.04);
  }

  .recruitment-btn-primary {
    color: #fff !important;
    background: linear-gradient(145deg, #4f72df, #2bb9b5) !important;
    box-shadow: 5px 6px 0 rgba(52, 43, 120, .8) !important;
  }

  .recruitment-btn-secondary,
  .recruitment-btn-neutral {
    color: var(--rec-deep) !important;
    background: #f1efff !important;
    border-color: rgba(98, 84, 218, .18) !important;
    box-shadow: 4px 5px 0 rgba(98, 84, 218, .14) !important;
  }

  .recruitment-btn-success {
    color: #fff !important;
    background: linear-gradient(145deg, #2bb9b5, #2f8f88) !important;
    box-shadow: 5px 6px 0 rgba(19, 115, 111, .72) !important;
  }

  .recruitment-btn-warning {
    color: #8b5a14 !important;
    background: #fff4d5 !important;
  }

  .recruitment-btn-danger {
    color: #b62f55 !important;
    background: #ffe4ec !important;
  }

  .recruitment-input,
  .recruitment-select,
  .recruitment-field input,
  .recruitment-field select,
  .recruitment-field textarea,
  .recruitment-form input,
  .recruitment-form select,
  .recruitment-form textarea {
    border-color: rgba(159, 169, 205, .62) !important;
    border-radius: 14px !important;
    color: var(--rec-ink) !important;
    background: rgba(255, 255, 255, .9) !important;
    transition:
      border-color 180ms ease,
      box-shadow 180ms ease,
      background 180ms ease !important;
  }

  .recruitment-input:focus,
  .recruitment-select:focus,
  .recruitment-field input:focus,
  .recruitment-field select:focus,
  .recruitment-field textarea:focus,
  .recruitment-form input:focus,
  .recruitment-form select:focus,
  .recruitment-form textarea:focus {
    border-color: var(--rec-violet) !important;
    background: #fff !important;
    box-shadow: 0 0 0 4px rgba(98, 84, 218, .11) !important;
  }

  .recruitment-table-shell {
    overflow: hidden;
    border-radius: 18px !important;
    border-color: rgba(171, 181, 211, .62) !important;
  }

  .recruitment-table tbody tr {
    transition:
      background 180ms ease,
      transform 180ms ease;
  }

  .recruitment-table tbody tr:hover {
    background: rgba(237, 246, 255, .78) !important;
  }

  .recruitment-quick-item,
  .recruitment-document-row,
  .recruitment-interview-card,
  .recruitment-offer-card,
  .recruitment-joining-card {
    transition:
      transform 260ms var(--rec-ease),
      border-color 220ms ease,
      box-shadow 260ms var(--rec-ease),
      background 220ms ease !important;
  }

  .recruitment-quick-item:hover,
  .recruitment-document-row:hover {
    transform: translateX(4px);
  }

  .recruitment-modal-backdrop,
  .recruitment-drawer-backdrop {
    animation: recruitmentBackdropIn 260ms ease both;
    backdrop-filter: blur(8px);
  }

  .recruitment-modal {
    transform-origin: 50% 14%;
    animation: recruitmentModalIn 420ms var(--rec-ease) both;
  }

  .recruitment-drawer {
    animation: recruitmentDrawerIn 460ms var(--rec-ease) both;
  }

  @keyframes recruitmentBackdropIn {
    from { opacity: 0; backdrop-filter: blur(0); }
    to { opacity: 1; backdrop-filter: blur(8px); }
  }

  @keyframes recruitmentModalIn {
    from {
      opacity: 0;
      transform: translateY(22px) scale(.965);
      filter: blur(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
    }
  }

  @keyframes recruitmentDrawerIn {
    from {
      opacity: 0;
      transform: translateX(100%);
      filter: blur(3px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
      filter: blur(0);
    }
  }

  .recruitment-modal,
  .recruitment-drawer {
    border-color: rgba(171, 181, 211, .72) !important;
    background:
      linear-gradient(145deg, #ffffff 0%, #f4fbff 52%, #f8f1ff 100%) !important;
    box-shadow:
      0 30px 80px rgba(34, 38, 110, .24),
      10px 12px 0 rgba(185, 215, 255, .56) !important;
  }

  .recruitment-modal-head,
  .recruitment-drawer-head,
  .recruitment-modal-foot,
  .recruitment-drawer-foot {
    border-color: rgba(65, 55, 161, .11) !important;
    background: rgba(255, 255, 255, .72) !important;
  }

  .recruitment-toast {
    animation: recruitmentToastIn 420ms var(--rec-ease) both;
  }

  @keyframes recruitmentToastIn {
    from { opacity: 0; transform: translateX(22px) scale(.97); }
    to { opacity: 1; transform: translateX(0) scale(1); }
  }

  .recruitment-empty {
    border-color: rgba(98, 84, 218, .28) !important;
    background:
      linear-gradient(145deg, rgba(237,248,255,.72), rgba(248,241,255,.68)) !important;
  }

  @media (max-width: 900px) {
    .recruitment-header {
      flex-direction: column;
    }

    .recruitment-header-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .recruitment-tabs-shell {
      top: 6px;
    }
  }

  @media (max-width: 640px) {
    .recruitment-page {
      gap: 16px;
    }

    .recruitment-header {
      padding: 20px;
      border-radius: 24px;
      box-shadow:
        7px 8px 0 var(--rec-flat-blue),
        0 18px 30px rgba(34, 38, 110, .1);
    }

    .recruitment-header h1 {
      font-size: clamp(31px, 9.2vw, 43px);
    }

    .recruitment-header-actions,
    .recruitment-header-actions .recruitment-btn,
    .recruitment-header-note {
      width: 100%;
    }

    .recruitment-header-note {
      justify-content: center;
      text-align: center;
    }

    .recruitment-tabs-shell {
      margin-inline: -2px;
      border-radius: 18px;
    }

    .recruitment-tab {
      min-height: 40px;
      padding-inline: 11px;
    }

    .recruitment-modal {
      width: calc(100% - 20px) !important;
      max-height: calc(100dvh - 20px) !important;
      border-radius: 22px !important;
    }

    .recruitment-drawer {
      width: min(100%, 520px) !important;
    }

    .recruitment-transition-note {
      top: 10px;
      max-width: calc(100% - 24px);
      text-align: center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .recruitment-page *,
    .recruitment-page *::before,
    .recruitment-page *::after {
      scroll-behavior: auto !important;
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .01ms !important;
    }
  }
`;


const RECRUITMENT_RESPONSIVE_REFINEMENTS = `
  .recruitment-page {
    min-width: 0;
    padding-bottom: max(18px, env(safe-area-inset-bottom));
  }

  .recruitment-header,
  .recruitment-tabs-shell,
  .recruitment-panel,
  .recruitment-metric-card,
  .recruitment-report-card,
  .recruitment-offer-card,
  .recruitment-joining-card,
  .recruitment-interview-card,
  .recruitment-match-card {
    will-change: transform;
    backface-visibility: hidden;
    -webkit-font-smoothing: antialiased;
  }

  .recruitment-header-copy,
  .recruitment-section-head > div,
  .recruitment-metric-copy,
  .recruitment-person-copy,
  .recruitment-quick-item-main,
  .recruitment-interview-main {
    min-width: 0;
  }

  .recruitment-header h1,
  .recruitment-section-head h2,
  .recruitment-table-primary,
  .recruitment-person-copy strong,
  .recruitment-offer-card h4,
  .recruitment-joining-card h4,
  .recruitment-interview-card h4 {
    overflow-wrap: anywhere;
  }

  .recruitment-tabs-shell {
    top: max(8px, env(safe-area-inset-top));
  }

  .recruitment-tabs {
    scroll-snap-type: x proximity;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
  }

  .recruitment-tab {
    scroll-snap-align: start;
    touch-action: manipulation;
  }

  .recruitment-route-stage {
    contain: layout paint;
  }

  .recruitment-modal-backdrop,
  .recruitment-drawer-backdrop {
    padding:
      max(10px, env(safe-area-inset-top))
      max(10px, env(safe-area-inset-right))
      max(10px, env(safe-area-inset-bottom))
      max(10px, env(safe-area-inset-left));
  }

  .recruitment-modal,
  .recruitment-drawer {
    overscroll-behavior: contain;
  }

  .recruitment-modal-body,
  .recruitment-drawer-body,
  .recruitment-table-scroll,
  .recruitment-member-list {
    -webkit-overflow-scrolling: touch;
  }

  .recruitment-modal-head,
  .recruitment-modal-foot,
  .recruitment-drawer-head,
  .recruitment-drawer-foot {
    backdrop-filter: blur(14px);
  }

  .recruitment-modal-head,
  .recruitment-drawer-head {
    position: sticky;
    top: 0;
    z-index: 3;
  }

  .recruitment-modal-foot,
  .recruitment-drawer-foot {
    position: sticky;
    bottom: 0;
    z-index: 3;
  }

  .recruitment-toolbar {
    gap: 14px !important;
  }

  .recruitment-filter-grid {
    min-width: 0;
  }

  .recruitment-search,
  .recruitment-search input,
  .recruitment-select,
  .recruitment-input {
    min-width: 0;
  }

  .recruitment-table-scroll {
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(98, 84, 218, .35) transparent;
  }

  .recruitment-table-scroll::-webkit-scrollbar {
    height: 8px;
  }

  .recruitment-table-scroll::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(98, 84, 218, .35);
  }

  .recruitment-table th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: rgba(241, 239, 255, .94) !important;
    backdrop-filter: blur(12px);
  }

  .recruitment-table-actions,
  .recruitment-candidate-card-actions,
  .recruitment-section-actions,
  .recruitment-filter-actions,
  .recruitment-form-actions {
    flex-wrap: wrap;
  }

  .recruitment-btn {
    touch-action: manipulation;
  }

  .recruitment-btn:active:not(:disabled),
  .recruitment-tab:active:not(:disabled),
  .recruitment-quick-item:active {
    transform: translateY(0) scale(.985) !important;
  }

  .recruitment-drawer {
    width: min(560px, 100%) !important;
    max-width: 100%;
  }

  .recruitment-toast-region {
    padding:
      max(12px, env(safe-area-inset-top))
      max(12px, env(safe-area-inset-right))
      max(12px, env(safe-area-inset-bottom))
      max(12px, env(safe-area-inset-left));
  }

  .recruitment-toast {
    max-width: min(440px, calc(100vw - 24px));
  }

  .recruitment-rating-options {
    display: grid !important;
    grid-template-columns: repeat(5, minmax(38px, 1fr));
    gap: 8px;
  }

  .recruitment-rating-options button {
    min-width: 0 !important;
    min-height: 40px;
    border-radius: 12px !important;
    transition:
      transform 180ms ease,
      box-shadow 180ms ease,
      background 180ms ease !important;
  }

  .recruitment-rating-options button:hover {
    transform: translateY(-2px);
  }

  .recruitment-progress-fill,
  .recruitment-bar-fill,
  .recruitment-match-fill {
    transition: width 680ms cubic-bezier(.22, 1, .36, 1);
  }

  .recruitment-checkbox-row {
    transition:
      transform 180ms ease,
      border-color 180ms ease,
      background 180ms ease !important;
  }

  .recruitment-checkbox-row:hover {
    transform: translateY(-1px);
    border-color: rgba(98, 84, 218, .25) !important;
  }

  @media (min-width: 1600px) {
    .recruitment-page {
      gap: 24px;
    }

    .recruitment-metric-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    }

    .recruitment-dashboard-grid,
    .recruitment-report-grid {
      gap: 24px !important;
    }

    .recruitment-offer-grid,
    .recruitment-joining-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    }

    .recruitment-modal-lg {
      width: min(1180px, calc(100vw - 64px)) !important;
    }
  }

  @media (max-width: 1280px) {
    .recruitment-metric-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    }

    .recruitment-offer-grid,
    .recruitment-joining-grid,
    .recruitment-report-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }

    .recruitment-form-grid-4 {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }
  }

  @media (max-width: 1024px) {
    .recruitment-header {
      padding: 24px;
    }

    .recruitment-metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }

    .recruitment-dashboard-grid {
      grid-template-columns: 1fr !important;
    }

    .recruitment-parser-layout {
      grid-template-columns: 1fr !important;
    }

    .recruitment-form-grid-3 {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }

    .recruitment-modal-lg {
      width: min(900px, calc(100vw - 28px)) !important;
    }
  }

  @media (max-width: 820px) {
    .recruitment-header-actions {
      display: grid !important;
      grid-template-columns: 1fr 1fr;
    }

    .recruitment-header-note {
      grid-column: 1 / -1;
    }

    .recruitment-toolbar {
      align-items: stretch !important;
      flex-direction: column !important;
    }

    .recruitment-filter-grid {
      grid-template-columns: 1fr !important;
      width: 100%;
    }

    .recruitment-filter-actions {
      width: 100%;
    }

    .recruitment-filter-actions .recruitment-btn {
      width: 100%;
    }

    .recruitment-section-head {
      align-items: stretch !important;
      flex-direction: column !important;
    }

    .recruitment-section-actions,
    .recruitment-section-actions .recruitment-btn {
      width: 100%;
    }

    .recruitment-form-grid,
    .recruitment-form-grid-3,
    .recruitment-form-grid-4 {
      grid-template-columns: 1fr !important;
    }

    .recruitment-field-full {
      grid-column: auto !important;
    }

    .recruitment-interview-card {
      grid-template-columns: auto minmax(0, 1fr) !important;
    }

    .recruitment-interview-card > .recruitment-table-actions {
      grid-column: 1 / -1;
      width: 100%;
    }

    .recruitment-offer-grid,
    .recruitment-joining-grid,
    .recruitment-report-grid {
      grid-template-columns: 1fr !important;
    }

    .recruitment-modal,
    .recruitment-modal-lg {
      width: min(100%, calc(100vw - 20px)) !important;
    }
  }

  @media (max-width: 640px) {
    .recruitment-page {
      gap: 14px;
      padding-inline: 0;
    }

    .recruitment-header {
      gap: 18px;
      padding: 18px;
      border-radius: 22px;
    }

    .recruitment-header h1 {
      margin-top: 12px;
      font-size: clamp(30px, 10vw, 42px);
    }

    .recruitment-header p {
      font-size: 12px;
      line-height: 1.6;
    }

    .recruitment-header-actions {
      grid-template-columns: 1fr;
    }

    .recruitment-header-note {
      grid-column: auto;
      white-space: normal;
    }

    .recruitment-tabs-shell {
      margin-inline: 0;
      padding: 7px;
      border-radius: 17px;
    }

    .recruitment-tab {
      min-height: 42px;
      padding: 10px 12px;
      font-size: 10px;
    }

    .recruitment-metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 10px !important;
    }

    .recruitment-metric-card {
      min-height: 122px;
      padding: 14px !important;
      border-radius: 17px !important;
    }

    .recruitment-metric-value {
      font-size: 26px !important;
    }

    .recruitment-panel,
    .recruitment-report-card,
    .recruitment-offer-card,
    .recruitment-joining-card,
    .recruitment-interview-card {
      border-radius: 20px !important;
    }

    .recruitment-section-head,
    .recruitment-toolbar,
    .recruitment-form,
    .recruitment-form-section {
      padding-inline: 14px !important;
    }

    .recruitment-table-shell {
      margin-inline: -1px;
      border-radius: 15px !important;
    }

    .recruitment-table {
      min-width: 760px;
    }

    .recruitment-modal-backdrop,
    .recruitment-drawer-backdrop {
      align-items: flex-end !important;
      padding: 0 !important;
    }

    .recruitment-modal,
    .recruitment-modal-lg,
    .recruitment-drawer {
      width: 100% !important;
      max-width: 100% !important;
      max-height: calc(100dvh - max(8px, env(safe-area-inset-top))) !important;
      margin: 0 !important;
      border-radius: 24px 24px 0 0 !important;
      box-shadow: 0 -18px 60px rgba(34, 38, 110, .24) !important;
    }

    .recruitment-modal {
      animation-name: recruitmentMobileSheetIn !important;
      transform-origin: 50% 100%;
    }

    .recruitment-drawer {
      animation-name: recruitmentMobileSheetIn !important;
    }

    @keyframes recruitmentMobileSheetIn {
      from {
        opacity: 0;
        transform: translateY(100%);
        filter: blur(3px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
        filter: blur(0);
      }
    }

    .recruitment-modal-head,
    .recruitment-drawer-head {
      padding:
        16px
        max(16px, env(safe-area-inset-right))
        14px
        max(16px, env(safe-area-inset-left)) !important;
    }

    .recruitment-modal-body,
    .recruitment-drawer-body {
      padding-inline:
        max(16px, env(safe-area-inset-left))
        max(16px, env(safe-area-inset-right)) !important;
    }

    .recruitment-modal-foot,
    .recruitment-drawer-foot {
      display: grid !important;
      grid-template-columns: 1fr !important;
      gap: 9px !important;
      padding:
        13px
        max(16px, env(safe-area-inset-right))
        max(13px, env(safe-area-inset-bottom))
        max(16px, env(safe-area-inset-left)) !important;
    }

    .recruitment-modal-foot .recruitment-btn,
    .recruitment-drawer-foot .recruitment-btn {
      width: 100%;
      min-height: 44px;
    }

    .recruitment-card-actions,
    .recruitment-table-actions,
    .recruitment-candidate-card-actions {
      width: 100%;
    }

    .recruitment-table-actions .recruitment-btn,
    .recruitment-candidate-card-actions .recruitment-btn {
      flex: 1 1 auto;
    }

    .recruitment-person {
      min-width: 170px;
    }

    .recruitment-rating-grid {
      grid-template-columns: 1fr !important;
    }

    .recruitment-transition-note {
      top: max(10px, env(safe-area-inset-top));
      width: max-content;
      max-width: calc(100% - 24px);
    }
  }

  @media (max-width: 420px) {
    .recruitment-metric-grid {
      grid-template-columns: 1fr !important;
    }

    .recruitment-metric-card {
      min-height: auto;
    }

    .recruitment-tab-count {
      display: none;
    }

    .recruitment-header-actions .recruitment-btn,
    .recruitment-section-actions .recruitment-btn {
      min-height: 44px;
    }

    .recruitment-interview-card {
      grid-template-columns: 1fr !important;
      text-align: left;
    }

    .recruitment-interview-date {
      width: fit-content;
    }

    .recruitment-rating-options {
      grid-template-columns: repeat(5, minmax(34px, 1fr));
      gap: 6px;
    }
  }

  @media (orientation: landscape) and (max-height: 600px) {
    .recruitment-modal,
    .recruitment-modal-lg,
    .recruitment-drawer {
      max-height: calc(100dvh - 8px) !important;
    }

    .recruitment-modal-head,
    .recruitment-drawer-head {
      padding-block: 11px !important;
    }

    .recruitment-modal-foot,
    .recruitment-drawer-foot {
      padding-block: 10px !important;
    }
  }

  .recruitment-round-editor,
  .recruitment-panel-selector,
  .recruitment-feedback-rounds {
    display: grid;
    gap: 12px;
  }

  .recruitment-round-row,
  .recruitment-panel-member,
  .recruitment-feedback-round,
  .recruitment-feedback-person {
    border: 1px solid rgba(98, 84, 218, .16);
    border-radius: 18px;
    background: rgba(255, 255, 255, .86);
  }

  .recruitment-round-row {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 11px;
  }

  .recruitment-round-number {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: rgba(98, 84, 218, .1);
    color: var(--rec-deep);
    font-weight: 800;
  }

  .recruitment-round-actions,
  .recruitment-panel-roles,
  .recruitment-feedback-summary,
  .recruitment-feedback-role-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .recruitment-icon-btn {
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 1px solid rgba(98, 84, 218, .18);
    border-radius: 11px;
    background: #fff;
    color: var(--rec-deep);
    cursor: pointer;
  }

  .recruitment-icon-btn:disabled {
    opacity: .38;
    cursor: not-allowed;
  }

  .recruitment-panel-member {
    padding: 14px;
  }

  .recruitment-panel-member-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
  }

  .recruitment-panel-member-copy {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .recruitment-role-option {
    display: inline-flex;
    gap: 7px;
    align-items: center;
    padding: 8px 10px;
    border: 1px solid rgba(98, 84, 218, .16);
    border-radius: 12px;
    background: rgba(246, 245, 255, .84);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }

  .recruitment-panel-member.is-selected {
    border-color: rgba(98, 84, 218, .42);
    box-shadow: 0 10px 24px rgba(74, 61, 170, .09);
  }

  .recruitment-feedback-status-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 12px;
  }

  .recruitment-feedback-layout {
    display: grid;
    grid-template-columns: minmax(240px, 310px) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }

  .recruitment-feedback-candidates {
    display: grid;
    gap: 9px;
    max-height: 720px;
    overflow-y: auto;
  }

  .recruitment-feedback-candidate {
    width: 100%;
    padding: 13px;
    border: 1px solid rgba(98, 84, 218, .14);
    border-radius: 15px;
    background: #fff;
    text-align: left;
    cursor: pointer;
  }

  .recruitment-feedback-candidate strong,
  .recruitment-feedback-candidate small {
    display: block;
  }

  .recruitment-feedback-candidate small {
    margin-top: 4px;
    color: var(--rec-muted);
  }

  .recruitment-feedback-candidate.active {
    color: #fff;
    border-color: var(--rec-deep);
    background: linear-gradient(135deg, var(--rec-deep), #6856da);
  }

  .recruitment-feedback-candidate.active small {
    color: rgba(255, 255, 255, .76);
  }

  .recruitment-feedback-sheet-head,
  .recruitment-feedback-round-head,
  .recruitment-feedback-person-head {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: flex-start;
  }

  .recruitment-feedback-round {
    padding: 16px;
  }

  .recruitment-feedback-panel-list {
    display: grid;
    gap: 10px;
    margin-top: 14px;
  }

  .recruitment-feedback-person {
    padding: 14px;
    background: rgba(249, 249, 255, .9);
  }

  .recruitment-feedback-copy-grid,
  .recruitment-feedback-rating-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 12px;
  }

  .recruitment-feedback-copy,
  .recruitment-feedback-rating {
    padding: 10px;
    border-radius: 12px;
    background: #fff;
    border: 1px solid rgba(98, 84, 218, .1);
  }

  .recruitment-feedback-copy.is-full {
    grid-column: 1 / -1;
  }

  .recruitment-feedback-copy span,
  .recruitment-feedback-rating span {
    display: block;
    margin-bottom: 4px;
    color: var(--rec-muted);
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .04em;
  }

  .recruitment-feedback-copy p {
    margin: 0;
    white-space: pre-wrap;
  }

  @media (max-width: 900px) {
    .recruitment-feedback-layout {
      grid-template-columns: 1fr;
    }

    .recruitment-feedback-candidates {
      max-height: 280px;
    }
  }

  @media (max-width: 600px) {
    .recruitment-round-row,
    .recruitment-feedback-copy-grid,
    .recruitment-feedback-rating-list {
      grid-template-columns: 1fr;
    }

    .recruitment-round-actions,
    .recruitment-feedback-sheet-head,
    .recruitment-feedback-round-head,
    .recruitment-feedback-person-head,
    .recruitment-panel-member-head {
      align-items: stretch;
      flex-direction: column;
    }

    .recruitment-feedback-copy.is-full {
      grid-column: auto;
    }
  }
`;

export default function Recruitment() {
  const user = useMemo(() => currentUser() || {}, []);
  const employee = useMemo(() => currentEmployee() || {}, []);
  const roles = useMemo(() => rolesOf(user), [user]);
  const capabilities = useMemo(() => capabilitiesOf(user), [user]);
  const canManage = canAny(roles, HR_ROLES);
  const canHrPublish = canAny(roles, HR_PUBLISH_ROLES);
  const canFinalApprove = canAny(roles, FINAL_APPROVER_ROLES) || canAny(capabilities, FINAL_APPROVER_CAPABILITIES);
  const isTeamLeader = canAny(roles, TEAM_LEADER_ROLES) && !canManage;
  const canCreateRequest = canManage || isTeamLeader;
  const canApproveOffers = canAny(roles, OFFER_APPROVERS);
  const visibleTabs = useMemo(
    () => TABS.filter(([key]) => key !== 'feedback' || canManage),
    [canManage],
  );
  const actorId = idOf(user);
  const userName = user.name || user.full_name || employee.name || employee.employee_name || user.email || 'User';
  const departmentScope = useMemo(() => ({
    department: employee.department_name || employee.department || user.department_name || user.department || '',
    department_id: String(employee.department_id || user.department_id || ''),
  }), [employee, user]);

  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [toasts, setToasts] = useState([]);
  const [transitioning, setTransitioning] = useState(false);
  const [transitionNote, setTransitionNote] = useState('');
  const [matchApplication, setMatchApplication] = useState(null);
  const transitionTimer = useRef(null);
  const [modal, setModal] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [dashboard, setDashboard] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [publishedCareerUrl, setPublishedCareerUrl] = useState('');
  const [requests, setRequests] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [applications, setApplications] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [feedbackApplications, setFeedbackApplications] = useState([]);
  const [feedbackApplicationId, setFeedbackApplicationId] = useState('');
  const [feedbackSheet, setFeedbackSheet] = useState({});
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [offers, setOffers] = useState([]);
  const [reports, setReports] = useState({});
  const [activities, setActivities] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [filters, setFilters] = useState({
    requestSearch: '', requestStatus: '', jobSearch: '', jobStatus: '',
    candidateSearch: '', applicationStatus: '', applicationJob: '',
    interviewStatus: '', offerStatus: '', reportFrom: '', reportTo: '', reportJob: '',
  });

  const dismissToast = useCallback((toastId) => {
    setToasts((items) => items.filter((item) => item.id !== toastId));
  }, []);

  const flash = useCallback((type, message, title = '') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((items) => [...items.slice(-3), { id, type, message, title }]);
    window.setTimeout(() => dismissToast(id), 5200);
  }, [dismissToast]);

  const changeTab = useCallback((nextTab) => {
    if (!nextTab || nextTab === tab || transitioning) return;
    const label = TABS.find(([key]) => key === nextTab)?.[1] || 'Recruitment';
    setTransitionNote(`Opening ${label}…`);
    setTransitioning(true);
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = window.setTimeout(() => {
      setTab(nextTab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      transitionTimer.current = window.setTimeout(() => {
        setTransitioning(false);
        setTransitionNote('');
      }, 260);
    }, 175);
  }, [tab, transitioning]);

  useEffect(() => () => window.clearTimeout(transitionTimer.current), []);

  const loadReferences = useCallback(async () => {
    const values = await Promise.allSettled([
      getActiveEmployees({ limit: 500 }), getDepartments({ limit: 500 }),
      getDesignations({ limit: 500 }), getRecruitmentSettings(),
    ]);
    if (values[0].status === 'fulfilled') setEmployees(listOf(values[0].value));
    if (values[1].status === 'fulfilled') setDepartments(listOf(values[1].value));
    if (values[2].status === 'fulfilled') setDesignations(listOf(values[2].value));
    if (values[3].status === 'fulfilled') {
      const saved = itemOf(values[3].value);
      setSettings({
        ...DEFAULT_SETTINGS,
        ...saved,
        default_interview_rounds: orderedRounds(saved.default_interview_rounds),
      });
    }
  }, []);

  const openFeedbackApplication = useCallback(async (applicationId, quiet = false) => {
    const nextId = String(applicationId || '').trim();
    setFeedbackApplicationId(nextId);
    if (!nextId) {
      setFeedbackSheet({});
      return;
    }
    if (!quiet) setFeedbackLoading(true);
    try {
      setFeedbackSheet(feedbackSheetOf(
        await getRecruitmentApplicationInterviewFeedback(nextId),
      ));
    } catch (error) {
      setFeedbackSheet({});
      flash('danger', messageOf(error, 'Unable to load interview feedback.'));
    } finally {
      if (!quiet) setFeedbackLoading(false);
    }
  }, [flash]);

  const load = useCallback(async (target = tab, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      if (target === 'overview') {
        const [dash, activity] = await Promise.all([getRecruitmentDashboard(), getRecruitmentActivity({ page_size: 12 })]);
        setDashboard(itemOf(dash)); setActivities(listOf(activity));
      } else if (target === 'requests') {
        setRequests(listOf(await getRecruitmentHiringRequests({ page_size: 100, search: filters.requestSearch, status: filters.requestStatus })));
      } else if (target === 'jobs') {
        const [jobRows, requestRows] = await Promise.all([
          getRecruitmentJobOpenings({ page_size: 100, search: filters.jobSearch, status: filters.jobStatus }),
          getRecruitmentHiringRequests({ page_size: 100 }),
        ]);
        setJobs(listOf(jobRows)); setRequests(listOf(requestRows));
      } else if (target === 'candidates') {
        const [candidateRows, applicationRows, jobRows] = await Promise.all([
          getRecruitmentCandidates({ page_size: 100, search: filters.candidateSearch }),
          getRecruitmentApplications({ page_size: 100, status: filters.applicationStatus, job_opening_id: filters.applicationJob }),
          getRecruitmentJobOpenings({ page_size: 100 }),
        ]);
        setCandidates(listOf(candidateRows)); setApplications(listOf(applicationRows)); setJobs(listOf(jobRows));
      } else if (target === 'interviews') {
        const [rows, applicationRows] = await Promise.all([
          getRecruitmentInterviews({ page_size: 100, status: filters.interviewStatus }),
          getRecruitmentApplications({ page_size: 100 }),
        ]);
        setInterviews(listOf(rows)); setApplications(listOf(applicationRows));
      } else if (target === 'feedback') {
        const [applicationRows, interviewRows] = await Promise.all([
          getRecruitmentApplications({ page_size: 100 }),
          getRecruitmentInterviews({ page_size: 100 }),
        ]);
        const allApplications = listOf(applicationRows);
        const allInterviews = listOf(interviewRows);
        const applicationIds = new Set(
          allInterviews.map((item) => String(item.application_id || '')).filter(Boolean),
        );
        const rows = allApplications.filter((item) => applicationIds.has(idOf(item)));
        setApplications(allApplications);
        setInterviews(allInterviews);
        setFeedbackApplications(rows);
        const selectedId = rows.some((item) => idOf(item) === feedbackApplicationId)
          ? feedbackApplicationId
          : idOf(rows[0]);
        await openFeedbackApplication(selectedId, true);
      } else if (target === 'offers') {
        const [rows, applicationRows] = await Promise.all([
          getRecruitmentOffers({ page_size: 100, status: filters.offerStatus }),
          getRecruitmentApplications({ page_size: 100 }),
        ]);
        setOffers(listOf(rows)); setApplications(listOf(applicationRows));
      } else if (target === 'joining') {
        const [applicationRows, offerRows] = await Promise.all([
          getRecruitmentApplications({ page_size: 100 }), getRecruitmentOffers({ page_size: 100 }),
        ]);
        setApplications(listOf(applicationRows)); setOffers(listOf(offerRows));
      } else if (target === 'reports') {
        const [reportRows, jobRows] = await Promise.all([
          getRecruitmentReports({ date_from: filters.reportFrom, date_to: filters.reportTo, job_opening_id: filters.reportJob }),
          getRecruitmentJobOpenings({ page_size: 100 }),
        ]);
        setReports(itemOf(reportRows)); setJobs(listOf(jobRows));
      } else if (target === 'settings') {
        const saved = itemOf(await getRecruitmentSettings());
        setSettings({
          ...DEFAULT_SETTINGS,
          ...saved,
          default_interview_rounds: orderedRounds(saved.default_interview_rounds),
        });
      }
    } catch (error) {
      flash('danger', messageOf(error, 'Unable to load Recruitment data.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [tab, filters, flash, feedbackApplicationId, openFeedbackApplication]);

  useEffect(() => { loadReferences(); }, [loadReferences]);
  useEffect(() => { load(tab); }, [tab]);

  const act = useCallback(async (key, action, success, target = tab, closeDrawer = false) => {
    setBusy(key);
    try {
      const result = await action();
      flash('success', success || result?.message || 'Action completed.');
      setModal(null); setConfirm(null); if (closeDrawer) setDrawer(null);
      await load(target, true);
      return result;
    } catch (error) {
      flash('danger', messageOf(error)); return null;
    } finally { setBusy(''); }
  }, [flash, load, tab]);

  const careerPortalUrl = useMemo(() => {
    const slug = slugOf(settings.public_career_slug);
    if (!slug || typeof window === 'undefined') return '';
    return `${window.location.origin}/career/${encodeURIComponent(slug)}`;
  }, [settings.public_career_slug]);

  const copyCareerPortalLink = useCallback(async (url = careerPortalUrl) => {
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        const input = document.createElement('textarea'); input.value = url; input.setAttribute('readonly', '');
        input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input);
        input.select(); document.execCommand('copy'); document.body.removeChild(input);
      }
      flash('success', 'Career portal link copied to the clipboard.');
    } catch { flash('danger', 'Unable to copy the career portal link. Please copy it manually.'); }
  }, [careerPortalUrl, flash]);

  const publishJobOpening = useCallback(async (job) => {
    const jobId = idOf(job); setBusy(`open-job:${jobId}`);
    try {
      await changeRecruitmentJobOpeningStatus(jobId, { status: 'open', channels: ['career_page'] });
      const nextSettings = { ...DEFAULT_SETTINGS, ...itemOf(await getRecruitmentSettings()) };
      setSettings(nextSettings);
      const slug = slugOf(nextSettings.public_career_slug);
      const url = slug ? `${window.location.origin}/career/${encodeURIComponent(slug)}` : '';
      setPublishedCareerUrl(url); setConfirm(null);
      flash('success', url ? `Job opening published. Public career portal: ${url}` : 'Job opening published.');
      await load('jobs', true);
    } catch (error) { flash('danger', messageOf(error)); } finally { setBusy(''); }
  }, [flash, load]);

  const approvedRequests = useMemo(() => requests.filter((request) => {
    const finalApproved = request.final_approval_completed === true || keyOf(request.final_approval_status) === 'approved';
    return keyOf(request.status) === 'approved' && finalApproved && !jobs.some((job) => String(job.hiring_request_id) === idOf(request) && ['draft', 'open', 'paused'].includes(keyOf(job.status)));
  }), [requests, jobs]);
  const interviewReady = useMemo(() => applications.filter((item) => ['shortlisted', 'on_hold', 'interview_scheduled', 'interviewed'].includes(keyOf(item.status))), [applications]);
  const offerReady = useMemo(() => applications.filter((item) => ['selected', 'offer_pending', 'offer_expired'].includes(keyOf(item.status))), [applications]);
  const joiningRows = useMemo(() => applications.filter((item) => JOINING_STATUSES.has(keyOf(item.status)) || JOINING_STATUSES.has(keyOf(item.joining_status)) || item.offer_accepted_at), [applications]);
  const cards = dashboard.cards || {};
  const counts = { requests: cards.open_hiring_requests, jobs: cards.open_vacancies, candidates: cards.new_applications, interviews: cards.interviews_today, feedback: cards.feedback_pending, offers: cards.offers_awaiting_reply, joining: cards.ready_to_join };

  async function openJoining(application) {
    setBusy(`joining:${idOf(application)}`);
    try {
      const [documents, checks] = await Promise.all([
        getRecruitmentJoiningDocuments(idOf(application)), getRecruitmentBackgroundChecks(idOf(application)),
      ]);
      setDrawer({ application, documents: listOf(documents), checks: listOf(checks) });
    } catch (error) { flash('danger', messageOf(error)); }
    finally { setBusy(''); }
  }

  function overview() {
    const recent = dashboard.recent_applications || [];
    const upcoming = dashboard.upcoming_interviews || [];
    const pipeline = dashboard.pipeline || [];
    return <>
      <div className="recruitment-metric-grid">
        <Metric icon={BriefcaseBusiness} label="Open Vacancies" value={cards.open_vacancies || 0} note="Currently accepting candidates" tone="blue" />
        <Metric icon={UserPlus} label="New Applications" value={cards.new_applications || 0} note="Awaiting first HR review" tone="purple" />
        <Metric icon={CalendarClock} label="Interviews Today" value={cards.interviews_today || 0} note="Scheduled for today" tone="amber" />
        <Metric icon={UserCheck} label="Ready to Join" value={cards.ready_to_join || 0} note="Documents and checks completed" tone="green" />
        <Metric icon={ClipboardCheck} label="Pending Screening" value={cards.pending_screening || 0} note="Applications needing action" tone="amber" />
        <Metric icon={Star} label="Feedback Pending" value={cards.feedback_pending || 0} note="Completed interviews awaiting feedback" tone="purple" />
        <Metric icon={Send} label="Offers Awaiting Reply" value={cards.offers_awaiting_reply || 0} note="Candidate response pending" tone="blue" />
        <Metric icon={UserCheck} label="Joining This Month" value={cards.joining_this_month || 0} note="Expected upcoming employees" tone="green" />
      </div>
      <div className="recruitment-dashboard-grid">
        <section className="recruitment-panel"><SectionHead title="Recent applications" description="Latest candidates entering the pipeline"><button className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" type="button" onClick={() => changeTab('candidates')}>View all <ChevronRight size={14} /></button></SectionHead>
          {recent.length ? <div className="recruitment-quick-list">{recent.map((item) => <button type="button" className="recruitment-quick-item" key={idOf(item)} onClick={() => changeTab('candidates')}><div className="recruitment-quick-item-main"><strong>{item.candidate_name || 'Candidate'}</strong><small>{item.job_title || 'Job'} · {item.reference_no || 'Application'}</small></div><Status value={item.status} /></button>)}</div> : <Empty title="No applications yet" message="New applications will appear here after candidates are added." icon={Inbox} action={canManage ? 'Add candidate' : ''} onAction={() => setModal({ type: 'candidate' })} />}
        </section>
        <section className="recruitment-panel"><SectionHead title="Upcoming interviews" description="Next scheduled candidate discussions" />
          {upcoming.length ? <div className="recruitment-quick-list">{upcoming.map((item) => <div className="recruitment-quick-item" key={idOf(item)}><div className="recruitment-quick-item-main"><strong>{item.candidate_name || 'Candidate'}</strong><small>{item.round_label || 'Interview'} · {formatDate(item.scheduled_at, true)}</small></div><span className="recruitment-due">{labelOf(item.mode)}</span></div>)}</div> : <Empty title="No upcoming interviews" message="Scheduled interviews will appear here." icon={CalendarClock} />}
        </section>
      </div>
      <div className="recruitment-dashboard-grid">
        <section className="recruitment-panel"><SectionHead title="Candidate pipeline" description="Stage-wise application distribution" />
          {pipeline.length ? <div className="recruitment-bar-list">{pipeline.map((item) => { const max = Math.max(...pipeline.map((row) => Number(row.count) || 0), 1); return <div className="recruitment-bar-row" key={item.status}><span className="recruitment-bar-label">{labelOf(item.status)}</span><div className="recruitment-bar-track"><div className="recruitment-bar-fill" style={{ '--bar-value': `${Math.round((Number(item.count || 0) / max) * 100)}%` }} /></div><strong className="recruitment-bar-value">{item.count || 0}</strong></div>; })}</div> : <Empty icon={Gauge} title="Pipeline is empty" message="Stage totals will appear after applications are created." />}
        </section>
        <section className="recruitment-panel"><SectionHead title="Recent activity" description="Important recruitment actions" />
          {activities.length ? <ol className="recruitment-timeline">{activities.slice(0, 8).map((item) => <li className="recruitment-timeline-item" key={idOf(item)}><span className="recruitment-timeline-marker"><Activity size={13} /></span><div className="recruitment-timeline-copy"><strong>{item.message || `${labelOf(item.action)} ${labelOf(item.entity_type)}`}</strong>{item.actor_name ? <p>By {item.actor_name}</p> : null}<time>{formatDate(item.created_at, true)}</time></div></li>)}</ol> : <Empty icon={Activity} title="No activity recorded" message="Workflow changes will appear here." />}
        </section>
      </div>
    </>;
  }

  function requestPage() {
    return <section className="recruitment-panel"><SectionHead title="Hiring requests" description="Team Leaders raise their department need, Admin or Managing Director gives final approval, and HR publishes the vacancy">{canCreateRequest ? <button type="button" className="recruitment-btn recruitment-btn-primary" disabled={isTeamLeader && !departmentScope.department} onClick={() => setModal({ type: 'request' })}><Plus size={15} />New request</button> : null}</SectionHead>
      {isTeamLeader ? <div className="recruitment-scope-note"><ShieldCheck size={17} /><div><strong>Department hiring scope</strong>{departmentScope.department ? `You can create and submit hiring requests only for ${departmentScope.department}. The department is locked, and final approval goes to Admin or the Managing Director.` : 'Your employee profile has no assigned department. Ask HR or Admin to update it before creating a hiring request.'}</div></div> : null}
      <Toolbar search={filters.requestSearch} setSearch={(value) => setFilters((state) => ({ ...state, requestSearch: value }))} status={filters.requestStatus} setStatus={(value) => setFilters((state) => ({ ...state, requestStatus: value }))} statuses={['draft', 'submitted', 'approved', 'rejected', 'on_hold', 'closed']} onApply={() => load('requests')} placeholder="Search request, role or department" />
      {requests.length ? <Table headers={['Request', 'Department', 'Vacancies', 'Required by', 'Budget', 'Status', 'Final approval', 'Requested by', '']} wide>{requests.map((request) => {
        const status = keyOf(request.status);
        const ownRequest = [request.requested_by, request.created_by].map(String).includes(actorId);
        const canSubmit = status === 'draft' && (canManage || (isTeamLeader && ownRequest));
        const canDecide = status === 'submitted' && canFinalApprove && !ownRequest;
        const finalStatus = keyOf(request.final_approval_status) || (request.final_approval_completed ? 'approved' : 'pending');
        return <tr key={idOf(request)}><td><b className="recruitment-table-primary">{request.job_title || 'Untitled role'}</b><small className="recruitment-table-secondary">{request.reference_no || '—'}</small></td><td>{request.department || '—'}{request.department_locked ? <small className="recruitment-table-secondary">Department locked</small> : null}</td><td>{request.vacancies || 1}</td><td>{formatDate(request.expected_joining_date)}</td><td>{request.salary_min || request.salary_max ? `${money(request.salary_min || 0, request.currency)} – ${money(request.salary_max || 0, request.currency)}` : 'Not specified'}</td><td><Status value={status} /></td><td><Status value={finalStatus} /></td><td>{request.requested_by_name || '—'}</td><td><div className="recruitment-table-actions">
          {canSubmit ? <button className="recruitment-btn recruitment-btn-secondary recruitment-btn-sm" type="button" onClick={() => act(`submit:${idOf(request)}`, () => submitRecruitmentHiringRequest(idOf(request)), 'Hiring request sent for final approval.', 'requests')}><Send size={13} />Submit</button> : null}
          {canDecide ? <><button className="recruitment-btn recruitment-btn-success recruitment-btn-sm" type="button" onClick={() => setConfirm({ title: 'Give final hiring approval', message: `Approve the requirement for ${request.job_title}? HR will then be able to create and publish the vacancy.`, label: 'Final approve', tone: 'success', action: () => act(`approve:${idOf(request)}`, () => decideRecruitmentHiringRequest(idOf(request), { decision: 'approved' }), 'Final hiring approval completed. HR has been notified.', 'requests') })}><Check size={13} />Final approve</button><button className="recruitment-btn recruitment-btn-danger recruitment-btn-sm" type="button" onClick={() => setConfirm({ title: 'Reject hiring requirement', message: 'Enter a clear business reason.', label: 'Reject', tone: 'danger', reason: true, action: (text) => act(`reject:${idOf(request)}`, () => decideRecruitmentHiringRequest(idOf(request), { decision: 'rejected', reason: text }), 'Hiring requirement rejected.', 'requests') })}><X size={13} />Reject</button></> : null}
          {canHrPublish && status === 'approved' && finalStatus === 'approved' ? <button className="recruitment-btn recruitment-btn-primary recruitment-btn-sm" type="button" onClick={() => setModal({ type: 'job', request })}><BriefcaseBusiness size={13} />Create job</button> : null}
        </div></td></tr>;
      })}</Table> : <Empty icon={ClipboardCheck} title="No hiring requests found" message="Create a departmental requirement before HR opens a vacancy." action={canCreateRequest && (!isTeamLeader || departmentScope.department) ? 'Create hiring request' : ''} onAction={() => setModal({ type: 'request' })} />}
    </section>;
  }

  function jobsPage() {
    return <section className="recruitment-panel"><SectionHead title="Job openings" description="Prepare, publish, pause and close approved vacancies">{canHrPublish ? <button type="button" className="recruitment-btn recruitment-btn-primary" disabled={!approvedRequests.length} onClick={() => setModal({ type: 'job' })}><Plus size={15} />Create job opening</button> : null}</SectionHead>
      {isTeamLeader ? <div className="recruitment-scope-note"><BriefcaseBusiness size={17} /><div><strong>Assigned hiring work</strong>You can view job openings and candidates only where you are the hiring manager, interview panel member or assigned interviewer. HR controls publishing and closure.</div></div> : null}
      {publishedCareerUrl && canHrPublish ? <div className="recruitment-career-link-card is-published"><span className="recruitment-career-link-icon"><Link2 size={18} /></span><div className="recruitment-career-link-copy"><strong>Job published successfully</strong><span>Your tenant career portal is ready to share.</span><a href={publishedCareerUrl} target="_blank" rel="noreferrer">{publishedCareerUrl}</a></div><div className="recruitment-career-link-actions"><button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" onClick={() => copyCareerPortalLink(publishedCareerUrl)}><Copy size={13} />Copy link</button><a className="recruitment-btn recruitment-btn-primary recruitment-btn-sm" href={publishedCareerUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} />Open portal</a></div></div> : null}
      <Toolbar search={filters.jobSearch} setSearch={(value) => setFilters((state) => ({ ...state, jobSearch: value }))} status={filters.jobStatus} setStatus={(value) => setFilters((state) => ({ ...state, jobStatus: value }))} statuses={['draft', 'open', 'paused', 'closed', 'cancelled']} onApply={() => load('jobs')} placeholder="Search job, reference or department" />
      {jobs.length ? <Table headers={['Job opening', 'Department', 'Location', 'Vacancies', 'Applications', 'Closing', 'Status', 'Channels', '']} wide>{jobs.map((job) => { const status = keyOf(job.status); return <tr key={idOf(job)}><td><b className="recruitment-table-primary">{job.job_title || 'Untitled job'}</b><small className="recruitment-table-secondary">{job.reference_no || job.public_slug || '—'}</small></td><td>{job.department || '—'}</td><td>{job.work_location || '—'}<small className="recruitment-table-secondary">{labelOf(job.work_mode)}</small></td><td>{job.filled_vacancies || 0}/{job.vacancies || 1}</td><td>{job.application_count || 0}</td><td>{formatDate(job.closing_date)}</td><td><Status value={status} /></td><td>{job.published_channels?.length ? job.published_channels.map(labelOf).join(', ') : 'Not published'}</td><td><div className="recruitment-table-actions">
        {canHrPublish && status === 'draft' ? <button type="button" className="recruitment-btn recruitment-btn-success recruitment-btn-sm" onClick={() => setConfirm({ title: 'Publish job opening', message: 'The vacancy will become available on this tenant’s public career portal.', label: 'Publish', tone: 'success', action: () => publishJobOpening(job) })}><Send size={13} />Publish</button> : null}
        {canHrPublish && status === 'open' ? <button type="button" className="recruitment-btn recruitment-btn-warning recruitment-btn-sm" onClick={() => setConfirm({ title: 'Pause job opening', message: 'Applications will pause until reopened.', label: 'Pause', tone: 'warning', reason: true, action: (text) => act(`pause-job:${idOf(job)}`, () => changeRecruitmentJobOpeningStatus(idOf(job), { status: 'paused', reason: text }), 'Job opening paused.', 'jobs') })}><PauseCircle size={13} />Pause</button> : null}
        {canHrPublish && status === 'paused' ? <button type="button" className="recruitment-btn recruitment-btn-success recruitment-btn-sm" onClick={() => act(`reopen-job:${idOf(job)}`, () => changeRecruitmentJobOpeningStatus(idOf(job), { status: 'open' }), 'Job opening reopened.', 'jobs')}><CheckCircle2 size={13} />Reopen</button> : null}
        {canHrPublish && ['open', 'paused'].includes(status) ? <button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" onClick={() => setConfirm({ title: 'Close job opening', message: 'Enter the closure reason.', label: 'Close', reason: true, action: (text) => act(`close-job:${idOf(job)}`, () => changeRecruitmentJobOpeningStatus(idOf(job), { status: 'closed', reason: text }), 'Job opening closed.', 'jobs') })}><XCircle size={13} />Close</button> : null}
      </div></td></tr>; })}</Table> : <Empty icon={BriefcaseBusiness} title="No job openings found" message="An approved hiring request is needed first." action={canHrPublish && approvedRequests.length ? 'Create job opening' : ''} onAction={() => setModal({ type: 'job' })} />}
    </section>;
  }

  function candidatesPage() {
    return <><section className="recruitment-panel"><SectionHead title="Candidates and applications" description="Application-level progress and explainable resume matching for each vacancy">{canManage ? <button type="button" className="recruitment-btn recruitment-btn-primary" onClick={() => setModal({ type: 'candidate' })}><UploadCloud size={15} />Add candidate</button> : null}</SectionHead>
      {isTeamLeader ? <div className="recruitment-scope-note"><Users size={17} /><div><strong>Hiring-team candidate access</strong>You are seeing only candidates connected to jobs where you are the hiring manager, panel member or assigned interviewer. Salary, home address, consent IP and raw parser text remain restricted.</div></div> : null}
      <div className="recruitment-toolbar"><div className="recruitment-filter-grid"><div className="recruitment-search"><Search size={16} /><input className="recruitment-input" value={filters.candidateSearch} onChange={(event) => setFilters((state) => ({ ...state, candidateSearch: event.target.value }))} placeholder="Search candidate, email, phone or skill" /></div><select className="recruitment-select" value={filters.applicationJob} onChange={(event) => setFilters((state) => ({ ...state, applicationJob: event.target.value }))}><option value="">All assigned jobs</option>{jobs.map((job) => <option key={idOf(job)} value={idOf(job)}>{job.job_title} ({job.reference_no})</option>)}</select><select className="recruitment-select" value={filters.applicationStatus} onChange={(event) => setFilters((state) => ({ ...state, applicationStatus: event.target.value }))}><option value="">All stages</option>{['applied', 'under_review', 'shortlisted', 'interview_scheduled', 'interviewed', 'selected', 'rejected', 'on_hold', 'withdrawn'].map((status) => <option key={status} value={status}>{labelOf(status)}</option>)}</select></div><div className="recruitment-filter-actions"><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={() => load('candidates')}><Filter size={15} />Apply</button></div></div>
      {applications.length ? <Table headers={['Candidate', 'Job', 'Source', 'Applied', 'Stage', 'Resume match', 'Screening', '']} wide>{applications.map((item) => {
        const status = keyOf(item.status);
        const matchScore = scoreOf(item);
        return <tr key={idOf(item)}><td><div className="recruitment-person"><span className="recruitment-avatar">{initials(item.candidate_name)}</span><span className="recruitment-person-copy"><strong>{item.candidate_name || 'Candidate'}</strong><small>{item.candidate_email || item.candidate_phone || '—'}</small></span></div></td><td><b className="recruitment-table-primary">{item.job_title || '—'}</b><small className="recruitment-table-secondary">{item.job_reference || item.reference_no}</small></td><td>{labelOf(item.source)}</td><td>{formatDate(item.applied_at)}</td><td><Status value={status} /></td><td>{matchScore === null ? <span className="recruitment-table-secondary">Not calculated</span> : <button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" onClick={() => setMatchApplication(item)} title="Open the explainable resume-match breakdown"><Gauge size={13} />{matchScore}% · {item.resume_match?.label || labelOf(item.resume_match_band)}</button>}</td><td>{item.screening_outcome ? labelOf(item.screening_outcome) : 'Pending'}</td><td><div className="recruitment-table-actions">
          {canManage && ['applied', 'under_review'].includes(status) ? <button type="button" className="recruitment-btn recruitment-btn-secondary recruitment-btn-sm" onClick={() => setModal({ type: 'screen', application: item })}><UserSearch size={13} />Screen</button> : null}
          {canManage && ['shortlisted', 'on_hold', 'interviewed'].includes(status) ? <button type="button" className="recruitment-btn recruitment-btn-primary recruitment-btn-sm" onClick={() => setModal({ type: 'interview', application: item })}><CalendarClock size={13} />Interview</button> : null}
          {canManage && ['interview_scheduled', 'interviewed', 'selected', 'offer_pending', 'offer_sent'].includes(status) ? <button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" onClick={() => { setFeedbackApplicationId(idOf(item)); changeTab('feedback'); }}><Star size={13} />Review feedback</button> : null}
          {canManage && status === 'interviewed' && item.interview_process_completed !== true ? <button type="button" className="recruitment-btn recruitment-btn-secondary recruitment-btn-sm" onClick={() => setConfirm({ title: 'Complete interview process', message: 'This checks that every scheduled round is completed and every assigned interviewer has submitted feedback.', label: 'Complete process', tone: 'primary', action: () => act(`complete-process:${idOf(item)}`, () => completeRecruitmentInterviewProcess(idOf(item)), 'Interview process completed.', 'candidates') })}><ClipboardCheck size={13} />Complete process</button> : null}
          {canManage && status === 'interviewed' && item.interview_process_completed === true ? <button type="button" className="recruitment-btn recruitment-btn-success recruitment-btn-sm" onClick={() => setConfirm({ title: 'Select candidate', message: 'Confirm selection based on completed interviews and human review, not the automated match score alone.', label: 'Select', tone: 'success', action: () => act(`select:${idOf(item)}`, () => changeRecruitmentApplicationStatus(idOf(item), { status: 'selected' }), 'Candidate selected.', 'candidates') })}><BadgeCheck size={13} />Select</button> : null}
          {canManage && !['selected', 'rejected', 'withdrawn', 'joined'].includes(status) ? <button type="button" className="recruitment-btn recruitment-btn-danger recruitment-btn-sm" onClick={() => setConfirm({ title: 'Reject application', message: 'Enter a factual, role-related reason. Do not rely only on the match score.', label: 'Reject', tone: 'danger', reason: true, action: (text) => act(`reject-app:${idOf(item)}`, () => changeRecruitmentApplicationStatus(idOf(item), { status: 'rejected', reason: text, notes: text }), 'Application rejected.', 'candidates') })}><XCircle size={13} />Reject</button> : null}
        </div></td></tr>;
      })}</Table> : <Empty icon={Users} title="No applications found" message={isTeamLeader ? 'No candidates are currently connected to your assigned hiring work.' : 'Upload a resume or add a candidate manually.'} action={canManage ? 'Add candidate' : ''} onAction={() => setModal({ type: 'candidate' })} />}
    </section>
    <section className="recruitment-panel"><SectionHead title="Candidate directory" description={isTeamLeader ? 'Candidate profiles connected to your assigned jobs' : 'Reusable profiles retained separately from job applications'} />{candidates.length ? <Table headers={['Candidate', 'Current role', 'Experience', 'Skills', 'Applications', 'Resume']}>{candidates.map((candidate) => <tr key={idOf(candidate)}><td><div className="recruitment-person"><span className="recruitment-avatar">{initials(candidate.full_name)}</span><span className="recruitment-person-copy"><strong>{candidate.full_name || 'Candidate'}</strong><small>{candidate.email || candidate.phone || '—'}</small></span></div></td><td>{candidate.current_designation || '—'}<small className="recruitment-table-secondary">{candidate.current_employer || ''}</small></td><td>{candidate.total_experience_years ?? candidate.total_experience ? `${candidate.total_experience_years ?? candidate.total_experience} years` : '—'}</td><td><div className="recruitment-chip-list">{(candidate.skills || []).slice(0, 4).map((skill) => <span className="recruitment-chip" key={skill}>{skill}</span>)}</div></td><td>{candidate.application_count || 0}</td><td>{candidate.resume?.relative_path || candidate.resume?.file_path ? <button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" onClick={() => downloadRecruitmentCandidateResume(idOf(candidate), candidate.resume?.original_name || 'candidate-resume').catch((error) => flash('danger', messageOf(error)))}><Download size={13} />Download</button> : '—'}</td></tr>)}</Table> : <Empty icon={UserPlus} title="Candidate directory is empty" message={isTeamLeader ? 'Profiles will appear when candidates apply to jobs assigned to you.' : 'Profiles will appear after HR adds the first candidate.'} />}</section>
    </>;
  }

  function interviewsPage() {
    return <section className="recruitment-panel"><SectionHead title="Interviews" description="Schedule rounds and collect written feedback">{canManage ? <button type="button" className="recruitment-btn recruitment-btn-primary" disabled={!interviewReady.length} onClick={() => setModal({ type: 'interview' })}><Plus size={15} />Schedule interview</button> : null}</SectionHead>
      <Toolbar status={filters.interviewStatus} setStatus={(value) => setFilters((state) => ({ ...state, interviewStatus: value }))} statuses={['scheduled', 'rescheduled', 'completed', 'cancelled', 'candidate_absent', 'interviewer_absent']} onApply={() => load('interviews')} />
      {interviews.length ? <div className="recruitment-interview-list">{interviews.map((item) => {
        const status = keyOf(item.status);
        const date = new Date(item.scheduled_at);
        const panel = Array.isArray(item.interviewer_panel) ? item.interviewer_panel : (item.interviewers || []);
        const summary = item.feedback_summary || {
          assigned: Number(item.feedback_assigned_count || panel.length || 0),
          submitted: Number(item.feedback_submitted_count || item.feedback_count || 0),
          pending: Number(item.feedback_pending_count || 0),
          status: item.feedback_status || (status === 'completed' ? 'pending' : 'not_available'),
          pending_user_ids: [],
        };
        const pendingIds = new Set((summary.pending_user_ids || []).map(String));
        const pendingNames = panel.filter((member) => pendingIds.has(String(member.user_id || member.id || ''))).map((member) => member.name || member.email || 'Assigned interviewer');
        return <article className="recruitment-interview-card" key={idOf(item)}><div className="recruitment-interview-date"><strong>{Number.isNaN(date.getTime()) ? '—' : String(date.getDate()).padStart(2, '0')}</strong><span>{Number.isNaN(date.getTime()) ? 'DATE' : date.toLocaleString('en-IN', { month: 'short' })}</span></div><div className="recruitment-interview-main"><h4>{item.candidate_name || 'Candidate'} · {item.round_label || 'Interview'}</h4><p>{item.job_title || 'Job opening'}</p><div className="recruitment-interview-meta"><span><Clock3 size={12} />{formatDate(item.scheduled_at, true)}</span><span><MapPin size={12} />{item.meeting_link || item.location || labelOf(item.mode)}</span><Status value={status} /></div>{panel.length ? <div className="recruitment-chip-list">{panel.map((member) => <span className="recruitment-chip" key={member.user_id || member.id}>{member.name || member.email || 'Interviewer'}{member.roles?.length ? ` · ${member.roles.map(labelOf).join(', ')}` : ''}</span>)}</div> : null}<small className="recruitment-table-secondary">Feedback: {summary.status === 'not_available' ? 'Not available until this interview is completed' : `${summary.submitted || 0}/${summary.assigned || 0} submitted${pendingNames.length ? ` · Pending: ${pendingNames.join(', ')}` : ''}`}</small></div><div className="recruitment-table-actions">
        {canManage && ['scheduled', 'rescheduled'].includes(status) ? <><button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" onClick={() => setModal({ type: 'reschedule', interview: item })}><CalendarClock size={13} />Reschedule</button><button type="button" className="recruitment-btn recruitment-btn-success recruitment-btn-sm" onClick={() => act(`complete-int:${idOf(item)}`, () => changeRecruitmentInterviewStatus(idOf(item), { status: 'completed' }), 'Interview completed.', 'interviews')}><CheckCircle2 size={13} />Complete</button></> : null}
        {item.can_submit_feedback ? <button type="button" className="recruitment-btn recruitment-btn-primary recruitment-btn-sm" onClick={() => setModal({ type: 'feedback', interview: item })}><Star size={13} />{item.my_feedback_submitted ? 'Edit feedback' : 'Give feedback'}</button> : null}
        {canManage ? <button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" onClick={() => { setFeedbackApplicationId(String(item.application_id || '')); changeTab('feedback'); }}><ClipboardCheck size={13} />Review feedback</button> : null}
      </div></article>;
      })}</div> : <Empty icon={CalendarClock} title="No interviews found" message="Shortlist a candidate before scheduling an interview." action={canManage && interviewReady.length ? 'Schedule interview' : ''} onAction={() => setModal({ type: 'interview' })} />}
    </section>;
  }

  function feedbackPage() {
    const application = feedbackSheet.application || {};
    const rounds = Array.isArray(feedbackSheet.rounds) ? feedbackSheet.rounds : [];
    const summary = feedbackSheet.feedback_summary || {};
    return <section className="recruitment-panel"><SectionHead title="Interview feedback" description="HR and Admin review every round, interviewer role, submitted scorecard and pending response in one place" />
      {feedbackApplications.length ? <div className="recruitment-feedback-layout">
        <aside className="recruitment-feedback-candidates" aria-label="Applications with interviews">{feedbackApplications.map((item) => {
          const itemInterviews = interviews.filter((row) => String(row.application_id || '') === idOf(item));
          const completed = itemInterviews.filter((row) => keyOf(row.status) === 'completed').length;
          return <button type="button" key={idOf(item)} className={`recruitment-feedback-candidate${feedbackApplicationId === idOf(item) ? ' active' : ''}`} onClick={() => openFeedbackApplication(idOf(item))}><strong>{item.candidate_name || 'Candidate'}</strong><small>{item.job_title || 'Job opening'}</small><small>{completed}/{itemInterviews.length} rounds completed · {labelOf(item.status)}</small></button>;
        })}</aside>
        <div>{feedbackLoading ? <Loading /> : feedbackApplicationId && rounds.length ? <>
          <div className="recruitment-feedback-sheet-head"><div><h3>{application.candidate_name || 'Candidate'}</h3><p className="recruitment-muted">{application.job_title || 'Job opening'} · {application.reference_no || 'Application'}</p><div className="recruitment-feedback-summary"><Status value={summary.complete ? 'complete' : (summary.pending ? 'pending' : 'not_available')} /><span className="recruitment-chip">{summary.submitted || 0}/{summary.assigned || 0} submitted</span>{summary.pending ? <span className="recruitment-chip">{summary.pending} pending</span> : null}</div></div>{keyOf(application.status) === 'interviewed' && application.interview_process_completed !== true && summary.complete ? <button type="button" className="recruitment-btn recruitment-btn-primary" onClick={() => setConfirm({ title: 'Complete interview process', message: 'All rounds and assigned feedback are complete. Confirm the process before candidate selection.', label: 'Complete process', tone: 'primary', action: () => act(`complete-process:${idOf(application)}`, () => completeRecruitmentInterviewProcess(idOf(application)), 'Interview process completed.', 'feedback') })}><ClipboardCheck size={15} />Complete process</button> : application.interview_process_completed === true ? <Status value="complete" /> : null}</div>
          {summary.pending_interviewers?.length ? <div className="recruitment-alert recruitment-alert-warning" style={{ marginTop: 14 }}><AlertCircle size={17} /><span>Pending feedback: {summary.pending_interviewers.map((item) => `${item.name || 'Assigned interviewer'} (${item.round_label || 'Interview'})`).join(', ')}</span></div> : null}
          <div className="recruitment-feedback-rounds" style={{ marginTop: 16 }}>{rounds.map((round, roundIndex) => {
            const roundSummary = round.feedback_summary || {};
            const panel = Array.isArray(round.interviewer_panel) ? round.interviewer_panel : [];
            return <article className="recruitment-feedback-round" key={idOf(round.interview) || `${round.round_key}-${roundIndex}`}><div className="recruitment-feedback-round-head"><div><h4>{round.sequence_no || roundIndex + 1}. {round.round_label || labelOf(round.round_key)}</h4><p className="recruitment-muted">{formatDate(round.interview?.scheduled_at, true)} · {labelOf(round.interview?.mode)}</p></div><div className="recruitment-feedback-summary"><Status value={round.status || 'scheduled'} /><Status value={roundSummary.status || 'not_available'} /><span className="recruitment-chip">{roundSummary.submitted || 0}/{roundSummary.assigned || 0}</span></div></div>
              <div className="recruitment-feedback-panel-list">{panel.map((member, memberIndex) => {
                const memberFeedback = member.feedback || null;
                const roles = member.roles || memberFeedback?.interviewer_roles || [];
                return <section className="recruitment-feedback-person" key={member.user_id || memberIndex}><div className="recruitment-feedback-person-head"><div className="recruitment-person"><span className="recruitment-avatar">{initials(member.name || member.email)}</span><span className="recruitment-person-copy"><strong>{member.name || member.email || 'Assigned interviewer'}</strong><small>{roles.length ? roles.map(labelOf).join(' · ') : 'Interviewer'}</small></span></div><Status value={member.feedback_status || (memberFeedback ? 'submitted' : 'not_available')} /></div>
                  {memberFeedback ? <><div className="recruitment-feedback-rating-list"><div className="recruitment-feedback-rating"><span>Overall rating</span><strong>{memberFeedback.overall_rating ?? '—'} / 5</strong></div><div className="recruitment-feedback-rating"><span>Recommendation</span><strong>{labelOf(memberFeedback.recommendation)}</strong></div>{Object.entries(memberFeedback.ratings || {}).map(([key, value]) => <div className="recruitment-feedback-rating" key={key}><span>{labelOf(key)}</span><strong>{value} / 5</strong></div>)}</div><div className="recruitment-feedback-copy-grid"><div className="recruitment-feedback-copy"><span>Strengths</span><p>{textOf(memberFeedback.strengths) || '—'}</p></div><div className="recruitment-feedback-copy"><span>Concerns</span><p>{textOf(memberFeedback.concerns) || '—'}</p></div><div className="recruitment-feedback-copy is-full"><span>Comments</span><p>{textOf(memberFeedback.comments) || '—'}</p></div></div></> : <p className="recruitment-feedback-status-line">{member.feedback_status === 'pending' ? 'Interview completed; this interviewer still needs to submit feedback.' : 'Feedback becomes available after this interview is completed.'}</p>}
                </section>;
              })}</div>
            </article>;
          })}</div>
        </> : <Empty icon={ClipboardCheck} title="No feedback sheet available" message="Choose an application with scheduled interviews." />}</div>
      </div> : <Empty icon={ClipboardCheck} title="No interview feedback found" message="Applications appear here after the first interview is scheduled." />}
    </section>;
  }

  function offersPage() {
    return <section className="recruitment-panel"><SectionHead title="Offers" description="Prepare approved terms, send offers and track responses">{canManage ? <button type="button" className="recruitment-btn recruitment-btn-primary" disabled={!offerReady.length} onClick={() => setModal({ type: 'offer' })}><Plus size={15} />Prepare offer</button> : null}</SectionHead>
      <Toolbar status={filters.offerStatus} setStatus={(value) => setFilters((state) => ({ ...state, offerStatus: value }))} statuses={['draft', 'approval_pending', 'approved', 'sent', 'accepted', 'declined', 'expired', 'withdrawn']} onApply={() => load('offers')} />
      {offers.length ? <div className="recruitment-offer-grid">{offers.map((offer) => { const status = keyOf(offer.status); const terms = offer.terms || offer; return <article className="recruitment-offer-card" key={idOf(offer)}><div className="recruitment-offer-card-head"><div><h4>{offer.candidate_name || 'Candidate'}</h4><p>{offer.job_title || terms.designation || 'Position'} · {offer.reference_no || 'Offer'}</p></div><Status value={status} /></div><dl className="recruitment-detail-list"><div className="recruitment-detail-row"><dt>Designation</dt><dd>{terms.designation || offer.job_title || '—'}</dd></div><div className="recruitment-detail-row"><dt>Approved salary</dt><dd>{terms.salary?.gross ? money(terms.salary.gross, terms.currency) : terms.salary_summary || '—'}</dd></div><div className="recruitment-detail-row"><dt>Joining date</dt><dd>{formatDate(terms.joining_date)}</dd></div><div className="recruitment-detail-row"><dt>Response deadline</dt><dd>{formatDate(terms.response_deadline)}</dd></div></dl><div className="recruitment-candidate-card-actions">
        {canManage && status === 'draft' ? <button type="button" className="recruitment-btn recruitment-btn-secondary recruitment-btn-sm" onClick={() => act(`submit-offer:${idOf(offer)}`, () => submitRecruitmentOfferForApproval(idOf(offer), {}), 'Offer submitted for approval.', 'offers')}><Send size={13} />Submit approval</button> : null}
        {canApproveOffers && status === 'approval_pending' ? <><button type="button" className="recruitment-btn recruitment-btn-success recruitment-btn-sm" onClick={() => act(`approve-offer:${idOf(offer)}`, () => decideRecruitmentOffer(idOf(offer), { decision: 'approved' }), 'Offer approved.', 'offers')}><Check size={13} />Approve</button><button type="button" className="recruitment-btn recruitment-btn-danger recruitment-btn-sm" onClick={() => setConfirm({ title: 'Reject offer', message: 'Enter the reason.', label: 'Reject', tone: 'danger', reason: true, action: (text) => act(`reject-offer:${idOf(offer)}`, () => decideRecruitmentOffer(idOf(offer), { decision: 'rejected', reason: text }), 'Offer rejected.', 'offers') })}><X size={13} />Reject</button></> : null}
        {canManage && status === 'approved' ? <button type="button" className="recruitment-btn recruitment-btn-primary recruitment-btn-sm" onClick={() => setConfirm({ title: 'Send offer', message: 'The candidate will receive the approved offer and response link.', label: 'Send offer', action: () => act(`send-offer:${idOf(offer)}`, () => sendRecruitmentOffer(idOf(offer), {}), 'Offer sent.', 'offers') })}><Mail size={13} />Send</button> : null}
      </div></article>; })}</div> : <Empty icon={FileCheck2} title="No offers found" message="Select a candidate before preparing an offer." action={canManage && offerReady.length ? 'Prepare offer' : ''} onAction={() => setModal({ type: 'offer' })} />}
    </section>;
  }

  function joiningPage() {
    return <section className="recruitment-panel"><SectionHead title="Joining" description="Review accepted offers, documents, checks and employee conversion" />
      {joiningRows.length ? <div className="recruitment-joining-grid">{joiningRows.map((item) => { const status = keyOf(item.joining_status || item.status) || 'documents_pending'; const offer = offers.find((row) => String(row.application_id || '') === idOf(item) && ['accepted', 'sent', 'approved'].includes(keyOf(row.status))); const progress = status === 'joined' ? 100 : status === 'ready_to_join' ? 85 : status === 'joining_deferred' ? 55 : 35; return <article className="recruitment-joining-card" key={idOf(item)}><div className="recruitment-joining-card-head"><div><h4>{item.candidate_name || 'Candidate'}</h4><p>{item.job_title || 'Position'} · {item.reference_no || 'Application'}</p></div><Status value={status} /></div><dl className="recruitment-detail-list"><div className="recruitment-detail-row"><dt>Expected joining</dt><dd>{formatDate(item.joining_date || offer?.terms?.joining_date || offer?.joining_date)}</dd></div><div className="recruitment-detail-row"><dt>Offer</dt><dd>{offer ? labelOf(offer.status) : 'Accepted'}</dd></div><div className="recruitment-detail-row"><dt>Documents</dt><dd>{item.document_progress_label || 'Review pending'}</dd></div></dl><div style={{ marginTop: 13 }}><div className="recruitment-progress"><div className={`recruitment-progress-fill${progress === 100 ? ' is-complete' : ''}`} style={{ '--progress': `${progress}%` }} /></div></div><div className="recruitment-candidate-card-actions"><button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" disabled={busy === `joining:${idOf(item)}`} onClick={() => openJoining(item)}><FileText size={13} />Review</button>{canManage && status === 'ready_to_join' ? <button type="button" className="recruitment-btn recruitment-btn-success recruitment-btn-sm" onClick={() => setModal({ type: 'convert', application: item, offer })}><UserCheck size={13} />Convert to employee</button> : null}{canManage && !['joined', 'did_not_join'].includes(status) ? <button type="button" className="recruitment-btn recruitment-btn-warning recruitment-btn-sm" onClick={() => setConfirm({ title: 'Defer joining', message: 'Enter the reason and revised joining date.', label: 'Defer', tone: 'warning', reason: true, date: true, action: (text, date) => act(`defer:${idOf(item)}`, () => changeRecruitmentJoiningStatus(idOf(item), { status: 'joining_deferred', reason: text, joining_date: date }), 'Joining deferred.', 'joining') })}><Clock3 size={13} />Defer</button> : null}</div></article>; })}</div> : <Empty icon={UserCheck} title="No candidates in pre-joining" message="Candidates appear here after accepting an offer." />}
    </section>;
  }

  function reportsPage() {
    const summary = reports.summary || {};
    const stages = reports.candidate_stages || [];
    const sources = reports.application_sources || [];
    const jobRows = reports.jobs || [];
    const offerRows = reports.offers || [];
    const maxStage = Math.max(...stages.map((item) => Number(item.count) || 0), 1);
    const maxSource = Math.max(...sources.map((item) => Number(item.count) || 0), 1);
    return <><section className="recruitment-panel"><SectionHead title="Recruitment reports" description="Review candidate movement, sources, offers and joining conversion" /><div className="recruitment-toolbar"><div className="recruitment-filter-grid"><input className="recruitment-input" type="date" value={filters.reportFrom} onChange={(event) => setFilters((state) => ({ ...state, reportFrom: event.target.value }))} /><input className="recruitment-input" type="date" value={filters.reportTo} onChange={(event) => setFilters((state) => ({ ...state, reportTo: event.target.value }))} /><select className="recruitment-select" value={filters.reportJob} onChange={(event) => setFilters((state) => ({ ...state, reportJob: event.target.value }))}><option value="">All job openings</option>{jobs.map((job) => <option key={idOf(job)} value={idOf(job)}>{job.job_title}</option>)}</select></div><div className="recruitment-filter-actions"><button type="button" className="recruitment-btn recruitment-btn-primary" onClick={() => load('reports')}><Filter size={15} />Generate</button></div></div></section>
      <div className="recruitment-metric-grid"><Metric icon={Users} label="Applications" value={summary.applications || 0} note="In the selected period" tone="blue" /><Metric icon={UserCheck} label="Joined" value={summary.joined || 0} note={`${summary.join_conversion_percent || 0}% conversion`} tone="green" /><Metric icon={Send} label="Offers Sent" value={summary.offers_sent || 0} note="Issued to candidates" tone="purple" /><Metric icon={BadgeCheck} label="Offers Accepted" value={summary.offers_accepted || 0} note={`${summary.offer_acceptance_percent || 0}% acceptance`} tone="amber" /></div>
      <div className="recruitment-report-grid"><ReportBars title="Candidate stages" rows={stages} keyName="status" max={maxStage} /><ReportBars title="Application sources" rows={sources} keyName="source" max={maxSource} color="#059669" /><ReportStats title="Applications by job" rows={jobRows.map((item) => ({ label: item.job_title || 'Untitled job', value: item.count || 0 }))} /><ReportStats title="Offer outcomes" rows={offerRows.map((item) => ({ label: labelOf(item.status), value: item.count || 0 }))} /></div>
    </>;
  }

  function settingsPage() {
    return <section className="recruitment-panel"><SectionHead title="Recruitment settings" description="Company-specific workflow and communication controls" />
      <form className="recruitment-form" onSubmit={(event) => { event.preventDefault(); act('settings', () => updateRecruitmentSettings(settings), 'Recruitment settings updated.', 'settings'); }}>
        <div className="recruitment-career-link-card"><span className="recruitment-career-link-icon"><Link2 size={18} /></span><div className="recruitment-career-link-copy"><strong>Public career portal link</strong><span>This direct link automatically uses the active YourComate domain and this tenant’s career slug.</span>{careerPortalUrl ? <a href={careerPortalUrl} target="_blank" rel="noreferrer">{careerPortalUrl}</a> : <em>Save a valid career page slug to generate the public link.</em>}</div><div className="recruitment-career-link-actions"><button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" disabled={!careerPortalUrl} onClick={() => copyCareerPortalLink()}><Copy size={13} />Copy link</button><a className={`recruitment-btn recruitment-btn-primary recruitment-btn-sm${careerPortalUrl ? '' : ' is-disabled'}`} href={careerPortalUrl || undefined} target="_blank" rel="noreferrer" aria-disabled={!careerPortalUrl} onClick={(event) => { if (!careerPortalUrl) event.preventDefault(); }}><ExternalLink size={13} />Open portal</a></div></div>
        <div className="recruitment-form-section"><h3 className="recruitment-form-section-title">Workflow controls</h3><div className="recruitment-form-grid">{[
          ['module_enabled', 'Recruitment module enabled'], ['career_page_enabled', 'Public career page enabled'], ['allow_employee_referrals', 'Allow employee referrals'], ['require_hiring_request_approval', 'Require hiring request approval'], ['require_salary_approval', 'Require salary and offer approval'],
        ].map(([key, label]) => <label className="recruitment-checkbox-row" key={key}><input type="checkbox" checked={Boolean(settings[key])} disabled={!canManage} onChange={(event) => setSettings((state) => ({ ...state, [key]: event.target.checked }))} /><span>{label}</span></label>)}</div></div>
        <InterviewRoundsEditor rounds={settings.default_interview_rounds} disabled={!canManage} onChange={(default_interview_rounds) => setSettings((state) => ({ ...state, default_interview_rounds }))} />
        <div className="recruitment-form-section"><h3 className="recruitment-form-section-title">General defaults</h3><div className="recruitment-form-grid recruitment-form-grid-3"><Field label="Default currency"><select value={settings.default_currency || 'INR'} disabled={!canManage} onChange={(event) => setSettings((state) => ({ ...state, default_currency: event.target.value }))}>{['INR', 'USD', 'BDT', 'EUR', 'GBP'].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Default application source"><select value={settings.default_application_source || 'career_page'} disabled={!canManage} onChange={(event) => setSettings((state) => ({ ...state, default_application_source: event.target.value }))}>{['career_page', 'manual', 'employee_referral', 'job_portal', 'social_media', 'agency'].map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select></Field><Field label="Employee code prefix"><input value={settings.employee_code_prefix || ''} disabled={!canManage} onChange={(event) => setSettings((state) => ({ ...state, employee_code_prefix: event.target.value.toUpperCase() }))} /></Field><Field label="Candidate retention days"><input type="number" min="30" value={settings.candidate_retention_days || 730} disabled={!canManage} onChange={(event) => setSettings((state) => ({ ...state, candidate_retention_days: Number(event.target.value) }))} /></Field><Field label="Maximum resume size (MB)"><input type="number" min="1" max="25" value={settings.resume_max_size_mb || 8} disabled={!canManage} onChange={(event) => setSettings((state) => ({ ...state, resume_max_size_mb: Number(event.target.value) }))} /></Field><Field label="Career page slug"><input value={settings.public_career_slug || ''} disabled={!canManage} onChange={(event) => setSettings((state) => ({ ...state, public_career_slug: slugOf(event.target.value) }))} /></Field></div></div>
        <div className="recruitment-form-section"><h3 className="recruitment-form-section-title">Candidate emails</h3><div className="recruitment-form-grid">{[
          ['email_candidate_on_application', 'Application received confirmation'], ['email_candidate_on_interview', 'Interview invitations and changes'], ['email_candidate_on_offer', 'Approved offer communication'], ['email_candidate_on_rejection', 'Respectful rejection communication'],
        ].map(([key, label]) => <label className="recruitment-checkbox-row" key={key}><input type="checkbox" checked={Boolean(settings[key])} disabled={!canManage} onChange={(event) => setSettings((state) => ({ ...state, [key]: event.target.checked }))} /><span>{label}</span></label>)}</div></div>
        {canManage ? <div className="recruitment-form-actions"><button type="submit" className="recruitment-btn recruitment-btn-primary" disabled={busy === 'settings'}>{busy === 'settings' ? <Loader2 size={15} /> : <Check size={15} />}Save settings</button></div> : null}
      </form>
    </section>;
  }

  const primaryActionType = (() => {
    if (tab === 'jobs' && canHrPublish) return 'job';
    if (tab === 'candidates' && canManage) return 'candidate';
    if (tab === 'interviews' && canManage) return 'interview';
    if (tab === 'offers' && canManage) return 'offer';
    if (['overview', 'requests'].includes(tab) && canCreateRequest) return 'request';
    return '';
  })();

  const openPrimaryAction = () => {
    if (!primaryActionType) return;
    if (primaryActionType === 'request' && isTeamLeader && !departmentScope.department) {
      flash('warning', 'Your employee profile has no assigned department. Ask HR or Admin to update it before creating a hiring request.');
      return;
    }
    setModal({ type: primaryActionType });
  };

  function content() {
    if (loading) return <Loading />;
    if (tab === 'overview') return overview();
    if (tab === 'requests') return requestPage();
    if (tab === 'jobs') return jobsPage();
    if (tab === 'candidates') return candidatesPage();
    if (tab === 'interviews') return interviewsPage();
    if (tab === 'feedback') return feedbackPage();
    if (tab === 'offers') return offersPage();
    if (tab === 'joining') return joiningPage();
    if (tab === 'reports') return reportsPage();
    if (tab === 'settings') return settingsPage();
    return null;
  }

  return <main className="recruitment-page">
    <style>{RECRUITMENT_VISUAL_STYLES}</style>
    <style>{RECRUITMENT_RESPONSIVE_REFINEMENTS}</style>
    {transitioning ? <><div className="recruitment-route-progress" aria-hidden="true" /><div className="recruitment-transition-note" role="status"><Loader2 size={13} />{transitionNote || 'Opening section…'}</div></> : null}
    <ToastRegion toasts={toasts} onClose={dismissToast} />
    <header className="recruitment-header"><div className="recruitment-header-copy"><span className="recruitment-eyebrow"><ShieldCheck size={14} />YourComate Recruitment</span><h1>Recruitment</h1><p>Team Leaders raise department needs, Admin or the Managing Director gives final approval, HR publishes vacancies, and the assigned hiring team reviews candidates through one protected workflow.</p></div><div className="recruitment-header-actions"><span className="recruitment-header-note"><Sparkles size={14} />Explainable resume matching · human decision required</span><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={() => load(tab)} disabled={loading}><RefreshCw size={15} />Refresh</button>{primaryActionType ? <button type="button" className="recruitment-btn recruitment-btn-primary" onClick={openPrimaryAction}><Plus size={15} />New action</button> : null}</div></header>
    <nav className="recruitment-tabs-shell" aria-label="Recruitment sections"><div className="recruitment-tabs" role="tablist">{visibleTabs.map(([key, label, Icon]) => <button type="button" role="tab" aria-selected={tab === key} className={`recruitment-tab${tab === key ? ' active' : ''}`} key={key} onClick={() => changeTab(key)} disabled={transitioning}><Icon size={15} />{label}{Number(counts[key]) > 0 ? <span className="recruitment-tab-count">{counts[key]}</span> : null}</button>)}</div></nav>
    <div className={`recruitment-route-stage${transitioning ? ' is-leaving' : ''}`} key={tab}>{content()}</div>

    {modal?.type === 'request' ? <RequestModal employees={employees} departments={departments} busy={busy === 'create-request'} isTeamLeader={isTeamLeader} departmentScope={departmentScope} actorId={actorId} actorName={userName} onClose={() => setModal(null)} onSave={(payload) => act('create-request', () => createRecruitmentHiringRequest(payload), 'Hiring request created as a draft.', 'requests')} /> : null}
    {modal?.type === 'job' ? <JobModal requests={approvedRequests} initial={modal.request} employees={employees} busy={busy === 'create-job'} onClose={() => setModal(null)} onSave={(payload) => act('create-job', () => createRecruitmentJobOpening(payload), 'Job opening created as a draft.', 'jobs')} /> : null}
    {modal?.type === 'candidate' ? <CandidateModal jobs={jobs.filter((job) => ['open', 'draft'].includes(keyOf(job.status)))} busy={busy === 'create-candidate'} onClose={() => setModal(null)} onSave={async ({ candidatePayload, resumeFile, jobOpeningId, source }) => { setBusy('create-candidate'); try { const result = await createRecruitmentCandidate(candidatePayload, resumeFile); const candidate = itemOf(result); if (jobOpeningId) await createRecruitmentApplication({ candidate_id: idOf(candidate), job_opening_id: jobOpeningId, source }); flash('success', jobOpeningId ? 'Candidate and application created.' : 'Candidate saved.'); setModal(null); await load('candidates', true); } catch (error) { flash('danger', messageOf(error)); } finally { setBusy(''); } }} /> : null}
    {modal?.type === 'screen' ? <ScreenModal application={modal.application} busy={busy === `screen:${idOf(modal.application)}`} onClose={() => setModal(null)} onSave={(payload) => act(`screen:${idOf(modal.application)}`, () => updateRecruitmentScreening(idOf(modal.application), payload), 'Candidate screening saved.', 'candidates')} /> : null}
    {modal?.type === 'interview' ? <InterviewModal applications={interviewReady} initial={modal.application} employees={employees} settings={settings} busy={busy === 'create-interview'} onClose={() => setModal(null)} onSave={(payload) => act('create-interview', () => scheduleRecruitmentInterview(payload.application_id, payload), 'Interview scheduled.', 'interviews')} /> : null}
    {modal?.type === 'reschedule' ? <RescheduleModal interview={modal.interview} busy={busy === `reschedule:${idOf(modal.interview)}`} onClose={() => setModal(null)} onSave={(payload) => act(`reschedule:${idOf(modal.interview)}`, () => rescheduleRecruitmentInterview(idOf(modal.interview), payload), 'Interview rescheduled.', 'interviews')} /> : null}
    {modal?.type === 'feedback' ? <FeedbackModal interview={modal.interview} busy={busy === `feedback:${idOf(modal.interview)}`} onClose={() => setModal(null)} onSave={(payload) => act(`feedback:${idOf(modal.interview)}`, () => submitRecruitmentInterviewFeedback(idOf(modal.interview), payload), 'Feedback submitted.', 'interviews')} /> : null}
    {modal?.type === 'offer' ? <OfferModal applications={offerReady} initial={modal.application} employees={employees} designations={designations} settings={settings} busy={busy === 'create-offer'} onClose={() => setModal(null)} onSave={({ applicationId, payload, offerFile }) => act('create-offer', () => createRecruitmentOffer(applicationId, payload, offerFile), 'Offer draft created.', 'offers')} /> : null}
    {modal?.type === 'convert' ? <ConvertModal application={modal.application} offer={modal.offer} departments={departments} designations={designations} employees={employees} busy={busy === `convert:${idOf(modal.application)}`} onClose={() => setModal(null)} onSave={(payload) => act(`convert:${idOf(modal.application)}`, () => convertRecruitmentCandidateToEmployee(idOf(modal.application), payload), 'Candidate converted to an employee.', 'joining')} /> : null}
    {matchApplication ? <Modal title={`Resume match · ${matchApplication.candidate_name || 'Candidate'}`} subtitle={`${matchApplication.job_title || 'Job'} · ${matchApplication.reference_no || 'Application'}`} onClose={() => setMatchApplication(null)} large><ResumeMatchCard application={matchApplication} /></Modal> : null}
    {confirm ? <ConfirmModal {...confirm} busy={Boolean(busy)} onClose={() => setConfirm(null)} /> : null}
    {drawer ? <JoiningDrawer state={drawer} canManage={canManage} busy={busy} onClose={() => setDrawer(null)} onDownload={(document) => downloadRecruitmentJoiningDocument(idOf(document), document.file_name || 'joining-document').catch((error) => flash('danger', messageOf(error)))} onReview={(document, status, reason = '') => act(`review-doc:${idOf(document)}`, () => reviewRecruitmentJoiningDocument(idOf(document), { status, reason }), 'Document review saved.', 'joining', true)} onCheck={(payload) => act(`check:${idOf(drawer.application)}`, () => updateRecruitmentBackgroundCheck(idOf(drawer.application), payload), 'Background check updated.', 'joining', true)} onDidNotJoin={() => setConfirm({ title: 'Mark as did not join', message: 'Enter a clear reason.', label: 'Mark did not join', tone: 'danger', reason: true, action: (text) => act(`dnjoin:${idOf(drawer.application)}`, () => changeRecruitmentJoiningStatus(idOf(drawer.application), { status: 'did_not_join', reason: text }), 'Candidate marked as did not join.', 'joining', true) })} /> : null}
  </main>;
}

function InterviewRoundsEditor({ rounds, disabled, onChange }) {
  const items = Array.isArray(rounds) ? rounds : [];
  const apply = (next) => onChange(next.map((item, index) => ({
    ...item,
    order: index + 1,
    sequence_no: index + 1,
  })));
  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    apply(next);
  };
  const add = () => {
    const keys = new Set(items.map((item) => item.key));
    let suffix = items.length + 1;
    let key = `interview_round_${suffix}`;
    while (keys.has(key)) { suffix += 1; key = `interview_round_${suffix}`; }
    apply([...items, { key, label: `Interview Round ${items.length + 1}` }]);
  };
  return <div className="recruitment-form-section"><div className="recruitment-section-head"><div><h3 className="recruitment-form-section-title">Interview rounds</h3><p>Rename or reorder tenant rounds. The stable round key is preserved when its label changes.</p></div>{!disabled ? <button type="button" className="recruitment-btn recruitment-btn-secondary recruitment-btn-sm" onClick={add}><Plus size={13} />Add round</button> : null}</div><div className="recruitment-round-editor">{items.map((round, index) => <div className="recruitment-round-row" key={round.key}><span className="recruitment-round-number">{index + 1}</span><Field label="Round label" hint={`Key: ${round.key}`}><input required value={round.label || ''} disabled={disabled} onChange={(event) => apply(items.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} /></Field><div className="recruitment-round-actions"><button type="button" className="recruitment-icon-btn" title="Move round up" aria-label={`Move ${round.label} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button type="button" className="recruitment-icon-btn" title="Move round down" aria-label={`Move ${round.label} down`} disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button type="button" className="recruitment-icon-btn" title="Remove round" aria-label={`Remove ${round.label}`} disabled={disabled || items.length <= 1} onClick={() => apply(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div></div>)}</div></div>;
}

function Toolbar({ search, setSearch, status, setStatus, statuses = [], onApply, placeholder = 'Search' }) {
  return <div className="recruitment-toolbar"><div className="recruitment-filter-grid">{setSearch ? <div className="recruitment-search"><Search size={16} /><input className="recruitment-input" value={search || ''} onChange={(event) => setSearch(event.target.value)} placeholder={placeholder} /></div> : null}{setStatus ? <select className="recruitment-select" value={status || ''} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select> : null}</div><div className="recruitment-filter-actions"><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onApply}><Filter size={15} />Apply</button></div></div>;
}
function Table({ headers, children, wide }) {
  return <div className="recruitment-table-shell"><div className="recruitment-table-scroll"><table className={`recruitment-table${wide ? ' recruitment-table-wide' : ''}`}><thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div></div>;
}
function ReportBars({ title, rows, keyName, max, color }) {
  return <section className="recruitment-report-card"><h4>{title}</h4><p>Count recorded for each category.</p>{rows.length ? <div className="recruitment-bar-list">{rows.map((item) => <div className="recruitment-bar-row" key={item[keyName]}><span className="recruitment-bar-label">{labelOf(item[keyName])}</span><div className="recruitment-bar-track"><div className="recruitment-bar-fill" style={{ '--bar-value': `${Math.round(((Number(item.count) || 0) / max) * 100)}%`, ...(color ? { '--bar-color': color } : {}) }} /></div><strong className="recruitment-bar-value">{item.count || 0}</strong></div>)}</div> : <p className="recruitment-muted">No data available.</p>}</section>;
}
function ReportStats({ title, rows }) {
  return <section className="recruitment-report-card"><h4>{title}</h4><p>Summary for the selected period.</p><div className="recruitment-stat-list">{rows.length ? rows.slice(0, 10).map((item, index) => <div className="recruitment-stat-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.value}</strong></div>) : <p className="recruitment-muted">No data available.</p>}</div></section>;
}

function RequestModal({ employees, departments, busy, isTeamLeader, departmentScope, actorId, actorName, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY_REQUEST,
    department: isTeamLeader ? departmentScope.department : '',
    department_id: isTeamLeader ? departmentScope.department_id : '',
    hiring_manager_user_id: isTeamLeader ? actorId : '',
    leadership_approval_required: true,
  }));
  const update = (key, value) => setForm((state) => ({ ...state, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    const manager = employees.find((item) => employeeUserId(item) === form.hiring_manager_user_id);
    onSave({
      ...form,
      department: isTeamLeader ? departmentScope.department : form.department,
      department_id: isTeamLeader ? departmentScope.department_id : form.department_id,
      vacancies: Number(form.vacancies || 1),
      salary_min: form.salary_min === '' ? null : Number(form.salary_min),
      salary_max: form.salary_max === '' ? null : Number(form.salary_max),
      required_skills: commaList(form.required_skills),
      hiring_manager_user_id: isTeamLeader ? actorId : form.hiring_manager_user_id,
      hiring_manager_name: isTeamLeader ? actorName : manager ? employeeName(manager) : '',
      approver_user_ids: isTeamLeader ? [] : form.approver_user_id ? [form.approver_user_id] : [],
      leadership_approval_required: true,
    });
  };
  const departmentMissing = isTeamLeader && !departmentScope.department;
  return <Modal title="Create hiring request" subtitle={isTeamLeader ? 'Raise a manpower need for your assigned department. Final approval goes to Admin or the Managing Director.' : 'Record the business need before HR opens a vacancy.'} onClose={onClose} large footer={<><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onClose}>Cancel</button><button type="submit" form="request-form" className="recruitment-btn recruitment-btn-primary" disabled={busy || departmentMissing}>{busy ? <Loader2 size={15} /> : <Check size={15} />}Save draft</button></>}>
    <form id="request-form" className="recruitment-form" onSubmit={submit}>
      {isTeamLeader ? <div className={`recruitment-alert ${departmentMissing ? 'recruitment-alert-danger' : 'recruitment-alert-success'}`}>{departmentMissing ? <AlertCircle size={17} /> : <ShieldCheck size={17} />}<span>{departmentMissing ? 'Your employee profile has no assigned department. Ask HR or Admin to update it before creating a request.' : `Department is locked to ${departmentScope.department}. You cannot create a request for another department or approve your own request.`}</span></div> : null}
      <div className="recruitment-form-section"><h3 className="recruitment-form-section-title">Position requirement</h3><div className="recruitment-form-grid recruitment-form-grid-3">
        <Field label="Job title" required><input required value={form.job_title} onChange={(event) => update('job_title', event.target.value)} /></Field>
        <Field label="Department" required hint={isTeamLeader ? 'Automatically taken from your employee profile.' : ''}>{isTeamLeader ? <input required readOnly value={departmentScope.department || ''} /> : <select required value={form.department} onChange={(event) => { const selected = departments.find((item) => optionName(item) === event.target.value); setForm((state) => ({ ...state, department: event.target.value, department_id: idOf(selected) })); }}><option value="">Choose department</option>{departments.map((item) => <option key={idOf(item) || optionName(item)}>{optionName(item)}</option>)}</select>}</Field>
        <Field label="Vacancies" required><input required type="number" min="1" value={form.vacancies} onChange={(event) => update('vacancies', event.target.value)} /></Field>
        <Field label="Employment type"><select value={form.employment_type} onChange={(event) => update('employment_type', event.target.value)}>{['permanent', 'contract', 'temporary', 'trainee', 'consultant', 'intern'].map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select></Field>
        <Field label="Work location"><input value={form.work_location} onChange={(event) => update('work_location', event.target.value)} /></Field>
        <Field label="Expected joining date"><input type="date" value={form.expected_joining_date} onChange={(event) => update('expected_joining_date', event.target.value)} /></Field>
      </div></div>
      <div className="recruitment-form-section"><h3 className="recruitment-form-section-title">Business justification</h3><div className="recruitment-form-grid">
        <Field label="Business reason" required full><textarea required value={form.business_reason} onChange={(event) => update('business_reason', event.target.value)} placeholder="Replacement, growth, new project or another approved need" /></Field>
        <Field label="Required experience"><input value={form.required_experience} onChange={(event) => update('required_experience', event.target.value)} placeholder="Example: 3-5 years or Fresher" /></Field>
        <Field label="Qualification"><input value={form.qualification} onChange={(event) => update('qualification', event.target.value)} /></Field>
        <Field label="Required skills" full hint="Separate skills with commas. These structured skills support the explainable resume-match score."><input value={form.required_skills} onChange={(event) => update('required_skills', event.target.value)} /></Field>
      </div></div>
      <div className="recruitment-form-section"><h3 className="recruitment-form-section-title">Budget and final approval</h3><div className="recruitment-form-grid recruitment-form-grid-3">
        <Field label="Minimum salary"><input type="number" min="0" value={form.salary_min} onChange={(event) => update('salary_min', event.target.value)} /></Field>
        <Field label="Maximum salary"><input type="number" min="0" value={form.salary_max} onChange={(event) => update('salary_max', event.target.value)} /></Field>
        <Field label="Currency"><select value={form.currency} onChange={(event) => update('currency', event.target.value)}>{['INR', 'USD', 'BDT', 'EUR', 'GBP'].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="Hiring manager" hint={isTeamLeader ? 'Automatically set to you.' : ''}>{isTeamLeader ? <input readOnly value={actorName} /> : <select value={form.hiring_manager_user_id} onChange={(event) => update('hiring_manager_user_id', event.target.value)}><option value="">Choose manager</option>{employees.map((item) => <option key={employeeUserId(item)} value={employeeUserId(item)}>{employeeName(item)}</option>)}</select>}</Field>
        <Field label="Final approver" hint="Only an authorised Admin or Managing Director can give final approval.">{isTeamLeader ? <input readOnly value="Assigned automatically by YourComate" /> : <select value={form.approver_user_id} onChange={(event) => update('approver_user_id', event.target.value)}><option value="">Use authorised company approver</option>{employees.map((item) => <option key={employeeUserId(item)} value={employeeUserId(item)}>{employeeName(item)}</option>)}</select>}</Field>
        <Field label="Budget notes"><input value={form.budget_notes} onChange={(event) => update('budget_notes', event.target.value)} /></Field>
      </div><div className="recruitment-form-grid"><label className="recruitment-checkbox-row"><input type="checkbox" checked={form.finance_approval_required} onChange={(event) => update('finance_approval_required', event.target.checked)} /><span>Finance budget confirmation is required</span></label><label className="recruitment-checkbox-row"><input type="checkbox" checked disabled /><span>Final leadership approval is required before HR can publish</span></label></div></div>
    </form>
  </Modal>;
}

function JobModal({ requests, initial, employees, busy, onClose, onSave }) {
  const source = initial || requests[0] || {};
  const [form, setForm] = useState({ ...EMPTY_JOB, hiring_request_id: idOf(source), job_title: source.job_title || '', department: source.department || '', vacancies: source.vacancies || 1, qualification: source.qualification || '', required_skills: (source.required_skills || []).join(', '), required_experience: source.required_experience || '', employment_type: source.employment_type || 'permanent', work_location: source.work_location || '', hiring_manager_user_id: source.hiring_manager_user_id || '' });
  const update = (key, value) => setForm((state) => ({ ...state, [key]: value }));
  const choose = (requestId) => {
    const request = requests.find((item) => idOf(item) === requestId) || {};
    setForm((state) => ({ ...state, hiring_request_id: requestId, job_title: request.job_title || '', department: request.department || '', vacancies: request.vacancies || 1, qualification: request.qualification || '', required_skills: (request.required_skills || []).join(', '), required_experience: request.required_experience || '', employment_type: request.employment_type || 'permanent', work_location: request.work_location || '', hiring_manager_user_id: request.hiring_manager_user_id || '' }));
  };
  const submit = (event) => {
    event.preventDefault();
    const recruiter = employees.find((item) => employeeUserId(item) === form.recruiter_user_id);
    onSave({ ...form, vacancies: Number(form.vacancies || 1), responsibilities: commaList(form.responsibilities), required_skills: commaList(form.required_skills), recruiter_name: recruiter ? employeeName(recruiter) : '' });
  };
  return <Modal title="Create job opening" subtitle="Turn an approved hiring request into a clear vacancy." onClose={onClose} large footer={<><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onClose}>Cancel</button><button type="submit" form="job-form" className="recruitment-btn recruitment-btn-primary" disabled={busy || !form.hiring_request_id}>{busy ? <Loader2 size={15} /> : <Check size={15} />}Save draft</button></>}>
    <form id="job-form" className="recruitment-form" onSubmit={submit}><div className="recruitment-alert recruitment-alert-warning"><AlertCircle size={17} /><span>Only approved requests without an active vacancy are available.</span></div>
      <div className="recruitment-form-grid recruitment-form-grid-3">
        <Field label="Approved hiring request" required full><select required value={form.hiring_request_id} onChange={(event) => choose(event.target.value)}><option value="">Choose approved request</option>{requests.map((item) => <option key={idOf(item)} value={idOf(item)}>{item.reference_no} · {item.job_title} · {item.department}</option>)}</select></Field>
        <Field label="Job title" required><input required value={form.job_title} onChange={(event) => update('job_title', event.target.value)} /></Field>
        <Field label="Department"><input value={form.department} onChange={(event) => update('department', event.target.value)} /></Field>
        <Field label="Vacancies"><input type="number" min="1" value={form.vacancies} onChange={(event) => update('vacancies', event.target.value)} /></Field>
        <Field label="Work location"><input value={form.work_location} onChange={(event) => update('work_location', event.target.value)} /></Field>
        <Field label="Work mode"><select value={form.work_mode} onChange={(event) => update('work_mode', event.target.value)}>{['office', 'hybrid', 'remote', 'field'].map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select></Field>
        <Field label="Closing date"><input type="date" value={form.closing_date} onChange={(event) => update('closing_date', event.target.value)} /></Field>
        <Field label="Recruiter / HR owner"><select value={form.recruiter_user_id} onChange={(event) => update('recruiter_user_id', event.target.value)}><option value="">Current user</option>{employees.map((item) => <option key={employeeUserId(item)} value={employeeUserId(item)}>{employeeName(item)}</option>)}</select></Field>
        <Field label="Job description" required full><textarea required value={form.description} onChange={(event) => update('description', event.target.value)} /></Field>
        <Field label="Responsibilities" full><textarea value={form.responsibilities} onChange={(event) => update('responsibilities', event.target.value)} /></Field>
        <Field label="Qualification"><input value={form.qualification} onChange={(event) => update('qualification', event.target.value)} /></Field>
        <Field label="Required experience"><input value={form.required_experience} onChange={(event) => update('required_experience', event.target.value)} /></Field>
        <Field label="Required skills" full><input value={form.required_skills} onChange={(event) => update('required_skills', event.target.value)} /></Field>
      </div><label className="recruitment-checkbox-row"><input type="checkbox" checked={form.salary_visible} onChange={(event) => update('salary_visible', event.target.checked)} /><span>Show approved salary range on the public vacancy</span></label>
    </form>
  </Modal>;
}

function CandidateModal({ jobs, busy, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_CANDIDATE);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const update = (key, value) => setForm((state) => ({ ...state, [key]: value }));
  const parse = async () => {
    if (!file) return setParseError('Choose a PDF, DOCX or TXT resume first.');
    setParsing(true); setParseError('');
    try {
      const response = await parseRecruitmentResume(file);
      const result = response?.result || itemOf(response);
      const fields = result?.fields || result || {};
      setParsed(result);
      setForm((state) => ({ ...state,
        full_name: fields.full_name || fields.name || state.full_name,
        email: fields.primary_email || fields.email || fields.emails?.[0] || state.email,
        phone: fields.primary_phone || fields.phone || fields.phones?.[0] || state.phone,
        location: fields.location || state.location,
        current_designation: fields.current_designation || fields.designation || state.current_designation,
        current_employer: fields.current_employer || fields.employer || state.current_employer,
        total_experience: fields.total_experience_years || fields.total_experience || state.total_experience,
        notice_period: fields.notice_period || state.notice_period,
        expected_salary: fields.expected_salary || state.expected_salary,
        summary: fields.professional_summary || fields.summary || state.summary,
        skills: Array.isArray(fields.skills) ? fields.skills.join(', ') : fields.skills || state.skills,
        linkedin_url: fields.linkedin_url || fields.linkedin || state.linkedin_url,
        github_url: fields.github_url || fields.github || state.github_url,
      }));
    } catch (error) { setParseError(messageOf(error, 'Resume could not be parsed.')); }
    finally { setParsing(false); }
  };
  const submit = (event) => {
    event.preventDefault();
    onSave({ resumeFile: file, jobOpeningId: form.job_opening_id, source: form.source, candidatePayload: { ...form, skills: commaList(form.skills), parser_result: parsed, consent: { accepted: Boolean(form.consent_accepted), accepted_at: new Date().toISOString(), purpose: 'recruitment_and_joining' } } });
  };
  return <Modal title="Add candidate" subtitle="Upload a resume for assisted extraction or enter details manually." onClose={onClose} large footer={<><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onClose}>Cancel</button><button type="submit" form="candidate-form" className="recruitment-btn recruitment-btn-primary" disabled={busy}>{busy ? <Loader2 size={15} /> : <UserPlus size={15} />}Save candidate</button></>}>
    <form id="candidate-form" className="recruitment-form" onSubmit={submit}><div className="recruitment-parser-layout"><div><label className="recruitment-upload-zone"><input type="file" accept=".pdf,.docx,.txt" onChange={(event) => { setFile(event.target.files?.[0] || null); setParsed(null); setParseError(''); }} /><div><div className="recruitment-upload-icon"><UploadCloud size={24} /></div><h3>Upload resume</h3><p>PDF, DOCX or TXT. HR must verify every extracted field.</p><span className="recruitment-btn recruitment-btn-secondary" style={{ marginTop: 13 }}>Choose file</span>{file ? <div className="recruitment-upload-selected"><Paperclip size={18} /><div><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></div></div> : null}</div></label><button type="button" className="recruitment-btn recruitment-btn-primary" style={{ width: '100%', marginTop: 10 }} disabled={!file || parsing} onClick={parse}>{parsing ? <Loader2 size={15} /> : <FileSearch size={15} />}Parse and review</button>{parseError ? <div className="recruitment-alert recruitment-alert-danger" style={{ marginTop: 10 }}><AlertCircle size={16} /><span>{parseError}</span></div> : null}</div>
      <div className="recruitment-parser-result"><div className="recruitment-parser-review-note"><ShieldCheck size={17} /><span>The parser never selects or rejects a candidate. HR remains responsible for review.</span></div><div className="recruitment-form-grid">
        <Field label="Full name" required><input required value={form.full_name} onChange={(event) => update('full_name', event.target.value)} /></Field><Field label="Email"><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></Field><Field label="Phone"><input value={form.phone} onChange={(event) => update('phone', event.target.value)} /></Field><Field label="Location"><input value={form.location} onChange={(event) => update('location', event.target.value)} /></Field><Field label="Current designation"><input value={form.current_designation} onChange={(event) => update('current_designation', event.target.value)} /></Field><Field label="Current employer"><input value={form.current_employer} onChange={(event) => update('current_employer', event.target.value)} /></Field><Field label="Total experience"><input value={form.total_experience} onChange={(event) => update('total_experience', event.target.value)} /></Field><Field label="Notice period"><input value={form.notice_period} onChange={(event) => update('notice_period', event.target.value)} /></Field><Field label="Skills" full><input value={form.skills} onChange={(event) => update('skills', event.target.value)} /></Field><Field label="Professional summary" full><textarea value={form.summary} onChange={(event) => update('summary', event.target.value)} /></Field>
      </div></div></div>
      <div className="recruitment-form-section"><h3 className="recruitment-form-section-title">Application details</h3><div className="recruitment-form-grid recruitment-form-grid-3"><Field label="Link to job opening"><select value={form.job_opening_id} onChange={(event) => update('job_opening_id', event.target.value)}><option value="">Save profile only</option>{jobs.map((job) => <option key={idOf(job)} value={idOf(job)}>{job.job_title} · {job.reference_no}</option>)}</select></Field><Field label="Application source"><select value={form.source} onChange={(event) => update('source', event.target.value)}>{['manual', 'career_page', 'employee_referral', 'job_portal', 'social_media', 'agency', 'email'].map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select></Field><Field label="Source details"><input value={form.source_detail} onChange={(event) => update('source_detail', event.target.value)} /></Field></div><label className="recruitment-checkbox-row"><input required type="checkbox" checked={form.consent_accepted} onChange={(event) => update('consent_accepted', event.target.checked)} /><span>Candidate consent for recruitment data processing has been recorded.</span></label></div>
    </form>
  </Modal>;
}

function ScreenModal({ application, busy, onClose, onSave }) {
  const [form, setForm] = useState({ experience_confirmed: '', interest_confirmed: '', notice_period: '', expected_salary: '', work_location_confirmed: '', screening_notes: application.screening_notes || '', outcome: application.screening_outcome || 'shortlisted' });
  return <Modal title="HR screening" subtitle={`${application.candidate_name || 'Candidate'} · ${application.job_title || 'Job opening'}`} onClose={onClose} footer={<><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onClose}>Cancel</button><button type="submit" form="screen-form" className="recruitment-btn recruitment-btn-primary" disabled={busy}>{busy ? <Loader2 size={15} /> : <Check size={15} />}Save screening</button></>}><form id="screen-form" className="recruitment-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, notes: form.screening_notes, reason: ['on_hold', 'rejected'].includes(form.outcome) ? form.screening_notes : '', screening_outcome: form.outcome }); }}><div className="recruitment-form-grid"><Field label="Relevant experience confirmed"><input value={form.experience_confirmed} onChange={(event) => setForm((state) => ({ ...state, experience_confirmed: event.target.value }))} /></Field><Field label="Interest and availability"><input value={form.interest_confirmed} onChange={(event) => setForm((state) => ({ ...state, interest_confirmed: event.target.value }))} /></Field><Field label="Notice period"><input value={form.notice_period} onChange={(event) => setForm((state) => ({ ...state, notice_period: event.target.value }))} /></Field><Field label="Expected salary"><input value={form.expected_salary} onChange={(event) => setForm((state) => ({ ...state, expected_salary: event.target.value }))} /></Field><Field label="Work location confirmed"><input value={form.work_location_confirmed} onChange={(event) => setForm((state) => ({ ...state, work_location_confirmed: event.target.value }))} /></Field><Field label="Outcome" required><select required value={form.outcome} onChange={(event) => setForm((state) => ({ ...state, outcome: event.target.value }))}><option value="shortlisted">Shortlist</option><option value="under_review">Keep under review</option><option value="on_hold">Place on hold</option><option value="rejected">Reject</option></select></Field><Field label="Professional notes" required full><textarea required value={form.screening_notes} onChange={(event) => setForm((state) => ({ ...state, screening_notes: event.target.value }))} /></Field></div></form></Modal>;
}

function InterviewModal({ applications, initial, employees, settings, busy, onClose, onSave }) {
  const rounds = orderedRounds(settings?.default_interview_rounds);
  const [form, setForm] = useState({ ...EMPTY_INTERVIEW, application_id: idOf(initial) || idOf(applications[0]), round_key: rounds[0]?.key || '', round_label: rounds[0]?.label || '', scheduled_at: dateTimeInput(new Date(Date.now() + 86400000)) });
  const [panel, setPanel] = useState({});
  const [panelError, setPanelError] = useState('');
  const update = (key, value) => setForm((state) => ({ ...state, [key]: value }));
  const toggleMember = (employee) => {
    const userId = employeeUserId(employee);
    if (!userId) return;
    setPanelError('');
    setPanel((state) => {
      const next = { ...state };
      if (next[userId]) delete next[userId];
      else next[userId] = { user_id: userId, name: employeeName(employee), email: employee.email || employee.user?.email || '', roles: [] };
      return next;
    });
  };
  const toggleRole = (userId, role) => {
    setPanelError('');
    setPanel((state) => {
      const member = state[userId];
      if (!member) return state;
      const roles = new Set(member.roles || []);
      if (roles.has(role)) roles.delete(role); else roles.add(role);
      return { ...state, [userId]: { ...member, roles: [...roles] } };
    });
  };
  const submit = (event) => {
    event.preventDefault();
    const interviewerPanel = Object.values(panel);
    if (!interviewerPanel.length) { setPanelError('Select at least one interviewer.'); return; }
    const withoutRole = interviewerPanel.find((member) => !member.roles?.length);
    if (withoutRole) { setPanelError(`Choose at least one interview role for ${withoutRole.name || 'every selected interviewer'}.`); return; }
    const round = rounds.find((item) => item.key === form.round_key);
    onSave({
      ...form,
      scheduled_at: new Date(form.scheduled_at).toISOString(),
      duration_minutes: Number(form.duration_minutes || 45),
      round_label: round?.label || form.round_label,
      sequence_no: Number(round?.sequence_no || round?.order || 1),
      interviewer_user_ids: interviewerPanel.map((member) => member.user_id),
      interviewer_panel: interviewerPanel,
    });
  };
  return <Modal title="Schedule interview" subtitle="Choose the candidate, tenant-defined round, time and role-based interviewer panel." onClose={onClose} large footer={<><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onClose}>Cancel</button><button type="submit" form="interview-form" className="recruitment-btn recruitment-btn-primary" disabled={busy}>{busy ? <Loader2 size={15} /> : <CalendarClock size={15} />}Schedule interview</button></>}><form id="interview-form" className="recruitment-form" onSubmit={submit}><div className="recruitment-form-grid recruitment-form-grid-3">
    <Field label="Candidate application" required full><select required value={form.application_id} onChange={(event) => update('application_id', event.target.value)}><option value="">Choose candidate</option>{applications.map((item) => <option key={idOf(item)} value={idOf(item)}>{item.candidate_name} · {item.job_title} · {labelOf(item.status)}</option>)}</select></Field>
    <Field label="Interview round" required><select required value={form.round_key} onChange={(event) => update('round_key', event.target.value)}>{rounds.map((round) => <option key={round.key} value={round.key}>{round.label}</option>)}</select></Field>
    <Field label="Date and time" required><input required type="datetime-local" value={form.scheduled_at} onChange={(event) => update('scheduled_at', event.target.value)} /></Field>
    <Field label="Duration"><select value={form.duration_minutes} onChange={(event) => update('duration_minutes', event.target.value)}>{[30, 45, 60, 90, 120].map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></Field>
    <Field label="Interview mode"><select value={form.mode} onChange={(event) => update('mode', event.target.value)}>{['online', 'office', 'phone', 'hybrid'].map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select></Field>
    {form.mode === 'online' ? <Field label="Meeting link" full><input type="url" value={form.meeting_link} onChange={(event) => update('meeting_link', event.target.value)} /></Field> : <Field label="Location" full><input value={form.location} onChange={(event) => update('location', event.target.value)} /></Field>}
    <Field label="Candidate instructions" full><textarea value={form.candidate_notes} onChange={(event) => update('candidate_notes', event.target.value)} /></Field><Field label="Internal notes" full><textarea value={form.internal_notes} onChange={(event) => update('internal_notes', event.target.value)} /></Field>
  </div><div className="recruitment-form-section"><h3 className="recruitment-form-section-title">Interviewer panel and roles</h3><p className="recruitment-muted">Select every interviewer and assign one or more responsibilities. Each selected person submits an individual scorecard after completion.</p>{panelError ? <div className="recruitment-alert recruitment-alert-danger" style={{ margin: '12px 0' }}><AlertCircle size={16} /><span>{panelError}</span></div> : null}<div className="recruitment-panel-selector">{employees.filter((employee) => employeeUserId(employee)).map((employee) => {
    const userId = employeeUserId(employee);
    const member = panel[userId];
    return <div className={`recruitment-panel-member${member ? ' is-selected' : ''}`} key={userId}><div className="recruitment-panel-member-head"><div className="recruitment-panel-member-copy"><span className="recruitment-avatar">{initials(employeeName(employee))}</span><span className="recruitment-person-copy"><strong>{employeeName(employee)}</strong><small>{employee.designation || employee.department || employee.email || 'Active employee'}</small></span></div><label className="recruitment-checkbox-row"><input type="checkbox" checked={Boolean(member)} onChange={() => toggleMember(employee)} /><span>{member ? 'Selected' : 'Add'}</span></label></div>{member ? <div className="recruitment-panel-roles" style={{ marginTop: 12 }}>{INTERVIEWER_ROLE_OPTIONS.map(([role, label]) => <label className="recruitment-role-option" key={role}><input type="checkbox" checked={member.roles.includes(role)} onChange={() => toggleRole(userId, role)} /><span>{label}</span></label>)}</div> : null}</div>;
  })}</div></div></form></Modal>;
}

function RescheduleModal({ interview, busy, onClose, onSave }) {
  const [form, setForm] = useState({ scheduled_at: dateTimeInput(interview.scheduled_at), duration_minutes: interview.duration_minutes || 45, mode: interview.mode || 'online', location: interview.location || '', meeting_link: interview.meeting_link || '', reason: '' });
  const submit = (event) => { event.preventDefault(); onSave({ ...form, duration_minutes: Number(form.duration_minutes || 45), scheduled_at: new Date(form.scheduled_at).toISOString() }); };
  return <Modal title="Reschedule interview" subtitle={`${interview.candidate_name || 'Candidate'} · ${interview.round_label || 'Interview'}`} onClose={onClose} footer={<><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onClose}>Cancel</button><button type="submit" form="reschedule-form" className="recruitment-btn recruitment-btn-primary" disabled={busy}>{busy ? <Loader2 size={15} /> : <CalendarClock size={15} />}Save new time</button></>}><form id="reschedule-form" className="recruitment-form" onSubmit={submit}><div className="recruitment-form-grid"><Field label="New date and time" required><input required type="datetime-local" value={form.scheduled_at} onChange={(event) => setForm((state) => ({ ...state, scheduled_at: event.target.value }))} /></Field><Field label="Duration"><select value={form.duration_minutes} onChange={(event) => setForm((state) => ({ ...state, duration_minutes: event.target.value }))}>{[30, 45, 60, 90, 120].map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></Field><Field label="Mode"><select value={form.mode} onChange={(event) => setForm((state) => ({ ...state, mode: event.target.value }))}>{['online', 'office', 'phone', 'hybrid'].map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select></Field><Field label={form.mode === 'online' ? 'Meeting link' : 'Location'}><input value={form.mode === 'online' ? form.meeting_link : form.location} onChange={(event) => setForm((state) => ({ ...state, [form.mode === 'online' ? 'meeting_link' : 'location']: event.target.value }))} /></Field><Field label="Reason" required full><textarea required value={form.reason} onChange={(event) => setForm((state) => ({ ...state, reason: event.target.value }))} /></Field></div></form></Modal>;
}

function Rating({ label, value, onChange }) {
  return <div className="recruitment-rating-item"><label>{label}</label><div className="recruitment-rating-options">{[1, 2, 3, 4, 5].map((score) => <button type="button" key={score} className={Number(value) === score ? 'active' : ''} onClick={() => onChange(score)}>{score}</button>)}</div></div>;
}
function FeedbackModal({ interview, busy, onClose, onSave }) {
  const existing = interview.my_feedback || {};
  const ratings = existing.ratings || {};
  const [form, setForm] = useState({ role_knowledge: ratings.role_knowledge || 0, relevant_experience: ratings.relevant_experience || 0, communication: ratings.communication || 0, problem_solving: ratings.problem_solving || 0, work_approach: ratings.work_approach || 0, recommendation: existing.recommendation || '', strengths: textOf(existing.strengths), concerns: textOf(existing.concerns), comments: textOf(existing.comments) });
  const complete = ['role_knowledge', 'relevant_experience', 'communication', 'problem_solving', 'work_approach'].every((key) => Number(form[key]) >= 1);
  const submit = (event) => { event.preventDefault(); onSave({ ratings: { role_knowledge: Number(form.role_knowledge), relevant_experience: Number(form.relevant_experience), communication: Number(form.communication), problem_solving: Number(form.problem_solving), work_approach: Number(form.work_approach) }, recommendation: form.recommendation, strengths: form.strengths, concerns: form.concerns, comments: form.comments }); };
  return <Modal title={interview.my_feedback_submitted ? 'Edit interview feedback' : 'Interview feedback'} subtitle={`${interview.candidate_name || 'Candidate'} · ${interview.round_label || 'Interview'}`} onClose={onClose} large footer={<><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onClose}>Cancel</button><button type="submit" form="feedback-form" className="recruitment-btn recruitment-btn-primary" disabled={busy || !complete || !form.recommendation}>{busy ? <Loader2 size={15} /> : <Check size={15} />}{interview.my_feedback_submitted ? 'Update feedback' : 'Submit feedback'}</button></>}><form id="feedback-form" className="recruitment-form" onSubmit={submit}>{interview.my_feedback_submitted ? <div className="recruitment-alert"><ShieldCheck size={17} /><span>You are revising your own scorecard. The previous version remains in the audit history.</span></div> : null}<div className="recruitment-rating-grid"><Rating label="Role knowledge" value={form.role_knowledge} onChange={(value) => setForm((state) => ({ ...state, role_knowledge: value }))} /><Rating label="Relevant experience" value={form.relevant_experience} onChange={(value) => setForm((state) => ({ ...state, relevant_experience: value }))} /><Rating label="Communication" value={form.communication} onChange={(value) => setForm((state) => ({ ...state, communication: value }))} /><Rating label="Problem solving" value={form.problem_solving} onChange={(value) => setForm((state) => ({ ...state, problem_solving: value }))} /><Rating label="Work approach" value={form.work_approach} onChange={(value) => setForm((state) => ({ ...state, work_approach: value }))} /></div><div className="recruitment-form-grid"><Field label="Final recommendation" required><select required value={form.recommendation} onChange={(event) => setForm((state) => ({ ...state, recommendation: event.target.value }))}><option value="">Choose recommendation</option><option value="strong_hire">Strong Hire</option><option value="hire">Hire</option><option value="hold">Hold</option><option value="reject">Reject</option></select></Field><Field label="Strengths"><textarea value={form.strengths} onChange={(event) => setForm((state) => ({ ...state, strengths: event.target.value }))} /></Field><Field label="Concerns"><textarea value={form.concerns} onChange={(event) => setForm((state) => ({ ...state, concerns: event.target.value }))} /></Field><Field label="Final comments" required full><textarea required value={form.comments} onChange={(event) => setForm((state) => ({ ...state, comments: event.target.value }))} /></Field></div></form></Modal>;
}

function OfferModal({ applications, initial, employees, designations, settings, busy, onClose, onSave }) {
  const source = initial || applications[0] || {};
  const [form, setForm] = useState({ ...EMPTY_OFFER, application_id: idOf(source), designation: source.job_title || '', department: source.department || '', currency: settings?.default_currency || 'INR' });
  const [file, setFile] = useState(null);
  const update = (key, value) => setForm((state) => ({ ...state, [key]: value }));
  const choose = (applicationId) => { const item = applications.find((row) => idOf(row) === applicationId) || {}; setForm((state) => ({ ...state, application_id: applicationId, designation: item.job_title || '', department: item.department || '' })); };
  const submit = (event) => { event.preventDefault(); const manager = employees.find((item) => employeeUserId(item) === form.reporting_manager_user_id); onSave({ applicationId: form.application_id, offerFile: file, payload: { designation: form.designation, department: form.department, reporting_manager_user_id: form.reporting_manager_user_id, reporting_manager_name: manager ? employeeName(manager) : '', work_location: form.work_location, employment_type: form.employment_type, joining_date: form.joining_date, probation_months: Number(form.probation_months || 0), currency: form.currency, salary: { gross: Number(form.gross_salary || 0), basic: Number(form.basic_salary || 0), hra: Number(form.hra || 0), other_allowance: Number(form.other_allowance || 0) }, salary_summary: `${form.currency} ${Number(form.gross_salary || 0).toLocaleString('en-IN')} gross`, response_deadline: form.response_deadline, probation_period: `${Number(form.probation_months || 0)} months`, offer_message: form.notes } }); };
  return <Modal title="Prepare offer" subtitle="Confirm approved employment terms before sending them." onClose={onClose} large footer={<><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onClose}>Cancel</button><button type="submit" form="offer-form" className="recruitment-btn recruitment-btn-primary" disabled={busy}>{busy ? <Loader2 size={15} /> : <FileCheck2 size={15} />}Save offer draft</button></>}><form id="offer-form" className="recruitment-form" onSubmit={submit}><div className="recruitment-form-grid recruitment-form-grid-3">
    <Field label="Selected candidate" required full><select required value={form.application_id} onChange={(event) => choose(event.target.value)}><option value="">Choose candidate</option>{applications.map((item) => <option key={idOf(item)} value={idOf(item)}>{item.candidate_name} · {item.job_title}</option>)}</select></Field>
    <Field label="Designation" required><input required list="offer-designations" value={form.designation} onChange={(event) => update('designation', event.target.value)} /><datalist id="offer-designations">{designations.map((item) => <option key={idOf(item) || optionName(item)} value={optionName(item)} />)}</datalist></Field>
    <Field label="Department" required><input required value={form.department} onChange={(event) => update('department', event.target.value)} /></Field>
    <Field label="Reporting manager"><select value={form.reporting_manager_user_id} onChange={(event) => update('reporting_manager_user_id', event.target.value)}><option value="">Choose manager</option>{employees.map((item) => <option key={employeeUserId(item)} value={employeeUserId(item)}>{employeeName(item)}</option>)}</select></Field>
    <Field label="Employment type"><select value={form.employment_type} onChange={(event) => update('employment_type', event.target.value)}>{['permanent', 'contract', 'temporary', 'trainee', 'consultant'].map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select></Field>
    <Field label="Work location"><input value={form.work_location} onChange={(event) => update('work_location', event.target.value)} /></Field>
    <Field label="Joining date" required><input required type="date" value={form.joining_date} onChange={(event) => update('joining_date', event.target.value)} /></Field>
    <Field label="Probation months"><input type="number" min="0" max="24" value={form.probation_months} onChange={(event) => update('probation_months', event.target.value)} /></Field>
    <Field label="Response deadline" required><input required type="date" value={form.response_deadline} onChange={(event) => update('response_deadline', event.target.value)} /></Field>
  </div><div className="recruitment-form-section"><h3 className="recruitment-form-section-title">Approved salary</h3><div className="recruitment-form-grid recruitment-form-grid-4"><Field label="Currency"><select value={form.currency} onChange={(event) => update('currency', event.target.value)}>{['INR', 'USD', 'BDT', 'EUR', 'GBP'].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Gross salary" required><input required type="number" min="0" value={form.gross_salary} onChange={(event) => update('gross_salary', event.target.value)} /></Field><Field label="Basic"><input type="number" min="0" value={form.basic_salary} onChange={(event) => update('basic_salary', event.target.value)} /></Field><Field label="HRA"><input type="number" min="0" value={form.hra} onChange={(event) => update('hra', event.target.value)} /></Field><Field label="Other allowance"><input type="number" min="0" value={form.other_allowance} onChange={(event) => update('other_allowance', event.target.value)} /></Field></div></div><div className="recruitment-form-grid"><Field label="Offer PDF" hint="Optional approved PDF attachment"><input type="file" accept=".pdf,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} /></Field><Field label="Internal notes"><textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} /></Field></div></form></Modal>;
}

function ConvertModal({ application, offer, departments, designations, employees, busy, onClose, onSave }) {
  const terms = offer?.terms || offer || {};
  const [form, setForm] = useState({ emp_code: '', joining_date: dateInput(application.joining_date || terms.joining_date) || new Date().toISOString().slice(0, 10), department: terms.department || application.department || '', designation: terms.designation || application.job_title || '', employment_type: terms.employment_type || 'permanent', work_location: terms.work_location || '', reporting_manager_user_id: terms.reporting_manager_user_id || '', team_leader_id: '', shift: 'General', branch: terms.work_location || 'Assam/Guwahati (HO)', country: 'India', temporary_password: '' });
  const submit = (event) => { event.preventDefault(); const manager = employees.find((item) => employeeUserId(item) === form.reporting_manager_user_id); const leader = employees.find((item) => employeeUserId(item) === form.team_leader_id); onSave({ ...form, reporting_manager_name: manager ? employeeName(manager) : '', team_leader_name: leader ? employeeName(leader) : '' }); };
  return <Modal title="Convert candidate to employee" subtitle="Review final employment details before creating employee and login records." onClose={onClose} large footer={<><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onClose}>Cancel</button><button type="submit" form="convert-form" className="recruitment-btn recruitment-btn-success" disabled={busy}>{busy ? <Loader2 size={15} /> : <UserCheck size={15} />}Create employee</button></>}><div className="recruitment-alert recruitment-alert-success"><CheckCircle2 size={17} /><span>Required documents and enabled checks must be complete before conversion.</span></div><form id="convert-form" className="recruitment-form" onSubmit={submit} style={{ marginTop: 16 }}><div className="recruitment-form-grid recruitment-form-grid-3">
    <Field label="Employee code" hint="Leave blank to generate automatically"><input value={form.emp_code} onChange={(event) => setForm((state) => ({ ...state, emp_code: event.target.value }))} /></Field><Field label="Joining date" required><input required type="date" value={form.joining_date} onChange={(event) => setForm((state) => ({ ...state, joining_date: event.target.value }))} /></Field>
    <Field label="Department" required><input required list="convert-departments" value={form.department} onChange={(event) => setForm((state) => ({ ...state, department: event.target.value }))} /><datalist id="convert-departments">{departments.map((item) => <option key={idOf(item) || optionName(item)} value={optionName(item)} />)}</datalist></Field>
    <Field label="Designation" required><input required list="convert-designations" value={form.designation} onChange={(event) => setForm((state) => ({ ...state, designation: event.target.value }))} /><datalist id="convert-designations">{designations.map((item) => <option key={idOf(item) || optionName(item)} value={optionName(item)} />)}</datalist></Field>
    <Field label="Employment type"><select value={form.employment_type} onChange={(event) => setForm((state) => ({ ...state, employment_type: event.target.value }))}>{['permanent', 'contract', 'temporary', 'trainee', 'consultant'].map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select></Field><Field label="Work location"><input value={form.work_location} onChange={(event) => setForm((state) => ({ ...state, work_location: event.target.value }))} /></Field>
    <Field label="Reporting manager"><select value={form.reporting_manager_user_id} onChange={(event) => setForm((state) => ({ ...state, reporting_manager_user_id: event.target.value }))}><option value="">Choose manager</option>{employees.map((item) => <option key={employeeUserId(item)} value={employeeUserId(item)}>{employeeName(item)}</option>)}</select></Field><Field label="Team leader"><select value={form.team_leader_id} onChange={(event) => setForm((state) => ({ ...state, team_leader_id: event.target.value }))}><option value="">Choose team leader</option>{employees.map((item) => <option key={employeeUserId(item)} value={employeeUserId(item)}>{employeeName(item)}</option>)}</select></Field><Field label="Shift"><input value={form.shift} onChange={(event) => setForm((state) => ({ ...state, shift: event.target.value }))} /></Field><Field label="Temporary password" hint="Leave blank for a generated password"><input type="password" minLength="8" value={form.temporary_password} onChange={(event) => setForm((state) => ({ ...state, temporary_password: event.target.value }))} /></Field>
  </div></form></Modal>;
}

function ConfirmModal({ title, message, label, tone = 'primary', reason, date, action, busy, onClose }) {
  const [text, setText] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  return <Modal title={title} subtitle={message} onClose={onClose} footer={<><button type="button" className="recruitment-btn recruitment-btn-neutral" onClick={onClose}>Cancel</button><button type="button" className={`recruitment-btn recruitment-btn-${tone}`} disabled={busy || (reason && !text.trim())} onClick={() => action(text.trim(), joiningDate)}>{busy ? <Loader2 size={15} /> : <Check size={15} />}{label}</button></>}>
    {reason ? <Field label="Reason" required><textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} /></Field> : <div className="recruitment-alert"><AlertCircle size={17} /><span>Please confirm before continuing.</span></div>}
    {date ? <div style={{ marginTop: 14 }}><Field label="Revised joining date"><input type="date" value={joiningDate} onChange={(event) => setJoiningDate(event.target.value)} /></Field></div> : null}
  </Modal>;
}

function JoiningDrawer({ state, canManage, busy, onClose, onDownload, onReview, onCheck, onDidNotJoin }) {
  const { application, documents, checks } = state;
  const [form, setForm] = useState({ check_type: checks[0]?.check_type || checks[0]?.type || 'identity', status: checks[0]?.status || 'pending', notes: '', provider: '' });
  return <Drawer title={`${application.candidate_name || 'Candidate'} · Joining`} onClose={onClose} footer={canManage && !['joined', 'did_not_join'].includes(keyOf(application.joining_status || application.status)) ? <button type="button" className="recruitment-btn recruitment-btn-danger" onClick={onDidNotJoin}><XCircle size={15} />Mark did not join</button> : null}>
    <div className="recruitment-alert"><ShieldCheck size={17} /><span>Candidate documents are private. Open or download them only for an authorised purpose.</span></div>
    <section style={{ marginTop: 18 }}><div className="recruitment-section-head"><div><h3>Joining documents</h3><p>Review every required item before the candidate is ready.</p></div></div>
      {documents.length ? <div className="recruitment-document-list">{documents.map((document) => <article className="recruitment-document-row" key={idOf(document)}><div className="recruitment-document-main"><span className="recruitment-document-icon"><FileText size={17} /></span><span className="recruitment-document-copy"><strong>{document.label || labelOf(document.document_key)}</strong><small>{document.required ? 'Required' : 'Optional'} · {document.file_name || 'Not uploaded'}</small></span></div><div className="recruitment-table-actions"><Status value={document.status || 'pending'} />{document.file_path ? <button type="button" className="recruitment-btn recruitment-btn-neutral recruitment-btn-sm" onClick={() => onDownload(document)}><Download size={13} /></button> : null}{canManage && document.file_path ? <><button type="button" className="recruitment-btn recruitment-btn-success recruitment-btn-sm" disabled={Boolean(busy)} onClick={() => onReview(document, 'accepted')}><Check size={13} /></button><button type="button" className="recruitment-btn recruitment-btn-warning recruitment-btn-sm" disabled={Boolean(busy)} onClick={() => { const note = window.prompt('Explain what needs correction:'); if (note) onReview(document, 'needs_correction', note); }}><AlertCircle size={13} /></button></> : null}</div></article>)}</div> : <Empty icon={FileText} title="No joining checklist" message="The checklist is created after offer acceptance." />}
    </section>
    <hr className="recruitment-divider" style={{ margin: '20px 0' }} />
    <section><div className="recruitment-section-head"><div><h3>Background and reference checks</h3><p>Record only checks required by company policy and candidate consent.</p></div></div>
      {checks.length ? <div className="recruitment-document-list" style={{ marginBottom: 14 }}>{checks.map((check) => <div className="recruitment-document-row" key={idOf(check)}><div className="recruitment-document-main"><span className="recruitment-document-icon"><ShieldCheck size={17} /></span><span className="recruitment-document-copy"><strong>{check.label || labelOf(check.check_type || check.type)}</strong><small>{check.notes || 'No notes recorded'}</small></span></div><Status value={check.status || 'pending'} /></div>)}</div> : null}
      {canManage ? <form className="recruitment-form" onSubmit={(event) => { event.preventDefault(); onCheck({ ...form, completed_at: ['clear', 'not_clear'].includes(form.status) ? new Date().toISOString() : null }); }}><div className="recruitment-form-grid"><Field label="Check type"><select value={form.check_type} onChange={(event) => setForm((state) => ({ ...state, check_type: event.target.value }))}>{['identity', 'employment', 'education', 'reference'].map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select></Field><Field label="Result"><select value={form.status} onChange={(event) => setForm((state) => ({ ...state, status: event.target.value }))}>{['pending', 'clear', 'clarification_required', 'not_clear'].map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}</select></Field><Field label="Provider"><input value={form.provider} onChange={(event) => setForm((state) => ({ ...state, provider: event.target.value }))} /></Field><Field label="Notes" full><textarea value={form.notes} onChange={(event) => setForm((state) => ({ ...state, notes: event.target.value }))} /></Field></div><div className="recruitment-form-actions"><button type="submit" className="recruitment-btn recruitment-btn-primary" disabled={Boolean(busy)}><Check size={15} />Save check</button></div></form> : null}
    </section>
  </Drawer>;
}
