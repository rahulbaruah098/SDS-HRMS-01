import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function PasswordRequests() {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [loadingId, setLoadingId] = useState('');

  async function load() {
    try {
      const data = await api('/password-requests');
      setRows(data.items || []);
    } catch (error) {
      setMessage(error.message || 'Unable to load password requests');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function approve(id) {
    if (!id) {
      setMessage('Password request id not found');
      return;
    }

    const ok = window.confirm('Approve this password change request?');

    if (!ok) {
      return;
    }

    try {
      setLoadingId(id);

      const data = await api(`/password-requests/${id}/approve`, {
        method: 'POST',
      });

      setMessage(data.message || 'Password request approved');
      await load();
    } catch (error) {
      setMessage(error.message || 'Unable to approve request');
    } finally {
      setLoadingId('');
    }
  }

  async function reject(id) {
    if (!id) {
      setMessage('Password request id not found');
      return;
    }

    const ok = window.confirm('Reject this password change request?');

    if (!ok) {
      return;
    }

    try {
      setLoadingId(id);

      const data = await api(`/password-requests/${id}/reject`, {
        method: 'POST',
      });

      setMessage(data.message || 'Password request rejected');
      await load();
    } catch (error) {
      setMessage(error.message || 'Unable to reject request');
    } finally {
      setLoadingId('');
    }
  }

  function formatDate(value) {
    if (!value) {
      return '';
    }

    if (typeof value === 'object' && value.$date) {
      return new Date(value.$date).toLocaleString();
    }

    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }

    return String(value);
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
                  <td>{row.user_name || row.name || ''}</td>
                  <td>{row.user_email || row.email || ''}</td>
                  <td>{row.tenant_id || ''}</td>
                  <td>{row.status || ''}</td>
                  <td>{formatDate(row.created_at)}</td>
                  <td>
                    {row.status === 'pending' ? (
                      <>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => approve(row._id)}
                          disabled={loadingId === row._id}
                        >
                          {loadingId === row._id ? 'Approving...' : 'Approve'}
                        </button>

                        <button
                          type="button"
                          className="danger"
                          onClick={() => reject(row._id)}
                          disabled={loadingId === row._id}
                        >
                          {loadingId === row._id ? 'Please wait...' : 'Reject'}
                        </button>
                      </>
                    ) : (
                      row.status || ''
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!rows.length && (
            <div className="empty">No password requests found</div>
          )}
        </div>
      </section>
    </div>
  );
}