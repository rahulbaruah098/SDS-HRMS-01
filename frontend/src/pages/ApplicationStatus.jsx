import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  FileText,
  RefreshCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  api,
  getInitials,
  getProfilePhotoUrl,
  normalizeLeaveApprovalList,
} from '../api/client';
import Stat from '../components/Stat';
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

  return value || '—';
}

function modeLabel(value) {
  if (value === 'wfh') return 'Work From Home';
  if (value === 'field') return 'Field';
  if (value === 'office') return 'Office';

  return statusLabel(value);
}

function liveStatus(row = {}) {
  if (row.live_status || row.status_text || row.status_display) {
    return row.live_status || row.status_text || row.status_display;
  }

  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved' || stage === 'approved') {
    if (row.approved_by_reporting_officer_name) {
      return `Approved by Reporting Officer ${row.approved_by_reporting_officer_name}`;
    }

    return 'Approved by Reporting Officer';
  }

  if (status === 'rejected' || stage === 'rejected') {
    if (row.rejected_by_role && row.rejected_by_name) {
      return `Rejected by ${statusLabel(row.rejected_by_role)} ${row.rejected_by_name}`;
    }

    return 'Rejected / Cancelled';
  }

  if (stage === 'team_leader') return 'Pending with Team Leader';

  if (stage === 'reporting_officer') {
    if (row.approved_by_team_leader) {
      return 'Approved by Team Leader, Pending with Reporting Officer';
    }

    return 'Pending with Reporting Officer';
  }

  if (stage === 'hr') return 'Pending with HR';

  return row.approval_stage_label || statusLabel(row.status);
}

function stageClass(row = {}) {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved' || stage === 'approved') return 'approved';
  if (status === 'rejected' || stage === 'rejected') return 'rejected';
  if (stage === 'reporting_officer') return 'reporting';
  if (stage === 'team_leader') return 'team';

  return 'pending';
}

function normalizeMainRows(rows = []) {
  return rows.map((row) => ({
    type: row.type || '—',
    title: row.title || '—',
    date: formatDate(row.date),
    live_status: row.live_status || '—',
    status: statusLabel(row.status),
  }));
}

function normalizeLeaveRows(rows = []) {
  return normalizeLeaveApprovalList(rows).map((row) => ({
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    from_date: formatDate(row.from_date),
    upto_date: formatDate(row.to_date || row.upto_date),
    leave_days: row.leave_days ?? '—',
    reason: row.reason || '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    current_stage: liveStatus(row),
    approved_by_team_leader: row.approved_by_team_leader_name || '—',
    approved_by_reporting_officer: row.approved_by_reporting_officer_name || '—',
    hr_record_notified: row.hr_notified ? 'Yes' : 'No',
    final_status: statusLabel(row.status),
    created_at: formatDateTime(row.created_at),
  }));
}

function normalizeAttendanceModeRows(rows = []) {
  return rows.map((row) => ({
    mode: modeLabel(row.mode),
    date: formatDate(row.date),
    reason: row.reason || '—',
    field_location: row.field_location || '—',
    current_stage: liveStatus(row),
    final_status: statusLabel(row.status),
    decided_by: row.decided_by_name || row.approved_by_name || row.rejected_by_name || '—',
    decided_at: formatDateTime(row.decided_at || row.approved_at || row.rejected_at),
  }));
}

function normalizePasswordRows(rows = []) {
  return rows.map((row) => ({
    request_type: 'Password Change',
    reason: row.reason || row.message || '—',
    status: statusLabel(row.status),
    created_at: formatDateTime(row.created_at),
    updated_at: formatDateTime(row.updated_at),
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
    holiday: row.holiday_title || 'Comp-Off',
    earned_date: formatDate(row.earned_date),
    valid_until: formatDate(row.valid_until),
    claimed_date: formatDate(row.claimed_date),
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
        <div className="as-timeline-item" key={`${item.at || index}-${item.name || index}`}>
          <div className="as-timeline-dot" />

          <div>
            <strong>
              {statusLabel(item.action || item.status || item.decision || 'Action')}
              {item.role ? ` by ${statusLabel(item.role)}` : ''}
            </strong>

            <span>
              {item.name || item.approver_name || item.approved_by_name || 'Approver'}
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
            <small>{row.designation || leaveTypeLabel(row.leave_type_label || row.leave_type)}</small>
          </div>
        </div>

        <div className={`as-stage-pill ${stageClass(row)}`}>
          {liveStatus(row)}
        </div>
      </div>

      <div className="as-leave-meta-grid">
        <div>
          <span>Leave Type</span>
          <strong>{leaveTypeLabel(row.leave_type_label || row.leave_type)}</strong>
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
        <div className={row.approved_by_team_leader ? 'done' : ''}>
          <CheckCircle2 size={16} />
          <span>
            Team Leader Approval
            <small>
              {row.approved_by_team_leader
                ? `${row.approved_by_team_leader_name || 'Approved'} • ${formatDateTime(row.approved_by_team_leader_at)}`
                : String(row.approval_stage || '').toLowerCase() === 'team_leader'
                  ? 'Pending with Team Leader'
                  : 'Not completed / skipped'}
            </small>
          </span>
        </div>

        <div className={row.approved_by_reporting_officer ? 'done' : ''}>
          <ShieldCheck size={16} />
          <span>
            Reporting Officer Approval
            <small>
              {row.approved_by_reporting_officer
                ? `${row.approved_by_reporting_officer_name || 'Approved'} • ${formatDateTime(row.approved_by_reporting_officer_at)}`
                : String(row.approval_stage || '').toLowerCase() === 'reporting_officer'
                  ? 'Pending with Reporting Officer'
                  : 'Not completed yet'}
            </small>
          </span>
        </div>

        <div className={row.hr_notified ? 'done' : ''}>
          <FileText size={16} />
          <span>
            HR Record Notification
            <small>
              {row.hr_notified
                ? `HR notified ${formatDateTime(row.hr_notified_at)}`
                : 'HR will be notified after final approval'}
            </small>
          </span>
        </div>
      </div>

      {String(row.status || '').toLowerCase() === 'rejected' && (
        <div className="as-rejected-note">
          <XCircle size={16} />
          <span>
            Rejected by {statusLabel(row.rejected_by_role || '')} {row.rejected_by_name || ''}
            {row.rejected_at ? ` • ${formatDateTime(row.rejected_at)}` : ''}
          </span>
        </div>
      )}

      <Timeline history={row.approval_history || []} />
    </article>
  );
}

export default function ApplicationStatus() {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadStatus() {
    try {
      setLoading(true);
      setMessage('');

      const res = await api('/application_status');
      setData(res);
    } catch (error) {
      setMessage(error.message || 'Unable to load application status');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

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

  const attendanceModeRows = useMemo(
    () => normalizeAttendanceModeRows(data?.attendance_mode_requests || []),
    [data],
  );

  const passwordRows = useMemo(
    () => normalizePasswordRows(data?.password_requests || []),
    [data],
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
    (row) => String(row.status || '').toLowerCase() === 'pending',
  ).length;

  const approvedLeaves = rawLeaveRows.filter(
    (row) => String(row.status || '').toLowerCase() === 'approved',
  ).length;

  const rejectedLeaves = rawLeaveRows.filter(
    (row) => String(row.status || '').toLowerCase() === 'rejected',
  ).length;

  return (
    <div className="page-grid application-status-page">
      <style>{`
        .application-status-page {
          --as-line: #e2e8f0;
          --as-muted: #64748b;
          --as-ink: #0f172a;
          --as-primary: #4f46e5;
          --as-success: #059669;
          --as-warning: #d97706;
          --as-danger: #e11d48;
          --as-info: #0284c7;
        }

        .as-live-grid {
          display: grid;
          gap: 16px;
        }

        .as-leave-card {
          border: 1px solid var(--as-line);
          border-radius: 26px;
          background:
            radial-gradient(circle at 0 0, rgba(79, 70, 229, .06), transparent 32%),
            #ffffff;
          padding: 18px;
          box-shadow: 0 14px 36px rgba(15, 23, 42, .07);
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
          gap: 12px;
          align-items: center;
          min-width: 0;
        }

        .as-avatar {
          width: 58px;
          height: 58px;
          border-radius: 20px;
          overflow: hidden;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          color: var(--as-primary);
          border: 3px solid #ffffff;
          box-shadow: 0 12px 26px rgba(15, 23, 42, .12);
          font-weight: 900;
          flex: 0 0 auto;
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
          color: var(--as-muted);
          margin-top: 3px;
          font-size: 12px;
          font-weight: 750;
        }

        .as-stage-pill {
          border-radius: 999px;
          padding: 9px 13px;
          font-size: 12px;
          font-weight: 900;
          border: 1px solid var(--as-line);
          background: #f8fafc;
          color: var(--as-muted);
        }

        .as-stage-pill.team {
          border-color: rgba(79, 70, 229, .24);
          background: #eef2ff;
          color: var(--as-primary);
        }

        .as-stage-pill.reporting {
          border-color: rgba(2, 132, 199, .24);
          background: #e0f2fe;
          color: var(--as-info);
        }

        .as-stage-pill.approved {
          border-color: rgba(5, 150, 105, .24);
          background: #ecfdf5;
          color: var(--as-success);
        }

        .as-stage-pill.rejected {
          border-color: rgba(225, 29, 72, .24);
          background: #fff1f2;
          color: var(--as-danger);
        }

        .as-leave-meta-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 10px;
          margin-top: 16px;
        }

        .as-leave-meta-grid > div {
          border: 1px solid var(--as-line);
          border-radius: 16px;
          background: #f8fafc;
          padding: 11px;
          min-width: 0;
        }

        .as-leave-meta-grid span,
        .as-reason span {
          display: block;
          color: var(--as-muted);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .as-leave-meta-grid strong {
          display: block;
          margin-top: 6px;
          color: var(--as-ink);
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .as-reason {
          border: 1px solid var(--as-line);
          border-radius: 18px;
          background: #ffffff;
          padding: 13px;
          margin-top: 12px;
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
          margin-top: 12px;
        }

        .as-stage-grid > div {
          border: 1px solid var(--as-line);
          border-radius: 16px;
          background: #f8fafc;
          padding: 11px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 9px;
          align-items: start;
          color: var(--as-muted);
        }

        .as-stage-grid > div.done {
          border-color: rgba(5, 150, 105, .24);
          background: #ecfdf5;
          color: var(--as-success);
        }

        .as-stage-grid span {
          display: block;
          color: var(--as-ink);
          font-weight: 900;
          font-size: 13px;
        }

        .as-stage-grid small {
          display: block;
          margin-top: 3px;
          color: var(--as-muted);
          font-weight: 700;
          line-height: 1.35;
        }

        .as-rejected-note {
          margin-top: 12px;
          border: 1px solid rgba(225, 29, 72, .24);
          background: #fff1f2;
          color: var(--as-danger);
          border-radius: 16px;
          padding: 11px;
          display: flex;
          gap: 9px;
          align-items: center;
          font-weight: 850;
        }

        .as-timeline {
          position: relative;
          display: grid;
          gap: 10px;
          margin-top: 13px;
          padding: 12px;
          border: 1px solid var(--as-line);
          border-radius: 18px;
          background: #f8fafc;
        }

        .as-timeline-item {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
        }

        .as-timeline-dot {
          width: 12px;
          height: 12px;
          border-radius: 999px;
          margin-top: 4px;
          background: linear-gradient(135deg, var(--as-primary), var(--as-success));
          box-shadow: 0 0 0 4px rgba(79, 70, 229, .10);
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
          color: var(--as-muted);
          font-size: 12px;
          line-height: 1.4;
        }

        .as-empty-line {
          margin-top: 13px;
          border: 1px dashed var(--as-line);
          border-radius: 16px;
          padding: 12px;
          color: var(--as-muted);
          background: #f8fafc;
          font-weight: 800;
        }

        .as-empty {
          border: 1px dashed var(--as-line);
          border-radius: 22px;
          padding: 22px;
          color: var(--as-muted);
          background: #ffffff;
          text-align: center;
          font-weight: 800;
        }

        @media (max-width: 1180px) {
          .as-leave-meta-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .as-leave-card {
            border-radius: 22px;
            padding: 14px;
          }

          .as-leave-meta-grid,
          .as-stage-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <section className="hero compact">
        <div>
          <span className="kicker">Live Status</span>

          <h1>Application Status</h1>

          <p>
            Track all your submitted requests in one place, including leave,
            WFH/Field, password change, tickets, and comp-off status.
          </p>
        </div>

        <button
          type="button"
          className="secondary"
          onClick={loadStatus}
          disabled={loading}
        >
          <RefreshCcw size={16} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="stats-grid">
        <Stat label="Total Requests" value={summary.total || 0} />
        <Stat label="Pending / Open" value={summary.pending || 0} />
        <Stat label="Approved / Resolved" value={summary.approved || 0} />
        <Stat label="Rejected / Cancelled" value={summary.rejected || 0} />
      </section>

      <section className="stats-grid">
        <Stat label="Pending Leaves" value={pendingLeaves} />
        <Stat label="Approved Leaves" value={approvedLeaves} />
        <Stat label="Rejected Leaves" value={rejectedLeaves} />
        <Stat label="Leave Records" value={rawLeaveRows.length} />
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
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

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>All Application Status</h3>
            <p>
              This table shows the latest live status across all request types.
            </p>
          </div>
        </div>

        <Table rows={mainRows} maxColumns={8} />
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Leave Requests Table</h3>
            <p>
              Shows whether your leave is pending with Team Leader, approved by
              Team Leader and pending with Reporting Officer, approved by Reporting
              Officer, rejected, or notified to HR.
            </p>
          </div>
        </div>

        <Table rows={leaveRows} maxColumns={12} />
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>WFH / Field Requests</h3>
            <p>
              Shows approval status of Work From Home and Field attendance
              requests.
            </p>
          </div>
        </div>

        <Table rows={attendanceModeRows} maxColumns={10} />
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Password Change Requests</h3>
              <p>Shows password change approval status.</p>
            </div>
          </div>

          <Table rows={passwordRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Tickets / Grievances</h3>
              <p>Shows your raised ticket status.</p>
            </div>
          </div>

          <Table rows={ticketRows} maxColumns={8} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Comp-Off Status</h3>
              <p>Shows available, claimed, and expired comp-off records.</p>
            </div>
          </div>

          <Table rows={compOffRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
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