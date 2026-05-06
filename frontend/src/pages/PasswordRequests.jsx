import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function PasswordRequests() {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');

  async function load() {
    const data = await api('/password-requests');
    setRows(data.items || []);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function approve(id) {
    const data = await api(`/password-requests/${id}/approve`, {
      method: 'POST',
    });
    setMessage(data.message);
    load();
  }

  async function reject(id) {
    const data = await api(`/password-requests/${id}/reject`, {
      method: 'POST',
    });
    setMessage(data.message);
    load();
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Super Admin</span>
          <h1>Password Requests</h1>
          <p>Approve or reject password change requests from users.</p>
        </div>
      </section>

      <section className="panel">
        {message && <div className="inline-message">{message}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Tenant</th>
                <th>Status</th>
                <th>Requested At</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row._id}>
                  <td>{row.user_name}</td>
                  <td>{row.user_email}</td>
                  <td>{row.tenant_id}</td>
                  <td>{row.status}</td>
                  <td>{row.created_at}</td>
                  <td>
                    {row.status === 'pending' && (
                      <>
                        <button className="primary" onClick={() => approve(row._id)}>
                          Approve
                        </button>
                        <button className="danger" onClick={() => reject(row._id)}>
                          Reject
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!rows.length && <div className="empty">No pending password requests</div>}
        </div>
      </section>
    </div>
  );
}