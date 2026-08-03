import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';
import AuthPageFooter from '../components/AuthPageFooter';
import Brand from '../components/Brand';
import Icon from '../components/Icon';
import '../styles/auth-pages.css';

const ISSUE_CATEGORIES = [
  { value: 'forgot_password', label: 'Forgot password' },
  { value: 'account_locked', label: 'Account locked' },
  { value: 'cannot_login', label: 'Cannot log in' },
  { value: 'email_or_code_issue', label: 'Email or employee code issue' },
  { value: 'otp_or_verification', label: 'OTP or verification issue' },
  { value: 'other', label: 'Other account-access issue' },
];

const INITIAL_FORM = {
  identifier: '',
  employeeId: '',
  employeeCode: '',
  employeeName: '',
  email: '',
  department: '',
  designation: '',
  tenantId: '',
  tenantName: '',
  issueCategory: '',
  subject: '',
  description: '',
};

function firstValue(...values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }

  return '';
}

function normalizeLookupPayload(payload = {}) {
  const root = payload?.data && typeof payload.data === 'object'
    ? payload.data
    : payload;
  const employee = root?.employee && typeof root.employee === 'object'
    ? root.employee
    : root;
  const tenant = root?.tenant && typeof root.tenant === 'object'
    ? root.tenant
    : root?.company && typeof root.company === 'object'
      ? root.company
      : {};

  return {
    employeeId: firstValue(employee._id, employee.employee_id, root.employee_id),
    employeeCode: firstValue(
      employee.employee_code,
      employee.code,
      root.employee_code,
    ),
    employeeName: firstValue(
      employee.employee_name,
      employee.full_name,
      employee.name,
      root.employee_name,
      root.name,
    ),
    email: firstValue(
      employee.email,
      employee.official_email,
      employee.work_email,
      root.email,
    ),
    department: firstValue(
      employee.department_name,
      employee.department,
      root.department_name,
      root.department,
    ),
    designation: firstValue(
      employee.designation_name,
      employee.designation,
      root.designation_name,
      root.designation,
    ),
    tenantId: firstValue(
      tenant._id,
      tenant.tenant_id,
      employee.tenant_id,
      root.tenant_id,
    ),
    tenantName: firstValue(
      tenant.company_name,
      tenant.tenant_name,
      tenant.name,
      employee.company_name,
      employee.tenant_name,
      root.company_name,
      root.tenant_name,
    ),
  };
}

function normalizeTicketId(payload = {}) {
  const root = payload?.data && typeof payload.data === 'object'
    ? payload.data
    : payload;

  return firstValue(
    root.ticket_id,
    root.ticketId,
    root.reference_id,
    root.referenceId,
    root.request?.ticket_id,
    root.request?.ticketId,
  );
}


const ACCOUNT_ACCESS_PAGE_STYLES = `
  .yc-account-access-page {
    --yc-aa-ink: #10264f;
    --yc-aa-muted: #657697;
    --yc-aa-primary: #6174e5;
    --yc-aa-primary-deep: #4059bd;
    --yc-aa-cyan: #92dcf7;
    --yc-aa-teal: #74ddd3;
    --yc-aa-paper: #f8fbff;
    --yc-aa-white: #ffffff;
    --yc-aa-line: rgba(16, 38, 79, 0.12);
    --yc-aa-shadow: 0 28px 80px rgba(27, 53, 112, 0.13);
    position: relative;
    min-height: 100vh;
    overflow-x: clip;
    color: var(--yc-aa-ink);
    background:
      radial-gradient(circle at 8% 12%, rgba(146, 220, 247, 0.42), transparent 28rem),
      radial-gradient(circle at 91% 8%, rgba(116, 221, 211, 0.25), transparent 25rem),
      linear-gradient(145deg, #f8fbff 0%, #f4f8ff 48%, #fbfdff 100%);
  }

  .yc-account-access-page::before,
  .yc-account-access-page::after {
    content: "";
    position: fixed;
    z-index: 0;
    border-radius: 999px;
    pointer-events: none;
    filter: blur(2px);
  }

  .yc-account-access-page::before {
    width: 30rem;
    height: 30rem;
    left: -15rem;
    bottom: -12rem;
    background: rgba(97, 116, 229, 0.10);
  }

  .yc-account-access-page::after {
    width: 20rem;
    height: 20rem;
    right: -8rem;
    top: 30%;
    background: rgba(146, 220, 247, 0.18);
  }

  .yc-account-access-page .auth-premium-header {
    position: relative;
    z-index: 5;
    width: min(100% - 48px, 1540px);
    min-height: 84px;
    margin: 0 auto;
    padding: 16px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    background: transparent;
  }

  .yc-account-access-page .auth-premium-header > div:last-child {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .yc-account-access-page .auth-premium-link {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--yc-aa-ink);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    padding: 11px 14px;
    border-radius: 999px;
    transition: background 180ms ease, transform 180ms ease;
  }

  .yc-account-access-page .auth-premium-link:hover {
    background: rgba(255,255,255,0.72);
    transform: translateY(-1px);
  }

  .yc-account-access-page .button {
    min-height: 44px;
    border: 0;
    border-radius: 14px;
    padding: 0 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
    transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
  }

  .yc-account-access-page .button-primary {
    color: #fff;
    background: linear-gradient(135deg, var(--yc-aa-primary), var(--yc-aa-primary-deep));
    box-shadow: 0 12px 28px rgba(64, 89, 189, 0.24);
  }

  .yc-account-access-page .button-secondary {
    color: var(--yc-aa-ink);
    background: #fff;
    border: 1px solid var(--yc-aa-line);
  }

  .yc-account-access-page .button:hover:not(:disabled) {
    transform: translateY(-2px);
  }

  .yc-account-access-page .button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    box-shadow: none;
  }

  .yc-account-access-page .auth-mobile-back-link {
    display: none;
  }

  .yc-account-access-shell {
    position: relative;
    z-index: 2;
    width: min(100% - 48px, 1540px);
    margin: 0 auto;
    padding: 26px 0 64px;
    display: grid;
    grid-template-columns: minmax(340px, 0.88fr) minmax(560px, 1.12fr);
    align-items: start;
    gap: clamp(28px, 4vw, 72px);
  }

  .yc-account-access-story {
    position: sticky;
    top: 24px;
    min-height: calc(100vh - 150px);
    padding: clamp(30px, 4vw, 58px);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
    border-radius: 38px;
    color: #fff;
    background:
      linear-gradient(160deg, rgba(15, 43, 94, 0.98), rgba(55, 77, 165, 0.96)),
      #10264f;
    box-shadow: var(--yc-aa-shadow);
  }

  .yc-account-access-story::before {
    content: "";
    position: absolute;
    width: 25rem;
    height: 25rem;
    right: -9rem;
    top: -10rem;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(146, 220, 247, 0.38), rgba(116, 221, 211, 0.06));
  }

  .yc-account-access-story::after {
    content: "";
    position: absolute;
    width: 19rem;
    height: 19rem;
    left: -8rem;
    bottom: -11rem;
    border-radius: 50%;
    border: 46px solid rgba(255,255,255,0.06);
  }

  .yc-account-access-story-copy,
  .yc-account-access-security-note {
    position: relative;
    z-index: 1;
  }

  .yc-account-access-kicker {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    gap: 8px;
    margin-bottom: 22px;
    padding: 8px 12px;
    border: 1px solid rgba(255,255,255,0.16);
    border-radius: 999px;
    color: #dff7ff;
    background: rgba(255,255,255,0.08);
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-size: 0.72rem;
    font-weight: 900;
  }

  .yc-account-access-story h1 {
    margin: 0;
    max-width: 700px;
    color: #fff;
    font-size: clamp(2.8rem, 4.7vw, 5.7rem);
    line-height: 0.94;
    letter-spacing: -0.055em;
    font-weight: 900;
  }

  .yc-account-access-story h1 em {
    display: block;
    margin-top: 8px;
    color: #aeeeff;
    font-family: inherit;
    font-style: normal;
  }

  .yc-account-access-story-copy > p {
    max-width: 650px;
    margin: 24px 0 34px;
    color: rgba(255,255,255,0.76);
    font-size: clamp(1rem, 1.3vw, 1.18rem);
    line-height: 1.75;
  }

  .yc-account-access-flow {
    display: grid;
    gap: 12px;
  }

  .yc-account-access-flow article {
    display: grid;
    grid-template-columns: 46px 1fr;
    align-items: center;
    gap: 14px;
    padding: 15px;
    border: 1px solid rgba(255,255,255,0.11);
    border-radius: 18px;
    background: rgba(255,255,255,0.07);
    backdrop-filter: blur(12px);
  }

  .yc-account-access-flow article > span {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 14px;
    color: #10264f;
    background: linear-gradient(135deg, #c9f4ff, #91dfd7);
    font-size: 0.78rem;
    font-weight: 900;
  }

  .yc-account-access-flow strong,
  .yc-account-access-flow small {
    display: block;
  }

  .yc-account-access-flow strong {
    margin-bottom: 4px;
    color: #fff;
    font-size: 0.96rem;
  }

  .yc-account-access-flow small {
    color: rgba(255,255,255,0.64);
    line-height: 1.45;
  }

  .yc-account-access-security-note {
    margin-top: 28px;
    padding: 18px;
    display: grid;
    grid-template-columns: 42px 1fr;
    gap: 14px;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 20px;
    background: rgba(7, 25, 61, 0.28);
  }

  .yc-account-access-security-note > svg,
  .yc-account-access-security-note > span {
    width: 42px;
    height: 42px;
    padding: 10px;
    border-radius: 14px;
    color: #10264f;
    background: #baf2ff;
  }

  .yc-account-access-security-note strong {
    display: block;
    margin-bottom: 4px;
    color: #fff;
  }

  .yc-account-access-security-note p {
    margin: 0;
    color: rgba(255,255,255,0.67);
    font-size: 0.88rem;
    line-height: 1.55;
  }

  .yc-account-access-form-panel {
    min-width: 0;
  }

  .yc-account-access-form-card {
    position: relative;
    padding: clamp(26px, 3vw, 42px);
    border: 1px solid rgba(255,255,255,0.88);
    border-radius: 34px;
    background: rgba(255,255,255,0.87);
    box-shadow: var(--yc-aa-shadow);
    backdrop-filter: blur(20px);
  }

  .yc-account-access-form-card > header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--yc-aa-line);
  }

  .yc-account-access-form-card > header small {
    display: block;
    margin-bottom: 5px;
    color: var(--yc-aa-primary-deep);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.11em;
    font-size: 0.72rem;
  }

  .yc-account-access-form-card > header h2 {
    margin: 0;
    color: var(--yc-aa-ink);
    font-size: clamp(1.65rem, 2.1vw, 2.35rem);
    letter-spacing: -0.035em;
  }

  .yc-account-access-form-card > header p {
    margin: 8px 0 0;
    color: var(--yc-aa-muted);
    line-height: 1.55;
  }

  .yc-account-access-page .auth-status-badge {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-radius: 999px;
    color: #17664f;
    background: #e9fbf4;
    font-size: 0.78rem;
    font-weight: 900;
    white-space: nowrap;
  }

  .yc-account-access-page .auth-status-badge i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #28ad7d;
    box-shadow: 0 0 0 4px rgba(40, 173, 125, 0.13);
  }

  .yc-account-access-form {
    display: grid;
    gap: 20px;
    padding-top: 24px;
  }

  .yc-account-access-section {
    display: grid;
    gap: 18px;
    padding: clamp(20px, 2.3vw, 28px);
    border: 1px solid var(--yc-aa-line);
    border-radius: 24px;
    background: linear-gradient(180deg, #ffffff, #fbfdff);
  }

  .yc-account-access-section-heading {
    display: grid;
    grid-template-columns: 42px 1fr;
    align-items: center;
    gap: 13px;
  }

  .yc-account-access-section-heading > span {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 14px;
    color: #fff;
    background: linear-gradient(135deg, var(--yc-aa-primary), var(--yc-aa-primary-deep));
    box-shadow: 0 10px 22px rgba(64, 89, 189, 0.20);
    font-size: 0.83rem;
    font-weight: 900;
  }

  .yc-account-access-section-heading strong,
  .yc-account-access-section-heading small {
    display: block;
  }

  .yc-account-access-section-heading strong {
    margin-bottom: 3px;
    color: var(--yc-aa-ink);
    font-size: 1rem;
  }

  .yc-account-access-section-heading small {
    color: var(--yc-aa-muted);
    line-height: 1.45;
  }

  .yc-account-access-form label {
    position: relative;
    display: grid;
    gap: 8px;
  }

  .yc-account-access-form label > span {
    color: #334a72;
    font-size: 0.82rem;
    font-weight: 850;
  }

  .yc-account-access-page .auth-premium-input {
    min-height: 52px;
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 0 15px;
    border: 1px solid #dce4f0;
    border-radius: 15px;
    background: #fff;
    transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
  }

  .yc-account-access-page .auth-premium-input:focus-within {
    border-color: rgba(97, 116, 229, 0.75);
    box-shadow: 0 0 0 4px rgba(97, 116, 229, 0.11);
    transform: translateY(-1px);
  }

  .yc-account-access-page .auth-premium-input > svg,
  .yc-account-access-page .auth-premium-input > span {
    width: 19px;
    height: 19px;
    color: #7383a3;
  }

  .yc-account-access-page input,
  .yc-account-access-page select,
  .yc-account-access-page textarea {
    min-width: 0;
    width: 100%;
    border: 0;
    outline: 0;
    color: var(--yc-aa-ink);
    background: transparent;
    font: inherit;
  }

  .yc-account-access-page input,
  .yc-account-access-page select {
    min-height: 50px;
  }

  .yc-account-access-page input::placeholder,
  .yc-account-access-page textarea::placeholder {
    color: #9aa8bf;
  }

  .yc-account-access-lookup-input {
    grid-template-columns: 22px minmax(0, 1fr) auto !important;
    padding-right: 6px !important;
  }

  .yc-account-access-lookup-button {
    min-height: 40px;
    border: 0;
    border-radius: 11px;
    padding: 0 16px;
    color: #fff;
    background: linear-gradient(135deg, var(--yc-aa-primary), var(--yc-aa-primary-deep));
    font: inherit;
    font-size: 0.84rem;
    font-weight: 900;
    cursor: pointer;
    white-space: nowrap;
  }

  .yc-account-access-lookup-button:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .yc-account-access-profile-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .yc-account-access-profile-grid input {
    min-height: 49px;
    padding: 0 14px;
    border: 1px solid #e1e7f0;
    border-radius: 13px;
    color: #435777;
    background: #f6f9fd;
    cursor: default;
  }

  .yc-account-access-verified-banner {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 14px;
    border: 1px solid #bfe8d9;
    border-radius: 14px;
    color: #17684f;
    background: #edfbf5;
    font-size: 0.85rem;
    font-weight: 900;
  }

  .yc-account-access-verified-banner > svg,
  .yc-account-access-verified-banner > span:first-child {
    width: 18px;
    height: 18px;
  }

  .yc-account-access-textarea {
    align-items: start !important;
    padding-top: 15px !important;
  }

  .yc-account-access-textarea textarea {
    min-height: 130px;
    resize: vertical;
    line-height: 1.6;
  }

  .yc-account-access-character-count {
    justify-self: end;
    color: #8390a7;
    font-size: 0.75rem;
  }

  .yc-account-access-page .auth-premium-submit {
    width: 100%;
    min-height: 52px;
    border-radius: 15px;
  }

  .yc-account-access-track-link {
    width: 100%;
    margin-top: 18px;
    padding: 14px;
    border: 0;
    border-radius: 15px;
    color: var(--yc-aa-muted);
    background: #f5f8fd;
    font: inherit;
    cursor: pointer;
  }

  .yc-account-access-track-link strong {
    color: var(--yc-aa-primary-deep);
  }

  .yc-account-access-track-link > svg,
  .yc-account-access-track-link > span:last-child {
    width: 16px;
    height: 16px;
    margin-left: 7px;
    vertical-align: middle;
  }

  .yc-account-access-success {
    min-height: 570px;
    padding: clamp(28px, 5vw, 64px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  .yc-account-access-success-icon {
    width: 74px;
    height: 74px;
    display: grid;
    place-items: center;
    margin-bottom: 20px;
    border-radius: 24px;
    color: #fff;
    background: linear-gradient(135deg, #28b987, #159c73);
    box-shadow: 0 16px 36px rgba(21, 156, 115, 0.25);
  }

  .yc-account-access-success-icon > svg,
  .yc-account-access-success-icon > span {
    width: 30px;
    height: 30px;
  }

  .yc-account-access-success > small {
    color: #159c73;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .yc-account-access-success h2 {
    max-width: 620px;
    margin: 12px 0;
    color: var(--yc-aa-ink);
    font-size: clamp(2rem, 3vw, 3rem);
    letter-spacing: -0.045em;
  }

  .yc-account-access-success > p {
    max-width: 560px;
    margin: 0;
    color: var(--yc-aa-muted);
    line-height: 1.7;
  }

  .yc-account-access-ticket-id {
    width: min(100%, 480px);
    margin: 28px 0;
    padding: 18px 22px;
    display: grid;
    gap: 6px;
    border: 1px dashed rgba(97, 116, 229, 0.45);
    border-radius: 18px;
    background: #f5f7ff;
  }

  .yc-account-access-ticket-id span {
    color: var(--yc-aa-muted);
    font-size: 0.76rem;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .yc-account-access-ticket-id strong {
    overflow-wrap: anywhere;
    color: var(--yc-aa-primary-deep);
    font-size: clamp(1.35rem, 2.2vw, 2rem);
    letter-spacing: 0.06em;
  }

  .yc-account-access-success-actions {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  @media (min-width: 1800px) {
    .yc-account-access-page .auth-premium-header,
    .yc-account-access-shell {
      width: min(100% - 96px, 1760px);
    }

    .yc-account-access-shell {
      grid-template-columns: minmax(520px, 0.95fr) minmax(700px, 1.05fr);
      gap: 88px;
      padding-top: 42px;
    }

    .yc-account-access-story {
      min-height: 760px;
    }
  }

  @media (max-width: 1180px) {
    .yc-account-access-shell {
      grid-template-columns: minmax(300px, 0.78fr) minmax(520px, 1.22fr);
      gap: 26px;
    }

    .yc-account-access-story {
      padding: 34px;
      border-radius: 30px;
    }

    .yc-account-access-form-card {
      border-radius: 28px;
    }
  }

  @media (max-width: 960px) {
    .yc-account-access-page .auth-premium-header,
    .yc-account-access-shell {
      width: min(100% - 32px, 820px);
    }

    .yc-account-access-page .auth-premium-header {
      min-height: 76px;
    }

    .yc-account-access-shell {
      grid-template-columns: 1fr;
      gap: 22px;
      padding-top: 12px;
    }

    .yc-account-access-story {
      position: relative;
      top: auto;
      min-height: auto;
      padding: 32px;
    }

    .yc-account-access-story h1 {
      max-width: 680px;
      font-size: clamp(2.6rem, 8vw, 4.8rem);
    }

    .yc-account-access-flow {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .yc-account-access-flow article {
      grid-template-columns: 1fr;
      align-items: start;
    }

    .yc-account-access-security-note {
      max-width: 640px;
    }
  }

  @media (max-width: 720px) {
    .yc-account-access-page .auth-premium-header {
      width: calc(100% - 24px);
      min-height: 68px;
      padding: 10px 0;
    }

    .yc-account-access-page .auth-premium-header > div:last-child {
      gap: 6px;
    }

    .yc-account-access-page .auth-premium-link {
      display: none;
    }

    .yc-account-access-page .button-small {
      min-height: 40px;
      padding-inline: 13px;
      font-size: 0.82rem;
    }

    .yc-account-access-shell {
      width: calc(100% - 24px);
      padding: 8px 0 36px;
    }

    .yc-account-access-story,
    .yc-account-access-form-card {
      border-radius: 24px;
    }

    .yc-account-access-story {
      padding: 26px 22px;
    }

    .yc-account-access-story h1 {
      font-size: clamp(2.3rem, 12vw, 4rem);
    }

    .yc-account-access-story-copy > p {
      margin: 18px 0 24px;
      line-height: 1.6;
    }

    .yc-account-access-flow {
      grid-template-columns: 1fr;
    }

    .yc-account-access-flow article {
      grid-template-columns: 42px 1fr;
    }

    .yc-account-access-security-note {
      margin-top: 20px;
    }

    .yc-account-access-form-card {
      padding: 20px;
    }

    .yc-account-access-form-card > header {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: start;
    }

    .yc-account-access-profile-grid {
      grid-template-columns: 1fr;
    }

    .yc-account-access-success {
      min-height: 470px;
      padding: 28px 10px;
    }
  }

  @media (max-width: 520px) {
    .yc-account-access-page .auth-premium-header {
      justify-content: center;
    }

    .yc-account-access-page .auth-mobile-back-link {
      position: absolute;
      left: 0;
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border: 1px solid var(--yc-aa-line);
      border-radius: 13px;
      color: var(--yc-aa-ink);
      background: rgba(255,255,255,0.82);
      font-size: 1.2rem;
    }

    .yc-account-access-page .auth-premium-header > div:last-child {
      display: none;
    }

    .yc-account-access-shell {
      width: calc(100% - 16px);
    }

    .yc-account-access-story {
      padding: 24px 18px;
      border-radius: 21px;
    }

    .yc-account-access-kicker {
      margin-bottom: 16px;
      font-size: 0.65rem;
    }

    .yc-account-access-story h1 {
      font-size: clamp(2.15rem, 13vw, 3.4rem);
    }

    .yc-account-access-story-copy > p {
      font-size: 0.94rem;
    }

    .yc-account-access-flow article {
      padding: 12px;
      border-radius: 15px;
    }

    .yc-account-access-security-note {
      grid-template-columns: 36px 1fr;
      padding: 14px;
      border-radius: 16px;
    }

    .yc-account-access-form-card {
      padding: 16px;
      border-radius: 21px;
    }

    .yc-account-access-form-card > header {
      grid-template-columns: 1fr;
      padding-bottom: 18px;
    }

    .yc-account-access-page .auth-status-badge {
      width: fit-content;
    }

    .yc-account-access-form {
      padding-top: 16px;
      gap: 14px;
    }

    .yc-account-access-section {
      padding: 16px;
      border-radius: 18px;
    }

    .yc-account-access-section-heading {
      grid-template-columns: 36px 1fr;
    }

    .yc-account-access-section-heading > span {
      width: 36px;
      height: 36px;
      border-radius: 12px;
    }

    .yc-account-access-lookup-input {
      grid-template-columns: 20px minmax(0, 1fr) !important;
      padding: 0 12px 8px !important;
    }

    .yc-account-access-lookup-input > svg,
    .yc-account-access-lookup-input > span:first-child {
      align-self: center;
    }

    .yc-account-access-lookup-button {
      grid-column: 1 / -1;
      width: 100%;
      min-height: 42px;
      margin-top: 2px;
    }

    .yc-account-access-success-actions {
      width: 100%;
      display: grid;
    }

    .yc-account-access-success-actions .button {
      width: 100%;
    }
  }

  @media (max-width: 360px) {
    .yc-account-access-story h1 {
      font-size: 2rem;
    }

    .yc-account-access-form-card {
      padding: 13px;
    }

    .yc-account-access-section {
      padding: 13px;
    }

    .yc-account-access-section-heading small {
      font-size: 0.76rem;
    }

    .yc-account-access-track-link {
      font-size: 0.82rem;
    }
  }

  @media (max-height: 760px) and (min-width: 961px) {
    .yc-account-access-story {
      position: relative;
      top: auto;
      min-height: 680px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .yc-account-access-page *,
    .yc-account-access-page *::before,
    .yc-account-access-page *::after {
      scroll-behavior: auto !important;
      transition: none !important;
      animation: none !important;
    }
  }
`;

export default function AccountAccessHelp() {
  const alerts = useCustomAlert();
  const [form, setForm] = useState(INITIAL_FORM);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [employeeVerified, setEmployeeVerified] = useState(false);
  const [ticketId, setTicketId] = useState('');

  const canSubmit = useMemo(
    () =>
      employeeVerified &&
      form.issueCategory &&
      form.subject.trim() &&
      form.description.trim() &&
      !submitLoading,
    [employeeVerified, form.issueCategory, form.subject, form.description, submitLoading],
  );

  function openWebsite() {
    window.location.href = '/';
  }

  function openLogin() {
    window.location.href = '/login';
  }

  function openTracking() {
    const query = ticketId
      ? `?ticket=${encodeURIComponent(ticketId)}`
      : '';
    window.location.href = `/account-access-track${query}`;
  }

  function updateIdentifier(value) {
    setForm((current) => ({
      ...INITIAL_FORM,
      identifier: value,
    }));
    setEmployeeVerified(false);
    setTicketId('');
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function lookupEmployee(event) {
    event?.preventDefault();

    const identifier = form.identifier.trim();

    if (!identifier) {
      alerts.warning(
        'Enter your employee code or registered email address.',
        'Employee Details Required',
      );
      return;
    }

    try {
      setLookupLoading(true);
      setEmployeeVerified(false);

      const response = await api('/account-access/lookup', {
        method: 'POST',
        body: JSON.stringify({ identifier }),
      });

      const employee = normalizeLookupPayload(response);

      if (!employee.employeeId || !employee.employeeName || !employee.tenantId) {
        throw new Error(
          'The employee record was found, but its organisation details are incomplete. Please contact HR.',
        );
      }

      setForm((current) => ({
        ...current,
        ...employee,
      }));
      setEmployeeVerified(true);
    } catch (error) {
      setForm((current) => ({
        ...INITIAL_FORM,
        identifier: current.identifier,
      }));
      setEmployeeVerified(false);
      alerts.error(
        error.message || 'No matching employee account was found.',
        'Employee Not Found',
      );
    } finally {
      setLookupLoading(false);
    }
  }

  async function submitRequest(event) {
    event.preventDefault();

    if (!employeeVerified) {
      alerts.warning(
        'Verify your employee code or email before submitting the request.',
        'Employee Verification Required',
      );
      return;
    }

    if (!form.issueCategory) {
      alerts.warning('Select the account-access issue type.', 'Issue Type Required');
      return;
    }

    if (!form.subject.trim()) {
      alerts.warning('Enter a short subject for the issue.', 'Subject Required');
      return;
    }

    if (form.description.trim().length < 20) {
      alerts.warning(
        'Describe the issue in at least 20 characters so the support team can understand it.',
        'More Details Required',
      );
      return;
    }

    try {
      setSubmitLoading(true);

      const response = await api('/account-access/requests', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: form.employeeId,
          employee_code: form.employeeCode,
          employee_name: form.employeeName,
          email: form.email,
          department: form.department,
          designation: form.designation,
          tenant_id: form.tenantId,
          tenant_name: form.tenantName,
          issue_category: form.issueCategory,
          subject: form.subject.trim(),
          description: form.description.trim(),
        }),
      });

      const createdTicketId = normalizeTicketId(response);

      if (!createdTicketId) {
        throw new Error('The request was submitted, but no ticket ID was returned.');
      }

      setTicketId(createdTicketId);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to submit the account-access request.',
        'Request Submission Failed',
      );
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <div className="app-page auth-premium-page yc-account-access-page">
      <style>{ACCOUNT_ACCESS_PAGE_STYLES}</style>
      <header className="auth-premium-header">
        <button
          type="button"
          className="auth-mobile-back-link"
          aria-label="Back to login"
          onClick={openLogin}
        >
          <span aria-hidden="true">←</span>
        </button>

        <Brand compact />

        <div>
          <button
            type="button"
            className="auth-premium-link"
            onClick={openWebsite}
          >
            Back to website
          </button>

          <button
            type="button"
            className="button button-primary button-small"
            onClick={openLogin}
          >
            Employee login <Icon name="arrow" />
          </button>
        </div>
      </header>

      <main className="auth-premium-shell yc-account-access-shell">
        <section className="auth-premium-story yc-account-access-story">
          <div className="auth-premium-story-copy">
            <small className="yc-account-access-kicker">Account assistance</small>

            <h1>
              Get back into
              <em>your workspace.</em>
            </h1>

            <p>
              Verify your employee account, explain the access problem and send
              the request directly to your organisation’s HR and IT team.
            </p>

            <div className="yc-account-access-flow" aria-label="Account support process">
              <article>
                <span>01</span>
                <div>
                  <strong>Verify your identity</strong>
                  <small>Use your employee code or registered email.</small>
                </div>
              </article>

              <article>
                <span>02</span>
                <div>
                  <strong>Submit the issue</strong>
                  <small>Your request is routed only within your company.</small>
                </div>
              </article>

              <article>
                <span>03</span>
                <div>
                  <strong>Track the resolution</strong>
                  <small>Use the unique ticket ID sent to your email.</small>
                </div>
              </article>
            </div>
          </div>

          <aside className="yc-account-access-security-note">
            <Icon name="shield" />
            <div>
              <strong>Tenant-secured support</strong>
              <p>
                Your request is visible only to authorised HR and IT personnel
                from your registered organisation.
              </p>
            </div>
          </aside>
        </section>

        <section className="auth-premium-form-panel yc-account-access-form-panel">
          <div className="auth-premium-form-card yc-account-access-form-card">
            {ticketId ? (
              <div className="yc-account-access-success" role="status">
                <span className="yc-account-access-success-icon">
                  <Icon name="check" />
                </span>

                <small>Request submitted successfully</small>
                <h2>Your account-access ticket is ready.</h2>
                <p>
                  Keep this ticket ID safe. A confirmation has also been sent
                  to your registered email address.
                </p>

                <div className="yc-account-access-ticket-id">
                  <span>Ticket ID</span>
                  <strong>{ticketId}</strong>
                </div>

                <div className="yc-account-access-success-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={openTracking}
                  >
                    Track this ticket <Icon name="arrow" />
                  </button>

                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={openLogin}
                  >
                    Return to login
                  </button>
                </div>
              </div>
            ) : (
              <>
                <header>
                  <div>
                    <small>Employee support request</small>
                    <h2>Can’t access your account?</h2>
                    <p>Start by locating your registered employee profile.</p>
                  </div>

                  <span className="auth-status-badge">
                    <i /> Secure form
                  </span>
                </header>

                <form
                  className="auth-premium-form yc-account-access-form"
                  onSubmit={submitRequest}
                  noValidate
                >
                  <div className="yc-account-access-section">
                    <div className="yc-account-access-section-heading">
                      <span>1</span>
                      <div>
                        <strong>Find your employee account</strong>
                        <small>Enter either one of the identifiers below.</small>
                      </div>
                    </div>

                    <label>
                      <span>Employee code or registered email</span>

                      <div className="auth-premium-input yc-account-access-lookup-input">
                        <Icon name="people" />

                        <input
                          type="text"
                          name="identifier"
                          value={form.identifier}
                          placeholder="EMP-1024 or name@company.com"
                          autoComplete="username"
                          disabled={lookupLoading || submitLoading}
                          onChange={(event) => updateIdentifier(event.target.value)}
                        />

                        <button
                          type="button"
                          className="yc-account-access-lookup-button"
                          disabled={lookupLoading || submitLoading}
                          onClick={lookupEmployee}
                        >
                          {lookupLoading ? 'Checking…' : 'Find account'}
                        </button>
                      </div>
                    </label>
                  </div>

                  {employeeVerified && (
                    <div className="yc-account-access-section">
                      <div className="yc-account-access-section-heading">
                        <span>2</span>
                        <div>
                          <strong>Confirm your profile</strong>
                          <small>These details were loaded from YourComate.</small>
                        </div>
                      </div>

                      <div className="yc-account-access-profile-grid">
                        <label>
                          <span>Employee name</span>
                          <input type="text" value={form.employeeName} readOnly />
                        </label>

                        <label>
                          <span>Employee code</span>
                          <input type="text" value={form.employeeCode} readOnly />
                        </label>

                        <label>
                          <span>Registered email</span>
                          <input type="text" value={form.email} readOnly />
                        </label>

                        <label>
                          <span>Department</span>
                          <input type="text" value={form.department || 'Not assigned'} readOnly />
                        </label>

                        <label>
                          <span>Designation</span>
                          <input type="text" value={form.designation || 'Not assigned'} readOnly />
                        </label>

                        <label>
                          <span>Company / tenant</span>
                          <input type="text" value={form.tenantName} readOnly />
                        </label>
                      </div>

                      <div className="yc-account-access-verified-banner">
                        <Icon name="check" />
                        <span>Employee profile verified</span>
                      </div>
                    </div>
                  )}

                  {employeeVerified && (
                    <div className="yc-account-access-section">
                      <div className="yc-account-access-section-heading">
                        <span>3</span>
                        <div>
                          <strong>Describe the access problem</strong>
                          <small>Give the IT team enough detail to investigate.</small>
                        </div>
                      </div>

                      <label>
                        <span>Issue type</span>
                        <div className="auth-premium-input">
                          <Icon name="support" />
                          <select
                            name="issueCategory"
                            value={form.issueCategory}
                            disabled={submitLoading}
                            onChange={(event) => updateField('issueCategory', event.target.value)}
                          >
                            <option value="">Select the issue type</option>
                            {ISSUE_CATEGORIES.map((category) => (
                              <option key={category.value} value={category.value}>
                                {category.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </label>

                      <label>
                        <span>Subject</span>
                        <div className="auth-premium-input">
                          <Icon name="document" />
                          <input
                            type="text"
                            name="subject"
                            value={form.subject}
                            maxLength={140}
                            placeholder="Briefly state what is preventing access"
                            disabled={submitLoading}
                            onChange={(event) => updateField('subject', event.target.value)}
                          />
                        </div>
                      </label>

                      <label>
                        <span>Description</span>
                        <div className="auth-premium-input yc-account-access-textarea">
                          <Icon name="chat" />
                          <textarea
                            name="description"
                            value={form.description}
                            rows={5}
                            maxLength={1500}
                            placeholder="Explain what happens when you try to sign in, including any error message you see."
                            disabled={submitLoading}
                            onChange={(event) => updateField('description', event.target.value)}
                          />
                        </div>
                        <small className="yc-account-access-character-count">
                          {form.description.length}/1500
                        </small>
                      </label>

                      <button
                        className="button button-primary auth-premium-submit"
                        type="submit"
                        disabled={!canSubmit}
                      >
                        {submitLoading ? 'Submitting request…' : 'Submit access request'}
                        <Icon name="arrow" />
                      </button>
                    </div>
                  )}
                </form>

                <button
                  type="button"
                  className="yc-account-access-track-link"
                  onClick={openTracking}
                >
                  Already submitted a request? <strong>Track your ticket</strong>
                  <Icon name="arrow" />
                </button>
              </>
            )}
          </div>
        </section>
      </main>

      <AuthPageFooter />
    </div>
  );
}