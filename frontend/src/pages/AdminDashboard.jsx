import { useEffect, useMemo, useState } from 'react';
import {
  api,
  getInitials,
  getProfilePhotoUrl,
  normalizePeopleList,
  normalizeProjectTeamTree,
} from '../api/client';
import Stat from '../components/Stat';
import Table from '../components/Table';
import AttendanceWidget from '../components/AttendanceWidget';

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

function modeLabel(mode) {
  if (mode === 'wfh') return 'Work From Home';
  if (mode === 'field') return 'Field';
  if (mode === 'office') return 'Office';
  return mode || 'Office';
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

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function boolLabel(value) {
  return ['true', 'yes', '1', 'on'].includes(String(value || '').toLowerCase())
    ? 'Yes'
    : 'No';
}

function leaveLiveStatus(row = {}) {
  if (row.live_status || row.status_text || row.status_display) {
    return row.live_status || row.status_text || row.status_display;
  }

  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved' || stage === 'approved') return 'Approved';
  if (status === 'rejected' || stage === 'rejected') return 'Rejected';
  if (stage === 'team_leader') return 'Pending with Team Leader';
  if (stage === 'reporting_officer') return 'Pending with Reporting Officer';
  if (stage === 'hr') return 'Pending with HR';

  return row.approval_stage_label || statusLabel(row.status);
}

function modeRequestLiveStatus(row = {}) {
  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (stage === 'team_leader') return 'Pending with Team Leader';
  if (stage === 'reporting_officer') return 'Pending with Reporting Officer';
  if (stage === 'hr') return 'Pending with HR';

  return row.approval_stage_label || statusLabel(row.status);
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function percentValue(value) {
  const parsed = numberValue(value, 0);
  return Math.max(0, Math.min(parsed, 100));
}

function projectName(row = {}) {
  return (
    row.name ||
    row.project_name ||
    row.title ||
    row.project ||
    row._id ||
    'Unnamed Project'
  );
}

function personName(person = {}) {
  return (
    person.employee_name ||
    person.name ||
    person.display_name ||
    person.full_name ||
    person.email ||
    'Employee'
  );
}

function getPersonId(person = {}) {
  return person.employee_id || person._id || person.id || person.user_id || person.email || personName(person);
}

function normalizePeople(value = []) {
  return normalizePeopleList(Array.isArray(value) ? value : []);
}

function getProjectTree(project = {}) {
  return normalizeProjectTeamTree(project.project_team_tree || {});
}

function getProjectDoingPeople(project = {}) {
  const tree = getProjectTree(project);
  const direct = normalizePeople(project.doing_people || []);

  if (direct.length) return direct;
  if (tree.doing_people?.length) return tree.doing_people;

  return normalizePeople(project.assigned_members || []);
}

function getProjectAssignedMembers(project = {}) {
  const tree = getProjectTree(project);
  const direct = normalizePeople(project.assigned_members || []);

  if (direct.length) return direct;

  return tree.assigned_members || [];
}

function getProjectCollaborators(project = {}) {
  const tree = getProjectTree(project);
  const direct = normalizePeople(project.collaborators || []);

  if (direct.length) return direct;

  return tree.collaborators || [];
}

function getProjectTeamLeader(project = {}) {
  const tree = getProjectTree(project);

  return tree.team_leader || project.team_leader || {};
}

function getProjectReportingOfficer(project = {}) {
  const tree = getProjectTree(project);

  return tree.reporting_officer || project.reporting_officer || {};
}

function peopleNames(people = []) {
  const names = normalizePeople(people)
    .map((person) => personName(person))
    .filter(Boolean);

  return names.length ? names.join(', ') : '—';
}

function PersonAvatar({ person = {}, size = 'sm' }) {
  const photoUrl = getProfilePhotoUrl(person);
  const name = personName(person);

  return (
    <span className={`admin-avatar admin-avatar-${size}`}>
      {photoUrl ? (
        <img src={photoUrl} alt={name} />
      ) : (
        <b>{getInitials(name)}</b>
      )}
    </span>
  );
}

function PeopleStack({ people = [], limit = 5 }) {
  const list = normalizePeople(people).slice(0, limit);
  const remaining = Math.max(0, normalizePeople(people).length - limit);

  if (!list.length) {
    return <span className="admin-team-empty">No members</span>;
  }

  return (
    <div className="admin-avatar-stack">
      {list.map((person, index) => (
        <span
          key={`${getPersonId(person)}-${index}`}
          title={personName(person)}
          className="admin-avatar-stack-item"
        >
          <PersonAvatar person={person} size="xs" />
        </span>
      ))}

      {remaining > 0 && <span className="admin-avatar-more">+{remaining}</span>}
    </div>
  );
}

function PersonMiniCard({ person = {}, relation = 'Member' }) {
  return (
    <div className="admin-person-mini">
      <PersonAvatar person={person} size="sm" />

      <div>
        <strong>{personName(person)}</strong>
        <span>{relation}</span>
        <small>
          {person.department || 'No department'}
          {person.designation ? ` • ${person.designation}` : ''}
        </small>
      </div>
    </div>
  );
}

function EmptyGraph({ message = 'No graph data available yet.' }) {
  return <div className="empty">{message}</div>;
}

function ProjectMetricCard({ label, value, meta, variant = 'indigo' }) {
  return (
    <div className={`admin-project-metric ${variant}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function ProjectProgressRing({ value = 0, label = 'Average Progress' }) {
  const progress = percentValue(value);

  return (
    <div className="admin-project-ring" style={{ '--ringValue': `${progress}%` }}>
      <div className="admin-project-ring-inner">
        <strong>{progress}%</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function ModernGraphBar({ label, value, max = 100, meta, progressValue, variant = 'indigo' }) {
  const numericValue = numberValue(value, 0);
  const denominator = Math.max(numberValue(max, 100), 1);
  const width = progressValue !== undefined
    ? percentValue(progressValue)
    : Math.max(4, Math.min((numericValue / denominator) * 100, 100));

  return (
    <div className={`admin-modern-bar ${variant}`}>
      <div className="admin-modern-bar-head">
        <span>{label}</span>
        <strong>{progressValue !== undefined ? `${percentValue(progressValue)}%` : numericValue}</strong>
      </div>

      <div className="admin-modern-track">
        <div className="admin-modern-fill" style={{ width: `${Math.max(width, 4)}%` }} />
      </div>

      {meta && <small>{meta}</small>}
    </div>
  );
}

function ProjectStatusDonut({ rows = [] }) {
  const total = rows.reduce((sum, row) => sum + numberValue(row.count || row.total || row.total_projects, 0), 0);
  const active = rows.find((row) => String(row.status || row.label || '').toLowerCase().includes('active'))?.count || 0;
  const completed = rows.find((row) => String(row.status || row.label || '').toLowerCase().includes('completed'))?.count || 0;
  const onHold = rows.find((row) => String(row.status || row.label || '').toLowerCase().includes('hold'))?.count || 0;

  const activePct = total ? (numberValue(active, 0) / total) * 100 : 0;
  const completedPct = total ? (numberValue(completed, 0) / total) * 100 : 0;
  const onHoldPct = total ? (numberValue(onHold, 0) / total) * 100 : 0;

  return (
    <div className="admin-status-donut-card">
      <div
        className="admin-status-donut"
        style={{
          '--active': `${activePct}%`,
          '--completed': `${activePct + completedPct}%`,
          '--hold': `${activePct + completedPct + onHoldPct}%`,
        }}
      >
        <div>
          <strong>{total}</strong>
          <span>Projects</span>
        </div>
      </div>

      <div className="admin-status-legend">
        {rows.map((row) => (
          <div key={row.status || row.label}>
            <span />
            <strong>{statusLabel(row.status || row.label)}</strong>
            <em>{row.count || row.total || row.total_projects || 0}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankingCard({ index, title, subtitle, value, meta, project }) {
  const progress = percentValue(value);
  const doingPeople = getProjectDoingPeople(project || {});
  const collaborators = getProjectCollaborators(project || {});
  const teamLeader = getProjectTeamLeader(project || {});
  const reportingOfficer = getProjectReportingOfficer(project || {});

  return (
    <div className="admin-rank-card admin-rank-card-rich">
      <div className="admin-rank-number">{index + 1}</div>

      <div className="admin-rank-main">
        <strong>{title}</strong>
        <span>{subtitle}</span>

        <div className="admin-rank-track">
          <div style={{ width: `${Math.max(progress, 4)}%` }} />
        </div>

        {meta && <small>{meta}</small>}

        <div className="admin-rank-people">
          <div>
            <em>RO</em>
            {reportingOfficer?.employee_name || reportingOfficer?.name ? (
              <PersonMiniCard person={reportingOfficer} relation="Reporting Officer" />
            ) : (
              <small>Not mapped</small>
            )}
          </div>

          <div>
            <em>TL</em>
            {teamLeader?.employee_name || teamLeader?.name ? (
              <PersonMiniCard person={teamLeader} relation="Team Leader" />
            ) : (
              <small>Not mapped</small>
            )}
          </div>

          <div>
            <em>Doing</em>
            <PeopleStack people={doingPeople} />
          </div>

          <div>
            <em>Collaborators</em>
            <PeopleStack people={collaborators} />
          </div>
        </div>
      </div>

      <div className="admin-rank-score">{progress}%</div>
    </div>
  );
}

function DailyTrendCard({ rows = [] }) {
  const maxUpdates = Math.max(1, ...rows.map((row) => numberValue(row.updates, 0)));

  if (!rows.length) {
    return <EmptyGraph message="No recent project progress updates available yet." />;
  }

  return (
    <div className="admin-daily-trend">
      {rows.slice(-10).map((row) => {
        const updates = numberValue(row.updates, 0);
        const height = Math.max(12, (updates / maxUpdates) * 100);

        return (
          <div className="admin-daily-column" key={row.date}>
            <div className="admin-daily-column-bar">
              <span style={{ height: `${height}%` }} />
            </div>
            <strong>{updates}</strong>
            <small>{String(row.date || '').slice(5) || '—'}</small>
          </div>
        );
      })}
    </div>
  );
}

function ProjectTeamRootCard({ project }) {
  const tree = getProjectTree(project);
  const reportingOfficer = tree.reporting_officer || getProjectReportingOfficer(project);
  const teamLeader = tree.team_leader || getProjectTeamLeader(project);
  const assignedMembers = tree.assigned_members || getProjectAssignedMembers(project);
  const collaborators = tree.collaborators || getProjectCollaborators(project);
  const allPeople = tree.all_people || [];

  return (
    <div className="admin-root-card">
      <div className="admin-root-card-head">
        <div>
          <span>Project Team Root</span>
          <strong>{projectName(project)}</strong>
          <small>{project.department || 'No department'} • {statusLabel(project.status)}</small>
        </div>

        <div className="admin-root-progress">
          <b>{percentValue(project.latest_progress ?? project.average_progress ?? project.progress_percent ?? project.progress)}%</b>
          <small>Progress</small>
        </div>
      </div>

      <div className="admin-root-map">
        <div className="admin-root-node admin-root-ro">
          {reportingOfficer?.employee_name || reportingOfficer?.name ? (
            <PersonMiniCard person={reportingOfficer} relation="Reporting Officer" />
          ) : (
            <div className="admin-empty-node">No Reporting Officer</div>
          )}
        </div>

        <div className="admin-root-line" />

        <div className="admin-root-node admin-root-tl">
          {teamLeader?.employee_name || teamLeader?.name ? (
            <PersonMiniCard person={teamLeader} relation="Team Leader" />
          ) : (
            <div className="admin-empty-node">No Team Leader</div>
          )}
        </div>

        <div className="admin-root-branches">
          <div className="admin-root-branch">
            <div className="admin-root-branch-title">
              <span>Doing Project</span>
              <strong>{assignedMembers.length}</strong>
            </div>

            <div className="admin-root-people">
              {assignedMembers.map((person, index) => (
                <PersonMiniCard
                  key={`${getPersonId(person)}-${index}`}
                  person={person}
                  relation="Doing Project"
                />
              ))}

              {!assignedMembers.length && <div className="admin-empty-node">No assigned members</div>}
            </div>
          </div>

          <div className="admin-root-branch">
            <div className="admin-root-branch-title collaborator">
              <span>Collaborators</span>
              <strong>{collaborators.length}</strong>
            </div>

            <div className="admin-root-people">
              {collaborators.map((person, index) => (
                <PersonMiniCard
                  key={`${getPersonId(person)}-${index}`}
                  person={person}
                  relation="Collaborator"
                />
              ))}

              {!collaborators.length && <div className="admin-empty-node">No collaborators</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="admin-root-footer">
        <span>Total connected people</span>
        <PeopleStack people={allPeople} limit={8} />
      </div>
    </div>
  );
}

export default function AdminDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [decisionSavingId, setDecisionSavingId] = useState('');

  async function loadDashboard() {
    try {
      setLoading(true);
      setMessage('');

      const dashboardData = await api('/dashboard/admin');
      setData(dashboardData);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Unable to load admin dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  function goTo(page) {
    if (typeof setPage === 'function') {
      setPage(page);
    }
  }

  async function decideLeave(row, status) {
    const requestId = row?._id;

    if (!requestId) {
      setMessage('Leave request id not found');
      return;
    }

    const ok = window.confirm(`${statusLabel(status)} this leave request?`);

    if (!ok) return;

    try {
      setMessage('');
      setDecisionSavingId(requestId);

      const res = await api(`/leave_requests/${requestId}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      setMessage(res.message || `Leave ${status}`);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'Unable to update leave request');
    } finally {
      setDecisionSavingId('');
    }
  }

  async function decideModeRequest(row, status) {
    const requestId = row?._id;

    if (!requestId) {
      setMessage('WFH / Field request id not found');
      return;
    }

    const ok = window.confirm(`${statusLabel(status)} this WFH / Field request?`);

    if (!ok) return;

    try {
      setMessage('');
      setDecisionSavingId(requestId);

      const res = await api(`/attendance/mode-requests/${requestId}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      setMessage(res.message || `Request ${status}`);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'Unable to update WFH / Field request');
    } finally {
      setDecisionSavingId('');
    }
  }

    const stats = data?.stats || {};
    const employeeSummary = data?.employee_summary || null;

    const adminDisplayName =
      employeeSummary?.name ||
      employeeSummary?.employee_name ||
      employeeSummary?.email ||
      'SDS Admin';

    const adminDesignation =
      employeeSummary?.designation ||
      'Administrator';

    const adminDepartment =
      employeeSummary?.department ||
      'Administration';

    const myPendingLeaves = data?.my_pending_leave_approvals || [];
  const myPendingModeRequests = data?.my_pending_attendance_mode_requests || [];
  const teamScopeCount = data?.team_scope_employee_ids?.length || 0;
  const pendingLeaveRequests = data?.pending?.leave_requests || [];

  const projectAnalytics = data?.project_analytics || {};
  const projectSummary = projectAnalytics?.summary || {};

  const departmentProjectPerformance =
    data?.department_project_performance ||
    projectAnalytics?.department_performance ||
    [];

  const topPerformingDepartments =
    data?.top_performing_departments ||
    projectAnalytics?.top_performing_departments ||
    [];

  const projectDailyProgressChart =
    data?.project_daily_progress_chart ||
    projectAnalytics?.daily_progress_chart ||
    [];

  const projectWisePerformance =
    data?.project_wise_performance ||
    projectAnalytics?.project_wise_performance ||
    projectAnalytics?.project_performance ||
    projectAnalytics?.active_projects ||
    [];

  const projectStatusChart =
    data?.project_status_chart ||
    projectAnalytics?.project_status_chart ||
    [];

  const teamLeaderProjectPerformance =
    data?.team_leader_project_performance ||
    projectAnalytics?.team_leader_performance ||
    [];

  const projectRootCards = projectWisePerformance
    .filter((project) => getProjectDoingPeople(project).length || getProjectCollaborators(project).length || getProjectTeamLeader(project)?.name || getProjectReportingOfficer(project)?.name)
    .slice(0, 4);

  const leaveSummary = useMemo(() => {
    const pendingWithTeamLeader = pendingLeaveRequests.filter(
      (row) => String(row.approval_stage || '').toLowerCase() === 'team_leader',
    ).length;

    const pendingWithReportingOfficer = pendingLeaveRequests.filter(
      (row) => String(row.approval_stage || '').toLowerCase() === 'reporting_officer',
    ).length;

    const pendingWithHr = pendingLeaveRequests.filter(
      (row) => String(row.approval_stage || '').toLowerCase() === 'hr',
    ).length;

    return {
      pendingWithTeamLeader,
      pendingWithReportingOfficer,
      pendingWithHr,
      assignedToMe: myPendingLeaves.length,
    };
  }, [pendingLeaveRequests, myPendingLeaves]);

  const projectStatusFallback = useMemo(() => {
    if (projectStatusChart.length) {
      return projectStatusChart;
    }

    return [
      {
        status: 'Active',
        count: projectSummary.active_projects || stats['Active Projects'] || 0,
      },
      {
        status: 'On Hold',
        count: projectSummary.on_hold_projects || stats['On Hold Projects'] || 0,
      },
      {
        status: 'Completed',
        count: projectSummary.completed_projects || stats['Completed Projects'] || 0,
      },
    ].filter((row) => Number(row.count || 0) > 0);
  }, [projectStatusChart, projectSummary, stats]);

  const maxDepartmentProjects = useMemo(() => {
    return Math.max(
      1,
      ...departmentProjectPerformance.map((row) =>
        numberValue(row.total_projects || row.projects || row.count, 0),
      ),
    );
  }, [departmentProjectPerformance]);

  const projectTotal = projectSummary.total_projects || stats['Total Projects'] || 0;
  const projectActive = projectSummary.active_projects || stats['Active Projects'] || 0;
  const projectOnHold = projectSummary.on_hold_projects || stats['On Hold Projects'] || 0;
  const projectCompleted = projectSummary.completed_projects || stats['Completed Projects'] || 0;
  const projectAverageProgress = projectSummary.average_progress || stats['Average Project Progress'] || 0;

  const statItems = [
    ['Total Employees', stats['Total Employees'] || 0],
    ['Total Projects', projectTotal],
    ['Active Projects', projectActive],
    ['Completed Projects', projectCompleted],
    ['Avg Project Progress', `${projectAverageProgress}%`],
    ['Present Today', stats['Present Today'] || 0],
    ['Late Today', stats['Late Today'] || 0],
    ['Early Checkout Today', stats['Early Checkout Today'] || 0],
    ['Holiday Work Today', stats['Holiday Work Today'] || 0],
    ['WFH Today', stats['WFH Today'] || 0],
    ['Field Today', stats['Field Today'] || 0],
    ['Absent Today', stats['Absent Today'] || 0],
    ['Pending Leaves', stats['Pending Leaves'] || 0],
    ['Pending TL Leaves', leaveSummary.pendingWithTeamLeader],
    ['Pending RO Leaves', leaveSummary.pendingWithReportingOfficer],
    ['Pending HR Leaves', leaveSummary.pendingWithHr],
    ['Pending WFH/Field', stats['Pending WFH/Field'] || 0],
    ['Available Comp-Off', stats['Available Comp-Off'] || 0],
    ['Open Tickets', stats['Open Tickets'] || 0],
    ['Pending Expenses', stats['Pending Expenses'] || 0],
    ['Candidates', stats.Candidates || 0],
    ['Assets Assigned', stats['Assets Assigned'] || 0],
    ['Departments', stats.Departments || 0],
    ['Designations', stats.Designations || 0],
  ];

  const mappedCapabilityStats = employeeSummary
    ? [
        ['My Mapped Employees', teamScopeCount],
        ['My Leave Approvals', myPendingLeaves.length],
        ['My WFH/Field Approvals', myPendingModeRequests.length],
      ]
    : [];

  const recentAttendanceRows = (data?.recent_attendance || []).map((row) => ({
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    state: row.state || '—',
    date: formatDate(row.date),
    mode: modeLabel(row.mode),
    status: statusLabel(row.status),
    check_in: formatDateTime(row.check_in),
    check_out: formatDateTime(row.check_out),
    late_reason: row.late_reason || '—',
    early_checkout_reason: row.early_checkout_reason || '—',
    verified: row.verified_by_ro ? 'Yes' : 'No',
  }));

  const pendingLeaveRows = pendingLeaveRequests.map((row) => ({
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    from_date: formatDate(row.from_date),
    upto_date: formatDate(row.to_date || row.upto_date),
    leave_days: row.leave_days ?? '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    current_stage: leaveLiveStatus(row),
    reason: row.reason || '—',
    final_status: statusLabel(row.status),
  }));

  const myPendingLeaveRows = myPendingLeaves.map((row) => ({
    action: (
      <div className="row-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => decideLeave(row, 'approved')}
          disabled={decisionSavingId === row._id}
        >
          {decisionSavingId === row._id ? 'Approving...' : 'Approve'}
        </button>

        <button
          type="button"
          className="danger"
          onClick={() => decideLeave(row, 'rejected')}
          disabled={decisionSavingId === row._id}
        >
          {decisionSavingId === row._id ? 'Rejecting...' : 'Reject'}
        </button>
      </div>
    ),
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    from_date: formatDate(row.from_date),
    upto_date: formatDate(row.to_date || row.upto_date),
    leave_days: row.leave_days ?? '—',
    task_handover_to: row.task_handover_to_name || '—',
    project_handover: row.project_handover_name || '—',
    current_stage: leaveLiveStatus(row),
    final_status: statusLabel(row.status),
  }));

  const pendingModeRows = (data?.pending?.attendance_mode_requests || []).map(
    (row) => ({
      employee_name: row.employee_name || '—',
      department: row.department || '—',
      designation: row.designation || '—',
      mode: modeLabel(row.mode),
      date: formatDate(row.date),
      reason: row.reason || '—',
      field_location: row.field_location || '—',
      current_stage: modeRequestLiveStatus(row),
      status: statusLabel(row.status),
    }),
  );

  const myPendingModeRows = myPendingModeRequests.map((row) => ({
    action: (
      <div className="row-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => decideModeRequest(row, 'approved')}
          disabled={decisionSavingId === row._id}
        >
          {decisionSavingId === row._id ? 'Approving...' : 'Approve'}
        </button>

        <button
          type="button"
          className="danger"
          onClick={() => decideModeRequest(row, 'rejected')}
          disabled={decisionSavingId === row._id}
        >
          {decisionSavingId === row._id ? 'Rejecting...' : 'Reject'}
        </button>
      </div>
    ),
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    mode: modeLabel(row.mode),
    date: formatDate(row.date),
    reason: row.reason || '—',
    field_location: row.field_location || '—',
    current_stage: modeRequestLiveStatus(row),
    status: statusLabel(row.status),
  }));

  const recentCompOffRows = (data?.recent_compoffs || []).map((row) => ({
    employee_name: row.employee_name || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    earned_date: formatDate(row.earned_date),
    valid_until: formatDate(row.valid_until),
    claimed_date: formatDate(row.claimed_date),
    holiday: row.holiday_title || '—',
    status: statusLabel(row.status),
  }));

  const holidayRows = (data?.holidays_today || []).map((row) => ({
    state: row.state || '—',
    date: formatDate(row.date),
    title: row.title || '—',
    message: row.message || '—',
    status: statusLabel(row.status),
  }));

  const recentEmployeeRows = (data?.recent_employees || []).map((row) => ({
    name: row.name || '—',
    employee_id: row.employee_id || row.emp_code || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    state: row.state || row.branch || '—',
    is_team_leader: boolLabel(row.is_team_leader),
    is_reporting_officer: boolLabel(row.is_reporting_officer),
    team_leader: row.team_leader_name || '—',
    reporting_officer: row.reporting_officer_name || '—',
    status: row.status || row.employment_status || '—',
  }));

  const departmentRows = (data?.department_summary || []).map((row) => ({
    department: row.department || 'Unassigned',
    employees: row.count || 0,
  }));

  const designationRows = (data?.designation_summary || []).map((row) => ({
    designation: row.designation || 'Unassigned',
    employees: row.count || 0,
  }));

  const pendingExpenseRows = (data?.pending?.expenses || []).map((row) => ({
    employee_name: row.employee_name || '—',
    type: row.type || '—',
    amount: row.amount ?? '—',
    description: row.description || '—',
    status: statusLabel(row.status),
  }));

  const ticketRows = (data?.pending?.tickets || []).map((row) => ({
    title: row.title || '—',
    category: row.category || '—',
    priority: statusLabel(row.priority),
    status: statusLabel(row.status),
  }));

  const projectWiseRows = projectWisePerformance.slice(0, 12).map((row) => ({
    project: projectName(row),
    department: row.department || '—',
    status: statusLabel(row.status),
    progress: `${numberValue(row.latest_progress ?? row.average_progress ?? row.progress ?? row.progress_percent, 0)}%`,
    doing_person: peopleNames(getProjectDoingPeople(row)),
    collaborators: peopleNames(getProjectCollaborators(row)),
    team_leader: row.team_leader_name || personName(getProjectTeamLeader(row)) || '—',
    reporting_officer: row.reporting_officer_name || personName(getProjectReportingOfficer(row)) || '—',
    last_update: formatDate(row.latest_progress_date || row.updated_at || row.created_at),
  }));

  const departmentProjectRows = departmentProjectPerformance.map((row) => ({
    department: row.department || 'Unassigned',
    total_projects: row.total_projects || 0,
    active_projects: row.active_projects || 0,
    on_hold_projects: row.on_hold_projects || 0,
    completed_projects: row.completed_projects || 0,
    completion_rate: `${row.completion_rate || 0}%`,
    average_progress: `${row.average_progress || 0}%`,
    score: row.score || 0,
  }));

  const teamLeaderProjectRows = teamLeaderProjectPerformance.map((row) => ({
    team_leader: row.team_leader_name || 'Unassigned',
    department: row.department || '—',
    total_projects: row.total_projects || 0,
    active_projects: row.active_projects || 0,
    on_hold_projects: row.on_hold_projects || 0,
    completed_projects: row.completed_projects || 0,
    average_progress: `${row.average_progress || 0}%`,
    completion_rate: `${row.completion_rate || 0}%`,
  }));

  return (
    <div className="page-grid admin-dashboard-page">
      <style>{`
        .admin-project-hero {
          position: relative;
          overflow: hidden;
          border: 1px solid var(--line);
          border-radius: 30px;
          padding: 26px;
          background:
            radial-gradient(circle at 8% 0%, rgba(79,70,229,.16), transparent 34%),
            radial-gradient(circle at 92% 6%, rgba(5,150,105,.14), transparent 34%),
            linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          box-shadow: var(--shadow);
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 22px;
          align-items: center;
        }

        .admin-project-hero h2 {
          margin: 0;
          color: var(--ink);
          font-size: clamp(26px, 3vw, 38px);
          letter-spacing: -.05em;
          line-height: 1.04;
        }

        .admin-project-hero p {
          margin: 10px 0 0;
          color: var(--muted);
          line-height: 1.65;
          max-width: 820px;
        }

        .admin-project-metric-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 14px;
        }

        .admin-project-metric {
          position: relative;
          overflow: hidden;
          border: 1px solid var(--line);
          border-radius: 22px;
          background: #fff;
          padding: 16px;
          box-shadow: 0 12px 30px rgba(15,23,42,.06);
        }

        .admin-project-metric::after {
          content: "";
          position: absolute;
          width: 74px;
          height: 74px;
          right: -28px;
          top: -26px;
          border-radius: 999px;
          background: rgba(79,70,229,.12);
        }

        .admin-project-metric.green::after { background: rgba(5,150,105,.13); }
        .admin-project-metric.amber::after { background: rgba(217,119,6,.14); }
        .admin-project-metric.sky::after { background: rgba(2,132,199,.13); }
        .admin-project-metric.rose::after { background: rgba(225,29,72,.11); }

        .admin-project-metric span {
          display: block;
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .admin-project-metric strong {
          display: block;
          margin-top: 8px;
          color: var(--ink);
          font-size: 30px;
          line-height: 1;
        }

        .admin-project-metric small {
          display: block;
          margin-top: 7px;
          color: var(--muted);
          font-weight: 750;
        }

        .admin-project-ring {
          --ringValue: 0%;
          width: 148px;
          height: 148px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: conic-gradient(var(--primary) var(--ringValue), #e2e8f0 0);
          box-shadow: 0 18px 42px rgba(79,70,229,.18);
        }

        .admin-project-ring-inner {
          width: 110px;
          height: 110px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          align-content: center;
          background: #fff;
          border: 1px solid var(--line);
        }

        .admin-project-ring-inner strong {
          color: var(--ink);
          font-size: 28px;
          line-height: 1;
        }

        .admin-project-ring-inner span {
          display: block;
          margin-top: 5px;
          color: var(--muted);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          text-align: center;
        }

        .admin-modern-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
        }

        .admin-modern-panel {
          position: relative;
          overflow: hidden;
          border: 1px solid var(--line);
          border-radius: 26px;
          background:
            radial-gradient(circle at 0 0, rgba(79,70,229,.08), transparent 32%),
            #fff;
          padding: 18px;
          box-shadow: var(--shadow);
        }

        .admin-modern-panel h3 {
          margin: 0;
          color: var(--ink);
        }

        .admin-modern-panel p {
          margin: 5px 0 0;
          color: var(--muted);
          line-height: 1.5;
        }

        .admin-modern-list {
          display: grid;
          gap: 12px;
          margin-top: 16px;
        }

        .admin-modern-bar {
          border: 1px solid var(--line);
          border-radius: 18px;
          background: #f8fafc;
          padding: 13px;
          transition: .2s ease;
        }

        .admin-modern-bar:hover {
          transform: translateY(-2px);
          border-color: var(--primaryRing);
          box-shadow: var(--shadowHover);
        }

        .admin-modern-bar-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          color: var(--ink);
          font-weight: 900;
        }

        .admin-modern-bar-head span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .admin-modern-bar-head strong {
          color: var(--primary);
          white-space: nowrap;
        }

        .admin-modern-track {
          height: 11px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
          margin-top: 10px;
          box-shadow: inset 0 1px 2px rgba(15,23,42,.08);
        }

        .admin-modern-fill {
          height: 100%;
          min-width: 4px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--primary), var(--info), var(--success));
        }

        .admin-modern-bar.green .admin-modern-fill {
          background: linear-gradient(90deg, var(--success), #22c55e);
        }

        .admin-modern-bar.amber .admin-modern-fill {
          background: linear-gradient(90deg, var(--warning), #f59e0b);
        }

        .admin-modern-bar small {
          display: block;
          margin-top: 8px;
          color: var(--muted);
          font-weight: 750;
          font-size: 12px;
          line-height: 1.45;
        }

        .admin-status-donut-card {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 18px;
          align-items: center;
          margin-top: 16px;
        }

        .admin-status-donut {
          --active: 0%;
          --completed: 0%;
          --hold: 0%;
          width: 160px;
          height: 160px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background:
            conic-gradient(
              var(--success) 0 var(--active),
              var(--primary) var(--active) var(--completed),
              var(--warning) var(--completed) var(--hold),
              #e2e8f0 var(--hold) 100%
            );
        }

        .admin-status-donut > div {
          width: 112px;
          height: 112px;
          border-radius: 999px;
          background: #fff;
          display: grid;
          place-items: center;
          align-content: center;
          border: 1px solid var(--line);
        }

        .admin-status-donut strong {
          color: var(--ink);
          font-size: 28px;
          line-height: 1;
        }

        .admin-status-donut span {
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .admin-status-legend {
          display: grid;
          gap: 9px;
        }

        .admin-status-legend div {
          display: grid;
          grid-template-columns: 10px minmax(0, 1fr) auto;
          gap: 9px;
          align-items: center;
          background: #f8fafc;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 10px;
        }

        .admin-status-legend span {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: var(--primary);
        }

        .admin-status-legend div:nth-child(1) span { background: var(--success); }
        .admin-status-legend div:nth-child(2) span { background: var(--warning); }
        .admin-status-legend div:nth-child(3) span { background: var(--primary); }

        .admin-status-legend strong {
          color: var(--ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .admin-status-legend em {
          color: var(--muted);
          font-style: normal;
          font-weight: 900;
        }

        .admin-rank-list {
          display: grid;
          gap: 12px;
          margin-top: 16px;
        }

        .admin-rank-card {
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          border: 1px solid var(--line);
          border-radius: 18px;
          background: #f8fafc;
          padding: 12px;
        }

        .admin-rank-card-rich {
          align-items: flex-start;
        }

        .admin-rank-number {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          color: #fff;
          background: linear-gradient(135deg, var(--primary), var(--info));
          font-weight: 900;
        }

        .admin-rank-main strong {
          display: block;
          color: var(--ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .admin-rank-main span,
        .admin-rank-main small {
          display: block;
          color: var(--muted);
          font-size: 12px;
          margin-top: 3px;
          line-height: 1.4;
        }

        .admin-rank-track {
          height: 9px;
          border-radius: 999px;
          overflow: hidden;
          background: #e2e8f0;
          margin-top: 9px;
        }

        .admin-rank-track div {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--primary), var(--success));
        }

        .admin-rank-score {
          color: var(--primary);
          font-weight: 900;
          font-size: 16px;
        }

        .admin-rank-people {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .admin-rank-people > div {
          min-width: 0;
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 14px;
          padding: 9px;
        }

        .admin-rank-people em {
          display: block;
          margin-bottom: 7px;
          color: var(--muted);
          font-style: normal;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .admin-daily-trend {
          height: 250px;
          display: grid;
          grid-template-columns: repeat(10, minmax(0, 1fr));
          gap: 10px;
          align-items: end;
          margin-top: 16px;
          padding: 14px;
          background: #f8fafc;
          border: 1px solid var(--line);
          border-radius: 18px;
        }

        .admin-daily-column {
          min-width: 0;
          display: grid;
          gap: 6px;
          justify-items: center;
          align-items: end;
        }

        .admin-daily-column-bar {
          height: 150px;
          width: 100%;
          max-width: 28px;
          display: flex;
          align-items: end;
          border-radius: 999px;
          background: #e2e8f0;
          overflow: hidden;
        }

        .admin-daily-column-bar span {
          display: block;
          width: 100%;
          border-radius: 999px;
          background: linear-gradient(180deg, var(--primary), var(--info), var(--success));
        }

        .admin-daily-column strong {
          color: var(--ink);
          font-size: 12px;
        }

        .admin-daily-column small {
          color: var(--muted);
          font-size: 10px;
          font-weight: 900;
        }

        .admin-avatar {
          overflow: hidden;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          color: var(--primary);
          border: 2px solid #fff;
          box-shadow: 0 8px 18px rgba(15,23,42,.10);
          flex: 0 0 auto;
          font-weight: 900;
        }

        .admin-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .admin-avatar-xs {
          width: 28px;
          height: 28px;
          font-size: 10px;
        }

        .admin-avatar-sm {
          width: 38px;
          height: 38px;
          font-size: 12px;
        }

        .admin-avatar-stack {
          display: flex;
          align-items: center;
          min-width: 0;
        }

        .admin-avatar-stack-item {
          margin-left: -7px;
        }

        .admin-avatar-stack-item:first-child {
          margin-left: 0;
        }

        .admin-avatar-more {
          min-width: 28px;
          height: 28px;
          margin-left: -7px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--ink);
          color: #fff;
          border: 2px solid #fff;
          font-size: 10px;
          font-weight: 900;
        }

        .admin-team-empty {
          color: var(--muted);
          font-size: 11px;
          font-weight: 800;
        }

        .admin-person-mini {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 9px;
          align-items: center;
          min-width: 0;
        }

        .admin-person-mini strong {
          display: block;
          color: var(--ink);
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .admin-person-mini span {
          display: block;
          margin-top: 2px;
          color: var(--primary);
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .04em;
        }

        .admin-person-mini small {
          display: block;
          margin-top: 2px;
          color: var(--muted);
          font-size: 10px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .admin-root-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          margin-top: 16px;
        }

        .admin-root-card {
          position: relative;
          overflow: hidden;
          border: 1px solid var(--line);
          border-radius: 24px;
          background:
            radial-gradient(circle at 10% 0%, rgba(79,70,229,.10), transparent 32%),
            radial-gradient(circle at 90% 4%, rgba(5,150,105,.10), transparent 32%),
            #fff;
          padding: 16px;
          box-shadow: 0 14px 36px rgba(15,23,42,.07);
        }

        .admin-root-card-head {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: flex-start;
        }

        .admin-root-card-head span {
          display: block;
          color: var(--primary);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .07em;
        }

        .admin-root-card-head strong {
          display: block;
          margin-top: 5px;
          color: var(--ink);
          font-size: 17px;
        }

        .admin-root-card-head small {
          display: block;
          margin-top: 4px;
          color: var(--muted);
          font-size: 12px;
        }

        .admin-root-progress {
          min-width: 72px;
          height: 72px;
          border-radius: 20px;
          display: grid;
          place-items: center;
          align-content: center;
          background: var(--primarySoft);
          color: var(--primary);
          border: 1px solid var(--primaryRing);
        }

        .admin-root-progress b {
          font-size: 20px;
          line-height: 1;
        }

        .admin-root-progress small {
          margin-top: 3px;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .admin-root-map {
          display: grid;
          gap: 12px;
          margin-top: 15px;
        }

        .admin-root-node {
          max-width: 330px;
          margin: 0 auto;
          width: 100%;
          border: 1px solid var(--line);
          border-radius: 18px;
          background: rgba(255,255,255,.92);
          padding: 11px;
        }

        .admin-root-ro {
          border-color: var(--primaryRing);
        }

        .admin-root-tl {
          border-color: #bbf7d0;
        }

        .admin-root-line {
          width: 2px;
          height: 24px;
          margin: -3px auto;
          background: linear-gradient(var(--primary), var(--success));
          border-radius: 999px;
        }

        .admin-root-branches {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .admin-root-branch {
          border: 1px solid var(--line);
          border-radius: 18px;
          background: #f8fafc;
          padding: 12px;
        }

        .admin-root-branch-title {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          padding: 9px 10px;
          border-radius: 14px;
          background: var(--successSoft);
          color: var(--success);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .05em;
        }

        .admin-root-branch-title.collaborator {
          background: var(--primarySoft);
          color: var(--primary);
        }

        .admin-root-branch-title strong {
          width: 24px;
          height: 24px;
          display: inline-grid;
          place-items: center;
          border-radius: 999px;
          background: #fff;
        }

        .admin-root-people {
          display: grid;
          gap: 9px;
          margin-top: 10px;
        }

        .admin-empty-node {
          border: 1px dashed var(--line2);
          border-radius: 14px;
          padding: 11px;
          background: #fff;
          color: var(--muted);
          text-align: center;
          font-size: 12px;
          font-weight: 800;
        }

        .admin-root-footer {
          margin-top: 13px;
          padding-top: 12px;
          border-top: 1px solid var(--line);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .admin-root-footer span {
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        @media (max-width: 1180px) {
          .admin-project-metric-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .admin-modern-grid,
          .admin-root-grid {
            grid-template-columns: 1fr;
          }

          .admin-rank-people {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .admin-project-hero {
            grid-template-columns: 1fr;
            border-radius: 22px;
            padding: 18px;
          }

          .admin-project-metric-grid {
            grid-template-columns: 1fr;
          }

          .admin-status-donut-card {
            grid-template-columns: 1fr;
          }

          .admin-rank-card {
            grid-template-columns: 34px minmax(0, 1fr);
          }

          .admin-rank-score {
            grid-column: 2;
          }

          .admin-rank-people,
          .admin-root-branches {
            grid-template-columns: 1fr;
          }

          .admin-daily-trend {
            overflow-x: auto;
            grid-template-columns: repeat(10, 42px);
          }

          .admin-root-card-head {
            flex-direction: column;
          }
        }
      `}</style>

        <section className="hero compact">
          <div>
            <span className="kicker">Admin Dashboard</span>

            <h1>Welcome, {adminDisplayName}</h1>

            <p>
              {adminDesignation} • {adminDepartment}
            </p>

            <p>
              Monitor attendance, WFH/Field requests, holidays, leave approvals,
              leave balances, employee mappings, comp-off credits, tickets,
              expenses, projects, department-wise progress and reports from one
              dashboard.
            </p>

          <div className="hero-actions">
            <button type="button" className="primary" onClick={() => goTo('attendance')}>
              Attendance
            </button>

            <button type="button" className="secondary" onClick={() => goTo('projects')}>
              Projects
            </button>

            <button type="button" className="secondary" onClick={() => goTo('leave_requests')}>
              Leave Management
            </button>

            <button type="button" className="secondary" onClick={() => goTo('leave_balances')}>
              Leave Balances
            </button>

            <button type="button" className="secondary" onClick={() => goTo('employees')}>
              Employee Master
            </button>

            <button type="button" className="secondary" onClick={() => goTo('reports')}>
              Reports
            </button>

            <button type="button" className="secondary" onClick={loadDashboard} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </section>

      {message && <div className="inline-message">{message}</div>}

      {loading && (
        <section className="panel">
          <p>Loading dashboard...</p>
        </section>
      )}

      <section className="stats-grid">
        {statItems.map(([label, value]) => (
          <Stat key={label} label={label} value={value} />
        ))}
      </section>

      {employeeSummary && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>My Attendance</h3>
              <p>
                Mark your own daily attendance. This will be tracked with other employee attendance records.
              </p>
            </div>
          </div>

          <AttendanceWidget onSuccess={loadDashboard} />
        </section>
      )}

      {mappedCapabilityStats.length > 0 && (
        <section className="stats-grid">
          {mappedCapabilityStats.map(([label, value]) => (
            <Stat key={label} label={label} value={value} />
          ))}
        </section>
      )}

      <section className="admin-project-hero">
        <div>
          <span className="kicker">SDS Project Analytics</span>
          <h2>Executive Project Performance Graphs</h2>
          <p>
            Track department workload, project progress, status distribution,
            daily progress updates, Team Leader performance, assigned project
            people and collaborator mapping from one modern analytics view.
          </p>
        </div>

        <ProjectProgressRing value={projectAverageProgress} />
      </section>

      <section className="admin-project-metric-grid">
        <ProjectMetricCard label="Total Projects" value={projectTotal} meta="All project records" />
        <ProjectMetricCard label="Active Projects" value={projectActive} meta="Currently running" variant="green" />
        <ProjectMetricCard label="On Hold" value={projectOnHold} meta="Paused workload" variant="amber" />
        <ProjectMetricCard label="Completed" value={projectCompleted} meta="Closed projects" variant="sky" />
        <ProjectMetricCard label="Avg Progress" value={`${projectAverageProgress}%`} meta="Across projects" variant="rose" />
      </section>

      <section className="admin-modern-grid">
        <div className="admin-modern-panel">
          <div className="toolbar">
            <div>
              <h3>Department Workload Graph</h3>
              <p>Total, active, on-hold, completed and average progress by department.</p>
            </div>
          </div>

          {departmentProjectPerformance.length ? (
            <div className="admin-modern-list">
              {departmentProjectPerformance.slice(0, 10).map((row) => (
                <ModernGraphBar
                  key={row.department || 'Unassigned'}
                  label={row.department || 'Unassigned'}
                  value={row.total_projects || 0}
                  max={maxDepartmentProjects}
                  meta={`Active: ${row.active_projects || 0} • On Hold: ${row.on_hold_projects || 0} • Completed: ${row.completed_projects || 0} • Avg: ${row.average_progress || 0}%`}
                />
              ))}
            </div>
          ) : (
            <EmptyGraph message="No department-wise project data available yet." />
          )}
        </div>

        <div className="admin-modern-panel">
          <div className="toolbar">
            <div>
              <h3>Project Status Split</h3>
              <p>Visual distribution of active, on-hold and completed projects.</p>
            </div>
          </div>

          {projectStatusFallback.length ? (
            <ProjectStatusDonut rows={projectStatusFallback} />
          ) : (
            <EmptyGraph message="No project status data available yet." />
          )}
        </div>
      </section>

      <section className="admin-modern-grid">
        <div className="admin-modern-panel">
          <div className="toolbar">
            <div>
              <h3>Project Progress Ranking</h3>
              <p>Top project-wise progress cards with RO, TL, doing people and collaborators.</p>
            </div>
          </div>

          {projectWisePerformance.length ? (
            <div className="admin-rank-list">
              {projectWisePerformance.slice(0, 8).map((row, index) => {
                const progress =
                  row.latest_progress ??
                  row.average_progress ??
                  row.progress_percent ??
                  row.progress ??
                  0;

                return (
                  <RankingCard
                    key={row._id || projectName(row)}
                    index={index}
                    title={projectName(row)}
                    subtitle={`${row.department || 'No Department'} • ${statusLabel(row.status)}`}
                    value={progress}
                    meta={row.latest_progress_by_name ? `Last updated by: ${row.latest_progress_by_name}` : ''}
                    project={row}
                  />
                );
              })}
            </div>
          ) : (
            <EmptyGraph message="No project-wise progress data available yet." />
          )}
        </div>

        <div className="admin-modern-panel">
          <div className="toolbar">
            <div>
              <h3>Daily Progress Trend</h3>
              <p>Recent project update activity across the last progress dates.</p>
            </div>
          </div>

          <DailyTrendCard rows={projectDailyProgressChart} />
        </div>
      </section>

      <section className="admin-modern-grid">
        <div className="admin-modern-panel">
          <div className="toolbar">
            <div>
              <h3>Top Performing Departments</h3>
              <p>Departments ranked by score, completion rate and project progress.</p>
            </div>
          </div>

          {departmentProjectPerformance.length ? (
            <div className="admin-modern-list">
              {departmentProjectPerformance.slice(0, 8).map((row) => (
                <ModernGraphBar
                  key={row.department || 'Unassigned'}
                  label={row.department || 'Unassigned'}
                  value={row.score || row.completion_rate || 0}
                  progressValue={row.completion_rate || row.average_progress || 0}
                  meta={`Score: ${row.score || 0} • Completion: ${row.completion_rate || 0}% • Avg: ${row.average_progress || 0}%`}
                  variant="green"
                />
              ))}
            </div>
          ) : (
            <Table rows={departmentProjectRows.length ? departmentProjectRows : topPerformingDepartments} maxColumns={8} />
          )}
        </div>

        <div className="admin-modern-panel">
          <div className="toolbar">
            <div>
              <h3>Team Leader Performance</h3>
              <p>Project ownership performance by assigned Team Leader.</p>
            </div>
          </div>

          {teamLeaderProjectPerformance.length ? (
            <div className="admin-modern-list">
              {teamLeaderProjectPerformance.slice(0, 8).map((row) => (
                <ModernGraphBar
                  key={row.team_leader_id || row.team_leader_name || 'Unassigned'}
                  label={row.team_leader_name || 'Unassigned'}
                  value={row.total_projects || 0}
                  progressValue={row.completion_rate || row.average_progress || 0}
                  meta={`Projects: ${row.total_projects || 0} • Active: ${row.active_projects || 0} • Completed: ${row.completed_projects || 0} • Avg: ${row.average_progress || 0}%`}
                  variant="amber"
                />
              ))}
            </div>
          ) : (
            <Table rows={teamLeaderProjectRows} maxColumns={8} />
          )}
        </div>
      </section>

      {projectRootCards.length > 0 && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>Project Team Root / Spider View</h3>
              <p>
                Visual mapping of Reporting Officer → Team Leader → doing members
                and collaborators for active project ownership clarity.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('projects')}>
              Open Projects
            </button>
          </div>

          <div className="admin-root-grid">
            {projectRootCards.map((project) => (
              <ProjectTeamRootCard key={project._id || projectName(project)} project={project} />
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Project-wise Performance Details</h3>
            <p>
              Latest project progress, department, doing person, collaborators,
              Reporting Officer and Team Leader mapping in one table.
            </p>
          </div>

          <button type="button" className="secondary" onClick={() => goTo('projects')}>
            Manage Projects
          </button>
        </div>

        <Table rows={projectWiseRows} maxColumns={10} />
      </section>

      {holidayRows.length > 0 && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>Today&apos;s State-wise Holidays</h3>
              <p>
                Holidays configured by HR/Admin for today. Employees from these
                states will see the holiday message on their dashboard and
                attendance page.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('holiday_calendar')}>
              Manage Holidays
            </button>
          </div>

          <Table rows={holidayRows} maxColumns={8} />
        </section>
      )}

      {employeeSummary && (
        <section className="two-col">
          <div className="panel">
            <div className="toolbar">
              <div>
                <h3>My Pending Leave Approvals</h3>
                <p>
                  These requests are pending at your mapped Team Leader or
                  Reporting Officer approval stage. Approval will move the leave
                  to the next stage, and final approval deducts balance.
                </p>
              </div>

              <button type="button" className="secondary" onClick={() => goTo('leave_requests')}>
                Open Leave Management
              </button>
            </div>

            <Table rows={myPendingLeaveRows} maxColumns={11} />
          </div>

          <div className="panel">
            <div className="toolbar">
              <div>
                <h3>My Pending WFH / Field Approvals</h3>
                <p>
                  These are attendance mode requests assigned to you through
                  employee mapping.
                </p>
              </div>

              <button type="button" className="secondary" onClick={() => goTo('attendance_mode_requests')}>
                Review Requests
              </button>
            </div>

            <Table rows={myPendingModeRows} maxColumns={9} />
          </div>
        </section>
      )}

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending Leave Requests</h3>
              <p>
                HR/Admin/Super Admin can view all pending leave requests. Actual
                approval follows Team Leader → Reporting Officer, with HR as
                fallback when no approver mapping exists.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('leave_requests')}>
              Open Leaves
            </button>
          </div>

          <Table rows={pendingLeaveRows} maxColumns={12} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending WFH / Field Requests</h3>
              <p>
                Employees can check in from WFH or Field only after approval.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('attendance_mode_requests')}>
              Review Requests
            </button>
          </div>

          <Table rows={pendingModeRows} maxColumns={9} />
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Recent Attendance</h3>
            <p>
              Latest check-in and check-out records with mode, state, late
              reason and early checkout details.
            </p>
          </div>

          <button type="button" className="secondary" onClick={() => goTo('attendance_logs')}>
            View Logs
          </button>
        </div>

        <Table rows={recentAttendanceRows} maxColumns={10} />
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Recent Comp-Off Credits</h3>
            <p>
              Comp-off is generated when an employee works on a weekly or
              state-wise holiday.
            </p>
          </div>

          <button type="button" className="secondary" onClick={() => goTo('compoff_credits')}>
            View Comp-Off
          </button>
        </div>

        <Table rows={recentCompOffRows} maxColumns={8} />
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending Expenses</h3>
              <p>Expense claims waiting for approval or finance action.</p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('expenses')}>
              Open Expenses
            </button>
          </div>

          <Table rows={pendingExpenseRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Open Tickets</h3>
              <p>Open and in-progress employee tickets.</p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('tickets')}>
              Open Tickets
            </button>
          </div>

          <Table rows={ticketRows} maxColumns={8} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Recent Employees</h3>
              <p>
                Latest active employees with Team Leader and Reporting Officer
                capability mapping.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('employees')}>
              Employee Master
            </button>
          </div>

          <Table rows={recentEmployeeRows} maxColumns={10} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>Department Summary</h3>
              <p>Employee count by department.</p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('departments')}>
              Departments
            </button>
          </div>

          <Table rows={departmentRows} maxColumns={8} />
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Designation Summary</h3>
            <p>Employee count by designation.</p>
          </div>

          <button type="button" className="secondary" onClick={() => goTo('designations')}>
            Designations
          </button>
        </div>

        <Table rows={designationRows} maxColumns={8} />
      </section>
    </div>
  );
}