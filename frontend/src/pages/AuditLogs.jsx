import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
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

function AuditDetailsModal({ row, onClose }) {
  if (!row) {
    return null;
  }

  const metadata = metadataEntries(row.meta);
  const roles = Array.isArray(row.actor_roles)
    ? row.actor_roles.map(titleCase).filter(Boolean)
    : [];

  return (
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
          <div>
            <span className="audit-eyebrow">
              <ShieldCheck size={16} />
              Audit event
            </span>

            <h2 id="audit-details-title">{titleCase(row.action) || 'Recorded action'}</h2>
            <p>{formatDateTime(row.created_at)}</p>
          </div>

          <button
            type="button"
            className="audit-icon-button"
            onClick={onClose}
            aria-label="Close audit details"
          >
            <X size={20} />
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
    </div>
  );
}

export default function AuditLogs() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

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

  const loadAuditLogs = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError('');

      try {
        const data = await api(
          `/audit_logs${buildQuery({
            page,
            limit: PAGE_SIZE,
            q: appliedSearch,
            tenant_id: appliedTenant,
            sort_by: 'created_at',
            sort_dir: 'desc',
          })}`,
        );

        setRows(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total || 0));
      } catch (loadError) {
        setRows([]);
        setTotal(0);
        setError(
          loadError?.message ||
            'Audit logs could not be loaded. Please check your access and try again.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [appliedSearch, appliedTenant, page],
  );

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setSelectedRow(null);
      }
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

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

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
    setPage(1);
    setAppliedSearch(searchInput.trim());
    setAppliedTenant(tenantInput.trim());
  }

  function clearFilters() {
    setSearchInput('');
    setAppliedSearch('');
    setTenantInput('');
    setAppliedTenant('');
    setActionFilter('');
    setEntityFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
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
    <section className="audit-page">
      <style>{`
        .audit-page {
          --audit-ink: #10182d;
          --audit-muted: #65748f;
          --audit-border: rgba(137, 153, 190, .28);
          --audit-primary: #4f46ef;
          --audit-primary-soft: rgba(79, 70, 239, .09);
          position: relative;
          display: grid;
          gap: 22px;
          width: 100%;
          padding-bottom: 32px;
          color: var(--audit-ink);
        }

        .audit-hero,
        .audit-panel {
          border: 1px solid var(--audit-border);
          border-radius: 30px;
          background: rgba(255, 255, 255, .88);
          box-shadow: 0 20px 55px rgba(39, 53, 91, .09);
          backdrop-filter: blur(16px);
        }

        .audit-hero {
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 28px;
          padding: 30px 34px;
          background:
            radial-gradient(circle at 5% 15%, rgba(96, 79, 255, .17), transparent 31%),
            radial-gradient(circle at 95% 10%, rgba(65, 216, 181, .17), transparent 29%),
            linear-gradient(120deg, rgba(255, 255, 255, .96), rgba(247, 250, 255, .92));
        }

        .audit-hero::after {
          content: '';
          position: absolute;
          right: -60px;
          bottom: -85px;
          width: 230px;
          height: 230px;
          border-radius: 50%;
          border: 34px solid rgba(79, 70, 239, .05);
          pointer-events: none;
        }

        .audit-hero-copy {
          position: relative;
          z-index: 1;
          max-width: 820px;
        }

        .audit-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #4f46ef;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .1em;
          text-transform: uppercase;
        }

        .audit-hero h1 {
          margin: 10px 0 8px;
          font-size: clamp(30px, 4vw, 48px);
          line-height: 1.05;
          letter-spacing: -.035em;
        }

        .audit-hero p {
          max-width: 760px;
          margin: 0;
          color: var(--audit-muted);
          font-size: 16px;
          line-height: 1.7;
        }

        .audit-refresh-button,
        .audit-primary-button,
        .audit-secondary-button,
        .audit-page-button,
        .audit-view-button,
        .audit-icon-button {
          border: 0;
          font: inherit;
          cursor: pointer;
          transition:
            transform .18s ease,
            box-shadow .18s ease,
            background .18s ease,
            border-color .18s ease;
        }

        .audit-refresh-button {
          position: relative;
          z-index: 1;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-height: 48px;
          padding: 0 19px;
          border: 1px solid rgba(79, 70, 239, .18);
          border-radius: 16px;
          background: rgba(255, 255, 255, .82);
          color: #3432a9;
          font-weight: 850;
          box-shadow: 0 12px 30px rgba(56, 52, 171, .1);
        }

        .audit-refresh-button:hover,
        .audit-primary-button:hover,
        .audit-secondary-button:hover,
        .audit-view-button:hover,
        .audit-page-button:not(:disabled):hover,
        .audit-icon-button:hover {
          transform: translateY(-2px);
        }

        .audit-refresh-button svg.is-spinning {
          animation: audit-spin .8s linear infinite;
        }

        @keyframes audit-spin {
          to { transform: rotate(360deg); }
        }

        .audit-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 15px;
        }

        .audit-kpi {
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          gap: 14px;
          min-height: 112px;
          padding: 21px;
          border: 1px solid var(--audit-border);
          border-radius: 23px;
          background: rgba(255, 255, 255, .9);
          box-shadow: 0 14px 36px rgba(39, 53, 91, .07);
        }

        .audit-kpi-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 46px;
          height: 46px;
          flex: 0 0 46px;
          border-radius: 15px;
          background: var(--audit-primary-soft);
          color: var(--audit-primary);
        }

        .audit-kpi span {
          display: block;
          color: var(--audit-muted);
          font-size: 12px;
          font-weight: 850;
          letter-spacing: .045em;
          text-transform: uppercase;
        }

        .audit-kpi strong {
          display: block;
          margin-top: 5px;
          font-size: 23px;
          line-height: 1.15;
        }

        .audit-kpi small {
          display: block;
          margin-top: 5px;
          color: #8590a8;
          line-height: 1.35;
        }

        .audit-panel {
          overflow: hidden;
        }

        .audit-filter-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 24px 26px 18px;
        }

        .audit-filter-heading {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .audit-filter-heading h2 {
          margin: 0;
          font-size: 21px;
        }

        .audit-filter-heading p {
          margin: 3px 0 0;
          color: var(--audit-muted);
          font-size: 13px;
        }

        .audit-filter-form {
          display: grid;
          grid-template-columns: minmax(240px, 1.7fr) minmax(150px, .85fr) auto auto;
          gap: 12px;
          padding: 0 26px 15px;
        }

        .audit-advanced-filters {
          display: grid;
          grid-template-columns: repeat(4, minmax(150px, 1fr));
          gap: 12px;
          padding: 0 26px 24px;
        }

        .audit-field {
          position: relative;
          display: grid;
          gap: 7px;
        }

        .audit-field label {
          color: #46536b;
          font-size: 12px;
          font-weight: 850;
        }

        .audit-input-wrap {
          position: relative;
        }

        .audit-input-wrap > svg {
          position: absolute;
          top: 50%;
          left: 14px;
          transform: translateY(-50%);
          color: #7c86a0;
          pointer-events: none;
        }

        .audit-field input,
        .audit-field select {
          width: 100%;
          min-height: 46px;
          border: 1px solid rgba(137, 153, 190, .34);
          border-radius: 14px;
          outline: none;
          background: rgba(248, 250, 255, .86);
          color: var(--audit-ink);
          font: inherit;
          padding: 0 14px;
          transition:
            border-color .18s ease,
            box-shadow .18s ease,
            background .18s ease;
        }

        .audit-input-wrap input {
          padding-left: 43px;
        }

        .audit-field input:focus,
        .audit-field select:focus {
          border-color: rgba(79, 70, 239, .58);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(79, 70, 239, .09);
        }

        .audit-primary-button,
        .audit-secondary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 46px;
          padding: 0 18px;
          border-radius: 14px;
          font-weight: 850;
        }

        .audit-primary-button {
          align-self: end;
          background: linear-gradient(135deg, #5147f4, #6d5dfc);
          color: #fff;
          box-shadow: 0 12px 25px rgba(79, 70, 239, .22);
        }

        .audit-secondary-button {
          align-self: end;
          border: 1px solid rgba(137, 153, 190, .32);
          background: #fff;
          color: #344054;
        }

        .audit-error,
        .audit-empty-state {
          margin: 0 26px 24px;
          border-radius: 18px;
          text-align: center;
        }

        .audit-error {
          padding: 16px 18px;
          border: 1px solid rgba(220, 38, 38, .18);
          background: rgba(254, 226, 226, .65);
          color: #a71d2a;
          font-weight: 750;
        }

        .audit-table-wrap {
          overflow-x: auto;
          border-top: 1px solid rgba(137, 153, 190, .2);
        }

        .audit-table {
          width: 100%;
          min-width: 960px;
          border-collapse: collapse;
        }

        .audit-table th {
          padding: 14px 18px;
          background: rgba(246, 248, 253, .96);
          color: #526078;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .065em;
          text-align: left;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .audit-table td {
          padding: 17px 18px;
          border-top: 1px solid rgba(137, 153, 190, .15);
          vertical-align: middle;
        }

        .audit-table tbody tr {
          transition: background .18s ease;
        }

        .audit-table tbody tr:hover {
          background: rgba(79, 70, 239, .035);
        }

        .audit-actor {
          display: grid;
          gap: 4px;
          min-width: 185px;
        }

        .audit-actor strong {
          font-size: 14px;
        }

        .audit-actor small,
        .audit-date small {
          color: var(--audit-muted);
        }

        .audit-action-badge,
        .audit-entity-badge,
        .audit-role-list span {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 850;
        }

        .audit-action-badge {
          padding: 7px 11px;
        }

        .audit-action-badge.info {
          background: rgba(59, 130, 246, .1);
          color: #245faa;
        }

        .audit-action-badge.success {
          background: rgba(16, 185, 129, .11);
          color: #08775c;
        }

        .audit-action-badge.warning {
          background: rgba(245, 158, 11, .13);
          color: #9a5a00;
        }

        .audit-action-badge.danger {
          background: rgba(239, 68, 68, .1);
          color: #b4232c;
        }

        .audit-entity-badge {
          gap: 7px;
          padding: 7px 11px;
          background: rgba(91, 86, 201, .08);
          color: #454199;
        }

        .audit-tenant {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #3d4b63;
          font-weight: 750;
        }

        .audit-date {
          display: grid;
          gap: 4px;
          min-width: 165px;
        }

        .audit-view-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 38px;
          padding: 0 13px;
          border: 1px solid rgba(79, 70, 239, .22);
          border-radius: 12px;
          background: rgba(79, 70, 239, .06);
          color: #423ac4;
          font-weight: 850;
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
          animation: audit-skeleton 1.25s linear infinite;
        }

        @keyframes audit-skeleton {
          to { background-position: -220% 0; }
        }

        .audit-empty-state {
          display: grid;
          justify-items: center;
          gap: 10px;
          padding: 48px 20px;
          color: var(--audit-muted);
        }

        .audit-empty-state svg {
          color: #7167de;
        }

        .audit-empty-state h3 {
          margin: 0;
          color: var(--audit-ink);
        }

        .audit-empty-state p {
          max-width: 520px;
          margin: 0;
          line-height: 1.6;
        }

        .audit-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 24px;
          border-top: 1px solid rgba(137, 153, 190, .18);
        }

        .audit-pagination p {
          margin: 0;
          color: var(--audit-muted);
          font-size: 13px;
        }

        .audit-pagination-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .audit-page-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 40px;
          height: 40px;
          border: 1px solid rgba(137, 153, 190, .3);
          border-radius: 12px;
          background: #fff;
          color: #3d4960;
        }

        .audit-page-button:disabled {
          cursor: not-allowed;
          opacity: .45;
        }

        .audit-page-indicator {
          min-width: 88px;
          text-align: center;
          color: #3d4960;
          font-size: 13px;
          font-weight: 800;
        }

        .audit-modal-backdrop {
          position: fixed;
          z-index: 2500;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 22px;
          background: rgba(14, 22, 42, .55);
          backdrop-filter: blur(8px);
        }

        .audit-modal {
          width: min(790px, 100%);
          max-height: min(88vh, 820px);
          overflow-y: auto;
          border: 1px solid rgba(255, 255, 255, .45);
          border-radius: 28px;
          background: #fff;
          box-shadow: 0 34px 90px rgba(9, 16, 35, .3);
          animation: audit-modal-enter .2s ease-out;
        }

        @keyframes audit-modal-enter {
          from {
            opacity: 0;
            transform: translateY(12px) scale(.985);
          }

          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .audit-modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 27px 28px 22px;
          border-bottom: 1px solid rgba(137, 153, 190, .18);
          background:
            radial-gradient(circle at 90% 0%, rgba(69, 211, 179, .15), transparent 35%),
            radial-gradient(circle at 5% 0%, rgba(99, 88, 245, .14), transparent 38%),
            #fff;
        }

        .audit-modal-header h2 {
          margin: 8px 0 5px;
          font-size: 27px;
        }

        .audit-modal-header p {
          margin: 0;
          color: var(--audit-muted);
        }

        .audit-icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          border-radius: 13px;
          background: rgba(255, 255, 255, .8);
          color: #36435a;
          box-shadow: 0 8px 24px rgba(40, 52, 84, .1);
        }

        .audit-detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
          padding: 22px 28px 4px;
        }

        .audit-detail-card {
          display: flex;
          gap: 12px;
          padding: 17px;
          border: 1px solid rgba(137, 153, 190, .2);
          border-radius: 17px;
          background: rgba(249, 250, 254, .78);
        }

        .audit-detail-card > svg {
          flex: 0 0 auto;
          color: #574ee1;
        }

        .audit-detail-card div {
          min-width: 0;
        }

        .audit-detail-card span,
        .audit-detail-card small {
          display: block;
          color: var(--audit-muted);
          font-size: 12px;
        }

        .audit-detail-card strong {
          display: block;
          margin: 4px 0;
          overflow-wrap: anywhere;
        }

        .audit-modal-section {
          padding: 20px 28px 0;
        }

        .audit-modal-section h3 {
          margin: 0 0 13px;
          font-size: 16px;
        }

        .audit-role-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .audit-role-list span {
          padding: 7px 10px;
          background: rgba(79, 70, 239, .08);
          color: #433bb1;
        }

        .audit-metadata-list {
          display: grid;
          gap: 1px;
          overflow: hidden;
          margin: 0;
          border: 1px solid rgba(137, 153, 190, .2);
          border-radius: 16px;
          background: rgba(137, 153, 190, .18);
        }

        .audit-metadata-list > div {
          display: grid;
          grid-template-columns: minmax(150px, .55fr) minmax(0, 1fr);
          gap: 18px;
          padding: 14px 16px;
          background: #fff;
        }

        .audit-metadata-list dt {
          color: #4e5a70;
          font-weight: 850;
        }

        .audit-metadata-list dd {
          margin: 0;
          color: #27344c;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .audit-empty-details {
          padding: 20px;
          border: 1px dashed rgba(137, 153, 190, .4);
          border-radius: 15px;
          color: var(--audit-muted);
          text-align: center;
        }

        .audit-modal-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 22px 28px 27px;
        }

        .audit-modal-footer p {
          margin: 0;
          color: var(--audit-muted);
          font-size: 12px;
        }

        @media (max-width: 1100px) {
          .audit-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .audit-filter-form {
            grid-template-columns: 1fr 1fr;
          }

          .audit-advanced-filters {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .audit-page {
            gap: 16px;
          }

          .audit-hero {
            align-items: flex-start;
            flex-direction: column;
            padding: 25px 21px;
            border-radius: 24px;
          }

          .audit-refresh-button {
            width: 100%;
            justify-content: center;
          }

          .audit-kpi-grid {
            grid-template-columns: 1fr;
          }

          .audit-kpi {
            min-height: 94px;
          }

          .audit-filter-header {
            align-items: flex-start;
            flex-direction: column;
            padding: 21px 18px 16px;
          }

          .audit-filter-form,
          .audit-advanced-filters {
            grid-template-columns: 1fr;
            padding-left: 18px;
            padding-right: 18px;
          }

          .audit-advanced-filters {
            padding-bottom: 20px;
          }

          .audit-primary-button,
          .audit-secondary-button {
            width: 100%;
          }

          .audit-table-wrap {
            display: none;
          }

          .audit-mobile-list {
            display: grid !important;
          }

          .audit-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .audit-pagination-controls {
            width: 100%;
            justify-content: space-between;
          }

          .audit-detail-grid {
            grid-template-columns: 1fr;
            padding: 18px 18px 2px;
          }

          .audit-modal-backdrop {
            align-items: end;
            padding: 0;
          }

          .audit-modal {
            width: 100%;
            max-height: 92vh;
            border-radius: 25px 25px 0 0;
          }

          .audit-modal-header,
          .audit-modal-section,
          .audit-modal-footer {
            padding-left: 19px;
            padding-right: 19px;
          }

          .audit-metadata-list > div {
            grid-template-columns: 1fr;
            gap: 6px;
          }

          .audit-modal-footer {
            align-items: stretch;
            flex-direction: column;
          }
        }

        .audit-mobile-list {
          display: none;
          gap: 12px;
          padding: 0 16px 18px;
          border-top: 1px solid rgba(137, 153, 190, .18);
        }

        .audit-mobile-card {
          display: grid;
          gap: 13px;
          padding: 17px;
          border: 1px solid rgba(137, 153, 190, .22);
          border-radius: 18px;
          background: rgba(255, 255, 255, .96);
          box-shadow: 0 10px 25px rgba(39, 53, 91, .06);
        }

        .audit-mobile-card:first-child {
          margin-top: 16px;
        }

        .audit-mobile-top,
        .audit-mobile-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .audit-mobile-card h3 {
          margin: 0;
          font-size: 16px;
        }

        .audit-mobile-card p {
          margin: 3px 0 0;
          color: var(--audit-muted);
          font-size: 13px;
          overflow-wrap: anywhere;
        }

        @media (prefers-reduced-motion: reduce) {
          .audit-page *,
          .audit-page *::before,
          .audit-page *::after {
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

        <button
          type="button"
          className="audit-refresh-button"
          onClick={() => loadAuditLogs({ silent: true })}
          disabled={refreshing}
        >
          <RefreshCw size={18} className={refreshing ? 'is-spinning' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh logs'}
        </button>
      </header>

      <div className="audit-kpi-grid">
        <article className="audit-kpi">
          <span className="audit-kpi-icon">
            <Activity size={22} />
          </span>

          <div>
            <span>Total records</span>
            <strong>{total.toLocaleString('en-IN')}</strong>
            <small>Available in the current audit scope</small>
          </div>
        </article>

        <article className="audit-kpi">
          <span className="audit-kpi-icon">
            <Filter size={22} />
          </span>

          <div>
            <span>Visible events</span>
            <strong>{visibleRows.length.toLocaleString('en-IN')}</strong>
            <small>After the current page filters</small>
          </div>
        </article>

        <article className="audit-kpi">
          <span className="audit-kpi-icon">
            <UserRound size={22} />
          </span>

          <div>
            <span>Active actors</span>
            <strong>{actorCount.toLocaleString('en-IN')}</strong>
            <small>{actionCount} action type{actionCount === 1 ? '' : 's'} visible</small>
          </div>
        </article>

        <article className="audit-kpi">
          <span className="audit-kpi-icon">
            <Clock3 size={22} />
          </span>

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
            onClick={() => loadAuditLogs({ silent: true })}
          >
            <RefreshCw size={17} />
            Reload
          </button>
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