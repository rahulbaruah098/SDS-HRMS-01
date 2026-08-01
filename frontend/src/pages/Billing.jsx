import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  IndianRupee,
  Loader2,
  Lock,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Unlock,
  Users,
} from 'lucide-react';

import { api, getToken, refreshCurrentSession } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

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

function formatDate(value) {
  if (!value) {
    return 'Not available';
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

function getSummaryTenant(summary = {}, user = {}) {
  return summary.tenant || summary.company || user.tenant || user.company || {};
}

function getSummarySubscription(summary = {}, user = {}) {
  return summary.subscription || user.subscription || user.saas_subscription || {};
}

function getCompanyName(summary = {}, user = {}) {
  const tenant = getSummaryTenant(summary, user);

  return (
    summary.company_name ||
    tenant.company_name ||
    tenant.name ||
    user.company_name ||
    'Your company'
  );
}

function getCompanyEmail(summary = {}, user = {}) {
  const tenant = getSummaryTenant(summary, user);

  return (
    summary.company_email ||
    tenant.company_email ||
    tenant.email ||
    user.company_email ||
    user.email ||
    ''
  );
}

function getPlanType(summary = {}, user = {}) {
  const tenant = getSummaryTenant(summary, user);
  const subscription = getSummarySubscription(summary, user);

  return normalizeStatus(
    summary.plan_type ||
      subscription.plan_type ||
      tenant.plan_type ||
      user.plan_type ||
      'demo',
  );
}

function getStatus(summary = {}, user = {}) {
  const tenant = getSummaryTenant(summary, user);
  const subscription = getSummarySubscription(summary, user);

  return normalizeStatus(
    summary.status ||
      summary.subscription_status ||
      subscription.status ||
      tenant.status ||
      user.subscription_status ||
      user.status ||
      'active',
  );
}

function getTrialEndDate(summary = {}, user = {}) {
  const tenant = getSummaryTenant(summary, user);
  const subscription = getSummarySubscription(summary, user);

  return (
    summary.trial_end_date ||
    summary.subscription_end_date ||
    subscription.trial_end_date ||
    subscription.end_date ||
    tenant.trial_end_date ||
    tenant.subscription_end_date ||
    user.trial_end_date ||
    user.subscription_end_date ||
    ''
  );
}

function getDaysLeft(summary = {}, user = {}) {
  const explicit = summary.days_left ?? summary.trial_days_left;

  if (explicit !== undefined && explicit !== null && explicit !== '') {
    return toNumber(explicit, 0);
  }

  const endDate = getTrialEndDate(summary, user);

  if (!endDate) {
    return null;
  }

  const date = new Date(endDate);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const diff = date.getTime() - Date.now();

  if (diff <= 0) {
    return 0;
  }

  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getEmployeeUsage(summary = {}, user = {}) {
  const tenant = getSummaryTenant(summary, user);
  const subscription = getSummarySubscription(summary, user);

  const used =
    summary.employee_count ??
    summary.employees_used ??
    subscription.employee_count ??
    subscription.employees_used ??
    tenant.employee_count ??
    tenant.employees_used ??
    user.employee_count ??
    user.employees_used ??
    0;

  const limit =
    summary.employee_limit ??
    subscription.employee_limit ??
    tenant.employee_limit ??
    user.employee_limit ??
    '';

  return {
    used: toNumber(used, 0),
    limit: limit === null || limit === undefined || limit === '' ? 'Unlimited' : limit,
  };
}

function getPlans(summary = {}) {
  const plans =
    summary.plans ||
    summary.pricing?.plans ||
    summary.billing?.plans ||
    summary.subscription?.plans ||
    [];

  if (Array.isArray(plans) && plans.length) {
    return plans;
  }

  return [
    {
      plan_code: 'essential',
      display_name: 'Essential',
      plan_name: 'Essential',
      description: 'Starter HRMS subscription for small teams.',
      amount: 2495,
      currency: 'INR',
      billing_interval: 'monthly',
      employee_limit: 50,
      included_employees: 50,
      is_unlimited_employees: false,
      is_custom_pricing: false,
      allow_online_payment: true,
      features: ['Full HRMS access', 'Up to 50 employees', 'Standard support'],
    },
    {
      plan_code: 'growth',
      display_name: 'Growth',
      plan_name: 'Growth',
      description: 'Recommended HRMS subscription for growing companies.',
      amount: 4495,
      currency: 'INR',
      billing_interval: 'monthly',
      employee_limit: 100,
      included_employees: 100,
      is_unlimited_employees: false,
      is_custom_pricing: false,
      allow_online_payment: true,
      is_recommended: true,
      features: ['Full HRMS access', 'Up to 100 employees', 'Priority support'],
    },
    {
      plan_code: 'premium',
      display_name: 'Premium',
      plan_name: 'Premium',
      description: 'Enterprise HRMS subscription with unlimited employees.',
      amount: 0,
      currency: 'INR',
      billing_interval: 'monthly',
      employee_limit: null,
      included_employees: null,
      is_unlimited_employees: true,
      is_custom_pricing: true,
      allow_online_payment: false,
      features: ['Full HRMS access', 'Unlimited employees', 'Custom onboarding'],
    },
  ];
}

function getDefaultPlanCode(summary = {}) {
  return (
    summary.selected_plan_code ||
    summary.default_plan?.plan_code ||
    summary.checkout?.plan_code ||
    summary.pricing?.default_plan?.plan_code ||
    'growth'
  );
}

function getPremiumQuotation(summary = {}) {
  return (
    summary.premium_quotation ||
    summary.premium_payment_due ||
    summary.premium_request ||
    summary.pending_premium_request ||
    {}
  );
}

function hasVisiblePremiumQuotation(summary = {}) {
  const quotation = getPremiumQuotation(summary);

  return Boolean(
    quotation &&
      Object.keys(quotation).length &&
      (quotation.client_visible === true ||
        quotation.quotation_status === 'sent' ||
        quotation.payment_status === 'pending' ||
        quotation.status === 'quoted' ||
        quotation.status === 'payment_pending' ||
        quotation.quoted_amount ||
        quotation.renewal_amount ||
        quotation.payment_link)
  );
}

function getPremiumRequestId(quotation = {}) {
  return safeText(
    quotation._id ||
      quotation.id ||
      quotation.request_id ||
      quotation.premium_request_id,
    '',
  );
}

function getPremiumPaymentStatus(quotation = {}) {
  return normalizeStatus(
    quotation.payment_status || quotation.quotation_status || quotation.status || 'pending',
  );
}

function getPremiumQuotationAmount(quotation = {}) {
  return toNumber(
    quotation.renewal_amount || quotation.payment_amount || quotation.quoted_amount,
    0,
  );
}

function isPastDate(value) {
  if (!value) {
    return false;
  }

  if (typeof value === 'object' && value.$date) {
    value = value.$date;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.getTime() < Date.now();
}

function isPremiumQuotationPaid(quotation = {}) {
  const status = getPremiumPaymentStatus(quotation);

  return status === 'paid' || status === 'converted';
}

function isPremiumQuotationExpired(quotation = {}) {
  if (isPremiumQuotationPaid(quotation)) {
    return false;
  }

  return (
    normalizeStatus(quotation.quotation_status) === 'expired' ||
    normalizeStatus(quotation.status) === 'expired' ||
    isPastDate(quotation.quotation_valid_until) ||
    isPastDate(quotation.payment_due_date)
  );
}

function getPremiumHistory(quotation = {}) {
  const quotationHistory = Array.isArray(quotation.quotation_history)
    ? quotation.quotation_history.map((item) => ({
        ...item,
        history_type: 'Quotation',
        history_date: item.created_at || item.sent_at || item.updated_at,
        history_amount:
          item.renewal_amount || item.payment_amount || item.quoted_amount || item.amount,
        history_currency: item.quoted_currency || item.currency,
        history_interval: item.quoted_billing_interval || item.billing_interval,
      }))
    : [];

  const paymentHistory = Array.isArray(quotation.payment_history)
    ? quotation.payment_history.map((item) => ({
        ...item,
        history_type: 'Invoice / Payment',
        history_date: item.paid_at || item.created_at || item.updated_at,
        history_amount: item.amount || item.payment_amount,
        history_currency: item.currency,
        history_interval: item.billing_interval || item.plan_interval,
      }))
    : [];

  return [...quotationHistory, ...paymentHistory]
    .sort((left, right) => {
      const leftDate = new Date(left.history_date || 0).getTime();
      const rightDate = new Date(right.history_date || 0).getTime();
      return rightDate - leftDate;
    })
    .slice(0, 10);
}

function formatBillingInterval(value) {
  const normalized = safeText(value || 'monthly', 'monthly')
    .toLowerCase()
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');

  if (normalized === 'annual' || normalized === 'annually') {
    return 'Yearly';
  }

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function employeeLimitText(value) {
  if (value === 0 || value === '0' || String(value || '').toLowerCase() === 'unlimited') {
    return 'Unlimited employees';
  }

  if (!value) {
    return 'As per quotation';
  }

  return `Up to ${value} employees`;
}


function getBillingActions(summary = {}) {
  return summary.billing_actions || summary.billingActions || {};
}

function getBillingAlerts(summary = {}) {
  const alerts = summary.billing_alerts || summary.alerts || [];
  return Array.isArray(alerts) ? alerts.filter(Boolean) : [];
}

function getInvoices(summary = {}) {
  const invoices = summary.invoices || summary.payment_history || [];
  return Array.isArray(invoices) ? invoices.filter(Boolean) : [];
}

function invoiceId(invoice = {}, index = 0) {
  return safeText(
    invoice.id ||
      invoice._id ||
      invoice.payment_id ||
      invoice.razorpay_payment_id ||
      invoice.invoice_number ||
      invoice.receipt_number,
    `invoice-${index}`,
  );
}

function invoiceDate(invoice = {}) {
  return (
    invoice.paid_at ||
    invoice.invoice_date ||
    invoice.payment_date ||
    invoice.created_at ||
    invoice.updated_at ||
    ''
  );
}

function invoicePlan(invoice = {}) {
  return safeText(
    invoice.plan_name ||
      invoice.selected_plan_name ||
      invoice.plan_label ||
      invoice.plan_code ||
      invoice.plan,
    'Subscription',
  );
}

function invoiceAmount(invoice = {}) {
  return toNumber(
    invoice.amount ||
      invoice.payment_amount ||
      invoice.paid_amount ||
      invoice.order_amount,
    0,
  );
}

function invoiceStatus(invoice = {}) {
  return normalizeStatus(
    invoice.invoice_status ||
      invoice.payment_status ||
      invoice.status ||
      'paid',
  );
}

function invoiceStatusStyle(status) {
  const normalized = normalizeStatus(status);

  if (['paid', 'captured', 'success', 'completed', 'converted'].includes(normalized)) {
    return {
      background: 'rgba(22,163,74,0.12)',
      color: '#166534',
      border: '1px solid rgba(22,163,74,0.24)',
    };
  }

  if (['failed', 'cancelled', 'refunded', 'expired'].includes(normalized)) {
    return {
      background: 'rgba(220,38,38,0.1)',
      color: '#991b1b',
      border: '1px solid rgba(220,38,38,0.22)',
    };
  }

  return {
    background: 'rgba(234,88,12,0.1)',
    color: '#9a3412',
    border: '1px solid rgba(234,88,12,0.22)',
  };
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

function getDownloadFilename(response, invoice = {}) {
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
    invoice.invoice_number || invoice.receipt_number || invoice.razorpay_payment_id,
    'yourcomate-invoice',
  );

  return `${reference}.pdf`;
}

function BillingAlerts({ alerts = [] }) {
  if (!alerts.length) {
    return null;
  }

  const palette = {
    success: {
      background: 'linear-gradient(135deg, rgba(240,253,244,0.98), #ffffff)',
      border: '1px solid rgba(22,163,74,0.24)',
      color: '#166534',
      icon: CheckCircle2,
    },
    warning: {
      background: 'linear-gradient(135deg, rgba(255,247,237,0.98), #ffffff)',
      border: '1px solid rgba(234,88,12,0.25)',
      color: '#9a3412',
      icon: AlertTriangle,
    },
    error: {
      background: 'linear-gradient(135deg, rgba(254,242,242,0.98), #ffffff)',
      border: '1px solid rgba(220,38,38,0.24)',
      color: '#991b1b',
      icon: AlertTriangle,
    },
    info: {
      background: 'linear-gradient(135deg, rgba(239,246,255,0.98), #ffffff)',
      border: '1px solid rgba(37,99,235,0.22)',
      color: '#1d4ed8',
      icon: BellRing,
    },
  };

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
      {alerts.map((alert, index) => {
        const level = normalizeStatus(alert.level || alert.type || 'info');
        const style = palette[level] || palette.info;
        const Icon = style.icon;

        return (
          <div
            key={alert.code || `${level}-${index}`}
            role={level === 'error' ? 'alert' : 'status'}
            style={{
              ...style,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 13,
              padding: 17,
              borderRadius: 20,
              boxShadow: '0 12px 28px rgba(15,23,42,0.05)',
            }}
          >
            <Icon size={21} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong style={{ display: 'block', color: style.color }}>
                {safeText(alert.title, 'Billing notice')}
              </strong>
              <p style={{ margin: '5px 0 0', color: '#475569', lineHeight: 1.65 }}>
                {safeText(alert.message)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InvoiceHistory({ invoices = [], downloadingInvoiceId = '', onDownload }) {
  return (
    <section
      style={{
        marginTop: 28,
        borderRadius: 26,
        padding: 22,
        background: '#ffffff',
        border: '1px solid rgba(226,232,240,0.92)',
        boxShadow: '0 16px 38px rgba(15,23,42,0.06)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 14,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: '#0f172a',
            }}
          >
            <ReceiptText size={23} color="#2563eb" />
            Invoices and payment history
          </h2>
          <p style={{ margin: '7px 0 0', color: '#64748b', lineHeight: 1.65 }}>
            Review payment status and download your company subscription invoices.
          </p>
        </div>

        <span
          style={{
            borderRadius: 999,
            padding: '7px 11px',
            background: 'rgba(37,99,235,0.08)',
            color: '#1d4ed8',
            fontSize: 12,
            fontWeight: 900,
          }}
        >
          {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
        </span>
      </div>

      {!invoices.length ? (
        <div
          style={{
            marginTop: 18,
            padding: 22,
            borderRadius: 18,
            background: '#f8fafc',
            border: '1px dashed #cbd5e1',
            textAlign: 'center',
            color: '#64748b',
          }}
        >
          <FileText size={28} style={{ marginBottom: 8 }} />
          <p style={{ margin: 0, lineHeight: 1.65 }}>
            No subscription invoice has been generated yet. Paid invoices will appear here automatically.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
          {invoices.map((invoice, index) => {
            const id = invoiceId(invoice, index);
            const status = invoiceStatus(invoice);
            const statusStyle = invoiceStatusStyle(status);
            const downloadUrl = safeText(invoice.download_url, '');
            const downloading = downloadingInvoiceId === id;

            return (
              <div
                key={id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(190px, 1.4fr) repeat(3, minmax(120px, 1fr)) auto',
                  gap: 14,
                  alignItems: 'center',
                  padding: 16,
                  borderRadius: 18,
                  background: '#f8fafc',
                  border: '1px solid rgba(226,232,240,0.92)',
                  overflowX: 'auto',
                }}
              >
                <div style={{ minWidth: 190 }}>
                  <strong style={{ display: 'block', color: '#0f172a' }}>
                    {safeText(invoice.invoice_number || invoice.receipt_number, 'Payment invoice')}
                  </strong>
                  <span style={{ display: 'block', marginTop: 5, color: '#64748b', fontSize: 12 }}>
                    {safeText(invoice.razorpay_payment_id || invoice.razorpay_order_id, 'Recorded payment')}
                  </span>
                </div>

                <div style={{ minWidth: 120 }}>
                  <span style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>
                    Plan
                  </span>
                  <strong style={{ display: 'block', marginTop: 4, color: '#334155' }}>
                    {invoicePlan(invoice)}
                  </strong>
                </div>

                <div style={{ minWidth: 120 }}>
                  <span style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>
                    Paid on
                  </span>
                  <strong style={{ display: 'block', marginTop: 4, color: '#334155' }}>
                    {formatDate(invoiceDate(invoice))}
                  </strong>
                </div>

                <div style={{ minWidth: 120 }}>
                  <span style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>
                    Amount
                  </span>
                  <strong style={{ display: 'block', marginTop: 4, color: '#0f172a' }}>
                    {formatCurrency(invoiceAmount(invoice), invoice.currency || 'INR')}
                  </strong>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', minWidth: 210 }}>
                  <span
                    style={{
                      ...statusStyle,
                      borderRadius: 999,
                      padding: '6px 10px',
                      fontSize: 11,
                      fontWeight: 900,
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {safeText(status).replaceAll('_', ' ')}
                  </span>

                  <button
                    type="button"
                    className="ghost"
                    onClick={() => onDownload(invoice, index)}
                    disabled={!downloadUrl || downloading}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      minHeight: 40,
                      whiteSpace: 'nowrap',
                      opacity: !downloadUrl ? 0.55 : 1,
                    }}
                  >
                    {downloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                    {downloading ? 'Downloading...' : 'Download PDF'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}


function loadRazorpayCheckout() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay checkout is not available in this environment.'));
  }

  if (window.Razorpay) {
    return Promise.resolve(true);
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Unable to load Razorpay checkout.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error('Unable to load Razorpay checkout.'));
    document.body.appendChild(script);
  });
}

function StatusBadge({ planType, status }) {
  const normalizedStatus = normalizeStatus(status);
  const isPositive =
    normalizedStatus === 'active' ||
    normalizedStatus === 'paid' ||
    normalizedStatus === 'lifetime';

  const isNegative =
    normalizedStatus === 'expired' ||
    normalizedStatus === 'suspended' ||
    normalizedStatus === 'cancelled';

  const style = isPositive
    ? {
        background: 'rgba(22, 163, 74, 0.12)',
        color: '#166534',
        border: '1px solid rgba(22, 163, 74, 0.25)',
      }
    : isNegative
      ? {
          background: 'rgba(220, 38, 38, 0.12)',
          color: '#991b1b',
          border: '1px solid rgba(220, 38, 38, 0.25)',
        }
      : {
          background: 'rgba(234, 88, 12, 0.12)',
          color: '#9a3412',
          border: '1px solid rgba(234, 88, 12, 0.25)',
        };

  return (
    <span
      style={{
        ...style,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        padding: '7px 12px',
        fontSize: 12,
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {isPositive ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {safeText(planType, 'Plan')} · {safeText(status, 'Status')}
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, tone = '#2563eb' }) {
  return (
    <div
      className="stat-card"
      style={{
        padding: 18,
        minHeight: 116,
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

function PricingPlanCard({ plan, selected, disabled, onSelect }) {
  const planCode = plan.plan_code || plan.code || '';
  const planName = plan.display_name || plan.plan_name || planCode;
  const amount = toNumber(plan.amount, 0);
  const currency = plan.currency || 'INR';
  const interval = plan.billing_interval || 'monthly';
  const isCustom = Boolean(plan.is_custom_pricing);
  const allowOnlinePayment = plan.allow_online_payment !== false && !isCustom;
  const employeeText = plan.is_unlimited_employees
    ? 'Unlimited employees'
    : `Up to ${plan.employee_limit || plan.included_employees || 0} employees`;

  return (
    <button
      type="button"
      onClick={() => onSelect(planCode)}
      disabled={disabled}
      style={{
        textAlign: 'left',
        border: selected
          ? '2px solid rgba(37,99,235,0.8)'
          : '1px solid rgba(226,232,240,0.95)',
        borderRadius: 24,
        padding: 22,
        background: selected
          ? 'linear-gradient(135deg, rgba(239,246,255,0.98), #ffffff)'
          : '#ffffff',
        boxShadow: selected
          ? '0 22px 48px rgba(37,99,235,0.13)'
          : '0 14px 34px rgba(15,23,42,0.06)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.65 : 1,
        position: 'relative',
      }}
    >
      {plan.is_recommended ? (
        <span
          style={{
            position: 'absolute',
            right: 18,
            top: 16,
            borderRadius: 999,
            padding: '5px 10px',
            background: 'rgba(37,99,235,0.1)',
            color: '#1d4ed8',
            fontSize: 11,
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Recommended
        </span>
      ) : null}

      <h3 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: 22 }}>
        {planName}
      </h3>

      <p style={{ margin: 0, color: '#64748b', lineHeight: 1.55, minHeight: 48 }}>
        {safeText(plan.description, 'Full HRMS subscription plan.')}
      </p>

      <div style={{ marginTop: 18 }}>
        <strong
          style={{
            display: 'block',
            fontSize: 30,
            color: '#0f172a',
            letterSpacing: '-0.04em',
          }}
        >
          {isCustom ? 'Custom' : formatCurrency(amount, currency)}
        </strong>
        <span style={{ color: '#64748b', fontSize: 13 }}>
          {isCustom ? 'Contact Sales Team' : `per ${interval}`}
        </span>
      </div>

      <div
        style={{
          marginTop: 14,
          borderRadius: 16,
          padding: '11px 13px',
          background: selected ? 'rgba(37,99,235,0.1)' : 'rgba(15,23,42,0.04)',
          color: selected ? '#1d4ed8' : '#334155',
          fontWeight: 900,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        <Users size={17} />
        {employeeText}
      </div>

      <ul style={{ margin: '16px 0 0', paddingLeft: 20, color: '#475569', lineHeight: 1.8 }}>
        {(plan.features || []).slice(0, 5).map((feature) => (
          <li key={`${planCode}-${feature}`}>{feature}</li>
        ))}
      </ul>

      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
        {selected ? (
          <>
            <CheckCircle2 size={18} color="#2563eb" />
            <span style={{ color: '#2563eb', fontWeight: 900 }}>Selected</span>
          </>
        ) : allowOnlinePayment ? (
          <>
            <CreditCard size={18} color="#64748b" />
            <span style={{ color: '#64748b', fontWeight: 800 }}>Select plan</span>
          </>
        ) : (
          <>
            <AlertTriangle size={18} color="#92400e" />
            <span style={{ color: '#92400e', fontWeight: 800 }}>Custom plan</span>
          </>
        )}
      </div>
    </button>
  );
}

function PremiumQuotationPanel({
  quotation = {},
  onPay,
  creatingOrder = false,
  verifyingPayment = false,
  paymentDisabled = false,
  paymentDisabledReason = '',
  isRenewal = false,
}) {
  if (!quotation || !Object.keys(quotation).length) {
    return null;
  }

  const amount = getPremiumQuotationAmount(quotation);
  const currency = quotation.quoted_currency || quotation.currency || 'INR';
  const interval = quotation.quoted_billing_interval || quotation.billing_interval || 'monthly';
  const paymentLink = safeText(quotation.payment_link, '');
  const reference =
    quotation.quotation_reference ||
    quotation.request_reference ||
    quotation.reference ||
    'Premium quotation';
  const status = getPremiumPaymentStatus(quotation);
  const history = getPremiumHistory(quotation);
  const busy = creatingOrder || verifyingPayment;

  return (
    <section
      style={{
        marginTop: 28,
        borderRadius: 28,
        padding: 24,
        background:
          'linear-gradient(135deg, rgba(240,253,244,0.96), rgba(239,246,255,0.98))',
        border: '1px solid rgba(34,197,94,0.25)',
        boxShadow: '0 18px 45px rgba(15,23,42,0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 18,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <p
            style={{
              margin: '0 0 8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: '#166534',
              fontWeight: 900,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              fontSize: 12,
            }}
          >
            <ShieldCheck size={16} />
            Premium quotation received
          </p>

          <h2 style={{ margin: 0, color: '#0f172a' }}>
            {isRenewal ? 'Premium renewal payment is ready' : 'Premium payment details are ready'}
          </h2>

          <p style={{ margin: '10px 0 0', color: '#475569', lineHeight: 1.7 }}>
            Review the quotation amount, billing interval and payment due date below.
            Pay through Razorpay to {isRenewal ? 'renew' : 'activate'} Premium access.
          </p>
        </div>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 999,
            padding: '8px 12px',
            background: 'rgba(37,99,235,0.1)',
            color: '#1d4ed8',
            border: '1px solid rgba(37,99,235,0.22)',
            fontWeight: 900,
            textTransform: 'uppercase',
            fontSize: 12,
          }}
        >
          <CheckCircle2 size={15} />
          {safeText(status).replaceAll('_', ' ')}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14,
          marginTop: 22,
        }}
      >
        <SummaryCard
          icon={IndianRupee}
          label="Quoted / Renewal Amount"
          value={formatCurrency(amount, currency)}
          tone="#16a34a"
        />
        <SummaryCard
          icon={CalendarClock}
          label="Billing Interval"
          value={formatBillingInterval(interval)}
          tone="#2563eb"
        />
        <SummaryCard
          icon={Users}
          label="Employee Limit"
          value={employeeLimitText(quotation.quoted_employee_limit)}
          tone="#7c3aed"
        />
        <SummaryCard
          icon={CalendarClock}
          label="Payment Due Date"
          value={formatDate(quotation.payment_due_date)}
          tone="#ea580c"
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
          marginTop: 20,
        }}
      >
        <div
          style={{
            padding: 18,
            borderRadius: 20,
            background: '#ffffff',
            border: '1px solid rgba(226,232,240,0.95)',
          }}
        >
          <strong style={{ color: '#0f172a' }}>Quotation Reference</strong>
          <p style={{ margin: '8px 0 0', color: '#475569', lineHeight: 1.7 }}>
            {safeText(reference)}
          </p>

          <strong style={{ display: 'block', color: '#0f172a', marginTop: 14 }}>
            Valid Until
          </strong>
          <p style={{ margin: '8px 0 0', color: '#475569', lineHeight: 1.7 }}>
            {formatDate(quotation.quotation_valid_until)}
          </p>
        </div>

        <div
          style={{
            padding: 18,
            borderRadius: 20,
            background: '#ffffff',
            border: '1px solid rgba(226,232,240,0.95)',
          }}
        >
          <strong style={{ color: '#0f172a' }}>Premium Renewal Rule</strong>
          <p style={{ margin: '8px 0 0', color: '#475569', lineHeight: 1.7 }}>
            The finalized quotation amount remains the recurring monthly/yearly renewal
            amount until Superadmin revises the quotation.
          </p>
        </div>
      </div>

      {quotation.sales_note ? (
        <div
          style={{
            marginTop: 16,
            padding: 18,
            borderRadius: 20,
            background: '#ffffff',
            border: '1px solid rgba(226,232,240,0.95)',
          }}
        >
          <strong style={{ color: '#0f172a' }}>Sales Note</strong>
          <p
            style={{
              margin: '8px 0 0',
              color: '#475569',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
            }}
          >
            {quotation.sales_note}
          </p>
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginTop: 20,
        }}
      >
        <button
          type="button"
          className="primary"
          onClick={onPay}
          disabled={paymentDisabled || busy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            minHeight: 46,
            opacity: paymentDisabled ? 0.65 : 1,
          }}
        >
          {busy ? <Loader2 size={18} className="spin" /> : <CreditCard size={18} />}
          {verifyingPayment
            ? 'Verifying Payment...'
            : creatingOrder
              ? 'Opening Razorpay...'
              : isRenewal
                ? 'Pay Premium Renewal'
                : 'Pay Premium Quotation'}
        </button>

        {paymentLink ? (
          <a
            href={paymentLink}
            target="_blank"
            rel="noreferrer"
            className="ghost"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              minHeight: 46,
              textDecoration: 'none',
            }}
          >
            <CreditCard size={18} />
            Open Supplied Payment Link
          </a>
        ) : null}

        <span style={{ color: paymentDisabled ? '#92400e' : '#475569', lineHeight: 1.7 }}>
          {paymentDisabledReason ||
            `After successful payment, Premium access will be ${isRenewal ? 'renewed' : 'activated'} automatically.`}
        </span>
      </div>

      {history.length ? (
        <div
          style={{
            marginTop: 20,
            padding: 18,
            borderRadius: 20,
            background: '#ffffff',
            border: '1px solid rgba(226,232,240,0.95)',
          }}
        >
          <strong style={{ color: '#0f172a' }}>Quotation / Invoice History</strong>

          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {history.map((item, index) => (
              <div
                key={`${item.history_type}-${item.history_date || index}-${item.payment_id || item.quotation_reference || index}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 10,
                  padding: 12,
                  borderRadius: 16,
                  background: '#f8fafc',
                  border: '1px solid rgba(226,232,240,0.9)',
                  color: '#475569',
                }}
              >
                <span>
                  <strong style={{ color: '#0f172a' }}>Type:</strong>{' '}
                  {item.history_type}
                </span>
                <span>
                  <strong style={{ color: '#0f172a' }}>Date:</strong>{' '}
                  {formatDate(item.history_date)}
                </span>
                <span>
                  <strong style={{ color: '#0f172a' }}>Amount:</strong>{' '}
                  {formatCurrency(item.history_amount, item.history_currency || currency)}
                </span>
                <span>
                  <strong style={{ color: '#0f172a' }}>Interval:</strong>{' '}
                  {formatBillingInterval(item.history_interval || interval)}
                </span>
                <span>
                  <strong style={{ color: '#0f172a' }}>Status:</strong>{' '}
                  {safeText(item.status || item.payment_status || item.quotation_status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function Billing({ user = {}, setPage }) {
  const { showAlert } = useCustomAlert();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [selectedPlanCode, setSelectedPlanCode] = useState('');
  const [showSalesContact, setShowSalesContact] = useState(false);
  const [submittingPremiumRequest, setSubmittingPremiumRequest] = useState(false);
  const [premiumRequestResult, setPremiumRequestResult] = useState(null);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState('');
  const [premiumForm, setPremiumForm] = useState({
    contact_name: '',
    contact_email: '',
    company_email: '',
    contact_phone: '',
    employee_count: '',
    onboarding_required: 'Yes',
    training_required: 'Yes',
    custom_modules: '',
    support_sla: 'Standard business support',
    message: '',
  });

  const plans = useMemo(() => getPlans(summary || {}), [summary]);
  const premiumQuotation = useMemo(() => getPremiumQuotation(summary || {}), [summary]);
  const hasPremiumQuotation = useMemo(() => hasVisiblePremiumQuotation(summary || {}), [summary]);
  const premiumRequestId = useMemo(
    () => getPremiumRequestId(premiumQuotation),
    [premiumQuotation],
  );

  const selectedPlan = useMemo(() => {
    return (
      plans.find((plan) => (plan.plan_code || plan.code) === selectedPlanCode) ||
      plans.find((plan) => (plan.plan_code || plan.code) === getDefaultPlanCode(summary || {})) ||
      plans[0] ||
      null
    );
  }, [plans, selectedPlanCode, summary]);

  const computed = useMemo(() => {
    const currentSummary = summary || {};
    const planType = getPlanType(currentSummary, user);
    const status = getStatus(currentSummary, user);
    const employeeUsage = getEmployeeUsage(currentSummary, user);
    const daysLeft = getDaysLeft(currentSummary, user);
    const billingActions = getBillingActions(currentSummary);

    const selectedAmount = selectedPlan?.amount ?? currentSummary.amount ?? 4495;
    const selectedCurrency = selectedPlan?.currency ?? currentSummary.currency ?? 'INR';
    const isLifetime = Boolean(
      planType === 'lifetime' ||
        currentSummary.is_sds_company ||
        currentSummary.has_lifetime_access ||
        currentSummary.is_lifetime,
    );
    const isPaidCompany = Boolean(currentSummary.is_paid_company || planType === 'paid');
    const isExpired = Boolean(
      currentSummary.is_expired ||
        ['expired', 'suspended', 'blocked', 'inactive'].includes(status) ||
        daysLeft === 0,
    );
    const isPaid = isPaidCompany && !isExpired;
    const fallbackShowActions = !isLifetime && (!isPaid || isExpired);
    const showUpgradeActions =
      currentSummary.show_upgrade_actions ??
      billingActions.show_upgrade_actions ??
      fallbackShowActions;
    const showPlanSelection =
      currentSummary.show_plan_selection ??
      billingActions.show_plan_selection ??
      showUpgradeActions;
    const showPaymentActions =
      currentSummary.show_payment_actions ??
      billingActions.show_payment_actions ??
      showUpgradeActions;
    const validUntil =
      currentSummary.subscription_valid_until ||
      billingActions.subscription_valid_until ||
      currentSummary.subscription_end_date ||
      currentSummary.next_payment_due_date ||
      getTrialEndDate(currentSummary, user);

    return {
      companyName: getCompanyName(currentSummary, user),
      companyEmail: getCompanyEmail(currentSummary, user),
      planType,
      status,
      trialEndDate: getTrialEndDate(currentSummary, user),
      validUntil,
      daysLeft,
      employeesUsed: employeeUsage.used,
      employeeLimit: employeeUsage.limit,
      amount: selectedAmount,
      currency: selectedCurrency,
      currentPlanLabel: safeText(
        currentSummary.plan_label ||
          currentSummary.selected_plan_name ||
          billingActions.current_plan_label ||
          currentSummary.plan_code ||
          planType,
        'Current plan',
      ),
      isLifetime,
      isPaid,
      isPaidCompany,
      isExpired,
      isDemo: planType === 'demo' || planType === 'trial',
      renewalDueSoon: Boolean(
        currentSummary.renewal_due_soon ?? billingActions.renewal_due_soon,
      ),
      renewalWindowDays: toNumber(
        currentSummary.renewal_window_days ?? billingActions.renewal_window_days,
        7,
      ),
      showUpgradeActions: Boolean(showUpgradeActions),
      showPlanSelection: Boolean(showPlanSelection),
      showPaymentActions: Boolean(showPaymentActions),
    };
  }, [summary, user, selectedPlan]);

  const billingAlerts = useMemo(() => getBillingAlerts(summary || {}), [summary]);
  const invoices = useMemo(() => getInvoices(summary || {}), [summary]);

  const premiumQuotationPaid = isPremiumQuotationPaid(premiumQuotation);
  const premiumQuotationExpired = isPremiumQuotationExpired(premiumQuotation);
  const premiumQuotationAmount = getPremiumQuotationAmount(premiumQuotation);
  const premiumNeedsRenewal =
    premiumQuotationPaid &&
    (computed.isExpired || computed.renewalDueSoon || summary?.requires_payment === true);

  let premiumPaymentDisabledReason = '';

  if (computed.isLifetime) {
    premiumPaymentDisabledReason = 'SDS lifetime access does not require Premium payment.';
  } else if (!premiumRequestId) {
    premiumPaymentDisabledReason = 'Premium quotation request ID is unavailable. Refresh the page or contact Sales.';
  } else if (premiumQuotationAmount <= 0) {
    premiumPaymentDisabledReason = 'Premium quotation amount has not been finalized yet.';
  } else if (premiumQuotationExpired) {
    premiumPaymentDisabledReason = 'This Premium quotation is expired. Please request a revised quotation.';
  } else if (premiumQuotationPaid && !premiumNeedsRenewal) {
    premiumPaymentDisabledReason = 'This Premium quotation has already been paid.';
  }

  const premiumPaymentDisabled = Boolean(premiumPaymentDisabledReason);

  async function loadBillingSummary() {
    setLoading(true);

    try {
      const data = await api('/billing/summary');
      setSummary(data);

      const defaultCode = getDefaultPlanCode(data);
      const availablePlans = getPlans(data);
      const firstOnlinePlan =
        availablePlans.find((plan) => plan.allow_online_payment !== false && !plan.is_custom_pricing) ||
        availablePlans[0];

      const visiblePremiumQuotation = hasVisiblePremiumQuotation(data);

      setSelectedPlanCode(
        visiblePremiumQuotation
          ? 'premium'
          : defaultCode ||
              firstOnlinePlan?.plan_code ||
              firstOnlinePlan?.code ||
              'growth',
      );
    } catch (error) {
      showAlert({
        title: 'Unable to load billing details',
        message: error.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBillingSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildDefaultPremiumForm() {
    return {
      contact_name:
        user.name ||
        user.full_name ||
        user.employee_name ||
        user.contact_person ||
        user.contact_name ||
        computed.companyName ||
        '',
      contact_email:
        user.email ||
        user.company_email ||
        user.contact_email ||
        user.registered_email ||
        computed.companyEmail ||
        '',
      company_email:
        computed.companyEmail ||
        user.company_email ||
        user.registered_email ||
        user.email ||
        user.contact_email ||
        '',
      contact_phone:
        user.phone ||
        user.mobile ||
        user.contact_no ||
        user.contact_phone ||
        user.company_phone ||
        '',
      employee_count:
        computed.employeesUsed && computed.employeesUsed > 0
          ? String(computed.employeesUsed)
          : '',
      onboarding_required: 'Yes',
      training_required: 'Yes',
      custom_modules: '',
      support_sla: 'Premium / enterprise support discussion required',
      message:
        'We are interested in the Premium custom plan. Please contact us with quotation and payment details.',
    };
  }

  function openPremiumRequestForm() {
    setPremiumForm((current) => ({
      ...buildDefaultPremiumForm(),
      ...Object.fromEntries(
        Object.entries(current || {}).filter(([, value]) => String(value || '').trim()),
      ),
    }));
    setPremiumRequestResult(null);
    setShowSalesContact(true);
  }

  function handlePremiumFormChange(field, value) {
    setPremiumForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function submitPremiumRequest(event) {
    event.preventDefault();

    if (!selectedPlan) {
      showAlert({
        title: 'Select Premium plan',
        message: 'Please select Premium before submitting the request.',
        type: 'warning',
      });
      return;
    }

    const contactName = String(premiumForm.contact_name || '').trim();
    const contactEmail = String(premiumForm.contact_email || '').trim();
    const employeeCount = Number(premiumForm.employee_count || 0);

    if (!contactName) {
      showAlert({
        title: 'Contact name required',
        message: 'Please enter the contact person name.',
        type: 'warning',
      });
      return;
    }

    if (!contactEmail) {
      showAlert({
        title: 'Contact email required',
        message: 'Please enter the contact email.',
        type: 'warning',
      });
      return;
    }

    if (!Number.isFinite(employeeCount) || employeeCount <= 0) {
      showAlert({
        title: 'Employee count required',
        message: 'Please enter the estimated employee count for Premium pricing.',
        type: 'warning',
      });
      return;
    }

    setSubmittingPremiumRequest(true);

    try {
      const planCode = selectedPlan.plan_code || selectedPlan.code || selectedPlanCode || 'premium';
      const planName = selectedPlan.display_name || selectedPlan.plan_name || 'Premium';

      const data = await api('/billing/premium-request', {
        method: 'POST',
        body: JSON.stringify({
          plan_code: planCode,
          contact_name: contactName,
          contact_email: contactEmail,
          contact_phone: String(premiumForm.contact_phone || '').trim(),
          company_email: String(premiumForm.company_email || '').trim(),
          employee_count: employeeCount,
          message: String(premiumForm.message || '').trim(),
          requirements: {
            requested_plan: planName,
            employee_count: employeeCount,
            onboarding_required: premiumForm.onboarding_required,
            training_required: premiumForm.training_required,
            custom_modules: String(premiumForm.custom_modules || '').trim(),
            support_sla: premiumForm.support_sla,
            current_employee_limit: computed.employeeLimit,
            current_employees_used: computed.employeesUsed,
          },
        }),
      });

      setPremiumRequestResult({
        request_id: data.request_id || data.request?.id || data.request?._id || '',
        request_reference:
          data.request_reference ||
          data.request?.request_reference ||
          data.request?.reference ||
          '',
      });

      showAlert({
        title: 'Premium request submitted',
        message:
          data.message ||
          'Premium request submitted successfully. Our sales team will connect with you within 24 hours.',
        type: 'success',
      });
    } catch (error) {
      showAlert({
        title: 'Unable to submit Premium request',
        message:
          error.message ||
          'Please check the details and try again.',
        type: 'error',
      });
    } finally {
      setSubmittingPremiumRequest(false);
    }
  }

  function handleSelectPlan(planCode) {
    setSelectedPlanCode(planCode);
    setShowSalesContact(false);
    setPremiumRequestResult(null);
  }

  async function handlePaymentSuccess(paymentResponse, orderResponse) {
    setVerifyingPayment(true);

    try {
      const verifiedPlanCode =
        orderResponse.plan_code ||
        orderResponse.selected_plan?.plan_code ||
        orderResponse.raw_order?.selected_plan?.plan_code ||
        selectedPlanCode;

      const verifiedPremiumRequestId =
        orderResponse.premium_request_id ||
        orderResponse.selected_plan?.premium_request_id ||
        orderResponse.order?.premium_request_id ||
        orderResponse.raw_order?.selected_plan?.premium_request_id ||
        orderResponse.raw_order?.checkout?.premium_request_id ||
        premiumRequestId ||
        '';

      const verifyPayload = {
        razorpay_order_id: paymentResponse.razorpay_order_id,
        razorpay_payment_id: paymentResponse.razorpay_payment_id,
        razorpay_signature: paymentResponse.razorpay_signature,
        local_order_id:
          orderResponse.local_order_id ||
          orderResponse.order_id ||
          orderResponse.id ||
          '',
        plan_code: verifiedPlanCode,
        premium_request_id:
          normalizeStatus(verifiedPlanCode) === 'premium'
            ? verifiedPremiumRequestId
            : undefined,
      };

      const data = await api('/billing/verify-payment', {
        method: 'POST',
        body: JSON.stringify(verifyPayload),
      });

      showAlert({
        title: normalizeStatus(verifiedPlanCode) === 'premium'
          ? 'Premium plan activated'
          : 'Subscription activated',
        message:
          data.message ||
          'Payment verified successfully. Full HRMS access is now unlocked.',
        type: 'success',
      });

      try {
        await refreshCurrentSession();
      } catch {
        // Billing is already refreshed below.
      }

      await loadBillingSummary();
      setShowSalesContact(false);
      setPremiumRequestResult(null);

      if (typeof setPage === 'function') {
        setPage('dashboard');
      }

      try {
        window.history.replaceState({}, '', '/hrms');
      } catch {
        // Ignore browser history errors.
      }
    } catch (error) {
      showAlert({
        title: 'Payment verification failed',
        message:
          error.message ||
          'Payment was received but verification failed. Please contact the sales/support team.',
        type: 'error',
      });
    } finally {
      setVerifyingPayment(false);
    }
  }

  async function openRazorpayForPlan({
    planCode,
    plan,
    premiumRequestId: requestedPremiumRequestId = '',
    quotation = {},
  }) {
    setCreatingOrder(true);

    try {
      await loadRazorpayCheckout();

      const requestBody = {
        plan_code: planCode,
      };

      if (normalizeStatus(planCode) === 'premium') {
        requestBody.premium_request_id = requestedPremiumRequestId;
      }

      const orderResponse = await api('/billing/create-order', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      const order =
        orderResponse.order ||
        orderResponse.razorpay_order ||
        orderResponse;
      const rawOrder = orderResponse.raw_order || {};
      const checkoutData = rawOrder.checkout || {};
      const selectedOrderPlan =
        orderResponse.selected_plan ||
        rawOrder.selected_plan ||
        {};

      const razorpayKey =
        orderResponse.key_id ||
        orderResponse.razorpay_key_id ||
        orderResponse.key ||
        order.key_id ||
        order.key ||
        checkoutData.key_id ||
        '';

      const razorpayOrderId =
        order.id ||
        order.razorpay_order_id ||
        orderResponse.razorpay_order_id ||
        rawOrder.razorpay_order_id ||
        '';

      if (!razorpayKey) {
        throw new Error('Razorpay key ID is missing from backend response.');
      }

      if (!razorpayOrderId) {
        throw new Error('Razorpay order ID is missing from backend response.');
      }

      const responsePlanCode =
        orderResponse.plan_code ||
        selectedOrderPlan.plan_code ||
        checkoutData.plan_code ||
        planCode;
      const responsePlanName =
        orderResponse.plan_name ||
        selectedOrderPlan.plan_name ||
        checkoutData.plan_name ||
        plan?.display_name ||
        plan?.plan_name ||
        (normalizeStatus(responsePlanCode) === 'premium' ? 'Premium' : 'HRMS');
      const responsePremiumRequestId =
        orderResponse.premium_request_id ||
        selectedOrderPlan.premium_request_id ||
        checkoutData.premium_request_id ||
        requestedPremiumRequestId ||
        '';
      const responseQuotationReference =
        orderResponse.quotation_reference ||
        selectedOrderPlan.quotation_reference ||
        checkoutData.quotation_reference ||
        quotation.quotation_reference ||
        quotation.request_reference ||
        '';

      const options = {
        key: razorpayKey,
        amount:
          order.amount ||
          orderResponse.amount ||
          checkoutData.amount,
        currency:
          order.currency ||
          orderResponse.currency ||
          checkoutData.currency ||
          plan?.currency ||
          computed.currency ||
          'INR',
        name: 'YourComate HRMS',
        description:
          orderResponse.description ||
          order.description ||
          checkoutData.description ||
          `${responsePlanName} Subscription`,
        order_id: razorpayOrderId,
        prefill: {
          name:
            orderResponse.prefill?.name ||
            order.prefill?.name ||
            checkoutData.prefill?.name ||
            computed.companyName,
          email:
            orderResponse.prefill?.email ||
            order.prefill?.email ||
            checkoutData.prefill?.email ||
            computed.companyEmail,
          contact:
            orderResponse.prefill?.contact ||
            order.prefill?.contact ||
            checkoutData.prefill?.contact ||
            undefined,
        },
        notes: {
          ...(checkoutData.notes || {}),
          ...(order.notes || {}),
          ...(orderResponse.notes || {}),
          company_name: computed.companyName,
          plan_code: responsePlanCode,
          plan_name: responsePlanName,
          premium_request_id: responsePremiumRequestId || undefined,
          quotation_reference: responseQuotationReference || undefined,
        },
        theme: {
          color: '#2563eb',
        },
        handler: (paymentResponse) => {
          handlePaymentSuccess(paymentResponse, {
            ...orderResponse,
            plan_code: responsePlanCode,
            premium_request_id: responsePremiumRequestId,
            quotation_reference: responseQuotationReference,
          });
        },
        modal: {
          ondismiss: () => {
            showAlert({
              title: 'Payment cancelled',
              message: 'The Razorpay payment window was closed before payment completion.',
              type: 'info',
            });
          },
        },
      };

      const checkout = new window.Razorpay(options);

      checkout.on('payment.failed', (response) => {
        showAlert({
          title: 'Payment failed',
          message:
            response?.error?.description ||
            'Razorpay payment failed. Please try again.',
          type: 'error',
        });
      });

      checkout.open();
    } catch (error) {
      showAlert({
        title: 'Unable to start payment',
        message: error.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setCreatingOrder(false);
    }
  }

  async function startPremiumQuotationPayment() {
    if (computed.isLifetime) {
      showAlert({
        title: 'Lifetime access enabled',
        message: 'SDS lifetime company does not require payment.',
        type: 'info',
      });
      return;
    }

    if (!hasPremiumQuotation) {
      showAlert({
        title: 'Premium quotation unavailable',
        message: 'Submit a Premium request and wait for Superadmin to release the quotation.',
        type: 'warning',
      });
      return;
    }

    if (premiumPaymentDisabled) {
      showAlert({
        title: 'Premium payment unavailable',
        message: premiumPaymentDisabledReason,
        type: 'warning',
      });
      return;
    }

    const premiumPlan =
      plans.find((item) => normalizeStatus(item.plan_code || item.code) === 'premium') ||
      selectedPlan ||
      {
        plan_code: 'premium',
        plan_name: 'Premium',
        display_name: 'Premium',
        currency: premiumQuotation.quoted_currency || premiumQuotation.currency || 'INR',
      };

    setSelectedPlanCode('premium');

    await openRazorpayForPlan({
      planCode: 'premium',
      plan: premiumPlan,
      premiumRequestId,
      quotation: premiumQuotation,
    });
  }

  async function startRazorpayPayment() {
    if (computed.isLifetime) {
      showAlert({
        title: 'Lifetime access enabled',
        message: 'SDS lifetime company does not require payment.',
        type: 'info',
      });
      return;
    }

    if (!selectedPlan) {
      showAlert({
        title: 'Select a plan',
        message: 'Please select Essential, Growth, or Premium before payment.',
        type: 'warning',
      });
      return;
    }

    const planCode = selectedPlan.plan_code || selectedPlan.code || selectedPlanCode;
    const isPremiumPlan = normalizeStatus(planCode) === 'premium';
    const isCustomPlan =
      Boolean(selectedPlan.is_custom_pricing) ||
      selectedPlan.allow_online_payment === false;

    if (isPremiumPlan || isCustomPlan) {
      if (hasPremiumQuotation) {
        await startPremiumQuotationPayment();
      } else {
        openPremiumRequestForm();
      }
      return;
    }

    await openRazorpayForPlan({
      planCode,
      plan: selectedPlan,
    });
  }


  async function downloadInvoice(invoice, index = 0) {
    const id = invoiceId(invoice, index);
    const downloadUrl = safeText(invoice.download_url, '');

    if (!downloadUrl) {
      showAlert({
        title: 'Invoice unavailable',
        message: 'A download link has not been generated for this payment record.',
        type: 'warning',
      });
      return;
    }

    setDownloadingInvoiceId(id);

    try {
      const token = getToken();
      const response = await fetch(buildBillingApiUrl(downloadUrl), {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        let message = 'Unable to download this invoice.';

        try {
          const payload = await response.json();
          message = payload.message || payload.error || message;
        } catch {
          // Keep the fallback message when the backend did not return JSON.
        }

        throw new Error(message);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = getDownloadFilename(response, invoice);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      showAlert({
        title: 'Invoice download failed',
        message: error.message || 'Please refresh the billing page and try again.',
        type: 'error',
      });
    } finally {
      setDownloadingInvoiceId('');
    }
  }

  function goBack() {
    if (typeof setPage === 'function') {
      setPage('dashboard');
    }

    try {
      window.history.replaceState({}, '', '/hrms');
    } catch {
      // Ignore browser history errors.
    }
  }

  const selectedPlanEmployeeText = selectedPlan?.is_unlimited_employees
    ? 'Unlimited'
    : `${selectedPlan?.employee_limit || selectedPlan?.included_employees || '—'} employees`;

  const isCustomSelected =
    Boolean(selectedPlan?.is_custom_pricing) || selectedPlan?.allow_online_payment === false;
  const selectedPlanIsPremium =
    normalizeStatus(selectedPlan?.plan_code || selectedPlan?.code || selectedPlanCode) === 'premium';
  const selectedPremiumCanPay =
    selectedPlanIsPremium && hasPremiumQuotation && !premiumPaymentDisabled;

  return (
    <section className="panel" style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div
        style={{
          borderRadius: 30,
          padding: 'clamp(22px, 4vw, 38px)',
          background:
            'linear-gradient(135deg, rgba(239,246,255,0.98), rgba(255,255,255,0.98))',
          border: '1px solid rgba(37,99,235,0.14)',
          boxShadow: '0 24px 60px rgba(15,23,42,0.09)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 18,
            alignItems: 'flex-start',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 520px' }}>
            <p
              style={{
                margin: '0 0 8px',
                color: '#2563eb',
                fontWeight: 900,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontSize: 13,
              }}
            >
              YourComate SaaS Billing
            </p>

            <h1
              style={{
                margin: 0,
                color: '#0f172a',
                fontSize: 'clamp(30px, 5vw, 50px)',
                lineHeight: 1.06,
                letterSpacing: '-0.045em',
              }}
            >
              Manage your HRMS subscription
            </h1>

            <p
              style={{
                margin: '14px 0 0',
                maxWidth: 760,
                color: '#475569',
                lineHeight: 1.7,
                fontSize: 16,
              }}
            >
              Check your subscription status, validity, invoices and renewal alerts.
              Plan selection and payment controls appear only when a trial needs conversion,
              a subscription has expired, or renewal is approaching.
            </p>

            <div style={{ marginTop: 18 }}>
              <StatusBadge
                planType={computed.planType || 'demo'}
                status={computed.status || 'active'}
              />
            </div>
          </div>

          <div
            style={{
              minWidth: 250,
              borderRadius: 24,
              padding: 22,
              background: '#ffffff',
              border: '1px solid rgba(226,232,240,0.9)',
              boxShadow: '0 16px 40px rgba(15,23,42,0.06)',
            }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                borderRadius: 20,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(37,99,235,0.12)',
                color: '#2563eb',
                marginBottom: 14,
              }}
            >
              {computed.isLifetime || computed.isPaid ? (
                <Unlock size={30} />
              ) : (
                <Lock size={30} />
              )}
            </div>

            <p style={{ margin: 0, color: '#64748b', fontWeight: 700 }}>
              {computed.showUpgradeActions ? 'Selected Plan' : 'Current Subscription'}
            </p>
            <h2 style={{ margin: '6px 0 0', color: '#0f172a', textTransform: 'capitalize' }}>
              {computed.showUpgradeActions
                ? selectedPlan?.display_name || selectedPlan?.plan_name || 'Growth'
                : computed.currentPlanLabel}
            </h2>
            <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 13 }}>
              {computed.isLifetime
                ? 'No renewal required'
                : computed.showUpgradeActions
                  ? `${formatCurrency(selectedPlan?.amount ?? 4495, selectedPlan?.currency || 'INR')}${selectedPlan?.is_custom_pricing ? '' : ` / ${selectedPlan?.billing_interval || 'monthly'}`}`
                  : `Valid until ${formatDate(computed.validUntil)}`}
            </p>
            <p style={{ margin: '8px 0 0', color: '#334155', fontWeight: 800, fontSize: 13 }}>
              {computed.showUpgradeActions
                ? selectedPlanEmployeeText
                : `${computed.employeesUsed} / ${computed.employeeLimit} employees`}
            </p>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
            <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
            Loading billing details...
          </div>
        ) : (
          <>
            <BillingAlerts alerts={billingAlerts} />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                gap: 14,
                marginTop: 28,
              }}
            >
              <SummaryCard
                icon={Building2}
                label="Company"
                value={computed.companyName}
                tone="#2563eb"
              />
              <SummaryCard
                icon={CalendarClock}
                label={computed.isDemo ? 'Trial Ends On' : 'Subscription Valid Until'}
                value={computed.isLifetime ? 'Lifetime' : formatDate(computed.validUntil)}
                tone="#ea580c"
              />
              <SummaryCard
                icon={TimerReset}
                label="Validity Remaining"
                value={computed.isLifetime ? 'Lifetime' : computed.daysLeft === null ? 'Not available' : `${computed.daysLeft} day${computed.daysLeft === 1 ? '' : 's'}`}
                tone={computed.renewalDueSoon || computed.isExpired ? '#dc2626' : '#16a34a'}
              />
              <SummaryCard
                icon={Users}
                label="Employees Used"
                value={`${computed.employeesUsed} / ${computed.employeeLimit}`}
                tone="#7c3aed"
              />
              <SummaryCard
                icon={ReceiptText}
                label="Available Invoices"
                value={String(invoices.length)}
                tone="#0891b2"
              />
            </div>

            {computed.showPlanSelection ? (
              <div style={{ marginTop: 30 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 16,
                    alignItems: 'flex-end',
                    flexWrap: 'wrap',
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, color: '#0f172a' }}>
                      {computed.renewalDueSoon ? 'Renew or change your subscription' : 'Select a subscription plan'}
                    </h2>
                    <p style={{ margin: '6px 0 0', color: '#64748b' }}>
                      Essential and Growth use direct Razorpay payment. Premium is opened only after Superadmin sends a quotation.
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 18,
                  }}
                >
                  {plans.map((plan) => {
                    const code = plan.plan_code || plan.code;

                    return (
                      <PricingPlanCard
                        key={code}
                        plan={plan}
                        selected={code === selectedPlanCode}
                        disabled={computed.isLifetime || creatingOrder || verifyingPayment || submittingPremiumRequest}
                        onSelect={handleSelectPlan}
                      />
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 18,
                marginTop: 26,
              }}
            >
              <div
                style={{
                  borderRadius: 24,
                  padding: 22,
                  background: '#ffffff',
                  border: '1px solid rgba(226,232,240,0.9)',
                }}
              >
                <h3
                  style={{
                    margin: '0 0 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    color: '#0f172a',
                  }}
                >
                  <ShieldCheck size={22} color="#2563eb" />
                  Current Access
                </h3>

                {computed.isLifetime ? (
                  <p style={{ margin: 0, color: '#166534', lineHeight: 1.7 }}>
                    This is the SDS lifetime company. It has full HRMS access
                    without recharge, renewal, or subscription payment.
                  </p>
                ) : computed.isPaid ? (
                  <p style={{ margin: 0, color: '#166534', lineHeight: 1.7 }}>
                    This company has active paid access until{' '}
                    <strong>{formatDate(computed.validUntil)}</strong>.{' '}
                    <strong>{computed.daysLeft ?? 'An unavailable number of'} day(s)</strong> remain.
                    Upgrade and payment controls stay hidden until the renewal window opens.
                  </p>
                ) : computed.isExpired ? (
                  <p style={{ margin: 0, color: '#991b1b', lineHeight: 1.7 }}>
                    Subscription or trial access is expired or suspended. Please renew or
                    subscribe to continue using YourComate HRMS.
                  </p>
                ) : (
                  <p style={{ margin: 0, color: '#475569', lineHeight: 1.7 }}>
                    15-day full-access trial is active. Days left:{' '}
                    <strong>{computed.daysLeft ?? 'Not available'}</strong>.
                    All HRMS modules remain available until trial expiry.
                  </p>
                )}
              </div>

              <div
                style={{
                  borderRadius: 24,
                  padding: 22,
                  background: '#ffffff',
                  border: '1px solid rgba(226,232,240,0.9)',
                }}
              >
                <h3
                  style={{
                    margin: '0 0 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    color: '#0f172a',
                  }}
                >
                  <Sparkles size={22} color="#7c3aed" />
                  After Payment
                </h3>

                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    color: '#475569',
                    lineHeight: 1.85,
                  }}
                >
                  <li>Trial company becomes official paid company</li>
                  <li>Full HRMS access continues after trial expiry</li>
                  <li>Employee limit applies according to selected plan</li>
                  <li>Payment record appears in Superadmin monitoring</li>
                </ul>
              </div>
            </div>

            <InvoiceHistory
              invoices={invoices}
              downloadingInvoiceId={downloadingInvoiceId}
              onDownload={downloadInvoice}
            />

            {hasPremiumQuotation && computed.showPaymentActions ? (
              <PremiumQuotationPanel
                quotation={premiumQuotation}
                onPay={startPremiumQuotationPayment}
                creatingOrder={creatingOrder}
                verifyingPayment={verifyingPayment}
                paymentDisabled={premiumPaymentDisabled}
                paymentDisabledReason={premiumPaymentDisabledReason}
                isRenewal={premiumNeedsRenewal}
              />
            ) : null}

            <div
              style={{
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
                alignItems: 'center',
                marginTop: 28,
              }}
            >
              {computed.showPaymentActions ? (
                <button
                  type="button"
                  className="primary"
                  onClick={startRazorpayPayment}
                  disabled={
                    creatingOrder ||
                    verifyingPayment ||
                    submittingPremiumRequest ||
                    computed.isLifetime
                  }
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 46,
                  }}
                >
                  {creatingOrder || verifyingPayment || submittingPremiumRequest ? (
                    <Loader2 size={18} className="spin" />
                  ) : selectedPremiumCanPay ? (
                    <CreditCard size={18} />
                  ) : isCustomSelected ? (
                    <Users size={18} />
                  ) : (
                    <CreditCard size={18} />
                  )}
                  {verifyingPayment
                    ? 'Verifying Payment...'
                    : creatingOrder
                      ? 'Opening Razorpay...'
                      : submittingPremiumRequest
                        ? 'Submitting Request...'
                        : selectedPremiumCanPay
                          ? premiumNeedsRenewal
                            ? 'Pay Premium Renewal'
                            : 'Pay Premium Quotation'
                          : isCustomSelected
                            ? 'Contact Sales Team'
                            : computed.renewalDueSoon
                              ? `Renew ${selectedPlan?.display_name || selectedPlan?.plan_name || 'Subscription'}`
                              : `Pay for ${selectedPlan?.display_name || selectedPlan?.plan_name || 'Selected Plan'}`}
                </button>
              ) : null}

              <button
                type="button"
                className="ghost"
                onClick={loadBillingSummary}
                disabled={loading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: 46,
                }}
              >
                <RefreshCw size={18} className={loading ? 'spin' : ''} />
                Refresh Status
              </button>

              <button
                type="button"
                className="ghost"
                onClick={goBack}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: 46,
                }}
              >
                <ArrowLeft size={18} />
                Back to Dashboard
              </button>
            </div>

            {computed.showUpgradeActions && showSalesContact && isCustomSelected ? (
              <div
                style={{
                  marginTop: 22,
                  padding: 22,
                  borderRadius: 22,
                  background:
                    'linear-gradient(135deg, rgba(236,253,245,0.96), rgba(239,246,255,0.96))',
                  border: '1px solid rgba(37,99,235,0.2)',
                  boxShadow: '0 18px 45px rgba(15,23,42,0.07)',
                }}
              >
                <h3
                  style={{
                    margin: '0 0 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    color: '#0f172a',
                  }}
                >
                  <Users size={22} color="#2563eb" />
                  Premium custom plan request
                </h3>

                <p style={{ margin: 0, color: '#475569', lineHeight: 1.7 }}>
                  Premium is quote-based and does not open Razorpay directly.
                  Fill this request form and submit it to Superadmin/Sales for quotation follow-up.
                </p>

                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    borderRadius: 16,
                    background: '#eff6ff',
                    border: '1px solid rgba(37,99,235,0.2)',
                    color: '#1e3a8a',
                    fontWeight: 800,
                    lineHeight: 1.6,
                  }}
                >
                  Our sales team will connect with you within 24 hours after you submit this request.
                </div>

                {premiumRequestResult ? (
                  <div
                    style={{
                      marginTop: 18,
                      padding: 16,
                      borderRadius: 18,
                      background: '#f0fdf4',
                      border: '1px solid rgba(22,163,74,0.25)',
                      color: '#166534',
                    }}
                  >
                    <strong>Premium request submitted successfully.</strong>
                    <p style={{ margin: '8px 0 0', lineHeight: 1.65 }}>
                      Reference:{' '}
                      <strong>
                        {premiumRequestResult.request_reference ||
                          premiumRequestResult.request_id ||
                          'Created'}
                      </strong>
                    </p>
                    <p style={{ margin: '8px 0 0', lineHeight: 1.65 }}>
                      Our sales team will connect with you within 24 hours. Superadmin/Sales can now view this request from the Premium Requests page.
                    </p>
                  </div>
                ) : null}

                <form onSubmit={submitPremiumRequest} style={{ marginTop: 20 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: 14,
                    }}
                  >
                    <label style={{ display: 'grid', gap: 7 }}>
                      <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
                        Contact Person Name *
                      </span>
                      <input
                        type="text"
                        value={premiumForm.contact_name}
                        onChange={(event) =>
                          handlePremiumFormChange('contact_name', event.target.value)
                        }
                        placeholder="Enter contact person name"
                        style={{
                          minHeight: 44,
                          borderRadius: 14,
                          border: '1px solid #cbd5e1',
                          padding: '0 14px',
                          outline: 'none',
                        }}
                      />
                    </label>

                    <label style={{ display: 'grid', gap: 7 }}>
                      <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
                        Contact Email *
                      </span>
                      <input
                        type="email"
                        value={premiumForm.contact_email}
                        onChange={(event) =>
                          handlePremiumFormChange('contact_email', event.target.value)
                        }
                        placeholder="Enter contact email"
                        style={{
                          minHeight: 44,
                          borderRadius: 14,
                          border: '1px solid #cbd5e1',
                          padding: '0 14px',
                          outline: 'none',
                        }}
                      />
                    </label>

                    <label style={{ display: 'grid', gap: 7 }}>
                      <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
                        Registered Company Email
                      </span>
                      <input
                        type="email"
                        value={premiumForm.company_email}
                        onChange={(event) =>
                          handlePremiumFormChange('company_email', event.target.value)
                        }
                        placeholder="Registered company email"
                        style={{
                          minHeight: 44,
                          borderRadius: 14,
                          border: '1px solid #cbd5e1',
                          padding: '0 14px',
                          outline: 'none',
                        }}
                      />
                    </label>

                    <label style={{ display: 'grid', gap: 7 }}>
                      <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
                        Contact Phone
                      </span>
                      <input
                        type="tel"
                        value={premiumForm.contact_phone}
                        onChange={(event) =>
                          handlePremiumFormChange('contact_phone', event.target.value)
                        }
                        placeholder="Enter phone number"
                        style={{
                          minHeight: 44,
                          borderRadius: 14,
                          border: '1px solid #cbd5e1',
                          padding: '0 14px',
                          outline: 'none',
                        }}
                      />
                    </label>

                    <label style={{ display: 'grid', gap: 7 }}>
                      <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
                        Estimated Employee Count *
                      </span>
                      <input
                        type="number"
                        min="1"
                        value={premiumForm.employee_count}
                        onChange={(event) =>
                          handlePremiumFormChange('employee_count', event.target.value)
                        }
                        placeholder="Example: 250"
                        style={{
                          minHeight: 44,
                          borderRadius: 14,
                          border: '1px solid #cbd5e1',
                          padding: '0 14px',
                          outline: 'none',
                        }}
                      />
                    </label>

                    <label style={{ display: 'grid', gap: 7 }}>
                      <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
                        Onboarding Required?
                      </span>
                      <select
                        value={premiumForm.onboarding_required}
                        onChange={(event) =>
                          handlePremiumFormChange('onboarding_required', event.target.value)
                        }
                        style={{
                          minHeight: 44,
                          borderRadius: 14,
                          border: '1px solid #cbd5e1',
                          padding: '0 14px',
                          outline: 'none',
                          background: '#ffffff',
                        }}
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                        <option value="Need discussion">Need discussion</option>
                      </select>
                    </label>

                    <label style={{ display: 'grid', gap: 7 }}>
                      <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
                        Training Required?
                      </span>
                      <select
                        value={premiumForm.training_required}
                        onChange={(event) =>
                          handlePremiumFormChange('training_required', event.target.value)
                        }
                        style={{
                          minHeight: 44,
                          borderRadius: 14,
                          border: '1px solid #cbd5e1',
                          padding: '0 14px',
                          outline: 'none',
                          background: '#ffffff',
                        }}
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                        <option value="Need discussion">Need discussion</option>
                      </select>
                    </label>
                  </div>

                  <label style={{ display: 'grid', gap: 7, marginTop: 14 }}>
                    <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
                      Custom Modules / Requirements
                    </span>
                    <textarea
                      value={premiumForm.custom_modules}
                      onChange={(event) =>
                        handlePremiumFormChange('custom_modules', event.target.value)
                      }
                      placeholder="Example: custom reports, payroll rule changes, approval workflow, API integration, data migration..."
                      rows={3}
                      style={{
                        borderRadius: 14,
                        border: '1px solid #cbd5e1',
                        padding: 14,
                        outline: 'none',
                        resize: 'vertical',
                      }}
                    />
                  </label>

                  <label style={{ display: 'grid', gap: 7, marginTop: 14 }}>
                    <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
                      Support / SLA Requirement
                    </span>
                    <select
                      value={premiumForm.support_sla}
                      onChange={(event) =>
                        handlePremiumFormChange('support_sla', event.target.value)
                      }
                      style={{
                        minHeight: 44,
                        borderRadius: 14,
                        border: '1px solid #cbd5e1',
                        padding: '0 14px',
                        outline: 'none',
                        background: '#ffffff',
                      }}
                    >
                      <option value="Standard business support">Standard business support</option>
                      <option value="Premium / enterprise support discussion required">
                        Premium / enterprise support discussion required
                      </option>
                      <option value="Priority support with faster response">
                        Priority support with faster response
                      </option>
                      <option value="Dedicated support / SLA required">
                        Dedicated support / SLA required
                      </option>
                    </select>
                  </label>

                  <label style={{ display: 'grid', gap: 7, marginTop: 14 }}>
                    <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
                      Message / Notes
                    </span>
                    <textarea
                      value={premiumForm.message}
                      onChange={(event) =>
                        handlePremiumFormChange('message', event.target.value)
                      }
                      placeholder="Add any additional Premium plan requirement..."
                      rows={3}
                      style={{
                        borderRadius: 14,
                        border: '1px solid #cbd5e1',
                        padding: 14,
                        outline: 'none',
                        resize: 'vertical',
                      }}
                    />
                  </label>

                  <div
                    style={{
                      display: 'flex',
                      gap: 12,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      marginTop: 18,
                    }}
                  >
                    <button
                      type="submit"
                      className="primary"
                      disabled={submittingPremiumRequest}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 10,
                        minHeight: 44,
                      }}
                    >
                      {submittingPremiumRequest ? (
                        <Loader2 size={18} className="spin" />
                      ) : (
                        <Users size={18} />
                      )}
                      {submittingPremiumRequest
                        ? 'Submitting Premium Request...'
                        : 'Submit Premium Request'}
                    </button>

                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setShowSalesContact(false);
                        setPremiumRequestResult(null);
                      }}
                      disabled={submittingPremiumRequest}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 10,
                        minHeight: 44,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>

                <div
                  style={{
                    marginTop: 18,
                    padding: 16,
                    borderRadius: 18,
                    background: '#ffffff',
                    border: '1px solid rgba(226,232,240,0.9)',
                    color: '#475569',
                    lineHeight: 1.75,
                  }}
                >
                  <strong style={{ color: '#0f172a' }}>What happens next?</strong>
                  <ol style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                    <li>Request appears in the Superadmin Premium Requests page.</li>
                    <li>SDS/Sales discusses employee count, onboarding, training and custom needs.</li>
                    <li>Superadmin sends the custom amount, interval and payment due date.</li>
                    <li>The quotation appears here with a Pay Premium Quotation button.</li>
                    <li>Successful Razorpay payment activates Premium automatically.</li>
                  </ol>
                </div>
              </div>
            ) : null}

            {computed.showUpgradeActions && !computed.isLifetime ? (
              <div
                style={{
                  marginTop: 22,
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
                  {isCustomSelected
                    ? 'Premium is custom quoted. Once Superadmin sends the quotation, the payment details will appear above and the finalized amount will be used for monthly/yearly renewal until Superadmin revises it.'
                    : 'Razorpay test mode can be used with test payment details. Essential/Growth renewals will use the latest active price configured by Superadmin.'}
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}