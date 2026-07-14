import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Eye,
  IndianRupee,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';

import { api } from '../api/client';
import { emptyCompany } from '../data/modules';

const DEFAULT_COMPANY_FORM = {
  ...emptyCompany,
  company_name: emptyCompany.name || '',
  company_email: emptyCompany.contact_email || '',
  company_phone: emptyCompany.contact_phone || '',
  tenant_code: '',
  plan_type: 'paid',
  status: 'active',
  employee_limit: '',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'pending', label: 'Pending' },
];

const PLAN_OPTIONS = [
  { value: '', label: 'All Plans' },
  { value: 'demo', label: 'Demo' },
  { value: 'paid', label: 'Paid' },
  { value: 'lifetime', label: 'Lifetime' },
];

function safeText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  if (typeof value === 'object' && value.$date) {
    value = value.$date;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return safeText(value);
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(value, currency = 'INR') {
  const amount = toNumber(value, 0);

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency || 'INR'} ${amount}`;
  }
}

function statusColor(status) {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'active' || normalized === 'paid') {
    return {
      background: 'rgba(22, 163, 74, 0.12)',
      color: '#166534',
      border: '1px solid rgba(22, 163, 74, 0.25)',
    };
  }

  if (normalized === 'expired' || normalized === 'rejected') {
    return {
      background: 'rgba(220, 38, 38, 0.12)',
      color: '#991b1b',
      border: '1px solid rgba(220, 38, 38, 0.25)',
    };
  }

  if (normalized === 'suspended' || normalized === 'pending') {
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

function badgeText(value) {
  return safeText(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function StatusBadge({ value }) {
  return (
    <span
      style={{
        ...statusColor(value),
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        padding: '5px 10px',
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {badgeText(value)}
    </span>
  );
}

function getTenantId(row = {}) {
  return row.tenant_id || row.id || row._id || '';
}

function getCompanyName(row = {}) {
  return row.company_name || row.name || row.tenant_name || 'Company';
}

function getCompanyEmail(row = {}) {
  return row.company_email || row.contact_email || row.email || '';
}

function getEmployeeCount(row = {}) {
  return toNumber(
    row.employee_count ??
      row.employees_count ??
      row.total_employees ??
      row.usage?.employees ??
      0,
    0,
  );
}

function getEmployeeLimit(row = {}) {
  const limit = row.employee_limit ?? row.usage?.employee_limit ?? '';

  if (limit === null || limit === undefined || limit === '') {
    return 'Unlimited';
  }

  return String(limit);
}

function SummaryCard({ icon: Icon, label, value, tone = '#2563eb' }) {
  return (
    <div
      className="stat-card"
      style={{
        padding: 18,
        border: '1px solid rgba(226,232,240,0.9)',
        minHeight: 116,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 16,
          display: 'grid',
          placeItems: 'center',
          background: `${tone}18`,
          color: tone,
          marginBottom: 10,
        }}
      >
        <Icon size={22} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailModal({ detail, loading, onClose, onActivate, onSuspend, onExtendDemo, onMarkPaid }) {
  if (!detail) {
    return null;
  }

  const item = detail.item || detail;
  const tenantId = getTenantId(item);
  const payments = detail.payments || [];
  const subscriptions = detail.subscriptions || [];
  const demoRequest = detail.demo_request || null;
  const isSds = item.is_sds_company === true || String(item.tenant_code || '').toLowerCase() === 'sds';

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 18,
      }}
    >
      <div
        style={{
          width: 'min(980px, 100%)',
          maxHeight: '88vh',
          overflow: 'auto',
          borderRadius: 28,
          background: '#ffffff',
          boxShadow: '0 28px 70px rgba(15,23,42,0.28)',
        }}
      >
        <div
          style={{
            padding: '22px 24px',
            borderBottom: '1px solid rgba(226,232,240,0.9)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            alignItems: 'flex-start',
          }}
        >
          <div>
            <p
              style={{
                margin: '0 0 8px',
                color: '#2563eb',
                fontSize: 12,
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Company Detail
            </p>
            <h2 style={{ margin: 0 }}>{getCompanyName(item)}</h2>
            <p style={{ margin: '8px 0 0', color: '#64748b' }}>
              {safeText(getCompanyEmail(item))} · Tenant ID: {safeText(tenantId)}
            </p>
          </div>

          <button
            type="button"
            className="ghost"
            onClick={onClose}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <X size={16} />
            Close
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 36, textAlign: 'center', color: '#64748b' }}>
            <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
            Loading company detail...
          </div>
        ) : (
          <div style={{ padding: 24 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 14,
                marginBottom: 22,
              }}
            >
              <SummaryCard
                icon={ShieldCheck}
                label="Plan"
                value={badgeText(item.plan_type || item.plan || '—')}
                tone="#2563eb"
              />
              <SummaryCard
                icon={CheckCircle2}
                label="Status"
                value={badgeText(item.status || '—')}
                tone="#16a34a"
              />
              <SummaryCard
                icon={Users}
                label="Employees"
                value={`${getEmployeeCount(item)} / ${getEmployeeLimit(item)}`}
                tone="#7c3aed"
              />
              <SummaryCard
                icon={CalendarClock}
                label="Trial Ends"
                value={formatDate(item.trial_end_date || item.subscription_end_date)}
                tone="#ea580c"
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                marginBottom: 22,
              }}
            >
              <button
                type="button"
                className="primary"
                onClick={() => onActivate(tenantId)}
                disabled={loading}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <PlayCircle size={16} />
                Activate
              </button>

              <button
                type="button"
                className="ghost"
                onClick={() => onSuspend(tenantId)}
                disabled={loading || isSds}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <PauseCircle size={16} />
                Suspend
              </button>

              <button
                type="button"
                className="ghost"
                onClick={() => onExtendDemo(tenantId)}
                disabled={loading || item.plan_type !== 'demo'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <CalendarClock size={16} />
                Extend Demo
              </button>

              <button
                type="button"
                className="ghost"
                onClick={() => onMarkPaid(tenantId)}
                disabled={loading || item.plan_type === 'lifetime'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <IndianRupee size={16} />
                Mark Paid
              </button>
            </div>

            {isSds ? (
              <div
                style={{
                  marginBottom: 22,
                  padding: 14,
                  borderRadius: 18,
                  background: 'rgba(22,163,74,0.1)',
                  color: '#166534',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <ShieldCheck size={19} />
                <p style={{ margin: 0 }}>
                  SDS is protected as the lifetime full-access company. It cannot be suspended and does not require payment.
                </p>
              </div>
            ) : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 18,
              }}
            >
              <div
                style={{
                  borderRadius: 22,
                  padding: 18,
                  border: '1px solid rgba(226,232,240,0.9)',
                  background: '#f8fafc',
                }}
              >
                <h3 style={{ margin: '0 0 12px' }}>Company Information</h3>
                <p><strong>Tenant Code:</strong> {safeText(item.tenant_code)}</p>
                <p><strong>Phone:</strong> {safeText(item.company_phone || item.contact_phone)}</p>
                <p><strong>Address:</strong> {safeText(item.address)}</p>
                <p><strong>Allowed Modules:</strong> {Array.isArray(item.allowed_modules) ? item.allowed_modules.join(', ') : safeText(item.allowed_modules)}</p>
              </div>

              <div
                style={{
                  borderRadius: 22,
                  padding: 18,
                  border: '1px solid rgba(226,232,240,0.9)',
                  background: '#f8fafc',
                }}
              >
                <h3 style={{ margin: '0 0 12px' }}>Demo Request</h3>
                {demoRequest ? (
                  <>
                    <p><strong>Status:</strong> {safeText(demoRequest.status)}</p>
                    <p><strong>OTP Verified:</strong> {demoRequest.otp_verified ? 'Yes' : 'No'}</p>
                    <p><strong>Requested:</strong> {formatDate(demoRequest.created_at || demoRequest.requested_at)}</p>
                    <p><strong>Approved:</strong> {formatDate(demoRequest.approved_at)}</p>
                  </>
                ) : (
                  <p style={{ color: '#64748b' }}>No linked demo request found.</p>
                )}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 18,
                marginTop: 18,
              }}
            >
              <div
                style={{
                  borderRadius: 22,
                  padding: 18,
                  border: '1px solid rgba(226,232,240,0.9)',
                }}
              >
                <h3 style={{ margin: '0 0 12px' }}>Recent Subscriptions</h3>
                {subscriptions.length ? (
                  subscriptions.slice(0, 5).map((subscription) => (
                    <div
                      key={subscription._id || subscription.id}
                      style={{
                        padding: '10px 0',
                        borderBottom: '1px solid rgba(226,232,240,0.7)',
                      }}
                    >
                      <strong>{safeText(subscription.plan_name || subscription.plan_type)}</strong>
                      <div style={{ color: '#64748b', fontSize: 13 }}>
                        {safeText(subscription.status)} · {formatDate(subscription.start_date || subscription.created_at)}
                      </div>
                    </div>
                  ))
                ) : (
                  <p style={{ color: '#64748b' }}>No subscription records found.</p>
                )}
              </div>

              <div
                style={{
                  borderRadius: 22,
                  padding: 18,
                  border: '1px solid rgba(226,232,240,0.9)',
                }}
              >
                <h3 style={{ margin: '0 0 12px' }}>Recent Payments</h3>
                {payments.length ? (
                  payments.slice(0, 5).map((payment) => (
                    <div
                      key={payment._id || payment.id}
                      style={{
                        padding: '10px 0',
                        borderBottom: '1px solid rgba(226,232,240,0.7)',
                      }}
                    >
                      <strong>{formatCurrency(payment.amount, payment.currency || 'INR')}</strong>
                      <div style={{ color: '#64748b', fontSize: 13 }}>
                        {safeText(payment.payment_status || payment.status)} · {formatDate(payment.paid_at || payment.created_at)}
                      </div>
                    </div>
                  ))
                ) : (
                  <p style={{ color: '#64748b' }}>No payment records found.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Companies() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [form, setForm] = useState(DEFAULT_COMPANY_FORM);
  const [filters, setFilters] = useState({
    q: '',
    status: '',
    plan_type: '',
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const queryString = useMemo(() => {
    const query = new URLSearchParams();

    if (filters.q) {
      query.append('q', filters.q);
    }

    if (filters.status) {
      query.append('status', filters.status);
    }

    if (filters.plan_type) {
      query.append('plan_type', filters.plan_type);
    }

    const text = query.toString();
    return text ? `?${text}` : '';
  }, [filters]);

  async function load() {
    setLoading(true);
    setMessage('');

    try {
      const data = await api(`/superadmin/companies${queryString}`);

      setRows(data.items || []);
      setSummary(data.summary || {});
    } catch (error) {
      setMessage(error.message || 'Unable to load companies.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      const payload = {
        ...form,
        name: form.name || form.company_name,
        company_name: form.company_name || form.name,
        contact_email: form.contact_email || form.company_email,
        company_email: form.company_email || form.contact_email,
        contact_phone: form.contact_phone || form.company_phone,
        company_phone: form.company_phone || form.contact_phone,
      };

      const data = await api('/superadmin/companies', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setMessage(data.message || 'Company created successfully.');
      setForm(DEFAULT_COMPANY_FORM);
      await load();
    } catch (error) {
      setMessage(error.message || 'Unable to create company.');
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(tenantId) {
    if (!tenantId) {
      return;
    }

    setSelectedTenantId(tenantId);
    setDetailLoading(true);
    setDetail({ item: { tenant_id: tenantId } });

    try {
      const data = await api(`/superadmin/companies/${encodeURIComponent(tenantId)}`);
      setDetail(data);
    } catch (error) {
      setMessage(error.message || 'Unable to load company detail.');
      setDetail(null);
      setSelectedTenantId('');
    } finally {
      setDetailLoading(false);
    }
  }

  async function runCompanyAction(tenantId, action, payload = {}) {
    if (!tenantId || !action) {
      return;
    }

    setMessage('');

    try {
      const data = await api(`/superadmin/companies/${encodeURIComponent(tenantId)}/${action}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setMessage(data.message || 'Company updated successfully.');
      await load();

      if (selectedTenantId) {
        await openDetail(selectedTenantId);
      }
    } catch (error) {
      setMessage(error.message || 'Unable to update company.');
    }
  }

  function handleSuspend(tenantId) {
    const reason = window.prompt('Enter suspension reason:', 'Subscription or admin decision');

    if (reason === null) {
      return;
    }

    runCompanyAction(tenantId, 'suspend', { reason });
  }

  function handleExtendDemo(tenantId) {
    const daysText = window.prompt('Extend demo by how many days?', '7');

    if (daysText === null) {
      return;
    }

    const days = Number(daysText);

    if (!Number.isFinite(days) || days <= 0) {
      setMessage('Please enter a valid number of days.');
      return;
    }

    const reason = window.prompt('Reason for demo extension:', 'Superadmin approved extension');

    if (reason === null) {
      return;
    }

    runCompanyAction(tenantId, 'extend-demo', {
      days,
      reason,
    });
  }

  function handleMarkPaid(tenantId) {
    const amountText = window.prompt('Enter paid amount:', '4999');

    if (amountText === null) {
      return;
    }

    const amount = Number(amountText);

    if (!Number.isFinite(amount) || amount < 0) {
      setMessage('Please enter a valid payment amount.');
      return;
    }

    const durationText = window.prompt('Subscription duration in days:', '30');

    if (durationText === null) {
      return;
    }

    const durationDays = Number(durationText);

    if (!Number.isFinite(durationDays)) {
      setMessage('Please enter a valid subscription duration.');
      return;
    }

    const reason = window.prompt('Reason / note:', 'Manual paid activation by Superadmin');

    if (reason === null) {
      return;
    }

    runCompanyAction(tenantId, 'mark-paid', {
      amount,
      duration_days: durationDays,
      reason,
    });
  }

  function handleChange(key, value) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">SaaS Tenant Control</span>
          <h1>Companies / Tenants</h1>
          <p>
            Monitor all companies using YourComate HRMS, manage demo and paid
            tenants, extend trial access, suspend accounts, and protect SDS
            lifetime access.
          </p>
        </div>
      </section>

      <section className="panel">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 14,
            marginBottom: 22,
          }}
        >
          <SummaryCard icon={Building2} label="Total Companies" value={summary.total || rows.length || 0} />
          <SummaryCard icon={ShieldCheck} label="Lifetime" value={summary.lifetime || 0} tone="#16a34a" />
          <SummaryCard icon={CalendarClock} label="Demo" value={summary.demo || 0} tone="#2563eb" />
          <SummaryCard icon={IndianRupee} label="Paid" value={summary.paid || 0} tone="#7c3aed" />
          <SummaryCard icon={AlertTriangle} label="Expired" value={summary.expired || 0} tone="#dc2626" />
        </div>

        <div
          className="toolbar"
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div className="search" style={{ flex: '1 1 280px' }}>
            <Search size={16} />
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Search company, email, tenant code..."
            />
          </div>

          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            style={{
              minHeight: 42,
              borderRadius: 14,
              border: '1px solid rgba(226,232,240,0.9)',
              padding: '0 12px',
              background: '#ffffff',
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={filters.plan_type}
            onChange={(e) => setFilters({ ...filters, plan_type: e.target.value })}
            style={{
              minHeight: 42,
              borderRadius: 14,
              border: '1px solid rgba(226,232,240,0.9)',
              padding: '0 12px',
              background: '#ffffff',
            }}
          >
            {PLAN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="primary"
            onClick={load}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Search
          </button>
        </div>

        <form
          className="dynamic-form"
          onSubmit={submit}
          style={{
            marginTop: 20,
          }}
        >
          <label>
            Company Name
            <input
              value={form.company_name ?? ''}
              onChange={(e) => {
                handleChange('company_name', e.target.value);
                handleChange('name', e.target.value);
              }}
              placeholder="Example: ABC Private Limited"
              required
            />
          </label>

          <label>
            Tenant ID
            <input
              value={form.tenant_id ?? ''}
              onChange={(e) => handleChange('tenant_id', e.target.value)}
              placeholder="Example: abc-pvt-ltd"
            />
          </label>

          <label>
            Tenant Code
            <input
              value={form.tenant_code ?? ''}
              onChange={(e) => handleChange('tenant_code', e.target.value)}
              placeholder="Example: ABC"
            />
          </label>

          <label>
            Company Email
            <input
              type="email"
              value={form.company_email ?? ''}
              onChange={(e) => {
                handleChange('company_email', e.target.value);
                handleChange('contact_email', e.target.value);
              }}
              placeholder="company@example.com"
            />
          </label>

          <label>
            Company Phone
            <input
              value={form.company_phone ?? ''}
              onChange={(e) => {
                handleChange('company_phone', e.target.value);
                handleChange('contact_phone', e.target.value);
              }}
              placeholder="Phone number"
            />
          </label>

          <label>
            Plan Type
            <select
              value={form.plan_type ?? 'paid'}
              onChange={(e) => handleChange('plan_type', e.target.value)}
            >
              <option value="paid">Paid</option>
              <option value="demo">Demo</option>
              <option value="lifetime">Lifetime</option>
            </select>
          </label>

          <label>
            Status
            <select
              value={form.status ?? 'active'}
              onChange={(e) => handleChange('status', e.target.value)}
            >
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
              <option value="suspended">Suspended</option>
            </select>
          </label>

          <label>
            Employee Limit
            <input
              value={form.employee_limit ?? ''}
              onChange={(e) => handleChange('employee_limit', e.target.value)}
              placeholder="Blank = unlimited"
            />
          </label>

          <label>
            Admin Name
            <input
              value={form.admin_name ?? ''}
              onChange={(e) => handleChange('admin_name', e.target.value)}
              placeholder="Company Admin"
            />
          </label>

          <label>
            Admin Email
            <input
              type="email"
              value={form.admin_email ?? ''}
              onChange={(e) => handleChange('admin_email', e.target.value)}
              placeholder="admin@example.com"
            />
          </label>

          <label>
            Admin Password
            <input
              value={form.admin_password ?? ''}
              onChange={(e) => handleChange('admin_password', e.target.value)}
              placeholder="Admin@123"
            />
          </label>

          <label>
            Domain
            <input
              value={form.domain ?? ''}
              onChange={(e) => handleChange('domain', e.target.value)}
              placeholder="example.com"
            />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            Address
            <input
              value={form.address ?? ''}
              onChange={(e) => handleChange('address', e.target.value)}
              placeholder="Company address"
            />
          </label>

          <button className="primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
            Create Company
          </button>
        </form>

        {message && (
          <div
            className="inline-message"
            style={{
              marginTop: 16,
            }}
          >
            {message}
          </div>
        )}

        <div
          style={{
            marginTop: 24,
            borderRadius: 24,
            border: '1px solid rgba(226,232,240,0.9)',
            overflow: 'hidden',
            background: '#ffffff',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                minWidth: 980,
                borderCollapse: 'collapse',
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {[
                    'Company',
                    'Tenant',
                    'Plan',
                    'Status',
                    'Employees',
                    'Trial / Subscription End',
                    'Actions',
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        textAlign: 'left',
                        padding: '13px 14px',
                        color: '#475569',
                        fontSize: 12,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        borderBottom: '1px solid rgba(226,232,240,0.9)',
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>
                      <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
                      Loading companies...
                    </td>
                  </tr>
                ) : rows.length ? (
                  rows.map((row) => {
                    const tenantId = getTenantId(row);
                    const isSds =
                      row.is_sds_company === true ||
                      String(row.tenant_code || '').toLowerCase() === 'sds';

                    return (
                      <tr key={tenantId || row._id}>
                        <td
                          style={{
                            padding: '14px',
                            borderBottom: '1px solid rgba(226,232,240,0.72)',
                            verticalAlign: 'top',
                          }}
                        >
                          <strong style={{ color: '#0f172a' }}>{getCompanyName(row)}</strong>
                          <div style={{ color: '#64748b', fontSize: 13 }}>
                            {safeText(getCompanyEmail(row))}
                          </div>
                          {isSds ? (
                            <div style={{ marginTop: 6 }}>
                              <StatusBadge value="Lifetime SDS" />
                            </div>
                          ) : null}
                        </td>

                        <td
                          style={{
                            padding: '14px',
                            borderBottom: '1px solid rgba(226,232,240,0.72)',
                            color: '#334155',
                          }}
                        >
                          <strong>{safeText(row.tenant_code)}</strong>
                          <div style={{ color: '#64748b', fontSize: 13 }}>
                            {safeText(tenantId)}
                          </div>
                        </td>

                        <td
                          style={{
                            padding: '14px',
                            borderBottom: '1px solid rgba(226,232,240,0.72)',
                          }}
                        >
                          <StatusBadge value={row.plan_type || row.plan} />
                        </td>

                        <td
                          style={{
                            padding: '14px',
                            borderBottom: '1px solid rgba(226,232,240,0.72)',
                          }}
                        >
                          <StatusBadge value={row.status} />
                        </td>

                        <td
                          style={{
                            padding: '14px',
                            borderBottom: '1px solid rgba(226,232,240,0.72)',
                            color: '#334155',
                          }}
                        >
                          {getEmployeeCount(row)} / {getEmployeeLimit(row)}
                        </td>

                        <td
                          style={{
                            padding: '14px',
                            borderBottom: '1px solid rgba(226,232,240,0.72)',
                            color: '#334155',
                          }}
                        >
                          {formatDate(row.trial_end_date || row.subscription_end_date)}
                        </td>

                        <td
                          style={{
                            padding: '14px',
                            borderBottom: '1px solid rgba(226,232,240,0.72)',
                          }}
                        >
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => openDetail(tenantId)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                            >
                              <Eye size={15} />
                              View
                            </button>

                            <button
                              type="button"
                              className="ghost"
                              onClick={() => runCompanyAction(tenantId, 'activate')}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                            >
                              <PlayCircle size={15} />
                              Activate
                            </button>

                            <button
                              type="button"
                              className="ghost"
                              onClick={() => handleSuspend(tenantId)}
                              disabled={isSds}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                            >
                              <PauseCircle size={15} />
                              Suspend
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>
                      No companies found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <DetailModal
        detail={detail}
        loading={detailLoading}
        onClose={() => {
          setDetail(null);
          setSelectedTenantId('');
        }}
        onActivate={(tenantId) => runCompanyAction(tenantId, 'activate')}
        onSuspend={handleSuspend}
        onExtendDemo={handleExtendDemo}
        onMarkPaid={handleMarkPaid}
      />
    </div>
  );
}