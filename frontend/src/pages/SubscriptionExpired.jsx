import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Users,
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

function InfoCard({ icon: Icon, label, value, tone = '#2563eb' }) {
  return (
    <div className="stat-card subscription-info-card" style={{ padding: 18 }}>
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
      (premiumQuotation.quoted_billing_interval || premiumQuotation.billing_interval)) ||
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
    <div
      className={`subscription-plan-card ${isRecommended ? 'recommended' : ''}`}
      style={{
        borderRadius: 20,
        padding: 18,
        background: isRecommended
          ? 'linear-gradient(135deg, rgba(239,246,255,0.98), #ffffff)'
          : '#ffffff',
        border: isRecommended
          ? '1px solid rgba(37,99,235,0.38)'
          : '1px solid rgba(226,232,240,0.9)',
        boxShadow: '0 14px 32px rgba(15,23,42,0.05)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start',
          marginBottom: 10,
        }}
      >
        <h3 style={{ margin: 0, color: '#0f172a' }}>{plan.plan_name}</h3>
        {isRecommended ? (
          <span
            style={{
              borderRadius: 999,
              background: 'rgba(37,99,235,0.12)',
              color: '#1d4ed8',
              padding: '4px 9px',
              fontSize: 11,
              fontWeight: 900,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Recommended
          </span>
        ) : null}
      </div>

      <p
        style={{
          margin: 0,
          color: '#0f172a',
          fontSize: 24,
          fontWeight: 900,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {toNumber(amount, 0) > 0 ? <IndianRupee size={21} /> : null}
        {toNumber(amount, 0) > 0
          ? `${new Intl.NumberFormat('en-IN', {
              maximumFractionDigits: 2,
            }).format(toNumber(amount, 0))} / ${formatBillingInterval(interval)}`
          : formatCurrency(amount, currency)}
      </p>

      <p style={{ margin: '8px 0 0', color: '#64748b', lineHeight: 1.6 }}>
        {employeeLimit}
      </p>

      {isPremium && quotedAmount ? (
        <p style={{ margin: '8px 0 0', color: '#15803d', fontWeight: 800 }}>
          Your active quotation
        </p>
      ) : null}
    </div>
  );
}

export default function SubscriptionExpired({ user = {}, setPage }) {
  const [billingSummary, setBillingSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [redirecting, setRedirecting] = useState(false);

  async function loadBillingSummary() {
    setLoading(true);
    setLoadError('');

    try {
      const data = await api('/billing/summary');
      setBillingSummary(data || {});
    } catch (error) {
      setLoadError(
        error?.message ||
          'Billing details could not be loaded. You can still open Billing and try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBillingSummary();
  }, []);

  const summary = useMemo(() => {
    const source = billingSummary || {};
    const employeeUsage = getEmployeeUsage(source, user);
    const planType = getPlanType(source, user);
    const status = getStatus(source, user);
    const planName = getPlanName(source, user);
    const isTrial = ['demo', 'trial'].includes(planType);
    const isPaid = planType === 'paid' || ['essential', 'growth', 'premium'].includes(planType);
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
        window.history.replaceState({}, '', '/dashboard');
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
  }, [billingSummary, loading, setPage, summary.shouldHideRenewalScreen]);

  function goToBilling() {
    if (typeof setPage === 'function') {
      setPage('billing');
    }

    goToPath('/billing', 'billing');
  }

  function goBack() {
    if (typeof setPage === 'function') {
      setPage('dashboard');
      return;
    }

    goToPath('/dashboard', 'dashboard');
  }

  const employeeText = summary.isUnlimitedEmployees
    ? `${summary.employeesUsed || 0} / Unlimited`
    : `${summary.employeesUsed || 0} / ${summary.employeeLimit || 'Plan limit'}`;

  const title = summary.isTrial
    ? 'Your full-access trial has ended'
    : `${summary.planName || 'Your subscription'} requires renewal`;

  const description = summary.isTrial
    ? 'Choose a paid subscription to continue using YourComate HRMS. After successful payment, this trial company becomes an official paid company.'
    : 'Your paid subscription period has ended or payment is due. Complete renewal payment to restore company access while keeping the existing company data and configuration.';

  const dateLabel = summary.isTrial ? 'Trial End Date' : 'Renewal Due Date';
  const actionLabel = summary.isTrial ? 'Open Billing & Upgrade' : 'Open Billing & Renew';

  if (redirecting || (!loading && summary.shouldHideRenewalScreen)) {
    return (
      <section className="panel subscription-expired-page subscription-active-state" style={{ maxWidth: 760, margin: '0 auto' }}>

      <style>{`
        .subscription-expired-page {
          --sub-ink: #101a3a;
          --sub-muted: #596483;
          --sub-primary: #6254da;
          --sub-deep: #342b78;
          --sub-blue: #3766db;
          --sub-teal: #18aaa8;
          --sub-orange: #d96517;
          --sub-green: #13736f;
          --sub-red: #b62f55;
          --sub-flat-blue: #b9d7ff;
          --sub-flat-violet: #c9c0ff;
          --sub-ease: cubic-bezier(.22, 1, .36, 1);

          width: min(1120px, 100%);
          overflow: visible;
          border: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          color: var(--sub-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .subscription-expired-page > div {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          padding: clamp(22px, 3vw, 36px) !important;
          border: 1px solid rgba(171, 181, 211, .72) !important;
          border-radius: clamp(26px, 2.5vw, 38px) !important;
          background:
            radial-gradient(circle at 8% 4%, rgba(255, 207, 146, .38), transparent 30%),
            radial-gradient(circle at 94% 2%, rgba(191, 190, 249, .32), transparent 35%),
            linear-gradient(135deg, #fff8ed 0%, #fffdf8 48%, #f7f2ff 100%) !important;
          box-shadow:
            12px 14px 0 var(--sub-flat-blue),
            0 28px 48px rgba(34, 38, 110, .13) !important;
        }

        .subscription-expired-page > div::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -2;
          opacity: .42;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(65, 55, 161, .035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(65, 55, 161, .035) 1px, transparent 1px);
          background-size: 42px 42px;
        }

        .subscription-expired-page > div::after {
          content: "";
          position: absolute;
          z-index: -1;
          width: clamp(170px, 22vw, 300px);
          aspect-ratio: 1;
          right: clamp(-120px, -8vw, -65px);
          top: clamp(-125px, -8vw, -70px);
          border: 1px solid rgba(65, 55, 161, .12);
          border-radius: 34% 66% 58% 42% / 44% 38% 62% 56%;
          background: linear-gradient(
            145deg,
            rgba(255, 202, 139, .74),
            rgba(193, 179, 255, .72)
          );
          transform: rotate(18deg);
        }

        .subscription-expired-page button {
          touch-action: manipulation;
          font-weight: 900;
          transition:
            transform 240ms var(--sub-ease),
            box-shadow 240ms var(--sub-ease),
            border-color 200ms ease,
            background 200ms ease,
            color 200ms ease,
            filter 200ms ease;
        }

        .subscription-expired-page button:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .subscription-expired-page button:active:not(:disabled) {
          transform: translateY(0) scale(.985);
        }

        .subscription-expired-page button:disabled {
          cursor: not-allowed;
          opacity: .56;
          transform: none;
          filter: none;
        }

        .subscription-expired-page .primary,
        .subscription-expired-page .ghost {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          min-height: 46px;
          padding: 0 17px;
          border-radius: 14px;
          line-height: 1;
          white-space: nowrap;
        }

        .subscription-expired-page .primary {
          border: 1px solid rgba(52, 43, 120, .16);
          color: #fff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow:
            5px 6px 0 rgba(52, 43, 120, .8),
            0 12px 22px rgba(55, 102, 219, .16);
        }

        .subscription-expired-page .ghost {
          border: 1px solid rgba(98, 84, 218, .18);
          color: var(--sub-deep);
          background: #f1efff;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .14);
        }

        .subscription-expired-page h1,
        .subscription-expired-page h2,
        .subscription-expired-page h3 {
          color: var(--sub-ink) !important;
          font-family: var(--yc-display, var(--heading), inherit);
        }

        .subscription-expired-page h1 {
          font-size: clamp(31px, 4.5vw, 56px) !important;
          font-weight: 760 !important;
          line-height: .98 !important;
          letter-spacing: -.055em !important;
        }

        .subscription-expired-page p,
        .subscription-expired-page li {
          color: var(--sub-muted);
        }

        .subscription-expired-page .subscription-info-card {
          min-width: 0;
          min-height: 124px;
          border: 1px solid rgba(171, 181, 211, .68) !important;
          border-radius: 21px !important;
          background: #f8fbff !important;
          box-shadow:
            7px 9px 0 var(--sub-flat-blue),
            0 18px 30px rgba(15, 20, 75, .08) !important;
          transition:
            transform 260ms var(--sub-ease),
            border-color 220ms ease !important;
        }

        .subscription-expired-page .subscription-info-card:nth-child(2) {
          background: #fff4d5 !important;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(15, 20, 75, .08) !important;
        }

        .subscription-expired-page .subscription-info-card:nth-child(3) {
          background: #ffe8ef !important;
          box-shadow:
            7px 9px 0 #ffc4d5,
            0 18px 30px rgba(15, 20, 75, .08) !important;
        }

        .subscription-expired-page .subscription-info-card:nth-child(4) {
          background: #f1efff !important;
          box-shadow:
            7px 9px 0 var(--sub-flat-violet),
            0 18px 30px rgba(15, 20, 75, .08) !important;
        }

        .subscription-expired-page .subscription-info-card:hover {
          transform: translateY(-3px);
          border-color: rgba(98, 84, 218, .3) !important;
        }

        .subscription-expired-page .subscription-info-card > div:first-child {
          color: #fff !important;
          background: linear-gradient(145deg, #4f72df, #2bb9b5) !important;
          border: 1px solid rgba(52, 43, 120, .15);
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .16);
        }

        .subscription-expired-page .subscription-info-card span {
          display: block;
          color: var(--sub-muted);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .subscription-expired-page .subscription-info-card strong {
          display: block;
          margin-top: 7px;
          color: var(--sub-ink);
          font-size: 18px;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }

        .subscription-expired-page .subscription-plan-card {
          min-width: 0;
          border: 1px solid rgba(171, 181, 211, .68) !important;
          border-radius: 22px !important;
          background: linear-gradient(145deg, #fff, #f7fbff) !important;
          box-shadow:
            6px 8px 0 rgba(185, 215, 255, .76),
            0 18px 28px rgba(34, 38, 110, .08) !important;
          transition:
            transform 260ms var(--sub-ease),
            border-color 220ms ease !important;
        }

        .subscription-expired-page .subscription-plan-card:nth-child(2n) {
          box-shadow:
            6px 8px 0 rgba(174, 230, 217, .76),
            0 18px 28px rgba(34, 38, 110, .08) !important;
        }

        .subscription-expired-page .subscription-plan-card.recommended {
          border-color: rgba(98, 84, 218, .42) !important;
          background:
            radial-gradient(circle at 100% 0%, rgba(105, 217, 208, .18), transparent 36%),
            linear-gradient(145deg, #f1efff, #f7fbff) !important;
          box-shadow:
            7px 9px 0 var(--sub-flat-violet),
            0 20px 34px rgba(34, 38, 110, .12) !important;
        }

        .subscription-expired-page .subscription-plan-card:hover {
          transform: translateY(-4px);
          border-color: rgba(98, 84, 218, .35) !important;
        }

        .subscription-expired-page .subscription-plan-card h3 {
          font-size: 20px;
          font-weight: 950;
        }

        .subscription-expired-page ul {
          padding-left: 20px !important;
        }

        .subscription-expired-page li {
          margin-bottom: 6px;
          line-height: 1.7 !important;
        }

        .subscription-expired-page .spin {
          animation: subscriptionSpin .8s linear infinite;
        }

        @keyframes subscriptionSpin {
          to {
            transform: rotate(360deg);
          }
        }

        .subscription-active-state {
          width: min(760px, 100%);
        }

        .subscription-active-state > div {
          border-color: rgba(19, 115, 111, .24) !important;
          background:
            radial-gradient(circle at 12% 8%, rgba(174, 230, 217, .52), transparent 34%),
            linear-gradient(145deg, #eaf8f4, #fff) !important;
          box-shadow:
            10px 12px 0 var(--sub-flat-teal),
            0 24px 42px rgba(34, 38, 110, .1) !important;
        }

        @media (max-width: 760px) {
          .subscription-expired-page > div {
            padding: 20px !important;
            border-radius: 24px !important;
            box-shadow:
              7px 8px 0 var(--sub-flat-blue),
              0 18px 30px rgba(34, 38, 110, .1) !important;
          }

          .subscription-expired-page h1 {
            font-size: clamp(30px, 9vw, 42px) !important;
          }

          .subscription-expired-page .subscription-info-card,
          .subscription-expired-page .subscription-plan-card {
            border-radius: 18px !important;
          }

          .subscription-expired-page .primary,
          .subscription-expired-page .ghost {
            width: 100%;
          }
        }

        @media (max-width: 430px) {
          .subscription-expired-page > div {
            padding: 17px !important;
          }

          .subscription-expired-page .subscription-info-card {
            min-height: auto;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .subscription-expired-page *,
          .subscription-expired-page *::before,
          .subscription-expired-page *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>

        <div
          style={{
            minHeight: 280,
            borderRadius: 26,
            padding: 32,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            background: 'linear-gradient(135deg, rgba(240,253,244,0.98), #ffffff)',
            border: '1px solid rgba(22,163,74,0.22)',
          }}
        >
          <div>
            <CheckCircle2 size={46} color="#16a34a" />
            <h2 style={{ margin: '14px 0 8px', color: '#0f172a' }}>
              Subscription is active
            </h2>
            <p style={{ margin: 0, color: '#475569', lineHeight: 1.7 }}>
              Upgrade and renewal controls are no longer required. Returning to the dashboard.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel subscription-expired-page" style={{ maxWidth: 1120, margin: '0 auto' }}>

      <style>{`
        .subscription-expired-page {
          --sub-ink: #101a3a;
          --sub-muted: #596483;
          --sub-primary: #6254da;
          --sub-deep: #342b78;
          --sub-blue: #3766db;
          --sub-teal: #18aaa8;
          --sub-orange: #d96517;
          --sub-green: #13736f;
          --sub-red: #b62f55;
          --sub-flat-blue: #b9d7ff;
          --sub-flat-violet: #c9c0ff;
          --sub-ease: cubic-bezier(.22, 1, .36, 1);

          width: min(1120px, 100%);
          overflow: visible;
          border: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          color: var(--sub-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .subscription-expired-page > div {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          padding: clamp(22px, 3vw, 36px) !important;
          border: 1px solid rgba(171, 181, 211, .72) !important;
          border-radius: clamp(26px, 2.5vw, 38px) !important;
          background:
            radial-gradient(circle at 8% 4%, rgba(255, 207, 146, .38), transparent 30%),
            radial-gradient(circle at 94% 2%, rgba(191, 190, 249, .32), transparent 35%),
            linear-gradient(135deg, #fff8ed 0%, #fffdf8 48%, #f7f2ff 100%) !important;
          box-shadow:
            12px 14px 0 var(--sub-flat-blue),
            0 28px 48px rgba(34, 38, 110, .13) !important;
        }

        .subscription-expired-page > div::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -2;
          opacity: .42;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(65, 55, 161, .035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(65, 55, 161, .035) 1px, transparent 1px);
          background-size: 42px 42px;
        }

        .subscription-expired-page > div::after {
          content: "";
          position: absolute;
          z-index: -1;
          width: clamp(170px, 22vw, 300px);
          aspect-ratio: 1;
          right: clamp(-120px, -8vw, -65px);
          top: clamp(-125px, -8vw, -70px);
          border: 1px solid rgba(65, 55, 161, .12);
          border-radius: 34% 66% 58% 42% / 44% 38% 62% 56%;
          background: linear-gradient(
            145deg,
            rgba(255, 202, 139, .74),
            rgba(193, 179, 255, .72)
          );
          transform: rotate(18deg);
        }

        .subscription-expired-page button {
          touch-action: manipulation;
          font-weight: 900;
          transition:
            transform 240ms var(--sub-ease),
            box-shadow 240ms var(--sub-ease),
            border-color 200ms ease,
            background 200ms ease,
            color 200ms ease,
            filter 200ms ease;
        }

        .subscription-expired-page button:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .subscription-expired-page button:active:not(:disabled) {
          transform: translateY(0) scale(.985);
        }

        .subscription-expired-page button:disabled {
          cursor: not-allowed;
          opacity: .56;
          transform: none;
          filter: none;
        }

        .subscription-expired-page .primary,
        .subscription-expired-page .ghost {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          min-height: 46px;
          padding: 0 17px;
          border-radius: 14px;
          line-height: 1;
          white-space: nowrap;
        }

        .subscription-expired-page .primary {
          border: 1px solid rgba(52, 43, 120, .16);
          color: #fff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow:
            5px 6px 0 rgba(52, 43, 120, .8),
            0 12px 22px rgba(55, 102, 219, .16);
        }

        .subscription-expired-page .ghost {
          border: 1px solid rgba(98, 84, 218, .18);
          color: var(--sub-deep);
          background: #f1efff;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .14);
        }

        .subscription-expired-page h1,
        .subscription-expired-page h2,
        .subscription-expired-page h3 {
          color: var(--sub-ink) !important;
          font-family: var(--yc-display, var(--heading), inherit);
        }

        .subscription-expired-page h1 {
          font-size: clamp(31px, 4.5vw, 56px) !important;
          font-weight: 760 !important;
          line-height: .98 !important;
          letter-spacing: -.055em !important;
        }

        .subscription-expired-page p,
        .subscription-expired-page li {
          color: var(--sub-muted);
        }

        .subscription-expired-page .subscription-info-card {
          min-width: 0;
          min-height: 124px;
          border: 1px solid rgba(171, 181, 211, .68) !important;
          border-radius: 21px !important;
          background: #f8fbff !important;
          box-shadow:
            7px 9px 0 var(--sub-flat-blue),
            0 18px 30px rgba(15, 20, 75, .08) !important;
          transition:
            transform 260ms var(--sub-ease),
            border-color 220ms ease !important;
        }

        .subscription-expired-page .subscription-info-card:nth-child(2) {
          background: #fff4d5 !important;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(15, 20, 75, .08) !important;
        }

        .subscription-expired-page .subscription-info-card:nth-child(3) {
          background: #ffe8ef !important;
          box-shadow:
            7px 9px 0 #ffc4d5,
            0 18px 30px rgba(15, 20, 75, .08) !important;
        }

        .subscription-expired-page .subscription-info-card:nth-child(4) {
          background: #f1efff !important;
          box-shadow:
            7px 9px 0 var(--sub-flat-violet),
            0 18px 30px rgba(15, 20, 75, .08) !important;
        }

        .subscription-expired-page .subscription-info-card:hover {
          transform: translateY(-3px);
          border-color: rgba(98, 84, 218, .3) !important;
        }

        .subscription-expired-page .subscription-info-card > div:first-child {
          color: #fff !important;
          background: linear-gradient(145deg, #4f72df, #2bb9b5) !important;
          border: 1px solid rgba(52, 43, 120, .15);
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .16);
        }

        .subscription-expired-page .subscription-info-card span {
          display: block;
          color: var(--sub-muted);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .subscription-expired-page .subscription-info-card strong {
          display: block;
          margin-top: 7px;
          color: var(--sub-ink);
          font-size: 18px;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }

        .subscription-expired-page .subscription-plan-card {
          min-width: 0;
          border: 1px solid rgba(171, 181, 211, .68) !important;
          border-radius: 22px !important;
          background: linear-gradient(145deg, #fff, #f7fbff) !important;
          box-shadow:
            6px 8px 0 rgba(185, 215, 255, .76),
            0 18px 28px rgba(34, 38, 110, .08) !important;
          transition:
            transform 260ms var(--sub-ease),
            border-color 220ms ease !important;
        }

        .subscription-expired-page .subscription-plan-card:nth-child(2n) {
          box-shadow:
            6px 8px 0 rgba(174, 230, 217, .76),
            0 18px 28px rgba(34, 38, 110, .08) !important;
        }

        .subscription-expired-page .subscription-plan-card.recommended {
          border-color: rgba(98, 84, 218, .42) !important;
          background:
            radial-gradient(circle at 100% 0%, rgba(105, 217, 208, .18), transparent 36%),
            linear-gradient(145deg, #f1efff, #f7fbff) !important;
          box-shadow:
            7px 9px 0 var(--sub-flat-violet),
            0 20px 34px rgba(34, 38, 110, .12) !important;
        }

        .subscription-expired-page .subscription-plan-card:hover {
          transform: translateY(-4px);
          border-color: rgba(98, 84, 218, .35) !important;
        }

        .subscription-expired-page .subscription-plan-card h3 {
          font-size: 20px;
          font-weight: 950;
        }

        .subscription-expired-page ul {
          padding-left: 20px !important;
        }

        .subscription-expired-page li {
          margin-bottom: 6px;
          line-height: 1.7 !important;
        }

        .subscription-expired-page .spin {
          animation: subscriptionSpin .8s linear infinite;
        }

        @keyframes subscriptionSpin {
          to {
            transform: rotate(360deg);
          }
        }

        .subscription-active-state {
          width: min(760px, 100%);
        }

        .subscription-active-state > div {
          border-color: rgba(19, 115, 111, .24) !important;
          background:
            radial-gradient(circle at 12% 8%, rgba(174, 230, 217, .52), transparent 34%),
            linear-gradient(145deg, #eaf8f4, #fff) !important;
          box-shadow:
            10px 12px 0 var(--sub-flat-teal),
            0 24px 42px rgba(34, 38, 110, .1) !important;
        }

        @media (max-width: 760px) {
          .subscription-expired-page > div {
            padding: 20px !important;
            border-radius: 24px !important;
            box-shadow:
              7px 8px 0 var(--sub-flat-blue),
              0 18px 30px rgba(34, 38, 110, .1) !important;
          }

          .subscription-expired-page h1 {
            font-size: clamp(30px, 9vw, 42px) !important;
          }

          .subscription-expired-page .subscription-info-card,
          .subscription-expired-page .subscription-plan-card {
            border-radius: 18px !important;
          }

          .subscription-expired-page .primary,
          .subscription-expired-page .ghost {
            width: 100%;
          }
        }

        @media (max-width: 430px) {
          .subscription-expired-page > div {
            padding: 17px !important;
          }

          .subscription-expired-page .subscription-info-card {
            min-height: auto;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .subscription-expired-page *,
          .subscription-expired-page *::before,
          .subscription-expired-page *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>

      <div
        style={{
          borderRadius: 28,
          padding: '32px',
          background:
            'linear-gradient(135deg, rgba(255,247,237,0.96), rgba(255,255,255,0.98))',
          border: '1px solid rgba(251,146,60,0.28)',
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.08)',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 18,
            alignItems: 'flex-start',
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 22,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(251,146,60,0.16)',
              color: '#ea580c',
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={34} />
          </div>

          <div style={{ flex: '1 1 520px' }}>
            <p
              style={{
                margin: '0 0 8px',
                color: '#ea580c',
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {summary.isTrial ? 'Subscription Required' : 'Renewal Required'}
            </p>

            <h1
              style={{
                margin: 0,
                color: '#0f172a',
                fontSize: 'clamp(28px, 4vw, 44px)',
                lineHeight: 1.1,
                letterSpacing: '-0.04em',
              }}
            >
              {title}
            </h1>

            <p
              style={{
                margin: '14px 0 0',
                maxWidth: 790,
                color: '#475569',
                fontSize: 16,
                lineHeight: 1.7,
              }}
            >
              {description}
            </p>
          </div>
        </div>

        {loadError ? (
          <div
            style={{
              marginTop: 22,
              borderRadius: 16,
              border: '1px solid rgba(220,38,38,0.22)',
              background: 'rgba(254,242,242,0.96)',
              color: '#991b1b',
              padding: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>{loadError}</span>
            <button
              type="button"
              className="ghost"
              onClick={loadBillingSummary}
              disabled={loading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              Retry
            </button>
          </div>
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 14,
            marginTop: 28,
          }}
        >
          <InfoCard
            icon={Building2}
            label="Company"
            value={summary.companyName}
            tone="#2563eb"
          />

          <InfoCard
            icon={Lock}
            label="Current Status"
            value={summary.status || 'Expired'}
            tone="#ea580c"
          />

          <InfoCard
            icon={CalendarClock}
            label={dateLabel}
            value={formatDate(summary.accessEndDate)}
            tone="#dc2626"
          />

          <InfoCard
            icon={Users}
            label="Current Usage"
            value={employeeText}
            tone="#7c3aed"
          />
        </div>

        {summary.isPaid && summary.renewalAmount ? (
          <div
            style={{
              marginTop: 20,
              borderRadius: 18,
              padding: 16,
              background: 'rgba(239,246,255,0.94)',
              border: '1px solid rgba(37,99,235,0.2)',
              color: '#1e3a8a',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <CreditCard size={20} />
            <strong>
              Renewal amount: {formatCurrency(summary.renewalAmount)} per{' '}
              {formatBillingInterval(summary.billingInterval)}
            </strong>
          </div>
        ) : null}

        <div
          style={{
            borderRadius: 24,
            padding: 22,
            background: '#ffffff',
            border: '1px solid rgba(226,232,240,0.9)',
            marginTop: 24,
          }}
        >
          <h3
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              margin: '0 0 12px',
              color: '#0f172a',
            }}
          >
            <ShieldCheck size={22} color="#2563eb" />
            What happens after payment?
          </h3>

          <ul
            style={{
              margin: 0,
              paddingLeft: 20,
              color: '#475569',
              lineHeight: 1.9,
            }}
          >
            <li>Company access is restored after Razorpay payment verification.</li>
            <li>Your existing employees, records, settings, and HRMS data remain available.</li>
            <li>Essential and Growth renew using the latest Superadmin-configured price.</li>
            <li>Premium renews using the active custom quotation until Superadmin revises it.</li>
          </ul>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 16,
            marginTop: 24,
          }}
        >
          {loading && !summary.plans.length ? (
            <div
              style={{
                gridColumn: '1 / -1',
                minHeight: 120,
                display: 'grid',
                placeItems: 'center',
                color: '#64748b',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <Loader2 size={20} className="spin" /> Loading current plans...
              </span>
            </div>
          ) : null}

          {!loading && !summary.plans.length ? (
            <div
              style={{
                gridColumn: '1 / -1',
                borderRadius: 18,
                padding: 18,
                background: '#ffffff',
                border: '1px solid rgba(226,232,240,0.9)',
                color: '#64748b',
              }}
            >
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

        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginTop: 28,
          }}
        >
          {summary.shouldShowRenewalAction ? (
            <button
              type="button"
              className="primary"
              onClick={goToBilling}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                minHeight: 46,
              }}
            >
              <CreditCard size={18} />
              {actionLabel}
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
            {loading ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
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

        <div
          style={{
            marginTop: 22,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#64748b',
            fontSize: 13,
          }}
        >
          <CheckCircle2 size={16} color="#16a34a" />
          Payment activation and invoice history are recorded automatically.
        </div>
      </div>
    </section>
  );
}