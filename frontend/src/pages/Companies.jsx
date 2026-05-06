import { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../api/client';
import { emptyCompany } from '../data/modules';
import Table from '../components/Table';

export default function Companies() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyCompany);
  const [q, setQ] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const data = await api(`/superadmin/companies${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    setRows(data.items || []);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function submit(e) {
    e.preventDefault();
    try {
      const data = await api('/superadmin/companies', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setMessage(data.message);
      setForm(emptyCompany);
      load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">SaaS Tenant Control</span>
          <h1>Companies / Tenants</h1>
          <p>Create another company so they can use this HRMS with isolated users, employees, payroll, attendance, leave, documents and settings.</p>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies..." />
            <button onClick={load}>Search</button>
          </div>
        </div>

        <form className="dynamic-form" onSubmit={submit}>
          {Object.keys(emptyCompany).map((key) => (
            <label key={key}>
              {key.replaceAll('_', ' ')}
              <input value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </label>
          ))}
          <button className="primary">
            <Plus size={16} /> Create Company
          </button>
        </form>

        {message && <div className="inline-message">{message}</div>}
        <Table rows={rows} />
      </section>
    </div>
  );
}
