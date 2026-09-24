import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { api } from '../api/client';

function normalizeValue(value) {
  return String(value ?? '').trim();
}

function normalizeStatus(value) {
  return normalizeValue(value)
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatDate(value) {
  if (!value) {
    return 'Not available';
  }

  try {
    const rawValue = typeof value === 'object' && value.$date ? value.$date : value;
    const date = new Date(rawValue);

    if (Number.isNaN(date.getTime())) {
      return normalizeValue(rawValue) || 'Not available';
    }

    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return normalizeValue(value) || 'Not available';
  }
}

function formatCurrency(value, currency = 'INR') {
  const amount = toNumber(value, 0);

  if (amount <= 0) {
    return 'Custom quotation';
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

function formatBillingInterval(value) {
  const normalized = normalizeStatus(value || 'monthly');

  if (['yearly', 'annual', 'annually'].includes(normalized)) {
    return 'year';
  }

  if (['quarterly', 'quarter'].includes(normalized)) {
    return 'quarter';
  }

  return 'month';
}

function getSubscription(source = {}) {
  return source.subscription || source.saas_subscription || {};
}

function getTenant(source = {}) {
  return source.tenant || source.company || {};
}

function getCompanyName(source = {}, fallbackUser = {}) {
  const tenant = getTenant(source);
  const fallbackTenant = getTenant(fallbackUser);

  return (
    source.company_name ||
    tenant.company_name ||
    tenant.name ||
    tenant.legal_name ||
    fallbackUser.company_name ||
    fallbackTenant.company_name ||
    fallbackTenant.name ||
    'Your company'
  );
}

function getPlanType(source = {}, fallbackUser = {}) {
  const subscription = getSubscription(source);
  const tenant = getTenant(source);
  const fallbackSubscription = getSubscription(fallbackUser);
  const fallbackTenant = getTenant(fallbackUser);

  return normalizeStatus(
    source.plan_type ||
      subscription.plan_type ||
      tenant.plan_type ||
      fallbackUser.plan_type ||
      fallbackSubscription.plan_type ||
      fallbackTenant.plan_type ||
      'demo',
  );
}

function getStatus(source = {}, fallbackUser = {}) {
  const subscription = getSubscription(source);
  const tenant = getTenant(source);
  const fallbackSubscription = getSubscription(fallbackUser);
  const fallbackTenant = getTenant(fallbackUser);

  return normalizeStatus(
    source.status ||
      source.subscription_status ||
      subscription.status ||
      subscription.subscription_status ||
      tenant.status ||
      tenant.subscription_status ||
      fallbackUser.subscription_status ||
      fallbackSubscription.status ||
      fallbackTenant.status ||
      fallbackUser.status ||
      'expired',
  );
}

function getPlanName(source = {}, fallbackUser = {}) {
  const subscription = getSubscription(source);
  const tenant = getTenant(source);
  const fallbackSubscription = getSubscription(fallbackUser);
  const fallbackTenant = getTenant(fallbackUser);

  return (
    source.plan_name ||
    source.plan_label ||
    subscription.plan_name ||
    subscription.plan_label ||
    subscription.display_name ||
    tenant.plan_name ||
    tenant.plan_label ||
    fallbackUser.plan_name ||
    fallbackSubscription.plan_name ||
    fallbackTenant.plan_name ||
    'Trial'
  );
}

function getAccessEndDate(source = {}, fallbackUser = {}) {
  const subscription = getSubscription(source);
  const tenant = getTenant(source);
  const fallbackSubscription = getSubscription(fallbackUser);
  const fallbackTenant = getTenant(fallbackUser);

  return (
    source.next_payment_due_date ||
    source.subscription_end_date ||
    source.trial_end_date ||
    source.end_date ||
    subscription.next_payment_due_date ||
    subscription.subscription_end_date ||
    subscription.trial_end_date ||
    subscription.end_date ||
    tenant.next_payment_due_date ||
    tenant.subscription_end_date ||
    tenant.trial_end_date ||
    tenant.end_date ||
    fallbackUser.next_payment_due_date ||
    fallbackUser.subscription_end_date ||
    fallbackUser.trial_end_date ||
    fallbackSubscription.next_payment_due_date ||
    fallbackSubscription.subscription_end_date ||
    fallbackSubscription.trial_end_date ||
    fallbackTenant.next_payment_due_date ||
    fallbackTenant.subscription_end_date ||
    fallbackTenant.trial_end_date
  );
}

function getEmployeeUsage(source = {}, fallbackUser = {}) {
  const subscription = getSubscription(source);
  const tenant = getTenant(source);
  const fallbackSubscription = getSubscription(fallbackUser);
  const fallbackTenant = getTenant(fallbackUser);

  const used =
    source.employee_count ??
    source.employees_used ??
    subscription.employee_count ??
    subscription.employees_used ??
    tenant.employee_count ??
    tenant.employees_used ??
    fallbackUser.employee_count ??
    fallbackUser.employees_used ??
    fallbackSubscription.employee_count ??
    fallbackSubscription.employees_used ??
    fallbackTenant.employee_count ??
    fallbackTenant.employees_used ??
    0;

  const limit =
    source.employee_limit ??
    subscription.employee_limit ??
    tenant.employee_limit ??
    fallbackUser.employee_limit ??
    fallbackSubscription.employee_limit ??
    fallbackTenant.employee_limit ??
    null;

  const isUnlimited =
    source.is_unlimited_employees === true ||
    subscription.is_unlimited_employees === true ||
    tenant.is_unlimited_employees === true ||
    fallbackSubscription.is_unlimited_employees === true ||
    limit === null ||
    limit === undefined ||
    normalizeStatus(limit) === 'unlimited' ||
    Number(limit) === 0;

  return {
    used: toNumber(used, 0),
    limit,
    isUnlimited,
  };
}

function getPlans(summary = {}) {
  const plans =
    summary.plans ||
    summary.pricing?.plans ||
    summary.billing?.plans ||
    summary.subscription?.plans ||
    [];

  if (!Array.isArray(plans)) {
    return [];
  }

  return plans
    .filter((plan) => plan && plan.is_active !== false && plan.is_deleted !== true)
    .map((plan) => ({
      ...plan,
      plan_code: normalizeStatus(plan.plan_code || plan.code || plan.slug),
      plan_name:
        plan.display_name ||
        plan.plan_name ||
        plan.name ||
        normalizeValue(plan.plan_code || plan.code || 'Plan'),
    }))
    .sort((left, right) => {
      const rank = { essential: 1, growth: 2, premium: 3 };
      return (rank[left.plan_code] || 99) - (rank[right.plan_code] || 99);
    });
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

function truthyValue(value) {
  if (value === true || value === 1) {
    return true;
  }

  return ['true', '1', 'yes', 'on'].includes(normalizeStatus(value));
}

function getBillingActions(summary = {}) {
  return summary.billing_actions || summary.billing?.billing_actions || {};
}

function daysUntil(value) {
  if (!value) {
    return null;
  }

  const rawValue = typeof value === 'object' && value.$date ? value.$date : value;
  const date = new Date(rawValue);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function getBillingAccessState(summary = {}, fallbackUser = {}) {
  const actions = getBillingActions(summary);
  const status = getStatus(summary, fallbackUser);
  const planType = getPlanType(summary, fallbackUser);
  const accessEndDate = getAccessEndDate(summary, fallbackUser);
  const remainingDays =
    summary.subscription_days_left ??
    summary.days_left ??
    actions.subscription_days_left ??
    actions.days_left ??
    daysUntil(accessEndDate);

  const expiredStatuses = new Set([
    'expired',
    'subscription_expired',
    'trial_expired',
    'demo_expired',
    'suspended',
    'blocked',
    'inactive',
    'cancelled',
    'payment_required',
  ]);
  const activeStatuses = new Set([
    'active',
    'paid',
    'current',
    'active_paid',
    'active_trial',
    'trial_active',
    'lifetime',
  ]);

  const isLifetime =
    planType === 'lifetime' ||
    truthyValue(summary.has_lifetime_access) ||
    truthyValue(getSubscription(summary).has_lifetime_access) ||
    truthyValue(getTenant(summary).has_lifetime_access);
  const requiresPayment =
    truthyValue(summary.requires_payment) ||
    truthyValue(actions.requires_payment) ||
    status === 'payment_required';
  const renewalDueSoon =
    truthyValue(summary.renewal_due_soon) ||
    truthyValue(actions.renewal_due_soon) ||
    (!isLifetime &&
      !['demo', 'trial'].includes(planType) &&
      remainingDays !== null &&
      Number(remainingDays) >= 0 &&
      Number(remainingDays) <= 7);
  const explicitUpgradeAction =
    truthyValue(summary.show_upgrade_actions) ||
    truthyValue(summary.show_payment_actions) ||
    truthyValue(actions.show_upgrade_actions) ||
    truthyValue(actions.show_payment_actions);
  const isExpired =
    expiredStatuses.has(status) ||
    (remainingDays !== null && Number(remainingDays) < 0);
  const isActive = isLifetime || (activeStatuses.has(status) && !isExpired);
  const shouldHideRenewalScreen =
    isActive && !renewalDueSoon && !requiresPayment && !explicitUpgradeAction;

  return {
    isActive,
    isExpired,
    isLifetime,
    requiresPayment,
    renewalDueSoon,
    remainingDays,
    shouldHideRenewalScreen,
    shouldShowRenewalAction: isExpired || renewalDueSoon || requiresPayment,
  };
}

function goToPath(path, fallbackPage) {
  try {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    window.location.href = path || `/${fallbackPage}`;
  }
}


const SUBSCRIPTION_NOTICE_HIDE_MS = 3600;

function SubscriptionInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`subscription-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="subscription-inline-feedback-icon">
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

      <span className="subscription-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="subscription-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <article className="subscription-info-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function PlanPreview({ plan, premiumQuotation }) {
  const planCode = normalizeStatus(plan.plan_code || plan.code);
  const isPremium = planCode === 'premium' || plan.is_custom_pricing === true;
  const isRecommended = plan.is_recommended === true || planCode === 'growth';

  const quotedAmount =
    premiumQuotation.renewal_amount ||
    premiumQuotation.payment_amount ||
    premiumQuotation.quoted_amount;

  const amount = isPremium && quotedAmount ? quotedAmount : plan.amount;
  const currency =
    (isPremium && premiumQuotation.quoted_currency) || plan.currency || 'INR';
  const interval =
    (isPremium &&
      (premiumQuotation.quoted_billing_interval ||
        premiumQuotation.billing_interval)) ||
    plan.billing_interval ||
    plan.plan_interval ||
    'monthly';

  const employeeLimit =
    plan.is_unlimited_employees === true ||
    plan.employee_limit === null ||
    plan.employee_limit === undefined ||
    Number(plan.employee_limit) === 0
      ? 'Unlimited employees'
      : `Up to ${plan.employee_limit} employees`;

  return (
    <article
      className={`subscription-plan-card ${
        isRecommended ? 'recommended' : ''
      }`}
    >
      <div className="subscription-plan-head">
        <h3>{plan.plan_name}</h3>

        {isRecommended ? (
          <span className="subscription-recommended-badge">
            Recommended
          </span>
        ) : null}
      </div>

      <p className="subscription-plan-price">
        {toNumber(amount, 0) > 0 ? <IndianRupee size={21} /> : null}
        <span>
          {toNumber(amount, 0) > 0
            ? `${new Intl.NumberFormat('en-IN', {
                maximumFractionDigits: 2,
              }).format(toNumber(amount, 0))} / ${formatBillingInterval(
                interval,
              )}`
            : formatCurrency(amount, currency)}
        </span>
      </p>

      <p className="subscription-plan-limit">{employeeLimit}</p>

      {isPremium && quotedAmount ? (
        <p className="subscription-active-quotation">
          Your active quotation
        </p>
      ) : null}
    </article>
  );
}

const SUBSCRIPTION_PAGE_STYLES = `
  .subscription-expired-page {
    --sub-ink: #101a3a;
    --sub-muted: #5d6d8d;
    --sub-blue: #4d77dd;
    --sub-cyan: #2eb2b9;
    --sub-violet: #575092;
    --sub-green: #047857;
    --sub-red: #a2344d;
    --sub-amber: #9a6817;

    width: min(1120px, 100%);
    min-width: 0;
    margin: 0 auto;
    overflow: visible;
    border: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    color: var(--sub-ink);
    font-family: var(--yc-ui, var(--body), inherit);
  }

  .subscription-expired-page,
  .subscription-expired-page * {
    box-sizing: border-box;
  }

  .subscription-expired-page > *,
  .subscription-expired-page section,
  .subscription-expired-page article,
  .subscription-expired-page nav {
    min-width: 0;
    max-width: 100%;
  }

  .subscription-expired-page::before,
  .subscription-expired-page::after,
  .subscription-expired-page .subscription-hero::before,
  .subscription-expired-page .subscription-hero::after,
  .subscription-expired-page .subscription-info-card::before,
  .subscription-expired-page .subscription-info-card::after {
    content: none;
    display: none;
    background: none;
  }

  .subscription-page-grid {
    display: grid;
    gap: clamp(16px, 1.8vw, 24px);
    width: 100%;
  }

  .subscription-hero {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(240px, 330px);
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

  .subscription-hero-copy {
    min-width: 0;
    max-width: 830px;
  }

  .subscription-kicker {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: max-content;
    max-width: 100%;
    margin-bottom: 15px;
    padding: 9px 13px;
    border-radius: 999px;
    color: #fff;
    background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
    box-shadow: 0 8px 18px rgba(77, 119, 221, .18);
    font-size: 9px;
    font-weight: 950;
    line-height: 1;
    letter-spacing: .12em;
    text-transform: uppercase;
  }

  .subscription-expired-page h1,
  .subscription-expired-page h2,
  .subscription-expired-page h3 {
    color: var(--sub-ink);
    font-family: var(--yc-display, var(--heading), Georgia, "Times New Roman", serif);
  }

  .subscription-hero h1 {
    margin: 0;
    font-size: clamp(42px, 5vw, 72px);
    font-weight: 760;
    line-height: .96;
    letter-spacing: -.055em;
  }

  .subscription-hero h1 em {
    color: var(--sub-blue);
    font-family: Georgia, "Times New Roman", serif;
    font-weight: 500;
  }

  .subscription-hero p {
    max-width: 790px;
    margin: 17px 0 0;
    color: var(--sub-muted);
    font-size: clamp(13px, 1vw, 16px);
    line-height: 1.68;
  }

  .subscription-hero-side {
    display: grid;
    gap: 10px;
    align-items: start;
  }

  .subscription-access-note {
    padding: 17px;
    border: 1px solid rgba(77, 119, 221, .18);
    border-radius: 18px;
    background: rgba(255, 255, 255, .88);
    box-shadow: 0 12px 26px rgba(70, 92, 140, .08);
  }

  .subscription-access-note strong,
  .subscription-access-note span {
    display: block;
  }

  .subscription-access-note strong {
    color: var(--sub-ink);
    font-size: 13px;
  }

  .subscription-access-note span {
    margin-top: 7px;
    color: var(--sub-muted);
    font-size: 11px;
    line-height: 1.5;
  }

  .subscription-expired-page button {
    touch-action: manipulation;
    font-weight: 900;
    font: inherit;
  }

  .subscription-expired-page .primary,
  .subscription-expired-page .ghost {
    min-height: 44px;
    padding: 10px 15px;
    border: 1px solid transparent;
    border-radius: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: max-content;
    font-size: 12px;
    font-weight: 900;
    cursor: pointer;
    transition:
      transform 180ms ease,
      border-color 180ms ease,
      filter 180ms ease,
      opacity 180ms ease;
  }

  .subscription-expired-page .primary {
    color: #fff;
    background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
    box-shadow: 0 10px 22px rgba(77, 119, 221, .18);
  }

  .subscription-expired-page .ghost {
    color: #4767b4;
    border-color: rgba(77, 119, 221, .18);
    background: #fff;
  }

  .subscription-expired-page .primary:hover:not(:disabled),
  .subscription-expired-page .ghost:hover:not(:disabled) {
    transform: translateY(-1px);
    filter: saturate(1.03);
  }

  .subscription-expired-page .primary:disabled,
  .subscription-expired-page .ghost:disabled {
    opacity: .55;
    cursor: not-allowed;
    transform: none;
  }

  .subscription-info-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }

  .subscription-info-card {
    min-width: 0;
    min-height: 120px;
    padding: 18px;
    border: 1px solid rgba(171, 181, 211, .66);
    border-radius: 22px;
    background: #edf6ff;
    box-shadow: 0 16px 30px rgba(34, 38, 110, .07);
  }

  .subscription-info-card:nth-child(2) {
    background: #eaf8f4;
  }

  .subscription-info-card:nth-child(3) {
    background: #fff4d5;
  }

  .subscription-info-card:nth-child(4) {
    background: #f1efff;
  }

  .subscription-info-card span,
  .subscription-info-card strong {
    display: block;
  }

  .subscription-info-card span {
    color: #5d6785;
    font-size: 9px;
    font-weight: 950;
    letter-spacing: .09em;
    text-transform: uppercase;
  }

  .subscription-info-card strong {
    margin-top: 9px;
    overflow-wrap: anywhere;
    color: var(--sub-ink);
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(22px, 2vw, 32px);
    line-height: 1.15;
  }

  .subscription-section-tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    width: 100%;
    padding: 12px;
    border: 1px solid rgba(171, 181, 211, .62);
    border-radius: 22px;
    background: #fff;
    box-shadow: 0 16px 28px rgba(34, 38, 110, .08);
  }

  .subscription-section-tab {
    min-width: 0;
    min-height: 62px;
    padding: 11px 14px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
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

  .subscription-section-tab:hover {
    transform: translateY(-1px);
    border-color: rgba(46, 178, 185, .42);
  }

  .subscription-section-tab.is-active {
    border-color: transparent;
    color: #fff;
    background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
    box-shadow: 0 8px 18px rgba(77, 119, 221, .17);
  }

  .subscription-section-tab-copy {
    min-width: 0;
    display: grid;
    gap: 3px;
  }

  .subscription-section-tab-copy strong {
    font-size: 12px;
    font-weight: 950;
    line-height: 1.2;
  }

  .subscription-section-tab-copy small {
    color: currentColor;
    font-size: 9px;
    font-weight: 700;
    line-height: 1.35;
    opacity: .78;
  }

  .subscription-section-content {
    animation: subscriptionSectionReveal 220ms ease both;
  }

  @keyframes subscriptionSectionReveal {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .subscription-panel {
    padding: clamp(20px, 2.5vw, 28px);
    border: 1px solid rgba(171, 181, 211, .70);
    border-radius: clamp(24px, 2.2vw, 34px);
    background: #fff;
    box-shadow: 0 20px 38px rgba(34, 38, 110, .08);
  }

  .subscription-panel-head {
    margin-bottom: 17px;
  }

  .subscription-panel-head h2 {
    margin: 0;
    font-size: clamp(24px, 2.4vw, 35px);
    font-weight: 760;
    line-height: 1;
    letter-spacing: -.045em;
  }

  .subscription-panel-head p {
    margin: 8px 0 0;
    color: var(--sub-muted);
    font-size: 13px;
    line-height: 1.55;
  }

  .subscription-renewal-note {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px;
    border: 1px solid rgba(77, 119, 221, .18);
    border-radius: 15px;
    color: #245da8;
    background: #edf6ff;
    font-size: 12px;
    font-weight: 850;
  }

  .subscription-payment-list {
    display: grid;
    gap: 10px;
    margin: 18px 0 0;
    padding: 0;
    list-style: none;
  }

  .subscription-payment-list li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 9px;
    align-items: start;
    padding: 12px;
    border: 1px solid rgba(171, 181, 211, .52);
    border-radius: 14px;
    color: var(--sub-muted);
    background: #f8fbff;
    font-size: 12px;
    line-height: 1.55;
  }

  .subscription-payment-list li:nth-child(2) {
    background: #eaf8f4;
  }

  .subscription-payment-list li:nth-child(3) {
    background: #fff4d5;
  }

  .subscription-payment-list li:nth-child(4) {
    background: #f1efff;
  }

  .subscription-payment-list svg {
    margin-top: 2px;
    color: var(--sub-blue);
    flex: 0 0 auto;
  }

  .subscription-plan-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 16px;
  }

  .subscription-plan-card {
    min-width: 0;
    padding: 18px;
    border: 1px solid rgba(171, 181, 211, .66);
    border-radius: 20px;
    background: #fff;
    box-shadow: 0 14px 28px rgba(34, 38, 110, .07);
  }

  .subscription-plan-card.recommended {
    border-color: rgba(77, 119, 221, .35);
    background: linear-gradient(145deg, #f1efff, #f7fbff);
  }

  .subscription-plan-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .subscription-plan-head h3 {
    margin: 0;
    font-size: 20px;
    font-weight: 900;
  }

  .subscription-recommended-badge {
    flex: 0 0 auto;
    padding: 5px 8px;
    border-radius: 999px;
    color: #40348d;
    background: #fff;
    border: 1px solid rgba(77, 119, 221, .18);
    font-size: 9px;
    font-weight: 950;
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  .subscription-plan-price {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 16px 0 0;
    color: var(--sub-ink);
    font-size: 23px;
    font-weight: 900;
  }

  .subscription-plan-limit {
    margin: 8px 0 0;
    color: var(--sub-muted);
    line-height: 1.55;
  }

  .subscription-active-quotation {
    margin: 8px 0 0;
    color: var(--sub-green);
    font-weight: 850;
  }

  .subscription-plans-empty,
  .subscription-plans-loading {
    grid-column: 1 / -1;
    min-height: 120px;
    padding: 18px;
    border: 1px dashed rgba(77, 119, 221, .28);
    border-radius: 18px;
    display: grid;
    place-items: center;
    color: var(--sub-muted);
    background: #f8fbff;
    text-align: center;
  }

  .subscription-plans-loading span {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .subscription-actions {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    flex-wrap: wrap;
  }

  .subscription-action-stack {
    display: grid;
    gap: 8px;
    width: min(300px, 100%);
  }

  .subscription-action-stack .ghost {
    justify-self: start;
  }

  .subscription-status-note {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--sub-muted);
    font-size: 12px;
  }

  .subscription-status-note svg {
    color: var(--sub-green);
  }

  .subscription-error {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 13px;
    border: 1px solid rgba(162, 52, 77, .18);
    border-radius: 14px;
    color: var(--sub-red);
    background: #fff0f2;
    font-size: 12px;
  }

  .subscription-inline-feedback {
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

  .subscription-inline-feedback.success {
    border-color: rgba(4, 120, 87, .18);
    color: #047857;
    background: #eaf8f4;
  }

  .subscription-inline-feedback.warning {
    border-color: rgba(154, 104, 23, .18);
    color: #9a6817;
    background: #fff4d5;
  }

  .subscription-inline-feedback.error {
    border-color: rgba(162, 52, 77, .18);
    color: #a2344d;
    background: #fff0f2;
  }

  .subscription-inline-feedback-icon {
    width: 22px;
    height: 22px;
    display: inline-grid;
    place-items: center;
  }

  .subscription-inline-feedback-copy {
    min-width: 0;
  }

  .subscription-inline-feedback-copy strong,
  .subscription-inline-feedback-copy span {
    display: block;
    overflow-wrap: anywhere;
  }

  .subscription-inline-feedback-copy strong {
    margin-bottom: 2px;
    font-weight: 950;
  }

  .subscription-inline-feedback-copy span {
    font-weight: 750;
  }

  .subscription-inline-feedback-close {
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

  .subscription-inline-feedback-close:hover {
    background: #fff;
  }

  .subscription-active-state {
    width: min(760px, 100%);
  }

  .subscription-active-card {
    min-height: 280px;
    padding: clamp(22px, 3vw, 34px);
    border: 1px solid rgba(4, 120, 87, .18);
    border-radius: 28px;
    display: grid;
    place-items: center;
    text-align: center;
    background: linear-gradient(145deg, #eaf8f4, #fff);
    box-shadow: 0 20px 38px rgba(34, 38, 110, .08);
  }

  .subscription-active-card svg {
    color: var(--sub-green);
  }

  .subscription-active-card h2 {
    margin: 14px 0 8px;
    font-size: clamp(26px, 3vw, 36px);
  }

  .subscription-active-card p {
    margin: 0;
    color: var(--sub-muted);
    line-height: 1.65;
  }

  .spin {
    animation: subscriptionSpin .82s linear infinite;
  }

  @keyframes subscriptionSpin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 980px) {
    .subscription-hero {
      grid-template-columns: 1fr;
    }

    .subscription-hero-side {
      width: min(520px, 100%);
    }
  }

  @media (max-width: 820px) {
    .subscription-info-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .subscription-page-grid {
      gap: 15px;
    }

    .subscription-hero {
      min-height: 0;
      padding: 20px;
      border-radius: 26px;
      box-shadow: 0 18px 30px rgba(34, 38, 110, .09);
    }

    .subscription-hero h1 {
      font-size: clamp(35px, 10vw, 50px);
    }

    .subscription-section-tabs {
      grid-template-columns: 1fr;
    }

    .subscription-actions {
      align-items: stretch;
      flex-direction: column;
    }

    .subscription-actions .primary,
    .subscription-actions .ghost,
    .subscription-action-stack,
    .subscription-action-stack .ghost {
      width: 100%;
      justify-self: stretch;
    }

    .subscription-error {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 520px) {
    .subscription-info-grid {
      grid-template-columns: 1fr;
    }

    .subscription-panel {
      padding: 16px;
    }

    .subscription-plan-head {
      align-items: stretch;
      flex-direction: column;
    }

    .subscription-recommended-badge {
      align-self: flex-start;
    }
  }

  @media (max-width: 390px) {
    .subscription-hero {
      padding: 16px;
    }

    .subscription-hero h1 {
      font-size: clamp(32px, 11vw, 44px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .subscription-expired-page *,
    .subscription-expired-page *::before,
    .subscription-expired-page *::after {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto !important;
    }
  }
`;

export default function SubscriptionExpired({ user = {}, setPage }) {
  const [billingSummary, setBillingSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');
  const [feedbackMap, setFeedbackMap] = useState({});
  const feedbackTimersRef = useRef({});

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
      }, SUBSCRIPTION_NOTICE_HIDE_MS);
    }
  }

  async function loadBillingSummary({ feedbackScope = '' } = {}) {
    setLoading(true);
    setLoadError('');

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        'Refreshing subscription and billing status...',
        'Refreshing',
        { loading: true },
      );
    }

    try {
      const data = await api('/billing/summary');
      setBillingSummary(data || {});

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          'Subscription and billing status are up to date.',
          'Refresh Complete',
        );
      }

      return true;
    } catch (error) {
      const errorMessage =
        error?.message ||
        'Billing details could not be loaded. You can still open Billing and try again.';

      setLoadError(errorMessage);

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
      if (event.target?.closest?.('.subscription-inline-feedback')) return;

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

  const summary = useMemo(() => {
    const source = billingSummary || {};
    const employeeUsage = getEmployeeUsage(source, user);
    const planType = getPlanType(source, user);
    const status = getStatus(source, user);
    const planName = getPlanName(source, user);
    const isTrial = ['demo', 'trial'].includes(planType);
    const isPaid =
      planType === 'paid' ||
      ['essential', 'growth', 'premium'].includes(planType);
    const accessState = getBillingAccessState(source, user);

    return {
      companyName: getCompanyName(source, user),
      status,
      planType,
      planName,
      accessEndDate: getAccessEndDate(source, user),
      employeesUsed: employeeUsage.used,
      employeeLimit: employeeUsage.limit,
      isUnlimitedEmployees: employeeUsage.isUnlimited,
      isTrial,
      isPaid,
      plans: getPlans(source),
      premiumQuotation: getPremiumQuotation(source),
      renewalAmount:
        source.renewal_amount ||
        getSubscription(source).renewal_amount ||
        getTenant(source).renewal_amount,
      billingInterval:
        source.billing_interval ||
        getSubscription(source).billing_interval ||
        getTenant(source).billing_interval,
      ...accessState,
    };
  }, [billingSummary, user]);

  useEffect(() => {
    if (loading || !billingSummary || !summary.shouldHideRenewalScreen) {
      return undefined;
    }

    setRedirecting(true);

    const timer = window.setTimeout(() => {
      try {
        window.history.replaceState({}, '', '/hrms');
      } catch {
        // Page state below still redirects correctly when history is unavailable.
      }

      if (typeof setPage === 'function') {
        setPage('dashboard');
      } else {
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    billingSummary,
    loading,
    setPage,
    summary.shouldHideRenewalScreen,
  ]);

  function goToBilling() {
    if (typeof setPage === 'function') {
      setPage('billing');
    }

    goToPath('/hrms/billing', 'billing');
  }

  function goBack() {
    if (typeof setPage === 'function') {
      setPage('dashboard');
      return;
    }

    goToPath('/hrms', 'dashboard');
  }

  const employeeText = summary.isUnlimitedEmployees
    ? `${summary.employeesUsed || 0} / Unlimited`
    : `${summary.employeesUsed || 0} / ${
        summary.employeeLimit || 'Plan limit'
      }`;

  const title = summary.isTrial
    ? 'Your full-access trial has ended'
    : `${summary.planName || 'Your subscription'} requires renewal`;

  const description = summary.isTrial
    ? 'Choose a paid subscription to continue using YourComate HRMS. After successful payment, this trial company becomes an official paid company.'
    : 'Your paid subscription period has ended or payment is due. Complete renewal payment to restore company access while keeping the existing company data and configuration.';

  const dateLabel = summary.isTrial
    ? 'Trial End Date'
    : 'Renewal Due Date';

  const actionLabel = summary.isTrial
    ? 'Open Billing & Upgrade'
    : 'Open Billing & Renew';

  if (redirecting || (!loading && summary.shouldHideRenewalScreen)) {
    return (
      <section className="panel subscription-expired-page subscription-active-state">
        <style>{SUBSCRIPTION_PAGE_STYLES}</style>

        <div className="subscription-active-card">
          <div>
            <CheckCircle2 size={46} />
            <h2>Subscription is active</h2>
            <p>
              Upgrade and renewal controls are no longer required.
              Returning to the dashboard.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel subscription-expired-page">
      <style>{SUBSCRIPTION_PAGE_STYLES}</style>

      <div className="subscription-page-grid">
        <section className="subscription-hero">
          <div className="subscription-hero-copy">
            <span className="subscription-kicker">
              <AlertTriangle size={14} />
              {summary.isTrial
                ? 'Subscription Required'
                : 'Renewal Required'}
            </span>

            <h1>
              {summary.isTrial ? (
                <>
                  Your full-access <em>trial has ended</em>
                </>
              ) : (
                <>
                  {summary.planName || 'Your subscription'}{' '}
                  <em>requires renewal</em>
                </>
              )}
            </h1>

            <p>{description}</p>
          </div>

          <div className="subscription-hero-side">
            <div className="subscription-access-note">
              <strong>{title}</strong>
              <span>
                Complete the required billing action to restore full
                company access while retaining existing HRMS data and
                configuration.
              </span>
            </div>

            {summary.shouldShowRenewalAction ? (
              <button
                type="button"
                className="primary"
                onClick={goToBilling}
              >
                <CreditCard size={18} />
                {actionLabel}
              </button>
            ) : null}
          </div>
        </section>

        <section
          className="subscription-info-grid"
          aria-label="Subscription summary"
        >
          <InfoCard
            label="Company"
            value={summary.companyName}
          />

          <InfoCard
            label="Current Status"
            value={summary.status || 'Expired'}
          />

          <InfoCard
            label={dateLabel}
            value={formatDate(summary.accessEndDate)}
          />

          <InfoCard
            label="Current Usage"
            value={employeeText}
          />
        </section>

        {loadError ? (
          <div className="subscription-error">
            <span>{loadError}</span>

            <button
              type="button"
              className="ghost"
              onClick={() =>
                loadBillingSummary({
                  feedbackScope: 'retry',
                })
              }
              disabled={loading}
            >
              {loading ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Retry
            </button>

            <SubscriptionInlineMessage
              message={feedbackMap.retry}
              onClose={() => clearFeedback('retry')}
            />
          </div>
        ) : null}

        <nav
          className="subscription-section-tabs"
          aria-label="Subscription renewal sections"
        >
          <button
            type="button"
            className={`subscription-section-tab ${
              activeSection === 'overview' ? 'is-active' : ''
            }`}
            onClick={() => setActiveSection('overview')}
            aria-pressed={activeSection === 'overview'}
          >
            <ShieldCheck size={18} />

            <span className="subscription-section-tab-copy">
              <strong>Renewal Overview</strong>
              <small>Payment impact and subscription details</small>
            </span>
          </button>

          <button
            type="button"
            className={`subscription-section-tab ${
              activeSection === 'plans' ? 'is-active' : ''
            }`}
            onClick={() => setActiveSection('plans')}
            aria-pressed={activeSection === 'plans'}
          >
            <CreditCard size={18} />

            <span className="subscription-section-tab-copy">
              <strong>Plans & Pricing</strong>
              <small>Current plans and active quotation details</small>
            </span>
          </button>
        </nav>

        {activeSection === 'overview' ? (
          <section className="subscription-section-content subscription-panel">
            <div className="subscription-panel-head">
              <h2>Renewal Overview</h2>
              <p>
                Review the current renewal requirement and what happens
                after successful payment.
              </p>
            </div>

            {summary.isPaid && summary.renewalAmount ? (
              <div className="subscription-renewal-note">
                <CreditCard size={19} />
                <strong>
                  Renewal amount: {formatCurrency(summary.renewalAmount)} per{' '}
                  {formatBillingInterval(summary.billingInterval)}
                </strong>
              </div>
            ) : null}

            <ul className="subscription-payment-list">
              <li>
                <CheckCircle2 size={16} />
                <span>
                  Company access is restored after Razorpay payment
                  verification.
                </span>
              </li>

              <li>
                <CheckCircle2 size={16} />
                <span>
                  Your existing employees, records, settings, and HRMS
                  data remain available.
                </span>
              </li>

              <li>
                <CheckCircle2 size={16} />
                <span>
                  Essential and Growth renew using the latest
                  Superadmin-configured price.
                </span>
              </li>

              <li>
                <CheckCircle2 size={16} />
                <span>
                  Premium renews using the active custom quotation until
                  Superadmin revises it.
                </span>
              </li>
            </ul>
          </section>
        ) : null}

        {activeSection === 'plans' ? (
          <section className="subscription-section-content subscription-panel">
            <div className="subscription-panel-head">
              <h2>Plans & Pricing</h2>
              <p>
                Review the plans returned by the existing billing summary
                before continuing to Billing.
              </p>
            </div>

            <div className="subscription-plan-grid">
              {loading && !summary.plans.length ? (
                <div className="subscription-plans-loading">
                  <span>
                    <Loader2 size={20} className="spin" />
                    Loading current plans...
                  </span>
                </div>
              ) : null}

              {!loading && !summary.plans.length ? (
                <div className="subscription-plans-empty">
                  Current plan prices are available on the Billing page.
                </div>
              ) : null}

              {summary.plans.map((plan) => (
                <PlanPreview
                  key={plan.plan_code || plan.plan_name}
                  plan={plan}
                  premiumQuotation={summary.premiumQuotation}
                />
              ))}
            </div>
          </section>
        ) : null}

        <div className="subscription-actions">
          {summary.shouldShowRenewalAction ? (
            <button
              type="button"
              className="primary"
              onClick={goToBilling}
            >
              <CreditCard size={18} />
              {actionLabel}
            </button>
          ) : null}

          <div className="subscription-action-stack">
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
              {loading ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <RefreshCw size={18} />
              )}
              {loading ? 'Refreshing...' : 'Refresh Status'}
            </button>

            <SubscriptionInlineMessage
              message={feedbackMap.refresh}
              onClose={() => clearFeedback('refresh')}
            />
          </div>

          <button
            type="button"
            className="ghost"
            onClick={goBack}
          >
            <ArrowLeft size={18} />
            Back to Dashboard
          </button>
        </div>

        <div className="subscription-status-note">
          <CheckCircle2 size={16} />
          <span>
            Payment activation and invoice history are recorded
            automatically.
          </span>
        </div>
      </div>
    </section>
  );
}
