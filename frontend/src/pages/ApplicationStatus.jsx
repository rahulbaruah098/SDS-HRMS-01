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
  XCircle,
} from 'lucide-react';
import {
  api,
  getInitials,
  getProfilePhotoUrl,
  normalizeLeaveApprovalList,
  getMyHolidayWorkRequests,
} from '../api/client';
import Table from '../components/Table';

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

function modeLabel(value) {
  if (value === 'wfh') return 'Work From Home';
  if (value === 'field') return 'Field';
  if (value === 'office') return 'Office';

  return statusLabel(value);
}

function isTeamLeaderApproved(row = {}) {
  return (
    Boolean(row.approved_by_team_leader) ||
    Boolean(row.approved_by_team_leader_name) ||
    Boolean(row.approved_by_team_leader_at) ||
    Boolean(row.team_leader_decision_by_name) ||
    String(row.team_leader_status || '').toLowerCase() === 'approved'
  );
}

function isReportingOfficerApproved(row = {}) {
  return (
    Boolean(row.approved_by_reporting_officer) ||
    Boolean(row.approved_by_reporting_officer_name) ||
    Boolean(row.approved_by_reporting_officer_at) ||
    Boolean(row.reporting_officer_decision_by_name) ||
    String(row.reporting_officer_status || '').toLowerCase() === 'approved'
  );
}

function isHrNotified(row = {}) {
  return (
    Boolean(row.hr_notified) ||
    Boolean(row.hr_notified_at) ||
    Boolean(row.hr_record_notification_sent) ||
    String(row.hr_notified_status || '').toLowerCase() === 'notified'
  );
}

function liveStatus(row = {}) {
  if (row.live_status || row.status_text || row.status_display) {
    return row.live_status || row.status_text || row.status_display;
  }

  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved' || stage === 'approved') {
    if (row.approved_by_reporting_officer_name || row.reporting_officer_decision_by_name) {
      return `Approved by Reporting Officer ${row.approved_by_reporting_officer_name || row.reporting_officer_decision_by_name}`;
    }

    if (row.approved_by_team_leader_name || row.team_leader_decision_by_name) {
      return `Approved by Team Leader ${row.approved_by_team_leader_name || row.team_leader_decision_by_name}`;
    }

    return 'Approved';
  }

  if (status === 'rejected' || stage === 'rejected') {
    if (row.rejected_by_role && row.rejected_by_name) {
      return `Rejected by ${statusLabel(row.rejected_by_role)} ${row.rejected_by_name}`;
    }

    return 'Rejected / Cancelled';
  }

  if (stage === 'team_leader') {
    return 'Pending with Team Leader';
  }

  if (stage === 'reporting_officer') {
    if (isTeamLeaderApproved(row)) {
      return 'Approved by Team Leader, Pending with Reporting Officer';
    }

    return 'Pending with Reporting Officer';
  }

  if (stage === 'hr') {
    return 'Pending with HR/Admin';
  }

  return row.approval_stage_label || statusLabel(row.status);
}

function stageClass(row = {}) {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved' || stage === 'approved') return 'approved';
  if (status === 'rejected' || stage === 'rejected') return 'rejected';
  if (stage === 'hr') return 'hr';
  if (stage === 'reporting_officer') return 'reporting';
  if (stage === 'team_leader') return 'team';

  return 'pending';
}

function normalizeMainRows(rows = []) {
  return rows.map((row) => ({
    type: row.type || '—',
    title: row.title || '—',
    date: formatDate(row.date),
    live_status: row.live_status || row.status_text || row.status_display || '—',
    status: statusLabel(row.status),
  }));
}

function normalizeLeaveRows(rows = []) {
  return normalizeLeaveApprovalList(rows).map((row) => ({
    leave_type: leaveRequestTypeLabel(row),
    leave_days: row.leave_days ?? '—',
    deducted_from: deductedLeaveTypeLabel(row),
    lwp_days: lwpDaysLabel(row),
    from_date: formatDate(row.from_date),
    upto_date: formatDate(row.to_date || row.upto_date),
    reason: row.reason || '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    current_stage: liveStatus(row),
    team_leader: row.team_leader_name || '—',
    approved_by_team_leader:
      row.approved_by_team_leader_name ||
      row.team_leader_decision_by_name ||
      (isTeamLeaderApproved(row) ? 'Approved' : '—'),
    reporting_officer: row.reporting_officer_name || '—',
    approved_by_reporting_officer:
      row.approved_by_reporting_officer_name ||
      row.reporting_officer_decision_by_name ||
      (isReportingOfficerApproved(row) ? 'Approved' : '—'),
    hr_record_notified: isHrNotified(row) ? 'Yes' : 'No',
    final_status: statusLabel(row.status),
    rejected_by:
      row.rejected_by_name
        ? `${statusLabel(row.rejected_by_role || '')} ${row.rejected_by_name}`.trim()
        : '—',
    created_at: formatDateTime(row.created_at),
  }));
}

function normalizeHolidayWorkRows(rows = []) {
  return rows.map((row) => ({
    holiday: row.holiday_title || row.holiday_name || 'Holiday Work',
    date: formatDate(row.date),
    reason: row.reason || '—',
    work_location: row.work_location || row.field_location || '—',
    current_stage: liveStatus(row),
    approval_stage: row.approval_stage_label || statusLabel(row.approval_stage),
    final_status: statusLabel(row.status),
    decided_by: row.decided_by_name || row.approved_by_name || row.rejected_by_name || '—',
    decided_at: formatDateTime(row.decided_at || row.approved_at || row.rejected_at),
    created_at: formatDateTime(row.created_at),
  }));
}

function normalizeTicketRows(rows = []) {
  return rows.map((row) => ({
    title: row.title || row.subject || 'Ticket',
    category: row.category || '—',
    priority: statusLabel(row.priority),
    status: statusLabel(row.status),
    created_at: formatDateTime(row.created_at),
    updated_at: formatDateTime(row.updated_at),
  }));
}

function normalizeCompOffRows(rows = []) {
  return rows.map((row) => ({
    holiday: row.holiday_title || row.holiday_name || 'Comp-Off',
    earned_date: formatDate(row.earned_date),
    claim_from_date: formatDate(row.claim_from_date || row.available_from),
    expiry_date: formatDate(row.expiry_date || row.valid_until),
    claimed_date: formatDate(row.claim_date || row.claimed_date),
    leave_request_id: row.leave_request_id || '—',
    status: statusLabel(row.status),
  }));
}

function normalizeNotificationRows(rows = []) {
  return rows.map((row) => ({
    title: row.title || '—',
    message: row.body || row.message || '—',
    status: row.read ? 'Read' : statusLabel(row.status || 'unread'),
    created_at: formatDateTime(row.created_at),
  }));
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

function EmployeeAvatar({ row }) {
  const name = employeeName(row);
  const photoUrl = getProfilePhotoUrl(employeePhotoRecord(row));

  return (
    <div className="as-avatar">
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
      <div className="as-empty-line">
        No approval action has been recorded yet.
      </div>
    );
  }

  return (
    <div className="as-timeline">
      {history.map((item, index) => (
        <div className="as-timeline-item" key={`${item.at || item.created_at || index}-${item.name || index}`}>
          <div className="as-timeline-dot" />

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

function LeaveStatusCard({ row }) {
  const teamLeaderApproved = isTeamLeaderApproved(row);
  const reportingOfficerApproved = isReportingOfficerApproved(row);
  const hrNotified = isHrNotified(row);
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  return (
    <article className="as-leave-card">
      <div className="as-leave-card-head">
        <div className="as-person">
          <EmployeeAvatar row={row} />

          <div>
            <strong>{employeeName(row)}</strong>
            <span>
              {row.employee_code || row.emp_code || row.employee_id || 'Employee'}
              {row.department ? ` • ${row.department}` : ''}
            </span>
            <small>{row.designation || leaveRequestTypeLabel(row)}</small>
          </div>
        </div>

        <div className={`as-stage-pill ${stageClass(row)}`}>
          {liveStatus(row)}
        </div>
      </div>

      <div className="as-leave-meta-grid">
        <div>
          <span>Leave Type</span>
          <strong>{leaveRequestTypeLabel(row)}</strong>
        </div>

        <div>
          <span>From</span>
          <strong>{formatDate(row.from_date)}</strong>
        </div>

        <div>
          <span>Upto</span>
          <strong>{formatDate(row.upto_date || row.to_date)}</strong>
        </div>

          <div>
            <span>Days</span>
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
      </div>

      <div className="as-reason">
        <span>Reason</span>
        <p>{row.reason || 'No reason added.'}</p>
      </div>

      <div className="as-stage-grid">
        <div className={teamLeaderApproved ? 'done' : ''}>
          <CheckCircle2 size={16} />
          <span>
            Team Leader Approval
            <small>
              {teamLeaderApproved
                ? `${row.approved_by_team_leader_name || row.team_leader_decision_by_name || 'Approved'} • ${formatDateTime(row.approved_by_team_leader_at || row.team_leader_decision_at)}`
                : stage === 'team_leader'
                  ? `Pending with ${row.team_leader_name || 'Team Leader'}`
                  : row.team_leader_name
                    ? `Mapped to ${row.team_leader_name}`
                    : 'Not mapped / skipped'}
            </small>
          </span>
        </div>

        <div className={reportingOfficerApproved ? 'done' : ''}>
          <ShieldCheck size={16} />
          <span>
            Reporting Officer Approval
            <small>
              {reportingOfficerApproved
                ? `${row.approved_by_reporting_officer_name || row.reporting_officer_decision_by_name || 'Approved'} • ${formatDateTime(row.approved_by_reporting_officer_at || row.reporting_officer_decision_at)}`
                : stage === 'reporting_officer'
                  ? `Pending with ${row.reporting_officer_name || 'Reporting Officer'}`
                  : row.reporting_officer_name
                    ? `Mapped to ${row.reporting_officer_name}`
                    : 'Not mapped'}
            </small>
          </span>
        </div>

        <div className={hrNotified ? 'done' : ''}>
          <FileText size={16} />
          <span>
            HR Record Notification
            <small>
              {hrNotified
                ? `HR notified ${formatDateTime(row.hr_notified_at)}`
                : status === 'approved' || status === 'rejected'
                  ? 'Waiting for HR notification sync'
                  : 'HR will be notified after final approval/rejection'}
            </small>
          </span>
        </div>
      </div>

      {status === 'rejected' && (
        <div className="as-rejected-note">
          <XCircle size={16} />
          <span>
            Rejected by {statusLabel(row.rejected_by_role || '')} {row.rejected_by_name || ''}
            {row.rejected_at ? ` • ${formatDateTime(row.rejected_at)}` : ''}
          </span>
        </div>
      )}

      <Timeline history={row.approval_history || row.approval_timeline || []} />
    </article>
  );
}


const APPLICATION_NOTICE_HIDE_MS = 3600;
const APPLICATION_PAGE_SIZES = [10, 25, 50, 100];

function applicationPageNumbers(pageCount, page) {
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

function rowSearchText(row = {}) {
  return Object.values(row)
    .flatMap((value) => {
      if (value === null || value === undefined) return [];

      if (typeof value === 'object') {
        try {
          return [JSON.stringify(value)];
        } catch {
          return [];
        }
      }

      return [String(value)];
    })
    .join(' ')
    .toLowerCase();
}

function leaveTrackerSearchText(row = {}) {
  return [
    employeeName(row),
    row.employee_code,
    row.emp_code,
    row.employee_id,
    row.department,
    row.designation,
    leaveRequestTypeLabel(row),
    row.reason,
    liveStatus(row),
    statusLabel(row.status),
    row.team_leader_name,
    row.reporting_officer_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function ApplicationInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`as-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="as-inline-feedback-icon">
        {message.loading ? (
          <Loader2 size={15} className="as-spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="as-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="as-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function ApplicationPagination({
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
    <div className="as-pagination">
      <div className="as-pagination-controls">
        <button
          type="button"
          className="as-page-button as-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="as-page-numbers" aria-label="Pagination">
          {applicationPageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`as-page-number ${
                  item === safePage ? 'is-active' : ''
                }`}
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span className="as-page-ellipsis" key={item}>
                …
              </span>
            ),
          )}
        </div>

        <span className="as-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="as-page-button as-page-nav"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

function PaginatedStatusTable({
  rows = [],
  maxColumns = 8,
  searchPlaceholder = 'Search records...',
  emptyText = 'No records found.',
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();

    if (!term) return rows;

    return rows.filter((row) => rowSearchText(row).includes(term));
  }, [query, rows]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredRows.length / Math.max(1, pageSize)),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = filteredRows.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return (
    <div className="as-data-browser">
      <div className="as-data-controls">
        <label className="as-search-box">
          <Search size={17} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </label>

        <div className="as-view-control">
          <span>
            {filteredRows.length.toLocaleString('en-IN')} record
            {filteredRows.length === 1 ? '' : 's'}
          </span>

          <label className="as-page-size">
            <span>View</span>
            <select
              value={pageSize}
              onChange={(event) =>
                setPageSize(Number(event.target.value))
              }
              aria-label="Records per page"
            >
              {APPLICATION_PAGE_SIZES.map((size) => (
                <option value={size} key={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {filteredRows.length ? (
        <>
          <Table rows={pagedRows} maxColumns={maxColumns} />

          <ApplicationPagination
            total={filteredRows.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </>
      ) : (
        <div className="as-empty">
          <Search size={26} />
          <p>{query ? 'No matching records found.' : emptyText}</p>
        </div>
      )}
    </div>
  );
}

function LeaveTrackerBrowser({ rows = [] }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();

    if (!term) return rows;

    return rows.filter((row) =>
      leaveTrackerSearchText(row).includes(term),
    );
  }, [query, rows]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredRows.length / Math.max(1, pageSize)),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = filteredRows.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return (
    <div className="as-data-browser as-tracker-browser">
      <div className="as-data-controls">
        <label className="as-search-box">
          <Search size={17} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search employee, leave type, stage or status..."
            aria-label="Search leave approval tracker"
          />
        </label>

        <div className="as-view-control">
          <span>
            {filteredRows.length.toLocaleString('en-IN')} request
            {filteredRows.length === 1 ? '' : 's'}
          </span>

          <label className="as-page-size">
            <span>View</span>
            <select
              value={pageSize}
              onChange={(event) =>
                setPageSize(Number(event.target.value))
              }
              aria-label="Leave tracker requests per page"
            >
              {APPLICATION_PAGE_SIZES.map((size) => (
                <option value={size} key={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {filteredRows.length ? (
        <>
          <div className="as-live-grid">
            {pagedRows.map((row, index) => (
              <LeaveStatusCard
                key={
                  row._id ||
                  row.id ||
                  row.request_id ||
                  `${employeeName(row)}-${pageStart + index}`
                }
                row={row}
              />
            ))}
          </div>

          <ApplicationPagination
            total={filteredRows.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </>
      ) : (
        <div className="as-empty">
          <Clock3 size={28} />
          <p>
            {query
              ? 'No leave request matches the current search.'
              : 'No leave request status found.'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function ApplicationStatus() {
  const [data, setData] = useState(null);
  const [holidayWorkRequests, setHolidayWorkRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingHolidayWork, setLoadingHolidayWork] = useState(false);
  const [activeSection, setActiveSection] = useState('leave');
  const [activeActivitySection, setActiveActivitySection] = useState('tickets');
  const [feedbackMap, setFeedbackMap] = useState({});
  const feedbackTimersRef = useRef({});

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
      }, APPLICATION_NOTICE_HIDE_MS);
    }
  }

  async function loadStatus({ feedbackScope = '' } = {}) {
    try {
      setLoading(true);

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'info',
          'Refreshing application status...',
          'Refreshing',
          { loading: true },
        );
      }

      const res = await api('/application_status');
      setData(res);

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          'Application status is up to date.',
          'Refresh Complete',
        );
      }

      return true;
    } catch (error) {
      const errorMessage =
        error.message || 'Unable to load application status.';

      showFeedback(
        feedbackScope || 'page',
        'error',
        errorMessage,
        'Status Load Failed',
      );

      return false;
    } finally {
      setLoading(false);
    }
  }

  async function loadHolidayWorkRequests({
    feedbackScope = '',
  } = {}) {
    try {
      setLoadingHolidayWork(true);

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'info',
          'Refreshing holiday work request status...',
          'Refreshing',
          { loading: true },
        );
      }

      const res = await getMyHolidayWorkRequests();
      setHolidayWorkRequests(res.items || res.requests || []);

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          'Holiday work request status is up to date.',
          'Refresh Complete',
        );
      }

      return true;
    } catch (error) {
      setHolidayWorkRequests([]);

      const errorMessage =
        error.message || 'Unable to load holiday work request status.';

      showFeedback(
        feedbackScope || 'page',
        'error',
        errorMessage,
        'Holiday Work Status Failed',
      );

      return false;
    } finally {
      setLoadingHolidayWork(false);
    }
  }

  useEffect(() => {
    loadStatus();
    loadHolidayWorkRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function dismissFeedback(event) {
      if (event.target?.closest?.('.as-inline-feedback')) return;

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

  async function refreshAllStatus() {
    showFeedback(
      'refresh-all',
      'info',
      'Refreshing all application status records...',
      'Refreshing',
      { loading: true },
    );

    const [statusLoaded, holidayLoaded] = await Promise.all([
      loadStatus(),
      loadHolidayWorkRequests(),
    ]);

    if (statusLoaded && holidayLoaded) {
      showFeedback(
        'refresh-all',
        'success',
        'All application status records are up to date.',
        'Refresh Complete',
      );
      return;
    }

    showFeedback(
      'refresh-all',
      'error',
      'Some application status records could not be refreshed. Please try again.',
      'Refresh Incomplete',
    );
  }

  const summary = data?.summary || {};

  const rawLeaveRows = useMemo(
    () => normalizeLeaveApprovalList(data?.leave_requests || []),
    [data],
  );

  const mainRows = useMemo(
    () => normalizeMainRows(data?.items || []),
    [data],
  );

  const leaveRows = useMemo(
    () => normalizeLeaveRows(data?.leave_requests || []),
    [data],
  );

  const holidayWorkRows = useMemo(
    () => normalizeHolidayWorkRows(holidayWorkRequests),
    [holidayWorkRequests],
  );

  const ticketRows = useMemo(
    () => normalizeTicketRows(data?.tickets || []),
    [data],
  );

  const compOffRows = useMemo(
    () => normalizeCompOffRows(data?.compoff_claims || []),
    [data],
  );

  const notificationRows = useMemo(
    () => normalizeNotificationRows(data?.notifications || []),
    [data],
  );

  const pendingLeaves = rawLeaveRows.filter((row) =>
    ['pending', 'in_review'].includes(
      String(row.status || '').toLowerCase(),
    ),
  ).length;

  const approvedLeaves = rawLeaveRows.filter(
    (row) =>
      String(row.status || '').toLowerCase() === 'approved' ||
      isTeamLeaderApproved(row) ||
      isReportingOfficerApproved(row),
  ).length;

  const rejectedLeaves = rawLeaveRows.filter(
    (row) => String(row.status || '').toLowerCase() === 'rejected',
  ).length;

  const hrNotifiedLeaves = rawLeaveRows.filter(isHrNotified).length;

  const otherActivityCount =
    ticketRows.length + compOffRows.length + notificationRows.length;

  return (
    <div className="page-grid application-status-page">
      <style>{`
        .application-status-page {
          --as-ink: #101a3a;
          --as-copy: #5d6d8d;
          --as-blue: #4d77dd;
          --as-cyan: #2eb2b9;
          --as-violet: #575092;
          --as-danger: #a2344d;
          --as-line: rgba(16, 26, 58, .14);
          width: 100%;
          min-width: 0;
          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          color: var(--as-ink);
        }

        .application-status-page,
        .application-status-page * {
          box-sizing: border-box;
        }

        .application-status-page > *,
        .application-status-page section,
        .application-status-page article,
        .application-status-page nav,
        .application-status-page label {
          min-width: 0;
          max-width: 100%;
        }

        .application-status-page::before,
        .application-status-page::after,
        .application-status-page .as-page-hero::before,
        .application-status-page .as-page-hero::after,
        .application-status-page .as-kpi-card::before,
        .application-status-page .as-kpi-card::after {
          content: none;
          display: none;
          background: none;
        }

        .application-status-page .as-page-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(220px, 330px);
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

        .as-hero-copy {
          min-width: 0;
          max-width: 900px;
        }

        .as-page-kicker,
        .as-section-kicker {
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

        .as-page-kicker {
          margin-bottom: 15px;
          padding: 9px 13px;
          box-shadow: 0 8px 18px rgba(77, 119, 221, .18);
        }

        .as-section-kicker {
          margin-bottom: 10px;
          padding: 7px 10px;
          box-shadow: 0 7px 15px rgba(77, 119, 221, .14);
        }

        .application-status-page .as-page-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--as-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 76px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .application-status-page .as-page-hero h1 em {
          color: var(--as-blue);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .application-status-page .as-page-hero p {
          max-width: 820px;
          margin: 17px 0 0;
          color: var(--as-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .as-refresh-stack,
        .as-panel-refresh-stack {
          display: grid;
          gap: 9px;
          width: 100%;
          min-width: 0;
          align-items: start;
        }

        .as-refresh-stack {
          width: min(300px, 100%);
        }

        .application-status-page .secondary {
          min-height: 44px;
          padding: 10px 15px;
          border: 1px solid rgba(77, 119, 221, .18);
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: max-content;
          color: #4767b4;
          background: #fff;
          box-shadow: none;
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

        .application-status-page .secondary:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(46, 178, 185, .42);
          filter: saturate(1.03);
        }

        .application-status-page .secondary:disabled {
          opacity: .55;
          cursor: not-allowed;
          transform: none;
        }

        .as-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .as-kpi-card {
          min-width: 0;
          min-height: 120px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 0 16px 30px rgba(34, 38, 110, .07);
        }

        .as-kpi-card:nth-child(2) {
          background: #eaf8f4;
        }

        .as-kpi-card:nth-child(3) {
          background: #fff4d5;
        }

        .as-kpi-card:nth-child(4) {
          background: #f1efff;
        }

        .as-kpi-card span,
        .as-kpi-card strong,
        .as-kpi-card small {
          display: block;
        }

        .as-kpi-card span {
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .as-kpi-card strong {
          margin-top: 8px;
          color: var(--as-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(28px, 3vw, 42px);
          line-height: 1;
        }

        .as-kpi-card small {
          margin-top: 7px;
          color: var(--as-copy);
          font-size: 11px;
          line-height: 1.45;
        }

        .as-section-tabs {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
          padding: 12px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 22px;
          background: #fff;
          box-shadow: 0 16px 28px rgba(34, 38, 110, .08);
        }

        .as-section-tab {
          min-width: 0;
          min-height: 64px;
          padding: 11px 13px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
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

        .as-section-tab:hover {
          transform: translateY(-1px);
          border-color: rgba(46, 178, 185, .42);
        }

        .as-section-tab.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 8px 18px rgba(77, 119, 221, .17);
        }

        .as-section-tab-copy {
          min-width: 0;
          display: grid;
          gap: 3px;
        }

        .as-section-tab-copy strong {
          font-size: 11px;
          font-weight: 950;
          line-height: 1.2;
        }

        .as-section-tab-copy small {
          color: currentColor;
          font-size: 8px;
          font-weight: 700;
          line-height: 1.3;
          opacity: .78;
        }

        .as-section-tab-count {
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

        .as-activity-subtabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          width: 100%;
          padding: 10px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 12px 24px rgba(34, 38, 110, .06);
        }

        .as-activity-subtab {
          min-width: 0;
          min-height: 54px;
          padding: 10px 12px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          border: 1px solid rgba(77, 119, 221, .18);
          border-radius: 14px;
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

        .as-activity-subtab:hover {
          transform: translateY(-1px);
          border-color: rgba(46, 178, 185, .42);
        }

        .as-activity-subtab.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 8px 18px rgba(77, 119, 221, .15);
        }

        .as-activity-subtab-copy {
          min-width: 0;
          display: grid;
          gap: 2px;
        }

        .as-activity-subtab-copy strong {
          font-size: 11px;
          font-weight: 950;
          line-height: 1.2;
        }

        .as-activity-subtab-copy small {
          color: currentColor;
          font-size: 8px;
          font-weight: 700;
          line-height: 1.3;
          opacity: .78;
        }

        .as-activity-subtab-count {
          min-width: 26px;
          height: 26px;
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

        .as-activity-subcontent {
          animation: asSectionReveal 220ms ease both;
        }

        .as-section-content {
          display: grid;
          gap: 18px;
          animation: asSectionReveal 220ms ease both;
        }

        @keyframes asSectionReveal {
          from {
            opacity: 0;
            transform: translateY(5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .application-status-page .panel {
          min-width: 0;
          padding: clamp(20px, 2vw, 28px);
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(24px, 2.2vw, 34px);
          background: #fff;
          box-shadow: 0 20px 38px rgba(34, 38, 110, .08);
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .application-status-page .panel:hover {
          border-color: rgba(77, 119, 221, .28);
          box-shadow: 0 22px 42px rgba(34, 38, 110, .10);
        }

        .application-status-page .toolbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .application-status-page .toolbar h3 {
          margin: 0;
          color: var(--as-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.4vw, 35px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .application-status-page .toolbar p {
          margin: 8px 0 0;
          color: var(--as-copy);
          line-height: 1.6;
        }

        .as-leave-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin: 18px 0 4px;
        }

        .as-leave-summary-card {
          padding: 13px;
          border: 1px solid rgba(171, 181, 211, .54);
          border-radius: 16px;
          background: #edf6ff;
        }

        .as-leave-summary-card:nth-child(2) {
          background: #eaf8f4;
        }

        .as-leave-summary-card:nth-child(3) {
          background: #fff0f2;
        }

        .as-leave-summary-card:nth-child(4) {
          background: #f1efff;
        }

        .as-leave-summary-card span,
        .as-leave-summary-card strong {
          display: block;
        }

        .as-leave-summary-card span {
          color: var(--as-copy);
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .as-leave-summary-card strong {
          margin-top: 6px;
          color: var(--as-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: 26px;
        }

        .as-data-browser {
          min-width: 0;
          margin-top: 16px;
        }

        .as-tracker-browser {
          margin-top: 0;
        }

        .as-data-controls {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) auto;
          gap: 12px;
          align-items: center;
          margin-bottom: 14px;
        }

        .as-search-box {
          position: relative;
          min-width: 0;
          display: block;
        }

        .as-search-box > svg {
          position: absolute;
          top: 50%;
          left: 13px;
          color: var(--as-blue);
          transform: translateY(-50%);
          pointer-events: none;
        }

        .as-search-box input,
        .as-page-size select {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 14px;
          outline: 0;
          color: var(--as-ink);
          background: rgba(255, 255, 255, .96);
          font: inherit;
        }

        .as-search-box input {
          min-height: 46px;
          padding: 0 13px 0 39px;
          font-size: 13px;
        }

        .as-search-box input:focus,
        .as-page-size select:focus {
          border-color: rgba(77, 119, 221, .65);
          box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
        }

        .as-view-control {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }

        .as-view-control > span {
          color: var(--as-copy);
          font-size: 10px;
          font-weight: 850;
          white-space: nowrap;
        }

        .as-page-size {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--as-copy);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .as-page-size select {
          width: auto;
          min-width: 78px;
          min-height: 38px;
          padding: 0 28px 0 10px;
          color: #40348d;
          background: #f1efff;
          font-size: 10px;
          font-weight: 900;
        }

        .as-pagination {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 14px;
          margin-top: 14px;
          padding-top: 13px;
          border-top: 1px solid rgba(65, 55, 161, .08);
        }

        .as-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .as-page-button,
        .as-page-number {
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

        .as-page-button {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 11px;
        }

        .as-page-nav {
          min-width: 78px;
        }

        .as-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .as-page-number {
          width: 36px;
          height: 36px;
          padding: 0;
          display: grid;
          place-items: center;
          border-radius: 10px;
        }

        .as-page-number.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        }

        .as-page-button:hover:not(:disabled),
        .as-page-number:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(46, 178, 185, .42);
        }

        .as-page-button:disabled,
        .as-page-number:disabled {
          opacity: .5;
          cursor: not-allowed;
          transform: none;
        }

        .as-page-ellipsis {
          width: 18px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .as-page-indicator {
          min-width: 82px;
          color: var(--as-copy);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
        }

        .as-live-grid {
          display: grid;
          gap: 16px;
        }

        .as-leave-card {
          padding: clamp(17px, 2vw, 24px);
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: 22px;
          background: #fff;
          box-shadow: 0 14px 28px rgba(34, 38, 110, .07);
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .as-leave-card:hover {
          border-color: rgba(77, 119, 221, .28);
          box-shadow: 0 17px 32px rgba(34, 38, 110, .09);
        }

        .as-leave-card-head {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .as-person {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 13px;
          align-items: center;
          min-width: 0;
        }

        .as-avatar {
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

        .as-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .as-person strong {
          display: block;
          color: var(--as-ink);
          font-size: 17px;
        }

        .as-person span,
        .as-person small {
          display: block;
          margin-top: 3px;
          color: var(--as-copy);
          font-size: 12px;
          font-weight: 750;
        }

        .as-stage-pill {
          padding: 9px 13px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 999px;
          color: var(--as-copy);
          background: #f8fafc;
          font-size: 11px;
          font-weight: 900;
        }

        .as-stage-pill.team {
          color: #40348d;
          background: #f1efff;
        }

        .as-stage-pill.reporting {
          color: #245da8;
          background: #edf6ff;
        }

        .as-stage-pill.hr {
          color: #9a6817;
          background: #fff4d5;
        }

        .as-stage-pill.approved {
          color: #047857;
          background: #eaf8f4;
        }

        .as-stage-pill.rejected {
          color: #a2344d;
          background: #fff0f2;
        }

        .as-leave-meta-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-top: 17px;
        }

        .as-leave-meta-grid > div {
          min-width: 0;
          padding: 12px;
          border: 1px solid rgba(162, 169, 196, .46);
          border-radius: 16px;
          background: #edf6ff;
        }

        .as-leave-meta-grid > div:nth-child(4n + 2) {
          background: #eaf8f4;
        }

        .as-leave-meta-grid > div:nth-child(4n + 3) {
          background: #fff4d5;
        }

        .as-leave-meta-grid > div:nth-child(4n + 4) {
          background: #f1efff;
        }

        .as-leave-meta-grid span,
        .as-reason span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .08em;
        }

        .as-leave-meta-grid strong {
          display: block;
          margin-top: 7px;
          overflow: hidden;
          color: var(--as-ink);
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
        }

        .as-reason,
        .as-timeline,
        .as-empty-line {
          border: 1px solid rgba(171, 181, 211, .55);
          border-radius: 18px;
          background: linear-gradient(145deg, #f8fbff, #f7f4ff);
          box-shadow: none;
        }

        .as-reason {
          padding: 14px;
          margin-top: 13px;
        }

        .as-reason p {
          margin: 7px 0 0;
          color: var(--as-ink);
          line-height: 1.6;
        }

        .as-stage-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 13px;
        }

        .as-stage-grid > div {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 9px;
          align-items: start;
          padding: 12px;
          border: 1px solid rgba(171, 181, 211, .55);
          border-radius: 16px;
          color: var(--as-copy);
          background: #f8fafc;
          box-shadow: none;
        }

        .as-stage-grid > div.done {
          border-color: rgba(52, 201, 196, .36);
          color: #047857;
          background: #eaf8f4;
        }

        .as-stage-grid span {
          display: block;
          color: var(--as-ink);
          font-size: 13px;
          font-weight: 900;
        }

        .as-stage-grid small {
          display: block;
          margin-top: 3px;
          color: var(--as-copy);
          font-weight: 700;
          line-height: 1.35;
        }

        .as-rejected-note {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-top: 13px;
          padding: 12px;
          border: 1px solid rgba(216, 77, 104, .28);
          border-radius: 16px;
          color: #a2344d;
          background: #fff0f2;
          font-weight: 850;
        }

        .as-timeline {
          position: relative;
          display: grid;
          gap: 10px;
          margin-top: 13px;
          padding: 13px;
        }

        .as-timeline-item {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
        }

        .as-timeline-dot {
          width: 12px;
          height: 12px;
          margin-top: 4px;
          border-radius: 999px;
          background: linear-gradient(135deg, #4d77dd, #2eb2b9);
          box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
        }

        .as-timeline-item strong {
          display: block;
          color: var(--as-ink);
          font-size: 13px;
        }

        .as-timeline-item span,
        .as-timeline-item small {
          display: block;
          margin-top: 3px;
          color: var(--as-copy);
          font-size: 12px;
          line-height: 1.4;
        }

        .as-empty-line {
          margin-top: 13px;
          padding: 12px;
          color: var(--as-copy);
          font-weight: 800;
        }

        .as-empty {
          min-height: 140px;
          padding: 24px;
          border: 1px dashed rgba(77, 119, 221, .30);
          border-radius: 18px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 8px;
          color: var(--as-copy);
          background: linear-gradient(145deg, #f8fbff, #f8f7ff);
          text-align: center;
          font-weight: 800;
          box-shadow: none;
        }

        .application-status-page .table-wrap {
          width: 100%;
          max-width: 100%;
          overflow-x: auto;
          margin-top: 0;
          border: 1px solid rgba(171, 181, 211, .56);
          border-radius: 18px;
          background: #fff;
          box-shadow: none;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
        }

        .application-status-page table {
          min-width: max-content;
        }

        .application-status-page th {
          color: #536381;
          background: linear-gradient(180deg, #f8f8ff, #f4f8fb);
        }

        .application-status-page tr:hover td {
          background: #fafcff;
        }

        .as-inline-feedback {
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

        .as-inline-feedback.success {
          border-color: rgba(4, 120, 87, .18);
          color: #047857;
          background: #eaf8f4;
        }

        .as-inline-feedback.warning {
          border-color: rgba(154, 104, 23, .18);
          color: #9a6817;
          background: #fff4d5;
        }

        .as-inline-feedback.error {
          border-color: rgba(162, 52, 77, .18);
          color: #a2344d;
          background: #fff0f2;
        }

        .as-inline-feedback-icon {
          width: 22px;
          height: 22px;
          display: inline-grid;
          place-items: center;
        }

        .as-inline-feedback-copy {
          min-width: 0;
        }

        .as-inline-feedback-copy strong,
        .as-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .as-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .as-inline-feedback-copy span {
          font-weight: 750;
        }

        .as-inline-feedback-close {
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

        .as-inline-feedback-close:hover {
          background: #fff;
        }

        .as-page-feedback {
          width: min(600px, 100%);
        }

        .as-panel-refresh-stack {
          width: min(260px, 100%);
        }

        .as-panel-refresh-stack .secondary {
          justify-self: start;
        }

        .as-two-col {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
          align-items: start;
        }

        .as-spin {
          animation: asSpin .82s linear infinite;
        }

        @keyframes asSpin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1180px) {
          .as-kpi-grid,
          .as-leave-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .as-section-tabs {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .as-activity-subtabs {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .as-leave-meta-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 900px) {
          .application-status-page .as-page-hero {
            grid-template-columns: 1fr;
          }

          .as-refresh-stack {
            width: min(360px, 100%);
          }

          .as-two-col {
            grid-template-columns: 1fr;
          }

          .as-data-controls {
            grid-template-columns: 1fr;
          }

          .as-view-control {
            justify-content: space-between;
          }
        }

        @media (max-width: 760px) {
          .application-status-page {
            gap: 15px;
          }

          .application-status-page .as-page-hero {
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 0 18px 30px rgba(34, 38, 110, .09);
          }

          .application-status-page .as-page-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .as-section-tabs,
          .as-activity-subtabs {
            grid-template-columns: 1fr;
          }

          .application-status-page .toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .as-panel-refresh-stack {
            width: min(320px, 100%);
          }

          .as-leave-meta-grid,
          .as-stage-grid {
            grid-template-columns: 1fr;
          }

          .as-leave-card {
            padding: 15px;
          }

          .as-pagination {
            justify-content: stretch;
          }

          .as-pagination-controls {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
          }

          .as-page-numbers,
          .as-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .as-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .as-page-nav {
            width: 100%;
          }
        }

        @media (max-width: 520px) {
          .as-kpi-grid,
          .as-leave-summary-grid {
            grid-template-columns: 1fr;
          }

          .as-view-control {
            align-items: stretch;
            flex-direction: column;
          }

          .as-page-size {
            justify-content: space-between;
          }

          .as-page-size select {
            flex: 1 1 auto;
          }

          .as-leave-card-head {
            align-items: stretch;
          }

          .as-stage-pill {
            align-self: flex-start;
          }
        }

        @media (max-width: 390px) {
          .application-status-page .as-page-hero {
            padding: 16px;
          }

          .application-status-page .as-page-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .as-page-number {
            width: 34px;
            height: 34px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .application-status-page *,
          .application-status-page *::before,
          .application-status-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <section className="hero compact as-page-hero">
        <div className="as-hero-copy">
          <span className="as-page-kicker">
            <Sparkles size={13} />
            Live Status
          </span>

          <h1>
            Every request, <em>in view.</em>
          </h1>

          <p>
            Track leave, holiday work approvals, tickets, grievances,
            comp-off records and notifications from one connected
            YourComate workspace.
          </p>
        </div>

        <div className="as-refresh-stack">
          <button
            type="button"
            className="secondary"
            onClick={refreshAllStatus}
            disabled={loading || loadingHolidayWork}
          >
            {loading || loadingHolidayWork ? (
              <Loader2 size={16} className="as-spin" />
            ) : (
              <RefreshCcw size={16} />
            )}
            {loading || loadingHolidayWork
              ? 'Refreshing...'
              : 'Refresh'}
          </button>

          <ApplicationInlineMessage
            message={feedbackMap['refresh-all']}
            onClose={() => clearFeedback('refresh-all')}
          />
        </div>
      </section>

      <section className="as-kpi-grid" aria-label="Application status summary">
        <article className="as-kpi-card">
          <span>Total Requests</span>
          <strong>{summary.total || 0}</strong>
          <small>All tracked application and request records</small>
        </article>

        <article className="as-kpi-card">
          <span>Pending / Open</span>
          <strong>{summary.pending || 0}</strong>
          <small>Requests still waiting for action or completion</small>
        </article>

        <article className="as-kpi-card">
          <span>Approved / Resolved</span>
          <strong>{summary.approved || 0}</strong>
          <small>Requests already approved or successfully resolved</small>
        </article>

        <article className="as-kpi-card">
          <span>Rejected / Cancelled</span>
          <strong>{summary.rejected || 0}</strong>
          <small>Requests closed through rejection or cancellation</small>
        </article>
      </section>

      {feedbackMap.page ? (
        <div className="as-page-feedback">
          <ApplicationInlineMessage
            message={feedbackMap.page}
            onClose={() => clearFeedback('page')}
          />
        </div>
      ) : null}

      <nav
        className="as-section-tabs"
        aria-label="Application status sections"
      >
        <button
          type="button"
          className={`as-section-tab ${
            activeSection === 'leave' ? 'is-active' : ''
          }`}
          onClick={() => setActiveSection('leave')}
          aria-pressed={activeSection === 'leave'}
        >
          <ShieldCheck size={18} />
          <span className="as-section-tab-copy">
            <strong>Leave Approvals</strong>
            <small>Live journey and leave records</small>
          </span>
          <span className="as-section-tab-count">
            {rawLeaveRows.length}
          </span>
        </button>

        <button
          type="button"
          className={`as-section-tab ${
            activeSection === 'applications' ? 'is-active' : ''
          }`}
          onClick={() => setActiveSection('applications')}
          aria-pressed={activeSection === 'applications'}
        >
          <FileText size={18} />
          <span className="as-section-tab-copy">
            <strong>All Applications</strong>
            <small>Unified request overview</small>
          </span>
          <span className="as-section-tab-count">{mainRows.length}</span>
        </button>

        <button
          type="button"
          className={`as-section-tab ${
            activeSection === 'holiday' ? 'is-active' : ''
          }`}
          onClick={() => setActiveSection('holiday')}
          aria-pressed={activeSection === 'holiday'}
        >
          <Clock3 size={18} />
          <span className="as-section-tab-copy">
            <strong>Holiday Work</strong>
            <small>Holiday attendance approvals</small>
          </span>
          <span className="as-section-tab-count">
            {holidayWorkRows.length}
          </span>
        </button>

        <button
          type="button"
          className={`as-section-tab ${
            activeSection === 'activity' ? 'is-active' : ''
          }`}
          onClick={() => setActiveSection('activity')}
          aria-pressed={activeSection === 'activity'}
        >
          <CheckCircle2 size={18} />
          <span className="as-section-tab-copy">
            <strong>Support & Activity</strong>
            <small>Tickets, comp-off and notifications</small>
          </span>
          <span className="as-section-tab-count">
            {otherActivityCount}
          </span>
        </button>
      </nav>

      {activeSection === 'leave' ? (
        <div className="as-section-content">
          <section className="panel as-section-panel">
            <div className="toolbar">
              <div>
                <span className="as-section-kicker">
                  Approval Journey
                </span>
                <h3>Leave Approval Live Tracker</h3>
                <p>
                  Shows Team Leader approval, Reporting Officer approval,
                  final approval/rejection, and HR record notification
                  status.
                </p>
              </div>
            </div>

            <div className="as-leave-summary-grid">
              <article className="as-leave-summary-card">
                <span>Pending Leaves</span>
                <strong>{pendingLeaves}</strong>
              </article>

              <article className="as-leave-summary-card">
                <span>Approved / Stage Approved</span>
                <strong>{approvedLeaves}</strong>
              </article>

              <article className="as-leave-summary-card">
                <span>Rejected Leaves</span>
                <strong>{rejectedLeaves}</strong>
              </article>

              <article className="as-leave-summary-card">
                <span>HR Notified Records</span>
                <strong>{hrNotifiedLeaves}</strong>
              </article>
            </div>

            <LeaveTrackerBrowser rows={rawLeaveRows} />
          </section>

          <section className="panel as-section-panel">
            <div className="toolbar">
              <div>
                <span className="as-section-kicker">
                  Leave Records
                </span>
                <h3>Leave Requests Table</h3>
                <p>
                  Shows whether leave is pending with Team Leader,
                  approved by Team Leader and pending with Reporting
                  Officer, approved by Reporting Officer, rejected, or
                  notified to HR.
                </p>
              </div>
            </div>

            <PaginatedStatusTable
              rows={leaveRows}
              maxColumns={14}
              searchPlaceholder="Search leave type, stage, dates or status..."
              emptyText="No leave request records found."
            />
          </section>
        </div>
      ) : null}

      {activeSection === 'applications' ? (
        <div className="as-section-content">
          <section className="panel as-section-panel">
            <div className="toolbar">
              <div>
                <span className="as-section-kicker">
                  Unified Overview
                </span>
                <h3>All Application Status</h3>
                <p>
                  This table shows the latest live status across all
                  request types.
                </p>
              </div>
            </div>

            <PaginatedStatusTable
              rows={mainRows}
              maxColumns={8}
              searchPlaceholder="Search request type, title, date or status..."
              emptyText="No application status records found."
            />
          </section>
        </div>
      ) : null}

      {activeSection === 'holiday' ? (
        <div className="as-section-content">
          <section className="panel as-section-panel">
            <div className="toolbar">
              <div>
                <span className="as-section-kicker">
                  Holiday Attendance
                </span>
                <h3>Holiday Work Requests</h3>
                <p>
                  Shows holiday work approval status before marking
                  attendance on Sunday, second Saturday, fourth Saturday,
                  or HR-created holidays.
                </p>
              </div>

              <div className="as-panel-refresh-stack">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    loadHolidayWorkRequests({
                      feedbackScope: 'holiday-refresh',
                    })
                  }
                  disabled={loadingHolidayWork}
                >
                  {loadingHolidayWork ? (
                    <Loader2 size={15} className="as-spin" />
                  ) : (
                    <RefreshCcw size={15} />
                  )}
                  {loadingHolidayWork ? 'Refreshing...' : 'Refresh'}
                </button>

                <ApplicationInlineMessage
                  message={feedbackMap['holiday-refresh']}
                  onClose={() => clearFeedback('holiday-refresh')}
                />
              </div>
            </div>

            <PaginatedStatusTable
              rows={holidayWorkRows}
              maxColumns={10}
              searchPlaceholder="Search holiday, stage, location or status..."
              emptyText="No holiday work request records found."
            />
          </section>
        </div>
      ) : null}

      {activeSection === 'activity' ? (
        <div className="as-section-content">
          <nav
            className="as-activity-subtabs"
            aria-label="Support and activity sections"
          >
            <button
              type="button"
              className={`as-activity-subtab ${
                activeActivitySection === 'tickets' ? 'is-active' : ''
              }`}
              onClick={() => setActiveActivitySection('tickets')}
              aria-pressed={activeActivitySection === 'tickets'}
            >
              <FileText size={16} />
              <span className="as-activity-subtab-copy">
                <strong>Tickets / Grievances</strong>
                <small>Support request tracking</small>
              </span>
              <span className="as-activity-subtab-count">
                {ticketRows.length}
              </span>
            </button>

            <button
              type="button"
              className={`as-activity-subtab ${
                activeActivitySection === 'compoff' ? 'is-active' : ''
              }`}
              onClick={() => setActiveActivitySection('compoff')}
              aria-pressed={activeActivitySection === 'compoff'}
            >
              <Clock3 size={16} />
              <span className="as-activity-subtab-copy">
                <strong>Comp-Off Status</strong>
                <small>Earned benefit records</small>
              </span>
              <span className="as-activity-subtab-count">
                {compOffRows.length}
              </span>
            </button>

            <button
              type="button"
              className={`as-activity-subtab ${
                activeActivitySection === 'notifications' ? 'is-active' : ''
              }`}
              onClick={() => setActiveActivitySection('notifications')}
              aria-pressed={activeActivitySection === 'notifications'}
            >
              <CheckCircle2 size={16} />
              <span className="as-activity-subtab-copy">
                <strong>Recent Notifications</strong>
                <small>Recent request activity</small>
              </span>
              <span className="as-activity-subtab-count">
                {notificationRows.length}
              </span>
            </button>
          </nav>

          {activeActivitySection === 'tickets' ? (
            <section className="panel as-section-panel as-activity-subcontent">
              <div className="toolbar">
                <div>
                  <span className="as-section-kicker">
                    Support Tracking
                  </span>
                  <h3>Tickets / Grievances</h3>
                  <p>
                    Shows the current status of your raised tickets and
                    grievances.
                  </p>
                </div>
              </div>

              <PaginatedStatusTable
                rows={ticketRows}
                maxColumns={8}
                searchPlaceholder="Search ticket, category, priority or status..."
                emptyText="No ticket or grievance records found."
              />
            </section>
          ) : null}

          {activeActivitySection === 'compoff' ? (
            <section className="panel as-section-panel as-activity-subcontent">
              <div className="toolbar">
                <div>
                  <span className="as-section-kicker">
                    Earned Benefits
                  </span>
                  <h3>Comp-Off Status</h3>
                  <p>
                    Shows available, claimed, used, and expired comp-off
                    records with claim window and linked leave request.
                  </p>
                </div>
              </div>

              <PaginatedStatusTable
                rows={compOffRows}
                maxColumns={8}
                searchPlaceholder="Search comp-off date, claim or status..."
                emptyText="No comp-off records found."
              />
            </section>
          ) : null}

          {activeActivitySection === 'notifications' ? (
            <section className="panel as-section-panel as-activity-subcontent">
              <div className="toolbar">
                <div>
                  <span className="as-section-kicker">
                    Recent Activity
                  </span>
                  <h3>Recent Notifications</h3>
                  <p>
                    Shows recent notifications related to your requests.
                  </p>
                </div>
              </div>

              <PaginatedStatusTable
                rows={notificationRows}
                maxColumns={8}
                searchPlaceholder="Search notification title, message or status..."
                emptyText="No recent notifications found."
              />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
