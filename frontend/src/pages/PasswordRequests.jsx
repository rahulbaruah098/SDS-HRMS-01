import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Search, X } from 'lucide-react';
import { api } from '../api/client';

const EMPTY_FILTERS = {
  status: 'pending',
  tenant_id: '',
  q: '',
};

function formatDate(value) {
  if (!value) {
    return '—';
  }

  if (typeof value === 'object' && value.$date) {
    return new Date(value.$date).toLocaleString('en-IN');
  }

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return String(value);
}

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    query.append(key, value);
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

export default function PasswordRequests() {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [loadingId, setLoadingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const hasActiveFilters = useMemo(() => {
    return (
      filters.status !== 'pending' ||
      Boolean(filters.tenant_id.trim()) ||
      Boolean(filters.q.trim())
    );
  }, [filters]);

  async function load(nextFilters = filters) {
    try {
      setLoading(true);
      setMessage('');

      const data = await api(`/password-requests${buildQuery(nextFilters)}`);
      setRows(data.items || []);
    } catch (error) {
      setMessage(error.message || 'Unable to load password requests');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setMessage('');

      const data = await api(`/password-requests/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      setMessage(data.message || 'Password request approved');
      await load();
    } catch (error) {
      setMessage(error.message || 'Unable to approve request');
    } finally {
      setLoadingId('');
    }
  }

  function openReject(row) {
    setRejectTarget(row);
    setRejectReason('');

    setTimeout(() => {
      document.getElementById('password-reject-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 100);
  }

  async function reject(event) {
    event.preventDefault();

    const id = rejectTarget?._id;

    if (!id) {
      setMessage('Password request id not found');
      return;
    }

    try {
      setLoadingId(id);
      setMessage('');

      const data = await api(`/password-requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          reason: rejectReason,
        }),
      });

      setMessage(data.message || 'Password request rejected');
      setRejectTarget(null);
      setRejectReason('');
      await load();
    } catch (error) {
      setMessage(error.message || 'Unable to reject request');
    } finally {
      setLoadingId('');
    }
  }

  async function searchRequests(event) {
    event.preventDefault();
    await load(filters);
  }

  async function clearFilters() {
    const cleared = { ...EMPTY_FILTERS };
    setFilters(cleared);
    setRejectTarget(null);
    setRejectReason('');
    await load(cleared);
  }

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Super Admin</span>

          <h1>Password Requests</h1>

          <p>
            Review employee password change requests. Approval updates the login
            password immediately, while rejection can include a reason.
          </p>
        </div>

        <button
          type="button"
          className="secondary"
          onClick={() => load()}
          disabled={loading}
        >
          <RefreshCcw size={16} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Filters</h3>
            <p>Search by user name, email, tenant, or request status.</p>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="secondary"
              onClick={clearFilters}
              disabled={loading}
            >
              <X size={16} />
              Clear Filters
            </button>
          )}
        </div>

        <form className="dynamic-form" onSubmit={searchRequests}>
          <label>
            Status
            <select
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">All</option>
            </select>
          </label>

          <label>
            Tenant ID
            <input
              value={filters.tenant_id}
              onChange={(event) => updateFilter('tenant_id', event.target.value)}
              placeholder="tenant_id"
            />
          </label>

          <label>
            Search
            <input
              value={filters.q}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Name / email / tenant"
            />
          </label>

          <button type="submit" className="primary" disabled={loading}>
            <Search size={16} />
            {loading ? 'Searching...' : 'Search'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={clearFilters}
            disabled={loading}
          >
            Clear
          </button>
        </form>

        {message && <div className="inline-message">{message}</div>}
      </section>

      {rejectTarget && (
        <section className="panel" id="password-reject-section">
          <div className="toolbar">
            <div>
              <h3>Reject Password Request</h3>
              <p>
                Reject request for <b>{rejectTarget.user_name}</b> —{' '}
                {rejectTarget.user_email}
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason('');
              }}
              disabled={loadingId === rejectTarget._id}
            >
              <X size={16} />
              Close
            </button>
          </div>

          <form className="dynamic-form" onSubmit={reject}>
            <label>
              Rejection Reason
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Optional reason shown to the user"
                rows={3}
              />
            </label>

            <button
              type="submit"
              className="danger"
              disabled={loadingId === rejectTarget._id}
            >
              {loadingId === rejectTarget._id ? 'Rejecting...' : 'Reject Request'}
            </button>
          </form>
        </section>
      )}

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Request List</h3>
            <p>
              Pending requests are actionable. Approved and rejected requests are
              retained for audit history.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Tenant</th>
                <th>Status</th>
                <th>Requested At</th>
                <th>Approved By</th>
                <th>Rejected By</th>
                <th>Rejection Reason</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row._id}>
                  <td>{row.user_name || row.name || '—'}</td>
                  <td>{row.user_email || row.email || '—'}</td>
                  <td>{row.tenant_id || '—'}</td>
                  <td>{statusLabel(row.status)}</td>
                  <td>{formatDate(row.created_at)}</td>
                  <td>{row.approved_by_name || '—'}</td>
                  <td>{row.rejected_by_name || '—'}</td>
                  <td>{row.rejection_reason || '—'}</td>

                  <td>
                    {row.status === 'pending' ? (
                      <div className="row-actions">
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
                          onClick={() => openReject(row)}
                          disabled={loadingId === row._id}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      statusLabel(row.status)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!rows.length && (
            <div className="empty">
              {loading ? 'Loading password requests...' : 'No password requests found'}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}