import { useEffect, useMemo, useState } from 'react';
import {
  addProjectProgress,
  assignProject,
  createProject,
  currentUser,
  getEmployeeDashboard,
  getProjects,
  listCollection,
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
    item.project_name ||
    item.title ||
    item.email ||
    'Unnamed'
  );
}

function normalizeRoles(user = {}) {
  const roles = user.roles;

  if (Array.isArray(roles)) {
    return roles.map((role) => String(role || '').trim()).filter(Boolean);
  }

  if (typeof roles === 'string') {
    return roles.split(',').map((role) => role.trim()).filter(Boolean);
  }

  return [];
}

function isAdminLikeUser(user = {}) {
  const roles = normalizeRoles(user);

  return roles.some((role) =>
    [
      'super_admin',
      'admin',
      'hr_admin',
      'hr_manager',
      'hr',
    ].includes(role),
  );
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
  const user = currentUser();
  const isAdminLike = isAdminLikeUser(user);

  if (isAdminLike) {
    return allEmployees;
  }

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

function MultiSelect({ label, value = [], options = [], onChange, helper }) {
  const selected = Array.isArray(value) ? value : [];

  function toggle(id) {
    if (!id) return;

    if (selected.includes(id)) {
      onChange(selected.filter((item) => item !== id));
      return;
    }

    onChange([...selected, id]);
  }

  return (
    <div className="project-field">
      <label>{label}</label>

      <div className="project-select-list">
        {options.map((employee) => {
          const id = String(getId(employee));
          const checked = selected.includes(id);

          return (
            <button
              type="button"
              key={id}
              className={`project-check ${checked ? 'is-active' : ''}`}
              onClick={() => toggle(id)}
            >
              <span className="project-check-box">{checked ? '✓' : ''}</span>
              <span>
                <strong>{getName(employee)}</strong>
                <small>
                  {employee.department || 'No department'}
                  {employee.designation ? ` • ${employee.designation}` : ''}
                </small>
              </span>
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

function ProjectCard({
  project,
  employees,
  onStatusChange,
  onAssign,
  onProgressSubmit,
}) {
  const projectId = String(getId(project));
  const status = normalizeStatus(project.status);
  const [assignedIds, setAssignedIds] = useState(project.assigned_employee_ids || []);
  const [collaboratorIds, setCollaboratorIds] = useState(project.collaborator_ids || []);
  const [progressPercent, setProgressPercent] = useState(
    project.latest_progress || project.progress_percent || '',
  );
  const [progressNote, setProgressNote] = useState('');

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
            {project.team_leader_name ? ` • ${project.team_leader_name}` : ''}
          </p>
        </div>

        <span className={`project-status project-status-${status}`}>
          {status === 'completed' ? 'Completed' : status === 'on_hold' ? 'On Hold' : 'Active'}
        </span>
      </div>

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
        </p>
      </div>

      <div className="project-grid-two">
        <MultiSelect
          label="Assigned Team Members"
          value={assignedIds}
          options={employees}
          onChange={setAssignedIds}
          helper="Team Leader can assign one or multiple employees."
        />

        <MultiSelect
          label="Collaborators"
          value={collaboratorIds}
          options={employees}
          onChange={setCollaboratorIds}
          helper="Add multiple collaborators to support this project."
        />
      </div>

      <div className="project-actions">
        <button type="button" className="project-btn project-btn-soft" onClick={saveAssignment}>
          Save Assignment
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
  const [filter, setFilter] = useState('active');

  const [form, setForm] = useState({
    name: '',
    description: '',
    department: '',
    status: 'active',
    assigned_employee_ids: [],
    collaborator_ids: [],
  });

  const activeProjects = useMemo(
    () => projects.filter((project) => normalizeStatus(project.status) === 'active'),
    [projects],
  );

  const completedProjects = useMemo(
    () => projects.filter((project) => normalizeStatus(project.status) === 'completed'),
    [projects],
  );

  const visibleProjects = useMemo(() => {
    if (filter === 'completed') return completedProjects;
    if (filter === 'all') return projects;
    return activeProjects;
  }, [activeProjects, completedProjects, filter, projects]);

  const departments = useMemo(() => {
    const values = employees
      .map((employee) => employee.department)
      .filter(Boolean);

    return [...new Set(values)].sort();
  }, [employees]);

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
            radial-gradient(circle at 10% 10%, rgba(79, 70, 229, .12), transparent 34%),
            radial-gradient(circle at 90% 0%, rgba(5, 150, 105, .12), transparent 30%),
            #ffffff;
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
          max-width: 860px;
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

        .project-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-top: 22px;
        }

        .project-summary-card,
        .project-form,
        .project-card {
          border: 1px solid #e2e8f0;
          background: #ffffff;
          border-radius: 24px;
          box-shadow: 0 14px 38px rgba(15, 23, 42, .07);
        }

        .project-summary-card {
          padding: 18px;
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

        .project-check {
          width: 100%;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #ffffff;
          padding: 10px;
          display: flex;
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

        .project-check strong {
          display: block;
          color: #0f172a;
          font-size: 13px;
        }

        .project-check small {
          display: block;
          margin-top: 3px;
          color: #64748b;
          font-size: 11px;
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

        .project-completed-note {
          border: 1px solid #c7d2fe;
          color: #4338ca;
          background: #eef2ff;
          padding: 13px 14px;
          border-radius: 16px;
          font-weight: 800;
          font-size: 13px;
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

        @media (max-width: 980px) {
          .project-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .project-form-grid,
          .project-grid-two,
          .project-progress-form {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 620px) {
          .projects-hero,
          .project-form,
          .project-card {
            border-radius: 20px;
            padding: 16px;
          }

          .project-summary-grid {
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
        }
      `}</style>

      <section className="projects-hero">
        <span className="project-kicker">Project Management</span>
        <h1>Team Projects, Collaborators & Daily Progress</h1>
        <p>
          Team Leaders can create active projects, assign multiple team members,
          add collaborators, update status, and track daily project progress.
          Completed projects are kept for dashboard reporting but removed from
          active handover dropdowns.
        </p>

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
            <strong>{projectSummary.average_progress || 0}%</strong>
          </div>
        </div>
      </section>

      {error && <div className="project-alert project-alert-error">{error}</div>}
      {message && <div className="project-alert project-alert-success">{message}</div>}

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
          />

          <MultiSelect
            label="Add Collaborators"
            value={form.collaborator_ids}
            options={employees}
            onChange={(value) => updateForm('collaborator_ids', value)}
          />
        </div>

        <div className="project-actions" style={{ marginTop: 16 }}>
          <button type="submit" className="project-btn project-btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Create Active Project'}
          </button>
        </div>
      </form>

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
              onStatusChange={handleStatusChange}
              onAssign={handleAssign}
              onProgressSubmit={handleProgressSubmit}
            />
          ))}
      </section>
    </div>
  );
}