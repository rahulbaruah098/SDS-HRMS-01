import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Database,
  Eye,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { api } from '../api/client';

const PAGE_SIZE = 50;
const AUDIT_PAGE_SIZE_OPTIONS = [50, 100, 250];
const AUDIT_POPUP_AUTO_HIDE_MS = 3600;

function normaliseText(value = '') {
  return String(value ?? '').trim();
}

function titleCase(value = '') {
  return normaliseText(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function buildQuery(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    const text = normaliseText(value);

    if (text) {
      searchParams.set(key, text);
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value.$date) {
    return parseDate(value.$date);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = parseDate(value);

  if (!date) {
    return 'Date unavailable';
  }

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function formatRelativeTime(value) {
  const date = parseDate(value);

  if (!date) {
    return 'Unknown time';
  }

  const differenceSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(differenceSeconds);

  let unit = 'second';
  let divisor = 1;

  if (absoluteSeconds >= 86400) {
    unit = 'day';
    divisor = 86400;
  } else if (absoluteSeconds >= 3600) {
    unit = 'hour';
    divisor = 3600;
  } else if (absoluteSeconds >= 60) {
    unit = 'minute';
    divisor = 60;
  }

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  return formatter.format(Math.round(differenceSeconds / divisor), unit);
}

function actorName(row = {}) {
  return (
    normaliseText(row.actor_name) ||
    normaliseText(row.created_by_name) ||
    normaliseText(row.actor_email) ||
    'System'
  );
}

function actorEmail(row = {}) {
  return normaliseText(row.actor_email) || 'No email recorded';
}

function actionTone(action = '') {
  const value = normaliseText(action).toLowerCase();

  if (
    value.includes('delete') ||
    value.includes('remove') ||
    value.includes('reject') ||
    value.includes('fail') ||
    value.includes('suspend')
  ) {
    return 'danger';
  }

  if (
    value.includes('create') ||
    value.includes('approve') ||
    value.includes('activate') ||
    value.includes('success') ||
    value.includes('complete')
  ) {
    return 'success';
  }

  if (
    value.includes('update') ||
    value.includes('edit') ||
    value.includes('change') ||
    value.includes('reset')
  ) {
    return 'warning';
  }

  return 'info';
}

function isInternalIdKey(key = '') {
  const normalised = normaliseText(key).toLowerCase();

  return (
    normalised === 'id' ||
    normalised === '_id' ||
    normalised.endsWith('_id') ||
    normalised.endsWith('id')
  );
}

function sanitiseMetadata(value) {
  if (Array.isArray(value)) {
    return value.map(sanitiseMetadata);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce((result, [key, item]) => {
    if (!isInternalIdKey(key)) {
      result[key] = sanitiseMetadata(item);
    }

    return result;
  }, {});
}

function metadataEntries(meta) {
  const safeMeta = sanitiseMetadata(meta || {});

  if (!safeMeta || typeof safeMeta !== 'object' || Array.isArray(safeMeta)) {
    return [];
  }

  return Object.entries(safeMeta);
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (Array.isArray(value)) {
    return value.length ? value.map(displayValue).join(', ') : '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'object') {
    if (value.$date) {
      return formatDateTime(value.$date);
    }

    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function matchesDateRange(row, dateFrom, dateTo) {
  const date = parseDate(row.created_at || row.updated_at);

  if (!date) {
    return !dateFrom && !dateTo;
  }

  if (dateFrom) {
    const from = new Date(`${dateFrom}T00:00:00`);

    if (date < from) {
      return false;
    }
  }

  if (dateTo) {
    const to = new Date(`${dateTo}T23:59:59.999`);

    if (date > to) {
      return false;
    }
  }

  return true;
}


function InlineActionMessage({ feedback, onClose, className = '' }) {
  if (!feedback) {
    return null;
  }

  return (
    <div
      className={`audit-inline-feedback ${feedback.type || 'info'} ${className}`.trim()}
      role="status"
    >
      <div className="audit-inline-feedback-icon">
        {feedback.loading ? (
          <Loader2 size={15} className="audit-inline-spin" />
        ) : feedback.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : feedback.type === 'error' || feedback.type === 'warning' ? (
          <AlertTriangle size={15} />
        ) : (
          <ShieldCheck size={15} />
        )}
      </div>

      <div className="audit-inline-feedback-copy">
        {feedback.title ? <strong>{feedback.title}</strong> : null}
        <span>{feedback.message}</span>
      </div>

      <button
        type="button"
        className="audit-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss message"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function AuditDetailsModal({ row, onClose }) {
  if (!row || typeof document === 'undefined') {
    return null;
  }

  const metadata = metadataEntries(row.meta);
  const roles = Array.isArray(row.actor_roles)
    ? row.actor_roles.map(titleCase).filter(Boolean)
    : [];

  return createPortal(
    <div
      className="audit-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="audit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-details-title"
      >
        <header className="audit-modal-header">
          <div className="audit-modal-icon">
            <ShieldCheck size={22} />
          </div>

          <div className="audit-modal-title">
            <span>Audit Logs</span>
            <h3 id="audit-details-title">{titleCase(row.action) || 'Recorded action'}</h3>
            <p>{formatDateTime(row.created_at)}</p>
          </div>

          <button
            type="button"
            className="audit-icon-button"
            onClick={onClose}
            aria-label="Close audit details"
          >
            <X size={17} />
          </button>
        </header>

        <div className="audit-detail-grid">
          <article className="audit-detail-card">
            <UserRound size={19} />
            <div>
              <span>Performed by</span>
              <strong>{actorName(row)}</strong>
              <small>{actorEmail(row)}</small>
            </div>
          </article>

          <article className="audit-detail-card">
            <Database size={19} />
            <div>
              <span>Module or record</span>
              <strong>{titleCase(row.entity) || 'General system activity'}</strong>
              <small>{titleCase(row.action) || 'Action recorded'}</small>
            </div>
          </article>

          <article className="audit-detail-card">
            <Building2 size={19} />
            <div>
              <span>Company / tenant</span>
              <strong>{normaliseText(row.tenant_id) || 'Platform-wide'}</strong>
              <small>Audit scope</small>
            </div>
          </article>

          <article className="audit-detail-card">
            <Clock3 size={19} />
            <div>
              <span>Recorded</span>
              <strong>{formatRelativeTime(row.created_at)}</strong>
              <small>{formatDateTime(row.created_at)}</small>
            </div>
          </article>
        </div>

        {roles.length > 0 ? (
          <div className="audit-modal-section">
            <h3>Actor access</h3>
            <div className="audit-role-list">
              {roles.map((role) => (
                <span key={role}>{role}</span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="audit-modal-section">
          <h3>Event details</h3>

          {metadata.length > 0 ? (
            <dl className="audit-metadata-list">
              {metadata.map(([key, value]) => (
                <div key={key}>
                  <dt>{titleCase(key)}</dt>
                  <dd>{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="audit-empty-details">
              No additional event details were recorded.
            </div>
          )}
        </div>

        <footer className="audit-modal-footer">
          <p>
            Internal database IDs are intentionally hidden from this interface.
          </p>

          <button type="button" className="audit-secondary-button" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default function AuditLogs() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [tenantInput, setTenantInput] = useState('');
  const [appliedTenant, setAppliedTenant] = useState('');

  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [selectedRow, setSelectedRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [inlineFeedback, setInlineFeedback] = useState({});
  const inlineFeedbackTimersRef = useRef({});
  const pendingRequestFeedbackRef = useRef('');
  const totalRef = useRef(0);

  const clearInlineFeedback = useCallback((scope) => {
    if (!scope) {
      return;
    }

    const timer = inlineFeedbackTimersRef.current[scope];

    if (timer) {
      window.clearTimeout(timer);
      delete inlineFeedbackTimersRef.current[scope];
    }

    setInlineFeedback((previous) => {
      if (!Object.prototype.hasOwnProperty.call(previous, scope)) {
        return previous;
      }

      const next = { ...previous };
      delete next[scope];
      return next;
    });
  }, []);

  const showInlineFeedback = useCallback(
    (scope, type, message, title = '', options = {}) => {
      if (!scope) {
        return;
      }

      const existingTimer = inlineFeedbackTimersRef.current[scope];

      if (existingTimer) {
        window.clearTimeout(existingTimer);
        delete inlineFeedbackTimersRef.current[scope];
      }

      setInlineFeedback((previous) => ({
        ...previous,
        [scope]: {
          type,
          title,
          message,
          loading: Boolean(options.loading),
        },
      }));

      if (!options.loading) {
        inlineFeedbackTimersRef.current[scope] = window.setTimeout(() => {
          setInlineFeedback((previous) => {
            const next = { ...previous };
            delete next[scope];
            return next;
          });
          delete inlineFeedbackTimersRef.current[scope];
        }, AUDIT_POPUP_AUTO_HIDE_MS);
      }
    },
    [],
  );

  const loadAuditLogs = useCallback(
    async ({ silent = false, feedbackScope = '' } = {}) => {
      const actionScope = feedbackScope || pendingRequestFeedbackRef.current || '';

      if (pendingRequestFeedbackRef.current) {
        pendingRequestFeedbackRef.current = '';
      }

      if (silent) {
        setRefreshing(true);
      } else if (!actionScope) {
        setLoading(true);
      }

      if (actionScope) {
        const loadingMessages = {
          search: ['Searching Logs', 'Searching audit records with the selected filters...'],
          refresh: ['Refreshing Logs', 'Checking for the latest audit activity...'],
          reload: ['Reloading Logs', 'Reloading the current audit records...'],
          clear: ['Clearing Filters', 'Clearing filters and restoring the audit list...'],
        };
        const [title, message] = loadingMessages[actionScope] || [
          'Loading Audit Logs',
          'Updating the audit records...',
        ];

        showInlineFeedback(actionScope, 'info', message, title, { loading: true });
      }

      setError('');

      try {
        const requestLimit =
          pageSize === 'all' ? Math.max(totalRef.current, PAGE_SIZE) : pageSize;

        const fetchAuditPage = (limit) =>
          api(
            `/audit_logs${buildQuery({
              page: pageSize === 'all' ? 1 : page,
              limit,
              q: appliedSearch,
              tenant_id: appliedTenant,
              sort_by: 'created_at',
              sort_dir: 'desc',
            })}`,
          );

        let data = await fetchAuditPage(requestLimit);
        let nextTotal = Number(data.total || 0);

        if (pageSize === 'all' && nextTotal > requestLimit) {
          data = await fetchAuditPage(nextTotal);
          nextTotal = Number(data.total || 0);
        }

        const items = Array.isArray(data.items) ? data.items : [];

        totalRef.current = nextTotal;
        setRows(items);
        setTotal(nextTotal);

        if (actionScope) {
          const successMessages = {
            search: [
              'Search Complete',
              `${items.length} audit ${items.length === 1 ? 'record' : 'records'} loaded on this page.`,
            ],
            refresh: [
              'Logs Refreshed',
              'The latest audit activity has been loaded successfully.',
            ],
            reload: [
              'Logs Reloaded',
              'The current audit records were reloaded successfully.',
            ],
            clear: [
              'Filters Cleared',
              'Audit filters were cleared and the records were restored.',
            ],
          };
          const [title, message] = successMessages[actionScope] || [
            'Audit Logs Updated',
            'Audit records were updated successfully.',
          ];

          showInlineFeedback(actionScope, 'success', message, title);
        }
      } catch (loadError) {
        totalRef.current = 0;
        setRows([]);
        setTotal(0);
        const message =
          loadError?.message ||
          'Audit logs could not be loaded. Please check your access and try again.';

        setError(message);

        if (actionScope) {
          showInlineFeedback(actionScope, 'error', message, 'Audit Logs Failed');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [appliedSearch, appliedTenant, page, pageSize, showInlineFeedback],
  );

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  useEffect(() => {
    return () => {
      Object.values(inlineFeedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      inlineFeedbackTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    function dismissInlineFeedback() {
      Object.values(inlineFeedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      inlineFeedbackTimersRef.current = {};
      setInlineFeedback({});
    }

    document.addEventListener('pointerdown', dismissInlineFeedback);
    return () => document.removeEventListener('pointerdown', dismissInlineFeedback);
  }, []);

  useEffect(() => {
    if (!selectedRow || typeof document === 'undefined') {
      return undefined;
    }

    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousRootOverscroll = root.style.overscrollBehavior;

    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    root.style.overscrollBehavior = 'none';

    const blockBackgroundScroll = (event) => {
      const activeModal = document.querySelector('.audit-modal');

      if (activeModal && activeModal.contains(event.target)) {
        return;
      }

      event.preventDefault();
    };

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setSelectedRow(null);
      }
    };

    document.addEventListener('wheel', blockBackgroundScroll, { passive: false });
    document.addEventListener('touchmove', blockBackgroundScroll, { passive: false });
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('wheel', blockBackgroundScroll);
      document.removeEventListener('touchmove', blockBackgroundScroll);
      window.removeEventListener('keydown', closeOnEscape);

      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      root.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [selectedRow]);

  const actionOptions = useMemo(
    () =>
      [...new Set(rows.map((row) => normaliseText(row.action)).filter(Boolean))].sort(
        (first, second) => first.localeCompare(second),
      ),
    [rows],
  );

  const entityOptions = useMemo(
    () =>
      [...new Set(rows.map((row) => normaliseText(row.entity)).filter(Boolean))].sort(
        (first, second) => first.localeCompare(second),
      ),
    [rows],
  );

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        if (actionFilter && normaliseText(row.action) !== actionFilter) {
          return false;
        }

        if (entityFilter && normaliseText(row.entity) !== entityFilter) {
          return false;
        }

        return matchesDateRange(row, dateFrom, dateTo);
      }),
    [actionFilter, dateFrom, dateTo, entityFilter, rows],
  );

  const pageCount =
    pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));

  const actorCount = useMemo(
    () =>
      new Set(
        visibleRows
          .map((row) => normaliseText(row.actor_email) || actorName(row))
          .filter(Boolean),
      ).size,
    [visibleRows],
  );

  const actionCount = useMemo(
    () =>
      new Set(visibleRows.map((row) => normaliseText(row.action)).filter(Boolean))
        .size,
    [visibleRows],
  );

  const latestActivity = visibleRows[0]?.created_at || rows[0]?.created_at || null;

  function applyServerFilters(event) {
    event?.preventDefault();

    const nextSearch = searchInput.trim();
    const nextTenant = tenantInput.trim();
    const requestChanged =
      page !== 1 ||
      appliedSearch !== nextSearch ||
      appliedTenant !== nextTenant;

    showInlineFeedback(
      'search',
      'info',
      'Searching audit records with the selected filters...',
      'Searching Logs',
      { loading: true },
    );

    if (!requestChanged) {
      loadAuditLogs({ feedbackScope: 'search' });
      return;
    }

    pendingRequestFeedbackRef.current = 'search';
    setPage(1);
    setAppliedSearch(nextSearch);
    setAppliedTenant(nextTenant);
  }

  function clearFilters() {
    const requiresServerReload = Boolean(appliedSearch || appliedTenant || page !== 1);

    if (requiresServerReload) {
      pendingRequestFeedbackRef.current = 'clear';
      showInlineFeedback(
        'clear',
        'info',
        'Clearing filters and restoring the audit list...',
        'Clearing Filters',
        { loading: true },
      );
    }

    setSearchInput('');
    setAppliedSearch('');
    setTenantInput('');
    setAppliedTenant('');
    setActionFilter('');
    setEntityFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);

    if (!requiresServerReload) {
      showInlineFeedback(
        'clear',
        'success',
        'Audit filters were cleared successfully.',
        'Filters Cleared',
      );
    }
  }

  function refreshAuditLogs(scope) {
    return loadAuditLogs({ silent: true, feedbackScope: scope });
  }

  function handlePageSizeChange(event) {
    const value = event.target.value;
    setPage(1);
    setPageSize(value === 'all' ? 'all' : Number(value));
  }

  const hasFilters = Boolean(
    appliedSearch ||
      appliedTenant ||
      actionFilter ||
      entityFilter ||
      dateFrom ||
      dateTo,
  );

  return (
    <section className="page-grid audit-page">
      <style>{`
        .audit-page {
          --audit-ink: #101a3a;
          --audit-muted: #5d6d8d;
          --audit-primary: #6658dc;
          --audit-primary-deep: #40348d;
          --audit-cyan: #18b5c8;
          --audit-border: rgba(16, 26, 58, .14);
          --audit-ease: cubic-bezier(.22, 1, .36, 1);

          display: grid;
          gap: clamp(18px, 2vw, 26px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding-bottom: max(34px, env(safe-area-inset-bottom));
          color: var(--audit-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .audit-page *,
        .audit-page *::before,
        .audit-page *::after {
          box-sizing: border-box;
        }

        .audit-page > *,
        .audit-page .audit-panel,
        .audit-page .audit-filter-header,
        .audit-page .audit-filter-form,
        .audit-page .audit-advanced-filters,
        .audit-page .audit-table-topbar,
        .audit-page .audit-table-wrap,
        .audit-page .audit-pagination {
          width: 100%;
          min-width: 0;
          max-width: 100%;
        }

        .audit-page input,
        .audit-page select,
        .audit-page button {
          max-width: 100%;
        }

        .audit-hero {
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 28px;
          min-height: 250px;
          padding: clamp(26px, 3vw, 42px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background: linear-gradient(
            90deg,
            #d3f4fb 0%,
            #f7fcfb 34%,
            #fffdf8 52%,
            #fbf8fa 68%,
            #f0edfb 100%
          );
          box-shadow:
            12px 14px 0 #c6d8f7,
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .audit-hero::before,
        .audit-hero::after {
          content: none;
          display: none;
        }

        .audit-hero-copy {
          min-width: 0;
          max-width: 950px;
        }

        .audit-eyebrow {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          max-width: 100%;
          gap: 8px;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
          box-shadow: 4px 5px 0 #595192;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .audit-hero h1 {
          margin: 15px 0 10px;
          color: var(--audit-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(42px, 5vw, 74px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.056em;
          overflow-wrap: anywhere;
        }

        .audit-hero p {
          max-width: 880px;
          margin: 0;
          color: var(--audit-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .audit-hero-action-stack,
        .audit-clear-action-stack {
          display: grid;
          gap: 9px;
          min-width: 0;
        }

        .audit-hero-action-stack {
          flex: 0 0 min(330px, 100%);
          justify-items: stretch;
        }

        .audit-clear-action-stack {
          width: min(330px, 100%);
          justify-items: stretch;
        }

        .audit-page button {
          touch-action: manipulation;
          font: inherit;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 190ms var(--audit-ease),
            box-shadow 190ms ease,
            background 190ms ease,
            border-color 190ms ease,
            color 190ms ease,
            filter 190ms ease;
        }

        .audit-page button:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .audit-page button:active:not(:disabled) {
          transform: translateY(0) scale(.985);
        }

        .audit-page button:disabled {
          cursor: not-allowed;
          opacity: .52;
          transform: none;
          filter: none;
        }

        .audit-primary-button,
        .audit-secondary-button,
        .audit-refresh-button,
        .audit-view-button,
        .audit-page-button,
        .audit-icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          line-height: 1;
          white-space: nowrap;
        }

        .audit-primary-button,
        .audit-refresh-button {
          min-height: 47px;
          padding: 0 16px;
          border: 1px solid rgba(76, 118, 220, .18);
          border-radius: 15px;
          color: #fff;
          background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
          box-shadow:
            6px 7px 0 #595192,
            0 14px 25px rgba(67, 116, 170, .16);
        }

        .audit-refresh-button {
          width: 100%;
        }

        .audit-secondary-button {
          min-height: 47px;
          padding: 0 16px;
          border: 1px solid rgba(65, 55, 161, .18);
          border-radius: 15px;
          color: #40348d;
          background: rgba(255,255,255,.94);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
        }

        .audit-refresh-button svg.is-spinning {
          animation: auditSpin .8s linear infinite;
        }

        @keyframes auditSpin {
          to { transform: rotate(360deg); }
        }

        .audit-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 15px;
        }

        .audit-kpi {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
          min-height: 110px;
          padding: 20px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 22px;
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            5px 6px 0 rgba(196, 204, 255, .78),
            0 15px 30px rgba(34, 38, 110, .07);
        }

        .audit-kpi > div {
          min-width: 0;
        }

        .audit-kpi span {
          display: block;
          color: var(--audit-muted);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .055em;
          text-transform: uppercase;
        }

        .audit-kpi strong {
          display: block;
          margin-top: 5px;
          color: var(--audit-ink);
          font-size: 23px;
          line-height: 1.15;
          overflow-wrap: anywhere;
        }

        .audit-kpi small {
          display: block;
          margin-top: 5px;
          color: #73809a;
          font-size: 10px;
          line-height: 1.4;
        }

        .audit-panel {
          overflow: hidden;
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34, 38, 110, .10);
        }

        .audit-filter-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding: 24px 26px 18px;
          border-bottom: 1px solid rgba(171, 181, 211, .38);
          background: linear-gradient(180deg, rgba(245, 248, 255, .84), rgba(255,255,255,.28));
        }

        .audit-filter-heading {
          display: flex;
          align-items: flex-start;
          gap: 11px;
          min-width: 0;
        }

        .audit-filter-heading > svg {
          flex: 0 0 auto;
          margin-top: 3px;
          color: #40348d;
        }

        .audit-filter-heading > div {
          min-width: 0;
        }

        .audit-filter-heading h2 {
          margin: 0;
          color: var(--audit-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 2.3vw, 37px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
          overflow-wrap: anywhere;
        }

        .audit-filter-heading p {
          max-width: 850px;
          margin: 8px 0 0;
          color: var(--audit-muted);
          font-size: 13px;
          line-height: 1.58;
        }

        .audit-filter-form {
          display: grid;
          grid-template-columns:
            minmax(220px, 1.2fr)
            minmax(210px, 1fr)
            auto
            auto;
          gap: 12px;
          align-items: end;
          padding: 20px 26px 22px;
          border-bottom: 1px solid rgba(171, 181, 211, .38);
          background: rgba(255,255,255,.68);
        }

        .audit-advanced-filters {
          display: grid;
          grid-template-columns: repeat(4, minmax(150px, 1fr));
          gap: 12px;
          padding: 18px 26px 22px;
          border-bottom: 1px solid rgba(171, 181, 211, .30);
          background: linear-gradient(180deg, rgba(248,250,255,.72), rgba(255,255,255,.78));
        }

        .audit-field {
          display: grid;
          gap: 8px;
          min-width: 0;
          margin: 0;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .audit-field label {
          margin: 0;
          color: inherit;
          font: inherit;
        }

        .audit-input-wrap {
          position: relative;
          min-width: 0;
        }

        .audit-input-wrap > svg {
          position: absolute;
          top: 50%;
          left: 14px;
          transform: translateY(-50%);
          color: #7a83a2;
          pointer-events: none;
        }

        .audit-field input,
        .audit-field select {
          width: 100%;
          min-width: 0;
          min-height: 47px;
          padding: 0 13px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 15px;
          outline: 0;
          color: var(--audit-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
          font-weight: 650;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease,
            background 170ms ease;
        }

        .audit-input-wrap input {
          padding-left: 43px;
        }

        .audit-field input:focus,
        .audit-field select:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow:
            4px 5px 0 rgba(102,88,220,.14),
            0 0 0 4px rgba(102,88,220,.08);
          transform: translateY(-1px);
        }

        .audit-filter-form > .audit-primary-button,
        .audit-filter-form > .audit-secondary-button {
          align-self: end;
          min-width: 122px;
        }

        .audit-search-inline-feedback {
          grid-column: 3 / -1;
        }

        .audit-error {
          margin: 16px 24px 0;
          padding: 10px 11px;
          border: 1px solid rgba(162,52,77,.18);
          border-radius: 12px;
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
          font-size: 10px;
          font-weight: 800;
          line-height: 1.45;
        }

        .audit-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
          font-size: 10px;
          line-height: 1.45;
        }

        .audit-inline-feedback.success {
          border-color: rgba(4,120,87,.18);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .audit-inline-feedback.warning {
          border-color: rgba(154,104,23,.18);
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .audit-inline-feedback.error {
          border-color: rgba(162,52,77,.18);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .audit-inline-feedback-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          flex: 0 0 22px;
        }

        .audit-inline-feedback-copy {
          min-width: 0;
        }

        .audit-inline-feedback-copy strong,
        .audit-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .audit-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-size: 10px;
          font-weight: 950;
        }

        .audit-inline-feedback-copy span {
          font-weight: 750;
        }

        .audit-inline-feedback-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          min-width: 24px;
          height: 24px;
          margin: -2px -3px -2px 0;
          padding: 0;
          border: 0;
          border-radius: 8px;
          color: currentColor;
          background: rgba(255,255,255,.52);
          box-shadow: none;
          opacity: .72;
        }

        .audit-inline-feedback-close:hover {
          transform: none !important;
          filter: none !important;
          opacity: 1;
          background: rgba(255,255,255,.92);
        }

        .audit-inline-spin {
          animation: auditInlineSpin .8s linear infinite;
        }

        @keyframes auditInlineSpin {
          to { transform: rotate(360deg); }
        }

        .audit-table-topbar,
        .audit-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 17px 24px 18px;
          background: rgba(248,250,255,.86);
        }

        .audit-table-topbar {
          border-bottom: 1px solid rgba(171,181,211,.38);
        }

        .audit-pagination {
          border-top: 1px solid rgba(171,181,211,.38);
          padding-bottom: 21px;
        }

        .audit-table-topbar p,
        .audit-pagination p {
          margin: 0;
          color: var(--audit-muted);
          font-size: 10px;
          font-weight: 800;
          white-space: nowrap;
        }

        .audit-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          min-width: 0;
        }

        .audit-page-size-control {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 9px;
          min-width: 0;
          color: var(--audit-muted);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .audit-page-size-control > span {
          color: var(--audit-muted);
          font-size: 10px;
          font-weight: 900;
        }

        .audit-page-size-control select {
          min-width: 118px;
          height: 40px;
          padding: 0 34px 0 12px;
          border: 1px solid rgba(102,88,220,.20);
          border-radius: 12px;
          outline: 0;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
          font: inherit;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
        }

        .audit-page-size-control select:focus {
          border-color: rgba(102,88,220,.56);
          box-shadow:
            2px 3px 0 #c9c0ff,
            0 0 0 4px rgba(102,88,220,.08);
        }

        .audit-page-button {
          width: 40px;
          min-width: 40px;
          height: 40px;
          padding: 0;
          border: 1px solid rgba(102,88,220,.20);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
        }

        .audit-page-indicator {
          min-width: 78px;
          text-align: center;
          color: var(--audit-muted);
          font-size: 10px;
          font-weight: 900;
        }

        .audit-table-wrap {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          background: #fff;
        }

        .audit-table {
          width: 100%;
          min-width: 980px;
          border-collapse: collapse;
        }

        .audit-table th {
          padding: 13px 17px;
          background: #f5f7ff;
          color: #596681;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .065em;
          text-align: left;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .audit-table td {
          padding: 16px 17px;
          border-top: 1px solid rgba(171, 181, 211, .25);
          vertical-align: middle;
          color: #263553;
          font-size: 12px;
        }

        .audit-table tbody tr {
          transition: background 170ms ease;
        }

        .audit-table tbody tr:hover {
          background: rgba(241,239,255,.48);
        }

        .audit-actor {
          display: grid;
          gap: 4px;
          min-width: 185px;
        }

        .audit-actor strong,
        .audit-date strong {
          color: #1d2947;
          font-size: 12px;
          font-weight: 900;
          overflow-wrap: anywhere;
        }

        .audit-actor small,
        .audit-date small {
          color: var(--audit-muted);
          font-size: 10px;
          overflow-wrap: anywhere;
        }

        .audit-action-badge,
        .audit-entity-badge,
        .audit-role-list span {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          max-width: 100%;
          font-size: 10px;
          font-weight: 900;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }

       .audit-action-badge,
.audit-entity-badge {
  width: 160px;
  height: 44px;
  min-height: 44px;
  max-width: 100%;
  justify-content: center;
  text-align: center;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.2;
  border-radius: 0;
}

        .audit-action-badge {
          padding: 7px 10px;
        }

        .audit-action-badge.info {
          color: #2f5f9f;
          background: #edf6ff;
          box-shadow: 2px 3px 0 #c6def6;
        }

        .audit-action-badge.success {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 2px 3px 0 #aee6d9;
        }

        .audit-action-badge.warning {
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 2px 3px 0 #ffe0a5;
        }

        .audit-action-badge.danger {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 2px 3px 0 #f2c2cc;
        }

        .audit-entity-badge {
          gap: 7px;
          padding: 7px 10px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
        }

        .audit-tenant {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          max-width: 100%;
          color: #3d4b63;
          font-size: 11px;
          font-weight: 800;
          overflow-wrap: anywhere;
        }

        .audit-date {
          display: grid;
          gap: 4px;
          min-width: 165px;
        }

        .audit-view-button {
          min-height: 36px;
          padding: 0 11px;
          border: 1px solid rgba(65, 55, 161, .18);
          border-radius: 12px;
          color: #40348d;
          background: rgba(255,255,255,.94);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
          font-size: 10px;
        }

        .audit-loading {
          display: grid;
          gap: 11px;
          padding: 28px 26px;
        }

        .audit-loading span {
          display: block;
          height: 56px;
          border-radius: 15px;
          background:
            linear-gradient(90deg, rgba(231, 235, 245, .7), rgba(250, 251, 255, .95), rgba(231, 235, 245, .7));
          background-size: 220% 100%;
          animation: auditSkeleton 1.25s linear infinite;
        }

        @keyframes auditSkeleton {
          to { background-position: -220% 0; }
        }

        .audit-empty-state {
          display: grid;
          justify-items: center;
          gap: 10px;
          padding: 48px 20px;
          color: var(--audit-muted);
          text-align: center;
        }

        .audit-empty-state svg {
          color: #6658dc;
        }

        .audit-empty-state h3 {
          margin: 0;
          color: var(--audit-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 24px;
        }

        .audit-empty-state p {
          max-width: 520px;
          margin: 0;
          font-size: 12px;
          line-height: 1.6;
        }

        .audit-mobile-list {
          display: none;
          gap: 12px;
          padding: 18px 20px 24px;
          background: linear-gradient(180deg, rgba(255,255,255,.96), rgba(247,250,255,.86));
        }

        .audit-mobile-card {
          display: grid;
          gap: 13px;
          min-width: 0;
          padding: 16px;
          border: 1px solid rgba(171,181,211,.58);
          border-radius: 18px;
          background: #fff;
          box-shadow:
            4px 5px 0 rgba(196,204,255,.72),
            0 12px 24px rgba(34,38,110,.06);
        }

        .audit-mobile-top,
        .audit-mobile-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
        }

        .audit-mobile-card h3 {
          margin: 0;
          color: var(--audit-ink);
          font-size: 15px;
          overflow-wrap: anywhere;
        }

        .audit-mobile-card p {
          margin: 4px 0 0;
          color: var(--audit-muted);
          font-size: 11px;
          overflow-wrap: anywhere;
        }

        .audit-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 12000;
          display: grid;
          place-items: center;
          width: 100vw;
          height: 100dvh;
          overflow: hidden;
          padding:
            max(18px, env(safe-area-inset-top))
            max(18px, env(safe-area-inset-right))
            max(18px, env(safe-area-inset-bottom))
            max(18px, env(safe-area-inset-left));
          background: rgba(15, 23, 42, .58);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          overscroll-behavior: none;
        }

        .audit-modal {
          width: min(780px, calc(100vw - 36px));
          max-height: min(88dvh, 820px);
          overflow-y: auto;
          overscroll-behavior: contain;
          border: 1px solid rgba(171, 181, 211, .74);
          border-radius: 26px;
          background: linear-gradient(145deg, #ffffff 0%, #f7fbff 55%, #f8f4ff 100%);
          box-shadow:
            0 32px 86px rgba(22, 29, 73, .32),
            9px 11px 0 rgba(185, 215, 255, .46);
        }

        .audit-modal-header {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 13px;
          align-items: center;
          padding: 19px 20px 16px;
          border-bottom: 1px solid rgba(171, 181, 211, .42);
          background: linear-gradient(135deg, rgba(237,246,255,.97), rgba(248,247,255,.98));
        }

        .audit-modal-icon {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 14px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .audit-modal-title {
          min-width: 0;
        }

        .audit-modal-title > span {
          display: block;
          color: #6b7692;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .audit-modal-title h3 {
          margin: 4px 0 0;
          color: #101a3a;
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 22px;
          font-weight: 760;
          line-height: 1.08;
          letter-spacing: -.025em;
          overflow-wrap: anywhere;
        }

        .audit-modal-title p {
          margin: 5px 0 0;
          color: #5d6d8d;
          font-size: 10px;
          font-weight: 700;
        }

        .audit-icon-button {
          width: 38px;
          min-width: 38px;
          height: 38px;
          padding: 0;
          border: 1px solid rgba(65, 55, 161, .18);
          border-radius: 12px;
          color: #40348d;
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

        .audit-detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          padding: 19px 20px 4px;
        }

        .audit-detail-card {
          display: flex;
          gap: 11px;
          min-width: 0;
          padding: 15px;
          border: 1px solid rgba(171,181,211,.48);
          border-radius: 15px;
          background: rgba(255,255,255,.94);
          box-shadow: 3px 4px 0 rgba(196,204,255,.42);
        }

        .audit-detail-card > svg {
          flex: 0 0 auto;
          color: #40348d;
        }

        .audit-detail-card > div {
          min-width: 0;
        }

        .audit-detail-card span,
        .audit-detail-card small {
          display: block;
          color: #6b7692;
          font-size: 10px;
        }

        .audit-detail-card strong {
          display: block;
          margin: 4px 0;
          color: #1f2c4c;
          font-size: 12px;
          font-weight: 900;
          overflow-wrap: anywhere;
        }

        .audit-modal-section {
          padding: 19px 20px 0;
        }

        .audit-modal-section h3 {
          margin: 0 0 12px;
          color: #101a3a;
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 18px;
          font-weight: 760;
        }

        .audit-role-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .audit-role-list span {
          padding: 7px 9px;
          border-radius: 0;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
        }

        .audit-metadata-list {
          display: grid;
          gap: 1px;
          overflow: hidden;
          margin: 0;
          border: 1px solid rgba(171,181,211,.46);
          border-radius: 14px;
          background: rgba(171,181,211,.34);
        }

        .audit-metadata-list > div {
          display: grid;
          grid-template-columns: minmax(150px, .55fr) minmax(0, 1fr);
          gap: 18px;
          padding: 13px 15px;
          background: #fff;
        }

        .audit-metadata-list dt {
          color: #4e5a70;
          font-size: 11px;
          font-weight: 900;
        }

        .audit-metadata-list dd {
          margin: 0;
          color: #27344c;
          font-size: 11px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .audit-empty-details {
          padding: 19px;
          border: 1px dashed rgba(137,153,190,.44);
          border-radius: 13px;
          color: #5d6d8d;
          font-size: 11px;
          text-align: center;
        }

        .audit-modal-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 20px 20px 22px;
        }

        .audit-modal-footer p {
          margin: 0;
          color: #6b7692;
          font-size: 10px;
          line-height: 1.45;
        }

        .audit-modal-footer .audit-secondary-button {
          flex: 0 0 auto;
        }

        @media (max-width: 1280px) {
          .audit-filter-form {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .audit-filter-form > .audit-primary-button,
          .audit-filter-form > .audit-secondary-button {
            width: 100%;
          }

          .audit-search-inline-feedback {
            grid-column: 1 / -1;
          }

          .audit-advanced-filters {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 1050px) {
          .audit-hero {
            align-items: flex-start;
            flex-direction: column;
            min-height: 0;
          }

          .audit-hero-action-stack {
            width: min(420px, 100%);
            flex-basis: auto;
          }

          .audit-filter-header {
            align-items: stretch;
            flex-direction: column;
          }

          .audit-clear-action-stack {
            width: min(420px, 100%);
          }
        }

        @media (max-width: 900px) {
          .audit-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .audit-table-wrap {
            display: none;
          }

          .audit-mobile-list {
            display: grid;
          }

          .audit-detail-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 820px) {
          .audit-page {
            gap: 18px;
          }

          .audit-hero {
            padding: 26px;
          }

          .audit-hero h1 {
            font-size: clamp(38px, 8vw, 58px);
          }

          .audit-filter-header,
          .audit-filter-form,
          .audit-advanced-filters {
            padding-left: 20px;
            padding-right: 20px;
          }

          .audit-table-topbar,
          .audit-pagination {
            align-items: stretch;
            flex-direction: column;
            padding-left: 20px;
            padding-right: 20px;
          }

          .audit-pagination-controls {
            justify-content: flex-start;
          }

          .audit-page-size-control {
            justify-content: flex-start;
          }
        }

        @media (max-width: 680px) {
          .audit-page {
            gap: 15px;
          }

          .audit-hero {
            padding: 22px 18px;
            border-radius: 26px;
            box-shadow:
              7px 9px 0 #c6d8f7,
              0 20px 34px rgba(34,38,110,.11);
          }

          .audit-hero h1 {
            font-size: clamp(34px, 12vw, 50px);
          }

          .audit-hero p {
            font-size: 12px;
          }

          .audit-panel {
            border-radius: 22px;
            box-shadow:
              5px 7px 0 #c4ccff,
              0 18px 30px rgba(34,38,110,.09);
          }

          .audit-kpi-grid {
            grid-template-columns: 1fr;
          }

          .audit-filter-header {
            padding: 18px 17px 15px;
          }

          .audit-filter-form {
            grid-template-columns: 1fr;
            padding: 16px 17px 18px;
          }

          .audit-advanced-filters {
            grid-template-columns: 1fr;
            padding: 16px 17px 18px;
          }

          .audit-filter-form > .audit-primary-button,
          .audit-filter-form > .audit-secondary-button,
          .audit-clear-action-stack > .audit-secondary-button {
            width: 100%;
          }

          .audit-error {
            margin-left: 17px;
            margin-right: 17px;
          }

          .audit-table-topbar,
          .audit-pagination {
            padding: 15px 17px 19px;
          }

          .audit-pagination-controls {
            width: 100%;
            justify-content: space-between;
          }

          .audit-page-size-control {
            width: 100%;
            justify-content: space-between;
          }

          .audit-page-size-control select {
            width: min(180px, 58vw);
          }

          .audit-mobile-list {
            padding: 15px 17px 22px;
          }

          .audit-mobile-top,
          .audit-mobile-bottom {
            align-items: stretch;
            flex-direction: column;
          }

          .audit-view-button {
            width: 100%;
          }

          .audit-modal-backdrop {
            place-items: center;
            padding:
              max(10px, env(safe-area-inset-top))
              max(10px, env(safe-area-inset-right))
              max(10px, env(safe-area-inset-bottom))
              max(10px, env(safe-area-inset-left));
          }

          .audit-modal {
            width: min(100%, calc(100vw - 20px));
            max-height: min(90dvh, 820px);
            border-radius: 22px;
          }

          .audit-modal-header {
            grid-template-columns: auto minmax(0, 1fr) auto;
            padding: 16px 15px 14px;
          }

          .audit-modal-icon {
            width: 40px;
            height: 40px;
          }

          .audit-detail-grid {
            padding: 16px 15px 4px;
          }

          .audit-modal-section,
          .audit-modal-footer {
            padding-left: 15px;
            padding-right: 15px;
          }

          .audit-metadata-list > div {
            grid-template-columns: 1fr;
            gap: 6px;
          }

          .audit-modal-footer {
            align-items: stretch;
            flex-direction: column;
          }

          .audit-modal-footer .audit-secondary-button {
            width: 100%;
          }
        }

        @media (max-width: 520px) {
          .audit-hero {
            padding: 20px 15px;
          }

          .audit-hero h1 {
            font-size: clamp(31px, 11vw, 43px);
          }

          .audit-eyebrow {
            max-width: 100%;
            white-space: normal;
          }

          .audit-filter-heading h2 {
            font-size: 25px;
          }

          .audit-page-button {
            width: 38px;
            min-width: 38px;
            height: 38px;
          }

          .audit-page-size-control select {
            min-width: 110px;
          }

          .audit-kpi {
            padding: 16px;
          }

          .audit-mobile-card {
            padding: 14px;
          }
        }

        @media (max-width: 390px) {
          .audit-modal-header {
            grid-template-columns: auto minmax(0, 1fr);
          }

          .audit-modal-header .audit-icon-button {
            grid-column: 1 / -1;
            width: 100%;
          }

          .audit-pagination-controls {
            gap: 5px;
          }

          .audit-page-size-control {
            align-items: stretch;
            flex-direction: column;
          }

          .audit-page-size-control select {
            width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .audit-page *,
          .audit-page *::before,
          .audit-page *::after,
          .audit-modal-backdrop *,
          .audit-modal-backdrop *::before,
          .audit-modal-backdrop *::after {
            scroll-behavior: auto !important;
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }
      `}</style>

      <header className="audit-hero">
        <div className="audit-hero-copy">
          <span className="audit-eyebrow">
            <ShieldCheck size={17} />
            Security and accountability
          </span>

          <h1>Audit Logs</h1>

          <p>
            Review important activity across YourComate in a clear, read-only
            timeline. Internal database IDs are hidden so administrators can focus
            on who performed an action, what changed, and when it happened.
          </p>
        </div>

        <div className="audit-hero-action-stack">
          <button
            type="button"
            className="audit-refresh-button"
            onClick={() => refreshAuditLogs('refresh')}
            disabled={refreshing}
          >
            <RefreshCw size={18} className={refreshing ? 'is-spinning' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh logs'}
          </button>

          <InlineActionMessage
            feedback={inlineFeedback.refresh}
            onClose={() => clearInlineFeedback('refresh')}
          />
        </div>
      </header>

      <div className="audit-kpi-grid">
        <article className="audit-kpi">

          <div>
            <span>Total records</span>
            <strong>{total.toLocaleString('en-IN')}</strong>
            <small>Available in the current audit scope</small>
          </div>
        </article>

        <article className="audit-kpi">
         

          <div>
            <span>Visible events</span>
            <strong>{visibleRows.length.toLocaleString('en-IN')}</strong>
            <small>After the current page filters</small>
          </div>
        </article>

        <article className="audit-kpi">
          

          <div>
            <span>Active actors</span>
            <strong>{actorCount.toLocaleString('en-IN')}</strong>
            <small>{actionCount} action type{actionCount === 1 ? '' : 's'} visible</small>
          </div>
        </article>

        <article className="audit-kpi">
         

          <div>
            <span>Latest activity</span>
            <strong>{latestActivity ? formatRelativeTime(latestActivity) : 'No activity'}</strong>
            <small>{latestActivity ? formatDateTime(latestActivity) : 'Nothing recorded yet'}</small>
          </div>
        </article>
      </div>

      <section className="audit-panel">
        <div className="audit-filter-header">
          <div className="audit-filter-heading">
            <Filter size={21} />

            <div>
              <h2>Find audit activity</h2>
              <p>Search records and narrow the current page by action, module or date.</p>
            </div>
          </div>

          {hasFilters || inlineFeedback.clear ? (
            <div className="audit-clear-action-stack">
              {hasFilters ? (
                <button
                  type="button"
                  className="audit-secondary-button"
                  onClick={clearFilters}
                >
                  <X size={17} />
                  Clear filters
                </button>
              ) : null}

              <InlineActionMessage
                feedback={inlineFeedback.clear}
                onClose={() => clearInlineFeedback('clear')}
              />
            </div>
          ) : null}
        </div>

        <form className="audit-filter-form" onSubmit={applyServerFilters}>
          <div className="audit-field">
            <label htmlFor="audit-search">Search logs</label>

            <div className="audit-input-wrap">
              <Search size={18} />

              <input
                id="audit-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Action, employee, email or module"
              />
            </div>
          </div>

          <div className="audit-field">
            <label htmlFor="audit-tenant">Tenant code</label>

            <div className="audit-input-wrap">
              <Building2 size={18} />

              <input
                id="audit-tenant"
                value={tenantInput}
                onChange={(event) => setTenantInput(event.target.value)}
                placeholder="All permitted tenants"
              />
            </div>
          </div>

          <button type="submit" className="audit-primary-button">
            <Search size={17} />
            Search
          </button>

          <button
            type="button"
            className="audit-secondary-button"
            onClick={() => refreshAuditLogs('reload')}
          >
            <RefreshCw size={17} />
            Reload
          </button>

          <InlineActionMessage
            feedback={inlineFeedback.search || inlineFeedback.reload}
            onClose={() => {
              clearInlineFeedback('search');
              clearInlineFeedback('reload');
            }}
            className="audit-search-inline-feedback"
          />
        </form>

        <div className="audit-advanced-filters">
          <div className="audit-field">
            <label htmlFor="audit-action">Action</label>
            <select
              id="audit-action"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
            >
              <option value="">All actions</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {titleCase(action)}
                </option>
              ))}
            </select>
          </div>

          <div className="audit-field">
            <label htmlFor="audit-entity">Module / entity</label>
            <select
              id="audit-entity"
              value={entityFilter}
              onChange={(event) => setEntityFilter(event.target.value)}
            >
              <option value="">All modules</option>
              {entityOptions.map((entity) => (
                <option key={entity} value={entity}>
                  {titleCase(entity)}
                </option>
              ))}
            </select>
          </div>

          <div className="audit-field">
            <label htmlFor="audit-date-from">From date</label>
            <input
              id="audit-date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>

          <div className="audit-field">
            <label htmlFor="audit-date-to">To date</label>
            <input
              id="audit-date-to"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>
        </div>

        {error ? <div className="audit-error">{error}</div> : null}

        {!loading && total > 0 ? (
          <div className="audit-table-topbar">
            <p>
              Page {page} of {pageCount} • {total.toLocaleString('en-IN')} total record
              {total === 1 ? '' : 's'}
            </p>

            <label className="audit-page-size-control" htmlFor="audit-page-size">
              <span>View</span>
              <select
                id="audit-page-size"
                value={pageSize}
                onChange={handlePageSizeChange}
                aria-label="Audit records per page"
              >
                <option value="all">View All</option>
                {AUDIT_PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {loading ? (
          <div className="audit-loading" aria-label="Loading audit logs">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : visibleRows.length > 0 ? (
          <>
            <div className="audit-table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Performed by</th>
                    <th>Action</th>
                    <th>Module / entity</th>
                    <th>Company / tenant</th>
                    <th>Date and time</th>
                    <th>Details</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleRows.map((row, index) => {
                    const rowKey = [
                      row.created_at,
                      row.actor_email,
                      row.action,
                      row.entity,
                      index,
                    ].join('-');

                    return (
                      <tr key={rowKey}>
                        <td>
                          <div className="audit-actor">
                            <strong>{actorName(row)}</strong>
                            <small>{actorEmail(row)}</small>
                          </div>
                        </td>

                        <td>
                          <span className={`audit-action-badge ${actionTone(row.action)}`}>
                            {titleCase(row.action) || 'Recorded action'}
                          </span>
                        </td>

                        <td>
                          <span className="audit-entity-badge">
                            <Database size={15} />
                            {titleCase(row.entity) || 'General'}
                          </span>
                        </td>

                        <td>
                          <span className="audit-tenant">
                            <Building2 size={15} />
                            {normaliseText(row.tenant_id) || 'Platform-wide'}
                          </span>
                        </td>

                        <td>
                          <div className="audit-date">
                            <strong>{formatDateTime(row.created_at)}</strong>
                            <small>{formatRelativeTime(row.created_at)}</small>
                          </div>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="audit-view-button"
                            onClick={() => setSelectedRow(row)}
                          >
                            <Eye size={16} />
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="audit-mobile-list">
              {visibleRows.map((row, index) => {
                const rowKey = [
                  'mobile',
                  row.created_at,
                  row.actor_email,
                  row.action,
                  index,
                ].join('-');

                return (
                  <article className="audit-mobile-card" key={rowKey}>
                    <div className="audit-mobile-top">
                      <span className={`audit-action-badge ${actionTone(row.action)}`}>
                        {titleCase(row.action) || 'Recorded action'}
                      </span>

                      <small>{formatRelativeTime(row.created_at)}</small>
                    </div>

                    <div>
                      <h3>{actorName(row)}</h3>
                      <p>{actorEmail(row)}</p>
                    </div>

                    <span className="audit-entity-badge">
                      <Database size={15} />
                      {titleCase(row.entity) || 'General'}
                    </span>

                    <div className="audit-mobile-bottom">
                      <span className="audit-tenant">
                        <Building2 size={15} />
                        {normaliseText(row.tenant_id) || 'Platform-wide'}
                      </span>

                      <button
                        type="button"
                        className="audit-view-button"
                        onClick={() => setSelectedRow(row)}
                      >
                        <Eye size={16} />
                        View
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="audit-empty-state">
            <ShieldCheck size={42} />
            <h3>No audit activity found</h3>
            <p>
              No records match the selected filters. Clear the filters or refresh
              the page to check for newly recorded activity.
            </p>
          </div>
        )}

        <footer className="audit-pagination">
          <p>
            Page {page} of {pageCount} • {total.toLocaleString('en-IN')} total record
            {total === 1 ? '' : 's'}
          </p>

          <div className="audit-pagination-controls">
            <button
              type="button"
              className="audit-page-button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              aria-label="Previous page"
            >
              <ChevronLeft size={19} />
            </button>

            <span className="audit-page-indicator">
              {page} / {pageCount}
            </span>

            <button
              type="button"
              className="audit-page-button"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={page >= pageCount || loading}
              aria-label="Next page"
            >
              <ChevronRight size={19} />
            </button>
          </div>
        </footer>
      </section>

      <AuditDetailsModal row={selectedRow} onClose={() => setSelectedRow(null)} />
    </section>
  );
}