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

      <main className="auth-premium-shell yc-account-access-shell yc-ticket-tracking-shell">
        <section className="auth-premium-story yc-account-access-story yc-ticket-tracking-story">
          <div className="auth-premium-story-copy">
            <small className="yc-account-access-kicker">Request tracking</small>

            <h1>
              Follow your account
              <em>support request.</em>
            </h1>

            <p>
              Enter the unique ticket ID generated when you submitted your
              request to see its latest progress and resolution details.
            </p>

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

            {ticket && (
              <div className="yc-ticket-tracking-result" aria-live="polite">
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
            )}

            {!ticket && hasSearched && !loading && (
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
      </main>

      <AuthPageFooter />
    </div>
  );
}