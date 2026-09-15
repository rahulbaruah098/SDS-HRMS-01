import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Loader2,
  Mail,
  RefreshCcw,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DEMO_NOTICE_HIDE_MS = 3600;

const EMPTY_FILTERS = {
  status: 'pending',
  search: '',
  company_email: '',
  otp_verified: '',
};

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending Approval' },
  { value: 'otp_pending', label: 'OTP Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All Requests' },
];

function formatDate(value) {
  if (!value) {
    return '—';
  }

  if (typeof value === 'object' && value.$date) {
    return new Date(value.$date).toLocaleString('en-IN');
  }

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return String(value);
}

function statusLabel(value) {
  if (!value) {
    return '—';
  }

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeValue(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') {
      return;
    }

    query.append(key, value);
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function getStatusStyle(status) {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'approved') {
    return {
      background: '#eefaf4',
      color: '#28715c',
      border: '1px solid rgba(40, 113, 92, 0.18)',
    };
  }

  if (normalized === 'rejected') {
    return {
      background: '#fff1f4',
      color: '#a5415b',
      border: '1px solid rgba(165, 65, 91, 0.18)',
    };
  }

  if (normalized === 'otp_pending') {
    return {
      background: '#fff7e8',
      color: '#8b651f',
      border: '1px solid rgba(139, 101, 31, 0.18)',
    };
  }

  return {
    background: '#eef5ff',
    color: '#4268b3',
    border: '1px solid rgba(66, 104, 179, 0.18)',
  };
}

function StatusBadge({ status }) {
  return (
    <span
      className="demo-status-badge"
      style={{
        ...getStatusStyle(status),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {String(status || '').toLowerCase() === 'approved' && <CheckCircle2 size={14} />}
      {String(status || '').toLowerCase() === 'rejected' && <XCircle size={14} />}
      {String(status || '').toLowerCase() === 'otp_pending' && <Mail size={14} />}
      {!['approved', 'rejected', 'otp_pending'].includes(String(status || '').toLowerCase()) && (
        <Clock3 size={14} />
      )}
      {statusLabel(status)}
    </span>
  );
}

function MetricCard({ label, value, tone }) {
  const tones = {
    blue: ['#eef5ff', '#4268b3'],
    orange: ['#fff7e8', '#8b651f'],
    green: ['#eefaf4', '#28715c'],
    red: ['#fff1f4', '#a5415b'],
    gray: ['#f3f5f8', '#526078'],
  };
  const [background, color] = tones[tone] || tones.gray;

  return (
    <div
      className={`demo-metric-card demo-metric-${tone || 'gray'}`}
      style={{
        background,
        borderRadius: 18,
        padding: '16px 18px',
        minHeight: 96,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        border: '1px solid rgba(15, 23, 42, 0.08)',
      }}
    >
      <span className="demo-metric-value" style={{ color, fontSize: 28, fontWeight: 800 }}>
        {value ?? 0}
      </span>
      <span className="demo-metric-label" style={{ color: '#475569', fontWeight: 700 }}>
        {label}
      </span>
    </div>
  );
}

function DemoInlineMessage({ feedback, onClose, className = '' }) {
  if (!feedback?.message) {
    return null;
  }

  return (
    <div
      className={`demo-inline-feedback ${feedback.type || 'info'} ${className}`.trim()}
      role={feedback.type === 'error' ? 'alert' : 'status'}
      aria-live={feedback.type === 'error' ? 'assertive' : 'polite'}
    >
      <span className="demo-inline-feedback-icon" aria-hidden="true">
        {feedback.loading ? (
          <Loader2 size={15} className="spin" />
        ) : feedback.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : feedback.type === 'error' || feedback.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <ShieldCheck size={15} />
        )}
      </span>

      <span className="demo-inline-feedback-copy">
        {feedback.title ? <strong>{feedback.title}</strong> : null}
        <span>{feedback.message}</span>
      </span>

      <button
        type="button"
        className="demo-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function RequestDetails({ request }) {
  if (!request) {
    return null;
  }

  const infoRows = [
    ['Company Name', request.company_name],
    ['Company Email', request.company_email],
    ['Company Phone', request.company_phone],
    ['Company Address', request.company_address],
    ['Company Type', request.company_type],
    ['Contact Person', request.contact_person_name],
    ['Contact Phone', request.contact_person_phone],
    ['Requested Employees', request.requested_employee_count],
    ['OTP Verified', request.otp_verified ? 'Yes' : 'No'],
    ['Generated Admin Email', request.generated_admin_email],
    ['Tenant ID', request.tenant_id],
    ['Trial Start', formatDate(request.trial_start_date)],
    ['Trial End', formatDate(request.trial_end_date)],
    ['Requested At', formatDate(request.created_at)],
    ['Approved At', formatDate(request.approved_at)],
    ['Rejected At', formatDate(request.rejected_at)],
    ['Rejection Reason', request.rejection_reason],
  ];

  return (
    <div className="table-wrap demo-details-wrap">
      <table className="demo-details-table">
        <tbody>
          {infoRows.map(([label, value]) => (
            <tr key={label}>
              <th style={{ width: 220 }}>{label}</th>
              <td>{safeValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {request.message && (
        <div className="demo-company-message" style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8 }}>Company Message / Purpose</h4>
          <p style={{ margin: 0, color: '#475569', lineHeight: 1.6 }}>{request.message}</p>
        </div>
      )}
    </div>
  );
}

// SaaS trial: approval starts a 15-day full-access trial.
export default function DemoRequests() {
  const alerts = useCustomAlert();

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState({ ...EMPTY_FILTERS });
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [inlineFeedback, setInlineFeedback] = useState({});
  const feedbackTimersRef = useRef({});

  function clearInlineFeedback(scope) {
    if (!scope) {
      return;
    }

    const timer = feedbackTimersRef.current[scope];
    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scope];
    }

    setInlineFeedback((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scope)) {
        return current;
      }

      const next = { ...current };
      delete next[scope];
      return next;
    });
  }

  function showInlineFeedback(scope, type, message, title = '', options = {}) {
    if (!scope) {
      return;
    }

    const timer = feedbackTimersRef.current[scope];
    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scope];
    }

    setInlineFeedback((current) => ({
      ...current,
      [scope]: {
        type,
        message,
        title,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      feedbackTimersRef.current[scope] = window.setTimeout(() => {
        setInlineFeedback((current) => {
          const next = { ...current };
          delete next[scope];
          return next;
        });
        delete feedbackTimersRef.current[scope];
      }, DEMO_NOTICE_HIDE_MS);
    }
  }

  async function load(
    nextFilters = appliedFilters,
    nextPage = 1,
    feedbackScope = '',
    feedbackMode = 'load',
  ) {
    if (feedbackScope) {
      const loadingCopy =
        feedbackMode === 'refresh'
          ? {
              title: 'Refreshing',
              message: 'Refreshing trial registration requests...',
            }
          : feedbackMode === 'search'
            ? {
                title: 'Applying Filters',
                message: 'Loading trial requests with the selected filter choices...',
              }
            : feedbackMode === 'reset'
              ? {
                  title: 'Resetting Filters',
                  message: 'Resetting the filter choices and loading the default Pending Approval view...',
                }
              : {
                  title: 'Loading Requests',
                  message: 'Loading trial registration requests...',
                };

      showInlineFeedback(
        feedbackScope,
        'info',
        loadingCopy.message,
        loadingCopy.title,
        { loading: true },
      );
    }

    try {
      setLoading(true);

      const query = buildQuery({
        ...nextFilters,
        page: nextPage,
        limit: pagination.limit || 20,
      });

      const data = await api(`/demo-requests/admin/requests${query}`);
      const nextRows = data.items || [];

      setRows(nextRows);
      setCounts(data.counts || {});
      setPagination(data.pagination || { page: nextPage, limit: 20, total: 0, pages: 1 });

      if (feedbackScope) {
        const successCopy =
          feedbackMode === 'refresh'
            ? {
                title: 'Refresh Complete',
                message: 'Trial registration request data refreshed successfully.',
              }
            : feedbackMode === 'search'
              ? {
                  title: 'Filters Applied',
                  message: `${nextRows.length} trial request${nextRows.length === 1 ? '' : 's'} loaded with the selected filter choices.`,
                }
              : feedbackMode === 'reset'
                ? {
                    title: 'Filters Reset',
                    message: 'All filter choices have been reset to the default Pending Approval view.',
                  }
                : {
                    title: 'Requests Loaded',
                    message: `${nextRows.length} trial request${nextRows.length === 1 ? '' : 's'} loaded.`,
                  };

        showInlineFeedback(
          feedbackScope,
          'success',
          successCopy.message,
          successCopy.title,
        );
      }

      return true;
    } catch (error) {
      showInlineFeedback(
        feedbackScope || 'page',
        'error',
        error.message || 'Unable to load trial requests.',
        feedbackMode === 'refresh'
          ? 'Refresh Failed'
          : feedbackMode === 'search'
            ? 'Filter Search Failed'
            : feedbackMode === 'reset'
              ? 'Filter Reset Failed'
              : 'Trial Requests Load Failed',
      );
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function dismissInlineFeedback(event) {
      if (event.target?.closest?.('.demo-inline-feedback')) {
        return;
      }

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      feedbackTimersRef.current = {};
      setInlineFeedback({});
    }

    document.addEventListener('pointerdown', dismissInlineFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissInlineFeedback);
      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      feedbackTimersRef.current = {};
    };
  }, []);

  function updateFilter(key, value) {
    clearInlineFeedback('filters');
    clearInlineFeedback('toolbar-reset');
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function searchRequests(event) {
    event.preventDefault();
    setRejectTarget(null);
    setSelectedRequest(null);

    const nextAppliedFilters = { ...filters };
    const loaded = await load(nextAppliedFilters, 1, 'filters', 'search');

    if (loaded) {
      setAppliedFilters(nextAppliedFilters);
    }
  }

  async function clearFilters(feedbackScope = 'filters') {
    const cleared = { ...EMPTY_FILTERS };
    setFilters(cleared);
    setRejectTarget(null);
    setSelectedRequest(null);

    const loaded = await load(cleared, 1, feedbackScope, 'reset');

    if (loaded) {
      setAppliedFilters(cleared);
    }
  }

  async function viewDetails(row) {
    if (!row?._id) {
      showInlineFeedback(
        'page',
        'warning',
        'Demo request id not found.',
        'Request ID Missing',
      );
      return;
    }

    const feedbackScope = `row:${row._id}`;

    try {
      setDetailsLoading(true);
      setSelectedRequest(row);
      showInlineFeedback(
        feedbackScope,
        'info',
        'Loading the latest request details...',
        'Loading Details',
        { loading: true },
      );

      const data = await api(`/demo-requests/admin/requests/${row._id}`);
      setSelectedRequest(data.request || row);

      showInlineFeedback(
        feedbackScope,
        'success',
        'The latest request details have been loaded.',
        'Details Loaded',
      );

      setTimeout(() => {
        document.getElementById('demo-request-details')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 100);
    } catch (error) {
      showInlineFeedback(
        feedbackScope,
        'error',
        error.message || 'Unable to load request details.',
        'Request Details Failed',
      );
    } finally {
      setDetailsLoading(false);
    }
  }

  async function approve(row) {
    if (!row?._id) {
      showInlineFeedback(
        'page',
        'warning',
        'Demo request id not found.',
        'Request ID Missing',
      );
      return;
    }

    const feedbackScope = `row:${row._id}`;

    if (!row.otp_verified) {
      showInlineFeedback(
        feedbackScope,
        'warning',
        'This company has not completed email OTP verification yet. Approval is allowed only after OTP verification.',
        'OTP Not Verified',
      );
      return;
    }

    const ok = await alerts.confirm(
      `Approve trial registration for ${row.company_name}? The system will create a trial company, generate admin login credentials, start the 15-day full-access trial, and email login details to ${row.company_email}.`,
      'Approve Trial Request',
    );

    if (!ok) {
      return;
    }

    try {
      setLoadingId(row._id);
      showInlineFeedback(
        feedbackScope,
        'info',
        'Creating the trial company, starting the 15-day trial, and preparing the admin login email...',
        'Approving Trial Request',
        { loading: true },
      );

      const data = await api(`/demo-requests/admin/requests/${row._id}/approve`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      showInlineFeedback(
        feedbackScope,
        'success',
        data.message || 'Demo request approved and login details sent by email.',
        'Trial Approved',
      );

      setRejectTarget(null);
      setSelectedRequest(null);
      await load(appliedFilters, pagination.page || 1);
    } catch (error) {
      showInlineFeedback(
        feedbackScope,
        'error',
        error.message || 'Unable to approve trial request.',
        'Approval Failed',
      );
    } finally {
      setLoadingId('');
    }
  }

  function openReject(row) {
    setRejectTarget(row);
    setRejectReason('');
    clearInlineFeedback('reject-form');

    setTimeout(() => {
      document.getElementById('demo-reject-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 100);
  }

  async function reject(event) {
    event.preventDefault();

    if (!rejectTarget?._id) {
      showInlineFeedback(
        'reject-form',
        'warning',
        'Demo request id not found.',
        'Request ID Missing',
      );
      return;
    }

    const rejectId = rejectTarget._id;
    const rowFeedbackScope = `row:${rejectId}`;

    const ok = await alerts.confirm(
      `Reject trial registration for ${rejectTarget.company_name}? The company will be informed by email.`,
      'Reject Trial Request',
    );

    if (!ok) {
      return;
    }

    try {
      setLoadingId(rejectId);
      showInlineFeedback(
        'reject-form',
        'info',
        'Rejecting the trial request and preparing the company email...',
        'Rejecting Trial Request',
        { loading: true },
      );

      const data = await api(`/demo-requests/admin/requests/${rejectTarget._id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          reason: rejectReason,
        }),
      });

      clearInlineFeedback('reject-form');
      showInlineFeedback(
        rowFeedbackScope,
        'success',
        data.message || 'Demo request rejected.',
        'Trial Rejected',
      );

      setRejectTarget(null);
      setRejectReason('');
      setSelectedRequest(null);
      await load(appliedFilters, pagination.page || 1);
    } catch (error) {
      showInlineFeedback(
        'reject-form',
        'error',
        error.message || 'Unable to reject trial request.',
        'Rejection Failed',
      );
    } finally {
      setLoadingId('');
    }
  }

  async function goToPage(page) {
    const safePage = Math.max(1, Math.min(page, pagination.pages || 1));
    await load(appliedFilters, safePage);
  }

  return (
    <div className="page-grid demo-requests-page">
      <style>{`
        .demo-requests-page {
          --demo-ink: #101a3a;
          --demo-ink-soft: #33405f;
          --demo-muted: #6d7892;
          --demo-blue: #5b77d4;
          --demo-blue-deep: #3d559c;
          --demo-cyan: #56aeb6;
          --demo-violet: #756ba8;
          --demo-green: #3d846e;
          --demo-red: #b45870;
          --demo-amber: #9b782f;
          --demo-surface: #ffffff;
          --demo-page: #f8fbfe;
          --demo-border: rgba(146, 158, 196, .34);
          --demo-border-strong: rgba(146, 158, 196, .48);
          --demo-ease: cubic-bezier(.22, 1, .36, 1);

          width: min(1280px, calc(100% - 48px));
          max-width: 1280px;
          min-width: 0;
          margin: 0 auto;
          gap: 22px;
          color: var(--demo-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .demo-requests-page *,
        .demo-requests-page *::before,
        .demo-requests-page *::after {
          box-sizing: border-box;
        }

        .demo-requests-page h1,
        .demo-requests-page h2,
        .demo-requests-page h3,
        .demo-requests-page h4 {
          color: var(--demo-ink);
          font-family: var(--yc-display, var(--heading), inherit);
        }

        .demo-requests-page button,
        .demo-requests-page input,
        .demo-requests-page select,
        .demo-requests-page textarea {
          font: inherit;
        }

        .demo-requests-page button {
          touch-action: manipulation;
          transition:
            transform .18s var(--demo-ease),
            box-shadow .18s var(--demo-ease),
            border-color .18s ease,
            background .18s ease,
            color .18s ease,
            opacity .18s ease;
        }

        .demo-requests-page button:hover:not(:disabled) {
          transform: translateY(-2px);
        }

        .demo-requests-page button:active:not(:disabled) {
          transform: translateY(0);
        }

        .demo-requests-page button:focus-visible,
        .demo-requests-page input:focus-visible,
        .demo-requests-page select:focus-visible,
        .demo-requests-page textarea:focus-visible {
          outline: 3px solid rgba(86,174,182,.18);
          outline-offset: 2px;
        }

        .demo-requests-page button:disabled {
          opacity: .52;
          cursor: not-allowed;
          transform: none !important;
        }

        .demo-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) minmax(190px, 300px);
          gap: clamp(20px, 3vw, 36px);
          align-items: center;
          min-height: 250px;
          margin: 0 !important;
          padding: clamp(24px, 3vw, 40px) !important;
          border: 1px solid rgba(154,164,205,.58) !important;
          border-radius: clamp(28px, 2.7vw, 40px) !important;
          color: var(--demo-ink) !important;
          background: linear-gradient(
            90deg,
            #d3f4fb 0%,
            #f7fcfb 34%,
            #fffdf8 52%,
            #fbf8fa 68%,
            #f0edfb 100%
          ) !important;
          box-shadow:
            10px 12px 0 #b9d7ff,
            0 26px 44px rgba(70,92,140,.12) !important;
        }

        .demo-hero-copy {
          min-width: 0;
        }

        .demo-hero .kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          margin-bottom: 15px;
          padding: 9px 13px;
          border: 0;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 4px 5px 0 #575092;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .demo-hero h1 {
          margin: 12px 0 0;
          font-size: clamp(32px, 4.2vw, 56px);
          font-weight: 730;
          line-height: .98;
          letter-spacing: -.045em;
          overflow-wrap: anywhere;
        }

        .demo-hero p {
          max-width: 760px;
          margin: 14px 0 0;
          color: var(--demo-muted) !important;
          font-size: 14px;
          line-height: 1.75;
        }

        .demo-hero-actions {
          position: relative;
          z-index: 1;
          display: flex;
          justify-content: flex-end;
          width: 100%;
          min-width: 0;
        }

        .demo-action-stack {
          display: grid;
          gap: 9px;
          width: min(320px, 100%);
          min-width: 0;
        }

        .demo-hero-refresh {
          width: 100%;
          min-width: 128px;
          min-height: 54px;
          padding-inline: 18px;
          border: 1px solid rgba(77,119,221,.18) !important;
          border-radius: 15px !important;
          color: #fff !important;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%) !important;
          box-shadow:
            6px 7px 0 #575092,
            0 14px 25px rgba(67,116,170,.12) !important;
          font-weight: 900;
        }

        .demo-hero-refresh svg:first-child {
          animation: demo-refresh-idle 4.2s linear infinite;
        }

        .demo-metric-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }

        .demo-metric-card {
          position: relative;
          overflow: hidden;
          min-width: 0;
          min-height: 120px !important;
          padding: 18px !important;
          border: 1px solid rgba(171,181,211,.66) !important;
          border-radius: 22px !important;
          background: #edf6ff !important;
          box-shadow:
            7px 9px 0 #b9d7ff,
            0 18px 30px rgba(34,38,110,.09) !important;
          transition:
            transform 190ms ease,
            box-shadow 190ms ease,
            border-color 190ms ease !important;
        }

        .demo-metric-card:nth-child(2) {
          background: #fff4d5 !important;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(34,38,110,.09) !important;
        }

        .demo-metric-card:nth-child(3) {
          background: #eaf8f4 !important;
          box-shadow:
            7px 9px 0 #aee6d9,
            0 18px 30px rgba(34,38,110,.09) !important;
        }

        .demo-metric-card:nth-child(4) {
          background: #fff0f2 !important;
          box-shadow:
            7px 9px 0 #f2c2cc,
            0 18px 30px rgba(34,38,110,.09) !important;
        }

        .demo-metric-card:hover {
          transform: translateY(-4px);
          border-color: rgba(102,88,220,.28) !important;
        }

        .demo-metric-value {
          line-height: 1;
          letter-spacing: -.035em;
        }

        .demo-metric-label {
          margin-top: 9px;
          font-size: 12px;
          letter-spacing: .01em;
        }

        .demo-inline-feedback {
          display: grid !important;
          grid-template-columns: auto minmax(0, 1fr) auto !important;
          gap: 9px !important;
          align-items: start !important;
          width: 100% !important;
          min-width: 0 !important;
          padding: 10px 11px !important;
          border: 1px solid rgba(102,88,220,.18) !important;
          border-radius: 12px !important;
          color: #40348d !important;
          background: #f1efff !important;
          box-shadow: 3px 4px 0 #c9c0ff !important;
          font-size: 10px !important;
          line-height: 1.45 !important;
          animation: demo-feedback-in .18s ease both;
        }

        .demo-inline-feedback.success {
          border-color: rgba(4,120,87,.18) !important;
          color: #047857 !important;
          background: #eaf8f4 !important;
          box-shadow: 3px 4px 0 #aee6d9 !important;
        }

        .demo-inline-feedback.warning {
          border-color: rgba(154,104,23,.18) !important;
          color: #9a6817 !important;
          background: #fff4d5 !important;
          box-shadow: 3px 4px 0 #ffe0a5 !important;
        }

        .demo-inline-feedback.error {
          border-color: rgba(162,52,77,.18) !important;
          color: #a2344d !important;
          background: #fff0f2 !important;
          box-shadow: 3px 4px 0 #f2c2cc !important;
        }

        .demo-inline-feedback-icon {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: 22px !important;
          height: 22px !important;
          flex: 0 0 22px !important;
        }

        .demo-inline-feedback-copy {
          min-width: 0 !important;
        }

        .demo-inline-feedback-copy strong,
        .demo-inline-feedback-copy span {
          display: block !important;
          overflow-wrap: anywhere !important;
        }

        .demo-inline-feedback-copy strong {
          margin-bottom: 2px !important;
          font-weight: 950 !important;
        }

        .demo-inline-feedback-copy span {
          font-weight: 750 !important;
        }

        .demo-inline-feedback-close {
          width: 24px !important;
          min-width: 24px !important;
          height: 24px !important;
          display: inline-grid !important;
          place-items: center !important;
          margin: -2px -3px -2px 0 !important;
          padding: 0 !important;
          border: 0 !important;
          border-radius: 8px !important;
          color: currentColor !important;
          background: rgba(255,255,255,.58) !important;
          box-shadow: none !important;
          font-size: 17px !important;
          line-height: 1 !important;
          cursor: pointer;
        }

        .demo-inline-feedback-close:hover:not(:disabled) {
          transform: none !important;
          background: #fff !important;
        }

        .demo-panel {
          overflow: hidden;
          margin: 0 !important;
          padding: clamp(18px, 2.2vw, 26px) !important;
          border: 1px solid rgba(171,181,211,.70) !important;
          border-radius: clamp(26px, 2.2vw, 36px) !important;
          background: #ffffff !important;
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.10) !important;
        }

        .demo-filter-panel {
          box-shadow:
            8px 10px 0 #c9c0ff,
            0 24px 42px rgba(34,38,110,.10) !important;
        }

        .demo-reject-panel {
          box-shadow:
            8px 10px 0 #f2c2cc,
            0 24px 42px rgba(34,38,110,.10) !important;
        }

        .demo-details-panel {
          box-shadow:
            8px 10px 0 #c9c0ff,
            0 24px 42px rgba(34,38,110,.10) !important;
        }

        .demo-list-panel {
          box-shadow:
            8px 10px 0 #b9d7ff,
            0 24px 42px rgba(34,38,110,.10) !important;
        }

        .demo-toolbar {
          display: flex !important;
          justify-content: space-between;
          align-items: flex-start;
          gap: 18px;
          margin-bottom: 18px;
        }

        .demo-toolbar > div:first-child {
          min-width: 0;
        }

        .demo-toolbar h3 {
          margin: 0;
          font-size: clamp(18px, 2vw, 22px);
          line-height: 1.2;
        }

        .demo-toolbar p {
          max-width: 760px;
          margin: 7px 0 0;
          color: var(--demo-muted) !important;
          font-size: 13px;
          line-height: 1.65;
        }

        .demo-toolbar .kicker {
          display: inline-flex;
          margin-bottom: 7px;
          color: var(--demo-blue-deep);
          font-size: 10px;
          font-weight: 850;
          letter-spacing: .10em;
          text-transform: uppercase;
        }

        .demo-total-pill {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 38px;
          padding: 0 12px;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 999px;
          color: #40348d;
          background: #f5f5ff;
          box-shadow: 3px 4px 0 #c9c0ff;
          font-size: 12px;
          font-weight: 900;
        }

        .demo-requests-page .primary,
        .demo-requests-page .secondary,
        .demo-requests-page .danger {
          min-width: 0;
          min-height: 42px;
          padding: 0 14px;
          border-radius: 13px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          line-height: 1.2;
          text-align: center;
          font-weight: 800;
        }

        .demo-requests-page .primary {
          border: 1px solid rgba(91,119,212,.16) !important;
          color: #fff !important;
          background: linear-gradient(135deg, #607bd6, #4ea8b2) !important;
          box-shadow: 0 10px 20px rgba(78,104,177,.16) !important;
        }

        .demo-requests-page .secondary {
          border: 1px solid rgba(91,119,212,.15) !important;
          color: #435a95 !important;
          background: #f5f7ff !important;
          box-shadow: none !important;
        }

        .demo-requests-page .danger {
          border: 1px solid rgba(180,88,112,.16) !important;
          color: #fff !important;
          background: linear-gradient(135deg, #c2657d, #a64d64) !important;
          box-shadow: 0 10px 20px rgba(166,77,100,.14) !important;
        }

        .demo-filter-form {
          display: grid !important;
          grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(190px, 240px);
          gap: 13px !important;
          align-items: end;
          width: 100%;
          min-width: 0;
          padding: 14px !important;
          border: 1px solid rgba(171,181,211,.55) !important;
          border-radius: 22px !important;
          background: #f8f9ff !important;
          box-shadow: 5px 6px 0 rgba(52,43,120,.08) !important;
        }

        .demo-filter-action-stack,
        .demo-toolbar-action-stack,
        .demo-reject-action-stack,
        .demo-row-action-stack {
          min-width: 0;
          display: grid;
          gap: 9px;
        }

        .demo-filter-action-stack {
          align-self: stretch;
        }

        .demo-filter-button-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
        }

        .demo-filter-button-row > button,
        .demo-toolbar-action-stack > button,
        .demo-reject-action-stack > button {
          width: 100%;
        }

        .demo-toolbar-action-stack {
          width: min(260px, 100%);
        }

        .demo-reject-action-stack {
          width: min(300px, 100%);
          align-self: end;
        }

        .demo-row-action-feedback {
          margin-top: 2px;
        }

        .demo-page-feedback {
          width: min(680px, 100%) !important;
        }

        .demo-filter-form label,
        .demo-reject-form label {
          min-width: 0;
          display: grid;
          gap: 7px;
          color: var(--demo-ink-soft);
          font-size: 12px;
          font-weight: 800;
        }

        .demo-requests-page input,
        .demo-requests-page select,
        .demo-requests-page textarea {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(146,158,196,.46) !important;
          border-radius: 13px !important;
          outline: none !important;
          color: var(--demo-ink) !important;
          background: rgba(255,255,255,.98) !important;
          transition:
            border-color .18s ease,
            box-shadow .18s ease,
            background .18s ease;
        }

        .demo-requests-page input,
        .demo-requests-page select {
          min-height: 43px;
          padding: 0 12px;
        }

        .demo-requests-page textarea {
          min-height: 94px;
          padding: 12px;
          resize: vertical;
        }

        .demo-requests-page input:hover,
        .demo-requests-page select:hover,
        .demo-requests-page textarea:hover {
          border-color: rgba(91,119,212,.48) !important;
        }

        .demo-requests-page input:focus,
        .demo-requests-page select:focus,
        .demo-requests-page textarea:focus {
          border-color: rgba(91,119,212,.78) !important;
          box-shadow: 0 0 0 4px rgba(91,119,212,.09) !important;
        }

        .demo-reject-panel {
          border-color: rgba(171,181,211,.70) !important;
          background: #ffffff !important;
        }

        .demo-reject-form {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px !important;
          align-items: end;
        }

        .demo-details-panel {
          scroll-margin-top: 18px;
        }

        .demo-details-wrap {
          overflow: visible !important;
          border: 0 !important;
          border-radius: 0 !important;
          background: transparent !important;
        }

        .demo-details-table {
          width: 100%;
          table-layout: fixed;
          border-collapse: separate;
          border-spacing: 0 8px;
        }

        .demo-details-table tr {
          background: #ffffff;
        }

        .demo-details-table th,
        .demo-details-table td {
          padding: 12px 14px !important;
          border-top: 1px solid rgba(171,181,211,.44) !important;
          border-bottom: 1px solid rgba(171,181,211,.44) !important;
          background: rgba(255,255,255,.92) !important;
          vertical-align: top;
          line-height: 1.55;
          overflow-wrap: anywhere;
        }

        .demo-details-table th {
          border-left: 1px solid rgba(171,181,211,.44) !important;
          border-radius: 13px 0 0 13px;
          color: #66718b;
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: .045em;
        }

        .demo-details-table td {
          border-right: 1px solid rgba(171,181,211,.44) !important;
          border-radius: 0 13px 13px 0;
          color: var(--demo-ink-soft);
          font-size: 13px;
          font-weight: 650;
        }

        .demo-company-message {
          padding: 16px;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 18px;
          background: #f5f5ff;
          box-shadow: 5px 6px 0 #c9c0ff;
        }

        .demo-company-message h4 {
          margin: 0 0 8px !important;
          font-size: 14px;
        }

        .demo-list-panel {
          min-width: 0;
        }

        .demo-request-table-wrap {
          width: 100%;
          min-width: 0;
          overflow-x: auto;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 22px;
          background: #ffffff;
          box-shadow: 5px 6px 0 rgba(52,43,120,.08);
          scrollbar-width: thin;
          scrollbar-color: rgba(91,119,212,.32) transparent;
        }

        .demo-request-table {
          width: 100%;
          min-width: 1120px;
          border-collapse: collapse;
        }

        .demo-request-table th,
        .demo-request-table td {
          padding: 13px 14px !important;
          border-bottom: 1px solid rgba(146,158,196,.20) !important;
          text-align: left;
          vertical-align: top;
          overflow-wrap: anywhere;
        }

        .demo-request-table th {
          position: sticky;
          top: 0;
          z-index: 1;
          color: #67738d;
          background: #f8faff !important;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: .05em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .demo-request-table td {
          color: var(--demo-ink-soft);
          background: #fff;
          font-size: 12px;
          line-height: 1.55;
        }

        .demo-request-table tbody tr {
          transition: background .18s ease;
        }

        .demo-request-table tbody tr:hover td {
          background: #fbfcff;
        }

        .demo-request-table tbody tr:last-child td {
          border-bottom: 0 !important;
        }

        .demo-request-table small {
          color: #7b879e;
          line-height: 1.5;
        }

        .demo-row-actions {
          display: flex !important;
          align-items: center;
          gap: 7px !important;
          flex-wrap: wrap;
        }

        .demo-row-actions .primary,
        .demo-row-actions .secondary,
        .demo-row-actions .danger {
          min-height: 36px;
          padding: 0 10px;
          border-radius: 11px;
          font-size: 11px;
        }

        .demo-otp-state {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }

        .demo-otp-state.verified {
          color: #34745f;
        }

        .demo-otp-state.pending {
          color: #8b651f;
        }

        .demo-empty-state {
          padding: 32px 18px !important;
          color: var(--demo-muted) !important;
          text-align: center;
          font-size: 13px;
        }

        .demo-pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-top: 18px;
          flex-wrap: wrap;
        }

        .demo-pagination p {
          margin: 0;
          color: var(--demo-muted);
          font-size: 12px;
          font-weight: 700;
        }

        @keyframes demo-feedback-in {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes demo-refresh-idle {
          0%, 84% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        @keyframes demo-spin {
          to {
            transform: rotate(360deg);
          }
        }

        .demo-requests-page .spin {
          animation: demo-spin .8s linear infinite;
        }

        @media (max-width: 1100px) {
          .demo-metric-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .demo-filter-form {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .demo-filter-action-stack {
            grid-column: 1 / -1;
            width: 100%;
          }
        }

        @media (max-width: 900px) {
          .demo-requests-page {
            width: min(100% - 28px, 1280px);
            gap: 18px;
          }

          .demo-hero {
            grid-template-columns: 1fr;
          }

          .demo-hero-actions {
            justify-content: flex-start;
          }

          .demo-action-stack {
            width: min(320px, 100%);
          }

          .demo-hero-refresh {
            width: 100%;
          }

          .demo-toolbar {
            align-items: stretch;
          }

          .demo-toolbar > button,
          .demo-toolbar > .demo-total-pill {
            flex: 0 0 auto;
          }
        }

        @media (max-width: 720px) {
          .demo-requests-page {
            width: min(100% - 20px, 1280px);
            gap: 15px;
          }

          .demo-hero {
            padding: 22px !important;
            border-radius: 22px !important;
          }

          .demo-hero h1 {
            font-size: clamp(30px, 9vw, 44px);
          }

          .demo-hero-refresh {
            width: 100%;
          }

          .demo-metric-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .demo-metric-card {
            min-height: 96px !important;
            padding: 15px !important;
          }

          .demo-metric-value {
            font-size: 24px !important;
          }

          .demo-panel {
            padding: 17px !important;
            border-radius: 18px !important;
          }

          .demo-toolbar {
            flex-direction: column;
            gap: 12px;
          }

          .demo-toolbar > button,
          .demo-toolbar > .demo-total-pill,
          .demo-toolbar-action-stack {
            width: 100%;
            justify-content: center;
          }

          .demo-filter-form,
          .demo-reject-form {
            grid-template-columns: 1fr !important;
          }

          .demo-filter-action-stack,
          .demo-reject-action-stack {
            width: 100%;
          }

          .demo-details-table,
          .demo-details-table tbody,
          .demo-details-table tr,
          .demo-details-table th,
          .demo-details-table td {
            display: block;
            width: 100% !important;
          }

          .demo-details-table {
            border-spacing: 0;
          }

          .demo-details-table tr {
            margin-bottom: 9px;
            border: 1px solid rgba(146,158,196,.22);
            border-radius: 14px;
            overflow: hidden;
          }

          .demo-details-table th,
          .demo-details-table td {
            border: 0 !important;
            border-radius: 0 !important;
          }

          .demo-details-table th {
            padding-bottom: 4px !important;
          }

          .demo-details-table td {
            padding-top: 5px !important;
          }

          .demo-request-table-wrap {
            overflow: visible;
            border: 0;
            border-radius: 0;
            background: transparent;
          }

          .demo-request-table,
          .demo-request-table tbody,
          .demo-request-table tr,
          .demo-request-table td {
            display: block;
            width: 100%;
            min-width: 0;
          }

          .demo-request-table thead {
            display: none;
          }

          .demo-request-table tbody {
            display: grid;
            gap: 12px;
          }

          .demo-request-table tr {
            padding: 5px 14px;
            border: 1px solid rgba(171,181,211,.62);
            border-radius: 22px;
            background: #ffffff;
            box-shadow: 5px 6px 0 #b9d7ff;
          }

          .demo-request-table tr:nth-child(3n + 2) {
            box-shadow: 5px 6px 0 #aee6d9;
          }

          .demo-request-table tr:nth-child(3n + 3) {
            box-shadow: 5px 6px 0 #c9c0ff;
          }

          .demo-request-table td {
            position: relative;
            display: grid;
            grid-template-columns: minmax(110px, .72fr) minmax(0, 1.35fr);
            gap: 12px;
            align-items: start;
            padding: 10px 0 !important;
            border-bottom: 1px solid rgba(146,158,196,.16) !important;
            background: transparent !important;
          }

          .demo-request-table td::before {
            content: attr(data-label);
            color: #7a859d;
            font-size: 9px;
            font-weight: 850;
            letter-spacing: .05em;
            text-transform: uppercase;
          }

          .demo-request-table td:last-child {
            border-bottom: 0 !important;
          }

          .demo-request-table tbody tr:hover td {
            background: transparent !important;
          }

          .demo-row-actions {
            align-items: stretch;
          }

          .demo-row-actions .primary,
          .demo-row-actions .secondary,
          .demo-row-actions .danger {
            flex: 1 1 90px;
          }
        }

        @media (max-width: 520px) {
          .demo-requests-page {
            width: calc(100% - 16px);
          }

          .demo-hero {
            padding: 19px !important;
          }

          .demo-hero p {
            font-size: 13px;
          }

          .demo-metric-grid {
            grid-template-columns: 1fr;
          }

          .demo-inline-feedback {
            grid-template-columns: auto minmax(0, 1fr) auto !important;
          }

          .demo-filter-button-row {
            grid-template-columns: 1fr;
          }

          .demo-request-table td {
            grid-template-columns: 1fr;
            gap: 4px;
          }

          .demo-pagination {
            display: grid;
            grid-template-columns: 1fr;
          }

          .demo-pagination .row-actions {
            display: grid !important;
            grid-template-columns: 1fr 1fr;
            width: 100%;
          }
        }

        @media (max-width: 390px) {
          .demo-requests-page {
            width: calc(100% - 12px);
            gap: 12px;
          }

          .demo-hero,
          .demo-panel {
            padding: 16px !important;
          }

          .demo-hero h1 {
            font-size: 29px;
          }

          .demo-hero .kicker {
            font-size: 9px;
          }

          .demo-inline-feedback {
            padding: 11px !important;
          }

          .demo-row-actions .primary,
          .demo-row-actions .secondary,
          .demo-row-actions .danger {
            flex-basis: 100%;
          }
        }

        @media (hover: none) {
          .demo-metric-card:hover,
          .demo-requests-page button:hover:not(:disabled) {
            transform: none !important;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .demo-requests-page *,
          .demo-requests-page *::before,
          .demo-requests-page *::after {
            animation: none !important;
            transition: none !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>

      <section className="hero compact demo-hero">
        <div className="demo-hero-copy">
          <span className="kicker">YourComate SaaS</span>
          <h1>Trial Registration Requests</h1>
          <p>
            Review company trial applications, verify OTP status, approve eligible requests,
            and trigger automatic admin login email delivery.
          </p>
        </div>

        <div className="demo-hero-actions">
          <div className="demo-action-stack">
            <button
              type="button"
              className="secondary demo-hero-refresh"
              onClick={() => load(appliedFilters, pagination.page || 1, 'refresh', 'refresh')}
              disabled={loading}
            >
              <RefreshCcw size={16} />
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>

            <DemoInlineMessage
              feedback={inlineFeedback.refresh}
              onClose={() => clearInlineFeedback('refresh')}
            />
          </div>
        </div>
      </section>

      <DemoInlineMessage
        feedback={inlineFeedback.page}
        onClose={() => clearInlineFeedback('page')}
        className="demo-page-feedback"
      />

      <section className="demo-metric-grid">
        <MetricCard label="Pending Approval" value={counts.pending || 0} tone="blue" />
        <MetricCard label="OTP Pending" value={counts.otp_pending || 0} tone="orange" />
        <MetricCard label="Approved" value={counts.approved || 0} tone="green" />
        <MetricCard label="Rejected" value={counts.rejected || 0} tone="red" />
      </section>

      <section className="panel demo-panel demo-filter-panel">
        <div className="toolbar demo-toolbar">
          <div>
            <h3>Filters</h3>
            <p>Search by company name, company email, phone, contact person, and status.</p>
          </div>

        </div>

        <form className="dynamic-form demo-filter-form" onSubmit={searchRequests} noValidate>
          <label>
            Status
            <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Company Email
            <input
              value={filters.company_email}
              onChange={(event) => updateFilter('company_email', event.target.value)}
              placeholder="company@example.com"
            />
          </label>

          <label>
            OTP Status
            <select
              value={filters.otp_verified}
              onChange={(event) => updateFilter('otp_verified', event.target.value)}
            >
              <option value="">All</option>
              <option value="true">OTP Verified</option>
              <option value="false">OTP Not Verified</option>
            </select>
          </label>

          <label>
            Search
            <input
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="Company / phone / contact person"
            />
          </label>

          <div className="demo-filter-action-stack">
            <div className="demo-filter-button-row">
              <button type="submit" className="primary" disabled={loading}>
                <Search size={16} />
                {loading ? 'Searching...' : 'Search'}
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() => clearFilters('filters')}
                disabled={loading}
              >
                Reset
              </button>
            </div>

            <DemoInlineMessage
              feedback={inlineFeedback.filters}
              onClose={() => clearInlineFeedback('filters')}
            />
          </div>
        </form>
      </section>

      {rejectTarget && (
        <section className="panel demo-panel demo-reject-panel" id="demo-reject-section">
          <div className="toolbar demo-toolbar">
            <div>
              <span className="kicker">Review action</span>
              <h3>Reject Trial Request</h3>
              <p>
                Reject request for <b>{rejectTarget.company_name}</b> — {rejectTarget.company_email}
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason('');
              }}
              disabled={loadingId === rejectTarget._id}
            >
              <X size={16} />
              Close
            </button>
          </div>

          <form className="dynamic-form demo-reject-form" onSubmit={reject} noValidate>
            <label>
              Rejection Reason
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Optional reason that will be emailed to the registered company email"
                rows={3}
              />
            </label>

            <div className="demo-reject-action-stack">
              <button type="submit" className="danger" disabled={loadingId === rejectTarget._id}>
                {loadingId === rejectTarget._id ? 'Rejecting...' : 'Reject Request'}
              </button>

              <DemoInlineMessage
                feedback={inlineFeedback['reject-form']}
                onClose={() => clearInlineFeedback('reject-form')}
              />
            </div>
          </form>
        </section>
      )}

      {selectedRequest && (
        <section className="panel demo-panel demo-details-panel" id="demo-request-details">
          <div className="toolbar demo-toolbar">
            <div>
              <span className="kicker">Request Details</span>
              <h3>{selectedRequest.company_name}</h3>
              <p>
                {detailsLoading
                  ? 'Loading latest request details...'
                  : 'Detailed company, OTP, approval, tenant, and trial information.'}
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => setSelectedRequest(null)}>
              <X size={16} />
              Close
            </button>
          </div>

          <RequestDetails request={selectedRequest} />
        </section>
      )}

      <section className="panel demo-panel demo-list-panel">
        <div className="toolbar demo-toolbar">
          <div>
            <h3>Trial Request List</h3>
            <p>
              Approving a verified request creates the trial company, starts the 15-day full-access trial,
              generates admin credentials, and sends the approval email automatically.
            </p>
          </div>

          <div className="demo-total-pill">
            <ShieldCheck size={18} />
            Total: {pagination.total || 0}
          </div>
        </div>

        <div className="table-wrap demo-request-table-wrap">
          <table className="demo-request-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Registered Email</th>
                <th>Contact</th>
                <th>OTP</th>
                <th>Status</th>
                <th>Requested At</th>
                <th>Generated Admin</th>
                <th>Trial End</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => {
                const isPending = String(row.status || '').toLowerCase() === 'pending';
                const isActionLoading = loadingId === row._id;

                return (
                  <tr key={row._id}>
                    <td data-label="Company">
                      <b>{safeValue(row.company_name)}</b>
                      <br />
                      <small>{safeValue(row.company_type, 'Company type not provided')}</small>
                    </td>

                    <td data-label="Registered Email">{safeValue(row.company_email)}</td>

                    <td data-label="Contact">
                      {safeValue(row.contact_person_name)}
                      <br />
                      <small>{safeValue(row.contact_person_phone || row.company_phone)}</small>
                    </td>

                    <td data-label="OTP">
                      <span className={`demo-otp-state ${row.otp_verified ? 'verified' : 'pending'}`}>
                        {row.otp_verified ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                        {row.otp_verified ? 'Verified' : 'Not Verified'}
                      </span>
                    </td>

                    <td data-label="Status">
                      <StatusBadge status={row.status} />
                    </td>

                    <td data-label="Requested At">{formatDate(row.created_at)}</td>

                    <td data-label="Generated Admin">{safeValue(row.generated_admin_email)}</td>

                    <td data-label="Trial End">{formatDate(row.trial_end_date)}</td>

                    <td data-label="Action">
                      <div className="demo-row-action-stack">
                        <div className="row-actions demo-row-actions">
                          <button type="button" className="secondary" onClick={() => viewDetails(row)}>
                            View
                          </button>

                          {isPending ? (
                            <>
                              <button
                                type="button"
                                className="primary"
                                onClick={() => approve(row)}
                                disabled={isActionLoading || !row.otp_verified}
                                title={!row.otp_verified ? 'OTP verification required before approval' : ''}
                              >
                                {isActionLoading ? 'Approving...' : 'Approve'}
                              </button>

                              <button
                                type="button"
                                className="danger"
                                onClick={() => openReject(row)}
                                disabled={isActionLoading}
                              >
                                Reject
                              </button>
                            </>
                          ) : (
                            <span style={{ color: '#64748b', fontWeight: 700 }}>{statusLabel(row.status)}</span>
                          )}
                        </div>

                        <DemoInlineMessage
                          feedback={inlineFeedback[`row:${row._id}`]}
                          onClose={() => clearInlineFeedback(`row:${row._id}`)}
                          className="demo-row-action-feedback"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!rows.length && (
            <div className="empty demo-empty-state">
              {loading ? 'Loading trial requests...' : 'No trial requests found'}
            </div>
          )}
        </div>

        {(pagination.pages || 1) > 1 && (
          <div className="demo-pagination">
            <p>
              Page {pagination.page || 1} of {pagination.pages || 1}
            </p>

            <div className="row-actions demo-row-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => goToPage((pagination.page || 1) - 1)}
                disabled={loading || (pagination.page || 1) <= 1}
              >
                Previous
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() => goToPage((pagination.page || 1) + 1)}
                disabled={loading || (pagination.page || 1) >= (pagination.pages || 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
