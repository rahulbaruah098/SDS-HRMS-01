import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';
import AuthPageFooter from '../components/AuthPageFooter';
import Brand from '../components/Brand';
import Icon from '../components/Icon';
import '../styles/auth-pages.css';

const STATUS_LABELS = {
  open: 'Open',
  pending: 'Pending',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  rejected: 'Rejected',
};

function firstValue(...values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }

  return '';
}

function normalizeStatus(value = '') {
  return String(value || 'open')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function formatDate(value) {
  if (!value) return 'Not available';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function normalizeTrackingPayload(payload = {}) {
  const root = payload?.data && typeof payload.data === 'object'
    ? payload.data
    : payload;
  const ticket = root?.ticket && typeof root.ticket === 'object'
    ? root.ticket
    : root?.request && typeof root.request === 'object'
      ? root.request
      : root;
  const employee = ticket?.employee && typeof ticket.employee === 'object'
    ? ticket.employee
    : root?.employee && typeof root.employee === 'object'
      ? root.employee
      : {};
  const tenant = ticket?.tenant && typeof ticket.tenant === 'object'
    ? ticket.tenant
    : root?.tenant && typeof root.tenant === 'object'
      ? root.tenant
      : {};

  return {
    ticketId: firstValue(
      ticket.ticket_id,
      ticket.ticketId,
      ticket.reference_id,
      ticket.referenceId,
      root.ticket_id,
      root.ticketId,
    ),
    employeeName: firstValue(
      ticket.employee_name,
      employee.employee_name,
      employee.full_name,
      employee.name,
    ),
    employeeCode: firstValue(
      ticket.employee_code,
      employee.employee_code,
      employee.code,
    ),
    department: firstValue(
      ticket.department,
      ticket.department_name,
      employee.department,
      employee.department_name,
    ),
    tenantName: firstValue(
      ticket.tenant_name,
      ticket.company_name,
      tenant.tenant_name,
      tenant.company_name,
      tenant.name,
    ),
    category: firstValue(
      ticket.issue_category_label,
      ticket.issue_category,
      ticket.category,
    ),
    subject: firstValue(ticket.subject, ticket.title),
    status: normalizeStatus(ticket.status),
    submittedAt: firstValue(
      ticket.submitted_at,
      ticket.created_at,
      ticket.createdAt,
    ),
    assignedTo: firstValue(
      ticket.assigned_to_name,
      ticket.assigned_to,
      ticket.assignee_name,
      ticket.assignee,
    ),
    latestUpdate: firstValue(
      ticket.latest_update,
      ticket.latest_status_note,
      ticket.update_message,
      ticket.internal_public_note,
    ),
    resolutionRemarks: firstValue(
      ticket.resolution_remarks,
      ticket.resolution_note,
      ticket.resolution,
    ),
    resolvedAt: firstValue(
      ticket.resolved_at,
      ticket.closed_at,
      ticket.resolvedAt,
    ),
  };
}

function humanizeCategory(value = '') {
  return String(value || 'Account access issue')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
    grid-template-rows: minmax(calc(100svh - 132px), auto) auto;
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
    grid-template-rows: minmax(0, 1fr) auto;
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

  /*
   * Distribute the tracking introduction, process cards and security note
   * across the full height of the left panel on desktop. The process cards
   * remain centred in the flexible middle area instead of gathering at the
   * top and leaving a large empty block below.
   */
  .yc-ticket-tracking-story-copy-top {
    min-width: 0;
  }

  @media (min-width: 961px) {
    .yc-ticket-tracking-story .yc-account-access-story-copy {
      min-height: 0;
      height: 100%;
      display: grid;
      grid-template-rows: auto minmax(120px, 1fr);
      gap: clamp(24px, 4vh, 48px);
    }

    .yc-ticket-tracking-story .yc-account-access-flow {
      align-self: center;
      margin: 0;
    }
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
    margin-top: 8px;
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
    display: grid;
    gap: 8px;
    align-content: start;
    border: 1px solid var(--yc-aa-soft-line);
    border-radius: 13px;
    background: #fff;
  }

  .yc-ticket-tracking-grid small,
  .yc-ticket-tracking-grid strong,
  .yc-ticket-tracking-detail small,
  .yc-ticket-tracking-detail strong,
  .yc-ticket-tracking-detail p {
    display: block;
    margin: 0;
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


  .yc-ticket-tracking-panel .yc-ticket-tracking-card {
    height: 100%;
  }

  .yc-ticket-tracking-results-panel {
    grid-column: 1 / -1;
    min-width: 0;
    padding: clamp(24px, 3vw, 46px);
    border: 1px solid var(--yc-aa-line);
    border-radius: 28px;
    background: var(--yc-aa-cream);
    box-shadow:
      8px 9px 0 rgba(23, 33, 63, 0.88),
      0 24px 58px rgba(23, 33, 63, 0.1);
  }

  .yc-ticket-tracking-results-inner {
    width: 100%;
    min-width: 0;
    display: grid;
    gap: 18px;
  }

  .yc-ticket-tracking-results-panel .yc-ticket-tracking-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .yc-ticket-tracking-results-panel .yc-ticket-tracking-actions {
    justify-content: center;
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
      grid-template-rows: auto;
      min-height: 0;
    }

    .yc-ticket-tracking-results-panel {
      grid-column: 1;
    }

    .yc-ticket-tracking-results-panel .yc-ticket-tracking-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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
    .yc-account-access-form-panel,
    .yc-ticket-tracking-results-panel {
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

    .yc-account-access-form-panel,
    .yc-ticket-tracking-results-panel {
      padding: 20px;
    }

    .yc-account-access-form-card > header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .yc-account-access-profile-grid,
    .yc-ticket-tracking-grid,
    .yc-ticket-tracking-results-panel .yc-ticket-tracking-grid {
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

    .yc-account-access-form-panel,
    .yc-ticket-tracking-results-panel {
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
    .yc-ticket-tracking-results-panel,
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

export default function AccountAccessTracking() {
  const alerts = useCustomAlert();
  const [ticketInput, setTicketInput] = useState('');
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const statusLabel = useMemo(() => {
    if (!ticket) return '';
    return STATUS_LABELS[ticket.status] || humanizeCategory(ticket.status);
  }, [ticket]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialTicket = String(params.get('ticket') || '').trim();

    if (!initialTicket) return;

    setTicketInput(initialTicket);
    trackTicket(initialTicket);
    // This page only reads the initial query once when it mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ticket?.ticketId) return undefined;

    const refreshCurrentTicket = () => {
      if (document.visibilityState === 'visible') {
        trackTicket(ticket.ticketId, { silent: true });
      }
    };

    const intervalId = window.setInterval(refreshCurrentTicket, 15000);
    window.addEventListener('focus', refreshCurrentTicket);
    document.addEventListener('visibilitychange', refreshCurrentTicket);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshCurrentTicket);
      document.removeEventListener('visibilitychange', refreshCurrentTicket);
    };
    // Refresh whenever the tracked ticket changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.ticketId]);

  function openWebsite() {
    window.location.href = '/';
  }

  function openLogin() {
    window.location.href = '/login';
  }

  function openNewRequest() {
    window.location.href = '/account-access-help';
  }

  function updateTicketInput(value) {
    setTicketInput(value.toUpperCase());
    setTicket(null);
    setHasSearched(false);
  }

  async function trackTicket(value = ticketInput, options = {}) {
    const ticketId = String(value || '').trim();
    const silent = options?.silent === true;

    if (!ticketId) {
      alerts.warning(
        'Enter the unique ticket ID received after submitting your request.',
        'Ticket ID Required',
      );
      return;
    }

    try {
      if (!silent) {
        setLoading(true);
        setHasSearched(true);
        setTicket(null);
      }

      const response = await api(
        `/account-access/track/${encodeURIComponent(ticketId)}?_=${Date.now()}`,
        {
          cache: 'no-store',
        },
      );
      const normalized = normalizeTrackingPayload(response);

      if (!normalized.ticketId) {
        throw new Error('No account-access ticket was found with this ticket ID.');
      }

      setTicket(normalized);

      const url = new URL(window.location.href);
      url.searchParams.set('ticket', normalized.ticketId);
      window.history.replaceState({}, '', url);
    } catch (error) {
      if (!silent) {
        setTicket(null);
        alerts.error(
          error.message || 'Unable to retrieve the account-access ticket.',
          'Ticket Not Found',
        );
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  function submitTracking(event) {
    event.preventDefault();
    trackTicket();
  }

  return (
    <div className="app-page auth-premium-page yc-account-access-page yc-ticket-tracking-page">
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

     <main className="yc-account-access-shell yc-ticket-tracking-shell">
        <section className="auth-premium-story yc-account-access-story yc-ticket-tracking-story">
          <div className="auth-premium-story-copy">
            <div className="yc-ticket-tracking-story-copy-top">
              <small className="yc-account-access-kicker">Request tracking</small>

              <h1>
                Follow your account
                <em>support request.</em>
              </h1>

              <p>
                Enter the unique ticket ID generated when you submitted your
                request to see its latest progress and resolution details.
              </p>
            </div>

            <div className="yc-account-access-flow" aria-label="Ticket tracking process">
              <article>
                <span>01</span>
                <div>
                  <strong>Enter your ticket ID</strong>
                  <small>Use the ID shown after submission or sent by email.</small>
                </div>
              </article>

              <article>
                <span>02</span>
                <div>
                  <strong>View the current status</strong>
                  <small>See whether the request is open, active or resolved.</small>
                </div>
              </article>

              <article>
                <span>03</span>
                <div>
                  <strong>Read the resolution</strong>
                  <small>Resolved tickets show the latest support remarks.</small>
                </div>
              </article>
            </div>
          </div>

          <aside className="yc-account-access-security-note">
            <Icon name="shield" />
            <div>
              <strong>Privacy-protected tracking</strong>
              <p>
                Only limited request information is displayed. Internal HR and
                IT notes remain protected inside YourComate.
              </p>
            </div>
          </aside>
        </section>

        <section className="auth-premium-form-panel yc-account-access-form-panel yc-ticket-tracking-panel">
          <div className="auth-premium-form-card yc-account-access-form-card yc-ticket-tracking-card">
            <header>
              <div>
                <small>Account-access support</small>
                <h2>Track your ticket</h2>
                <p>Enter the unique ticket ID exactly as provided.</p>
              </div>

              <span className="auth-status-badge">
                <i /> Secure lookup
              </span>
            </header>

            <form
              className="auth-premium-form yc-account-access-form yc-ticket-tracking-form"
              onSubmit={submitTracking}
              noValidate
            >
              <label>
                <span>Unique ticket ID</span>

                <div className="yc-account-access-lookup-control">
                  <div className="auth-premium-input yc-account-access-lookup-input">
                    <Icon name="support" />

                    <input
                    type="text"
                    name="ticketId"
                    value={ticketInput}
                    placeholder="Example: AAR-2026-000123"
                    autoComplete="off"
                    spellCheck="false"
                    disabled={loading}
                    onChange={(event) => updateTicketInput(event.target.value)}
                  />
                  </div>

                  <button
                    type="submit"
                    className="yc-account-access-lookup-button"
                    disabled={loading}
                  >
                    {loading ? 'Tracking…' : 'Track ticket'}
                  </button>
                </div>
              </label>
            </form>

          </div>
        </section>

        {(ticket || (hasSearched && !loading)) && (
          <section
            className="yc-ticket-tracking-results-panel"
            aria-live="polite"
          >
            <div className="yc-ticket-tracking-results-inner">
              {ticket ? (
                <div className="yc-ticket-tracking-result">
                  <div className="yc-ticket-tracking-summary">
                    <div>
                      <small>Ticket ID</small>
                      <strong>{ticket.ticketId}</strong>
                    </div>

                    <span className={`yc-ticket-status yc-ticket-status-${ticket.status}`}>
                      {statusLabel}
                    </span>
                  </div>

                  <div className="yc-ticket-tracking-grid">
                    <article>
                      <small>Employee name</small>
                      <strong>{ticket.employeeName || 'Not available'}</strong>
                    </article>

                    <article>
                      <small>Employee code</small>
                      <strong>{ticket.employeeCode || 'Not available'}</strong>
                    </article>

                    <article>
                      <small>Department</small>
                      <strong>{ticket.department || 'Not assigned'}</strong>
                    </article>

                    <article>
                      <small>Company / tenant</small>
                      <strong>{ticket.tenantName || 'Not available'}</strong>
                    </article>

                    <article>
                      <small>Issue category</small>
                      <strong>{humanizeCategory(ticket.category)}</strong>
                    </article>

                    <article>
                      <small>Submitted on</small>
                      <strong>{formatDate(ticket.submittedAt)}</strong>
                    </article>
                  </div>

                  <div className="yc-ticket-tracking-detail">
                    <small>Subject</small>
                    <strong>{ticket.subject || 'Account-access support request'}</strong>
                  </div>

                  <div className="yc-ticket-tracking-detail">
                    <small>Assigned support</small>
                    <strong>{ticket.assignedTo || 'Your organisation’s HR and IT team'}</strong>
                  </div>

                  <div className="yc-ticket-tracking-detail">
                    <small>Latest update</small>
                    <p>
                      {ticket.latestUpdate ||
                        'The request has been received and is awaiting the next update.'}
                    </p>
                  </div>

                  {(ticket.resolutionRemarks || ticket.resolvedAt) && (
                    <div className="yc-ticket-tracking-resolution">
                      <span className="yc-ticket-tracking-resolution-icon">
                        <Icon name="check" />
                      </span>

                      <div>
                        <small>Resolution details</small>
                        <strong>
                          {ticket.resolutionRemarks || 'The account-access issue has been resolved.'}
                        </strong>
                        <p>Resolved on {formatDate(ticket.resolvedAt)}</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="yc-ticket-tracking-empty" role="status">
                  <Icon name="warning" />
                  <div>
                    <strong>Ticket details are unavailable</strong>
                    <p>Check the ticket ID and try again.</p>
                  </div>
                </div>
              )}

              <div className="yc-ticket-tracking-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={openNewRequest}
                >
                  Create a new request
                </button>

                <button
                  type="button"
                  className="auth-premium-link"
                  onClick={openLogin}
                >
                  Back to employee login
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      <AuthPageFooter />
    </div>
  );
}