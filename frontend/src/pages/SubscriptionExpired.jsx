import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  CreditCard,
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
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return normalizeValue(value) || 'Not available';
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

function getPlanType(user = {}) {
  const subscription = getSubscription(user);
  const tenant = getTenant(user);

  return normalizeValue(
    subscription.plan_type ||
      tenant.plan_type ||
      user.plan_type ||
      'demo',
  ).toLowerCase();
}

function getStatus(user = {}) {
  const subscription = getSubscription(user);
  const tenant = getTenant(user);

  return normalizeValue(
    subscription.status ||
      tenant.status ||
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
    tenant.trial_end_date ||
    tenant.subscription_end_date ||
    user.trial_end_date ||
    user.subscription_end_date ||
    ''
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
    10;

  return {
    used,
    limit,
  };
}

export default function SubscriptionExpired({ user = {}, setPage }) {
  const summary = useMemo(() => {
    const employeeUsage = getEmployeeUsage(user);

    return {
      companyName: getCompanyName(user),
      planType: getPlanType(user),
      status: getStatus(user),
      trialEndDate: getTrialEndDate(user),
      employeesUsed: employeeUsage.used,
      employeeLimit: employeeUsage.limit,
    };
  }, [user]);

  function goToBilling() {
    if (typeof setPage === 'function') {
      setPage('billing');
    }

    try {
      window.history.pushState({}, '', '/billing');
    } catch {
      // Ignore browser history errors.
    }
  }

  function goBack() {
    if (typeof setPage === 'function') {
      setPage('dashboard');
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 1100, margin: '0 auto' }}>
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
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Demo Subscription Exhausted
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
              Your 30-day demo has ended
            </h1>

            <p
              style={{
                margin: '14px 0 0',
                maxWidth: 760,
                color: '#475569',
                fontSize: 16,
                lineHeight: 1.7,
              }}
            >
              Please subscribe to the paid version of YourComate HRMS to continue
              using the system and unlock the full HRMS feature set.
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
          <div className="stat-card" style={{ padding: 18 }}>
            <Building2 size={24} />
            <span>Company</span>
            <strong>{summary.companyName}</strong>
          </div>

          <div className="stat-card" style={{ padding: 18 }}>
            <Lock size={24} />
            <span>Current Status</span>
            <strong style={{ textTransform: 'capitalize' }}>
              {summary.status || 'Expired'}
            </strong>
          </div>

          <div className="stat-card" style={{ padding: 18 }}>
            <CalendarClock size={24} />
            <span>Demo End Date</span>
            <strong>{formatDate(summary.trialEndDate)}</strong>
          </div>

          <div className="stat-card" style={{ padding: 18 }}>
            <Users size={24} />
            <span>Demo Employee Limit</span>
            <strong>
              {summary.employeesUsed || 0} / {summary.employeeLimit || 10}
            </strong>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 18,
            marginTop: 24,
          }}
        >
          <div
            style={{
              borderRadius: 22,
              padding: 22,
              background: '#ffffff',
              border: '1px solid rgba(226,232,240,0.9)',
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
              Demo access was limited to
            </h3>

            <ul
              style={{
                margin: 0,
                paddingLeft: 20,
                color: '#475569',
                lineHeight: 1.9,
              }}
            >
              <li>Attendance module</li>
              <li>Apply Leave module</li>
              <li>Projects module</li>
              <li>Maximum 10 employees</li>
            </ul>
          </div>

          <div
            style={{
              borderRadius: 22,
              padding: 22,
              background: '#ffffff',
              border: '1px solid rgba(226,232,240,0.9)',
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
              <CreditCard size={22} color="#7c3aed" />
              Paid version will unlock
            </h3>

            <ul
              style={{
                margin: 0,
                paddingLeft: 20,
                color: '#475569',
                lineHeight: 1.9,
              }}
            >
              <li>All HRMS modules</li>
              <li>Continued company access</li>
              <li>Subscription-based usage</li>
              <li>Superadmin monitoring and billing records</li>
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
            onClick={goToBilling}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              minHeight: 46,
            }}
          >
            <CreditCard size={18} />
            Upgrade / Subscribe Now
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