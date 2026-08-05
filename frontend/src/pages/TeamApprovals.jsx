import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FileText,
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
        <strong>{row.holiday_title || row.holiday_name || 'Holiday Work'}</strong>
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

        {isHolidayWorkRequest(row) && (row.proof_photo || row.field_photo || row.photo) && (
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
  const [loading, setLoading] = useState(false);
  const [loadingTeamField, setLoadingTeamField] = useState(false);
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

async function loadData(nextFilter = filter) {
  try {
      setLoading(true);

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
  } catch (error) {
    alerts.error(error.message || 'Unable to load team approvals.', 'Load Failed');
  } finally {
    setLoading(false);
  }
}

  useEffect(() => {
    loadData(filter);
    loadTeamFieldAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function loadTeamFieldAttendance() {
    try {
      setLoadingTeamField(true);

      const data = await getTeamFieldAttendance({
        limit: 50,
      });

      setTeamFieldRows(data.items || data.logs || data.attendance_logs || []);
    } catch (error) {
      console.warn('Unable to load team field attendance:', error);
      setTeamFieldRows([]);
    } finally {
      setLoadingTeamField(false);
    }
  }


async function approveRequest(row) {
  const requestId = getRequestId(row);

  if (!requestId) {
    alerts.error('Leave request id not found.', 'Missing Request ID');
    return;
  }

  const isHolidayWork = isHolidayWorkRequest(row);

  const ok = await alerts.confirm(
    isHolidayWork
      ? 'Approve this holiday work request?'
      : 'Approve this leave request?',
    {
      title: isHolidayWork ? 'Approve Holiday Work' : 'Approve Leave Request',
      confirmText: 'Yes, Approve',
      cancelText: 'Cancel',
      type: 'warning',
    },
  );

  if (!ok) return;

  try {
    setSavingId(requestId);

    let data;

    if (isHolidayWork) {
      data = await decideHolidayWorkRequest(requestId, {
        status: 'approved',
      });
    } else {
      data = await approveTeamLeaveRequest(requestId);
    }

    const updatedStage = String(data?.item?.approval_stage || '').toLowerCase();
    const updatedStatus = String(data?.item?.status || '').toLowerCase();

    if (updatedStage === 'reporting_officer' && updatedStatus === 'pending') {
      alerts.success(
        data.message ||
          'Approved by Team Leader. The request has now been sent to the Reporting Officer.',
        'Request Forwarded',
      );
    } else {
      alerts.success(
        data.message ||
          (isHolidayWork
            ? 'Holiday work request approved successfully.'
            : 'Leave request approved successfully.'),
        isHolidayWork ? 'Holiday Work Approved' : 'Leave Approved',
      );
    }

    await loadData(filter);
  } catch (error) {
    alerts.error(
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

  if (!requestId) {
    alerts.error('Leave request id not found.', 'Missing Request ID');
    return;
  }

  const isHolidayWork = isHolidayWorkRequest(row);

  const reason = await alerts.prompt(
    isHolidayWork
      ? 'Enter holiday work rejection reason:'
      : 'Enter rejection reason:',
    {
      title: isHolidayWork ? 'Reject Holiday Work' : 'Reject Leave Request',
      confirmText: 'Reject',
      cancelText: 'Cancel',
      placeholder: 'Write rejection reason here...',
      type: 'warning',
    },
  );

  if (reason === null) return;

  try {
    setSavingId(requestId);

    let data;

    if (isHolidayWork) {
      data = await decideHolidayWorkRequest(requestId, {
        status: 'rejected',
        reason: reason || '',
        note: reason || '',
      });
    } else {
      data = await rejectTeamLeaveRequest(requestId, reason || '');
    }

    alerts.success(
      data.message ||
        (isHolidayWork
          ? 'Holiday work request rejected successfully.'
          : 'Leave request rejected successfully.'),
      isHolidayWork ? 'Holiday Work Rejected' : 'Leave Rejected',
    );

    await loadData(filter);
  } catch (error) {
    alerts.error(
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
          --ta-violet: #6658dc;
          --ta-violet-deep: #40348d;
          --ta-blue: #3766db;
          --ta-cyan: #18b5c8;
          --ta-teal: #34c9c4;
          --ta-yellow: #d8ff43;
          --ta-danger: #d84d68;
          --ta-line: rgba(16, 26, 58, .14);
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          color: var(--ta-ink);
        }

        .ta-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: clamp(22px, 3vw, 40px);
          align-items: center;
          min-height: 270px;
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

        .ta-hero::before {
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

        .ta-page-kicker,
        .ta-section-kicker {
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

        .ta-page-kicker {
          margin-bottom: 15px;
          padding: 9px 13px;
          box-shadow: 4px 5px 0 #18b5c8;
        }

        .ta-section-kicker {
          margin-bottom: 10px;
          padding: 7px 10px;
          box-shadow: 3px 4px 0 #18b5c8;
        }

        .ta-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--ta-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(43px, 5.1vw, 76px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .ta-hero h1 em {
          color: var(--ta-violet);
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

        .ta-hero-icon {
          width: 92px;
          height: 92px;
          border-radius: 29px;
          display: grid;
          place-items: center;
          color: #fff;
          background: linear-gradient(145deg, #6658dc, #18b5c8);
          box-shadow:
            7px 8px 0 #c9c0ff,
            0 19px 42px rgba(102, 88, 220, .20);
          animation: taHeroIconFloat 3.4s ease-in-out infinite;
        }

        .ta-role-pill {
          display: inline-flex;
          max-width: 100%;
          margin: 16px 0 0;
          padding: 9px 13px;
          border: 1px solid rgba(102, 88, 220, .20);
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 4px 5px 0 #c9c0ff;
          font-size: 11px;
          font-weight: 900;
          line-height: 1.4;
        }

        .team-approvals-page .hero-actions {
          margin-top: 20px;
        }

        .team-approvals-page .primary,
        .team-approvals-page .secondary,
        .team-approvals-page .danger {
          border-radius: 15px;
          font-weight: 900;
          transition:
            transform 190ms cubic-bezier(.22, 1, .36, 1),
            box-shadow 190ms ease,
            filter 190ms ease;
        }

        .team-approvals-page .primary {
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36, 74, 128, .16);
        }

        .team-approvals-page .secondary {
          border-color: rgba(65, 55, 161, .18);
          color: #40348d;
          background: rgba(255, 255, 255, .90);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
        }

        .team-approvals-page .danger {
          color: #9f2944;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .team-approvals-page .primary:hover,
        .team-approvals-page .secondary:hover,
        .team-approvals-page .danger:hover {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .team-approvals-page .hero-actions .primary svg:first-child {
          animation: taRefreshIdle 4.2s linear infinite;
        }

        .team-approvals-page .hero-actions .primary:disabled svg:first-child {
          animation: taSpin 1s linear infinite;
        }

        .ta-kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 15px;
        }

        .ta-kpi {
          min-height: 126px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow:
            7px 9px 0 #b9d7ff,
            0 18px 30px rgba(34, 38, 110, .09);
          transition:
            transform 210ms cubic-bezier(.22, 1, .36, 1),
            box-shadow 210ms ease;
        }

        .ta-kpi:nth-child(2) {
          background: #eaf8f4;
          box-shadow:
            7px 9px 0 #aee6d9,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .ta-kpi:nth-child(3) {
          background: #fff0f2;
          box-shadow:
            7px 9px 0 #f2c2cc,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .ta-kpi:nth-child(4) {
          background: #f1efff;
          box-shadow:
            7px 9px 0 #c9c0ff,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .ta-kpi:hover {
          transform: translateY(-4px);
        }

        .ta-kpi span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .10em;
        }

        .ta-kpi strong {
          display: block;
          margin-top: 9px;
          color: var(--ta-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(32px, 3vw, 46px);
          line-height: 1;
        }

        .ta-kpi small {
          display: block;
          margin-top: 8px;
          color: var(--ta-copy);
          font-weight: 750;
          line-height: 1.4;
        }

        .ta-toolbar,
        .team-approvals-page .panel,
        .ta-card,
        .ta-field-card {
          border: 1px solid rgba(171, 181, 211, .70);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34, 38, 110, .10);
        }

        .ta-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          padding: 15px;
          border-radius: 24px;
        }

        .ta-search {
          min-width: min(430px, 100%);
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 14px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 999px;
          background: rgba(255, 255, 255, .94);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .08);
        }

        .ta-search svg {
          color: var(--ta-violet);
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
          min-height: 42px;
          padding: 10px 14px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 999px;
          color: var(--ta-copy);
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .08);
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 180ms ease,
            box-shadow 180ms ease,
            background 180ms ease;
        }

        .ta-filter button.active {
          border-color: rgba(102, 88, 220, .28);
          color: #fff;
          background: #342b78;
          box-shadow:
            4px 5px 0 #18b5c8,
            0 12px 22px rgba(52, 43, 120, .14);
        }

        .ta-filter button:hover {
          transform: translateY(-2px);
        }

        .team-approvals-page .panel {
          padding: clamp(20px, 2vw, 28px);
          border-radius: clamp(26px, 2.2vw, 36px);
        }

        .team-approvals-page .panel h3,
        .ta-card h3 {
          color: var(--ta-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-weight: 760;
          letter-spacing: -.04em;
        }

        .team-approvals-page .panel p {
          color: var(--ta-copy);
          line-height: 1.6;
        }

        .ta-field-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 15px;
          margin-top: 18px;
        }

        .ta-field-card {
          padding: 15px;
          border-radius: 23px;
          transition:
            transform 210ms cubic-bezier(.22, 1, .36, 1),
            box-shadow 210ms ease;
        }

        .ta-field-card:hover,
        .ta-card:hover {
          border-color: rgba(102, 88, 220, .28);
          transform: translateY(-3px);
          box-shadow:
            10px 12px 0 #c4ccff,
            0 30px 50px rgba(34, 38, 110, .14);
        }

        .ta-field-card h3 {
          margin: 0;
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
          border-radius: 18px;
          background: #f8fafc;
          box-shadow: 4px 5px 0 #b9d7ff;
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
          border: 1px solid rgba(102, 88, 220, .20);
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
          font-size: 12px;
          font-weight: 900;
          text-decoration: none;
        }

        .ta-list {
          display: grid;
          gap: 18px;
        }

        .ta-card {
          padding: clamp(17px, 2vw, 24px);
          border-radius: 27px;
          transition:
            transform 210ms cubic-bezier(.22, 1, .36, 1),
            box-shadow 210ms ease,
            border-color 210ms ease;
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
          border-radius: 20px;
          color: #40348d;
          background: linear-gradient(145deg, #edf6ff, #eaf8f4);
          box-shadow:
            5px 6px 0 #b9d7ff,
            0 13px 26px rgba(34, 38, 110, .12);
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
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .08);
          font-size: 11px;
          font-weight: 900;
        }

        .ta-stage-pill.team {
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .ta-stage-pill.reporting {
          color: #245da8;
          background: #edf6ff;
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .ta-stage-pill.hr {
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .ta-stage-pill.approved {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .ta-stage-pill.rejected {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
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
          border-radius: 16px;
          background: rgba(255, 255, 255, .84);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .07);
        }

        .ta-details-grid > div:nth-child(4n + 1) {
          background: #edf6ff;
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .ta-details-grid > div:nth-child(4n + 2) {
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .ta-details-grid > div:nth-child(4n + 3) {
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .ta-details-grid > div:nth-child(4n + 4) {
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
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
          border-radius: 18px;
          background: linear-gradient(145deg, #f8fbff, #f7f4ff);
          box-shadow: 4px 5px 0 rgba(52, 43, 120, .08);
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
          color: var(--ta-violet);
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
          border-radius: 16px;
          color: var(--ta-copy);
          background: #f8fafc;
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .07);
        }

        .ta-approval-flags > div.done {
          border-color: rgba(52, 201, 196, .36);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
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
          background: linear-gradient(135deg, #6658dc, #34c9c4);
          box-shadow: 0 0 0 4px rgba(102, 88, 220, .10);
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

        .ta-actions button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .ta-closed-note {
          color: var(--ta-copy);
          font-weight: 800;
        }

        .ta-empty {
          padding: 28px;
          border: 1px dashed rgba(102, 88, 220, .34);
          border-radius: 24px;
          color: var(--ta-copy);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          text-align: center;
          font-weight: 800;
          box-shadow: 4px 5px 0 rgba(52, 43, 120, .07);
        }

        @keyframes taHeroIconFloat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-5px) rotate(-3deg); }
        }

        @keyframes taRefreshIdle {
          0%, 84% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes taSpin {
          to { transform: rotate(360deg); }
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

        @media (max-width: 760px) {
          .team-approvals-page {
            gap: 18px;
          }

          .ta-hero {
            grid-template-columns: 1fr;
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow:
              6px 7px 0 #c6d8f7,
              0 18px 30px rgba(34, 38, 110, .10);
          }

          .ta-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .ta-hero-icon {
            width: 68px;
            height: 68px;
            border-radius: 21px;
          }

          .ta-kpis,
          .ta-details-grid,
          .ta-approval-flags,
          .ta-field-grid {
            grid-template-columns: 1fr;
          }

          .ta-kpi,
          .ta-toolbar,
          .team-approvals-page .panel,
          .ta-card,
          .ta-field-card {
            border-radius: 22px;
            box-shadow:
              5px 6px 0 #c4ccff,
              0 17px 28px rgba(34, 38, 110, .09);
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
            padding: 15px;
          }

          .ta-actions {
            justify-content: stretch;
          }

          .ta-actions button {
            width: 100%;
          }

          .team-approvals-page .toolbar {
            align-items: stretch;
          }

          .team-approvals-page .toolbar > button {
            width: 100%;
          }
        }

        @media (max-width: 430px) {
          .ta-hero {
            padding: 16px;
          }

          .ta-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .ta-kpis {
            gap: 12px;
          }

          .ta-kpi {
            min-height: 106px;
            padding: 15px;
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

          .ta-details-grid {
            grid-template-columns: 1fr;
          }

          .ta-role-pill {
            border-radius: 18px;
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
        <div>
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
            {capabilities.isReportingOfficer ? ' • Reporting Officer' : ''}
            {capabilities.isHrAdmin ? ' • HR/Admin Records' : ''}
          </div>

          <div className="hero-actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  loadData(filter);
                  loadTeamFieldAttendance();
                }}
                disabled={loading || loadingTeamField}
              >
                <RefreshCcw size={16} />
                {loading || loadingTeamField ? 'Refreshing...' : 'Refresh'}
                <ArrowUpRight size={15} />
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

      <section className="ta-kpis">
        <div className="ta-kpi">
          <span>Pending</span>
          <strong>{summary.pending ?? summary.pending_leave_requests ?? pendingCount}</strong>
          <small>Waiting for decision</small>
        </div>

        <div className="ta-kpi">
          <span>Approved / Stage Approved</span>
          <strong>{summary.approved ?? approvedCount}</strong>
          <small>Includes leave and holiday work stage approvals</small>
        </div>

        <div className="ta-kpi">
          <span>Rejected</span>
          <strong>{summary.rejected ?? rejectedCount}</strong>
          <small>Rejected/cancelled records</small>
        </div>

        <div className="ta-kpi">
          <span>Total Loaded</span>
          <strong>{summary.total ?? rows.length}</strong>
          <small>Leave + holiday work requests</small>
        </div>
      </section>

      <section className="ta-toolbar">
        <div className="ta-search">
          <Search size={16} />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search employee, leave type, holiday, work location, approver, department, reason..."
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

<section className="panel ta-section-panel">
  <div className="toolbar">
    <div>
      <span className="ta-section-kicker">Field Operations</span>
      <h3>Team Field Attendance</h3>
      <p>
        Shows field check-ins from your mapped team members with visit place,
        submitted photo and location map.
      </p>
    </div>

    <button
      type="button"
      className="secondary"
      onClick={loadTeamFieldAttendance}
      disabled={loadingTeamField}
    >
      {loadingTeamField ? 'Refreshing...' : 'Refresh Field Logs'}
    </button>
  </div>

  {loadingTeamField && (
    <div className="ta-empty">
      <Clock3 size={28} />
      <p>Loading team field attendance...</p>
    </div>
  )}

  {!loadingTeamField && !teamFieldRows.length && (
    <div className="ta-empty">
      <FileText size={28} />
      <p>No field attendance found for your mapped team.</p>
    </div>
  )}

  {!loadingTeamField && !!teamFieldRows.length && (
    <div className="ta-field-grid">
      {teamFieldRows.map((row) => {
        const photoUrl = fieldPhotoUrl(row);
        const mapUrl = fieldMapUrl(row);

        return (
          <article
            key={row._id || row.id || `${row.employee_id}-${row.date}-${row.check_in}`}
            className="ta-field-card"
          >
            <h3>{employeeName(row)}</h3>

            <p>
              {row.employee_code || row.emp_code || 'Employee'} •{' '}
              {row.department || 'Department'} • {formatDate(row.date)}
            </p>

            <p>
              <strong>Place:</strong>{' '}
              {row.field_location || row.work_location || '—'}
            </p>

            <p>
              <strong>Check-in:</strong>{' '}
              {formatDateTime(row.check_in || row.check_in_at)}
            </p>

            {photoUrl ? (
              <div className="ta-field-photo">
                <img src={photoUrl} alt={`${employeeName(row)} field attendance`} />
              </div>
            ) : (
              <div className="ta-empty-line">
                No field photo submitted.
              </div>
            )}

            <div className="ta-field-actions">
              {photoUrl && (
                <a href={photoUrl} target="_blank" rel="noreferrer">
                  Open Photo
                </a>
              )}

              {mapUrl && (
                <a href={mapUrl} target="_blank" rel="noreferrer">
                  Open Location
                </a>
              )}
            </div>
          </article>
        );
      })}
    </div>
  )}
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
            <p>No leave or holiday work approval request found for this filter.</p>
          </div>
        )}
      </section>
    </div>
  );
}