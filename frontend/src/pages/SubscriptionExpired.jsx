import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  CreditCard,
  IndianRupee,
  Lock,
  ShieldCheck,
  Users,
} from 'lucide-react';

function normalizeValue(value) {
  return String(value || '').trim();
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

function getSubscription(user = {}) {
  return user.subscription || user.saas_subscription || {};
}

function getTenant(user = {}) {
  return user.tenant || user.company || {};
}

function getCompanyName(user = {}) {
  const tenant = getTenant(user);

  return (
    user.company_name ||
    tenant.company_name ||
    tenant.name ||
    tenant.legal_name ||
    'Your company'
  );
}

function getStatus(user = {}) {
  const subscription = getSubscription(user);
  const tenant = getTenant(user);

  return normalizeValue(
    subscription.status ||
      subscription.subscription_status ||
      tenant.status ||
      tenant.subscription_status ||
      user.subscription_status ||
      user.status ||
      'expired',
  ).toLowerCase();
}

function getTrialEndDate(user = {}) {
  const subscription = getSubscription(user);
  const tenant = getTenant(user);

  return (
    subscription.trial_end_date ||
    subscription.end_date ||
    subscription.subscription_end_date ||
    tenant.trial_end_date ||
    tenant.subscription_end_date ||
    tenant.end_date ||
    user.trial_end_date ||
    user.subscription_end_date ||
    user.end_date
  );
}

function getPlanName(user = {}) {
  const subscription = getSubscription(user);
  const tenant = getTenant(user);

  return (
    subscription.plan_name ||
    subscription.plan_label ||
    subscription.display_name ||
    tenant.plan_name ||
    tenant.plan_label ||
    user.plan_name ||
    '15-Day Full Access Trial'
  );
}

function getEmployeeUsage(user = {}) {
  const subscription = getSubscription(user);
  const tenant = getTenant(user);

  const used =
    subscription.employee_count ??
    subscription.employees_used ??
    tenant.employee_count ??
    tenant.employees_used ??
    user.employee_count ??
    user.employees_used ??
    0;

  const limit =
    subscription.employee_limit ??
    tenant.employee_limit ??
    user.employee_limit ??
    null;

  const isUnlimited =
    subscription.is_unlimited_employees ||
    tenant.is_unlimited_employees ||
    limit === null ||
    limit === undefined ||
    normalizeValue(limit).toLowerCase() === 'unlimited';

  return {
    used,
    limit,
    isUnlimited,
  };
}

function goToPath(path, fallbackPage) {
  try {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    if (path) {
      window.location.href = path;
    } else if (fallbackPage) {
      window.location.href = `/${fallbackPage}`;
    }
  }
}

function InfoCard({ icon: Icon, label, value, tone = '#2563eb' }) {
  return (
    <div className="stat-card" style={{ padding: 18 }}>
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

function PlanPreview({ title, price, employeeLimit, recommended }) {
  return (
    <div
      style={{
        borderRadius: 20,
        padding: 18,
        background: recommended
          ? 'linear-gradient(135deg, rgba(239,246,255,0.98), #ffffff)'
          : '#ffffff',
        border: recommended
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
        <h3 style={{ margin: 0, color: '#0f172a' }}>{title}</h3>
        {recommended ? (
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
        {price === 'Custom' ? null : <IndianRupee size={21} />}
        {price}
      </p>

      <p style={{ margin: '8px 0 0', color: '#64748b', lineHeight: 1.6 }}>
        {employeeLimit}
      </p>
    </div>
  );
}

export default function SubscriptionExpired({ user = {}, setPage }) {
  const summary = useMemo(() => {
    const employeeUsage = getEmployeeUsage(user);

    return {
      companyName: getCompanyName(user),
      status: getStatus(user),
      trialEndDate: getTrialEndDate(user),
      planName: getPlanName(user),
      employeesUsed: employeeUsage.used,
      employeeLimit: employeeUsage.limit,
      isUnlimitedEmployees: employeeUsage.isUnlimited,
    };
  }, [user]);

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

  return (
    <section className="panel" style={{ maxWidth: 1120, margin: '0 auto' }}>
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
              Subscription Required
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
              Your 15-day full-access trial has ended
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
              Please choose a paid subscription plan to continue using YourComate
              HRMS. After successful payment, this trial company will become an
              official registered paid company.
            </p>
          </div>
        </div>

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
            label="Trial End Date"
            value={formatDate(summary.trialEndDate)}
            tone="#dc2626"
          />

          <InfoCard
            icon={Users}
            label="Current Usage"
            value={employeeText}
            tone="#7c3aed"
          />
        </div>

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
            What changes after upgrade?
          </h3>

          <ul
            style={{
              margin: 0,
              paddingLeft: 20,
              color: '#475569',
              lineHeight: 1.9,
            }}
          >
            <li>Your company access is restored immediately after payment verification.</li>
            <li>All HRMS modules remain available according to the selected paid plan.</li>
            <li>Employee limit is applied based on Essential, Growth, or Premium.</li>
            <li>Billing, subscription, and payment records are visible to Superadmin.</li>
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
          <PlanPreview
            title="Essential"
            price="2,495 / month"
            employeeLimit="Up to 50 employees"
          />
          <PlanPreview
            title="Growth"
            price="4,495 / month"
            employeeLimit="Up to 100 employees"
            recommended
          />
          <PlanPreview
            title="Premium"
            price="Custom"
            employeeLimit="Unlimited employees"
          />
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
            onClick={goToBilling}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              minHeight: 46,
            }}
          >
            <CreditCard size={18} />
            Open Billing & Upgrade
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
      </div>
    </section>
  );
}