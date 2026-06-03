import { useEffect, useMemo, useState } from 'react';
import {
  api,
  getAttendanceStatus,
  getMyAttendanceModeRequests,
  getMyCompOffs,
  claimCompOff,
  decideTeamLeaveApproval,
  getTeamApprovals,
  getInitials,
  getProfilePhotoUrl,
  normalizePeopleList,
  normalizeTeamHierarchyTree,
  normalizeProjectTeamTree,
  normalizeLeaveApprovalList,
} from '../api/client';
import AttendanceWidget from '../components/AttendanceWidget';
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

function formatTime(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleTimeString('en-IN', {
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

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function boolLabel(value) {
  const normalized = String(value || '').toLowerCase();

  if (['true', 'yes', '1', 'on'].includes(normalized)) {
    return 'Yes';
  }

  return 'No';
}

function isTruthy(value) {
  return ['true', 'yes', '1', 'on'].includes(String(value || '').toLowerCase());
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (Array.isArray(value)) {
    return value.join(', ') || '—';
  }

  return String(value);
}

function getRoleList(data = {}, employee = {}, employeeSummary = {}) {
  const roles = [
    ...(Array.isArray(data?.roles) ? data.roles : []),
    ...(Array.isArray(employee?.roles) ? employee.roles : []),
    ...(Array.isArray(employeeSummary?.roles) ? employeeSummary.roles : []),
    employee?.role,
    employeeSummary?.role,
    data?.dashboard_display?.display_role,
    employee?.display_role,
    employeeSummary?.display_role,
  ];

  return roles
    .map((role) => String(role || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_'))
    .filter(Boolean);
}

function hasRoleSignal(roleList = [], signals = []) {
  return roleList.some((role) => signals.includes(role));
}

function capabilityLabel(data, employee, employeeSummary = {}) {
  const labels = [];
  const roles = getRoleList(data, employee, employeeSummary);

  const teamLeader =
    data?.is_team_leader ||
    isTruthy(employee?.is_team_leader) ||
    isTruthy(employeeSummary?.is_team_leader) ||
    hasRoleSignal(roles, ['team_leader', 'team_leader_capability', 'tl']);

  const reportingOfficer =
    data?.is_reporting_officer ||
    isTruthy(employee?.is_reporting_officer) ||
    isTruthy(employeeSummary?.is_reporting_officer) ||
    hasRoleSignal(roles, ['reporting_officer', 'reporting_officer_capability', 'ro', 'manager']);

  if (teamLeader) {
    labels.push('Team Leader');
  }

  if (reportingOfficer) {
    labels.push('Reporting Officer');
  }

  return labels.length ? labels.join(' + ') : 'No additional capability mapped';
}

function dashboardRoleLabel(data = {}, employee = {}, employeeSummary = {}) {
  const roles = getRoleList(data, employee, employeeSummary);

  const teamLeader =
    data?.is_team_leader ||
    isTruthy(employee?.is_team_leader) ||
    isTruthy(employeeSummary?.is_team_leader) ||
    hasRoleSignal(roles, ['team_leader', 'team_leader_capability', 'tl']);

  const reportingOfficer =
    data?.is_reporting_officer ||
    isTruthy(employee?.is_reporting_officer) ||
    isTruthy(employeeSummary?.is_reporting_officer) ||
    hasRoleSignal(roles, ['reporting_officer', 'reporting_officer_capability', 'ro', 'manager']);

  if (teamLeader && reportingOfficer) return 'Team Leader + Reporting Officer';
  if (teamLeader) return 'Team Leader';
  if (reportingOfficer) return 'Reporting Officer';

  return (
    data?.dashboard_display?.display_role ||
    employeeSummary?.display_role ||
    employee?.display_role ||
    'Employee'
  );
}

function firstFilledArray(...arrays) {
  return arrays.find((items) => Array.isArray(items) && items.length) || [];
}

function firstFilledObject(...objects) {
  return objects.find(
    (item) => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length,
  ) || {};
}

function mergeEmployeeData(...records) {
  const merged = {};

  records.forEach((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return;
    }

    Object.entries(record).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        merged[key] = value;
      }
    });
  });

  merged.name =
    merged.name ||
    merged.employee_name ||
    merged.full_name ||
    merged.email ||
    'Employee';

  merged.employee_name = merged.employee_name || merged.name;

  merged.department =
    merged.department ||
    merged.department_name ||
    merged.employee_department ||
    '';

  merged.designation =
    merged.designation ||
    merged.designation_name ||
    merged.employee_designation ||
    '';

  return merged;
}

function dashboardDataWithAuth(dashboardData = {}, authData = {}) {
  const authUser = authData?.user || authData?.current_user || authData || {};
  const authEmployee = authData?.employee || authData?.employee_summary || {};

  const mergedEmployee = mergeEmployeeData(
    authUser,
    authEmployee,
    dashboardData?.employee,
    dashboardData?.employee_summary,
  );

  const authRoles = [
    ...(Array.isArray(authUser?.roles) ? authUser.roles : []),
    ...(Array.isArray(authEmployee?.roles) ? authEmployee.roles : []),
    ...(Array.isArray(dashboardData?.roles) ? dashboardData.roles : []),
    authUser?.role,
    authEmployee?.role,
    mergedEmployee?.role,
    mergedEmployee?.display_role,
    dashboardData?.dashboard_display?.display_role,
  ].filter(Boolean);

  const normalizedRoles = authRoles
    .map((role) => String(role || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_'))
    .filter(Boolean);

  const hasTeamLeaderRole = normalizedRoles.some((role) =>
    ['team_leader', 'team_leader_capability', 'tl'].includes(role),
  );

  const hasReportingOfficerRole = normalizedRoles.some((role) =>
    ['reporting_officer', 'reporting_officer_capability', 'ro', 'manager'].includes(role),
  );

  const isTeamLeader =
    Boolean(dashboardData?.is_team_leader) ||
    isTruthy(mergedEmployee?.is_team_leader) ||
    hasTeamLeaderRole;

  const isReportingOfficer =
    Boolean(dashboardData?.is_reporting_officer) ||
    isTruthy(mergedEmployee?.is_reporting_officer) ||
    hasReportingOfficerRole;

  const displayRole =
    isTeamLeader && isReportingOfficer
      ? 'Team Leader + Reporting Officer'
      : isTeamLeader
        ? 'Team Leader'
        : isReportingOfficer
          ? 'Reporting Officer'
          : dashboardData?.dashboard_display?.display_role ||
            mergedEmployee?.display_role ||
            'Employee';

  return {
    ...dashboardData,
    employee: mergedEmployee,
    employee_summary: mergeEmployeeData(dashboardData?.employee_summary, mergedEmployee),
    roles: Array.from(new Set(normalizedRoles)),
    is_team_leader: isTeamLeader,
    is_reporting_officer: isReportingOfficer,
    dashboard_display: {
      ...(dashboardData?.dashboard_display || {}),
      title:
        dashboardData?.dashboard_display?.title ||
        mergedEmployee?.employee_name ||
        mergedEmployee?.name ||
        'Employee',
      display_role: displayRole,
      subtitle: dashboardData?.dashboard_display?.subtitle || 'Employee Dashboard',
    },
  };
}

function normalizeProjectStatus(value) {
  const status = String(value || '').trim().toLowerCase();

  if (['completed', 'complete', 'done', 'closed', 'inactive'].includes(status)) {
    return 'completed';
  }

  if (['on_hold', 'on-hold', 'hold'].includes(status)) {
    return 'on_hold';
  }

  return 'active';
}

function projectName(project = {}) {
  return project.name || project.project_name || project.title || 'Untitled Project';
}

function numberValue(value, fallback = 0) {
  const number = Number(value);

  if (Number.isNaN(number)) {
    return fallback;
  }

  return number;
}

function percentValue(value) {
  const number = Number(value || 0);

  if (Number.isNaN(number)) {
    return 0;
  }

  return Math.min(Math.max(number, 0), 100);
}

function averageProjectProgress(projects = []) {
  if (!projects.length) return 0;

  const total = projects.reduce(
    (sum, project) => sum + percentValue(project.latest_progress || project.progress_percent || project.progress),
    0,
  );

  return Math.round(total / projects.length);
}

function countValue(...values) {
  for (const value of values) {
    const parsed = Number(value);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function ratingPercent(value) {
  const rating = numberValue(value, 0);
  return Math.min(Math.max((rating / 5) * 100, 0), 100);
}

function ratingValue(row = {}) {
  return numberValue(
    row.average_rating ??
      row.avg_rating ??
      row.rating_average ??
      row.rating_value ??
      row.latest_rating ??
      row.rating ??
      row.score ??
      row.performance_score,
    0,
  );
}

function reviewCount(row = {}) {
  return numberValue(row.review_count ?? row.count ?? row.total_reviews ?? row.rated_reviews, 0);
}

function performanceRows(chart = {}) {
  if (Array.isArray(chart)) {
    return chart;
  }

  if (!chart || typeof chart !== 'object') {
    return [];
  }

  if (Array.isArray(chart.members) && chart.members.length) {
    return chart.members;
  }

  if (Array.isArray(chart.rows) && chart.rows.length) {
    return chart.rows;
  }

  if (Array.isArray(chart.items) && chart.items.length) {
    return chart.items;
  }

  if (Array.isArray(chart.recent_reviews) && chart.recent_reviews.length) {
    return chart.recent_reviews;
  }

  return [];
}

function performanceSummaryOf(chart = {}) {
  if (!chart || typeof chart !== 'object' || Array.isArray(chart)) {
    return {};
  }

  return chart.summary || {};
}

function reviewTargetLabel(value) {
  const normalized = String(value || '').toLowerCase();

  if (normalized === 'team_member') return 'Team Member';
  if (normalized === 'team_leader') return 'Team Leader';
  if (normalized === 'reporting_member') return 'Reporting Member';
  if (normalized === 'admin_review') return 'Admin / HR Review';

  return statusLabel(value);
}

function reviewerRoleLabel(value) {
  const normalized = String(value || '').toLowerCase();

  if (normalized === 'team_leader') return 'Team Leader';
  if (normalized === 'reporting_officer') return 'Reporting Officer';
  if (normalized === 'admin_hr') return 'Admin / HR';

  return statusLabel(value);
}

function employeeOptionLabel(row = {}) {
  return `${row.name || row.employee_name || 'Employee'} — ${
    row.designation || row.department || row.email || row.employee_id || row.emp_code || ''
  }`;
}

function personName(person = {}) {
  return (
    person.name ||
    person.employee_name ||
    person.display_name ||
    person.full_name ||
    person.email ||
    'Employee'
  );
}

function personRole(person = {}) {
  return (
    person.relation_label ||
    person.review_group_label ||
    person.designation ||
    person.relation ||
    'Team Member'
  );
}

function safePeople(value = []) {
  return normalizePeopleList(Array.isArray(value) ? value : []);
}

function projectTeamTree(project = {}) {
  return normalizeProjectTeamTree(project.project_team_tree || {});
}

function projectDoingPeople(project = {}) {
  const tree = projectTeamTree(project);
  const direct = safePeople(project.doing_people || []);

  if (direct.length) return direct;
  if (tree.doing_people?.length) return tree.doing_people;

  return safePeople(project.assigned_members || []);
}

function projectAssignedPeople(project = {}) {
  const tree = projectTeamTree(project);
  const direct = safePeople(project.assigned_members || []);
  return direct.length ? direct : tree.assigned_members || [];
}

function projectCollaboratorPeople(project = {}) {
  const tree = projectTeamTree(project);
  const direct = safePeople(project.collaborators || []);
  return direct.length ? direct : tree.collaborators || [];
}

function profilePhotoValue(record = {}) {
  return (
    record.avatar ||
    record.profile_photo ||
    record.profile_picture ||
    record.photo ||
    record.image ||
    record.picture ||
    ''
  );
}

function Avatar({ person = {}, size = 'md' }) {
  const name = personName(person);
  const photoUrl = getProfilePhotoUrl(person);

  return (
    <div className={`emp-avatar emp-avatar-${size}`} title={name}>
      {photoUrl ? <img src={photoUrl} alt={name} /> : <span>{getInitials(name)}</span>}
    </div>
  );
}

function PersonChip({ person = {}, label = '', compact = false }) {
  return (
    <div className={`emp-person-chip ${compact ? 'compact' : ''}`}>
      <Avatar person={person} size={compact ? 'sm' : 'md'} />
      <div>
        <strong>{personName(person)}</strong>
        <span>{label || personRole(person)}</span>
        {!compact && (
          <small>
            {person.department || 'No department'}
            {person.designation ? ` • ${person.designation}` : ''}
          </small>
        )}
      </div>
    </div>
  );
}

function AvatarStack({ people = [], limit = 5 }) {
  const list = safePeople(people).slice(0, limit);
  const remaining = Math.max(0, safePeople(people).length - limit);

  if (!list.length) {
    return <span className="emp-avatar-empty">No members</span>;
  }

  return (
    <div className="emp-avatar-stack">
      {list.map((person, index) => (
        <div className="emp-avatar-stack-item" key={`${person.employee_id || person._id || person.email || index}-${index}`}>
          <Avatar person={person} size="xs" />
        </div>
      ))}
      {remaining > 0 && <span className="emp-avatar-more">+{remaining}</span>}
    </div>
  );
}

function samePerson(a = {}, b = {}) {
  const aIds = [
    a._id,
    a.id,
    a.employee_id,
    a.user_id,
    a.email,
  ].map((value) => String(value || '').trim()).filter(Boolean);

  const bIds = [
    b._id,
    b.id,
    b.employee_id,
    b.user_id,
    b.email,
  ].map((value) => String(value || '').trim()).filter(Boolean);

  return aIds.some((value) => bIds.includes(value));
}

function TeamHierarchyMap({ tree = {}, title = 'My Team Root Map' }) {
  const normalized = normalizeTeamHierarchyTree(tree || {});
  const reportingOfficer = normalized.reporting_officer || {};
  const teamLeader = normalized.team_leader || {};
  const self = normalized.self || {};
  const teamMembers = normalized.team_members || [];
  const reportingMembers = normalized.reporting_members || [];
  const teamLeadersUnderReporting = normalized.team_leaders_under_reporting || [];

  const hasSelf = Boolean(self?.employee_name || self?.name);
  const hasTeamLeader = Boolean(teamLeader?.employee_name || teamLeader?.name);
  const selfIsTeamLeader = hasSelf && hasTeamLeader && samePerson(self, teamLeader);
  const selfAlreadyInTeamMembers = teamMembers.some((person) => samePerson(person, self));

  const visibleTeamMembers =
    hasSelf && hasTeamLeader && !selfIsTeamLeader && !selfAlreadyInTeamMembers
      ? [...teamMembers, self]
      : teamMembers;

  const visibleAllPeople = normalizePeopleList([
    reportingOfficer,
    teamLeader,
    ...visibleTeamMembers,
    ...reportingMembers,
  ]).filter((person, index, list) => (
    list.findIndex((item) => samePerson(item, person)) === index
  ));

  return (
    <section className="emp-root-map-panel">
      <div className="emp-root-map-bg" />
      <div className="emp-root-map-head">
        <span>Hierarchy View</span>
        <h3>{title}</h3>
        <p>{normalized.connection_label || 'Reporting Officer → Team Leader → Team Members'}</p>
      </div>

      <div className="emp-root-map-stage">
        <div className="emp-root-node ro-node">
          {reportingOfficer?.employee_name || reportingOfficer?.name ? (
            <PersonChip person={reportingOfficer} label="Reporting Officer" />
          ) : (
            <div className="emp-root-empty">No Reporting Officer mapped</div>
          )}
        </div>

        <div className="emp-root-line" />

        <div className="emp-root-node tl-node">
          {teamLeader?.employee_name || teamLeader?.name ? (
            <PersonChip person={teamLeader} label="Team Leader" />
          ) : (
            <PersonChip person={self} label="Current Employee" />
          )}
        </div>

        <div className="emp-root-branches">
          <div className="emp-root-branch">
            <div className="emp-root-branch-title">
              <span>Team Members</span>
              <strong>{visibleTeamMembers.length}</strong>
            </div>

            <div className="emp-root-people-list">
              {visibleTeamMembers.map((person, index) => (
                <PersonChip
                  compact
                  key={`${person.employee_id || person._id || person.email || index}-team`}
                  person={person}
                  label="Team Member"
                />
              ))}

              {!visibleTeamMembers.length && <div className="emp-root-empty">No team members mapped</div>}
            </div>
          </div>

          <div className="emp-root-branch reporting">
            <div className="emp-root-branch-title">
              <span>Reporting Scope</span>
              <strong>{reportingMembers.length}</strong>
            </div>

            <div className="emp-root-people-list">
              {(teamLeadersUnderReporting.length ? teamLeadersUnderReporting : reportingMembers).map((person, index) => (
                <PersonChip
                  compact
                  key={`${person.employee_id || person._id || person.email || index}-reporting`}
                  person={person}
                  label={isTruthy(person.is_team_leader) ? 'Team Leader' : 'Reporting Member'}
                />
              ))}

              {!reportingMembers.length && <div className="emp-root-empty">No reporting members mapped</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="emp-root-map-foot">
        <span>Connected People</span>
        <strong>{visibleAllPeople.length}</strong>
        <AvatarStack people={visibleAllPeople} limit={8} />
      </div>
    </section>
  );
}

function ProjectPeopleLine({ project = {} }) {
  const doingPeople = projectDoingPeople(project);
  const assignedPeople = projectAssignedPeople(project);
  const collaborators = projectCollaboratorPeople(project);
  const tree = projectTeamTree(project);

  return (
    <div className="emp-project-people-line">
      <div>
        <span>Doing</span>
        <AvatarStack people={doingPeople} />
      </div>
      <div>
        <span>Assigned</span>
        <AvatarStack people={assignedPeople} />
      </div>
      <div>
        <span>Collaborators</span>
        <AvatarStack people={collaborators} />
      </div>
      <div>
        <span>Team Lead</span>
        {tree.team_leader?.employee_name || tree.team_leader?.name ? (
          <PersonChip person={tree.team_leader} label="TL" compact />
        ) : (
          <small>Not mapped</small>
        )}
      </div>
    </div>
  );
}

function leaveLiveStatus(row = {}) {
  if (row.live_status || row.status_text || row.status_display) {
    return row.live_status || row.status_text || row.status_display;
  }

  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved' || stage === 'approved') {
    return 'Approved';
  }

  if (status === 'rejected' || stage === 'rejected') {
    return 'Rejected';
  }

  if (stage === 'team_leader') {
    return 'Pending with Team Leader';
  }

  if (stage === 'reporting_officer') {
    if (row.approved_by_team_leader || row.approved_by_team_leader_name) {
      return 'Approved by Team Leader, Pending with Reporting Officer';
    }

    return 'Pending with Reporting Officer';
  }

  if (stage === 'hr') {
    return 'Pending with HR';
  }

  return row.approval_stage_label || statusLabel(row.status);
}

function MiniProgressBar({ value }) {
  const percentage = percentValue(value);

  return (
    <div className="emp-project-mini-progress">
      <div className="emp-project-mini-progress-track">
        <div
          className="emp-project-mini-progress-fill"
          style={{ width: `${Math.max(percentage, 4)}%` }}
        />
      </div>
      <strong>{percentage}%</strong>
    </div>
  );
}

function RatingBar({ value }) {
  const rating = ratingValue({ rating: value });
  const width = ratingPercent(rating);

  return (
    <div className="emp-rating-mini-progress">
      <div className="emp-rating-mini-progress-track">
        <div
          className="emp-rating-mini-progress-fill"
          style={{ width: `${width}%` }}
        />
      </div>
      <strong>{rating ? rating.toFixed(1) : '0.0'}/5</strong>
    </div>
  );
}

function ProjectProgressRing({ value = 0, label = 'Avg Progress' }) {
  const progress = percentValue(value);

  return (
    <div className="emp-project-ring" style={{ '--ringValue': `${progress}%` }}>
      <div>
        <strong>{progress}%</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function ProjectAccessCard({ isTeamLeader, isReportingOfficer }) {
  const canCreate = isTeamLeader || isReportingOfficer;

  return (
    <div className={`emp-project-access-card ${canCreate ? 'can-create' : ''}`}>
      <div>
        <span>Project Access</span>
        <strong>{canCreate ? 'Creator / Manager Access' : 'View + Progress Access'}</strong>
        <p>
          {canCreate
            ? 'You can create projects, assign team members, assign projects to yourself, add collaborators, and update project progress.'
            : 'You can view scoped projects and update status/progress only when you are assigned or added as a collaborator.'}
        </p>
      </div>

      <em>{canCreate ? 'TL / RO + Self Assign' : 'Employee'}</em>
    </div>
  );
}

function ProjectMetricCard({ label, value, meta, variant = 'indigo' }) {
  return (
    <div className={`emp-project-modern-stat ${variant}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function ProjectTrendGraph({ title, rows = [], description = 'Daily project progress trend based on submitted updates.' }) {
  const hasRows = rows.length > 0;
  const maxUpdates = Math.max(1, ...rows.map((row) => numberValue(row.updates, 0)));

  return (
    <div className="panel emp-project-chart-card">
      <div className="toolbar">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>

      {!hasRows && <div className="empty">No project progress data found.</div>}

      {hasRows && (
        <div className="emp-project-trend-grid">
          {rows.slice(-10).map((row) => {
            const avgProgress = percentValue(row.average_progress);
            const updates = numberValue(row.updates, 0);
            const height = Math.max(12, (updates / maxUpdates) * 100);

            return (
              <div className="emp-project-trend-item" key={row.date}>
                <div className="emp-project-trend-bar">
                  <span style={{ height: `${height}%` }} />
                </div>

                <strong>{updates}</strong>
                <small>{String(row.date || '').slice(5) || '—'}</small>
                <em>{avgProgress}%</em>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectRankingGraph({ title, rows = [], emptyText = 'No project progress data found.' }) {
  const sortedRows = [...rows]
    .sort((a, b) => percentValue(b.latest_progress) - percentValue(a.latest_progress))
    .slice(0, 8);

  return (
    <div className="panel emp-project-rank-panel">
      <div className="toolbar">
        <div>
          <h3>{title}</h3>
          <p>Projects ranked by latest progress percentage.</p>
        </div>
      </div>

      {!sortedRows.length && <div className="empty">{emptyText}</div>}

      {!!sortedRows.length && (
        <div className="emp-project-rank-list">
          {sortedRows.map((project, index) => {
            const progress = percentValue(project.latest_progress);

            return (
              <div className="emp-project-rank-card" key={project._id || projectName(project)}>
                <div className="emp-project-rank-no">{index + 1}</div>

                <div className="emp-project-rank-main">
                  <strong>{projectName(project)}</strong>
                  <span>
                    {project.department || 'No department'}
                    {project.team_leader_name ? ` • ${project.team_leader_name}` : ''}
                  </span>

                  <div className="emp-project-rank-track">
                    <div style={{ width: `${Math.max(progress, 4)}%` }} />
                  </div>

                  <small>
                    Status: {statusLabel(project.status)} • Last update: {project.latest_progress_date || '—'}
                  </small>
                </div>

                <div className="emp-project-rank-score">{progress}%</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectMiniBoard({
  title,
  description,
  projects = [],
  emptyText = 'No projects found.',
}) {
  return (
    <div className="emp-project-card-grid">
      {projects.slice(0, 6).map((project) => {
        const status = normalizeProjectStatus(project.status);
        const doingPeople = projectDoingPeople(project);
        const collaborators = projectCollaboratorPeople(project);
        const tree = projectTeamTree(project);

        return (
          <div className="emp-project-card" key={project._id || projectName(project)}>
            <div className="emp-project-card-top">
              <div>
                <h4>{projectName(project)}</h4>
                <p>
                  {project.department || 'No department'}
                  {tree.team_leader?.employee_name || project.team_leader_name
                    ? ` • TL: ${tree.team_leader?.employee_name || project.team_leader_name}`
                    : ''}
                </p>
              </div>
              <AvatarStack people={doingPeople} limit={3} />
            </div>

            <span className={`emp-project-status ${status}`}>
              {statusLabel(status)}
            </span>

            <MiniProgressBar value={project.latest_progress} />

            <ProjectPeopleLine project={project} />

            <p>
              Doing: {doingPeople.map((person) => personName(person)).filter(Boolean).join(', ') || 'No assigned member'}
            </p>

            <p>
              Collaborators: {collaborators.map((person) => personName(person)).filter(Boolean).join(', ') || 'No collaborators'}
            </p>

            <p>
              Last update: {project.latest_progress_date || 'No update yet'}
            </p>
          </div>
        );
      })}

      {!projects.length && (
        <div className="panel">
          <h3>{title}</h3>
          <p>{description || emptyText}</p>
        </div>
      )}
    </div>
  );
}

function PerformanceGraph({ title, description, rows = [], emptyText }) {
  const graphRows = performanceRows(rows);

  return (
    <div className="panel emp-performance-card">
      <div className="toolbar">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>

      {!graphRows.length && (
        <div className="empty">
          {emptyText || 'No performance graph data available yet.'}
        </div>
      )}

      {!!graphRows.length && (
        <div className="emp-performance-graph">
          {graphRows.slice(0, 10).map((row, index) => {
            const label =
              row.graph_label ||
              row.employee_name ||
              row.target_employee_name ||
              row.team_leader_name ||
              row.reviewer_name ||
              row.cycle ||
              row.week_label ||
              row.month_label ||
              row.year_label ||
              row.label ||
              `Review ${index + 1}`;

            const rating = ratingValue(row);
            const count = reviewCount(row);
            const width = ratingPercent(rating);

            return (
              <div className="emp-performance-row" key={`${label}-${index}`}>
                <div className="emp-performance-row-head">
                  <span>{label}</span>
                  <strong>{rating ? rating.toFixed(1) : '0.0'}/5</strong>
                </div>

                <div className="emp-performance-track">
                  <div
                    className="emp-performance-fill"
                    style={{ width: `${Math.max(width, 4)}%` }}
                  />
                </div>

                <small>
                  {row.review_scope_label ||
                    reviewTargetLabel(row.review_target_type) ||
                    'Performance Review'}
                  {count ? ` • ${count} review${count > 1 ? 's' : ''}` : ''}
                  {row.week_label || row.month_label || row.year_label || row.cycle ? ` • ${row.week_label || row.month_label || row.year_label || row.cycle}` : ''}
                </small>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeaveApprovalTable({ rows = [], saving, onDecision }) {
  if (!rows.length) {
    return <div className="empty">No pending leave approval found.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Leave Type</th>
            <th>From</th>
            <th>Upto</th>
            <th>Days</th>
            <th>Deducted From</th>
            <th>LWP Days</th>
            <th>Task Handover</th>
            <th>Project Handover</th>
            <th>Current Stage</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row._id}>
              <td>
                <strong>{row.employee_name || '—'}</strong>
                <br />
                <small>{row.employee_code || row.emp_code || row.employee_id || '—'}</small>
              </td>
              <td>{leaveRequestTypeLabel(row)}</td>
              <td>{formatDate(row.from_date)}</td>
              <td>{formatDate(row.to_date || row.upto_date)}</td>
              <td>{row.leave_days ?? '—'}</td>
              <td>{deductedLeaveTypeLabel(row)}</td>
              <td>{lwpDaysLabel(row)}</td>
              <td>{row.task_handover_to_name || '—'}</td>
              <td>{row.project_handover_name || '—'}</td>
              <td>{leaveLiveStatus(row)}</td>
              <td>
                <div className="row-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onDecision(row, 'approved')}
                    disabled={saving}
                  >
                    Approve
                  </button>

                  <button
                    type="button"
                    className="danger"
                    onClick={() => onDecision(row, 'rejected')}
                    disabled={saving}
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EmployeeDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [attendanceStatus, setAttendanceStatus] = useState(null);
  const [modeRequests, setModeRequests] = useState([]);
  const [compOffs, setCompOffs] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [teamApprovalRequests, setTeamApprovalRequests] = useState([]);

  const [claimForm, setClaimForm] = useState({
    compoff_id: '',
    claim_date: '',
    reason: '',
  });

  const [message, setMessage] = useState('');
  const [claimingCompOff, setClaimingCompOff] = useState(false);
  const [leaveDecisionSaving, setLeaveDecisionSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadDashboard() {
    try {
      setLoading(true);
      setMessage('');

      const [
        dashboardData,
        authData,
        attendanceData,
        requestData,
        compOffData,
        leaveBalanceData,
        leaveRequestData,
        teamApprovalData,
      ] = await Promise.all([
        api('/dashboard/employee').catch(() => ({})),
        api('/auth/me').catch(() => ({})),
        getAttendanceStatus().catch(() => null),
        getMyAttendanceModeRequests().catch(() => ({ items: [] })),
        getMyCompOffs().catch(() => ({ items: [] })),
        api('/leave_balances').catch(() => ({ items: [] })),
        api('/leave_requests').catch(() => ({ items: [] })),
        getTeamApprovals({ status: 'pending' }).catch(() => ({ items: [] })),
      ]);
      setData(dashboardDataWithAuth(dashboardData, authData));
      setAttendanceStatus(attendanceData);
      setModeRequests(requestData?.items || []);
      setCompOffs(compOffData?.items || []);
      setLeaveBalances(leaveBalanceData?.items || []);
      setLeaveRequests(leaveRequestData?.items || []);
      setTeamApprovalRequests(
        normalizeLeaveApprovalList(
          teamApprovalData?.items ||
            teamApprovalData?.leave_requests ||
            teamApprovalData?.pending_leave_approvals ||
            teamApprovalData?.my_pending_leave_approvals ||
            [],
        ),
      );
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Unable to load employee dashboard');
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

  async function submitCompOffClaim(event) {
    event.preventDefault();
    setMessage('');

    if (!claimForm.compoff_id) {
      setMessage('Please select an available comp-off');
      return;
    }

    if (!claimForm.claim_date) {
      setMessage('Please select comp-off claim date');
      return;
    }

    try {
      setClaimingCompOff(true);

      const res = await claimCompOff(claimForm.compoff_id, {
        claim_date: claimForm.claim_date,
        reason: claimForm.reason,
      });

      setMessage(res.message || 'Comp-off claim submitted');

      setClaimForm({
        compoff_id: '',
        claim_date: '',
        reason: '',
      });

      await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'Unable to claim comp-off');
    } finally {
      setClaimingCompOff(false);
    }
  }

  async function decideLeave(row, status) {
    const ok = window.confirm(`${statusLabel(status)} this leave request?`);

    if (!ok) {
      return;
    }

    try {
      setMessage('');
      setLeaveDecisionSaving(true);

      const res = await decideTeamLeaveApproval(row._id, {
        status,
      });

      setMessage(res.message || `Leave ${status}`);
      await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'Unable to update leave request');
    } finally {
      setLeaveDecisionSaving(false);
    }
  }

const employee = mergeEmployeeData(data?.employee_summary, data?.employee);
const employeeSummary = mergeEmployeeData(data?.employee_summary, employee);

const displayName =
  data?.dashboard_display?.title ||
  employeeSummary?.employee_name ||
  employeeSummary?.name ||
  employee?.employee_name ||
  employee?.name ||
  employee?.email ||
  'Employee';

const dashboardRole = dashboardRoleLabel(data, employee, employeeSummary);
const employeeId = String(employee?._id || employee?.id || employeeSummary?._id || employeeSummary?.id || '');

const mappedCapabilityLabel = capabilityLabel(data, employee, employeeSummary);

const roleSignals = getRoleList(data, employee, employeeSummary);

const isTeamLeader = Boolean(
  data?.is_team_leader ||
    isTruthy(employee?.is_team_leader) ||
    isTruthy(employeeSummary?.is_team_leader) ||
    hasRoleSignal(roleSignals, ['team_leader', 'team_leader_capability', 'tl']) ||
    String(data?.dashboard_display?.display_role || '').toLowerCase().includes('team leader') ||
    String(employee?.display_role || '').toLowerCase().includes('team leader') ||
    String(employeeSummary?.display_role || '').toLowerCase().includes('team leader'),
);

const isReportingOfficer = Boolean(
  data?.is_reporting_officer ||
    isTruthy(employee?.is_reporting_officer) ||
    isTruthy(employeeSummary?.is_reporting_officer) ||
    hasRoleSignal(roleSignals, ['reporting_officer', 'reporting_officer_capability', 'ro', 'manager']) ||
    String(data?.dashboard_display?.display_role || '').toLowerCase().includes('reporting officer') ||
    String(employee?.display_role || '').toLowerCase().includes('reporting officer') ||
    String(employeeSummary?.display_role || '').toLowerCase().includes('reporting officer'),
);

const isMappedApprover = isTeamLeader || isReportingOfficer;

  const canCreateOrAssignProjects = isTeamLeader || isReportingOfficer;

  const holiday = attendanceStatus?.holiday || data?.holiday || {};
  const todayAttendance =
    attendanceStatus?.attendance || data?.today_attendance || null;

  const availableModes =
    attendanceStatus?.available_modes ||
    data?.available_attendance_modes ||
    ['office'];

const projectDashboard = data?.project_dashboard || {};
const projectSummary = projectDashboard?.summary || {};

const activeProjects = firstFilledArray(
  projectDashboard?.active_projects,
  data?.active_projects,
);

const completedProjects = firstFilledArray(
  projectDashboard?.completed_projects,
  data?.completed_projects,
);

const myProjects = firstFilledArray(
  projectDashboard?.my_projects,
  data?.projects,
  activeProjects,
  completedProjects,
);

const teamLeaderProjects = firstFilledArray(
  projectDashboard?.team_leader_projects,
  data?.team_leader_projects,
  projectDashboard?.my_projects,
  data?.projects,
);

  const reportingProjects = firstFilledArray(
    projectDashboard?.reporting_projects,
    data?.reporting_projects,
    projectDashboard?.team_leader_projects,
    data?.team_leader_projects,
  );

  const projectDailyChart =
    data?.project_daily_progress_chart ||
    projectDashboard?.daily_progress_chart ||
    [];

  const teamProjectDailyChart =
    data?.team_project_daily_progress_chart ||
    projectDashboard?.team_daily_progress_chart ||
    [];

  const reportingProjectDailyChart =
    data?.reporting_project_daily_progress_chart ||
    projectDashboard?.reporting_daily_progress_chart ||
    [];

const myProjectCount = countValue(
  projectSummary.my_total_projects,
  projectSummary.total_projects,
  myProjects.length,
  activeProjects.length + completedProjects.length,
);

const myActiveProjectCount = countValue(
  projectSummary.my_active_projects,
  projectSummary.active_projects,
  activeProjects.length,
);

const myCompletedProjectCount = countValue(
  projectSummary.my_completed_projects,
  projectSummary.completed_projects,
  completedProjects.length,
);

const teamProjectCount = countValue(
  projectSummary.team_total_projects,
  teamLeaderProjects.length,
);

const teamActiveProjectCount = countValue(
  projectSummary.team_active_projects,
  teamLeaderProjects.filter((project) => normalizeProjectStatus(project.status) === 'active').length,
);

const teamCompletedProjectCount = countValue(
  projectSummary.team_completed_projects,
  teamLeaderProjects.filter((project) => normalizeProjectStatus(project.status) === 'completed').length,
);

const reportingProjectCount = countValue(
  projectSummary.reporting_total_projects,
  reportingProjects.length,
);

const reportingActiveProjectCount = countValue(
  projectSummary.reporting_active_projects,
  reportingProjects.filter((project) => normalizeProjectStatus(project.status) === 'active').length,
);

const reportingCompletedProjectCount = countValue(
  projectSummary.reporting_completed_projects,
  reportingProjects.filter((project) => normalizeProjectStatus(project.status) === 'completed').length,
);

const myProjectAverage = projectSummary.average_progress || averageProjectProgress(myProjects);
const teamProjectAverage = projectSummary.team_average_progress || averageProjectProgress(teamLeaderProjects);
const reportingProjectAverage = projectSummary.reporting_average_progress || averageProjectProgress(reportingProjects);

  const performanceSummary = data?.performance_summary || {};

  const myPerformanceChart =
    data?.my_performance_chart ||
    data?.own_performance_chart ||
    performanceSummary?.my_performance_chart ||
    {};

  const teamPerformanceChart =
    data?.team_member_weekly_graph ||
    data?.team_member_performance_chart ||
    data?.team_performance_chart ||
    performanceSummary?.team_member_performance_chart ||
    performanceSummary?.team_performance_chart ||
    {};

  const reportingPerformanceChart =
    data?.reporting_team_leader_weekly_graph ||
    data?.reporting_performance_chart ||
    data?.reporting_officer_performance_chart ||
    performanceSummary?.reporting_performance_chart ||
    performanceSummary?.reporting_officer_performance_chart ||
    {};

  const weeklyPerformanceChart =
    data?.weekly_performance_chart ||
    data?.performance_3d_graph ||
    {};

  const monthlyPerformanceChart = data?.monthly_performance_chart || {};
  const yearlyPerformanceChart = data?.yearly_performance_chart || {};

  const teamLeaderReviewGraph =
    data?.team_member_weekly_graph ||
    data?.team_leader_review_graph ||
    performanceSummary?.team_leader_review_graph ||
    teamPerformanceChart;

  const reportingOfficerReviewGraph =
    data?.reporting_team_leader_weekly_graph ||
    data?.reporting_officer_review_graph ||
    performanceSummary?.reporting_officer_review_graph ||
    reportingPerformanceChart;

  const averageMyRating =
    performanceSummary?.my_average_rating ??
    performanceSummary?.average_rating_received ??
    performanceSummaryOf(myPerformanceChart)?.average_rating ??
    0;

  const averageTeamRating =
    performanceSummary?.team_average_rating ??
    performanceSummary?.team_member_average_rating ??
    performanceSummaryOf(teamPerformanceChart)?.average_rating ??
    0;

  const averageReportingRating =
    performanceSummary?.reporting_average_rating ??
    performanceSummary?.reporting_officer_average_rating ??
    performanceSummaryOf(reportingPerformanceChart)?.average_rating ??
    0;

  const availableCompOffs = useMemo(
    () => compOffs.filter((item) => item.status === 'available'),
    [compOffs],
  );

  const pendingModeRequests = useMemo(
    () => modeRequests.filter((item) => item.status === 'pending'),
    [modeRequests],
  );

  const teamReviewableEmployees = useMemo(() => {
    if (!isTeamLeader) {
      return [];
    }

    return (data?.team_members || []).filter((employeeRow) => employeeRow?._id);
  }, [data?.team_members, isTeamLeader]);

  const reportingReviewableEmployees = useMemo(() => {
    if (!isReportingOfficer) {
      return [];
    }

    return (data?.reporting_members || []).filter((employeeRow) => employeeRow?._id);
  }, [data?.reporting_members, isReportingOfficer]);

  const reviewableEmployees = useMemo(() => {
    const map = new Map();

    teamReviewableEmployees.forEach((employeeRow) => {
      map.set(employeeRow._id, {
        ...employeeRow,
        review_group_label: 'Team Member',
        review_help_text: 'Team Leader to Team Member',
      });
    });

    reportingReviewableEmployees.forEach((employeeRow) => {
      const isMappedTeamLeader = isTruthy(employeeRow.is_team_leader);

      map.set(employeeRow._id, {
        ...employeeRow,
        review_group_label: isMappedTeamLeader ? 'Team Leader' : 'Reporting Member',
        review_help_text: isMappedTeamLeader
          ? 'Reporting Officer to Team Leader'
          : 'Reporting Officer to Reporting Member',
      });
    });

    return Array.from(map.values());
  }, [teamReviewableEmployees, reportingReviewableEmployees]);

  const dashboardLeaveBalances = data?.leave_balances || [];
  const leaveBalanceSource = leaveBalances.length ? leaveBalances : dashboardLeaveBalances;

  const dashboardLeaveRequests = data?.leaves || [];
  const leaveRequestSource = leaveRequests.length ? leaveRequests : dashboardLeaveRequests;

  const myLeaveRows = leaveRequestSource.filter((row) => {
    if (!employeeId) {
      return true;
    }

    return String(row.employee_id || '') === employeeId;
  });

  const pendingApprovalLeavesFromApi = leaveRequestSource.filter((row) => {
    if (String(row.status || '').toLowerCase() !== 'pending') {
      return false;
    }

    if (employeeId && String(row.employee_id || '') === employeeId) {
      return false;
    }

    return ['team_leader', 'reporting_officer', 'hr'].includes(
      String(row.approval_stage || '').toLowerCase(),
    );
  });

  const pendingApprovalLeaves =
    teamApprovalRequests.length > 0
      ? teamApprovalRequests
      : pendingApprovalLeavesFromApi.length > 0
        ? normalizeLeaveApprovalList(pendingApprovalLeavesFromApi)
        : normalizeLeaveApprovalList(data?.team_pending_leaves || []);

  const approvalCounts = data?.pending_approval_counts || {
    leave_requests: pendingApprovalLeaves.length,
    attendance_mode_requests:
      data?.team_pending_attendance_mode_requests?.length || 0,
  };

  const profileRows = [
    {
      field: 'Employee ID',
      value:
        employeeSummary.employee_id ||
        employee.employee_id ||
        employee.emp_code ||
        '',
    },
    {
      field: 'Employee Name',
      value: displayName,
    },
    {
      field: 'Dashboard Role',
      value: dashboardRole,
    },
    {
      field: 'Employee Capability',
      value: mappedCapabilityLabel,
    },
    {
      field: 'Project Permission',
      value: canCreateOrAssignProjects
        ? 'Can create projects, assign team members, and add collaborators'
        : 'Can view scoped projects and update assigned/collaborator progress',
    },
    {
      field: 'Department',
      value: employeeSummary.department || employee.department || '',
    },
    {
      field: 'Designation',
      value: employeeSummary.designation || employee.designation || '',
    },
    {
      field: 'State / Branch',
      value:
        employeeSummary.state ||
        employee.state ||
        employeeSummary.branch ||
        employee.branch ||
        '',
    },
    {
      field: 'Shift',
      value: employeeSummary.shift || employee.shift || '',
    },
    {
      field: 'Joining Date',
      value:
        employeeSummary.joining_date ||
        employee.joining_date ||
        employee.doj ||
        '',
    },
    {
      field: 'Employment Status',
      value:
        employeeSummary.employment_status ||
        employee.employment_status ||
        employee.status ||
        '',
    },
    {
      field: 'Mapped Team Leader',
      value: employeeSummary.team_leader_name || employee.team_leader_name || '',
    },
    {
      field: 'Mapped Reporting Officer',
      value:
        employeeSummary.reporting_officer_name ||
        employee.reporting_officer_name ||
        '',
    },
  ];

  const leaveBalanceRows = leaveBalanceSource.map((row) => ({
    leave_type: leaveTypeLabel(row.leave_type_label || row.leave_type),
    opening_balance: row.opening_balance ?? 0,
    credited: row.credited ?? 0,
    used_deducted: row.used ?? 0,
    available: row.available ?? 0,
    status: statusLabel(row.status),
  }));

  const casualBalance =
    leaveBalanceSource.find((row) =>
      ['CL', 'CASUAL LEAVE'].includes(String(row.leave_type || row.leave_type_label || '').toUpperCase()),
    ) || {};

  const earnedBalance =
    leaveBalanceSource.find((row) =>
      ['EL', 'EARNED LEAVE'].includes(String(row.leave_type || row.leave_type_label || '').toUpperCase()),
    ) || {};

  const totalAvailableLeave = leaveBalanceSource.reduce(
    (total, row) => total + Number(row.available || 0),
    0,
  );

  const totalUsedLeave = leaveBalanceSource.reduce(
    (total, row) => total + Number(row.used || 0),
    0,
  );

  const modeRequestRows = modeRequests.slice(0, 8).map((row) => ({
    mode: modeLabel(row.mode),
    date: row.date || '—',
    reason: row.reason || '—',
    field_location: row.field_location || '—',
    approval_stage: row.approval_stage_label || statusLabel(row.approval_stage),
    status: statusLabel(row.status),
    decided_by: row.decided_by_name || row.last_decided_by_name || '—',
    decided_at: formatDateTime(row.decided_at || row.last_decided_at),
  }));

  const compOffRows = compOffs.slice(0, 8).map((row) => ({
    earned_date: formatDate(row.earned_date),
    valid_until: formatDate(row.valid_until),
    claimed_date: formatDate(row.claimed_date),
    holiday: row.holiday_title || '—',
    status: statusLabel(row.status),
  }));

    const leaveRows = myLeaveRows.map((row) => ({
      leave_type: leaveRequestTypeLabel(row),
      leave_days: row.leave_days ?? '—',
      deducted_from: deductedLeaveTypeLabel(row),
      lwp_days: lwpDaysLabel(row),
      from_date: formatDate(row.from_date),
      upto_date: formatDate(row.to_date || row.upto_date),
      reason: row.reason || '—',
      task_handover_to: row.task_handover_to_name || '—',
      project_handover: row.project_handover_name || '—',
      current_status: leaveLiveStatus(row),
      final_status: statusLabel(row.status),
    }));

  const notificationRows = (data?.notifications || []).map((row) => ({
    title: row.title || '—',
    body: row.body || '—',
    status: statusLabel(row.status),
    created_at: formatDateTime(row.created_at),
  }));

  const teamMemberRows = (data?.team_members || []).map((row) => ({
    name: row.name || '—',
    employee_id: row.employee_id || row.emp_code || '—',
    email: row.email || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    state: row.state || row.branch || '—',
    status: row.status || row.employment_status || '—',
  }));

  const reportingMemberRows = (data?.reporting_members || []).map((row) => ({
    name: row.name || '—',
    employee_id: row.employee_id || row.emp_code || '—',
    email: row.email || '—',
    department: row.department || '—',
    designation: row.designation || '—',
    is_team_leader: boolLabel(row.is_team_leader),
    state: row.state || row.branch || '—',
    status: row.status || row.employment_status || '—',
  }));

  const teamPendingModeRows = (
    data?.team_pending_attendance_mode_requests || []
  ).map((row) => ({
    employee_name: row.employee_name || '—',
    employee_id: row.employee_code || row.emp_code || row.employee_id || '—',
    mode: modeLabel(row.mode),
    date: row.date || '—',
    reason: row.reason || '—',
    field_location: row.field_location || '—',
    approval_stage: row.approval_stage_label || statusLabel(row.approval_stage),
    status: statusLabel(row.status),
  }));

  const myReviewRows = (data?.my_performance_reviews || data?.my_reviews || []).map((row) => ({
    period: row.week_label || row.month_label || row.year_label || row.cycle || 'Weekly',
    rating: row.rating_value ?? row.rating ?? row.score ?? '—',
    remarks: row.remarks || row.comments || row.note || '—',
    reviewer_name: row.reviewer_name || row.reviewer_employee_name || '—',
    reviewer_role: reviewerRoleLabel(row.reviewer_role),
    review_type: reviewTargetLabel(row.review_target_type),
    scope: row.review_scope_label || '—',
    status: statusLabel(row.status),
    review_date: formatDate(row.review_date || row.created_at),
  }));

  const reviewsGivenRows = (data?.reviews_given || data?.reviews_given_by_me || []).map((row) => ({
    employee_name: row.employee_name || row.target_employee_name || '—',
    employee_code: row.employee_code || '—',
    period: row.week_label || row.month_label || row.year_label || row.cycle || 'Weekly',
    rating: row.rating_value ?? row.rating ?? row.score ?? '—',
    review_type: reviewTargetLabel(row.review_target_type),
    scope: row.review_scope_label || '—',
    remarks: row.remarks || row.comments || row.note || '—',
    review_date: formatDate(row.review_date || row.created_at),
  }));

  const projectRows = myProjects.map((project) => ({
    project_name: projectName(project),
    status: statusLabel(project.status),
    department: project.department || '—',
    reporting_officer: project.reporting_officer_name || projectTeamTree(project).reporting_officer?.employee_name || '—',
    team_leader: project.team_leader_name || projectTeamTree(project).team_leader?.employee_name || '—',
    doing_person: projectDoingPeople(project).map((person) => personName(person)).filter(Boolean).join(', ') || '—',
    collaborators: projectCollaboratorPeople(project).map((person) => personName(person)).filter(Boolean).join(', ') || '—',
    progress: `${percentValue(project.latest_progress)}%`,
    last_update: project.latest_progress_date || '—',
    updated_by: project.latest_progress_by_name || '—',
  }));

  const teamProjectRows = teamLeaderProjects.map((project) => ({
    project_name: projectName(project),
    status: statusLabel(project.status),
    department: project.department || '—',
    reporting_officer: project.reporting_officer_name || projectTeamTree(project).reporting_officer?.employee_name || '—',
    assigned_members: projectAssignedPeople(project).map((member) => personName(member)).filter(Boolean).join(', ') || '—',
    collaborators: projectCollaboratorPeople(project).map((member) => personName(member)).filter(Boolean).join(', ') || '—',
    progress: `${percentValue(project.latest_progress)}%`,
    last_update: project.latest_progress_date || '—',
  }));

  const reportingProjectRows = reportingProjects.map((project) => ({
    project_name: projectName(project),
    status: statusLabel(project.status),
    department: project.department || '—',
    team_leader: project.team_leader_name || projectTeamTree(project).team_leader?.employee_name || '—',
    doing_person: projectDoingPeople(project).map((person) => personName(person)).filter(Boolean).join(', ') || '—',
    collaborators: projectCollaboratorPeople(project).map((person) => personName(person)).filter(Boolean).join(', ') || '—',
    progress: `${percentValue(project.latest_progress)}%`,
    last_update: project.latest_progress_date || '—',
  }));

  const teamLeaderPerformanceRows = (
    projectDashboard?.team_leader_performance ||
    projectDashboard?.reporting_team_leader_performance ||
    []
  ).map((row) => ({
    team_leader: row.team_leader_name || '—',
    department: row.department || '—',
    total_projects: row.total_projects || 0,
    active_projects: row.active_projects || 0,
    completed_projects: row.completed_projects || 0,
    completion_rate: `${row.completion_rate || 0}%`,
  }));

  const recentProjectProgressRows = (projectDashboard?.recent_progress || []).map((row) => ({
    project: row.project_name || '—',
    employee: row.employee_name || '—',
    progress: `${percentValue(row.progress_percent)}%`,
    note: row.note || row.description || '—',
    date: row.date || '—',
  }));

  const teamHierarchyTree = data?.team_hierarchy_tree || {
  self: employeeSummary,
  team_leader: isTeamLeader ? employeeSummary : {},
  reporting_officer: isReportingOfficer ? employeeSummary : {},
  team_members: data?.team_members || [],
  reporting_members: data?.reporting_members || [],
  all_people: [
    employeeSummary,
    ...(data?.team_members || []),
    ...(data?.reporting_members || []),
  ],
  connection_label: 'Reporting Officer → Team Leader → Team Members',
};
  const profilePhotoPerson = {
    ...employeeSummary,
    ...employee,
    name: displayName,
    employee_name: displayName,
  };
  const profilePhotoUrl = getProfilePhotoUrl(profilePhotoPerson);

  const todayStatus = statusLabel(todayAttendance?.status || 'Not checked-in');

  return (
    <div className="page-grid employee-dashboard-page">
      <style>{`
        .emp-project-dashboard,
        .emp-performance-dashboard {
          display: grid;
          gap: 18px;
        }

        .emp-leave-status-grid,
        .emp-performance-stat-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin: 14px 0 18px;
        }

        .emp-leave-status-card,
        .emp-performance-stat-card {
          border: 1px solid #e2e8f0;
          background: #ffffff;
          border-radius: 18px;
          padding: 14px;
          box-shadow: 0 10px 26px rgba(15, 23, 42, .05);
        }

        .emp-leave-status-card span,
        .emp-performance-stat-card span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .emp-leave-status-card strong,
        .emp-performance-stat-card strong {
          display: block;
          margin-top: 7px;
          color: #0f172a;
          font-size: 26px;
        }

        .emp-leave-note,
        .emp-performance-note {
          background: #f8fafc;
          border: 1px dashed #cbd5e1;
          color: #64748b;
          border-radius: 16px;
          padding: 12px;
          line-height: 1.5;
          font-size: 13px;
          margin-bottom: 14px;
        }

        .emp-project-hero,
        .emp-performance-hero {
          position: relative;
          overflow: hidden;
          border: 1px solid #e2e8f0;
          border-radius: 28px;
          padding: 22px;
          background:
            radial-gradient(circle at 12% 0%, rgba(79, 70, 229, .13), transparent 34%),
            radial-gradient(circle at 92% 10%, rgba(5, 150, 105, .12), transparent 34%),
            #ffffff;
          box-shadow: 0 18px 50px rgba(15, 23, 42, .08);
        }

        .emp-project-hero h3,
        .emp-performance-hero h3 {
          margin: 0;
          color: #0f172a;
          font-size: clamp(22px, 3vw, 32px);
          letter-spacing: -.04em;
        }

        .emp-project-hero p,
        .emp-performance-hero p {
          margin: 8px 0 0;
          color: #64748b;
          line-height: 1.65;
        }

        .emp-project-head-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: center;
        }

        .emp-project-ring {
          --ringValue: 0%;
          width: 136px;
          height: 136px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: conic-gradient(#4f46e5 var(--ringValue), #e2e8f0 0);
          box-shadow: 0 18px 42px rgba(79, 70, 229, .18);
        }

        .emp-project-ring > div {
          width: 100px;
          height: 100px;
          border-radius: 999px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          display: grid;
          place-items: center;
          align-content: center;
        }

        .emp-project-ring strong {
          color: #0f172a;
          font-size: 25px;
          line-height: 1;
        }

        .emp-project-ring span {
          margin-top: 5px;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          text-align: center;
        }

        .emp-project-access-card {
          border: 1px solid #cbd5e1;
          border-radius: 22px;
          background: #f8fafc;
          padding: 15px;
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: flex-start;
          margin-top: 18px;
        }

        .emp-project-access-card.can-create {
          border-color: #bbf7d0;
          background: #ecfdf5;
        }

        .emp-project-access-card span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .emp-project-access-card strong {
          display: block;
          margin-top: 5px;
          color: #0f172a;
          font-size: 16px;
        }

        .emp-project-access-card p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.5;
        }

        .emp-project-access-card em {
          border-radius: 999px;
          background: #eef2ff;
          color: #4338ca;
          padding: 7px 11px;
          font-style: normal;
          font-weight: 900;
          white-space: nowrap;
        }

        .emp-project-access-card.can-create em {
          color: #047857;
          background: #d1fae5;
        }

        .emp-project-stats,
        .emp-project-modern-stat-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-top: 18px;
        }

        .emp-project-stat,
        .emp-project-modern-stat {
          position: relative;
          overflow: hidden;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: #ffffff;
          padding: 16px;
          box-shadow: 0 12px 28px rgba(15, 23, 42, .06);
        }

        .emp-project-modern-stat::after {
          content: "";
          position: absolute;
          width: 72px;
          height: 72px;
          right: -28px;
          top: -26px;
          border-radius: 999px;
          background: rgba(79, 70, 229, .12);
        }

        .emp-project-modern-stat.green::after {
          background: rgba(5, 150, 105, .13);
        }

        .emp-project-modern-stat.amber::after {
          background: rgba(217, 119, 6, .14);
        }

        .emp-project-modern-stat.sky::after {
          background: rgba(2, 132, 199, .13);
        }

        .emp-project-stat span,
        .emp-project-modern-stat span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .emp-project-stat strong,
        .emp-project-modern-stat strong {
          display: block;
          margin-top: 8px;
          color: #0f172a;
          font-size: 28px;
          line-height: 1;
        }

        .emp-project-modern-stat small {
          display: block;
          margin-top: 7px;
          color: #64748b;
          font-weight: 750;
        }

        .emp-project-card-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .emp-project-card {
          border: 1px solid #e2e8f0;
          border-radius: 22px;
          padding: 16px;
          background: #ffffff;
          box-shadow: 0 12px 32px rgba(15, 23, 42, .07);
          transition: .2s ease;
        }

        .emp-project-card:hover {
          transform: translateY(-2px);
          border-color: #c7d2fe;
          box-shadow: 0 20px 52px rgba(15, 23, 42, .11);
        }

        .emp-project-card h4 {
          margin: 0;
          color: #0f172a;
          font-size: 16px;
        }

        .emp-project-card p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.5;
        }

        .emp-project-status {
          display: inline-flex;
          margin-top: 12px;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 900;
          color: #4338ca;
          background: #eef2ff;
        }

        .emp-project-status.active {
          color: #047857;
          background: #ecfdf5;
        }

        .emp-project-status.completed {
          color: #4338ca;
          background: #eef2ff;
        }

        .emp-project-status.on_hold {
          color: #92400e;
          background: #fffbeb;
        }

        .emp-project-mini-progress,
        .emp-rating-mini-progress {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          margin-top: 14px;
        }

        .emp-project-mini-progress-track,
        .emp-rating-mini-progress-track {
          height: 9px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .emp-project-mini-progress-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #4f46e5, #0284c7, #059669);
        }

        .emp-rating-mini-progress-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #d97706, #4f46e5, #059669);
        }

        .emp-project-mini-progress strong,
        .emp-rating-mini-progress strong {
          color: #0f172a;
          font-size: 13px;
        }

        .emp-project-chart {
          display: grid;
          gap: 10px;
        }

        .emp-project-bar-row {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr) 48px;
          gap: 10px;
          align-items: center;
        }

        .emp-project-bar-row span,
        .emp-project-bar-row strong {
          color: #334155;
          font-size: 12px;
          font-weight: 800;
        }

        .emp-project-bar-track {
          height: 12px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .emp-project-bar-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #4f46e5, #0284c7, #059669);
        }

        .emp-project-trend-grid {
          height: 250px;
          display: grid;
          grid-template-columns: repeat(10, minmax(0, 1fr));
          gap: 10px;
          align-items: end;
          margin-top: 12px;
          padding: 14px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
        }

        .emp-project-trend-item {
          min-width: 0;
          display: grid;
          gap: 5px;
          justify-items: center;
          align-items: end;
        }

        .emp-project-trend-bar {
          height: 142px;
          width: 100%;
          max-width: 28px;
          display: flex;
          align-items: end;
          border-radius: 999px;
          background: #e2e8f0;
          overflow: hidden;
        }

        .emp-project-trend-bar span {
          display: block;
          width: 100%;
          border-radius: 999px;
          background: linear-gradient(180deg, #4f46e5, #0284c7, #059669);
        }

        .emp-project-trend-item strong {
          color: #0f172a;
          font-size: 12px;
        }

        .emp-project-trend-item small,
        .emp-project-trend-item em {
          color: #64748b;
          font-size: 10px;
          font-weight: 900;
          font-style: normal;
        }

        .emp-project-rank-panel {
          overflow: hidden;
        }

        .emp-project-rank-list {
          display: grid;
          gap: 12px;
          margin-top: 14px;
        }

        .emp-project-rank-card {
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          background: #f8fafc;
          padding: 12px;
          transition: .2s ease;
        }

        .emp-project-rank-card:hover {
          transform: translateY(-2px);
          border-color: #c7d2fe;
          box-shadow: 0 16px 38px rgba(15, 23, 42, .08);
        }

        .emp-project-rank-no {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          color: #fff;
          background: linear-gradient(135deg, #4f46e5, #0284c7);
          font-weight: 900;
        }

        .emp-project-rank-main strong {
          display: block;
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .emp-project-rank-main span,
        .emp-project-rank-main small {
          display: block;
          margin-top: 3px;
          color: #64748b;
          font-size: 12px;
          line-height: 1.4;
        }

        .emp-project-rank-track {
          height: 9px;
          border-radius: 999px;
          overflow: hidden;
          background: #e2e8f0;
          margin-top: 9px;
        }

        .emp-project-rank-track div {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #4f46e5, #059669);
        }

        .emp-project-rank-score {
          color: #4f46e5;
          font-weight: 900;
          font-size: 16px;
        }

        .emp-performance-graph {
          display: grid;
          gap: 12px;
        }

        .emp-performance-row {
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          background: #ffffff;
          padding: 14px;
          box-shadow: 0 10px 26px rgba(15, 23, 42, .05);
        }

        .emp-performance-row-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: #0f172a;
          font-weight: 900;
        }

        .emp-performance-row-head span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .emp-performance-track {
          height: 11px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
          margin-top: 10px;
        }

        .emp-performance-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #4f46e5, #0284c7, #059669);
        }

        .emp-performance-row small {
          display: block;
          margin-top: 9px;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .emp-review-option-help {
          color: #64748b;
          font-size: 12px;
          margin-top: -4px;
        }

        .employee-hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
          gap: 22px;
          align-items: stretch;
        }

        .employee-identity-head {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 16px;
          align-items: center;
        }

        .employee-profile-avatar {
          width: 92px;
          height: 92px;
          border-radius: 28px;
          overflow: hidden;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          color: #4338ca;
          font-size: 28px;
          font-weight: 900;
          border: 4px solid #fff;
          box-shadow: 0 18px 42px rgba(15, 23, 42, .14);
        }

        .employee-profile-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .emp-avatar {
          overflow: hidden;
          border-radius: 999px;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          border: 2px solid #ffffff;
          box-shadow: 0 10px 24px rgba(15, 23, 42, .10);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #4338ca;
          font-weight: 900;
          flex: 0 0 auto;
        }

        .emp-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .emp-avatar-xs { width: 30px; height: 30px; font-size: 10px; }
        .emp-avatar-sm { width: 38px; height: 38px; font-size: 12px; }
        .emp-avatar-md { width: 48px; height: 48px; font-size: 14px; }

        .emp-person-chip {
          min-width: 0;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
        }

        .emp-person-chip strong {
          display: block;
          color: #0f172a;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .emp-person-chip span {
          display: block;
          color: #4338ca;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .04em;
        }

        .emp-person-chip small {
          display: block;
          margin-top: 2px;
          color: #64748b;
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .emp-avatar-stack {
          display: flex;
          align-items: center;
          min-width: 0;
        }

        .emp-avatar-stack-item { margin-left: -8px; }
        .emp-avatar-stack-item:first-child { margin-left: 0; }

        .emp-avatar-more {
          min-width: 30px;
          height: 30px;
          margin-left: -8px;
          border-radius: 999px;
          background: #0f172a;
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #fff;
          font-size: 11px;
          font-weight: 900;
        }

        .emp-avatar-empty {
          color: #94a3b8;
          font-size: 12px;
          font-weight: 800;
        }

        .emp-project-card-top {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: flex-start;
        }

        .emp-project-people-line {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          border-radius: 16px;
          padding: 10px;
        }

        .emp-project-people-line > div {
          min-width: 0;
        }

        .emp-project-people-line span {
          display: block;
          margin-bottom: 7px;
          color: #64748b;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .emp-project-people-line small {
          color: #94a3b8;
          font-size: 12px;
          font-weight: 800;
        }

        .emp-root-map-panel {
          position: relative;
          overflow: hidden;
          border: 1px solid #dbe4ff;
          border-radius: 30px;
          background:
            radial-gradient(circle at 50% 0%, rgba(79,70,229,.13), transparent 34%),
            radial-gradient(circle at 0% 100%, rgba(5,150,105,.10), transparent 30%),
            linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          padding: 22px;
          display: grid;
          gap: 18px;
          box-shadow: 0 18px 50px rgba(15,23,42,.08);
        }

        .emp-root-map-bg {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(79,70,229,.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(79,70,229,.06) 1px, transparent 1px);
          background-size: 24px 24px;
          mask-image: radial-gradient(circle at 50% 38%, black, transparent 76%);
          pointer-events: none;
        }

        .emp-root-map-panel > *:not(.emp-root-map-bg) {
          position: relative;
          z-index: 1;
        }

        .emp-root-map-head {
          text-align: center;
        }

        .emp-root-map-head span {
          display: inline-flex;
          border-radius: 999px;
          padding: 6px 10px;
          background: #eef2ff;
          color: #4338ca;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .07em;
        }

        .emp-root-map-head h3 {
          margin: 8px 0 0;
          color: #0f172a;
          font-size: clamp(22px, 3vw, 30px);
          letter-spacing: -.04em;
        }

        .emp-root-map-head p {
          margin: 6px 0 0;
          color: #64748b;
          font-weight: 700;
        }

        .emp-root-map-stage {
          display: grid;
          gap: 14px;
        }

        .emp-root-node {
          max-width: 380px;
          margin: 0 auto;
          border: 1px solid #e2e8f0;
          border-radius: 22px;
          background: rgba(255,255,255,.94);
          padding: 13px;
          box-shadow: 0 14px 34px rgba(15,23,42,.08);
        }

        .ro-node { border-color: #c7d2fe; }
        .tl-node { border-color: #bbf7d0; }

        .emp-root-line {
          width: 2px;
          height: 30px;
          margin: -4px auto;
          background: linear-gradient(#4f46e5, #059669);
          border-radius: 999px;
        }

        .emp-root-branches {
          position: relative;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .emp-root-branches::before {
          content: "";
          position: absolute;
          top: -12px;
          left: 25%;
          right: 25%;
          height: 2px;
          background: linear-gradient(90deg, #4f46e5, #059669);
          border-radius: 999px;
        }

        .emp-root-branch {
          border: 1px solid #e2e8f0;
          border-radius: 22px;
          background: rgba(255,255,255,.92);
          padding: 14px;
          display: grid;
          gap: 12px;
        }

        .emp-root-branch-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border-radius: 16px;
          background: #ecfdf5;
          color: #047857;
          padding: 10px 12px;
        }

        .emp-root-branch.reporting .emp-root-branch-title {
          background: #eef2ff;
          color: #4338ca;
        }

        .emp-root-branch-title span {
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .05em;
        }

        .emp-root-branch-title strong {
          width: 28px;
          height: 28px;
          display: inline-grid;
          place-items: center;
          border-radius: 999px;
          background: #fff;
          color: inherit;
        }

        .emp-root-people-list {
          display: grid;
          gap: 10px;
        }

        .emp-root-empty {
          border: 1px dashed #cbd5e1;
          border-radius: 16px;
          color: #64748b;
          background: #f8fafc;
          padding: 12px;
          text-align: center;
          font-size: 12px;
          font-weight: 800;
        }

        .emp-root-map-foot {
          display: grid;
          grid-template-columns: auto auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          justify-content: center;
          border-top: 1px solid #e2e8f0;
          padding-top: 14px;
        }

        .emp-root-map-foot span {
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .emp-root-map-foot strong {
          color: #0f172a;
          font-size: 18px;
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

          .emp-project-stats,
          .emp-project-modern-stat-grid,
          .emp-project-card-grid,
          .emp-leave-status-grid,
          .emp-performance-stat-grid,
          .emp-project-people-line {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 640px) {
          .emp-project-stats,
          .emp-project-modern-stat-grid,
          .emp-project-card-grid,
          .emp-leave-status-grid,
          .emp-performance-stat-grid,
          .emp-project-people-line,
          .emp-root-branches {
            grid-template-columns: 1fr;
          }

          .employee-identity-head {
            grid-template-columns: 1fr;
          }

          .employee-profile-avatar {
            width: 78px;
            height: 78px;
            border-radius: 22px;
          }

          .emp-root-branches::before {
            display: none;
          }

          .emp-root-map-foot {
            grid-template-columns: 1fr;
            justify-items: start;
          }

          .emp-project-hero,
          .emp-performance-hero {
            border-radius: 20px;
            padding: 16px;
          }

          .emp-project-access-card {
            flex-direction: column;
          }

          .emp-project-trend-grid {
            overflow-x: auto;
            grid-template-columns: repeat(10, 42px);
          }

          .emp-project-rank-card {
            grid-template-columns: 34px minmax(0, 1fr);
          }

          .emp-project-rank-score {
            grid-column: 2;
          }
        }
      `}</style>

      <section className="hero employee-hero">
        <div className="employee-identity">
          <div className="employee-identity-head">
            <div className="employee-profile-avatar">
              {profilePhotoUrl ? (
                <img src={profilePhotoUrl} alt={displayName} />
              ) : (
                <span>{getInitials(displayName)}</span>
              )}
            </div>

            <div>
              <span className="kicker">Employee Self Service</span>

              <h1 className="employee-name-heading dashboard-display-name">
                {displayName}
              </h1>

              <p className="employee-dashboard-subtitle">
                Employee dashboard for attendance, leave, profile, tickets,
                notifications, assigned approval responsibilities, performance, and
                project progress.
              </p>
            </div>
          </div>

          <div className="employee-badges">
            <span className="employee-badge primary-cap">
              Dashboard: {dashboardRole}
            </span>

            <span className="employee-badge success-cap">
              Capability: {mappedCapabilityLabel}
            </span>

            <span className="employee-badge neutral-cap">
              Department:{' '}
              {displayValue(employeeSummary.department || employee.department)}
            </span>
          </div>

          {holiday?.is_holiday && (
            <div className="holiday-banner">
              <div className="holiday-icon">🎉</div>

              <div>
                <strong>{holiday.title || 'Holiday'}</strong>
                <p>
                  {holiday.message ||
                    'Today is marked as a holiday for your state.'}
                </p>
              </div>
            </div>
          )}

          <div className="hero-actions">
            <button type="button" className="primary" onClick={() => goTo('attendance')}>
              Attendance
            </button>

            <button type="button" className="secondary" onClick={() => goTo('leave_requests')}>
              Apply Leave
            </button>

            <button type="button" className="secondary" onClick={() => goTo('projects')}>
              Projects
            </button>

            <button type="button" className="secondary" onClick={() => goTo('tickets')}>
              Raise Ticket
            </button>

            <button type="button" className="secondary" onClick={() => goTo('profile')}>
              My Profile
            </button>

            <button type="button" className="secondary" onClick={loadDashboard} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <AttendanceWidget onSuccess={loadDashboard} />
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="stats-grid">
        <Stat label="Dashboard" value={dashboardRole} />
        <Stat label="Today Status" value={todayStatus} />
        <Stat label="Attendance Mode" value={modeLabel(todayAttendance?.mode || 'office')} />
        <Stat label="Available Modes" value={availableModes.map(modeLabel).join(', ')} />
        <Stat label="Available Leave" value={totalAvailableLeave} />
        <Stat label="Used / Deducted Leave" value={totalUsedLeave} />
        <Stat label="Available Comp-Off" value={availableCompOffs.length} />
        <Stat label="Pending WFH/Field" value={pendingModeRequests.length} />
        <Stat label="Active Projects" value={myActiveProjectCount} />
        <Stat label="Completed Projects" value={myCompletedProjectCount} />
        <Stat label="Team Members" value={data?.team_members?.length || 0} />
        <Stat label="Reporting Members" value={data?.reporting_members?.length || 0} />
        <Stat label="Pending Leave Approvals" value={pendingApprovalLeaves.length || approvalCounts.leave_requests || 0} />
        <Stat label="Pending WFH/Field Approvals" value={approvalCounts.attendance_mode_requests || 0} />

        {loading && (
          <div className="panel">
            <p>Loading dashboard...</p>
          </div>
        )}

        {!loading && !message && !data && (
          <div className="panel">
            <p>No dashboard data available.</p>
          </div>
        )}
      </section>

      <section className="emp-performance-dashboard">
        <div className="emp-performance-hero">
          <div className="toolbar">
            <div>
              <span className="kicker">Performance Analytics</span>
              <h3>Team Performance & Ratings</h3>
              <p>
                This dashboard now shows performance analytics only. Weekly ratings are submitted from the dedicated Performance page.
                Monthly and yearly views are generated automatically from weekly review records.
              </p>
            </div>
          </div>

          <div className="emp-performance-stat-grid">
            <div className="emp-performance-stat-card">
              <span>My Avg Rating</span>
              <strong>{numberValue(averageMyRating, 0).toFixed(1)}/5</strong>
              <RatingBar value={averageMyRating} />
            </div>

            <div className="emp-performance-stat-card">
              <span>Reviews Received</span>
              <strong>{data?.my_performance_reviews?.length || performanceSummary?.my_review_count || 0}</strong>
            </div>

            <div className="emp-performance-stat-card">
              <span>Reviews Given</span>
              <strong>{data?.reviews_given?.length || performanceSummary?.reviews_given_count || 0}</strong>
            </div>

            <div className="emp-performance-stat-card">
              <span>Reviewable Employees</span>
              <strong>{reviewableEmployees.length}</strong>
            </div>
          </div>

          <div className="emp-performance-note">
            Team Leader → Team Member and Reporting Officer → Team Leader ratings are separated, so every employee gets the correct graph and history.
          </div>
        </div>

        <section className="two-col">
          <PerformanceGraph
            title="My Received Performance"
            description="Ratings received from Team Leader, Reporting Officer, or HR/Admin."
            rows={performanceRows(myPerformanceChart).length ? myPerformanceChart : data?.my_performance_reviews || data?.my_reviews || []}
            emptyText="No received performance review yet."
          />

          <PerformanceGraph
            title="Reviews Given By Me"
            description="Ratings you have submitted for mapped employees."
            rows={data?.reviews_given || []}
            emptyText="No performance review submitted yet."
          />
        </section>

        <section className="three-col">
          <PerformanceGraph
            title="Weekly 3D Performance"
            description="Current weekly graph generated from submitted ratings."
            rows={weeklyPerformanceChart}
            emptyText="No weekly performance data yet."
          />

          <PerformanceGraph
            title="Monthly Performance"
            description="Auto-generated monthly performance from weekly reviews."
            rows={monthlyPerformanceChart}
            emptyText="No monthly performance data yet."
          />

          <PerformanceGraph
            title="Yearly Performance"
            description="Auto-generated yearly performance from weekly reviews."
            rows={yearlyPerformanceChart}
            emptyText="No yearly performance data yet."
          />
        </section>

        {(isTeamLeader || isReportingOfficer) && (
          <section className="two-col">
            {isTeamLeader && (
              <PerformanceGraph
                title="Team Member Performance Graph"
                description={`Average Team Member Rating: ${numberValue(averageTeamRating, 0).toFixed(1)}/5`}
                rows={teamLeaderReviewGraph}
                emptyText="No team member performance graph data yet."
              />
            )}

            {isReportingOfficer && (
              <PerformanceGraph
                title="Reporting Officer Performance Graph"
                description={`Average Reporting Rating: ${numberValue(averageReportingRating, 0).toFixed(1)}/5`}
                rows={reportingOfficerReviewGraph}
                emptyText="No reporting officer performance graph data yet."
              />
            )}
          </section>
        )}
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>My Leave Balance</h3>
              <p>
                Leave balance is credited by HR/Admin and deducted automatically
                after final approval.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('leave_requests')}>
              Apply Leave
            </button>
          </div>

          <div className="emp-leave-status-grid">
            <div className="emp-leave-status-card">
              <span>CL Available</span>
              <strong>{casualBalance.available ?? 0}</strong>
            </div>

            <div className="emp-leave-status-card">
              <span>CL Used</span>
              <strong>{casualBalance.used ?? 0}</strong>
            </div>

            <div className="emp-leave-status-card">
              <span>EL Available</span>
              <strong>{earnedBalance.available ?? 0}</strong>
            </div>

            <div className="emp-leave-status-card">
              <span>EL Used</span>
              <strong>{earnedBalance.used ?? 0}</strong>
            </div>
          </div>

        <div className="emp-leave-note">
          When you apply for leave, it first goes to your Team Leader. If no
          Team Leader is mapped, it goes directly to your Reporting Officer.
          Balance is deducted only after final approval. Half Day is deducted
          from CL first, then EL, and becomes LWP if both balances are exhausted.
        </div>

          <Table rows={leaveBalanceRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>My Leave Request Status</h3>
              <p>
                Track live status: Pending with Team Leader, Pending with
                Reporting Officer, Approved, or Rejected.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('leave_requests')}>
              Open Leave Management
            </button>

            {isMappedApprover && (
              <button type="button" className="secondary" onClick={() => goTo('team_approvals')}>
                Team Approvals
              </button>
            )}
          </div>

          <Table rows={leaveRows} maxColumns={8} />
        </div>
      </section>

      {isMappedApprover && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending Leave Approvals</h3>
              <p>
                Shows leave requests currently waiting at your approval stage.
                After Team Leader approval, the request moves to Reporting
                Officer. After final approval, the employee receives notification
                and leave balance is deducted.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('team_approvals')}>
              Open Team Approvals
            </button>
          </div>

          <LeaveApprovalTable
            rows={pendingApprovalLeaves}
            saving={leaveDecisionSaving}
            onDecision={decideLeave}
          />
        </section>
      )}

      <section className="emp-project-dashboard">
        <div className="emp-project-hero">
          <div className="emp-project-head-grid">
            <div>
              <span className="kicker">Project Progress</span>
              <h3>My Projects & Daily Progress</h3>
              <p>
                Team Leaders and Reporting Officers can create projects, assign team members,
                assign projects to themselves, and add collaborators. Employees can view scoped projects and update status/progress
                only when assigned or added as collaborators.
              </p>
            </div>

            <ProjectProgressRing value={myProjectAverage} label="My Avg Progress" />
          </div>

          <ProjectAccessCard
            isTeamLeader={isTeamLeader}
            isReportingOfficer={isReportingOfficer}
          />

          <div className="emp-project-modern-stat-grid">
                <ProjectMetricCard
                  label="My Projects"
                  value={myProjectCount}
                  meta="Assigned or collaborated"
                />

                <ProjectMetricCard
                  label="My Active"
                  value={myActiveProjectCount}
                  meta="Open for progress"
                  variant="green"
                />

                <ProjectMetricCard
                  label="My Completed"
                  value={myCompletedProjectCount}
                  meta="Closed projects"
                  variant="sky"
                />

            <ProjectMetricCard
              label="Average Progress"
              value={`${myProjectAverage || 0}%`}
              meta="My scoped project average"
              variant="amber"
            />
          </div>

          <div className="hero-actions" style={{ marginTop: 16 }}>
            <button type="button" className="primary" onClick={() => goTo('projects')}>
              {canCreateOrAssignProjects ? 'Create / Manage Projects' : 'Open My Projects'}
            </button>
          </div>
        </div>

        <TeamHierarchyMap
          tree={teamHierarchyTree}
          title={isReportingOfficer ? 'Reporting Officer Team Root Map' : isTeamLeader ? 'Team Leader Root Map' : 'My Team Root Map'}
        />

        <ProjectMiniBoard
          title="Active Projects"
          description="No active projects assigned yet."
          projects={activeProjects}
          emptyText="No active projects assigned yet."
        />

        <section className="two-col">
          <ProjectTrendGraph title="My Daily Project Progress" rows={projectDailyChart} />
          <ProjectRankingGraph title="My Project Progress Ranking" rows={myProjects} />
        </section>

        {isTeamLeader && (
          <>
            <section className="panel">
              <div className="toolbar">
                <div>
                  <h3>Team Leader Project View</h3>
                  <p>
                    Projects created or managed by you as Team Leader, including
                    assigned members and collaborators.
                  </p>
                </div>

                <button type="button" className="secondary" onClick={() => goTo('projects')}>
                  Manage Projects
                </button>
              </div>

              <div className="emp-project-modern-stat-grid">
                <ProjectMetricCard label="Team Projects" value={teamProjectCount} meta="Created/managed by you" />
                <ProjectMetricCard label="Team Active" value={teamActiveProjectCount} meta="Currently running" variant="green" />
                <ProjectMetricCard label="Team Completed" value={teamCompletedProjectCount} meta="Closed projects" variant="sky" />
                <ProjectMetricCard label="Team Avg Progress" value={`${teamProjectAverage || 0}%`} meta="Team project average" variant="amber" />
              </div>

              <Table rows={teamProjectRows} maxColumns={8} />
            </section>

            <section className="two-col">
              <ProjectTrendGraph title="Team Project Progress Graph" rows={teamProjectDailyChart} />
              <ProjectRankingGraph title="Team Project Ranking" rows={teamLeaderProjects} />
            </section>
          </>
        )}

        {isReportingOfficer && (
          <>
            <section className="panel">
              <div className="toolbar">
                <div>
                  <h3>Reporting Officer Project View</h3>
                  <p>
                    Department/team-wise progress for Team Leaders mapped under
                    your Reporting Officer assignment.
                  </p>
                </div>

                <button type="button" className="secondary" onClick={() => goTo('projects')}>
                  Open Projects
                </button>
              </div>

              <div className="emp-project-modern-stat-grid">
                <ProjectMetricCard label="Reporting Projects" value={reportingProjectCount} meta="Reporting scope" />
                <ProjectMetricCard label="Reporting Active" value={reportingActiveProjectCount} meta="Currently running" variant="green" />
                <ProjectMetricCard label="Reporting Completed" value={reportingCompletedProjectCount} meta="Closed projects" variant="sky" />
                <ProjectMetricCard label="Reporting Avg Progress" value={`${reportingProjectAverage || 0}%`} meta="Reporting project average" variant="amber" />
              </div>

              <Table rows={reportingProjectRows} maxColumns={8} />
            </section>

            <section className="two-col">
              <ProjectTrendGraph title="Reporting Team Project Progress Graph" rows={reportingProjectDailyChart} />
              <ProjectRankingGraph title="Reporting Project Ranking" rows={reportingProjects} />
            </section>

            <section className="panel">
              <h3>Team Leader Performance Under Reporting Officer</h3>
              <Table rows={teamLeaderPerformanceRows} maxColumns={8} />
            </section>
          </>
        )}

        <section className="two-col">
          <div className="panel">
            <h3>My Project Records</h3>
            <Table rows={projectRows} maxColumns={8} />
          </div>

          <div className="panel">
            <h3>Recent Project Progress Updates</h3>
            <Table rows={recentProjectProgressRows} maxColumns={8} />
          </div>
        </section>
      </section>

      {isMappedApprover && (
        <section className="capability-panel">
          <div className="capability-card">
            <span>Mapped as Team Leader</span>
            <strong>{data?.is_team_leader ? 'Yes' : 'No'}</strong>
          </div>

          <div className="capability-card">
            <span>Mapped as Reporting Officer</span>
            <strong>{data?.is_reporting_officer ? 'Yes' : 'No'}</strong>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Today&apos;s Attendance & Holiday Status</h3>
            <p>
              This section reflects your current day attendance, approved mode,
              late/early status, and state-wise holiday message.
            </p>
          </div>

          <button type="button" className="secondary" onClick={() => goTo('attendance')}>
            Open Attendance
          </button>
        </div>

        <div className="attendance-summary">
          <div>
            <span>Status</span>
            <strong>{todayStatus}</strong>
          </div>

          <div>
            <span>Mode</span>
            <strong>{modeLabel(todayAttendance?.mode || 'office')}</strong>
          </div>

          <div>
            <span>Check In</span>
            <strong>{formatTime(todayAttendance?.check_in)}</strong>
          </div>

          <div>
            <span>Check Out</span>
            <strong>{formatTime(todayAttendance?.check_out)}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>My Employee Profile Summary</h3>
            <p>Key employment details from Employee Master.</p>
          </div>

          <button type="button" className="secondary" onClick={() => goTo('profile')}>
            View Full Profile
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <tbody>
              {profileRows.map((row) => (
                <tr key={row.field}>
                  <th>{row.field}</th>
                  <td>{displayValue(row.value)}</td>
                </tr>
              ))}

              <tr>
                <th>Is Team Leader</th>
                <td>{boolLabel(employee.is_team_leader || data?.is_team_leader)}</td>
              </tr>

              <tr>
                <th>Is Reporting Officer</th>
                <td>{boolLabel(employee.is_reporting_officer || data?.is_reporting_officer)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>WFH / Field Requests</h3>
              <p>
                Approved requests unlock WFH or Field check-in on the selected
                date.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('attendance')}>
              Request WFH / Field
            </button>
          </div>

          <Table rows={modeRequestRows} maxColumns={8} />
        </div>

        <div className="panel">
          <div className="toolbar">
            <div>
              <h3>My Comp-Off</h3>
              <p>
                If you work on a holiday, one compensatory off is generated and
                can be claimed for one day.
              </p>
            </div>
          </div>

          {availableCompOffs.length > 0 && (
            <form className="dynamic-form" onSubmit={submitCompOffClaim}>
              <label>
                Available Comp-Off
                <select
                  value={claimForm.compoff_id}
                  onChange={(event) =>
                    setClaimForm({
                      ...claimForm,
                      compoff_id: event.target.value,
                    })
                  }
                  disabled={claimingCompOff}
                >
                  <option value="">Select comp-off</option>

                  {availableCompOffs.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.earned_date} — {item.holiday_title || 'Holiday Work'}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Claim Date
                <input
                  type="date"
                  value={claimForm.claim_date}
                  onChange={(event) =>
                    setClaimForm({
                      ...claimForm,
                      claim_date: event.target.value,
                    })
                  }
                  disabled={claimingCompOff}
                />
              </label>

              <label>
                Reason
                <input
                  value={claimForm.reason}
                  placeholder="Reason / note"
                  onChange={(event) =>
                    setClaimForm({
                      ...claimForm,
                      reason: event.target.value,
                    })
                  }
                  disabled={claimingCompOff}
                />
              </label>

              <button type="submit" className="primary" disabled={claimingCompOff}>
                {claimingCompOff ? 'Submitting...' : 'Claim Comp-Off'}
              </button>
            </form>
          )}

          <Table rows={compOffRows} maxColumns={8} />
        </div>
      </section>

      {isMappedApprover && (
        <section className="panel emp-performance-cta-panel">
          <div className="toolbar">
            <div>
              <span className="kicker">Dedicated Performance Page</span>
              <h3>Submit Weekly Performance Rating</h3>
              <p>
                The rating form has been moved from dashboard to the Performance page.
                Team Leaders can rate mapped team members, and Reporting Officers can rate mapped Team Leaders/reporting members there.
              </p>
            </div>

            <button type="button" className="primary" onClick={() => goTo('performance_reviews')}>
              Open Performance Page
            </button>
          </div>
        </section>
      )}

      {isMappedApprover && (
        <section className="two-col">
          <div className="panel">
            <h3>Employees Under My Team Leader Mapping</h3>
            <Table rows={teamMemberRows} maxColumns={8} />
          </div>

          <div className="panel">
            <h3>Employees Under My Reporting Officer Mapping</h3>
            <Table rows={reportingMemberRows} maxColumns={8} />
          </div>
        </section>
      )}

      {isMappedApprover && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>Pending WFH / Field Approvals</h3>
              <p>
                Shows only WFH / Field requests currently pending at your
                mapped approval stage.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => goTo('attendance')}>
              Open Attendance
            </button>
          </div>

          <Table rows={teamPendingModeRows} maxColumns={8} />
        </section>
      )}

      <section className="two-col">
        <div className="panel">
          <h3>My Performance Reviews</h3>
          <p>This is visible to the employee, HR, and Super Admin.</p>
          <Table rows={myReviewRows} maxColumns={9} />
        </div>

        <div className="panel">
          <h3>Reviews Given By Me</h3>
          <p>Ratings submitted by you for mapped employees.</p>
          <Table rows={reviewsGivenRows} maxColumns={9} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>My Tickets</h3>
          <Table rows={data?.tickets || []} maxColumns={8} />
        </div>

        <div className="panel">
          <h3>My Notifications</h3>
          <Table rows={notificationRows} maxColumns={8} />
        </div>
      </section>
    </div>
  );
}