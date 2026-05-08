import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { api } from '../api/client';
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

  if (status === 'approved' || stage === 'approved') return 'Approved';
  if (status === 'rejected' || stage === 'rejected') return 'Rejected / Cancelled';
  if (stage === 'team_leader') return 'Pending with Team Leader';
  if (stage === 'reporting_officer') return 'Pending with Reporting Officer';
  if (stage === 'hr') return 'Pending with HR';

  return row.approval_stage_label || statusLabel(row.status);
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
  return rows.map((row) => ({
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    from_date: formatDate(row.from_date),
    upto_date: formatDate(row.to_date || row.upto_date),
    leave_days: row.leave_days ?? '—',
    reason: row.reason || '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    current_stage: liveStatus(row),
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

  return (
    <div className="page-grid application-status-page">
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
            <h3>Leave Requests</h3>
            <p>
              Shows whether your leave is pending with Team Leader, Reporting
              Officer, HR, approved, or rejected/cancelled.
            </p>
          </div>
        </div>

        <Table rows={leaveRows} maxColumns={10} />
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