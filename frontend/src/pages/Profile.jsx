import { useState } from 'react';
import { currentUser, currentEmployee, api } from '../api/client';

export default function Profile() {
  const user = currentUser();
  const employee = currentEmployee();

  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const [message, setMessage] = useState('');

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
      setMessage(error.message);
    }
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">My Profile</span>

          <h1>{user.name || user.email || 'My Profile'}</h1>

          <p>
            {(user.roles || []).join(', ')}
            {user.tenant_id ? ` • ${user.tenant_id}` : ''}
          </p>
        </div>
      </section>

      <section className="panel">
        <h3>Profile Details</h3>

        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th>Name</th>
                <td>{user.name || employee.name || ''}</td>
              </tr>

              <tr>
                <th>Email</th>
                <td>{user.email || employee.email || ''}</td>
              </tr>

              <tr>
                <th>Roles</th>
                <td>{(user.roles || []).join(', ')}</td>
              </tr>

              <tr>
                <th>Tenant</th>
                <td>{user.tenant_id || employee.tenant_id || ''}</td>
              </tr>

              <tr>
                <th>Employee Code</th>
                <td>{employee.emp_code || ''}</td>
              </tr>

              <tr>
                <th>Department</th>
                <td>{employee.department || ''}</td>
              </tr>

              <tr>
                <th>Designation</th>
                <td>{employee.designation || ''}</td>
              </tr>

              <tr>
                <th>Job Type</th>
                <td>{employee.job_type || ''}</td>
              </tr>

              <tr>
                <th>Project</th>
                <td>{employee.project || ''}</td>
              </tr>

              <tr>
                <th>State</th>
                <td>{employee.state || ''}</td>
              </tr>

              <tr>
                <th>Status</th>
                <td>{employee.status || ''}</td>
              </tr>

              <tr>
                <th>Team Leader</th>
                <td>{employee.team_leader_name || ''}</td>
              </tr>

              <tr>
                <th>Reporting Officer</th>
                <td>{employee.reporting_officer_name || ''}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

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

          <button type="submit" className="primary">
            Send Approval Request
          </button>
        </form>

        {message && <div className="inline-message">{message}</div>}
      </section>
    </div>
  );
}