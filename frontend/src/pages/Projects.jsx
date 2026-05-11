import { useEffect, useMemo, useState } from 'react';
import {
  addProjectProgress,
  assignProject,
  createProject,
  currentUser,
  getEmployeeDashboard,
  getInitials,
  getProfilePhotoUrl,
  getProjects,
  listCollection,
  normalizePeopleList,
  normalizeProjectTeamTree,
  updateProjectStatus,
} from '../api/client';

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function getId(item = {}) {
  return item._id || item.id || item.employee_id || '';
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
  const employee = dashboardData?.employee || dashboardData?.employee_summary || {};

  const hasRoleCapability = roles.some((role) =>
    ['team_leader', 'reporting_officer', 'ro'].includes(role),
  );

  const hasEmployeeCapability =
    isTruthy(employee?.is_team_leader || dashboardData?.is_team_leader) ||
    isTruthy(employee?.is_reporting_officer || dashboardData?.is_reporting_officer);

  return hasRoleCapability || hasEmployeeCapability;
}

function sameDepartment(employee = {}, department = '') {
  if (!department) return false;

  return String(employee.department || '').trim().toLowerCase() ===
    String(department || '').trim().toLowerCase();
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

function buildScopedProjectEmployees(allEmployees = [], dashboardData = null) {
  const employee = dashboardData?.employee || dashboardData?.employee_summary || {};
  const employeeDepartment = employee.department || '';

  const teamMembers = dashboardData?.team_members || [];
  const reportingMembers = dashboardData?.reporting_members || [];

  const scopedMembers = uniqueEmployees([
    ...teamMembers,
    ...reportingMembers,
  ]);

  if (scopedMembers.length) {
    return scopedMembers.filter((member) =>
      !employeeDepartment || sameDepartment(member, employeeDepartment),
    );
  }

  return allEmployees.filter((member) =>
    sameDepartment(member, employeeDepartment),
  );
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
  const list = normalizePeople(people).slice(0, limit);
  const remaining = Math.max(0, people.length - limit);

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
  const assignedMembers = getProjectAssignedMembers(project);
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
  const reportingOfficer = tree.reporting_officer || {};
  const teamLeader = tree.team_leader || {};
  const assignedMembers = tree.assigned_members || [];
  const collaborators = tree.collaborators || [];
  const allPeople = tree.all_people || [];

  return (
    <div className="project-spider-map">
      <div className="project-spider-bg" />

      <div className="project-spider-header">
        <span>Team Root Map</span>
        <strong>{tree.connection_label || 'Reporting Officer → Team Leader → Team Members'}</strong>
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

      <div className="project-root-branches">
        <div className="project-root-branch">
          <div className="project-root-branch-label">
            <span>Team Members Doing Project</span>
            <strong>{assignedMembers.length}</strong>
          </div>

          <div className="project-root-people">
            {assignedMembers.map((person, index) => (
              <PersonMiniCard
                key={`${getId(person)}-${index}`}
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
                key={`${getId(person)}-${index}`}
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
    </div>
  );
}

function MultiSelect({ label, value = [], options = [], onChange, helper, disabled = false }) {
  const selected = Array.isArray(value) ? value : [];

  function toggle(id) {
    if (!id || disabled) return;

    if (selected.includes(id)) {
      onChange(selected.filter((item) => item !== id));
      return;
    }

    onChange([...selected, id]);
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
              className={`project-check ${checked ? 'is-active' : ''}`}
              onClick={() => toggle(id)}
              disabled={disabled}
            >
              <PersonAvatar person={employee} size="sm" />

              <span className="project-check-main">
                <strong>{getName(employee)}</strong>
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
          <span>Total Projects</span>
          <strong>{projects.length}</strong>
          <small>All scoped projects</small>
        </div>

        <div className="project-graph-card green">
          <span>Active</span>
          <strong>{activeProjects.length}</strong>
          <small>Currently running</small>
        </div>

        <div className="project-graph-card amber">
          <span>On Hold</span>
          <strong>{onHoldProjects.length}</strong>
          <small>Paused projects</small>
        </div>

        <div className="project-graph-card indigo">
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
  canManageProjectSetup,
  onStatusChange,
  onAssign,
  onProgressSubmit,
}) {
  const projectId = String(getId(project));
  const status = normalizeStatus(project.status);
  const canAssignThisProject = Boolean(canManageProjectSetup && project.can_create_assign_collaborate !== false);
  const canUpdateStatusProgress = Boolean(project.can_update_status_progress !== false);

  const [assignedIds, setAssignedIds] = useState(project.assigned_employee_ids || []);
  const [collaboratorIds, setCollaboratorIds] = useState(project.collaborator_ids || []);
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

  useEffect(() => {
    setAssignedIds(project.assigned_employee_ids || []);
    setCollaboratorIds(project.collaborator_ids || []);
    setProgressPercent(project.latest_progress || project.progress_percent || '');
    setProgressNote('');
  }, [project]);

  async function saveAssignment() {
    await onAssign(projectId, {
      assigned_employee_ids: assignedIds,
      collaborator_ids: collaboratorIds,
    });
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
          <div className="project-grid-two">
            <MultiSelect
              label="Assigned Team Members"
              value={assignedIds}
              options={employees}
              onChange={setAssignedIds}
              helper="Only Team Leaders and Reporting Officers can assign employees."
            />

            <MultiSelect
              label="Collaborators"
              value={collaboratorIds}
              options={employees}
              onChange={setCollaboratorIds}
              helper="Only Team Leaders and Reporting Officers can add collaborators."
            />
          </div>

          <div className="project-actions">
            <button type="button" className="project-btn project-btn-soft" onClick={saveAssignment}>
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

export default function Projects() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [permissionState, setPermissionState] = useState({
    can_create_projects: false,
    can_assign_projects: false,
    can_add_collaborators: false,
    can_create_assign_collaborate: false,
  });
  const [filter, setFilter] = useState('active');

  const [form, setForm] = useState({
    name: '',
    description: '',
    department: '',
    status: 'active',
    assigned_employee_ids: [],
    collaborator_ids: [],
  });

  const user = currentUser();

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

  const backendCanManage =
    Boolean(permissionState.can_create_assign_collaborate) ||
    Boolean(permissionState.can_create_projects) ||
    Boolean(permissionState.can_assign_projects) ||
    Boolean(permissionState.can_add_collaborators);

  const capabilityCanManage = isTeamLeaderOrReportingOfficer(user, dashboard);

  const canManageProjectSetup = backendCanManage || capabilityCanManage;

  async function loadData() {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const [projectResponse, employeeResponse, dashboardResponse] = await Promise.all([
        getProjects({ limit: 300, sort_by: 'created_at', sort_dir: 'desc' }),
        listCollection('employees', { limit: 500, sort_by: 'name', sort_dir: 'asc' }),
        getEmployeeDashboard().catch(() => null),
      ]);

      const allEmployees = toArray(employeeResponse);
      const scopedEmployees = buildScopedProjectEmployees(allEmployees, dashboardResponse);

      setProjects(toArray(projectResponse));
      setEmployees(scopedEmployees);
      setDashboard(dashboardResponse || null);
      setPermissionState({
        can_create_projects: Boolean(projectResponse?.can_create_projects),
        can_assign_projects: Boolean(projectResponse?.can_assign_projects),
        can_add_collaborators: Boolean(projectResponse?.can_add_collaborators),
        can_create_assign_collaborate: Boolean(projectResponse?.can_create_assign_collaborate),
      });
    } catch (err) {
      setError(err.message || 'Unable to load project data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function updateForm(key, value) {
    setForm((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  async function handleCreateProject(event) {
    event.preventDefault();

    if (!canManageProjectSetup) {
      setError('Only Team Leaders and Reporting Officers can create projects.');
      return;
    }

    if (!form.name.trim()) {
      setError('Project name is required.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await createProject({
        ...form,
        project_name: form.name,
        title: form.name,
        status: 'active',
      });

      setMessage('Project created successfully.');
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
      setError(err.message || 'Unable to create project.');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(projectId, status) {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      await updateProjectStatus(projectId, status);
      setMessage(status === 'completed' ? 'Project marked as completed.' : 'Project reopened as active.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to update project status.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign(projectId, payload) {
    if (!canManageProjectSetup) {
      setError('Only Team Leaders and Reporting Officers can assign members or collaborators.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await assignProject(projectId, payload);
      setMessage('Project assignment updated successfully.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to update project assignment.');
    } finally {
      setSaving(false);
    }
  }

  async function handleProgressSubmit(projectId, payload) {
    const progress = Number(payload.progress_percent);

    if (Number.isNaN(progress) || progress < 0 || progress > 100) {
      setError('Progress must be between 0 and 100.');
      return;
    }

    if (!String(payload.note || '').trim()) {
      setError('Daily progress note is required.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await addProjectProgress(projectId, payload);
      setMessage('Daily project progress submitted.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to submit daily progress.');
    } finally {
      setSaving(false);
    }
  }

  const projectSummary = dashboard?.project_dashboard?.summary || {};
  const avgProgress = projectSummary.average_progress || averageProgress(projects);

  return (
    <div className="projects-page">
      <style>{`
        .projects-page {
          width: 100%;
          display: grid;
          gap: 22px;
        }

        .projects-hero {
          position: relative;
          overflow: hidden;
          border: 1px solid #e2e8f0;
          border-radius: 28px;
          background:
            radial-gradient(circle at 10% 10%, rgba(79, 70, 229, .14), transparent 34%),
            radial-gradient(circle at 90% 0%, rgba(5, 150, 105, .13), transparent 30%),
            linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          box-shadow: 0 18px 50px rgba(15, 23, 42, .08);
          padding: 26px;
        }

        .projects-hero h1 {
          margin: 0;
          color: #0f172a;
          font-size: clamp(26px, 3vw, 38px);
          line-height: 1.05;
          letter-spacing: -.04em;
        }

        .projects-hero p {
          margin: 10px 0 0;
          max-width: 900px;
          color: #64748b;
          font-size: 14px;
          line-height: 1.7;
        }

        .project-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 12px;
          border-radius: 999px;
          background: #eef2ff;
          color: #4338ca;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .08em;
          margin-bottom: 14px;
        }

        .project-permission-note {
          margin-top: 16px;
          border: 1px solid #c7d2fe;
          background: #eef2ff;
          color: #3730a3;
          border-radius: 18px;
          padding: 13px 14px;
          font-size: 13px;
          font-weight: 800;
          line-height: 1.5;
        }

        .project-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-top: 22px;
        }

        .project-summary-card,
        .project-form,
        .project-card,
        .project-analytics-panel {
          border: 1px solid #e2e8f0;
          background: #ffffff;
          border-radius: 24px;
          box-shadow: 0 14px 38px rgba(15, 23, 42, .07);
        }

        .project-summary-card {
          padding: 18px;
          position: relative;
          overflow: hidden;
        }

        .project-summary-card::after {
          content: "";
          position: absolute;
          width: 74px;
          height: 74px;
          right: -24px;
          top: -24px;
          border-radius: 999px;
          background: rgba(79, 70, 229, .09);
        }

        .project-summary-card span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .project-summary-card strong {
          display: block;
          margin-top: 8px;
          color: #0f172a;
          font-size: 30px;
          line-height: 1;
        }

        .project-analytics-panel {
          padding: 22px;
          display: grid;
          gap: 18px;
          background:
            radial-gradient(circle at 12% 0%, rgba(79, 70, 229, .08), transparent 30%),
            radial-gradient(circle at 90% 6%, rgba(2, 132, 199, .08), transparent 28%),
            #ffffff;
        }

        .project-analytics-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
        }

        .project-analytics-head h2,
        .project-modern-chart-title h3 {
          margin: 0;
          color: #0f172a;
          letter-spacing: -.03em;
        }

        .project-analytics-head p,
        .project-modern-chart-title p {
          margin: 6px 0 0;
          color: #64748b;
          line-height: 1.55;
          font-size: 13px;
        }

        .project-progress-ring {
          --ring-value: 0%;
          width: 132px;
          height: 132px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background:
            conic-gradient(#4f46e5 var(--ring-value), #e2e8f0 0);
          box-shadow: 0 18px 42px rgba(79, 70, 229, .14);
          flex: 0 0 auto;
        }

        .project-progress-ring > div {
          width: 98px;
          height: 98px;
          border-radius: 999px;
          background: #ffffff;
          display: grid;
          place-items: center;
          align-content: center;
          border: 1px solid #e2e8f0;
        }

        .project-progress-ring strong {
          color: #0f172a;
          font-size: 24px;
          line-height: 1;
        }

        .project-progress-ring span {
          margin-top: 4px;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .project-graph-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .project-graph-card {
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 16px;
          background: #ffffff;
          box-shadow: 0 12px 28px rgba(15, 23, 42, .05);
        }

        .project-graph-card span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .project-graph-card strong {
          display: block;
          margin-top: 8px;
          color: #0f172a;
          font-size: 28px;
        }

        .project-graph-card small {
          color: #64748b;
          font-weight: 700;
        }

        .project-graph-card.green strong {
          color: #059669;
        }

        .project-graph-card.amber strong {
          color: #d97706;
        }

        .project-graph-card.indigo strong {
          color: #4f46e5;
        }

        .project-analytics-two {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .project-modern-chart {
          border: 1px solid #e2e8f0;
          border-radius: 22px;
          background: #ffffff;
          padding: 16px;
          display: grid;
          gap: 13px;
        }

        .project-modern-bar {
          display: grid;
          gap: 8px;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 12px;
          background: #f8fafc;
        }

        .project-modern-bar-head {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: #0f172a;
          font-weight: 900;
        }

        .project-modern-track,
        .project-rank-track {
          height: 10px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .project-modern-fill,
        .project-rank-track > div {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #4f46e5, #0284c7, #059669);
        }

        .project-modern-bar small {
          color: #64748b;
          font-size: 12px;
          font-weight: 750;
        }

        .project-rank-card {
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #f8fafc;
          padding: 12px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 130px;
          gap: 12px;
          align-items: center;
        }

        .project-rank-card strong {
          display: block;
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .project-rank-card small {
          display: block;
          margin-top: 3px;
          color: #64748b;
          font-size: 12px;
        }

        .project-rank-progress span {
          display: block;
          color: #4f46e5;
          font-weight: 900;
          text-align: right;
          margin-bottom: 6px;
        }

        .project-form {
          padding: 22px;
        }

        .project-section-title {
          margin: 0 0 16px;
          color: #0f172a;
          font-size: 20px;
          letter-spacing: -.02em;
        }

        .project-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .project-field {
          display: grid;
          gap: 8px;
        }

        .project-field label {
          color: #334155;
          font-size: 13px;
          font-weight: 800;
        }

        .project-field input,
        .project-field select,
        .project-field textarea {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 16px;
          padding: 12px 14px;
          color: #0f172a;
          background: #ffffff;
          outline: none;
          font: inherit;
        }

        .project-field input:focus,
        .project-field select:focus,
        .project-field textarea:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 4px rgba(79, 70, 229, .13);
        }

        .project-field-full {
          grid-column: 1 / -1;
        }

        .project-helper,
        .project-muted {
          margin: 0;
          color: #64748b;
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
          border-radius: 999px;
          font-weight: 800;
          transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
        }

        .project-tab {
          padding: 10px 14px;
          color: #475569;
          background: #f1f5f9;
        }

        .project-tab.is-active {
          color: #ffffff;
          background: #4f46e5;
          box-shadow: 0 12px 26px rgba(79, 70, 229, .24);
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
          color: #ffffff;
          background: linear-gradient(135deg, #4f46e5, #3730a3);
          box-shadow: 0 14px 30px rgba(79, 70, 229, .25);
        }

        .project-btn-soft {
          color: #4338ca;
          background: #eef2ff;
        }

        .project-btn-danger-soft {
          color: #b91c1c;
          background: #fee2e2;
        }

        .project-btn:hover,
        .project-tab:hover {
          transform: translateY(-1px);
        }

        .project-alert {
          border-radius: 18px;
          padding: 14px 16px;
          font-weight: 700;
          border: 1px solid;
        }

        .project-alert-error {
          color: #991b1b;
          background: #fef2f2;
          border-color: #fecaca;
        }

        .project-alert-success {
          color: #065f46;
          background: #ecfdf5;
          border-color: #bbf7d0;
        }

        .project-list {
          display: grid;
          gap: 18px;
        }

        .project-card {
          padding: 20px;
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
          margin: 0;
          color: #0f172a;
          font-size: 20px;
          letter-spacing: -.02em;
        }

        .project-card-head p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .project-status {
          white-space: nowrap;
          border-radius: 999px;
          padding: 7px 11px;
          font-size: 12px;
          font-weight: 900;
        }

        .project-status-active {
          color: #047857;
          background: #ecfdf5;
        }

        .project-status-completed {
          color: #4338ca;
          background: #eef2ff;
        }

        .project-status-on_hold {
          color: #92400e;
          background: #fffbeb;
        }

        .project-progress-wrap {
          display: grid;
          gap: 8px;
        }

        .project-progress-meta {
          display: flex;
          justify-content: space-between;
          color: #334155;
          font-size: 13px;
          font-weight: 800;
        }

        .project-progress-track {
          height: 10px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .project-progress-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #4f46e5, #059669);
        }

        .project-grid-two {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .project-select-list {
          display: grid;
          gap: 8px;
          max-height: 230px;
          overflow: auto;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 10px;
          background: #f8fafc;
        }

        .project-select-list.is-disabled {
          opacity: .72;
          pointer-events: none;
        }

        .project-check {
          width: 100%;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #ffffff;
          padding: 10px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px;
          text-align: left;
          cursor: pointer;
        }

        .project-check.is-active {
          border-color: #4f46e5;
          background: #eef2ff;
        }

        .project-check-box {
          width: 22px;
          height: 22px;
          border-radius: 7px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #e2e8f0;
          color: #4338ca;
          font-weight: 900;
          flex: 0 0 auto;
        }

        .project-check-main {
          min-width: 0;
        }

        .project-check strong {
          display: block;
          color: #0f172a;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .project-check small {
          display: block;
          margin-top: 3px;
          color: #64748b;
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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
          border-top: 1px solid #e2e8f0;
          padding-top: 18px;
        }

        .project-readonly-box,
        .project-completed-note {
          border: 1px solid #c7d2fe;
          color: #4338ca;
          background: #eef2ff;
          padding: 13px 14px;
          border-radius: 16px;
          font-weight: 800;
          font-size: 13px;
        }

        .project-readonly-box {
          display: grid;
          gap: 10px;
          color: #334155;
          background: #f8fafc;
          border-color: #e2e8f0;
        }

        .project-readonly-box strong {
          display: block;
          color: #0f172a;
          margin-bottom: 3px;
        }

        .project-readonly-box p {
          margin: 0;
          color: #64748b;
          line-height: 1.45;
          font-weight: 700;
        }

        .project-readonly-box small {
          color: #4338ca;
          line-height: 1.45;
        }

        .project-card-footer {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          border-top: 1px solid #e2e8f0;
          padding-top: 14px;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .project-empty,
        .project-empty-mini {
          border: 1px dashed #cbd5e1;
          border-radius: 20px;
          color: #64748b;
          background: #f8fafc;
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
          border: 2px solid #ffffff;
          box-shadow: 0 10px 24px rgba(15, 23, 42, .10);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #4338ca;
          font-weight: 900;
          flex: 0 0 auto;
        }

        .project-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .project-avatar-xs {
          width: 30px;
          height: 30px;
          font-size: 10px;
        }

        .project-avatar-sm {
          width: 38px;
          height: 38px;
          font-size: 12px;
        }

        .project-avatar-md {
          width: 48px;
          height: 48px;
          font-size: 14px;
        }

        .project-person-mini {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          min-width: 0;
        }

        .project-person-mini strong {
          display: block;
          color: #0f172a;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .project-person-mini span {
          display: block;
          color: #4338ca;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .04em;
        }

        .project-person-mini small {
          display: block;
          margin-top: 2px;
          color: #64748b;
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
          background: #0f172a;
          color: #ffffff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #ffffff;
          font-size: 11px;
          font-weight: 900;
        }

        .project-team-empty-text {
          color: #94a3b8;
          font-size: 12px;
          font-weight: 800;
        }

        .project-team-summary {
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background:
            radial-gradient(circle at 0% 0%, rgba(79,70,229,.08), transparent 28%),
            #f8fafc;
          padding: 14px;
          display: grid;
          gap: 13px;
        }

        .project-team-summary-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .project-team-summary-head span,
        .project-team-box span {
          display: block;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .project-team-summary-head strong {
          display: block;
          color: #0f172a;
          margin-top: 4px;
        }

        .project-team-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }

        .project-team-box {
          min-width: 0;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #ffffff;
          padding: 11px;
        }

        .project-team-box p {
          margin: 6px 0 0;
          color: #334155;
          font-size: 12px;
          font-weight: 750;
          line-height: 1.45;
        }

        .project-people-strip {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
          gap: 12px;
          align-items: center;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 12px;
          background: #ffffff;
        }

        .project-people-strip > div {
          min-width: 0;
        }

        .project-people-strip span {
          display: block;
          margin-bottom: 7px;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .project-spider-map {
          position: relative;
          overflow: hidden;
          border: 1px solid #dbe4ff;
          border-radius: 28px;
          background:
            radial-gradient(circle at 50% 0%, rgba(79,70,229,.13), transparent 32%),
            radial-gradient(circle at 0% 100%, rgba(5,150,105,.10), transparent 28%),
            linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          padding: 20px;
          display: grid;
          gap: 18px;
          box-shadow: 0 18px 46px rgba(15, 23, 42, .08);
        }

        .project-spider-bg {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(79,70,229,.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(79,70,229,.06) 1px, transparent 1px);
          background-size: 24px 24px;
          mask-image: radial-gradient(circle at 50% 35%, black, transparent 76%);
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
          background: #eef2ff;
          color: #4338ca;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .07em;
        }

        .project-spider-header strong {
          display: block;
          margin-top: 8px;
          color: #0f172a;
          font-size: 16px;
        }

        .project-root-node {
          max-width: 360px;
          margin: 0 auto;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: rgba(255,255,255,.92);
          padding: 12px;
          box-shadow: 0 14px 32px rgba(15, 23, 42, .08);
        }

        .project-root-ro {
          border-color: #c7d2fe;
        }

        .project-root-tl {
          border-color: #bbf7d0;
        }

        .project-root-line.vertical {
          width: 2px;
          height: 30px;
          margin: -4px auto;
          background: linear-gradient(#4f46e5, #059669);
          border-radius: 999px;
        }

        .project-root-branches {
          position: relative;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-top: 4px;
        }

        .project-root-branches::before {
          content: "";
          position: absolute;
          top: -14px;
          left: 25%;
          right: 25%;
          height: 2px;
          background: linear-gradient(90deg, #4f46e5, #059669);
          border-radius: 999px;
        }

        .project-root-branch {
          border: 1px solid #e2e8f0;
          border-radius: 22px;
          background: rgba(255,255,255,.90);
          padding: 14px;
          display: grid;
          gap: 12px;
        }

        .project-root-branch-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border-radius: 16px;
          background: #ecfdf5;
          color: #047857;
          padding: 10px 12px;
        }

        .project-root-branch-label.collaborator {
          background: #eef2ff;
          color: #4338ca;
        }

        .project-root-branch-label span {
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .05em;
        }

        .project-root-branch-label strong {
          width: 28px;
          height: 28px;
          display: inline-grid;
          place-items: center;
          border-radius: 999px;
          background: #ffffff;
          color: inherit;
        }

        .project-root-people {
          display: grid;
          gap: 10px;
        }

        .project-empty-node {
          border: 1px dashed #cbd5e1;
          border-radius: 16px;
          color: #64748b;
          background: #f8fafc;
          padding: 12px;
          text-align: center;
          font-size: 12px;
          font-weight: 800;
        }

        .project-root-footer {
          display: grid;
          grid-template-columns: auto auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          justify-content: center;
          border-top: 1px solid #e2e8f0;
          padding-top: 14px;
        }

        .project-root-footer span {
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .project-root-footer strong {
          color: #0f172a;
          font-size: 18px;
        }

        @media (max-width: 1100px) {
          .project-analytics-two,
          .project-analytics-head {
            grid-template-columns: 1fr;
            display: grid;
          }

          .project-progress-ring {
            justify-self: start;
          }

          .project-team-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .project-people-strip {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 980px) {
          .project-summary-grid,
          .project-graph-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .project-form-grid,
          .project-grid-two,
          .project-progress-form,
          .project-analytics-two,
          .project-root-branches {
            grid-template-columns: 1fr;
          }

          .project-root-branches::before {
            display: none;
          }
        }

        @media (max-width: 620px) {
          .projects-hero,
          .project-form,
          .project-card,
          .project-analytics-panel,
          .project-spider-map {
            border-radius: 20px;
            padding: 16px;
          }

          .project-summary-grid,
          .project-graph-grid,
          .project-team-grid,
          .project-people-strip {
            grid-template-columns: 1fr;
          }

          .project-card-head {
            flex-direction: column;
          }

          .project-toolbar {
            align-items: stretch;
          }

          .project-tabs,
          .project-btn,
          .project-tab {
            width: 100%;
          }

          .project-rank-card {
            grid-template-columns: 1fr;
          }

          .project-rank-progress span {
            text-align: left;
          }

          .project-root-footer {
            grid-template-columns: 1fr;
            justify-items: start;
          }
        }
      `}</style>

      <section className="projects-hero">
        <span className="project-kicker">Project Management</span>
        <h1>Team Projects, Collaborators & Daily Progress</h1>
        <p>
          Team Leaders and Reporting Officers can create projects, assign team members,
          and add collaborators. Employees and team members can view scoped projects
          and update only project status/progress.
        </p>

        <div className="project-permission-note">
          Current access:{' '}
          {canManageProjectSetup
            ? 'You can create projects, assign team members, add collaborators, and update progress.'
            : 'You can view scoped projects and update progress/status only when you are assigned or added as collaborator.'}
        </div>

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

      {error && <div className="project-alert project-alert-error">{error}</div>}
      {message && <div className="project-alert project-alert-success">{message}</div>}

      <ProjectAnalyticsGraph projects={projects} />

      {canManageProjectSetup ? (
        <form className="project-form" onSubmit={handleCreateProject}>
          <h2 className="project-section-title">Create New Project</h2>

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
                <option value="">Select department</option>
                {departments.map((department) => (
                  <option value={department} key={department}>
                    {department}
                  </option>
                ))}
              </select>
            </div>

            <div className="project-field project-field-full">
              <label>Description</label>
              <textarea
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
                placeholder="Short project details"
                rows={3}
              />
            </div>

            <MultiSelect
              label="Assign Team Members"
              value={form.assigned_employee_ids}
              options={employees}
              onChange={(value) => updateForm('assigned_employee_ids', value)}
              helper="Only mapped team/reporting members are shown here."
            />

            <MultiSelect
              label="Add Collaborators"
              value={form.collaborator_ids}
              options={employees}
              onChange={(value) => updateForm('collaborator_ids', value)}
              helper="Collaborators can support and update project progress."
            />
          </div>

          <div className="project-actions" style={{ marginTop: 16 }}>
            <button type="submit" className="project-btn project-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Create Active Project'}
            </button>
          </div>
        </form>
      ) : (
        <section className="project-form">
          <h2 className="project-section-title">Project Creation Restricted</h2>
          <p className="project-muted">
            Project creation, team assignment, and collaborator updates are available only
            for Team Leaders and Reporting Officers. You can still update progress/status
            on projects where you are assigned or added as a collaborator.
          </p>
        </section>
      )}

      <section className="project-list">
        <div className="project-toolbar">
          <h2 className="project-section-title" style={{ margin: 0 }}>
            Project List
          </h2>

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