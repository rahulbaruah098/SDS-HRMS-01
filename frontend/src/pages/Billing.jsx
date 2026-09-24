import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  Loader2,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
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


const BILLING_NOTICE_HIDE_MS = 3600;
const BILLING_INVOICE_PAGE_SIZES = [10, 25, 50, 100];

function billingPageNumbers(pageCount, page) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const current = Math.max(1, Math.min(pageCount, page));
  const pages = new Set([1, pageCount, current]);

  if (current > 2) pages.add(current - 1);
  if (current < pageCount - 1) pages.add(current + 1);

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const output = [];

  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];

    if (index > 0 && value - previous > 1) {
      output.push(`ellipsis-${previous}-${value}`);
    }

    output.push(value);
  });

  return output;
}

function BillingInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`billing-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="billing-inline-feedback-icon">
        {message.loading ? (
          <Loader2 size={15} className="spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <AlertTriangle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="billing-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="billing-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function BillingPagination({
  total,
  page,
  pageSize,
  onPageChange,
}) {
  const pageCount = Math.max(
    1,
    Math.ceil(Number(total || 0) / Math.max(1, Number(pageSize || 10))),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);

  if (!total) return null;

  return (
    <div className="billing-pagination">
      <div className="billing-pagination-controls">
        <button
          type="button"
          className="billing-page-button billing-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="billing-page-numbers" aria-label="Pagination">
          {billingPageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`billing-page-number ${
                  item === safePage ? 'is-active' : ''
                }`}
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span className="billing-page-ellipsis" key={item}>
                …
              </span>
            ),
          )}
        </div>

        <span className="billing-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="billing-page-button billing-page-nav"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

function BillingAlerts({ alerts = [] }) {
  if (!alerts.length) {
    return null;
  }

  return (
    <div className="billing-alert-list">
      {alerts.map((alert, index) => {
        const level = normalizeStatus(alert.level || alert.type || 'info');
        const Icon =
          level === 'success'
            ? CheckCircle2
            : level === 'info'
              ? BellRing
              : AlertTriangle;

        return (
          <div
            key={alert.code || `${level}-${index}`}
            className={`billing-alert-item ${level}`}
            role={level === 'error' ? 'alert' : 'status'}
          >
            <Icon size={19} />
            <div>
              <strong>{safeText(alert.title, 'Billing notice')}</strong>
              <p>{safeText(alert.message)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InvoiceHistory({
  invoices = [],
  downloadingInvoiceId = '',
  onDownload,
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredInvoices = useMemo(() => {
    const term = query.trim().toLowerCase();

    if (!term) return invoices;

    return invoices.filter((invoice) =>
      [
        invoice.invoice_number,
        invoice.receipt_number,
        invoice.razorpay_payment_id,
        invoice.razorpay_order_id,
        invoicePlan(invoice),
        formatDate(invoiceDate(invoice)),
        invoiceStatus(invoice),
        invoiceAmount(invoice),
      ]
        .filter((value) => value !== undefined && value !== null)
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [invoices, query]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredInvoices.length / Math.max(1, pageSize)),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedInvoices = filteredInvoices.slice(
    pageStart,
    pageStart + pageSize,
  );

  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return (
    <section className="billing-invoice-history">
      <div className="billing-section-head">
        <div>
          <span className="billing-section-kicker">
            <ReceiptText size={14} />
            Invoice History
          </span>
          <h2>Invoices and payment history</h2>
          <p>
            Review payment status and download your company subscription
            invoices.
          </p>
        </div>

        <span className="billing-count-badge">
          {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="billing-invoice-controls">
        <label className="billing-search-box">
          <Search size={17} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search invoice, plan, payment ID or status..."
            aria-label="Search invoices"
          />
        </label>

        <div className="billing-view-control">
          <span>
            {filteredInvoices.length.toLocaleString('en-IN')} record
            {filteredInvoices.length === 1 ? '' : 's'}
          </span>

          <label className="billing-page-size">
            <span>View</span>
            <select
              value={pageSize}
              onChange={(event) =>
                setPageSize(Number(event.target.value))
              }
              aria-label="Invoices per page"
            >
              {BILLING_INVOICE_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {!filteredInvoices.length ? (
        <div className="billing-empty">
          <FileText size={28} />
          <p>
            {query
              ? 'No matching invoice or payment record found.'
              : 'No subscription invoice has been generated yet. Paid invoices will appear here automatically.'}
          </p>
        </div>
      ) : (
        <>
          <div className="billing-invoice-list">
            {pagedInvoices.map((invoice, index) => {
              const originalIndex = pageStart + index;
              const id = invoiceId(invoice, originalIndex);
              const status = invoiceStatus(invoice);
              const downloadUrl = safeText(invoice.download_url, '');
              const downloading = downloadingInvoiceId === id;

              return (
                <article className="billing-invoice-row" key={id}>
                  <div className="billing-invoice-primary">
                    <strong>
                      {safeText(
                        invoice.invoice_number || invoice.receipt_number,
                        'Payment invoice',
                      )}
                    </strong>
                    <span>
                      {safeText(
                        invoice.razorpay_payment_id ||
                          invoice.razorpay_order_id,
                        'Recorded payment',
                      )}
                    </span>
                  </div>

                  <div className="billing-invoice-field">
                    <span>Plan</span>
                    <strong>{invoicePlan(invoice)}</strong>
                  </div>

                  <div className="billing-invoice-field">
                    <span>Paid on</span>
                    <strong>{formatDate(invoiceDate(invoice))}</strong>
                  </div>

                  <div className="billing-invoice-field">
                    <span>Amount</span>
                    <strong>
                      {formatCurrency(
                        invoiceAmount(invoice),
                        invoice.currency || 'INR',
                      )}
                    </strong>
                  </div>

                  <div className="billing-invoice-actions">
                    <span
                      className={`billing-status-pill ${normalizeStatus(
                        status,
                      )}`}
                    >
                      {safeText(status).replaceAll('_', ' ')}
                    </span>

                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onDownload(invoice, originalIndex)}
                      disabled={!downloadUrl || downloading}
                    >
                      {downloading ? (
                        <Loader2 size={16} className="spin" />
                      ) : (
                        <Download size={16} />
                      )}
                      {downloading ? 'Downloading...' : 'Download PDF'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <BillingPagination
            total={filteredInvoices.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </>
      )}
    </section>
  );
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

  return (
    <span
      className={`billing-status-badge ${
        isPositive ? 'positive' : isNegative ? 'negative' : 'warning'
      }`}
    >
      {isPositive ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {safeText(planType, 'Plan')} · {safeText(status, 'Status')}
    </span>
  );
}

function SummaryCard({ label, value }) {
  return (
    <article className="billing-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function PricingPlanCard({
  plan,
  selected,
  disabled,
  onSelect,
}) {
  const planCode = plan.plan_code || plan.code || '';
  const planName = plan.display_name || plan.plan_name || planCode;
  const amount = toNumber(plan.amount, 0);
  const currency = plan.currency || 'INR';
  const interval = plan.billing_interval || 'monthly';
  const isCustom = Boolean(plan.is_custom_pricing);
  const allowOnlinePayment =
    plan.allow_online_payment !== false && !isCustom;
  const employeeText = plan.is_unlimited_employees
    ? 'Unlimited employees'
    : `Up to ${
        plan.employee_limit || plan.included_employees || 0
      } employees`;

  return (
    <button
      className={`billing-plan-card ${
        selected ? 'selected' : ''
      }`}
      type="button"
      onClick={() => onSelect(planCode)}
      disabled={disabled}
    >
      <div className="billing-plan-head">
        <h3>{planName}</h3>

        {plan.is_recommended ? (
          <span className="billing-recommended-badge">
            Recommended
          </span>
        ) : null}
      </div>

      <p className="billing-plan-description">
        {safeText(plan.description, 'Full HRMS subscription plan.')}
      </p>

      <div className="billing-plan-price">
        <strong>
          {isCustom ? 'Custom' : formatCurrency(amount, currency)}
        </strong>
        <span>
          {isCustom ? 'Contact Sales Team' : `per ${interval}`}
        </span>
      </div>

      <div className="billing-plan-employee">
        <Users size={17} />
        {employeeText}
      </div>

      <ul className="billing-plan-features">
        {(plan.features || []).slice(0, 5).map((feature) => (
          <li key={`${planCode}-${feature}`}>{feature}</li>
        ))}
      </ul>

      <div className="billing-plan-state">
        {selected ? (
          <>
            <CheckCircle2 size={18} />
            <span>Selected</span>
          </>
        ) : allowOnlinePayment ? (
          <>
            <CreditCard size={18} />
            <span>Select plan</span>
          </>
        ) : (
          <>
            <AlertTriangle size={18} />
            <span>Custom plan</span>
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
  const currency =
    quotation.quoted_currency || quotation.currency || 'INR';
  const interval =
    quotation.quoted_billing_interval ||
    quotation.billing_interval ||
    'monthly';
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
    <section className="billing-premium-quotation">
      <div className="billing-section-head">
        <div>
          <span className="billing-section-kicker success">
            <ShieldCheck size={14} />
            Premium Quotation
          </span>

          <h2>
            {isRenewal
              ? 'Premium renewal payment is ready'
              : 'Premium payment details are ready'}
          </h2>

          <p>
            Review the quotation amount, billing interval and payment due
            date below. Pay through Razorpay to{' '}
            {isRenewal ? 'renew' : 'activate'} Premium access.
          </p>
        </div>

        <span className="billing-count-badge">
          <CheckCircle2 size={14} />
          {safeText(status).replaceAll('_', ' ')}
        </span>
      </div>

      <div className="billing-quote-summary-grid">
        <SummaryCard
          label="Quoted / Renewal Amount"
          value={formatCurrency(amount, currency)}
        />
        <SummaryCard
          label="Billing Interval"
          value={formatBillingInterval(interval)}
        />
        <SummaryCard
          label="Employee Limit"
          value={employeeLimitText(quotation.quoted_employee_limit)}
        />
        <SummaryCard
          label="Payment Due Date"
          value={formatDate(quotation.payment_due_date)}
        />
      </div>

      <div className="billing-quotation-details">
        <div>
          <strong>Quotation Reference</strong>
          <p>{safeText(reference)}</p>

          <strong>Valid Until</strong>
          <p>{formatDate(quotation.quotation_valid_until)}</p>
        </div>

        <div>
          <strong>Premium Renewal Rule</strong>
          <p>
            The finalized quotation amount remains the recurring
            monthly/yearly renewal amount until Superadmin revises the
            quotation.
          </p>
        </div>
      </div>

      {quotation.sales_note ? (
        <div className="billing-sales-note">
          <strong>Sales Note</strong>
          <p>{quotation.sales_note}</p>
        </div>
      ) : null}

      <div className="billing-payment-row">
        <button
          type="button"
          className="primary"
          onClick={onPay}
          disabled={paymentDisabled || busy}
        >
          {busy ? (
            <Loader2 size={18} className="spin" />
          ) : (
            <CreditCard size={18} />
          )}
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
          >
            <CreditCard size={18} />
            Open Supplied Payment Link
          </a>
        ) : null}

        <span
          className={
            paymentDisabled
              ? 'billing-payment-help warning'
              : 'billing-payment-help'
          }
        >
          {paymentDisabledReason ||
            `After successful payment, Premium access will be ${
              isRenewal ? 'renewed' : 'activated'
            } automatically.`}
        </span>
      </div>

      {history.length ? (
        <div className="billing-quotation-history">
          <strong>Quotation / Invoice History</strong>

          <div className="billing-quotation-history-list">
            {history.map((item, index) => (
              <div
                className="billing-quotation-history-row"
                key={`${item.history_type}-${
                  item.history_date || index
                }-${
                  item.payment_id ||
                  item.quotation_reference ||
                  index
                }`}
              >
                <span>
                  <strong>Type:</strong> {item.history_type}
                </span>
                <span>
                  <strong>Date:</strong>{' '}
                  {formatDate(item.history_date)}
                </span>
                <span>
                  <strong>Amount:</strong>{' '}
                  {formatCurrency(
                    item.history_amount,
                    item.history_currency || currency,
                  )}
                </span>
                <span>
                  <strong>Interval:</strong>{' '}
                  {formatBillingInterval(
                    item.history_interval || interval,
                  )}
                </span>
                <span>
                  <strong>Status:</strong>{' '}
                  {safeText(
                    item.status ||
                      item.payment_status ||
                      item.quotation_status,
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
  const [activeSection, setActiveSection] = useState('overview');
  const [feedbackMap, setFeedbackMap] = useState({});
  const feedbackTimersRef = useRef({});
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

  function clearFeedback(scopeKey) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scopeKey)) {
        return current;
      }

      const next = { ...current };
      delete next[scopeKey];
      return next;
    });
  }

  function showFeedback(
    scopeKey,
    type,
    text,
    title = '',
    options = {},
  ) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => ({
      ...current,
      [scopeKey]: {
        type,
        text,
        title,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      feedbackTimersRef.current[scopeKey] = window.setTimeout(() => {
        setFeedbackMap((current) => {
          const next = { ...current };
          delete next[scopeKey];
          return next;
        });

        delete feedbackTimersRef.current[scopeKey];
      }, BILLING_NOTICE_HIDE_MS);
    }
  }

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

  async function loadBillingSummary({ feedbackScope = '' } = {}) {
    setLoading(true);

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        'Refreshing billing and subscription details...',
        'Refreshing',
        { loading: true },
      );
    }

    try {
      const data = await api('/billing/summary');
      setSummary(data);

      const defaultCode = getDefaultPlanCode(data);
      const availablePlans = getPlans(data);
      const firstOnlinePlan =
        availablePlans.find(
          (plan) =>
            plan.allow_online_payment !== false &&
            !plan.is_custom_pricing,
        ) || availablePlans[0];

      const visiblePremiumQuotation = hasVisiblePremiumQuotation(data);

      setSelectedPlanCode(
        visiblePremiumQuotation
          ? 'premium'
          : defaultCode ||
              firstOnlinePlan?.plan_code ||
              firstOnlinePlan?.code ||
              'growth',
      );

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          'Billing and subscription details are up to date.',
          'Refresh Complete',
        );
      }

      return true;
    } catch (error) {
      const errorMessage = error.message || 'Please try again.';

      showAlert({
        title: 'Unable to load billing details',
        message: errorMessage,
        type: 'error',
      });

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'error',
          errorMessage,
          'Refresh Failed',
        );
      }

      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBillingSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function dismissFeedback(event) {
      if (event.target?.closest?.('.billing-inline-feedback')) return;

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
      setFeedbackMap({});
    }

    document.addEventListener('pointerdown', dismissFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissFeedback);

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
    };
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
    clearFeedback('premium-request');
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
    clearFeedback('premium-request');

    if (!selectedPlan) {
      showFeedback(
        'premium-request',
        'warning',
        'Please select Premium before submitting the request.',
        'Select Premium Plan',
      );
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
      showFeedback(
        'premium-request',
        'warning',
        'Please enter the contact person name.',
        'Contact Name Required',
      );
      showAlert({
        title: 'Contact name required',
        message: 'Please enter the contact person name.',
        type: 'warning',
      });
      return;
    }

    if (!contactEmail) {
      showFeedback(
        'premium-request',
        'warning',
        'Please enter the contact email.',
        'Contact Email Required',
      );
      showAlert({
        title: 'Contact email required',
        message: 'Please enter the contact email.',
        type: 'warning',
      });
      return;
    }

    if (!Number.isFinite(employeeCount) || employeeCount <= 0) {
      showFeedback(
        'premium-request',
        'warning',
        'Please enter the estimated employee count for Premium pricing.',
        'Employee Count Required',
      );
      showAlert({
        title: 'Employee count required',
        message: 'Please enter the estimated employee count for Premium pricing.',
        type: 'warning',
      });
      return;
    }

    setSubmittingPremiumRequest(true);
    showFeedback(
      'premium-request',
      'info',
      'Submitting Premium custom plan request...',
      'Submitting Request',
      { loading: true },
    );

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

      const successMessage =
        data.message ||
        'Premium request submitted successfully. Our sales team will connect with you within 24 hours.';

      showFeedback(
        'premium-request',
        'success',
        successMessage,
        'Premium Request Submitted',
      );

      showAlert({
        title: 'Premium request submitted',
        message: successMessage,
        type: 'success',
      });
    } catch (error) {
      const errorMessage =
        error.message ||
        'Please check the details and try again.';

      showFeedback(
        'premium-request',
        'error',
        errorMessage,
        'Premium Request Failed',
      );

      showAlert({
        title: 'Unable to submit Premium request',
        message: errorMessage,
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
    showFeedback(
      'payment',
      'info',
      'Verifying the completed Razorpay payment...',
      'Verifying Payment',
      { loading: true },
    );

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

      const successTitle =
        normalizeStatus(verifiedPlanCode) === 'premium'
          ? 'Premium Plan Activated'
          : 'Subscription Activated';
      const successMessage =
        data.message ||
        'Payment verified successfully. Full HRMS access is now unlocked.';

      showFeedback(
        'payment',
        'success',
        successMessage,
        successTitle,
      );

      showAlert({
        title: successTitle,
        message: successMessage,
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
      const errorMessage =
        error.message ||
        'Payment was received but verification failed. Please contact the sales/support team.';

      showFeedback(
        'payment',
        'error',
        errorMessage,
        'Payment Verification Failed',
      );

      showAlert({
        title: 'Payment verification failed',
        message: errorMessage,
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
    showFeedback(
      'payment',
      'info',
      'Preparing the Razorpay checkout...',
      'Opening Razorpay',
      { loading: true },
    );

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
            showFeedback(
              'payment',
              'info',
              'The Razorpay payment window was closed before payment completion.',
              'Payment Cancelled',
            );
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
        const failureMessage =
          response?.error?.description ||
          'Razorpay payment failed. Please try again.';

        showFeedback(
          'payment',
          'error',
          failureMessage,
          'Payment Failed',
        );

        showAlert({
          title: 'Payment failed',
          message: failureMessage,
          type: 'error',
        });
      });

      checkout.open();

      showFeedback(
        'payment',
        'info',
        'Complete the payment in the Razorpay checkout window.',
        'Razorpay Opened',
      );
    } catch (error) {
      const errorMessage = error.message || 'Please try again.';

      showFeedback(
        'payment',
        'error',
        errorMessage,
        'Unable to Start Payment',
      );

      showAlert({
        title: 'Unable to start payment',
        message: errorMessage,
        type: 'error',
      });
    } finally {
      setCreatingOrder(false);
    }
  }

  async function startPremiumQuotationPayment() {
    clearFeedback('payment');

    if (computed.isLifetime) {
      showFeedback(
        'payment',
        'info',
        'SDS lifetime company does not require payment.',
        'Lifetime Access Enabled',
      );
      showAlert({
        title: 'Lifetime access enabled',
        message: 'SDS lifetime company does not require payment.',
        type: 'info',
      });
      return;
    }

    if (!hasPremiumQuotation) {
      showFeedback(
        'payment',
        'warning',
        'Submit a Premium request and wait for Superadmin to release the quotation.',
        'Premium Quotation Unavailable',
      );
      showAlert({
        title: 'Premium quotation unavailable',
        message: 'Submit a Premium request and wait for Superadmin to release the quotation.',
        type: 'warning',
      });
      return;
    }

    if (premiumPaymentDisabled) {
      showFeedback(
        'payment',
        'warning',
        premiumPaymentDisabledReason,
        'Premium Payment Unavailable',
      );
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
    clearFeedback('payment');

    if (computed.isLifetime) {
      showFeedback(
        'payment',
        'info',
        'SDS lifetime company does not require payment.',
        'Lifetime Access Enabled',
      );
      showAlert({
        title: 'Lifetime access enabled',
        message: 'SDS lifetime company does not require payment.',
        type: 'info',
      });
      return;
    }

    if (!selectedPlan) {
      showFeedback(
        'payment',
        'warning',
        'Please select Essential, Growth, or Premium before payment.',
        'Select a Plan',
      );
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
        showFeedback(
          'payment',
          'info',
          'Complete the Premium request form below to receive a custom quotation.',
          'Premium Request Required',
        );
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
    <section className="panel billing-page">
      <style>{`
        .billing-page {
          --billing-ink: #101a3a;
          --billing-muted: #5d6d8d;
          --billing-blue: #4d77dd;
          --billing-cyan: #2eb2b9;
          --billing-violet: #575092;
          --billing-green: #047857;
          --billing-red: #a2344d;
          --billing-amber: #9a6817;

          width: min(1180px, 100%);
          min-width: 0;
          margin: 0 auto;
          overflow: visible;
          border: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          color: var(--billing-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .billing-page,
        .billing-page * {
          box-sizing: border-box;
        }

        .billing-page > *,
        .billing-page section,
        .billing-page article,
        .billing-page nav,
        .billing-page form,
        .billing-page label {
          min-width: 0;
          max-width: 100%;
        }

        .billing-page::before,
        .billing-page::after,
        .billing-page .billing-hero::before,
        .billing-page .billing-hero::after,
        .billing-page .billing-summary-card::before,
        .billing-page .billing-summary-card::after {
          content: none;
          display: none;
          background: none;
        }

        .billing-page-grid {
          width: 100%;
          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
        }

        .billing-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(245px, 330px);
          gap: clamp(20px, 3vw, 38px);
          align-items: center;
          min-height: 240px;
          padding: clamp(24px, 3vw, 40px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background:
            linear-gradient(
              90deg,
              #d3f4fb 0%,
              #f7fcfb 34%,
              #fffdf8 52%,
              #fbf8fa 68%,
              #f0edfb 100%
            );
          box-shadow: 0 22px 46px rgba(70, 92, 140, .10);
        }

        .billing-hero-copy {
          min-width: 0;
          max-width: 900px;
        }

        .billing-kicker,
        .billing-section-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .billing-kicker {
          margin-bottom: 15px;
          padding: 9px 13px;
          box-shadow: 0 8px 18px rgba(77, 119, 221, .18);
        }

        .billing-section-kicker {
          margin-bottom: 10px;
          padding: 7px 10px;
          box-shadow: 0 7px 15px rgba(77, 119, 221, .14);
        }

        .billing-section-kicker.success {
          background: linear-gradient(135deg, #269c83 0%, #2eb2b9 100%);
        }

        .billing-page h1,
        .billing-page h2,
        .billing-page h3 {
          color: var(--billing-ink);
          font-family: var(--yc-display, var(--heading), Georgia, "Times New Roman", serif);
        }

        .billing-hero h1 {
          margin: 0;
          font-size: clamp(44px, 5.2vw, 76px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .billing-hero h1 em {
          color: var(--billing-blue);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .billing-hero p {
          max-width: 820px;
          margin: 17px 0 0;
          color: var(--billing-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .billing-hero-side {
          display: grid;
          gap: 10px;
          min-width: 0;
        }

        .billing-current-card {
          padding: 17px;
          border: 1px solid rgba(77, 119, 221, .18);
          border-radius: 18px;
          background: rgba(255, 255, 255, .88);
          box-shadow: 0 12px 26px rgba(70, 92, 140, .08);
        }

        .billing-current-card > span,
        .billing-current-card > strong,
        .billing-current-card > small {
          display: block;
        }

        .billing-current-card > span {
          color: var(--billing-muted);
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .billing-current-card > strong {
          margin-top: 6px;
          color: var(--billing-ink);
          font-size: 19px;
          overflow-wrap: anywhere;
        }

        .billing-current-card > small {
          margin-top: 7px;
          color: var(--billing-muted);
          line-height: 1.45;
        }

        .billing-hero-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .billing-refresh-stack {
          grid-column: 1 / -1;
          display: grid;
          gap: 8px;
          width: 100%;
        }

        .billing-page button,
        .billing-page a.ghost {
          touch-action: manipulation;
          font: inherit;
          font-weight: 900;
        }

        .billing-page .primary,
        .billing-page .ghost {
          min-height: 44px;
          padding: 10px 15px;
          border: 1px solid transparent;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: max-content;
          line-height: 1;
          white-space: nowrap;
          cursor: pointer;
          text-decoration: none;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            filter 180ms ease,
            opacity 180ms ease;
        }

        .billing-page .primary {
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 10px 22px rgba(77, 119, 221, .18);
        }

        .billing-page .ghost {
          color: #4767b4;
          border-color: rgba(77, 119, 221, .18);
          background: #fff;
        }

        .billing-page .primary:hover:not(:disabled),
        .billing-page .ghost:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: saturate(1.03);
        }

        .billing-page button:disabled,
        .billing-page .ghost:disabled {
          opacity: .55;
          cursor: not-allowed;
          transform: none;
        }

        .billing-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-top: 12px;
          padding: 7px 11px;
          border: 1px solid rgba(154, 104, 23, .18);
          border-radius: 999px;
          color: var(--billing-amber);
          background: #fff4d5;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .04em;
        }

        .billing-status-badge.positive {
          color: var(--billing-green);
          border-color: rgba(4, 120, 87, .18);
          background: #eaf8f4;
        }

        .billing-status-badge.negative {
          color: var(--billing-red);
          border-color: rgba(162, 52, 77, .18);
          background: #fff0f2;
        }

        .billing-summary-grid,
        .billing-quote-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .billing-summary-card {
          min-width: 0;
          min-height: 120px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 0 16px 30px rgba(34, 38, 110, .07);
        }

        .billing-summary-card:nth-child(2) {
          background: #eaf8f4;
        }

        .billing-summary-card:nth-child(3) {
          background: #fff4d5;
        }

        .billing-summary-card:nth-child(4) {
          background: #f1efff;
        }

        .billing-summary-card span,
        .billing-summary-card strong {
          display: block;
        }

        .billing-summary-card span {
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .billing-summary-card strong {
          margin-top: 9px;
          overflow-wrap: anywhere;
          color: var(--billing-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(23px, 2.5vw, 36px);
          line-height: 1.08;
        }

        .billing-alert-list {
          display: grid;
          gap: 10px;
        }

        .billing-alert-item {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: start;
          padding: 13px;
          border: 1px solid rgba(77, 119, 221, .18);
          border-radius: 14px;
          color: #245da8;
          background: #edf6ff;
          box-shadow: none;
        }

        .billing-alert-item.success {
          color: var(--billing-green);
          border-color: rgba(4, 120, 87, .18);
          background: #eaf8f4;
        }

        .billing-alert-item.warning {
          color: var(--billing-amber);
          border-color: rgba(154, 104, 23, .18);
          background: #fff4d5;
        }

        .billing-alert-item.error {
          color: var(--billing-red);
          border-color: rgba(162, 52, 77, .18);
          background: #fff0f2;
        }

        .billing-alert-item strong {
          display: block;
          color: currentColor;
          font-size: 12px;
        }

        .billing-alert-item p {
          margin: 4px 0 0;
          color: var(--billing-muted);
          font-size: 11px;
          line-height: 1.5;
        }

        .billing-section-tabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
          padding: 12px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 22px;
          background: #fff;
          box-shadow: 0 16px 28px rgba(34, 38, 110, .08);
        }

        .billing-section-tab {
          min-width: 0;
          min-height: 62px;
          padding: 11px 14px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          border: 1px solid rgba(77, 119, 221, .22);
          border-radius: 16px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          text-align: left;
          font: inherit;
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .billing-section-tab:hover {
          transform: translateY(-1px);
          border-color: rgba(46, 178, 185, .42);
        }

        .billing-section-tab.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 0 8px 18px rgba(77, 119, 221, .17);
        }

        .billing-section-tab-copy {
          min-width: 0;
          display: grid;
          gap: 3px;
        }

        .billing-section-tab-copy strong {
          font-size: 12px;
          font-weight: 950;
          line-height: 1.2;
        }

        .billing-section-tab-copy small {
          color: currentColor;
          font-size: 9px;
          font-weight: 700;
          line-height: 1.35;
          opacity: .78;
        }

        .billing-section-tab-count {
          min-width: 28px;
          height: 28px;
          padding: 0 7px;
          display: inline-grid;
          place-items: center;
          border-radius: 999px;
          color: #40348d;
          background: #fff;
          font-size: 9px;
          font-weight: 950;
          white-space: nowrap;
        }

        .billing-section-content {
          display: grid;
          gap: 18px;
          animation: billingSectionReveal 220ms ease both;
        }

        @keyframes billingSectionReveal {
          from {
            opacity: 0;
            transform: translateY(5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .billing-panel,
        .billing-premium-quotation,
        .billing-invoice-history {
          padding: clamp(20px, 2.4vw, 28px);
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(24px, 2.2vw, 34px);
          background: #fff;
          box-shadow: 0 20px 38px rgba(34, 38, 110, .08);
        }

        .billing-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }

        .billing-section-head h2,
        .billing-panel h2 {
          margin: 0;
          font-size: clamp(24px, 2.4vw, 35px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .billing-section-head p,
        .billing-panel > p {
          margin: 8px 0 0;
          color: var(--billing-muted);
          font-size: 13px;
          line-height: 1.58;
        }

        .billing-overview-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .billing-overview-card {
          min-height: 100%;
        }

        .billing-overview-card p {
          margin: 12px 0 0;
          color: var(--billing-muted);
          line-height: 1.7;
        }

        .billing-overview-card p.success {
          color: var(--billing-green);
        }

        .billing-overview-card p.error {
          color: var(--billing-red);
        }

        .billing-benefit-list,
        .billing-next-list {
          margin: 15px 0 0;
          padding-left: 20px;
          color: var(--billing-muted);
          line-height: 1.8;
        }

        .billing-plan-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(245px, 1fr));
          gap: 16px;
          margin-top: 16px;
        }

        .billing-plan-card {
          position: relative;
          min-width: 0;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 20px;
          color: var(--billing-ink);
          background: #fff;
          box-shadow: 0 14px 28px rgba(34, 38, 110, .07);
          text-align: left;
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease,
            box-shadow 180ms ease;
        }

        .billing-plan-card:hover:not(:disabled) {
          transform: translateY(-2px);
          border-color: rgba(77, 119, 221, .34);
          box-shadow: 0 17px 32px rgba(34, 38, 110, .09);
        }

        .billing-plan-card.selected {
          border-color: rgba(77, 119, 221, .58);
          background: linear-gradient(145deg, #f1efff, #f7fbff);
        }

        .billing-plan-card:disabled {
          opacity: .64;
          cursor: not-allowed;
          transform: none;
        }

        .billing-plan-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .billing-plan-head h3 {
          margin: 0;
          font-size: 21px;
          font-weight: 900;
        }

        .billing-recommended-badge {
          flex: 0 0 auto;
          padding: 5px 8px;
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .billing-plan-description {
          min-height: 46px;
          margin: 9px 0 0;
          color: var(--billing-muted);
          font-size: 12px;
          line-height: 1.55;
        }

        .billing-plan-price {
          margin-top: 16px;
        }

        .billing-plan-price strong,
        .billing-plan-price span {
          display: block;
        }

        .billing-plan-price strong {
          color: var(--billing-ink);
          font-size: 28px;
          line-height: 1;
        }

        .billing-plan-price span {
          margin-top: 5px;
          color: var(--billing-muted);
          font-size: 11px;
        }

        .billing-plan-employee {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 13px;
          padding: 10px 11px;
          border-radius: 13px;
          color: #245da8;
          background: #edf6ff;
          font-size: 11px;
          font-weight: 900;
        }

        .billing-plan-features {
          margin: 14px 0 0;
          padding-left: 18px;
          color: var(--billing-muted);
          font-size: 11px;
          line-height: 1.75;
        }

        .billing-plan-state {
          display: flex;
          align-items: center;
          gap: 7px;
          margin-top: 15px;
          color: #4767b4;
          font-size: 11px;
          font-weight: 900;
        }

        .billing-premium-quotation {
          background: linear-gradient(145deg, #f4fbf8, #fff);
        }

        .billing-count-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 10px;
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .billing-quote-summary-grid {
          margin-top: 18px;
        }

        .billing-quotation-details {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-top: 16px;
        }

        .billing-quotation-details > div,
        .billing-sales-note,
        .billing-quotation-history {
          padding: 15px;
          border: 1px solid rgba(171, 181, 211, .54);
          border-radius: 16px;
          background: #fff;
        }

        .billing-quotation-details strong,
        .billing-sales-note strong,
        .billing-quotation-history > strong {
          color: var(--billing-ink);
        }

        .billing-quotation-details p,
        .billing-sales-note p {
          margin: 6px 0 0;
          color: var(--billing-muted);
          font-size: 12px;
          line-height: 1.55;
        }

        .billing-quotation-details > div strong:not(:first-child) {
          display: block;
          margin-top: 12px;
        }

        .billing-sales-note {
          margin-top: 14px;
        }

        .billing-sales-note p {
          white-space: pre-wrap;
        }

        .billing-payment-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 16px;
        }

        .billing-payment-help {
          flex: 1 1 260px;
          color: var(--billing-muted);
          font-size: 11px;
          line-height: 1.5;
        }

        .billing-payment-help.warning {
          color: var(--billing-amber);
        }

        .billing-quotation-history {
          margin-top: 16px;
        }

        .billing-quotation-history-list {
          display: grid;
          gap: 8px;
          margin-top: 10px;
        }

        .billing-quotation-history-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
          gap: 8px;
          padding: 10px;
          border-radius: 12px;
          color: var(--billing-muted);
          background: #f8fbff;
          font-size: 11px;
        }

        .billing-quotation-history-row strong {
          color: var(--billing-ink);
        }

        .billing-action-stack {
          display: grid;
          gap: 8px;
          width: min(360px, 100%);
          margin-top: 18px;
        }

        .billing-action-stack .primary {
          justify-self: start;
        }

        .billing-premium-request {
          padding: clamp(20px, 2.4vw, 28px);
          border: 1px solid rgba(77, 119, 221, .20);
          border-radius: 24px;
          background: linear-gradient(145deg, #f4fbf8, #f7fbff);
          box-shadow: 0 18px 34px rgba(34, 38, 110, .07);
        }

        .billing-premium-request-note,
        .billing-premium-result,
        .billing-next-box,
        .billing-payment-note {
          margin-top: 14px;
          padding: 13px;
          border: 1px solid rgba(77, 119, 221, .18);
          border-radius: 14px;
          color: #245da8;
          background: #edf6ff;
          font-size: 11px;
          font-weight: 800;
          line-height: 1.55;
        }

        .billing-premium-result {
          color: var(--billing-green);
          border-color: rgba(4, 120, 87, .18);
          background: #eaf8f4;
        }

        .billing-premium-result p {
          margin: 6px 0 0;
          color: currentColor;
        }

        .billing-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
          margin-top: 18px;
        }

        .billing-field {
          display: grid;
          gap: 7px;
        }

        .billing-field.full {
          grid-column: 1 / -1;
        }

        .billing-field > span {
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .billing-field input,
        .billing-field select,
        .billing-field textarea,
        .billing-search-box input,
        .billing-page-size select {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 14px;
          outline: 0;
          color: var(--billing-ink);
          background: rgba(255, 255, 255, .96);
          font: inherit;
        }

        .billing-field input,
        .billing-field select {
          min-height: 44px;
          padding: 0 13px;
        }

        .billing-field textarea {
          min-height: 105px;
          padding: 12px 13px;
          resize: vertical;
        }

        .billing-field input:focus,
        .billing-field select:focus,
        .billing-field textarea:focus,
        .billing-search-box input:focus,
        .billing-page-size select:focus {
          border-color: rgba(77, 119, 221, .65);
          box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
        }

        .billing-form-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 16px;
        }

        .billing-next-box {
          color: var(--billing-muted);
          background: #fff;
        }

        .billing-next-box strong {
          color: var(--billing-ink);
        }

        .billing-next-list {
          margin-top: 8px;
        }

        .billing-payment-note {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          color: #245da8;
        }

        .billing-invoice-history {
          min-width: 0;
        }

        .billing-invoice-controls {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) auto;
          gap: 12px;
          align-items: center;
          margin-top: 18px;
        }

        .billing-search-box {
          position: relative;
          min-width: 0;
          display: block;
        }

        .billing-search-box > svg {
          position: absolute;
          top: 50%;
          left: 13px;
          color: var(--billing-blue);
          transform: translateY(-50%);
          pointer-events: none;
        }

        .billing-search-box input {
          min-height: 46px;
          padding: 0 13px 0 39px;
          font-size: 13px;
        }

        .billing-view-control {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }

        .billing-view-control > span {
          color: var(--billing-muted);
          font-size: 10px;
          font-weight: 850;
          white-space: nowrap;
        }

        .billing-page-size {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--billing-muted);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .billing-page-size select {
          width: auto;
          min-width: 78px;
          min-height: 38px;
          padding: 0 28px 0 10px;
          color: #40348d;
          background: #f1efff;
          font-size: 10px;
          font-weight: 900;
        }

        .billing-invoice-list {
          display: grid;
          gap: 10px;
          margin-top: 14px;
        }

        .billing-invoice-row {
          display: grid;
          grid-template-columns:
            minmax(180px, 1.35fr)
            repeat(3, minmax(110px, .8fr))
            minmax(190px, auto);
          gap: 12px;
          align-items: center;
          padding: 14px;
          border: 1px solid rgba(171, 181, 211, .54);
          border-radius: 16px;
          background: #f8fbff;
        }

        .billing-invoice-primary strong,
        .billing-invoice-primary span,
        .billing-invoice-field span,
        .billing-invoice-field strong {
          display: block;
        }

        .billing-invoice-primary strong {
          color: var(--billing-ink);
        }

        .billing-invoice-primary span {
          margin-top: 4px;
          color: var(--billing-muted);
          font-size: 10px;
          overflow-wrap: anywhere;
        }

        .billing-invoice-field span {
          color: #7b88a5;
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .05em;
        }

        .billing-invoice-field strong {
          margin-top: 4px;
          color: #334155;
          font-size: 11px;
          overflow-wrap: anywhere;
        }

        .billing-invoice-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .billing-status-pill {
          padding: 6px 9px;
          border-radius: 999px;
          color: var(--billing-amber);
          background: #fff4d5;
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .billing-status-pill.paid,
        .billing-status-pill.captured,
        .billing-status-pill.success,
        .billing-status-pill.completed,
        .billing-status-pill.converted {
          color: var(--billing-green);
          background: #eaf8f4;
        }

        .billing-status-pill.failed,
        .billing-status-pill.cancelled,
        .billing-status-pill.refunded,
        .billing-status-pill.expired {
          color: var(--billing-red);
          background: #fff0f2;
        }

        .billing-empty {
          min-height: 170px;
          margin-top: 14px;
          padding: 24px;
          border: 1px dashed rgba(77, 119, 221, .30);
          border-radius: 18px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 8px;
          color: var(--billing-muted);
          background: linear-gradient(145deg, #f8fbff, #f8f7ff);
          text-align: center;
          font-weight: 800;
        }

        .billing-empty p {
          margin: 0;
          color: inherit;
        }

        .billing-pagination {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 14px;
          margin-top: 14px;
          padding-top: 13px;
          border-top: 1px solid rgba(65, 55, 161, .08);
        }

        .billing-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .billing-page-button,
        .billing-page-number {
          border: 1px solid rgba(77, 119, 221, .18);
          color: #4767b4;
          background: #fff;
          font: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .billing-page-button {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 11px;
        }

        .billing-page-nav {
          min-width: 78px;
        }

        .billing-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .billing-page-number {
          width: 36px;
          height: 36px;
          padding: 0;
          display: grid;
          place-items: center;
          border-radius: 10px;
        }

        .billing-page-number.is-active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
        }

        .billing-page-button:hover:not(:disabled),
        .billing-page-number:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(46, 178, 185, .42);
        }

        .billing-page-button:disabled,
        .billing-page-number:disabled {
          opacity: .5;
          cursor: not-allowed;
          transform: none;
        }

        .billing-page-ellipsis {
          width: 18px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .billing-page-indicator {
          min-width: 82px;
          color: var(--billing-muted);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
        }

        .billing-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(102, 88, 220, .18);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          font-size: 10px;
          line-height: 1.45;
        }

        .billing-inline-feedback.success {
          border-color: rgba(4, 120, 87, .18);
          color: #047857;
          background: #eaf8f4;
        }

        .billing-inline-feedback.warning {
          border-color: rgba(154, 104, 23, .18);
          color: #9a6817;
          background: #fff4d5;
        }

        .billing-inline-feedback.error {
          border-color: rgba(162, 52, 77, .18);
          color: #a2344d;
          background: #fff0f2;
        }

        .billing-inline-feedback-icon {
          width: 22px;
          height: 22px;
          display: inline-grid;
          place-items: center;
        }

        .billing-inline-feedback-copy {
          min-width: 0;
        }

        .billing-inline-feedback-copy strong,
        .billing-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .billing-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .billing-inline-feedback-copy span {
          font-weight: 750;
        }

        .billing-inline-feedback-close {
          width: 24px;
          min-width: 24px;
          height: 24px;
          padding: 0;
          border: 0;
          border-radius: 8px;
          display: inline-grid;
          place-items: center;
          color: currentColor;
          background: rgba(255, 255, 255, .58);
          font: inherit;
          font-size: 17px;
          line-height: 1;
          cursor: pointer;
        }

        .billing-inline-feedback-close:hover {
          background: #fff;
        }

        .billing-loading {
          min-height: 220px;
          padding: 30px;
          border: 1px solid rgba(171, 181, 211, .64);
          border-radius: 24px;
          display: grid;
          place-items: center;
          color: var(--billing-muted);
          background: #fff;
          box-shadow: 0 18px 34px rgba(34, 38, 110, .07);
        }

        .billing-loading span {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          font-weight: 800;
        }

        .spin {
          animation: billingSpin .82s linear infinite;
        }

        @keyframes billingSpin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1180px) {
          .billing-summary-grid,
          .billing-quote-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .billing-invoice-row {
            grid-template-columns:
              minmax(180px, 1.2fr)
              repeat(2, minmax(110px, .8fr));
          }

          .billing-invoice-actions {
            grid-column: span 3;
            justify-content: flex-start;
          }
        }

        @media (max-width: 980px) {
          .billing-hero {
            grid-template-columns: 1fr;
          }

          .billing-hero-side {
            width: min(520px, 100%);
          }

          .billing-overview-grid,
          .billing-quotation-details {
            grid-template-columns: 1fr;
          }

          .billing-invoice-controls {
            grid-template-columns: 1fr;
          }

          .billing-view-control {
            justify-content: space-between;
          }
        }

        @media (max-width: 760px) {
          .billing-page-grid {
            gap: 15px;
          }

          .billing-hero {
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 0 18px 30px rgba(34, 38, 110, .09);
          }

          .billing-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .billing-section-tabs {
            grid-template-columns: 1fr;
          }

          .billing-section-head {
            align-items: stretch;
            flex-direction: column;
          }

          .billing-invoice-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .billing-invoice-primary,
          .billing-invoice-actions {
            grid-column: 1 / -1;
          }

          .billing-invoice-actions {
            justify-content: flex-start;
          }

          .billing-pagination {
            justify-content: stretch;
          }

          .billing-pagination-controls {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
          }

          .billing-page-numbers,
          .billing-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .billing-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .billing-page-nav {
            width: 100%;
          }

          .billing-form-grid {
            grid-template-columns: 1fr;
          }

          .billing-field.full {
            grid-column: auto;
          }

          .billing-form-actions,
          .billing-payment-row {
            align-items: stretch;
            flex-direction: column;
          }

          .billing-form-actions .primary,
          .billing-form-actions .ghost,
          .billing-payment-row .primary,
          .billing-payment-row .ghost {
            width: 100%;
          }
        }

        @media (max-width: 520px) {
          .billing-summary-grid,
          .billing-quote-summary-grid,
          .billing-invoice-row {
            grid-template-columns: 1fr;
          }

          .billing-invoice-primary,
          .billing-invoice-actions {
            grid-column: auto;
          }

          .billing-hero-actions {
            grid-template-columns: 1fr;
          }

          .billing-refresh-stack {
            grid-column: auto;
          }

          .billing-hero-actions .ghost,
          .billing-refresh-stack .ghost {
            width: 100%;
          }

          .billing-view-control {
            align-items: stretch;
            flex-direction: column;
          }

          .billing-page-size {
            justify-content: space-between;
          }

          .billing-page-size select {
            flex: 1 1 auto;
          }

          .billing-plan-head {
            align-items: stretch;
            flex-direction: column;
          }

          .billing-recommended-badge {
            align-self: flex-start;
          }
        }

        @media (max-width: 390px) {
          .billing-hero {
            padding: 16px;
          }

          .billing-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .billing-page-number {
            width: 34px;
            height: 34px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .billing-page *,
          .billing-page *::before,
          .billing-page *::after {
            animation: none !important;
            transition: none !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>

      <div className="billing-page-grid">
        <section className="billing-hero">
          <div className="billing-hero-copy">
            <span className="billing-kicker">
              <Sparkles size={14} />
              YourComate SaaS Billing
            </span>

            <h1>
              Manage your HRMS <em>subscription.</em>
            </h1>

            <p>
              Check your subscription status, validity, invoices and
              renewal alerts. Plan selection and payment controls appear
              only when a trial needs conversion, a subscription has
              expired, or renewal is approaching.
            </p>

            <StatusBadge
              planType={computed.planType || 'demo'}
              status={computed.status || 'active'}
            />
          </div>

          <div className="billing-hero-side">
            <div className="billing-current-card">
              <span>
                {computed.showUpgradeActions
                  ? 'Selected Plan'
                  : 'Current Subscription'}
              </span>

              <strong>
                {computed.showUpgradeActions
                  ? selectedPlan?.display_name ||
                    selectedPlan?.plan_name ||
                    'Growth'
                  : computed.currentPlanLabel}
              </strong>

              <small>
                {computed.isLifetime
                  ? 'No renewal required'
                  : computed.showUpgradeActions
                    ? `${formatCurrency(
                        selectedPlan?.amount ?? 4495,
                        selectedPlan?.currency || 'INR',
                      )}${
                        selectedPlan?.is_custom_pricing
                          ? ''
                          : ` / ${
                              selectedPlan?.billing_interval || 'monthly'
                            }`
                      } · ${selectedPlanEmployeeText}`
                    : `Valid until ${formatDate(
                        computed.validUntil,
                      )} · ${computed.employeesUsed} / ${
                        computed.employeeLimit
                      } employees`}
              </small>
            </div>

            <div className="billing-hero-actions">
              <div className="billing-refresh-stack">
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    loadBillingSummary({
                      feedbackScope: 'refresh',
                    })
                  }
                  disabled={loading}
                >
                  <RefreshCw
                    size={17}
                    className={loading ? 'spin' : ''}
                  />
                  {loading ? 'Refreshing...' : 'Refresh Status'}
                </button>

                <BillingInlineMessage
                  message={feedbackMap.refresh}
                  onClose={() => clearFeedback('refresh')}
                />
              </div>

              <button
                type="button"
                className="ghost"
                onClick={goBack}
              >
                <ArrowLeft size={17} />
                Back
              </button>
            </div>
          </div>
        </section>

        {loading && !summary ? (
          <div className="billing-loading">
            <span>
              <Loader2 size={19} className="spin" />
              Loading billing details...
            </span>
          </div>
        ) : (
          <>
            <BillingAlerts alerts={billingAlerts} />

            <section
              className="billing-summary-grid"
              aria-label="Billing summary"
            >
              <SummaryCard
                label="Company"
                value={computed.companyName}
              />

              <SummaryCard
                label={
                  computed.isDemo
                    ? 'Trial Ends On'
                    : 'Subscription Valid Until'
                }
                value={
                  computed.isLifetime
                    ? 'Lifetime'
                    : formatDate(computed.validUntil)
                }
              />

              <SummaryCard
                label="Validity Remaining"
                value={
                  computed.isLifetime
                    ? 'Lifetime'
                    : computed.daysLeft === null
                      ? 'Not available'
                      : `${computed.daysLeft} day${
                          computed.daysLeft === 1 ? '' : 's'
                        }`
                }
              />

              <SummaryCard
                label="Employees Used"
                value={`${computed.employeesUsed} / ${computed.employeeLimit}`}
              />
            </section>

            <nav
              className="billing-section-tabs"
              aria-label="Billing sections"
            >
              <button
                type="button"
                className={`billing-section-tab ${
                  activeSection === 'overview' ? 'is-active' : ''
                }`}
                onClick={() => setActiveSection('overview')}
                aria-pressed={activeSection === 'overview'}
              >
                <ShieldCheck size={18} />

                <span className="billing-section-tab-copy">
                  <strong>Subscription Overview</strong>
                  <small>Current access and payment impact</small>
                </span>
              </button>

              <button
                type="button"
                className={`billing-section-tab ${
                  activeSection === 'plans' ? 'is-active' : ''
                }`}
                onClick={() => setActiveSection('plans')}
                aria-pressed={activeSection === 'plans'}
              >
                <CreditCard size={18} />

                <span className="billing-section-tab-copy">
                  <strong>Plans & Payment</strong>
                  <small>Select plan, quotation and Razorpay</small>
                </span>
              </button>

              <button
                type="button"
                className={`billing-section-tab ${
                  activeSection === 'invoices' ? 'is-active' : ''
                }`}
                onClick={() => setActiveSection('invoices')}
                aria-pressed={activeSection === 'invoices'}
              >
                <ReceiptText size={18} />

                <span className="billing-section-tab-copy">
                  <strong>Invoices</strong>
                  <small>Payment history and PDF downloads</small>
                </span>

                <span className="billing-section-tab-count">
                  {invoices.length}
                </span>
              </button>
            </nav>

            {activeSection === 'overview' ? (
              <div className="billing-section-content">
                <div className="billing-overview-grid">
                  <section className="billing-panel billing-overview-card">
                    <span className="billing-section-kicker">
                      <ShieldCheck size={14} />
                      Current Access
                    </span>

                    <h2>Subscription access</h2>

                    {computed.isLifetime ? (
                      <p className="success">
                        This is the SDS lifetime company. It has full HRMS
                        access without recharge, renewal, or subscription
                        payment.
                      </p>
                    ) : computed.isPaid ? (
                      <p className="success">
                        This company has active paid access until{' '}
                        <strong>
                          {formatDate(computed.validUntil)}
                        </strong>
                        .{' '}
                        <strong>
                          {computed.daysLeft ??
                            'An unavailable number of'}{' '}
                          day(s)
                        </strong>{' '}
                        remain. Upgrade and payment controls stay hidden
                        until the renewal window opens.
                      </p>
                    ) : computed.isExpired ? (
                      <p className="error">
                        Subscription or trial access is expired or
                        suspended. Please renew or subscribe to continue
                        using YourComate HRMS.
                      </p>
                    ) : (
                      <p>
                        15-day full-access trial is active. Days left:{' '}
                        <strong>
                          {computed.daysLeft ?? 'Not available'}
                        </strong>
                        . All HRMS modules remain available until trial
                        expiry.
                      </p>
                    )}
                  </section>

                  <section className="billing-panel billing-overview-card">
                    <span className="billing-section-kicker">
                      <Sparkles size={14} />
                      After Payment
                    </span>

                    <h2>What continues after payment</h2>

                    <ul className="billing-benefit-list">
                      <li>
                        Trial company becomes official paid company
                      </li>
                      <li>
                        Full HRMS access continues after trial expiry
                      </li>
                      <li>
                        Employee limit applies according to selected plan
                      </li>
                      <li>
                        Payment record appears in Superadmin monitoring
                      </li>
                    </ul>
                  </section>
                </div>
              </div>
            ) : null}

            {activeSection === 'plans' ? (
              <div className="billing-section-content">
                <section className="billing-panel">
                  <div className="billing-section-head">
                    <div>
                      <span className="billing-section-kicker">
                        <CreditCard size={14} />
                        Plans & Payment
                      </span>

                      <h2>
                        {computed.renewalDueSoon
                          ? 'Renew or change your subscription'
                          : 'Select a subscription plan'}
                      </h2>

                      <p>
                        Essential and Growth use direct Razorpay payment.
                        Premium is opened only after Superadmin sends a
                        quotation.
                      </p>
                    </div>
                  </div>

                  {computed.showPlanSelection ? (
                    <div className="billing-plan-grid">
                      {plans.map((plan) => {
                        const code = plan.plan_code || plan.code;

                        return (
                          <PricingPlanCard
                            key={code}
                            plan={plan}
                            selected={code === selectedPlanCode}
                            disabled={
                              computed.isLifetime ||
                              creatingOrder ||
                              verifyingPayment ||
                              submittingPremiumRequest
                            }
                            onSelect={handleSelectPlan}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="billing-payment-note">
                      <CheckCircle2 size={18} />
                      <span>
                        Plan selection is not currently required. Your
                        subscription remains on{' '}
                        <strong>{computed.currentPlanLabel}</strong>.
                      </span>
                    </div>
                  )}

                  {computed.showPaymentActions ? (
                    <div className="billing-action-stack">
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
                      >
                        {creatingOrder ||
                        verifyingPayment ||
                        submittingPremiumRequest ? (
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
                                    ? `Renew ${
                                        selectedPlan?.display_name ||
                                        selectedPlan?.plan_name ||
                                        'Subscription'
                                      }`
                                    : `Pay for ${
                                        selectedPlan?.display_name ||
                                        selectedPlan?.plan_name ||
                                        'Selected Plan'
                                      }`}
                      </button>

                      <BillingInlineMessage
                        message={feedbackMap.payment}
                        onClose={() => clearFeedback('payment')}
                      />
                    </div>
                  ) : null}
                </section>

                {hasPremiumQuotation &&
                computed.showPaymentActions ? (
                  <PremiumQuotationPanel
                    quotation={premiumQuotation}
                    onPay={startPremiumQuotationPayment}
                    creatingOrder={creatingOrder}
                    verifyingPayment={verifyingPayment}
                    paymentDisabled={premiumPaymentDisabled}
                    paymentDisabledReason={
                      premiumPaymentDisabledReason
                    }
                    isRenewal={premiumNeedsRenewal}
                  />
                ) : null}

                {computed.showUpgradeActions &&
                showSalesContact &&
                isCustomSelected ? (
                  <section className="billing-premium-request">
                    <div className="billing-section-head">
                      <div>
                        <span className="billing-section-kicker">
                          <Users size={14} />
                          Premium Request
                        </span>

                        <h2>Premium custom plan request</h2>

                        <p>
                          Premium is quote-based and does not open
                          Razorpay directly. Fill this request form and
                          submit it to Superadmin/Sales for quotation
                          follow-up.
                        </p>
                      </div>
                    </div>

                    <div className="billing-premium-request-note">
                      Our sales team will connect with you within 24 hours
                      after you submit this request.
                    </div>

                    {premiumRequestResult ? (
                      <div className="billing-premium-result">
                        <strong>
                          Premium request submitted successfully.
                        </strong>

                        <p>
                          Reference:{' '}
                          <strong>
                            {premiumRequestResult.request_reference ||
                              premiumRequestResult.request_id ||
                              'Created'}
                          </strong>
                        </p>

                        <p>
                          Our sales team will connect with you within 24
                          hours. Superadmin/Sales can now view this
                          request from the Premium Requests page.
                        </p>
                      </div>
                    ) : null}

                    <form onSubmit={submitPremiumRequest}>
                      <div className="billing-form-grid">
                        <label className="billing-field">
                          <span>Contact Person Name *</span>
                          <input
                            type="text"
                            value={premiumForm.contact_name}
                            onChange={(event) =>
                              handlePremiumFormChange(
                                'contact_name',
                                event.target.value,
                              )
                            }
                            placeholder="Enter contact person name"
                          />
                        </label>

                        <label className="billing-field">
                          <span>Contact Email *</span>
                          <input
                            type="email"
                            value={premiumForm.contact_email}
                            onChange={(event) =>
                              handlePremiumFormChange(
                                'contact_email',
                                event.target.value,
                              )
                            }
                            placeholder="Enter contact email"
                          />
                        </label>

                        <label className="billing-field">
                          <span>Registered Company Email</span>
                          <input
                            type="email"
                            value={premiumForm.company_email}
                            onChange={(event) =>
                              handlePremiumFormChange(
                                'company_email',
                                event.target.value,
                              )
                            }
                            placeholder="Registered company email"
                          />
                        </label>

                        <label className="billing-field">
                          <span>Contact Phone</span>
                          <input
                            type="tel"
                            value={premiumForm.contact_phone}
                            onChange={(event) =>
                              handlePremiumFormChange(
                                'contact_phone',
                                event.target.value,
                              )
                            }
                            placeholder="Enter phone number"
                          />
                        </label>

                        <label className="billing-field">
                          <span>Estimated Employee Count *</span>
                          <input
                            type="number"
                            min="1"
                            value={premiumForm.employee_count}
                            onChange={(event) =>
                              handlePremiumFormChange(
                                'employee_count',
                                event.target.value,
                              )
                            }
                            placeholder="Example: 250"
                          />
                        </label>

                        <label className="billing-field">
                          <span>Onboarding Required?</span>
                          <select
                            value={premiumForm.onboarding_required}
                            onChange={(event) =>
                              handlePremiumFormChange(
                                'onboarding_required',
                                event.target.value,
                              )
                            }
                          >
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                            <option value="Need discussion">
                              Need discussion
                            </option>
                          </select>
                        </label>

                        <label className="billing-field">
                          <span>Training Required?</span>
                          <select
                            value={premiumForm.training_required}
                            onChange={(event) =>
                              handlePremiumFormChange(
                                'training_required',
                                event.target.value,
                              )
                            }
                          >
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                            <option value="Need discussion">
                              Need discussion
                            </option>
                          </select>
                        </label>

                        <label className="billing-field full">
                          <span>Custom Modules / Requirements</span>
                          <textarea
                            value={premiumForm.custom_modules}
                            onChange={(event) =>
                              handlePremiumFormChange(
                                'custom_modules',
                                event.target.value,
                              )
                            }
                            placeholder="Example: custom reports, payroll rule changes, approval workflow, API integration, data migration..."
                            rows={3}
                          />
                        </label>

                        <label className="billing-field full">
                          <span>Support / SLA Requirement</span>
                          <select
                            value={premiumForm.support_sla}
                            onChange={(event) =>
                              handlePremiumFormChange(
                                'support_sla',
                                event.target.value,
                              )
                            }
                          >
                            <option value="Standard business support">
                              Standard business support
                            </option>
                            <option value="Premium / enterprise support discussion required">
                              Premium / enterprise support discussion
                              required
                            </option>
                            <option value="Priority support with faster response">
                              Priority support with faster response
                            </option>
                            <option value="Dedicated support / SLA required">
                              Dedicated support / SLA required
                            </option>
                          </select>
                        </label>

                        <label className="billing-field full">
                          <span>Message / Notes</span>
                          <textarea
                            value={premiumForm.message}
                            onChange={(event) =>
                              handlePremiumFormChange(
                                'message',
                                event.target.value,
                              )
                            }
                            placeholder="Add any additional Premium plan requirement..."
                            rows={3}
                          />
                        </label>
                      </div>

                      <div className="billing-form-actions">
                        <button
                          type="submit"
                          className="primary"
                          disabled={submittingPremiumRequest}
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
                            clearFeedback('premium-request');
                          }}
                          disabled={submittingPremiumRequest}
                        >
                          Cancel
                        </button>
                      </div>

                      <div className="billing-action-stack">
                        <BillingInlineMessage
                          message={feedbackMap['premium-request']}
                          onClose={() =>
                            clearFeedback('premium-request')
                          }
                        />
                      </div>
                    </form>

                    <div className="billing-next-box">
                      <strong>What happens next?</strong>
                      <ol className="billing-next-list">
                        <li>
                          Request appears in the Superadmin Premium
                          Requests page.
                        </li>
                        <li>
                          SDS/Sales discusses employee count, onboarding,
                          training and custom needs.
                        </li>
                        <li>
                          Superadmin sends the custom amount, interval and
                          payment due date.
                        </li>
                        <li>
                          The quotation appears here with a Pay Premium
                          Quotation button.
                        </li>
                        <li>
                          Successful Razorpay payment activates Premium
                          automatically.
                        </li>
                      </ol>
                    </div>
                  </section>
                ) : null}

                {computed.showUpgradeActions && !computed.isLifetime ? (
                  <div className="billing-payment-note">
                    <CheckCircle2 size={18} />
                    <p>
                      {isCustomSelected
                        ? 'Premium is custom quoted. Once Superadmin sends the quotation, the payment details will appear above and the finalized amount will be used for monthly/yearly renewal until Superadmin revises it.'
                        : 'Razorpay test mode can be used with test payment details. Essential/Growth renewals will use the latest active price configured by Superadmin.'}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeSection === 'invoices' ? (
              <div className="billing-section-content">
                <InvoiceHistory
                  invoices={invoices}
                  downloadingInvoiceId={downloadingInvoiceId}
                  onDownload={downloadInvoice}
                />
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
