import { useState } from 'react';
import { api, setSession } from '../api/client';

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ email: 'superadmin@sdshr.in', password: 'Super@123' });
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setSession(data);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand-mark">SDS</div>
        <h1>SDS HRMS</h1>
        <p>Multi-company SaaS-ready HRMS built with React Vite + Flask + MongoDB</p>

        <form onSubmit={submit}>
          <label>Email</label>
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

          <label>Password</label>
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />

          {error && <div className="alert">{error}</div>}
          <button className="primary">Login</button>
        </form>

        <div className="demo-box">
          <b>Demo Logins</b>
          <span>Super Admin: superadmin@sdshr.in / Super@123</span>
          <span>SDS Admin: admin@sdshr.in / Admin@123</span>
          <span>HR: hr@sdshr.in / Hr@123</span>
          <span>Finance: finance@sdshr.in / Finance@123</span>
          <span>Manager: manager@sdshr.in / Manager@123</span>
          <span>Employee: employee@sdshr.in / Employee@123</span>
          <span>Demo Company Admin: clientadmin@example.com / Client@123</span>
        </div>
      </div>
    </div>
  );
}
