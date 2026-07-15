import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Mail,
  RefreshCcw,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const EMPTY_FILTERS = {
  status: 'pending',
  search: '',
  company_email: '',
  otp_verified: '',
};

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending Approval' },
  { value: 'otp_pending', label: 'OTP Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All Requests' },
];

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
  if (!value) {
    return '—';
  }

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeValue(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') {
      return;
    }

    query.append(key, value);
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function getStatusStyle(status) {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'approved') {
    return {
      background: 'rgba(22, 163, 74, 0.12)',
      color: '#166534',
      border: '1px solid rgba(22, 163, 74, 0.25)',
    };
  }

  if (normalized === 'rejected') {
    return {
      background: 'rgba(220, 38, 38, 0.12)',
      color: '#991b1b',
      border: '1px solid rgba(220, 38, 38, 0.25)',
    };
  }

  if (normalized === 'otp_pending') {
    return {
      background: 'rgba(234, 88, 12, 0.12)',
      color: '#9a3412',
      border: '1px solid rgba(234, 88, 12, 0.25)',
    };
  }

  return {
    background: 'rgba(37, 99, 235, 0.12)',
    color: '#1d4ed8',
    border: '1px solid rgba(37, 99, 235, 0.25)',
  };
}

function StatusBadge({ status }) {
  return (
    <span
      style={{
        ...getStatusStyle(status),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {String(status || '').toLowerCase() === 'approved' && <CheckCircle2 size={14} />}
      {String(status || '').toLowerCase() === 'rejected' && <XCircle size={14} />}
      {String(status || '').toLowerCase() === 'otp_pending' && <Mail size={14} />}
      {!['approved', 'rejected', 'otp_pending'].includes(String(status || '').toLowerCase()) && (
        <Clock3 size={14} />
      )}
      {statusLabel(status)}
    </span>
  );
}

function MetricCard({ label, value, tone }) {
  const tones = {
    blue: ['rgba(37, 99, 235, 0.12)', '#1d4ed8'],
    orange: ['rgba(234, 88, 12, 0.12)', '#9a3412'],
    green: ['rgba(22, 163, 74, 0.12)', '#166534'],
    red: ['rgba(220, 38, 38, 0.12)', '#991b1b'],
    gray: ['rgba(100, 116, 139, 0.12)', '#475569'],
  };
  const [background, color] = tones[tone] || tones.gray;

  return (
    <div
      style={{
        background,
        borderRadius: 18,
        padding: '16px 18px',
        minHeight: 96,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        border: '1px solid rgba(15, 23, 42, 0.08)',
      }}
    >
      <span style={{ color, fontSize: 28, fontWeight: 800 }}>{value ?? 0}</span>
      <span style={{ color: '#475569', fontWeight: 700 }}>{label}</span>
    </div>
  );
}

function RequestDetails({ request }) {
  if (!request) {
    return null;
  }

  const infoRows = [
    ['Company Name', request.company_name],
    ['Company Email', request.company_email],
    ['Company Phone', request.company_phone],
    ['Company Address', request.company_address],
    ['Company Type', request.company_type],
    ['Contact Person', request.contact_person_name],
    ['Contact Phone', request.contact_person_phone],
    ['Requested Employees', request.requested_employee_count],
    ['OTP Verified', request.otp_verified ? 'Yes' : 'No'],
    ['Generated Admin Email', request.generated_admin_email],
    ['Tenant ID', request.tenant_id],
    ['Trial Start', formatDate(request.trial_start_date)],
    ['Trial End', formatDate(request.trial_end_date)],
    ['Requested At', formatDate(request.created_at)],
    ['Approved At', formatDate(request.approved_at)],
    ['Rejected At', formatDate(request.rejected_at)],
    ['Rejection Reason', request.rejection_reason],
  ];

  return (
    <div className="table-wrap">
      <table>
        <tbody>
          {infoRows.map(([label, value]) => (
            <tr key={label}>
              <th style={{ width: 220 }}>{label}</th>
              <td>{safeValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {request.message && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8 }}>Company Message / Purpose</h4>
          <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>{request.message}</p>
        </div>
      )}
    </div>
  );
}

// SaaS trial: approval starts a 15-day full-access trial.
export default function DemoRequests() {
  const alerts = useCustomAlert();

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const hasActiveFilters = useMemo(() => {
    return (
      filters.status !== 'pending' ||
      Boolean(filters.search.trim()) ||
      Boolean(filters.company_email.trim()) ||
      Boolean(filters.otp_verified)
    );
  }, [filters]);

  async function load(nextFilters = filters, nextPage = 1) {
    try {
      setLoading(true);

      const query = buildQuery({
        ...nextFilters,
        page: nextPage,
        limit: pagination.limit || 20,
      });

      const data = await api(`/demo-requests/admin/requests${query}`);

      setRows(data.items || []);
      setCounts(data.counts || {});
      setPagination(data.pagination || { page: nextPage, limit: 20, total: 0, pages: 1 });
    } catch (error) {
      alerts.error(error.message || 'Unable to load trial requests.', 'Trial Requests Load Failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function searchRequests(event) {
    event.preventDefault();
    setRejectTarget(null);
    setSelectedRequest(null);
    await load(filters, 1);
  }

  async function clearFilters() {
    const cleared = { ...EMPTY_FILTERS };
    setFilters(cleared);
    setRejectTarget(null);
    setSelectedRequest(null);
    await load(cleared, 1);
  }

  async function viewDetails(row) {
    if (!row?._id) {
      alerts.warning('Demo request id not found.', 'Request ID Missing');
      return;
    }

    try {
      setDetailsLoading(true);
      setSelectedRequest(row);

      const data = await api(`/demo-requests/admin/requests/${row._id}`);
      setSelectedRequest(data.request || row);

      setTimeout(() => {
        document.getElementById('demo-request-details')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 100);
    } catch (error) {
      alerts.error(error.message || 'Unable to load request details.', 'Request Details Failed');
    } finally {
      setDetailsLoading(false);
    }
  }

  async function approve(row) {
    if (!row?._id) {
      alerts.warning('Demo request id not found.', 'Request ID Missing');
      return;
    }

    if (!row.otp_verified) {
      alerts.warning(
        'This company has not completed email OTP verification yet. Approval is allowed only after OTP verification.',
        'OTP Not Verified',
      );
      return;
    }

    const ok = await alerts.confirm(
      `Approve trial registration for ${row.company_name}? The system will create a trial company, generate admin login credentials, start the 15-day full-access trial, and email login details to ${row.company_email}.`,
      'Approve Trial Request',
    );

    if (!ok) {
      return;
    }

    try {
      setLoadingId(row._id);

      const data = await api(`/demo-requests/admin/requests/${row._id}/approve`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      alerts.success(
        data.message || 'Demo request approved and login details sent by email.',
        'Trial Approved',
      );

      setRejectTarget(null);
      setSelectedRequest(null);
      await load(filters, pagination.page || 1);
    } catch (error) {
      alerts.error(error.message || 'Unable to approve trial request.', 'Approval Failed');
    } finally {
      setLoadingId('');
    }
  }

  function openReject(row) {
    setRejectTarget(row);
    setRejectReason('');

    setTimeout(() => {
      document.getElementById('demo-reject-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 100);
  }

  async function reject(event) {
    event.preventDefault();

    if (!rejectTarget?._id) {
      alerts.warning('Demo request id not found.', 'Request ID Missing');
      return;
    }

    const ok = await alerts.confirm(
      `Reject trial registration for ${rejectTarget.company_name}? The company will be informed by email.`,
      'Reject Trial Request',
    );

    if (!ok) {
      return;
    }

    try {
      setLoadingId(rejectTarget._id);

      const data = await api(`/demo-requests/admin/requests/${rejectTarget._id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          reason: rejectReason,
        }),
      });

      alerts.success(data.message || 'Demo request rejected.', 'Trial Rejected');
      setRejectTarget(null);
      setRejectReason('');
      setSelectedRequest(null);
      await load(filters, pagination.page || 1);
    } catch (error) {
      alerts.error(error.message || 'Unable to reject trial request.', 'Rejection Failed');
    } finally {
      setLoadingId('');
    }
  }

  async function goToPage(page) {
    const safePage = Math.max(1, Math.min(page, pagination.pages || 1));
    await load(filters, safePage);
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">YourComate SaaS</span>
          <h1>Trial Registration Requests</h1>
          <p>
            Review company trial applications, verify OTP status, approve eligible requests,
            and trigger automatic admin login email delivery.
          </p>
        </div>

        <button
          type="button"
          className="secondary"
          onClick={() => load(filters, pagination.page || 1)}
          disabled={loading}
        >
          <RefreshCcw size={16} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
        }}
      >
        <MetricCard label="Pending Approval" value={counts.pending || 0} tone="blue" />
        <MetricCard label="OTP Pending" value={counts.otp_pending || 0} tone="orange" />
        <MetricCard label="Approved" value={counts.approved || 0} tone="green" />
        <MetricCard label="Rejected" value={counts.rejected || 0} tone="red" />
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Filters</h3>
            <p>Search by company name, company email, phone, contact person, and status.</p>
          </div>

          {hasActiveFilters && (
            <button type="button" className="secondary" onClick={clearFilters} disabled={loading}>
              <X size={16} />
              Clear Filters
            </button>
          )}
        </div>

        <form className="dynamic-form" onSubmit={searchRequests} noValidate>
          <label>
            Status
            <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Company Email
            <input
              value={filters.company_email}
              onChange={(event) => updateFilter('company_email', event.target.value)}
              placeholder="company@example.com"
            />
          </label>

          <label>
            OTP Status
            <select
              value={filters.otp_verified}
              onChange={(event) => updateFilter('otp_verified', event.target.value)}
            >
              <option value="">All</option>
              <option value="true">OTP Verified</option>
              <option value="false">OTP Not Verified</option>
            </select>
          </label>

          <label>
            Search
            <input
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="Company / phone / contact person"
            />
          </label>

          <button type="submit" className="primary" disabled={loading}>
            <Search size={16} />
            {loading ? 'Searching...' : 'Search'}
          </button>

          <button type="button" className="secondary" onClick={clearFilters} disabled={loading}>
            Clear
          </button>
        </form>
      </section>

      {rejectTarget && (
        <section className="panel" id="demo-reject-section">
          <div className="toolbar">
            <div>
              <h3>Reject Trial Request</h3>
              <p>
                Reject request for <b>{rejectTarget.company_name}</b> — {rejectTarget.company_email}
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

          <form className="dynamic-form" onSubmit={reject} noValidate>
            <label>
              Rejection Reason
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Optional reason that will be emailed to the registered company email"
                rows={3}
              />
            </label>

            <button type="submit" className="danger" disabled={loadingId === rejectTarget._id}>
              {loadingId === rejectTarget._id ? 'Rejecting...' : 'Reject Request'}
            </button>
          </form>
        </section>
      )}

      {selectedRequest && (
        <section className="panel" id="demo-request-details">
          <div className="toolbar">
            <div>
              <span className="kicker">Request Details</span>
              <h3>{selectedRequest.company_name}</h3>
              <p>
                {detailsLoading
                  ? 'Loading latest request details...'
                  : 'Detailed company, OTP, approval, tenant, and trial information.'}
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => setSelectedRequest(null)}>
              <X size={16} />
              Close
            </button>
          </div>

          <RequestDetails request={selectedRequest} />
        </section>
      )}

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Trial Request List</h3>
            <p>
              Approving a verified request creates the trial company, starts the 15-day full-access trial,
              generates admin credentials, and sends the approval email automatically.
            </p>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: '#475569',
              fontWeight: 700,
            }}
          >
            <ShieldCheck size={18} />
            Total: {pagination.total || 0}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Registered Email</th>
                <th>Contact</th>
                <th>OTP</th>
                <th>Status</th>
                <th>Requested At</th>
                <th>Generated Admin</th>
                <th>Trial End</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => {
                const isPending = String(row.status || '').toLowerCase() === 'pending';
                const isActionLoading = loadingId === row._id;

                return (
                  <tr key={row._id}>
                    <td>
                      <b>{safeValue(row.company_name)}</b>
                      <br />
                      <small>{safeValue(row.company_type, 'Company type not provided')}</small>
                    </td>

                    <td>{safeValue(row.company_email)}</td>

                    <td>
                      {safeValue(row.contact_person_name)}
                      <br />
                      <small>{safeValue(row.contact_person_phone || row.company_phone)}</small>
                    </td>

                    <td>{row.otp_verified ? 'Verified' : 'Not Verified'}</td>

                    <td>
                      <StatusBadge status={row.status} />
                    </td>

                    <td>{formatDate(row.created_at)}</td>

                    <td>{safeValue(row.generated_admin_email)}</td>

                    <td>{formatDate(row.trial_end_date)}</td>

                    <td>
                      <div className="row-actions">
                        <button type="button" className="secondary" onClick={() => viewDetails(row)}>
                          View
                        </button>

                        {isPending ? (
                          <>
                            <button
                              type="button"
                              className="primary"
                              onClick={() => approve(row)}
                              disabled={isActionLoading || !row.otp_verified}
                              title={!row.otp_verified ? 'OTP verification required before approval' : ''}
                            >
                              {isActionLoading ? 'Approving...' : 'Approve'}
                            </button>

                            <button
                              type="button"
                              className="danger"
                              onClick={() => openReject(row)}
                              disabled={isActionLoading}
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <span style={{ color: '#64748b', fontWeight: 700 }}>{statusLabel(row.status)}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!rows.length && (
            <div className="empty">
              {loading ? 'Loading trial requests...' : 'No trial requests found'}
            </div>
          )}
        </div>

        {(pagination.pages || 1) > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginTop: 18,
              flexWrap: 'wrap',
            }}
          >
            <p style={{ margin: 0, color: '#64748b' }}>
              Page {pagination.page || 1} of {pagination.pages || 1}
            </p>

            <div className="row-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => goToPage((pagination.page || 1) - 1)}
                disabled={loading || (pagination.page || 1) <= 1}
              >
                Previous
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() => goToPage((pagination.page || 1) + 1)}
                disabled={loading || (pagination.page || 1) >= (pagination.pages || 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}