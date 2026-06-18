import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  FileText,
  RefreshCcw,
  Send,
  UserCheck,
} from 'lucide-react';
import {
  applyLeaveRequest,
  getLeaveOptions,
} from '../api/client';

const HR_ADMIN_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
]);

const ADMIN_ROLES = new Set([
  'super_admin',
  'admin',
]);

const HR_ROLES = new Set([
  'hr_admin',
  'hr_manager',
  'hr',
]);

const today = new Date().toISOString().slice(0, 10);

const EMPTY_FORM = {
  leave_type: 'CL',
  from_date: today,
  to_date: today,
  day_type: 'full_day',
  reason: '',
  project_handover_id: '',
  work_project_name: '',
  task_handover_to_id: '',
};

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function normalizeRoles(user = {}) {
  const roles = new Set();

  if (Array.isArray(user.roles)) {
    user.roles.forEach((role) => {
      const normalized = normalizeRole(role);
      if (normalized) roles.add(normalized);
    });
  }

  if (typeof user.roles === 'string') {
    user.roles.split(',').forEach((role) => {
      const normalized = normalizeRole(role);
      if (normalized) roles.add(normalized);
    });
  }

  const role = normalizeRole(user.role);
  if (role) roles.add(role);

  return Array.from(roles);
}

function hasAnyRole(userRoles, roleSet) {
  return userRoles.some((role) => roleSet.has(role));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }

  return '';
}

function getEmployeeProfile(user = {}) {
  const employee = user.employee || user.employee_summary || user.employee_profile || {};

  return {
    employee_name: firstNonEmpty(
      employee.name,
      employee.employee_name,
      employee.full_name,
      user.name,
      user.full_name,
      user.email,
    ),
    employee_code: firstNonEmpty(
      employee.employee_code,
      employee.emp_code,
      employee.code,
      user.employee_code,
      user.emp_code,
      user.code,
    ),
    department: firstNonEmpty(employee.department, user.department),
    designation: firstNonEmpty(employee.designation, user.designation),
    team_leader_id: firstNonEmpty(
      employee.team_leader_id,
      employee.team_leader_employee_id,
      user.team_leader_id,
      user.team_leader_employee_id,
    ),
    team_leader_name: firstNonEmpty(employee.team_leader_name, user.team_leader_name),
    reporting_officer_id: firstNonEmpty(
      employee.reporting_officer_id,
      employee.reporting_officer_employee_id,
      user.reporting_officer_id,
      user.reporting_officer_employee_id,
    ),
    reporting_officer_name: firstNonEmpty(
      employee.reporting_officer_name,
      user.reporting_officer_name,
    ),
  };
}

function projectName(project = {}) {
  return (
    project.name ||
    project.project_name ||
    project.title ||
    project.project_title ||
    'Project'
  );
}

function memberName(member = {}) {
  const name =
    member.name ||
    member.employee_name ||
    member.full_name ||
    member.email ||
    'Employee';

  const code =
    member.employee_code ||
    member.emp_code ||
    member.employee_id ||
    member.code ||
    '';

  return code ? `${name} (${code})` : name;
}

function daysBetween(fromDate, toDate, dayType) {
  if (dayType === 'half_day') return 0.5;

  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate || fromDate}T00:00:00`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return 1;
  }

  const diff = Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1;

  return diff > 0 ? diff : 1;
}

export default function ApplyLeave({ user }) {
  const userRoles = useMemo(() => normalizeRoles(user), [user]);
  const isHrAdminUser = hasAnyRole(userRoles, HR_ADMIN_ROLES);
  const isAdminUser = hasAnyRole(userRoles, ADMIN_ROLES);
  const isHrUser = hasAnyRole(userRoles, HR_ROLES) && !isAdminUser;
  const employeeProfile = useMemo(() => getEmployeeProfile(user), [user]);

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
  const [message, setMessage] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const leaveDays = useMemo(
    () => daysBetween(form.from_date, form.to_date, form.day_type),
    [form.from_date, form.to_date, form.day_type],
  );

  const approvalText = useMemo(() => {
    if (isHrUser) return 'This leave request will be sent to Admin for approval.';
    if (isAdminUser) return 'This leave request will be sent to HR for approval.';

    const teamLeaderName = employeeProfile.team_leader_name;
    const reportingOfficerName = employeeProfile.reporting_officer_name;
    const teamLeaderId = String(employeeProfile.team_leader_id || '').trim();
    const reportingOfficerId = String(employeeProfile.reporting_officer_id || '').trim();

    const sameTeamLeaderAndReportingOfficer = Boolean(
      teamLeaderName &&
      reportingOfficerName &&
      (
        (
          teamLeaderId &&
          reportingOfficerId &&
          teamLeaderId === reportingOfficerId
        ) ||
        teamLeaderName.trim().toLowerCase() === reportingOfficerName.trim().toLowerCase()
      )
    );

    if (sameTeamLeaderAndReportingOfficer) {
      return `This leave request will be sent to ${teamLeaderName} for approval.`;
    }

    if (teamLeaderName && reportingOfficerName) {
      return `This leave request will be sent to ${teamLeaderName} first, then ${reportingOfficerName}.`;
    }

    if (teamLeaderName) {
      return `This leave request will be sent to ${teamLeaderName} for approval.`;
    }

    if (reportingOfficerName) {
      return `This leave request will be sent to ${reportingOfficerName} for approval.`;
    }

    return 'This leave request will be sent to HR.';
  }, [isHrUser, isAdminUser, employeeProfile]);

  async function loadOptions() {
    try {
      setLoadingOptions(true);

      const data = await getLeaveOptions();

      setProjects(data.projects || []);
      setMembers(data.task_handover_options || data.members || []);
    } catch (error) {
      setProjects([]);
      setMembers([]);
      setMessage(error.message || 'Unable to load leave options.');
    } finally {
      setLoadingOptions(false);
    }
  }

  useEffect(() => {
    loadOptions();
  }, []);

  function updateForm(key, value) {
    setForm((current) => {
      const next = {
        ...current,
        [key]: value,
      };

      if (key === 'leave_type' && value === 'HALF-DAY') {
        next.day_type = 'half_day';
        next.to_date = next.from_date;
      }

      if (key === 'day_type' && value === 'half_day') {
        next.leave_type = 'HALF-DAY';
        next.to_date = next.from_date;
      }

      if (key === 'from_date' && current.day_type === 'half_day') {
        next.to_date = value;
      }

      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage('');

    if (!form.from_date || !form.to_date) {
      setMessage('From date and to date are required.');
      return;
    }

    if (form.to_date < form.from_date) {
      setMessage('To date cannot be before from date.');
      return;
    }

    if (!form.reason.trim()) {
      setMessage('Leave reason is required.');
      return;
    }

    if (isHrAdminUser && !form.work_project_name.trim() && !form.project_handover_id) {
      setMessage('Please enter your work/project details before applying leave.');
      return;
    }

    try {
      setSubmitting(true);

      const selectedProject = projects.find((project) => String(project._id || project.id) === form.project_handover_id);

      const payload = {
        leave_type: form.day_type === 'half_day' ? 'HALF-DAY' : form.leave_type,
        from_date: form.from_date,
        to_date: form.to_date,
        upto_date: form.to_date,
        day_type: form.day_type,
        is_half_day: form.day_type === 'half_day',
        leave_days: leaveDays,
        reason: form.reason.trim(),
        task_handover_to_id: form.task_handover_to_id,
        project_handover_id: form.project_handover_id,
        project_handover_name: selectedProject ? projectName(selectedProject) : '',
        work_project_name: form.work_project_name.trim(),
        manual_project_name: form.work_project_name.trim(),
      };

      const data = await applyLeaveRequest(payload);

      setMessage(data.message || 'Leave request submitted successfully.');

      setForm({
        ...EMPTY_FORM,
        from_date: today,
        to_date: today,
      });
    } catch (error) {
      setMessage(error.message || 'Unable to submit leave request.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="apply-leave-page">
      <style>
        {`
          .apply-leave-page {
            display: grid;
            gap: 24px;
          }

          .apply-leave-hero {
            border: 1px solid #E2E8F0;
            border-radius: 32px;
            padding: 34px;
            background:
              radial-gradient(circle at top left, rgba(79, 70, 229, 0.12), transparent 34%),
              radial-gradient(circle at top right, rgba(14, 165, 233, 0.10), transparent 32%),
              linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%);
            box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
            display: flex;
            justify-content: space-between;
            gap: 24px;
            align-items: flex-start;
          }

          .apply-leave-kicker {
            display: inline-flex;
            padding: 8px 13px;
            border-radius: 999px;
            background: #EEF2FF;
            color: #4338CA;
            font-size: 12px;
            font-weight: 950;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            margin-bottom: 14px;
          }

          .apply-leave-hero h1 {
            margin: 0;
            color: #0F172A;
            font-size: clamp(34px, 4vw, 52px);
            line-height: 1;
            letter-spacing: -0.06em;
          }

          .apply-leave-hero p {
            margin: 16px 0 0;
            max-width: 820px;
            color: #64748B;
            font-size: 15px;
            line-height: 1.7;
          }

          .apply-leave-refresh {
            min-height: 48px;
            padding: 0 18px;
            border-radius: 16px;
            border: 1px solid #C7D2FE;
            background: #FFFFFF;
            color: #4338CA;
            font-weight: 900;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            white-space: nowrap;
          }

          .apply-leave-alert {
            padding: 14px 16px;
            border-radius: 18px;
            border: 1px solid #BFDBFE;
            background: #EFF6FF;
            color: #1D4ED8;
            font-weight: 750;
          }

          .apply-leave-layout {
            display: grid;
            grid-template-columns: minmax(340px, 0.75fr) minmax(0, 1.25fr);
            gap: 24px;
            align-items: start;
          }

          .apply-leave-panel {
            border: 1px solid #E2E8F0;
            border-radius: 28px;
            background: #FFFFFF;
            box-shadow: 0 14px 38px rgba(15, 23, 42, 0.07);
            padding: 24px;
            min-width: 0;
          }

          .apply-leave-panel h2,
          .apply-leave-panel h3 {
            margin: 0;
            color: #0F172A;
            letter-spacing: -0.035em;
          }

          .apply-leave-panel p {
            color: #64748B;
            line-height: 1.55;
          }

          .apply-leave-profile-grid {
            display: grid;
            gap: 12px;
          }

          .apply-leave-profile-grid div,
          .apply-leave-summary-card {
            border: 1px solid #E2E8F0;
            background: #F8FAFC;
            border-radius: 18px;
            padding: 14px;
          }

          .apply-leave-profile-grid span,
          .apply-leave-summary-card span {
            display: block;
            color: #64748B;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            margin-bottom: 6px;
          }

          .apply-leave-profile-grid strong,
          .apply-leave-summary-card strong {
            color: #0F172A;
            overflow-wrap: anywhere;
          }

          .apply-leave-summary {
            display: grid;
            gap: 12px;
            margin-top: 18px;
          }

          .apply-leave-summary-card.info {
            background: #EEF2FF;
            border-color: #C7D2FE;
            color: #4338CA;
          }

          .apply-leave-summary-card.info strong {
            color: #312E81;
          }

          .apply-leave-form {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
          }

          .apply-leave-field {
            display: grid;
            gap: 8px;
          }

          .apply-leave-field.full {
            grid-column: 1 / -1;
          }

          .apply-leave-field label {
            color: #475569;
            font-size: 13px;
            font-weight: 900;
          }

          .apply-leave-field input,
          .apply-leave-field select,
          .apply-leave-field textarea {
            width: 100%;
            min-height: 48px;
            border-radius: 16px;
            border: 1px solid #CBD5E1;
            background: #FFFFFF;
            color: #0F172A;
            padding: 0 14px;
            outline: none;
            font-size: 14px;
          }

          .apply-leave-field textarea {
            min-height: 125px;
            padding: 14px;
            resize: vertical;
          }

          .apply-leave-field input:focus,
          .apply-leave-field select:focus,
          .apply-leave-field textarea:focus {
            border-color: #818CF8;
            box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.12);
          }

          .apply-leave-submit {
            grid-column: 1 / -1;
            min-height: 52px;
            border: 0;
            border-radius: 18px;
            background: linear-gradient(135deg, #4F46E5, #2563EB);
            color: #FFFFFF;
            font-weight: 950;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 9px;
            box-shadow: 0 16px 32px rgba(37, 99, 235, 0.22);
          }

          .apply-leave-submit:disabled,
          .apply-leave-refresh:disabled {
            opacity: 0.7;
            cursor: not-allowed;
          }

          @media (max-width: 1050px) {
            .apply-leave-layout {
              grid-template-columns: 1fr;
            }
          }

          @media (max-width: 720px) {
            .apply-leave-hero {
              flex-direction: column;
              padding: 22px;
              border-radius: 24px;
            }

            .apply-leave-refresh {
              width: 100%;
              justify-content: center;
            }

            .apply-leave-panel {
              padding: 20px;
              border-radius: 24px;
            }

            .apply-leave-form {
              grid-template-columns: 1fr;
            }

            .apply-leave-field.full,
            .apply-leave-submit {
              grid-column: auto;
            }
          }
        `}
      </style>

      <section className="apply-leave-hero">
        <div>
          <span className="apply-leave-kicker">Apply Leave</span>
          <h1>Submit Leave Request</h1>
          <p>
            Apply leave using a clean form. Employee details are automatically
            taken from your profile. HR/Admin users must mention their work or
            project details before submitting leave.
          </p>
        </div>

        <button
          type="button"
          className="apply-leave-refresh"
          onClick={loadOptions}
          disabled={loadingOptions}
        >
          <RefreshCcw size={16} />
          {loadingOptions ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      {message ? <div className="apply-leave-alert">{message}</div> : null}

      <section className="apply-leave-layout">
        <aside className="apply-leave-panel">
          <h2>Profile Summary</h2>
          <p>These details are auto-filled from your employee profile.</p>

          <div className="apply-leave-profile-grid">
            <div>
              <span>Employee</span>
              <strong>{employeeProfile.employee_name || '—'}</strong>
            </div>

            <div>
              <span>Employee Code</span>
              <strong>{employeeProfile.employee_code || '—'}</strong>
            </div>

            <div>
              <span>Department</span>
              <strong>{employeeProfile.department || '—'}</strong>
            </div>

            <div>
              <span>Designation</span>
              <strong>{employeeProfile.designation || '—'}</strong>
            </div>

            <div>
              <span>Team Leader</span>
              <strong>{employeeProfile.team_leader_name || '—'}</strong>
            </div>

            <div>
              <span>Reporting Officer</span>
              <strong>{employeeProfile.reporting_officer_name || '—'}</strong>
            </div>
          </div>

          <div className="apply-leave-summary">
            <div className="apply-leave-summary-card info">
              <span>Approval Flow</span>
              <strong>{approvalText}</strong>
            </div>

            <div className="apply-leave-summary-card">
              <span>Calculated Days</span>
              <strong>{leaveDays}</strong>
            </div>
          </div>
        </aside>

        <main className="apply-leave-panel">
          <h3>Leave Details</h3>
          <p>Fill the required leave details and submit for approval.</p>

          <form className="apply-leave-form" onSubmit={handleSubmit}>
            <div className="apply-leave-field">
              <label>Leave Type</label>
              <select
                value={form.leave_type}
                onChange={(event) => updateForm('leave_type', event.target.value)}
              >
                <option value="CL">Casual Leave</option>
                <option value="EL">Earned Leave</option>
                <option value="COMP-OFF">Comp-Off</option>
                <option value="HALF-DAY">Half Day</option>
              </select>
            </div>

            <div className="apply-leave-field">
              <label>Day Type</label>
              <select
                value={form.day_type}
                onChange={(event) => updateForm('day_type', event.target.value)}
              >
                <option value="full_day">Full Day</option>
                <option value="half_day">Half Day</option>
              </select>
            </div>

            <div className="apply-leave-field">
              <label>From Date</label>
              <input
                type="date"
                min={today}
                value={form.from_date}
                onChange={(event) => updateForm('from_date', event.target.value)}
              />
            </div>

            <div className="apply-leave-field">
              <label>To Date</label>
              <input
                type="date"
                min={form.from_date || today}
                value={form.to_date}
                disabled={form.day_type === 'half_day'}
                onChange={(event) => updateForm('to_date', event.target.value)}
              />
            </div>

            {isHrAdminUser ? (
              <>
                <div className="apply-leave-field">
                  <label>Assigned Project</label>
                  <select
                    value={form.project_handover_id}
                    onChange={(event) => updateForm('project_handover_id', event.target.value)}
                  >
                    <option value="">
                      {projects.length ? 'Select assigned project if applicable' : 'No assigned project'}
                    </option>

                    {projects.map((project) => {
                      const id = project._id || project.id || '';
                      return (
                        <option key={id || projectName(project)} value={id}>
                          {projectName(project)}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="apply-leave-field">
                  <label>Work / Project Details</label>
                  <input
                    type="text"
                    value={form.work_project_name}
                    placeholder="Type your current work or project manually"
                    onChange={(event) => updateForm('work_project_name', event.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="apply-leave-field">
                  <label>Project Handover</label>
                  <select
                    value={form.project_handover_id}
                    onChange={(event) => updateForm('project_handover_id', event.target.value)}
                  >
                    <option value="">No project handover</option>

                    {projects.map((project) => {
                      const id = project._id || project.id || '';
                      return (
                        <option key={id || projectName(project)} value={id}>
                          {projectName(project)}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="apply-leave-field">
                  <label>Task Handover To</label>
                  <select
                    value={form.task_handover_to_id}
                    onChange={(event) => updateForm('task_handover_to_id', event.target.value)}
                  >
                    <option value="">No handover required</option>

                    {members.map((member) => {
                      const id = member._id || member.id || member.employee_id || '';
                      return (
                        <option key={id || memberName(member)} value={id}>
                          {memberName(member)}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </>
            )}

            <div className="apply-leave-field full">
              <label>Leave Reason</label>
              <textarea
                value={form.reason}
                placeholder="Write the reason for leave"
                onChange={(event) => updateForm('reason', event.target.value)}
              />
            </div>

            <button
              type="submit"
              className="apply-leave-submit"
              disabled={submitting}
            >
              <Send size={17} />
              {submitting ? 'Submitting...' : 'Submit Leave Request'}
            </button>
          </form>
        </main>
      </section>
    </div>
  );
}