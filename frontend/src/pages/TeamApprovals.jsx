import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  FileText,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  approveTeamLeaveRequest,
  currentUser,
  getInitials,
  getProfilePhotoUrl,
  getTeamApprovals,
  normalizeLeaveApprovalList,
  rejectTeamLeaveRequest,
} from '../api/client';
import {
  getDisplayRole,
  getEmployeeCapabilities,
} from '../data/modules';

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

  return value || 'Leave';
}

function getRequestId(row = {}) {
  return row._id || row.id || row.request_id || row.leave_request_id || '';
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

function RequestCard({ row, onApprove, onReject, savingId, capabilities }) {
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
        <div>
          <span>Leave Type</span>
          <strong>{leaveTypeLabel(row.leave_type_label || row.leave_type)}</strong>
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
          <span>Task Handover</span>
          <strong>{row.task_handover_to_name || '—'}</strong>
        </div>

        <div>
          <span>Project Handover</span>
          <strong>{row.project_handover_name || '—'}</strong>
        </div>
      </div>

      <div className="ta-reason">
        <span>Reason</span>
        <p>{row.reason || 'No reason added.'}</p>
      </div>

      <ApprovalFlags row={row} />

      <Timeline history={row.approval_history || row.approval_timeline || []} />

      <div className="ta-actions">
        {canDecide ? (
          <>
            <button
              type="button"
              className="primary"
              onClick={() => onApprove(row)}
              disabled={isSaving}
            >
              <CheckCircle2 size={16} />
              {isSaving ? 'Approving...' : 'Approve'}
            </button>

            <button
              type="button"
              className="danger"
              onClick={() => onReject(row)}
              disabled={isSaving}
            >
              <XCircle size={16} />
              {isSaving ? 'Rejecting...' : 'Reject'}
            </button>
          </>
        ) : (
          <span className="ta-closed-note">
            {isPending(row)
              ? `This request is pending at ${statusLabel(row.approval_stage)} stage.`
              : `This request is already ${statusLabel(row.status)}.`}
          </span>
        )}
      </div>
    </article>
  );
}

export default function TeamApprovals({ setPage }) {
  const user = currentUser();
  const capabilities = getEmployeeCapabilities(user || {});
  const displayRole = getDisplayRole(user || {});
  const isHrPanel = Boolean(capabilities.isHrAdmin);

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('pending');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');

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

  async function loadData(nextFilter = filter) {
    try {
      setLoading(true);
      setMessage('');

      const data = await getTeamApprovals({
        status: nextFilter === 'all' ? '' : nextFilter,
      });

      const items = normalizeLeaveApprovalList(
        data.items ||
          data.leave_requests ||
          data.pending_leave_approvals ||
          data.my_pending_leave_approvals ||
          [],
      );

      setRows(items);
      setSummary(data.summary || {});
    } catch (error) {
      setMessage(error.message || 'Unable to load team approvals.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function approveRequest(row) {
    const requestId = getRequestId(row);

    if (!requestId) {
      setMessage('Leave request id not found.');
      return;
    }

    const ok = window.confirm('Approve this leave request?');

    if (!ok) return;

    try {
      setSavingId(requestId);
      setMessage('');

      const data = await approveTeamLeaveRequest(requestId);

      const updatedStage = String(data?.item?.approval_stage || '').toLowerCase();
      const updatedStatus = String(data?.item?.status || '').toLowerCase();

      if (updatedStage === 'reporting_officer' && updatedStatus === 'pending') {
        setMessage(
          data.message ||
            'Approved by Team Leader. The request has now been sent to the Reporting Officer.',
        );
      } else {
        setMessage(data.message || 'Leave request approved successfully.');
      }

      await loadData(filter);
    } catch (error) {
      setMessage(error.message || 'Unable to approve leave request.');
    } finally {
      setSavingId('');
    }
  }

  async function rejectRequest(row) {
    const requestId = getRequestId(row);

    if (!requestId) {
      setMessage('Leave request id not found.');
      return;
    }

    const reason = window.prompt('Enter rejection reason:');

    if (reason === null) return;

    try {
      setSavingId(requestId);
      setMessage('');

      const data = await rejectTeamLeaveRequest(requestId, reason || '');

      setMessage(data.message || 'Leave request rejected successfully.');
      await loadData(filter);
    } catch (error) {
      setMessage(error.message || 'Unable to reject leave request.');
    } finally {
      setSavingId('');
    }
  }

  return (
    <div className="page-grid team-approvals-page">
      <style>{`
        .team-approvals-page {
          --ta-line: #e2e8f0;
          --ta-muted: #64748b;
          --ta-ink: #0f172a;
          --ta-primary: #4f46e5;
          --ta-success: #059669;
          --ta-warning: #d97706;
          --ta-danger: #e11d48;
          --ta-info: #0284c7;
        }

        .ta-hero {
          position: relative;
          overflow: hidden;
          border: 1px solid var(--ta-line);
          border-radius: 30px;
          background:
            radial-gradient(circle at 8% 0%, rgba(79, 70, 229, .15), transparent 34%),
            radial-gradient(circle at 92% 4%, rgba(5, 150, 105, .13), transparent 34%),
            #ffffff;
          padding: 26px;
          box-shadow: 0 18px 46px rgba(15, 23, 42, .08);
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: center;
        }

        .ta-hero h1 {
          margin: 0;
          color: var(--ta-ink);
          font-size: clamp(28px, 3vw, 42px);
          letter-spacing: -.05em;
          line-height: 1.05;
        }

        .ta-hero p {
          margin: 10px 0 0;
          color: var(--ta-muted);
          line-height: 1.65;
          max-width: 880px;
        }

        .ta-hero-icon {
          width: 84px;
          height: 84px;
          border-radius: 28px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, var(--ta-primary), var(--ta-info));
          color: #ffffff;
          box-shadow: 0 18px 42px rgba(79, 70, 229, .24);
        }

        .ta-role-pill {
          display: inline-flex;
          margin: 12px 0 0;
          border-radius: 999px;
          padding: 8px 12px;
          background: #eef2ff;
          color: #4338ca;
          font-size: 12px;
          font-weight: 900;
        }

        .ta-kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .ta-kpi {
          border: 1px solid var(--ta-line);
          border-radius: 22px;
          background: #ffffff;
          padding: 16px;
          box-shadow: 0 12px 30px rgba(15, 23, 42, .06);
        }

        .ta-kpi span {
          display: block;
          color: var(--ta-muted);
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .07em;
        }

        .ta-kpi strong {
          display: block;
          margin-top: 8px;
          color: var(--ta-ink);
          font-size: 32px;
          line-height: 1;
        }

        .ta-kpi small {
          display: block;
          margin-top: 7px;
          color: var(--ta-muted);
          font-weight: 750;
        }

        .ta-toolbar {
          border: 1px solid var(--ta-line);
          border-radius: 24px;
          background: #ffffff;
          padding: 14px;
          box-shadow: 0 12px 30px rgba(15, 23, 42, .05);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
        }

        .ta-search {
          min-width: min(420px, 100%);
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid var(--ta-line);
          border-radius: 999px;
          background: #f8fafc;
          padding: 0 14px;
        }

        .ta-search input {
          width: 100%;
          border: 0;
          outline: 0;
          background: transparent;
          padding: 13px 0;
          color: var(--ta-ink);
          font-weight: 700;
        }

        .ta-filter {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .ta-filter button {
          border: 1px solid var(--ta-line);
          border-radius: 999px;
          background: #ffffff;
          color: var(--ta-muted);
          padding: 10px 14px;
          font-weight: 900;
          cursor: pointer;
        }

        .ta-filter button.active {
          border-color: rgba(79, 70, 229, .25);
          background: #eef2ff;
          color: var(--ta-primary);
        }

        .ta-list {
          display: grid;
          gap: 16px;
        }

        .ta-card {
          border: 1px solid var(--ta-line);
          border-radius: 26px;
          background:
            radial-gradient(circle at 0 0, rgba(79, 70, 229, .06), transparent 32%),
            #ffffff;
          padding: 18px;
          box-shadow: 0 14px 36px rgba(15, 23, 42, .07);
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
          gap: 12px;
          align-items: center;
          min-width: 0;
        }

        .ta-avatar {
          width: 58px;
          height: 58px;
          border-radius: 20px;
          overflow: hidden;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          color: var(--ta-primary);
          border: 3px solid #ffffff;
          box-shadow: 0 12px 26px rgba(15, 23, 42, .12);
          font-weight: 900;
          flex: 0 0 auto;
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
          color: var(--ta-muted);
          margin-top: 3px;
          font-size: 12px;
          font-weight: 750;
        }

        .ta-stage-pill {
          border-radius: 999px;
          padding: 9px 13px;
          font-size: 12px;
          font-weight: 900;
          border: 1px solid var(--ta-line);
          background: #f8fafc;
          color: var(--ta-muted);
        }

        .ta-stage-pill.team {
          border-color: rgba(79, 70, 229, .24);
          background: #eef2ff;
          color: var(--ta-primary);
        }

        .ta-stage-pill.reporting {
          border-color: rgba(2, 132, 199, .24);
          background: #e0f2fe;
          color: var(--ta-info);
        }

        .ta-stage-pill.hr {
          border-color: rgba(217, 119, 6, .24);
          background: #fffbeb;
          color: var(--ta-warning);
        }

        .ta-stage-pill.approved {
          border-color: rgba(5, 150, 105, .24);
          background: #ecfdf5;
          color: var(--ta-success);
        }

        .ta-stage-pill.rejected {
          border-color: rgba(225, 29, 72, .24);
          background: #fff1f2;
          color: var(--ta-danger);
        }

        .ta-details-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 10px;
          margin-top: 16px;
        }

        .ta-details-grid > div {
          border: 1px solid var(--ta-line);
          border-radius: 16px;
          background: #f8fafc;
          padding: 11px;
          min-width: 0;
        }

        .ta-details-grid span,
        .ta-reason span {
          display: block;
          color: var(--ta-muted);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .ta-details-grid strong {
          display: block;
          margin-top: 6px;
          color: var(--ta-ink);
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ta-reason {
          border: 1px solid var(--ta-line);
          border-radius: 18px;
          background: #ffffff;
          padding: 13px;
          margin-top: 12px;
        }

        .ta-reason p {
          margin: 7px 0 0;
          color: var(--ta-ink);
          line-height: 1.6;
        }

        .ta-approval-flags {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .ta-approval-flags > div {
          border: 1px solid var(--ta-line);
          border-radius: 16px;
          background: #f8fafc;
          padding: 11px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 9px;
          align-items: start;
          color: var(--ta-muted);
        }

        .ta-approval-flags > div.done {
          border-color: rgba(5, 150, 105, .24);
          background: #ecfdf5;
          color: var(--ta-success);
        }

        .ta-approval-flags span {
          display: block;
          color: var(--ta-ink);
          font-weight: 900;
          font-size: 13px;
        }

        .ta-approval-flags small {
          display: block;
          margin-top: 3px;
          color: var(--ta-muted);
          font-weight: 700;
          line-height: 1.35;
        }

        .ta-timeline {
          position: relative;
          display: grid;
          gap: 10px;
          margin-top: 13px;
          padding: 12px;
          border: 1px solid var(--ta-line);
          border-radius: 18px;
          background: #f8fafc;
        }

        .ta-timeline-item {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
        }

        .ta-timeline-dot {
          width: 12px;
          height: 12px;
          border-radius: 999px;
          margin-top: 4px;
          background: linear-gradient(135deg, var(--ta-primary), var(--ta-success));
          box-shadow: 0 0 0 4px rgba(79, 70, 229, .10);
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
          color: var(--ta-muted);
          font-size: 12px;
          line-height: 1.4;
        }

        .ta-empty-line {
          margin-top: 13px;
          border: 1px dashed var(--ta-line);
          border-radius: 16px;
          padding: 12px;
          color: var(--ta-muted);
          background: #f8fafc;
          font-weight: 800;
        }

        .ta-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 14px;
        }

        .ta-actions button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .ta-closed-note {
          color: var(--ta-muted);
          font-weight: 800;
        }

        .ta-empty {
          border: 1px dashed var(--ta-line);
          border-radius: 24px;
          background: #ffffff;
          padding: 28px;
          text-align: center;
          color: var(--ta-muted);
          font-weight: 800;
        }

        @media (max-width: 1180px) {
          .ta-kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .ta-details-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .ta-hero {
            grid-template-columns: 1fr;
            border-radius: 22px;
            padding: 18px;
          }

          .ta-hero-icon {
            width: 64px;
            height: 64px;
            border-radius: 20px;
          }

          .ta-kpis,
          .ta-details-grid,
          .ta-approval-flags {
            grid-template-columns: 1fr;
          }

          .ta-toolbar {
            align-items: stretch;
          }

          .ta-filter {
            width: 100%;
          }

          .ta-filter button {
            flex: 1;
          }

          .ta-card {
            border-radius: 22px;
            padding: 14px;
          }

          .ta-actions {
            justify-content: stretch;
          }

          .ta-actions button {
            width: 100%;
          }
        }
      `}</style>

      <section className="ta-hero">
        <div>
          <span className="kicker">
            {isHrPanel ? 'HR Leave Records' : 'Team Approvals'}
          </span>

          <h1>
            {isHrPanel ? 'Leave Record & Approval Panel' : 'Leave Approval Inbox'}
          </h1>

          <p>
            {isHrPanel
              ? 'Review final leave records, HR notifications, approval history, and pending HR-stage leave requests. HR/Admin can use this page as the record panel when notifications are received.'
              : 'Review leave requests assigned to you as Team Leader or Reporting Officer. Requests first move to Team Leader, then Reporting Officer. If no Team Leader is mapped, the request directly comes to Reporting Officer.'}
          </p>

          <div className="ta-role-pill">
            Current access: {displayRole}
            {capabilities.isTeamLeader ? ' • Team Leader' : ''}
            {capabilities.isReportingOfficer ? ' • Reporting Officer' : ''}
            {capabilities.isHrAdmin ? ' • HR/Admin Records' : ''}
          </div>

          <div className="hero-actions">
            <button
              type="button"
              className="primary"
              onClick={() => loadData(filter)}
              disabled={loading}
            >
              <RefreshCcw size={16} />
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>

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

        <div className="ta-hero-icon">
          <UserCheck size={36} />
        </div>
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="ta-kpis">
        <div className="ta-kpi">
          <span>Pending</span>
          <strong>{summary.pending ?? summary.pending_leave_requests ?? pendingCount}</strong>
          <small>Waiting for decision</small>
        </div>

        <div className="ta-kpi">
          <span>Approved / Stage Approved</span>
          <strong>{summary.approved ?? approvedCount}</strong>
          <small>Includes Team Leader approved pending RO</small>
        </div>

        <div className="ta-kpi">
          <span>Rejected</span>
          <strong>{summary.rejected ?? rejectedCount}</strong>
          <small>Rejected/cancelled records</small>
        </div>

        <div className="ta-kpi">
          <span>Total Loaded</span>
          <strong>{summary.total ?? rows.length}</strong>
          <small>Based on selected filter</small>
        </div>
      </section>

      <section className="ta-toolbar">
        <div className="ta-search">
          <Search size={16} />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search employee, leave type, approver, department, reason..."
          />
        </div>

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
      </section>

      <section className="ta-list">
        {loading && (
          <div className="ta-empty">
            <Clock3 size={28} />
            <p>Loading approval requests...</p>
          </div>
        )}

        {!loading &&
          filteredRows.map((row) => (
            <RequestCard
              key={getRequestId(row)}
              row={row}
              onApprove={approveRequest}
              onReject={rejectRequest}
              savingId={savingId}
              capabilities={capabilities}
            />
          ))}

        {!loading && !filteredRows.length && (
          <div className="ta-empty">
            <FileText size={28} />
            <p>No leave approval request found for this filter.</p>
          </div>
        )}
      </section>
    </div>
  );
}