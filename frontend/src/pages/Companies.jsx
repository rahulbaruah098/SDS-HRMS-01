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
  { value: 'demo', label: 'Trial' },
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
      className="company-detail-backdrop"
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
        className="company-detail-modal"
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
                Extend Trial
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
                <h3 style={{ margin: '0 0 12px' }}>Trial Request</h3>
                {demoRequest ? (
                  <>
                    <p><strong>Status:</strong> {safeText(demoRequest.status)}</p>
                    <p><strong>OTP Verified:</strong> {demoRequest.otp_verified ? 'Yes' : 'No'}</p>
                    <p><strong>Requested:</strong> {formatDate(demoRequest.created_at || demoRequest.requested_at)}</p>
                    <p><strong>Approved:</strong> {formatDate(demoRequest.approved_at)}</p>
                  </>
                ) : (
                  <p style={{ color: '#64748b' }}>No linked trial request found.</p>
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

// SaaS companies page uses 15-day full-access trial display wording.
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
    const daysText = window.prompt('Extend trial by how many days?', '7');

    if (daysText === null) {
      return;
    }

    const days = Number(daysText);

    if (!Number.isFinite(days) || days <= 0) {
      setMessage('Please enter a valid number of days.');
      return;
    }

    const reason = window.prompt('Reason for trial extension:', 'Superadmin approved trial extension');

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
    <div className="page-grid companies-control-page">

      <style>{`
        .companies-control-page{
          --company-ink:#101a3a;
          --company-muted:#596483;
          --company-primary:#6254da;
          --company-deep:#342b78;
          --company-blue:#3766db;
          --company-teal:#18aaa8;
          --company-flat-blue:#b9d7ff;
          --company-flat-violet:#c9c0ff;
          --company-flat-teal:#aee6d9;
          --company-ease:cubic-bezier(.22,1,.36,1);
          display:grid;
          gap:22px;
          width:100%;
          min-width:0;
          padding-bottom:max(34px,env(safe-area-inset-bottom));
          color:var(--company-ink);
          font-family:var(--yc-ui,var(--body),inherit);
        }

        .companies-control-page>.hero{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:28px;
          min-height:230px;
          padding:clamp(25px,3vw,40px);
          border:1px solid rgba(171,181,211,.72);
          border-radius:clamp(28px,2.5vw,40px);
          background:
            radial-gradient(circle at 8% 8%,rgba(121,219,238,.34),transparent 31%),
            radial-gradient(circle at 92% 12%,rgba(191,190,249,.3),transparent 34%),
            linear-gradient(135deg,#f1fbff 0%,#fffdf8 48%,#f8f2ff 100%);
          box-shadow:12px 14px 0 var(--company-flat-blue),0 28px 48px rgba(34,38,110,.13);
        }

        .companies-control-page>.hero::before{
          content:"";
          position:absolute;
          inset:0;
          z-index:-2;
          opacity:.42;
          pointer-events:none;
          background-image:
            linear-gradient(rgba(65,55,161,.035) 1px,transparent 1px),
            linear-gradient(90deg,rgba(65,55,161,.035) 1px,transparent 1px);
          background-size:42px 42px;
        }

        .companies-control-page>.hero::after{
          content:"";
          position:absolute;
          z-index:-1;
          width:clamp(165px,20vw,290px);
          aspect-ratio:1;
          right:clamp(-110px,-7vw,-55px);
          top:clamp(-118px,-8vw,-60px);
          border:1px solid rgba(65,55,161,.12);
          border-radius:34% 66% 58% 42% / 44% 38% 62% 56%;
          background:linear-gradient(145deg,rgba(105,217,208,.72),rgba(121,189,242,.72));
          transform:rotate(18deg);
        }

        .companies-control-page .kicker{
          display:inline-flex;
          align-items:center;
          width:fit-content;
          padding:9px 13px;
          border-radius:999px;
          color:#fff;
          background:var(--company-deep);
          font-size:9px;
          font-weight:950;
          line-height:1;
          letter-spacing:.12em;
          text-transform:uppercase;
        }

        .companies-control-page>.hero h1{
          margin:15px 0 10px;
          color:var(--company-ink);
          font-family:var(--yc-display,var(--heading),inherit);
          font-size:clamp(34px,4.4vw,66px);
          font-weight:760;
          line-height:.94;
          letter-spacing:-.055em;
        }

        .companies-control-page>.hero p{
          max-width:830px;
          margin:0;
          color:var(--company-muted);
          font-size:clamp(13px,1vw,16px);
          line-height:1.68;
        }

        .companies-control-page button{
          touch-action:manipulation;
          font-weight:900;
          transition:transform 240ms var(--company-ease),box-shadow 240ms var(--company-ease),filter 200ms ease;
        }

        .companies-control-page button:hover:not(:disabled){
          transform:translateY(-2px);
          filter:saturate(1.04);
        }

        .companies-control-page button:active:not(:disabled){
          transform:translateY(0) scale(.985);
        }

        .companies-control-page button:disabled{
          cursor:not-allowed;
          opacity:.56;
          transform:none;
          filter:none;
        }

        .companies-control-page .primary,
        .companies-control-page .ghost{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          min-height:42px;
          padding:0 14px;
          border-radius:13px;
          line-height:1;
          white-space:nowrap;
        }

        .companies-control-page .primary{
          border:1px solid rgba(52,43,120,.16);
          color:#fff;
          background:linear-gradient(145deg,#4f72df,#2bb9b5);
          box-shadow:5px 6px 0 rgba(52,43,120,.8),0 12px 22px rgba(55,102,219,.16);
        }

        .companies-control-page .ghost{
          border:1px solid rgba(98,84,218,.18);
          color:var(--company-deep);
          background:#f1efff;
          box-shadow:3px 4px 0 rgba(98,84,218,.12);
        }

        .companies-control-page>.panel{
          min-width:0;
          overflow:hidden;
          padding:24px;
          border:1px solid rgba(171,181,211,.72);
          border-radius:clamp(24px,2vw,32px);
          background:linear-gradient(145deg,rgba(255,255,255,.99),rgba(244,249,255,.98));
          box-shadow:9px 11px 0 #d1dcfa,0 24px 42px rgba(34,38,110,.1);
        }

        .companies-control-page>.panel>div:first-child{
          margin-bottom:24px!important;
        }

        .companies-control-page .stat-card{
          border:1px solid rgba(171,181,211,.68)!important;
          border-radius:21px!important;
          background:#f8fbff!important;
          box-shadow:7px 9px 0 var(--company-flat-blue),0 18px 30px rgba(15,20,75,.08)!important;
          transition:transform 260ms var(--company-ease),border-color 220ms ease!important;
        }

        .companies-control-page .stat-card:hover{
          transform:translateY(-3px);
          border-color:rgba(98,84,218,.3)!important;
        }

        .companies-control-page .stat-card:nth-child(2n){
          background:#eaf8f4!important;
          box-shadow:7px 9px 0 var(--company-flat-teal),0 18px 30px rgba(15,20,75,.08)!important;
        }

        .companies-control-page .stat-card:nth-child(3n){
          background:#f1efff!important;
          box-shadow:7px 9px 0 var(--company-flat-violet),0 18px 30px rgba(15,20,75,.08)!important;
        }

        .companies-control-page .toolbar{
          padding:17px!important;
          border:1px solid rgba(98,84,218,.09);
          border-radius:18px;
          background:linear-gradient(145deg,rgba(237,248,255,.5),rgba(248,241,255,.45));
        }

        .companies-control-page .search{
          min-height:44px;
          border:1px solid rgba(159,169,205,.62)!important;
          border-radius:14px!important;
          background:#fff!important;
        }

        .companies-control-page .search input{
          min-height:42px;
          color:var(--company-ink);
          background:transparent;
        }

        .companies-control-page .toolbar select{
          min-height:44px!important;
          border:1px solid rgba(159,169,205,.62)!important;
          border-radius:14px!important;
          background:#fff!important;
          color:var(--company-ink)!important;
        }

        .companies-control-page .dynamic-form{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:14px;
          padding:20px;
          border:1px solid rgba(98,84,218,.09);
          border-radius:20px;
          background:linear-gradient(145deg,rgba(237,248,255,.44),rgba(248,241,255,.34));
        }

        .companies-control-page .dynamic-form label{
          display:grid;
          min-width:0;
          gap:7px;
          color:#334164;
          font-size:12px;
          font-weight:900;
        }

        .companies-control-page .dynamic-form input,
        .companies-control-page .dynamic-form select{
          width:100%;
          min-width:0;
          min-height:46px;
          border:1px solid rgba(159,169,205,.62);
          border-radius:14px;
          outline:none;
          color:var(--company-ink);
          background:rgba(255,255,255,.92);
          padding:0 13px;
          font:inherit;
          font-weight:600;
          transition:border-color 180ms ease,box-shadow 180ms ease,background 180ms ease;
        }

        .companies-control-page .dynamic-form input:hover,
        .companies-control-page .dynamic-form select:hover{
          border-color:rgba(98,84,218,.34);
        }

        .companies-control-page .dynamic-form input:focus,
        .companies-control-page .dynamic-form select:focus{
          border-color:var(--company-primary);
          background:#fff;
          box-shadow:0 0 0 4px rgba(98,84,218,.11);
        }

        .companies-control-page .dynamic-form>button{
          align-self:end;
        }

        .companies-control-page .inline-message{
          padding:14px 16px!important;
          border:1px solid rgba(98,84,218,.14)!important;
          border-radius:15px!important;
          color:var(--company-deep)!important;
          background:#f1efff!important;
          font-size:12px;
          font-weight:850;
        }

        .companies-control-page table{
          border-collapse:separate!important;
          border-spacing:0!important;
        }

        .companies-control-page thead tr{
          background:rgba(241,239,255,.94)!important;
        }

        .companies-control-page th{
          position:sticky;
          top:0;
          z-index:2;
          padding:14px 16px!important;
          border-bottom:1px solid rgba(65,55,161,.11)!important;
          color:#4f5e7f!important;
          background:rgba(241,239,255,.94)!important;
          backdrop-filter:blur(12px);
          font-size:10px!important;
        }

        .companies-control-page td{
          padding:16px!important;
          border-bottom:1px solid rgba(65,55,161,.09)!important;
          color:#334164!important;
          background:rgba(255,255,255,.66);
        }

        .companies-control-page tbody tr:hover td{
          background:rgba(237,246,255,.82);
        }

        .companies-control-page tbody strong{
          color:var(--company-ink)!important;
        }

        .companies-control-page .spin{
          animation:companySpin .8s linear infinite;
        }

        @keyframes companySpin{
          to{transform:rotate(360deg)}
        }

        .company-detail-backdrop{
          z-index:10000!important;
          width:100vw;
          height:100dvh;
          overflow:hidden;
          padding:
            max(14px,env(safe-area-inset-top))
            max(14px,env(safe-area-inset-right))
            max(14px,env(safe-area-inset-bottom))
            max(14px,env(safe-area-inset-left))!important;
          background:rgba(15,23,42,.48)!important;
          backdrop-filter:blur(9px);
          -webkit-backdrop-filter:blur(9px);
          animation:companyBackdropEnter 260ms ease both;
        }

        @keyframes companyBackdropEnter{
          from{opacity:0;backdrop-filter:blur(0)}
          to{opacity:1;backdrop-filter:blur(9px)}
        }

        .company-detail-modal{
          max-height:calc(100dvh - 28px)!important;
          overscroll-behavior:contain;
          border:1px solid rgba(171,181,211,.72);
          background:linear-gradient(145deg,#fff 0%,#f4fbff 52%,#f8f1ff 100%)!important;
          box-shadow:0 34px 90px rgba(34,38,110,.25),10px 12px 0 rgba(185,215,255,.5)!important;
          animation:companyModalEnter 420ms var(--company-ease) both;
          transform-origin:50% 14%;
          -webkit-overflow-scrolling:touch;
        }

        @keyframes companyModalEnter{
          from{opacity:0;transform:translateY(22px) scale(.965);filter:blur(4px)}
          to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}
        }

        .company-detail-modal>div:first-child{
          position:sticky;
          top:0;
          z-index:3;
          background:
            radial-gradient(circle at 92% 0%,rgba(105,217,208,.16),transparent 35%),
            radial-gradient(circle at 5% 0%,rgba(98,84,218,.14),transparent 39%),
            rgba(255,255,255,.93)!important;
          backdrop-filter:blur(14px);
        }

        .company-detail-modal .stat-card{
          border:1px solid rgba(171,181,211,.68)!important;
          border-radius:19px!important;
          background:#f8fbff!important;
          box-shadow:5px 6px 0 #d1dcfa,0 14px 24px rgba(34,38,110,.08)!important;
        }

        .company-detail-modal h2,
        .company-detail-modal h3{
          color:var(--company-ink);
          font-family:var(--yc-display,var(--heading),inherit);
        }

        .company-detail-modal p{
          line-height:1.55;
        }

        @media (max-width:1180px){
          .companies-control-page .dynamic-form{
            grid-template-columns:repeat(3,minmax(0,1fr));
          }
        }

        @media (max-width:860px){
          .companies-control-page .dynamic-form{
            grid-template-columns:repeat(2,minmax(0,1fr));
          }
        }

        @media (max-width:640px){
          .companies-control-page{
            gap:16px;
          }

          .companies-control-page>.hero{
            align-items:flex-start;
            flex-direction:column;
            min-height:auto;
            padding:20px;
            border-radius:24px;
            box-shadow:7px 8px 0 var(--company-flat-blue),0 18px 30px rgba(34,38,110,.1);
          }

          .companies-control-page>.hero h1{
            font-size:clamp(31px,9.2vw,43px);
          }

          .companies-control-page>.panel{
            padding:16px;
            border-radius:23px;
            box-shadow:6px 7px 0 #d1dcfa,0 16px 28px rgba(34,38,110,.08);
          }

          .companies-control-page .toolbar{
            align-items:stretch!important;
            flex-direction:column;
          }

          .companies-control-page .toolbar>*{
            width:100%!important;
            flex-basis:auto!important;
          }

          .companies-control-page .dynamic-form{
            grid-template-columns:1fr;
            padding:16px;
          }

          .companies-control-page .dynamic-form>button{
            width:100%;
          }

          .company-detail-backdrop{
            align-items:end!important;
            padding:0!important;
          }

          .company-detail-modal{
            width:100%!important;
            max-height:calc(100dvh - max(8px,env(safe-area-inset-top)))!important;
            border-radius:25px 25px 0 0!important;
            box-shadow:0 -18px 60px rgba(34,38,110,.24)!important;
            animation-name:companyMobileSheetEnter;
            transform-origin:50% 100%;
          }

          @keyframes companyMobileSheetEnter{
            from{opacity:0;transform:translateY(100%);filter:blur(3px)}
            to{opacity:1;transform:translateY(0);filter:blur(0)}
          }

          .company-detail-modal>div:first-child{
            padding-left:max(18px,env(safe-area-inset-left))!important;
            padding-right:max(18px,env(safe-area-inset-right))!important;
          }
        }

        @media (prefers-reduced-motion:reduce){
          .companies-control-page *,
          .companies-control-page *::before,
          .companies-control-page *::after,
          .company-detail-backdrop,
          .company-detail-modal{
            animation-duration:.01ms!important;
            animation-iteration-count:1!important;
            transition-duration:.01ms!important;
            scroll-behavior:auto!important;
          }
        }
      `}</style>

      <section className="hero compact">
        <div>
          <span className="kicker">SaaS Tenant Control</span>
          <h1>Companies / Tenants</h1>
          <p>
            Monitor all companies using YourComate HRMS, manage trial and paid
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
          <SummaryCard icon={CalendarClock} label="Trial" value={summary.demo || 0} tone="#2563eb" />
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
              <option value="demo">Trial</option>
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