import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FileText,
  RefreshCcw,
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
import Stat from '../components/Stat';
import Table from '../components/Table';
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

export default function ApplicationStatus() {
  const alerts = useCustomAlert();

  const [data, setData] = useState(null);
  const [holidayWorkRequests, setHolidayWorkRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingHolidayWork, setLoadingHolidayWork] = useState(false);

  async function loadStatus() {
    try {
      setLoading(true);

      const res = await api('/application_status');
      setData(res);
    } catch (error) {
      alerts.error(
        error.message || 'Unable to load application status.',
        'Status Load Failed',
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadHolidayWorkRequests() {
    try {
      setLoadingHolidayWork(true);

      const res = await getMyHolidayWorkRequests();
      setHolidayWorkRequests(res.items || res.requests || []);
    } catch (error) {
      setHolidayWorkRequests([]);
      alerts.error(
        error.message || 'Unable to load holiday work request status.',
        'Holiday Work Status Failed',
      );
    } finally {
      setLoadingHolidayWork(false);
    }
  }

  useEffect(() => {
    loadStatus();
    loadHolidayWorkRequests();
  }, []);

  async function refreshAllStatus() {
    await Promise.all([
      loadStatus(),
      loadHolidayWorkRequests(),
    ]);
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

  const pendingLeaves = rawLeaveRows.filter(
    (row) => ['pending', 'in_review'].includes(String(row.status || '').toLowerCase()),
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

  return (
    <div className="page-grid application-status-page">
      <style>{`
        .application-status-page {
          --as-ink: #101a3a;
          --as-copy: #5d6d8d;
          --as-violet: #6658dc;
          --as-violet-deep: #40348d;
          --as-blue: #3766db;
          --as-cyan: #18b5c8;
          --as-teal: #34c9c4;
          --as-yellow: #d8ff43;
          --as-danger: #d84d68;
          --as-line: rgba(16, 26, 58, .14);
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          color: var(--as-ink);
        }

        .application-status-page .as-page-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: clamp(22px, 3vw, 40px);
          align-items: center;
          min-height: 260px;
          padding: clamp(25px, 3vw, 42px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background:
            radial-gradient(circle at 8% 6%, rgba(105, 217, 208, .26), transparent 29%),
            radial-gradient(circle at 95% 4%, rgba(153, 164, 245, .24), transparent 31%),
            linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%);
          box-shadow:
            12px 14px 0 #c6d8f7,
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .application-status-page .as-page-hero::before {
          content: "";
          position: absolute;
          z-index: -1;
          width: 175px;
          height: 175px;
          right: 8%;
          bottom: -98px;
          border-radius: 38% 62% 58% 42% / 48% 43% 57% 52%;
          background: linear-gradient(
            145deg,
            rgba(105, 217, 208, .30),
            rgba(132, 181, 241, .28)
          );
          transform: rotate(-18deg);
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
          background: #342b78;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .as-page-kicker {
          margin-bottom: 15px;
          padding: 9px 13px;
          box-shadow: 4px 5px 0 #18b5c8;
        }

        .as-section-kicker {
          margin-bottom: 10px;
          padding: 7px 10px;
          box-shadow: 3px 4px 0 #18b5c8;
        }

        .application-status-page .as-page-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--as-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 77px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .application-status-page .as-page-hero h1 em {
          color: var(--as-violet);
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

        .application-status-page .as-page-hero .secondary {
          min-height: 54px;
          padding-inline: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          border: 1px solid rgba(65, 55, 161, .18);
          border-radius: 18px;
          color: #40348d;
          background: rgba(255, 255, 255, .90);
          box-shadow:
            6px 7px 0 #b9d7ff,
            0 14px 25px rgba(44, 75, 116, .10);
          font-weight: 900;
          white-space: nowrap;
          transition:
            transform 190ms cubic-bezier(.22,1,.36,1),
            box-shadow 190ms ease;
        }

        .application-status-page .as-page-hero .secondary svg:first-child {
          animation: asRefreshIdle 4.2s linear infinite;
        }

        .application-status-page .as-page-hero .secondary:disabled svg:first-child {
          animation: asSpin 1s linear infinite;
        }

        .application-status-page .as-page-hero .secondary:hover {
          transform: translateY(-3px);
          box-shadow:
            8px 9px 0 #b9d7ff,
            0 18px 30px rgba(44, 75, 116, .14);
        }

        .application-status-page .stats-grid {
          gap: 15px;
        }

        .application-status-page .stats-grid .stat-card {
          min-height: 122px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow:
            7px 9px 0 #b9d7ff,
            0 18px 30px rgba(34, 38, 110, .09);
          transition:
            transform 210ms cubic-bezier(.22,1,.36,1),
            box-shadow 210ms ease;
        }

        .application-status-page .stats-grid .stat-card:nth-child(4n + 2) {
          background: #eaf8f4;
          box-shadow:
            7px 9px 0 #aee6d9,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .application-status-page .stats-grid .stat-card:nth-child(4n + 3) {
          background: #fff0f2;
          box-shadow:
            7px 9px 0 #f2c2cc,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .application-status-page .stats-grid .stat-card:nth-child(4n + 4) {
          background: #f1efff;
          box-shadow:
            7px 9px 0 #c9c0ff,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .application-status-page .stats-grid .stat-card:hover {
          transform: translateY(-4px);
        }

        .application-status-page .stats-grid .stat-card span {
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .10em;
          text-transform: uppercase;
        }

        .application-status-page .stats-grid .stat-card strong {
          margin-top: 9px;
          color: var(--as-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(31px, 3vw, 46px);
        }

        .application-status-page .panel {
          min-width: 0;
          padding: clamp(20px, 2vw, 28px);
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34, 38, 110, .10);
          transition:
            transform 210ms cubic-bezier(.22,1,.36,1),
            box-shadow 210ms ease,
            border-color 210ms ease;
        }

        .application-status-page .panel:hover {
          border-color: rgba(102, 88, 220, .28);
          transform: translateY(-3px);
          box-shadow:
            10px 12px 0 #c4ccff,
            0 30px 50px rgba(34, 38, 110, .14);
        }

        .application-status-page .toolbar {
          align-items: flex-start;
          gap: 16px;
        }

        .application-status-page .toolbar h3 {
          margin: 0;
          color: var(--as-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(26px, 2.4vw, 39px);
          font-weight: 760;
          line-height: .98;
          letter-spacing: -.045em;
        }

        .application-status-page .toolbar p {
          margin-top: 8px;
          color: var(--as-copy);
          line-height: 1.62;
        }

        .as-live-grid {
          display: grid;
          gap: 18px;
          margin-top: 18px;
        }

        .as-leave-card {
          padding: clamp(17px, 2vw, 24px);
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: 27px;
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            7px 9px 0 #c4ccff,
            0 21px 38px rgba(34, 38, 110, .09);
          transition:
            transform 210ms cubic-bezier(.22,1,.36,1),
            box-shadow 210ms ease,
            border-color 210ms ease;
        }

        .as-leave-card:hover {
          border-color: rgba(102, 88, 220, .28);
          transform: translateY(-3px);
          box-shadow:
            9px 11px 0 #c4ccff,
            0 28px 46px rgba(34, 38, 110, .13);
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
          border-radius: 20px;
          color: #40348d;
          background: linear-gradient(145deg, #edf6ff, #eaf8f4);
          box-shadow:
            5px 6px 0 #b9d7ff,
            0 13px 26px rgba(34, 38, 110, .12);
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
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .08);
          font-size: 11px;
          font-weight: 900;
        }

        .as-stage-pill.team {
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .as-stage-pill.reporting {
          color: #245da8;
          background: #edf6ff;
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .as-stage-pill.hr {
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .as-stage-pill.approved {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .as-stage-pill.rejected {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
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
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .as-leave-meta-grid > div:nth-child(4n + 2) {
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .as-leave-meta-grid > div:nth-child(4n + 3) {
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .as-leave-meta-grid > div:nth-child(4n + 4) {
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
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
          box-shadow: 4px 5px 0 rgba(52, 43, 120, .08);
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
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .07);
        }

        .as-stage-grid > div.done {
          border-color: rgba(52, 201, 196, .36);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
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
          box-shadow: 3px 4px 0 #f2c2cc;
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
          background: linear-gradient(135deg, #6658dc, #34c9c4);
          box-shadow: 0 0 0 4px rgba(102, 88, 220, .10);
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
          padding: 24px;
          border: 1px dashed rgba(102, 88, 220, .34);
          border-radius: 22px;
          color: var(--as-copy);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          text-align: center;
          font-weight: 800;
          box-shadow: 4px 5px 0 rgba(52, 43, 120, .07);
        }

        .application-status-page .table-wrap {
          margin-top: 16px;
          border: 1px solid rgba(171, 181, 211, .56);
          border-radius: 18px;
          background: #fff;
          box-shadow: 4px 5px 0 rgba(52, 43, 120, .08);
        }

        .application-status-page th {
          color: #536381;
          background: linear-gradient(180deg, #f8f8ff, #f4f8fb);
        }

        .application-status-page tr:hover td {
          background: #fafaff;
        }

        .application-status-page .secondary {
          border-radius: 15px;
          border-color: rgba(65, 55, 161, .18);
          color: #40348d;
          background: rgba(255, 255, 255, .90);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
          font-weight: 900;
          transition:
            transform 190ms ease,
            box-shadow 190ms ease;
        }

        .application-status-page .secondary:hover {
          transform: translateY(-2px);
        }

        .as-dual-section {
          gap: 24px;
          align-items: stretch;
        }

        .as-dual-section > .panel {
          height: 100%;
        }

        @keyframes asRefreshIdle {
          0%, 84% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes asSpin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 1180px) {
          .as-leave-meta-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .application-status-page {
            gap: 18px;
          }

          .application-status-page .as-page-hero {
            grid-template-columns: 1fr;
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow:
              6px 7px 0 #c6d8f7,
              0 18px 30px rgba(34, 38, 110, .10);
          }

          .application-status-page .as-page-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .application-status-page .as-page-hero .secondary {
            width: 100%;
          }

          .application-status-page .stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .application-status-page .stats-grid .stat-card,
          .application-status-page .panel,
          .as-leave-card {
            border-radius: 22px;
            box-shadow:
              5px 6px 0 #c4ccff,
              0 17px 28px rgba(34, 38, 110, .09);
          }

          .as-leave-card {
            padding: 15px;
          }

          .as-leave-meta-grid,
          .as-stage-grid {
            grid-template-columns: 1fr;
          }

          .application-status-page .toolbar {
            align-items: stretch;
          }

          .application-status-page .toolbar > button {
            width: 100%;
          }
        }

        @media (max-width: 430px) {
          .application-status-page .as-page-hero {
            padding: 16px;
          }

          .application-status-page .as-page-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .application-status-page .stats-grid {
            grid-template-columns: 1fr;
          }

          .application-status-page .stats-grid .stat-card {
            min-height: 106px;
            padding: 15px;
          }

          .as-leave-card-head {
            align-items: stretch;
          }

          .as-stage-pill {
            align-self: flex-start;
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
        <div>
          <span className="as-page-kicker">
            <Sparkles size={13} />
            Live Status
          </span>

          <h1>
            Every request, <em>in view.</em>
          </h1>

          <p>
            Track leave, holiday work approvals, tickets, grievances, comp-off
            records and notifications from one connected YourComate workspace.
          </p>
        </div>

          <button
            type="button"
            className="secondary"
            onClick={refreshAllStatus}
            disabled={loading || loadingHolidayWork}
          >
            <RefreshCcw size={16} />
            {loading || loadingHolidayWork ? 'Refreshing...' : 'Refresh'}
            <ArrowUpRight size={15} />
          </button>
      </section>

      <section className="stats-grid">
        <Stat label="Total Requests" value={summary.total || 0} />
        <Stat label="Pending / Open" value={summary.pending || 0} />
        <Stat label="Approved / Resolved" value={summary.approved || 0} />
        <Stat label="Rejected / Cancelled" value={summary.rejected || 0} />
      </section>

      <section className="stats-grid">
        <Stat label="Pending Leaves" value={pendingLeaves} />
        <Stat label="Approved / Stage Approved Leaves" value={approvedLeaves} />
        <Stat label="Rejected Leaves" value={rejectedLeaves} />
        <Stat label="HR Notified Leave Records" value={hrNotifiedLeaves} />
      </section>

      <section className="panel as-section-panel">
        <div className="toolbar">
          <div>
            <span className="as-section-kicker">Approval Journey</span>
            <h3>Leave Approval Live Tracker</h3>
            <p>
              Shows Team Leader approval, Reporting Officer approval, final
              approval/rejection, and HR record notification status.
            </p>
          </div>
        </div>

        <div className="as-live-grid">
          {rawLeaveRows.map((row) => (
            <LeaveStatusCard key={row._id || row.id || row.request_id} row={row} />
          ))}

          {!rawLeaveRows.length && (
            <div className="as-empty">
              <Clock3 size={28} />
              <p>No leave request status found.</p>
            </div>
          )}
        </div>
      </section>

      <section className="panel as-section-panel">
        <div className="toolbar">
          <div>
            <span className="as-section-kicker">Unified Overview</span>
            <h3>All Application Status</h3>
            <p>
              This table shows the latest live status across all request types.
            </p>
          </div>
        </div>

        <Table rows={mainRows} maxColumns={8} />
      </section>

      <section className="panel as-section-panel">
        <div className="toolbar">
          <div>
            <span className="as-section-kicker">Leave Records</span>
            <h3>Leave Requests Table</h3>
            <p>
              Shows whether leave is pending with Team Leader, approved by Team
              Leader and pending with Reporting Officer, approved by Reporting
              Officer, rejected, or notified to HR.
            </p>
          </div>
        </div>

        <Table rows={leaveRows} maxColumns={14} />
      </section>

<section className="panel as-section-panel">
  <div className="toolbar">
    <div>
      <span className="as-section-kicker">Holiday Attendance</span>
      <h3>Holiday Work Requests</h3>
      <p>
        Shows holiday work approval status before marking attendance on
        Sunday, second Saturday, fourth Saturday, or HR-created holidays.
      </p>
    </div>

    <button
      type="button"
      className="secondary"
      onClick={loadHolidayWorkRequests}
      disabled={loadingHolidayWork}
    >
      {loadingHolidayWork ? 'Refreshing...' : 'Refresh'}
    </button>
  </div>

  <Table rows={holidayWorkRows} maxColumns={10} />
</section>

      <section className="panel as-section-panel">
        <div className="toolbar">
          <div>
            <span className="as-section-kicker">Support Tracking</span>
            <h3>Tickets / Grievances</h3>
            <p>Shows the current status of your raised tickets and grievances.</p>
          </div>
        </div>

        <Table rows={ticketRows} maxColumns={8} />
      </section>

      <section className="two-col as-dual-section">
        <div className="panel as-section-panel">
          <div className="toolbar">
            <div>
              <span className="as-section-kicker">Earned Benefits</span>
              <h3>Comp-Off Status</h3>
              <p>
                Shows available, claimed, used, and expired comp-off records with claim
                window and linked leave request.
              </p>
            </div>
          </div>

          <Table rows={compOffRows} maxColumns={8} />
        </div>

        <div className="panel as-section-panel">
          <div className="toolbar">
            <div>
              <span className="as-section-kicker">Recent Activity</span>
              <h3>Recent Notifications</h3>
              <p>Shows recent notifications related to your requests.</p>
            </div>
          </div>

          <Table rows={notificationRows} maxColumns={8} />
        </div>
      </section>
    </div>
  );
}