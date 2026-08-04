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
    --yc-aa-navy: #101a3a;
    --yc-aa-violet: #6658dc;
    --yc-aa-violet-deep: #35296f;
    --yc-aa-cream: #fffdf7;
    --yc-aa-lilac: #f1efff;
    --yc-aa-blue: #eef7ff;
    --yc-aa-mint: #eaf8f4;
    --yc-aa-yellow: #fff3cc;
    --yc-aa-muted: #69758d;
    --yc-aa-line: rgba(23, 33, 63, 0.82);
    --yc-aa-soft-line: rgba(23, 33, 63, 0.13);
    min-width: 0;
    min-height: 100svh;
    overflow-x: hidden;
    color: var(--yc-aa-navy);
    background: linear-gradient(135deg, #f5f8ff 0%, #f7f3ff 52%, #f3f6ff 100%);
  }

  .yc-account-access-page,
  .yc-account-access-page * {
    box-sizing: border-box;
  }

  .yc-account-access-page .auth-premium-header {
    position: relative;
    width: min(1540px, calc(100% - 48px));
    min-height: 78px;
    margin-inline: auto;
    padding: 14px 0 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    background: transparent;
  }

  .yc-account-access-page .auth-premium-header > div:last-child {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .yc-account-access-page .auth-premium-link,
  .yc-account-access-page .button {
    min-width: 0;
    min-height: 42px;
    padding: 0 17px;
    border: 1px solid var(--yc-aa-line);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    color: var(--yc-aa-navy);
    background: rgba(255, 255, 255, 0.78);
    font: inherit;
    font-size: 12px;
    font-weight: 900;
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    transition: transform 160ms ease, box-shadow 160ms ease;
  }

  .yc-account-access-page .button-primary {
    border-color: var(--yc-aa-violet-deep);
    border-radius: 999px;
    color: #fff;
    background: var(--yc-aa-violet-deep);
    box-shadow: 0 10px 24px rgba(53, 41, 111, 0.2);
  }

  .yc-account-access-page .button-secondary,
  .yc-account-access-page .button-ghost {
    border-radius: 12px;
    background: #fff;
  }

  .yc-account-access-page .button:hover:not(:disabled),
  .yc-account-access-page .auth-premium-link:hover:not(:disabled) {
    transform: translateY(-2px);
  }

  .yc-account-access-page button:disabled {
    cursor: not-allowed;
    opacity: 0.56;
  }

  .yc-account-access-page .auth-mobile-back-link {
    display: none;
  }

  /* The shell is only a layout grid. It has no outer card, border or shadow. */
  .yc-account-access-shell {
    width: min(1540px, calc(100% - 48px));
    margin-inline: auto;
    padding: 0 0 54px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
    min-height: calc(100svh - 132px);
    gap: 18px;
    border: 0;
    border-radius: 0;
    overflow: visible;
    background: transparent;
    box-shadow: none;
  }

  .yc-account-access-story,
  .yc-account-access-form-panel {
    min-width: 0;
    height: 100%;
    border: 1px solid var(--yc-aa-line);
    border-radius: 28px;
    overflow: hidden;
    box-shadow:
      8px 9px 0 rgba(23, 33, 63, 0.88),
      0 24px 58px rgba(23, 33, 63, 0.1);
  }

  .yc-account-access-story {
    position: relative;
    min-height: 0;
    padding: clamp(30px, 3.2vw, 52px);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: clamp(20px, 2.3vh, 30px);
    color: var(--yc-aa-navy);
    background: linear-gradient(145deg, #f7fdff 0%, #f1efff 64%, #fffaf1 100%);
  }

  /* Removed the decorative circular/background figure. */
  .yc-account-access-story::before,
  .yc-account-access-story::after {
    content: none;
    display: none;
  }

  .yc-account-access-story-copy,
  .yc-account-access-security-note {
    position: relative;
    z-index: 1;
    min-width: 0;
  }

  .yc-account-access-kicker {
    display: inline-flex;
    width: fit-content;
    max-width: 100%;
    margin-bottom: 18px;
    color: var(--yc-aa-violet);
    font-size: 10px;
    font-weight: 950;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .yc-account-access-story h1 {
    max-width: 720px;
    margin: 0;
    color: var(--yc-aa-navy);
    font-family: var(--yc-display, Georgia, serif);
    font-size: clamp(50px, 5.1vw, 82px);
    font-weight: 650;
    line-height: 0.9;
    letter-spacing: -0.055em;
    overflow-wrap: anywhere;
  }

  .yc-account-access-story h1 em {
    display: block;
    margin-top: 4px;
    color: var(--yc-aa-violet);
    font-family: inherit;
    font-style: italic;
    font-weight: 650;
  }

  .yc-account-access-story-copy > p {
    max-width: 690px;
    margin: 24px 0 28px;
    color: var(--yc-aa-muted);
    font-size: clamp(14px, 1vw, 16px);
    line-height: 1.65;
  }

  .yc-account-access-flow {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .yc-account-access-flow article {
    min-width: 0;
    min-height: 86px;
    padding: 13px;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    border: 1px solid var(--yc-aa-soft-line);
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.76);
    box-shadow: 0 10px 24px rgba(23, 33, 63, 0.06);
  }

  .yc-account-access-flow article:nth-child(1) { background: var(--yc-aa-blue); }
  .yc-account-access-flow article:nth-child(2) { background: var(--yc-aa-lilac); }
  .yc-account-access-flow article:nth-child(3) { background: var(--yc-aa-yellow); }

  .yc-account-access-flow article > span {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    color: #fff;
    background: var(--yc-aa-violet-deep);
    font-size: 9px;
    font-weight: 950;
  }

  .yc-account-access-flow strong,
  .yc-account-access-flow small {
    display: block;
    overflow-wrap: anywhere;
  }

  .yc-account-access-flow strong {
    color: var(--yc-aa-navy);
    font-size: 11px;
  }

  .yc-account-access-flow small {
    margin-top: 4px;
    color: var(--yc-aa-muted);
    font-size: 9px;
    line-height: 1.42;
  }

  .yc-account-access-security-note {
    align-self: end;
    width: 100%;
    padding: 15px 16px;
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    border: 1px solid rgba(255, 217, 95, 0.22);
    border-radius: 18px;
    color: #fff;
    background: linear-gradient(135deg, #12233b, #202d3a);
    box-shadow: 0 14px 30px rgba(16, 26, 58, 0.16);
  }

  .yc-account-access-security-note > svg,
  .yc-account-access-security-note > span {
    width: 38px;
    height: 38px;
    padding: 9px;
    border-radius: 12px;
    color: #ffe36e;
    background: rgba(255, 217, 95, 0.12);
  }

  .yc-account-access-security-note strong {
    display: block;
    color: #fff;
    font-size: 12px;
  }

  .yc-account-access-security-note p {
    margin: 4px 0 0;
    color: rgba(255, 255, 255, 0.74);
    font-size: 10px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .yc-account-access-form-panel {
    align-self: stretch;
    padding: clamp(24px, 3vw, 46px);
    background: var(--yc-aa-cream);
  }

  .yc-account-access-form-card {
    width: 100%;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 20px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }

  .yc-account-access-form-card > header {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    padding-bottom: 20px;
  }

  .yc-account-access-form-card > header > div {
    min-width: 0;
  }

  .yc-account-access-form-card > header small {
    display: block;
    margin-bottom: 7px;
    color: var(--yc-aa-violet);
    font-size: 10px;
    font-weight: 950;
    letter-spacing: 0.11em;
    text-transform: uppercase;
  }

  .yc-account-access-form-card > header h2 {
    margin: 0;
    color: var(--yc-aa-navy);
    font-family: var(--yc-display, Georgia, serif);
    font-size: clamp(34px, 3.3vw, 54px);
    font-weight: 650;
    line-height: 0.95;
    letter-spacing: -0.045em;
    overflow-wrap: anywhere;
  }

  .yc-account-access-form-card > header p {
    margin: 10px 0 0;
    color: var(--yc-aa-muted);
    font-size: 13px;
    line-height: 1.55;
  }

  .yc-account-access-page .auth-status-badge {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 11px;
    border: 1px solid #bde6d6;
    border-radius: 999px;
    color: #17684f;
    background: #edf9f4;
    font-size: 9px;
    font-weight: 950;
    white-space: nowrap;
  }

  .yc-account-access-page .auth-status-badge i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #2bb987;
    box-shadow: 0 0 0 4px rgba(43, 185, 135, 0.12);
  }

  .yc-account-access-form {
    width: 100%;
    min-width: 0;
    display: grid;
    gap: 16px;
  }

  .yc-account-access-section {
    min-width: 0;
    display: grid;
    gap: 16px;
    padding: clamp(17px, 2vw, 24px);
    border: 1px solid var(--yc-aa-soft-line);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.76);
  }

  .yc-account-access-section-heading {
    min-width: 0;
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    align-items: center;
    gap: 11px;
  }

  .yc-account-access-section-heading > span {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 11px;
    color: #fff;
    background: var(--yc-aa-violet-deep);
    font-size: 9px;
    font-weight: 950;
  }

  .yc-account-access-section-heading strong,
  .yc-account-access-section-heading small {
    display: block;
    overflow-wrap: anywhere;
  }

  .yc-account-access-section-heading strong {
    color: var(--yc-aa-navy);
    font-size: 12px;
  }

  .yc-account-access-section-heading small {
    margin-top: 3px;
    color: var(--yc-aa-muted);
    font-size: 10px;
  }

  .yc-account-access-form label {
    min-width: 0;
    display: grid;
    gap: 7px;
  }

  .yc-account-access-form label > span {
    color: #243252;
    font-size: 11px;
    font-weight: 850;
  }

  .yc-account-access-page .auth-premium-input {
    width: 100%;
    min-width: 0;
    min-height: 50px;
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 0 13px;
    border: 1px solid #d9dfeb;
    border-radius: 12px;
    background: #edf4ff;
    transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
  }

  .yc-account-access-page .auth-premium-input:focus-within {
    border-color: rgba(102, 88, 220, 0.66);
    background: #fff;
    box-shadow: 0 0 0 4px rgba(102, 88, 220, 0.1);
  }

  .yc-account-access-page .auth-premium-input > svg,
  .yc-account-access-page .auth-premium-input > span:first-child {
    width: 18px;
    height: 18px;
    color: var(--yc-aa-violet);
  }

  .yc-account-access-page input,
  .yc-account-access-page select,
  .yc-account-access-page textarea {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    border: 0;
    outline: 0;
    color: var(--yc-aa-navy);
    background: transparent;
    font: inherit;
    font-size: 13px;
  }

  .yc-account-access-page input,
  .yc-account-access-page select {
    min-height: 48px;
  }

  .yc-account-access-page textarea {
    resize: vertical;
  }

  .yc-account-access-lookup-control {
    width: 100%;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    gap: 10px;
  }

  .yc-account-access-lookup-input {
    min-width: 0;
    grid-template-columns: 20px minmax(0, 1fr);
    padding-right: 13px;
  }

  .yc-account-access-lookup-button {
    min-width: 132px;
    min-height: 50px;
    padding: 0 18px;
    border: 0;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: var(--yc-aa-violet-deep);
    font: inherit;
    font-size: 11px;
    font-weight: 950;
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
    cursor: pointer;
  }

  .yc-account-access-profile-grid,
  .yc-ticket-tracking-grid {
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .yc-account-access-profile-grid input {
    min-height: 46px;
    padding: 0 12px;
    border: 1px solid #dce3ed;
    border-radius: 11px;
    color: #52617b;
    background: #f4f7fb;
  }

  .yc-account-access-verified-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 11px 13px;
    border: 1px solid #bde5d6;
    border-radius: 12px;
    color: #17684f;
    background: #edf9f4;
    font-size: 10px;
    font-weight: 900;
  }

  .yc-account-access-textarea {
    align-items: start;
    padding-top: 13px;
  }

  .yc-account-access-textarea textarea {
    min-height: 118px;
    line-height: 1.55;
  }

  .yc-account-access-character-count {
    justify-self: end;
    color: #8793a8;
    font-size: 9px;
  }

  .yc-account-access-page .auth-premium-submit {
    width: 100%;
    min-height: 50px;
    border-radius: 999px;
  }

  .yc-account-access-track-link {
    width: 100%;
    min-width: 0;
    min-height: 46px;
    margin-top: 2px;
    padding: 10px 14px;
    border: 1px solid var(--yc-aa-soft-line);
    border-radius: 12px;
    color: var(--yc-aa-muted);
    background: #f4f6fb;
    font: inherit;
    font-size: 11px;
    line-height: 1.35;
    white-space: normal;
    overflow-wrap: anywhere;
    cursor: pointer;
  }

  .yc-account-access-track-link strong {
    color: var(--yc-aa-violet-deep);
  }

  .yc-account-access-track-link svg {
    width: 14px;
    height: 14px;
    margin-left: 6px;
    vertical-align: middle;
  }

  .yc-ticket-tracking-form {
    padding-top: 2px;
  }

  .yc-ticket-tracking-result {
    min-width: 0;
    display: grid;
    gap: 14px;
    padding-top: 6px;
  }

  .yc-ticket-tracking-summary {
    min-width: 0;
    padding: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    border: 1px solid var(--yc-aa-soft-line);
    border-radius: 16px;
    background: var(--yc-aa-lilac);
  }

  .yc-ticket-tracking-summary > div {
    min-width: 0;
  }

  .yc-ticket-tracking-summary small,
  .yc-ticket-tracking-summary strong {
    display: block;
  }

  .yc-ticket-tracking-summary strong {
    margin-top: 4px;
    color: var(--yc-aa-violet-deep);
    font-size: 18px;
    overflow-wrap: anywhere;
  }

  .yc-ticket-status {
    flex: 0 0 auto;
    max-width: 100%;
    padding: 8px 11px;
    border-radius: 999px;
    color: #5c3d00;
    background: #fff0b8;
    font-size: 9px;
    font-weight: 950;
    text-align: center;
    white-space: normal;
  }

  .yc-ticket-status-resolved,
  .yc-ticket-status-closed {
    color: #17684f;
    background: #dff7ed;
  }

  .yc-ticket-status-rejected {
    color: #8a3041;
    background: #ffe6eb;
  }

  .yc-ticket-status-in_progress {
    color: #284f91;
    background: #e4efff;
  }

  .yc-ticket-tracking-grid article,
  .yc-ticket-tracking-detail {
    min-width: 0;
    padding: 13px;
    border: 1px solid var(--yc-aa-soft-line);
    border-radius: 13px;
    background: #fff;
  }

  .yc-ticket-tracking-grid strong,
  .yc-ticket-tracking-detail strong,
  .yc-ticket-tracking-detail p {
    overflow-wrap: anywhere;
  }

  .yc-ticket-tracking-resolution {
    min-width: 0;
    padding: 15px;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 12px;
    border: 1px solid #bde5d6;
    border-radius: 15px;
    background: var(--yc-aa-mint);
  }

  .yc-ticket-tracking-resolution-icon {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    color: #fff;
    background: #2bb987;
  }

  .yc-ticket-tracking-empty {
    min-width: 0;
    padding: 15px;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    align-items: center;
    gap: 11px;
    border: 1px solid #efd99a;
    border-radius: 14px;
    color: #745615;
    background: #fff7dc;
  }

  .yc-ticket-tracking-actions {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding-top: 4px;
  }

  .yc-account-access-success {
    min-height: 590px;
    padding: 36px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  .yc-account-access-details-panel {
    grid-column: 1 / -1;
    height: auto;
  }

  .yc-account-access-details-panel .yc-account-access-form-card {
    justify-content: flex-start;
  }

  .yc-account-access-details-form {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  .yc-account-access-details-form > .yc-account-access-section {
    grid-column: 1 / -1;
    width: 100%;
    height: auto;
  }

  .yc-account-access-success-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }

  @media (max-width: 1180px) {
    .yc-account-access-shell {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .yc-account-access-story {
      padding: 30px;
    }

    .yc-account-access-flow {
      grid-template-columns: 1fr;
    }

    .yc-account-access-flow article {
      min-height: 68px;
    }
  }

  @media (max-width: 960px) {
    .yc-account-access-page .auth-premium-header,
    .yc-account-access-shell {
      width: min(820px, calc(100% - 32px));
    }

    .yc-account-access-shell {
      grid-template-columns: minmax(0, 1fr);
      min-height: 0;
    }

    .yc-account-access-story {
      position: relative;
      top: auto;
      min-height: auto;
      max-height: none;
      overflow: hidden;
    }

    .yc-account-access-flow {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .yc-account-access-form-card {
      min-height: 0;
    }

    .yc-account-access-details-form {
      grid-template-columns: minmax(0, 1fr);
    }

    .yc-account-access-details-form > .yc-account-access-section:last-child {
      grid-column: auto;
    }
  }

  @media (max-width: 720px) {
    .yc-account-access-page .auth-premium-header {
      width: calc(100% - 24px);
      min-height: 66px;
      padding-block: 10px;
    }

    .yc-account-access-page .auth-premium-link {
      display: none;
    }

    .yc-account-access-shell {
      width: calc(100% - 24px);
      padding-bottom: 34px;
      gap: 14px;
    }

    .yc-account-access-story,
    .yc-account-access-form-panel {
      border-radius: 22px;
      box-shadow:
        5px 6px 0 rgba(23, 33, 63, 0.84),
        0 18px 38px rgba(23, 33, 63, 0.1);
    }

    .yc-account-access-story {
      padding: 25px 21px;
    }

    .yc-account-access-story h1 {
      font-size: clamp(42px, 12vw, 64px);
    }

    .yc-account-access-flow {
      grid-template-columns: 1fr;
    }

    .yc-account-access-form-panel {
      padding: 20px;
    }

    .yc-account-access-form-card > header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .yc-account-access-profile-grid,
    .yc-ticket-tracking-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 520px) {
    .yc-account-access-page .auth-premium-header {
      justify-content: center;
    }

    .yc-account-access-page .auth-premium-header > div:last-child {
      display: none;
    }

    .yc-account-access-page .auth-mobile-back-link {
      position: absolute;
      left: 0;
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border: 1px solid var(--yc-aa-soft-line);
      border-radius: 12px;
      color: var(--yc-aa-navy);
      background: #fff;
    }

    .yc-account-access-shell {
      width: calc(100% - 16px);
      gap: 13px;
    }

    .yc-account-access-story {
      padding: 22px 17px;
    }

    .yc-account-access-story h1 {
      font-size: clamp(38px, 12vw, 52px);
    }

    .yc-account-access-story-copy > p {
      font-size: 13px;
    }

    .yc-account-access-form-panel {
      padding: 15px;
    }

    .yc-account-access-form-card > header {
      grid-template-columns: minmax(0, 1fr);
    }

    .yc-account-access-section {
      padding: 14px;
    }

    .yc-ticket-tracking-summary {
      align-items: flex-start;
      flex-direction: column;
    }

    .yc-account-access-success-actions,
    .yc-ticket-tracking-actions {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
    }

    .yc-account-access-success-actions .button,
    .yc-ticket-tracking-actions .button,
    .yc-ticket-tracking-actions .auth-premium-link {
      width: 100%;
      white-space: normal;
    }
  }

  @media (max-width: 720px) {
    .yc-account-access-lookup-control {
      grid-template-columns: minmax(0, 1fr);
      gap: 9px;
    }

    .yc-account-access-lookup-button {
      width: 100%;
      min-width: 0;
      min-height: 46px;
      white-space: normal;
    }
  }

  @media (max-width: 420px) {
    .yc-account-access-lookup-input {
      grid-template-columns: 18px minmax(0, 1fr);
      gap: 9px;
      padding-inline: 11px;
    }

    .yc-account-access-lookup-input input {
      font-size: 12px;
    }
  }

  @media (max-width: 360px) {
    .yc-account-access-story h1 {
      font-size: 36px;
    }

    .yc-account-access-form-panel,
    .yc-account-access-section {
      padding: 12px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .yc-account-access-page *,
    .yc-account-access-page *::before,
    .yc-account-access-page *::after {
      animation: none;
      transition: none;
      scroll-behavior: auto;
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

      <main className="yc-account-access-shell">
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
                  onSubmit={lookupEmployee}
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

                      <div className="yc-account-access-lookup-control">
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
                        </div>

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

                </form>

                <button
                  type="button"
                  className="yc-account-access-track-link"
                  onClick={openTracking}
                >
                  Already submitted a request? <strong>Track your ticket</strong>

                </button>
              </>
            )}
          </div>
        </section>

        {employeeVerified && !ticketId && (
          <section className="auth-premium-form-panel yc-account-access-form-panel yc-account-access-details-panel">
            <div className="auth-premium-form-card yc-account-access-form-card">
              <form
                className="auth-premium-form yc-account-access-form yc-account-access-details-form"
                onSubmit={submitRequest}
                noValidate
              >
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
              </form>
            </div>
          </section>
        )}
      </main>

      <AuthPageFooter />
    </div>
  );
}