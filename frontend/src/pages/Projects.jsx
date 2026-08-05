import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  RefreshCcw,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import {
  addProjectProgress,
  assignProject,
  updateProjectCollaborators,
  createProject,
  currentEmployee,
  currentUser,
  getEmployeeDashboard,
  getInitials,
  getProfilePhotoUrl,
  getProjectOptions,
  getProjects,
  listCollection,
  normalizePeopleList,
  normalizeProjectTeamTree,
  updateProjectStatus,
} from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.employees)) return value.employees;
  if (Array.isArray(value?.assignable_employees)) return value.assignable_employees;
  return [];
}

function getId(item = {}) {
  return (
    item._id ||
    item.id ||
    item.employee_id ||
    item.employee_ref_id ||
    item.user_id ||
    ''
  );
}

function getName(item = {}) {
  return (
    item.name ||
    item.employee_name ||
    item.display_name ||
    item.project_name ||
    item.title ||
    item.email ||
    'Unnamed'
  );
}

function normalizeRoleValue(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function normalizeRoles(user = {}) {
  const roles = user.roles;

  if (Array.isArray(roles)) {
    return roles.map((role) => normalizeRoleValue(role)).filter(Boolean);
  }

  if (typeof roles === 'string') {
    return roles
      .split(',')
      .map((role) => normalizeRoleValue(role))
      .filter(Boolean);
  }

  return [];
}

function isTruthy(value) {
  return ['true', 'yes', '1', 'on'].includes(String(value || '').toLowerCase());
}

function isTeamLeaderOrReportingOfficer(user = {}, dashboardData = null) {
  const roles = normalizeRoles(user);
  const employee = dashboardData?.employee || dashboardData?.employee_summary || currentEmployee() || {};

  const hasRoleCapability = roles.some((role) =>
    ['team_leader', 'reporting_officer', 'ro', 'manager'].includes(role),
  );

  const hasEmployeeCapability =
    isTruthy(employee?.is_team_leader || dashboardData?.is_team_leader) ||
    isTruthy(employee?.is_reporting_officer || dashboardData?.is_reporting_officer);

  return hasRoleCapability || hasEmployeeCapability;
}

function isAdminUser(user = {}) {
  const roles = normalizeRoles(user);

  return roles.some((role) => ['super_admin', 'admin'].includes(role));
}

function sameDepartment(employee = {}, department = '') {
  if (!department) return false;

  return String(employee.department || '').trim().toLowerCase() ===
    String(department || '').trim().toLowerCase();
}

function filterEmployeesByDepartment(items = [], department = '') {
  const selectedDepartment = String(department || '').trim().toLowerCase();

  if (!selectedDepartment) {
    return [];
  }

  return items.filter((employee) =>
    String(employee.department || '').trim().toLowerCase() === selectedDepartment,
  );
}

function uniqueEmployees(items = []) {
  const map = new Map();

  items.forEach((item) => {
    const id = String(getId(item));

    if (id && !map.has(id)) {
      map.set(id, item);
    }
  });

  return Array.from(map.values());
}

function normalizeEmployeeOption(item = {}) {
  const id = String(getId(item));

  if (!id) return null;

  return {
    ...item,
    _id: item._id || id,
    id,
    employee_id: item.employee_id || item.emp_code || item.employee_code || '',
    employee_ref_id: item.employee_ref_id || id,
    name: getName(item),
    employee_name: item.employee_name || getName(item),
    department: item.department || '',
    designation: item.designation || '',
  };
}

function getCurrentEmployeeOption(user = {}, dashboardData = null, optionsData = null) {
  const storedEmployee = currentEmployee() || {};
  const employee =
    optionsData?.current_employee ||
    dashboardData?.employee ||
    dashboardData?.employee_summary ||
    user.employee ||
    user.employee_summary ||
    user.employee_profile ||
    storedEmployee ||
    {};

  const id = String(
    employee._id ||
      employee.employee_ref_id ||
      employee.employee_id_for_edit ||
      user.employee_ref_id ||
      user.employee_id ||
      '',
  );

  if (!id && !employee.name && !user.name) {
    return null;
  }

  return normalizeEmployeeOption({
    ...employee,
    _id: id || employee._id,
    id: id || employee.id,
    name: employee.name || employee.employee_name || user.name || user.email || 'Current Employee',
    employee_name: employee.employee_name || employee.name || user.name || user.email || 'Current Employee',
    email: employee.email || user.email || '',
    department: employee.department || user.department || '',
    designation: employee.designation || user.designation || '',
    avatar: employee.avatar || user.avatar || '',
    profile_photo: employee.profile_photo || user.profile_photo || '',
    profile_picture: employee.profile_picture || user.profile_picture || '',
    photo: employee.photo || user.photo || '',
    is_current_user: true,
  });
}

function buildScopedProjectEmployees(allEmployees = [], dashboardData = null, user = {}, optionsData = null) {
  const employee = dashboardData?.employee || dashboardData?.employee_summary || currentEmployee() || {};
  const employeeDepartment = employee.department || '';

  const optionEmployees = uniqueEmployees([
    ...(optionsData?.assignable_employees || []),
    ...(optionsData?.assigned_member_options || []),
    ...(optionsData?.collaborator_options || []),
  ])
    .map(normalizeEmployeeOption)
    .filter(Boolean);

  const currentEmployeeOption = getCurrentEmployeeOption(user, dashboardData, optionsData);

  if (optionEmployees.length) {
    return uniqueEmployees([
      currentEmployeeOption,
      ...optionEmployees,
    ].filter(Boolean));
  }

  const teamMembers = dashboardData?.team_members || [];
  const reportingMembers = dashboardData?.reporting_members || [];

  const scopedMembers = uniqueEmployees([
    currentEmployeeOption,
    ...teamMembers,
    ...reportingMembers,
  ].filter(Boolean));

  if (scopedMembers.length) {
    return scopedMembers
      .map(normalizeEmployeeOption)
      .filter(Boolean)
      .filter((member) =>
        member.is_current_user ||
        !employeeDepartment ||
        sameDepartment(member, employeeDepartment),
      );
  }

  return uniqueEmployees([
    currentEmployeeOption,
    ...allEmployees.filter((member) => sameDepartment(member, employeeDepartment)),
  ].filter(Boolean))
    .map(normalizeEmployeeOption)
    .filter(Boolean);
}

function normalizeStatus(status) {
  const value = String(status || '').toLowerCase();

  if (['completed', 'complete', 'done', 'closed'].includes(value)) return 'completed';
  if (['on_hold', 'on-hold', 'hold'].includes(value)) return 'on_hold';

  return 'active';
}

function statusLabel(status) {
  const value = normalizeStatus(status);

  if (value === 'completed') return 'Completed';
  if (value === 'on_hold') return 'On Hold';

  return 'Active';
}

function relationLabel(relation) {
  const value = String(relation || '').toLowerCase();

  if (value === 'reporting_officer') return 'Reporting Officer';
  if (value === 'team_leader') return 'Team Leader';
  if (value === 'assigned_member') return 'Doing Project';
  if (value === 'collaborator') return 'Collaborator';
  if (value === 'latest_progress_by') return 'Last Updated By';

  return 'Team Member';
}

function formatDate(value) {
  if (!value) return '—';

  try {
    if (typeof value === 'string') {
      return value.slice(0, 10);
    }

    return new Date(value).toLocaleDateString();
  } catch {
    return '—';
  }
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function percentValue(value) {
  return Math.min(Math.max(numberValue(value, 0), 0), 100);
}

function averageProgress(projects = []) {
  if (!projects.length) return 0;

  const total = projects.reduce(
    (sum, project) => sum + percentValue(project.latest_progress || project.progress_percent || project.progress),
    0,
  );

  return Math.round(total / projects.length);
}

function projectEmployeeNames(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return 'No members mapped';
  }

  return items
    .map((item) => item.employee_name || item.name || item.email)
    .filter(Boolean)
    .join(', ') || 'No members mapped';
}

function normalizePeople(value = []) {
  return normalizePeopleList(Array.isArray(value) ? value : []);
}

function getProjectTree(project = {}) {
  const existingTree = normalizeProjectTeamTree(project.project_team_tree || {});

  const directReportingOfficer = project.reporting_officer || existingTree.reporting_officer || {};
  const directTeamLeader = project.team_leader || existingTree.team_leader || {};
  const directAssignedMembers = normalizePeople(
    project.assigned_members?.length
      ? project.assigned_members
      : existingTree.assigned_members || [],
  );
  const directCollaborators = normalizePeople(
    project.collaborators?.length
      ? project.collaborators
      : existingTree.collaborators || [],
  );
  const directDoingPeople = normalizePeople(
    project.doing_people?.length
      ? project.doing_people
      : existingTree.doing_people?.length
        ? existingTree.doing_people
        : directAssignedMembers,
  );

  const allPeople = normalizePeople([
    directReportingOfficer,
    directTeamLeader,
    ...directAssignedMembers,
    ...directCollaborators,
    ...(project.latest_progress_person ? [project.latest_progress_person] : []),
  ].filter((person) => person && (getId(person) || getName(person) !== 'Unnamed')));

  return normalizeProjectTeamTree({
    ...existingTree,
    reporting_officer: directReportingOfficer,
    team_leader: directTeamLeader,
    assigned_members: directAssignedMembers,
    collaborators: directCollaborators,
    doing_people: directDoingPeople,
    latest_progress_person: project.latest_progress_person || existingTree.latest_progress_person || {},
    all_people: existingTree.all_people?.length ? existingTree.all_people : allPeople,
    tree_levels: existingTree.tree_levels?.length
      ? existingTree.tree_levels
      : [
          {
            level: 1,
            label: 'Reporting Officer',
            people: directReportingOfficer?.employee_name || directReportingOfficer?.name
              ? [directReportingOfficer]
              : [],
          },
          {
            level: 2,
            label: 'Team Leader',
            people: directTeamLeader?.employee_name || directTeamLeader?.name
              ? [directTeamLeader]
              : [],
          },
          {
            level: 3,
            label: 'Team Members Doing Project',
            people: directAssignedMembers,
          },
          {
            level: 4,
            label: 'Collaborators',
            people: directCollaborators,
          },
        ],
    connection_label:
      existingTree.connection_label ||
      'Reporting Officer → Team Leader → Team Members → Collaborators',
  });
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

function PersonAvatar({ person = {}, size = 'md' }) {
  const photoUrl = getProfilePhotoUrl(person);
  const name = getName(person);

  return (
    <div className={`project-avatar project-avatar-${size}`}>
      {photoUrl ? (
        <img src={photoUrl} alt={name} />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
}

function PersonMiniCard({ person = {}, relation, compact = false }) {
  const name = getName(person);
  const label = relation || relationLabel(person.relation);

  return (
    <div className={`project-person-mini ${compact ? 'is-compact' : ''}`}>
      <PersonAvatar person={person} size={compact ? 'sm' : 'md'} />

      <div>
        <strong>{name}</strong>
        <span>{label}</span>
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

function PeopleStack({ people = [], limit = 5 }) {
  const normalizedPeople = normalizePeople(people);
  const list = normalizedPeople.slice(0, limit);
  const remaining = Math.max(0, normalizedPeople.length - limit);

  if (!list.length) {
    return <span className="project-team-empty-text">No people mapped</span>;
  }

  return (
    <div className="project-avatar-stack">
      {list.map((person, index) => (
        <div
          key={`${getId(person)}-${index}`}
          className="project-avatar-stack-item"
          title={getName(person)}
        >
          <PersonAvatar person={person} size="xs" />
        </div>
      ))}

      {remaining > 0 && (
        <span className="project-avatar-more">+{remaining}</span>
      )}
    </div>
  );
}

function ProjectTeamSummary({ project }) {
  const reportingOfficer = getProjectReportingOfficer(project);
  const teamLeader = getProjectTeamLeader(project);
  const collaborators = getProjectCollaborators(project);
  const doingPeople = getProjectDoingPeople(project);

  return (
    <div className="project-team-summary">
      <div className="project-team-summary-head">
        <div>
          <span>Project Ownership</span>
          <strong>Who is doing this project</strong>
        </div>

        <PeopleStack people={doingPeople} />
      </div>

      <div className="project-team-grid">
        <div className="project-team-box">
          <span>Reporting Officer</span>
          {reportingOfficer?.employee_name || reportingOfficer?.name ? (
            <PersonMiniCard person={reportingOfficer} relation="Reporting Officer" compact />
          ) : (
            <p>No Reporting Officer mapped</p>
          )}
        </div>

        <div className="project-team-box">
          <span>Team Leader</span>
          {teamLeader?.employee_name || teamLeader?.name ? (
            <PersonMiniCard person={teamLeader} relation="Team Leader" compact />
          ) : (
            <p>No Team Leader mapped</p>
          )}
        </div>

        <div className="project-team-box">
          <span>Doing Project</span>
          <p>{projectEmployeeNames(doingPeople)}</p>
        </div>

        <div className="project-team-box">
          <span>Collaborators</span>
          <p>{projectEmployeeNames(collaborators)}</p>
        </div>
      </div>
    </div>
  );
}

function ProjectSpiderTree({ project }) {
  const tree = getProjectTree(project);

  const reportingOfficer =
    tree.reporting_officer ||
    project.reporting_officer ||
    {};

  const teamLeader =
    tree.team_leader ||
    project.team_leader ||
    {};

  const assignedMembers = normalizePeople(
    tree.assigned_members?.length
      ? tree.assigned_members
      : project.assigned_members || [],
  );

  const collaborators = normalizePeople(
    tree.collaborators?.length
      ? tree.collaborators
      : project.collaborators || [],
  );

  const doingPeople = normalizePeople(
    tree.doing_people?.length
      ? tree.doing_people
      : project.doing_people?.length
        ? project.doing_people
        : assignedMembers,
  );

  const allPeople = normalizePeople(
    tree.all_people?.length
      ? tree.all_people
      : [
          reportingOfficer,
          teamLeader,
          ...assignedMembers,
          ...collaborators,
          ...(project.latest_progress_person ? [project.latest_progress_person] : []),
        ].filter((person) => person && (getId(person) || getName(person) !== 'Unnamed')),
  );

  return (
    <div className="project-spider-map">
      <div className="project-spider-bg" />

      <div className="project-spider-header">
        <span>Project Hierarchy Map</span>
        <strong>
          {tree.connection_label || 'Reporting Officer → Team Leader → Team Members → Collaborators'}
        </strong>
      </div>

      <div className="project-root-node project-root-ro">
        {reportingOfficer?.employee_name || reportingOfficer?.name ? (
          <PersonMiniCard person={reportingOfficer} relation="Reporting Officer" />
        ) : (
          <div className="project-empty-node">No Reporting Officer</div>
        )}
      </div>

      <div className="project-root-line vertical" />

      <div className="project-root-node project-root-tl">
        {teamLeader?.employee_name || teamLeader?.name ? (
          <PersonMiniCard person={teamLeader} relation="Team Leader" />
        ) : (
          <div className="project-empty-node">No Team Leader</div>
        )}
      </div>

      <div className="project-root-line vertical" />

      <div className="project-root-branches">
        <div className="project-root-branch">
          <div className="project-root-branch-label">
            <span>Team Members Doing Project</span>
            <strong>{assignedMembers.length}</strong>
          </div>

          <div className="project-root-people">
            {assignedMembers.map((person, index) => (
              <PersonMiniCard
                key={`${getId(person) || getName(person)}-${index}-assigned`}
                person={person}
                relation="Doing Project"
                compact
              />
            ))}

            {!assignedMembers.length && (
              <div className="project-empty-node">No assigned members</div>
            )}
          </div>
        </div>

        <div className="project-root-branch">
          <div className="project-root-branch-label collaborator">
            <span>Collaborators</span>
            <strong>{collaborators.length}</strong>
          </div>

          <div className="project-root-people">
            {collaborators.map((person, index) => (
              <PersonMiniCard
                key={`${getId(person) || getName(person)}-${index}-collaborator`}
                person={person}
                relation="Collaborator"
                compact
              />
            ))}

            {!collaborators.length && (
              <div className="project-empty-node">No collaborators</div>
            )}
          </div>
        </div>
      </div>

      <div className="project-root-footer">
        <span>Total connected people</span>
        <strong>{allPeople.length}</strong>
        <PeopleStack people={allPeople} limit={8} />
      </div>

      <div className="project-root-footer project-root-footer-secondary">
        <span>Doing Project</span>
        <strong>{doingPeople.length}</strong>
        <PeopleStack people={doingPeople} limit={8} />
      </div>
    </div>
  );
}

function MultiSelect({ label, value = [], options = [], onChange, helper, disabled = false }) {
  const selected = Array.isArray(value) ? value.map(String) : [];

  function toggle(id) {
    const normalizedId = String(id || '');

    if (!normalizedId || disabled) return;

    if (selected.includes(normalizedId)) {
      onChange(selected.filter((item) => item !== normalizedId));
      return;
    }

    onChange([...selected, normalizedId]);
  }

  return (
    <div className="project-field">
      <label>{label}</label>

      <div className={`project-select-list ${disabled ? 'is-disabled' : ''}`}>
        {options.map((employee) => {
          const id = String(getId(employee));
          const checked = selected.includes(id);

          return (
            <button
              type="button"
              key={id}
              className={`project-check ${checked ? 'is-active' : ''} ${employee.is_current_user ? 'is-self' : ''}`}
              onClick={() => toggle(id)}
              disabled={disabled}
            >
              <PersonAvatar person={employee} size="sm" />

              <span className="project-check-main">
                <strong>
                  {getName(employee)}
                  {employee.is_current_user ? ' (You)' : ''}
                </strong>
                <small>
                  {employee.department || 'No department'}
                  {employee.designation ? ` • ${employee.designation}` : ''}
                </small>
              </span>

              <span className="project-check-box">{checked ? '✓' : ''}</span>
            </button>
          );
        })}

        {!options.length && (
          <div className="project-empty-mini">No employees found.</div>
        )}
      </div>

      {helper && <p className="project-helper">{helper}</p>}
    </div>
  );
}

function ProjectAnalyticsGraph({ projects = [] }) {
  const activeProjects = projects.filter((project) => normalizeStatus(project.status) === 'active');
  const onHoldProjects = projects.filter((project) => normalizeStatus(project.status) === 'on_hold');
  const completedProjects = projects.filter((project) => normalizeStatus(project.status) === 'completed');
  const avgProgress = averageProgress(projects);

  const departmentMap = projects.reduce((acc, project) => {
    const department = project.department || 'Unassigned';

    if (!acc[department]) {
      acc[department] = {
        department,
        total: 0,
        active: 0,
        completed: 0,
        progressTotal: 0,
      };
    }

    acc[department].total += 1;
    acc[department].progressTotal += percentValue(project.latest_progress);

    if (normalizeStatus(project.status) === 'active') {
      acc[department].active += 1;
    }

    if (normalizeStatus(project.status) === 'completed') {
      acc[department].completed += 1;
    }

    return acc;
  }, {});

  const departmentRows = Object.values(departmentMap)
    .map((row) => ({
      ...row,
      average: row.total ? Math.round(row.progressTotal / row.total) : 0,
    }))
    .sort((a, b) => b.average - a.average)
    .slice(0, 6);

  const topProjects = [...projects]
    .sort((a, b) => percentValue(b.latest_progress) - percentValue(a.latest_progress))
    .slice(0, 5);

  const maxDeptTotal = Math.max(1, ...departmentRows.map((row) => row.total));

  return (
    <section className="project-analytics-panel">
      <div className="project-analytics-head">
        <div>
          <span className="project-kicker">Live Analytics</span>
          <h2>Project Graph Overview</h2>
          <p>
            A quick visual summary of active workload, completed projects,
            department split, and top project progress.
          </p>
        </div>

        <div className="project-progress-ring" style={{ '--ring-value': `${avgProgress}%` }}>
          <div>
            <strong>{avgProgress}%</strong>
            <span>Avg Progress</span>
          </div>
        </div>
      </div>

      <div className="project-graph-grid">
        <div className="project-graph-card">
          <BriefcaseBusiness size={20} aria-hidden="true" />
          <span>Total Projects</span>
          <strong>{projects.length}</strong>
          <small>All scoped projects</small>
        </div>

        <div className="project-graph-card green">
          <Clock3 size={20} aria-hidden="true" />
          <span>Active</span>
          <strong>{activeProjects.length}</strong>
          <small>Currently running</small>
        </div>

        <div className="project-graph-card amber">
          <UsersRound size={20} aria-hidden="true" />
          <span>On Hold</span>
          <strong>{onHoldProjects.length}</strong>
          <small>Paused projects</small>
        </div>

        <div className="project-graph-card indigo">
          <CheckCircle2 size={20} aria-hidden="true" />
          <span>Completed</span>
          <strong>{completedProjects.length}</strong>
          <small>Closed projects</small>
        </div>
      </div>

      <div className="project-analytics-two">
        <div className="project-modern-chart">
          <div className="project-modern-chart-title">
            <h3>Department Workload</h3>
            <p>Project count and average progress department-wise.</p>
          </div>

          {!departmentRows.length && (
            <div className="project-empty-mini">No department graph data available.</div>
          )}

          {departmentRows.map((row) => (
            <div className="project-modern-bar" key={row.department}>
              <div className="project-modern-bar-head">
                <span>{row.department}</span>
                <strong>{row.total} project{row.total > 1 ? 's' : ''}</strong>
              </div>

              <div className="project-modern-track">
                <div
                  className="project-modern-fill"
                  style={{ width: `${Math.max((row.total / maxDeptTotal) * 100, 5)}%` }}
                />
              </div>

              <small>
                Active: {row.active} • Completed: {row.completed} • Avg: {row.average}%
              </small>
            </div>
          ))}
        </div>

        <div className="project-modern-chart">
          <div className="project-modern-chart-title">
            <h3>Top Project Progress</h3>
            <p>Highest progress projects in your scope.</p>
          </div>

          {!topProjects.length && (
            <div className="project-empty-mini">No project progress data available.</div>
          )}

          {topProjects.map((project) => {
            const progress = percentValue(project.latest_progress || project.progress_percent);

            return (
              <div className="project-rank-card" key={String(getId(project))}>
                <div>
                  <strong>{getName(project)}</strong>
                  <small>
                    {project.department || 'No department'} • {statusLabel(project.status)}
                  </small>
                </div>

                <div className="project-rank-progress">
                  <span>{progress}%</span>
                  <div className="project-rank-track">
                    <div style={{ width: `${Math.max(progress, 5)}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ProjectCard({
  project,
  employees,
  currentEmployeeOption,
  canManageProjectSetup,
  onStatusChange,
  onAssign,
  onProgressSubmit,
}) {
  const projectId = String(getId(project));
  const status = normalizeStatus(project.status);
  const canAssignThisProject = Boolean(canManageProjectSetup && project.can_create_assign_collaborate !== false);
  const canUpdateStatusProgress = Boolean(project.can_update_status_progress !== false);
  const selfId = currentEmployeeOption ? String(getId(currentEmployeeOption)) : '';

  const [assignedIds, setAssignedIds] = useState((project.assigned_employee_ids || []).map(String));
  const [collaboratorIds, setCollaboratorIds] = useState((project.collaborator_ids || []).map(String));
  const [progressPercent, setProgressPercent] = useState(
    project.latest_progress || project.progress_percent || '',
  );
  const [progressNote, setProgressNote] = useState('');
  const [showTeamMap, setShowTeamMap] = useState(false);

  const assignedMembers = getProjectAssignedMembers(project);
  const collaborators = getProjectCollaborators(project);
  const doingPeople = getProjectDoingPeople(project);
  const teamLeader = getProjectTeamLeader(project);
  const reportingOfficer = getProjectReportingOfficer(project);

  const selfAssigned = Boolean(selfId && assignedIds.includes(selfId));
  const selfCollaborator = Boolean(selfId && collaboratorIds.includes(selfId));

  useEffect(() => {
    setAssignedIds((project.assigned_employee_ids || []).map(String));
    setCollaboratorIds((project.collaborator_ids || []).map(String));
    setProgressPercent(project.latest_progress || project.progress_percent || '');
    setProgressNote('');
  }, [project]);

  async function saveAssignment(nextAssignedIds = assignedIds, nextCollaboratorIds = collaboratorIds) {
    await onAssign(projectId, {
      assigned_employee_ids: nextAssignedIds,
      collaborator_ids: nextCollaboratorIds,
    });
  }

  async function assignSelfAsMember() {
    if (!selfId) return;

    const nextAssignedIds = selfAssigned
      ? assignedIds
      : [...assignedIds, selfId];

    setAssignedIds(nextAssignedIds);

    await saveAssignment(nextAssignedIds, collaboratorIds);
  }

  async function addSelfAsCollaborator() {
    if (!selfId) return;

    const nextCollaboratorIds = selfCollaborator
      ? collaboratorIds
      : [...collaboratorIds, selfId];

    setCollaboratorIds(nextCollaboratorIds);

    await saveAssignment(assignedIds, nextCollaboratorIds);
  }

  async function saveProgress() {
    await onProgressSubmit(projectId, {
      progress_percent: progressPercent,
      note: progressNote,
      date: new Date().toISOString().slice(0, 10),
    });

    setProgressNote('');
  }

  return (
    <article className="project-card">
      <div className="project-card-head">
        <div>
          <h3>{getName(project)}</h3>
          <p>
            {project.department || 'No department'}
            {teamLeader?.employee_name || teamLeader?.name ? ` • TL: ${teamLeader.employee_name || teamLeader.name}` : ''}
            {reportingOfficer?.employee_name || reportingOfficer?.name ? ` • RO: ${reportingOfficer.employee_name || reportingOfficer.name}` : ''}
          </p>
        </div>

        <span className={`project-status project-status-${status}`}>
          {statusLabel(status)}
        </span>
      </div>

      <ProjectTeamSummary project={project} />

      <div className="project-progress-wrap">
        <div className="project-progress-meta">
          <span>Latest Progress</span>
          <strong>{Number(project.latest_progress || 0)}%</strong>
        </div>

        <div className="project-progress-track">
          <div
            className="project-progress-fill"
            style={{ width: `${Math.min(Number(project.latest_progress || 0), 100)}%` }}
          />
        </div>

        <p className="project-muted">
          Last update: {project.latest_progress_date || 'No progress update yet'}
          {project.latest_progress_by_name ? ` • ${project.latest_progress_by_name}` : ''}
        </p>
      </div>

      <div className="project-people-strip">
        <div>
          <span>Doing</span>
          <PeopleStack people={doingPeople} />
        </div>

        <div>
          <span>Assigned</span>
          <PeopleStack people={assignedMembers} />
        </div>

        <div>
          <span>Collaborators</span>
          <PeopleStack people={collaborators} />
        </div>

        <button
          type="button"
          className="project-btn project-btn-soft"
          onClick={() => setShowTeamMap((previous) => !previous)}
        >
          {showTeamMap ? 'Hide Team Map' : 'View Team Map'}
        </button>
      </div>

      {showTeamMap && <ProjectSpiderTree project={project} />}

      {canAssignThisProject ? (
        <>
          <div className="project-self-actions">
            <div>
              <strong>Quick self assignment</strong>
              <small>
                Team Leaders and Reporting Officers can assign the project to themselves.
              </small>
            </div>

            <div>
              <button
                type="button"
                className="project-btn project-btn-soft"
                onClick={assignSelfAsMember}
                disabled={!selfId || selfAssigned}
              >
                {selfAssigned ? 'You are Assigned' : 'Assign to Myself'}
              </button>

              <button
                type="button"
                className="project-btn project-btn-soft"
                onClick={addSelfAsCollaborator}
                disabled={!selfId || selfCollaborator}
              >
                {selfCollaborator ? 'You are Collaborator' : 'Add Me as Collaborator'}
              </button>
            </div>
          </div>

          <div className="project-grid-two">
            <MultiSelect
              label="Assigned Team Members"
              value={assignedIds}
              options={employees}
              onChange={setAssignedIds}
              helper="Only Team Leaders and Reporting Officers can assign employees. Your own name is also available here."
            />

            <MultiSelect
              label="Collaborators"
              value={collaboratorIds}
              options={employees}
              onChange={setCollaboratorIds}
              helper="Only Team Leaders and Reporting Officers can add collaborators. You can add yourself too."
            />
          </div>

          <div className="project-actions">
            <button type="button" className="project-btn project-btn-soft" onClick={() => saveAssignment()}>
              Save Assignment / Collaborators
            </button>

            {status !== 'completed' ? (
              <button
                type="button"
                className="project-btn project-btn-danger-soft"
                onClick={() => onStatusChange(projectId, 'completed')}
              >
                Mark Completed
              </button>
            ) : (
              <button
                type="button"
                className="project-btn project-btn-soft"
                onClick={() => onStatusChange(projectId, 'active')}
              >
                Reopen Active
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="project-readonly-box">
          <div>
            <strong>Assigned Team Members</strong>
            <p>{projectEmployeeNames(assignedMembers)}</p>
          </div>

          <div>
            <strong>Collaborators</strong>
            <p>{projectEmployeeNames(collaborators)}</p>
          </div>

          <small>
            You can view this mapping, but only Team Leaders and Reporting Officers can change assignment or collaborators.
          </small>
        </div>
      )}

      {canUpdateStatusProgress && (
        <>
          {!canAssignThisProject && (
            <div className="project-actions">
              {status !== 'completed' ? (
                <button
                  type="button"
                  className="project-btn project-btn-danger-soft"
                  onClick={() => onStatusChange(projectId, 'completed')}
                >
                  Mark Completed
                </button>
              ) : (
                <button
                  type="button"
                  className="project-btn project-btn-soft"
                  onClick={() => onStatusChange(projectId, 'active')}
                >
                  Reopen Active
                </button>
              )}
            </div>
          )}

          {status !== 'completed' && (
            <div className="project-progress-form">
              <div className="project-field">
                <label>Today&apos;s Progress %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={progressPercent}
                  onChange={(event) => setProgressPercent(event.target.value)}
                  placeholder="Example: 65"
                />
              </div>

              <div className="project-field">
                <label>Daily Progress Note</label>
                <textarea
                  value={progressNote}
                  onChange={(event) => setProgressNote(event.target.value)}
                  placeholder="Write today&apos;s progress update..."
                  rows={3}
                />
              </div>

              <button type="button" className="project-btn project-btn-primary" onClick={saveProgress}>
                Submit Daily Progress
              </button>
            </div>
          )}
        </>
      )}

      {!canUpdateStatusProgress && (
        <div className="project-completed-note">
          You can view this project only. Progress/status updates are allowed only for assigned members or collaborators.
        </div>
      )}

      {status === 'completed' && (
        <div className="project-completed-note">
          This project is completed. It will not appear in active handover dropdowns.
        </div>
      )}

      <div className="project-card-footer">
        <span>Created: {formatDate(project.created_at)}</span>
        <span>Completed: {formatDate(project.completed_at)}</span>
      </div>
    </article>
  );
}


function getSaasTenant(user = {}) {
  return user.tenant || user.company || {};
}

function getSaasSubscription(user = {}) {
  return user.subscription || user.saas_subscription || {};
}

function getSaasPlanType(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return String(
    subscription.plan_type ||
      tenant.plan_type ||
      user.plan_type ||
      '',
  )
    .trim()
    .toLowerCase();
}

function getSaasStatus(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return String(
    subscription.status ||
      tenant.status ||
      user.subscription_status ||
      user.status ||
      '',
  )
    .trim()
    .toLowerCase();
}

function getSaasCompanyName(user = {}) {
  const tenant = getSaasTenant(user);

  return (
    user.company_name ||
    tenant.company_name ||
    tenant.name ||
    'Your company'
  );
}

function getSaasEmployeeLimit(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  const rawLimit =
    subscription.employee_limit ??
    tenant.employee_limit ??
    user.employee_limit ??
    '';

  if (rawLimit === null || rawLimit === undefined || rawLimit === '') {
    return null;
  }

  const parsed = Number(rawLimit);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getTrialEndDate(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return (
    subscription.trial_end_date ||
    subscription.end_date ||
    tenant.trial_end_date ||
    tenant.subscription_end_date ||
    user.trial_end_date ||
    user.subscription_end_date ||
    ''
  );
}

function formatSaasDate(value) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getSaasDaysLeft(user = {}) {
  const trialEndDate = getTrialEndDate(user);

  if (!trialEndDate) {
    return null;
  }

  const endDate = new Date(trialEndDate);

  if (Number.isNaN(endDate.getTime())) {
    return null;
  }

  const remainingMs = endDate.getTime() - Date.now();

  if (remainingMs <= 0) {
    return 0;
  }

  return Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
}

function openSaasBillingPage(setPage) {
  if (typeof setPage === 'function') {
    setPage('billing');
  }

  try {
    window.history.pushState({}, '', '/billing');
  } catch {
    // Ignore browser history errors.
  }
}

export default function Projects({ user: providedUser = {}, setPage } = {}) {
  const alerts = useCustomAlert();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [projectOptions, setProjectOptions] = useState(null);
  const [currentEmployeeOption, setCurrentEmployeeOption] = useState(null);
  const [permissionState, setPermissionState] = useState({
    can_create_projects: false,
    can_assign_projects: false,
    can_add_collaborators: false,
    can_create_assign_collaborate: false,
  });
  const [filter, setFilter] = useState('active');
  const [listDepartmentFilter, setListDepartmentFilter] = useState('');

const [form, setForm] = useState({
  name: '',
  description: '',
  department: '',
  status: 'active',
  assigned_employee_ids: [],
  collaborator_ids: [],
});

  const user = providedUser?.email ? providedUser : currentUser();

  const activeProjects = useMemo(
    () => projects.filter((project) => normalizeStatus(project.status) === 'active'),
    [projects],
  );

  const onHoldProjects = useMemo(
    () => projects.filter((project) => normalizeStatus(project.status) === 'on_hold'),
    [projects],
  );

  const completedProjects = useMemo(
    () => projects.filter((project) => normalizeStatus(project.status) === 'completed'),
    [projects],
  );

const visibleProjects = useMemo(() => {
  if (filter === 'completed') return completedProjects;
  if (filter === 'on_hold') return onHoldProjects;
  if (filter === 'all') return projects;

  return activeProjects;
}, [activeProjects, completedProjects, filter, onHoldProjects, projects]);

const departments = useMemo(() => {
  const values = employees
    .map((employee) => employee.department)
    .filter(Boolean);

  return [...new Set(values)].sort();
}, [employees]);

const createFormEmployees = useMemo(() => {
  if (!form.department) {
    return [];
  }

  const filtered = filterEmployeesByDepartment(employees, form.department);

  return uniqueEmployees(filtered)
    .map(normalizeEmployeeOption)
    .filter(Boolean);
}, [employees, form.department]);

  const backendCanManage =
    Boolean(permissionState.can_create_assign_collaborate) ||
    Boolean(permissionState.can_create_projects) ||
    Boolean(permissionState.can_assign_projects) ||
    Boolean(permissionState.can_add_collaborators);

  const adminFullAccess = isAdminUser(user);

  const capabilityCanManage = isTeamLeaderOrReportingOfficer(user, dashboard);

  const canManageProjectSetup = backendCanManage || capabilityCanManage || adminFullAccess;

  const saasPlanType = getSaasPlanType(user);
  const saasStatus = getSaasStatus(user);
  const isDemoTenant = saasPlanType === 'demo';
  const isExpiredOrSuspendedTenant = saasStatus === 'expired' || saasStatus === 'suspended';
  const saasEmployeeLimit = getSaasEmployeeLimit(user);
  const saasDaysLeft = getSaasDaysLeft(user);
  const saasCompanyName = getSaasCompanyName(user);


  async function loadData() {
    setLoading(true);

    try {
      const [
        projectResponse,
        projectOptionsResponse,
        employeeResponse,
        dashboardResponse,
      ] = await Promise.all([
        getProjects({
          limit: 300,
          sort_by: 'created_at',
          sort_dir: 'desc',
          ...(listDepartmentFilter ? { department: listDepartmentFilter } : {}),
        }),
        getProjectOptions().catch(() => null),
        listCollection('employees', { limit: 500, sort_by: 'name', sort_dir: 'asc' }).catch(() => ({ items: [] })),
        getEmployeeDashboard().catch(() => null),
      ]);

      const allEmployees = toArray(employeeResponse);
      const scopedEmployees = buildScopedProjectEmployees(
        allEmployees,
        dashboardResponse,
        user,
        projectOptionsResponse,
      );

      const selfOption = getCurrentEmployeeOption(user, dashboardResponse, projectOptionsResponse);

      setProjects(toArray(projectResponse));
      setEmployees(scopedEmployees);
      setDashboard(dashboardResponse || null);
      setProjectOptions(projectOptionsResponse || null);
      setCurrentEmployeeOption(selfOption);
      setPermissionState({
        can_create_projects: Boolean(
          projectResponse?.can_create_projects ||
          projectOptionsResponse?.can_create_projects,
        ),
        can_assign_projects: Boolean(
          projectResponse?.can_assign_projects ||
          projectOptionsResponse?.can_assign_projects,
        ),
        can_add_collaborators: Boolean(
          projectResponse?.can_add_collaborators ||
          projectOptionsResponse?.can_add_collaborators,
        ),
        can_create_assign_collaborate: Boolean(
          projectResponse?.can_create_assign_collaborate ||
          projectOptionsResponse?.can_create_assign_collaborate,
        ),
      });
    } catch (err) {
      alerts.error(err.message || 'Unable to load project data.', 'Project Load Failed');
    } finally {
      setLoading(false);
    }
  }

useEffect(() => {
  loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [listDepartmentFilter]);

  function updateForm(key, value) {
    setForm((previous) => {
if (key === 'department') {
  return {
    ...previous,
    department: value,
    assigned_employee_ids: [],
    collaborator_ids: [],
  };
}

      return {
        ...previous,
        [key]: value,
      };
    });
  }

  function assignSelfInCreateForm() {
    const selfId = currentEmployeeOption ? String(getId(currentEmployeeOption)) : '';

    if (!selfId) {
      alerts.warning('Current employee profile was not found. Please refresh or login again.', 'Employee Profile Missing');
      return;
    }

    setForm((previous) => {
      const assigned = (previous.assigned_employee_ids || []).map(String);

      return {
        ...previous,
        assigned_employee_ids: assigned.includes(selfId)
          ? assigned
          : [...assigned, selfId],
      };
    });

    alerts.success('Your name has been added to the assigned team members list.', 'Added Successfully');
  }

  async function handleCreateProject(event) {
    event.preventDefault();

    if (isExpiredOrSuspendedTenant) {
      alerts.warning('Your demo subscription is expired or suspended. Please upgrade to continue using Projects.', 'Subscription Required');
      openSaasBillingPage(setPage);
      return;
    }

    if (!canManageProjectSetup) {
      alerts.warning('Only Team Leaders and Reporting Officers can create projects.', 'Access Restricted');
      return;
    }

    if (!String(form.name || '').trim()) {
      alerts.warning('Project name is required.', 'Missing Project Name');
      return;
    }

    if (!form.department) {
      alerts.warning('Please select a department before creating a project.', 'Missing Department');
      return;
    }

    setSaving(true);

    try {
      await createProject({
        ...form,
        name: String(form.name || '').trim(),
        project_name: String(form.name || '').trim(),
        title: String(form.name || '').trim(),
        status: 'active',
      });

      alerts.success('Project created successfully.', 'Project Created');

      setForm({
        name: '',
        description: '',
        department: '',
        status: 'active',
        assigned_employee_ids: [],
        collaborator_ids: [],
      });

      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to create project.', 'Project Create Failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(projectId, status) {
    if (!projectId) {
      alerts.warning('Project id not found.', 'Invalid Project');
      return;
    }

    const nextStatusLabel = status === 'completed' ? 'mark this project as completed' : 'reopen this project as active';

    const confirmed = await alerts.confirm(
      `Are you sure you want to ${nextStatusLabel}?`,
      status === 'completed' ? 'Complete Project' : 'Reopen Project',
      {
        confirmText: status === 'completed' ? 'Yes, Complete' : 'Yes, Reopen',
        cancelText: 'Cancel',
        tone: status === 'completed' ? 'warning' : 'info',
      },
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);

    try {
      await updateProjectStatus(projectId, status);
      alerts.success(
        status === 'completed' ? 'Project marked as completed.' : 'Project reopened as active.',
        'Project Status Updated',
      );
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to update project status.', 'Status Update Failed');
    } finally {
      setSaving(false);
    }
  }

async function handleAssign(projectId, payload) {
  if (!canManageProjectSetup) {
    alerts.warning('Only Team Leaders and Reporting Officers can assign members or collaborators.', 'Access Restricted');
    return;
  }

  if (!projectId) {
    alerts.warning('Project id not found.', 'Invalid Project');
    return;
  }

  setSaving(true);

  try {
    const assignedPayload = {
      assigned_employee_ids: payload.assigned_employee_ids || [],
      assigned_members: payload.assigned_employee_ids || [],
    };

    const collaboratorPayload = {
      collaborator_ids: payload.collaborator_ids || [],
      collaborators: payload.collaborator_ids || [],
    };

    await assignProject(projectId, assignedPayload);
    await updateProjectCollaborators(projectId, collaboratorPayload);

    alerts.success('Project assignment and collaborators updated successfully.', 'Assignment Updated');
    await loadData();
  } catch (err) {
    alerts.error(err.message || 'Unable to update project assignment.', 'Assignment Update Failed');
  } finally {
    setSaving(false);
  }
}

  async function handleProgressSubmit(projectId, payload) {
    if (!projectId) {
      alerts.warning('Project id not found.', 'Invalid Project');
      return;
    }

    const progress = Number(payload.progress_percent);

    if (Number.isNaN(progress) || progress < 0 || progress > 100) {
      alerts.warning('Progress must be between 0 and 100.', 'Invalid Progress');
      return;
    }

    if (!String(payload.note || '').trim()) {
      alerts.warning('Daily progress note is required.', 'Missing Progress Note');
      return;
    }

    setSaving(true);

    try {
      await addProjectProgress(projectId, payload);
      alerts.success('Daily project progress submitted.', 'Progress Submitted');
      await loadData();
    } catch (err) {
      alerts.error(err.message || 'Unable to submit daily progress.', 'Progress Submit Failed');
    } finally {
      setSaving(false);
    }
  }

  const projectSummary = dashboard?.project_dashboard?.summary || {};
  const avgProgress = projectSummary.average_progress || averageProgress(projects);

  return (
    <div className="projects-page yourcomate-projects-page">
      <style>{`
        .yourcomate-projects-page {
          --yp-ink: #101a3a;
          --yp-copy: #5d6d8d;
          --yp-violet: #6658dc;
          --yp-violet-deep: #40348d;
          --yp-blue: #3766db;
          --yp-cyan: #18b5c8;
          --yp-teal: #34c9c4;
          --yp-yellow: #d8ff43;
          --yp-paper: #fbfcff;
          --yp-line: rgba(16, 26, 58, .14);
          width: 100%;
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          color: var(--yp-ink);
        }

        .projects-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          min-height: 280px;
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

        .projects-hero::before {
          content: "";
          position: absolute;
          z-index: -1;
          width: 180px;
          height: 180px;
          right: 8%;
          bottom: -100px;
          border-radius: 38% 62% 58% 42% / 48% 43% 57% 52%;
          background: linear-gradient(145deg, rgba(105,217,208,.30), rgba(132,181,241,.28));
          transform: rotate(-18deg);
        }

        .projects-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--yp-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.3vw, 78px);
          font-weight: 760;
          line-height: .93;
          letter-spacing: -.06em;
        }

        .projects-hero h1 em {
          color: var(--yp-violet);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .projects-hero p {
          max-width: 820px;
          margin: 17px 0 0;
          color: var(--yp-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .project-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          margin-bottom: 15px;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .project-permission-note {
          margin-top: 18px;
          padding: 14px 16px;
          border: 1px solid rgba(98,84,218,.22);
          border-radius: 18px;
          color: #40348d;
          background: linear-gradient(145deg, #f1efff, #eef9ff);
          box-shadow: 5px 6px 0 #c9c0ff;
          font-size: 12px;
          font-weight: 850;
          line-height: 1.55;
        }

        .project-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 15px;
          margin-top: 22px;
        }

        .project-summary-card,
        .project-form,
        .project-card,
        .project-analytics-panel {
          border: 1px solid rgba(171,181,211,.72);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          border-radius: clamp(24px, 2.1vw, 34px);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.10);
          transition:
            transform 210ms cubic-bezier(.22,1,.36,1),
            box-shadow 210ms ease,
            border-color 210ms ease;
        }

        .project-summary-card:hover,
        .project-form:hover,
        .project-card:hover,
        .project-analytics-panel:hover {
          border-color: rgba(98,84,218,.28);
          transform: translateY(-3px);
          box-shadow:
            10px 12px 0 #c4ccff,
            0 30px 50px rgba(34,38,110,.14);
        }

        .project-summary-card {
          min-height: 122px;
          padding: 18px;
          position: relative;
          overflow: hidden;
        }

        .project-summary-card:nth-child(1) {
          background: #edf6ff;
          box-shadow:
            7px 9px 0 #b9d7ff,
            0 18px 30px rgba(15,20,75,.10);
        }

        .project-summary-card:nth-child(2) {
          background: #eaf8f4;
          box-shadow:
            7px 9px 0 #aee6d9,
            0 18px 30px rgba(15,20,75,.10);
        }

        .project-summary-card:nth-child(3) {
          background: #fff4d5;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(15,20,75,.10);
        }

        .project-summary-card:nth-child(4) {
          background: #f1efff;
          box-shadow:
            7px 9px 0 #c9c0ff,
            0 18px 30px rgba(15,20,75,.10);
        }

        .project-summary-card::after {
          display: none;
          content: none;
        }

        .project-summary-card span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .10em;
          text-transform: uppercase;
        }

        .project-summary-card strong {
          display: block;
          margin-top: 9px;
          color: var(--yp-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(31px, 3vw, 46px);
          line-height: 1;
        }

        .project-analytics-panel {
          padding: clamp(20px, 2vw, 28px);
          display: grid;
          gap: 20px;
          background:
            radial-gradient(circle at 10% 0%, rgba(102,88,220,.10), transparent 29%),
            radial-gradient(circle at 94% 4%, rgba(52,201,196,.10), transparent 28%),
            linear-gradient(145deg, #ffffff, #f7fbff);
        }

        .project-analytics-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }

        .project-analytics-head h2,
        .project-modern-chart-title h3,
        .project-section-title,
        .project-card-head h3 {
          margin: 0;
          color: var(--yp-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-weight: 760;
          letter-spacing: -.04em;
        }

        .project-analytics-head h2 {
          font-size: clamp(29px, 2.8vw, 44px);
          line-height: .98;
        }

        .project-modern-chart-title h3 {
          font-size: clamp(20px, 2vw, 29px);
        }

        .project-analytics-head p,
        .project-modern-chart-title p {
          margin: 7px 0 0;
          color: var(--yp-copy);
          line-height: 1.58;
          font-size: 13px;
        }

        .project-progress-ring {
          --ring-value: 0%;
          width: 138px;
          height: 138px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: conic-gradient(#6658dc var(--ring-value), #e6e8f2 0);
          box-shadow:
            7px 8px 0 #c9c0ff,
            0 18px 42px rgba(102,88,220,.16);
          flex: 0 0 auto;
        }

        .project-progress-ring > div {
          width: 101px;
          height: 101px;
          border-radius: 999px;
          background: #fff;
          display: grid;
          place-items: center;
          align-content: center;
          border: 1px solid rgba(171,181,211,.56);
        }

        .project-progress-ring strong {
          color: var(--yp-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: 27px;
          line-height: 1;
        }

        .project-progress-ring span {
          margin-top: 5px;
          color: #66718e;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .project-graph-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 13px;
        }

        .project-graph-card {
          min-height: 112px;
          padding: 16px;
          border: 1px solid rgba(178,185,210,.72);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 5px 6px 0 #b9d7ff;
        }

        .project-graph-card.green {
          background: #eaf8f4;
          box-shadow: 5px 6px 0 #aee6d9;
        }

        .project-graph-card.amber {
          background: #fff4d5;
          box-shadow: 5px 6px 0 #ffe0a5;
        }

        .project-graph-card.indigo {
          background: #f1efff;
          box-shadow: 5px 6px 0 #c9c0ff;
        }


        .project-graph-card > svg {
          color: var(--yp-violet);
          margin-bottom: 8px;
          animation: projectMetricIconFloat 3.2s ease-in-out infinite;
        }

        .project-graph-card.green > svg {
          color: #159f78;
          animation-delay: -.7s;
        }

        .project-graph-card.amber > svg {
          color: #d08a14;
          animation-delay: -1.4s;
        }

        .project-graph-card.indigo > svg {
          color: #6658dc;
          animation-delay: -2.1s;
        }

        @keyframes projectMetricIconFloat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-3px) rotate(-3deg); }
        }

        .project-graph-card span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .project-graph-card strong {
          display: block;
          margin-top: 8px;
          color: var(--yp-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: 31px;
        }

        .project-graph-card small {
          color: var(--yp-copy);
          font-weight: 750;
        }

        .project-analytics-two {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
        }

        .project-modern-chart {
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 24px;
          background: rgba(255,255,255,.86);
          padding: 17px;
          display: grid;
          gap: 13px;
          box-shadow: 5px 6px 0 rgba(52,43,120,.08);
        }

        .project-modern-bar,
        .project-rank-card {
          border: 1px solid rgba(162,169,196,.48);
          border-radius: 17px;
          padding: 12px;
          background: rgba(255,255,255,.82);
          box-shadow: 3px 4px 0 rgba(52,43,120,.08);
        }

        .project-modern-bar {
          display: grid;
          gap: 8px;
        }

        .project-modern-bar-head {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: var(--yp-ink);
          font-weight: 900;
        }

        .project-modern-track,
        .project-rank-track,
        .project-progress-track {
          height: 10px;
          overflow: hidden;
          border-radius: 999px;
          background: #e3e6ef;
        }

        .project-modern-fill,
        .project-rank-track > div,
        .project-progress-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #6658dc, #3766db, #34c9c4);
        }

        .project-modern-bar small {
          color: var(--yp-copy);
          font-size: 12px;
          font-weight: 750;
        }

        .project-rank-card {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 130px;
          gap: 12px;
          align-items: center;
        }

        .project-rank-card strong {
          display: block;
          color: var(--yp-ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .project-rank-card small {
          display: block;
          margin-top: 3px;
          color: var(--yp-copy);
          font-size: 12px;
        }

        .project-rank-progress span {
          display: block;
          color: var(--yp-violet);
          font-weight: 900;
          text-align: right;
          margin-bottom: 6px;
        }

        .project-form {
          padding: clamp(20px, 2vw, 28px);
          background:
            radial-gradient(circle at 0% 0%, rgba(105,217,208,.14), transparent 28%),
            radial-gradient(circle at 100% 0%, rgba(102,88,220,.12), transparent 30%),
            linear-gradient(145deg, #ffffff, #f7fbff);
        }

        .project-section-title {
          margin-bottom: 16px;
          font-size: clamp(25px, 2.3vw, 36px);
          line-height: 1;
        }

        .project-form-grid,
        .project-grid-two {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .project-field {
          display: grid;
          gap: 8px;
          min-width: 0;
        }

        .project-field label {
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .02em;
        }

        .project-field input,
        .project-field select,
        .project-field textarea {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 15px;
          padding: 12px 14px;
          color: var(--yp-ink);
          background: rgba(255,255,255,.93);
          outline: none;
          font: inherit;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease;
        }

        .project-field input:focus,
        .project-field select:focus,
        .project-field textarea:focus {
          border-color: rgba(98,84,218,.65);
          box-shadow:
            4px 5px 0 rgba(102,88,220,.14),
            0 0 0 4px rgba(102,88,220,.08);
          transform: translateY(-1px);
        }

        .project-field-full {
          grid-column: 1 / -1;
        }

        .project-helper,
        .project-muted {
          margin: 0;
          color: var(--yp-copy);
          font-size: 12px;
          line-height: 1.5;
        }

        .project-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
        }

        .project-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .project-tab,
        .project-btn {
          border: 0;
          cursor: pointer;
          border-radius: 15px;
          font-weight: 900;
          transition:
            transform 190ms cubic-bezier(.22,1,.36,1),
            box-shadow 190ms ease,
            filter 190ms ease;
        }

        .project-tab {
          min-height: 42px;
          padding: 10px 14px;
          color: #4f5c78;
          background: rgba(255,255,255,.88);
          box-shadow: 3px 4px 0 rgba(52,43,120,.09);
        }

        .project-tab.is-active {
          color: #fff;
          background: #342b78;
          box-shadow:
            5px 6px 0 #18b5c8,
            0 14px 25px rgba(52,43,120,.16);
        }

        .project-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 42px;
          padding: 11px 16px;
        }

        .project-btn:disabled {
          cursor: not-allowed;
          opacity: .65;
        }

        .project-btn-primary {
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36,74,128,.16);
        }

        .project-btn-soft {
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .project-btn-danger-soft {
          color: #a83b3b;
          background: #fff0ef;
          box-shadow: 3px 4px 0 #f3c3bf;
        }

        .project-btn:hover,
        .project-tab:hover {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .project-alert {
          border-radius: 18px;
          padding: 14px 16px;
          font-weight: 800;
          border: 1px solid;
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
        }

        .project-alert-error {
          color: #991b1b;
          background: #fff1f0;
          border-color: #fecaca;
        }

        .project-alert-success {
          color: #065f46;
          background: #ecfdf5;
          border-color: #bbf7d0;
        }

        .project-list {
          display: grid;
          gap: 20px;
        }

        .project-card {
          padding: clamp(19px, 2vw, 27px);
          display: grid;
          gap: 18px;
        }

        .project-card-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }

        .project-card-head h3 {
          font-size: clamp(24px, 2.2vw, 34px);
          line-height: 1;
        }

        .project-card-head p {
          margin: 7px 0 0;
          color: var(--yp-copy);
          font-size: 13px;
          line-height: 1.5;
        }

        .project-status {
          white-space: nowrap;
          border-radius: 999px;
          padding: 7px 11px;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: .04em;
          text-transform: uppercase;
        }

        .project-status-active {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .project-status-completed {
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .project-status-on_hold {
          color: #92400e;
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .project-progress-wrap {
          display: grid;
          gap: 8px;
          padding: 14px;
          border: 1px solid rgba(162,169,196,.44);
          border-radius: 18px;
          background: rgba(255,255,255,.78);
          box-shadow: 3px 4px 0 rgba(52,43,120,.08);
        }

        .project-progress-meta {
          display: flex;
          justify-content: space-between;
          color: #303b5b;
          font-size: 12px;
          font-weight: 900;
        }

        .project-select-list {
          display: grid;
          gap: 8px;
          max-height: 230px;
          overflow: auto;
          border: 1px solid rgba(162,169,196,.50);
          border-radius: 18px;
          padding: 10px;
          background: rgba(248,250,252,.90);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.9);
        }

        .project-select-list.is-disabled {
          opacity: .72;
          pointer-events: none;
        }

        .project-check {
          width: 100%;
          border: 1px solid rgba(162,169,196,.45);
          border-radius: 16px;
          background: #fff;
          padding: 10px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px;
          text-align: left;
          cursor: pointer;
          box-shadow: 2px 3px 0 rgba(52,43,120,.07);
        }

        .project-check.is-active {
          border-color: rgba(102,88,220,.55);
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .project-check.is-self {
          border-color: rgba(52,201,196,.42);
          background: #eefbf8;
        }

        .project-check.is-self.is-active {
          border-color: #34c9c4;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .project-check-box {
          width: 22px;
          height: 22px;
          border-radius: 7px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #e3e6ef;
          color: var(--yp-violet);
          font-weight: 900;
          flex: 0 0 auto;
        }

        .project-check-main {
          min-width: 0;
        }

        .project-check strong {
          display: block;
          color: var(--yp-ink);
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .project-check small {
          display: block;
          margin-top: 3px;
          color: var(--yp-copy);
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .project-self-actions {
          border: 1px solid rgba(52,201,196,.34);
          background: linear-gradient(145deg, #eaf8f4, #f7fffc);
          color: #065f46;
          border-radius: 18px;
          padding: 13px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          box-shadow: 4px 5px 0 #aee6d9;
        }

        .project-self-actions strong {
          display: block;
          color: #064e3b;
          font-size: 14px;
        }

        .project-self-actions small {
          display: block;
          margin-top: 3px;
          color: #047857;
          font-weight: 750;
        }

        .project-self-actions > div:last-child {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .project-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .project-progress-form {
          display: grid;
          grid-template-columns: 180px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: end;
          border-top: 1px solid rgba(171,181,211,.55);
          padding-top: 18px;
        }

        .project-readonly-box,
        .project-completed-note {
          border: 1px solid rgba(98,84,218,.24);
          color: #40348d;
          background: linear-gradient(145deg, #f1efff, #f7f4ff);
          padding: 13px 14px;
          border-radius: 16px;
          font-weight: 800;
          font-size: 13px;
          box-shadow: 4px 5px 0 #c9c0ff;
        }

        .project-readonly-box {
          display: grid;
          gap: 10px;
          color: #334155;
          background: #f8fafc;
          border-color: rgba(171,181,211,.55);
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
        }

        .project-readonly-box strong {
          display: block;
          color: var(--yp-ink);
          margin-bottom: 3px;
        }

        .project-readonly-box p {
          margin: 0;
          color: var(--yp-copy);
          line-height: 1.45;
          font-weight: 700;
        }

        .project-readonly-box small {
          color: #40348d;
          line-height: 1.45;
        }

        .project-card-footer {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          border-top: 1px solid rgba(171,181,211,.55);
          padding-top: 14px;
          color: var(--yp-copy);
          font-size: 12px;
          font-weight: 700;
        }

        .project-empty,
        .project-empty-mini {
          border: 1px dashed rgba(98,84,218,.34);
          border-radius: 20px;
          color: var(--yp-copy);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          padding: 22px;
          text-align: center;
          font-weight: 700;
        }

        .project-empty-mini {
          padding: 12px;
          font-size: 13px;
        }

        .project-avatar {
          overflow: hidden;
          border-radius: 999px;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          border: 2px solid #fff;
          box-shadow: 0 10px 24px rgba(15,23,42,.10);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--yp-violet);
          font-weight: 900;
          flex: 0 0 auto;
        }

        .project-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .project-avatar-xs { width: 30px; height: 30px; font-size: 10px; }
        .project-avatar-sm { width: 38px; height: 38px; font-size: 12px; }
        .project-avatar-md { width: 48px; height: 48px; font-size: 14px; }

        .project-person-mini {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          min-width: 0;
        }

        .project-person-mini strong {
          display: block;
          color: var(--yp-ink);
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .project-person-mini span {
          display: block;
          color: var(--yp-violet);
          font-size: 10px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .05em;
        }

        .project-person-mini small {
          display: block;
          margin-top: 2px;
          color: var(--yp-copy);
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .project-person-mini.is-compact .project-avatar {
          width: 36px;
          height: 36px;
        }

        .project-avatar-stack {
          display: flex;
          align-items: center;
          min-width: 0;
        }

        .project-avatar-stack-item {
          margin-left: -8px;
        }

        .project-avatar-stack-item:first-child {
          margin-left: 0;
        }

        .project-avatar-more {
          min-width: 30px;
          height: 30px;
          margin-left: -8px;
          border-radius: 999px;
          background: #342b78;
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #fff;
          font-size: 11px;
          font-weight: 900;
        }

        .project-team-summary {
          border: 1px solid rgba(171,181,211,.58);
          border-radius: 20px;
          padding: 14px;
          background: linear-gradient(145deg, #f8f8ff, #effbf8);
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
        }

        .project-team-summary-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
        }

        .project-team-summary-head span,
        .project-team-box > span,
        .project-people-strip > div > span {
          display: block;
          color: #66718e;
          font-size: 9px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .07em;
        }

        .project-team-summary-head strong {
          display: block;
          margin-top: 4px;
          color: var(--yp-ink);
          font-size: 15px;
        }

        .project-team-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .project-team-box {
          min-width: 0;
          border: 1px solid rgba(162,169,196,.44);
          border-radius: 15px;
          background: rgba(255,255,255,.84);
          padding: 10px;
          box-shadow: 2px 3px 0 rgba(52,43,120,.07);
        }

        .project-team-box p {
          margin: 7px 0 0;
          color: #303b5b;
          font-size: 12px;
          font-weight: 750;
          line-height: 1.45;
        }

        .project-people-strip {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
          gap: 10px;
          align-items: center;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 18px;
          padding: 12px;
          background: rgba(248,250,252,.88);
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .project-people-strip > div {
          min-width: 0;
        }

        .project-spider-map {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(160,173,224,.62);
          border-radius: 26px;
          background:
            radial-gradient(circle at 50% 0%, rgba(102,88,220,.14), transparent 32%),
            radial-gradient(circle at 0% 100%, rgba(52,201,196,.11), transparent 30%),
            linear-gradient(135deg, #ffffff, #f7fbff);
          padding: 18px;
          display: grid;
          gap: 13px;
          box-shadow: 6px 8px 0 #c4ccff;
        }

        .project-spider-bg {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(102,88,220,.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(102,88,220,.05) 1px, transparent 1px);
          background-size: 24px 24px;
          mask-image: radial-gradient(circle at 50% 36%, black, transparent 78%);
          pointer-events: none;
        }

        .project-spider-map > *:not(.project-spider-bg) {
          position: relative;
          z-index: 1;
        }

        .project-spider-header {
          text-align: center;
        }

        .project-spider-header span {
          display: inline-flex;
          border-radius: 999px;
          padding: 6px 10px;
          background: #f1efff;
          color: #40348d;
          font-size: 9px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .08em;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .project-spider-header strong {
          display: block;
          margin-top: 8px;
          color: var(--yp-ink);
          font-size: 14px;
        }

        .project-root-node {
          max-width: 390px;
          width: 100%;
          margin: 0 auto;
          border: 1px solid rgba(171,181,211,.58);
          border-radius: 20px;
          background: rgba(255,255,255,.94);
          padding: 12px;
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
        }

        .project-root-ro {
          border-color: rgba(102,88,220,.36);
        }

        .project-root-tl {
          border-color: rgba(52,201,196,.38);
        }

        .project-root-line.vertical {
          width: 2px;
          height: 28px;
          margin: -2px auto;
          background: linear-gradient(#6658dc, #34c9c4);
          border-radius: 999px;
        }

        .project-root-branches {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        .project-root-branch {
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 20px;
          background: rgba(255,255,255,.90);
          padding: 12px;
          display: grid;
          gap: 10px;
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
        }

        .project-root-branch-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border-radius: 14px;
          background: #eaf8f4;
          color: #047857;
          padding: 9px 10px;
        }

        .project-root-branch-label.collaborator {
          background: #f1efff;
          color: #40348d;
        }

        .project-root-branch-label span {
          font-size: 9px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .05em;
        }

        .project-root-branch-label strong {
          width: 27px;
          height: 27px;
          display: inline-grid;
          place-items: center;
          border-radius: 999px;
          background: #fff;
          color: inherit;
        }

        .project-root-people {
          display: grid;
          gap: 8px;
        }

        .project-empty-node {
          border: 1px dashed rgba(171,181,211,.75);
          border-radius: 14px;
          color: var(--yp-copy);
          background: #f8fafc;
          padding: 10px;
          text-align: center;
          font-size: 12px;
          font-weight: 800;
        }

        .project-root-footer {
          display: grid;
          grid-template-columns: auto auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          border-top: 1px solid rgba(171,181,211,.55);
          padding-top: 12px;
        }

        .project-root-footer-secondary {
          padding-top: 0;
          border-top: 0;
        }

        .project-root-footer span {
          color: #66718e;
          font-size: 9px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .project-root-footer strong {
          color: var(--yp-ink);
          font-size: 18px;
        }

        .project-team-empty-text {
          color: #94a3b8;
          font-size: 12px;
          font-weight: 800;
        }

        @media (max-width: 1180px) {
          .project-summary-grid,
          .project-graph-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .project-analytics-two,
          .project-form-grid,
          .project-grid-two {
            grid-template-columns: 1fr;
          }

          .project-field-full {
            grid-column: auto;
          }

          .project-team-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .project-people-strip {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .project-progress-form {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .yourcomate-projects-page {
            gap: 18px;
          }

          .projects-hero {
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow:
              6px 7px 0 #c6d8f7,
              0 18px 30px rgba(34,38,110,.10);
          }

          .projects-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .project-summary-grid,
          .project-graph-grid,
          .project-team-grid,
          .project-people-strip,
          .project-root-branches {
            grid-template-columns: 1fr;
          }

          .project-summary-card,
          .project-form,
          .project-card,
          .project-analytics-panel {
            border-radius: 23px;
            box-shadow:
              6px 7px 0 #c4ccff,
              0 18px 30px rgba(34,38,110,.10);
          }

          .project-analytics-head {
            align-items: flex-start;
            flex-direction: column;
          }

          .project-progress-ring {
            width: 112px;
            height: 112px;
          }

          .project-progress-ring > div {
            width: 82px;
            height: 82px;
          }

          .project-rank-card {
            grid-template-columns: 1fr;
          }

          .project-rank-progress span {
            text-align: left;
          }

          .project-toolbar,
          .project-card-head,
          .project-self-actions {
            align-items: stretch;
            flex-direction: column;
          }

          .project-tabs {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            width: 100%;
          }

          .project-tab,
          .project-actions .project-btn,
          .project-self-actions .project-btn,
          .project-progress-form .project-btn {
            width: 100%;
          }

          .project-self-actions > div:last-child,
          .project-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .project-root-footer {
            grid-template-columns: 1fr;
            justify-items: start;
          }
        }

        @media (max-width: 430px) {
          .projects-hero {
            padding: 16px;
          }

          .projects-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .project-summary-grid,
          .project-tabs {
            grid-template-columns: 1fr;
          }

          .project-summary-card,
          .project-form,
          .project-card,
          .project-analytics-panel {
            padding: 15px;
            border-radius: 20px;
          }

          .project-card-head {
            gap: 10px;
          }

          .project-status {
            align-self: flex-start;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .yourcomate-projects-page *,
          .yourcomate-projects-page *::before,
          .yourcomate-projects-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <section className="projects-hero">
        <span className="project-kicker">Project Management</span>
        <h1>Team Projects, Collaborators & Daily Progress</h1>
        <p>
          Team Leaders and Reporting Officers can create projects, assign team members,
          assign projects to themselves, and add collaborators. Employees and team
          members can view scoped projects and update only project status/progress.
        </p>

        <div className="project-permission-note">
          Current access:{' '}
          {canManageProjectSetup
            ? 'You can create projects, assign team members, assign yourself, add collaborators, and update progress.'
            : 'You can view scoped projects and update progress/status only when you are assigned or added as collaborator.'}
        </div>

        {isDemoTenant || isExpiredOrSuspendedTenant ? (
          <div
            className={`project-alert ${isExpiredOrSuspendedTenant ? 'project-alert-error' : 'project-alert-success'}`}
            style={{
              marginTop: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <strong>YourComate 15-Day Full Access Trial</strong>
              <div style={{ marginTop: 4, lineHeight: 1.6 }}>
                Company: {saasCompanyName}. Projects is included in your demo plan.
              </div>
              <div style={{ lineHeight: 1.6 }}>
                Trial end date: {formatSaasDate(getTrialEndDate(user))}
                {saasDaysLeft !== null ? ` · ${saasDaysLeft} day(s) left` : ''}
              </div>
              <div style={{ lineHeight: 1.6 }}>
                Demo limit: {saasEmployeeLimit ? `${saasEmployeeLimit} employees` : 'full HRMS access'} · Allowed modules: Attendance, Apply Leave, Projects
              </div>
              {isExpiredOrSuspendedTenant ? (
                <div style={{ marginTop: 4 }}>
                  Your demo is expired or suspended. Please upgrade to continue using project actions.
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="project-btn project-btn-primary"
              onClick={() => openSaasBillingPage(setPage)}
            >
              Upgrade Plan
            </button>
          </div>
        ) : null}

        <div className="project-summary-grid">
          <div className="project-summary-card">
            <span>Total Projects</span>
            <strong>{projects.length}</strong>
          </div>

          <div className="project-summary-card">
            <span>Active Projects</span>
            <strong>{activeProjects.length}</strong>
          </div>

          <div className="project-summary-card">
            <span>Completed Projects</span>
            <strong>{completedProjects.length}</strong>
          </div>

          <div className="project-summary-card">
            <span>Avg. Progress</span>
            <strong>{avgProgress || 0}%</strong>
          </div>
        </div>
      </section>

      <ProjectAnalyticsGraph projects={projects} />

      {canManageProjectSetup ? (
        <form className="project-form" onSubmit={handleCreateProject} noValidate>
           <h2 className="project-section-title">Create Department Project</h2>

          <div className="project-form-grid">
            <div className="project-field">
              <label>Project Name</label>
              <input
                value={form.name}
                onChange={(event) => updateForm('name', event.target.value)}
                placeholder="Enter project name"
              />
            </div>

            <div className="project-field">
              <label>Department</label>
              <select
                value={form.department}
                onChange={(event) => updateForm('department', event.target.value)}
              >
                <option value="">Select department first</option>
                {departments.map((department) => (
                  <option value={department} key={department}>
                    {department}
                  </option>
                ))}
              </select>
              <p className="project-helper">
                After selecting a department, only employees from that department will appear below.
              </p>
            </div>

            <div className="project-self-actions project-field-full">
              <div>
                <strong>Assign this new project to yourself</strong>
                <small>
                  Use this when you are also doing or leading the project directly.
                </small>
              </div>

              <div>
                <button
                  type="button"
                  className="project-btn project-btn-soft"
                  onClick={assignSelfInCreateForm}
                  disabled={!currentEmployeeOption}
                >
                  Add Myself
                </button>
              </div>
            </div>

            <MultiSelect
              label="Assign Team Members"
              value={form.assigned_employee_ids}
              options={createFormEmployees}
              onChange={(value) => updateForm('assigned_employee_ids', value)}
              disabled={!form.department}
              helper={
                form.department
                  ? `Showing employees from ${form.department} only.`
                  : 'Select a department first to show employees.'
              }
            />

            <MultiSelect
              label="Add Collaborators"
              value={form.collaborator_ids}
              options={createFormEmployees}
              onChange={(value) => updateForm('collaborator_ids', value)}
              disabled={!form.department}
              helper={
                form.department
                  ? `Showing collaborators from ${form.department} only.`
                  : 'Select a department first to show collaborators.'
              }
            />
          </div>

          <div className="project-actions" style={{ marginTop: 16 }}>
            <button type="submit" className="project-btn project-btn-primary" disabled={saving || isExpiredOrSuspendedTenant}>
              {saving ? 'Saving...' : 'Create Active Project'}
            </button>
          </div>
        </form>
      ) : (
        <section className="project-form">
          <h2 className="project-section-title">Project Creation Restricted</h2>
          <p className="project-muted">
            Project creation, team assignment, and collaborator updates are available only
            for Admin, Team Leaders and Reporting Officers. You can still update progress/status
            on projects where you are assigned or added as a collaborator.
          </p>
        </section>
      )}

      <section className="project-list">
<div className="project-toolbar">
  <h2 className="project-section-title" style={{ margin: 0 }}>
    Project List
  </h2>

  {adminFullAccess && (
    <select
      className="project-department-filter"
      value={listDepartmentFilter}
      onChange={(event) => setListDepartmentFilter(event.target.value)}
    >
      <option value="">All Departments</option>
      {departments.map((department) => (
        <option value={department} key={department}>
          {department}
        </option>
      ))}
    </select>
  )}

  <div className="project-tabs">
            <button
              type="button"
              className={`project-tab ${filter === 'active' ? 'is-active' : ''}`}
              onClick={() => setFilter('active')}
            >
              Active
            </button>

            <button
              type="button"
              className={`project-tab ${filter === 'on_hold' ? 'is-active' : ''}`}
              onClick={() => setFilter('on_hold')}
            >
              On Hold
            </button>

            <button
              type="button"
              className={`project-tab ${filter === 'completed' ? 'is-active' : ''}`}
              onClick={() => setFilter('completed')}
            >
              Completed
            </button>

            <button
              type="button"
              className={`project-tab ${filter === 'all' ? 'is-active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
          </div>
        </div>

        {loading && <div className="project-empty">Loading projects...</div>}

        {!loading && !visibleProjects.length && (
          <div className="project-empty">No projects found in this section.</div>
        )}

        {!loading &&
          visibleProjects.map((project) => (
            <ProjectCard
              key={String(getId(project))}
              project={project}
              employees={employees}
              currentEmployeeOption={currentEmployeeOption}
              canManageProjectSetup={canManageProjectSetup}
              onStatusChange={handleStatusChange}
              onAssign={handleAssign}
              onProgressSubmit={handleProgressSubmit}
            />
          ))}
      </section>
    </div>
  );
}