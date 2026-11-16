import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  approveTeamLeaveRequest,
  currentUser,
  decideHolidayWorkRequest,
  getHolidayWorkRequests,
  getInitials,
  getProfilePhotoUrl,
  getTeamApprovals,
  getTeamFieldAttendance,
  normalizeLeaveApprovalList,
  rejectTeamLeaveRequest,
} from '../api/client';
import {
  getDisplayRole,
  getEmployeeCapabilities,
} from '../data/modules';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';
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

  return value || 'Leave';
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


function getRequestId(row = {}) {
  return row._id || row.id || row.request_id || row.leave_request_id || '';
}

function fieldPhotoUrl(row = {}) {
  return (
    row.field_photo ||
    row.proof_photo ||
    row.photo ||
    row.check_in_photo ||
    ''
  );
}

function fieldMapUrl(row = {}) {
  if (row.map_url) {
    return row.map_url;
  }

  const location =
    row.check_in_location ||
    row.location ||
    row.geo_location ||
    {};

  const lat =
    location.latitude ||
    location.lat ||
    row.latitude ||
    row.lat;

  const lng =
    location.longitude ||
    location.lng ||
    row.longitude ||
    row.lng;

  if (!lat || !lng) {
    return '';
  }

  return `https://www.google.com/maps?q=${lat},${lng}`;
}


function requestType(row = {}) {
  return row.request_type || row.type || 'leave';
}

function isHolidayWorkRequest(row = {}) {
  return requestType(row) === 'holiday_work';
}

function isLeaveRequest(row = {}) {
  return requestType(row) === 'leave';
}


function employeeName(row = {}) {
  return (
    row.employee_name ||
    row.name ||
    row.employee?.name ||
    row.employee?.employee_name ||
    'Employee'
  );
}

function employeePhotoRecord(row = {}) {
  return {
    avatar:
      row.avatar ||
      row.profile_photo ||
      row.profile_picture ||
      row.photo ||
      row.employee_avatar ||
      row.employee_profile_photo ||
      row.employee?.avatar ||
      row.employee?.profile_photo ||
      row.employee?.profile_picture ||
      row.employee?.photo ||
      '',
  };
}

function liveStatus(row = {}) {
  const stage = String(row.approval_stage || '').toLowerCase();
  const status = String(row.status || '').toLowerCase();
  const teamLeaderApproved =
    String(row.team_leader_status || '').toLowerCase() === 'approved' ||
    Boolean(row.approved_by_team_leader) ||
    Boolean(row.approved_by_team_leader_name) ||
    Boolean(row.team_leader_decision_by_name);

  if (status === 'pending' && stage === 'reporting_officer' && teamLeaderApproved) {
    return 'Approved by Team Leader, Pending with Reporting Officer';
  }

  return (
    row.live_status ||
    row.status_text ||
    row.status_display ||
    row.approval_stage_label ||
    statusLabel(row.status)
  );
}

function stageClass(row = {}) {
  const stage = String(row.approval_stage || '').toLowerCase();
  const status = String(row.status || '').toLowerCase();

  if (status === 'approved' || stage === 'approved') return 'approved';
  if (status === 'rejected' || stage === 'rejected') return 'rejected';
  if (stage === 'hr') return 'hr';
  if (stage === 'reporting_officer') return 'reporting';
  if (stage === 'team_leader') return 'team';

  return 'pending';
}

function isPending(row = {}) {
  return ['pending', 'in_review'].includes(String(row.status || '').toLowerCase());
}

function isApprovedRecord(row = {}) {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  return (
    status === 'approved' ||
    stage === 'approved' ||
    Boolean(row.approved_by_team_leader) ||
    Boolean(row.approved_by_team_leader_name) ||
    Boolean(row.team_leader_decision_by_name) ||
    Boolean(row.approved_by_reporting_officer) ||
    Boolean(row.approved_by_reporting_officer_name) ||
    Boolean(row.reporting_officer_decision_by_name) ||
    String(row.team_leader_status || '').toLowerCase() === 'approved' ||
    String(row.reporting_officer_status || '').toLowerCase() === 'approved'
  );
}


function normalizeHolidayWorkApprovalList(rows = []) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => ({
    ...row,
    request_type: 'holiday_work',
    _id: row._id || row.id || '',
    employee_name: row.employee_name || row.name || 'Employee',
    employee_code: row.employee_code || row.emp_code || row.employee_id || '—',
    designation: row.designation || row.designation_name || '—',
    department: row.department || row.department_name || '—',
    holiday_title: row.holiday_title || row.holiday_name || 'Holiday Work',
    work_location: row.work_location || row.field_location || '—',
    approval_stage_label:
      row.approval_stage_label ||
      statusLabel(row.approval_stage || row.pending_approver_role),
  }));
}

function isRejectedRecord(row = {}) {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  return (
    status === 'rejected' ||
    stage === 'rejected' ||
    Boolean(row.rejected_by_name) ||
    String(row.team_leader_status || '').toLowerCase() === 'rejected' ||
    String(row.reporting_officer_status || '').toLowerCase() === 'rejected' ||
    String(row.hr_status || '').toLowerCase() === 'rejected'
  );
}

function canDecideRow(row = {}, capabilities = {}) {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (!['pending', 'in_review'].includes(status)) {
    return false;
  }

  if (row.can_decide === true || row.current_user_can_decide === true) {
    return true;
  }

  if (row.can_decide === false || row.current_user_can_decide === false) {
    return false;
  }

  if (stage === 'team_leader') {
    return Boolean(capabilities.isTeamLeader);
  }

  if (stage === 'reporting_officer') {
    return Boolean(capabilities.isReportingOfficer);
  }

  if (stage === 'hr') {
    return Boolean(capabilities.isHrAdmin);
  }

  return false;
}

function EmployeeAvatar({ row }) {
  const name = employeeName(row);
  const photoUrl = getProfilePhotoUrl(employeePhotoRecord(row));

  return (
    <div className="ta-avatar">
      {photoUrl ? (
        <img src={photoUrl} alt={name} />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
}

function Timeline({ history = [] }) {
  if (!history.length) {
    return (
      <div className="ta-empty-line">
        No approval action has been recorded yet.
      </div>
    );
  }

  return (
    <div className="ta-timeline">
      {history.map((item, index) => (
        <div
          className="ta-timeline-item"
          key={`${item.at || item.created_at || index}-${item.name || index}`}
        >
          <div className="ta-timeline-dot" />

          <div>
            <strong>
              {statusLabel(item.action || item.status || item.decision || 'Action')}
              {item.role || item.by_role || item.approver_role
                ? ` by ${statusLabel(item.role || item.by_role || item.approver_role)}`
                : ''}
            </strong>

            <span>
              {item.name ||
                item.by_name ||
                item.approver_name ||
                item.approved_by_name ||
                item.rejected_by_name ||
                'Approver'}
            </span>

            <small>
              {formatDateTime(item.at || item.approved_at || item.rejected_at || item.created_at)}
              {item.note || item.reason || item.decision_note
                ? ` • ${item.note || item.reason || item.decision_note}`
                : ''}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

function ApprovalFlags({ row }) {
  const teamLeaderDone =
    Boolean(row.approved_by_team_leader) ||
    Boolean(row.approved_by_team_leader_name) ||
    Boolean(row.team_leader_decision_by_name) ||
    String(row.team_leader_status || '').toLowerCase() === 'approved';

  const reportingOfficerDone =
    Boolean(row.approved_by_reporting_officer) ||
    Boolean(row.approved_by_reporting_officer_name) ||
    Boolean(row.reporting_officer_decision_by_name) ||
    String(row.reporting_officer_status || '').toLowerCase() === 'approved';

  const hrDone =
    Boolean(row.hr_notified) ||
    Boolean(row.hr_notified_at) ||
    String(row.hr_notified_status || '').toLowerCase() === 'notified' ||
    Boolean(row.hr_record_notification_sent);

  return (
    <div className="ta-approval-flags">
      <div className={teamLeaderDone ? 'done' : ''}>
        <CheckCircle2 size={15} />
        <span>
          Team Leader
          <small>
            {teamLeaderDone
              ? `Approved by ${
                  row.approved_by_team_leader_name ||
                  row.team_leader_decision_by_name ||
                  'Team Leader'
                }`
              : row.team_leader_name
                ? `Pending / mapped to ${row.team_leader_name}`
                : 'Not mapped / skipped'}
          </small>
        </span>
      </div>

      <div className={reportingOfficerDone ? 'done' : ''}>
        <ShieldCheck size={15} />
        <span>
          Reporting Officer
          <small>
            {reportingOfficerDone
              ? `Approved by ${
                  row.approved_by_reporting_officer_name ||
                  row.reporting_officer_decision_by_name ||
                  'Reporting Officer'
                }`
              : row.reporting_officer_name
                ? String(row.approval_stage || '').toLowerCase() === 'reporting_officer'
                  ? `Pending with ${row.reporting_officer_name}`
                  : `Mapped to ${row.reporting_officer_name}`
                : 'Not mapped'}
          </small>
        </span>
      </div>

      <div className={hrDone ? 'done' : ''}>
        <FileText size={15} />
        <span>
          HR Record
          <small>
            {hrDone
              ? `Notified ${formatDateTime(row.hr_notified_at)}`
              : 'Will notify HR after final approval/rejection'}
          </small>
        </span>
      </div>
    </div>
  );
}


const TEAM_APPROVAL_NOTICE_HIDE_MS = 3600;
const TEAM_APPROVAL_PAGE_SIZES = [10, 25, 50, 100];

function teamApprovalPageNumbers(pageCount, page) {
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

function TeamApprovalInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`ta-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="ta-inline-feedback-icon">
        {message.loading ? (
          <Loader2 size={15} className="ta-spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="ta-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="ta-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function TeamApprovalPagination({
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
    <div className="ta-pagination">
      <div className="ta-pagination-controls">
        <button
          type="button"
          className="ta-page-button ta-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="ta-page-numbers" aria-label="Pagination">
          {teamApprovalPageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`ta-page-number ${
                  item === safePage ? 'is-active' : ''
                }`}
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span className="ta-page-ellipsis" key={item}>
                …
              </span>
            ),
          )}
        </div>

        <span className="ta-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="ta-page-button ta-page-nav"
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

function RequestCard({
  row,
  onApprove,
  onReject,
  savingId,
  capabilities,
  feedback,
  onDismissFeedback,
}) {
  const requestId = getRequestId(row);
  const isSaving = savingId === requestId;
  const currentStatus = liveStatus(row);
  const canDecide = canDecideRow(row, capabilities);

  return (
    <article className="ta-card">
      <div className="ta-card-top">
        <div className="ta-person">
          <EmployeeAvatar row={row} />

          <div>
            <strong>{employeeName(row)}</strong>
            <span>
              {row.employee_code || row.emp_code || row.employee_id || 'No Emp ID'}
              {row.department ? ` • ${row.department}` : ''}
            </span>
            <small>{row.designation || 'No designation'}</small>
          </div>
        </div>

        <div className={`ta-stage-pill ${stageClass(row)}`}>
          {currentStatus}
        </div>
      </div>

      <div className="ta-details-grid">
        {isHolidayWorkRequest(row) ? (
          <>
            <div>
              <span>Request Type</span>
              <strong>Holiday Work</strong>
            </div>

            <div>
              <span>Holiday Date</span>
              <strong>{formatDate(row.date)}</strong>
            </div>

            <div>
              <span>Holiday</span>
              <strong>
                {row.holiday_title || row.holiday_name || 'Holiday Work'}
              </strong>
            </div>

            <div>
              <span>Holiday Type</span>
              <strong>{statusLabel(row.holiday_type)}</strong>
            </div>

            <div>
              <span>Work Location</span>
              <strong>{row.work_location || row.field_location || '—'}</strong>
            </div>

            <div>
              <span>Team Leader</span>
              <strong>{row.team_leader_name || '—'}</strong>
            </div>

            <div>
              <span>Reporting Officer</span>
              <strong>{row.reporting_officer_name || '—'}</strong>
            </div>

            <div>
              <span>Submitted On</span>
              <strong>{formatDateTime(row.created_at)}</strong>
            </div>
          </>
        ) : (
          <>
            <div>
              <span>Leave Type</span>
              <strong>{leaveRequestTypeLabel(row)}</strong>
            </div>

            <div>
              <span>From Date</span>
              <strong>{formatDate(row.from_date)}</strong>
            </div>

            <div>
              <span>Upto Date</span>
              <strong>{formatDate(row.upto_date || row.to_date)}</strong>
            </div>

            <div>
              <span>Leave Days</span>
              <strong>{row.leave_days ?? '—'}</strong>
            </div>

            <div>
              <span>Deducted From</span>
              <strong>{deductedLeaveTypeLabel(row)}</strong>
            </div>

            <div>
              <span>LWP Days</span>
              <strong>{lwpDaysLabel(row)}</strong>
            </div>

            <div>
              <span>Task Handover</span>
              <strong>{row.task_handover_to_name || '—'}</strong>
            </div>

            <div>
              <span>Project Handover</span>
              <strong>{row.project_handover_name || '—'}</strong>
            </div>
          </>
        )}
      </div>

      <div className="ta-reason">
        <span>Reason</span>
        <p>{row.reason || 'No reason added.'}</p>

        {isHolidayWorkRequest(row) &&
          (row.proof_photo || row.field_photo || row.photo) && (
            <p>
              <a
                href={row.proof_photo || row.field_photo || row.photo}
                target="_blank"
                rel="noreferrer"
              >
                View supporting photo
              </a>
            </p>
          )}
      </div>

      <ApprovalFlags row={row} />

      <Timeline history={row.approval_history || row.approval_timeline || []} />

      <div className="ta-actions">
        {canDecide ? (
          <div className="ta-request-action-stack">
            <div className="ta-request-action-buttons">
              <button
                type="button"
                className="primary"
                onClick={() => onApprove(row)}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 size={16} className="ta-spin" />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                {isSaving ? 'Approving...' : 'Approve'}
              </button>

              <button
                type="button"
                className="danger"
                onClick={() => onReject(row)}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 size={16} className="ta-spin" />
                ) : (
                  <XCircle size={16} />
                )}
                {isSaving ? 'Rejecting...' : 'Reject'}
              </button>
            </div>

            <TeamApprovalInlineMessage
              message={feedback}
              onClose={onDismissFeedback}
            />
          </div>
        ) : (
          <span className="ta-closed-note">
            {isPending(row)
              ? `This request is pending at ${statusLabel(
                  row.approval_stage,
                )} stage.`
              : `This request is already ${statusLabel(row.status)}.`}
          </span>
        )}
      </div>
    </article>
  );
}

export default function TeamApprovals({ setPage }) {
  const alerts = useCustomAlert();
  const user = currentUser();
  const capabilities = getEmployeeCapabilities(user || {});
  const displayRole = getDisplayRole(user || {});
  const isHrPanel = Boolean(capabilities.isHrAdmin);

  const [rows, setRows] = useState([]);
  const [teamFieldRows, setTeamFieldRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [loadingTeamField, setLoadingTeamField] = useState(true);
  const [refreshingApprovals, setRefreshingApprovals] = useState(false);
  const [refreshingTeamField, setRefreshingTeamField] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [activeSection, setActiveSection] = useState('approvals');
  const [approvalPage, setApprovalPage] = useState(1);
  const [approvalPageSize, setApprovalPageSize] = useState(10);
  const [feedbackMap, setFeedbackMap] = useState({});
  const feedbackTimersRef = useRef({});

  const filteredRows = useMemo(() => {
    const search = q.trim().toLowerCase();

    return rows.filter((row) => {
      if (!search) {
        return true;
      }

      return [
        employeeName(row),
        row.employee_code,
        row.emp_code,
        row.employee_id,
        row.department,
        row.designation,
        row.leave_type,
        row.leave_type_label,
        row.requested_leave_type,
        row.requested_leave_type_label,
        row.deducted_leave_type,
        row.deducted_leave_type_label,
        row.holiday_title,
        row.holiday_name,
        row.work_location,
        row.field_location,
        row.holiday_type,
        row.lwp_days,
        row.reason,
        row.task_handover_to_name,
        row.project_handover_name,
        row.team_leader_name,
        row.reporting_officer_name,
        row.approved_by_team_leader_name,
        row.approved_by_reporting_officer_name,
        row.team_leader_decision_by_name,
        row.reporting_officer_decision_by_name,
        liveStatus(row),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
  }, [q, rows]);

  const pendingCount = rows.filter(isPending).length;
  const approvedCount = rows.filter(isApprovedRecord).length;
  const rejectedCount = rows.filter(isRejectedRecord).length;

  const approvalPageCount = Math.max(
    1,
    Math.ceil(
      filteredRows.length / Math.max(1, Number(approvalPageSize || 10)),
    ),
  );
  const safeApprovalPage = Math.min(
    Math.max(1, approvalPage),
    approvalPageCount,
  );
  const approvalPageStart =
    (safeApprovalPage - 1) * approvalPageSize;
  const pagedApprovalRows = filteredRows.slice(
    approvalPageStart,
    approvalPageStart + approvalPageSize,
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
      }, TEAM_APPROVAL_NOTICE_HIDE_MS);
    }
  }

  async function loadData(
    nextFilter = filter,
    { showLoader = true, feedbackScope = '' } = {},
  ) {
    if (showLoader) {
      setLoading(true);
    } else {
      setRefreshingApprovals(true);
    }

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        'Refreshing leave and holiday work approval requests...',
        'Refreshing',
        { loading: true },
      );
    }

    try {
      const status = nextFilter === 'all' ? '' : nextFilter;

      const [leaveData, holidayData] = await Promise.all([
        getTeamApprovals({ status }),
        getHolidayWorkRequests({ status }),
      ]);

      const leaveItems = normalizeLeaveApprovalList(
        leaveData.items ||
          leaveData.leave_requests ||
          leaveData.pending_leave_approvals ||
          leaveData.my_pending_leave_approvals ||
          [],
      ).map((item) => ({
        ...item,
        request_type: 'leave',
      }));

      const holidayItems = normalizeHolidayWorkApprovalList(
        holidayData.items ||
          holidayData.requests ||
          holidayData.holiday_work_requests ||
          [],
      );

      const mergedItems = [...holidayItems, ...leaveItems];

      setRows(mergedItems);

      setSummary({
        ...(leaveData.summary || {}),
        leave_total: leaveItems.length,
        holiday_work_total: holidayItems.length,
        total: mergedItems.length,
        pending: mergedItems.filter(isPending).length,
        approved: mergedItems.filter(isApprovedRecord).length,
        rejected: mergedItems.filter(isRejectedRecord).length,
      });

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          'Approval requests are up to date.',
          'Refresh Complete',
        );
      }

      return true;
    } catch (error) {
      const errorMessage =
        error.message || 'Unable to load team approvals.';

      showFeedback(
        feedbackScope || 'page',
        'error',
        errorMessage,
        feedbackScope ? 'Refresh Failed' : 'Load Failed',
      );

      return false;
    } finally {
      if (showLoader) {
        setLoading(false);
      } else {
        setRefreshingApprovals(false);
      }
    }
  }

  async function loadTeamFieldAttendance({
    showLoader = true,
    feedbackScope = '',
  } = {}) {
    if (showLoader) {
      setLoadingTeamField(true);
    } else {
      setRefreshingTeamField(true);
    }

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        'Refreshing team field attendance logs...',
        'Refreshing',
        { loading: true },
      );
    }

    try {
      const data = await getTeamFieldAttendance({
        limit: 50,
      });

      setTeamFieldRows(
        data.items || data.logs || data.attendance_logs || [],
      );

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          'Team field attendance logs are up to date.',
          'Refresh Complete',
        );
      }

      return true;
    } catch (error) {
      console.warn('Unable to load team field attendance:', error);

      if (showLoader) {
        setTeamFieldRows([]);
      }

      showFeedback(
        feedbackScope || 'field-page',
        'error',
        error.message || 'Unable to load team field attendance.',
        feedbackScope ? 'Refresh Failed' : 'Field Attendance Load Failed',
      );

      return false;
    } finally {
      if (showLoader) {
        setLoadingTeamField(false);
      } else {
        setRefreshingTeamField(false);
      }
    }
  }

  async function refreshAll() {
    showFeedback(
      'refresh-all',
      'info',
      'Refreshing approvals and team field attendance...',
      'Refreshing',
      { loading: true },
    );

    const [approvalsLoaded, fieldLoaded] = await Promise.all([
      loadData(filter, { showLoader: false }),
      loadTeamFieldAttendance({ showLoader: false }),
    ]);

    if (approvalsLoaded && fieldLoaded) {
      showFeedback(
        'refresh-all',
        'success',
        'Approvals and field attendance are up to date.',
        'Refresh Complete',
      );
      return;
    }

    showFeedback(
      'refresh-all',
      'error',
      'Some team approval data could not be refreshed. Please try again.',
      'Refresh Incomplete',
    );
  }

  useEffect(() => {
    loadData(filter, {
      showLoader: rows.length === 0,
    });
    loadTeamFieldAttendance({
      showLoader: teamFieldRows.length === 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    setApprovalPage(1);
  }, [q, filter, approvalPageSize]);

  useEffect(() => {
    setApprovalPage((current) =>
      Math.min(current, approvalPageCount),
    );
  }, [approvalPageCount]);

  useEffect(() => {
    function dismissFeedback(event) {
      if (event.target?.closest?.('.ta-inline-feedback')) return;

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

  async function approveRequest(row) {
    const requestId = getRequestId(row);
    const feedbackScope = requestId
      ? `request-${requestId}`
      : 'page';

    clearFeedback(feedbackScope);

    if (!requestId) {
      showFeedback(
        feedbackScope,
        'error',
        'Leave request id not found.',
        'Missing Request ID',
      );
      return;
    }

    const isHolidayWork = isHolidayWorkRequest(row);

    const ok = await alerts.confirm(
      isHolidayWork
        ? 'Approve this holiday work request?'
        : 'Approve this leave request?',
      {
        title: isHolidayWork
          ? 'Approve Holiday Work'
          : 'Approve Leave Request',
        confirmText: 'Yes, Approve',
        cancelText: 'Cancel',
        type: 'warning',
      },
    );

    if (!ok) {
      showFeedback(
        feedbackScope,
        'info',
        'No approval changes were made.',
        'Approval Cancelled',
      );
      return;
    }

    try {
      setSavingId(requestId);

      showFeedback(
        feedbackScope,
        'info',
        isHolidayWork
          ? 'Approving this holiday work request...'
          : 'Approving this leave request...',
        'Approval In Progress',
        { loading: true },
      );

      let data;

      if (isHolidayWork) {
        data = await decideHolidayWorkRequest(requestId, {
          status: 'approved',
        });
      } else {
        data = await approveTeamLeaveRequest(requestId);
      }

      const updatedStage = String(
        data?.item?.approval_stage || '',
      ).toLowerCase();
      const updatedStatus = String(
        data?.item?.status || '',
      ).toLowerCase();

      if (data?.item) {
        const mergedItem = {
          ...row,
          ...data.item,
        };

        const normalizedItem = isHolidayWork
          ? normalizeHolidayWorkApprovalList([mergedItem])[0]
          : {
              ...normalizeLeaveApprovalList([mergedItem])[0],
              request_type: 'leave',
            };

        setRows((current) =>
          current.map((item) =>
            getRequestId(item) === requestId
              ? normalizedItem
              : item,
          ),
        );
      }

      if (
        updatedStage === 'reporting_officer' &&
        updatedStatus === 'pending'
      ) {
        showFeedback(
          feedbackScope,
          'success',
          data.message ||
            'Approved by Team Leader. The request has now been sent to the Reporting Officer.',
          'Request Forwarded',
        );
      } else {
        showFeedback(
          feedbackScope,
          'success',
          data.message ||
            (isHolidayWork
              ? 'Holiday work request approved successfully.'
              : 'Leave request approved successfully.'),
          isHolidayWork
            ? 'Holiday Work Approved'
            : 'Leave Approved',
        );
      }

      void loadData(filter, {
        showLoader: false,
      });
    } catch (error) {
      showFeedback(
        feedbackScope,
        'error',
        error.message ||
          (isHolidayWork
            ? 'Unable to approve holiday work request.'
            : 'Unable to approve leave request.'),
        'Approval Failed',
      );
    } finally {
      setSavingId('');
    }
  }

  async function rejectRequest(row) {
    const requestId = getRequestId(row);
    const feedbackScope = requestId
      ? `request-${requestId}`
      : 'page';

    clearFeedback(feedbackScope);

    if (!requestId) {
      showFeedback(
        feedbackScope,
        'error',
        'Leave request id not found.',
        'Missing Request ID',
      );
      return;
    }

    const isHolidayWork = isHolidayWorkRequest(row);

    const reason = await alerts.prompt(
      isHolidayWork
        ? 'Enter holiday work rejection reason:'
        : 'Enter rejection reason:',
      {
        title: isHolidayWork
          ? 'Reject Holiday Work'
          : 'Reject Leave Request',
        confirmText: 'Reject',
        cancelText: 'Cancel',
        placeholder: 'Write rejection reason here...',
        type: 'warning',
      },
    );

    if (reason === null) {
      showFeedback(
        feedbackScope,
        'info',
        'No rejection changes were made.',
        'Rejection Cancelled',
      );
      return;
    }

    try {
      setSavingId(requestId);

      showFeedback(
        feedbackScope,
        'info',
        isHolidayWork
          ? 'Rejecting this holiday work request...'
          : 'Rejecting this leave request...',
        'Rejection In Progress',
        { loading: true },
      );

      let data;

      if (isHolidayWork) {
        data = await decideHolidayWorkRequest(requestId, {
          status: 'rejected',
          reason: reason || '',
          note: reason || '',
        });
      } else {
        data = await rejectTeamLeaveRequest(
          requestId,
          reason || '',
        );
      }

      if (data?.item) {
        const mergedItem = {
          ...row,
          ...data.item,
        };

        const normalizedItem = isHolidayWork
          ? normalizeHolidayWorkApprovalList([mergedItem])[0]
          : {
              ...normalizeLeaveApprovalList([mergedItem])[0],
              request_type: 'leave',
            };

        setRows((current) =>
          current.map((item) =>
            getRequestId(item) === requestId
              ? normalizedItem
              : item,
          ),
        );
      }

      showFeedback(
        feedbackScope,
        'success',
        data.message ||
          (isHolidayWork
            ? 'Holiday work request rejected successfully.'
            : 'Leave request rejected successfully.'),
        isHolidayWork
          ? 'Holiday Work Rejected'
          : 'Leave Rejected',
      );

      void loadData(filter, {
        showLoader: false,
      });
    } catch (error) {
      showFeedback(
        feedbackScope,
        'error',
        error.message ||
          (isHolidayWork
            ? 'Unable to reject holiday work request.'
            : 'Unable to reject leave request.'),
        'Rejection Failed',
      );
    } finally {
      setSavingId('');
    }
  }

  return (
    <div className="page-grid team-approvals-page">
      <style>{`
        .team-approvals-page {
          --ta-ink: #101a3a;
          --ta-copy: #5d6d8d;
          --ta-blue: #4d77dd;
          --ta-cyan: #2eb2b9;
          --ta-violet: #575092;
          --ta-danger: #a2344d;
          width: 100%;
          min-width: 0;
          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          color: var(--ta-ink);
        }

        .team-approvals-page,
        .team-approvals-page * {
          box-sizing: border-box;
        }

        .team-approvals-page > *,
        .team-approvals-page section,
        .team-approvals-page article,
        .team-approvals-page nav,
        .team-approvals-page label {
          min-width: 0;
          max-width: 100%;
        }

        .team-approvals-page::before,
        .team-approvals-page::after,
        .ta-hero::before,
        .ta-hero::after,
        .ta-kpi::before,
        .ta-kpi::after {
          content: none;
          display: none;
          background: none;
        }

        .ta-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(230px, 330px);
          gap: clamp(20px, 3vw, 38px);
          align-items: center;
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

        .ta-hero-copy {
          min-width: 0;
          max-width: 900px;
        }

        .ta-page-kicker,
        .ta-section-kicker {
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

        .ta-page-kicker {
          margin-bottom: 15px;
          padding: 9px 13px;
          box-shadow: 0 8px 18px rgba(77, 119, 221, .18);
        }

        .ta-section-kicker {
          margin-bottom: 10px;
          padding: 7px 10px;
          box-shadow: 0 7px 15px rgba(77, 119, 221, .14);
        }

        .ta-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--ta-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 76px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .ta-hero h1 em {
          color: var(--ta-blue);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .ta-hero p {
          max-width: 860px;
          margin: 17px 0 0;
          color: var(--ta-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .ta-role-pill {
          display: inline-flex;
          max-width: 100%;
          margin: 16px 0 0;
          padding: 8px 11px;
          border: 1px solid rgba(77, 119, 221, .18);
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          font-size: 11px;
          font-weight: 900;
          line-height: 1.4;
        }

        .ta-hero-actions {
          display: grid;
          gap: 10px;
          align-items: start;
        }

        .ta-hero-nav {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .ta-action-stack,
        .ta-field-refresh-stack,
        .ta-request-action-stack {
          display: grid;
          gap: 9px;
          width: 100%;
          min-width: 0;
        }

        .team-approvals-page .primary,
        .team-approvals-page .secondary,
        .team-approvals-page .danger {
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
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            filter 180ms ease,
            opacity 180ms ease;
        }

        .team-approvals-page .primary {
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 10px 22px rgba(77, 119, 221, .18);
        }

        .team-approvals-page .secondary {
          color: #4767b4;
          border-color: rgba(77, 119, 221, .18);
          background: #fff;
        }

        .team-approvals-page .danger {
          color: #a2344d;
          border-color: rgba(162, 52, 77, .18);
          background: #fff0f2;
        }

        .team-approvals-page .primary:hover:not(:disabled),
        .team-approvals-page .secondary:hover:not(:disabled),
        .team-approvals-page .danger:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: saturate(1.03);
        }

        .team-approvals-page .primary:disabled,
        .team-approvals-page .secondary:disabled,
        .team-approvals-page .danger:disabled {
          opacity: .55;
          cursor: not-allowed;
          transform: none;
        }

        .ta-inline-feedback {
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

        .ta-inline-feedback.success {
          border-color: rgba(4, 120, 87, .18);
          color: #047857;
          background: #eaf8f4;
        }

        .ta-inline-feedback.warning {
          border-color: rgba(154, 104, 23, .18);
          color: #9a6817;
          background: #fff4d5;
        }

        .ta-inline-feedback.error {
          border-color: rgba(162, 52, 77, .18);
          color: #a2344d;
          background: #fff0f2;
        }

        .ta-inline-feedback-icon {
          width: 22px;
          height: 22px;
          display: inline-grid;
          place-items: center;
        }

        .ta-inline-feedback-copy {
          min-width: 0;
        }

        .ta-inline-feedback-copy strong,
        .ta-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .ta-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .ta-inline-feedback-copy span {
          font-weight: 750;
        }

        .ta-inline-feedback-close {
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

        .ta-inline-feedback-close:hover {
          background: #fff;
        }

        .ta-page-feedback {
          width: min(620px, 100%);
        }

        .ta-kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .ta-kpi {
          min-width: 0;
          min-height: 120px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 0 16px 30px rgba(34, 38, 110, .07);
        }

        .ta-kpi:nth-child(2) {
          background: #eaf8f4;
        }

        .ta-kpi:nth-child(3) {
          background: #fff0f2;
        }

        .ta-kpi:nth-child(4) {
          background: #f1efff;
        }

        .ta-kpi span,
        .ta-kpi strong,
        .ta-kpi small {
          display: block;
        }

        .ta-kpi span {
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .ta-kpi strong {
          margin-top: 8px;
          color: var(--ta-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(28px, 3vw, 42px);
          line-height: 1;
        }

        .ta-kpi small {
          margin-top: 7px;
          color: var(--ta-copy);
          font-size: 11px;
          line-height: 1.45;
        }

        .ta-section-tabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
          padding: 12px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 22px;
          background: #fff;
          box-shadow: 0 16px 28px rgba(34, 38, 110, .08);
        }

        .ta-section-tab {
          min-width: 0;
          min-height: 62px;
          padding: 11px 14px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          border: 1px solid rgba(77, 119, 221, .22);
          border-radius: 16px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          text-align: left;
          font: inherit;
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .ta-section-tab:hover {
          transform: translateY(-1px);
          border-color: rgba(46, 178, 185, .42);
        }

        .ta-section-tab.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 8px 18px rgba(77, 119, 221, .17);
        }

        .ta-section-tab-copy {
          min-width: 0;
          display: grid;
          gap: 3px;
        }

        .ta-section-tab-copy strong {
          font-size: 12px;
          font-weight: 950;
          line-height: 1.2;
        }

        .ta-section-tab-copy small {
          color: currentColor;
          font-size: 9px;
          font-weight: 700;
          line-height: 1.35;
          opacity: .78;
        }

        .ta-section-tab-count {
          min-width: 28px;
          height: 28px;
          padding: 0 7px;
          display: inline-grid;
          place-items: center;
          border-radius: 999px;
          color: #40348d;
          background: #fff;
          font-size: 9px;
          font-weight: 950;
          white-space: nowrap;
        }

        .ta-section-content {
          display: grid;
          gap: 16px;
          animation: taSectionReveal 220ms ease both;
        }

        @keyframes taSectionReveal {
          from {
            opacity: 0;
            transform: translateY(5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .ta-toolbar,
        .team-approvals-page .panel,
        .ta-card,
        .ta-field-card {
          border: 1px solid rgba(171, 181, 211, .70);
          background: #fff;
          box-shadow: 0 18px 34px rgba(34, 38, 110, .07);
        }

        .ta-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          padding: 15px;
          border-radius: 20px;
        }

        .ta-search {
          min-width: min(430px, 100%);
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 14px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 14px;
          background: rgba(255, 255, 255, .96);
        }

        .ta-search svg {
          color: var(--ta-blue);
        }

        .ta-search input {
          width: 100%;
          min-width: 0;
          border: 0;
          outline: 0;
          background: transparent;
          padding: 13px 0;
          color: var(--ta-ink);
          font: inherit;
          font-weight: 700;
        }

        .ta-filter {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .ta-filter button {
          min-height: 40px;
          padding: 9px 13px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 999px;
          color: var(--ta-copy);
          background: #fff;
          font: inherit;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .ta-filter button.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        }

        .ta-filter button:hover {
          transform: translateY(-1px);
          border-color: rgba(46, 178, 185, .42);
        }

        .ta-view-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 15px;
          border: 1px solid rgba(171, 181, 211, .60);
          border-radius: 16px;
          background: #fff;
        }

        .ta-view-row > span {
          color: var(--ta-copy);
          font-size: 11px;
          font-weight: 850;
        }

        .ta-page-size {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--ta-copy);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .ta-page-size select {
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

        .ta-page-size select:focus {
          border-color: rgba(77, 119, 221, .65);
          box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
        }

        .ta-pagination {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 14px;
          padding-top: 4px;
        }

        .ta-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .ta-page-button,
        .ta-page-number {
          border: 1px solid rgba(77, 119, 221, .18);
          color: #4767b4;
          background: #fff;
          font: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .ta-page-button {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 11px;
        }

        .ta-page-nav {
          min-width: 78px;
        }

        .ta-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .ta-page-number {
          width: 36px;
          height: 36px;
          padding: 0;
          display: grid;
          place-items: center;
          border-radius: 10px;
        }

        .ta-page-number.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        }

        .ta-page-button:hover:not(:disabled),
        .ta-page-number:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(46, 178, 185, .42);
        }

        .ta-page-button:disabled,
        .ta-page-number:disabled {
          opacity: .5;
          cursor: not-allowed;
          transform: none;
        }

        .ta-page-ellipsis {
          width: 18px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .ta-page-indicator {
          min-width: 82px;
          color: var(--ta-copy);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
        }

        .team-approvals-page .panel {
          padding: clamp(20px, 2vw, 28px);
          border-radius: clamp(24px, 2.2vw, 34px);
        }

        .team-approvals-page .toolbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .team-approvals-page .toolbar h3 {
          margin: 0;
          color: var(--ta-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.4vw, 35px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .team-approvals-page .toolbar p {
          margin: 8px 0 0;
          color: var(--ta-copy);
          line-height: 1.6;
        }

        .ta-field-refresh-stack {
          width: min(280px, 100%);
        }

        .ta-field-refresh-stack .secondary {
          justify-self: start;
        }

        .ta-field-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 15px;
          margin-top: 18px;
        }

        .ta-field-card {
          padding: 15px;
          border-radius: 20px;
        }

        .ta-field-card h3 {
          margin: 0;
          color: var(--ta-ink);
          font-size: 20px;
        }

        .ta-field-card p {
          margin: 7px 0 0;
          color: var(--ta-copy);
          font-size: 13px;
          line-height: 1.5;
          font-weight: 700;
        }

        .ta-field-photo {
          width: 100%;
          height: 180px;
          margin-top: 12px;
          overflow: hidden;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 16px;
          background: #f8fafc;
        }

        .ta-field-photo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .ta-field-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 12px;
        }

        .ta-field-actions a {
          padding: 8px 11px;
          border: 1px solid rgba(77, 119, 221, .20);
          border-radius: 999px;
          color: #4767b4;
          background: #f1efff;
          font-size: 12px;
          font-weight: 900;
          text-decoration: none;
        }

        .ta-list {
          display: grid;
          gap: 16px;
        }

        .ta-card {
          padding: clamp(17px, 2vw, 24px);
          border-radius: 22px;
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .ta-card:hover,
        .ta-field-card:hover {
          border-color: rgba(77, 119, 221, .28);
          box-shadow: 0 20px 38px rgba(34, 38, 110, .09);
        }

        .ta-card-top {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .ta-person {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 13px;
          align-items: center;
          min-width: 0;
        }

        .ta-avatar {
          width: 60px;
          height: 60px;
          overflow: hidden;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border: 3px solid #fff;
          border-radius: 18px;
          color: #40348d;
          background: linear-gradient(145deg, #edf6ff, #eaf8f4);
          box-shadow: 0 9px 20px rgba(34, 38, 110, .10);
          font-weight: 900;
        }

        .ta-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .ta-person strong {
          display: block;
          color: var(--ta-ink);
          font-size: 17px;
        }

        .ta-person span,
        .ta-person small {
          display: block;
          margin-top: 3px;
          color: var(--ta-copy);
          font-size: 12px;
          font-weight: 750;
        }

        .ta-stage-pill {
          padding: 9px 13px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 999px;
          color: var(--ta-copy);
          background: #f8fafc;
          font-size: 11px;
          font-weight: 900;
        }

        .ta-stage-pill.team {
          color: #40348d;
          background: #f1efff;
        }

        .ta-stage-pill.reporting {
          color: #245da8;
          background: #edf6ff;
        }

        .ta-stage-pill.hr {
          color: #9a6817;
          background: #fff4d5;
        }

        .ta-stage-pill.approved {
          color: #047857;
          background: #eaf8f4;
        }

        .ta-stage-pill.rejected {
          color: #a2344d;
          background: #fff0f2;
        }

        .ta-details-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-top: 17px;
        }

        .ta-details-grid > div {
          min-width: 0;
          padding: 12px;
          border: 1px solid rgba(162, 169, 196, .46);
          border-radius: 15px;
          background: #edf6ff;
        }

        .ta-details-grid > div:nth-child(4n + 2) {
          background: #eaf8f4;
        }

        .ta-details-grid > div:nth-child(4n + 3) {
          background: #fff4d5;
        }

        .ta-details-grid > div:nth-child(4n + 4) {
          background: #f1efff;
        }

        .ta-details-grid span,
        .ta-reason span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .08em;
        }

        .ta-details-grid strong {
          display: block;
          margin-top: 7px;
          overflow: hidden;
          color: var(--ta-ink);
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
        }

        .ta-reason,
        .ta-timeline,
        .ta-empty-line {
          border: 1px solid rgba(171, 181, 211, .55);
          border-radius: 16px;
          background: linear-gradient(145deg, #f8fbff, #f7f4ff);
          box-shadow: none;
        }

        .ta-reason {
          padding: 14px;
          margin-top: 13px;
        }

        .ta-reason p {
          margin: 7px 0 0;
          color: var(--ta-ink);
          line-height: 1.6;
        }

        .ta-reason a {
          color: var(--ta-blue);
          font-weight: 900;
        }

        .ta-approval-flags {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 13px;
        }

        .ta-approval-flags > div {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 9px;
          align-items: start;
          padding: 12px;
          border: 1px solid rgba(171, 181, 211, .55);
          border-radius: 15px;
          color: var(--ta-copy);
          background: #f8fafc;
          box-shadow: none;
        }

        .ta-approval-flags > div.done {
          border-color: rgba(52, 201, 196, .36);
          color: #047857;
          background: #eaf8f4;
        }

        .ta-approval-flags span {
          display: block;
          color: var(--ta-ink);
          font-size: 13px;
          font-weight: 900;
        }

        .ta-approval-flags small {
          display: block;
          margin-top: 3px;
          color: var(--ta-copy);
          font-weight: 700;
          line-height: 1.35;
        }

        .ta-timeline {
          position: relative;
          display: grid;
          gap: 10px;
          margin-top: 13px;
          padding: 13px;
        }

        .ta-timeline-item {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
        }

        .ta-timeline-dot {
          width: 12px;
          height: 12px;
          margin-top: 4px;
          border-radius: 999px;
          background: linear-gradient(135deg, #4d77dd, #2eb2b9);
          box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
        }

        .ta-timeline-item strong {
          display: block;
          color: var(--ta-ink);
          font-size: 13px;
        }

        .ta-timeline-item span,
        .ta-timeline-item small {
          display: block;
          margin-top: 3px;
          color: var(--ta-copy);
          font-size: 12px;
          line-height: 1.4;
        }

        .ta-empty-line {
          margin-top: 13px;
          padding: 12px;
          color: var(--ta-copy);
          font-weight: 800;
        }

        .ta-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 15px;
        }

        .ta-request-action-stack {
          width: min(430px, 100%);
        }

        .ta-request-action-buttons {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }

        .ta-closed-note {
          color: var(--ta-copy);
          font-weight: 800;
        }

        .ta-empty {
          min-height: 140px;
          padding: 24px;
          border: 1px dashed rgba(77, 119, 221, .30);
          border-radius: 18px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 8px;
          color: var(--ta-copy);
          background: linear-gradient(145deg, #f8fbff, #f8f7ff);
          text-align: center;
          font-weight: 800;
          box-shadow: none;
        }

        .ta-spin {
          animation: taSpin .82s linear infinite;
        }

        @keyframes taSpin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1180px) {
          .ta-kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .ta-details-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .ta-field-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 900px) {
          .ta-hero {
            grid-template-columns: 1fr;
          }

          .ta-hero-actions {
            width: min(520px, 100%);
          }
        }

        @media (max-width: 760px) {
          .team-approvals-page {
            gap: 15px;
          }

          .ta-hero {
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 0 18px 30px rgba(34, 38, 110, .09);
          }

          .ta-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .ta-section-tabs {
            grid-template-columns: 1fr;
          }

          .ta-toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .ta-search {
            width: 100%;
            min-width: 0;
          }

          .ta-filter {
            width: 100%;
          }

          .ta-filter button {
            flex: 1;
          }

          .ta-view-row {
            align-items: stretch;
            flex-direction: column;
          }

          .ta-page-size {
            justify-content: space-between;
          }

          .ta-page-size select {
            flex: 1 1 auto;
          }

          .ta-pagination {
            justify-content: stretch;
          }

          .ta-pagination-controls {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
          }

          .ta-page-numbers,
          .ta-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .ta-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .ta-page-nav {
            width: 100%;
          }

          .team-approvals-page .toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .ta-field-refresh-stack,
          .ta-field-refresh-stack .secondary {
            width: 100%;
          }

          .ta-details-grid,
          .ta-approval-flags,
          .ta-field-grid {
            grid-template-columns: 1fr;
          }

          .ta-card {
            padding: 15px;
          }

          .ta-actions,
          .ta-request-action-buttons {
            justify-content: stretch;
          }

          .ta-request-action-stack,
          .ta-request-action-buttons button {
            width: 100%;
          }
        }

        @media (max-width: 520px) {
          .ta-kpis {
            grid-template-columns: 1fr;
          }

          .ta-hero-nav {
            grid-template-columns: 1fr;
          }

          .ta-filter {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .ta-filter button {
            width: 100%;
          }

          .ta-card-top {
            align-items: stretch;
          }

          .ta-stage-pill {
            align-self: flex-start;
          }
        }

        @media (max-width: 390px) {
          .ta-hero {
            padding: 16px;
          }

          .ta-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .ta-page-number {
            width: 34px;
            height: 34px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .team-approvals-page *,
          .team-approvals-page *::before,
          .team-approvals-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <section className="ta-hero">
        <div className="ta-hero-copy">
          <span className="ta-page-kicker">
            <Sparkles size={13} />
            {isHrPanel ? 'HR Leave Records' : 'Team Approvals'}
          </span>

          <h1>
            {isHrPanel ? (
              <>
                Leave records, <em>clearly.</em>
              </>
            ) : (
              <>
                Approval decisions, <em>connected.</em>
              </>
            )}
          </h1>

          <p>
            {isHrPanel
              ? 'Review final leave records, holiday work approvals, HR notifications, approval history, and pending HR-stage requests. HR/Admin can use this page as the record panel when notifications are received.'
              : 'Review leave and holiday work requests assigned to you as Team Leader or Reporting Officer. Holiday work must be approved before employees can mark attendance on a holiday.'}
          </p>

          <div className="ta-role-pill">
            Current access: {displayRole}
            {capabilities.isTeamLeader ? ' • Team Leader' : ''}
            {capabilities.isReportingOfficer
              ? ' • Reporting Officer'
              : ''}
            {capabilities.isHrAdmin ? ' • HR/Admin Records' : ''}
          </div>
        </div>

        <div className="ta-hero-actions">
          <div className="ta-action-stack">
            <button
              type="button"
              className="primary"
              onClick={refreshAll}
              disabled={
                loading ||
                loadingTeamField ||
                refreshingApprovals ||
                refreshingTeamField
              }
            >
              {refreshingApprovals || refreshingTeamField ? (
                <Loader2 size={16} className="ta-spin" />
              ) : (
                <RefreshCcw size={16} />
              )}
              {refreshingApprovals || refreshingTeamField
                ? 'Refreshing...'
                : 'Refresh'}
            </button>

            <TeamApprovalInlineMessage
              message={feedbackMap['refresh-all']}
              onClose={() => clearFeedback('refresh-all')}
            />
          </div>

          <div className="ta-hero-nav">
            <button
              type="button"
              className="secondary"
              onClick={() => setPage?.('application_status')}
            >
              Application Status
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => setPage?.('leave_requests')}
            >
              Leave Management
            </button>
          </div>
        </div>
      </section>

      <section className="ta-kpis" aria-label="Team approval summary">
        <article className="ta-kpi">
          <span>Pending</span>
          <strong>
            {summary.pending ??
              summary.pending_leave_requests ??
              pendingCount}
          </strong>
          <small>Waiting for decision</small>
        </article>

        <article className="ta-kpi">
          <span>Approved / Stage Approved</span>
          <strong>{summary.approved ?? approvedCount}</strong>
          <small>Leave and holiday work stage approvals</small>
        </article>

        <article className="ta-kpi">
          <span>Rejected</span>
          <strong>{summary.rejected ?? rejectedCount}</strong>
          <small>Rejected or cancelled records</small>
        </article>

        <article className="ta-kpi">
          <span>Total Loaded</span>
          <strong>{summary.total ?? rows.length}</strong>
          <small>Leave and holiday work requests</small>
        </article>
      </section>

      {feedbackMap.page ? (
        <div className="ta-page-feedback">
          <TeamApprovalInlineMessage
            message={feedbackMap.page}
            onClose={() => clearFeedback('page')}
          />
        </div>
      ) : null}

      <nav
        className="ta-section-tabs"
        aria-label="Team approval sections"
      >
        <button
          type="button"
          className={`ta-section-tab ${
            activeSection === 'approvals' ? 'is-active' : ''
          }`}
          onClick={() => setActiveSection('approvals')}
          aria-pressed={activeSection === 'approvals'}
        >
          <UserCheck size={18} />
          <span className="ta-section-tab-copy">
            <strong>Approval Requests</strong>
            <small>Leave and holiday work decisions</small>
          </span>
          <span className="ta-section-tab-count">{rows.length}</span>
        </button>

        <button
          type="button"
          className={`ta-section-tab ${
            activeSection === 'field' ? 'is-active' : ''
          }`}
          onClick={() => setActiveSection('field')}
          aria-pressed={activeSection === 'field'}
        >
          <Clock3 size={18} />
          <span className="ta-section-tab-copy">
            <strong>Team Field Attendance</strong>
            <small>Mapped team field check-ins</small>
          </span>
          <span className="ta-section-tab-count">
            {teamFieldRows.length}
          </span>
        </button>
      </nav>

      {activeSection === 'approvals' ? (
        <section className="ta-section-content">
          <div className="ta-toolbar">
            <label className="ta-search">
              <Search size={16} />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search employee, leave type, holiday, work location, approver, department, reason..."
              />
            </label>

            <div className="ta-filter">
              {[
                ['pending', 'Pending'],
                ['approved', 'Approved'],
                ['rejected', 'Rejected'],
                ['all', 'All'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? 'active' : ''}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="ta-view-row">
            <span>
              {filteredRows.length.toLocaleString('en-IN')} request
              {filteredRows.length === 1 ? '' : 's'}
            </span>

            <label className="ta-page-size">
              <span>View</span>
              <select
                value={approvalPageSize}
                onChange={(event) => {
                  setApprovalPage(1);
                  setApprovalPageSize(Number(event.target.value));
                }}
                aria-label="Approval requests per page"
              >
                {TEAM_APPROVAL_PAGE_SIZES.map((size) => (
                  <option value={size} key={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="ta-list">
            {loading && !rows.length ? (
              <div className="ta-empty">
                <Loader2 size={28} className="ta-spin" />
                <p>Loading approval requests...</p>
              </div>
            ) : null}

            {pagedApprovalRows.map((row) => {
              const requestId = getRequestId(row);
              const feedbackScope = requestId
                ? `request-${requestId}`
                : '';

              return (
                <RequestCard
                  key={requestId}
                  row={row}
                  onApprove={approveRequest}
                  onReject={rejectRequest}
                  savingId={savingId}
                  capabilities={capabilities}
                  feedback={
                    feedbackScope
                      ? feedbackMap[feedbackScope]
                      : null
                  }
                  onDismissFeedback={() =>
                    clearFeedback(feedbackScope)
                  }
                />
              );
            })}

            {!loading && !filteredRows.length ? (
              <div className="ta-empty">
                <FileText size={28} />
                <p>
                  No leave or holiday work approval request found for this
                  filter.
                </p>
              </div>
            ) : null}
          </div>

          <TeamApprovalPagination
            total={filteredRows.length}
            page={safeApprovalPage}
            pageSize={approvalPageSize}
            onPageChange={setApprovalPage}
          />
        </section>
      ) : null}

      {activeSection === 'field' ? (
        <section className="ta-section-content panel ta-section-panel">
          <div className="toolbar">
            <div>
              <span className="ta-section-kicker">
                Field Operations
              </span>
              <h3>Team Field Attendance</h3>
              <p>
                Shows field check-ins from your mapped team members with
                visit place, submitted photo and location map.
              </p>
            </div>

            <div className="ta-field-refresh-stack">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  loadTeamFieldAttendance({
                    showLoader: false,
                    feedbackScope: 'field-refresh',
                  })
                }
                disabled={loadingTeamField || refreshingTeamField}
              >
                {refreshingTeamField ? (
                  <Loader2 size={15} className="ta-spin" />
                ) : (
                  <RefreshCcw size={15} />
                )}
                {refreshingTeamField
                  ? 'Refreshing...'
                  : 'Refresh Field Logs'}
              </button>

              <TeamApprovalInlineMessage
                message={feedbackMap['field-refresh']}
                onClose={() => clearFeedback('field-refresh')}
              />
            </div>
          </div>

          {feedbackMap['field-page'] ? (
            <TeamApprovalInlineMessage
              message={feedbackMap['field-page']}
              onClose={() => clearFeedback('field-page')}
            />
          ) : null}

          {loadingTeamField && !teamFieldRows.length ? (
            <div className="ta-empty">
              <Loader2 size={28} className="ta-spin" />
              <p>Loading team field attendance...</p>
            </div>
          ) : null}

          {!loadingTeamField && !teamFieldRows.length ? (
            <div className="ta-empty">
              <FileText size={28} />
              <p>No field attendance found for your mapped team.</p>
            </div>
          ) : null}

          {!!teamFieldRows.length ? (
            <div className="ta-field-grid">
              {teamFieldRows.map((row) => {
                const photoUrl = fieldPhotoUrl(row);
                const mapUrl = fieldMapUrl(row);

                return (
                  <article
                    key={
                      row._id ||
                      row.id ||
                      `${row.employee_id}-${row.date}-${row.check_in}`
                    }
                    className="ta-field-card"
                  >
                    <h3>{employeeName(row)}</h3>

                    <p>
                      {row.employee_code ||
                        row.emp_code ||
                        'Employee'}{' '}
                      • {row.department || 'Department'} •{' '}
                      {formatDate(row.date)}
                    </p>

                    <p>
                      <strong>Place:</strong>{' '}
                      {row.field_location ||
                        row.work_location ||
                        '—'}
                    </p>

                    <p>
                      <strong>Check-in:</strong>{' '}
                      {formatDateTime(
                        row.check_in || row.check_in_at,
                      )}
                    </p>

                    {photoUrl ? (
                      <div className="ta-field-photo">
                        <img
                          src={photoUrl}
                          alt={`${employeeName(
                            row,
                          )} field attendance`}
                        />
                      </div>
                    ) : (
                      <div className="ta-empty-line">
                        No field photo submitted.
                      </div>
                    )}

                    <div className="ta-field-actions">
                      {photoUrl ? (
                        <a
                          href={photoUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Photo
                        </a>
                      ) : null}

                      {mapUrl ? (
                        <a
                          href={mapUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Location
                        </a>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
