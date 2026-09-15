import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  X,
} from 'lucide-react';

import { api, getToken } from '../api/client';

const BILLING_NOTICE_HIDE_MS = 3600;

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


function BillingInlineMessage({ feedback, onClose, className = '' }) {
  if (!feedback?.message) {
    return null;
  }

  const type = ['success', 'warning', 'error', 'info'].includes(feedback.type)
    ? feedback.type
    : 'info';

  const Icon =
    type === 'success'
      ? CheckCircle2
      : type === 'error' || type === 'warning'
        ? AlertTriangle
        : ShieldCheck;

  return (
    <div
      className={`billing-inline-feedback ${type} ${className}`.trim()}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      <span className="billing-inline-feedback-icon" aria-hidden="true">
        {feedback.loading ? <Loader2 size={15} className="spin" /> : <Icon size={15} />}
      </span>

      <span className="billing-inline-feedback-copy">
        {feedback.title ? <strong>{feedback.title}</strong> : null}
        <span>{feedback.message}</span>
      </span>

      <button
        type="button"
        className="billing-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        <X size={15} />
      </button>
    </div>
  );
}

function BillingAlertCenter({ alerts = [], hiddenCount = 0 }) {
  if (!alerts.length) {
    return (
      <div
        className="billing-alert-empty"
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
      className="billing-alert-center"
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
        className="billing-alert-head"
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

      <div className="billing-alert-list" style={{ display: 'grid', gap: 10, padding: 14 }}>
        {alerts.map((alert, index) => {
          const tone = alertStyle(alert.level);
          return (
            <div
              key={`${alert.type || 'alert'}-${alert.id || index}`}
              className="billing-alert-item"
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
      className="stat-card billing-summary-card"
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
      className="billing-data-table"
      style={{
        borderRadius: 24,
        background: '#ffffff',
        border: '1px solid rgba(226,232,240,0.9)',
        boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
        overflow: 'hidden',
      }}
    >
      <div
        className="billing-table-head"
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

      <div className="billing-table-scroll" style={{ overflowX: 'auto' }}>
        <table
          className="billing-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            minWidth: 850,
          }}
        >
          <thead>
            <tr className="billing-table-header-row" style={{ background: '#f8fafc' }}>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="billing-table-th"
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
              <tr className="billing-table-state-row">
                <td
                  className="billing-table-state-cell"
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
                <tr
                  className="billing-table-row"
                  key={row._id || row.id || row.razorpay_order_id || row.razorpay_payment_id || row.plan_code || index}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className="billing-table-td"
                      data-label={column.label}
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
              <tr className="billing-table-state-row">
                <td
                  className="billing-table-state-cell"
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
  feedbackMap,
  onDismissFeedback,
}) {
  return (
    <div
      className="billing-pricing-panel"
      style={{
        borderRadius: 24,
        background: '#ffffff',
        border: '1px solid rgba(226,232,240,0.9)',
        boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
        overflow: 'hidden',
      }}
    >
      <div
        className="billing-table-head"
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
          className="billing-plan-grid"
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
                className={`billing-plan-editor ${plan.is_recommended ? 'recommended' : ''}`}
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

                <div className="billing-plan-fields" style={{ display: 'grid', gap: 12 }}>
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

                  <div className="billing-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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

                  <div className="billing-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
                    className="billing-check-grid"
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
                      className="billing-premium-note"
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

                  <BillingInlineMessage
                    feedback={feedbackMap?.[`plan:${code}`]}
                    onClose={() => onDismissFeedback?.(`plan:${code}`)}
                    className="billing-plan-feedback"
                  />

                  <p className="billing-current-plan" style={{ margin: 0, color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>
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
  const [inlineFeedback, setInlineFeedback] = useState({});
  const feedbackTimersRef = useRef({});

  function clearInlineFeedback(scope) {
    if (!scope) {
      return;
    }

    const timer = feedbackTimersRef.current[scope];
    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scope];
    }

    setInlineFeedback((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scope)) {
        return current;
      }

      const next = { ...current };
      delete next[scope];
      return next;
    });
  }

  function showInlineFeedback(scope, type, message, title = '', options = {}) {
    if (!scope) {
      return;
    }

    const timer = feedbackTimersRef.current[scope];
    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scope];
    }

    setInlineFeedback((current) => ({
      ...current,
      [scope]: {
        type,
        message,
        title,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      feedbackTimersRef.current[scope] = window.setTimeout(() => {
        setInlineFeedback((current) => {
          const next = { ...current };
          delete next[scope];
          return next;
        });
        delete feedbackTimersRef.current[scope];
      }, BILLING_NOTICE_HIDE_MS);
    }
  }

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


  async function loadPricingPlans(feedbackScope = '', feedbackMode = 'load', suppressErrorFeedback = false) {
    if (feedbackScope) {
      showInlineFeedback(
        feedbackScope,
        'info',
        feedbackMode === 'refresh'
          ? 'Refreshing pricing plan configuration...'
          : 'Loading pricing plan configuration...',
        feedbackMode === 'refresh' ? 'Refreshing Pricing' : 'Loading Pricing',
        { loading: true },
      );
    }

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

      if (feedbackScope) {
        showInlineFeedback(
          feedbackScope,
          'success',
          feedbackMode === 'refresh'
            ? 'Pricing plan configuration refreshed successfully.'
            : 'Pricing plan configuration loaded successfully.',
          feedbackMode === 'refresh' ? 'Pricing Refreshed' : 'Pricing Loaded',
        );
      }

      return true;
    } catch (error) {
      if (!suppressErrorFeedback) {
        showInlineFeedback(
          feedbackScope || 'page',
          'error',
          error.message || 'Please try again.',
          'Unable to Load Pricing Plans',
        );
      }
      return false;
    } finally {
      setPricingLoading(false);
    }
  }

  async function loadData(feedbackScope = '', feedbackMode = 'load', suppressErrorFeedback = false) {
    if (feedbackScope) {
      showInlineFeedback(
        feedbackScope,
        'info',
        feedbackMode === 'filter'
          ? 'Applying the selected billing filters...'
          : 'Refreshing subscriptions, payments, and Razorpay orders...',
        feedbackMode === 'filter' ? 'Applying Filter' : 'Refreshing Billing Data',
        { loading: true },
      );
    }

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

      if (feedbackScope) {
        showInlineFeedback(
          feedbackScope,
          'success',
          feedbackMode === 'filter'
            ? 'The selected filters are now applied to the billing records.'
            : 'Subscriptions, payments, and order data refreshed successfully.',
          feedbackMode === 'filter' ? 'Filter Applied' : 'Billing Data Refreshed',
        );
      }

      return true;
    } catch (error) {
      if (!suppressErrorFeedback) {
        showInlineFeedback(
          feedbackScope || 'page',
          'error',
          error.message || 'Please try again.',
          feedbackMode === 'filter' ? 'Filter Failed' : 'Unable to Load Billing Records',
        );
      }
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function refreshAllData() {
    showInlineFeedback(
      'refresh',
      'info',
      'Refreshing billing records and pricing configuration...',
      'Refreshing',
      { loading: true },
    );

    const [dataLoaded, pricingLoaded] = await Promise.all([
      loadData('', 'load', true),
      loadPricingPlans('', 'load', true),
    ]);

    if (dataLoaded && pricingLoaded) {
      showInlineFeedback(
        'refresh',
        'success',
        'Billing records and pricing configuration refreshed successfully.',
        'Refresh Complete',
      );
    } else {
      showInlineFeedback(
        'refresh',
        'error',
        'One or more billing sections could not be refreshed. Please try again.',
        'Refresh Incomplete',
      );
    }
  }

  async function savePricingPlan(planCode) {
    const draft = planDrafts[planCode];
    const feedbackScope = `plan:${planCode}`;

    if (!draft) {
      return;
    }

    if (!draft.is_unlimited_employees && Number(draft.employee_limit || 0) <= 0) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Non-premium/non-unlimited plans must have an employee limit.',
        'Employee Limit Required',
      );
      return;
    }

    const isPremium = normalizeStatus(planCode) === 'premium';

    if (!isPremium && draft.allow_online_payment && !draft.is_custom_pricing && Number(draft.amount || 0) <= 0) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'Online payment plans must have an amount greater than 0.',
        'Amount Required',
      );
      return;
    }

    setSavingPlan(planCode);
    showInlineFeedback(
      feedbackScope,
      'info',
      'Saving the current pricing and employee-limit configuration...',
      'Saving Pricing Plan',
      { loading: true },
    );

    try {
      const response = await api(`/billing/admin/pricing-plans/${encodeURIComponent(planCode)}`, {
        method: 'PATCH',
        body: JSON.stringify(buildPlanPayload(draft)),
      });

      showInlineFeedback(
        feedbackScope,
        'success',
        response.message || 'Plan pricing and employee limit saved successfully.',
        'Pricing Plan Updated',
      );

      await loadPricingPlans();
    } catch (error) {
      showInlineFeedback(
        feedbackScope,
        'error',
        error.message || 'Please try again.',
        'Unable to Save Pricing Plan',
      );
    } finally {
      setSavingPlan('');
    }
  }

  async function refreshExpiredDemos() {
    setRefreshingExpired(true);
    showInlineFeedback(
      'expired-trials',
      'info',
      'Checking demo companies and refreshing completed trial periods...',
      'Refreshing Expired Trials',
      { loading: true },
    );

    try {
      const response = await api('/billing/admin/refresh-expired-demos', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      showInlineFeedback(
        'expired-trials',
        'success',
        response.message ||
          'Demo companies with completed trial periods were refreshed successfully.',
        'Expired Trials Refreshed',
      );

      await loadData();
    } catch (error) {
      showInlineFeedback(
        'expired-trials',
        'error',
        error.message || 'Please try again.',
        'Unable to Refresh Expired Trials',
      );
    } finally {
      setRefreshingExpired(false);
    }
  }


  async function downloadInvoice(payment, index = 0) {
    const paymentId = paymentIdentity(payment, index);
    const feedbackScope = `invoice:${paymentId}`;
    const downloadUrl = safeText(payment.download_url, '');

    if (!downloadUrl) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'This payment does not have a downloadable invoice yet.',
        'Invoice Unavailable',
      );
      return;
    }

    setDownloadingPaymentId(paymentId);
    showInlineFeedback(
      feedbackScope,
      'info',
      'Preparing the invoice PDF download...',
      'Downloading Invoice',
      { loading: true },
    );

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

      showInlineFeedback(
        feedbackScope,
        'success',
        'The invoice PDF download has started successfully.',
        'Invoice Downloaded',
      );
    } catch (error) {
      showInlineFeedback(
        feedbackScope,
        'error',
        error.message || 'Please refresh the page and try again.',
        'Invoice Download Failed',
      );
    } finally {
      setDownloadingPaymentId('');
    }
  }

  useEffect(() => {
    loadData();
    loadPricingPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function dismissInlineFeedback(event) {
      if (event.target?.closest?.('.billing-inline-feedback')) {
        return;
      }

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      feedbackTimersRef.current = {};
      setInlineFeedback({});
    }

    document.addEventListener('pointerdown', dismissInlineFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissInlineFeedback);
      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      feedbackTimersRef.current = {};
    };
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
          <div className="billing-invoice-action">
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

            <BillingInlineMessage
              feedback={inlineFeedback[`invoice:${id}`]}
              onClose={() => clearInlineFeedback(`invoice:${id}`)}
              className="billing-invoice-feedback"
            />
          </div>
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
    <section className="panel subscriptions-admin-page">

      <style>{`
        .subscriptions-admin-page{
          --bill-ink:#101a3a;
          --bill-ink-soft:#33405f;
          --bill-muted:#6d7892;
          --bill-primary:#4d77dd;
          --bill-primary-deep:#40348d;
          --bill-cyan:#2eb2b9;
          --bill-green:#047857;
          --bill-red:#a2344d;
          --bill-amber:#9a6817;
          --bill-blue-soft:#edf6ff;
          --bill-green-soft:#eaf8f4;
          --bill-violet-soft:#f1efff;
          --bill-amber-soft:#fff4d5;
          --bill-rose-soft:#fff0f2;
          --bill-flat-blue:#b9d7ff;
          --bill-flat-green:#aee6d9;
          --bill-flat-violet:#c9c0ff;
          --bill-flat-amber:#ffe0a5;
          --bill-flat-rose:#f2c2cc;
          --bill-border:rgba(171,181,211,.62);
          --bill-border-strong:rgba(171,181,211,.76);
          --bill-ease:cubic-bezier(.22,1,.36,1);

          width:min(1280px,calc(100% - 48px))!important;
          max-width:1280px;
          min-width:0;
          margin:0 auto!important;
          padding:0 14px 16px 0!important;
          overflow:visible!important;
          border:0!important;
          border-radius:0!important;
          background:transparent!important;
          box-shadow:none!important;
          color:var(--bill-ink);
          font-family:var(--yc-ui,var(--body),inherit);
        }

        .subscriptions-admin-page *,
        .subscriptions-admin-page *::before,
        .subscriptions-admin-page *::after{box-sizing:border-box}

        .subscriptions-admin-page > *{
          min-width:0;
          max-width:100%;
        }

        .subscriptions-admin-page h1,
        .subscriptions-admin-page h2,
        .subscriptions-admin-page h3,
        .subscriptions-admin-page h4{
          color:var(--bill-ink)!important;
          font-family:var(--yc-display,var(--heading),inherit);
        }

        .subscriptions-admin-page button,
        .subscriptions-admin-page input,
        .subscriptions-admin-page select,
        .subscriptions-admin-page textarea{font:inherit}

        .subscriptions-admin-page button{
          touch-action:manipulation;
          transition:transform .18s var(--bill-ease),box-shadow .18s var(--bill-ease),border-color .18s ease,background .18s ease,color .18s ease,opacity .18s ease;
        }

        .subscriptions-admin-page button:hover:not(:disabled){transform:translateY(-2px)}
        .subscriptions-admin-page button:active:not(:disabled){transform:translateY(0)}
        .subscriptions-admin-page button:disabled{opacity:.52;cursor:not-allowed;transform:none!important}

        .subscriptions-admin-page button:focus-visible,
        .subscriptions-admin-page input:focus-visible,
        .subscriptions-admin-page select:focus-visible,
        .subscriptions-admin-page textarea:focus-visible{
          outline:3px solid rgba(46,178,185,.18);
          outline-offset:2px;
        }

        .billing-hero{
          display:grid!important;
          grid-template-columns:minmax(0,1fr) minmax(360px,540px);
          gap:clamp(22px,3vw,38px);
          align-items:center;
          min-height:250px;
          margin:0 0 24px!important;
          padding:clamp(26px,3.2vw,42px)!important;
          border:1px solid rgba(154,164,205,.58)!important;
          border-radius:clamp(28px,2.7vw,40px)!important;
          background:linear-gradient(90deg,#d3f4fb 0%,#f7fcfb 34%,#fffdf8 52%,#fbf8fa 68%,#f0edfb 100%)!important;
          box-shadow:10px 12px 0 #b9d7ff,0 26px 44px rgba(70,92,140,.12)!important;
          overflow:hidden;
        }

        .billing-hero-copy{min-width:0}
        .billing-kicker{
          display:inline-flex;
          align-items:center;
          width:max-content;
          max-width:100%;
          margin:0 0 14px!important;
          padding:9px 13px;
          border-radius:999px;
          color:#fff!important;
          background:linear-gradient(135deg,#4d77dd 0%,#2eb2b9 100%);
          box-shadow:4px 5px 0 #575092;
          font-size:9px!important;
          font-weight:950!important;
          line-height:1;
          letter-spacing:.12em!important;
          text-transform:uppercase;
        }

        .billing-hero h2{
          margin:0!important;
          font-size:clamp(32px,4.2vw,56px)!important;
          font-weight:730!important;
          line-height:.98!important;
          letter-spacing:-.045em!important;
          overflow-wrap:anywhere;
        }

        .billing-hero-copy>p:last-child{
          max-width:760px;
          margin:14px 0 0!important;
          color:var(--bill-muted)!important;
          font-size:14px;
          line-height:1.75;
        }

        .billing-hero-actions{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:14px;
          align-items:start;
          min-width:0;
        }

        .billing-action-stack{
          display:grid;
          grid-template-rows:56px 96px;
          gap:9px;
          align-content:start;
          min-width:0;
          min-height:161px;
        }

        .billing-action-stack>button{
          width:100%;
          height:56px;
          min-height:56px;
        }

        .billing-action-stack>.billing-inline-feedback{
          align-self:start;
          max-height:96px;
          overflow:auto;
        }

        .subscriptions-admin-page .primary,
        .subscriptions-admin-page .ghost{
          min-width:0;
          min-height:44px;
          padding:0 15px;
          border-radius:14px;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          line-height:1.2;
          text-align:center;
          font-weight:850;
        }

        .subscriptions-admin-page .primary{
          border:1px solid rgba(77,119,221,.18)!important;
          color:#fff!important;
          background:linear-gradient(135deg,#4d77dd 0%,#2eb2b9 100%)!important;
          box-shadow:5px 6px 0 #575092,0 12px 22px rgba(67,116,170,.13)!important;
        }

        .subscriptions-admin-page .ghost{
          border:1px solid rgba(102,88,220,.18)!important;
          color:#40348d!important;
          background:#f5f5ff!important;
          box-shadow:3px 4px 0 #c9c0ff!important;
        }

        .billing-summary-grid{
          display:grid!important;
          grid-template-columns:repeat(6,minmax(0,1fr))!important;
          gap:14px!important;
          margin:0 0 24px!important;
        }

        .subscriptions-admin-page .billing-summary-card{
          min-width:0!important;
          min-height:120px!important;
          padding:18px!important;
          border:1px solid var(--bill-border)!important;
          border-radius:22px!important;
          background:var(--bill-blue-soft)!important;
          box-shadow:7px 9px 0 var(--bill-flat-blue),0 18px 30px rgba(34,38,110,.09)!important;
          transition:transform 190ms ease,border-color 190ms ease!important;
        }
        .subscriptions-admin-page .billing-summary-card:nth-child(2){background:var(--bill-amber-soft)!important;box-shadow:7px 9px 0 var(--bill-flat-amber),0 18px 30px rgba(34,38,110,.09)!important}
        .subscriptions-admin-page .billing-summary-card:nth-child(3){background:var(--bill-rose-soft)!important;box-shadow:7px 9px 0 var(--bill-flat-rose),0 18px 30px rgba(34,38,110,.09)!important}
        .subscriptions-admin-page .billing-summary-card:nth-child(4){background:var(--bill-violet-soft)!important;box-shadow:7px 9px 0 var(--bill-flat-violet),0 18px 30px rgba(34,38,110,.09)!important}
        .subscriptions-admin-page .billing-summary-card:nth-child(5){background:var(--bill-amber-soft)!important;box-shadow:7px 9px 0 var(--bill-flat-amber),0 18px 30px rgba(34,38,110,.09)!important}
        .subscriptions-admin-page .billing-summary-card:nth-child(6){background:var(--bill-rose-soft)!important;box-shadow:7px 9px 0 var(--bill-flat-rose),0 18px 30px rgba(34,38,110,.09)!important}
        .subscriptions-admin-page .billing-summary-card:hover{transform:translateY(-4px);border-color:rgba(102,88,220,.28)!important}
        .subscriptions-admin-page .billing-summary-card>div:first-child{border-radius:14px!important;color:#fff!important;background:linear-gradient(135deg,#4d77dd,#2eb2b9)!important;box-shadow:3px 4px 0 #c9c0ff!important}
        .subscriptions-admin-page .billing-summary-card span{color:#5d6785!important;font-size:9px!important;font-weight:950!important;letter-spacing:.07em!important;text-transform:uppercase}
        .subscriptions-admin-page .billing-summary-card strong{color:var(--bill-ink)!important;font-size:24px!important;line-height:1.1;letter-spacing:-.035em}

        .billing-inline-feedback{
          display:grid!important;
          grid-template-columns:auto minmax(0,1fr) auto!important;
          gap:9px!important;
          align-items:start!important;
          width:100%!important;
          min-width:0!important;
          padding:10px 11px!important;
          border:1px solid rgba(102,88,220,.18)!important;
          border-radius:12px!important;
          color:#40348d!important;
          background:#f1efff!important;
          box-shadow:3px 4px 0 #c9c0ff!important;
          font-size:10px!important;
          line-height:1.45!important;
          animation:billingFeedbackIn .18s ease both;
        }
        .billing-inline-feedback.success{border-color:rgba(4,120,87,.18)!important;color:#047857!important;background:#eaf8f4!important;box-shadow:3px 4px 0 #aee6d9!important}
        .billing-inline-feedback.warning{border-color:rgba(154,104,23,.18)!important;color:#9a6817!important;background:#fff4d5!important;box-shadow:3px 4px 0 #ffe0a5!important}
        .billing-inline-feedback.error{border-color:rgba(162,52,77,.18)!important;color:#a2344d!important;background:#fff0f2!important;box-shadow:3px 4px 0 #f2c2cc!important}
        .billing-inline-feedback-icon{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:22px!important;height:22px!important}
        .billing-inline-feedback-copy{min-width:0!important}
        .billing-inline-feedback-copy strong,.billing-inline-feedback-copy span{display:block!important;overflow-wrap:anywhere!important}
        .billing-inline-feedback-copy strong{margin-bottom:2px!important;font-weight:950!important}
        .billing-inline-feedback-copy span{font-weight:750!important}
        .billing-inline-feedback-close{width:24px!important;min-width:24px!important;height:24px!important;display:inline-grid!important;place-items:center!important;padding:0!important;border:0!important;border-radius:8px!important;color:currentColor!important;background:rgba(255,255,255,.58)!important;box-shadow:none!important;cursor:pointer}
        .billing-page-feedback{width:min(720px,100%)!important;margin:0 0 22px!important}

        .billing-alert-empty,
        .billing-alert-center,
        .billing-filter-bar,
        .billing-tabs,
        .billing-data-table,
        .billing-pricing-panel,
        .billing-footer-note{
          border:1px solid var(--bill-border)!important;
          border-radius:22px!important;
          background:#fff!important;
          box-shadow:6px 8px 0 rgba(52,43,120,.08),0 18px 30px rgba(34,38,110,.07)!important;
        }

        .billing-alert-empty{margin:0 0 24px!important;background:#eaf8f4!important;box-shadow:6px 8px 0 #aee6d9!important}
        .billing-alert-center{margin:0 0 24px!important;overflow:hidden!important;box-shadow:7px 9px 0 #ffe0a5,0 18px 30px rgba(34,38,110,.07)!important}
        .billing-alert-head{padding:16px 18px!important;background:#fff9e9!important;border-bottom:1px solid rgba(171,181,211,.38)!important}
        .billing-alert-list{padding:14px!important}
        .billing-alert-item{border-radius:15px!important}

        .billing-filter-bar{
          display:grid!important;
          grid-template-columns:minmax(0,1fr) minmax(170px,220px) minmax(150px,190px);
          gap:12px!important;
          align-items:start!important;
          margin:0 0 22px!important;
          padding:14px!important;
          background:#f8f9ff!important;
          box-shadow:6px 8px 0 #c9c0ff!important;
        }
        .billing-search-box{display:flex!important;align-items:center!important;gap:10px!important;min-width:0;padding:0 12px!important;border:1px solid rgba(171,181,211,.55)!important;border-radius:14px!important;background:#fff!important}
        .billing-search-box input{border:0!important;box-shadow:none!important;background:transparent!important}
        .billing-filter-action{display:grid;gap:9px;min-width:0}
        .billing-filter-action>.primary{width:100%}

        .subscriptions-admin-page input,
        .subscriptions-admin-page select,
        .subscriptions-admin-page textarea{
          width:100%;
          min-width:0;
          border:1px solid rgba(159,169,205,.62)!important;
          border-radius:14px!important;
          outline:none!important;
          color:var(--bill-ink)!important;
          background:#fff!important;
          transition:border-color .18s ease,box-shadow .18s ease,background .18s ease;
        }
        .subscriptions-admin-page input,.subscriptions-admin-page select{min-height:44px;padding:0 12px}
        .subscriptions-admin-page textarea{padding:11px 12px;resize:vertical}
        .subscriptions-admin-page input:hover,.subscriptions-admin-page select:hover,.subscriptions-admin-page textarea:hover{border-color:rgba(77,119,221,.48)!important}
        .subscriptions-admin-page input:focus,.subscriptions-admin-page select:focus,.subscriptions-admin-page textarea:focus{border-color:rgba(77,119,221,.78)!important;box-shadow:0 0 0 4px rgba(77,119,221,.09)!important}
        .subscriptions-admin-page input[type="checkbox"]{width:17px!important;height:17px!important;min-height:auto!important;accent-color:var(--bill-primary)}

        .billing-tabs{
          display:grid!important;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:10px!important;
          margin:0 0 18px!important;
          padding:10px!important;
          background:#f8f9ff!important;
          box-shadow:5px 6px 0 rgba(52,43,120,.08)!important;
        }
        .billing-tabs button{width:100%;min-width:0}

        .subscriptions-admin-page .billing-data-table,
        .subscriptions-admin-page .billing-pricing-panel{
          overflow:hidden!important;
          border-radius:24px!important;
          box-shadow:8px 10px 0 #d1dcfa,0 22px 38px rgba(34,38,110,.09)!important;
        }
        .billing-table-head{padding:20px 22px!important;border-bottom:1px solid rgba(65,55,161,.09)!important;background:linear-gradient(145deg,rgba(241,239,255,.62),rgba(237,248,255,.52))!important}
        .billing-table-head h3{font-size:22px!important;font-weight:760!important;letter-spacing:-.03em!important}
        .billing-table-head p{color:var(--bill-muted)!important;line-height:1.6}
        .billing-table-scroll{width:100%;min-width:0;overflow-x:auto!important}
        .billing-table{width:100%!important;min-width:900px!important;border-collapse:separate!important;border-spacing:0!important}
        .billing-table th{position:sticky;top:0;z-index:2;padding:14px 16px!important;border-bottom:1px solid rgba(65,55,161,.11)!important;color:#4f5e7f!important;background:#f1efff!important;font-size:10px!important;font-weight:900!important;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
        .billing-table td{padding:16px!important;border-bottom:1px solid rgba(65,55,161,.09)!important;color:#334164!important;background:#fff!important;vertical-align:top;overflow-wrap:anywhere}
        .billing-table tbody tr:hover td{background:#fbfcff!important}
        .billing-table-state-cell{text-align:center!important;color:var(--bill-muted)!important}

        .billing-invoice-action{display:grid;gap:9px;min-width:0}
        .billing-invoice-feedback{min-width:220px!important;max-width:300px!important}

        .billing-plan-grid{
          display:grid!important;
          grid-template-columns:repeat(3,minmax(0,1fr))!important;
          gap:16px!important;
          align-items:stretch!important;
          padding:18px 26px 26px 18px!important;
        }
        .subscriptions-admin-page .billing-plan-editor{
          display:flex!important;
          flex-direction:column!important;
          min-width:0!important;
          height:100%!important;
          padding:18px!important;
          border:1px solid var(--bill-border)!important;
          border-radius:22px!important;
          background:#fff!important;
          box-shadow:6px 8px 0 #b9d7ff,0 18px 28px rgba(34,38,110,.08)!important;
          transition:transform 190ms ease,border-color 190ms ease!important;
        }
        .subscriptions-admin-page .billing-plan-editor:nth-child(3n+2){box-shadow:6px 8px 0 #aee6d9,0 18px 28px rgba(34,38,110,.08)!important}
        .subscriptions-admin-page .billing-plan-editor:nth-child(3n+3){box-shadow:6px 8px 0 #c9c0ff,0 18px 28px rgba(34,38,110,.08)!important}
        .subscriptions-admin-page .billing-plan-editor:hover{transform:translateY(-3px);border-color:rgba(102,88,220,.28)!important}
        .subscriptions-admin-page .billing-plan-editor.recommended{background:#f5f5ff!important;box-shadow:7px 9px 0 #c9c0ff,0 20px 34px rgba(34,38,110,.1)!important}
        .billing-plan-fields{
          display:flex!important;
          flex:1 1 auto!important;
          flex-direction:column!important;
          min-height:0!important;
          gap:12px!important;
        }
        .billing-plan-fields>.primary{
          width:100%!important;
          flex:0 0 auto!important;
          margin-top:auto!important;
        }
        .billing-two-col{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        .billing-check-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;border:1px solid rgba(171,181,211,.44)!important;border-radius:16px!important;background:#f8f9ff!important}
        .billing-premium-note{border-radius:14px!important;background:#f1efff!important;border:1px solid rgba(102,88,220,.18)!important;color:#40348d!important;box-shadow:3px 4px 0 #c9c0ff!important}
        .billing-plan-feedback{margin-top:-1px}
        .billing-current-plan{
          min-height:20px;
          color:var(--bill-muted)!important;
          overflow-wrap:anywhere;
        }

        .billing-footer-note{margin:22px 0 0!important;padding:16px!important;background:#edf6ff!important;color:#36548d!important;box-shadow:6px 8px 0 #b9d7ff!important}

        .subscriptions-admin-page .spin{animation:billingSpin .8s linear infinite}
        @keyframes billingSpin{to{transform:rotate(360deg)}}
        @keyframes billingFeedbackIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}

        @media (max-width:1180px){
          .billing-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
          .billing-plan-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        }

        @media (max-width:980px){
          .subscriptions-admin-page{width:min(100% - 28px,1280px)!important}
          .billing-hero{grid-template-columns:1fr}
          .billing-hero-actions{max-width:620px}
          .billing-filter-bar{grid-template-columns:1fr 1fr}
          .billing-search-box{grid-column:1/-1}
          .billing-filter-action{grid-column:1/-1}
          .billing-filter-action>.primary{width:min(260px,100%)}
          .billing-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}
        }

        @media (max-width:760px){
          .subscriptions-admin-page{width:min(100% - 20px,1280px)!important;padding-right:10px!important}
          .billing-hero{padding:22px!important;border-radius:22px!important}
          .billing-hero h2{font-size:clamp(30px,9vw,44px)!important}
          .billing-hero-actions{grid-template-columns:1fr;width:100%;max-width:none}
          .billing-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
          .subscriptions-admin-page .billing-summary-card{min-height:105px!important;padding:15px!important}
          .billing-filter-bar{grid-template-columns:1fr}
          .billing-search-box,.billing-filter-action{grid-column:auto}
          .billing-filter-action>.primary{width:100%}
          .billing-tabs{grid-template-columns:1fr 1fr}
          .billing-plan-grid{grid-template-columns:1fr!important;padding:14px 22px 22px 14px!important}
          .subscriptions-admin-page .billing-data-table,.subscriptions-admin-page .billing-pricing-panel{border-radius:20px!important;box-shadow:5px 6px 0 #d1dcfa,0 14px 24px rgba(34,38,110,.08)!important}

          .billing-table-scroll{overflow:visible!important}
          .billing-table,.billing-table tbody,.billing-table tr,.billing-table td{display:block!important;width:100%!important;min-width:0!important}
          .billing-table thead{display:none!important}
          .billing-table tbody{display:grid!important;gap:13px!important;padding:14px!important}
          .billing-table .billing-table-row{padding:5px 14px;border:1px solid var(--bill-border);border-radius:20px;background:#fff;box-shadow:5px 6px 0 #b9d7ff}
          .billing-table .billing-table-row:nth-child(3n+2){box-shadow:5px 6px 0 #aee6d9}
          .billing-table .billing-table-row:nth-child(3n+3){box-shadow:5px 6px 0 #c9c0ff}
          .billing-table td{display:grid!important;grid-template-columns:minmax(110px,.7fr) minmax(0,1.3fr)!important;gap:12px!important;padding:10px 0!important;border-bottom:1px solid rgba(171,181,211,.20)!important;background:transparent!important}
          .billing-table td::before{content:attr(data-label);color:#7a859d;font-size:9px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}
          .billing-table td:last-child{border-bottom:0!important}
          .billing-table-state-row{display:block!important;padding:0!important;border:0!important;box-shadow:none!important}
          .billing-table-state-cell{display:block!important;padding:28px 16px!important}
          .billing-table-state-cell::before{display:none!important}
        }

        @media (max-width:520px){
          .subscriptions-admin-page{width:calc(100% - 16px)!important;padding-right:8px!important}
          .billing-hero{padding:19px!important}
          .billing-summary-grid{grid-template-columns:1fr!important}
          .billing-tabs{grid-template-columns:1fr}
          .billing-two-col,.billing-check-grid{grid-template-columns:1fr!important}
          .billing-table td{grid-template-columns:1fr!important;gap:4px!important}
          .billing-inline-feedback{padding:10px!important}
          .billing-plan-grid{padding:11px 19px 19px 11px!important}
        }

        @media (max-width:390px){
          .subscriptions-admin-page{width:calc(100% - 12px)!important;padding-right:7px!important}
          .billing-hero h2{font-size:29px!important}
          .billing-hero,.billing-filter-bar,.billing-alert-center,.billing-alert-empty,.billing-tabs{border-radius:18px!important}
          .subscriptions-admin-page .primary,.subscriptions-admin-page .ghost{width:100%}
        }

        @media (hover:none){
          .subscriptions-admin-page button:hover:not(:disabled),
          .subscriptions-admin-page .billing-summary-card:hover,
          .subscriptions-admin-page .billing-plan-editor:hover{transform:none!important}
        }

        @media (prefers-reduced-motion:reduce){
          .subscriptions-admin-page *,
          .subscriptions-admin-page *::before,
          .subscriptions-admin-page *::after{
            animation:none!important;
            transition:none!important;
            scroll-behavior:auto!important;
          }
        }
      `}</style>

      <div className="billing-hero">
        <div className="billing-hero-copy">
          <p className="billing-kicker">SaaS Control</p>
          <h2>Subscriptions, Payments & Pricing</h2>
          <p>
            Monitor subscription validity, renewal alerts, invoices, Razorpay orders, payment status, and dynamic plan pricing for every YourComate company.
          </p>
        </div>

        <div className="billing-hero-actions">
          <div className="billing-action-stack">
            <button
              type="button"
              className="ghost"
              onClick={refreshAllData}
              disabled={loading || pricingLoading}
            >
              <RefreshCw size={16} className={loading || pricingLoading ? 'spin' : ''} />
              {loading || pricingLoading ? 'Refreshing...' : 'Refresh'}
            </button>

            <BillingInlineMessage
              feedback={inlineFeedback.refresh}
              onClose={() => clearInlineFeedback('refresh')}
            />
          </div>

          <div className="billing-action-stack">
            <button
              type="button"
              className="primary"
              onClick={refreshExpiredDemos}
              disabled={refreshingExpired}
            >
              <AlertTriangle size={16} />
              {refreshingExpired ? 'Refreshing...' : 'Refresh Expired Trials'}
            </button>

            <BillingInlineMessage
              feedback={inlineFeedback['expired-trials']}
              onClose={() => clearInlineFeedback('expired-trials')}
            />
          </div>
        </div>
      </div>

      <BillingInlineMessage
        feedback={inlineFeedback.page}
        onClose={() => clearInlineFeedback('page')}
        className="billing-page-feedback"
      />

      <div className="billing-summary-grid">
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

      <div className="billing-filter-bar">
        <div className="billing-search-box">
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
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="billing-filter-action">
          <button
            type="button"
            className="primary"
            onClick={() => loadData('filters', 'filter')}
            disabled={loading}
          >
            <Search size={16} />
            {loading ? 'Applying...' : 'Apply Filter'}
          </button>

          <BillingInlineMessage
            feedback={inlineFeedback.filters}
            onClose={() => clearInlineFeedback('filters')}
          />
        </div>
      </div>

      <div className="billing-tabs">
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
          feedbackMap={inlineFeedback}
          onDismissFeedback={clearInlineFeedback}
        />
      ) : null}

      <div className="billing-footer-note">
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
