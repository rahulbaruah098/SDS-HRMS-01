import { useState } from 'react';
import { currentUser, api } from '../api/client';

export default function Profile() {
  const user = currentUser();
  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
  });
  const [message, setMessage] = useState('');

  async function submit(e) {
    e.preventDefault();

    try {
      const data = await api('/password-requests', {
        method: 'POST',
        body: JSON.stringify(form),
      });

      setMessage(data.message);
      setForm({ current_password: '', new_password: '' });
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">My Profile</span>
          <h1>{user.name || user.email}</h1>
          <p>{(user.roles || []).join(', ')} • {user.tenant_id}</p>
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
              onChange={(e) => setForm({ ...form, current_password: e.target.value })}
            />
          </label>

          <label>
            New Password
            <input
              type="password"
              value={form.new_password}
              onChange={(e) => setForm({ ...form, new_password: e.target.value })}
            />
          </label>

          <button className="primary">Send Approval Request</button>
        </form>

        {message && <div className="inline-message">{message}</div>}
      </section>
    </div>
  );
}