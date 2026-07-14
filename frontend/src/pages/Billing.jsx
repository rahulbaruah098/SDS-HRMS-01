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

function getAmount(summary = {}) {
  const plan = summary.plan || summary.payment_plan || summary.upgrade_plan || {};

  return (
    summary.amount ||
    summary.plan_amount ||
    summary.saas_full_plan_amount ||
    plan.amount ||
    4999
  );
}

function getCurrency(summary = {}) {
  const plan = summary.plan || summary.payment_plan || summary.upgrade_plan || {};

  return summary.currency || plan.currency || 'INR';
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

export default function Billing({ user = {}, setPage }) {
  const { showAlert } = useCustomAlert();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);

  const computed = useMemo(() => {
    const planType = getPlanType(summary || {}, user);
    const status = getStatus(summary || {}, user);
    const employeeUsage = getEmployeeUsage(summary || {}, user);
    const daysLeft = getDaysLeft(summary || {}, user);
    const amount = getAmount(summary || {});
    const currency = getCurrency(summary || {});

    return {
      companyName: getCompanyName(summary || {}, user),
      companyEmail: getCompanyEmail(summary || {}, user),
      planType,
      status,
      trialEndDate: getTrialEndDate(summary || {}, user),
      daysLeft,
      employeesUsed: employeeUsage.used,
      employeeLimit: employeeUsage.limit,
      amount,
      currency,
      isLifetime: planType === 'lifetime' || summary?.is_sds_company || summary?.has_lifetime_access,
      isPaid: planType === 'paid' && status !== 'expired' && status !== 'suspended',
      isExpired: status === 'expired' || status === 'suspended' || daysLeft === 0,
      isDemo: planType === 'demo',
    };
  }, [summary, user]);

  async function loadBillingSummary() {
    setLoading(true);

    try {
      const data = await api('/billing/summary');
      setSummary(data);
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
          'Payment was received but verification failed. Please contact Superadmin.',
        type: 'error',
      });
    } finally {
      setVerifyingPayment(false);
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

    setCreatingOrder(true);

    try {
      await loadRazorpayCheckout();

      const orderResponse = await api('/billing/create-order', {
        method: 'POST',
        body: JSON.stringify({
          plan_name: 'Full HRMS',
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
        currency: order.currency || computed.currency || 'INR',
        name: 'YourComate HRMS',
        description: orderResponse.description || 'Full HRMS Subscription',
        order_id: order.id || order.razorpay_order_id,
        prefill: {
          name: computed.companyName,
          email: computed.companyEmail,
        },
        notes: {
          company_name: computed.companyName,
          plan_name: 'Full HRMS',
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
              Upgrade to full HRMS access
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
              Demo companies can subscribe through Razorpay to unlock the full
              YourComate HRMS suite. SDS lifetime access remains payment-free.
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
              minWidth: 240,
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
              Upgrade Plan
            </p>
            <h2 style={{ margin: '6px 0 0', color: '#0f172a' }}>
              {formatCurrency(computed.amount, computed.currency)}
            </h2>
            <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 13 }}>
              Full HRMS subscription
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
                label="Upgrade Amount"
                value={formatCurrency(computed.amount, computed.currency)}
                tone="#16a34a"
              />
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
                    modules are unlocked.
                  </p>
                ) : computed.isExpired ? (
                  <p style={{ margin: 0, color: '#991b1b', lineHeight: 1.7 }}>
                    Demo access is expired or suspended. Please subscribe to
                    continue using YourComate HRMS.
                  </p>
                ) : (
                  <p style={{ margin: 0, color: '#475569', lineHeight: 1.7 }}>
                    Demo access is active. Days left:{' '}
                    <strong>{computed.daysLeft ?? 'Not available'}</strong>.
                    Demo users can access Attendance, Apply Leave, and Projects.
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
                  Full HRMS Unlocks
                </h3>

                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    color: '#475569',
                    lineHeight: 1.85,
                  }}
                >
                  <li>All HRMS modules</li>
                  <li>Full employee operations</li>
                  <li>Assets, policies, reports, grievance, IT support</li>
                  <li>AI Assistant and advanced company workflows</li>
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
                {creatingOrder || verifyingPayment ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <CreditCard size={18} />
                )}
                {verifyingPayment
                  ? 'Verifying Payment...'
                  : creatingOrder
                    ? 'Opening Razorpay...'
                    : computed.isPaid
                      ? 'Already Paid'
                      : computed.isLifetime
                        ? 'Lifetime Access'
                        : 'Pay with Razorpay'}
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
                  Razorpay test mode can be used with test card/payment details.
                  After successful verification, the backend will mark this
                  company as paid and unlock full HRMS access.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}