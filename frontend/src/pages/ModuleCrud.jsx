import { useEffect, useState } from 'react';
import { Plus, Search, Save, X } from 'lucide-react';
import { api } from '../api/client';
import { allModules, templates } from '../data/modules';
import { isSuperAdmin } from '../utils/authHelpers';

export default function ModuleCrud({ collection }) {
  const moduleInfo = allModules.find((m) => m[0] === collection);
  const template = templates[collection] || { title: '', status: 'active' };

  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ ...template });
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [tenant, setTenant] = useState('');
  const [message, setMessage] = useState('');
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [designationOptions, setDesignationOptions] = useState([]);

  async function load() {
    const params = [];

    if (q.trim()) {
      params.push(`q=${encodeURIComponent(q.trim())}`);
    }

    if (isSuperAdmin() && tenant.trim()) {
      params.push(`tenant_id=${encodeURIComponent(tenant.trim())}`);
    }

    const data = await api(`/${collection}${params.length ? `?${params.join('&')}` : ''}`);
    setRows(data.items || []);
  }

  async function loadEmployeeOptions() {
    const params = [];

    if (isSuperAdmin() && tenant.trim()) {
      params.push(`tenant_id=${encodeURIComponent(tenant.trim())}`);
    }

    const data = await api(`/employees${params.length ? `?${params.join('&')}` : ''}`);
    const items = data.items || [];

    setEmployeeOptions(items);
    return items;
  }

  async function loadDesignationOptions() {
    const params = [];

    if (isSuperAdmin() && tenant.trim()) {
      params.push(`tenant_id=${encodeURIComponent(tenant.trim())}`);
    }

    const data = await api(`/designations${params.length ? `?${params.join('&')}` : ''}`);
    const items = data.items || [];

    setDesignationOptions(items);
    return items;
  }

  function resetForm() {
    setForm({ ...template });
  }

  function generatePassword() {
    const namePart = (form.name || form.email || 'User')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 8);

    const pass = `${namePart || 'User'}@123`;
    setForm({ ...form, password: pass });
  }

  useEffect(() => {
    resetForm();
    setEdit(null);
    setMessage('');
    setRows([]);

    load().catch((error) => {
      console.error(error);
      setMessage(error.message || 'Unable to load records');
    });

    if (collection === 'employees') {
      loadEmployeeOptions().catch(console.error);
      loadDesignationOptions().catch(console.error);
    }
  }, [collection]);

  async function submit(e) {
    e.preventDefault();

    try {
      await api(`/${collection}`, {
        method: 'POST',
        body: JSON.stringify(form),
      });

      resetForm();
      setMessage('Record created successfully');
      await load();

      if (collection === 'employees') {
        await loadEmployeeOptions();
        await loadDesignationOptions();
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function startEdit(row) {
    if (collection === 'employees') {
      await loadEmployeeOptions();
      await loadDesignationOptions();
    }

    const editData = { ...template, ...row };

    if (collection === 'employees') {
      delete editData.password;

      editData.is_team_leader = String(row.is_team_leader || 'false');
      editData.is_reporting_officer = String(row.is_reporting_officer || 'false');
      editData.team_leader_id = row.team_leader_id || '';
      editData.reporting_officer_id = row.reporting_officer_id || '';
    }

    setEdit(editData);

    setTimeout(() => {
      document.getElementById('edit-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 100);
  }

  async function saveEdit(e) {
    e.preventDefault();

    try {
      const payload = { ...edit };

      delete payload._id;
      delete payload.password_hash;

      await api(`/${collection}/${edit._id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setEdit(null);
      setMessage('Record updated successfully');
      await load();

      if (collection === 'employees') {
        await loadEmployeeOptions();
        await loadDesignationOptions();
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function remove(id) {
    const ok = window.confirm('Are you sure you want to delete this record?');

    if (!ok) {
      return;
    }

    try {
      await api(`/${collection}/${id}`, {
        method: 'DELETE',
      });

      setMessage('Record deleted successfully');
      await load();

      if (collection === 'employees') {
        await loadEmployeeOptions();
        await loadDesignationOptions();
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function runPayroll() {
    try {
      const month = form.month || new Date().toISOString().slice(0, 7);

      const data = await api('/payroll/run', {
        method: 'POST',
        body: JSON.stringify({ month }),
      });

      setMessage(data.message);
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function searchRecords() {
    try {
      await load();

      if (collection === 'employees') {
        await loadEmployeeOptions();
        await loadDesignationOptions();
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function clearSearch() {
    setQ('');
    setTenant('');

    setTimeout(async () => {
      try {
        const data = await api(`/${collection}`);
        setRows(data.items || []);

        if (collection === 'employees') {
          const empData = await api('/employees');
          setEmployeeOptions(empData.items || []);

          const desigData = await api('/designations');
          setDesignationOptions(desigData.items || []);
        }
      } catch (error) {
        setMessage(error.message);
      }
    }, 0);
  }

  function isReportingOfficerEligible(employee) {
    const designation = String(employee?.designation || '').trim().toLowerCase();
    return designation === 'managing director' || designation === 'manager';
  }

  function renderField(state, setState, key, isEditMode = false) {
    const label = key.replaceAll('_', ' ');

    if (collection === 'employees' && isEditMode && key === 'password') {
      return null;
    }

    if (collection === 'employees' && key === 'designation') {
      return (
        <label key={key}>
          {label}
          <select
            value={state[key] ?? ''}
            onChange={(e) => {
              const nextDesignation = e.target.value;

              setState({
                ...state,
                designation: nextDesignation,
              });
            }}
          >
            <option value="">Select designation</option>

            {designationOptions.map((desig) => {
              const value = desig.title || desig.name || '';

              return (
                <option key={desig._id || value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        </label>
      );
    }

    if (['is_team_leader', 'is_reporting_officer'].includes(key)) {
      return (
        <label key={key}>
          {label}
          <select
            value={String(state[key] ?? 'false')}
            onChange={(e) => setState({ ...state, [key]: e.target.value })}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
      );
    }

    if (['team_leader_id', 'reporting_officer_id'].includes(key)) {
      const filteredEmployees = employeeOptions
        .filter((emp) => emp._id !== state._id)
        .filter((emp) => {
          if (key !== 'reporting_officer_id') {
            return true;
          }

          return isReportingOfficerEligible(emp);
        });

      return (
        <label key={key}>
          {label}
          <select
            value={state[key] ?? ''}
            onChange={(e) => setState({ ...state, [key]: e.target.value })}
          >
            <option value="">Select {label}</option>

            {filteredEmployees.map((emp) => (
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
          value={state[key] ?? ''}
          onChange={(e) => setState({ ...state, [key]: e.target.value })}
        />
      </label>
    );
  }

  function displayValue(value) {
    if (value === null || value === undefined || value === '') {
      return '';
    }

    if (Array.isArray(value)) {
      return value.join(', ');
    }

    if (typeof value === 'object') {
      if (value.$date) {
        return value.$date;
      }

      return JSON.stringify(value);
    }

    return String(value);
  }

  const createFields = Object.keys(template);

  const editFields =
    collection === 'employees'
      ? Object.keys(template).filter((key) => key !== 'password')
      : Object.keys(template);

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Module</span>
          <h1>{moduleInfo?.[1] || collection}</h1>
          <p>{moduleInfo?.[3]}</p>
        </div>

        {collection === 'payroll_runs' && (
          <button type="button" className="primary" onClick={runPayroll}>
            Run Payroll
          </button>
        )}
      </section>

      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={16} />

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search records..."
            />

            {isSuperAdmin() && (
              <input
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                placeholder="tenant_id filter"
              />
            )}

            <button type="button" onClick={searchRecords}>
              Search
            </button>

            {(q || tenant) && (
              <button type="button" className="secondary" onClick={clearSearch}>
                Clear
              </button>
            )}
          </div>
        </div>

        {collection !== 'audit_logs' && (
          <form className="dynamic-form" onSubmit={submit}>
            {createFields.map((key) => renderField(form, setForm, key, false))}

            {collection === 'employees' && (
              <button
                type="button"
                className="secondary"
                onClick={generatePassword}
              >
                Auto Generate Password
              </button>
            )}

            <button type="submit" className="primary">
              <Plus size={16} /> Create
            </button>
          </form>
        )}

        {message && <div className="inline-message">{message}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {rows[0] &&
                  Object.keys(rows[0])
                    .filter((key) => !['password_hash'].includes(key))
                    .slice(0, 8)
                    .map((key) => (
                      <th key={key}>{key.replaceAll('_', ' ')}</th>
                    ))}

                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => {
                const keys = Object.keys(row)
                  .filter((key) => !['password_hash'].includes(key))
                  .slice(0, 8);

                return (
                  <tr key={row._id}>
                    {keys.map((key) => (
                      <td key={key}>{displayValue(row[key])}</td>
                    ))}

                    <td>
                      {collection !== 'audit_logs' && (
                        <>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => startEdit(row)}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className="danger"
                            onClick={() => remove(row._id)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!rows.length && <div className="empty">No records found</div>}
        </div>
      </section>

      {edit && (
        <section className="panel" id="edit-section">
          <div className="toolbar">
            <div>
              <h3>Edit {moduleInfo?.[1] || collection}</h3>

              {collection === 'employees' && (
                <p>
                  HR can change employee details, designation, team leader and
                  reporting officer from here.
                </p>
              )}
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => setEdit(null)}
            >
              <X size={16} /> Close
            </button>
          </div>

          <form className="dynamic-form" onSubmit={saveEdit}>
            {editFields.map((key) => renderField(edit, setEdit, key, true))}

            <button type="submit" className="primary">
              <Save size={16} /> Save Changes
            </button>
          </form>
        </section>
      )}
    </div>
  );
}