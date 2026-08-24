import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  RefreshCw,
  Scale,
  Users,
} from 'lucide-react';
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


function notificationBody(row = {}) {
  return row.body || row.message || 'No notification details available.';
}

function notificationIsUnread(row = {}) {
  return row.read !== true && row.status !== 'read';
}

function notificationTargetLabel(row = {}) {
  const scope = String(
    row.target_scope ||
      row.target ||
      row.audience ||
      '',
  ).toLowerCase();

  if (scope === 'all_tenants' || scope === 'global') {
    return 'All Tenants';
  }

  if (scope === 'selected_tenant') {
    return row.target_tenant_name || row.target_tenant_id || 'Selected Tenant';
  }

  if (scope === 'selected_users') {
    return 'Selected Users';
  }

  return row.tenant_name || row.tenant_id || 'Tenant';
}

function notificationPriorityLabel(value = '') {
  return statusLabel(value || 'normal');
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
  const alerts = useCustomAlert();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [decisionSavingId, setDecisionSavingId] = useState('');
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);


  async function loadDashboard() {
    try {
      setLoading(true);

      const dashboardData = await api('/dashboard/admin');
      setData(dashboardData);
    } catch (error) {
      console.error(error);
      alerts.error(error.message || 'Unable to load admin dashboard', 'Dashboard Load Failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboardNotifications() {
    try {
      setNotificationLoading(true);

      const notificationData = await api('/notifications?limit=6');
      setRecentNotifications(notificationData.items || []);
      setNotificationUnreadCount(Number(notificationData.unread_count || 0));
    } catch (error) {
      console.error(error);
      setRecentNotifications([]);
      setNotificationUnreadCount(0);
      alerts.error(error.message || 'Unable to load dashboard notifications', 'Notifications Load Failed');
    } finally {
      setNotificationLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    loadDashboardNotifications();
  }, []);

  function goTo(page) {
    if (typeof setPage === 'function') {
      setPage(page);
    }
  }

  async function decideLeave(row, status) {
    const requestId = row?._id;

    if (!requestId) {
      alerts.warning('Leave request id not found.', 'Invalid Leave Request');
      return;
    }

    const confirmed = await alerts.confirm(
      `${statusLabel(status)} this leave request?`,
      `${statusLabel(status)} Leave Request`,
    );

    if (!confirmed) return;

    try {
      setDecisionSavingId(requestId);

      const res = await api(`/leave_requests/${requestId}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      alerts.success(res.message || `Leave ${status}`, 'Leave Request Updated');
      await loadDashboard();
    } catch (error) {
      alerts.error(error.message || 'Unable to update leave request', 'Leave Update Failed');
    } finally {
      setDecisionSavingId('');
    }
  }

  async function decideModeRequest(row, status) {
    const requestId = row?._id;

    if (!requestId) {
      alerts.warning('WFH / Field request id not found.', 'Invalid Request');
      return;
    }

    const confirmed = await alerts.confirm(
      `${statusLabel(status)} this WFH / Field request?`,
      `${statusLabel(status)} WFH / Field Request`,
    );

    if (!confirmed) return;

    try {
      setDecisionSavingId(requestId);

      const res = await api(`/attendance/mode-requests/${requestId}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      alerts.success(res.message || `Request ${status}`, 'WFH / Field Request Updated');
      await loadDashboard();
    } catch (error) {
      alerts.error(error.message || 'Unable to update WFH / Field request', 'Request Update Failed');
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

    const adminProfilePhotoUrl = getProfilePhotoUrl(employeeSummary || {});

    const adminCapabilityLabels = [
      employeeSummary?.is_team_leader ? 'Team Leader' : '',
      employeeSummary?.is_reporting_officer ? 'Reporting Officer' : '',
      employeeSummary?.has_hr_records_access ? 'HR Records' : '',
    ].filter(Boolean);

    const adminCapabilityText = adminCapabilityLabels.length
      ? adminCapabilityLabels.join(' + ')
      : 'Administrative Access';

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
    ['Unread Notifications', notificationUnreadCount],
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

  const recentNotificationRows = recentNotifications.map((row) => ({
    title: row.title || 'Notification',
    message: notificationBody(row),
    target: notificationTargetLabel(row),
    type: statusLabel(row.notification_type || 'general'),
    priority: notificationPriorityLabel(row.priority),
    status: notificationIsUnread(row) ? 'Unread' : 'Read',
    popup: row.show_popup === false ? 'No' : 'Yes',
    created_by: row.created_by_name || row.sender_name || 'System',
    created_at: formatDateTime(row.created_at),
  }));

  return (
    <div className="page-grid admin-dashboard-page">
      <style>{`
        .admin-dashboard-hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(360px, 460px);
          gap: 22px;
          align-items: stretch;
        }

        .admin-dashboard-hero > .admin-dashboard-identity {
          grid-column: 1;
          min-width: 0;
        }

        .admin-dashboard-hero > .attendance-card,
        .admin-dashboard-hero > .attendance-pro-card {
          grid-column: 2;
          width: 100%;
          min-width: 0;
          align-self: stretch;
        }

        .admin-dashboard-identity-head {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 18px;
          align-items: center;
        }

        .admin-dashboard-avatar {
          width: 94px;
          height: 94px;
          overflow: hidden;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border: 4px solid #ffffff;
          border-radius: 28px;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          box-shadow: 0 18px 42px rgba(15,23,42,.14);
          color: #4338ca;
          font-size: 28px;
          font-weight: 950;
          letter-spacing: -.04em;
        }

        .admin-dashboard-avatar img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .admin-dashboard-name {
          margin: 7px 0 5px;
          color: var(--ink);
          font-size: clamp(34px, 4.2vw, 54px);
          line-height: 1.02;
          letter-spacing: -.045em;
          overflow-wrap: anywhere;
        }

        .admin-dashboard-subtitle {
          margin: 0;
          max-width: 760px;
          color: var(--muted);
          line-height: 1.62;
        }

        .admin-dashboard-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
          margin-top: 20px;
        }

        .admin-dashboard-badge {
          display: inline-flex;
          align-items: center;
          min-height: 34px;
          padding: 7px 12px;
          border: 1px solid rgba(79,70,229,.14);
          border-radius: 999px;
          background: #eef2ff;
          color: #4338ca;
          font-size: 12px;
          font-weight: 900;
        }

        .admin-dashboard-badge.success {
          border-color: rgba(5,150,105,.16);
          background: #ecfdf5;
          color: #047857;
        }

        .admin-dashboard-badge.neutral {
          border-color: rgba(100,116,139,.18);
          background: #f8fafc;
          color: #475569;
        }

        .admin-project-hero {
          position: relative;
          overflow: hidden;
          border: 1px solid var(--line);
          border-radius: 30px;
          padding: 26px;
          background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
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
        background: #fff;
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
         background: #fff;
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

        .admin-notification-summary {
          position: relative;
          overflow: hidden;
          border: 1px solid var(--line);
          border-radius: 28px;
          padding: 20px;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          box-shadow: var(--shadow);
        }

        .admin-notification-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin-top: 16px;
        }

        .admin-notification-card {
          border: 1px solid var(--line);
          border-radius: 20px;
          background: #ffffff;
          padding: 14px;
          box-shadow: 0 12px 30px rgba(15,23,42,.06);
          transition: .18s ease;
        }

        .admin-notification-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadowHover);
        }

        .admin-notification-card.unread {
          border-color: var(--primaryRing);
          background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
        }

        .admin-notification-card strong {
          display: block;
          color: var(--ink);
          font-size: 15px;
          margin-bottom: 7px;
        }

        .admin-notification-card p {
          margin: 0;
          color: var(--muted);
          line-height: 1.5;
          font-size: 13px;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .admin-notification-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 11px;
        }

        .admin-notification-pill {
          border-radius: 999px;
          padding: 6px 9px;
          background: var(--primarySoft);
          color: var(--primary);
          font-size: 11px;
          font-weight: 900;
          text-transform: capitalize;
        }

        .admin-notification-pill.unread {
          background: #dcfce7;
          color: #166534;
        }

        .admin-notification-pill.read {
          background: #f1f5f9;
          color: var(--muted);
        }

        @media (max-width: 1180px) {
          .admin-project-metric-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .admin-modern-grid,
          .admin-root-grid,
          .admin-notification-grid {
            grid-template-columns: 1fr;
          }

          .admin-rank-people {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 1024px) {
          .admin-dashboard-hero {
            grid-template-columns: 1fr;
          }

          .admin-dashboard-hero > .admin-dashboard-identity,
          .admin-dashboard-hero > .attendance-card,
          .admin-dashboard-hero > .attendance-pro-card {
            grid-column: 1;
          }
        }

        @media (max-width: 760px) {
          .admin-dashboard-identity-head {
            grid-template-columns: 1fr;
          }

          .admin-dashboard-avatar {
            width: 78px;
            height: 78px;
            border-radius: 22px;
          }

          .admin-dashboard-name {
            font-size: clamp(31px, 10vw, 43px);
          }

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

        /* YourComate reference-design override layer */
        .admin-dashboard-page {
          --dash-ink: #101a3a;
          --dash-soft: #596483;
          --dash-violet: #6254da;
          --dash-deep: #342b78;
          --dash-blue: #3766db;
          --dash-teal: #18aaa8;
          --dash-sky: #edf8ff;
          --dash-lilac: #f1efff;
          --dash-flat-blue: #b9d7ff;
          --dash-flat-violet: #c9c0ff;
          --dash-flat-teal: #aee6d9;
          --dash-ease: cubic-bezier(.22, 1, .36, 1);

          min-width: 0;
          width: 100%;
          gap: 22px;
          padding-bottom: max(20px, env(safe-area-inset-bottom));
          color: var(--dash-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .admin-dashboard-page *,
        .admin-dashboard-page *::before,
        .admin-dashboard-page *::after {
          box-sizing: border-box;
        }

        .admin-dashboard-page > * {
          min-width: 0;
          animation: adminDashboardEnter 520ms var(--dash-ease) both;
        }

        .admin-dashboard-page > *:nth-child(3) { animation-delay: 40ms; }
        .admin-dashboard-page > *:nth-child(4) { animation-delay: 80ms; }
        .admin-dashboard-page > *:nth-child(5) { animation-delay: 120ms; }
        .admin-dashboard-page > *:nth-child(6) { animation-delay: 160ms; }

        @keyframes adminDashboardEnter {
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

        .admin-dashboard-page .hero.admin-dashboard-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          padding: clamp(22px, 2.8vw, 36px);
          border: 1px solid rgba(171, 181, 211, .72);
          border-radius: clamp(28px, 2.5vw, 40px);
          background: linear-gradient(135deg, #f1fbff 0%, #fffdf8 48%, #f8f2ff 100%);
          box-shadow:
            12px 14px 0 var(--dash-flat-blue),
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .admin-dashboard-page .hero.admin-dashboard-hero::before {
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


        .admin-dashboard-page .kicker {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: var(--dash-deep);
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .admin-dashboard-page .admin-dashboard-name {
          margin: 15px 0 9px;
          color: var(--dash-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(34px, 4.6vw, 68px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.055em;
        }

        .admin-dashboard-page .admin-dashboard-subtitle {
          max-width: 820px;
          color: var(--dash-soft);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .admin-dashboard-page .admin-dashboard-avatar {
          width: clamp(76px, 8vw, 102px);
          height: clamp(76px, 8vw, 102px);
          border: 4px solid #fff;
          border-radius: 28px;
          color: #fff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow:
            6px 8px 0 rgba(98, 84, 218, .18),
            0 18px 34px rgba(34, 38, 110, .14);
        }

        .admin-dashboard-page .admin-dashboard-badge {
          min-height: 34px;
          border-color: rgba(98, 84, 218, .14);
          color: #3657b5;
          background: #e5e9ff;
          box-shadow: 3px 4px 0 rgba(98, 84, 218, .1);
        }

        .admin-dashboard-page .admin-dashboard-badge.success {
          color: #13736f;
          background: #dff8f3;
          border-color: rgba(19, 115, 111, .14);
        }

        .admin-dashboard-page .admin-dashboard-badge.neutral {
          color: #5f6983;
          background: #edf0f6;
          border-color: rgba(95, 105, 131, .14);
        }

        .admin-dashboard-page .attendance-card,
        .admin-dashboard-page .attendance-pro-card {
          border: 1px solid rgba(171, 181, 211, .68) !important;
          border-radius: 24px !important;
          background: rgba(255, 255, 255, .86) !important;
          box-shadow:
            8px 10px 0 var(--dash-flat-violet),
            0 20px 34px rgba(15, 20, 75, .09) !important;
          transition:
            transform 280ms var(--dash-ease),
            box-shadow 280ms var(--dash-ease),
            border-color 220ms ease !important;
        }

        .admin-dashboard-page .attendance-card:hover,
        .admin-dashboard-page .attendance-pro-card:hover {
          transform: translateY(-3px);
          border-color: rgba(98, 84, 218, .3) !important;
          box-shadow:
            11px 13px 0 var(--dash-flat-violet),
            0 26px 42px rgba(15, 20, 75, .12) !important;
        }

        .admin-dashboard-page .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }

        .admin-dashboard-page .stats-grid > * {
          min-width: 0;
          border: 1px solid rgba(171, 181, 211, .68) !important;
          border-radius: 21px !important;
          background: #f8fbff !important;
          box-shadow:
            7px 9px 0 var(--dash-flat-blue),
            0 18px 30px rgba(15, 20, 75, .08) !important;
          transition:
            transform 260ms var(--dash-ease),
            box-shadow 260ms var(--dash-ease),
            border-color 220ms ease !important;
        }

        .admin-dashboard-page .stats-grid > *:nth-child(4n + 2) {
          background: #f1efff !important;
          box-shadow: 7px 9px 0 var(--dash-flat-violet), 0 18px 30px rgba(15,20,75,.08) !important;
        }

        .admin-dashboard-page .stats-grid > *:nth-child(4n + 3) {
          background: #eaf8f4 !important;
          box-shadow: 7px 9px 0 var(--dash-flat-teal), 0 18px 30px rgba(15,20,75,.08) !important;
        }

        .admin-dashboard-page .stats-grid > *:nth-child(4n + 4) {
          background: #fff4d5 !important;
          box-shadow: 7px 9px 0 #ffe0a5, 0 18px 30px rgba(15,20,75,.08) !important;
        }

        .admin-dashboard-page .stats-grid > *:hover {
          transform: translateY(-3px);
          border-color: rgba(98, 84, 218, .28) !important;
        }

        .admin-dashboard-page .panel,
        .admin-dashboard-page .admin-modern-panel,
        .admin-dashboard-page .admin-project-hero,
        .admin-dashboard-page .admin-root-card,
        .admin-dashboard-page .admin-rank-card,
        .admin-dashboard-page .admin-notification-summary,
        .admin-dashboard-page .admin-notification-grid > * {
          min-width: 0;
          border: 1px solid rgba(171, 181, 211, .7) !important;
          border-radius: clamp(22px, 2vw, 30px) !important;
          background:
            linear-gradient(145deg, rgba(255,255,255,.99), rgba(244,249,255,.98)) !important;
          box-shadow:
            9px 11px 0 #d1dcfa,
            0 24px 42px rgba(34, 38, 110, .1) !important;
          transition:
            transform 280ms var(--dash-ease),
            border-color 220ms ease,
            box-shadow 280ms var(--dash-ease),
            background 220ms ease !important;
        }

        .admin-dashboard-page .panel:hover,
        .admin-dashboard-page .admin-modern-panel:hover,
        .admin-dashboard-page .admin-project-hero:hover,
        .admin-dashboard-page .admin-root-card:hover,
        .admin-dashboard-page .admin-rank-card:hover,
        .admin-dashboard-page .admin-notification-grid > *:hover {
          transform: translateY(-3px);
          border-color: rgba(98, 84, 218, .28) !important;
          box-shadow:
            11px 13px 0 #d1dcfa,
            0 28px 46px rgba(34, 38, 110, .13) !important;
        }

        .admin-dashboard-page .admin-modern-panel:nth-child(even),
        .admin-dashboard-page .two-col > .panel:nth-child(even) {
          background: linear-gradient(145deg, #f4fbff 0%, #f8f1ff 56%, #fffaf0 100%) !important;
          box-shadow: 9px 11px 0 #c9ddf5, 0 24px 42px rgba(34,38,110,.1) !important;
        }

        .admin-dashboard-page .toolbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }

        .admin-dashboard-page .toolbar > div {
          min-width: 0;
        }

        .admin-dashboard-page .toolbar h2,
        .admin-dashboard-page .toolbar h3,
        .admin-dashboard-page .panel h2,
        .admin-dashboard-page .panel h3,
        .admin-dashboard-page .admin-project-hero h2,
        .admin-dashboard-page .admin-modern-panel h3 {
          color: var(--dash-ink) !important;
          font-family: var(--yc-display, var(--heading), inherit);
          letter-spacing: -.035em;
        }

        .admin-dashboard-page .toolbar p,
        .admin-dashboard-page .panel p,
        .admin-dashboard-page .admin-project-hero p,
        .admin-dashboard-page .admin-modern-panel p {
          color: var(--dash-soft) !important;
          line-height: 1.6;
        }

        .admin-dashboard-page button,
        .admin-dashboard-page a {
          touch-action: manipulation;
        }

        .admin-dashboard-page button.primary,
        .admin-dashboard-page button.secondary,
        .admin-dashboard-page button.danger,
        .admin-dashboard-page .primary,
        .admin-dashboard-page .secondary {
          border-radius: 14px !important;
          font-weight: 900 !important;
          transition:
            transform 240ms var(--dash-ease),
            box-shadow 240ms var(--dash-ease),
            filter 200ms ease,
            background 200ms ease !important;
        }

        .admin-dashboard-page button.primary,
        .admin-dashboard-page .primary {
          color: #fff !important;
          background: linear-gradient(145deg, #4f72df, #2bb9b5) !important;
          border-color: rgba(52, 43, 120, .16) !important;
          box-shadow: 5px 6px 0 rgba(52, 43, 120, .8) !important;
        }

        .admin-dashboard-page button.secondary,
        .admin-dashboard-page .secondary {
          color: var(--dash-deep) !important;
          background: #f1efff !important;
          border-color: rgba(98, 84, 218, .18) !important;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .14) !important;
        }

        .admin-dashboard-page button.danger,
        .admin-dashboard-page .danger {
          color: #b62f55 !important;
          background: #ffe4ec !important;
          border-color: rgba(182, 47, 85, .16) !important;
        }

        .admin-dashboard-page button:hover:not(:disabled),
        .admin-dashboard-page a:hover {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .admin-dashboard-page button:active:not(:disabled),
        .admin-dashboard-page a:active {
          transform: translateY(0) scale(.985);
        }

        .admin-dashboard-page .admin-project-metric-grid {
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 15px;
        }

        .admin-dashboard-page .admin-project-metric {
          border-color: rgba(171, 181, 211, .68);
          border-radius: 21px;
          background: #f8fbff;
          box-shadow: 7px 9px 0 var(--dash-flat-blue), 0 18px 30px rgba(15,20,75,.08);
          transition: transform 260ms var(--dash-ease), box-shadow 260ms var(--dash-ease);
        }

        .admin-dashboard-page .admin-project-metric:nth-child(2) {
          background: #f1efff;
          box-shadow: 7px 9px 0 var(--dash-flat-violet), 0 18px 30px rgba(15,20,75,.08);
        }

        .admin-dashboard-page .admin-project-metric:nth-child(3) {
          background: #eaf8f4;
          box-shadow: 7px 9px 0 var(--dash-flat-teal), 0 18px 30px rgba(15,20,75,.08);
        }

        .admin-dashboard-page .admin-project-metric:nth-child(4) {
          background: #fff4d5;
          box-shadow: 7px 9px 0 #ffe0a5, 0 18px 30px rgba(15,20,75,.08);
        }

        .admin-dashboard-page .admin-project-metric:hover {
          transform: translateY(-3px);
        }

        .admin-dashboard-page .admin-modern-bar,
        .admin-dashboard-page .admin-status-legend div,
        .admin-dashboard-page .admin-person-mini,
        .admin-dashboard-page .admin-root-branch,
        .admin-dashboard-page .admin-document-row,
        .admin-dashboard-page .admin-notification-meta {
          border-color: rgba(171, 181, 211, .58) !important;
          border-radius: 16px !important;
          background: rgba(255, 255, 255, .76) !important;
          transition:
            transform 220ms var(--dash-ease),
            border-color 180ms ease,
            box-shadow 220ms var(--dash-ease),
            background 180ms ease !important;
        }

        .admin-dashboard-page .admin-modern-bar:hover,
        .admin-dashboard-page .admin-person-mini:hover,
        .admin-dashboard-page .admin-root-branch:hover {
          transform: translateY(-2px);
          border-color: rgba(98, 84, 218, .25) !important;
          box-shadow: 5px 6px 0 rgba(185, 215, 255, .55) !important;
        }

        .admin-dashboard-page .admin-modern-fill,
        .admin-dashboard-page .admin-rank-track div,
        .admin-dashboard-page .admin-daily-column-bar span {
          background: linear-gradient(90deg, var(--dash-violet), var(--dash-blue), var(--dash-teal)) !important;
          transition: width 680ms var(--dash-ease), height 680ms var(--dash-ease);
        }

        .admin-dashboard-page .admin-project-ring {
          background: conic-gradient(var(--dash-violet) var(--ringValue), #e5e9f4 0) !important;
          box-shadow: 0 18px 42px rgba(98, 84, 218, .18) !important;
        }

        .admin-dashboard-page .admin-status-donut {
          box-shadow: 0 18px 42px rgba(98, 84, 218, .14);
        }

        .admin-dashboard-page .admin-avatar,
        .admin-dashboard-page .admin-rank-number {
          background: linear-gradient(145deg, #4f72df, #2bb9b5) !important;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .14) !important;
        }

        .admin-dashboard-page .admin-notification-pill {
          border-radius: 999px;
          font-weight: 900;
        }

        .admin-dashboard-page .admin-daily-trend {
          border-color: rgba(171, 181, 211, .58);
          border-radius: 20px;
          background: linear-gradient(145deg, rgba(237,248,255,.72), rgba(248,241,255,.68));
          overflow-x: auto;
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
        }

        .admin-dashboard-page .two-col,
        .admin-dashboard-page .admin-modern-grid,
        .admin-dashboard-page .admin-root-grid,
        .admin-dashboard-page .admin-notification-grid {
          gap: 20px;
        }

        .admin-dashboard-page table {
          min-width: 0;
        }

        .admin-dashboard-page .table-wrap,
        .admin-dashboard-page .table-scroll,
        .admin-dashboard-page .responsive-table {
          overflow-x: auto;
          overscroll-behavior-x: contain;
          scrollbar-width: thin;
          scrollbar-color: rgba(98, 84, 218, .35) transparent;
          -webkit-overflow-scrolling: touch;
        }

        .admin-dashboard-page .table-wrap::-webkit-scrollbar,
        .admin-dashboard-page .table-scroll::-webkit-scrollbar,
        .admin-dashboard-page .responsive-table::-webkit-scrollbar {
          height: 8px;
        }

        .admin-dashboard-page .table-wrap::-webkit-scrollbar-thumb,
        .admin-dashboard-page .table-scroll::-webkit-scrollbar-thumb,
        .admin-dashboard-page .responsive-table::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(98, 84, 218, .35);
        }

        .admin-dashboard-page .row-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .admin-dashboard-page .empty {
          padding: 30px 22px;
          border: 1px dashed rgba(98, 84, 218, .35);
          border-radius: 20px;
          color: var(--dash-soft);
          background: linear-gradient(145deg, rgba(237,248,255,.76), rgba(248,241,255,.72));
          font-weight: 900;
          text-align: center;
        }

        @media (min-width: 1600px) {
          .admin-dashboard-page {
            gap: 26px;
          }

          .admin-dashboard-page .stats-grid {
            grid-template-columns: repeat(5, minmax(0, 1fr));
          }

          .admin-dashboard-page .admin-project-metric-grid {
            grid-template-columns: repeat(5, minmax(0, 1fr));
          }

          .admin-dashboard-page .two-col,
          .admin-dashboard-page .admin-modern-grid {
            gap: 24px;
          }
        }

        @media (max-width: 1280px) {
          .admin-dashboard-page .admin-dashboard-hero {
            grid-template-columns: minmax(0, 1fr) minmax(320px, 400px);
          }

          .admin-dashboard-page .stats-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .admin-dashboard-page .admin-project-metric-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .admin-dashboard-page .admin-rank-people {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 1024px) {
          .admin-dashboard-page .admin-dashboard-hero {
            grid-template-columns: 1fr;
          }

          .admin-dashboard-page .admin-dashboard-hero > .admin-dashboard-identity,
          .admin-dashboard-page .admin-dashboard-hero > .attendance-card,
          .admin-dashboard-page .admin-dashboard-hero > .attendance-pro-card {
            grid-column: 1;
          }

          .admin-dashboard-page .stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .admin-dashboard-page .admin-project-metric-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .admin-dashboard-page .admin-modern-grid,
          .admin-dashboard-page .two-col,
          .admin-dashboard-page .admin-root-grid,
          .admin-dashboard-page .admin-notification-grid {
            grid-template-columns: 1fr !important;
          }

          .admin-dashboard-page .admin-project-hero {
            grid-template-columns: 1fr;
          }

          .admin-dashboard-page .admin-project-ring {
            justify-self: start;
          }
        }

        @media (max-width: 760px) {
          .admin-dashboard-page {
            gap: 16px;
          }

          .admin-dashboard-page .hero.admin-dashboard-hero {
            padding: 20px;
            border-radius: 24px;
            box-shadow:
              7px 8px 0 var(--dash-flat-blue),
              0 18px 30px rgba(34, 38, 110, .1);
          }

          .admin-dashboard-page .admin-dashboard-identity-head {
            grid-template-columns: 1fr;
            justify-items: start;
          }

          .admin-dashboard-page .admin-dashboard-name {
            font-size: clamp(31px, 9.5vw, 44px);
          }

          .admin-dashboard-page .hero-actions,
          .admin-dashboard-page .toolbar,
          .admin-dashboard-page .admin-project-hero {
            align-items: stretch;
            flex-direction: column;
          }

          .admin-dashboard-page .hero-actions button,
          .admin-dashboard-page .toolbar button {
            width: 100%;
          }

          .admin-dashboard-page .stats-grid,
          .admin-dashboard-page .admin-project-metric-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .admin-dashboard-page .stats-grid > *,
          .admin-dashboard-page .admin-project-metric {
            border-radius: 17px !important;
            box-shadow:
              4px 5px 0 var(--dash-flat-blue),
              0 12px 20px rgba(15, 20, 75, .07) !important;
          }

          .admin-dashboard-page .panel,
          .admin-dashboard-page .admin-modern-panel,
          .admin-dashboard-page .admin-project-hero,
          .admin-dashboard-page .admin-root-card,
          .admin-dashboard-page .admin-rank-card {
            border-radius: 22px !important;
            box-shadow:
              6px 7px 0 #d1dcfa,
              0 16px 28px rgba(34, 38, 110, .08) !important;
          }

          .admin-dashboard-page .admin-status-donut-card {
            grid-template-columns: 1fr;
            justify-items: center;
          }

          .admin-dashboard-page .admin-rank-card {
            grid-template-columns: 38px minmax(0, 1fr);
          }

          .admin-dashboard-page .admin-rank-score {
            grid-column: 1 / -1;
            justify-self: end;
          }

          .admin-dashboard-page .admin-rank-people {
            grid-template-columns: 1fr;
          }

          .admin-dashboard-page .admin-root-map,
          .admin-dashboard-page .admin-root-branches {
            min-width: 0;
          }

          .admin-dashboard-page .admin-daily-trend {
            min-width: 620px;
          }
        }

        @media (max-width: 430px) {
          .admin-dashboard-page .stats-grid,
          .admin-dashboard-page .admin-project-metric-grid {
            grid-template-columns: 1fr;
          }

          .admin-dashboard-page .admin-dashboard-avatar {
            width: 74px;
            height: 74px;
            border-radius: 22px;
          }

          .admin-dashboard-page .admin-dashboard-badges {
            display: grid;
            grid-template-columns: 1fr;
          }

          .admin-dashboard-page .admin-dashboard-badge {
            justify-content: center;
            text-align: center;
          }

          .admin-dashboard-page .row-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .admin-dashboard-page .row-actions button {
            width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .admin-dashboard-page *,
          .admin-dashboard-page *::before,
          .admin-dashboard-page *::after {
            scroll-behavior: auto !important;
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }

        /* ================================================================
           YOURCOMATE EMPLOYEE DASHBOARD HERO
           Visual-only redesign. Existing dashboard actions and workflows
           remain unchanged.
           ================================================================ */

        .employee-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          padding: clamp(22px, 3vw, 38px);
          border-radius: 34px;
          border: 1px solid rgba(99, 102, 241, .15);
         background: linear-gradient(
  145deg,
  rgba(255,255,255,.99),
  rgba(247,248,255,.98)
);
          box-shadow:
            0 24px 70px rgba(46, 48, 112, .10),
            inset 0 1px 0 rgba(255,255,255,.96);
        }


        .employee-identity {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .employee-identity-head {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: clamp(16px, 2vw, 24px);
          min-width: 0;
        }

        .employee-profile-avatar {
          position: relative;
          width: clamp(86px, 8vw, 116px);
          height: clamp(86px, 8vw, 116px);
          border-radius: 30px;
          overflow: hidden;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          background:
            radial-gradient(circle at 30% 18%, rgba(255,255,255,.9), transparent 36%),
            linear-gradient(135deg, #eef2ff, #e7fbf8);
          color: #4338ca;
          font-size: 30px;
          font-weight: 950;
          border: 5px solid rgba(255,255,255,.96);
          box-shadow:
            0 20px 44px rgba(35, 42, 105, .16),
            0 0 0 1px rgba(99, 102, 241, .10);
          animation: employeeAvatarFloat 5.4s ease-in-out infinite;
        }

        .employee-profile-avatar::after {
          content: "";
          position: absolute;
          width: 12px;
          height: 12px;
          right: 4px;
          bottom: 5px;
          border: 3px solid #fff;
          border-radius: 999px;
          background: #20b486;
          box-shadow: 0 4px 12px rgba(32, 180, 134, .30);
        }

        .employee-profile-avatar img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
        }

        .employee-identity-copy {
          min-width: 0;
        }

        .employee-identity-copy .kicker {
          margin-bottom: 10px;
          background: rgba(238, 242, 255, .94);
          color: #5848df;
          border: 1px solid rgba(99, 102, 241, .12);
          box-shadow: 0 8px 20px rgba(79, 70, 229, .07);
        }

        .employee-name-heading.dashboard-display-name {
          width: fit-content;
          max-width: 100%;
          margin: 0;
          overflow: visible;
          color: #111d48;
          text-overflow: clip;
          white-space: nowrap;
          font-family:
            "Segoe Script",
            "Brush Script MT",
            "Lucida Handwriting",
            cursive;
          font-style: normal;
          font-size: clamp(34px, 4.3vw, 68px);
          font-weight: 500;
          line-height: 1.08;
          letter-spacing: -.045em;
          text-shadow: 0 8px 28px rgba(50, 47, 126, .08);
          transform-origin: left center;
        }

        .employee-dashboard-subtitle {
          max-width: 760px;
          margin: 14px 0 0;
          color: #657696;
          font-size: clamp(14px, 1.15vw, 17px);
          line-height: 1.68;
        }

        .employee-quick-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 26px;
        }

        .employee-quick-action {
          --action-accent: #5f52e8;
          --action-soft: rgba(95, 82, 232, .10);
          position: relative;
          isolation: isolate;
          min-width: 0;
          min-height: 78px;
          padding: 12px;
          display: grid;
          grid-template-columns: 44px minmax(0, 1fr) 34px;
          align-items: center;
          gap: 11px;
          overflow: hidden;
          border: 1px solid rgba(99, 102, 241, .13);
          border-radius: 20px;
          color: #172554;
          background: rgba(255,255,255,.88);
          box-shadow:
            0 12px 28px rgba(35, 42, 105, .07),
            inset 0 1px 0 rgba(255,255,255,.96);
          text-align: left;
          transition:
            transform .25s cubic-bezier(.22, 1, .36, 1),
            box-shadow .25s ease,
            border-color .25s ease;
        }

       

        .employee-quick-action:hover {
          border-color: color-mix(in srgb, var(--action-accent) 28%, transparent);
          box-shadow:
            0 18px 40px rgba(35, 42, 105, .13),
            inset 0 1px 0 rgba(255,255,255,.98);
          transform: translateY(-4px);
        }

        .employee-quick-action:hover::after {
          transform: translate(-8px, -7px) scale(1.28);
        }

        .employee-quick-action:active {
          transform: translateY(-1px) scale(.988);
        }

        .employee-quick-action.attendance {
          --action-accent: #5f52e8;
          --action-soft: rgba(95, 82, 232, .12);
        }

        .employee-quick-action.leave {
          --action-accent: #1689d8;
          --action-soft: rgba(22, 137, 216, .12);
        }

        .employee-quick-action.projects {
          --action-accent: #6d4ee8;
          --action-soft: rgba(109, 78, 232, .12);
        }

        .employee-quick-action.ticket {
          --action-accent: #0da6ad;
          --action-soft: rgba(13, 166, 173, .12);
        }

        .employee-quick-action.profile {
          --action-accent: #9a43d7;
          --action-soft: rgba(154, 67, 215, .11);
        }

        .employee-quick-action.refresh {
          --action-accent: #2476d4;
          --action-soft: rgba(36, 118, 212, .11);
        }

        .employee-quick-action-icon {
          width: 44px;
          height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid color-mix(in srgb, var(--action-accent) 18%, transparent);
          border-radius: 15px;
          color: var(--action-accent);
          background:
            radial-gradient(circle at 30% 20%, rgba(255,255,255,.98), transparent 36%),
            linear-gradient(135deg, rgba(255,255,255,.94), var(--action-soft));
          box-shadow:
            0 9px 20px color-mix(in srgb, var(--action-accent) 13%, transparent),
            inset 0 1px 0 rgba(255,255,255,.96);
          transition:
            color .24s ease,
            background .24s ease,
            transform .3s cubic-bezier(.22, 1, .36, 1);
        }

        .employee-quick-action:hover .employee-quick-action-icon {
          color: #fff;
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--action-accent) 88%, white),
            var(--action-accent)
          );
          transform: translateY(-2px) rotate(-3deg) scale(1.04);
        }

        .employee-quick-action-copy {
          min-width: 0;
        }

        .employee-quick-action-copy strong,
        .employee-quick-action-copy small {
          display: block;
          min-width: 0;
        }

        .employee-quick-action-copy strong {
          overflow: visible;
          color: #172554;
          text-overflow: clip;
          white-space: normal;
          overflow-wrap: anywhere;
          font-size: 13.5px;
          font-weight: 900;
          line-height: 1.2;
        }

        .employee-quick-action-copy small {
          margin-top: 4px;
          overflow: visible;
          color: #71809c;
          text-overflow: clip;
          white-space: normal;
          overflow-wrap: anywhere;
          font-size: 10px;
          font-weight: 750;
          line-height: 1.25;
        }

        .employee-quick-action-arrow {
          width: 34px;
          height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          justify-self: end;
          border-radius: 12px;
          color: var(--action-accent);
          background: rgba(255,255,255,.78);
          box-shadow: 0 7px 16px rgba(35, 42, 105, .07);
          transition:
            color .24s ease,
            background .24s ease,
            transform .28s cubic-bezier(.22, 1, .36, 1);
        }

        .employee-quick-action:hover .employee-quick-action-arrow {
          color: #fff;
          background: var(--action-accent);
          transform: translate(2px, -2px);
        }

        .employee-quick-action.refresh:disabled {
          opacity: .62;
          cursor: wait;
          transform: none;
        }

        .employee-quick-action.refresh:disabled .employee-quick-action-icon svg {
          animation: employeeRefreshSpin 1s linear infinite;
        }

        @keyframes employeeAvatarFloat {
          0%, 100% {
            transform: translateY(0);
          }

          50% {
            transform: translateY(-4px);
          }
        }

        @keyframes employeeRefreshSpin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1380px) {
          .employee-name-heading.dashboard-display-name {
            font-size: clamp(32px, 4vw, 58px);
          }
        }

        @media (max-width: 1220px) and (min-width: 1025px) {
          .employee-hero {
            grid-template-columns: minmax(420px, 1.08fr) minmax(360px, .92fr);
          }

          .employee-name-heading.dashboard-display-name {
            font-size: clamp(30px, 3.55vw, 50px);
            letter-spacing: -.035em;
          }

          .employee-dashboard-subtitle {
            font-size: 13.5px;
          }

          .employee-quick-action {
            min-height: 74px;
            grid-template-columns: 40px minmax(0, 1fr) 30px;
            gap: 9px;
            padding: 10px;
          }

          .employee-quick-action-icon {
            width: 40px;
            height: 40px;
          }

          .employee-quick-action-arrow {
            width: 30px;
            height: 30px;
          }
        }

        @media (max-width: 1024px) {
          .emp-project-head-grid {
            grid-template-columns: 1fr;
          }

          .emp-project-ring {
            justify-self: start;
          }

          .employee-hero {
            grid-template-columns: 1fr;
          }

          .employee-hero > .employee-identity,
          .employee-hero > .attendance-card,
          .employee-hero > .attendance-pro-card {
            grid-column: 1;
          }

          .emp-project-stats,
          .emp-project-modern-stat-grid,
          .emp-project-card-grid,
          .emp-leave-status-grid,
          .emp-performance-stat-grid,
          .emp-project-people-line {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }




        /* Admin dashboard top section now mirrors the Employee Dashboard hero. */
        .admin-dashboard-page .employee-hero {
          display: grid;
          grid-template-columns: minmax(460px, 1.18fr) minmax(380px, .82fr);
          gap: 22px;
          align-items: stretch;
        }

        .admin-dashboard-page .employee-hero > .employee-identity {
          grid-column: 1;
          min-width: 0;
        }

        .admin-dashboard-page .employee-hero > .attendance-card,
        .admin-dashboard-page .employee-hero > .attendance-pro-card,
        .admin-dashboard-page .employee-hero > .panel {
          grid-column: 2;
          width: 100%;
          min-width: 0;
          align-self: stretch;
        }

        .admin-dashboard-page .admin-employee-badges {
          margin-top: 22px;
        }

        .admin-dashboard-page .admin-quick-actions {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .admin-dashboard-page .employee-quick-action.balances {
          --action-accent: #d68b1d;
          --action-soft: rgba(214, 139, 29, .12);
        }

        .admin-dashboard-page .employee-quick-action.employees {
          --action-accent: #0da6ad;
          --action-soft: rgba(13, 166, 173, .12);
        }

        .admin-dashboard-page .employee-quick-action.reports {
          --action-accent: #9a43d7;
          --action-soft: rgba(154, 67, 215, .11);
        }

        .admin-dashboard-page .employee-quick-action.notifications {
          --action-accent: #e0567b;
          --action-soft: rgba(224, 86, 123, .11);
        }

        @media (max-width: 1024px) {
          .admin-dashboard-page .employee-hero {
            grid-template-columns: 1fr;
          }

          .admin-dashboard-page .employee-hero > .employee-identity,
          .admin-dashboard-page .employee-hero > .attendance-card,
          .admin-dashboard-page .employee-hero > .attendance-pro-card,
          .admin-dashboard-page .employee-hero > .panel {
            grid-column: 1;
          }
        }

        @media (max-width: 680px) {
          .admin-dashboard-page .employee-hero {
            padding: 18px;
            border-radius: 24px;
          }

          .admin-dashboard-page .employee-identity-head {
            grid-template-columns: 1fr;
            align-items: start;
          }

          .admin-dashboard-page .employee-profile-avatar {
            width: 82px;
            height: 82px;
            border-radius: 24px;
          }

          .admin-dashboard-page .employee-name-heading.dashboard-display-name {
            white-space: normal;
            font-size: clamp(34px, 11vw, 48px);
          }

          .admin-dashboard-page .admin-employee-badges {
            display: grid;
            grid-template-columns: 1fr;
          }

          .admin-dashboard-page .admin-dashboard-badge {
            width: 100%;
            justify-content: center;
            text-align: center;
          }

          .admin-dashboard-page .admin-quick-actions {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 390px) {
          .admin-dashboard-page .employee-quick-action {
            grid-template-columns: 42px minmax(0, 1fr) 32px;
            min-height: 72px;
            padding: 10px;
          }
        }

      `}</style>

        <section className="hero employee-hero admin-employee-hero">
          <div className="employee-identity admin-employee-identity">
            <div className="employee-identity-head">
              <div className="employee-profile-avatar">
                {adminProfilePhotoUrl ? (
                  <img src={adminProfilePhotoUrl} alt={adminDisplayName} />
                ) : (
                  <span>{getInitials(adminDisplayName)}</span>
                )}
              </div>

              <div className="employee-identity-copy">
                <span className="kicker">Admin Dashboard</span>

                <h1 className="employee-name-heading dashboard-display-name">
                  {adminDisplayName}
                </h1>

                <p className="employee-dashboard-subtitle">
                  Monitor attendance, WFH/Field requests, holidays, leave approvals,
                  employee mappings, comp-off credits, tickets, expenses, projects,
                  department progress and reports from one administrative workspace.
                </p>
              </div>
            </div>

            <div className="admin-dashboard-badges admin-employee-badges">
              <span className="admin-dashboard-badge">
                Dashboard: Admin
              </span>

              <span className="admin-dashboard-badge success">
                Capability: {adminCapabilityText}
              </span>

              <span className="admin-dashboard-badge neutral">
                {adminDesignation} • {adminDepartment}
              </span>
            </div>

            <div className="employee-quick-actions admin-quick-actions" aria-label="Admin quick actions">
              <button
                type="button"
                className="employee-quick-action attendance"
                onClick={() => goTo('attendance')}
              >
                <span className="employee-quick-action-icon" aria-hidden="true">
                  <Clock3 size={20} strokeWidth={1.9} />
                </span>

                <span className="employee-quick-action-copy">
                  <strong>Attendance</strong>
                  <small>Open attendance records and daily status</small>
                </span>

                <span className="employee-quick-action-arrow" aria-hidden="true">
                  <ArrowUpRight size={17} strokeWidth={2.1} />
                </span>
              </button>

              <button
                type="button"
                className="employee-quick-action projects"
                onClick={() => goTo('projects')}
              >
                <span className="employee-quick-action-icon" aria-hidden="true">
                  <BriefcaseBusiness size={20} strokeWidth={1.9} />
                </span>

                <span className="employee-quick-action-copy">
                  <strong>Projects</strong>
                  <small>Review projects, teams and progress</small>
                </span>

                <span className="employee-quick-action-arrow" aria-hidden="true">
                  <ArrowUpRight size={17} strokeWidth={2.1} />
                </span>
              </button>

              <button
                type="button"
                className="employee-quick-action leave"
                onClick={() => goTo('leave_requests')}
              >
                <span className="employee-quick-action-icon" aria-hidden="true">
                  <CalendarDays size={20} strokeWidth={1.9} />
                </span>

                <span className="employee-quick-action-copy">
                  <strong>Leave Management</strong>
                  <small>Review and manage leave requests</small>
                </span>

                <span className="employee-quick-action-arrow" aria-hidden="true">
                  <ArrowUpRight size={17} strokeWidth={2.1} />
                </span>
              </button>

              <button
                type="button"
                className="employee-quick-action balances"
                onClick={() => goTo('leave_balances')}
              >
                <span className="employee-quick-action-icon" aria-hidden="true">
                  <Scale size={20} strokeWidth={1.9} />
                </span>

                <span className="employee-quick-action-copy">
                  <strong>Leave Balances</strong>
                  <small>View employee leave allocations</small>
                </span>

                <span className="employee-quick-action-arrow" aria-hidden="true">
                  <ArrowUpRight size={17} strokeWidth={2.1} />
                </span>
              </button>

              <button
                type="button"
                className="employee-quick-action employees"
                onClick={() => goTo('employees')}
              >
                <span className="employee-quick-action-icon" aria-hidden="true">
                  <Users size={20} strokeWidth={1.9} />
                </span>

                <span className="employee-quick-action-copy">
                  <strong>Employee Master</strong>
                  <small>Open employee records and mappings</small>
                </span>

                <span className="employee-quick-action-arrow" aria-hidden="true">
                  <ArrowUpRight size={17} strokeWidth={2.1} />
                </span>
              </button>

              <button
                type="button"
                className="employee-quick-action reports"
                onClick={() => goTo('reports')}
              >
                <span className="employee-quick-action-icon" aria-hidden="true">
                  <BriefcaseBusiness size={20} strokeWidth={1.9} />
                </span>

                <span className="employee-quick-action-copy">
                  <strong>Reports</strong>
                  <small>Open workforce and project reports</small>
                </span>

                <span className="employee-quick-action-arrow" aria-hidden="true">
                  <ArrowUpRight size={17} strokeWidth={2.1} />
                </span>
              </button>

              <button
                type="button"
                className="employee-quick-action notifications"
                onClick={() => goTo('notifications')}
              >
                <span className="employee-quick-action-icon" aria-hidden="true">
                  <Bell size={20} strokeWidth={1.9} />
                </span>

                <span className="employee-quick-action-copy">
                  <strong>Notifications</strong>
                  <small>Open the notification centre</small>
                </span>

                <span className="employee-quick-action-arrow" aria-hidden="true">
                  <ArrowUpRight size={17} strokeWidth={2.1} />
                </span>
              </button>

              <button
                type="button"
                className="employee-quick-action refresh"
                onClick={() => {
                  loadDashboard();
                  loadDashboardNotifications();
                }}
                disabled={loading}
              >
                <span className="employee-quick-action-icon" aria-hidden="true">
                  <RefreshCw size={20} strokeWidth={1.9} />
                </span>

                <span className="employee-quick-action-copy">
                  <strong>{loading ? 'Refreshing...' : 'Refresh'}</strong>
                  <small>Load the latest dashboard information</small>
                </span>

                <span className="employee-quick-action-arrow" aria-hidden="true">
                  <ArrowUpRight size={17} strokeWidth={2.1} />
                </span>
              </button>
            </div>
          </div>

          {employeeSummary ? (
            <AttendanceWidget onSuccess={loadDashboard} />
          ) : (
            <div className="panel">
              <h3>My Attendance</h3>
              <p>Attendance becomes available after this login is linked to an employee record.</p>
            </div>
          )}
        </section>


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

      {mappedCapabilityStats.length > 0 && (
        <section className="stats-grid">
          {mappedCapabilityStats.map(([label, value]) => (
            <Stat key={label} label={label} value={value} />
          ))}
        </section>
      )}

      <section className="admin-notification-summary">
        <div className="toolbar">
          <div>
            <h3>Recent Tenant Notifications</h3>
            <p>
              Latest tenant-scoped notifications visible to this login. HR/Admin
              notifications remain tenant-wise, while Super Admin broadcasts are
              also shown here.
            </p>
          </div>

          <div className="row-actions">
            <button type="button" className="secondary" onClick={loadDashboardNotifications} disabled={notificationLoading}>
              {notificationLoading ? 'Refreshing...' : 'Refresh Notifications'}
            </button>

            <button type="button" className="secondary" onClick={() => goTo('notifications')}>
              Open Notification Center
            </button>
          </div>
        </div>

        {recentNotifications.length ? (
          <div className="admin-notification-grid">
            {recentNotifications.slice(0, 6).map((row) => (
              <div
                key={row._id || `${row.title}-${row.created_at}`}
                className={`admin-notification-card ${notificationIsUnread(row) ? 'unread' : 'read'}`}
              >
                <strong>{row.title || 'Notification'}</strong>
                <p>{notificationBody(row)}</p>

                <div className="admin-notification-meta">
                  <span className={`admin-notification-pill ${notificationIsUnread(row) ? 'unread' : 'read'}`}>
                    {notificationIsUnread(row) ? 'Unread' : 'Read'}
                  </span>
                  <span className="admin-notification-pill">
                    {notificationPriorityLabel(row.priority)}
                  </span>
                  <span className="admin-notification-pill">
                    {notificationTargetLabel(row)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            {notificationLoading ? 'Loading notifications...' : 'No recent notifications found.'}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Notification Records</h3>
            <p>
              Quick table view of recent notifications with popup and read status.
            </p>
          </div>

          <button type="button" className="secondary" onClick={() => goTo('notifications')}>
            Manage Notifications
          </button>
        </div>

        <Table rows={recentNotificationRows} maxColumns={9} />
      </section>

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