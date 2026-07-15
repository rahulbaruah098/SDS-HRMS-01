import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';

import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'paid', label: 'Paid' },
];

function safeText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatCurrency(value, currency = 'INR') {
  const amount = toNumber(value, 0);

  if (amount <= 0) {
    return 'Custom';
  }

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

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(value) {
  return safeText(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
  const normalized = String(status || '').trim().toLowerCase();

  if (['active', 'paid', 'captured', 'completed', 'success'].includes(normalized)) {
    return {
      background: 'rgba(22, 163, 74, 0.12)',
      color: '#166534',
      border: '1px solid rgba(22, 163, 74, 0.25)',
    };
  }

  if (['expired', 'failed', 'cancelled', 'rejected'].includes(normalized)) {
    return {
      background: 'rgba(220, 38, 38, 0.12)',
      color: '#991b1b',
      border: '1px solid rgba(220, 38, 38, 0.25)',
    };
  }

  if (['suspended', 'pending', 'created'].includes(normalized)) {
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
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        padding: '5px 10px',
        whiteSpace: 'nowrap',
      }}
    >
      {statusLabel(status)}
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, tone = '#2563eb' }) {
  return (
    <div
      className="stat-card"
      style={{
        padding: 18,
        minHeight: 118,
        border: '1px solid rgba(226,232,240,0.9)',
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

function DataTable({ title, description, columns, rows, loading, emptyText }) {
  return (
    <div
      style={{
        borderRadius: 24,
        background: '#ffffff',
        border: '1px solid rgba(226,232,240,0.9)',
        boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '18px 20px',
          borderBottom: '1px solid rgba(226,232,240,0.9)',
          background: 'linear-gradient(135deg, rgba(248,250,252,0.98), rgba(255,255,255,0.98))',
        }}
      >
        <h3 style={{ margin: 0, color: '#0f172a' }}>{title}</h3>
        {description ? (
          <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 14 }}>
            {description}
          </p>
        ) : null}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            minWidth: 850,
          }}
        >
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={{
                    padding: '12px 14px',
                    textAlign: 'left',
                    color: '#475569',
                    fontSize: 12,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    borderBottom: '1px solid rgba(226,232,240,0.9)',
                  }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: 30,
                    textAlign: 'center',
                    color: '#64748b',
                  }}
                >
                  <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
                  Loading records...
                </td>
              </tr>
            ) : rows.length ? (
              rows.map((row, index) => (
                <tr key={row._id || row.id || row.razorpay_order_id || row.razorpay_payment_id || row.plan_code || index}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      style={{
                        padding: '13px 14px',
                        borderBottom: '1px solid rgba(226,232,240,0.72)',
                        color: '#334155',
                        fontSize: 14,
                        verticalAlign: 'top',
                      }}
                    >
                      {column.render ? column.render(row) : safeText(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: 30,
                    textAlign: 'center',
                    color: '#64748b',
                  }}
                >
                  {emptyText || 'No records found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function toPlanDraft(plan = {}) {
  return {
    plan_code: safeText(plan.plan_code, ''),
    plan_name: safeText(plan.plan_name || plan.display_name, ''),
    display_name: safeText(plan.display_name || plan.plan_name, ''),
    description: safeText(plan.description, ''),
    amount: String(plan.amount ?? 0),
    currency: safeText(plan.currency, 'INR'),
    billing_interval: safeText(plan.billing_interval, 'monthly'),
    employee_limit:
      plan.employee_limit === null || plan.employee_limit === undefined
        ? ''
        : String(plan.employee_limit),
    included_employees:
      plan.included_employees === null || plan.included_employees === undefined
        ? ''
        : String(plan.included_employees),
    is_unlimited_employees: Boolean(plan.is_unlimited_employees),
    is_custom_pricing: Boolean(plan.is_custom_pricing),
    allow_online_payment: plan.allow_online_payment !== false,
    is_recommended: Boolean(plan.is_recommended),
    is_active: plan.is_active !== false,
    sort_order: String(plan.sort_order ?? 100),
    features: Array.isArray(plan.features) ? plan.features.join('\n') : '',
  };
}

function buildPlanPayload(draft = {}) {
  const isUnlimited = Boolean(draft.is_unlimited_employees);
  const employeeLimit = isUnlimited ? null : Number(draft.employee_limit || 0);
  const includedEmployees = isUnlimited ? null : Number(draft.included_employees || draft.employee_limit || 0);

  return {
    plan_code: draft.plan_code,
    plan_name: draft.plan_name,
    display_name: draft.display_name,
    description: draft.description,
    amount: Number(draft.amount || 0),
    currency: draft.currency || 'INR',
    billing_interval: draft.billing_interval || 'monthly',
    employee_limit: employeeLimit,
    included_employees: includedEmployees,
    is_unlimited_employees: isUnlimited,
    is_custom_pricing: Boolean(draft.is_custom_pricing),
    allow_online_payment: Boolean(draft.allow_online_payment),
    is_recommended: Boolean(draft.is_recommended),
    is_active: Boolean(draft.is_active),
    sort_order: Number(draft.sort_order || 100),
    features: String(draft.features || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function FieldLabel({ children }) {
  return (
    <label
      style={{
        display: 'block',
        color: '#475569',
        fontSize: 12,
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 6,
      }}
    >
      {children}
    </label>
  );
}

function inputStyle() {
  return {
    width: '100%',
    minHeight: 42,
    borderRadius: 14,
    border: '1px solid rgba(226,232,240,0.95)',
    padding: '0 12px',
    outline: 0,
    background: '#ffffff',
    color: '#0f172a',
  };
}

function checkboxRowStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#334155',
    fontSize: 13,
    fontWeight: 800,
  };
}

function PricingPlansPanel({
  pricingPlans,
  planDrafts,
  setPlanDrafts,
  loading,
  savingPlan,
  onSavePlan,
}) {
  return (
    <div
      style={{
        borderRadius: 24,
        background: '#ffffff',
        border: '1px solid rgba(226,232,240,0.9)',
        boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '18px 20px',
          borderBottom: '1px solid rgba(226,232,240,0.9)',
          background: 'linear-gradient(135deg, rgba(248,250,252,0.98), rgba(255,255,255,0.98))',
        }}
      >
        <h3 style={{ margin: 0, color: '#0f172a' }}>Dynamic Pricing Plans</h3>
        <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 14 }}>
          Superadmin can edit plan pricing and employee limits. These values are used on the Billing page and Razorpay orders.
        </p>
      </div>

      {loading ? (
        <div style={{ padding: 34, textAlign: 'center', color: '#64748b' }}>
          <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
          Loading pricing plans...
        </div>
      ) : pricingPlans.length ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
            gap: 16,
            padding: 18,
          }}
        >
          {pricingPlans.map((plan) => {
            const code = plan.plan_code;
            const draft = planDrafts[code] || toPlanDraft(plan);
            const isSaving = savingPlan === code;

            function updateDraft(field, value) {
              setPlanDrafts((prev) => ({
                ...prev,
                [code]: {
                  ...(prev[code] || toPlanDraft(plan)),
                  [field]: value,
                },
              }));
            }

            return (
              <div
                key={code}
                style={{
                  borderRadius: 22,
                  border: plan.is_recommended
                    ? '1px solid rgba(37,99,235,0.45)'
                    : '1px solid rgba(226,232,240,0.95)',
                  background: plan.is_recommended
                    ? 'linear-gradient(135deg, rgba(239,246,255,0.9), #ffffff)'
                    : '#ffffff',
                  padding: 18,
                  boxShadow: '0 12px 28px rgba(15,23,42,0.05)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'flex-start',
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <p
                      style={{
                        margin: 0,
                        color: '#2563eb',
                        fontSize: 12,
                        fontWeight: 900,
                        textTransform: 'uppercase',
                        letterSpacing: '0.07em',
                      }}
                    >
                      {code}
                    </p>
                    <h3 style={{ margin: '4px 0 0', color: '#0f172a' }}>
                      {safeText(plan.display_name || plan.plan_name)}
                    </h3>
                  </div>
                  <StatusBadge status={plan.is_active === false ? 'inactive' : 'active'} />
                </div>

                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <FieldLabel>Plan Name</FieldLabel>
                    <input
                      style={inputStyle()}
                      value={draft.display_name}
                      onChange={(event) => {
                        updateDraft('display_name', event.target.value);
                        updateDraft('plan_name', event.target.value);
                      }}
                    />
                  </div>

                  <div>
                    <FieldLabel>Description</FieldLabel>
                    <input
                      style={inputStyle()}
                      value={draft.description}
                      onChange={(event) => updateDraft('description', event.target.value)}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <FieldLabel>Amount</FieldLabel>
                      <input
                        style={inputStyle()}
                        type="number"
                        min="0"
                        value={draft.amount}
                        onChange={(event) => updateDraft('amount', event.target.value)}
                      />
                    </div>
                    <div>
                      <FieldLabel>Currency</FieldLabel>
                      <input
                        style={inputStyle()}
                        value={draft.currency}
                        onChange={(event) => updateDraft('currency', event.target.value.toUpperCase())}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <FieldLabel>Employee Limit</FieldLabel>
                      <input
                        style={inputStyle()}
                        type="number"
                        min="0"
                        disabled={draft.is_unlimited_employees}
                        value={draft.employee_limit}
                        onChange={(event) => updateDraft('employee_limit', event.target.value)}
                        placeholder={draft.is_unlimited_employees ? 'Unlimited' : '50'}
                      />
                    </div>
                    <div>
                      <FieldLabel>Billing Interval</FieldLabel>
                      <select
                        style={inputStyle()}
                        value={draft.billing_interval}
                        onChange={(event) => updateDraft('billing_interval', event.target.value)}
                      >
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Features</FieldLabel>
                    <textarea
                      value={draft.features}
                      onChange={(event) => updateDraft('features', event.target.value)}
                      rows={4}
                      style={{
                        ...inputStyle(),
                        paddingTop: 10,
                        resize: 'vertical',
                        lineHeight: 1.5,
                      }}
                      placeholder="One feature per line"
                    />
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
                      gap: 10,
                      padding: 12,
                      borderRadius: 16,
                      background: '#f8fafc',
                    }}
                  >
                    <label style={checkboxRowStyle()}>
                      <input
                        type="checkbox"
                        checked={draft.is_unlimited_employees}
                        onChange={(event) => updateDraft('is_unlimited_employees', event.target.checked)}
                      />
                      Unlimited employees
                    </label>

                    <label style={checkboxRowStyle()}>
                      <input
                        type="checkbox"
                        checked={draft.is_custom_pricing}
                        onChange={(event) => updateDraft('is_custom_pricing', event.target.checked)}
                      />
                      Custom pricing
                    </label>

                    <label style={checkboxRowStyle()}>
                      <input
                        type="checkbox"
                        checked={draft.allow_online_payment}
                        onChange={(event) => updateDraft('allow_online_payment', event.target.checked)}
                      />
                      Online payment
                    </label>

                    <label style={checkboxRowStyle()}>
                      <input
                        type="checkbox"
                        checked={draft.is_recommended}
                        onChange={(event) => updateDraft('is_recommended', event.target.checked)}
                      />
                      Recommended
                    </label>

                    <label style={checkboxRowStyle()}>
                      <input
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={(event) => updateDraft('is_active', event.target.checked)}
                      />
                      Active
                    </label>
                  </div>

                  <button
                    type="button"
                    className="primary"
                    onClick={() => onSavePlan(code)}
                    disabled={isSaving}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      minHeight: 44,
                    }}
                  >
                    {isSaving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                    Save {safeText(plan.display_name || plan.plan_name, 'Plan')}
                  </button>

                  <p style={{ margin: 0, color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>
                    Current: {formatCurrency(plan.amount, plan.currency)} ·{' '}
                    {plan.is_unlimited_employees ? 'Unlimited employees' : `${plan.employee_limit || 0} employees`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ padding: 34, textAlign: 'center', color: '#64748b' }}>
          No pricing plans found. Refresh to create default Essential, Growth, and Premium plans.
        </div>
      )}
    </div>
  );
}

export default function Subscriptions({ setPage }) {
  const { showAlert } = useCustomAlert();
  const [activeTab, setActiveTab] = useState('subscriptions');
  const [filters, setFilters] = useState({
    status: 'all',
    search: '',
  });
  const [loading, setLoading] = useState(false);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [refreshingExpired, setRefreshingExpired] = useState(false);
  const [savingPlan, setSavingPlan] = useState('');
  const [subscriptions, setSubscriptions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [pricingPlans, setPricingPlans] = useState([]);
  const [planDrafts, setPlanDrafts] = useState({});

  const summary = useMemo(() => {
    const activeSubscriptions = subscriptions.filter((item) =>
      ['active', 'paid'].includes(String(item.status || '').toLowerCase()),
    ).length;

    const expiredSubscriptions = subscriptions.filter((item) =>
      String(item.status || '').toLowerCase() === 'expired',
    ).length;

    const capturedPayments = payments.filter((item) =>
      ['captured', 'paid', 'success', 'completed'].includes(
        String(item.status || item.payment_status || '').toLowerCase(),
      ),
    );

    const totalRevenue = capturedPayments.reduce(
      (sum, item) => sum + toNumber(item.amount || item.amount_paid || 0),
      0,
    );

    const pendingOrders = orders.filter((item) =>
      ['created', 'pending'].includes(String(item.status || '').toLowerCase()),
    ).length;

    return {
      activeSubscriptions,
      expiredSubscriptions,
      totalRevenue,
      pendingOrders,
      pricingPlans: pricingPlans.length,
    };
  }, [subscriptions, payments, orders, pricingPlans]);

  async function loadPricingPlans() {
    setPricingLoading(true);

    try {
      const response = await api('/billing/admin/pricing-plans');
      const plans = response.items || response.plans || [];

      setPricingPlans(plans);
      setPlanDrafts(
        plans.reduce((acc, plan) => {
          acc[plan.plan_code] = toPlanDraft(plan);
          return acc;
        }, {}),
      );
    } catch (error) {
      showAlert({
        title: 'Unable to load pricing plans',
        message: error.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setPricingLoading(false);
    }
  }

  async function loadData() {
    setLoading(true);

    try {
      const query = buildQuery({
        status: filters.status,
        search: filters.search,
        limit: 100,
      });

      const [subscriptionResponse, paymentResponse, orderResponse] = await Promise.all([
        api(`/billing/admin/subscriptions${query}`),
        api(`/billing/admin/payments${buildQuery({ search: filters.search, limit: 100 })}`),
        api(`/billing/admin/orders${buildQuery({
          status: filters.status,
          search: filters.search,
          limit: 100,
        })}`),
      ]);

      setSubscriptions(subscriptionResponse.items || []);
      setPayments(paymentResponse.items || []);
      setOrders(orderResponse.items || []);
    } catch (error) {
      showAlert({
        title: 'Unable to load SaaS billing records',
        message: error.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  async function savePricingPlan(planCode) {
    const draft = planDrafts[planCode];

    if (!draft) {
      return;
    }

    if (!draft.is_unlimited_employees && Number(draft.employee_limit || 0) <= 0) {
      showAlert({
        title: 'Employee limit required',
        message: 'Non-premium/non-unlimited plans must have an employee limit.',
        type: 'warning',
      });
      return;
    }

    if (draft.allow_online_payment && !draft.is_custom_pricing && Number(draft.amount || 0) <= 0) {
      showAlert({
        title: 'Amount required',
        message: 'Online payment plans must have an amount greater than 0.',
        type: 'warning',
      });
      return;
    }

    setSavingPlan(planCode);

    try {
      const response = await api(`/billing/admin/pricing-plans/${encodeURIComponent(planCode)}`, {
        method: 'PATCH',
        body: JSON.stringify(buildPlanPayload(draft)),
      });

      showAlert({
        title: 'Pricing plan updated',
        message: response.message || 'Plan pricing and employee limit saved successfully.',
        type: 'success',
      });

      await loadPricingPlans();
    } catch (error) {
      showAlert({
        title: 'Unable to save pricing plan',
        message: error.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setSavingPlan('');
    }
  }

  async function refreshExpiredDemos() {
    setRefreshingExpired(true);

    try {
      const response = await api('/billing/admin/refresh-expired-demos', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      showAlert({
        title: 'Expired demos refreshed',
        message:
          response.message ||
          'Demo companies with completed trial periods were refreshed successfully.',
        type: 'success',
      });

      await loadData();
    } catch (error) {
      showAlert({
        title: 'Unable to refresh expired demos',
        message: error.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setRefreshingExpired(false);
    }
  }

  useEffect(() => {
    loadData();
    loadPricingPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscriptionColumns = [
    {
      key: 'company_name',
      label: 'Company',
      render: (row) => (
        <div>
          <strong style={{ color: '#0f172a' }}>
            {safeText(row.company_name || row.tenant_name)}
          </strong>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {safeText(row.company_email || row.tenant_email)}
          </div>
        </div>
      ),
    },
    {
      key: 'plan_name',
      label: 'Plan',
      render: (row) => (
        <div>
          <strong>{safeText(row.plan_name || row.plan_label || row.plan_type)}</strong>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {safeText(row.plan_code || row.selected_plan_code, '')}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'amount',
      label: 'Amount',
      render: (row) => formatCurrency(row.amount || row.plan_amount || 0, row.currency || 'INR'),
    },
    {
      key: 'employee_limit',
      label: 'Employee Limit',
      render: (row) =>
        row.is_unlimited_employees || row.employee_limit === null || row.employee_limit === undefined
          ? 'Unlimited'
          : safeText(row.employee_limit),
    },
    {
      key: 'start_date',
      label: 'Start',
      render: (row) => formatDate(row.start_date || row.subscription_start_date || row.created_at),
    },
    {
      key: 'end_date',
      label: 'End / Expiry',
      render: (row) => formatDate(row.end_date || row.subscription_end_date || row.trial_end_date),
    },
  ];

  const paymentColumns = [
    {
      key: 'company_name',
      label: 'Company',
      render: (row) => (
        <div>
          <strong style={{ color: '#0f172a' }}>
            {safeText(row.company_name || row.tenant_name)}
          </strong>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {safeText(row.company_email || row.tenant_email)}
          </div>
        </div>
      ),
    },
    {
      key: 'plan_name',
      label: 'Plan',
      render: (row) => (
        <div>
          <strong>{safeText(row.plan_name || row.plan_label || row.plan_code)}</strong>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {row.is_unlimited_employees ? 'Unlimited' : `${safeText(row.employee_limit, '—')} employees`}
          </div>
        </div>
      ),
    },
    {
      key: 'razorpay_payment_id',
      label: 'Payment ID',
      render: (row) => safeText(row.razorpay_payment_id),
    },
    {
      key: 'razorpay_order_id',
      label: 'Order ID',
      render: (row) => safeText(row.razorpay_order_id),
    },
    {
      key: 'amount',
      label: 'Amount',
      render: (row) => formatCurrency(row.amount || row.amount_paid || 0, row.currency || 'INR'),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge status={row.status || row.payment_status} />,
    },
    {
      key: 'paid_at',
      label: 'Paid At',
      render: (row) => formatDate(row.paid_at || row.created_at),
    },
  ];

  const orderColumns = [
    {
      key: 'company_name',
      label: 'Company',
      render: (row) => (
        <div>
          <strong style={{ color: '#0f172a' }}>
            {safeText(row.company_name || row.tenant_name)}
          </strong>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {safeText(row.company_email || row.tenant_email)}
          </div>
        </div>
      ),
    },
    {
      key: 'plan_name',
      label: 'Plan',
      render: (row) => (
        <div>
          <strong>{safeText(row.plan_name || row.plan_label || row.plan_code)}</strong>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {row.is_unlimited_employees ? 'Unlimited' : `${safeText(row.employee_limit, '—')} employees`}
          </div>
        </div>
      ),
    },
    {
      key: 'razorpay_order_id',
      label: 'Razorpay Order',
      render: (row) => safeText(row.razorpay_order_id),
    },
    {
      key: 'amount',
      label: 'Amount',
      render: (row) => formatCurrency(row.amount || 0, row.currency || 'INR'),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'created_at',
      label: 'Created At',
      render: (row) => formatDate(row.created_at),
    },
  ];

  return (
    <section className="panel">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          marginBottom: 22,
        }}
      >
        <div>
          <p
            style={{
              margin: '0 0 8px',
              color: '#2563eb',
              fontSize: 13,
              fontWeight: 900,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            SaaS Control
          </p>
          <h2 style={{ margin: 0 }}>Subscriptions, Payments & Pricing</h2>
          <p style={{ color: '#64748b', margin: '8px 0 0', maxWidth: 760 }}>
            Monitor demo expiries, paid subscriptions, Razorpay orders, payment
            records, and dynamic plan pricing for YourComate HRMS companies.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              loadData();
              loadPricingPlans();
            }}
            disabled={loading || pricingLoading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <RefreshCw size={16} className={loading || pricingLoading ? 'spin' : ''} />
            Refresh
          </button>

          <button
            type="button"
            className="primary"
            onClick={refreshExpiredDemos}
            disabled={refreshingExpired}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <AlertTriangle size={16} />
            Refresh Expired Trials
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <SummaryCard
          icon={ShieldCheck}
          label="Active Subscriptions"
          value={summary.activeSubscriptions}
          tone="#16a34a"
        />
        <SummaryCard
          icon={CalendarClock}
          label="Expired Trials"
          value={summary.expiredSubscriptions}
          tone="#dc2626"
        />
        <SummaryCard
          icon={IndianRupee}
          label="Captured Revenue"
          value={formatCurrency(summary.totalRevenue)}
          tone="#7c3aed"
        />
        <SummaryCard
          icon={WalletCards}
          label="Pending Orders"
          value={summary.pendingOrders}
          tone="#ea580c"
        />
        <SummaryCard
          icon={Settings}
          label="Pricing Plans"
          value={summary.pricingPlans}
          tone="#2563eb"
        />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: 16,
          borderRadius: 22,
          background: '#f8fafc',
          border: '1px solid rgba(226,232,240,0.9)',
          marginBottom: 22,
        }}
      >
        <div
          style={{
            flex: '1 1 260px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#ffffff',
            borderRadius: 16,
            padding: '0 12px',
            border: '1px solid rgba(226,232,240,0.9)',
          }}
        >
          <Search size={18} color="#64748b" />
          <input
            value={filters.search}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                search: event.target.value,
              }))
            }
            placeholder="Search company, email, order ID, payment ID, plan..."
            style={{
              border: 0,
              outline: 0,
              minHeight: 44,
              width: '100%',
              background: 'transparent',
            }}
          />
        </div>

        <select
          value={filters.status}
          onChange={(event) =>
            setFilters((prev) => ({
              ...prev,
              status: event.target.value,
            }))
          }
          style={{
            minHeight: 44,
            borderRadius: 14,
            border: '1px solid rgba(226,232,240,0.9)',
            padding: '0 12px',
            background: '#ffffff',
            color: '#334155',
          }}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="primary"
          onClick={loadData}
          disabled={loading}
        >
          Apply Filter
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 18,
        }}
      >
        {[
          ['subscriptions', 'Subscriptions'],
          ['payments', 'Payments'],
          ['orders', 'Razorpay Orders'],
          ['pricing', 'Pricing Plans'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={activeTab === key ? 'primary' : 'ghost'}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'subscriptions' ? (
        <DataTable
          title="Company Subscriptions"
          description="Shows demo, expired, lifetime, and paid subscription records."
          columns={subscriptionColumns}
          rows={subscriptions}
          loading={loading}
          emptyText="No subscription records found."
        />
      ) : null}

      {activeTab === 'payments' ? (
        <DataTable
          title="Payment Records"
          description="Shows verified Razorpay payments after successful company upgrades."
          columns={paymentColumns}
          rows={payments}
          loading={loading}
          emptyText="No payment records found."
        />
      ) : null}

      {activeTab === 'orders' ? (
        <DataTable
          title="Razorpay Orders"
          description="Shows generated Razorpay checkout orders for subscription upgrades."
          columns={orderColumns}
          rows={orders}
          loading={loading}
          emptyText="No Razorpay order records found."
        />
      ) : null}

      {activeTab === 'pricing' ? (
        <PricingPlansPanel
          pricingPlans={pricingPlans}
          planDrafts={planDrafts}
          setPlanDrafts={setPlanDrafts}
          loading={pricingLoading}
          savingPlan={savingPlan}
          onSavePlan={savePricingPlan}
        />
      ) : null}

      <div
        style={{
          marginTop: 20,
          padding: 16,
          borderRadius: 18,
          background: 'rgba(37,99,235,0.08)',
          color: '#1e3a8a',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <CheckCircle2 size={20} style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          SDS lifetime companies do not need payment. New companies get a
          15-day full-access trial. After expiry, payment converts the demo
          company into an official paid company with the selected plan limit.
        </p>
      </div>
    </section>
  );
}