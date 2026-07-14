import React, { useMemo, useState } from 'react';
import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

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

const COMPANY_TYPE_OPTIONS = [
  'Private Limited',
  'LLP',
  'Partnership',
  'Proprietorship',
  'NGO / Society',
  'Government / Department',
  'Startup',
  'Other',
];

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

function getRequestStatusLabel(status = '') {
  const normalized = String(status || '').trim().toLowerCase();

  if (normalized === 'otp_pending') return 'OTP Verification Pending';
  if (normalized === 'pending') return 'Pending Superadmin Approval';
  if (normalized === 'approved') return 'Approved';
  if (normalized === 'rejected') return 'Rejected';

  return normalized ? normalized.replace(/_/g, ' ') : 'Not Submitted';
}

function StatusPill({ status }) {
  const normalized = String(status || '').trim().toLowerCase();
  const className = [
    'demo-status-pill',
    normalized === 'approved' ? 'success' : '',
    normalized === 'rejected' ? 'danger' : '',
    normalized === 'pending' ? 'warning' : '',
    normalized === 'otp_pending' ? 'info' : '',
  ].filter(Boolean).join(' ');

  return <span className={className}>{getRequestStatusLabel(status)}</span>;
}

export default function ApplyDemoRegistration() {
  const alerts = useCustomAlert();
  const [form, setForm] = useState(INITIAL_FORM);
  const [otp, setOtp] = useState('');
  const [requestInfo, setRequestInfo] = useState(null);
  const [step, setStep] = useState('form');
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const requestId = requestInfo?.request_id || requestInfo?.id || requestInfo?._id || '';
  const requestEmail = requestInfo?.email || requestInfo?.company_email || normalizeEmail(form.company_email);
  const requestStatus = requestInfo?.request?.status || requestInfo?.status || '';

  const progress = useMemo(() => {
    if (step === 'done') return 100;
    if (step === 'otp') return 58;
    return 24;
  }, [step]);

  function updateField(key, value) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function goToLogin() {
    try {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch {
      window.location.href = '/';
    }
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
      alerts.warning('Please enter a valid company email address.', 'Invalid Email');
      return false;
    }

    if (!companyPhone) {
      alerts.warning('Company phone number is required.', 'Missing Company Phone');
      return false;
    }

    if (!contactPersonName) {
      alerts.warning('Contact person name is required.', 'Missing Contact Person');
      return false;
    }

    if (!contactPersonPhone) {
      alerts.warning('Contact person phone number is required.', 'Missing Contact Phone');
      return false;
    }

    return true;
  }

  async function submitDemoRequest(e) {
    e.preventDefault();

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
        data.message || 'Demo registration submitted. Please verify the OTP sent to your company email.',
        'OTP Sent',
      );
    } catch (err) {
      alerts.error(err.message || 'Unable to submit demo registration.', 'Demo Registration Failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyOtp(e) {
    e.preventDefault();

    const enteredOtp = String(otp || '').trim();

    if (!enteredOtp) {
      alerts.warning('Please enter the OTP sent to your company email.', 'Missing OTP');
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
        data.message || 'Email verified successfully. Your request is now pending Superadmin approval.',
        'Email Verified',
      );
    } catch (err) {
      alerts.error(err.message || 'Unable to verify OTP.', 'OTP Verification Failed');
    } finally {
      setVerifying(false);
    }
  }

  async function resendOtp() {
    if (!requestId && !requestEmail) {
      alerts.warning('Demo request reference is missing. Please submit the form again.', 'Cannot Resend OTP');
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

      alerts.success(data.message || 'OTP resent to the registered company email.', 'OTP Resent');
    } catch (err) {
      alerts.error(err.message || 'Unable to resend OTP.', 'Resend Failed');
    } finally {
      setResending(false);
    }
  }

  async function checkStatus() {
    const params = new URLSearchParams();

    if (requestId) params.set('request_id', requestId);
    if (requestEmail) params.set('email', requestEmail);

    if (!params.toString()) {
      alerts.warning('Demo request reference is missing.', 'Cannot Check Status');
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
        'Demo Request Status',
      );
    } catch (err) {
      alerts.error(err.message || 'Unable to check request status.', 'Status Check Failed');
    } finally {
      setCheckingStatus(false);
    }
  }

  return (
    <div className="demo-apply-page">
      <style>
        {`
          .demo-apply-page {
            min-height: 100vh;
            width: 100%;
            padding: 24px;
            background:
              radial-gradient(circle at 9% 12%, rgba(14, 165, 233, 0.24), transparent 30%),
              radial-gradient(circle at 86% 18%, rgba(20, 184, 166, 0.22), transparent 28%),
              radial-gradient(circle at 50% 96%, rgba(99, 102, 241, 0.16), transparent 28%),
              linear-gradient(135deg, #020617 0%, #0f172a 48%, #111827 100%);
            color: #0f172a;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            position: relative;
            overflow-x: hidden;
          }

          .demo-apply-page::before {
            content: "";
            position: absolute;
            inset: 0;
            background-image:
              linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
            background-size: 42px 42px;
            pointer-events: none;
            mask-image: radial-gradient(circle at center, black 0%, transparent 82%);
          }

          .demo-shell {
            width: min(1180px, 100%);
            display: grid;
            grid-template-columns: 0.88fr 1.12fr;
            gap: 24px;
            position: relative;
            z-index: 1;
          }

          .demo-info-panel,
          .demo-form-panel {
            border: 1px solid rgba(226, 232, 240, 0.18);
            border-radius: 34px;
            box-shadow:
              0 32px 90px rgba(0, 0, 0, 0.34),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
            overflow: hidden;
          }

          .demo-info-panel {
            padding: 30px;
            background: rgba(15, 23, 42, 0.70);
            backdrop-filter: blur(24px);
            color: #f8fafc;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            min-height: 680px;
          }

          .demo-brand-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            margin-bottom: 34px;
          }

          .demo-brand {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .demo-logo {
            width: 52px;
            height: 52px;
            border-radius: 18px;
            background: linear-gradient(135deg, #38bdf8, #14b8a6);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 950;
            font-size: 18px;
            box-shadow: 0 20px 46px rgba(20, 184, 166, 0.24);
          }

          .demo-brand b {
            display: block;
            font-size: 16px;
            letter-spacing: -0.02em;
          }

          .demo-brand span {
            display: block;
            color: #94a3b8;
            font-size: 12px;
            margin-top: 2px;
          }

          .demo-back-btn {
            border: 1px solid rgba(226, 232, 240, 0.16);
            background: rgba(255, 255, 255, 0.06);
            color: #e2e8f0;
            border-radius: 14px;
            padding: 10px 13px;
            font-weight: 850;
            font-size: 12px;
            cursor: pointer;
            transition: 0.2s ease;
          }

          .demo-back-btn:hover {
            transform: translateY(-1px);
            background: rgba(255, 255, 255, 0.10);
          }

          .demo-title-kicker {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 11px;
            border-radius: 999px;
            background: rgba(14, 165, 233, 0.12);
            border: 1px solid rgba(125, 211, 252, 0.20);
            color: #bae6fd;
            font-size: 11px;
            font-weight: 900;
            margin-bottom: 14px;
          }

          .demo-info-panel h1 {
            margin: 0;
            font-size: clamp(32px, 4.2vw, 56px);
            line-height: 0.98;
            letter-spacing: -0.07em;
          }

          .demo-info-panel h1 span {
            background: linear-gradient(135deg, #67e8f9, #5eead4, #bfdbfe);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
          }

          .demo-info-panel p {
            margin: 18px 0 0;
            color: #cbd5e1;
            font-size: 14px;
            line-height: 1.7;
            max-width: 520px;
          }

          .demo-benefit-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
            margin-top: 30px;
          }

          .demo-benefit-card {
            border: 1px solid rgba(226, 232, 240, 0.12);
            background: rgba(255, 255, 255, 0.055);
            border-radius: 22px;
            padding: 16px;
          }

          .demo-benefit-card i {
            width: 34px;
            height: 34px;
            border-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(14, 165, 233, 0.16);
            margin-bottom: 12px;
            font-style: normal;
          }

          .demo-benefit-card b {
            display: block;
            font-size: 13px;
            color: #f8fafc;
            margin-bottom: 4px;
          }

          .demo-benefit-card span {
            display: block;
            font-size: 11.5px;
            line-height: 1.45;
            color: #94a3b8;
          }

          .demo-flow-box {
            margin-top: 28px;
            border: 1px solid rgba(45, 212, 191, 0.20);
            background: rgba(15, 118, 110, 0.12);
            border-radius: 24px;
            padding: 16px;
          }

          .demo-flow-box b {
            display: block;
            color: #ccfbf1;
            font-size: 13px;
            margin-bottom: 10px;
          }

          .demo-flow-line {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            color: #e0f2fe;
            font-size: 11px;
            font-weight: 850;
          }

          .demo-flow-line span {
            padding: 7px 9px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(226, 232, 240, 0.11);
          }

          .demo-form-panel {
            background: rgba(255, 255, 255, 0.96);
            backdrop-filter: blur(24px);
          }

          .demo-form-header {
            padding: 28px 28px 18px;
            border-bottom: 1px solid #e2e8f0;
            background:
              radial-gradient(circle at top right, rgba(14, 165, 233, 0.12), transparent 35%),
              linear-gradient(135deg, #ffffff, #f8fafc);
          }

          .demo-form-header-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 16px;
          }

          .demo-form-header h2 {
            margin: 0;
            font-size: 24px;
            letter-spacing: -0.045em;
            color: #0f172a;
          }

          .demo-form-header p {
            margin: 7px 0 0;
            color: #64748b;
            font-size: 13px;
            line-height: 1.55;
          }

          .demo-status-pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 8px 11px;
            border-radius: 999px;
            background: #eef2ff;
            color: #4338ca;
            font-size: 11px;
            font-weight: 950;
            white-space: nowrap;
            text-transform: capitalize;
          }

          .demo-status-pill.success {
            background: #dcfce7;
            color: #166534;
          }

          .demo-status-pill.danger {
            background: #fee2e2;
            color: #991b1b;
          }

          .demo-status-pill.warning {
            background: #fef3c7;
            color: #92400e;
          }

          .demo-status-pill.info {
            background: #e0f2fe;
            color: #0369a1;
          }

          .demo-progress-track {
            margin-top: 18px;
            width: 100%;
            height: 9px;
            border-radius: 999px;
            background: #e2e8f0;
            overflow: hidden;
          }

          .demo-progress-fill {
            height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, #0284c7, #14b8a6);
            transition: width 0.28s ease;
          }

          .demo-step-labels {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-top: 10px;
            color: #94a3b8;
            font-size: 10.5px;
            font-weight: 850;
          }

          .demo-step-labels span:nth-child(2) {
            text-align: center;
          }

          .demo-step-labels span:nth-child(3) {
            text-align: right;
          }

          .demo-form-body {
            padding: 26px 28px 28px;
          }

          .demo-form-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
          }

          .demo-field {
            display: grid;
            gap: 8px;
          }

          .demo-field.full {
            grid-column: 1 / -1;
          }

          .demo-field label {
            font-size: 12px;
            color: #334155;
            font-weight: 950;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
          }

          .demo-field label small {
            color: #94a3b8;
            font-size: 10px;
            font-weight: 850;
          }

          .demo-input,
          .demo-select,
          .demo-textarea {
            width: 100%;
            border: 1px solid #cbd5e1;
            background: #ffffff;
            border-radius: 16px;
            padding: 13px 14px;
            outline: none;
            color: #0f172a;
            font-size: 13px;
            font-weight: 750;
            transition: 0.18s ease;
          }

          .demo-textarea {
            min-height: 92px;
            resize: vertical;
            line-height: 1.5;
          }

          .demo-input:focus,
          .demo-select:focus,
          .demo-textarea:focus {
            border-color: #0284c7;
            box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.13);
          }

          .demo-help-note {
            margin-top: 16px;
            padding: 14px;
            border-radius: 18px;
            border: 1px solid #bae6fd;
            background: #f0f9ff;
            color: #0369a1;
            font-size: 12px;
            line-height: 1.55;
            font-weight: 760;
          }

          .demo-action-row {
            margin-top: 20px;
            display: flex;
            gap: 12px;
            align-items: center;
            justify-content: flex-end;
            flex-wrap: wrap;
          }

          .demo-primary-btn,
          .demo-secondary-btn,
          .demo-ghost-btn {
            border: 0;
            border-radius: 16px;
            padding: 13px 16px;
            font-weight: 950;
            font-size: 12px;
            cursor: pointer;
            transition: 0.2s ease;
          }

          .demo-primary-btn {
            color: #ffffff;
            background: linear-gradient(135deg, #0f766e, #0284c7);
            box-shadow: 0 16px 32px rgba(14, 116, 144, 0.24);
          }

          .demo-primary-btn:hover:not(:disabled),
          .demo-secondary-btn:hover:not(:disabled),
          .demo-ghost-btn:hover:not(:disabled) {
            transform: translateY(-1px);
          }

          .demo-primary-btn:disabled,
          .demo-secondary-btn:disabled,
          .demo-ghost-btn:disabled {
            opacity: 0.68;
            cursor: not-allowed;
          }

          .demo-secondary-btn {
            color: #0f172a;
            background: #e0f2fe;
            border: 1px solid #bae6fd;
          }

          .demo-ghost-btn {
            color: #475569;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
          }

          .demo-otp-card,
          .demo-done-card {
            border: 1px solid #e2e8f0;
            border-radius: 24px;
            background:
              radial-gradient(circle at top right, rgba(20, 184, 166, 0.13), transparent 34%),
              #ffffff;
            padding: 22px;
          }

          .demo-otp-icon,
          .demo-done-icon {
            width: 62px;
            height: 62px;
            border-radius: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            background: linear-gradient(135deg, #ecfeff, #e0f2fe);
            border: 1px solid #bae6fd;
            margin-bottom: 16px;
          }

          .demo-otp-card h3,
          .demo-done-card h3 {
            margin: 0;
            color: #0f172a;
            font-size: 22px;
            letter-spacing: -0.04em;
          }

          .demo-otp-card p,
          .demo-done-card p {
            margin: 10px 0 0;
            color: #64748b;
            font-size: 13px;
            line-height: 1.6;
          }

          .demo-otp-input {
            margin-top: 18px;
            width: min(280px, 100%);
            border: 1px solid #94a3b8;
            background: #ffffff;
            border-radius: 18px;
            padding: 16px 18px;
            outline: none;
            color: #0f172a;
            font-size: 24px;
            font-weight: 950;
            letter-spacing: 0.32em;
            text-align: center;
          }

          .demo-summary-grid {
            margin-top: 18px;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .demo-summary-item {
            border: 1px solid #e2e8f0;
            background: #f8fafc;
            border-radius: 18px;
            padding: 13px;
          }

          .demo-summary-item span {
            display: block;
            color: #94a3b8;
            font-size: 10.5px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 4px;
          }

          .demo-summary-item b {
            display: block;
            color: #0f172a;
            font-size: 12.5px;
            word-break: break-word;
          }

          .demo-final-note {
            margin-top: 18px;
            border-radius: 18px;
            padding: 14px;
            background: #ecfdf5;
            border: 1px solid #bbf7d0;
            color: #166534;
            font-size: 12px;
            line-height: 1.55;
            font-weight: 800;
          }

          @media (max-width: 980px) {
            .demo-shell {
              grid-template-columns: 1fr;
            }

            .demo-info-panel {
              min-height: auto;
            }
          }

          @media (max-width: 720px) {
            .demo-apply-page {
              padding: 14px;
              align-items: stretch;
            }

            .demo-info-panel,
            .demo-form-panel {
              border-radius: 24px;
            }

            .demo-info-panel,
            .demo-form-header,
            .demo-form-body {
              padding: 20px;
            }

            .demo-brand-row,
            .demo-form-header-top {
              flex-direction: column;
              align-items: flex-start;
            }

            .demo-benefit-grid,
            .demo-form-grid,
            .demo-summary-grid {
              grid-template-columns: 1fr;
            }

            .demo-field.full {
              grid-column: auto;
            }

            .demo-action-row {
              justify-content: stretch;
            }

            .demo-primary-btn,
            .demo-secondary-btn,
            .demo-ghost-btn {
              width: 100%;
            }
          }
        `}
      </style>

      <main className="demo-shell">
        <section className="demo-info-panel">
          <div>
            <div className="demo-brand-row">
              <div className="demo-brand">
                <div className="demo-logo">YC</div>
                <div>
                  <b>YourComate HRMS</b>
                  <span>SaaS demo registration</span>
                </div>
              </div>

              <button type="button" className="demo-back-btn" onClick={goToLogin}>
                ← Back to Login
              </button>
            </div>

            <div className="demo-title-kicker">✨ Company demo onboarding</div>
            <h1>
              Apply for your <span>30-day HRMS demo.</span>
            </h1>
            <p>
              Register your company details, verify your email by OTP, and wait for Superadmin approval.
              After approval, your company admin login will be generated and sent to your registered email.
            </p>

            <div className="demo-benefit-grid">
              <div className="demo-benefit-card">
                <i>📧</i>
                <b>OTP email verification</b>
                <span>Company email is verified through SMTP before the request goes to Superadmin.</span>
              </div>

              <div className="demo-benefit-card">
                <i>✅</i>
                <b>Superadmin approval</b>
                <span>Only approved companies receive demo login credentials.</span>
              </div>

              <div className="demo-benefit-card">
                <i>👥</i>
                <b>10 employee limit</b>
                <span>Demo companies can add up to 10 employees during the trial.</span>
              </div>

              <div className="demo-benefit-card">
                <i>📊</i>
                <b>Limited modules</b>
                <span>Demo access includes Attendance, Apply Leave, and Projects only.</span>
              </div>
            </div>
          </div>

          <div className="demo-flow-box">
            <b>Demo approval flow</b>
            <div className="demo-flow-line">
              <span>Apply</span>
              <span>OTP</span>
              <span>Verify</span>
              <span>Superadmin Approval</span>
              <span>Credentials Email</span>
              <span>30-Day Demo</span>
            </div>
          </div>
        </section>

        <section className="demo-form-panel">
          <div className="demo-form-header">
            <div className="demo-form-header-top">
              <div>
                <h2>Apply for Demo Registration</h2>
                <p>
                  Fill the company details carefully. The OTP and final login credentials will be sent to the registered company email.
                </p>
              </div>

              <StatusPill status={requestStatus || step} />
            </div>

            <div className="demo-progress-track">
              <div className="demo-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="demo-step-labels">
              <span>Company Details</span>
              <span>OTP Verify</span>
              <span>Approval Pending</span>
            </div>
          </div>

          <div className="demo-form-body">
            {step === 'form' && (
              <form onSubmit={submitDemoRequest}>
                <div className="demo-form-grid">
                  <div className="demo-field">
                    <label>
                      Company Name <small>required</small>
                    </label>
                    <input
                      className="demo-input"
                      value={form.company_name}
                      placeholder="Example: Rahul Baruah Private Limited"
                      onChange={(e) => updateField('company_name', e.target.value)}
                    />
                  </div>

                  <div className="demo-field">
                    <label>
                      Company Email <small>OTP will be sent here</small>
                    </label>
                    <input
                      className="demo-input"
                      type="email"
                      value={form.company_email}
                      placeholder="company@example.com"
                      onChange={(e) => updateField('company_email', e.target.value)}
                    />
                  </div>

                  <div className="demo-field">
                    <label>
                      Company Phone <small>required</small>
                    </label>
                    <input
                      className="demo-input"
                      value={form.company_phone}
                      placeholder="Company phone number"
                      onChange={(e) => updateField('company_phone', e.target.value)}
                    />
                  </div>

                  <div className="demo-field">
                    <label>
                      Company Type <small>optional</small>
                    </label>
                    <select
                      className="demo-select"
                      value={form.company_type}
                      onChange={(e) => updateField('company_type', e.target.value)}
                    >
                      <option value="">Select company type</option>
                      {COMPANY_TYPE_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div className="demo-field">
                    <label>
                      Contact Person Name <small>required</small>
                    </label>
                    <input
                      className="demo-input"
                      value={form.contact_person_name}
                      placeholder="Primary contact person"
                      onChange={(e) => updateField('contact_person_name', e.target.value)}
                    />
                  </div>

                  <div className="demo-field">
                    <label>
                      Contact Person Phone <small>required</small>
                    </label>
                    <input
                      className="demo-input"
                      value={form.contact_person_phone}
                      placeholder="Contact person phone"
                      onChange={(e) => updateField('contact_person_phone', e.target.value)}
                    />
                  </div>

                  <div className="demo-field">
                    <label>
                      Expected Employee Count <small>optional</small>
                    </label>
                    <input
                      className="demo-input"
                      type="number"
                      min="1"
                      value={form.requested_employee_count}
                      placeholder="Example: 25"
                      onChange={(e) => updateField('requested_employee_count', e.target.value)}
                    />
                  </div>

                  <div className="demo-field full">
                    <label>
                      Company Address <small>optional</small>
                    </label>
                    <textarea
                      className="demo-textarea"
                      value={form.company_address}
                      placeholder="Enter registered company address"
                      onChange={(e) => updateField('company_address', e.target.value)}
                    />
                  </div>

                  <div className="demo-field full">
                    <label>
                      Message / Requirement <small>optional</small>
                    </label>
                    <textarea
                      className="demo-textarea"
                      value={form.message}
                      placeholder="Tell us briefly why your company wants to use YourComate HRMS"
                      onChange={(e) => updateField('message', e.target.value)}
                    />
                  </div>
                </div>

                <div className="demo-help-note">
                  After submission, an OTP will be sent to the company email. Your request will go to Superadmin only after OTP verification.
                </div>

                <div className="demo-action-row">
                  <button type="button" className="demo-ghost-btn" onClick={goToLogin}>
                    Cancel
                  </button>
                  <button type="submit" className="demo-primary-btn" disabled={submitting}>
                    {submitting ? 'Sending OTP...' : 'Submit & Send OTP'}
                  </button>
                </div>
              </form>
            )}

            {step === 'otp' && (
              <form className="demo-otp-card" onSubmit={verifyOtp}>
                <div className="demo-otp-icon">📧</div>
                <h3>Verify company email</h3>
                <p>
                  We have sent an OTP to <b>{requestEmail}</b>. Enter it below to submit the request for Superadmin approval.
                </p>

                <input
                  className="demo-otp-input"
                  value={otp}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="OTP"
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                />

                <div className="demo-summary-grid">
                  <div className="demo-summary-item">
                    <span>Company</span>
                    <b>{fieldValue(form, 'company_name')}</b>
                  </div>
                  <div className="demo-summary-item">
                    <span>Request ID</span>
                    <b>{requestId || 'Generated'}</b>
                  </div>
                </div>

                <div className="demo-action-row">
                  <button type="button" className="demo-ghost-btn" onClick={() => setStep('form')}>
                    Edit Details
                  </button>
                  <button type="button" className="demo-secondary-btn" disabled={resending} onClick={resendOtp}>
                    {resending ? 'Resending...' : 'Resend OTP'}
                  </button>
                  <button type="submit" className="demo-primary-btn" disabled={verifying}>
                    {verifying ? 'Verifying...' : 'Verify OTP'}
                  </button>
                </div>
              </form>
            )}

            {step === 'done' && (
              <div className="demo-done-card">
                <div className="demo-done-icon">✅</div>
                <h3>Request sent to Superadmin</h3>
                <p>
                  Your company email has been verified. The request is now waiting for Superadmin approval.
                  Once approved, the generated admin email and password will be sent to the registered company email.
                </p>

                <div className="demo-summary-grid">
                  <div className="demo-summary-item">
                    <span>Company</span>
                    <b>{requestInfo?.request?.company_name || fieldValue(form, 'company_name')}</b>
                  </div>
                  <div className="demo-summary-item">
                    <span>Registered Email</span>
                    <b>{requestInfo?.request?.company_email || requestEmail}</b>
                  </div>
                  <div className="demo-summary-item">
                    <span>Status</span>
                    <b>{getRequestStatusLabel(requestInfo?.request?.status || 'pending')}</b>
                  </div>
                  <div className="demo-summary-item">
                    <span>Demo Access After Approval</span>
                    <b>30 days / 10 employees</b>
                  </div>
                </div>

                <div className="demo-final-note">
                  Demo access starts only after approval. The approved company will receive login credentials like initials@yourcomate.com and initials@1234.
                </div>

                <div className="demo-action-row">
                  <button type="button" className="demo-secondary-btn" disabled={checkingStatus} onClick={checkStatus}>
                    {checkingStatus ? 'Checking...' : 'Check Status'}
                  </button>
                  <button type="button" className="demo-primary-btn" onClick={goToLogin}>
                    Back to Login
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
