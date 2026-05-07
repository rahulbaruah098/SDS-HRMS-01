import { useState } from 'react';
import { currentUser, currentEmployee, api } from '../api/client';

function normalizeRoles(user) {
  const userRoles = user?.roles;

  if (Array.isArray(userRoles)) {
    return userRoles
      .map((role) => String(role || '').trim())
      .filter(Boolean);
  }

  if (typeof userRoles === 'string') {
    return userRoles
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean);
  }

  return [];
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (Array.isArray(value)) {
    return value.join(', ') || '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return String(value);
}

function boolLabel(value) {
  const normalized = String(value || '').toLowerCase();

  if (['true', 'yes', '1', 'on'].includes(normalized)) {
    return 'Yes';
  }

  return 'No';
}

function ProfileTable({ title, rows }) {
  return (
    <section className="panel">
      <h3>{title}</h3>

      <div className="table-wrap">
        <table>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{displayValue(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Profile() {
  const user = currentUser();
  const employee = currentEmployee();
  const userRoles = normalizeRoles(user);

  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setMessage('');

    if (!form.current_password.trim()) {
      setMessage('Current password is required');
      return;
    }

    if (!form.new_password || form.new_password.length < 6) {
      setMessage('New password must be at least 6 characters');
      return;
    }

    if (form.new_password !== form.confirm_password) {
      setMessage('New password and confirm password do not match');
      return;
    }

    try {
      setSubmitting(true);

      const data = await api('/password-requests', {
        method: 'POST',
        body: JSON.stringify({
          current_password: form.current_password,
          new_password: form.new_password,
        }),
      });

      setMessage(data.message || 'Password change request submitted');
      setForm({
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
    } catch (error) {
      setMessage(error.message || 'Unable to submit password change request');
    } finally {
      setSubmitting(false);
    }
  }

  const personalRows = [
    ['Name', user.name || employee.name || ''],
    ['Email', user.email || employee.email || ''],
    ['Phone', employee.phone || ''],
    ['Gender', employee.gender || ''],
    ['Date Of Birth', employee.date_of_birth || ''],
    ['Blood Group', employee.blood_group || ''],
    ['Father\'s Name', employee.father_name || ''],
    ['Religion', employee.religion || ''],
    ['Marital Status', employee.marital_status || ''],
    ['Speak Language', employee.speak_language || ''],
    ['Address', employee.address || ''],
  ];

  const employmentRows = [
    ['Employee ID', employee.employee_id || ''],
    ['Employee Code', employee.emp_code || ''],
    ['Tenant', user.tenant_id || employee.tenant_id || ''],
    ['Roles', userRoles.join(', ')],
    ['Role', employee.role || ''],
    ['Department', employee.department || ''],
    ['Designation', employee.designation || ''],
    ['Branch', employee.branch || ''],
    ['Shift', employee.shift || ''],
    ['Joining Date', employee.joining_date || employee.doj || ''],
    ['Employee Type', employee.employee_type || employee.job_type || ''],
    ['Skill Level', employee.skill_level || ''],
    ['Employment Status', employee.employment_status || employee.status || ''],
    ['Project', employee.project || ''],
    ['State', employee.state || ''],
  ];

  const salaryAndStatutoryRows = [
    ['Gross Salary', employee.gross_salary || employee.salary || ''],
    ['Payment Mode', employee.payment_mode || ''],
    ['PAN No', employee.pan_no || ''],
    ['Aadhar No', employee.aadhar_no || ''],
    ['Employee UAN No', employee.employee_uan_no || ''],
    ['Employee ESIC IP', employee.employee_esic_ip || ''],
  ];

  const familyAndDisabilityRows = [
    ['Are Parents Senior Citizen?', boolLabel(employee.are_parents_senior_citizen)],
    ['Number of Children', employee.number_of_children || ''],
    ['No. of Children in Hostel', employee.children_in_hostel || ''],
    ['Disability Level', employee.disability_level || ''],
    ['Dependent Disability Level', employee.dependent_disability_level || ''],
  ];

  const previousEmploymentRows = [
    ['Previous Employer Name', employee.previous_employer_name || ''],
    ['Previous Designation', employee.previous_designation || ''],
    [
      'Previous Employment Tenure From Date',
      employee.previous_employment_tenure_from_date || '',
    ],
    [
      'Previous Employment Tenure End Date',
      employee.previous_employment_tenure_end_date || '',
    ],
  ];

  const reportingRows = [
    ['Is Team Leader', boolLabel(employee.is_team_leader)],
    ['Is Reporting Officer', boolLabel(employee.is_reporting_officer)],
    ['Team Leader ID', employee.team_leader_id || ''],
    ['Team Leader Name', employee.team_leader_name || ''],
    ['Reporting Officer ID', employee.reporting_officer_id || ''],
    ['Reporting Officer Name', employee.reporting_officer_name || ''],
  ];

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">My Profile</span>

          <h1>{user.name || employee.name || user.email || 'My Profile'}</h1>

          <p>
            {userRoles.join(', ')}
            {user.tenant_id || employee.tenant_id
              ? ` • ${user.tenant_id || employee.tenant_id}`
              : ''}
          </p>
        </div>
      </section>

      <ProfileTable title="Personal Details" rows={personalRows} />

      <ProfileTable title="Employment Details" rows={employmentRows} />

      <ProfileTable title="Salary & Statutory Details" rows={salaryAndStatutoryRows} />

      <ProfileTable title="Family & Disability Details" rows={familyAndDisabilityRows} />

      <ProfileTable title="Previous Employment Details" rows={previousEmploymentRows} />

      <ProfileTable title="Reporting Hierarchy" rows={reportingRows} />

      <section className="panel">
        <h3>Request Password Change</h3>
        <p>Your request will be sent to Super Admin for approval.</p>

        <form className="dynamic-form" onSubmit={submit}>
          <label>
            Current Password
            <input
              type="password"
              value={form.current_password}
              onChange={(e) =>
                setForm({ ...form, current_password: e.target.value })
              }
            />
          </label>

          <label>
            New Password
            <input
              type="password"
              value={form.new_password}
              onChange={(e) =>
                setForm({ ...form, new_password: e.target.value })
              }
            />
          </label>

          <label>
            Confirm New Password
            <input
              type="password"
              value={form.confirm_password}
              onChange={(e) =>
                setForm({ ...form, confirm_password: e.target.value })
              }
            />
          </label>

          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Send Approval Request'}
          </button>
        </form>

        {message && <div className="inline-message">{message}</div>}
      </section>
    </div>
  );
}