import { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../api/client';
import { allModules, templates } from '../data/modules';
import { isSuperAdmin } from '../utils/authHelpers';

export default function ModuleCrud({ collection }) {
  const moduleInfo = allModules.find((m) => m[0] === collection);
  const template = templates[collection] || { title: '', status: 'active' };
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(template);
  const [q, setQ] = useState('');
  const [tenant, setTenant] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const params = [];
    if (q) params.push(`q=${encodeURIComponent(q)}`);
    if (isSuperAdmin() && tenant) params.push(`tenant_id=${encodeURIComponent(tenant)}`);
    const data = await api(`/${collection}${params.length ? `?${params.join('&')}` : ''}`);
    setRows(data.items || []);
  }

  useEffect(() => {
    setForm(template);
    load().catch(console.error);
  }, [collection]);

  async function submit(e) {
    e.preventDefault();
    try {
      await api(`/${collection}`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm(template);
      setMessage('Record created');
      load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function remove(id) {
    await api(`/${collection}/${id}`, { method: 'DELETE' });
    load();
  }

  async function runPayroll() {
    try {
      const month = form.month || new Date().toISOString().slice(0, 7);
      const data = await api('/payroll/run', {
        method: 'POST',
        body: JSON.stringify({ month }),
      });
      setMessage(data.message);
      load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Module</span>
          <h1>{moduleInfo?.[1] || collection}</h1>
          <p>{moduleInfo?.[3]}</p>
        </div>
        {collection === 'payroll_runs' && <button className="primary" onClick={runPayroll}>Run Payroll</button>}
      </section>

      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search records..." />
            {isSuperAdmin() && <input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="tenant_id filter" />}
            <button onClick={load}>Search</button>
          </div>
        </div>

        {collection !== 'audit_logs' && (
          <form className="dynamic-form" onSubmit={submit}>
            {Object.keys(template).map((key) => (
              <label key={key}>
                {key.replaceAll('_', ' ')}

                {['is_team_leader', 'is_reporting_officer'].includes(key) ? (
                  <select
                    value={form[key] ?? 'false'}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  >
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                ) : (
                  <input
                    value={form[key] ?? ''}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                )}
              </label>
            ))}
            <button className="primary">
              <Plus size={16} /> Create
            </button>
          </form>
        )}

        {message && <div className="inline-message">{message}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {rows[0] && Object.keys(rows[0]).filter((key) => !['password_hash'].includes(key)).slice(0, 8).map((key) => <th key={key}>{key.replaceAll('_', ' ')}</th>)}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const keys = Object.keys(row).filter((key) => !['password_hash'].includes(key)).slice(0, 8);
                return (
                  <tr key={row._id}>
                    {keys.map((key) => (
                      <td key={key}>
                        {Array.isArray(row[key])
                          ? row[key].join(', ')
                          : typeof row[key] === 'object'
                            ? JSON.stringify(row[key])
                            : String(row[key] ?? '')}
                      </td>
                    ))}
                    <td>{collection !== 'audit_logs' && <button className="danger" onClick={() => remove(row._id)}>Delete</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <div className="empty">No records found</div>}
        </div>
      </section>
    </div>
  );
}
