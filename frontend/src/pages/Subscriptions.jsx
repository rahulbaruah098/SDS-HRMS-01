import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Download,
  IndianRupee,
  Loader2,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  TimerReset,
  WalletCards,
} from 'lucide-react';

import { api, getToken } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'paid', label: 'Paid' },
  { value: 'trial', label: 'Trial' },
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

function normalizeStatus(value) {
  return safeText(value, '').toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function getDaysLeft(row = {}) {
  const explicit = row.days_left ?? row.subscription_days_left ?? row.trial_days_left;

  if (explicit !== undefined && explicit !== null && explicit !== '') {
    return Math.max(0, Math.ceil(toNumber(explicit, 0)));
  }

  const endDate =
    row.valid_until ||
    row.end_date ||
    row.subscription_end_date ||
    row.trial_end_date ||
    row.next_due_date;

  if (!endDate) {
    return null;
  }

  const parsed = new Date(typeof endDate === 'object' && endDate.$date ? endDate.$date : endDate);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const difference = parsed.getTime() - Date.now();
  return difference <= 0 ? 0 : Math.ceil(difference / (1000 * 60 * 60 * 24));
}

function getValidityLabel(row = {}) {
  const normalized = normalizeStatus(row.status);

  if (['lifetime', 'lifetime_active'].includes(normalized) || row.plan_type === 'lifetime') {
    return 'Lifetime access';
  }

  const daysLeft = getDaysLeft(row);

  if (daysLeft === null) {
    return 'Validity unavailable';
  }

  if (daysLeft <= 0) {
    return 'Expired';
  }

  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`;
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

function buildBillingApiUrl(path = '') {
  const value = String(path || '').trim();

  if (!value) {
    return '';
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const envBase = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '');
  let apiBase = envBase;

  if (!apiBase && typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    apiBase =
      !hostname || hostname === 'localhost' || hostname === '127.0.0.1'
        ? 'http://127.0.0.1:5000/api/v1'
        : `${protocol}//${hostname}:5000/api/v1`;
  }

  const normalizedPath = value.startsWith('/') ? value : `/${value}`;

  if (normalizedPath.startsWith('/api/v1/')) {
    const origin = apiBase.replace(/\/api\/v1$/i, '');
    return `${origin}${normalizedPath}`;
  }

  return `${apiBase}${normalizedPath}`;
}

function getDownloadFilename(response, payment = {}) {
  const disposition = response.headers.get('content-disposition') || '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  const rawFilename = utf8Match?.[1] || plainMatch?.[1] || '';

  if (rawFilename) {
    try {
      return decodeURIComponent(rawFilename);
    } catch {
      return rawFilename;
    }
  }

  const reference = safeText(
    payment.invoice_number || payment.receipt_number || payment.razorpay_payment_id,
    'yourcomate-invoice',
  ).replace(/[^a-z0-9_-]+/gi, '-');

  return `${reference}.pdf`;
}

function paymentIdentity(payment = {}, index = 0) {
  return safeText(
    payment.id ||
      payment._id ||
      payment.razorpay_payment_id ||
      payment.invoice_number ||
      payment.receipt_number,
    `payment-${index}`,
  );
}

function alertStyle(level = 'info') {
  const normalized = normalizeStatus(level);

  if (['critical', 'error', 'danger'].includes(normalized)) {
    return {
      background: 'rgba(254,226,226,0.86)',
      border: '1px solid rgba(220,38,38,0.22)',
      color: '#991b1b',
      icon: '#dc2626',
    };
  }

  if (['warning', 'attention'].includes(normalized)) {
    return {
      background: 'rgba(255,247,237,0.92)',
      border: '1px solid rgba(234,88,12,0.22)',
      color: '#9a3412',
      icon: '#ea580c',
    };
  }

  if (['success', 'healthy'].includes(normalized)) {
    return {
      background: 'rgba(240,253,244,0.9)',
      border: '1px solid rgba(22,163,74,0.22)',
      color: '#166534',
      icon: '#16a34a',
    };
  }

  return {
    background: 'rgba(239,246,255,0.92)',
    border: '1px solid rgba(37,99,235,0.22)',
    color: '#1e40af',
    icon: '#2563eb',
  };
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

function AlertMessage({ level = 'info', message, compact = false }) {
  if (!message) {
    return <span style={{ color: '#94a3b8' }}>No alert</span>;
  }

  const tone = alertStyle(level);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        borderRadius: compact ? 12 : 16,
        padding: compact ? '8px 10px' : '11px 12px',
        background: tone.background,
        border: tone.border,
        color: tone.color,
        fontSize: compact ? 12 : 13,
        lineHeight: 1.45,
        maxWidth: compact ? 330 : 'none',
      }}
    >
      <AlertTriangle size={compact ? 14 : 16} color={tone.icon} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{message}</span>
    </div>
  );
}

function BillingAlertCenter({ alerts = [], hiddenCount = 0 }) {
  if (!alerts.length) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: 16,
          marginBottom: 22,
          borderRadius: 20,
          background: 'rgba(240,253,244,0.9)',
          border: '1px solid rgba(22,163,74,0.22)',
          color: '#166534',
        }}
      >
        <CheckCircle2 size={21} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong style={{ display: 'block', marginBottom: 3 }}>No urgent billing alerts</strong>
          <span style={{ fontSize: 13, lineHeight: 1.5 }}>
            No subscription expiry, overdue payment, or failed-payment issue currently requires Superadmin attention.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: 22,
        borderRadius: 22,
        background: '#ffffff',
        border: '1px solid rgba(226,232,240,0.95)',
        boxShadow: '0 14px 34px rgba(15,23,42,0.06)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '15px 18px',
          background: 'linear-gradient(135deg, rgba(255,247,237,0.95), rgba(255,255,255,0.98))',
          borderBottom: '1px solid rgba(226,232,240,0.9)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <BellRing size={19} color="#ea580c" />
          <strong style={{ color: '#0f172a' }}>Billing alerts requiring attention</strong>
        </div>
        <span
          style={{
            borderRadius: 999,
            background: 'rgba(234,88,12,0.12)',
            color: '#9a3412',
            fontWeight: 900,
            fontSize: 12,
            padding: '5px 9px',
          }}
        >
          {alerts.length + hiddenCount} alert{alerts.length + hiddenCount === 1 ? '' : 's'}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 10, padding: 14 }}>
        {alerts.map((alert, index) => {
          const tone = alertStyle(alert.level);
          return (
            <div
              key={`${alert.type || 'alert'}-${alert.id || index}`}
              style={{
                display: 'flex',
                gap: 11,
                alignItems: 'flex-start',
                padding: 13,
                borderRadius: 17,
                background: tone.background,
                border: tone.border,
                color: tone.color,
              }}
            >
              <AlertTriangle size={18} color={tone.icon} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', color: 'inherit', marginBottom: 3 }}>
                  {safeText(alert.title, 'Billing attention required')}
                </strong>
                <span style={{ display: 'block', fontSize: 13, lineHeight: 1.5 }}>
                  {safeText(alert.message)}
                </span>
              </div>
            </div>
          );
        })}

        {hiddenCount > 0 ? (
          <p style={{ margin: '2px 4px 0', color: '#64748b', fontSize: 12 }}>
            {hiddenCount} additional alert{hiddenCount === 1 ? '' : 's'} are shown in the relevant table below.
          </p>
        ) : null}
      </div>
    </div>
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
  const isPremium = normalizeStatus(draft.plan_code) === 'premium';
  const isUnlimited = Boolean(draft.is_unlimited_employees);
  const employeeLimit = isUnlimited ? null : Number(draft.employee_limit || 0);
  const includedEmployees = isUnlimited ? null : Number(draft.included_employees || draft.employee_limit || 0);

  return {
    plan_code: draft.plan_code,
    plan_name: draft.plan_name,
    display_name: draft.display_name,
    description: draft.description,
    amount: isPremium ? 0 : Number(draft.amount || 0),
    currency: draft.currency || 'INR',
    billing_interval: isPremium ? 'custom' : draft.billing_interval || 'monthly',
    employee_limit: employeeLimit,
    included_employees: includedEmployees,
    is_unlimited_employees: isUnlimited,
    is_custom_pricing: isPremium ? true : Boolean(draft.is_custom_pricing),
    allow_online_payment: isPremium ? false : Boolean(draft.allow_online_payment),
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
          Essential and Growth use Superadmin-controlled dynamic pricing. Premium remains quotation-based and cannot use direct checkout pricing.
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
            const isPremium = normalizeStatus(code) === 'premium';

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
                        disabled={isPremium}
                        value={isPremium ? '0' : draft.amount}
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
                        disabled={isPremium}
                        value={isPremium ? 'custom' : draft.billing_interval}
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
                        checked={isPremium || draft.is_custom_pricing}
                        disabled={isPremium}
                        onChange={(event) => updateDraft('is_custom_pricing', event.target.checked)}
                      />
                      Custom pricing
                    </label>

                    <label style={checkboxRowStyle()}>
                      <input
                        type="checkbox"
                        checked={!isPremium && draft.allow_online_payment}
                        disabled={isPremium}
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

                  {isPremium ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: 11,
                        borderRadius: 14,
                        background: 'rgba(124,58,237,0.08)',
                        border: '1px solid rgba(124,58,237,0.18)',
                        color: '#5b21b6',
                        fontSize: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                      Premium amount and billing interval are finalized per company quotation. Direct default-price Razorpay checkout remains disabled.
                    </div>
                  ) : null}

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
  const [downloadingPaymentId, setDownloadingPaymentId] = useState('');
  const [subscriptions, setSubscriptions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [pricingPlans, setPricingPlans] = useState([]);
  const [planDrafts, setPlanDrafts] = useState({});

  const summary = useMemo(() => {
    const activeSubscriptions = subscriptions.filter((item) =>
      ['active', 'paid', 'lifetime'].includes(normalizeStatus(item.status)),
    ).length;

    const expiringSubscriptions = subscriptions.filter((item) => {
      const daysLeft = getDaysLeft(item);
      return Boolean(
        item.renewal_due_soon ||
          (['active', 'paid'].includes(normalizeStatus(item.status)) &&
            daysLeft !== null &&
            daysLeft > 0 &&
            daysLeft <= 7),
      );
    }).length;

    const expiredSubscriptions = subscriptions.filter((item) =>
      normalizeStatus(item.status) === 'expired' || getDaysLeft(item) === 0,
    ).length;

    const capturedPayments = payments.filter((item) =>
      ['captured', 'paid', 'success', 'completed'].includes(
        normalizeStatus(item.status || item.payment_status),
      ),
    );

    const failedPayments = payments.filter((item) =>
      ['failed', 'cancelled', 'rejected'].includes(
        normalizeStatus(item.status || item.payment_status),
      ),
    ).length;

    const totalRevenue = capturedPayments.reduce(
      (sum, item) => sum + toNumber(item.amount || item.amount_paid || 0),
      0,
    );

    const pendingOrders = orders.filter((item) =>
      ['created', 'pending'].includes(normalizeStatus(item.status)),
    ).length;

    return {
      activeSubscriptions,
      expiringSubscriptions,
      expiredSubscriptions,
      failedPayments,
      totalRevenue,
      pendingOrders,
      pricingPlans: pricingPlans.length,
    };
  }, [subscriptions, payments, orders, pricingPlans]);

  const allBillingAlerts = useMemo(() => {
    const alerts = [];

    subscriptions.forEach((item, index) => {
      const daysLeft = getDaysLeft(item);
      const status = normalizeStatus(item.status);
      const company = safeText(item.company_name || item.tenant_name, 'Company');
      const id = safeText(item._id || item.id || item.tenant_id, `subscription-${index}`);
      const backendMessage = safeText(item.alert_message, '');

      if (backendMessage && !['healthy', 'success'].includes(normalizeStatus(item.alert_level))) {
        alerts.push({
          id,
          type: 'subscription',
          level: item.alert_level || (status === 'expired' ? 'critical' : 'warning'),
          title: `${company} subscription`,
          message: backendMessage,
        });
        return;
      }

      if (status === 'expired' || daysLeft === 0) {
        alerts.push({
          id,
          type: 'subscription',
          level: 'critical',
          title: `${company} subscription expired`,
          message: 'Company access requires renewal or Superadmin review.',
        });
      } else if (
        item.renewal_due_soon ||
        (['active', 'paid'].includes(status) && daysLeft !== null && daysLeft > 0 && daysLeft <= 7)
      ) {
        alerts.push({
          id,
          type: 'subscription',
          level: 'warning',
          title: `${company} renewal is due soon`,
          message: `${daysLeft} day${daysLeft === 1 ? '' : 's'} remain before the current subscription ends.`,
        });
      }
    });

    payments.forEach((item, index) => {
      const status = normalizeStatus(item.status || item.payment_status);

      if (!['failed', 'cancelled', 'rejected'].includes(status)) {
        return;
      }

      const company = safeText(item.company_name || item.tenant_name, 'Company');
      alerts.push({
        id: safeText(item._id || item.id || item.razorpay_payment_id, `payment-${index}`),
        type: 'payment',
        level: 'critical',
        title: `${company} payment ${statusLabel(status)}`,
        message: `Payment ${safeText(item.razorpay_payment_id || item.razorpay_order_id, 'record')} requires review.`,
      });
    });

    const staleOrderCutoff = Date.now() - 24 * 60 * 60 * 1000;

    orders.forEach((item, index) => {
      const status = normalizeStatus(item.status);

      if (!['created', 'pending'].includes(status)) {
        return;
      }

      const createdAt = new Date(item.created_at || item.updated_at || '');

      if (Number.isNaN(createdAt.getTime()) || createdAt.getTime() > staleOrderCutoff) {
        return;
      }

      const company = safeText(item.company_name || item.tenant_name, 'Company');
      alerts.push({
        id: safeText(item._id || item.id || item.razorpay_order_id, `order-${index}`),
        type: 'order',
        level: 'warning',
        title: `${company} has an incomplete order`,
        message: `Razorpay order ${safeText(item.razorpay_order_id)} has remained ${status} for more than 24 hours.`,
      });
    });

    return alerts;
  }, [subscriptions, payments, orders]);

  const visibleBillingAlerts = allBillingAlerts.slice(0, 6);
  const hiddenBillingAlertCount = Math.max(allBillingAlerts.length - visibleBillingAlerts.length, 0);


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

    const isPremium = normalizeStatus(planCode) === 'premium';

    if (!isPremium && draft.allow_online_payment && !draft.is_custom_pricing && Number(draft.amount || 0) <= 0) {
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


  async function downloadInvoice(payment, index = 0) {
    const paymentId = paymentIdentity(payment, index);
    const downloadUrl = safeText(payment.download_url, '');

    if (!downloadUrl) {
      showAlert({
        title: 'Invoice unavailable',
        message: 'This payment does not have a downloadable invoice yet.',
        type: 'warning',
      });
      return;
    }

    setDownloadingPaymentId(paymentId);

    try {
      const token = getToken();
      const response = await fetch(buildBillingApiUrl(downloadUrl), {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        let message = 'Unable to download the invoice.';

        try {
          const payload = await response.json();
          message = payload.message || payload.error || message;
        } catch {
          // Keep the fallback message for a non-JSON error response.
        }

        throw new Error(message);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = getDownloadFilename(response, payment);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      showAlert({
        title: 'Invoice download failed',
        message: error.message || 'Please refresh the page and try again.',
        type: 'error',
      });
    } finally {
      setDownloadingPaymentId('');
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
            {row.renewal_price_source ? ` · ${statusLabel(row.renewal_price_source)}` : ''}
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
      key: 'valid_until',
      label: 'Subscription Validity',
      render: (row) => {
        const daysLeft = getDaysLeft(row);
        const validityDate =
          row.valid_until ||
          row.end_date ||
          row.subscription_end_date ||
          row.trial_end_date ||
          row.next_due_date;
        const expiring = Boolean(row.renewal_due_soon || (daysLeft !== null && daysLeft > 0 && daysLeft <= 7));
        const expired = daysLeft === 0 || normalizeStatus(row.status) === 'expired';

        return (
          <div>
            <strong style={{ color: expired ? '#991b1b' : expiring ? '#9a3412' : '#0f172a' }}>
              {getValidityLabel(row)}
            </strong>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>
              {normalizeStatus(row.status) === 'lifetime' || row.plan_type === 'lifetime'
                ? 'No renewal required'
                : formatDate(validityDate)}
            </div>
          </div>
        );
      },
    },
    {
      key: 'amount',
      label: 'Recurring Amount',
      render: (row) => (
        <div>
          <strong>{formatCurrency(row.amount || row.plan_amount || row.renewal_amount || 0, row.currency || 'INR')}</strong>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {statusLabel(row.billing_interval || row.plan_interval || 'monthly')}
          </div>
        </div>
      ),
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
      key: 'alert_message',
      label: 'Alert',
      render: (row) => {
        const daysLeft = getDaysLeft(row);
        let message = safeText(row.alert_message, '');
        let level = row.alert_level || 'info';

        if (!message && (normalizeStatus(row.status) === 'expired' || daysLeft === 0)) {
          message = 'Subscription expired. Renewal or access review is required.';
          level = 'critical';
        } else if (!message && (row.renewal_due_soon || (daysLeft !== null && daysLeft > 0 && daysLeft <= 7))) {
          message = `Renewal is due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`;
          level = 'warning';
        }

        return message ? (
          <AlertMessage level={level} message={message} compact />
        ) : (
          <span style={{ color: '#166534', fontWeight: 700, fontSize: 12 }}>Healthy</span>
        );
      },
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
      key: 'invoice_number',
      label: 'Invoice / Receipt',
      render: (row) => (
        <div>
          <strong style={{ color: '#0f172a' }}>
            {safeText(row.invoice_number, 'Invoice pending')}
          </strong>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {safeText(row.receipt_number, 'No receipt number')}
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
      label: 'Payment Reference',
      render: (row) => (
        <div>
          <strong style={{ fontSize: 12 }}>{safeText(row.razorpay_payment_id)}</strong>
          <div style={{ color: '#64748b', fontSize: 11 }}>{safeText(row.razorpay_order_id)}</div>
        </div>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      render: (row) => formatCurrency(row.amount || row.amount_paid || 0, row.currency || 'INR'),
    },
    {
      key: 'status',
      label: 'Invoice Status',
      render: (row) => <StatusBadge status={row.invoice_status || row.status || row.payment_status} />,
    },
    {
      key: 'paid_at',
      label: 'Payment Date',
      render: (row) => formatDate(row.paid_at || row.invoice_date || row.created_at),
    },
    {
      key: 'download_url',
      label: 'Invoice',
      render: (row) => {
        const id = paymentIdentity(row);
        const downloading = downloadingPaymentId === id;

        return (
          <button
            type="button"
            className="ghost"
            onClick={() => downloadInvoice(row)}
            disabled={!row.download_url || downloading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              minHeight: 38,
              whiteSpace: 'nowrap',
              opacity: row.download_url ? 1 : 0.55,
            }}
          >
            {downloading ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
            {downloading ? 'Downloading...' : 'Download PDF'}
          </button>
        );
      },
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
            Monitor subscription validity, renewal alerts, invoices, Razorpay orders, payment status, and dynamic plan pricing for every YourComate company.
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
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
          icon={TimerReset}
          label="Expiring Within 7 Days"
          value={summary.expiringSubscriptions}
          tone="#ea580c"
        />
        <SummaryCard
          icon={CalendarClock}
          label="Expired Subscriptions"
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
          tone="#d97706"
        />
        <SummaryCard
          icon={ReceiptText}
          label="Payment Failures"
          value={summary.failedPayments}
          tone="#be123c"
        />
      </div>

      <BillingAlertCenter
        alerts={visibleBillingAlerts}
        hiddenCount={hiddenBillingAlertCount}
      />

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
          ['payments', 'Payments & Invoices'],
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
          description="Shows each company's plan, remaining validity, renewal source, employee limit, and subscription alerts."
          columns={subscriptionColumns}
          rows={subscriptions}
          loading={loading}
          emptyText="No subscription records found."
        />
      ) : null}

      {activeTab === 'payments' ? (
        <DataTable
          title="Payment Records"
          description="Shows invoice status, payment references, payment dates, and downloadable PDF invoices."
          columns={paymentColumns}
          rows={payments}
          loading={loading}
          emptyText="No payment records found."
        />
      ) : null}

      {activeTab === 'orders' ? (
        <DataTable
          title="Razorpay Orders"
          description="Shows generated Razorpay orders, including pending or incomplete checkout attempts that may require review."
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