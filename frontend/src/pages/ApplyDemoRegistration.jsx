import { useEffect, useState } from 'react';
import { BrowserRouter, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';
import AuthPageFooter from '../components/AuthPageFooter';
import AuthWorkflowCanvas from '../components/AuthWorkflowCanvas';
import CloudflareTurnstile from '../components/CloudflareTurnstile';
import Brand from '../components/Brand';
import Icon from '../components/Icon';
import '../styles/auth-pages.css';

const INITIAL_FORM = {
  company_name: '',
  company_email: '',
  company_phone: '',
  company_address: '',
  company_type: '',
  contact_person_name: '',
  contact_person_phone: '',
  requested_employee_count: '',
  message: '',
};

const COMPANY_TYPES = [
  ['', 'Select company type'],
  ['Private Limited', 'Private Limited'],
  ['Public Limited', 'Public Limited'],
  ['LLP', 'Limited Liability Partnership'],
  ['Partnership', 'Partnership'],
  ['Proprietorship', 'Proprietorship'],
  ['NGO / Society', 'NGO / Trust'],
  ['Other', 'Other'],
];

const STEPS = [
  ['01', 'Apply', 'Share the company and primary contact details.'],
  ['02', 'Verify', 'Confirm the registered company email through OTP.'],
  ['03', 'Review', 'Superadmin reviews the verified request.'],
  ['04', 'Access', 'Approved credentials are delivered by email.'],
];

const DEMO_PLANS = [
  {
    id: 'demo',
    name: 'Demo',
    label: '15 days',
    note: 'Up to 10 employees · Full Premium access',
    features: [
      'Every Premium module unlocked',
      'All business add-ons included',
      'Advanced attendance, payroll and HR workflows',
      'Performance, expenses, recruitment and alumni',
      'SSO, API, multi-company and enterprise reporting',
      'Saya AI included',
    ],
    action: ['Included in this request', '#demo-form'],
  },
  {
    id: 'essential',
    name: 'Essential',
    label: '₹2,495/month',
    note: 'Up to 50 employees',
    description: 'Starter HRMS subscription for small teams.',
    features: [
      'Full HRMS access',
      'Up to 50 employees',
      'Attendance, leave, projects and employee records',
      'Standard support',
    ],
    action: ['Choose Essential', '/contact?topic=essential'],
  },
  {
    id: 'growth',
    name: 'Growth',
    label: '₹4,495/month',
    note: 'Up to 100 employees',
    description: 'Recommended HRMS subscription for growing companies.',
    features: [
      'Full HRMS access',
      'Up to 100 employees',
      'All operational HRMS modules',
      'Priority support',
    ],
    action: ['Choose Growth', '/contact?topic=growth'],
    featured: true,
  },
  {
    id: 'premium',
    name: 'Premium',
    label: 'Custom',
    note: 'Unlimited employees',
    description: 'Custom enterprise HRMS subscription with unlimited employees.',
    features: [
      'Full HRMS access',
      'Unlimited employees',
      'All modules included',
      'Custom onboarding and support',
    ],
    action: ['Contact Sales', '/contact?topic=premium'],
  },
];


const PUBLIC_PAID_PLAN_CODES = ["essential", "growth", "premium"];

function normalizePublicPlanCode(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

function publicPlanAmount(plan = {}) {
  const amount = Number(plan.amount || 0);

  if (
    plan.is_custom_pricing ||
    plan.is_unlimited_employees ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return "Custom";
  }

  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: plan.currency || "INR",
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString("en-IN")}`;
  }
}

function publicPlanInterval(plan = {}) {
  if (plan.is_custom_pricing) {
    return "";
  }

  const interval = String(plan.billing_interval || "monthly")
    .trim()
    .toLowerCase();

  const labels = {
    monthly: "/month",
    quarterly: "/quarter",
    yearly: "/year",
    annual: "/year",
    annually: "/year",
    one_time: " one time",
    custom: "",
  };

  return labels[interval] ?? `/${interval.replaceAll("_", " ")}`;
}

function publicPlanEmployeeText(plan = {}) {
  if (plan.is_unlimited_employees) {
    return "Unlimited employees";
  }

  const limit = Number(
    plan.included_employees ?? plan.employee_limit,
  );

  if (Number.isFinite(limit) && limit > 0) {
    return `Up to ${limit.toLocaleString("en-IN")} employees`;
  }

  return "";
}

function mergeDemoPagePlans(payload = {}) {
  const livePlans = Array.isArray(payload.plans)
    ? payload.plans
    : [];

  const liveByCode = new Map(
    livePlans.map((plan) => [
      normalizePublicPlanCode(plan.plan_code),
      plan,
    ]),
  );

  return DEMO_PLANS.map((fallback) => {
    if (fallback.id === "demo") {
      return fallback;
    }

    const livePlan = liveByCode.get(fallback.id);

    if (!livePlan) {
      return fallback;
    }

    const features = Array.isArray(livePlan.features)
      ? livePlan.features
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [];

    return {
      ...fallback,
      id:
        normalizePublicPlanCode(livePlan.plan_code) ||
        fallback.id,
      name:
        livePlan.display_name ||
        livePlan.plan_name ||
        fallback.name,
      label: `${publicPlanAmount(livePlan)}${publicPlanInterval(livePlan)}`,
      note:
        publicPlanEmployeeText(livePlan) ||
        fallback.note,
      description:
        livePlan.description ||
        fallback.description,
      features: features.length
        ? features
        : fallback.features,
      featured:
        typeof livePlan.is_recommended === "boolean"
          ? livePlan.is_recommended
          : fallback.featured,
    };
  }).filter(
    (plan) =>
      plan.id === "demo" ||
      PUBLIC_PAID_PLAN_CODES.includes(plan.id),
  );
}


function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value = '') {
  return String(value || '').replace(/[^0-9+\-\s]/g, '').trim();
}

function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function fieldValue(form, key) {
  return String(form[key] || '').trim();
}

function preparePublicPageNavigation() {
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }

  window.scrollTo({
    top: 0,
    left: 0,
    behavior: 'auto',
  });
}

function getRequestStatusLabel(status = '') {
  const normalized = String(status || '').trim().toLowerCase();

  if (normalized === 'otp_pending') return 'OTP Verification Pending';
  if (normalized === 'pending') return 'Pending Superadmin Approval';
  if (normalized === 'approved') return 'Approved';
  if (normalized === 'rejected') return 'Rejected';

  return normalized ? normalized.replace(/_/g, ' ') : 'Not Submitted';
}

function Field({ label, note, children, wide = false }) {
  return (
    <label className={`demo-premium-field ${wide ? 'is-wide' : ''}`}>
      <span>
        <b>{label}</b>
        {note && <small>{note}</small>}
      </span>

      {children}
    </label>
  );
}

function DemoRegistrationContent() {
  const alerts = useCustomAlert();

  const [form, setForm] = useState(INITIAL_FORM);
  const [pricingPlans, setPricingPlans] = useState(DEMO_PLANS);
  const [otp, setOtp] = useState('');
  const [requestInfo, setRequestInfo] = useState(null);
  const [step, setStep] = useState('form');

  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');


  const requestId =
    requestInfo?.request_id ||
    requestInfo?.id ||
    requestInfo?._id ||
    '';

  const requestEmail =
    requestInfo?.email ||
    requestInfo?.company_email ||
    normalizeEmail(form.company_email);

  const requestStatus =
    requestInfo?.request?.status ||
    requestInfo?.status ||
    '';


  useEffect(() => {
    let active = true;

    async function loadPublicPricing() {
      try {
        const payload = await api('/billing/pricing', {
          method: 'GET',
          timeoutMs: 30000,
        });

        if (active) {
          setPricingPlans(mergeDemoPagePlans(payload));
        }
      } catch (error) {
        console.error('Unable to load public pricing plans.', error);

        if (active) {
          setPricingPlans(DEMO_PLANS);
        }
      }
    }

    loadPublicPricing();

    return () => {
      active = false;
    };
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function goToLogin() {
    window.location.href = '/login';
  }

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    goToLogin();
  }

  function validateForm() {
    const companyName = fieldValue(form, 'company_name');
    const companyEmail = normalizeEmail(form.company_email);
    const companyPhone = normalizePhone(form.company_phone);
    const contactPersonName = fieldValue(form, 'contact_person_name');
    const contactPersonPhone = normalizePhone(form.contact_person_phone);

    if (!companyName) {
      alerts.warning('Company name is required.', 'Missing Company Name');
      return false;
    }

    if (!companyEmail) {
      alerts.warning('Company email is required.', 'Missing Company Email');
      return false;
    }

    if (!isValidEmail(companyEmail)) {
      alerts.warning(
        'Please enter a valid company email address.',
        'Invalid Email',
      );
      return false;
    }

    if (!companyPhone) {
      alerts.warning(
        'Company phone number is required.',
        'Missing Company Phone',
      );
      return false;
    }

    if (!contactPersonName) {
      alerts.warning(
        'Contact person name is required.',
        'Missing Contact Person',
      );
      return false;
    }

    if (!contactPersonPhone) {
      alerts.warning(
        'Contact person phone number is required.',
        'Missing Contact Phone',
      );
      return false;
    }

    if (!turnstileToken) {
      setTurnstileError(
        'Please complete the Cloudflare verification before submitting.',
      );
      return false;
    }

    setTurnstileError('');
    return true;
  }

  async function submitDemoRequest(event) {
    event.preventDefault();

    if (!validateForm()) return;

    const payload = {
      ...form,
      company_email: normalizeEmail(form.company_email),
      company_phone: normalizePhone(form.company_phone),
      contact_person_phone: normalizePhone(form.contact_person_phone),
      requested_employee_count: fieldValue(form, 'requested_employee_count')
        ? Number(form.requested_employee_count)
        : '',
    };

    try {
      setSubmitting(true);

      const data = await api('/demo-requests/apply', {
        method: 'POST',
        body: JSON.stringify(payload),
        timeoutMs: 45000,
      });

      setRequestInfo(data);
      setStep('otp');

      alerts.success(
        data.message ||
          'Trial registration submitted. Please verify the OTP sent to your company email.',
        'OTP Sent',
      );

      window.requestAnimationFrame(() => {
        document
          .getElementById('demo-form')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (err) {
      alerts.error(
        err.message || 'Unable to submit trial registration.',
        'Trial Registration Failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyOtp(event) {
    event.preventDefault();

    const enteredOtp = String(otp || '').trim();

    if (!enteredOtp) {
      alerts.warning(
        'Please enter the OTP sent to your company email.',
        'Missing OTP',
      );
      return;
    }

    try {
      setVerifying(true);

      const data = await api('/demo-requests/verify-otp', {
        method: 'POST',
        body: JSON.stringify({
          request_id: requestId,
          company_email: requestEmail,
          otp: enteredOtp,
        }),
        timeoutMs: 45000,
      });

      setRequestInfo({
        ...data,
        request_id: requestId,
        email: requestEmail,
      });

      setStep('done');

      alerts.success(
        data.message ||
          'Email verified successfully. Your request is now pending Superadmin approval.',
        'Email Verified',
      );
    } catch (err) {
      alerts.error(
        err.message || 'Unable to verify OTP.',
        'OTP Verification Failed',
      );
    } finally {
      setVerifying(false);
    }
  }

  async function resendOtp() {
    if (!requestId && !requestEmail) {
      alerts.warning(
        'Demo request reference is missing. Please submit the form again.',
        'Cannot Resend OTP',
      );
      return;
    }

    try {
      setResending(true);

      const data = await api('/demo-requests/resend-otp', {
        method: 'POST',
        body: JSON.stringify({
          request_id: requestId,
          company_email: requestEmail,
        }),
        timeoutMs: 45000,
      });

      alerts.success(
        data.message || 'OTP resent to the registered company email.',
        'OTP Resent',
      );
    } catch (err) {
      alerts.error(
        err.message || 'Unable to resend OTP.',
        'Resend Failed',
      );
    } finally {
      setResending(false);
    }
  }

  async function checkStatus() {
    const params = new URLSearchParams();

    if (requestId) params.set('request_id', requestId);
    if (requestEmail) params.set('email', requestEmail);

    if (!params.toString()) {
      alerts.warning(
        'Demo request reference is missing.',
        'Cannot Check Status',
      );
      return;
    }

    try {
      setCheckingStatus(true);

      const data = await api(`/demo-requests/status?${params.toString()}`, {
        method: 'GET',
        timeoutMs: 30000,
      });

      setRequestInfo((prev) => ({
        ...(prev || {}),
        ...data,
        request_id: requestId,
        email: requestEmail,
      }));

      const status = data?.request?.status;

      alerts.info(
        `Current status: ${getRequestStatusLabel(status)}.`,
        'Trial Request Status',
      );
    } catch (err) {
      alerts.error(
        err.message || 'Unable to check request status.',
        'Status Check Failed',
      );
    } finally {
      setCheckingStatus(false);
    }
  }

  const activeProgressIndex =
    step === 'done' ? 2 : step === 'otp' ? 1 : 0;

  return (
    <div className="app-page demo-premium-page">
      <header className="auth-premium-header demo-premium-header">
        <Link
          to="/"
          className="auth-mobile-back-link"
          aria-label="Back to website"
        >
          <span aria-hidden="true">←</span>
        </Link>

        <Brand compact />

        <div>
          <Link to="/" className="auth-premium-link">
            Back to website
          </Link>

          <button
            type="button"
            className="button button-ghost button-small"
            onClick={goToLogin}
          >
            LOGIN
          </button>
        </div>
      </header>

      <main className="demo-premium-shell" id="demo-form">
        <aside className="demo-premium-story">
          <div className="demo-premium-story-copy">
            <h1>
              See the workday
              <em> before you commit.</em>
            </h1>

            <p>
              Submit your company details, verify the registered email and
              receive a 15-day YourComate workspace with every Premium feature
              unlocked after approval.
            </p>

            <div className="demo-premium-facts">
              <span>
                <Icon name="email" />
                <b>Email OTP</b>
                <small>Verified request</small>
              </span>

              <span>
                <Icon name="calendar" />
                <b>15-day trial</b>
                <small>Up to 10 employees</small>
              </span>

              <span>
                <Icon name="sparkle" />
                <b>Full Premium access</b>
                <small>Every module and add-on unlocked</small>
              </span>
            </div>
          </div>

          <AuthWorkflowCanvas variant="demo" steps={STEPS} />
        </aside>

        <section className="demo-premium-form-panel">
          <header className="demo-premium-form-heading">
            <div>
              <small>
                {step === 'form'
                  ? 'Step 01 · Company details'
                  : step === 'otp'
                    ? 'Step 02 · Email verification'
                    : 'Step 03 · Approval pending'}
              </small>

              <h2>
                {step === 'form'
                  ? 'Start your demo request.'
                  : step === 'otp'
                    ? 'Verify the company email.'
                    : 'Your request is verified.'}
              </h2>

              <p>
                {step === 'form'
                  ? 'Required fields are marked below. OTP and final credentials are sent to the registered company email.'
                  : step === 'otp'
                    ? `Enter the OTP sent to ${requestEmail}.`
                    : 'The verified request is now waiting for Superadmin review.'}
              </p>
            </div>

            <span>
              <i />
              {requestStatus
                ? getRequestStatusLabel(requestStatus)
                : step === 'form'
                  ? 'Secure submission'
                  : step === 'otp'
                    ? 'OTP pending'
                    : 'Verification complete'}
            </span>
          </header>

          <div
            className="demo-premium-progress"
            aria-label="Demo request progress"
          >
            {STEPS.slice(0, 3).map(([number, title], index) => (
              <span
                className={index <= activeProgressIndex ? 'active' : ''}
                key={number}
              >
                <b>{number}</b>
                <small>{title}</small>
              </span>
            ))}
          </div>

          {step === 'form' && (
            <form
              className="demo-premium-form"
              onSubmit={submitDemoRequest}
              noValidate
            >
              <fieldset>
                <legend>
                  <span>
                    <Icon name="building" />
                  </span>

                  <div>
                    <small>Section 01</small>
                    <strong>Company identity</strong>
                  </div>
                </legend>

                <div className="demo-premium-grid">
                  <Field label="Company name" note="Required">
                    <input
                      type="text"
                      name="company_name"
                      value={form.company_name}
                      placeholder="Your Company Private Limited"
                      autoComplete="organization"
                      required
                      disabled={submitting}
                      onChange={(event) =>
                        updateField('company_name', event.target.value)
                      }
                    />
                  </Field>

                  <Field label="Company email" note="OTP is sent here">
                    <input
                      type="email"
                      name="company_email"
                      value={form.company_email}
                      placeholder="company@example.com"
                      autoComplete="email"
                      required
                      disabled={submitting}
                      onChange={(event) =>
                        updateField('company_email', event.target.value)
                      }
                    />
                  </Field>

                  <Field label="Company phone" note="Required">
                    <input
                      type="tel"
                      name="company_phone"
                      value={form.company_phone}
                      placeholder="Company phone number"
                      autoComplete="tel"
                      inputMode="tel"
                      required
                      disabled={submitting}
                      onChange={(event) =>
                        updateField('company_phone', event.target.value)
                      }
                    />
                  </Field>

                  <Field label="Company type" note="Optional">
                    <select
                      name="company_type"
                      value={form.company_type}
                      disabled={submitting}
                      onChange={(event) =>
                        updateField('company_type', event.target.value)
                      }
                    >
                      {COMPANY_TYPES.map(([value, label]) => (
                        <option value={value} key={value || 'empty'}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Company address" note="Optional" wide>
                    <textarea
                      name="company_address"
                      value={form.company_address}
                      placeholder="Enter the registered company address"
                      autoComplete="street-address"
                      disabled={submitting}
                      onChange={(event) =>
                        updateField('company_address', event.target.value)
                      }
                    />
                  </Field>
                </div>
              </fieldset>

              <fieldset>
                <legend>
                  <span>
                    <Icon name="people" />
                  </span>

                  <div>
                    <small>Section 02</small>
                    <strong>Primary contact</strong>
                  </div>
                </legend>

                <div className="demo-premium-grid">
                  <Field label="Contact person name" note="Required">
                    <input
                      type="text"
                      name="contact_person_name"
                      value={form.contact_person_name}
                      placeholder="Primary contact person"
                      autoComplete="name"
                      required
                      disabled={submitting}
                      onChange={(event) =>
                        updateField(
                          'contact_person_name',
                          event.target.value,
                        )
                      }
                    />
                  </Field>

                  <Field label="Contact person phone" note="Required">
                    <input
                      type="tel"
                      name="contact_person_phone"
                      value={form.contact_person_phone}
                      placeholder="Contact person phone"
                      autoComplete="tel"
                      inputMode="tel"
                      required
                      disabled={submitting}
                      onChange={(event) =>
                        updateField(
                          'contact_person_phone',
                          event.target.value,
                        )
                      }
                    />
                  </Field>
                </div>
              </fieldset>

              <fieldset>
                <legend>
                  <span>
                    <Icon name="sparkle" />
                  </span>

                  <div>
                    <small>Section 03</small>
                    <strong>Evaluation needs</strong>
                  </div>
                </legend>

                <div className="demo-premium-grid">
                  <Field
                    label="Expected employee count"
                    note="Optional"
                  >
                    <input
                      type="number"
                      name="requested_employee_count"
                      value={form.requested_employee_count}
                      placeholder="Example: 25"
                      min="1"
                      inputMode="numeric"
                      disabled={submitting}
                      onChange={(event) =>
                        updateField(
                          'requested_employee_count',
                          event.target.value,
                        )
                      }
                    />
                  </Field>

                  <Field
                    label="Message or requirement"
                    note="Optional"
                    wide
                  >
                    <textarea
                      name="message"
                      value={form.message}
                      placeholder="Tell us what your organisation wants to evaluate"
                      disabled={submitting}
                      onChange={(event) =>
                        updateField('message', event.target.value)
                      }
                    />
                  </Field>
                </div>
              </fieldset>

              <CloudflareTurnstile
                onVerify={(token) => {
                  setTurnstileToken(token);
                  setTurnstileError('');
                }}
                onExpire={() => {
                  setTurnstileToken('');
                  setTurnstileError(
                    'Cloudflare verification expired. Please verify again.',
                  );
                }}
              />

              {turnstileError && (
                <p
                  className="demo-premium-verification-error"
                  role="alert"
                >
                  <Icon name="warning" />
                  {turnstileError}
                </p>
              )}

              <div className="demo-premium-information">
                <Icon name="email" />

                <p>
                  After submission, an OTP is sent to the company email. The
                  request enters the Superadmin review queue only after
                  successful verification.
                </p>
              </div>

              <div className="demo-premium-actions">
                <button
                  className="button button-ghost"
                  type="button"
                  disabled={submitting}
                  onClick={goBack}
                >
                  Cancel and go back
                </button>

                <button
                  className="button button-primary"
                  type="submit"
                  disabled={submitting || !turnstileToken}
                >
                  {submitting ? 'Submitting…' : 'Submit and send OTP'}
                  <Icon name="arrow" />
                </button>
              </div>
            </form>
          )}

          {step === 'otp' && (
            <form
              className="demo-premium-form"
              onSubmit={verifyOtp}
              noValidate
            >
              <fieldset>
                <legend>
                  <span>
                    <Icon name="email" />
                  </span>

                  <div>
                    <small>Section 04</small>
                    <strong>Email verification</strong>
                  </div>
                </legend>

                <div className="demo-premium-grid">
                  <Field
                    label="One-time password"
                    note={`Sent to ${requestEmail}`}
                    wide
                  >
                    <input
                      type="text"
                      name="otp"
                      value={otp}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={10}
                      placeholder="Enter OTP"
                      required
                      disabled={verifying}
                      onChange={(event) =>
                        setOtp(
                          event.target.value.replace(/[^0-9]/g, ''),
                        )
                      }
                    />
                  </Field>
                </div>
              </fieldset>

              <div className="demo-premium-information">
                <Icon name="shield" />

                <p>
                  Company: <b>{fieldValue(form, 'company_name')}</b>
                  <br />
                  Request ID: <b>{requestId || 'Generated'}</b>
                </p>
              </div>

              <div className="demo-premium-actions">
                <button
                  className="button button-ghost"
                  type="button"
                  disabled={verifying || resending}
                  onClick={() => setStep('form')}
                >
                  Edit details
                </button>

                <button
                  className="button button-ghost"
                  type="button"
                  disabled={resending || verifying}
                  onClick={resendOtp}
                >
                  {resending ? 'Resending…' : 'Resend OTP'}
                </button>

                <button
                  className="button button-primary"
                  type="submit"
                  disabled={verifying || resending}
                >
                  {verifying ? 'Verifying…' : 'Verify OTP'}
                  <Icon name="arrow" />
                </button>
              </div>
            </form>
          )}

          {step === 'done' && (
            <div className="demo-premium-form">
              <fieldset>
                <legend>
                  <span>
                    <Icon name="check" />
                  </span>

                  <div>
                    <small>Verification complete</small>
                    <strong>Request sent to Superadmin</strong>
                  </div>
                </legend>

                <div className="demo-premium-information">
                  <Icon name="email" />

                  <p>
                    Your company email has been verified. The request is now
                    waiting for Superadmin approval. Once approved, the
                    generated admin email and password will be sent to the
                    registered company email.
                  </p>
                </div>

                <div className="demo-premium-grid">
                  <Field label="Company">
                    <input
                      value={
                        requestInfo?.request?.company_name ||
                        fieldValue(form, 'company_name')
                      }
                      readOnly
                    />
                  </Field>

                  <Field label="Registered email">
                    <input
                      value={
                        requestInfo?.request?.company_email ||
                        requestEmail
                      }
                      readOnly
                    />
                  </Field>

                  <Field label="Status">
                    <input
                      value={getRequestStatusLabel(
                        requestInfo?.request?.status || 'pending',
                      )}
                      readOnly
                    />
                  </Field>

                  <Field label="Trial access after approval">
                    <input
                      value="15 days / full HRMS access"
                      readOnly
                    />
                  </Field>
                </div>
              </fieldset>

              <div className="demo-premium-information">
                <Icon name="sparkle" />

                <p>
                  Trial access starts only after approval. The approved company
                  will receive generated login credentials by email. After 15
                  days, payment converts the trial company into an official
                  registered paid company.
                </p>
              </div>

              <div className="demo-premium-actions">
                <button
                  className="button button-ghost"
                  type="button"
                  disabled={checkingStatus}
                  onClick={checkStatus}
                >
                  {checkingStatus ? 'Checking…' : 'Check status'}
                </button>

                <button
                  className="button button-primary"
                  type="button"
                  onClick={goToLogin}
                >
                  Back to login
                  <Icon name="arrow" />
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      <section
        className="demo-pricing-extension"
        aria-labelledby="demo-pricing-title"
      >
        <div className="page-width demo-pricing-content">
          <header className="demo-pricing-heading">
            <div>
              <span className="public-kicker">
                <Icon name="chart" /> Pricing preview
              </span>

              <h2 id="demo-pricing-title">
                Estimate the plan that fits after your demo.
              </h2>
            </div>

            <p>
              Adjust the employee count to compare the published Essential and
              Growth monthly estimates, then review all four access options.
            </p>
          </header>

          <div className="demo-plan-grid">
            {pricingPlans.map((plan) => (
              <article
                className={`demo-plan-card ${
                  plan.featured ? 'is-featured' : ''
                }`}
                key={plan.name}
              >
                {plan.featured && (
                  <b className="demo-plan-badge">Recommended</b>
                )}

                <header>
                  <small>{plan.note}</small>
                  <h3>{plan.name}</h3>
                  <strong>{plan.label}</strong>
                </header>

                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <Icon name="check" />
                      {feature}
                    </li>
                  ))}
                </ul>

                {plan.action[1].startsWith('#') ? (
                  <a
                    className="button button-ghost"
                    href={plan.action[1]}
                  >
                    {plan.action[0]}
                  </a>
                ) : (
                  <a
                    className={`button ${
                      plan.featured
                        ? 'button-primary'
                        : 'button-ghost'
                    }`}
                    href={plan.action[1]}
                    onClick={preparePublicPageNavigation}
                  >
                    {plan.action[0]}
                  </a>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <AuthPageFooter />
    </div>
  );
}

export default function ApplyDemoRegistration() {
  return (
    <BrowserRouter>
      <DemoRegistrationContent />
    </BrowserRouter>
  );
}
