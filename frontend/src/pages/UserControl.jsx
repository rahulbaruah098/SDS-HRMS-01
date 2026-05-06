import { useEffect, useState } from 'react';
import { Plus, Save, Search, KeyRound, X } from 'lucide-react';
import { api } from '../api/client';
import { emptyUser } from '../data/modules';

export default function UserControl() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ ...emptyUser });
  const [q, setQ] = useState('');
  const [tenant, setTenant] = useState('');
  const [edit, setEdit] = useState(null);
  const [message, setMessage] = useState('');
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetForm, setResetForm] = useState({
    password: '',
    confirm_password: '',
  });

  async function load() {
    const params = [];

    if (q.trim()) {
      params.push(`q=${encodeURIComponent(q.trim())}`);
    }

    if (tenant.trim()) {
      params.push(`tenant_id=${encodeURIComponent(tenant.trim())}`);
    }

    const data = await api(
      `/superadmin/users${params.length ? `?${params.join('&')}` : ''}`
    );

    setRows(data.items || []);
  }

  async function loadEmployeeOptions(tenantId = '') {
    const cleanTenant = (tenantId || tenant || '').trim();

    const url = cleanTenant
      ? `/employees?tenant_id=${encodeURIComponent(cleanTenant)}`
      : '/employees';

    const data = await api(url);
    const items = data.items || [];

    setEmployeeOptions(items);

    return items;
  }

  function resetCreateForm() {
    setForm({ ...emptyUser });
  }

  useEffect(() => {
    load().catch((error) => {
      console.error(error);
      setMessage(error.message || 'Unable to load users');
    });

    loadEmployeeOptions().catch(console.error);
  }, []);

  async function searchUsers() {
    try {
      await load();
      await loadEmployeeOptions();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function clearSearch() {
    setQ('');
    setTenant('');

    try {
      const data = await api('/superadmin/users');
      setRows(data.items || []);

      const empData = await api('/employees');
      setEmployeeOptions(empData.items || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function create(e) {
    e.preventDefault();

    try {
      const data = await api('/superadmin/users', {
        method: 'POST',
        body: JSON.stringify(form),
      });

      setMessage(data.message || 'User created successfully');
      resetCreateForm();
      await load();
      await loadEmployeeOptions(form.tenant_id);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function openEdit(user) {
    const employee = user.employee_profile || {};

    await loadEmployeeOptions(user.tenant_id);

    const editData = {
      ...employee,
      ...user,

      user_id_for_edit: user._id,
      employee_id_for_edit: employee._id || '',

      roles: (user.roles || []).join(', '),

      emp_code: employee.emp_code || '',
      department: employee.department || '',
      designation: employee.designation || '',
      job_type: employee.job_type || '',
      project: employee.project || '',
      state: employee.state || '',
      status: employee.status || 'Active',
      salary: employee.salary || 0,

      is_team_leader: String(employee.is_team_leader || 'false'),
      is_reporting_officer: String(employee.is_reporting_officer || 'false'),

      team_leader_id: employee.team_leader_id || '',
      reporting_officer_id: employee.reporting_officer_id || '',

      password: '',
      is_active: String(user.is_active !== false),
    };

    setEdit(editData);

    setTimeout(() => {
      document.getElementById('user-edit-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 100);
  }

  async function save(e) {
    e.preventDefault();

    try {
      const payload = { ...edit };

      delete payload.user_id_for_edit;
      delete payload.employee_id_for_edit;
      delete payload.employee_profile;
      delete payload.password_hash;

      payload.is_active =
        payload.is_active === true || payload.is_active === 'true';

      if (!payload.password) {
        delete payload.password;
      }

      const data = await api(`/superadmin/users/${edit.user_id_for_edit}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setMessage(data.message || 'User/profile updated successfully');
      setEdit(null);
      await load();
      await loadEmployeeOptions(payload.tenant_id);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function openReset(user) {
    setResetTarget(user);
    setResetForm({
      password: '',
      confirm_password: '',
    });

    setTimeout(() => {
      document.getElementById('password-reset-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 100);
  }

  async function submitReset(e) {
    e.preventDefault();

    if (!resetTarget?._id) {
      setMessage('No user selected for password reset');
      return;
    }

    if (!resetForm.password || resetForm.password.length < 6) {
      setMessage('Password must be at least 6 characters');
      return;
    }

    if (resetForm.password !== resetForm.confirm_password) {
      setMessage('Password and confirm password do not match');
      return;
    }

    try {
      const data = await api(`/superadmin/users/${resetTarget._id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: resetForm.password }),
      });

      setMessage(data.message || 'Password updated successfully');
      setResetTarget(null);
      setResetForm({
        password: '',
        confirm_password: '',
      });
    } catch (error) {
      setMessage(error.message);
    }
  }

  function renderEditField(key) {
    const label = key.replaceAll('_', ' ');

    if (key === 'is_active') {
      return (
        <label key={key}>
          {label}
          <select
            value={String(edit[key] ?? 'true')}
            onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      );
    }

    if (['is_team_leader', 'is_reporting_officer'].includes(key)) {
      return (
        <label key={key}>
          {label}
          <select
            value={String(edit[key] ?? 'false')}
            onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
      );
    }

    if (['team_leader_id', 'reporting_officer_id'].includes(key)) {
      return (
        <label key={key}>
          {label}
          <select
            value={edit[key] ?? ''}
            onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
          >
            <option value="">Select {label}</option>

            {employeeOptions
              .filter((emp) => emp._id !== edit.employee_id_for_edit)
              .map((emp) => (
                <option key={emp._id} value={emp._id}>
                  {emp.name} — {emp.designation || emp.department || emp.email}
                </option>
              ))}
          </select>
        </label>
      );
    }

    return (
      <label key={key}>
        {label}
        <input
          type={key === 'password' ? 'password' : 'text'}
          value={edit[key] ?? ''}
          placeholder={
            key === 'password'
              ? 'Leave blank if password should not change'
              : ''
          }
          onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
        />
      </label>
    );
  }

  const editFields = [
    'name',
    'email',
    'tenant_id',
    'roles',
    'password',
    'emp_code',
    'department',
    'designation',
    'job_type',
    'project',
    'state',
    'status',
    'salary',
    'is_active',
    'is_team_leader',
    'is_reporting_officer',
    'team_leader_id',
    'reporting_officer_id',
  ];

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">User + Profile + Password Control</span>
          <h1>User Control</h1>
          <p>
            Super Admin can create users, update employee profile, assign team
            leader, assign reporting officer, change roles and reset passwords.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={16} />

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search users..."
            />

            <input
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              placeholder="tenant_id filter"
            />

            <button type="button" onClick={searchUsers}>
              Search
            </button>

            {(q || tenant) && (
              <button type="button" className="secondary" onClick={clearSearch}>
                Clear
              </button>
            )}
          </div>
        </div>

        <form className="dynamic-form" onSubmit={create}>
          {Object.keys(emptyUser).map((key) => (
            <label key={key}>
              {key.replaceAll('_', ' ')}
              <input
                type={key === 'password' ? 'password' : 'text'}
                value={form[key] ?? ''}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}

          <button type="submit" className="primary">
            <Plus size={16} /> Create User
          </button>
        </form>

        {message && <div className="inline-message">{message}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Tenant</th>
                <th>Roles</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Team Leader</th>
                <th>Reporting Officer</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((user) => (
                <tr key={user._id}>
                  <td>{user.name || ''}</td>
                  <td>{user.email || ''}</td>
                  <td>{user.tenant_id || ''}</td>
                  <td>{(user.roles || []).join(', ')}</td>
                  <td>{user.employee_profile?.department || ''}</td>
                  <td>{user.employee_profile?.designation || ''}</td>
                  <td>{user.employee_profile?.team_leader_name || ''}</td>
                  <td>{user.employee_profile?.reporting_officer_name || ''}</td>
                  <td>{user.is_active ? 'Active' : 'Inactive'}</td>

                  <td>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => openEdit(user)}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="danger"
                      onClick={() => openReset(user)}
                    >
                      Reset Password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!rows.length && <div className="empty">No users found</div>}
        </div>
      </section>

      {edit && (
        <section className="panel" id="user-edit-section">
          <div className="toolbar">
            <div>
              <h3>Edit Complete User Profile</h3>
              <p>Update login details, employee profile and reporting hierarchy.</p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => setEdit(null)}
            >
              <X size={16} /> Close
            </button>
          </div>

          <form className="dynamic-form" onSubmit={save}>
            {editFields.map((key) => renderEditField(key))}

            <button type="submit" className="primary">
              <Save size={16} /> Save Changes
            </button>
          </form>
        </section>
      )}

      {resetTarget && (
        <section className="panel" id="password-reset-section">
          <div className="toolbar">
            <div>
              <h3>Reset Password</h3>
              <p>
                Reset password for <b>{resetTarget.name}</b> — {resetTarget.email}
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => setResetTarget(null)}
            >
              <X size={16} /> Close
            </button>
          </div>

          <form className="dynamic-form" onSubmit={submitReset}>
            <label>
              New Password
              <input
                type="password"
                value={resetForm.password}
                onChange={(e) =>
                  setResetForm({ ...resetForm, password: e.target.value })
                }
              />
            </label>

            <label>
              Confirm Password
              <input
                type="password"
                value={resetForm.confirm_password}
                onChange={(e) =>
                  setResetForm({
                    ...resetForm,
                    confirm_password: e.target.value,
                  })
                }
              />
            </label>

            <button type="submit" className="primary">
              <KeyRound size={16} /> Update Password
            </button>
          </form>
        </section>
      )}
    </div>
  );
}