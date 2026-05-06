import { useEffect, useState } from 'react';
import { Plus, Save, Search } from 'lucide-react';
import { api } from '../api/client';
import { emptyUser } from '../data/modules';

export default function UserControl() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyUser);
  const [q, setQ] = useState('');
  const [tenant, setTenant] = useState('');
  const [edit, setEdit] = useState(null);
  const [message, setMessage] = useState('');

  async function load() {
    const params = [];
    if (q) params.push(`q=${encodeURIComponent(q)}`);
    if (tenant) params.push(`tenant_id=${encodeURIComponent(tenant)}`);
    const data = await api(`/superadmin/users${params.length ? `?${params.join('&')}` : ''}`);
    setRows(data.items || []);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      const data = await api('/superadmin/users', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setMessage(data.message);
      setForm(emptyUser);
      load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function save() {
    try {
      const data = await api(`/superadmin/users/${edit.user_id_for_edit}`, {
        method: 'PATCH',
        body: JSON.stringify(edit),
      });
      setMessage(data.message);
      setEdit(null);
      load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function resetPassword(id) {
    const password = prompt('New password', 'User@123');
    if (!password) return;
    const data = await api(`/superadmin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setMessage(data.message);
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">User + Profile + Password Control</span>
          <h1>User Control</h1>
          <p>Super Admin can create users, assign companies, change roles, reset passwords, edit designation, department, salary, status and full employee profile.</p>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users..." />
            <input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="tenant_id filter" />
            <button onClick={load}>Search</button>
          </div>
        </div>

        <form className="dynamic-form" onSubmit={create}>
          {Object.keys(emptyUser).map((key) => (
            <label key={key}>
              {key.replaceAll('_', ' ')}
              <input value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </label>
          ))}
          <button className="primary">
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
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => (
                <tr key={user._id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{user.tenant_id}</td>
                  <td>{(user.roles || []).join(', ')}</td>
                  <td>{user.employee_profile?.department || ''}</td>
                  <td>{user.employee_profile?.designation || ''}</td>
                  <td>{user.is_active ? 'Active' : 'Inactive'}</td>
                  <td>
                  <button
                    className="secondary"
                    onClick={() =>
                      setEdit({
                        ...(user.employee_profile || {}),
                        ...user,
                        user_id_for_edit: user._id,
                        employee_id_for_edit: user.employee_profile?._id || '',
                        roles: (user.roles || []).join(', '),
                        emp_code: user.employee_profile?.emp_code || '',
                        department: user.employee_profile?.department || '',
                        designation: user.employee_profile?.designation || '',
                        job_type: user.employee_profile?.job_type || '',
                        project: user.employee_profile?.project || '',
                        state: user.employee_profile?.state || '',
                        status: user.employee_profile?.status || 'Active',
                        salary: user.employee_profile?.salary || 0,
                        is_team_leader: user.employee_profile?.is_team_leader || 'false',
                        is_reporting_officer: user.employee_profile?.is_reporting_officer || 'false',
                        team_leader_id: user.employee_profile?.team_leader_id || '',
                        reporting_officer_id: user.employee_profile?.reporting_officer_id || '',
                      })
                    }
                  >
                    Edit
                  </button>
                    <button className="danger" onClick={() => resetPassword(user._id)}>
                      Reset Password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {edit && (
        <section className="panel">
          <h3>Edit Complete User Profile</h3>
          <div className="dynamic-form">
            {[
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
              'is_team_leader',
              'is_reporting_officer',
              'team_leader_id',
              'reporting_officer_id',
            ]
              .map((key) => (
              <label key={key}>
                {key.replaceAll('_', ' ')}
                <input value={edit[key] ?? ''} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} />
              </label>
            ))}
            <button className="primary" onClick={save}>
              <Save size={16} /> Save Changes
            </button>
            <button className="secondary" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
