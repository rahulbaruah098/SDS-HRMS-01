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
  Sparkles,
  Unlock,
  Users,
} from 'lucide-react';

import { api, refreshCurrentSession } from '../api/client';
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

export default function Billing({ user = {}, setPage }) {
  const { showAlert } = useCustomAlert();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [selectedPlanCode, setSelectedPlanCode] = useState('');
  const [showSalesContact, setShowSalesContact] = useState(false);
  const [submittingPremiumRequest, setSubmittingPremiumRequest] = useState(false);
  const [premiumRequestId, setPremiumRequestId] = useState('');

  const plans = useMemo(() => getPlans(summary || {}), [summary]);
  const selectedPlan = useMemo(() => {
    return (
      plans.find((plan) => (plan.plan_code || plan.code) === selectedPlanCode) ||
      plans.find((plan) => (plan.plan_code || plan.code) === getDefaultPlanCode(summary || {})) ||
      plans[0] ||
      null
    );
  }, [plans, selectedPlanCode, summary]);

  const computed = useMemo(() => {
    const planType = getPlanType(summary || {}, user);
    const status = getStatus(summary || {}, user);
    const employeeUsage = getEmployeeUsage(summary || {}, user);
    const daysLeft = getDaysLeft(summary || {}, user);

    const selectedAmount = selectedPlan?.amount ?? summary?.amount ?? 4495;
    const selectedCurrency = selectedPlan?.currency ?? summary?.currency ?? 'INR';

    return {
      companyName: getCompanyName(summary || {}, user),
      companyEmail: getCompanyEmail(summary || {}, user),
      planType,
      status,
      trialEndDate: getTrialEndDate(summary || {}, user),
      daysLeft,
      employeesUsed: employeeUsage.used,
      employeeLimit: employeeUsage.limit,
      amount: selectedAmount,
      currency: selectedCurrency,
      isLifetime: planType === 'lifetime' || summary?.is_sds_company || summary?.has_lifetime_access,
      isPaid: planType === 'paid' && status !== 'expired' && status !== 'suspended',
      isExpired: status === 'expired' || status === 'suspended' || daysLeft === 0,
      isDemo: planType === 'demo',
    };
  }, [summary, user, selectedPlan]);

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

      setSelectedPlanCode(
        defaultCode ||
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

  function handleSelectPlan(planCode) {
    setSelectedPlanCode(planCode);
    setShowSalesContact(false);
    setPremiumRequestId('');
  }

  async function handlePaymentSuccess(paymentResponse, orderResponse) {
    setVerifyingPayment(true);

    try {
      const verifyPayload = {
        razorpay_order_id: paymentResponse.razorpay_order_id,
        razorpay_payment_id: paymentResponse.razorpay_payment_id,
        razorpay_signature: paymentResponse.razorpay_signature,
        local_order_id:
          orderResponse.local_order_id ||
          orderResponse.order_id ||
          orderResponse.id ||
          '',
        plan_code: orderResponse.plan_code || selectedPlanCode,
      };

      const data = await api('/billing/verify-payment', {
        method: 'POST',
        body: JSON.stringify(verifyPayload),
      });

      showAlert({
        title: 'Subscription activated',
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

      if (typeof setPage === 'function') {
        setPage('dashboard');
      }

      try {
        window.history.replaceState({}, '', '/');
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

  async function submitPremiumRequest() {
    if (!selectedPlan) {
      showAlert({
        title: 'Select Premium plan',
        message: 'Please select the Premium plan before contacting the sales team.',
        type: 'warning',
      });
      return;
    }

    setSubmittingPremiumRequest(true);
    setShowSalesContact(true);

    try {
      const planCode = selectedPlan.plan_code || selectedPlan.code || selectedPlanCode || 'premium';
      const planName = selectedPlan.display_name || selectedPlan.plan_name || 'Premium';

      const data = await api('/billing/premium-request', {
        method: 'POST',
        body: JSON.stringify({
          plan_code: planCode,
          contact_name:
            user.name ||
            user.full_name ||
            user.employee_name ||
            computed.companyName,
          contact_email: user.email || computed.companyEmail,
          contact_phone: user.phone || user.mobile || user.contact_no || '',
          employee_count: computed.employeesUsed,
          message:
            'The company has selected the Premium custom plan from the Billing page and requested sales follow-up.',
          requirements: {
            requested_plan: planName,
            employee_count: computed.employeesUsed,
            current_employee_limit: computed.employeeLimit,
            onboarding: 'To be discussed with sales team',
            training: 'To be discussed with sales team',
            support_sla: 'Premium / enterprise support discussion required',
            custom_modules: 'To be discussed with sales team',
          },
        }),
      });

      const requestId =
        data.request_id ||
        data.request?._id ||
        data.request?.id ||
        '';

      setPremiumRequestId(requestId);

      showAlert({
        title: 'Premium request submitted',
        message:
          data.message ||
          'Your Premium request has been shared with the sales team. They will contact the company with quotation and payment details.',
        type: 'success',
      });
    } catch (error) {
      showAlert({
        title: 'Unable to submit Premium request',
        message:
          error.message ||
          'Please try again or contact the sales/support team manually.',
        type: 'error',
      });
    } finally {
      setSubmittingPremiumRequest(false);
    }
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

    if (selectedPlan.is_custom_pricing || selectedPlan.allow_online_payment === false) {
      await submitPremiumRequest();
      return;
    }

    setCreatingOrder(true);

    try {
      await loadRazorpayCheckout();

      const orderResponse = await api('/billing/create-order', {
        method: 'POST',
        body: JSON.stringify({
          plan_code: selectedPlan.plan_code || selectedPlan.code || selectedPlanCode,
        }),
      });

      const order =
        orderResponse.order ||
        orderResponse.razorpay_order ||
        orderResponse;

      const razorpayKey =
        orderResponse.key_id ||
        orderResponse.razorpay_key_id ||
        orderResponse.key ||
        order.key_id ||
        order.key ||
        '';

      if (!razorpayKey) {
        throw new Error('Razorpay key ID is missing from backend response.');
      }

      if (!order.id && !order.razorpay_order_id) {
        throw new Error('Razorpay order ID is missing from backend response.');
      }

      const options = {
        key: razorpayKey,
        amount: order.amount,
        currency: order.currency || selectedPlan.currency || computed.currency || 'INR',
        name: 'YourComate HRMS',
        description:
          orderResponse.description ||
          `${selectedPlan.display_name || selectedPlan.plan_name || 'HRMS'} Subscription`,
        order_id: order.id || order.razorpay_order_id,
        prefill: {
          name: computed.companyName,
          email: computed.companyEmail,
        },
        notes: {
          company_name: computed.companyName,
          plan_code: selectedPlan.plan_code || selectedPlan.code || selectedPlanCode,
          plan_name: selectedPlan.display_name || selectedPlan.plan_name || selectedPlanCode,
        },
        theme: {
          color: '#2563eb',
        },
        handler: (paymentResponse) => {
          handlePaymentSuccess(paymentResponse, orderResponse);
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

  function goBack() {
    if (typeof setPage === 'function') {
      setPage('dashboard');
    }

    try {
      window.history.replaceState({}, '', '/');
    } catch {
      // Ignore browser history errors.
    }
  }

  const selectedPlanEmployeeText = selectedPlan?.is_unlimited_employees
    ? 'Unlimited'
    : `${selectedPlan?.employee_limit || selectedPlan?.included_employees || '—'} employees`;

  const isCustomSelected =
    Boolean(selectedPlan?.is_custom_pricing) || selectedPlan?.allow_online_payment === false;

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
              Choose your HRMS subscription
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
              Start with a 15-day full-access trial. After trial expiry, select
              Essential, Growth, or Premium to continue using YourComate HRMS.
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
              Selected Plan
            </p>
            <h2 style={{ margin: '6px 0 0', color: '#0f172a' }}>
              {selectedPlan?.display_name || selectedPlan?.plan_name || 'Growth'}
            </h2>
            <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 13 }}>
              {formatCurrency(selectedPlan?.amount ?? 4495, selectedPlan?.currency || 'INR')}
              {selectedPlan?.is_custom_pricing ? '' : ` / ${selectedPlan?.billing_interval || 'monthly'}`}
            </p>
            <p style={{ margin: '8px 0 0', color: '#334155', fontWeight: 800, fontSize: 13 }}>
              {selectedPlanEmployeeText}
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
                label="Trial / Subscription End"
                value={formatDate(computed.trialEndDate)}
                tone="#ea580c"
              />
              <SummaryCard
                icon={Users}
                label="Employees Used"
                value={`${computed.employeesUsed} / ${computed.employeeLimit}`}
                tone="#7c3aed"
              />
              <SummaryCard
                icon={IndianRupee}
                label="Selected Amount"
                value={formatCurrency(computed.amount, computed.currency)}
                tone="#16a34a"
              />
            </div>

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
                    Select a subscription plan
                  </h2>
                  <p style={{ margin: '6px 0 0', color: '#64748b' }}>
                    Essential and Growth can be paid online. Premium is handled by the sales team after quotation.
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
                      disabled={computed.isLifetime || computed.isPaid || creatingOrder || verifyingPayment || submittingPremiumRequest}
                      onSelect={handleSelectPlan}
                    />
                  );
                })}
              </div>
            </div>

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
                    This company already has active paid access. Full HRMS
                    modules are unlocked according to its selected plan.
                  </p>
                ) : computed.isExpired ? (
                  <p style={{ margin: 0, color: '#991b1b', lineHeight: 1.7 }}>
                    Trial access is expired or suspended. Please subscribe to
                    continue using YourComate HRMS.
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

            <div
              style={{
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
                alignItems: 'center',
                marginTop: 28,
              }}
            >
              <button
                type="button"
                className="primary"
                onClick={startRazorpayPayment}
                disabled={
                  creatingOrder ||
                  verifyingPayment ||
                  submittingPremiumRequest ||
                  computed.isLifetime ||
                  computed.isPaid
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
                      : computed.isPaid
                      ? 'Already Paid'
                      : computed.isLifetime
                        ? 'Lifetime Access'
                        : isCustomSelected
                          ? 'Contact Sales Team'
                          : `Pay for ${selectedPlan?.display_name || selectedPlan?.plan_name || 'Selected Plan'}`}
              </button>

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

            {showSalesContact && isCustomSelected ? (
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
                  Premium does not open Razorpay directly because the final amount is custom.
                  Your request is now saved and shared with the sales team. They will review the
                  company size, number of employees, onboarding requirement, support level and
                  any custom HRMS needs before sharing the final quotation and payment process.
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: 14,
                    marginTop: 18,
                  }}
                >
                  <div
                    style={{
                      borderRadius: 18,
                      padding: 16,
                      background: '#ffffff',
                      border: '1px solid rgba(226,232,240,0.9)',
                    }}
                  >
                    <strong style={{ color: '#0f172a' }}>Procedure</strong>
                    <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: '#475569', lineHeight: 1.75 }}>
                      <li>Sales team receives the Premium interest/request.</li>
                      <li>Company requirements and employee volume are discussed.</li>
                      <li>Quotation or payment link is shared after discussion.</li>
                      <li>After payment, Premium access is activated from Superadmin.</li>
                    </ul>
                  </div>

                  <div
                    style={{
                      borderRadius: 18,
                      padding: 16,
                      background: '#ffffff',
                      border: '1px solid rgba(226,232,240,0.9)',
                    }}
                  >
                    <strong style={{ color: '#0f172a' }}>Charges</strong>
                    <p style={{ margin: '10px 0 0', color: '#475569', lineHeight: 1.7 }}>
                      Premium charges are quote-based. The amount can change depending on employee
                      count, onboarding support, custom setup, training, SLA and enterprise support
                      requirements.
                    </p>
                  </div>
                </div>

                {premiumRequestId ? (
                  <p style={{ margin: '16px 0 0', color: '#166534', fontWeight: 900 }}>
                    Premium request submitted successfully. Request ID: {premiumRequestId}
                  </p>
                ) : (
                  <p style={{ margin: '16px 0 0', color: '#1e3a8a', fontWeight: 800 }}>
                    Click Contact Sales Team to submit this Premium request.
                  </p>
                )}
              </div>
            ) : null}


            {!computed.isLifetime && !computed.isPaid ? (
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
                    ? 'Premium is custom quoted. Contact Sales Team submits a request and sends it to the sales team for quotation follow-up.'
                    : 'Razorpay test mode can be used with test payment details. After successful verification, the selected plan employee limit will be applied automatically.'}
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}